"""Rochester Truck (CDK Global AR statement).
   Format: DATE  DOCUMENT/TRANSACTION  PURCHASES  PAYMENTS & CREDITS  BALANCE
   Date format: DDMMMYY (e.g. 13MAR26).

   Each invoice appears twice when paid: once in PURCHASES, once in PAYMENTS & CREDITS.
   We collect all (date, doc, amount) rows, then mark docs that appear twice as
   Bill + Credit pairs; docs appearing once are open Bills.
"""
from __future__ import annotations
import re
from collections import defaultdict
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

# DDMMMYY + 4-6 digit doc number + amount
ROW_RE  = re.compile(r"^(\d{2}[A-Z]{3}\d{2})\s+(\d{4,6})\s+([\d,]+\.\d{2})")
PAY_RE  = re.compile(r"PLEASE PAY\s*THIS AMOUNT\D+([\d,]+\.\d{2})", re.IGNORECASE)
ACCT_RE = re.compile(r"ACCT\.\s*NO\s*[\n\r\s]+(\d+)", re.IGNORECASE)
DATE_RE = re.compile(r"CLOSING DATE\s*[\n\r\s]+(\d{2}[A-Z]{3}\d{2})", re.IGNORECASE)


@register("rochestertruck")
class RochesterTruck(StatementParser):
    vendor = "Rochester Truck"

    def parse(self, pdf_path: str) -> ParsedStatement:
        text = self.extract_text(pdf_path)

        # Collect all raw rows
        raw_rows: list[tuple] = []
        for line in text.splitlines():
            m = ROW_RE.match(line.strip())
            if m:
                raw_rows.append((m.group(1), m.group(2), m.group(3), line.strip()))

        # Group by doc number; docs appearing twice = one purchase + one payment
        doc_groups: dict[str, list] = defaultdict(list)
        for dt_s, doc, amt_s, raw in raw_rows:
            doc_groups[doc].append((dt_s, amt_s, raw))

        records = []
        for doc, entries in doc_groups.items():
            if len(entries) == 1:
                dt_s, amt_s, raw = entries[0]
                amt = parse_amount(amt_s) or 0.0
                records.append(StatementRecord(
                    invoice_no=doc, txn_date=parse_date(dt_s),
                    amount=amt, type="Bill", raw=raw,
                ))
            elif len(entries) >= 2:
                # Sort chronologically; first = purchase, second = payment
                entries.sort(key=lambda e: parse_date(e[0]) or __import__('datetime').date.min)
                dt_s, amt_s, raw = entries[0]
                amt = parse_amount(amt_s) or 0.0
                records.append(StatementRecord(
                    invoice_no=doc, txn_date=parse_date(dt_s),
                    amount=amt, type="Bill", raw=raw,
                ))
                dt_s2, _, raw2 = entries[1]
                records.append(StatementRecord(
                    invoice_no=doc, txn_date=parse_date(dt_s2),
                    amount=-amt, type="Credit", raw=raw2,
                ))

        pay_m  = PAY_RE.search(text)
        acct_m = ACCT_RE.search(text)
        date_m = DATE_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=acct_m.group(1) if acct_m else None,
            period_total=parse_amount(pay_m.group(1)) if pay_m else None,
            statement_mode="all_activity",
            records=records,
            source_file=pdf_path,
        )
