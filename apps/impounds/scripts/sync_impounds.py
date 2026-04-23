"""
TowBook → Supabase Impound Sync
Runs on a schedule via GitHub Actions (and can be triggered manually).

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

import os, re, json, sys
from datetime import date, datetime
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
from supabase import create_client

# ── Config ─────────────────────────────────────────────────────────────────────

TOWBOOK_USER = os.environ["TOWBOOK_USER"]
TOWBOOK_PASS = os.environ["TOWBOOK_PASS"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

IMPOUND_URL  = "https://app.towbook.com/Impounds"

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Helpers ────────────────────────────────────────────────────────────────────

def parse_date(raw: str) -> str | None:
    """Parse various TowBook date formats → ISO date string."""
    if not raw or not raw.strip():
        return None
    raw = raw.strip()
    for fmt in ["%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d"]:
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_bool(raw: str) -> bool | None:
    """'Yes'/'No' → True/False; empty/unknown → None."""
    if not raw:
        return None
    s = raw.strip().lower()
    if s in ("yes", "y", "true", "1"):
        return True
    if s in ("no", "n", "false", "0"):
        return False
    return None


def parse_money(raw: str) -> float | None:
    """'$1,234.56' or '1234.56' → float."""
    if not raw:
        return None
    cleaned = re.sub(r"[^\d.]", "", raw.strip())
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None

# ── Scraper ────────────────────────────────────────────────────────────────────

def scrape_page(page, col_index: dict) -> list[dict]:
    """Scrape all data rows visible on the current page."""
    def cell(cells, *names: str) -> str:
        for name in names:
            idx = col_index.get(name)
            if idx is not None and idx < len(cells):
                return (cells[idx].inner_text() or "").strip()
        return ""

    rows = page.query_selector_all("table tbody tr")
    impounds: list[dict] = []

    for row in rows:
        cells = row.query_selector_all("td")
        if not cells:
            continue

        call_number = cell(cells, "call #", "call number", "call#", "call no", "callnumber")
        if not call_number:
            continue

        record: dict = {
            "call_number":        call_number,
            "date_of_impound":    parse_date(cell(cells, "date", "impound date", "date of impound")),
            "make_model":         cell(cells, "make/model", "make model", "vehicle", "make", "model"),
            "year":               cell(cells, "year", "yr"),
            "vin":                cell(cells, "vin", "vin #"),
            "reason_for_impound": cell(cells, "reason", "reason for impound", "impound reason"),
            "location":           cell(cells, "location", "lot", "yard"),
            "status":             cell(cells, "status"),
            "released":           parse_bool(cell(cells, "released")) or False,
            "amount_paid":        parse_money(cell(cells, "amount paid", "paid", "amount")),
            "internal_cost":      parse_money(cell(cells, "internal cost", "cost")),
            "keys":               parse_bool(cell(cells, "keys", "has keys")),
            "drives":             parse_bool(cell(cells, "drives", "drivable")),
            "notes":              cell(cells, "notes", "comments") or None,
        }

        impounds.append(record)

    return impounds


def scrape_impounds(page) -> list[dict]:
    """
    Navigate to the TowBook impound management page and extract all rows,
    handling pagination automatically.
    """
    print("Navigating to impound page…")
    page.goto(IMPOUND_URL, wait_until="networkidle", timeout=60_000)
    print(f"Page URL: {page.url}")
    print(f"Page title: {page.title()}")

    # Try to maximize rows per page before scraping
    try:
        # Look for a page-size selector (e.g. "Show 25 entries")
        size_select = page.query_selector("select[name*='length'], select[name*='pageSize'], select[name*='perPage']")
        if size_select:
            # Pick the largest option
            options = size_select.query_selector_all("option")
            values = [o.get_attribute("value") for o in options]
            numeric = [v for v in values if v and v.isdigit()]
            if numeric:
                largest = max(numeric, key=int)
                size_select.select_option(largest)
                print(f"Set page size to {largest}")
                page.wait_for_load_state("networkidle", timeout=15_000)
    except Exception as e:
        print(f"Could not set page size: {e}")

    # Wait for the data table to appear
    try:
        page.wait_for_selector("table tbody tr", timeout=30_000)
    except PlaywrightTimeout:
        page.screenshot(path="no_table.png")
        print("Timed out waiting for impound table — screenshot saved as no_table.png")
        return []

    # Extra settle time: TowBook sometimes renders placeholder rows first,
    # then replaces them with real data via a second XHR.
    page.wait_for_timeout(3_000)

    # Capture screenshot so we can verify what the scraper actually sees
    page.screenshot(path="impounds_view.png")
    print("Screenshot saved as impounds_view.png")

    # Build column index from header row (only needs to be done once)
    headers = page.query_selector_all("table thead th")
    col_index: dict[str, int] = {}
    for i, th in enumerate(headers):
        text = (th.inner_text() or "").strip().lower()
        col_index[text] = i

    print(f"Detected columns: {list(col_index.keys())}")

    all_impounds: list[dict] = []
    page_num = 1

    while True:
        page_records = scrape_page(page, col_index)
        print(f"Page {page_num}: scraped {len(page_records)} rows")
        all_impounds.extend(page_records)

        # Look for a "Next" pagination button that is enabled
        next_btn = None
        for selector in [
            "a[title='Next']",
            "a[aria-label='Next']",
            "button[title='Next']",
            "li.next:not(.disabled) a",
            "li.page-item.next:not(.disabled) a",
            ".pagination .next:not(.disabled) a",
            "a:has-text('Next')",
            "button:has-text('Next')",
        ]:
            try:
                candidate = page.query_selector(selector)
                if candidate and candidate.is_visible() and candidate.is_enabled():
                    # Make sure it's not in a disabled wrapper
                    parent_classes = page.evaluate(
                        "(el) => el.parentElement ? el.parentElement.className : ''",
                        candidate
                    )
                    if "disabled" not in str(parent_classes).lower():
                        next_btn = candidate
                        break
            except Exception:
                continue

        if not next_btn:
            print("No more pages (no enabled Next button found)")
            break

        print(f"Navigating to page {page_num + 1}…")
        next_btn.click()
        try:
            page.wait_for_load_state("networkidle", timeout=15_000)
            page.wait_for_selector("table tbody tr", timeout=15_000)
        except PlaywrightTimeout:
            print("Timed out waiting for next page — stopping pagination")
            break

        page_num += 1
        if page_num > 50:  # safety cap
            print("Reached 50-page safety limit — stopping")
            break

    print(f"Scraped {len(all_impounds)} total impound records across {page_num} page(s)")
    if all_impounds:
        print("First 5 records scraped:")
        for r in all_impounds[:5]:
            print(f"  call={r['call_number']}  date={r['date_of_impound']}  vehicle={r['make_model']}")
    return all_impounds

# ── Login ──────────────────────────────────────────────────────────────────────

def login(page):
    print("Logging in to TowBook…")
    page.goto("https://app.towbook.com/Security/Login.aspx")
    # TowBook keeps persistent connections open so networkidle never fires —
    # wait for the specific field instead.
    page.wait_for_selector("#Username", timeout=20_000)
    page.evaluate(f'document.getElementById("Username").value = "{TOWBOOK_USER}"')
    page.evaluate(f'document.getElementById("Password").value = "{TOWBOOK_PASS}"')
    page.locator('button[name="bSignIn"]').click()
    # Wait for redirect away from the login page
    page.wait_for_url(lambda url: "Login" not in url, timeout=30_000)
    print(f"Logged in — current URL: {page.url}")

# ── Upsert ─────────────────────────────────────────────────────────────────────

def upsert_impounds(impounds: list[dict]):
    if not impounds:
        print("Nothing to upsert.")
        return

    # Load existing call numbers so we know which are new vs updates
    existing_resp = sb.table("impounds").select("call_number, notes, sell, estimated_value, sales_description").execute()
    existing: dict[str, dict] = {r["call_number"]: r for r in (existing_resp.data or [])}

    to_upsert: list[dict] = []
    for rec in impounds:
        cn = rec["call_number"]
        if cn in existing:
            ex = existing[cn]
            # Preserve manual edits — only overwrite notes if we have new content and DB is empty
            if not rec.get("notes") and ex.get("notes"):
                rec["notes"] = ex["notes"]
        to_upsert.append(rec)

    # Supabase upsert on call_number (unique constraint)
    result = sb.table("impounds").upsert(to_upsert, on_conflict="call_number").execute()
    print(f"Upserted {len(to_upsert)} records — API response count: {len(result.data or [])}")

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page    = browser.new_context().new_page()

        try:
            login(page)
            impounds = scrape_impounds(page)
            upsert_impounds(impounds)
        finally:
            browser.close()

    print("Sync complete.")


if __name__ == "__main__":
    main()
