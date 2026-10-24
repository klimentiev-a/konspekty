"""
Market universe — the cached snapshot that powers the screener and market map.

Optimization principle: DO NOT hit ISS per bond. One board request returns the
whole board (yield, duration, price, coupon) for every listed bond, so a full
refresh of hundreds of instruments costs ~2 HTTP calls. We compute G-spread /
spread-to-OFZ once, join credit rating + sector (scraped, see ratings.py), and
persist everything into `bond_snapshot`. The API then reads from SQLite —
instant, no network — until the next explicit/scheduled refresh.
"""
from __future__ import annotations

import json
import threading
import logging
import re
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from ..db import BondRating, BondSnapshot
from . import agencies, instrument, moex, ratings, zspread, contract_terms

log = logging.getLogger("universe")

# corp, OFZ, FX/replacement, corp-D, юаневые (TQOY). TQIR на MOEX не торгуется — убрана.
DEFAULT_BOARDS = ("TQCB", "TQOB", "TQOD", "TQRD", "TQOY")


# --------------------------------------------------------------------------- #
def _years_to(matdate: Optional[str]) -> Optional[float]:
    if not matdate or matdate == "0000-00-00":
        return None
    try:
        return (datetime.strptime(matdate, "%Y-%m-%d").date() - date.today()).days / 365.0
    except ValueError:
        return None


def _classify_bulk(secid: str) -> tuple[str, Optional[str]]:
    """Coarse fix/float classification available from board data alone.
    OFZ series encode the type in the SECID; corporates are left 'unknown'
    (the per-issue card resolves the true type via bondization)."""
    s = (secid or "").upper()
    if s.startswith("SU29"):
        return "floater", "ОФЗ-ПК"
    if s.startswith("SU52"):
        return "linker", "ОФЗ-ИН"
    if s.startswith(("SU46", "SU48")):
        return "fixed", "ОФЗ-АД"
    if s.startswith("SU26"):
        return "fixed", "ОФЗ-ПД"
    if s.startswith("SU2") or s.startswith("SU3"):
        return "fixed", "ОФЗ"
    return "unknown", None


# MOEX board BONDTYPE → our kind. This is the authoritative fix/float signal.
def _kind_from_bondtype(bt: Optional[str]) -> tuple[str, Optional[str]]:
    if not bt:
        return "unknown", None
    b = bt.lower()
    # MOEX с 09.2026: «Облигация с плавающим купоном» (раньше «Флоатер»)
    if "флоат" in b or "плава" in b:
        return "floater", "Флоатер"
    if "дисконт" in b:
        return "discount", "Дисконт"
    if "линкер" in b or "индексируем" in b:
        return "linker", "Линкер"
    if "структурн" in b:
        return "structured", "Структурная"
    # «Фикс…», «Амортизируемые», «Валютные», «Конвертируемые» → fixed-coupon
    return "fixed", bt


_AVG_SESSIONS = 21   # окно усреднения оборота — торговых сессий (~1 месяц без выходных)


def _roll_volume(snap: BondSnapshot, today_vol, session: Optional[str]) -> None:
    """Инкрементально копим дневной оборот в vol_hist (JSON) и пересчитываем avg_volume —
    средний дневной оборот за последние ~21 торговую сессию (сессия без сделок = 0)."""
    try:
        hist = json.loads(snap.vol_hist) if snap.vol_hist else {}
    except Exception:  # noqa: BLE001
        hist = {}
    if session:
        hist[session] = float(today_vol or 0)
    if len(hist) > 40:                        # держим ~40 последних сессий
        for d in sorted(hist)[:-40]:
            hist.pop(d, None)
    snap.vol_hist = json.dumps(hist)
    vals = [hist[d] for d in sorted(hist)[-_AVG_SESSIONS:]]
    snap.avg_volume = round(sum(vals) / len(vals)) if vals else (float(today_vol) if today_vol else None)


def backfill_turnover(db: Session, sessions: int = _AVG_SESSIONS) -> dict:
    """Разовый бэкфилл vol_hist/avg_volume из истории MOEX за последние N торговых сессий
    (иначе средний оборот копится только с текущего дня). Тяжёлый — сотни запросов."""
    snaps = db.query(BondSnapshot).all()
    if not snaps:
        return {"filled": 0}
    sample = max((s for s in snaps if (s.secid or "").startswith("SU26")),
                 key=lambda s: s.volume or 0, default=None) or max(snaps, key=lambda s: s.volume or 0)
    till = date.today().isoformat()
    frm = (date.today() - timedelta(days=int(sessions * 1.8) + 12)).isoformat()
    hist_rows = moex.get_price_history(sample.secid or sample.isin, sample.board or "TQOB", frm, till)
    dates = sorted({r["date"] for r in hist_rows if r.get("date")})[-sessions:]
    if not dates:
        return {"filled": 0, "reason": "no trading dates"}
    boards = sorted({s.board for s in snaps if s.board})
    sid2isin = {s.secid: s.isin for s in snaps if s.secid}
    by_isin: dict[str, dict[str, float]] = {}
    for board in boards:
        for d in dates:
            try:
                m = moex.board_turnover_on_date(board, d)
            except Exception as e:  # noqa: BLE001
                log.warning("turnover %s %s: %s", board, d, e)
                continue
            for sid, val in m.items():
                isin = sid2isin.get(sid)
                if isin:
                    by_isin.setdefault(isin, {})[d] = val
    filled = 0
    for s in snaps:
        per = by_isin.get(s.isin, {})
        histj = {d: float(per.get(d, 0.0)) for d in dates}   # сессия без сделок = 0
        s.vol_hist = json.dumps(histj)
        vals = list(histj.values())
        s.avg_volume = round(sum(vals) / len(vals)) if vals else None
        filled += 1
    db.commit()
    invalidate_rows_cache()
    return {"filled": filled, "sessions": len(dates), "boards": boards}


_IDX_CACHE: dict = {"at": 0.0, "v": {}}

# Индекс купона флоатера. Первичный источник — dohod (frnIndex); у ~половины флоатеров его нет,
# и раньше индекс угадывался (корпоративные → ключевая). Биржа отдаёт индекс в описании выпуска
# (COUPON_BENCHMARK: RREFKEYR — ключевая, RUONIA*), он совпадает с dohod там, где известны оба.
# Кэшируем его в файле: описание выпуска не меняется.
_BENCH_FILE = __import__("pathlib").Path(__file__).parent / "data" / "float_benchmarks.json"
try:
    _MOEX_BENCH: dict = json.loads(_BENCH_FILE.read_text(encoding="utf-8"))
except Exception:  # noqa: BLE001
    _MOEX_BENCH = {}


def _norm_bench(b) -> str:
    b = (b or "").upper()
    if b.startswith("RREFKEYR") or b in ("KEYRATE", "CBR_RATE"):
        return "CBR_RATE"
    if b.startswith("RUONIA"):
        return "RUONIA"
    return b


def float_index_of(isin: str, rt=None) -> str:
    """Индекс купона флоатера: dohod, иначе описание выпуска на бирже; пусто — неизвестен."""
    return (rt.float_index if rt is not None and rt.float_index else "") or _MOEX_BENCH.get(isin, "")


