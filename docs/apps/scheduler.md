# Scheduler App

**Package**: `@netcfs/scheduler`
**Port**: 3007
**Directory**: `apps/scheduler/`

## Purpose

Live multi-dispatcher driver shift scheduler. Ported from the standalone Interstate Driver Scheduler. Dispatchers schedule shifts and off-days for the driver and dispatcher rosters, see real-time updates from other dispatchers, and review usage stats.

## Routes

| Route | Access | Purpose |
|-------|--------|---------|
| `/(auth)/login` | Public | Login |
| `/` | Authenticated | Main scheduler (tabs: Drivers / Dispatchers / Stats) |

## Tabs

- **Drivers** — LDT / HDT / Transport / Road Service
- **Dispatchers** — Dispatch / Office Manager
- **Stats** — 12 chart cards across three categories

## Key Components

### Scheduler.tsx
Top-level shell. Owns the active tab, week nav, filters (company / yard / search), view toggle (Grid / Gantt), and the bulk actions (copy last period, copy to next, clear period, undo). Loads drivers + a 3-week entry window so the week-over-week stats bar can render alongside the visible window.

### GridView.tsx
Driver-row × N-day-column grid. Multi-shifts per day stack as pills. Click an empty cell to add, click a shift cell to edit, click a day header to open Day View.

### GanttView.tsx
Same data on a continuous N×24-hour axis with a 6-hour overflow so overnight shifts visibly run past midnight. Bars are drag-resizable from either edge (saves on release).

### DayView.tsx
Modal day-detail timeline. Shows today's shifts on a -6h..+30h axis so yesterday's overnight bleed-throughs and today's overnights both render correctly. Bars are drag-resizable (left/right handles) or drag-movable (body).

### ShiftModal.tsx
Add / edit / delete a single entry. Toggle between Shift (start/end in 30-minute steps) and Off (PTO / sick / unavailable / other). Detects overnight automatically (end <= start).

### StatsView.tsx
12 chart cards across "Coverage & Scheduling", "People & Workload", "Trends & Operations". Each card has a per-card range chip (presets + custom date range) that overrides the global range. Charts use Chart.js. Includes a custom-rendered coverage heatmap (`<canvas>` direct) and a driver-detail picker that opens DriverDetailModal.

### DriverDetailModal.tsx
Past-7-days and upcoming-7-days breakdown for a single driver: scheduled hours, shift counts, off days, plus a per-day list.

## Database

- `drivers` — shared with other apps; this migration adds `active`, `inactive_reason`, `inactive_since`. The roster sync (irh_driver_number / irh_yard_number) was handled outside this app.
- `scheduler_driver_schedule` — `(driver_id, schedule_date, entry_type, start_time, end_time, off_reason, notes)`. Multiple shifts per (driver, date) are allowed; off-day exclusivity is enforced in the app.
- Realtime is enabled on `scheduler_driver_schedule` so other dispatchers see edits live.

See `supabase/migrations/20260512_scheduler.sql`.

## Access

Visible to: `admin`, `dispatcher`, `shop_manager`. RLS allows any authenticated user to read/write — true read-only would require tightening the policies.
