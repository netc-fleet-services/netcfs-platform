# Architecture

## Repository Layout

```
netcfs-platform/
├── apps/
│   ├── portal/          Next.js app — home dashboard & auth
│   ├── fleet/           Next.js app — truck/maintenance tracker
│   ├── transport/       Next.js app — dispatch board
│   ├── inspections/     Next.js app — safety scores & DVIRs
│   ├── swaps/           Next.js app — lifecycle cost calculator
│   └── impounds/        Next.js app — impound inventory
│
├── packages/
│   ├── auth/            Supabase auth helpers + role/permission types
│   ├── config/          Shared TypeScript configs
│   ├── db/              Typed Supabase client + shared type definitions
│   ├── styles/          Global CSS (Tailwind-based)
│   ├── ui/              Shared React component library
│   └── utils/           Date, CSV, validation helpers
│
├── supabase/
│   └── migrations/      SQL migration files (applied in order by date prefix)
│
├── .github/
│   └── workflows/       GitHub Actions for data sync and scoring jobs
│
├── turbo.json           Turborepo task pipeline config
├── pnpm-workspace.yaml  Workspace package declarations
└── package.json         Root scripts (dev, build, lint, typecheck)
```

## Monorepo Tooling

**pnpm workspaces** — All apps and packages are declared as workspace members. They reference each other as `workspace:*` dependencies, so changes to a shared package are immediately reflected without publishing.

**Turborepo** — Orchestrates tasks across the workspace. Key behaviors:
- `build` depends on `^build` (builds packages before apps that use them)
- Caches `.next/` and `dist/` outputs; skips unchanged work on re-runs
- `dev` is persistent and not cached
- Env vars that affect caching are declared in `turbo.json` (Supabase URLs, API keys, app ports)

## Shared Packages

### @netcfs/auth

Authentication and authorization layer. Every app imports from here rather than calling Supabase directly.

```
packages/auth/src/
├── client.ts       getSupabaseBrowserClient() — singleton for client components
├── server.ts       getSupabaseServerClient(), getSession(), getUserProfile()
├── middleware.ts   updateSession() — Next.js middleware (refreshes session cookie)
└── types.ts        UserRole enum, ROLE_PERMISSIONS matrix
```

**Auth flow:**
1. User hits a protected route
2. `middleware.ts` intercepts, calls `updateSession()` to refresh the Supabase cookie
3. Unauthenticated users are redirected to `/login`
4. Server components call `getSession()` / `getUserProfile()` to get role
5. Client components call `getSupabaseBrowserClient()` for RLS-enforced queries

**Roles and permissions** are defined in `types.ts`. The portal uses `ROLE_PERMISSIONS` to filter which app tiles to show each user. RLS in Supabase enforces the same rules at the database level.

### @netcfs/db

Typed Supabase client and shared type definitions.

- `getTypedClient()` — returns `createClient<Database>` with full type inference
- `types.ts` — mirrors the Supabase schema: `Truck`, `Driver`, `Job`, `InspectionRecord`, `Profile`, etc.

Most app-specific query logic lives in the app itself, not in this package. This package exists to avoid duplicating type definitions.

### @netcfs/ui

Shared React component library. Apps import components directly:

```ts
import { Button, StatusBadge, Modal, Sidebar } from '@netcfs/ui'
```

Components: `Button`, `Card`, `CardHeader`, `CardTitle`, `StatusBadge`, `PmBadge`, `Tag`, `Input`, `Select`, `Textarea`, `Modal`, `Drawer`, `Table`, `Sidebar`, `Header`, `ThemeToggle`, `PortalHeader`

### @netcfs/styles

Single `globals.css` imported by each app's root layout. Establishes CSS custom properties for the design system (colors, spacing, typography).

### @netcfs/utils

Pure utility functions with no React dependencies:

- **Date**: `formatDate`, `formatDateTime`, `formatRelative`, `daysUntil`, `pmStatus`
- **CSV**: `toCSV`, `downloadCSV`
- **Validation**: `isEmail`, `isNonEmpty`, `clamp`, `slugify`

### @netcfs/config

Shared TypeScript configuration. All `tsconfig.json` files in apps and packages extend from `@netcfs/config/tsconfig/nextjs.json` or `base.json`.

## App Architecture Pattern

Every app follows the same Next.js App Router structure:

```
apps/<name>/
├── app/
│   ├── layout.tsx              Root layout (imports globals.css, sets up auth provider)
│   ├── (auth)/
│   │   ├── login/page.tsx      Public login page
│   │   └── reset-password/     Password reset flow
│   ├── (dashboard)/
│   │   └── page.tsx            Protected main page (server component)
│   └── api/                    API routes (where needed)
├── components/                 Client components (most UI logic lives here)
├── lib/                        App-specific types, helpers, constants
├── scripts/                    Python data sync scripts
├── middleware.ts               Calls updateSession() from @netcfs/auth
├── next.config.ts
├── package.json
└── tsconfig.json
```

Server components fetch initial data and pass it to client components as props. Client components handle interactivity, filtering, and real-time Supabase subscriptions.

## Backend Sync Architecture

Data from external systems (Samsara, TowBook) is pulled by Python scripts running as GitHub Actions on scheduled cron triggers. Scripts authenticate to Supabase using the **service role key**, which bypasses Row Level Security — this is intentional for backend writes.

Each script follows this pattern:
1. Fetch data from external API or scrape TowBook with Playwright
2. Transform/normalize to match Supabase schema
3. Upsert to Supabase (insert or update on conflict key)
4. Log counts and errors to stdout (visible in GitHub Actions logs)

See [Data Sync](data-sync.md) for full details on each script and workflow.

## Deployment

All apps deploy to **Vercel**. Each app is a separate Vercel project pointed at its subdirectory. Vercel automatically rebuilds on push to `main`.

**Branch strategy:**
- `main` — production
- `feature/*` — development branches, merged via PR

## Key Design Decisions

**One Supabase project for all apps** — Simplifies auth (one session cookie works everywhere) and allows cross-app queries. RLS ensures each app's data is still isolated at the row level.

**Python for data sync, not Next.js API routes** — Sync jobs run on a schedule, need Playwright for browser automation, and have no user-facing latency requirements. Python is better suited than Node for this. GitHub Actions provides the scheduler.

**No shared database query layer** — Apps query Supabase directly using the typed client. There's no ORM or shared repository pattern. This keeps each app simple and avoids premature abstraction across very different data models.

**CSS custom properties instead of Tailwind everywhere** — The shared design system uses CSS variables (e.g., `rgb(var(--primary))`) rather than Tailwind classes for component-level styling. This makes theming and dark mode simpler across six apps.
