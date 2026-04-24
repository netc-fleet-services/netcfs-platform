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
    """RFC3339 UTC string with Z suffix — required by Samsara v2 endpoints."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def to_ms(dt: datetime) -> int:
    """Unix milliseconds — required by Samsara v1 endpoints (e.g. /v1/fleet/trips)."""
    return int(dt.astimezone(timezone.utc).timestamp() * 1000)

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

# ── Unit matching helpers ─────────────────────────────────────────────────────

def leading_number(s: str) -> str:
    """Extract the first run of digits: '#1023 Peterbilt Ramp' → '1023'."""
    m = re.search(r'\d+', s or '')
    return m.group(0) if m else ''

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

def load_truck_maps() -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    """
    Returns:
      by_unit_raw — {unit_number.strip().lower(): truck_uuid}  (raw string match)
      by_unit_num — {leading_number(unit_number): truck_uuid}  (number-only fallback)
      by_vin      — {vin_upper: truck_uuid}
    """
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
        return {}
    result: dict[str, dict] = {}
    for v in vehicles:
        result[v["id"]] = {
            "raw_name": (v.get("name") or "").strip(),
            "vin":      extract_vin_from_vehicle(v),
        }
    # Print a sample so asset names can be compared against TowBook unit numbers
    sample = sorted(result.values(), key=lambda x: x["raw_name"])[:20]
    print("  Samsara asset name sample (raw → leading number):")
    for s in sample:
        print(f"    {s['raw_name']!r:35s} → {leading_number(s['raw_name'])!r}")
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

def resolve_truck_id(
    sam_veh_id:  str,
    sam_unit:    str,
    sam_vehicles: dict[str, dict],
    by_unit_raw: dict[str, str],
    by_unit_num: dict[str, str],
    by_vin:      dict[str, str],
) -> str | None:
    """
    Match a Samsara asset to a trucks table UUID.
    1. Raw case-insensitive match on the asset name from the event.
    2. Leading-number match on the asset name (e.g. '#1023 ...' → '1023').
    3. Same two passes on the asset name from the Samsara vehicle list.
    4. VIN fallback.
    """
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

def _get_event_time(ev: dict) -> str | None:
    """Return the event occurrence timestamp.
    Stream endpoint uses createdAtTime; keep fallbacks for forward-compat."""
    return (ev.get("createdAtTime")
            or ev.get("time")
            or ev.get("occurredAtTime"))

def _get_event_type(ev: dict) -> str:
    """Return the event behavior type.
    Stream endpoint has no top-level type field; derive from behaviorLabels."""
    labels = ev.get("behaviorLabels") or []
    if labels and isinstance(labels[0], dict):
        label = labels[0].get("label", "")
        if label:
            # Convert PascalCase label to camelCase to match SEVERITY_MAP keys
            return label[0].lower() + label[1:]
    return (ev.get("type") or ev.get("behaviorType") or ev.get("eventType") or "unknown")

def _parse_event_row(ev, by_sam_id, by_name, by_unit_raw, by_unit_num, by_vin, sam_vehicles):
    """Extract a DB row dict from a single /safety-events/stream response object.
    Returns (row_dict | None, resolved: bool | None, asset_name: str)
      row_dict=None   → event missing occurred_at; skip it
      resolved=None   → driver came from Samsara driver ID (interstate path)
      resolved=True   → vehicle matched a truck AND a driver was found in jobs
      resolved=False  → vehicle didn't match a truck, or truck matched but no job found"""
    driver_info  = ev.get("driver",  {}) or {}
    vehicle_info = ev.get("asset", ev.get("vehicle", {})) or {}
    event_type   = _get_event_type(ev)
    occurred_at  = _get_event_time(ev)
    max_speed    = ev.get("maxSpeedMph") or ev.get("maxSpeed")
    speed_limit  = ev.get("speedLimitMph") or ev.get("speedLimit")
    coaching     = ev.get("eventState") or ev.get("coachingState") or ""
    sam_drv_id   = driver_info.get("id", "")
    sam_veh_id   = vehicle_info.get("id", "")
    sam_unit     = vehicle_info.get("name", "")

    if not occurred_at:
        return None, None, sam_unit

    internal_id: int | None = None
    resolved: bool | None   = None

    if sam_drv_id:
        internal_id = by_sam_id.get(sam_drv_id)
    elif sam_veh_id:
        truck_uuid = resolve_truck_id(sam_veh_id, sam_unit, sam_vehicles, by_unit_raw, by_unit_num, by_vin)
        if truck_uuid:
            event_date = datetime.fromisoformat(occurred_at.replace("Z", "+00:00")).astimezone(EASTERN).date()
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
        "occurred_at":      occurred_at,
        "event_type":       event_type,
        "raw_status":       coaching,
        "final_status":     map_coaching_state(coaching),
        "severity_points":  get_severity_points(event_type, max_speed, speed_limit),
        "max_speed":        max_speed,
        "speed_limit":      speed_limit,
        "labels":           ev.get("behaviorLabels") or [],
    }
    return row, resolved, sam_unit


