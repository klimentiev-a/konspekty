"""
Instrument-level bond analytics — a standalone screener, independent of any
client portfolio.

Given an ISIN it pulls MOEX ISS reference + live quote + coupon schedule,
classifies the paper as a fixed-coupon bond or a floater, and computes the
market spread metrics used on the RU market:

* Fixed-coupon bonds ("фиксы"):
    - YTM (effective, from MOEX marketdata_yields)
    - modified duration (years)
    - **G-spread** = YTM − G-curve(maturity), in basis points, where the
      G-curve is MOEX's published zero-coupon government curve (КБД, ZCYC),
      linearly interpolated at the bond's years-to-maturity.

* Floaters ("флоатеры", RUONIA / key-rate linked):
    - current coupon rate (the last fixed period)
    - implied spread to a base rate = current coupon − base rate
    - **simple margin** — the quoted-margin proxy adjusted for the straight-line
      pull to par, scaled to invested capital (Fabozzi):
          SM = ( spread + (100 − P) / M ) · (100 / P)
      where P is the clean price (% of par) and M is years to maturity.

Data source is strictly MOEX ISS. RUONIA / the CBR key rate are not exposed by
ISS in a reliable place, so the floater base rate is an explicit input; when it
is omitted we fall back to the short end of the G-curve (≈ 3M) as a market
proxy and label it as such in the output.

All prices from MOEX are a PERCENT of face value. Durations from ISS are in
DAYS; we expose years = days / 365.
"""
from __future__ import annotations

import logging
import math
import time
from datetime import date, datetime, timedelta
from typing import Optional

from . import moex, bond_math

log = logging.getLogger("instrument")

# In-process cache for the G-curve (it changes intraday but slowly; one fetch
# per screener run over many ISINs is plenty).
_GCURVE_TTL = 600  # seconds
_gcurve_cache: dict = {"at": 0.0, "data": None}

# Cache for the OFZ-PD benchmark set (traded fixed government issues used as the
# spread-to-benchmark reference).
_OFZ_TTL = 600
_ofz_cache: dict = {"at": 0.0, "data": None}

# Classic fixed-coupon OFZ (ОФЗ-ПД) SECIDs start with SU26. Excludes floaters
# (SU29), linkers (SU52) and amortized (SU46), whose YTM is not curve-comparable.
_OFZ_PD_PREFIX = "SU26"

# Current CBR key rate — the policy rate that anchors the sandbox forecast. The
# КБД short end (~13–14%) is NOT the key rate, so we read it live from the CBR
# SOAP service and cache for 6h.
_KEY_RATE_TTL = 21600
_key_rate_cache: dict = {"at": 0.0, "val": None}


def cbr_key_rate() -> Optional[float]:
    """Latest published CBR key rate (%), live from cbr.ru; cached, best-effort."""
    import re as _re
    now = time.time()
    if _key_rate_cache["val"] is not None and (now - _key_rate_cache["at"] < _KEY_RATE_TTL):
        return _key_rate_cache["val"]
    frm = (date.today() - timedelta(days=40)).strftime("%Y-%m-%dT00:00:00")
    to = date.today().strftime("%Y-%m-%dT00:00:00")
    body = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">'
        '<soap:Body><KeyRate xmlns="http://web.cbr.ru/">'
        f'<fromDate>{frm}</fromDate><ToDate>{to}</ToDate>'
        '</KeyRate></soap:Body></soap:Envelope>'
    )
    try:
        import requests
        r = requests.post(
            "https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx",
            data=body.encode("utf-8"), timeout=20,
            headers={"Content-Type": "text/xml; charset=utf-8",
                     "SOAPAction": "http://web.cbr.ru/KeyRate"})
        # Rows come newest-first (rowOrder 0 = latest) → first <Rate> is current.
        m = _re.search(r"<Rate>([\d.]+)</Rate>", r.text)
        if m:
            _key_rate_cache.update(val=round(float(m.group(1)), 2), at=now)
    except Exception:  # noqa: BLE001 — best-effort; fall back to any cached value
        log.warning("CBR key-rate fetch failed")
    return _key_rate_cache["val"]


# --------------------------------------------------------------------------- #
# G-curve helpers
# --------------------------------------------------------------------------- #
_STALE_RETRY_S = 120      # после сбоя MOEX отдаём прошлые данные и повторяем не чаще раза в 2 мин


def gcurve(force: bool = False) -> dict:
    """КБД (кэш). При недоступности MOEX — последние полученные данные (stale-on-error):
    _row / скринер / идеи не должны висеть на сетевых таймаутах."""
    now = time.time()
    if not force and _gcurve_cache["data"] and (now - _gcurve_cache["at"] < _GCURVE_TTL):
        return _gcurve_cache["data"]
    if not force and _gcurve_cache["data"] and now - _gcurve_cache.get("fail_at", 0) < _STALE_RETRY_S:
        return _gcurve_cache["data"]
    try:
        data = moex.get_gcurve()
    except Exception as e:  # noqa: BLE001
        if _gcurve_cache["data"]:
            log.warning("КБД недоступна (%s) — отдаю прошлую", e)
            _gcurve_cache["fail_at"] = now
            return _gcurve_cache["data"]
        raise
    if not (data or {}).get("tenors") and _gcurve_cache["data"]:
        _gcurve_cache["fail_at"] = now
        return _gcurve_cache["data"]
    _gcurve_cache.update(at=now, data=data)
    return data


def ofz_benchmarks(force: bool = False) -> list[dict]:
    """Traded fixed OFZ-PD issues, as {secid, name, ytm, duration_years, years},
    sorted by maturity. This is the reference set for the spread-to-benchmark
    calculation — сопоставление по СРОКУ ДО ПОГАШЕНИЯ (дате погашения)."""
    now = time.time()
    if not force and _ofz_cache["data"] and (now - _ofz_cache["at"] < _OFZ_TTL):
        return _ofz_cache["data"]
    if not force and _ofz_cache["data"] and now - _ofz_cache.get("fail_at", 0) < _STALE_RETRY_S:
        return _ofz_cache["data"]
    try:
        rows = moex.get_board_securities(moex.OFZ_BOARD)
    except Exception as e:  # noqa: BLE001 — stale-on-error, как у КБД
        if _ofz_cache["data"]:
            log.warning("бенчмарки ОФЗ недоступны (%s) — отдаю прошлые", e)
            _ofz_cache["fail_at"] = now
            return _ofz_cache["data"]
        raise
    # Benchmarks use the same checked cash-flow basis as corporate fixes.
    from . import zspread
    checked_rows = []
    for r in rows:
        if not (r.get("secid") or "").startswith(_OFZ_PD_PREFIX):
            continue
        result = zspread.ytm_dur(r.get("isin") or r["secid"], price=_clean_price(r)[0],
                                accint=r.get("accint"), face=r.get("facevalue"),
                                settledate=r.get("settledate"))
        if result:
            checked_rows.append({**r, "yield": result[0], "duration": result[1] * 365})
    rows = checked_rows
    bench = sorted(
        ({"secid": r["secid"], "name": r.get("shortname"),
          "ytm": r["yield"], "duration_years": r["duration"] / 365.0,
          "years": _years_to(r.get("matdate")), "matdate": r.get("matdate")}
         for r in rows
         if (r.get("secid") or "").startswith(_OFZ_PD_PREFIX)
         and r.get("yield") and r.get("duration")),
        key=lambda x: x.get("years") or x["duration_years"],
    )
    if not bench and _ofz_cache["data"]:          # пустой ответ вне торгов/сбой — не затираем
        _ofz_cache["fail_at"] = now
        return _ofz_cache["data"]
    _ofz_cache.update(at=now, data=bench)
    return bench


def nearest_ofz(years: Optional[float], bench: Optional[list[dict]] = None, by: str = "years") -> Optional[dict]:
    """Pick the OFZ-PD benchmark closest to the bond. by="duration" — по ДЮРАЦИИ (как G-спред
    и MOEX): корректно для бумаг с офертой и амортизацией, где доходность считается к оферте /
    по графику, а срок до погашения намного длиннее реального. by="years" — по сроку до погашения."""
    if years is None:
        return None
    bench = bench if bench is not None else ofz_benchmarks()
    if not bench:
        return None
    if by == "duration":
        with_dur = [b for b in bench if b.get("duration_years")]
        if with_dur:
            return min(with_dur, key=lambda b: abs(b["duration_years"] - years))
    with_years = [b for b in bench if b.get("years")]
    if with_years:
        return min(with_years, key=lambda b: abs(b["years"] - years))
    return min(bench, key=lambda b: abs(b["duration_years"] - years))


