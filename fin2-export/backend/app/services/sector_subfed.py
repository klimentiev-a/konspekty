"""Сектор субфедеральных эмитентов: бюджеты регионов и городов + рынок их облигаций.

Бюджетные данные приходят разбором в `services/data/issuers/subfed/budgets.json` (доходы,
расходы, обслуживание долга, госдолг и его структура за 2021 — 6м2026). Источники —
пресс-релизы «Эксперт РА», законы об исполнении бюджетов и сайты финорганов регионов,
поэтому покрытие неровное: пустая клетка означает, что величина в открытых источниках не
найдена, а не ноль. Здесь мы считаем коэффициенты и соединяем их с нашими рыночными
данными: премия, дюрация, рейтинг, объём выпусков в обращении, календарь погашений.

Регион — не компания: у него нет EBITDA и капитала. Долговая устойчивость субъекта читается
через отношение долга к собственным (налоговым и неналоговым) доходам — именно так
Минфин России делит субъекты на группы долговой устойчивости, — через дефицит бюджета,
зависимость от трансфертов и долю рыночного долга (облигации и банковские кредиты против
дешёвых бюджетных кредитов).
"""
from __future__ import annotations

import json
import os
import re
from statistics import median

from sqlalchemy.orm import Session

from . import federal, universe
from .sectors import (_agg_market, _calendar_from_market, _issuer_title, _spread, _tenor, _vol_rub)

_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "issuers", "subfed")

# Как эмитента зовут в наших рыночных данных: у части выпусков в поле «эмитент» стоит
# финорган («Комитет финансов», «МФ и НП НСО», «Минфин КК»), а полное имя субъекта —
# в issuer_full или в названии бумаги. Ищем по всем трём полям.
SUBFED_ALIASES: dict[str, tuple[str, ...]] = {
    "город Москва": ("москв",),          # «Правительство Москвы…», «Гор.Обл.Займ Москвы»
    "Санкт-Петербург": ("санкт-петербург", "спбго"),
    "Московская область": ("московская область", "мэф московской", "мособ"),
    "Новосибирская область": ("новосибирская область", "мф и нп нсо", "новосиб"),
    "Нижегородская область": ("нижегородская область", "минфин нижегородской"),
    "Ярославская область": ("ярославская область", "ярославск"),
    "Томская область": ("томская область", "томскобл", "томоб"),
    "город Томск": ("города томска", "г. томск", "томск гор"),
    "Ульяновская область": ("ульяновская область", "минфин ульяновской"),
    "Свердловская область": ("свердловская область", "министерство финансов свердловской"),
    "Челябинская область": ("челябинская область", "минфин челябинской"),
    "Самарская область": ("самарская область",),
    "Ростовская область": ("ростовская область", "рособ"),
    "Калининградская область": ("калининградская область", "министерство финансов калининградской"),
    "Амурская область": ("амурская область",),
    "Магаданская область": ("магаданская область", "минфин магаданской"),
    "Оренбургская область": ("оренбургская область", "минфин оренбургской"),
    "Республика Саха (Якутия)": ("саха", "якути"),
    "Республика Башкортостан": ("башкортостан",),
    "Удмуртская Республика": ("удмурт",),
    "Ханты-Мансийский автономный округ — Югра": ("ханты-мансийск", "югра"),
    "Ямало-Ненецкий автономный округ": ("ямало-ненецк", "янао"),
    "Красноярский край": ("красноярский край",),
    "Краснодарский край": ("краснодарский край", "минфин кк"),
    "Ставропольский край": ("ставропольский край",),
}

# что считается субфедеральным выпуском: субъект или город, но не ОФЗ, институты развития
# и не иностранные государства
_REGION = re.compile(r"(област|край|республик|округ|город|москв|санкт-петербург|якути|башкортостан|"
                     r"удмурт|чуваш|татарстан|коми|карели|хакаси|бурят|тыва|калмыки|мордови|марий|"
                     r"адыге|дагестан|ингушети|осети|кабардино|карачаево|чечен|алтай|камчат|хабаров|"
                     r"примор|сахалин|магадан|амурск|еврейск|чукот|ненецк|югра|ямал|мэф|минфин|мф и нп|"
                     r"комитет финансов|департамент финансов)", re.I)
