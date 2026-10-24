"""Portfolio risk analytics: per-position DV01, a factor-decomposed stress test,
concentration metrics (HHI / effective issuers), and an own-duration fallback.

Ported/adapted from the mature BondDash `risk_scenarios` engine. The key ideas:
  * a floater carries almost no RATE duration (only to its next coupon reset) but
    full CREDIT duration — so rate and credit shocks hit it very differently;
  * a portfolio P&L under a shock decomposes into independent, presentable parts
    (rate, convexity, credit, rating migration, concentration, FX);
  * when MOEX omits duration (new / illiquid issues), estimate it from a synthetic
    coupon schedule so the bond degrades gracefully instead of dropping out.
"""
from __future__ import annotations

from typing import Optional

from ..db import BondRating, BondSnapshot
from . import agencies, ratings

# Rating-migration haircuts (% of market value) applied per effective bucket in a
# stress. Investment grade is unshocked by default; junk/NR take a mark.
_DEFAULT_RATING_HAIRCUTS = {"BBB": 1.0, "BB": 4.0, "B": 8.0, "CCC": 15.0, "CC": 20.0,
                            "C": 25.0, "D": 40.0, "NR": 6.0}

DEFAULT_SHOCK = {
    "rate_shock_bp": 100.0,
    "credit_shock_bp": 150.0,
    "fx_shock_pct": -10.0,             # rouble weakens 10% → gain on FX bonds
    "largest_issuer_haircut_pct": 0.0,
    "rating_haircuts": _DEFAULT_RATING_HAIRCUTS,
}


def _own_modified_duration(coupon_pct: Optional[float], years: Optional[float],
                           ytm: Optional[float], freq: int = 2) -> Optional[float]:
    """Modified duration from a synthetic level-coupon bullet schedule — a fallback
    for when MOEX reports no duration. Discounts each period's cash flow at YTM."""
    if not (years and years > 0 and ytm and ytm > 0):
        return None
    y = ytm / 100.0 / freq
    c = (coupon_pct or 0.0) / 100.0 / freq * 100.0          # coupon per 100 face
    n = max(1, round(years * freq))
    pv = tw = 0.0
    for i in range(1, n + 1):
        cf = c + (100.0 if i == n else 0.0)
        d = cf / (1 + y) ** i
        pv += d
        tw += (i / freq) * d
    if pv <= 0:
        return None
    return (tw / pv) / (1 + y)                                # Macaulay → modified


# ручные алиасы: SPV / сокращение эмитента → ключ рейтинга группы в базе агентств
_ISSUER_ALIASES = {
    "дфф": "дме",                        # Домодедово Фьюэл Фасилитис → Домодедово (ДМЕ)
    "домодедово": "дме",
    "домодедово фьюэл фасилитис": "дме",
    "гмк нор никель": "гмк норильский никель",   # «ГМК Нор.никель» → Норильский никель
    "норникель": "гмк норильский никель",
    "гмк норникель": "гмк норильский никель",
}

# ручные рейтинги для эмитентов, которых нет в скрейпе агентств (issuer_key → (bucket, подпись))
_MANUAL_RATINGS = {
    "мани мен": ("BBB", "ruBBB- (Эксперт РА)"),   # МФК Мани Мен (Moneyman)
}


_KEY_RATE_CACHE: dict = {}


def _current_key_rate() -> float:
    """Текущая ключевая ставка ЦБ (кэш на час; для прогноза купона флоатеров)."""
    import time
    now = time.time()
    if _KEY_RATE_CACHE.get("t", 0) > now - 3600 and _KEY_RATE_CACHE.get("v"):
        return _KEY_RATE_CACHE["v"]
    from . import instrument
    try:
        v = instrument.cbr_key_rate() or _KEY_RATE_CACHE.get("v") or 14.0
    except Exception:
        v = _KEY_RATE_CACHE.get("v") or 14.0
    _KEY_RATE_CACHE.update(t=now, v=v)
    return v


