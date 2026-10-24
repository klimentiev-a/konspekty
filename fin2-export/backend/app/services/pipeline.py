"""
Orchestration: Excel -> DB -> MOEX cache -> analytics.

Keeps DB I/O in one place so routers stay thin. Refreshing MOEX is best-effort:
a single ISIN failing (delisted, network) must not break the whole portfolio.
"""
from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import analytics, data_quality, excel_importer, moex, portfolio_risk
from ..config import HISTORY_FROM
from ..db import (
    BondCashflow, Client, MoexQuote, MoexSecurity, Portfolio, Position,
)

log = logging.getLogger("pipeline")


# --------------------------------------------------------------------------- #
# Load a portfolio from a parsed workbook
# --------------------------------------------------------------------------- #
def active_client(db: Session) -> Client:
    """The client currently selected in the UI (multi-client workspace). Falls
    back to the first client, or creates one."""
    c = db.scalar(select(Client).where(Client.is_active == True))  # noqa: E712
    if c:
        return c
    c = db.scalar(select(Client).order_by(Client.id))
    if not c:
        c = Client(name="Клиент 1", role="client", is_active=True)
        db.add(c)
    else:
        c.is_active = True
    db.commit()
    return c


def load_portfolio(db: Session, path: str, name: str = "Портфель клиента") -> Portfolio:
    parsed = excel_importer.import_portfolio(path)

    client = active_client(db)

    pf = Portfolio(client_id=client.id, name=name, source_file=path)
    db.add(pf)
    db.flush()

    for p in parsed["positions"]:
        db.add(Position(portfolio_id=pf.id, **p))
    db.commit()

    refresh_moex(db, pf.id)
    return pf


def refresh_moex(db: Session, portfolio_id: int) -> dict:
    """Resolve + cache MOEX security reference and current quote for every ISIN."""
    positions = db.scalars(
        select(Position).where(Position.portfolio_id == portfolio_id)
    ).all()
    ok, failed = 0, []
    for pos in positions:
        try:
            ref = moex.resolve_security(pos.isin)
            _upsert_security(db, ref)
            # биржевой фид/история ключуются по SECID (для ОФЗ ISIN не работает)
            sid = ref["secid"] or pos.isin
            quote = moex.get_current_quote(sid, ref["board"])
            quote["isin"] = pos.isin
            # Illiquid bond with no live price -> use last traded close.
            if not (quote["last"] or quote["marketprice"] or quote["lcloseprice"]):
                lk = moex.get_last_known_price(sid, ref["board"])
                if lk["close"] is not None:
                    quote["lcloseprice"] = lk["close"]
                    if quote["accint"] is None:
                        quote["accint"] = lk["accint"]
            _upsert_quote(db, quote, ref["board"])

            # Auto buy-price from history on the trade date (only 3 inputs needed).
            if pos.buy_price is None and pos.buy_date:
                px = moex.get_price_on_date(sid, ref["board"], pos.buy_date)
                if px["close"] is not None:
                    pos.buy_price = px["close"]
                    pos.buy_accint = px["accint"]

            # Real coupon / amortization schedule -> bond_cashflows (source of truth).
            _refresh_cashflows(db, pos.isin, ref["secid"])

            pos.resolved = True
            ok += 1
        except Exception as e:  # noqa: BLE001 - best effort per ISIN
            pos.resolved = False
            failed.append({"isin": pos.isin, "error": str(e)})
            log.warning("MOEX refresh failed for %s: %s", pos.isin, e)
    db.commit()
    return {"resolved": ok, "failed": failed}


def _refresh_cashflows(db: Session, isin: str, secid: str) -> None:
    """Replace cached cashflows for one ISIN with the MOEX bondization schedule."""
    from sqlalchemy import delete
    bz = moex.get_bondization(secid)
    db.execute(delete(BondCashflow).where(
        BondCashflow.isin == isin, BondCashflow.source == "moex_bondization"))
    for c in bz["coupons"]:
        if not c["date"]:
            continue
        val = c["value_rub"] if c["value_rub"] is not None else c["value"]
        db.add(BondCashflow(isin=isin, payment_date=c["date"], payment_type="coupon",
                            coupon_value=val, currency=c.get("faceunit") or "RUB",
                            source="moex_bondization"))
    for a in bz["amortizations"]:
        if not a["date"]:
            continue
        val = a["value_rub"] if a["value_rub"] is not None else a["value"]
        kind = "maturity" if (a.get("source") == "maturity") else "amortization"
        db.add(BondCashflow(isin=isin, payment_date=a["date"], payment_type=kind,
                            amortization_value=val, currency=a.get("faceunit") or "RUB",
                            source="moex_bondization"))


