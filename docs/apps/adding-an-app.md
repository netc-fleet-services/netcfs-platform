# Adding a New App to the Platform

This guide walks through every step needed to create a new Next.js app, wire it into the shared infrastructure, and make it appear in the portal.

---

## 1. Scaffold the App

Copy an existing simple app (e.g., `apps/scheduler`) as a starting point:

```bash
cp -r apps/scheduler apps/your-app-name
```

Update `apps/your-app-name/package.json`:

```json
{
  "name": "@netcfs/your-app-name",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3010",
    "build": "next build",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  }
}
```

Pick the next available port (check the README table). Update `apps/your-app-name/next.config.ts` if needed.

---

## 2. Connect to Shared Packages

All apps consume the same shared packages. These are already in the monorepo under `packages/`:

| Package | Import path | Purpose |
|---------|-------------|---------|
| `@netcfs/auth` | `@netcfs/auth/client`, `@netcfs/auth/server` | Supabase client factories, session helpers |
| `@netcfs/db` | `@netcfs/db` | Shared TypeScript DB types |
| `@netcfs/ui` | `@netcfs/ui` | Shared React components |
| `@netcfs/styles` | `@netcfs/styles` | Global CSS variables and base styles |
| `@netcfs/utils` | `@netcfs/utils` | Shared utility functions |

Add them to `package.json` dependencies:

```json
"dependencies": {
  "@netcfs/auth": "workspace:*",
  "@netcfs/db": "workspace:*",
  "@netcfs/styles": "workspace:*",
  "@netcfs/ui": "workspace:*",
  "@netcfs/utils": "workspace:*"
}
```

Then run `pnpm install` from the repo root.

---

## 3. Set Up Auth

Every authenticated app follows the same layout pattern. Look at an existing app (e.g., `apps/scheduler/app/`) for the exact file structure:

```
app/
  (auth)/
    login/
      page.tsx        ← public login page
  (dashboard)/
    layout.tsx        ← wraps authenticated routes, redirects if no session
    page.tsx          ← main app page
  auth/
    callback/
      route.ts        ← Supabase OAuth callback handler
  layout.tsx          ← root layout, imports global styles
```

The auth callback route and login page can be copied verbatim from any existing app — they are identical across all apps.

The dashboard layout should call `getSupabaseServerClient()` from `@netcfs/auth/server`, check for a session, and redirect unauthenticated users to `/login`.

---

## 4. Add Environment Variables

### Vercel (production)

Every app needs these minimum variables set in Vercel Dashboard → project → Settings → Environment Variables:

```
NEXT_PUBLIC_SUPABASE_URL          (same value across all apps)
NEXT_PUBLIC_SUPABASE_ANON_KEY     (same value across all apps)
```

If your app has API routes that need to bypass RLS (service role operations):
```
SUPABASE_SERVICE_ROLE_KEY         (same value — never expose to the browser)
```

If your app needs to trigger GitHub Actions workflows from the UI:
```
GITHUB_PAT       (classic PAT with repo + workflow scopes)
GITHUB_REPO      (e.g., netc-fleet-services/netcfs-platform)
```

Add any app-specific keys (API keys, third-party services) as additional variables.

### Local development

