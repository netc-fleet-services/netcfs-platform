"""Terminal Supply Co.
   Format: NUMBER | DATE (YY) | type-flag | 1-30 DAYS amount
   Types: I=Invoice, C=Credit Memo, P=Payment, A=Adjustment, S=Service Charge
   Invoice numbers: NNNNN-00 (e.g. 11290-00)
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE       = re.compile(r"^\s+(\d{4,5}-\d{2})\s+(\d{1,2}/\d{2}/\d{2})\s+([ICPAS])\s+([\d,]+\.\d{2})")
TOTAL_RE      = re.compile(r"TOTAL\s+DUE[^\d]*([\d,]+\.\d{2})", re.IGNORECASE)
TOTAL_LINE_RE = re.compile(r"^\s+([\d,]+\.\d{2})\s+[\d,]+\.\d{2}\s+\.", re.MULTILINE)
DATE_RE       = re.compile(r"PAYMENTS\s+POSTED\s+THRU\s+(\d{1,2}/\d{1,2}/\d{4})", re.IGNORECASE)
CUST_RE       = re.compile(r"^\s+\d{1,2}/\d{2}/\d{2}\s+(\d{5})\s*$", re.MULTILINE)


@register("terminalsupply")
class TerminalSupply(StatementParser):
    vendor = "Terminal Supply Co."

    def parse(self, pdf_path: str) -> ParsedStatement:
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line)
            if not m:
                continue
            inv, dt_s, flag, amt_s = m.groups()
            if flag == 'P':
                continue  # skip payments
            parts = dt_s.split('/')
            dt_4 = f"{parts[0]}/{parts[1]}/20{parts[2]}"
            amt = parse_amount(amt_s) or 0.0
            txn_type = "Credit" if flag == 'C' else "Bill"
            records.append(StatementRecord(
                invoice_no=inv,
                txn_date=parse_date(dt_4),
                amount=amt,
                type=txn_type,
                raw=line.strip(),
            ))
        total_m = TOTAL_RE.search(text) or TOTAL_LINE_RE.search(text)
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
