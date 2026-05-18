# Fullbay WIP App

**Package**: `@netcfs/fullbay-wip`
**Port**: 3009
**Directory**: `apps/fullbay-wip/`

## Purpose

Shop-management tool that pulls a weekly Work In Progress (WIP) snapshot from Fullbay and presents a parts-cost summary by shop location. Runs automatically every Monday morning; can also be triggered manually. Results are stored in Supabase and presented as a downloadable CSV.

## Routes

| Route | Access | Purpose |
|-------|--------|---------|
| `/(auth)/login` | Public | Login |
| `/` | Authenticated | WIP dashboard — trigger, live status, history |
| `/api/wip-trigger` | Server | Creates a `wip_runs` row and dispatches GitHub Actions |
| `/api/wip-runs` | Server | Returns run history (last 20 rows) |
| `/api/wip-runs/[id]` | Server | Returns a single run with signed download URLs |

## How It Works

1. User clicks **Run Now** (or Monday 12:00 UTC cron fires)
2. A `wip_runs` row is inserted with `status: pending`; its UUID is the `RUN_ID`
3. GitHub Actions dispatches `run-wip.yml` with the `RUN_ID` in the payload
4. The Python script runs, sets `status: running`, then:
   - Logs into Fullbay via Playwright (headless Chromium)
   - Navigates to Reports → Work In Progress → WIP Details
   - Sets today's date and selects all shop locations
   - Downloads the WIP CSV using session cookies from the browser
   - Analyzes the CSV: filters to service orders open during the **previous** Mon–Sun week
   - Generates a summary CSV (by shop) and a detail CSV (all matching SOs)
   - Uploads both CSVs to Supabase Storage bucket `wip-reports` under `{RUN_ID}/`
   - Updates `wip_runs` with `status: done`, file paths, and `result_json` (shop totals)
5. The frontend polls `/api/wip-runs/{id}` every 4 seconds until `done` or `error`

## Python Script

**`scripts/wip_run.py`** — triggered by `run-wip.yml`

Required environment variables (set as GitHub Actions secrets):
- `RUN_ID` — UUID of the `wip_runs` row (passed in workflow payload)
- `FULLBAY_EMAIL` — Fullbay login email
- `FULLBAY_PASSWORD` — Fullbay login password
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:
- `FULLBAY_LOCATION_IDS` — Comma-separated Fullbay shop location IDs (defaults to all NETC shops)

## GitHub Actions Workflow

| Workflow | File | Trigger |
|----------|------|---------|
| Run Fullbay WIP Report | `run-wip.yml` | Monday 12:00 UTC cron + `repository_dispatch` (`run-wip` event) + `workflow_dispatch` (manual) |

The workflow creates a `wip_runs` row itself if triggered by cron or `workflow_dispatch` (no pre-existing row). When triggered by `repository_dispatch` from the UI, it uses the `run_id` passed in the client payload.

**PAT requirements**: The `GITHUB_PAT` Vercel secret needs **repo** + **workflow** scopes (classic PAT) or **Contents: write** (fine-grained PAT) to dispatch `repository_dispatch` events.

## Database

- `wip_runs` — One row per WIP report run.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | Also used as storage folder prefix |
| `status` | text | `pending` \| `running` \| `done` \| `error` |
| `week_label` | text | e.g., `"2026-05-11 to 2026-05-17"` |
| `summary_file_path` | text | Storage path to summary CSV |
| `detail_file_path` | text | Storage path to detail CSV |
| `result_json` | jsonb | `{week_label, total_so_count, grand_total, shops: [{shop, total_cost}]}` |
| `error_message` | text | Set on failure |
| `created_at` | timestamptz | |

## Storage

CSVs are stored in the `wip-reports` Supabase Storage bucket under `{run_id}/WIP_Summary_{date}.csv` and `{run_id}/WIP_Detail_{date}.csv`. The API route generates signed URLs (1-hour expiry) for download links.

## Access

Visible to: `admin`, `shop_manager`. RLS restricts `wip_runs` to these roles.