def fill_float_benchmarks(db, cap: int = 500) -> int:
    """Дозаполнить индексы флоатеров без данных dohod из описаний выпусков биржи.
    Возвращает, у скольких индекс стал известен (им пересчитывается премия к ОФЗ-ПК)."""
    from .. import db as _dbm
    known = {r.isin for r in db.query(_dbm.BondRating).filter(_dbm.BondRating.float_index != None).all()}  # noqa: E711
    todo = [s for s in db.query(BondSnapshot).filter(BondSnapshot.kind == "floater").all()
            if s.isin not in known and s.isin not in _MOEX_BENCH][:cap]
    if not todo:
        return 0
    from concurrent.futures import ThreadPoolExecutor

    def _one(s):
        try:
            return s, _norm_bench(moex.resolve_security(s.isin).get("coupon_benchmark"))
        except Exception:  # noqa: BLE001
            return s, None
    now, found = datetime.utcnow(), 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        for s, b in ex.map(_one, todo):
            if b is None:
                continue                     # биржа не ответила — попробуем в следующий раз
            _MOEX_BENCH[s.isin] = b
            if b:
                found += 1
                s.updated_at = now           # новая подпись снимка → готовые ответы пересоберутся
    try:
        _BENCH_FILE.write_text(json.dumps(_MOEX_BENCH, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    except OSError as e:
        log.warning("float benchmarks: не удалось сохранить кэш: %s", e)
    if found:
        _compute_floater_dm_ofz(db)          # коммит и сброс кэша строк внутри
    return found


def _index_rates_cached() -> dict:
    import time as _t
    if _t.time() - _IDX_CACHE["at"] > 600:
        _IDX_CACHE.update(at=_t.time(), v=_index_rates())
    return _IDX_CACHE["v"]


def _index_rates() -> dict:
    """Текущие значения индексов флоатеров: ключевая ставка (CBR_RATE) и RUONIA — из макро-кэша
    (hd_base ЦБ). Нужны, чтобы текущая доходность флоатера считалась от СВОЕГО индекса, а не от
    короткого конца КБД (13,3% при ключевой 14%)."""
    try:
        from .macro import _load_disk
        _, d = _load_disk()
        ri = [r for r in (d or {}).get("rates_infl") or [] if r.get("rate") is not None]
        ru = [r for r in (d or {}).get("ruonia") or [] if r.get("val") is not None]
        out = {}
        if ri:
            out["CBR_RATE"] = ri[-1]["rate"]
            out["1/2_CBR_RATE"] = ri[-1]["rate"] / 2
        if ru:
            out["RUONIA"] = ru[-1]["val"]
        return out
    except Exception:  # noqa: BLE001
        return {}


_REFRESH_LOCK = threading.Lock()


def refresh(db: Session, boards: tuple[str, ...] = DEFAULT_BOARDS) -> dict:
    """Rebuild the snapshot from bulk board data. Returns {count, boards, at}.
    Одновременно идёт только одно обновление (кнопка + планировщик/CRON не пишут в БД разом)."""
    if not _REFRESH_LOCK.acquire(blocking=False):
        return {"count": 0, "skipped": "обновление уже идёт", "boards": list(boards)}
    try:
        return _refresh(db, boards)
    finally:
        _REFRESH_LOCK.release()


def _refresh(db: Session, boards: tuple[str, ...]) -> dict:
    curve = instrument.gcurve(force=True)
    bench = instrument.ofz_benchmarks(force=True)
    ratings = _ratings_map(db)          # справочник (биржа + ФНС): флоатер, индекс, маржа, отрасль
    idx_rates = _index_rates()          # текущие ключевая / RUONIA — база флоатеров
    now = datetime.utcnow()
    session = None
    try:
        session = moex.latest_session()      # дата последней торговой сессии (для среднего оборота)
    except Exception as e:  # noqa: BLE001
        log.warning("latest_session failed: %s", e)
    seen = 0
    # одна бумага может листоваться на нескольких досках (напр. валютная на TQCB со
    # сделками и на TQOD с нулями). Не даём поздней доске без торгов затереть хорошие
    # данные ликвидной доски.
    seen_isins: set[str] = set()

    # сначала скачиваем ВСЕ доски, потом проверяем здравость и только тогда пишем в БД
    fetched: dict[str, list] = {}
    failed: list[str] = []
    for board in boards:
        try:
            fetched[board] = moex.get_board_securities(board)
        except moex.MoexError as e:
            log.warning("board %s failed: %s", board, e)
            failed.append(board)
    new_with_ytm = sum(1 for rows in fetched.values() for r in rows if r.get("yield"))
    prev_with_ytm = db.query(func.count(BondSnapshot.isin)).filter(BondSnapshot.ytm.isnot(None)).scalar() or 0
    if prev_with_ytm and new_with_ytm < 0.5 * prev_with_ytm:
        # MOEX отдал пустоту/нули (сбой, до открытия торгов) — не затираем рабочий снимок
        log.warning("refresh skipped: yields %d vs %d before", new_with_ytm, prev_with_ytm)
        return {"count": 0, "boards": list(boards), "failed_boards": failed, "at": now.isoformat(),
                "skipped": f"MOEX отдал неполные данные ({new_with_ytm} бумаг с доходностью против {prev_with_ytm}) — оставлен прежний снимок"}

    fix_durations(fetched)

    for board in boards:
        if board not in fetched:
            continue
        rows = fetched[board]
        for r in rows:
            isin = r.get("isin")
            if not isin:
                continue
            nt = r.get("numtrades")
            if isin in seen_isins and not (nt and nt > 0):
                continue          # уже обновлено с ликвидной доски — не затираем дублем
            ytm = r.get("yield")
            dur_days = r.get("duration")
            dur_years = (dur_days / 365.0) if dur_days else None
            price, price_type, price_stale = select_valuation_price(r, _recent_trade(db.get(BondSnapshot, isin)))
            years = _years_to(r.get("matdate"))
            # Authoritative fix/float/… class from the board BONDTYPE column;
            # fall back to SECID heuristic then the dohod floater flag.
            kind, label = _kind_from_bondtype(r.get("bondtype"))
            rt = ratings.get(isin)
            if kind == "unknown":
                kind, label = _classify_bulk(r.get("secid"))
            # Общие типы MOEX («Амортизируемая», «Валютная», «Структурная», пусто) не говорят,
            # фикс это или флоатер → решают ОФЗ-ПК по SECID и флаг флоатера dohod (frnIndex).
            # Явный «фиксированным (известным) купоном» не перебиваем.
            _bt = (r.get("bondtype") or "").lower()
            if kind in ("fixed", "unknown") and "фиксирован" not in _bt and (
                    (r.get("secid") or "").startswith(("SU29", "SU24"))
                    or (rt is not None and rt.is_floater and (rt.float_index or "") in ("CBR_RATE", "RUONIA", "1/2_CBR_RATE"))):
                kind, label = "floater", "Флоатер"

            is_float = kind == "floater"
            cp = r.get("couponpercent") or (rt.current_coupon if rt else None)
            if not cp or cp <= 0:            # unknown/zero coupon → no derived metrics
                cp = None
            if is_float and not r.get("couponpercent") and cp and rt is not None and rt.float_add is not None:
                # купон dohod бывает устаревшим (ОФЗ 29013: 6,1% при RUONIA ~14%) — отбрасываем, если
                # он расходится с «индекс + маржа» больше чем на 2 п.п.
                _ix = idx_rates.get(float_index_of(rt.isin, rt))
                if _ix is not None and abs(cp - (_ix + rt.float_add)) > 2:
                    cp = None
            is_ofz = (r.get("secid") or "").startswith("SU")
            is_rub = (r.get("faceunit") or "SUR") in ("SUR", "RUB", "RUR")

            # FX bonds sometimes carry a garbage ruble-priced yield — drop it.
            if not is_rub and ytm is not None and not (0 < ytm < 40):
                ytm = None
            # Санити: бумага около номинала (>90%) физически не может давать YTM >60%
            # (MOEX иногда отдаёт мусорный yield, напр. 97,56% цена → 10420% YTM). Дисконтные
            # проблемные бумаги (цена 10–80%) сюда не попадают — их высокий YTM реален.
            if ytm is not None and ytm > 60 and price and price >= 90:
                ytm = None      # вкл. околопогашения (годы<0.5): 99,4% цена → 794% YTM — артефакт аннуализации

            g_spread = None
            if not is_float and ytm and dur_years:      # G-spread only for fixes
                # приоритет — GSPREADBP самой биржи (КБД на точной дюрации, та же доходность);
                # своя интерполяция КБД — если MOEX спред не дал (расхождение до ~7 б.п.)
                _gm = r.get("gspread_moex")
                # …но GSPREADBP MOEX посчитан на ЕЁ дюрации (marketdata_yields); если дюрацию
                # заменили (битая — см. fix_durations), спред считаем сами на верной дюрации
                if (_gm is not None and r.get("yield") is not None and abs(r["yield"] - ytm) < 1e-6
                        and r.get("duration_src") in (None, "moex_yields")):
                    g_spread = round(_gm)
                else:
                    g_at = instrument.gcurve_yield(dur_years, curve)
                    if g_at is not None:
                        g_spread = round((ytm - g_at) * 100.0)
            spread_ofz = None
            if not is_float and ytm and (years or dur_years):
                # по дюрации (доходность MOEX — к оферте/по графику амортизации); без дюрации — по сроку
                ref = instrument.nearest_ofz(dur_years, bench, by="duration") if dur_years else instrument.nearest_ofz(years, bench)
                if ref:
                    spread_ofz = round((ytm - ref["ytm"]) * 100.0)
            # For a RUBLE non-government bond a deeply negative spread is a
            # stale-quote / structured-note artifact → drop it. For an FX bond,
            # a negative G-spread is REAL: converted to rubles at the current rate
            # it simply yields below the ruble curve (the FX-risk premium), keep it.
            # …но квазигосударственные бумаги (РЖД, Роснефть, ипотечные ДОМ.РФ) реально торгуются
            # ниже ОФЗ на 200–400 б.п. Если сегодня были сделки и купон нормальный, спред
            # настоящий — оставляем. Гасим ноты с купоном около нуля и котировки без сделок
            if is_rub and not is_ofz and g_spread is not None and g_spread < -200:
                _traded = bool(nt and nt > 0) and (cp or 0) >= 1
                if not _traded or g_spread < -800:
                    g_spread = spread_ofz = None

            # Floater quoted margin: dohod frnIndexAdd, else the cached MOEX
            # benchmark spread (float_qm) so dohod-less floaters still get an SM.
            existing = db.get(BondSnapshot, isin)
            qm = (rt.float_add if rt else None) or (existing.float_qm if existing else None)
            base = curve["tenors"][0]["yield_pct"] if curve.get("tenors") else None
            # SM флоатера с пут-офертой — к дате оферты (как и DM к ОФЗ): инвестор получает номинал
            # в оферту, а не в погашение (ГТЛК 1P-03: 266 б.п. к погашению против 474 к оферте)
            # горизонт — общий для всех метрик: ближайшая оферта дальше 14 дней, иначе погашение
            _hz = zspread.horizon(isin, r.get("matdate"), r.get("buyback_date"))[0] if is_float else None
            _yo = _years_to(_hz) if _hz else None
            sm = instrument.simple_margin_bp(price, _yo if (_yo and _yo > 0) else years, qm) if is_float else None
            if sm is not None and not (-3000 < sm < 20000):
                sm = None        # дефолтный флоатер (цена ~10) даёт бессмысленные ~82000 б.п. — гасим; коридор
                # −3000…20000 как у G-спреда: проблемные по 60–80% (5000–15000) и премия перед офертой — рынок
            # DM к ОФЗ для флоатеров считаем ОТДЕЛЬНЫМ пост-проходом (нужны SM всех
            # ОФЗ-ПК, чтобы построить их кривую) — см. _compute_floater_dm_ofz ниже.
            # A floater whose next coupon isn't fixed yet (COUPONVALUE=0) has no
            # current coupon → estimate it as base rate + quoted margin so the
            # current-yield axis still has a point to plot.
            cp_eff = cp
            if is_float and not cp_eff and qm is not None:
                # база — СВОЙ индекс бумаги (ключевая / RUONIA); если индекс неизвестен — короткий конец КБД
                _b = idx_rates.get(float_index_of(isin, rt), base)
                if _b is not None:
                    cp_eff = round(_b + qm, 2)
            cur_yield = round(cp_eff / price * 100.0, 2) if (cp_eff and price) else None

            snap = db.get(BondSnapshot, isin) or BondSnapshot(isin=isin)
            snap.secid = r.get("secid"); snap.board = board
            snap.shortname = r.get("shortname")
            snap.kind = kind; snap.type_label = label
            snap.matdate = r.get("matdate")
            _bb = r.get("buyback_date")
            snap.buyback_date = _bb if (_bb and _bb not in ("0000-00-00", "")) else None
            snap.years_to_maturity = round(years, 2) if years else None
            snap.facevalue = r.get("facevalue"); snap.faceunit = r.get("faceunit")
            snap.settledate = r.get("settledate")
            snap.couponpercent = cp; snap.couponvalue = r.get("couponvalue")
            snap.couponfrequency = _freq_from_period(r.get("couponperiod"))
            snap.price = round(price, 3) if price else None
            snap.price_type = price_type
            snap.price_stale = price_stale
            snap.bid = r.get("bid"); snap.offer = r.get("offer")
            snap.accint = r.get("accint")
            snap.ytm = round(ytm, 2) if ytm else None
            snap.duration_days = dur_days
            snap.duration_years = round(dur_years, 2) if dur_years else None
            snap.g_spread_bp = g_spread; snap.spread_ofz_bp = spread_ofz
            snap.simple_margin_bp = sm; snap.base_rate = round(base, 2) if base else None
            snap.current_yield = cur_yield
            snap.volume = r.get("volume"); snap.numtrades = r.get("numtrades")
            # оборот VALTODAY относится к торговому дню из SYSTIME, а НЕ к latest_session() (последняя
            # ЗАВЕРШЁННАЯ сессия): иначе днём неполный оборот сегодняшнего дня затирал вчерашний
            _td = r.get("tradedate") or session
            _roll_volume(snap, r.get("volume"), _td)   # средний оборот за ~21 сессию
            snap.change_day_pct = r.get("change_pct")
            snap.issuesize = r.get("issuesize"); snap.issuesize_placed = r.get("issuesize_placed")
            snap.updated_at = now
            db.add(snap)
            seen_isins.add(isin)
            seen += 1
        db.commit()

    # Enrich with full issuer names (for credit-rating matching). Best-effort:
    # a failure here must not abandon the snapshot we just built.
    named = 0
    try:
        moex_names = moex.get_issuer_names()
        moex_ids = moex.get_issuer_ids()
        moex_inns = moex.get_issuer_inns()
        moex_titles = moex.get_issuer_titles()
        for snap in db.query(BondSnapshot).all():
            _inn = moex_inns.get(snap.isin)
            if _inn and snap.emitent_inn != _inn:
                snap.emitent_inn = _inn
            _ttl = moex_titles.get(snap.isin)
            if _ttl and snap.emitent_title != _ttl:
                snap.emitent_title = _ttl
            nm = moex_names.get(snap.isin)
            if nm and snap.issuer_full != nm:
                snap.issuer_full = nm
                named += 1
            eid = moex_ids.get(snap.isin)
            if eid and snap.emitent_id != eid:
                snap.emitent_id = eid            # канонический ключ эмитента (все выпуски одного эмитента)
        db.commit()
    except Exception as e:  # noqa: BLE001
        log.warning("issuer-name enrichment failed: %s", e)

    # Dohod-less floaters carry no quoted margin → they'd show no simple margin /
    # current yield. Backfill float_qm from the MOEX benchmark spread for any new
    # floater that still lacks one, then recompute its SM in place. Capped + best-
    # effort so a slow ISS never stalls the refresh.
    try:
        _enrich_new_floaters(db, ratings, curve, now)
    except Exception as e:  # noqa: BLE001
        log.warning("float_qm enrichment failed: %s", e)

    # DM к ОФЗ для флоатеров — пост-проходом, когда SM всех ОФЗ-ПК уже посчитаны
    try:
        _compute_floater_dm_ofz(db)
    except Exception as e:  # noqa: BLE001
        log.warning("floater DM-to-OFZ failed: %s", e)

    # кэш серий спреда НЕ сбрасываем: дневная история Мосбиржи внутри дня не меняется,
    # а обновление рынка идёт каждые 30 минут — серии устаревают только со сменой дня
    invalidate_rows_cache()
    return {"count": seen, "named": named, "boards": list(boards), "failed_boards": failed, "at": now.isoformat()}


def _ks_ruonia_basis_bp(months: int = 6) -> float:
    """Средняя разница «ключевая ставка − RUONIA» за последние `months` месяцев, б.п.
    (RUONIA на конец месяца из макро-кэша). Нет данных → 0."""
    try:
        from .macro import _load_disk
        _, d = _load_disk()
        ru = {r["date"]: r["val"] for r in (d or {}).get("ruonia") or [] if r.get("val") is not None}
        kr = {r["date"]: r["rate"] for r in (d or {}).get("rates_infl") or [] if r.get("rate") is not None}
        diffs = [kr[m] - ru[m] for m in sorted(set(ru) & set(kr))[-months:]]
        return round(sum(diffs) / len(diffs) * 100, 1) if diffs else 0.0
    except Exception:  # noqa: BLE001
        return 0.0


def _compute_floater_dm_ofz(db) -> int:
    """DM к ОФЗ для флоатеров = SM(бумага) − SM(ОФЗ-ПК на том же сроке).
    «КБД по флоатерам»: строим кривую simple margin ГОСФЛОАТЕРОВ (ОФЗ-ПК, secid SU29*/
    SU24*) по сроку до оферты/погашения и интерполируем — сравнение флоатер-к-флоатеру,
    без допущения про траекторию ставки. У самих ОФЗ-ПК DM ≈ 0 (они и есть бенчмарк)."""
    from datetime import date as _date, datetime as _dt

    def _yrs(d):
        if not d or d in ("0000-00-00", ""):
            return None
        try:
            return (_dt.strptime(d, "%Y-%m-%d").date() - _date.today()).days / 365.0
        except ValueError:
            return None

    def _tenor(s):
        # тот же горизонт, что у SM: оферта дальше 14 дней, иначе погашение
        return _yrs(zspread.horizon(s.isin, s.matdate, s.buyback_date)[0]) or _yrs(s.matdate) or s.years_to_maturity

    floaters = db.query(BondSnapshot).filter(BondSnapshot.kind == "floater").all()
    # кривая ОФЗ-ПК: (срок, SM), отсортированная по сроку
    govt = sorted((T, s.simple_margin_bp) for s in floaters
                  if (s.secid or "").startswith(("SU29", "SU24"))
                  and s.simple_margin_bp is not None and (T := _tenor(s)) and T > 0)
    if not govt:
        return 0

    def _interp(x):
        if x <= govt[0][0]:
            return govt[0][1]
        if x >= govt[-1][0]:
            return govt[-1][1]
        for i in range(1, len(govt)):
            if x <= govt[i][0]:
                (x0, y0), (x1, y1) = govt[i - 1], govt[i]
                return y0 + (y1 - y0) * (x - x0) / (x1 - x0) if x1 != x0 else y0
        return govt[-1][1]

    # Индексы разные: ОФЗ-ПК платят RUONIA, корпоративные флоатеры чаще — ключевую (CBR_RATE).
    # RUONIA обычно ниже ключевой → флоатер «КС + m» получает на эту разницу больше, чем бумага
    # «RUONIA + m». Приводим к одному индексу: + (КС − RUONIA), среднее за 6 мес (макро-кэш).
    # Флоатеры на инфляцию / золото / UST / ипотеку / КБД с ОФЗ-ПК не сравнимы → DM не считаем.
    basis_bp = _ks_ruonia_basis_bp()
    from .. import db as _dbm
    idx = {**_MOEX_BENCH, **{r.isin: r.float_index for r in db.query(_dbm.BondRating).filter(_dbm.BondRating.is_floater == True).all() if r.float_index}}  # noqa: E712
    n = 0
    for s in floaters:
        ix = idx.get(s.isin, "") or ("RUONIA" if (s.secid or "").startswith(("SU29", "SU24")) else "CBR_RATE")
        if s.simple_margin_bp is None or ix not in ("CBR_RATE", "RUONIA"):
            s.dm_ofz_bp = None
            continue
        T = _tenor(s)
        base = _interp(T) if T and T > 0 else None
        if base is None:
            s.dm_ofz_bp = None
            continue
        dm = round(s.simple_margin_bp - base + (basis_bp if ix == "CBR_RATE" else 0))
        s.dm_ofz_bp = dm if -3000 < dm < 20000 else None
        if s.dm_ofz_bp is not None:
            n += 1
    db.commit()
    invalidate_rows_cache()      # снимок изменился — пересобрать кэш строк при след. запросе
    return n


def _clean_spread_series(pts: list, win: int = 5) -> list:
    """Убираем разовые выбросы: точка, отскочившая от медианы соседних дней (±win) больше чем
    на max(100 б.п., 35% медианы), — это битая цена/доходность биржи, а не рынок
    (Брусника −487 б.п. среди ~1000, Томск −321…+719)."""
    vals = [v for _, v in pts]
    out = []
    for i, (d, v) in enumerate(pts):
        nb = sorted(vals[max(0, i - win):i] + vals[i + 1:i + 1 + win])
        if len(nb) >= 4:
            med = nb[len(nb) // 2]
            if abs(v - med) > max(100.0, 0.35 * abs(med)):
                continue
        out.append((d, v))
    return out


def spread_percentile(series: list, days: int = 365, min_n: int = 40) -> Optional[int]:
    """Перцентиль текущего спреда в его истории за последний год, 0..100.
    Текущий = медиана трёх последних торговых дней (одна сделка не решает); ранг — середина
    одинаковых значений. Меньше min_n чистых точек — None (мало истории/неликвид)."""
    from datetime import date, timedelta
    frm = (date.today() - timedelta(days=days)).isoformat()
    pts = [(p[0], float(p[1])) for p in series if p and p[1] is not None and p[0] >= frm]
    pts = _clean_spread_series(pts)
    if len(pts) < min_n:
        return None
    vals = [v for _, v in pts]
    cur = sorted(vals[-3:])[len(vals[-3:]) // 2]
    below = sum(1 for v in vals if v < cur)
    equal = sum(1 for v in vals if v == cur)
    return round(100 * (below + 0.5 * equal) / len(vals))


def compute_spread_percentiles(db, limit: int = 150) -> int:
    """Перцентиль текущего G-спреда (фиксы) / simple margin (флоатеры) по СОБСТВЕННОЙ
    истории бумаги, 0..100. Считается по ликвидным бумагам (приоритет — оборот),
    параллельно, и складывается в снимок. Тяжёлая операция → фоном после refresh."""
    from datetime import datetime
    from concurrent.futures import ThreadPoolExecutor
    ratings = _ratings_map(db)
    # валютные — не считаем: их G-спред к рублёвой КБД бессмыслен (перцентиль 100 → ложные «идеи»)
    snaps = [s for s in db.query(BondSnapshot).filter(_live_filter(db)).all()
             if (s.numtrades or 0) > 0 and s.kind in ("fixed", "floater") and _ccy(s.faceunit) == "RUB"]
    snaps.sort(key=lambda s: -((s.avg_volume if s.avg_volume is not None else s.volume) or 0))
    snaps = snaps[:limit]
    jobs = [(s.isin, s.kind,
             (ratings.get(s.isin).float_add if ratings.get(s.isin) else None) or s.float_qm)
            for s in snaps]

    def _one(job):
        isin, kind, qm = job
        try:
            h = instrument.issue_history(isin, qm=qm)
        except Exception:
            return isin, None
        series = h.get("simple_margin") if kind == "floater" else h.get("gspread_kbd")
        return isin, spread_percentile(series or [])

    now = datetime.utcnow()
    with ThreadPoolExecutor(max_workers=12) as ex:
        results = dict(ex.map(_one, jobs))
    n = 0
    for s in snaps:
        p = results.get(s.isin)
        if p is None:
            continue
        if s.kind == "floater":
            s.sm_pctl = p
        else:
            s.gspread_pctl = p
        s.spread_pctl_at = now
        n += 1
    db.commit()
    invalidate_rows_cache()      # перцентили обновились — пересобрать кэш строк
    log.info("spread percentiles computed for %d bonds", n)
    return n


def _enrich_new_floaters(db, ratings, curve, now, cap: int = 40) -> int:
    """Fetch and cache the quoted margin for floaters missing one, and recompute
    their simple margin / current yield so dohod-less floaters get full data."""
    base = curve["tenors"][0]["yield_pct"] if curve.get("tenors") else None
    todo = [
        s for s in db.query(BondSnapshot).filter(BondSnapshot.kind == "floater").all()
        if s.float_qm is None and not (ratings.get(s.isin) and ratings.get(s.isin).float_add)
    ][:cap]
    done = 0
    for s in todo:
        try:
            sp = moex.resolve_security(s.isin).get("coupon_benchmark_spread")
        except Exception:  # noqa: BLE001
            sp = None
        if sp is None:
            continue
        s.float_qm = sp
        _hz = zspread.horizon(s.isin, s.matdate, s.buyback_date)[0]
        _yo = _years_to(_hz) if _hz else None
        _sm = instrument.simple_margin_bp(s.price, _yo if (_yo and _yo > 0) else s.years_to_maturity, sp)
        s.simple_margin_bp = _sm if (_sm is not None and -3000 < _sm < 20000) else None
        cp_eff = s.couponpercent
        _rt = ratings.get(s.isin)
        _b = _index_rates().get(float_index_of(s.isin, _rt), base)
        if not cp_eff and _b is not None:
            cp_eff = round(_b + sp, 2)
        s.current_yield = round(cp_eff / s.price * 100.0, 2) if (cp_eff and s.price) else None
        s.updated_at = now
        done += 1
    if done:
        db.commit()
        log.info("float_qm enrichment: filled %d floaters", done)
    return done


def _recent_trade(snap) -> Optional[bool]:
    """Были ли сделки за последние ~месяц сессий (по накопленному дневному обороту).
    None — истории мало (новый выпуск), судить нельзя."""
    try:
        hist = json.loads(snap.vol_hist) if (snap is not None and snap.vol_hist) else {}
    except Exception:  # noqa: BLE001
        hist = {}
    if len(hist) < 10:
        return None
    return any((v or 0) > 0 for v in hist.values())


def select_valuation_price(r: dict, recent: Optional[bool] = None) -> tuple[Optional[float], Optional[str], bool]:
    """Pick the price used for analytics and record its provenance (spec §26/§48).

    1) сделка сегодня → LAST; 2) узкий стакан (≤3%) → середина;
    3) сделки были за последний месяц (recent) → рыночная цена биржи / средневзвешенная / цена
       прошлого дня, но в пределах текущего стакана: заявка на покупку выше неё или на продажу
       ниже — исполнимы, цена не может быть за ними;
    4) сделок за месяц не было → цена из двустороннего стакана не шире 10%, иначе старая цена,
       подтверждённая стаканом (±5% от заявки); неподтверждённые старые цены не берём (у Совкомбанк
       Факторинг 002P-05 «текущая цена» 118,23 — единственная сделка 16.01.2026, 8 месяцев назад,
       при заявке на покупку 98). Одинокая заявка — не цена (ВЭБ.РФ ПБО-002Р-51: одна заявка на
       покупку 60,5 без единой сделки).
    Returns (price, price_type, stale); stale = цена не из сделки сегодня."""
    traded_today = bool(r.get("numtrades"))
    last = r.get("last")
    bid, offer = r.get("bid"), r.get("offer")
    if bid and offer and offer <= bid:
        bid = offer = None                      # перевёрнутый стакан — сбой котировок
    if last and traded_today:
        return last, "LAST", False
    spread = (offer - bid) / ((offer + bid) / 2) if (bid and offer) else None
    if spread is not None and spread <= 0.03:
        return round((bid + offer) / 2.0, 3), "MID", True
    if recent is not False:
        for p, typ in ((r.get("marketprice"), "MARKET"), (r.get("waprice"), "WAPRICE"),
                       (r.get("prevprice"), "PREV"), (last, "LAST")):
            if p:
                if bid and p < bid:
                    return bid, "BID", True     # исполнимая заявка на покупку выше старой цены
                if offer and p > offer:
                    return offer, "OFFER", True
                return p, typ, True
    if spread is not None and spread <= 0.10:
        return round((bid + offer) / 2.0, 3), "MID", True
    # сделок за месяц не было: старая цена годится, только если её подтверждает текущий стакан —
    # заявка на покупку не дальше 5% ниже или на продажу не дальше 5% выше (ЗСД 03: цена 100,81
    # при заявке на покупку 98,4 — да; Совкомбанк Факторинг 002P-05: 118,23 при заявке 98 — нет)
    for p, typ in ((r.get("marketprice"), "MARKET"), (r.get("waprice"), "WAPRICE"),
                   (r.get("prevprice"), "PREV"), (last, "LAST")):
        if p and ((bid and bid <= p <= bid * 1.05) or (offer and offer * 0.95 <= p <= offer)):
            return p, typ, True
    return None, None, True


def _freq_from_period(period_days: Optional[float]) -> Optional[float]:
    if not period_days:
        return None
    return round(365.0 / period_days) if period_days else None


# --------------------------------------------------------------------------- #
# Query
# --------------------------------------------------------------------------- #
def _ratings_map(db: Session) -> dict[str, BondRating]:
    return {r.isin: r for r in db.query(BondRating).all()}


_ALLROWS: dict = {"sig": None, "rows": None}


def invalidate_rows_cache() -> None:
    """Сбросить кэш собранных строк (после обновления рынка / перцентилей)."""
    _ALLROWS["rows"] = None


def _live_filter(db: Session):
    """Условие «живая бумага»: не погашена (matdate ≥ сегодня или неизвестна) и пришла в
    последнем обновлении рынка (updated_at не старше самого свежего снимка более чем на
    2 дня) — погашенные и выпавшие с досок MOEX строки не показываем в скринере/динамике/
    идеях/поиске (раньше в скринере были бумаги, погашенные неделю назад)."""
    from datetime import date as _date, timedelta
    newest = db.query(func.max(BondSnapshot.updated_at)).scalar()
    today = _date.today().isoformat()
    conds = [or_(BondSnapshot.matdate.is_(None), BondSnapshot.matdate >= today, BondSnapshot.matdate == "0000-00-00")]
    if newest:
        conds.append(BondSnapshot.updated_at >= newest - timedelta(days=2))
    return and_(*conds)


def _all_rows(db: Session) -> list[dict]:
    """Все собранные строки (_row) для торгуемых бумаг. Кэш: пересобирается только когда
    меняется снимок (число бумаг или max updated_at) — иначе на КАЖДЫЙ запрос скринера
    пересобирался _row + матчинг рейтингов для ~3000 бумаг, что тормозило на shared-CPU."""
    _spv_map(db)                       # SPV без ИНН → эмитент группы (для _emkey / рейтингов)
    cnt, upd = db.query(func.count(BondSnapshot.isin), func.max(BondSnapshot.updated_at)).first()
    sig = (cnt, upd.isoformat() if upd else None)
    if _ALLROWS["rows"] is None or _ALLROWS["sig"] != sig:
        ratings = _ratings_map(db)
        amap = agencies.ratings_map(db)
        # Торгуемые = есть YTM (фиксы/дисконты) ИЛИ это флоатер с текущей доходностью.
        # У флоатеров YTM нет by design (считается SM/текущая доходность) — без этого
        # условия ~124 флоатера, вкл. ликвидные ОФЗ-ПК (SU29xxx), выпадали из скринера.
        # Фиксы без YTM НЕ включаем — это битые/погашенные котировки (мусор).
        _ALLROWS["rows"] = [_row(snap, ratings.get(snap.isin), amap)
                            for snap in db.query(BondSnapshot).filter(_live_filter(db)).filter(
                                or_(BondSnapshot.ytm.isnot(None),
                                    and_(BondSnapshot.kind == "floater", BondSnapshot.current_yield.isnot(None)),
                                    # фиксы с офертой: MOEX-YTM к оферте отфильтрован, но доходность
                                    # к погашению считаем в _row (fallback) — включаем их в скринер
                                    and_(BondSnapshot.kind.in_(("fixed", "discount")),
                                         BondSnapshot.buyback_date.isnot(None),
                                         BondSnapshot.price.isnot(None),
                                         BondSnapshot.couponpercent > 0))).all()]
        _inherit_by_emitent(_ALLROWS["rows"])
        _ALLROWS["sig"] = sig
    return _ALLROWS["rows"]


_RT_FIELDS = ("rating", "rating_bucket", "rating_score", "rating_agency", "agency_rating", "agency_bucket",
              "agency_name", "agency_forecast", "agency_action", "agency_action_date", "agency_all",
              "agency_trend", "agency_prev_rating", "rating_expected")


# код выпуска в полном названии MOEX: «БО 002Р-07», «СУБ-Т1-3», «001Р-425R», «кл.Б», «сер.28»
_SERIES_TOKEN = re.compile(r"^(?:БО|БО-.+|ПБО.*|СУБ.*|CIB-.+|кл\.?.*|сер\.?.*|выпуск|Б-\d.*|Б1P.*"
                           r"|\d{3}[PРКK].*|[A-ZА-Я]{1,4}\d.*|\d+[A-ZА-Яa-zа-я].*|\d+-.*)$", re.I)


def _brand_from_full(full: str | None) -> str | None:
    """Имя эмитента из полного названия выпуска: «ДиректЛизинг БО 002Р-07» → «ДиректЛизинг»,
    «ФСК Россети(ПАО)-обл. сер.28» → «ФСК Россети(ПАО)». Число в середине имени не режем
    («ИКС 5 ФИНАНС»), а номер серии в конце — режем («СОПФ ДОМ.РФ 16»)."""
    if not full:
        return None
    s = re.sub(r'[«»"]', "", full.split(",")[0])
    s = re.split(r"-обл\.?|\sобл\.?\s", s)[0]
    toks = s.split()
    out: list[str] = []
    for i, t in enumerate(toks):
        if out and (_SERIES_TOKEN.match(t) or (t.isdigit() and i == len(toks) - 1)):
            break
        out.append(t)
    return " ".join(out).strip() or None


def _inherit_by_emitent(rows: list[dict]) -> None:
    """Рейтинг (уровня эмитента) и сектор — общие для всех выпусков эмитента. Если у части
    выпусков имя в реестре не сопоставилось (ВЭБ.РФ, ФСК Россети, регионы: часть выпусков
    NR), берём их у других выпусков с тем же MOEX emitent_id (самый частый вариант)."""
    from collections import Counter
    grp: dict = {}
    for r in rows:
        # в справочнике dohod поле «эмитент» у 613 бумаг — это название выпуска: «АФК Система,
        # 001P-04», «АФК Система, 001P-05»… Одна компания превращалась в шесть «эмитентов»
        # по одному выпуску, и ломались поиск и карта эмитента. После «, » всегда идёт код
        # выпуска, транш или второе имя — режем. «Аптечная сеть 36,6» не задевает: там нет пробела
        if r.get("issuer") and ", " in r["issuer"]:
            r["issuer"] = r["issuer"].split(", ", 1)[0].strip()
        if r.get("emitent_id"):
            grp.setdefault(r["emitent_id"], []).append(r)
    for eid, rs in grp.items():
        # наследуем только рейтинг ЭМИТЕНТА: рейтинг выпуска (issue / .sf) относится к одной бумаге
        rated = [r for r in rs if r.get("rating") and r.get("rating_scope") in ("issuer", "issuer_sub")]
        if rated and any(not r.get("rating") for r in rs):
            best = Counter(r["rating"] for r in rated).most_common(1)[0][0]
            src = next(r for r in rated if r["rating"] == best)
            src_all = [a for a in (src.get("agency_all") or []) if a.get("level") != "issue"] or None
            for r in rs:
                if not r.get("rating"):
                    for f in _RT_FIELDS:
                        r[f] = src.get(f)
                    r["agency_all"] = src_all
                    r["rating_scope"] = "issuer"
                    r["rating_match"] = "emitent"
        # имя эмитента: у 436 бумаг (свежие выпуски — их ещё нет в справочнике dohod) поле
        # было пустым, и в скринере в колонке «Эмитент» стоял прочерк. Берём самое частое
        # имя у других выпусков того же эмитента, а если их нет — из полного названия выпуска
        names = [r["issuer"] for r in rs if r.get("issuer")]
        # одно юрлицо (один emitent_id биржи) — одно имя. В справочнике у 142 компаний по два
        # варианта: «Т-Банк» и «АО "ТБанк"», «ТрансФин-М» и «ПАО "ТрансФин-М"» — в поиске и на
        # карте эмитента это были два разных эмитента. Берём брендовое имя без кавычек и
        # формы собственности, если оно есть, иначе самое частое
        brand = [n for n in names if not re.search(r'["«»]', n)]
        canon = Counter(brand or names).most_common(1)[0][0] if names else None
        if not canon:          # ни у одного выпуска имени нет — одно имя из полных названий на всех
            full = [b for b in (_brand_from_full(r.get("issuer_full")) for r in rs) if b]
            canon = Counter(full).most_common(1)[0][0] if full else None
        for r in rs:
            r["issuer"] = canon
        # отрасль — свойство юрлица, а не выпуска: у X5 три выпуска из шестнадцати, у Магнита один
        # из девяти стояли в «Девелопменте». Все выпуски эмитента получают самую частую отрасль
        secs = [r["sector"] for r in rs if r.get("sector")]
        if secs:
            sec = Counter(secs).most_common(1)[0][0]
            for r in rs:
                r["sector"] = sec
        for r in rs:
            _fix_sector(r)


# отрасль приходит из справочника dohod и иногда не отражает бизнес эмитента:
# «Каршеринг Руссия» (Делимобиль) записан в лизинг, хотя это каршеринговый оператор —
# машины он покупает в лизинг, а зарабатывает на поминутной аренде.
SECTOR_OVERRIDE = ((r"атомэнергопром|атомный энергопромышленный комплекс", "Электроэнергетика и ЖКХ"),
                   (r"каршеринг|делимобил", "Транспорт и логистика"),
                   # розничная сеть О'КЕЙ стояла в «Девелопменте», а ПИР («Партнерство, Инвестиции,
                   # Развитие», ОКВЭД 45.19 — торговля автотехникой и спецтехникой) — в «Лизинге»:
                   # выручка у него сравнима с активами, себестоимость 75% выручки, растут запасы
                   (r"о'кей", "Ритейл и торговля"),
                   (r"партнерство, инвестиции, развитие|^ооо \"?пир\"?(\s|$)", "Ритейл и торговля"))


def _fix_sector(row: dict) -> None:
    name = ((row.get("issuer") or "") + " " + (row.get("issuer_full") or "") + " " + (row.get("name") or "")).lower()
    for pat, sector in SECTOR_OVERRIDE:
        if re.search(pat, name):
            row["sector"] = sector
            return


def query(db: Session, *, boards: Optional[list[str]] = None, kinds: Optional[list[str]] = None,
          rating_buckets: Optional[list[str]] = None, sectors: Optional[list[str]] = None,
          currencies: Optional[list[str]] = None, liq: Optional[list[str]] = None,
          ytm_min: Optional[float] = None, ytm_max: Optional[float] = None,
          cy_min: Optional[float] = None, cy_max: Optional[float] = None,
          dur_min: Optional[float] = None, dur_max: Optional[float] = None,
          vol_min: Optional[float] = None, vol_max: Optional[float] = None,
          search: Optional[str] = None, only_traded: bool = True, clean: bool = False,
          coupon_freq: Optional[list[str]] = None, has_offer: bool = False, amort: bool = False,
          sort: str = "ytm", desc: bool = True, limit: int = 300, isins: Optional[list[str]] = None) -> dict:
    # Все строки берём из КЭША (собираются только при обновлении рынка), фильтры —
    # в Python по готовым dict. Это убирает пересборку _row + матчинг рейтингов на
    # каждый запрос — именно она тормозила сортировку/фильтры на слабом хостинге.
    needle = search.casefold() if search else None
    _today = date.today().isoformat()
    boards_s = set(boards) if boards else None
    kinds_s = set(kinds) if kinds else None     # _row уже мапит unknown→fixed
    rb_s = set(rating_buckets) if rating_buckets else None
    sec_s = set(sectors) if sectors else None
    ccy_s = set(currencies) if currencies else None
    liq_s = set(liq) if liq else None
    cf_s = set(coupon_freq) if coupon_freq else None
    isin_s = {i.strip().upper() for i in isins} if isins else None
    rows = []
    for row in _all_rows(db):
        if isin_s is not None and row.get("isin") not in isin_s:
            continue                            # «★ Избранное» — по всему рынку, а не по загруженной странице
        if boards_s and row.get("board") not in boards_s:
            continue
        if kinds_s and row.get("kind") not in kinds_s:
            continue
        # YTM у флоатеров не определена; текущая доходность фильтруется отдельно.
        _yf = row.get("ytm") if row.get("kind") != "floater" else None
        if ytm_min is not None and (_yf is None or _yf < ytm_min):
            continue
        if ytm_max is not None and (_yf is None or _yf > ytm_max):
            continue
        _cy = row.get("current_yield")
        if cy_min is not None and (_cy is None or _cy < cy_min):
            continue
        if cy_max is not None and (_cy is None or _cy > cy_max):
            continue
        # «Дюр. / срок»: у флоатера в колонке срок до погашения — по нему и фильтруем
        _df = row.get("years_to_maturity") if row.get("kind") == "floater" else row.get("duration_years")
        if dur_min is not None and (_df is None or _df < dur_min):
            continue
        if dur_max is not None and (_df is None or _df > dur_max):
            continue
        if vol_min is not None and (row.get("volume") or 0) < vol_min:
            continue
        if vol_max is not None and (row.get("volume") or 0) > vol_max:
            continue
        if needle and needle not in f"{row.get('name') or ''} {row.get('isin') or ''}".casefold():
            continue
        if ccy_s and row.get("currency") not in ccy_s:
            continue
        if liq_s and row.get("liq_class") not in liq_s:
            continue
        if rb_s and row.get("rating_bucket") not in rb_s:
            continue
        if sec_s and row.get("sector") not in sec_s:
            continue
        if cf_s:
            cf = row.get("couponfrequency")
            if cf is None or str(int(cf)) not in cf_s:
                continue
        if has_offer:
            od = row.get("offer_date")
            if not (od and od >= _today):
                continue
        if amort and not row.get("is_amortizing"):
            continue
        if clean:
            if row.get("noncomparable"):
                continue
            ey = row["current_yield"] if row["kind"] == "floater" else row["ytm"]
            if ey is None or ey <= 0 or ey > 60:
                continue
            if row["price"] is not None and (row["price"] < 20 or row["price"] > 140):
                continue
            if (row.get("volume") or 0) < 5e5:
                continue
        rows.append(row)

    # Sort so that missing values ALWAYS sink to the bottom, regardless of
    # direction (otherwise a desc sort floats the nulls to the top).
    none_val = float("-inf") if desc else float("inf")

    # рейтинг — по числовому баллу (строки «A/AA/AAA/B…» по алфавиту сортируются неверно)
    skey = "rating_score" if sort in ("rating", "rating_bucket", "agency_rating") else sort

    def _v(x):
        v = x.get(skey)
        if skey == "ytm" and x.get("kind") == "floater":
            v = None                            # у флоатера в колонке YTM прочерк
        if skey == "duration_years" and x.get("kind") == "floater":
            v = x.get("years_to_maturity")          # как в колонке «Дюр. / срок»
        return v
    num = [r for r in rows if isinstance(_v(r), (int, float))]
    txt = [r for r in rows if isinstance(_v(r), str)]
    nul = [r for r in rows if _v(r) is None or not isinstance(_v(r), (int, float, str))]
    num.sort(key=_v, reverse=desc)
    txt.sort(key=lambda r: _v(r).casefold(), reverse=desc)
    rows = num + txt + nul                     # пустые — всегда внизу, при любом направлении
    total = len(rows)
    updated = db.query(func.max(BondSnapshot.updated_at)).scalar()
    # Сводные средние считаем по ВСЕМУ отфильтрованному набору (не по показанной
    # странице в limit) и ТОЛЬКО по фиксам — у флоатеров нет осмысленного YTM.
    # Тогда выбор фильтра «фикс» не меняет среднюю YTM/дюрацию (флоатеры и так не в счёте).
    # fixed + discount — у них сопоставимый номинальный YTM; флоатеры (нет YTM) и
    # линкеры (реальная доходность, несопоставима) в среднюю не входят.
    # средняя — по «нормальным» фиксам/дисконтам: дистресс с YTM>60% (цена 10–50%
    # номинала) исказил бы среднюю в разы, поэтому такие выбросы в среднюю не берём.
    _fx = [r for r in rows if r.get("kind") in ("fixed", "discount")]
    _yv = [r["ytm"] for r in _fx if r.get("ytm") is not None and r["ytm"] < 60]
    _dv = [r["duration_years"] for r in _fx if r.get("duration_years") is not None and (r.get("ytm") is None or r["ytm"] < 60)]
    return {"rows": rows[:limit], "total": total,
            "avg_ytm": round(sum(_yv) / len(_yv), 2) if _yv else None,
            "avg_dur": round(sum(_dv) / len(_dv), 2) if _dv else None,
            "updated_at": (updated.isoformat() + "Z") if updated else None}


_SERIES_TOK = re.compile(r"^(бо|бп|б|п|об|обл|сер|серия|выпуск|бонд|r|р|\d.*|[a-zа-я]?\d+.*)$")


def _is_series_tok(t: str) -> bool:
    """A leftover token that looks like a series/issue code, not a distinct word
    (digits, "БО", "001P", "П03", "R"…). Used to reject false prefix matches."""
    return bool(_SERIES_TOK.match(t)) or len(t) <= 1


def _match_agency(amap: Optional[dict], *names) -> Optional[list]:
    """Find an issuer's agency ratings by matching a bond/issuer name to the
    registry. Bond names carry a series suffix ("ПАО НК Роснефть 001P-01",
    "РЖД, 28") the registry entry ("нк роснефть") lacks, so we take the LONGEST
    leading token-prefix that exists as a registry key.

    CRITICAL guard: a prefix is accepted only if every LEFTOVER token is a
    series/issue code — otherwise "Альфа-Дон Транс" would falsely match the
    registry key "альфа" (Альфа-Банк). If the leftover carries a real word, the
    names are different issuers and we reject the match."""
    if not amap:
        return None
    for nm in names:
        if not nm:
            continue
        toks = agencies.normalize_name(nm).split()
        for L in range(len(toks), 0, -1):
            key = " ".join(toks[:L])
            if key in amap and all(_is_series_tok(t) for t in toks[L:]):
                return amap[key]
    return None


_AAA_SCORE = ratings.normalize_rating("AAA")[1]


def _is_sovereign_ru(snap: BondSnapshot) -> bool:
    """ОФЗ (secid SU*, incl. ОФЗ-ПК серии 29) and Russian SOVEREIGN replacement
    bonds (ЗО РФ, issuer Минфин / Российская Федерация) carry the sovereign
    rating — AAA by definition, even though no agency assigns a corporate rating
    to the state itself."""
    if (snap.secid or "").startswith("SU") or str(getattr(snap, "emitent_id", "") or "") == _MINFIN_EID:
        return True          # ОФЗ, в т.ч. юаневые (без SU*), и суверенные евробонды — эмитент MOEX 1228
    name = f"{snap.issuer_full or ''} {snap.shortname or ''}".lower()
    # ТОЛЬКО федеральный суверен. «минфин» без «росс/рф» — это РЕГИОН (Минфин
    # Ульяновской обл. и т.п.), у него собственный агентский рейтинг (AA/BBB/BB),
    # НЕ AAA. ОВОЗ РФ / РФ ЗО — суверенные замещающие евробонды Минфина РФ;
    # «россия»/«российская федерация»/«russia» — прямые суверенные выпуски.
    return (any(m in name for m in ("минфин росс", "минфин рф", "министерство финансов росс",
                                    "российская федерац", "russian federation", "russia",
                                    "овоз рф", "рф зо", "рф-зо", "говоз", "овоз"))
            or name.lstrip().startswith("россия"))


_MINFIN_EID = "1228"      # MOEX emitent_id Минфина РФ: все ОФЗ (в т.ч. в юанях) и суверенные евробонды


def _is_sov_row(r: dict) -> bool:
    """То же, что _is_sovereign_ru, для строки-словаря (скринер / похожие выпуски)."""
    if (r.get("secid") or "").startswith("SU") or str(r.get("emitent_id") or "") == _MINFIN_EID:
        return True
    nm = f"{r.get('issuer_full') or ''} {r.get('issuer') or ''} {r.get('name') or ''}".lower()
    return any(m in nm for m in ("минфин росс", "минфин рф", "министерство финансов росс", "российская федерац",
                                 "говоз", "овоз", "рф зо", "рф-зо")) or nm.lstrip().startswith("россия")


def _synth_ytm_dur(price, coupon_pct, freq, years, accint, face):
    """Доходность к погашению и дюрация Маколея из купона/срока (без запросов в MOEX).
    Синтетический график: равные купоны freq раз/год до погашения + номинал в конце.
    Используется как fallback, когда MOEX отдаёт доходность к близкой оферте (артефакт)."""
    face = face or 1000.0
    freq = max(1, min(int(freq or 2), 12))
    cpn = (coupon_pct / 100.0) / freq * face
    # купоны — НАЗАД от даты погашения с шагом 1/freq (первый купон — через «хвост» периода,
    # а не через полный период от сегодня: НКД уже в грязной цене)
    ts, t = [], float(years or 0)
    while t > 1e-6:
        ts.append(t)
        t -= 1.0 / freq
    if not ts:
        return None, None
    flows = [(x, cpn) for x in sorted(ts)]
    flows[-1] = (flows[-1][0], flows[-1][1] + face)          # +номинал в конце
    dirty = price / 100.0 * face + (accint or 0.0)
    npv = lambda y: sum(a / (1 + y) ** t for t, a in flows) - dirty
    # верхняя граница 10 000%: к оферте через неделю при цене 96 годовая доходность ~1200%
    lo, hi = -0.9, 100.0
    if npv(lo) * npv(hi) > 0:
        return None, None
    for _ in range(100):
        m = (lo + hi) / 2
        if npv(lo) * npv(m) < 0:
            hi = m
        else:
            lo = m
    y = (lo + hi) / 2
    pv = sum(a / (1 + y) ** t for t, a in flows)
    dur = (sum(t * a / (1 + y) ** t for t, a in flows) / pv) if pv else years
    return round(y * 100, 2), round(dur, 2)


def _agency_ratings_for_snapshot(snap: BondSnapshot, rt: Optional[BondRating], amap: Optional[dict] = None):
    """Use the same identifiers and name fallbacks everywhere a bond rating is shown.

    The screener has the normalized issuer name from ``BondRating`` in addition to
    the two MOEX names.  Detail endpoints used to omit it, so an issuer could be
    rated in the screener but lose an agency (or the whole rating) after opening
    the bond card.
    """
    by_name = _match_agency(amap, rt.issuer if rt else None, snap.issuer_full, snap.shortname)
    return agencies.for_bond(amap, snap.isin, _parent_eid(snap.emitent_id), by_name)


def agency_ratings_for_snapshot(db: Session, snap: BondSnapshot, amap: Optional[dict] = None):
    """DB-aware wrapper used by API endpoints; keeps detail cards aligned with `_row`."""
    _spv_map(db)
    rt = db.get(BondRating, snap.isin)
    return _agency_ratings_for_snapshot(snap, rt, amap if amap is not None else agencies.ratings_map(db))


def _row(snap: BondSnapshot, rt: Optional[BondRating], amap: Optional[dict] = None) -> dict:
    # Рейтинги агентств (АКРА / Эксперт РА / НКР): рейтинг ВЫПУСКА по ISIN, рейтинг ЭМИТЕНТА по
    # MOEX emitent_id (мост через ИНН / ISIN выпусков / полное юр. название); матчинг по имени —
    # только запасной путь для агентств, не найденных по идентификаторам. Показываем ХУДШИЙ.
    ag_list, ag_match = _agency_ratings_for_snapshot(snap, rt, amap)
    ag_best = agencies.best_for(ag_list) if ag_list else None
    # Sovereign override: ОФЗ и суверенные ЗО РФ → AAA (см. _is_sovereign_ru).
    if _is_sovereign_ru(snap):
        ag_best = {"rating": "AAA(RU)", "bucket": "AAA", "score": _AAA_SCORE,
                   "agency": "Суверен РФ", "forecast": None}
    # A floater has NO meaningful YTM / G-spread / spread-to-OFZ — its future
    # coupons float, so MOEX's "yield" (current coupon held flat) is bogus. Show
    # ONLY simple margin + current yield for floaters. Null the rest at source.
    is_float = snap.kind == "floater"
    # ОФЗ-ИН (SU52) real-yield linkers, ОФЗ-АД (SU46) amortized, and structured
    # notes are not curve-comparable — no G-spread for any of them.
    is_linker = snap.kind in ("linker", "structured") or (snap.secid or "").startswith(("SU46", "SU48", "SU52"))
    is_fx = _ccy(snap.faceunit) != "RUB"
    # Структурные ноты (купон ≈0, напр. ГПБ инвест-облигации с купоном 0.01%),
    # торгуемые с ПРЕМИЕЙ к номиналу, дают большой ОТРИЦАТЕЛЬНЫЙ номинальный «YTM»
    # (покупаешь за 119 → гасят по 100 без купона): это не сопоставимая доходность.
    # Любой отрицательный номинальный YTM в режиме ставок 15%+ — тоже нота/сбой.
    # Настоящие дисконтные бумаги (kind=discount, цена<номинала, YTM>0) не трогаем.
    _px = snap.price or 0
    _zero = contract_terms.zero_coupon(snap.isin)
    _structured_note = (snap.couponpercent is not None and snap.couponpercent < 0.5
                        and snap.kind != "discount" and not _zero)
    # у флоатера биржевая «доходность» — купон, растянутый на весь срок, и бывает отрицательной
    # у бумаг по номиналу; признаком аномалии она не служит (иначе прятались 166 торгуемых
    # флоатеров НорНикеля, Россетей, Русала и др.)
    _neg_ytm = snap.ytm is not None and snap.ytm < 0 and not is_float
    # структурная нота (выплата зависит от базового актива) по цене в доли процента номинала:
    # формально YTM выходит 2 170 011% (СбКИБ1P285 по 0,12%), и в скринере с выключенным
    # «прятать аномалии» такие числа стояли в колонке доходности. Карточка выпуска их и так
    # показывает без доходности — делаем так же
    _struct_absurd = snap.kind == "structured" and snap.ytm is not None and snap.ytm > 100
    is_noncomparable = _structured_note or _struct_absurd
    ytm_out = None if (is_float or is_noncomparable) else snap.ytm  # FX keeps its ruble-basis YTM
    # G-spread / spread-to-OFZ: not for floaters; not for FX (that spread is just
    # the FX-risk premium); not for linkers (their yield is a real yield, not
    # comparable to the nominal КБД).
    # Defaulted paper trades at 0,1–10% of par → the IRR math yields a 400–3 000 000%
    # "YTM" and a spread in hundreds of thousands of basis points. That is arithmetically
    # real but meaningless as a credit spread and wrecks the display and peer medians.
    # Filter by the yield itself, not by the spread: a bond with a live price and a
    # believable YTM keeps its spread however wide it is. Так у распродажи вроде
    # БалтЛизП15 (цена 96,9 → 83,6 за девять сессий, доходность 32% → 61%) спред
    # в 4700 б.п. остаётся на месте, а мусор с ценой 0,12% номинала — нет.
    # доходность проверяем ту, от которой спред посчитан: у бумаг без сделок биржа доходности
    # не даёт, мы считаем её сами к погашению — и фильтр по биржевой (пустой) гасил их спред
    def _sane_spread(v, y=snap.ytm):
        live = (snap.price or 0) > 20 and y is not None and y < 200
        return v if (v is not None and -800 < v < 20000 and live) else None
    g_out = None if (is_float or is_fx or is_linker or is_noncomparable) else _sane_spread(snap.g_spread_bp)
    ofz_out = None if (is_float or is_fx or is_linker or is_noncomparable) else _sane_spread(snap.spread_ofz_bp)
    # Read-time clamp of simple margin: a distressed / non-trading floater can carry
    # a stale absurd value (±40000 bp) that the refresh guards never revisit because
    # the bond no longer trades. Null anything outside the plausible band on output.
    sm_out = snap.simple_margin_bp if (snap.simple_margin_bp is not None
                                       and -3000 < snap.simple_margin_bp < 20000) else None
    # Fallback: у бумаги с офертой MOEX считает доходность/дюрацию к близкой оферте; при
    # цене-дисконте это даёт абсурдный YTM (>60%), который фильтр гасит в None → карточка и
    # спреды пустые. Показываем доходность К ПОГАШЕНИЮ (из купона/срока, без запросов) и
    # спреды от неё, чтобы поля не были пустыми.
    dur_out = snap.duration_years
    to_maturity = False
    _flt_ref = None
    if is_float:
        _qm = (rt.float_add if rt and rt.float_add is not None else None)
        _qm = _qm if _qm is not None else snap.float_qm
        _ixn = float_index_of(snap.isin, rt)
        # индекс неизвестен (биржа не указала): ОФЗ-ПК — RUONIA; у прочих не угадываем — среди них
        # флоатеры на золото, инфляцию, ипотеку, и «ключевая + маржа» дала бы неверные метрики
        if not _ixn and (snap.secid or "").startswith(("SU29", "SU24")):
            _ixn = "RUONIA"
        _ixv = _index_rates_cached().get(_ixn)
        _flt_ref = round(_ixv + _qm, 2) if (_ixv is not None and _qm is not None) else snap.couponpercent
    _sc = zspread.schedules().get(snap.isin) or {}
    _amort = len({d for d, v in _sc.get("a", []) if v and v > 0}) > 1 or \
        "амортиз" in (snap.type_label or "").lower() or \
        (snap.secid or "").startswith(("SU46", "SU48"))
    # ипотечные бумаги ДОМ.РФ (ИЦБ): в поле даты выкупа биржа кладёт не оферту, а ожидаемую
    # дату полного погашения по своей модели досрочных выплат (у ИАДОМ 1P59 — 2033 год при
    # погашении в 2056). Офертой это не считаем, доходность подписываем по модели
    _mbs = bool(re.search(r"ипотечн\w* агент", (snap.issuer_full or "") + " " + (getattr(snap, "emitent_title", "") or ""), re.I)
                or re.match(r"^s?(ИАДОМ|ИА ДОМ|ДОМРФИА)", snap.shortname or ""))
    # ГОРИЗОНТ ВСЕХ МЕТРИК — оферта. Берём ближайшую действующую оферту с биржи (общий график
    # выплат + BUYBACKDATE), до которой больше 14 дней: к ней считаются доходность, дюрация,
    # G-спред, спред к ОФЗ, simple margin, DM и z-спред. Оферта через 14 дней и меньше
    # пропускается — приём заявок на неё обычно закрыт, а годовая метрика на горизонте в
    # несколько дней — шум от цены (ПР-Лиз 2P2 при 93,3 давала 9023%); тогда — следующая оферта
    # или погашение (offer_soon — сколько дней до пропущенной). Колл-опцион эмитента — тоже оферта:
    # биржа его дат не публикует, они с dohod.ru (единственное, что оттуда берём).
    _offer_date, offer_soon = (None, None) if _mbs else zspread.horizon(snap.isin, snap.matdate, snap.buyback_date)
    _offer_type = zspread.horizon_type(snap.isin, _offer_date)
    _cash_horizon = _offer_date
    _yield_limitation = None
    ytm_basis = None
    _yield_checked = False
    if not is_float and not is_noncomparable:
        ytm_basis = "mbs" if _mbs else ("offer" if _offer_date else "maturity")
        # валютные выпуски к графику не пересчитываем (номинал в валюте, НКД биржа даёт в рублях):
        # доходность остаётся биржевой, и подпись должна говорить, к какой дате её посчитала биржа —
        # по дюрации: к оферте она не бывает длиннее срока до неё
        if is_fx and _offer_date:
            _yto = (date.fromisoformat(_offer_date) - date.today()).days / 365.0
            if dur_out is None or dur_out > _yto + 0.02:
                ytm_basis = "maturity"
        # Доходность и дюрация к горизонту — по точному графику выплат, когда биржа могла
        # посчитать к другой дате: есть оферта (биржа нередко считает к погашению или к близкой
        # оферте) или биржевой доходности нет. Без оферт — значение биржи (оно к погашению).
        if not _mbs and snap.kind not in ("linker", "structured") and not (snap.secid or "").startswith("SU52"):
            yd = None
            try:
                _sd = getattr(snap, "settledate", None)
                _acc = snap.accint
                if is_fx:
                    from . import bond_math
                    _acc = bond_math.accrued(_sc.get("c", []), date.fromisoformat(_sd) if _sd else zspread.settle_date())
                if not is_fx or _acc is not None:
                    yd, _cash_horizon, _yield_limitation = zspread.selected_fixed_yield(
                        snap.isin, price=snap.price, accint=_acc, face=snap.facevalue,
                        matdate=snap.matdate, horizon=_offer_date, settledate=_sd)
            except Exception as e:  # noqa: BLE001
                log.debug("ytm к горизонту %s: %s", snap.isin, e)
            if yd:
                _yield_checked = True
                ytm_out, dur_out, to_maturity = yd[0], yd[1], False
                ytm_basis = "offer" if _cash_horizon else "maturity"
                to_maturity = bool(_offer_date and not _cash_horizon)
                g_out = ofz_out = None
                if not is_linker and not is_fx:
                    try:
                        _gy = instrument.gcurve_yield(dur_out, instrument.gcurve())
                        if _gy is not None:
                            g_out = _sane_spread(round((ytm_out - _gy) * 100), ytm_out)
                        _ref = instrument.nearest_ofz(dur_out, instrument.ofz_benchmarks(), by="duration")
                        if _ref:
                            ofz_out = _sane_spread(round((ytm_out - _ref["ytm"]) * 100), ytm_out)
                    except Exception:  # noqa: BLE001
                        pass
            else:
                ytm_out = dur_out = g_out = ofz_out = None
                to_maturity = False
    # Z-спред к RUONIA OIS — общая шкала для фиксов и флоатеров (см. zspread.py), к тому же
    # горизонту. Не считаем: валютные, линкеры и структурные, ипотечные ДОМ.РФ (досрочные
    # погашения по модели), флоатеры на прочие индексы (ИПЦ, КБД, ипотека) — к OIS несопоставимы.
    z_out = None
    if not (is_fx or is_linker or (is_noncomparable and not is_float) or _mbs):
        try:
            if is_float:
                z_out = zspread.zspread_bp(snap.isin, kind="floater", price=snap.price, accint=snap.accint,
                                           face=snap.facevalue, horizon=_offer_date, index=_ixn, margin=_qm,
                                           settledate=getattr(snap, "settledate", None))
            else:
                z_out = zspread.zspread_bp(snap.isin, kind="fixed", price=snap.price, accint=snap.accint,
                                           face=snap.facevalue, horizon=_cash_horizon,
                                           settledate=getattr(snap, "settledate", None))
        except Exception as e:  # noqa: BLE001 — метрика необязательна, строка важнее
            log.debug("z-спред %s: %s", snap.isin, e)
    return {
        "isin": snap.isin, "secid": snap.secid, "board": snap.board,
        "name": snap.shortname,
        "yield_source": "cashflows" if _yield_checked else None,
        "yield_conditional_on_call": bool(_yield_checked and _offer_type == "CALL" and _cash_horizon),
        "yield_limitation": _yield_limitation,
        "yield_contract_source": (contract_terms.issue(snap.isin).get("redemptions", [{}])[0].get("source")
                                  if _yield_checked and _cash_horizon and contract_terms.redemption_price(snap.isin, _cash_horizon) is not None
                                  else _zero.get("source") if _yield_checked and _zero else None),
        "yield_status": ("verified_cashflows" if _yield_checked else "scenario_required" if is_float else
                         "insufficient_contract_data" if ytm_out is None else "specialized_exchange_model"),
        "settledate": getattr(snap, "settledate", None),
        # corporates that aren't флоатер/линкер are fixed-coupon — show «фикс», not «—»
        "kind": "discount" if _zero else "fixed" if snap.kind in (None, "unknown") else snap.kind,
        "type_label": "Дисконт" if _zero else snap.type_label,
        "matdate": snap.matdate, "years_to_maturity": snap.years_to_maturity,
        "currency": _ccy(snap.faceunit),
        # FX bonds: YTM/G-spread are on a ruble basis (cash flows at current rate)
        "ruble_basis": _ccy(snap.faceunit) != "RUB" and not is_float and not _yield_checked,
        "price": snap.price, "ytm": ytm_out, "duration_years": dur_out,
        # true → YTM/спреды посчитаны К ПОГАШЕНИЮ (fallback вместо к оферте)
        "ytm_to_maturity": to_maturity,
        "ytm_basis": ytm_basis,
        "offer_soon_days": offer_soon,
        # структурная нота / отрицательный YTM — аномалия: прячется фильтром «аномалии»
        "noncomparable": is_noncomparable,
        # price provenance (spec §26): which quote the price came from + freshness
        "price_type": snap.price_type, "price_stale": snap.price_stale,
        "bid": snap.bid, "offer": snap.offer,
        "g_spread_bp": g_out, "spread_ofz_bp": ofz_out,
        # флоатеры: DM к ОФЗ (Excess DM над госкривой) — аналог «к ОФЗ» у фиксов
        "dm_ofz_bp": (snap.dm_ofz_bp if (is_float and snap.dm_ofz_bp is not None
                      and -3000 < snap.dm_ofz_bp < 20000) else None),
        # единый ключ «к ОФЗ / DM» для сортировки столбца: фикс → спред к ОФЗ, флоатер → DM
        "ofz_dm_bp": ((snap.dm_ofz_bp if (snap.dm_ofz_bp is not None
                       and -3000 < snap.dm_ofz_bp < 20000) else None) if is_float else ofz_out),
        "simple_margin_bp": sm_out, "base_rate": snap.base_rate,
        "z_spread_bp": z_out,
        "gspread_pctl": None if is_float else snap.gspread_pctl,   # перцентиль спреда по своей истории
        "sm_pctl": snap.sm_pctl if is_float else None,
        "spread_pctl": (snap.sm_pctl if is_float else snap.gspread_pctl),   # универсальный (для скринера)
        "pctl_at": snap.spread_pctl_at.isoformat() if snap.spread_pctl_at else None,
        "pctl_stale": bool(snap.spread_pctl_at and (datetime.utcnow() - snap.spread_pctl_at).days > 7),
        # effective quoted margin (dohod frnIndexAdd, else cached MOEX spread) so
        # the client can recompute simple margin at bid/ask prices.
        "float_qm": (rt.float_add if rt and rt.float_add else None) or snap.float_qm,
        # unified column value: simple margin for floaters, G-spread for fixes —
        # so sorting the "G-спред / SM" column matches what is displayed.
        "spread_display": sm_out if is_float else g_out,
        "current_yield": snap.current_yield, "couponpercent": snap.couponpercent,
        "couponfrequency": snap.couponfrequency,
        # сортировка столбца «Купон»: у флоатеров в нём видно КС+спред → сортируем по
        # спреду (float_add/qm); у фиксов — по ставке купона (couponpercent)
        # ориентир доходности флоатера = текущее значение СВОЕГО индекса (ключевая / RUONIA) + маржа;
        # для прочих индексов (ИПЦ, КБД, ипотека) и без маржи — текущий купон
        "float_ref_yield": _flt_ref,
        "coupon_sort": (_flt_ref if is_float else snap.couponpercent),
        # амортизация (для фильтра скринера): текущий номинал рублёвой бумаги уже
        # ниже стандартных 1000 ₽ → часть тела уже погашена; плюс ОФЗ-АД (SU46/48).
        # Сигнал по «усушке» номинала ловит бумаги В ПРОЦЕССЕ амортизации (концессии
        # ГлДорога/СЗКК/ДОМ.РФ и т.п.); полный график — на карточке (/schedule).
        "is_amortizing": bool(_amort),
        # «оборот» ВЕЗДЕ = средний дневной оборот за ~21 торговую сессию (не за один день).
        "volume": (snap.avg_volume if snap.avg_volume is not None else snap.volume),
        "volume_today": snap.volume, "numtrades": snap.numtrades,
        "change_day_pct": snap.change_day_pct,
        "issuesize": snap.issuesize,
        "issue_volume": (snap.issuesize * snap.facevalue) if (snap.issuesize and snap.facevalue) else None,
        "liq_class": _liq_class(snap.avg_volume if snap.avg_volume is not None else snap.volume, snap.numtrades),
        # Рейтинг — ТОЛЬКО официальные агентства (АКРА / Эксперт РА / НКР). Рейтинги
        # сервиса dohod.ru НЕ используем: они выставлены произвольно и часто неверны
        # (напр. Пионер-Лизинг). Если агентского совпадения нет — рейтинг пустой (NR).
        # (dohod оставляем только для СЕКТОРА — это не рейтинг.)
        "rating": (ag_best["rating"] if ag_best else None),
        "rating_bucket": (ag_best["bucket"] if ag_best else None),
        "rating_score": (ag_best["score"] if ag_best else None),
        "rating_agency": (ag_best["agency"] if ag_best else None),
        "issuer_full": snap.issuer_full,
        "emitent_id": _parent_eid(snap.emitent_id),   # канонический ключ эмитента (MOEX; SPV без ИНН → эмитент группы)
        "sector_raw": rt.sector if rt else None,
        # уровень показанного рейтинга: issue — рейтинг самого выпуска (учитывает субординацию /
        # обеспечение / .sf); issuer — рейтинг эмитента; issuer_sub — рейтинг эмитента у
        # субординированного / бессрочного выпуска (риск выпуска выше рейтинга эмитента)
        "rating_scope": (("issue" if ag_best.get("level") == "issue" else
                          "issuer_sub" if re.search(r"суб|sub|т2|t2|ат1|at1|бесср|perp", (snap.shortname or "").lower())
                          or (snap.matdate or "").startswith("0000") else "issuer") if ag_best else None),
        "rating_match": ag_match or None,            # eid (ИНН/ISIN) | name (запасной путь)
        "agency_trend": ag_best.get("trend") if ag_best else None,
        "agency_prev_rating": ag_best.get("prev_rating") if ag_best else None,
        "rating_expected": bool(ag_best.get("expected")) if ag_best else False,
        # how the spread was derived, for a "как посчитано" tooltip (spec §39)
        # из показанных чисел, а не из снимка биржи: у бумаг, пересчитанных к оферте или к
        # погашению, подсказка иначе объясняла другую доходность и другой спред
        "spread_calc": ({
            "ytm": round(ytm_out, 2),
            "benchmark_yield": round(ytm_out - g_out / 100.0, 2),
            "g_spread_bp": g_out, "curve": "КБД (ОФЗ)",
        } if (g_out is not None and ytm_out is not None) else None),
        "sector": ratings.canon_sector(rt.sector) if rt else None,
        "issuer": rt.issuer if rt else None,
        "float_index": (float_index_of(snap.isin, rt) or None) if is_float else (rt.float_index if rt else None),
        "float_add": rt.float_add if rt else None,
        # effective_date dohod — дата события ЛЮБОГО типа (в т.ч. AMO — амортизация): офертой
        # считаем только PUT/CALL, иначе у 116 амортизируемых бумаг «оферта» была датой погашения части тела
        "offer_date": _offer_date,
        "offer_type": _offer_type,
        # agency ratings (АКРА / Эксперт РА / НКР)
        "agency_rating": ag_best["rating"] if ag_best else None,
        "agency_bucket": ag_best["bucket"] if ag_best else None,
        "agency_name": ag_best["agency"] if ag_best else None,
        "agency_forecast": ag_best["forecast"] if ag_best else None,
        "agency_action": ag_best.get("action") if ag_best else None,
        "agency_action_date": ag_best.get("action_date") if ag_best else None,
        "agency_all": ag_list or None,
    }


def issue_volumes(db: Session, isin: str) -> Optional[dict]:
    """Nominal volumes; resolve original face separately, without delaying card KPIs."""
    import math
    snap = db.get(BondSnapshot, isin.strip().upper())
    if not snap:
        return None
    valid = lambda v: isinstance(v, (int, float)) and math.isfinite(v) and v >= 0
    count = snap.issuesize if valid(snap.issuesize) else None
    face = snap.facevalue if valid(snap.facevalue) else None
    original_face = None
    try:
        ref = moex.resolve_security(snap.isin)
        original_face = ref.get("initialfacevalue")
    except moex.MoexError:
        pass
    if not valid(original_face) or original_face == 0:
        original_face = None
    return {
        "isin": snap.isin, "currency": _ccy(snap.faceunit), "issuesize": count,
        "facevalue": face, "initialfacevalue": original_face,
        "issue_volume": count * face if count is not None and face is not None else None,
        "initial_issue_volume": count * original_face if count is not None and original_face is not None else None,
        "initial_volume_basis": "ISSUESIZE × INITIALFACEVALUE; тот же объём облигаций до амортизации, не история доразмещений или выкупов",
        "source": f"https://iss.moex.com/iss/securities/{snap.secid or snap.isin}.json",
    }


def one(db: Session, isin: str) -> Optional[dict]:
    """Single snapshot row + rating for the issue card (instant, from cache)."""
    _spv_map(db)                       # SPV без ИНН → эмитент группы (для _emkey / рейтингов)
    snap = db.get(BondSnapshot, isin.strip().upper())
    if not snap:
        return None
    row = _row(snap, db.get(BondRating, snap.isin), agencies.ratings_map(db))
    if (not row.get("rating") or not row.get("sector")) and row.get("emitent_id"):
        # карточка должна совпадать со скринером: рейтинг/сектор, унаследованные по эмитенту
        peer = next((r for r in _all_rows(db) if r["isin"] == row["isin"]), None) or \
            next((r for r in _all_rows(db) if r.get("emitent_id") == row["emitent_id"] and r.get("rating")), None)
        if peer:
            if not row.get("rating") and peer.get("rating"):
                for f in _RT_FIELDS:
                    row[f] = peer.get(f)
                row["rating_scope"] = peer.get("rating_scope") or "issuer"
            if not row.get("sector") and peer.get("sector"):
                row["sector"] = peer["sector"]
    _fix_sector(row)
    return row


def cleanest_name(names: list[str]) -> Optional[str]:
    """Pick the tidiest display name for an issuer from its bonds' names —
    prefer one without a series suffix ("ПАО ГК Самолет" over "Группа компаний
    Самолет, 01"): penalize commas, digits and series words, then length."""
    names = [n for n in names if n]
    if not names:
        return None

    def score(n: str) -> float:
        s = 0.0
        if "," in n:
            s += 100
        if re.search(r"\d", n):
            s += 40
        if re.search(r"\b(бо|бп|об|сер|серия|выпуск)\b", n, re.IGNORECASE):
            s += 20
        return s + len(n) * 0.3

    return _strip_series(min(names, key=score))


def _strip_series(n: Optional[str]) -> Optional[str]:
    """Trim a bond series suffix off a name so it reads as the ISSUER, e.g.
    'АФК Система БО 002Р-07' → 'АФК Система', 'Самолет, 01' → 'Самолет'."""
    if not n:
        return n
    # после «, » в справочнике всегда код выпуска, транш или второе имя: «Т-Банк, TCS-perp1»,
    # «СФО ТБ-10, А1» — проверено на всех 613 таких именах. «36,6» без пробела не режется
    n = n.split(", ", 1)[0]
    # cut from the first series marker (БО/БП/ПБО/сер./серия/выпуск …)
    n = re.sub(r"[\s,]+(?:БО|БП|ПБО|ПБ|Б-?\d|сер\.?|серия|выпуск|вып\.?)\b.*$", "", n, flags=re.IGNORECASE)
    # cut a program/series code and everything after it: 'П02-БО-04', '001P-01R', '003Р-04'
    n = re.sub(r"[\s,]+(?:П\d|\d{3}[A-Za-zА-Яа-я])[\wА-Яа-я-]*.*$", "", n, flags=re.IGNORECASE)
    # cut a trailing series/number token: '002Р-07', '1Р19', '01', '-07'
    n = re.sub(r"[\s,]+\d[\wА-Яа-я-]*$", "", n)
    n = re.sub(r"[\s,]+\d*[А-Яа-я]?\d+Р[\wА-Яа-я-]*$", "", n, flags=re.IGNORECASE)
    return n.strip(" ,-–—") or None


_SPV_PARENT: dict = {"sig": None, "map": {}}


def _brand(name) -> str:
    """Бренд эмитента из имени справочника: «РЖД, 2.2% 23may2027, EUR» → «ржд»."""
    return agencies.normalize_name(str(name).split(",")[0]) if name else ""


def _spv_map(db: Session) -> dict:
    """Иностранные компании-посредники без ИНН (RZD Capital P.L.C., SUEK Securities DAC) →
    российский эмитент той же группы: по бренду в имени справочника облигаций (до первой
    запятой) среди эмитентов С ИНН. Нужен, чтобы евробонд РЖД был на странице РЖД, а не
    отдельным «эмитентом», и получал рейтинг заёмщика. Только однозначные совпадения."""
    from collections import Counter
    sig = tuple(db.query(func.count(BondSnapshot.isin), func.max(BondSnapshot.updated_at)).first())
    if _SPV_PARENT["sig"] == sig:
        return _SPV_PARENT["map"]
    rts = {r.isin: r.issuer for r in db.query(BondRating.isin, BondRating.issuer).all()}
    by_eid: dict = {}
    spv: dict = {}
    for sn in db.query(BondSnapshot.isin, BondSnapshot.emitent_id, BondSnapshot.emitent_inn).all():
        if not sn.emitent_id or str(sn.emitent_id) == _MINFIN_EID:
            continue
        b = _brand(rts.get(sn.isin))
        if not b:
            continue
        if sn.emitent_inn:
            by_eid.setdefault(str(sn.emitent_id), Counter())[b] += 1
        else:
            spv.setdefault(str(sn.emitent_id), set()).add(b)
    out = {}
    for eid, brands in spv.items():
        cands = Counter()
        for pe, cnt in by_eid.items():
            for pb, n in cnt.items():
                if any(pb == b or pb.startswith(b + " ") for b in brands):
                    cands[pe] += n
        if cands:
            top = cands.most_common(2)
            if len(top) == 1 or top[0][1] >= 2 * top[1][1]:
                out[eid] = top[0][0]
    _SPV_PARENT.update(sig=sig, map=out)
    return out


def _parent_eid(eid):
    return _SPV_PARENT["map"].get(str(eid), eid) if eid else eid


def _emkey(snap, rt=None):
    """Канонический ключ эмитента. Приоритет — MOEX emitent_id: он одинаков у ВСЕХ
    выпусков эмитента, тогда как строки issuer/shortname гуляют ('АО "ПГК"' против
    'Первая Грузовая Компания, 003P-01' против None). ОФЗ всегда сводим к одному
    эмитенту по secid SU*. Фолбэк — ключ по имени (issuer_key)."""
    from .ratings import issuer_key
    if snap is None:
        return None
    if (getattr(snap, "secid", None) or "").startswith("SU") or str(getattr(snap, "emitent_id", "") or "") == _MINFIN_EID or _is_sovereign_ru(snap):
        return "минфин рф офз"        # ОФЗ (вкл. юаневые) + суверенные евробонды/ГОВОЗ РФ — один эмитент «Минфин России»
    eid = _parent_eid(getattr(snap, "emitent_id", None))      # SPV без ИНН → эмитент группы
    if eid:
        return f"eid:{eid}"
    return issuer_key((rt.issuer if rt else None) or snap.issuer_full or snap.shortname)


def issuer_page(db: Session, q: str) -> Optional[dict]:
    """All traded bonds of one issuer + its sector / agency ratings, for the
    issuer page (a market map of the issuer's own curve). `q` is an ISIN or an
    issuer name/key — we resolve it to an emitent key and gather every bond that
    reduces to the same key."""
    _spv_map(db)                       # SPV без ИНН → эмитент группы (для _emkey / рейтингов)
    from collections import Counter
    from .ratings import issuer_key
    ratings = _ratings_map(db)
    amap = agencies.ratings_map(db)

    # resolve q → emitent key: ISIN → emitent_id (канон, ловит все выпуски);
    # "eid:N"/"минфин рф офз" — уже готовый ключ; иначе имя (старый режим по имени)
    key, by_name = None, False
    snap0 = db.get(BondSnapshot, q.strip().upper())
    all_snaps = db.query(BondSnapshot).filter(_live_filter(db)).all()
    if snap0:
        key = _emkey(snap0, ratings.get(snap0.isin))
    elif q.startswith("eid:") or q == "минфин рф офз":
        key = q
    else:
        # запрос по имени: сводим к каноническому emitent-ключу через первую бумагу,
        # чьё имя даёт тот же ключ — тогда автокомплит тоже собирает ВСЕ выпуски.
        nk = issuer_key(q)
        hit = next((s for s in all_snaps
                    if issuer_key((ratings.get(s.isin).issuer if ratings.get(s.isin) else None)
                                  or s.issuer_full or s.shortname) == nk), None)
        if hit:
            key = _emkey(hit, ratings.get(hit.isin))
        else:
            key, by_name = nk, True
    if not key:
        return None

    # все выпуски эмитента, включая без свежего YTM (их считаем/показываем в таблице,
    # но на карту доходность/дюрацию ставим только те, у кого есть цена)
    rows, names, sectors = [], [], []
    for s in all_snaps:
        rt = ratings.get(s.isin)
        nm = (rt.issuer if rt else None) or s.issuer_full or s.shortname
        k = issuer_key(nm) if by_name else _emkey(s, rt)
        if k != key:
            continue
        row = _row(s, rt, amap)
        _fix_sector(row)                       # те же поправки отрасли, что в скринере (О'КЕЙ, ПИР)
        rows.append(row)
        names.append(nm)                       # для выбора чистого имени эмитента
        if row.get("sector"):
            sectors.append(row["sector"])
    if not rows:
        return None
    _inherit_by_emitent(rows)

    _by_name = _match_agency(amap, *([names[0]] if names else []),
                             rows[0].get("issuer_full"), rows[0]["name"])
    _eid = Counter(r.get("emitent_id") for r in rows if r.get("emitent_id")).most_common(1)
    ag, _ = agencies.for_bond(amap, None, _eid[0][0] if _eid else None, _by_name)   # рейтинги ЭМИТЕНТА
    ag = ag or None
    display = cleanest_name(names) or rows[0]["name"]
    sector = Counter(sectors).most_common(1)[0][0] if sectors else None
    rows.sort(key=lambda r: (r.get("duration_years") or 0))
    return {"key": key, "issuer": display, "sector": sector,
            "agency_ratings": ag, "bonds": rows, "count": len(rows)}


_SPREAD_CACHE: dict = {}          # isin -> (ts, series) — история спреда меняется
_SPREAD_TTL = 6 * 3600
_SPREAD_LOCKS: dict = {}            # только при обновлении рынка, кэшируем на 6ч


def _spread_series_cached(isin: str, is_float: bool, qm, kbd_snaps, frm: str = "2012-01-01") -> list[list]:
    """Кэш _spread_series по ISIN: средние по эмитенту/рейтингу строятся из десятков
    таких серий, а сеть (yield/price history) — узкое место. Повторные просмотры
    карточек и пересекающиеся группы берутся из кэша мгновенно. Серия живёт до смены
    дня (история биржи дневная) и не дольше 6 ч."""
    import sys
    import time
    now, day = time.time(), date.today().isoformat()
    # серия из кэша годится, если начинается не позже нужного (прогрев качает всю историю с 2012)
    ok = lambda h: h and time.time() - h[0] < _SPREAD_TTL and h[2] == day and h[3] <= frm   # noqa: E731
    hit = _SPREAD_CACHE.get(isin)
    if ok(hit):
        return [p for p in hit[1] if p[0] >= frm] if hit[3] < frm else hit[1]
    with instrument._key_lock(_SPREAD_LOCKS, isin):     # одну бумагу качаем один раз
        hit = _SPREAD_CACHE.get(isin)
        if ok(hit):
            return [p for p in hit[1] if p[0] >= frm] if hit[3] < frm else hit[1]
        # компактно: кортежи и общие строки дат — сотни серий в памяти без лишних мегабайт
        s = [(sys.intern(d), v) for d, v in _spread_series(isin, is_float, qm, kbd_snaps, frm)]
        _SPREAD_CACHE[isin] = (time.time(), s, day, frm)
        return s


def prewarm_peer_series(db: Session, per_group: int = 10, top: int = 60) -> int:
    """Заранее подтянуть истории спреда бумаг, из которых строятся средние по рейтингу
    в карточке выпуска (топ-ликвидные бумаги каждого рейтингового бакета — те же, что
    берёт peers_history), плюс самые торгуемые бумаги рынка. Первое открытие карточки
    тогда не ждёт десятки запросов к бирже. Уже прогретые серии не перекачиваются."""
    from concurrent.futures import ThreadPoolExecutor
    from collections import defaultdict
    rmap = _ratings_map(db)
    rows = [r for r in _all_rows(db) if (r.get("numtrades") or 0) > 0]
    groups: dict = defaultdict(list)
    for r in rows:
        b = r.get("agency_bucket") or r.get("rating_bucket")
        if not b or r.get("rating_agency") == "Суверен РФ" or (r.get("secid") or "").startswith("SU"):
            continue
        groups[(r["kind"], b, r.get("currency") or "RUB")].append(r)
    want: dict = {}
    for g in groups.values():
        for r in sorted(g, key=lambda r: -(r.get("volume") or 0))[:per_group]:
            want[r["isin"]] = r
    for r in sorted(rows, key=lambda r: -(r.get("volume") or 0))[:top]:
        want.setdefault(r["isin"], r)
    import time
    day = date.today().isoformat()
    todo = []
    for i, r in want.items():
        hit = _SPREAD_CACHE.get(i)
        if hit and time.time() - hit[0] < _SPREAD_TTL and hit[2] == day and hit[3] <= "2012-01-01":
            continue
        rt = rmap.get(i)
        s = db.get(BondSnapshot, i)      # БД — только здесь, в потоках одна сеть
        todo.append((i, r["kind"] == "floater", (rt.float_add if rt else None) or (s.float_qm if s else None)))
    if not todo:
        return 0
    kbd = instrument.kbd_history()
    with ThreadPoolExecutor(max_workers=3) as ex:   # вежливо к бирже: прогрев фоновый
        list(ex.map(lambda t: _spread_series_cached(t[0], t[1], t[2], kbd), todo))
    return len(todo)


def _spread_series(isin: str, is_float: bool, qm, kbd_snaps, frm: str = "2012-01-01") -> list[list]:
    """Лёгкая история спреда одной бумаги: G-спред к КБД (фикс) или simple margin
    (флоатер), полная история. Минимум сетевых вызовов (yield ИЛИ price history)."""
    try:
        ref = moex.resolve_security(isin)
    except moex.MoexError:
        return []
    hist_id = ref.get("secid") or isin
    today = date.today().isoformat()
    if is_float:
        mat = ref.get("matdate")
        if not qm or not mat or mat in ("0000-00-00", ""):
            return []
        out = []
        for r in moex.get_price_history(hist_id, ref["board"], frm, today):
            px = r.get("close")
            if px is None or not (10 < px < 200):
                continue
            try:
                yrs = (date.fromisoformat(mat) - date.fromisoformat(r["date"])).days / 365.0
            except ValueError:
                continue
            if yrs <= 0:
                continue
            sm = instrument.simple_margin_bp(px, yrs, qm)
            if sm is not None and -3000 < sm < 20000:
                out.append([r["date"], sm])
        return out
    out = []
    for r in moex.get_yield_history(hist_id, ref["board"], frm, today):
        y, dur = r.get("yield_close"), r.get("duration")
        # floor 3% — MOEX's sporadic ~0.05% garbage ticks would fake ≈−1500 bp
        # spreads and drag the peer median (RU yields sit far above 3%).
        if y is None or not (3 < y < 60):
            continue
        g = r.get("gspread")                   # ежедневный G-спред MOEX (как в карточке и скринере)
        if g is not None:
            if -800 < g < 20000:
                out.append([r["date"], round(g)])
            continue
        if dur is None or kbd_snaps is None:
            continue
        kb = instrument._kbd_on(kbd_snaps, r["date"], dur / 365.0)
        if kb is not None:
            out.append([r["date"], round((y - kb) * 100)])
    return out


def peers_history(db: Session, isin: str, rating_sample: int = 10) -> dict:
    """Средний по ЭМИТЕНТУ и по КРЕДИТНОМУ РЕЙТИНГУ исторический спред (G-спред для
    фиксов, simple margin для флоатеров) — усреднение по датам. Для рейтинговой
    группы берётся выборка самых ликвидных бумаг того же бакета и валюты."""
    from concurrent.futures import ThreadPoolExecutor
    from collections import defaultdict
    from .ratings import issuer_key
    isin = isin.strip().upper()
    snap0 = db.get(BondSnapshot, isin)
    if not snap0:
        return {"kind": None, "issuer": [], "rating": [], "issuer_n": 0, "rating_n": 0, "bucket": None}
    rmap = _ratings_map(db)
    # строки берём из КЭША (без пересборки _row/рейтингов); только торгуемые сегодня
    rows = {r["isin"]: r for r in _all_rows(db) if (r.get("numtrades") or 0) > 0}
    r0 = rows.get(isin) or one(db, isin)
    is_float = r0["kind"] == "floater"
    ccy = r0.get("currency") or "RUB"
    bucket = r0.get("agency_bucket") or r0.get("rating_bucket")

    def _ikey(i):
        s = db.get(BondSnapshot, i)
        # Канон эмитента: MOEX emitent_id (одинаков у всех выпусков эмитента, устойчив
        # к разнобою имён); ОФЗ сводим по secid SU*; фолбэк — ключ по имени.
        return _emkey(s, rmap.get(i))
    key0 = _ikey(isin)

    issuer_bonds = [i for i, r in rows.items()
                    if i != isin and r["kind"] == r0["kind"] and key0 and _ikey(i) == key0
                    and (r.get("currency") or "RUB") == ccy]   # только своя валюта: спред RUB и валютных несопоставим
    # ограничиваем самыми ликвидными: медиана по 12 бумагам ≈ по всем, но втрое быстрее
    issuer_bonds = sorted(issuer_bonds, key=lambda i: -(rows[i].get("volume") or 0))[:12]
    # Рейтинговая группа — ТОЛЬКО корпораты: ОФЗ и суверенные ЗО тоже AAA, но их
    # спред к КБД ≈ 0 по определению, поэтому в средней по рейтингу они исказят
    # картину. Исключаем всех суверенов (их _row метит rating_agency="Суверен РФ").
    rating_bonds = [i for i, r in rows.items()
                    if i != isin and r["kind"] == r0["kind"] and bucket
                    and (r.get("agency_bucket") or r.get("rating_bucket")) == bucket
                    and (r.get("currency") or "RUB") == ccy
                    and r.get("rating_agency") != "Суверен РФ"
                    and not (r.get("secid") or "").startswith("SU")]
    rating_bonds = sorted(rating_bonds, key=lambda i: -(rows[i].get("volume") or 0))[:rating_sample]

    union = list(set(issuer_bonds) | set(rating_bonds))
    kbd_snaps = instrument.kbd_history()

    # float_qm читаем ЗАРАНЕЕ в главном потоке: SQLAlchemy-сессия НЕ потокобезопасна,
    # и обращение к db.get(...) из worker-потоков даёт перемежающийся 500 под нагрузкой
    # (Passenger/несколько запросов). В потоках оставляем только сеть+кэш (_spread_series
    # использует moex, не БД).
    qm_map = {}
    for i in union:
        rt = rmap.get(i)
        s = db.get(BondSnapshot, i)
        qm_map[i] = (rt.float_add if rt else None) or (s.float_qm if s else None)

    # на графике средние обрезаются по датам самой бумаги — историю соседей раньше её размещения
    # не качаем (у молодых выпусков это годы лишних страниц с биржи)
    rt0 = rmap.get(isin)
    frm0 = rt0.issue_date if rt0 and rt0.issue_date and re.match(r"^\d{4}-\d{2}-\d{2}$", rt0.issue_date) else "2012-01-01"
    frm0 = max(frm0, "2012-01-01")

    def _one(i):
        return i, _spread_series_cached(i, is_float, qm_map.get(i), kbd_snaps, frm0)
    series: dict = {}
    if union:
        with ThreadPoolExecutor(max_workers=min(8, len(union))) as ex:
            series = dict(ex.map(_one, union))

    def _avg(isins):
        from statistics import median
        n = len(isins)
        # линию рисуем как можно полнее: достаточно 2 пиров на дату (для группы из 1 — одного).
        # Медиана защищает от отдельного «дефолтного» выброса, так что низкий порог безопасен.
        # Остаточные разрывы = периоды, когда пиры ещё не торговались (усреднять нечего).
        need = min(2, n)
        acc: dict = defaultdict(list)
        for i in isins:
            for d, v in series.get(i, []):
                acc[d].append(v)
        # медиана устойчива к отдельным «дефолтным» бумагам в группе; линия рисуется
        # только там, где в группе достаточно бумаг (как история самой облигации)
        return [[d, round(median(vs))] for d, vs in sorted(acc.items()) if len(vs) >= need]

    def _names(isins):
        # бумаги, реально попавшие в среднюю (с историей спреда), для подсказки
        return [(rows.get(i, {}).get("name") or i) for i in isins if series.get(i)]
    issuer_used, rating_used = _names(issuer_bonds), _names(rating_bonds)
    return {"kind": r0["kind"], "bucket": bucket, "currency": ccy,
            "issuer": _avg(issuer_bonds), "rating": _avg(rating_bonds),
            "issuer_n": len(issuer_used), "rating_n": len(rating_used),
            "issuer_names": issuer_used, "rating_names": rating_used}


def similar(db: Session, isin: str, limit: int = 25) -> dict:
    """Peer sets for the issue card: same issuer, same rating, same sector."""
    base = one(db, isin)
    if not base:
        return {"base": None, "issuer": [], "by_rating": [], "by_sector": []}
    rows = _all_rows(db)     # из кэша — без пересборки _row/рейтингов на каждый запрос
    from .ratings import issuer_key
    # Ключ эмитента — по MOEX emitent_id (ловит ВСЕ выпуски эмитента, устойчив к
    # разнобою имён 'АО "ПГК"' / 'Первая Грузовая Компания'); ОФЗ сводим по secid SU*;
    # фолбэк — по имени.
    def ikey(r):
        if _is_sov_row(r):
            return "минфин рф офз"
        if r.get("emitent_id"):
            return f"eid:{r['emitent_id']}"
        return issuer_key(r.get("issuer") or r.get("issuer_full") or r.get("name"))
    base_key = ikey(base)
    def take(pred, key):
        out = [r for r in rows if r["isin"] != isin and pred(r)]
        out.sort(key=lambda r: abs((r["duration_years"] or 0) - (base["duration_years"] or 0)))
        return out[:limit]
    base_bucket = base.get("agency_bucket") or base.get("rating_bucket")
    base_ccy = base.get("currency") or "RUB"
    base_kind = base.get("kind")
    # Валютные бумаги сравниваем в СВОЕЙ валюте: спред рублёвой и валютной бумаги
    # несопоставим, поэтому рейтинговая/отраслевая группы — той же валюты.
    same_ccy = lambda r: (r.get("currency") or "RUB") == base_ccy
    # Тип должен совпадать: у фикса ось — YTM, у флоатера — simple margin. Смешивать
    # нельзя (карта фикса — из фиксов, карта флоатера — из флоатеров).
    same_kind = lambda r: r.get("kind") == base_kind
    # same issuer by canonical emitent key (robust to name variants / missing dohod name).
    # Группу «того же эмитента» НЕ ограничиваем типом: у эмитента может быть 1 флоатер и
    # 5 фиксов — покажем ВСЕ его выпуски (на график ляжет метрика базовой бумаги, остальные
    # видны в таблице), иначе одинокий флоатер не с чем сравнить.
    issuer = take(lambda r: base_key and ikey(r) == base_key and same_ccy(r), "issuer")
    by_rating = take(lambda r: base_bucket and (r.get("agency_bucket") or r.get("rating_bucket")) == base_bucket and same_ccy(r) and same_kind(r), "r")
    by_sector = take(lambda r: base["sector"] and r["sector"] == base["sector"] and same_ccy(r) and same_kind(r), "s")
    return {"base": base, "issuer": issuer, "by_rating": by_rating, "by_sector": by_sector}


# --------------------------------------------------------------------------- #
# Rich/cheap vs the bond's rating-group yield curve
# --------------------------------------------------------------------------- #
def _ccy(faceunit: Optional[str]) -> str:
    """Normalize the face currency for display/filtering (MOEX codes rubles SUR)."""
    fu = (faceunit or "").upper()
    return "RUB" if fu in ("SUR", "RUB", "RUR", "") else fu


def _liq_class(volume: Optional[float], numtrades: Optional[float]) -> str:
    """Liquidity class from today's MOEX turnover (rub): ≥10 млн — высокая,
    5–10 млн — средняя, <5 млн — низкая (по обороту, без учёта числа сделок)."""
    v = volume or 0
    if v >= 10e6:
        return "Высокая"
    if v >= 5e6:
        return "Средняя"
    return "Низкая"


def _bucket_of(r: dict) -> Optional[str]:
    """The bond's effective rating bucket: agency rating first, else dohod."""
    return r.get("agency_bucket") or r.get("rating_bucket")


# Liquidity penalty (b.p.) applied to a "cheap" relative-value signal: a wide
# spread on an illiquid name is often a liquidity discount, not true cheapness.
_LIQ_PENALTY_BP = {"Высокая": 0, "Средняя": 25, "Низкая": 60}


def _liq_penalty_bp(liq_class: Optional[str]) -> int:
    return _LIQ_PENALTY_BP.get(liq_class or "", 60)


def _percentile(sorted_vals: list, q: float) -> Optional[float]:
    """Linear-interpolated percentile (q in [0,1]) of an already-sorted list."""
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    idx = q * (len(sorted_vals) - 1)
    lo = int(idx); hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (idx - lo)


def _rank_percentile(vals: list, x: float) -> Optional[int]:
    """Where x sits within its peers, 0–100 (share of peers strictly below)."""
    if not vals:
        return None
    return round(100 * sum(1 for v in vals if v < x) / len(vals))


def _all_fixed_rows(db: Session) -> list[dict]:
    out = []
    for r in _all_rows(db):     # из кэша — без пересборки _row на каждый запрос
        # только фиксы с сопоставимым YTM: без флоатеров/линкеров/АД/структурных нот,
        # положительный YTM, без дистресс-выбросов >60%
        if r["kind"] in ("floater", "linker", "structured") or (r.get("secid") or "").startswith(("SU46", "SU48", "SU52")):
            continue
        if r["ytm"] is not None and 0 < r["ytm"] < 60 and r["duration_years"]:
            out.append(r)
    return out


def _fair_yield(group: list[dict], dur: float, window: float = 0.9) -> Optional[float]:
    from statistics import median
    near = [g["ytm"] for g in group if abs((g["duration_years"] or 0) - dur) <= window]
    if not near:
        s = sorted(group, key=lambda g: abs((g["duration_years"] or 0) - dur))[:5]
        near = [g["ytm"] for g in s]
    return median(near) if near else None


def rating_curve(db: Session, isin: str) -> dict:
    """The bond vs the yield curve of its rating group: group points (grey on the
    chart), a fitted median curve, rich/cheap in bp, and an auto-comment."""
    base = one(db, isin)
    if not base:
        return {"base": None}
    bucket = _bucket_of(base)
    ccy = base.get("currency")            # compare rubles with rubles only
    rows = _all_fixed_rows(db)
    group = [r for r in rows if _bucket_of(r) == bucket and r["isin"] != isin
             and r.get("currency") == ccy] if bucket else []
    curve = []
    if group:
        durs = sorted(g["duration_years"] for g in group)
        lo, hi = durs[0], durs[-1]
        step = max(0.5, (hi - lo) / 12) if hi > lo else 1.0
        d = lo
        while d <= hi + 1e-9:
            fy = _fair_yield(group, d)
            if fy is not None:
                curve.append({"duration": round(d, 2), "ytm": round(fy, 2)})
            d += step
    fair = _fair_yield(group, base["duration_years"]) if (group and base.get("duration_years")) else None
    rc = round((base["ytm"] - fair) * 100) if (fair is not None and base.get("ytm") is not None) else None
    return {"base": base, "bucket": bucket, "group": group, "curve": curve,
            "fair_yield": round(fair, 2) if fair is not None else None,
            "rich_cheap_bp": rc, "comment": _auto_comment(base, fair, rc)}


def _auto_comment(base: dict, fair: Optional[float], rc: Optional[int]) -> Optional[str]:
    bucket = _bucket_of(base)
    parts = []
    if rc is not None and fair is not None:
        direction = "дешевле" if rc > 0 else "дороже"
        verdict = ("недооценена относительно группы" if rc > 30
                   else "переоценена относительно группы" if rc < -30
                   else "близко к справедливой для своей группы")
        parts.append(f"{base.get('name')}: доходность {base.get('ytm')}% — на {abs(rc)} б.п. "
                     f"{direction} медианы группы {bucket} ({round(fair, 2)}%); бумага {verdict}.")
    risks = []
    fc = (base.get("agency_forecast") or "").lower()
    if "негатив" in fc:
        risks.append(f"негативный прогноз {base.get('agency_name')}")
    if base.get("offer_date"):
        if base.get("yield_limitation") == "call_terms_unconfirmed_maturity_only":
            risks.append(f"CALL {base['offer_date']} — условия выкупа не подтверждены; показана доходность до погашения без CALL")
        elif base.get("yield_conditional_on_call"):
            risks.append(f"CALL {base['offer_date']} — показанная доходность условна и зависит от решения эмитента")
        else:
            risks.append(f"оферта {base['offer_date']} — доходность считать к оферте")
    if (base.get("volume") or 0) < 5e6:
        risks.append("низкая ликвидность")
    if bucket in ("BB", "B", "CCC", "CC", "C", "D"):
        risks.append("субинвестиционный рейтинг (ВДО)")
    if risks:
        parts.append("Риски: " + ", ".join(risks) + ".")
    return " ".join(parts) if parts else None


def rating_curves(db: Session, buckets=("AAA", "AA", "A", "BBB", "BB", "B")) -> dict:
    """Current yield curve (median per duration knot) for each rating bucket."""
    from statistics import median
    rows = _all_fixed_rows(db)
    knots = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 7, 10]
    out = {}
    for b in buckets:
        # ytm >= 10 drops FX/replacement bonds (валютные ЗО) whose low ruble-basis
        # yield would skew a high-grade bucket (same guard as the history curve).
        # только рублёвые: валютные бумаги с YTM 10–11% проходили фильтр «ytm ≥ 10» и занижали медиану
        grp = [r for r in rows if _bucket_of(r) == b and (r.get("currency") or "RUB") == "RUB"
               and (r["ytm"] or 0) >= 10 and r.get("duration_years") is not None]
        if len(grp) < 3:
            continue
        curve = []
        for k in knots:
            near = [g["ytm"] for g in grp if abs(g["duration_years"] - k) <= 1.0]
            if len(near) >= 2:
                curve.append({"duration": k, "ytm": round(median(near), 2)})
        if len(curve) >= 2:
            out[b] = {"curve": curve, "count": len(grp)}
    return out


_rating_hist_cache: dict = {"at": 0.0, "data": None}


def rating_yield_history(db: Session, sample: int = 12, frm: str = "2025-01-01",
                         buckets=("AAA", "AA", "A", "BBB", "BB", "B"), force: bool = False) -> dict:
    """Median YTM per rating bucket BY MONTH. For each bucket we sample the most
    liquid fixed bonds, pull their MOEX yield history, and take the monthly median
    across the sample. Heavy (many MOEX calls) → cached for 6h."""
    import time
    from collections import defaultdict
    from datetime import date
    from statistics import median

    now = time.time()
    if not force and _rating_hist_cache["data"] and now - _rating_hist_cache["at"] < 6 * 3600:
        return _rating_hist_cache["data"]

    rows = _all_fixed_rows(db)
    today = date.today().isoformat()
    out = {}
    for b in buckets:
        # ytm >= 10 drops FX/replacement bonds (valютные ЗО) whose low ruble
        # yield would skew a high-grade bucket's median downward.
        grp = sorted((r for r in rows if _bucket_of(r) == b and (r.get("currency") or "RUB") == "RUB" and (r["ytm"] or 0) >= 10),
                     key=lambda r: r.get("volume") or 0, reverse=True)[:sample]
        monthly: dict[str, list] = defaultdict(list)
        for r in grp:
            try:
                yh = moex.get_yield_history(r["isin"], r["board"], frm, today)
            except moex.MoexError:
                continue
            for row in yh:
                y = row.get("yield_close")
                if y is not None and 0 < y < 60 and row.get("date"):
                    monthly[row["date"][:7]].append(y)
        series = [{"month": m, "ytm": round(median(v), 2), "n": len(v)}
                  for m, v in sorted(monthly.items()) if len(v) >= 2]
        if len(series) >= 2:
            out[b] = series
    _rating_hist_cache.update(at=now, data=out)
    return out


def placements(db: Session, mode: str = "current", days: int = 120, limit: int = 250) -> dict:
    """Primary-market placements.

    mode='current' (default): bonds that are being placed RIGHT NOW or about to be
    — the issue is not yet fully sold (issuesize_placed < issuesize) and it is a
    fresh issue (issue date within ~60d, in the future, or undated). Sorted newest
    first, each carrying its placement progress. This excludes the old, perpetually
    under-placed OFZ/eurobond taps that "placed < size" alone would drag in.

    mode='history': the previous behaviour — bonds already placed in the last
    `days`, newest first (kept for reference)."""
    from datetime import date, timedelta
    amap = agencies.ratings_map(db)
    ratings = _ratings_map(db)
    today = date.today().isoformat()
    rows = []

    if mode == "history":
        cutoff = (date.today() - timedelta(days=days)).isoformat()
        for isin, rt in ratings.items():
            if not rt.issue_date or rt.issue_date < cutoff or rt.issue_date > today:
                continue
            snap = db.get(BondSnapshot, isin)
            if not snap:
                continue
            row = _row(snap, rt, amap)
            row["issue_date"] = rt.issue_date
            rows.append(row)
        rows.sort(key=lambda x: x["issue_date"] or "", reverse=True)
        return {"rows": rows[:limit], "total": len(rows), "mode": "history", "since": cutoff}

    # mode == "current": the announced placement calendar from corpbonds.ru
    # (curated upcoming/ongoing placements). We do NOT derive this from MOEX.
    from .ratings import issuer_key
    from . import placements_src
    # issuer-name -> a traded ISIN, so a placement can link to its issue card
    snap_by_issuer: dict[str, str] = {}
    for s in db.query(BondSnapshot).all():
        k = issuer_key(s.issuer_full or s.shortname)
        if k and k not in snap_by_issuer:
            snap_by_issuer[k] = s.isin
    try:
        feed = placements_src.scrape_corpbonds()
    except Exception as e:  # noqa: BLE001
        log.warning("corpbonds placements failed: %s", e)
        feed = []
    for p in feed:
        ik = issuer_key(p["issuer"])
        rows.append({**p,
                     "isin": snap_by_issuer.get(ik),
                     "upcoming": bool(p.get("place_date") and p["place_date"] > today)})
    # earliest placement date first (soonest to come); undated at the end
    rows.sort(key=lambda x: (x.get("place_date") or "9999"))
    return {"rows": rows[:limit], "total": len(rows), "mode": "current",
            "sources": ["corpbonds.ru", "t.me/cbonds", "t.me/bondplacements"]}


def movers(db: Session, limit: int = 20, min_turnover: float = 0.0) -> dict:
    """Market dynamics: biggest daily price moves and highest trading turnover.
    Restricted to names that actually traded today (numtrades > 0) so a stale
    quote can't masquerade as a mover. `min_turnover` (RUB) filters out illiquid
    names whose wild % move is just noise."""
    amap = agencies.ratings_map(db)
    ratings = _ratings_map(db)
    traded = []
    for snap in db.query(BondSnapshot).filter(BondSnapshot.numtrades.isnot(None), _live_filter(db)).all():
        if not snap.numtrades or snap.numtrades <= 0:
            continue
        # movers — страница «за день», поэтому оборот тут ДНЕВНОЙ (volume_today), не средний
        if min_turnover and (snap.volume or 0) < min_turnover:
            continue
        row = _row(snap, ratings.get(snap.isin), amap)
        traded.append(row)
    with_chg = [r for r in traded if r.get("change_day_pct") is not None]
    gainers = sorted(with_chg, key=lambda r: r["change_day_pct"], reverse=True)[:limit]
    losers = sorted(with_chg, key=lambda r: r["change_day_pct"])[:limit]
    by_turnover = sorted((r for r in traded if r.get("volume_today")),
                         key=lambda r: r["volume_today"], reverse=True)[:limit]
    return {"gainers": gainers, "losers": losers, "turnover": by_turnover,
            "traded_count": len(traded)}


def ideas(db: Session, limit: int = 30, min_turnover: float = 0.0) -> dict:
    """Screening ideas from relative-value anomalies (liquid names only):
      1. intra-issuer outlier — a bond whose spread is far from its issuer's
         other bonds (same credit, so it should be a curve, not a jump);
      2. cheap vs rating — a bond trading materially WIDER than the median
         spread of its whole rating bucket (higher yield for the same rating).
    Fixes are compared on G-spread, floaters on simple margin — never mixed.
    `min_turnover` (RUB) restricts to names with at least that daily turnover."""
    from statistics import median
    amap = agencies.ratings_map(db)
    ratings = _ratings_map(db)
    rows = []
    for s in db.query(BondSnapshot).filter(_live_filter(db)).filter(
            or_(BondSnapshot.ytm.isnot(None),
                and_(BondSnapshot.kind == "floater", BondSnapshot.current_yield.isnot(None)))).all():
        if (s.numtrades or 0) <= 0:
            continue
        if min_turnover and ((s.avg_volume if s.avg_volume is not None else s.volume) or 0) < min_turnover:
            continue
        r = _row(s, ratings.get(s.isin), amap)
        # unified relative-value metric, compared only within (kind, currency):
        #   floaters → simple margin; ruble fixes → G-spread to КБД;
        #   FX fixes (no ruble-curve G-spread) → their own YTM in b.p.
        is_rub = (r["currency"] or "RUB") == "RUB"
        if r["kind"] == "floater":
            r["metric_bp"], r["metric_kind"] = r["simple_margin_bp"], "SM"
        elif is_rub and r["g_spread_bp"] is not None:
            r["metric_bp"], r["metric_kind"] = r["g_spread_bp"], "G"
        elif not is_rub and r["ytm"] is not None and 0 < r["ytm"] < 40:
            # FX bonds: the ruble-curve G-spread is meaningless, compare YTM (b.p.).
            # Guard the range — some FX bonds carry a garbage ruble-priced yield.
            r["metric_bp"], r["metric_kind"] = round(r["ytm"] * 100), "Y"
        else:
            r["metric_bp"] = None
        # Sanity band: a real G-spread / simple margin sits in −500…4000 b.p.
        # Anything outside is a stale/mispriced quote (tiny price → absurd SM) and
        # must not pollute the peer medians or top the idea lists.
        if r["metric_bp"] is not None and -500 <= r["metric_bp"] <= 4000:
            rows.append(r)

    # Compare only maturity-matched bonds: a fix's G-spread and a floater's
    # simple margin both depend on tenor, so an outlier must be measured against
    # peers of SIMILAR term (±0.3y) — otherwise a short bond vs a long bond looks
    # like a false idea. Fixes match on DURATION, floaters on years-to-maturity.
    WINDOW = 0.3

    def _x(r):
        return r["duration_years"] if r["kind"] != "floater" else r.get("years_to_maturity")

    def analyse(kind_rows: list) -> tuple[list, list]:
        by_bucket, by_issuer = {}, {}
        for r in kind_rows:
            if r.get("rating_bucket"):
                by_bucket.setdefault(r["rating_bucket"], []).append(r)
            ik = ratings_issuer_key(r)
            if ik:
                by_issuer.setdefault(ik, []).append(r)
        intra, vs = [], []
        for r in kind_rows:
            x = _x(r)
            if x is None:
                continue
            pen = _liq_penalty_bp(r.get("liq_class"))
            # A "cheap" (positive deviation) signal is discounted for illiquidity;
            # a "rich" one isn't (tightness isn't explained by low liquidity).
            def enrich(rec, peer_vals, med, dev):
                sv = sorted(peer_vals)
                adj = round(dev - pen) if dev > 0 else round(dev)
                return {**rec, "deviation_bp": round(dev), "peer_median_bp": round(med),
                        "peer_p25_bp": round(_percentile(sv, .25)), "peer_p75_bp": round(_percentile(sv, .75)),
                        "peer_pct": _rank_percentile(peer_vals, rec["metric_bp"]), "peer_n": len(peer_vals),
                        "liq_penalty_bp": pen, "liq_adjusted_bp": adj,
                        "liq_warn": bool(dev > 0 and pen)}
            # intra-issuer: peers of the SAME issuer within ±0.3y term (leave-one-out)
            peers = [p["metric_bp"] for p in by_issuer.get(ratings_issuer_key(r), [])
                     if p["isin"] != r["isin"] and _x(p) is not None and abs(_x(p) - x) <= WINDOW]
            if len(peers) >= 3:
                med = median(peers); dev = r["metric_bp"] - med
                if abs(dev) >= 80:
                    d = enrich(r, peers, med, dev); d["issuer_median_bp"] = d["peer_median_bp"]
                    intra.append(d)
            # cheap vs rating: peers of the SAME bucket within ±0.3y term (leave-one-out)
            bkt = [p["metric_bp"] for p in by_bucket.get(r.get("rating_bucket"), [])
                   if p["isin"] != r["isin"] and _x(p) is not None and abs(_x(p) - x) <= WINDOW]
            if len(bkt) >= 5:
                med = median(bkt); dev = r["metric_bp"] - med
                if abs(dev) >= 150:
                    d = enrich(r, bkt, med, dev); d["bucket_median_bp"] = d["peer_median_bp"]
                    vs.append(d)
        return intra, vs

    # Segment by kind AND currency so medians compare like with like (rubles
    # with rubles) — this also lets the UI surface ideas in every currency.
    groups: dict[tuple, list] = {}
    for r in rows:
        kk = "floater" if r["kind"] == "floater" else "fix"
        groups.setdefault((kk, r.get("currency") or "RUB"), []).append(r)
    intra_all, vs_all = [], []
    for grp in groups.values():
        i, vv = analyse(grp)
        intra_all += i
        vs_all += vv

    # Split each anomaly into CHEAP (positive deviation → wider spread → higher
    # yield for the same credit → buy candidate) and RICH (negative deviation →
    # tighter → overpriced → sell-from-portfolio candidate).
    def cheap(lst):
        # rank by the LIQUIDITY-ADJUSTED signal so a wide spread that is really a
        # liquidity discount doesn't top the buy list.
        return sorted([x for x in lst if x["deviation_bp"] > 0],
                      key=lambda x: x["liq_adjusted_bp"], reverse=True)[:limit]

    def rich(lst):
        return sorted([x for x in lst if x["deviation_bp"] < 0],
                      key=lambda x: x["deviation_bp"])[:limit]

    # спред у исторического максимума (перцентиль ≥ 80) — дёшево, кандидаты на докупку под сужение
    # перцентиль старше 7 дней (бумагу давно не пересчитывали) в идеи не берём — он описывает
    # спред недельной давности, а не текущий
    fresh = [r for r in rows if not r.get("pctl_stale")]
    high = sorted([r for r in fresh if r.get("spread_pctl") is not None and r["spread_pctl"] >= 80],
                  key=lambda x: -x["spread_pctl"])[:max(limit, 40)]
    # спред у исторического минимума (перцентиль ≤ 20) — дорого, премия узкая, кандидаты на продажу
    low = sorted([r for r in fresh if r.get("spread_pctl") is not None and r["spread_pctl"] <= 20],
                 key=lambda x: x["spread_pctl"])[:max(limit, 40)]
    return {"intra_cheap": cheap(intra_all), "intra_rich": rich(intra_all),
            "vs_cheap": cheap(vs_all), "vs_rich": rich(vs_all),
            "high_pctl": high, "low_pctl": low,
            "currencies": sorted({r.get("currency") or "RUB" for r in rows})}


def ratings_issuer_key(r: dict) -> str:
    """Stable issuer key for grouping a row's bonds. Canonical MOEX emitent_id first
    (groups every issue of an issuer, robust to name drift), ОФЗ by secid, else name."""
    from .ratings import issuer_key
    if _is_sov_row(r):
        return "минфин рф офз"
    if r.get("emitent_id"):
        return f"eid:{r['emitent_id']}"
    return issuer_key(r.get("issuer") or r.get("name") or "")


def ofz_redemption(db: Session) -> dict:
    """Профиль погашения ОФЗ по годам с разбивкой по типу (для стека столбиков).
    Объём = размещённый номинал (issuesize_placed×facevalue, иначе issuesize×facevalue),
    в млрд ₽. Тип: ОФЗ-ПД (фикс), ОФЗ-ПК (флоатер), ОФЗ-ИН (линкер, SU52), ОФЗ-АД (SU46)."""
    from collections import defaultdict
    agg: dict = defaultdict(lambda: defaultdict(float))
    issues: dict = defaultdict(list)
    for s in db.query(BondSnapshot).all():
        sec = s.secid or ""
        if not sec.startswith("SU") or not s.matdate or s.matdate[:4] in ("0000", ""):
            continue
        y = int(s.matdate[:4])
        if s.kind == "floater":
            t = "ОФЗ-ПК"
        elif sec.startswith("SU52"):
            t = "ОФЗ-ИН"
        elif sec.startswith("SU46"):
            t = "ОФЗ-АД"
        else:
            t = "ОФЗ-ПД"
        size = (s.issuesize_placed or s.issuesize or 0) * (s.facevalue or 1000)
        if size:
            agg[y][t] += size
            issues[y].append({"isin": s.isin, "secid": sec, "name": s.shortname,
                              "type": t, "matdate": s.matdate, "vol_bln": round(size / 1e9, 1)})
    if not agg:
        return {"years": [], "types": [], "data": {}, "issues": {}}
    y0, y1 = min(agg), max(agg)
    years = [str(y) for y in range(y0, y1 + 1)]      # непрерывно, годы-пропуски = 0
    types = [t for t in ["ОФЗ-ПД", "ОФЗ-ПК", "ОФЗ-ИН", "ОФЗ-АД"]
             if any(agg[int(y)].get(t) for y in years)]
    return {
        "years": years, "types": types,
        "data": {t: [round(agg[int(y)].get(t, 0) / 1e9, 1) for y in years] for t in types},
        "issues": {str(y): sorted(v, key=lambda x: -x["vol_bln"]) for y, v in issues.items()},
    }


def redemption_events(db: Session, isins: list[str]) -> list[dict]:
    """Будущие выплаты номинала и купонов по выпускам (для «Графика погашения» эмитента), в рублях:
    каждая амортизация — на свою дату, погашение — только остаток номинала к концу срока,
    прошедшие амортизации не считаем. Оферта раньше погашения — остаток номинала на дату
    оферты (более поздние амортизации в него, а не отдельными столбиками). Сумма = выплата
    на одну облигацию (ISS bondization, value_rub) × число бумаг в выпуске."""
    from concurrent.futures import ThreadPoolExecutor
    today = date.today().isoformat()
    isins = [i.strip().upper() for i in isins if i and i.strip()][:1500]
    snaps = {x.isin: x for x in db.query(BondSnapshot).filter(BondSnapshot.isin.in_(isins)).all()}
    rmap = {r.isin: r for r in db.query(BondRating).filter(BondRating.isin.in_(isins)).all()}  # БД — только тут, в потоках сеть
    cv = zspread.curves()

    def coupons(isin, sn, kind, horizon, fx):
        """Будущие купоны выпуска до того же горизонта, что и номинал (оферта или погашение), ₽:
        фикс — по графику биржи (неизвестные — как последний известный); флоатер — прогноз по
        форварду своего индекса из кривых свопов (как в z-спреде)."""
        rt = rmap.get(isin)
        idx = qm = None
        if kind == "floater":
            idx = float_index_of(isin, rt) or ("RUONIA" if (sn.secid or "").startswith(("SU29", "SU24")) else None)
            qm = (rt.float_add if rt and rt.float_add is not None else None) or sn.float_qm
        got = zspread.cash_flows(isin, kind=kind, accint=sn.accint, face=sn.facevalue, horizon=horizon,
                                 index=idx, margin=qm, cv=cv)
        if not got:
            return []
        return [{"date": d, "amount": amt * float(sn.issuesize) * fx, "type": "coupon", "projected": proj}
                for d, amt, typ, proj in got[0] if typ == "coupon" and amt > 0]

    def one(isin):
        sn = snaps.get(isin)
        if sn is None or not sn.issuesize:
            return []
        n = float(sn.issuesize)
        kind = "floater" if sn.kind == "floater" else "fixed"
        if (sn.matdate or "").startswith("0000"):          # бессрочный: даты погашения нет
            fx = 1.0 if _ccy(sn.faceunit) == "RUB" else (moex.get_fx_rates().get(_ccy(sn.faceunit)) or 1.0)
            return [{"date": None, "amount": n * (sn.facevalue or 0) * fx, "type": "perpetual",
                     "isin": isin, "name": sn.shortname, "kind": kind}] if sn.facevalue else []
        offer = sn.buyback_date if (sn.buyback_date and sn.buyback_date >= today
                                    and (not sn.matdate or sn.buyback_date < sn.matdate)) else None
        try:
            am_all = [a for a in (moex.get_bondization(sn.secid or isin).get("amortizations") or []) if a.get("date")]
        except Exception as e:  # noqa: BLE001
            log.warning("bondization %s: %s", isin, e)
            am_all = []
        fut = sorted((a for a in am_all if a["date"] >= today), key=lambda a: a["date"])
        # сверка с текущим номиналом: сумма будущих выплат должна = непогашенному номиналу.
        # Не сходится (индексируемый номинал — НКК; привязка к золоту — SELGOLD; кривой график
        # биржи — RUS-30) → масштабируем выплаты на текущий номинал. Исключения: график с
        # нулевыми строками (ипотечные/секьюритизация — будущие выплаты биржа не знает) и
        # устаревший номинал в снимке (амортизация прошла уже после его обновления).
        scale = 1.0
        if fut and sn.facevalue and all(a.get("value") for a in fut):
            sv = sum(a["value"] for a in fut)
            snap_day = (sn.updated_at.date() - timedelta(days=1)).isoformat() if sn.updated_at else today
            recent = sum(a.get("value") or 0 for a in am_all if snap_day <= a["date"] < today)
            ok = lambda x: abs(x / sn.facevalue - 1) <= 0.02
            if sv > 0 and not ok(sv) and not (recent and ok(sv + recent)):
                scale = sn.facevalue / sv
        ev = []
        if not fut:                                # графика нет — весь текущий номинал на дату
            dt = offer or sn.matdate
            if sn.facevalue and dt and dt >= today and not dt.startswith("0000"):
                fx = 1.0
                if _ccy(sn.faceunit) != "RUB":
                    try:
                        fx = moex.get_fx_rates().get(_ccy(sn.faceunit)) or 1.0
                    except Exception:  # noqa: BLE001
                        fx = 1.0
                ev.append({"date": dt, "amount": n * sn.facevalue * fx, "type": "offer" if offer else "maturity"})
        else:
            after_offer = 0.0
            last = fut[-1]["date"]
            for a in fut:
                v = (a.get("value_rub") or a.get("value") or 0.0) * n * scale
                if offer and a["date"] > offer:
                    after_offer += v
                    continue
                ev.append({"date": a["date"], "amount": v, "pct": a.get("valueprc"),
                           "type": "maturity" if a["date"] == last else "amort"})
            if offer and after_offer:
                ev.append({"date": offer, "amount": after_offer, "type": "offer"})
            if scale != 1.0:
                for e in ev:
                    e["rescaled"] = True
        try:
            fxc = 1.0 if _ccy(sn.faceunit) == "RUB" else (moex.get_fx_rates().get(_ccy(sn.faceunit)) or 1.0)
            ev += coupons(isin, sn, kind, offer, fxc)
        except Exception as e:  # noqa: BLE001 — купоны на графике необязательны
            log.debug("купоны %s: %s", isin, e)
        return [{**e, "isin": isin, "name": sn.shortname, "kind": kind} for e in ev if e["amount"] > 0]

    out = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for r in ex.map(one, list(snaps)):
            out += r
    return sorted(out, key=lambda e: e["date"] or "9999")


def suggest(db: Session, q: str, limit: int = 20) -> list[dict]:
    """Autocomplete from the cached snapshot (instant, no network): matching
    ISSUERS first (→ issuer page), then individual bonds (→ issue card)."""
    _spv_map(db)                       # SPV без ИНН → эмитент группы (для _emkey / рейтингов)
    if not q or len(q) < 2:
        return []
    from .ratings import issuer_key
    needle = q.casefold()
    ratings = _ratings_map(db)
    # эмитентов считаем по ВСЕМ живым выпускам (в т.ч. без свежего YTM), чтобы счётчик был полным
    all_snaps = db.query(BondSnapshot).filter(_live_filter(db)).all()
    # включаем и флоатеры (у них ytm пустой, метрика — simple_margin): иначе ОФЗ-ПК /
    # корпоративные флоатеры вообще не попадают в подсказки поиска
    cands = [r for r in all_snaps if r.ytm is not None or r.simple_margin_bp is not None]

    # issuers: group matching bonds by issuer, count them, most bonds first
    issuers: dict[str, dict] = {}
    for r in all_snaps:
        rt = ratings.get(r.isin)
        nm = (rt.issuer if rt else None) or r.issuer_full or r.shortname
        if not nm or needle not in nm.casefold():
            continue
        # группируем по КАНОНИЧЕСКОМУ ключу эмитента (emitent_id MOEX), а НЕ по имени —
        # иначе один эмитент (ВЭБ.РФ) дробится, когда у части выпусков имя с суффиксом серии
        k = _emkey(r, rt)
        if not k:
            continue
        e = issuers.setdefault(k, {"type": "issuer", "key": k, "issuer": nm, "count": 0, "vol": 0, "_names": []})
        e["count"] += 1
        e["vol"] += (r.volume or 0)
        e["_names"].append(nm)
    for e in issuers.values():
        e["issuer"] = cleanest_name(e.pop("_names")) or e["issuer"]
    issuer_list = sorted(issuers.values(), key=lambda x: x["vol"], reverse=True)[:5]

    # bonds: match by short name / isin
    hits = [r for r in cands if needle in f"{r.shortname or ''} {r.isin}".casefold()]
    hits.sort(key=lambda r: r.volume or 0, reverse=True)
    bond_list = [{"type": "bond", "isin": r.isin, "secid": r.secid, "name": r.shortname,
                  "ytm": r.ytm, "duration_years": r.duration_years, "board": r.board}
                 for r in hits[:limit]]
    return issuer_list + bond_list


def facets(db: Session) -> dict:
    """Filter facets with counts, ALL computed on the same base as the screener
    (traded bonds, ytm not null) so the numbers reconcile across groups."""
    ratings = _ratings_map(db)
    amap = agencies.ratings_map(db)
    sectors: dict[str, int] = {}
    buckets: dict[str, int] = {}
    currencies: dict[str, int] = {}
    liq: dict[str, int] = {}
    for r in _all_rows(db):     # из кэша
        b = _bucket_of(r)
        if b:
            buckets[b] = buckets.get(b, 0) + 1
        if r.get("sector"):
            sectors[r["sector"]] = sectors.get(r["sector"], 0) + 1
        c = r["currency"]
        currencies[c] = currencies.get(c, 0) + 1
        lc = r.get("liq_class")
        if lc:
            liq[lc] = liq.get(lc, 0) + 1
    ccy_order = {"RUB": 5, "CNY": 4, "USD": 3, "EUR": 2, "CHF": 1}
    liq_order = {"Высокая": 3, "Средняя": 2, "Низкая": 1}
    return {
        "sectors": sorted(sectors.keys()),
        "rating_buckets": sorted(buckets.keys(), key=lambda b: -_BUCKET_ORDER.get(b, 0)),
        "currencies": sorted(currencies.keys(), key=lambda c: -ccy_order.get(c, 0)),
        "liquidity": sorted(liq.keys(), key=lambda x: -liq_order.get(x, 0)),
        "sector_counts": sectors, "bucket_counts": buckets,
        "currency_counts": currencies, "liq_counts": liq,
    }


_BUCKET_ORDER = {"AAA": 9, "AA": 8, "A": 7, "BBB": 6, "BB": 5, "B": 4, "CCC": 3, "CC": 2, "C": 1, "D": 0}


def cashflow_duration_days(secid: str, facevalue: float | None, couponpercent: float | None,
                           ytm: float | None, yield_date: str | None) -> float | None:
    """Собственная дюрация Маколея (дни) по графику ISS bondization — для сверки с MOEX.
    У MOEX две дюрации (marketdata и marketdata_yields), и у ~5% бумаг одна из них битая
    (АйДиКол1P7: 65 дн. против верных 450). Потоки до даты доходности (оферта/погашение):
    купоны (известная сумма, иначе ставка × непогашенный номинал × дни периода/365),
    амортизации, остаток номинала на дату. Дисконт по эффективной доходности."""
    if not ytm or ytm <= -99 or not yield_date or yield_date.startswith("0000"):
        return None
    today = date.today()
    try:
        horizon = date.fromisoformat(yield_date)
        bz = moex.get_bondization(secid)
    except Exception:  # noqa: BLE001
        return None
    if horizon <= today:
        return None
    # график с нулевыми будущими амортизациями (ипотечные/секьюритизация) — биржа учитывает
    # досрочные погашения, мы нет → не спорим с MOEX
    if any(a.get("date") and a["date"] > today.isoformat() and not a.get("value") for a in bz.get("amortizations") or []):
        return None
    amort = sorted((a for a in bz.get("amortizations") or [] if a.get("date") and not a["date"].startswith("0000")),
                   key=lambda a: a["date"])
    fut_am = [(date.fromisoformat(a["date"]), a.get("value") or 0.0) for a in amort if a["date"] > today.isoformat()]
    face = facevalue or sum(v for _, v in fut_am) or None
    if not face:
        return None
    cps = sorted((c for c in bz.get("coupons") or [] if c.get("date") and not c["date"].startswith("0000")),
                 key=lambda c: c["date"])
    flows: dict[date, float] = {}
    outstanding = face
    prev = None
    for c in cps:
        d = date.fromisoformat(c["date"])
        if d <= today:
            prev = d
            continue
        if d > horizon:
            break
        # номинал, на который начисляется купон — до амортизаций в эту же дату
        out_before = face - sum(v for ad, v in fut_am if ad < d)
        amt = c.get("value")
        if not amt:
            rate = c.get("valueprc") or couponpercent
            days = (d - prev).days if prev else 365 / 12
            amt = (rate or 0) / 100 * out_before * days / 365 if rate else 0.0
        flows[d] = flows.get(d, 0.0) + amt
        prev = d
    for ad, v in fut_am:
        if ad < horizon:
            flows[ad] = flows.get(ad, 0.0) + v
            outstanding -= v
    if outstanding > 1e-9:
        flows[horizon] = flows.get(horizon, 0.0) + outstanding
    y = ytm / 100
    pv = w = 0.0
    for d, cf in flows.items():
        t = (d - today).days / 365.0
        disc = cf / (1 + y) ** t
        pv += disc
        w += disc * t
    return w / pv * 365.0 if pv > 0 else None


def pick_duration(yl: float | None, md: float | None, own: float | None) -> tuple[float | None, str]:
    """Из двух дюраций MOEX берём согласную с расчётом по потокам (±15%); обе не сходятся —
    свой расчёт. Без расчёта — прежний порядок (marketdata_yields, затем marketdata)."""
    cands = [(v, src) for v, src in ((yl, "moex_yields"), (md, "moex_md")) if v]
    if own:
        best = min(cands, key=lambda c: abs(c[0] - own), default=None)
        if best and abs(best[0] - own) <= 0.15 * own:
            return best
        return round(own), "cashflows"
    return cands[0] if cands else (None, "")


def _duration_suspect(r: dict) -> bool:
    yl, md = r.get("duration_yl"), r.get("duration_md")
    if yl and md and abs(yl - md) > 0.2 * max(yl, md):
        return True
    d = yl or md
    # вторая дюрация пустая, а единственная — крошечная к далёкой дате доходности
    # (ДОМ.РФ30об: 25 дн. при оферте через 351 дн. и купонах, известных до оферты)
    if yl and not md and r.get("yield_date") and not r["yield_date"].startswith("0000"):
        try:
            left = (date.fromisoformat(r["yield_date"]) - date.today()).days
        except ValueError:
            left = 0
        if left > 60 and yl < 0.3 * left:
            return True
    yd = r.get("yield_date") or r.get("matdate")
    if d and yd and not yd.startswith("0000"):
        try:
            left = (date.fromisoformat(yd) - date.today()).days
        except ValueError:
            return False
        return d > left + 5          # дюрация больше срока до даты — невозможно
    return False


def fix_durations(fetched: dict[str, list]) -> int:
    """Спорные дюрации (две MOEX расходятся >20% или дюрация длиннее срока) → сверка с
    расчётом по графику выплат. Меняет r["duration"] на месте, возвращает число правок."""
    from concurrent.futures import ThreadPoolExecutor
    sus = [r for rows in fetched.values() for r in rows if r.get("isin") and _duration_suspect(r)]
    if not sus:
        return 0

    def calc(r):
        return cashflow_duration_days(r.get("secid") or r["isin"], r.get("facevalue"), r.get("couponpercent"),
                                      r.get("yield"), r.get("yield_date") or r.get("matdate"))
    changed = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for r, own in zip(sus, ex.map(calc, sus)):
            d, src = pick_duration(r.get("duration_yl"), r.get("duration_md"), own)
            if d and d != r.get("duration"):
                changed += 1
            if d:
                r["duration"], r["duration_src"] = d, src
    log.info("durations: спорных %d, исправлено %d", len(sus), changed)
    return changed
