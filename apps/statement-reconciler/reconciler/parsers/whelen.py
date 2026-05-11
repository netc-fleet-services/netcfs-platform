"""Whelen Engineering.
  INVOICE     DATE      AGE  YOUR P.O. NUMBER         PAYMENT TERMS  AMOUNT DUE
  C30315      04/20/26   14  MX/TSS0M-TL/871932       Net 0          -91.00
  879532      04/20/26   14  BOXTRUCK1/2              Net 30         1,382.40
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE = re.compile(
    r"^(\S+)\s+(\d{2}/\d{2}/\d{2})\s+\d+\s+(\S+)\s+Net\s+\d+\s+(-?[\d,]+\.\d{2})\s*$"
)
TOTAL_RE = re.compile(r"TOTAL AMOUNT\s*\n[^\n]*?([\d,]+\.\d{2})", re.IGNORECASE)
ACCT_RE = re.compile(r"ACCOUNT NUMBER\s*\n?\s*(\d+)", re.IGNORECASE)
DATE_RE = re.compile(r"STATEMENT DATE\s*\n?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})", re.IGNORECASE)

import datetime as _dt
def _parse_long(s):
    try: return _dt.datetime.strptime(s.strip(), "%B %d, %Y").date()
    except Exception: return None


@register("whelen")
class Whelen(StatementParser):
    vendor = "Whelen Engineering"

    def parse(self, pdf_path):
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line.lstrip())
            if not m:
                continue
            inv, dt, po, amt_s = m.groups()
            amt = parse_amount(amt_s) or 0.0
            records.append(StatementRecord(
                invoice_no=inv, txn_date=parse_date(dt),
                amount=amt, type="Credit" if amt < 0 else "Bill",
                po_ref=po, raw=line.strip(),
            ))
        total_m = TOTAL_RE.search(text)
        acct_m = ACCT_RE.search(text)
        date_m = DATE_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=_parse_long(date_m.group(1)) if date_m else None,
            account_no=acct_m.group(1) if acct_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            records=records, source_file=pdf_path,
        )
