"""
Samsara Historical Backfill
Populates safety_events, mileage_logs, and dvir_logs for a past date range.

Run this before compute_safety_scores.py to populate data for a quarter
you want to score. After running this, trigger the scoring workflow with
the same PERIOD_START / PERIOD_END dates.

Driver resolution uses the same logic as sync_samsara_events.py:
  - Interstate: matched via samsara_driver_id
  - Non-interstate: vehicle → trucks table → jobs table → driver

Required env vars:
  SAMSARA_API_KEY      — Samsara API token
  SUPABASE_URL         — Supabase project URL
  SUPABASE_SERVICE_KEY — Service role key (bypasses RLS)
  BACKFILL_START       — ISO date e.g. 2026-01-01
  BACKFILL_END         — ISO date e.g. 2026-03-31
"""

import os, re
from datetime import datetime, timezone, timedelta, date
from zoneinfo import ZoneInfo
import requests
from supabase import create_client

EASTERN = ZoneInfo("America/New_York")

SAMSARA_API_KEY = os.environ["SAMSARA_API_KEY"].strip()
SUPABASE_URL    = os.environ["SUPABASE_URL"].strip()
SUPABASE_KEY    = os.environ["SUPABASE_SERVICE_KEY"].strip()
BACKFILL_START  = date.fromisoformat(os.environ["BACKFILL_START"])
BACKFILL_END    = date.fromisoformat(os.environ["BACKFILL_END"])

BASE_URL = "https://api.samsara.com"

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

