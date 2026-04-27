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

import os, re, math
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

def utc_fmt(dt: datetime) -> str:
    """RFC3339 UTC string with Z suffix — required by Samsara v2 endpoints."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def to_ms(dt: datetime) -> int:
    """Unix milliseconds — required by Samsara v1 endpoints (e.g. /v1/fleet/trips)."""
    return int(dt.astimezone(timezone.utc).timestamp() * 1000)

def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Straight-line distance in miles between two lat/lon points."""
    R = 3958.8
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lon2 - lon1)
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))

ROAD_FACTOR = 1.25

def leading_number(s: str) -> str:
    """Extract the first run of digits: '#1023 Peterbilt Ramp' → '1023'."""
    m = re.search(r'\d+', s or '')
    return m.group(0) if m else ''

# ── API helpers ────────────────────────────────────────────────────────────────

def samsara_get(path: str, params: dict) -> list[dict]:
    """v2 paginated GET — response data is under 'data' key with cursor pagination."""
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

def samsara_get_v1_trips_for_vehicle(vehicle_id: str, start_ms: int, end_ms: int) -> list[dict]:
    """v1 trips for a single vehicle — response is under 'trips' key."""
    headers = {"Authorization": f"Bearer {SAMSARA_API_KEY}"}
    resp = requests.get(
        f"{BASE_URL}/v1/fleet/trips",
        headers=headers,
        params={"vehicleId": vehicle_id, "startMs": start_ms, "endMs": end_ms},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("trips", [])

# ── Truck / vehicle lookup helpers ────────────────────────────────────────────

def load_truck_maps() -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    resp = sb.table("trucks").select("id, unit_number, vin").execute()
    by_unit_raw: dict[str, str] = {}
    by_unit_num: dict[str, str] = {}
    by_vin:      dict[str, str] = {}
    for t in (resp.data or []):
        unit = (t.get("unit_number") or "").strip()
        if unit:
            by_unit_raw[unit.lower()] = t["id"]
            num = leading_number(unit)
            if num:
                by_unit_num.setdefault(num, t["id"])
        vin = (t.get("vin") or "").strip().upper()
        if len(vin) >= 10:
            by_vin[vin] = t["id"]
    return by_unit_raw, by_unit_num, by_vin

def load_samsara_vehicle_info() -> dict[str, dict]:
    try:
        vehicles = samsara_get("/fleet/vehicles", {"limit": 512})
    except Exception as e:
        print(f"  WARNING: could not load Samsara vehicle list ({e})")
        return {}
    result: dict[str, dict] = {}
    for v in vehicles:
        ext = v.get("externalIds") or {}
        vin = ""
        if isinstance(ext, dict):
            for key, val in ext.items():
                if "vin" in key.lower() and val:
                    vin = val.strip().upper()
                    break
        if not vin:
            vin = (v.get("vin") or v.get("serial") or "").strip().upper()
        result[v["id"]] = {"raw_name": (v.get("name") or "").strip(), "vin": vin}
    return result

def resolve_truck_id(
    sam_veh_id: str, sam_unit: str, sam_vehicles: dict[str, dict],
    by_unit_raw: dict[str, str], by_unit_num: dict[str, str], by_vin: dict[str, str],
) -> str | None:
    def _try(name: str) -> str | None:
        if not name:
            return None
        if name.lower() in by_unit_raw:
            return by_unit_raw[name.lower()]
        num = leading_number(name)
        if num:
            if num in by_unit_raw:
                return by_unit_raw[num]
            if num in by_unit_num:
                return by_unit_num[num]
        return None
    result = _try(sam_unit)
    if result:
        return result
    veh_info = sam_vehicles.get(sam_veh_id, {})
    result = _try(veh_info.get("raw_name", ""))
    if result:
        return result
    veh_vin = veh_info.get("vin", "")
    if veh_vin and veh_vin in by_vin:
        return by_vin[veh_vin]
    return None

def _driver_id_from_job(job: dict, by_name: dict[str, int]) -> int | None:
    if job.get("driver_id"):
        return int(job["driver_id"])
    tb_name = (job.get("tb_driver") or "").strip().lower()
    return by_name.get(tb_name) if tb_name else None

def resolve_driver_from_job(
    truck_uuid: str | None, sam_unit: str, event_date: date, by_name: dict[str, int],
) -> int | None:
    day_str = event_date.isoformat()
    if truck_uuid:
        resp = (
            sb.table("jobs")
              .select("driver_id, tb_driver")
              .eq("truck_id", truck_uuid)
              .eq("day", day_str)
              .limit(1)
              .execute()
        )
        jobs = resp.data or []
        if jobs:
            result = _driver_id_from_job(jobs[0], by_name)
            if result:
                return result
    num = leading_number(sam_unit)
    if num:
        resp = (
            sb.table("jobs")
              .select("driver_id, tb_driver")
              .ilike("truck_and_equipment", f"%{num}%")
              .eq("day", day_str)
              .limit(1)
              .execute()
        )
        jobs = resp.data or []
        if jobs:
            return _driver_id_from_job(jobs[0], by_name)
    return None

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

def mileage_from_jobs(target_date: date, by_name: dict[str, int], skip_pairs: set[tuple[int, str]]) -> int:
    """
    Estimate mileage for target_date from TowBook jobs using pickup/drop coordinates.
    Fills any driver-days Samsara didn't cover (non-interstate, unlinked vehicles, etc.).
    Returns number of driver-days upserted.
    """
    day_str = target_date.isoformat()
    resp = (
        sb.table("jobs")
          .select("driver_id, tb_driver, pickup_lat, pickup_lon, drop_lat, drop_lon")
          .eq("day", day_str)
          .not_.is_("pickup_lat", "null")
          .not_.is_("drop_lat",   "null")
          .execute()
    )
    jobs = resp.data or []
    if not jobs:
        return 0

    miles_map: dict[int, float] = {}
    for job in jobs:
        driver_id = job.get("driver_id")
        if not driver_id:
            tb_name = (job.get("tb_driver") or "").strip().lower()
            driver_id = by_name.get(tb_name) if tb_name else None
        if not driver_id:
            continue
        key = (int(driver_id), day_str)
        if key in skip_pairs:
            continue
        try:
            dist = haversine_miles(
                float(job["pickup_lat"]), float(job["pickup_lon"]),
                float(job["drop_lat"]),   float(job["drop_lon"]),
            ) * ROAD_FACTOR
        except (TypeError, ValueError):
            continue
        miles_map[int(driver_id)] = miles_map.get(int(driver_id), 0.0) + dist

    if not miles_map:
        return 0

    rows = [
        {"driver_id": did, "driver_name": None, "log_date": day_str,
         "miles": round(m, 2), "source": "towbook_estimate"}
        for did, m in miles_map.items()
    ]
    sb.table("mileage_logs").upsert(rows, on_conflict="driver_id,log_date").execute()
    return len(rows)


def sync_mileage(target_date: date, by_name: dict[str, int],
                 by_unit_raw: dict[str, str], by_unit_num: dict[str, str],
                 by_vin: dict[str, str], sam_vehicles: dict[str, dict]):
    """
    Pull trips for target_date per vehicle and aggregate GPS miles per driver.

    Driver resolution per trip:
      1. Samsara driver assignment (interstate drivers using Samsara Driver app).
      2. Vehicle + date → trucks table → jobs table → driver (all other drivers).
      3. TowBook haversine fallback for any driver-days still missing.
    """
    print(f"\n── Mileage sync for {target_date} ──")

    day_start = datetime(target_date.year, target_date.month, target_date.day,
                         0, 0, 0, tzinfo=EASTERN)
    day_end   = day_start + timedelta(days=1)
    start_ms  = to_ms(day_start)
    end_ms    = to_ms(day_end)

    # Load Samsara driver ID → internal id map
    resp = sb.table("drivers") \
             .select("id, samsara_driver_id") \
             .not_.is_("samsara_driver_id", "null") \
             .execute()
    driver_map = {r["samsara_driver_id"]: r["id"] for r in (resp.data or [])}

    # {(internal_driver_id, date_str): miles}
    miles_map: dict[tuple[int, str], float] = {}
    day_str = target_date.isoformat()
    failed = 0
    samsara_matched = 0
    job_matched = 0

    print(f"  Querying trips for {len(sam_vehicles)} vehicles …")
    for veh_id, veh_info in sam_vehicles.items():
        try:
            trips = samsara_get_v1_trips_for_vehicle(veh_id, start_ms, end_ms)
        except Exception:
            failed += 1
            continue
        for trip in trips:
            if trip.get("distanceMiles") is not None:
                miles = float(trip["distanceMiles"])
            else:
                miles = float(trip.get("distanceMeters") or 0) / 1609.344
            if miles <= 0:
                continue

            # Strategy 1: Samsara driver assignment
            drv_info   = trip.get("driver") or {}
            sam_drv_id = drv_info.get("id", "")
            internal_id: int | None = driver_map.get(sam_drv_id) if sam_drv_id else None

            if internal_id:
                samsara_matched += 1
            else:
                # Strategy 2: vehicle → truck → jobs → driver
                truck_uuid  = resolve_truck_id(
                    veh_id, veh_info.get("raw_name", ""),
                    sam_vehicles, by_unit_raw, by_unit_num, by_vin,
                )
                internal_id = resolve_driver_from_job(
                    truck_uuid, veh_info.get("raw_name", ""), target_date, by_name,
                )
                if internal_id:
                    job_matched += 1

            if not internal_id:
                continue
            key = (internal_id, day_str)
            miles_map[key] = miles_map.get(key, 0.0) + miles

    if failed:
        print(f"  WARNING: {failed} vehicles failed to fetch trips")

    samsara_pairs: set[tuple[int, str]] = set()
    if not miles_map:
        print("  No Samsara trips resolved to drivers — going straight to TowBook fallback")
    else:
        print(f"  Trip attribution: {samsara_matched} via Samsara driver, {job_matched} via jobs lookup")
        rows = [
            {"driver_id": did, "driver_name": None, "log_date": ds,
             "miles": round(m, 2), "source": "samsara"}
            for (did, ds), m in miles_map.items()
        ]
        sb.table("mileage_logs").upsert(rows, on_conflict="driver_id,log_date").execute()
        print(f"  Upserted mileage for {len(rows)} drivers (Samsara GPS)")
        samsara_pairs = {(r["driver_id"], r["log_date"]) for r in rows}

    tb_count = mileage_from_jobs(target_date, by_name, samsara_pairs)
    if tb_count:
        print(f"  TowBook estimate upserted {tb_count} additional driver-days")

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
        "startTime": utc_fmt(day_start),
        "endTime":   utc_fmt(day_end),
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

    db_resp = sb.table("drivers").select("id, name").execute()
    by_name = {r["name"].strip().lower(): r["id"] for r in (db_resp.data or []) if r.get("name")}

    by_unit_raw, by_unit_num, by_vin = load_truck_maps()
    sam_vehicles = load_samsara_vehicle_info()

    sync_mileage(yesterday, by_name, by_unit_raw, by_unit_num, by_vin, sam_vehicles)
    sync_dvirs(yesterday)

    print("\nDaily Samsara sync complete.")


if __name__ == "__main__":
    main()
