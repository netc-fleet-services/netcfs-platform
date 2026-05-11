"""ArcSource Inc.
   INVOICE DATE  INVOICE NUMBER  DOC TYPE   ORDER NUMBER   CHARGES   PAYMENTS   ADJUSTMENTS   BALANCE DUE
   04/22/26      0001172074      INVOICE    180310         241.44    .00        .00           241.44
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE = re.compile(
    r"^\s+(\d{2}/\d{2}/\d{2})\s+(\d{8,12})\s+(INVOICE|CREDIT|PAYMENT)\s+(\S+)?\s+([\d,]+\.\d{2})\s+(\.?[\d,]*\.?\d{0,2})\s+(\.?[\d,]*\.?\d{0,2})\s+([\d,]+\.\d{2})\s*$"
)
TOTAL_RE = re.compile(r"TOTAL\s*\nBALANCE\s*\n?\s*([\d,]+\.\d{2})", re.IGNORECASE)
ACCT_RE = re.compile(r"CUSTOMER:\s*(\S+)", re.IGNORECASE)
DATE_RE = re.compile(r"DATE:\s*(\d{2}/\d{2}/\d{2})")


@register("arcsource")
class ArcSource(StatementParser):
    vendor = "ArcSource"

    def parse(self, pdf_path):
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line)
            if not m:
                continue
            dt, inv, doc, order, charges, pmt, adj, bal = m.groups()
            amt = parse_amount(charges) or 0.0
            t = "Credit" if doc == "CREDIT" else ("Payment" if doc == "PAYMENT" else "Bill")
            records.append(StatementRecord(
                invoice_no=inv, txn_date=parse_date(dt),
                amount=-abs(amt) if t != "Bill" else amt,
                type=t, po_ref=order, raw=line.strip(),
            ))
        # ArcSource layout is broken — value drifts away from label. Use aging totals row instead.
        total_m = re.search(r"OVER 90 DAYS\s*\n?\s*([\d,.]+)\s+(\.\d{2}|[\d,]+\.\d{2})", text, re.IGNORECASE)
        if not total_m:
            total_m = re.search(r"TOTAL BALANCE:?\s*\n?[\s\S]{0,200}?([\d,]+\.\d{2})", text, re.IGNORECASE)
        acct_m = ACCT_RE.search(text)
        date_m = DATE_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=acct_m.group(1) if acct_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            records=records, source_file=pdf_path,
        )
