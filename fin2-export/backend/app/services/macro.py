"""Макроэкономика РФ для вкладки «Макро».

Всё живое, без Росстат-SDMX (sdmx.gks.ru лежит):
- Ключевая ставка + инфляция ИПЦ (% г/г) + цель — cbr.ru/hd_base/infl
  (это данные Росстата по ИПЦ, которые ЦБ публикует чистой таблицей).
- Денежная масса (M2/M0/широкая) — cbr.ru/dataservice, публикация 5 «Структура
  денежной массы» (obs_val в млрд руб., колонка «Всего»).
- Капитализация рынка акций Мосбиржи — iss.moex.com statistics/capitalization.
- Индекс МосБиржи IMOEX (история, месячные свечи) — iss.moex.com candles interval=31.

Всё обновляется помесячно → кэш 12ч. Каждый источник в своём try/except: сбой одного
не роняет остальные (эндпоинт вернёт то, что удалось собрать)."""
import json
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

import requests

log = logging.getLogger(__name__)

_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
_TTL = 12 * 3600
_cache: dict = {"at": 0.0, "data": None}


def _get(url: str):
    last = None
    for attempt in range(3):  # сети ЦБ/MOEX иногда рвут SSL — 2 ретрая
        try:
            r = requests.get(url, headers={"User-Agent": _UA}, timeout=30)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            last = e
            if attempt < 2:
                time.sleep(0.6)
    raise last


