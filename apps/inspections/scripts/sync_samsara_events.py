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

# ── API helper ─────────────────────────────────────────────────────────────────

def samsara_get(path: str, params: dict) -> list[dict]:
    headers = {"Authorization": f"Token {SAMSARA_API_KEY}"}
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

# ── Unit number normalisation ──────────────────────────────────────────────────

def normalize_unit(s: str) -> str:
    """Strip non-alphanumeric characters and lowercase for fuzzy unit matching."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

# ── Driver maps ────────────────────────────────────────────────────────────────

def load_driver_maps() -> tuple[dict[str, int], dict[str, int]]:
    """
    Returns:
      by_sam_id  — {samsara_driver_id: internal_id}  (interstate drivers)
      by_name    — {name.lower(): internal_id}        (fallback for all drivers)
    """
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

def load_truck_maps() -> tuple[dict[str, str], dict[str, str]]:
    """
    Returns:
      by_unit — {normalized_unit_number: truck_uuid}
      by_vin  — {vin_upper: truck_uuid}
    """
    resp = sb.table("trucks").select("id, unit_number, vin").execute()
    by_unit: dict[str, str] = {}
    by_vin:  dict[str, str] = {}
    for t in (resp.data or []):
        unit = normalize_unit(t.get("unit_number") or "")
        if unit:
            by_unit[unit] = t["id"]
        vin = (t.get("vin") or "").strip().upper()
        if len(vin) >= 10:  # VINs are 17 chars; skip obviously wrong values
            by_vin[vin] = t["id"]
    return by_unit, by_vin

# ── Samsara vehicle info ───────────────────────────────────────────────────────

def extract_vin_from_vehicle(v: dict) -> str:
    """Try several places Samsara might store the VIN."""
    ext = v.get("externalIds") or {}
    if isinstance(ext, dict):
        for key, val in ext.items():
            if "vin" in key.lower() and val:
                return val.strip().upper()
    return (v.get("vin") or v.get("serial") or "").strip().upper()

def load_samsara_vehicle_info() -> dict[str, dict]:
    """
    Returns {samsara_vehicle_id: {normalized_unit: str, vin: str}}
    Used to resolve VIN when the safety event only carries the vehicle ID.
    """
    vehicles = samsara_get("/fleet/vehicles", {"limit": 512})
    result: dict[str, dict] = {}
    for v in vehicles:
        result[v["id"]] = {
            "normalized_unit": normalize_unit(v.get("name") or ""),
            "vin":             extract_vin_from_vehicle(v),
        }
    return result

# ── Vehicle → driver resolution via jobs table ─────────────────────────────────

def resolve_truck_id(
    sam_vehicle_id: str,
    sam_unit_name:  str,
    sam_vehicles:   dict[str, dict],
    by_unit:        dict[str, str],
    by_vin:         dict[str, str],
) -> str | None:
    """
    Match a Samsara vehicle to a trucks table UUID.
    Strategy: normalize unit number first; fall back to VIN.
    """
    # Try unit number from the event payload first
    norm_event_unit = normalize_unit(sam_unit_name)
    if norm_event_unit and norm_event_unit in by_unit:
        return by_unit[norm_event_unit]

    # Try data from the Samsara vehicles list
    veh_info = sam_vehicles.get(sam_vehicle_id, {})

    norm_veh_unit = veh_info.get("normalized_unit", "")
    if norm_veh_unit and norm_veh_unit in by_unit:
        return by_unit[norm_veh_unit]

    veh_vin = veh_info.get("vin", "")
    if veh_vin and veh_vin in by_vin:
        return by_vin[veh_vin]

    return None

def resolve_driver_from_job(
    truck_uuid: str,
    event_date: date,
    by_name:    dict[str, int],
) -> int | None:
    """
    Query the jobs table for a job on truck_uuid on event_date.
    Returns internal driver_id if found, else None.
    """
    day_str = event_date.isoformat()
    # Jobs use pickup_time as a timestamp; query the full day.
    # pickup_time is stored in local (Eastern) time from TowBook, so we use
    # a generous 48-hour window to avoid missing late-evening jobs at UTC boundaries.
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

    # Prefer the FK driver_id if it's already linked
    if job.get("driver_id"):
        return int(job["driver_id"])

    # Fall back to matching tb_driver (TowBook name) against drivers.name
    tb_name = (job.get("tb_driver") or "").strip().lower()
    if tb_name:
        return by_name.get(tb_name)

    return None

# ── Main sync ──────────────────────────────────────────────────────────────────

def sync_events():
    now   = datetime.now(timezone.utc)
    start = now - timedelta(hours=72)

    print(f"Fetching safety events {start.isoformat()} → {now.isoformat()} …")

    events = samsara_get("/safety/events", {
        "startTime": start.isoformat(),
        "endTime":   now.isoformat(),
        "limit":     512,
    })
    print(f"  Retrieved {len(events)} events from Samsara")

    if not events:
        print("Nothing to upsert.")
        return

    by_sam_id, by_name = load_driver_maps()
    by_unit, by_vin    = load_truck_maps()
    sam_vehicles       = load_samsara_vehicle_info()
    print(f"  Loaded {len(by_sam_id)} linked drivers, {len(by_unit)} trucks by unit, {len(by_vin)} trucks by VIN, {len(sam_vehicles)} Samsara vehicles")

    unmatched_drivers:  set[str] = set()
    vehicle_resolved:   int = 0
    vehicle_unresolved: int = 0

    rows = []
    for ev in events:
        driver_info  = ev.get("driver",  {}) or {}
        vehicle_info = ev.get("vehicle", {}) or {}
        event_type   = ev.get("type", "unknown")
        max_speed    = ev.get("maxSpeedMph") or ev.get("maxSpeed")
        speed_limit  = ev.get("speedLimitMph") or ev.get("speedLimit")
        coaching     = ev.get("coachingState", "")
        sam_drv_id   = driver_info.get("id", "")
        sam_veh_id   = vehicle_info.get("id", "")
        sam_unit     = vehicle_info.get("name", "")

        # ── Resolve driver ──────────────────────────────────────────────────
        internal_id: int | None = None

        if sam_drv_id:
            # Interstate path: Samsara assigned a driver to the vehicle
            internal_id = by_sam_id.get(sam_drv_id)
            if not internal_id:
                unmatched_drivers.add(f"{driver_info.get('name', '?')} ({sam_drv_id})")
        elif sam_veh_id:
            # Non-interstate path: resolve via truck → job → driver
            truck_uuid = resolve_truck_id(sam_veh_id, sam_unit, sam_vehicles, by_unit, by_vin)
            if truck_uuid:
                event_date = datetime.fromisoformat(ev["time"].replace("Z", "+00:00")).astimezone(EASTERN).date()
                internal_id = resolve_driver_from_job(truck_uuid, event_date, by_name)
                if internal_id:
                    vehicle_resolved += 1
                else:
                    vehicle_unresolved += 1
            else:
                vehicle_unresolved += 1

        rows.append({
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
        })

    sb.table("safety_events").upsert(rows, on_conflict="samsara_event_id").execute()
    print(f"  Upserted {len(rows)} events")

    if vehicle_resolved or vehicle_unresolved:
        print(f"  Non-interstate vehicle resolution: {vehicle_resolved} matched, {vehicle_unresolved} unmatched")

    if unmatched_drivers:
        print(f"  WARNING — {len(unmatched_drivers)} Samsara drivers not linked to internal drivers table:")
        for d in sorted(unmatched_drivers):
            print(f"    {d}")


if __name__ == "__main__":
    sync_events()
    print("Samsara events sync complete.")
