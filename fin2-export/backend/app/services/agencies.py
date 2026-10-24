"""
Agency-specific credit ratings from АКРА / Эксперт РА / НКР.

The agencies publish ratings by ISSUER NAME (no ISIN), so we scrape each
agency's list, normalize the issuer name, and store it in `agency_ratings`.
Bonds are then joined to these ratings at query time by the normalized name of
their issuer (from `bond_ratings.issuer`).

Implemented: АКРА (POST /local/ajax/get_rate_person.php, JSON body {"page":N},
642 entities). Эксперт РА and НКР use the same pattern (discovered via their
own AJAX endpoints) and plug in as additional scrapers.
"""
from __future__ import annotations

import html
import logging
import re
import time
from datetime import datetime

import requests
from sqlalchemy.orm import Session

from ..db import AgencyRating, AgencyRatingHistory, BondSnapshot
from .ratings import normalize_rating

log = logging.getLogger("agencies")

_UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                     "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
       "X-Requested-With": "XMLHttpRequest"}

# Spelled-out legal forms (MOEX emitent_title style) stripped first.
_LEGAL_LONG = re.compile(
    r"(публичн\w*\s+акционерн\w*\s+обществ\w*|"
    r"непубличн\w*\s+акционерн\w*\s+обществ\w*|"
    r"открыт\w*\s+акционерн\w*\s+обществ\w*|"
    r"закрыт\w*\s+акционерн\w*\s+обществ\w*|"
    r"акционерн\w*\s+обществ\w*|"
    r"обществ\w*\s+с\s+ограниченн\w*\s+ответственност\w*|"
    r"государственн\w*\s+корпораци\w*(\s+развития)?|"
    r"коммерческ\w*\s+банк|"
    r"в\s+лице\s+министерства\s+финансов\s+\w+)", re.IGNORECASE)
# Legal-form abbreviations stripped when normalizing an issuer name for matching.
# Uses word stems (групп\w*, компани\w*) so grammatical cases collapse together
# — "Группа компаний Самолет" and "ГК Самолет" reduce to the same key.
_LEGAL = re.compile(
    r"\b(ООО|ОАО|ПАО|АО|ЗАО|НАО|ПК|НКО|КБ|АКБ|ИК|УК|ГК|ФК|МФК|МКК|"
    r"ПJSC|JSC|LLC|PJSC|OJSC|ltd|Group|групп\w*|компани\w*|холдинг\w*|"
    r"концерн\w*|корпораци\w*)\b", re.IGNORECASE)
# «банк» НЕ юрформа, а часть имени: иначе «МТС-Банк»→«мтс» (рейтинг ПАО МТС), «Банк ДОМ.РФ»→
# «дом рф», «Банк Санкт-Петербург»→город, «Банк Синара»→«Группа Синара». Старые ключи (со
# стиранием «банк») нужны только для переназначения ручных рейтингов — см. _LEGAL_OLD.
_LEGAL_OLD = re.compile(_LEGAL.pattern[:-len(r")\b")] + r"|банк)\b", re.IGNORECASE)
# ВНИМАНИЕ: «лизинг/финанс/капитал» НЕ обрезаем — это различающие части названия, а не
# юрформа. Иначе «Пионер-Лизинг» → «пионер» цепляет чужой рейтинг «ГК Пионер» (девелопер).
_QUOTES = re.compile(r'[«»"“”„\'`]')

# Ручные / проверенные рейтинги (свежий снимок АКРА+Эксперт РА и точечные вводы).
# Ключ = normalize_name(эмитент). ПЕРЕКРЫВАЮТ устаревшие записи из авто-выгрузки для тех
# же (эмитент, агентство). Снимок лежит рядом в JSON и едет в архив (работает на хостинге).
def _load_verified() -> dict[str, list[dict]]:
    import json
    import os
    m: dict[str, list[dict]] = {
        "пионер лизинг": [{"agency": "ACRA", "rating": "B+(RU)", "bucket": "B", "score": 5.33,
                           "forecast": "Стабильный", "action": "Подтверждён", "action_date": None}],
    }
    path = os.path.join(os.path.dirname(__file__), "data", "verified_ratings.json")
    try:
        with open(path, encoding="utf-8") as f:
            for norm, recs in json.load(f).items():
                m.setdefault(norm, []).extend(recs)
    except Exception as e:  # noqa: BLE001
        log.warning("verified_ratings.json not loaded: %s", e)
    return m


_MANUAL: dict[str, list[dict]] = _load_verified()


def normalize_name(s: str | None, _legal=None) -> str:
    """Normalize an issuer name to a match key: drop legal forms, quotes and
    punctuation, casefold, collapse whitespace."""
    if not s:
        return ""
    s = html.unescape(s)
    s = _QUOTES.sub(" ", s)
    s = _LEGAL_LONG.sub(" ", s)
    s = (_legal or _LEGAL).sub(" ", s)
    s = re.sub(r"[^\w\s]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip().casefold()
    return s


# --------------------------------------------------------------------------- #
# Общие помощники
# --------------------------------------------------------------------------- #
_RUM = {"янв": 1, "фев": 2, "мар": 3, "апр": 4, "май": 5, "мая": 5, "июн": 6,
        "июл": 7, "авг": 8, "сен": 9, "окт": 10, "ноя": 11, "дек": 12}


def iso_date(s) -> str | None:
    """«11 сен 2026» / «11.09.2026» / «2026-09-11» → «2026-09-11»."""
    if not s:
        return None
    s = str(s).strip().lower()
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return m.group(0)
    m = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", s)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    m = re.match(r"(\d{1,2})\s+([а-яё]+)\.?\s+(\d{4})", s)
    if m and _RUM.get(m.group(2)[:3]):
        return f"{m.group(3)}-{_RUM[m.group(2)[:3]]:02d}-{int(m.group(1)):02d}"
    return None


_EXP_PREFIX = re.compile(r"^e(?=[A-C])")        # АКРА: ожидаемый рейтинг «eAA-(RU)»


def parse_rating(raw: str | None) -> dict:
    """Строка рейтинга → уровень/балл + признаки: ожидаемый (АКРА «eAA-(RU)», Эксперт РА
    «ruA(EXP)») и структурное финансирование (.sf)."""
    s = html.unescape(raw or "").strip()
    if len(s) > 1:
        s = re.sub(r"[–—−]", "-", s)                  # НРА пишет «AA–|ru|» длинным тире
    low = s.lower()
    expected = bool(_EXP_PREFIX.match(s)) or "exp" in low
    bucket, score = normalize_rating(_EXP_PREFIX.sub("", s))
    return {"rating": s, "bucket": bucket, "score": score, "expected": expected, "sf": ".sf" in low}


def _withdrawn(*vals) -> bool:
    return any(v and str(v).strip().lower().startswith("отозв") for v in vals)


def _clean(h: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h or ""))).strip()


def _trend_from_action(action: str | None) -> str | None:
    a = (action or "").lower()
    return "up" if "повыш" in a else "down" if "пониж" in a else None


def _rec(**kw) -> dict:
    """Единый формат записи рейтинга от любого агентства."""
    pr = parse_rating(kw.get("rating"))
    r = {"raw": html.unescape(kw.get("raw") or "").strip(), "rating": pr["rating"], "bucket": pr["bucket"],
         "score": pr["score"], "expected": pr["expected"], "forecast": (kw.get("forecast") or None),
         "scale": kw.get("scale"), "action": kw.get("action"), "action_date": iso_date(kw.get("action_date")),
         "agency_issuer_id": (str(kw["agency_issuer_id"]) if kw.get("agency_issuer_id") else None),
         "isin": kw.get("isin"), "inn": kw.get("inn"), "seniority": kw.get("seniority"),
         "rating_type": kw.get("rating_type") or "issuer",
         "withdrawn": bool(kw.get("withdrawn")) or _withdrawn(pr["rating"], kw.get("action"))}
    if r["rating_type"] != "issuer" and (pr["sf"] or "структурир" in (r["scale"] or "").lower()):
        r["rating_type"] = "sf"
    if r["forecast"] in ("—", "-", "&#8212;", ""):
        r["forecast"] = None
    return r


