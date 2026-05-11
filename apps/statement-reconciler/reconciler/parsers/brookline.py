"""Brookline Machine / Automotive Parts WHSE.
  DATE       TYPE  REFERENCE      CHARGES    CREDITS    YOUR P.O. NO.
  04/07/26   INV   230212A        1113.07               01-42509
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE = re.compile(
    r"^(\d{2}/\d{2}/\d{2})\s+(INV|CR|PMT)\s+(\S+)\s+([\d,]+\.\d{2})?\s*([\d,]+\.\d{2})?\s+(\S+)?\s*$"
)
TOTAL_RE = re.compile(r"BALANCE DUE\s*\n[^\n]*?([\d,]+\.\d{2})\s*$", re.IGNORECASE | re.MULTILINE)
ACCT_RE = re.compile(r"CUST\s*#\s*(\S+\s*\d+)", re.IGNORECASE)
DATE_RE = re.compile(r"DATE\s*\n?\s*(\d{2}/\d{2}/\d{2})", re.IGNORECASE)


@register("brookline")
class Brookline(StatementParser):
    vendor = "Brookline Machine / APW"

    def parse(self, pdf_path):
        text = self.extract_text(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line.lstrip())
            if not m:
                continue
            dt, t, ref, charges, credits, po = m.groups()
            if t == "INV":
                amt = parse_amount(charges) if charges else 0.0
                rtype = "Bill"
            elif t == "CR":
                amt = -(parse_amount(credits) if credits else 0.0)
                rtype = "Credit"
            else:
                amt = -(parse_amount(credits) if credits else 0.0)
                rtype = "Payment"
            records.append(StatementRecord(
                invoice_no=ref, txn_date=parse_date(dt),
                amount=amt or 0.0, type=rtype, po_ref=po, raw=line.strip(),
            ))
        total_m = TOTAL_RE.search(text)
        acct_m = ACCT_RE.search(text)
        date_m = DATE_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=acct_m.group(1) if acct_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            records=records, source_file=pdf_path,
        )
