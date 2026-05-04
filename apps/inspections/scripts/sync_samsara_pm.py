"""
Samsara → Supabase PM Sync
Runs daily via GitHub Actions.

Pulls completed work orders from Samsara, finds the most recent one per
vehicle, and upserts last/next PM date and mileage into the fleet
maintenance table.

Next PM date/mileage are computed from the last completed work order using
the configurable intervals at the top of this file — Samsara does not
expose a "next due" field via the work orders API.

Required env vars:
  SAMSARA_API_KEY      — API token with "Read Work Orders" permission
  SUPABASE_URL         — Supabase project URL
  SUPABASE_SERVICE_KEY — Service role key (bypasses RLS)

Vehicle matching: uses samsara_vehicle_id stored on each truck row (fast,
reliable). For trucks not yet linked, falls back to regex extraction from
the Samsara vehicle name and auto-saves the matched ID so the regex only
runs once per truck.
"""

import os, re
from datetime import datetime, timezone, timedelta
import requests
from supabase import create_client

SAMSARA_API_KEY = os.environ["SAMSARA_API_KEY"].strip()
SUPABASE_URL    = os.environ["SUPABASE_URL"].strip()
SUPABASE_KEY    = os.environ["SUPABASE_SERVICE_KEY"].strip()

BASE_URL = "https://api.samsara.com"

# ── PM interval config ─────────────────────────────────────────────────────────
# next_pm_date    = last completed work order date + PM_INTERVAL_DAYS
# next_pm_mileage = last odometer reading + PM_INTERVAL_MILES
PM_INTERVAL_DAYS  = 180    # 6 months
PM_INTERVAL_MILES = 25000

COMPLETED_STATUSES = {"Completed", "Closed"}

sb = create_client(SUPABASE_URL, SUPABASE_KEY)


def samsara_get(path: str, params: dict) -> list[dict]:
    """Paginated GET from Samsara v2 API."""
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


def extract_unit(samsara_name: str) -> str | None:
    """
    Extract a unit number from a Samsara vehicle name.

    Handles the naming patterns seen in this fleet:
      #423 Ram 5500 Wrecker          → 423
      MBTR #45 Jerr-Dan Ramp Truck   → 45
      MBTR #AR21 Ram Ramp            → AR21
      MBTR T88 Freightliner...       → T88  (no # before T-number)
      Rays T89 LD Ramp               → T89
      Rays 424 Peterbilt CS50        → 424
      4442                           → 4442
      4408- 2022 Western Star 40TB   → 4408
      832- 2017 PETERBILT 579...     → 832
      RAYS TRUCK #79 Ford F250       → 79
      MBTR #PLOW TRK                 → None  (no digits → staff/misc unit)
      Chevy Colorado, Spare Unit...  → None
    """
    u = samsara_name.strip().upper()

    # 1. #ALPHANUMERIC — must contain at least one digit to skip #PLOW-style names
    m = re.search(r'#([A-Z]*\d+[A-Z0-9]*)', u)
    if m:
        return m.group(1).lower()

    # 2. Leading number (covers bare "4442" and "4408- 2022 Western Star …")
    m = re.match(r'^(\d+)', u)
    if m:
        return m.group(1)

    # 3. T-number token (e.g. T88, T89 — first match wins so "T76 KW T880" → T76)
    m = re.search(r'\b(T\d+)\b', u)
    if m:
        return m.group(1).lower()

    # 4. Any standalone 2+ digit number (covers "Rays 424 Peterbilt CS50" → 424)
    m = re.search(r'\b(\d{2,})\b', u)
    if m:
        return m.group(1)

    return None


def normalize_unit(s: str) -> str:
    """Lowercase for final lookup — unit numbers are already stripped by extract_unit."""
    return s.strip().lower()


