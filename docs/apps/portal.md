# Portal App

**Package**: `@netcfs/portal`  
**Port**: 3000  
**Directory**: `apps/portal/`

## Purpose

The portal is the entry point for all users. It handles authentication and presents each user with a personalized grid of app tiles based on their role. A dispatcher sees Fleet, Transport, Inspections, Swaps, Impounds, and Reports tiles. A mechanic sees only Fleet and Inspections.

## Routes

| Route | Access | Purpose |
|-------|--------|---------|
| `/(auth)/login` | Public | Email/password login |
| `/(auth)/forgot-password` | Public | Send password reset email |
| `/(auth)/reset-password` | Public | Token-based password reset |
| `/(dashboard)` | Authenticated | Home dashboard with app tiles |
| `/auth/callback` | Public | Supabase OAuth callback handler |

## Key Components

### AppTilesClient.tsx

The main dashboard component. Receives the user's role as a prop from the server component, filters the full module list to only those the role can access, and renders a grid of clickable tiles.

Each tile defines:
- `id` — matches a key in `ROLE_PERMISSIONS`
- `label` — display name
- `description` — one-line description shown on the tile
- `url` — where clicking the tile navigates to
- `icon` — emoji or icon
- `color` — accent color for the tile card

The six modules and their tile URLs (defaults — override via env vars):

| Module | Default URL | Env var override |
|--------|-------------|-----------------|
| Fleet (Maintenance Tracker) | `https://netcfs-platform-fleet.vercel.app` | `NEXT_PUBLIC_FLEET_URL` |
| Transport (Dispatch Board) | `https://netcfs-platform-transport.vercel.app` | `NEXT_PUBLIC_TRANSPORT_URL` |
| Safety (Inspections) | `https://netcfs-platform-inspections.vercel.app` | `NEXT_PUBLIC_INSPECTIONS_URL` |
| Swaps (Swap Optimizer) | `https://netcfs-platform-swaps.vercel.app` | `NEXT_PUBLIC_SWAPS_URL` |
| Impounds (Impound Tracker) | `https://netcfs-platform-impounds.vercel.app` | `NEXT_PUBLIC_IMPOUNDS_URL` |
| Reports | `/reports` (portal-local, not yet built) | — |
| Settings | `/settings` (portal-local, not yet built) | — |

## SSO Token Passing

When a user clicks an app tile, the portal doesn't just navigate to the app's URL — it first fetches the current Supabase session tokens and appends them as query params to an `/auth/sso` endpoint on the target app:

```
https://netcfs-platform-fleet.vercel.app/auth/sso?access_token=...&refresh_token=...
```

Each app's `/auth/sso` route reads these params and calls `setSession()` to establish the Supabase session in the new app's cookies. This means the user is automatically logged in to every app from the portal without a separate login step.

If the portal hasn't loaded the session yet (e.g., SSO tokens are still null), the tile href falls back to the bare base URL, and the target app's middleware will redirect to its own login page.

## Auth Flow

1. User hits `/(dashboard)` → server component calls `getSession()`
2. If no session → middleware redirects to `/(auth)/login`
3. User submits credentials → Supabase Auth sets session cookie
4. Redirect back to `/(dashboard)` → `getUserProfile()` fetches the `profiles` row
5. Profile's `role` is passed to `AppTilesClient`
6. App tiles are filtered by `ROLE_PERMISSIONS[role]`

## Role → Visible Apps

| Role | Visible Apps |
|------|-------------|
| `admin` | All six |
| `dispatcher` | Fleet, Transport, Safety, Swaps, Impounds, Reports |
| `shop_manager` | Fleet |
| `mechanic` | Fleet, Safety |
| `driver` | Fleet |
| `viewer` | Fleet, Transport, Safety, Swaps, Reports |
| `impound_manager` | Impounds |

The `ROLE_PERMISSIONS` matrix lives in `packages/auth/src/types.ts` and is the single source of truth for this mapping.
