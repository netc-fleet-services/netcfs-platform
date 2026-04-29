# Fleet App

**Package**: `@netcfs/fleet`  
**Port**: 3001  
**Directory**: `apps/fleet/`

## Purpose

Real-time visibility into the status and maintenance health of every truck in the fleet. Mechanics and the shop manager use this daily to track preventive maintenance schedules, log work completed, and manage equipment requests. Dispatchers use it to check truck availability before assigning jobs.

## Routes

| Route | Access | Purpose |
|-------|--------|---------|
| `/(auth)/login` | Public | Login |
| `/(auth)/reset-password` | Public | Password reset |
| `/(dashboard)` | Authenticated | Main fleet table |
| `/(dashboard)/admin` | Admin only | Admin settings |

## Key Components

### fleet-dashboard.tsx
Top-level client component. Fetches trucks from Supabase on mount, maintains filter state, and renders the status table. Houses the filter bar (search, location filter, category filter) and the action buttons.

### status-table.tsx
The main data table. Each row is a `truck-row.tsx`. Supports sorting by column. Columns include: unit number, location, status badge, PM badge, last PM date, next PM due, and action buttons (notes, inspect, history).

### truck-row.tsx
Renders a single truck. Shows status badge, PM badge, and opens modals for notes, inspection entry, and inspection history.

### maintenance-badge.tsx (PmBadge)
Color-coded badge based on `next_pm_due`, computed by `pmStatus()` in `packages/utils/src/date.ts`:

| Status | Condition | Badge color |
|--------|-----------|-------------|
| `ok` | More than 60 days until next PM | Green |
| `soon` | 0–60 days until next PM | Yellow |
| `overdue` | Next PM date is in the past | Red |

The 60-day threshold is defined as `PM_SOON_DAYS = 60` in `apps/fleet/lib/constants.ts`.

### notes-drawer.tsx
Slide-out panel showing all notes for a truck. Notes are typed as `driver`, `mechanic`, or `work_done`. New notes can be added. Notes are written to the `truck_notes` table.

### InspectionModal.tsx
Form for recording a new pre-trip / post-trip vehicle inspection. Produces a pass/fail result per checklist item. Writes to `vehicle_inspections`. Sets `has_fails = true` if any item fails.

### InspectionHistoryModal.tsx
Read-only view of past inspections for a truck. Shows date, inspector, pass/fail summary, and expandable item detail.

### HistoryReportModal.tsx
Exports maintenance history as an XLSX file using the `xlsx` package.

### EquipmentRequestModal.tsx
Form for submitting an equipment request (new equipment or replacement). Fields: request type, description, purpose, urgency, impact if denied. Submitted requests go to `equipment_requests` with `status = 'pending'`. Managers review and approve/deny from the admin settings page.

### admin-settings.tsx
Admin-only page. Shows pending equipment requests with approve/deny controls. Updates `status`, `reviewed_by`, and `reviewed_at` on the `equipment_requests` row.

## Data Model

The fleet app reads and writes these tables:

- `trucks` — source of truth for vehicle list and PM dates
- `truck_notes` — notes by type (driver/mechanic/work_done)
- `status_history` — audit log of status changes
- `vehicle_inspections` — inspection records
- `equipment_requests` — procurement requests

## Truck Status Values

Three allowed values, defined in `apps/fleet/lib/constants.ts`:

| Value | Label | Meaning |
|-------|-------|---------|
| `ready` | Ready for Use | Truck is operational and available |
| `issues` | Known Issues | Truck is operational but has outstanding maintenance items |
| `oos` | Out of Service | Truck is not available — in shop or otherwise down |

## Filters

The filter bar allows filtering the truck list by:
- **Search** — unit number, make, model, VIN (text search)
- **Location** — yard/location dropdown
- **Category** — filter by truck category (defined in `apps/fleet/lib/constants.ts`):

| Value | Label |
|-------|-------|
| `hd_tow` | HD Tow |
| `ld_tow` | LD Tow |
| `roadside` | Roadside |
| `transport` | Transport |

## Roles and Permissions

Permissions are enforced both in the UI (buttons hidden/disabled) and via Supabase RLS. The constants in `apps/fleet/lib/constants.ts` define the capability groups:

| Capability | Roles |
|-----------|-------|
| Set status to Known Issues or Out of Service | `admin`, `shop_manager`, `dispatcher`, `mechanic`, `driver` |
| Set status to Ready for Use | `admin`, `shop_manager`, `dispatcher`, `mechanic` |
| Add mechanic / work done notes | `admin`, `shop_manager`, `dispatcher`, `mechanic` |
| Add driver notes | all roles with fleet access |
| Edit "Waiting On" field | `admin`, `shop_manager`, `dispatcher`, `mechanic` |
| Add / manage trucks | `admin`, `shop_manager`, `dispatcher` |
| Access admin settings page | `admin`, `shop_manager`, `dispatcher` |
| Manage status-change notification rules | `admin` only |
| Manage inspection notification rules | `admin` only |
| View history report (XLSX export) | `admin`, `shop_manager`, `dispatcher` |
