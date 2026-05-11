"""Keystone Automotive (LKQ).
   Past-month rows: dt ref po balance_fwd 0.00 payment_applied balance_due
   Current-month rows: dt ref po period_activity balance_due
   We only want current month bills (period_activity column).
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

# Match dt + ref + po + 1..5 numeric columns
HEAD_RE = re.compile(r"^(\d{2}/\d{2}/\d{2})\s+(\d{6,12})\s+(\S+)\s+(.+)$")
NUM_RE = re.compile(r"-?[\d,]+\.\d{2}")
TOTAL_RE = re.compile(r"PAY THIS AMOUNT\s*\n?\s*([\d,]+\.\d{2})", re.IGNORECASE)
DATE_RE = re.compile(r"Statement Date:\s*(\d{2}/\d{2}/\d{2})", re.IGNORECASE)


@register("keystone")
class Keystone(StatementParser):
    vendor = "Keystone Automotive (LKQ)"

    def parse(self, pdf_path):
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = HEAD_RE.match(line.strip())
            if not m:
                continue
            dt, ref, po, rest = m.groups()
            nums = NUM_RE.findall(rest)
            if not nums:
                continue
            # Heuristic: if 5 numbers => past-month row (bf, _, ca, pay, bal_due)
            #            if 2 numbers => current-month row (period_activity, bal_due)
            #            we keep only current month; period_activity = bills this period
            if len(nums) == 2:
                amt = parse_amount(nums[0]) or 0.0
                rec_type = "Credit" if amt < 0 else "Bill"
            elif len(nums) >= 4:
                # Past month, fully paid — skip
                continue
            else:
                continue
            if amt == 0:
                continue
            records.append(StatementRecord(
                invoice_no=ref, txn_date=parse_date(dt),
                amount=amt, type=rec_type, po_ref=po, raw=line.strip(),
            ))
        total_m = TOTAL_RE.search(text)
        date_m = DATE_RE.search(text)
        acct_m = re.search(r"\n\s*(\d{7})\s*\n\s*NEW ENGLAND", text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=acct_m.group(1) if acct_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            records=records, source_file=pdf_path,
        )
