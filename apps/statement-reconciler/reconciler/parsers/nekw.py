"""New England Kenworth.

Each invoice appears as two paired rows:
   Date       Src       Invoice    Cus PO/Ref    Amount    Invoice  Balance Due
   03-02-26   PARTS     PP312143   RAY'S TRUCK#86  110.04   PP312143
   04-20-26   PAYMENT   PP312143   04202630A      -110.04   PP312143  0.00

Net activity for fully-paid invoices = 0 (PARTS + PAYMENT). Open invoices have
only a PARTS row with balance_due = amount.
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE = re.compile(
    r"^(\d{2}-\d{2}-\d{2})\s+(PARTS|PAYMENT|CREDIT|FIN\s*CHG)\s+(\S+)\s+(.*?)\s+(-?[\d,]+\.\d{2})\s+(\S+)?\s*(-?[\d,]+\.\d{2})?\s*$"
)
TOTAL_RE = re.compile(r"AGING SUMMARY[\s\S]{0,300}?\d{2}-\d{2}-\d{2}\s+([\d,]+\.\d{2})", re.IGNORECASE)
ACCT_RE = re.compile(r"Account:\s*(\d+)", re.IGNORECASE)
DATE_RE = re.compile(r"Date:\s*(\d{2}-\d{2}-\d{2})", re.IGNORECASE)


@register("nekw")
class NewEnglandKenworth(StatementParser):
    vendor = "New England Kenworth"

    def parse(self, pdf_path):
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line.lstrip())
            if not m:
                continue
            dt_s, src, inv, ref, amt_s, _stub, _bal = m.groups()
            amt = parse_amount(amt_s) or 0.0
            if src == "PARTS":
                rec_type = "Bill"
            elif src == "PAYMENT":
                rec_type = "Payment"
            elif src == "CREDIT":
                rec_type = "Credit"
            else:
                rec_type = "Other"
            records.append(StatementRecord(
                invoice_no=inv, txn_date=parse_date(dt_s),
                amount=amt, type=rec_type, po_ref=ref.strip() if ref else None,
                raw=line.strip(),
            ))
        # Total Due (final aging row)
        total_m = TOTAL_RE.search(text)
        acct_m = ACCT_RE.search(text)
        date_m = DATE_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=acct_m.group(1) if acct_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            statement_mode="all_activity",
            records=records, source_file=pdf_path,
        )
