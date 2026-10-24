"""Отраслевая аналитика эмитентов. Первый сектор — застройщики.

Отчётность МСФО (8 публичных групп) приходит готовым разбором из
`services/data/issuers/developers/` — методология расчёта EBITDA, чистого долга за вычетом
эскроу и покрытия эскроу лежит там же (METHODOLOGY.md). Здесь мы только соединяем её с
рыночными данными Bonds AI: спред, дюрация, рейтинг, объём в обращении, график погашений.
Ничего не пересчитываем и не выдумываем — цифры отчётности отдаём как есть, помечая период.
"""
from __future__ import annotations

import json
import os
import re
from statistics import median
from typing import Optional

from sqlalchemy.orm import Session

from . import universe

_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "issuers", "developers")

# Компании с разобранной отчётностью → как их узнать в наших рыночных данных.
# Основной ключ — ISIN выпусков из архива (bondmap.json), имена — запасной вариант.
DEV_REPORTED: dict[str, tuple[str, ...]] = {
    "ПИК": ("пик-сз", "пик-корпорация", "пик к", "пик бо"),
    "Самолет": ("самолет",),
    "ЛСР": ("лср",),
    "Эталон": ("эталон",),
    "Сэтл": ("сэтл", "setl"),
    "Брусника": ("брусника",),
    "Глоракс": ("глоракс", "glorax"),
    "АПРИ": ("апри",),
    # вторая волна (отчётность разобрана 21.09.2026 по PDF из data/issuer-reports/msfo)
    "Легенда": ("легенда",),
    "Джи-групп": ("джи-групп", "джи-гр"),
    "А101": ("а101",),
    "ДАРС": ("дарс-девелопмент", "дарсдев"),        # просто «дарс» ловится в «гоСУДАРСтвенная»
    "РКС": ("тд ркс", "ркс девелопмент", "ркс2р", "ркс 2р"),
    "Элит Строй": ("элит строй", "элитстрой", "страна девелопмент"),
}

# Справочник отраслей («Девелопмент и недвижимость») шире рынка застройщиков: в нём сидят
# холдинги и торговые сети (АФК «Система», Магнит, ИКС 5, О'КЕЙ, РОСНАНО), лес (Сегежа),
# секьюритизация (ИА РТБ) и дорожники. Для отраслевой кривой берём только жилых девелоперов.
DEV_PEERS = ("легенда", "джи-групп", "а101", "дарс", "элит строй", "ркс", "охта",
             "а спэйс", "аспэк", "бизнес-лэнд", "корпсан", "страна", "инград", "гранель",
             "унистрой", "самолет", "пик", "лср", "эталон", "сэтл", "брусника", "глоракс", "апри")
# Соседние подотрасли — показываем отдельно, в кривую жилых девелоперов не мешаем
DEV_ADJACENT = {"инфраструктура и дороги": ("автодор", "автобан", "абз-1", "новосибирскавтодор",
                                            "сибавтотранс", "мостотрест"),
                "стройматериалы": ("верхнебаканский", "цемент", "кирпич")}

# Как наши группы называются в топе ЕРЗ (Единый ресурс застройщиков): там бренды, а не
# юрлица — Джи-групп строит под маркой «Унистрой», Элит Строй — «Страна Девелопмент»,
# ДАРС записан латиницей.
ERZ_ALIASES: dict[str, tuple[str, ...]] = {
    "ПИК": ("ПИК",), "Самолет": ("Самолет",), "ЛСР": ("ЛСР",), "Эталон": ("Эталон",),
    "Сэтл": ("Setl", "Сэтл"), "Брусника": ("Брусника",), "Глоракс": ("GloraX", "Глоракс"),
    "АПРИ": ("АПРИ",), "Легенда": ("LEGENDA", "Легенда"), "Джи-групп": ("Унистрой",),
    "А101": ("А101", "A101"), "ДАРС": ("DARS", "Дарс-Девелопмент"), "РКС": ("РКС Девелопмент",),
    "Элит Строй": ("Страна Девелопмент",),
}

_cache: dict = {}


def _load(name: str):
    """JSON с показателями; перечитываем, если файл изменился (пересобрали данные)."""
    path = os.path.join(_DIR, f"{name}.json")
    mtime = os.path.getmtime(path)
    hit = _cache.get(name)
    if not hit or hit[0] != mtime:
        with open(path, encoding="utf-8") as f:
            _cache[name] = (mtime, json.load(f))
    return _cache[name][1]


