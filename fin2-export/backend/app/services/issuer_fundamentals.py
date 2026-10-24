"""Issuer credit-analytics: pulls RESOLVED IFRS/RAS fundamentals from the local
RU Equity Terminal (audited PDF МСФО + Excel databooks, already scale-anchored and
deduped there — we do NOT re-parse the raw statements) and computes credit metrics
for the bond issuers: ND/EBITDA, Debt/EBITDA, ICR, Debt/Equity, margins, ROE/ROA.

Data source: the terminal's HTTP API (financials) + its SQLite for interest expense
(not exposed over HTTP). Read-only; nothing is fabricated.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
import urllib.request

from sqlalchemy.orm import Session

from ..db import BondSnapshot
from . import ratings

TERMINAL = os.environ.get("RU_TERMINAL_URL", "http://127.0.0.1:8020")
RU_DB = os.environ.get("RU_DB", os.path.expanduser("~/Desktop/Claude Code/ru-equity-terminal/data/ru.db"))
_TTL = 900
_cache: dict = {}


def _get(path: str):
    with urllib.request.urlopen(f"{TERMINAL}{path}", timeout=25) as r:
        return json.load(r)


def terminal_ok() -> bool:
    try:
        _get("/api/state")
        return True
    except Exception:  # noqa: BLE001
        return False


def _screener() -> list[dict]:
    now = time.time()
    c = _cache.get("screener")
    if c and now - c[0] < _TTL:
        return c[1]
    rows = _get("/api/screener?only_data=true")
    _cache["screener"] = (now, rows)
    return rows


def _rudb():
    if not os.path.exists(RU_DB):
        return None
    return sqlite3.connect(f"file:{RU_DB}?mode=ro", uri=True)


def _interest_by_ticker() -> dict:
    """Latest annual |interest expense| per ticker, resolved with a scale-sanity
    filter (0.2%–300% of the resolved EBITDA) to drop mis-parsed values."""
    now = time.time()
    c = _cache.get("interest")
    if c and now - c[0] < _TTL:
        return c[1]
    from datetime import date
    last_complete = date.today().year - 1              # current-year FY is still partial
    out: dict[str, float] = {}
    con = _rudb()
    if con:
        try:
            cur = con.execute(
                "select ticker, period, value from facts "
                "where metric='interest_expense' and period like '____FY' order by period")
            by: dict[str, list] = {}
            for tk, per, val in cur.fetchall():
                if val:
                    try:
                        yr = int(per[:4])
                    except ValueError:
                        continue
                    by.setdefault(tk, []).append((yr, abs(val)))
            for tk, lst in by.items():
                lst.sort()
                complete = [v for yr, v in lst if yr <= last_complete]
                out[tk] = complete[-1] if complete else lst[-1][1]   # last full year
        finally:
            con.close()
    _cache["interest"] = (now, out)
    return out


def _companies() -> dict:
    """ticker -> {name, name_full, issuer, inn} from the terminal's registry."""
    now = time.time()
    c = _cache.get("companies")
    if c and now - c[0] < _TTL:
        return c[1]
    out: dict[str, dict] = {}
    con = _rudb()
    if con:
        try:
            cur = con.execute("select ticker, name, name_full, issuer, inn, sector from companies")
            for tk, name, full, issuer, inn, sector in cur.fetchall():
                out[tk] = {"name": name, "name_full": full, "issuer": issuer, "inn": inn, "sector": sector}
        finally:
            con.close()
    _cache["companies"] = (now, out)
    return out


def _ticker_by_key() -> dict:
    """issuer_key(name) -> ticker, so a bond issuer can be matched to fundamentals."""
    idx: dict[str, str] = {}
    for tk, c in _companies().items():
        for nm in (c.get("issuer"), c.get("name_full"), c.get("name"), tk):
            k = ratings.issuer_key(nm)
            if k:
                idx.setdefault(k, tk)
    return idx