def gcurve_yield(years: float, curve: Optional[dict] = None) -> Optional[float]:
    """Interpolate the G-curve yield (%) at `years`. Linear between published
    tenors; clamped (flat) beyond the first/last tenor."""
    if years is None or years <= 0:
        return None
    tenors = (curve or gcurve())["tenors"]
    pts = [(t["period_years"], t["yield_pct"]) for t in tenors
           if t["period_years"] is not None and t["yield_pct"] is not None]
    if not pts:
        return None
    if years <= pts[0][0]:
        return pts[0][1]
    if years >= pts[-1][0]:
        return pts[-1][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= years <= x1:
            w = (years - x0) / (x1 - x0) if x1 != x0 else 0.0
            return y0 + w * (y1 - y0)
    return pts[-1][1]


# --------------------------------------------------------------------------- #
# Classification
# --------------------------------------------------------------------------- #
def classify(bond_type: Optional[str], future_coupons: list[dict]) -> dict:
    """Decide fixed vs floater vs discount/linker.

    Primary signal: the ISS `BOND_TYPE` reference label. Fallback: a floater
    has at least one FUTURE coupon whose rate (valueprc) is not yet set."""
    bt = (bond_type or "").strip().lower()
    kind, label = "unknown", bond_type or "—"
    if bt:
        if "флоат" in bt or "плава" in bt:
            kind = "floater"
        elif "фикс" in bt:
            kind = "fixed"
        elif "дисконт" in bt:
            kind = "discount"
        elif "индекс" in bt:
            kind = "linker"
        label = bond_type

    # BONDTYPE is authoritative. Only when it gave NO signal (unknown) do we fall
    # back to the coupon schedule. A bond ISS labels «фикс» stays fixed even if a
    # post-offer coupon isn't published yet ("Фикс с неизвестным купоном") — the old
    # code wrongly flipped ~13% of such fixes to floater, disagreeing with the screener.
    if kind == "unknown":
        undetermined = any(c.get("valueprc") is None for c in future_coupons)
        if undetermined:
            kind = "floater"
            if not label or label == "—":
                label = "Флоатер"
        elif future_coupons:
            kind = "fixed"
            if not label or label == "—":
                label = "Фикс"
    return {"kind": kind, "label": label}


# --------------------------------------------------------------------------- #
def _years_to(matdate: Optional[str], base: Optional[date] = None) -> Optional[float]:
    if not matdate or matdate == "0000-00-00":
        return None
    try:
        d = datetime.strptime(matdate, "%Y-%m-%d").date()
    except ValueError:
        return None
    return (d - (base or date.today())).days / 365.0


def _current_coupon_rate(quote: dict, sec_ref: dict, coupons: list[dict], today: str) -> Optional[float]:
    """Current (last-fixed) coupon rate in %. For floaters COUPONPERCENT on the
    quote already reflects the running period; fall back to the latest coupon in
    the schedule whose rate is set and whose date is nearest to today."""
    if quote.get("couponpercent"):
        return quote["couponpercent"]
    if sec_ref.get("couponpercent"):
        return sec_ref["couponpercent"]
    dated = [c for c in coupons if c.get("valueprc") is not None and c.get("date")]
    if dated:
        # the coupon covering "now" is the earliest one dated on/after today,
        # otherwise the most recent past one.
        upcoming = [c for c in dated if c["date"] >= today]
        pick = min(upcoming, key=lambda c: c["date"]) if upcoming else max(dated, key=lambda c: c["date"])
        return pick.get("valueprc")
    # Last resort: derive the annualized rate from the current coupon amount
    # (rubles) × payments-per-year / face. Needs the coupon frequency.
    cv = quote.get("couponvalue")
    face = quote.get("facevalue") or sec_ref.get("facevalue")
    freq = sec_ref.get("couponfrequency")
    if cv and face and freq:
        return cv / face * freq * 100.0
    return None


def _clean_price(quote: dict) -> tuple[Optional[float], str]:
    for field in ("last", "marketprice", "lcloseprice", "waprice", "prevprice"):
        v = quote.get(field)
        if v:
            return v, f"moex.{field}"
    return None, "none"


# --------------------------------------------------------------------------- #
# Main entry
# --------------------------------------------------------------------------- #
def analyze(isin: str, base_rate: Optional[float] = None,
            curve: Optional[dict] = None, bench: Optional[list[dict]] = None) -> dict:
    """Full analytics for one ISIN. `base_rate` (%) is the floater reference
    rate (RUONIA / key rate); if None we proxy it with the G-curve short end."""
    isin = (isin or "").strip().upper()
    curve = curve or gcurve()
    if bench is None:
        bench = ofz_benchmarks()
    today = date.today().isoformat()

    ref = moex.resolve_security(isin)
    board = ref["board"]
    secid = ref["secid"]
    quote = moex.get_current_quote(isin, board)

    # Coupon schedule (source of the fix/float signal + current coupon).
    coupons: list[dict] = []
    try:
        coupons = moex.get_bondization(secid, board).get("coupons", [])
    except moex.MoexError as e:
        log.warning("bondization failed for %s: %s", secid, e)
    future_coupons = [c for c in coupons if c.get("date") and c["date"] >= today]

    cls = classify(ref.get("bond_type"), future_coupons)
    from . import contract_terms
    if contract_terms.zero_coupon(isin):
        cls = {"kind": "discount", "label": "Дисконт"}

    matdate = quote.get("matdate") or ref.get("matdate")
    years = _years_to(matdate)
    face = quote.get("facevalue") or ref.get("facevalue") or 1000.0

    price, price_src = _clean_price(quote)
    ytm = quote.get("ytm")
    if ytm is None:
        ytm = _fallback_ytm(isin, board)
    dur_days = quote.get("duration") or quote.get("duration_yields")
    dur_years = (dur_days / 365.0) if dur_days else None
    if cls["kind"] in ("fixed", "discount"):
        from . import zspread
        hz, _ = zspread.horizon(isin, matdate, None)
        sc = zspread.schedules().get(isin) or {}
        acc = quote.get("accint")
        if acc is None and contract_terms.zero_coupon(isin):
            acc = 0.0
        if (ref.get("faceunit") or "RUB") not in ("SUR", "RUB", "RUR"):
            acc = bond_math.accrued(sc.get("c", []), _settle_date({"settledate": quote.get("settledate")}))
        result = zspread.selected_fixed_yield(isin, price=price, accint=acc, face=face,
                                             matdate=matdate, horizon=hz,
                                             settledate=quote.get("settledate"))[0] if acc is not None else None
        ytm, dur_years = result if result else (None, None)
    elif cls["kind"] == "floater":
        ytm = None  # only the explicit scenario endpoint may project unknown coupons

    out = {
        "isin": isin,
        "secid": secid,
        "board": board,
        "name": quote.get("shortname") or ref.get("shortname") or ref.get("name") or isin,
        "kind": cls["kind"],
        "type_label": cls["label"],
        "matdate": matdate,
        "years_to_maturity": _round(years, 2),
        "face": face,
        "price": _round(price, 3),
        "price_source": price_src,
        "accint": quote.get("accint"),
        "ytm": _round(ytm, 2),
        "duration_years": _round(dur_years, 2),
        "next_coupon": quote.get("nextcoupon") or ref.get("nextcoupon"),
        "current_coupon_pct": None,
        # (1) G-spread to the zero-coupon curve (КБД)
        "g_spread_bp": None,
        "gcurve_yield": None,
        "g_spread_basis": None,
        # (2) spread to the nearest traded OFZ-PD by duration (benchmark issue)
        "benchmark_ofz": None,
        "benchmark_ofz_ytm": None,
        "benchmark_ofz_duration": None,
        "spread_to_ofz_bp": None,
        # floater metrics
        "base_rate": None,
        "base_rate_source": None,
        "spread_to_base_bp": None,
        "simple_margin_bp": None,
    }

    if cls["kind"] == "floater":
        _fill_floater(out, quote, ref, coupons, today, price, years, base_rate, curve)
    else:
        _fill_fixed(out, ytm, years, dur_years, curve, bench)

    return out


def _fill_fixed(out: dict, ytm, years, dur_years, curve, bench) -> None:
    # (1) G-spread to КБД. RU-market convention: interpolate the G-curve at the
    # bond's DURATION (duration-matched), which keeps an OFZ near zero and
    # isolates the credit spread for corporates. Fall back to maturity.
    basis_years = dur_years or years
    basis = "duration" if dur_years else ("maturity" if years else None)
    g_at = gcurve_yield(basis_years, curve) if basis_years else None
    out["gcurve_yield"] = _round(g_at, 2)
    out["g_spread_basis"] = basis
    if ytm is not None and g_at is not None:
        out["g_spread_bp"] = round((ytm - g_at) * 100.0)
    if years:
        out["gcurve_yield_at_maturity"] = _round(gcurve_yield(years, curve), 2)

    # (2) Спред к ближайшей торгуемой ОФЗ-ПД — по ДЮРАЦИИ (как в скринере и G-спреде: доходность
    # MOEX считается к оферте / по графику амортизации); без дюрации — по сроку до погашения
    ref_ofz = nearest_ofz(dur_years, bench, by="duration") if dur_years else nearest_ofz(years, bench)
    if ref_ofz:
        out["benchmark_ofz"] = ref_ofz.get("name") or ref_ofz.get("secid")
        out["benchmark_ofz_ytm"] = _round(ref_ofz["ytm"], 2)
        out["benchmark_ofz_duration"] = _round(ref_ofz["duration_years"], 2)
        if ytm is not None:
            out["spread_to_ofz_bp"] = round((ytm - ref_ofz["ytm"]) * 100.0)


def simple_margin_bp(price: Optional[float], years: Optional[float],
                     quoted_margin: Optional[float]) -> Optional[int]:
    """Simple margin (bp), Fabozzi / broker methodology:

        SM = ( QM + (100 − P) / M ) × (100 / P)

    QM — the floater's contractual quoted margin over its reference index
    (dohod frnIndexAdd), P — clean price (% of par), M — years to maturity.
    The pull-to-par term captures the capital gain/loss amortized over the life;
    scaling by 100/P expresses the margin on invested capital. No base-rate proxy
    is needed — QM already is the spread over the actual index (key rate/RUONIA)."""
    if price is None or quoted_margin is None or price <= 0:
        return None
    # No/undefined maturity (perpetuals, MOEX matdate 0000-00-00): drop the
    # pull-to-par term and report the quoted margin on invested capital.
    pull_to_par = (100.0 - price) / years if (years and years > 0) else 0.0
    return round((quoted_margin + pull_to_par) * (100.0 / price) * 100.0)


def _fill_floater(out, quote, ref, coupons, today, price, years, base_rate, curve) -> None:
    cur = _current_coupon_rate(quote, ref, coupons, today)
    out["current_coupon_pct"] = _round(cur, 2)

    # Base rate: explicit input, else G-curve short end (~3M) as a market proxy.
    if base_rate is not None:
        out["base_rate"] = _round(base_rate, 2)
        out["base_rate_source"] = "input"
    else:
        short = curve["tenors"][0]["yield_pct"] if curve["tenors"] else None
        out["base_rate"] = _round(short, 2)
        out["base_rate_source"] = "gcurve_short" if short is not None else None
    base = out["base_rate"]

    spread = (cur - base) if (cur is not None and base is not None) else None
    if spread is not None:
        out["spread_to_base_bp"] = round(spread * 100.0)
    # analyze() has no dohod frnIndexAdd, so use the implied margin (coupon−base)
    # as a proxy quoted margin. The cached snapshot uses the real frnIndexAdd.
    out["simple_margin_bp"] = simple_margin_bp(price, years, spread)
    if price:
        out["current_yield"] = _round(cur / price * 100.0, 2) if cur else None


def _fallback_ytm(isin: str, board: str) -> Optional[float]:
    """When the live quote has no YTM (off-hours / illiquid), take the last
    published effective yield from history."""
    from datetime import timedelta
    till = date.today()
    frm = (till - timedelta(days=30)).isoformat()
    try:
        rows = [r for r in moex.get_yield_history(isin, board, frm, till.isoformat())
                if r.get("yield_close") is not None]
    except moex.MoexError:
        return None
    return rows[-1]["yield_close"] if rows else None


def _round(v, d):
    return round(v, d) if isinstance(v, (int, float)) else v


# --------------------------------------------------------------------------- #
# Historical КБД (monthly snapshots, issuer-independent → cached once)
# --------------------------------------------------------------------------- #
_KBD_HIST_TTL = 6 * 3600
_kbd_hist_cache: dict = {"at": 0.0, "data": None}


def kbd_history(months: int = 120) -> list[dict]:
    """Monthly snapshots of the КБД via zcyc?date=. Same for every bond, so
    fetched once and reused. Each item: {date, tenors:[{period_years,yield_pct}]}.

    Покрываем ~10 лет: иначе исторический G-спред длинных бумаг (ОФЗ, старые корп)
    считается против ЧУЖОЙ (недавней) кривой и даёт абсурдный минус (−500…−900 б.п.).
    120 месячных снимков тянем ПАРАЛЛЕЛЬНО (кэшируется, поэтому цена разовая)."""
    from datetime import timedelta
    from concurrent.futures import ThreadPoolExecutor
    now = time.time()
    if _kbd_hist_cache["data"] and now - _kbd_hist_cache["at"] < _KBD_HIST_TTL:
        return _kbd_hist_cache["data"]
    dates = [(date.today() - timedelta(days=30 * i)).isoformat() for i in range(months)]

    def _fetch(ds: str):
        try:
            payload = moex._get("engines/stock/zcyc.json", {"iss.only": "yearyields", "date": ds})
            rows = moex._block(payload, "yearyields")
            tenors = sorted(({"period_years": moex._to_float(r.get("period")),
                              "yield_pct": moex._to_float(r.get("value"))} for r in rows
                             if moex._to_float(r.get("period")) is not None),
                            key=lambda x: x["period_years"])
            if tenors:
                return {"date": rows[0].get("tradedate") or ds, "tenors": tenors}
        except moex.MoexError:
            pass
        return None
    with ThreadPoolExecutor(max_workers=8) as ex:
        out = [s for s in ex.map(_fetch, dates) if s]
    out.sort(key=lambda s: s["date"])
    if out:
        _kbd_hist_cache.update(at=now, data=out)
    return out


def _kbd_on(snaps: list[dict], on_date: str, years: Optional[float]) -> Optional[float]:
    """КБД yield at `years` on `on_date`, linearly interpolated in TIME between the
    two bracketing monthly snapshots (avoids step artifacts at month boundaries)."""
    if not snaps or years is None:
        return None
    lo = [s for s in snaps if s["date"] <= on_date]
    hi = [s for s in snaps if s["date"] > on_date]
    # Дата раньше самой ранней КБД — НЕ экстраполируем на чужую (недавнюю) кривую:
    # иначе старая доходность 7-8% минус свежая КБД 14-15% = абсурдный G-спред −700 б.п.
    if not lo:
        return None
    left = lo[-1]
    if not hi:
        return gcurve_yield(years, {"tenors": left["tenors"]})
    right = hi[0]
    yl = gcurve_yield(years, {"tenors": left["tenors"]})
    yr = gcurve_yield(years, {"tenors": right["tenors"]})
    if yl is None or yr is None:
        return yl if yl is not None else yr
    from datetime import datetime as _dt
    try:
        t0 = _dt.strptime(left["date"], "%Y-%m-%d").date()
        t1 = _dt.strptime(right["date"], "%Y-%m-%d").date()
        td = _dt.strptime(on_date, "%Y-%m-%d").date()
        span = (t1 - t0).days or 1
        w = max(0.0, min(1.0, (td - t0).days / span))
    except ValueError:
        w = 0.0
    return yl + w * (yr - yl)


# --------------------------------------------------------------------------- #
# YTM from an arbitrary price (what-if calculator on the issue card)
# --------------------------------------------------------------------------- #
_bond_cf_cache: dict = {}   # secid -> (ts, {coupons, amortizations, face, accint})


def _bond_cashflows(isin: str) -> dict:
    ref = moex.resolve_security(isin)
    secid, board = ref["secid"], ref["board"]
    hit = _bond_cf_cache.get(secid)
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    bz = moex.get_bondization(secid, board)
    q = moex.get_current_quote(isin, board)
    data = {"isin": isin, "coupons": bz.get("coupons", []), "amortizations": bz.get("amortizations", []),
            "require_complete_schedule": True,
            "settledate": q.get("settledate"),
            "offers": bz.get("offers", []),          # put/call schedule from MOEX
            "face": q.get("facevalue") or ref.get("facevalue") or 1000.0,
            "accint": q.get("accint"), "matdate": q.get("matdate") or ref.get("matdate"),
            "price": _clean_price(q)[0]}
    if (ref.get("faceunit") or "RUB") not in ("SUR", "RUB", "RUR"):
        data["accint"] = _accrued_from_schedule(data, _settle_date(data))
    _bond_cf_cache[secid] = (time.time(), data)
    return data


def next_offer(cf: dict) -> Optional[dict]:
    """The nearest future put/call offer from the MOEX schedule, if any."""
    from datetime import datetime as _dt
    today = date.today()
    fut = []
    for o in cf.get("offers", []):
        d = o.get("date")
        if not d:
            continue
        try:
            od = _dt.strptime(d, "%Y-%m-%d").date()
        except ValueError:
            continue
        if od > today:
            fut.append({"date": d, "price": o.get("price"), "type": o.get("type")})
    return min(fut, key=lambda x: x["date"]) if fut else None


def _settle_date(cf: dict) -> date:
    """Дата расчётов T+1 (как у MOEX: доходность и НКД считаются на дату расчётов), выходные
    пропускаем. Если MOEX передал SETTLEDATE — берём его."""
    from datetime import datetime as _dt, timedelta as _td
    sd = cf.get("settledate")
    if sd:
        try:
            return _dt.strptime(sd, "%Y-%m-%d").date()
        except ValueError:
            pass
    d = date.today() + _td(days=1)
    while d.weekday() >= 5:
        d += _td(days=1)
    return d


def _accrued_from_schedule(cf: dict, settle: date) -> Optional[float]:
    """НКД на дату расчётов по графику купонов — в ВАЛЮТЕ НОМИНАЛА. MOEX на рублёвых досках
    отдаёт НКД валютных бумаг в рублях (НОВАТЭК1Р2: 37,96 ₽ при номинале 100 USD) — складывать
    его с ценой в валюте нельзя."""
    from datetime import datetime as _dt
    rows = []
    for c in cf.get("coupons", []):
        try:
            rows.append((_dt.strptime(c["date"], "%Y-%m-%d").date(), c.get("value")))
        except (ValueError, TypeError, KeyError):
            continue
    rows.sort()
    nxt = next(((d, v) for d, v in rows if d > settle), None)
    if not nxt or nxt[1] is None:
        return None
    prev = max((d for d, _ in rows if d <= settle), default=None)
    if prev is None:
        return None
    period = (nxt[0] - prev).days
    return nxt[1] * (settle - prev).days / period if period > 0 else None


def ytm_from_price(clean_price: float, cf: dict, until: Optional[str] = None,
                   redeem_price: float = 100.0) -> Optional[float]:
    """Effective annual yield (%) implied by a clean price (% of face), solved from
    the coupon/amortization schedule via bisection. Отсчёт — от даты расчётов T+1.

    If `until` (a YYYY-MM-DD offer date) is given, computes yield-TO-OFFER: купоны и
    амортизации до оферты включительно, в дату оферты гасится ОСТАТОК номинала по
    `redeem_price` (% of face). Без оферты — к погашению; если какой-то будущий купон ещё
    не определён (после оферты), доходность к погашению не считается (вернёт None)."""
    from datetime import datetime as _dt
    today = _settle_date(cf)
    face = cf.get("face") or 1000.0
    from . import contract_terms
    zero = contract_terms.zero_coupon(cf.get("isin"))
    if zero:
        # Same fail-closed contract gate as the screener, using this endpoint's
        # actual schedule. No synthetic principal or inferred zero coupons.
        if until or cf.get("coupons") or cf.get("matdate") != zero.get("maturity"):
            return None
        raw_amorts = [(a.get("date"), a.get("value")) for a in cf.get("amortizations", [])]
        checked = bond_math.principal(face, raw_amorts, today)
        acc = cf.get("accint")
        if (not checked or len(checked[0]) != 1 or checked[0][0][0] != zero.get("maturity")
                or abs(checked[1] - zero.get("face", 0)) > .005
                or (acc is not None and (not math.isfinite(float(acc)) or abs(float(acc)) > .005))):
            return None
        result = bond_math.solve([(zero.get("payment_date", checked[0][0][0]),checked[1])], clean_price / 100 * checked[1], today)
        return result[0] if result else None
    horizon = None
    if until:
        try:
            horizon = _dt.strptime(until, "%Y-%m-%d").date()
        except ValueError:
            horizon = None
        if horizon is None or horizon <= today:
            return None
    flows: list[tuple[float, float]] = []          # (years, amount in face currency)
    seen_coupons = {}
    for c in cf.get("coupons", []):
        d, v = c.get("date"), c.get("value")
        if d in seen_coupons:
            if seen_coupons[d] != v:
                return None
            continue
        seen_coupons[d] = v
        if not d:
            continue
        try:
            cd = _dt.strptime(d, "%Y-%m-%d").date()
        except ValueError:
            continue
        if cd > today and (horizon is None or cd <= horizon):
            if v is None:
                return None  # an unknown coupon before the chosen horizon cannot be skipped
            flows.append(((cd - today).days / 365.0, v))
    amorts = []
    for a in cf.get("amortizations", []):
        try:
            amorts.append((a.get("date"), a.get("value")))
        except (ValueError, TypeError):
            continue
    principal = bond_math.principal(face, amorts, today, cf.get("matdate"), bullet=not amorts)
    if principal is None:
        return None
    amorts, face = principal
    if cf.get("require_complete_schedule"):
        chain = [(c.get("date"), c.get("startdate"), c.get("value")) for c in cf.get("coupons", [])]
        if not bond_math.coupon_chain(chain, today, until or amorts[-1][0]):
            return None
    if horizon is not None:
        # амортизации ДО оферты выплачиваются по графику, в оферту — остаток номинала
        rest = 0.0
        for ds, v in amorts:
            ad = date.fromisoformat(ds)
            if today < ad <= horizon:
                flows.append(((ad - today).days / 365.0, v))
            elif ad > horizon:
                rest += v
        flows.append(((horizon - today).days / 365.0, redeem_price / 100.0 * rest))
    else:
        for ds, v in amorts:
            ad = date.fromisoformat(ds)
            if ad > today:
                flows.append(((ad - today).days / 365.0, v))
    if not flows:
        return None
    acc = cf.get("accint")
    if acc is None:
        acc = _accrued_from_schedule(cf, today)
    if acc is None:
        return None
    dirty = clean_price / 100.0 * face + acc

    dated = [((today + timedelta(days=round(t * 365))).isoformat(), amt) for t, amt in flows]
    solved = bond_math.solve(dated, dirty, today)
    return solved[0] if solved else None


# --------------------------------------------------------------------------- #
# Full history for the issue card: YTM, price, and BOTH historical spreads
# --------------------------------------------------------------------------- #
def liquidity_detail(isin: str) -> dict:
    """Liquidity from MOEX daily history: avg/median daily turnover, days traded
    and trades/day over the last 30 and 180 calendar days, plus a class."""
    from datetime import timedelta
    from statistics import mean, median
    ref = moex.resolve_security(isin)
    board = ref["board"]
    till = date.today()
    frm = (till - timedelta(days=200)).isoformat()
    rows = [r for r in moex.get_price_history(isin, board, frm, till.isoformat()) if r.get("date")]

    def window(n):
        cutoff = (till - timedelta(days=n)).isoformat()
        w = [r for r in rows if r["date"] >= cutoff]
        traded = [r for r in w if (r.get("value") or 0) > 0 or (r.get("numtrades") or 0) > 0]
        vals = [r["value"] for r in traded if r.get("value")]
        nts = [r["numtrades"] for r in traded if r.get("numtrades")]
        return {"avg_value": round(mean(vals)) if vals else 0,
                "median_value": round(median(vals)) if vals else 0,
                "days_traded": len(traded), "sessions": len(w),
                "trades_per_day": round(mean(nts)) if nts else 0}

    d30, d180 = window(30), window(180)
    avg, dt = d30["avg_value"], d30["days_traded"]
    cls = ("Высокая" if avg >= 30e6 and dt >= 18 else
           "Средняя" if avg >= 3e6 and dt >= 7 else "Низкая")
    return {"isin": isin, "liq_class": cls, "d30": d30, "d180": d180}


_PERIOD_DAYS = {12: 30, 6: 60, 4: 91, 3: 121, 2: 182, 1: 365}


def model_emission(coupon_pct: float, frequency: int = 2, years: float = 3.0,
                   price_pct: float = 100.0) -> dict:
    """New-issue modelling (as in the «Моделирование эмиссии» sheet): from a
    coupon, coupon frequency and tenor, build the cashflow schedule and solve the
    YTM (IRR, ACT/365) at the given price. Returns YTM, duration and coupon in rub.

    Coupon per period (rub) = coupon/365 · period_days · 1000, matching the model."""
    freq = int(frequency) if frequency else 2
    period_days = _PERIOD_DAYS.get(freq, max(1, round(365 / freq)))
    coupon_rub = coupon_pct / 100.0 / 365.0 * period_days * 1000.0
    n = max(1, int(round(years * freq)))
    flows = []  # (t_years, rub)
    for k in range(1, n + 1):
        t = k * period_days / 365.0
        flows.append((t, coupon_rub + (1000.0 if k == n else 0.0)))
    dirty0 = price_pct / 100.0 * 1000.0

    def npv(y):
        return sum(a / (1.0 + y) ** t for t, a in flows) - dirty0

    lo, hi = -0.95, 6.0
    flo, fhi = npv(lo), npv(hi)
    if flo * fhi > 0:
        return {"coupon": coupon_pct, "frequency": freq, "years": years,
                "price": price_pct, "ytm": None, "duration": None,
                "coupon_rub": round(coupon_rub, 2)}
    for _ in range(100):
        mid = (lo + hi) / 2
        fm = npv(mid)
        if abs(fm) < 1e-7:
            break
        if flo * fm < 0:
            hi, fhi = mid, fm
        else:
            lo, flo = mid, fm
    ytm = (lo + hi) / 2
    pv = [a / (1.0 + ytm) ** t for t, a in flows]
    total = sum(pv) or 1.0
    dur = sum(t * p for (t, _), p in zip(flows, pv)) / total
    return {"coupon": coupon_pct, "frequency": freq, "years": years, "price": price_pct,
            "ytm": round(ytm * 100.0, 2), "duration": round(dur, 2),
            "coupon_rub": round(coupon_rub, 2)}


def coupon_for_ytm(target_ytm_pct: float, frequency: int = 2, years: float = 3.0,
                   price_pct: float = 100.0) -> dict:
    """Inverse of model_emission: the coupon (%) that yields the target YTM at the
    given price. Used to model a placement from a target YTM or G-spread."""
    lo, hi = 0.0, 80.0
    for _ in range(60):
        mid = (lo + hi) / 2
        y = model_emission(mid, frequency, years, price_pct).get("ytm")
        if y is None:
            break
        if y < target_ytm_pct:
            lo = mid
        else:
            hi = mid
    coupon = round((lo + hi) / 2, 2)
    m = model_emission(coupon, frequency, years, price_pct)
    return {"coupon": coupon, "ytm": m.get("ytm"), "duration": m.get("duration"),
            "frequency": frequency, "years": years, "price": price_pct}


def ytm_at_price(isin: str, price: float, accint: Optional[float] = None) -> dict:
    """Yields the bond would have at the given CLEAN price: to maturity and, if it
    has a put/call, to the nearest offer. YTM is on the DIRTY price, so the accrued
    interest matters — `get_current_quote` sometimes returns none, so the caller
    (which has the market snapshot) can pass the real НКД to override it."""
    cf = _bond_cashflows(isin)
    if accint is not None and cf.get("accint") is None:
        cf = {**cf, "accint": accint}
    ytm = ytm_from_price(price, cf)
    offer = next_offer(cf)
    ytp = None
    if offer and offer["price"] is not None:
        ytp = ytm_from_price(price, cf, until=offer["date"], redeem_price=offer["price"])
    # The issue card can select a reviewed CALL absent from ISS's offer block.
    # Keep the what-if calculator on exactly that contractual horizon as well.
    from . import zspread, contract_terms
    hz, _ = zspread.horizon(isin, cf.get("matdate"))
    if hz and zspread.horizon_type(isin, hz) == "CALL":
        sc = zspread.schedules().get(isin) or {}
        call_price = sc.get("op", {}).get(hz)
        if call_price is None:
            call_price = contract_terms.redemption_price(isin, hz)
        offer = {"date": hz, "price": call_price, "type": "CALL", "conditional_on_issuer_exercise": True}
        result = zspread.ytm_dur(isin, price=price, accint=cf.get("accint"), face=cf.get("face"),
                                horizon=hz, settledate=cf.get("settledate")) if call_price is not None else None
        ytp = result[0] if result else None
    return {"ytm": ytm, "ytp": ytp, "offer": offer}


_ISSUE_HIST_CACHE: dict = {}   # (isin, frm, qm) -> (ts, result)
_ISSUE_HIST_LOCKS: dict = {}


def _key_lock(locks: dict, key):
    """Замок на ключ: параллельные запросы одной бумаги ждут первый, а не качают её заново."""
    import threading
    lk = locks.get(key)
    if lk is None:
        lk = locks.setdefault(key, threading.Lock())
    if len(locks) > 500:            # замки дешёвые, но не копим бесконечно
        for k in list(locks)[:250]:
            if k != key and not locks[k].locked():
                locks.pop(k, None)
    return lk
_ISSUE_HIST_TTL = 6 * 3600     # история MOEX меняется раз в день; 6ч TTL с запасом
_OFZ_YH_CACHE: dict = {}       # (secid, frm) -> (ts, rows); бенчмарк ОФЗ общий для многих бумаг


def _ofz_yield_hist_cached(secid: str, frm: str, till: str) -> list:
    import time as _t
    _k = (secid, frm)
    _h = _OFZ_YH_CACHE.get(_k)
    if _h and _t.time() - _h[0] < _ISSUE_HIST_TTL:
        return _h[1]
    # в кэше только дата и доходность: историй ОФЗ три десятка, полные строки заняли бы десятки МБ
    _rows = [{"date": r["date"], "yield_close": r.get("yield_close")}
             for r in moex.get_yield_history(secid, moex.OFZ_BOARD, frm, till)]
    _OFZ_YH_CACHE[_k] = (_t.time(), _rows)
    return _rows


def prewarm_ofz_histories() -> int:
    """История доходностей всех бенчмарк-ОФЗ: спред к ОФЗ в карточке любого выпуска
    тогда считается без ожидания длинной истории госбумаги."""
    from concurrent.futures import ThreadPoolExecutor
    today = date.today().isoformat()
    secs = [b["secid"] for b in ofz_benchmarks()]
    with ThreadPoolExecutor(max_workers=2) as ex:
        list(ex.map(lambda sc: _ofz_yield_hist_cached(sc, "2012-01-01", today), secs))
    return len(secs)


def issue_history(isin: str, frm: Optional[str] = None, qm: Optional[float] = None) -> dict:
    import time as _t
    _key = (isin, frm or "2012-01-01", qm)
    _hit = _ISSUE_HIST_CACHE.get(_key)
    if _hit and _t.time() - _hit[0] < _ISSUE_HIST_TTL:
        return _hit[1]
    # одна и та же бумага считается один раз: запрос карточки дожидается уже идущей подготовки
    with _key_lock(_ISSUE_HIST_LOCKS, _key):
        _hit = _ISSUE_HIST_CACHE.get(_key)
        if _hit and _t.time() - _hit[0] < _ISSUE_HIST_TTL:
            return _hit[1]
        return _issue_history_store(_key, _issue_history_compute(isin, frm, qm))


def _issue_history_store(_key, _res):
    import time as _t
    _ISSUE_HIST_CACHE.pop(_key, None)
    _ISSUE_HIST_CACHE[_key] = (_t.time(), _res)
    while len(_ISSUE_HIST_CACHE) > 80:          # память: держим 80 последних открытых бумаг
        _ISSUE_HIST_CACHE.pop(next(iter(_ISSUE_HIST_CACHE)))
    return _res


def _issue_history_compute(isin: str, frm: Optional[str] = None, qm: Optional[float] = None) -> dict:
    ref = moex.resolve_security(isin)
    board = ref["board"]
    # MOEX history is keyed by SECID, not ISIN — the newest issues (e.g. ОФЗ
    # 26251) return nothing under the ISIN. Fall back to the ISIN if no SECID.
    hist_id = ref.get("secid") or isin
    today = date.today().isoformat()
    # вся доступная история бумаги (MOEX отдаёт с даты листинга)
    if not frm:
        frm = "2012-01-01"
    # Floater detection must be robust: BOND_TYPE varies ("ОФЗ-ПК", "с плавающим
    # купоном", "флоатер"…), so key on the presence of a coupon benchmark (RUONIA /
    # key-rate) — only floaters reference one — plus the usual string markers.
    _bt = (ref.get("bond_type") or "").lower()
    is_float = bool(ref.get("coupon_benchmark")) or any(
        m in _bt for m in ("флоат", "плава", "перемен", "-пк"))

    # yield и price — независимые полные истории (постранично, тяжело). Тянем ПАРАЛЛЕЛЬНО.
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=2) as _ex:
        _fy = _ex.submit(moex.get_yield_history, hist_id, board, frm, today)
        _fp = _ex.submit(moex.get_price_history, hist_id, board, frm, today)
        yh, ph = _fy.result(), _fp.result()

    # Clean series: drop absurd ticks (bad prints) that show up as chart spikes.
    price_pts = [[r["date"], r["close"]] for r in ph
                 if r.get("close") is not None and 10 < r["close"] < 200]
    # A floater has no meaningful YTM / G-spread history — only price + the
    # historical simple margin (computed from each day's price and the bond's
    # quoted margin over the remaining term).
    if is_float:
        sm_pts = []
        mat = ref.get("matdate")
        if qm is not None and mat and mat not in ("0000-00-00", ""):
            # как в скринере: SM к ближайшей пут-оферте, а не к погашению (иначе история и
            # текущий спред — разные величины и перцентиль врёт). Для каждого дня — своя
            # ближайшая на тот момент оферта.
            try:
                offers = sorted(o["date"] for o in moex.get_bondization(hist_id).get("offers") or []
                                if o.get("date") and not o["date"].startswith("0000") and o["date"] < mat)
            except Exception:  # noqa: BLE001
                offers = []
            for d, px in price_pts:
                horizon = next((o for o in offers if o > d), mat)
                try:
                    yrs = (date.fromisoformat(horizon) - date.fromisoformat(d)).days / 365.0
                except ValueError:
                    continue
                if yrs <= 0:
                    continue
                sm = simple_margin_bp(px, yrs, qm)
                if sm is not None and -3000 < sm < 20000:   # коридор как у текущих метрик
                    sm_pts.append([d, sm])
        return {"isin": isin, "name": ref.get("shortname"), "kind": "floater",
                "ytm": [], "price": price_pts, "simple_margin": sm_pts,
                "gspread_kbd": [], "spread_ofz": [], "benchmark_ofz": None}

    # MOEX intermittently returns yield_close ≈ 0.03–0.05 (garbage near-zero) on
    # otherwise-normal days; those pass a 0<y filter and read as a ~0% yield. Floor
    # at 1% for the YTM chart (keeps low-yield CNY ≥1%), and at 3% for the G-spread
    # (RU yields sit near the key rate ≫3%; a 0.05% tick would fake a ≈−1500 bp spread).
    ytm_pts = [[r["date"], r["yield_close"]] for r in yh
               if r.get("yield_close") is not None and 1 < r["yield_close"] < 60]

    # (1) история G-спреда к КБД: ежедневный GSPREADBP самой MOEX (КБД того же дня на дюрации
    # бумаги); если его нет — считаем сами по снимкам КБД (раньше — только так: помесячные
    # снимки кривой давали ступеньки и расходились с текущим спредом скринера)
    has_moex = any(r.get("gspread") is not None for r in yh)
    snaps = None if has_moex else kbd_history()
    gk = []
    for r in yh:
        y, dur = r.get("yield_close"), r.get("duration")
        if y is None or not (3 < y < 60):
            continue
        if has_moex:
            g = r.get("gspread")
            if g is not None and -800 < g < 20000:       # как у текущего G-спреда
                gk.append([r["date"], round(g)])
            continue
        if dur is None:
            continue
        kb = _kbd_on(snaps, r["date"], dur / 365.0)
        if kb is not None:
            gk.append([r["date"], round((y - kb) * 100)])

    # (2) спред к бенчмарк-ОФЗ, ближайшей по ДЮРАЦИИ (так же, как в скринере)
    cur_dur = next((r["duration"] for r in reversed(yh) if r.get("duration")), None)
    bench = ofz_benchmarks()
    bond_years = _years_to(ref.get("matdate"))
    ref_ofz = nearest_ofz(cur_dur / 365.0, bench, by="duration") if cur_dur else nearest_ofz(bond_years, bench)
    go, ofz_meta = [], None
    if ref_ofz:
        ofz_meta = {"secid": ref_ofz["secid"], "name": ref_ofz.get("name"),
                    "ytm": _round(ref_ofz["ytm"], 2)}
        try:
            oy = _ofz_yield_hist_cached(ref_ofz["secid"], frm, today)
            omap = {r["date"]: r["yield_close"] for r in oy if r.get("yield_close") is not None}
            for d, y in ytm_pts:
                if d in omap:
                    go.append([d, round((y - omap[d]) * 100)])
        except moex.MoexError:
            pass

    return {"isin": isin, "name": ref.get("shortname"), "kind": "fixed",
            "ytm": ytm_pts, "price": price_pts,
            "gspread_kbd": gk, "spread_ofz": go, "benchmark_ofz": ofz_meta}


