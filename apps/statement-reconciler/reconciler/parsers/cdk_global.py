"""CDK Global "AR1C" template — Ballard, Lucky's/Dimmick, Grappone, Portsmouth Ford."""
from __future__ import annotations
import os
import re
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date, parse_amount

DATE_RE_LINE = re.compile(r"^\s*(\d{2}[A-Z]{3}\d{2})\s+(.*?)\s+(-?[\d,]+\.\d{2})\s*$")
HEADER_RE = re.compile(r"PURCHASES\s+PAYMENTS\s*&\s*CREDITS\s+BALANCE", re.IGNORECASE)
TOTAL_RE = re.compile(r"PLEASE PAY[\s\S]{0,400}?T\s*H\s*I\s*S\s+A\s*M\s*O\s*U\s*N\s*T\s+([\d,]+\.\d{2})", re.IGNORECASE)
ACCT_RE = re.compile(r"ACCT\.?\s*NO\.?\s*\n?\s*(\S+)", re.IGNORECASE)
CDATE_RE = re.compile(r"CLOSING DATE\s*\n?\s*(\d{2}[A-Z]{3}\d{2})", re.IGNORECASE)


def _doc_to_invoice(doc: str) -> str:
    """Strip dept-code prefix like '14 GRAPPONE M' and return last token."""
    tokens = doc.strip().split()
    if not tokens:
        return doc.strip()
    # If it's a single token, return it
    if len(tokens) == 1:
        return tokens[0]
    # Multi-token like "14 GRAPPONE M  62355M" or "14 GRAPPONE   62355M"
    # The actual document number is typically the last token (alphanumeric, maybe ends with letter)
    return tokens[-1]


@register("cdk")
class CDKGlobal(StatementParser):
    vendor = "CDK Global"

    _SUBVENDORS = {
        "ballardcustomerinvoice": "Ballard Mack Sales & Service",
        "customerinvoice": "Lucky's / Dimmick Group Peterbilt",
        "dmscustomerinvoice": "Grappone (Mazda/Ford)",
        "pmouthfordcustomerinvoice": "Portsmouth Ford",
    }

    def parse(self, pdf_path):
        stem = os.path.splitext(os.path.basename(pdf_path))[0]
        vendor = self._SUBVENDORS.get(stem, "CDK Global vendor")

        text = self.extract_text(pdf_path)

        # Find column boundary: PAYMENTS column position from header line
        pay_col = None
        for line in text.splitlines():
            if HEADER_RE.search(line):
                pay_col = line.find("PAYMENTS")
                break
        if pay_col is None:
            pay_col = 56  # fallback heuristic

        records = []
        for line in text.splitlines():
            m = DATE_RE_LINE.match(line)
            if not m:
                continue
            dt_s, doc, amt_s = m.groups()
            d = parse_date(dt_s)
            if d is None:
                continue
            if "Totals:" in doc:
                continue
            amt = parse_amount(amt_s) or 0.0
            inv_no = _doc_to_invoice(doc)

            # Determine type: position of amount relative to PAYMENTS column
            pos = line.rfind(amt_s)
            doc_clean = inv_no
            is_credit_doc = doc_clean.upper().startswith("CM")

            if is_credit_doc:
                rec_type = "Credit"
                amt = -abs(amt)
                inv_no = doc_clean[2:]
            elif pos >= pay_col:
                rec_type = "Payment"
                amt = -abs(amt)
            else:
                rec_type = "Bill"

            records.append(StatementRecord(
                invoice_no=inv_no, txn_date=d,
                amount=amt, type=rec_type, po_ref=None,
                raw=line.strip(),
            ))

        # Use LAST occurrence — multi-page statements repeat; final page has the actual total
        all_totals = list(TOTAL_RE.finditer(text))
        total_m = all_totals[-1] if all_totals else None
        acct_m = ACCT_RE.search(text)
        date_m = CDATE_RE.search(text)
        return ParsedStatement(
            vendor=vendor,
            statement_date=parse_date(date_m.group(1)) if date_m else None,
            account_no=acct_m.group(1) if acct_m else None,
            period_total=parse_amount(total_m.group(1)) if total_m else None,
            statement_mode="all_activity",
            records=records, source_file=pdf_path,
        )
