"""Кривая ОФЗ на произвольную дату + свопы на RUONIA (ROISfix) для графика КБД.

КБД — MOEX zcyc (yearyields) на дату; точки ОФЗ-ПД — итоги торгов TQOB на дату (YIELDCLOSE,
дюрация); ROISfix — фиксинг НФА ставок OIS на RUONIA 1W…2Y (roisfix.ru, дневной архив).
Нерабочий день → берём ближайший предыдущий торговый (до 10 дней назад).

ROISfix публикуется как простая ставка фиксированной ноги OIS; для сопоставимости с КБД
(эффективная годовая) сроки до года пересчитываем: (1 + r·t)^(1/t) − 1.
"""
from __future__ import annotations

import io
import logging
import time
from datetime import date, timedelta

import requests

from . import moex

log = logging.getLogger("curves")

_UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
_CACHE: dict = {}                    # (kind, date) -> (at, data)
_TTL_TODAY = 1800
_ROIS_TENORS = [("1W", 7 / 365), ("2W", 14 / 365), ("1M", 1 / 12), ("2M", 2 / 12), ("3M", 0.25),
                ("6M", 0.5), ("1Y", 1.0), ("2Y", 2.0)]


def _cached(key, fn, today: bool):
    hit = _CACHE.get(key)
    if hit and (not today or time.time() - hit[0] < _TTL_TODAY):
        return hit[1]
    try:
        data = fn()
    except Exception as e:  # noqa: BLE001 — stale-on-error
        if hit:
            log.warning("%s: %s — отдаю прошлые данные", key, e)
            return hit[1]
        raise
    if data:
        _CACHE[key] = (time.time(), data)
    return data


def _kbd_on(d: date) -> dict | None:
    for k in range(10):
        dd = d - timedelta(days=k)
        rows = moex._block(moex._get("engines/stock/zcyc.json", {"iss.only": "yearyields", "date": dd.isoformat()}), "yearyields")
        if rows:
            ten = sorted(({"period_years": moex._to_float(r.get("period")), "yield_pct": moex._to_float(r.get("value"))}
                          for r in rows if moex._to_float(r.get("period")) is not None), key=lambda x: x["period_years"])
            return {"tradedate": rows[0].get("tradedate"), "tenors": ten}
    return None


def _ofz_on(d: date) -> list[dict]:
    """ОФЗ-ПД (серия 26xxx) на дату: доходность закрытия и дюрация из итогов торгов."""
    out, start = [], 0
    while True:
        rows = moex._block(moex._get("history/engines/stock/markets/bonds/boards/TQOB/securities.json", {
            "date": d.isoformat(), "iss.only": "history", "start": start,
            "history.columns": "SECID,SHORTNAME,CLOSE,YIELDCLOSE,DURATION,MATDATE,NUMTRADES"}), "history")
        out += rows
        if len(rows) < 100:
            break
        start += 100
    pts = []
    for r in out:
        sec, y, dur = r.get("SECID") or "", moex._to_float(r.get("YIELDCLOSE")), moex._to_float(r.get("DURATION"))
        if sec.startswith("SU26") and y and 0 < y < 60 and dur and dur > 0:
            pts.append({"secid": sec, "name": r.get("SHORTNAME"), "ytm": y, "duration_years": round(dur / 365, 3),
                        "price": moex._to_float(r.get("CLOSE"))})
    return pts


def _roisfix_on(d: date) -> dict | None:
    import pandas as pd
    for k in range(10):
        dd = d - timedelta(days=k)
        r = requests.get(f"https://roisfix.ru/files/csv/fr_roisfix/{dd.strftime('%d.%m.%Y')}.xls",
                         headers=_UA, timeout=20, verify=True)
        if r.status_code != 200 or not r.content:
            continue
        try:
            x = pd.read_excel(io.BytesIO(r.content), header=None)
        except Exception:  # noqa: BLE001
            continue
        vals = {}
        if x.shape[1] < 2:                       # выходной: пустой шаблон без значений
            continue
        for _, row in x.iterrows():
            code, v = str(row[0] or ""), row[1]
            for lbl, _t in _ROIS_TENORS:
                if code.startswith(f"RUB{lbl}OISFIX"):
                    try:
                        vals[lbl] = float(v)
                    except (TypeError, ValueError):
                        pass
        if len(vals) >= 6:
            ten = []
            for lbl, t in _ROIS_TENORS:
                if lbl in vals:
                    r_ = vals[lbl] / 100
                    eff = ((1 + r_ * t) ** (1 / t) - 1) * 100 if t <= 1 else vals[lbl]
                    ten.append({"tenor": lbl, "period_years": round(t, 4), "rate": vals[lbl], "yield_pct": round(eff, 2)})
            return {"date": dd.isoformat(), "tenors": ten}
    return None


