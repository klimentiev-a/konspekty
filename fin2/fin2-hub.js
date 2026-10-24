/* Финансы 2 · связка с Hub: ссылки по вкладкам (#auctions, #macro…), кнопка «назад»,
   подпись о свежести снимка, сервис-воркер Hub. app.js не трогаем — оборачиваем его render(). */
"use strict";
(function () {
  const F2 = window.FIN2 = window.FIN2 || {};
  const KNOWN = ["screener", "marketmap", "movers", "ideas", "sandbox", "placements", "auctions", "macro", "indices", "issuers"];
  // вкладка из адреса: fin2/index.html#auctions, #issue=RU000A… (карточка выпуска), #issuer=… (эмитент)
  function applyHash() {
    const h = (location.hash || "").slice(1);
    if (!h || typeof window.render !== "function") return false;
    const m = /^(issue|issuer)=(.+)$/.exec(h);
    try {
      if (m && m[1] === "issue" && typeof openIssue === "function") { openIssue(decodeURIComponent(m[2])); return true; }
      if (m && m[1] === "issuer" && typeof openIssuer === "function") { openIssuer(decodeURIComponent(m[2])); return true; }
      if (KNOWN.includes(h) && TAB !== h) { TAB = h; if (typeof highlightTab === "function") highlightTab(); render(); return true; }
    } catch (e) { /* app.js ещё не готов */ }
    return false;
  }
  function syncHash() {
    try {
      const t = TAB;
      let want = null;
      if (KNOWN.includes(t)) want = "#" + t;
      else if (t === "issue" && typeof ISSUE !== "undefined" && ISSUE && ISSUE.isin) want = "#issue=" + ISSUE.isin;
      else if (t === "issuer" && typeof ISSUER !== "undefined" && ISSUER && ISSUER.q) want = "#issuer=" + encodeURIComponent(ISSUER.q);
      if (want && location.hash !== want) history.replaceState(null, "", location.pathname + location.search + want);
    } catch (e) { /* не критично */ }
  }
  let wrapped = false;
  function wrapRender() {
    if (wrapped || typeof window.render !== "function") return;
    wrapped = true;
    const orig = window.render;
    window.render = function () { const r = orig.apply(this, arguments); syncHash(); return r; };
  }
  document.addEventListener("DOMContentLoaded", () => {
    // app.js объявлен позже (defer): ждём, пока появится render/boot
    const t = setInterval(() => {
      if (typeof window.render === "function") { clearInterval(t); wrapRender(); if (applyHash()) { /* вкладка из адреса */ } }
    }, 50);
    setTimeout(() => clearInterval(t), 10000);
  });
  window.addEventListener("hashchange", () => applyHash());

  // подпись «данные на …» под шапкой: когда собран снимок и когда ждать следующий
  async function freshness() {
    const st = await F2.tryLoad("status.json");
    const el = document.getElementById("updated");
    if (!st || !el) return;
    const at = st.snapshot_at || st.at;
    if (!at) return;
    const d = new Date(at);
    if (isNaN(d)) return;
    const txt = "Снимок рынка: " + d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const age = (Date.now() - d.getTime()) / 36e5;
    el.textContent = txt + (age > 26 ? " · данные старше суток" : "");
    el.title = "Обновляется автоматически раз в час в торговое время (бот GitHub). Полное обновление — ночью.";
    if (st.offline) el.textContent += " · стартовый снимок";
  }
  document.addEventListener("DOMContentLoaded", () => { setTimeout(freshness, 1500); });

  // сервис-воркер Hub (кэш страниц, как в остальных разделах)
  if ("serviceWorker" in navigator) { try { navigator.serviceWorker.register("../sw.js").catch(() => {}); } catch (e) { /* нет SW */ } }
})();
