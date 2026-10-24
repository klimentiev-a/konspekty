"""Z-спред к кривой RUONIA OIS — единая метрика для фиксов и флоатеров.

Методика (как у Эйлера / Андромеды, «Один спред на всех», 25.09.2026):
  Pclean + НКД = Σ CFᵢ / (1 + yᵢ + z)^tᵢ,   yᵢ = Dᵢ^(−1/tᵢ) − 1,
где Dᵢ — дисконт-фактор базовой рублёвой кривой RUONIA OIS, tᵢ — срок платежа в годах (ACT/365).

Кривые — открытые данные Мосбиржи (рынок СПФИ, iss.moex.com/iss/sdfi/curves):
  • RUB-DSC-CSARUB — базовая дисконтная кривая RUB: простая ставка до узла, D = 1/(1 + r·t);
  • RUB-FWC-KEYRTE — форвард ключевой ставки: значение в узле T = средняя КС на [T, T+3М];
  • RUB-FWC-RUONIA — то же для RUONIA (сходится с дисконтной кривой до 1–3 б.п., так и проверено).

Купоны флоатеров прогнозируются по форварду своего индекса (КС — по IRS, RUONIA — по OIS, простое
среднее за период) плюс маржа; уже начисленная часть текущего купона берётся по факту из НКД. Фиксы — по известным
купонам графика. Оферта: если доходность бумаги считается к оферте, поток обрывается на ней.

Графики выплат — одним списком по всему рынку (ISS statistics/…/bondization, ~1000 страниц):
качаем раз в день в фоне и храним в файле, чтобы расчёт при сборке строк был чисто в памяти.
"""
from __future__ import annotations

import json
import logging
import math
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from . import moex, bond_math, contract_terms

log = logging.getLogger("zspread")

_DATA = Path(__file__).parent / "data"
_SCHED_FILE = _DATA / "zs_schedules.json"
_CURVE_IDS = ("RUB-DSC-CSARUB", "RUB-FWC-KEYRTE", "RUB-FWC-RUONIA")
_CURVE_TTL = 1800
_LOCK = threading.Lock()
_CURVES: dict = {"at": 0.0, "fail_at": 0.0, "data": None}
_SCHED: dict = {"day": None, "by_isin": None}


# --------------------------------------------------------------------------- #
# Кривые свопов
# --------------------------------------------------------------------------- #
def _fetch_curve(cid: str) -> tuple[Optional[str], list[tuple[str, float]]]:
    rows = moex._block(moex._get(f"sdfi/curves/{cid}.json"), "curves")
    if not rows:
        return None, []
    last = max(r.get("calctime") or "" for r in rows)
    rows = [r for r in rows if (r.get("calctime") or "") == last and r.get("value") is not None]
    return rows[0].get("tradedate") if rows else None, [(r["tenordate"], float(r["value"])) for r in rows]


