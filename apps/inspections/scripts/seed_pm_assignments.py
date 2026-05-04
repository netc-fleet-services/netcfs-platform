"""
Seed PM Assignments from Samsara CSV Export

Reads "Upcoming Preventive Maintenance Items.csv" exported from Samsara and
populates truck_pm_assignments in Supabase.

Usage:
  python seed_pm_assignments.py path/to/exported.csv

Expected CSV columns (case-insensitive):
  Asset           — Samsara vehicle name
  Maintenance Item — e.g. "B PM SERVICE Every: 10000 mi"
  Odometer        — current odometer reading (e.g. "234,512 mi")
  Engine Hours    — current engine hours (e.g. "1,234.5")
  Due In          — remaining until next PM (e.g. "1,500 mi", "45 days",
                    "Overdue 200 mi", "Overdue 10 days")

Required env vars:
  SUPABASE_URL
  SUPABASE_SERVICE_KEY
"""

import os, sys, re, csv
from datetime import datetime, date, timedelta

from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"].strip()
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"].strip()

sb = create_client(SUPABASE_URL, SUPABASE_KEY)
TODAY = date.today()


# ── Schedule name extraction ────────────────────────────────────────────────

def extract_schedule_name(maintenance_item: str) -> str:
    """Strip 'Every: X mi / X days / X hrs' suffix from maintenance item name."""
    return re.sub(r'\s+Every:.*$', '', maintenance_item, flags=re.IGNORECASE).strip()


# ── Value parsers ───────────────────────────────────────────────────────────

def parse_miles(s: str) -> int | None:
    """'234,512 mi' → 234512.  Returns None if not parseable."""
    if not s:
        return None
    m = re.search(r'([\d,]+)', s)
    if m:
        return int(m.group(1).replace(',', ''))
    return None


def parse_hours(s: str) -> float | None:
    """'1,234.5' or '1234' → 1234.5.  Returns None if not parseable."""
    if not s or s.strip().upper() in ('N/A', ''):
        return None
    m = re.search(r'([\d,]+\.?\d*)', s)
    if m:
        return float(m.group(1).replace(',', ''))
    return None


def parse_due_in(s: str) -> tuple[int | None, int | None]:
    """
    Returns (due_in_miles, due_in_days).  Negative means overdue.
    Examples:
      "1,500 mi"      → (1500, None)
      "45 days"       → (None, 45)
      "Overdue 200 mi"→ (-200, None)
      "Overdue 10 days"→(None, -10)
    """
    if not s:
        return None, None
    is_overdue = 'overdue' in s.lower()
    num_m = re.search(r'([\d,]+)', s)
    if not num_m:
        return None, None
    val = int(num_m.group(1).replace(',', ''))
    if is_overdue:
        val = -val

    if re.search(r'\bmi\b', s, re.IGNORECASE):
        return val, None
    if re.search(r'\bday', s, re.IGNORECASE):
        return None, val
    if re.search(r'\bhr', s, re.IGNORECASE):
        return None, None  # hours-based "due in" — skip, rely on interval logic
    return None, None


