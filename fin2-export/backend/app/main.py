"""
FastAPI app: serves the JSON API and the static single-page dashboard.

Python-only deployment — no Node/Docker required. Run:
    uvicorn app.main:app --reload   (from backend/, with the venv active)
or use ../run.sh from the project root.
"""
from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path

log = logging.getLogger("bondai")

from fastapi import Body, Depends, FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from .config import DATA_DIR, FRONTEND_DIR, HISTORY_FROM, UPLOAD_DIR
from .db import BondRating, BondSnapshot, SessionLocal, init_db
from .services import agencies, bond_indices, equity_indices, instrument, moex, moex_ref, news, pipeline, ratings, universe, zspread

app = FastAPI(title="Bond Portfolio Dashboard", version="0.1.0")
# CORS: фронт отдаётся с того же домена (API = ""), поэтому чужим сайтам доступ не нужен.
# Доп. домены — через env ALLOWED_ORIGINS="https://a.ru,https://b.ru".
_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
if _ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=_ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"])

# Админ-операции (обновление рынка/рейтингов, импорт, force-перевыгрузка источников) —
# только с заголовком X-Admin-Token = env ADMIN_TOKEN. Если ADMIN_TOKEN не задан (локальная
# разработка) — поведение прежнее, без проверки. На проде ОБЯЗАТЕЛЬНО задать.
_ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")


def _is_admin(request: Request) -> bool:
    import hmac
    if not _ADMIN_TOKEN:
        return True
    return hmac.compare_digest(request.headers.get("x-admin-token", ""), _ADMIN_TOKEN)


def require_admin(request: Request) -> None:
    if not _is_admin(request):
        raise HTTPException(403, "Нужен токен администратора")


_UPLOAD_EXT = {".xlsx", ".xls", ".csv"}
_UPLOAD_MAX = 10 * 1024 * 1024       # 10 МБ


def _save_upload(file: UploadFile) -> Path:
    """Безопасное сохранение загрузки: только расширения из белого списка, серверное имя
    (uuid — имя клиента в путь не попадает → нет path traversal), лимит размера."""
    import uuid
    ext = Path(file.filename or "").suffix.lower()
    if ext not in _UPLOAD_EXT:
        raise HTTPException(400, "Допустимы файлы .xlsx, .xls, .csv")
    dest = UPLOAD_DIR / f"{uuid.uuid4().hex}{ext}"
    size = 0
    with dest.open("wb") as f:
        while chunk := file.file.read(1 << 20):
            size += len(chunk)
            if size > _UPLOAD_MAX:
                f.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, "Файл больше 10 МБ")
            f.write(chunk)
    return dest
# /api/macro — ~1 МБ JSON (50+ рядов); gzip сжимает в разы
app.add_middleware(GZipMiddleware, minimum_size=2000)

# ПУБЛИЧНАЯ АНАЛИТИЧЕСКАЯ ВЕРСИЯ: портфели и КЛИЕНТСКИЕ данные (ПДн) не должны быть
# доступны. Фронт их не показывает, но роуты остались в коде — глушим их на уровне
# middleware, чтобы никакой прямой запрос не мог получить клиентов/портфели/отчёты.
_BLOCKED_PREFIXES = ("/api/clients", "/api/portfolio", "/api/reports", "/api/builder")


@app.middleware("http")
async def _block_private_routes(request, call_next):  # noqa: ANN001
    p = request.url.path
    if any(p == b or p.startswith(b) for b in _BLOCKED_PREFIXES):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    return await call_next(request)


# ── кэш готовых ответов тяжёлых эндпоинтов ──
# Расчёт у них быстрый, а упаковка в JSON и сжатие — нет: полный список бумаг это 6 МБ JSON,
# и стандартный кодировщик тратил на него полсекунды у меня и полторы — на сервере. Храним
# уже сжатый ответ и отдаём байтами. Рыночные пути сбрасываются со сменой снимка рынка
# (раз в 30 минут днём), остальные — раз в 10 минут. Не больше 40 ответов в памяти.
import gzip as _gzip
import time as _time_mod
from datetime import date as _date_mod
from collections import OrderedDict as _OD

_FAST_PATHS = {
    "/api/universe": "market", "/api/universe/facets": "market", "/api/ideas": "market",
    # помесячная история кривых по рейтингам внутри дня не меняется — держим час
    "/api/movers": "market", "/api/rating_curves": "market", "/api/rating_curves/history": 3600,
    "/api/sector/leasing": "market", "/api/sector/developers": "market", "/api/sector/subfed": "market",
    "/api/sector/utilities": "market", "/api/sector/retail": "market", "/api/sector_index": "market",
    # макро и аукционы обновляются раз в день — ответ держим час
    "/api/macro": 3600, "/api/bond_indices": 3600, "/api/equity_indices": 3600,
    "/api/index_composition": "market", "/api/auctions": 3600, "/api/ofz_curve": 600,
}
_RESP_CACHE: "_OD[str, tuple]" = _OD()
# карточка выпуска: средние спреды и группа сравнения считаются заметно (до 0,4 с процессора на
# одноядерном сервере) и не меняются до следующего снимка рынка; ликвидность — дневная, полчаса
import re as _re
_ISIN_RULES = [
    (_re.compile(r"^/api/instrument/[^/]+/peers_history$"), "market"),
    (_re.compile(r"^/api/universe/(rating_curve|similar)$"), "market"),
    (_re.compile(r"^/api/instrument/[^/]+/liquidity$"), 1800),
]
_RESP_ISIN: "_OD[str, tuple]" = _OD()
_INFLIGHT: dict = {}                 # ключ ответа → future, пока он считается
import asyncio as _asyncio
_RESP_MAX = 40
_SIG_CACHE = {"at": 0.0, "sig": None}
_DATA_GEN = [0]
_REF_DAY = [None]      # дата последней пересборки справочника (moex_ref.rebuild)        # растёт, когда меняются данные вне снимка рынка (графики выплат, индексы флоатеров)


def _snapshot_sig() -> tuple:
    """Подпись снимка рынка; сама по себе — запрос в базу, поэтому держим её 5 секунд."""
    if _time_mod.time() - _SIG_CACHE["at"] > 5:
        db = SessionLocal()
        try:
            from sqlalchemy import func
            cnt, upd = db.query(func.count(BondSnapshot.isin), func.max(BondSnapshot.updated_at)).first()
            _SIG_CACHE.update(at=_time_mod.time(), sig=(cnt, upd.isoformat() if upd else None, _DATA_GEN[0]))
        finally:
            db.close()
    return _SIG_CACHE["sig"]