def curve_on(d: date | None = None) -> dict:
    """КБД + точки ОФЗ-ПД + ROISfix на дату (по умолчанию — сегодня)."""
    d = d or date.today()
    today = d >= date.today()
    kbd = _cached(("kbd", d), lambda: _kbd_on(d), today)
    ofz = _cached(("ofz", kbd["tradedate"] if kbd else d), lambda: _ofz_on(date.fromisoformat(kbd["tradedate"]) if kbd else d), today)
    try:
        rois = _cached(("rois", d), lambda: _roisfix_on(d), today)
    except Exception as e:  # noqa: BLE001 — свопы необязательны для графика
        log.warning("ROISfix: %s", e)
        rois = None
    try:
        sdfi = sdfi_curves(d if not today else None)
    except Exception as e:  # noqa: BLE001
        log.warning("SDFI: %s", e)
        sdfi = {"status": "error", "curves": []}
    return {"date": d.isoformat(), "kbd": kbd, "ofz": ofz or [], "roisfix": rois, "swaps": sdfi}


# --------------------------------------------------------------------------- #
# Вторичный рынок ОФЗ накануне аукциона (для премии Минфина)
# --------------------------------------------------------------------------- #
_BOARD_CACHE_PATH = None


def _board_cache_path():
    import os
    return os.path.join(os.path.dirname(__file__), "data", "ofz_board_hist.json")


def _load_board_cache() -> dict:
    import json
    try:
        with open(_board_cache_path(), encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def _save_board_cache(c: dict) -> None:
    import json
    import os
    tmp = _board_cache_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(c, f, ensure_ascii=False)
    os.replace(tmp, _board_cache_path())


def _board_day(d: date) -> dict:
    """Итоги торгов ОФЗ (TQOB) за день: {SECID[:11]: [доходность закрытия, цена закрытия]}."""
    out, start = {}, 0
    while True:
        rows = moex._block(moex._get("history/engines/stock/markets/bonds/boards/TQOB/securities.json", {
            "date": d.isoformat(), "iss.only": "history", "start": start,
            "history.columns": "SECID,CLOSE,YIELDCLOSE,LEGALCLOSEPRICE"}), "history")
        for r in rows:
            px = moex._to_float(r.get("CLOSE")) or moex._to_float(r.get("LEGALCLOSEPRICE"))
            if px:
                out[(r.get("SECID") or "")[:11]] = [moex._to_float(r.get("YIELDCLOSE")), px]
        if len(rows) < 100:
            break
        start += 100
    return out


_BOARD_LOCK = __import__("threading").Lock()


def pre_auction_market(auction_dates: list[str], budget_s: float = 20.0) -> dict:
    """{дата аукциона: {"date": торговый день накануне, "px": {secid: [ytm, price]}}}.
    Прошлые дни не меняются → кэш на диске навсегда; недостающие дни догружаются за один
    вызов не дольше budget_s секунд (остальные — при следующих вызовах / в фоне)."""
    cache = _load_board_cache()
    t0, changed = time.time(), False
    res = {}
    with _BOARD_LOCK:
        for ad in sorted(set(auction_dates), reverse=True):
            if ad in cache:
                if cache[ad]:
                    res[ad] = cache[ad]
                continue
            if time.time() - t0 > budget_s:
                continue
            try:
                d0 = date.fromisoformat(ad)
            except ValueError:
                continue
            got = None
            for k in range(1, 8):                    # ближайший торговый день ДО аукциона
                dd = d0 - timedelta(days=k)
                px = _board_day(dd)
                if px:
                    got = {"date": dd.isoformat(), "px": px}
                    break
            cache[ad] = got or {}
            changed = True
            if got:
                res[ad] = got
        if changed:
            _save_board_cache(cache)
    return res


# --------------------------------------------------------------------------- #
# Кривые СПФИ Мосбиржи (ISS /sdfi/curves) через MOEX Passport
# --------------------------------------------------------------------------- #
# Внешние и архивные кривые доступны после бесплатной авторизации MOEX Passport; актуальные
# RUB-OIS-RUONIA / RUB-IRS-KEYRTE — только по платной подписке (тогда их тоже подхватим).
# Логин и пароль — только из окружения (MOEX_LOGIN / MOEX_PASSWORD), в код и логи не попадают.
SDFI_CURVES = [("RUB-IRS-KEYRTE", "IRS на ключевую ставку"), ("RUB-OIS-RUONIA", "OIS на RUONIA"),
               ("RUB-IRS-RUSF3M", "IRS RUSFAR 3M")]
_PASSPORT: dict = {"sess": None, "at": 0.0, "fail_at": 0.0}


def _passport_session():
    import os
    login, pwd = os.environ.get("MOEX_LOGIN"), os.environ.get("MOEX_PASSWORD")
    if not (login and pwd):
        return None
    now = time.time()
    if _PASSPORT["sess"] is not None and now - _PASSPORT["at"] < 6 * 3600:
        return _PASSPORT["sess"]
    if now - _PASSPORT["fail_at"] < 900:
        return None
    s = requests.Session()
    try:
        r = s.get("https://passport.moex.com/authenticate", auth=(login, pwd), timeout=30)
        if r.status_code != 200 or "MicexPassportCert" not in s.cookies:
            raise RuntimeError(f"HTTP {r.status_code}")
    except Exception as e:  # noqa: BLE001
        log.warning("MOEX Passport: авторизация не удалась (%s)", type(e).__name__)
        _PASSPORT["fail_at"] = now
        return None
    _PASSPORT.update(sess=s, at=now)
    return s


def _tenor_years(v) -> float | None:
    import re
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v) / 365 if v > 60 else float(v)          # дни или годы
    m = re.match(r"^\s*(\d+(?:[.,]\d+)?)\s*([DWMY])\s*$", str(v).upper())
    if not m:
        try:
            return float(str(v).replace(",", "."))
        except ValueError:
            return None
    n, u = float(m.group(1).replace(",", ".")), m.group(2)
    return {"D": n / 365, "W": n * 7 / 365, "M": n / 12, "Y": n}[u]


