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

import os, re, math
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

def normalize_name(name: str) -> str:
    """Normalize a driver name for cross-system matching.
    Strips parenthetical nicknames ('ALAN (AJ) MISISCHIA' → 'alan misischia'),
    collapses whitespace, and lowercases.
    """
    name = re.sub(r'\s*\([^)]*\)', '', name)
    return re.sub(r'\s+', ' ', name).strip().lower()

# ── Severity map (mirrors sync_samsara_events.py) ─────────────────────────────

# Speeding event types — all resolved via mph-over calculation in get_severity_points
SPEEDING_TYPES = {
    "speeding", "maxSpeed",
    "severeSpeeding", "heavySpeeding", "moderateSpeeding", "lightSpeeding",
}

SEVERITY_MAP: dict[str, int] = {
    # Mobile phone use — 10 pts
    "cellPhoneDistraction":  10,
    "mobileUsage":           10,
    "phoneDistraction":      10,
    # Seatbelt — 5 pts
    "seatbeltViolation":      5,
    "noSeatbelt":             5,
    # Inattentive driving — 5 pts
    "distractedDriving":      5,
    "drowsyDriving":          5,
    "edgeDistractedDriving":  5,
    "genericDistraction":     5,
    # Rolling stop — 2 pts
    "rollingStop":            2,
    "rollingStopDetected":    2,
    # Everything else — 1 pt (minor violations)
}

def get_severity_points(event_type: str, max_speed, speed_limit) -> int:
    # All speeding variants: score by mph over the applicable limit.
    # maxSpeed = fleet-configured cap event; speeding = posted road limit.
    # Both carry maxSpeedMph and speedLimitMph so the same calc applies.
    if event_type in SPEEDING_TYPES:
        if max_speed is not None and speed_limit is not None:
            over = float(max_speed) - float(speed_limit)
            if over >= 20: return 10
            if over >= 15: return 5
            return 1
        # Speed data missing — fall back to Samsara's pre-classification
        if event_type in ("severeSpeeding",):    return 10
        if event_type in ("heavySpeeding",):     return 5
        return 1
    return SEVERITY_MAP.get(event_type, 1)

def map_coaching_state(raw: str) -> str:
    if raw == "coached":   return "coached"
    if raw == "dismissed": return "dismissed"
    return "pending"

# ── API helpers ────────────────────────────────────────────────────────────────

def samsara_get(path: str, params: dict) -> list[dict]:
    """v2 paginated GET — response data is under 'data' key with cursor pagination."""
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