def utc_fmt(dt: datetime) -> str:
    """Convert any tz-aware datetime to UTC and format as RFC3339 with Z suffix.
    Samsara rejects localized offsets like -05:00; it requires the Z form."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# ── Severity map (mirrors sync_samsara_events.py) ─────────────────────────────

SEVERITY_MAP: dict[str, int] = {
    "cellPhoneDistraction":       10,
    "mobileUsage":                10,
    "phoneDistraction":           10,
    "seatbeltViolation":          5,
    "distractedDriving":          5,
    "drowsyDriving":              5,
    "followingDistanceViolation": 5,
    "rollingStopDetected":        2,
    "stopSignViolation":          2,
    "harshBraking":               1,
    "harshAcceleration":          1,
    "harshTurn":                  1,
    "laneDeviation":              1,
    "forwardCollisionWarning":    1,
}

def get_severity_points(event_type: str, max_speed, speed_limit) -> int:
    if event_type == "speeding" and max_speed is not None and speed_limit is not None:
        over = float(max_speed) - float(speed_limit)
        if over >= 20: return 10
        if over >= 15: return 5
        return 1
    return SEVERITY_MAP.get(event_type, 1)

def map_coaching_state(raw: str) -> str:
    if raw == "coached":   return "coached"
    if raw == "dismissed": return "dismissed"
    return "pending"

# ── API helper ─────────────────────────────────────────────────────────────────

def samsara_get(path: str, params: dict) -> list[dict]:
    headers = {"Authorization": f"Bearer {SAMSARA_API_KEY}"}
    results = []
    while True:
        resp = requests.get(f"{BASE_URL}{path}", headers=headers, params=params, timeout=60)
        resp.raise_for_status()
        body = resp.json()
        results.extend(body.get("data", []))
        pagination = body.get("pagination", {})
        if not pagination.get("hasNextPage"):
            break
        params = {**params, "after": pagination["endCursor"]}
    return results

# ── Unit normalisation ────────────────────────────────────────────────────────

def normalize_unit(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

# ── Data loaders ───────────────────────────────────────────────────────────────

def load_driver_maps() -> tuple[dict[str, int], dict[str, int]]:
    resp = sb.table("drivers").select("id, name, samsara_driver_id").execute()
    by_sam_id: dict[str, int] = {}
    by_name:   dict[str, int] = {}
    for r in (resp.data or []):
        if r.get("samsara_driver_id"):
            by_sam_id[r["samsara_driver_id"]] = r["id"]
        if r.get("name"):
            by_name[r["name"].strip().lower()] = r["id"]
    return by_sam_id, by_name

def load_truck_maps() -> tuple[dict[str, str], dict[str, str]]:
    resp = sb.table("trucks").select("id, unit_number, vin").execute()
    by_unit: dict[str, str] = {}
    by_vin:  dict[str, str] = {}
    for t in (resp.data or []):
        unit = normalize_unit(t.get("unit_number") or "")
        if unit:
            by_unit[unit] = t["id"]
        vin = (t.get("vin") or "").strip().upper()
        if len(vin) >= 10:
            by_vin[vin] = t["id"]
    return by_unit, by_vin

def extract_vin_from_vehicle(v: dict) -> str:
    ext = v.get("externalIds") or {}
    if isinstance(ext, dict):
        for key, val in ext.items():
            if "vin" in key.lower() and val:
                return val.strip().upper()
    return (v.get("vin") or v.get("serial") or "").strip().upper()

def load_samsara_vehicle_info() -> dict[str, dict]:
    try:
        vehicles = samsara_get("/fleet/vehicles", {"limit": 512})
    except Exception as e:
        print(f"  WARNING: could not load Samsara vehicle list ({e})")
        print("  VIN-based truck matching will be skipped; unit number matching still active.")
        print("  To enable VIN matching, add the 'fleet/vehicles' scope to your Samsara API key.")
        return {}
    result: dict[str, dict] = {}
    for v in vehicles:
        result[v["id"]] = {
            "normalized_unit": normalize_unit(v.get("name") or ""),
            "vin":             extract_vin_from_vehicle(v),
            "raw_name":        (v.get("name") or "").strip(),
        }
    # Print a sample so the asset names can be verified against TowBook unit numbers
    sample = sorted(result.values(), key=lambda x: x["raw_name"])[:20]
    print("  Samsara asset name sample (raw → normalized):")
    for s in sample:
        print(f"    {s['raw_name']!r:30s} → {s['normalized_unit']!r}")
    return result

def load_interstate_drivers() -> list[dict]:
    resp = (
        sb.table("drivers")
          .select("id, name, samsara_driver_id")
          .eq("yard", "interstate")
          .not_.is_("samsara_driver_id", "null")
          .execute()
    )
    return resp.data or []

# ── Vehicle → driver resolution ────────────────────────────────────────────────

def resolve_truck_id(sam_veh_id, sam_unit, sam_vehicles, by_unit, by_vin) -> str | None:
    norm_event_unit = normalize_unit(sam_unit)
    if norm_event_unit and norm_event_unit in by_unit:
        return by_unit[norm_event_unit]
    veh_info = sam_vehicles.get(sam_veh_id, {})
    norm_veh_unit = veh_info.get("normalized_unit", "")
    if norm_veh_unit and norm_veh_unit in by_unit:
        return by_unit[norm_veh_unit]
    veh_vin = veh_info.get("vin", "")
    if veh_vin and veh_vin in by_vin:
        return by_vin[veh_vin]
    return None

def resolve_driver_from_job(truck_uuid, event_date, by_name) -> int | None:
    day_str = event_date.isoformat()
    resp = (
        sb.table("jobs")
          .select("driver_id, tb_driver")
          .eq("truck_id", truck_uuid)
          .gte("pickup_time", day_str + "T00:00:00")
          .lte("pickup_time", day_str + "T23:59:59")
          .limit(1)
          .execute()
    )
    jobs = resp.data or []
    if not jobs:
        return None
    job = jobs[0]
    if job.get("driver_id"):
        return int(job["driver_id"])
    tb_name = (job.get("tb_driver") or "").strip().lower()
    return by_name.get(tb_name) if tb_name else None

# ── Date iteration helper ──────────────────────────────────────────────────────

def date_range(start: date, end: date):
    """Yields every date from start to end inclusive."""
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)

# ── 1. Safety events backfill ─────────────────────────────────────────────────

def _parse_event_row(ev, by_sam_id, by_name, by_unit, by_vin, sam_vehicles):
    """Extract a DB row dict from a single /safety-events/stream response object.
    Returns (row_dict, resolved: bool | None, asset_name: str)
      resolved=None  → driver came from Samsara driver ID (interstate path)
      resolved=True  → vehicle matched a truck AND a driver was found in jobs
      resolved=False → vehicle didn't match a truck, or truck matched but no job found"""
    driver_info  = ev.get("driver",  {}) or {}
    vehicle_info = ev.get("asset", ev.get("vehicle", {})) or {}
    event_type   = ev.get("type", "unknown")
    max_speed    = ev.get("maxSpeedMph") or ev.get("maxSpeed")
    speed_limit  = ev.get("speedLimitMph") or ev.get("speedLimit")
    coaching     = ev.get("coachingState", "")
    sam_drv_id   = driver_info.get("id", "")
    sam_veh_id   = vehicle_info.get("id", "")
    sam_unit     = vehicle_info.get("name", "")

    internal_id: int | None = None
    resolved: bool | None   = None

    if sam_drv_id:
        internal_id = by_sam_id.get(sam_drv_id)
    elif sam_veh_id:
        truck_uuid = resolve_truck_id(sam_veh_id, sam_unit, sam_vehicles, by_unit, by_vin)
        if truck_uuid:
            event_date = datetime.fromisoformat(ev["time"].replace("Z", "+00:00")).astimezone(EASTERN).date()
            internal_id = resolve_driver_from_job(truck_uuid, event_date, by_name)
            resolved = internal_id is not None
        else:
            resolved = False

    row = {
        "samsara_event_id": ev["id"],
        "driver_id":        internal_id,
        "driver_name":      driver_info.get("name") or None,
        "vehicle_id":       sam_veh_id or None,
        "unit_number":      sam_unit or None,
        "occurred_at":      ev.get("time"),
        "event_type":       event_type,
        "raw_status":       coaching,
        "final_status":     map_coaching_state(coaching),
        "severity_points":  get_severity_points(event_type, max_speed, speed_limit),
        "max_speed":        max_speed,
        "speed_limit":      speed_limit,
        "labels":           ev.get("behaviorLabels") or [],
    }
    return row, resolved, sam_unit


