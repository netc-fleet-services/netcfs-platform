"""
Samsara Historical Backfill
Populates safety_events, mileage_logs, and dvir_logs for a past date range.

Run this before compute_safety_scores.py to populate data for a quarter
you want to score. After running this, trigger the scoring workflow with
the same PERIOD_START / PERIOD_END dates.

Driver resolution uses the same logic as sync_samsara_events.py:
  - Interstate: matched via samsara_driver_id
  - Non-interstate: vehicle → trucks table → jobs table → driver

Mileage backfill uses three passes (same as sync_samsara_daily.py):
  1. Driver-login GPS  — Samsara trips for interstate drivers with samsara_driver_id
  2. Vehicle GPS       — Samsara vehicle trips for non-interstate drivers via TowBook job lookup
  3. TowBook estimate  — haversine fallback for any remaining driver-days

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
DRY_RUN         = os.environ.get("DRY_RUN", "").strip().lower() in ("1", "true", "yes")

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
    handles 'LAST, FIRST' → 'first last' (TowBook format),
    collapses whitespace, and lowercases.
    """
    name = re.sub(r'\s*\([^)]*\)', '', name)
    name = re.sub(r'\s+', ' ', name).strip().lower()
    if ',' in name:
        parts = [p.strip() for p in name.split(',', 1)]
        if len(parts) == 2 and parts[0] and parts[1]:
            name = f"{parts[1]} {parts[0]}"
    return name

FIRST_NAME_ALIASES: dict[str, list[str]] = {
    "matthew":     ["matt"],
    "joshua":      ["josh"],
    "jonathan":    ["jon"],
    "patrick":     ["pat"],
    "padraic":     ["pat"],
    "richard":     ["rich", "rick"],
    "daniel":      ["dan", "danny"],
    "joseph":      ["joe"],
    "robert":      ["rob", "bob"],
    "james":       ["jim"],
    "william":     ["will", "bill"],
    "michael":     ["mike"],
    "thomas":      ["tom"],
    "christopher": ["chris"],
    "nicholas":    ["nick"],
    "zachary":     ["zach"],
    "andrew":      ["andy"],
    "timothy":     ["tim"],
    "jeffrey":     ["jeff"],
    "gregory":     ["greg"],
    "stephen":     ["steve"],
    "steven":      ["steve"],
    "raymond":     ["ray"],
    "lawrence":    ["larry"],
    "donald":      ["don"],
    "edward":      ["ed"],
    "anthony":     ["tony"],
    "kenneth":     ["ken"],
    "benjamin":    ["ben"],
}

def _name_forms(name: str) -> list[str]:
    """Return all lookup keys for a name (lowercased, deduplicated).
    Covers: base form, normalize_name, nickname expansions,
    hyphenated-last shortening, and middle-name stripping.
    """
    seen: set[str] = set()
    keys: list[str] = []
    def _add(s: str) -> None:
        s = s.strip()
        if s and s not in seen:
            seen.add(s); keys.append(s)

    _add(name.strip().lower())
    _add(normalize_name(name))
    parts = name.strip().lower().split()
    if not parts:
        return keys
    first, rest = parts[0], parts[1:]
    if len(parts) >= 3:
        _add(f"{first} {parts[-1]}")
        for nick in FIRST_NAME_ALIASES.get(first, []):
            _add(f"{nick} {parts[-1]}")
    if rest and '-' in rest[-1]:
        short_rest = rest[:-1] + [rest[-1].split('-')[0]]
        _add(f"{first} {' '.join(short_rest)}")
        for nick in FIRST_NAME_ALIASES.get(first, []):
            _add(f"{nick} {' '.join(short_rest)}")
    for nick in FIRST_NAME_ALIASES.get(first, []):
        _add(f"{nick} {' '.join(rest)}")
    return keys

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
            for key in _name_forms(r["name"]):
                by_name.setdefault(key, r["id"])
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

