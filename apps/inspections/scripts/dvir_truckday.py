"""
DVIR PER-TRUCK-PER-DAY CHECK — READ ONLY. Reframes compliance as "was the TRUCK a
driver operated inspected that DAY (by anyone)?" instead of "did this driver sign?".
For shared trucks, one driver's DVIR covers the vehicle for the day.

Run:  python dvir_truckday.py 2026-06-01 2026-06-30
"""
import os, sys, pathlib
from collections import defaultdict
from datetime import datetime, timezone, date, timedelta

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


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
        print(f"ERROR: {_v} not set."); sys.exit(1)

import sync_samsara_daily as S  # noqa: E402
from zoneinfo import ZoneInfo
EASTERN = ZoneInfo("America/New_York")

_args = [a for a in sys.argv[1:] if a]
START = date.fromisoformat(_args[0]) if len(_args) > 0 else date(2026, 6, 1)
END   = date.fromisoformat(_args[1]) if len(_args) > 1 else date(2026, 6, 30)

NON_FILERS = ["James Smith", "Daniel Potter", "Chase Lanoue", "Daniel Heroux",
              "James Dufresne", "Kyle Procon", "Randy Purinton", "Jaishawn Sullivan",
              "Miguel Santana"]


def days_between(s_ms, e_ms):
    d0 = datetime.fromtimestamp(s_ms / 1000, tz=EASTERN).date()
    d1 = datetime.fromtimestamp(e_ms / 1000, tz=EASTERN).date()
    out, d = [], d0
    while d <= d1:
        if START <= d <= END:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def main():
    sb = S.sb
    start_dt = datetime(START.year, START.month, START.day, 0, 0, 0, tzinfo=EASTERN)
    end_dt   = datetime(END.year, END.month, END.day, 23, 59, 59, tzinfo=EASTERN)

    drivers = sb.table("drivers").select("id, name, samsara_driver_id, yard").execute().data or []
    interstate = [d for d in drivers if (d.get("yard") or "").lower() == "interstate" and d.get("samsara_driver_id")]
    interstate_sam = {d["samsara_driver_id"] for d in interstate}
    target = {d["samsara_driver_id"]: d["name"] for d in interstate if d["name"] in NON_FILERS}

    # DVIR'd (vehicle, day) by ANYONE, and per-(driver,day) self-DVIR
    dvirs = S.samsara_get("/dvirs/stream", {
        "startTime": S.utc_fmt(start_dt), "endTime": S.utc_fmt(datetime.now(timezone.utc)), "limit": 200})
    dvir_veh_day = set()          # (vehicle_id, date) inspected by anyone
    dvir_driver_day = set()       # (sam_id, date) self-signed
    for d in dvirs:
        ts = d.get("dvirSubmissionTime") or d.get("dvirSubmissionBeginTime") or d.get("updatedAtTime")
        if not ts:
            continue
        sd = datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(EASTERN).date()
        if not (START <= sd <= END):
            continue
        vid = (d.get("vehicle") or {}).get("id")
        sid = ((d.get("authorSignature") or {}).get("signatoryUser") or {}).get("id")
        if vid:
            dvir_veh_day.add((vid, sd.isoformat()))
        if sid:
            dvir_driver_day.add((sid, sd.isoformat()))

    # assignments -> (driver, day) -> vehicles ; and (vehicle, day) operated
    schedule = S.load_vehicle_driver_schedule(interstate_sam, start_dt, end_dt)
    driverday_veh = defaultdict(set)
    truckday_operated = set()
    for veh, entries in schedule.items():
        for s_ms, e_ms, drv in entries:
            for ds in days_between(s_ms, e_ms):
                driverday_veh[(drv, ds)].add(veh)
                truckday_operated.add((veh, ds))

    # ---- Per non-filer: self vs truck-covered ----
    print(f"\n=== PER-TRUCK-PER-DAY  {START} → {END} ===\n")
    print("  (of the days each driver was assigned a truck)")
    print(f"  {'driver':<20} {'days':>4} {'self-DVIR':>9} {'truck-DVIRd-by-anyone':>22} {'truly-uncovered':>16}")
    for sam, name in target.items():
        assigned_days = [ds for (dsam, ds) in driverday_veh if dsam == sam]
        assigned_days = sorted(set(assigned_days))
        self_c = truck_c = uncov = 0
        for ds in assigned_days:
            vehs = driverday_veh.get((sam, ds), set())
            if (sam, ds) in dvir_driver_day:
                self_c += 1
            elif any((v, ds) in dvir_veh_day for v in vehs):
                truck_c += 1
            else:
                uncov += 1
        print(f"  {name:<20} {len(assigned_days):>4} {self_c:>9} {truck_c:>22} {uncov:>16}")

    # ---- Fleet aggregate: per-truck-per-day compliance (interstate operated trucks) ----
    op = len(truckday_operated)
    insp = sum(1 for td in truckday_operated if td in dvir_veh_day)
    print(f"\n  FLEET (interstate): {op} truck-days operated, {insp} inspected that day "
          f"({round(100*insp/op) if op else 0}% per-truck-per-day compliance)")
    print()


if __name__ == "__main__":
    main()
