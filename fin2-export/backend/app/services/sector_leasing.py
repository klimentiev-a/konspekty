"""Сектор лизинга: кредитный профиль эмитентов с разобранной отчётностью + рынок их облигаций.

Отчётность МСФО трёх компаний (Европлан, Балтийский лизинг, Интерлизинг) приходит готовым
разбором в `services/data/issuers/leasing/lease.json`; методология расчёта (NIM, CIR, COR,
доля проблемных активов, покрытие стадии 3) лежит рядом в METHODOLOGY.md. Здесь мы ничего
не пересчитываем — только соединяем показатели с рыночными данными Bonds AI: премия,
дюрация, рейтинг, объём в обращении, кривая сектора и календарь погашений.

Лизинг устроен не как девелопмент: это финансовая компания, у неё нет EBITDA и эскроу, а
кредитное качество читается через маржу (NIM), эффективность (CIR), стоимость риска (COR),
качество портфеля (стадия 3, изъятое имущество) и структуру фондирования.
"""
from __future__ import annotations

import json
import os
from statistics import median

from sqlalchemy.orm import Session

from . import girbo, universe
from .sectors import (_agg_market, _calendar_from_market, _issuer_key, _issuer_title,
                      _spread, _tenor, _vol_rub)

_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "issuers", "leasing")
SECTOR_NAME = "Лизинг"

# Компании с разобранной отчётностью → как их узнать в рыночных данных.
LEASE_REPORTED: dict[str, tuple[str, ...]] = {
    "Европлан": ("европлан",),
    "Балтийский лизинг": ("балтийский лизинг", "балтлиз"),
    "Интерлизинг": ("интерлизинг",),
}

# Полные названия юрлиц — для подписи под группой в таблице.
LEASE_FULL = {
    "Европлан": "ПАО «ЛК «Европлан»",
    "Балтийский лизинг": "ООО «Балтийский лизинг»",
    "Интерлизинг": "ООО «Интерлизинг»",
}

_cache: dict = {}


def _inn_map() -> dict:
    """{эмитент в рыночных данных: ИНН} — сопоставление для ГИР БО."""
    path = os.path.join(_DIR, "inn.json")
    mtime = os.path.getmtime(path)
    if _cache.get("inn_mtime") != mtime:
        with open(path, encoding="utf-8") as f:
            _cache["inn"], _cache["inn_mtime"] = json.load(f), mtime
    return _cache["inn"]


def _load() -> dict:
    """Показатели из архива; перечитываем, если файл обновился.

    lease_full.json — это lease.json плюс компании, разобранные со сканов основных форм
    (scripts/lease_merge.py). Если сборки ещё нет, работаем на исходных трёх группах."""
    path = os.path.join(_DIR, "lease_full.json")
    if not os.path.exists(path):
        path = os.path.join(_DIR, "lease.json")
    mtime = os.path.getmtime(path)
    if _cache.get("mtime") != mtime:
        with open(path, encoding="utf-8") as f:
            _cache["data"], _cache["mtime"] = json.load(f), mtime
    return _cache["data"]


