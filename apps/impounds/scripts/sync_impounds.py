"""
TowBook → Supabase Impound Sync
Runs on a schedule via GitHub Actions (and can be triggered manually).

Strategy:
  Clicks the Export button on TowBook's impound page to download a CSV,
  then parses and upserts into Supabase.  This is more reliable than
  scraping the w2ui JavaScript grid that TowBook renders.

Upsert logic:
  - New impound (in TowBook, not in DB)  → INSERT
  - Existing impound (matched by call_number) → UPDATE scraped fields only;
    manual edits (sell, estimated_value, sales_description, notes, photos) are
    preserved by NOT overwriting them when the value is already set.

Required environment variables:
  TOWBOOK_USER         — TowBook login username
  TOWBOOK_PASS         — TowBook login password
  SUPABASE_URL         — Supabase project URL
  SUPABASE_SERVICE_KEY — Service role key (bypasses RLS)
"""

import os, re, csv, sys, tempfile
from pathlib import Path
from datetime import datetime
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
from supabase import create_client

# ── Config ─────────────────────────────────────────────────────────────────────

TOWBOOK_USER = os.environ["TOWBOOK_USER"]
TOWBOOK_PASS = os.environ["TOWBOOK_PASS"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

IMPOUND_URL  = "https://app.towbook.com/Impounds"

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

KNOWN_LOCATIONS = {"Pembroke", "Exeter", "Bow", "Lee", "Saco"}

# ── Helpers ────────────────────────────────────────────────────────────────────

def parse_date(raw: str) -> str | None:
    if not raw or not raw.strip():
        return None
    # Take only the date portion in case TowBook appends a time component
    date_part = raw.strip().split()[0]
    for fmt in ["%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%m-%d-%Y", "%m-%d-%y"]:
        try:
            return datetime.strptime(date_part, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    print(f"  WARNING: could not parse date '{raw}'")
    return None


def parse_money(raw: str) -> float | None:
    if not raw:
        return None
    cleaned = re.sub(r"[^\d.]", "", raw.strip())
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


def extract_city(storage_lot: str) -> str:
    if not isinstance(storage_lot, str) or not storage_lot.strip():
        return "Off-Site"
    parts = storage_lot.split(" - ")
    city_part = parts[-1].strip()
    city_part = re.sub(
        r"\s+(Impound|Lot|Storage|Yard|Center|Facility)\s*$",
        "", city_part, flags=re.IGNORECASE,
    ).strip()
    for loc in KNOWN_LOCATIONS:
        if loc.lower() in city_part.lower():
            return loc
    return "Off-Site"


def split_vehicle(vehicle_str: str) -> tuple[str, str]:
    """'2018 Ford F-150' → ('2018', 'Ford F-150')"""
    if not isinstance(vehicle_str, str) or not vehicle_str.strip():
        return "", ""
    m = re.match(r"^(\d{4})\s+(.+)$", vehicle_str.strip())
    if m:
        return m.group(1), m.group(2).strip()
    return "", vehicle_str.strip()

# ── Login ──────────────────────────────────────────────────────────────────────

def login(page):
    print("Logging in to TowBook…")
    page.goto("https://app.towbook.com/Security/Login.aspx")
    page.wait_for_selector("#Username", timeout=20_000)
    page.evaluate(f'document.getElementById("Username").value = "{TOWBOOK_USER}"')
    page.evaluate(f'document.getElementById("Password").value = "{TOWBOOK_PASS}"')
    page.locator('button[name="bSignIn"]').click()
    page.wait_for_url(lambda url: "Login" not in url, timeout=30_000)
    print(f"Logged in — current URL: {page.url}")

# ── Export & parse ─────────────────────────────────────────────────────────────

def download_export(page) -> Path:
    """Navigate to the impounds page and download the CSV export."""
    print("Navigating to impounds page…")
    page.goto(IMPOUND_URL, wait_until="networkidle", timeout=60_000)
    page.screenshot(path="impounds_view.png")
    print(f"Page title: {page.title()}  URL: {page.url}")

    # Wait for the Export button to be in the DOM.
    # w2ui toolbar items exist in the DOM but fail Playwright's visibility check
    # in headless mode, so use state="attached" rather than the default "visible".
    try:
        page.wait_for_selector(
            "td.w2ui-tb-caption a:has-text('Export')",
            state="attached",
            timeout=45_000,
        )
    except PlaywrightTimeout:
        print("Export button not found after 45s — saving screenshot")
        page.screenshot(path="no_export_btn.png")
        raise

    dest = Path(tempfile.mkdtemp()) / "impounds_export.csv"
    print("Clicking Export button…")
    with page.expect_download(timeout=30_000) as dl_info:
        page.locator("td.w2ui-tb-caption a:has-text('Export')").click(force=True)
    dl_info.value.save_as(str(dest))
    print(f"Downloaded export → {dest}")
    return dest


def parse_export(csv_path: Path) -> list[dict]:
    """
    Parse the TowBook CSV export.  TowBook prepends metadata rows before the
    actual column headers, so we scan for the first row that contains 'call'.
    """
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))

    if not rows:
        print("CSV export is empty.")
        return []

    # Find the header row
    header_idx = None
    for i, row in enumerate(rows):
        if any("call" in cell.lower() for cell in row):
            header_idx = i
            break

    if header_idx is None:
        print(f"Could not find header row. First 5 rows: {rows[:5]}")
        return []

    headers = [h.strip().lower() for h in rows[header_idx]]
    print(f"CSV headers (row {header_idx}): {headers}")
    # Print raw date sample so format issues are visible in logs
    if len(rows) > header_idx + 1:
        sample = rows[header_idx + 1]
        try:
            date_idx = headers.index("impound date")
            print(f"  Raw date sample: '{sample[date_idx] if date_idx < len(sample) else '(out of range)'}'")
        except ValueError:
            print("  WARNING: 'impound date' column not found in headers")

    def col(vals, *names) -> str:
        for name in names:
            try:
                idx = headers.index(name)
                if idx < len(vals):
                    return vals[idx].strip()
            except ValueError:
                continue
        return ""

    records: list[dict] = []
    for vals in rows[header_idx + 1:]:
        if not any(v.strip() for v in vals):
            continue  # blank row

        raw_call = col(vals, "call #", "call#", "call no.", "call no", "call")
        if not raw_call or not raw_call.isdigit():
            continue

        vehicle_raw = col(vals, "vehicle", "make/model", "make model")
        year, make_model = split_vehicle(vehicle_raw)

        internal_cost = parse_money(col(vals, "total", "internal cost", "cost"))
        balance_due   = parse_money(col(vals, "balance due", "balance_due", "balance"))
        if internal_cost is not None and balance_due is not None:
            amount_paid = round(internal_cost - balance_due, 2)
        else:
            amount_paid = None

        storage_lot = col(vals, "storage lot", "storage_lot", "lot", "location")

        records.append({
            "call_number":     raw_call,
            "date_of_impound": parse_date(col(vals, "impound date", "impound_date", "date of impound", "date")),
            "make_model":      make_model,
            "year":            year,
            "vin":             col(vals, "vin", "vin #", "vin#"),
            "location":        extract_city(storage_lot),
            "internal_cost":   internal_cost,
            "amount_paid":     amount_paid,
            "released":        False,
        })

    print(f"Parsed {len(records)} impound records from CSV")
    if records:
        print("First 5 records:")
        for r in records[:5]:
            print(f"  call={r['call_number']}  date={r['date_of_impound']}  vehicle={r['year']} {r['make_model']}")
    return records

