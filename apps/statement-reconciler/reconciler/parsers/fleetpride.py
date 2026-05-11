"""FleetPride statements."""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE = re.compile(
    r"^\s*(\d{2}/\d{2}/\d{2})\s+(\d{6,12})\s+(.*?)\s+(-?\(?[\d,]+\.\d{2}\)?)\s*$"
)
TOTAL_RE = re.compile(r"TOTAL OPEN ITEMS.*?\n\s*([\d,]+\.\d{2})", re.DOTALL)
CUST_RE = re.compile(r"CUSTOMER NO\.[^\n]*\n[^\n]*?(\S+)\s+\d{2}/\d{2}/\d{2}", re.IGNORECASE)
DATE_RE = re.compile(r"STATEMENT DATE[^\n]*\n[^\n]*?(\d{2}/\d{2}/\d{2})", re.IGNORECASE)


@register("fleetpride")
class FleetPride(StatementParser):
    vendor = "FleetPride"

    def parse(self, pdf_path: str) -> ParsedStatement:
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line)
            if not m:
                continue
            date_s, inv, desc, amt_s = m.groups()
            amt = parse_amount(amt_s) or 0.0
            po = None
            if "PO -" in desc:
                po = desc.split("PO -", 1)[1].strip()
            records.append(StatementRecord(
                invoice_no=inv,
                txn_date=parse_date(date_s),
                amount=amt,
                type="Credit" if amt < 0 else "Bill",
                po_ref=po,
                raw=line.strip(),
            ))
        total_m = TOTAL_RE.search(text)
        cust_m = CUST_RE.search(text)
        date_m = DATE_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=cust_m.group(1) if cust_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            records=records,
            source_file=pdf_path,
        )
