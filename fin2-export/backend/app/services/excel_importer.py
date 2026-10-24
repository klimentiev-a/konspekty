"""
Excel portfolio importer.

Step 1 of the project plan: read the workbook, describe what we found (sheets,
columns, types), map columns to our position fields by fuzzy header matching,
normalize ISINs and report exactly which fields are missing for the analytics
(YTM, duration, P/L, accrued income) so nothing is silently guessed.
"""
from __future__ import annotations

import re
from typing import Any

import pandas as pd

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}\d$")

# Fuzzy header synonyms -> our canonical field.
# Order matters: more specific fields first so e.g. "Текущая цена" beats "цена".
HEADER_MAP = {
    "isin": ["isin", "исин", "secid"],
    "excel_price": ["текущая цена", "цена moex", "current price", "рыночная цена", "market price"],
    "buy_price": ["цена покупки", "покупка", "buy price", "purchase price"],
    "buy_accint": ["накопл", "нкд", "accint", "accrued"],
    "buy_date": ["дата покупки", "purchase date", "куплено", "дата"],
    "name": ["наименование", "название", "бумага", "эмитент", "issuer", "shortname", "name"],
    "quantity": ["количество", "кол-во", "qty", "quantity", "штук", "номиналов"],
    "sector": ["sector", "сектор", "отрасль", "industry"],
    "rating": ["rating", "рейтинг"],
    "currency": ["currency", "валюта", "ccy"],
}

REQUIRED_FOR_ANALYTICS = {
    "isin": "сопоставление с MOEX, котировки, история",
    "quantity": "рыночная стоимость, P/L, денежные потоки",
    "buy_date": "цена покупки берётся из истории MOEX на эту дату",
}
# Everything below is pulled automatically — the user only provides ISIN, qty, date.
DERIVED_FROM_MOEX = [
    "цена покупки (история на дату сделки)", "текущая цена", "НКД",
    "ytm", "duration", "matdate (погашение)",
]
DERIVED_FROM_CASHFLOW = ["полный график купонов (bondization)", "амортизации", "оферты"]


MAX_UNZIPPED = 150 * 1024 * 1024     # xlsx — это zip: не больше 150 МБ после распаковки (zip-бомба)
MAX_SHEETS = 30
MAX_ROWS = 20000                      # позиций в портфеле / строк рейтингов — с большим запасом


def check_workbook(path: str) -> None:
    """Проверка ДО разбора pandas/openpyxl: размер распаковки xlsx и число листов;
    строки ограничиваются при чтении (nrows). Нарушение → ValueError с понятным текстом."""
    import zipfile
    if str(path).lower().endswith(".xlsx"):
        try:
            with zipfile.ZipFile(path) as z:
                total = sum(i.file_size for i in z.infolist())
                sheets = sum(1 for i in z.infolist() if i.filename.startswith("xl/worksheets/sheet"))
        except zipfile.BadZipFile:
            raise ValueError("Файл повреждён или это не .xlsx")
        if total > MAX_UNZIPPED:
            raise ValueError("Слишком большой файл Excel после распаковки")
        if sheets > MAX_SHEETS:
            raise ValueError(f"Слишком много листов (больше {MAX_SHEETS})")


def describe_workbook(path: str) -> dict:
    """Return a structural description of every sheet without importing."""
    check_workbook(path)
    xls = pd.ExcelFile(path)
    sheets = []
    for name in xls.sheet_names:
        df = xls.parse(name, nrows=50)
        cols = []
        for c in df.columns:
            series = df[c].dropna()
            cols.append({
                "name": str(c),
                "dtype": str(df[c].dtype),
                "sample": [str(v) for v in series.head(3).tolist()],
                "mapped_to": _match_header(str(c)),
            })
        sheets.append({"sheet": name, "rows_preview": int(len(df)), "columns": cols})
    return {"file": path, "sheets": sheets}


def _match_header(header: str) -> str | None:
    h = header.strip().lower()
    for field, syns in HEADER_MAP.items():
        if any(s in h for s in syns):
            return field
    return None


def _pick_data_sheet(xls: pd.ExcelFile) -> str:
    """Choose the sheet that looks most like a positions table (has an ISIN column)."""
    best, best_score = xls.sheet_names[0], -1
    for name in xls.sheet_names:
        df = xls.parse(name, nrows=30)
        score = sum(1 for c in df.columns if _match_header(str(c)))
        # bonus if any cell looks like an ISIN
        if df.astype(str).apply(lambda s: s.str.match(ISIN_RE.pattern)).any().any():
            score += 5
        if score > best_score:
            best, best_score = name, score
    return best


def import_portfolio(path: str) -> dict:
    """Parse the workbook into normalized positions + a data-quality report."""
    check_workbook(path)
    xls = pd.ExcelFile(path)
    sheet = _pick_data_sheet(xls)
    df = xls.parse(sheet, nrows=MAX_ROWS + 1)
    if len(df) > MAX_ROWS:
        raise ValueError(f"Слишком много строк (больше {MAX_ROWS})")

    # Build column -> field mapping.
    mapping: dict[str, str] = {}
    for c in df.columns:
        field = _match_header(str(c))
        if field and field not in mapping.values():
            mapping[c] = field

    positions: list[dict] = []
    unresolved_isin: list[str] = []
    for _, row in df.iterrows():
        rec: dict[str, Any] = {}
        for col, field in mapping.items():
            rec[field] = row[col]
        isin = _normalize_isin(rec.get("isin"))
        if not isin:
            continue
        if not ISIN_RE.match(isin):
            unresolved_isin.append(isin)
        positions.append({
            "isin": isin,
            "name": _clean_str(rec.get("name")),
            "quantity": _num(rec.get("quantity")),
            "buy_price": _num(rec.get("buy_price")),
            "buy_accint": _num(rec.get("buy_accint")),
            "buy_date": _clean_str(rec.get("buy_date")),
            "sector": _clean_str(rec.get("sector")),
            "rating": _clean_str(rec.get("rating")),
            "currency": _clean_str(rec.get("currency")) or "RUB",
            "excel_price": _num(rec.get("excel_price")),
        })

    present = set(mapping.values())
    missing = {f: why for f, why in REQUIRED_FOR_ANALYTICS.items() if f not in present}

    return {
        "sheet": sheet,
        "positions": positions,
        "count": len(positions),
        "mapped_columns": {str(k): v for k, v in mapping.items()},
        "missing_required": missing,
        "needs_from_moex": DERIVED_FROM_MOEX,
        "needs_from_cashflow": DERIVED_FROM_CASHFLOW,
        "isin_malformed": unresolved_isin,
    }


def _normalize_isin(v: Any) -> str | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip().upper().replace(" ", "")
    return s or None


def _clean_str(v: Any) -> str | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip()
    return s or None


def _num(v: Any) -> float | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(" ", "").replace(" ", "").replace(",", ".").replace("%", "")
    try:
        return float(s)
    except ValueError:
        return None