_NOT_REGION = re.compile(r"(дом\.рф|вэб|минфин росси|россия|ипотечный агент|сопф|казахстан|беларус|"
                         r"нижегородец|ооо|оао|пао|зао|банк)", re.I)

_cache: dict = {}


def _load() -> dict:
    path = os.path.join(_DIR, "budgets.json")
    mtime = os.path.getmtime(path)
    if _cache.get("mtime") != mtime:
        with open(path, encoding="utf-8") as f:
            _cache["data"], _cache["mtime"] = json.load(f), mtime
    return _cache["data"]


def _nm(r: dict) -> str:
    return ((r.get("issuer") or "") + " " + (r.get("issuer_full") or "") + " " + (r.get("name") or "")).lower()


def is_subfed(r: dict) -> bool:
    nm = _nm(r)
    return bool(_REGION.search(nm)) and not _NOT_REGION.search(nm)


def _ratios(p: dict) -> dict:
    """Коэффициенты бюджета. Потоки за полугодие с годовыми не сравниваем, поэтому
    отношения к доходам и расходам за 6м не считаются — только структура долга."""
    inc, own, gr, exp = p.get("inc"), p.get("own"), p.get("grants"), p.get("exp")
    svc, bal, debt = p.get("svc"), p.get("bal"), p.get("debt")
    bonds, bl, bank = p.get("bonds"), p.get("budget_loans"), p.get("bank_loans")
    r = dict(p)
    r["debt_own"] = round(debt / own, 3) if (debt is not None and own) else None
    r["bal_inc"] = round(100 * bal / inc, 1) if (bal is not None and inc) else None
    r["grants_share"] = round(100 * gr / inc, 1) if (gr is not None and inc) else None
    r["svc_exp"] = round(100 * svc / exp, 2) if (svc is not None and exp) else None
    r["svc_own"] = round(100 * svc / own, 2) if (svc is not None and own) else None
    r["bonds_share"] = round(100 * bonds / debt, 1) if (bonds is not None and debt) else None
    r["budget_share"] = round(100 * bl / debt, 1) if (bl is not None and debt) else None
    r["bank_share"] = round(100 * bank / debt, 1) if (bank is not None and debt) else None
    # рыночный долг — облигации и банковские кредиты: по ним ставка рыночная, в отличие
    # от бюджетных кредитов под 0,1% годовых
    if debt and bonds is not None and bank is not None:
        r["market_share"] = round(100 * (bonds + bank) / debt, 1)
    else:
        r["market_share"] = None
    r["filled"] = sum(1 for k in ("inc", "own", "grants", "exp", "svc", "bal", "debt",
                                  "bonds", "budget_loans", "bank_loans", "guarantees")
                      if p.get(k) is not None)
    r["src"] = p.get("src") or {}           # откуда взята каждая величина
    return r


