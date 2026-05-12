"""
Fullbay WIP Report — Download, Analyze & Upload
Triggered by GitHub Actions (cron Monday 12:00 UTC or repository_dispatch).

Required env vars:
  RUN_ID                      - UUID of the wip_runs row
  FULLBAY_EMAIL               - Fullbay login email
  FULLBAY_PASSWORD            - Fullbay login password
  SUPABASE_URL                - Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY   - Service role key for storage + DB

Optional env vars:
  FULLBAY_LOCATION_IDS        - Comma-separated shop location IDs
                                (defaults to all current NETC shops)
"""

import os, sys, json, re, tempfile
from datetime import datetime, timedelta
import pandas as pd
import requests
from playwright.sync_api import sync_playwright

RUN_ID   = os.environ['RUN_ID']
EMAIL    = os.environ['FULLBAY_EMAIL']
PASSWORD = os.environ['FULLBAY_PASSWORD']
SUPA_URL = os.environ['SUPABASE_URL'].rstrip('/')
SUPA_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
BUCKET   = 'wip-reports'

# Default NETC shop location IDs (Fullbay internal IDs)
DEFAULT_LOCATION_IDS = ['339', '8827', '9089', '2484', '9289', '10131', '10132']
raw_ids = os.environ.get('FULLBAY_LOCATION_IDS', '')
LOCATION_IDS = [x.strip() for x in raw_ids.split(',') if x.strip()] or DEFAULT_LOCATION_IDS

HEADERS = {
    'apikey': SUPA_KEY,
    'Authorization': f'Bearer {SUPA_KEY}',
}


def update_run(patch: dict):
    r = requests.patch(
        f"{SUPA_URL}/rest/v1/wip_runs?id=eq.{RUN_ID}",
        json=patch,
        headers={**HEADERS, 'Content-Type': 'application/json', 'Prefer': 'return=minimal'},
    )
    r.raise_for_status()


def upload_file(local_path: str, storage_path: str):
    with open(local_path, 'rb') as f:
        data = f.read()
    r = requests.post(
        f"{SUPA_URL}/storage/v1/object/{BUCKET}/{storage_path}",
        data=data,
        headers={**HEADERS, 'Content-Type': 'text/csv'},
    )
    r.raise_for_status()
    return storage_path


def get_previous_week_range():
    today = datetime.today().date()
    this_monday = today - timedelta(days=today.weekday())
    prev_monday = this_monday - timedelta(weeks=1)
    prev_sunday = this_monday - timedelta(days=1)
    return prev_monday, prev_sunday


def clean_currency(series):
    return (
        series.astype(str)
        .str.replace(r'[\$,]', '', regex=True)
        .str.replace(r'\((.+)\)', r'-\1', regex=True)
        .str.strip()
        .replace('', '0')
        .astype(float)
    )


# ── main ───────────────────────────────────────────────────────────────────────