def _num(s: str):
    s = (s or "").replace("\xa0", "").replace(" ", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


_MON_NOM = {"январь": 1, "февраль": 2, "март": 3, "апрель": 4, "май": 5, "июнь": 6, "июль": 7, "август": 8,
            "сентябрь": 9, "октябрь": 10, "ноябрь": 11, "декабрь": 12}
_MON3 = {"янв": 1, "фев": 2, "мар": 3, "апр": 4, "май": 5, "июн": 6, "июл": 7, "авг": 8, "сен": 9, "окт": 10, "ноя": 11, "дек": 12}


def _shift_m(dt: str, k: int = -1) -> str:
    y, m = int(dt[:4]), int(dt[5:7]) + k
    while m < 1:
        y, m = y - 1, m + 12
    while m > 12:
        y, m = y + 1, m - 12
    return f"{y}-{m:02d}"


def _ds_label(r: dict) -> str:
    """Метка периода для строки data-service ЦБ. ЕДИНАЯ конвенция приложения: поток — месяц/
    квартал периода, остаток — «на конец месяца». В data-service поле `date` — 1-е число
    СЛЕДУЮЩЕГО периода (ставки за июль → '2026-08-01'), настоящий период — в `dt`:
    «Июль 2026», «II квартал 2026», «Янв - Июл 2026» (накопленный), «01.08.2026» (остаток
    на 1-е число = конец июля)."""
    dt = (r.get("dt") or "").strip()
    m = re.fullmatch(r"(\d{2})\.(\d{2})\.(\d{4})", dt)
    if m:
        lab = f"{m.group(3)}-{m.group(2)}"
        return _shift_m(lab) if m.group(1) == "01" else lab
    m = re.fullmatch(r"([А-Яа-яё]+)\s+(\d{4})", dt)
    if m and m.group(1).lower() in _MON_NOM:
        return f"{m.group(2)}-{_MON_NOM[m.group(1).lower()]:02d}"
    m = re.fullmatch(r"(IV|I{1,3})\s+квартал\s+(\d{4})", dt)
    if m:
        return f"{m.group(2)}-{({'I': 1, 'II': 4, 'III': 7, 'IV': 10})[m.group(1)]:02d}"
    m = re.fullmatch(r"[А-Яа-яё]+\s*-\s*([А-Яа-яё]+)\s+(\d{4})", dt)       # «Янв - Июл 2026» → конец окна
    if m and m.group(1).lower()[:3] in _MON3:
        return f"{m.group(2)}-{_MON3[m.group(1).lower()[:3]]:02d}"
    return r["date"][:7]


def _eom(series: list) -> list:
    """Остаток «на 1-е число месяца M» → метка конца месяца M−1 (для xlsx-источников ЦБ/Минфина,
    где дата в шапке — 1-е число). Флаги строк (est/prelim) сохраняются."""
    return [{**r, "date": _shift_m(r["date"])} for r in (series or []) if r.get("date") and len(r["date"]) >= 7 and r["date"][4] == "-"]


def _rs_url(page: str, pattern: str, fallback: str) -> str:
    """Актуальная ссылка на файл Росстата со страницы (в имени есть год: «…_2012-2026.xlsx» →
    в 2027 станет «…-2027»); при сбое — известное имя."""
    try:
        from .macro_ext import _link
        return _link("https://rosstat.gov.ru" + page, pattern)
    except Exception:  # noqa: BLE001
        return fallback


_NEDEL_CACHE: dict = {}


def _nedel_ipc_bytes() -> bytes:
    """Недельный файл цен Росстата (Nedel_ipc). Имя меняют регистром букв без предупреждения
    (16.09.2026: «Nedel_ipc.xlsx» заморожен на 07.09, свежий — «nedel_Ipc.xlsx»), поэтому берём
    ссылку со страницы цен без учёта регистра + известные варианты и выбираем файл с самой
    поздней неделей. Кэш 10 минут — файл читают и недельный ИПЦ, и тепловая карта."""
    import io as _io
    import time as _time
    import openpyxl
    if _NEDEL_CACHE.get("at", 0) > _time.time() - 600:
        return _NEDEL_CACHE["data"]
    base = "https://rosstat.gov.ru/storage/mediabank/"
    urls = []
    try:
        from .macro_ext import _link
        urls.append(_link("https://rosstat.gov.ru/statistics/price", r"(?i:nedel_ipc\.xlsx)"))
    except Exception as e:  # noqa: BLE001
        log.warning("nedel_ipc link: %s", e)
    urls += [base + n for n in ("nedel_Ipc.xlsx", "Nedel_ipc.xlsx", "nedel_ipc.xlsx")]
    mon = {m: i for i, m in enumerate(["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
                                       "сентября", "октября", "ноября", "декабря"], 1)}
    best, best_key = None, None
    for u in dict.fromkeys(urls):
        try:
            data = _rosstat_get(u)
            wb = openpyxl.load_workbook(_io.BytesIO(data), read_only=True, data_only=True)
            year = max(n for n in wb.sheetnames if n.isdigit())
            last = (0, 0)
            for r in wb[year].iter_rows(values_only=True, max_row=15):
                for c in r:
                    mm = re.search(r"на\s+(\d{1,2})\s+([а-яё]+)", str(c or "").lower())
                    if mm and mm.group(2) in mon:
                        last = max(last, (mon[mm.group(2)], int(mm.group(1))))
            key = (int(year),) + last
            if best_key is None or key > best_key:
                best, best_key = data, key
        except Exception as e:  # noqa: BLE001
            log.warning("nedel_ipc %s: %s", u, e)
    if best is None:
        raise RuntimeError("недельный файл цен Росстата недоступен")
    _NEDEL_CACHE.update(at=_time.time(), data=best)
    return best


def key_rate_inflation(frm: str = "01.01.2013") -> list[dict]:
    """[{date:'YYYY-MM', rate, cpi, target}] по возрастанию.
    rate — ключевая ставка (до 2013 — ставка рефинансирования), cpi — ИПЦ % г/г.
    Даты у страницы инфляции ЦБ — в формате ДД.ММ.ГГГГ (иначе фильтр игнорируется)."""
    to = datetime.now().strftime("01.%m.%Y")
    url = (f"https://www.cbr.ru/hd_base/infl/?UniDbQuery.Posted=True"
           f"&UniDbQuery.From={frm}&UniDbQuery.To={to}")
    html = _get(url).text
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        cells = [re.sub(r"<[^>]+>", "", c).strip()
                 for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
        if len(cells) < 4 or not re.match(r"\d{2}\.\d{4}$", cells[0]):
            continue
        mm, yy = cells[0].split(".")
        out.append({"date": f"{yy}-{mm}", "rate": _num(cells[1]),
                    "cpi": _num(cells[2]), "target": _num(cells[3])})
    out.sort(key=lambda x: x["date"])
    return out


def _ds_total(pub: int, ds: int, y1: int, y2: int) -> list[dict]:
    """Ряд «Всего» (первая колонка headerData) из data-service ЦБ → [{date,val}]."""
    url = (f"https://www.cbr.ru/dataservice/data?y1={y1}&y2={y2}"
           f"&publicationId={pub}&datasetId={ds}")
    d = _get(url).json()
    hd = d.get("headerData", [])
    col = hd[0]["id"] if hd else None
    s = [{"date": _ds_label(r), "val": r["obs_val"]}
         for r in d.get("RawData", []) if r.get("colId") == col and r.get("obs_val") is not None]
    s.sort(key=lambda x: x["date"])
    return s


def money_supply(y1: int = 2013) -> dict:
    y2 = datetime.now().year
    out = {}
    for key, ds in (("m2", 7), ("m1", 6), ("m0", 5), ("broad", 8)):
        try:
            out[key] = _ds_total(5, ds, y1, y2)
        except Exception as e:  # noqa: BLE001 — best-effort per series
            log.warning("money_supply %s: %s", key, e)
            out[key] = []
    return out


def lending(y1: int = 2015) -> dict:
    """Задолженность по кредитам, млрд руб: физлица и юрлица. Требует measureId=22
    («Российская Федерация» — регион). Значения в источнике в млн руб → делим на 1000."""
    y2 = datetime.now().year
    out = {}
    for key, pub, ds in (("retail", 20, 42), ("corporate", 22, 50)):
        try:
            url = (f"https://www.cbr.ru/dataservice/data?y1={y1}&y2={y2}"
                   f"&publicationId={pub}&datasetId={ds}&measureId=22")
            d = _get(url).json()
            hd = d.get("headerData", [])
            col = hd[0]["id"] if hd else None  # «Всего»
            s = [{"date": _ds_label(r), "val": r["obs_val"] / 1000.0}
                 for r in d.get("RawData", []) if r.get("colId") == col and r.get("obs_val") is not None]
            s.sort(key=lambda x: x["date"])
            out[key] = s
        except Exception as e:  # noqa: BLE001
            log.warning("lending %s: %s", key, e)
            out[key] = []
    return out


def fx(y1: int = 2015) -> dict:
    """Номинальный курс к рублю на конец периода (месяц): USD/EUR/CNY."""
    y2 = datetime.now().year
    url = (f"https://www.cbr.ru/dataservice/data?y1={y1}&y2={y2}"
           f"&publicationId=33&datasetId=127")
    d = _get(url).json()
    m = {98: "usd", 99: "eur", 100: "cny"}
    out = {"usd": [], "eur": [], "cny": []}
    for r in d.get("RawData", []):
        k = m.get(r.get("colId"))
        if k and r.get("obs_val") is not None:
            out[k].append({"date": _ds_label(r), "val": r["obs_val"]})
    for k in out:
        out[k].sort(key=lambda x: x["date"])
    return out


def current_account(y1: int = 2015) -> list[dict]:
    """Сальдо счёта текущих операций платёжного баланса, млн долл. США (квартально)."""
    y2 = datetime.now().year
    url = (f"https://www.cbr.ru/dataservice/data?y1={y1}&y2={y2}"
           f"&publicationId=8&datasetId=9")
    d = _get(url).json()
    hd = d.get("headerData", [])
    col = hd[0]["id"] if hd else None
    s = [{"date": r["date"][:7], "val": r["obs_val"]}
         for r in d.get("RawData", []) if r.get("colId") == col and r.get("obs_val") is not None]
    s.sort(key=lambda x: x["date"])
    # data-service обновляется раз в квартал с лагом; «Оценка платежного баланса» (bop_est.xlsx, ~14-е
    # число) даёт следующий квартал раньше → дописываем (метка как у ЦБ: 1-е число после квартала)
    try:
        import io as _io
        import openpyxl
        rows = list(openpyxl.load_workbook(_io.BytesIO(_get("https://www.cbr.ru/vfs/statistics/credit_statistics/bop/bop_est.xlsx").content),
                                           read_only=True, data_only=True).worksheets[0].iter_rows(values_only=True))
        hdr = next(r for r in rows if any(isinstance(c, str) and "квартал" in c for c in r))
        row = next(r for r in rows if isinstance(r[0], str) and r[0].strip().lower().startswith("счет текущих операций"))
        have = {x["date"] for x in s}
        for j, c in enumerate(hdr):
            m = re.search(r"(I{1,3}V?|IV) квартал\s*(\d{4})", str(c or "").replace("\n", " "))
            if m and isinstance(row[j], (int, float)):
                q = {"I": 1, "II": 2, "III": 3, "IV": 4}[m.group(1)]
                y, mo = (int(m.group(2)) + 1, 1) if q == 4 else (int(m.group(2)), q * 3 + 1)
                dt = f"{y}-{mo:02d}"
                if dt not in have and (not s or dt > s[-1]["date"]):
                    s.append({"date": dt, "val": round(row[j] * 1000, 1), "est": "оценка" in str(c).lower()})
        s.sort(key=lambda x: x["date"])
    except Exception as e:  # noqa: BLE001
        log.warning("current_account est: %s", e)
    return _q_start(s)


def _q_start(s: list) -> list:
    """data-service ЦБ датирует квартальный поток 1-м числом СЛЕДУЮЩЕГО квартала ('2025-04-01' =
    I кв. 2025). Приводим к началу самого квартала ('2025-01'), иначе подписи «I–IV кв.» и
    свёртка по годам сдвигаются на квартал."""
    out = []
    for r in s:
        y, m = int(r["date"][:4]), int(r["date"][5:7]) - 3
        if m < 1:
            y, m = y - 1, m + 12
        out.append({**r, "date": f"{y}-{m:02d}"})
    return out


def _ds_multi(pub: int, ds: int, meas=None, y1: int = 2015):
    """Все столбцы датасета data-service → (names{colId:elname}, cols{colId:[{date,val}]})."""
    y2 = datetime.now().year
    url = (f"https://www.cbr.ru/dataservice/data?y1={y1}&y2={y2}"
           f"&publicationId={pub}&datasetId={ds}") + (f"&measureId={meas}" if meas else "")
    d = _get(url).json()
    names = {h["id"]: h["elname"] for h in d.get("headerData", [])}
    cols: dict = {}
    for r in d.get("RawData", []):
        if r.get("obs_val") is None:
            continue
        cols.setdefault(r["colId"], []).append({"date": _ds_label(r), "val": r["obs_val"]})
    for c in cols:
        cols[c].sort(key=lambda x: x["date"])
    return names, cols


def _pick(names: dict, cols: dict, *subs) -> list:
    """Первый столбец, чьё имя содержит все подстроки (регистр не важен)."""
    for cid, nm in names.items():
        low = (nm or "").lower()
        if all(s.lower() in low for s in subs):
            return cols.get(cid, [])
    return []


def deposit_rates(y1: int = 2014) -> dict:
    """Ставки по вкладам в рублях, % годовых: физлица и юрлица, до/свыше 1 года."""
    out = {}
    n1, c1 = _ds_multi(18, 37, 2, y1)  # физлица
    out["short"] = _pick(n1, c1, "до 1 года", "включая")
    out["long"] = _pick(n1, c1, "свыше 1 года")
    try:
        n2, c2 = _ds_multi(18, 38, 2, y1)  # юрлица
        out["corp_short"] = _pick(n2, c2, "до 1 года", "включая")
        out["corp_long"] = _pick(n2, c2, "свыше 1 года")
    except Exception as e:  # noqa: BLE001
        log.warning("deposit_rates corp: %s", e)
    return out


def credit_rates(y1: int = 2014) -> dict:
    """Ставки по кредитам в рублях, % годовых: юрлица и физлица, до/свыше 1 года."""
    out = {}
    n1, c1 = _ds_multi(14, 25, 2, y1)  # юрлица
    out["corp_short"] = _pick(n1, c1, "до 1 года", "включая")
    out["corp_long"] = _pick(n1, c1, "свыше 1 года")
    try:
        n2, c2 = _ds_multi(14, 27, 2, y1)  # физлица
        out["retail_short"] = _pick(n2, c2, "до 1 года", "включая")
        out["retail_long"] = _pick(n2, c2, "свыше 1 года")
    except Exception as e:  # noqa: BLE001
        log.warning("credit_rates retail: %s", e)
    return out


def business_climate(y1: int = 2014) -> dict:
    """Мониторинг предприятий ЦБ (исходные данные): бизнес-климат, ценовые ожидания,
    спрос, производство, издержки, условия кредитования (балансы ответов)."""
    names, cols = _ds_multi(25, 58, 118, y1)
    return {
        "climate": _pick(names, cols, "индикатор бизнес-климата банка россии"),
        "price_exp": _pick(names, cols, "ценовые ожидания"),
        "demand": _pick(names, cols, "спрос на продукцию", "как изменился"),
        "production": _pick(names, cols, "объем производства", "как изменился"),
        "costs": _pick(names, cols, "издержки"),
        "credit_cond": _pick(names, cols, "условия кредитования"),
    }


def npl(y1: int = 2015) -> dict:
    """Просроченная задолженность по кредитам, млрд руб (в источнике млн → /1000):
    физлица и юрлица. Требует measureId=22 (РФ)."""
    out = {}
    for key, pub, ds in (("retail", 20, 43), ("corporate", 22, 51)):
        try:
            n, c = _ds_multi(pub, ds, 22, y1)
            s = _pick(n, c, "всего")
            out[key] = [{"date": x["date"], "val": x["val"] / 1000.0} for x in s]
        except Exception as e:  # noqa: BLE001
            log.warning("npl %s: %s", key, e)
            out[key] = []
    return out


def mortgage_debt(y1: int = 2015) -> list:
    """Задолженность по ипотечным жилищным кредитам, млрд руб (млн → /1000)."""
    n, c = _ds_multi(21, 46, 22, y1)
    s = _pick(n, c, "всего")
    return [{"date": x["date"], "val": x["val"] / 1000.0} for x in s]


def mortgage_npl(y1: int = 2015) -> list:
    """Просроченная задолженность по ипотечным жилищным кредитам, млрд руб (млн → /1000), с 02.2019."""
    n, c = _ds_multi(21, 47, 22, y1)
    s = _pick(n, c, "всего")
    return [{"date": x["date"], "val": x["val"] / 1000.0} for x in s]


def mortgage_issue(y1: int = 2015) -> list:
    """Объём выдачи ипотечных жилищных кредитов за месяц, млрд руб (млн → /1000)."""
    n, c = _ds_multi(21, 45, 22, y1)
    s = _pick(n, c, "всего") or next(iter(c.values()), [])
    return [{"date": x["date"], "val": x["val"] / 1000.0} for x in s]


def msp_lending(y1: int = 2018) -> list:
    """Задолженность по кредитам субъектам МСП, млрд руб (млн → /1000)."""
    n, c = _ds_multi(23, 53, 22, y1)
    s = _pick(n, c, "всего")
    return [{"date": x["date"], "val": x["val"] / 1000.0} for x in s]


def capacity_util(y1: int = 2015) -> list:
    """Загрузка производственных мощностей, % (мониторинг предприятий ЦБ, «экономика всего»)."""
    n, c = _ds_multi(25, 75, 118, y1)
    return _pick(n, c, "экономика всего")


def fin_investments(y1: int = 2015) -> dict:
    """Сальдо прямых и портфельных инвестиций (фин. счёт платёжного баланса), млн $, квартал."""
    out = {}
    for key, ds in (("direct", 19), ("portfolio", 20)):
        try:
            n, c = _ds_multi(11, ds, None, y1)
            out[key] = _pick(n, c, "сальдо")        # _ds_label: «I квартал 2026» → '2026-01' 
        except Exception as e:  # noqa: BLE001
            log.warning("fin_investments %s: %s", key, e)
            out[key] = []
    return out


def reer(y1: int = 2014) -> dict:
    """Индексы эффективного курса рубля, % к соответствующему периоду пред. года
    (measureId=149): реальный (REER) и номинальный."""
    out = {}
    for key, ds in (("real", 132), ("nominal", 130)):
        try:
            _, c = _ds_multi(34, ds, 149, y1)
            out[key] = next(iter(c.values()), [])
        except Exception as e:  # noqa: BLE001
            log.warning("reer %s: %s", key, e)
            out[key] = []
    return out


def _hd_rows(url: str) -> list[list[str]]:
    """Строки таблицы hd_base ЦБ, где первая ячейка — дата ДД.ММ.ГГГГ."""
    html = _get(url).text
    out = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        cells = [re.sub(r"<[^>]+>", "", c).strip()
                 for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        if cells and re.match(r"\d{2}\.\d{2}\.\d{4}", cells[0]):
            out.append(cells)
    return out


def _monthly_last(rows: list, date_i: int, val_i: int) -> list[dict]:
    """Из дневных строк (новые сверху) → помесячно, значение на конец месяца."""
    seen, out = set(), []
    for r in rows:  # строки идут от новых к старым → первое вхождение месяца = конец месяца
        try:
            dd, mm, yy = r[date_i].split(".")
            key = f"{yy}-{mm}"
            val = _num(r[val_i])
        except (ValueError, IndexError):
            continue
        if key in seen or val is None:
            continue
        seen.add(key)
        out.append({"date": key, "val": val})
    out.sort(key=lambda x: x["date"])
    return out


def ruonia(frm: str = "01.01.2014") -> list[dict]:
    """Ставка RUONIA (руб. овернайт), % годовых, помесячно (конец месяца; текущий месяц — последнее значение)."""
    to = datetime.now().strftime("%d.%m.%Y")
    url = (f"https://www.cbr.ru/hd_base/ruonia/dynamics/?UniDbQuery.Posted=True"
           f"&UniDbQuery.From={frm}&UniDbQuery.To={to}")
    return _monthly_last(_hd_rows(url), 0, 1)


def metals(frm: str = "01.01.2014") -> dict:
    """Учётные цены ЦБ на драгметаллы, ₽/грамм, помесячно: золото/серебро/платина/палладий."""
    to = datetime.now().strftime("%d.%m.%Y")
    url = (f"https://www.cbr.ru/hd_base/metall/metall_base_new/?UniDbQuery.Posted=True"
           f"&UniDbQuery.From={frm}&UniDbQuery.To={to}"
           f"&UniDbQuery.Gold=true&UniDbQuery.Silver=true&UniDbQuery.Platinum=true&UniDbQuery.Palladium=true&UniDbQuery.so=1")
    rows = _hd_rows(url)  # [дата, золото, серебро, платина, палладий]
    return {"gold": _monthly_last(rows, 0, 1), "silver": _monthly_last(rows, 0, 2),
            "platinum": _monthly_last(rows, 0, 3), "palladium": _monthly_last(rows, 0, 4)}


_RU_MON = {"января": 1, "февраля": 2, "марта": 3, "апреля": 4, "мая": 5, "июня": 6,
           "июля": 7, "августа": 8, "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12}


_RS_SEM = threading.BoundedSemaphore(3)  # Росстат отвечает 503, если качать >3 файлов разом


def _rosstat_get(url: str) -> bytes:
    """Скачать файл Росстата. У rosstat.gov.ru НЕВАЛИДНЫЙ SSL-сертификат (не блокировка IP!)
    → verify=False. С этим и Mac, и VPS достают Росстат напрямую (проверено).
    Не больше 3 загрузок одновременно + ретраи на 503/обрыв (сервер ограничивает частоту)."""
    import urllib3
    urllib3.disable_warnings()
    last = None
    for attempt in range(4):
        with _RS_SEM:
            try:
                r = requests.get(url, headers={"User-Agent": _UA}, timeout=60, verify=False)
                if r.status_code < 500:
                    r.raise_for_status()
                    return r.content
                last = requests.HTTPError(f"{r.status_code} for {url}")
            except requests.RequestException as e:
                last = e
        time.sleep(1.5 * (attempt + 1))
    raise last


def rosstat_weekly_cpi() -> list:
    """Недельная инфляция РФ, % за неделю (Росстат, с 2022). Взвешенная по весам ИПЦ оценка
    из недельного файла (покрывает ~37% корзины — без ряда услуг; точный headline у Росстата
    только в тексте релиза). Источник — Nedel_ipc.xlsx + Vesa-tov-KIPC_2012-2026.xlsx."""
    import io as _io
    import openpyxl
    wbv = openpyxl.load_workbook(_io.BytesIO(_rosstat_get(
        _rs_url("/statistics/price", r"Vesa-tov-KIPC_\d{4}-\d{4}\.xlsx", "https://rosstat.gov.ru/storage/mediabank/Vesa-tov-KIPC_2012-2026.xlsx"))), read_only=True, data_only=True)
    wsv = wbv[max((n for n in wbv.sheetnames if n.isdigit()), default=wbv.sheetnames[-1])]   # веса текущего года
    weights = {}
    for r in wsv.iter_rows(values_only=True):
        if len(r) >= 3 and isinstance(r[1], str) and isinstance(r[2], (int, float)):
            weights[r[1].strip().lower()] = r[2]
    wb = openpyxl.load_workbook(_io.BytesIO(_nedel_ipc_bytes()), read_only=True, data_only=True)
    out = []
    for sn in [s for s in wb.sheetnames if s.isdigit()]:
        rows = list(wb[sn].iter_rows(values_only=True))
        hi = next((i for i, r in enumerate(rows)
                   if sum(1 for c in r if isinstance(c, str) and re.search(r"на\s+\d{1,2}\s+[а-яё]+", c.lower())) >= 3), None)
        if hi is None:
            continue
        hdr = rows[hi]
        for j in range(1, len(hdr)):
            lbl = hdr[j]
            if not isinstance(lbl, str):
                continue
            mm = re.search(r"на\s+(\d{1,2})\s+([а-яё]+)", lbl.lower())
            if not mm or mm.group(2) not in _RU_MON:
                continue
            date = f"{sn}-{_RU_MON[mm.group(2)]:02d}-{int(mm.group(1)):02d}"
            tw, acc = 0.0, 0.0
            for r in rows[hi + 1:]:
                nm = r[0].strip().lower() if isinstance(r[0], str) else None
                v = r[j] if j < len(r) and isinstance(r[j], (int, float)) else None
                if nm and v is not None and nm in weights:
                    tw += weights[nm]; acc += weights[nm] * (v - 100)
            if tw > 0:
                out.append({"date": date, "val": round(acc / tw, 3)})
    out.sort(key=lambda x: x["date"])
    return out


def _rosstat_quarterly(ws) -> list:
    """Разобрать квартальный лист Росстата: строка лет → строка кварталов (I…IV) → значения.
    Годы могут иметь сноски ('20222)'); квартальные блоки — стопкой по листу."""
    rows = list(ws.iter_rows(values_only=True))
    qmap = {"i квартал": 1, "ii квартал": 2, "iii квартал": 3, "iv квартал": 4}
    out = {}
    for qi, r in enumerate(rows):
        if qi == 0 or qi + 1 >= len(rows):
            continue
        if sum(1 for c in r if isinstance(c, str) and "квартал" in str(c).lower()) < 3:
            continue
        yrow, qrow, vrow = rows[qi - 1], r, rows[qi + 1]
        cur = None
        for j in range(len(qrow)):
            yv = yrow[j] if j < len(yrow) else None
            m = re.match(r"\s*(19|20)\d{2}", str(yv)) if yv is not None else None
            if m:
                y = int(m.group(0).strip())
                if 1995 <= y <= 2030:
                    cur = str(y)
            q = qmap.get(str(qrow[j]).strip().lower()) if qrow[j] else None
            val = vrow[j] if j < len(vrow) and isinstance(vrow[j], (int, float)) else None
            if cur and q and val is not None:
                out[f"{cur}-Q{q}"] = val
    return [{"date": k, "val": out[k]} for k in sorted(out)]


def rosstat_gdp() -> dict:
    """ВВП РФ квартально (Росстат): номинальный (в текущих ценах, млрд руб) и рост % г/г
    (индекс физобъёма, к соотв. кварталу пред. года). VVP_kvartal_s-1995-2026.xlsx:
    листы 1+2 — номинал 1995→2026, листы 11+12 — индекс физобъёма."""
    import io as _io
    import openpyxl
    wb = openpyxl.load_workbook(_io.BytesIO(_rosstat_get(
        _rs_url("/statistics/accounts", r"VVP_kvartal_s-\d{4}-\d{4}\.xlsx", "https://rosstat.gov.ru/storage/mediabank/VVP_kvartal_s-1995-2026.xlsx"))), read_only=True, data_only=True)

    def _merge(sheets):
        m = {}
        for sn in sheets:
            if sn in wb.sheetnames:
                for x in _rosstat_quarterly(wb[sn]):
                    m[x["date"]] = x["val"]
        return [{"date": k, "val": m[k]} for k in sorted(m)]

    nominal = _merge(["1", "2"])
    growth = [{"date": x["date"], "val": round(x["val"] - 100, 2)} for x in _merge(["11", "12"])]
    return {"nominal": nominal, "growth": growth}


def inflation_expectations() -> dict:
    """Инфляционные ожидания населения (инФОМ, ЦБ) помесячно с 2009: медиана ожидаемой
    инфляции на год вперёд и наблюдаемая инфляция. Источник — Infl_exp_YY-MM.xlsx с
    cbr.ru/statistics/ddkp/inflationary_expectations/ (лист «Данные за все годы»)."""
    import io as _io
    import openpyxl
    page = _get("https://www.cbr.ru/statistics/ddkp/inflationary_expectations/").text
    m = re.search(r'href="(/Collection/Collection/File/\d+/Infl_exp_[^"]+\.xlsx)"', page)
    if not m:
        raise RuntimeError("не найден xlsx инФОМ")
    content = _get("https://www.cbr.ru" + m.group(1)).content
    wb = openpyxl.load_workbook(_io.BytesIO(content), read_only=True, data_only=True)
    ws = wb["Данные за все годы"] if "Данные за все годы" in wb.sheetnames else wb[wb.sheetnames[-1]]
    rows = list(ws.iter_rows(values_only=True))
    hi = next(i for i, r in enumerate(rows) if sum(isinstance(c, datetime) for c in r) >= 6)
    dcols = _minfin_dcols(rows[hi])

    def series(*subs):
        for r in rows[hi + 1:]:
            lbl = next((c for c in r[:3] if isinstance(c, str) and len(c) > 5), None)
            if lbl and all(s in lbl.lower() for s in subs):
                return [{"date": dt, "val": r[j]} for j, dt in dcols if isinstance(r[j], (int, float))]
        return []

    return {"expected": series("ожидаемая инфляция (в %)"), "observed": series("наблюдаемая инфляция (в %)")}


def banking_sector() -> dict:
    """Динамика банковского сектора РФ, % прироста г/г (обзор банковского сектора ЦБ,
    помесячно): активы, капитал, кредиты юрл/физл, средства (депозиты) физл/юрл.
    Источник — свежий obs_NNN.xlsx с cbr.ru/statistics/bank_sector/review/ (лист «2»)."""
    import io as _io
    import openpyxl
    page = _get("https://www.cbr.ru/statistics/bank_sector/review/").text
    m = re.search(r'href="(/Collection/Collection/File/\d+/obs_\d+\.xlsx)"', page)
    if not m:
        raise RuntimeError("не найдена ссылка на obs_NNN.xlsx")
    content = _get("https://www.cbr.ru" + m.group(1)).content
    wb = openpyxl.load_workbook(_io.BytesIO(content), read_only=True, data_only=True)
    ws = wb["2"] if "2" in wb.sheetnames else wb[wb.sheetnames[1]]
    rows = list(ws.iter_rows(values_only=True))
    hi = next(i for i, r in enumerate(rows) if sum(isinstance(c, datetime) for c in r) >= 6)
    dcols = _minfin_dcols(rows[hi])
    labels = {"активы": "assets", "собственные средства": "capital",
              "кредиты юридических": "corp_loans", "кредиты физических": "retail_loans",
              "средства физических": "retail_deposits", "средства юридических": "corp_deposits"}
    out: dict = {}
    mom: dict = {}
    cur = None
    for r in rows[hi + 1:]:
        lbl = next((c for c in r[:3] if isinstance(c, str) and c.strip()), None)
        if not lbl:
            continue
        low = lbl.lower()
        matched = next((v for k, v in labels.items() if k in low), None)
        if matched:
            cur = matched
            low = " ".join(str(c).lower() for c in r[:4] if isinstance(c, str))   # «Активы | За 1 мес.» — в одной строке
        if "за 1 мес" in low and cur:
            mom[cur] = {dt: r[j] for j, dt in dcols if isinstance(r[j], (int, float))}
        elif "за 12 мес" in low and cur and cur not in out:
            out[cur] = [{"date": dt, "val": r[j]} for j, dt in dcols if isinstance(r[j], (int, float))]
    # уровни, млрд ₽: помесячных остатков в обзоре нет — только на 1 января (табл. 1) и темпы
    # (табл. 2, без валютной переоценки). Внутри года: январский уровень × цепочка месячных темпов,
    # расхождение со следующим 1 января (переоценка и пр.) разносим равномерно по месяцам;
    # после последнего 1 января — просто цепочка темпов. До 2021 — назад по годовым темпам.
    try:
        out["levels"] = _bank_levels(wb, out, mom)
    except Exception as e:  # noqa: BLE001
        log.warning("banking levels: %s", e)
    # обзор ЦБ датирован «на 1-е число» → метка конца предыдущего месяца (единая конвенция)
    res = {k: _eom(v) for k, v in out.items() if k != "levels"}
    res["levels"] = {k: _eom(v) for k, v in (out.get("levels") or {}).items()}
    return res


def _bank_levels(wb, yoy: dict, mom: dict) -> dict:
    ws = wb["1"]
    rows = list(ws.iter_rows(values_only=True))
    hi = next(i for i, r in enumerate(rows) if sum(isinstance(c, datetime) for c in r) >= 3)
    ycols = [(j, c.strftime("%Y-%m")) for j, c in enumerate(rows[hi]) if isinstance(c, datetime)]
    pats = {"assets": r"^активы", "capital": r"^собственные средства", "corp_loans": r"^корпоративные кредиты, включая",
            "retail_loans": r"^кредиты, предоставленные физлицам", "retail_deposits": r"^вклады физлиц",
            "corp_deposits": r"^депозиты и средства корпоративных"}
    anch: dict = {}
    for r in rows[hi + 1:]:
        lbl = next((c for c in r[1:3] if isinstance(c, str) and c.strip() and not re.fullmatch(r"[\d.]+", c.strip())), None)
        if not lbl:
            continue
        low = re.sub(r"\d(?=\s|$)", "", lbl.lower()).strip()
        for k, p in pats.items():
            if k not in anch and re.search(p, low):
                anch[k] = {dt: float(r[j]) for j, dt in ycols if isinstance(r[j], (int, float))}
    out = {}
    for k, A in anch.items():
        g = mom.get(k, {})
        months = sorted(g)
        lv: dict = dict(A)
        ys = sorted(A)
        for a0, a1 in zip(ys, ys[1:] + [None]):
            seg = [dt for dt in months if dt > a0 and (a1 is None or dt <= a1)]
            chain, idx = 1.0, {}
            for dt in seg:
                chain *= 1 + g[dt] / 100
                idx[dt] = chain
            if not seg:
                continue
            adj = (A[a1] / (A[a0] * idx[a1])) if (a1 and a1 in idx) else 1.0
            n = len(seg)
            for i, dt in enumerate(seg, 1):
                lv[dt] = A[a0] * idx[dt] * adj ** (i / n)
        # назад от первого 1 января по годовым темпам (2018–2020 — в табл. 2 только январи)
        y12 = {x["date"]: x["val"] for x in yoy.get(k, [])}
        first = ys[0]
        cur_dt, cur_v = first, A[first]
        while cur_dt in y12:
            prev = f"{int(cur_dt[:4]) - 1}{cur_dt[4:]}"
            cur_v = cur_v / (1 + y12[cur_dt] / 100)
            lv[prev] = cur_v
            cur_dt = prev
        out[k] = [{"date": dt, "val": round(lv[dt], 1)} for dt in sorted(lv)]
    return out


def gdp() -> list:
    """Номинальный ВВП РФ, млрд руб, годовой. Источник — World Bank (NY.GDP.MKTP.CN,
    текущие рубли); Росстат/ЕМИСС напрямую недоступны, WB републикует те же данные."""
    url = "https://api.worldbank.org/v2/country/RUS/indicator/NY.GDP.MKTP.CN?format=json&per_page=45"
    d = _get(url).json()
    if not (isinstance(d, list) and len(d) > 1 and isinstance(d[1], list)):
        return []
    out = [{"date": r["date"], "val": r["value"] / 1e9} for r in d[1] if r.get("value")]  # руб → млрд
    out.sort(key=lambda x: x["date"])
    return out


_RU3 = {"янв": 1, "фев": 2, "мар": 3, "апр": 4, "май": 5, "мая": 5, "июн": 6, "июл": 7, "авг": 8,
        "сен": 9, "окт": 10, "ноя": 11, "дек": 12}


def _minfin_dcols(hdr) -> list:
    """Колонки-месяцы в шапке xlsx Минфина → [(j, 'YYYY-MM')]. Часть месяцев там не дата, а
    текст со сноской ('фев.26 ***', 'июл.26 **') — без их разбора месяцы терялись (в т.ч.
    последние), а пропущенный месяц «вливался» в следующий при раскладке накопленных сумм."""
    out = []
    for j, c in enumerate(hdr):
        if isinstance(c, datetime):
            out.append((j, c.strftime("%Y-%m")))
        elif isinstance(c, str):
            m = re.match(r"\s*([а-яё]{3})[а-яё]*\.?\s*(\d{4}|\d{2})\b", c.lower())
            if m and m.group(1) in _RU3:
                yy = int(m.group(2)) + (2000 if len(m.group(2)) == 2 else 0)
                out.append((j, f"{yy}-{_RU3[m.group(1)]:02d}"))
    return out


def budget() -> dict:
    """Исполнение федерального бюджета РФ, помесячно (млрд руб): доходы (всего/нефтегаз/
    ненефтегаз), расходы, дефицит(−)/профицит(+). Источник — Минфин «Краткая ежемесячная
    информация» (xlsx, накоплено с начала года → раскладываем на месячные)."""
    import io as _io
    import openpyxl
    page = _get("https://minfin.gov.ru/ru/statistics/fedbud/").text
    m = re.search(r'href="([^"]*109-111[^"]*mes\.xlsx)"', page)
    if not m:
        raise RuntimeError("не найдена ссылка на месячный xlsx бюджета")
    url = "https://minfin.gov.ru" + m.group(1)
    content = requests.get(url, headers={"User-Agent": _UA, "Referer": "https://minfin.gov.ru/ru/statistics/fedbud/"}, timeout=40).content
    wb = openpyxl.load_workbook(_io.BytesIO(content), read_only=True, data_only=True)
    ws = wb["месяц"] if "месяц" in wb.sheetnames else wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    hdr = next((r for r in rows[:6] if sum(isinstance(c, datetime) for c in r) > 6), None)
    if hdr is None:
        raise RuntimeError("не найдена строка дат в бюджете")
    dcols = _minfin_dcols(hdr)

    def uncum(cells):
        # накопленные с начала года → помесячные. После пропуска (нечисловая ячейка) следующий
        # месяц НЕ получает всё накопленное (ложный всплеск) — он тоже None.
        out, prev, py, gap = [], None, None, False
        for j, dt in dcols:
            v = cells[j] if j < len(cells) else None
            y = dt[:4]
            if not isinstance(v, (int, float)):
                out.append({"date": dt, "val": None}); gap = gap or py == y or py is None; continue
            if y != py:
                gap = False
                out.append({"date": dt, "val": v if dt.endswith("-01") else None})
            else:
                out.append({"date": dt, "val": None if gap else v - prev})
                gap = False
            prev, py = v, y
        return out

    def find(*subs, excl=None):
        for r in rows:
            lbl = r[1] if len(r) > 1 else None
            if isinstance(lbl, str):
                low = lbl.lower()
                if all(s in low for s in subs) and not (excl and excl in low):
                    return uncum(r)
        return []

    out = {
        "revenue": find("доходы, всего"),
        "oilgas": find("нефтегазовые доходы", excl="ненефтегаз"),
        "nonoilgas": find("ненефтегазовые доходы"),
        "spending": find("расходы, всего"),
        "balance": find("дефицит", "профицит"),
        "debt_service": find("обслуживание государственного"),   # расходы на госдолг
        "net_internal_debt": find("сальдо внутреннего долга"),   # чистое размещение ОФЗ
    }
    # xlsx Минфин обновляет с опозданием на недели; «Предварительная оценка исполнения за январь–N»
    # (пресс-релиз, ~9-е число) выходит раньше → дописываем месяц N как разницу накопленных сумм
    try:
        pre = _minfin_prelim()
        if pre:
            last = max((r["date"] for r in out["revenue"] if r["val"] is not None), default="")
            if pre["date"] == _shift_m(last, 1) and pre["date"][:4] == last[:4]:   # ровно следующий месяц
                y = pre["date"][:4]
                for k in ("revenue", "oilgas", "nonoilgas", "spending", "balance"):
                    if k in pre["cum"] and out[k]:
                        ytd = sum(r["val"] for r in out[k] if r["date"].startswith(y) and r["val"] is not None)
                        out[k] = [r for r in out[k] if r["date"] != pre["date"]] + [{"date": pre["date"], "val": pre["cum"][k] - ytd, "prelim": True}]
                out["prelim"] = {"date": pre["date"], "url": pre["url"], "published": pre["published"]}
    except Exception as e:  # noqa: BLE001
        log.warning("budget prelim: %s", e)
    return out


def _minfin_prelim() -> dict | None:
    """Последняя «Предварительная оценка исполнения федерального бюджета за январь-<месяц> ГГГГ»:
    накопленные с начала года доходы / нефтегаз / ненефтегаз / расходы / дефицит, млрд ₽."""
    import html as _html
    t = _get("https://minfin.gov.ru/ru/press-center/").text
    m = re.search(r'href="([^"]*predvaritelnaya_otsenka_ispolneniya_federalnogo_byudzheta[^"]*)"', t)
    if not m:
        return None
    url = _html.unescape(m.group(1))
    url = url if url.startswith("http") else "https://minfin.gov.ru" + url
    body = _html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", _get(url).text))).replace("\xa0", " ")
    h = re.search(r"за январь\s*[-–]\s*([а-я]+)\s+(\d{4})", body)
    if not h or h.group(1)[:3] not in _RU3:
        return None
    date = f"{h.group(2)}-{_RU3[h.group(1)[:3]]:02d}"
    num = r"(-?\d{1,3}(?: \d{3})*(?:,\d+)?)"
    tb = body[body.find("млрд рублей", body.find("(предварительные данные)")):]  # таблица «янв-N ГГГГ / янв-N ГГГГ-1 / % г/г / закон»
    cum = {}
    for k, pat in (("revenue", r"ДОХОДЫ"), ("oilgas", r"НЕФТЕГАЗОВЫЕ ДОХОДЫ"), ("nonoilgas", r"НЕНЕФТЕГАЗОВЫЕ ДОХОДЫ"),
                   ("spending", r"РАСХОДЫ"), ("balance", r"ДЕФИЦИТ\s*/?\s*(?:ПРОФИЦИТ)?")):
        mm = re.search(r"(?<![А-Я])" + pat + r"\s*(?:,\s*в т\.ч\.:)?\s*" + num, tb)
        if mm:
            cum[k] = float(mm.group(1).replace(" ", "").replace(",", "."))
    if "balance" not in cum:   # в тексте: «сложился с дефицитом в размере 5 795 млрд рублей»
        mm = re.search(r"сложился с (дефицитом|профицитом) в размере " + num, body)
        if mm:
            cum["balance"] = float(mm.group(2).replace(" ", "").replace(",", ".")) * (-1 if mm.group(1) == "дефицитом" else 1)
    if "balance" in cum and "revenue" in cum and "spending" in cum and cum["balance"] > 0 and cum["revenue"] < cum["spending"]:
        cum["balance"] = -cum["balance"]
    pub = re.search(r"(\d{2}) ([а-я]+) (\d{4}) \d{2}:\d{2}", body)
    return {"date": date, "cum": cum, "url": url,
            "published": f"{pub.group(1)}.{_RU3.get(pub.group(2)[:3], 0):02d}.{pub.group(3)}" if pub else None}


def budget_annual() -> dict:
    """Годовая история федерального бюджета РФ с 2006 (млрд руб): доходы (всего/нефтегаз/
    ненефтегаз), расходы, дефицит(−)/профицит(+), ненефтегазовый дефицит. Источник — Минфин
    «Краткая информация об исполнении федерального бюджета» (годовой xlsx, Приложение 3.1)."""
    import io as _io
    import warnings
    import openpyxl
    warnings.filterwarnings("ignore")
    page = _get("https://minfin.gov.ru/ru/statistics/fedbud/").text
    m = re.search(r'href="([^"]*109-111[^"]*god\.xlsx)"', page)
    if not m:
        raise RuntimeError("не найдена ссылка на годовой xlsx бюджета")
    url = "https://minfin.gov.ru" + m.group(1)
    content = requests.get(url, headers={"User-Agent": _UA, "Referer": "https://minfin.gov.ru/ru/statistics/fedbud/"}, timeout=40).content
    rows = list(openpyxl.load_workbook(_io.BytesIO(content), read_only=True, data_only=True)["год"].iter_rows(values_only=True))
    yi = next((i for i, r in enumerate(rows)
               if sum(1 for c in r if isinstance(c, int) and 2000 <= c <= 2035) >= 5), None)
    if yi is None:
        raise RuntimeError("не найдена строка лет в годовом бюджете")
    ycols = [(j, str(rows[yi][j])) for j in range(len(rows[yi])) if isinstance(rows[yi][j], int) and 2000 <= rows[yi][j] <= 2035]

    def find(*subs, excl=None):
        for r in rows:
            lbl = r[1] if len(r) > 1 else None
            if isinstance(lbl, str):
                low = lbl.lower().strip()
                if all(s in low for s in subs) and not (excl and excl in low):
                    return [{"date": y, "val": r[j]} for j, y in ycols if isinstance(r[j], (int, float))]
        return []

    return {
        "revenue": find("доходы, всего"),
        "oilgas": find("нефтегазовые доходы", excl="ненефтегаз"),
        "nonoilgas": find("ненефтегазовые доходы"),
        "spending": find("расходы, всего"),
        "balance": find("дефицит", "профицит"),
        "nonoilgas_balance": find("ненефтегазовый дефицит"),
    }


def moex_cap() -> dict:
    """Капитализация рынка акций Мосбиржи: рыночная (на дату торгов) и по выпускам."""
    txt = _get("https://iss.moex.com/iss/statistics/engines/stock/capitalization.csv").text
    m = re.search(r"CAPITALIZATION;TRADEDATE\s*\n([\d.]+);([\d-]+)", txt)
    mi = re.search(r"ISSUECAPITALIZATION;UPDATETIME\s*\n([\d.]+);([\d :\-]+)", txt)
    return {
        "cap": float(m.group(1)) if m else None,
        "cap_date": m.group(2) if m else None,
        "issuecap": float(mi.group(1)) if mi else None,
        "issuecap_time": mi.group(2).strip() if mi else None,
    }


def imoex_history(frm: str = "2013-01-01") -> list[dict]:
    """Месячные закрытия индекса МосБиржи IMOEX → [{date:'YYYY-MM', close}]."""
    url = ("https://iss.moex.com/iss/engines/stock/markets/index/securities/IMOEX/"
           f"candles.json?interval=31&from={frm}&iss.meta=off")
    j = _get(url).json()
    cols = j["candles"]["columns"]
    ci = {c: i for i, c in enumerate(cols)}
    return [{"date": r[ci["end"]][:7], "close": r[ci["close"]]} for r in j["candles"]["data"]]


def _index_candles(secid: str, frm: str = "2015-01-01") -> list:
    """Месячные закрытия индекса MOEX (interval=31)."""
    url = ("https://iss.moex.com/iss/engines/stock/markets/index/securities/"
           f"{secid}/candles.json?interval=31&from={frm}&iss.meta=off")
    j = _get(url).json()
    ci = {c: i for i, c in enumerate(j["candles"]["columns"])}
    return [{"date": r[ci["end"]][:7], "close": r[ci["close"]]} for r in j["candles"]["data"]]


def bond_indices() -> dict:
    """Облигационные индексы MOEX помесячно: RGBI (гособлигации, ценовой) + индексы полной
    доходности гос (RGBITR) / корп (RUCBTRNS) / ВДО (RUCBHYTR)."""
    out = {}
    for key, sid in (("rgbi", "RGBI"), ("gov_tr", "RGBITR"), ("corp_tr", "RUCBTRNS"), ("hy_tr", "RUCBHYTR")):
        try:
            out[key] = _index_candles(sid)
        except Exception as e:  # noqa: BLE001
            log.warning("bond_index %s: %s", key, e)
            out[key] = []
    return out


def _wb(code: str) -> list:
    """Годовой ряд World Bank по RUS → [{date:'YYYY', val}]."""
    d = _get(f"https://api.worldbank.org/v2/country/RUS/indicator/{code}?format=json&per_page=45").json()
    if not (isinstance(d, list) and len(d) > 1 and isinstance(d[1], list)):
        return []
    out = [{"date": r["date"], "val": r["value"]} for r in d[1] if r.get("value") is not None]
    out.sort(key=lambda x: x["date"])
    return out


def wb_macro() -> dict:
    """Годовые макроряды World Bank (Росстат недоступен): безработица, госдолг % ВВП,
    капитализация листингованных компаний % ВВП (индикатор Баффета по годам)."""
    return {"unemployment": _wb("SL.UEM.TOTL.ZS"), "gov_debt_gdp": _wb("GC.DOD.TOTL.GD.ZS"),
            "mcap_gdp": _wb("CM.MKT.LCAP.GD.ZS")}


def nwf() -> dict:
    """Фонд национального благосостояния (Минфин, помесячно): объём (млрд руб) и % ВВП."""
    import io as _io
    import openpyxl
    page = _get("https://minfin.gov.ru/ru/perfomance/nationalwealthfund/statistics/").text
    m = re.search(r'href="([^"]*[Dd]annye[^"]*\.xlsx)"', page)
    if not m:
        raise RuntimeError("не найден xlsx ФНБ")
    url = m.group(1)
    if url.startswith("/"):
        url = "https://minfin.gov.ru" + url
    content = requests.get(url, headers={"User-Agent": _UA, "Referer": "https://minfin.gov.ru/ru/perfomance/nationalwealthfund/statistics/"}, timeout=40).content
    wb = openpyxl.load_workbook(_io.BytesIO(content), read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = list(ws.iter_rows(values_only=True))
    hi = next((i for i, r in enumerate(rows) if sum(isinstance(c, datetime) for c in r) > 6), None)
    if hi is None:
        raise RuntimeError("ФНБ: не найдена строка дат")
    dcols = _minfin_dcols(rows[hi])

    def rowvals(*subs):
        for r in rows:
            lbl = r[1] if len(r) > 1 else None
            if isinstance(lbl, str) and all(s in lbl.lower() for s in subs):
                return [{"date": dt, "val": r[j]} for j, dt in dcols if isinstance(r[j], (int, float))]
        return []

    out = {"volume": rowvals("объем на конец"), "pct_gdp": rowvals("процентах к ввп")}
    # xlsx обновляется позже пресс-релиза «Информационное сообщение о результатах размещения средств
    # ФНБ» (там «По состоянию на 1 сентября 2026 г. объем ФНБ составил X млн рублей или Y % ВВП»)
    try:
        import html as _html
        t = _get("https://minfin.gov.ru/ru/press-center/").text
        for href in re.findall(r'href="([^"]*rezultatakh_razmeshcheniya_sredstv_fonda_natsionalnogo_blagosostoyaniya[^"]*)"', t)[:1]:
            u = _html.unescape(href)
            body = _html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", _get(u if u.startswith("http") else "https://minfin.gov.ru" + u).text))).replace("\xa0", " ")
            m2 = re.search(r"По состоянию на 1 ([а-я]+) (\d{4}) г\. объем ФНБ составил ([\d ]+(?:,\d+)?) млн рублей или ([\d,]+) ?% ВВП", body)
            if m2 and m2.group(1)[:3] in _RU3:
                mo, yy = _RU3[m2.group(1)[:3]], int(m2.group(2))
                dt = f"{yy - (mo == 1)}-{12 if mo == 1 else mo - 1:02d}"      # «на 1 сентября» = на конец августа
                vol = float(m2.group(3).replace(" ", "").replace(",", ".")) / 1000
                if out["volume"] and dt > out["volume"][-1]["date"]:
                    out["volume"].append({"date": dt, "val": round(vol, 1), "prelim": True})
                    out["pct_gdp"].append({"date": dt, "val": float(m2.group(4).replace(",", ".")) / 100, "prelim": True})
    except Exception as e:  # noqa: BLE001
        log.warning("nwf press: %s", e)
    return out


_CACHE_FILE = os.path.join(os.path.dirname(__file__), "data", "macro_cache.json")


def _dump_json(path: str, obj) -> None:
    """Атомарная запись кэша: во временный файл и os.replace — сбой/убийство процесса во время
    записи не оставит битый JSON (потеря hist-кэша = сотни запросов к ЦБ заново)."""
    tmp = f"{path}.tmp{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, path)


def _save_disk(data: dict) -> None:
    try:
        os.makedirs(os.path.dirname(_CACHE_FILE), exist_ok=True)
        _dump_json(_CACHE_FILE, {"at": time.time(), "data": data})
    except Exception as e:  # noqa: BLE001
        log.warning("macro cache save: %s", e)


def _load_disk() -> tuple[float, dict | None]:
    try:
        with open(_CACHE_FILE, encoding="utf-8") as f:
            j = json.load(f)
        return j.get("at", 0.0), j.get("data")
    except Exception:  # noqa: BLE001
        return 0.0, None


# все источники: (ключ, функция, значение-по-умолчанию). Тянутся ПАРАЛЛЕЛЬНО (пул потоков),
# чтобы cache-miss собирался за ~время самого медленного источника, а не за их сумму.
_SOURCES = [
    ("rates_infl", key_rate_inflation, []), ("money", money_supply, {}),
    ("lending", lending, {}), ("npl", npl, {}), ("mortgage_debt", mortgage_debt, []), ("mortgage_npl", mortgage_npl, []),
    ("mortgage_issue", mortgage_issue, []), ("msp_lending", msp_lending, []),
    ("deposit_rates", deposit_rates, {}), ("credit_rates", credit_rates, {}),
    ("ruonia", ruonia, []), ("business", business_climate, {}), ("capacity", capacity_util, []),
    ("infl_exp", inflation_expectations, {}), ("weekly_cpi", rosstat_weekly_cpi, []),
    ("metals", metals, {}), ("fx", fx, {}), ("reer", reer, {}),
    ("current_account", current_account, []), ("fin_investments", fin_investments, {}),
    ("gdp", gdp, []), ("gdp_q", rosstat_gdp, {}), ("wb", wb_macro, {}), ("banking", banking_sector, {}),
    ("bond_indices", bond_indices, {}), ("nwf", nwf, {}), ("budget", budget, {}),
    ("moex_cap", moex_cap, {}), ("imoex", imoex_history, []),
    ("budget_annual", budget_annual, {}),
]


def _all_sources() -> list:
    """Первая волна + вторая (macro_ext: реальный сектор Росстата, деньги/ликвидность/внешний
    сектор ЦБ, базовая инфляция). Импорт ленивый: macro_ext сам импортирует помощники отсюда."""
    from .macro_ext import EXT_SOURCES
    return _SOURCES + EXT_SOURCES


# Публичные (биржевые) банки: рег. номер ЦБ → имя. Чистая прибыль — форма 102 (символ 61101).
_PUBLIC_BANKS = [("1481", "Сбербанк"), ("1000", "ВТБ"), ("2673", "Т-Банк"), ("963", "Совкомбанк"),
                 ("1326", "Альфа-Банк"), ("354", "Газпромбанк"), ("1978", "МКБ"), ("436", "Банк СПб")]
_bank_cache: dict = {"at": 0.0, "data": None}
_BANK_CACHE_FILE = os.path.join(os.path.dirname(__file__), "data", "bank_profits_cache.json")


def _bank_f102_profit(regnum: str, dt: str):
    """Чистая прибыль банка после налогообложения (символ 61101), млрд руб (тыс → /1e6)."""
    html = _get(f"https://www.cbr.ru/banking_sector/credit/coinfo/f102/?regnum={regnum}&dt={dt}").text
    m = re.search(r"<tr[^>]*>((?:(?!</tr>).)*?61101(?:(?!</tr>).)*?)</tr>", html, re.S)
    if not m:
        return None
    cells = [re.sub(r"<[^>]+>", "", c).replace("\xa0", "").replace(" ", "").strip()
             for c in re.findall(r"<td[^>]*>(.*?)</td>", m.group(1), re.S)]
    nums = [c for c in cells if re.match(r"-?\d+$", c)]
    return round(float(nums[-1]) / 1e6, 1) if nums else None


_BANK_HIST_FILE = os.path.join(os.path.dirname(__file__), "data", "bank_profits_hist.json")


def _bank_hist(cur_year: int, n_years: int = 4) -> dict:
    """Накопленная с начала года чистая прибыль по месяцам за прошлые годы — для графика
    «прибыль банка накопленным итогом, линия на год». Прошлые месяцы не меняются → вечный
    дисковый кэш, докачиваются только недостающие (в т.ч. «пусто» — 2022 не раскрывался)."""
    try:
        with open(_BANK_HIST_FILE, encoding="utf-8") as f:
            hist = json.load(f)
    except Exception:  # noqa: BLE001
        hist = {}
    todo = []
    for reg, name in _PUBLIC_BANKS:
        for Y in range(cur_year - n_years, cur_year):
            for mo in range(1, 13):
                lab = f"{Y}-{mo:02d}"
                if lab not in hist.get(name, {}):
                    todo.append((reg, name, lab, f"{Y}-{mo + 1:02d}-01" if mo < 12 else f"{Y + 1}-01-01"))
    if todo:
        def run(t):
            reg, name, lab, dt = t
            try:
                html = _get(f"https://www.cbr.ru/banking_sector/credit/coinfo/f102/?regnum={reg}&dt={dt}").text
            except Exception:  # noqa: BLE001
                return name, lab, None, False      # сетевой сбой — не запоминаем, попробуем в следующий раз
            m = re.search(r"<tr[^>]*>((?:(?!</tr>).)*?61101(?:(?!</tr>).)*?)</tr>", html, re.S)
            if m:
                cells = [re.sub(r"<[^>]+>", "", c).replace("\xa0", "").replace(" ", "").strip()
                         for c in re.findall(r"<td[^>]*>(.*?)</td>", m.group(1), re.S)]
                nums = [c for c in cells if re.match(r"-?\d+$", c)]
                if nums:
                    return name, lab, round(float(nums[-1]) / 1e6, 1), True
            # «пусто» запоминаем, только если это штатная страница формы без отчёта за дату
            # (в прошлых годах форма 102 публикуется поквартально); иное — не кэшируем
            # (или страница отчёта за период с пустой таблицей — напр. I кв. 2023, банки ещё не раскрывались)
            ok = "Отчёт о финансовых результатах | Банк России" in html or ("Код формы 0409102" in html and "Наименование статей" in html)
            return name, lab, None, ok
        cutoff = (datetime.now() - timedelta(days=183)).strftime("%Y-%m")
        with ThreadPoolExecutor(max_workers=6) as ex:
            for name, lab, val, ok in ex.map(run, todo):
                # «пусто» навсегда — только для месяцев старше полугода (свежий месяц мог ещё не
                # выйти или страница отдала мягкую ошибку с HTTP 200)
                if ok and (val is not None or lab < cutoff):
                    hist.setdefault(name, {})[lab] = val
        try:
            os.makedirs(os.path.dirname(_BANK_HIST_FILE), exist_ok=True)
            _dump_json(_BANK_HIST_FILE, hist)
        except Exception as e:  # noqa: BLE001
            log.warning("bank hist save: %s", e)
    return {name: [{"date": k, "val": v} for k, v in sorted(m.items()) if v is not None] for name, m in hist.items()}


def get_bank_profits(force: bool = False) -> dict:
    """Чистая прибыль публичных банков помесячно (с начала года, форма 102 ЦБ). Отдельный
    кэш/эндпоинт — тяжёлый (десятки запросов), чтобы не тормозить основной /api/macro."""
    now = time.time()
    if not force and _bank_cache["data"] and now - _bank_cache["at"] < _TTL:
        return _bank_cache["data"]
    if not force and not _bank_cache["data"]:
        try:
            with open(_BANK_CACHE_FILE, encoding="utf-8") as f:
                j = json.load(f)
            if j.get("data") and now - j.get("at", 0) < _TTL:
                _bank_cache.update(at=j["at"], data=j["data"])
                return j["data"]
        except Exception:  # noqa: BLE001
            pass
    from datetime import date as _date
    today = _date.today()
    # ВАЖНО: форма 102 на dt=YYYY-MM-01 отчитывается накопленно за ПРЕДЫДУЩИЙ месяц
    # (dt=2026-01-01 = весь 2025 год). Поэтому метка месяца = dt минус месяц: чтобы получить
    # YTD текущего года по месяцам, берём dt = первое число СЛЕДУЮЩЕГО месяца.
    months = []
    for mo in range(1, today.month + 1):
        ny, nm = (today.year, mo + 1) if mo < 12 else (today.year + 1, 1)
        months.append((f"{today.year}-{mo:02d}", f"{ny}-{nm:02d}-01"))
    # годовые за последние 5 лет: dt=01.01.(Y+1) = полный год Y (2022 у большинства пуст — санкции)
    annual_years = list(range(today.year - 5, today.year))
    annuals = [(str(Y), f"{Y + 1}-01-01") for Y in annual_years]
    tasks = ([(reg, name, "m", lab, dt) for reg, name in _PUBLIC_BANKS for lab, dt in months]
             + [(reg, name, "a", lab, dt) for reg, name in _PUBLIC_BANKS for lab, dt in annuals])

    def run(t):
        reg, name, typ, label, dt = t
        try:
            return name, typ, label, _bank_f102_profit(reg, dt)
        except Exception:  # noqa: BLE001
            return name, typ, label, None

    monthly: dict = {}
    annual: dict = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        for name, typ, lab, val in ex.map(run, tasks):
            if val is not None:
                (monthly if typ == "m" else annual).setdefault(name, [])
                (monthly if typ == "m" else annual)[name].append({"date": lab, "val": val})
    # сбой/лимит ЦБ на части запросов не должен затирать уже известные значения: дополняем из прошлого кэша
    prev = _bank_cache.get("data")
    if not prev:
        try:
            with open(_BANK_CACHE_FILE, encoding="utf-8") as f:
                prev = json.load(f).get("data")
        except Exception:  # noqa: BLE001
            prev = None
    if prev:
        for dst, src in ((monthly, prev.get("banks") or {}), (annual, prev.get("annual") or {})):
            for name, rows in src.items():
                have = {r["date"] for r in dst.get(name, [])}
                for r in rows:
                    if r["date"] not in have and not r.get("ytd") and (dst is annual or r["date"].startswith(str(today.year))):
                        dst.setdefault(name, []).append({"date": r["date"], "val": r["val"]})
    for name in monthly:
        monthly[name].sort(key=lambda x: x["date"])
        # текущий год (YTD) добавляем в годовой ряд последней точкой
        if monthly[name]:
            annual.setdefault(name, []).append({"date": str(today.year), "val": monthly[name][-1]["val"], "ytd": True})
    for name in annual:
        annual[name].sort(key=lambda x: x["date"])
    res = {"asof": datetime.now().isoformat(timespec="seconds"),
           "order": [n for _, n in _PUBLIC_BANKS if n in monthly or n in annual],
           "banks": monthly, "annual": annual, "hist": _bank_hist(today.year, today.year - 2020)}
    _bank_cache.update(at=now, data=res)
    try:
        os.makedirs(os.path.dirname(_BANK_CACHE_FILE), exist_ok=True)
        _dump_json(_BANK_CACHE_FILE, {"at": now, "data": res})
    except Exception as e:  # noqa: BLE001
        log.warning("bank cache save: %s", e)
    return res


# Обязательные нормативы (форма 135): достаточность капитала Н1.0/1.1/1.2, ликвидность Н2/Н3/Н4.
_NORM_MAP = {"Н1.0": "n10", "Н1.1": "n11", "Н1.2": "n12", "Н2": "n2", "Н3": "n3", "Н4": "n4"}
_norm_cache: dict = {"at": 0.0, "data": None}
_NORM_CACHE_FILE = os.path.join(os.path.dirname(__file__), "data", "bank_normatives_cache.json")


def _bank_f135(regnum: str, dt: str) -> dict:
    """Нормативы банка (форма 135): {code: значение %}."""
    html = _get(f"https://www.cbr.ru/banking_sector/credit/coinfo/f135/?regnum={regnum}&dt={dt}").text
    out = {}
    for t in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        cells = [re.sub(r"<[^>]+>", "", c).replace("\xa0", "").strip()
                 for c in re.findall(r"<td[^>]*>(.*?)</td>", t, re.S)]
        if len(cells) >= 2 and cells[0] in _NORM_MAP:
            v = cells[1].replace(" ", "").replace(",", ".")
            try:
                out[_NORM_MAP[cells[0]]] = float(v)
            except ValueError:
                pass
    return out


_NORM_HIST_FILE = os.path.join(os.path.dirname(__file__), "data", "bank_normatives_hist.json")


def _bank_norm_hist(cur_year: int, y0: int = 2020) -> dict:
    """Нормативы (форма 135) за прошлые годы помесячно — вечный дисковый кэш, докачка недостающих.
    «Пусто» кэшируем только при штатной странице формы без данных (2022 — нач. 2023 ЦБ закрыл);
    сбой сети / лимит ЦБ — не кэшируем, попробуем при следующем обновлении."""
    try:
        with open(_NORM_HIST_FILE, encoding="utf-8") as f:
            hist = json.load(f)
    except Exception:  # noqa: BLE001
        hist = {}
    todo = [(reg, name, f"{Y}-{mo:02d}", f"{Y}-{mo + 1:02d}-01" if mo < 12 else f"{Y + 1}-01-01")
            for reg, name in _PUBLIC_BANKS for Y in range(y0, cur_year) for mo in range(1, 13)
            if f"{Y}-{mo:02d}" not in hist.get(name, {})]
    if todo:
        def run(t):
            reg, name, lab, dt = t
            try:
                html = _get(f"https://www.cbr.ru/banking_sector/credit/coinfo/f135/?regnum={reg}&dt={dt}").text
            except Exception:  # noqa: BLE001
                return name, lab, None, False
            out = {}
            for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
                cells = [re.sub(r"<[^>]+>", "", c).replace("\xa0", "").strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
                if len(cells) >= 2 and cells[0] in _NORM_MAP:
                    try:
                        out[_NORM_MAP[cells[0]]] = float(cells[1].replace(" ", "").replace(",", "."))
                    except ValueError:
                        pass
            ok = bool(out) or "Банк России" in html and ("0409135" in html or "нормативах" in html.lower())
            return name, lab, out or None, ok
        cutoff = (datetime.now() - timedelta(days=183)).strftime("%Y-%m")
        with ThreadPoolExecutor(max_workers=6) as ex:
            for name, lab, val, ok in ex.map(run, todo):
                if ok and (val is not None or lab < cutoff):
                    hist.setdefault(name, {})[lab] = val
        try:
            os.makedirs(os.path.dirname(_NORM_HIST_FILE), exist_ok=True)
            _dump_json(_NORM_HIST_FILE, hist)
        except Exception as e:  # noqa: BLE001
            log.warning("norm hist save: %s", e)
    return hist


def get_bank_normatives(force: bool = False) -> dict:
    """Обязательные нормативы публичных банков помесячно (форма 135 ЦБ). Отдельный кэш/эндпоинт."""
    now = time.time()
    if not force and _norm_cache["data"] and now - _norm_cache["at"] < _TTL:
        return _norm_cache["data"]
    if not force and not _norm_cache["data"]:
        try:
            with open(_NORM_CACHE_FILE, encoding="utf-8") as f:
                j = json.load(f)
            if j.get("data") and now - j.get("at", 0) < _TTL:
                _norm_cache.update(at=j["at"], data=j["data"])
                return j["data"]
        except Exception:  # noqa: BLE001
            pass
    from datetime import date as _date
    today = _date.today()
    months = []
    for mo in range(1, today.month + 1):
        ny, nm = (today.year, mo + 1) if mo < 12 else (today.year + 1, 1)
        months.append((f"{today.year}-{mo:02d}", f"{ny}-{nm:02d}-01"))
    tasks = [(reg, name, lab, dt) for reg, name in _PUBLIC_BANKS for lab, dt in months]

    def run(t):
        reg, name, lab, dt = t
        try:
            return name, lab, _bank_f135(reg, dt)
        except Exception:  # noqa: BLE001
            return name, lab, {}

    out: dict = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        for name, lab, norms in ex.map(run, tasks):
            if norms:
                bank = out.setdefault(name, {})
                for code, val in norms.items():
                    bank.setdefault(code, []).append({"date": lab, "val": val})
    # прошлые годы (с 2020) — из вечного кэша; текущий год при сбое дополняем из прошлого кэша
    prev = (_norm_cache.get("data") or {}).get("banks") or {}
    for name, m in _bank_norm_hist(today.year).items():
        for lab, norms in m.items():
            for code, val in (norms or {}).items():
                out.setdefault(name, {}).setdefault(code, []).append({"date": lab, "val": val})
    for name, codes in prev.items():
        for code, rows in codes.items():
            have = {r["date"] for r in out.get(name, {}).get(code, [])}
            for r in rows:
                if r["date"].startswith(str(today.year)) and r["date"] not in have:
                    out.setdefault(name, {}).setdefault(code, []).append(r)
    for name in out:
        for code in out[name]:
            out[name][code].sort(key=lambda x: x["date"])
    res = {"asof": datetime.now().isoformat(timespec="seconds"),
           "order": [n for _, n in _PUBLIC_BANKS if n in out], "banks": out}
    _norm_cache.update(at=now, data=res)
    try:
        os.makedirs(os.path.dirname(_NORM_CACHE_FILE), exist_ok=True)
        _dump_json(_NORM_CACHE_FILE, {"at": now, "data": res})
    except Exception as e:  # noqa: BLE001
        log.warning("norm cache save: %s", e)
    return res


_refreshing = threading.Lock()


_MIGRATED = [False]


def get_macro(force: bool = False) -> dict:
    """Кэш 12ч (память + диск). Протухший кэш отдаётся СРАЗУ, а обновление идёт в фоне
    (stale-while-revalidate): полный сбор ~50 источников занимает десятки секунд."""
    now = time.time()
    if not _cache["data"]:                            # дисковый кэш переживает перезапуск/‑‑reload
        at, data = _load_disk()
        if data:
            _cache.update(at=at, data=data)
    data = _cache["data"]
    # Бюджетный план — маленький локальный нормативный снимок, который меняется отдельно
    # от тяжёлого сбора ~50 макроисточников. Всегда накладываем текущую версию кода поверх
    # дискового кэша, чтобы новый закон/законопроект появлялся сразу, без ожидания TTL 12 ч.
    if data:
        from .macro_ext import budget_plan
        data["budget_plan"] = budget_plan()
        _keyrate_extend(data)
        ri = data.get("rates_infl") or []
        rate_rows = [r for r in ri if r.get("rate") is not None]
        cpi_rows = [r for r in ri if r.get("cpi") is not None]
        if rate_rows and data.get("latest") is not None:
            data["latest"]["rate"] = rate_rows[-1]["rate"]
            data["latest"]["rate_date"] = rate_rows[-1]["date"]
        if cpi_rows and data.get("latest") is not None:
            data["latest"]["cpi"] = cpi_rows[-1]["cpi"]
            data["latest"]["cpi_date"] = cpi_rows[-1]["date"]
    if data and not force:
        stale = now - _cache["at"] >= _TTL or any(k not in data for k, _, _ in _all_sources())
        # кэш собран до перехода на факт по аукционам — один раз пересобрать (не на каждом запросе)
        if not (data.get("budget") or {}).get("net_internal_debt_src") and not _MIGRATED[0]:
            _MIGRATED[0] = stale = True
        if stale and _refreshing.acquire(blocking=False):
            def bg():
                try:
                    _collect(data)
                finally:
                    _refreshing.release()
            threading.Thread(target=bg, daemon=True).start()
        return data
    gen0 = _cache.get("gen", 0)
    with _refreshing:                                 # force или холодный старт — синхронно
        # пока ждали блокировку, соседний запрос мог уже всё собрать — не собираем повторно
        if _cache.get("gen", 0) != gen0 and _cache["data"]:
            return _cache["data"]
        return _collect(_cache["data"] or data)


def _core_extend(out: dict) -> None:
    """Базовая инфляция г/г за месяцы, которых ещё нет в PDF ЦБ: цепочка 12 месячных индексов
    базового ИПЦ Росстата (ipc_spr) + средняя невязка с официальной на пересечении (~0,02 п.п.)."""
    ci = out.get("core_infl") or {}
    mom = (out.get("cpi_weights") or {}).get("core_mom") or {}
    off = {r["date"]: r["val"] for r in (ci.get("yoy") or {}).get("core") or []}
    if not mom or not off:
        return
    ks = sorted(mom)
    chain = {}
    for i in range(11, len(ks)):
        y0, m0 = int(ks[i - 11][:4]), int(ks[i - 11][5:])
        y1, m1 = int(ks[i][:4]), int(ks[i][5:])
        if (y1 - y0) * 12 + m1 - m0 != 11:
            continue
        pr = 1.0
        for k in ks[i - 11:i + 1]:
            pr *= mom[k] / 100
        chain[ks[i]] = (pr - 1) * 100
    both = [m for m in chain if m in off]
    if not both:
        return
    bias = sum(off[m] - chain[m] for m in both) / len(both)
    add = [{"date": m, "val": round(chain[m] + bias, 2), "src": "rosstat"} for m in sorted(chain) if m > max(off)]
    if add:
        ci["yoy"]["core"] = ci["yoy"]["core"] + add
        ci["core_long"] = (ci.get("core_long") or []) + add


def _keyrate_extend(out: dict) -> None:
    """Extend the monthly rate/CPI table with the latest daily CBR key rate.

    The combined CBR inflation table is published with the CPI release and can
    lag the policy rate by a month. ``keyrate_hist`` comes from the dedicated
    daily KeyRate page, so it is authoritative for the current rate. CPI stays
    null until its own monthly release instead of inheriting a stale value.
    """
    ri = out.get("rates_infl") or []
    kh = [r for r in (out.get("keyrate_hist") or [])
          if r.get("date") and r.get("val") is not None]
    if not ri or not kh:
        return
    last = max(kh, key=lambda r: r["date"])
    month = last["date"][:7]
    row = next((r for r in ri if r.get("date") == month), None)
    if row is not None:
        row["rate"] = last["val"]
    elif month > max(r.get("date", "") for r in ri):
        target = next((r.get("target") for r in reversed(ri)
                       if r.get("target") is not None), 4.0)
        ri.append({"date": month, "rate": last["val"], "cpi": None, "target": target})
        ri.sort(key=lambda r: r.get("date", ""))


def _ofz_net_estimate(out: dict) -> None:
    """Чистое размещение ОФЗ за месяцы, которых ещё нет в отчёте Минфина об исполнении бюджета
    (там «сальдо внутреннего долга» с лагом 2+ месяца). Оценка: изменение госдолга в ценных
    бумагах по номиналу (Минфин, на 1-е число) − дисконт на аукционах (номинал × (1 − цена))
    − средняя за 12 мес невязка с официальным сальдо (в основном индексация ОФЗ-ИН).
    Проверка на 2025–06.2026: ошибка 0…70 млрд/мес, после вычета невязки — около ±30."""
    from .auctions import get_auctions
    nid = (out.get("budget") or {}).get("net_internal_debt") or []
    sec = {r["date"]: r["val"] for r in ((out.get("gov_debt") or {}).get("securities") or [])}
    if not nid or not sec:
        return
    disc: dict = {}
    for a in get_auctions(years=3) or []:
        pl, pr = a.get("placed_mln") or 0, a.get("wa_price") or a.get("cutoff_price") or 100
        disc[a["date"][:7]] = disc.get(a["date"][:7], 0) + pl * (1 - pr / 100) / 1000
    nxt = lambda m: f"{int(m[:4]) + (m[5:] == '12')}-{1 if m[5:] == '12' else int(m[5:]) + 1:02d}"  # noqa: E731
    # госдолг — на КОНЕЦ месяца (_eom): прирост за месяц m = долг[m] − долг[m−1]
    est = lambda m: (sec[m] - sec[_shift_m(m)] - disc.get(m, 0)) if (m in sec and _shift_m(m) in sec) else None  # noqa: E731
    off = {r["date"]: r["val"] for r in nid if r["val"] is not None and not r.get("est")}   # прошлые оценки — не факт
    errs = [est(m) - off[m] for m in sorted(off)[-12:] if est(m) is not None]
    bias = sum(errs) / len(errs) if errs else 0
    last = max(off)
    m, add = nxt(last), []
    while est(m) is not None:
        add.append({"date": m, "val": round(est(m) - bias, 1), "est": True})
        m = nxt(m)
    if add:
        out["budget"] = dict(out["budget"])        # не мутируем объект, который может отдаваться клиентам
        out["budget"]["net_internal_debt"] = [r for r in nid if r["val"] is not None and not r.get("est")] + add
        out["budget"]["net_internal_debt_est"] = {"from": add[0]["date"], "to": add[-1]["date"], "bias": round(bias, 1),
                                                  "method": "Δ госдолга в ценных бумагах (номинал, Минфин) − дисконт на аукционах ОФЗ − средняя невязка"}


_OFZ_RED_FILE = Path(__file__).parent / "data" / "ofz_redemptions.json"


def _ofz_redemptions() -> dict:
    """Погашения и амортизация ОФЗ по номиналу, млрд ₽ по месяцам, с 2021 г. — из общего графика
    выплат Мосбиржи (статистика bondization: объём выпуска × % погашения). Прошлое не меняется —
    храним в файле и докачиваем только последние 40 дней."""
    from datetime import date as _d, timedelta as _td
    from . import moex
    try:
        cache = json.loads(_OFZ_RED_FILE.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        cache = {"through": None, "rows": {}}
    today = _d.today()
    frm = "2021-01-01" if not cache.get("through") else (_d.fromisoformat(cache["through"]) - _td(days=40)).isoformat()
    rows = moex._paginate("statistics/engines/stock/markets/bonds/bondization.json", "amortizations",
                          {"from": frm, "till": today.isoformat(), "limit": 100, "iss.only": "amortizations",
                           "amortizations.columns": "secid,amortdate,issuevalue,valueprc"})
    for r in rows:
        if (r.get("secid") or "").startswith("SU") and r.get("issuevalue") and r.get("valueprc") and r.get("amortdate"):
            cache["rows"][f'{r["secid"]}|{r["amortdate"]}'] = round(r["issuevalue"] * r["valueprc"] / 100 / 1e9, 3)
    cache["through"] = today.isoformat()
    try:
        _OFZ_RED_FILE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    return cache


def _ofz_net_from_auctions(out: dict) -> bool:
    """Чистое размещение ОФЗ по факту аукционов: выручка аукционов и ДРПА Минфина − погашения и
    амортизация ОФЗ (Мосбиржа), с 2021 г. (раньше файлов аукционов у Минфина нет — там отчёт об
    исполнении бюджета). Текущий месяц — по дату последнего файла Минфина (обновляется раз в неделю).
    Сверка с «сальдо внутреннего долга» отчёта Минфина за 2021–2026: медианная разница ~6 млрд/мес."""
    from datetime import date as _d
    from . import auctions as _a
    yrs = _d.today().year - 2020
    auc = _a.get_auctions(years=yrs) or []
    asof = _a.asof(yrs)
    if len(auc) < 100 or not asof:
        return False
    red = _ofz_redemptions()
    plc: dict = {}
    for a in auc:
        v = a.get("proceeds_mln")
        if v is None and a.get("placed_mln"):
            v = a["placed_mln"] * (a.get("wa_price") or a.get("cutoff_price") or 100) / 100
        if v and a["date"] <= asof:
            plc[a["date"][:7]] = plc.get(a["date"][:7], 0) + v / 1000
    rd: dict = {}
    for k, v in red["rows"].items():
        d = k.split("|")[1]
        if d <= asof:
            rd[d[:7]] = rd.get(d[:7], 0) + v
    months, m = [], "2021-01"
    while m <= asof[:7]:
        months.append(m)
        m = f"{int(m[:4]) + (m[5:] == '12')}-{1 if m[5:] == '12' else int(m[5:]) + 1:02d}"
    auc_ser = [{"date": m, "val": round(plc.get(m, 0) - rd.get(m, 0), 1)} for m in months]
    budget = dict(out.get("budget") or {})
    minfin = [r for r in (budget.get("net_internal_debt") or []) if r.get("val") is not None and not r.get("est")]
    off = {r["date"]: r["val"] for r in minfin}
    diffs = sorted(abs(r["val"] - off[r["date"]]) for r in auc_ser if r["date"] in off)
    budget["net_internal_debt_minfin"] = minfin
    budget["net_internal_debt"] = [r for r in minfin if r["date"] < "2021-01"] + auc_ser
    budget["net_internal_debt_est"] = None
    budget["net_internal_debt_src"] = {
        "from": "2021-01", "asof": asof, "partial": asof[:7] if asof[8:] < "28" else None,
        "check_months": len(diffs), "check_median": round(diffs[len(diffs) // 2], 1) if diffs else None,
        "method": "выручка аукционов и ДРПА Минфина − погашения и амортизация ОФЗ (Мосбиржа)"}
    out["budget"] = budget
    return True


def _cbr_usd_today() -> dict:
    """Официальный курс ЦБ на сегодня (XML_daily) — для карточки «Доллар США»: помесячный ряд
    data-service — это курс на конец прошлого месяца."""
    try:
        t = _get("https://www.cbr.ru/scripts/XML_daily.asp").text
        d = re.search(r'ValCurs Date="(\d{2})\.(\d{2})\.(\d{4})"', t)
        m = re.search(r"<CharCode>USD</CharCode>.*?<Nominal>(\d+)</Nominal>.*?<Value>([\d,]+)</Value>", t, re.S)
        if d and m:
            return {"usd_today": round(float(m.group(2).replace(",", ".")) / int(m.group(1)), 4),
                    "usd_today_date": f"{d.group(3)}-{d.group(2)}-{d.group(1)}"}
    except Exception as e:  # noqa: BLE001
        log.warning("cbr usd today: %s", e)
    return {}


_CONV = 2       # версия конвенции меток дат (2: остатки — на конец месяца, потоки — по dt ЦБ)


def _is_empty(v) -> bool:
    return v is None or (isinstance(v, (list, dict)) and len(v) == 0)


def _fill_empty(new, old, path: str = "") -> tuple:
    """Пустое значение/подключ/ряд → берём прошлое. Возвращает (значение, [потерянные пути])."""
    if _is_empty(new) and not _is_empty(old):
        return old, [path or "*"]
    if isinstance(new, dict) and isinstance(old, dict):
        lost, res = [], dict(new)
        for k, ov in old.items():
            if k in ("asof", "errors") or k.startswith("_"):
                continue
            if re.fullmatch(r"-?\d+\.\d+", k):    # число вместо названия — мусор от сбоя парсинга, не переносим
                continue
            if k not in res or _is_empty(res[k]):
                if not _is_empty(ov):
                    res[k] = ov
                    lost.append(f"{path}.{k}".lstrip("."))
            elif isinstance(res[k], dict) and isinstance(ov, dict):
                res[k], l2 = _fill_empty(res[k], ov, f"{path}.{k}".lstrip("."))
                lost += l2
        return res, lost
    return new, []


def _collect(prev: dict | None) -> dict:
    now = time.time()
    out: dict = {"asof": datetime.now().isoformat(timespec="seconds"), "errors": {}}

    def run(task):
        key, fn, default = task
        try:
            return key, fn(), None
        except Exception as e:  # noqa: BLE001
            log.warning("macro %s: %s", key, e)
            return key, default, str(e)

    # прошлый кэш годится для подстановки только при той же конвенции меток дат
    prev_ok = prev if (prev and prev.get("_conv") == _CONV) else None
    with ThreadPoolExecutor(max_workers=20) as ex:
        for key, val, err in ex.map(run, _all_sources()):
            out[key] = val
            if err:
                out["errors"][key] = err
                if prev_ok and prev_ok.get(key):          # источник упал — держим прошлое значение
                    out[key] = prev_ok[key]
            elif prev_ok and prev_ok.get(key):
                # «тихий» сбой: многие источники ловят ошибки внутри и отдают пустой ряд/подключ
                # (лимит ЦБ, переименованная строка) — не стираем прошлые данные
                out[key], lost = _fill_empty(val, prev_ok[key])
                if lost:
                    out["errors"][key] = "пустые ряды заменены прошлыми: " + ", ".join(lost[:6])
    out["_conv"] = _CONV

    try:
        # факт — по аукционам Минфина (выручка аукционов и ДРПА − погашения ОФЗ); если файлы
        # аукционов недоступны — прежняя оценка по изменению госдолга
        try:
            done = _ofz_net_from_auctions(out)
        except Exception as e:  # noqa: BLE001
            log.warning("чистое размещение ОФЗ по аукционам: %s", e)
            done = False
        if not done:
            _ofz_net_estimate(out)
    except Exception as e:  # noqa: BLE001
        log.warning("ofz net estimate: %s", e)
    try:
        _core_extend(out)
    except Exception as e:  # noqa: BLE001
        log.warning("core extend: %s", e)
    try:
        _keyrate_extend(out)
    except Exception as e:  # noqa: BLE001
        log.warning("key-rate extend: %s", e)

    # компактная сводка «последних значений» для карточек-хедлайнов
    ri = out.get("rates_infl") or []
    money = out.get("money") or {}
    m2 = (money.get("m2") or [])
    cap = out.get("moex_cap") or {}
    usd = ((out.get("fx") or {}).get("usd") or [])
    rate_rows = [r for r in ri if r.get("rate") is not None]
    cpi_rows = [r for r in ri if r.get("cpi") is not None]
    rate_last = rate_rows[-1] if rate_rows else None
    cpi_last = cpi_rows[-1] if cpi_rows else None
    out["latest"] = {
        "usd": usd[-1]["val"] if usd else None,
        "usd_date": usd[-1]["date"] if usd else None,
        **_cbr_usd_today(),
        "rate": rate_last["rate"] if rate_last else None,
        "cpi": cpi_last["cpi"] if cpi_last else None,
        "target": (cpi_last or rate_last or {}).get("target"),
        "rate_date": rate_last["date"] if rate_last else None,
        "cpi_date": cpi_last["date"] if cpi_last else None,
        "m2": m2[-1]["val"] if m2 else None,
        "m2_date": m2[-1]["date"] if m2 else None,
        "cap": cap.get("cap"),
        "cap_date": cap.get("cap_date"),
    }
    _gdp = out.get("gdp") or []
    if _gdp:
        out["latest"]["gdp"] = _gdp[-1]["val"]
        out["latest"]["gdp_year"] = _gdp[-1]["date"]
        out["latest"]["cap_to_gdp"] = round(cap["cap"] / (_gdp[-1]["val"] * 1e9) * 100, 1) if cap.get("cap") else None

    _cache.update(at=now, data=out, gen=_cache.get("gen", 0) + 1)
    _save_disk(out)
    return out
