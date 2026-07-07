"""
DVIR SIGNER CHECK — READ ONLY. Do the non-filers' DVIRs exist under a DIFFERENT
Samsara id than the one we linked? Lists every DVIR signer id -> Samsara name ->
whether it's linked to one of our drivers, and flags any signer whose Samsara name
matches an interstate driver but is UNLINKED or linked to a different record.

Run:  python dvir_signercheck.py 2026-06-01 2026-06-30
"""
import os, sys, pathlib
from collections import Counter
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


def norm(s):
    return " ".join((s or "").lower().replace(",", " ").split())


def lastname(s):
    n = norm(s).split()
    return n[-1] if n else ""


def main():
    sb = S.sb
    sam = S.samsara_get("/fleet/drivers", {"limit": 512})
    sam_by_id = {d.get("id"): (d.get("name") or "") for d in sam}

    ours = sb.table("drivers").select("id, name, samsara_driver_id, yard").execute().data or []
    our_by_sid = {d["samsara_driver_id"]: d for d in ours if d.get("samsara_driver_id")}
    interstate_lastnames = {lastname(d["name"]) for d in ours
                            if (d.get("yard") or "").lower() == "interstate" and d.get("name")}

    start_dt = datetime(START.year, START.month, START.day, 0, 0, 0, tzinfo=EASTERN)
    dvirs = S.samsara_get("/dvirs/stream", {
        "startTime": S.utc_fmt(start_dt),
        "endTime":   S.utc_fmt(datetime.now(timezone.utc)),
        "limit":     200,
    })

    signer = Counter()
    for d in dvirs:
        ts = d.get("dvirSubmissionTime") or d.get("dvirSubmissionBeginTime") or d.get("updatedAtTime")
        if not ts:
            continue
        sd = datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(EASTERN).date()
        if not (START <= sd <= END):
            continue
        sid = ((d.get("authorSignature") or {}).get("signatoryUser") or {}).get("id")
        if sid:
            signer[sid] += 1

    print(f"\n=== DVIR SIGNERS {START} → {END}  ({len(signer)} distinct signers) ===\n")
    print(f"{'DVIRs':>5}  {'signer id':<12}  {'Samsara name':<26}  our link")
    for sid, n in signer.most_common():
        sname = sam_by_id.get(sid, "(not in Samsara list)")
        link = our_by_sid.get(sid)
        if link:
            linktxt = f"linked -> {link['name']} [{link.get('yard')}]"
        else:
            linktxt = "UNLINKED"
        print(f"{n:>5}  {sid:<12}  {sname[:26]:<26}  {linktxt}")

    # The key flag: a signer whose Samsara last-name matches an interstate driver
    # but is UNLINKED or linked to a non-interstate record → misrouted DVIRs.
    print("\n--- FLAGS: signer looks like an interstate driver but isn't linked to them ---")
    flagged = 0
    for sid, n in signer.most_common():
        link = our_by_sid.get(sid)
        sname = sam_by_id.get(sid, "")
        ln = lastname(sname)
        if ln and ln in interstate_lastnames:
            if link is None:
                print(f"   {n:>3} DVIRs  id={sid}  Samsara={sname!r}  -> UNLINKED (matches an interstate last name)")
                flagged += 1
            elif (link.get("yard") or "").lower() != "interstate":
                print(f"   {n:>3} DVIRs  id={sid}  Samsara={sname!r}  -> linked to NON-interstate {link['name']!r}")
                flagged += 1
    if not flagged:
        print("   none — every signer matching an interstate name is correctly linked to that interstate driver.")
    print()


if __name__ == "__main__":
    main()
