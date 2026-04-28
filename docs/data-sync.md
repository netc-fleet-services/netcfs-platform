# Data Sync

External data enters the platform through Python scripts triggered by GitHub Actions. There are two data sources: **Samsara** (vehicle telematics API) and **TowBook** (browser automation / CSV export).

## GitHub Actions Workflows

| Workflow | File | Trigger | App |
|----------|------|---------|-----|
| Sync Samsara Events | `sync-samsara-events.yml` | Every 15 min | inspections |
| Sync Samsara Daily | `sync-samsara-daily.yml` | Daily 06:00 UTC | inspections |
| Backfill Samsara | `backfill-samsara.yml` | Manual (`workflow_dispatch`) | inspections |
| Compute Safety Scores | `compute-safety-scores.yml` | Daily 07:00 UTC + quarterly | inspections |
| Sync TowBook Jobs | `sync-calls.yml` | Every 15 min | transport |
| Sync TowBook Impounds | `sync-towbook.yml` | Every 4 hours + manual | impounds |
| Diagnose Safety | `diagnose-safety.yml` | Manual | inspections |

All workflows run on `ubuntu-latest` and use the following secrets from the GitHub repository:

```
SUPABASE_URL
SUPABASE_SERVICE_KEY
SAMSARA_API_KEY
TOWBOOK_USER
TOWBOOK_PASS
GEOCODIO_KEY          (optional — transport only)
GITHUB_PAT            (workflow scope — used by BackfillTrigger UI)
```

---

## Samsara Integration

Samsara is the vehicle telematics platform. Trucks have Samsara dashcams that detect safety events and record trip GPS data. Drivers on tablets submit DVIRs through the Samsara app.

### sync_samsara_events.py — Safety Events (every 15 min)

**Source**: Samsara Safety Events API  
**Destination**: `safety_events` table

Process:
1. Fetches all safety events updated in the last 72 hours (rolling window to catch status changes)
2. For each event, determines the driver from the vehicle assignment at the time of the event
3. Applies severity point mapping:

| Event Type | Points |
|-----------|--------|
| Mobile phone use | 10 |
| Seatbelt violation | 5 |
| Distracted driving | 5 |
| Rolling stop | 2 |
| Speeding 1–5 mph over | 1 |
| Speeding 6–10 mph over | 3 |
| Speeding 11–15 mph over | 5 |
| Speeding 16–20 mph over | 8 |
| Speeding 21+ mph over | 10 |
| Harsh braking / acceleration | 1 |

4. Maps Samsara coaching status to `final_status`:
   - `needsReview` → `pending`
   - coached → `coached`
   - dismissed → `dismissed`
5. Upserts to `safety_events` on conflict `samsara_event_id`

---

### sync_samsara_daily.py — Mileage + DVIRs (daily at 06:00 UTC / 2:00 AM ET)

**Source**: Samsara Trips API, DVIR Stream API  
**Destination**: `mileage_logs`, `dvir_logs` tables

**Mileage sync:**
1. Fetches all trips from the previous calendar day
2. Groups miles by driver via vehicle-assignment reverse mapping (see DVIR matching below)
3. Upserts to `mileage_logs` on conflict `(driver_id, log_date)`

**DVIR sync:**

Important context: Drivers at this company do not use the Samsara driver app. They log in at the vehicle, not with a personal driver account. As a result, DVIRs from Samsara have `vehicle.id` but `driver: null`. The sync resolves DVIRs to drivers through vehicle assignment timestamps.

1. Loads driver-vehicle assignments from the database (which driver had which vehicle, and when)
2. Builds a reverse mapping: `vehicle_id → [(driver_sam_id, start_ms, end_ms)]`
3. Fetches DVIR stream for the previous day using `updatedAtTime` filter, then queries through `now_utc` to catch DVIRs resolved after the day ended
4. For each DVIR, finds the driver who had that vehicle at the DVIR's `startTime`
5. Loads all `manually_overridden = true` rows — skips upsert for those
6. Upserts remaining rows to `dvir_logs` on conflict `(driver_id, log_date)`

> Only interstate drivers submit DVIRs via Samsara. Local drivers use TowBook. DVIR logs are only created for drivers who appear in vehicle assignments.

---

### backfill_samsara.py — Historical Backfill (manual)

**Trigger**: Manual via GitHub Actions `workflow_dispatch` (inputs: `BACKFILL_START`, `BACKFILL_END`) or via the Admin tab in the inspections app frontend.

**What it does**: Same logic as `sync_samsara_daily.py` but over a specified date range instead of yesterday. Used when:
- First setting up the platform for a new quarter
- A sync failed and data needs to be re-fetched
- Driver-vehicle assignments were corrected and scores need to be recalculated

