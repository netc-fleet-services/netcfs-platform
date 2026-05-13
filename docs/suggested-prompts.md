# Suggested Claude Code Prompts

Reusable prompt templates for recurring tasks in this monorepo. Each template includes what information to gather before writing the prompt, the prompt itself (copy and fill in the brackets), and a note on what integration points Claude will handle automatically.

---

## 1. Scaffold a New App

**Use when:** Adding a brand-new Next.js app to the monorepo.

### Information to gather first

| Question | Why it matters |
|----------|---------------|
| App slug (e.g. `driver-portal`) | Used for directory name, npm package, Vercel project, and env var names |
| npm package name (e.g. `@netcfs/driver-portal`) | Must be declared in `pnpm-workspace.yaml` and referenced by `turbo.json` |
| Dev port number | Each app needs a unique port — check `docs/getting-started.md` for what's taken |
| Purpose / one-line description | Goes in the portal tile and app documentation |
| Which roles can access it | Determines `ROLE_PERMISSIONS` entry and portal tile visibility |
| What data it reads/writes | Determines Supabase tables and migrations needed |
| Does it need a Python background script? | If yes, also prepare script trigger (cron/manual), required secrets, and which tables it writes to |
| Does it need file storage? | If yes, name the Supabase Storage bucket |
| Does it need a GitHub Actions workflow? | If yes, specify trigger type and secrets needed |

### Prompt template

```
Scaffold a new Next.js app in this monorepo called "<APP_SLUG>" (package name @netcfs/<APP_SLUG>, dev port <PORT>).

Purpose: <ONE-LINE DESCRIPTION OF WHAT THE APP DOES>

Roles that can access it: <e.g. admin, dispatcher>

Data it uses:
- Reads from Supabase tables: <TABLE_1>, <TABLE_2>
- Writes to Supabase tables: <TABLE_1>  (or: no writes)
- [If needed] Needs a new Supabase migration for table: <TABLE_NAME> with columns: <COL: TYPE, COL: TYPE>
- [If needed] Needs a Supabase Storage bucket named: <BUCKET_NAME>

[If it needs a background script:]
Also create a Python script at apps/<APP_SLUG>/scripts/<SCRIPT_NAME>.py triggered by GitHub Actions
on <cron schedule or "repository_dispatch with event_type '<EVENT_TYPE>'">.
The script: <WHAT IT DOES — fetches data from X, writes to table Y, uploads file to bucket Z>.
Secrets it needs: <SECRET_1>, <SECRET_2> (already in GitHub Actions secrets).

Make sure the app is fully integrated:
- Added to pnpm-workspace.yaml
- Added to turbo.json (env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, any others)
- Added to ROLE_PERMISSIONS in packages/auth/src/types.ts
- Portal tile added in apps/portal/components/AppTilesClient.tsx (color: <HEX_COLOR>, icon: <EMOJI>)
- NEXT_PUBLIC_<APP_SLUG_UPPER>_URL env var wired up in portal's next.config.ts and turbo.json
- SSO auth middleware (middleware.ts) copied from an existing app
- Protected route layout that redirects unauthorized roles to /login

Follow the same App Router structure as the other apps in this repo:
app/(auth)/login, app/(dashboard)/layout.tsx (role check + redirect), app/(dashboard)/page.tsx (server component).
```

### What Claude will handle automatically (given the above)

- Full `apps/<slug>/` directory with `package.json`, `tsconfig.json`, `next.config.ts`, `middleware.ts`
- Root layout importing `@netcfs/styles`, auth layout with session check
- Login page and SSO callback reusing the standard auth pattern
- API routes if background scripts use `repository_dispatch`
- `pnpm-workspace.yaml` and `turbo.json` updates
- `ROLE_PERMISSIONS` matrix entry in `packages/auth/src/types.ts`
- Portal tile entry in `AppTilesClient.tsx`
- Supabase migration SQL if new tables were described
- GitHub Actions workflow YAML if a background script was requested

### After Claude finishes

1. Run `pnpm install` at the monorepo root to update the lockfile (Vercel will fail to deploy if this is skipped)
2. Create a new Vercel project pointed at `apps/<slug>` with the same env vars as the other apps
3. Apply any new Supabase migrations via the SQL editor or `supabase db push`
4. Add the new `NEXT_PUBLIC_<APP>_URL` env var to the portal's Vercel project
5. Add any new GitHub Actions secrets if the app has a background script

