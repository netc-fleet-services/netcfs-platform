"""Kimball Midwest.
   Date         Invoice    PO       Due date     Invoice Total   Balance
   04/16/2026   104376330  b5530    05/16/2026   176.19          176.19
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE = re.compile(
    r"^(\d{2}/\d{2}/\d{4})\s+(\d{6,12})\s+(.+?)\s+(\d{2}/\d{2}/\d{4})\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s*$"
)
TOTAL_RE = re.compile(r"Current\s+31-60\s+61-90\s+91-120\s+121\+\s+Total\s*\n[^\n]*?([\d,]+\.\d{2})\s*$", re.MULTILINE | re.IGNORECASE)
ACCT_RE = re.compile(r"Account Number\s*\n\s*(\d+)", re.IGNORECASE)
DATE_RE = re.compile(r"Statement as of Date\s*\n?\s*(\d{2}/\d{2}/\d{4})", re.IGNORECASE)


@register("kimball")
class Kimball(StatementParser):
    vendor = "Kimball Midwest"

    def parse(self, pdf_path):
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line.lstrip())
            if not m:
                continue
            dt, inv, po, due, amt_s, bal_s = m.groups()
            amt = parse_amount(amt_s) or 0.0
            records.append(StatementRecord(
                invoice_no=inv,
                txn_date=parse_date(dt),
                amount=amt,
                type="Credit" if amt < 0 else "Bill",
                po_ref=po,
                raw=line.strip(),
            ))
        total_m = TOTAL_RE.search(text)
        acct_m = ACCT_RE.search(text)
        date_m = DATE_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=acct_m.group(1) if acct_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            records=records,
            source_file=pdf_path,
        )
