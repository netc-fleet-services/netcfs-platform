"""
Seed PM Assignments from Samsara CSV Export

Reads "Upcoming Preventive Maintenance Items.csv" exported from Samsara and
populates truck_pm_assignments in Supabase.

Usage:
  python seed_pm_assignments.py path/to/exported.csv
  — or set CSV_PATH below and run with no arguments —

Expected CSV columns (case-insensitive):
  Asset            — Samsara vehicle name
  Maintenance Item — e.g. "B PM SERVICE Every: 10000 mi"
  Odometer         — current odometer reading (e.g. "234,512 mi")
  Engine Hours     — current engine hours (e.g. "1,234.5")
  Due In           — remaining until next PM (e.g. "1,500 mi", "45 days",
                     "Overdue 200 mi", "Overdue 10 days")

Env vars — loaded automatically from root .env.local, or set in the shell.
Supports both naming conventions used in this project:
  SUPABASE_URL  or  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_KEY  or  SUPABASE_SERVICE_ROLE_KEY
  SAMSARA_API_KEY  (optional — improves matching but not required)
"""

import os, sys, re, csv, pathlib
from datetime import date, timedelta


def _load_env_local():
    """Load .env.local from repo root or script directory into os.environ."""
    candidates = [
        pathlib.Path(__file__).resolve().parent.parent.parent.parent / ".env.local",
        pathlib.Path(__file__).resolve().parent / ".env.local",
    ]
    for path in candidates:
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    k = k.strip()
                    if k not in os.environ:
                        os.environ[k] = v.strip()
            break


_load_env_local()

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
SAMSARA_API_KEY = os.environ.get("SAMSARA_API_KEY", "").strip()

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: Missing Supabase credentials.")
    print("  Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local")
    sys.exit(1)

from supabase import create_client
sb = create_client(SUPABASE_URL, SUPABASE_KEY)
TODAY = date.today()


# ── Unit number extraction (mirrors sync_samsara_pm.py) ─────────────────────

def extract_unit(name: str) -> str | None:
    u = name.strip().upper()
    m = re.search(r'#([A-Z]*\d+[A-Z0-9]*)', u)
    if m:
        return m.group(1).lower()
    m = re.match(r'^(\d+)', u)
    if m:
        return m.group(1)
    m = re.search(r'\b(T\d+)\b', u)
    if m:
        return m.group(1).lower()
    m = re.search(r'\b(\d{2,})\b', u)
    if m:
        return m.group(1)
    return None


def normalize_unit(s: str) -> str:
    return s.strip().lower()


# ── Schedule name extraction ──────────────────────────────────────────────────

def extract_schedule_name(maintenance_item: str) -> str:
    return re.sub(r'\s+Every:.*$', '', maintenance_item, flags=re.IGNORECASE).strip()


# ── Value parsers ─────────────────────────────────────────────────────────────

def parse_miles(s: str) -> int | None:
    if not s or s.strip().upper() in ('N/A', ''):
        return None
    m = re.search(r'([\d,]+)', s)
    return int(m.group(1).replace(',', '')) if m else None


def parse_hours(s: str) -> float | None:
    if not s or s.strip().upper() in ('N/A', ''):
        return None
    m = re.search(r'([\d,]+\.?\d*)', s)
    return float(m.group(1).replace(',', '')) if m else None


def parse_due_in(s: str) -> tuple[int | None, int | None]:
    """Returns (due_in_miles, due_in_days). Negative = overdue."""
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
    return None, None


def col(row: dict, *names: str) -> str:
    lrow = {k.lower().strip(): v for k, v in row.items()}
    for name in names:
        val = lrow.get(name.lower().strip())
        if val is not None:
            return str(val).strip()
    return ''


# ── Main ──────────────────────────────────────────────────────────────────────

CSV_PATH = r"C:\Users\JackKurtz\Downloads\Upcoming Preventive Maintenance Items.csv"