def col(row: dict, *names: str) -> str:
    """Case-insensitive column lookup."""
    lrow = {k.lower().strip(): v for k, v in row.items()}
    for name in names:
        val = lrow.get(name.lower().strip())
        if val is not None:
            return val.strip()
    return ''


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("Usage: python seed_pm_assignments.py <csv_path>")
        sys.exit(1)

    csv_path = sys.argv[1]
    print(f"\n── PM Assignment Seed ──")
    print(f"  CSV: {csv_path}")

    # Load trucks indexed by samsara_vehicle_id
    trucks_resp = sb.table("trucks").select("id, unit_number, samsara_vehicle_id").execute()
    truck_by_sam_id: dict[str, str] = {
        t["samsara_vehicle_id"]: t["id"]
        for t in (trucks_resp.data or [])
        if t.get("samsara_vehicle_id")
    }
    print(f"  {len(truck_by_sam_id)} trucks with samsara_vehicle_id in DB")

    # Load Samsara vehicles: name → asset ID (for matching CSV asset names)
    import requests
    SAMSARA_API_KEY = os.environ.get("SAMSARA_API_KEY", "").strip()
    sam_name_to_id: dict[str, str] = {}
    if SAMSARA_API_KEY:
        headers = {"Authorization": f"Bearer {SAMSARA_API_KEY}"}
        params: dict = {"limit": 512}
        while True:
            resp = requests.get("https://api.samsara.com/fleet/vehicles",
                                headers=headers, params=params, timeout=30)
            resp.raise_for_status()
            body = resp.json()
            for v in body.get("data", []):
                sam_name_to_id[(v.get("name") or "").strip()] = v.get("id", "")
            pg = body.get("pagination", {})
            if not pg.get("hasNextPage"):
                break
            params = {**params, "after": pg["endCursor"]}
        print(f"  {len(sam_name_to_id)} Samsara vehicles fetched for name matching")
    else:
        print("  SAMSARA_API_KEY not set — skipping vehicle name fetch (must have samsara_vehicle_id already)")

    # Load pm_schedules: name → id
    sched_resp = sb.table("pm_schedules").select("id, name, interval_type, interval_value").execute()
    schedules: dict[str, dict] = {
        s["name"].lower(): s for s in (sched_resp.data or [])
    }
    print(f"  {len(schedules)} PM schedules loaded")

    # Read CSV
    rows_upserted = 0
    rows_skipped  = 0
    warnings: list[str] = []

    with open(csv_path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"  {len(rows)} CSV rows to process")

    upsert_batch: list[dict] = []

    for row in rows:
        asset_name    = col(row, 'Asset', 'Vehicle', 'Asset Name')
        maint_item    = col(row, 'Maintenance Item', 'Name', 'Item')
        odo_raw       = col(row, 'Odometer', 'Current Odometer')
        hours_raw     = col(row, 'Engine Hours', 'Current Engine Hours', 'Hours')
        due_in_raw    = col(row, 'Due In', 'Remaining')

        if not asset_name or not maint_item:
            rows_skipped += 1
            continue

        # Resolve truck_id: name → samsara_id → truck_id
        sam_id   = sam_name_to_id.get(asset_name)
        truck_id = truck_by_sam_id.get(sam_id or '') if sam_id else None
        if not truck_id:
            warnings.append(f"No truck match for asset: {asset_name!r}")
            rows_skipped += 1
            continue

        # Resolve pm_schedule_id
        sched_name = extract_schedule_name(maint_item)
        sched_row  = schedules.get(sched_name.lower())
        if not sched_row:
            warnings.append(f"Unknown schedule {sched_name!r} for asset {asset_name!r}")
            rows_skipped += 1
            continue

        sched_id       = sched_row["id"]
        interval_type  = sched_row["interval_type"]
        interval_value = sched_row["interval_value"]

        # Parse current readings
        current_odometer = parse_miles(odo_raw)
        current_hours    = parse_hours(hours_raw)

        # Back-calculate last PM from "due in" + interval
        due_miles, due_days = parse_due_in(due_in_raw)
        last_pm_date: str | None    = None
        last_pm_mileage: int | None = None
        last_pm_hours: float | None = None

        if interval_type == 'miles' and due_miles is not None and current_odometer is not None:
            next_pm_miles  = current_odometer + due_miles
            last_pm_mileage = next_pm_miles - interval_value

        elif interval_type == 'days' and due_days is not None:
            next_pm_date = TODAY + timedelta(days=due_days)
            last_dt      = next_pm_date - timedelta(days=interval_value)
            last_pm_date = last_dt.isoformat()

        # (hours-based: leave last_pm_hours null — user logs first PM manually)

        upsert_batch.append({
            "truck_id":         truck_id,
            "pm_schedule_id":   sched_id,
            "last_pm_date":     last_pm_date,
            "last_pm_mileage":  last_pm_mileage,
            "last_pm_hours":    last_pm_hours,
            "current_odometer": current_odometer,
            "current_hours":    current_hours,
        })
        rows_upserted += 1

    if upsert_batch:
        sb.table("truck_pm_assignments").upsert(
            upsert_batch, on_conflict="truck_id,pm_schedule_id"
        ).execute()

    print(f"  {rows_upserted} assignments upserted, {rows_skipped} rows skipped")

    if warnings:
        print(f"  {len(warnings)} warnings:")
        for w in warnings[:30]:
            print(f"    {w}")


if __name__ == "__main__":
    main()
