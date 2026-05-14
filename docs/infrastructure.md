# Infrastructure & Deployment

Single reference for anyone taking over maintenance of the platform. Covers every external service, credential, and environment variable — what it is, where it lives, and where to get a new one if it expires.

---

## Services at a Glance

| Service | Purpose |
|---------|---------|
| **Supabase** | Postgres database, user auth, file storage |
| **Vercel** | Hosting for all Next.js apps |
| **GitHub** | Source code, CI/CD (Actions workflows) |
| **Samsara** | Vehicle telematics API — safety events, DVIRs, mileage, PM schedules |
| **TowBook** | Dispatch and impound software — scraped via Playwright (no public API) |
| **Geocodio** | Address → lat/lon geocoding (optional; transport sync only) |
| **GraphHopper** | Route estimation API — used by quote calculator and transport |
| **MarketCheck** | Vehicle valuation API — used by impounds app |
| **Resend** | Transactional email delivery — truck PM alerts, inspection notifications |

---

## Supabase

### One project, all apps

All six apps connect to the **same Supabase project**. There is one Postgres database, one Auth tenant, and one Storage namespace shared across the platform. This simplifies auth (one session cookie works in every app) and lets apps query across tables.

### Credentials

Find these at: **Supabase Dashboard → your project → Settings → API**

