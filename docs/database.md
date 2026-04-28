# Database

All data lives in a single **Supabase (Postgres)** project shared across all six apps.

## Connection

- **Browser/client components**: `getSupabaseBrowserClient()` from `@netcfs/auth/client` — uses the anon key, subject to RLS
- **Server components**: `getSupabaseServerClient()` from `@netcfs/auth/server` — uses the anon key + session cookie, subject to RLS
- **Backend scripts**: direct Supabase client with the **service role key** — bypasses RLS entirely

## Tables

### profiles
User accounts, synced from Supabase Auth. Created automatically on first login.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Matches `auth.users.id` |
| email | text | |
| full_name | text | |
| role | text | One of: `admin`, `shop_manager`, `dispatcher`, `mechanic`, `driver`, `viewer`, `impound_manager` |
| avatar_url | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

---

### trucks
Fleet vehicles. The fleet app is the primary consumer.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| unit_number | text | Human-readable truck identifier (e.g., "T-42") |
| location | text | Yard/location |
| status | text | Current operational status |
| year | int | |
| make | text | |
| model | text | |
| vin | text | |
| last_pm_date | date | Last preventive maintenance |
| next_pm_due | date | Next PM due date |
| notes | text | General notes |
| created_at | timestamptz | |
| updated_at | timestamptz | |

> **Gap**: The exact set of `status` values (e.g., available, maintenance, out-of-service) should be documented here — check the fleet app's `lib/types.ts` or the status filter component.

---

### truck_notes
Notes attached to a truck — driver observations, mechanic findings, completed work.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| truck_id | uuid FK → trucks | |
| type | text | `driver` \| `mechanic` \| `work_done` |
| body | text | Note content |
| created_by | text | User full name or email |
| created_at | timestamptz | |

---

### status_history
Audit log of truck status changes.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| truck_id | uuid FK → trucks | |
| from_status | text | |
| to_status | text | |
| changed_by | text | |
| reason | text | |
| created_at | timestamptz | |

---

### drivers
Driver records. Used by transport (job assignments) and inspections (safety scoring).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | Display name |
| phone | text | |
| home_yard | text | |
| is_active | bool | |
| current_job_id | uuid FK → jobs | Nullable |
| samsara_driver_id | text UNIQUE | Added to link Samsara events to drivers |
| created_at | timestamptz | |

The `samsara_driver_id` is matched against Samsara's `driverId` field during event ingestion. When a driver's Samsara ID is not set, the sync scripts fall back to name normalization (lowercase, trim).

---

### jobs
Transport dispatch jobs synced from TowBook every 15 minutes.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| reference_number | text UNIQUE | TowBook call number |
| pickup_location | text | |
| dropoff_location | text | |
| pickup_time | timestamptz | |
| status | text | `pending` \| `assigned` \| `in_progress` \| `completed` \| `cancelled` |
| driver_id | uuid FK → drivers | Nullable — assigned by dispatcher |
| truck_id | uuid FK → trucks | Nullable |
| notes | text | |
| created_by | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

---

### vehicle_inspections
Pre-trip / DVIR records submitted via the fleet app's inspection modal.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| truck_id | uuid FK → trucks | |
| unit_number | text | Denormalized for display |
| inspector | text | Driver name |
| inspected_date | date | |
| items | jsonb | Array of inspection items with pass/fail status |
| has_fails | bool | True if any item failed |
| created_at | timestamptz | |

---

### equipment_requests
Equipment procurement requests submitted through the fleet app.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| submitted_by | text | |
| submitted_at | timestamptz | |
| urgent | bool | |
| request_type | text | `replacement` \| `new` |
| description | text | What is being requested |
| purpose | text | Why it's needed |
| if_not_purchased | text | Impact if denied |
| status | text | `pending` \| `approved` \| `denied` |
| manager_notes | text | |
| denial_reason | text | |
| reviewed_by | text | |
| reviewed_at | timestamptz | |

---

