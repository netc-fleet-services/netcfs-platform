# Swaps App

**Package**: `@netcfs/swaps`  
**Port**: 3004  
**Directory**: `apps/swaps/`

## Purpose

Fleet lifecycle cost calculator. Helps fleet managers decide the optimal time to replace a truck by modeling the total cost of ownership over time — factoring in depreciation, maintenance cost escalation, and downtime revenue loss.

## Routes

| Route | Access | Purpose |
|-------|--------|---------|
| `/` | Authenticated | Single-page swap calculator |

## Key Components

### SwapTool.tsx

Interactive cost model. The user inputs truck-specific parameters and the tool computes the optimal replacement month by minimizing total annual cost of ownership over an 8-year horizon.

**Inputs:**

| Field | Description |
|-------|-------------|
| Purchase Price | Total out-the-door cost including tax and upfit |
| Annual Miles | Expected miles driven per year (drives downtime growth) |
| Base Maintenance Year 1 | Maintenance spend in the first year of service |
| Maintenance Escalation (%/yr) | How much yearly maintenance grows each additional year |
| Revenue per Operating Day | Revenue the truck generates on a normal working day |
| Operating Conditions | `Easy` (highway/light loads) / `Typical` (mixed duty) / `Punishing` (heavy loads, rough terrain) — adjusts the downtime growth model |
| Resale Value by Year (%) | Percentage of purchase price retained at years 2–8 (entered as individual fields) |

**Summary cards:**

| Card | Value |
|------|-------|
| Recommended Swap | Month/year of minimum annual cost |
| Cost / Year at Optimum | Annual ownership cost at that point |
| Miles at Swap | Cumulative miles at that point |
| Resale Recovered | Estimated trade-in value at that point |

**Charts:**

1. **Truck Value vs. Money Spent Keeping It** — Resale value line (blue) vs cumulative operating cost area (orange/red) over 8 years. The crossover point (where operating costs exceed resale value) is marked with a callout.

2. **Annual Cost of Ownership** — Cost per year curve over 8 years (starting from year 2). The optimal replacement month (lowest point) is marked with a callout showing month and cost/year.

**Swap Scenario Comparison table:** One row per year (years 2–8), highlighted row = winner. Columns: Swap After, Miles, Resale, Depreciation, Cumulative Maintenance, Lost Revenue, Total Cost, Cost/Year.

**Year-by-Year Schedule** (expandable): Year, Cumulative Miles, Maintenance, Downtime Days, Lost Revenue, Cumulative Maintenance, Cumulative Lost Revenue.

**Actions:** Export CSV (scenario comparison + optimal month) and Print/PDF.

## Data

The swaps tool is **standalone** — it does not read from or write to the Supabase database. All calculations happen client-side from user-entered inputs. There is no persistence; inputs reset on page refresh. Results can be exported as CSV or printed to PDF.

## Who Uses It

Dispatchers and fleet managers use this tool when evaluating whether to trade in an aging truck or continue maintaining it. The output informs capital planning decisions.
