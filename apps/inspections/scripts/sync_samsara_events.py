"""
Samsara → Supabase Safety Events Sync
Runs every 15 minutes via GitHub Actions.

Always re-fetches the last 72 hours so that coaching status changes
(needsReview → coached/dismissed) are captured even when they happen
after the event was first ingested.

Driver resolution strategy:
  1. Interstate drivers: matched via samsara_driver_id on the drivers table
     (Samsara assigns drivers to vehicles; driver appears on event directly).
  2. Non-interstate drivers: Samsara only records the vehicle, not the driver.
     We resolve by matching vehicle → trucks table (unit_number or VIN) →
     jobs table (truck + date) → drivers table (driver_id FK or tb_driver name).

Required env vars:
  SAMSARA_API_KEY      — Samsara API token
  SUPABASE_URL         — Supabase project URL
  SUPABASE_SERVICE_KEY — Service role key (bypasses RLS)
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

BASE_URL = "https://api.samsara.com"

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

def utc_fmt(dt: datetime) -> str:
    """Convert any tz-aware datetime to UTC RFC3339 with Z suffix (Samsara requirement)."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# ── Severity point mapping ─────────────────────────────────────────────────────

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

def _get_event_time(ev: dict) -> str | None:
    return (ev.get("createdAtTime")
            or ev.get("time")
            or ev.get("occurredAtTime"))

def _get_event_type(ev: dict) -> str:
    labels = ev.get("behaviorLabels") or []
    if labels and isinstance(labels[0], dict):
        label = labels[0].get("label", "")
        if label:
            return label[0].lower() + label[1:]
    return (ev.get("type") or ev.get("behaviorType") or ev.get("eventType") or "unknown")

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

# ── Unit matching helpers ──────────────────────────────────────────────────────

def leading_number(s: str) -> str:
    """Extract the first run of digits: '#1023 Peterbilt Ramp' → '1023'."""
    m = re.search(r'\d+', s or '')
    return m.group(0) if m else ''

# ── Driver maps ────────────────────────────────────────────────────────────────

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

# ── Truck maps ─────────────────────────────────────────────────────────────────

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

# ── Samsara vehicle info ───────────────────────────────────────────────────────

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
        print("  VIN-based truck matching unavailable; unit number matching still active.")
        return {}
    result: dict[str, dict] = {}
    for v in vehicles:
        result[v["id"]] = {
            "raw_name": (v.get("name") or "").strip(),
            "vin":      extract_vin_from_vehicle(v),
        }
    return result

# ── Vehicle → driver resolution via jobs table ─────────────────────────────────

def resolve_truck_id(
    sam_vehicle_id: str,
    sam_unit_name:  str,
    sam_vehicles:   dict[str, dict],
    by_unit_raw:    dict[str, str],
    by_unit_num:    dict[str, str],
    by_vin:         dict[str, str],
) -> str | None:
    """
    Match a Samsara asset to a trucks table UUID.
    1. Raw case-insensitive match on the asset name from the event.
    2. Leading-number match (e.g. '#1023 Peterbilt Ramp' → '1023').
    3. Same two passes using the asset name from the Samsara vehicles list.
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

    result = _try(sam_unit_name)
    if result:
        return result

    veh_info = sam_vehicles.get(sam_vehicle_id, {})
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
    truck_uuid:  str | None,
    sam_unit:    str,
    event_date:  date,
    by_name:     dict[str, int],
) -> int | None:
    """
    Look up the driver for a given truck + date from the jobs table.
    Strategy 1: match by truck_id FK (fast, exact).
    Strategy 2: match by truck_and_equipment ILIKE the unit leading number
                (handles jobs where truck_id is not populated).
    """
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

# ── Main sync ──────────────────────────────────────────────────────────────────

def sync_events():
    now   = datetime.now(timezone.utc)
    start = now - timedelta(hours=72)

    print(f"Fetching safety events {utc_fmt(start)} → {utc_fmt(now)} …")

    events = samsara_get("/safety-events/stream", {
        "startTime":     utc_fmt(start),
        "endTime":       utc_fmt(now),
        "eventStates":   "coached",
        "includeDriver": "true",
        "includeAsset":  "true",
        "limit":         512,
    })
    print(f"  Retrieved {len(events)} events from Samsara")

    if not events:
        print("Nothing to upsert.")
        return

    by_sam_id, by_name               = load_driver_maps()
    by_unit_raw, by_unit_num, by_vin = load_truck_maps()
    sam_vehicles                     = load_samsara_vehicle_info()
    print(f"  Loaded {len(by_sam_id)} linked drivers, {len(by_unit_raw)} trucks by unit, {len(by_vin)} trucks by VIN, {len(sam_vehicles)} Samsara vehicles")

    unmatched_drivers:  set[str] = set()
    unmatched_assets:   set[str] = set()
    vehicle_resolved:   int = 0
    vehicle_unresolved: int = 0

    rows = []
    for ev in events:
        driver_info  = ev.get("driver", {}) or {}
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
            continue

        # ── Resolve driver ──────────────────────────────────────────────────
        internal_id: int | None = None

        if sam_drv_id:
            # Interstate path: Samsara assigned a driver to the vehicle
            internal_id = by_sam_id.get(sam_drv_id)
            if not internal_id:
                unmatched_drivers.add(f"{driver_info.get('name', '?')} ({sam_drv_id})")
        elif sam_veh_id or sam_unit:
            # Non-interstate path: resolve via truck → job → driver
            # truck_and_equipment fallback means we try even if truck_id FK is missing
            truck_uuid = resolve_truck_id(sam_veh_id, sam_unit, sam_vehicles, by_unit_raw, by_unit_num, by_vin)
            event_date = datetime.fromisoformat(occurred_at.replace("Z", "+00:00")).astimezone(EASTERN).date()
            internal_id = resolve_driver_from_job(truck_uuid, sam_unit, event_date, by_name)
            if internal_id:
                vehicle_resolved += 1
            else:
                vehicle_unresolved += 1
                if sam_unit:
                    unmatched_assets.add(sam_unit)

        rows.append({
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
        })

    sb.table("safety_events").upsert(rows, on_conflict="samsara_event_id").execute()
    print(f"  Upserted {len(rows)} events")

    if vehicle_resolved or vehicle_unresolved:
        print(f"  Non-interstate vehicle resolution: {vehicle_resolved} matched, {vehicle_unresolved} unmatched")
    if unmatched_assets:
        print(f"  Asset names that did not match any truck ({len(unmatched_assets)}):")
        for name in sorted(unmatched_assets):
            print(f"    {name!r}  (leading number: {leading_number(name)!r})")

    if unmatched_drivers:
        print(f"  WARNING — {len(unmatched_drivers)} Samsara drivers not linked to internal drivers table:")
        for d in sorted(unmatched_drivers):
            print(f"    {d}")


if __name__ == "__main__":
    sync_events()
    print("Samsara events sync complete.")
