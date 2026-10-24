/* Финансы 2 · перехват запросов к серверу BondsAI/StockAI.
   Страница лежит на GitHub Pages без бэкенда: все fetch('/api/…') из app.js и stock-*.js
   обрабатываются здесь — из статических снимков (ветка fin2-data), расчётов в браузере
   (fin2-core.js) и запросов к Мосбирже напрямую (fin2-moex.js). Абсолютные пути вида
   '/stock-catalog.json' переводятся в относительные (сайт живёт в подпапке /fin2/). */
"use strict";
(function () {
  const F2 = window.FIN2 = window.FIN2 || {};
  const realFetch = window.fetch.bind(window);
  F2.realFetch = realFetch;
  const J = (obj, status) => new Response(JSON.stringify(obj === undefined ? null : obj), { status: status || 200, headers: { "Content-Type": "application/json" } });
  const E = (status, detail) => J({ detail: detail || "Not found" }, status);
  const isin = s => String(s || "").trim().toUpperCase();

  // ---- статические файлы StockAI, у которых есть «живая» версия в снимке ----
  const STOCK_LIVE = {
    "stock-market.json": () => F2.tryLoad("stock_market_map.json").then(d => d && d.items ? d : F2.load("stock-market.json", { base: F2.OWN_BASE })),
    "stock-terminal-data.json": async () => {
      const base = await F2.load("stock-terminal-data.json", { base: F2.OWN_BASE });
      const q = await F2.tryLoad("stock_quotes.json");
      if (!q || !q.q) return base;
      const out = { ...base, asof: q.asof || base.asof, market_fetched_at: q.fetched_at, live_quotes: true };
      out.items = (base.items || []).map(it => {
        const l = q.q[it.ticker];
        if (!l || l.price == null) return it;
        return { ...it, price: l.price, price_date: q.asof || it.price_date, change: l.change != null ? l.change : it.change,
          cap: l.cap != null ? l.cap : it.cap, turnover: l.turnover != null ? l.turnover : it.turnover,
          quote_time: l.quote_time || it.quote_time, cap_time: l.cap_time || it.cap_time };
      });
      return out;
    },
  };

  // ---- маршруты /api/… ----
  const PRIVATE = ["/api/clients", "/api/portfolio", "/api/reports", "/api/builder", "/api/portfolios"];
  async function route(method, path, params, body) {
    if (PRIVATE.some(p => path === p || path.startsWith(p))) return E(404);
    const q = k => params.get(k);
    const qn = (k, d) => { const v = params.get(k); return v == null || v === "" ? d : Number(v); };
    let m;
    // ---- скринер и строки ----
    if (path === "/api/universe/facets") return J(await F2.load("facets.json"));
    if (path === "/api/universe") return J(await F2.query(params));
    if (path === "/api/universe/one") { const r = await F2.one(q("isin")); return r ? J(r) : E(404, `${q("isin")} not in snapshot`); }
    if (path === "/api/universe/suggest") return J(await F2.suggest(q("q") || ""));
    if (path === "/api/universe/similar") return J(await F2.similar(isin(q("isin"))));
    if (path === "/api/universe/volumes") { const r = await F2.volumes(isin(q("isin"))); return r ? J(r) : E(404, "Выпуск отсутствует в снимке"); }
    if (path === "/api/universe/rating_curve") return J(await F2.ratingCurve(isin(q("isin"))));
    if (path === "/api/universe/refresh") {                       // кнопка «Обновить рынок»: свежий снимок с GitHub
      const U = await F2.reloadUniverse();
      return J({ count: U.count, at: U.updated_at, boards: [], failed_boards: [] });
    }
    if (path === "/api/movers") return J(await F2.movers(qn("limit", 20), qn("min_turnover", 0)));
    if (path === "/api/ideas") return J(await F2.ideas(qn("limit", 30), qn("min_turnover", 0)));
    if (path === "/api/rating_curves") return J(await F2.load("rating_curves.json"));
    if (path === "/api/rating_curves/history") return J((await F2.tryLoad("rating_curves_history.json")) || {});
    if (path === "/api/placements") return J(await F2.placements(q("mode") || "current", qn("days", 120)));
    if (path === "/api/rating_actions") { const d = await F2.load("rating_actions.json"); const lim = qn("limit", 120); return J({ actions: (d.actions || []).slice(0, lim), total: d.total }); }
    if (path === "/api/issuers/credit") return J((await F2.tryLoad("issuers_credit.json")) || { issuers: [], rows: [] });
    if ((m = /^\/api\/issuers\/credit\/(.+)$/.exec(path))) return E(404, "нет данных");
    if (path === "/api/issuer") { const r = await F2.issuerPage(decodeURIComponent(q("q") || "")); return r ? J(r) : E(404, `эмитент не найден: ${q("q")}`); }
    if (path === "/api/issuer_redemptions") {
      const list = method === "POST" ? ((body && body.isins) || []) : (q("isins") || "").split(",");
      return J({ events: await F2.redemptionEvents(list.map(String).filter(Boolean).slice(0, 1500)) });
    }
    // ---- рейтинги ----
    if ((m = /^\/api\/bonds\/([^/]+)\/ratings$/.exec(path))) return J(await F2.bondRatings(m[1]));
    if ((m = /^\/api\/ratings\/emitent\/([^/]+)$/.exec(path))) return J(await F2.emitentRatings(m[1]));
    // ---- ОФЗ, кривые, макро ----
    if (path === "/api/ofz_curve") { const d = q("date"); if (d) { if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return E(400, "Дата в формате ГГГГ-ММ-ДД"); return J(await F2.ofzCurveOn(d)); } return J(await F2.load("ofz_curve.json")); }
    if (path === "/api/instrument/gcurve") return J(await F2.gcurve());
    if (path === "/api/auctions") return J((await F2.tryLoad("auctions.json")) || { auctions: [] });
    if (path === "/api/ofz_redemption") return J(await F2.load("ofz_redemption.json"));
    if (path === "/api/cbr_meetings") return J(await F2.cbrMeetings(qn("years", 3)));
    if (path === "/api/macro") return J(await F2.load("macro.json"));
    if (path === "/api/bank_profits") return J(await F2.load("bank_profits.json"));
    if (path === "/api/bank_normatives") return J(await F2.load("bank_normatives.json"));
    if (path === "/api/bond_indices" || path === "/api/equity_indices") {
      const kind = path.includes("bond") ? "bond" : "equity";
      const d = await F2.tryLoad(`indices/${kind}_${q("group") || (kind === "bond" ? "fixed" : "main")}_${q("period") || "1y"}.json`);
      return d ? J(d) : E(503, "Снимок индексов ещё не собран");
    }
    if (path === "/api/index_composition") { const d = await F2.tryLoad(`composition/${(q("asset") || "bonds").toLowerCase()}_${(q("code") || "").toUpperCase()}.json`); return d ? J(d) : E(404, "Состав индекса ещё не собран"); }
    if (path === "/api/stock_market_map") { const d = await F2.tryLoad("stock_market_map.json"); return d && d.items ? J(d) : J(await F2.load("stock-market.json", { base: F2.OWN_BASE })); }
    // ---- секторы ----
    if ((m = /^\/api\/sector\/(developers|leasing|subfed|utilities|retail)(\/methodology)?$/.exec(path))) {
      if (m[2]) { const d = await F2.tryLoad(`sector_${m[1]}_methodology.json`); return J(d || { text: "" }); }
      return J(await F2.load(`sector_${m[1]}.json`));
    }
    if (path === "/api/sector_index") return J((await F2.tryLoad("sector_index.json")) || {});
    // ---- карточка выпуска: Мосбиржа из браузера ----
    if ((m = /^\/api\/instrument\/([^/]+)\/(history|peers_history|schedule|total_return|ytm|liquidity|news)$/.exec(path))) {
      const i = isin(m[1]), what = m[2];
      try {
        if (what === "history") { const r = await F2.row(i); const qm = r ? (r.float_add != null ? r.float_add : r.float_qm) : null; return J(await F2.issueHistory(i, q("frm") || undefined, qm)); }
        if (what === "peers_history") return J(await F2.peersHistory(i));
        if (what === "schedule") return J(await F2.schedule(i));
        if (what === "total_return") return J(await F2.totalReturn(i, q("frm") || undefined, q("till") || undefined));
        if (what === "liquidity") return J(await F2.liquidityDetail(i));
        if (what === "news") return J(await F2.news(i));
        if (what === "ytm") {
          const price = qn("price"), r = await F2.row(i);
          if (r && r.kind === "floater") return J({ price, ytm: null, ytp: null, offer: null, note: "Флоатер: YTM не считается (кроме сценария в песочнице)." });
          return J({ price, ...(await F2.ytmAtPrice(i, price, r ? r.accint : null)) });
        }
      } catch (e) { console.warn("fin2", path, e); return E(502, "Мосбиржа временно недоступна"); }
    }
    if ((m = /^\/api\/instrument\/([^/]+)$/.exec(path))) { const r = await F2.one(m[1]); return r ? J(r) : E(404); }
    if ((m = /^\/api\/moex\/(history|yields)\/([^/]+)$/.exec(path))) {
      try {
        const ref = await F2.resolveSecurity(m[2]);
        const frm = q("frm") || "2025-01-01", till = q("till") || F2.today();
        return J(m[1] === "history" ? await F2.priceHistory(ref.secid || m[2], ref.board, frm, till) : await F2.yieldHistory(ref.secid || m[2], ref.board, frm, till));
      } catch (e) { return E(502, "Мосбиржа временно недоступна"); }
    }
    // ---- песочница ----
    if (path === "/api/model/emission") return J(F2.modelEmission(qn("coupon"), qn("freq", 2), qn("years", 3), qn("price", 100)));
    if (path === "/api/model/coupon") return J(F2.couponForYtm(qn("ytm"), qn("freq", 2), qn("years", 3), qn("price", 100)));
    if (path === "/api/model/floater_scenario") {
      const b = body || {};
      if (!b.isin || b.price == null) return E(400, "isin and price required");
      try { return J(await F2.floaterScenario(isin(b.isin), b.price, b.rate_path || [], await F2.row(b.isin))); }
      catch (e) { return E(e.status || 502, e.status ? e.message : "Источник данных временно недоступен"); }
    }
    // ---- служебное ----
    if (path === "/api/visit") return J({ ok: true });
    if (path === "/api/visits") return E(404);
    if (path === "/api/update_status") return J((await F2.tryLoad("status.json")) || {});
    if (path === "/api/agencies/status") return J({ agencies: {}, job: {} });
    return E(404, "Нет такого адреса в статической версии: " + path);
  }

  F2.reloadUniverse = async function () {
    F2.clearCache && F2.clearCache();
    return F2.universe();
  };

  // ---- перехват fetch ----
  window.fetch = function (input, init) {
    let url = typeof input === "string" ? input : (input && input.url) || String(input);
    const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
    if (/^https?:\/\//i.test(url) || url.startsWith("//") || url.startsWith("data:") || url.startsWith("blob:")) return realFetch(input, init);
    if (url.startsWith("/api/")) {
      const u = new URL(url, "http://x/");
      return (async () => {
        let body = null;
        if (init && init.body && typeof init.body === "string") { try { body = JSON.parse(init.body); } catch (e) { body = null; } }
        try { return await route(method, u.pathname, u.searchParams, body); }
        catch (e) { console.warn("fin2 api", u.pathname, e); return E(e && e.status || 500, (e && e.message) || "error"); }
      })();
    }
    if (url.startsWith("/")) {                       // абсолютные пути StockAI → относительно страницы
      const rel = url.replace(/^\/+/, "");
      const file = rel.split("?")[0];
      if (STOCK_LIVE[file]) return STOCK_LIVE[file]().then(d => J(d)).catch(() => realFetch(F2.OWN_BASE + rel, init));
      return realFetch(F2.OWN_BASE + rel, init);
    }
    return realFetch(input, init);
  };
})();
