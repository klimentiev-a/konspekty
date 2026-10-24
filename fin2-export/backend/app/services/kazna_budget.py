"""Исполнение бюджетов субъектов РФ — из отчётов Федерального казначейства (форма 0503317).

Казначейство помесячно выкладывает пакет «Консолидированные бюджеты субъектов Российской
Федерации»: по каждому субъекту — отчёт 0503317 с колонками «консолидированный бюджет» и
отдельно «бюджет субъекта Российской Федерации». Мы берём именно колонку бюджета субъекта —
на той же базе, что и остальные данные сектора (без муниципалитетов).

Из отчёта достаём: доходы всего, налоговые и неналоговые (собственные), безвозмездные
поступления, расходы всего, обслуживание государственного долга субъекта и результат
исполнения (дефицит/профицит). Суммы в отчёте — рубли, приводим к миллионам.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import urllib.parse
import warnings
import zipfile

import requests

log = logging.getLogger("kazna_budget")
warnings.filterwarnings("ignore", message="Unverified HTTPS request")

_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "subfed_budget_exec.json")
_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
       "(KHTML, like Gecko) Version/17.0 Safari/605.1.15")
_BASE = "https://roskazna.gov.ru/storage/page-files/512/"

# наш период → отчётная дата Казначейства (накопленным итогом с начала года)
DATES: dict[str, str] = {"2025": "01.01.2026", "6м2026": "01.07.2026"}

_INCOME_CODES = {"10000000000000000": "own", "20000000000000000": "grants"}


def _pkg(date: str, cache_dir: str | None = None) -> zipfile.ZipFile:
    """Пакет за отчётную дату; при повторном разборе берём с диска, а не качаем заново."""
    blob = None
    path = os.path.join(cache_dir, f"kbsrf_{date}.zip") if cache_dir else None
    if path and os.path.exists(path):
        blob = open(path, "rb").read()
    if blob is None:
        url = _BASE + urllib.parse.quote(f"КБСРФ на {date}.zip")
        r = requests.get(url, headers={"User-Agent": _UA}, timeout=600, verify=False)
        r.raise_for_status()
        blob = r.content
        if path:
            open(path, "wb").write(blob)
    outer = zipfile.ZipFile(io.BytesIO(blob))
    inner_name = next(n for n in outer.namelist()
                      if "0503317" in n.encode("cp437").decode("cp866", "replace")
                      and "Excel" in n.encode("cp437").decode("cp866", "replace"))
    return zipfile.ZipFile(io.BytesIO(outer.read(inner_name)))


def _exec_col(sheet) -> int | None:
    """Колонка «Исполнено · бюджет субъекта Российской Федерации»: ищем её по шапке —
    в разных отчётах ширина блоков отличается."""
    for r in range(min(20, sheet.nrows)):
        hits = [c for c in range(sheet.ncols)
                if "бюджет субъекта" in str(sheet.cell_value(r, c)).lower()]
        if len(hits) >= 2:
            return hits[-1]          # второй такой столбец — блок «Исполнено»
    return None


def _num(v) -> float | None:
    if isinstance(v, (int, float)):
        return round(v / 1e6, 1)     # рубли → млн ₽
    return None


def _parse(data: bytes) -> tuple[str | None, dict]:
    import xlrd
    wb = xlrd.open_workbook(file_contents=data, ignore_workbook_corruption=True)
    names = wb.sheet_names()
    out: dict = {}
    region = None
    if "0503317_Д" in names:
        sh = wb.sheet_by_name("0503317_Д")
        # у части отчётов в «наименовании бюджета» стоит просто «Республиканский бюджет»,
        # поэтому берём и финорган: «Министерство финансов Республики Башкортостан»
        parts = []
        for r in range(min(12, sh.nrows)):
            for c in range(sh.ncols):
                lbl = str(sh.cell_value(r, c))
                if "Наименование бюджета" in lbl or "Наименование финансового органа" in lbl:
                    v = next((str(sh.cell_value(r, cc)).strip() for cc in range(c + 1, sh.ncols)
                              if str(sh.cell_value(r, cc)).strip()), None)
                    if v:
                        parts.append(v)
        region = " · ".join(dict.fromkeys(parts)) or None
        col = _exec_col(sh)
        if col is not None:
            for r in range(sh.nrows):
                nm = str(sh.cell_value(r, 18) if sh.ncols > 18 else "").strip()
                code = str(sh.cell_value(r, 21) if sh.ncols > 21 else "").strip()
                if nm.lower().startswith("доходы бюджета - всего"):
                    out["inc"] = _num(sh.cell_value(r, col))
                key = _INCOME_CODES.get(code)
                if key and key not in out:
                    out[key] = _num(sh.cell_value(r, col))
    if "0503317_Р" in names:
        sh = wb.sheet_by_name("0503317_Р")
        col = _exec_col(sh)
        if col is not None:
            for r in range(sh.nrows):
                nm = str(sh.cell_value(r, 20) if sh.ncols > 20 else "").strip().lower()
                if nm.startswith("расходы бюджета - всего") and "exp" not in out:
                    out["exp"] = _num(sh.cell_value(r, col))
                elif nm.startswith("обслуживание государственного долга субъекта") and "svc" not in out:
                    out["svc"] = _num(sh.cell_value(r, col))
                elif nm.startswith("результат исполнения бюджета") and "bal" not in out:
                    out["bal"] = _num(sh.cell_value(r, col))
    return region, out


def fetch(periods: list[str] | None = None) -> dict:
    """Разобрать пакеты Казначейства по нужным датам. Качает ~60 МБ на дату."""
    out = load()
    out.setdefault("periods", {})
    out["source"] = "https://roskazna.gov.ru/ispolnenie-byudzhetov/konsolidirovannye-byudzhety-subektov-rossijskoj-federacii/"
    out["units"] = "млн ₽"
    for period, date in DATES.items():
        if periods and period not in periods:
            continue
        z = _pkg(date, cache_dir=os.environ.get("KBSRF_CACHE"))
        rows: dict[str, dict] = {}
        for n in z.namelist():
            try:
                region, vals = _parse(z.read(n))
            except Exception as e:  # noqa: BLE001
                log.warning("0503317 %s: %s", n, e)
                continue
            if region and vals:
                rows[region] = vals
        out["periods"][period] = rows
        log.info("Казначейство %s (%s): %s бюджетов", period, date, len(rows))
    try:
        with open(_CACHE, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False)
    except OSError as e:  # noqa: BLE001
        log.warning("кэш исполнения бюджетов: %s", e)
    return out


def load() -> dict:
    try:
        with open(_CACHE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"periods": {}}


# у Югры в отчёте «ЮГРЫ», у нас «Югра» — приводим к общему корню
_FIX = ((r"югр\w*", "югра"), (r"саха\b", "якутия"), (r"якути\w*", "якутия"))


def _norm(name: str) -> str:
    x = str(name or "").lower().replace("ё", "е")
    for a, b2 in _FIX:
        x = re.sub(a, b2, x)
    x = re.sub(r"[«»\"()]", " ", x)
    x = re.sub(r"[—–\-]", " ", x)
    x = re.sub(r"\bбюджет[а-я]*\b", " ", x)
    x = re.sub(r"\b(г|гор|город|округа|округ|области|область|края|край|республики|республика)\b", " ", x)
    x = re.sub(r"\bавтономн(ый|ая|ого|ой)\b", " ", x)
    w = [t for t in x.split() if t]
    return " ".join(t for i, t in enumerate(w) if i == 0 or t != w[i - 1])


def for_region(name: str) -> dict:
    """{период: {исполнение бюджета субъекта}} по нашему имени региона: сверяем по корням
    слов, потому что в отчёте имя приходит вместе с финорганом и в разных падежах
    («ДЕПАРТАМЕНТ ФИНАНСОВ ХАНТЫ-МАНСИЙСКОГО АВТОНОМНОГО ОКРУГА - ЮГРЫ»)."""
    # Москва и Петербург — субъекты, а «город Томск» — муниципалитет: его бюджета
    # в отчётах по субъектам нет, и «Томская область» ему не замена
    if re.match(r"^город\s", str(name or "").strip(), re.I) and "томск" in str(name).lower():
        return {}
    # корень слова без окончания: «москва» → «москв», но «московской» под него не подходит
    roots = [t[:len(t) - 2] if len(t) > 6 else t[:max(4, len(t) - 1)] for t in _norm(name).split()]
    data = load().get("periods") or {}
    out = {}
    for p, rows in data.items():
        for reg, vals in rows.items():
            toks = _norm(reg).split()
            if roots and all(any(w.startswith(r) for w in toks) for r in roots):
                out[p] = vals
                break
    return out