def backfill_events(by_sam_id, by_name, by_unit, by_vin, sam_vehicles):
    print(f"\n── Safety events backfill {BACKFILL_START} → {BACKFILL_END} ──")

    start_ts = datetime(BACKFILL_START.year, BACKFILL_START.month, BACKFILL_START.day, 0, 0, 0, tzinfo=EASTERN)
    end_ts   = datetime(BACKFILL_END.year,   BACKFILL_END.month,   BACKFILL_END.day,   23, 59, 59, tzinfo=EASTERN)

    print(f"  Fetching {utc_fmt(start_ts)} → {utc_fmt(end_ts)} …", flush=True)
    events = samsara_get("/safety-events/stream", {
        "startTime":        utc_fmt(start_ts),
        "endTime":          utc_fmt(end_ts),
        "queryByTimeField": "createdAtTime",
        "includeDriver":    "true",
        "includeAsset":     "true",
        "limit":            512,
    })
    print(f"  Retrieved {len(events)} events")

    if not events:
        print("  Nothing to upsert.")
        return

    rows = []
    total_resolved   = 0
    total_unresolved = 0
    unmatched_assets: set[str] = set()

    for ev in events:
        row, resolved, asset_name = _parse_event_row(ev, by_sam_id, by_name, by_unit, by_vin, sam_vehicles)
        rows.append(row)
        if resolved is True:
            total_resolved += 1
        elif resolved is False:
            total_unresolved += 1
            if asset_name:
                unmatched_assets.add(asset_name)

    sb.table("safety_events").upsert(rows, on_conflict="samsara_event_id").execute()
    print(f"  Upserted {len(rows)} events")
    if total_resolved or total_unresolved:
        print(f"  Vehicle→driver resolution: {total_resolved} matched, {total_unresolved} unmatched")
    if unmatched_assets:
        print(f"  Asset names that did not match any truck ({len(unmatched_assets)}):")
        for name in sorted(unmatched_assets):
            print(f"    {name!r}  (normalized: {normalize_unit(name)!r})")

# ── 2. Mileage backfill ────────────────────────────────────────────────────────

def backfill_mileage(driver_map: dict[str, int]):
    """driver_map: {samsara_driver_id: internal_id}"""
    print(f"\n── Mileage backfill {BACKFILL_START} → {BACKFILL_END} ──")

    total_days = (BACKFILL_END - BACKFILL_START).days + 1
    upserted   = 0

    for i, target_date in enumerate(date_range(BACKFILL_START, BACKFILL_END)):
        if (i + 1) % 14 == 0 or target_date == BACKFILL_END:
            print(f"  Processing day {i + 1}/{total_days} ({target_date}) …")

        day_start = datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0, tzinfo=EASTERN)
        day_end   = day_start + timedelta(days=1)

        trips = samsara_get("/v1/fleet/trips", {
            "startTime": utc_fmt(day_start),
            "endTime":   utc_fmt(day_end),
            "limit":     512,
        })

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
                miles_by_driver[sam_id] = {"sam_id": sam_id, "name": drv_info.get("name"), "miles": 0.0}
            miles_by_driver[sam_id]["miles"] += miles

        if not miles_by_driver:
            continue

        rows = []
        for sam_id, info in miles_by_driver.items():
            db_driver = driver_map.get(sam_id)
            rows.append({
                "driver_id":   db_driver if db_driver else None,
                "driver_name": info["name"],
                "log_date":    target_date.isoformat(),
                "miles":       round(info["miles"], 2),
                "source":      "samsara",
            })

        linkable = [r for r in rows if r["driver_id"] is not None]
        if linkable:
            sb.table("mileage_logs").upsert(linkable, on_conflict="driver_id,log_date").execute()
            upserted += len(linkable)

    print(f"  Total mileage rows upserted: {upserted}")

# ── 3. DVIR backfill ───────────────────────────────────────────────────────────