| Variable name | What it is | Used by |
|---------------|-----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (`https://xxxx.supabase.co`) | All Next.js apps (browser + server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anonymous / public key. Safe to expose in the browser. Row Level Security enforces what each role can see. | All Next.js apps |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — **bypasses RLS**. Used by Next.js API routes that need admin-level database access (fleet notifications, WIP sync, statement reconciler, quote calculator). **Never expose in the browser. Set as a Vercel environment variable on each app that needs it.** | fleet, fullbay-wip, statement-reconciler, quote-calculator |
| `SUPABASE_URL` | Same URL — different variable name used by the Python scripts | All GitHub Actions workflows |
| `SUPABASE_SERVICE_KEY` | Same service role key — variable name used by GitHub Actions secrets. Same value as `SUPABASE_SERVICE_ROLE_KEY` above. | All GitHub Actions workflows |

> On the Supabase Settings → API page, the service key is labelled `service_role`. Copy it to GitHub Actions secrets as `SUPABASE_SERVICE_KEY`.

### Storage

The `impound_photos` bucket holds photos scraped during the TowBook impound sync. The bucket is created by migration; no manual configuration needed.

### Migrations

Schema changes live in `supabase/migrations/` as `YYYYMMDD_description.sql` files, applied in chronological order.

To apply a new migration:
- Paste the SQL in **Supabase Dashboard → SQL Editor**, or
- Use the CLI: `supabase db push`

Never edit an existing migration file — always create a new one.

---

## Vercel

### Project structure

Each app is a **separate Vercel project** pointing at its subdirectory of this monorepo. Vercel redeploys a project automatically when its app directory changes on `main`.

| Vercel project | Root directory | Package name |
|----------------|---------------|--------------|
| netcfs-portal | `apps/portal` | `@netcfs/portal` |
| netcfs-fleet | `apps/fleet` | `@netcfs/fleet` |
| netcfs-transport | `apps/transport` | `@netcfs/transport` |
| netcfs-inspections | `apps/inspections` | `@netcfs/safety` |
| netcfs-swaps | `apps/swaps` | `@netcfs/swaps` |
| netcfs-impounds | `apps/impounds` | `@netcfs/impounds` |
| netcfs-quote-calculator | `apps/quote-calculator` | `@netcfs/quote-calculator` |
| netcfs-scheduler | `apps/scheduler` | `@netcfs/scheduler` |
| netcfs-statement-reconciler | `apps/statement-reconciler` | `@netcfs/statement-reconciler` |
| netcfs-fullbay-wip | `apps/fullbay-wip` | `@netcfs/fullbay-wip` |

### Environment Variables

Set these in each project at **Vercel Dashboard → project → Settings → Environment Variables**.

#### All six projects

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (browser-safe, RLS enforced) |

#### Portal only

The portal links to each other app. Set these to the live production URLs:

| Variable | Example |
|----------|---------|
| `NEXT_PUBLIC_FLEET_URL` | `https://fleet.netcfs.com` |
| `NEXT_PUBLIC_TRANSPORT_URL` | `https://transport.netcfs.com` |
| `NEXT_PUBLIC_INSPECTIONS_URL` | `https://inspections.netcfs.com` |
| `NEXT_PUBLIC_SWAPS_URL` | `https://swaps.netcfs.com` |
| `NEXT_PUBLIC_IMPOUNDS_URL` | `https://impounds.netcfs.com` |
| `NEXT_PUBLIC_QUOTE_CALCULATOR_URL` | `https://quotes.netcfs.com` |
| `NEXT_PUBLIC_RECONCILER_URL` | `https://reconciler.netcfs.com` |
| `NEXT_PUBLIC_SCHEDULER_URL` | `https://scheduler.netcfs.com` |
| `NEXT_PUBLIC_FULLBAY_WIP_URL` | `https://wip.netcfs.com` |

#### Quote calculator only

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_GRAPHHOPPER_KEY` | GraphHopper API key for route estimation. Get it at [graphhopper.com](https://graphhopper.com). |
| `SUPABASE_SERVICE_ROLE_KEY` | Needed so the `/api/fuel-surcharge`, `/api/route/estimate`, and `/api/pricing-config` server routes can query Supabase with admin access. |

#### Impounds only

| Variable | Purpose |
|----------|---------|
| `MARKETCHECK_API_KEY` | MarketCheck API key for vehicle valuation estimates. Get it at [marketcheck.com](https://www.marketcheck.com). |
| `GITHUB_PAT` | Same PAT described below — allows the impounds sync trigger UI to dispatch `sync-towbook.yml`. |

#### Fleet only

| Variable | Purpose |
|----------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Used by notification API routes to write logs and read truck/driver data without RLS restrictions. |
| `RESEND_API_KEY` | Resend API key for sending email notifications (PM alerts, inspection alerts, equipment requests). Get it at [resend.com](https://resend.com). |
| `NOTIFY_FROM_EMAIL` | Sender address for all notification emails. Defaults to `noreply@netruckcenter.com` if not set. Must be a verified domain in your Resend account. |
| `CRON_SECRET` | Optional bearer token to authenticate Vercel Cron requests to the `/api/notify-reminder` endpoint. Set to any random string; match it in the Vercel Cron configuration. |

#### Full Bay WIP and Statement Reconciler

| Variable | Purpose |
|----------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Required by all API routes in these apps. |
| `GITHUB_PAT` | Full Bay WIP uses this to dispatch the WIP sync workflow. |

#### Inspections only

| Variable | Purpose |
|----------|---------|
| `GITHUB_PAT` | GitHub Personal Access Token with `workflow` scope. Allows the **Backfill Trigger UI** (Admin tab → "Backfill Samsara Data") to dispatch the `backfill-samsara` workflow without a developer going to GitHub. See [GitHub PAT](#github_pat) below. |

---

## GitHub Actions

### Workflows

| Workflow file | Trigger | What it does |
|---------------|---------|--------------|
| `sync-samsara-events.yml` | Every 15 min | Pulls the last 72 hours of Samsara safety events into `safety_events`. Rolling window catches coaching status changes. |
| `sync-samsara-daily.yml` | Daily 06:00 UTC (2 AM ET) | Syncs yesterday's mileage logs and DVIR completions from Samsara. |
| `sync-samsara-pm.yml` | Daily 07:00 UTC (3 AM ET) | Syncs preventive maintenance schedules from Samsara into `pm_schedules`. |
| `compute-safety-scores.yml` | Daily 07:00 UTC + quarterly + manual | Computes quarterly driver safety scores from events, mileage, and DVIRs. Daily and manual-with-no-dates runs score the current quarter YTD. Quarterly cron (1st of Jan/Apr/Jul/Oct) finalises the prior quarter. |
| `backfill-samsara.yml` | Manual only | Replays the Samsara sync over any historical date range. Use this after a sync failure or after correcting driver-vehicle assignments. |
| `sync-calls.yml` | Every 15 min | Scrapes the TowBook dispatch board via Playwright into the `jobs` table. |
| `sync-towbook.yml` | Every 4 hours + manual | Scrapes the TowBook impound inventory (CSV export) into the `impounds` table. |
| `diagnose-safety.yml` | Manual only | Read-only diagnostic: prints raw DVIR, mileage, and event data for a date range without writing anything. Use when troubleshooting score discrepancies. |

See [Data Sync](data-sync.md) for the full logic of each workflow.

### Secrets

Set at: **GitHub → repository → Settings → Secrets and variables → Actions → Repository secrets**

| Secret | Required by | What it is | Where to get / renew |
|--------|------------|-----------|----------------------|
| `SUPABASE_URL` | All workflows | Supabase project URL | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | All workflows | Supabase service role key (bypasses RLS) | Supabase → Settings → API → `service_role` key |
| `SAMSARA_API_KEY` | `sync-samsara-*.yml`, `backfill-samsara.yml` | Samsara API bearer token | Samsara Dashboard → Settings → Developer → API Tokens → create new |
| `TOWBOOK_USER` | `sync-calls.yml`, `sync-towbook.yml` | TowBook login username | TowBook account |
| `TOWBOOK_PASS` | `sync-calls.yml`, `sync-towbook.yml` | TowBook login password | TowBook account |
| `GEOCODIO_KEY` | `sync-calls.yml` | Geocodio API key for address geocoding | [geocod.io](https://geocod.io) → API keys. If not set, geocoding is skipped and `pickup_lat`/`pickup_lon` stay null. |

### GITHUB_PAT

The `GITHUB_PAT` is a **GitHub Personal Access Token** with `workflow` scope. It is set as a **Vercel environment variable** on the inspections app (not a GitHub Actions secret), because it is used by the Next.js API route `apps/inspections/app/api/trigger-backfill/route.ts` to dispatch the `backfill-samsara` workflow on behalf of the admin user in the UI.

To generate:
1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Create new token with `workflow` scope
3. Set it as `GITHUB_PAT` in the inspections Vercel project's environment variables

The token is tied to the GitHub account that creates it. When ownership transfers, generate a new token under the new owner's account and update the Vercel env var.

---

## Full Credentials Inventory

| Credential | Set in | Used by | Source |
|-----------|--------|---------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel (all apps) + `.env.local` (local dev) | All Next.js apps | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel (all apps) + `.env.local` (local dev) | All Next.js apps | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (fleet, quote-calculator, fullbay-wip, statement-reconciler) | Next.js API routes needing admin DB access | Supabase → Settings → API → `service_role` key |
| `SUPABASE_URL` | GitHub Actions secrets | Python sync scripts | Supabase → Settings → API |
| `SUPABASE_SERVICE_KEY` | GitHub Actions secrets | Python sync scripts | Supabase → Settings → API → `service_role` key (same value as above) |
| `SAMSARA_API_KEY` | GitHub Actions secrets | Samsara sync workflows | Samsara → Developer → API Tokens |
| `TOWBOOK_USER` | GitHub Actions secrets | TowBook sync workflows | TowBook account |
| `TOWBOOK_PASS` | GitHub Actions secrets | TowBook sync workflows | TowBook account |
| `GEOCODIO_KEY` | GitHub Actions secrets | Transport sync (optional) | geocod.io account |
| `NEXT_PUBLIC_GRAPHHOPPER_KEY` | Vercel (quote-calculator) + `.env.local` | Route estimation | graphhopper.com → API keys |
| `MARKETCHECK_API_KEY` | Vercel (impounds) | Vehicle valuation | marketcheck.com → API keys |
| `RESEND_API_KEY` | Vercel (fleet) | Email notifications | resend.com → API keys |
| `NOTIFY_FROM_EMAIL` | Vercel (fleet, optional) | Sender address for emails | Must be a verified domain in Resend |
| `CRON_SECRET` | Vercel (fleet, optional) | Vercel Cron auth | Any random string |
| `GITHUB_PAT` | Vercel (inspections, impounds, fullbay-wip) | Workflow dispatch from UI | GitHub → Developer settings → PATs (needs `workflow` scope) |

---

## Handover Checklist

For the person handing over access:

- [ ] **Supabase** — Invite the new maintainer as an **Owner** on the Supabase project: Dashboard → Settings → Team
- [ ] **Vercel** — Add the new maintainer to the Vercel team: Team Settings → Members
- [ ] **GitHub** — Add the new maintainer as a repository **Admin** under the `netc-fleet-services` organization
- [ ] **Samsara** — Create a new API token for the new maintainer (or transfer an existing one), then update `SAMSARA_API_KEY` in GitHub Actions secrets
- [ ] **TowBook** — Share login credentials or create a dedicated service account; update `TOWBOOK_USER` and `TOWBOOK_PASS` in GitHub Actions secrets
- [ ] **Geocodio** — Share the account or API key; update `GEOCODIO_KEY` in GitHub Actions secrets
- [ ] **GraphHopper** — Share the account or API key; update `NEXT_PUBLIC_GRAPHHOPPER_KEY` in Vercel (quote-calculator project)
- [ ] **MarketCheck** — Share the account or API key; update `MARKETCHECK_API_KEY` in Vercel (impounds project)
- [ ] **Resend** — Add the new maintainer to the Resend account (or transfer); update `RESEND_API_KEY` in Vercel (fleet project). Verify the sender domain is still active.
- [ ] **GitHub PAT** — New maintainer generates a PAT with `workflow` scope under their own account, updates `GITHUB_PAT` in the Vercel env vars for the **inspections**, **impounds**, and **fullbay-wip** projects
- [ ] Verify all Vercel deployments are healthy after access transfer
- [ ] Confirm GitHub Actions workflows ran successfully on the first day after handover

---

## Diagnosing a Broken Sync

When a workflow fails:

1. **GitHub → Actions tab** — find the failing run and read the full log. Most failures are either an expired credential or a TowBook UI change (Playwright can't find an element).
2. **Check for rotated credentials** — TowBook password changes, Samsara token revocations, and Supabase key rotation all produce auth errors in the logs.
3. **Run `diagnose-safety.yml`** manually over a recent date range to see raw data state without writing anything.
4. **TowBook Playwright failures** — upload a debug screenshot (the impound sync already saves one on failure; check the Actions artifact). If TowBook changed its UI, update the CSS selectors in the relevant script.
5. **Missed Samsara data** — once the root cause is fixed, re-run `backfill-samsara.yml` over the affected date range. Data is upserted (not duplicated), so backfills are safe to run multiple times.
6. **Score discrepancies** — after any backfill, re-run `compute-safety-scores.yml` manually with the corrected date range to update `score_snapshots`.
