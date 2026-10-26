/* Финансы 2 · данные без сервера.
   Загружает статические снимки (ветка fin2-data), держит строки скринера в памяти и считает
   то, что у BondsAI считал бэкенд: фильтры скринера, похожие выпуски, кривая рейтинговой группы,
   страница эмитента, динамика, подсказки поиска. Перенос функций universe.py один в один. */
"use strict";
(function () {
  const F2 = window.FIN2 = window.FIN2 || {};
  const Q = new URLSearchParams(location.search);
  // источник данных: ветка fin2-data на GitHub; для локальной проверки — ?data=./data/
  F2.DATA_BASE = Q.get("data") || (location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "./data/" : "https://raw.githubusercontent.com/klimentiev-a/konspekty/fin2-data/data/");
  F2.OWN_BASE = "./";                       // статические файлы StockAI в самом репозитории
  const cache = new Map();                  // url → Promise(json)
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  F2.today = today;

  F2.load = function (name, opt) {
    opt = opt || {};
    const url = (opt.base || F2.DATA_BASE) + name;
    if (!opt.fresh && cache.has(url)) return cache.get(url);
    const p = fetch(url, { cache: (opt.noStore || Date.now() < (F2.freshUntil || 0)) ? "no-store" : "default" }).then(r => {
      if (!r.ok) throw new Error("HTTP " + r.status + " " + name);
      return r.json();
    });
    cache.set(url, p);
    p.catch(() => cache.delete(url));
    return p;
  };
  F2.tryLoad = (name, opt) => F2.load(name, opt).catch(() => null);

  // ---------- строки скринера ----------
  let UNI = null;                            // {rows, byIsin, updated_at, count, extra}
  F2.universe = async function () {
    if (UNI) return UNI;
    const raw = await F2.load("universe.json");
    const cols = raw.cols, rows = [], extra = [], byIsin = new Map();
    for (const arr of raw.rows) {
      const r = {};
      for (let i = 0; i < cols.length; i++) if (arr[i] != null) r[cols[i]] = arr[i];
      byIsin.set(r.isin, r);
      (r._x ? extra : rows).push(r);
    }
    UNI = { rows, extra, byIsin, updated_at: raw.updated_at, count: raw.count };
    return UNI;
  };
  F2.clearCache = () => { cache.clear(); UNI = null; };
  F2.row = async isin => (await F2.universe()).byIsin.get(String(isin || "").trim().toUpperCase()) || null;

  const num = v => typeof v === "number" && isFinite(v);
  const bucketOf = r => r.agency_bucket || r.rating_bucket || null;
  const isSov = r => (r.secid || "").startsWith("SU") || String(r.emitent_id || "") === "1228"
    || (() => { const nm = `${r.issuer_full || ""} ${r.issuer || ""} ${r.name || ""}`.toLowerCase();
      return ["минфин росс", "минфин рф", "министерство финансов росс", "российская федерац", "говоз", "овоз", "рф зо", "рф-зо"].some(m => nm.includes(m)) || nm.trimStart().startsWith("россия"); })();
  const ikey = r => r.emkey || (isSov(r) ? "минфин рф офз" : r.emitent_id ? `eid:${r.emitent_id}` : (r.issuer || r.issuer_full || r.name || "").toLowerCase());
  F2.ikey = ikey;
  // round() Python: при ровно .5 — к чётному (JS Math.round — вверх); иначе б.п. отличались бы на 1
  const pyRound = x => { const f = Math.floor(x), d = x - f; return d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1); };
  F2.pyRound = pyRound;
  const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  F2.median = median;

  // ---------- /api/universe — фильтры и сортировка скринера (universe.query) ----------
  F2.query = async function (p) {
    const U = await F2.universe();
    const list = k => p.get(k) ? p.get(k).split(",").map(x => x.trim()).filter(Boolean) : null;
    const fl = k => p.get(k) != null && p.get(k) !== "" ? parseFloat(p.get(k)) : null;
    const bool = k => ["true", "1", "yes"].includes(String(p.get(k) || "").toLowerCase());
    const boards = list("boards"), kinds = list("kinds"), rb = list("rating"), sec = list("sectors"), ccy = list("currencies"),
      liq = list("liq"), cf = list("coupon_freq"), isins = list("isins");
    const ytm_min = fl("ytm_min"), ytm_max = fl("ytm_max"), cy_min = fl("cy_min"), cy_max = fl("cy_max"),
      dur_min = fl("dur_min"), dur_max = fl("dur_max"), vol_min = fl("vol_min"), vol_max = fl("vol_max");
    const needle = (p.get("search") || "").toLowerCase() || null, clean = bool("clean"), has_offer = bool("has_offer"), amort = bool("amort");
    const sort = p.get("sort") || "ytm", desc = p.get("desc") == null ? true : bool("desc");
    const limit = Math.min(Math.max(parseInt(p.get("limit") || "300", 10) || 300, 1), 5000);
    const S = a => a ? new Set(a) : null;
    const boards_s = S(boards), kinds_s = S(kinds), rb_s = S(rb), sec_s = S(sec), ccy_s = S(ccy), liq_s = S(liq), cf_s = S(cf),
      isin_s = isins ? new Set(isins.slice(0, 500).map(x => x.toUpperCase())) : null;
    const T = today();
    const rows = [];
    for (const row of U.rows) {
      if (isin_s && !isin_s.has(row.isin)) continue;
      if (boards_s && !boards_s.has(row.board)) continue;
      if (kinds_s && !kinds_s.has(row.kind)) continue;
      const yf = row.kind !== "floater" ? row.ytm : null;
      if (ytm_min != null && (yf == null || yf < ytm_min)) continue;
      if (ytm_max != null && (yf == null || yf > ytm_max)) continue;
      const cy = row.current_yield;
      if (cy_min != null && (cy == null || cy < cy_min)) continue;
      if (cy_max != null && (cy == null || cy > cy_max)) continue;
      const df = row.kind === "floater" ? row.years_to_maturity : row.duration_years;
      if (dur_min != null && (df == null || df < dur_min)) continue;
      if (dur_max != null && (df == null || df > dur_max)) continue;
      if (vol_min != null && (row.volume || 0) < vol_min) continue;
      if (vol_max != null && (row.volume || 0) > vol_max) continue;
      if (needle && !`${row.name || ""} ${row.isin || ""}`.toLowerCase().includes(needle)) continue;
      if (ccy_s && !ccy_s.has(row.currency)) continue;
      if (liq_s && !liq_s.has(row.liq_class)) continue;
      if (rb_s && !rb_s.has(row.rating_bucket)) continue;
      if (sec_s && !sec_s.has(row.sector)) continue;
      if (cf_s) { const c = row.couponfrequency; if (c == null || !cf_s.has(String(Math.trunc(c)))) continue; }
      if (has_offer) { const od = row.offer_date; if (!(od && od >= T)) continue; }
      if (amort && !row.is_amortizing) continue;
      if (clean) {
        if (row.noncomparable) continue;
        const ey = row.kind === "floater" ? row.current_yield : row.ytm;
        if (ey == null || ey <= 0 || ey > 60) continue;
        if (row.price != null && (row.price < 20 || row.price > 140)) continue;
        if ((row.volume || 0) < 5e5) continue;
      }
      rows.push(row);
    }
    const skey = ["rating", "rating_bucket", "agency_rating"].includes(sort) ? "rating_score" : sort;
    const v = x => { let val = x[skey]; if (skey === "ytm" && x.kind === "floater") val = null; if (skey === "duration_years" && x.kind === "floater") val = x.years_to_maturity; return val == null ? null : val; };
    const isNum = x => num(x) || typeof x === "boolean";
    const numR = rows.filter(r => isNum(v(r))), txt = rows.filter(r => typeof v(r) === "string"), nul = rows.filter(r => { const x = v(r); return !(isNum(x) || typeof x === "string"); });
    numR.sort((a, b) => desc ? Number(v(b)) - Number(v(a)) : Number(v(a)) - Number(v(b)));
    txt.sort((a, b) => { const x = v(a).toLowerCase(), y = v(b).toLowerCase(); return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1); });
    const all = numR.concat(txt, nul);
    const fx = all.filter(r => r.kind === "fixed" || r.kind === "discount");
    const yv = fx.filter(r => r.ytm != null && r.ytm < 60).map(r => r.ytm);
    const dv = fx.filter(r => r.duration_years != null && (r.ytm == null || r.ytm < 60)).map(r => r.duration_years);
    const avg = a => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length * 100) / 100 : null;
    return { rows: all.slice(0, limit), total: all.length, avg_ytm: avg(yv), avg_dur: avg(dv), updated_at: U.updated_at };
  };

  // ---------- /api/universe/one ----------
  F2.one = async isin => F2.row(isin);

  // ---------- /api/universe/suggest ----------
  const cleanestName = names => {
    names = names.filter(Boolean);
    if (!names.length) return null;
    const score = n => { let s = 0; if (n.includes(",")) s += 100; if (/\d/.test(n)) s += 40; if (/\b(бо|бп|об|сер|серия|выпуск)\b/i.test(n)) s += 20; return s + n.length * 0.3; };
    return stripSeries(names.reduce((b, n) => score(n) < score(b) ? n : b));
  };
  const stripSeries = n => {
    if (!n) return n;
    n = n.split(", ", 1)[0];
    n = n.replace(/[\s,]+(?:БО|БП|ПБО|ПБ|Б-?\d|сер\.?|серия|выпуск|вып\.?)\b.*$/i, "");
    n = n.replace(/[\s,]+(?:П\d|\d{3}[A-Za-zА-Яа-я])[\wА-Яа-я-]*.*$/i, "");
    n = n.replace(/[\s,]+\d[\wА-Яа-я-]*$/, "");
    n = n.replace(/[\s,]+\d*[А-Яа-я]?\d+Р[\wА-Яа-я-]*$/i, "");
    return n.replace(/^[\s,\-–—]+|[\s,\-–—]+$/g, "") || null;
  };
  F2.cleanestName = cleanestName;
  F2.suggest = async function (q) {
    if (!q || q.length < 2) return [];
    const U = await F2.universe();
    const needle = q.toLowerCase();
    const all = U.rows.concat(U.extra);
    const issuers = new Map();
    for (const r of all) {
      const nm = r.issuer_rt || r.issuer_full || r.name;
      if (!nm || !nm.toLowerCase().includes(needle)) continue;
      const k = ikey(r);
      if (!k) continue;
      let e = issuers.get(k);
      if (!e) issuers.set(k, e = { type: "issuer", key: k, issuer: nm, count: 0, vol: 0, _names: [] });
      e.count++; e.vol += r.volume_today || 0; e._names.push(nm);
    }
    const issuerList = [...issuers.values()].map(e => { e.issuer = cleanestName(e._names) || e.issuer; delete e._names; return e; })
      .sort((a, b) => b.vol - a.vol).slice(0, 5);
    const hits = all.filter(r => !r._nocand && `${r.name || ""} ${r.isin}`.toLowerCase().includes(needle))
      .sort((a, b) => (b.volume_today || 0) - (a.volume_today || 0)).slice(0, 20)
      .map(r => ({ type: "bond", isin: r.isin, secid: r.secid, name: r.name, ytm: r.ytm ?? null, duration_years: r.duration_years ?? null, board: r.board }));
    return issuerList.concat(hits);
  };

  // ---------- /api/universe/similar ----------
  F2.similar = async function (isin, limit) {
    limit = limit || 25;
    const base = await F2.row(isin);
    if (!base) return { base: null, issuer: [], by_rating: [], by_sector: [] };
    const U = await F2.universe();
    const baseKey = ikey(base), bb = bucketOf(base), bccy = base.currency || "RUB", bk = base.kind;
    const take = pred => U.rows.filter(r => r.isin !== base.isin && pred(r))
      .sort((a, b) => Math.abs((a.duration_years || 0) - (base.duration_years || 0)) - Math.abs((b.duration_years || 0) - (base.duration_years || 0))).slice(0, limit);
    const sameCcy = r => (r.currency || "RUB") === bccy, sameKind = r => r.kind === bk;
    return {
      base,
      issuer: take(r => baseKey && ikey(r) === baseKey && sameCcy(r)),
      by_rating: take(r => bb && bucketOf(r) === bb && sameCcy(r) && sameKind(r)),
      by_sector: take(r => base.sector && r.sector === base.sector && sameCcy(r) && sameKind(r)),
    };
  };

  // ---------- /api/universe/rating_curve ----------
  const fixedRows = U => U.rows.filter(r => !["floater", "linker", "structured"].includes(r.kind) && !/^SU(46|48|52)/.test(r.secid || "")
    && r.ytm != null && r.ytm > 0 && r.ytm < 60 && r.duration_years);
  const fairYield = (group, dur, window) => {
    window = window || 0.9;
    let near = group.filter(g => Math.abs((g.duration_years || 0) - dur) <= window).map(g => g.ytm);
    if (!near.length) near = [...group].sort((a, b) => Math.abs((a.duration_years || 0) - dur) - Math.abs((b.duration_years || 0) - dur)).slice(0, 5).map(g => g.ytm);
    return near.length ? median(near) : null;
  };
  const r2 = x => { if (x == null) return null; if (Number.isInteger(x * 8) && !Number.isInteger(x * 4)) { const f = Math.floor(x * 100); return (f % 2 === 0 ? f : f + 1) / 100; } return Number(x.toFixed(2)); };   // точная «половинка» (k/8) — к чётному, как round(x, 2) в Python
  F2.r2 = r2;
  F2.ratingCurve = async function (isin) {
    const base = await F2.row(isin);
    if (!base) return { base: null };
    const U = await F2.universe();
    const bucket = bucketOf(base), ccy = base.currency;
    const group = bucket ? fixedRows(U).filter(r => bucketOf(r) === bucket && r.isin !== base.isin && r.currency === ccy) : [];
    const curve = [];
    if (group.length) {
      const durs = group.map(g => g.duration_years).sort((a, b) => a - b);
      const lo = durs[0], hi = durs[durs.length - 1];
      const step = hi > lo ? Math.max(0.5, (hi - lo) / 12) : 1;
      for (let d = lo; d <= hi + 1e-9; d += step) { const fy = fairYield(group, d); if (fy != null) curve.push({ duration: r2(d), ytm: r2(fy) }); }
    }
    const fair = group.length && base.duration_years ? fairYield(group, base.duration_years) : null;
    const rc = fair != null && base.ytm != null ? pyRound((base.ytm - fair) * 100) : null;
    return { base, bucket, group, curve, fair_yield: r2(fair), rich_cheap_bp: rc, comment: autoComment(base, fair, rc) };
  };
  const autoComment = (base, fair, rc) => {
    const bucket = bucketOf(base), parts = [];
    if (rc != null && fair != null) {
      const direction = rc > 0 ? "дешевле" : "дороже";
      const verdict = rc > 30 ? "недооценена относительно группы" : rc < -30 ? "переоценена относительно группы" : "близко к справедливой для своей группы";
      parts.push(`${base.name}: доходность ${base.ytm}% — на ${Math.abs(rc)} б.п. ${direction} медианы группы ${bucket} (${r2(fair)}%); бумага ${verdict}.`);
    }
    const risks = [];
    if ((base.agency_forecast || "").toLowerCase().includes("негатив")) risks.push(`негативный прогноз ${base.agency_name}`);
    if (base.offer_date) {
      if (base.yield_limitation === "call_terms_unconfirmed_maturity_only") risks.push(`CALL ${base.offer_date} — условия выкупа не подтверждены; показана доходность до погашения без CALL`);
      else if (base.yield_conditional_on_call) risks.push(`CALL ${base.offer_date} — показанная доходность условна и зависит от решения эмитента`);
      else risks.push(`оферта ${base.offer_date} — доходность считать к оферте`);
    }
    if ((base.volume || 0) < 5e6) risks.push("низкая ликвидность");
    if (["BB", "B", "CCC", "CC", "C", "D"].includes(bucket)) risks.push("субинвестиционный рейтинг (ВДО)");
    if (risks.length) parts.push("Риски: " + risks.join(", ") + ".");
    return parts.length ? parts.join(" ") : null;
  };

  // ---------- /api/movers ----------
  F2.movers = async function (limit, minTurnover) {
    const U = await F2.universe();
    const traded = U.rows.concat(U.extra).filter(r => (r.numtrades || 0) > 0 && !(minTurnover && (r.volume_today || 0) < minTurnover));
    const withChg = traded.filter(r => r.change_day_pct != null);
    return {
      gainers: [...withChg].sort((a, b) => b.change_day_pct - a.change_day_pct).slice(0, limit),
      losers: [...withChg].sort((a, b) => a.change_day_pct - b.change_day_pct).slice(0, limit),
      turnover: traded.filter(r => r.volume_today).sort((a, b) => b.volume_today - a.volume_today).slice(0, limit),
      traded_count: traded.length,
    };
  };

  // ---------- /api/ideas (universe.ideas: аномалии относительной стоимости) ----------
  const LIQ_PEN = { "Высокая": 0, "Средняя": 25, "Низкая": 60 };
  const liqPenalty = c => c in LIQ_PEN ? LIQ_PEN[c] : 60;
  const percentile = (sv, q) => { if (!sv.length) return null; if (sv.length === 1) return sv[0]; const idx = q * (sv.length - 1), lo = Math.floor(idx), hi = Math.min(lo + 1, sv.length - 1); return sv[lo] + (sv[hi] - sv[lo]) * (idx - lo); };
  const rankPct = (vals, x) => vals.length ? pyRound(100 * vals.filter(v => v < x).length / vals.length) : null;
  F2.ideas = async function (limit, minTurnover) {
    if (!minTurnover) {                      // без порога по обороту — точный серверный расчёт из снимка (limit=1000)
      const d = await F2.tryLoad("ideas.json");
      if (d && Array.isArray(d.intra_cheap)) {
        const cut = (a, n) => (a || []).slice(0, n);
        return { intra_cheap: cut(d.intra_cheap, limit), intra_rich: cut(d.intra_rich, limit), vs_cheap: cut(d.vs_cheap, limit), vs_rich: cut(d.vs_rich, limit),
          high_pctl: cut(d.high_pctl, Math.max(limit, 40)), low_pctl: cut(d.low_pctl, Math.max(limit, 40)), currencies: d.currencies || [] };
      }
    }
    const U = await F2.universe();
    const rows = [];
    for (const r0 of U.rows.concat(U.extra)) {
      if (!(r0.ytm != null || (r0.kind === "floater" && r0.current_yield != null))) continue;
      if ((r0.numtrades || 0) <= 0) continue;
      if (minTurnover && ((r0.avg_volume != null ? r0.avg_volume : r0.volume_today) || 0) < minTurnover) continue;
      const r = { ...r0 };
      const isRub = (r.currency || "RUB") === "RUB";
      if (r.kind === "floater") { r.metric_bp = r.simple_margin_bp ?? null; r.metric_kind = "SM"; }
      else if (isRub && r.g_spread_bp != null) { r.metric_bp = r.g_spread_bp; r.metric_kind = "G"; }
      else if (!isRub && r.ytm != null && r.ytm > 0 && r.ytm < 40) { r.metric_bp = pyRound(r.ytm * 100); r.metric_kind = "Y"; }
      else r.metric_bp = null;
      if (r.metric_bp != null && r.metric_bp >= -500 && r.metric_bp <= 4000) rows.push(r);
    }
    const WINDOW = 0.3;
    const x = r => r.kind !== "floater" ? r.duration_years : r.years_to_maturity;
    const analyse = kindRows => {
      const byBucket = new Map(), byIssuer = new Map();
      for (const r of kindRows) {
        if (r.rating_bucket) { if (!byBucket.has(r.rating_bucket)) byBucket.set(r.rating_bucket, []); byBucket.get(r.rating_bucket).push(r); }
        const ik = ikey(r); if (ik) { if (!byIssuer.has(ik)) byIssuer.set(ik, []); byIssuer.get(ik).push(r); }
      }
      const intra = [], vs = [];
      for (const r of kindRows) {
        const xr = x(r); if (xr == null) continue;
        const pen = liqPenalty(r.liq_class);
        const enrich = (rec, peerVals, med, dev) => { const sv = [...peerVals].sort((a, b) => a - b); const adj = dev > 0 ? pyRound(dev - pen) : pyRound(dev);
          return { ...rec, deviation_bp: pyRound(dev), peer_median_bp: pyRound(med), peer_p25_bp: pyRound(percentile(sv, .25)), peer_p75_bp: pyRound(percentile(sv, .75)),
            peer_pct: rankPct(peerVals, rec.metric_bp), peer_n: peerVals.length, liq_penalty_bp: pen, liq_adjusted_bp: adj, liq_warn: !!(dev > 0 && pen) }; };
        const peers = (byIssuer.get(ikey(r)) || []).filter(p => p.isin !== r.isin && x(p) != null && Math.abs(x(p) - xr) <= WINDOW).map(p => p.metric_bp);
        if (peers.length >= 3) { const med = median(peers), dev = r.metric_bp - med; if (Math.abs(dev) >= 80) { const d = enrich(r, peers, med, dev); d.issuer_median_bp = d.peer_median_bp; intra.push(d); } }
        const bkt = (byBucket.get(r.rating_bucket) || []).filter(p => p.isin !== r.isin && x(p) != null && Math.abs(x(p) - xr) <= WINDOW).map(p => p.metric_bp);
        if (bkt.length >= 5) { const med = median(bkt), dev = r.metric_bp - med; if (Math.abs(dev) >= 150) { const d = enrich(r, bkt, med, dev); d.bucket_median_bp = d.peer_median_bp; vs.push(d); } }
      }
      return [intra, vs];
    };
    const groups = new Map();
    for (const r of rows) { const k = (r.kind === "floater" ? "floater" : "fix") + "|" + (r.currency || "RUB"); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    let intraAll = [], vsAll = [];
    for (const g of groups.values()) { const [i, v] = analyse(g); intraAll = intraAll.concat(i); vsAll = vsAll.concat(v); }
    const cheap = lst => lst.filter(e => e.deviation_bp > 0).sort((a, b) => b.liq_adjusted_bp - a.liq_adjusted_bp).slice(0, limit);
    const rich = lst => lst.filter(e => e.deviation_bp < 0).sort((a, b) => a.deviation_bp - b.deviation_bp).slice(0, limit);
    const fresh = rows.filter(r => !r.pctl_stale);
    const high = fresh.filter(r => r.spread_pctl != null && r.spread_pctl >= 80).sort((a, b) => b.spread_pctl - a.spread_pctl).slice(0, Math.max(limit, 40));
    const low = fresh.filter(r => r.spread_pctl != null && r.spread_pctl <= 20).sort((a, b) => a.spread_pctl - b.spread_pctl).slice(0, Math.max(limit, 40));
    return { intra_cheap: cheap(intraAll), intra_rich: rich(intraAll), vs_cheap: cheap(vsAll), vs_rich: rich(vsAll), high_pctl: high, low_pctl: low,
      currencies: [...new Set(rows.map(r => r.currency || "RUB"))].sort() };
  };

  // ---------- /api/issuer?q= (universe.issuer_page) ----------
  F2.issuerPage = async function (q) {
    const U = await F2.universe();
    const all = U.rows.concat(U.extra);
    let key = null;
    const snap0 = U.byIsin.get((q || "").trim().toUpperCase());
    if (snap0) key = ikey(snap0);
    else if (q.startsWith("eid:") || q === "минфин рф офз") key = q;
    else {
      const nk = q.trim().toLowerCase();
      const nmOf = r => (r.issuer_rt || r.issuer_full || r.name || "");
      const hit = all.find(r => nmOf(r).trim().toLowerCase() === nk) || all.find(r => nmOf(r).toLowerCase().includes(nk));
      if (hit) key = ikey(hit);
    }
    if (!key) return null;
    const rows = all.filter(r => ikey(r) === key);
    if (!rows.length) return null;
    const names = rows.map(r => r.issuer_rt || r.issuer_full || r.name).filter(Boolean);
    const sectors = rows.map(r => r.sector).filter(Boolean);
    const most = arr => { const c = new Map(); for (const x of arr) c.set(x, (c.get(x) || 0) + 1); let b = null, n = 0; for (const [k, v] of c) if (v > n) { b = k; n = v; } return b; };
    const eid = most(rows.map(r => r.emitent_id).filter(Boolean));
    let ag = null;
    if (eid) { const em = await F2.tryLoad("emitent_ratings.json"); const e = em && em[String(eid)]; if (e && e.agencies && e.agencies.length) ag = e.agencies; }
    if (!ag) { const src = rows.find(r => r.agency_all && r.agency_all.length); if (src) ag = src.agency_all; }
    const display = cleanestName(names) || rows[0].name;
    rows.sort((a, b) => (a.duration_years || 0) - (b.duration_years || 0));
    return { key, issuer: display, sector: sectors.length ? most(sectors) : null, agency_ratings: ag, bonds: rows, count: rows.length };
  };

  // ---------- рейтинги выпуска / эмитента ----------
  const md5 = F2.md5 = (function () {
    // компактный md5 (для имени шарда рейтингов — как hashlib.md5(isin)[:2] в экспортёре)
    function cmn(q, a, b, x, s, t) { a = (a + q + x + t) | 0; return (((a << s) | (a >>> (32 - s))) + b) | 0; }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
    function cycle(x, k) {
      let a = x[0], b = x[1], c = x[2], d = x[3];
      a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586); c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
      a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426); c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
      a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417); c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
      a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101); c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
      a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632); c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
      a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083); c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
      a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690); c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
      a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784); c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
      a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463); c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
      a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353); c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
      a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222); c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
      a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835); c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
      a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415); c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
      a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606); c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
      a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744); c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
      a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379); c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
      x[0] = (a + x[0]) | 0; x[1] = (b + x[1]) | 0; x[2] = (c + x[2]) | 0; x[3] = (d + x[3]) | 0;
    }
    function md51(s) {
      const n = s.length, state = [1732584193, -271733879, -1732584194, 271733878];
      let i;
      for (i = 64; i <= n; i += 64) cycle(state, md5blk(s.substring(i - 64, i)));
      s = s.substring(i - 64);
      const tail = new Array(16).fill(0);
      for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
      tail[i >> 2] |= 0x80 << ((i % 4) << 3);
      if (i > 55) { cycle(state, tail); tail.fill(0); }
      tail[14] = n * 8; cycle(state, tail);
      return state;
    }
    function md5blk(s) { const md5blks = []; for (let i = 0; i < 64; i += 4) md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24); return md5blks; }
    const hex = "0123456789abcdef".split("");
    function rhex(n) { let s = ""; for (let j = 0; j < 4; j++) s += hex[(n >> (j * 8 + 4)) & 0x0F] + hex[(n >> (j * 8)) & 0x0F]; return s; }
    return s => md51(s).map(rhex).join("");
  })();
  F2.bondRatings = async function (isin) {
    isin = String(isin || "").trim().toUpperCase();
    const row = await F2.row(isin);
    const shard = await F2.tryLoad("ratings/" + md5(isin).slice(0, 2) + ".json");
    const d = shard && shard[isin];
    const base = { isin, emitent_id: row ? row.emitent_id ?? null : null, inn: null, match: null, worst: null, agencies: [], history: [] };
    if (d) return Object.assign(base, d);
    // шарда нет — покажем рейтинги из строки скринера
    if (row && row.agency_all && row.agency_all.length) base.agencies = row.agency_all;
    return base;
  };
  F2.emitentRatings = async function (eid) {
    const em = await F2.tryLoad("emitent_ratings.json");
    return (em && em[String(eid)]) || { emitent_id: String(eid), match: null, agencies: [] };
  };

  // ---------- /api/placements ----------
  F2.placements = async function (mode, days) {
    if (mode === "history") {
      const d = await F2.load("placements_history.json");
      const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
      const rows = (d.rows || []).filter(r => (r.issue_date || "") >= since);
      return { rows: rows.slice(0, 250), total: rows.length, mode: "history", since };
    }
    return F2.load("placements_current.json");
  };

  // ---------- /api/cbr_meetings (если снимка нет — тот же расчёт, что на сервере) ----------
  F2.cbrMeetings = async function (years) {
    const snap = await F2.tryLoad("cbr_meetings.json");
    if (snap && snap.path) return snap;
    years = years || 3;
    let cur = null;
    const kr = await F2.tryLoad("key_rate.json");
    if (kr && kr.rate != null) cur = kr.rate;
    if (cur == null) { const g = await F2.tryLoad("gcurve.json"); cur = g && g.tenors && g.tenors.length ? Math.round(g.tenors[0].yield_pct * 10) / 10 : 16; }
    const t = new Date(today());
    const months = [[2, 14], [3, 20], [4, 25], [6, 6], [7, 25], [9, 12], [10, 24], [12, 19]];
    const path = [{ date: today(), rate: cur, label: "сейчас" }];
    for (let y = t.getFullYear(); y <= t.getFullYear() + years; y++)
      for (const [m, dd] of months) {
        const d = new Date(Date.UTC(y, m - 1, dd));
        if (d > t && (d - t) / 864e5 <= years * 366) path.push({ date: d.toISOString().slice(0, 10), rate: cur });
      }
    return { current: cur, path };
  };

  // ---------- новости по эмитенту — из ленты Hub (news.json), по названию ----------
  F2.news = async function (isin) {
    const row = await F2.row(isin);
    const issuer = row ? (row.issuer || stripSeries(row.issuer_full) || row.name) : null;
    if (!issuer) return { issuer: null, news: [] };
    const feed = await F2.tryLoad("../news.json", { base: "./" });
    const items = feed ? (feed.items || feed.news || feed) : [];
    // ключевое слово — бренд без правовой формы и кавычек: «ПАО "ГК "Самолет"» → «самолет»
    const LEGAL = /^(пао|ао|ооо|зао|оао|нко|мкпао|мфк|мкк|гк|ук|ик|кб|банк|компания|группа|холдинг|нпф|спб|рф|россии|российская|федерация)$/i;
    const words = issuer.toLowerCase().replace(/[«»"'()]/g, " ").replace(/,.*$/, "").split(/[\s\-–—]+/).filter(w => w.length >= 4 && !LEGAL.test(w));
    const key = words.sort((a, b) => b.length - a.length)[0];
    if (!key) return { issuer, news: [] };
    const stem = key.length > 6 ? key.slice(0, -1) : key;      // «самолет» ловит и «самолета», «самолету»
    const out = [];
    for (const n of Array.isArray(items) ? items : []) {
      const text = `${n.t || n.title || ""} ${n.x || n.summary || ""}`.toLowerCase();
      if (text.includes(stem)) out.push({ title: n.t || n.title, link: n.u || n.url || n.link, date: n.d || n.date, source: n.s || n.source });
      if (out.length >= 12) break;
    }
    return { issuer, news: out };
  };
})();
