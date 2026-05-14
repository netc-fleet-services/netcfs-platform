# netcfs-platform

Internal operations platform for NETCFS — a monorepo of ten Next.js apps sharing authentication, UI, and data infrastructure.

## Apps

| App | Port | Purpose |
|-----|------|---------|
| [portal](apps/portal/) | 3000 | Home dashboard and app launcher |
| [fleet](apps/fleet/) | 3001 | Truck status, maintenance, and equipment tracking |
| [transport](apps/transport/) | 3002 | Dispatch board and job scheduling |
| [inspections](apps/inspections/) | 3003 | Driver safety scores and DVIR compliance |
| [swaps](apps/swaps/) | 3004 | Fleet lifecycle cost optimizer |
| [impounds](apps/impounds/) | 3005 | Impounded vehicle inventory and disposition |
| [quote-calculator](apps/quote-calculator/) | 3006 | Towing quote builder with routing and PDF export |
| [scheduler](apps/scheduler/) | 3007 | Driver shift scheduling with real-time multi-user editing |
| [statement-reconciler](apps/statement-reconciler/) | 3008 | Vendor statement vs. QuickBooks reconciliation |
| [fullbay-wip](apps/fullbay-wip/) | 3009 | Weekly Fullbay work-in-progress snapshot by shop |

## Quick Start

```bash
pnpm install
pnpm dev        # starts all apps
```

Run a single app:

```bash
pnpm --filter @netcfs/safety dev                  # inspections
pnpm --filter @netcfs/impounds dev                # impounds
pnpm --filter @netcfs/quote-calculator dev        # quote calculator
pnpm --filter @netcfs/scheduler dev               # scheduler
pnpm --filter @netcfs/statement-reconciler dev    # statement reconciler
pnpm --filter @netcfs/fullbay-wip dev             # fullbay WIP
```

## Documentation

| Doc | Contents |
|-----|----------|
| [Overview](docs/overview.md) | Platform purpose, users, high-level concepts |
| [Getting Started](docs/getting-started.md) | Local setup, env vars, first run |
| [Architecture](docs/architecture.md) | Monorepo structure, packages, tech decisions |
| [Database](docs/database.md) | Supabase schema, all tables, RLS, migrations |
| [Data Sync](docs/data-sync.md) | Python scripts, Samsara/TowBook integrations, GitHub Actions |
| [Infrastructure](docs/infrastructure.md) | Supabase/Vercel/GitHub setup, all secrets, handover checklist |
| [Roles](docs/roles.md) | Role definitions and per-app permission matrix |
| [User Guide](docs/user-guide.md) | End-user instructions for every app |
| [Portal](docs/apps/portal.md) | Auth flow, role-based app tiles |
| [Fleet](docs/apps/fleet.md) | Truck tracking, PM schedules, notes |
| [Transport](docs/apps/transport.md) | Dispatch, job sync, geocoding |
| [Inspections](docs/apps/inspections.md) | Safety scoring, DVIRs, Samsara integration |
| [Swaps](docs/apps/swaps.md) | Lifecycle cost calculator |
| [Impounds](docs/apps/impounds.md) | Impound inventory, TowBook sync, photos |
| [Scheduler](docs/apps/scheduler.md) | Shift scheduling, multi-user editing, analytics |

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript
- **Monorepo**: Turborepo + pnpm workspaces
- **Backend/DB**: Supabase (Postgres, Auth, Storage, RLS)
- **Hosting**: Vercel
- **Data sync**: Python + Playwright + GitHub Actions
