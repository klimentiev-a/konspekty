"""
MOEX ISS client for the bond dashboard.

Single source of MARKET data: instrument reference, current quotes, price
history, yield history and candles. NOT a source of the full coupon schedule —
that lives in `bond_cashflows` (see models.py).

Design notes
------------
* We never assume SECID == ISIN. We resolve every ISIN through the ISS
  securities reference and read its primary board.
* Boards: OFZ (government bonds) trade mostly on TQOB, most corporate / exchange
  / sub-federal bonds on TQCB. We read the real board from the reference and
  fall back to this heuristic only if the reference is unavailable.
* All requests use iss.meta=off and, where possible, iss.only / *.columns to
  keep payloads small. History endpoints are paginated via `start`.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Optional

import requests

log = logging.getLogger("moex")

MOEX_BASE = "https://iss.moex.com/iss"
ENGINE = "stock"
MARKET = "bonds"
DEFAULT_BOARD = "TQCB"   # corporate / exchange bonds
OFZ_BOARD = "TQOB"       # government bonds (ОФЗ)

# Equity / fund boards live in the "shares" market, not "bonds"; map so the same
# quote & history calls work for акции и фонды too.
_SHARE_BOARDS = {"TQBR", "TQTF", "TQTD", "TQTE", "TQIF", "TQPI", "SMAL", "TQDP"}


def _market_for_board(board: str | None) -> str:
    b = (board or "").upper()
    if b in _SHARE_BOARDS or b.startswith("TQT") or b.startswith("TQB"):
        return "shares"
    return MARKET
TIMEOUT = 20
RETRIES = 3              # ISS occasionally times out / rate-limits (429)
RETRY_BACKOFF = 1.5      # seconds, multiplied by attempt number
# не больше 10 одновременных запросов к ISS со всего процесса: при параллельной подгрузке
# историй (постранично + пиры карточки) биржа иначе начинает рвать соединения
_ISS_SEM = threading.BoundedSemaphore(10)


class MoexError(RuntimeError):
    pass


# In-process TTL cache for the *reference* endpoints (identity + coupon schedule).
# These change at most daily, so caching them avoids re-hitting ISS on every page
# load / scenario recompute. Quotes & history are NOT cached (always fresh).
_TTL_CACHES: list[dict] = []


def _ttl_cache(seconds: int):
    def deco(fn):
        store: dict = {}
        _TTL_CACHES.append(store)

        def wrap(*args):
            now = time.time()
            hit = store.get(args)
            if hit is not None and now - hit[0] < seconds:
                return hit[1]
            val = fn(*args)          # errors propagate and are NOT cached
            store[args] = (now, val)
            return val
        wrap.cache_clear = store.clear
        wrap.__name__ = fn.__name__
        wrap.__wrapped__ = fn
        return wrap
    return deco


def clear_reference_cache() -> None:
    """Drop all cached reference/bondization data (called on manual market refresh)."""
    for store in _TTL_CACHES:
        store.clear()


def _get(path: str, params: dict | None = None) -> dict:
    url = f"{MOEX_BASE}/{path.lstrip('/')}"
    p = {"iss.meta": "off"}
    if params:
        p.update(params)
    last: Exception | None = None
    for attempt in range(1, RETRIES + 1):
        try:
            with _ISS_SEM:
                r = requests.get(url, params=p, timeout=TIMEOUT)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:  # network / http / timeout
            last = e
            if attempt < RETRIES:
                log.warning("MOEX retry %d/%d for %s: %s", attempt, RETRIES, url, e)
                time.sleep(RETRY_BACKOFF * attempt)
    raise MoexError(f"MOEX request failed after {RETRIES} tries: {url} ({last})") from last


def _block(payload: dict, name: str) -> list[dict]:
    """Turn an ISS table block {columns, data} into a list of row dicts."""
    blk = payload.get(name) or {}
    cols = blk.get("columns") or []
    return [dict(zip(cols, row)) for row in (blk.get("data") or [])]


def _first(rows: list[dict]) -> dict:
    return rows[0] if rows else {}


# --------------------------------------------------------------------------- #
# Reference / resolver
# --------------------------------------------------------------------------- #
@_ttl_cache(1800)   # 30 мин — идентичность бумаги меняется максимум раз в день
def resolve_security(isin: str) -> dict:
    """
    Resolve an ISIN to its MOEX identity.

    Returns a dict with: isin, secid, board, shortname, name, is_traded, type,
    matdate, facevalue, faceunit, couponvalue, couponpercent, nextcoupon.
    Raises MoexError if the security cannot be found at all.
    """
    isin = (isin or "").strip().upper()
    payload = _get(
        f"securities/{isin}.json",
        {"iss.only": "description,boards"},
    )
    desc = {row["name"]: row.get("value") for row in _block(payload, "description")}
    boards = _block(payload, "boards")

    if not desc and not boards:
        # Some securities (notably newer ОФЗ) aren't found by ISIN directly but
        # resolve via the search endpoint → retry the lookup by the real SECID.
        try:
            hits = _get("securities.json", {"q": isin, "iss.only": "securities"})
            for row in _block(hits, "securities"):
                sec = row.get("secid")
                if sec and sec != isin:
                    payload = _get(f"securities/{sec}.json", {"iss.only": "description,boards"})
                    desc = {r["name"]: r.get("value") for r in _block(payload, "description")}
                    boards = _block(payload, "boards")
                    break
        except MoexError:
            pass

    if not desc and not boards:
        raise MoexError(f"ISIN not found on MOEX: {isin}")

    secid = desc.get("SECID") or isin
    board = _pick_board(boards, desc)

    return {
        "isin": isin,
        "secid": secid,
        "board": board,
        "shortname": desc.get("SHORTNAME"),
        "name": desc.get("NAME") or desc.get("ISSUENAME"),
        "type": desc.get("TYPE"),
        # Human-readable instrument class from the ISS reference. For RU bonds
        # this is the authoritative fix/float flag, e.g. "Флоатер",
        # "Фикс с известным купоном", "Дисконт", "Индексируемый номинал".
        "bond_type": desc.get("BOND_TYPE"),
        "bond_subtype": desc.get("BOND_SUBTYPE"),
        "typename": desc.get("TYPENAME"),
        "matdate": desc.get("MATDATE"),
        "coupon_benchmark": desc.get("COUPON_BENCHMARK"),
        "coupon_benchmark_spread": _to_float(desc.get("COUPON_BENCHMARK_SPREAD")),
        "facevalue": _to_float(desc.get("FACEVALUE") or desc.get("INITIALFACEVALUE")),
        "initialfacevalue": _to_float(desc.get("INITIALFACEVALUE")),
        "faceunit": desc.get("FACEUNIT"),
        "couponvalue": _to_float(desc.get("COUPONVALUE")),
        "couponpercent": _to_float(desc.get("COUPONPERCENT")),
        "couponperiod": _to_float(desc.get("COUPONPERIOD")),
        "couponfrequency": _to_float(desc.get("COUPONFREQUENCY")),
        "nextcoupon": desc.get("NEXTCOUPON"),
        "is_traded": bool(boards),
    }


def _pick_board(boards: list[dict], desc: dict) -> str:
    """Pick the primary traded board, preferring is_primary then is_traded."""
    if boards:
        primary = [b for b in boards if b.get("is_primary") == 1]
        traded = [b for b in boards if b.get("is_traded") == 1]
        for pool in (primary, traded, boards):
            for b in pool:
                bid = b.get("boardid")
                if bid:
                    return bid
    # Fallback heuristic from the security type.
    t = (desc.get("TYPE") or "").lower()
    if "ofz" in t or "subfederal" not in t and "gov" in t:
        return OFZ_BOARD
    return DEFAULT_BOARD


# --------------------------------------------------------------------------- #
# Current quote
# --------------------------------------------------------------------------- #
def get_current_quote(isin: str, board: str | None = None) -> dict:
    """Current market snapshot for one bond on its board."""
    board = board or DEFAULT_BOARD
    payload = _get(
        f"engines/{ENGINE}/markets/{_market_for_board(board)}/boards/{board}/securities/{isin}.json",
        {"iss.only": "securities,marketdata,marketdata_yields"},
    )
    sec = _first(_block(payload, "securities"))
    md = _first(_block(payload, "marketdata"))
    yld = _first(_block(payload, "marketdata_yields"))

    return {
        "isin": isin,
        "secid": sec.get("SECID"),
        "board": board,
        "shortname": sec.get("SHORTNAME"),
        "facevalue": _to_float(sec.get("FACEVALUEONSETTLEDATE")) or _to_float(sec.get("FACEVALUE")),
        "settledate": sec.get("SETTLEDATE"),
        "accint": _to_float(sec.get("ACCRUEDINT")),            # НКД, руб
        "couponvalue": _to_float(sec.get("COUPONVALUE")),
        "couponpercent": _to_float(sec.get("COUPONPERCENT")),
        "nextcoupon": sec.get("NEXTCOUPON"),
        "matdate": sec.get("MATDATE"),
        "prevprice": _to_float(sec.get("PREVPRICE")),
        # marketdata (live, % of face)
        "last": _to_float(md.get("LAST")),
        "marketprice": _to_float(md.get("MARKETPRICE")),
        "lcloseprice": _to_float(md.get("LCLOSEPRICE")),
        "waprice": _to_float(md.get("WAPRICE")),
        "bid": _to_float(md.get("BID")),
        "offer": _to_float(md.get("OFFER")),
        "yield_md": _to_float(md.get("YIELD")),
        "duration": _to_float(md.get("DURATION")),
        "volume": _to_float(md.get("VALTODAY")),
        "numtrades": _to_float(md.get("NUMTRADES")),
        "updatetime": md.get("UPDATETIME") or md.get("SYSTIME"),
        # yields block
        "ytm": _to_float(yld.get("YIELDCLOSE") or yld.get("EFFECTIVEYIELD") or md.get("YIELD")),
        "duration_yields": _to_float(yld.get("DURATION")),
    }


def get_board_securities(board: str = DEFAULT_BOARD) -> list[dict]:
    """All bonds currently listed on a board (securities + marketdata merged).

    ONE request returns the whole board with static params + live yield/duration —
    this is the bulk source that powers the cached universe snapshot."""
    payload = _get(
        f"engines/{ENGINE}/markets/{MARKET}/boards/{board}/securities.json",
        {"iss.only": "securities,marketdata,marketdata_yields"},
    )
    secs = {r.get("SECID"): r for r in _block(payload, "securities")}
    # marketdata_yields — каноническая эффективная доходность/дюрация MOEX (к оферте/по графику):
    # в основном блоке у ~600 бумаг DURATION=0 → не было G-спреда
    ylds = {r.get("SECID"): r for r in _block(payload, "marketdata_yields")}
    out = []
    for md in _block(payload, "marketdata"):
        sec = secs.get(md.get("SECID"), {})
        yl = ylds.get(md.get("SECID"), {})
        out.append({
            "secid": md.get("SECID"),
            "isin": sec.get("ISIN") or sec.get("SECID"),
            "shortname": sec.get("SHORTNAME"),
            "board": board,
            "matdate": sec.get("MATDATE"),
            # дата ближайшей оферты/выкупа (put/call), к которой MOEX считает доходность
            "buyback_date": sec.get("BUYBACKDATE"),
            "facevalue": _to_float(sec.get("FACEVALUEONSETTLEDATE")) or _to_float(sec.get("FACEVALUE")),
            "settledate": sec.get("SETTLEDATE"),
            "faceunit": sec.get("FACEUNIT") or sec.get("CURRENCYID"),
            "couponpercent": _to_float(sec.get("COUPONPERCENT")),
            "couponvalue": _to_float(sec.get("COUPONVALUE")),
            "couponperiod": _to_float(sec.get("COUPONPERIOD")),
            "accint": _to_float(sec.get("ACCRUEDINT")),
            "lotsize": _to_float(sec.get("LOTSIZE")),
            "sectype": sec.get("SECTYPE"),
            # authoritative fix/float/… class straight from the board feed
            "bondtype": sec.get("BONDTYPE"),
            "bondsubtype": sec.get("BONDSUBTYPE"),
            "last": _to_float(md.get("LAST")),
            "bid": _to_float(md.get("BID")),
            "offer": _to_float(md.get("OFFER")),
            "marketprice": _to_float(md.get("MARKETPRICE") or md.get("LCURRENTPRICE")),
            "waprice": _to_float(md.get("WAPRICE")),
            # цена/средневзвешенная предыдущего дня — ориентир для проверки одинокой заявки
            "prevprice": _to_float(sec.get("PREVWAPRICE") or sec.get("PREVPRICE")),
            # quote freshness: UPDATETIME/TIME is HH:MM:SS of the last update;
            # SYSTIME is the ISS server time — together they tell us if LAST is stale.
            "quotetime": md.get("UPDATETIME") or md.get("TIME"),
            "systime": md.get("SYSTIME"),
            "yield": _to_float(yl.get("EFFECTIVEYIELD")) or _to_float(md.get("YIELD")),
            "duration": _to_float(yl.get("DURATION")) or _to_float(md.get("DURATION")),
            # обе дюрации MOEX + дата доходности — universe сверяет их с расчётом по потокам
            "duration_yl": _to_float(yl.get("DURATION")),
            "duration_md": _to_float(md.get("DURATION")),
            "yield_date": yl.get("YIELDDATE"),
            "yield_date_type": yl.get("YIELDDATETYPE"),        # MATDATE / OFFERDATE / BUYBACKDATE
            # G-спред MOEX (б.п.) к КБД на дюрации бумаги — по ТОЙ ЖЕ доходности EFFECTIVEYIELD
            "gspread_moex": _to_float(yl.get("GSPREADBP")) if yl.get("EFFECTIVEYIELD") is not None else None,
            "volume": _to_float(md.get("VALTODAY_RUR") or md.get("VALTODAY")),
            "numtrades": _to_float(md.get("NUMTRADES")),
            # изменение за день: последняя цена к цене предыдущего дня (LASTTOPREVPRICE, %).
            # НЕ средневзвешенная (WAPTOPREVWAPRICEPRCNT): одна аномальная сделка сдвигает WAPRICE
            # (ОФЗ 26212: WAP 97,76 при LAST 92,13 → «+6,07%» при реальных +0,03%)
            "change_pct": _to_float(md.get("LASTTOPREVPRICE")) if md.get("LASTTOPREVPRICE") is not None else (
                round((_to_float(md.get("LAST")) / _to_float(sec.get("PREVPRICE")) - 1) * 100, 2)
                if _to_float(md.get("LAST")) and _to_float(sec.get("PREVPRICE")) else None),
            # дата торгового дня, к которому относятся VALTODAY/NUMTRADES (для среднего оборота)
            "tradedate": (md.get("SYSTIME") or "")[:10] or None,
            "settledate": sec.get("SETTLEDATE"),
            # primary-market progress: how much of the issue is placed so far
            "issuesize": _to_float(sec.get("ISSUESIZE")),
            "issuesize_placed": _to_float(sec.get("ISSUESIZEPLACED")),
        })
    return out


_ISSUER_NAMES_TTL = 43200  # 12h — the ISS reference names change rarely
_issuer_names_cache: dict = {"at": 0.0, "data": None, "ids": None}


def get_issuer_ids(force: bool = False) -> dict[str, str]:
    """ISIN -> MOEX emitent_id (stable numeric issuer identity). This is the ONLY
    reliable way to group every issue of one issuer: the per-board `issuer`/
    `shortname` strings vary wildly ('АО "ПГК"' vs 'Первая Грузовая Компания, 003P-01'
    vs None), but emitent_id is identical across all of an issuer's bonds. Populated
    by the same ISS pull as get_issuer_names()."""
    get_issuer_names(force=force)
    return _issuer_names_cache.get("ids") or {}


def get_issuer_names(force: bool = False) -> dict[str, str]:
    """ISIN -> full issuer name for every bond in the ISS reference. The global
    securities list carries `name` ("ПАО НК Роснефть 001P-01") and
    `emitent_title`, which the per-board feed lacks — this is what lets us match
    a cryptic MOEX ticker to a credit-rating registry entry.

    The global list is ~10k rows (≈105 ISS pages). Fetching them one page at a
    time is the slowest step of a market refresh, so we (a) request only the four
    columns we need, (b) pull pages in concurrent batches, and (c) cache the
    result for 12h — a second refresh in the same window skips the network."""
    now = time.time()
    if not force and _issuer_names_cache["data"] is not None and (now - _issuer_names_cache["at"] < _ISSUER_NAMES_TTL):
        return _issuer_names_cache["data"]

    from concurrent.futures import ThreadPoolExecutor
    base = {"engine": ENGINE, "market": MARKET, "iss.only": "securities",
            "securities.columns": "secid,isin,name,emitent_title,emitent_id,emitent_inn"}

    def fetch(start: int) -> list[dict]:
        p = dict(base); p["start"] = start
        return _block(_get("securities.json", p), "securities")

    rows: list[dict] = []
    start, STEP, BATCH = 0, 100, 12
    with ThreadPoolExecutor(max_workers=8) as ex:
        while True:
            offsets = [start + i * STEP for i in range(BATCH)]
            done = False
            for ch in ex.map(fetch, offsets):
                if ch:
                    rows.extend(ch)
                if not ch or len(ch) < STEP:
                    done = True
            start += BATCH * STEP
            if done:
                break

    out: dict[str, str] = {}
    ids: dict[str, str] = {}
    inns: dict[str, str] = {}
    titles: dict[str, str] = {}
    for r in rows:
        if (r.get("isin") or r.get("secid")) and r.get("emitent_title"):
            titles[r.get("isin") or r.get("secid")] = str(r["emitent_title"]).strip()
        if (r.get("isin") or r.get("secid")) and r.get("emitent_inn"):
            inns[r.get("isin") or r.get("secid")] = str(r["emitent_inn"]).strip()
        isin = r.get("isin") or r.get("secid")
        nm = r.get("name") or r.get("emitent_title")
        if isin and nm:
            out[isin] = nm
        eid = r.get("emitent_id")
        if isin and eid not in (None, "", 0, "0"):
            ids[isin] = str(eid)
    if out:                                   # never cache an empty/failed pull
        _issuer_names_cache.update(at=now, data=out, ids=ids, inns=inns, titles=titles)
    return out


def get_issuer_inns(force: bool = False) -> dict[str, str]:
    """ISIN -> ИНН эмитента (MOEX ISS emitent_inn) — ключ сопоставления кредитных рейтингов."""
    get_issuer_names(force=force)
    return _issuer_names_cache.get("inns") or {}


def get_issuer_titles(force: bool = False) -> dict[str, str]:
    """ISIN -> полное юр. название эмитента (emitent_title) — запасной ключ для агентств без ИНН."""
    get_issuer_names(force=force)
    return _issuer_names_cache.get("titles") or {}


# --------------------------------------------------------------------------- #
# History (paginated)
# --------------------------------------------------------------------------- #
def _paginate(path: str, block: str, params: dict, batch: int = 6) -> list[dict]:
    """Все страницы блока ISS (по 100 строк). Первая — одна; если она полная, дальше пачками
    по batch параллельно. Раньше страницы шли по очереди: у бумаги с пятью годами торгов это
    15 запросов подряд, и первое открытие карточки облигации ждало до 4–5 секунд."""
    first = _block(_get(path, {**params, "start": 0}), block)
    rows: list[dict] = list(first)
    if len(first) < 100:             # короткая первая страница — она же последняя
        return rows
    from concurrent.futures import ThreadPoolExecutor
    start = 100
    with ThreadPoolExecutor(max_workers=batch) as ex:
        while True:
            starts = [start + i * 100 for i in range(batch)]
            chunks = list(ex.map(lambda st: _block(_get(path, {**params, "start": st}), block), starts))
            done = False
            for ch in chunks:            # страницы идут по порядку; первая неполная — конец
                rows.extend(ch)
                if len(ch) < 100:
                    done = True
                    break
            if done:
                return rows
            start += batch * 100


def get_price_history(isin: str, board: str, frm: str, till: str) -> list[dict]:
    path = f"history/engines/{ENGINE}/markets/{_market_for_board(board)}/boards/{board}/securities/{isin}.json"
    # FACEVALUE per date — the nominal on that day: it SHRINKS for amortizers and
    # GROWS for inflation-linkers (ОФЗ-ИН), so the ruble total return can track the
    # indexed principal instead of assuming a constant face.
    cols = "TRADEDATE,CLOSE,LEGALCLOSEPRICE,MARKETPRICE3,ACCINT,VOLUME,VALUE,NUMTRADES,YIELDCLOSE,FACEVALUE"
    rows = _paginate(path, "history", {"from": frm, "till": till, "history.columns": cols})
    return [{
        "date": r.get("TRADEDATE"),
        "close": _to_float(r.get("CLOSE")),
        "legalclose": _to_float(r.get("LEGALCLOSEPRICE")),
        "marketprice": _to_float(r.get("MARKETPRICE3")),
        "accint": _to_float(r.get("ACCINT")),
        "volume": _to_float(r.get("VOLUME")),
        "value": _to_float(r.get("VALUE")),
        "numtrades": _to_float(r.get("NUMTRADES")),
        "yieldclose": _to_float(r.get("YIELDCLOSE")),
        "facevalue": _to_float(r.get("FACEVALUE")),
    } for r in rows]


_INDEX_QUOTE_CACHE: dict[str, tuple[int, dict | None]] = {}


def get_index_quote(secid: str) -> dict | None:
    """Official current index level with its exchange date, never today's guessed date."""
    bucket = int(time.time() // 3600)
    hit = _INDEX_QUOTE_CACHE.get(secid)
    if hit and hit[0] == bucket:
        return hit[1]
    rows = _block(_get(f"engines/{ENGINE}/markets/index/securities/{secid}.json", {
        "iss.only": "marketdata",
        "marketdata.columns": "SECID,CURRENTVALUE,TRADEDATE,UPDATETIME",
    }), "marketdata")
    valid = [r for r in rows if r.get("SECID") == secid and r.get("TRADEDATE") and _to_float(r.get("CURRENTVALUE")) is not None]
    if not valid:
        return None
    r = max(valid, key=lambda x: (x["TRADEDATE"], x.get("UPDATETIME") or ""))
    quote = {"date": r["TRADEDATE"], "close": _to_float(r["CURRENTVALUE"]), "time": r.get("UPDATETIME")}
    _INDEX_QUOTE_CACHE[secid] = (bucket, quote)
    return quote


def get_bond_index_history(secid: str, frm: str, till: str) -> list[dict]:
    """Daily MOEX index level and basket analytics.

    Bond-index history contains two different but complementary measures in the
    same row: ``CLOSE`` is the total-return index level, while ``YIELD`` is the
    weighted yield of the bonds currently in its basket.  Keep only the main
    trading session when MOEX publishes several session rows for one date.
    """
    secid = (secid or "").strip().upper()
    path = f"history/engines/{ENGINE}/markets/index/securities/{secid}.json"
    cols = "SECID,TRADEDATE,CLOSE,YIELD,DURATION,TRADINGSESSION"
    rows = _paginate(path, "history", {
        "from": frm, "till": till, "iss.only": "history", "history.columns": cols,
    }, batch=4)
    out: list[dict] = []
    seen: dict[str, dict] = {}
    for r in rows:
        day = r.get("TRADEDATE")
        if not day:
            continue
        item = {
            "date": day,
            "close": _to_float(r.get("CLOSE")),
            "yield": _to_float(r.get("YIELD")),
            "duration_days": _to_float(r.get("DURATION")),
        }
        # Session 3 is the full trading day.  If it is absent, retain the last
        # row received for that date (legacy history has no session marker).
        if day not in seen or str(r.get("TRADINGSESSION") or "") == "3":
            seen[day] = item
    for day in sorted(seen):
        item = seen[day]
        if item["close"] is not None or item["yield"] is not None:
            out.append(item)
    return out


@_ttl_cache(21600)
def get_index_composition(secid: str) -> dict:
    """Current official MOEX index basket, including every constituent.

    The analytics endpoint uses a 20-row page (unlike most ISS history
    endpoints), therefore it is paginated from its own cursor instead of the
    generic 100-row helper above.
    """
    secid = (secid or "").strip().upper()
    if not secid:
        raise MoexError("Index code is required")
    path = f"statistics/engines/{ENGINE}/markets/index/analytics/{secid}.json"
    params = {
        "iss.only": "analytics,analytics.cursor",
        "analytics.columns": (
            "indexid,tradedate,ticker,shortnames,secids,weight,"
            "tradingsession,trade_session_date"
        ),
    }
    payload = _get(path, params)
    rows = _block(payload, "analytics")
    cursor = _first(_block(payload, "analytics.cursor"))
    total = int(cursor.get("TOTAL") or len(rows))
    page_size = int(cursor.get("PAGESIZE") or max(len(rows), 20))
    for start in range(page_size, total, page_size):
        rows.extend(_block(_get(path, {**params, "start": start}), "analytics"))

    dated = [r for r in rows if r.get("tradedate")]
    if not dated:
        return {"code": secid, "as_of": None, "items": []}
    latest = max(str(r["tradedate"]) for r in dated)
    current = [r for r in dated if str(r.get("tradedate")) == latest]
    # Session 3 is the completed main session. Some indices only publish one
    # session; in that case retain it rather than returning an empty basket.
    full_session = [r for r in current if str(r.get("tradingsession") or "") == "3"]
    if full_session:
        current = full_session

    deduped: dict[str, dict] = {}
    for row in current:
        ticker = str(row.get("ticker") or "").strip().upper()
        security = str(row.get("secids") or ticker).strip().upper()
        key = security or ticker
        if not key:
            continue
        deduped[key] = {
            "ticker": ticker or security,
            "secid": security or ticker,
            "name": str(row.get("shortnames") or ticker or security).strip(),
            "weight": _to_float(row.get("weight")),
        }
    items = sorted(deduped.values(), key=lambda x: x.get("weight") or 0, reverse=True)
    return {"code": secid, "as_of": latest, "items": items}


@_ttl_cache(1800)
def latest_session(board: str = DEFAULT_BOARD) -> Optional[str]:
    """Дата последней торговой сессии по доске (для инкрементального накопления оборотов)."""
    path = f"history/engines/{ENGINE}/markets/{_market_for_board(board)}/boards/{board}/securities.json"
    payload = _get(path, {"iss.only": "history", "history.columns": "TRADEDATE"})
    rows = _block(payload, "history")
    dates = [r.get("TRADEDATE") for r in rows if r.get("TRADEDATE")]
    return max(dates) if dates else None


def board_turnover_on_date(board: str, on_date: str) -> dict[str, float]:
    """{SECID: оборот в ₽} по доске за конкретную торговую сессию (для среднего оборота за месяц)."""
    path = f"history/engines/{ENGINE}/markets/{_market_for_board(board)}/boards/{board}/securities.json"
    rows = _paginate(path, "history", {"date": on_date, "iss.only": "history",
                                       "history.columns": "SECID,VALUE"})
    out: dict[str, float] = {}
    for r in rows:
        v = _to_float(r.get("VALUE"))
        if r.get("SECID") and v is not None:
            out[r["SECID"]] = v
    return out


def get_yield_history(isin: str, board: str, frm: str, till: str) -> list[dict]:
    path = f"history/engines/{ENGINE}/markets/{MARKET}/boards/{board}/yields/{isin}.json"
    # только нужные колонки: ответ биржи втрое меньше и быстрее разбирается (лишние имена ISS молча игнорирует)
    rows = _paginate(path, "history_yields", {
        "from": frm, "till": till, "iss.only": "history_yields",
        "history_yields.columns": "TRADEDATE,EFFECTIVEYIELD,YIELDCLOSE,EFFECTIVEYIELDWAPRICE,YIELDATWAP,"
                                  "YIELDTOOFFER,DURATION,PRICE,PRICECLOSE,GSPREADBP"})
    out = []
    for r in rows:
        out.append({
            "date": r.get("TRADEDATE"),
            "yield_close": _to_float(r.get("EFFECTIVEYIELD") or r.get("YIELDCLOSE")),
            "yield_wap": _to_float(r.get("EFFECTIVEYIELDWAPRICE") or r.get("YIELDATWAP")),
            "yield_to_offer": _to_float(r.get("YIELDTOOFFER")),
            "duration": _to_float(r.get("DURATION")),
            "price": _to_float(r.get("PRICE") or r.get("PRICECLOSE")),
            "gspread": _to_float(r.get("GSPREADBP")),          # G-спред MOEX к КБД за этот день, б.п.
        })
    return out


def get_index_history(code: str, frm: str, till: str) -> list[dict]:
    """Daily close history of a MOEX index (e.g. RGBITR — the OFZ total-return
    benchmark). Returns [{date, close}] sorted ascending."""
    path = f"history/engines/{ENGINE}/markets/index/securities/{code}.json"
    rows = _paginate(path, "history", {"from": frm, "till": till,
                                       "history.columns": "TRADEDATE,CLOSE"})
    out = [{"date": r.get("TRADEDATE"), "close": _to_float(r.get("CLOSE"))}
           for r in rows if r.get("TRADEDATE") and r.get("CLOSE") is not None]
    out.sort(key=lambda x: x["date"])
    return out


def get_candles(isin: str, board: str, frm: str, till: str, interval: int = 24) -> list[dict]:
    path = f"engines/{ENGINE}/markets/{_market_for_board(board)}/boards/{board}/securities/{isin}/candles.json"
    rows = _paginate(path, "candles", {"from": frm, "till": till, "interval": interval})
    return [{
        "open": _to_float(r.get("open")),
        "high": _to_float(r.get("high")),
        "low": _to_float(r.get("low")),
        "close": _to_float(r.get("close")),
        "value": _to_float(r.get("value")),
        "volume": _to_float(r.get("volume")),
        "begin": r.get("begin"),
        "end": r.get("end"),
    } for r in rows]


# --------------------------------------------------------------------------- #
# Price on a given date (for auto buy-price) + full coupon schedule
# --------------------------------------------------------------------------- #
def get_price_on_date(isin: str, board: str, on_date: str) -> dict:
    """Clean close price + accrued interest on `on_date`, or the nearest prior
    trading day. Returns {date, close, accint} (close is % of face)."""
    from datetime import datetime, timedelta

    d = datetime.strptime(on_date, "%Y-%m-%d").date()
    frm = (d - timedelta(days=60)).isoformat()   # wide enough for illiquid bonds
    till = (d + timedelta(days=2)).isoformat()
    rows = get_price_history(isin, board, frm, till)
    rows = [r for r in rows if r["date"] and r["date"] <= on_date and r["close"] is not None]
    if not rows:
        return {"date": None, "close": None, "accint": None}
    r = rows[-1]
    return {"date": r["date"], "close": r["close"], "accint": r["accint"]}


def get_last_known_price(isin: str, board: str, lookback_days: int = 45) -> dict:
    """Most recent traded close+accint (for illiquid bonds with no live quote)."""
    from datetime import date, timedelta

    till = date.today()
    frm = (till - timedelta(days=lookback_days)).isoformat()
    rows = [r for r in get_price_history(isin, board, frm, till.isoformat()) if r["close"] is not None]
    if not rows:
        return {"date": None, "close": None, "accint": None}
    r = rows[-1]
    return {"date": r["date"], "close": r["close"], "accint": r["accint"]}


_FX_SECID = {"USD": "USD000UTSTOM", "CNY": "CNYRUB_TOM", "EUR": "EUR_RUB__TOM"}


_FX_CACHE: dict = {"at": 0.0, "rates": None}


def get_fx_rates() -> dict:
    """Current FX rates to RUB for face currencies. RUB/SUR == 1.0.

    Кэш на 15 минут: объём выпусков секторов пересчитывается в рубли по каждой бумаге, и без
    кэша один запрос /api/sector/leasing делал 900 вызовов и десятки походов на биржу —
    сектор отвечал 20–60 секунд. Неудачный ответ (только рубль) не кэшируем."""
    import time as _t
    if _FX_CACHE["rates"] and _t.time() - _FX_CACHE["at"] < 900:
        return dict(_FX_CACHE["rates"])
    rates = _get_fx_rates_live()
    if len(rates) > 2:
        _FX_CACHE.update(at=_t.time(), rates=dict(rates))
    return rates


def _get_fx_rates_live() -> dict:
    rates = {"RUB": 1.0, "SUR": 1.0}
    try:
        payload = _get(
            "engines/currency/markets/selt/boards/CETS/securities.json",
            {"iss.only": "securities,marketdata",
             "securities": ",".join(_FX_SECID.values())},
        )
        sec = {r.get("SECID"): r for r in _block(payload, "securities")}
        md = {r.get("SECID"): r for r in _block(payload, "marketdata")}
        for ccy, sid in _FX_SECID.items():
            m, s = md.get(sid, {}), sec.get(sid, {})
            rate = _to_float(m.get("LAST")) or _to_float(m.get("MARKETPRICE")) or _to_float(s.get("PREVPRICE"))
            if rate:
                rates[ccy] = rate
    except MoexError as e:
        log.warning("FX rates unavailable: %s", e)
    return rates


@_ttl_cache(1800)   # 30 мин — график купонов/амортизаций стабилен внутри дня
def get_bondization(secid: str, board: str | None = None) -> dict:
    """Full coupon / amortization / offer schedule from the ISS bondization
    method. This IS the source for received & future coupons. value_rub is the
    coupon in rubles; value is in the face currency."""
    # `limit=unlimited` covers the default cursor, but pass block-specific limits
    # too so a densely-amortizing bond never truncates at the ISS page default.
    payload = _get(f"securities/{secid}/bondization.json",
                   {"limit": "unlimited", "coupons.limit": "unlimited",
                    "amortizations.limit": "unlimited", "offers.limit": "unlimited"})
    coupons = [{
        "date": r.get("coupondate"),
        "startdate": r.get("startdate"),
        "initialfacevalue": _to_float(r.get("initialfacevalue")),
        "value": _to_float(r.get("value")),          # coupon amount, face currency
        "valueprc": _to_float(r.get("valueprc")),    # coupon RATE, % — None if not yet set (floater)
        "value_rub": _to_float(r.get("value_rub")),
        "facevalue": _to_float(r.get("facevalue")),
        "faceunit": r.get("faceunit"),
    } for r in _block(payload, "coupons")]
    amorts = [{
        "date": r.get("amortdate"),
        "initialfacevalue": _to_float(r.get("initialfacevalue")),
        "value": _to_float(r.get("value")),
        "value_rub": _to_float(r.get("value_rub")),
        "valueprc": _to_float(r.get("valueprc")),   # % of face repaid on this date
        "faceunit": r.get("faceunit"),
        "source": r.get("data_source"),
    } for r in _block(payload, "amortizations")]
    offers = [{
        "date": r.get("offerdate"),
        "price": _to_float(r.get("price")),
        "type": r.get("offertype"),
    } for r in _block(payload, "offers")]
    return {"coupons": coupons, "amortizations": amorts, "offers": offers}


# --------------------------------------------------------------------------- #
# G-curve (КБД) — the MOEX zero-coupon government yield curve (ZCYC).
# --------------------------------------------------------------------------- #
def get_gcurve() -> dict:
    """MOEX zero-coupon yield curve (кривая бескупонной доходности, КБД).

    Returns {tradedate, tradetime, tenors:[{period_years, yield_pct}, ...]}.
    `yearyields` holds MOEX's own published curve values at standard tenors
    (0.25y … 30y); we interpolate between them in the analytics layer. Yields
    are effective annual, in percent — directly comparable to a bond's YTM.
    """
    payload = _get("engines/stock/zcyc.json", {"iss.only": "yearyields"})
    rows = _block(payload, "yearyields")
    tenors = sorted(
        ({"period_years": _to_float(r.get("period")), "yield_pct": _to_float(r.get("value"))}
         for r in rows if _to_float(r.get("period")) is not None),
        key=lambda x: x["period_years"],
    )
    tradedate = rows[0].get("tradedate") if rows else None
    tradetime = rows[0].get("tradetime") if rows else None
    return {"tradedate": tradedate, "tradetime": tradetime, "tenors": tenors}


# --------------------------------------------------------------------------- #
def _to_float(v: Any) -> Optional[float]:
    if v in (None, "", "-"):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
