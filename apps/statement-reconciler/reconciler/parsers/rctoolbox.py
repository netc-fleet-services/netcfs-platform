"""RC Toolbox.
   Past Due  INV. DATE     INV. DUE DATE   INVOICE NO.    PURCHASE ORDER NO.   INVOICE AMT
   NO        04\\21\\2026   05\\21\\2026     26C02649       TRAVIS               $12,677.57
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE = re.compile(
    r"^\s+(NO|YES)\s+(\d{2}\\\d{2}\\\d{4})\s+(\d{2}\\\d{2}\\\d{4})\s+(\S+)\s+(\S+)\s+\$?(-?[\d,]+\.\d{2})\s*$"
)
TOTAL_RE = re.compile(r"TOTAL BALANCE DUE\s*\n[^\n]*?\$?([\d,]+\.\d{2})\s*$", re.IGNORECASE | re.MULTILINE)
ACCT_RE = re.compile(r"Customer\s+(\S+),\s*As of", re.IGNORECASE)
DATE_RE = re.compile(r"DATE TODAY:\s*(\d{1,2}/\d{1,2}/\d{4})", re.IGNORECASE)


@register("rctoolbox")
class RCToolbox(StatementParser):
    vendor = "RC Toolbox"

    def parse(self, pdf_path):
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line)
            if not m:
                continue
            past, dt, due, inv, po, amt_s = m.groups()
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
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=acct_m.group(1) if acct_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            records=records, source_file=pdf_path,
        )
