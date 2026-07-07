"""
DVIR TRUCK CHECK — READ ONLY. For the non-filing drivers, which trucks do they drive,
and do those trucks get DVIR'd by OTHER drivers? If a non-filer's truck is inspected
by someone else, it's the driver (not the truck/config). If nobody ever DVIRs the
truck, it may be a vehicle setup issue.

Run:  python dvir_truckcheck.py 2026-06-01 2026-06-30
"""
import os, sys, pathlib
from collections import defaultdict, Counter
from datetime import datetime, timezone, date

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
              "James Dufresne", "Kyle Procon", "Randy Purinton", "Jaishawn Sullivan"]


def main():
    sb = S.sb
    start_dt = datetime(START.year, START.month, START.day, 0, 0, 0, tzinfo=EASTERN)
    end_dt   = datetime(END.year, END.month, END.day, 23, 59, 59, tzinfo=EASTERN)

    drivers = sb.table("drivers").select("id, name, samsara_driver_id, yard").execute().data or []
    interstate = [d for d in drivers if (d.get("yard") or "").lower() == "interstate" and d.get("samsara_driver_id")]
    sam_to_name = {d["samsara_driver_id"]: d["name"] for d in drivers if d.get("samsara_driver_id")}
    interstate_sam = {d["samsara_driver_id"] for d in interstate}
    target = {d["samsara_driver_id"]: d["name"] for d in interstate if d["name"] in NON_FILERS}

    veh_info = S.load_samsara_vehicle_info()   # vehicle_id -> {raw_name, vin}

    # driver -> vehicles from assignments (invert vehicle->driver schedule)
    schedule = S.load_vehicle_driver_schedule(interstate_sam, start_dt, end_dt)
    driver_vehicles = defaultdict(set)
    for veh_id, entries in schedule.items():
        for _s, _e, drv in entries:
            driver_vehicles[drv].add(veh_id)

    # vehicle -> who DVIR'd it (signer name -> count), from the DVIR feed
    dvirs = S.samsara_get("/dvirs/stream", {
        "startTime": S.utc_fmt(start_dt), "endTime": S.utc_fmt(datetime.now(timezone.utc)), "limit": 200})
    veh_dvir_signers = defaultdict(Counter)
    for d in dvirs:
        ts = d.get("dvirSubmissionTime") or d.get("dvirSubmissionBeginTime") or d.get("updatedAtTime")
        if not ts:
            continue
        sd = datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(EASTERN).date()
        if not (START <= sd <= END):
            continue
        vid = (d.get("vehicle") or {}).get("id")
        sid = ((d.get("authorSignature") or {}).get("signatoryUser") or {}).get("id")
        if vid and sid:
            veh_dvir_signers[vid][sid] += 1

    print(f"\n=== TRUCKS DRIVEN BY NON-FILERS  {START} → {END} ===")
    for sam, name in target.items():
        vehs = driver_vehicles.get(sam, set())
        print(f"\n{name}  (assigned to {len(vehs)} vehicle(s) in Samsara):")
        if not vehs:
            print("   (no Samsara vehicle assignments found for this driver in the window)")
        for vid in vehs:
            vname = (veh_info.get(vid) or {}).get("raw_name", vid)
            signers = veh_dvir_signers.get(vid, {})
            total = sum(signers.values())
            others = {sam_to_name.get(s, s): c for s, c in signers.items() if s != sam}
            mine = signers.get(sam, 0)
            if total == 0:
                verdict = "NOBODY DVIRs this truck"
            elif others:
                verdict = "DVIR'd by OTHERS: " + ", ".join(f"{n}({c})" for n, c in sorted(others.items(), key=lambda x: -x[1])[:4])
            else:
                verdict = "only this driver DVIRs it"
            print(f"   {vname[:34]:<34} DVIRs={total:<3} mine={mine}  -> {verdict}")
    print()


if __name__ == "__main__":
    main()