try:
    update_run({'status': 'running'})

    today    = datetime.today()
    date_str = today.strftime('%-m/%-d/%Y')  # Linux: %-m strips leading zero

    # ── Step 1: Download WIP CSV from Fullbay via Playwright ─────────────────
    print("Launching headless browser…")
    with tempfile.NamedTemporaryFile(suffix='.csv', delete=False) as tmp:
        csv_path = tmp.name

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page    = browser.new_page()

        print("Logging in to Fullbay…")
        page.goto('https://app.fullbay.com', wait_until='domcontentloaded')
        page.wait_for_timeout(2000)
        page.fill('input[type="email"]',    EMAIL)
        page.fill('input[type="password"]', PASSWORD)
        page.click('button[type="submit"]')
        page.wait_for_url('**/office**', timeout=60000)
        page.wait_for_timeout(3000)
        print("Logged in.")

        print("Navigating to Reports…")
        page.goto(
            'https://app.fullbay.com/office/configuration/indexReports.html',
            wait_until='domcontentloaded', timeout=60000,
        )
        page.wait_for_timeout(4000)

        print("Opening Work In Progress section…")
        page.wait_for_selector(
            "span[onclick=\"reportSectionsTogglePanel('workInProgress');\"]",
            state='visible', timeout=30000,
        )
        page.click("span[onclick=\"reportSectionsTogglePanel('workInProgress');\"]")
        page.wait_for_selector('#workInProgressPanelBody', state='visible', timeout=15000)
        page.wait_for_timeout(1000)

        print("Opening WIP Details report form…")
        page.wait_for_selector('#workInProgressDetailsReportId .linkNoUnderline', state='visible', timeout=15000)
        page.click('#workInProgressDetailsReportId .linkNoUnderline')
        page.wait_for_selector('#reportWorkInProgressForm', timeout=30000)
        page.wait_for_timeout(2000)

        print(f"Setting date to {date_str}…")
        page.evaluate(f"""
            () => {{
                document.getElementById('workInProgressDate').value = '{date_str}';
                $('.xdsoft_datetimepicker').hide();
                $('.xdsoft_datetimepicker').remove();
            }}
        """)

        print("Selecting all shop locations…")
        page.evaluate("""
            () => {
                const select = document.getElementById('wipEntityLocationIds');
                for (let option of select.options) { option.selected = true; }
                $('#wipEntityLocationIds').multiselect('refresh');
                filterFormValidator();
            }
        """)
        page.wait_for_timeout(2000)

        print("Grabbing session cookies…")
        cookies     = page.context.cookies()
        cookie_dict = {c['name']: c['value'] for c in cookies}
        browser.close()

    print("Downloading report CSV…")
    params = [('cmd', 'downloadDetails'), ('date', date_str)]
    for loc_id in LOCATION_IDS:
        params.append(('entityLocationIds[]', loc_id))

    resp = requests.get(
        'https://app.fullbay.com/office/configuration/viewReportWorkInProgressDetails.html',
        params=params,
        cookies=cookie_dict,
        headers={
            'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'referer':    'https://app.fullbay.com/office/configuration/viewReportWorkInProgressDetails.html',
        },
    )
    resp.raise_for_status()
    with open(csv_path, 'wb') as f:
        f.write(resp.content)
    print(f"CSV saved to {csv_path} ({len(resp.content)} bytes).")

    # ── Step 2: Analyze ───────────────────────────────────────────────────────
    prev_monday, prev_sunday = get_previous_week_range()
    week_label = f"{prev_monday} to {prev_sunday}"
    print(f"Analyzing WIP open during: {week_label}")

    df = pd.read_csv(csv_path)
    df.columns = df.columns.str.strip()
    df = df[df['SO'].notna() & df['SO'].astype(str).str.startswith('SO')]
    df['Created']   = pd.to_datetime(df['Created'],   errors='coerce')
    df['Completed'] = pd.to_datetime(df['Completed'], errors='coerce')
    df = df[df['Created'].notna()]
    df['Total cost of parts'] = clean_currency(df['Total cost of parts'])
    df['Shop'] = df['Shop'].astype(str).str.strip()

    created_by_week_end       = df['Created'].dt.date <= prev_sunday
    not_completed             = df['Completed'].isna()
    completed_during_or_after = df['Completed'].dt.date >= prev_monday
    mask = created_by_week_end & (not_completed | completed_during_or_after)
    filtered = df[mask].copy()
    print(f"Found {len(filtered)} SOs open during the previous week.")

    # Summary by shop
    summary = (
        filtered.groupby('Shop')['Total cost of parts']
        .sum().reset_index()
        .rename(columns={'Total cost of parts': 'Total Cost of Parts'})
        .sort_values('Shop')
    )
    grand_total = filtered['Total cost of parts'].sum()
    summary_with_total = pd.concat([
        summary,
        pd.DataFrame([{'Shop': 'GRAND TOTAL', 'Total Cost of Parts': grand_total}]),
    ], ignore_index=True)
    summary_with_total.insert(0, 'Week', week_label)
    summary_with_total['Total Cost of Parts'] = summary_with_total['Total Cost of Parts'].map('${:,.2f}'.format)

    # ── Step 3: Save CSVs to temp files and upload ────────────────────────────
    date_tag = today.strftime('%Y-%m-%d')

    with tempfile.NamedTemporaryFile(suffix='.csv', delete=False, mode='w', newline='') as f:
        summary_path = f.name
        summary_with_total.to_csv(f, index=False)

    with tempfile.NamedTemporaryFile(suffix='.csv', delete=False, mode='w', newline='') as f:
        detail_path = f.name
        filtered.to_csv(f, index=False)

    summary_storage = f"{RUN_ID}/WIP_Summary_{date_tag}.csv"
    detail_storage  = f"{RUN_ID}/WIP_Detail_{date_tag}.csv"

    upload_file(summary_path, summary_storage)
    upload_file(detail_path,  detail_storage)

    os.unlink(csv_path)
    os.unlink(summary_path)
    os.unlink(detail_path)
    print("Files uploaded to Supabase storage.")

    # ── Step 4: Build result_json and update run ──────────────────────────────
    shops_list = [
        {'shop': row['Shop'], 'total_cost': round(float(row['Total Cost of Parts'].replace('$', '').replace(',', '')), 2)}
        for _, row in summary.iterrows()
    ]

    result_json = {
        'week_label':    week_label,
        'total_so_count': int(len(filtered)),
        'grand_total':   round(float(grand_total), 2),
        'shops':         shops_list,
    }

    update_run({
        'status':            'done',
        'week_label':        week_label,
        'summary_file_path': summary_storage,
        'detail_file_path':  detail_storage,
        'result_json':       result_json,
    })

    print(f"Done. Week: {week_label}, SOs: {len(filtered)}, Grand total: ${grand_total:,.2f}")

except Exception as e:
    update_run({'status': 'error', 'error_message': str(e)})
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
