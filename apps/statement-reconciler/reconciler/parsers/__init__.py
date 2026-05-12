"""Vendor parser registry."""
from .base import StatementParser, ParsedStatement, StatementRecord

REGISTRY = {}


def merge_parsed_statements(stmts: list[ParsedStatement]) -> ParsedStatement:
    """Combine multiple vendor statement PDFs into one ParsedStatement."""
    if len(stmts) == 1:
        return stmts[0]
    all_records = [r for s in stmts for r in s.records]
    totals = [s.period_total for s in stmts if s.period_total is not None]
    period_total = round(sum(totals), 2) if totals else None
    accounts = ", ".join(filter(None, (s.account_no for s in stmts)))
    return ParsedStatement(
        vendor=stmts[0].vendor,
        statement_date=None,
        account_no=accounts or None,
        period_total=period_total,
        statement_mode=stmts[0].statement_mode,
        records=all_records,
        notes=[n for s in stmts for n in s.notes],
        source_file=", ".join(filter(None, (s.source_file for s in stmts))),
    )


def register(key: str):
    def deco(cls):
        REGISTRY[key] = cls
        return cls
    return deco


def get_parser(key: str) -> StatementParser:
    _ensure_loaded()
    if key not in REGISTRY:
        raise KeyError(f"Unknown vendor key: {key}. Available: {sorted(REGISTRY)}")
    return REGISTRY[key]()


def list_vendors():
    _ensure_loaded()
    return sorted(REGISTRY.keys())


_loaded = False


def _ensure_loaded():
    global _loaded
    if _loaded:
        return
    _loaded = True
    # Import lazily so missing modules during incremental dev don't crash other parsers
    import importlib
    for mod in [
        "fleetpride", "omni", "kljack", "castle", "wisupply", "kimball",
        "nationaltire", "unitedpacific", "whelen", "keystone", "myers",
        "rctoolbox", "arcsource", "brookline", "dennison", "sullivan",
        "advantage", "cdk_global", "nekw", "stmt_unknown", "zips",
        "cohensteel", "mcfarlandford", "rochestertruck", "fastenerwarehouse",
        "berubes", "americantextile",
        "hewsco", "terminalsupply", "burkeoil", "cummins",
    ]:
        try:
            importlib.import_module(f"reconciler.parsers.{mod}")
        except ModuleNotFoundError:
            pass  # parser not yet built — that's fine during incremental dev