def _upsert_security(db: Session, ref: dict) -> None:
    sec = db.get(MoexSecurity, ref["isin"]) or MoexSecurity(isin=ref["isin"])
    sec.secid = ref["secid"]
    sec.board = ref["board"]
    sec.shortname = ref["shortname"]
    sec.name = ref["name"]
    sec.type = ref["type"]
    sec.currency = ref["faceunit"] or "RUB"
    sec.facevalue = ref["facevalue"]
    sec.faceunit = ref["faceunit"]
    sec.matdate = ref["matdate"]
    sec.couponvalue = ref["couponvalue"]
    sec.couponpercent = ref["couponpercent"]
    sec.couponperiod = ref["couponperiod"]
    sec.nextcoupon = ref["nextcoupon"]
    sec.is_traded = ref["is_traded"]
    sec.updated_at = datetime.utcnow()
    db.add(sec)


def _upsert_quote(db: Session, q: dict, board: str) -> None:
    row = db.get(MoexQuote, q["isin"]) or MoexQuote(isin=q["isin"])
    row.secid = q["secid"]
    row.board = board
    row.last = q["last"]
    row.marketprice = q["marketprice"]
    row.lcloseprice = q["lcloseprice"]
    row.waprice = q["waprice"]
    row.accint = q["accint"]
    row.bid = q["bid"]
    row.offer = q["offer"]
    row.ytm = q["ytm"]
    row.duration = q["duration"]
    row.volume = q["volume"]
    row.numtrades = q["numtrades"]
    row.updatetime = q["updatetime"]
    row.updated_at = datetime.utcnow()
    db.add(row)


# --------------------------------------------------------------------------- #
# Build the full analytics payload for the dashboard
# --------------------------------------------------------------------------- #
_RUB_CCY = {None, "", "RUB", "SUR", "RUR"}


def _ccy_match(c, sel) -> bool:
    """currency-class filter: None/'all' → всё; 'rub' → рублёвые; 'fx' → валютные;
    иначе точное совпадение кода валюты."""
    if sel in (None, "", "all"):
        return True
    if sel == "rub":
        return c in _RUB_CCY
    if sel == "fx":
        return c not in _RUB_CCY
    return c == sel


def _currency_breakdown(rows: list[dict]) -> list[dict]:
    """Per-currency split of the holdings (value in RUB), with weighted YTM & duration."""
    tot = sum((r.get("market_value") or 0) for r in rows) or 0.0
    agg: dict = {}
    for r in rows:
        mv = r.get("market_value") or 0.0
        ccy = r.get("currency") or "RUB"
        if ccy in _RUB_CCY:               # SUR (облигации) и RUB (акции) — один рубль
            ccy = "RUB"
        e = agg.setdefault(ccy, {"mv": 0.0, "n": 0, "wy": 0.0, "wyd": 0.0, "wd": 0.0, "wdd": 0.0})
        e["mv"] += mv; e["n"] += 1
        # эффективная доходность: у флоатеров — текущая доходность, у фиксов — YTM
        # (та же формула, что и во взвешенном заголовке portfolio_summary)
        eff = r.get("current_yield") if r.get("is_float") else r.get("ytm")
        if eff and mv:
            e["wy"] += mv * eff; e["wyd"] += mv
        if r.get("duration_years") and mv:
            e["wd"] += mv * r["duration_years"]; e["wdd"] += mv
    out = [{"currency": k, "market_value": round(v["mv"]), "positions": v["n"],
            "share": round(100 * v["mv"] / tot, 1) if tot else 0,
            "ytm": round(v["wy"] / v["wyd"], 2) if v["wyd"] else None,
            "duration": round(v["wd"] / v["wdd"], 2) if v["wdd"] else None} for k, v in agg.items()]
    return sorted(out, key=lambda x: x["market_value"], reverse=True)


