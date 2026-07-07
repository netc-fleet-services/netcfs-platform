"""
DVIR CAPTURE DIAGNOSTIC — READ ONLY. Makes zero writes to Supabase or Samsara.

Purpose
-------
The safety score's DVIR "misses" are ~85% false and collapse to ~1% completed from
mid-May. That's a *capture / attribution* problem, not a scoring problem. This script
looks at the raw Samsara feed for a date window and answers, in one run:

  1. Does Samsara actually RETURN DVIRs for these days?           (capture)
  2. Do those DVIRs carry a DRIVER id?                            (attribution)
  3. Does that driver id MATCH a driver we've linked?             (linkage)
  4. Do the DVIRs carry a VEHICLE id? (so vehicle->job can work)  (fallback viability)
  5. Is the driver-vehicle ASSIGNMENT feed alive?                 (Strategy-2 viability)
  6. How does that compare, apples-to-apples, to what we recorded (bug vs data)

It prints a plain-English read at the end pointing at the actual fix needed.

Run
---
  Easiest — GitHub Actions (no local key needed):
    Actions → "DVIR Diagnostic" → Run workflow → pick start/end → read the log.

  Local (needs the Samsara key in .env.local at the repo root):
    python dvir_diagnostic.py 2026-06-09 2026-06-13
    #   or:  DIAG_START=2026-06-09 DIAG_END=2026-06-13 python dvir_diagnostic.py

Required vars: SAMSARA_API_KEY, SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL),
SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY).
"""

import os, sys, json, pathlib
from collections import Counter
from datetime import datetime, timezone, date
from zoneinfo import ZoneInfo

import requests
from supabase import create_client

EASTERN  = ZoneInfo("America/New_York")
BASE_URL = "https://api.samsara.com"


# ── env loading (mirrors seed_pm_assignments.py) ────────────────────────────────
def _load_env_local():
    for path in (pathlib.Path(__file__).resolve().parents[3] / ".env.local",
                 pathlib.Path(__file__).resolve().parent / ".env.local"):
        if path.exists():
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    if k.strip() not in os.environ:
                        os.environ[k.strip()] = v.strip()
            break


_load_env_local()

SAMSARA_API_KEY = os.environ.get("SAMSARA_API_KEY", "").strip()
SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()

if not (SAMSARA_API_KEY and SUPABASE_URL and SUPABASE_KEY):
    print("ERROR: need SAMSARA_API_KEY + SUPABASE_URL + SUPABASE_SERVICE_KEY (see header).")
    sys.exit(1)


def _parse_date(s: str, label: str) -> date:
    try:
        return date.fromisoformat(s.strip())
    except (ValueError, AttributeError):
        print(f"ERROR: bad {label} date {s!r} — use YYYY-MM-DD.")
        sys.exit(1)


_args = [a for a in sys.argv[1:] if a]
DIAG_START = _parse_date(_args[0] if len(_args) > 0 else os.environ.get("DIAG_START", "2026-06-09"), "start")
DIAG_END   = _parse_date(_args[1] if len(_args) > 1 else os.environ.get("DIAG_END",   "2026-06-13"), "end")
if DIAG_START > DIAG_END:
    print(f"ERROR: start {DIAG_START} is after end {DIAG_END}.")
    sys.exit(1)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)