def _agency_rating(amap: dict, issuer: str | None):
    """Best agency rating for an issuer name (АКРА/Эксперт РА/НКР). Cleans the name
    (drops series after a comma) and tries: (1) full key → shorter token-prefixes
    («Борец Капитал» → «борец»); (2) string-prefix against agency keys, so a glued
    name like «евразхолдинг» still matches the agency key «евраз»."""
    if not issuer:
        return None
    core = issuer.split(",")[0]                 # отрезать серию «…, 001P-07»
    key = ratings.issuer_key(core)
    if not key:
        return None
    alias = _ISSUER_ALIASES.get(key)            # ручной алиас SPV → группа
    if alias:
        best = agencies.best_for(amap.get(alias, []))
        if best and best.get("bucket"):
            return best
    # полное совпадение важнее (Почта России, Газпром нефть — есть в базе как есть),
    # затем отбрасываем хвостовые слова, если полного совпадения нет
    toks = key.split()
    for i in range(len(toks), 0, -1):
        best = agencies.best_for(amap.get(" ".join(toks[:i]), []))
        if best and best.get("bucket"):
            return best
    # склеенные имена: «евразхолдинг» → «евраз» (общий префикс ≥5), только для одного слова
    if len(toks) == 1:
        cand = None
        for k in amap:
            if len(k) >= 5 and key.startswith(k):
                if cand is None or len(k) > len(cand):
                    cand = k
        if cand:
            best = agencies.best_for(amap.get(cand, []))
            if best and best.get("bucket"):
                return best
    return None