def _ratios(ticker: str, row: dict, base: dict | None, interest: dict) -> dict:
    ebitda = (base or {}).get("ebitda") or row.get("ebitda")
    ebit = (base or {}).get("ebit")
    debt = (base or {}).get("debt")
    equity = (base or {}).get("equity") or row.get("equity")
    net_debt = (base or {}).get("net_debt")
    if net_debt is None:
        net_debt = row.get("net_debt")
    ie = interest.get(ticker)

    def _cap(x, lo, hi):    # drop values outside a sane band (mis-parsed inputs)
        return x if (x is not None and lo <= x <= hi) else None

    d = {
        "nd_ebitda": row.get("nd_ebitda"),
        "debt_ebitda": _cap(round(debt / ebitda, 2), 0, 30) if (debt and ebitda and ebitda > 0) else None,
        "debt_equity": _cap(round(debt / equity, 2), 0, 25) if (debt and equity and equity > 0) else None,
        "nd_equity": _cap(round(net_debt / equity, 2), -25, 25) if (net_debt is not None and equity and equity > 0) else None,
        "icr": _cap(round(ebit / ie, 2), -5, 60) if (ebit and ie and ie > 0) else None,
        "icr_ebitda": _cap(round(ebitda / ie, 2), -5, 60) if (ebitda and ie and ie > 0) else None,
        "ebitda_margin": row.get("ebitda_margin"),
        "net_margin": row.get("net_margin"),
        "roe": row.get("roe"), "roa": row.get("roa"),
        "fcf_yield": row.get("fcf_yield"), "rev_yoy": row.get("rev_yoy"),
    }
    return d


def credit_table(db: Session) -> dict:
    """Match every traded bond issuer to a terminal ticker and return its credit
    metrics. One screener call + one interest map; per-issuer base is skipped here
    (table uses ND/EBITDA & margins; ICR/Debt ratios are filled on the detail view)."""
    if not terminal_ok():
        return {"available": False, "detail": "RU Equity Terminal (:8020) не запущен — нет источника отчётности"}
    scr = {r["ticker"]: r for r in _screener()}
    interest = _interest_by_ticker()
    idx = _ticker_by_key()

    # distinct bond issuers (effective name) → ticker, deduped by ticker so two
    # bond-issuer name variants that map to the same company appear once.
    seen: dict[str, dict] = {}
    for s in db.query(BondSnapshot).filter(BondSnapshot.ytm.isnot(None)).all():
        nm = s.issuer_full or s.shortname
        k = ratings.issuer_key(nm)
        if not k:
            continue
        tk = idx.get(k)
        if not tk or tk not in scr or tk in seen:
            continue
        row = scr[tk]
        ie = interest.get(tk)
        ebitda = row.get("ebitda")
        icr = round(ebitda / ie, 2) if (ebitda and ie and ie > 0) else None
        if icr is not None and not (-5 <= icr <= 60):
            icr = None                                  # drop mis-scaled interest
        seen[tk] = {
            "issuer": row.get("name"), "ticker": tk, "sector": row.get("sector"),
            "nd_ebitda": row.get("nd_ebitda"),
            "icr_ebitda": icr,
            "ebitda_margin": row.get("ebitda_margin"), "net_margin": row.get("net_margin"),
            "roe": row.get("roe"), "roa": row.get("roa"), "fcf_yield": row.get("fcf_yield"),
            "rev_yoy": row.get("rev_yoy"), "revenue": row.get("revenue"),
            "ebitda": ebitda, "net_debt": row.get("net_debt"),
        }
    rows = sorted(seen.values(), key=lambda x: (x.get("nd_ebitda") is None, x.get("nd_ebitda") or 0))
    return {"available": True, "count": len(rows), "rows": rows}


def issuer_detail(q: str) -> dict:
    """Full credit profile for one issuer (by ticker or bond-issuer name):
    resolved statement items, all credit ratios, and per-period trends."""
    if not terminal_ok():
        return {"available": False, "detail": "RU Equity Terminal (:8020) не запущен"}
    idx = _ticker_by_key()
    tk = q.upper() if q.upper() in _companies() else idx.get(ratings.issuer_key(q))
    if not tk:
        return {"available": False, "detail": f"эмитент «{q}» не найден в базе отчётности"}
    comp = _get(f"/api/company/{tk}")
    base = comp.get("base") or {}
    row = next((r for r in _screener() if r["ticker"] == tk), {})
    interest = _interest_by_ticker()
    fin = _get(f"/api/company/{tk}/financials")
    return {
        "available": True, "ticker": tk, "name": comp.get("company", {}).get("name") or tk,
        "sector": comp.get("company", {}).get("sector"),
        "base": base, "ratios": _ratios(tk, row, base, interest),
        "interest_expense": interest.get(tk),
        "financials": fin,       # {periods, labels, rows}
        "as_of": (fin.get("periods") or [None])[-1],
    }
