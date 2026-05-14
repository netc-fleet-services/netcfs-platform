# NETCFS Platform — User Guide

A practical guide for new users covering every app in the platform: what it does, who can use it, and how to use each feature.

---

## Table of Contents

1. [Getting In — Login & the Portal](#1-getting-in--login--the-portal)
2. [Fleet — Truck Status & Maintenance](#2-fleet--truck-status--maintenance)
3. [Transport — Dispatch Board](#3-transport--dispatch-board)
4. [Inspections — Driver Safety & DVIR](#4-inspections--driver-safety--dvir)
5. [Swaps — Truck Replacement Calculator](#5-swaps--truck-replacement-calculator)
6. [Impounds — Impound Inventory](#6-impounds--impound-inventory)
7. [Quote Calculator](#7-quote-calculator)
8. [Scheduler — Shift Planning](#8-scheduler--shift-planning)
9. [Statement Reconciler](#9-statement-reconciler)
10. [Fullbay WIP — Work In Progress Tracker](#10-fullbay-wip--work-in-progress-tracker)
11. [Reports](#11-reports)
12. [Role Reference](#12-role-reference)

---

## 1. Getting In — Login & the Portal

### Logging In

Navigate to the portal URL and sign in with your email and password. If you've never logged in before, contact an admin to have your account created and assigned a role.

### The Portal Dashboard

After logging in, you land on the portal — a tile grid showing every app your role can access. Tiles you don't have permission for won't appear. Click any tile to open that app.

The portal also links to a few external tools (Grist documentation, NETC Tools, NETCLabs) that open in a new tab.

### Navigation Between Apps

Every app has a **← Back to Portal** button in the header or top-left corner. Use that to return to the portal without losing your login session. Your session is shared across all apps — you don't need to log in again when switching.

---

## 2. Fleet — Truck Status & Maintenance

**Who can use it:** Mechanic, Driver, Dispatcher, Shop Manager, Viewer, Admin

**What it does:** Shows the real-time status of every truck in the fleet and lets authorized users log work, change statuses, and request equipment.

### The Truck List

Trucks are grouped into three sections:
- **Out of Service (OOS)** — Trucks that cannot be dispatched
- **Known Issues** — Trucks operational but with flagged problems
- **Ready** — Trucks fully available

Each row shows the unit number, VIN, yard location, truck category, current status, whether a PM (preventive maintenance) is overdue, and a preview of the last work note.

### Filtering the List

- **Search bar** — Type any part of a unit number, VIN, location, or note to narrow the list
- **Location dropdown** — Filter to a specific yard
- **Category checkboxes** — Filter by HD Tow, LD Tow, Roadside, or Transport
- **PM Due toggle** — Show only trucks with overdue scheduled maintenance

Applied filters appear as chips below the search bar. Click **×** on any chip to remove it.

### Syncing from TowBook

Click **↻ Job Status** in the header to pull the latest truck assignment data from TowBook. A timestamp shows when data was last refreshed. The list also updates automatically in the background every few minutes.

### Truck Actions

Click the **⋯** menu (or the action buttons) on any truck row to:

**View Notes** — Opens a panel showing the full work history for that truck: every note ever logged, who added it, and when.

**Add Note** — Log a new work entry. Choose a type (Work Done, Inspection, Maintenance), write your note, and save. Notes are timestamped and attributed to your account.

**Change Status** — Move a truck between Ready, Known Issues, and Out of Service. You must enter a comment describing why. If the truck is waiting on a part or repair, fill in the "Waiting on" field — this shows on the truck row so dispatchers know the blocker.

**Inspect Truck** — Record a new vehicle inspection. Fill in the inspection type, findings, and any defects noted.

**Log PM** — Record that a preventive maintenance interval was completed. Enter the date, current odometer, and hours. This resets the PM due clock.

**Request Equipment** — Submit an equipment request (tools, parts, accessories). The request is logged and visible to shop managers.

### PM Due Indicator

A red badge on a truck row means its scheduled PM interval has been reached. Use **Log PM** to clear it after the maintenance is completed.

### Download History Report

Admins and shop managers can click **⬇ History Report** to download a full export of truck status history, maintenance logs, and OOS periods.

---

## 3. Transport — Dispatch Board

**Who can use it:** Dispatcher, Admin, Viewer

**What it does:** Tracks all active TowBook jobs, assigns drivers, plans routes, and finds opportunities to stack nearby jobs together.

### The Board Layout

The main page is a multi-tab board. Use the tab bar at the top to switch between views.

### Planning Board Tab

Shows upcoming jobs laid out by date. Use this for advance scheduling — assigning drivers to jobs before the day begins. Click a job to open its detail panel and assign a driver.

### Dispatch Board Tab

The live view of today's jobs. Jobs are grouped by yard and show their current status (Scheduled → Active → Complete). Assign or reassign drivers directly from this view by clicking a job and selecting a driver from the dropdown.

### Drivers Tab

Lists all drivers with their current availability and yard assignment. Use this to see at a glance who is free, who is on a job, and which functions (Transport, Towing, Service) each driver covers. You can update a driver's yard assignment here.

### History Tab

Completed jobs. Filter by date range, driver, or status. Useful for looking up what happened on a specific call or verifying a driver's completed jobs for a period.

### Metrics Tab

Charts and numbers showing dispatch volume, driver utilization, and revenue trends over a selected time window.

### Settings Tab

Configure yards, driver profiles, staffing targets (target hours per day per yard), and the job reason types that appear in filters. Changes here affect how jobs are categorized across all views.

### Job Stacking

The **Stack Jobs** feature finds two or more jobs that are geographically close enough to combine into a single multi-stop run. Click the stack icon or button to open the optimizer. Set a distance threshold (in miles) and the tool surfaces matching job pairs. Click a suggestion to create a combined job.

### Driver Matching

When you have an unassigned job, use **Match Driver** to get a ranked list of available drivers sorted by proximity and workload. Select the best match and confirm the assignment.

### Syncing from TowBook

The board pulls job data from TowBook automatically on a 15-minute cycle. The last sync time appears in the header. You can force a manual refresh if needed.

---

## 4. Inspections — Driver Safety & DVIR

**Who can use it:** Mechanic, Dispatcher, Viewer, Admin

**What it does:** Tracks driver safety scores, DVIR (Daily Vehicle Inspection Report) completion, and compliance incidents. Data is pulled nightly from Samsara.

### Safety Dashboard (Default Tab)

The main view shows a safety scorecard for each driver:
- **Safety score** — A composite rating based on safety events (speeding, harsh braking, hard cornering), DVIR completion rate, and mileage. Displayed as a number and a visual indicator.
- **Event breakdown** — How many events of each type the driver has in the current period.
- **Rankings** — Drivers are ranked by score. Use this to identify top performers and drivers who need coaching.

Click a driver's row to drill down into their individual event log, DVIR history, and score trend over time.

### Pre-Trip Audit Tool (Tab 2)

Used to verify that drivers are completing their required pre-trip inspections. The audit combines data from two sources:

1. Upload a **Driver Activity export** from TowBook (CSV) — this establishes how many days each driver was active (and therefore how many pre-trip inspections were required).
2. Upload a **Pre-Trip Inspections export** from TowBook (CSV) — this shows how many inspections were actually submitted.

After uploading both files, click **Run Audit**. The tool produces a table showing each driver's required count, completed count, missed count, and completion percentage. A red row means the driver is significantly below the required threshold.

Click **Export to Excel** to download the audit results for reporting or HR use.

If either file is missing data, a warning banner appears at the top of the table noting what may be incomplete.

### Admin — Backfill Samsara Data (Tab 3)

If the automatic nightly sync missed data (e.g., due to an API outage), admins can use the **Backfill Samsara Data** button to re-pull data for a specified date range. Enter the start and end dates and click the button. The pipeline runs in the background; check back after a few minutes to confirm the data is populated.

---

## 5. Swaps — Truck Replacement Calculator

**Who can use it:** Dispatcher, Admin, and any role with portal access to this app

**What it does:** A financial modeling tool that calculates the optimal time to replace a truck based on repair costs, depreciation, and downtime.

### Entering Truck Data

Fill in the input fields on the left side of the page:

- **Purchase price** — What the truck originally cost
- **Current odometer / hours** — Current usage
- **Age (months)** — How long the truck has been in service
- **Annual repair costs** — Average annual maintenance and repair spend
- **Escalation rate** — How much repair costs grow each year (percentage)
- **Current repair estimate** — Any pending repair cost on the table right now
- **Current value** — What the truck would sell for today
- **Resale value** — Expected resale value as a percentage of purchase price
- **Cost per OOS day** — How much revenue or cost is incurred each day the truck is unavailable
- **Historical OOS percentage** — What percentage of days the truck is typically unavailable

You can also click a **condition preset** (Typical, Heavy Use, Light Use) to auto-fill reasonable default values for your situation, then adjust from there.

### Reading the Results

Two charts update in real time as you enter data:

**Value Crossover Chart** — Shows two lines: the truck's declining resale value and its rising cumulative operating cost. Where the lines cross is the point at which you've spent more keeping it than it's worth. The crossover point is marked with a vertical line.

**Cost Per Year Chart** — Shows the annualized cost of ownership for each year from year 2 through year 8. The lowest point on this curve is the optimal swap year. The optimal point is marked.

Below the charts, a year-by-year table shows Resale Value, Annual Repair Cost, OOS Days, Cost/Year, and Cumulative Cost for each year.

A summary box at the bottom states the recommended swap month and the projected cost per year at that point.

### Exporting

Click **Download CSV** to export the full year-by-year scenario table. This is useful for presenting the analysis to management or including in a capital planning document.

---

## 6. Impounds — Impound Inventory

**Who can use it:** Impound Manager, Dispatcher, Viewer, Admin

**What it does:** Tracks all impounded vehicles — their status, location, photos, estimated value, and disposition (sold, scrapped, or released).

### The Inventory Grid

The main view shows all active impounds as cards. Each card displays:
- Call number and intake date
- Photo thumbnail (if available; click to enlarge)
- Year, Make, Model
- Partial VIN
- Status badge (color-coded: Current Impound, Police Hold, Owned)
- Lot location
- Days on lot (color-coded by aging: green → amber → orange → red → purple as time passes)
- Estimated value (if listed for sale) or scrap value

### Filtering

- **Status filter** — Show All, Owned, Police Hold, or Current Impound
- **Location filter** — Filter to a specific yard or lot
- **Search** — Search by call number, make/model, VIN, or location

### Viewing Vehicle Details

Click any vehicle card to open the detail drawer on the right side. This shows:
- Full VIN, year, make, model
- Reason for impound and current status
- Whether keys are present and whether the vehicle drives
- Estimated value and repair cost
- Amount paid (if applicable)
- Internal cost notes
- Full photo gallery (click any thumbnail to open full size)
- Status history showing every transition with dates

### Updating a Vehicle

From the detail drawer:

**Change Status** — Move the vehicle to Released, Sold, or Scrapped. Select the new status, fill in any required details (sale price, disposition notes), and save.

**Add Photo** — Upload one or more photos of the vehicle. Photos appear immediately in the gallery.

### Syncing from TowBook

Click **↻ Sync from TowBook** to pull the latest impound data from TowBook. A status badge shows whether the sync is pending, running, completed, or errored. The sync typically runs automatically every four hours but can be triggered manually at any time.

---

## 7. Quote Calculator

**Who can use it:** Dispatcher, Admin

**What it does:** Generates itemized towing quotes with real route data, applies the current fuel surcharge automatically, and produces a downloadable PDF.

### Mode Selection

Two modes are available via the tabs at the top:
- **Quote a Call** — Build a new quote from scratch
- **Look at a Call** — Look up an existing TowBook job and build a quote from it

### Quote a Call

**Step 1 — Route**

Select the departing yard from the dropdown, then enter the pickup address and drop address. Addresses autocomplete as you type. If the job has additional stops (e.g., dropping a trailer then picking up another vehicle), click **+ Add Stop** to add them. Remove extra stops with the **×** button.

**Step 2 — Service**

Select the service category (Road Service, Light Duty Towing, Heavy Duty Towing, Transport). The cards below show all configured services in that category with their rates. Click a service card to select it. The selected card highlights with a blue border.

**Step 3 — Details**

Depending on the service type, fill in:
- **Load / unload time** — Time spent hooking up and dropping off (select from 0 to 2 hours in 15-minute increments)
- **Idle hours** — For services billed at an idle rate, enter the time the truck was on-scene but not driving
- **Equipment** — Note any customer equipment involved (e.g., "CAT 285 Skidsteer")
- **Extra hours** — Additional billable hours beyond the auto-calculated drive time
- **Extra charge** — Any flat dollar amount to add (e.g., tolls)
- **Permit cost** — For transport jobs requiring a special permit (pass-through cost)
- **Escort** — Check the box if an escort is required, then enter the escort cost; it will be marked up automatically

**Step 4 — Get the Quote**

Click **Get Quote**. The calculator calls the GraphHopper routing API and returns:
- Drive distance (miles)
- Estimated drive time (hours)
- Whether the route has tolls

If the route has tolls, a warning banner appears reminding you to add the toll amount to the Extra Charge field.

The quote breakdown appears below, showing each line item (labor, mileage, fuel surcharge, extras, etc.) and a total. The estimate also shows a low–high range reflecting normal variance in drive time (±20 minutes) and distance (±15 miles).

**Credit Card Fee** — If the customer is paying by card, check the checkbox to add the processing fee to the total.

**Step 5 — Save or Share**

- **Save + PDF** — Saves the quote to the database and downloads a formatted PDF. The PDF includes all line items, the customer's contact info (if entered), and the operator notes.
- **Copy Summary** — Copies a one-line summary (service name, total range, distance, time) to your clipboard for pasting into TowBook or a message.
- **Share / Email** — On mobile, opens the native share sheet to send the PDF. On desktop, downloads the PDF and opens a pre-filled email draft addressed to the customer.

### Fuel Surcharge

The current fuel surcharge percentage is shown in a banner near the top of the page. It is calculated automatically from the latest fuel price data and applies to every quote.

If a customer has a contracted fixed fuel rate, click **Override** to enter a custom percentage. The calculated value is shown in parentheses for reference. Click **↺ Reset** to return to the calculated rate.

### Customer Info (Optional)

Expand the **Customer Info** section to enter the customer's name, phone number, and email. This information is included in the PDF and used to pre-fill the email draft when sharing.

### Operator Notes (Optional)

Use the notes field to record internal context — who booked the job, any special instructions, or anything the dispatcher should know. Notes are saved with the quote but do not appear on the customer-facing PDF.

### Look at a Call

Type a TowBook call number into the search field and click **Look up**. The job details (description, reason, account, driver, pickup and drop addresses) are pulled from TowBook and displayed.

If a cached route exists for that job, it is shown automatically and the quote calculates. If no cached route is available, enter the mileage and hours manually using the number fields.

Select the appropriate service from the service picker and the quote updates. Save or download the PDF the same way as in Quote a Call mode.

### Recent Quotes

Click **Recent quotes →** in the header to view a history of all saved quotes with filters and the ability to re-download any previous PDF.

---

## 8. Scheduler — Shift Planning

**Who can use it:** Shop Manager, Admin, Dispatcher (view)

**What it does:** A real-time, multi-user scheduling tool for building and managing driver shifts. Multiple dispatchers can edit the schedule simultaneously — changes appear instantly for all users.

### Navigating Dates

Use the **←** and **→** arrows in the header to move backward and forward by week. Click the date display to jump to a specific date.

### View Modes

Three views are available via the tab bar:

**Grid View** — A weekly grid where rows are drivers and columns are days. Each cell shows the shift start/end time and the driver's function (color-coded). This is the default view and the best one for editing.

**Gantt View** — A horizontal timeline view showing each driver's shift as a colored bar. Good for visually checking coverage gaps and shift overlaps at a glance.

**Day View** — A single-day view broken into hours. Shows all drivers and which hours they are scheduled. Good for checking coverage at specific times of day.

### Adding a Shift

Click any empty cell in Grid View (or any empty time slot in Day View) to open the **Shift Modal**:

1. Select the driver from the dropdown (or the driver row you clicked auto-fills)
2. Enter the **start time** and **end time** (24-hour format, e.g., 06:00 – 18:00)
3. Select the **entry type**: Shift (they're working) or Off (they're not available)
4. If Off, select an **off reason**: Vacation, Sick, Training, Personal, or Other
5. Add an optional note
6. Click **Save**

### Editing or Deleting a Shift

Click any existing shift cell to open the Shift Modal pre-filled with that shift's details. Edit and save, or click **Delete** to remove the shift.

### Bulk Actions

To copy a shift pattern across multiple days:
1. Open the Shift Modal for the shift you want to copy
2. Select additional days to apply the same shift to
3. Save — the shift is created for all selected days

To clear shifts for a driver over a date range, use the bulk delete option in the modal.

### Filtering the Schedule

Use the **Settings** controls to filter what you see:
- **Company** — If you manage multiple companies
- **Yard** — Show only drivers at a specific location
- **Search** — Filter drivers by name
- **Show inactive drivers** — Toggle to include or hide drivers who are no longer active

### Stats View

The Stats tab shows analytics for the selected week (or a custom date range):
- **Coverage by hour** — How many drivers are on shift for each hour of the day
- **Hours by day** — Total driver-hours scheduled per day of the week
- **Top / Bottom drivers by hours** — Who is scheduled most and least
- **Hours by function** — Breakdown by job type (Transport, Towing, Service, etc.)
- **Off-day reasons** — Breakdown of why drivers are marked off
- **Week-over-week totals** — Trend in total scheduled hours

### Exporting the Schedule

Click **Export** to download a CSV of the schedule. Choose the date range and whether to include off-day entries. The export is useful for payroll processing or posting the schedule externally.

---

## 9. Statement Reconciler

**Who can use it:** Accounts, Admin

**What it does:** Compares vendor invoices (PDF) against QuickBooks exports to find mismatches, missing items, and dollar variances — without manual spreadsheet work.

### Vendor Statement Reconciliation (Tab 1)

**Step 1 — Select a vendor**

Choose the vendor from the dropdown. The list includes all configured vendors (Advantage, FleetPride, Keystone, KL Jack, National Tire, etc.).

**Step 2 — Upload files**

Upload two files:
- **QuickBooks export** — The CSV or Excel export from QuickBooks for the period you're reconciling
- **Vendor statement(s)** — The PDF statement(s) from the vendor for the same period. You can upload multiple PDF files if the statement spans multiple documents.

Drag and drop files onto the upload area or click to open the file picker.

**Step 3 — Run reconciliation**

Click **Submit**. The reconciliation runs in the background. A status badge shows: Pending → Running → Done (or Error if something went wrong).

**Step 4 — Review results**

When complete, the results table shows:
- How many line items were in the QuickBooks export vs. the vendor statement
- How many matched, and how many didn't
- The total dollar value from each source and the variance
- Click **Download** to get a detailed report file

### Fullbay WIP Reconciliation (Tab 2)

Compares Fullbay service orders against QuickBooks invoices to identify which service orders are in one system but not the other.

**Step 1 — Upload files**
- **Fullbay export** — JSON export of service orders from Fullbay
- **QuickBooks export** — The matching QB export for the same period

**Step 2 — Run and review**

Click Submit. Results show:
- Total invoices compared
- Items in both systems (matched)
- Items only in Fullbay (not yet invoiced in QB)
- Items only in QuickBooks (no corresponding service order)
- Dollar variance

The detail table lists every discrepancy with the invoice number, source, shop, and amounts from each system. Download the discrepancy report to share or resolve each item.

### Job History

Both tabs show a list of past reconciliation runs below the upload area. Click any past job to review its results again, or re-run it with the same files.

---

## 10. Fullbay WIP — Work In Progress Tracker

**Who can use it:** Shop Manager, Admin, Accounts

**What it does:** Generates a weekly snapshot of all open Fullbay service orders, broken down by shop, with total costs. Runs automatically every Monday morning and can be triggered manually at any time.

### Running a Report

The page shows one card: **Fullbay WIP Report**. Click **Run Now** to trigger a new report immediately. The report pulls all service orders that were open during the previous full week (Monday through Sunday) and calculates the total cost per shop.

A status badge updates as the report runs: Pending → Running → Done.

### Reading the Results

When the report finishes, the results section shows:
- **Total SOs** — How many service orders were open during the week
- **Total Cost** — The aggregate cost across all SOs
- **Shop Breakdown Table** — Each shop in Fullbay with its total WIP cost for the week, sorted highest to lowest

Download the summary file (shop-level totals) or the detail file (individual service order line items) using the download buttons.

### Report History

The history table below the main card lists all past reports. Each row shows the week label, when the report was run, total SOs, total cost, status, and download buttons. Use this to compare week-over-week WIP trends or retrieve a report from a previous week.

---

## 11. Reports

**Who can use it:** Dispatcher, Admin (some reports Admin only)

**What it does:** A centralized reporting hub with nine report types covering safety, compliance, dispatch, maintenance, impounds, equipment, and scheduling analytics.

**Access:** Click the **Reports** tile in the portal. Reports open in the portal itself (not a separate app).

### Choosing a Report

The left sidebar lists all available report types. Click any report name to load it in the main content area. The active report is highlighted.

### Available Reports

**Driver Safety Report** — Safety scores and telematics event counts for every driver in the current (or selected) quarter. Filter by yard. Toggle "Eligible only" to show only drivers with enough mileage to be officially scored.

**DVIR Compliance** — Shows each driver's inspection completion rate by date. Toggle "Missed only" to surface only the days an inspection was skipped.

**Compliance Incidents** — DOT citations, accidents, and out-of-service orders. Filter by incident type and date range.

**Impound Inventory** — Active impounded vehicles with their status, location, days on lot, and estimated value. Filter by status (Owned / Police Hold / Current Impound) and location.

**Impound Disposition & Revenue** — Vehicles that have been sold, scrapped, or released. Filter by disposition type and location. Shows revenue totals at the bottom of the table.

**Dispatch History** — All TowBook jobs for a date range. Filter by job status (Scheduled / Active / Complete) and job type. Each row shows the call number, pickup and drop addresses, driver, truck, and account.

**Maintenance History** — Truck maintenance records including OOS periods, PM dates, and work notes. Filter by truck category and location.

**Equipment Requests** — All submitted equipment requests with their status (pending, approved, denied) and who submitted them.

**Scheduler Analytics** — A card-based analytics view of the driver schedule. Choose which analytics cards to display from the card selector. Available cards include coverage by hour, shift heatmap, top and bottom drivers by hours, hours by function, off-day breakdown, and week-over-week totals.

### Date Filters

Most reports have **From** and **To** date pickers at the top. Set the date range and the table updates automatically. Some reports also offer preset ranges (This Week, This Month, This Quarter).

### Sorting and Searching

Click any column header to sort the table by that column. Click again to reverse the sort order. Use the search box (where available) to filter rows by keyword.

### Choosing Columns

Click the **Columns** button to open the column visibility picker. Check or uncheck columns to show only the data you need.

### Exporting

Every report has a **Download CSV** button (and some have **Download Excel** which produces a multi-sheet workbook). The export respects your active filters — only the rows you can see are included in the file.

---

## 12. Role Reference

| Role | Portal Access | Apps Available |
|------|--------------|----------------|
| **Admin** | Full | All apps + Reports + external tools |
| **Shop Manager** | Yes | Fleet, Scheduler, Fullbay WIP |
| **Dispatcher** | Yes | Fleet, Transport, Inspections, Swaps, Impounds, Quote Calculator, Scheduler, Reports |
| **Mechanic** | Yes | Fleet, Inspections |
| **Driver** | Yes | Fleet (view only) |
| **Viewer** | Yes | Fleet, Transport, Inspections, Swaps, Reports (read-only) |
| **Impound Manager** | Yes | Impounds |
| **Accounts** | Yes | Statement Reconciler, Fullbay WIP |

If you try to access an app your role doesn't allow, you'll be redirected back to the portal automatically.

To request a role change, contact an Admin. Role changes take effect immediately on next login.
