"""
DVIR STRATEGY-3 SIMULATION — READ ONLY. Writes NOTHING to Supabase or Samsara.

Answers, for a date window, WITHOUT changing any data:
  - What do the raw DVIRs look like (sample dump)?
  - If we resolve each DVIR by "who drove that truck that day" (the vehicle→job
    fallback = Strategy 3, the fix), how do the numbers change?
  - BEFORE (what's recorded now) vs AFTER (simulated with Strategy 3): how many
    driver-days flip from MISSED → COMPLETED?

It reuses the *proven* matching helpers from sync_samsara_daily.py (no divergence).

Run:  python dvir_simulate.py 2026-06-09 2026-06-13
Needs SAMSARA_API_KEY + SUPABASE_URL + SUPABASE_SERVICE_KEY in the repo-root .env.local.
"""

import os, sys, json, pathlib
from datetime import datetime, timezone, date, timedelta
from collections import Counter
from zoneinfo import ZoneInfo


# ── load .env.local BEFORE importing the sync module (it reads env at import time) ──
def _load_env_local():
    for p in (pathlib.Path(__file__).resolve().parents[3] / ".env.local",
              pathlib.Path(__file__).resolve().parent / ".env.local"):
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    if k.strip() not in os.environ:
                        os.environ[k.strip()] = v.strip()
            break