# Yard coordinates mirror transport app geo.ts geoCache exactly (4-decimal precision
# matches the route_cache key format the transport app uses).
YARD_COORDS: dict[str, tuple[float, float]] = {
    "exeter":     (42.9814, -70.9319),
    "pembroke":   (43.1473, -71.4579),
    "mattbrowns": (43.1379, -71.4792),
    "rays":       (43.5084, -70.4618),
}

def _route_key(*coords: tuple[float, float]) -> str:
    """Build a route_cache lookup key identical to the transport app's routeKey()."""
    return "|".join(f"{lat:.4f},{lon:.4f}" for lat, lon in coords)

def load_route_cache() -> dict[str, float]:
    """Load road-distance cache from Supabase (populated by transport app GraphHopper calls)."""
    resp = sb.table("route_cache").select("key, miles").execute()
    return {r["key"]: float(r["miles"]) for r in (resp.data or []) if r.get("miles") is not None}

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

def load_vehicle_driver_schedule(
    sam_driver_ids: set[str],
    start_dt:       datetime,
    end_dt:         datetime,
) -> dict[str, list[tuple[int, int, str]]]:
    """
    Returns {vehicle_id: [(start_ms, end_ms, driver_sam_id), ...]} sorted by start_ms.
    Each entry is one assignment record clamped to [start_dt, end_dt]. Windows are
    never merged per (driver, vehicle) pair, so a trip's driver is whoever was
    actually logged in at the trip's start time — split shifts and same-truck-on-
    different-days stay distinct.
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

    schedule: dict[str, list[tuple[int, int, str]]] = {}
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
        schedule.setdefault(veh_id, []).append((to_ms(a_start), to_ms(a_end), drv_id))

    for veh_id in schedule:
        schedule[veh_id].sort(key=lambda x: x[0])
    return schedule


def driver_at(schedule_entries: list[tuple[int, int, str]], ts_ms: int) -> str | None:
    """driver_sam_id whose assignment window contains ts_ms, or None."""
    for start_ms, end_ms, drv_id in schedule_entries:
        if start_ms <= ts_ms <= end_ms:
            return drv_id
    return None

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
    tb_name = (job.get("tb_driver") or "").strip()
    if not tb_name:
        return None
    return next((by_name[k] for k in _name_forms(tb_name) if k in by_name), None)

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
            internal_id = next((by_name[k] for k in _name_forms(raw) if k in by_name), None) if raw else None

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
    route_cache:   dict[str, float],
) -> int:
    """
    Calculate total daily trip miles from TowBook jobs using full round-trip distance
    (yard→pickup→drop→yard), matching the transport app's mileage methodology.
    Looks up route_cache for exact road miles; falls back to haversine × 1.25.
    Covers all drivers and fills gaps Samsara GPS leaves.
    Returns number of driver-days upserted.
    """
    # Paginate through jobs with coordinates in the date range
    all_jobs: list[dict] = []
    page = 1000
    offset = 0
    while True:
        resp = (
            sb.table("jobs")
              .select("driver_id, tb_driver, yard_id, day, pickup_lat, pickup_lon, drop_lat, drop_lon")
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
                driver_id = next((by_name[k] for k in _name_forms(raw_tb) if k in by_name), None)
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
            p_lat = float(job["pickup_lat"])
            p_lon = float(job["pickup_lon"])
            d_lat = float(job["drop_lat"])
            d_lon = float(job["drop_lon"])
        except (TypeError, ValueError):
            bad_coords += 1
            continue
        yard = YARD_COORDS.get((job.get("yard_id") or "").strip())
        if yard:
            y_lat, y_lon = yard
            ck = _route_key((y_lat, y_lon), (p_lat, p_lon), (d_lat, d_lon), (y_lat, y_lon))
            dist = route_cache[ck] if ck in route_cache else (
                haversine_miles(y_lat, y_lon, p_lat, p_lon) +
                haversine_miles(p_lat, p_lon, d_lat, d_lon) +
                haversine_miles(d_lat, d_lon, y_lat, y_lon)
            ) * ROAD_FACTOR
        else:
            dist = haversine_miles(p_lat, p_lon, d_lat, d_lon) * ROAD_FACTOR

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


def backfill_mileage_from_vehicle_gps(
    start_date:    date,
    end_date:      date,
    by_name:       dict[str, int],
    sam_vehicles:  dict[str, dict],
    by_unit_raw:   dict[str, str],
    by_unit_num:   dict[str, str],
    by_vin:        dict[str, str],
    by_id_towbook: dict[str, str],
    skip_pairs:    set[tuple[int, str]],
) -> set[tuple[int, str]]:
    """
    Pull GPS trips from Samsara vehicle telemetry for the full backfill range.
    For each vehicle, fetches all trips (chunked by month), resolves vehicle → driver
    per trip date via TowBook jobs, and writes mileage_logs with source='samsara_vehicle'.
    Skips (driver_id, date) pairs already covered by the driver-login GPS pass.
    Returns the set of (driver_id, log_date) pairs written.
    """
    start_dt = datetime(start_date.year, start_date.month, start_date.day, 0, 0, 0, tzinfo=EASTERN)
    end_dt   = datetime(end_date.year,   end_date.month,   end_date.day,  23, 59, 59, tzinfo=EASTERN)

    miles_map:    dict[tuple[int, str], float] = {}
    driver_cache: dict[tuple[str, str], int | None] = {}  # (veh_id, date_str) → driver_id
    matched = 0
    skipped = 0
    failed  = 0

    print(f"  Pulling vehicle GPS trips for {len(sam_vehicles)} Samsara vehicles …", flush=True)

    for veh_id, veh_info in sam_vehicles.items():
        unit_name  = veh_info["raw_name"]
        truck_uuid = resolve_truck_id(veh_id, unit_name, sam_vehicles, by_unit_raw, by_unit_num, by_vin)

        all_trips: list[dict] = []
        for chunk_start_ms, chunk_end_ms in _dt_month_ranges(start_dt, end_dt):
            try:
                all_trips.extend(samsara_get_v1_trips_for_vehicle(veh_id, chunk_start_ms, chunk_end_ms))
            except Exception:
                failed += 1
                continue

        for trip in all_trips:
            trip_ms = trip.get("startMs") or 0
            if not trip_ms:
                continue
            trip_date = datetime.fromtimestamp(trip_ms / 1000, tz=EASTERN).date()
            if not (start_date <= trip_date <= end_date):
                continue
            day_str = trip_date.isoformat()

            cache_key = (veh_id, day_str)
            if cache_key not in driver_cache:
                driver_cache[cache_key] = resolve_driver_from_job(
                    truck_uuid, unit_name, trip_date, by_name, by_id_towbook,
                )
            driver_id = driver_cache[cache_key]
            if not driver_id:
                continue

            key = (driver_id, day_str)
            if key in skip_pairs:
                skipped += 1
                continue

            miles = (float(trip["distanceMiles"]) if trip.get("distanceMiles") is not None
                     else float(trip.get("distanceMeters") or 0) / 1609.344)
            if miles <= 0:
                continue
            matched += 1
            miles_map[key] = miles_map.get(key, 0.0) + miles

    if failed:
        print(f"  WARNING: {failed} vehicle trip fetches failed")

    if not miles_map:
        return set()

    print(f"  {matched} trips → {len(miles_map)} driver-days from Samsara vehicle GPS")
    if skipped:
        print(f"  {skipped} trips skipped (driver already covered by driver-login GPS)")
    rows = [
        {"driver_id": did, "driver_name": None, "log_date": ds,
         "miles": round(m, 2), "source": "samsara_vehicle"}
        for (did, ds), m in miles_map.items()
    ]
    sb.table("mileage_logs").upsert(rows, on_conflict="driver_id,log_date").execute()
    return set(miles_map.keys())


def backfill_mileage(
    by_name_global: dict[str, int],
    sam_vehicles:   dict[str, dict],
    by_unit_raw:    dict[str, str],
    by_unit_num:    dict[str, str],
    by_vin:         dict[str, str],
    by_id_towbook:  dict[str, str],
):
    """
    Three-pass mileage backfill (mirrors sync_samsara_daily.py):
      1. Driver-login GPS  — Samsara trips for interstate drivers with samsara_driver_id
      2. Vehicle GPS       — Samsara vehicle trips for non-interstate drivers via TowBook job lookup
      3. TowBook estimate  — haversine fallback for any remaining driver-days
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

        print(f"  Loading vehicle-driver schedule for {len(sam_ids)} interstate drivers …")
        schedule = load_vehicle_driver_schedule(sam_ids, start_dt, end_dt)
        total_records = sum(len(v) for v in schedule.values())
        print(f"  Schedule covers {len(schedule)} vehicle(s) "
              f"({total_records} assignment records, un-merged)")

        for veh_idx, (veh_id, entries) in enumerate(schedule.items(), 1):
            veh_trips = 0
            print(f"  [{veh_idx}/{len(schedule)}] vehicle {veh_id}: "
                  f"{len(entries)} assignment(s) …", flush=True)
            for chunk_start_ms, chunk_end_ms in _dt_month_ranges(start_dt, end_dt):
                try:
                    trips = samsara_get_v1_trips_for_vehicle(veh_id, chunk_start_ms, chunk_end_ms)
                except Exception:
                    failed += 1
                    continue
                veh_trips += len(trips)
                for trip in trips:
                    trip_ms = trip.get("startMs") or 0
                    if not trip_ms:
                        continue
                    drv_sam_id = driver_at(entries, trip_ms)
                    if not drv_sam_id:
                        continue
                    miles = (float(trip["distanceMiles"]) if trip.get("distanceMiles") is not None
                             else float(trip.get("distanceMeters") or 0) / 1609.344)
                    if miles <= 0:
                        continue
                    matched += 1
                    trip_date = datetime.fromtimestamp(trip_ms / 1000, tz=EASTERN).date()
                    key = (id_map[drv_sam_id], trip_date.isoformat())
                    miles_map[key] = miles_map.get(key, 0.0) + miles
            print(f"    → {veh_trips} trips fetched", flush=True)

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

    print(f"\n── Vehicle GPS pass (non-interstate) ──")
    vehicle_pairs = backfill_mileage_from_vehicle_gps(
        BACKFILL_START, BACKFILL_END, by_name_global,
        sam_vehicles, by_unit_raw, by_unit_num, by_vin, by_id_towbook,
        samsara_pairs,
    )
    all_gps_pairs = samsara_pairs | vehicle_pairs

    route_cache = load_route_cache()
    print(f"  {len(route_cache)} entries in route_cache")
    tb_count = backfill_mileage_from_jobs(BACKFILL_START, BACKFILL_END, by_name_global, all_gps_pairs, route_cache)
    print(f"  TowBook upserted {tb_count} additional driver-days")

