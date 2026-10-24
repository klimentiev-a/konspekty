"""
Primary-market placements from public curated sources (not MOEX): the calendar
of upcoming/ongoing bond placements. Primary source is corpbonds.ru, whose
/public_offering page server-renders a clean table of announced placements
(issuer, book-building & placement dates, rating, coupon, term, volume).

We scrape it, normalize each row, and (best-effort) map the issuer to a MOEX ISIN
so the UI can click through to the issue card once the bond starts trading.
"""
from __future__ import annotations

import html
import logging
import re
import time

import requests

log = logging.getLogger("placements")

CORPBONDS_URL = "https://corpbonds.ru/public_offering"
_UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                     "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
_cache: dict = {"at": 0.0, "data": None}
_TTL = 1800  # 30 min


def _text(cell: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", cell))).strip()


def _parse_volume(s: str) -> float | None:
    """'От 5 млрд' / '2 млрд' / '500 млн' -> rubles."""
    m = re.search(r"([\d.,]+)\s*(млрд|млн|тыс)", s, re.I)
    if not m:
        return None
    val = float(m.group(1).replace(",", "."))
    mult = {"млрд": 1e9, "млн": 1e6, "тыс": 1e3}[m.group(2).lower()]
    return val * mult


def _parse_coupon(s: str) -> dict:
    """Coupon cell: '16.25% 30 дней' (fixed) or 'ΣКС + 3.25% 30 дней' (floater)."""
    s = s.replace("\r", " ").strip()
    is_float = bool(re.search(r"КС|RUONIA|ΣКС|\bКС\b|плав", s, re.I)) or "+" in s.split("%")[0]
    # first percentage number
    m = re.search(r"([\d.,]+)\s*%", s)
    rate = float(m.group(1).replace(",", ".")) if m else None
    return {"coupon_raw": s, "is_floater": is_float, "coupon": rate}


def _parse_date(s: str) -> str | None:
    m = re.search(r"(\d{2})\.(\d{2})\.(\d{4})", s)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def scrape_corpbonds(force: bool = False) -> list[dict]:
    now = time.time()
    if not force and _cache["data"] is not None and now - _cache["at"] < _TTL:
        return _cache["data"]
    try:
        r = requests.get(CORPBONDS_URL, headers=_UA, timeout=25)
        r.raise_for_status()
        page = r.text
    except requests.RequestException as e:
        log.warning("corpbonds fetch failed: %s", e)
        return _cache["data"] or []

    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S)
    out = []
    for tr in rows:
        cells = [_text(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        if len(cells) < 8 or cells[0] in ("Эмитент", ""):
            continue
        issuer = cells[0]
        if not issuer:
            continue
        cp = _parse_coupon(cells[5])
        out.append({
            "issuer": issuer,
            "book_date": _parse_date(cells[2]),
            "place_date": _parse_date(cells[3]),
            "rating_raw": cells[4] or None,
            "coupon": cp["coupon"],
            "is_floater": cp["is_floater"],
            "coupon_raw": cp["coupon_raw"],
            "term": cells[6].replace("\r", " ").strip() or None,
            "volume": _parse_volume(cells[7]),
            "volume_raw": cells[7] or None,
            "note": cells[8] if len(cells) > 8 else None,
            "source": "corpbonds.ru",
        })
    _cache["at"] = now
    _cache["data"] = out
    log.info("corpbonds: %d placements", len(out))
    return out