_load_env_local()
os.environ.setdefault("SUPABASE_URL", os.environ.get("NEXT_PUBLIC_SUPABASE_URL", ""))
os.environ.setdefault("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""))

for _v in ("SAMSARA_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_KEY"):
    if not os.environ.get(_v, "").strip():
        print(f"ERROR: {_v} is not set. Fill it into the repo-root .env.local and re-run.")
        sys.exit(1)

# Reuse the proven helpers + sb client from the daily sync (import runs its module body,
# which only reads env and defines functions — main() is guarded by __main__).
import sync_samsara_daily as S  # noqa: E402

EASTERN = ZoneInfo("America/New_York")


def _parse_date(s: str, label: str) -> date:
    try:
        return date.fromisoformat(s.strip())
    except Exception:
        print(f"ERROR: bad {label} date {s!r} — use YYYY-MM-DD.")
        sys.exit(1)


_args = [a for a in sys.argv[1:] if a]
START = _parse_date(_args[0] if len(_args) > 0 else os.environ.get("DIAG_START", "2026-06-09"), "start")
END   = _parse_date(_args[1] if len(_args) > 1 else os.environ.get("DIAG_END",   "2026-06-13"), "end")
if START > END:
    print(f"ERROR: start {START} is after end {END}.")
    sys.exit(1)


def date_range(a: date, b: date):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


SKIP_STRATEGY3 = os.environ.get("SKIP_STRATEGY3", "").strip() == "1"


def fetch_all(build):
    """Page a Supabase query past the 1000-row cap. build() returns a fresh builder."""
    PAGE, rows, start = 1000, [], 0
    while True:
        batch = build().range(start, start + PAGE - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        start += PAGE
    return rows


def main():
    sb = S.sb
    print(f"\n=== DVIR STRATEGY-3 SIMULATION (read-only)  {START} → {END} ===\n")

    # Interstate drivers — mirror sync_dvirs exactly.
    interstate = (sb.table("drivers").select("id, name, samsara_driver_id")
                  .ilike("yard", "interstate").not_.is_("samsara_driver_id", "null")
                  .execute().data or [])
    interstate_sam_ids      = {d["samsara_driver_id"] for d in interstate}
    interstate_internal_ids = {d["id"] for d in interstate}
    print(f"{len(interstate)} linked interstate drivers")

    # by_name map (for the vehicle→job resolver) — all drivers.
    by_name: dict[str, int] = {}
    for r in (sb.table("drivers").select("id, name").execute().data or []):
        if r.get("name"):
            for k in S._name_forms(r["name"]):
                by_name.setdefault(k, r["id"])

    # Strategy-3 reference data (same calls the backfill uses). Skippable for speed
    # on wide windows — Strategy 3 contributes ~0 for interstate DVIR compliance.
    if SKIP_STRATEGY3:
        by_unit_raw = by_unit_num = by_vin = by_id_towbook = {}
        sam_vehicles = {}
    else:
        by_unit_raw, by_unit_num, by_vin, by_id_towbook = S.load_truck_maps()
        sam_vehicles = S.load_samsara_vehicle_info()

    start_dt = datetime(START.year, START.month, START.day, 0, 0, 0, tzinfo=EASTERN)
    end_dt   = datetime(END.year, END.month, END.day, 23, 59, 59, tzinfo=EASTERN)
    schedule = S.load_vehicle_driver_schedule(interstate_sam_ids, start_dt, end_dt)

    dvirs = S.samsara_get("/dvirs/stream", {
        "startTime": S.utc_fmt(start_dt),
        "endTime":   S.utc_fmt(datetime.now(timezone.utc)),
        "limit":     200,
    })
    print(f"{len(dvirs)} DVIRs fetched\n")

    # Show a few raw DVIRs so we can SEE the shape (esp. whether a driver id exists).
    print("=== SAMPLE RAW DVIRs (trimmed) ===")
    shown = 0
    for d in dvirs:
        if shown >= 3:
            break
        print(json.dumps({
            "id":              d.get("id"),
            "top_level_keys":  sorted(d.keys()),
            "vehicle":         d.get("vehicle"),
            "authorSignature": d.get("authorSignature"),
            "driver":          d.get("driver"),
            "startTime":       d.get("startTime"),
            "updatedAtTime":   d.get("updatedAtTime"),
        }, indent=2, default=str))
        print("---")
        shown += 1

    # Every distinct DVIR author across the whole fetched range (window start → now),
    # any date — so we can tell if a non-submitting driver EVER files a DVIR in Samsara.
    all_author_ids = set()
    for _d in dvirs:
        _a = (_d.get("authorSignature") or {}).get("signatoryUser") or {}
        if _a.get("id"):
            all_author_ids.add(_a["id"])

    # Resolve each DVIR via Strategy 1 (signature) → 2 (assignment) → 3 (vehicle→job).
    submitted_sam: set[tuple[str, str]] = set()
    submitted_int: set[tuple[int, str]] = set()
    dvir_per_day: Counter = Counter()
    n1 = n2 = n3 = has_vehicle = 0
    for d in dvirs:
        try:
            ts = (d.get("dvirSubmissionTime") or d.get("dvirSubmissionBeginTime")
                  or d.get("startTime") or d.get("updatedAtTime"))
            if not ts:
                continue
            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            ddate = dt.astimezone(EASTERN).date()
            if not (START <= ddate <= END):
                continue
            ds = ddate.isoformat()
            dvir_per_day[ds] += 1
            veh = (d.get("vehicle") or {}).get("id")
            if veh:
                has_vehicle += 1
            dms = int(dt.timestamp() * 1000)

            # Driver id lives at authorSignature.signatoryUser.id (driverInfo/driver are absent/null).
            drv = None
            author = d.get("authorSignature") or {}
            sig = author.get("signatoryUser") or {}
            aid = (sig.get("id")
                   or (author.get("driverInfo") or {}).get("id")
                   or (d.get("driver") or {}).get("id") or "")
            if aid and aid in interstate_sam_ids:
                drv = aid
                n1 += 1
            if not drv and veh:
                m = S.driver_at(schedule.get(veh, []), dms)
                if m:
                    drv = m
                    n2 += 1
            if drv:
                submitted_sam.add((drv, ds))
                continue

            # Strategy 3: who drove that truck that day (vehicle → truck → job → driver)
            if veh and not SKIP_STRATEGY3:
                vn = (sam_vehicles.get(veh) or {}).get("raw_name", "")
                tuid = S.resolve_truck_id(veh, vn, sam_vehicles, by_unit_raw, by_unit_num, by_vin)
                iid = S.resolve_driver_from_job(tuid, vn, ddate, by_name, by_id_towbook)
                if iid and iid in interstate_internal_ids:
                    submitted_int.add((iid, ds))
                    n3 += 1
        except Exception:
            continue

    print(f"\nDVIRs with a vehicle id: {has_vehicle}")
    print(f"Resolved by: {n1} signature (Strategy 1), {n2} assignment window (Strategy 2), "
          f"{n3} WHO-DROVE-THE-TRUCK (Strategy 3)")

    # "Drove that day" gate — same as the pipeline.
    ml = fetch_all(lambda: sb.table("mileage_logs").select("driver_id, log_date, source").gt("miles", 0)
                   .gte("log_date", START.isoformat()).lte("log_date", END.isoformat()).order("driver_id"))
    drove = {(r["driver_id"], r["log_date"]) for r in ml}
    src_by_driver: dict = {}
    for r in ml:
        src_by_driver.setdefault(r["driver_id"], Counter())[r.get("source")] += 1

    # What's recorded now.
    cur = fetch_all(lambda: sb.table("dvir_logs").select("driver_id, log_date, completed").eq("source", "samsara")
                    .gte("log_date", START.isoformat()).lte("log_date", END.isoformat()).order("log_date"))
    cur_map = {(r["driver_id"], r["log_date"]): r["completed"] for r in cur}
    cur_completed = sum(1 for v in cur_map.values() if v)
    cur_missed    = sum(1 for v in cur_map.values() if v is False)

    # Simulate: for every interstate driver-day that drove, is a DVIR now resolved?
    def _has(sam, iid, ds):
        return (sam, ds) in submitted_sam or (iid, ds) in submitted_int
    drivers_with_dvir = {s for (s, _) in submitted_sam}

    sim_completed = sim_missed = 0
    miss_adjacent = miss_no_dvir = miss_other = 0
    flips: list[tuple[str, str]] = []
    for d in interstate:
        iid, sam = d["id"], d["samsara_driver_id"]
        for day in date_range(START, END):
            ds = day.isoformat()
            if (iid, ds) not in drove:
                continue
            if _has(sam, iid, ds):
                sim_completed += 1
                if cur_map.get((iid, ds)) is False:
                    flips.append((d["name"], ds))
            else:
                sim_missed += 1
                prev = (day - timedelta(days=1)).isoformat()
                nxt  = (day + timedelta(days=1)).isoformat()
                if _has(sam, iid, prev) or _has(sam, iid, nxt):
                    miss_adjacent += 1
                elif sam not in drivers_with_dvir:
                    miss_no_dvir += 1
                else:
                    miss_other += 1

    print("\n── BEFORE (recorded now)  vs  AFTER (simulated with 'who drove the truck') ──")
    print(f"  completed:  {cur_completed:>4}   →   {sim_completed}")
    print(f"  missed:     {cur_missed:>4}   →   {sim_missed}")
    print(f"  {len(flips)} driver-days would flip MISSED → COMPLETED\n")
    print(f"  of the {sim_missed} still-missed driver-days:")
    print(f"    {miss_adjacent} have a matched DVIR within +/-1 day (day-boundary/timestamp)")
    print(f"    {miss_no_dvir} are drivers with NO DVIR anywhere in the window")
    print(f"    {miss_other} drove + did DVIRs on other days, but not this one")
    print("  DVIRs submitted per day (window): "
          + ", ".join(f"{k}={v}" for k, v in sorted(dvir_per_day.items())))
    drove_interstate = {iid for (iid, _) in drove if iid in interstate_internal_ids}
    print(f"  distinct interstate drivers: {len(drove_interstate)} drove, "
          f"{len(drivers_with_dvir)} submitted >=1 DVIR in the window\n")

    print("  Drivers who drove but filed NO DVIR in the window:")
    for d in sorted(interstate, key=lambda x: x.get("name") or ""):
        iid, sam = d["id"], d["samsara_driver_id"]
        dd = sum(1 for day in date_range(START, END) if (iid, day.isoformat()) in drove)
        subs = sum(1 for day in date_range(START, END) if _has(sam, iid, day.isoformat()))
        if dd > 0 and subs == 0:
            ever = "yes" if sam in all_author_ids else "NEVER"
            src = ",".join(f"{k}:{v}" for k, v in (src_by_driver.get(iid) or {}).items())
            print(f"    {d['name']:<24} drove {dd}d  ever-DVIRs-in-Samsara={ever:<5}  mileage[{src}]")
    print()
    if flips:
        print("  sample flips (driver, day):")
        for name, ds in flips[:20]:
            print(f"     {name:<26} {ds}")
    print("\n(No data was written. This is a simulation.)\n")


if __name__ == "__main__":
    main()
