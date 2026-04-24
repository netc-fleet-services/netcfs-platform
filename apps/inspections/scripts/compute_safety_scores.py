"""
Quarterly Safety Score Engine
Runs at the end of each quarter via GitHub Actions, or on-demand.

Reads from:  safety_events, mileage_logs, dvir_logs, compliance_events, drivers
Writes to:   score_snapshots (skips rows where locked=true)

Scoring rules:
  severity_rate   = (total_event_points / miles_driven) * 1000, capped at 95
  driving_score   = 100 - severity_rate
  dvir_penalty    = dvir_days_missed * 2
  compliance_penalty = sum(compliance_event.points) + dvir_penalty
  safety_score    = max(5, driving_score - compliance_penalty)

Eligibility:
  eligible     = miles_driven >= 2000
  disqualified = has any OOS or accident compliance event in the period

Ranking:
  - Interstate drivers (yard = 'interstate') ranked as their own group
  - All other drivers ranked within their function group
  - Only eligible, non-disqualified drivers receive a rank

Required env vars:
  SUPABASE_URL         — Supabase project URL
  SUPABASE_SERVICE_KEY — Service role key (bypasses RLS)

Optional env vars:
  PERIOD_START — ISO date, e.g. 2026-01-01 (overrides auto-detect)
  PERIOD_END   — ISO date, e.g. 2026-03-31 (overrides auto-detect)
"""

import os
from datetime import date, datetime, timezone
from collections import defaultdict
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

MIN_MILES_ELIGIBLE  = 2000
MIN_SAFETY_SCORE    = 5
MAX_SEVERITY_RATE   = 95

# ── Quarter helpers ────────────────────────────────────────────────────────────

def last_completed_quarter() -> tuple[date, date]:
    """Returns (period_start, period_end) for the most recently completed quarter."""
    today = date.today()
    # Back up one day so running on quarter boundaries is safe
    ref = date(today.year, today.month, 1)
    # Quarter boundaries: Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec
    q_starts = [1, 4, 7, 10]
    current_q_start_month = max(m for m in q_starts if m <= ref.month)
    # Previous quarter
    if current_q_start_month == 1:
        start = date(ref.year - 1, 10, 1)
        end   = date(ref.year - 1, 12, 31)
    else:
        prev_start_month = q_starts[q_starts.index(current_q_start_month) - 1]
        end_month        = current_q_start_month - 1
        end_day          = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][end_month - 1]
        # Leap year check
        if end_month == 2 and (ref.year % 4 == 0 and (ref.year % 100 != 0 or ref.year % 400 == 0)):
            end_day = 29
        start = date(ref.year, prev_start_month, 1)
        end   = date(ref.year, end_month, end_day)
    return start, end

def get_period() -> tuple[date, date]:
    raw_start = os.environ.get("PERIOD_START")
    raw_end   = os.environ.get("PERIOD_END")
    if raw_start and raw_end:
        return date.fromisoformat(raw_start), date.fromisoformat(raw_end)
    return last_completed_quarter()

# ── Data loaders ───────────────────────────────────────────────────────────────

def load_drivers() -> list[dict]:
    resp = sb.table("drivers") \
             .select("id, name, yard, function") \
             .execute()
    return resp.data or []

def load_event_points(period_start: date, period_end: date) -> dict[int, int]:
    """Returns {driver_id: total_severity_points} for the period."""
    resp = sb.table("safety_events") \
             .select("driver_id, severity_points") \
             .gte("occurred_at", period_start.isoformat()) \
             .lte("occurred_at", f"{period_end.isoformat()}T23:59:59Z") \
             .not_.is_("driver_id", "null") \
             .execute()
    totals: dict[int, int] = defaultdict(int)
    for row in (resp.data or []):
        totals[row["driver_id"]] += (row["severity_points"] or 0)
    return dict(totals)

def load_miles(period_start: date, period_end: date) -> dict[int, float]:
    """Returns {driver_id: total_miles} for the period."""
    resp = sb.table("mileage_logs") \
             .select("driver_id, miles") \
             .gte("log_date", period_start.isoformat()) \
             .lte("log_date", period_end.isoformat()) \
             .not_.is_("driver_id", "null") \
             .execute()
    totals: dict[int, float] = defaultdict(float)
    for row in (resp.data or []):
        totals[row["driver_id"]] += float(row["miles"] or 0)
    return dict(totals)

def load_dvir_misses(period_start: date, period_end: date) -> dict[int, int]:
    """Returns {driver_id: days_missed} — only rows where completed=false."""
    resp = sb.table("dvir_logs") \
             .select("driver_id") \
             .gte("log_date", period_start.isoformat()) \
             .lte("log_date", period_end.isoformat()) \
             .eq("completed", False) \
             .not_.is_("driver_id", "null") \
             .execute()
    counts: dict[int, int] = defaultdict(int)
    for row in (resp.data or []):
        counts[row["driver_id"]] += 1
    return dict(counts)

def load_compliance(period_start: date, period_end: date) -> dict[int, dict]:
    """
    Returns {driver_id: {points: int, disqualified: bool}}.
    disqualified=True when any event_type in ('oos', 'accident').
    """
    resp = sb.table("compliance_events") \
             .select("driver_id, event_type, points") \
             .gte("event_date", period_start.isoformat()) \
             .lte("event_date", period_end.isoformat()) \
             .not_.is_("driver_id", "null") \
             .execute()
    result: dict[int, dict] = defaultdict(lambda: {"points": 0, "disqualified": False})
    for row in (resp.data or []):
        did = row["driver_id"]
        result[did]["points"] += (row["points"] or 0)
        if row["event_type"] in ("oos", "accident"):
            result[did]["disqualified"] = True
    return dict(result)

