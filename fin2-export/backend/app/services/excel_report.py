"""Styled Excel export of the portfolio (openpyxl): summary, positions with ISIN,
and a month-by-month cash-flow sheet (coupons + nominal). Cells are sanitised
against formula injection (a leading =,+,-,@ is prefixed with a quote)."""
from __future__ import annotations

import io
from datetime import datetime

from openpyxl import Workbook
from openpyxl.chart import BarChart, DoughnutChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.formatting.rule import DataBarRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# palette
ACCENT = "16A34A"       # header green
DARK = "0F3D2E"         # title band
BAND = "EAF6F0"         # zebra row
LINE = "D7E3DC"
TILE = "0F3D2E"         # KPI tile background (dark green)
TILE_ALT = "16A34A"     # KPI tile accent
INK = "0B3B2A"
# donut segment colours (reused across charts)
_SEG = ["16A34A", "35D6E6", "8B7BFF", "F5B13C", "FF6B6B", "2FE08A", "7DDC5B", "E7D84A", "5C6F69"]

_MONEY = '#,##0 ₽'
_PCT = '0.00"%"'
_NUM2 = '0.00'
_thin = Side(style="thin", color=LINE)
_BORDER = Border(left=_thin, right=_thin, top=_thin, bottom=_thin)

_KIND_RU = {"fixed": "Фикс", "fix": "Фикс", "floater": "Флоатер",
            "share": "Акция", "fund": "Фонд", "other": "Инструмент"}


def _safe(v):
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@"):
        return "'" + v
    return v


def _dmy(s):
    """ISO YYYY-MM-DD → ДД.ММ.ГГГГ (для листов выгрузки)."""
    if isinstance(s, str) and len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return f"{s[8:10]}.{s[5:7]}.{s[0:4]}"
    return s


def _mmy(s):
    """ISO YYYY-MM → ММ.ГГГГ."""
    if isinstance(s, str) and len(s) >= 7 and s[4] == "-":
        return f"{s[5:7]}.{s[0:4]}"
    return s


def _header(ws, headers, row=1):
    fill = PatternFill("solid", fgColor=ACCENT)
    for j, h in enumerate(headers, 1):
        c = ws.cell(row=row, column=j, value=h)
        c.font = Font(bold=True, color="FFFFFF", size=11)
        c.fill = fill
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = _BORDER
    ws.row_dimensions[row].height = 26


