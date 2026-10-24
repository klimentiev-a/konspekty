"""
Analytics engine.

Turns raw positions + MOEX cache + cashflows into the numbers the dashboard
shows: market value, invested, НКД, P/L, portfolio YTM/duration, structure
breakdowns, a coupon calendar and rate/FX risk scenarios.

Conventions
-----------
* Bond prices from MOEX are a PERCENT of face value (e.g. 99.4 == 99.4%).
* `duration` from MOEX ISS is in DAYS; we expose years = days / 365.
* Where a live `last`/`marketprice` is missing (illiquid bond, market closed),
  we fall back to lcloseprice -> waprice -> Excel price -> buy price, and flag
  the source so the UI can show data quality.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from typing import Optional

from ..db import BondCashflow, MoexQuote, MoexSecurity, Position


# --------------------------------------------------------------------------- #
# Per-position
# --------------------------------------------------------------------------- #
def _price_with_source(q: Optional[MoexQuote], pos: Position) -> tuple[Optional[float], str]:
    if q:
        for field in ("last", "marketprice", "lcloseprice", "waprice"):
            v = getattr(q, field)
            if v:
                return v, f"moex.{field}"
    if pos.excel_price:
        return pos.excel_price, "excel"
    if pos.buy_price:
        return pos.buy_price, "buy"
    return None, "none"


def coupons_received(cashflows: Optional[list], buy_date: Optional[str], open_qty: float,
                     sell_date: Optional[str] = None, sold_qty: float = 0.0) -> float:
    """Sum of coupons actually paid AFTER the buy date and up to today, in rubles.
    Coupons paid before a partial sale accrue on the FULL lot (open+sold); coupons
    after the sale accrue on the open lot only."""
    if not cashflows or not buy_date:
        return 0.0
    today = date.today().isoformat()
    total = 0.0
    for cf in cashflows:
        if cf.payment_type != "coupon" or not cf.payment_date:
            continue
        if buy_date < cf.payment_date <= today:
            q = (open_qty + sold_qty) if (sell_date and cf.payment_date <= sell_date) else open_qty
            total += (cf.coupon_value or 0.0) * q
    return total


def _cy_date(s):
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def current_yield(cashflows, clean_unit_rub) -> Optional[float]:
    """Текущая доходность = годовой купон / чистая цена. Годовой купон берём из
    ближайшего известного купона (bond_cashflows) с учётом периодичности — работает
    и для фиксов, и для флоатеров (у флоатера следующий купон уже объявлен)."""
    if not cashflows or not clean_unit_rub or clean_unit_rub <= 0:
        return None
    coups = sorted([c for c in cashflows if c.payment_type == "coupon" and c.payment_date
                    and (c.coupon_value or 0) > 0], key=lambda c: c.payment_date)
    if not coups:
        return None
    today = date.today().isoformat()
    fut = [c for c in coups if c.payment_date >= today]
    nxt = fut[0] if fut else coups[-1]
    i = coups.index(nxt)
    d_nxt = _cy_date(nxt.payment_date)
    days = None
    if i > 0 and _cy_date(coups[i - 1].payment_date):
        days = (d_nxt - _cy_date(coups[i - 1].payment_date)).days
    elif i + 1 < len(coups) and _cy_date(coups[i + 1].payment_date):
        days = (_cy_date(coups[i + 1].payment_date) - d_nxt).days
    days = days or 182
    freq = 365.0 / max(days, 1)
    annual = (nxt.coupon_value or 0) * freq
    return round(annual / clean_unit_rub * 100, 2)


def is_bond_type(type_str: Optional[str], matdate: Optional[str] = None) -> bool:
    """Bond vs non-bond by the MOEX ISS instrument TYPE (+ maturity fallback)."""
    t = (type_str or "").lower()
    if "bond" in t:
        return True
    if any(k in t for k in ("share", "ppif", "etf", "index", "fund", "depositary", "receipt", "currency", "futures")):
        return False
    return bool(matdate)


def _is_bond(sec: Optional[MoexSecurity]) -> bool:
    """Bond vs non-bond (акция / фонд ликвидности / ETF). Non-bonds stay in market
    value / AUM but are excluded from YTM & duration аналитики."""
    if not sec:
        return True                       # неизвестное — считаем облигацией (обычный кейс)
    return is_bond_type(sec.type, sec.matdate)


def position_metrics(pos: Position, sec: Optional[MoexSecurity], q: Optional[MoexQuote],
                     cashflows: Optional[list] = None, fx: Optional[dict] = None) -> dict:
    is_bond = _is_bond(sec)
    # bonds price as % of face; shares/funds price in absolute ₽ per unit — face=100
    # makes the same «price% × face/100» math yield the absolute price for non-bonds
    face = 100.0 if not is_bond else ((sec.facevalue if sec and sec.facevalue else None) or 1000.0)
    qty = pos.quantity or 0.0

    # Face currency (USD/CNY/EUR bonds priced in their own currency) -> RUB.
    ccy = (sec.faceunit if sec and sec.faceunit else None) or pos.currency or "RUB"
    if ccy in ("SUR", "RUR"):
        ccy = "RUB"          # показываем везде как RUB, а не SUR
    rate = (fx or {}).get(ccy, 1.0)

    price_pct, price_src = _price_with_source(q, pos)
    accint = (q.accint if q and q.accint is not None else pos.buy_accint) or 0.0

    # A (partly) sold position: realized P&L on the sold lot, open position on the
    # rest. sell_quantity=None → nothing sold.
    sold_qty = pos.sell_quantity or 0.0
    open_qty = max(0.0, qty - sold_qty)
    unit_buy_rub = ((pos.buy_price or 0) / 100.0 * face * rate) + (pos.buy_accint or 0)
    realized_pl = None
    if sold_qty > 0 and pos.sell_price is not None and pos.buy_price:
        unit_sell_rub = pos.sell_price / 100.0 * face * rate
        realized_pl = (unit_sell_rub - unit_buy_rub) * sold_qty

    # Price is % of face in the face currency -> convert to RUB at the rate.
    # НКД (accint) is reported by MOEX already in RUB, so it is NOT re-converted.
    clean_unit_rub = (price_pct / 100.0 * face * rate) if price_pct is not None else None
    market_value = (clean_unit_rub + accint) * open_qty if clean_unit_rub is not None else None
    invested = (unit_buy_rub * open_qty) if pos.buy_price else None

    # coupons_received uses value_rub (actual rubles received), so NOT re-converted
    coupons = coupons_received(cashflows, pos.buy_date, open_qty, pos.sell_date, sold_qty)
    pl_price = (market_value - invested) if (market_value is not None and invested is not None) else None
    pl = (pl_price + coupons + (realized_pl or 0)) if pl_price is not None else realized_pl   # incl. realized
    _base = invested or (unit_buy_rub * sold_qty) or None
    pl_pct = (pl / _base * 100.0) if (pl is not None and _base) else None

    ytm = (q.ytm if q and q.ytm else None) if is_bond else None
    dur_days = (q.duration if q and q.duration else (sec and None)) if is_bond else None
    dur_years = (dur_days / 365.0) if dur_days else None

    excel_price = pos.excel_price
    diff = (price_pct - excel_price) if (price_pct is not None and excel_price) else None

    return {
        "isin": pos.isin,
        "name": pos.name or (sec.shortname if sec else pos.isin),
        "secid": sec.secid if sec else None,
        "board": sec.board if sec else None,
        "sector": pos.sector,
        "rating": pos.rating,
        "currency": ccy,
        "fx_rate": rate,
        "quantity": qty,
        "face": face,
        "matdate": sec.matdate if sec else None,
        "buy_date": pos.buy_date,
        "buy_price": pos.buy_price,
        "buy_accint": pos.buy_accint,
        "coupons_received": coupons,
        "sold_quantity": sold_qty or None,
        "open_quantity": open_qty,
        "sell_date": pos.sell_date, "sell_price": pos.sell_price,
        "realized_pl": realized_pl,
        "pl_price": pl_price,
        "price_moex": price_pct if price_src.startswith("moex") else None,
        "price_excel": excel_price,
        "price_used": price_pct,
        "price_source": price_src,
        "price_diff": diff,
        "accint": accint,
        "is_bond": is_bond,
        "instrument_type": (sec.type if sec else None),
        "ytm": ytm,
        "current_yield": current_yield(cashflows, clean_unit_rub) if is_bond else None,
        "duration_years": dur_years,
        "duration_days": dur_days,
        "volume": q.volume if q else None,
        "numtrades": q.numtrades if q else None,
        "market_value": market_value,
        "invested": invested,
        "pl": pl,
        "pl_pct": pl_pct,
        "resolved": bool(pos.resolved),
    }


# --------------------------------------------------------------------------- #
# Portfolio aggregates
# --------------------------------------------------------------------------- #
def portfolio_summary(rows: list[dict]) -> dict:
    mv = sum(r["market_value"] for r in rows if r["market_value"])
    inv = sum(r["invested"] for r in rows if r["invested"])
    accint = sum((r["accint"] or 0) * (r["open_quantity"] if r.get("open_quantity") is not None else r["quantity"]) for r in rows)
    coupons = sum(r["coupons_received"] or 0 for r in rows)
    realized = sum(r.get("realized_pl") or 0 for r in rows)
    pl_price = (mv - inv) if (mv and inv) else None
    pl = ((pl_price or 0) + coupons + realized) if (pl_price is not None or realized or coupons) else None

    # value-weighted YTM: у флоатеров вместо YTM берём текущую доходность (эффективная);
    # линкеры (ОФЗ-ИН) — РЕАЛЬНАЯ доходность, в среднюю номинальную не входят
    def _eff(r):
        if r.get("kind") in ("linker", "structured") or str(r.get("secid") or "").startswith("SU52"):
            return None
        return r.get("current_yield") if r.get("is_float") else r.get("ytm")
    wsum = sum(r["market_value"] for r in rows if r["market_value"] and _eff(r))
    ytm = (sum(r["market_value"] * _eff(r) for r in rows if r["market_value"] and _eff(r)) / wsum) if wsum else None
    # дюрация портфеля — процентная: у флоатера процентный риск только до пересмотра купона
    # (rate_duration из portfolio_risk.enrich_positions), а не дюрация MOEX к погашению
    def _dur(r):
        return (r.get("rate_duration") or r.get("duration_years")) if r.get("is_float") else r.get("duration_years")
    wsum_d = sum(r["market_value"] for r in rows if r["market_value"] and _dur(r))
    dur = (sum(r["market_value"] * _dur(r) for r in rows if r["market_value"] and _dur(r)) / wsum_d) if wsum_d else None
    # value-weighted CURRENT YIELD (по фиксам и флоатерам — только облигации)
    wcy = sum(r["market_value"] for r in rows if r["market_value"] and r.get("current_yield"))
    cur_yield = (sum(r["market_value"] * r["current_yield"] for r in rows if r["market_value"] and r.get("current_yield")) / wcy) if wcy else None

    return {
        "market_value": mv,
        "invested": inv,
        "accint": accint,
        "coupons_received": coupons,
        "realized_pl": realized,
        "pl_price": pl_price,
        "pl": pl,
        "pl_pct": (pl / inv * 100.0) if (pl is not None and inv) else None,
        "ytm": ytm,
        "current_yield": round(cur_yield, 2) if cur_yield is not None else None,
        "duration_years": dur,
        "positions": len(rows),
        "unresolved": sum(1 for r in rows if not r["resolved"]),
        "no_price": sum(1 for r in rows if r["price_source"] in ("none",)),
    }


_RATING_RANK = {r: i for i, r in enumerate([
    "AAA", "AA+", "AA", "AA-", "A+", "A", "A-", "BBB+", "BBB", "BBB-",
    "BB+", "BB", "BB-", "B+", "B", "B-", "CCC", "CC", "C", "D"])}


def _rating_rank(bucket: str) -> int:
    """Порядок рейтингов от AAA (0) к D; «н/р»/пусто — в конец."""
    return _RATING_RANK.get((bucket or "").strip(), 99)


def structure_breakdowns(all_rows: list[dict]) -> dict:
    # вся структурная аналитика — только по облигациям (акции/фонды лишь в стоимости/AUM)
    rows = [r for r in all_rows if r.get("is_bond") is not False]

    def group(key: str, bonds_only: bool = False, rating_order: bool = False) -> list[dict]:
        agg: dict[str, float] = defaultdict(float)
        for r in rows:
            if r["market_value"]:
                agg[r.get(key) or "—"] += r["market_value"]
        total = sum(agg.values()) or 1.0
        items = [{"name": k, "value": round(v, 2), "share": round(v / total * 100, 2)} for k, v in agg.items()]
        if rating_order:   # по рейтингам — от AAA к D, «н/р» в конце (не по доле)
            items.sort(key=lambda x: (_rating_rank(x["name"]), -x["value"]))
        else:
            items.sort(key=lambda x: -x["value"])
        return items

    top10 = sorted(
        [{"name": r["name"], "isin": r["isin"], "value": r["market_value"]} for r in rows if r["market_value"]],
        key=lambda x: -x["value"],
    )[:10]
    total = sum(r["market_value"] for r in rows if r["market_value"]) or 1.0
    for t in top10:
        t["share"] = round(t["value"] / total * 100, 2)

    return {
        "by_sector": group("sector", bonds_only=True),
        "by_rating": group("rating_bucket", bonds_only=True, rating_order=True),
        "by_currency": group("currency"),
        "by_maturity": _by_maturity_bucket([r for r in rows if r.get("is_bond") is not False]),
        "top10": top10,
        "concentration_top10": round(sum(t["share"] for t in top10), 2),
    }


def _by_maturity_bucket(rows: list[dict]) -> list[dict]:
    buckets = {"< 1 год": 0.0, "1–3 года": 0.0, "3–5 лет": 0.0, "> 5 лет": 0.0, "н/д": 0.0}
    today = date.today()
    for r in rows:
        if not r["market_value"]:
            continue
        md = r.get("matdate")
        if not md or md == "0000-00-00":
            buckets["н/д"] += r["market_value"]
            continue
        try:
            years = (datetime.strptime(md, "%Y-%m-%d").date() - today).days / 365.0
        except ValueError:
            buckets["н/д"] += r["market_value"]
            continue
        if years < 1:
            buckets["< 1 год"] += r["market_value"]
        elif years < 3:
            buckets["1–3 года"] += r["market_value"]
        elif years < 5:
            buckets["3–5 лет"] += r["market_value"]
        else:
            buckets["> 5 лет"] += r["market_value"]
    total = sum(buckets.values()) or 1.0
    return [{"name": k, "value": round(v, 2), "share": round(v / total * 100, 2)} for k, v in buckets.items() if v]


# --------------------------------------------------------------------------- #
# Cashflow calendar
# --------------------------------------------------------------------------- #
def cashflow_calendar(rows: list[dict], cashflows: dict[str, list[BondCashflow]],
                      securities: dict[str, MoexSecurity]) -> dict:
    """Future payments by month. Uses bond_cashflows when present, otherwise a
    synthetic forward coupon schedule derived from MOEX security parameters."""
    coupon_m: dict[str, float] = defaultdict(float)
    nominal_m: dict[str, float] = defaultdict(float)
    events: list[dict] = []
    today = date.today()

    for r in rows:
        isin = r["isin"]
        qty = r["open_quantity"] if r.get("open_quantity") is not None else (r["quantity"] or 0)
        cfs = cashflows.get(isin)
        if cfs:
            for cf in cfs:
                coupon = (cf.coupon_value or 0) * qty
                nominal = (cf.amortization_value or 0) * qty
                _add_event(coupon_m, nominal_m, events, cf.payment_date, coupon, nominal,
                           cf.payment_type, r["name"], isin, today)
        else:
            for pay_date, amount, kind in _synthetic_schedule(securities.get(isin), today):
                is_coupon = kind == "coupon"
                _add_event(coupon_m, nominal_m, events, pay_date,
                           amount * qty if is_coupon else 0, 0 if is_coupon else amount * qty,
                           kind, r["name"], isin, today, source="projected")

    months = sorted(set(coupon_m) | set(nominal_m))
    # per-issue breakdown of each month (for the "Ближайшие выплаты" hover tooltip)
    detail: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(lambda: {"coupon": 0.0, "nominal": 0.0}))
    for e in events:
        d = detail[e["date"][:7]][e["name"]]
        d["coupon"] += e.get("coupon", 0) or 0
        d["nominal"] += e.get("nominal", 0) or 0

    def _items(m):
        out = [{"name": n, "coupon": round(v["coupon"], 2), "nominal": round(v["nominal"], 2)}
               for n, v in detail.get(m, {}).items()]
        return sorted(out, key=lambda x: x["coupon"] + x["nominal"], reverse=True)[:10]

    by_month = [{"month": m, "coupon": round(coupon_m.get(m, 0), 2),
                 "nominal": round(nominal_m.get(m, 0), 2),
                 "amount": round(coupon_m.get(m, 0) + nominal_m.get(m, 0), 2),
                 "items": _items(m)} for m in months]
    upcoming = sorted([e for e in events if e["date"] >= today.isoformat()], key=lambda e: e["date"])[:20]

    # horizon totals (next 30 / 90 / 365 days and all future), each split into the
    # part that comes from MOEX-exact schedules vs projected coupons.
    from datetime import timedelta
    fut = [e for e in events if e["date"] >= today.isoformat()]
    horizons = []
    for label, days in [("30 дней", 30), ("90 дней", 90), ("1 год", 365), ("Весь срок", None)]:
        cutoff = (today + timedelta(days=days)).isoformat() if days else "9999"
        sub = [e for e in fut if e["date"] <= cutoff]
        horizons.append({
            "label": label,
            "total": round(sum(e["amount"] for e in sub)),
            "coupon": round(sum(e["coupon"] for e in sub)),
            "nominal": round(sum(e["nominal"] for e in sub)),
            "exact": round(sum(e["amount"] for e in sub if e["source"] == "moex")),
            "projected": round(sum(e["amount"] for e in sub if e["source"] == "projected")),
        })
    return {"by_month": by_month, "upcoming": upcoming, "horizons": horizons,
            "synthetic": not any(cashflows.values())}


def _add_event(coupon_m, nominal_m, events, pay_date, coupon, nominal, kind, name, isin, today, source="moex"):
    if not pay_date or pay_date == "0000-00-00":
        return
    if pay_date < today.isoformat():   # only future payments — from today forward
        return
    amount = (coupon or 0) + (nominal or 0)
    if not amount:                     # skip undetermined floating coupons (value not yet set)
        return
    if coupon:
        coupon_m[pay_date[:7]] += coupon
    if nominal:
        nominal_m[pay_date[:7]] += nominal
    events.append({"date": pay_date, "amount": round(amount, 2),
                   "coupon": round(coupon or 0, 2), "nominal": round(nominal or 0, 2),
                   "type": kind, "name": name, "isin": isin, "source": source})


def _synthetic_schedule(sec: Optional[MoexSecurity], today: date) -> list[tuple[str, float, str]]:
    """Approximate forward coupons from coupon value + period until maturity.
    Clearly an approximation — real schedule must come from bond_cashflows."""
    if not sec or not sec.couponvalue or not sec.matdate:
        return []
    try:
        mat = datetime.strptime(sec.matdate, "%Y-%m-%d").date()
    except ValueError:
        return []
    period = int(sec.couponperiod or 182)
    out: list[tuple[str, float, str]] = []
    try:
        nxt = datetime.strptime(sec.nextcoupon, "%Y-%m-%d").date() if sec.nextcoupon else today
    except (ValueError, TypeError):
        nxt = today
    from datetime import timedelta
    d = max(nxt, today)
    guard = 0
    while d < mat and guard < 200:
        out.append((d.isoformat(), sec.couponvalue, "coupon"))
        d = d + timedelta(days=period)
        guard += 1
    out.append((mat.isoformat(), (sec.facevalue or 1000.0), "maturity"))
    return out


# --------------------------------------------------------------------------- #
# Risk scenarios
# --------------------------------------------------------------------------- #
def risk_scenarios(rows: list[dict], summary: dict) -> dict:
    """First-order (duration) sensitivity to rate moves + simple FX/spread shocks.

    ΔP ≈ -Duration * Δy * MarketValue  (Δy in decimal). DV01 = price change per 1bp.
    """
    # ΔP ≈ −D_mod × Δy × MV по каждой позиции: процентный шок — по МОДИФИЦИРОВАННОЙ дюрации
    # (у флоатера — до пересмотра купона), спредовый — по кредитной дюрации и только для
    # негосударственных бумаг (у ОФЗ кредитного спреда нет; у флоатера кредитный риск — полный)
    def _sov(r):
        return str(r.get("secid") or r.get("isin") or "").startswith("SU") or str(r.get("rating") or "").startswith("AAA · гос")
    bonds = [r for r in rows if r.get("market_value") and r.get("is_bond", True)]
    rate_dmv = sum(r["market_value"] * (r.get("rate_duration") or r.get("modified_duration") or r.get("duration_years") or 0)
                   for r in bonds)
    cred_dmv = sum(r["market_value"] * (r.get("credit_duration") or r.get("modified_duration") or r.get("duration_years") or 0)
                   for r in bonds if not _sov(r))
    mv = sum(r["market_value"] for r in bonds) or (summary["market_value"] or 0.0)
    dur = (rate_dmv / mv) if mv else 0.0          # модифицированная процентная дюрация портфеля
    dv01 = rate_dmv * 0.0001  # rub per 1 bp parallel shift

    def rate_shock(bp: float) -> float:
        return -rate_dmv * (bp / 10000.0)

    fx_share = sum(r["market_value"] for r in rows if r["market_value"] and (r["currency"] or "RUB") != "RUB")

    return {
        "dv01": round(dv01, 2),
        "duration_years": round(dur, 2), "duration_kind": "modified",
        "scenarios": [
            {"name": "Ставки +100 б.п.", "pl": round(rate_shock(100), 2)},
            {"name": "Ставки +200 б.п.", "pl": round(rate_shock(200), 2)},
            {"name": "Ставки −100 б.п.", "pl": round(rate_shock(-100), 2)},
            {"name": "Расширение спредов +150 б.п. (корпоративные)", "pl": round(-cred_dmv * 0.015, 2)},
            {"name": "Ослабление рубля 10% (валютная часть)", "pl": round(-fx_share * 0.10, 2)},
        ],
        "fx_exposure": round(fx_share, 2),
    }


# --------------------------------------------------------------------------- #
# Alerts
# --------------------------------------------------------------------------- #
def alerts(rows: list[dict], structure: dict) -> list[dict]:
    out: list[dict] = []
    today = date.today()
    for t in structure["top10"]:
        if t["share"] > 15:
            out.append({"level": "warn", "isin": t["isin"],
                        "text": f"Концентрация: {t['name']} — {t['share']}% портфеля"})
    for r in rows:
        if not r["resolved"]:
            out.append({"level": "error", "isin": r["isin"],
                        "text": f"ISIN не сопоставлен с бумагой на MOEX: {r['isin']}"})
        if r["price_source"] == "none":
            out.append({"level": "error", "isin": r["isin"], "text": f"Нет цены: {r['name']}"})
        if r.get("matdate"):
            try:
                days = (datetime.strptime(r["matdate"], "%Y-%m-%d").date() - today).days
                if 0 <= days <= 90:
                    out.append({"level": "info", "isin": r["isin"],
                                "text": f"Скоро погашение: {r['name']} через {days} дн. ({r['matdate']})"})
            except ValueError:
                pass
        if r["numtrades"] is not None and r["numtrades"] == 0 and r["resolved"]:
            out.append({"level": "warn", "isin": r["isin"], "text": f"Нет сделок сегодня: {r['name']}"})
    return out
