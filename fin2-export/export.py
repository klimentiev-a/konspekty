#!/usr/bin/env python3
"""Экспорт данных «Финансы 2» (BondsAI + StockAI) в статические JSON.

Запускает бэкенд BondsAI в процессе (без сервера), обновляет рыночный снимок из Мосбиржи
и записывает ответы всех нужных эндпоинтов в папку --out. Фронт на GitHub Pages читает
эти файлы вместо запросов к серверу (fin2/fin2-api.js).

Режимы:
  --market   только рыночный снимок (раз в час): скринер, идеи, кривые, первичка, ОФЗ…
  --full     полное обновление (раз в сутки): + рейтинги агентств, макро, аукционы, банки,
             секторы, графики выплат, рейтинги по выпускам, история КБД, средние спреды.
  --auto     full, если прошлое полное обновление старше 20 ч (или его не было), иначе market.
  --offline  без сети: только из текущей базы (для проверки сборки).

Состояние между запусками (база SQLite и кэши сервисов) живёт в --state:
  state/bond_dashboard.db, state/services_data/ — их переносит workflow в ветку fin2-data.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import shutil
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE / "backend"
SEED_DB = HERE / "seed" / "public-market.sqlite3"


def log(*a):
    print(datetime.now().strftime("%H:%M:%S"), *a, flush=True)


def prepare(state: Path, offline: bool) -> Path:
    """База и кэши сервисов — из state (или из комплекта при первом запуске). Код бэкенда
    копируется в state/work, чтобы подмена папки data не трогала файлы репозитория."""
    state.mkdir(parents=True, exist_ok=True)
    db = state / "bond_dashboard.db"
    if not db.exists():
        shutil.copyfile(SEED_DB, db)
        log("база: скопирована стартовая из комплекта")
    sd = state / "services_data"
    if not sd.exists():
        shutil.copytree(BACKEND / "app" / "services" / "data", sd)
        log("кэши сервисов: скопированы из комплекта")
    work = state / "work"
    if work.exists():
        shutil.rmtree(work)
    shutil.copytree(BACKEND, work, ignore=shutil.ignore_patterns("__pycache__", "data"))
    (work / "app" / "services" / "data").symlink_to(sd.resolve(), target_is_directory=True)
    (work.parent / "data").mkdir(exist_ok=True)          # config.DATA_DIR = ROOT/data (uploads, last_full_update)
    (work.parent / "frontend").mkdir(exist_ok=True)      # main.py монтирует папку фронта — пустая, нам не нужна
    os.environ["DB_URL"] = f"sqlite:///{db.resolve()}"
    os.environ.setdefault("ADMIN_TOKEN", hashlib.sha256(b"fin2-static-export").hexdigest())
    os.environ["ENABLE_SCHEDULER"] = "0"
    sys.path.insert(0, str(work))
    os.chdir(work)
    if offline:
        import requests

        def boom(*a, **k):
            raise requests.ConnectionError("offline export")
        requests.Session.request = boom
        import app.services.moex as m
        m.RETRIES, m.RETRY_BACKOFF = 1, 0
    return work


def dump(out: Path, name: str, obj, compact=True):
    p = out / name
    p.parent.mkdir(parents=True, exist_ok=True)
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":") if compact else None, allow_nan=False,
                   default=lambda o: o.isoformat() if hasattr(o, "isoformat") else (o.item() if hasattr(o, "item") else str(o)))
    p.write_text(s, encoding="utf-8")
    return len(s)


def columnar(rows: list[dict]) -> dict:
    """Список словарей → {cols, rows:[[…]]}: без повторения ключей файл втрое меньше."""
    cols: list[str] = []
    seen = set()
    for r in rows:
        for k in r:
            if k not in seen:
                seen.add(k)
                cols.append(k)
    return {"cols": cols, "rows": [[r.get(c) for c in cols] for r in rows]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--state", required=True)
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--market", action="store_true")
    g.add_argument("--full", action="store_true")
    g.add_argument("--auto", action="store_true")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--skip-ratings", action="store_true", help="не выгружать рейтинги по выпускам (долго)")
    args = ap.parse_args()
    out, state = Path(args.out).resolve(), Path(args.state).resolve()
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    prepare(state, args.offline)

    status_path = out / "status.json"
    try:
        status = json.loads(status_path.read_text())
    except Exception:  # noqa: BLE001
        status = {}
    mode = "full" if args.full else "market"
    if args.auto:
        last_full = status.get("full_at")
        try:
            age_h = (datetime.now(timezone.utc) - datetime.fromisoformat(last_full)).total_seconds() / 3600
        except Exception:  # noqa: BLE001
            age_h = 1e9
        mode = "full" if age_h > 20 else "market"
    log("режим:", mode, "offline" if args.offline else "online")

    import logging
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("moex").setLevel(logging.ERROR)

    from app import main as M
    from app.db import SessionLocal, init_db, BondSnapshot
    from app.services import universe, instrument, moex, moex_ref, zspread, agencies, bond_indices, equity_indices
    from sqlalchemy import func
    init_db()
    steps: dict = {}

    def step(name, fn):
        t = time.time()
        try:
            r = fn()
            steps[name] = {"ok": True, "sec": round(time.time() - t, 1)}
            log(f"✓ {name} {time.time() - t:.0f}с")
            return r
        except Exception as e:  # noqa: BLE001
            steps[name] = {"ok": False, "error": str(e)[:200], "sec": round(time.time() - t, 1)}
            log(f"✗ {name}: {str(e)[:200]}")
            return None

    # ---------- выгрузка ----------
    from fastapi.testclient import TestClient
    c = TestClient(M.app)
    sizes: dict = {}

    def get(path, name=None, required=False):
        name = name or path.strip("/").replace("/api/", "").replace("?", "_").replace("&", "_").replace("=", "-") + ".json"
        t = time.time()
        r = c.get(path)
        if r.status_code != 200:
            steps[f"get {path}"] = {"ok": False, "error": f"HTTP {r.status_code}", "sec": round(time.time() - t, 1)}
            log(f"✗ {path}: HTTP {r.status_code}")
            if required:
                raise RuntimeError(f"{path}: HTTP {r.status_code}")
            return None
        data = r.json()
        sizes[name] = dump(out, name, data)
        log(f"  {name} {sizes[name] / 1024:.0f} КБ {time.time() - t:.1f}с")
        return data

    snapshot_at = None

    def dump_market():
        """Рыночные файлы (каждый час): строки скринера, фасеты, идеи, кривые, ОФЗ, первичка, акции."""
        nonlocal snapshot_at
        db = SessionLocal()
        try:
            cnt, upd = db.query(func.count(BondSnapshot.isin), func.max(BondSnapshot.updated_at)).first()
            snapshot_at = (upd.isoformat() + "Z") if upd else None
            # --- скринер: все строки рынка + «живые» без YTM (страница эмитента, поиск) ---
            rows = universe._all_rows(db)
            rmap = universe._ratings_map(db)
            amap = agencies.ratings_map(db)
            have = {r["isin"] for r in rows}
            extra = []
            for s in db.query(BondSnapshot).filter(universe._live_filter(db)).all():
                if s.isin in have:
                    continue
                r = universe._row(s, rmap.get(s.isin), amap)
                universe._fix_sector(r)
                r["_x"] = 1
                extra.append(r)
            snaps = {s.isin: s for s in db.query(BondSnapshot).all()}
            for r in rows + extra:
                s = snaps.get(r["isin"])
                r["emkey"] = universe._emkey(s, rmap.get(r["isin"])) if s else None
                r["issue_date"] = rmap[r["isin"]].issue_date if rmap.get(r["isin"]) else None
                # для графика погашения / объёмов — поля снимка, которых нет в строке
                if s:
                    r["issuesize_placed"] = s.issuesize_placed
                    r["facevalue"] = s.facevalue
                    r["faceunit"] = s.faceunit
                    r["buyback_date"] = s.buyback_date
                    r["accint"] = s.accint
                    r["avg_volume"] = s.avg_volume
            # поля, которые фронт не читает, и пустые значения в рейтингах агентств — не выгружаем (файл вдвое меньше)
            DROP = {"yield_source", "yield_contract_source", "yield_status", "base_rate", "gspread_pctl", "sm_pctl",
                    "pctl_at", "pctl_stale", "sector_raw", "rating_match", "agency_prev_rating", "agency_action", "agency_action_date"}
            AG_KEEP = ("agency", "rating", "bucket", "forecast", "action", "action_date", "level", "trend", "prev_rating",
                       "prev_date", "issuer_rating", "issuer_forecast", "expected", "sf")
            slim = []
            for r in rows + extra:
                r = {k: v for k, v in r.items() if k not in DROP}
                if r.get("agency_all"):
                    r["agency_all"] = [{k: a.get(k) for k in AG_KEEP if a.get(k) not in (None, False, "")} for a in r["agency_all"]]
                slim.append(r)
            uni = columnar(slim)
            uni["updated_at"] = snapshot_at
            uni["count"] = len(rows)
            sizes["universe.json"] = dump(out, "universe.json", uni)
            log(f"  universe.json {sizes['universe.json'] / 1024:.0f} КБ ({len(rows)} + {len(extra)} строк)")
        finally:
            db.close()

        get("/api/universe/facets", "facets.json", required=True)
        get("/api/ideas?limit=1000&min_turnover=0", "ideas.json")
        get("/api/rating_curves", "rating_curves.json")
        get("/api/ofz_redemption", "ofz_redemption.json")
        get("/api/placements?mode=current&days=120", "placements_current.json")
        get("/api/placements?mode=history&days=400", "placements_history.json")
        get("/api/auctions", "auctions.json")
        get("/api/ofz_curve", "ofz_curve.json")
        get("/api/instrument/gcurve", "gcurve.json")
        get("/api/cbr_meetings", "cbr_meetings.json")
        get("/api/stock_market_map", "stock_market_map.json")
        get("/api/update_status", "update_status.json")
        # бенчмарки ОФЗ-ПД для спреда к ОФЗ (карточка выпуска считает в браузере)
        try:
            sizes["ofz_benchmarks.json"] = dump(out, "ofz_benchmarks.json", instrument.ofz_benchmarks())
        except Exception as e:  # noqa: BLE001
            log("✗ ofz_benchmarks:", e)
        try:
            kr = instrument.cbr_key_rate()
            if kr is not None:
                dump(out, "key_rate.json", {"rate": kr, "at": datetime.now(timezone.utc).isoformat()})
        except Exception as e:  # noqa: BLE001
            log("✗ key_rate:", e)
        try:
            dump(out, "fx_rates.json", moex.get_fx_rates())
        except Exception as e:  # noqa: BLE001
            log("✗ fx_rates:", e)
        # пересечение с акциями: котировки StockAI (цена, изменение, капитализация, оборот)
        step("stock_quotes", lambda: export_stock_quotes(out))

    # ---------- обновление данных ----------
    if not args.offline:
        def market():
            db = SessionLocal()
            try:
                moex.clear_reference_cache()
                universe.refresh(db)
                if mode == "full":
                    universe.compute_spread_percentiles(db)
            finally:
                db.close()
            universe.invalidate_rows_cache()
        step("market", market)
        if mode == "full":
            # сначала сохраняем рыночный снимок: если тяжёлые шаги упадут или не уложатся во время, он уже на месте
            dump_market()
            from app.services import macro as mc, auctions as auc
            step("schedules", lambda: zspread.refresh_schedules())
            step("calls", lambda: moex_ref.refresh_calls())

            def ref():
                db = SessionLocal()
                try:
                    return moex_ref.rebuild(db)
                finally:
                    db.close()
            step("reference", ref)
            step("ratings", lambda: M._refresh_stale_ratings(0))
            universe.invalidate_rows_cache()
            step("macro", lambda: mc.get_macro(force=True))
            step("auctions", lambda: auc.get_auctions(years=10, force=True))
            step("bank_profits", lambda: mc.get_bank_profits(force=True))
            step("bank_normatives", lambda: mc.get_bank_normatives(force=True))
            step("ofz_histories", lambda: instrument.prewarm_ofz_histories())

    dump_market()

    if mode == "full":
        get("/api/rating_curves/history", "rating_curves_history.json")
        get("/api/rating_actions?limit=300", "rating_actions.json")
        get("/api/issuers/credit", "issuers_credit.json")
        get("/api/macro", "macro.json")
        get("/api/bank_profits", "bank_profits.json")
        get("/api/bank_normatives", "bank_normatives.json")
        for k in ("developers", "leasing", "subfed", "utilities", "retail"):
            get(f"/api/sector/{k}", f"sector_{k}.json")
        get("/api/sector_index", "sector_index.json")
        get("/api/sector/developers/methodology", "sector_developers_methodology.json")
        get("/api/sector/leasing/methodology", "sector_leasing_methodology.json")
        for grp in bond_indices.CATALOG:
            for per in ("1m", "3m", "6m", "ytd", "1y", "3y", "5y", "all"):
                get(f"/api/bond_indices?group={grp}&period={per}", f"indices/bond_{grp}_{per}.json")
        for grp in equity_indices.CATALOG:
            for per in ("1m", "3m", "6m", "ytd", "1y", "3y", "5y", "all"):
                get(f"/api/equity_indices?group={grp}&period={per}", f"indices/equity_{grp}_{per}.json")
        codes = {("bonds", it["code"]) for g in bond_indices.CATALOG.values() for it in g}
        codes |= {("stocks", it["code"]) for g in equity_indices.CATALOG.values() for it in g}
        for asset, code in sorted(codes):
            get(f"/api/index_composition?code={code}&asset={asset}", f"composition/{asset}_{code}.json")
        # история КБД (помесячно, 10 лет) — для исторического G-спреда в браузере
        try:
            sizes["kbd_history.json"] = dump(out, "kbd_history.json", instrument.kbd_history())
        except Exception as e:  # noqa: BLE001
            log("✗ kbd_history:", e)
        step("peer_spreads", lambda: export_peer_spreads(out))
        if not args.skip_ratings:
            step("bond_ratings", lambda: export_bond_ratings(out, c))
        step("emitent_ratings", lambda: export_emitent_ratings(out, c))
        status["full_at"] = datetime.now(timezone.utc).isoformat()

    status.update({
        "mode": mode, "at": datetime.now(timezone.utc).isoformat(), "snapshot_at": snapshot_at,
        "offline": args.offline, "steps": steps, "sizes_kb": {k: round(v / 1024) for k, v in sizes.items()},
        "took_s": round(time.time() - t0),
    })
    status_path.write_text(json.dumps(status, ensure_ascii=False, indent=1))
    log(f"готово за {time.time() - t0:.0f} с")


def export_stock_quotes(out: Path):
    """Котировки акций StockAI: цена/изменение/капитализация/оборот с TQBR (как в stock-terminal-data.json)."""
    from app.services import moex
    p = moex._get("engines/stock/markets/shares/boards/TQBR/securities.json", {
        "iss.only": "securities,marketdata",
        "securities.columns": "SECID,ISIN,PREVPRICE,PREVDATE,ISSUESIZE",
        "marketdata.columns": "SECID,LAST,LASTTOPREVPRICE,ISSUECAPITALIZATION,ISSUECAPITALIZATION_UPDATETIME,UPDATETIME,VALTODAY_RUR,SYSTIME",
    })
    sec = {r["SECID"]: r for r in moex._block(p, "securities")}
    md = {r["SECID"]: r for r in moex._block(p, "marketdata")}
    q = {}
    sys_t = None
    for sid, s in sec.items():
        m = md.get(sid) or {}
        last = moex._to_float(m.get("LAST")) or moex._to_float(s.get("PREVPRICE"))
        if last is None:
            continue
        sys_t = sys_t or m.get("SYSTIME")
        q[sid] = {"price": last, "change": moex._to_float(m.get("LASTTOPREVPRICE")),
                  "cap": moex._to_float(m.get("ISSUECAPITALIZATION")), "turnover": moex._to_float(m.get("VALTODAY_RUR")),
                  "quote_time": m.get("UPDATETIME"), "cap_time": m.get("ISSUECAPITALIZATION_UPDATETIME"),
                  "isin": s.get("ISIN"), "issuesize": moex._to_float(s.get("ISSUESIZE"))}
    if len(q) < 50:
        raise RuntimeError("мало котировок акций")
    dump(out, "stock_quotes.json", {"asof": (sys_t or "")[:10], "fetched_at": datetime.now(timezone.utc).isoformat(), "q": q})


def export_peer_spreads(out: Path):
    """Средний исторический спред по рейтинговой группе (как peers_history: медиана по 10 самым
    ликвидным бумагам бакета той же валюты и типа). Средний по эмитенту браузер считает сам."""
    from statistics import median
    from collections import defaultdict
    from app.db import SessionLocal, BondSnapshot
    from app.services import universe, instrument
    db = SessionLocal()
    try:
        rmap = universe._ratings_map(db)
        rows = [r for r in universe._all_rows(db) if (r.get("numtrades") or 0) > 0]
        groups: dict = defaultdict(list)
        for r in rows:
            b = r.get("agency_bucket") or r.get("rating_bucket")
            if not b or r.get("rating_agency") == "Суверен РФ" or (r.get("secid") or "").startswith("SU"):
                continue
            groups[(r["kind"], b, r.get("currency") or "RUB")].append(r)
        kbd = instrument.kbd_history()
        res = {}
        for (kind, b, ccy), g in groups.items():
            sample = sorted(g, key=lambda r: -(r.get("volume") or 0))[:10]
            series = {}
            for r in sample:
                rt = rmap.get(r["isin"])
                s = db.get(BondSnapshot, r["isin"])
                qm = (rt.float_add if rt else None) or (s.float_qm if s else None)
                series[r["isin"]] = universe._spread_series_cached(r["isin"], kind == "floater", qm, kbd)
            acc: dict = defaultdict(list)
            for i, ser in series.items():
                for d, v in ser:
                    acc[d].append(v)
            need = min(2, len(sample))
            avg = [[d, round(median(vs))] for d, vs in sorted(acc.items()) if len(vs) >= need]
            res[f"{kind}|{b}|{ccy}"] = {"series": avg, "n": len([i for i in series if series[i]]),
                                       "names": [r.get("name") or r["isin"] for r in sample if series.get(r["isin"])]}
        dump(out, "peer_spreads.json", res)
    finally:
        db.close()


def export_bond_ratings(out: Path, c):
    """Рейтинги по каждому выпуску (/api/bonds/{isin}/ratings) — шардами по хэшу ISIN."""
    from app.db import SessionLocal, BondSnapshot
    from app.services import universe
    db = SessionLocal()
    try:
        isins = [s.isin for s in db.query(BondSnapshot.isin).filter(universe._live_filter(db)).all()]
    finally:
        db.close()
    shards: dict = defaultdict_dict()
    n = 0
    for i in isins:
        r = c.get(f"/api/bonds/{i}/ratings")
        if r.status_code != 200:
            continue
        d = r.json()
        if not d.get("agencies") and not d.get("history"):
            d = {k: v for k, v in d.items() if k in ("isin", "emitent_id", "inn")}
        shards[shard_of(i)][i] = d
        n += 1
    for k, v in shards.items():
        dump(out, f"ratings/{k}.json", v)
    log(f"  рейтинги выпусков: {n} в {len(shards)} файлах")


def export_emitent_ratings(out: Path, c):
    from app.db import SessionLocal, BondSnapshot
    db = SessionLocal()
    try:
        eids = sorted({str(s.emitent_id) for s in db.query(BondSnapshot.emitent_id).all() if s.emitent_id})
    finally:
        db.close()
    res = {}
    for e in eids:
        r = c.get(f"/api/ratings/emitent/{e}")
        if r.status_code == 200:
            d = r.json()
            if d.get("agencies"):
                res[e] = d
    dump(out, "emitent_ratings.json", res)
    log(f"  рейтинги эмитентов: {len(res)} из {len(eids)}")


def shard_of(isin: str) -> str:
    return hashlib.md5(isin.encode()).hexdigest()[:2]


def defaultdict_dict():
    from collections import defaultdict
    return defaultdict(dict)


if __name__ == "__main__":
    main()
