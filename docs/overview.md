# Platform Overview

## What It Is

NetCFS Platform is a private internal operations platform for a trucking and towing company. It consolidates ten distinct operational tools — previously separate apps — into a single authenticated monorepo. Every tool shares the same login session, design system, and database.

## Who Uses It

Access is controlled by role. Each role sees only the apps relevant to their job:

| Role | Apps |
|------|------|
| `admin` | All apps |
| `dispatcher` | Fleet, Transport, Inspections, Swaps, Reports, Impounds, Quote Calculator, Scheduler |
| `shop_manager` | Fleet, Scheduler, Fullbay WIP |
| `mechanic` | Fleet, Inspections |
| `driver` | Fleet |
| `impound_manager` | Impounds |
| `viewer` | Fleet, Transport, Inspections, Swaps, Reports (read-only) |
| `accounts` | Statement Reconciler, Fullbay WIP |

See [docs/roles.md](roles.md) for a full breakdown of what each role can do within each app.

## The Ten Apps

### Portal
The home screen. Shows each user a grid of app tiles filtered to their role. Handles login, password reset, and OAuth callback. The only app with public-facing routes. Also hosts the Reports section, which provides nine report types covering safety, dispatch, maintenance, impounds, and scheduling analytics.

### Fleet
Tracks every truck in the fleet — its current status, preventive maintenance schedule, driver/mechanic notes, inspection history, and equipment requests. The shop manager and mechanics use this daily.

### Transport
Real-time dispatch board fed by a TowBook sync that runs every 15 minutes. Dispatchers assign drivers to jobs, manage job stacking, and track job status from pickup through completion.

### Inspections (Safety)
Quarterly driver safety program. Ingests safety events from Samsara (the vehicle telematics platform), tracks DVIR (Daily Vehicle Inspection Report) completion, records DOT citations and OOS orders, and computes a ranked safety score for every driver. The safety manager reviews the leaderboard and can manually override missed DVIRs.

### Swaps
Fleet lifecycle cost calculator. Helps fleet managers decide the optimal time to replace a truck by modeling depreciation, maintenance cost escalation, and downtime revenue loss.

### Impounds
Inventory of impounded vehicles towed and held by the company. Tracks each vehicle through intake, storage, valuation, and disposition (released, sold, scrapped). Photos, keys, and drive status are recorded. Fed by an automated TowBook export that runs every 4 hours.

### Quote Calculator
Builds itemized towing quotes. The dispatcher enters pickup and drop addresses, selects a service type, and the app calls GraphHopper to calculate route distance and drive time. The current fuel surcharge is applied automatically from live fuel price data. Quotes can be saved, downloaded as PDFs, and emailed to customers. A fuel surcharge override is available for contracted customers with fixed rates.

### Scheduler
Multi-user shift scheduling tool for drivers. Dispatchers and shop managers build weekly schedules in a grid, Gantt, or day view. All edits sync in real time so multiple dispatchers can work simultaneously without conflicts. Includes coverage analytics, bulk copy tools, and CSV export.

### Statement Reconciler
Compares vendor PDF statements against QuickBooks exports to identify mismatches, missing line items, and dollar variances. Supports 30+ configured vendors with vendor-specific PDF parsers. Also reconciles Fullbay service orders against QuickBooks invoices for shop billing verification.

### Fullbay WIP
Generates a weekly snapshot of all open Fullbay service orders, broken down by shop with total costs. Runs automatically every Monday morning and can be triggered manually. Results are downloadable as summary and detail files.

## Data Sources

External systems that feed the platform:

- **Samsara** — Vehicle telematics. Provides GPS trips, safety event detection (harsh braking, speeding, distraction, etc.), and DVIR submissions from in-cab tablets. Accessed via REST API; synced by scheduled GitHub Actions.
- **TowBook** — Towing dispatch and impound management software. No formal API; data is extracted by a headless browser (Playwright) that logs in, exports a CSV, and parses it. Jobs sync every 15 minutes; impounds every 4 hours.
- **GraphHopper** — Routing API used by the quote calculator to estimate drive distance and time between addresses.
- **Fullbay** — Shop management software. WIP snapshots and service order data are pulled via API by the Fullbay WIP app and the Statement Reconciler.
- **MarketCheck** — Vehicle valuation API used by the impounds app to estimate vehicle resale value.
- **Resend** — Email delivery service used by the fleet app to send PM alerts, inspection notifications, and equipment request updates.

All scheduled sync jobs run as GitHub Actions on cron triggers. Python scripts handle the actual scraping/API calls and write to Supabase via the service role key.
