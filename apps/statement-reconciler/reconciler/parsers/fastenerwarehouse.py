"""Fastener Warehouse.
   Format: Date | "INV #XXXXXX. Orig. Amount $XX.XX." | Amount | Balance
   Invoice numbers are 6-digit integers.
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

# Date + "INV #123456. Orig. Amount $XX.XX." + amount + balance
LINE_RE = re.compile(
    r"^(\d{2}/\d{2}/\d{4})\s+INV #(\d+)\.\s+Orig\. Amount \$[\d,]+\.\d{2}\.\s+([\d,]+\.\d{2})"
)
TOTAL_RE = re.compile(r"Amount Due\s+\$([\d,]+\.\d{2})", re.IGNORECASE)
DATE_RE  = re.compile(r"Date\s+(\d{1,2}/\d{1,2}/\d{4})", re.IGNORECASE)


@register("fastenerwarehouse")
class FastenerWarehouse(StatementParser):
    vendor = "Fastener Warehouse"

    def parse(self, pdf_path: str) -> ParsedStatement:
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line.strip())
            if not m:
                continue
            dt_s, inv, amt_s = m.groups()
            amt = parse_amount(amt_s) or 0.0
            records.append(StatementRecord(
                invoice_no=inv,
                txn_date=parse_date(dt_s),
                amount=amt,
                type="Credit" if amt < 0 else "Bill",
                raw=line.strip(),
            ))
        total_m = TOTAL_RE.search(text)
        date_m  = DATE_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            records=records,
            source_file=pdf_path,
        )