def sync_pm():
    print("\n── Samsara PM Sync ──")

    # Load active trucks — include samsara_vehicle_id for fast lookup
    trucks_resp = sb.table("trucks").select("id, unit_number, samsara_vehicle_id").eq("active", True).execute()
    trucks = trucks_resp.data or []

    # Two indexes: stored ID → truck_id (fast path), unit_number → truck row (regex fallback)
    truck_by_sam_id: dict[str, str] = {}
    truck_by_unit:   dict[str, dict] = {}
    for t in trucks:
        if t.get("samsara_vehicle_id"):
            truck_by_sam_id[t["samsara_vehicle_id"]] = t["id"]
        if t.get("unit_number"):
            truck_by_unit[normalize_unit(t["unit_number"])] = t
    print(f"  {len(trucks)} active trucks loaded — {len(truck_by_sam_id)} already linked to Samsara")

    # Fetch all Samsara vehicles
    print("  Fetching Samsara vehicles...")
    vehicles = samsara_get("/fleet/vehicles", {"limit": 512})

    asset_to_truck: dict[str, str] = {}  # samsara assetId → internal truck_id
    newly_linked = 0
    unmatched: list[str] = []

    for v in vehicles:
        asset_id = v.get("id", "")
        name     = (v.get("name") or "").strip()

        # Fast path — stored samsara_vehicle_id
        if asset_id in truck_by_sam_id:
            asset_to_truck[asset_id] = truck_by_sam_id[asset_id]
            continue

        # Regex fallback for trucks not yet linked
        extracted = extract_unit(name)
        truck_row = truck_by_unit.get(normalize_unit(extracted)) if extracted else None
        if truck_row:
            truck_id = truck_row["id"]
            asset_to_truck[asset_id] = truck_id
            # Persist the link so this regex path never runs again for this truck
            sb.table("trucks").update({"samsara_vehicle_id": asset_id}).eq("id", truck_id).execute()
            newly_linked += 1
            print(f"    linked: {name!r} → unit {extracted} (saved samsara_vehicle_id)")
        else:
            unmatched.append(f"{name!r}" + (f" (extracted: {extracted!r})" if extracted else " (no unit extracted)"))

    print(f"  {len(asset_to_truck)} of {len(vehicles)} Samsara vehicles matched"
          + (f" ({newly_linked} newly linked and saved)" if newly_linked else ""))
    if unmatched:
        print(f"  {len(unmatched)} not matched (not in fleet tracker or unrecognised name format):")
        for u in unmatched[:20]:
            print(f"    {u}")

    if not asset_to_truck:
        print("  No vehicle matches — aborting.")
        return

    # Fetch all work orders (paginated)
    print("  Fetching work orders...")
    all_orders = samsara_get("/maintenance/work-orders", {"limit": 100})
    print(f"  {len(all_orders)} total work orders fetched")

    # For each truck, find the most recent completed/closed work order
    latest: dict[str, dict] = {}
    n_skip_status = n_skip_asset = n_skip_date = 0

    for wo in all_orders:
        if wo.get("status") not in COMPLETED_STATUSES:
            n_skip_status += 1
            continue

        truck_id = asset_to_truck.get(wo.get("assetId", ""))
        if not truck_id:
            n_skip_asset += 1
            continue

        completed_at = wo.get("completedAtTime")
        if not completed_at:
            n_skip_date += 1
            continue

        existing = latest.get(truck_id)
        if not existing or completed_at > existing["completedAtTime"]:
            latest[truck_id] = {
                "completedAtTime": completed_at,
                "odometerMeters":  wo.get("odometerMeters"),
            }

    print(
        f"  {len(latest)} trucks with a completed work order "
        f"(skipped: {n_skip_status} non-complete, {n_skip_asset} unmatched vehicle, "
        f"{n_skip_date} missing date)"
    )

    if not latest:
        print("  Nothing to update.")
        return

    # Compute next PM and upsert into maintenance table
    rows = []
    for truck_id, wo in latest.items():
        completed_at  = wo["completedAtTime"]
        odometer_m    = wo.get("odometerMeters")

        last_pm_date  = completed_at[:10]
        last_pm_miles = round(odometer_m / 1609.344) if odometer_m else None

        last_dt       = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
        next_pm_date  = (last_dt + timedelta(days=PM_INTERVAL_DAYS)).strftime("%Y-%m-%d")
        next_pm_miles = (last_pm_miles + PM_INTERVAL_MILES) if last_pm_miles else None

        rows.append({
            "truck_id":        truck_id,
            "last_pm_date":    last_pm_date,
            "last_pm_mileage": last_pm_miles,
            "next_pm_date":    next_pm_date,
            "next_pm_mileage": next_pm_miles,
        })
        print(
            f"  → truck {truck_id}: last={last_pm_date}"
            + (f" @ {last_pm_miles:,} mi" if last_pm_miles else "")
            + f", next={next_pm_date}"
            + (f" @ {next_pm_miles:,} mi" if next_pm_miles else "")
        )

    sb.table("maintenance").upsert(rows, on_conflict="truck_id").execute()
    print(f"  {len(rows)} maintenance records upserted")


def main():
    print(f"[{datetime.now(timezone.utc).isoformat()}Z] Starting Samsara PM sync")
    sync_pm()
    print("PM sync complete.")


if __name__ == "__main__":
    main()
