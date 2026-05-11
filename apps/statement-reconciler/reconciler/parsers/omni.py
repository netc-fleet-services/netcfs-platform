"""Omni Services & K.L. Jack — same template (Sage/etc).
   Invoice  Invoice    Due       Purchase Order      Amount     Invoice
   Number   Date       Date                          Due        Number
   3371026  03/31/2026 04/30/2026 115581             215.71     3371026
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE = re.compile(
    r"^\s+(\S+)\s+(\d{1,2}/\d{1,2}/\d{4})\s+(\d{1,2}/\d{1,2}/\d{4})\s+(.*?)\s+(-?[\d,]+\.\d{2})\s+(\S+)\s*$"
)
TOTAL_RE = re.compile(r"Total Amount Due:\s*([\d,]+\.\d{2})")
CUST_RE = re.compile(r"Customer ID[:\s]+(\S+)", re.IGNORECASE)
DATE_RE = re.compile(r"Statement As of Date:\s*(\d{1,2}/\d{1,2}/\d{4})", re.IGNORECASE)


def _parse(self, pdf_path, vendor):
    text = self.extract_text(pdf_path)
    records = []
    for line in text.splitlines():
        m = LINE_RE.match(line)
        if not m:
            continue
        inv, dt, due, po, amt_s, inv2 = m.groups()
        if inv != inv2:
            continue  # safety: this template repeats invoice number at end of row
        amt = parse_amount(amt_s) or 0.0
        records.append(StatementRecord(
            invoice_no=inv,
            txn_date=parse_date(dt),
            amount=amt,
            type="Credit" if amt < 0 else "Bill",
            po_ref=po.strip() or None,
            raw=line.strip(),
        ))
    total_m = TOTAL_RE.search(text)
    cust_m = CUST_RE.search(text)
    date_m = DATE_RE.search(text)
    return ParsedStatement(
        vendor=vendor,
        statement_date=parse_date(date_m.group(1)) if date_m else None,
        account_no=cust_m.group(1) if cust_m else None,
        period_total=parse_amount(total_m.group(1)) if total_m else None,
        records=records,
        source_file=pdf_path,
    )


@register("omni")
class OmniServices(StatementParser):
    vendor = "Omni Services"
    def parse(self, pdf_path):
        return _parse(self, pdf_path, self.vendor)


@register("kljack")
class KLJack(StatementParser):
    vendor = "K.L. Jack & Co."
    def parse(self, pdf_path):
        return _parse(self, pdf_path, self.vendor)
