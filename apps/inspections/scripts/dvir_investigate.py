"""
DVIR FEED INVESTIGATION — READ ONLY. Writes nothing.

Diligence pass to check whether we're UNDER-counting DVIRs (numerator too low) or
OVER-counting driving days (denominator too high). It:
  1. Censuses every field on the raw DVIR payload — who signs them (driver vs
     mechanic), where the driver id lives, DVIR type, safety status.
  2. Checks how many distinct signers match our drivers (interstate / any / none).
  3. Prints a per-driver day-by-day matrix for interstate drivers:
       C = drove + filed DVIR   M = drove, no DVIR   d = DVIR but no mileage   . = neither

Run:  python dvir_investigate.py 2026-06-01 2026-06-30
"""

import os, sys, json, pathlib
from collections import Counter, defaultdict
from datetime import datetime, timezone, date, timedelta
from zoneinfo import ZoneInfo

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
        print(f"ERROR: {_v} not set (repo-root .env.local).")
        sys.exit(1)

import sync_samsara_daily as S  # noqa: E402

EASTERN = ZoneInfo("America/New_York")

_args = [a for a in sys.argv[1:] if a]
START = date.fromisoformat(_args[0]) if len(_args) > 0 else date(2026, 6, 1)
END   = date.fromisoformat(_args[1]) if len(_args) > 1 else date(2026, 6, 30)


