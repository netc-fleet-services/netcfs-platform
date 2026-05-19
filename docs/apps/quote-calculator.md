# Quote Calculator App

**Package**: `@netcfs/quote-calculator`
**Port**: 3006
**Directory**: `apps/quote-calculator/`

## Purpose

Dispatcher-facing towing quote builder. Selects a service rate, enters job details, computes a full line-item breakdown (base rate, fuel surcharge, escort, uncertainty range), and exports a branded PDF quote. All pricing constants are stored in Supabase so non-developers can adjust them without touching code.

## Routes

| Route | Access | Purpose |
|-------|--------|---------|
| `/(auth)/login` | Public | Login |
| `/` | Authenticated | Main calculator |
| `/api/pricing-config` | Server | Returns pricing constants from Supabase `pricing_config` table |
| `/api/fuel-surcharge` | Server | Returns current fuel surcharge from `fuel_prices` + `pricing_config` |
| `/api/route` | Server | GraphHopper route distance/time estimate |
| `/api/quotes` | Server | Save and retrieve quote records |

## Key Components

### Calculator.tsx
Top-level shell. Loads `service_rates`, `yards`, fuel surcharge, and pricing config from the API on mount. Owns two call-flow modes (Lookup and Quick Call) and passes all config down for calculation.

### pricingEngine.ts (`lib/pricingEngine.ts`)
Pure calculation functions. `computeLines()` builds each line item from the service rate and inputs; `calculateQuote()` assembles the full `QuoteBreakdown`. Accepts a `PricingConfig` object so constants come from the database, not the source code.

### QuotePDF
PDF generation via jsPDF + jspdf-autotable. Produces a branded quote sheet with the NETCFS logo, line-item table, and total.

## Pricing Config

Pricing constants are stored in the `pricing_config` Supabase table (key-value pairs). Editable by admins directly in the Supabase Dashboard → Table Editor. No code changes needed.

| Key | Meaning |
|-----|---------|
| `credit_card_fee_percent` | Credit card processing surcharge (%) |
| `escort_markup_percent` | Markup applied to escort sub-contractor cost (%) |
| `time_uncertainty_minutes` | ±range added to time estimate (minutes) |
| `miles_uncertainty` | ±range added to distance estimate (miles) |
| `fuel_surcharge_min_price` | Fuel price below which surcharge is 0% |
| `fuel_surcharge_max_price` | Fuel price above which surcharge is capped |
| `fuel_surcharge_base_percent` | Surcharge at the minimum fuel price threshold (%) |
| `fuel_surcharge_increment_price` | Price increment per surcharge tier ($) |
| `fuel_surcharge_increment_percent` | Surcharge % added per tier |
| `fuel_surcharge_max_percent` | Maximum fuel surcharge cap (%) |

## Database

- `service_rates` — Rate cards for each billable service. Managed via Supabase table editor.
- `pricing_config` — Key-value pricing constants (see table above).
- `fuel_prices` — Latest diesel prices fed by an external Make integration.
- `quotes` — Saved quote records (inputs + full breakdown as JSONB).
- `yards` — Yard locations used as route starting points.

## External Dependencies

- **GraphHopper** — Route distance and duration. Requires `GRAPHHOPPER_API_KEY` in Vercel.
- **jsPDF** — Client-side PDF generation. No API key needed.

## Access

Visible to: `admin`, `dispatcher`. Read access to `service_rates` and `yards` for all authenticated users.
