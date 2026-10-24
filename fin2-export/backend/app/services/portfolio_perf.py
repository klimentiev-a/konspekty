"""Portfolio performance: time-weighted return (linked Modified Dietz over the
reconstructed daily NAV, netting out purchases as external inflows) and money-
weighted return (XIRR over the actual buy cash flows + current value + coupons).

TWR answers "how well did the holdings perform" independent of when money went in;
MWR/XIRR answers "what return did THIS investor earn" given their timing.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import Position
from . import moex, pipeline


def _invested_rub(p: Position, sec, fx: dict) -> float:
    if not (p.buy_price and sec):
        return 0.0
    face = sec.facevalue or 1000.0
    rate = fx.get(sec.faceunit or "RUB", 1.0)
    return ((p.buy_price / 100.0 * face * rate) + (p.buy_accint or 0.0)) * (p.quantity or 0.0)


def _xirr(flows: list[tuple[str, float]]) -> float | None:
    """Money-weighted return: the rate r where Σ cf_i / (1+r)^(days_i/365) = 0.
    Ньютон от 10% (быстро и точно в обычном случае) → при расхождении бисекция по сетке
    [-99%, +1000%]: ищем смену знака NPV и берём корень, ближайший к нулю (при нескольких
    сменах знака потока IRR может быть не единственным). Нет корня — None."""
    if len(flows) < 2:
        return None
    fs = sorted(flows, key=lambda x: x[0])
    t0 = date.fromisoformat(fs[0][0])
    yrs = [(date.fromisoformat(d) - t0).days / 365.0 for d, _ in fs]
    amt = [a for _, a in fs]
    if not (any(a < 0 for a in amt) and any(a > 0 for a in amt)):
        return None
    scale = max(abs(a) for a in amt) or 1.0

    def npv(r):
        return sum(a / (1 + r) ** t for a, t in zip(amt, yrs))

    def dnpv(r):
        return sum(-t * a / (1 + r) ** (t + 1) for a, t in zip(amt, yrs))

    r = 0.10
    for _ in range(50):
        f, df = npv(r), dnpv(r)
        if not df:
            break
        nr = r - f / df
        if nr <= -0.99 or nr > 10 or nr != nr:
            break
        if abs(nr - r) < 1e-10:
            return round(nr * 100, 2) if abs(npv(nr)) < 1e-6 * scale else None
        r = nr
    grid = [-0.99 + i * 0.01 for i in range(100)] + [i * 0.05 for i in range(1, 201)]
    vals = [npv(x) for x in grid]
    roots = []
    for a, b, fa, fb in zip(grid, grid[1:], vals, vals[1:]):
        if fa == 0:
            roots.append(a)
        elif fa * fb < 0:
            lo, hi, flo = a, b, fa
            for _ in range(100):
                mid = (lo + hi) / 2
                fm = npv(mid)
                if flo * fm <= 0:
                    hi = mid
                else:
                    lo, flo = mid, fm
            roots.append((lo + hi) / 2)
    return round(min(roots, key=abs) * 100, 2) if roots else None


def performance(db: Session, pid, ccy=None) -> dict:
    pids = list(pid) if isinstance(pid, (list, tuple, set)) else [pid]
    ts = pipeline.build_timeseries(db, pids, ccy)     # {dates, values} reconstructed NAV
    dates, vals = ts.get("dates", []), ts.get("values", [])
    if len(dates) < 2:
        return {"detail": "недостаточно истории для расчёта доходности"}

    positions = db.scalars(select(Position).where(Position.portfolio_id.in_(pids))).all()
    if ccy not in (None, "", "all"):
        _secs = {s.isin: s for s in db.scalars(select(pipeline.MoexSecurity)).all()}
        positions = [p for p in positions
                     if pipeline._ccy_match((_secs.get(p.isin).faceunit if _secs.get(p.isin) and _secs.get(p.isin).faceunit else None) or p.currency or "RUB", ccy)]
    secs = {s.isin: s for s in db.scalars(select(pipeline.MoexSecurity)).all()}
    fx = moex.get_fx_rates()

    # purchases AFTER the first date are external inflows (day-dated)
    flows_by_day: dict[str, float] = {}
    invest_cfs: list[tuple[str, float]] = []
    coupon_by_day: dict[str, float] = {}      # rouble coupons/amort paid, by date
    coupons_total = 0.0
    for p in positions:
        sec = secs.get(p.isin)
        inv = _invested_rub(p, sec, fx)
        if p.buy_date:
            invest_cfs.append((p.buy_date, -inv))
            if p.buy_date > dates[0]:
                flows_by_day[p.buy_date] = flows_by_day.get(p.buy_date, 0.0) + inv
        # частичная продажа: выручка — внешний ОТТОК на дату продажи (NAV в build_timeseries
        # с этой даты считается по остатку), в XIRR — положительный поток инвестору
        if p.sell_quantity and p.sell_date and p.sell_price is not None and sec:
            face = sec.facevalue or 1000.0
            proceeds = p.sell_price / 100.0 * face * fx.get(sec.faceunit or "RUB", 1.0) * p.sell_quantity
            invest_cfs.append((p.sell_date, proceeds))
            if dates[0] < p.sell_date <= dates[-1]:
                flows_by_day[p.sell_date] = flows_by_day.get(p.sell_date, 0.0) - proceeds
        # coupons + amortizations paid in-window are INCOME (not external flows) —
        # add them so a coupon payout isn't read as a price loss in the TWR.
        if sec:
            try:
                bz = moex.get_bondization(sec.secid or p.isin, sec.board)
            except Exception:  # noqa: BLE001
                bz = {"coupons": [], "amortizations": []}
            for ev in (bz.get("coupons", []) + bz.get("amortizations", [])):
                d, amt = ev.get("date"), (ev.get("value_rub") or ev.get("value"))
                if d and amt and dates[0] < d <= dates[-1] and (not p.buy_date or d > p.buy_date):
                    paid = amt * pipeline.qty_on(p, d)          # после продажи — только на остаток
                    coupon_by_day[d] = coupon_by_day.get(d, 0.0) + paid
                    coupons_total += paid

    # Fold coupons into the NAV as income ONLY when they are on the same scale as
    # the reconstructed NAV (they can dwarf it if a position lacks price history).
    # Guard: skip the fold if total coupons exceed the starting NAV (data mismatch).
    fold_coupons = coupons_total <= (vals[0] or 0) * 1.5
    if fold_coupons:
        running = 0.0
        cc = {}
        for d in dates:
            running += coupon_by_day.get(d, 0.0)
            cc[d] = running
        vals = [round(v + cc[d], 2) for d, v in zip(dates, vals)]

    # linked daily TWR (Modified Dietz with a single end-of-day flow)
    cum = 1.0
    series = [[dates[0], 0.0]]
    for i in range(1, len(dates)):
        v0, v1 = vals[i - 1], vals[i]
        f = flows_by_day.get(dates[i], 0.0)
        if v0 > 0:
            cum *= 1 + (v1 - v0 - f) / v0
        series.append([dates[i], round((cum - 1) * 100, 2)])

    # MWR / XIRR: invested outflows + terminal value (current NAV)
    nav_now = vals[-1]
    xirr_cfs = invest_cfs + [(dates[-1], nav_now)]
    mwr = _xirr(xirr_cfs)

    days = (date.fromisoformat(dates[-1]) - date.fromisoformat(dates[0])).days or 1
    twr = round((cum - 1) * 100, 2)
    ann = round(((cum) ** (365.0 / days) - 1) * 100, 2) if cum > 0 else None

    # benchmark overlay (RGBITR — OFZ total-return index), normalized to 0% at the
    # first date on/after the portfolio start; alpha = portfolio TWR − benchmark.
    bench, bench_ret, alpha = None, None, None
    try:
        ih = moex.get_index_history("RGBITR", dates[0], dates[-1])
        if len(ih) >= 2:
            b0 = ih[0]["close"]
            bench = [[r["date"], round(r["close"] / b0 * 100 - 100, 2)] for r in ih if b0]
            bench_ret = bench[-1][1] if bench else None
            if bench_ret is not None:
                alpha = round(twr - bench_ret, 2)
    except Exception:  # noqa: BLE001 — benchmark is a best-effort overlay
        pass

    return {
        "from": dates[0], "till": dates[-1], "days": days,
        "twr_pct": twr, "twr_annualized_pct": ann, "mwr_pct": mwr,
        "coupons_total": round(coupons_total),
        "nav_start": round(vals[0]), "nav_now": round(nav_now),
        "series": series, "nav": {"dates": dates, "values": vals},
        "benchmark": {"name": "RGBITR (ОФЗ)", "series": bench, "return_pct": bench_ret, "alpha_pct": alpha},
    }