class Curves:
    """Дисконт по OIS и форварды КС / RUONIA на дату кривой."""

    def __init__(self, asof: str, dsc, fk, fr):
        self.asof = asof
        a = date.fromisoformat(asof)
        self._a = a
        yf = lambda d: (date.fromisoformat(d) - a).days / 365.0   # noqa: E731
        # узлы ln D: простая ставка → D = 1/(1+r t); между узлами — лог-линейно
        self.dn = [(0.0, 0.0)] + [(yf(d), -math.log(1 + v * yf(d))) for d, v in dsc if yf(d) > 0]
        # форвард КС: узел = средняя КС на [T, T+3М] → точка в середине квартала, между — линейно;
        # до первого узла — RUONIA из дисконтной кривой + базис «КС − RUONIA» первого узла
        fk = [(yf(d), v) for d, v in fk if yf(d) > 0]
        self.kc_pts: list[tuple[float, float]] = []
        if fk:
            t1 = fk[0][0]
            basis = fk[0][1] - self.ruonia(t1, t1 + 0.25)
            self.kc_pts = [(0.0, self.ruonia(0.0, t1) + basis)] + [(t + 0.125, v) for t, v in fk]
        # форвард овернайт-RUONIA (узел = средняя RUONIA на [T, T+3М]); купон большинства
        # флоатеров на RUONIA (и всех ОФЗ-ПК) — простое среднее ставки за период, а не
        # начисление с капитализацией: на полугодии при 14% разница около 50 б.п.
        fr = [(yf(d), v) for d, v in fr if yf(d) > 0]
        self.ro_pts = [(t + 0.125, v) for t, v in fr]

    def ln_d(self, t: float) -> float:
        dn = self.dn
        if t <= 0:
            return 0.0
        for i in range(1, len(dn)):
            if t <= dn[i][0]:
                (t0, l0), (t1, l1) = dn[i - 1], dn[i]
                return l0 + (l1 - l0) * (t - t0) / (t1 - t0)
        (t0, l0), (t1, l1) = dn[-2], dn[-1]
        return l1 + (l1 - l0) * (t - t1) / (t1 - t0)          # за 10 лет — продолжаем наклон

    def t_of(self, d: str) -> float:
        return (date.fromisoformat(d) - self._a).days / 365.0

    def ruonia(self, t1: float, t2: float) -> float:
        """Простая ставка RUONIA на [t1, t2] (эквивалент начисления с капитализацией)."""
        if t2 - t1 < 1e-6:
            t2 = t1 + 1 / 365
        return (math.exp(self.ln_d(t1) - self.ln_d(t2)) - 1) / (t2 - t1)

    @staticmethod
    def _lin(p: list, t: float) -> float:
        if t <= p[0][0]:
            return p[0][1]
        for i in range(1, len(p)):
            if t <= p[i][0]:
                (t0, v0), (t1, v1) = p[i - 1], p[i]
                return v0 + (v1 - v0) * (t - t0) / (t1 - t0)
        return p[-1][1]

    def _avg(self, p: list, t1: float, t2: float) -> float:
        n = max(2, int((t2 - t1) * 24) + 2)
        return sum(self._lin(p, t1 + (t2 - t1) * (k + 0.5) / n) for k in range(n)) / n

    def keyrate(self, t1: float, t2: float) -> float:
        """Средняя вменённая ключевая ставка на [t1, t2]."""
        return self._avg(self.kc_pts, t1, t2)

    def ruonia_avg(self, t1: float, t2: float) -> float:
        """Простое среднее вменённой овернайт-RUONIA на [t1, t2]."""
        return self._avg(self.ro_pts, t1, t2) if self.ro_pts else self.ruonia(t1, t2)


def curves() -> Optional[Curves]:
    """Кривые на последнюю дату (кэш 30 мин; при сбое биржи — прошлые, как у КБД)."""
    now = time.time()
    c = _CURVES
    if c["data"] and (now - c["at"] < _CURVE_TTL or now - c["fail_at"] < 120):
        return c["data"]
    if not c["data"] and now - c["fail_at"] < 300:
        return None                     # биржа только что не ответила — не ждём таймаутов на каждой бумаге
    try:
        got = {cid: _fetch_curve(cid) for cid in _CURVE_IDS}
        asof = got["RUB-DSC-CSARUB"][0]
        if not asof or not got["RUB-DSC-CSARUB"][1]:
            raise moex.MoexError("пустая дисконтная кривая")
        c.update(at=now, data=Curves(asof, got["RUB-DSC-CSARUB"][1], got["RUB-FWC-KEYRTE"][1],
                                     got["RUB-FWC-RUONIA"][1]))
    except Exception as e:  # noqa: BLE001
        c["fail_at"] = now
        log.warning("кривые СПФИ недоступны: %s", e)
    return c["data"]


