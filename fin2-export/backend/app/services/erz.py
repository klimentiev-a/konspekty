"""Данные ЕРЗ (Единый ресурс застройщиков) по девелоперам: объём текущего строительства,
перенос сроков, число ЖК и регионов, рейтинг ЕРЗ.

Источник — публичный топ застройщиков https://erzrf.ru/top-zastroyshchikov/rf (постранично,
по 20 компаний). robots.txt не запрещает эти страницы, но просит Crawl-delay 5 секунд — он
соблюдается. Результат кэшируется в services/data/erz_top.json, обновляется раз в неделю:
стройка меняется медленно, а сайт лишний раз дёргать незачем.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import datetime

import requests

log = logging.getLogger("erz")

_URL = "https://erzrf.ru/top-zastroyshchikov/rf"
_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
       "(KHTML, like Gecko) Version/17.0 Safari/605.1.15")
_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "erz_top.json")
_TTL_DAYS = 7
_DELAY = 5.0                      # Crawl-delay из robots.txt
_PAGES = 25                       # 500 застройщиков — все наши эмитенты сюда попадают

_ROW = re.compile(
    r"^(\d{1,3})\s+Место\s+([+\-−]?\d+)\s+(.+?)\s+Строится, м²\s+([\d  ]+?)\s+С переносом срока\s+([\d  ]+?)"
    r"\s+%\s+([\d.]+)\s+Уточнение срока, мес\.\s+([\d.]+)\s+Регионов\s+(\d+)\s+Застройщиков\s+(\d+)\s+ЖК\s+(\d+)"
    r"\s+ПТ\s+(\d+)\s+МД\s+(\d+)\s+БД\s+(\d+)\s+ДАП\s+(\d+)\s+([\d.]+)")


def _num(s: str) -> int:
    return int(re.sub(r"\D", "", s) or 0)


def _parse(html: str) -> list[dict]:
    text = " ".join(re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>", " ", html, flags=re.S)).split())
    out = []
    for part in re.split(r"(?=\b\d{1,3}\s+Место\s+[+\-−]?\d+\s+[А-ЯA-Z])", text):
        m = _ROW.match(part)
        if not m:
            continue
        g = m.groups()
        name, _, region = g[2].rpartition(",")
        out.append({
            "rank": int(g[0]), "name": (name or g[2]).strip(), "region": region.strip(),
            "building_m2": _num(g[3]), "delayed_m2": _num(g[4]),
            "delayed_pct": float(g[5]), "delay_months": float(g[6]),
            "regions": int(g[7]), "entities": int(g[8]), "projects": int(g[9]),
            "erz_rating": float(g[14]),
        })
    return out


def fetch(pages: int = _PAGES) -> dict:
    """Скачать топ застройщиков (постранично, с задержкой) и положить в кэш."""
    rows, date_tag = [], None
    for page in range(1, pages + 1):
        url = _URL if page == 1 else f"{_URL}?regionKey=0&topType=0&page={page}"
        r = requests.get(url, headers={"User-Agent": _UA}, timeout=30)
        r.raise_for_status()
        if date_tag is None:
            m = re.search(r"date=(\d{6})", r.text)
            date_tag = m.group(1) if m else None
        chunk = _parse(r.text)
        if not chunk:
            break
        rows += chunk
        if page < pages:
            time.sleep(_DELAY)
    data = {"at": datetime.utcnow().isoformat(timespec="seconds"), "source": _URL,
            "as_of": date_tag, "rows": rows}
    try:
        with open(_CACHE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except OSError as e:  # noqa: BLE001
        log.warning("erz cache write: %s", e)
    return data


def load(force: bool = False) -> dict:
    """Данные из кэша; если старше недели или их нет — скачиваем заново."""
    data = None
    try:
        with open(_CACHE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = None
    if data and not force:
        try:
            age = (datetime.utcnow() - datetime.fromisoformat(data["at"])).days
            if age < _TTL_DAYS and data.get("rows"):
                return data
        except Exception:  # noqa: BLE001
            pass
    try:
        return fetch()
    except Exception as e:  # noqa: BLE001
        log.warning("erz fetch: %s", e)
        return data or {"rows": [], "at": None}


def _norm(s: str) -> str:
    s = s.lower().replace("ё", "е")
    s = re.sub(r"[«»\"',.]", " ", s)
    # убираем только организационные формы; слова вроде «девелопмент» оставляем —
    # иначе «Дарс-Девелопмент» схлопывается в «дарс» и ловит чужой «Дарстрой»
    s = re.sub(r"\b(гк|группа|холдинг|ооо|оао|зао|пао|ао|компаний)\b", " ", s)
    s = s.replace("-", " ")
    return " ".join(s.split())


def by_company(aliases: dict[str, tuple[str, ...]], force: bool = False) -> dict[str, dict]:
    """{наша компания: строка ЕРЗ} по списку псевдонимов имён."""
    data = load(force)
    rows = data.get("rows") or []
    out: dict[str, dict] = {}
    for comp, names in aliases.items():
        for alias in names:
            a = _norm(alias)
            hit = next((r for r in rows if a and a in _norm(r["name"])), None)
            if hit:
                out[comp] = {**hit, "as_of": data.get("as_of"), "fetched_at": data.get("at")}
                break
    return out