def _parse_sdfi(payload: dict, unit_fraction: bool = True) -> list[dict]:
    """Ответ ISS → [{tenor, period_years, yield_pct}]: ищем блок с колонками срока и ставки."""
    best = []
    for name, blk in (payload or {}).items():
        if not isinstance(blk, dict) or not blk.get("columns") or not blk.get("data"):
            continue
        cols = [c.lower() for c in blk["columns"]]
        ti = next((i for i, c in enumerate(cols) if c in ("tenor", "term", "period", "maturity", "tenorid", "tenor_name")), None)
        ti = ti if ti is not None else next((i for i, c in enumerate(cols) if any(k in c for k in ("tenor", "term", "period", "matur"))), None)
        vi = next((i for i, c in enumerate(cols) if c in ("value", "rate", "swaprate", "yield", "mid")), None)
        vi = vi if vi is not None else next((i for i, c in enumerate(cols) if any(k in c for k in ("value", "rate", "mid"))), None)
        if ti is None or vi is None:
            continue
        pts = []
        for row in blk["data"]:
            t, v = _tenor_years(row[ti]), row[vi]
            try:
                v = float(v)
            except (TypeError, ValueError):
                continue
            if t is None or t <= 0:
                continue
            pct = v * 100 if (unit_fraction and abs(v) < 1.5) else v
            pts.append({"tenor": str(row[ti]), "period_years": round(t, 4), "yield_pct": round(pct, 3)})
        if len(pts) > len(best):
            best = sorted(pts, key=lambda x: x["period_years"])
    return best