# --------------------------------------------------------------------------- #
# Графики выплат всего рынка
# --------------------------------------------------------------------------- #
def _download_schedules() -> dict:
    """{isin: {"c": [[дата, начало, руб|None, %|None, номинал]...], "a": [[дата, руб]...]}} — будущие."""
    frm, till = date.today().isoformat(), "2100-12-31"
    path = "statistics/engines/stock/markets/bonds/bondization.json"
    base = {"from": frm, "till": till, "limit": 100}      # по умолчанию страница — 20 строк
    cps = moex._paginate(path, "coupons", {**base, "iss.only": "coupons",
                         "coupons.columns": "isin,coupondate,startdate,value,valueprc,facevalue"})
    ams = moex._paginate(path, "amortizations", {**base, "iss.only": "amortizations",
                         "amortizations.columns": "isin,amortdate,value,valueprc"})
    ofs = moex._paginate(path, "offers", {**base, "iss.only": "offers",
                         "offers.columns": "isin,offerdate,offertype,price"})
    out: dict = {}
    for r in cps:
        i = r.get("isin")
        if i and r.get("coupondate"):
            out.setdefault(i, {"c": [], "a": []})["c"].append(
                [r["coupondate"], r.get("startdate"), r.get("value"), r.get("valueprc"), r.get("facevalue")])
    for r in ams:
        i = r.get("isin")
        if i and r.get("amortdate") and r.get("value") is not None:
            out.setdefault(i, {"c": [], "a": []})["a"].append([r["amortdate"], r["value"]])
    # оферты: только действующие («Оферта», «Оферта/Погашение»); состоявшиеся, отменённые и
    # дефолтные — не горизонт для расчёта
    for r in ofs:
        i, d, typ = r.get("isin"), r.get("offerdate"), (r.get("offertype") or "")
        if i and d and typ in ("Оферта", "Оферта/Погашение"):
            out.setdefault(i, {"c": [], "a": []}).setdefault("o", []).append(d)
            if r.get("price") is not None:
                out[i].setdefault("op", {})[d] = r["price"]
    for v in out.values():
        v["o"] = sorted(set(v.get("o", [])))
        v["c"].sort(key=lambda c: (c[0], c[1] or ""))
        v["a"].sort(key=lambda a: a[0])
    return out


def _compact(by_isin: dict) -> dict:
    """Кортежи и общие строки дат: у тысяч бумаг одни и те же даты купонов — в памяти
    графики всего рынка занимают в разы меньше (сервер в 1 ГБ делим с AI-Инвест)."""
    import sys
    it = lambda v: sys.intern(v) if isinstance(v, str) else v   # noqa: E731
    return {i: {"c": [tuple(it(x) for x in c) for c in v.get("c", [])],
                "a": [(it(a[0]), a[1]) for a in v.get("a", [])],
                "o": [it(d) for d in v.get("o", [])],
                "op": v.get("op", {})} for i, v in by_isin.items()}


def schedules() -> dict:
    """Графики из памяти / файла; качать заново — refresh_schedules() в фоне."""
    if _SCHED["by_isin"] is None:
        try:
            raw = json.loads(_SCHED_FILE.read_text(encoding="utf-8"))
            # файл без оферт — старого формата: считаем устаревшим, перекачается в фоне
            day = raw.get("day") if raw.get("v", 1) >= 3 else None
            _SCHED.update(day=day, by_isin=_compact(raw.get("by_isin") or {}))
        except Exception:  # noqa: BLE001
            _SCHED.update(day=None, by_isin={})
    return _SCHED["by_isin"]


def refresh_schedules(force: bool = False) -> int:
    """Раз в день скачать графики всего рынка (минута в фоне). Возвращает число бумаг."""
    schedules()
    today = date.today().isoformat()
    if not force and _SCHED["day"] == today and _SCHED["by_isin"]:
        return 0
    with _LOCK:
        if not force and _SCHED["day"] == today and _SCHED["by_isin"]:
            return 0
        t0 = time.time()
        data = _download_schedules()
        if len(data) < 500:                       # биржа отдала обрывок — старое не затираем
            raise moex.MoexError(f"графики выплат: всего {len(data)} бумаг")
        _SCHED.update(day=today, by_isin=_compact(data))
        try:
            _SCHED_FILE.write_text(json.dumps({"v": 3, "day": today, "by_isin": data}, ensure_ascii=False,
                                              separators=(",", ":")), encoding="utf-8")
        except OSError as e:
            log.warning("графики выплат: не сохранить файл: %s", e)
        log.warning("графики выплат обновлены: %d бумаг за %.0f с", len(data), time.time() - t0)
        return len(data)


