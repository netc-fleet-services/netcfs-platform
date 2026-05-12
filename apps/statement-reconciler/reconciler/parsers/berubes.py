"""Berube's Truck Accessories LLC.
   Same billing software as Fastener Warehouse.
   Format: Date | "INV #1-XXXXXX[-XX]. Due MM/DD/YYYY. PO #XX-XXXXX. Orig. Amount $XX.XX." | Amount | Balance
   Invoice numbers include dashes (e.g. 1-161141, 1-730229-01).
"""
from __future__ import annotations
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

# Date + "INV #<inv>. ..." then an amount somewhere later on the same line
LINE_RE = re.compile(
    r"^(\d{2}/\d{2}/\d{4})\s+INV #([\w-]+)\."
)
AMT_RE  = re.compile(r"([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$")
PO_RE   = re.compile(r"PO #(\S+?)\.")
TOTAL_RE = re.compile(r"Amount Due\s+\$([\d,]+\.\d{2})", re.IGNORECASE)
DATE_RE  = re.compile(r"Date\s+(\d{1,2}/\d{1,2}/\d{4})", re.IGNORECASE)


@register("berubes")
class Berubes(StatementParser):
    vendor = "Berube's Truck Accessories LLC"

    def parse(self, pdf_path: str) -> ParsedStatement:
        text = self.extract_text(pdf_path)

        # Transaction descriptions can wrap across lines; join continuation lines
        # A continuation line starts with whitespace and doesn't start with a date
        joined_lines = []
        for raw_line in text.splitlines():
            if joined_lines and not re.match(r"^\d{2}/\d{2}/\d{4}", raw_line.strip()) and raw_line.startswith(" "):
                joined_lines[-1] += " " + raw_line.strip()
            else:
                joined_lines.append(raw_line)

        records = []
        for line in joined_lines:
            m = LINE_RE.match(line.strip())
            if not m:
                continue
            dt_s, inv = m.groups()
            po_m = PO_RE.search(line)
            po = po_m.group(1) if po_m else None
            amt_m = AMT_RE.search(line)
            if not amt_m:
                continue
            amt = parse_amount(amt_m.group(1)) or 0.0
            records.append(StatementRecord(
                invoice_no=inv,
                txn_date=parse_date(dt_s),
                amount=amt,
                type="Credit" if amt < 0 else "Bill",
                po_ref=po,
                raw=line.strip(),
            ))

        total_m = TOTAL_RE.search(text)
        date_m  = DATE_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            records=records,
            source_file=pdf_path,
        )