---

## 2. Add a Vendor Statement Parser

**Use when:** A vendor sends statements in a format that has no existing parser in `apps/statement-reconciler/reconciler/parsers/`.

### Information to gather first

- The actual statement file (PDF or XLSX) — Claude reads it directly if you provide the path
- The vendor's exact legal name as it appears on the statement
- A short parser key (lowercase, no spaces, e.g. `fleetpride`, `burkeoil`) — this is what the user selects in the UI dropdown

### Prompt template

```
Add a new vendor statement parser for <VENDOR NAME>.

The statement file is at: <FULL FILE PATH TO PDF OR XLSX>

Parser key: <KEY> (this is what the user selects in the reconciler UI)

Please:
1. Read the file and identify the text/column layout
2. Write the parser at apps/statement-reconciler/reconciler/parsers/<KEY>.py
   following the same pattern as the other parsers in that directory
3. Register it in apps/statement-reconciler/reconciler/parsers/__init__.py
4. Add it to the VENDORS array in apps/statement-reconciler/components/ReconcilerClient.tsx

The parser must extract: invoice number, transaction date, amount (positive for charges, negative for credits),
and transaction type ("Bill" or "Credit"). Also extract statement date, account number,
and period total (the "Amount Due" / "Balance Due" / "Total" shown on the statement) when present.
```

### What Claude will handle automatically

- Reading the PDF/XLSX and identifying the exact text extraction format
- Writing a regex (for PDFs) or openpyxl reader (for XLSX) that extracts records
- Handling common edge cases: line wrapping, duplicate-line formats, 2-digit years, comma-separated numbers, credit indicators
- Registering the parser in `__init__.py` and the UI dropdown in `ReconcilerClient.tsx`

### Tips for better results

- If the statement has an unusual format (e.g. amounts in two separate columns for charges vs. credits), mention it explicitly: *"This statement has separate Charges and Credits columns — a row is a Bill if the Charges column has a value, Credit if the Credits column does."*
- If the vendor uses a billing system shared with an existing vendor (e.g. the same software as Fastener Warehouse), say so — Claude can base the new parser on the existing one
- For XLSX statements, confirm whether the file has a consistent header row or varies by period

---

## 3. Add a GitHub Actions Background Workflow

**Use when:** Adding a new scheduled or on-demand data sync, report generation, or automation job.

### Information to gather first

| Question | Example |
|----------|---------|
| Trigger type | Cron schedule, `repository_dispatch`, or manual (`workflow_dispatch`) |
| Cron schedule (if applicable) | `'0 7 * * 1'` = Mondays 7 AM UTC |
| Script location | `apps/<app>/scripts/<script>.py` |
| What the script does | Fetches from API X, transforms, upserts to table Y, uploads file to bucket Z |
| Which GitHub Actions secrets it needs | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, plus any API keys |
| Whether a UI can trigger it | If yes, which app has the trigger button and which API route fires the dispatch |

### Prompt template

```
Add a new GitHub Actions workflow for <WHAT IT DOES>.

Workflow file: .github/workflows/<WORKFLOW_NAME>.yml

Trigger: <one of:>
  - Cron: '<CRON_EXPRESSION>' (e.g. '0 7 * * 1' for Mondays at 7 AM UTC)
  - repository_dispatch with event_type: '<EVENT_TYPE>'
  - workflow_dispatch (manual only)

Python script: apps/<APP_SLUG>/scripts/<SCRIPT_NAME>.py

The script should:
<NUMBERED LIST OF WHAT IT DOES>
1. ...
2. ...
3. Update the <TABLE_NAME> row in Supabase to status 'done' or 'error' when finished

Secrets needed (already in GitHub Actions): <SECRET_1>, <SECRET_2>

[If UI-triggered via repository_dispatch:]
Also create an API route at apps/<APP_SLUG>/app/api/<ROUTE_NAME>/route.ts (POST) that:
- Creates a row in <TABLE_NAME> with status 'pending'
- Fires the repository_dispatch with event_type '<EVENT_TYPE>' and client_payload: { run_id }
- Returns { runId }

The script should read RUN_ID from the environment and update the Supabase row
when the job completes or errors.

Follow the same pattern as the existing scripts in this repo (update job status in Supabase,
use service role key for writes, log progress to stdout for GitHub Actions visibility).
```

