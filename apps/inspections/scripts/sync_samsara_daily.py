"""
Samsara → Supabase Daily Sync
Runs once per day via GitHub Actions.

Syncs:
  1. Driver list — updates samsara_driver_id on matched drivers
  2. Trips / mileage — daily miles per driver into mileage_logs
  3. DVIRs — pre/post-trip completion for Interstate drivers into dvir_logs

Required env vars:
  SAMSARA_API_KEY      — Samsara API token
  SUPABASE_URL         — Supabase project URL
  SUPABASE_SERVICE_KEY — Service role key (bypasses RLS)
"""

import os
from datetime import datetime, timezone, timedelta, date
from zoneinfo import ZoneInfo
import requests
from supabase import create_client

EASTERN = ZoneInfo("America/New_York")

SAMSARA_API_KEY = os.environ["SAMSARA_API_KEY"].strip()
SUPABASE_URL    = os.environ["SUPABASE_URL"].strip()
SUPABASE_KEY    = os.environ["SUPABASE_SERVICE_KEY"].strip()

BASE_URL = "https://api.samsara.com"

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── API helper ─────────────────────────────────────────────────────────────────

def samsara_get(path: str, params: dict) -> list[dict]:
    headers = {"Authorization": f"Bearer {SAMSARA_API_KEY}"}
    results = []
    while True:
        resp = requests.get(f"{BASE_URL}{path}", headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        body = resp.json()
        results.extend(body.get("data", []))
        pagination = body.get("pagination", {})
        if not pagination.get("hasNextPage"):
            break
        params = {**params, "after": pagination["endCursor"]}
    return results

# ── 1. Driver sync ─────────────────────────────────────────────────────────────

def sync_drivers():
    """
    Pull Samsara driver list and link them to our internal drivers table
    by name match. Does NOT auto-create new drivers — manual table management
    is handled separately. Logs unmatched Samsara drivers for reference.
    """
    print("\n── Driver sync ──")
    samsara_drivers = samsara_get("/fleet/drivers", {"limit": 512})
    print(f"  {len(samsara_drivers)} drivers in Samsara")

    # Load all internal drivers (name → id mapping, lowercased for fuzzy match)
    db_resp = sb.table("drivers").select("id, name, samsara_driver_id").execute()
    db_by_name = {r["name"].strip().lower(): r for r in (db_resp.data or [])}
    db_by_sam_id = {r["samsara_driver_id"]: r for r in (db_resp.data or []) if r.get("samsara_driver_id")}

    linked = 0
    unmatched = []

    for drv in samsara_drivers:
        sam_id   = drv.get("id", "")
        sam_name = (drv.get("name") or "").strip()

        # Already linked — nothing to do
        if sam_id in db_by_sam_id:
            linked += 1
            continue

        # Try name match to auto-link
        match = db_by_name.get(sam_name.lower())
        if match:
            sb.table("drivers").update({"samsara_driver_id": sam_id}).eq("id", match["id"]).execute()
            db_by_sam_id[sam_id] = match
            linked += 1
            print(f"  Linked: {sam_name} → internal id {match['id']}")
        else:
            unmatched.append(f"{sam_name} ({sam_id})")

    print(f"  {linked} drivers linked")
    if unmatched:
        print(f"  {len(unmatched)} Samsara drivers not matched to internal table:")
        for d in sorted(unmatched):
            print(f"    {d}")

# ── 2. Mileage sync ────────────────────────────────────────────────────────────

def sync_mileage(target_date: date):
    """
    Pull trips for target_date and aggregate miles per driver.
    Upserts into mileage_logs (one row per driver per day).
    """
    print(f"\n── Mileage sync for {target_date} ──")

    day_start = datetime(target_date.year, target_date.month, target_date.day,
                         0, 0, 0, tzinfo=EASTERN)
    day_end   = day_start + timedelta(days=1)

    trips = samsara_get("/v1/fleet/trips", {
        "startTime": day_start.isoformat(),
        "endTime":   day_end.isoformat(),
        "limit":     512,
    })
    print(f"  {len(trips)} trips retrieved")

    # Load driver map
    resp = sb.table("drivers") \
             .select("id, samsara_driver_id, name") \
             .not_.is_("samsara_driver_id", "null") \
             .execute()
    driver_map = {r["samsara_driver_id"]: r for r in (resp.data or [])}

    # Aggregate miles per Samsara driver ID
    miles_by_driver: dict[str, dict] = {}
    for trip in trips:
        drv_info = trip.get("driver") or {}
        sam_id   = drv_info.get("id", "")
        if not sam_id:
            continue
        dist_m = trip.get("distanceMeters") or 0
        miles  = float(dist_m) / 1609.344

        if sam_id not in miles_by_driver:
            miles_by_driver[sam_id] = {
                "sam_id":   sam_id,
                "name":     drv_info.get("name"),
                "miles":    0.0,
            }
        miles_by_driver[sam_id]["miles"] += miles

    if not miles_by_driver:
        print("  No trips with driver assignments — skipping mileage upsert")
        return

    rows = []
    for sam_id, info in miles_by_driver.items():
        db_driver = driver_map.get(sam_id)
        rows.append({
            "driver_id":   db_driver["id"] if db_driver else None,
            "driver_name": info["name"],
            "log_date":    target_date.isoformat(),
            "miles":       round(info["miles"], 2),
            "source":      "samsara",
        })

    # Upsert — on conflict (driver_id, log_date) update miles
    # For rows with null driver_id we can't use the unique constraint,
    # so filter those out and just log them as warnings
    linkable = [r for r in rows if r["driver_id"] is not None]
    orphaned = [r for r in rows if r["driver_id"] is None]

    if linkable:
        sb.table("mileage_logs").upsert(linkable, on_conflict="driver_id,log_date").execute()
        print(f"  Upserted mileage for {len(linkable)} drivers")
    if orphaned:
        print(f"  Skipped {len(orphaned)} drivers not yet in internal table: "
              f"{[r['driver_name'] for r in orphaned]}")

# ── 3. DVIR sync ───────────────────────────────────────────────────────────────

def sync_dvirs(target_date: date):
    """
    Pull DVIR submissions from Samsara for target_date.
    Only records Interstate drivers (yard = 'interstate') — other locations
    log DVIRs manually in the app.
    A driver who drove that day (has mileage) but submitted no DVIR is marked
    completed=false.
    """
    print(f"\n── DVIR sync for {target_date} ──")

    # Load Interstate drivers that are linked to Samsara
    resp = sb.table("drivers") \
             .select("id, name, samsara_driver_id") \
             .eq("yard", "interstate") \
             .not_.is_("samsara_driver_id", "null") \
             .execute()
    interstate = resp.data or []

    if not interstate:
        print("  No linked Interstate drivers found — skipping")
        return

    id_to_driver = {d["samsara_driver_id"]: d for d in interstate}
    interstate_sam_ids = {d["samsara_driver_id"] for d in interstate}

    day_start = datetime(target_date.year, target_date.month, target_date.day,
                         0, 0, 0, tzinfo=EASTERN)
    day_end   = day_start + timedelta(days=1)

    # /dvirs/stream filters by updatedAtTime, max 200 per page, no driverIds filter
    all_dvirs = samsara_get("/dvirs/stream", {
        "startTime": day_start.isoformat(),
        "endTime":   day_end.isoformat(),
        "limit":     200,
    })
    # Filter client-side to only Interstate drivers
    dvirs = [d for d in all_dvirs if (d.get("driver") or {}).get("id") in interstate_sam_ids]
    print(f"  {len(all_dvirs)} total DVIRs, {len(dvirs)} from Interstate drivers")

    # Determine which drivers submitted at least one DVIR
    submitted: set[str] = set()
    for dvir in dvirs:
        drv = dvir.get("driver") or {}
        if drv.get("id"):
            submitted.add(drv["id"])

    # Load mileage_logs to determine who actually drove today
    # (don't penalise drivers who were off)
    ml_resp = sb.table("mileage_logs") \
                .select("driver_id") \
                .eq("log_date", target_date.isoformat()) \
                .gt("miles", 0) \
                .execute()
    drove_ids = {r["driver_id"] for r in (ml_resp.data or [])}

    rows = []
    for drv in interstate:
        sam_id      = drv["samsara_driver_id"]
        internal_id = drv["id"]

        # Only log compliance for days the driver actually drove
        if internal_id not in drove_ids:
            continue

        completed = sam_id in submitted
        rows.append({
            "driver_id":   internal_id,
            "driver_name": drv["name"],
            "log_date":    target_date.isoformat(),
            "completed":   completed,
            "source":      "samsara",
        })

    if rows:
        sb.table("dvir_logs").upsert(rows, on_conflict="driver_id,log_date").execute()
        completed_count = sum(1 for r in rows if r["completed"])
        print(f"  Logged {len(rows)} drivers — {completed_count} completed, "
              f"{len(rows) - completed_count} missed")
    else:
        print("  No Interstate drivers drove today — nothing to log")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    yesterday = (datetime.now(EASTERN) - timedelta(days=1)).date()

    sync_drivers()
    sync_mileage(yesterday)
    sync_dvirs(yesterday)

    print("\nDaily Samsara sync complete.")


if __name__ == "__main__":
    main()