def sdfi_curves(d: date | None = None) -> dict:
    """Кривые свопов СПФИ на дату. {"status": ok|no_credentials|auth_failed, "curves": [...]}."""
    import os
    if not (os.environ.get("MOEX_LOGIN") and os.environ.get("MOEX_PASSWORD")):
        return {"status": "no_credentials", "curves": []}
    sess = _passport_session()
    if sess is None:
        return {"status": "auth_failed", "curves": []}
    out = []
    for cid, title in SDFI_CURVES:
        def fetch(cid=cid):
            for k in range(8):
                dd = (d or date.today()) - timedelta(days=k)
                r = sess.get(f"https://iss.moex.com/iss/sdfi/curves/{cid}.json", params={"date": dd.isoformat()}, timeout=30)
                if "json" not in (r.headers.get("content-type") or ""):
                    return {"denied": True}                # «доступно только подписчикам»
                pts = _parse_sdfi(r.json())
                if pts:
                    return {"date": dd.isoformat(), "tenors": pts}
            return None
        try:
            res = _cached(("sdfi", cid, d or date.today()), fetch, (d or date.today()) >= date.today())
        except Exception as e:  # noqa: BLE001
            log.warning("SDFI %s: %s", cid, e)
            res = None
        if res and not res.get("denied") and res.get("tenors"):
            out.append({"id": cid, "title": title, **res})
    return {"status": "ok", "curves": out}


# --------------------------------------------------------------------------- #
# Купон ОФЗ на дату аукциона → текущая доходность на размещении (купон ÷ цена)
# --------------------------------------------------------------------------- #
def _coupons_path():
    import os
    return os.path.join(os.path.dirname(__file__), "data", "ofz_coupons.json")


def coupons_at(pairs: list[tuple[str, str]], full_ids: dict[str, str]) -> dict:
    """pairs [(secid11, дата аукциона)] → {(secid11, дата): ставка купона %, действующая на дату}.
    График купонов из ISS bondization; кэш на диске, обновление графика раз в 7 дней (у ОФЗ-ПК
    ставка следующего купона фиксируется по ходу жизни выпуска)."""
    import json
    import os
    try:
        with open(_coupons_path(), encoding="utf-8") as f:
            cache = json.load(f)
    except Exception:  # noqa: BLE001
        cache = {}
    now, changed = time.time(), False
    for sid in {p[0] for p in pairs}:
        ent = cache.get(sid)
        if ent and now - ent.get("at", 0) < 7 * 86400:
            continue
        full = full_ids.get(sid)
        try:
            if not full:
                rows = moex._block(moex._get("securities.json", {"q": sid, "iss.only": "securities",
                                                                 "securities.columns": "secid"}), "securities")
                full = next((r["secid"] for r in rows if (r.get("secid") or "").startswith(sid)), None)
            if not full:
                continue
            b = moex.get_bondization(full)
            cache[sid] = {"at": now, "c": [[c.get("date"), c.get("valueprc")] for c in (b.get("coupons") or []) if c.get("date")]}
            changed = True
        except Exception as e:  # noqa: BLE001
            log.warning("купоны %s: %s", sid, e)
    if changed:
        tmp = _coupons_path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
        os.replace(tmp, _coupons_path())
    out = {}
    for sid, d in pairs:
        cs = sorted((cache.get(sid) or {}).get("c") or [])
        nxt = next((c for c in cs if c[0] > d), None)      # купонный период, в котором прошёл аукцион
        if nxt and nxt[1] is not None:
            out[(sid, d)] = float(nxt[1])
    return out


_RUONIA_DAY: dict = {}


def ruonia_on(d: str) -> float | None:
    """RUONIA на дату (последнее значение не позже d) — оценка купона ОФЗ-ПК, пока ставка не
    зафиксирована (первый купон нового выпуска)."""
    if d in _RUONIA_DAY:
        return _RUONIA_DAY[d]
    from datetime import datetime as _dt
    from . import macro
    try:
        d0 = date.fromisoformat(d)
        frm, to = (d0 - timedelta(days=12)).strftime("%d.%m.%Y"), d0.strftime("%d.%m.%Y")
        rows = macro._hd_rows(f"https://www.cbr.ru/hd_base/ruonia/dynamics/?UniDbQuery.Posted=True"
                              f"&UniDbQuery.From={frm}&UniDbQuery.To={to}")
        best = None
        for r in rows:
            try:
                dt = _dt.strptime(str(r[0]).strip()[:10], "%d.%m.%Y").date()
                v = float(str(r[1]).replace(",", ".").replace("\xa0", ""))
            except (ValueError, IndexError, TypeError):
                continue
            if dt <= d0 and (best is None or dt > best[0]):
                best = (dt, v)
        val = best[1] if best else None
    except Exception as e:  # noqa: BLE001
        log.warning("RUONIA %s: %s", d, e)
        return None
    _RUONIA_DAY[d] = val
    return val
