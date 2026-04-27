"""
Safety Pipeline Diagnostic
Run this to understand why mileage or event points are 0.

Required env vars:
  SUPABASE_URL         — Supabase project URL
  SUPABASE_SERVICE_KEY — Service role key (bypasses RLS)

Optional:
  PERIOD_START — ISO date (default: 90 days ago)
  PERIOD_END   — ISO date (default: today)
"""

import os
from datetime import date, timedelta
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"].strip()
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"].strip()

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

def header(title: str):
    print(f"\n{'─' * 50}")
    print(f"  {title}")
    print(f"{'─' * 50}")

def main():
    period_start = date.fromisoformat(os.environ["PERIOD_START"]) if os.environ.get("PERIOD_START") else date.today() - timedelta(days=90)
    period_end   = date.fromisoformat(os.environ["PERIOD_END"])   if os.environ.get("PERIOD_END")   else date.today()
    print(f"Diagnostic period: {period_start} → {period_end}")

    # ── Drivers ────────────────────────────────────────────────────────────────
    header("Drivers")
    resp = sb.table("drivers").select("id, name, samsara_driver_id, yard").execute()
    drivers = resp.data or []
    linked   = [d for d in drivers if d.get("samsara_driver_id")]
    interstate = [d for d in drivers if (d.get("yard") or "").lower() == "interstate"]
    interstate_linked = [d for d in interstate if d.get("samsara_driver_id")]
    print(f"  Total drivers:           {len(drivers)}")
    print(f"  With samsara_driver_id:  {len(linked)}")
    print(f"  Interstate drivers:      {len(interstate)}")
    print(f"  Interstate + linked:     {len(interstate_linked)}")
    if interstate and not interstate_linked:
        print("  ⚠ No interstate drivers are linked to Samsara — run the daily sync first")

    # ── Safety Events ──────────────────────────────────────────────────────────
    header("Safety Events")
    resp = sb.table("safety_events") \
             .select("id, driver_id, driver_name, occurred_at") \
             .gte("occurred_at", period_start.isoformat()) \
             .lte("occurred_at", f"{period_end.isoformat()}T23:59:59Z") \
             .execute()
    events = resp.data or []
    with_id    = [e for e in events if e.get("driver_id")]
    without_id = [e for e in events if not e.get("driver_id")]
    print(f"  Total events in period:  {len(events)}")
    print(f"  With driver_id:          {len(with_id)}")
    print(f"  Without driver_id (null):{len(without_id)}")
    if without_id:
        names = sorted({(e.get("driver_name") or "").strip() for e in without_id if e.get("driver_name")})
        print(f"  Unlinked driver names ({len(names)} unique):")
        for n in names[:15]:
            print(f"    {n!r}")
        if len(names) > 15:
            print(f"    … and {len(names) - 15} more")

    # Also check events outside the period (in case period is wrong)
    resp_all = sb.table("safety_events").select("id, occurred_at").execute()
    all_events = resp_all.data or []
    if all_events:
        dates = sorted(e["occurred_at"][:10] for e in all_events if e.get("occurred_at"))
        if dates:
            print(f"  All-time event date range: {dates[0]} → {dates[-1]}")
            in_period = sum(1 for d in dates if period_start.isoformat() <= d <= period_end.isoformat())
            print(f"  Events in your period: {in_period} of {len(dates)}")
            if in_period == 0 and dates:
                print(f"  ⚠ No events fall in {period_start} → {period_end} — check PERIOD_START/PERIOD_END")

    # ── Jobs (coordinates) ─────────────────────────────────────────────────────
    header("Jobs — Coordinate Coverage")
    resp_coords = sb.table("jobs") \
                    .select("id, driver_id, tb_driver") \
                    .gte("day", period_start.isoformat()) \
                    .lte("day", period_end.isoformat()) \
                    .not_.is_("pickup_lat", "null") \
                    .not_.is_("drop_lat",   "null") \
                    .execute()
    resp_total = sb.table("jobs") \
                   .select("id") \
                   .gte("day", period_start.isoformat()) \
                   .lte("day", period_end.isoformat()) \
                   .execute()
    jobs_with_coords = resp_coords.data or []
    jobs_total       = resp_total.data or []
    print(f"  Total jobs in period:    {len(jobs_total)}")
    print(f"  Jobs with coordinates:   {len(jobs_with_coords)}")
    if jobs_total and not jobs_with_coords:
        print("  ⚠ No jobs have lat/lon — geocoding may not have run for this period")
        print("    → Run backfill_coords.py to geocode historical jobs")

    if jobs_with_coords:
        with_driver_id  = sum(1 for j in jobs_with_coords if j.get("driver_id"))
        with_tb_driver  = sum(1 for j in jobs_with_coords if not j.get("driver_id") and j.get("tb_driver"))
        no_driver_at_all = sum(1 for j in jobs_with_coords if not j.get("driver_id") and not j.get("tb_driver"))
        print(f"  Of those with coords:")
        print(f"    driver_id set:         {with_driver_id}")
        print(f"    tb_driver only:        {with_tb_driver}")
        print(f"    no driver at all:      {no_driver_at_all}")
        if no_driver_at_all == len(jobs_with_coords):
            print("  ⚠ All coord jobs have no driver — mileage haversine will produce 0 rows")

    # ── Mileage Logs ───────────────────────────────────────────────────────────
    header("Mileage Logs")
    resp = sb.table("mileage_logs") \
             .select("driver_id, log_date, miles, source") \
             .gte("log_date", period_start.isoformat()) \
             .lte("log_date", period_end.isoformat()) \
             .execute()
    ml_rows = resp.data or []
    print(f"  Total rows in period:    {len(ml_rows)}")
    if ml_rows:
        by_source: dict[str, int] = {}
        for r in ml_rows:
            src = r.get("source") or "unknown"
            by_source[src] = by_source.get(src, 0) + 1
        for src, cnt in sorted(by_source.items()):
            print(f"    {src}: {cnt} rows")
        total_miles = sum(float(r.get("miles") or 0) for r in ml_rows)
        print(f"  Total miles logged:      {total_miles:,.0f}")
        driver_count = len({r["driver_id"] for r in ml_rows if r.get("driver_id")})
        print(f"  Distinct drivers:        {driver_count}")
    else:
        print("  ⚠ mileage_logs is empty for this period")

    # Check all-time range in case period mismatch
    resp_all = sb.table("mileage_logs").select("log_date").execute()
    all_ml = resp_all.data or []
    if all_ml:
        ml_dates = sorted(r["log_date"] for r in all_ml if r.get("log_date"))
        if ml_dates:
            print(f"  All-time log_date range: {ml_dates[0]} → {ml_dates[-1]}")

    # ── Score Snapshots ────────────────────────────────────────────────────────
    header("Score Snapshots")
    resp = sb.table("score_snapshots") \
             .select("driver_id, driver_name, period_start, total_event_points, miles_driven, safety_score") \
             .execute()
    snaps = resp.data or []
    periods = sorted({s.get("period_start") for s in snaps if s.get("period_start")})
    print(f"  Total snapshots:         {len(snaps)}")
    print(f"  Periods present:         {periods or 'none'}")
    for p in periods:
        ps = [s for s in snaps if s.get("period_start") == p]
        with_miles  = sum(1 for s in ps if (s.get("miles_driven") or 0) > 0)
        with_points = sum(1 for s in ps if (s.get("total_event_points") or 0) > 0)
        print(f"  {p}: {len(ps)} drivers — {with_miles} with miles, {with_points} with event points")

    print("\nDiagnostic complete.")


if __name__ == "__main__":
    main()
