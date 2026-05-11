"""Dennison Lubricants.
   Date         Invoice    PO/Check       Due On       Paid On     Amount     Due
Invoice  04/01/2026  3926403   EMAIL          05/01/2026               711.00     711.00
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE = re.compile(
    r"^Invoice\s+(\d{2}/\d{2}/\d{4})\s+(\d{6,})\s+(.*?)\s+(\d{2}/\d{2}/\d{4})\s+(?:\d{2}/\d{2}/\d{4})?\s*(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s*$"
)
TOTAL_RE = re.compile(r"Balance Due\s+([\d,]+\.\d{2})", re.IGNORECASE)
ACCT_RE = re.compile(r"Account:\s*(\S+)", re.IGNORECASE)
DATE_RE = re.compile(r"Statement from \d{2}/\d{2}/\d{4} to (\d{2}/\d{2}/\d{4})", re.IGNORECASE)


@register("dennison")
class Dennison(StatementParser):
    vendor = "Dennison Lubricants"

    def parse(self, pdf_path):
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line.lstrip())
            if not m:
                continue
            dt, inv, po, due, amt_s, due_s = m.groups()
            amt = parse_amount(amt_s) or 0.0
            records.append(StatementRecord(
                invoice_no=inv, txn_date=parse_date(dt),
                amount=amt, type="Credit" if amt < 0 else "Bill",
                po_ref=po.strip() if po else None, raw=line.strip(),
            ))
        total_m = TOTAL_RE.search(text)
        acct_m = ACCT_RE.search(text)
        date_m = DATE_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=acct_m.group(1) if acct_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            records=records, source_file=pdf_path,
        )
