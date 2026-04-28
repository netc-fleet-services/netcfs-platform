# Impounds App

**Package**: `@netcfs/impounds`  
**Port**: 3005  
**Directory**: `apps/impounds/`

## Purpose

Inventory management for vehicles towed and held by the company. Tracks every impounded vehicle from intake through disposition — storage details, valuation, photos, keys/driveability, and final outcome (released, sold, scrapped). Data is synced from TowBook every 4 hours.

## Routes

| Route | Access | Purpose |
|-------|--------|---------|
| `/(auth)/login` | Public | Login |
| `/(dashboard)` | Authenticated | Main impound dashboard |

## Key Components

### impound-dashboard.tsx

The main view. Renders a filterable, sortable table of all impounded vehicles. Also renders a mobile card layout that replaces the table on small screens.

**Filters**:
- **Status**: `Owned` / `Police Hold` / `Current Impound` (the three values from TowBook)
- **Location**: `Exeter` / `Pembroke` / `Bow` / `Saco` / `Lee`
- **Text search**: call number, VIN, make/model

**Table columns**: Call #, Time on Lot, Vehicle (year/make/model), VIN, Location, Status, Reason, Notes, Keys, Drives, Type, Value

**Responsive behavior**:
- Notes column hidden below 1380px
- VIN column hidden below 1180px
- Table hidden entirely below 640px → replaced by card layout

**Card layout (mobile)**: Each vehicle rendered as a card showing call number, status badge, time-on-lot badge, vehicle description, date/location/VIN, notes, keys/drives, type, and estimated value. Cards are clickable to open the detail drawer.

Clicking any row or card opens `VehicleDetailDrawer`.

### vehicle-detail-drawer.tsx

Slide-out panel with the full record for one impounded vehicle. Shows all fields from the `impounds` table plus uploaded photos. Allows editing of manual fields (sell flag, estimated value, sales description, notes, needs_detail, needs_mechanic, estimated_repair_cost).

**Photo section**: Displays all photos from `impound_photos` (loaded from Supabase Storage). Allows uploading new photos. Photos are stored in the `impound-photos` storage bucket.

### sales-history-modal.tsx

Named "Vehicle History" in the UI. A date-range query over the `impounds` table filtered to records with `sold`, `scrapped`, or `released` set to true, filtered by `disposition_date`.

**Filters**: From date / To date (defaults to Jan 1 of current year through today), plus checkboxes to include/exclude Sold, Scrapped, Released records.

**Summary metrics**: Total Records, Sold count, Scrapped count, Released count, Total Value (sold → `estimated_value`; scrapped → $600 fixed scrap value; released → $0).

**Table columns**: Call #, Vehicle (make/model), Year, Disposition (color-coded badge: green=Sold, blue=Released, gray=Scrapped), Value, Disposition Date.

**Export**: Download CSV button (columns: Call #, Make/Model, Year, Disposition, Value, Date).

---

## Data Sync

Impound records are synced from TowBook every 4 hours by `apps/impounds/scripts/sync_impounds.py`, triggered by the `sync-towbook.yml` GitHub Actions workflow. Manual triggers are also available from the workflow UI.

See [Data Sync → sync_impounds.py](../data-sync.md) for full details.

**What the sync updates vs. preserves:**

| Field | Sync behavior |
|-------|--------------|
| call_number | Conflict key — never changed |
| date_of_impound | Updated from TowBook |
| make_model, year, vin | Updated from TowBook |
| reason_for_impound | Updated from TowBook |
| location, status | Updated from TowBook |
| released, amount_paid | Updated from TowBook |
| keys, drives | Updated from TowBook |
| notes | **Preserved** — only set on INSERT |
| sell | **Preserved** — manual flag |
| estimated_value | **Preserved** — manual valuation |
| sales_description | **Preserved** — manual listing text |
| needs_detail | **Preserved** — manual flag |
| needs_mechanic | **Preserved** — manual flag |
| estimated_repair_cost | **Preserved** — manual estimate |

This split ensures that automated TowBook data is always fresh while manual editorial work (valuations, sale prep flags, photos) survives sync runs.

---

## Photo Storage

Photos are stored in the Supabase Storage bucket `impound-photos`. The path convention is:

```
impound-photos/{impound_id}/{filename}
```

Rows in `impound_photos` track the storage path, original filename, and uploader. Deleting a photo requires removing both the storage object and the `impound_photos` row.

RLS on the bucket and the table restricts upload/delete to: `admin`, `dispatcher`, `impound_manager`.

---

## Time on Lot

Computed from `date_of_impound` to today. Displayed as a color-coded badge on both the table and mobile cards:

| Age | Label | Color |
|-----|-------|-------|
| < 30 days | `{N}d` (exact count) | Green |
| 30–89 days | `1–3 mo` | Yellow |
| 90–179 days | `3–6 mo` | Orange |
| 180–364 days | `6–12 mo` | Red |
| 365+ days | `1+ yr` | Purple |

---

## Disposition Tracking

A vehicle's lifecycle in the impound lot:

```
Impounded → [on lot] → Released by owner
                    → Sold (by company)
                    → Scrapped
```

Fields: `released` (bool), `sold` (bool), `scrapped` (bool), `disposition_date` (date).

---

## Data Model

Primary tables: `impounds`, `impound_photos`  
Storage: `impound-photos` Supabase Storage bucket

See [Database](../database.md) for full schema.

---

## Access Control

| Role | Access |
|------|--------|
| `admin` | Full read/write including photos |
| `dispatcher` | Full read/write including photos |
| `impound_manager` | Full read/write including photos |
| All others | No access |
