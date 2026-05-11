"""Sullivan Tire.
   DATE      CUSTOMER P.O.    WORK ORD   INVOICE NUMBER     COMMENT       AMOUNT
   04/02/26  TB115671                    0000-2973846       CURR INV      208.00
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE = re.compile(
    r"^\s*(\d{2}/\d{2}/\d{2})\s+(\S.*?)\s+(\d{4}-\d{7})\s+(CURR INV|CREDIT INV|PAYMENT[- ]?\S*)\s+(-?\(?[\d,]+\.\d{2}\)?)\s+\3\s+(-?\(?[\d,]+\.\d{2}\)?)\s*$"
)
TOTAL_RE = re.compile(r"AMOUNT DUE\s*\n[^\n]*?([\d,]+\.\d{2})", re.IGNORECASE | re.DOTALL)
ACCT_RE = re.compile(r"CUSTOMER NUMBER\s*\n?\s*(\d+)", re.IGNORECASE)
DATE_RE = re.compile(r"STATEMENT DATE\s*\n?\s*(\d{2}/\d{2}/\d{2})", re.IGNORECASE)


@register("sullivan")
class Sullivan(StatementParser):
    vendor = "Sullivan Tire"

    def parse(self, pdf_path):
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line)
            if not m:
                continue
            dt, po, inv, comment, amt_s, _stub_amt = m.groups()
            amt = parse_amount(amt_s) or 0.0
            t = "Credit" if "CREDIT" in comment else ("Payment" if "PAYMENT" in comment else "Bill")
            # Normalize "0000-2973846" → "2973846" to match QB format
            clean_inv = inv.replace("-", "").lstrip("0") or inv
            records.append(StatementRecord(
                invoice_no=clean_inv, txn_date=parse_date(dt),
                amount=amt, type=t, po_ref=po.strip(), raw=line.strip(),
            ))
        # Sullivan also has standalone payment/discount lines without invoice numbers — skip those for now
        # The aging row: PREV_BAL  PAYMENTS&ADJ  NEW_CHARGES  TOTAL_OWING  ...
        # We want TOTAL OWING (=net charges this period - payments)
        total_m = re.search(r"\(.*?\)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+[\d,]+\.\d{2}\s+([\d,]+\.\d{2})", text)
        # Or look for "ENCLOSED CHECK AMOUNT" preceded by the total
        if not total_m:
            total_m = re.search(r"ENCLOSED CHECK[\s\S]{0,80}?\n[\s\S]{0,200}?([\d,]+\.\d{2})", text)
        acct_m = ACCT_RE.search(text)
        date_m = DATE_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=acct_m.group(1) if acct_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            statement_mode="all_activity",
            records=records, source_file=pdf_path,
        )
