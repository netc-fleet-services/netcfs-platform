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
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def to_ms(dt: datetime) -> int:
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

def load_driver_vehicle_assignments(
    sam_driver_ids: set[str],
    start_dt:       datetime,
    end_dt:         datetime,
) -> dict[str, list[tuple[str, int, int]]]:
    """
    Returns {samsara_driver_id: [(vehicle_id, start_ms, end_ms), ...]}
    Uses /fleet/driver-vehicle-assignments with filterBy=drivers.
    Handles driver rotation — each assignment records which truck a driver used and when.
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

    # Load all internal drivers — indexed by exact lowercase AND normalized name
    db_resp = sb.table("drivers").select("id, name, samsara_driver_id").execute()
    db_by_name: dict[str, dict] = {}
    for r in (db_resp.data or []):
        if r.get("name"):
            for key in _name_forms(r["name"]):
                db_by_name.setdefault(key, r)
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

        # Try exact then normalized name match to auto-link
        match = next((db_by_name[k] for k in _name_forms(sam_name) if k in db_by_name), None)
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

# ── 2. Job driver linking ──────────────────────────────────────────────────────

def link_job_drivers(by_name: dict[str, int]) -> int:
    """
    Resolve tb_driver name strings to driver_id FKs in the jobs table and write
    them back persistently. This means safety event and mileage lookups find a
    proper FK instead of relying on name-string matching at query time.
    Only updates rows where driver_id is currently null.
    """
    resp = (sb.table("jobs")
              .select("id, tb_driver")
              .is_("driver_id", "null")
              .not_.is_("tb_driver", "null")
              .execute())
    jobs = resp.data or []
    if not jobs:
        return 0

    by_driver: dict[int, list[str]] = {}
    unmatched: set[str] = set()
    for job in jobs:
        raw = (job.get("tb_driver") or "").strip()
        if not raw:
            continue
        driver_id = next((by_name[k] for k in _name_forms(raw) if k in by_name), None)
        if driver_id:
            by_driver.setdefault(driver_id, []).append(job["id"])
        else:
            unmatched.add(raw)

    updated = 0
    for driver_id, job_ids in by_driver.items():
        for i in range(0, len(job_ids), 200):
            sb.table("jobs").update({"driver_id": driver_id}).in_("id", job_ids[i:i+200]).execute()
        updated += len(job_ids)

    if unmatched:
        sample = sorted(unmatched)[:10]
        print(f"  {len(unmatched)} unique tb_driver names not matched to drivers table:")
        for n in sample:
            print(f"    {n!r}")

    return updated


# ── 3. Mileage sync ────────────────────────────────────────────────────────────

def mileage_from_jobs(
    target_date: date,
    by_name:     dict[str, int],
    skip_pairs:  set[tuple[int, str]],
    route_cache: dict[str, float],
) -> int:
    """
    Calculate total daily trip miles for target_date from TowBook jobs.
    Uses full round-trip distance (yard→pickup→drop→yard) to match the transport
    app's mileage methodology. Looks up route_cache for exact road miles when
    the transport app has already computed the route; falls back to haversine × 1.25.
    Covers all driver-days Samsara GPS doesn't provide.
    Returns number of driver-days upserted.
    """
    day_str = target_date.isoformat()
    resp = (
        sb.table("jobs")
          .select("driver_id, tb_driver, yard_id, pickup_lat, pickup_lon, drop_lat, drop_lon")
          .eq("day", day_str)
          .not_.is_("pickup_lat", "null")
          .not_.is_("drop_lat",   "null")
          .execute()
    )
    jobs = resp.data or []
    if not jobs:
        return 0

    miles_map: dict[int, float] = {}
    valid_driver_ids = set(by_name.values())
    unmatched_tb: dict[str, int] = {}
    for job in jobs:
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
            continue
        key = (int(driver_id), day_str)
        if key in skip_pairs:
            continue
        try:
            p_lat = float(job["pickup_lat"])
            p_lon = float(job["pickup_lon"])
            d_lat = float(job["drop_lat"])
            d_lon = float(job["drop_lon"])
        except (TypeError, ValueError):
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
        miles_map[int(driver_id)] = miles_map.get(int(driver_id), 0.0) + dist

    if unmatched_tb:
        print(f"  → {sum(unmatched_tb.values())} jobs skipped — unmatched tb_driver names ({len(unmatched_tb)} unique):")
        for name, cnt in sorted(unmatched_tb.items(), key=lambda x: -x[1])[:10]:
            print(f"      {name!r} ({cnt} jobs)")

    if not miles_map:
        return 0

    rows = [
        {"driver_id": did, "driver_name": None, "log_date": day_str,
         "miles": round(m, 2), "source": "towbook_estimate"}
        for did, m in miles_map.items()
    ]
    sb.table("mileage_logs").upsert(rows, on_conflict="driver_id,log_date").execute()
    return len(rows)


def sync_mileage(target_date: date, by_name: dict[str, int]):
    """
    Pull GPS trips for linked drivers via driver-vehicle assignments (handles truck rotation).
    TowBook haversine fills all remaining driver-days.
    """
    print(f"\n── Mileage sync for {target_date} ──")

    day_start = datetime(target_date.year, target_date.month, target_date.day,
                         0, 0, 0, tzinfo=EASTERN)
    day_end   = day_start + timedelta(days=1)
    day_str   = target_date.isoformat()

    resp = sb.table("drivers") \
             .select("id, samsara_driver_id") \
             .not_.is_("samsara_driver_id", "null") \
             .execute()
    linked = resp.data or []
    id_map = {r["samsara_driver_id"]: r["id"] for r in linked}

    miles_map: dict[tuple[int, str], float] = {}
    matched = 0

    if id_map:
        assignments = load_driver_vehicle_assignments(set(id_map.keys()), day_start, day_end)
        if assignments:
            print(f"  Assignments found for {len(assignments)} of {len(id_map)} linked drivers")
        for sam_id, drv_assignments in assignments.items():
            internal_id = id_map[sam_id]
            for veh_id, a_start_ms, a_end_ms in drv_assignments:
                try:
                    trips = samsara_get_v1_trips_for_vehicle(veh_id, a_start_ms, a_end_ms)
                except Exception:
                    continue
                for trip in trips:
                    miles = (float(trip["distanceMiles"]) if trip.get("distanceMiles") is not None
                             else float(trip.get("distanceMeters") or 0) / 1609.344)
                    if miles <= 0:
                        continue
                    matched += 1
                    key = (internal_id, day_str)
                    miles_map[key] = miles_map.get(key, 0.0) + miles

    samsara_pairs: set[tuple[int, str]] = set()
    if miles_map:
        print(f"  {matched} trips → {len(miles_map)} driver-days from Samsara GPS")
        rows = [
            {"driver_id": did, "driver_name": None, "log_date": ds,
             "miles": round(m, 2), "source": "samsara"}
            for (did, ds), m in miles_map.items()
        ]
        sb.table("mileage_logs").upsert(rows, on_conflict="driver_id,log_date").execute()
        samsara_pairs = {(r["driver_id"], r["log_date"]) for r in rows}

    route_cache = load_route_cache()
    tb_count = mileage_from_jobs(target_date, by_name, samsara_pairs, route_cache)
    if tb_count:
        print(f"  TowBook upserted {tb_count} additional driver-days")

# ── 4. DVIR sync ───────────────────────────────────────────────────────────────

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
             .ilike("yard", "interstate") \
             .not_.is_("samsara_driver_id", "null") \
             .execute()
    interstate = resp.data or []

    if not interstate:
        print("  No linked Interstate drivers found — skipping")
        return

    interstate_sam_ids = {d["samsara_driver_id"] for d in interstate}

    day_start = datetime(target_date.year, target_date.month, target_date.day,
                         0, 0, 0, tzinfo=EASTERN)
    day_end   = day_start + timedelta(days=1)

    # Build reverse mapping for assignment-window fallback.
    assignments = load_driver_vehicle_assignments(interstate_sam_ids, day_start, day_end)
    veh_to_driver: dict[str, list[tuple[str, int, int]]] = {}
    for drv_sam_id, drv_assignments in assignments.items():
        for (veh_id, a_start_ms, a_end_ms) in drv_assignments:
            veh_to_driver.setdefault(veh_id, []).append((drv_sam_id, a_start_ms, a_end_ms))

    # Query through now so DVIRs submitted yesterday but resolved today are captured.
    now_utc = datetime.now(tz=timezone.utc)
    all_dvirs = samsara_get("/dvirs/stream", {
        "startTime": utc_fmt(day_start),
        "endTime":   utc_fmt(now_utc),
        "limit":     200,
    })

    # Resolve each DVIR to a driver.
    # Strategy 1: authorSignature.driverInfo.id on the DVIR itself (most reliable —
    #   bypasses assignment window timing gaps entirely).
    # Strategy 2: vehicle + timestamp within a driver-vehicle assignment window
    #   (fallback for DVIRs that don't carry a driverInfo field).
    submitted: set[str] = set()  # driver_sam_ids that submitted on target_date
    direct_match  = 0
    window_match  = 0
    unmatched_veh = 0
    for dvir in all_dvirs:
        veh_id = (dvir.get("vehicle") or {}).get("id")
        ts_raw = dvir.get("startTime") or dvir.get("updatedAtTime")
        if not ts_raw:
            continue
        dvir_dt   = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
        dvir_ms   = int(dvir_dt.timestamp() * 1000)
        dvir_date = dvir_dt.astimezone(EASTERN).date()
        if dvir_date != target_date:
            continue

        driver_sam_id = None

        # Strategy 1: driver ID directly on the DVIR
        author     = dvir.get("authorSignature") or {}
        drv_info   = author.get("driverInfo") or dvir.get("driver") or {}
        direct_id  = drv_info.get("id", "")
        if direct_id and direct_id in interstate_sam_ids:
            driver_sam_id = direct_id
            direct_match += 1

        # Strategy 2: assignment window (only if strategy 1 failed and we have a vehicle)
        if not driver_sam_id and veh_id:
            for (drv_id, a_start_ms, a_end_ms) in veh_to_driver.get(veh_id, []):
                if a_start_ms <= dvir_ms <= a_end_ms:
                    driver_sam_id = drv_id
                    window_match += 1
                    break

        if driver_sam_id:
            submitted.add(driver_sam_id)
        else:
            unmatched_veh += 1
    print(f"  {len(all_dvirs)} total DVIRs fetched, {len(submitted)} Interstate drivers confirmed on {target_date}")
    print(f"  Matched: {direct_match} via driver signature, {window_match} via assignment window, {unmatched_veh} unmatched")

    # Load mileage_logs to determine who actually drove today
    # (don't penalise drivers who were off)
    ml_resp = sb.table("mileage_logs") \
                .select("driver_id") \
                .eq("log_date", target_date.isoformat()) \
                .gt("miles", 0) \
                .execute()
    drove_ids = {r["driver_id"] for r in (ml_resp.data or [])}

    # Never overwrite rows a safety manager has manually verified.
    overridden_resp = sb.table("dvir_logs") \
                       .select("driver_id") \
                       .eq("log_date", target_date.isoformat()) \
                       .eq("manually_overridden", True) \
                       .execute()
    overridden_ids = {r["driver_id"] for r in (overridden_resp.data or [])}

    rows = []
    for drv in interstate:
        sam_id      = drv["samsara_driver_id"]
        internal_id = drv["id"]

        if internal_id not in drove_ids:
            continue
        if internal_id in overridden_ids:
            continue

        rows.append({
            "driver_id":           internal_id,
            "driver_name":         drv["name"],
            "log_date":            target_date.isoformat(),
            "completed":           sam_id in submitted,
            "manually_overridden": False,
            "source":              "samsara",
        })

    if rows:
        sb.table("dvir_logs").upsert(rows, on_conflict="driver_id,log_date").execute()
        completed_count = sum(1 for r in rows if r["completed"])
        print(f"  Logged {len(rows)} drivers — {completed_count} completed, "
              f"{len(rows) - completed_count} missed")
    else:
        print("  No Interstate drivers drove today — nothing to log")


# ── Retroactive event patch ────────────────────────────────────────────────────

def patch_unlinked_event_drivers(by_name: dict[str, int]) -> int:
    """
    Fill driver_id on events that were stored with driver_id=NULL but whose
    driver_name now resolves to a known driver. Called after sync_drivers() so
    newly linked Samsara accounts immediately credit their historical events.
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


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    yesterday = (datetime.now(EASTERN) - timedelta(days=1)).date()

    sync_drivers()

    db_resp = sb.table("drivers").select("id, name").execute()
    by_name: dict[str, int] = {}
    for r in (db_resp.data or []):
        if r.get("name"):
            for key in _name_forms(r["name"]):
                by_name.setdefault(key, r["id"])

    print("\n── Job driver linking ──")
    linked_jobs = link_job_drivers(by_name)
    if linked_jobs:
        print(f"  Linked driver_id on {linked_jobs} jobs with previously null FK")
    else:
        print("  No unlinked jobs with resolvable tb_driver names")

    patched = patch_unlinked_event_drivers(by_name)
    if patched:
        print(f"\nRetroactively linked driver_id on {patched} previously unmatched events")

    sync_mileage(yesterday, by_name)
    sync_dvirs(yesterday)

    print("\nDaily Samsara sync complete.")


if __name__ == "__main__":
    main()
