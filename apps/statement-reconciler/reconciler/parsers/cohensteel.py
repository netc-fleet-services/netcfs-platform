"""Cohen Steel Supply Inc.
   Format: Seq  TOE  DocumentNumber  CustomerPO  DocDate  DueDate  Amount  Applied  Due
   TOE codes: IV = Invoice (Bill), CM = Credit Memo
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

# Seq + type + doc_num + cust_po + doc_date + due_date + amount
LINE_RE = re.compile(
    r"^\s*\d+\s+(IV|CM)\s+(\S+)\s+(\S+)\s+(\d{2}/\d{2}/\d{2})\s+\d{2}/\d{2}/\d{2}\s+([\d,]+\.\d{2})"
)
TOTAL_RE = re.compile(r"Grand Total\s+([\d,]+\.\d{2})", re.IGNORECASE)
ACCT_RE  = re.compile(r"^(\d{6,})\s+Page:", re.MULTILINE)
DATE_RE  = re.compile(r"CUSTOMER STATEMENT AS AT\s+(\d{2}/\d{2}/\d{2})", re.IGNORECASE)


@register("cohensteel")
class CohenSteel(StatementParser):
    vendor = "Cohen Steel Supply Inc."

    def parse(self, pdf_path: str) -> ParsedStatement:
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line)
            if not m:
                continue
            toe, doc, po, dt, amt_s = m.groups()
            amt = parse_amount(amt_s) or 0.0
            if toe == "CM":
                amt = -abs(amt)
            records.append(StatementRecord(
                invoice_no=doc,
                txn_date=parse_date(dt),
                amount=amt,
                type="Credit" if amt < 0 else "Bill",
                po_ref=po if po not in ("", "-") else None,
                raw=line.strip(),
            ))
        total_m = TOTAL_RE.search(text)
        acct_m  = ACCT_RE.search(text)
        date_m  = DATE_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=acct_m.group(1) if acct_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            records=records,
            source_file=pdf_path,
        )
