"""География стройки по данным ЕРЗ: кто из застройщиков в каком регионе строит.

Основной топ (erz.py) даёт только головной регион компании и число регионов. Чтобы показать
карту — сколько метров компания строит в каждом субъекте, — обходим региональные топы
https://erzrf.ru/top-zastroyshchikov/<регион>: они отдаются сервером готовой таблицей, где
для каждого застройщика указан объём стройки именно в этом регионе, число ЖК, доля в регионе
и место. Список регионов берём из sitemap сайта.

robots.txt просит Crawl-delay 5 секунд — он соблюдается, поэтому полный обход идёт долго
(~90 регионов). Результат кладём в services/data/erz_regions.json и обновляем раз в месяц:
стройка меняется медленно. Обход запускается вручную скриптом scripts/erz_regions_fetch.py
или лениво при первом запросе, если кэша нет.
"""
from __future__ import annotations

import gzip
import json
import logging
import os
import re
import time
from datetime import datetime

import requests

from .erz import _UA, _norm

log = logging.getLogger("erz_regions")

_SITEMAP = "https://erzrf.ru/images/sitemap/sitemap1.xml.gz"
_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "erz_regions.json")
_TTL_DAYS = 30
_DELAY = 5.0                    # Crawl-delay из robots.txt
_MAX_PAGES = 4                  # 80 застройщиков на регион — наши группы попадают с запасом

# строка регионального топа: место в регионе, название с головным регионом, метры здесь,
# перенос сроков, место по РФ, организации, ЖК и доля в регионе
_ROW = re.compile(
    r"(\d{1,3})\s+Место\s+([+\-−]?\d+)\s+(.+?)\s+Строится, м²\s+([\d  ]+?)\s+С переносом срока\s+([\d  ]+?)\s+%\s+([\d.]+)"
    r"\s+Уточнение срока, мес\.\s+([\d.]+)\s+Место по РФ\s+(\d+)\s+Застройщиков\s+(\d+)\s+ЖК\s+(\d+)"
    r"\s+ПТ\s+(\d+)\s+МД\s+(\d+)\s+БД\s+(\d+)\s+ДАП\s+(\d+)\s+Доля в регионе\s+([\d.]+)%")


def _num(s: str) -> int:
    return int(re.sub(r"\D", "", s) or 0)