def fetch_all(build):
    PAGE, rows, start = 1000, [], 0
    while True:
        batch = build().range(start, start + PAGE - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        start += PAGE
    return rows


def sub_date(d):
    ts = d.get("dvirSubmissionTime") or d.get("dvirSubmissionBeginTime") or d.get("updatedAtTime")
    if not ts:
        return None
    return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(EASTERN).date()


def main():
    sb = S.sb
    start_dt = datetime(START.year, START.month, START.day, 0, 0, 0, tzinfo=EASTERN)
    print(f"\n=== DVIR FEED INVESTIGATION  {START} → {END} ===\n")

    drivers = sb.table("drivers").select("id, name, samsara_driver_id, yard, function").execute().data or []
    interstate = [d for d in drivers if (d.get("yard") or "").lower() == "interstate"]
    interstate_sam = {d["samsara_driver_id"]: d for d in interstate if d.get("samsara_driver_id")}
    any_sam = {d["samsara_driver_id"]: d for d in drivers if d.get("samsara_driver_id")}
    print(f"{len(drivers)} drivers, {len(interstate)} interstate, {len(interstate_sam)} interstate linked")

    dvirs = S.samsara_get("/dvirs/stream", {
        "startTime": S.utc_fmt(start_dt),
        "endTime":   S.utc_fmt(datetime.now(timezone.utc)),
        "limit":     200,
    })
    print(f"{len(dvirs)} DVIRs fetched (whole fetch window)\n")

    # ---- CENSUS ----
    in_window = 0
    author_type = Counter()
    has_sig_id = has_driver_obj = has_driverid = has_second = 0
    dvir_type = Counter()
    safety_status = Counter()
    key_union = Counter()
    sig_ids = Counter()

    for d in dvirs:
        sd = sub_date(d)
        if sd is None or not (START <= sd <= END):
            continue
        in_window += 1
        for k in d.keys():
            key_union[k] += 1
        auth = d.get("authorSignature") or {}
        author_type[(auth.get("type") if isinstance(auth, dict) else None) or "(none)"] += 1
        sig = (auth.get("signatoryUser") or {}) if isinstance(auth, dict) else {}
        if sig.get("id"):
            has_sig_id += 1
            sig_ids[sig["id"]] += 1
        if d.get("driver"):
            has_driver_obj += 1
        if d.get("driverId") or d.get("driverIds"):
            has_driverid += 1
        if d.get("secondSignature"):
            has_second += 1
        dvir_type[d.get("type") or "(none)"] += 1
        safety_status[d.get("safetyStatus") or "(none)"] += 1

    print(f"--- CENSUS of {in_window} in-window DVIRs ---")
    print(f"  authorSignature.type:     {dict(author_type)}")
    print(f"  has signatoryUser.id:     {has_sig_id}")
    print(f"  has top-level 'driver':   {has_driver_obj}")
    print(f"  has 'driverId(s)':        {has_driverid}")
    print(f"  has secondSignature:      {has_second}")
    print(f"  dvir 'type' field:        {dict(dvir_type)}")
    print(f"  safetyStatus:             {dict(safety_status)}")
    print(f"  top-level keys seen:      {dict(key_union)}")

    # signer id → which drivers?
    match_inter = sum(v for k, v in sig_ids.items() if k in interstate_sam)
    match_any   = sum(v for k, v in sig_ids.items() if k in any_sam and k not in interstate_sam)
    match_none  = sum(v for k, v in sig_ids.items() if k not in any_sam)
    print(f"\n  DVIRs by signer match: interstate={match_inter}, other-linked-driver={match_any}, "
          f"UNKNOWN signer={match_none}")
    unknown = [(k, v) for k, v in sig_ids.items() if k not in any_sam]
    if unknown:
        print(f"  {len(unknown)} distinct UNKNOWN signer ids (not any driver in our DB). Sample:")
        for sid, n in sorted(unknown, key=lambda x: -x[1])[:10]:
            print(f"     id={sid!r}  {n} DVIRs")

    # ---- per-driver day matrix (interstate) ----
    ml = fetch_all(lambda: sb.table("mileage_logs").select("driver_id, log_date, miles").gt("miles", 0)
                   .gte("log_date", START.isoformat()).lte("log_date", END.isoformat()).order("driver_id"))
    miles_by = {(r["driver_id"], r["log_date"]): float(r["miles"] or 0) for r in ml}

    # DVIR days per interstate driver (by signatoryUser.id → sam → driver)
    dvir_days = defaultdict(set)   # sam_id -> {date_str}
    for d in dvirs:
        sd = sub_date(d)
        if sd is None or not (START <= sd <= END):
            continue
        sig = ((d.get("authorSignature") or {}).get("signatoryUser") or {})
        sid = sig.get("id")
        if sid in interstate_sam:
            dvir_days[sid].add(sd.isoformat())

    days = [START + timedelta(days=i) for i in range((END - START).days + 1)]
    print(f"\n--- per-driver day matrix (C=drove+DVIR  M=drove,noDVIR  d=DVIR,noMiles  .=neither) ---")
    rows = []
    for drv in interstate:
        iid, sam, name = drv["id"], drv.get("samsara_driver_id"), drv.get("name")
        drove_days = sum(1 for day in days if (iid, day.isoformat()) in miles_by)
        if drove_days == 0 and not (sam and dvir_days.get(sam)):
            continue
        line = ""
        c = m = 0
        for day in days:
            ds = day.isoformat()
            drove = (iid, ds) in miles_by
            filed = sam in interstate_sam and ds in dvir_days.get(sam, set())
            if drove and filed:
                line += "C"; c += 1
            elif drove and not filed:
                line += "M"; m += 1
            elif filed and not drove:
                line += "d"
            else:
                line += "."
        rows.append((name, drv.get("function") or "?", drove_days, c, m, line))
    for name, fn, dd, c, m, line in sorted(rows, key=lambda x: (x[1], -x[4])):
        print(f"  {name[:20]:<20} {fn:<13} drove={dd:>2} DVIR={c:>2} miss={m:>2}  {line}")

    agg = defaultdict(lambda: [0, 0])   # function -> [drove_days, completed]
    for name, fn, dd, c, m, line in rows:
        agg[fn][0] += dd
        agg[fn][1] += c
    print("\n  --- interstate DVIR compliance by function (drove days -> % with a same-day DVIR) ---")
    tot_d = tot_c = 0
    for fn, (dd, c) in sorted(agg.items(), key=lambda x: -x[1][0]):
        tot_d += dd; tot_c += c
        print(f"    {fn:<14} {c:>4} / {dd:>4} days  =  {round(100*c/dd) if dd else 0}%")
    print(f"    {'ALL':<14} {tot_c:>4} / {tot_d:>4} days  =  {round(100*tot_c/tot_d) if tot_d else 0}%")
    driving_d = sum(agg[f][0] for f in agg if f in ('LDT', 'HDT'))
    driving_c = sum(agg[f][1] for f in agg if f in ('LDT', 'HDT'))
    print(f"    {'LDT+HDT only':<14} {driving_c:>4} / {driving_d:>4} days  =  "
          f"{round(100*driving_c/driving_d) if driving_d else 0}%  (real road drivers)")

    # Denominator check: is a "missed" day a real shift or a trivial yard move?
    c_miles, m_miles = [], []
    for drv in interstate:
        iid, sam = drv["id"], drv.get("samsara_driver_id")
        for day in days:
            ds = day.isoformat()
            mi = miles_by.get((iid, ds))
            if mi is None:
                continue
            filed = sam in interstate_sam and ds in dvir_days.get(sam, set())
            (c_miles if filed else m_miles).append(mi)

    def _stats(xs):
        if not xs:
            return "none"
        xs = sorted(xs)
        return (f"n={len(xs)} median={xs[len(xs)//2]:.0f}mi mean={sum(xs)/len(xs):.0f}mi "
                f"<25mi={sum(1 for x in xs if x < 25)} <5mi={sum(1 for x in xs if x < 5)}")
    print(f"\n  miles on COMPLETED (C) days: {_stats(c_miles)}")
    print(f"  miles on MISSED (M) days:    {_stats(m_miles)}")
    print()


if __name__ == "__main__":
    main()