def utc_fmt(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def samsara_get(path: str, params: dict) -> list[dict]:
    """Cursor-paginated GET — mirrors sync_samsara_daily.samsara_get (endCursor-safe)."""
    headers = {"Authorization": f"Bearer {SAMSARA_API_KEY}"}
    results: list[dict] = []
    while True:
        resp = requests.get(f"{BASE_URL}{path}", headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        body = resp.json()
        results.extend(body.get("data", []))
        pg = body.get("pagination", {})
        nxt = pg.get("endCursor")
        if not pg.get("hasNextPage") or not nxt:
            break
        params = {**params, "after": nxt}
    return results


def fetch_all(build) -> list[dict]:
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
    start_dt = datetime(DIAG_START.year, DIAG_START.month, DIAG_START.day, 0, 0, 0, tzinfo=EASTERN)
    end_dt   = datetime(DIAG_END.year, DIAG_END.month, DIAG_END.day, 23, 59, 59, tzinfo=EASTERN)
    now_utc  = datetime.now(tz=timezone.utc)

    print(f"\n=== DVIR CAPTURE DIAGNOSTIC  {DIAG_START} → {DIAG_END} (Eastern) ===\n")

    # 1) Drivers / linkage — mirror the pipeline's interstate set
    #    (sync_dvirs: ilike(yard,'interstate') + samsara_driver_id not null).
    try:
        drivers = fetch_all(lambda: sb.table("drivers").select("id, name, samsara_driver_id, yard").order("id"))
    except Exception as e:
        print(f"Supabase read failed (drivers): {e}")
        return
    interstate = [d for d in drivers if (d.get("yard") or "").lower() == "interstate"]
    linked     = [d for d in interstate if d.get("samsara_driver_id") is not None]
    interstate_sam_ids = {d["samsara_driver_id"] for d in linked if d["samsara_driver_id"]}
    sam_to_internal    = {d["samsara_driver_id"]: d["id"] for d in linked if d["samsara_driver_id"]}
    all_sam_ids        = {d["samsara_driver_id"] for d in drivers if d.get("samsara_driver_id")}
    print(f"Drivers: {len(drivers)} total | {len(interstate)} interstate | "
          f"{len(interstate_sam_ids)} interstate linked to Samsara | "
          f"{len(interstate) - len(interstate_sam_ids)} interstate with NO samsara link")
    if not interstate_sam_ids:
        print("  (No linked interstate drivers — Strategy 1/2 cannot work at all.)")

    # 2) Raw DVIR feed
    print("\nFetching /dvirs/stream ...")
    try:
        dvirs = samsara_get("/dvirs/stream", {
            "startTime": utc_fmt(start_dt),
            "endTime":   utc_fmt(now_utc),   # forward-open, matches sync_dvirs
            "limit":     200,
        })
    except Exception as e:
        print(f"  DVIR STREAM API FAILED: {e}")
        print("  → capture is failing at the API level (permission scope? endpoint?). Stop here.")
        return
    print(f"  {len(dvirs)} DVIRs returned (whole fetch window, before date filter)")

    # 3) Tally each DVIR against the window and the matching signals.
    #    Strategy-1 matches are collected as a DEDUPED (sam_id, day) set so they
    #    are comparable to dvir_logs rows (one per driver-day).
    in_window = has_vehicle = has_author_id = 0
    author_other_driver = author_unlinked = 0
    strat1_driverdays: set[tuple[str, str]] = set()
    unlinked_authors: Counter = Counter()
    per_day: Counter = Counter()
    no_ts = parse_fail = 0
    samples: list[dict] = []

    for d in dvirs:
        try:
            ts = d.get("startTime") or d.get("updatedAtTime")
            if not ts:
                no_ts += 1
                continue
            ddate = datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(EASTERN).date()
            if not (DIAG_START <= ddate <= DIAG_END):
                continue
            in_window += 1
            per_day[ddate.isoformat()] += 1
            if (d.get("vehicle") or {}).get("id"):
                has_vehicle += 1
            author = (d.get("authorSignature") or {}).get("driverInfo") or d.get("driver") or {}
            aid    = author.get("id", "") if isinstance(author, dict) else ""
            aname  = author.get("name", "") if isinstance(author, dict) else ""
            if aid:
                has_author_id += 1
                if aid in interstate_sam_ids:
                    strat1_driverdays.add((aid, ddate.isoformat()))
                elif aid in all_sam_ids:
                    author_other_driver += 1
                else:
                    author_unlinked += 1
                    unlinked_authors[(aid, aname)] += 1
            if len(samples) < 3:
                samples.append(d)
        except Exception:
            parse_fail += 1
            continue

    author_in_interstate = len(strat1_driverdays)  # distinct driver-days
    print(f"\nDVIRs dated within window: {in_window}"
          f"   ({no_ts} no-timestamp, {parse_fail} unparseable)")
    if per_day:
        print("  by day: " + ", ".join(f"{k}={v}" for k, v in sorted(per_day.items())))
    print(f"  carry a VEHICLE id:            {has_vehicle}")
    print(f"  carry a DRIVER id (authorSig): {has_author_id}   (no driver id: {in_window - has_author_id})")
    print(f"     ↳ LINKED interstate driver (Strategy 1), distinct driver-days: {author_in_interstate}")
    print(f"     ↳ some other linked driver in our DB:                          {author_other_driver}")
    print(f"     ↳ driver id NOT in our drivers table:                          {author_unlinked}")
    if unlinked_authors:
        print(f"\n  Unlinked DVIR authors ({len(unlinked_authors)} distinct — are these our drivers, just not linked?):")
        for (aid, aname), n in unlinked_authors.most_common(12):
            print(f"     {n:>3}×  id={aid!r}  name={aname!r}")

    # 4) Is the assignment feed (Strategy 2) alive?
    print("\nFetching /fleet/driver-vehicle-assignments (interstate) ...")
    if interstate_sam_ids:
        try:
            asg = samsara_get("/fleet/driver-vehicle-assignments", {
                "filterBy":  "drivers",
                "driverIds": ",".join(interstate_sam_ids),
                "startTime": utc_fmt(start_dt),
                "endTime":   utc_fmt(end_dt),
                "limit":     512,
            })
            covered = len({(a.get("driver") or {}).get("id") for a in asg if (a.get("driver") or {}).get("id")})
            print(f"  {len(asg)} assignment records covering {covered} interstate drivers in window")
        except Exception as e:
            print(f"  ASSIGNMENT API FAILED: {e}  (→ Strategy 2 dead for these days)")
    else:
        print("  skipped (no linked interstate drivers)")

    # 5) Apples-to-apples: of the Strategy-1 driver-days, how many are on days the
    #    driver actually drove (the gate the pipeline applies) — vs what we recorded.
    try:
        ml = fetch_all(lambda: sb.table("mileage_logs").select("driver_id, log_date")
                       .gt("miles", 0)
                       .gte("log_date", DIAG_START.isoformat())
                       .lte("log_date", DIAG_END.isoformat()).order("driver_id"))
        drove = {(r["driver_id"], r["log_date"]) for r in ml}
    except Exception as e:
        print(f"\n  (mileage read failed: {e})")
        drove = set()
    strat1_drove = sum(1 for (aid, day) in strat1_driverdays
                       if (sam_to_internal.get(aid), day) in drove)

    try:
        logs = fetch_all(lambda: sb.table("dvir_logs").select("completed")
                         .eq("source", "samsara")
                         .gte("log_date", DIAG_START.isoformat())
                         .lte("log_date", DIAG_END.isoformat()).order("log_date"))
    except Exception as e:
        print(f"  (dvir_logs read failed: {e})")
        logs = []
    comp = sum(1 for r in logs if r.get("completed"))
    print(f"\nComparable counts for this window:")
    print(f"  Strategy-1 DVIR driver-days on days the driver drove: {strat1_drove}")
    print(f"  dvir_logs rows we recorded completed (all strategies): {comp}   (of {len(logs)} rows)")

    # 6) Raw sample so we can SEE the real shape of a DVIR
    print("\n=== SAMPLE RAW DVIRs (trimmed) ===")
    for s in samples:
        print(json.dumps({
            "id":              s.get("id"),
            "top_level_keys":  sorted(s.keys()),
            "vehicle":         s.get("vehicle"),
            "authorSignature": s.get("authorSignature"),
            "driver":          s.get("driver"),
            "startTime":       s.get("startTime"),
            "updatedAtTime":   s.get("updatedAtTime"),
            "inspectionType":  s.get("inspectionType") or s.get("dvirType") or s.get("safetyStatus"),
        }, indent=2, default=str))
        print("---")

    # 7) Plain-English read
    print("=== READ ===")
    distinct_matched = len({aid for (aid, _) in strat1_driverdays})
    if in_window == 0:
        print("  Samsara returned NO DVIRs for these days → they aren't being captured at all")
        print("  (API permission scope, wrong endpoint, or drivers genuinely submitted none). Fix capture first.")
    elif has_author_id == 0:
        print("  DVIRs come back but carry NO driver id → an app-usage / attribution problem.")
        print("  Strategy 1 & 2 can't work; the vehicle→job fallback is the only path (check the VEHICLE count above).")
    elif len(unlinked_authors) > distinct_matched:
        print("  DVIRs carry driver ids, but more distinct authors are UNLINKED than linked → LINKAGE DATA FIX.")
        print("  Reconcile drivers.samsara_driver_id against the author ids above, then re-run the DVIR backfill.")
    elif strat1_drove > comp:
        print(f"  Samsara has {strat1_drove} matchable Strategy-1 driver-days (that drove) but we recorded only {comp}")
        print("  completed → our sync's matching/gating is dropping real DVIRs. Likely a code fix, not data.")
    else:
        print("  Mixed signal — read the tallies above; the largest bucket points to the fix.")
    print()


if __name__ == "__main__":
    main()
