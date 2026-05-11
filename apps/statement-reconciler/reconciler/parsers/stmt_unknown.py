"""Unidentified vendor — file 'stmt.PDF'.

Format requires plain pdftotext (without -layout). Records appear as 1-3 line blocks:
  11290-00
  4/02/26 I
  728.90
or:
  12096-00 4/06/26 I
  235.30
"""
from __future__ import annotations
import re
import subprocess
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount


def _extract_plain(pdf_path: str) -> str:
    """Use pdftotext without layout (needed to defeat double-print striking)."""
    try:
        r = subprocess.run(["pdftotext", pdf_path, "-"], capture_output=True, text=True, timeout=30)
        return r.stdout
    except FileNotFoundError:
        # Fallback to pdfplumber if pdftotext isn't available
        import pdfplumber
        out = []
        with pdfplumber.open(pdf_path) as pdf:
            for p in pdf.pages:
                out.append(p.extract_text() or "")
        return "\n".join(out)


INV_DATE_RE = re.compile(r"^(\d{4,5}-\d{2})\s+(\d{1,2}/\d{1,2}/\d{2})\s+([ICP])\s*$")
INV_RE = re.compile(r"^(\d{4,5}-\d{2})\s*$")
DATE_RE = re.compile(r"^(\d{1,2}/\d{1,2}/\d{2})\s+([ICP])\s*$")
AMT_RE = re.compile(r"^(-?[\d,]+\.\d{2})\s*$")


@register("stmt_unknown")
class UnknownStmt(StatementParser):
    vendor = "Unknown vendor (stmt.PDF)"

    def parse(self, pdf_path):
        text = _extract_plain(pdf_path)
        lines = [l.strip() for l in text.splitlines()]
        records = []
        i = 0
        while i < len(lines):
            ln = lines[i]
            inv = dt = txn = amt = None
            # Form 1: invoice + date + type on one line, then amount
            m = INV_DATE_RE.match(ln)
            if m:
                inv, dt, txn = m.groups()
                # next non-empty line should be amount
                j = i + 1
                while j < len(lines) and (not lines[j] or set(lines[j]) <= {'_', ' '}):
                    j += 1
                am = AMT_RE.match(lines[j]) if j < len(lines) else None
                if am:
                    amt = am.group(1)
                    i = j + 1
                else:
                    i += 1
                    continue
            else:
                # Form 2: invoice on one line, date+type on next, amount on next
                m = INV_RE.match(ln)
                if m:
                    inv = m.group(1)
                    j = i + 1
                    while j < len(lines) and (not lines[j] or set(lines[j]) <= {'_', ' '}):
                        j += 1
                    dt_m = DATE_RE.match(lines[j]) if j < len(lines) else None
                    if dt_m:
                        dt, txn = dt_m.groups()
                        k = j + 1
                        while k < len(lines) and (not lines[k] or set(lines[k]) <= {'_', ' '}):
                            k += 1
                        am = AMT_RE.match(lines[k]) if k < len(lines) else None
                        if am:
                            amt = am.group(1)
                            i = k + 1
                        else:
                            i += 1
                            continue
                    else:
                        i += 1
                        continue
                else:
                    i += 1
                    continue
            amount = parse_amount(amt) or 0.0
            type_map = {"I": "Bill", "C": "Credit", "P": "Payment"}
            rec_type = type_map.get(txn, "Bill")
            if rec_type != "Bill":
                amount = -abs(amount)
            records.append(StatementRecord(
                invoice_no=inv, txn_date=parse_date(dt),
                amount=amount, type=rec_type, po_ref=None, raw=f"{inv} {dt} {txn} {amt}",
            ))
        # Find total: 1,831.75 appears multiple times; the first is the period total
        total = None
        for ln in lines:
            m = re.match(r"^([\d,]+\.\d{2})\s+([\d,.]+)\s+\.\d{2}\s+\.\d{2}\s+([\d,]+\.\d{2})$", ln)
            if m:
                total = parse_amount(m.group(1))
                break
        # Also try: lone 1,831.75 followed by aging row
        if total is None:
            for ln in lines:
                m = re.match(r"^([\d,]+\.\d{2})$", ln)
                if m:
                    val = parse_amount(m.group(1))
                    if val and val > sum(r.amount for r in records) * 0.9:
                        total = val
                        break
        return ParsedStatement(
            vendor=self.vendor, statement_date=None,
            account_no="63168",  # visible at top
            period_total=total,
            records=records, source_file=pdf_path,
        )
