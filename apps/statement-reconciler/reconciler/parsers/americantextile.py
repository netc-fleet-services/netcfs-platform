"""American Textile Mills (Boston / WI Supply billing system).
   Identical column layout to WI Supply:
   Invoice  Reference  Date        Due date    Age  Amount   Balance
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE  = re.compile(
    r"^\s+(\d{4,})\s+(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+\d+\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})"
)
TOTAL_RE = re.compile(r"Total\s*:\s*([\d,]+\.\d{2})", re.IGNORECASE)
DATE_RE  = re.compile(r"As of\s+(\d{4}-\d{2}-\d{2})", re.IGNORECASE)
CUST_RE  = re.compile(r"Customer No\s+(\S+)", re.IGNORECASE)


@register("americantextile")
class AmericanTextile(StatementParser):
    vendor = "American Textile Mills"

    def parse(self, pdf_path: str) -> ParsedStatement:
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line)
            if not m:
                continue
            inv, ref, dt, _due, amt_s, _bal = m.groups()
            amt = parse_amount(amt_s) or 0.0
            records.append(StatementRecord(
                invoice_no=inv,
                txn_date=parse_date(dt),
                amount=amt,
                type="Credit" if amt < 0 else "Bill",
                po_ref=ref,
                raw=line.strip(),
            ))
        total_m = TOTAL_RE.search(text)
        date_m  = DATE_RE.search(text)
        cust_m  = CUST_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=cust_m.group(1) if cust_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            records=records,
            source_file=pdf_path,
        )
