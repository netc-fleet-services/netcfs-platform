"""Zips Truck Equipment — scanned PDF, requires OCR.

Layout (post-OCR):
   Date       Invoice ID    Purchase Order ID   Charges   Credits   Amount
   3/2/2026   SO342691      1075                $417.78   $417.78   $0.00
   4/2/2026   SO372866      02-101387           $73.38    $0.00     $73.38
"""
from __future__ import annotations
import os
import re
import subprocess
import tempfile
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount


def _ocr_pdf(pdf_path: str) -> str:
    """Render PDF pages to PNG and OCR each."""
    with tempfile.TemporaryDirectory() as td:
        # pdftoppm produces /tmp/.../page-1.png, page-2.png, ...
        subprocess.run(
            ["pdftoppm", "-r", "200", pdf_path, os.path.join(td, "page"), "-png"],
            capture_output=True, check=True,
        )
        out = []
        for fn in sorted(os.listdir(td)):
            if not fn.endswith(".png"):
                continue
            r = subprocess.run(
                ["tesseract", os.path.join(td, fn), "-"],
                capture_output=True, text=True, check=True,
            )
            out.append(r.stdout)
        return "\n".join(out)


# Match: 3/2/2026   SO342691   1075   $417.78   $417.78   $0.00
LINE_RE = re.compile(
    r"^(\d{1,2}/\d{1,2}/\d{4})\s+(SO\d{6,8})\s+(\S+)\s+\$?(-?[\d,]+\.\d{2})\s+\$?(-?[\d,]+\.\d{2})\s+\$?(-?[\d,]+\.\d{2})"
)
TOTAL_RE = re.compile(r"Customer Balance:\s*\$?([\d,]+\.\d{2})", re.IGNORECASE)
ACCT_RE = re.compile(r"Customer ID:\s*(\d+)", re.IGNORECASE)
DATE_RE = re.compile(r"(\d{1,2}/\d{1,2}/\d{4})\s*$", re.MULTILINE)


@register("zips")
class Zips(StatementParser):
    vendor = "Zips Truck Equipment"

    def parse(self, pdf_path):
        text = _ocr_pdf(pdf_path)
        records = []
        for line in text.splitlines():
            m = LINE_RE.match(line.strip())
            if not m:
                continue
            dt, inv, po, charges, credits, balance = m.groups()
            charge_v = parse_amount(charges) or 0.0
            credit_v = parse_amount(credits) or 0.0
            balance_v = parse_amount(balance) or 0.0
            # The "Amount" column = remaining balance for that invoice
            # Charges - credits = balance for that line
            # Record the gross charge as a Bill, then add an offsetting Credit if credits > 0
            records.append(StatementRecord(
                invoice_no=inv, txn_date=parse_date(dt),
                amount=charge_v, type="Bill", po_ref=po, raw=line.strip(),
            ))
            if credit_v != 0:
                records.append(StatementRecord(
                    invoice_no=inv, txn_date=parse_date(dt),
                    amount=-credit_v, type="Credit", po_ref=po,
                    raw=f"(credit on {inv})",
                ))
        total_m = TOTAL_RE.search(text)
        acct_m = ACCT_RE.search(text)
        return ParsedStatement(
            vendor=self.vendor,
            statement_date=None,  # OCR'd statement date often unreliable
            account_no=acct_m.group(1) if acct_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            records=records, source_file=pdf_path,
        )
