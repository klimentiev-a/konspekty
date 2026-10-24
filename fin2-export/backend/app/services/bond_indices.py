"""Curated MOEX bond-index dashboard data.

The catalogue contains official MOEX bond indices, including the RGBI price
index and total-return series.  Their history also exposes weighted YTM and
duration, which lets the UI compare market performance with the yield investors
could lock in at each date without inventing a synthetic series.
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

from . import moex


CATALOG = {
    "fixed": [
        {"code": "RUCBTRNS", "name": "Все корпоративные", "short": "Все корп.", "tone": "market"},
        {"code": "RUCBTRAAANS", "name": "Корпоративные AAA", "short": "AAA", "tone": "AAA"},
        {"code": "RUCBTRAANS", "name": "Корпоративные AA", "short": "AA", "tone": "AA"},
        {"code": "RUCBTRANS", "name": "Корпоративные A", "short": "A", "tone": "A"},
        {"code": "RUCBTRBBBNS", "name": "Корпоративные BBB", "short": "BBB", "tone": "BBB"},
        {"code": "RUCBHYTR", "name": "Высокодоходные", "short": "ВДО", "tone": "HY"},
    ],
    "floaters": [
        {"code": "RUFLCBTR", "name": "Все флоатеры ≥ A−", "short": "Все", "tone": "market"},
        {"code": "RUFLCBTRAAA", "name": "Флоатеры AAA", "short": "AAA", "tone": "AAA"},
        {"code": "RUFLCBTRAA", "name": "Флоатеры AA", "short": "AA", "tone": "AA"},
        {"code": "RUFLCBTRA", "name": "Флоатеры A", "short": "A", "tone": "A"},
        {"code": "RUCBKEYTR", "name": "Флоатеры на ключевую ставку", "short": "На КС", "tone": "key"},
        {"code": "RUCBRNTR", "name": "Флоатеры на RUONIA", "short": "На RUONIA", "tone": "ruonia"},
    ],
    "duration": [
        {"code": "RUCBITR1Y", "name": "Корпоративные ≤ 1 года", "short": "≤ 1 г.", "tone": "short"},
        {"code": "RUCBTR3YNS", "name": "Корпоративные 1–3 года", "short": "1–3 г.", "tone": "mid"},
        {"code": "RUCBTR5YNS", "name": "Корпоративные 3–5 лет", "short": "3–5 л.", "tone": "long"},
    ],
    "government": [
        {"code": "RGBI", "name": "ОФЗ — ценовой индекс", "short": "RGBI", "color": "#65747a"},
        {"code": "RGBITR", "name": "ОФЗ — полная доходность", "short": "RGBITR", "color": "#8a6320"},
        {"code": "RUMBTRNS", "name": "Субфедеральные и муниципальные облигации", "short": "Муни", "tone": "municipal"},
    ],
    "segments": [
        {"code": "RUCBTRNS", "name": "Корпоративные", "short": "Корп.", "tone": "market"},
        {"code": "RUCBHYTR", "name": "Высокодоходные", "short": "ВДО", "tone": "HY"},
        {"code": "RGBITR", "name": "ОФЗ", "short": "ОФЗ", "tone": "gov"},
        {"code": "RUFLGBITR", "name": "ОФЗ-ПК", "short": "ОФЗ-ПК", "tone": "key"},
        {"code": "RUGBINFTR", "name": "ОФЗ-ИН", "short": "ОФЗ-ИН", "tone": "inflation"},
        {"code": "RUMBTRNS", "name": "Муниципальные", "short": "Муни", "tone": "municipal"},
    ],
}

_PERIOD_DAYS = {"1m": 40, "3m": 100, "6m": 190, "1y": 370, "3y": 1100, "5y": 1835}
_CACHE: dict[tuple, tuple[float, dict]] = {}


def _from_for(period: str) -> str:
    if period == "all":
        return "2019-12-01"
    if period == "ytd":
        return date(date.today().year, 1, 1).isoformat()
    return (date.today() - timedelta(days=_PERIOD_DAYS.get(period, 370))).isoformat()


def _thin(rows: list[dict], period: str) -> list[dict]:
    """Keep charts light while retaining the latest observation exactly."""
    if period in ("1m", "3m", "6m", "ytd", "1y"):
        return rows
    picked: dict[str, dict] = {}
    for r in rows:
        d = r["date"]
        if period == "3y":
            dt = date.fromisoformat(d)
            key = f"{dt.isocalendar().year}-{dt.isocalendar().week:02d}"
        else:
            key = d[:7]
        picked[key] = r
    return list(picked.values())


def get_dashboard(group: str = "fixed", period: str = "1y") -> dict:
    if group not in CATALOG:
        group = "fixed"
    if period not in (*_PERIOD_DAYS, "ytd", "all"):
        period = "1y"
    key = (group, period, date.today().isoformat())
    hit = _CACHE.get(key)
    if hit and int(time.time() // 3600) == int(hit[0] // 3600):
        return hit[1]

    frm, till = _from_for(period), date.today().isoformat()

    def load(meta: dict) -> dict:
        item = dict(meta)
        try:
            rows = _thin(moex.get_bond_index_history(meta["code"], frm, till), period)
            # Keep official MOEX basket yields unchanged, including extreme,
            # zero and negative observations. Only missing source data is null.
            for r in rows:
                r["raw_yield"] = r["yield"]
            item["points"] = rows
        except Exception as exc:  # one missing index must not blank the page
            item["points"] = []
            item["error"] = str(exc)[:180]
        item["url"] = f"https://www.moex.com/ru/index/{meta['code']}"
        return item

    with ThreadPoolExecutor(max_workers=3) as ex:
        series = list(ex.map(load, CATALOG[group]))
    dates = [p["date"] for s in series for p in s["points"]]
    data = {
        "group": group, "period": period, "from": frm, "till": till,
        "as_of": max(dates) if dates else None,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "refresh_interval_seconds": 3600,
        "series": series,
        "source": "MOEX ISS",
        "source_url": "https://www.moex.com/ru/indices",
        "method": "Официальные индексы совокупного дохода и доходность их индексных баз.",
    }
    _CACHE[key] = (time.time(), data)
    return data