def _widths(ws, widths):
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def build_workbook(d: dict, events: list[dict] | None = None) -> bytes:
    wb = Workbook()
    pf = d.get("portfolio", {})
    s = d.get("summary", {})
    dq = d.get("data_quality", {})

    # ── Сводка (дашборд) ────────────────────────────────────────────────────
    st = d.get("structure") or {}
    positions = d.get("positions", [])
    meta = wb.active
    meta.title = "Сводка"
    _widths(meta, [22, 12, 3, 22, 12, 3, 22, 12, 3, 22, 12])
    meta.sheet_view.showGridLines = False

    # заголовочная плашка
    meta.merge_cells("A1:K1")
    t = meta["A1"]
    t.value = f"ПОРТФЕЛЬ  ·  {pf.get('name') or '—'}"
    t.font = Font(bold=True, size=18, color="FFFFFF")
    t.fill = PatternFill("solid", fgColor=DARK)
    t.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    meta.row_dimensions[1].height = 40
    meta.merge_cells("A2:K2")
    sub = meta["A2"]
    sub.value = (f"Сформирован {datetime.utcnow():%Y-%m-%d %H:%M} UTC   ·   Источник: MOEX ISS   ·   "
                 f"Качество данных {dq.get('score', '—')}/100   ·   Информационный материал, не инвестиционная рекомендация")
    sub.font = Font(size=9, italic=True, color="5B7A6C")
    sub.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    meta.row_dimensions[2].height = 18

    # ── KPI-плитки (2 ряда по 4) ──────────────────────────────────────────
    def _tile(r, c, label, value, fmt=None, accent=False):
        cl = get_column_letter(c); cr = get_column_letter(c + 1)
        bg = TILE_ALT if accent else TILE
        meta.merge_cells(f"{cl}{r}:{cr}{r}")
        lab = meta.cell(row=r, column=c, value=label)
        lab.font = Font(bold=True, size=9, color="B9E9D2")
        lab.fill = PatternFill("solid", fgColor=bg)
        lab.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        meta.merge_cells(f"{cl}{r + 1}:{cr}{r + 2}")
        val = meta.cell(row=r + 1, column=c, value=_safe(value))
        val.font = Font(bold=True, size=17, color="FFFFFF")
        val.fill = PatternFill("solid", fgColor=bg)
        val.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        if fmt and isinstance(value, (int, float)):
            val.number_format = fmt
        for rr in (r, r + 1, r + 2):
            meta.cell(row=rr, column=c).fill = PatternFill("solid", fgColor=bg)
            meta.cell(row=rr, column=c + 1).fill = PatternFill("solid", fgColor=bg)
        meta.row_dimensions[r].height = 16
        meta.row_dimensions[r + 1].height = 15
        meta.row_dimensions[r + 2].height = 13

    _tile(4, 1, "РЫНОЧНАЯ СТОИМОСТЬ", s.get("market_value"), _MONEY, accent=True)
    _tile(4, 4, "YTM (ОБЛИГАЦИИ)", s.get("ytm"), _PCT)
    _tile(4, 7, "ТЕК. ДОХОДНОСТЬ", s.get("current_yield"), _PCT)
    _tile(4, 10, "ДЮРАЦИЯ, ЛЕТ", s.get("duration_years"), _NUM2)
    _tile(8, 1, "ВЛОЖЕНО", s.get("invested"), _MONEY)
    _tile(8, 4, "P/L (С КУПОНАМИ)", s.get("pl"), _MONEY, accent=True)
    _tile(8, 7, "ПОЗИЦИЙ", s.get("positions"))
    _tile(8, 10, "ВЫПУСКОВ ОБЛИГАЦИЙ", len({r.get("isin") for r in positions if r.get("is_bond") is not False}))

    # ── аллокация по классам активов и по типу инструмента (из позиций) ────
    _RUB = {"RUB", "SUR", "RUR", None, ""}
    alloc: dict[str, float] = {}
    instr: dict[str, float] = {}
    for r in positions:
        mv = r.get("market_value") or 0.0
        if not mv:
            continue
        if r.get("is_bond") is False:
            k = "Фонды" if r.get("kind") == "fund" else "Акции"
            alloc[k] = alloc.get(k, 0) + mv
            continue
        alloc["Облигации"] = alloc.get("Облигации", 0) + mv
        ccy = (r.get("currency") or "RUB").upper()
        nm = (r.get("name") or "").upper()
        if ccy not in _RUB:
            key = "Валютные"
        elif nm.startswith("ОФЗ") or nm.startswith("РФ ") or nm.startswith("ГОСОБЛ"):
            key = "ОФЗ"
        elif r.get("is_float"):
            key = "Корп. флоатеры"
        else:
            key = "Корп. фикс"
        instr[key] = instr.get(key, 0) + mv

    def _slices(dct):
        tot = sum(dct.values()) or 1.0
        return [{"name": k, "value": round(v), "share": round(100 * v / tot, 1)}
                for k, v in sorted(dct.items(), key=lambda x: -x[1])]

    # ── блок таблиц + пончиков ────────────────────────────────────────────
    def _block(top, col, title, items, as_money=False):
        """Мини-таблица с data-bar по доле; возвращает диапазоны для диаграммы."""
        cl = get_column_letter(col); clv = get_column_letter(col + 1)
        h = meta.cell(row=top, column=col, value=title)
        h.font = Font(bold=True, color="FFFFFF", size=10)
        h.fill = PatternFill("solid", fgColor=ACCENT)
        h.alignment = Alignment(horizontal="left", indent=1)
        hv = meta.cell(row=top, column=col + 1, value="Доля")
        hv.font = Font(bold=True, color="FFFFFF", size=10)
        hv.fill = PatternFill("solid", fgColor=ACCENT)
        hv.alignment = Alignment(horizontal="center")
        n = 0
        for j, it in enumerate(items or [], 1):
            rr = top + j
            nm = meta.cell(row=rr, column=col, value=_safe(it.get("name")))
            nm.font = Font(size=10)
            pc = meta.cell(row=rr, column=col + 1, value=(it.get("share") or 0) / 100.0)
            pc.number_format = '0.0%'
            pc.font = Font(size=10)
            if j % 2 == 0:
                for cc in (col, col + 1):
                    meta.cell(row=rr, column=cc).fill = PatternFill("solid", fgColor=BAND)
            n = j
        if n:
            rule = DataBarRule(start_type="num", start_value=0, end_type="num", end_value=1,
                               color=ACCENT, showValue=True)
            meta.conditional_formatting.add(f"{clv}{top + 1}:{clv}{top + n}", rule)
        return n

    rating = st.get("by_rating") or []
    maturity = st.get("by_maturity") or []
    alloc_s = _slices(alloc)
    instr_s = _slices(instr)

    sec_top = 13
    meta.merge_cells(f"A{sec_top}:K{sec_top}")
    sh = meta.cell(row=sec_top, column=1, value="СТРУКТУРА ПОРТФЕЛЯ")
    sh.font = Font(bold=True, size=12, color=INK)
    sec_top += 1
    n_al = _block(sec_top, 1, "Аллокация активов", alloc_s)
    n_in = _block(sec_top, 4, "По типу инструмента", instr_s)
    n_rt = _block(sec_top, 7, "По рейтингу", rating)
    n_mt = _block(sec_top, 10, "По сроку до погашения", maturity)

    # ── пончики: аллокация и тип инструмента ──────────────────────────────
    def _donut(anchor, title, top, col, n):
        if not n:
            return
        ch = DoughnutChart()
        ch.title = title
        ch.holeSize = 58
        ch.height = 8.4; ch.width = 12.5
        data = Reference(meta, min_col=col + 1, min_row=top, max_row=top + n)   # incl header
        cats = Reference(meta, min_col=col, min_row=top + 1, max_row=top + n)
        ch.add_data(data, titles_from_data=True)
        ch.set_categories(cats)
        pts = ch.series[0]
        from openpyxl.chart.series import DataPoint
        for idx in range(n):
            dp = DataPoint(idx=idx)
            dp.graphicalProperties.solidFill = _SEG[idx % len(_SEG)]
            pts.data_points.append(dp)
        pts.dLbls = DataLabelList(); pts.dLbls.showPercent = True; pts.dLbls.showVal = False
        meta.add_chart(ch, anchor)

    # два крупных пончика без наложения (рейтинг/срок остаются data-bar таблицами)
    chart_row = sec_top + max(n_al, n_in, n_rt, n_mt) + 2
    _donut(f"A{chart_row}", "Аллокация активов", sec_top, 1, n_al)
    _donut(f"G{chart_row}", "По типу инструмента", sec_top, 4, n_in)

    # ── Позиции ─────────────────────────────────────────────────────────────
    pos = wb.create_sheet("Позиции")
    cols = ["Выпуск", "ISIN", "Тип", "Сектор", "Рейтинг", "Валюта", "Кол-во",
            "Цена", "Ед. цены", "YTM, %", "Дюрация", "Стоимость, ₽", "P/L, ₽", "P/L, %"]
    _header(pos, cols)
    for i, r in enumerate(d.get("positions", [])):
        is_bond = r.get("is_bond") is not False
        vals = [r.get("name"), r.get("isin"), _KIND_RU.get(r.get("kind"), r.get("kind")),
                r.get("sector"), r.get("rating"), r.get("currency"), r.get("quantity"),
                r.get("price_used"), ("% ном." if is_bond else "₽"),
                (r.get("ytm") if is_bond else None), (r.get("duration_years") if is_bond else None),
                r.get("market_value"), r.get("pl"), r.get("pl_pct")]
        pos.append([_safe(x) for x in vals])
        rr = pos.max_row
        fmts = {8: (_NUM2 if is_bond else _MONEY), 10: _PCT, 11: _NUM2, 12: _MONEY, 13: _MONEY, 14: _PCT}
        for col, fmt in fmts.items():
            pos.cell(row=rr, column=col).number_format = fmt
        if i % 2:                                   # zebra
            fill = PatternFill("solid", fgColor=BAND)
            for col in range(1, len(cols) + 1):
                pos.cell(row=rr, column=col).fill = fill
    _widths(pos, [26, 15, 11, 20, 10, 9, 10, 12, 9, 10, 10, 15, 14, 9])
    pos.freeze_panes = "A2"
    pos.auto_filter.ref = f"A1:{get_column_letter(len(cols))}{pos.max_row}"

    # ── Купоны и погашения — на 1 бумагу; сумма = кол-во × на 1 шт (формулой) ──
    events = events or []
    ev = wb.create_sheet("Купоны и погашения")
    _header(ev, ["Дата", "Месяц", "Выпуск", "ISIN", "Тип", "Кол-во", "На 1 шт, ₽", "Сумма, ₽"])
    for i, e in enumerate(events):
        dt = e.get("date") or ""
        r = ev.max_row + 1
        ev.append([_dmy(dt), _mmy(dt[:7]), _safe(e.get("name")), e.get("isin"), e.get("type"),
                   e.get("qty"), e.get("per_unit"), f"=F{r}*G{r}"])   # сумма = кол-во × на 1 шт
        ev.cell(row=r, column=7).number_format = _NUM2
        ev.cell(row=r, column=8).number_format = _MONEY
        if i % 2:
            fill = PatternFill("solid", fgColor=BAND)
            for col in range(1, 9):
                ev.cell(row=r, column=col).fill = fill
    last_e = ev.max_row
    ev.append(["ИТОГО", "", "", "", "", "", "", f"=SUM(H2:H{last_e})" if last_e >= 2 else 0])
    for col in range(1, 9):
        c = ev.cell(row=ev.max_row, column=col)
        c.font = Font(bold=True); c.fill = PatternFill("solid", fgColor="D1EAD9")
        if col == 8:
            c.number_format = _MONEY
    _widths(ev, [12, 10, 28, 16, 14, 10, 12, 16])
    ev.freeze_panes = "A2"
    ev.auto_filter.ref = f"A1:H{last_e}"

    # ── Денежный поток по месяцам — SUMIFS по столбцу «Сумма» (кол-во × на 1 шт)
    cf = wb.create_sheet("Денежный поток")
    _header(cf, ["Месяц", "Купоны, ₽", "Номинал (погашение/аморт.), ₽", "Итого, ₽"])
    months = sorted({(e.get("date") or "")[:7] for e in events if e.get("date")})
    SH = "'Купоны и погашения'"
    rng = f"{SH}!$B$2:$B${last_e}"; sums = f"{SH}!$H$2:$H${last_e}"; types = f"{SH}!$E$2:$E${last_e}"
    for i, m in enumerate(months):
        r = cf.max_row + 1
        cf.append([_mmy(m),
                   f'=SUMIFS({sums},{rng},A{r},{types},"Купон")',
                   f'=SUMIFS({sums},{rng},A{r})-B{r}',
                   f'=SUMIFS({sums},{rng},A{r})'])
        for col in (2, 3, 4):
            cf.cell(row=r, column=col).number_format = _MONEY
        if i % 2:
            fill = PatternFill("solid", fgColor=BAND)
            for col in range(1, 5):
                cf.cell(row=r, column=col).fill = fill
    last = cf.max_row
    cf.append(["ИТОГО", f"=SUM(B2:B{last})", f"=SUM(C2:C{last})", f"=SUM(D2:D{last})"])
    for col in range(1, 5):
        cell = cf.cell(row=cf.max_row, column=col)
        cell.font = Font(bold=True); cell.fill = PatternFill("solid", fgColor="D1EAD9")
        if col > 1:
            cell.number_format = _MONEY
    _widths(cf, [12, 16, 30, 16])
    cf.freeze_panes = "A2"

    # красивый столбчатый график (купоны + номинал по месяцам)
    if last >= 2:
        chart = BarChart()
        chart.type = "col"; chart.grouping = "stacked"; chart.overlap = 100
        chart.gapWidth = 40
        chart.title = "Денежный поток по месяцам, ₽"
        chart.height = 10; chart.width = 30
        chart.style = 2
        data = Reference(cf, min_col=2, max_col=3, min_row=1, max_row=last)
        cats = Reference(cf, min_col=1, min_row=2, max_row=last)
        chart.add_data(data, titles_from_data=True)
        chart.set_categories(cats)
        chart.series[0].graphicalProperties.solidFill = "35D6E6"   # купоны — бирюза
        chart.series[1].graphicalProperties.solidFill = "F5B13C"   # номинал — янтарь
        for sr in chart.series:
            sr.graphicalProperties.line.noFill = True
        chart.y_axis.numFmt = '#,##0'
        chart.y_axis.majorGridlines = None
        chart.x_axis.delete = False; chart.y_axis.delete = False
        chart.legend.position = "b"
        cf.add_chart(chart, "F2")

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