def enrich_positions(db, rows: list[dict]) -> None:
    """In place: attach kind + rate/credit/modified duration to each position row,
    reading the authoritative fix/float class and coupon from the market snapshot
    and falling back to an estimated duration when MOEX has none."""
    snaps = {s.isin: s for s in db.query(BondSnapshot).all()}
    brt = {b.isin: b for b in db.query(BondRating).all()}    # рейтинг + сектор (dohod)
    from ..db import MoexSecurity
    msec = {m.isin: m for m in db.query(MoexSecurity).all()}  # дата следующего купона (пересмотр флоатера)
    amap = agencies.ratings_map(db)                          # рейтинги агентств по эмитенту
    for r in rows:
        s = snaps.get(r["isin"])
        b = brt.get(r["isin"])
        # рейтинг — ТОЛЬКО из рейтингов агентств (АКРА/Эксперт РА/НКР); у dohod рейтинг
        # выпуска часто занижен/ошибочен, поэтому как источник рейтинга не используем
        # (сектор из dohod оставляем). Если агентского рейтинга нет — «н/р», не гадаем.
        issuer = (b.issuer if b else None) or (s.issuer_full if s else None) or r.get("name")
        itype = (r.get("instrument_type") or "").lower()
        if "ofz" in itype or "минфин" in (issuer or "").lower() or str(r.get("isin", "")).startswith("SU"):
            r["rating_bucket"] = "AAA"          # ОФЗ / суверенный долг
            r["rating"] = "AAA · гособлигация"
        else:
            # сначала по идентификаторам (ISIN выпуска / MOEX emitent_id), затем по имени — как в скринере
            _lst, _ = agencies.for_bond(amap, r.get("isin"), s.emitent_id if s else None)
            best = agencies.best_for(_lst) if _lst else None
            if not (best and best.get("bucket")):
                best = _agency_rating(amap, issuer)
            if best and best.get("bucket"):
                r["rating_bucket"] = best["bucket"]
                r["rating"] = best.get("rating")
            else:
                man = _MANUAL_RATINGS.get(ratings.issuer_key((issuer or "").split(",")[0]))
                if man:
                    r["rating_bucket"], r["rating"] = man
                else:
                    r["rating_bucket"] = None
        if b and not r.get("sector"):
            r["sector"] = b.sector
        is_bond = r.get("is_bond", True)
        if not is_bond:
            # акция / фонд ликвидности / ETF — не участвует в YTM/дюрации/кред. риске
            it = (r.get("instrument_type") or "").lower()
            r["kind"] = "fund" if any(k in it for k in ("ppif", "etf", "fund")) else "share" if "share" in it else "other"
            r["is_float"] = False
            r["current_yield"] = None
            r["issuer_key"] = _issuer_key(r)
            if not r.get("rating_bucket"):
                r["rating_bucket"] = None
            r["modified_duration"] = None
            continue
        kind = (s.kind if s else None) or "fixed"
        is_float = kind == "floater"
        r["kind"] = kind
        r["is_float"] = is_float
        r["issuer_key"] = _issuer_key(r)
        # current_yield уже посчитан в position_metrics из графика купонов; запасные
        # варианты — из ставки купона снимка рынка, а для флоатеров без зафиксированного
        # купона — прогноз (ключевая ставка/RUONIA + маржа) ÷ цена
        if r.get("current_yield") is None:
            price = r.get("price_used")
            cp = (s.couponpercent if s else None)
            if cp and price:
                r["current_yield"] = round(cp * 100.0 / price, 2)
            elif is_float and b and b.float_add is not None and price:
                coupon_rate = _current_key_rate() + b.float_add   # КС/RUONIA + маржа
                r["current_yield"] = round(coupon_rate * 100.0 / price, 2)
                r["cy_projected"] = True

        ytm = r.get("ytm")
        dur = r.get("duration_years")
        ytm_maturity = (s.years_to_maturity if s else None) or dur
        # own-duration fallback (#5)
        if dur is None and s is not None:
            est = _own_modified_duration(s.couponpercent, s.years_to_maturity, s.ytm)
            if est is not None:
                dur = round(est, 2)
                r["duration_years"] = dur
                r["duration_estimated"] = True

        # modified duration ≈ duration / (1 + y)
        mod = (dur / (1 + (ytm or 0) / 100.0)) if dur else None
        r["modified_duration"] = round(mod, 3) if mod else None

        if is_float:
            # процентный риск флоатера — только до пересмотра купона: до даты следующего купона
            # (MOEX NEXTCOUPON), иначе половина купонного периода, иначе ~квартал;
            # в пределах [1 день, 1 год]; кредитный риск — до погашения, с потолком 5 лет.
            reset = 0.25
            m = msec.get(r["isin"])
            try:
                from datetime import date as _d
                if m and m.nextcoupon and m.nextcoupon[:4] not in ("0000", "1900"):
                    reset = max((_d.fromisoformat(m.nextcoupon[:10]) - _d.today()).days, 1) / 365.0
                elif m and m.couponperiod:
                    reset = m.couponperiod / 2 / 365.0
            except ValueError:
                pass
            r["rate_duration"] = round(min(max(reset, 1 / 365), 1.0), 3)
            r["credit_duration"] = round(min(ytm_maturity or dur or 0.0, 5.0), 3)
        else:
            r["rate_duration"] = r["modified_duration"] or (round(dur, 3) if dur else None)
            r["credit_duration"] = r["modified_duration"] or (round(dur, 3) if dur else None)


def _issuer_key(r: dict) -> str:
    return ratings.issuer_key(r.get("issuer") or r.get("name") or r.get("isin") or "")


def concentration(rows: list[dict]) -> dict:
    """HHI, effective number of issuers, largest & top-5 issuer weights."""
    mv_total = sum((r.get("market_value") or 0.0) for r in rows)
    if mv_total <= 0:
        return {"hhi": None, "effective_issuers": None, "largest_share": 0.0,
                "top5_share": 0.0, "n_issuers": 0, "top": []}
    by_issuer: dict[str, dict] = {}
    for r in rows:
        mv = r.get("market_value") or 0.0
        if mv <= 0:
            continue
        k = _issuer_key(r)
        e = by_issuer.setdefault(k, {"key": k, "name": r.get("name"), "mv": 0.0})
        e["mv"] += mv
    items = sorted(by_issuer.values(), key=lambda x: x["mv"], reverse=True)
    weights = [e["mv"] / mv_total for e in items]
    hhi = sum(w * w for w in weights)
    return {
        "hhi": round(hhi, 4),
        "effective_issuers": round(1 / hhi, 1) if hhi else None,
        "largest_share": round(100 * weights[0], 1) if weights else 0.0,
        "top5_share": round(100 * sum(weights[:5]), 1),
        "n_issuers": len(weights),
        "top": [{"key": e["key"], "name": e["name"], "share": round(100 * e["mv"] / mv_total, 1)} for e in items[:8]],
    }


