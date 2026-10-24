"""Справочник облигаций без dohod.ru: только Мосбиржа и ФНС.

Раньше таблицу bond_ratings заполнял dohod.ru (отрасль, эмитент, признак флоатера, индекс и
маржа, текущий купон, оферта, дата размещения). Данные там обновлялись редко (последний раз —
29.08.2026), у ~850 новых выпусков их не было вовсе, а оферты и индексы устаревали. Теперь:

  • описание выпуска — ISS securities/<ISIN>.json (description): вид облигации, индекс купона
    (COUPON_BENCHMARK), маржа (COUPON_BENCHMARK_SPREAD), дата начала торгов; кэш в файле,
    докачиваются только новые выпуски;
  • оферты — общий график биржи (statistics/…/bondization, блок offers), см. zspread.py;
  • с dohod.ru — только даты колл-опционов (биржа их не публикует) и названия эмитентов, см. refresh_calls;
  • отрасль — по ОКВЭД эмитента из ГИР БО ФНС (bo.nalog.gov.ru) по ИНН + правила: ОФЗ и
    регионы, банки (в ГИР БО их нет — отчитываются в ЦБ), SPV → группа, и собственные
    исправления (SECTOR_FIX ниже) там, где ОКВЭД холдинга не говорит о бизнесе группы.

Таблица bond_ratings после rebuild() содержит только эти данные (source="moex").
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Optional

import requests

from . import moex

log = logging.getLogger("moex_ref")

_DATA = Path(__file__).parent / "data"
_DESC_FILE = _DATA / "moex_desc.json"
_OKVED_FILE = _DATA / "okved_by_inn.json"
_LOCK = threading.Lock()
_GIRBO = "https://bo.nalog.gov.ru/advanced-search/organizations/search"


def _load(p: Path) -> dict:
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def _save(p: Path, d: dict) -> None:
    try:
        p.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    except OSError as e:
        log.warning("не сохранить %s: %s", p.name, e)


# --------------------------------------------------------------------------- #
# Описание выпуска
# --------------------------------------------------------------------------- #
_DESC_KEYS = {"BOND_TYPE": "bt", "COUPON_BENCHMARK": "bm", "COUPON_BENCHMARK_SPREAD": "sp",
              "ISSUEDATE": "issued", "STARTDATEMOEX": "start", "TYPENAME": "tn"}


def _fetch_desc(isin: str) -> Optional[dict]:
    try:
        rows = moex._block(moex._get(f"securities/{isin}.json", {"iss.only": "description"}), "description")
    except Exception:  # noqa: BLE001
        return None
    d = {}
    for r in rows:
        k = _DESC_KEYS.get(r.get("name"))
        if k:
            d[k] = r.get("value")
    if d.get("sp") not in (None, ""):
        try:
            d["sp"] = float(d["sp"])
        except (TypeError, ValueError):
            d["sp"] = None
    return d


def descriptions(isins: list[str], fetch_missing: bool = True) -> dict:
    """{isin: {bt, bm, sp, issued, start, tn}} — из файла; недостающие докачиваются."""
    cache = _load(_DESC_FILE)
    miss = [i for i in isins if i not in cache]
    if fetch_missing and miss:
        with ThreadPoolExecutor(max_workers=6) as ex:
            for i, d in zip(miss, ex.map(_fetch_desc, miss)):
                if d is not None:
                    cache[i] = d
        _save(_DESC_FILE, cache)
        log.warning("описания выпусков: докачано %d из %d", sum(1 for i in miss if i in cache), len(miss))
    return cache


def norm_index(bm: Optional[str]) -> Optional[str]:
    """Код индекса биржи → наш: RREFKEYR → CBR_RATE, RUONIA* → RUONIA, прочие как есть."""
    b = (bm or "").upper().strip()
    if not b:
        return None
    if b.startswith("RREFKEYR") or b in ("KEYRATE", "CBR_RATE"):
        return "CBR_RATE"
    if b.startswith("RUONIA"):
        return "RUONIA"
    return b


# --------------------------------------------------------------------------- #
# Отрасль
# --------------------------------------------------------------------------- #
def _fetch_okved(inn: str) -> Optional[dict]:
    """ОКВЭД по ИНН из ГИР БО. Сервис ограничивает частоту — до трёх попыток с паузой.
    {"okved": None} — организации нет в ГИР БО (банки; компании со скрытой отчётностью)."""
    for attempt in range(3):
        try:
            r = requests.get(_GIRBO, params={"query": inn, "page": 0}, timeout=20,
                             headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
            if r.status_code in (429, 502, 503):
                raise requests.HTTPError(str(r.status_code))
            r.raise_for_status()
            for x in r.json().get("content") or []:
                if re.sub(r"<[^>]+>", "", x.get("inn") or "") == inn:
                    return {"okved": x.get("okved2"), "name": x.get("shortName")}
            return {"okved": None}
        except Exception:  # noqa: BLE001
            time.sleep(2 * (attempt + 1))
    return None


def okveds(inns: list[str], fetch_missing: bool = True) -> dict:
    cache = _load(_OKVED_FILE)
    miss = [i for i in inns if i and i not in cache]
    if fetch_missing and miss:
        with ThreadPoolExecutor(max_workers=2) as ex:
            for i, d in zip(miss, ex.map(_fetch_okved, miss)):
                if d is not None:
                    cache[i] = d
        _save(_OKVED_FILE, cache)
        log.warning("ОКВЭД эмитентов: докачано %d из %d", sum(1 for i in miss if i in cache), len(miss))
    return cache


# ОКВЭД2 → отрасль (по самому длинному совпавшему префиксу)
_OKVED_MAP = {
    "01": "АПК и пищепром", "02": "ЦБП и упаковка", "03": "АПК и пищепром",
    "05": "Добыча", "06": "Нефтегаз", "07": "Металлургия", "08": "Добыча", "09.1": "Нефтегаз", "09.9": "Добыча",
    "10": "АПК и пищепром", "11": "АПК и пищепром", "12": "АПК и пищепром",
    "13": "Ритейл и торговля", "14": "Ритейл и торговля", "15": "Ритейл и торговля",
    "16": "ЦБП и упаковка", "17": "ЦБП и упаковка", "18": "ЦБП и упаковка",
    "19": "Нефтегаз", "20": "Химия", "21": "Фарма и медицина", "22": "Химия",
    "23": "Девелопмент и недвижимость", "24": "Металлургия", "25": "Машиностроение и ОПК",
    "26": "Машиностроение и ОПК", "27": "Машиностроение и ОПК", "28": "Машиностроение и ОПК",
    "29": "Машиностроение и ОПК", "30": "Машиностроение и ОПК", "33": "Машиностроение и ОПК",
    "35": "Электроэнергетика и ЖКХ", "36": "Электроэнергетика и ЖКХ", "37": "Электроэнергетика и ЖКХ",
    "38": "Электроэнергетика и ЖКХ", "39": "Электроэнергетика и ЖКХ",
    "41": "Девелопмент и недвижимость", "42": "Девелопмент и недвижимость", "43": "Девелопмент и недвижимость",
    "45": "Ритейл и торговля", "46": "Ритейл и торговля", "46.71": "Нефтегаз", "47": "Ритейл и торговля",
    "47.3": "Нефтегаз",
    "49": "Транспорт и логистика", "49.5": "Нефтегаз", "50": "Транспорт и логистика",
    "51": "Транспорт и логистика", "52": "Транспорт и логистика", "53": "Транспорт и логистика",
    "55": "Услуги и досуг", "56": "Услуги и досуг",
    "58": "Связь, ИТ и телеком", "59": "Связь, ИТ и телеком", "60": "Связь, ИТ и телеком",
    "61": "Связь, ИТ и телеком", "62": "Связь, ИТ и телеком", "63": "Связь, ИТ и телеком",
    "64.19": "Банки", "64.91": "Лизинг", "64.92": "Финансы (прочее)", "64.2": "Холдинги",
    "22.22": "ЦБП и упаковка", "46.4": "Ритейл и торговля", "46.46": "Фарма и медицина",
    "46.5": "Связь, ИТ и телеком", "70.2": "Холдинги", "82.91": "Финансы (прочее)",
    "64": "Финансы (прочее)", "65": "Финансы (прочее)", "66": "Финансы (прочее)",
    "68": "Девелопмент и недвижимость", "70.1": "Холдинги",
    "69": "Услуги и досуг", "70": "Услуги и досуг", "71": "Услуги и досуг", "72": "Фарма и медицина",
    "73": "Услуги и досуг", "74": "Услуги и досуг", "75": "Услуги и досуг",
    "77.1": "Транспорт и логистика", "77.3": "Лизинг", "77": "Лизинг",
    "78": "Услуги и досуг", "79": "Услуги и досуг", "80": "Услуги и досуг", "81": "Услуги и досуг",
    "82": "Услуги и досуг", "84": "Госбумаги и регионы", "85": "Услуги и досуг",
    "86": "Фарма и медицина", "87": "Фарма и медицина", "88": "Услуги и досуг",
    "90": "Услуги и досуг", "91": "Услуги и досуг", "92": "Услуги и досуг", "93": "Услуги и досуг",
}

# Собственные исправления по эмитенту (регулярка по полному названию эмитента биржи): ОКВЭД
# холдинговой компании (64.20 / 70.10 / 64.99) не говорит, чем занята группа, у части компаний
# основной код устарел. Регистр не важен.
SECTOR_FIX = (
    (r"министерство финансов|минфин|\bобласт|\bкрай\b|\bкрая\b|республик|автономн|администрац|департамент финанс|"
     r"комитет финанс|город[а-я ]*москв|правительств|муниципальн", "Госбумаги и регионы"),
    (r"банк дом\.рф", "Банки"),
    (r"\bвэб\.?рф\b|государственн\w* специализированн\w* российск|дом\.рф|фонд развития|российский экспортн|"
     r"\bэксар\b|автомобильные дороги|автодор|роснано", "Госбумаги и регионы"),
    (r"лизинг", "Лизинг"),
    (r"микрофинанс|\bмфк\b|\bмкк\b|займер|веббанкир|мани мен|кредитэкспресс", "Микрофинансы"),
    (r"банк\b|кредитн\w* организац|\bмкб\b|московский кредитный|росбанк|райффайзен|юникредит|уралсиб|"
     r"\bвтб\b|\bак барс\b", "Банки"),
    (r"специализированн\w* финансов\w* обществ|ипотечн\w* агент|\bсфо\b", "Финансы (прочее)"),
    (r"каршеринг|делимобил|главная дорога|скоростн\w* диаметр|магистрал|почта росси|коммерческий флот|"
     r"аэропорт|авиакомпан|морск\w* порт|\bпорт\b|судоходн|железнодорож", "Транспорт и логистика"),
    (r"вертол[её]т|\bкамаз\b|двигателестро|авиастро|ракетн|оборонн|машиностро|судостро|уралвагон|\bростех\b|"
     r"объединенная авиа|станкостро|станкомаш|вагоностро|производственное объединение|трансмаш|гидромаш|"
     r"транспортные машины|приборостро|электроприбор|моторн\w* технолог|\bзаслон\b|машзавод", "Машиностроение и ОПК"),
    (r"новабев|белуга|инарктика|черкизово|абрау|русагро|мираторг|эфко|\bрусская аквакультура", "АПК и пищепром"),
    (r"позитив|\bвк\b|\bvk\b|софтлайн|аренадата|астра\b|группа астра|селектел|ростелеком|ред софт|диасофт", "Связь, ИТ и телеком"),
    (r"артген|фармстандарт|промомед|генериум|медси|медскан|\bмать и дитя\b", "Фарма и медицина"),
    (r"монополия|глобал ?трак|деловые линии|\bпэк\b", "Транспорт и логистика"),
    (r"\bапри\b|а спэйс|\bэталон\b", "Девелопмент и недвижимость"),
    (r"сегежа", "ЦБП и упаковка"),
    (r"финансовая корпорация.{0,3}система|\bафк\b", "Холдинги"),
    (r"о'?кей\b|\bмагнит\b|\bx5\b|икс 5|\bлента\b|м\.видео|\bмвм\b|детский мир|fix price|фикс прайс|"
     r"\bozon\b|\bозон\b|вайлдберриз|wildberries|henderson|хендерсон|аптечная сеть", "Ритейл и торговля"),
    (r"\bсамол[её]т\b|\bпик\b|пик-специализированный|\bлср\b|\bэталон\b|брусника|\bсэтл\b|\bа101\b|"
     r"джи-групп|гк пионер|группа компаний пионер", "Девелопмент и недвижимость"),
    (r"\bмтс\b|ростелеком|мегафон|вымпелком|\bбилайн\b|аренадата", "Связь, ИТ и телеком"),
    (r"\bржд\b|российские железные|аэрофлот|совкомфлот|глобалтрак|\bфгк\b|\bпгк\b|первая грузовая", "Транспорт и логистика"),
    (r"нефтехим|\bсибур\b|полипласт|казаньоргсинтез", "Химия"),
    (r"газпром нефть|роснефть|лукойл|новатэк|татнефть|транснефть|газпром(?! ?банк)|зарубежнефть", "Нефтегаз"),
    (r"норникель|норильский никель|северсталь|\bнлмк\b|\bммк\b|магнитогорск|металлоинвест|евраз|русал|"
     r"\bполюс\b|полиметалл|селигдар|уральская горно|\bугмк\b|мечел", "Металлургия"),
    (r"\bсуэк\b|распадская|кузбассразрез|алроса|\bкокс\b|уголь|угольн", "Добыча"),
    (r"металлург|трубн\w* металлург|\bтмк\b|кузниц|сталь\b", "Металлургия"),
    (r"нефт|газов\w* компан|топливно-энерг", "Нефтегаз"),
    (r"фосагро|\bакрон\b|еврохим|уралхим|казаньоргсинтез", "Химия"),
    (r"русгидро|россети|\bфск\b|интер рао|юнипро|\bт плюс\b|\bтгк\b|мосэнерго|атомэнергопром|атомный энергопромышленный комплекс|водоканал", "Электроэнергетика и ЖКХ"),
)


def sector_of(name: str, inn: Optional[str], secid: str, okv: Optional[str]) -> str:
    """Отрасль эмитента: правила по названию важнее ОКВЭД (ОФЗ, регионы, банки, известные группы)."""
    low = (name or "").lower()
    if (secid or "").startswith("SU"):
        return "Госбумаги и регионы"
    for pat, sec in SECTOR_FIX:
        if re.search(pat, low):
            return sec
    if okv:
        best = None
        for pref, sec in _OKVED_MAP.items():
            if (okv == pref or okv.startswith(pref + ".") or okv.startswith(pref)) and (best is None or len(pref) > len(best[0])):
                best = (pref, sec)
        if best:
            return best[1]
    return "Прочее"


# --------------------------------------------------------------------------- #
# Название эмитента
# --------------------------------------------------------------------------- #
_FORMS = (
    (r"международная компания публичное акционерное общество", "МКПАО"),
    (r"непубличное акционерное общество", "НАО"),
    (r"публичное акционерное общество", "ПАО"),
    (r"закрытое акционерное общество", "ЗАО"),
    (r"открытое акционерное общество", "ОАО"),
    (r"акционерное общество", "АО"),
    (r"общество с ограниченной ответственностью", "ООО"),
    (r"государственная корпорация", "ГК"),
    (r"государственная компания", "ГК"),
)


def short_name(title: Optional[str]) -> Optional[str]:
    """«Публичное акционерное общество "Группа ЛСР"» → «ПАО "Группа ЛСР"»."""
    if not title:
        return None
    s = re.sub(r"\s+", " ", title).strip()
    for pat, abbr in _FORMS:
        s = re.sub(pat, abbr, s, flags=re.I)
    return s


_LEGAL = r"\(?\b(?:МКПАО|ПАО|НАО|ОАО|ЗАО|АО|ООО|АКБ|КБ|НКО)\b\)?"


def display_name(title: Optional[str], bond_names: list[str], secid: str = "") -> Optional[str]:
    """Как эмитента называют на рынке: «АФК Система», «Магнит», «РЖД», «ГТЛК».

    1) короткое название в кавычках из юр. имени биржи («Магнит», «Газпромбанк», «ДОМ.РФ»);
    2) если оно длинное («Акционерная финансовая корпорация "Система"») — самый частый бренд из
       названий выпусков биржи («АФК Система БО 001Р-31» → «АФК Система»);
    3) иначе — юр. имя в короткой форме. ОФЗ — «Минфин России»."""
    from collections import Counter
    from .universe import _brand_from_full
    if (secid or "").startswith("SU"):
        return "Минфин России"
    t = re.sub(r"\s+", " ", title or "").strip()
    q = re.search(r'"(.+)"', t)                   # от первой до последней кавычки: вложенные внутри
    core = q.group(1).strip() if q else re.sub(_LEGAL, "", short_name(t) or "").strip(" ,")
    core = core.replace('"', "") if core.count('"') == 1 else core
    if core and len(core) <= 24:
        return core
    def clean(b):
        b = re.sub(_LEGAL, "", b or "")
        return re.sub(r"\s+", " ", b).strip(" -,.")
    brands = Counter(c for c in (clean(_brand_from_full(n)) for n in bond_names) if c and not re.search(r"\d", c))
    if brands:
        b = brands.most_common(1)[0][0]
        if 2 <= len(b) <= 30:
            return b
    return short_name(t) or core or None


# --------------------------------------------------------------------------- #
# Сборка справочника
# --------------------------------------------------------------------------- #
def rebuild(db, fetch: bool = True) -> dict:
    """Пересобрать bond_ratings целиком из данных биржи и ФНС (source="moex").

    Поля: эмитент (короткое юр. название), отрасль (правила + ОКВЭД), флоатер / индекс / маржа
    (описание выпуска), текущий купон (снимок биржи), ближайшая оферта (общий график биржи),
    дата начала торгов. Рейтинги здесь не хранятся — они из агентств (agencies.py)."""
    from ..db import BondRating, BondSnapshot
    from . import zspread
    with _LOCK:
        t0 = time.time()
        snaps = db.query(BondSnapshot).all()
        desc = descriptions([s.isin for s in snaps], fetch_missing=fetch)
        okv = okveds(sorted({s.emitent_inn for s in snaps if s.emitent_inn}), fetch_missing=fetch)
        now = datetime.utcnow()
        from collections import defaultdict
        grp = defaultdict(list)                      # имя эмитента — одно на все его выпуски
        for s in snaps:
            grp[s.emitent_id or s.emitent_inn or s.isin].append(s)
        names = {}
        dn = dohod_names()
        for v in grp.values():
            # привычное название из dohod (самое частое среди выпусков эмитента); dohod знает не все
            # выпуски — тогда короткое юр. имя биржи («ПАО "Группа ЛСР"»), а длинное — рыночный бренд
            from collections import Counter
            dv = Counter(dn[x.isin] for x in v if dn.get(x.isin)).most_common(1)
            if dv:
                nm = dv[0][0]
            else:
                sn = short_name(v[0].emitent_title)
                nm = sn if sn and len(sn) <= 40 and not (v[0].secid or "").startswith("SU") else \
                    display_name(v[0].emitent_title, [x.issuer_full for x in v if x.issuer_full], v[0].secid or "")
            for x in v:
                names[x.isin] = nm
        db.query(BondRating).delete(synchronize_session=False)
        n = fl = 0
        for s in snaps:
            d = desc.get(s.isin) or {}
            idx = norm_index(d.get("bm"))
            sec = (s.secid or "")
            if not idx and sec.startswith(("SU29", "SU24")):
                idx = "RUONIA"                               # ОФЗ-ПК
            is_fl = bool(idx) or "плавающ" in (d.get("bt") or "").lower()
            title = s.emitent_title or s.issuer_full or s.shortname
            hz, _ = zspread.horizon(s.isin, s.matdate, s.buyback_date)
            db.add(BondRating(
                isin=s.isin,
                issuer=names.get(s.isin) or short_name(s.emitent_title) or s.issuer_full,
                sector=sector_of(title, s.emitent_inn, sec, (okv.get(s.emitent_inn) or {}).get("okved")),
                is_floater=is_fl, float_index=idx if is_fl else None,
                float_add=d.get("sp") if is_fl else None,
                current_coupon=s.couponpercent,
                effective_date=hz, event_flag=zspread.horizon_type(s.isin, hz),
                issue_date=d.get("issued") or d.get("start"),
                source="moex", updated_at=now))
            n += 1
            fl += is_fl
        db.commit()
        res = {"bonds": n, "floaters": fl, "descriptions": sum(1 for s in snaps if s.isin in desc),
               "okved": sum(1 for s in snaps if (okv.get(s.emitent_inn) or {}).get("okved")),
               "sec": round(time.time() - t0, 1)}
        log.warning("справочник из биржи и ФНС пересобран: %s", res)
        return res


# --------------------------------------------------------------------------- #
# Колл-опционы — единственное, что берём с dohod.ru
# --------------------------------------------------------------------------- #
# Мосбиржа публикует только пут-оферты; про колл (право эмитента погасить досрочно) у неё лишь
# признак «Оферта/Погашение» без даты. С dohod.ru берём ровно две вещи (решение пользователя,
# 28.09.2026): даты коллов (event «… (call)») и привычные названия эмитентов («ПАО АФК "Система"»).
_CALLS_FILE = _DATA / "dohod_calls.json"
_DOHOD_FEED = "https://www.dohod.ru/assets/components/dohodbonds/connectorweb.php?action=info"
_CALLS: dict = {"day": None, "by_isin": None, "names": None}


def calls() -> dict:
    """{isin: дата ближайшего колла} из файла (обновляет refresh_calls)."""
    if _CALLS["by_isin"] is None:
        raw = _load(_CALLS_FILE)
        _CALLS.update(day=raw.get("day"), by_isin=raw.get("by_isin") or {}, names=raw.get("names") or {})
    return _CALLS["by_isin"]


def dohod_names() -> dict:
    """{isin: название эмитента в dohod}."""
    calls()
    return _CALLS["names"] or {}


def refresh_calls(force: bool = False) -> int:
    """Раз в день: даты коллов из ленты dohod.ru. Возвращает число бумаг с коллом (0 — не обновляли)."""
    calls()
    today = datetime.now().date().isoformat()
    if not force and _CALLS["day"] == today:
        return 0
    try:
        r = requests.get(_DOHOD_FEED, timeout=60, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        rows = r.json()
    except Exception as e:  # noqa: BLE001 — не вышло: остаются вчерашние даты
        log.warning("коллы dohod недоступны: %s", e)
        return 0
    out, names = {}, {}
    for x in rows if isinstance(rows, list) else []:
        isin = (x.get("calc_isin") or x.get("xml_isin") or "").strip().upper()
        if not isin:
            continue
        d = (x.get("effective_date") or "")[:10]
        flags = (x.get("eventFlag") or "").upper().split(",")
        if "CALL" in flags and "(call)" in (x.get("event") or "").lower() and d > today:
            out[isin] = d
        nm = re.sub(r"\s+", " ", x.get("emitent") or "").strip()
        if nm:
            names[isin] = nm
    if len(out) < 20 or len(names) < 300:     # лента пришла пустой/обрезанной — старое не затираем
        log.warning("dohod: коллов %d, названий %d — оставляю прежние", len(out), len(names))
        return 0
    _CALLS.update(day=today, by_isin=out, names=names)
    _save(_CALLS_FILE, {"day": today, "by_isin": out, "names": names})
    log.warning("dohod: коллы %d, названия эмитентов %d", len(out), len(names))
    return len(out)