def settle_date() -> date:
    """Дата расчётов по сделке сегодня — T+1 (следующий рабочий день): от неё биржа считает
    доходность, и на неё начислен НКД. С ней наша доходность совпадает с биржевой до 0,003 п.п.
    по медиане (1376 бумаг), от «сегодня» расхождение было 0,065 п.п."""
    d = date.today() + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def horizon_type(isin: str, d: Optional[str]) -> Optional[str]:
    """Тип даты горизонта: PUT (оферта биржи) или CALL (колл-опцион, дата — с dohod)."""
    if not d:
        return None
    from . import moex_ref
    puts = set((schedules().get(isin) or {}).get("o", []))
    return "CALL" if (d not in puts and (moex_ref.calls().get(isin) == d or d in contract_terms.call_dates(isin))) else "PUT"


def horizon(isin: str, matdate: Optional[str], buyback: Optional[str] = None) -> tuple[Optional[str], Optional[int]]:
    """Горизонт расчёта всех метрик: ближайшая действующая оферта — пут (биржа: общий график +
    BUYBACKDATE) или колл-опцион (дата с dohod), до которой больше 14 дней. Оферта через 14 дней и меньше пропускается — приём
    заявок на неё обычно закрыт, а годовая метрика на горизонте в несколько дней — шум; тогда
    берётся следующая оферта, а если её нет — погашение (None).
    Возвращает (дата оферты | None, дней до пропущенной близкой оферты | None)."""
    today = date.today()
    tds = today.isoformat()
    mat = matdate if matdate and not str(matdate).startswith("0000") else None
    cands = set((schedules().get(isin) or {}).get("o", []))
    cands.update(contract_terms.call_dates(isin))
    if buyback and not str(buyback).startswith("0000"):
        cands.add(str(buyback)[:10])
    from . import moex_ref
    call = moex_ref.calls().get(isin)          # колл-опцион — тоже оферта для горизонта
    if call:
        cands.add(call)
    soon = None
    for d in sorted(c for c in cands if c > tds and (not mat or c < mat)):
        days = (date.fromisoformat(d) - today).days
        if days <= 14:
            soon = soon if soon is not None else days
            continue
        return d, soon
    return None, soon


# --------------------------------------------------------------------------- #
# Расчёт
# --------------------------------------------------------------------------- #
def _solve(flows: list[tuple[float, float]], cv: Curves, t_v: float, dirty: float) -> Optional[float]:
    """z (доля) такой, что Σ CF/(1+y+z)^t = dirty; t — от даты расчёта."""
    l_v = cv.ln_d(t_v)
    pts = []
    for T, cf in flows:
        t = T - t_v
        if t <= 0 or cf == 0:
            continue
        y = math.exp(-(cv.ln_d(T) - l_v) / t) - 1
        pts.append((t, cf, y))
    if not pts or dirty <= 0:
        return None
    z = 0.05
    for _ in range(40):
        f = fp = 0.0
        for t, cf, y in pts:
            b = 1 + y + z
            if b <= 0.01:
                return None
            v = cf * b ** (-t)
            f += v
            fp -= t * v / b
        f -= dirty
        if fp == 0:
            return None
        step = f / fp
        z -= step
        if abs(step) < 1e-8:
            return z
    return None