def build_dashboard(db: Session, portfolio_id, ccy=None) -> dict:
    pids = list(portfolio_id) if isinstance(portfolio_id, (list, tuple, set)) else [portfolio_id]
    pfs = [p for p in (db.get(Portfolio, i) for i in pids) if p]
    if not pfs:
        raise ValueError(f"portfolio {portfolio_id} not found")
    pf = pfs[0]
    combined = len(pfs) > 1
    pids = [p.id for p in pfs]

    positions = db.scalars(select(Position).where(Position.portfolio_id.in_(pids))).all()
    secs = {s.isin: s for s in db.scalars(select(MoexSecurity)).all()}
    quotes = {q.isin: q for q in db.scalars(select(MoexQuote)).all()}

    cashflows: dict[str, list[BondCashflow]] = {}
    seen: set = set()
    for cf in db.scalars(select(BondCashflow)).all():
        key = (cf.isin, cf.payment_date, cf.payment_type)   # dedupe global table
        if key in seen:
            continue
        seen.add(key)
        cashflows.setdefault(cf.isin, []).append(cf)

    fx = moex.get_fx_rates()
    rows = [analytics.position_metrics(p, secs.get(p.isin), quotes.get(p.isin), cashflows.get(p.isin), fx)
            for p in positions]
    portfolio_risk.enrich_positions(db, rows)      # kind + rate/credit/modified duration (+ fallback)
    # какие валюты вообще есть в портфеле (до фильтра) — для переключателя в UI
    present = sorted({(r.get("currency") or "RUB") for r in rows})
    has_fx = any(c not in _RUB_CCY for c in present)
    currencies = _currency_breakdown(rows)     # разбивка по валютам (стоимость в ₽), с YTM/дюрацией
    if ccy not in (None, "", "all"):
        rows = [r for r in rows if _ccy_match(r.get("currency"), ccy)]
    summary = analytics.portfolio_summary(rows)
    structure = analytics.structure_breakdowns(rows)
    cf = analytics.cashflow_calendar(rows, cashflows, secs)
    risk = analytics.risk_scenarios(rows, summary)
    bond_rows = [r for r in rows if r.get("is_bond") is not False]   # стресс/концентрация — по облигациям
    stress = portfolio_risk.stress(bond_rows)      # factor-decomposed default stress
    concentration = stress["concentration"]

    dep = [p.deposited_cash for p in pfs if p.deposited_cash is not None]
    # свободные средства считаем только для полного портфеля — при фильтре по валюте
    # внесённая сумма не относится к подмножеству бумаг
    deposited_cash = (sum(dep) if dep else None) if ccy in (None, "", "all") else None
    if deposited_cash:      # 0 = депозит не задан (снимок портфеля) → не считаем free_cash
        summary["deposited_cash"] = deposited_cash
        summary["free_cash"] = deposited_cash - (summary["invested"] or 0)
        summary["total_account"] = (summary["market_value"] or 0) + summary["free_cash"]

    # alerts AFTER free_cash is populated, so the reinvestment rule can fire
    al = analytics.alerts(rows, structure) + _portfolio_alerts(rows, concentration, summary) + _event_alerts(cf)
    name = pf.name if not combined else f"Все портфели ({len(pfs)})"

    return {
        "portfolio": {"id": pf.id if not combined else None, "name": name, "currency": pf.currency,
                      "source_file": pf.source_file, "deposited_cash": deposited_cash,
                      "combined": combined, "count": len(pfs), "ids": pids,
                      "currencies_present": present, "has_fx": has_fx, "ccy": ccy,
                      "currencies": currencies},
        "summary": summary,
        "positions": rows,
        "structure": structure,
        "cashflows": cf,
        "risk": risk,
        "stress": stress,
        "concentration": concentration,
        "data_quality": data_quality.position_issues(rows),
        "alerts": al,
        "history_from": HISTORY_FROM,
    }


def _event_alerts(cf: dict, days_ahead: int = 21) -> list[dict]:
    """Upcoming coupon / amortization / offer events in the next N days — 'ближайшие
    купоны, оферты и т.д.' — from the cash-flow calendar."""
    from datetime import date as _date, datetime as _dt
    today = _date.today()
    lbl = {"coupon": "купон", "amortization": "амортизация", "maturity": "погашение",
           "put": "оферта (put)", "call": "оферта (call)", "offer": "оферта"}
    out = []
    for e in cf.get("upcoming", []):
        try:
            d = (_dt.strptime(e["date"], "%Y-%m-%d").date() - today).days
        except (ValueError, TypeError):
            continue
        if 0 <= d <= days_ahead:
            kind = lbl.get(e.get("type"), "выплата")
            amt = e.get("amount") or 0
            out.append({"level": "info", "isin": e.get("isin"),
                        "text": f"Скоро {kind}: {e.get('name')} — {round(amt):,} ₽ через {d} дн. ({e['date']})".replace(",", " ")})
    return out[:12]