def floater_scenario_ytm(isin: str, clean_price: float, rate_path: list[dict],
                         qm: Optional[float], accint: float = 0.0) -> Optional[dict]:
    """Scenario YTM for a FLOATER: project each future coupon as (key rate at the
    period + quoted margin) using a CBR key-rate PATH (list of {date, rate}), then
    solve the IRR from the given clean price. This is the only place a floater
    gets a YTM — everywhere else its future coupons are unknown."""
    from datetime import datetime as _dt
    import math
    if not isinstance(clean_price, (int, float)) or not math.isfinite(clean_price) or clean_price <= 0:
        return None
    ref = moex.resolve_security(isin)
    if qm is None:                       # fall back to MOEX benchmark spread
        qm = ref.get("coupon_benchmark_spread")
    if qm is None or not math.isfinite(float(qm)):
        return None
    face = ref.get("facevalue") or 1000.0
    matdate = ref.get("matdate")
    try:
        bz = moex.get_bondization(ref["secid"], ref.get("board"))
        quote = moex.get_current_quote(isin, ref.get("board"))
    except moex.MoexError:
        return None
    today = _settle_date({"settledate": quote.get("settledate")})
    face = quote.get("facevalue") or face
    checked = bond_math.principal(face, [(a.get("date"), a.get("value"))
                                        for a in bz.get("amortizations", [])], today,
                                  matdate, bullet=not bz.get("amortizations"))
    if checked is None:
        return None
    amorts, face = checked
    if quote.get("accint") is None:
        return None
    accint = quote["accint"]
    try:
        path = sorted((_dt.strptime(p["date"], "%Y-%m-%d").date(), float(p["rate"])) for p in rate_path)
    except (ValueError, TypeError, KeyError):
        return None
    if not path or any(not math.isfinite(r) or r < 0 for _, r in path) or path[0][0] > today:
        return None

    def key_at(d):
        r = None
        for pd, pr in path:
            if pd <= d:
                r = pr
            else:
                break
        return r

    def projected(start, end):
        cuts = sorted({start, end} | {d for d, _ in path if start < d < end}
                      | {date.fromisoformat(d) for d, _ in amorts if start < date.fromisoformat(d) < end})
        total = 0.
        for a, b in zip(cuts, cuts[1:]):
            rate = key_at(a)
            if rate is None:
                return None
            nominal = face - sum(v for d, v in amorts if date.fromisoformat(d) <= a)
            total += nominal * (rate + qm) / 100 * (b - a).days / 365
        return total

    proj, prev = [], None
    projected_count = 0
    if not bond_math.coupon_chain([(c.get("date"), c.get("startdate")) for c in bz.get("coupons", [])], today, amorts[-1][0]):
        return None
    for c in sorted(bz.get("coupons", []), key=lambda r: r.get("date") or ""):
        try:
            cd = _dt.strptime(c["date"], "%Y-%m-%d").date()
        except (ValueError, TypeError, KeyError):
            continue
        if cd <= today:
            prev = cd
            continue
        if c.get("value") is not None:
            val = c["value"]                                   # coupon already fixed
        else:
            start = date.fromisoformat(c["startdate"]) if c.get("startdate") else prev
            if start is None or start >= cd:
                return None
            # Already accrued cash belongs in the coupon AND in the dirty entry
            # price, not in a second full-period projection at today's rate.
            val = projected(max(start, today), cd)
            if val is None:
                return None
            if start < today:
                val += accint or 0.
            projected_count += 1
        proj.append({"date": c["date"], "value": val})
        prev = cd
    if not proj:
        return None
    cf = {"coupons": proj, "amortizations": [{"date": d, "value": v} for d, v in amorts],
          "matdate": matdate, "face": face, "accint": accint, "settledate": today.isoformat()}
    y = ytm_from_price(clean_price, cf)
    solved = bond_math.solve([(c["date"], c["value"]) for c in proj] + amorts,
                             clean_price / 100 * face + (accint or 0), today)
    return {"ytm": y, "duration": solved[1] if solved else None,
            "coupons_projected": projected_count, "settledate": today.isoformat(),
            "assumptions": "CBR_RATE scenario, simple daily accrual ACT/365; no fixing lag or cap/floor modelled"}