@app.middleware("http")
async def _cache_heavy(request, call_next):  # noqa: ANN001
    path = request.url.path
    rule, store, cap_n, cap_b = _FAST_PATHS.get(path), _RESP_CACHE, _RESP_MAX, 30_000_000
    if rule is None:
        # ответы карточки выпуска — свой кэш, чтобы сотни бумаг не вытесняли главные вкладки
        rule = next((r for rx, r in _ISIN_RULES if rx.match(path)), None)
        store, cap_n, cap_b = _RESP_ISIN, 120, 15_000_000
    if request.method != "GET" or rule is None or "force" in request.query_params:
        return await call_next(request)
    key = request.url.path + "?" + "&".join(sorted(f"{k}={v}" for k, v in request.query_params.multi_items()))
    sig = _snapshot_sig() if rule == "market" else int(_time_mod.time() // rule)
    hit = store.get(key)
    if (hit is None or hit[0] != sig) and key in _INFLIGHT:
        # тот же ответ уже считается (например, подготовка при наведении) — ждём его, а не считаем второй раз
        try:
            hit = await _asyncio.shield(_INFLIGHT[key])
        except Exception:  # noqa: BLE001 — первый упал: пусть этот запрос посчитает сам
            hit = None
    if hit is None or hit[0] != sig:
        fut = _asyncio.get_running_loop().create_future()
        fut.add_done_callback(lambda f: f.cancelled() or f.exception())   # без «exception never retrieved»
        _INFLIGHT[key] = fut
        try:
            resp = await call_next(request)
            if resp.status_code != 200:
                fut.set_exception(RuntimeError(resp.status_code))
                return resp
            body = b"".join([chunk async for chunk in resp.body_iterator])
            gz = body if resp.headers.get("content-encoding") == "gzip" else _gzip.compress(body, 5)
            hit = (sig, gz)
            store[key] = hit
            store.move_to_end(key)
            # ограничение по числу ответов и по объёму: у скринера много вариантов фильтров
            while len(store) > cap_n or sum(len(v[1]) for v in store.values()) > cap_b:
                store.popitem(last=False)
            fut.set_result(hit)
        except BaseException as e:
            if not fut.done():
                fut.set_exception(e if isinstance(e, Exception) else RuntimeError("cancelled"))
            raise
        finally:
            if _INFLIGHT.get(key) is fut:
                _INFLIGHT.pop(key, None)
    else:
        store.move_to_end(key)
    if "gzip" in request.headers.get("accept-encoding", ""):
        return Response(hit[1], media_type="application/json",
                        headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
    return Response(_gzip.decompress(hit[1]), media_type="application/json")


def fast_json(obj) -> Response:
    """JSON напрямую через json.dumps: в 8 раз быстрее стандартного кодировщика FastAPI
    на больших ответах. Проверено: результат совпадает с ним полностью."""
    import json as _json

    def _default(o):
        if hasattr(o, "isoformat"):
            return o.isoformat()
        if hasattr(o, "item"):
            return o.item()
        return str(o)
    return Response(_json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False,
                                default=_default), media_type="application/json")


@app.exception_handler(moex.MoexError)
async def _moex_error_handler(request, exc):  # noqa: ANN001
    """Any uncaught MOEX failure (unknown ISIN, ISS timeout/rate-limit) → 502,
    not a 500. Covers the raw passthrough routes that don't wrap it themselves."""
    return JSONResponse(status_code=502, content={"detail": f"MOEX недоступен: {exc}"})


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.on_event("startup")
def _startup() -> None:
    init_db()
    _auto_refresh_ratings_if_stale()
    # Фоновое авто-обновление рынка — ТОЛЬКО когда сервер работает постоянным
    # процессом (локально / VPS с systemd): экспортируй ENABLE_SCHEDULER=1.
    # На шаред-хостинге (ISPmanager/Passenger) воркеры спавнятся/убиваются по
    # запросам — фоновый поток ненадёжен и может задвоиться, поэтому там
    # обновление вешается на CRON (scripts/refresh_market.py), а тут выключено.
    if os.environ.get("ENABLE_SCHEDULER", "").lower() in ("1", "true", "yes"):
        _full_update_loop(12)            # ВСЁ на сайте обновляется само раз в 12 часов
        _intraday_market_loop(60)        # лёгкий общий рыночный снимок — каждый час
    warm_sectors()                       # секторы считаются заранее, а не на первом посетителе


_UPDATE_STATUS: dict = {"started": None, "finished": None, "steps": {}}
# полное и внутридневное обновление рынка пишут в одну таблицу снимка — не пускаем их разом
import threading as _threading
_UPDATE_LOCK = _threading.Lock()


def _full_update_once() -> dict:
    """Полное обновление всех данных сайта: рынок + перцентили, рейтинги 4 агентств с историей,
    макро, аукционы ОФЗ, прибыль и нормативы банков. Каждый шаг независим: сбой одного не
    останавливает остальные, а прежние данные при сбое остаются (у каждого источника своя защита)."""
    import time as _time
    from datetime import datetime
    from .services import auctions as auc, macro as mc
    st = {"started": datetime.utcnow().isoformat() + "Z", "finished": None, "steps": {}}
    _UPDATE_STATUS.update(st)

    def step(name, fn):
        t0 = _time.time()
        try:
            fn()
            _UPDATE_STATUS["steps"][name] = {"ok": True, "sec": round(_time.time() - t0, 1)}
        except Exception as e:  # noqa: BLE001
            log.warning("full update %s failed: %s", name, e)
            _UPDATE_STATUS["steps"][name] = {"ok": False, "error": str(e)[:200]}

    def market():
        with _UPDATE_LOCK:
            db = SessionLocal()
            try:
                moex.clear_reference_cache()
                universe.refresh(db)
                universe.compute_spread_percentiles(db)
            finally:
                db.close()
    step("market", market)
    step("ratings", lambda: _refresh_stale_ratings(0))          # все агентства, без учёта возраста
    step("macro", lambda: mc.get_macro(force=True))
    step("auctions", lambda: auc.get_auctions(years=10, force=True))
    step("bank_profits", lambda: mc.get_bank_profits(force=True))
    step("bank_normatives", lambda: mc.get_bank_normatives(force=True))
    universe.invalidate_rows_cache()
    warm_sectors()
    _UPDATE_STATUS["finished"] = datetime.utcnow().isoformat() + "Z"
    try:                                           # вернуть ОС память после пика (pandas/макро): на 1 ГБ VPS важно
        import ctypes
        import gc
        gc.collect()
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:  # noqa: BLE001 — не Linux / нет glibc
        pass
    try:                                           # отметка переживает перезапуски сервиса
        import json as _json
        (DATA_DIR / "last_full_update.json").write_text(_json.dumps(_UPDATE_STATUS, ensure_ascii=False))
    except Exception:  # noqa: BLE001
        pass
    log.info("full update done: %s", _UPDATE_STATUS["steps"])
    return dict(_UPDATE_STATUS)


def _full_update_loop(interval_h: int = 12) -> None:
    """Раз в interval_h часов — полное обновление всего сайта. На старте — сразу, если рыночный
    снимок старше интервала; если упал сам рынок (MOEX недоступна) — повтор через 30 минут."""
    import threading
    import time as _time
    from datetime import datetime, timedelta
    from sqlalchemy import func

    def _last_full():
        try:
            import json as _json
            d = _json.loads((DATA_DIR / "last_full_update.json").read_text())
            _UPDATE_STATUS.update({k: v for k, v in d.items() if not _UPDATE_STATUS.get(k)})
            return datetime.fromisoformat(d["finished"].rstrip("Z"))
        except Exception:  # noqa: BLE001
            return None

    def _job():
        while True:
            last = _last_full()
            due = (not last) or (datetime.utcnow() - last > timedelta(hours=interval_h))
            wait = 1800
            if due:
                res = _full_update_once()
                wait = interval_h * 3600 if (res["steps"].get("market") or {}).get("ok") else 1800
            _time.sleep(wait)
    threading.Thread(target=_job, daemon=True).start()


def _intraday_market_loop(every_min: int = 60) -> None:
    """One shared hourly price/yield/spread snapshot, including evening trading.
    Expensive agency collection and percentile rebuilding stay in the 12h job.
    The existing update lock prevents overlap with full or manual refreshes.
    """
    import threading
    import time as _time
    from datetime import datetime

    def _job():
        last = 0.0
        while True:
            if _time.time() - last >= every_min * 60 and _UPDATE_LOCK.acquire(blocking=False):
                db = SessionLocal()
                try:
                    t0 = _time.time()
                    universe.refresh(db)
                    universe.invalidate_rows_cache()
                    _threading.Thread(target=_warm_http, daemon=True).start()
                    last = _time.time()
                    _UPDATE_STATUS["intraday"] = {"at": datetime.utcnow().isoformat() + "Z",
                                                  "sec": round(last - t0, 1)}
                    log.info("intraday market refresh: %.1fs", last - t0)
                except Exception as e:  # noqa: BLE001 — MOEX недоступна: повторим на следующем круге
                    last = _time.time() - max(0, every_min * 60 - 900)  # retry no sooner than 15 min
                    log.warning("intraday market refresh failed: %s", e)
                finally:
                    db.close()
                    _UPDATE_LOCK.release()
                    try:                                   # на 1 ГБ VPS память после pandas возвращаем ОС
                        import ctypes
                        import gc
                        gc.collect()
                        ctypes.CDLL("libc.so.6").malloc_trim(0)
                    except Exception:  # noqa: BLE001
                        pass
            _time.sleep(120)
    threading.Thread(target=_job, daemon=True).start()


@app.get("/api/update_status")
def update_status():
    """Когда и чем закончилось последнее полное обновление данных."""
    return _UPDATE_STATUS


def _auto_refresh_market_loop(interval_h: int = 8) -> None:
    """Фоновый цикл: обновляет рыночный снимок MOEX + перцентили спреда каждые
    interval_h часов. Работает сам по себе, пока запущен сервер (systemd),
    без участия пользователя. На старте обновляет, только если снимок устарел."""
    import threading
    import time as _time
    from datetime import datetime, timedelta
    from sqlalchemy import func

    def _job():
        while True:
            db = SessionLocal()
            failed = False
            try:
                newest = db.query(func.max(BondSnapshot.updated_at)).scalar()
                stale = (not newest) or (datetime.utcnow() - newest > timedelta(hours=interval_h))
                if stale:
                    moex.clear_reference_cache()
                    universe.refresh(db)
                    universe.compute_spread_percentiles(db)
                    log.info("auto market refresh done")
            except Exception as e:  # noqa: BLE001
                failed = True
                log.warning("auto market refresh failed: %s", e)
            finally:
                db.close()
            # после сбоя (MOEX недоступна) — повтор через 30 минут, а не через 8 часов
            _time.sleep(1800 if failed else interval_h * 3600)

    threading.Thread(target=_job, daemon=True).start()


_RATINGS_LOCK = __import__("threading").Lock()


def _refresh_stale_ratings(max_age_h: float = 48) -> None:
    """Обновить рейтинги агентств, у которых выгрузка старше `max_age_h` — возраст считается
    ПО КАЖДОМУ агентству (раньше смотрели самую свежую запись любого → АКРА не обновлялась неделями)."""
    from datetime import datetime, timedelta
    from sqlalchemy import func
    from .db import AgencyRating
    if not _RATINGS_LOCK.acquire(blocking=False):
        return                                      # уже идёт обновление
    try:
        s = SessionLocal()
        try:
            ages = dict(s.query(AgencyRating.agency, func.max(AgencyRating.updated_at)).group_by(AgencyRating.agency).all())
            code = {"ACRA": "acra", "EXPERT_RA": "expert", "NKR": "nkr", "NRA": "nra"}
            which = tuple(c for a, c in code.items()
                          if not ages.get(a) or datetime.utcnow() - ages[a] > timedelta(hours=max_age_h))
            if which:
                log.info("ratings refresh: %s", agencies.refresh(s, which=which))
                universe.invalidate_rows_cache()
        finally:
            s.close()
    except Exception as e:  # noqa: BLE001
        log.warning("ratings refresh failed: %s", e)
    finally:
        _RATINGS_LOCK.release()


def _auto_refresh_ratings_if_stale(max_age_h: int = 48) -> None:
    """На старте — в фоне, чтобы не блокировать запуск."""
    import threading
    threading.Thread(target=_refresh_stale_ratings, args=(max_age_h,), daemon=True).start()


def _auto_refresh_ratings_loop() -> None:
    """Ежедневное обновление рейтингов: проверка раз в час; обновляем ночью (02–06 по серверу),
    если выгрузке больше 20 ч, и в любое время — если больше 36 ч (сервер спал ночью)."""
    import threading
    import time as _time
    from datetime import datetime

    def _job():
        while True:
            _time.sleep(3600)
            night = 2 <= datetime.now().hour < 6
            _refresh_stale_ratings(20 if night else 36)
    threading.Thread(target=_job, daemon=True).start()


# --------------------------------------------------------------------------- #
# Portfolio
# --------------------------------------------------------------------------- #
@app.post("/api/portfolio/import", dependencies=[Depends(require_admin)])
async def import_portfolio(file: UploadFile, db: Session = Depends(get_db)):
    dest = _save_upload(file)
    try:
        pf = pipeline.load_portfolio(db, str(dest), name=Path(file.filename).stem)
    except ValueError as e:                       # лимиты импорта / неверный формат — текст для пользователя
        raise HTTPException(400, str(e))
    except Exception as e:  # noqa: BLE001
        log.warning("portfolio import failed: %s", e)
        raise HTTPException(400, "Не удалось разобрать файл портфеля")
    return {"portfolio_id": pf.id, "dashboard": pipeline.build_dashboard(db, pf.id)}


@app.post("/api/portfolio/demo")
def load_demo(db: Session = Depends(get_db)):
    sample = UPLOAD_DIR / "sample_portfolio.xlsx"
    if not sample.exists():
        raise HTTPException(404, "sample_portfolio.xlsx not found — run scripts/make_sample.py")
    pf = pipeline.load_portfolio(db, str(sample), name="Демо-портфель")
    return {"portfolio_id": pf.id}


@app.get("/api/clients")
def list_clients(db: Session = Depends(get_db)):
    """Multi-client workspace: all clients + which is active."""
    from sqlalchemy import select
    from .db import Client
    cs = db.scalars(select(Client).order_by(Client.id)).all()
    if not cs:
        pipeline.active_client(db)
        cs = db.scalars(select(Client).order_by(Client.id)).all()
    return {"active": next((c.id for c in cs if c.is_active), None),
            "clients": [{"id": c.id, "name": c.name, "active": bool(c.is_active),
                         "portfolios": len(c.portfolios)} for c in cs]}


@app.get("/api/clients/summary")
def clients_summary(db: Session = Depends(get_db)):
    """Aggregate ALL clients' latest portfolios: total AUM, top issues, top issuers,
    weighted YTM/duration — the 'assets under management' overview."""
    from sqlalchemy import select
    from collections import defaultdict
    from .db import BondSnapshot, Client, Portfolio
    from .services import ratings
    clients = db.scalars(select(Client).order_by(Client.id)).all()
    snaps = {s.isin: s for s in db.scalars(select(BondSnapshot)).all()}
    total_mv = 0.0
    per_client, all_pos = [], []
    wy = wyd = wd = wdd = 0.0
    # эффективная доходность: флоатеры → текущая доходность, фиксы → YTM
    # (единая формула со взвешенным YTM в portfolio_summary и разбивкой по валютам)
    def _eff(p):
        return p.get("current_yield") if p.get("is_float") else p.get("ytm")
    for c in clients:
        pfs = db.scalars(select(Portfolio).where(Portfolio.client_id == c.id).order_by(Portfolio.id)).all()
        if not pfs:
            per_client.append({"id": c.id, "name": c.name, "market_value": 0, "positions": 0, "ytm": None})
            continue
        d = pipeline.build_dashboard(db, [p.id for p in pfs])   # ВСЕ портфели клиента
        mv = d["summary"].get("market_value") or 0.0
        total_mv += mv
        per_client.append({"id": c.id, "name": c.name, "market_value": round(mv),
                           "positions": len(d["positions"]), "ytm": d["summary"].get("ytm")})
        for p in d["positions"]:
            pmv = p.get("market_value") or 0.0
            all_pos.append({**p, "client": c.name})
            # верхние KPI — общие по всем валютам; разбивка по валютам — в таблице ниже
            _e = _eff(p)
            if _e and pmv:
                wy += pmv * _e; wyd += pmv
            if p.get("duration_years") and pmv:
                wd += pmv * p["duration_years"]; wdd += pmv
    # top by issue — суммируем один выпуск (ISIN) по всем клиентам (только облигации)
    bond_pos = [p for p in all_pos if p.get("is_bond") is not False]
    by_issue: dict = {}
    for p in bond_pos:
        mv = p.get("market_value") or 0.0
        e = by_issue.setdefault(p["isin"], {"name": p["name"], "isin": p["isin"],
                                            "mv": 0.0, "wy": 0.0, "wyd": 0.0, "rating": p.get("rating"),
                                            "holders": {}})
        e["mv"] += mv
        _e = _eff(p)
        if _e and mv:
            e["wy"] += mv * _e; e["wyd"] += mv
        # у какого клиента сколько бумаг (для подсказки при наведении)
        q = (p.get("open_quantity") or p.get("quantity") or 0)
        if q:
            e["holders"][p["client"]] = e["holders"].get(p["client"], 0) + q
    top_issues = sorted(by_issue.values(), key=lambda x: x["mv"], reverse=True)[:10]
    top_issues = [{"name": e["name"], "isin": e["isin"],
                   "market_value": round(e["mv"]),
                   "share": round(100 * e["mv"] / total_mv, 1) if total_mv else 0,
                   "ytm": round(e["wy"] / e["wyd"], 2) if e["wyd"] else None,
                   "rating": e["rating"],
                   "holders": sorted(({"client": k, "quantity": round(v)} for k, v in e["holders"].items()),
                                     key=lambda x: -x["quantity"])} for e in top_issues]
    # top by issuer — группируем по ЭМИТЕНТУ (все его выпуски вместе), имя чистим от
    # организационной формы и серии, приоритет — короткое юр. название эмитента с биржи (без серии)
    from .db import BondRating
    import re as _re
    brt = {r.isin: r for r in db.scalars(select(BondRating)).all()}

    def _clean_issuer(nm: str) -> str:
        if not nm:
            return nm
        n = nm.split(",")[0]
        n = _re.sub(r'["«»]', '', n)
        n = _re.sub(r'\b(АО|ООО|ПАО|ОАО|ЗАО|ПК|МКПАО|МКООО|ХК|НАО)\b', '', n, flags=_re.I)
        n = _re.sub(r'\s+(БО|ЗО|БЗО)?[-\s]?(00)?[0-9][ПP]?[-\s0-9А-ЯA-Z]*$', '', n)  # хвост-серия
        return _re.sub(r'\s+', ' ', n).strip() or nm.strip()

    by_issuer: dict = {}
    for p in bond_pos:
        b = brt.get(p["isin"]); s = snaps.get(p["isin"])
        raw = (b.issuer if b else None) or (s.issuer_full if s else None) or p.get("name")
        nm = _clean_issuer(raw)
        k = ratings.issuer_key(raw) or p["isin"]
        e = by_issuer.setdefault(k, {"name": nm, "mv": 0.0})
        e["mv"] += p.get("market_value") or 0.0
    top_issuers = sorted(by_issuer.values(), key=lambda x: x["mv"], reverse=True)[:10]
    top_issuers = [{"name": e["name"], "market_value": round(e["mv"]),
                    "share": round(100 * e["mv"] / total_mv, 1) if total_mv else 0} for e in top_issuers]
    # breakdown by currency of denomination (RUB / USD / CNY / EUR…), value in RUB
    from .services import analytics
    _rub = {None, "", "RUB", "SUR", "RUR"}
    by_ccy: dict = {}
    ccy_rows: dict = {}
    for p in all_pos:
        pmv = p.get("market_value") or 0.0
        ck = p.get("currency") or "RUB"
        if ck in _rub:
            ck = "RUB"
        ccy_rows.setdefault(ck, []).append(p)
        e = by_ccy.setdefault(ck, {"mv": 0.0, "n": 0, "wy": 0.0, "wyd": 0.0, "wd": 0.0, "wdd": 0.0})
        e["mv"] += pmv; e["n"] += 1
        _e = _eff(p)
        if _e and pmv:
            e["wy"] += pmv * _e; e["wyd"] += pmv
        if p.get("duration_years") and pmv:
            e["wd"] += pmv * p["duration_years"]; e["wdd"] += pmv

    def _ccy_row(k, v):
        st = analytics.structure_breakdowns(ccy_rows.get(k, []))   # разбивка по рейтингу/сроку для окна
        return {"currency": k, "market_value": round(v["mv"]), "positions": v["n"],
                "share": round(100 * v["mv"] / total_mv, 1) if total_mv else 0,
                "ytm": round(v["wy"] / v["wyd"], 2) if v["wyd"] else None,
                "duration": round(v["wd"] / v["wdd"], 2) if v["wdd"] else None,
                "by_rating": st["by_rating"], "by_maturity": st["by_maturity"]}
    currencies = sorted((_ccy_row(k, v) for k, v in by_ccy.items()),
                        key=lambda x: x["market_value"], reverse=True)

    # аллокация по классам активов (акции / облигации / фонды) и по типам облигаций,
    # с составом бумаг в каждом сегменте (для подсказки при наведении на диаграмму)
    alloc: dict = defaultdict(float)
    instr: dict = defaultdict(float)
    alloc_items: dict = defaultdict(lambda: defaultdict(lambda: {"name": "", "mv": 0.0}))
    instr_items: dict = defaultdict(lambda: defaultdict(lambda: {"name": "", "mv": 0.0}))

    def _add(items, seg, p, mv):
        e = items[seg][p.get("isin") or p.get("name")]
        e["name"] = p.get("name"); e["mv"] += mv

    for p in all_pos:
        mv = p.get("market_value") or 0.0
        if not mv:
            continue
        if p.get("is_bond") is False:
            seg = "Фонды" if p.get("kind") == "fund" else "Акции"
            alloc[seg] += mv; _add(alloc_items, seg, p, mv)
            continue
        alloc["Облигации"] += mv; _add(alloc_items, "Облигации", p, mv)
        ccy = (p.get("currency") or "RUB").upper()
        nm = (p.get("name") or "").upper()
        if ccy not in ("RUB", "SUR", "RUR"):
            seg = "Валютные"
        elif nm.startswith("ОФЗ") or nm.startswith("РФ ") or nm.startswith("ГОСОБЛ"):
            seg = "ОФЗ"
        elif p.get("is_float"):
            seg = "Корп. флоатеры"
        else:
            seg = "Корп. фикс"
        instr[seg] += mv; _add(instr_items, seg, p, mv)

    def _slices(d, items):
        tot = sum(d.values()) or 1.0
        out = []
        for k, v in sorted(d.items(), key=lambda x: -x[1]):
            top = sorted(items.get(k, {}).values(), key=lambda x: -x["mv"])[:8]
            out.append({"name": k, "value": round(v), "share": round(100 * v / tot, 1),
                        "items": [{"name": it["name"], "value": round(it["mv"])} for it in top]})
        return out

    return {
        "total_aum": round(total_mv), "n_clients": len(clients),
        "n_positions": len(all_pos), "n_issuers": len(by_issuer),
        "weighted_ytm": round(wy / wyd, 2) if wyd else None,
        "weighted_duration": round(wd / wdd, 2) if wdd else None,
        "clients": sorted(per_client, key=lambda x: x["market_value"], reverse=True),
        "top_issues": top_issues, "top_issuers": top_issuers, "currencies": currencies,
        "allocation": _slices(alloc, alloc_items), "by_instrument": _slices(instr, instr_items),
    }


@app.post("/api/clients")
def create_client(payload: dict = Body(...), db: Session = Depends(get_db)):
    from sqlalchemy import select
    from .db import Client
    for c in db.scalars(select(Client)).all():
        c.is_active = False
    c = Client(name=(payload.get("name") or "Новый клиент").strip()[:80], role="client", is_active=True)
    db.add(c)
    db.commit()
    return {"id": c.id, "name": c.name}


@app.delete("/api/clients/{cid}")
def delete_client(cid: int, db: Session = Depends(get_db)):
    """Delete a client with all their portfolios and positions (cascade)."""
    from sqlalchemy import select
    from .db import Client
    c = db.get(Client, cid)
    if not c:
        raise HTTPException(404, "нет такого клиента")
    was_active = c.is_active
    db.delete(c)
    db.commit()
    if was_active:                         # переносим активность на последнего оставшегося
        nxt = db.scalar(select(Client).order_by(Client.id.desc()).limit(1))
        if nxt:
            nxt.is_active = True
            db.commit()
    return {"ok": True}


@app.post("/api/clients/{cid}/activate")
def activate_client(cid: int, db: Session = Depends(get_db)):
    from sqlalchemy import select
    from .db import Client
    found = False
    for c in db.scalars(select(Client)).all():
        c.is_active = (c.id == cid)
        found = found or c.id == cid
    db.commit()
    if not found:
        raise HTTPException(404, "нет такого клиента")
    return {"ok": True}


@app.get("/api/portfolios")
def portfolios_list(db: Session = Depends(get_db)):
    """Portfolios of the active client for the picker (name, #positions, market value)."""
    return {"portfolios": pipeline.list_portfolios(db)}


@app.post("/api/portfolios")
def portfolio_create(payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """Create an empty portfolio for the active client."""
    pf = pipeline.create_portfolio(db, (payload.get("name") or "Новый портфель").strip(), payload.get("cash"))
    return {"id": pf.id, "name": pf.name}


@app.delete("/api/portfolios/{pid}")
def portfolio_delete(pid: int, db: Session = Depends(get_db)):
    if not pipeline.delete_portfolio(db, pid):
        raise HTTPException(404, "portfolio not found")
    return {"ok": True}


@app.post("/api/portfolios/{pid}/rename")
def portfolio_rename(pid: int, payload: dict = Body(...), db: Session = Depends(get_db)):
    if not pipeline.rename_portfolio(db, pid, payload.get("name") or ""):
        raise HTTPException(400, "bad name or portfolio not found")
    return {"ok": True}


@app.get("/api/portfolio/current")
def current(pid: str | None = None, ccy: str | None = None, db: Session = Depends(get_db)):
    ids = pipeline.resolve_pids(db, pid)
    if not ids:
        return JSONResponse({"empty": True})
    return pipeline.build_dashboard(db, ids, ccy)


@app.get("/api/issuers/credit")
def issuers_credit(db: Session = Depends(get_db)):
    """Credit metrics (ND/EBITDA, ICR, margins, ROE…) for bond issuers matched to
    audited IFRS/RAS fundamentals from the RU Equity Terminal."""
    from .services import issuer_fundamentals
    return issuer_fundamentals.credit_table(db)


@app.get("/api/issuers/credit/{q}")
def issuer_credit_detail(q: str):
    """Full credit profile of one issuer: statements, ratios, trends."""
    from .services import issuer_fundamentals
    return issuer_fundamentals.issuer_detail(q)


@app.get("/api/rating_actions")
def rating_actions(limit: int = 120, db: Session = Depends(get_db)):
    """Лента рейтинговых действий: последнее действие по каждому эмитенту
    (АКРА — направление ↑/↓ + дата; НКР — дата; Эксперт РА — через verified-снапшот),
    отсортировано по дате. `tradable` — есть ли у эмитента торгуемые облигации."""
    import re as _re
    from .db import AgencyRating
    from .services.agencies import normalize_name
    from datetime import datetime as _dt, date as _date
    _RUM = {"янв": 1, "фев": 2, "мар": 3, "апр": 4, "май": 5, "мая": 5, "июн": 6,
            "июл": 7, "авг": 8, "сен": 9, "окт": 10, "ноя": 11, "дек": 12}
    tradable = set()
    try:
        for r in universe._all_rows(db):
            nm = r.get("issuer") or r.get("issuer_full")
            k = normalize_name(nm) if nm else None
            if k:
                tradable.add(k)
    except Exception:  # noqa: BLE001
        pass

    def pdate(s):
        if not s:
            return None
        s = str(s).strip()
        for f in ("%d.%m.%Y", "%Y-%m-%d"):
            try:
                return _dt.strptime(s[:10], f).date()
            except ValueError:
                pass
        m = _re.match(r"(\d{1,2})\s+([а-яё]+)\.?\s+(\d{4})", s.lower())  # «19 авг 2026»
        if m:
            mo = _RUM.get(m.group(2)[:3])
            if mo:
                try:
                    return _date(int(m.group(3)), mo, int(m.group(1)))
                except ValueError:
                    return None
        return None

    out = []
    for r in db.query(AgencyRating).filter(AgencyRating.action_date.isnot(None)).all():
        if r.rating_type in ("issue", "sf"):
            continue                    # лента — по эмитентам; рейтинги выпусков — в карточке бумаги
        d = pdate(r.action_date)
        if not d:
            continue
        act = (r.action or "").lower()
        direction = ("up" if "повыш" in act else "down" if "пониж" in act
                     else "new" if ("присво" in act or "нов" in act) else "hold" if "подтвер" in act else "")
        out.append({"issuer": r.issuer_raw or r.issuer_norm, "agency": r.agency,
                    "rating": r.rating, "bucket": r.rating_bucket, "forecast": r.forecast,
                    "action": r.action, "direction": direction, "date": d.isoformat(),
                    "tradable": bool(r.eid) or bool(r.issuer_norm and r.issuer_norm in tradable)})
    out.sort(key=lambda x: x["date"], reverse=True)
    return {"actions": out[:limit], "total": len(out)}


def _with_timeline(lst: list[dict]) -> list[dict]:
    """К рейтингам по агентствам добавить историю эмитента (со страниц агентств, кэш на диске)
    и «было» — последний НАСТОЯЩИЙ рейтинг до текущего, отличный от него (отзыв рейтингом не считается)."""
    from .services.ratings import normalize_rating as _nr
    hist_cache = agencies._load_hist()
    sc = lambda r: _nr(agencies._EXP_PREFIX.sub("", r or ""))[1]          # noqa: E731
    for a in lst:
        tl = agencies.timeline(a["agency"], a.get("issuer_aid"), a.get("action_date"), hist=hist_cache)
        cur_r, cur_d = (a.get("issuer_rating") or a.get("rating")), a.get("action_date")
        pts = [x for x in tl if x[0]]
        if cur_r and cur_d and (not pts or pts[-1][0] < cur_d or pts[-1][1] != cur_r):
            pts.append([cur_d, cur_r, a.get("issuer_forecast") or a.get("forecast"), a.get("action")])
        # отзыв/пустые значения — score None: на графике это разрыв линии. Старая шкала Эксперт РА
        # (до 2017) — шестое поле "old" и приблизительный эквивалент на новой лестнице (седьмое поле)
        def _row(x):
            if len(x) > 4 and x[4] == "old":
                eq = agencies.old_expert_equiv(x[1])
                return [x[0], x[1], sc(eq) if eq else None, x[2], x[3], "old", eq]
            return [x[0], x[1], sc(x[1]), x[2], x[3], "", None]
        a["timeline"] = [_row(x) for x in sorted(pts, key=lambda y: y[0])]
        pts = [x for x in sorted(pts, key=lambda y: y[0]) if not (len(x) > 4 and x[4] == "old")]   # «было» — только новая шкала
        real = [x for x in pts if sc(x[1]) is not None]
        a.pop("prev_date", None)
        if real and cur_r:
            prev = next((x for x in reversed(real) if x[1] != cur_r and x[0] <= (cur_d or "9999")), None)
            if prev:
                a["prev_rating"], a["prev_date"] = prev[1], prev[0]
                s_now, s_prev = sc(cur_r), sc(prev[1])
                if s_now is not None and s_prev is not None and s_now != s_prev:
                    a["trend"] = "up" if s_now > s_prev else "down"
            else:
                a["prev_rating"] = None
                if a.get("trend") and not any(x[1] != cur_r for x in real):
                    a["trend"] = None          # после отзыва и нового присвоения — не «повышение»
    agencies._save_hist(hist_cache)
    return lst


@app.get("/api/ratings/emitent/{eid}")
def emitent_ratings(eid: str, db: Session = Depends(get_db)):
    """Рейтинги эмитента MOEX (emitent_id) по агентствам с историей — для графика на странице эмитента."""
    idx = agencies.ratings_map(db)
    lst, how = agencies.for_bond(idx, None, eid)
    clean = lambda a: {k: v for k, v in a.items() if k not in ("eids",)}     # noqa: E731
    return {"emitent_id": eid, "match": how or None, "agencies": [clean(a) for a in _with_timeline(lst)]}


@app.get("/api/bonds/{isin}/ratings")
def bond_ratings(isin: str, db: Session = Depends(get_db)):
    """Рейтинги выпуска по агентствам: рейтинг эмитента и рейтинг выпуска (если есть), прогноз,
    дата и направление последнего действия, худший (показываемый) рейтинг и история действий."""
    from .db import BondSnapshot as _BS
    snap = db.get(_BS, isin.strip().upper())
    if not snap:
        raise HTTPException(404, "Нет такого выпуска в снимке рынка")
    idx = agencies.ratings_map(db)
    # Exactly the same canonical eid + normalized issuer-name fallbacks as in
    # the screener.  Otherwise a rating could disappear after opening a bond.
    lst, how = universe.agency_ratings_for_snapshot(db, snap, idx)
    worst = agencies.best_for(lst) if lst else None
    subj = set()
    for a in lst:
        subj.add((a["agency"], agencies.subject_of(a)))
        if a.get("level") == "issue":                       # и рейтинг эмитента того же агентства
            for e in (idx.by_eid.get(str(snap.emitent_id)) or []) if snap.emitent_id else []:
                if e["agency"] == a["agency"]:
                    subj.add((e["agency"], agencies.subject_of(e)))
    subj.add(("ACRA", "isin:" + snap.isin)); subj.add(("EXPERT_RA", "isin:" + snap.isin)); subj.add(("NRA", "isin:" + snap.isin))
    clean = lambda a: {k: v for k, v in a.items() if k not in ("eids",)}     # noqa: E731
    _with_timeline(lst)
    return {"isin": snap.isin, "emitent_id": snap.emitent_id, "inn": snap.emitent_inn, "match": how or None,
            "worst": clean(worst) if worst else None, "agencies": [clean(a) for a in lst],
            "history": agencies.history(db, sorted(subj))}


@app.get("/api/reports/portfolio.xlsx")
def report_portfolio_xlsx(pid: str | None = None, ccy: str | None = None, db: Session = Depends(get_db)):
    """Download the current portfolio as an Excel workbook."""
    from fastapi.responses import Response
    from .services import excel_report
    ids = pipeline.resolve_pids(db, pid)
    if not ids:
        raise HTTPException(404, "no portfolio")
    dash = pipeline.build_dashboard(db, ids, ccy)
    events = pipeline.bond_cashflow_schedule(db, ids)     # полный график купонов/погашений
    data = excel_report.build_workbook(dash, events)
    return Response(content=data,
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="portfolio.xlsx"'})


@app.post("/api/portfolio/cashflows_scenario")
def portfolio_cashflows_scenario(payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """Portfolio cash-flow calendar with floater coupons projected from a CBR
    key-rate path {rate_path:[{date,rate}]}."""
    ids = pipeline.resolve_pids(db, payload.get("pid"))
    if not ids:
        raise HTTPException(404, "no portfolio")
    from .services import portfolio_cashflows
    return portfolio_cashflows.cashflows_scenario(db, ids, payload.get("rate_path") or [], payload.get("ccy"))


@app.get("/api/portfolio/performance")
def portfolio_performance(pid: str | None = None, ccy: str | None = None, db: Session = Depends(get_db)):
    """TWR (linked Modified Dietz) + MWR (XIRR) + RGBITR benchmark & alpha."""
    ids = pipeline.resolve_pids(db, pid)
    if not ids:
        raise HTTPException(404, "no portfolio")
    from .services import portfolio_perf
    return portfolio_perf.performance(db, ids, ccy)


@app.post("/api/portfolio/stress")
def portfolio_stress(payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """Re-run the factor-decomposed stress on the current portfolio with a custom
    shock vector {rate_shock_bp, credit_shock_bp, fx_shock_pct,
    largest_issuer_haircut_pct, rating_haircuts:{bucket:pct}}."""
    ids = pipeline.resolve_pids(db, payload.get("pid"))
    if not ids:
        raise HTTPException(404, "no portfolio")
    d = pipeline.build_dashboard(db, ids)
    from .services import portfolio_risk
    return portfolio_risk.stress(d["positions"], payload or {})


# ----- Portfolio builder ----- #
@app.post("/api/builder/quote")
def builder_quote(payload: dict = Body(...)):
    """Price one prospective purchase on its date (ISIN, date, quantity)."""
    isin, dt = payload.get("isin"), payload.get("date")
    if not isin or not dt:
        raise HTTPException(400, "нужны isin и date")
    return pipeline.quote_on_date(isin, dt, float(payload.get("quantity") or 0))


@app.post("/api/portfolio/build")
def build(payload: dict = Body(...), db: Session = Depends(get_db)):
    """Commit a portfolio built in the UI: {cash, name?, positions:[{isin,date,quantity}]}."""
    items = [{"isin": p["isin"], "buy_date": p.get("date") or p.get("buy_date"),
              "quantity": p.get("quantity"), "side": p.get("side") or "buy",
              "clean_price": p.get("clean_price")} for p in payload.get("positions", [])]
    pf = pipeline.build_portfolio(db, float(payload.get("cash") or 0), items,
                                  name=payload.get("name") or "Портфель инвестора")
    return {"portfolio_id": pf.id, "dashboard": pipeline.build_dashboard(db, pf.id)}


@app.get("/api/portfolio/current/timeseries")
def timeseries(pid: str | None = None, ccy: str | None = None, db: Session = Depends(get_db)):
    ids = pipeline.resolve_pids(db, pid)
    if not ids:
        return {"dates": [], "values": []}
    return pipeline.build_timeseries(db, ids, ccy)


@app.post("/api/portfolio/{pid}/refresh")
def refresh(pid: int, db: Session = Depends(get_db)):
    return pipeline.refresh_moex(db, pid)


# --------------------------------------------------------------------------- #
# MOEX passthrough (bond card charts)
# --------------------------------------------------------------------------- #
@app.get("/api/moex/quote/{isin}")
def quote(isin: str):
    ref = moex.resolve_security(isin)
    return {"ref": ref, "quote": moex.get_current_quote(isin, ref["board"])}


@app.get("/api/moex/history/{isin}")
def history(isin: str, frm: str = HISTORY_FROM, till: str | None = None):
    ref = moex.resolve_security(isin)
    return moex.get_price_history(isin, ref["board"], frm, till or _today())


@app.get("/api/moex/yields/{isin}")
def yields(isin: str, frm: str = HISTORY_FROM, till: str | None = None):
    ref = moex.resolve_security(isin)
    return moex.get_yield_history(isin, ref["board"], frm, till or _today())


@app.get("/api/moex/candles/{isin}")
def candles(isin: str, frm: str = HISTORY_FROM, till: str | None = None, interval: int = 24):
    ref = moex.resolve_security(isin)
    return moex.get_candles(isin, ref["board"], frm, till or _today(), interval)


@app.get("/api/moex/board/{board}/securities")
def board_securities(board: str):
    import re as _re
    if not _re.fullmatch(r"[A-Z0-9]{2,8}", board or ""):
        raise HTTPException(400, "Неверный код доски")
    return moex.get_board_securities(board)


def _today() -> str:
    from datetime import date
    return date.today().isoformat()


# --------------------------------------------------------------------------- #
# Instrument analytics / screener (fix vs float, G-spread, simple margin)
# --------------------------------------------------------------------------- #
@app.get("/api/model/emission")
def model_emission(coupon: float, freq: int = 2, years: float = 3.0, price: float = 100.0):
    """Model a new issue: coupon → YTM (IRR at par), duration. No network."""
    return instrument.model_emission(coupon, frequency=freq, years=years, price_pct=price)


@app.get("/api/model/coupon")
def model_coupon(ytm: float, freq: int = 2, years: float = 3.0, price: float = 100.0):
    """Inverse: target YTM (e.g. from a target G-spread) → required coupon."""
    return instrument.coupon_for_ytm(ytm, frequency=freq, years=years, price_pct=price)


@app.get("/api/cbr_meetings")
def cbr_meetings(years: int = 3):
    """Default CBR key-rate path over the next `years`: ~8 meetings a year
    (Feb, Mar, Apr, Jun, Jul, Sep, Oct, Dec), seeded with the current short-rate
    proxy (КБД front). Covers long floaters. The user edits each rate."""
    from datetime import date
    today = date.today()
    # Seed with the actual current CBR key rate (not the КБД short end, which is a
    # market yield, not the policy rate). Fall back to the curve front if offline.
    cur = instrument.cbr_key_rate()
    if cur is None:
        curve = instrument.gcurve()
        cur = round(curve["tenors"][0]["yield_pct"], 1) if curve.get("tenors") else 16.0
    months = [(2, 14), (3, 20), (4, 25), (6, 6), (7, 25), (9, 12), (10, 24), (12, 19)]
    path = [{"date": today.isoformat(), "rate": cur, "label": "сейчас"}]
    for y in range(today.year, today.year + years + 1):
        for m, dd in months:
            d = date(y, m, dd)
            if d > today and (d - today).days <= years * 366:
                path.append({"date": d.isoformat(), "rate": cur})
    return {"current": cur, "path": path}


@app.post("/api/model/floater_scenario")
def model_floater_scenario(payload: dict = Body(...), db: Session = Depends(get_db)):
    """Scenario YTM for a floater given a CBR key-rate path.
    Body: {isin, price, rate_path:[{date,rate}]}."""
    isin = payload.get("isin"); price = payload.get("price")
    rate_path = payload.get("rate_path") or []
    if not isin or price is None:
        raise HTTPException(400, "isin and price required")
    import math
    try:
        price = float(price)
        if not math.isfinite(price) or price <= 0:
            raise ValueError()
    except (TypeError, ValueError):
        raise HTTPException(400, "price must be a finite positive clean price")
    snap = db.get(BondSnapshot, isin)
    rt = db.get(BondRating, isin)
    qm = (rt.float_add if rt else None)
    if universe.float_index_of(isin, rt) != "CBR_RATE":
        return {"ytm": None, "reason": "scenario_requires_confirmed_CBR_RATE_index"}
    accint = (snap.accint if snap else 0.0) or 0.0
    try:
        res = instrument.floater_scenario_ytm(isin, float(price), rate_path, qm, accint)
    except moex.MoexError as e:
        raise HTTPException(502, "Источник данных временно недоступен")
    if not res:
        return {"ytm": None}
    # Under the scenario the floater has a full projected cash flow → a real YTM,
    # so a G-spread (to КБД) and spread-to-OFZ become meaningful too. Measure both
    # at the scenario cash-flow duration, consistent with the plotted scenario.
    y = res.get("ytm")
    tenor = res.get("duration")
    if y is not None and tenor:
        try:
            g_at = instrument.gcurve_yield(tenor, instrument.gcurve())
            if g_at is not None:
                res["gspread"] = round((y - g_at) * 100)
            ref_ofz = instrument.nearest_ofz(tenor, instrument.ofz_benchmarks())
            if ref_ofz:
                res["ofz"] = round((y - ref_ofz["ytm"]) * 100)
        except Exception:  # noqa: BLE001 — spreads are best-effort extras
            pass
    return res


@app.get("/api/instrument/gcurve")
def gcurve():
    """MOEX zero-coupon government yield curve (КБД) for charting."""
    return instrument.gcurve()


@app.get("/api/instrument/{isin}")
def instrument_one(isin: str, base_rate: float | None = None):
    """Full analytics for one ISIN. `base_rate` (%) = floater reference rate."""
    try:
        return instrument.analyze(isin, base_rate=base_rate)
    except moex.MoexError as e:
        raise HTTPException(404, str(e))


@app.post("/api/instrument/screen")
def instrument_screen(payload: dict = Body(...)):
    """Screen many bonds: {isins:[...], base_rate?:float}."""
    isins = [str(x).strip().upper() for x in payload.get("isins", []) if str(x).strip()]
    if not isins:
        raise HTTPException(400, "isins is empty")
    base_rate = payload.get("base_rate")
    return instrument.screen(isins, base_rate=float(base_rate) if base_rate not in (None, "") else None)


# --------------------------------------------------------------------------- #
# Universe / screener / market map (reads from the cached snapshot)
# --------------------------------------------------------------------------- #
def _split(v: str | None) -> list[str] | None:
    return [x.strip() for x in v.split(",") if x.strip()] if v else None


@app.post("/api/universe/refresh", dependencies=[Depends(require_admin)])
def universe_refresh(payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """Обновление рыночного снимка из MOEX.
    Лёгкое (по умолчанию): только снимок цен/доходностей/спредов (~9с, влезает в
    таймаут shared-хостинга). Тяжёлое (full=true): снимок + перцентили спреда по
    истории (~1 мин) — считается СИНХРОННО, чтобы ответ пришёл после полного расчёта
    (а не фоновым потоком, который под Passenger блокирует SQLite)."""
    moex.clear_reference_cache()   # ручное обновление рынка → тянем свежий reference/купоны
    boards = tuple(payload.get("boards") or universe.DEFAULT_BOARDS)
    res = universe.refresh(db, boards=boards)
    if payload.get("full"):
        try:
            res["pctl"] = universe.compute_spread_percentiles(db)
        except Exception as e:  # noqa: BLE001
            log.warning("percentiles compute failed: %s", e)
    return res


@app.post("/api/universe/backfill_turnover", dependencies=[Depends(require_admin)])
def universe_backfill_turnover(payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """Разовый бэкфилл среднего оборота за ~21 торговую сессию из истории MOEX (тяжёлый,
    сотни запросов, ~5-7 мин). Дальше среднее копится инкрементально при обычном обновлении."""
    return universe.backfill_turnover(db, sessions=int(payload.get("sessions", 21)))


@app.get("/api/universe")
def universe_query(
    boards: str | None = None, kinds: str | None = None, rating: str | None = None,
    sectors: str | None = None, currencies: str | None = None, liq: str | None = None,
    ytm_min: float | None = None, ytm_max: float | None = None,
    cy_min: float | None = None, cy_max: float | None = None,
    dur_min: float | None = None, dur_max: float | None = None,
    vol_min: float | None = None, vol_max: float | None = None, search: str | None = None,
    clean: bool = False, coupon_freq: str | None = None, has_offer: bool = False, amort: bool = False,
    sort: str = "ytm", desc: bool = True, limit: int = 300, isins: str | None = None,
    db: Session = Depends(get_db),
):
    """Screener query over the cached universe. List params are comma-separated.
    clean=true hides negative/absurd-yield & off-par-price names (default screen).
    vol_min/vol_max — оборот за день (руб); coupon_freq — список частот (12/4/2/1)."""
    return fast_json(universe.query(
        db, boards=_split(boards), kinds=_split(kinds), rating_buckets=_split(rating),
        sectors=_split(sectors), currencies=_split(currencies), liq=_split(liq),
        ytm_min=ytm_min, ytm_max=ytm_max, dur_min=dur_min, dur_max=dur_max,
        cy_min=cy_min, cy_max=cy_max,
        vol_min=vol_min, vol_max=vol_max, search=search, clean=clean, coupon_freq=_split(coupon_freq),
        has_offer=has_offer, amort=amort, sort=sort, desc=desc, limit=min(max(limit, 1), 5000),
        isins=_split(isins)[:500] if isins else None,
    ))


# ── готовые ответы секторов ──
# Отчётность в секторах статична, меняется только рыночная часть — а она обновляется вместе
# со снимком рынка (раз в 30 минут днём). Пересчитывать сектор на каждый запрос незачем:
# это 3–60 секунд. Держим готовый ответ, пока не сменился снимок; когда сменился — сразу
# отдаём прошлый ответ, а новый считаем в фоне. После каждого обновления рынка и на старте
# секторы прогреваются заранее, так что посетитель ждать не должен никогда.
import threading as _thr

_SECTOR_RESP: dict = {}                                            # key → (sig, ответ)
_SECTOR_LOCKS = {k: _thr.Lock() for k in ("developers", "leasing", "subfed", "utilities", "retail")}


def _sector_builders() -> dict:
    from .services import sector_corp as sc, sector_leasing as sl, sector_subfed as ss, sectors
    return {"developers": sectors.developers, "leasing": sl.leasing, "subfed": ss.subfed,
            "utilities": lambda db: sc.build(db, "utilities"), "retail": lambda db: sc.build(db, "retail")}


def _market_sig(db: Session) -> tuple:
    from sqlalchemy import func
    cnt, upd = db.query(func.count(BondSnapshot.isin), func.max(BondSnapshot.updated_at)).first()
    return (cnt, upd.isoformat() if upd else None, _DATA_GEN[0])


def _build_sector(key: str) -> None:
    """Посчитать сектор и положить в кэш; второй одновременный запуск просто пропускается."""
    lock = _SECTOR_LOCKS[key]
    if not lock.acquire(blocking=False):
        return
    db = SessionLocal()
    try:
        sig = _market_sig(db)
        hit = _SECTOR_RESP.get(key)
        if hit and hit[0] == sig:
            return
        _SECTOR_RESP[key] = (sig, _sector_builders()[key](db))
    except Exception as e:  # noqa: BLE001 — прошлый ответ остаётся
        log.warning("sector %s build failed: %s", key, e)
    finally:
        db.close()
        lock.release()


# адреса, которые сайт запрашивает при открытии вкладок (сняты из браузера): после обновления
# рынка сервер сам запрашивает их у себя, и в кэше уже лежат готовые ответы к приходу посетителя
_WARM_URLS = (
    "/api/universe/facets",
    "/api/universe?currencies=RUB&clean=true&sort=volume&desc=true&limit=300",
    "/api/universe?limit=4000&sort=ytm&desc=true&currencies=RUB&kinds=fixed&clean=true",
    "/api/universe?sectors=%D0%93%D0%BE%D1%81%D0%B1%D1%83%D0%BC%D0%B0%D0%B3%D0%B8%20%D0%B8%20%D1%80%D0%B5%D0%B3%D0%B8%D0%BE%D0%BD%D1%8B&kinds=fixed&clean=true&limit=200",
    "/api/movers?limit=25&min_turnover=1000000",
    "/api/ideas?limit=150&min_turnover=1000000",
    "/api/rating_curves", "/api/rating_curves/history", "/api/auctions", "/api/ofz_curve", "/api/macro",
    "/api/bond_indices?group=fixed&period=1y", "/api/bond_indices?group=floaters&period=1y",
    "/api/equity_indices?group=main&period=1y", "/api/equity_indices?group=sectors&period=1y",
    "/api/sector/developers", "/api/sector/leasing", "/api/sector/subfed",
    "/api/sector/utilities", "/api/sector/retail", "/api/sector_index",
)


def _warm_http() -> None:
    import urllib.request
    port = os.environ.get("PORT", "8010")
    for u in _WARM_URLS:
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{port}{u}", headers={"Accept-Encoding": "gzip"})
            urllib.request.urlopen(req, timeout=120).read()
        except Exception as e:  # noqa: BLE001 — прогрев необязателен
            log.info("warm %s: %s", u, e)


def warm_sectors() -> None:
    """Прогреть секторы и готовые ответы главных вкладок в фоне (после обновления рынка и на старте)."""
    def _job():
        # z-спред: графики выплат всего рынка (раз в день) и индексы флоатеров без данных dohod —
        # до сборки секторов, чтобы кривые секторов уже пришли с z
        # справочник облигаций — биржа и ФНС (с dohod.ru — только даты коллов и названия эмитентов): графики выплат и
        # оферты всего рынка раз в день, затем пересборка bond_ratings (эмитент, отрасль, индекс
        # и маржа флоатера, оферта, дата размещения)
        try:
            n_sch = zspread.refresh_schedules()
            n_call = moex_ref.refresh_calls()      # с dohod — только даты коллов и названия эмитентов
            n_ref = 0
            if n_sch or n_call or _REF_DAY[0] != _date_mod.today():
                db = SessionLocal()
                try:
                    n_ref = moex_ref.rebuild(db)["bonds"]
                    _REF_DAY[0] = _date_mod.today()
                finally:
                    db.close()
            if n_sch or n_call or n_ref:
                universe.invalidate_rows_cache()
                _DATA_GEN[0] += 1            # новое поколение данных → готовые ответы и секторы пересоберутся
                _SIG_CACHE["at"] = 0.0
        except Exception as e:  # noqa: BLE001 — z-спред необязателен
            log.warning("z-спред: подготовка не удалась: %s", e)
        for k in _SECTOR_LOCKS:
            _build_sector(k)
        _warm_http()
        # истории для карточки выпуска: бенчмарк-ОФЗ и серии спреда рейтинговых групп
        try:
            import time as _t
            t0 = _t.time()
            n_ofz = instrument.prewarm_ofz_histories()
            db = SessionLocal()
            try:
                n_peer = universe.prewarm_peer_series(db)
            finally:
                db.close()
            log.warning("прогрев историй: ОФЗ %d, серии спреда %d за %.0f с", n_ofz, n_peer, _t.time() - t0)
        except Exception as e:  # noqa: BLE001 — прогрев необязателен
            log.warning("прогрев историй не удался: %s", e)
        # пересчёт секторов и упаковка ответов оставляют много освободившейся памяти, которую
        # Python сам системе не возвращает; на сервере в 1 ГБ рядом живёт AI-Инвест
        try:
            import ctypes
            import gc
            gc.collect()
            ctypes.CDLL("libc.so.6").malloc_trim(0)
        except Exception:  # noqa: BLE001 — не Linux
            pass
    _thr.Thread(target=_job, daemon=True).start()


def _sector_cached(key: str, db: Session) -> dict:
    sig = _market_sig(db)
    hit = _SECTOR_RESP.get(key)
    if hit and hit[0] == sig:
        return hit[1]
    if hit:                          # снимок сменился: прошлый ответ сейчас, новый — в фоне
        _thr.Thread(target=_build_sector, args=(key,), daemon=True).start()
        return hit[1]
    with _SECTOR_LOCKS[key]:         # кэша ещё нет вообще — считаем один раз на всех
        hit = _SECTOR_RESP.get(key)
        if hit:
            return hit[1]
        payload = _sector_builders()[key](db)
        _SECTOR_RESP[key] = (sig, payload)
        return payload


@app.get("/api/sector/utilities")
def sector_utilities(db: Session = Depends(get_db)):
    """Электроэнергетика и ЖКХ: кредитные метрики 10 компаний (МСФО и РСБУ) + рынок их облигаций."""
    return _sector_cached("utilities", db)


@app.get("/api/sector/retail")
def sector_retail(db: Session = Depends(get_db)):
    """Ритейл и торговля: кредитные метрики 42 компаний (МСФО и РСБУ) + рынок их облигаций."""
    return _sector_cached("retail", db)


@app.get("/api/sector_index")
def sector_index(db: Session = Depends(get_db)):
    """ISIN → [сектор, компания] для всех секторов с разобранной отчётностью. Карточка эмитента
    по нему узнаёт, есть ли у эмитента аналитика, не загружая сами секторы: отраслевая метка
    справочника для этого ненадёжна (у Электроаппарата — машиностроение, у НоваБев — АПК)."""
    out: dict = {}
    for key in _SECTOR_LOCKS:
        d = _sector_cached(key, db)
        for c in (d.get("companies") or []) + (d.get("others") or []):
            if key in ("developers", "utilities", "retail") and c in (d.get("others") or []):
                continue                      # у «прочих» этих секторов отчётности нет
            for i in ((c.get("market") or {}).get("isins") or []):
                out.setdefault(i, [key, c.get("company")])
    return out


@app.get("/api/sector/developers")
def sector_developers(db: Session = Depends(get_db)):
    """Отраслевая аналитика застройщиков: отчётность МСФО 8 групп + рынок их облигаций."""
    return _sector_cached("developers", db)


@app.get("/api/sector/developers/methodology")
def sector_developers_methodology():
    from .services import sectors
    return {"text": sectors.methodology()}


@app.get("/api/sector/leasing")
def sector_leasing(db: Session = Depends(get_db)):
    """Сектор лизинга: кредитный профиль трёх компаний с отчётностью + рынок их облигаций."""
    return _sector_cached("leasing", db)


@app.get("/api/sector/leasing/methodology")
def sector_leasing_methodology():
    from .services import sector_leasing as sl
    return {"text": sl.methodology()}


@app.get("/api/sector/subfed")
def sector_subfed(db: Session = Depends(get_db)):
    """Субфедеральные эмитенты: бюджеты регионов и городов + рынок их облигаций."""
    return _sector_cached("subfed", db)


@app.get("/api/issuer_redemptions")
def issuer_redemptions(isins: str, db: Session = Depends(get_db)):
    """Будущие выплаты номинала по выпускам эмитента: амортизации, погашения (остаток) и оферты."""
    return {"events": universe.redemption_events(db, _split(isins) or [])}


@app.post("/api/issuer_redemptions")
def issuer_redemptions_post(payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """То же, списком в теле: у Сбер CIB / СберИОС сотни выпусков — в URL не помещаются."""
    isins = [str(x) for x in (payload.get("isins") or []) if x][:1500]
    return {"events": universe.redemption_events(db, isins)}


@app.get("/api/issuer")
def issuer(q: str, db: Session = Depends(get_db)):
    """Issuer page: all traded bonds of one issuer + sector / agency ratings.
    `q` is an ISIN or an issuer name."""
    res = universe.issuer_page(db, q)
    if not res:
        raise HTTPException(404, f"эмитент не найден: {q}")
    return res


@app.get("/api/movers")
def movers(limit: int = 20, min_turnover: float = 0.0, db: Session = Depends(get_db)):
    """Market dynamics: top daily price gainers/losers and highest turnover.
    min_turnover (RUB) hides illiquid names whose % move is just noise."""
    return universe.movers(db, limit=limit, min_turnover=min_turnover)


@app.get("/api/ideas")
def ideas(limit: int = 30, min_turnover: float = 0.0, db: Session = Depends(get_db)):
    """Relative-value ideas: intra-issuer outliers and cheap-vs-rating anomalies.
    min_turnover (RUB) restricts to liquid names."""
    return universe.ideas(db, limit=limit, min_turnover=min_turnover)


@app.get("/api/universe/suggest")
def universe_suggest(q: str, db: Session = Depends(get_db)):
    """Autocomplete for the bond search box (from cache, no network)."""
    return universe.suggest(db, q)


@app.get("/api/universe/one")
def universe_one(isin: str, db: Session = Depends(get_db)):
    """Snapshot row + rating for the issue card (instant, from cache)."""
    row = universe.one(db, isin)
    if not row:
        raise HTTPException(404, f"{isin} not in snapshot — refresh the market first")
    return row


@app.get("/api/universe/volumes")
def universe_volumes(isin: str, db: Session = Depends(get_db)):
    row = universe.issue_volumes(db, isin)
    if row is None:
        raise HTTPException(404, "Выпуск отсутствует в снимке")
    return row


@app.get("/api/universe/similar")
def universe_similar(isin: str, db: Session = Depends(get_db)):
    """Peer sets for the issue card: same issuer / rating / sector."""
    return universe.similar(db, isin)


@app.get("/api/instrument/{isin}/news")
def instrument_news(isin: str, db: Session = Depends(get_db)):
    """Recent news for the bond's issuer (Google News)."""
    from .db import BondRating
    rt = db.get(BondRating, isin.strip().upper())
    issuer = (rt.issuer if rt else None)
    if not issuer:
        snap = universe.one(db, isin)
        issuer = snap.get("issuer") or snap.get("name") if snap else None
    return {"issuer": issuer, "news": news.issuer_news(issuer) if issuer else []}


@app.get("/api/instrument/{isin}/peers_history")
def instrument_peers_history(isin: str, db: Session = Depends(get_db)):
    """Средний по эмитенту и по кредитному рейтингу исторический спред (для наложения
    на график выпуска): G-спред у фиксов, simple margin у флоатеров."""
    return universe.peers_history(db, isin)


@app.get("/api/instrument/{isin}/liquidity")
def instrument_liquidity(isin: str):
    """Detailed liquidity (30d/180d avg & median turnover, days traded, trades/day)."""
    try:
        return instrument.liquidity_detail(isin)
    except moex.MoexError as e:
        raise HTTPException(502, "Источник данных временно недоступен")


@app.get("/api/instrument/{isin}/history")
def instrument_history(isin: str, frm: str = "2012-01-01", db: Session = Depends(get_db)):
    """YTM/price history + historical G-spread to КБД and spread to benchmark OFZ.
    For floaters also returns the simple-margin history (needs the quoted margin)."""
    rt = db.get(BondRating, isin)
    from .db import BondSnapshot
    snap = db.get(BondSnapshot, isin)
    qm = (rt.float_add if rt else None) or (snap.float_qm if snap else None)   # спред флоатера
    try:
        return instrument.issue_history(isin, frm=frm, qm=qm)
    except moex.MoexError as e:
        raise HTTPException(502, "Источник данных временно недоступен")


@app.get("/api/instrument/{isin}/schedule")
def instrument_schedule(isin: str):
    """Amortization + offer schedule (why duration can be far below maturity)."""
    from datetime import date
    try:
        ref = moex.resolve_security(isin)
        bz = moex.get_bondization(ref["secid"], ref.get("board"))
    except moex.MoexError as e:
        raise HTTPException(502, "Источник данных временно недоступен")
    today = date.today().isoformat()
    amorts = [a for a in bz.get("amortizations", []) if (a.get("valueprc") or 0) < 100]
    future_amorts = [a for a in amorts if (a.get("date") or "") >= today]
    return {
        "isin": isin,
        "amortizing": len(amorts) > 1,     # more than the final redemption
        "amortizations": amorts,
        "offers": bz.get("offers", []),
        "next_amort": (future_amorts[0] if future_amorts else None),
    }


@app.get("/api/instrument/{isin}/total_return")
def instrument_total_return(isin: str, frm: str | None = None, till: str | None = None):
    """Realized total return (price + coupons + amortization) over a window, plus
    its annualized rate and a money-market benchmark line for the same period."""
    # история цен дневная — ответ держим до смены дня (не дольше 3 ч), 80 последних бумаг
    key = (isin, frm, till, _date_mod.today().isoformat())
    hit = _TR_CACHE.get(key)
    if hit and _time_mod.time() - hit[0] < 3 * 3600:
        return hit[1]
    res = _total_return_compute(isin, frm, till)
    _TR_CACHE.pop(key, None)
    _TR_CACHE[key] = (_time_mod.time(), res)
    while len(_TR_CACHE) > 80:
        _TR_CACHE.pop(next(iter(_TR_CACHE)))
    return res


_TR_CACHE: dict = {}


def _total_return_compute(isin: str, frm: str | None, till: str | None) -> dict:
    res = instrument.security_total_return(isin, frm, till)
    if res.get("detail") or not res.get("series"):
        return res
    from datetime import date as _date

    def _annualize(pct, days):
        if pct is None or not days or days <= 0:
            return None
        return round(((1 + pct / 100.0) ** (365.0 / days) - 1) * 100.0, 2)

    try:
        days = (_date.fromisoformat(res["till"]) - _date.fromisoformat(res["from"])).days
    except (ValueError, KeyError, TypeError):
        days = None
    res["days"] = days
    res["annualized_pct"] = _annualize(res.get("total_return_pct"), days)
    # money-market benchmark (LQDT) for the same window
    mm = instrument.money_market_series(res["from"], res["till"])
    # Выравниваем денежный рынок на ДАТЫ облигации (её торговые дни), чтобы на графике
    # обе линии были на одних точках — иначе тултип по оси иногда показывает только одну.
    if mm:
        j, lastv, aligned = 0, 0.0, []
        for bd, _ in res["series"]:
            while j < len(mm) and mm[j][0] <= bd:
                lastv = mm[j][1]
                j += 1
            aligned.append([bd, lastv])
        mm = aligned
    res["mm_series"] = mm
    if mm:
        res["mm_total_pct"] = mm[-1][1]
        try:
            mm_days = (_date.fromisoformat(mm[-1][0]) - _date.fromisoformat(mm[0][0])).days
        except (ValueError, IndexError):
            mm_days = days
        res["mm_annualized_pct"] = _annualize(mm[-1][1], mm_days)
    return res


@app.get("/api/instrument/{isin}/ytm")
def instrument_ytm(isin: str, price: float, db: Session = Depends(get_db)):
    """Recompute YTM (and yield-to-offer if there is a put/call) from a price.

    A floater has no known future coupons, so it has NO YTM anywhere — the only
    place it gets one is the sandbox scenario (/api/model/floater_scenario), which
    projects coupons from a key-rate path. Here we refuse it."""
    snap = db.get(BondSnapshot, isin)
    if snap and snap.kind == "floater":
        return {"price": price, "ytm": None, "ytp": None, "offer": None,
                "note": "Флоатер: YTM не считается (кроме сценария в песочнице)."}
    try:
        # YTM is on the DIRTY price — pass the snapshot's НКД, since the per-bond
        # MOEX quote sometimes returns it empty (→ yield inflated by ~1%).
        accint = snap.accint if snap else None
        return {"price": price, **instrument.ytm_at_price(isin, price, accint)}
    except moex.MoexError as e:
        raise HTTPException(502, "Источник данных временно недоступен")


@app.get("/api/universe/rating_curve")
def universe_rating_curve(isin: str, db: Session = Depends(get_db)):
    """Bond vs its rating-group yield curve: group points, fitted curve,
    rich/cheap in bp, and an auto-comment."""
    return universe.rating_curve(db, isin)


@app.get("/api/rating_curves")
def rating_curves(db: Session = Depends(get_db)):
    """Current yield curve per rating bucket (AAA…B)."""
    return universe.rating_curves(db)


@app.get("/api/rating_curves/history")
def rating_curves_history(db: Session = Depends(get_db)):
    """Median YTM per rating bucket by month (dynamics over time)."""
    return universe.rating_yield_history(db)


@app.get("/api/bond_indices")
def bond_index_dashboard(group: str = "fixed", period: str = "1y"):
    """Official MOEX total-return bond indices and basket YTM history."""
    return bond_indices.get_dashboard(group=group, period=period)


@app.get("/api/equity_indices")
def equity_index_dashboard(group: str = "main", period: str = "1y"):
    """Official MOEX equity-index history in native index points."""
    return equity_indices.get_dashboard(group=group, period=period)


@app.get("/api/stock_market_map")
def stock_market_map():
    from .services import stock_market
    try:
        return stock_market.get_map()
    except Exception:
        raise HTTPException(503, "Данные карты акций временно недоступны")


@app.get("/api/index_composition")
def index_composition(code: str, asset: str = "bonds", db: Session = Depends(get_db)):
    """Current official basket for any index shown on the Indices page.

    Bond baskets are enriched with the local market snapshot. Their headline
    YTM and duration are the official aggregate figures published by MOEX for
    the same index, rather than an approximation from partially matched rows.
    """
    from datetime import date, timedelta

    code = (code or "").strip().upper()
    asset = (asset or "bonds").strip().lower()
    catalogue = equity_indices.CATALOG if asset == "stocks" else bond_indices.CATALOG
    allowed = {item["code"] for group in catalogue.values() for item in group}
    if code not in allowed:
        raise HTTPException(404, "Индекс не найден")

    # Total-return variants use exactly the same basket as their price-index
    # parent. MOEX publishes analytics only under the parent code, so resolve
    # that documented family relationship while keeping the requested index in
    # the response and source link.
    composition_code = {
        "MCFTR": "IMOEX", "MCFTRR": "IMOEX",
        "MEBCTR": "MOEXBC", "MESMTR": "MCXSM",
        "MIPOTR": "MIPO", "ESGITR": "ESGI", "MESGTR": "MESG",
    }.get(code, code)
    try:
        composition = moex.get_index_composition(composition_code)
    except moex.MoexError as exc:
        raise HTTPException(502, "MOEX временно не вернула состав индекса") from exc

    items = composition["items"]
    weighted_ytm = None
    weighted_duration_years = None
    weighted_simple_margin_bp = None
    weighted_term_years = None
    metric_mode = "stocks" if asset == "stocks" else (
        "floater" if code in {x["code"] for x in bond_indices.CATALOG["floaters"]} else "fixed"
    )
    if asset != "stocks":
        ids = sorted({x for item in items for x in (item.get("ticker"), item.get("secid")) if x})
        snapshots = []
        ratings_rows = []
        if ids:
            snapshots = db.query(BondSnapshot).filter(
                BondSnapshot.isin.in_(ids) | BondSnapshot.secid.in_(ids)
            ).all()
            snapshot_isins = {s.isin for s in snapshots if s.isin}
            rating_ids = sorted(set(ids) | snapshot_isins)
            ratings_rows = db.query(BondRating).filter(BondRating.isin.in_(rating_ids)).all()
        snap_by_id = {}
        for snap in snapshots:
            if snap.isin:
                snap_by_id[snap.isin.upper()] = snap
            if snap.secid:
                snap_by_id[snap.secid.upper()] = snap
        rating_by_id = {r.isin.upper(): r for r in ratings_rows if r.isin}
        enriched = []
        for item in items:
            snap = snap_by_id.get(item["secid"]) or snap_by_id.get(item["ticker"])
            rating = rating_by_id.get((snap.isin if snap else item["secid"]).upper())
            simple_margin_bp = None
            term_date = None
            term_years = None
            term_type = None
            if snap and snap.kind == "floater":
                sm = snap.simple_margin_bp
                simple_margin_bp = sm if sm is not None and -3000 < sm < 20000 else None
                offer_date = None
                try:
                    offer_date = zspread.horizon(snap.isin, snap.matdate, snap.buyback_date)[0]
                except Exception:  # schedule enrichment must not blank the composition
                    if (snap.buyback_date and snap.buyback_date >= date.today().isoformat()
                            and (not snap.matdate or snap.buyback_date < snap.matdate)):
                        offer_date = snap.buyback_date
                term_date = offer_date or snap.matdate
                term_type = "offer" if offer_date else ("maturity" if term_date else None)
                try:
                    term_years = max(0, (date.fromisoformat(term_date[:10]) - date.today()).days / 365.25) if term_date else None
                except (TypeError, ValueError):
                    term_years = snap.years_to_maturity
            enriched.append({
                **item,
                "isin": snap.isin if snap else item["secid"],
                "name": (snap.shortname if snap and snap.shortname else item["name"]),
                "rating": rating.rating if rating and rating.rating else (rating.rating_bucket if rating else None),
                "kind": snap.kind if snap else None,
                "price": snap.price if snap else None,
                "ytm": snap.ytm if snap else None,
                "duration_years": snap.duration_years if snap else None,
                "matdate": snap.matdate if snap else None,
                "simple_margin_bp": simple_margin_bp,
                "term_date": term_date,
                "term_years": term_years,
                "term_type": term_type,
            })
        items = enriched
        if metric_mode == "floater":
            sm_rows = [(x.get("weight") or 0, x.get("simple_margin_bp")) for x in items
                       if x.get("simple_margin_bp") is not None and (x.get("weight") or 0) > 0]
            term_rows = [(x.get("weight") or 0, x.get("term_years")) for x in items
                         if x.get("term_years") is not None and (x.get("weight") or 0) > 0]
            sm_weight = sum(w for w, _ in sm_rows)
            term_weight = sum(w for w, _ in term_rows)
            weighted_simple_margin_bp = (sum(w * v for w, v in sm_rows) / sm_weight) if sm_weight else None
            weighted_term_years = (sum(w * v for w, v in term_rows) / term_weight) if term_weight else None
        else:
            try:
                frm = (date.today() - timedelta(days=14)).isoformat()
                history = moex.get_bond_index_history(code, frm, date.today().isoformat())
                latest = history[-1] if history else {}
                raw_ytm = latest.get("yield")
                weighted_ytm = raw_ytm if raw_ytm is not None and 0 < raw_ytm <= 100 else None
                duration_days = latest.get("duration_days")
                weighted_duration_years = duration_days / 365 if duration_days is not None else None
            except moex.MoexError:
                pass

    return {
        "code": code,
        "asset": asset,
        "as_of": composition["as_of"],
        "count": len(items),
        "total_weight": sum((item.get("weight") or 0) for item in items),
        "weighted_ytm": weighted_ytm,
        "weighted_duration_years": weighted_duration_years,
        "weighted_simple_margin_bp": weighted_simple_margin_bp,
        "weighted_term_years": weighted_term_years,
        "metric_mode": metric_mode,
        "items": items,
        "source": "MOEX ISS",
        "source_url": f"https://www.moex.com/ru/index/{code}",
    }


@app.get("/api/placements")
def placements(mode: str = "current", days: int = 120, db: Session = Depends(get_db)):
    """Primary market. mode='current' → in-placement / upcoming; 'history' → recently placed."""
    return universe.placements(db, mode=mode, days=days)


@app.get("/api/auctions")
def auctions(request: Request, years: int = 10, force: bool = False):
    """История аукционов ОФЗ Минфина (по всем доступным годам, с 2021): выпуск, объём
    предложения, спрос, цена отсечения, средневзвешенная цена/доходность. Кэш 6ч;
    force=1 — принудительно обновить (для CRON по средам после аукциона)."""
    from .services import auctions as auc
    from .db import BondSnapshot
    rows = auc.get_auctions(years=years, force=force and _is_admin(request))
    # доходность выпуска на рынке СЕЙЧАС (снимок MOEX) — видно, заработали ли покупатели на аукционе:
    # ОФЗ-ПД/ИН/АД — YTM (у ИН реальная, как и на аукционе), ОФЗ-ПК — simple margin
    cur = {}
    db = SessionLocal()
    try:
        for s in db.query(BondSnapshot).filter(BondSnapshot.secid.like("SU%")).all():
            cur[(s.secid or "")[:11]] = s
    finally:
        db.close()
    # вторичный рынок накануне аукциона: доходность/цена закрытия выпуска → премия Минфина к рынку
    from .services import curves
    try:
        pre = curves.pre_auction_market([r.get("date") for r in rows if r.get("date")])
    except Exception as e:  # noqa: BLE001
        log.warning("pre-auction market: %s", e)
        pre = {}
    # ОФЗ-ПК: текущая доходность = ставка купона, действующая на дату ÷ цена (на аукционе и на рынке
    # накануне). Купон 29-й серии фиксируется в начале периода; если ещё не зафиксирован (первый купон
    # нового выпуска) — оценка по RUONIA на дату (помечается est)
    pk_rows = [r for r in rows if "ПК" in (r.get("type") or "") and r.get("secid") and r.get("date")]
    try:
        pk_pairs = [((r.get("secid") or "")[:11], r["date"]) for r in pk_rows]
        pk_pairs += [((r.get("secid") or "")[:11], (pre.get(r["date"]) or {}).get("date")) for r in pk_rows if (pre.get(r["date"]) or {}).get("date")]
        pk_cpn = curves.coupons_at(pk_pairs, {k: (v.secid or "") for k, v in cur.items()})
    except Exception as e:  # noqa: BLE001
        log.warning("OFZ-PK coupons: %s", e)
        pk_cpn = {}
    first_auc: dict = {}
    for r in rows:                                   # первый аукцион выпуска = его размещение
        if r.get("series") and r.get("date") and (r["series"] not in first_auc or r["date"] < first_auc[r["series"]]):
            first_auc[r["series"]] = r["date"]
    out = []
    for r in rows:
        s = cur.get((r.get("secid") or "")[:11])
        r = dict(r)
        pm = (pre.get(r.get("date")) or {})
        m = (pm.get("px") or {}).get((r.get("secid") or "")[:11])
        r["first_auction"] = r.get("date") == first_auc.get(r.get("series"))
        if "ПК" in (r.get("type") or "") and (r.get("wa_price") or r.get("cutoff_price")) and r.get("placed_mln"):
            c, est = pk_cpn.get(((r.get("secid") or "")[:11], r.get("date"))), False
            if c is None:
                c, est = curves.ruonia_on(r["date"]), True
            if c is not None:
                r["auc_cy"], r["auc_cy_est"] = round(c / (r.get("wa_price") or r.get("cutoff_price")) * 100, 2), est
        if m:
            r["pre_date"], r["pre_ytm"], r["pre_price"] = pm.get("date"), m[0], m[1]
            if "ПК" in (r.get("type") or "") and m[1]:
                c, est = pk_cpn.get(((r.get("secid") or "")[:11], pm["date"])), False
                if c is None:
                    c, est = curves.ruonia_on(pm["date"]), True
                if c is not None:
                    r["pre_cy"], r["pre_cy_est"] = round(c / m[1] * 100, 2), est
            # ОФЗ-ПК: simple margin рынка накануне по той же формуле, что и SM аукциона
            # SM = (QM + (100 − P) / M) × 100 / P; QM — спред выпуска (у 29-й серии к RUONIA обычно 0)
            if "ПК" in (r.get("type") or "") and m[1] and r.get("matdate"):
                try:
                    from datetime import date as _d
                    yrs = (_d.fromisoformat(r["matdate"]) - _d.fromisoformat(pm["date"])).days / 365.25
                    qm = (s.float_qm if (s is not None and s.float_qm is not None) else 0.0)
                    if yrs > 0.1:
                        r["pre_sm_bp"] = round((qm + (100 - m[1]) / yrs) * 100 / m[1] * 100)
                except (ValueError, TypeError):
                    pass
        if s is not None:
            fl = s.kind == "floater"
            r["cur_isin"] = s.isin
            r["cur_price"] = s.price
            r["cur_ytm"] = None if fl else s.ytm
            r["cur_sm_bp"] = s.simple_margin_bp if fl else None
            r["cur_at"] = s.updated_at.isoformat() + "Z" if s.updated_at else None
        out.append(r)
    return {"auctions": out}


@app.get("/api/ofz_curve")
def ofz_curve(date: str | None = None):
    """КБД, точки ОФЗ-ПД и свопы на RUONIA (ROISfix НФА) на дату YYYY-MM-DD (по умолчанию — сегодня;
    выходной → ближайший предыдущий торговый день)."""
    from datetime import date as _d
    from .services import curves
    try:
        d = _d.fromisoformat(date) if date else None
    except ValueError:
        raise HTTPException(400, "Дата в формате ГГГГ-ММ-ДД")
    if d and (d > _d.today() or d < _d(2014, 1, 1)):
        raise HTTPException(400, "Дата вне доступного диапазона")
    try:
        return curves.curve_on(d)
    except Exception as e:  # noqa: BLE001
        log.warning("ofz_curve %s: %s", date, e)
        raise HTTPException(502, "Источник кривой недоступен")


@app.get("/api/macro")
def macro(request: Request, force: bool = False):
    """Макроэкономика РФ: ключевая ставка + инфляция ИПЦ (% г/г) + цель, денежная масса
    (M2/M0/широкая), капитализация рынка акций Мосбиржи, индекс IMOEX (история). Источники
    — ЦБ (hd_base/infl, dataservice) и MOEX ISS. Кэш 12ч; force=1 — принудительно."""
    from .services import macro as mc
    return mc.get_macro(force=force and _is_admin(request))


@app.get("/api/bank_profits")
def bank_profits(request: Request, force: bool = False):
    """Чистая прибыль публичных банков помесячно (с начала года) — форма 102 ЦБ. Кэш 12ч."""
    from .services import macro as mc
    return mc.get_bank_profits(force=force and _is_admin(request))


@app.get("/api/bank_normatives")
def bank_normatives(request: Request, force: bool = False):
    """Обязательные нормативы публичных банков помесячно (Н1.0/Н1.1/Н1.2/Н2/Н3/Н4) — форма 135."""
    from .services import macro as mc
    return mc.get_bank_normatives(force=force and _is_admin(request))


@app.get("/api/ofz_redemption")
def ofz_redemption(db: Session = Depends(get_db)):
    """Профиль погашения ОФЗ по годам с разбивкой по типу (стек столбиков)."""
    return universe.ofz_redemption(db)


@app.get("/api/universe/facets")
def universe_facets(db: Session = Depends(get_db)):
    """Available sectors and rating buckets (for filter chips + market map)."""
    return universe.facets(db)


@app.post("/api/ratings/refresh", dependencies=[Depends(require_admin)])
def ratings_refresh(payload: dict = Body(default={}), db: Session = Depends(get_db)):
    """Пересобрать справочник облигаций (эмитент, отрасль, флоатеры, оферты) из биржи и ФНС."""
    try:
        res = moex_ref.rebuild(db)          # справочник — только биржа и ФНС, dohod не используем
        universe.invalidate_rows_cache()
        res["harmonize"] = ratings.harmonize_sectors(db)
        universe.invalidate_rows_cache()
        return res
    except Exception as e:  # noqa: BLE001 — scraping is best-effort
        log.warning("ratings refresh failed: %s", e)
        raise HTTPException(502, "Обновление рейтингов не удалось, источник недоступен")


_AGENCY_JOB: dict = {"running": False, "which": None, "started": None, "result": None}


@app.post("/api/agencies/refresh", dependencies=[Depends(require_admin)])
def agencies_refresh(payload: dict = Body(default={})):
    """Выгрузка рейтингов АКРА / Эксперт РА / НКР — В ФОНЕ (Эксперт РА с догрузкой ИНН/ISIN
    в первый раз идёт десятки минут; синхронный запрос оборвал бы nginx). Статус — GET /api/agencies/status."""
    import threading
    from datetime import datetime as _dt
    which = tuple(w for w in (payload.get("which") or ("acra",)) if w in ("acra", "nkr", "expert"))
    if not which:
        raise HTTPException(400, "which: acra | nkr | expert")
    if not _RATINGS_LOCK.acquire(blocking=False):
        return {"started": False, "detail": "обновление рейтингов уже идёт", **_AGENCY_JOB}

    def _job():
        s = SessionLocal()
        try:
            _AGENCY_JOB["result"] = agencies.refresh(s, which=which)
            universe.invalidate_rows_cache()
        except Exception as e:  # noqa: BLE001
            log.warning("agency refresh failed: %s", e)
            _AGENCY_JOB["result"] = {"error": "обновление не удалось"}
        finally:
            s.close()
            _AGENCY_JOB["running"] = False
            _RATINGS_LOCK.release()
    _AGENCY_JOB.update(running=True, which=list(which), started=_dt.utcnow().isoformat() + "Z", result=None)
    threading.Thread(target=_job, daemon=True).start()
    return {"started": True, "which": list(which)}


@app.get("/api/agencies/status")
def agencies_status(db: Session = Depends(get_db)):
    """Свежесть рейтингов по агентствам + состояние фоновой выгрузки."""
    from sqlalchemy import func
    from .db import AgencyRating
    rows = db.query(AgencyRating.agency, AgencyRating.rating_type, func.count(AgencyRating.id),
                    func.max(AgencyRating.updated_at)).group_by(AgencyRating.agency, AgencyRating.rating_type).all()
    ag: dict = {}
    for a, t, n, upd in rows:
        e = ag.setdefault(a, {"issuer": 0, "issue": 0, "updated_at": None})
        e["issue" if t in ("issue", "sf") else "issuer"] += n
        u = upd.isoformat() + "Z" if upd else None
        e["updated_at"] = max(filter(None, (e["updated_at"], u)), default=None)
    return {"agencies": ag, "job": {k: v for k, v in _AGENCY_JOB.items()}}


@app.post("/api/ratings/import", dependencies=[Depends(require_admin)])
async def ratings_import(file: UploadFile, db: Session = Depends(get_db)):
    """Import a ratings CSV/Excel (Cbonds/RusBonds/dohod export). Columns auto-mapped."""
    dest = _save_upload(file)
    try:
        res = ratings.import_csv(db, str(dest))
        res["harmonize"] = ratings.harmonize_sectors(db)
        universe.invalidate_rows_cache()
        return res
    except Exception as e:  # noqa: BLE001
        log.warning("ratings import failed: %s", e)
        raise HTTPException(400, "Не удалось разобрать файл рейтингов")


# --------------------------------------------------------------------------- #
# Счётчик посещений (только аналитическая версия)
# --------------------------------------------------------------------------- #
@app.post("/api/visit")
def record_visit(request: Request, db: Session = Depends(get_db)):
    from .db import PageVisit
    xff = request.headers.get("x-forwarded-for", "")
    ip = (xff.split(",")[0].strip() if xff else None) or (request.client.host if request.client else None)
    from datetime import datetime, timedelta
    recent = db.query(PageVisit).filter(PageVisit.ip == ip, PageVisit.ts >= datetime.utcnow() - timedelta(minutes=30)).first() if ip else None
    if not recent:           # не чаще раза в 30 мин с одного IP — защита от накрутки/флуда
        db.add(PageVisit(ip=ip))
        db.commit()
    return {"ok": True}


@app.get("/api/visits")
def visits(db: Session = Depends(get_db)):
    from datetime import datetime, timedelta
    from .db import PageVisit
    # Read the timestamps in ONE pass so `total` and `day` are a consistent
    # snapshot — two separate .count() queries can race a concurrent /api/visit
    # insert landing between them and report day > total (impossible otherwise).
    cutoff = datetime.utcnow() - timedelta(hours=24)
    ts_rows = [ts for (ts,) in db.query(PageVisit.ts).all()]
    total = len(ts_rows)
    day = sum(1 for ts in ts_rows if ts and ts >= cutoff)
    return {"total": total, "day": day}


# --------------------------------------------------------------------------- #
# Static frontend (mounted last so /api/* wins)
# --------------------------------------------------------------------------- #
@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")
