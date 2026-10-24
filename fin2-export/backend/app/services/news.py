"""
Issuer news via news-search RSS (free, no key). We query the issuer name plus
"облигации" and return recent headlines with source and date for the issue card.

Основной источник — Bing News: Google News с российского сервера рвёт TLS-соединение
(SSLEOFError), и на сайте блок новостей был пустым, а карточка ждала таймаут 15 секунд
на каждое открытие. Google оставлен запасным — с ноутбука он работает.
"""
from __future__ import annotations

import html
import logging
import re
import time
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qs, quote, urlparse

import requests

log = logging.getLogger("news")

_SOURCES = (
    ("bing", "https://www.bing.com/news/search?q={q}&format=rss&setlang=ru&cc=ru"),
    ("google", "https://news.google.com/rss/search?q={q}&hl=ru&gl=RU&ceid=RU:ru"),
)
_cache: dict[str, tuple[float, list]] = {}
_TTL = 3600
# неудачу тоже помним, но недолго: иначе каждое открытие карточки снова ждёт таймаут
_FAIL_TTL = 600


def _real_link(link: str | None) -> str | None:
    """Bing отдаёт ссылку через свой редирект apiclick.aspx?url=…; достаём адрес статьи."""
    if not link or "apiclick.aspx" not in link:
        return link
    url = parse_qs(urlparse(html.unescape(link)).query).get("url")
    return url[0] if url else link


def _ts(date: str | None) -> float:
    try:
        return parsedate_to_datetime(date).timestamp() if date else 0.0
    except (TypeError, ValueError):
        return 0.0


def _clean_issuer(name: str | None) -> str:
    """Reduce a legal issuer name to a searchable brand, e.g.
    'ПАО «ГК «Самолет»' -> 'Самолет'."""
    if not name:
        return ""
    s = html.unescape(name)
    s = re.sub(r'[«»"“”„]', " ", s)
    s = re.sub(r"\b(ПАО|ООО|АО|ЗАО|ОАО|НАО|ПК|ГК|Группа компаний|Холдинг|Финанс|Капитал)\b", " ", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip()
    return s or name


def issuer_news(issuer: str, limit: int = 8) -> list[dict]:
    brand = _clean_issuer(issuer)
    if not brand:
        return []
    key = brand.lower()
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < _TTL:
        return hit[1][:limit]
    q = quote(f"{brand} облигации")
    out: list[dict] = []
    for name, url in _SOURCES:
        try:
            xml = requests.get(url.format(q=q), timeout=6,
                               headers={"User-Agent": "Mozilla/5.0"}).text
        except requests.RequestException as e:
            log.warning("news %s failed for %s: %s", name, brand, type(e).__name__)
            continue
        for item in re.findall(r"<item>(.*?)</item>", xml, re.S):
            def grab(tag):
                m = re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", item, re.S)
                return html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip() if m else None
            title = grab("title")
            if not title:
                continue
            out.append({"title": title, "link": _real_link(grab("link")),
                        "date": grab("pubDate"), "source": grab("source") or grab("News:Source")})
        if out:
            break
    if not out:
        _cache[key] = (now - _TTL + _FAIL_TTL, [])
        return []
    # свежие сверху: поиск сортирует по релевантности, и мартовская новость шла раньше вчерашней
    out.sort(key=lambda x: _ts(x["date"]), reverse=True)
    _cache[key] = (now, out)
    return out[:limit]