def subfed(db: Session) -> dict:
    data = _load()
    periods = list(data.get("periods") or [])
    last_period = periods[-1] if periods else None
    all_rows = universe._all_rows(db)
    rows = [r for r in all_rows if is_subfed(r)]

    reported_isins: set[str] = set()
    companies = []
    for name in data.get("order") or []:
        aliases = SUBFED_ALIASES.get(name, (name.lower(),))
        bl = [r for r in rows if any(a in _nm(r) for a in aliases)]
        reported_isins |= {r["isin"] for r in bl}
        fin = {p: _ratios(v) for p, v in (data["data"].get(name) or {}).items()}
        companies.append({
            "company": name, "full": None,
            "period": last_period, "fin": fin,
            "sources": (data.get("sources") or {}).get(name) or [],
            "notes": (data.get("notes") or {}).get(name) or {},
            "market": _agg_market(bl) if bl else None,
            "bond_calendar": _calendar_from_market(db, [r["isin"] for r in bl]) if bl else {},
        })

    # федеральный слой: бюджет и внутренний долг РФ плюс рынок ОФЗ
    ofz_rows = [r for r in all_rows
                if re.search(r"\b(офз|гсо)\b", (r.get("name") or "").lower())
                or "минфин росси" in ((r.get("issuer") or "") + (r.get("issuer_full") or "")).lower()]
    fed = {"periods": federal.by_period(), "market": _agg_market(ofz_rows) if ofz_rows else None,
           "source_budget": "Минфин России · исполнение федерального бюджета",
           "source_debt": "Минфин России · структура государственного внутреннего долга"}

    curve = [{"isin": r["isin"], "name": r.get("name"), "issuer": _issuer_title([r]),
              "kind": r.get("kind"), "tenor": _tenor(r), "spread_bp": _spread(r),
              "duration": r.get("duration_years"), "years": r.get("years_to_maturity"),
              "currency": (r.get("currency") or "RUB"),
              "g_spread_bp": r.get("g_spread_bp"), "spread_ofz_bp": r.get("spread_ofz_bp"),
              "sm_bp": r.get("simple_margin_bp"), "z_spread_bp": r.get("z_spread_bp"), "dm_ofz_bp": r.get("dm_ofz_bp"),
              "ytm": r.get("ytm"), "current_yield": r.get("current_yield"), "price": r.get("price"),
              "rating": r.get("agency_rating") or r.get("rating"),
              "bucket": r.get("agency_bucket") or r.get("rating_bucket"),
              "volume": _vol_rub(r), "reported": r["isin"] in reported_isins}
             for r in rows if _tenor(r)]
    # ОФЗ добавляем на кривую отдельной группой — как безрисковый ориентир для регионов
    curve += [{"isin": r["isin"], "name": r.get("name"), "issuer": "Минфин России (ОФЗ)",
               "kind": r.get("kind"), "tenor": _tenor(r), "spread_bp": _spread(r),
               "duration": r.get("duration_years"), "years": r.get("years_to_maturity"),
               "currency": (r.get("currency") or "RUB"),
               "g_spread_bp": r.get("g_spread_bp"), "spread_ofz_bp": r.get("spread_ofz_bp"),
               "sm_bp": r.get("simple_margin_bp"), "z_spread_bp": r.get("z_spread_bp"), "dm_ofz_bp": r.get("dm_ofz_bp"),
               "ytm": r.get("ytm"), "current_yield": r.get("current_yield"), "price": r.get("price"),
               "rating": None, "bucket": None, "volume": _vol_rub(r), "reported": False, "ofz": True}
              for r in ofz_rows if _tenor(r) and (r.get("kind") in ("fixed", "floater"))]

    peers: dict[str, list[dict]] = {}
    for r in rows:
        if r["isin"] in reported_isins:
            continue
        peers.setdefault((r.get("issuer_full") or r.get("issuer") or r.get("name") or "—").split(",")[0], []).append(r)
    others = sorted(({"company": re.sub(r"\s*\d+(\s+обл\.)?$", "", k).strip(), "market": _agg_market(v)}
                     for k, v in peers.items()),
                    key=lambda x: -(x["market"]["volume"] or 0))

    sp = [c["market"]["spread_bp"] for c in companies if c["market"] and c["market"]["spread_bp"] is not None]
    return {
        "sector": "Субфедеральные эмитенты",
        "as_of": data.get("as_of"),
        "about": data.get("about") or [],
        "periods": periods, "last_period": last_period,
        "companies": companies, "order": data.get("order") or [], "federal": fed,
        "sources_note": data.get("sources_note"),
        "series": data.get("data") or {},
        "curve": curve, "others": others,
        "kpi": {
            "reported": sum(1 for c in companies if c["fin"]),
            "issuers": sum(1 for c in companies if c["market"]) + len(others), "issues": len(rows),
            "volume": sum(_vol_rub(r) for r in rows) or None,
            "median_spread_bp": round(median(sp)) if sp else None,
        },
    }
