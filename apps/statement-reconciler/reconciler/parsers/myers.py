"""Myers Tire Supply.
  Invoice Number   Invoice Date    Remark      Open Amount   Payments  Adjustments  Invoice Number  Outstanding Due
  RI 62611505      04/14/26        62637546    214.64        0.00      0.00         RI 62611505    214.64
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE = re.compile(
    r"^\s*(?:RI|CR)?\s*(\d{6,})\s+(\d{2}/\d{2}/\d{2})\s+(\S+)\s+(-?[\d,]+\.\d{2})\s+([\d,.]+)\s+([\d,.]+)\s+(?:RI|CR)?\s*\1\s+(-?[\d,]+\.\d{2})"
)
TOTAL_RE = re.compile(r"Total Balance Due\s+([\d,]+\.\d{2})", re.IGNORECASE)
ACCT_RE = re.compile(r"Account Number\s*\n?\s*(\d+)", re.IGNORECASE)
DATE_RE = re.compile(r"Statement Date\s*\n?\s*(\d{2}/\d{2}/\d{2})", re.IGNORECASE)


@register("myers")
class Myers(StatementParser):
    vendor = "Myers Tire Supply"

    def parse(self, pdf_path):
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.search(line)
            if not m:
                continue
            inv, dt, remark, amt_s, pay, adj, out_s = m.groups()
            amt = parse_amount(amt_s) or 0.0
            records.append(StatementRecord(
                invoice_no=inv, txn_date=parse_date(dt),
                amount=amt, type="Credit" if amt < 0 else "Bill",
                po_ref=remark, raw=line.strip(),
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
