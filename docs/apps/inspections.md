# Inspections App (Safety)

**Package**: `@netcfs/safety`  
**Port**: 3003  
**Directory**: `apps/inspections/`

## Purpose

Quarterly driver safety program. Pulls safety event data from Samsara, tracks DVIR (Daily Vehicle Inspection Report) completion, records compliance incidents (DOT citations, OOS orders, accidents), and computes a ranked safety score for every driver. The safety manager reviews the leaderboard, investigates driver detail breakdowns, and can manually verify missed DVIRs.

## Routes

| Route | Access | Purpose |
|-------|--------|---------|
| `/(auth)/login` | Public | Login |
| `/` | Authenticated | Main safety app (tabbed) |
| `/api/trigger-backfill` | Server | API route to dispatch GitHub workflow |

## App Tabs

The main app (`SafetyApp.tsx`) has three tabs:

| Tab | Component | Purpose |
|-----|-----------|---------|
| Safety Dashboard | `SafetyDashboard.tsx` | Driver leaderboard and scoring |
| Pre-Trip Audit | `PreTripAuditTool.tsx` | DVIR entry tool |
| Admin | `AdminTab` in `SafetyApp.tsx` | Backfill trigger |

---

## Safety Dashboard

### SafetyDashboard.tsx

The leaderboard. Reads from `score_snapshots` for the current quarter. Shows:

- Summary cards (average score, total event points, DVIR missed, disqualified count)
- Period selector (current quarter, or past quarters)
- Driver table grouped by `rank_group` (Interstate, Local, etc.)

**Table columns**: Rank, Driver Name, Yard, Safety Score, Miles, Event Points, Severity Rate, DVIR Missed, Compliance Penalty

**Row coloring**:
- Disqualified rows are visually distinguished (red/muted)
- Ineligible rows (< 2,000 miles) are shown but unranked

**Sorting**: Within each group, rows are sorted by safety_score DESC → total_event_points ASC → miles_driven DESC (tiebreakers).

Clicking a driver row opens `DriverDetailModal`.

### DriverDetailModal.tsx

Modal showing a full breakdown for one driver over the selected period. Sections:

**Score cards**: Safety Score, Miles Driven, Event Points, Severity Rate, DVIR Missed, Compliance Penalty

**Compliance Events**: DOT citations, OOS orders, accidents with dates and point deductions

**Safety Events**: All Samsara events with type, date, unit number (if applicable), speed info (for speeding events), severity points, and coached/dismissed/pending status

**DVIR Log**: Grid of every day in the period. Green = completed, amber = missed. Missed days can be clicked to manually mark as verified (writes `completed = true, manually_overridden = true` to `dvir_logs`). A "M" badge indicates a day that was manually verified. The save animates with opacity fade while the Supabase update completes.

---

## Pre-Trip Audit Tool

### PreTripAuditTool.tsx

Allows safety managers or dispatchers to manually enter DVIR records for drivers who don't use Samsara (e.g., local drivers who do paper DVIRs via TowBook). Writes to `dvir_logs` with `source = 'manual'`.

> **Gap**: The exact form fields and workflow for the Pre-Trip Audit Tool should be expanded here.

---

## Admin Tab

### BackfillTrigger.tsx

A form with two date pickers (start date, end date) and a **Run Backfill** button. Defaults to the current quarter start through today.

On submit:
1. POSTs to `/api/trigger-backfill` with `{ start, end }`
2. API route validates inputs, checks `GITHUB_PAT` env var
3. POSTs to GitHub `workflow_dispatch` API: `POST /repos/netc-fleet-services/netcfs-platform/actions/workflows/backfill-samsara.yml/dispatches`
4. GitHub returns 204 on success
5. Button shows green confirmation with a link to the GitHub Actions tab

The `GITHUB_PAT` needs **workflow** scope. Set it in Vercel environment variables for the inspections app deployment.

---

## Compliance Entry

### ComplianceEntryModal.tsx

Form for recording a compliance incident against a driver:
- Driver (dropdown from `drivers` table)
- Event type: DOT Citation, Out of Service, Accident, Other
- Date, points, notes, entered_by

OOS and Accident entries automatically set `disqualified = true` on the driver's current quarter `score_snapshot` during the next score compute run.

---

## Scoring Formula

Full detail in [Data Sync → compute_safety_scores.py](../data-sync.md), but in brief:

```
severity_rate      = (total_event_points / miles_driven) * 1000   [capped at 95]
driving_score      = 100 - severity_rate
dvir_penalty       = dvir_days_missed * 2
compliance_penalty = sum(compliance_event.points) + dvir_penalty
safety_score       = max(5, driving_score - compliance_penalty)
```

**Eligibility**: `miles_driven >= 2,000` in the period  
**Disqualified**: Any OOS or accident compliance event — driver appears in table but is excluded from rankings  
**Ranking groups**: Interstate drivers are ranked separately from other function groups

---

## DVIR Matching (Important)

Drivers at this company do not use the Samsara driver app. They authenticate at the vehicle level, not with personal driver accounts. Consequently, DVIRs from Samsara have `vehicle.id` but `driver: null`.

The daily sync resolves DVIRs to drivers by:
1. Loading the driver-vehicle assignment table from Supabase (which driver had which vehicle, and for what time window)
2. Building a reverse map: `vehicle_id → [(driver_samsara_id, start_ms, end_ms)]`
3. For each DVIR, finding the driver who had that vehicle at the DVIR's `startTime`

If no matching assignment is found, the DVIR is dropped (not linked to any driver).

---

## Manual DVIR Override

Safety managers can click a missed DVIR date in `DriverDetailModal` to mark it as verified. This:
- Updates `dvir_logs` → `completed = true, manually_overridden = true`
- Updates local React state immediately (optimistic update)
- Shows an "M" badge on the tile

Future sync runs load all `manually_overridden = true` rows before upserting and skip them entirely. Manual verifications are never overwritten by automated syncs.

---

## Backend Scripts

| Script | Trigger | Purpose |
|--------|---------|---------|
| `sync_samsara_events.py` | Every 15 min | Fetch safety events, map to drivers, upsert |
| `sync_samsara_daily.py` | Daily 06:00 UTC | Sync mileage and DVIR completion |
| `backfill_samsara.py` | Manual | Backfill historical data for a date range |
| `compute_safety_scores.py` | Daily 07:00 UTC + quarterly | Compute and rank safety scores |
| `diagnose_safety.py` | Manual | Debugging — logs discrepancies in safety tables |

See [Data Sync](../data-sync.md) for full documentation of each script.

---

## Known Driver Matching Issues

Drivers are matched from Samsara by `samsara_driver_id` (if set on the `drivers` row) or by normalized name comparison. A few drivers have nickname mismatches between TowBook and Samsara:

> **Gap**: List the specific name mismatches here (e.g., "Larry Page" in one system vs a different name in the other) once they are resolved. These require manual linking in Supabase by setting `samsara_driver_id` on the `drivers` row.

Some TowBook driver names that do not yet have a corresponding row in the `drivers` table should be added:
> **Gap**: Add the list of unmatched drivers (Keagan Mosley, Matt Cashin, Jon Wall, Rich Grigway, Pat Foster, Josh Moulton) once they are confirmed and their rows are created.

---

## Data Model

Primary tables: `safety_events`, `dvir_logs`, `mileage_logs`, `compliance_events`, `score_snapshots`  
Related: `drivers` (for driver lookup), `trucks` (for vehicle-to-driver resolution)

See [Database](../database.md) for full schema.
