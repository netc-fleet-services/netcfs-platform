"""Hews Company LLC.
   Format: Date | Invoice ID | Charges | Credits | Amount
   Invoice IDs like NH654279.
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE  = re.compile(r"^(\d{1,2}/\d{1,2}/\d{4})\s+(\S+)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})")
TOTAL_RE = re.compile(r"Customer Balance:\s+\$([\d,]+\.\d{2})", re.IGNORECASE)
DATE_RE  = re.compile(r"Date:\s+(\d{1,2}/\d{1,2}/\d{4})", re.IGNORECASE)
CUST_RE  = re.compile(r"Customer:\s+(\d+)", re.IGNORECASE)


@register("hewsco")
class HewsCo(StatementParser):
    vendor = "Hews Company LLC"

    def parse(self, pdf_path: str) -> ParsedStatement:
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line.strip())
            if not m:
                continue
            dt_s, inv, charge_s, credit_s = m.groups()
            charge = parse_amount(charge_s) or 0.0
            credit = parse_amount(credit_s) or 0.0
            if credit > 0:
                amt, txn_type = credit, "Credit"
            else:
                amt, txn_type = charge, "Bill"
            records.append(StatementRecord(
                invoice_no=inv,
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