### safety_events
Safety events ingested from Samsara (harsh braking, speeding, seatbelt, distraction, etc.).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| samsara_event_id | text UNIQUE | Samsara's event ID — conflict key for upsert |
| driver_id | uuid FK → drivers | Nullable |
| driver_name | text | Denormalized |
| vehicle_id | text | Samsara vehicle ID |
| unit_number | text | Truck unit number |
| occurred_at | timestamptz | Event timestamp |
| event_type | text | e.g., `harshBraking`, `speeding`, `seatbelt`, `distractedDriving`, `rollingStop` |
| raw_status | text | Samsara's raw coaching status |
| final_status | text | `coached` \| `dismissed` \| `pending` |
| severity_points | int | Points assigned by severity mapping (see Inspections docs) |
| max_speed | numeric | For speeding events |
| speed_limit | numeric | Posted limit at event location |
| labels | text[] | Samsara label tags |
| created_at | timestamptz | |
| updated_at | timestamptz | |

---

### dvir_logs
One row per driver per day indicating whether a DVIR was completed. Populated by Samsara sync; can be manually overridden by safety manager.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| driver_id | uuid FK → drivers | |
| driver_name | text | Denormalized |
| log_date | date | |
| completed | bool | True if DVIR was submitted |
| manually_overridden | bool | True if safety manager marked as verified — protected from future sync overwrites |
| source | text | `samsara` \| `manual` |
| notes | text | |
| created_at | timestamptz | |

**Unique constraint**: `(driver_id, log_date)`

**Override protection**: Sync scripts load all rows where `manually_overridden = true` before upserting, and skip those rows entirely. This ensures a safety manager's manual verification is never overwritten by an automated run.

> Note: Only interstate drivers (who use Samsara in-cab tablets) have DVIRs synced from Samsara. Local drivers complete DVIRs in TowBook; those are not yet synced into this table.

---

### compliance_events
Manually entered compliance incidents: DOT citations, out-of-service orders, accidents.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| driver_id | uuid FK → drivers | |
| driver_name | text | Denormalized |
| event_date | date | |
| event_type | text | `dot_citation` \| `oos` \| `accident` \| `other` |
| points | int | Penalty points applied to safety score |
| notes | text | |
| entered_by | text | Safety manager's name |
| created_at | timestamptz | |

An `oos` or `accident` event also sets `disqualified = true` in `score_snapshots`, which removes the driver from the ranked leaderboard entirely.

---

### mileage_logs
Daily miles driven per driver, aggregated from Samsara trip data.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| driver_id | uuid FK → drivers | |
| driver_name | text | Denormalized |
| log_date | date | |
| miles | numeric | Total miles for the day |
| source | text | `samsara` |
| created_at | timestamptz | |

**Unique constraint**: `(driver_id, log_date)`

Miles are used in two ways: the severity rate calculation (`total_event_points / miles * 1000`) and the eligibility threshold (minimum 2,000 miles in the period to be ranked).

---

### score_snapshots
Computed safety scores for each driver for each period. Written by `compute_safety_scores.py`. Rows can be locked to prevent recalculation after a quarter closes.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| driver_id | uuid FK → drivers | |
| driver_name | text | |
| driver_yard | text | |
| driver_function | text | `interstate` \| `local` \| `driveway` \| etc. |
| period_start | date | Quarter start (e.g., 2026-04-01) |
| period_end | date | Quarter end (e.g., 2026-06-30) |
| total_event_points | int | Sum of `severity_points` from all safety events in period |
| miles_driven | numeric | Sum of daily miles in period |
| severity_rate | numeric | `(total_event_points / miles_driven) * 1000`, capped at 95 |
| driving_score | numeric | `100 - severity_rate` |
| dvir_days_missed | int | Count of days where `completed = false` |
| dvir_penalty | numeric | `dvir_days_missed * 2` |
| compliance_penalty | numeric | Sum of compliance event points + dvir_penalty |
| safety_score | numeric | `max(5, driving_score - compliance_penalty)` |
| eligible | bool | True if `miles_driven >= 2000` |
| disqualified | bool | True if any OOS or accident event in period |
| rank | int | Rank within rank_group (1 = best) |
| rank_group | text | Grouping for ranking (e.g., `interstate`, `local`) |
| locked | bool | True after quarter is finalized — script skips locked rows |
| created_at | timestamptz | |

