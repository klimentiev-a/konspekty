"""Portfolio cash-flow calendar projected under a CBR key-rate TRAJECTORY.

For each holding we pull the MOEX bondization schedule and:
  * FIXED coupons / amortizations → use the announced rouble amounts;
  * FLOATER coupons not yet fixed → project (key-rate at the period + quoted
    margin), exactly like the sandbox scenario, so a rate path reshapes the whole
    portfolio's future income. Every event is tagged MOEX-exact vs projected.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import BondRating, MoexSecurity, Position
from . import moex


def _key_fn(rate_path: list[dict]):
    pts = sorted((datetime.strptime(p["date"], "%Y-%m-%d").date(), float(p["rate"]))
                 for p in (rate_path or []) if p.get("date") and p.get("rate") is not None)

    def key_at(d: date):
        r = pts[0][1] if pts else None
        for pd, pr in pts:
            if pd <= d:
                r = pr
            else:
                break
        return r
    return key_at


_RUB_CCY = {None, "", "RUB", "SUR", "RUR"}


def cashflows_scenario(db: Session, pid, rate_path: list[dict], ccy=None) -> dict:
    pids = list(pid) if isinstance(pid, (list, tuple, set)) else [pid]
    positions = db.scalars(select(Position).where(Position.portfolio_id.in_(pids))).all()
    secs = {s.isin: s for s in db.scalars(select(MoexSecurity)).all()}
    if ccy not in (None, "", "all"):
        def _keep(p):
            s = secs.get(p.isin)
            c = (s.faceunit if s and s.faceunit else None) or p.currency or "RUB"
            return (c in _RUB_CCY) if ccy == "rub" else (c not in _RUB_CCY) if ccy == "fx" else (c == ccy)
        positions = [p for p in positions if _keep(p)]
    ratings = {r.isin: r for r in db.scalars(select(BondRating)).all()}
    key_at = _key_fn(rate_path)
    today = date.today()
    fx = moex.get_fx_rates()      # для перевода оферт валютных бумаг в ₽

    coupon_m: dict[str, float] = defaultdict(float)
    nominal_m: dict[str, float] = defaultdict(float)
    events: list[dict] = []       # только реальные потоки: купоны + амортизации/погашения
    offers: list[dict] = []       # оферты — отдельно (индикативно, НЕ суммируются в выплаты)
    projected_isins: set[str] = set()

    # Префетч reference + графика купонов ПАРАЛЛЕЛЬНО (это сетевые вызовы MOEX и
    # были главным тормозом «важных дат»). resolve/bondization кэшируются на 30 мин,
    # поэтому повторные пересчёты сценария идут из кэша почти мгновенно.
    from concurrent.futures import ThreadPoolExecutor

    today_iso = today.isoformat()

    def _fetch_bz(isin: str):
        sec = secs.get(isin)
        try:                                   # secid/board уже в БД → resolve не нужен
            return isin, moex.get_bondization(sec.secid or isin, sec.board)
        except moex.MoexError:
            return isin, None
    uniq = {p.isin for p in positions if secs.get(p.isin) and ((p.quantity or 0) - (p.sell_quantity or 0)) > 0}
    fetched: dict = {}
    if uniq:
        with ThreadPoolExecutor(max_workers=min(12, len(uniq))) as ex:
            fetched = dict(ex.map(_fetch_bz, uniq))

    # Точную классификацию флоатера (bond_type/benchmark) берём из reference — но
    # ТОЛЬКО для бумаг с незафиксированным будущим купоном (их единицы). У полностью
    # фиксированных бумаг проекции не бывает, resolve не нужен → быстро.
    def _has_unfixed(bz):
        return bz and any((c.get("valueprc") is None) and c.get("date") and c["date"] > today_iso
                          for c in bz.get("coupons", []))
    cand = {i for i, bz in fetched.items() if _has_unfixed(bz)}

    def _fetch_ref(isin: str):
        try:
            return isin, moex.resolve_security(isin)
        except moex.MoexError:
            return isin, None
    refs: dict = {}
    if cand:
        with ThreadPoolExecutor(max_workers=min(12, len(cand))) as ex:
            refs = dict(ex.map(_fetch_ref, cand))

    for pos in positions:
        sec = secs.get(pos.isin)
        qty = (pos.quantity or 0) - (pos.sell_quantity or 0)     # open lot only
        if not sec or qty <= 0:
            continue
        disp_name = (sec.shortname if sec and sec.shortname else None) or pos.name or pos.isin
        face = sec.facevalue or 1000.0
        fu = (sec.faceunit or "RUB").upper()
        rate = fx.get("RUB" if fu in ("SUR", "RUR") else fu, 1.0)   # номинал в валюте → ₽
        bz = fetched.get(pos.isin)
        if bz is None:
            continue
        ref = refs.get(pos.isin) or {}
        is_float = (ref.get("bond_type") or "").lower().startswith("флоат") \
            or bool(ref.get("coupon_benchmark"))
        qm = None
        rt = ratings.get(pos.isin)
        if is_float:
            qm = (rt.float_add if rt else None) or ref.get("coupon_benchmark_spread")

        prev = today
        for c in bz.get("coupons", []):
            d = c.get("date")
            if not d or d == "0000-00-00":
                prev = _as_date(d) or prev
                continue
            cd = _as_date(d)
            if cd is None:
                continue
            if cd <= today:
                prev = cd
                continue
            fixed = c.get("valueprc") is not None and c.get("value")
            if fixed:
                amt = (c.get("value_rub") or c.get("value") or 0) * qty
                src = "moex"
            elif is_float and qm is not None:
                kr = key_at(prev)
                if kr is None:
                    prev = cd
                    continue
                days = (cd - prev).days or 30
                amt = (kr + qm) / 100.0 * days / 365.0 * face * qty
                src = "projected"
                projected_isins.add(pos.isin)
            else:
                prev = cd
                continue
            coupon_m[d[:7]] += amt
            events.append({"date": d, "amount": round(amt, 2), "coupon": round(amt, 2),
                           "nominal": 0.0, "type": "coupon", "name": disp_name,
                           "isin": pos.isin, "source": src})
            prev = cd

        for a in bz.get("amortizations", []):
            d, amt = a.get("date"), a.get("value_rub") or a.get("value")
            if d and amt and d > today.isoformat():
                v = amt * qty
                nominal_m[d[:7]] += v
                is_final = (a.get("valueprc") or 0) >= 100 or d == (sec.matdate or "")
                events.append({"date": d, "amount": round(v, 2), "coupon": 0.0,
                               "nominal": round(v, 2), "type": "maturity" if is_final else "amortization",
                               "name": disp_name, "isin": pos.isin, "source": "moex"})

        for o in bz.get("offers", []):
            d = o.get("date")
            if d and d > today.isoformat():
                v = face * qty * rate      # индикативный номинал к оферте, в ₽
                # оферта — НЕ денежный поток (номинал уже учтён в погашении); только справочно
                offers.append({"date": d, "amount": round(v, 2), "coupon": 0.0, "nominal": round(v, 2),
                               "type": "offer", "offer_type": (o.get("offer_type") or o.get("type") or "put"),
                               "name": disp_name, "isin": pos.isin, "source": "moex"})

    events.sort(key=lambda e: e["date"])
    months = sorted(set(coupon_m) | set(nominal_m))
    # разбивка каждого месяца по выпускам (для подсказки при наведении)
    detail: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(lambda: {"coupon": 0.0, "nominal": 0.0, "isin": ""}))
    for e in events:
        di = detail[e["date"][:7]][e["name"]]
        di["coupon"] += e.get("coupon", 0) or 0
        di["nominal"] += e.get("nominal", 0) or 0
        di["isin"] = e.get("isin", "")

    def _items(m):
        out = [{"name": n, "isin": v["isin"], "coupon": round(v["coupon"], 2), "nominal": round(v["nominal"], 2)}
               for n, v in detail.get(m, {}).items()]
        return sorted(out, key=lambda x: x["coupon"] + x["nominal"], reverse=True)[:10]

    by_month = [{"month": m, "coupon": round(coupon_m.get(m, 0), 2),
                 "nominal": round(nominal_m.get(m, 0), 2),
                 "amount": round(coupon_m.get(m, 0) + nominal_m.get(m, 0), 2),
                 "items": _items(m)} for m in months]
    horizons = []
    for label, days in [("30 дней", 30), ("90 дней", 90), ("1 год", 365), ("Весь срок", None)]:
        cutoff = (today + timedelta(days=days)).isoformat() if days else "9999"
        sub = [e for e in events if e["date"] <= cutoff]
        horizons.append({"label": label, "total": round(sum(e["amount"] for e in sub)),
                         "coupon": round(sum(e["coupon"] for e in sub)),
                         "nominal": round(sum(e["nominal"] for e in sub)),
                         "projected": round(sum(e["amount"] for e in sub if e["source"] == "projected"))})
    # «Важные даты» — купоны / оферты / погашения, каждая с суммой и списком
    def _grp(items, pred=None):
        sub = sorted([e for e in items if pred is None or pred(e)], key=lambda e: e["date"])
        return {"total": round(sum(e["amount"] for e in sub)), "count": len(sub), "events": sub[:40]}
    wk_cut = (today + timedelta(days=7)).isoformat()
    important = {
        # ближайшая неделя — все типы (купоны/погашения + оферты справочно)
        "week": _grp(events + offers, lambda e: e["date"] <= wk_cut),
        "coupons": _grp(events, lambda e: e["type"] == "coupon"),
        "offers": _grp(offers),                            # оферты — только справочно
        "redemptions": _grp(events, lambda e: e["type"] in ("amortization", "maturity")),
    }
    return {"by_month": by_month, "upcoming": events[:25], "horizons": horizons,
            "important": important, "projected_floaters": len(projected_isins),
            "total_year": next((h["total"] for h in horizons if h["label"] == "1 год"), 0)}


def _as_date(s):
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None