def cash_flows(isin: str, *, kind: str, accint: Optional[float], face: Optional[float],
               horizon: Optional[str] = None, index: Optional[str] = None, margin: Optional[float] = None,
               cv: Optional[Curves] = None, settledate: Optional[str] = None,
               redeem_price: Optional[float] = None) -> Optional[tuple[list[tuple[str, float]], float]]:
    """Будущий поток выпуска [(дата, ₽ на бумагу, вид, прогноз)] до горизонта и непогашенный
    номинал; вид — "coupon" или "principal", прогноз — купон флоатера посчитан по форварду.

    horizon — дата оферты: поток обрывается на ней, оставшийся номинал гасится в эту дату.
    Флоатер (index/margin, нужны кривые cv): будущие купоны — по форварду индекса + маржа."""
    sc = schedules().get(isin)
    if not face or face <= 0 or not sc or not sc.get("a"):
        return None
    is_float = kind == "floater"
    if is_float and (cv is None or index not in ("CBR_RATE", "RUONIA") or margin is None):
        return None
    today = date.fromisoformat(settledate) if settledate else settle_date()
    tds = today.isoformat()
    hz = horizon[:10] if horizon else None
    # непогашенный номинал — по графику (у амортизируемых снимок биржи бывает на день старше)
    checked = bond_math.principal(face, sc["a"], today)
    if checked is None:
        return None
    amort, outstanding = checked
    zero = contract_terms.zero_coupon(isin)
    if zero:
        # These named issuer decisions explicitly exclude coupons and additional
        # income. Never treat an arbitrary empty/unknown coupon table as zero.
        if (is_float or hz or sc.get("c") or len(amort) != 1
                or amort[0][0] != zero.get("maturity")
                or abs(outstanding - zero.get("face", 0)) > .005
                or (accint is not None and (not math.isfinite(float(accint)) or abs(float(accint)) > .005))):
            return None
        return [(zero.get("payment_date", amort[0][0]), outstanding, "principal", False)], outstanding
    if hz:
        if hz <= tds:
            return None
        redeem_price = redeem_price if redeem_price is not None else sc.get("op", {}).get(hz)
        if redeem_price is None:
            redeem_price = contract_terms.redemption_price(isin, hz)
        if redeem_price is None or not math.isfinite(float(redeem_price)) or redeem_price < 0:
            return None
    if not bond_math.coupon_chain(sc.get("c", []), today, hz or amort[-1][0]):
        return None
    fwd = (cv.keyrate if index == "CBR_RATE" else cv.ruonia_avg) if is_float else None

    def face_at(d: str) -> float:
        """Номинал на дату d: непогашенный остаток минус амортизации до неё (в будущих купонах
        биржа пишет сегодняшний номинал — у амортизируемых купон выходил бы завышенным)."""
        return outstanding - sum(v for ad, v in amort if ad <= d)

    flows: list[tuple] = []
    last_prc = None
    seen_coupons = {}
    for cd, sd, val, prc, fv in sc["c"]:
        row = (sd, val, prc, fv)
        if cd in seen_coupons:
            if seen_coupons[cd] != row:
                return None
            continue
        seen_coupons[cd] = row
        if cd <= tds or (hz and cd > hz):
            continue
        fv = face_at(sd) if sd and sd >= tds else outstanding
        days = (date.fromisoformat(cd) - date.fromisoformat(sd)).days if sd else None
        amt = None
        proj = False
        if is_float and days:
            # у флоатера биржа заполняет будущие купоны копией текущего — берём только прогноз.
            # Текущий период: ставка графика, если она сходится с начисленным НКД (купон
            # зафиксирован заранее), иначе начисленная часть по НКД + остаток по форварду
            t_v = cv.t_of(tds)
            if sd <= tds:
                done = (today - date.fromisoformat(sd)).days
                known = accint / fv * 365 / done if done > 0 and accint else None
                sched = (float(val) / fv * 365 / days) if val is not None else (float(prc) / 100 if prc is not None else None)
                rest = fwd(t_v, cv.t_of(cd)) + margin / 100
                if sched is not None and (known is None or abs(sched - known) < 0.0025):
                    rate = sched
                elif known is not None:
                    rate, proj = (known * done + rest * (days - done)) / days, True
                else:
                    rate, proj = rest, True
            else:
                rate, proj = fwd(cv.t_of(sd), cv.t_of(cd)) + margin / 100, True
            amt = fv * rate * days / 365
        elif val is not None:
            amt = float(val)
        # Unknown future fixed coupons are not a contractual cash flow.
        if amt is None:
            return None
        if prc is not None:
            last_prc = float(prc)
        flows.append((cd, amt, "coupon", proj))
    paid = 0.0
    for ad, v in amort:
        if hz and ad > hz:
            break
        flows.append((ad, v, "principal", False))
        paid += v
    if hz and outstanding - paid > 0.01:
        flows.append((hz, (outstanding - paid) * float(redeem_price) / 100, "principal", False))
    return flows, outstanding


