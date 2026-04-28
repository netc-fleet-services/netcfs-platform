# Transport App

**Package**: `@netcfs/transport`  
**Port**: 3002  
**Directory**: `apps/transport/`

## Purpose

Real-time dispatch board for managing towing and transport jobs. Jobs are synced from TowBook every 15 minutes. Dispatchers assign drivers and trucks, track job status, and optimize multi-job stacking.

## Routes

| Route | Access | Purpose |
|-------|--------|---------|
| `/(auth)/login` | Public | Login |
| `/` | Authenticated | Main dispatch board |

## Key Components

### DispatchBoard.tsx
The central client component. Renders a tabbed interface:
- **Jobs** — active job list (default view)
- **Drivers** — available driver list
- **History** — completed jobs
- **Metrics** — dispatch KPIs
- **Settings** — transport configuration

Subscribes to Supabase realtime on the `jobs` table so the board updates automatically when the sync script pushes new data.

### JobCard.tsx
Card for a single job showing pickup/dropoff location, scheduled time, current status, and assigned driver/truck. Color-coded by status.

### JobDetailModal.tsx
Full detail view of a job: all addresses, timing, status history, notes, assigned driver/truck, and action buttons.

### DriverMatchModal.tsx
Assigns a driver to a job. Shows available drivers and filters by proximity or current status.

### NewStackModal.tsx
Creates a new job manually (for jobs not yet in TowBook or entered by dispatch directly).

### OptimizerModal.tsx
Route optimization engine. Given a set of pending jobs, suggests the most efficient assignment and sequencing.

### PossibleStackingModal.tsx
Shows jobs that could be combined into a single driver run based on routing proximity.

### DriversTab.tsx
List of all drivers with current status and current job assignment. Shows which drivers are available.

### HistoryTab.tsx
Completed and cancelled jobs with search/filter.

### MetricsTab.tsx
Operational KPI dashboard with configurable time range (7d, 14d, 30d, All Time) and filters by job type (reason) and location.

**Summary cards**: Fleet Utilization %, Estimated Hours, Total Miles, Total Jobs (+ completed count)

**Fleet Utilization** = estimated hours / (drivers × hours-per-driver-per-day × days in range)

**Daily Trend chart**: Bar chart of the last 14 days showing job count and hours vs capacity. Bars colored green (< 70%), yellow (70–89%), red (≥ 90% capacity).

**Job Types breakdown**: Horizontal bar chart of job count by `tb_reason`, sorted by frequency.

**Driver Scorecards table**: Per-driver metrics — Estimated Hours, Actual Hours (from start/complete timestamps), Miles, Total Jobs, Completed Jobs, Avg Hours per Job. Sorted by total hours.

### SettingsTab.tsx
Four configurable sections:

**TowBook Sync** — GitHub repo (`owner/repo`) and Personal Access Token (Actions: write scope). These are saved to the `settings` Supabase table and shared across all users. The "🔄 Sync TowBook" button on the Schedule tab uses these to trigger the `sync-calls.yml` workflow on demand.

**Yard Locations** — Add, edit, or delete yard records (name, full address, ZIP). Yards are referenced by jobs. Deleting a yard that has jobs assigned will orphan those jobs.

**Working Hours** — Default hours per driver per day (6–14), used to calculate fleet utilization percentage in MetricsTab.

**Driver Roster** — Add, edit, or delete drivers. Each driver has: name, truck number, home yard, and function (e.g., Transport). Changes apply immediately for all users.

## Data Sync

Jobs are populated by `apps/transport/scripts/sync_calls.py`, which runs every 15 minutes via the `sync-calls.yml` GitHub Actions workflow.

See [Data Sync → sync_calls.py](../data-sync.md) for full details.

**Tabs scraped (in precedence order):** Scheduled → Current → Active. When the same call number appears in multiple tabs, the later tab's data wins — Active always has final authority.

**Fields extracted per job:**

| Field | Source |
|-------|--------|
| `tb_call_num` | `data-call-number` attribute on each row |
| `tb_desc` | Vehicle description from `.big-text` element |
| `tb_account` | "Account" field in `.details1` list |
| `pickup_addr` | "Tow Source" field — business names stripped, `(Business Name)` and `, USA` suffixes removed |
| `drop_addr` | "Destination" field — same cleaning applied |
| `tb_reason` | "Reason" field |
| `tb_driver` / `tb_driver_2` | "Driver" field — split on comma/semicolon/multiple spaces for stacked jobs |
| `truck_and_equipment` | "Truck" field or `[columnid='6']` element |
| `day` | Parsed from scheduled time (`4/8/26 7:00 AM` → `2026-04-08`), defaults to today |
| `pickup_lat/lon` | Geocoded (see below) |
| `drop_lat/lon` | Geocoded (see below) |

**Geocoding pipeline** (per address, on each sync run):
1. If address is unchanged and coordinates already exist in DB → reuse stored coords
2. Try Geocodio (if `GEOCODIO_KEY` set): requires accuracy ≥ 0.8, rooftop/interpolated/point type, matching street number, matching ZIP3 prefix — returns USPS-standardized address + rooftop-accurate lat/lon
3. Fall back to Nominatim (OpenStreetMap): free, rate-limited to 1 req/sec, good for street addresses but skips highway/road references
4. Results cached in Supabase forever — only re-geocoded if address changes

**Sync behavior:**
- New TowBook calls → INSERT with `status = 'active'` (if in Active tab) or `'scheduled'`
- Existing calls → UPDATE TowBook fields, preserve dispatcher-managed fields (`yard_id`, `driver_id`, `driver_id_2`, `priority`, `notes`, `stops`)
- Jobs that were `active` in DB but no longer appear in any scraped tab → marked `status = 'complete'`
- Jobs are never deleted — kept for historical reporting in the History tab
- A `settings` table row with `key = 'last_synced'` is updated each run — the UI uses this to display "Last synced X min ago"

## Job Status Flow

```
pending → assigned → in_progress → completed
                  ↘ cancelled
```

Status is updated by dispatchers via the UI and also by the sync script when TowBook reports a status change.

## Geocoding

`sync_calls.py` geocodes pickup and dropoff addresses to add lat/lon coordinates stored on the `jobs` table. The geocoding pipeline (Geocodio → Nominatim fallback) is documented in the Data Sync section above. There is no map view in the current frontend — the coordinates are stored for future use.

## Data Model

Primary table: `jobs`  
Related tables: `drivers` (for assignment), `trucks` (for assignment)

See [Database → jobs](../database.md) for the full schema.