def backfill_events(by_sam_id, by_name, by_unit_raw, by_unit_num, by_vin, sam_vehicles):
    print(f"\n── Safety events backfill {BACKFILL_START} → {BACKFILL_END} ──")

    start_ts = datetime(BACKFILL_START.year, BACKFILL_START.month, BACKFILL_START.day, 0, 0, 0, tzinfo=EASTERN)
    end_ts   = datetime(BACKFILL_END.year,   BACKFILL_END.month,   BACKFILL_END.day,   23, 59, 59, tzinfo=EASTERN)

    print(f"  Fetching {utc_fmt(start_ts)} → {utc_fmt(end_ts)} …", flush=True)
    events = samsara_get("/safety-events/stream", {
        "startTime":        utc_fmt(start_ts),
        "endTime":          utc_fmt(end_ts),
        "queryByTimeField": "createdAtTime",
        "eventStates":      "coached",
        "includeDriver":    "true",
        "includeAsset":     "true",
        "limit":            512,
    })
    print(f"  Retrieved {len(events)} events")

    if not events:
        print("  Nothing to upsert.")
        return

    # Print first event keys so field names can be verified if anything looks wrong
    print(f"  First event keys: {sorted(events[0].keys())}")

    rows = []
    total_resolved   = 0
    total_unresolved = 0
    skipped_no_time  = 0
    unmatched_assets: set[str] = set()

    for ev in events:
        row, resolved, asset_name = _parse_event_row(ev, by_sam_id, by_name, by_unit_raw, by_unit_num, by_vin, sam_vehicles)
        if row is None:
            skipped_no_time += 1
            continue
        rows.append(row)
        if resolved is True:
            total_resolved += 1
        elif resolved is False:
            total_unresolved += 1
            if asset_name:
                unmatched_assets.add(asset_name)

    if skipped_no_time:
        print(f"  Skipped {skipped_no_time} events with no occurrence timestamp")

    sb.table("safety_events").upsert(rows, on_conflict="samsara_event_id").execute()
    print(f"  Upserted {len(rows)} events")
    if total_resolved or total_unresolved:
        print(f"  Vehicle→driver resolution: {total_resolved} matched, {total_unresolved} unmatched")
    if unmatched_assets:
        print(f"  Asset names that did not match any truck ({len(unmatched_assets)}):")
        for name in sorted(unmatched_assets):
            print(f"    {name!r}  (leading number: {leading_number(name)!r})")

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
            "startMs": to_ms(day_start),
            "endMs":   to_ms(day_end),
            "limit":   512,
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
    by_sam_id, by_name           = load_driver_maps()
    by_unit_raw, by_unit_num, by_vin = load_truck_maps()
    sam_vehicles                 = load_samsara_vehicle_info()

    print(f"\nReference data loaded:")
    print(f"  {len(by_sam_id)} drivers with Samsara ID, {len(by_name)} drivers by name")
    print(f"  {len(by_unit_raw)} trucks by unit (raw), {len(by_unit_num)} by leading number, {len(by_vin)} by VIN")
    print(f"  {len(sam_vehicles)} Samsara vehicles")

    backfill_events(by_sam_id, by_name, by_unit_raw, by_unit_num, by_vin, sam_vehicles)

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
