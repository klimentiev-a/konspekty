"""Бухгалтерская отчётность эмитентов из ГИР БО ФНС (bo.nalog.gov.ru).

Государственный информационный ресурс бухгалтерской отчётности отдаёт РСБУ любого
российского юрлица в машиночитаемом виде: баланс, отчёт о финансовых результатах, движение
капитала и денежных средств — по кодам строк, в тысячах рублей. Для небольших эмитентов это
единственный сопоставимый источник: их отчётность на раскрытии лежит сканами.

Каждый годовой отчёт содержит три колонки — текущий год, предыдущий и позапрошлый, поэтому
двух-трёх отчётов хватает, чтобы закрыть пятилетний ряд.

    from . import girbo
    girbo.for_inn("7826705374")      # {"2025": {...}, "2024": {...}, ...}
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
import warnings

import requests

log = logging.getLogger("girbo")
warnings.filterwarnings("ignore", message="Unverified HTTPS request")

_BASE = "https://bo.nalog.gov.ru"
_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "girbo.json")
_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
       "(KHTML, like Gecko) Version/17.0 Safari/605.1.15")

# коды строк РСБУ → наши ключи (суммы в тыс. ₽, приводим к млн)
BALANCE = {
    "1110": "intangibles", "1150": "fixed_assets", "1160": "lease_assets",   # доходные вложения
    "1170": "fin_invest_lt", "1190": "other_lt", "1100": "assets_lt",
    "1230": "receivables", "1240": "fin_invest_st", "1250": "cash", "1200": "assets_st",
    "1600": "assets", "1300": "equity", "1410": "debt_lt", "1450": "other_lt_liab",
    "1400": "liab_lt", "1510": "debt_st", "1520": "payables", "1500": "liab_st",
}
RESULT = {
    "2110": "revenue", "2120": "cost", "2200": "op_profit", "2320": "fin_income",
    "2330": "interest_exp", "2300": "pretax", "2400": "profit",
}


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": _UA, "Accept": "application/json, text/plain, */*",
                      "Referer": _BASE + "/"})
    return s


def find_org(inn: str, s: requests.Session | None = None) -> dict | None:
    """Организация в ГИР БО по ИНН."""
    s = s or _session()
    r = s.get(f"{_BASE}/advanced-search/organizations/search",
              params={"allFieldsMatch": "false", "query": inn, "page": 0, "size": 5},
              timeout=40, verify=False)
    r.raise_for_status()
    for it in (r.json().get("content") or []):
        if re.sub(r"\D", "", str(it.get("inn") or "")) == re.sub(r"\D", "", inn):
            return {"id": it.get("id"), "name": re.sub(r"<[^>]+>", "", it.get("shortName") or it.get("fullName") or ""),
                    "inn": inn, "ogrn": it.get("ogrn")}
    return None


def _mln(v) -> float | None:
    return None if v is None else round(v / 1000, 1)       # тыс. ₽ → млн ₽


def reports(org_id: int, s: requests.Session | None = None) -> list[dict]:
    s = s or _session()
    r = s.get(f"{_BASE}/nbo/organizations/{org_id}/bfo/", timeout=40, verify=False)
    r.raise_for_status()
    return r.json()


def details(bfo_id: int, s: requests.Session | None = None) -> dict:
    s = s or _session()
    r = s.get(f"{_BASE}/nbo/bfo/{bfo_id}/details", timeout=60, verify=False)
    r.raise_for_status()
    d = r.json()
    return (d[0] if isinstance(d, list) and d else d) or {}


def _pick(block: dict, codes: dict, prefix: str) -> dict:
    out = {}
    for code, key in codes.items():
        v = block.get(f"{prefix}{code}")
        if isinstance(v, (int, float)):
            out[key] = _mln(v)
    return out


def parse(det: dict, period: str) -> dict[str, dict]:
    """Из одного годового отчёта достаём текущий, прошлый и позапрошлый годы."""
    bal, fin = det.get("balance") or {}, det.get("financialResult") or {}
    year = int(period)
    out: dict[str, dict] = {}
    for prefix_b, prefix_f, shift in (("current", "current", 0), ("previous", "previous", 1),
                                      ("beforePrevious", None, 2)):
        rec = _pick(bal, BALANCE, prefix_b)
        if prefix_f:
            rec.update(_pick(fin, RESULT, prefix_f))
        if rec:
            out[str(year - shift)] = rec
    return out


def fetch(inns: dict[str, str], years: int = 5, delay: float = 0.4) -> dict:
    """Собрать РСБУ по словарю {имя: ИНН}; результат кладём в кэш."""
    s = _session()
    data = load()
    data.setdefault("companies", {})
    for name, inn in inns.items():
        try:
            org = find_org(inn, s)
            if not org:
                log.warning("ГИР БО: не нашёл ИНН %s (%s)", inn, name)
                continue
            rep = sorted(reports(org["id"], s), key=lambda x: str(x.get("period")), reverse=True)
            rec: dict[str, dict] = {}
            for r in rep[:years]:
                period = str(r.get("period") or "")
                if not period.isdigit():
                    continue
                try:
                    rec.update({k: v for k, v in parse(details(r["id"], s), period).items()
                                if k not in rec})
                except Exception as e:  # noqa: BLE001
                    log.warning("ГИР БО %s %s: %s", name, period, e)
                time.sleep(delay)
            data["companies"][name] = {"inn": inn, "org": org.get("name"), "years": rec}
            log.info("%s — лет: %s", name, ", ".join(sorted(rec)))
        except Exception as e:  # noqa: BLE001
            log.warning("ГИР БО %s (%s): %s", name, inn, e)
        time.sleep(delay)
    data["units"] = "млн ₽"
    data["source"] = _BASE
    try:
        with open(_CACHE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except OSError as e:  # noqa: BLE001
        log.warning("кэш ГИР БО: %s", e)
    return data


def load() -> dict:
    try:
        with open(_CACHE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"companies": {}}


def for_inn(inn: str) -> dict:
    for rec in (load().get("companies") or {}).values():
        if str(rec.get("inn")) == str(inn):
            return rec.get("years") or {}
    return {}


def metrics(y: dict) -> dict:
    """Показатели из РСБУ: нагрузка, рентабельность, структура активов."""
    debt = None
    if y.get("debt_lt") is not None or y.get("debt_st") is not None:
        debt = (y.get("debt_lt") or 0) + (y.get("debt_st") or 0)
    eq, assets = y.get("equity"), y.get("assets")
    r = dict(y)
    r["debt"] = debt
    r["de"] = round(debt / eq, 2) if (debt is not None and eq) else None
    r["eqa"] = round(100 * eq / assets, 1) if (eq is not None and assets) else None
    r["roe"] = round(100 * y["profit"] / eq, 1) if (y.get("profit") is not None and eq) else None
    r["roa"] = round(100 * y["profit"] / assets, 1) if (y.get("profit") is not None and assets) else None
    r["margin"] = round(100 * y["profit"] / y["revenue"], 1) if (y.get("profit") is not None and y.get("revenue")) else None
    r["lease_share"] = round(100 * y["lease_assets"] / assets, 1) if (y.get("lease_assets") is not None and assets) else None
    if y.get("interest_exp") is not None and debt:
        r["cost_of_debt"] = round(100 * abs(y["interest_exp"]) / debt, 1)
    return r