def _portfolio_alerts(rows: list[dict], concentration: dict, summary: dict) -> list[dict]:
    """Extra portfolio-level alert rules (concentration, high-yield, weak ratings, cash)."""
    out: list[dict] = []
    largest = (concentration.get("top") or [{}])[0]
    if largest.get("share", 0) >= 8:
        out.append({"level": "warn", "isin": None,
                    "text": f"Концентрация по эмитенту: {largest['name']} — {largest['share']}% (лимит 8%)"})
    hy = [r for r in rows if (r.get("ytm") or 0) >= 24]
    if hy:
        out.append({"level": "warn", "isin": None,
                    "text": f"Высокодоходные (YTM ≥ 24%): {len(hy)} выпусков — повышенный кредитный риск"})
    weak = [r for r in rows if r.get("rating_bucket") in ("B", "CCC", "CC", "C", "D") or not r.get("rating_bucket")]
    if weak:
        out.append({"level": "info", "isin": None,
                    "text": f"Слабые / без рейтинга: {len(weak)} выпусков"})
    fc = summary.get("free_cash")
    tot = summary.get("total_account")
    if fc is not None and tot and tot > 0 and fc / tot > 0.15:
        out.append({"level": "info", "isin": None,
                    "text": f"Свободный кэш {round(fc / tot * 100)}% — рассмотрите реинвестирование"})
    return out


def latest_portfolio_id(db: Session) -> int | None:
    """Latest portfolio of the ACTIVE client (so switching client switches book)."""
    c = db.scalar(select(Client).where(Client.is_active == True))  # noqa: E712
    q = select(Portfolio).order_by(Portfolio.id.desc())
    if c:
        q = q.where(Portfolio.client_id == c.id)
    pf = db.scalar(q.limit(1))
    return pf.id if pf else None


def create_portfolio(db: Session, name: str = "Новый портфель", cash: float | None = None) -> Portfolio:
    """Create an empty portfolio for the active client."""
    client = active_client(db)
    pf = Portfolio(client_id=client.id, name=name or "Новый портфель", deposited_cash=cash)
    db.add(pf)
    db.commit()
    db.refresh(pf)
    return pf


def delete_portfolio(db: Session, pid: int) -> bool:
    """Delete a portfolio (positions cascade). Only within the active client."""
    c = db.scalar(select(Client).where(Client.is_active == True))  # noqa: E712
    pf = db.get(Portfolio, pid)
    if not pf or (c and pf.client_id != c.id):
        return False
    db.delete(pf)
    db.commit()
    return True


def rename_portfolio(db: Session, pid: int, name: str) -> bool:
    pf = db.get(Portfolio, pid)
    if not pf or not name:
        return False
    pf.name = name.strip()
    db.commit()
    return True


def client_portfolios(db: Session) -> list[Portfolio]:
    """All portfolios of the active client, oldest→newest (for the picker)."""
    c = db.scalar(select(Client).where(Client.is_active == True))  # noqa: E712
    q = select(Portfolio).order_by(Portfolio.id)
    if c:
        q = q.where(Portfolio.client_id == c.id)
    return list(db.scalars(q).all())


def resolve_pids(db: Session, sel=None) -> list[int]:
    """Turn a UI selection into portfolio ids. None/'all' → every portfolio of the
    active client (combined view); a specific id → just that one."""
    pfs = client_portfolios(db)
    if not pfs:
        return []
    if sel in (None, "", "all", "combined"):
        return [p.id for p in pfs]
    try:
        sid = int(sel)
    except (ValueError, TypeError):
        return [p.id for p in pfs]
    # конкретный портфель активного клиента; чужой/устаревший id → пусто (не весь книг)
    match = [p.id for p in pfs if p.id == sid]
    if match:
        return match
    return [] if sel not in (None, "", "all", "combined") else [p.id for p in pfs]


