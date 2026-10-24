"""Секторы корпоративных эмитентов с разбором отчётности: электроэнергетика и ЖКХ, ритейл и торговля.

Отчётность — из файлов кредитных метрик (scripts/corp_import.py → data/issuers/corp/<ключ>.json):
выручка, EBITDA, долг и чистый долг, покрытие процентов, FCF, оборотный капитал, ROE/ROIC за
2021–2025 и LTM 6м2026. Рынок — наши облигации этих компаний: эмитента ищем по имени во всём
списке бумаг (у части выпусков отрасль в справочнике стоит другая), технические эмитенты
(ИКС 5 ФИНАНС, МВ ФИНАНС) привязаны к своим группам через data/issuers/corp/aliases.json.
Формат ответа тот же, что у застройщиков: общие блоки страницы (кривая сектора, карта
погашений, прочие эмитенты) работают без переделки.
"""
from __future__ import annotations

import json
import os
import re
from statistics import median

from sqlalchemy.orm import Session

from . import universe
from .sectors import _agg_market, _calendar_from_market, _issuer_key, _issuer_title, _spread, _tenor, _vol_rub

_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "issuers", "corp")


def _load(name: str) -> dict:
    with open(os.path.join(_DIR, f"{name}.json"), encoding="utf-8") as f:
        return json.load(f)


def _matches(r: dict, pats: list[str]) -> bool:
    iss = (r.get("issuer") or "").lower()
    full = (r.get("issuer_full") or "").lower()
    return any(re.search(p, iss) or re.search(p, full) for p in pats)


def build(db: Session, key: str) -> dict:
    data = _load(key)
    aliases = _load("aliases").get(key, {})
    sector = data["sector"]
    all_rows = universe._all_rows(db)
    periods = data["periods"]
    last = periods[-1]

    reported: set[str] = set()
    companies = []
    for c in data["companies"]:
        pats = aliases.get(c["code"]) or []
        bl = [r for r in all_rows if pats and _matches(r, pats)]
        reported |= {r["isin"] for r in bl}
        cal = _calendar_from_market(db, [r["isin"] for r in bl]) if bl else {}
        last_note = c["notes"].get(last) or next((c["notes"][p] for p in reversed(list(c["notes"])) if c["notes"].get(p)), None)
        companies.append({
            "company": c["company"], "code": c["code"], "standard": c["standard"],
            "full": _issuer_title(bl) if bl else None,
            "fin": c["fin"], "note": last_note, "notes": c["notes"], "sources": c["sources"],
            "items": c.get("items") or {},
            "market": _agg_market(bl) if bl else None,
            "bond_calendar": cal,
        })

    rows = [r for r in all_rows if (r.get("sector") or "") == sector]
    curve = [{"isin": r["isin"], "name": r.get("name"), "issuer": _issuer_title([r]),
              "kind": r.get("kind"), "tenor": _tenor(r), "spread_bp": _spread(r),
              "duration": r.get("duration_years"), "years": r.get("years_to_maturity"),
              "currency": (r.get("currency") or "RUB"),
              "g_spread_bp": r.get("g_spread_bp"), "spread_ofz_bp": r.get("spread_ofz_bp"),
              "sm_bp": r.get("simple_margin_bp"), "z_spread_bp": r.get("z_spread_bp"), "dm_ofz_bp": r.get("dm_ofz_bp"),
              "ytm": r.get("ytm"), "current_yield": r.get("current_yield"), "price": r.get("price"),
              "rating": r.get("agency_rating") or r.get("rating"),
              "bucket": r.get("agency_bucket") or r.get("rating_bucket"),
              "volume": _vol_rub(r), "reported": r["isin"] in reported}
             for r in rows + [r for r in all_rows if r["isin"] in reported and r not in rows] if _tenor(r)]

    peers: dict[str, list[dict]] = {}
    for r in rows:
        if r["isin"] in reported:
            continue
        peers.setdefault(_issuer_key(r), []).append(r)
    others = sorted(({"company": _issuer_title(v), "market": _agg_market(v)} for v in peers.values()),
                    key=lambda x: -(x["market"]["volume"] or 0))

    mk = [c["market"] for c in companies if c["market"]]
    sp = [m["spread_bp"] for m in mk if m.get("spread_bp") is not None]
    vol = sum((m.get("volume") or 0) for m in mk) + sum((o["market"].get("volume") or 0) for o in others)
    return {
        "key": key, "sector": sector, "file": data.get("file"),
        "periods": periods, "last_period": last, "item_periods": data.get("item_periods") or periods,
        "companies": companies, "curve": curve, "others": others,
        "kpi": {
            "reported": len(companies),
            "reported_msfo": sum(1 for c in companies if c["standard"] == "МСФО"),
            "reported_rsbu": sum(1 for c in companies if c["standard"] != "МСФО"),
            "with_bonds": sum(1 for c in companies if c["market"]),
            "issuers": sum(1 for c in companies if c["market"]) + len(others),
            "issues": sum((m.get("issues") or 0) for m in mk) + sum((o["market"].get("issues") or 0) for o in others),
            "volume": vol or None,
            "median_spread_bp": round(median(sp)) if sp else None,
        },
    }
