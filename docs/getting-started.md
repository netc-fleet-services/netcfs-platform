# Getting Started

## Prerequisites

- **Node.js** 20+
- **pnpm** 9+ (`npm install -g pnpm`)
- **Python** 3.11+ (for backend sync scripts only)
- A Supabase project (contact admin for credentials)

## Clone and Install

```bash
git clone https://github.com/netc-fleet-services/netcfs-platform.git
cd netcfs-platform
pnpm install
```

## Environment Variables

Each app reads from its own `.env.local` file. Copy the example below into the relevant app directory. All apps share the same Supabase project.

### All apps — required

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### apps/inspections — additional

```env
GITHUB_PAT=ghp_...          # Personal access token with workflow scope
                             # Used by BackfillTrigger UI to dispatch backfill-samsara.yml
```

### Python scripts — required secrets

These are set as GitHub Actions secrets, not `.env.local`. For local script execution, export them in your shell:

```bash
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_KEY=your-service-role-key   # bypasses RLS
export SAMSARA_API_KEY=your-samsara-api-key
export TOWBOOK_USER=your-towbook-username
export TOWBOOK_PASS=your-towbook-password
export GEOCODIO_KEY=your-geocodio-key               # optional, for transport sync
```

## Run All Apps

```bash
pnpm dev
```

This starts all six Next.js apps in parallel via Turborepo:

| App | URL |
|-----|-----|
| portal | http://localhost:3000 |
| fleet | http://localhost:3001 |
| transport | http://localhost:3002 |
| inspections | http://localhost:3003 |
| swaps | http://localhost:3004 |
| impounds | http://localhost:3005 |

## Run a Single App

```bash
pnpm --filter @netcfs/portal dev
pnpm --filter @netcfs/fleet dev
pnpm --filter @netcfs/transport dev
pnpm --filter @netcfs/safety dev        # inspections app
pnpm --filter @netcfs/swaps dev
pnpm --filter @netcfs/impounds dev
```

## Build

```bash
pnpm build          # build all apps (Turbo handles dependency order)
pnpm typecheck      # TypeScript across entire monorepo
pnpm lint           # ESLint across entire monorepo
```

## Run Python Sync Scripts Locally

Install Python dependencies (per script — each script has its own imports):

```bash
pip install supabase playwright requests python-dotenv
playwright install chromium
```

Run a sync manually:

```bash
# Backfill Samsara data for a date range
python apps/inspections/scripts/backfill_samsara.py \
  --start 2026-04-01 --end 2026-04-28

# Compute safety scores for a period
python apps/inspections/scripts/compute_safety_scores.py \
  --start 2026-04-01 --end 2026-04-28

# Sync impounds from TowBook
python apps/impounds/scripts/sync_impounds.py
```

## Supabase Migrations

Migrations live in `supabase/migrations/`. Apply them via the Supabase dashboard (SQL editor) or CLI:

```bash
supabase db push
```

Migrations are numbered by date and applied in order. Never edit an existing migration — add a new one instead.
