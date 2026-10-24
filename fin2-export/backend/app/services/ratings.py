"""
Credit ratings + sectors provider.

MOEX ISS exposes neither credit ratings nor clean industry sectors, so this
layer sources them separately and caches them in `bond_ratings` (keyed by ISIN),
refreshed on a slow cadence (daily) — independent of the fast market snapshot.

Providers, in order of reliability:
  1. moex_ref.rebuild() — основной: только Мосбиржа и ФНС (dohod.ru не используется).
  2. import_csv() / import_cbonds() — ручная загрузка выгрузки (колонки сопоставляются).

The durable, testable core is the rating→bucket normalization and the DB upsert;
the scraper is a thin adapter on top.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from ..db import BondRating

log = logging.getLogger("ratings")

# Ordered best→worst; score is used for sorting/among-rating comparison.
_BUCKETS = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC", "CC", "C", "D"]
_BUCKET_SCORE = {b: len(_BUCKETS) - i for i, b in enumerate(_BUCKETS)}
_NOTCH = {"+": 0.33, "-": -0.33, "": 0.0}


_HOMOGLYPHS = str.maketrans({"А": "A", "В": "B", "С": "C", "Е": "E", "Н": "H",
                             "К": "K", "М": "M", "О": "O", "Р": "P", "Т": "T", "Х": "X"})


def normalize_rating(raw: Optional[str]) -> tuple[Optional[str], Optional[float]]:
    """Map any Russian-national or international rating string to a coarse bucket
    and a numeric score. Handles ruAAA, AAA(RU), AA+.ru, BBB-, A(RU), etc.

    Returns (bucket, score) or (None, None) if unparseable / NR."""
    if not raw:
        return None, None
    s = str(raw).strip().upper()
    if not s or s in ("NR", "—", "-", "N/A", "БЕЗ РЕЙТИНГА", "WD"):
        return None, None
    # Fix Cyrillic homoglyphs (А/В/С/Е… look identical to A/B/C/E) so "АА+(RU)"
    # parses like "AA+" instead of falling through to no-bucket.
    s = s.translate(_HOMOGLYPHS)
    # strip agency scale markers: ru-prefix, (RU)/(AAA.RU)/.RU suffixes, spaces
    s = re.sub(r"\(.*?\)", "", s)          # drop "(RU)", "(EXP.RU)"
    s = s.replace(".RU", "").replace("RU", "") if s.startswith("RU") or ".RU" in s else s
    s = s.strip()
    m = re.match(r"^(A{1,3}|B{1,3}|C{1,3}|D)\s*([+\-]?)", s)
    if not m:
        return None, None
    letters, notch = m.group(1), m.group(2)
    # collapse to a defined bucket (AAA, AA, A, BBB, BB, B, CCC, CC, C, D)
    bucket = _closest_bucket(letters)
    if bucket is None:
        return None, None
    score = _BUCKET_SCORE[bucket] + _NOTCH.get(notch, 0.0)
    return bucket, round(score, 2)


def _closest_bucket(letters: str) -> Optional[str]:
    if letters in _BUCKET_SCORE:
        return letters
    # e.g. "BB" already a bucket; "BBBB" → clamp; single/double letters map directly
    if letters and letters[0] == "A":
        return {1: "A", 2: "AA", 3: "AAA"}.get(len(letters))
    if letters and letters[0] == "B":
        return {1: "B", 2: "BB", 3: "BBB"}.get(min(len(letters), 3))
    if letters and letters[0] == "C":
        return {1: "C", 2: "CC", 3: "CCC"}.get(min(len(letters), 3))
    if letters.startswith("D"):
        return "D"
    return None


# --------------------------------------------------------------------------- #
# Core upsert
# --------------------------------------------------------------------------- #
def import_rows(db: Session, rows: Iterable[dict]) -> dict:
    """Upsert rating rows. Each row: {isin, rating?, sector?, issuer?, agency?}."""
    now = datetime.utcnow()
    n = 0
    for r in rows:
        isin = (r.get("isin") or "").strip().upper()
        if not isin or not re.match(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$", isin):
            continue
        bucket, score = normalize_rating(r.get("rating"))
        rec = db.get(BondRating, isin) or BondRating(isin=isin)
        rec.issuer = _clean(r.get("issuer")) or rec.issuer
        rec.sector = _clean(r.get("sector")) or rec.sector
        if r.get("rating"):
            rec.rating = _clean(r.get("rating"))
            rec.rating_bucket = bucket
            rec.rating_score = score
        rec.agency = _clean(r.get("agency")) or rec.agency
        if "is_floater" in r:
            rec.is_floater = bool(r.get("is_floater"))
            rec.float_index = _clean(r.get("float_index"))
        for fld, src in (("current_coupon", "current_coupon"), ("float_add", "float_add")):
            if r.get(src) is not None:
                try:
                    setattr(rec, fld, float(r[src]))
                except (TypeError, ValueError):
                    pass
        if "effective_date" in r:
            rec.effective_date = _clean(r.get("effective_date"))
            rec.event_flag = _clean(r.get("event_flag"))
        if r.get("issue_date"):
            rec.issue_date = _clean(r.get("issue_date"))
        rec.source = r.get("source") or rec.source or "import"
        rec.updated_at = now
        db.add(rec)
        n += 1
    db.commit()
    return {"imported": n, "at": now.isoformat()}


def _clean(v) -> Optional[str]:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


# --------------------------------------------------------------------------- #
# CSV / Excel import (recommended, fully offline-testable)
# --------------------------------------------------------------------------- #
# Fuzzy header → canonical field. First match wins.
_HEADER_MAP = {
    "isin": ["isin"],
    "rating": ["кредитное качество", "рейтинг", "rating", "credit"],
    "sector": ["отрасль", "сектор", "industry", "sector"],
    "issuer": ["эмитент", "issuer", "название", "наименование", "name", "бумага"],
    "agency": ["агентство", "agency"],
}


def _map_columns(columns: list[str]) -> dict[str, str]:
    """Map dataframe columns to canonical fields by fuzzy header match."""
    resolved: dict[str, str] = {}
    lower = {c: str(c).strip().lower() for c in columns}
    for field, needles in _HEADER_MAP.items():
        for col, low in lower.items():
            if any(n in low for n in needles):
                resolved[field] = col
                break
    return resolved


def import_cbonds(db: Session, paths) -> dict:
    """Import a Cbonds bond-search export (xlsx): industry (Отрасль), rate type
    (Тип ставки → fix/float) and put date (Оферта), matched to bonds by ISIN.
    Cbonds' industry classification is cleaner than dohod's codes, so it takes
    precedence for the sector; fix/float here is authoritative for the snapshot."""
    import pandas as pd
    if isinstance(paths, str):
        paths = [paths]
    frames = []
    for p in paths:
        frames.append(pd.read_excel(p))
    df = pd.concat(frames, ignore_index=True).drop_duplicates("ISIN")
    now = datetime.utcnow()
    n = 0
    for _, row in df.iterrows():
        isin = str(row.get("ISIN") or "").strip().upper()
        if not isin or not re.match(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$", isin):
            continue
        rec = db.get(BondRating, isin) or BondRating(isin=isin)
        sec_raw = row.get("Отрасль")
        sector = _clean(sec_raw) if not pd.isna(sec_raw) else None
        if sector and sector.lower() != "nan":
            rec.sector = sector
        rtype = str(row.get("Тип ставки") or "")
        if rtype:
            rec.is_floater = "плава" in rtype.lower()
        offer = row.get("Оферта (put)")
        if offer is not None and not pd.isna(offer):
            try:
                rec.effective_date = pd.Timestamp(offer).strftime("%Y-%m-%d")
                rec.event_flag = rec.event_flag or "PUT"
            except (ValueError, TypeError):
                pass
        if not rec.issuer:
            rec.issuer = _clean(row.get("Бумага"))
        rec.source = (rec.source or "") + "+cbonds" if rec.source and "cbonds" not in (rec.source or "") else (rec.source or "cbonds")
        rec.updated_at = now
        db.add(rec)
        n += 1
    db.commit()
    return {"imported": n, "rows": len(df), "at": now.isoformat()}


def import_csv(db: Session, path: str) -> dict:
    """Import a CSV/Excel export with fuzzy column mapping."""
    import pandas as pd
    from .excel_importer import MAX_ROWS, check_workbook
    check_workbook(path)
    df = (pd.read_excel(path, nrows=MAX_ROWS) if path.lower().endswith((".xlsx", ".xls"))
          else pd.read_csv(path, sep=None, engine="python", nrows=MAX_ROWS))
    cols = _map_columns(list(df.columns))
    if "isin" not in cols:
        raise ValueError(f"No ISIN column found. Columns: {list(df.columns)}")
    rows = [{field: row[src] for field, src in cols.items()} for _, row in df.iterrows()]
    for r in rows:
        r["source"] = "import"
    return import_rows(db, rows)


# --- canonical sector taxonomy ---------------------------------------------
# Two source vocabularies (dohod INDUSTRY_RU + Cbonds Отрасль) are collapsed to
# ~20 canonical sectors by ordered keyword rules (first match wins).
_CANON_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("Госбумаги и регионы", ("госбумаг", "субфедеральн", "орган власти", "институт развития",
                             "государственн", "госкомпан")),
    ("Банки", ("банк", "кредитная организ")),
    ("Лизинг", ("лизинг",)),
    ("Микрофинансы", ("микрофинанс",)),
    ("Финансы (прочее)", ("финанс", "финансов")),
    ("Нефтегаз", ("нефтегаз", "нефти и газа", "трубопровод")),
    ("Металлургия", ("металлург", "металл")),
    ("Добыча", ("добыч",)),
    ("Электроэнергетика и ЖКХ", ("электроэнерг", "снабжение вод", "тепл", "утилизац", "отход")),
    ("Девелопмент и недвижимость", ("девелопмент", "недвижим", "строительств", "стройматериал",
                                    "строительных материал")),
    ("Ритейл и торговля", ("ретейл", "ритейл", "торговл", "одежд", "товары", "гигиен")),
    ("Транспорт и логистика", ("транспорт", "перевозк", "логистик", "почтов", "курьер")),
    ("Связь, ИТ и телеком", ("связь", "телеком", "ит серв", "технолог", "компьютер", "программн")),
    ("Химия", ("химическ", "удобрен", "химия")),
    ("Машиностроение и ОПК", ("машиностроен", "автотранспорт", "автопром", "летательн",
                              "вооружени", "опк", "приборостроен")),
    ("АПК и пищепром", ("апк", "сельск", "продукт", "напитк", "питани", "потреб")),
    ("Фарма и медицина", ("фарма", "лекарств", "биотехнолог", "медицин")),
    ("Холдинги", ("холдинг",)),
    ("ЦБП и упаковка", ("целлюлоз", "деревообраб", "тара", "упаковк")),
    ("Услуги и досуг", ("гостиниц", "отел", "развлеч", "досуг", "услуг")),
]


def canon_sector(s: Optional[str]) -> Optional[str]:
    """Map a raw sector string to a canonical sector. Unknown → 'Прочее'."""
    if not s:
        return None
    low = s.lower()
    for canon, kws in _CANON_RULES:
        if any(k in low for k in kws):
            return canon
    return "Прочее"


def refresh(db: Session, source: str = "csv", **kw) -> dict:
    # dohod.ru больше не используется: справочник собирает moex_ref.rebuild (биржа + ФНС)
    if source == "csv":
        return import_csv(db, kw["path"])
    raise ValueError(f"unknown ratings source: {source}")


# --- sector harmonization -------------------------------------------------
#
# Sectors arrive per-ISIN from mixed sources (dohod INDUSTRY_RU + Cbonds
# Отрасль), so the SAME issuer can end up with different sectors across its
# bonds — e.g. dohod mis-tags two Магнит issues as "Недвижимость" while the
# rest are "FMCG ретейл". A bond's sector is really a property of its ISSUER,
# not the individual issue, so we collapse each issuer to a single sector: the
# most frequent non-null one across all of that issuer's bonds.

_SERIES_RE = re.compile(
    r"[,(]|\b(?:\d{3}[A-Za-zА-Яа-я]|\d[PР]\d|[БП]\d|БО|б\.о\.|\d+Р-|выпуск|сер\.)", re.IGNORECASE
)


def issuer_key(name: Optional[str]) -> str:
    """Collapse an issuer/bond name to a stable per-issuer key by stripping the
    bond-series suffix ("Магнит, БО-004Р-08" -> "магнит") and legal forms."""
    if not name:
        return ""
    from .agencies import normalize_name
    low = name.strip().lower()
    # Суверенные выпуски несут серию/дату прямо в названии («ОФЗ-ПД 26207 03/02/27»),
    # из-за чего issuer_key давал УНИКАЛЬНЫЙ ключ на каждую бумагу и «того же эмитента»
    # пустело. Схлопываем все ОФЗ (и суверенные ЗО) в одного эмитента — Минфин РФ.
    if low.startswith("офз"):
        return "минфин рф офз"
    if "овоз" in low or low.startswith("рф зо") or low.startswith("рф-зо"):
        return "минфин рф зо"
    base = _SERIES_RE.split(name, 1)[0]
    return normalize_name(base) or normalize_name(name)


def harmonize_sectors(db: Session) -> dict:
    """Assign every bond of an issuer the issuer's modal (most common) sector,
    overriding stray per-ISIN misclassifications. Returns a small summary."""
    from collections import Counter
    rows = db.query(BondRating).all()
    groups: dict[str, list] = {}
    for r in rows:
        groups.setdefault(issuer_key(r.issuer), []).append(r)

    changed = 0
    for key, grp in groups.items():
        if not key:
            continue
        votes = Counter(r.sector for r in grp if r.sector)
        if not votes:
            continue
        modal = votes.most_common(1)[0][0]
        for r in grp:
            if r.sector != modal:
                r.sector = modal
                changed += 1
    db.commit()
    return {"issuers": len(groups), "sectors_fixed": changed}
