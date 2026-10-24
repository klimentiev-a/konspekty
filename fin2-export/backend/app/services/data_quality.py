"""Portfolio data-quality checks: per-position sanity ranges and cross-field
consistency, plus a coverage summary. Flags bad/stale MOEX rows so the analytics
don't silently present garbage. Adapted from the mature BondDash quality engine."""
from __future__ import annotations

import hashlib
from datetime import date, datetime


def _key(isin: str, field: str, text: str) -> str:
    return hashlib.sha256(f"{isin}|{field}|{text}".encode()).hexdigest()[:16]


def position_issues(rows: list[dict]) -> dict:
    """Return {issues:[...], coverage:{...}, score} for a list of dashboard rows."""
    issues: list[dict] = []
    today = date.today()
    n = len(rows) or 1
    nb = sum(1 for r in rows if r.get("is_bond") is not False) or 1   # облигаций (для покрытия YTM/дюрации/рейтинга/погашения)
    have_price = have_ytm = have_dur = have_rating = have_mat = 0

    def add(r, level, field, text, blocked=False):
        issues.append({"isin": r.get("isin"), "name": r.get("name"), "level": level,
                       "field": field, "text": text, "blocked": blocked,
                       "key": _key(r.get("isin", ""), field, text)})

    for r in rows:
        name = r.get("name") or r.get("isin")
        is_bond = r.get("is_bond") is not False      # акции/фонды не проверяем по «облигационным» правилам
        p = r.get("price_used")
        ytm = r.get("ytm")
        dur = r.get("duration_years")
        mat = r.get("matdate")

        # цена: наличие проверяем у всех, «% номинала 0–1000» — только у облигаций
        if p is not None:
            have_price += 1
            if is_bond and not (0 < p < 1000):
                add(r, "error", "price", f"{name}: цена {p} вне диапазона 0–1000% номинала", True)
            elif not is_bond and p <= 0:
                add(r, "warn", "price", f"{name}: неположительная цена")
        if r.get("price_source") == "none":
            add(r, "error", "price", f"{name}: нет цены на MOEX", True)
        if r.get("price_stale"):
            add(r, "warn", "price", f"{name}: котировка не обновлялась (нет сделок)")

        if (r.get("quantity") or 0) <= 0:
            add(r, "warn", "quantity", f"{name}: неположительное количество")
        if not r.get("resolved"):
            add(r, "error", "isin", f"{name}: ISIN не сопоставлен с бумагой MOEX", True)

        if not is_bond:
            continue                                 # дальше — только облигационные проверки

        if ytm is not None:
            have_ytm += 1
            if not (-20 <= ytm <= 300):
                add(r, "error", "ytm", f"{name}: YTM {ytm}% вне диапазона −20…300", True)
            elif ytm >= 40:
                add(r, "warn", "ytm", f"{name}: очень высокий YTM {ytm}% — проверьте цену/дефолт-риск")
        if dur is not None:
            have_dur += 1
            if not (0 <= dur <= 100):
                add(r, "error", "duration", f"{name}: дюрация {dur} вне диапазона 0–100")
        if r.get("duration_estimated"):
            add(r, "info", "duration", f"{name}: дюрация оценочная (MOEX не отдал)")

        if (r.get("accint") or 0) < 0:
            add(r, "warn", "accint", f"{name}: отрицательный НКД")

        if r.get("rating_bucket") or r.get("rating"):
            have_rating += 1
        else:
            add(r, "info", "rating", f"{name}: нет рейтинга")

        if mat:
            have_mat += 1
            try:
                md = datetime.strptime(mat, "%Y-%m-%d").date()
                if md < today:
                    add(r, "error", "matdate", f"{name}: дата погашения {mat} в прошлом", True)
            except ValueError:
                add(r, "warn", "matdate", f"{name}: некорректная дата погашения {mat}")
        else:
            add(r, "warn", "matdate", f"{name}: нет даты погашения")

    order = {"error": 0, "warn": 1, "info": 2}
    issues.sort(key=lambda x: order.get(x["level"], 3))
    errors = sum(1 for i in issues if i["level"] == "error")
    warns = sum(1 for i in issues if i["level"] == "warn")
    # 0–100 quality score: penalise errors hard, warnings lightly
    score = max(0, round(100 - errors * 22 - warns * 8 - (len(issues) - errors - warns) * 3))
    return {
        "score": score,
        "counts": {"error": errors, "warn": warns, "info": len(issues) - errors - warns},
        "coverage": {                                # YTM/дюрация/рейтинг/погашение — по облигациям
            "price": round(100 * have_price / n), "ytm": round(100 * have_ytm / nb),
            "duration": round(100 * have_dur / nb), "rating": round(100 * have_rating / nb),
            "maturity": round(100 * have_mat / nb),
        },
        "issues": issues,
    }