def ytm_dur(isin: str, *, price: Optional[float], accint: Optional[float], face: Optional[float],
            horizon: Optional[str] = None, settledate: Optional[str] = None) -> Optional[tuple[float, float]]:
    """Эффективная доходность к горизонту (%, годовая, как у биржи) и дюрация Маколея (лет)
    по точному графику выплат фикса: Σ CF/(1+y)^t = цена с НКД."""
    if not price or price <= 0:
        return None
    got = cash_flows(isin, kind="fixed", accint=accint, face=face, horizon=horizon, settledate=settledate)
    if not got:
        return None
    flows, outstanding = got
    today = date.fromisoformat(settledate) if settledate else settle_date()
    if accint is None:
        accint = 0.0 if contract_terms.zero_coupon(isin) else bond_math.accrued((schedules().get(isin) or {}).get("c", []), today)
    if accint is None:
        return None
    pts = [((date.fromisoformat(d) - today).days / 365.0, cf) for d, cf, *_ in flows]
    pts = [(t, cf) for t, cf in pts if t > 0 and cf]
    dirty = price / 100 * outstanding + (accint or 0)
    if not pts or dirty <= 0:
        return None
    return bond_math.solve(flows, dirty, today)


def selected_fixed_yield(isin: str, *, price: Optional[float], accint: Optional[float],
                         face: Optional[float], matdate: Optional[str],
                         horizon: Optional[str] = None, settledate: Optional[str] = None):
    """(yield/duration, cash-flow horizon, limitation).

    An unpriced optional CALL does not erase a fully known maturity schedule.
    Such a result is explicitly YTM (no exercise), never YTC or YTW. PUTs and
    incomplete maturity schedules remain fail-closed. No coupon/price is guessed.
    """
    result = ytm_dur(isin, price=price, accint=accint, face=face,
                     horizon=horizon, settledate=settledate)
    if result:
        return result, horizon, None
    if not horizon or horizon_type(isin, horizon) != "CALL" or not matdate:
        return None, horizon, None
    try:
        maturity = date.fromisoformat(matdate)
        settle = date.fromisoformat(settledate) if settledate else settle_date()
    except (ValueError, TypeError):
        return None, horizon, None
    checked = bond_math.principal(face, (schedules().get(isin) or {}).get("a", []), settle)
    if maturity <= settle or not checked or checked[0][-1][0] != matdate:
        return None, horizon, None
    result = ytm_dur(isin, price=price, accint=accint, face=face, settledate=settledate)
    return (result, None, "call_terms_unconfirmed_maturity_only") if result else (None, horizon, None)


def zspread_bp(isin: str, *, kind: str, price: Optional[float], accint: Optional[float],
               face: Optional[float], horizon: Optional[str] = None, index: Optional[str] = None,
               margin: Optional[float] = None, settledate: Optional[str] = None) -> Optional[int]:
    """Z-спред выпуска к RUONIA OIS, б.п. None — если посчитать честно нельзя.

    horizon — дата оферты (поток обрывается там). index/margin — для флоатера (CBR_RATE / RUONIA)."""
    if not price or price < 20:
        return None
    cv = curves()
    if cv is None:
        return None
    got = cash_flows(isin, kind=kind, accint=accint, face=face, horizon=horizon,
                     index=index, margin=margin, cv=cv, settledate=settledate)
    if not got:
        return None
    flows, outstanding = got
    t_v = cv.t_of(settledate or settle_date().isoformat())
    tf = [(cv.t_of(d), cf) for d, cf, *_ in flows]
    if not tf or max(t for t, _ in tf) - t_v < 30 / 365:
        return None                               # горизонт меньше месяца — годовой спред там шум
    z = _solve(tf, cv, t_v, price / 100 * outstanding + (accint or 0))
    if z is None or not math.isfinite(z):
        return None
    # Не скрываем сошедшийся расчёт из-за величины спреда, в том числе у стрессовых выпусков.
    return round(z * 1e4)


def status() -> dict:
    cv = _CURVES["data"]
    return {"curves_asof": cv.asof if cv else None, "schedules_day": _SCHED["day"],
            "schedules_n": len(_SCHED["by_isin"] or {})}
