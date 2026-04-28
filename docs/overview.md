# Platform Overview

## What It Is

NetCFS Platform is a private internal operations platform for a trucking and towing company. It consolidates six distinct operational tools — previously separate apps — into a single authenticated monorepo. Every tool shares the same login session, design system, and database.

## Who Uses It

Access is controlled by role. Each role sees only the apps relevant to their job:

| Role | Apps |
|------|------|
| `admin` | All apps |
| `dispatcher` | Fleet, Transport, Inspections, Swaps, Reports, Impounds |
| `shop_manager` | Fleet |
| `mechanic` | Fleet, Inspections |
| `driver` | Fleet |
| `impound_manager` | Impounds |
| `viewer` | Fleet, Transport, Inspections, Swaps, Reports (read-only) |

## The Six Apps

### Portal
The home screen. Shows each user a grid of app tiles filtered to their role. Handles login, password reset, and OAuth callback. The only app with public-facing routes.

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

## Data Sources

Two external systems feed the platform:

- **Samsara** — Vehicle telematics. Provides GPS trips, safety event detection (harsh braking, speeding, distraction, etc.), and DVIR submissions from in-cab tablets. Accessed via REST API.
- **TowBook** — Towing dispatch and impound management software. The platform does not have a formal API; data is extracted by a headless browser (Playwright) that logs in, exports a CSV, and parses it.

All sync jobs run as GitHub Actions on scheduled triggers. Python scripts handle the actual scraping/API calls and write to Supabase via the service role key.
