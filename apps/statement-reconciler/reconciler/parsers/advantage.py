"""Advantage Truck Group / Allegiance Trucks-style.

Each row appears twice side-by-side (left = main, right = remit stub).
Layout (left half):
  04/01/26  05/01/26  X601076432:01 / 02-42961   38.40   0.00   X601076432:01 / 02-42961   38.40
  date_inv  date_due  ref / po                   chg     pmts/cr  ref/po (repeat)         balance

A bill row:    chg=38.40, pc=0.00, bal=38.40        -> Bill, amt=38.40
A credit row:  chg=0.00, pc=-181.99, bal=-181.99   -> Credit, amt=-181.99
A payment:     chg=0.00, pc=-743.75 (no balance row reset for paid bills)

We use the BALANCE column as the signed amount.
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

LINE_RE = re.compile(
    r"^\s*(\d{2}/\d{2}/\d{2})\s+(\d{2}/\d{2}/\d{2})\s+"
    r"([A-Z]\d{6,9}:\d{2})\s*/\s*(.+?)\s+"
    r"(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s+"
    r"[A-Z]\d{6,9}:\d{2}\s*/\s*.+?\s+"
    r"(-?[\d,]+\.\d{2})\s*$"
)
PLEASE_PAY_RE = re.compile(r"PLEASE PAY\s+\$?([\d,]+\.\d{2})", re.IGNORECASE)
ACCT_RE = re.compile(r"ACCT NO\.\s*\n?\s*(\d+)", re.IGNORECASE)
DATE_RE = re.compile(r"Statement\s*-\s*(\d{1,2}/\d{1,2}/\d{2})")


@register("advantage")
class Advantage(StatementParser):
    vendor = "Advantage Truck Group / ATG"

    def parse(self, pdf_path):
        text = self.extract_text(pdf_path)
        records = []
        seen = set()
        for line in text.splitlines():
            m = LINE_RE.match(line)
            if not m:
                continue
            inv_dt, due_dt, ref, po, chg_s, pc_s, bal_s = m.groups()
            charge = parse_amount(chg_s) or 0.0
            pc = parse_amount(pc_s) or 0.0
            balance = parse_amount(bal_s) or 0.0
            if balance < 0 or pc < 0:
                rec_type = "Credit"
                amt = balance if balance < 0 else pc
            else:
                rec_type = "Bill"
                amt = balance if balance else charge
            key = (ref, round(amt, 2))
            if key in seen:
                continue
            seen.add(key)
            records.append(StatementRecord(
                invoice_no=ref, txn_date=parse_date(inv_dt),
                amount=amt, type=rec_type, po_ref=po, raw=line.strip(),
            ))
        total_m = PLEASE_PAY_RE.search(text)
        acct_m = ACCT_RE.search(text)
        date_m = DATE_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=acct_m.group(1) if acct_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            records=records, source_file=pdf_path,
        )