def _flat(html: str) -> str:
    return " ".join(re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>", " ", html, flags=re.S)).split())


# у части регионов страница приходит с общим заголовком — их названия держим списком
SLUG_RU = {
    "chelyabinskaya-oblast": "Челябинская область", "khabarovskiy-kray": "Хабаровский край",
    "sakhalinskaya-oblast": "Сахалинская область", "respublika-komi": "Республика Коми",
    "pskovskaya-oblast": "Псковская область", "orlovskaya-oblast": "Орловская область",
    "kurskaya-oblast": "Курская область", "kamchatskiy-kray": "Камчатский край",
    "bryanskaya-oblast": "Брянская область", "astrakhanskaya-oblast": "Астраханская область",
}


def _title_region(html: str, slug: str | None = None) -> str | None:
    m = re.search(r"<title[^>]*>ТОП застройщиков ([^,<]+)", html)
    if m and "Единый Ресурс" not in m.group(1):
        return m.group(1).strip()
    return SLUG_RU.get(slug or "")


def _parse_rows(html: str) -> list[dict]:
    out = []
    for m in _ROW.finditer(_flat(html)):
        g = m.groups()
        name, _, home = g[2].rpartition(",")
        out.append({
            "rank": int(g[0]), "name": (name or g[2]).strip(), "home_region": home.strip(),
            "building_m2": _num(g[3]), "delayed_m2": _num(g[4]), "delayed_pct": float(g[5]),
            "rf_rank": int(g[7]), "entities": int(g[8]), "projects": int(g[9]),
            "share_pct": float(g[14]),
        })
    return out


def region_list() -> list[dict]:
    """Регионы из sitemap: slug + ключ региона на сайте."""
    raw = requests.get(_SITEMAP, headers={"User-Agent": _UA}, timeout=60).content
    xml = gzip.decompress(raw).decode("utf-8", "ignore")
    out, seen = [], set()
    for loc in re.findall(r"<loc>([^<]+)</loc>", xml):
        loc = loc.replace("&amp;", "&")
        m = re.match(r"https://erzrf\.ru/top-zastroyshchikov/([a-z0-9\-]+)\?region=[^&]+&regionKey=(\d+)", loc)
        if m and m.group(1) not in seen:
            seen.add(m.group(1))
            out.append({"slug": m.group(1), "key": m.group(2)})
    return out


def fetch(regions: list[dict] | None = None, delay: float = _DELAY) -> dict:
    """Полный обход региональных топов. Долгий (~90 регионов × 5 с), результат в кэш."""
    regions = regions or region_list()
    data, as_of = {}, None
    for i, reg in enumerate(regions, 1):
        rows, name = [], None
        for page in range(1, _MAX_PAGES + 1):
            url = (f"https://erzrf.ru/top-zastroyshchikov/{reg['slug']}"
                   f"?region={reg['slug']}&regionKey={reg['key']}&topType=0"
                   + (f"&page={page}" if page > 1 else ""))
            try:
                r = requests.get(url, headers={"User-Agent": _UA}, timeout=40)
                r.raise_for_status()
            except Exception as e:  # noqa: BLE001
                log.warning("ЕРЗ %s стр.%s: %s", reg["slug"], page, e)
                break
            if name is None:
                name = _title_region(r.text, reg["slug"])
                if as_of is None:
                    m = re.search(r"date=(\d{6})", r.text)
                    as_of = m.group(1) if m else None
            chunk = _parse_rows(r.text)
            rows += chunk
            time.sleep(delay)
            if len(chunk) < 20:            # страница неполная — дальше пусто
                break
        if rows:
            data[name or reg["slug"]] = {"slug": reg["slug"], "rows": rows,
                                         "total_m2": sum(x["building_m2"] for x in rows)}
        log.info("ЕРЗ регионы: %s/%s %s — %s строк", i, len(regions), name or reg["slug"], len(rows))
    out = {"at": datetime.utcnow().isoformat(timespec="seconds"), "as_of": as_of,
           "source": "https://erzrf.ru/top-zastroyshchikov/", "regions": data}
    try:
        with open(_CACHE, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False)
    except OSError as e:  # noqa: BLE001
        log.warning("кэш регионов ЕРЗ: %s", e)
    return out


def load(force: bool = False) -> dict:
    """Данные из кэша; обход сам не запускаем — он долгий, его гоняет скрипт."""
    try:
        with open(_CACHE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = None
    if data and not force:
        return data
    if force:
        try:
            return fetch()
        except Exception as e:  # noqa: BLE001
            log.warning("обход регионов ЕРЗ: %s", e)
    return data or {"regions": {}, "at": None}


def by_company(aliases: dict[str, tuple[str, ...]]) -> dict:
    """{компания: [{регион, метры, ЖК, доля в регионе, место}]} + итоги по регионам."""
    data = load()
    regions = data.get("regions") or {}
    out: dict[str, list[dict]] = {}
    totals: dict[str, dict] = {}
    for region, block in regions.items():
        totals[region] = {"total_m2": block.get("total_m2"), "top": (block.get("rows") or [{}])[0].get("name")}
        for comp, names in aliases.items():
            hit = None
            for alias in names:
                a = _norm(alias)
                hit = next((r for r in block.get("rows") or [] if a and a in _norm(r["name"])), None)
                if hit:
                    break
            if hit:
                out.setdefault(comp, []).append({
                    "region": region, "slug": block.get("slug"),
                    "building_m2": hit["building_m2"], "projects": hit["projects"],
                    "share_pct": hit["share_pct"], "rank": hit["rank"],
                    "delayed_pct": hit["delayed_pct"],
                })
    for comp in out:
        out[comp].sort(key=lambda x: -x["building_m2"])
    return {"by_company": out, "regions": totals, "as_of": data.get("as_of"), "fetched_at": data.get("at")}
