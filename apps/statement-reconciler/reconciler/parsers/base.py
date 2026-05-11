"""Base parser interface — all vendor parsers produce records in this schema."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import date
from typing import List, Optional


@dataclass
class StatementRecord:
    """One transaction line on a statement, normalized to match QB format."""
    invoice_no: str               # vendor's invoice / document / reference number
    txn_date: Optional[date]      # invoice / posting date
    amount: float                 # positive for charges/bills, negative for credits/payments
    type: str                     # "Bill" or "Credit" (or "Payment" for payment lines)
    po_ref: Optional[str] = None  # customer PO if visible (helpful for matching when QB used PO)
    raw: str = ""                 # original line text — for debugging


@dataclass
class ParsedStatement:
    vendor: str                   # e.g. "FleetPride"
    statement_date: Optional[date]
    account_no: Optional[str]
    period_total: Optional[float] # the "Please Pay" / "Total Due" / "Balance Due" stated on the statement
    statement_mode: str = "open_only"  # "open_only" = stated_total = sum(records); "all_activity" = stated is current balance, records include historical paid items
    records: List[StatementRecord] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)  # parser warnings ("page 2 had odd row", etc.)
    source_file: str = ""

    def as_dict(self):
        d = asdict(self)
        # serialize dates as ISO strings for json/excel
        d["statement_date"] = self.statement_date.isoformat() if self.statement_date else None
        for r in d["records"]:
            r["txn_date"] = r["txn_date"].isoformat() if r["txn_date"] else None
        return d

    def computed_total(self) -> float:
        return round(sum(r.amount for r in self.records), 2)


class StatementParser:
    """Subclass per vendor. Override .vendor and .parse()."""
    vendor: str = "UNKNOWN"

    def parse(self, pdf_path: str) -> ParsedStatement:
        raise NotImplementedError

    # Convenience: extract layout text via pdfplumber
    @staticmethod
    def extract_text(pdf_path: str) -> str:
        import pdfplumber
        out = []
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                # layout=True preserves columnar spacing similar to `pdftotext -layout`
                out.append(page.extract_text(layout=True) or "")
        return "\n".join(out)
