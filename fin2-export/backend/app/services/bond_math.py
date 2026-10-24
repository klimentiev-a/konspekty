"""Pure, currency-neutral cash-flow controls. No market calls or synthetic coupons."""
import math
from datetime import date


def coupon_chain(coupons, settle, end):
    """A complete, non-overlapping period chain, ending on the chosen cash date."""
    cursor = settle
    try:
        date.fromisoformat(end)
        periods = set()
        for cd, sd, *_ in coupons:
            finish = date.fromisoformat(cd)
            start = date.fromisoformat(sd)
            if finish > settle and cd <= end:
                periods.add((cd, sd))
        future = sorted(periods)
    except (ValueError, TypeError):
        return False
    if not future:
        return False
    for cd, sd in future:
        if not sd:
            return False
        try:
            start, finish = date.fromisoformat(sd), date.fromisoformat(cd)
        except (TypeError, ValueError):
            return False
        if finish <= start or not (start <= cursor < finish):
            return False
        if cursor != settle and start != cursor:
            return False
        cursor = finish
    return cursor.isoformat() == end


def accrued(coupons, settle):
    """Known current coupon accrued in face currency, not the board's RUB field."""
    for cd, sd, val, *_ in sorted(coupons):
        if sd and sd <= settle.isoformat() < cd:
            if val is None:
                return None
            days = (date.fromisoformat(cd) - date.fromisoformat(sd)).days
            return float(val) * (settle - date.fromisoformat(sd)).days / days if days > 0 else None
    return None


def principal(face, amortizations, settle, matdate=None, bullet=False):
    """Return (future principal, settlement nominal), or None if unreconciled.

    A same-day repayment is NOT bought by a T+1 buyer. A quoted pre-payment
    nominal can be reconciled only against the documented same-day event.
    Partial schedules are rejected, never completed by a percentage heuristic.
    """
    try:
        face = float(face)
    except (ValueError, TypeError):
        return None
    if not math.isfinite(face) or face <= 0:
        return None
    rows = {}
    for d, value in amortizations:
        try:
            day, v = date.fromisoformat(d), float(value)
        except (ValueError, TypeError):
            return None
        if not math.isfinite(v) or v < 0 or (day in rows and abs(rows[day] - v) > .005):
            return None
        rows[day] = v  # exact duplicated ISS rows are one payment, not two
    if not rows and bullet and matdate:
        try:
            md = date.fromisoformat(matdate)
        except (ValueError, TypeError):
            return None
        if md > settle:
            rows[md] = face
    future = sorted((d.isoformat(), v) for d, v in rows.items() if d > settle and v > 0)
    outstanding = sum(v for _, v in future)
    tol = max(.02, float(face) * .00001)
    same_day = rows.get(settle, 0)
    if outstanding <= 0 or min(abs(outstanding - face), abs(outstanding + same_day - face)) > tol:
        return None
    return future, outstanding


def solve(flows, dirty, settle):
    """Effective ACT/365 annual IRR (%) and Macaulay duration (years)."""
    if dirty is None or not math.isfinite(dirty) or dirty <= 0:
        return None
    points = []
    for d, amount, *_ in flows:
        try:
            t = (date.fromisoformat(d) - settle).days / 365
            v = float(amount)
        except (ValueError, TypeError):
            return None
        if not math.isfinite(v) or v < 0:
            return None
        if t > 0 and v:
            points.append((t, v))
    if not points:
        return None
    def pv(lograte):
        try:
            return sum(v * math.exp(-t * lograte) for t, v in points)
        except OverflowError:
            return math.inf
    lo, hi = -30., 30.
    if pv(lo) < dirty or pv(hi) > dirty:
        return None
    for _ in range(160):
        mid = (lo + hi) / 2
        if pv(mid) > dirty:
            lo = mid
        else:
            hi = mid
    r = (lo + hi) / 2
    y = math.expm1(r) * 100
    dur = sum(t * v * math.exp(-t * r) for t, v in points) / dirty
    return (round(y, 2), round(dur, 6)) if math.isfinite(y) else None
