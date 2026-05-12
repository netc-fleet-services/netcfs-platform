"""Cummins Inc. (ONEBMS billing system).
   Excel (.xlsx) format — not a PDF. Columns:
   Company Code | Customer# | Customer Name | Transaction Number |
   Transaction Date | Doc Type | PO# | Terms | Currency |
   Transaction Total | Open Amount | Days Past Due | Disputed?
"""
from __future__ import annotations
from datetime import datetime
from . import register
from .base import StatementParser, ParsedStatement, StatementRecord
from ..utils.dates import parse_date


@register("cummins")
class Cummins(StatementParser):
    vendor = "Cummins Inc"

    def parse(self, pdf_path: str) -> ParsedStatement:
        import openpyxl
        wb = openpyxl.load_workbook(pdf_path, read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))

        stmt_date = None
        period_total = None
        account_no = None
        header_row_idx = None
        col_map: dict[str, int] = {}

        saw_stmt_date_label = False
        for i, row in enumerate(rows):
            if not any(c is not None for c in row):
                continue
            first = row[0]

            if isinstance(first, str) and 'Statement As Of' in first:
                saw_stmt_date_label = True
                continue

            if saw_stmt_date_label and stmt_date is None:
                date_val = first
                if isinstance(date_val, str):
                    try:
                        stmt_date = datetime.strptime(date_val.strip(), '%B %d, %Y').date()
                    except ValueError:
                        pass
                elif hasattr(date_val, 'date'):
                    stmt_date = date_val.date()
                saw_stmt_date_label = False

            if isinstance(first, str) and 'Total Open AR' in first:
                val = next((c for c in row[1:] if isinstance(c, (int, float))), None)
                if val is not None:
                    period_total = round(float(val), 2)

            if isinstance(first, str) and first.strip() == 'Company Code':
                header_row_idx = i
                for j, cell in enumerate(row):
                    if cell is not None:
                        col_map[str(cell).strip()] = j

        records = []
        if header_row_idx is not None:
            for row in rows[header_row_idx + 1:]:
                if not any(c is not None for c in row):
                    continue
                txn_no   = row[col_map.get('Transaction Number', 3)]
                txn_dt   = row[col_map.get('Transaction Date', 4)]
                po       = row[col_map.get('PO#', 6)]
                open_amt = row[col_map.get('Open Amount', 10)]
                cust_no  = row[col_map.get('Customer#', 1)]

                if txn_no is None or open_amt is None:
                    continue
                if account_no is None and cust_no is not None:
                    account_no = str(int(cust_no)) if isinstance(cust_no, float) else str(cust_no)

                amt = float(open_amt)
                txn_type = "Credit" if amt < 0 else "Bill"

                txn_date = None
                if isinstance(txn_dt, str):
                    txn_date = parse_date(txn_dt)
                elif hasattr(txn_dt, 'date'):
                    txn_date = txn_dt.date()

                records.append(StatementRecord(
                    invoice_no=str(txn_no),
                    txn_date=txn_date,
                    amount=amt,
                    type=txn_type,
                    po_ref=str(po) if po else None,
                    raw=str(row[:13]),
                ))

        return ParsedStatement(
            vendor=self.vendor,
            statement_date=stmt_date,
            account_no=account_no,
            period_total=period_total,
            records=records,
            source_file=pdf_path,
        )
