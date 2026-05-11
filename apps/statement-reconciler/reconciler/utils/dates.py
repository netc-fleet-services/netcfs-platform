"""Date parsing helpers — vendors use many formats."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

# Most common formats found across the 27 statements
_FORMATS = [
    "%m/%d/%y",      # 04/30/26
    "%m/%d/%Y",      # 04/30/2026
    "%Y-%m-%d",      # 2026-04-30
    "%m\\%d\\%Y",    # 04\\21\\2026  (RC Toolbox uses backslashes)
    "%m-%d-%y",      # 04-30-26
    "%m-%d-%Y",      # 04-30-2026
    "%d%b%y",        # 30APR26  (CDK Global format)
    "%d%b%Y",
]


def parse_date(s: Optional[str]) -> Optional[date]:
    """Try every known format. Returns None on failure."""
    if not s:
        return None
    s = s.strip()
    if not s:
        return None
    # Normalize CDK upper-case month abbreviations: 30APR26 -> 30Apr26 for strptime
    if len(s) in (7, 9) and s[2:5].isalpha():
        s = s[:2] + s[2:5].title() + s[5:]
    for fmt in _FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_amount(s: str) -> Optional[float]:
    """Handle '1,234.56', '(1,234.56)', '$1,234.56', '-1,234.56', '1234.56-' (trailing minus)."""
    if s is None:
        return None
    t = s.strip().replace("$", "").replace(",", "").replace(" ", "")
    if not t:
        return None
    neg = False
    if t.startswith("(") and t.endswith(")"):
        neg = True
        t = t[1:-1]
    if t.endswith("-"):
        neg = True
        t = t[:-1]
    if t.startswith("-"):
        neg = True
        t = t[1:]
    try:
        v = float(t)
        return -v if neg else v
    except ValueError:
        return None