# ── Upsert ─────────────────────────────────────────────────────────────────────

def upsert_impounds(impounds: list[dict]):
    if not impounds:
        print("Nothing to upsert.")
        return

    existing_resp = sb.table("impounds").select(
        "call_number, notes, sell, estimated_value, sales_description, released, scrapped, sold"
    ).execute()
    existing: dict[str, dict] = {r["call_number"]: r for r in (existing_resp.data or [])}

    new_count = 0
    to_upsert: list[dict] = []
    for rec in impounds:
        cn = rec["call_number"]
        if cn in existing:
            ex = existing[cn]
            if not rec.get("notes") and ex.get("notes"):
                rec["notes"] = ex["notes"]
            # Never overwrite disposition flags set by a manager
            if ex.get("released"): rec["released"] = True
            if ex.get("scrapped"): rec["scrapped"] = True
            if ex.get("sold"):     rec["sold"]     = True
        else:
            new_count += 1
        to_upsert.append(rec)

    print(f"  {new_count} new, {len(to_upsert) - new_count} existing records in this sync")

    result = sb.table("impounds").upsert(to_upsert, on_conflict="call_number").execute()
    print(f"Upserted {len(to_upsert)} records — API response count: {len(result.data or [])}")

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(accept_downloads=True)
        page    = context.new_page()

        try:
            login(page)
            csv_path = download_export(page)
            impounds = parse_export(csv_path)
            upsert_impounds(impounds)
        finally:
            page.screenshot(path="final_state.png")
            browser.close()

    print("Sync complete.")


if __name__ == "__main__":
    main()