**Unique constraint**: `(driver_id, period_start, period_end)`

**Ranking tiebreakers** (within each group): safety_score DESC → total_event_points ASC → miles_driven DESC

---

### impounds
Impounded vehicle inventory synced from TowBook every 4 hours.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| call_number | text UNIQUE | TowBook call number — conflict key for upsert |
| date_of_impound | date | |
| make_model | text | Combined make/model string from TowBook |
| year | int | |
| vin | text | |
| reason_for_impound | text | |
| notes | text | Manual notes (preserved on sync — not overwritten) |
| location | text | Storage yard |
| status | text | `Owned` \| `Police Hold` \| `Current Impound` — synced from TowBook |
| released | bool | |
| amount_paid | numeric | Amount collected on release |
| internal_cost | numeric | Storage/processing cost |
| sell | bool | Flagged for sale |
| keys | bool | Keys present |
| drives | bool | Vehicle is driveable |
| sales_description | text | Listing description (manual) |
| estimated_value | numeric | Manual valuation |
| needs_detail | bool | |
| needs_mechanic | bool | |
| estimated_repair_cost | numeric | |
| disposition_date | date | Date released, sold, or scrapped |
| scrapped | bool | |
| sold | bool | |
| created_at | timestamptz | |
| updated_at | timestamptz | Auto-updated via trigger |

**Sync strategy**: TowBook-sourced fields (call_number, date_of_impound, make_model, year, vin, reason_for_impound, location, status, released, amount_paid, keys, drives) are updated on every sync. Manual fields (notes, sell, estimated_value, sales_description, needs_detail, needs_mechanic, estimated_repair_cost) are set only on INSERT and never overwritten by sync.

---

### impound_photos
Photos of impounded vehicles uploaded via the impound app.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| impound_id | uuid FK → impounds | |
| storage_path | text | Path in Supabase Storage bucket `impound-photos` |
| file_name | text | Original filename |
| uploaded_by | text | User who uploaded |
| created_at | timestamptz | |

Photos are stored in the `impound-photos` Storage bucket. Only admins, dispatchers, and impound managers can upload or delete photos (enforced by RLS on both the table and the bucket).

---

## Row Level Security (RLS)

RLS is enabled on all tables. The general pattern:

- **Read**: All authenticated users can read most tables
- **Write**: Restricted by role — typically admin, dispatcher, or the relevant specialist role
- **Impounds**: Admin, dispatcher, and impound_manager only (read + write)
- **Score snapshots**: Read-only for all authenticated users; write via service role (backend scripts)
- **Backend scripts**: Use service role key — bypasses RLS entirely

RLS policies reference `auth.uid()` and join to the `profiles` table to check the user's `role` column.

---

## Migrations

All schema changes go through numbered SQL files in `supabase/migrations/`. Files are named `YYYYMMDD_description.sql` and applied in chronological order.

| Migration | Purpose |
|-----------|---------|
| `20260422_impounds.sql` | Creates `impounds` and `impound_photos` tables, storage bucket, RLS policies |
| `20260422_impounds_disposition_date.sql` | Adds `disposition_date` column to `impounds` |
| `20260422_impounds_scrapped_sold.sql` | Adds `scrapped` and `sold` columns to `impounds` |
| `20260423_inspections_equipment_requests.sql` | Creates `equipment_requests` table |
| `20260424_safety_program.sql` | Creates `safety_events`, `dvir_logs`, `compliance_events`, `score_snapshots`, `mileage_logs` tables |
| `20260424_safety_samsara_columns.sql` | Adds `samsara_driver_id` to `drivers` and Samsara-specific columns to safety tables |
| `20260424_trucks_rls_shop_manager.sql` | Adds shop_manager write permissions to `trucks` table |
| `20260427_truck_notes_rls.sql` | RLS policies for `truck_notes` |
| `20260428_dvir_manual_override.sql` | Adds `manually_overridden` column to `dvir_logs` |

> **Rule**: Never edit an existing migration file. Always add a new one.