def _subject(r: dict) -> str:
    if r.get("rating_type") in ("issue", "sf") and r.get("isin"):
        return "isin:" + r["isin"]
    if r.get("agency_issuer_id"):
        return "id:" + r["agency_issuer_id"]
    return "name:" + normalize_name(r.get("raw"))


def _better_dup(old: dict, new: dict) -> bool:
    """Два рейтинга одного субъекта в выгрузке (дубль строки): берём более свежее действие."""
    return (new.get("action_date") or "") > (old.get("action_date") or "")


# --------------------------------------------------------------------------- #
# Кэш идентификаторов (ИНН компаний, ISIN облигаций) — не меняются, храним навсегда
# --------------------------------------------------------------------------- #
def _ids_path():
    import os
    return os.path.join(os.path.dirname(__file__), "data", "agency_ids.json")


def _load_ids() -> dict:
    import json
    try:
        with open(_ids_path(), encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def _save_ids(ids: dict) -> None:
    import json
    import os
    tmp = _ids_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(ids, f, ensure_ascii=False)
    os.replace(tmp, _ids_path())


def _fill_ids(ids: dict, bucket: str, keys, url_fn, parse_fn, workers: int = 4, budget_s: int = 900) -> int:
    """Догрузить недостающие идентификаторы (ИНН / ISIN) со страниц агентства.
    Сохраняем только успешно разобранные ответы HTTP 200 (пустая строка = «на странице нет»)."""
    from concurrent.futures import ThreadPoolExecutor
    have = ids.setdefault(bucket, {})
    todo = [k for k in dict.fromkeys(keys) if k and k not in have]
    if not todo:
        return 0
    t0 = time.time()
    sess = requests.Session()
    sess.trust_env = True

    def one(k):
        if time.time() - t0 > budget_s:
            return k, None
        for attempt in range(2):
            try:
                r = sess.get(url_fn(k), headers={"User-Agent": _UA["User-Agent"]}, timeout=20, verify=True)
                if r.status_code == 200:
                    return k, parse_fn(r.text) or ""
                if r.status_code == 404:
                    return k, ""
            except requests.RequestException:
                pass
            time.sleep(1.0 + attempt)
        return k, None

    got = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for k, v in ex.map(one, todo):
            if v is not None:
                have[k] = v
                got += 1
    _save_ids(ids)
    return got


def _parse_inn(page: str) -> str | None:
    i = page.find("ИНН")
    m = re.search(r"\b(\d{10}|\d{12})\b", _clean(page[i:i + 600])) if i >= 0 else None
    return m.group(1) if m else None


def _parse_isin(page: str) -> str | None:
    i = page.find("ISIN")
    m = re.search(r"\b([A-Z]{2}[0-9A-Z]{9}[0-9])\b", _clean(page[i:i + 400])) if i >= 0 else None
    return m.group(1) if m else None


# --------------------------------------------------------------------------- #
# АКРА: эмитенты (get_rate_person) + выпуски с ISIN (get_rate_emission)
# --------------------------------------------------------------------------- #
ACRA_BASE = "https://www.acra-ratings.ru"
ACRA_URL = ACRA_BASE + "/local/ajax/get_rate_person.php"


def _acra_pages(sess, ep: str, delay: float = 0.3) -> list:
    items, p, pages = [], 1, 1
    while p <= pages:
        for attempt in range(4):
            try:
                d = sess.post(f"{ACRA_BASE}/local/ajax/{ep}.php", json={"page": p, "count": 200},
                              headers=_UA, timeout=60, verify=False).json()["data"]
                break
            except Exception:  # noqa: BLE001 — 503 при частых запросах: ждём и повторяем
                if attempt == 3:
                    raise
                time.sleep(3 * (attempt + 1))
        pages = int(d.get("count_pages") or 1)
        items += d.get("items") or []
        p += 1
        time.sleep(delay)
    return items


def _acra_infos(items):
    """Плоский список info-блоков: у эмитента с несколькими рейтингами (нац.+междунар. шкала)
    элемент — «group» с вложенными строками (раньше такие эмитенты терялись целиком)."""
    for it in items:
        subs = it.get("items") if it.get("type") == "group" else [it]
        for sub in subs or []:
            inf = sub.get("info")
            for i in (inf if isinstance(inf, list) else [inf] if inf else []):
                yield i


def _acra_rec(i: dict, issue: bool) -> dict | None:
    v = lambda k: ((i.get(k) or {}).get("value") or {})           # noqa: E731
    rate, person, press, em = v("rate"), v("ratePerson"), v("pressRelease"), v("emission")
    scale = rate.get("rating_scale") or ""
    if "междунар" in scale.lower():             # только национальная шкала (RU)
        return None
    if issue and not em.get("isin"):
        return None
    sen = None
    if issue:
        m = re.search(r",\s*([^,]+?)\s+серии\s*:", html.unescape(em.get("title") or ""))
        sen = m.group(1).strip() if m else None
    return _rec(raw=person.get("title"), rating=rate.get("title"), forecast=rate.get("forecast"), scale=scale,
                action=rate.get("action_name"), action_date=press.get("date"),
                agency_issuer_id=person.get("id"), isin=em.get("isin") if issue else None,
                rating_type="issue" if issue else "issuer", seniority=sen,
                withdrawn=rate.get("is_withdrawn") or rate.get("action_type") == "WD")


def scrape_acra(db: Session, max_pages: int | None = None, delay: float = 0.3) -> dict:
    sess = requests.Session()
    sess.trust_env = True
    # у АКРА цепочка сертификата не проходит стандартную проверку (отечественный УЦ) → verify=False
    now = datetime.utcnow()
    recs: dict[str, dict] = {}
    ids = _load_ids()
    urls = ids.setdefault("acra_url", {})
    for ep, issue in (("get_rate_person", False), ("get_rate_emission", True)):
        for i in _acra_infos(_acra_pages(sess, ep, delay)):
            pv = ((i.get("ratePerson") or {}).get("value") or {})
            if pv.get("id") and pv.get("url"):
                urls[str(pv["id"])] = pv["url"]
            r = _acra_rec(i, issue)
            if not r or not r["raw"] or not r["rating"]:
                continue
            k = _subject(r)
            if k not in recs or _better_dup(recs[k], r):
                recs[k] = r
    _save_ids(ids)
    return _store(db, "ACRA", list(recs.values()), now)


# --------------------------------------------------------------------------- #
# НКР (ratings.ru) — весь список эмитентов одной HTML-страницей; ИНН — со страницы эмитента
# --------------------------------------------------------------------------- #
NKR_BASE = "https://ratings.ru"
NKR_URL = NKR_BASE + "/ratings/issuers/"


def scrape_nkr(db: Session) -> dict:
    r = requests.get(NKR_URL, headers={"User-Agent": _UA["User-Agent"]}, timeout=30, verify=True)
    now = datetime.utcnow()
    rows = []
    for tr in re.findall(r"<tr\b[^>]*>(.*?)</tr>", r.text, re.S | re.I):
        link = re.search(r'href="/ratings/issuers/([^"/]+)/?"[^>]*>(.*?)</a>', tr, re.S)
        if not link:
            continue
        tds = [_clean(c) for c in re.findall(r"<td\b[^>]*>(.*?)</td>", tr, re.S | re.I)]
        rating = next((c for c in tds[1:] if re.search(r"[A-C]{1,3}[+\-]?\.ru|отозв", c or "", re.I)), None)
        if not rating:
            continue
        adate = next((c for c in tds if re.match(r"\d{2}\.\d{2}\.\d{4}", c or "")), None)
        rows.append((link.group(1), _clean(link.group(2)), rating, tds[2] if len(tds) > 2 else None, adate))
    ids = _load_ids()
    # ИНН — из официальной Excel-выгрузки НКР (issuers.php, колонка TIN); страницы эмитентов
    # запрашиваем только для тех, кого в выгрузке не нашли
    xl_iss, xl_bonds = _nkr_excel()
    tin_by_name = {normalize_name(r["name"]): r["tin"] for r in xl_iss if r.get("tin")}
    inns = ids.setdefault("nkr_company", {})
    for slug, name, *_ in rows:
        if not inns.get(slug) and tin_by_name.get(normalize_name(name)):
            inns[slug] = tin_by_name[normalize_name(name)]
    _fill_ids(ids, "nkr_company", [x[0] for x in rows], lambda k: f"{NKR_BASE}/ratings/issuers/{k}/", _parse_inn)
    inns = ids.get("nkr_company", {})
    recs: dict[str, dict] = {}
    for slug, name, rating, fc, adate in rows:
        rec = _rec(raw=name, rating=rating, forecast=(fc or "").capitalize() or None, action_date=adate,
                   agency_issuer_id=slug, inn=inns.get(slug) or None, scale="Национальная")
        k = _subject(rec)
        if k not in recs or _better_dup(recs[k], rec):
            recs[k] = rec
    # рейтинги выпусков — из issues.php (ISIN, рейтинг, дата, ИНН эмитента)
    slug_by_tin = {v: k for k, v in inns.items() if v}
    for b in xl_bonds:
        if not b.get("isin"):
            continue
        rec = _rec(raw=b.get("name"), rating=b.get("rating"), action_date=b.get("date"),
                   agency_issuer_id=slug_by_tin.get(b.get("tin")), inn=b.get("tin"), isin=b["isin"],
                   rating_type="issue", scale="Национальная", withdrawn=_withdrawn(b.get("rating")) or "отозв" in (b.get("rating") or "").lower())
        k = _subject(rec)
        if k not in recs or _better_dup(recs[k], rec):
            recs[k] = rec
    _save_ids(ids)
    return _store(db, "NKR", list(recs.values()), now)


def _nkr_excel() -> tuple[list[dict], list[dict]]:
    """Официальные Excel-выгрузки НКР: эмитенты (ИНН, ОГРН) и выпуски (ISIN)."""
    import io
    import pandas as pd
    out = []
    for url in (NKR_BASE + "/issuers.php", NKR_BASE + "/issues.php"):
        try:
            r = requests.get(url, headers={"User-Agent": _UA["User-Agent"]}, timeout=60, verify=True)
            if r.status_code != 200 or r.content[:2] != b"PK":
                raise RuntimeError(f"HTTP {r.status_code}")
            df = pd.read_excel(io.BytesIO(r.content), dtype=str)
        except Exception as e:  # noqa: BLE001
            log.warning("НКР Excel %s: %s", url, e)
            out.append([])
            continue
        cols = {c.strip().lower(): c for c in df.columns}
        g = lambda row, n: (str(row[cols[n]]).strip() if n in cols and str(row[cols[n]]).strip() not in ("", "nan") else None)  # noqa: E731
        rows = []
        for _, row in df.iterrows():
            tin = g(row, "tin") or g(row, "issuer tin")
            rows.append({"name": g(row, "security name") or g(row, "issuer name"), "issuer": g(row, "issuer name"),
                         "tin": tin.zfill(10) if tin and tin.isdigit() and len(tin) in (9, 11) else tin,
                         "isin": g(row, "isin"), "rating": g(row, "rating"), "outlook": g(row, "outlook"),
                         "date": g(row, "date") or g(row, "rating date"), "ogrn": g(row, "ogrn")})
        out.append(rows)
    return out[0], out[1]


# --------------------------------------------------------------------------- #
# Эксперт РА: реестры по категориям (эмитенты) + debt_inst (выпуски); ИНН / ISIN — со страниц
# --------------------------------------------------------------------------- #
EXPERT_BASE = "https://raexpert.ru"
EXPERT_CATS = ("credits_all", "credits_fin", "bankcredit_all", "leasing_rel",
               "credits_holding", "credits_project", "credits_int", "regioncredit_all",
               "mfi_credits_all", "insurance_all", "factor", "depositories", "npf")
EXPERT_ISSUES = "debt_inst"


def _expert_page_num(h: str) -> int | None:
    import base64
    try:
        d = base64.b64decode(h[2:] + "===", validate=False).decode("utf-8", "ignore")
        m = re.search(r"PAGE:(\d+)", d)
        return int(m.group(1)) if m else None
    except Exception:
        return None


def _expert_crawl(cat: str, max_pages: int = 200) -> list[str]:
    """HTML всех страниц категории: пагинация через серверную сессию (POST base64 page-hash →
    GET перерисовывает эту страницу)."""
    sess = requests.Session()
    sess.trust_env = True
    h1 = sess.get(f"{EXPERT_BASE}/ratings/{cat}/", headers=_UA, timeout=30, verify=True).text
    tok = re.search(r"CSRFAjaxTokenPageHash = '([^']+)'", h1)
    out = [h1]
    if not tok:
        return out
    tok = tok.group(1)
    hashes = {p: h for h in re.findall(r"setRatingPageHash\('([^']+)'\)", h1) if (p := _expert_page_num(h))}
    visited = {1}
    while len(visited) < max_pages:
        nxt = sorted(p for p in hashes if p not in visited)
        if not nxt:
            break
        p = nxt[0]
        visited.add(p)
        hp = None
        for attempt in range(3):
            try:
                sess.post(f"{EXPERT_BASE}/ratings/index/ajax-set-rating-page-hash/",
                          data={"rating_page_hash": hashes[p], "CSRFAjaxToken": tok},
                          headers={**_UA, "Content-Type": "application/x-www-form-urlencoded"},
                          timeout=30, verify=True)
                hp = sess.get(f"{EXPERT_BASE}/ratings/{cat}/", headers=_UA, timeout=30, verify=True).text
                break
            except requests.RequestException:
                time.sleep(1.5 * (attempt + 1))
        if hp is None:
            continue
        out.append(hp)
        for h in re.findall(r"setRatingPageHash\('([^']+)'\)", hp):
            pp = _expert_page_num(h)
            if pp and pp not in hashes:
                hashes[pp] = h
    return out


def _expert_rows(page: str) -> list[dict]:
    out = []
    for tr in re.findall(r"<tr>(.*?)</tr>", page, re.S):
        comp = re.search(r'/database/(companies|regions)/([^"/]+)/?">([^<]+)</a>', tr)
        if not comp:
            continue
        bond = re.search(r'/database/securities/bonds/(\d+)/?">([^<]+)</a>', tr)
        tds = [_clean(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        icon = re.search(r'class="(positive|negative) i i-triangle"', tr)
        date = next((c for c in reversed(tds) if re.match(r"\d{2}\.\d{2}\.\d{4}", c or "")), None)
        out.append({"kind": comp.group(1), "slug": comp.group(2), "name": html.unescape(comp.group(3)).strip(),
                    "bond_id": bond.group(1) if bond else None,
                    "rating": tds[1] if len(tds) > 1 else "", "forecast": tds[2] if len(tds) > 2 else None,
                    "date": date,
                    "action": {"positive": "Повышен", "negative": "Понижен"}.get(icon.group(1)) if icon else None})
    return out


# обратная совместимость (старые скрипты): (имя, рейтинг, прогноз)
def _expert_parse(html_page: str) -> list[tuple[str, str, str | None]]:
    return [(r["name"], r["rating"], r["forecast"]) for r in _expert_rows(html_page)
            if r["rating"] and not _withdrawn(r["rating"])]


def scrape_expert(db: Session) -> dict:
    now = datetime.utcnow()
    issuers, issues = [], []
    failures = []
    for cat in EXPERT_CATS:
        try:
            for pg in _expert_crawl(cat):
                issuers += [r for r in _expert_rows(pg) if not r["bond_id"]]
        except requests.RequestException as e:
            log.warning("Expert RA %s: %s", cat, e)
            failures.append(cat)
    try:
        for pg in _expert_crawl(EXPERT_ISSUES):
            issues += [r for r in _expert_rows(pg) if r["bond_id"]]
    except requests.RequestException as e:
        log.warning("Expert RA debt_inst: %s", e)
        failures.append(EXPERT_ISSUES)
    # Не заменяем сохранённый снимок неполной выгрузкой. Простая проверка числа строк
    # ниже не ловит ситуацию, когда недоступны несколько целых категорий, но суммарно
    # остаётся больше 80% записей.
    if failures:
        raise RuntimeError(
            "Эксперт РА: неполная выгрузка (" + ", ".join(failures) + "); прежний снимок сохранён"
        )
    ids = _load_ids()
    _fill_ids(ids, "expert_company", [r["slug"] for r in issuers + issues if r["kind"] == "companies"],
              lambda k: f"{EXPERT_BASE}/database/companies/{k}/", _parse_inn, workers=3)
    _fill_ids(ids, "expert_bond", [r["bond_id"] for r in issues],
              lambda k: f"{EXPERT_BASE}/database/securities/bonds/{k}/", _parse_isin, workers=3)
    inns, isins = ids.get("expert_company", {}), ids.get("expert_bond", {})
    recs: dict[str, dict] = {}
    for r in issuers + issues:
        if not r["rating"] or not re.match(r"(?i)ru|отозв", r["rating"]):
            continue                                   # только национальная шкала (ruAA, ruA-.sf)
        isin = isins.get(r["bond_id"]) if r["bond_id"] else None
        if r["bond_id"] and not isin:
            continue                                   # выпуск без ISIN не сопоставить — пропускаем
        rec = _rec(raw=r["name"], rating=r["rating"], forecast=r["forecast"], action=r["action"],
                   action_date=r["date"], agency_issuer_id=f'{r["kind"][0]}:{r["slug"]}',
                   inn=(inns.get(r["slug"]) or None) if r["kind"] == "companies" else None,
                   isin=isin, rating_type="issue" if isin else "issuer", scale="Национальная")
        k = _subject(rec)
        if k not in recs or _better_dup(recs[k], rec):
            recs[k] = rec
    return _store(db, "EXPERT_RA", list(recs.values()), now)


# --------------------------------------------------------------------------- #
# НРА (ra-national.ru): публичная Excel-выгрузка всех рейтинговых действий с 2020 г.
# (кнопка «Выгрузить в Excel» на странице /ratings/). Одна выгрузка = текущие рейтинги + история.
# --------------------------------------------------------------------------- #
NRA_PAGE = "https://www.ra-national.ru/ratings/"
_NRA_ROWS: dict = {"at": 0.0, "rows": []}


def _nra_export() -> list[dict]:
    import io
    import pandas as pd
    if _NRA_ROWS["rows"] and time.time() - _NRA_ROWS["at"] < 3600:
        return _NRA_ROWS["rows"]
    page = requests.get(NRA_PAGE, headers={"User-Agent": _UA["User-Agent"]}, timeout=60).text
    m = re.search(r'href="(https://www\.ra-national\.ru/wp-load\.php\?[^"]*export_id=[^"]+)"', page)
    if not m:
        raise RuntimeError("НРА: ссылка на выгрузку не найдена")
    r = requests.get(html.unescape(m.group(1)), headers={"User-Agent": _UA["User-Agent"]}, timeout=120)
    r.raise_for_status()
    df = pd.read_excel(io.BytesIO(r.content), dtype=str)
    cols = {c.strip().lower(): c for c in df.columns}
    g = lambda row, *names: next((str(row[cols[n]]).strip() for n in names if n in cols and str(row[cols[n]]).strip() not in ("", "nan", "None")), None)  # noqa: E731
    out = []
    for _, row in df.iterrows():
        kind = g(row, "вид рейтинга") or ""
        if "кредитный рейтинг" not in kind.lower():
            continue                                    # рейтинги надёжности УК/НПФ, ESG — не кредитные
        inn = g(row, "инн")
        if inn and re.match(r"^\d+(\.0+)?(e\+\d+)?$", inn, re.I):
            try:
                inn = str(int(float(inn)))
            except ValueError:
                pass
        out.append({"name": g(row, "название организации"), "inn": inn, "isin": g(row, "isin"),
                    "rating": g(row, "рейтинг"), "status": g(row, "статус рейтинга"),
                    "forecast": g(row, "прогноз"), "date": iso_date(g(row, "дата опубликования пресс-релиза")),
                    "issue": "выпуск" in kind.lower(), "url": g(row, "ссылка на пресс релиз"),
                    "watch": g(row, "под наблюдением"), "id": g(row, "id")})
    _NRA_ROWS.update(at=time.time(), rows=out)
    return out


def _nra_subject_key(r: dict) -> str | None:
    if r.get("issue") and r.get("isin"):
        return "isin:" + r["isin"]
    if r.get("inn"):
        return "inn:" + r["inn"]
    return None


def scrape_nra(db: Session) -> dict:
    now = datetime.utcnow()
    rows = _nra_export()
    last: dict[str, dict] = {}
    for r in sorted(rows, key=lambda x: (x.get("date") or "", int(x.get("id") or 0))):
        k = _nra_subject_key(r)
        if k:
            last[k] = r                                  # последнее действие по субъекту
    recs = []
    for k, r in last.items():
        fc = r.get("forecast")
        rec = _rec(raw=r["name"], rating=r.get("rating") if (r.get("rating") or "—") != "—" else "Отозван",
                   forecast=None if fc in (None, "—", "Без прогноза") else fc, action=r.get("status"),
                   action_date=r.get("date"), agency_issuer_id=("i:" + r["inn"]) if r.get("inn") else None,
                   inn=r.get("inn"), isin=r.get("isin") if r.get("issue") else None,
                   rating_type="issue" if r.get("issue") and r.get("isin") else "issuer", scale="Национальная",
                   withdrawn=(r.get("status") or "").lower().startswith("отозв"))
        recs.append(rec)
    return _store(db, "NRA", recs, now)


# --------------------------------------------------------------------------- #
# История рейтингов по эмитенту (для графика «Рейтинги по датам» и колонки «Было»)
# --------------------------------------------------------------------------- #
def _hist_path():
    import os
    return os.path.join(os.path.dirname(__file__), "data", "agency_history.json")


def _load_hist() -> dict:
    import json
    try:
        with open(_hist_path(), encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def _save_hist(h: dict) -> None:
    import json
    import os
    tmp = _hist_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(h, f, ensure_ascii=False)
    os.replace(tmp, _hist_path())


_FC_WORDS = ("стабильн", "позитивн", "негативн", "развивающ")


def _fc_from_text(t: str) -> str | None:
    low = (t or "").lower()
    for w, name in (("развивающ", "Развивающийся"), ("позитивн", "Позитивный"), ("негативн", "Негативный"), ("стабильн", "Стабильный")):
        if w in low:
            return name
    return None


def _act_from_text(t: str) -> str | None:
    low = (t or "").lower()
    for w, name in (("отозв", "Отозван"), ("повыс", "Повышен"), ("пониз", "Понижен"), ("присво", "Присвоен"),
                    ("подтверд", "Подтвержден"), ("наблюден", "Под наблюдением")):
        if w in low:
            return name
    return None


def _acra_hist_parse(page: str) -> list[list]:
    i = page.find("История рейтингов")
    if i < 0:
        return []
    j = page.find("Рейтинги выпусков", i)
    seg = page[i:j if j > 0 else i + 60000]
    items = []
    for blk in re.findall(r'<div class="rating-item"(.*?)</a>', seg, re.S):
        txt = _clean(blk)
        if "междунар" in txt.lower():
            continue
        m = re.search(r"([A-D]{1,3}[+\-]?\((?:RU|ru\.sf)\)|Отозван)", txt)
        d = re.search(r"(\d{1,2}\s+[а-яё]+\.?\s+\d{4})\s*$", txt)
        act = re.search(r'title="([^"]+)"', blk)
        if m and d:
            items.append([iso_date(d.group(1)), m.group(1), _fc_from_text(txt.split("прогноз", 1)[1] if "прогноз" in txt else ""),
                          act.group(1) if act else None])
    return items


# Старая шкала Эксперт РА (до перехода на национальную шкалу по 222-ФЗ в 2017 г.): A++, A+ (I…III),
# A, B++, B+, B, C++, C+, C, D. Официальной таблицы соответствия нет — для графика раскладываем на
# привычную лестницу ПРИБЛИЗИТЕЛЬНО: уровень → буквы, подгруппа I/II/III → «+ / середина / −».
_EXP_OLD = re.compile(r"^(A\+\+|A\+|A|B\+\+|B\+|B|C\+\+|C\+|C|D|E)(?:\s*\((I{1,3})\))?$")
_EXP_OLD_MAP = {"A++": "AAA", "A+": "AA", "A": "A", "B++": "BBB", "B+": "BB", "B": "B",
                "C++": "CCC", "C+": "CC", "C": "C", "D": "D", "E": "D"}


def old_expert_equiv(raw: str | None) -> str | None:
    """«A+ (II)» → «AA», «A (I)» → «A+», «A++» → «AAA» (приблизительно, только для графика)."""
    m = _EXP_OLD.match((raw or "").strip())
    if not m:
        return None
    base = _EXP_OLD_MAP[m.group(1)]
    if base in ("AAA", "CCC", "CC", "C", "D"):
        return base
    return base + {"I": "+", "II": "", "III": "-"}.get(m.group(2) or "II", "")


def _expert_hist_parse(page: str) -> list[list]:
    """История рейтинга компании у Эксперт РА: текущая шкала (первая таблица с «Прогноз») и
    «Архив рейтингов» по старой шкале (записи помечены пятым полем "old")."""
    items = []
    arch = page.find("Архив рейтингов")
    main_part = page[:arch] if arch > 0 else page
    tables = [t for t in re.findall(r"<table.*?</table>", main_part, re.S) if "Прогноз" in t]
    if tables:
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tables[0], re.S):
            txt = _clean(tr)
            m = re.match(r"^(ru[A-D]{1,3}[+\-]?(?:\.sf)?|отозван)", txt, re.I)
            d = re.search(r"(\d{2}\.\d{2}\.\d{4})", txt)
            if m and d:
                act = "Под наблюдением" if "под наблюдением" in txt.lower() else None
                items.append([iso_date(d.group(1)), m.group(1), _fc_from_text(txt), act])
    if arch > 0:
        # в архиве и отозванные рейтинги по новой шкале (ruBB…), и старая шкала до 2017 (A++, A+ (I)…)
        seen = {(x[0], x[1]) for x in items}
        _old_row = lambda r: re.match(r"^(A\+\+|[ABC]\+\+?|[ABC])(\s*\(I{1,3}\))?(\s|,|$)", _clean(r))  # noqa: E731
        all_tb = re.findall(r"<table.*?</table>", page[arch:], re.S)
        use = [t for t in all_tb if "Прогноз" in t]
        # у части старых клиентов архив кредитного рейтинга — в таблице без колонки «Прогноз»:
        # берём первую такую со старой шкалой (следующие таблицы бывают другими видами рейтинга)
        if not any(any(_old_row(r) for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S)) for t in use):
            extra = next((t for t in all_tb if "Прогноз" not in t
                          and any(_old_row(r) for r in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S))), None)
            if extra:
                use.append(extra)
        for tb in use:
            rows = re.findall(r"<tr[^>]*>(.*?)</tr>", tb, re.S)
            is_old = any(re.match(r"^(A\+\+|[ABC]\+\+?|[ABC])(\s*\(I{1,3}\))?(\s|,|$)", _clean(r)) for r in rows)
            for tr in rows:
                txt = _clean(tr)
                d = re.search(r"(\d{2}\.\d{2}\.\d{4})", txt)
                if not d:
                    continue
                act = "Под наблюдением" if "под наблюдением" in txt.lower() else None
                mn = re.match(r"^(ru[A-D]{1,3}[+\-]?(?:\.sf)?)", txt, re.I)
                mo = re.match(r"^(A\+\+|[ABC]\+\+|[ABC]\+|[ABCDE])(\s*\((?:I{1,3})\))?(?=\s|,|$)", txt)
                mw = re.match(r"^(отозван)", txt)
                if mn:
                    it = [iso_date(d.group(1)), mn.group(1), _fc_from_text(txt), act]
                elif mo:
                    it = [iso_date(d.group(1)), (mo.group(1) + (mo.group(2) or "")).strip(), _fc_from_text(txt), act, "old"]
                elif mw:
                    it = [iso_date(d.group(1)), "отозван", None, act] + (["old"] if is_old else [])
                else:
                    continue
                if (it[0], it[1]) not in seen:
                    seen.add((it[0], it[1]))
                    items.append(it)
    return items


def _nkr_hist_parse(page: str) -> list[list]:
    items = []
    for blk in re.findall(r'<div class="rate-item">(.*?)</p>\s*</div>', page, re.S):
        rt = re.search(r'rate-item__rating">\s*([^<]+?)\s*<', blk)
        title = re.search(r'rate-item__title">\s*([^<]+?)\s*<', blk)
        d = re.search(r'rate-item__date">\s*(\d{2}\.\d{2}\.\d{4})', blk)
        if rt and d:
            t = html.unescape(title.group(1)) if title else ""
            items.append([iso_date(d.group(1)), rt.group(1).strip(), _fc_from_text(t), _act_from_text(t)])
    return items


def _hist_url(agency: str, aid: str) -> str | None:
    if agency == "ACRA":
        u = (_load_ids().get("acra_url") or {}).get(aid)
        return ACRA_BASE + u if u else None
    if agency == "EXPERT_RA" and aid.startswith("c:"):
        return f"{EXPERT_BASE}/database/companies/{aid[2:]}/"
    if agency == "NKR":
        return f"{NKR_BASE}/ratings/issuers/{aid}/"
    return None


_HIST_PARSERS = {"ACRA": _acra_hist_parse, "EXPERT_RA": _expert_hist_parse, "NKR": _nkr_hist_parse}


def timeline(agency: str, aid: str | None, last_action: str | None = None, fetch: bool = True, hist: dict | None = None) -> list[list]:
    """История рейтингов эмитента у агентства: [[дата, рейтинг, прогноз, действие], …] по возрастанию
    даты. Кэш на диске; перечитываем страницу агентства, если там могло появиться новое действие
    (дата последнего действия новее кэша) или кэшу больше 30 дней."""
    if not aid:
        return []
    key = f"{agency}:{aid}"
    h = hist if hist is not None else _load_hist()
    ent = h.get(key)
    if agency == "NRA":
        inn = aid[2:] if aid.startswith("i:") else aid
        try:
            rows = [r for r in _nra_export() if r.get("inn") == inn and not r.get("issue")]
        except Exception as e:  # noqa: BLE001
            log.warning("НРА история: %s", e)
            return (ent or {}).get("items") or []
        items = sorted([[r["date"], r.get("rating") if (r.get("rating") or "—") != "—" else "Отозван",
                         None if r.get("forecast") in (None, "—", "Без прогноза") else r.get("forecast"), r.get("status")]
                        for r in rows if r.get("date")])
        return items
    stale = (ent is None or time.time() - ent.get("at", 0) > 30 * 86400
             or (last_action and (ent.get("last") or "") < last_action)
             or (agency == "EXPERT_RA" and ent.get("v", 1) < 4))          # v4: + архив без колонки «Прогноз»
    if stale and fetch:
        url, parser = _hist_url(agency, aid), _HIST_PARSERS.get(agency)
        if url and parser:
            try:
                r = requests.get(url, headers={"User-Agent": _UA["User-Agent"]}, timeout=25, verify=(agency != "ACRA"))
                if r.status_code == 200:
                    items = sorted(parser(r.text))
                    ent = {"at": time.time(), "last": max([x[0] for x in items if x[0]] + [last_action or ""]), "items": items, "v": 4}
                    h[key] = ent
                    if hist is None:
                        _save_hist(h)
            except requests.RequestException as e:
                log.warning("история %s: %s", key, e)
    return (ent or {}).get("items") or []


def refresh_timelines(db: Session, budget_s: float = 600) -> dict:
    """Догрузить историю для эмитентов, связанных с бумагами MOEX (новые действия / пустой кэш)."""
    t0, h, n = time.time(), _load_hist(), 0
    rows = db.query(AgencyRating).filter(AgencyRating.eid.isnot(None), AgencyRating.agency.in_(("ACRA", "EXPERT_RA", "NKR"))).all()
    for r in rows:
        if _group(r.rating_type) != "issuer" or not r.agency_issuer_id:
            continue
        if time.time() - t0 > budget_s:
            break
        before = (h.get(f"{r.agency}:{r.agency_issuer_id}") or {}).get("at")
        timeline(r.agency, r.agency_issuer_id, r.action_date, hist=h)
        if (h.get(f"{r.agency}:{r.agency_issuer_id}") or {}).get("at") != before:
            n += 1
            time.sleep(0.4)
    _save_hist(h)
    return {"fetched": n, "cached": len(h)}


# --------------------------------------------------------------------------- #
# Сохранение + история
# --------------------------------------------------------------------------- #
def _group(rt: str | None) -> str:
    return "issue" if rt in ("issue", "sf") else "issuer"


def _store(db: Session, agency: str, recs: list[dict], now) -> dict:
    """Заменить действующие рейтинги агентства и дописать историю изменений.

    Защита от «тихого стирания» (капча / сбой / смена вёрстки дают урезанный список):
    рейтинги эмитентов и выпусков заменяются НЕЗАВИСИМО и только если новых не меньше 80%
    прежнего числа — иначе прежние остаются (например, упал только обход выпусков)."""
    active = [r for r in recs if not r["withdrawn"] and r["score"] is not None]
    prev_rows = db.query(AgencyRating).filter(AgencyRating.agency == agency).all()
    prev = {}
    prev_name = {}
    for p in prev_rows:
        d = {"rating_type": p.rating_type or "issuer", "isin": p.isin, "agency_issuer_id": p.agency_issuer_id,
             "raw": p.issuer_raw}
        prev[_subject(d)] = p
        if _group(p.rating_type) == "issuer" and not p.agency_issuer_id:   # старые строки (до id агентства)
            prev_name.setdefault(normalize_name(p.issuer_raw), []).append(p)
    # переход со старого формата: сопоставляем по имени только однозначные пары (одна старая строка
    # и одна новая с этим именем) — иначе «ЗАО Альфа-Банк» (BBB) унаследовал бы AAA «АО Альфа-Банк»
    new_names: dict[str, int] = {}
    for r in recs:
        if _group(r["rating_type"]) == "issuer":
            new_names[normalize_name(r["raw"])] = new_names.get(normalize_name(r["raw"]), 0) + 1
    prev_name = {k: v[0] for k, v in prev_name.items() if len(v) == 1 and new_names.get(k) == 1}
    res = {"agency": agency, "at": now.isoformat()}
    replace = {}
    for g in ("issuer", "issue"):
        n_new = sum(1 for r in active if _group(r["rating_type"]) == g)
        n_old = sum(1 for p in prev_rows if _group(p.rating_type) == g      # прежние ДЕЙСТВУЮЩИЕ
                    and p.rating_score is not None and not _withdrawn(p.rating) and not _withdrawn(p.action))
        replace[g] = not (n_old and n_new < 0.8 * n_old)
        res[g] = n_new
        if not replace[g]:
            log.warning("%s/%s: получено %d против %d ранее — не перезаписываю", agency, g, n_new, n_old)
            res.setdefault("skipped", []).append(f"{g}: {n_new} против {n_old}")
    # последняя запись истории по субъекту — чтобы не дублировать неизменившееся
    last_h = {}
    for h in db.query(AgencyRatingHistory).filter(AgencyRatingHistory.agency == agency).order_by(AgencyRatingHistory.seen_at).all():
        last_h[h.subject] = h
    hist_added = 0

    def add_hist(subj, r, rating, score, action):
        nonlocal hist_added
        db.add(AgencyRatingHistory(agency=agency, subject=subj, issuer_raw=r["raw"], isin=r.get("isin"),
                                   rating=rating, rating_score=score, forecast=r.get("forecast"),
                                   action=action, action_date=r.get("action_date"), seen_at=now))
        hist_added += 1

    for r in recs:
        if not replace[_group(r["rating_type"])]:
            continue
        subj = _subject(r)
        last = last_h.get(subj)
        if r["withdrawn"]:
            if last is None or not _withdrawn(last.action):
                add_hist(subj, r, "Отозван", None, "Отозван")
            continue
        if r["score"] is None:
            continue
        p = prev.get(subj) or (prev_name.get(normalize_name(r["raw"])) if _group(r["rating_type"]) == "issuer" else None)
        if p is not None and p.rating and p.rating != r["rating"] and p.rating_score is not None:
            r["trend"] = "up" if r["score"] > p.rating_score else "down" if r["score"] < p.rating_score else None
            r["prev_rating"] = p.rating
        elif p is not None and p.rating == r["rating"]:
            r["trend"], r["prev_rating"] = p.trend or _trend_from_action(r["action"]), p.prev_rating
        else:
            r["trend"], r["prev_rating"] = _trend_from_action(r["action"]), None
        if last is None or last.rating != r["rating"] or (last.forecast or None) != r["forecast"] or _withdrawn(last.action):
            act = r["action"]
            if last is not None and not _withdrawn(last.action) and last.rating != r["rating"] and last.rating_score is not None:
                act = "Повышен" if r["score"] > last.rating_score else "Понижен" if r["score"] < last.rating_score else act
            elif last is not None and last.rating == r["rating"]:
                act = act or "Изменён прогноз"
            add_hist(subj, r, r["rating"], r["score"], act or ("Присвоен" if last is None else None))

    for g in ("issuer", "issue"):
        if not replace[g]:
            continue
        for p in prev_rows:
            if _group(p.rating_type) == g:
                db.delete(p)
    for r in active:
        if not replace[_group(r["rating_type"])]:
            continue
        db.add(AgencyRating(issuer_norm=normalize_name(r["raw"]), issuer_raw=r["raw"], agency=agency,
                            rating=r["rating"], rating_bucket=r["bucket"], rating_score=r["score"],
                            forecast=r["forecast"], scale=r.get("scale"), action=r.get("action"),
                            action_date=r.get("action_date"), updated_at=now,
                            agency_issuer_id=r.get("agency_issuer_id"), isin=r.get("isin"),
                            rating_type=r["rating_type"], expected=r["expected"], inn=r.get("inn"),
                            seniority=r.get("seniority"), trend=r.get("trend"), prev_rating=r.get("prev_rating")))
    db.commit()
    res["stored"] = sum(1 for r in active if replace[_group(r["rating_type"])])
    res["history_added"] = hist_added
    _INDEX["sig"] = None
    return res


# --------------------------------------------------------------------------- #
# Индекс для сопоставления с облигациями MOEX
# --------------------------------------------------------------------------- #
class RatingsIndex(dict):
    """dict: нормализованное имя эмитента → рейтинги эмитента (старый интерфейс, запасной путь)
    + by_eid: MOEX emitent_id → рейтинги эмитента;  by_isin: ISIN → рейтинги выпуска."""
    by_eid: dict
    by_isin: dict


_INDEX: dict = {"sig": None, "idx": None}


def _moex_identity(db: Session):
    """ISIN → (eid, ИНН) из снимка рынка (+ ISS-кэш MOEX, если ИНН в снимке ещё не заполнены)."""
    rows = db.query(BondSnapshot.isin, BondSnapshot.emitent_id, BondSnapshot.emitent_inn,
                    BondSnapshot.emitent_title).all()
    isin2 = {r.isin: [str(r.emitent_id) if r.emitent_id else None, r.emitent_inn, r.emitent_title] for r in rows}
    if rows and sum(1 for v in isin2.values() if v[1]) < 0.5 * len(rows):
        try:
            from . import moex
            inns, titles = moex.get_issuer_inns(), moex.get_issuer_titles()
            for isin, v in isin2.items():
                v[1] = v[1] or inns.get(isin)
                v[2] = v[2] or titles.get(isin)
        except Exception as e:  # noqa: BLE001
            log.warning("MOEX ИНН недоступны: %s", e)
    inn2eid: dict[str, set] = {}
    title2eid: dict[str, set] = {}
    for eid, inn, title in isin2.values():
        if eid and inn:
            inn2eid.setdefault(inn, set()).add(eid)
        if eid and title:
            title2eid.setdefault(normalize_name(title), set()).add(eid)
    return isin2, inn2eid, title2eid


def _link_eids(db: Session, rows: list, ident=None) -> dict[int, tuple[set, str]]:
    """id строки AgencyRating → (множество MOEX eid, способ: inn | isin | title).
    Выпуск: eid по ISIN. Эмитент: по ИНН; иначе через ISIN его рейтингуемых выпусков (АКРА:
    рейтинг «ИКС 5 Ритейл Групп» ↔ выпуски ООО «ИКС 5 ФИНАНС»); иначе по точному полному
    юр. названию MOEX, только если оно однозначно."""
    isin2, inn2eid, title2eid = ident or _moex_identity(db)
    via_issue: dict[tuple, set] = {}
    out = {}
    for r in rows:
        if _group(r.rating_type) == "issue":
            eid = (isin2.get(r.isin) or [None])[0]
            out[r.id] = ({eid} if eid else set(), "isin")
            if eid and r.agency_issuer_id:
                via_issue.setdefault((r.agency, r.agency_issuer_id), set()).add(eid)
    # одинаковое нормализованное имя у двух эмитентов одного агентства («АО Альфа-Банк» и
    # «ЗАО Альфа-Банк» из другой страны) — по названию такие не привязываем вовсе
    name_cnt: dict[tuple, int] = {}
    name_inns: dict[str, set[str]] = {}
    for r in rows:
        if _group(r.rating_type) == "issuer":
            nk = normalize_name(r.issuer_raw)
            k = (r.agency, nk)
            name_cnt[k] = name_cnt.get(k, 0) + 1
            if r.inn:
                name_inns.setdefault(nk, set()).add(r.inn)
    for r in rows:
        if _group(r.rating_type) != "issuer":
            continue
        if r.inn and inn2eid.get(r.inn):
            out[r.id] = (set(inn2eid[r.inn]), "inn")
        elif r.agency_issuer_id and via_issue.get((r.agency, r.agency_issuer_id)):
            out[r.id] = (set(via_issue[(r.agency, r.agency_issuer_id)]), "isin")
        else:
            nk = normalize_name(r.issuer_raw)
            t = title2eid.get(nk) or set()
            # Совпадение имени считаем безопасным, только если разные агентства не
            # публикуют под этим именем разные ИНН (два разных «Прогресса»).
            ok = (len(t) == 1 and name_cnt.get((r.agency, nk), 0) == 1
                  and len(name_inns.get(nk, set())) <= 1)
            out[r.id] = (set(t), "title") if ok else (set(), "")
    return out


def _as_dict(r, match: str = "") -> dict:
    return {"agency": r.agency, "rating": r.rating, "bucket": r.rating_bucket, "score": r.rating_score,
            "forecast": r.forecast, "action": r.action, "action_date": r.action_date,
            "level": "issue" if _group(r.rating_type) == "issue" else "issuer",
            "sf": r.rating_type == "sf", "expected": bool(r.expected), "seniority": r.seniority,
            "trend": r.trend, "prev_rating": r.prev_rating, "issuer_raw": r.issuer_raw,
            "isin": r.isin, "agency_issuer_id": r.agency_issuer_id, "match": match}


def ratings_map(db: Session) -> RatingsIndex:
    """Индекс рейтингов (кэш до следующего обновления рейтингов / снимка рынка)."""
    from sqlalchemy import func
    sig = (db.query(func.count(AgencyRating.id), func.max(AgencyRating.updated_at)).first(),
           db.query(func.count(BondSnapshot.isin), func.max(BondSnapshot.updated_at)).first())
    sig = tuple(tuple(x) for x in sig)
    if _INDEX["sig"] == sig and _INDEX["idx"] is not None:
        return _INDEX["idx"]
    rows = [r for r in db.query(AgencyRating).all()
            if not _withdrawn(r.rating) and not _withdrawn(r.action)]
    key_inns: dict[str, set[str]] = {}
    for r in rows:
        if _group(r.rating_type) == "issuer" and r.inn:
            key_inns.setdefault(normalize_name(r.issuer_raw), set()).add(r.inn)
    ident = _moex_identity(db)
    links = _link_eids(db, rows, ident)
    out = RatingsIndex()
    out.by_eid, out.by_isin = {}, {}
    for r in rows:
        eids, how = links.get(r.id, (set(), ""))
        d = _as_dict(r, how)
        d["eids"] = sorted(eids)
        if d["level"] == "issue":
            if r.isin:
                out.by_isin.setdefault(r.isin, []).append(d)
            continue
        # ВАЖНО: ключ нормализуем ЗАНОВО из issuer_raw ТЕКУЩЕЙ функцией, а НЕ берём сохранённый
        # issuer_norm — иначе после изменения правил нормализации ключи расходятся.
        key = normalize_name(r.issuer_raw) or r.issuer_norm
        # При одинаковом имени и разных опубликованных ИНН запасной матч по имени
        # отключаем: это разные юридические лица, даже если короткие названия совпали.
        if len(key_inns.get(key, set())) <= 1:
            out.setdefault(key, []).append({**d, "match": "name"})
        for e in eids:
            out.by_eid.setdefault(e, []).append(d)
    # несколько рейтингов одного агентства на один eid (гарант + SPV, дубли) → по ИНН/названию,
    # иначе худший (консервативно)
    # ИНН — точно; ISIN собственных рейтингов выпусков агентства — надёжно; название — слабее всего
    rank = {"inn": 0, "isin": 1, "title": 2}
    for e, lst in out.by_eid.items():
        by_ag: dict = {}
        for d in lst:
            cur = by_ag.get(d["agency"])
            if cur is None or (rank.get(d["match"], 9), d["score"] or 0) < (rank.get(cur["match"], 9), cur["score"] or 0):
                by_ag[d["agency"]] = d
        out.by_eid[e] = list(by_ag.values())

    # ручные / проверенные рейтинги (снимок в data/verified_ratings.json) — ТОЛЬКО заполняют
    # пробелы: если у агентства есть свежая автоматическая запись — побеждает она (раньше снимок
    # перекрывал выгрузку и мог устареть). Ключи снимка посчитаны старой нормализацией (со
    # стиранием «банк») → переводим в новые через имена реестра.
    old2new: dict[str, set] = {}
    for r in rows:
        if r.issuer_raw and _group(r.rating_type) == "issuer":
            old2new.setdefault(normalize_name(r.issuer_raw, _LEGAL_OLD), set()).add(normalize_name(r.issuer_raw))
    title2eid = ident[2]
    name2eids: dict[str, set] = {}
    for r in rows:
        if _group(r.rating_type) == "issuer":
            name2eids.setdefault(normalize_name(r.issuer_raw), set()).update(links.get(r.id, (set(), ""))[0])
    for _norm, _recs in _MANUAL.items():
        nk = old2new.get(_norm, set())
        tgt = _norm if (_norm in nk or not nk) else (next(iter(nk)) if len(nk) == 1 else _norm)
        have = {e["agency"] for e in out.get(tgt, [])}
        eids = name2eids.get(tgt) or (title2eid.get(tgt) if len(title2eid.get(tgt) or ()) == 1 else set())
        add = [{**m, "level": "issuer", "sf": False, "expected": False, "seniority": None, "trend": None,
                "prev_rating": None, "issuer_raw": tgt, "isin": None, "agency_issuer_id": None, "match": "manual",
                "eids": sorted(eids or ()), "action_date": iso_date(m.get("action_date")) or m.get("action_date")}
               for m in _recs if m["agency"] not in have]
        if not add:
            continue
        out.setdefault(tgt, []).extend(add)
        for e in eids or ():
            ags = {x["agency"] for x in out.by_eid.get(e, [])}
            out.by_eid.setdefault(e, []).extend(a for a in add if a["agency"] not in ags)

    # хвостовые алиасы для запасного матчинга по имени (см. universe._match_agency)
    real_keys = set(out)
    cands: dict[str, list] = {}
    for key in real_keys:
        toks = key.split()
        if len(toks) < 2:
            continue
        tail = " ".join(toks[1:])
        if tail in real_keys or len(tail) < (2 if toks[0] == "банк" else 5):
            continue
        cands.setdefault(tail, []).append(key)
    for tail, keys in cands.items():
        if len(keys) > 1:
            keys = [k for k in keys if not k.startswith("банк ")] or keys
        if len(keys) == 1:
            out.setdefault(tail, out[keys[0]])
    _INDEX.update(sig=sig, idx=out)
    return out


def bridge(db: Session) -> dict:
    """Записать найденные MOEX eid в agency_ratings (для API / отладки)."""
    rows = db.query(AgencyRating).all()
    links = _link_eids(db, rows)
    n = 0
    for r in rows:
        eids = " ".join(sorted(links.get(r.id, (set(), ""))[0])) or None
        if r.eid != eids:
            r.eid = eids
            n += 1
    db.commit()
    by = {}
    for r in rows:
        how = links.get(r.id, (set(), ""))[1] if r.eid else "none"
        by[f"{_group(r.rating_type)}:{how}"] = by.get(f"{_group(r.rating_type)}:{how}", 0) + 1
    return {"updated": n, "linked": by}


_PRIO = {"ACRA": 0, "EXPERT_RA": 1, "NKR": 2, "NRA": 3}


def best_for(agency_ratings: list[dict]) -> dict | None:
    """Рейтинг для показа при нескольких агентствах — ХУДШИЙ (консервативно: инвестор видит
    нижнюю оценку, остальные — в разбивке по агентствам). Одна запись на агентство; при равных
    уровнях — стабильный выбор агентства (АКРА → Эксперт РА → НКР → НРА)."""
    rs = [r for r in (agency_ratings or []) if r.get("score") is not None]
    if not rs:
        return (agency_ratings or [None])[0]
    by_ag: dict = {}
    for r in rs:
        by_ag[r.get("agency")] = r
    worst = min(r["score"] for r in by_ag.values())
    return min((r for r in by_ag.values() if r["score"] == worst), key=lambda r: _PRIO.get(r.get("agency"), 9))


def for_bond(idx: dict | None, isin: str | None, eid: str | None, fallback: list | None = None) -> tuple[list, str]:
    """Рейтинги облигации по агентствам: рейтинг ВЫПУСКА (по ISIN) приоритетнее рейтинга
    эмитента того же агентства (учитывает субординацию / обеспечение / .sf). Возвращает
    (список по агентствам, способ сопоставления эмитента: eid | name | '')."""
    by_isin = getattr(idx, "by_isin", {}) or {}
    by_eid = getattr(idx, "by_eid", {}) or {}
    per: dict[str, dict] = {}
    hows = set()
    for r in (by_eid.get(str(eid)) or []) if eid else []:
        per.setdefault(r["agency"], {})["issuer"] = r
        hows.add("eid")
    # запасной путь по имени — только для агентств, не найденных по ИНН/ISIN, и только если
    # найденная по имени запись не привязана к ДРУГОМУ эмитенту MOEX (тогда совпадение ложное)
    for r in fallback or []:
        if r["agency"] in per or (eid and r.get("eids") and str(eid) not in r["eids"]):
            continue
        per.setdefault(r["agency"], {})["issuer"] = {**r, "match": "name"}
        hows.add("name")
    how = "eid" if "eid" in hows else ("name" if hows else "")
    for r in by_isin.get(isin or "", []):
        per.setdefault(r["agency"], {})["issue"] = r
    out = []
    for ag, d in per.items():
        eff = d.get("issue") or d.get("issuer")
        out.append({**eff, "issuer_aid": (d.get("issuer") or {}).get("agency_issuer_id") or eff.get("agency_issuer_id"),
                    "issuer_rating": (d.get("issuer") or {}).get("rating"),
                    "issuer_forecast": (d.get("issuer") or {}).get("forecast"),
                    "issuer_bucket": (d.get("issuer") or {}).get("bucket"),
                    "issue_rating": (d.get("issue") or {}).get("rating")})
    out.sort(key=lambda r: _PRIO.get(r["agency"], 9))
    return out, how


def history(db: Session, subjects: list[tuple[str, str]], limit: int = 60) -> list[dict]:
    """История рейтинговых действий по списку (агентство, субъект)."""
    from sqlalchemy import or_, and_
    if not subjects:
        return []
    q = db.query(AgencyRatingHistory).filter(or_(*[and_(AgencyRatingHistory.agency == a, AgencyRatingHistory.subject == s)
                                                   for a, s in subjects]))
    return [{"agency": h.agency, "subject": h.subject, "issuer": h.issuer_raw, "isin": h.isin, "rating": h.rating,
             "forecast": h.forecast, "action": h.action, "action_date": h.action_date,
             "seen_at": h.seen_at.isoformat() if h.seen_at else None}
            for h in q.order_by(AgencyRatingHistory.seen_at.desc(), AgencyRatingHistory.id.desc()).limit(limit).all()]


def subject_of(d: dict) -> str:
    """Субъект истории для записи из ratings_map/for_bond."""
    return _subject({"rating_type": "issue" if d.get("level") == "issue" else "issuer", "isin": d.get("isin"),
                     "agency_issuer_id": d.get("agency_issuer_id"), "raw": d.get("issuer_raw")})


def refresh(db: Session, which=("acra", "nkr", "expert", "nra")) -> dict:
    res = {}
    for code, fn in (("acra", scrape_acra), ("nkr", scrape_nkr), ("expert", scrape_expert), ("nra", scrape_nra)):
        if code in which:
            try:
                res[code] = fn(db)
            except Exception as e:  # noqa: BLE001
                db.rollback()
                log.warning("ratings %s failed: %s", code, e)
                res[code] = {"error": str(e)[:200]}
    try:
        res["bridge"] = bridge(db)
    except Exception as e:  # noqa: BLE001
        res["bridge"] = {"error": str(e)[:200]}
    try:
        res["history"] = refresh_timelines(db)
    except Exception as e:  # noqa: BLE001
        res["history"] = {"error": str(e)[:200]}
    return res