def samsara_get_v1_trips_for_vehicle(vehicle_id: str, start_ms: int, end_ms: int) -> list[dict]:
    """v1 trips for a single vehicle — response is under 'trips' key."""
    headers = {"Authorization": f"Bearer {SAMSARA_API_KEY}"}
    resp = requests.get(
        f"{BASE_URL}/v1/fleet/trips",
        headers=headers,
        params={"vehicleId": vehicle_id, "startMs": start_ms, "endMs": end_ms},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json().get("trips", [])

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
            by_name.setdefault(normalize_name(r["name"]), r["id"])
    return by_sam_id, by_name

def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Straight-line distance in miles between two lat/lon points."""
    R = 3958.8
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lon2 - lon1)
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))

# Road-distance factor: actual road miles ≈ straight-line × 1.25 for service/tow routes
ROAD_FACTOR = 1.25

def load_truck_maps() -> tuple[dict[str, str], dict[str, str], dict[str, str], dict[str, str]]:
    """
    Returns:
      by_unit_raw   — {unit_number.strip().lower(): truck_uuid}
      by_unit_num   — {leading_number(unit_number): truck_uuid}
      by_vin        — {vin_upper: truck_uuid}
      by_id_towbook — {truck_uuid: towbook_name}  (only trucks with towbook_name set)
    """
    resp = sb.table("trucks").select("id, unit_number, vin, towbook_name").execute()
    by_unit_raw:   dict[str, str] = {}
    by_unit_num:   dict[str, str] = {}
    by_vin:        dict[str, str] = {}
    by_id_towbook: dict[str, str] = {}
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
        tb = (t.get("towbook_name") or "").strip()
        if tb:
            by_id_towbook[t["id"]] = tb
    return by_unit_raw, by_unit_num, by_vin, by_id_towbook

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
          .ilike("yard", "interstate")
          .not_.is_("samsara_driver_id", "null")
          .execute()
    )
    return resp.data or []

def load_driver_vehicle_assignments(
    sam_driver_ids: set[str],
    start_dt:       datetime,
    end_dt:         datetime,
) -> dict[str, list[tuple[str, int, int]]]:
    """
    Returns {samsara_driver_id: [(vehicle_id, start_ms, end_ms), ...]}
    Uses /fleet/driver-vehicle-assignments with filterBy=drivers.
    Handles driver rotation — each assignment records which truck a driver used
    and when, so mileage is attributed to the right driver even across truck swaps.
    """
    try:
        raw = samsara_get("/fleet/driver-vehicle-assignments", {
            "filterBy":  "drivers",
            "driverIds": ",".join(sam_driver_ids),
            "startTime": utc_fmt(start_dt),
            "endTime":   utc_fmt(end_dt),
            "limit":     512,
        })
    except Exception as e:
        print(f"  WARNING: driver-vehicle assignments API failed ({e})")
        return {}

    # Group raw assignments by (driver_id, vehicle_id), then merge into a single
    # time window per pair.  Samsara can return one record per trip — without this,
    # we'd make one v1/fleet/trips API call per trip record rather than one per vehicle.
    per_pair: dict[tuple[str, str], list[tuple[int, int]]] = {}
    for a in raw:
        drv_id = (a.get("driver") or {}).get("id", "")
        veh_id = (a.get("vehicle") or {}).get("id", "")
        if not drv_id or not veh_id or drv_id not in sam_driver_ids:
            continue
        start_raw = a.get("startTime")
        end_raw   = a.get("endTime")
        a_start = datetime.fromisoformat(start_raw.replace("Z", "+00:00")) if start_raw else start_dt
        a_end   = datetime.fromisoformat(end_raw.replace("Z", "+00:00"))   if end_raw   else end_dt
        a_start = max(a_start, start_dt)
        a_end   = min(a_end,   end_dt)
        if a_start >= a_end:
            continue
        per_pair.setdefault((drv_id, veh_id), []).append((to_ms(a_start), to_ms(a_end)))

    result: dict[str, list[tuple[str, int, int]]] = {}
    for (drv_id, veh_id), windows in per_pair.items():
        merged_start = min(w[0] for w in windows)
        merged_end   = max(w[1] for w in windows)
        result.setdefault(drv_id, []).append((veh_id, merged_start, merged_end))
    return result

def _dt_month_ranges(start_dt: datetime, end_dt: datetime):
    """Yield (start_ms, end_ms) in ~30-day chunks (v1 API limit)."""
    current = start_dt
    while current <= end_dt:
        if current.month == 12:
            next_month = current.replace(year=current.year + 1, month=1, day=1,
                                         hour=0, minute=0, second=0, microsecond=0)
        else:
            next_month = current.replace(month=current.month + 1, day=1,
                                         hour=0, minute=0, second=0, microsecond=0)
        chunk_end = min(next_month - timedelta(seconds=1), end_dt)
        yield to_ms(current), to_ms(chunk_end)
        current = next_month

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

def _driver_id_from_job(job: dict, by_name: dict[str, int]) -> int | None:
    if job.get("driver_id"):
        return int(job["driver_id"])
    tb_name = (job.get("tb_driver") or "").strip().lower()
    return by_name.get(tb_name) if tb_name else None

def _unique_driver(jobs: list[dict], by_name: dict[str, int]) -> int | None:
    """Return driver_id only if all jobs resolve to exactly one distinct driver."""
    ids = {_driver_id_from_job(j, by_name) for j in jobs}
    ids.discard(None)
    return ids.pop() if len(ids) == 1 else None

def _desc_keywords(asset_name: str) -> list[str]:
    """
    Extract significant words from a Samsara asset name for keyword matching.
    Strips the leading unit-number prefix (#1023, T85, #A-R21) then returns
    words of 5+ chars sorted longest-first (longer = more distinctive).
    Examples:
      '#1524 Kenworth Rotator'       → ['Kenworth', 'Rotator']
      '#3921 KW Quickswap'           → ['Quickswap']
      '#2425 Peterbilt Sleeper Tractor' → ['Peterbilt', 'Sleeper', 'Tractor']
    """
    desc = re.sub(r'^[#\w-]*\d+\w*\s+', '', asset_name).strip()
    words = [w for w in re.split(r'\W+', desc) if len(w) >= 5]
    return sorted(words, key=len, reverse=True)

def resolve_driver_from_job(
    truck_uuid:    str | None,
    sam_unit:      str,
    event_date:    date,
    by_name:       dict[str, int],
    by_id_towbook: dict[str, str],
) -> int | None:
    """
    Match a Samsara asset to a TowBook driver for a given date.

    Samsara uses 4-digit fleet unit numbers (#1023) while TowBook uses different
    identifiers (#41, T85). Numeric matching rarely works across systems, so the
    primary path is keyword matching on the truck description.

    Strategy 0 — towbook_name: if the trucks table has an explicit TowBook name
                 for the matched truck UUID, use it directly as an ILIKE pattern.
                 Most reliable when present (~1/3–1/2 of trucks have this set).
    Strategy 1 — numeric ILIKE: useful if the same number happens to appear in
                 truck_and_equipment (rare, but cheap to try).
    Strategy 2 — keyword ILIKE: extracts significant words from the Samsara asset
                 description (Quickswap, Rotator, Promaster, Kenworth, etc.) and
                 searches truck_and_equipment. Only accepted if all matching jobs
                 on that date resolve to a single unique driver (prevents false
                 matches when multiple similar trucks are active simultaneously).
    """
    day_str = event_date.isoformat()

    def _query(ilike_val: str, allow_null: bool = True) -> list[dict]:
        q = (sb.table("jobs")
               .select("driver_id, tb_driver")
               .ilike("truck_and_equipment", ilike_val)
               .eq("day", day_str))
        if not allow_null:
            q = q.not_.is_("truck_and_equipment", "null")
        return q.execute().data or []

    # Strategy 0: explicit towbook_name (most reliable when present)
    if truck_uuid:
        towbook_name = by_id_towbook.get(truck_uuid, "")
        if towbook_name:
            result = _unique_driver(_query(f"%{towbook_name}%"), by_name)
            if result:
                return result

    # Strategy 1: numeric match
    num = leading_number(sam_unit)
    if num:
        result = _unique_driver(_query(f"%{num}%"), by_name)
        if result:
            return result

    # Strategy 2: keyword match — try up to 3 longest/most distinctive words
    for word in _desc_keywords(sam_unit)[:3]:
        result = _unique_driver(_query(f"%{word}%", allow_null=False), by_name)
        if result:
            return result

    return None

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

def _parse_event_row(ev, by_sam_id, by_name, by_unit_raw, by_unit_num, by_vin, sam_vehicles, by_id_towbook):
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
        if not internal_id:
            # samsara_driver_id not yet linked — try exact then normalized name
            raw = (driver_info.get("name") or "").strip()
            internal_id = by_name.get(raw.lower()) or (by_name.get(normalize_name(raw)) if raw else None)

    # If driver path failed (no Samsara ID or unlinked driver), try vehicle→job resolution
    if not internal_id and (sam_veh_id or sam_unit):
        truck_uuid = resolve_truck_id(sam_veh_id, sam_unit, sam_vehicles, by_unit_raw, by_unit_num, by_vin)
        event_date = datetime.fromisoformat(occurred_at.replace("Z", "+00:00")).astimezone(EASTERN).date()
        internal_id = resolve_driver_from_job(truck_uuid, sam_unit, event_date, by_name, by_id_towbook)
        resolved = internal_id is not None
        if not internal_id and not truck_uuid:
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


def backfill_events(by_sam_id, by_name, by_unit_raw, by_unit_num, by_vin, sam_vehicles, by_id_towbook):
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
        row, resolved, asset_name = _parse_event_row(ev, by_sam_id, by_name, by_unit_raw, by_unit_num, by_vin, sam_vehicles, by_id_towbook)
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

def backfill_mileage_from_jobs(
    start_date:    date,
    end_date:      date,
    by_name:       dict[str, int],
    skip_pairs:    set[tuple[int, str]],  # (driver_id, date_str) already filled by Samsara
) -> int:
    """
    Estimate daily mileage from TowBook jobs using pickup/drop coordinates.
    Covers all drivers (not just Samsara-linked ones) and fills gaps Samsara leaves.
    Returns number of driver-days upserted.
    """
    # Paginate through jobs with coordinates in the date range
    all_jobs: list[dict] = []
    page = 1000
    offset = 0
    while True:
        resp = (
            sb.table("jobs")
              .select("driver_id, tb_driver, day, pickup_lat, pickup_lon, drop_lat, drop_lon")
              .gte("day", start_date.isoformat())
              .lte("day", end_date.isoformat())
              .not_.is_("pickup_lat", "null")
              .not_.is_("drop_lat",   "null")
              .range(offset, offset + page - 1)
              .execute()
        )
        batch = resp.data or []
        all_jobs.extend(batch)
        if len(batch) < page:
            break
        offset += page

    print(f"  Found {len(all_jobs)} jobs with coordinates in range")
    if not all_jobs:
        print("  → No jobs have lat/lon — run backfill_coords.py to geocode historical jobs")
        return 0

    # Aggregate estimated miles per (driver_id, date)
    miles_map:    dict[tuple[int, str], float] = {}
    no_driver = 0
    bad_coords = 0
    valid_driver_ids = set(by_name.values())
    unmatched_tb: dict[str, int] = {}

    for job in all_jobs:
        driver_id = job.get("driver_id")
        if driver_id and int(driver_id) not in valid_driver_ids:
            driver_id = None  # stale FK — driver removed from drivers table
        if not driver_id:
            raw_tb = (job.get("tb_driver") or "").strip()
            if raw_tb:
                driver_id = by_name.get(raw_tb.lower()) or by_name.get(normalize_name(raw_tb))
        if not driver_id:
            raw_tb = (job.get("tb_driver") or "").strip()
            if raw_tb:
                unmatched_tb[raw_tb] = unmatched_tb.get(raw_tb, 0) + 1
            no_driver += 1
            continue

        job_date = (job.get("day") or "").strip()
        if not job_date:
            continue

        key = (int(driver_id), job_date)
        if key in skip_pairs:
            continue

        try:
            dist = haversine_miles(
                float(job["pickup_lat"]), float(job["pickup_lon"]),
                float(job["drop_lat"]),   float(job["drop_lon"]),
            ) * ROAD_FACTOR
        except (TypeError, ValueError):
            bad_coords += 1
            continue

        miles_map[key] = miles_map.get(key, 0.0) + dist

    if no_driver:
        print(f"  → {no_driver} jobs skipped — no resolvable driver")
        if unmatched_tb:
            print(f"     Unmatched tb_driver names ({len(unmatched_tb)} unique, top 15 by count):")
            for name, cnt in sorted(unmatched_tb.items(), key=lambda x: -x[1])[:15]:
                print(f"       {name!r} ({cnt} jobs)")
    if bad_coords:
        print(f"  → {bad_coords} jobs skipped — invalid coordinate values")
    if not miles_map:
        print("  → 0 driver-days produced — check driver resolution above")
        return 0

    rows = [
        {
            "driver_id":   driver_id,
            "driver_name": None,
            "log_date":    date_str,
            "miles":       round(total, 2),
            "source":      "towbook_estimate",
        }
        for (driver_id, date_str), total in miles_map.items()
    ]

    sb.table("mileage_logs").upsert(rows, on_conflict="driver_id,log_date").execute()
    return len(rows)


def backfill_mileage(by_name_global: dict[str, int]):
    """
    Pull GPS trips for interstate drivers via driver-vehicle assignments (handles truck rotation).
    TowBook haversine fills all remaining driver-days (including gaps Samsara misses).
    """
    print(f"\n── Mileage backfill {BACKFILL_START} → {BACKFILL_END} ──")

    start_dt = datetime(BACKFILL_START.year, BACKFILL_START.month, BACKFILL_START.day,
                        0, 0, 0, tzinfo=EASTERN)
    end_dt   = datetime(BACKFILL_END.year,   BACKFILL_END.month,   BACKFILL_END.day,
                        23, 59, 59, tzinfo=EASTERN)

    interstate = load_interstate_drivers()
    miles_map: dict[tuple[int, str], float] = {}
    failed  = 0
    matched = 0

    if interstate:
        id_map  = {d["samsara_driver_id"]: d["id"] for d in interstate}
        sam_ids = set(id_map.keys())

        print(f"  Fetching vehicle assignments for {len(sam_ids)} interstate drivers …")
        assignments = load_driver_vehicle_assignments(sam_ids, start_dt, end_dt)
        total_assignments = sum(len(v) for v in assignments.values())
        print(f"  Assignments found for {len(assignments)} of {len(sam_ids)} drivers "
              f"({total_assignments} total assignment records)")

        for drv_idx, (sam_id, drv_assignments) in enumerate(assignments.items(), 1):
            internal_id = id_map[sam_id]
            drv_trips = 0
            print(f"  [{drv_idx}/{len(assignments)}] driver {sam_id}: "
                  f"{len(drv_assignments)} assignment(s) …", flush=True)
            for veh_id, a_start_ms, a_end_ms in drv_assignments:
                a_start_dt = datetime.fromtimestamp(a_start_ms / 1000, tz=EASTERN)
                a_end_dt   = datetime.fromtimestamp(a_end_ms   / 1000, tz=EASTERN)
                for chunk_start_ms, chunk_end_ms in _dt_month_ranges(a_start_dt, a_end_dt):
                    try:
                        trips = samsara_get_v1_trips_for_vehicle(veh_id, chunk_start_ms, chunk_end_ms)
                    except Exception:
                        failed += 1
                        continue
                    drv_trips += len(trips)
                    for trip in trips:
                        trip_ms = trip.get("startMs") or 0
                        if not trip_ms:
                            continue
                        trip_date = datetime.fromtimestamp(trip_ms / 1000, tz=EASTERN).date()
                        day_str   = trip_date.isoformat()
                        miles = (float(trip["distanceMiles"]) if trip.get("distanceMiles") is not None
                                 else float(trip.get("distanceMeters") or 0) / 1609.344)
                        if miles <= 0:
                            continue
                        matched += 1
                        key = (internal_id, day_str)
                        miles_map[key] = miles_map.get(key, 0.0) + miles
            print(f"    → {drv_trips} trips found", flush=True)

        if failed:
            print(f"  WARNING: {failed} trip fetches failed")
        print(f"  {matched} trips → {len(miles_map)} interstate driver-days from Samsara GPS")

    samsara_pairs: set[tuple[int, str]] = set()
    if miles_map:
        rows = [
            {"driver_id": did, "driver_name": None, "log_date": ds,
             "miles": round(m, 2), "source": "samsara"}
            for (did, ds), m in miles_map.items()
        ]
        sb.table("mileage_logs").upsert(rows, on_conflict="driver_id,log_date").execute()
        print(f"  Upserted {len(rows)} interstate driver-days (Samsara GPS)")
        samsara_pairs = {(r["driver_id"], r["log_date"]) for r in rows}

    tb_count = backfill_mileage_from_jobs(BACKFILL_START, BACKFILL_END, by_name_global, samsara_pairs)
    print(f"  TowBook haversine upserted {tb_count} additional driver-days")

# ── 3. DVIR backfill ───────────────────────────────────────────────────────────

def backfill_dvirs():
    print(f"\n── DVIR backfill {BACKFILL_START} → {BACKFILL_END} ──")

    interstate = load_interstate_drivers()
    if not interstate:
        print("  No linked Interstate drivers — skipping")
        return

    id_to_driver = {d["samsara_driver_id"]: d for d in interstate}
    interstate_sam_ids = {d["samsara_driver_id"] for d in interstate}

    # /dvirs/stream filters by updatedAtTime, not createdAtTime.  A DVIR submitted
    # during the backfill period but later resolved by a manager would have an
    # updatedAtTime after BACKFILL_END and would be missed if we cap the query
    # there.  Fix: query from BACKFILL_START through now, then use each DVIR's
    # startTime (when the driver created it) to credit the correct date.
    start_ts = datetime(BACKFILL_START.year, BACKFILL_START.month, BACKFILL_START.day, 0, 0, 0, tzinfo=EASTERN)
    now_utc  = datetime.now(tz=timezone.utc)

    print(f"  Fetching DVIRs {BACKFILL_START} → today (filtering by startTime to {BACKFILL_END}) …")
    all_dvirs = samsara_get("/dvirs/stream", {
        "startTime": utc_fmt(start_ts),
        "endTime":   utc_fmt(now_utc),
        "limit":     200,
    })

    # Build set of (sam_id, Eastern date str) that submitted within the backfill period,
    # using each DVIR's startTime so resolved-later DVIRs are correctly attributed.
    submitted: set[tuple[str, str]] = set()
    matched = 0
    for dvir in all_dvirs:
        drv_id = (dvir.get("driver") or {}).get("id")
        if drv_id not in interstate_sam_ids:
            continue
        ts_raw = dvir.get("startTime") or dvir.get("updatedAtTime")
        if not ts_raw:
            continue
        d = datetime.fromisoformat(ts_raw.replace("Z", "+00:00")).astimezone(EASTERN).date()
        if BACKFILL_START <= d <= BACKFILL_END:
            submitted.add((drv_id, d.isoformat()))
            matched += 1
    print(f"  {len(all_dvirs)} total DVIRs fetched, {matched} from Interstate drivers within period")

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

def patch_unlinked_event_drivers(by_name: dict[str, int]) -> int:
    """
    Fill driver_id on events that were stored with driver_id=NULL but whose
    driver_name now resolves to a known driver. Safe to re-run — only touches
    rows that still have a null driver_id.
    """
    resp = (
        sb.table("safety_events")
          .select("id, driver_name")
          .is_("driver_id", "null")
          .not_.is_("driver_name", "null")
          .execute()
    )
    events = resp.data or []
    if not events:
        return 0

    by_driver: dict[int, list[str]] = {}
    for ev in events:
        raw = (ev.get("driver_name") or "").strip()
        internal_id = by_name.get(raw.lower()) or (by_name.get(normalize_name(raw)) if raw else None)
        if internal_id:
            by_driver.setdefault(internal_id, []).append(ev["id"])

    patched = 0
    for driver_id, event_ids in by_driver.items():
        sb.table("safety_events").update({"driver_id": driver_id}).in_("id", event_ids).execute()
        patched += len(event_ids)
    return patched


def main():
    print(f"\nSamsara backfill: {BACKFILL_START} → {BACKFILL_END}")
    print(f"  ({(BACKFILL_END - BACKFILL_START).days + 1} days)")

    # Load shared reference data once
    by_sam_id, by_name                         = load_driver_maps()
    by_unit_raw, by_unit_num, by_vin, by_id_towbook = load_truck_maps()
    sam_vehicles                               = load_samsara_vehicle_info()

    print(f"\nReference data loaded:")
    print(f"  {len(by_sam_id)} drivers with Samsara ID, {len(by_name)} drivers by name")
    print(f"  {len(by_unit_raw)} trucks by unit (raw), {len(by_unit_num)} by leading number, {len(by_vin)} by VIN")
    print(f"  {len(by_id_towbook)} trucks with explicit towbook_name")
    print(f"  {len(sam_vehicles)} Samsara vehicles")

    backfill_events(by_sam_id, by_name, by_unit_raw, by_unit_num, by_vin, sam_vehicles, by_id_towbook)

    backfill_mileage(by_name)

    # DVIRs (requires mileage to be populated first to know driving days)
    backfill_dvirs()

    # Retroactively link driver_id on events stored before drivers were linked
    patched = patch_unlinked_event_drivers(by_name)
    if patched:
        print(f"\nRetroactively linked driver_id on {patched} previously unmatched events")

    print(f"\nBackfill complete.")
    print(f"Next step: run the 'Compute Safety Scores' workflow with")
    print(f"  PERIOD_START={BACKFILL_START}")
    print(f"  PERIOD_END={BACKFILL_END}")


if __name__ == "__main__":
    main()