def stress(rows: list[dict], shock: Optional[dict] = None) -> dict:
    """Factor-decomposed portfolio P&L under a shock vector. Returns aggregate DV01,
    per-factor P&L, total, and a per-position breakdown, plus input-coverage."""
    s = {**DEFAULT_SHOCK, **(shock or {})}
    haircuts = {**_DEFAULT_RATING_HAIRCUTS, **(s.get("rating_haircuts") or {})}
    rate_bp = float(s["rate_shock_bp"]); credit_bp = float(s["credit_shock_bp"])
    fx_pct = float(s["fx_shock_pct"]); conc_hc = float(s["largest_issuer_haircut_pct"])

    # identify the largest issuer (by KEY, so all its bonds get the shock)
    conc = concentration(rows)
    largest_key = conc["top"][0]["key"] if conc["top"] else None

    comp = {"rate": 0.0, "convexity": 0.0, "credit": 0.0, "rating": 0.0,
            "concentration": 0.0, "fx": 0.0}
    dv01 = 0.0
    mv_total = mv_dur = mv_rating = 0.0
    per_pos = []
    for r in rows:
        mv = r.get("market_value") or 0.0
        if mv <= 0:
            continue
        mv_total += mv
        rd = r.get("rate_duration"); cd = r.get("credit_duration"); md = r.get("modified_duration")
        bucket = r.get("rating_bucket")
        is_float = r.get("is_float")

        p_rate = -mv * (rd or 0.0) * rate_bp / 10000.0
        # convexity cushions a rate move (second order, positive); fixes only
        p_conv = (0.5 * mv * (md or 0.0) * ((md or 0.0) + 1) * (rate_bp / 10000.0) ** 2) if not is_float else 0.0
        p_credit = -mv * (cd or 0.0) * credit_bp / 10000.0
        # unrated bonds (bucket None) take the NR haircut — matches the client.
        p_rating = -mv * haircuts.get(bucket or "NR", 0.0) / 100.0
        p_conc = -mv * conc_hc / 100.0 if (largest_key and r.get("issuer_key") == largest_key) else 0.0
        # fx_shock_pct = % change of the rouble (negative = rouble weakens); a
        # weaker rouble RAISES the rouble value of a foreign-currency bond.
        p_fx = -mv * fx_pct / 100.0 if (r.get("currency") or "RUB") != "RUB" else 0.0

        dv01 += mv * (rd or 0.0) / 10000.0
        if rd:
            mv_dur += mv
        if bucket:
            mv_rating += mv
        comp["rate"] += p_rate; comp["convexity"] += p_conv; comp["credit"] += p_credit
        comp["rating"] += p_rating; comp["concentration"] += p_conc; comp["fx"] += p_fx
        per_pos.append({
            "isin": r["isin"], "name": r["name"], "kind": r.get("kind"),
            "market_value": round(mv), "dv01": round(mv * (rd or 0.0) / 10000.0, 1),
            "rate_pl": round(p_rate), "credit_pl": round(p_credit),
            "rating_pl": round(p_rating), "fx_pl": round(p_fx),
            "total_pl": round(p_rate + p_conv + p_credit + p_rating + p_conc + p_fx),
        })

    total = sum(comp.values())
    per_pos.sort(key=lambda x: x["total_pl"])
    comp = {k: round(v) for k, v in comp.items()}
    return {
        "shock": s,
        "dv01": round(dv01, 1),
        "components": comp,
        "total_pl": round(total),
        "total_pl_pct": round(total / mv_total * 100, 2) if mv_total else None,
        "market_value": round(mv_total),
        "positions": per_pos,
        "duration_coverage": round(mv_dur / mv_total * 100, 1) if mv_total else 0.0,
        "rating_coverage": round(mv_rating / mv_total * 100, 1) if mv_total else 0.0,
        "concentration": conc,
    }