### What Claude will handle automatically

- Workflow YAML with Python setup, pip install, and script invocation steps
- Environment variable passing from secrets to the script
- Status tracking row updates (pending → running → done/error) in Supabase
- Signed URL generation for any output files if a UI needs to display them

---

## 4. Add a Supabase Table + API Route

**Use when:** A new feature needs its own database table and a Next.js API route to query or mutate it.

### Information to gather first

- Table name and what it represents
- Columns: name, type, nullable, default
- Which app queries or writes it
- RLS policy: who can read, who can write (by role or `auth.uid()`)
- Whether the API route is a simple CRUD or has business logic (calculations, side effects)

### Prompt template

```
Add a new Supabase table and API route for <WHAT IT STORES>.

Table name: <TABLE_NAME>

Columns:
- id: uuid primary key default gen_random_uuid()
- <COL_NAME>: <TYPE> [not null] [default <VALUE>]
- <COL_NAME>: <TYPE>
- created_at: timestamptz default now()

Row Level Security:
- Read: <e.g. "authenticated users only" or "only rows where user_id = auth.uid()" or "service role only">
- Write: <e.g. "service role only" or "admin role only">

API route: apps/<APP_SLUG>/app/api/<ROUTE>/route.ts

<GET | POST | PATCH | DELETE> behavior:
<Describe what the route does — e.g. "GET returns the 50 most recent rows ordered by created_at desc",
"POST inserts a new row and returns the id">

Write the Supabase migration SQL as a comment block at the top of the route file
so I can copy it into the SQL editor. Also write the RLS policy SQL.
```

### What Claude will handle automatically

- Migration SQL with the correct column types and constraints
- `CREATE POLICY` statements for the described RLS rules
- Next.js route handler using `getServiceClient()` (service role, bypasses RLS) or `getSupabaseServerClient()` (respects RLS) as appropriate
- TypeScript types for the response shape

---

## 5. Add a Portal Tile for an Existing App

**Use when:** An app already exists and you just need to add or update its entry in the portal dashboard.

### Prompt template

```
Add a portal tile for the <APP_NAME> app in apps/portal/components/AppTilesClient.tsx.

Tile details:
- id: '<ROLE_PERMISSIONS_KEY>'     (must match the key in ROLE_PERMISSIONS in packages/auth/src/types.ts)
- label: '<DISPLAY NAME>'
- description: '<ONE-LINE DESCRIPTION SHOWN ON THE TILE>'
- url: process.env.NEXT_PUBLIC_<APP_UPPER>_URL || '<DEFAULT PRODUCTION URL>'
- color: '<HEX COLOR>'             (e.g. '#3b82f6' for blue, '#f97316' for orange)

Visible to roles: <e.g. admin, shop_manager>

Also:
- Add '<ROLE_PERMISSIONS_KEY>' to the relevant roles in ROLE_PERMISSIONS (packages/auth/src/types.ts)
- Add NEXT_PUBLIC_<APP_UPPER>_URL to the env list in turbo.json so Turborepo caches it correctly
```

---

## General Tips

**Be specific about the data shape.** Claude performs better when you describe the actual columns, not just the concept. "A table for tracking reconciliation jobs with columns: id (uuid), status (text), vendor_key (text), matched_count (int)" produces a more correct migration than "a table for jobs."

**Reference existing patterns.** Saying "follow the same pattern as apps/statement-reconciler" or "same auth middleware as apps/fleet" tells Claude exactly which file to use as a model rather than making a guess.

**Describe what you don't want changed.** If you're adding to a complex file like `ReconcilerClient.tsx`, add: "do not change any existing functionality, only add the new entries." This prevents accidental modifications to working code.

**Provide file paths, not just names.** "The parser file is at `apps/statement-reconciler/reconciler/parsers/__init__.py`" is more reliable than "the parser registry."

**State secrets by name.** "The script needs `SUPABASE_SERVICE_ROLE_KEY` and `FULLBAY_EMAIL` — both are already in GitHub Actions secrets." This prevents Claude from inventing a new secret name that doesn't match what's actually in the repo.

**Run `pnpm install` after any new package is added.** Any time Claude creates a new `apps/*/package.json`, you must run `pnpm install` at the monorepo root before pushing. Vercel will reject a deploy if `pnpm-lock.yaml` is out of sync.
