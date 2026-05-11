"""Castle Packs / Finger Lakes.
 Document  BP Ref. No.  Post. Date  Due Date    Details                   Amount   Balance
 IN 203654 PEMBROKE     04/10/26    05/10/26    A/R Invoices - F301139    414.60   414.60
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE = re.compile(
    r"^\s*(IN|CN|RC)\s+(\S+)\s+(\S+)?\s+(\d{2}/\d{2}/\d{2})\s+(\d{2}/\d{2}/\d{2})\s+.*?\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s*$"
)
TOTAL_RE = re.compile(r"Total\s+\$\s*([\d,]+\.\d{2})")
ACCT_RE = re.compile(r"Account:\s*(\S+)", re.IGNORECASE)
DATE_RE = re.compile(r"Date:\s*(\d{2}/\d{2}/\d{2})")


@register("castle")
class CastlePacks(StatementParser):
    vendor = "Castle Packs / Finger Lakes"

    def parse(self, pdf_path):
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line)
            if not m:
                continue
            doc_type, doc_no, bp_ref, post_dt, due_dt, amt_s, bal_s = m.groups()
            amt = parse_amount(amt_s) or 0.0
            t = "Credit" if doc_type == "CN" else ("Payment" if doc_type == "RC" else "Bill")
            records.append(StatementRecord(
                invoice_no=doc_no,
                txn_date=parse_date(post_dt),
                amount=-abs(amt) if t == "Credit" else amt,
                type=t,
                po_ref=bp_ref.strip() if bp_ref else None,
                raw=line.strip(),
            ))
        total_m = TOTAL_RE.search(text)
        acct_m = ACCT_RE.search(text)
        date_m = DATE_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=acct_m.group(1) if acct_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            records=records,
            source_file=pdf_path,
        )
