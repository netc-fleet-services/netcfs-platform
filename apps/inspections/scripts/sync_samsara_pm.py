"""
Samsara → Supabase PM Sync
Runs daily via GitHub Actions.

For each active truck linked to Samsara, pulls the current odometer (km)
and engine hours (ms) from the Samsara Readings API and writes them into
truck_pm_assignments so the fleet UI can show miles/days remaining per
PM schedule.

Also performs one-time vehicle matching: for trucks not yet linked to a
Samsara vehicle ID, falls back to regex extraction from the vehicle name
and auto-saves the matched ID.

Required env vars:
  SAMSARA_API_KEY      — API token with "Read Vehicles" + "Read Readings"
  SUPABASE_URL         — Supabase project URL
  SUPABASE_SERVICE_KEY — Service role key (bypasses RLS)
"""

import os, re
from datetime import datetime, timezone
import requests
from supabase import create_client

SAMSARA_API_KEY = os.environ["SAMSARA_API_KEY"].strip()
SUPABASE_URL    = os.environ["SUPABASE_URL"].strip()
SUPABASE_KEY    = os.environ["SUPABASE_SERVICE_KEY"].strip()

BASE_URL = "https://api.samsara.com"

sb = create_client(SUPABASE_URL, SUPABASE_KEY)


def samsara_get(path: str, params: dict) -> list[dict]:
    """Paginated GET from Samsara API."""
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
    return s.strip().lower()


def sync_pm():
    print("\n── Samsara PM Sync ──")

    # Load active trucks
    trucks_resp = sb.table("trucks").select("id, unit_number, samsara_vehicle_id").eq("active", True).execute()
    trucks = trucks_resp.data or []

    truck_by_sam_id: dict[str, str] = {}
    truck_by_unit:   dict[str, dict] = {}
    for t in trucks:
        if t.get("samsara_vehicle_id"):
            truck_by_sam_id[t["samsara_vehicle_id"]] = t["id"]
        if t.get("unit_number"):
            truck_by_unit[normalize_unit(t["unit_number"])] = t
    print(f"  {len(trucks)} active trucks — {len(truck_by_sam_id)} already linked to Samsara")

    # ── Vehicle matching (links new trucks to their Samsara ID) ──────────────
    print("  Fetching Samsara vehicles...")
    vehicles = samsara_get("/fleet/vehicles", {"limit": 512})

    asset_to_truck: dict[str, str] = {}
    newly_linked = 0
    unmatched: list[str] = []

    for v in vehicles:
        asset_id = v.get("id", "")
        name     = (v.get("name") or "").strip()

        if asset_id in truck_by_sam_id:
            asset_to_truck[asset_id] = truck_by_sam_id[asset_id]
            continue

        extracted = extract_unit(name)
        truck_row = truck_by_unit.get(normalize_unit(extracted)) if extracted else None
        if truck_row:
            truck_id = truck_row["id"]
            asset_to_truck[asset_id] = truck_id
            sb.table("trucks").update({"samsara_vehicle_id": asset_id}).eq("id", truck_id).execute()
            newly_linked += 1
            print(f"    linked: {name!r} → unit {extracted} (saved samsara_vehicle_id)")
        else:
            unmatched.append(f"{name!r}" + (f" (extracted: {extracted!r})" if extracted else " (no unit extracted)"))

    print(f"  {len(asset_to_truck)} of {len(vehicles)} Samsara vehicles matched"
          + (f" ({newly_linked} newly linked)" if newly_linked else ""))
    if unmatched:
        print(f"  {len(unmatched)} not matched:")
        for u in unmatched[:20]:
            print(f"    {u}")

    if not asset_to_truck:
        print("  No vehicle matches — aborting.")
        return

    # ── Check which trucks have PM assignments ───────────────────────────────
    assign_resp = sb.table("truck_pm_assignments").select("truck_id").execute()
    trucks_with_assignments = {r["truck_id"] for r in (assign_resp.data or [])}
    print(f"  {len(trucks_with_assignments)} trucks have PM assignments")

    if not trucks_with_assignments:
        print("  No PM assignments found — run seed_pm_assignments.py first.")
        return

    # ── Fetch current odometer from fleet vehicle stats ──────────────────────
    # Uses /fleet/vehicles/stats (covered by "Read Vehicles" permission).
    # Requests ECU odometer first; falls back to GPS odometer per vehicle.
    # Values are in meters — converted to miles.
    print("  Fetching vehicle odometer stats...")
    stats = samsara_get(
        "/fleet/vehicles/stats",
        {"types": "obdOdometerMeters,gpsOdometerMeters"},
    )
    print(f"  {len(stats)} vehicle stats fetched")

    # Build vehicle ID → odo_miles (prefer ECU, fall back to GPS)
    reading_by_sam_id: dict[str, dict] = {}
    for s in stats:
        vehicle_id = s.get("id", "")
        odo_m = (
            (s.get("obdOdometerMeters") or {}).get("value") or
            (s.get("gpsOdometerMeters") or {}).get("value")
        )
        odo_miles = round(odo_m / 1609.344) if odo_m is not None else None
        reading_by_sam_id[vehicle_id] = {"odo_miles": odo_miles, "hours": None}

    # ── Update current_odometer + current_hours per truck ───────────────────
    updated = 0
    no_reading = 0

    for asset_id, truck_id in asset_to_truck.items():
        if truck_id not in trucks_with_assignments:
            continue

        reading = reading_by_sam_id.get(asset_id)
        if not reading or (reading["odo_miles"] is None and reading["hours"] is None):
            no_reading += 1
            continue

        payload: dict = {}
        if reading["odo_miles"] is not None:
            payload["current_odometer"] = reading["odo_miles"]
        if reading["hours"] is not None:
            payload["current_hours"] = reading["hours"]

        sb.table("truck_pm_assignments").update(payload).eq("truck_id", truck_id).execute()
        updated += 1

    print(f"  {updated} trucks updated, {no_reading} had no readings")


def main():
    print(f"[{datetime.now(timezone.utc).isoformat()}Z] Starting Samsara PM sync")
    sync_pm()
    print("PM sync complete.")


if __name__ == "__main__":
    main()