def methodology() -> str:
    try:
        with open(os.path.join(_DIR, "METHODOLOGY.md"), encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


_ORG = re.compile(r'^(ооо|оао|зао|пао|ао|гк|мкпао|группа компаний|группа)\s+', re.I)


def _issuer_key(r: dict) -> str:
    """Ключ эмитента. В снимке поле issuer у части выпусков — это название бумаги
    («А101, БО-001P-02», «А101 1P03», «Легенда, 002P-04»), поэтому режем хвост с номером
    серии: выкидываем слова с цифрами, кроме первого (иначе потеряется сам «А101»)."""
    nm = (r.get("issuer") or r.get("issuer_full") or r.get("name") or "").split(",")[0]
    nm = nm.replace("«", "").replace("»", "").replace('"', " ").strip().lower()
    nm = _ORG.sub("", nm).strip()
    out = []
    for i, w in enumerate(nm.split()):
        if i and (any(c.isdigit() for c in w) or w in ("бо", "бо-п", "п")):
            break
        out.append(w)
    return " ".join(out) or "—"


def _issuer_title(rows: list[dict]) -> str:
    """Имя группы для таблицы: берём название без номера серии выпуска. Из кандидатов
    («ООО "ЛЕГЕНДА"», «ЛЕГЕНДА БО 002Р-01») выбираем самое длинное среди «чистых»."""
    cands = []
    for r in rows:
        for nm in (r.get("issuer_full"), r.get("issuer")):
            if not nm:
                continue
            nm = nm.split(",")[0].replace("«", "").replace("»", "").strip()
            words = nm.replace('"', " ").split()
            clean = " ".join(w for i, w in enumerate(words)
                             if not (i and (any(c.isdigit() for c in w) or w.lower() in ("бо", "бо-п", "п"))))
            if clean:
                cands.append(clean.strip())
    if not cands:
        return "—"
    best = max(set(cands), key=lambda c: (cands.count(c), len(c)))
    return best


def _spread(r: dict) -> Optional[float]:
    """Сопоставимая премия: у фиксов — G-спред к КБД, у флоатеров — дисконт-маржа к ОФЗ-ПК."""
    return r.get("dm_ofz_bp") if r.get("kind") == "floater" else r.get("g_spread_bp")


def _tenor(r: dict) -> Optional[float]:
    if r.get("kind") == "floater":
        return r.get("years_to_maturity")
    return r.get("duration_years") or r.get("years_to_maturity")


def _vol_rub(r: dict) -> float:
    """Объём выпуска в рублях: у валютных бумаг issue_volume — в валюте номинала."""
    v = r.get("issue_volume") or 0
    ccy = (r.get("currency") or "RUB").upper()
    if v and ccy not in ("RUB", "SUR"):
        try:
            from . import moex
            v *= moex.get_fx_rates().get(ccy) or 0
        except Exception:  # noqa: BLE001
            return 0.0
    return v


def _agg_market(rows: list[dict]) -> dict:
    """Рыночный срез по набору выпусков одного эмитента."""
    sp = [_spread(r) for r in rows if _spread(r) is not None]
    te = [_tenor(r) for r in rows if _tenor(r) is not None]
    vol = sum(_vol_rub(r) for r in rows)
    fl = sum(1 for r in rows if r.get("kind") == "floater")
    dates = sorted(d for d in (r.get("offer_date") or r.get("matdate") for r in rows)
                   if d and not str(d).startswith("0000"))
    rated = next((r for r in rows if r.get("agency_rating")), None)
    return {
        "issues": len(rows), "volume": vol or None,
        "spread_bp": round(median(sp)) if sp else None,
        "spread_min_bp": round(min(sp)) if sp else None, "spread_max_bp": round(max(sp)) if sp else None,
        "tenor_years": round(median(te), 2) if te else None,
        "floaters": fl, "floater_share": round(100 * fl / len(rows)) if rows else None,
        # объём по типу ставки: сколько рыночного долга под фиксом, сколько под плавающей
        "volume_fixed": sum(_vol_rub(r) for r in rows if r.get("kind") != "floater") or None,
        "volume_floater": sum(_vol_rub(r) for r in rows if r.get("kind") == "floater") or None,
        "rating": (rated or {}).get("agency_rating"), "rating_bucket": (rated or {}).get("agency_bucket"),
        "rating_score": (rated or {}).get("rating_score"),      # числовая шкала: по ней сортируем, а не по тексту
        "rating_agency": (rated or {}).get("agency_name"), "rating_trend": (rated or {}).get("agency_trend"),
        "rating_forecast": (rated or {}).get("agency_forecast"),
        "next_payment": dates[0] if dates else None,
        "isins": [r["isin"] for r in rows],
    }


def _ratios(f: dict) -> dict:
    """Коэффициенты нагрузки из разобранной отчётности (EBITDA — унифицированная)."""
    eb = (f.get("eb") or {}).get("uni")
    r = {"ebitda": eb, "ebitda_rep": (f.get("eb") or {}).get("rep"),
         "revenue": f.get("revenue_ltm") or f.get("revenue"),
         "debt": f.get("debt_core") or f.get("debt"), "pf": f.get("pf"), "cash": f.get("cash"),
         "escrow": f.get("escrow"), "nd": f.get("nd"), "nd_esc": f.get("nd_esc"),
         "corp_nd": f.get("corp_nd"), "corp_debt": f.get("corp_debt"),
         "esc_cov": f.get("esc_cov"), "pf_share": f.get("pf_share"),
         "equity": f.get("equity"), "assets": f.get("assets"),
         "escrow_saving_rev": f.get("escrow_saving_rev")}
    if eb and eb > 0:
        r["lev_nd_esc"] = round(f["nd_esc"] / eb, 2) if f.get("nd_esc") is not None else None
        r["lev_corp"] = round(f["corp_nd"] / eb, 2) if f.get("corp_nd") is not None else None
        r["lev_nd"] = round(f["nd"] / eb, 2) if f.get("nd") is not None else None
        r["ebitda_margin"] = round(100 * eb / r["revenue"], 1) if r.get("revenue") else None
    # проектное финансирование раскрывают не все (Джи-групп — нет): без него ни покрытие
    # эскроу, ни корпоративный долг не считаются — ставим прочерк, а не ноль
    if f.get("pf") is None:
        r["pf_share"] = r["esc_cov"] = None        # без ПФ покрытие эскроу и его долю не считаем
        if f.get("corp_nd") is None:
            r["lev_corp"] = r["corp_nd"] = r["corp_debt"] = None
    r["corp_est"] = bool(f.get("corp_est"))        # корп. долг посчитан от банковских кредитов
    # Coverage uses flows for the same reporting period. Never substitute
    # capitalised interest (capint) or total finance costs for interest expense.
    interest = f.get("interest_exp_ltm") if f.get("base") == "LTM" else f.get("interest_exp")
    ebit = f.get("op_ltm") if f.get("base") == "LTM" else f.get("op")
    r["interest_exp"] = interest
    r["icr"] = round(eb / interest, 2) if eb is not None and interest is not None and interest > 0 else None
    r["icr_ebit"] = round(ebit / interest, 2) if ebit is not None and interest is not None and interest > 0 else None
    return r


_YEARS = ("2026", "2027", "2028", "2029", "2030", "2031+")


def _calendar_from_market(db: Session, isins: list[str]) -> dict:
    """Календарь погашений по годам (млн ₽) из наших рыночных данных — для компаний,
    которых нет в bondmap.json: амортизации на свои даты, погашение — остаток номинала,
    оферта — право инвестора предъявить бумагу."""
    cal = {k: {y: 0.0 for y in _YEARS} for k in ("red", "am", "puts")}
    try:
        events = universe.redemption_events(db, isins)
    except Exception:  # noqa: BLE001
        return cal
    for e in events:
        if not e.get("date") or e.get("type") == "coupon":     # календарь — только номинал
            continue
        y = e["date"][:4]
        y = y if y in _YEARS else ("2031+" if y >= "2031" else None)
        if not y:
            continue
        key = {"amort": "am", "offer": "puts"}.get(e["type"], "red")
        cal[key][y] += (e["amount"] or 0) / 1e6            # рубли → млн ₽
    return cal


def developers(db: Session) -> dict:
    """Сектор застройщиков: отчётность 8 групп + рынок их облигаций + отраслевая кривая."""
    all_rows = universe._all_rows(db)
    rows = [r for r in all_rows if (r.get("sector") or "") == "Девелопмент и недвижимость"]
    # выпуски компаний с отчётностью ищем по всему рынку: у части бумаг отрасль не проставлена
    by_isin = {r["isin"]: r for r in all_rows}

    def nm_of(r: dict) -> str:
        return ((r.get("issuer") or "") + " " + (r.get("issuer_full") or "") + " " + (r.get("name") or "")).lower()

    bondmap = _load("bondmap")
    fund = {(x["company"], x["period"]): x for x in _load("rows")}
    periods = sorted({x["period"] for x in _load("rows")})
    last_period = periods[-1]

    try:
        from . import erz
        erz_map = erz.by_company(ERZ_ALIASES)
    except Exception as e:  # noqa: BLE001
        log.warning("ЕРЗ недоступен: %s", e)
        erz_map = {}
    try:                                   # география стройки: метры по субъектам РФ
        from . import erz_regions
        geo = erz_regions.by_company(ERZ_ALIASES)
    except Exception as e:  # noqa: BLE001
        log.warning("ЕРЗ по регионам недоступен: %s", e)
        geo = {"by_company": {}, "regions": {}}

    reported_isins: set[str] = set()
    companies = []
    for name, aliases in DEV_REPORTED.items():
        isins = [x["isin"] for x in (bondmap.get(name, {}).get("rows") or []) if x.get("isin")]
        bl = [by_isin[i] for i in isins if i in by_isin]
        if not bl:                                   # запасной путь — по имени эмитента
            bl = [r for r in rows if any(a in nm_of(r) for a in aliases)]
        reported_isins |= {r["isin"] for r in bl}
        f_last = fund.get((name, last_period)) or {}
        cal = {k: v for k, v in (bondmap.get(name) or {}).items() if k != "rows"}
        if not cal and bl:
            cal = _calendar_from_market(db, [r["isin"] for r in bl])
        companies.append({
            "company": name, "full": f_last.get("full") or (_issuer_title(bl) if bl else None),
            "ticker": f_last.get("ticker"),
            "period": last_period, "rating_report": f_last.get("rating"), "eb_note": f_last.get("eb_note"),
            "fin": {p: _ratios(fund[(name, p)]) for p in periods if (name, p) in fund},
            "market": _agg_market(bl) if bl else None,
            "bond_calendar": cal,
            "erz": erz_map.get(name),          # стройка по данным ЕРЗ: объём, перенос сроков, ЖК
            "erz_geo": (geo.get("by_company") or {}).get(name),   # где именно строит: метры по регионам
        })

    def group_of(r: dict) -> str:
        nm = nm_of(r)
        for grp, keys in DEV_ADJACENT.items():
            if any(k in nm for k in keys):
                return grp
        return "жилые девелоперы" if any(k in nm for k in DEV_PEERS) else "прочее"

    dev_rows = [r for r in rows if group_of(r) == "жилые девелоперы"]
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
             for r in dev_rows if _tenor(r)]

    peers: dict[str, list[dict]] = {}
    for r in dev_rows:
        if r["isin"] in reported_isins:
            continue
        peers.setdefault(_issuer_key(r), []).append(r)
    others = sorted(({"company": _issuer_title(v), "market": _agg_market(v)} for v in peers.values()),
                    key=lambda x: -(x["market"]["volume"] or 0))

    sp = [c["market"]["spread_bp"] for c in companies if c["market"] and c["market"]["spread_bp"] is not None]
    return {
        "sector": "Девелопмент (жилое строительство)",
        "as_of": "2026-09-21",                 # дата разбора отчётности из архива
        "periods": periods, "last_period": last_period,
        "companies": companies, "history": _load("hist"), "series": _load("series"),
        "curve": curve, "others": others,
        "erz_regions": {"regions": geo.get("regions") or {}, "as_of": geo.get("as_of"),
                        "fetched_at": geo.get("fetched_at")},
        "kpi": {
            "reported": sum(1 for c in companies if c["fin"]),
            # эмитенты считаются так же, как показаны на странице: группы с отчётностью плюс
            # прочие. По ключу эмитента одна группа даёт несколько юрлиц (ПИК-СЗ и ПИК-Корпорация)
            "issuers": sum(1 for c in companies if c["market"]) + len(others), "issues": len(dev_rows),
            "volume": sum(_vol_rub(r) for r in dev_rows) or None,
            "median_spread_bp": round(median(sp)) if sp else None,
        },
    }
