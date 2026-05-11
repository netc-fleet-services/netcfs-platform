"""National Tire Wholesale (TBC).
  Reference/PO   Invoice No    Doc.Desc  Doc Date    Aging   Due Date    Inv Balance
   01-43037      9405183881    INVOICE   04/03/2026  Current 05/10/2026  267.94
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE = re.compile(
    r"^\s+(\S+)\s+(\d{8,12})\s+(INVOICE|CREDIT)\s+(\d{2}/\d{2}/\d{4})\s+\S+\s+(\d{2}/\d{2}/\d{4})\s+(-?[\d,]+\.\d{2})\s*$"
)
TOTAL_RE = re.compile(r"TOTAL DUE NOW:.*?\$([\d,]+\.\d{2})", re.DOTALL | re.IGNORECASE)
ACCT_RE = re.compile(r"ACCOUNT NO\.\s*\n[^\n]*?(\d{6,})", re.IGNORECASE)
DATE_RE = re.compile(r"STATEMENT DATE\s*\n[^\n]*?(\d{2}/\d{2}/\d{4})", re.IGNORECASE)


@register("nationaltire")
class NationalTire(StatementParser):
    vendor = "National Tire Wholesale"

    def parse(self, pdf_path):
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line)
            if not m:
                continue
            po, inv, doc, dt, due, amt_s = m.groups()
            amt = parse_amount(amt_s) or 0.0
            t = "Credit" if doc == "CREDIT" or amt < 0 else "Bill"
            records.append(StatementRecord(
                invoice_no=inv, txn_date=parse_date(dt),
                amount=-abs(amt) if t == "Credit" else amt,
                type=t, po_ref=po, raw=line.strip(),
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