def bond_cashflow_schedule(db: Session, portfolio_id) -> list[dict]:
    """Полный график купонов/амортизаций/погашений по всем облигациям портфеля
    (для Excel): каждая будущая выплата × количество бумаг."""
    from datetime import date as _date
    pids = list(portfolio_id) if isinstance(portfolio_id, (list, tuple, set)) else [portfolio_id]
    positions = db.scalars(select(Position).where(Position.portfolio_id.in_(pids))).all()
    secs = {s.isin: s for s in db.scalars(select(MoexSecurity)).all()}
    today = _date.today().isoformat()
    cfs: dict[str, list] = {}
    seen: set = set()                      # дедуп (isin, дата, тип), как в build_dashboard
    for cf in db.scalars(select(BondCashflow)).all():
        key = (cf.isin, cf.payment_date, cf.payment_type)
        if key in seen:
            continue
        seen.add(key)
        cfs.setdefault(cf.isin, []).append(cf)
    out: list[dict] = []
    for pos in positions:
        qty = (pos.quantity or 0) - (pos.sell_quantity or 0)
        sec = secs.get(pos.isin)
        if qty <= 0 or not sec:
            continue
        name = sec.shortname or pos.name or pos.isin
        for cf in cfs.get(pos.isin, []):
            if not cf.payment_date or cf.payment_date < today:
                continue
            if cf.payment_type == "coupon":
                per_unit = cf.coupon_value or 0
                typ = "Купон"
            else:
                per_unit = cf.amortization_value or 0
                typ = "Погашение" if cf.payment_type == "maturity" else "Амортизация"
            if per_unit <= 0:
                continue
            out.append({"date": cf.payment_date, "name": name, "isin": pos.isin, "type": typ,
                        "qty": qty, "per_unit": round(per_unit, 4), "amount": round(per_unit * qty, 2)})
    # группируем по бумаге (не вперемешку по датам между выпусками), внутри — по дате
    out.sort(key=lambda e: (e["name"], e["isin"], e["date"]))
    return out


def list_portfolios(db: Session) -> list[dict]:
    """Lightweight per-portfolio summary for the picker (name, #positions, market value)."""
    pfs = client_portfolios(db)
    secs = {s.isin: s for s in db.scalars(select(MoexSecurity)).all()}
    quotes = {q.isin: q for q in db.scalars(select(MoexQuote)).all()}
    fx = moex.get_fx_rates()               # для валютных бумаг: цена % → ₽ по курсу
    out = []
    for p in pfs:
        poss = db.scalars(select(Position).where(Position.portfolio_id == p.id)).all()
        mv, n = 0.0, 0
        for pos in poss:
            qty = (pos.quantity or 0) - (pos.sell_quantity or 0)
            if qty <= 0:
                continue
            n += 1
            s, q = secs.get(pos.isin), quotes.get(pos.isin)
            ccy = (s.faceunit if s and s.faceunit else None) or pos.currency or "RUB"
            rate = fx.get(ccy, 1.0)
            # акции/фонды: цена в ₽ за штуку → face=100 (как в position_metrics)
            is_bond = analytics._is_bond(s)
            face = 100.0 if not is_bond else ((s.facevalue if s else None) or 1000.0)
            price = (q.last if q else None) or (q.lcloseprice if q else None) or pos.excel_price or pos.buy_price or 100.0
            accint = (q.accint if q else None) or 0.0
            mv += qty * (face * price / 100.0 * rate + accint)
        out.append({"id": p.id, "name": p.name, "positions": n,
                    "market_value": round(mv), "deposited_cash": p.deposited_cash})
    return out


# --------------------------------------------------------------------------- #
# Portfolio builder
# --------------------------------------------------------------------------- #
def quote_on_date(isin: str, on_date: str, qty: float) -> dict:
    """Price one prospective purchase on its trade date — for the builder.
    Returns name, unit clean price (%), accrued (RUB), unit cost and total cost
    in RUB so the UI can check funds before the portfolio is committed."""
    isin = (isin or "").strip().upper()
    ref = moex.resolve_security(isin)
    is_bond = analytics.is_bond_type(ref.get("type"), ref.get("matdate"))
    face = 100.0 if not is_bond else (ref["facevalue"] or 1000.0)
    ccy = ref["faceunit"] or "RUB"
    rate = moex.get_fx_rates().get(ccy, 1.0)
    px = moex.get_price_on_date(ref.get("secid") or isin, ref["board"], on_date)
    if px["close"] is None:
        return {"isin": isin, "name": ref["shortname"], "ok": False,
                "error": "Нет цены на эту дату (бумага не торговалась рядом с датой)"}
    clean = px["close"]
    accint = px["accint"] or 0.0
    unit_cost = clean / 100.0 * face * rate + accint
    return {
        "isin": isin, "name": ref["shortname"], "ok": True,
        "currency": ccy, "price_date": px["date"], "clean_price": clean,
        "accint": accint, "unit_cost": round(unit_cost, 2),
        "cost": round(unit_cost * (qty or 0), 2), "quantity": qty,
    }


