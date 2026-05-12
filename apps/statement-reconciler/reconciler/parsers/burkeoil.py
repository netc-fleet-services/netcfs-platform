"""Dennis K Burke Inc.
   Format: Date | Reference(-IN/-CR) | BOL/Comment | PO Number | Charge | Credit | Balance
   Reference numbers end in -IN for invoices, -CR for credits.
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

# date, reference (NNNNNNN-IN or -CR), then grab first dollar amount (Charge or Credit column)
LINE_RE  = re.compile(r"^(\d{1,2}/\d{1,2}/\d{4})\s+(\d+-(IN|CR))\s+.+?([\d,]+\.\d{2})")
TOTAL_RE = re.compile(r"Total:\s+\$([\d,]+\.\d{2})", re.IGNORECASE)
DATE_RE  = re.compile(r"Statement\s+(\d{1,2}/\d{1,2}/\d{4})", re.IGNORECASE)
CUST_RE  = re.compile(r"Customer\s+No\.?\s*(\d{4,10})", re.IGNORECASE)


@register("burkeoil")
class BurkeOil(StatementParser):
    vendor = "Dennis K Burke Inc"

    def parse(self, pdf_path: str) -> ParsedStatement:
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line.strip())
            if not m:
                continue
            dt_s, ref, suffix, amt_s = m.groups()
            amt = parse_amount(amt_s) or 0.0
            txn_type = "Credit" if suffix == "CR" else "Bill"
            records.append(StatementRecord(
                invoice_no=ref,
                txn_date=parse_date(dt_s),
                amount=amt,
                type=txn_type,
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
