"""Run every registered parser against its known sample PDF.

Reports: stated total vs. computed sum, record count, sample records.
This proves each parser extracts the right data before any QB comparison.
"""
from __future__ import annotations
import os
import sys
from typing import List, Tuple

# Sample PDF -> parser key
SAMPLES: List[Tuple[str, str]] = [
    ("600353_20260501_31996662_15063539837.pdf", "fleetpride"),
    ("600353-002_20260501_31996662_15063539839.pdf", "fleetpride"),
    ("ARStmt.pdf", "advantage"),
    ("CustState16297-0501261751.pdf", "omni"),
    ("CustState50659-0504260724.pdf", "kljack"),
    ("Customer Receivables Aging_20260504_23440PM.pdf", "castle"),
    ("Customer's statement of account NEW778 20260501.pdf", "wisupply"),
    ("CustomerAccountStatement.pdf", "kimball"),
    ("kimballCustomerAccountStatement.pdf", "kimball"),
    ("NETC_statements .pdf", "dennison"),
    ("National Tire Wholesale-STATEMENT-25326608-04302.PDF", "nationaltire"),
    ("STMT-0-05210-043026.pdf", "brookline"),
    ("Statement for NEW ENGLAND TRUCK CENTER.pdf", "unitedpacific"),
    ("Statement_11530733.pdf", "myers"),
    ("Statement_11670.pdf", "nekw"),
    ("VFSTMFRM_NEENTR_20260501-122152.PDF", "rctoolbox"),
    ("ballardcustomerinvoice.pdf", "cdk"),
    ("billing01_11097_c.pdf", "arcsource"),
    ("customerinvoice.pdf", "cdk"),
    ("d30a8bbf-7862-48bd-aeab-6763746d8371.pdf", "whelen"),
    ("dmscustomerinvoice.pdf", "cdk"),
    ("pmouthfordcustomerinvoice.pdf", "cdk"),
    ("statement-1135755.pdf", "keystone"),
    ("stmt.PDF", "stmt_unknown"),
    ("sullivantire_1001517_20260501_31996531_15063442720.pdf", "sullivan"),
    ("sullivantire_1202217_20260501_31996531_15063447267.pdf", "sullivan"),
    ("20250504124538.pdf", "zips"),
]


def status(stated, computed, mode="open_only"):
    if mode == "all_activity":
        # stated_total is "currently open"; computed is "all activity in period"
        # they're not expected to match, just report both
        return "ACTIVITY_MODE"
    if stated is None:
        return "NO_STATED_TOTAL"
    if abs(stated - computed) < 0.01:
        return "OK"
    return f"MISMATCH(Δ{stated - computed:+.2f})"


def main(folder: str):
    from reconciler.parsers import get_parser
    print(f"{'STATUS':18} {'VENDOR':40} {'STATED':>12} {'COMPUTED':>12}  {'RECS':>4}  FILE")
    print("-" * 130)
    rows = []
    for fn, key in SAMPLES:
        path = os.path.join(folder, fn)
        if not os.path.exists(path):
            print(f"{'MISSING':18} {key:40} {'-':>12} {'-':>12}  {'-':>4}  {fn}")
            continue
        try:
            parser = get_parser(key)
            r = parser.parse(path)
            st = status(r.period_total, r.computed_total(), getattr(r, 'statement_mode', 'open_only'))
            print(f"{st:18} {r.vendor:40} {(r.period_total or 0):>12.2f} {r.computed_total():>12.2f}  {len(r.records):>4}  {fn}")
            rows.append((st, r))
        except Exception as e:
            print(f"{'ERROR':18} {key:40}  {fn}  ::  {type(e).__name__}: {e}")
    return rows


if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else \
        "/sessions/charming-sharp-galileo/mnt/Statements for Reconciliation"
    main(folder)