_MM_CACHE: dict = {}          # (frm,till) -> (ts, series)
_MM_TTL = 6 * 3600


def money_market_series(frm: str, till: str) -> list[list]:
    """Накопленная доходность ДЕНЕЖНОГО РЫНКА (%) за [frm, till], нормированная к
    началу периода. Прокси — фонд ликвидности LQDT (овернайт-репо ≈ RUONIA): его
    цена и есть накопленная доходность размещения под ставку денежного рынка."""
    import time
    key = (frm, till)
    now = time.time()
    hit = _MM_CACHE.get(key)
    if hit and now - hit[0] < _MM_TTL:
        return hit[1]
    try:
        ph = [r for r in moex.get_price_history("LQDT", "TQTF", frm, till)
              if r.get("close") and r.get("date")]
    except moex.MoexError:
        ph = []
    out = []
    if len(ph) >= 2 and ph[0]["close"]:
        p0 = ph[0]["close"]
        out = [[r["date"], round((r["close"] / p0 - 1) * 100.0, 2)] for r in ph]
        # Если данные фонда отстают от конца периода (устаревшая котировка ETF),
        # продлеваем кривую до `till`, компаундя по НЕДАВНЕЙ дневной ставке фонда,
        # чтобы линия денежного рынка шла от края до края графика.
        if out and out[-1][0] < till:
            try:
                last_d = date.fromisoformat(out[-1][0])
                end_d = date.fromisoformat(till)
                # хвост (нет свежей котировки фонда) — самый недавний период, поэтому
                # компаундим по ТЕКУЩЕЙ ключевой ставке (форвардная ставка денежного
                # рынка), а не по трейлинг-доходности фонда за прошлые месяцы.
                daily = (cbr_key_rate() or 14.0) / 100.0 / 365.0
                factor = 1 + out[-1][1] / 100.0
                d = last_d + timedelta(days=1)
                while d <= end_d:
                    factor *= (1 + daily)
                    out.append([d.isoformat(), round((factor - 1) * 100.0, 2)])
                    d += timedelta(days=1)
            except (ValueError, ZeroDivisionError, TypeError):
                pass
    _MM_CACHE[key] = (now, out)
    return out


