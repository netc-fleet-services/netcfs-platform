"""
DRIVER LINK CHECK — READ ONLY. Verifies our stored drivers.samsara_driver_id maps to
the SAME person in Samsara. If a non-filing driver's stored id actually belongs to
someone else (or isn't a real Samsara driver id), their DVIRs would never match.

Run:  python dvir_linkcheck.py
"""
import os, sys, pathlib
from datetime import datetime

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


def norm(s):
    return " ".join((s or "").lower().replace(",", " ").split())


def main():
    sb = S.sb
    # Samsara's own driver directory: id -> name
    sam = S.samsara_get("/fleet/drivers", {"limit": 512})
    sam_by_id = {d.get("id"): (d.get("name") or "") for d in sam}
    print(f"Samsara returned {len(sam_by_id)} drivers\n")

    ours = (sb.table("drivers").select("id, name, samsara_driver_id, yard")
            .not_.is_("samsara_driver_id", "null").execute().data or [])
    interstate = [d for d in ours if (d.get("yard") or "").lower() == "interstate"]

    print(f"Checking {len(interstate)} linked interstate drivers (our name  vs  Samsara's name for that id):\n")
    ok = mismatch = missing = 0
    problems = []
    for d in sorted(interstate, key=lambda x: x.get("name") or ""):
        sid = d["samsara_driver_id"]
        our = d.get("name") or ""
        if sid not in sam_by_id:
            missing += 1
            problems.append((our, sid, "*** id NOT in Samsara driver list ***"))
        else:
            sname = sam_by_id[sid]
            if norm(our) == norm(sname) or norm(our).split()[-1:] == norm(sname).split()[-1:]:
                ok += 1
            else:
                mismatch += 1
                problems.append((our, sid, f"Samsara says: {sname!r}"))

    if problems:
        print("  POTENTIAL LINK PROBLEMS:")
        for our, sid, note in problems:
            print(f"    our={our!r:<26} id={sid}  {note}")
    else:
        print("  (no obvious link problems)")
    print(f"\n  {ok} names match, {mismatch} name MISMATCH, {missing} id not-in-Samsara")


if __name__ == "__main__":
    main()
