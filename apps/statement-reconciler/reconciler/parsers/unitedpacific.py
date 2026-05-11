"""United Pacific Industries.
   Type      Document     Ext.Doc.No.       Invoice Date   Terms          Due Date    Debits       Credits      Balance
   Invoice   PSI1711693   01-STOCK/CMF      12/23/25       NET 30 DAYS    01/22/26    1,998.00                  1,998.00
   Payment   CCPYMT2026                     01/23/26                      01/23/26                 1,998.00         0.00
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

# Two patterns: invoice rows have ext doc no, terms; payment/credit rows are simpler
INVOICE_RE = re.compile(
    r"^Invoice\s+(\S+)\s+(\S*)\s+(\d{2}/\d{2}/\d{2})\s+NET\s+\d+\s+DAYS?\s+(\d{2}/\d{2}/\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})?\s*([\d,]+\.\d{2})\s*$"
)
PAYMENT_RE = re.compile(
    r"^(Payment|Credit)\s+(\S+)\s+(\d{2}/\d{2}/\d{2})\s+(\d{2}/\d{2}/\d{2})\s+([\d,]+\.\d{2})?\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$"
)
TOTAL_RE = re.compile(r"Statement Balance\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})", re.IGNORECASE)
ACCT_RE = re.compile(r"ACCOUNT NO:\s*(\S+)", re.IGNORECASE)
DATE_RE = re.compile(r"DATE:\s*(\d{1,2}/\d{1,2}/\d{4})")


@register("unitedpacific")
class UnitedPacific(StatementParser):
    vendor = "United Pacific Industries"

    def parse(self, pdf_path):
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            ls = line.lstrip()
            m = INVOICE_RE.match(ls)
            if m:
                doc, ext, inv_dt, due, debit, credit, balance = m.groups()
                amt = parse_amount(debit) or 0.0
                records.append(StatementRecord(
                    invoice_no=doc, txn_date=parse_date(inv_dt), amount=amt,
                    type="Bill", po_ref=ext if ext else None, raw=line.strip(),
                ))
                continue
            m = PAYMENT_RE.match(ls)
            if m:
                t, doc, inv_dt, due, debit, credit, balance = m.groups()
                amt = -(parse_amount(credit) or 0.0)
                records.append(StatementRecord(
                    invoice_no=doc, txn_date=parse_date(inv_dt), amount=amt,
                    type="Credit" if t == "Credit" else "Payment", po_ref=None,
                    raw=line.strip(),
                ))
        total_m = TOTAL_RE.search(text)
        net = parse_amount(total_m.group(3)) if total_m else None
        acct_m = ACCT_RE.search(text)
        date_m = DATE_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=acct_m.group(1) if acct_m else None,
            period_total=net, records=records, source_file=pdf_path,
        )
