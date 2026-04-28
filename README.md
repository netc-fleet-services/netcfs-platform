# netcfs-platform

Internal operations platform for NETCFS — a monorepo of six Next.js apps sharing authentication, UI, and data infrastructure.

## Apps

| App | Port | Purpose |
|-----|------|---------|
| [portal](apps/portal/) | 3000 | Home dashboard and app launcher |
| [fleet](apps/fleet/) | 3001 | Truck status, maintenance, and equipment tracking |
| [transport](apps/transport/) | 3002 | Dispatch board and job scheduling |
| [inspections](apps/inspections/) | 3003 | Driver safety scores and DVIR compliance |
| [swaps](apps/swaps/) | 3004 | Fleet lifecycle cost optimizer |
| [impounds](apps/impounds/) | 3005 | Impounded vehicle inventory and disposition |

## Quick Start

```bash
pnpm install
pnpm dev        # starts all six apps
```

Run a single app:

```bash
pnpm --filter @netcfs/safety dev      # inspections
pnpm --filter @netcfs/impounds dev    # impounds
```

## Documentation

| Doc | Contents |
|-----|----------|
| [Overview](docs/overview.md) | Platform purpose, users, high-level concepts |
| [Getting Started](docs/getting-started.md) | Local setup, env vars, first run |
| [Architecture](docs/architecture.md) | Monorepo structure, packages, tech decisions |
| [Database](docs/database.md) | Supabase schema, all tables, RLS, migrations |
| [Data Sync](docs/data-sync.md) | Python scripts, Samsara/TowBook integrations, GitHub Actions |
| [Portal](docs/apps/portal.md) | Auth flow, role-based app tiles |
| [Fleet](docs/apps/fleet.md) | Truck tracking, PM schedules, notes |
| [Transport](docs/apps/transport.md) | Dispatch, job sync, geocoding |
| [Inspections](docs/apps/inspections.md) | Safety scoring, DVIRs, Samsara integration |
| [Swaps](docs/apps/swaps.md) | Lifecycle cost calculator |
| [Impounds](docs/apps/impounds.md) | Impound inventory, TowBook sync, photos |

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript
- **Monorepo**: Turborepo + pnpm workspaces
- **Backend/DB**: Supabase (Postgres, Auth, Storage, RLS)
- **Hosting**: Vercel
- **Data sync**: Python + Playwright + GitHub Actions