Add a `.env.local` file in `apps/your-app-name/`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...        # if needed
```

Copy values from another app's local setup — they all connect to the same Supabase project.

### turbo.json

Add any new env vars to the `env` array in `turbo.json` at the repo root so Turborepo includes them in its cache key:

```json
"env": [
  "NEXT_PUBLIC_SUPABASE_URL",
  "YOUR_NEW_VAR"
]
```

---

## 5. Add a Vercel Project

1. Go to Vercel Dashboard → **Add New Project**
2. Import the `netcfs-platform` repository
3. Set **Root Directory** to `apps/your-app-name`
4. Vercel will auto-detect Next.js; the framework preset is correct
5. Add environment variables (step 4)
6. Deploy

Vercel will automatically redeploy this project whenever files under `apps/your-app-name/` change on `main`.

After deploying, note the production URL (e.g., `your-app.vercel.app` or a custom domain).

---

## 6. Wire the URL into Other Apps

The portal and other apps reference each app's URL via env vars. Add the new URL to every app that links to it:

In Vercel, add to **each relevant app** (at minimum the portal):

```
NEXT_PUBLIC_YOUR_APP_URL=https://your-app.vercel.app
```

Also add it to `turbo.json`'s `env` array.

---

## 7. Add the App Tile to the Portal

The portal home page renders app tiles from a static list in `apps/portal/app/(dashboard)/page.tsx` (or a `lib/apps.ts` config file — check the current structure).

Add an entry to the app list:

```typescript
{
  name: 'Your App Name',
  description: 'One-sentence description of what it does.',
  href: process.env.NEXT_PUBLIC_YOUR_APP_URL ?? '#',
  icon: YourIcon,          // import from lucide-react or use an existing icon
  roles: ['admin', 'dispatcher'],   // roles that should see this tile
}
```

The tile is only shown if the logged-in user's role is in the `roles` array. Check `docs/roles.md` for the available roles; add a new role to the `profiles` table if needed.

---

## 8. Add a Database Table (if needed)

Write a migration file:

```sql
-- supabase/migrations/YYYYMMDD_your_feature.sql

create table your_table (
  id uuid primary key default gen_random_uuid(),
  -- your columns
  created_at timestamptz default now()
);

-- Enable RLS
alter table your_table enable row level security;

-- Allow authenticated users to read
create policy "authenticated read"
  on your_table for select
  using (auth.role() = 'authenticated');

-- Restrict writes to admin/relevant role
create policy "admin write"
  on your_table for all
  using (
    exists (
      select 1 from profiles
      where id = auth.uid() and role in ('admin', 'your_role')
    )
  );
```

Apply via Supabase Dashboard → SQL Editor, or `supabase db push`. Never edit an existing migration file.

---

## 9. Add a GitHub Actions Workflow (if needed)

If your app has a backend Python script (data sync, report generation, etc.):

1. Add the script to `apps/your-app-name/scripts/your_script.py`
2. Add a `requirements.txt` (or extend the existing one if the deps are shared)
3. Create `.github/workflows/your-workflow.yml`

Workflow template:

```yaml
name: Your Workflow Name

on:
  schedule:
    - cron: '0 12 * * 1'   # adjust as needed
  workflow_dispatch:         # always add this — enables the "Run workflow" button

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
          cache-dependency-path: apps/your-app-name/requirements.txt

      - name: Install dependencies
        run: pip install -r apps/your-app-name/requirements.txt

      - name: Run script
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          YOUR_SECRET: ${{ secrets.YOUR_SECRET }}
        run: python apps/your-app-name/scripts/your_script.py
```

Add any new secrets to GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

If your workflow should be triggerable from the app's UI, use `repository_dispatch` (see `run-wip.yml` for the full pattern). The UI needs `GITHUB_PAT` and `GITHUB_REPO` set in Vercel, and your API route POSTs to `https://api.github.com/repos/{repo}/dispatches`.

---

## 10. Update Documentation

- Add the app to the table in `README.md`
- Add the new Vercel project to the table in `docs/infrastructure.md`
- Add the app's env vars to `docs/getting-started.md` and `docs/infrastructure.md`
- Add the app's role access to `docs/roles.md`
- Add any new tables to `docs/database.md` with the migration filename
- Add any new workflows to the table in `docs/data-sync.md`
- Create `docs/apps/your-app-name.md` following the format of other app docs
- Update `docs/user-guide.md` with end-user instructions

---

## Checklist

- [ ] App scaffolded with correct package name and port
- [ ] Shared packages installed (`@netcfs/auth`, `@netcfs/styles`, etc.)
- [ ] Auth routes in place (`/login`, `/auth/callback`, dashboard layout)
- [ ] `.env.local` created for local dev
- [ ] Vercel project created with all env vars set
- [ ] Production URL added to portal + other apps that link to it as `NEXT_PUBLIC_*`
- [ ] App tile added to portal with correct role list
- [ ] Database migration written and applied (if applicable)
- [ ] GitHub Actions workflow created (if applicable)
- [ ] New secrets added to GitHub and Vercel (if applicable)
- [ ] Documentation updated (README, infrastructure, roles, database, data-sync, user-guide)
