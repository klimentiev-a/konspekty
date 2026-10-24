/* Финансы 2 · запросы к Мосбирже (ISS) прямо из браузера и расчёты карточки выпуска.
   Перенос instrument.py / moex.py / bond_math.py BondsAI: история доходности и спредов,
   ликвидность, полная доходность, YTM по цене, сценарий флоатера, график выплат. */
"use strict";
(function () {
  const F2 = window.FIN2 = window.FIN2 || {};
  const BASE = "https://iss.moex.com/iss";
  const SHARE_BOARDS = new Set(["TQBR", "TQTF", "TQTD", "TQTE", "TQIF", "TQPI", "SMAL", "TQDP"]);
  const marketFor = b => { b = (b || "").toUpperCase(); return SHARE_BOARDS.has(b) || b.startsWith("TQT") || b.startsWith("TQB") ? "shares" : "bonds"; };
  const num = v => { if (v == null || v === "" || v === "-") return null; const x = Number(v); return isFinite(x) ? x : null; };
  const today = () => F2.today();
  const d2 = x => F2.r2(x);
  const pyRound = x => F2.pyRound(x);
  const parseD = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
  F2.parseD = parseD;

  const refCache = new Map();
  let inflight = 0; const queue = [];
  const slot = () => new Promise(res => { if (inflight < 6) { inflight++; res(); } else queue.push(res); });
  const free = () => { inflight--; const n = queue.shift(); if (n) { inflight++; n(); } };
  async function iss(path, params, opt) {
    opt = opt || {};
    const p = new URLSearchParams({ "iss.meta": "off", ...(params || {}) });
    const url = `${BASE}/${path.replace(/^\//, "")}?${p}`;
    if (opt.cache && refCache.has(url)) return refCache.get(url);
    const run = (async () => {
      let last;
      for (let a = 0; a < 3; a++) {
        await slot();
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined });
          if (!r.ok) throw new Error("MOEX HTTP " + r.status);
          return await r.json();
        } catch (e) { last = e; await new Promise(res => setTimeout(res, 600 * (a + 1))); }
        finally { free(); }
      }
      throw new Error("MOEX недоступна: " + (last && last.message));
    })();
    if (opt.cache) { refCache.set(url, run); run.catch(() => refCache.delete(url)); }
    return run;
  }
  const block = (payload, name) => { const b = payload && payload[name]; if (!b || !b.columns) return []; return (b.data || []).map(row => Object.fromEntries(b.columns.map((c, i) => [c, row[i]]))); };
  F2.iss = iss; F2.issBlock = block;

  // ---------- справочник ----------
  F2.resolveSecurity = async function (isin) {
    isin = (isin || "").trim().toUpperCase();
    let payload = await iss(`securities/${isin}.json`, { "iss.only": "description,boards" }, { cache: true });
    let desc = Object.fromEntries(block(payload, "description").map(r => [r.name, r.value]));
    let boards = block(payload, "boards");
    if (!Object.keys(desc).length && !boards.length) {
      try {
        const hits = block(await iss("securities.json", { q: isin, "iss.only": "securities" }), "securities");
        for (const row of hits) {
          const sec = row.secid;
          if (sec && sec !== isin) {
            payload = await iss(`securities/${sec}.json`, { "iss.only": "description,boards" }, { cache: true });
            desc = Object.fromEntries(block(payload, "description").map(r => [r.name, r.value])); boards = block(payload, "boards"); break;
          }
        }
      } catch (e) { /* поиск необязателен */ }
    }
    if (!Object.keys(desc).length && !boards.length) throw new Error("ISIN not found on MOEX: " + isin);
    let board = null;
    for (const pool of [boards.filter(b => b.is_primary === 1), boards.filter(b => b.is_traded === 1), boards]) { const b = pool.find(x => x.boardid); if (b) { board = b.boardid; break; } }
    if (!board) { const t = (desc.TYPE || "").toLowerCase(); board = t.includes("ofz") || (!t.includes("subfederal") && t.includes("gov")) ? "TQOB" : "TQCB"; }
    return {
      isin, secid: desc.SECID || isin, board, shortname: desc.SHORTNAME, name: desc.NAME || desc.ISSUENAME, type: desc.TYPE,
      bond_type: desc.BOND_TYPE, bond_subtype: desc.BOND_SUBTYPE, typename: desc.TYPENAME, matdate: desc.MATDATE,
      coupon_benchmark: desc.COUPON_BENCHMARK, coupon_benchmark_spread: num(desc.COUPON_BENCHMARK_SPREAD),
      facevalue: num(desc.FACEVALUE || desc.INITIALFACEVALUE), initialfacevalue: num(desc.INITIALFACEVALUE), faceunit: desc.FACEUNIT,
      couponvalue: num(desc.COUPONVALUE), couponpercent: num(desc.COUPONPERCENT), couponperiod: num(desc.COUPONPERIOD),
      couponfrequency: num(desc.COUPONFREQUENCY), nextcoupon: desc.NEXTCOUPON, is_traded: boards.length > 0,
    };
  };
  F2.currentQuote = async function (isin, board) {
    board = board || "TQCB";
    const p = await iss(`engines/stock/markets/${marketFor(board)}/boards/${board}/securities/${isin}.json`, { "iss.only": "securities,marketdata,marketdata_yields" });
    const sec = block(p, "securities")[0] || {}, md = block(p, "marketdata")[0] || {}, yl = block(p, "marketdata_yields")[0] || {};
    return {
      isin, secid: sec.SECID, board, shortname: sec.SHORTNAME, facevalue: num(sec.FACEVALUEONSETTLEDATE) || num(sec.FACEVALUE),
      settledate: sec.SETTLEDATE, accint: num(sec.ACCRUEDINT), couponvalue: num(sec.COUPONVALUE), couponpercent: num(sec.COUPONPERCENT),
      nextcoupon: sec.NEXTCOUPON, matdate: sec.MATDATE, prevprice: num(sec.PREVPRICE), last: num(md.LAST), marketprice: num(md.MARKETPRICE),
      lcloseprice: num(md.LCLOSEPRICE), waprice: num(md.WAPRICE), bid: num(md.BID), offer: num(md.OFFER), yield_md: num(md.YIELD),
      duration: num(md.DURATION), volume: num(md.VALTODAY), numtrades: num(md.NUMTRADES), updatetime: md.UPDATETIME || md.SYSTIME,
      ytm: num(yl.YIELDCLOSE || yl.EFFECTIVEYIELD || md.YIELD), duration_yields: num(yl.DURATION),
    };
  };
  const cleanPrice = q => { for (const f of ["last", "marketprice", "lcloseprice", "waprice", "prevprice"]) if (q[f]) return q[f]; return null; };

  async function paginate(path, blk, params) {
    const first = block(await iss(path, { ...params, start: 0 }), blk);
    const rows = first.slice();
    if (first.length < 100) return rows;
    let start = 100;
    for (;;) {
      const starts = [0, 1, 2, 3].map(i => start + i * 100);
      const chunks = await Promise.all(starts.map(st => iss(path, { ...params, start: st }).then(p => block(p, blk))));
      let done = false;
      for (const ch of chunks) { rows.push(...ch); if (ch.length < 100) { done = true; break; } }
      if (done) return rows;
      start += 400;
      if (start > 20000) return rows;
    }
  }
  F2.priceHistory = async function (id, board, frm, till) {
    const rows = await paginate(`history/engines/stock/markets/${marketFor(board)}/boards/${board}/securities/${id}.json`, "history",
      { from: frm, till, "history.columns": "TRADEDATE,CLOSE,LEGALCLOSEPRICE,MARKETPRICE3,ACCINT,VOLUME,VALUE,NUMTRADES,YIELDCLOSE,FACEVALUE" });
    return rows.map(r => ({ date: r.TRADEDATE, close: num(r.CLOSE), legalclose: num(r.LEGALCLOSEPRICE), marketprice: num(r.MARKETPRICE3), accint: num(r.ACCINT),
      volume: num(r.VOLUME), value: num(r.VALUE), numtrades: num(r.NUMTRADES), yieldclose: num(r.YIELDCLOSE), facevalue: num(r.FACEVALUE) }));
  };
  F2.yieldHistory = async function (id, board, frm, till) {
    const rows = await paginate(`history/engines/stock/markets/bonds/boards/${board}/yields/${id}.json`, "history_yields",
      { from: frm, till, "iss.only": "history_yields", "history_yields.columns": "TRADEDATE,EFFECTIVEYIELD,YIELDCLOSE,EFFECTIVEYIELDWAPRICE,YIELDATWAP,YIELDTOOFFER,DURATION,PRICE,PRICECLOSE,GSPREADBP" });
    return rows.map(r => ({ date: r.TRADEDATE, yield_close: num(r.EFFECTIVEYIELD || r.YIELDCLOSE), yield_wap: num(r.EFFECTIVEYIELDWAPRICE || r.YIELDATWAP),
      yield_to_offer: num(r.YIELDTOOFFER), duration: num(r.DURATION), price: num(r.PRICE || r.PRICECLOSE), gspread: num(r.GSPREADBP) }));
  };
  F2.bondization = async function (secid) {
    const p = await iss(`securities/${secid}/bondization.json`, { limit: "unlimited", "coupons.limit": "unlimited", "amortizations.limit": "unlimited", "offers.limit": "unlimited" }, { cache: true });
    return {
      coupons: block(p, "coupons").map(r => ({ date: r.coupondate, startdate: r.startdate, initialfacevalue: num(r.initialfacevalue), value: num(r.value), valueprc: num(r.valueprc), value_rub: num(r.value_rub), facevalue: num(r.facevalue), faceunit: r.faceunit })),
      amortizations: block(p, "amortizations").map(r => ({ date: r.amortdate, initialfacevalue: num(r.initialfacevalue), value: num(r.value), value_rub: num(r.value_rub), valueprc: num(r.valueprc), faceunit: r.faceunit, source: r.data_source })),
      offers: block(p, "offers").map(r => ({ date: r.offerdate, price: num(r.price), type: r.offertype })),
    };
  };
  const tenorsOf = rows => rows.map(r => ({ period_years: num(r.period), yield_pct: num(r.value) })).filter(t => t.period_years != null).sort((a, b) => a.period_years - b.period_years);
  F2.gcurveLive = async function () {
    const rows = block(await iss("engines/stock/zcyc.json", { "iss.only": "yearyields" }), "yearyields");
    return { tradedate: rows[0] && rows[0].tradedate, tradetime: rows[0] && rows[0].tradetime, tenors: tenorsOf(rows) };
  };
  F2.zcycOn = async function (d) {
    for (let k = 0; k < 10; k++) {
      const dd = iso(parseD(d) - k * 864e5);
      const rows = block(await iss("engines/stock/zcyc.json", { "iss.only": "yearyields", date: dd }), "yearyields");
      if (rows.length) return { tradedate: rows[0].tradedate || dd, tenors: tenorsOf(rows) };
    }
    return null;
  };
  F2.gcurve = async function () {
    const snap = await F2.tryLoad("gcurve.json");
    if (snap && snap.tenors && snap.tenors.length) return snap;
    return F2.gcurveLive();
  };
  const gcurveYield = (years, curve) => {
    if (years == null || years <= 0 || !curve) return null;
    const pts = (curve.tenors || []).filter(t => t.period_years != null && t.yield_pct != null).map(t => [t.period_years, t.yield_pct]);
    if (!pts.length) return null;
    if (years <= pts[0][0]) return pts[0][1];
    if (years >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (let i = 0; i + 1 < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; if (x0 <= years && years <= x1) { const w = x1 !== x0 ? (years - x0) / (x1 - x0) : 0; return y0 + w * (y1 - y0); } }
    return pts[pts.length - 1][1];
  };
  F2.gcurveYield = gcurveYield;
  const kbdOn = (snaps, onDate, years) => {
    if (!snaps || !snaps.length || years == null) return null;
    const lo = snaps.filter(s => s.date <= onDate), hi = snaps.filter(s => s.date > onDate);
    if (!lo.length) return null;
    const left = lo[lo.length - 1];
    if (!hi.length) return gcurveYield(years, left);
    const right = hi[0], yl = gcurveYield(years, left), yr = gcurveYield(years, right);
    if (yl == null || yr == null) return yl != null ? yl : yr;
    const span = daysBetween(left.date, right.date) || 1, w = Math.max(0, Math.min(1, daysBetween(left.date, onDate) / span));
    return yl + w * (yr - yl);
  };
  const yearsTo = (matdate, base) => { if (!matdate || matdate === "0000-00-00") return null; const t = parseD(matdate); if (isNaN(t)) return null; return (t - (base != null ? base : parseD(today()))) / 864e5 / 365.25; };
  F2.ofzBenchmarks = async function () {
    const b = await F2.tryLoad("ofz_benchmarks.json");
    if (b && b.length) return b;
    // снимка нет — собираем из строк скринера (ОФЗ-ПД серии 26)
    const U = await F2.universe();
    return U.rows.filter(r => (r.secid || "").startsWith("SU26") && r.ytm && r.duration_years)
      .map(r => ({ secid: r.secid, name: r.name, ytm: r.ytm, duration_years: r.duration_years, years: yearsTo(r.matdate), matdate: r.matdate }))
      .sort((a, b) => (a.years || a.duration_years) - (b.years || b.duration_years));
  };
  const nearestOfz = (years, bench, by) => {
    if (years == null || !bench || !bench.length) return null;
    if (by === "duration") { const wd = bench.filter(b => b.duration_years); if (wd.length) return wd.reduce((m, b) => Math.abs(b.duration_years - years) < Math.abs(m.duration_years - years) ? b : m); }
    const wy = bench.filter(b => b.years);
    if (wy.length) return wy.reduce((m, b) => Math.abs(b.years - years) < Math.abs(m.years - years) ? b : m);
    return bench.reduce((m, b) => Math.abs(b.duration_years - years) < Math.abs(m.duration_years - years) ? b : m);
  };
  const simpleMarginBp = (price, years, qm) => { if (price == null || qm == null || price <= 0) return null; const pull = years && years > 0 ? (100 - price) / years : 0; return pyRound((qm + pull) * (100 / price) * 100); };
  F2.simpleMarginBp = simpleMarginBp;

  // ---------- bond_math ----------
  const BM = {
    couponChain(coupons, settle, end) {
      let cursor = settle;
      if (isNaN(parseD(end))) return false;
      const periods = new Map();
      for (const [cd, sd] of coupons) { const fin = parseD(cd), st = parseD(sd); if (isNaN(fin)) return false; if (fin > settle && cd <= end) periods.set(cd + "|" + sd, [cd, sd]); }
      const future = [...periods.values()].sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1));
      if (!future.length) return false;
      for (const [cd, sd] of future) {
        if (!sd) return false;
        const st = parseD(sd), fin = parseD(cd);
        if (isNaN(st) || isNaN(fin)) return false;
        if (fin <= st || !(st <= cursor && cursor < fin)) return false;
        if (cursor !== settle && st !== cursor) return false;
        cursor = fin;
      }
      return iso(cursor) === end;
    },
    principal(face, amortizations, settle, matdate, bullet) {
      face = Number(face);
      if (!isFinite(face) || face <= 0) return null;
      const rows = new Map();
      for (const [d, value] of amortizations) {
        const day = parseD(d), v = Number(value);
        if (isNaN(day) || !isFinite(v) || v < 0) return null;
        if (rows.has(day) && Math.abs(rows.get(day) - v) > .005) return null;
        rows.set(day, v);
      }
      if (!rows.size && bullet && matdate) { const md = parseD(matdate); if (isNaN(md)) return null; if (md > settle) rows.set(md, face); }
      const future = [...rows].filter(([d, v]) => d > settle && v > 0).sort((a, b) => a[0] - b[0]).map(([d, v]) => [iso(d), v]);
      const outstanding = future.reduce((s, [, v]) => s + v, 0);
      const tol = Math.max(.02, face * .00001), sameDay = rows.get(settle) || 0;
      if (outstanding <= 0 || Math.min(Math.abs(outstanding - face), Math.abs(outstanding + sameDay - face)) > tol) return null;
      return [future, outstanding];
    },
    solve(flows, dirty, settle) {
      if (dirty == null || !isFinite(dirty) || dirty <= 0) return null;
      const pts = [];
      for (const [d, amount] of flows) { const t = (parseD(d) - settle) / 864e5 / 365, v = Number(amount); if (isNaN(t) || !isFinite(v) || v < 0) return null; if (t > 0 && v) pts.push([t, v]); }
      if (!pts.length) return null;
      const pv = lr => { let s = 0; for (const [t, v] of pts) s += v * Math.exp(-t * lr); return s; };
      let lo = -30, hi = 30;
      if (pv(lo) < dirty || pv(hi) > dirty) return null;
      for (let i = 0; i < 160; i++) { const mid = (lo + hi) / 2; if (pv(mid) > dirty) lo = mid; else hi = mid; }
      const r = (lo + hi) / 2, y = Math.expm1(r) * 100;
      let dur = 0; for (const [t, v] of pts) dur += t * v * Math.exp(-t * r); dur /= dirty;
      return isFinite(y) ? [d2(y), Math.round(dur * 1e6) / 1e6] : null;
    },
  };
  F2.bondMath = BM;

  // ---------- YTM по цене (ytm_from_price) ----------
  const settleDate = cf => { if (cf.settledate && !isNaN(parseD(cf.settledate))) return parseD(cf.settledate); let d = parseD(today()) + 864e5; while ([0, 6].includes(new Date(d).getUTCDay())) d += 864e5; return d; };
  const accruedFromSchedule = (cf, settle) => {
    const rows = (cf.coupons || []).map(c => [parseD(c.date), c.value]).filter(r => !isNaN(r[0])).sort((a, b) => a[0] - b[0]);
    const nxt = rows.find(r => r[0] > settle);
    if (!nxt || nxt[1] == null) return null;
    const prevs = rows.filter(r => r[0] <= settle);
    if (!prevs.length) return null;
    const prev = prevs[prevs.length - 1][0], period = (nxt[0] - prev) / 864e5;
    return period > 0 ? nxt[1] * ((settle - prev) / 864e5) / period : null;
  };
  function ytmFromPrice(cleanPx, cf, until, redeemPrice) {
    redeemPrice = redeemPrice == null ? 100 : redeemPrice;
    const t0 = settleDate(cf), face = cf.face || 1000;
    let horizon = null;
    if (until) { horizon = parseD(until); if (isNaN(horizon) || horizon <= t0) return null; }
    const flows = [], seen = new Map();
    for (const c of cf.coupons || []) {
      const d = c.date, v = c.value;
      if (seen.has(d)) { if (seen.get(d) !== v) return null; continue; }
      seen.set(d, v);
      if (!d) continue;
      const cd = parseD(d); if (isNaN(cd)) continue;
      if (cd > t0 && (horizon == null || cd <= horizon)) { if (v == null) return null; flows.push([(cd - t0) / 864e5 / 365, v]); }
    }
    const amortsIn = (cf.amortizations || []).map(a => [a.date, a.value]);
    const pr = BM.principal(face, amortsIn, t0, cf.matdate, !amortsIn.length);
    if (!pr) return null;
    const [amorts, face2] = pr;
    if (cf.require_complete_schedule) {
      const chain = (cf.coupons || []).map(c => [c.date, c.startdate, c.value]);
      if (!BM.couponChain(chain, t0, until || amorts[amorts.length - 1][0])) return null;
    }
    if (horizon != null) {
      let rest = 0;
      for (const [ds, v] of amorts) { const ad = parseD(ds); if (t0 < ad && ad <= horizon) flows.push([(ad - t0) / 864e5 / 365, v]); else if (ad > horizon) rest += v; }
      flows.push([(horizon - t0) / 864e5 / 365, redeemPrice / 100 * rest]);
    } else for (const [ds, v] of amorts) { const ad = parseD(ds); if (ad > t0) flows.push([(ad - t0) / 864e5 / 365, v]); }
    if (!flows.length) return null;
    let acc = cf.accint; if (acc == null) acc = accruedFromSchedule(cf, t0); if (acc == null) return null;
    const dirty = cleanPx / 100 * face2 + acc;
    const dated = flows.map(([t, amt]) => [iso(t0 + Math.round(t * 365) * 864e5), amt]);
    const s = BM.solve(dated, dirty, t0);
    return s ? s[0] : null;
  }
  F2.ytmFromPrice = ytmFromPrice;
  const nextOffer = cf => { const t = parseD(today()); const fut = (cf.offers || []).filter(o => o.date && parseD(o.date) > t).map(o => ({ date: o.date, price: o.price, type: o.type })); return fut.length ? fut.reduce((m, x) => x.date < m.date ? x : m) : null; };
  async function bondCashflows(isin) {
    const ref = await F2.resolveSecurity(isin);
    const [bz, q] = await Promise.all([F2.bondization(ref.secid), F2.currentQuote(isin, ref.board)]);
    const data = { isin, coupons: bz.coupons, amortizations: bz.amortizations, require_complete_schedule: true, settledate: q.settledate, offers: bz.offers,
      face: q.facevalue || ref.facevalue || 1000, accint: q.accint, matdate: q.matdate || ref.matdate, price: cleanPrice(q), ref, quote: q };
    if (!["SUR", "RUB", "RUR", "", null, undefined].includes(ref.faceunit)) data.accint = accruedFromSchedule(data, settleDate(data));
    return data;
  }
  F2.ytmAtPrice = async function (isin, price, accint, row) {
    let cf = await bondCashflows(isin);
    if (accint != null && cf.accint == null) cf = { ...cf, accint };
    const ytm = ytmFromPrice(price, cf);
    let offer = nextOffer(cf), ytp = null;
    if (offer && offer.price != null) ytp = ytmFromPrice(price, cf, offer.date, offer.price);
    // карточка может выбрать проверенный CALL, которого нет в блоке оферт биржи: считаем к нему (как ytm_at_price на сервере)
    if (row && row.offer_type === "CALL" && row.offer_date && row.offer_date > today()) {
      const callPrice = row.offer_price != null ? row.offer_price : null;
      offer = { date: row.offer_date, price: callPrice, type: "CALL", conditional_on_issuer_exercise: true };
      ytp = callPrice != null ? ytmFromPrice(price, cf, row.offer_date, callPrice) : null;
    }
    return { ytm, ytp, offer };
  };

  // ---------- моделирование эмиссии (песочница) ----------
  const PERIOD_DAYS = { 12: 30, 6: 60, 4: 91, 3: 121, 2: 182, 1: 365 };
  F2.modelEmission = function (coupon, frequency, years, price) {
    const freq = parseInt(frequency, 10) || 2, pdays = PERIOD_DAYS[freq] || Math.max(1, Math.round(365 / freq));
    const couponRub = coupon / 100 / 365 * pdays * 1000, n = Math.max(1, Math.round(years * freq));
    const flows = []; for (let k = 1; k <= n; k++) flows.push([k * pdays / 365, couponRub + (k === n ? 1000 : 0)]);
    const dirty0 = price / 100 * 1000;
    const npv = y => flows.reduce((s, [t, a]) => s + a / Math.pow(1 + y, t), 0) - dirty0;
    let lo = -0.95, hi = 6, flo = npv(lo), fhi = npv(hi);
    const base = { coupon, frequency: freq, years, price, coupon_rub: d2(couponRub) };
    if (flo * fhi > 0) return { ...base, ytm: null, duration: null };
    for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2, fm = npv(mid); if (Math.abs(fm) < 1e-7) break; if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; } }
    const ytm = (lo + hi) / 2, pv = flows.map(([t, a]) => a / Math.pow(1 + ytm, t)), total = pv.reduce((s, x) => s + x, 0) || 1;
    const dur = flows.reduce((s, [t], i) => s + t * pv[i], 0) / total;
    return { ...base, ytm: d2(ytm * 100), duration: d2(dur) };
  };
  F2.couponForYtm = function (target, frequency, years, price) {
    let lo = 0, hi = 80;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2, y = F2.modelEmission(mid, frequency, years, price).ytm; if (y == null) break; if (y < target) lo = mid; else hi = mid; }
    const coupon = d2((lo + hi) / 2), m = F2.modelEmission(coupon, frequency, years, price);
    return { coupon, ytm: m.ytm, duration: m.duration, frequency, years, price };
  };

  // ---------- сценарий флоатера по траектории ключевой ставки ----------
  F2.floaterScenario = async function (isin, cleanPx, ratePath, row) {
    cleanPx = Number(cleanPx);
    if (!isFinite(cleanPx) || cleanPx <= 0) throw Object.assign(new Error("price must be a finite positive clean price"), { status: 400 });
    const fi = row && (row.float_index || ((row.secid || "").startsWith("SU29") || (row.secid || "").startsWith("SU24") ? "RUONIA" : "CBR_RATE"));
    if (fi !== "CBR_RATE") return { ytm: null, reason: "scenario_requires_confirmed_CBR_RATE_index" };
    const ref = await F2.resolveSecurity(isin);
    let qm = row && (row.float_add != null ? row.float_add : row.float_qm);
    if (qm == null) qm = ref.coupon_benchmark_spread;
    if (qm == null || !isFinite(Number(qm))) return { ytm: null };
    qm = Number(qm);
    const [bz, quote] = await Promise.all([F2.bondization(ref.secid), F2.currentQuote(isin, ref.board)]);
    const t0 = settleDate({ settledate: quote.settledate });
    const face0 = quote.facevalue || ref.facevalue || 1000;
    const checked = BM.principal(face0, bz.amortizations.map(a => [a.date, a.value]), t0, ref.matdate, !bz.amortizations.length);
    if (!checked) return { ytm: null };
    const [amorts, face] = checked;
    let accint = quote.accint; if (accint == null) accint = row && row.accint != null ? row.accint : null; if (accint == null) return { ytm: null };
    const path = (ratePath || []).map(p => [parseD(p.date), Number(p.rate)]).filter(p => !isNaN(p[0]) && isFinite(p[1]) && p[1] >= 0).sort((a, b) => a[0] - b[0]);
    if (!path.length || path[0][0] > t0) return { ytm: null };
    const keyAt = d => { let r = null; for (const [pd, pr] of path) { if (pd <= d) r = pr; else break; } return r; };
    const amortT = amorts.map(([d, v]) => [parseD(d), v]);
    const projected = (start, end) => {
      const cuts = [...new Set([start, end, ...path.map(p => p[0]).filter(d => start < d && d < end), ...amortT.map(a => a[0]).filter(d => start < d && d < end)])].sort((a, b) => a - b);
      let total = 0;
      for (let i = 0; i + 1 < cuts.length; i++) { const a = cuts[i], b = cuts[i + 1], rate = keyAt(a); if (rate == null) return null; const nominal = face - amortT.filter(x => x[0] <= a).reduce((s, x) => s + x[1], 0); total += nominal * (rate + qm) / 100 * ((b - a) / 864e5) / 365; }
      return total;
    };
    if (!BM.couponChain(bz.coupons.map(c => [c.date, c.startdate]), t0, amorts[amorts.length - 1][0])) return { ytm: null };
    const proj = []; let prev = null, projectedCount = 0;
    for (const c of [...bz.coupons].sort((a, b) => (a.date || "") < (b.date || "") ? -1 : 1)) {
      const cd = parseD(c.date); if (isNaN(cd)) continue;
      if (cd <= t0) { prev = cd; continue; }
      let val;
      if (c.value != null) val = c.value;
      else {
        const start = c.startdate ? parseD(c.startdate) : prev;
        if (start == null || isNaN(start) || start >= cd) return { ytm: null };
        val = projected(Math.max(start, t0), cd);
        if (val == null) return { ytm: null };
        if (start < t0) val += accint || 0;
        projectedCount++;
      }
      proj.push({ date: c.date, value: val }); prev = cd;
    }
    if (!proj.length) return { ytm: null };
    const cf = { coupons: proj, amortizations: amorts.map(([d, v]) => ({ date: d, value: v })), matdate: ref.matdate, face, accint, settledate: iso(t0) };
    const y = ytmFromPrice(cleanPx, cf);
    const solved = BM.solve(proj.map(c => [c.date, c.value]).concat(amorts), cleanPx / 100 * face + (accint || 0), t0);
    const res = { ytm: y, duration: solved ? solved[1] : null, coupons_projected: projectedCount, settledate: iso(t0),
      assumptions: "CBR_RATE scenario, simple daily accrual ACT/365; no fixing lag or cap/floor modelled" };
    if (y != null && res.duration) {
      try {
        const g = gcurveYield(res.duration, await F2.gcurve()); if (g != null) res.gspread = pyRound((y - g) * 100);
        const ro = nearestOfz(res.duration, await F2.ofzBenchmarks()); if (ro) res.ofz = pyRound((y - ro.ytm) * 100);
      } catch (e) { /* спреды необязательны */ }
    }
    return res;
  };

  // ---------- ликвидность ----------
  F2.liquidityDetail = async function (isin) {
    const ref = await F2.resolveSecurity(isin);
    const till = today(), frm = iso(parseD(till) - 200 * 864e5);
    const rows = (await F2.priceHistory(ref.secid || isin, ref.board, frm, till)).filter(r => r.date);
    const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
    const window = n => {
      const cutoff = iso(parseD(till) - n * 864e5), w = rows.filter(r => r.date >= cutoff);
      const traded = w.filter(r => (r.value || 0) > 0 || (r.numtrades || 0) > 0), vals = traded.map(r => r.value).filter(Boolean), nts = traded.map(r => r.numtrades).filter(Boolean);
      return { avg_value: vals.length ? Math.round(mean(vals)) : 0, median_value: vals.length ? Math.round(F2.median(vals)) : 0, days_traded: traded.length, sessions: w.length, trades_per_day: nts.length ? Math.round(mean(nts)) : 0 };
    };
    const d30 = window(30), d180 = window(180), avg = d30.avg_value, dt = d30.days_traded;
    return { isin, liq_class: avg >= 30e6 && dt >= 18 ? "Высокая" : avg >= 3e6 && dt >= 7 ? "Средняя" : "Низкая", d30, d180 };
  };

  // ---------- история карточки: YTM, цена, G-спред к КБД, спред к ОФЗ ----------
  const ofzHist = new Map();
  const ofzYieldHist = (secid, frm) => { const k = secid + "|" + frm; if (!ofzHist.has(k)) { const p = F2.yieldHistory(secid, "TQOB", frm, today()).then(rows => rows.map(r => ({ date: r.date, yield_close: r.yield_close }))); ofzHist.set(k, p); p.catch(() => ofzHist.delete(k)); } return ofzHist.get(k); };
  F2.issueHistory = async function (isin, frm, qm) {
    const ref = await F2.resolveSecurity(isin);
    const histId = ref.secid || isin, T = today();
    frm = frm || "2012-01-01";
    const bt = (ref.bond_type || "").toLowerCase();
    const isFloat = !!ref.coupon_benchmark || ["флоат", "плава", "перемен", "-пк"].some(m => bt.includes(m));
    const [yh, ph] = await Promise.all([isFloat ? [] : F2.yieldHistory(histId, ref.board, frm, T), F2.priceHistory(histId, ref.board, frm, T)]);
    const pricePts = ph.filter(r => r.close != null && r.close > 10 && r.close < 200).map(r => [r.date, r.close]);
    if (isFloat) {
      const smPts = [], mat = ref.matdate;
      if (qm != null && mat && mat !== "0000-00-00") {
        let offers = [];
        try { offers = (await F2.bondization(histId)).offers.filter(o => o.date && !o.date.startsWith("0000") && o.date < mat).map(o => o.date).sort(); } catch (e) { offers = []; }
        for (const [d, px] of pricePts) {
          const horizon = offers.find(o => o > d) || mat, yrs = daysBetween(d, horizon) / 365;
          if (!(yrs > 0)) continue;
          const sm = simpleMarginBp(px, yrs, qm);
          if (sm != null && sm > -3000 && sm < 20000) smPts.push([d, sm]);
        }
      }
      return { isin, name: ref.shortname, kind: "floater", ytm: [], price: pricePts, simple_margin: smPts, gspread_kbd: [], spread_ofz: [], benchmark_ofz: null };
    }
    const ytmPts = yh.filter(r => r.yield_close != null && r.yield_close > 1 && r.yield_close < 60).map(r => [r.date, r.yield_close]);
    const hasMoex = yh.some(r => r.gspread != null);
    const snaps = hasMoex ? null : (await F2.tryLoad("kbd_history.json")) || [];
    const gk = [];
    for (const r of yh) {
      const y = r.yield_close, dur = r.duration;
      if (y == null || !(y > 3 && y < 60)) continue;
      if (hasMoex) { const g = r.gspread; if (g != null && g > -800 && g < 20000) gk.push([r.date, pyRound(g)]); continue; }
      if (dur == null) continue;
      const kb = kbdOn(snaps, r.date, dur / 365);
      if (kb != null) gk.push([r.date, pyRound((y - kb) * 100)]);
    }
    let curDur = null; for (let i = yh.length - 1; i >= 0; i--) if (yh[i].duration) { curDur = yh[i].duration; break; }
    const bench = await F2.ofzBenchmarks();
    const refOfz = curDur ? nearestOfz(curDur / 365, bench, "duration") : nearestOfz(yearsTo(ref.matdate), bench);
    const go = []; let ofzMeta = null;
    if (refOfz) {
      ofzMeta = { secid: refOfz.secid, name: refOfz.name, ytm: d2(refOfz.ytm) };
      try { const omap = new Map((await ofzYieldHist(refOfz.secid, frm)).filter(r => r.yield_close != null).map(r => [r.date, r.yield_close])); for (const [d, y] of ytmPts) if (omap.has(d)) go.push([d, pyRound((y - omap.get(d)) * 100)]); } catch (e) { /* бенчмарк необязателен */ }
    }
    return { isin, name: ref.shortname, kind: "fixed", ytm: ytmPts, price: pricePts, gspread_kbd: gk, spread_ofz: go, benchmark_ofz: ofzMeta };
  };

  // ---------- средние спреды пиров (по эмитенту — в браузере, по рейтингу — из снимка) ----------
  const spreadCache = new Map();
  async function spreadSeries(isin, isFloat, qm, kbd, frm) {
    const key = `${isin}|${isFloat}|${qm}|${frm}`;
    if (spreadCache.has(key)) return spreadCache.get(key);
    const p = (async () => {
      let ref; try { ref = await F2.resolveSecurity(isin); } catch (e) { return []; }
      const histId = ref.secid || isin, T = today(), out = [];
      if (isFloat) {
        const mat = ref.matdate; if (!qm || !mat || mat === "0000-00-00") return [];
        for (const r of await F2.priceHistory(histId, ref.board, frm, T)) {
          const px = r.close; if (px == null || !(px > 10 && px < 200)) continue;
          const yrs = daysBetween(r.date, mat) / 365; if (!(yrs > 0)) continue;
          const sm = simpleMarginBp(px, yrs, qm); if (sm != null && sm > -3000 && sm < 20000) out.push([r.date, sm]);
        }
        return out;
      }
      for (const r of await F2.yieldHistory(histId, ref.board, frm, T)) {
        const y = r.yield_close, dur = r.duration; if (y == null || !(y > 3 && y < 60)) continue;
        const g = r.gspread;
        if (g != null) { if (g > -800 && g < 20000) out.push([r.date, pyRound(g)]); continue; }
        if (dur == null || !kbd) continue;
        const kb = kbdOn(kbd, r.date, dur / 365); if (kb != null) out.push([r.date, pyRound((y - kb) * 100)]);
      }
      return out;
    })();
    spreadCache.set(key, p); p.catch(() => spreadCache.delete(key));
    return p;
  }
  F2.peersHistory = async function (isin) {
    isin = (isin || "").trim().toUpperCase();
    const r0 = await F2.row(isin);
    if (!r0) return { kind: null, issuer: [], rating: [], issuer_n: 0, rating_n: 0, bucket: null };
    const U = await F2.universe();
    const rows = U.rows.filter(r => (r.numtrades || 0) > 0);
    const isFloat = r0.kind === "floater", ccy = r0.currency || "RUB", bucket = r0.agency_bucket || r0.rating_bucket || null, key0 = F2.ikey(r0);
    const issuerBonds = rows.filter(r => r.isin !== isin && r.kind === r0.kind && key0 && F2.ikey(r) === key0 && (r.currency || "RUB") === ccy)
      .sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 12);
    const frm0 = r0.issue_date && /^\d{4}-\d{2}-\d{2}$/.test(r0.issue_date) && r0.issue_date > "2012-01-01" ? r0.issue_date : "2012-01-01";
    const [kbd, peers] = await Promise.all([F2.tryLoad("kbd_history.json"), F2.tryLoad("peer_spreads.json")]);
    const series = {};
    await Promise.all(issuerBonds.map(async r => { const qm = r.float_add != null ? r.float_add : r.float_qm; series[r.isin] = await spreadSeries(r.isin, isFloat, qm, kbd || [], frm0); }));
    const need = Math.min(2, issuerBonds.length), acc = new Map();
    for (const r of issuerBonds) for (const [d, v] of series[r.isin] || []) { if (!acc.has(d)) acc.set(d, []); acc.get(d).push(v); }
    const issuerAvg = [...acc].filter(([, vs]) => vs.length >= need).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, vs]) => [d, pyRound(F2.median(vs))]);
    const issuerUsed = issuerBonds.filter(r => (series[r.isin] || []).length).map(r => r.name || r.isin);
    const pk = peers && peers[`${r0.kind}|${bucket}|${ccy}`];
    const ratingAvg = pk ? pk.series.filter(p => p[0] >= frm0) : [];
    return { kind: r0.kind, bucket, currency: ccy, issuer: issuerAvg, rating: ratingAvg, issuer_n: issuerUsed.length, rating_n: pk ? pk.n : 0,
      issuer_names: issuerUsed, rating_names: pk ? pk.names : [] };
  };

  // ---------- график амортизаций и оферт ----------
  F2.schedule = async function (isin) {
    const ref = await F2.resolveSecurity(isin);
    const bz = await F2.bondization(ref.secid);
    const T = today(), amorts = bz.amortizations.filter(a => (a.valueprc || 0) < 100), fut = amorts.filter(a => (a.date || "") >= T);
    return { isin, amortizing: amorts.length > 1, amortizations: amorts, offers: bz.offers, next_amort: fut[0] || null };
  };
  F2.volumes = async function (isin) {
    const row = await F2.row(isin);
    if (!row) return null;
    const valid = v => typeof v === "number" && isFinite(v) && v >= 0;
    const count = valid(row.issuesize) ? row.issuesize : null, face = valid(row.facevalue) ? row.facevalue : null;
    let orig = null;
    try { const ref = await F2.resolveSecurity(isin); orig = ref.initialfacevalue; } catch (e) { orig = null; }
    if (!valid(orig) || orig === 0) orig = null;
    return { isin: row.isin, currency: row.currency || "RUB", issuesize: count, facevalue: face, initialfacevalue: orig,
      issue_volume: count != null && face != null ? count * face : null, initial_issue_volume: count != null && orig != null ? count * orig : null,
      initial_volume_basis: "ISSUESIZE × INITIALFACEVALUE; тот же объём облигаций до амортизации, не история доразмещений или выкупов",
      source: `https://iss.moex.com/iss/securities/${row.secid || row.isin}.json` };
  };

  // ---------- полная доходность за период ----------
  const mmCache = new Map();
  async function moneyMarketSeries(frm, till) {
    const k = frm + "|" + till; if (mmCache.has(k)) return mmCache.get(k);
    const p = (async () => {
      let ph = []; try { ph = (await F2.priceHistory("LQDT", "TQTF", frm, till)).filter(r => r.close && r.date); } catch (e) { ph = []; }
      let out = [];
      if (ph.length >= 2 && ph[0].close) {
        const p0 = ph[0].close; out = ph.map(r => [r.date, d2((r.close / p0 - 1) * 100)]);
        if (out[out.length - 1][0] < till) {
          const kr = await F2.tryLoad("key_rate.json"); const daily = ((kr && kr.rate) || 14) / 100 / 365;
          let factor = 1 + out[out.length - 1][1] / 100, d = parseD(out[out.length - 1][0]) + 864e5; const end = parseD(till);
          while (d <= end) { factor *= 1 + daily; out.push([iso(d), d2((factor - 1) * 100)]); d += 864e5; }
        }
      }
      return out;
    })();
    mmCache.set(k, p); return p;
  }
  F2.totalReturn = async function (isin, frm, till) {
    const ref = await F2.resolveSecurity(isin);
    const histId = ref.secid || isin, board = ref.board, face = ref.facevalue || 1000;
    till = till || today(); frm = frm || iso(parseD(till) - 365 * 864e5);
    const ph = (await F2.priceHistory(histId, board, frm, till)).filter(r => r.close != null && r.close > 10 && r.close < 200 && r.date);
    if (ph.length < 2) return { isin, detail: "недостаточно истории цен" };
    const bt = (ref.bond_type || "").toLowerCase();
    const isLinker = (bt.includes("индекс") || (ref.secid || "").startsWith("SU52")) && ph.some(r => r.facevalue);
    let bz; try { bz = await F2.bondization(ref.secid); } catch (e) { bz = { coupons: [], amortizations: [] }; }
    const first = ph[0].date, last = ph[ph.length - 1].date;
    let res;
    if (isLinker) {
      const rub = r => r.close / 100 * (r.facevalue || face) + (r.accint || 0), cl = r => r.close / 100 * (r.facevalue || face);
      const v0 = rub(ph[0]); if (v0 <= 0) return { isin, detail: "нулевая стартовая цена" };
      const events = [];
      for (const c of bz.coupons) if (c.date && c.value != null && first < c.date && c.date <= last) events.push({ date: c.date, type: "coupon", amount: d2(c.value) });
      for (const a of bz.amortizations) if (a.date && a.value != null && first < a.date && a.date <= last) events.push({ date: a.date, type: "amortization", amount: d2(a.value) });
      events.sort((a, b) => a.date < b.date ? -1 : 1);
      const series = ph.map(r => { const paid = events.filter(e => e.date <= r.date).reduce((s, e) => s + e.amount, 0); return [r.date, d2((rub(r) + paid - v0) / v0 * 100)]; });
      const couponCash = events.filter(e => e.type === "coupon").reduce((s, e) => s + e.amount, 0), amortCash = events.filter(e => e.type !== "coupon").reduce((s, e) => s + e.amount, 0);
      const vn = rub(ph[ph.length - 1]), accrGain = (ph[ph.length - 1].accint || 0) - (ph[0].accint || 0), income = couponCash + accrGain;
      res = { isin, name: ref.shortname, from: first, till: last, total_return_pct: d2((vn + couponCash + amortCash - v0) / v0 * 100),
        capital_pct: d2((cl(ph[ph.length - 1]) + amortCash - cl(ph[0])) / v0 * 100), price_change_pct: d2((cl(ph[ph.length - 1]) - cl(ph[0])) / v0 * 100),
        coupon_income: d2(income), income_pct: d2(income / v0 * 100), amort_return: d2(amortCash), amort_pct: d2(amortCash / v0 * 100), series, events, indexed: true };
    } else {
      let originalFace = ref.initialfacevalue || (bz.coupons.concat(bz.amortizations).find(x => x.initialfacevalue) || {}).initialfacevalue || null;
      if (!originalFace) for (const r of ph) { const repaid = bz.amortizations.filter(a => a.date && a.date <= r.date).reduce((s, a) => s + (a.valueprc || 0), 0); if (r.facevalue && repaid < 100) { originalFace = r.facevalue / (1 - repaid / 100); break; } }
      originalFace = originalFace || face;
      const amortSched = bz.amortizations.filter(a => a.date).map(a => [a.date, a.value != null ? a.value / originalFace * 100 : (a.valueprc || 0)]).sort((a, b) => a[0] < b[0] ? -1 : 1);
      const faceFrac = d => Math.max(0, 1 - amortSched.filter(x => x[0] <= d).reduce((s, x) => s + x[1], 0) / 100);
      const cleanPct = r => r.close * (r.facevalue != null ? r.facevalue / originalFace : faceFrac(r.date));
      const allCpns = bz.coupons.filter(c => c.date && c.value != null).map(c => [c.date, c.value / originalFace * 100, c.startdate]).sort((a, b) => a[0] < b[0] ? -1 : 1);
      const accruedPct = d => {
        const nxt = allCpns.find(c => c[0] > d); if (!nxt) return 0;
        let prev = null; for (const c of allCpns) { if (c[0] <= d) prev = c[0]; else break; }
        if (!(nxt[2] || prev)) return 0;
        const start = parseD(nxt[2] || prev), end = parseD(nxt[0]), cur = parseD(d); if ([start, end, cur].some(isNaN)) return 0;
        const span = (end - start) / 864e5 || 1; return nxt[1] * Math.min(1, Math.max(0, (cur - start) / 864e5 / span));
      };
      const rowAcc = r => ["RUB", "SUR"].includes((ref.faceunit || "").toUpperCase()) && r.accint != null ? r.accint / originalFace * 100 : accruedPct(r.date);
      const dirtyPct = r => cleanPct(r) + rowAcc(r);
      const c0 = cleanPct(ph[0]), cn = cleanPct(ph[ph.length - 1]), p0 = dirtyPct(ph[0]), pn = dirtyPct(ph[ph.length - 1]);
      if (p0 <= 0) return { isin, detail: "нулевая стартовая цена" };
      const events = [];
      for (const c of bz.coupons) { if (!(c.date && first < c.date && c.date <= last) || c.value == null) continue; const pct = c.value / originalFace * 100; events.push({ date: c.date, type: "coupon", pct: Math.round(pct * 1e4) / 1e4, amount: d2(c.value) }); }
      for (const a of bz.amortizations) { const prc = a.value != null ? a.value / originalFace * 100 : a.valueprc; if (!(a.date && first < a.date && a.date <= last) || !prc) continue; events.push({ date: a.date, type: "amortization", pct: Math.round(prc * 1e4) / 1e4, amount: d2(a.value != null ? a.value : prc * originalFace / 100) }); }
      events.sort((a, b) => a.date < b.date ? -1 : 1);
      const series = ph.map(r => { const paid = events.filter(e => e.date <= r.date).reduce((s, e) => s + e.pct, 0); return [r.date, d2((dirtyPct(r) + paid - p0) / p0 * 100)]; });
      const couponPct = events.filter(e => e.type === "coupon").reduce((s, e) => s + e.pct, 0), amortPct = events.filter(e => e.type !== "coupon").reduce((s, e) => s + e.pct, 0);
      const accrGain = (pn - cn) - (p0 - c0), incomeFace = couponPct + accrGain;
      res = { isin, name: ref.shortname, from: first, till: last, total_return_pct: d2((pn + couponPct + amortPct - p0) / p0 * 100), capital_pct: d2((cn + amortPct - c0) / p0 * 100),
        price_change_pct: d2((cn - c0) / p0 * 100), coupon_income: d2(incomeFace * originalFace / 100), income_pct: d2(incomeFace / p0 * 100),
        amort_return: d2(amortPct * originalFace / 100), amort_pct: d2(amortPct / p0 * 100), series, events, initial_face: originalFace,
        start_dirty_value: Math.round(p0 * originalFace / 100 * 1e6) / 1e6, end_dirty_value: Math.round(pn * originalFace / 100 * 1e6) / 1e6 };
    }
    // надбавки сервера: дни, годовая, линия денежного рынка (LQDT) на датах бумаги
    const annualize = (pct, days) => pct == null || !days || days <= 0 ? null : d2((Math.pow(1 + pct / 100, 365 / days) - 1) * 100);
    const days = daysBetween(res.from, res.till);
    res.days = days; res.annualized_pct = annualize(res.total_return_pct, days);
    let mm = await moneyMarketSeries(res.from, res.till);
    if (mm.length) { let j = 0, lastv = 0; const aligned = []; for (const [bd] of res.series) { while (j < mm.length && mm[j][0] <= bd) { lastv = mm[j][1]; j++; } aligned.push([bd, lastv]); } mm = aligned; }
    res.mm_series = mm;
    if (mm.length) { res.mm_total_pct = mm[mm.length - 1][1]; const md = daysBetween(mm[0][0], mm[mm.length - 1][0]) || days; res.mm_annualized_pct = annualize(mm[mm.length - 1][1], md); }
    return res;
  };

  // ---------- КБД + ОФЗ-ПД на дату (для сравнения кривых на вкладке ОФЗ) ----------
  F2.ofzCurveOn = async function (d) {
    const kbd = await F2.zcycOn(d);
    const on = kbd ? kbd.tradedate : d;
    let out = [], start = 0;
    for (;;) {
      const rows = block(await iss("history/engines/stock/markets/bonds/boards/TQOB/securities.json", { date: on, "iss.only": "history", start, "history.columns": "SECID,SHORTNAME,CLOSE,YIELDCLOSE,DURATION,MATDATE,NUMTRADES" }), "history");
      out = out.concat(rows); if (rows.length < 100) break; start += 100; if (start > 2000) break;
    }
    const ofz = [];
    for (const r of out) { const sec = r.SECID || "", y = num(r.YIELDCLOSE), dur = num(r.DURATION); if (sec.startsWith("SU26") && y && y > 0 && y < 60 && dur && dur > 0) ofz.push({ secid: sec, name: r.SHORTNAME, ytm: y, duration_years: Math.round(dur / 365 * 1000) / 1000, price: num(r.CLOSE) }); }
    return { date: d, kbd, ofz, roisfix: null, swaps: { status: "unavailable", curves: [] } };
  };

  // ---------- выплаты номинала и купонов по выпускам эмитента ----------
  F2.redemptionEvents = async function (isins) {
    const T = today(), U = await F2.universe();
    const rows = isins.map(i => U.byIsin.get(i.trim().toUpperCase())).filter(Boolean).sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 80);
    const fxFor = async ccy => { if (!ccy || ccy === "RUB") return 1; const fx = await F2.tryLoad("fx_rates.json"); return (fx && fx[ccy]) || 1; };
    const one = async sn => {
      if (!sn.issuesize) return [];
      const n = sn.issuesize, kind = sn.kind === "floater" ? "floater" : "fixed", face = sn.facevalue;
      if ((sn.matdate || "").startsWith("0000")) return face ? [{ date: null, amount: n * face * (await fxFor(sn.currency || "RUB")), type: "perpetual", isin: sn.isin, name: sn.name, kind }] : [];
      const offer = sn.buyback_date && sn.buyback_date >= T && (!sn.matdate || sn.buyback_date < sn.matdate) ? sn.buyback_date : null;
      let bz; try { bz = await F2.bondization(sn.secid || sn.isin); } catch (e) { bz = { coupons: [], amortizations: [] }; }
      const amAll = bz.amortizations.filter(a => a.date), fut = amAll.filter(a => a.date >= T).sort((a, b) => a.date < b.date ? -1 : 1);
      let scale = 1;
      if (fut.length && face && fut.every(a => a.value)) { const sv = fut.reduce((s, a) => s + a.value, 0); const ok = x => Math.abs(x / face - 1) <= 0.02; if (sv > 0 && !ok(sv)) scale = face / sv; }
      const ev = [], fxc = await fxFor(sn.currency || "RUB");
      if (!fut.length) { const dt = offer || sn.matdate; if (face && dt && dt >= T && !dt.startsWith("0000")) ev.push({ date: dt, amount: n * face * fxc, type: offer ? "offer" : "maturity" }); }
      else {
        let afterOffer = 0; const last = fut[fut.length - 1].date;
        for (const a of fut) { const v = (a.value_rub || a.value || 0) * n * scale; if (offer && a.date > offer) { afterOffer += v; continue; } ev.push({ date: a.date, amount: v, pct: a.valueprc, type: a.date === last ? "maturity" : "amort" }); }
        if (offer && afterOffer) ev.push({ date: offer, amount: afterOffer, type: "offer" });
        if (scale !== 1) ev.forEach(e => { e.rescaled = true; });
      }
      // купоны до горизонта: известные — по графику, неизвестные (флоатер) — как последний известный, с пометкой
      let lastKnown = null;
      for (const c of bz.coupons.filter(c => c.date).sort((a, b) => a.date < b.date ? -1 : 1)) {
        if (c.value != null) lastKnown = c.value;
        if (c.date < T || (offer && c.date > offer) || (sn.matdate && c.date > sn.matdate)) continue;
        const amt = c.value != null ? c.value : lastKnown;
        if (amt) ev.push({ date: c.date, amount: amt * n * fxc, type: "coupon", projected: c.value == null });
      }
      return ev.filter(e => e.amount > 0).map(e => ({ ...e, isin: sn.isin, name: sn.name, kind }));
    };
    const out = (await Promise.all(rows.map(one))).flat();
    return out.sort((a, b) => (a.date || "9999") < (b.date || "9999") ? -1 : 1);
  };
})();