def main():
    csv_path = sys.argv[1] if len(sys.argv) > 1 else CSV_PATH
    if not csv_path:
        print("Usage: python seed_pm_assignments.py <csv_path>")
        sys.exit(1)

    print(f"\n── PM Assignment Seed ──")
    print(f"  CSV: {csv_path}")

    # Load trucks — build two indexes
    trucks_resp = sb.table("trucks").select("id, unit_number, samsara_vehicle_id").execute()
    all_trucks = trucks_resp.data or []
    truck_by_sam_id: dict[str, dict] = {
        t["samsara_vehicle_id"]: t for t in all_trucks if t.get("samsara_vehicle_id")
    }
    truck_by_unit: dict[str, dict] = {
        normalize_unit(t["unit_number"]): t for t in all_trucks if t.get("unit_number")
    }
    print(f"  {len(all_trucks)} trucks in DB — {len(truck_by_sam_id)} linked to Samsara")

    # Optional: fetch Samsara vehicle list for exact name → ID lookup
    # If not available, falls back to unit-number regex matching
    sam_name_to_id: dict[str, str] = {}
    if SAMSARA_API_KEY:
        import requests
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
        print(f"  {len(sam_name_to_id)} Samsara vehicles fetched (exact-name matching enabled)")
    else:
        print("  SAMSARA_API_KEY not set — using unit-number regex matching (works fine without it)")

    # Load pm_schedules
    sched_resp = sb.table("pm_schedules").select("id, name, interval_type, interval_value").execute()
    schedules: dict[str, dict] = {s["name"].lower(): s for s in (sched_resp.data or [])}
    print(f"  {len(schedules)} PM schedules loaded")

    # Read CSV
    with open(csv_path, newline='', encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))
    print(f"  {len(rows)} CSV rows to process\n")

    upsert_batch: list[dict] = []
    matched_truck_ids: set[str] = set()
    skipped_no_truck: list[str] = []
    skipped_no_schedule: list[str] = []
    match_method_counts = {"sam_id": 0, "unit_regex": 0}

    for row in rows:
        asset_name = col(row, 'Asset', 'Vehicle', 'Asset Name')
        maint_item = col(row, 'Maintenance Item', 'Name', 'Item')
        odo_raw    = col(row, 'Odometer', 'Current Odometer')
        hours_raw  = col(row, 'Engine Hours', 'Current Engine Hours', 'Hours')
        due_in_raw = col(row, 'Due In', 'Remaining')

        if not asset_name or not maint_item:
            continue

        # ── Match asset name → truck ─────────────────────────────────────────
        truck: dict | None = None

        # 1. Exact Samsara ID match (if API key available)
        sam_id = sam_name_to_id.get(asset_name)
        if sam_id:
            truck = truck_by_sam_id.get(sam_id)
            if truck:
                match_method_counts["sam_id"] += 1

        # 2. Unit-number regex fallback (no API key needed)
        if not truck:
            extracted = extract_unit(asset_name)
            if extracted:
                truck = truck_by_unit.get(normalize_unit(extracted))
                if truck:
                    match_method_counts["unit_regex"] += 1

        if not truck:
            skipped_no_truck.append(asset_name)
            continue

        truck_id = truck["id"]

        # ── Match maintenance item → pm_schedule ─────────────────────────────
        sched_name = extract_schedule_name(maint_item)
        sched_row  = schedules.get(sched_name.lower())
        if not sched_row:
            skipped_no_schedule.append(f"{asset_name!r} → {sched_name!r}")
            continue

        sched_id       = sched_row["id"]
        interval_type  = sched_row["interval_type"]
        interval_value = sched_row["interval_value"]

        # ── Parse current readings ────────────────────────────────────────────
        current_odometer = parse_miles(odo_raw)
        current_hours    = parse_hours(hours_raw)

        # Back-calculate last PM from due_in + known interval
        due_miles, due_days = parse_due_in(due_in_raw)
        last_pm_date:    str | None   = None
        last_pm_mileage: int | None   = None
        last_pm_hours:   float | None = None

        if interval_type == 'miles' and due_miles is not None and current_odometer is not None:
            next_pm_miles   = current_odometer + due_miles
            last_pm_mileage = next_pm_miles - interval_value

        elif interval_type == 'days' and due_days is not None:
            next_pm_dt   = TODAY + timedelta(days=due_days)
            last_pm_date = (next_pm_dt - timedelta(days=interval_value)).isoformat()

        upsert_batch.append({
            "truck_id":         truck_id,
            "pm_schedule_id":   sched_id,
            "last_pm_date":     last_pm_date,
            "last_pm_mileage":  last_pm_mileage,
            "last_pm_hours":    last_pm_hours,
            "current_odometer": current_odometer,
            "current_hours":    current_hours,
        })
        matched_truck_ids.add(truck_id)

    if upsert_batch:
        sb.table("truck_pm_assignments").upsert(
            upsert_batch, on_conflict="truck_id,pm_schedule_id"
        ).execute()

    print(f"  {len(upsert_batch)} assignments upserted across {len(matched_truck_ids)} trucks")
    if any(match_method_counts.values()):
        print(f"  (matched via Samsara ID: {match_method_counts['sam_id']}, unit regex: {match_method_counts['unit_regex']})")

    # ── Report: CSV assets with no truck match ────────────────────────────────
    if skipped_no_truck:
        print(f"\n  {len(skipped_no_truck)} CSV assets had no matching truck (not in fleet tracker):")
        for a in skipped_no_truck:
            print(f"    {a!r}")

    if skipped_no_schedule:
        print(f"\n  {len(skipped_no_schedule)} rows had an unrecognised schedule name:")
        for s in skipped_no_schedule:
            print(f"    {s}")

    # ── Report: linked trucks with NO PM assignment ───────────────────────────
    unassigned = [
        t for t in all_trucks
        if t["id"] not in matched_truck_ids and t.get("samsara_vehicle_id")
    ]
    if unassigned:
        print(f"\n  {len(unassigned)} Samsara-linked trucks have no PM assignment after seeding")
        print("  (not in the CSV — may need a schedule assigned manually):")
        for t in sorted(unassigned, key=lambda x: x["unit_number"] or ''):
            print(f"    Unit {t['unit_number']}")
    else:
        print("\n  All Samsara-linked trucks have at least one PM assignment.")

    print("\nSeed complete.")


if __name__ == "__main__":
    main()
