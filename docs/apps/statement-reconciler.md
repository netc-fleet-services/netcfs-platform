# Statement Reconciler App

**Package**: `@netcfs/statement-reconciler`
**Port**: 3008
**Directory**: `apps/statement-reconciler/`

## Purpose

Accounts-facing tool for reconciling vendor statements against QuickBooks exports. Upload a vendor PDF/CSV and a QuickBooks export; the app matches invoice numbers, flags discrepancies, and produces a summary. A separate tab handles Fullbay vs. QuickBooks reconciliation.

## Routes

| Route | Access | Purpose |
|-------|--------|---------|
| `/(auth)/login` | Public | Login |
| `/` | Authenticated | Main reconciliation dashboard (two tabs) |
| `/api/reconcile-trigger` | Server | Dispatches GitHub Actions `run-reconciliation` workflow |
| `/api/fb-reconcile-trigger` | Server | Dispatches GitHub Actions `run-fb-reconciliation` workflow |
| `/api/reconciliation-runs` | Server | Returns run history from `reconciliation_jobs` |
| `/api/fb-reconciliation-runs` | Server | Returns run history from `fb_reconciliation_jobs` |

## Tabs

- **Vendor Reconciliation** — Upload vendor statement + QuickBooks export. Triggers the Python reconciliation workflow via GitHub Actions `repository_dispatch`. Results appear in the run history table below.
- **Fullbay Reconciliation** — Triggers the Fullbay vs. QuickBooks reconciliation. Polls for completion and displays match/mismatch summary.

## Python Scripts

### `reconciler/run_reconciliation.py`
Triggered by `run-reconciliation.yml` (GitHub Actions `repository_dispatch`).

1. Downloads the uploaded vendor statement and QuickBooks export from Supabase Storage
2. Runs the vendor-specific parser (Sullivan, etc.) to extract invoice numbers and amounts
3. Normalizes invoice numbers: strips leading zeros and dashes to handle TowBook/QuickBooks format differences
4. Matches on normalized invoice number, flags amount discrepancies
5. Writes results (matched, mismatched, statement-only, QB-only rows) back to Supabase
6. Updates `reconciliation_jobs` row with final status and summary counts

### `reconciler/fb_reconcile.py`
Triggered by `run-fb-reconciliation.yml`.

1. Connects to Fullbay API and exports open/closed invoices for the target period
2. Fetches the QuickBooks export from Supabase Storage
3. Matches on invoice number; reports Fullbay-only, QB-only, and amount variances
4. Updates `fb_reconciliation_jobs` row with results

### Parsers (`reconciler/parsers/`)
Each vendor has its own parser module. The Sullivan parser (`sullivan.py`) handles leading zeros and dashes in invoice numbers: `clean_inv = inv.replace("-", "").lstrip("0") or inv`.

To add a new vendor, create a new `parsers/<vendor>.py` module implementing the standard `parse(file_path) -> list[dict]` interface and register it in `run_reconciliation.py`.

## GitHub Actions Workflows

| Workflow | File | Trigger |
|----------|------|---------|
| Run Reconciliation | `run-reconciliation.yml` | `repository_dispatch` (`run-reconciliation` event) |
| Run Fullbay Reconciliation | `run-fb-reconciliation.yml` | `repository_dispatch` (`run-fb-reconciliation` event) |

Both workflows require `GITHUB_PAT` and `GITHUB_REPO` to be set in the Vercel environment for the app's trigger API routes to work.

## Database

- `reconciliation_jobs` — One row per vendor reconciliation run. Stores status, file paths, and summary counts.
- `fb_reconciliation_jobs` — One row per Fullbay vs. QB reconciliation run.

## Access

Visible to: `admin`, `accounts`. RLS restricts reconciliation data to these roles.
