"""
TowBook → Supabase Keys Sync
Fills in the `keys` column for impounds where it is currently NULL.

Runs as a separate GitHub Actions workflow (sync-keys.yml) on a daily schedule,
completely isolated from the primary impound sync.  If this script errors or
times out the main sync is completely unaffected.

Strategy:
  The TowBook detail page URL uses the impound's stock number as the `id`
  parameter (e.g. https://app.towbook.com/impounds/Impound?id=28130000).
  The stock number is stored in the `stock_number` column, which the main sync
  populates from the CSV export.  This script navigates directly to each detail
  page — no list-page iteration needed.

  For each page it tries two methods in order:
    1. Intercept the JSON response TowBook loads for the page.
    2. Regex search on the rendered HTML for "Have Keys … Yes/No".
  Any impound that errors or times out is skipped (keys stays NULL and will be
  retried on the next daily run).

  Impounds with no stock_number yet are reported but skipped — they will get
  their stock_number on the next main sync run and be processed the day after.

Required environment variables (no new secrets — same as the main sync):
  TOWBOOK_USER         — TowBook login username
  TOWBOOK_PASS         — TowBook login password
  SUPABASE_URL         — Supabase project URL
  SUPABASE_SERVICE_KEY — service role key (bypasses RLS)
"""

import os, re, time
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
from supabase import create_client

# ── Config ─────────────────────────────────────────────────────────────────────

TOWBOOK_USER = os.environ["TOWBOOK_USER"]
TOWBOOK_PASS = os.environ["TOWBOOK_PASS"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

DETAIL_URL  = "https://app.towbook.com/impounds/Impound?id={}"
MAX_PER_RUN = 75   # cap per run to stay within the 15-minute timeout

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

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

# ── Per-impound scrape ─────────────────────────────────────────────────────────

def scrape_keys(page, call_number: str, stock_number: str) -> bool | None:
    """
    Navigate directly to the TowBook impound detail page via stock number and return:
      True  — Have Keys: Yes
      False — Have Keys: No
      None  — could not determine; skip and leave keys as NULL
    """
    url      = DETAIL_URL.format(stock_number)
    captured = {}

    def on_response(response):
        try:
            if response.status != 200:
                return
            if "json" not in response.headers.get("content-type", ""):
                return
            body = response.json()
            if isinstance(body, dict):
                for wrapper in ("data", "result", "impound", "record"):
                    if wrapper in body and isinstance(body[wrapper], dict):
                        body = body[wrapper]
                        break
                captured.update(body)
        except Exception:
            pass

    page.on("response", on_response)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_timeout(3_000)
    except PlaywrightTimeout:
        print(f"  [{call_number}] Page load timeout — skipping")
        return None
    except Exception as e:
        print(f"  [{call_number}] Navigation error: {e} — skipping")
        return None
    finally:
        page.remove_listener("response", on_response)

    # ── Method 1: network response JSON ───────────────────────────────────────
    for field in ("haveKeys", "have_keys", "HaveKeys", "HasKeys", "keys"):
        val = captured.get(field)
        if val is not None:
            result = str(val).strip().lower() in ("yes", "true", "1", "y")
            print(f"  [{call_number}] keys={result}  (network JSON, field='{field}')")
            return result

    # ── Method 2: regex on rendered HTML ──────────────────────────────────────
    try:
        content = page.content()
        match = re.search(r"Have\s+Keys[^<]{0,120}?(Yes|No)", content, re.IGNORECASE)
        if match:
            result = match.group(1).lower() == "yes"
            print(f"  [{call_number}] keys={result}  (HTML regex)")
            return result
    except Exception as e:
        print(f"  [{call_number}] HTML parse error: {e}")

    print(f"  [{call_number}] Have Keys value not found — skipping")
    return None

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    resp = sb.table("impounds") \
             .select("call_number, stock_number") \
             .is_("keys", "null") \
             .execute()
    all_unknown = resp.data or []

    # Split into actionable (have stock_number) and waiting (don't yet)
    actionable = [r for r in all_unknown if r.get("stock_number")]
    waiting    = [r for r in all_unknown if not r.get("stock_number")]

    if waiting:
        print(f"{len(waiting)} impound(s) have no stock_number yet "
              f"— will be populated by the next main sync, then processed tomorrow.")

    if not actionable:
        print("No actionable impounds with unknown keys — nothing to do.")
        return

    to_process = actionable[:MAX_PER_RUN]
    print(f"Found {len(actionable)} impound(s) with unknown keys and a stock number, "
          f"processing {len(to_process)} this run")

    updates: list[dict] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context()
        page    = context.new_page()

        try:
            login(page)
            for i, record in enumerate(to_process):
                call_number  = record["call_number"]
                stock_number = record["stock_number"]
                print(f"[{i + 1}/{len(to_process)}] call #{call_number}  (stock #{stock_number})…")
                result = scrape_keys(page, call_number, stock_number)
                if result is not None:
                    updates.append({"call_number": call_number, "keys": result})
                time.sleep(1)
        finally:
            browser.close()

    print(f"\nUpdating {len(updates)} record(s) in Supabase…")
    for upd in updates:
        sb.table("impounds") \
          .update({"keys": upd["keys"]}) \
          .eq("call_number", upd["call_number"]) \
          .execute()
        print(f"  call #{upd['call_number']} → keys={upd['keys']}")

    remaining = len(actionable) - len(to_process)
    if remaining > 0:
        print(f"\n{remaining} actionable impound(s) still unknown — will be processed in future runs.")
    print(f"\nKeys sync complete. Updated {len(updates)}/{len(to_process)} processed.")


if __name__ == "__main__":
    main()
