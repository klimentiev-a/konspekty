"""Curated MOEX equity-index dashboard data.

The UI shows official index points without rebasing.  Price indices and
total-return indices live in separate groups so dividend treatment is explicit.
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

from . import moex


CATALOG = {
    "main": [
        {"code": "IMOEX", "name": "Индекс МосБиржи", "short": "MOEX", "color": "#8a6320"},
        {"code": "MOEXBMI", "name": "Индекс широкого рынка", "short": "Широкий", "color": "#2f6fd6"},
        {"code": "MOEXBC", "name": "Индекс голубых фишек", "short": "Голубые", "color": "#16856d"},
        {"code": "MCXSM", "name": "Средняя и малая капитализация", "short": "Средние/малые", "color": "#c6841d"},
        {"code": "RTSI", "name": "Индекс РТС", "short": "РТС", "color": "#6f5fc7"},
    ],
    "total_return": [
        {"code": "MCFTR", "name": "Индекс МосБиржи полной доходности, брутто", "short": "MOEX ПД брутто", "color": "#8a6320"},
        {"code": "MCFTRR", "name": "Индекс МосБиржи полной доходности, нетто для российских организаций", "short": "MOEX ПД нетто", "color": "#2f6fd6"},
        {"code": "MEBCTR", "name": "Голубые фишки полной доходности, брутто", "short": "Голубые ПД", "color": "#16856d"},
        {"code": "MESMTR", "name": "Средняя и малая капитализация полной доходности, брутто", "short": "Средние/малые ПД", "color": "#c6841d"},
    ],
    "sectors": [
        {"code": "MOEXOG", "name": "Нефть и газ", "short": "Нефть и газ", "color": "#8a6320"},
        {"code": "MOEXMM", "name": "Металлы и добыча", "short": "Металлы", "color": "#65747a"},
        {"code": "MOEXFN", "name": "Финансы", "short": "Финансы", "color": "#2f6fd6"},
        {"code": "MOEXCN", "name": "Потребительский сектор", "short": "Потребсектор", "color": "#c6841d"},
        {"code": "MOEXEU", "name": "Электроэнергетика", "short": "Электроэнерг.", "color": "#16856d"},
        {"code": "MOEXIT", "name": "Информационные технологии", "short": "ИТ", "color": "#6f5fc7"},
        {"code": "MOEXRE", "name": "Строительные компании", "short": "Строительство", "color": "#b66142"},
        {"code": "MOEXTN", "name": "Транспорт", "short": "Транспорт", "color": "#25818c"},
        {"code": "MOEXCH", "name": "Химия и нефтехимия", "short": "Химия", "color": "#91744a"},
    ],
    "themes": [
        {"code": "MOEXINN", "name": "Индекс МосБиржи инноваций", "short": "Инновации", "color": "#2f6fd6"},
        {"code": "MIPOTR", "name": "Индекс МосБиржи IPO полной доходности", "short": "IPO ПД", "color": "#8a6320"},
        {"code": "ESGITR", "name": "Рейтинги устойчивого развития полной доходности", "short": "ESG рейтинги", "color": "#16856d"},
        {"code": "MESGTR", "name": "MOEX–RAEX ESG полной доходности", "short": "MOEX–RAEX ESG", "color": "#6f5fc7"},
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
    if period in ("1m", "3m", "6m", "ytd", "1y"):
        return rows
    picked: dict[str, dict] = {}
    for row in rows:
        day = row["date"]
        if period == "3y":
            dt = date.fromisoformat(day)
            key = f"{dt.isocalendar().year}-{dt.isocalendar().week:02d}"
        else:
            key = day[:7]
        picked[key] = row
    return list(picked.values())


def get_dashboard(group: str = "main", period: str = "1y") -> dict:
    if group not in CATALOG:
        group = "main"
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
            rows = moex.get_bond_index_history(meta["code"], frm, till)
            points = [
                {"date": row["date"], "close": row["close"]}
                for row in rows if row.get("close") is not None
            ]
            try:
                quote = moex.get_index_quote(meta["code"])
                if quote and quote["date"] >= (points[-1]["date"] if points else frm):
                    points = [p for p in points if p["date"] != quote["date"]]
                    points.append({"date": quote["date"], "close": quote["close"], "intraday": True})
                    item["quote_time"] = quote.get("time")
            except Exception:
                pass  # Source unavailable: retain dated history, never invent a fresh quote.
            item["points"] = _thin(points, period)
        except Exception as exc:
            item["points"] = []
            item["error"] = str(exc)[:180]
        item["url"] = f"https://www.moex.com/ru/index/{meta['code']}"
        return item

    with ThreadPoolExecutor(max_workers=4) as pool:
        series = list(pool.map(load, CATALOG[group]))
    dates = [point["date"] for item in series for point in item["points"]]
    data = {
        "group": group,
        "period": period,
        "from": frm,
        "till": till,
        "as_of": max(dates) if dates else None,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "refresh_interval_seconds": 3600,
        "series": series,
        "source": "MOEX ISS",
        "source_url": "https://www.moex.com/ru/all-indices",
        "method": "Официальные значения индексов акций Московской Биржи в исходных пунктах.",
    }
    _CACHE[key] = (time.time(), data)
    return data