The frontend trigger is in `apps/inspections/components/BackfillTrigger.tsx`, which calls the API route at `apps/inspections/app/api/trigger-backfill/route.ts`. That route POSTs to the GitHub `workflow_dispatch` endpoint using the `GITHUB_PAT` secret.

---

### compute_safety_scores.py — Scoring (daily at 07:00 UTC + quarterly)

**Source**: `safety_events`, `mileage_logs`, `dvir_logs`, `compliance_events`  
**Destination**: `score_snapshots`

**Scoring formula:**

```
severity_rate     = (total_event_points / miles_driven) * 1000   # capped at 95
driving_score     = 100 - severity_rate
dvir_penalty      = dvir_days_missed * 2
compliance_penalty = sum(compliance_event.points) + dvir_penalty
safety_score      = max(5, driving_score - compliance_penalty)
```

**Eligibility:**
- `eligible = True` if `miles_driven >= 2,000` in the period
- `disqualified = True` if any `oos` or `accident` compliance event exists for the driver in the period

**Ranking:**
- Drivers are grouped by `driver_function` (e.g., `interstate`, `local`, `driveway`)
- Ranked within each group, best score first
- Tiebreakers: safety_score DESC → total_event_points ASC → miles_driven DESC
- Ineligible and disqualified drivers appear in the list but are not ranked

**Quarter locking:**
- On the 1st of January, April, July, and October, the script finalizes the prior quarter: sets `locked = true` on all prior-quarter snapshots
- Subsequent runs skip locked rows
- The current quarter is always recalculated (accumulates YTD)

**Manual override via workflow inputs** (`PERIOD_START`, `PERIOD_END`): allows computing scores for a specific date range, e.g., to recompute after a backfill.

---

## TowBook Integration

TowBook is the company's dispatch and impound management software. It has no public API. Data is extracted via **Playwright** (headless Chromium) that logs into TowBook with stored credentials and scrapes or exports data.

### sync_calls.py — Transport Jobs (every 15 min)

**Source**: TowBook dispatch board (Playwright scrape)  
**Destination**: `jobs` table

Process:
1. Launches headless Chromium, logs into TowBook
2. Navigates to the active calls/dispatch page
3. Scrapes job rows from the TowBook grid
4. Optionally geocodes addresses using the Geocodio API (if `GEOCODIO_KEY` is set)
5. Upserts to `jobs` on conflict `reference_number`
6. Marks jobs no longer in TowBook's active list as `cancelled`

> **Gap**: The exact columns scraped (job fields extracted from TowBook) should be documented here if the field mapping is not obvious from the script.

---

### sync_impounds.py — Impound Inventory (every 4 hours)

**Source**: TowBook Impounds page CSV export  
**Destination**: `impounds` table

Process:
1. Launches headless Chromium, logs into TowBook
2. Navigates to the Impounds page
3. Clicks the w2ui toolbar "Export" button with `force=True` (element exists in DOM but fails Playwright's visibility check in headless mode)
4. Intercepts the file download (`accept_downloads=True` on the browser context)
5. Parses the CSV:
   - Skips 2 metadata rows before the actual header row
   - Finds header row by looking for a row containing the word "call" (case-insensitive)
   - Uses flexible column matching (not positional) to handle TowBook column reordering
6. Parses dates by splitting on space first (`"4/30/2026 12:00 AM"` → `"4/30/2026"`) then trying multiple format strings
7. Extracts city from full location string
8. Splits combined vehicle fields into year/make/model components
9. Upserts to `impounds` on conflict `call_number`
10. Preserves manual fields on UPDATE: notes, sell flag, estimated_value, sales_description, needs_detail, needs_mechanic, estimated_repair_cost

**Why CSV export instead of scraping the table**: TowBook renders the impound grid as a JavaScript (w2ui) component, not a plain HTML table. `querySelectorAll('table tbody tr')` returns nothing. The CSV export is the only reliable way to get the full dataset.

---

## Running Sync Jobs Manually

### From GitHub Actions UI
Go to the **Actions** tab in the repository → select the workflow → click **Run workflow** → fill in any inputs.

### From the Inspections App Frontend (backfill only)
Admin tab → "Backfill Samsara Data" → enter date range → click **Run Backfill**. Requires the `GITHUB_PAT` environment variable to be set in the Vercel deployment.

### Locally
```bash
export SUPABASE_URL=...
export SUPABASE_SERVICE_KEY=...
export SAMSARA_API_KEY=...
export TOWBOOK_USER=...
export TOWBOOK_PASS=...

python apps/inspections/scripts/backfill_samsara.py --start 2026-04-01 --end 2026-04-28
python apps/inspections/scripts/compute_safety_scores.py --start 2026-04-01 --end 2026-04-28
python apps/impounds/scripts/sync_impounds.py
```
