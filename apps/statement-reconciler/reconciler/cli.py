"""Command-line entry point.

Usage:
    python -m reconciler.cli list-vendors
    python -m reconciler.cli parse <vendor_key> <statement.pdf>          # dump records to stdout
    python -m reconciler.cli verify [folder]                             # run all sample tests
    python -m reconciler.cli load-qb <quickbooks.xlsx>                   # dump QB records
"""
from __future__ import annotations
import json
import sys


def cmd_list_vendors():
    from .parsers import list_vendors
    for v in list_vendors():
        print(v)


def cmd_parse(vendor_key: str, pdf_path: str):
    from .parsers import get_parser
    s = get_parser(vendor_key).parse(pdf_path)
    out = s.as_dict()
    out["computed_total"] = s.computed_total()
    print(json.dumps(out, indent=2, default=str))


def cmd_verify(folder=None):
    from . import verify
    verify.main(folder or "/sessions/charming-sharp-galileo/mnt/Statements for Reconciliation")


def cmd_load_qb(xlsx_path: str):
    from .qb_loader import load_qb
    s = load_qb(xlsx_path)
    out = s.as_dict()
    out["computed_total"] = s.computed_total()
    print(json.dumps(out, indent=2, default=str))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "list-vendors":
        cmd_list_vendors()
    elif cmd == "parse" and len(sys.argv) >= 4:
        cmd_parse(sys.argv[2], sys.argv[3])
    elif cmd == "verify":
        cmd_verify(sys.argv[2] if len(sys.argv) > 2 else None)
    elif cmd == "load-qb" and len(sys.argv) >= 3:
        cmd_load_qb(sys.argv[2])
    else:
        print(__doc__); sys.exit(1)


if __name__ == "__main__":
    main()