def load_locked_keys(period_start: date, period_end: date) -> set[int]:
    """Returns set of driver_ids whose snapshot for this period is already locked."""
    resp = sb.table("score_snapshots") \
             .select("driver_id") \
             .eq("period_start", period_start.isoformat()) \
             .eq("period_end", period_end.isoformat()) \
             .eq("locked", True) \
             .execute()
    return {r["driver_id"] for r in (resp.data or [])}

# ── Ranking ────────────────────────────────────────────────────────────────────

def rank_group(driver: dict) -> str:
    """Interstate drivers get their own rank group; others group by function."""
    if (driver.get("yard") or "").lower() == "interstate":
        return "interstate"
    return (driver.get("function") or "other").lower()

def assign_ranks(snapshots: list[dict]) -> list[dict]:
    """
    Assigns rank within rank_group.
    Only eligible + non-disqualified drivers are ranked.
    Ranked by safety_score descending (higher = better rank).
    """
    by_group: dict[str, list[dict]] = defaultdict(list)
    for s in snapshots:
        if s["eligible"] and not s["disqualified"]:
            by_group[s["rank_group"]].append(s)

    for group, members in by_group.items():
        members.sort(key=lambda s: s["safety_score"], reverse=True)
        for i, s in enumerate(members, start=1):
            s["rank"] = i

    return snapshots

# ── Score computation ──────────────────────────────────────────────────────────

def compute_scores(
    period_start: date,
    period_end:   date,
    drivers:      list[dict],
    event_points: dict[int, int],
    miles_map:    dict[int, float],
    dvir_misses:  dict[int, int],
    compliance:   dict[int, dict],
    locked_ids:   set[int],
) -> list[dict]:

    snapshots = []

    for drv in drivers:
        did = drv["id"]

        if did in locked_ids:
            print(f"  Skipping {drv['name']} — snapshot locked")
            continue

        total_points   = event_points.get(did, 0)
        miles          = miles_map.get(did, 0.0)
        dvir_missed    = dvir_misses.get(did, 0)
        comp_info      = compliance.get(did, {"points": 0, "disqualified": False})

        # Driving score
        if miles > 0:
            severity_rate = min((total_points / miles) * 1000, MAX_SEVERITY_RATE)
        else:
            severity_rate = 0.0
        driving_score = 100.0 - severity_rate

        # Compliance penalty
        dvir_penalty        = dvir_missed * 2
        compliance_penalty  = comp_info["points"] + dvir_penalty

        # Final score
        safety_score = max(MIN_SAFETY_SCORE, driving_score - compliance_penalty)

        snapshots.append({
            "driver_id":           did,
            "driver_name":         drv["name"],
            "driver_yard":         drv.get("yard"),
            "driver_function":     drv.get("function"),
            "period_start":        period_start.isoformat(),
            "period_end":          period_end.isoformat(),
            "total_event_points":  total_points,
            "miles_driven":        round(miles, 2),
            "severity_rate":       round(severity_rate, 4),
            "driving_score":       round(driving_score, 4),
            "dvir_days_missed":    dvir_missed,
            "dvir_penalty":        dvir_penalty,
            "compliance_penalty":  compliance_penalty,
            "safety_score":        round(safety_score, 4),
            "eligible":            miles >= MIN_MILES_ELIGIBLE,
            "disqualified":        comp_info["disqualified"],
            "rank":                None,
            "rank_group":          rank_group(drv),
            "locked":              False,
        })

    return snapshots

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    period_start, period_end = get_period()
    print(f"\nComputing safety scores for {period_start} → {period_end}")

    drivers = load_drivers()
    print(f"  {len(drivers)} drivers in table")

    locked_ids   = load_locked_keys(period_start, period_end)
    event_points = load_event_points(period_start, period_end)
    miles_map    = load_miles(period_start, period_end)
    dvir_misses  = load_dvir_misses(period_start, period_end)
    compliance   = load_compliance(period_start, period_end)

    print(f"  {len(locked_ids)} locked snapshots (will be skipped)")
    print(f"  {len(event_points)} drivers with safety events")
    print(f"  {len(miles_map)} drivers with mileage")
    print(f"  {len(dvir_misses)} drivers with DVIR misses")
    print(f"  {len(compliance)} drivers with compliance events")

    snapshots = compute_scores(
        period_start, period_end,
        drivers, event_points, miles_map, dvir_misses, compliance, locked_ids,
    )

    snapshots = assign_ranks(snapshots)

    if not snapshots:
        print("\nNo snapshots to write.")
        return

    sb.table("score_snapshots").upsert(
        snapshots,
        on_conflict="driver_id,period_start,period_end",
    ).execute()

    eligible_count = sum(1 for s in snapshots if s["eligible"])
    disq_count     = sum(1 for s in snapshots if s["disqualified"])

    print(f"\nUpserted {len(snapshots)} snapshots")
    print(f"  {eligible_count} eligible, {disq_count} disqualified")

    # Print leaderboard summary per group
    by_group: dict[str, list[dict]] = defaultdict(list)
    for s in snapshots:
        by_group[s["rank_group"]].append(s)

    for group in sorted(by_group):
        members = sorted(by_group[group], key=lambda s: s["safety_score"], reverse=True)
        print(f"\n  [{group.upper()}]")
        for s in members[:5]:
            rank_str  = f"#{s['rank']}" if s["rank"] else "—"
            flag      = " (DQ)" if s["disqualified"] else ("" if s["eligible"] else " (ineligible)")
            print(f"    {rank_str:>4}  {s['driver_name']:<25}  "
                  f"score={s['safety_score']:>6.1f}  "
                  f"miles={s['miles_driven']:>7.0f}  "
                  f"pts={s['total_event_points']:>4}{flag}")

    print("\nScoring complete.")


if __name__ == "__main__":
    main()