# ── 3. DVIR backfill ───────────────────────────────────────────────────────────

def backfill_dvirs():
    print(f"\n── DVIR backfill {BACKFILL_START} → {BACKFILL_END} ──")

    interstate = load_interstate_drivers()
    if not interstate:
        print("  No linked Interstate drivers — skipping")
        return

    interstate_sam_ids      = {d["samsara_driver_id"] for d in interstate}
    interstate_internal_ids = {d["id"] for d in interstate}
    int_id_map              = {d["samsara_driver_id"]: d["id"] for d in interstate}

    # Load truck reference data for strategy 3 (vehicle → truck → job → driver)
    by_unit_raw, by_unit_num, by_vin, by_id_towbook = load_truck_maps()
    sam_vehicles = load_samsara_vehicle_info()
    db_resp = sb.table("drivers").select("id, name").execute()
    by_name: dict[str, int] = {}
    for r in (db_resp.data or []):
        if r.get("name"):
            for key in _name_forms(r["name"]):
                by_name.setdefault(key, r["id"])

    start_dt = datetime(BACKFILL_START.year, BACKFILL_START.month, BACKFILL_START.day, 0, 0, 0, tzinfo=EASTERN)
    end_dt   = datetime(BACKFILL_END.year,   BACKFILL_END.month,   BACKFILL_END.day, 23, 59, 59, tzinfo=EASTERN)

    schedule = load_vehicle_driver_schedule(interstate_sam_ids, start_dt, end_dt)

    # Fetch DVIRs from BACKFILL_START through now so DVIRs resolved after
    # BACKFILL_END (updatedAtTime > BACKFILL_END) are still captured.
    now_utc = datetime.now(tz=timezone.utc)
    print(f"  Fetching DVIRs {BACKFILL_START} → today …")
    all_dvirs = samsara_get("/dvirs/stream", {
        "startTime": utc_fmt(start_dt),
        "endTime":   utc_fmt(now_utc),
        "limit":     200,
    })
    print(f"  {len(all_dvirs)} total DVIRs fetched")

    # Resolve each DVIR to a driver.
    # Strategy 1: authorSignature.driverInfo.id on the DVIR itself (most reliable —
    #   bypasses assignment window timing gaps entirely).
    # Strategy 2: vehicle + timestamp within a driver-vehicle assignment window
    #   (fallback for DVIRs that don't carry a driverInfo field).
    # submitted_sam: resolved via Samsara driver ID (strategies 1 & 2)
    # submitted_int: resolved via TowBook vehicle→job lookup (strategy 3)
    submitted_sam: set[tuple[str, str]] = set()  # (samsara_driver_id, date_str)
    submitted_int: set[tuple[int, str]] = set()  # (internal_driver_id, date_str)
    no_vehicle    = 0
    direct_match  = 0
    window_match  = 0
    job_match     = 0
    unmatched_veh = 0
    for dvir in all_dvirs:
        veh_id = (dvir.get("vehicle") or {}).get("id")
        ts_raw = dvir.get("startTime") or dvir.get("updatedAtTime")
        if not ts_raw:
            no_vehicle += 1
            continue
        dvir_dt   = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
        dvir_ms   = int(dvir_dt.timestamp() * 1000)
        dvir_date = dvir_dt.astimezone(EASTERN).date()
        if not (BACKFILL_START <= dvir_date <= BACKFILL_END):
            continue

        driver_sam_id = None

        # Strategy 1: driver ID directly on the DVIR
        author    = dvir.get("authorSignature") or {}
        drv_info  = author.get("driverInfo") or dvir.get("driver") or {}
        direct_id = drv_info.get("id", "")
        if direct_id and direct_id in interstate_sam_ids:
            driver_sam_id = direct_id
            direct_match += 1

        # Strategy 2: assignment window
        if not driver_sam_id and veh_id:
            matched_drv = driver_at(schedule.get(veh_id, []), dvir_ms)
            if matched_drv:
                driver_sam_id = matched_drv
                window_match += 1

        if driver_sam_id:
            submitted_sam.add((driver_sam_id, dvir_date.isoformat()))
            continue

        # Strategy 3: vehicle → trucks table → jobs table → driver
        if veh_id:
            veh_name   = (sam_vehicles.get(veh_id) or {}).get("raw_name", "")
            truck_uuid = resolve_truck_id(veh_id, veh_name, sam_vehicles,
                                          by_unit_raw, by_unit_num, by_vin)
            internal_id = resolve_driver_from_job(truck_uuid, veh_name, dvir_date,
                                                   by_name, by_id_towbook)
            if internal_id and internal_id in interstate_internal_ids:
                submitted_int.add((internal_id, dvir_date.isoformat()))
                job_match += 1
            else:
                unmatched_veh += 1

    total_resolved = len(submitted_sam) + len(submitted_int)
    print(f"  {total_resolved} driver-day DVIRs resolved "
          f"({direct_match} via driver signature, {window_match} via assignment window, "
          f"{job_match} via vehicle→job lookup)")
    print(f"  {no_vehicle} DVIRs skipped (no timestamp), "
          f"{unmatched_veh} with vehicle but no match")

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

    # Never overwrite rows a safety manager has manually verified.
    overridden_resp = (
        sb.table("dvir_logs")
          .select("driver_id, log_date")
          .gte("log_date", BACKFILL_START.isoformat())
          .lte("log_date", BACKFILL_END.isoformat())
          .eq("manually_overridden", True)
          .execute()
    )
    overridden: set[tuple[int, str]] = {
        (r["driver_id"], r["log_date"]) for r in (overridden_resp.data or [])
    }
    if overridden:
        print(f"  Skipping {len(overridden)} manually-overridden rows")

    rows = []
    for drv in interstate:
        sam_id      = drv["samsara_driver_id"]
        internal_id = drv["id"]
        for target_date in date_range(BACKFILL_START, BACKFILL_END):
            day_str = target_date.isoformat()
            if (internal_id, day_str) not in drove_on:
                continue
            if (internal_id, day_str) in overridden:
                continue
            rows.append({
                "driver_id":          internal_id,
                "driver_name":        drv["name"],
                "log_date":           day_str,
                "completed":          (sam_id, day_str) in submitted_sam or (internal_id, day_str) in submitted_int,
                "manually_overridden": False,
                "source":             "samsara",
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
        internal_id = next((by_name[k] for k in _name_forms(raw) if k in by_name), None) if raw else None
        if internal_id:
            by_driver.setdefault(internal_id, []).append(ev["id"])

    patched = 0
    for driver_id, event_ids in by_driver.items():
        sb.table("safety_events").update({"driver_id": driver_id}).in_("id", event_ids).execute()
        patched += len(event_ids)
    return patched


def dry_run_compare():
    """
    Recompute Samsara mileage with the new per-trip lookup and print a per-driver
    comparison against what's currently in mileage_logs (source='samsara').
    Does NOT write to the database. Used when DRY_RUN=1.
    """
    print(f"\n── DRY RUN: per-trip lookup vs current mileage_logs ──")
    print(f"   Period: {BACKFILL_START} → {BACKFILL_END}")
    print(f"   No database writes will occur.\n")

    interstate = load_interstate_drivers()
    if not interstate:
        print("  No interstate drivers with samsara_driver_id — nothing to compare.")
        return

    id_map   = {d["samsara_driver_id"]: d["id"] for d in interstate}
    name_map = {d["id"]: d["name"] for d in interstate}
    sam_ids  = set(id_map.keys())

    start_dt = datetime(BACKFILL_START.year, BACKFILL_START.month, BACKFILL_START.day,
                        0, 0, 0, tzinfo=EASTERN)
    end_dt   = datetime(BACKFILL_END.year,   BACKFILL_END.month,   BACKFILL_END.day,
                        23, 59, 59, tzinfo=EASTERN)

    print(f"  Loading vehicle-driver schedule for {len(sam_ids)} drivers …")
    schedule = load_vehicle_driver_schedule(sam_ids, start_dt, end_dt)
    print(f"  Schedule covers {len(schedule)} vehicle(s) "
          f"({sum(len(v) for v in schedule.values())} un-merged assignment records)\n")

    new_miles:   dict[tuple[int, str], float] = {}
    ghost_miles: dict[str, float]             = {}
    trip_count  = 0
    ghost_count = 0
    failed      = 0

    for veh_idx, (veh_id, entries) in enumerate(schedule.items(), 1):
        veh_trips = 0
        print(f"  [{veh_idx}/{len(schedule)}] vehicle {veh_id} "
              f"({len(entries)} assignment(s)) …", flush=True)
        for chunk_start_ms, chunk_end_ms in _dt_month_ranges(start_dt, end_dt):
            try:
                trips = samsara_get_v1_trips_for_vehicle(veh_id, chunk_start_ms, chunk_end_ms)
            except Exception:
                failed += 1
                continue
            veh_trips += len(trips)
            for trip in trips:
                trip_ms = trip.get("startMs") or 0
                if not trip_ms:
                    continue
                miles = (float(trip["distanceMiles"]) if trip.get("distanceMiles") is not None
                         else float(trip.get("distanceMeters") or 0) / 1609.344)
                if miles <= 0:
                    continue
                trip_date = datetime.fromtimestamp(trip_ms / 1000, tz=EASTERN).date()
                day_str   = trip_date.isoformat()
                drv_sam_id = driver_at(entries, trip_ms)
                if drv_sam_id and drv_sam_id in id_map:
                    new_miles[(id_map[drv_sam_id], day_str)] = (
                        new_miles.get((id_map[drv_sam_id], day_str), 0.0) + miles
                    )
                    trip_count += 1
                else:
                    ghost_miles[day_str] = ghost_miles.get(day_str, 0.0) + miles
                    ghost_count += 1
        print(f"    → {veh_trips} trips fetched", flush=True)

    if failed:
        print(f"\n  WARNING: {failed} trip fetches failed")
    print(f"\n  Attributed: {trip_count} trips → {len(new_miles)} driver-days")
    print(f"  Ghost     : {ghost_count} trips → {sum(ghost_miles.values()):,.0f} mi "
          f"across {len(ghost_miles)} day(s) (no linked driver logged in)")

    print(f"\n  Loading current mileage_logs (source='samsara') for comparison …")
    ml_resp = (
        sb.table("mileage_logs")
          .select("driver_id, log_date, miles")
          .eq("source", "samsara")
          .gte("log_date", BACKFILL_START.isoformat())
          .lte("log_date", BACKFILL_END.isoformat())
          .in_("driver_id", list(name_map.keys()))
          .execute()
    )
    old_miles: dict[tuple[int, str], float] = {
        (r["driver_id"], r["log_date"]): float(r["miles"])
        for r in (ml_resp.data or [])
    }

    per_driver_old: dict[int, float] = {}
    per_driver_new: dict[int, float] = {}
    for (did, _), m in old_miles.items():
        per_driver_old[did] = per_driver_old.get(did, 0.0) + m
    for (did, _), m in new_miles.items():
        per_driver_new[did] = per_driver_new.get(did, 0.0) + m

    all_drivers = sorted(
        set(per_driver_old) | set(per_driver_new),
        key=lambda d: -(per_driver_old.get(d, 0.0) + per_driver_new.get(d, 0.0)),
    )

    print(f"\n  {'Driver':<28}  {'Old':>10}  {'New':>10}  {'Δ':>10}  Note")
    print(f"  {'-'*28}  {'-'*10}  {'-'*10}  {'-'*10}")
    grand_old = 0.0
    grand_new = 0.0
    for did in all_drivers:
        name = (name_map.get(did) or f"id={did}")[:28]
        o = per_driver_old.get(did, 0.0)
        n = per_driver_new.get(did, 0.0)
        delta = n - o
        grand_old += o
        grand_new += n
        if o == 0 and n > 0:
            note = "new-only"
        elif o > 0 and n == 0:
            note = "old-only"
        elif o > 0 and abs(delta) > 10:
            note = f"{n/o:.2f}x"
        else:
            note = ""
        print(f"  {name:<28}  {o:>10.1f}  {n:>10.1f}  {delta:>+10.1f}  {note}")
    print(f"  {'-'*28}  {'-'*10}  {'-'*10}  {'-'*10}")
    print(f"  {'TOTAL':<28}  {grand_old:>10.1f}  {grand_new:>10.1f}  "
          f"{grand_new - grand_old:>+10.1f}")
    if grand_old > 0:
        print(f"\n  Fleet ratio new/old: {grand_new / grand_old:.2f}x")
    print(f"\n  No database writes occurred.\n")


def main():
    if DRY_RUN:
        dry_run_compare()
        return

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

    backfill_mileage(by_name, sam_vehicles, by_unit_raw, by_unit_num, by_vin, by_id_towbook)

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