def build_portfolio(db: Session, cash: float, items: list[dict], name: str = "Портфель инвестора") -> Portfolio:
    """Create a portfolio from a builder list of trades [{isin, date, quantity,
    side:'buy'|'sell', clean_price}]. Buys and sells of the same ISIN net into one
    position: quantity = Σbuys, sell_quantity = Σsells, with weighted-avg prices so
    the dashboard books realized P&L on the sold lot and unrealized on the rest."""
    from collections import defaultdict
    client = active_client(db)
    pf = Portfolio(client_id=client.id, name=name, deposited_cash=cash)
    db.add(pf)
    db.flush()

    grp: dict[str, dict] = defaultdict(lambda: {"buys": [], "sells": []})
    for it in items:
        isin = (it.get("isin") or "").strip().upper()
        if not isin:
            continue
        rec = {"date": it.get("buy_date") or it.get("date"),
               "qty": _num(it.get("quantity")) or 0.0, "price": _num(it.get("clean_price"))}
        grp[isin]["sells" if (it.get("side") == "sell") else "buys"].append(rec)

    def _wavg(lst):
        q = sum(x["qty"] for x in lst)
        p = sum((x["price"] or 0) * x["qty"] for x in lst) / q if q else None
        return q, (p if any(x["price"] for x in lst) else None)

    for isin, g in grp.items():
        buy_q, buy_p = _wavg(g["buys"])
        sell_q, sell_p = _wavg(g["sells"])
        buy_date = min((x["date"] for x in g["buys"] if x["date"]), default=None)
        sell_date = max((x["date"] for x in g["sells"] if x["date"]), default=None)
        db.add(Position(
            portfolio_id=pf.id, isin=isin,
            quantity=buy_q or sell_q, buy_date=buy_date, buy_price=buy_p,
            sell_quantity=sell_q or None, sell_price=sell_p, sell_date=sell_date,
        ))
    db.commit()
    refresh_moex(db, pf.id)
    return pf


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def qty_on(p, d: str) -> float:
    """Количество бумаг в позиции на дату d: после даты (частичной) продажи — остаток."""
    q = p.quantity or 0.0
    if p.sell_quantity and p.sell_date and d >= p.sell_date:
        q = max(0.0, q - p.sell_quantity)
    return q


def build_timeseries(db: Session, portfolio_id, ccy=None) -> dict:
    """Reconstruct daily portfolio market value from MOEX price history of each
    holding (forward-filled), starting at the earliest purchase date."""
    pids = list(portfolio_id) if isinstance(portfolio_id, (list, tuple, set)) else [portfolio_id]
    positions = db.scalars(select(Position).where(Position.portfolio_id.in_(pids))).all()
    secs = {s.isin: s for s in db.scalars(select(MoexSecurity)).all()}
    if ccy not in (None, "", "all"):
        positions = [p for p in positions
                     if _ccy_match((secs.get(p.isin).faceunit if secs.get(p.isin) and secs.get(p.isin).faceunit else None) or p.currency or "RUB", ccy)]
    fx = moex.get_fx_rates()

    dates_buy = [p.buy_date for p in positions if p.buy_date]
    if not dates_buy:
        return {"dates": [], "values": []}
    start = min(dates_buy)
    from datetime import date
    today = date.today().isoformat()

    # Per-bond date -> dirty unit value in RUB.
    series: dict[str, dict[str, float]] = {}
    all_dates: set[str] = set()
    for p in positions:
        sec = secs.get(p.isin)
        if not sec:
            continue
        face = sec.facevalue or 1000.0
        rate = fx.get(sec.faceunit or "RUB", 1.0)
        hist = moex.get_price_history(sec.secid or p.isin, sec.board, p.buy_date or start, today)
        d2v = {}
        for h in hist:
            if h["close"] is None:
                continue
            d2v[h["date"]] = h["close"] / 100.0 * face * rate + (h["accint"] or 0.0)
            all_dates.add(h["date"])
        series[p.isin] = d2v

    pos_by_isin = {p.isin: p for p in positions}
    sorted_dates = sorted(d for d in all_dates if d >= start)
    last_val: dict[str, float] = {}
    out_dates, out_values = [], []
    for d in sorted_dates:
        total = 0.0
        for isin, d2v in series.items():
            p = pos_by_isin[isin]
            if p.buy_date and d < p.buy_date:
                continue
            if d in d2v:
                last_val[isin] = d2v[d]
            if isin in last_val:
                total += last_val[isin] * qty_on(p, d)       # проданная часть выходит из NAV с даты продажи
        out_dates.append(d)
        out_values.append(round(total, 2))
    return {"dates": out_dates, "values": out_values}