def security_total_return(isin: str, frm: Optional[str] = None, till: Optional[str] = None) -> dict:
    """Realized total return of one bond over a window, computed in PERCENT OF FACE
    (currency-neutral): dirty-value change PLUS coupons and amortizations paid in
    the window, all expressed as a share of the original nominal, over the starting
    dirty value. Excludes tax/fees/reinvestment.

    Why %-of-face and clean price (not dirty cash): MOEX quotes the clean price as
    % of nominal but reports НКД (accrued interest) and the ₽ coupon conversion in
    RUBLES even for FX bonds, whose price leg is in the foreign currency. Mixing
    those blew FX bonds up (a EUR bond's ₽ accrued interest resetting at each coupon
    produced a sawtooth chart, and its ₽ coupon ÷ EUR price gave "купон 115%").
    Working entirely in percent-of-face keeps every leg in one consistent unit."""
    ref = moex.resolve_security(isin)
    hist_id = ref.get("secid") or isin
    board = ref["board"]
    face = ref.get("facevalue") or 1000.0
    till = till or date.today().isoformat()
    if not frm:
        frm = (date.today() - timedelta(days=365)).isoformat()
    ph = [r for r in moex.get_price_history(hist_id, board, frm, till)
          if r.get("close") is not None and 10 < r["close"] < 200 and r.get("date")]
    if len(ph) < 2:
        return {"isin": isin, "detail": "недостаточно истории цен"}

    # INFLATION-LINKER (ОФЗ-ИН и корп. индексируемые): номинал индексируется, поэтому
    # чистая цена в % стоит на месте, а РУБЛЁВОЕ тело растёт. Считаем рублёвую полную
    # доходность напрямую: close% × индексируемый FACEVALUE(дата) + НКД (всё в ₽, купоны
    # тоже ₽ на индексированный номинал) — тогда рост тела попадает в доходность.
    _bt = (ref.get("bond_type") or "").lower()
    is_linker = ("индекс" in _bt or (ref.get("secid") or "").startswith("SU52")) \
        and any(r.get("facevalue") for r in ph)
    if is_linker:
        try:
            bzl = moex.get_bondization(ref["secid"], board)
        except moex.MoexError:
            bzl = {"coupons": [], "amortizations": []}
        first, last = ph[0]["date"], ph[-1]["date"]

        def _rub(r):
            return r["close"] / 100.0 * (r.get("facevalue") or face) + (r.get("accint") or 0.0)

        def _clean(r):
            return r["close"] / 100.0 * (r.get("facevalue") or face)

        v0 = _rub(ph[0])
        if v0 <= 0:
            return {"isin": isin, "detail": "нулевая стартовая цена"}
        events = []
        for c in bzl.get("coupons", []):
            d, val = c.get("date"), c.get("value")
            if d and val is not None and first < d <= last:
                events.append({"date": d, "type": "coupon", "amount": round(val, 2)})
        for a in bzl.get("amortizations", []):
            d, val = a.get("date"), a.get("value")
            if d and val is not None and first < d <= last:
                events.append({"date": d, "type": "amortization", "amount": round(val, 2)})
        events.sort(key=lambda e: e["date"])
        series = []
        for r in ph:
            paid = sum(e["amount"] for e in events if e["date"] <= r["date"])
            series.append([r["date"], round((_rub(r) + paid - v0) / v0 * 100.0, 2)])
        coupon_cash = sum(e["amount"] for e in events if e["type"] == "coupon")
        amort_cash = sum(e["amount"] for e in events if e["type"] != "coupon")
        vn = _rub(ph[-1])
        # Купонный доход = ВЫПЛАЧЕННЫЕ купоны + прирост НКД (накопленный, но ещё не
        # выплаченный купон — тоже доход держателя). Рост цены — только чистая цена
        # (у линкера это индексация номинала). Тогда «купон 0%» не появляется, если
        # за окно НКД накапал, а сумма по-прежнему сходится в полную доходность.
        accr_gain = (ph[-1].get("accint") or 0.0) - (ph[0].get("accint") or 0.0)
        income_cash = coupon_cash + accr_gain
        return {
            "isin": isin, "name": ref.get("shortname"), "from": first, "till": last,
            "total_return_pct": round((vn + coupon_cash + amort_cash - v0) / v0 * 100.0, 2),
            "capital_pct": round((_clean(ph[-1]) + amort_cash - _clean(ph[0])) / v0 * 100.0, 2),
            "price_change_pct": round((_clean(ph[-1]) - _clean(ph[0])) / v0 * 100.0, 2),
            "coupon_income": round(income_cash, 2),
            "income_pct": round(income_cash / v0 * 100.0, 2),
            "amort_return": round(amort_cash, 2),
            "amort_pct": round(amort_cash / v0 * 100.0, 2),
            "series": series, "events": events, "indexed": True,
        }

    try:
        bz = moex.get_bondization(ref["secid"], board)
    except moex.MoexError:
        bz = {"coupons": [], "amortizations": []}

    # Bondization's facevalue is the CURRENT balance, even on old coupon rows.
    # Coupon value is already cash per bond: do not scale it by that balance.
    original_face = ref.get("initialfacevalue") or next(
        (x.get("initialfacevalue") for x in bz.get("coupons", []) + bz.get("amortizations", [])
         if x.get("initialfacevalue")), None)
    if not original_face:
        # Legacy responses: recover the initial face from dated historical face
        # and the full principal schedule, not from today's reduced balance.
        for r in ph:
            repaid = sum((a.get("valueprc") or 0) for a in bz.get("amortizations", [])
                         if a.get("date") and a["date"] <= r["date"])
            if r.get("facevalue") and repaid < 100:
                original_face = r["facevalue"] / (1 - repaid / 100)
                break
    original_face = original_face or face
    # Amortization schedule (% of ORIGINAL face repaid on that date).
    amort_sched = sorted(((a["date"], a["value"] / original_face * 100 if a.get("value") is not None
                          else (a.get("valueprc") or 0.0))
                          for a in bz.get("amortizations", []) if a.get("date")), key=lambda x: x[0])

    def face_frac(d):
        """Fraction of the ORIGINAL nominal still outstanding on date d."""
        repaid = sum(prc for dt, prc in amort_sched if dt <= d)
        return max(0.0, 1.0 - repaid / 100.0)

    def clean_pct(r):
        """Clean price as % of the ORIGINAL nominal (close is % of the current,
        post-amortization nominal → scale by the outstanding fraction)."""
        outstanding = r.get("facevalue")
        return r["close"] * (outstanding / original_face if outstanding is not None
                             else face_frac(r["date"]))

    first, last = ph[0]["date"], ph[-1]["date"]

    # Full coupon schedule as (date, % of ORIGINAL face) — used to reconstruct
    # ACCRUED interest smoothly and currency-neutrally, so the cumulative-return
    # line RAMPS between coupons instead of jumping in discrete steps at each
    # payment ("рваный график"). We rebuild accrual from the schedule rather than
    # MOEX's НКД field because that field is in RUBLES even for FX bonds.
    all_cpns = sorted((c.get("date"), c["value"] / original_face * 100.0, c.get("startdate"))
                      for c in bz.get("coupons", [])
                      if c.get("date") and c.get("value") is not None)

    def accrued_pct(d):
        """Portion of the UPCOMING coupon accrued linearly since the previous
        coupon date, as % of original face — 0 on a payment date (the coupon then
        moves from accrued into the paid leg, keeping the curve continuous)."""
        nxt = next((c for c in all_cpns if c[0] > d), None)
        if not nxt:
            return 0.0
        prev = None
        for c in all_cpns:
            if c[0] <= d:
                prev = c[0]
            else:
                break
        try:
            if not (nxt[2] or prev):
                return 0.0
            start = date.fromisoformat(nxt[2] or prev)
            end = date.fromisoformat(nxt[0])
            cur = date.fromisoformat(d)
        except ValueError:
            return 0.0
        span = (end - start).days or 1
        return nxt[1] * min(1.0, max(0.0, (cur - start).days / span))

    def row_accrued_pct(r):
        # Historical ACCINT is rubles: use it only for ruble-denominated bonds.
        if (ref.get("faceunit") or "").upper() in ("RUB", "SUR") and r.get("accint") is not None:
            return r["accint"] / original_face * 100.0
        return accrued_pct(r["date"])

    def dirty_pct(r):
        return clean_pct(r) + row_accrued_pct(r)

    c0, cn = clean_pct(ph[0]), clean_pct(ph[-1])
    p0, pn = dirty_pct(ph[0]), dirty_pct(ph[-1])
    if p0 <= 0:
        return {"isin": isin, "detail": "нулевая стартовая цена"}

    # Coupons & amortizations PAID in the window, as % of the ORIGINAL face.
    events = []
    for c in bz.get("coupons", []):
        d, val = c.get("date"), c.get("value")
        if not (d and first < d <= last) or val is None:
            continue
        pct = val / original_face * 100.0
        events.append({"date": d, "type": "coupon", "pct": round(pct, 4), "amount": round(val, 2)})
    for a in bz.get("amortizations", []):
        d = a.get("date")
        prc = a["value"] / original_face * 100.0 if a.get("value") is not None else a.get("valueprc")
        if not (d and first < d <= last) or not prc:
            continue
        events.append({"date": d, "type": "amortization", "pct": round(prc, 4),
                       "amount": round(a["value"] if a.get("value") is not None else prc * original_face / 100, 2)})
    events.sort(key=lambda e: e["date"])

    series = []
    for r in ph:
        paid = sum(e["pct"] for e in events if e["date"] <= r["date"])
        series.append([r["date"], round((dirty_pct(r) + paid - p0) / p0 * 100.0, 2)])
    coupon_pct = sum(e["pct"] for e in events if e["type"] == "coupon")
    amort_pct = sum(e["pct"] for e in events if e["type"] != "coupon")
    # Decomposition (total = capital + income, identity preserved):
    #  • КУПОННЫЙ ДОХОД = выплаченные купоны + ПРИРОСТ НКД за окно (накопленный, но
    #    ещё не выплаченный купон — тоже доход держателя), поэтому «купон 0%» не
    #    возникает, когда за период НКД накапал, а выплаты ещё не было.
    #  • РОСТ ЦЕНЫ = только чистая цена (+ возврат номинала по амортизации).
    accr_gain = (pn - cn) - (p0 - c0)                 # прирост НКД, % от номинала
    income_pct_face = coupon_pct + accr_gain
    return {
        "isin": isin, "name": ref.get("shortname"), "from": first, "till": last,
        "total_return_pct": round((pn + coupon_pct + amort_pct - p0) / p0 * 100.0, 2),
        "capital_pct": round((cn + amort_pct - c0) / p0 * 100.0, 2),
        "price_change_pct": round((cn - c0) / p0 * 100.0, 2),
        "coupon_income": round(income_pct_face * original_face / 100.0, 2),
        "income_pct": round(income_pct_face / p0 * 100.0, 2),
        "amort_return": round(amort_pct * original_face / 100.0, 2),
        "amort_pct": round(amort_pct / p0 * 100.0, 2),
        "series": series, "events": events,
        "initial_face": original_face,
        "start_dirty_value": round(p0 * original_face / 100, 6),
        "end_dirty_value": round(pn * original_face / 100, 6),
    }


# --------------------------------------------------------------------------- #
def screen(isins: list[str], base_rate: Optional[float] = None) -> dict:
    """Analyze a list of ISINs against a single G-curve snapshot."""
    curve = gcurve()
    bench = ofz_benchmarks()
    rows, errors = [], []
    for isin in isins:
        try:
            rows.append(analyze(isin, base_rate=base_rate, curve=curve, bench=bench))
        except moex.MoexError as e:
            errors.append({"isin": isin, "error": str(e)})
        except Exception as e:  # noqa: BLE001 — one bad ISIN must not kill the batch
            log.exception("analyze failed for %s", isin)
            errors.append({"isin": isin, "error": repr(e)})
    return {"curve": curve, "rows": rows, "errors": errors,
            "base_rate": base_rate}