def rsbu_reference() -> dict:
    """РСБУ по кодам строк из сводной таблицы сектора: 16 компаний, 2021 — 6м2026.

    ГИР БО даёт годовые формы машинно, но не все компании и не полугодие; здесь тот же
    состав строк, снятый со сканов раскрытия и сверенный арифметикой форм."""
    try:
        with open(os.path.join(_DIR, "rsbu_ref.json"), encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    # считаем показатели: у РСБУ нет NIM и стадий, считается то, что считается
    for pers in (data.get("companies") or {}).values():
        order = sorted(pers, key=lambda x: (x[-4:], x))
        prev = None
        for per in order:
            r = pers[per]
            half = per.startswith("6м")
            ann = 2.0 if half else 1.0
            eq, assets, debt = r.get("eq"), r.get("assets"), r.get("debt")
            if debt is not None and eq and eq > 0:
                r["de"] = round(debt / eq, 2)
            if eq is not None and assets:
                r["eqa"] = round(100 * eq / assets, 1)
            ni = r.get("profit")
            if ni is not None:
                aeq = (eq + prev["eq"]) / 2 if (prev and prev.get("eq") is not None and eq is not None) else eq
                if aeq and aeq > 0 and eq and eq > 0:
                    r["roe"] = round(100 * ni * ann / aeq, 1)
                aas = (assets + prev["assets"]) / 2 if (prev and prev.get("assets") and assets) else assets
                if aas:
                    r["roa"] = round(100 * ni * ann / aas, 1)
                if r.get("revenue"):
                    r["margin"] = round(100 * ni / r["revenue"], 1)
            if r.get("interest") and r.get("revenue"):
                r["int_rev"] = round(100 * abs(r["interest"]) / r["revenue"], 1)
            if r.get("interest") and r.get("pbt") is not None:
                r["int_cov"] = round((r["pbt"] + abs(r["interest"])) / abs(r["interest"]), 2)
            prev = r
    return data


def rsbu_interim() -> dict:
    """Промежуточная бухгалтерская отчётность эмитентов за 6м2026 (сняли со сканов раскрытия).

    ГИР БО публикует только годовые формы, поэтому полугодие приходится брать из архива
    раскрытия: там это скан формы 0710001 без текстового слоя."""
    try:
        with open(os.path.join(_DIR, "rsbu_interim.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def market_overview() -> dict:
    """Рынок лизинга целиком — внешняя рамка к нашим эмитентам (исследования Эксперт РА)."""
    try:
        with open(os.path.join(_DIR, "market.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def methodology() -> str:
    try:
        with open(os.path.join(_DIR, "METHODOLOGY.md"), encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


# что показываем в таблице и карточке: только величины из архива, без наших пересчётов
_FIN_KEYS = ("nim", "yld", "cof", "spread", "cir", "roe", "roa", "cor", "cor_full",
             "s3_sh", "s3_cov", "repo_sh", "prob_sh", "allow_sh", "nonint_sh", "cr_ppop",
             "de", "nde", "dnil", "eqa", "bond_sh", "bank_sh", "oth_sh", "opex_nil",
             "nil", "nil_g", "eq", "assets", "cash", "debt", "bank", "bonds", "oth",
             "s3", "repo", "term", "sub", "allow", "nii", "noni", "opinc", "opex",
             "cr_nil", "cr_oth", "ni", "ppop")


def _fin(p: dict) -> dict:
    out = {k: p.get(k) for k in _FIN_KEYS}
    for k in ("nim", "cir", "roe", "roa", "cor", "cor_full", "s3_sh", "s3_cov", "prob_sh",
              "repo_sh", "allow_sh", "nonint_sh", "dnil", "eqa", "bond_sh", "bank_sh",
              "oth_sh", "yld", "cof", "spread", "opex_nil", "cr_ppop"):
        if out.get(k) is not None:
            out[k] = round(out[k], 2)
    for k in ("de", "nde"):
        if out.get(k) is not None:
            out[k] = round(out[k], 2)
    return out


def leasing(db: Session) -> dict:
    """Кредитный профиль лизинговых компаний: отчётность + рынок их облигаций."""
    data = _load()
    reported = dict(LEASE_REPORTED)
    full = dict(LEASE_FULL)
    notes: dict[str, str] = {}
    for name, meta in (data.get("extra_companies") or {}).items():
        reported[name] = tuple(meta.get("aliases") or (name.lower(),))
        full[name] = meta.get("full") or name
        if meta.get("note"):
            notes[name] = meta["note"]
    periods = list(data.get("periods") or [])
    last_period = periods[-1] if periods else None

    all_rows = universe._all_rows(db)
    rows = [r for r in all_rows if (r.get("sector") or "") == SECTOR_NAME]

    def nm_of(r: dict) -> str:
        return ((r.get("issuer") or "") + " " + (r.get("issuer_full") or "") + " " + (r.get("name") or "")).lower()

    reported_isins: set[str] = set()
    companies = []
    for name, aliases in reported.items():
        # выпуски ищем по всему рынку: у части бумаг отрасль не проставлена
        bl = [r for r in all_rows if any(a in nm_of(r) for a in aliases)]
        reported_isins |= {r["isin"] for r in bl}
        fin = {p: _fin(v) for p, v in (data["data"].get(name) or {}).items()}
        companies.append({
            "company": name,
            "full": full.get(name) or (_issuer_title(bl) if bl else None),
            "note": notes.get(name),
            "period": last_period,
            "fin": fin,
            "own": (data.get("own") or {}).get(name) or {},   # как считает сама компания
            "market": _agg_market(bl) if bl else None,
            "bond_calendar": _calendar_from_market(db, [r["isin"] for r in bl]) if bl else {},
            "rsbu": {}, "inn": None,
        })

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

    # все эмитенты сектора: рынок + бухгалтерская отчётность из ГИР БО по ИНН
    inn_map = _inn_map()
    gir = girbo.load().get("companies") or {}
    by_inn = {str(v.get("inn")): v.get("years") or {} for v in gir.values() if v.get("inn")}

    by_eid = {str(v.get("emitent_id")): v.get("inn") for v in inn_map.values() if v.get("emitent_id")}

    def _rsbu_for(bl: list[dict]) -> tuple[dict, str | None]:
        """Годовая РСБУ-отчётность эмитента. Сопоставляем по идентификатору эмитента
        на бирже — он надёжнее названия, которое у части выпусков записано по-разному."""
        inns = {by_eid.get(str(r.get("emitent_id"))) for r in bl if r.get("emitent_id")}
        inns |= {(inn_map.get((r.get("issuer") or "").split(",")[0]) or {}).get("inn") for r in bl}
        for inn in [i for i in inns if i]:
            years = by_inn.get(str(inn))
            if years:
                return {y: girbo.metrics(v) for y, v in years.items()}, inn
        return {}, None

    peers: dict[str, list[dict]] = {}
    for r in rows:
        if r["isin"] in reported_isins:
            continue
        peers.setdefault(_issuer_key(r), []).append(r)
    others = []
    for v in peers.values():
        rsbu, inn = _rsbu_for(v)
        others.append({"company": _issuer_title(v), "market": _agg_market(v), "rsbu": rsbu, "inn": inn})
    others.sort(key=lambda x: -(x["market"]["volume"] or 0))

    for c in companies:                         # РСБУ и для трёх групп с разобранным МСФО
        bl = [r for r in rows if r["isin"] in (c["market"] or {}).get("isins", [])]
        c["rsbu"], c["inn"] = _rsbu_for(bl) if bl else ({}, None)

    sp = [c["market"]["spread_bp"] for c in companies if c["market"] and c["market"]["spread_bp"] is not None]
    return {
        "sector": "Лизинг",
        "as_of": "2026-09-21",                  # дата разбора отчётности из архива
        "periods": periods, "last_period": last_period,
        "companies": companies, "series": data.get("data") or {}, "order": data.get("order") or [],
        "curve": curve, "others": others,
        "rsbu_years": sorted({y for o in others for y in (o.get("rsbu") or {})}),
        "rsbu_source": "ГИР БО ФНС · годовая бухгалтерская отчётность",
        "market_overview": market_overview(),
        "rsbu_interim": rsbu_interim(),
        "rsbu_ref": rsbu_reference(),
        "kpi": {
            "reported": sum(1 for c in companies if c["fin"]),
            "issuers": sum(1 for c in companies if c["market"]) + len(others), "issues": len(rows),
            "volume": sum(_vol_rub(r) for r in rows) or None,
            "median_spread_bp": round(median(sp)) if sp else None,
        },
    }