def backfill_dvirs():
    print(f"\n── DVIR backfill {BACKFILL_START} → {BACKFILL_END} ──")

    interstate = load_interstate_drivers()
    if not interstate:
        print("  No linked Interstate drivers — skipping")
        return

    id_to_driver = {d["samsara_driver_id"]: d for d in interstate}
    interstate_sam_ids = {d["samsara_driver_id"] for d in interstate}

    # /dvirs/stream filters by updatedAtTime, max 200/page, no driverIds filter
    start_ts = datetime(BACKFILL_START.year, BACKFILL_START.month, BACKFILL_START.day, 0, 0, 0, tzinfo=EASTERN)
    end_ts   = datetime(BACKFILL_END.year,   BACKFILL_END.month,   BACKFILL_END.day, 23, 59, 59, tzinfo=EASTERN)

    print(f"  Fetching all DVIRs {BACKFILL_START} → {BACKFILL_END} …")
    all_dvirs = samsara_get("/dvirs/stream", {
        "startTime": utc_fmt(start_ts),
        "endTime":   utc_fmt(end_ts),
        "limit":     200,
    })
    dvirs = [d for d in all_dvirs if (d.get("driver") or {}).get("id") in interstate_sam_ids]
    print(f"  {len(all_dvirs)} total DVIRs, {len(dvirs)} from Interstate drivers")

    # Build set of (sam_id, Eastern date str) that submitted
    submitted: set[tuple[str, str]] = set()
    for dvir in dvirs:
        drv = dvir.get("driver") or {}
        drv_id = drv.get("id")
        # Use the DVIR's own time field; fall back to updatedAtTime
        ts_raw = dvir.get("startTime") or dvir.get("inspectionStartedAtMs") or dvir.get("updatedAtTime") or dvir.get("time")
        if drv_id and ts_raw:
            ts = ts_raw if isinstance(ts_raw, str) else datetime.fromtimestamp(int(ts_raw) / 1000, tz=timezone.utc).isoformat()
            d = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(EASTERN).date()
            submitted.add((drv_id, d.isoformat()))

    # Load mileage_logs for the period to know which days each driver drove
    ml_resp = (
        sb.table("mileage_logs")
          .select("driver_id, log_date")
          .gte("log_date", BACKFILL_START.isoformat())
          .lte("log_date", BACKFILL_END.isoformat())
          .gt("miles", 0)
          .execute()
    )
    drove_on: set[tuple[int, str]] = {
        (r["driver_id"], r["log_date"]) for r in (ml_resp.data or [])
    }

    rows = []
    for drv in interstate:
        sam_id      = drv["samsara_driver_id"]
        internal_id = drv["id"]
        for target_date in date_range(BACKFILL_START, BACKFILL_END):
            day_str = target_date.isoformat()
            if (internal_id, day_str) not in drove_on:
                continue
            rows.append({
                "driver_id":   internal_id,
                "driver_name": drv["name"],
                "log_date":    day_str,
                "completed":   (sam_id, day_str) in submitted,
                "source":      "samsara",
            })

    if rows:
        sb.table("dvir_logs").upsert(rows, on_conflict="driver_id,log_date").execute()
        completed = sum(1 for r in rows if r["completed"])
        print(f"  Upserted {len(rows)} DVIR rows — {completed} completed, {len(rows) - completed} missed")
    else:
        print("  No Interstate DVIR rows to log (no mileage data yet — run mileage backfill first)")

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print(f"\nSamsara backfill: {BACKFILL_START} → {BACKFILL_END}")
    print(f"  ({(BACKFILL_END - BACKFILL_START).days + 1} days)")

    # Load shared reference data once
    by_sam_id, by_name = load_driver_maps()
    by_unit, by_vin    = load_truck_maps()
    sam_vehicles       = load_samsara_vehicle_info()

    print(f"\nReference data loaded:")
    print(f"  {len(by_sam_id)} drivers with Samsara ID, {len(by_name)} drivers by name")
    print(f"  {len(by_unit)} trucks by unit number, {len(by_vin)} trucks by VIN")
    print(f"  {len(sam_vehicles)} Samsara vehicles")

    # Safety events (chunks by month)
    backfill_events(by_sam_id, by_name, by_unit, by_vin, sam_vehicles)

    # Mileage (day-by-day, Interstate only since that's what Samsara trips track)
    backfill_mileage(by_sam_id)

    # DVIRs (requires mileage to be populated first to know driving days)
    backfill_dvirs()

    print(f"\nBackfill complete.")
    print(f"Next step: run the 'Compute Safety Scores' workflow with")
    print(f"  PERIOD_START={BACKFILL_START}")
    print(f"  PERIOD_END={BACKFILL_END}")


if __name__ == "__main__":
    main()
