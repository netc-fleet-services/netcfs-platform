"""
DVIR "EARLIER IN THE DAY" CHECK — READ ONLY. For HDT interstate drivers who barely
file, was the truck they were assigned inspected EARLIER that same day by someone else
(i.e. a lead driver did the pre-trip and they picked it up)?

Classifies each assigned driver-day:
  self      = the driver signed a DVIR that day
  earlier   = someone else DVIR'd that truck that day BEFORE this driver's shift start
  later/other = someone else DVIR'd it that day but not before their start
  none      = no DVIR on their truck that day at all

Run:  python dvir_earlier.py 2026-06-01 2026-06-30
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


def ms(dtstr):
    return int(datetime.fromisoformat(str(dtstr).replace("Z", "+00:00")).timestamp() * 1000)


def eday(m):
    return datetime.fromtimestamp(m / 1000, tz=EASTERN).date()


def main():
    sb = S.sb
    start_dt = datetime(START.year, START.month, START.day, 0, 0, 0, tzinfo=EASTERN)
    end_dt   = datetime(END.year, END.month, END.day, 23, 59, 59, tzinfo=EASTERN)

    drivers = sb.table("drivers").select("id, name, samsara_driver_id, yard, function").execute().data or []
    interstate = [d for d in drivers if (d.get("yard") or "").lower() == "interstate" and d.get("samsara_driver_id")]
    interstate_sam = {d["samsara_driver_id"] for d in interstate}
    hdt = {d["samsara_driver_id"]: d["name"] for d in interstate if (d.get("function") or "") == "HDT"}

    # DVIRs: (veh, day) -> list of (time_ms, signer);  self days (sam, day)
    dvirs = S.samsara_get("/dvirs/stream", {
        "startTime": S.utc_fmt(start_dt), "endTime": S.utc_fmt(datetime.now(timezone.utc)), "limit": 200})
    veh_day_dvirs = defaultdict(list)
    self_days = set()
    for d in dvirs:
        ts = d.get("dvirSubmissionTime") or d.get("dvirSubmissionBeginTime") or d.get("updatedAtTime")
        if not ts:
            continue
        m = ms(ts)
        dd = eday(m)
        if not (START <= dd <= END):
            continue
        vid = (d.get("vehicle") or {}).get("id")
        sid = ((d.get("authorSignature") or {}).get("signatoryUser") or {}).get("id")
        if vid:
            veh_day_dvirs[(vid, dd.isoformat())].append((m, sid))
        if sid:
            self_days.add((sid, dd.isoformat()))

    # assignments: (driver, day) -> list of (veh, start_ms)
    schedule = S.load_vehicle_driver_schedule(interstate_sam, start_dt, end_dt)
    driverday = defaultdict(list)
    for veh, entries in schedule.items():
        for s_ms, e_ms, drv in entries:
            d0, d1 = eday(s_ms), eday(e_ms)
            day = d0
            while day <= d1:
                if START <= day <= END:
                    driverday[(drv, day.isoformat())].append((veh, s_ms))
                day += timedelta(days=1)

    print(f"\n=== HDT: was the truck DVIR'd EARLIER that day by someone else?  {START} → {END} ===\n")
    print(f"  {'driver':<20} {'days':>4} {'self':>5} {'earlier-by-other':>17} {'other-same-day':>15} {'no DVIR at all':>15}")
    T = [0, 0, 0, 0, 0]
    for sam, name in sorted(hdt.items(), key=lambda x: x[1]):
        days = sorted({ds for (dsam, ds) in driverday if dsam == sam})
        s = eo = oo = no = 0
        for ds in days:
            if (sam, ds) in self_days:
                s += 1
                continue
            assigns = driverday[(sam, ds)]
            earlier = other = False
            for veh, start_ms in assigns:
                for (m, sid) in veh_day_dvirs.get((veh, ds), []):
                    if sid != sam:
                        other = True
                        if m < start_ms:
                            earlier = True
            if earlier:
                eo += 1
            elif other:
                oo += 1
            else:
                no += 1
        print(f"  {name:<20} {len(days):>4} {s:>5} {eo:>17} {oo:>15} {no:>15}")
        T[0] += len(days); T[1] += s; T[2] += eo; T[3] += oo; T[4] += no
    print(f"  {'TOTAL':<20} {T[0]:>4} {T[1]:>5} {T[2]:>17} {T[3]:>15} {T[4]:>15}")
    print()


if __name__ == "__main__":
    main()
