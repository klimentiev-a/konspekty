"use strict";

const API = "";
let DATA = null;          // current portfolio dashboard payload (loaded lazily)
let TAB = "screener";
let charts = [];          // ECharts instances to dispose on tab switch

// Watchlist / favourites — persisted locally (no auth in this build).
const WATCH = new Set((() => { try { return JSON.parse(localStorage.getItem("bonds_watch") || "[]"); } catch (e) { return []; } })());
function toggleWatch(isin) {
  if (!isin) return;
  WATCH.has(isin) ? WATCH.delete(isin) : WATCH.add(isin);
  try { localStorage.setItem("bonds_watch", JSON.stringify([...WATCH])); } catch (e) { }
}

// Two top-level sections. "Облигации и аналитика" = market-wide analytics
// (no portfolio needed); "Работа с портфелем" = the client-portfolio tools.
const SECTIONS = [
  ["analytics", "Облигации и аналитика", [
    ["screener", "Скринер"],
    ["marketmap", "Карта рынка"],
    ["movers", "Динамика рынка"],
    ["ideas", "Идеи"],
    ["sandbox", "Песочница"],
    ["placements", "Первичка"],
    ["auctions", "ОФЗ"],
    ["macro", "Макро"],
    ["indices", "Индексы"],
    ["issuers", "Аналитика эмитентов"],
  ]],
];
const TABS = SECTIONS.flatMap(([, , tabs]) => tabs);
const ANALYTICS_TABS = new Set(["screener", "marketmap", "movers", "ideas", "issuers", "sandbox", "placements", "indices"]);
const TAB_SECTION = {};                       // tab id -> section id
SECTIONS.forEach(([sid, , tabs]) => tabs.forEach(([tid]) => (TAB_SECTION[tid] = sid)));
TAB_SECTION["clients"] = "portfolio";         // client picker = portfolio landing
let SECTION = "analytics";
let PF_CLIENT = null;                          // opened client (null → show the picker)
let PF_PID = null;                             // selected portfolio inside client (null → все портфели)
let PF_CCY = null;                             // currency-class filter (null=все, 'rub'/'fx'/код)
let PF_LIST = null;                            // [{id,name,positions,market_value}] of active client
const pidQ = () => { const p = []; if (PF_PID != null) p.push(`pid=${PF_PID}`); if (PF_CCY) p.push(`ccy=${PF_CCY}`); return p.length ? `?${p.join("&")}` : ""; };

// ---------- helpers ----------
const fmt = (v, d = 0) => v == null ? "—" : Number(v).toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (v) => v == null ? "—" : fmt(v, 0) + " ₽";
// compact axis money: millions / thousands (e.g. 1.2 млн, 350 тыс)
const moneyM = (v) => { const a = Math.abs(v || 0); return a >= 1e6 ? fmt(v / 1e6, a >= 1e7 ? 0 : 1) + " млн" : a >= 1e3 ? fmt(v / 1e3, 0) + " тыс" : fmt(v, 0); };
const pct = (v, d = 2) => v == null ? "—" : fmt(v, d) + "%";
const cls = (v) => v == null ? "" : v >= 0 ? "pos" : "neg";
// даты — единый формат ДД.ММ.ГГГГ (из ISO YYYY-MM-DD); месяц YYYY-MM → ММ.ГГГГ
const dmy = (s) => { if (!s || typeof s !== "string") return "—"; const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : s; };
// дата из строки ИЛИ таймстампа (для тултипов графиков с осью времени) → ДД.ММ.ГГГГ
const dmyAny = (v) => { if (v == null) return "—"; if (typeof v === "string") return dmy(v); const d = new Date(v); return isNaN(d) ? String(v) : `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`; };
const mmy = (s) => { if (!s || typeof s !== "string") return s; const m = s.match(/^(\d{4})-(\d{2})/); return m ? `${m[2]}.${m[1]}` : s; };
const daysBetween = (a, b) => { if (!a || !b) return null; const d = Math.round((new Date(b) - new Date(a)) / 864e5); return isNaN(d) ? null : d; };
// перцентиль спреда по своей истории — маленький цветной ярлык (≥85 широко/зелёный, ≤15 узко/красный)
const pctlChip = (p) => p == null ? "" : `<div style="font-size:9px;color:${p >= 85 ? "var(--green)" : p <= 15 ? "var(--red)" : "var(--muted)"}" title="перцентиль спреда по своей истории (0=минимум, 100=максимум)">перц. ${p}</div>`;
// coupon frequency (payments/year) → human label
const freqRu = (f) => ({ 12: "ежемес.", 6: "раз в 2 мес", 4: "квартальн.", 3: "раз в 4 мес", 2: "полугод.", 1: "годовой" }[f] || (f ? `${f}×/год` : "—"));
// «КС + спред» флоатера = ТЕКУЩАЯ ключевая ставка ЦБ + квотируемый спред (напр. 14 + 9 = 23%).
// НЕ couponpercent — та фиксируется на дату сброса (по старой, более высокой КС) и вводит
// в заблуждение. CUR_KC обновляется в boot() из /api/cbr_meetings.
let CUR_KC = 14;
// ориентир доходности флоатера считает бэкенд (float_ref_yield): текущее значение СВОЕГО индекса
// (ключевая / RUONIA) + маржа; для ИПЦ/КБД/ипотеки — текущий купон. Раньше тут было «КС + спред»
// для всех флоатеров (ГлДорога 3 на инфляции показывалась как 14,00%).
const flCoupon = (r) => {
  if (r.float_ref_yield != null) return r.float_ref_yield;
  const sp = r.float_add != null ? r.float_add : r.float_qm;
  if (sp != null && (!r.float_index || r.float_index === "CBR_RATE")) return CUR_KC + sp;
  return r.couponpercent != null ? r.couponpercent : r.current_yield;
};
// короткое имя индекса флоатера для подписей: «КС», «RUONIA», «ИПЦ», «КБД» …
const flIndex = (r) => ({ CBR_RATE: "КС", RUONIA: "RUONIA", "1/2_CBR_RATE": "½ КС", INFLATION_ROSSTAT: "ИПЦ", Z_CURVE_RUS: "КБД", RUS_GOV_BONDS: "ОФЗ", MORTGAGE: "пул ипотеки", GOLD: "золото", UST: "UST" }[r.float_index] || ((r.secid || "").startsWith("SU29") || (r.secid || "").startsWith("SU24") ? "RUONIA" : "КС"));
// small "купон X% · частота" line for under a YTM value (для всех облигаций, вкл. флоатеры)
const couponLine = (r) => {
  if (r.kind === "discount") return "без купонов";
  const freq = r.couponfrequency ? " · " + freqRu(r.couponfrequency) : "";
  if (r.kind === "floater") {
    const sp = r.float_add != null ? r.float_add : r.float_qm;   // оба в % (спред к индексу)
    if (sp != null) return `купон ${flIndex(r)} + ${fmt(sp, 2)}%${freq}`;
    if (r.couponpercent != null) return `купон ${pct(r.couponpercent)} тек.${freq}`;
    return `купон плавающий${freq}`;
  }
  return r.couponpercent == null ? (freq ? "купон" + freq : "") : `купон ${pct(r.couponpercent)}${freq}`;
};
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
// Short, bounded cache for read-only market-map queries. Identical in-flight
// requests share one promise; explicit market refresh clears it on both layouts.
function createMarketRequestCache(fetchJson, ttl = 30000, capacity = 4, now = Date.now) {
  const entries = new Map();
  return {
    get(key) {
      const hit = entries.get(key);
      if (hit && (hit.pending || now() - hit.at < ttl)) return hit.promise;
      const entry = {pending:true,at:0,promise:null};
      entry.promise = Promise.resolve().then(() => fetchJson(key)).then(value => {
        entry.pending = false; entry.at = now(); return value;
      }, error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      entries.delete(key); entries.set(key,entry);
      while (entries.size > capacity) entries.delete(entries.keys().next().value);
      return entry.promise;
    },
    clear() { entries.clear(); },
  };
}
const MARKET_REQUESTS = createMarketRequestCache(async path => {
  const response = await fetch(`${API}${path}`);
  if (!response.ok) throw new Error(`Market request: ${response.status}`);
  return response.json();
});
// Ленивая загрузка: вызвать fn() один раз, когда узел приблизится к вьюпорту.
// Тяжёлые панели карточки (история, оценка группы, доходность, новости) не грузятся
// разом при открытии — только когда пользователь до них доскроллит. Фолбэк — грузим
// сразу, если IntersectionObserver недоступен.
function lazyLoad(node, fn) {
  // нестандартный вьюпорт (например превью с innerHeight=0) → грузим сразу
  if (!node || typeof IntersectionObserver === "undefined" || !window.innerHeight) { fn(); return; }
  let done = false;
  const run = () => { if (done) return; done = true; io.disconnect(); clearTimeout(t); fn(); };
  const io = new IntersectionObserver((ents) => { if (ents.some(e => e.isIntersecting)) run(); }, { rootMargin: "600px" });
  io.observe(node);
  const t = setTimeout(run, 3000);   // страховка: если наблюдатель молчит — всё равно грузим
}
// pretty in-app text prompt (replaces the native browser prompt)
function askText(title, placeholder = "", value = "") {
  return new Promise(resolve => {
    const ov = el(`<div class="modal-ov"><div class="modal">
      <div class="modal-title">${title}</div>
      <input type="text" class="modal-input" placeholder="${placeholder}" value="${value}">
      <div class="modal-btns"><button class="btn ghost" data-a="cancel">Отмена</button><button class="btn" data-a="ok">Готово</button></div>
    </div></div>`);
    document.body.appendChild(ov);
    const inp = ov.querySelector(".modal-input");
    setTimeout(() => inp.focus(), 30);
    const close = (val) => { ov.remove(); resolve(val); };
    ov.querySelector('[data-a="ok"]').onclick = () => close(inp.value.trim() || null);
    ov.querySelector('[data-a="cancel"]').onclick = () => close(null);
    ov.onclick = (e) => { if (e.target === ov) close(null); };
    inp.onkeydown = (e) => { if (e.key === "Enter") close(inp.value.trim() || null); else if (e.key === "Escape") close(null); };
  });
}

function askConfirm(title, okLabel = "Удалить", danger = true) {
  return new Promise(resolve => {
    const ov = el(`<div class="modal-ov"><div class="modal">
      <div class="modal-title">${title}</div>
      <div class="modal-btns"><button class="btn ghost" data-a="cancel">Отмена</button><button class="btn${danger ? " danger" : ""}" data-a="ok">${okLabel}</button></div>
    </div></div>`);
    document.body.appendChild(ov);
    const close = (val) => { ov.remove(); resolve(val); };
    ov.querySelector('[data-a="ok"]').onclick = () => close(true);
    ov.querySelector('[data-a="cancel"]').onclick = () => close(false);
    ov.onclick = (e) => { if (e.target === ov) close(false); };
  });
}

function disposeCharts() { charts.forEach(c => c.dispose()); charts = []; }
// Chart colors are read from the active theme's CSS variables (see syncChartTheme),
// so every chart matches the current skin (dark / light / paper).
let AXIS_LINE = "#2a3639", AXIS_TXT = "#83968f", CHART_TXT = "#e9f1ee",
    CHART_SPLIT = "#161e21", TIP_BG = "rgba(19,27,29,.97)", TIP_BORDER = "#2a3639",
    CHART_FONT = "Inter, ui-sans-serif, -apple-system, sans-serif";
const cssVar = (n, fb) => { try { return getComputedStyle(document.body).getPropertyValue(n).trim() || fb; } catch (e) { return fb; } };
function syncChartTheme() {
  AXIS_TXT = cssVar("--muted", AXIS_TXT);
  AXIS_LINE = cssVar("--line-2", AXIS_LINE);
  CHART_TXT = cssVar("--text", CHART_TXT);
  CHART_SPLIT = cssVar("--line", CHART_SPLIT);
  TIP_BG = cssVar("--panel-2", TIP_BG);
  TIP_BORDER = cssVar("--line-2", TIP_BORDER);
  CHART_FONT = cssVar("--font", CHART_FONT);
  AX = {
    axisLine: { lineStyle: { color: AXIS_LINE } },
    axisTick: { show: false },
    axisLabel: { color: AXIS_TXT },
    splitLine: { lineStyle: { color: CHART_SPLIT } },
    nameTextStyle: { color: AXIS_TXT },
  };
}
function mkChart(node, option) {
  // если на узле уже есть инстанс (напр. перерисовка «Похожих выпусков» при сортировке
  // без полного render) — удаляем старый, иначе ECharts ломается и график исчезает
  const prev = echarts.getInstanceByDom(node);
  if (prev) prev.dispose();
  const c = echarts.init(node, null, { renderer: "svg" });
  const base = {
    textStyle: { color: CHART_TXT, fontFamily: CHART_FONT },
    tooltip: {
      backgroundColor: TIP_BG, borderColor: TIP_BORDER, borderWidth: 1,
      padding: [8, 12], textStyle: { color: CHART_TXT, fontSize: 12 },
      extraCssText: "border-radius:10px;box-shadow:0 10px 30px -8px rgba(0,0,0,.35);",
    },
  };
  const opt = { ...base, ...option };
  if (option.tooltip) opt.tooltip = { ...base.tooltip, ...option.tooltip };
  try { fitAxes(opt); } catch (e) { /* подгонка осей — косметика, график рисуем в любом случае */ }
  try { fitTooltipMarkers(opt); } catch (e) { /* то же */ }
  try { ruTimeAxes(opt); } catch (e) { /* то же */ }
  window.BondsMobile?.tuneChart(opt, node);
  c.setOption(opt);
  charts.push(c);
  return c;
}
let _chartResizeFrame = null;
function scheduleChartResize() {
  if (_chartResizeFrame !== null) return;
  _chartResizeFrame = requestAnimationFrame(() => {
    _chartResizeFrame = null;
    charts.forEach(c => {
      if (c.isDisposed()) return;
      const node = c.getDom();
      if (node.isConnected && node.clientWidth && node.clientHeight) c.resize();
    });
  });
}
window.addEventListener("resize", scheduleChartResize);

// ── ось времени по-русски ──
// ECharts подписывает ось времени по-английски («Apr, Jul, Oct») — на «Динамике рынка» и в
// «Песочнице» так и было. Январь подписываем годом, остальные месяцы — «апр», дни — «12 сен»
const RU_MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function ruTimeAxes(opt) {
  const xs = Array.isArray(opt.xAxis) ? opt.xAxis : (opt.xAxis ? [opt.xAxis] : []);
  const fixed = xs.map(x => {
    if (!x || x.type !== "time" || (x.axisLabel && x.axisLabel.formatter)) return x;
    return { ...x, axisLabel: { ...(x.axisLabel || {}), formatter: v => {
      const d = new Date(v);
      if (d.getDate() !== 1) return `${d.getDate()} ${RU_MON[d.getMonth()]}`;
      return d.getMonth() === 0 ? String(d.getFullYear()) : RU_MON[d.getMonth()];
    } } };
  });
  if (xs.length) opt.xAxis = Array.isArray(opt.xAxis) ? fixed : fixed[0];
}

// ── маркеры в подсказке: по виду серии ──
// ECharts рисует в подсказке кружок у любой серии, и на графике «столбики + линии» было не
// понять, что есть что. Столбик — квадратик, линия — чёрточка (пунктирная — пунктиром),
// точки без линии — кружок
function _serColor(c) { return c && typeof c === "object" ? ((c.colorStops || [])[0] || {}).color || "#888" : (c || "#888"); }
function markerHTML(sr, color) {
  const col = _serColor(color);
  const type = sr && sr.type;
  const ls = (sr && sr.lineStyle) || {};
  if (type === "bar") return `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${col};margin-right:7px;vertical-align:-1px"></span>`;
  if (type === "line" && ls.width !== 0)
    return `<span style="display:inline-block;width:16px;height:0;border-top:2.5px ${ls.type === "dashed" || ls.type === "dotted" ? "dashed" : "solid"} ${col};margin-right:7px;vertical-align:3px"></span>`;
  return `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${col};margin-right:7px;vertical-align:0"></span>`;
}
function fitTooltipMarkers(opt) {
  const tt = opt.tooltip; if (!tt) return;
  const ser = opt.series || [];
  const fix = p => ({ ...p, marker: markerHTML(ser[p.seriesIndex], p.color) });
  if (typeof tt.formatter === "function") {
    const f = tt.formatter;
    tt.formatter = (ps, ...rest) => f(Array.isArray(ps) ? ps.map(fix) : fix(ps), ...rest);
    return;
  }
  if (tt.formatter) return;                                   // строковый шаблон не трогаем
  const types = new Set(ser.map(x => x && x.type));
  const dashed = ser.some(x => x && x.type === "line" && x.lineStyle && x.lineStyle.type === "dashed");
  if (tt.trigger !== "axis" || !(types.size > 1 || dashed)) return;
  // смешанный график без своего формата: повторяем стандартную подсказку ECharts со своими маркерами
  const vf = tt.valueFormatter;
  tt.formatter = ps => {
    const arr = (Array.isArray(ps) ? ps : [ps]).filter(p => { const v = Array.isArray(p.value) ? p.value[p.value.length - 1] : p.value; return v != null && v !== "-"; });
    if (!arr.length) return "";
    const head = arr[0].axisValueLabel != null ? arr[0].axisValueLabel : arr[0].name;
    return `<div style="margin-bottom:4px">${head}</div>` + arr.map(p => {
      const v = Array.isArray(p.value) ? p.value[p.value.length - 1] : p.value;
      return `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7"><span>${markerHTML(ser[p.seriesIndex], p.color)}${p.seriesName}</span><b>${vf ? vf(v) : v}</b></div>`;
    }).join("");
  };
}

// ── подгонка вертикальных осей для всех графиков ──
// 1) Название оси стоит над её числами. Длинное («доля портфеля, %», «CIR / ROE, %») не
//    помещалось в отступ графика и обрезалось краем: расширяем отступ под ширину подписи.
// 2) Ось без отрицательных значений начинается с нуля; почти нулевой минус (COR −0,16% при
//    шкале до 10%) не тянет её на целое деление вниз.
// 3) Если минус есть на обеих осях, их нули стоят на одной высоте.
const _measureCtx = document.createElement("canvas").getContext("2d");
function _textW(t, size) { _measureCtx.font = `${size || 12}px ${CHART_FONT}`; return _measureCtx.measureText(String(t)).width; }
function _niceUp(x) {
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function fitAxes(opt) {
  if (!opt.yAxis || Array.isArray(opt.grid)) return;
  // копии: один объект оси бывает общим для нескольких графиков — правки не должны утекать
  const multi = Array.isArray(opt.yAxis);
  const ys = (multi ? opt.yAxis : [opt.yAxis]).map(y => y ? { ...y } : y);
  opt.yAxis = multi ? ys : ys[0];
  const grid = { ...(opt.grid || {}) };
  // --- 1. место под названия осей
  ys.forEach((y, i) => {
    if (!y || !y.name) return;
    const right = y.position === "right" || (i > 0 && y.position !== "left");
    const w = _textW(y.name, (y.nameTextStyle || {}).fontSize) + 12;
    if (right && typeof grid.right === "number" && grid.right < w) grid.right = Math.ceil(w);
    if (!right && typeof grid.left === "number" && grid.left < w) grid.left = Math.ceil(w);
  });
  if (opt.grid) opt.grid = grid;
  // --- 2. диапазоны данных по осям (стопки суммируем)
  const val = v => v == null ? null : Array.isArray(v) ? v[1] : (typeof v === "object" ? v.value : v);
  const rng = ys.map(() => ({ lo: 0, hi: 0, any: false }));
  const stacks = {};
  (opt.series || []).forEach(sr => {
    const ai = sr.yAxisIndex || 0; if (!rng[ai]) return;
    (sr.data || []).forEach((v, k) => {
      const x = +val(v); if (!isFinite(x) || val(v) == null) return;
      rng[ai].any = true;
      if (sr.stack) { const key = ai + "|" + sr.stack + "|" + k, st = stacks[key] || (stacks[key] = { p: 0, n: 0 });
        if (x >= 0) st.p += x; else st.n += x;
        rng[ai].hi = Math.max(rng[ai].hi, st.p); rng[ai].lo = Math.min(rng[ai].lo, st.n); }
      else { rng[ai].hi = Math.max(rng[ai].hi, x); rng[ai].lo = Math.min(rng[ai].lo, x); }
    });
  });
  const free = y => y && (y.type == null || y.type === "value") && y.min == null && y.max == null && !y.scale;
  const isFree = ys.map(free);          // до правок: шаг 2 выставляет min и иначе выключит шаг 3
  ys.forEach((y, i) => {
    const r = rng[i];
    if (!isFree[i] || !r.any) return;
    // минус меньше 5% размаха (COR −0,16% при шкале до 10%) — шкалу с нуля: столбик такого
    // размера всё равно не виден, а значение остаётся в подсказке
    if (r.lo < 0 && -r.lo < 0.05 * Math.max(r.hi, -r.lo)) r.lo = 0;
    if (r.lo >= 0) y.min = 0;
  });
  // --- 3. две оси и минус на обеих: общий ноль и одинаковое число делений. Если у одной
  // оси минуса нет, она начинается с нуля — так и задумано, в минус её не тянем
  if (ys.length === 2 && isFree.every(Boolean) && rng.every(r => r.any && r.lo < 0)) {
    const N = 5;
    const share = Math.max(...rng.map(r => (-r.lo) / Math.max(r.hi - r.lo, 1e-9)));
    const kNeg = Math.min(N - 1, Math.max(1, Math.ceil(share * N)));
    ys.forEach((y, i) => {
      const r = rng[i];
      const step = _niceUp(Math.max(r.hi / (N - kNeg), (-r.lo) / kNeg));
      y.min = -kNeg * step; y.max = (N - kNeg) * step; y.interval = step;
    });
  }
}

const CHART_BG = { backgroundColor: "transparent" };
let AX = {
  axisLine: { lineStyle: { color: AXIS_LINE } },
  axisTick: { show: false },
  axisLabel: { color: AXIS_TXT },
  splitLine: { lineStyle: { color: CHART_SPLIT } },
  nameTextStyle: { color: AXIS_TXT },
};
// Bonds AI chart palette (mint accent + supporting hues).
const PALETTE = ["#1fe0a0", "#35d6e6", "#8b7bff", "#f5b13c", "#ff5470", "#7ddc5b", "#e7d84a", "#7f938d"];
// Rating bucket → color (matches CSS .rt-* classes).
const RATING_COLOR = { AAA: "#2fe08a", AA: "#2fe08a", A: "#7ddc5b", BBB: "#e7d84a", BB: "#f5b13c", B: "#ff8a4c", CCC: "#ff5470", CC: "#ff5470", C: "#ff5470", D: "#ff5470" };
const ratingCls = (b) => "rt rt-" + (b || "NR");
const LIQ_COLOR = { "Высокая": "var(--green)", "Средняя": "var(--amber)", "Низкая": "var(--muted)" };
// Рейтинги агентств: показываем ХУДШИЙ из агентств (консервативно), остальные — в подсказке/карточке.
const AG_SHORT = { ACRA: "АКРА", EXPERT_RA: "Эксперт РА", NKR: "НКР", NRA: "НРА" };
const escA = x => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const agName = (a) => AG_SHORT[a] || a || "";
const trendArrow = (t) => t === "up" ? `<span style="color:var(--green)" title="последнее действие — повышение">↑</span>`
  : t === "down" ? `<span style="color:var(--red)" title="последнее действие — понижение">↓</span>` : "";
const agLevel = (a) => a.level === "issue" ? (a.sf ? "выпуск, структ. финансирование" : "выпуск") : "эмитент";
const agTip = (list) => (list || []).map(a => `${agName(a.agency)}: ${a.rating}${a.expected ? " (ожидаемый)" : ""} — ${agLevel(a)}`
  + `${(a.forecast || a.issuer_forecast) ? ", " + (a.forecast || a.issuer_forecast).toLowerCase() : ""}${a.action_date ? ", " + dmy(a.action_date) : ""}`
  + `${a.prev_rating ? " (было " + a.prev_rating + ")" : ""}`).join("\n");
const ratingPill = (r) => r.agency_rating
  ? `<span class="${ratingCls(r.agency_bucket)}" title="${escA(agTip(r.agency_all) || r.agency_name)}${(r.agency_all || []).length > 1 ? "\nпоказан худший" : ""}">${r.agency_rating}${r.rating_expected ? "<sup>e</sup>" : ""}</span>${trendArrow(r.agency_trend)}<div class="muted" style="font-size:9px">${agName(r.agency_name)}${(r.agency_all || []).length > 1 ? " +" + ((r.agency_all || []).length - 1) : ""}${r.rating_scope === "issue" ? " · выпуск" : ""}</div>`
  : (r.rating_bucket ? `<span class="${ratingCls(r.rating_bucket)}" title="рейтинг агентства">${r.rating || r.rating_bucket}</span>` : '<span class="muted">—</span>');

function issueRatingHead(d) {
  if (d.agency_rating) {
    const fc = d.agency_forecast || "";
    return `<span class="${ratingCls(d.agency_bucket)}" style="margin-left:6px" title="прогноз: ${fc || "—"}${(d.agency_all || []).length > 1 ? " · худший из агентств" : ""}">${escA(d.agency_rating)} · ${agName(d.agency_name)}</span>${trendArrow(d.agency_trend)}${fc ? `<span class="muted" style="font-size:12px;margin-left:6px">${escA(fc)}</span>` : ""}`;
  }
  return d.rating_bucket ? `<span class="${ratingCls(d.rating_bucket)}" style="margin-left:6px" title="рейтинг агентства">${escA(d.rating || d.rating_bucket)}</span>` : "";
}

// Рейтинги в шапке карточки: одна строка на агентство (было → сейчас, прогноз, дата).
// Сначала из строки скринера, затем уточняется ответом /api/bonds/{isin}/ratings («было» — по истории агентства).
function agTable(d, list) {
  list = list || d.agency_all || [];
  const many = list.length > 1;
  return `<div class="ag-lines" style="display:flex;flex-direction:column;gap:3px;font-size:12.5px">${list.map(a => {
    const worst = many && a.agency === d.agency_name && a.rating === d.agency_rating;
    const fc = a.forecast || a.issuer_forecast;
    return `<div><b style="display:inline-block;min-width:82px">${agName(a.agency)}</b>`
      + (a.prev_rating ? `<span class="muted">${escA(a.prev_rating)}${a.prev_date ? " (" + dmy(a.prev_date) + ")" : ""} → </span>` : "")
      + `<span class="${ratingCls(a.bucket)}">${escA(a.rating)}</span> ${trendArrow(a.trend)}`
      + (a.level === "issue" && a.issuer_rating && a.issuer_rating !== a.rating ? ` <span class="muted" style="font-size:11px" title="у эмитента ${escA(a.issuer_rating)}">рейтинг выпуска</span>` : "")
      + (fc ? ` <span class="muted">· ${escA(fc).toLowerCase()}</span>` : "")
      + (a.action_date ? ` <span class="muted">· ${dmy(a.action_date)}</span>` : "")
      + (worst ? ` <span class="muted" style="font-size:10.5px">· худший</span>` : "") + `</div>`;
  }).join("")}</div>`;
}
// график «Рейтинги по датам»: ось — реальные ступени шкалы (AAA, AA+, AA, …), ступенька на каждое
// действие агентства, линия до сегодня; совпадающие рейтинги разных агентств — параллельные линии
// с небольшим сдвигом; отзыв — разрыв линии
const AG_COLOR = { ACRA: "#1fe0a0", EXPERT_RA: "#5b8def", NKR: "#f5b13c", NRA: "#c792ea" };
const RT_NOTCH = (() => { const out = []; ["D", "C", "CC", "CCC"].forEach((b, i) => out.push([b, i + 1]));
  [["B", 5], ["BB", 6], ["BBB", 7], ["A", 8], ["AA", 9]].forEach(([b, v]) => { out.push([b + "-", v - 0.33], [b, v], [b + "+", v + 0.33]); });
  out.push(["AAA", 10]); return out; })();          // снизу вверх: D … AA+, AAA
const rtIdx = sc => { let bi = 0; RT_NOTCH.forEach(([, v], i) => { if (Math.abs(v - sc) < Math.abs(RT_NOTCH[bi][1] - sc)) bi = i; }); return bi; };
function drawRatingTimeline(node, list, title) {
  const today = new Date().toISOString().slice(0, 10);
  const src = (list || []).filter(a => (a.timeline || []).some(x => x[2] != null));
  // серии: у каждого агентства новая шкала; у Эксперт РА до 2017 ещё и старая (пунктиром)
  const groups = [];
  src.forEach(a => {
    const nw = a.timeline.filter(x => x[5] !== "old"), old = a.timeline.filter(x => x[5] === "old");
    if (nw.some(x => x[2] != null)) groups.push({ a, pts: nw, old: false });
    if (old.some(x => x[2] != null)) groups.push({ a, pts: old, old: true });
  });
  const nAg = src.length;
  const series = groups.map(g => {
    const k = src.indexOf(g.a), off = nAg > 1 ? (k - (nAg - 1) / 2) * 0.13 : 0;
    const data = g.pts.map(x => ({ value: [x[0], x[2] == null ? null : rtIdx(x[2]) + off], r: x[1], f: x[3], act: x[4], eq: x[6], old: g.old }));
    const last = g.pts[g.pts.length - 1];
    if (!g.old && last && last[0] < today && last[2] != null) data.push({ value: [today, rtIdx(last[2]) + off], r: last[1], f: last[3], now: true });
    const col = AG_COLOR[g.a.agency] || "#9aa7b0";
    return { name: agName(g.a.agency) + (g.old ? " · старая шкала" : ""), type: "line", step: "end", data, connectNulls: false,
      symbolSize: (v, p) => p.data.now ? 0 : (g.old ? 5 : 7), color: col,
      lineStyle: { width: g.old ? 1.8 : 2.4, type: g.old ? "dashed" : "solid", opacity: g.old ? .8 : 1 }, emphasis: { focus: "series" } };
  });
  if (!series.length) { node.innerHTML = ""; return; }
  const hasOld = groups.some(g => g.old);
  node.innerHTML = `<div class="panel"><h3>${title || "Рейтинги по датам"} <span class="muted" style="font-weight:400;font-size:12px">· рейтинг эмитента у каждого агентства · ступенька — рейтинговое действие · разрыв — рейтинг отозван${hasOld ? " · пунктир — старая шкала Эксперт РА до 2017, положение на оси приблизительное" : ""}</span></h3><div class="chart" id="rt-tl" style="height:260px"></div></div>`;
  const idx = src.flatMap(a => a.timeline.filter(x => x[2] != null).map(x => rtIdx(x[2])));
  const lo = Math.max(0, Math.min(...idx) - 1), hi = Math.min(RT_NOTCH.length - 1, Math.max(...idx) + 1);
  mkChart(node.querySelector("#rt-tl"), {
    ...CHART_BG,
    legend: { top: 2, right: 8, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 } },
    tooltip: { trigger: "item", formatter: p => `<b>${p.seriesName}</b> · ${p.data.now ? "действует сейчас" : dmy(p.value[0])}<br>${escA(p.data.r)}${p.data.old && p.data.eq ? ` <span style='opacity:.75'>(≈ ${escA(p.data.eq)} по новой лестнице)</span>` : ""}${p.data.f ? " · " + escA(p.data.f).toLowerCase() : ""}${p.data.act && !p.data.now ? "<br><span style='opacity:.75'>" + escA(p.data.act) + "</span>" : ""}` },
    grid: { left: 52, right: 18, top: 34, bottom: 30 },
    xAxis: { type: "time", ...AX },
    yAxis: { type: "value", min: lo, max: hi + 0.45, interval: 1,   // целые деления = реальные ступени; запас сверху под сдвиг линий у AAA
      axisLabel: { color: cssVar("--muted", "#8aa"), formatter: v => { const i = Math.round(v); return Math.abs(v - i) < 0.01 && RT_NOTCH[i] ? RT_NOTCH[i][0] : ""; } },
      splitLine: { lineStyle: { opacity: .25 } } },
    series,
  });
}

// ---------- boot ----------
// Four switchable skins. "dark"/"indigo" are night styles, "light"/"paper" day.
const STYLES = [["dark", "Тёмный", "🌑"], ["indigo", "Индиго", "🔵"], ["light", "Светлый", "☀"], ["paper", "Бумага", "📄"]];
function applyTheme(name) {
  if (!STYLES.some(([k]) => k === name)) name = "dark";
  const noMotion = document.createElement('style');
  noMotion.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.append(noMotion);
  document.body.classList.remove("light", "paper", "indigo");
  if (name !== "dark") document.body.classList.add(name);
  void document.body.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => noMotion.remove()));
  try { localStorage.setItem("bonds_theme", name); } catch (e) {}
  syncChartTheme();
  if (typeof render === "function" && document.querySelector("#view .panel, #view canvas, #view .chart")) render();
  else charts.forEach(c => c.resize && c.resize());
}
function currentTheme() {
  for (const [k] of STYLES) if (k !== "dark" && document.body.classList.contains(k)) return k;
  return "dark";
}
function toggleDayNight() {
  const cur = currentTheme();
  const isDay = cur === "light" || cur === "paper";
  applyTheme(isDay ? "dark" : "light");
  buildSettingsPop();
}
function buildSettingsPop() {
  const pop = document.getElementById("settings-pop");
  if (!pop) return;
  const cur = currentTheme();
  const isDay = cur === "light" || cur === "paper";
  pop.innerHTML = `<div class="sp-sec">Стиль</div>
    <div class="sp-styles">${STYLES.map(([k, l, ic]) => `<button class="sp-style ${cur === k ? "on" : ""}" data-s="${k}"><span>${ic}</span>${l}</button>`).join("")}</div>
    <div class="sp-sec">Режим</div>
    <button class="sp-mode" id="sp-daynight">${isDay ? "☀ Дневная" : "☾ Ночная"} · переключить</button>
    <div class="sp-sec" style="margin-top:12px">Помощь</div>
    <a class="sp-mode sp-link" href="BondsAI-Guide.pdf?v=2.2" download="BondsAI-Guide.pdf" title="PDF, 22 страницы: все экраны, рейтинги, методика, словарь">📘 Скачать гайд (PDF)</a>`;
  pop.querySelectorAll(".sp-style").forEach(b => b.onclick = () => { applyTheme(b.dataset.s); buildSettingsPop(); });
  pop.querySelector("#sp-daynight").onclick = toggleDayNight;
}

async function boot() {
  // Explicit return from Stocks restores the last public bond section only.
  // A normal first visit keeps the existing screener landing page.
  try {
    if (new URLSearchParams(location.search).get('from') === 'stocks') {
      const last = sessionStorage.getItem('bonds_last_public_tab');
      if (TABS.some(([id]) => id === last)) { TAB = last; SECTION = 'analytics'; }
    }
  } catch (e) { }
  applyTheme((() => { try { return localStorage.getItem("bonds_theme") || "paper"; } catch (e) { return "paper"; } })());
  // текущая ключевая ставка ЦБ — для «КС + спред» флоатеров
  try { const m = await fetch(`${API}/api/cbr_meetings`).then(x => x.json()); if (m.path && m.path[0] && m.path[0].rate != null) CUR_KC = m.path[0].rate; } catch (e) { }
  const sbtn = document.getElementById("btn-settings"), pop = document.getElementById("settings-pop");
  sbtn.onclick = (e) => { e.stopPropagation(); if (pop.hidden) { buildSettingsPop(); pop.hidden = false; } else pop.hidden = true; };
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== sbtn) pop.hidden = true; });
  renderTabs();
  document.getElementById("btn-refresh").onclick = () => onRefresh(false);
  { const bf = document.getElementById("btn-refresh-full");
    if (bf) {
      bf.onclick = () => onRefresh(true);
      // «Полное» (снимок + перцентили, ~1 мин) прячем на ПУБЛИЧНОМ хостинге — оно
      // грузит shared-хостинг; там полный пересчёт идёт по CRON. Локально — остаётся.
      if (/investplatformai\.(online|ru)/i.test(location.hostname)) bf.style.display = "none";
    } }
  countVisit();                   // счётчик посещений (за 24ч и всё время)
  // analytics-first: show the screener immediately; заставку снимаем, когда вкладка готова
  Promise.resolve(render()).catch(() => { }).finally(() => { if (window.hideSplash) window.hideSplash(); });
  // (аналитическая версия — без портфелей/клиентов; portfolio API отключён на сервере)
}

// счётчик посещений: пинг раз за сессию, показ «за 24ч N · всего M»
function countVisit() {
  try {
    if (!sessionStorage.getItem("bonds_visited")) {
      fetch(`${API}/api/visit`, { method: "POST" }).catch(() => { });
      sessionStorage.setItem("bonds_visited", "1");
    }
  } catch (e) { }
  const show = () => fetch(`${API}/api/visits`).then(x => x.json()).then(v => {
    const el = document.getElementById("visit-counter");
    if (el) el.innerHTML = `👁 за 24ч <b style="color:var(--text)">${fmt(v.day)}</b> · всего <b style="color:var(--text)">${fmt(v.total)}</b>`;
  }).catch(() => { });
  show();
  setInterval(show, 60000);
}

function renderTabs() {
  const nav = document.getElementById("tabs");
  nav.innerHTML = "";
  // section switcher (in the top bar, next to the brand and market actions)
  const secNav = document.getElementById("secnav");
  secNav.innerHTML = "";
  const secBar = el(`<div class="section-switch"></div>`);
  SECTIONS.forEach(([sid, label]) => {
    const b = el(`<button class="sec-btn" data-sec="${sid}">${label}</button>`);
    b.onclick = () => {
      SECTION = sid;
      // portfolio is two-level: pick a client first, then its tabs
      if (sid === "portfolio" && !PF_CLIENT) return switchTab("clients");
      const tabs = SECTIONS.find(s => s[0] === sid)[2];
      if (TAB_SECTION[TAB] !== sid) switchTab(sid === "portfolio" ? "overview" : tabs[0][0]); else renderTabs();
    };
    secBar.appendChild(b);
  });
  if (SECTIONS.length > 1) secNav.appendChild(secBar);   // одна секция — переключатель не нужен
  // tabs of the active section — for the portfolio section only after a client is
  // opened (and prefixed with a "← Клиенты" pill back to the picker).
  const tabBar = el(`<div class="tab-row"></div>`);
  if (SECTION === "portfolio") {
    if (PF_CLIENT) {
      const back = el(`<button data-tab="clients" title="К списку клиентов">← Клиенты</button>`);
      back.onclick = () => { PF_CLIENT = null; DATA = null; switchTab("clients"); };
      tabBar.appendChild(back);
      SECTIONS.find(s => s[0] === "portfolio")[2].forEach(([id, label]) => {
        const b = el(`<button data-tab="${id}">${label}</button>`);
        b.onclick = () => switchTab(id);
        tabBar.appendChild(b);
      });
    }
  } else {
    (SECTIONS.find(s => s[0] === SECTION)[2]).forEach(([id, label]) => {
      const b = el(`<button data-tab="${id}">${label}</button>`);
      b.onclick = () => switchTab(id);
      tabBar.appendChild(b);
    });
  }
  nav.appendChild(tabBar);
  highlightTab();
}
function highlightTab() {
  document.querySelectorAll("#tabs button[data-tab]").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === TAB));
  document.querySelectorAll("#tabs .sec-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.sec === SECTION));
}

async function loadCurrent() {
  try {
    const r = await fetch(`${API}/api/portfolio/current${pidQ()}`).then(x => x.json());
    if (r.empty) return;
    DATA = r;
    if (!ANALYTICS_TABS.has(TAB)) render();   // refresh only if a portfolio tab is open
  } catch (e) { /* portfolio is optional for the analytics view */ }
}

function switchTab(id) { TAB = id; SECTION = TAB_SECTION[id] || SECTION; try { if (TABS.some(([tid]) => tid === id)) sessionStorage.setItem('bonds_last_public_tab',id); } catch (e) { } renderTabs(); render(); }
// Navigation stack so "← Назад" from a detail view returns to where you came
// from (e.g. Идеи → карточка → назад ведёт в Идеи, а не в скринер).
let NAV_STACK = [];
function openDetail(setTab) { NAV_STACK.push(TAB); setTab(); highlightTab(); render(); }
function goBack() { const t = NAV_STACK.pop(); if (t) switchTab(t); else switchTab("screener"); }

async function onRefresh(full) {
  MARKET_REQUESTS.clear();
  window.BondsMobile?.invalidateMarket();
  const btns = [document.getElementById("btn-refresh"), document.getElementById("btn-refresh-full")].filter(Boolean);
  // Обновление рынка работает АБСОЛЮТНО ВЕЗДЕ (снимок цен/доходностей/спредов),
  // кроме собственно портфельных вкладок (там обновляются котировки портфеля).
  // Перцентили — только по большой кнопке «Полное».
  const PORTFOLIO_TABS = ["overview", "bonds", "cashflows", "yield", "quality", "builder", "clients"];
  if (!PORTFOLIO_TABS.includes(TAB)) {
    // Лёгкое = только снимок цен/доходностей (~9с). Полное = + перцентили спреда (~1 мин).
    setUpdated(full ? "Полное обновление (снимок + перцентили, ~1 мин)…" : "Обновляю рыночный снимок…");
    btns.forEach(b => b.disabled = true);
    try {
      // на проде обновление защищено токеном администратора (env ADMIN_TOKEN): при 403
      // спрашиваем его один раз и храним в браузере
      const call = () => { let tok = ""; try { tok = localStorage.getItem("bonds_admin_token") || ""; } catch (e) { }
        return fetch(`${API}/api/universe/refresh`, { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": tok }, body: JSON.stringify({ full: !!full }) }); };
      let resp = await call();
      if (resp.status === 403) {
        const t = prompt("Обновление рынка доступно администратору. Введите токен:");
        if (t) { try { localStorage.setItem("bonds_admin_token", t.trim()); } catch (e) { } resp = await call(); }
      }
      if (!resp.ok) throw new Error(String(resp.status));
      const r = await resp.json();
      UNI.loaded = false; UNI.facets = null;   // force re-query + refresh facet counts from the fresh snapshot
      const fb = (r.failed_boards || []).length ? ` · не обновились доски: ${r.failed_boards.join(", ")}` : "";
      setUpdated(r.skipped ? `Снимок не обновлён: ${r.skipped}`
        : `Снимок: ${r.count || 0} бумаг · ${snapTime(r.at)}${(full && r.pctl != null) ? ` · перцентили: ${r.pctl}` : ""}${fb}`);
    } catch (e) { setUpdated(String(e.message) === "403" ? "Нет прав на обновление" : "Ошибка обновления"); }
    btns.forEach(b => b.disabled = false);
    render();
    return;
  }
  const btn = btns[0];
  if (!DATA) return;
  setUpdated("Обновляю котировки…");
  await fetch(`${API}/api/portfolio/${DATA.portfolio.id}/refresh`, { method: "POST" });
  await loadCurrent();
}
function setUpdated(t) { document.getElementById("updated").textContent = t; }
// время снимка рынка в шапке: дата и часы-минуты по часам пользователя
function snapTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d)) return "";
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit" });
}

// ---------- router ----------
let _LAST_VIEW = null;
function render(opts) {
  window.BondsMobile?.beforeRender();
  // Пере-рендер «на месте» (сортировка, фильтры, переключатели) не должен отбрасывать в начало
  // страницы: если вкладка та же — сохраняем прокрутку и на время перерисовки фиксируем высоту
  // #view (иначе на миг страница «схлопывается» и браузер сам сбрасывает прокрутку наверх).
  const key = TAB + "|" + (TAB === "issue" ? (ISSUE && ISSUE.isin) : TAB === "issuer" ? (ISSUER && ISSUER.q) : "");
  const same = key === _LAST_VIEW;
  _LAST_VIEW = key;
  const v = document.getElementById("view");
  const keepY = (same || (opts && opts.keepScroll)) ? (window.scrollY || document.documentElement.scrollTop || 0) : null;
  if (keepY && v) v.style.minHeight = v.offsetHeight + "px";
  const p = _renderInner();
  Promise.resolve(p).finally(() => requestAnimationFrame(() => {
    if (keepY) window.scrollTo(0, keepY);
    if (v) v.style.minHeight = "";
    window.BondsMobile?.afterRender();
  }));
  return p;
}
function _renderInner() {
  disposeCharts();
  const v = document.getElementById("view");
  v.innerHTML = "";
  window.BondsMobile?.startView(v, TAB);
  if (TAB === "screener") return renderScreener(v);
  if (TAB === "marketmap") return renderMarketMap(v);
  if (TAB === "movers") return renderMovers(v);
  if (TAB === "ideas") return renderIdeas(v);
  if (TAB === "issuers") return renderSector(v);       // отраслевая аналитика эмитентов
  if (TAB === "sandbox") return renderSandbox(v);
  if (TAB === "placements") return renderPlacements(v);
  if (TAB === "auctions") return renderAuctions(v);
  if (TAB === "macro") return renderMacro(v);
  if (TAB === "indices") return renderIndices(v);
  if (TAB === "issue") return renderIssue(v);
  if (TAB === "issuer") return renderIssuerPage(v);
  if (TAB === "compare") return renderCompare(v);
  if (TAB === "clients") return renderClientsPicker(v);       // client picker (portfolio landing)
  if (TAB !== "upload" && TAB !== "builder" && !DATA) { v.insertAdjacentHTML("beforeend", `<div class="loading">Загружаю портфель клиента… (или соберите его во вкладке «Конструктор»)</div>`); return; }
  if (TAB === "builder") return renderBuilder(v);
  if (PF_CLIENT && !["upload"].includes(TAB)) renderPortfolioPicker(v);
  ({
    overview: renderOverview, structure: renderStructure, bonds: renderBonds,
    cashflows: renderCashflows, yield: renderYield, risk: renderRisk,
    quality: renderQuality, upload: renderUpload, bond: renderBondCard,
  }[TAB] || renderOverview)(v);
}

// ---------- Overview ----------
function renderOverview(v) {
  const s = DATA.summary;
  const bar = el(`<div class="toolbar" style="justify-content:flex-end;margin-bottom:6px"><a class="btn ghost" href="${API}/api/reports/portfolio.xlsx${pidQ()}" download style="font-size:12.5px;padding:7px 14px">⭳ Скачать Excel</a></div>`);
  v.appendChild(bar);
  const kpi = (label, value, sub) => `<div class="kpi"><div class="label">${label}</div>
    <div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  // разбивка по валютам прямо в карточках (под большими числами)
  const _pc = (DATA?.portfolio?.currencies || []).filter(c => c.market_value);
  const ytmBd = _pc.filter(c => c.ytm != null).map(c => `${ccySym(c.currency)} ${fmt(c.ytm, 1)}%`).join(" · ");
  const durBd = _pc.filter(c => c.duration != null).map(c => `${ccySym(c.currency)} ${fmt(c.duration, 1)} г.`).join(" · ");
  const multi = _pc.length > 1;   // разбивка полезна только при нескольких валютах
  v.appendChild(el(`<div class="kpis">
    ${kpi("Рыночная стоимость", money(s.market_value))}
    ${kpi("YTM (взвеш., облигации)", pct(s.ytm), multi ? ytmBd : "фикс + флоатеры")}
    ${kpi("Тек. доходность (взвеш.)", pct(s.current_yield), "фикс + флоатеры")}
    ${kpi("Дюрация (облигации)", s.duration_years == null ? "—" : fmt(s.duration_years, 2) + " г.", multi ? durBd : null)}
    ${kpi("Позиций", fmt(s.positions), `${s.unresolved} без MOEX · ${s.no_price} без цены`)}
  </div>`));

  // аллокация активов + типы инструментов (как на общем листе), состав — в подсказке при наведении
  const alc = clientAllocation(DATA.positions);
  const ag = el(`<div class="grid2" style="margin-bottom:14px">
    <div class="panel" style="margin:0"><h3>Аллокация активов <span class="muted" style="font-weight:400;font-size:11px">· по классам · наведи — состав</span></h3><div class="chart" id="st-alloc" style="height:270px"></div></div>
    <div class="panel" style="margin:0"><h3>По типу инструмента <span class="muted" style="font-weight:400;font-size:11px">· облигации · наведи — состав</span></h3><div class="chart" id="st-instr" style="height:270px"></div></div>
  </div>`);
  v.appendChild(ag);
  setTimeout(() => {
    allocDonut(ag.querySelector("#st-alloc"), alc.allocation, ALLOC_COLORS);
    allocDonut(ag.querySelector("#st-instr"), alc.by_instrument, INSTR_COLORS);
  }, 0);

  const c1 = el(`<div class="panel"><h3>Ближайшие выплаты</h3><div id="ov-cf" class="chart"></div></div>`);
  const c2 = el(`<div class="panel"><h3>Топ-10 позиций</h3><div id="ov-top" class="chart"></div></div>`);
  const g = el(`<div class="grid2"></div>`); g.append(c1, c2); v.appendChild(g);

  const months = DATA.cashflows.by_month.slice(0, 12);
  mkChart(c1.querySelector("#ov-cf"), {
    ...CHART_BG, tooltip: { trigger: "axis", formatter: (ps) => {
      const m = months[ps[0].dataIndex]; if (!m) return "";
      // учитываем только видимые серии (что не убрано из легенды)
      const vis = new Set(ps.map(p => p.seriesName));
      const showC = vis.has("Купоны"), showN = vis.has("Номинал");
      let s = `<b>${mmy(m.month)}</b><br/>`;
      ps.forEach(p => { if (p.value) s += `${p.marker}${p.seriesName}: ${money(p.value)}<br/>`; });
      const rows = (m.items || []).map(x => {
        const c = showC ? (x.coupon || 0) : 0, n = showN ? (x.nominal || 0) : 0;
        return { name: x.name, amt: c + n, tag: (c && n) ? "куп+ном" : n ? "номинал" : "купон" };
      }).filter(r => r.amt > 0).sort((a, b) => b.amt - a.amt).slice(0, 10);
      if (rows.length) {
        s += `<div style="margin-top:5px;padding-top:4px;border-top:1px solid rgba(255,255,255,.12);font-size:11px;opacity:.85">`;
        rows.forEach(r => { s += `${r.name} · <span style="opacity:.7">${r.tag}</span>: ${money(r.amt)}<br/>`; });
        s += `</div>`;
      }
      return s;
    } },
    legend: { data: ["Купоны", "Номинал"], top: 0, textStyle: { color: cssVar("--text", "#f2f8f5") } },
    grid: { left: 60, right: 20, top: 30, bottom: 30 },
    xAxis: { type: "category", data: months.map(m => mmy(m.month)), ...AX }, yAxis: { type: "value", ...AX, axisLabel: { color: AXIS_TXT, formatter: moneyM }, splitLine: { show: false } },
    series: [
      { name: "Купоны", type: "bar", stack: "p", data: months.map(m => m.coupon || null), itemStyle: { color: PALETTE[1] } },
      { name: "Номинал", type: "bar", stack: "p", data: months.map(m => m.nominal || null), itemStyle: { color: PALETTE[3] } },
    ],
  });
  const top = DATA.structure.top10;
  const totalMv = (DATA.positions || []).reduce((a, r) => a + (r.market_value || 0), 0);
  const topSum = top.reduce((a, t) => a + (t.value || 0), 0);
  const rest = Math.max(0, totalMv - topSum);
  // топ-10 + серый ломоть «Остальное» → доли считаются от всего портфеля
  const data = top.map(t => ({ name: t.name, value: t.value, isin: t.isin }));
  if (rest > 0) data.push({ name: "Остальное", value: rest, isin: null, itemStyle: { color: "#5c6f69" } });
  const topCh = mkChart(c2.querySelector("#ov-top"), {
    ...CHART_BG, tooltip: { trigger: "item", formatter: p => `${p.name}: ${money(p.value)} (${pct(p.percent)} портфеля)${p.data.isin ? '<br/><span style="opacity:.6;font-size:11px">клик — открыть выпуск</span>' : ""}` },
    series: [{ type: "pie", radius: ["40%", "70%"], data,
      label: { color: cssVar("--text", "#f2f8f5"), formatter: "{b}: {d}%" } }],
    color: PALETTE,
  });
  c2.querySelector("#ov-top").style.cursor = "pointer";
  topCh.on("click", p => { if (p.data && p.data.isin) openIssue(p.data.isin); });
  renderPortfolioCurrencies(v);
  renderImportantDates(v);
  // Структура объединена в Обзор (меньше вкладок)
  renderStructure(v);
}

async function renderImportantDates(v) {
  const host = el(`<div class="panel"><h3>Важные даты <span class="muted" style="font-weight:400;font-size:12px">· купоны, оферты, погашения</span></h3><div id="imp-body"><div class="loading" style="padding:14px"></div></div></div>`);
  v.appendChild(host);
  let path = [];
  try { const raw = (await fetch(`${API}/api/cbr_meetings`).then(x => x.json())).path || []; const c0 = (raw[0]?.rate) ?? 14; path = interpPath(raw, c0, { y26: c0, ...BASE_ANCHORS }); } catch (e) { }
  let d = null;
  try { d = await fetch(`${API}/api/portfolio/cashflows_scenario`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rate_path: path, pid: PF_PID, ccy: PF_CCY }) }).then(x => x.json()); } catch (e) { }
  const body = host.querySelector("#imp-body");
  if (!d || !d.important) { body.innerHTML = `<div class="muted">Нет данных</div>`; return; }
  // «Ближайшая неделя» — все типы выплат сразу, всегда развёрнуто
  const wk = d.important.week || { total: 0, count: 0, events: [] };
  const wkRows = wk.events.map(e => `<tr data-isin="${e.isin}"><td>${dmy(e.date)}</td><td style="text-align:left">${eventTypeBadge(e)}</td><td style="text-align:left"><span class="link">${e.name}</span> <span class="muted" style="font-size:11px;font-family:var(--mono)">${e.isin}</span></td><td>${money(e.amount)}</td></tr>`).join("");
  const week = `<div class="imp-week"><div class="imp-week-h"><span>📅 Ближайшая неделя <span class="muted" style="font-weight:400;font-size:11px">· 7 дней, все типы</span></span><b>${money(wk.total)}</b></div>
    <div class="tbl-wrap"><table><thead><tr><th>Дата</th><th style="text-align:left">Тип</th><th style="text-align:left">Выпуск</th><th>Сумма</th></tr></thead><tbody>${wkRows || `<tr><td colspan="4" class="muted">на неделе выплат нет</td></tr>`}</tbody></table></div></div>`;
  const groups = [["coupons", "Купоны", "#35d6e6"], ["offers", "Оферты", "#8b7bff"], ["redemptions", "Погашения / амортизация", "#f5b13c"]];
  const gh = groups.map(([k, label, color]) => {
    const g = d.important[k] || { total: 0, count: 0, events: [] };
    const rows = g.events.map(e => `<tr data-isin="${e.isin}"><td>${dmy(e.date)}</td><td style="text-align:left"><span class="link">${e.name}</span> <span class="muted" style="font-size:11px;font-family:var(--mono)">${e.isin}</span>${e.offer_type ? ` <span class="muted" style="font-size:10px">${e.offer_type}</span>` : ""}</td><td>${money(e.amount)}</td></tr>`).join("");
    return `<details class="imp-grp"><summary><span style="color:${color};font-size:14px">●</span> ${label} <span class="muted">· ${g.count}</span><b class="imp-total">${money(g.total)}</b></summary>
      <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th>Дата</th><th style="text-align:left">Выпуск</th><th>Сумма</th></tr></thead><tbody>${rows || `<tr><td colspan="3" class="muted">нет ближайших</td></tr>`}</tbody></table></div></details>`;
  }).join("");
  body.innerHTML = week + gh;
  body.querySelectorAll("tr[data-isin]").forEach(tr => tr.onclick = () => openIssue(tr.dataset.isin));
}
const EVT_RU = { coupon: ["купон", "#35d6e6"], offer: ["оферта", "#8b7bff"], amortization: ["амортизация", "#f5b13c"], maturity: ["погашение", "#f5b13c"] };
function eventTypeBadge(e) {
  const [lbl, color] = EVT_RU[e.type] || [e.type || "выплата", "#8aa"];
  return `<span class="evt-badge" style="color:${color};border-color:${color}55">${lbl}${e.offer_type ? ` (${e.offer_type})` : ""}</span>`;
}

// ---------- Structure ----------
// подсказка доната: сегмент + состав бумаг внутри него
function allocTip(p) {
  let s = `<b>${p.name}</b>: ${money(p.value)} (${pct(p.percent)})`;
  const its = (p.data && p.data.items) || [];
  if (its.length) {
    s += `<div style="margin-top:5px;padding-top:4px;border-top:1px solid rgba(255,255,255,.12);font-size:11px;opacity:.85">`;
    its.slice(0, 8).forEach(x => s += `${x.name} · ${money(x.value)}<br/>`);
    if (its.length > 8) s += `<span style="opacity:.6">…ещё ${its.length - 8}</span>`;
    s += `</div>`;
  }
  return s;
}
// донат аллокации с составом бумаг в подсказке (общий для AUM и клиента)
function allocDonut(node, slices, colors) {
  if (!node || !(slices || []).length) return;
  mkChart(node, {
    ...CHART_BG,
    tooltip: { trigger: "item", formatter: allocTip },
    legend: { bottom: 0, icon: "circle", itemWidth: 9, itemHeight: 9, textStyle: { color: cssVar("--text", "#eef4f1"), fontSize: 11.5 } },
    series: [{
      type: "pie", radius: ["48%", "74%"], center: ["50%", "44%"], avoidLabelOverlap: true,
      itemStyle: { borderColor: cssVar("--panel", "#0f1512"), borderWidth: 2, borderRadius: 4 },
      data: slices.map((i, ix) => ({ name: i.name, value: i.value, items: i.items || [], itemStyle: { color: colors[ix % colors.length] } })),
      label: { color: cssVar("--text", "#eef4f1"), fontWeight: 700, fontSize: 12, formatter: "{d}%" },
      labelLine: { length: 8, length2: 8, lineStyle: { color: cssVar("--muted", "#8aa") } },
    }],
  });
}
const ALLOC_COLORS = ["#1fe0a0", "#35d6e6", "#8b7bff", "#f5b13c"];
const INSTR_COLORS = ["#1fe0a0", "#f5b13c", "#35d6e6", "#8b7bff"];
// аллокация клиента из его позиций (классы активов + типы облигаций), с составом сегментов
function clientAllocation(rows) {
  const alloc = {}, instr = {}, aI = {}, iI = {};
  const add = (m, items, seg, r, mv) => { m[seg] = (m[seg] || 0) + mv; (items[seg] = items[seg] || []).push({ name: r.name || r.isin, value: mv }); };
  (rows || []).forEach(r => {
    const mv = r.market_value || 0; if (!mv) return;
    if (r.is_bond === false) { add(alloc, aI, r.kind === "fund" ? "Фонды" : "Акции", r, mv); return; }
    add(alloc, aI, "Облигации", r, mv);
    const ccy = (r.currency || "RUB").toUpperCase(), nm = (r.name || "").toUpperCase();
    const seg = !["RUB", "SUR", "RUR"].includes(ccy) ? "Валютные"
      : (nm.startsWith("ОФЗ") || nm.startsWith("РФ ") || nm.startsWith("ГОСОБЛ")) ? "ОФЗ"
        : r.is_float ? "Корп. флоатеры" : "Корп. фикс";
    add(instr, iI, seg, r, mv);
  });
  const toArr = (m, items) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({
    name, value: Math.round(value),
    items: (items[name] || []).sort((a, b) => b.value - a.value).slice(0, 8).map(x => ({ name: x.name, value: Math.round(x.value) })),
  }));
  return { allocation: toArr(alloc, aI), by_instrument: toArr(instr, iI) };
}
// бакет срока до погашения (те же границы, что и в бэкенде _by_maturity_bucket)
function matBucket(md) {
  if (!md || md === "0000-00-00") return "н/д";
  const y = (new Date(md) - new Date()) / (365 * 864e5);
  if (isNaN(y)) return "н/д";
  return y < 1 ? "< 1 год" : y < 3 ? "1–3 года" : y < 5 ? "3–5 лет" : "> 5 лет";
}
// облигации, попадающие в выбранный сегмент диаграммы
function positionsInSlice(key, name) {
  const rows = (DATA.positions || []).filter(r => r.is_bond !== false && r.market_value);
  if (key === "sector") return rows.filter(r => (r.sector || "—") === name);
  if (key === "rating") return rows.filter(r => (r.rating_bucket || "—") === name);
  if (key === "currency") return rows.filter(r => { let c = r.currency || "RUB"; if (c === "SUR" || c === "RUR") c = "RUB"; return c === name; });
  if (key === "maturity") return rows.filter(r => matBucket(r.matdate) === name);
  return rows;
}
// всплывающее окно со списком бумаг выбранного сегмента
function openSliceModal(title, rows) {
  rows = (rows || []).slice().sort((a, b) => (b.market_value || 0) - (a.market_value || 0));
  const tot = rows.reduce((s, r) => s + (r.market_value || 0), 0);
  const body = rows.length ? rows.map(r => `<tr data-isin="${r.isin}"><td style="text-align:left"><span class="link">${r.name || r.isin}</span></td>
    <td class="muted" style="font-family:var(--mono);font-size:11px">${r.isin || ""}</td><td>${ccyShort(r.currency)}</td><td>${ratingCell(r)}</td>
    <td>${fmt(r.quantity)}</td><td>${ytmCell(r)}</td><td>${money(r.market_value)}</td></tr>`).join("")
    : `<tr><td colspan="7" class="muted">нет бумаг</td></tr>`;
  const ov = el(`<div class="modal-ov"><div class="modal" style="width:min(880px,96vw)">
    <div class="modal-title">${title} <span class="muted" style="font-weight:400;font-size:12px">· ${rows.length} бумаг · ${money(tot)}</span><span class="link" data-close style="float:right;font-size:18px">✕</span></div>
    <div class="tbl-wrap" style="max-height:60vh;overflow:auto"><table><thead><tr><th style="text-align:left">Бумага</th><th>ISIN</th><th>Валюта</th><th>Рейтинг</th><th>Кол-во</th><th>YTM</th><th>Стоимость</th></tr></thead><tbody>${body}</tbody></table></div>
  </div></div>`);
  document.body.appendChild(ov);
  ov.onclick = (e) => { if (e.target === ov || e.target.closest("[data-close]")) ov.remove(); };
  ov.querySelectorAll("tr[data-isin]").forEach(tr => tr.onclick = () => { ov.remove(); openIssue(tr.dataset.isin); });
}

// перцентиль ряда (0..1) линейной интерполяцией по отсортированному массиву
function _pctile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
// всплывашка «премия за кредитный риск»: перцентиль / z / медиана / диапазон + история G-спреда
async function openGspreadModal(isin, name) {
  const ov = el(`<div class="modal-ov"><div class="modal" style="width:min(860px,96vw)">
    <div class="modal-title">${name || isin} · премия за кредитный риск <span class="muted" style="font-weight:400;font-size:12px">· G-спред к КБД</span><span class="link" data-close style="float:right;font-size:18px">✕</span></div>
    <div id="gs-body"><div class="loading" style="padding:26px"></div></div></div></div>`);
  document.body.appendChild(ov);
  ov.onclick = (e) => { if (e.target === ov || e.target.closest("[data-close]")) ov.remove(); };
  const body = ov.querySelector("#gs-body");
  let h = null;
  try { h = await fetch(`${API}/api/instrument/${isin}/history`).then(x => x.json()); } catch (e) { }
  const series = ((h && h.gspread_kbd) || []).filter(p => p[1] != null);
  if (series.length < 8) { body.innerHTML = `<div class="muted" style="padding:20px">Недостаточно истории G-спреда для оценки.</div>`; return; }
  const vals = series.map(p => p[1]);
  const sorted = [...vals].sort((a, b) => a - b);
  const cur = vals[vals.length - 1];
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
  const z = (cur - mean) / std;
  const median = Math.round(_pctile(sorted, 0.5)), p5 = Math.round(_pctile(sorted, 0.05)), p95 = Math.round(_pctile(sorted, 0.95));
  const mn = sorted[0], mx = sorted[sorted.length - 1];
  const percentile = Math.round(100 * vals.filter(v => v <= cur).length / vals.length);
  let verdict, vc;
  if (percentile >= 85) { verdict = "Спред у исторического максимума — шире обычного, кандидат на докупку под сужение"; vc = "var(--pos,#2fe08a)"; }
  else if (percentile <= 15) { verdict = "Спред у исторического минимума — уже обычного, премия мала (дорого)"; vc = "var(--neg,#ff6b6b)"; }
  else { verdict = "Спред около медианы — нейтрально"; vc = "var(--muted,#8aa)"; }
  const kpi = (l, v, s) => `<div class="kpi"><div class="label">${l}</div><div class="value" style="font-size:22px">${v}</div>${s ? `<div class="sub">${s}</div>` : ""}</div>`;
  body.innerHTML = `<div class="kpis" style="margin:0 0 12px">
      ${kpi("Сейчас", bp(cur), `за ${vals.length} дней`)}
      ${kpi("Перцентиль", percentile, "0=минимум · 100=максимум")}
      ${kpi("z-score", (z >= 0 ? "+" : "") + fmt(z, 1) + "σ", "отклонение от среднего")}
      ${kpi("Медиана", bp(median), `диапазон ${bp(mn)}…${bp(mx)}`)}
    </div>
    <div class="alert" style="border-left:3px solid ${vc};background:color-mix(in srgb,${vc} 10%,transparent);margin:0 0 12px"><b style="color:${vc}">${verdict}</b></div>
    <div class="panel" style="margin:0"><h3 style="font-size:13px">История G-спреда <span class="muted" style="font-weight:400;font-size:11px">· полосы: медиана, P5, P95</span></h3><div class="chart" id="gs-chart" style="height:300px"></div></div>`;
  setTimeout(() => mkChart(body.querySelector("#gs-chart"), {
    ...CHART_BG, tooltip: { trigger: "axis", valueFormatter: v => bp(Math.round(v)) },
    grid: { left: 54, right: 78, top: 16, bottom: 26 },
    xAxis: { type: "time", ...AX }, yAxis: { type: "value", scale: true, ...AX, axisLabel: { color: AXIS_TXT, formatter: v => v + "бп" } },
    series: [{
      type: "line", data: series, smooth: true, symbol: "none", lineStyle: { width: 2, color: "#8b7bff" },
      itemStyle: { color: "#8b7bff" },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "#8b7bff40" }, { offset: 1, color: "#8b7bff00" }]) },
      markLine: {
        silent: true, symbol: "none",
        data: [
          { yAxis: median, lineStyle: { color: cssVar("--muted", "#8aa"), type: "solid", width: 1 }, label: { formatter: "медиана " + median, color: cssVar("--muted", "#8aa"), fontSize: 10, position: "end", distance: 5 } },
          { yAxis: p95, lineStyle: { color: "#f5b13c", type: "dashed", width: 1 }, label: { formatter: "P95 " + p95, color: "#f5b13c", fontSize: 10, position: "end", distance: 5 } },
          { yAxis: p5, lineStyle: { color: "#35d6e6", type: "dashed", width: 1 }, label: { formatter: "P5 " + p5, color: "#35d6e6", fontSize: 10, position: "end", distance: 5 } },
        ],
      },
    }],
  }), 30);
}

function renderStructure(v) {
  const st = DATA.structure;
  const pie = (title, key, items) => {
    const node = el(`<div class="panel"><h3>${title} <span class="muted" style="font-weight:400;font-size:11px">· клик по сегменту — список бумаг</span></h3><div class="chart" style="cursor:pointer"></div></div>`);
    setTimeout(() => {
      const ch = mkChart(node.querySelector(".chart"), {
        ...CHART_BG, tooltip: { trigger: "item", formatter: p => {
          let s = `<b>${p.name}</b>: ${money(p.value)} (${pct(p.percent)})`;
          const rows = positionsInSlice(key, p.name).slice().sort((a, b) => (b.market_value || 0) - (a.market_value || 0)).slice(0, 8);
          if (rows.length) { s += `<div style="margin-top:5px;padding-top:4px;border-top:1px solid rgba(255,255,255,.12);font-size:11px;opacity:.85">`; rows.forEach(r => s += `${r.name || r.isin} · ${money(r.market_value)}<br/>`); s += `</div>`; }
          return s;
        } },
        series: [{ type: "pie", radius: ["35%", "68%"], data: items.map(i => ({ name: i.name, value: i.value })),
          label: { color: cssVar("--text", "#eef4f1"), fontWeight: 600, fontSize: 12.5, formatter: "{b}: {d}%" },
          labelLine: { lineStyle: { color: cssVar("--muted", "#8aa") } } }], color: PALETTE,
      });
      ch.on("click", p => openSliceModal(`${title}: ${p.name}`, positionsInSlice(key, p.name)));
    }, 0);
    return node;
  };
  const g = el(`<div class="grid2"></div>`);
  g.append(
    pie("По сектору", "sector", st.by_sector),
    pie("По рейтингу", "rating", st.by_rating),
    pie("По валюте", "currency", st.by_currency),
    pie("По сроку до погашения", "maturity", st.by_maturity),
  );
  v.appendChild(g);
}

// ---------- Bonds table ----------
let sortKey = "market_value", sortDir = -1, filterText = "";
function renderBonds(v) {
  const tb = el(`<div class="toolbar">
    <input type="text" id="flt" placeholder="Поиск по названию / ISIN" />
    <a class="btn ghost" href="${API}/api/reports/portfolio.xlsx${pidQ()}" download style="font-size:12.5px;padding:7px 14px">⭳ Выгрузить в Excel</a>
    <span class="muted">Позиции с ISIN + денежный поток по месяцам</span>
  </div>`);
  v.appendChild(tb);
  tb.querySelector("#flt").value = filterText;
  tb.querySelector("#flt").oninput = e => { filterText = e.target.value.toLowerCase(); drawBondsTable(v); };
  const wrap = el(`<div class="tbl-wrap panel"><table id="bt"></table></div>`);
  v.appendChild(wrap);
  drawBondsTable(v);
}

const COLS = [
  ["name", "Бумага"], ["isin", "ISIN"], ["currency", "Валюта"], ["kind", "Тип купона"], ["rating_bucket", "Рейтинг"],
  ["quantity", "Кол-во"], ["market_value", "Стоимость"],
  ["ytm", "YTM"], ["duration_years", "Дюр., лет"],
];
const CCY_SHORT = { RUB: "RUB", SUR: "RUB", RUR: "RUB", USD: "USD", EUR: "EUR", CNY: "CNY", GBP: "GBP", CHF: "CHF", JPY: "JPY" };
const ccyShort = c => CCY_SHORT[c] || c || "RUB";
// YTM для флоатера не показателен → показываем текущую доходность с пометкой
function ytmCell(r) {
  if (r.is_float) {
    return r.current_yield == null ? "—" : `${fmt(r.current_yield, 2)}% <span class="muted" style="font-size:10px" title="текущая доходность: годовой купон / цена">тек.</span>`;
  }
  return pct(r.ytm);
}
// рейтинг: цветной бейдж по бакету (использует общий RATING_COLOR)
function ratingCell(r) {
  if (r.is_bond === false) return `<span class="muted">—</span>`;
  const b = r.rating_bucket;
  if (!b || b === "NR") return `<span class="muted" style="font-size:11px">н/р</span>`;
  const c = RATING_COLOR[b] || "#8aa";
  return `<span class="rate-badge" style="color:${c};border-color:${c}55">${b}</span>`;
}
// цена: облигации — % номинала, акции/фонды — в рублях
function priceCell(r, v) {
  if (v == null) return "—";
  return r.is_bond === false ? fmt(v, 2) + " ₽" : pct(v);
}
function kindBadge(r) {
  if (r.is_bond === false) {
    const l = r.kind === "fund" ? "фонд" : r.kind === "share" ? "акция" : "инстр.";
    return `<span class="badge none">${l}</span>`;
  }
  if (r.is_float) return `<span class="badge float">флоатер</span>`;
  if (r.kind === "fixed" || r.kind === "fix") return `<span class="badge fix">фикс</span>`;
  return `<span class="badge">${r.kind || "—"}</span>`;
}
function drawBondsTable(v) {
  let rows = DATA.positions.filter(r =>
    !filterText || (r.name || "").toLowerCase().includes(filterText) || (r.isin || "").toLowerCase().includes(filterText));
  // по колонке YTM у флоатеров сортируем по текущей доходности (как и показываем)
  const sortVal = r => (sortKey === "ytm" && r.is_float) ? r.current_yield : r[sortKey];
  rows.sort((a, b) => {
    const ba = a.is_bond === false ? 1 : 0, bb = b.is_bond === false ? 1 : 0;
    if (ba !== bb) return ba - bb;              // сначала облигации, потом акции/фонды
    const x = sortVal(a), y = sortVal(b);
    if (x == null) return 1; if (y == null) return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * sortDir;
  });
  const t = v.querySelector("#bt");
  t.innerHTML = `<thead><tr>${COLS.map(([k, l]) =>
    `<th data-k="${k}">${l}${sortKey === k ? (sortDir < 0 ? " ▾" : " ▴") : ""}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(rowHtml).join("")}</tbody>`;
  t.querySelectorAll("th").forEach(th => th.onclick = () => {
    const k = th.dataset.k; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = -1; }
    drawBondsTable(v);
  });
  t.querySelectorAll("[data-isin]").forEach(a => a.onclick = () => openIssue(a.dataset.isin));
}
function rowHtml(r) {
  return `<tr>
    <td><span class="link" data-isin="${r.isin}">${r.name || r.isin}</span></td>
    <td>${r.isin}</td><td>${ccyShort(r.currency)}</td><td>${kindBadge(r)}</td><td>${ratingCell(r)}</td><td>${fmt(r.quantity)}</td><td>${money(r.market_value)}</td>
    <td>${ytmCell(r)}</td>
    <td>${r.duration_years == null ? "—" : fmt(r.duration_years, 2)}</td></tr>`;
}
function exportCsv() {
  const head = COLS.map(c => c[1]).join(";");
  const lines = DATA.positions.map(r => COLS.map(([k]) => r[k] ?? "").join(";"));
  const blob = new Blob(["﻿" + head + "\n" + lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "portfolio.csv"; a.click();
}

// ---------- Cashflows ----------
const CF = { path: null, anchors: null, start: null, res: null, _pf: null, loading: false };
// базовый сценарий по умолчанию: к концу текущего года 13%, следующего — 12%, через год — 10%
// (пользователь меняет якоря сам)
const BASE_ANCHORS = { y26: 13, y27: 12, y28: 10 };
// якоря сценария — конец ТЕКУЩЕГО года и двух следующих (ключи y26/y27/y28 исторические:
// «год 0 / 1 / 2»); раньше годы 2026–2028 были зашиты и с 2027 года сценарий ломался
const ANCH_Y0 = new Date().getFullYear();
const ANCH_LBL = [["start", "сейчас"], ["y26", `конец ${ANCH_Y0}`], ["y27", `конец ${ANCH_Y0 + 1}`], ["y28", `конец ${ANCH_Y0 + 2}`]];
function interpPath(raw, start, anchors) {
  if (!raw || !raw.length) return [];
  const A = [[Date.parse(raw[0].date), start], [Date.parse(`${ANCH_Y0}-12-31`), anchors.y26],
             [Date.parse(`${ANCH_Y0 + 1}-12-31`), anchors.y27], [Date.parse(`${ANCH_Y0 + 2}-12-31`), anchors.y28]];
  return raw.map(p => {
    const t = Date.parse(p.date); let r = A[A.length - 1][1];
    if (t <= A[0][0]) r = A[0][1];
    else for (let i = 0; i < A.length - 1; i++) if (t >= A[i][0] && t <= A[i + 1][0]) { const f = (t - A[i][0]) / (A[i + 1][0] - A[i][0]); r = A[i][1] + f * (A[i + 1][1] - A[i][1]); break; }
    return { ...p, rate: Math.max(0, +r.toFixed(2)) };
  });
}
function cfInterp() { CF.path = interpPath(CF.path, CF.start, CF.anchors); }
// подсказка для помесячных графиков сценария: сумма + разбивка по выпускам
function cfMonthTip(byMonth, field, label) {
  return (ps) => {
    const m = byMonth[ps[0].dataIndex]; if (!m) return "";
    const val = field === "coupon" ? m.coupon : m.nominal;
    let s = `<b>${mmy(m.month)}</b><br/>${ps[0].marker}${label}: ${money(val)}<br/>`;
    const its = (m.items || []).filter(x => (field === "coupon" ? x.coupon : x.nominal) > 0);
    if (its.length) {
      s += `<div style="margin-top:5px;padding-top:4px;border-top:1px solid rgba(255,255,255,.12);font-size:11px;opacity:.85">`;
      its.forEach(x => { s += `${x.name} <span style="opacity:.6">${x.isin}</span>: ${money(field === "coupon" ? x.coupon : x.nominal)}<br/>`; });
      s += `</div>`;
    }
    return s;
  };
}
async function cfCompute() {
  try {
    const r = await fetch(`${API}/api/portfolio/cashflows_scenario`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rate_path: CF.path, pid: PF_PID, ccy: PF_CCY }) }).then(x => x.json());
    CF.res = (r && r.by_month) ? r : { error: true };   // сентинел, чтобы не зациклить рендер
  } catch (e) { CF.res = { error: true }; }
}
async function renderCashflows(v) {
  // init the rate path (CBR meetings, flat current key rate) once per portfolio
  if (!CF.path || CF._pf !== DATA.portfolio.id) {
    CF._pf = DATA.portfolio.id; CF.res = null;
    try { const m = await fetch(`${API}/api/cbr_meetings`).then(x => x.json()); CF.path = m.path || []; const c0 = (CF.path[0]?.rate) ?? 14; CF.start = c0; CF.anchors = { y26: BASE_ANCHORS.y26, y27: BASE_ANCHORS.y27, y28: BASE_ANCHORS.y28 }; cfInterp(); } catch (e) { CF.path = []; }
  }
  // rate-path control (anchors → floater coupons projected)
  const rp = el(`<div class="panel"><h3>Траектория ставки ЦБ <span class="muted" style="font-weight:400;font-size:12px">· кэшфлоу флоатеров пересчитывается под сценарий</span></h3>
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end">
      ${ANCH_LBL.map(([k, l]) => `<div style="display:flex;flex-direction:column;gap:4px"><label class="muted" style="font-size:11px">${l}</label><input type="number" step="0.25" data-a="${k}" value="${k === "start" ? CF.start : CF.anchors[k]}" style="width:98px;font-size:15px"></div>`).join("")}
      <span class="muted" style="font-size:11px;padding-bottom:6px">задай ставку на конец года — фиксы не меняются, флоатеры пересчитываются</span>
    </div></div>`);
  v.appendChild(rp);
  rp.querySelectorAll("input[data-a]").forEach(inp => inp.oninput = debounce(async e => {
    const k = e.target.dataset.a, val = parseFloat(e.target.value);
    if (isNaN(val)) return;
    if (k === "start") CF.start = val; else CF.anchors[k] = val;
    cfInterp(); await cfCompute(); render();
  }, 500));

  if (!CF.res) { v.appendChild(el(`<div class="loading">Считаю денежный поток по сценарию…</div>`)); await cfCompute(); return render(); }
  if (CF.res.error || !CF.res.by_month) { v.appendChild(el(`<div class="alert error">Не удалось рассчитать денежный поток. Обнови рынок и попробуй ещё раз.</div>`)); return; }
  const cf = CF.res;
  if (cf.projected_floaters) v.appendChild(el(`<div class="muted" style="font-size:12px;margin-bottom:10px">Купоны <b>${cf.projected_floaters}</b> флоатер(ов) спрогнозированы по траектории ставки; фиксы — по точному графику MOEX.</div>`));
  // horizon totals (next 30/90/365 days, all future) with exact vs projected split
  if (cf.horizons?.length) {
    v.appendChild(el(`<div class="kpis">${cf.horizons.map(h => `<div class="kpi"><div class="label">Выплаты · ${h.label}</div>
      <div class="value">${money(h.total)}</div><div class="sub">купоны ${money(h.coupon)}${h.nominal ? ` · погашения ${money(h.nominal)}` : ""}${h.projected ? ` · в т.ч. прогноз ${money(h.projected)}` : ""}</div></div>`).join("")}</div>`));
  }
  const months = cf.by_month.map(m => m.month);
  const c1 = el(`<div class="panel"><h3>Купонные выплаты по месяцам</h3><div class="chart"></div></div>`);
  const c2 = el(`<div class="panel"><h3>Погашения и амортизация номинала</h3><div class="chart"></div></div>`);
  v.append(c1, c2);
  mkChart(c1.querySelector(".chart"), {
    ...CHART_BG, tooltip: { trigger: "axis", formatter: cfMonthTip(cf.by_month, "coupon", "Купоны") },
    grid: { left: 75, right: 20, top: 20, bottom: 50 },
    xAxis: { type: "category", data: months.map(mmy), axisLabel: { rotate: 45 }, ...AX }, yAxis: { type: "value", ...AX, axisLabel: { color: AXIS_TXT, formatter: moneyM }, splitLine: { show: false } },
    series: [{ name: "Купоны", type: "bar", data: cf.by_month.map(m => m.coupon || null), itemStyle: { color: PALETTE[1] } }],
  });
  mkChart(c2.querySelector(".chart"), {
    ...CHART_BG, tooltip: { trigger: "axis", formatter: cfMonthTip(cf.by_month, "nominal", "Номинал") },
    grid: { left: 75, right: 20, top: 20, bottom: 50 },
    xAxis: { type: "category", data: months.map(mmy), axisLabel: { rotate: 45 }, ...AX }, yAxis: { type: "value", ...AX, axisLabel: { color: AXIS_TXT, formatter: moneyM }, splitLine: { show: false } },
    series: [{ name: "Номинал", type: "bar", data: cf.by_month.map(m => m.nominal || null), itemStyle: { color: PALETTE[3] } }],
  });
  const up = el(`<div class="panel"><h3>Ближайшие выплаты</h3><div class="tbl-wrap"><table>
    <thead><tr><th>Дата</th><th>Бумага</th><th>Тип</th><th>Купон</th><th>Номинал</th><th>Итого</th></tr></thead>
    <tbody>${cf.upcoming.map(e => `<tr><td>${dmy(e.date)}</td><td style="text-align:left">${e.name} ${e.source === "projected" ? '<span class="badge" style="font-size:9px;background:rgba(245,177,60,.14);color:var(--amber,#f5b13c)">прогноз</span>' : '<span class="badge" style="font-size:9px">MOEX</span>'}</td>
      <td>${e.type === "coupon" ? "купон" : e.type === "maturity" ? "погашение" : "амортизация"}</td>
      <td>${e.coupon ? money(e.coupon) : "—"}</td><td>${e.nominal ? money(e.nominal) : "—"}</td>
      <td>${money(e.amount)}</td></tr>`).join("")}</tbody>
  </table></div></div>`);
  v.appendChild(up);
}

// ---------- Yield ----------
function renderDataQuality(v, q) {
  const cov = q.coverage || {};
  const sc = q.score >= 80 ? "var(--pos,#2fe08a)" : q.score >= 50 ? "var(--amber,#f5b13c)" : "var(--neg,#ff5470)";
  const covLbl = { price: "цена", ytm: "YTM", duration: "дюрация", rating: "рейтинг", maturity: "погашение" };
  const lvlLbl = { error: "ошибка", warn: "предупр.", info: "инфо" };
  const panel = el(`<div class="panel"><h3>Качество данных <span class="muted" style="font-weight:400;font-size:12px">· проверки и покрытие</span></h3>
    <div class="kpis" style="margin:0 0 12px">
      <div class="kpi"><div class="label">Индекс качества</div><div class="value" style="color:${sc}">${q.score}<span style="font-size:15px;color:var(--muted)">/100</span></div><div class="sub">${q.counts.error} ошиб. · ${q.counts.warn} предупр. · ${q.counts.info} инфо</div></div>
      ${["price", "ytm", "duration", "rating", "maturity"].map(k => `<div class="kpi"><div class="label">Покрытие: ${covLbl[k]}</div><div class="value">${cov[k] ?? 0}%</div></div>`).join("")}
    </div>
    <div id="dq-issues"></div></div>`);
  v.appendChild(panel);
  const host = panel.querySelector("#dq-issues");
  if (!q.issues.length) { host.innerHTML = `<div class="muted">Проблем не найдено 👍</div>`; return; }
  const rows = q.issues.map(i => `<tr><td><span class="alert ${i.level}" style="display:inline-block;padding:1px 8px;font-size:11px">${lvlLbl[i.level]}</span></td>
    <td style="text-align:left">${i.text}${i.blocked ? ' <span class="muted" style="font-size:10px">(блокирует расчёт)</span>' : ""}</td></tr>`).join("");
  host.innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Уровень</th><th style="text-align:left">Проблема</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderYield(v) {
  const s = DATA.summary;
  v.appendChild(el(`<div class="kpis">
    <div class="kpi"><div class="label">YTM портфеля</div><div class="value">${pct(s.ytm)}</div></div>
    <div class="kpi"><div class="label">P/L итог (с купонами)</div><div class="value ${cls(s.pl)}">${money(s.pl)}</div><div class="sub ${cls(s.pl_pct)}">${pct(s.pl_pct)}</div></div>
    <div class="kpi"><div class="label">Купонный доход</div><div class="value pos">${money(s.coupons_received)}</div></div>
    <div class="kpi"><div class="label">Переоценка цены</div><div class="value ${cls(s.pl_price)}">${money(s.pl_price)}</div></div>
  </div>`));
  // time-weighted / money-weighted return + benchmark (RGBITR)
  const perfNode = el(`<div id="pf-perf"></div>`);
  v.appendChild(perfNode);
  loadPerformance(perfNode);
  // Decomposition of total P&L: price revaluation vs coupons received.
  const reval = s.pl_price ?? 0, coup = s.coupons_received ?? 0;
  const c = el(`<div class="panel"><h3>Из чего сложился результат</h3><div class="chart"></div></div>`);
  v.appendChild(c);
  mkChart(c.querySelector(".chart"), {
    ...CHART_BG, tooltip: { trigger: "axis" }, grid: { left: 80, right: 20, top: 20, bottom: 30 },
    xAxis: { type: "category", data: ["Переоценка цены", "Полученные купоны", "Итого P/L"] },
    yAxis: { type: "value" },
    series: [{ type: "bar", data: [
      { value: Math.round(reval), itemStyle: { color: reval >= 0 ? PALETTE[1] : PALETTE[3] } },
      { value: Math.round(coup), itemStyle: { color: PALETTE[0] } },
      { value: Math.round(reval + coup), itemStyle: { color: PALETTE[5] } },
    ] }],
  });
  // Portfolio value dynamics (reconstructed from MOEX history of every holding).
  const dyn = el(`<div class="panel"><h3>Динамика стоимости портфеля</h3><div class="chart tall" id="dyn"></div><div id="dyn-msg" class="muted">Загрузка истории…</div></div>`);
  v.appendChild(dyn);
  fetch(`${API}/api/portfolio/current/timeseries${pidQ()}`).then(x => x.json()).then(ts => {
    dyn.querySelector("#dyn-msg").remove();
    if (!ts.dates || !ts.dates.length) { dyn.querySelector("#dyn").outerHTML = `<div class="muted">Недостаточно истории.</div>`; return; }
    mkChart(dyn.querySelector("#dyn"), {
      ...CHART_BG, tooltip: { trigger: "axis", valueFormatter: v => money(v) },
      grid: { left: 80, right: 20, top: 20, bottom: 40 },
      xAxis: { type: "category", data: ts.dates },
      yAxis: { type: "value", scale: true },
      series: [{ type: "line", smooth: true, showSymbol: false, areaStyle: { opacity: .12 },
        data: ts.values, itemStyle: { color: PALETTE[0] }, lineStyle: { color: PALETTE[0] } }],
    });
  }).catch(() => {});
}

async function loadPerformance(node) {
  node.innerHTML = `<div class="panel"><h3>Доходность во времени <span class="muted" style="font-weight:400;font-size:12px">· TWR / MWR · бенчмарк RGBITR (ОФЗ)</span></h3><div class="loading" style="padding:18px"></div></div>`;
  let d = null;
  try { d = await fetch(`${API}/api/portfolio/performance${pidQ()}`).then(x => x.json()); } catch (e) { }
  if (!d || d.detail) { node.querySelector(".panel").innerHTML = `<h3>Доходность во времени</h3><div class="muted">${d?.detail || "Недостаточно истории"}</div>`; return; }
  const b = d.benchmark || {};
  const alpha = b.alpha_pct;
  node.querySelector(".panel").innerHTML = `<h3>Доходность во времени <span class="muted" style="font-weight:400;font-size:12px">· ${dmy(d.from)} → ${dmy(d.till)}</span></h3>
    <div class="kpis" style="margin:0 0 12px">
      <div class="kpi"><div class="label">TWR (взвеш. по времени)</div><div class="value ${cls(d.twr_pct)}">${pct(d.twr_pct)}</div><div class="sub">годовых ${pct(d.twr_annualized_pct)}</div></div>
      <div class="kpi"><div class="label">MWR / XIRR (по деньгам)</div><div class="value ${cls(d.mwr_pct)}">${pct(d.mwr_pct)}</div><div class="sub">с учётом дат вводов</div></div>
      <div class="kpi"><div class="label">Бенчмарк ${b.name || "RGBITR"}</div><div class="value">${pct(b.return_pct)}</div><div class="sub">ОФЗ, полная доходность</div></div>
      <div class="kpi"><div class="label">Альфа к бенчмарку</div><div class="value ${cls(alpha)}">${alpha == null ? "—" : (alpha >= 0 ? "+" : "") + fmt(alpha, 2) + " п.п."}</div></div>
    </div>
    <div class="chart tall" id="perf-chart"></div>
    <div class="muted" style="font-size:11.5px;margin-top:6px">TWR очищен от дат вводов/выводов (как шли сами бумаги); MWR учитывает, когда вы заводили деньги. Купоны учтены как доход${d.coupons_total ? ` (получено ${money(d.coupons_total)})` : ""}.</div>`;
  const series = [{ name: "Портфель", type: "line", showSymbol: false, data: d.series, lineStyle: { width: 2.4, color: "#1fe0a0" }, areaStyle: { color: "rgba(31,224,160,.10)" } }];
  if (b.series?.length) series.push({ name: b.name, type: "line", showSymbol: false, data: b.series, lineStyle: { width: 1.8, color: "#8b7bff", type: "dashed" } });
  mkChart(node.querySelector("#perf-chart"), {
    ...CHART_BG, tooltip: { trigger: "axis", valueFormatter: v => pct(v) },
    legend: { data: series.map(s => s.name), top: 0, textStyle: { color: cssVar("--muted", "#83968f") } },
    grid: { left: 56, right: 18, top: 30, bottom: 30 },
    xAxis: { type: "time", ...AX },
    yAxis: { type: "value", name: "накопл. доходность, %", nameTextStyle: { align: "right", padding: [0, 8, 0, 0] }, ...AX },
    series,
  });
}

// ---------- Risk ----------
const STRESS = { res: null, shock: null };
const FACTOR_RU = { rate: "Ставка", convexity: "Выпуклость", credit: "Кред. спред", rating: "Рейтинг-миграция", concentration: "Концентрация", fx: "Валюта" };
const RATING_HAIRCUTS = { BBB: 1, BB: 4, B: 8, CCC: 15, CC: 20, C: 25, D: 40, NR: 6 };
// Client-side stress reprice — mirrors backend portfolio_risk.stress so the shock
// sliders recompute instantly (no round-trip, no dashboard rebuild = no lag).
function computeStress(positions, shock, concentration) {
  const rate = +shock.rate_shock_bp || 0, credit = +shock.credit_shock_bp || 0,
        fx = +shock.fx_shock_pct || 0, conc = +shock.largest_issuer_haircut_pct || 0;
  const largestKey = concentration?.top?.[0]?.key || null;
  const comp = { rate: 0, convexity: 0, credit: 0, rating: 0, concentration: 0, fx: 0 };
  let dv01 = 0, mvTot = 0, mvDur = 0, mvRat = 0;
  const pos = [];
  for (const r of positions) {
    const mv = r.market_value || 0; if (mv <= 0) continue;
    mvTot += mv;
    const rd = r.rate_duration || 0, cd = r.credit_duration || 0, md = r.modified_duration || 0;
    const isFl = r.is_float, bkt = r.rating_bucket;
    const pRate = -mv * rd * rate / 10000;
    const pConv = isFl ? 0 : 0.5 * mv * md * (md + 1) * (rate / 10000) ** 2;
    const pCredit = -mv * cd * credit / 10000;
    const pRating = -mv * (RATING_HAIRCUTS[bkt] || (bkt ? 0 : RATING_HAIRCUTS.NR)) / 100;
    const pConc = (largestKey && r.issuer_key === largestKey) ? -mv * conc / 100 : 0;
    const pFx = (r.currency || "RUB") !== "RUB" ? -mv * fx / 100 : 0;
    dv01 += mv * rd / 10000; if (rd) mvDur += mv; if (bkt) mvRat += mv;
    comp.rate += pRate; comp.convexity += pConv; comp.credit += pCredit;
    comp.rating += pRating; comp.concentration += pConc; comp.fx += pFx;
    pos.push({ isin: r.isin, name: r.name, kind: r.kind, market_value: Math.round(mv),
      dv01: +(mv * rd / 10000).toFixed(1), rate_pl: Math.round(pRate), credit_pl: Math.round(pCredit),
      fx_pl: Math.round(pFx), total_pl: Math.round(pRate + pConv + pCredit + pRating + pConc + pFx) });
  }
  const total = Object.values(comp).reduce((a, b) => a + b, 0);
  pos.sort((a, b) => a.total_pl - b.total_pl);
  Object.keys(comp).forEach(k => comp[k] = Math.round(comp[k]));
  return { shock, dv01: +dv01.toFixed(1), components: comp, total_pl: Math.round(total),
    total_pl_pct: mvTot ? +(total / mvTot * 100).toFixed(2) : null, positions: pos,
    duration_coverage: mvTot ? +(mvDur / mvTot * 100).toFixed(1) : 0,
    rating_coverage: mvTot ? +(mvRat / mvTot * 100).toFixed(1) : 0, concentration };
}
async function renderRisk(v) {
  if (!STRESS.res || STRESS.res._pf !== DATA.portfolio.id) {
    STRESS.res = { ...(DATA.stress || {}), _pf: DATA.portfolio.id };
    STRESS.shock = { ...((DATA.stress || {}).shock || {}) };
  }
  const s = STRESS.res, c = DATA.concentration || s.concentration || {};
  const dur = DATA.risk?.duration_years;

  v.appendChild(el(`<div class="kpis">
    <div class="kpi"><div class="label">DV01 (на 1 б.п.)</div><div class="value">${money(s.dv01)}</div><div class="sub">параллельный сдвиг</div></div>
    <div class="kpi"><div class="label">Дюрация портфеля</div><div class="value">${fmt(dur, 2)} <span style="font-size:14px;color:var(--muted)">г.</span></div></div>
    <div class="kpi"><div class="label">HHI · эфф. эмитентов</div><div class="value">${fmt(c.hhi, 3)}</div><div class="sub">${fmt(c.effective_issuers, 1)} эмитента · крупнейший ${fmt(c.largest_share, 0)}%</div></div>
    <div class="kpi"><div class="label">Топ-5 эмитентов</div><div class="value">${fmt(c.top5_share, 0)}%</div><div class="sub">${c.n_issuers || 0} эмитентов всего</div></div>
  </div>`));

  // ---- interactive stress ----
  const sh = STRESS.shock;
  const panel = el(`<div class="panel"><h3>Стресс-тест портфеля <span class="muted" style="font-weight:400;font-size:12px">· разложение P&L по факторам</span></h3>
    <div style="display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end;margin-bottom:6px">
      ${[["rate_shock_bp", "Ставка, б.п.", 25], ["credit_shock_bp", "Кред. спред, б.п.", 25], ["fx_shock_pct", "Курс рубля, %", 1], ["largest_issuer_haircut_pct", "Хэйркат крупнейшего, %", 1]].map(([k, l, step]) =>
        `<div style="display:flex;flex-direction:column;gap:4px"><label class="muted" style="font-size:11px">${l}</label>
         <input type="number" step="${step}" data-sh="${k}" value="${sh[k]}" style="width:120px;font-size:15px"></div>`).join("")}
      <span class="muted" style="font-size:11px;padding-bottom:6px">курс: <b>−10</b> = рубль слабеет на 10% (валютные бумаги в плюс)</span>
    </div>
    <div style="display:flex;gap:22px;flex-wrap:wrap;align-items:baseline;margin:8px 0 4px">
      <div>Итоговый P&L: <b style="font-size:22px;color:${s.total_pl >= 0 ? "var(--pos,#2fe08a)" : "var(--neg,#ff5470)"}">${money(s.total_pl)}</b> <span class="muted">(${fmt(s.total_pl_pct, 2)}%)</span></div>
      <span class="muted" style="font-size:12px">покрытие: дюрация ${fmt(s.duration_coverage, 0)}% · рейтинг ${fmt(s.rating_coverage, 0)}%</span>
    </div>
    <div class="chart" id="rk-decomp" style="height:230px"></div>
    <div class="muted" style="font-size:11.5px;margin-top:8px">Флоатеры несут <b>кредитную</b> дюрацию (до погашения, кэп 5 лет), но почти нулевую <b>процентную</b> (до пересмотра купона) — поэтому шок ставки бьёт по ним слабо, а шок спреда — в полную силу.</div>
  </div>`);
  v.appendChild(panel);
  panel.querySelectorAll("input[data-sh]").forEach(inp => inp.oninput = debounce(e => {
    const k = e.target.dataset.sh, val = parseFloat(e.target.value);
    if (!isNaN(val)) STRESS.shock[k] = val;
    // recompute locally — instant, no network round-trip
    STRESS.res = { ...computeStress(DATA.positions, STRESS.shock, c), _pf: DATA.portfolio.id };
    render();
  }, 120));

  // factor decomposition bar (+ total)
  const comp = s.components || {};
  const order = ["rate", "convexity", "credit", "rating", "concentration", "fx"];
  const cats = order.map(k => FACTOR_RU[k]).concat("Итого");
  const vals = order.map(k => comp[k] || 0).concat(s.total_pl || 0);
  mkChart(panel.querySelector("#rk-decomp"), {
    ...CHART_BG, tooltip: { trigger: "axis", valueFormatter: x => money(x) },
    grid: { left: 70, right: 20, top: 14, bottom: 40 },
    xAxis: { type: "category", data: cats, axisLabel: { interval: 0, rotate: 18 }, ...AX },
    yAxis: { type: "value", ...AX },
    series: [{
      type: "bar", data: vals.map((x, i) => ({ value: x, itemStyle: { color: i === cats.length - 1 ? "#8b7bff" : (x >= 0 ? "#2fe08a" : "#ff5470") } })),
      label: { show: true, position: "top", formatter: p => money(p.value), color: cssVar("--muted", "#83968f"), fontSize: 10 },
    }],
  });

  // ---- per-position stress table (biggest movers) ----
  const pos = (s.positions || []).slice(0, 20);
  if (pos.length) {
    const body = pos.map(p => `<tr><td style="text-align:left">${p.name}</td>
      <td><span class="badge ${p.kind}">${KIND_RU[p.kind] || "—"}</span></td>
      <td>${money(p.market_value)}</td><td>${fmt(p.dv01, 1)}</td>
      <td class="${p.rate_pl < 0 ? "neg" : "pos"}">${money(p.rate_pl)}</td>
      <td class="${p.credit_pl < 0 ? "neg" : "pos"}">${money(p.credit_pl)}</td>
      <td class="${p.fx_pl < 0 ? "neg" : "pos"}">${money(p.fx_pl)}</td>
      <td><b class="${p.total_pl < 0 ? "neg" : "pos"}">${money(p.total_pl)}</b></td></tr>`).join("");
    v.appendChild(el(`<div class="tbl-wrap panel"><h3>По позициям — вклад в стресс</h3><table><thead><tr>
      <th style="text-align:left">Выпуск</th><th>Тип</th><th>Стоимость</th><th>DV01</th><th>Ставка</th><th>Кред.</th><th>Валюта</th><th>Итого</th></tr></thead><tbody>${body}</tbody></table></div>`));
  }

  // concentration by issuer
  if ((c.top || []).length) {
    const rows = c.top.map(t => `<tr><td style="text-align:left">${t.name}</td><td>${fmt(t.share, 1)}%</td></tr>`).join("");
    v.appendChild(el(`<div class="tbl-wrap panel"><h3>Концентрация по эмитентам</h3><table><thead><tr><th style="text-align:left">Эмитент</th><th>Доля</th></tr></thead><tbody>${rows}</tbody></table></div>`));
  }
}

// ---------- Alerts ----------
function renderAlerts(v) {
  if (!DATA.alerts.length) { v.appendChild(el(`<div class="panel">Алертов нет 👍</div>`)); return; }
  const p = el(`<div class="panel"><h3>Алерты (${DATA.alerts.length})</h3></div>`);
  DATA.alerts.forEach(a => p.appendChild(el(`<div class="alert ${a.level}">${a.text}</div>`)));
  v.appendChild(p);
}

// ---------- Данные и даты (важные даты + качество данных) ----------
function renderQuality(v) {
  // Ближайшие купоны / погашения / оферты — списками
  renderImportantDates(v);
  // Качество данных
  if (DATA?.data_quality) renderDataQuality(v, DATA.data_quality);
}

// ---------- Bond card ----------
let CARD_ISIN = null;
function openBond(isin) { NAV_STACK.push(TAB); CARD_ISIN = isin; TAB = "bond"; highlightTab(); render(); }
async function renderBondCard(v) {
  v.appendChild(el(`<div class="toolbar"><button class="btn ghost" id="back">← К таблице</button>
    <b>${CARD_ISIN}</b></div>`));
  v.querySelector("#back").onclick = () => switchTab("bonds");
  const priceNode = el(`<div class="panel"><h3>Цена (MOEX history)</h3><div class="chart tall"></div></div>`);
  const yieldNode = el(`<div class="panel"><h3>Доходность (MOEX yields)</h3><div class="chart tall"></div></div>`);
  v.append(priceNode, yieldNode);
  try {
    const [hist, yld] = await Promise.all([
      fetch(`${API}/api/moex/history/${CARD_ISIN}`).then(x => x.json()),
      fetch(`${API}/api/moex/yields/${CARD_ISIN}`).then(x => x.json()),
    ]);
    mkChart(priceNode.querySelector(".chart"), {
      ...CHART_BG, tooltip: { trigger: "axis" }, grid: { left: 55, right: 20, top: 20, bottom: 40 },
      xAxis: { type: "category", data: hist.map(h => h.date) },
      yAxis: { type: "value", scale: true },
      series: [{ type: "line", smooth: true, showSymbol: false, data: hist.map(h => h.close), itemStyle: { color: PALETTE[0] } }],
    });
    mkChart(yieldNode.querySelector(".chart"), {
      ...CHART_BG, tooltip: { trigger: "axis" }, grid: { left: 55, right: 20, top: 20, bottom: 40 },
      xAxis: { type: "category", data: yld.map(y => y.date) },
      yAxis: { type: "value", scale: true },
      series: [{ type: "line", smooth: true, showSymbol: false, data: yld.map(y => y.yield_close), itemStyle: { color: PALETTE[2] } }],
    });
  } catch (e) {
    v.appendChild(el(`<div class="alert error">Не удалось загрузить историю MOEX: ${e}</div>`));
  }
}

// ---------- Builder ----------
// ---------- Multi-client workspace (two-level: pick a client, then its tabs) ----------
const CLIENTS = { list: null };
async function openClient(cid) {
  try { await fetch(`${API}/api/clients/${cid}/activate`, { method: "POST" }); } catch (e) { }
  PF_CLIENT = cid; DATA = null; NAV_STACK = [];
  PF_PID = null; PF_CCY = null; PF_LIST = null; CF.path = null; STRESS.res = null;   // reset portfolio selection
  await loadCurrent();
  switchTab("overview");
}

// Переключатель + управление портфелями внутри клиента: выбрать «Все» / конкретный,
// добавить, переименовать, удалить портфель.
function renderPortfolioPicker(v) {
  const host = el(`<div class="pf-pick" id="pf-pick"></div>`);
  v.appendChild(host);
  const draw = () => {
    const list = PF_LIST || [];
    host.innerHTML = "";
    // «Все портфели» — только если их больше одного
    if (list.length > 1) {
      const allMv = list.reduce((a, b) => a + (b.market_value || 0), 0);
      const allN = list.reduce((a, b) => a + (b.positions || 0), 0);
      const all = el(`<div class="pf-chip${PF_PID == null ? " on" : ""}" data-pid="all"><span class="pf-chip-n">Все портфели</span><span class="pf-chip-mv">${moneyM(allMv)} · ${allN} поз.</span></div>`);
      all.onclick = () => selectPortfolio(null);
      host.appendChild(all);
    }
    list.forEach(p => {
      const on = String(PF_PID) === String(p.id);
      const chip = el(`<div class="pf-chip has-x${on ? " on" : ""}" data-pid="${p.id}">
        <span class="pf-chip-n">${p.name}</span>
        <span class="pf-chip-mv">${moneyM(p.market_value)} · ${p.positions} поз.</span>
        <span class="pf-acts"><button class="pf-mini" data-act="rename" title="Переименовать">✎</button><button class="pf-mini" data-act="del" title="Удалить">✕</button></span>
      </div>`);
      chip.onclick = (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "rename") return renamePortfolio(p);
        if (act === "del") return deletePortfolio(p);
        selectPortfolio(+p.id);
      };
      host.appendChild(chip);
    });
    const add = el(`<button class="pf-chip pf-add" title="Собрать новый портфель">＋ Добавить портфель</button>`);
    add.onclick = addPortfolio;
    host.appendChild(add);
  };
  if (PF_LIST == null) fetch(`${API}/api/portfolios`).then(x => x.json()).then(r => { PF_LIST = r.portfolios || []; draw(); }).catch(() => host.remove());
  else draw();
}

async function selectPortfolio(pid) {
  PF_PID = pid; PF_CCY = null; CF.path = null; STRESS.res = null; DATA = null;
  render();
  await loadCurrent(); render();
}
async function addPortfolio() {
  const name = await askText("Название нового портфеля", "напр. Консервативный", "");
  if (!name) return;
  BUILD.name = name; BUILD.items = []; BUILD.cash = 0;   // конструктор соберёт новый портфель с этим именем
  switchTab("builder");
}
async function renamePortfolio(p) {
  const name = await askText("Новое название портфеля", "", p.name);
  if (!name || name === p.name) return;
  await fetch(`${API}/api/portfolios/${p.id}/rename`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
  PF_LIST = null; DATA = null;
  render(); await loadCurrent(); render();
}
async function deletePortfolio(p) {
  const ok = await askConfirm(`Удалить портфель «${p.name}»? Все его позиции будут удалены безвозвратно.`);
  if (!ok) return;
  await fetch(`${API}/api/portfolios/${p.id}`, { method: "DELETE" });
  if (String(PF_PID) === String(p.id)) PF_PID = null;
  PF_LIST = null; DATA = null; CF.path = null; STRESS.res = null;
  render(); await loadCurrent(); render();
}

// Разбивка портфеля по валютам — таблицей (стоимость в ₽, YTM/дюрация не смешаны).
// разбивка одной валюты по рейтингу/сроку (для всплывающего окна) — считаем на клиенте
const RATING_ORDER_FINE = ["AAA", "AA+", "AA", "AA-", "A+", "A", "A-", "BBB+", "BBB", "BBB-", "BB+", "BB", "BB-", "B+", "B", "B-", "CCC", "CC", "C", "D"];
const ratingRank = b => { const i = RATING_ORDER_FINE.indexOf((b || "").trim()); return i < 0 ? 99 : i; };
function normCcy(c) { return (c === "SUR" || c === "RUR") ? "RUB" : (c || "RUB"); }
function ccySlices(ccyName) {
  const rows = (DATA.positions || []).filter(r => r.is_bond !== false && r.market_value && normCcy(r.currency) === ccyName);
  const groupBy = keyfn => { const m = {}; rows.forEach(r => { const k = keyfn(r) || "—"; m[k] = (m[k] || 0) + r.market_value; }); return Object.entries(m).map(([name, value]) => ({ name, value })); };
  const by_rating = groupBy(r => r.rating_bucket).sort((a, b) => ratingRank(a.name) - ratingRank(b.name) || b.value - a.value);
  const by_maturity = groupBy(r => matBucket(r.matdate));
  return { by_rating, by_maturity };
}
function renderPortfolioCurrencies(v) {
  const cur = DATA?.portfolio?.currencies || [];
  if (!cur.length) return;
  const rows = cur.map((c, i) => `<tr data-ci="${i}" style="cursor:pointer"><td style="text-align:left"><b>${ccyLabel(c.currency)}</b> <span class="muted" style="font-size:10px">▸ структура</span></td><td>${money(c.market_value)}</td><td>${fmt(c.share, 1)}%</td><td>${c.positions}</td><td>${pct(c.ytm)}</td><td>${c.duration == null ? "—" : fmt(c.duration, 2) + " г."}</td></tr>`).join("");
  const panel = el(`<div class="panel"><h3>По валютам <span class="muted" style="font-weight:400;font-size:12px">· клик по валюте — структура по рейтингу и сроку</span></h3>
    <div class="tbl-wrap"><table><thead><tr><th style="text-align:left">Валюта</th><th>Стоимость</th><th>Доля</th><th>Позиций</th><th>Средневзв. YTM</th><th>Дюрация</th></tr></thead><tbody>${rows}</tbody></table></div></div>`);
  panel.querySelectorAll("tr[data-ci]").forEach(tr => tr.onclick = () => {
    const c = cur[+tr.dataset.ci]; openCcyModal({ ...c, ...ccySlices(normCcy(c.currency)) });
  });
  v.appendChild(panel);
}
async function renderClientsPicker(v) {
  // сводка по всем клиентам (AUM) + таблица «По клиентам» (кликабельная, с удалением)
  const sumHost = el(`<div id="cl-summary"><div class="loading" style="padding:14px">Считаю сводку по всем портфелям…</div></div>`);
  v.appendChild(sumHost);
  fetch(`${API}/api/clients/summary`).then(x => x.json()).then(s => renderAumSummary(sumHost, s)).catch(() => { sumHost.innerHTML = ""; });
  // кнопка добавления клиента — прямо под сводкой (карточки убраны, дублировали таблицу)
  const addBar = el(`<div style="margin:4px 0 8px"><button class="btn" id="cl-add">+ Добавить клиента</button></div>`);
  v.appendChild(addBar);
  addBar.querySelector("#cl-add").onclick = async () => {
    const name = await askText("Новый клиент", "Имя или название клиента");
    if (!name) return;
    try { const r = await fetch(`${API}/api/clients`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(x => x.json()); CLIENTS.list = null; openClient(r.id); } catch (e) { }
  };
}
async function deleteClient(cid, name) {
  const ok = await askConfirm(`Удалить клиента «${name}» со всеми его портфелями и позициями? Действие необратимо.`);
  if (!ok) return;
  try { await fetch(`${API}/api/clients/${cid}`, { method: "DELETE" }); } catch (e) { }
  CLIENTS.list = null; PF_CLIENT = null; DATA = null; PF_LIST = null; PF_PID = null;
  render();
}

// всплывающее окно: структура валюты по рейтингу и сроку до погашения
function openCcyModal(c) {
  if (!c) return;
  const ov = el(`<div class="modal-ov"><div class="modal" style="width:min(920px,96vw)">
    <div class="modal-title">${ccyLabel(c.currency)} · ${money(c.market_value)} <span class="muted" style="font-weight:400;font-size:12px">· ${c.positions} позиций</span><span class="link" data-close style="float:right;font-size:18px">✕</span></div>
    <div class="grid2">
      <div class="panel" style="margin:0"><h3 style="font-size:13px">По рейтингу</h3><div class="chart" id="cm-rate" style="height:300px"></div></div>
      <div class="panel" style="margin:0"><h3 style="font-size:13px">По сроку до погашения</h3><div class="chart" id="cm-mat" style="height:300px"></div></div>
    </div></div></div>`);
  document.body.appendChild(ov);
  ov.onclick = (e) => { if (e.target === ov || e.target.closest("[data-close]")) ov.remove(); };
  const pie = (node, items) => mkChart(node, {
    ...CHART_BG, tooltip: { trigger: "item", formatter: p => `${p.name}: ${money(p.value)} (${pct(p.percent)})` },
    series: [{ type: "pie", radius: ["32%", "52%"], center: ["50%", "52%"], avoidLabelOverlap: true,
      data: (items || []).map(i => ({ name: i.name, value: i.value })),
      label: { color: cssVar("--text", "#eef4f1"), fontWeight: 600, fontSize: 11, formatter: "{b}: {d}%" },
      labelLine: { length: 8, length2: 10, lineStyle: { color: cssVar("--muted", "#8aa") } } }], color: PALETTE,
  });
  setTimeout(() => { pie(ov.querySelector("#cm-rate"), c.by_rating); pie(ov.querySelector("#cm-mat"), c.by_maturity); }, 40);
}

// плавающая подсказка «у какого клиента сколько бумаг» (топ выпусков)
let HTIP = null;
function showHoldersTip(holders) {
  if (!HTIP) { HTIP = el(`<div class="htip"></div>`); document.body.appendChild(HTIP); }
  HTIP.innerHTML = `<div class="htip-h">У кого эти бумаги</div>` + (holders.length
    ? holders.map(h => `<div class="htip-r"><span>${h.client}</span><b>${fmt(h.quantity)} шт</b></div>`).join("")
    : `<div class="muted">нет данных</div>`);
  HTIP.style.display = "block";
}
function moveHoldersTip(e) { if (HTIP) { HTIP.style.left = Math.min(e.clientX + 16, innerWidth - 240) + "px"; HTIP.style.top = (e.clientY + 16) + "px"; } }
function hideHoldersTip() { if (HTIP) HTIP.style.display = "none"; }

const CCY_RU = { RUB: "₽ Рубль", SUR: "₽ Рубль", USD: "$ Доллар", EUR: "€ Евро", CNY: "¥ Юань", GBP: "£ Фунт", CHF: "Франк", HKD: "HKD", JPY: "¥ Иена", KZT: "Тенге", BYN: "Бел. рубль" };
const ccyLabel = c => CCY_RU[c] || c || "₽ Рубль";
const CCY_SYM = { RUB: "₽", SUR: "₽", RUR: "₽", USD: "$", EUR: "€", CNY: "¥", GBP: "£", CHF: "₣", JPY: "¥" };
const ccySym = c => CCY_SYM[c] || c || "₽";
function renderAumSummary(host, s) {
  if (!s || !s.total_aum) { host.innerHTML = ""; return; }
  // разбивка средневзвешенных прямо в карточках (под большими числами)
  const _cs = (s.currencies || []).filter(c => c.market_value);
  const ytmBd = _cs.filter(c => c.ytm != null).map(c => `${ccySym(c.currency)} ${fmt(c.ytm, 1)}%`).join(" · ") || "все валюты";
  const durBd = _cs.filter(c => c.duration != null).map(c => `${ccySym(c.currency)} ${fmt(c.duration, 1)} г.`).join(" · ") || "все валюты";
  const issueRows = (s.top_issues || []).map((t, i) => `<tr data-isin="${t.isin}" data-holders='${JSON.stringify(t.holders || [])}'${i >= 5 ? ' class="tr-extra"' : ""}><td style="text-align:left"><span class="link">${t.name}</span></td>
    <td>${money(t.market_value)}</td><td>${fmt(t.share, 1)}%</td><td>${pct(t.ytm)}</td></tr>`).join("")
    + ((s.top_issues || []).length > 5 ? `<tr class="tr-toggle"><td colspan="4"><span class="link toggle-top">Показать топ-10 ▾</span></td></tr>` : "");
  const issuerRows = (s.top_issuers || []).map((t, i) => `<tr data-issuer="${(t.name || "").replace(/"/g, "&quot;")}"${i >= 5 ? ' class="tr-extra"' : ""}><td style="text-align:left"><span class="link">${t.name}</span></td><td>${money(t.market_value)}</td><td>${fmt(t.share, 1)}%</td></tr>`).join("")
    + ((s.top_issuers || []).length > 5 ? `<tr class="tr-toggle"><td colspan="3"><span class="link toggle-top">Показать топ-10 ▾</span></td></tr>` : "");
  host.innerHTML = `<div class="panel"><h3>Активы под управлением <span class="muted" style="font-weight:400;font-size:12px">· все клиенты вместе</span></h3>
    <div class="kpis" style="margin:0 0 12px">
      <div class="kpi"><div class="label">Всего AUM</div><div class="value">${money(s.total_aum)}</div><div class="sub">${s.n_clients} клиент(ов) · ${s.n_positions} позиций</div></div>
      <div class="kpi"><div class="label">Средневзв. YTM</div><div class="value">${pct(s.weighted_ytm)}</div><div class="sub">${ytmBd}</div></div>
      <div class="kpi"><div class="label">Средневзв. дюрация</div><div class="value">${fmt(s.weighted_duration, 2)} <span style="font-size:14px;color:var(--muted)">лет</span></div><div class="sub">${durBd}</div></div>
      <div class="kpi"><div class="label">Эмитентов</div><div class="value">${s.n_issuers}</div></div>
    </div>
    ${(s.allocation || []).length ? `<div class="grid2" style="margin:0 0 14px">
      <div class="panel aum-chart" style="margin:0"><h3 style="font-size:14px">Аллокация активов <span class="muted" style="font-weight:400;font-size:11px">· по классам</span></h3><div class="chart" id="aum-alloc" style="height:270px"></div></div>
      <div class="panel aum-chart" style="margin:0"><h3 style="font-size:14px">По типу инструмента <span class="muted" style="font-weight:400;font-size:11px">· облигации</span></h3><div class="chart" id="aum-instr" style="height:270px"></div></div>
    </div>` : ""}
    <div class="grid2">
      <div class="tbl-wrap"><h3 style="font-size:14px">Топ выпусков <span class="muted" style="font-weight:400;font-size:11px">· суммарно по всем клиентам</span></h3><table class="top-tbl"><thead><tr><th style="text-align:left">Выпуск</th><th>Стоимость</th><th>Доля</th><th>YTM</th></tr></thead><tbody>${issueRows}</tbody></table></div>
      <div class="tbl-wrap"><h3 style="font-size:14px">Топ эмитентов <span class="muted" style="font-weight:400;font-size:11px">· суммарно по всем клиентам</span></h3><table class="top-tbl"><thead><tr><th style="text-align:left">Эмитент</th><th>Стоимость</th><th>Доля</th></tr></thead><tbody>${issuerRows}</tbody></table></div>
    </div>
    ${(s.currencies || []).length ? `<div class="tbl-wrap" style="margin-top:12px"><h3 style="font-size:14px">По валютам <span class="muted" style="font-weight:400;font-size:11px">· стоимость в ₽ по курсу ЦБ</span></h3><table><thead><tr><th style="text-align:left">Валюта</th><th>Стоимость</th><th>Доля AUM</th><th>Позиций</th><th>Средневзв. YTM</th><th>Дюрация</th></tr></thead><tbody>${s.currencies.map((c, i) => `<tr data-ci="${i}" style="cursor:pointer"><td style="text-align:left"><b>${ccyLabel(c.currency)}</b> <span class="muted" style="font-size:10px">▸ структура</span></td><td>${money(c.market_value)}</td><td>${fmt(c.share, 1)}%</td><td>${c.positions}</td><td>${pct(c.ytm)}</td><td>${c.duration == null ? "—" : fmt(c.duration, 2) + " г."}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${(s.clients || []).length ? `<div class="tbl-wrap" style="margin-top:12px"><h3 style="font-size:14px">По клиентам</h3><table><thead><tr><th style="text-align:left">Клиент</th><th>Стоимость</th><th>Доля AUM</th><th>Позиций</th><th>YTM</th></tr></thead><tbody>${s.clients.map(c => `<tr data-open="${c.id}" class="cl-row" style="cursor:pointer"><td style="text-align:left"><span class="link">${c.name}</span> <button class="cl-del-inline" data-del="${c.id}" data-name="${(c.name || "").replace(/"/g, "&quot;")}" title="Удалить клиента">✕</button></td><td>${money(c.market_value)}</td><td>${s.total_aum ? fmt(100 * c.market_value / s.total_aum, 1) : 0}%</td><td>${c.positions}</td><td>${pct(c.ytm)}</td></tr>`).join("")}</tbody></table></div>` : ""}</div>`;
  // круговые диаграммы аллокации под общим AUM
  setTimeout(() => {
    allocDonut(host.querySelector("#aum-alloc"), s.allocation, ALLOC_COLORS);
    allocDonut(host.querySelector("#aum-instr"), s.by_instrument, INSTR_COLORS);
  }, 0);
  host.querySelectorAll("tr[data-isin]").forEach(tr => {
    tr.onclick = () => openIssue(tr.dataset.isin);
    tr.onmouseenter = () => { try { showHoldersTip(JSON.parse(tr.dataset.holders || "[]")); } catch (e) { } };
    tr.onmousemove = (e) => moveHoldersTip(e);
    tr.onmouseleave = hideHoldersTip;
  });
  host.querySelectorAll("tr[data-issuer]").forEach(tr => tr.onclick = () => openIssuer(tr.dataset.issuer));
  host.querySelectorAll("tr[data-open]").forEach(tr => tr.onclick = (e) => {
    const del = e.target.closest("[data-del]");
    if (del) { e.stopPropagation(); return deleteClient(+del.dataset.del, del.dataset.name); }
    openClient(+tr.dataset.open);
  });
  host.querySelectorAll("tr[data-ci]").forEach(tr => tr.onclick = () => openCcyModal((s.currencies || [])[+tr.dataset.ci]));
  host.querySelectorAll(".toggle-top").forEach(tg => tg.onclick = (e) => {
    e.stopPropagation();
    const tbl = tg.closest("table"); const open = tbl.classList.toggle("show-all");
    tg.textContent = open ? "Свернуть ▴" : "Показать топ-10 ▾";
  });
}

const BUILD = { cash: 0, items: [], name: "" };
function builderInvested() { return BUILD.items.reduce((s, i) => s + (i.side === "sell" ? -(i.cost || 0) : (i.cost || 0)), 0); }

function renderBuilder(v) {
  const invested = builderInvested(), left = BUILD.cash - invested;
  v.appendChild(el(`<div class="panel">
    <h3>1. Название и средства</h3>
    <div class="toolbar">
      <input type="text" id="b-name" placeholder="Название портфеля" value="${(BUILD.name || "").replace(/"/g, "&quot;")}" style="width:220px">
      <input type="text" id="cash" placeholder="Сумма, ₽" value="${BUILD.cash || ""}" style="width:180px">
      <button class="btn ghost" id="setcash">Задать</button>
      <span class="muted">Задай имя и сумму, добавляй бумаги — или загрузи портфель Excel.</span>
      <label class="btn ghost" style="cursor:pointer">📄 Импорт Excel<input type="file" id="b-xlsx" accept=".xlsx" hidden></label>
      <span id="b-xlsx-msg" class="muted"></span>
    </div>
  </div>`));
  v.querySelector("#b-name").oninput = (e) => { BUILD.name = e.target.value; };

  v.appendChild(el(`<div class="panel">
    <h3>2. Добавить бумагу</h3>
    <div class="toolbar" style="align-items:flex-end">
      <div class="field"><label>Операция</label><select id="b-side" style="width:130px"><option value="buy">Покупка</option><option value="sell">Продажа</option></select></div>
      <div class="ac-wrap field"><label>ISIN / название</label><input type="text" id="b-isin" placeholder="начни вводить…" style="width:220px"></div>
      <div class="field"><label>Дата</label><input type="date" id="b-date" style="width:160px"></div>
      <div class="field"><label>Количество</label><input type="text" id="b-qty" placeholder="шт." style="width:110px"></div>
      <button class="btn" id="b-add">Добавить</button>
      <span id="b-msg" class="muted"></span>
    </div>
  </div>`));
  attachAutocomplete(v.querySelector("#b-isin"), (pick) => { if (pick.type === "issuer" || !pick.isin) return; v.querySelector("#b-isin").value = pick.isin; v.querySelector("#b-isin").dataset.isin = pick.isin; }, { bondsOnly: true });
  v.querySelector("#b-xlsx").onchange = (e) => builderImportXlsx(e.target.files[0], v.querySelector("#b-xlsx-msg"));

  const balCls = left < 0 ? "neg" : "pos";
  v.appendChild(el(`<div class="kpis">
    <div class="kpi"><div class="label">Внесено средств</div><div class="value">${money(BUILD.cash)}</div></div>
    <div class="kpi"><div class="label">Стоимость покупок</div><div class="value">${money(invested)}</div></div>
    <div class="kpi"><div class="label">Остаток</div><div class="value ${balCls}">${money(left)}</div>
      ${left < 0 ? `<div class="sub neg">Не хватает средств!</div>` : `<div class="sub">средств достаточно</div>`}</div>
  </div>`));

  const list = el(`<div class="panel"><h3>3. Состав портфеля (${BUILD.items.length})</h3>
    <div class="tbl-wrap"><table><thead><tr>
      <th>Операция</th><th>Бумага</th><th>ISIN</th><th>Дата</th><th>Цена</th><th>НКД</th><th>Кол-во</th><th>Стоимость</th><th></th>
    </tr></thead><tbody>${BUILD.items.map((i, idx) => `<tr>
      <td><span class="badge ${i.side === "sell" ? "float" : "fix"}" style="font-size:10px">${i.side === "sell" ? "Продажа" : "Покупка"}</span></td>
      <td>${i.name || "—"}</td><td>${i.isin}</td><td>${dmy(i.price_date || i.date)}</td>
      <td>${pct(i.clean_price)}</td><td>${fmt(i.accint, 2)}</td><td>${fmt(i.quantity)}</td>
      <td>${money(i.cost)}</td>
      <td><span class="link" data-del="${idx}">удалить</span></td></tr>`).join("")}</tbody></table></div>
    <div style="margin-top:14px">
      <button class="btn" id="b-build" ${BUILD.items.length && left >= 0 ? "" : "disabled style=opacity:.5"}>Собрать портфель ✓</button>
      <span class="muted" style="margin-left:10px">${left < 0 ? "Уменьшите объём — остаток отрицательный" : "Готово к построению аналитики"}</span>
    </div></div>`);
  v.appendChild(list);

  // wiring
  v.querySelector("#setcash").onclick = () => {
    BUILD.cash = parseFloat((v.querySelector("#cash").value || "0").replace(/\s/g, "").replace(",", ".")) || 0;
    render();
  };
  v.querySelector("#b-add").onclick = () => builderAdd(v);
  v.querySelectorAll("[data-del]").forEach(s => s.onclick = () => { BUILD.items.splice(+s.dataset.del, 1); render(); });
  v.querySelector("#b-build").onclick = builderCommit;
}

async function builderAdd(v) {
  const isin = (v.querySelector("#b-isin").value || "").trim().toUpperCase();
  const date = (v.querySelector("#b-date").value || "").trim();
  const qty = parseFloat(v.querySelector("#b-qty").value || "0");
  const side = v.querySelector("#b-side").value;
  const msg = v.querySelector("#b-msg");
  if (!isin || !date || !qty) { msg.innerHTML = `<span class="neg">Заполни ISIN, дату и количество</span>`; return; }
  msg.textContent = "Запрашиваю цену на дату…";
  try {
    const q = await fetch(`${API}/api/builder/quote`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isin, date, quantity: qty }),
    }).then(x => x.json());
    if (!q.ok) { msg.innerHTML = `<span class="neg">${q.error || "Не найдено"}</span>`; return; }
    BUILD.items.push({ isin, date, quantity: qty, side, ...q });
    render();
  } catch (e) { msg.innerHTML = `<span class="neg">Ошибка: ${e}</span>`; }
}

async function builderImportXlsx(f, msg) {
  if (!f) return;
  msg.textContent = "Загружаю и сопоставляю с MOEX…";
  const fd = new FormData(); fd.append("file", f);
  try {
    const r = await fetch(`${API}/api/portfolio/import`, { method: "POST", body: fd }).then(x => x.json());
    DATA = r.dashboard;
    document.getElementById("updated").textContent = "Портфель: " + (DATA.portfolio.name || "—");
    switchTab("overview");
  } catch (e) { msg.innerHTML = `<span class="neg">Ошибка: ${e}</span>`; }
}

async function builderCommit() {
  const body = { cash: BUILD.cash, name: (BUILD.name || "").trim() || "Новый портфель",
    positions: BUILD.items.map(i => ({ isin: i.isin, date: i.date, quantity: i.quantity, side: i.side || "buy", clean_price: i.clean_price })) };
  let r;
  try {
    r = await fetch(`${API}/api/portfolio/build`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(x => x.json());
  } catch (e) { r = null; }
  if (!r || !r.dashboard) { alert("Не удалось собрать портфель — проверь бумаги и попробуй ещё раз."); return; }
  BUILD.items = []; BUILD.cash = 0; BUILD.name = "";
  PF_LIST = null; PF_PID = r.portfolio_id; PF_CCY = null; CF.path = null; STRESS.res = null;   // выбрать новый портфель в переключателе
  DATA = r.dashboard;
  document.getElementById("updated").textContent = "Портфель: " + (DATA.portfolio.name || "—");
  switchTab("overview");
}

// ---------- Upload ----------
function renderUpload(v) {
  const status = DATA ? `<div class="alert info">Текущий портфель: <b>${DATA.portfolio.name}</b> · ${DATA.summary.positions} позиций · ${DATA.summary.unresolved} без MOEX</div>` : "";
  v.appendChild(el(`<div class="panel">${status}
    <div class="alert info">Достаточно 3 колонок: <b>ISIN</b>, <b>Количество</b>, <b>Дата покупки</b>. Цену покупки, текущую цену, купоны и P/L система подтянет из MOEX.</div>
    <div class="drop" id="drop">Перетащите .xlsx сюда или <label class="link"><input type="file" id="file" accept=".xlsx" hidden> выберите файл</label></div>
    <div style="margin-top:14px"><button class="btn" id="demo">Загрузить демо-портфель</button></div>
    <div id="up-result" style="margin-top:14px"></div>
  </div>`));
  const drop = v.querySelector("#drop"), file = v.querySelector("#file"), res = v.querySelector("#up-result");
  file.onchange = () => upload(file.files[0], res);
  v.querySelector("#demo").onclick = async () => {
    res.textContent = "Загружаю демо…";
    await fetch(`${API}/api/portfolio/demo`, { method: "POST" });
    await loadCurrent(); switchTab("overview");
  };
  if (DATA?.data_quality) renderDataQuality(v, DATA.data_quality);
  ["dragover", "dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.toggle("over", ev === "dragover");
    if (ev === "drop") upload(e.dataTransfer.files[0], res);
  }));
}
async function upload(f, res) {
  if (!f) return;
  res.textContent = "Загружаю и сопоставляю с MOEX…";
  const fd = new FormData(); fd.append("file", f);
  try {
    const r = await fetch(`${API}/api/portfolio/import`, { method: "POST", body: fd }).then(x => x.json());
    DATA = r.dashboard;
    res.innerHTML = `<div class="alert info">Готово: ${DATA.summary.positions} позиций, ${DATA.summary.unresolved} не сопоставлено с MOEX.</div>`;
    await loadCurrent(); switchTab("overview");
  } catch (e) {
    res.innerHTML = `<div class="alert error">Ошибка: ${e}</div>`;
  }
}

// =========================================================================
//  Universe screener + market map + issue card (read from the cached snapshot)
// =========================================================================
const bp = (v) => v == null ? "—" : (v > 0 ? "+" : "") + fmt(v, 0) + " б.п.";
// дата горизонта бумаги: пут-оферта (биржа) или колл-опцион эмитента (дата с dohod)
const offerWord = r => (r && r.offer_type === "CALL") ? "колл" : "оферта";
function yieldBasisBadge(r) {
  if (r?.ytm == null || r.kind === "floater") return "";
  if (r.yield_limitation === "call_terms_unconfirmed_maturity_only") return ' <span style="font-size:10px;color:var(--warn,#a16c17);white-space:nowrap" title="YTM по полному известному графику до погашения, без досрочного выкупа. Условия CALL не подтверждены для расчёта YTC; это не YTW.">до погаш.</span>';
  if (r.yield_conditional_on_call) return ' <span style="font-size:10px;color:var(--warn,#a16c17);white-space:nowrap" title="Доходность при исполнении CALL. Эмитент может не воспользоваться правом досрочного погашения.">при CALL</span>';
  return "";
}
// два спреда в одной плитке через слеш: «+1 072 / +1 057 б.п.»
const bp2 = (a, b) => a == null && b == null ? "—"
  : `${a == null ? "—" : (a > 0 ? "+" : "") + fmt(a, 0)} / ${b == null ? "—" : (b > 0 ? "+" : "") + fmt(b, 0)} б.п.`;
// плитка z-спреда к RUONIA OIS — общая шкала для фиксов и флоатеров
function zKpi(d, isFloat) {
  const how = isFloat
    ? "будущие купоны — по форварду своего индекса из свопов (ключевая — IRS, RUONIA — OIS) плюс маржа; начисленная часть текущего купона — по НКД"
    : "купоны и погашения — по графику выпуска";
  return `<div class="kpi">${kpiQ("Z-спред к OIS",
    `Постоянная надбавка к бескупонной кривой RUONIA OIS (кривая процентных свопов Мосбиржи), при которой дисконтированный поток бумаги равен её цене с НКД. ${how[0].toUpperCase() + how.slice(1)}. Горизонт — ${d.ytm_basis === "offer" || (isFloat && d.offer_date) ? (d.offer_type === "CALL" ? "до колла" : "до оферты") : "до погашения"}. Одна шкала для фиксов и флоатеров.`,
    "Цена + НКД = Σ CFᵢ / (1 + yᵢ + z)^tᵢ\nyᵢ — бескупонная ставка RUONIA OIS на срок tᵢ, tᵢ — лет от даты расчётов (T+1)")}<div class="label">Z-спред к OIS</div><div class="value ${spreadCls(d.z_spread_bp)}">${bp(d.z_spread_bp)}</div><div class="sub">к кривой свопов RUONIA</div></div>`;
}
const spreadCls = (x) => x == null ? "" : x >= 0 ? "pos" : "neg";
// Price provenance (spec §26): which quote and whether it is fresh.
const PT_RU = { LAST: "по сделке", MID: "середина bid/ask", BID: "по биду", WAPRICE: "средневзв." };
function priceProv(d) {
  if (!d.price_type) return "";
  const label = PT_RU[d.price_type] || d.price_type;
  return d.price_stale
    ? `<span style="color:var(--warn,#e0a34a)" title="Нет сделок сегодня — цена может быть неактуальной">⚠ ${label}, устар.</span>`
    : `<span style="color:var(--muted)">${label}</span>`;
}
// "Как посчитано" tooltip for G-spread (spec §39): YTM − КБД = spread.
const KIND_RU = { fixed: "фикс", floater: "флоатер", linker: "линкер", discount: "дисконт", structured: "структурная", unknown: "—" };
// compact rubles: 12.5 млрд ₽ / 850 млн ₽
const bigMoney = (v) => v == null ? "—" : v >= 1e9 ? fmt(v / 1e9, 1) + " млрд ₽" : v >= 1e6 ? fmt(v / 1e6, 0) + " млн ₽" : fmt(v, 0) + " ₽";

const UNI = {
  loaded: false, loading: false, rows: [], total: 0, updatedAt: null, facets: null,
  secExpanded: false, clean: true,          // first screen: hide anomalies, show top liquid
  f: { rating: new Set(), sectors: new Set(), kinds: new Set(), currencies: new Set(["RUB"]), liq: new Set(), search: "",
       coupon_freq: new Set(), has_offer: false, amort: false,
       ytm_min: "", ytm_max: "", cy_min: "", cy_max: "", dur_min: "", dur_max: "", vol_min: "", vol_max: "", sort: "volume", desc: true, limit: 300 },
};

function uniQS() {
  const f = UNI.f, p = new URLSearchParams();
  if (f.rating.size) p.set("rating", [...f.rating].join(","));
  if (f.sectors.size) p.set("sectors", [...f.sectors].join(","));
  if (f.kinds.size) p.set("kinds", [...f.kinds].join(","));
  if (f.currencies.size) p.set("currencies", [...f.currencies].join(","));
  if (f.liq.size) p.set("liq", [...f.liq].join(","));
  if (f.coupon_freq.size) p.set("coupon_freq", [...f.coupon_freq].join(","));
  if (f.has_offer) p.set("has_offer", "true");
  if (f.amort) p.set("amort", "true");
  if (f.search) p.set("search", f.search);
  ["ytm_min", "ytm_max", "cy_min", "cy_max", "dur_min", "dur_max"].forEach(k => { if (f[k] !== "") p.set(k, f[k]); });
  // оборот вводится в млн ₽ — переводим в рубли для бэкенда
  if (f.vol_min !== "") p.set("vol_min", (parseFloat(f.vol_min) * 1e6) || 0);
  if (f.vol_max !== "") p.set("vol_max", (parseFloat(f.vol_max) * 1e6) || 0);
  if (UNI.clean) p.set("clean", "true");
  // «★ Избранное» — запрос по всему рынку (раньше фильтровались только загруженные 300 строк)
  if (f.watch && WATCH.size) p.set("isins", [...WATCH].slice(0, 500).join(","));
  p.set("sort", f.sort); p.set("desc", f.desc); p.set("limit", f.limit);
  return p.toString();
}

async function loadUniverse() {
  UNI.loading = true;
  try {
    if (!UNI.facets) UNI.facets = await fetch(`${API}/api/universe/facets`).then(x => x.json());
    // An empty watchlist is not the entire market. Keep its count and
    // aggregates empty without sending an unrestricted universe request.
    if (UNI.f.watch && !WATCH.size) {
      UNI.rows = []; UNI.total = 0; UNI.avgYtm = null; UNI.avgDur = null;
      UNI.loaded = true; UNI.loading = false;
      return;
    }
    const r = await fetch(`${API}/api/universe?${uniQS()}`).then(x => x.json());
    UNI.rows = r.rows || []; UNI.total = r.total || 0; UNI.updatedAt = r.updated_at;
    UNI.avgYtm = r.avg_ytm; UNI.avgDur = r.avg_dur;   // по всему набору, только фиксы
    UNI.loaded = true;
    if (UNI.updatedAt) setUpdated("Снимок рынка: " + snapTime(UNI.updatedAt));
  } catch (e) { UNI.rows = []; UNI.total = 0; UNI.loaded = true; }  // mark loaded to avoid a re-render loop
  UNI.loading = false;
}

// ---------- Screener ----------
async function renderScreener(v) {
  if (!UNI.loaded && !UNI.loading) { v.appendChild(el(`<div class="loading">Загружаю вселенную…</div>`)); await loadUniverse(); return render(); }
  if (UNI.loading) { v.appendChild(el(`<div class="loading">Загружаю вселенную…</div>`)); return; }

  // An empty filtered result is not an empty market snapshot. Keep the
  // controls visible so the user can loosen any filter without leaving.
  v.appendChild(screenerFilters());
  v.appendChild(screenerStats());
  v.appendChild(screenerTable());
  if (window.BondsMobile?.isPhone()) window.BondsMobile.screener(v);
}

function screenerFilters() {
  const wrap = el(`<div class="panel"><h3>Фильтры</h3></div>`);
  // search with autocomplete
  const search = el(`<div class="field" style="margin-bottom:16px"><label>Поиск выпуска</label>
    <div class="ac-wrap"><input type="text" id="u-search" placeholder="Название или ISIN — начни вводить…" value="${UNI.f.search}" style="width:100%"></div></div>`);
  wrap.appendChild(search);
  attachAutocomplete(search.querySelector("#u-search"), (pick) => pick.type === "issuer" ? openIssuer(pick.key) : openIssue(pick.isin));
  // watchlist filter
  const watch = el(`<div style="margin-bottom:12px"><span class="chip ${UNI.f.watch ? "on" : ""}" id="u-watch">★ Избранное${WATCH.size ? ` <span class="muted">${WATCH.size}</span>` : ""}</span></div>`);
  wrap.appendChild(watch);
  watch.querySelector("#u-watch").onclick = async () => { UNI.f.watch = !UNI.f.watch; await loadUniverse(); render(); };

  // rating chips
  const buckets = (UNI.facets?.rating_buckets || ["AAA", "AA", "A", "BBB", "BB", "B"]);
  const ratingChips = buckets.map(b =>
    `<span class="chip ${UNI.f.rating.has(b) ? "on" : ""}" data-rt="${b}">${b}${UNI.facets?.bucket_counts?.[b] ? ` <span class="muted">${UNI.facets.bucket_counts[b]}</span>` : ""}</span>`).join("");
  // Sectors: most-populated first, top ones always visible, the long tail under
  // a "показать все" toggle so the filter panel stays compact.
  const secCounts = UNI.facets?.sector_counts || {};
  const sectors = [...(UNI.facets?.sectors || [])].sort((a, b) => (secCounts[b] || 0) - (secCounts[a] || 0));
  const SEC_TOP = 14;
  const chosen = [...UNI.f.sectors];                       // always show selected ones
  const head = sectors.slice(0, SEC_TOP);
  const tail = sectors.slice(SEC_TOP);
  const visibleSectors = UNI.secExpanded ? sectors
    : [...head, ...tail.filter(s => UNI.f.sectors.has(s))];
  const secChip = s => `<span class="chip ${UNI.f.sectors.has(s) ? "on" : ""}" data-sec="${s}">${s}${secCounts[s] ? ` <span class="muted">${secCounts[s]}</span>` : ""}</span>`;
  const sectorChips = visibleSectors.map(secChip).join("")
    + (tail.length ? `<span class="chip" id="u-sec-more" style="background:transparent;border-style:dashed;color:var(--accent,#29ba74)">${UNI.secExpanded ? "свернуть ▲" : `+ ещё ${tail.length} ▾`}</span>` : "");

  const filters = el(`<div class="filters">
    <div class="field full"><label>Рейтинг</label><div class="chips" id="u-rt">${ratingChips || '<span class="muted">нет данных — импортируй рейтинги</span>'}</div></div>
    <div class="field"><label>Тип</label><div class="chips" id="u-kind">
      ${["fixed", "floater", "discount", "linker"].map(k => `<span class="chip ${UNI.f.kinds.has(k) ? "on" : ""}" data-kind="${k}">${KIND_RU[k]}</span>`).join("")}</div></div>
    <div class="field"><label>Валюта</label><div class="chips" id="u-ccy">
      ${(UNI.facets?.currencies || ["RUB"]).map(c => `<span class="chip ${UNI.f.currencies.has(c) ? "on" : ""}" data-ccy="${c}">${c}${UNI.facets?.currency_counts?.[c] ? ` <span class="muted">${UNI.facets.currency_counts[c]}</span>` : ""}</span>`).join("")}</div></div>
    <div class="field"><label>Ликвидность</label><div class="chips" id="u-liq">
      ${(UNI.facets?.liquidity || ["Высокая", "Средняя", "Низкая"]).map(c => `<span class="chip ${UNI.f.liq.has(c) ? "on" : ""}" data-liq="${c}">${c}${UNI.facets?.liq_counts?.[c] ? ` <span class="muted">${UNI.facets.liq_counts[c]}</span>` : ""}</span>`).join("")}</div></div>
    <div class="field"><label>Частота купона</label><div class="chips" id="u-freq">
      ${[["12", "ежемес."], ["4", "квартал."], ["2", "полугод."], ["1", "год."]].map(([v, l]) => `<span class="chip ${UNI.f.coupon_freq.has(v) ? "on" : ""}" data-freq="${v}">${l}</span>`).join("")}</div></div>
    <div class="field"><label>Особые</label><div class="chips" id="u-flags">
      <span class="chip ${UNI.f.has_offer ? "on" : ""}" data-flag="has_offer">есть оферта</span>
      <span class="chip ${UNI.f.amort ? "on" : ""}" data-flag="amort">амортизация</span></div></div>
    <div class="screener-ranges"><div class="field"><label style="text-align:center;display:block">YTM, %</label><div class="range">
      <input type="number" step="0.5" id="u-ytm-min" placeholder="от" value="${UNI.f.ytm_min}"><span class="muted">–</span>
      <input type="number" step="0.5" id="u-ytm-max" placeholder="до" value="${UNI.f.ytm_max}"></div>
      <label style="text-align:center;display:block;margin-top:10px">Дюрация, лет</label><div class="range">
      <input type="number" step="0.1" id="u-dur-min" placeholder="от" value="${UNI.f.dur_min}"><span class="muted">–</span>
      <input type="number" step="0.1" id="u-dur-max" placeholder="до" value="${UNI.f.dur_max}"></div></div>
    <div class="field"><label style="text-align:center;display:block" title="Текущий годовой купон относительно рыночной цены, % годовых">Текущая доходность, %</label><div class="range">
      <input type="number" step="0.5" id="u-cy-min" placeholder="от" value="${UNI.f.cy_min}"><span class="muted">–</span>
      <input type="number" step="0.5" id="u-cy-max" placeholder="до" value="${UNI.f.cy_max}"></div>
      <label style="text-align:center;display:block;margin-top:10px" title="Средний дневной оборот за ~21 торговую сессию (месяц)">Ср. оборот/д, млн ₽</label><div class="range">
      <input type="number" step="1" id="u-vol-min" placeholder="от" value="${UNI.f.vol_min}"><span class="muted">–</span>
      <input type="number" step="1" id="u-vol-max" placeholder="до" value="${UNI.f.vol_max}"></div></div></div>
  </div>`);
  if (sectors.length) {
    filters.appendChild(el(`<div class="field" style="grid-column:1/-1;margin-top:4px"><label>Сектор</label><div class="chips" id="u-sec">${sectorChips}</div></div>`));
  }
  wrap.appendChild(filters);

  const apply = () => { UNI.loaded = false; loadUniverse().then(render); };
  const dbApply = debounce(apply, 350);
  filters.querySelectorAll("#u-rt .chip").forEach(c => c.onclick = () => { toggle(UNI.f.rating, c.dataset.rt); apply(); });
  filters.querySelectorAll("#u-kind .chip").forEach(c => c.onclick = () => { toggle(UNI.f.kinds, c.dataset.kind); apply(); });
  filters.querySelectorAll("#u-ccy .chip").forEach(c => c.onclick = () => { toggle(UNI.f.currencies, c.dataset.ccy); apply(); });
  filters.querySelectorAll("#u-liq .chip").forEach(c => c.onclick = () => { toggle(UNI.f.liq, c.dataset.liq); apply(); });
  filters.querySelectorAll("#u-freq .chip").forEach(c => c.onclick = () => { toggle(UNI.f.coupon_freq, c.dataset.freq); apply(); });
  filters.querySelectorAll("#u-flags .chip").forEach(c => c.onclick = () => { UNI.f[c.dataset.flag] = !UNI.f[c.dataset.flag]; apply(); });
  filters.querySelectorAll("#u-sec .chip").forEach(c => c.onclick = () => {
    if (c.id === "u-sec-more") { UNI.secExpanded = !UNI.secExpanded; render(); return; }
    toggle(UNI.f.sectors, c.dataset.sec); apply();
  });
  const bind = (id, key) => { const e = filters.querySelector(id); e.oninput = () => { UNI.f[key] = e.value; dbApply(); }; };
  bind("#u-ytm-min", "ytm_min"); bind("#u-ytm-max", "ytm_max"); bind("#u-dur-min", "dur_min"); bind("#u-dur-max", "dur_max");
  bind("#u-cy-min", "cy_min"); bind("#u-cy-max", "cy_max");
  bind("#u-vol-min", "vol_min"); bind("#u-vol-max", "vol_max");
  // The search box is a pure autocomplete (dropdown → open issue); it must not
  // trigger a table re-render, which would destroy the open dropdown.
  return wrap;
}

function screenerStats() {
  const rows = UNI.rows;
  // Средние берём с бэкенда — они посчитаны по ВСЕМУ отфильтрованному набору
  // (не по показанной странице) и только по фиксам, поэтому выбор фильтра «фикс»
  // их не меняет. Фолбэк на локальный расчёт, если поля нет.
  const _isY = r => r.kind === "fixed" || r.kind === "discount";   // фикс+дисконт, без флоатеров/линкеров
  const avgY = UNI.avgYtm != null ? UNI.avgYtm
    : (() => { const w = rows.filter(r => r.ytm != null && _isY(r)); return w.length ? w.reduce((s, r) => s + r.ytm, 0) / w.length : null; })();
  const avgD = UNI.avgDur != null ? UNI.avgDur
    : (() => { const w = rows.filter(r => r.duration_years != null && _isY(r)); return w.length ? w.reduce((s, r) => s + r.duration_years, 0) / w.length : null; })();
  const upd = UNI.updatedAt ? new Date(UNI.updatedAt).toLocaleString("ru-RU") : "—";
  const p = el(`<div class="panel"><div class="stat-row">
    <div class="s"><div class="l">Найдено${UNI.clean ? " (топ ликвидных)" : ""}</div><div class="v">${fmt(UNI.total)}${UNI.total > rows.length ? ` <span class="muted" style="font-size:12px">показано ${rows.length}</span>` : ""}</div></div>
    <div class="s"><div class="l">Средняя YTM</div><div class="v">${pct(avgY)}</div></div>
    <div class="s"><div class="l">Средняя дюрация</div><div class="v">${avgD == null ? "—" : fmt(avgD, 2) + " г."}</div></div>
    <div class="s" style="margin-left:auto"><label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;color:var(--muted)">
      <input type="checkbox" id="u-clean" ${UNI.clean ? "checked" : ""}> прятать аномалии и неликвид</label></div>
  </div></div>`);
  p.querySelector("#u-clean").onchange = (e) => { UNI.clean = e.target.checked; UNI.loaded = false; loadUniverse().then(render); };
  return p;
}

const SCOLS = [
  ["name", "Бумага"], ["currency", "Валюта"], ["rating_bucket", "Рейтинг"], ["sector", "Сектор"], ["kind", "Тип"],
  ["matdate", "Погашение"], ["price", "Цена"], ["ytm", "YTM"], ["duration_years", "Дюрация"],
  ["coupon_sort", "Купон"], ["current_yield", "Тек. дох."], ["couponfrequency", "Частота"], ["spread_display", "Премия"], ["ofz_dm_bp", "Премия к ОФЗ"], ["volume", "Ср. оборот/д"],
];
function screenerTable() {
  const rows = UNI.f.watch ? UNI.rows.filter(r => WATCH.has(r.isin)) : UNI.rows;
  const COL_HINT = { ytm: "Доходность к погашению или оферте; у флоатеров не показывается — будущие купоны неизвестны",
    duration_years: "у фиксов дюрация, у флоатеров срок до погашения или оферты",
    spread_display: "у фиксов — G-спред к кривой ОФЗ, у флоатеров — простая маржа к своему индексу",
    ofz_dm_bp: "у фиксов — спред к ближайшей ОФЗ, у флоатеров — премия к ОФЗ-ПК (DM)" };
  const head = `<th style="width:26px" title="Сравнить"></th>` + SCOLS.map(([k, l]) =>
    `<th data-k="${k}" style="cursor:pointer;user-select:none" title="${COL_HINT[k] ? COL_HINT[k] + " · клик — сортировать" : "Клик — сортировать"}">${l}<span class="muted" style="font-size:10px">${UNI.f.sort === k ? (UNI.f.desc ? " ▾" : " ▴") : " ⇅"}</span></th>`).join("");
  const body = rows.map(r => `<tr data-isin="${r.isin}">
    <td><input type="checkbox" class="cmp-cb" data-isin="${r.isin}" ${COMPARE.has(r.isin) ? "checked" : ""}></td>
    <td><span class="link">${r.name || r.isin}</span><div class="isin muted" style="font-size:11px;font-family:var(--mono)">${r.isin}</div></td>
    <td>${r.currency || "RUB"}</td>
    <td>${ratingPill(r)}</td>
    <td>${r.sector || "—"}</td>
    <td><span class="badge ${r.kind}">${KIND_RU[r.kind] || r.type_label || "—"}</span></td>
    <td>${dmy(r.matdate)}${r.offer_date ? `<div class="muted" style="font-size:10px">${offerWord(r)} ${dmy(r.offer_date)}</div>` : ""}</td>
    <td>${pct(r.price, 2)}${r.price_stale ? ` <span title="${(PT_RU[r.price_type]||r.price_type||'')}, нет сделок сегодня — цена может быть неактуальна" style="color:var(--warn,#e0a34a);cursor:help">⚠</span>` : ""}</td>
    <td>${r.kind === "floater" ? "—" : `<b>${pct(r.ytm)}</b>${yieldBasisBadge(r)}`}</td>
    <td>${r.kind === "floater"
        ? (r.years_to_maturity == null ? "—" : `${fmt(r.years_to_maturity, 1)}<div class="muted" style="font-size:10px">срок</div>`)
        : (r.duration_years == null ? "—" : fmt(r.duration_years, 2))}</td>
    <td>${r.kind === "floater"
        ? ((r.float_add != null || r.float_qm != null) ? `${flIndex(r)}+${fmt(r.float_add != null ? r.float_add : r.float_qm, 2)}<div class="muted" style="font-size:10px">${pct(flCoupon(r))}</div>` : "плав.")
        : r.kind === "discount" ? "Нет" : pct(r.couponpercent)}</td>
    <td>${r.current_yield != null ? pct(r.current_yield) : "—"}</td>
    <td>${freqRu(r.couponfrequency)}</td>
    <td class="${spreadCls(r.kind === 'floater' ? r.simple_margin_bp : r.g_spread_bp)}">${r.kind === "floater"
        ? `${bp(r.simple_margin_bp)}<div class="muted" style="font-size:10px">simple margin</div>${pctlChip(r.spread_pctl)}`
        : (r.g_spread_bp == null ? bp(r.g_spread_bp) : `<span class="gs-link" data-gs="${r.isin}" data-nm="${(r.name || '').replace(/"/g, '&quot;')}" title="история премии за риск — перцентиль, z, медиана" style="border-bottom:1px dashed currentColor;cursor:pointer">${bp(r.g_spread_bp)}</span>${pctlChip(r.spread_pctl)}`)}</td>
    <td class="${spreadCls(r.kind === 'floater' ? r.dm_ofz_bp : r.spread_ofz_bp)}">${r.kind === "floater"
        ? (r.dm_ofz_bp == null ? "—" : `${bp(r.dm_ofz_bp)}<div class="muted" style="font-size:10px">DM к ОФЗ</div>`)
        : bp(r.spread_ofz_bp)}</td>
    <td class="muted">${r.volume == null ? "—" : fmt(r.volume / 1e6, 1) + "М"}<div style="font-size:9px;color:${LIQ_COLOR[r.liq_class] || 'var(--muted)'}">${r.liq_class || ""}</div></td>
  </tr>`).join("");
  const empty = `<tr><td colspan="${SCOLS.length + 1}" class="muted" style="padding:28px;text-align:center">По заданным условиям ничего не найдено. Измените или очистите фильтры.</td></tr>`;
  const t = el(`<div class="tbl-wrap panel"><table><thead><tr>${head}</tr></thead><tbody>${body || empty}</tbody></table></div>`);
  t.querySelectorAll("th").forEach(th => th.onclick = () => {
    const k = th.dataset.k;
    if (!k) return;                        // колонка без сортировки (чекбокс сравнения)
    if (UNI.f.sort === k) UNI.f.desc = !UNI.f.desc; else { UNI.f.sort = k; UNI.f.desc = true; }
    UNI.loaded = false; loadUniverse().then(render);
  });
  t.querySelectorAll("tr[data-isin]").forEach(tr => tr.onclick = () => openIssue(tr.dataset.isin));
  t.querySelectorAll(".gs-link").forEach(s => s.onclick = (e) => { e.stopPropagation(); openGspreadModal(s.dataset.gs, s.dataset.nm); });
  t.querySelectorAll(".cmp-cb").forEach(cb => cb.onclick = (e) => {
    e.stopPropagation();
    if (cb.checked) COMPARE.add(cb.dataset.isin); else COMPARE.delete(cb.dataset.isin);
    updateCompareBar();
  });
  return t;
}

// ---------- Compare (2–4 bonds side by side) ----------
const COMPARE = new Set();
function updateCompareBar() {
  let bar = document.getElementById("cmp-bar");
  if (COMPARE.size < 2) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = el(`<div id="cmp-bar" style="position:fixed;left:50%;transform:translateX(-50%);bottom:20px;z-index:900;background:var(--panel-3);border:1px solid var(--line-2);border-radius:999px;padding:8px 10px 8px 18px;box-shadow:var(--shadow-lg);display:flex;align-items:center;gap:12px"></div>`);
    document.body.appendChild(bar);
  }
  bar.innerHTML = `<span>Выбрано <b>${COMPARE.size}</b> для сравнения</span>
    <button class="btn" id="cmp-go" style="padding:7px 16px">Сравнить</button>
    <button class="btn ghost" id="cmp-clear" style="padding:7px 12px">Сброс</button>`;
  bar.querySelector("#cmp-go").onclick = () => { NAV_STACK.push(TAB); TAB = "compare"; highlightTab(); render(); };
  bar.querySelector("#cmp-clear").onclick = () => { COMPARE.clear(); updateCompareBar(); render(); };
}

async function renderCompare(v) {
  v.appendChild(el(`<div class="toolbar"><button class="btn ghost" id="cmp-back">← Назад к скринеру</button></div>`));
  v.querySelector("#cmp-back").onclick = goBack;
  const host = el(`<div><div class="loading">Загружаю…</div></div>`); v.appendChild(host);
  const isins = [...COMPARE];
  const bonds = (await Promise.all(isins.map(i => fetch(`${API}/api/universe/one?isin=${i}`).then(x => x.ok ? x.json() : null).catch(() => null)))).filter(Boolean);
  host.innerHTML = "";
  if (bonds.length < 2) { host.innerHTML = `<div class="alert error">Нужно ≥2 бумаги.</div>`; return; }
  const ROWS = [
    ["Эмитент", b => b.issuer || "—"],
    ["Рейтинг", b => ratingPill(b)],
    ["Сектор", b => b.sector || "—"],
    ["Тип", b => `<span class="badge ${b.kind}">${KIND_RU[b.kind] || "—"}</span>`],
    ["Валюта", b => b.currency],
    ["Цена", b => pct(b.price, 2) + (b.price_stale ? " ⚠" : "")],
    ["Доходность", b => b.kind === "floater" ? pct(b.current_yield) + " <span class='muted' style='font-size:9px'>тек</span>" : pct(b.ytm)],
    ["Дюрация / срок, лет", b => b.kind === "floater"
        ? (b.years_to_maturity == null ? "—" : fmt(b.years_to_maturity, 1) + " <span class='muted' style='font-size:9px'>до погаш.</span>")
        : fmt(b.duration_years, 2)],
    ["Купон, %", b => pct(b.couponpercent)],
    ["Премия", b => b.kind === "floater" ? bp(b.simple_margin_bp) : bp(b.g_spread_bp)],
    ["к ОФЗ", b => b.kind === "floater" ? (b.dm_ofz_bp == null ? "—" : bp(b.dm_ofz_bp) + " <span class='muted' style='font-size:9px'>DM</span>") : bp(b.spread_ofz_bp)],
    ["Погашение", b => dmy(b.matdate)],
    ["Оферта", b => b.offer_date ? dmy(b.offer_date) + (b.offer_type === "CALL" ? " (колл)" : "") : "—"],
    ["Ср. оборот/д", b => b.volume == null ? "—" : fmt(b.volume / 1e6, 1) + " млн ₽"],
  ];
  const head = `<th style="text-align:left">Показатель</th>${bonds.map(b => `<th><span class="link" data-isin="${b.isin}">${b.name}</span></th>`).join("")}`;
  const body = ROWS.map(([label, fn]) => `<tr><td style="text-align:left;color:var(--muted)">${label}</td>${bonds.map(b => `<td>${fn(b)}</td>`).join("")}</tr>`).join("");
  const t = el(`<div class="tbl-wrap panel"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
  t.querySelectorAll("[data-isin]").forEach(x => x.onclick = () => openIssue(x.dataset.isin));
  host.appendChild(el(`<div class="panel"><h3>Сравнение выпусков (${bonds.length})</h3></div>`));
  host.appendChild(t);
}

// ---------- Autocomplete ----------
function attachAutocomplete(input, onPick, opts = {}) {
  let menu = null, items = [], active = -1;
  const close = () => { if (menu) { menu.remove(); menu = null; items = []; active = -1; } };
  const pick = (it) => { close(); input.value = it.type === "issuer" ? it.issuer : (it.name || it.isin); onPick(it); };
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) return close();
    let res = [];
    try { res = await fetch(`${API}/api/universe/suggest?q=${encodeURIComponent(q)}`).then(x => x.json()); } catch (e) { }
    if (opts.bondsOnly) res = res.filter(r => r.type !== "issuer");   // builder: only bonds
    if (opts.issuersOnly) res = res.filter(r => r.type === "issuer"); // issuer selectors
    close();
    if (!res.length) return;
    items = res;
    menu = el(`<div class="ac-menu">${res.map((r, i) => r.type === "issuer"
      ? `<div class="ac-item" data-i="${i}"><div><div class="nm">${r.issuer} <span class="badge fixed" style="font-size:9px;padding:1px 6px">эмитент</span></div><div class="isin">${r.count} выпусков · ${opts.issuerAction === "add" ? "добавить все" : "карта эмитента"}</div></div><div class="meta">→</div></div>`
      : `<div class="ac-item" data-i="${i}"><div><div class="nm">${r.name || r.isin}</div><div class="isin">${r.isin}</div></div><div class="meta">${pct(r.ytm)} · ${r.duration_years == null ? "" : fmt(r.duration_years, 1) + "г"}</div></div>`).join("")}</div>`);
    input.parentElement.appendChild(menu);
    menu.querySelectorAll(".ac-item").forEach(el2 => el2.onclick = () => pick(items[+el2.dataset.i]));
  }, 220);
  input.addEventListener("input", run);
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (menu && active >= 0) return pick(items[active]);   // выбран стрелками
      // иначе: точное совпадение по ISIN, иначе единственный результат.
      // Если меню ещё не построилось (быстрая вставка ISIN + Enter) — подтянем сразу.
      let list = items;
      if (!list.length) {
        const q0 = input.value.trim();
        if (q0.length < 2) return;
        try { list = await fetch(`${API}/api/universe/suggest?q=${encodeURIComponent(q0)}`).then(x => x.json()); } catch (er) { list = []; }
        if (opts.bondsOnly) list = list.filter(r => r.type !== "issuer");
        if (opts.issuersOnly) list = list.filter(r => r.type === "issuer");
      }
      const q = input.value.trim().toUpperCase();
      const chosen = list.find(it => (it.isin || "").toUpperCase() === q) || (list.length === 1 ? list[0] : null);
      if (chosen) pick(chosen);
      return;
    }
    if (!menu) return;
    if (e.key === "ArrowDown") { active = Math.min(active + 1, items.length - 1); }
    else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); }
    else if (e.key === "Escape") { return close(); }
    else return;
    e.preventDefault();
    menu.querySelectorAll(".ac-item").forEach((el2, i) => el2.classList.toggle("active", i === active));
  });
  // закрываем по потере фокуса (с задержкой на клик по пункту) — без утечки
  // глобального document-listener'а на каждый вызов attachAutocomplete
  input.addEventListener("blur", () => setTimeout(close, 160));
}

// ---------- Market map ----------
const MAP = { sector: null, rating: new Set(), kinds: new Set(["fixed"]), ccy: "RUB", metric: "yield", ytmMin: "5", ytmMax: "", durMin: "", durMax: "", volMin: "", volMax: "", curve: null, secExpanded: false, clean: true };
// Метрики оси Y. У фикса и флоатера они разные и в одну шкалу не складываются: доходности
// к погашению у флоатера нет (будущий купон неизвестен), простой маржи у фикса нет. Общих
// метрик две: текущая доходность (купон к цене) и z-спред к RUONIA OIS (у флоатера купоны
// прогнозируются по форвардам свопов), поэтому когда показаны оба типа сразу, доступны только они.
const METRIC_SETS = {
  fixed: [["yield", "Доходность к погашению"], ["gspread", "G-спред к КБД"], ["ofz", "Спред к ближайшей ОФЗ"]],
  floater: [["sm", "Простая маржа (SM)"], ["dm", "Премия к ОФЗ-ПК (DM)"]],
  both: [["cy", "Текущая доходность"], ["z", "Z-спред к OIS"]],
};
const METRIC_GROUPS = [["fixed", "Фикс"], ["floater", "Флоатеры"], ["both", "Фикс и флоатеры"]];
// метрики, которые считаются при выбранном типе бумаг
function metricsFor(kindFilter) {
  return kindFilter === "fixed" || kindFilter === "floater"
    ? [...METRIC_SETS[kindFilter], ...METRIC_SETS.both] : METRIC_SETS.both;
}
// метрика доступна, если она есть в наборе выбранного типа бумаг
function metricEnabled(m, kindFilter) { return metricsFor(kindFilter).some(([k]) => k === m); }
// спреды к рублёвым бенчмаркам у валютных выпусков не считаются: КБД и ОФЗ — рублёвые
const FX_OFF = ["gspread", "ofz", "dm", "z"];
function metricAvailable(m, kindFilter, fxOnly) {
  return metricEnabled(m, kindFilter) && !(fxOnly && FX_OFF.includes(m));
}
// чем подписать ось, когда выбранная метрика под тип не подходит
function defaultMetric(kindFilter) {
  return kindFilter === "fixed" ? "yield" : kindFilter === "floater" ? "sm" : "cy";
}
// все метрики видны сразу столбиками: фикс, флоатеры и общая; недоступные гасим
function metricColumns(cur, attr = "data-m", kindFilter = "all", fxOnly = false) {
  return `<div style="display:flex;gap:18px;flex-wrap:wrap">${METRIC_GROUPS.map(([g, title]) => `
    <div style="display:flex;flex-direction:column;gap:6px">
      <div class="muted" style="font-size:9px;letter-spacing:.14em;text-transform:uppercase">${title}</div>
      ${METRIC_SETS[g].map(([k, l]) => {
        const ok = metricAvailable(k, kindFilter, fxOnly);
        const why = (fxOnly && FX_OFF.includes(k))
          ? `title="у валютных выпусков спред к рублёвым бенчмаркам (КБД, ОФЗ) не считается"`
          : `title="считается только для ${g === "fixed" ? "фиксов" : "флоатеров"} — выберите этот тип бумаг"`;
        return `<span class="chip ${cur === k ? "on" : ""}${ok ? "" : " chip-off"}" ${ok ? `${attr}="${k}"` : why} style="white-space:nowrap">${l}</span>`;
      }).join("")}</div>`).join("")}</div>`;
}
function metricOf(r, metric) {
  const fl = r.kind === "floater";
  switch (metric) {
    case "gspread": return fl ? null : r.g_spread_bp;
    case "ofz": return fl ? null : r.spread_ofz_bp;
    case "sm": return fl ? r.simple_margin_bp : null;
    case "dm": return fl ? r.dm_ofz_bp : null;
    case "cy": return fl ? (r.current_yield ?? flCoupon(r)) : r.current_yield;
    case "z": return r.z_spread_bp;                          // одна шкала для фиксов и флоатеров
    case "spread": return fl ? r.dm_ofz_bp : r.g_spread_bp;   // «премия к безриску» для смешанного вида
    default: return fl ? flCoupon(r) : r.ytm;                  // доходность
  }
}
const metricLabel = m => ({ gspread: "G-спред к КБД, б.п.", sm: "Простая маржа, б.п.",
  dm: "Премия к ОФЗ-ПК, б.п.", ofz: "Спред к ОФЗ, б.п.", spread: "Премия к безриску, б.п.",
  cy: "Текущая доходность, %", z: "Z-спред к RUONIA OIS, б.п." }[m] || "Доходность, %");
// метрика в процентах (а не в базисных пунктах) — для формата подписей
const metricIsPct = m => m === "yield" || m === "cy";
// Поля диапазона задают видимую область карты и отбор выпусков в таблице.
// Процентные границы не применяем к спредам в базисных пунктах.
function marketMapRowsInRange(rows, filters) {
  const bound = value => value == null || String(value).trim() === "" ? null
    : (Number.isFinite(Number(value)) ? Number(value) : null);
  const dmin = bound(filters.durMin), dmax = bound(filters.durMax);
  const ymin = metricIsPct(filters.metric) ? bound(filters.ytmMin) : null;
  const ymax = metricIsPct(filters.metric) ? bound(filters.ytmMax) : null;
  return rows.filter(r => {
    const x = r.duration_years, y = metricOf(r, filters.metric);
    return x != null && y != null
      && (dmin == null || x >= dmin) && (dmax == null || x <= dmax)
      && (ymin == null || y >= ymin) && (ymax == null || y <= ymax);
  });
}
// тип бумаг на карте рынка из чипов «Тип» (мультивыбор)
function mapKindFilter() {
  const f = MAP.kinds.has("fixed"), fl = MAP.kinds.has("floater");
  return fl && !f ? "floater" : f && !fl ? "fixed" : "all";
}
// метрика должна считаться для выбранного типа — иначе берём метрику по умолчанию
function fixMapMetric() {
  const kf = mapKindFilter();
  if (!metricEnabled(MAP.metric, kf)) MAP.metric = defaultMetric(kf);
}
const BUCKETS = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC", "CC"];

async function renderMarketMap(v) {
  if (window.BondsMobile?.isPhone()) return window.BondsMobile.marketMap(v);
  if (!UNI.facets) {
    v.appendChild(el(`<div class="loading">Загружаю…</div>`));
    try { UNI.facets = await fetch(`${API}/api/universe/facets`).then(x => x.json()); }
    catch (e) { UNI.facets = { sectors: [], sector_counts: {} }; }   // avoid a re-render loop on fetch failure
    return render();
  }
  fixMapMetric();                       // тип бумаг мог смениться — метрика должна ему подходить
  const mSecCounts = UNI.facets.sector_counts || {};
  const sectors = [...(UNI.facets.sectors || [])].sort((a, b) => (mSecCounts[b] || 0) - (mSecCounts[a] || 0));
  const mTail = sectors.slice(14);
  const mVisible = MAP.secExpanded ? sectors : [...sectors.slice(0, 14), ...mTail.filter(s => MAP.sector === s)];
  const box = el(`<div class="panel"><h3>Карта рынка — доходность × дюрация</h3>
    <div class="filters" style="margin-bottom:12px">
      <div class="field"><label>Рейтинг</label><div class="chips" id="m-rt">
        ${BUCKETS.map(b => `<span class="chip ${MAP.rating.has(b) ? "on" : ""}" data-rt="${b}">${b}</span>`).join("")}</div></div>
      <div class="field"><label>Тип</label><div class="chips" id="m-kind">
        ${["fixed", "floater"].map(k => `<span class="chip ${MAP.kinds.has(k) ? "on" : ""}" data-kind="${k}">${KIND_RU[k]}</span>`).join("")}</div></div>
      <div class="field"><label>Валюта</label><div class="chips" id="m-ccy">
        ${(UNI.facets?.currencies || ["RUB"]).map(c => `<span class="chip ${MAP.ccy === c ? "on" : ""}" data-c="${c}">${c}</span>`).join("")}</div></div>
      <div class="field"><label>Доходность, %</label><div class="range">
        <input type="number" step="0.5" id="m-ymin" placeholder="от" value="${MAP.ytmMin}"><span class="muted">–</span>
        <input type="number" step="0.5" id="m-ymax" placeholder="до" value="${MAP.ytmMax}"></div></div>
      <div class="field"><label>Дюрация, лет</label><div class="range">
        <input type="number" step="0.1" id="m-dmin" placeholder="от" value="${MAP.durMin}"><span class="muted">–</span>
        <input type="number" step="0.1" id="m-dmax" placeholder="до" value="${MAP.durMax}"></div></div>
      <div class="field"><label title="Сумма дневных оборотов по выпуску / число доступных сессий (до 21), в млн ₽. Сессии без сделок — 0; текущая сессия может быть неполной. Если средней истории нет, используется оборот текущего снимка.">Ср. оборот/д, млн ₽</label><div class="range">
        <input type="number" step="1" min="0" id="m-vmin" placeholder="от" value="${MAP.volMin}"><span class="muted">–</span>
        <input type="number" step="1" min="0" id="m-vmax" placeholder="до" value="${MAP.volMax}"></div></div>
      <div class="field full"><label>Ось Y</label><div class="chips" id="m-metric">
        ${metricColumns(MAP.metric, "data-m", mapKindFilter())}</div>
        <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;color:var(--muted);margin-top:10px">
          <input type="checkbox" id="m-clean" ${MAP.clean ? "checked" : ""}> прятать аномалии и неликвид</label></div>
    </div>
    <div class="field full"><label>Сектор</label><div class="chips" id="m-sec">
      <span class="chip ${!MAP.sector ? "on" : ""}" data-sec="">Все</span>
      ${mVisible.map(s => `<span class="chip ${MAP.sector === s ? "on" : ""}" data-sec="${s}">${s}${mSecCounts[s] ? ` <span class="muted">${mSecCounts[s]}</span>` : ""}</span>`).join("")}
      ${mTail.length ? `<span class="chip" id="m-sec-more" style="background:transparent;border-style:dashed;color:var(--acc,#29ba74)">${MAP.secExpanded ? "свернуть ▲" : `+ ещё ${mTail.length} ▾`}</span>` : ""}
    </div></div></div>`);
  v.appendChild(box);
  box.querySelectorAll("#m-sec .chip").forEach(c => c.onclick = () => {
    if (c.id === "m-sec-more") { MAP.secExpanded = !MAP.secExpanded; render(); return; }
    MAP.sector = c.dataset.sec || null; render();
  });
  box.querySelectorAll("#m-rt .chip").forEach(c => c.onclick = () => { toggle(MAP.rating, c.dataset.rt); render(); });
  box.querySelectorAll("#m-kind .chip").forEach(c => c.onclick = () => { toggle(MAP.kinds, c.dataset.kind); fixMapMetric(); render(); });
  box.querySelectorAll("#m-ccy .chip").forEach(c => c.onclick = () => { MAP.ccy = c.dataset.c; render(); });
  box.querySelector("#m-clean").onchange = e => { MAP.clean = e.target.checked; render(); };
  box.querySelectorAll("#m-metric [data-m]").forEach(c => c.onclick = () => { MAP.metric = c.dataset.m; render(); });
  const dbRerender = debounce(render, 400);
  [["m-ymin", "ytmMin"], ["m-ymax", "ytmMax"], ["m-dmin", "durMin"], ["m-dmax", "durMax"], ["m-vmin", "volMin"], ["m-vmax", "volMax"]].forEach(([id, k]) => {
    box.querySelector("#" + id).oninput = e => { MAP[k] = e.target.value; dbRerender(); };
  });

  if (!sectors.length) { v.appendChild(el(`<div class="alert warn">Нет секторов — импортируй рейтинги/сектора во вкладке «Данные».</div>`)); return; }

  const chart = el(`<div class="panel" id="map-panel"><h3>${MAP.sector || "Все секторы"} — карта доходностей
      <button class="xc-btn" id="map-fs" title="Развернуть на весь экран" aria-label="Развернуть" style="position:absolute;top:0;right:0"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button></h3>
    <div class="chart tall" id="mapc"></div>
    <div class="muted">Цвет точки — кредитный рейтинг. Наведи для деталей, клик — карточка выпуска.</div></div>`);
  v.appendChild(chart);
  chart.querySelector("h3").style.position = "relative";
  chart.querySelector("#map-fs").onclick = () => {
    chart.classList.toggle("fullscreen");
    const inst = echarts.getInstanceByDom(chart.querySelector("#mapc"));
    if (inst) setTimeout(() => inst.resize(), 60);
  };
  const tbl = el(`<div class="panel"><h3>Выпуски${MAP.sector ? " · " + MAP.sector : ""}</h3><div id="mapt"></div></div>`);
  v.appendChild(tbl);
  drawMarketMap(chart.querySelector("#mapc"), tbl.querySelector("#mapt"));
}

async function loadRatingHistory(node) {
  let h = null;
  try { h = await fetch(`${API}/api/rating_curves/history`).then(x => x.json()); } catch (e) { }
  node.innerHTML = "";
  const buckets = Object.keys(h || {});
  if (!buckets.length) { node.innerHTML = `<div class="muted" style="padding:30px;text-align:center">Нет данных (обнови рынок и рейтинги)</div>`; return; }
  const order = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"];
  const series = order.filter(b => h[b]).map(b => ({
    name: b, type: "line", smooth: true, symbol: "none", lineStyle: { width: 2.5, color: RATING_COLOR[b] },
    itemStyle: { color: RATING_COLOR[b] },
    data: h[b].map(p => [p.month + "-01", p.ytm]),
  }));
  mkChart(node, {
    ...CHART_BG,
    tooltip: { trigger: "axis", valueFormatter: v => pct(v) },
    legend: { data: order.filter(b => h[b]), top: 0, textStyle: { color: AXIS_TXT }, icon: "roundRect", itemWidth: 12, itemHeight: 8 },
    grid: { left: 48, right: 20, top: 34, bottom: 30 },
    xAxis: { type: "time", ...AX },
    yAxis: { type: "value", name: "YTM, %", scale: true, ...AX },
    series,
  });
}

async function drawMarketMap(node, tnode) {
  const qp = new URLSearchParams({ limit: "4000", sort: "ytm", desc: "true" });
  if (MAP.ccy) qp.set("currencies", MAP.ccy);
  if (MAP.sector) qp.set("sectors", MAP.sector);
  if (MAP.rating.size) qp.set("rating", [...MAP.rating].join(","));
  if (MAP.kinds.size) qp.set("kinds", [...MAP.kinds].join(","));
  if (MAP.clean) qp.set("clean", "true");   // прятать аномалии и неликвид (<0,5 млн ₽)
  if (MAP.volMin !== "") qp.set("vol_min", Number(MAP.volMin) * 1e6);
  if (MAP.volMax !== "") qp.set("vol_max", Number(MAP.volMax) * 1e6);
  // Диапазоны сохраняют масштабирование карты; таблица ниже использует те же границы.
  const [res, curve] = await Promise.all([
    MARKET_REQUESTS.get(`/api/universe?${qp}`),
    MARKET_REQUESTS.get('/api/instrument/gcurve').catch(() => null),
  ]);
  if (!node.isConnected || !tnode.isConnected || TAB !== 'marketmap') return;
  MAP.curve = curve;
  // y = the selected metric (доходность / спред / к ОФЗ), kind-aware
  const yOf = r => metricOf(r, MAP.metric);
  const isYieldMetric = MAP.metric === "yield";
  const isPctMetric = metricIsPct(MAP.metric);      // доходность и текущая доходность — в %, остальное в б.п.
  // negative-yield names stay in tables but must not be plotted (user rule);
  // linkers (ОФЗ-ИН SU52) & ОФЗ-АД (SU46) quote non-comparable yields — drop them.
  const rows = (res.rows || []).filter(r => r.duration_years != null && yOf(r) != null
    && (!isPctMetric || yOf(r) > 0)        // spreads may be negative; yields must be positive
    && r.kind !== "linker" && r.kind !== "structured" && !(r.secid || "").startsWith("SU46"));
  const pt = r => ({ value: [r.duration_years, yOf(r)], name: r.name, isin: r.isin, kind: r.kind,
    rating: r.rating, sector: r.sector, g: r.g_spread_bp, sm: r.simple_margin_bp,
    ytm: r.ytm, yield_limitation: r.yield_limitation, yield_conditional_on_call: r.yield_conditional_on_call });
  const series = BUCKETS.map(b => ({
    name: b, type: "scatter", symbolSize: 11,
    data: rows.filter(r => (r.rating_bucket || "NR") === b).map(pt),
    itemStyle: { color: RATING_COLOR[b] || "#7f938d", opacity: .85 },
  }));
  const nr = rows.filter(r => !r.rating_bucket);
  if (nr.length) series.push({ name: "NR", type: "scatter", symbolSize: 10, data: nr.map(pt), itemStyle: { color: "#5c6f69", opacity: .55 } });
  // Fit the X axis to where the bonds actually are — don't stretch out to empty
  // long durations. Clip the КБД curve to the same range.
  const durs = rows.map(r => r.duration_years).filter(x => x != null);
  const maxDur = durs.length ? Math.max(...durs) : 10;
  const xMax = Math.ceil(Math.min(maxDur, 30) * 1.05 * 2) / 2;    // round to 0.5
  // Y-верх (доходность): подгоняем под данные, но ПОТОЛОК 35% — если бумаг выше нет,
  // не тянем ось до 35 (пустота); выбросы >35% прячутся зумом оси, данные не режем.
  const yvals = rows.map(yOf).filter(v => v != null).sort((a, b) => a - b);
  // по 98-му перцентилю (а не max) — один мусорный выброс (напр. 4647%) не должен
  // растягивать ось до потолка; сам выброс просто уходит выше видимой области.
  const yMaxAuto = isPctMetric && yvals.length ? Math.min(35, Math.ceil(_pctile(yvals, 0.98) + 0.5)) : null;
  const showCurve = curve?.tenors && MAP.ccy === "RUB" && isYieldMetric;   // КБД рисуется только к оси доходности; спрятать — кликом по легенде
  if (showCurve) series.unshift({ name: "КБД", type: "line", color: "#5b8def", data: curve.tenors.filter(t => t.period_years <= xMax).map(t => [t.period_years, t.yield_pct]), smooth: true, symbol: "none", lineStyle: { width: 2.5, color: "#5b8def", type: "dashed", opacity: .95 }, z: 4, tooltip: { show: false } });

  const c = mkChart(node, {
    ...CHART_BG,
    tooltip: { trigger: "item", formatter: p => p.seriesName === "КБД" ? `КБД ${fmt(p.value[0], 1)}г: ${pct(p.value[1])}` :
      `<b>${p.data.name}</b><br>${p.data.sector || ""} · ${p.data.rating || "NR"}<br>${metricLabel(MAP.metric).split(",")[0]}: <b>${isPctMetric ? pct(p.value[1]) : bp(p.value[1])}</b>${yieldBasisBadge(p.data)} · дюр ${fmt(p.value[0], 2)}г` },
    legend: { data: [...(showCurve ? ["КБД"] : []), ...BUCKETS, "NR"], top: 0, textStyle: { color: AXIS_TXT }, icon: "circle", itemWidth: 10, itemHeight: 10 },
    grid: { left: 56, right: 24, top: 40, bottom: 48 },
    // drag-a-rectangle zoom (toolbox) + wheel/pinch zoom (inside), both axes
    toolbox: { right: 12, top: 6, itemSize: 15, iconStyle: { borderColor: AXIS_TXT },
      feature: { dataZoom: { title: { zoom: "выделить область", back: "назад" }, brushStyle: { color: "rgba(31,224,160,.12)", borderColor: "var(--acc)" } }, restore: { title: "сброс" } } },
    dataZoom: [
      { type: "inside", xAxisIndex: 0, filterMode: "none" },
      { type: "inside", yAxisIndex: 0, filterMode: "none" },
    ],
    xAxis: { type: "value", name: "Дюрация, лет", nameLocation: "middle", nameGap: 30, min: MAP.durMin !== "" ? +MAP.durMin : 0, max: MAP.durMax !== "" ? +MAP.durMax : xMax, ...AX },
    // фильтр «Доходность, %» — только в режиме доходности (в G-спреде/SM/«к ОФЗ» он скрывал отрицательные спреды)
    yAxis: { type: "value", ...AX, name: metricLabel(MAP.metric), nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] }, scale: true, min: (isPctMetric && MAP.ytmMin !== "") ? +MAP.ytmMin : null, max: (isPctMetric && MAP.ytmMax !== "") ? +MAP.ytmMax : yMaxAuto },
    series,
  });
  c.on("click", p => { if (p.data?.isin) openIssue(p.data.isin); });

  // Sorting changes only the table: retain the chart, tooltip and zoom state.
  const drawTable = () => {
  const sortVal = { name: r => r.name || "", issuer: r => r.issuer || "", rating: r => r.rating_score ?? -1,
    ytm: r => yOf(r) ?? -1, dur: r => r.duration_years ?? -1,
    spread: r => (r.kind === "floater" ? r.simple_margin_bp : r.g_spread_bp) ?? -1e9, ofz: r => r.spread_ofz_bp ?? -1e9 };
  const s = MAP.tblSort || (MAP.tblSort = { f: "ytm", desc: true });
  const filteredRows = marketMapRowsInRange(rows, MAP);
  const sorted = [...filteredRows].sort((a, b) => {
    const va = sortVal[s.f](a), vb = sortVal[s.f](b);
    const c = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return s.desc ? -c : c;
  });
  const shown = sorted.slice(0, 80);
  const body = shown.map(r => {
    const fl = r.kind === "floater";
    return `<tr data-isin="${r.isin}">
    <td style="text-align:left"><span class="link">${r.name}</span></td>
    <td style="text-align:left">${r.issuer || "—"}</td>
    <td>${ratingPill(r)}</td>
    <td><b>${isPctMetric ? pct(yOf(r)) : bp(yOf(r))}</b>${fl && isPctMetric ? '<div class="muted" style="font-size:9px">тек.дох.</div>' : ""}</td>
    <td>${fmt(r.duration_years, 2)}</td>
    <td class="${spreadCls(fl ? r.simple_margin_bp : r.g_spread_bp)}">${fl ? bp(r.simple_margin_bp) + '<div class="muted" style="font-size:9px">SM</div>' + pctlChip(r.spread_pctl) : (r.g_spread_bp == null ? bp(r.g_spread_bp) : `<span class="gs-link" data-gs="${r.isin}" data-nm="${(r.name || '').replace(/"/g, '&quot;')}" title="история премии за риск" style="border-bottom:1px dashed currentColor;cursor:pointer">${bp(r.g_spread_bp)}</span>${pctlChip(r.spread_pctl)}`)}</td>
    <td class="${spreadCls(r.spread_ofz_bp)}">${fl ? "—" : bp(r.spread_ofz_bp)}</td></tr>`;
  }).join("");
  const arr = f => s.f === f ? (s.desc ? " ▼" : " ▲") : "";
  const th = (f, label, left, hint) => `<th class="m-sort" data-f="${f}"${hint ? ` title="${hint}"` : ""} style="cursor:pointer${left ? ";text-align:left" : ""}">${label}${arr(f)}</th>`;
  const t = el(`<div class="tbl-wrap" style="max-height:520px;overflow-y:auto"><table><thead><tr>${th("name", "Выпуск", 1)}${th("issuer", "Эмитент", 1)}${th("rating", "Рейтинг")}${th("ytm", isPctMetric ? "Дох." : metricLabel(MAP.metric))}${th("dur", "Дюр.")}${th("spread", "Премия", 0, "у фиксов G-спред к КБД, у флоатеров простая маржа (SM)")}${th("ofz", "Премия к ОФЗ", 0, "спред к ближайшей по дюрации ОФЗ; у флоатеров не считается")}</tr></thead><tbody>${body || '<tr><td colspan="7" class="muted" style="padding:20px;text-align:center">Нет выпусков в заданных границах — измените ограничения.</td></tr>'}</tbody></table></div>${filteredRows.length > 80 ? `<div class="muted" style="padding:8px">Показано 80 из ${filteredRows.length} — уточни фильтром.</div>` : ""}`);
  t.querySelectorAll("th.m-sort").forEach(h => h.onclick = () => {
    const f = h.dataset.f;
    if (s.f === f) s.desc = !s.desc; else { s.f = f; s.desc = true; }
    drawTable();
  });
  t.querySelectorAll("tr[data-isin]").forEach(tr => tr.onclick = () => openIssue(tr.dataset.isin));
  t.querySelectorAll(".gs-link").forEach(sp => sp.onclick = (e) => { e.stopPropagation(); openGspreadModal(sp.dataset.gs, sp.dataset.nm); });
  tnode.replaceChildren(t);
  };
  drawTable();
}

// ---------- Лента рейтинговых действий ----------
const RACT = { data: null, filter: "all", tradableOnly: false };
const AGENCY_RU = { ACRA: "АКРА", EXPERT_RA: "Эксперт РА", NKR: "НКР" };
async function renderRatingActions(v) {
  if (!RACT.data) {
    v.appendChild(el(`<div class="loading">Загружаю рейтинговые действия…</div>`));
    try { RACT.data = await fetch(`${API}/api/rating_actions?limit=300`).then(x => x.json()); } catch (e) { RACT.data = { actions: [] }; }
    return render();
  }
  const acts = RACT.data.actions || [];
  const dirBadge = x => {
    if (x.direction === "up") return `<span class="badge" style="background:rgba(31,224,160,.16);color:#1fe0a0;font-size:10px">▲ повышен</span>`;
    if (x.direction === "down") return `<span class="badge" style="background:rgba(255,107,107,.16);color:#ff6b6b;font-size:10px">▼ понижен</span>`;
    if (x.direction === "new") return `<span class="badge" style="background:rgba(139,123,255,.16);color:#8b7bff;font-size:10px">★ присвоен</span>`;
    if (x.direction === "hold") return `<span class="badge" style="font-size:10px">= подтверждён</span>`;
    return `<span class="badge muted" style="font-size:10px">обновление</span>`;
  };
  const FILTERS = [["all", "Все"], ["up", "▲ Повышения"], ["down", "▼ Понижения"], ["new", "★ Присвоения"], ["hold", "Подтверждения"]];
  const cnt = f => f === "all" ? acts.length : acts.filter(x => x.direction === f).length;
  let rows = RACT.filter === "all" ? acts : acts.filter(x => x.direction === RACT.filter);
  if (RACT.tradableOnly) rows = rows.filter(x => x.tradable);
  const chips = FILTERS.map(([k, l]) => `<span class="chip ${RACT.filter === k ? "on" : ""}" data-f="${k}">${l} <span class="muted">${cnt(k)}</span></span>`).join("");
  const head = el(`<div class="panel"><h3>Рейтинговые действия <span class="muted" style="font-weight:400;font-size:12px">· АКРА / Эксперт РА / НКР · последнее действие по эмитенту, ${RACT.data.total || acts.length} с датой</span></h3>
    <div class="chips" style="margin-top:8px">${chips}</div>
    <div class="chips" style="margin-top:8px"><span class="chip ${RACT.tradableOnly ? "on" : ""}" data-trad="1">только с торгуемыми выпусками</span></div>
    <div class="muted" style="font-size:11.5px;margin-top:8px">АКРА — с направлением ↑/↓; НКР — дата действия; клик по эмитенту с выпусками — его страница.</div></div>`);
  v.appendChild(head);
  head.querySelectorAll("[data-f]").forEach(c => c.onclick = () => { RACT.filter = c.dataset.f; render(); });
  head.querySelector("[data-trad]").onclick = () => { RACT.tradableOnly = !RACT.tradableOnly; render(); };
  const body = rows.map(x => `<tr ${x.tradable ? `data-iss="${(x.issuer || "").replace(/"/g, "&quot;")}" style="cursor:pointer"` : ""}>
    <td style="white-space:nowrap">${dmy(x.date)}</td>
    <td><span class="badge" style="font-size:10px">${AGENCY_RU[x.agency] || x.agency}</span></td>
    <td>${dirBadge(x)}</td>
    <td style="text-align:left"><b>${x.rating || "—"}</b>${x.forecast ? ` <span class="muted" style="font-size:10px">${x.forecast.toLowerCase()}</span>` : ""}</td>
    <td style="text-align:left">${x.tradable ? `<span class="link">${x.issuer}</span>` : `<span class="muted">${x.issuer}</span>`}</td></tr>`).join("");
  const t = el(`<div class="tbl-wrap panel" style="margin-top:12px"><div style="overflow-x:auto"><table><thead><tr>
    <th style="text-align:left">Дата</th><th>Агентство</th><th>Действие</th><th style="text-align:left">Рейтинг</th><th style="text-align:left">Эмитент</th></tr></thead>
    <tbody>${body || `<tr><td colspan="5" class="muted" style="padding:16px">нет действий</td></tr>`}</tbody></table></div></div>`);
  t.querySelectorAll("tr[data-iss]").forEach(tr => tr.onclick = () => openIssuer(tr.dataset.iss));
  v.appendChild(t);
}

// ---------- Аукционы ОФЗ (Минфин) ----------
const AUC = { data: null, red: null, loading: false, type: "all", gran: "month", metric: "demand", sort: "date", desc: true,
  swaps: true, rois: null, cmpDate: null, cmp: null, cmpLoading: false };
const AUC_COLS = [
  ["date", "Дата", r => dmy(r.date), "c"],
  ["series", "Выпуск", r => `ОФЗ ${r.series}`, "c"],
  ["type", "Тип", r => `<span class="badge ${r.type && r.type.includes("ПК") ? "floater" : "fixed"}" style="font-size:9px">${r.type}</span>`, "c"],
  ["matdate", "Погашение", r => dmy(r.matdate), "c"],
  ["offered_mln", "Предложено", r => r.offered_mln == null ? "—" : fmt(r.offered_mln / 1000, 1) + " млрд", "c"],
  ["demand_mln", "Спрос", r => r.demand_mln == null ? "—" : fmt(r.demand_mln / 1000, 1) + " млрд", "c"],
  ["placed_mln", "Размещено", r => r.placed_mln == null ? "—" : fmt(r.placed_mln / 1000, 1) + " млрд", "c"],
  ["bid_to_cover", "Спрос/предл.", r => r.bid_to_cover == null ? "—" : `<b style="color:${r.bid_to_cover >= 1 ? "var(--green)" : r.bid_to_cover < 0.5 ? "var(--red)" : "var(--text)"}">${fmt(r.bid_to_cover, 2)}×</b>`, "c"],
  ["cutoff_price", "Цена отсеч.", r => r.cutoff_price == null ? "—" : fmt(r.cutoff_price, 2), "c"],
  ["wa_price", "Ср.взвеш. цена", r => r.wa_price == null ? "—" : fmt(r.wa_price, 2), "c"],
  ["wa_yield", "Доходность", r => (r.type || "").includes("ПК")
      ? (r.sm_bp == null ? "—" : `<b>${r.sm_bp > 0 ? "+" : ""}${r.sm_bp}</b> б.п.<div class="muted" style="font-size:9px">SM</div>`
        + (r.auc_cy != null ? `<div style="font-size:10px" title="текущая доходность: ставка купона на дату аукциона ÷ цена размещения${r.auc_cy_est ? "; купон ещё не зафиксирован — оценка по RUONIA на дату" : ""}">тек. дох. <b>${r.auc_cy_est ? "≈" : ""}${fmt(r.auc_cy, 2)}%</b></div>` : ""))
      : (r.wa_yield == null ? "—" : `<b>${fmt(r.wa_yield, 2)}%</b>`), "c"],
  // вторичный рынок накануне аукциона (закрытие) и премия Минфина к нему: аукцион доходнее рынка —
  // Минфин доплатил за спрос; у ОФЗ-ПК сравниваем цены (дисконт к рынку = та же премия)
  ["pre", "Рынок накануне", r => {
    const pk = (r.type || "").includes("ПК");
    const none = !(r.placed_mln > 0);                 // аукцион не состоялся — премию считать не с чем
    if (r.pre_date == null) return r.first_auction
      ? `<span class="muted" style="font-size:10px" title="Первый аукцион — размещение нового выпуска: до него выпуск на бирже не торговался">новый выпуск,<br>торгов не было</span>` : "—";
    const top = pk
      ? (r.pre_sm_bp != null ? `<b>${r.pre_sm_bp > 0 ? "+" : ""}${r.pre_sm_bp} б.п.</b> <span class="muted" style="font-size:9px">SM</span>` : `<b>${fmt(r.pre_price, 2)}</b>`)
      : `<b>${fmt(r.pre_ytm, 2)}%</b>`;
    const sub = (pk && r.pre_cy != null ? `<div style="font-size:10px" title="текущая доходность: ставка купона на эту дату ÷ цена закрытия${r.pre_cy_est ? "; купон ещё не зафиксирован — оценка по RUONIA" : ""}">тек. дох. <b>${r.pre_cy_est ? "≈" : ""}${fmt(r.pre_cy, 2)}%</b></div>` : "")
      + `<div class="muted" style="font-size:9px">закрытие ${dmy(r.pre_date)}${pk && r.pre_price != null ? " · цена " + fmt(r.pre_price, 2) : ""}</div>`;
    let prem = null;
    if (!none) prem = pk ? (r.sm_bp != null && r.pre_sm_bp != null ? r.sm_bp - r.pre_sm_bp : null)
                         : (r.wa_yield && r.pre_ytm != null ? Math.round((r.wa_yield - r.pre_ytm) * 100) : null);
    const pl = none ? `<div class="muted" style="font-size:10px;margin-top:2px">аукцион не состоялся</div>`
      : prem == null ? "" : `<div style="font-size:10px;margin-top:2px;color:${prem > 0 ? "var(--amber)" : "var(--muted)"}" title="${pk ? "SM аукциона минус SM рынка накануне" : "доходность аукциона минус доходность этого выпуска на рынке накануне"}: плюс — Минфин дал премию к рынку">${prem > 0 ? `премия Минфина <b>+${prem} б.п.</b>` : prem < 0 ? `ниже рынка на <b>${-prem} б.п.</b>` : "точно по рынку"}</div>`;
    return top + sub + pl;
  }, "c"],
];

function showRedemptionIssues(year, issuesMap) {
  const list = issuesMap[year] || [];
  const total = list.reduce((s, i) => s + (i.vol_bln || 0), 0);
  const rows = list.map(i => `<tr data-isin="${i.isin}" style="cursor:pointer"><td style="text-align:left"><span class="link">${i.name || i.secid}</span></td><td><span class="badge ${i.type && i.type.includes("ПК") ? "floater" : "fixed"}" style="font-size:9px">${i.type}</span></td><td>${dmy(i.matdate)}</td><td style="text-align:right"><b>${fmt(i.vol_bln, 1)}</b> млрд</td></tr>`).join("");
  const ov = el(`<div class="modal-ov"><div class="modal" style="width:min(560px,95vw)">
    <div class="modal-title">Погашение ОФЗ в ${year} <span class="muted" style="font-weight:400;font-size:12px">· ${list.length} выпусков · ${fmt(total, 0)} млрд ₽ номинала</span><span class="link" data-close style="float:right;font-size:18px">✕</span></div>
    <div class="tbl-wrap" style="max-height:60vh;overflow:auto"><table><thead><tr><th style="text-align:left">Выпуск</th><th>Тип</th><th>Погашение</th><th style="text-align:right">Объём</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">нет данных</td></tr>'}</tbody></table></div></div></div>`);
  document.body.appendChild(ov);
  ov.onclick = (e) => { if (e.target === ov || e.target.closest("[data-close]")) ov.remove(); };
  ov.querySelectorAll("tr[data-isin]").forEach(tr => tr.onclick = () => { ov.remove(); openIssue(tr.dataset.isin); });
}

// ─── Индексы: облигации и акции в официальных пунктах MOEX. Для облигаций
// дополнительно доступна YTM текущей индексной базы; акции разделены по методике.
const INDEX_PAGE = { asset: "bonds", bondGroup: "fixed", equityGroup: "main", period: "1y", view: "yield", cache: {} };
const INDEX_GROUPS = {
  bonds: [["fixed", "Корпоративные"], ["floaters", "Флоатеры"], ["duration", "По сроку"], ["government", "Государственные"]],
  stocks: [["main", "Основные"], ["total_return", "Полная доходность"], ["sectors", "Отрасли"], ["themes", "Темы"]],
};
const INDEX_PERIODS = [["1m", "1 мес"], ["3m", "3 мес"], ["6m", "6 мес"], ["ytd", "YTD"], ["1y", "1 год"], ["3y", "3 года"], ["5y", "5 лет"], ["all", "Вся история"]];
const INDEX_COLORS = { market: "#8a6320", AAA: "#2f6fd6", AA: "#16856d", A: "#c6841d", BBB: "#b66142", HY: "#a63a31",
  key: "#6f5fc7", ruonia: "#25818c", short: "#2f6fd6", mid: "#16856d", long: "#c6841d", gov: "#65747a",
  inflation: "#b66142", municipal: "#91744a" };
const INDEX_DESCRIPTIONS = {
  RUCBTRNS: "широкий рынок корпоративных облигаций",
  RUCBTRAAANS: "корпоративные облигации рейтинга AAA",
  RUCBTRAANS: "корпоративные облигации рейтинга AA",
  RUCBTRANS: "корпоративные облигации рейтинга A",
  RUCBTRBBBNS: "корпоративные облигации рейтинга BBB",
  RUCBHYTR: "высокодоходные корпоративные облигации",
  RUFLCBTR: "флоатеры рейтинга не ниже A−",
  RUFLCBTRAAA: "флоатеры рейтинга AAA",
  RUFLCBTRAA: "флоатеры рейтинга AA",
  RUFLCBTRA: "флоатеры рейтинга A",
  RUCBKEYTR: "флоатеры с купоном, привязанным к ключевой ставке",
  RUCBRNTR: "флоатеры с купоном, привязанным к RUONIA",
  RUCBITR1Y: "корпоративные облигации со сроком до 1 года",
  RUCBTR3YNS: "корпоративные облигации со сроком 1–3 года",
  RUCBTR5YNS: "корпоративные облигации со сроком 3–5 лет",
  RGBI: "ценовой индекс государственных облигаций: изменение цен без реинвестирования купонов",
  RGBITR: "индекс полной доходности ОФЗ: изменение цен и реинвестированные купоны",
  RUFLGBITR: "ОФЗ с переменным купоном",
  RUGBINFTR: "ОФЗ с индексируемым номиналом",
  RUMBTRNS: "облигации субъектов РФ и муниципалитетов",
  IMOEX: "широкий рынок наиболее ликвидных российских акций, рубли",
  MOEXBMI: "акции широкого рынка Московской Биржи",
  MOEXBC: "наиболее ликвидные акции крупнейших российских компаний",
  MCXSM: "акции компаний средней и малой капитализации",
  RTSI: "акции Индекса МосБиржи, рассчитанные в долларах США",
  MCFTR: "Индекс МосБиржи с реинвестированием дивидендов до налогов",
  MCFTRR: "Индекс МосБиржи с дивидендами после налогов российской организации",
  MEBCTR: "голубые фишки с реинвестированием дивидендов до налогов",
  MESMTR: "средние и малые компании с реинвестированием дивидендов до налогов",
  MOEXOG: "нефть и газ",
  MOEXMM: "металлы и добыча",
  MOEXFN: "банки и финансовые компании",
  MOEXCN: "потребительские товары и розничная торговля",
  MOEXEU: "электроэнергетика",
  MOEXIT: "информационные технологии и телекоммуникации",
  MOEXRE: "строительные компании",
  MOEXTN: "транспорт",
  MOEXCH: "химия и нефтехимия",
  MOEXINN: "акции компаний инновационного сектора",
  MIPOTR: "акции недавних IPO с реинвестированием дивидендов",
  ESGITR: "компании с высокими рейтингами устойчивого развития, полная доходность",
  MESGTR: "сбалансированная ESG-корзина MOEX–RAEX, полная доходность",
};

const indexGroup = () => INDEX_PAGE.asset === "stocks" ? INDEX_PAGE.equityGroup : INDEX_PAGE.bondGroup;
const indexColor = s => s.color || INDEX_COLORS[s.tone] || "#8a6320";

function indexPeriodRows(s, period) {
  const points = s.points || [];
  if (!points.length || period === "all") return points;
  const last = points[points.length - 1]?.date;
  if (!last) return points;
  if (period === "ytd") return points.filter(p => p.date >= `${last.slice(0, 4)}-01-01`);
  const cutoff = new Date(`${last}T00:00:00Z`);
  const months = { "1m": 1, "3m": 3, "6m": 6, "1y": 12, "3y": 36, "5y": 60 }[period] || 12;
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const iso = cutoff.toISOString().slice(0, 10);
  return points.filter(p => p.date >= iso);
}

function indexMetric(s, viewType, asset, period) {
  const bondYield = viewType === "yield" && asset === "bonds";
  const rows = indexPeriodRows(s, period).filter(p => bondYield ? p.yield != null : p.close != null);
  if (!rows.length) return [];
  if (bondYield) return rows.map(p => [p.date, p.yield]);
  if (viewType === "base100" || viewType === "yield") {
    const base = rows[0].close;
    if (!base) return [];
    return viewType === "base100"
      ? rows.map(p => [p.date, p.close / base * 100])
      : rows.map(p => [p.date, (p.close / base - 1) * 100]);
  }
  return rows.map(p => [p.date, p.close]);
}

function indexStats(s, period) {
  const points = indexPeriodRows(s, period), price = points.filter(p => p.close != null);
  const p0 = price[0], p1 = price[price.length - 1], latest = points[points.length - 1];
  // «Сейчас» означает строго последнюю сессию, без подмены пропуска прошлой YTM.
  const y0 = points.find(p => p.yield != null);
  const ytm = latest?.yield ?? null;
  return {
    close: p1?.close ?? null,
    ret: p0 && p1 ? (p1.close / p0.close - 1) * 100 : null,
    ytm,
    dy: y0 && ytm != null ? ytm - y0.yield : null,
    dur: latest?.duration_days ?? null,
  };
}

async function openIndexComposition(code, name, asset) {
  const isStocks = asset === "stocks";
  const ov = el(`<div class="modal-ov"><div class="modal idx-comp-modal" role="dialog" aria-modal="true" aria-labelledby="idx-comp-title">
    <div class="idx-comp-title-row"><div><div class="idx-comp-kicker">Состав индекса</div><div class="modal-title" id="idx-comp-title">${escA(name || code)} <span>${escA(code)}</span></div></div>
      <button class="idx-comp-close" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div id="idx-comp-body"><div class="loading idx-comp-loading">Загружаю актуальную базу MOEX…</div></div>
  </div></div>`);
  const onKey = e => { if (e.key === "Escape") close(); };
  const close = () => { document.removeEventListener("keydown", onKey); ov.remove(); };
  ov.onclick = e => {
    if (e.target === ov || e.target.closest("[data-close]")) return close();
    const row = e.target.closest("[data-isin]");
    if (row) { const isin = row.dataset.isin; close(); openIssue(isin); }
  };
  document.addEventListener("keydown", onKey);
  document.body.appendChild(ov);

  const body = ov.querySelector("#idx-comp-body");
  try {
    const r = await fetch(`${API}/api/index_composition?code=${encodeURIComponent(code)}&asset=${encodeURIComponent(asset)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json(), items = d.items || [], floaterMode = d.metric_mode === "floater";
    const metrics = isStocks
      ? `<div class="idx-comp-kpi"><span>Бумаги</span><b>${fmt(d.count)}</b><small>в текущей базе</small></div>
         <div class="idx-comp-kpi"><span>Суммарный вес</span><b>${pct(d.total_weight)}</b><small>по данным MOEX</small></div>`
      : floaterMode
        ? `<div class="idx-comp-kpi"><span>Выпуски</span><b>${fmt(d.count)}</b><small>в текущей базе</small></div>
           <div class="idx-comp-kpi accent"><span>Средневзв. simple margin</span><b>${bp(d.weighted_simple_margin_bp)}</b><small>к базовой ставке</small></div>
           <div class="idx-comp-kpi accent"><span>Средневзв. срок</span><b>${d.weighted_term_years == null ? "—" : `${fmt(d.weighted_term_years, 2)} г.`}</b><small>до оферты / погашения</small></div>`
        : `<div class="idx-comp-kpi"><span>Выпуски</span><b>${fmt(d.count)}</b><small>в текущей базе</small></div>
           <div class="idx-comp-kpi accent"><span>Средневзв. YTM</span><b>${pct(d.weighted_ytm)}</b><small>годовых · MOEX</small></div>
           <div class="idx-comp-kpi accent"><span>Средневзв. дюрация</span><b>${d.weighted_duration_years == null ? "—" : `${fmt(d.weighted_duration_years, 2)} г.`}</b><small>модифицированная</small></div>`;
    const rows = isStocks ? items.map((x, i) => `<tr><td class="idx-comp-rank">${i + 1}</td><td class="idx-comp-security"><b>${escA(x.name)}</b><small>${escA(x.ticker || x.secid)}</small></td><td class="idx-comp-weight">${pct(x.weight)}</td></tr>`).join("")
      : items.map((x, i) => `<tr${x.isin ? ` data-isin="${escA(x.isin)}" title="Открыть карточку выпуска"` : ""}><td class="idx-comp-rank">${i + 1}</td>
        <td class="idx-comp-security"><b>${escA(x.name)}</b><small>${escA(x.isin || x.secid || x.ticker)}</small></td><td class="idx-comp-weight">${pct(x.weight)}</td>
        <td>${escA(x.rating || "—")}</td><td>${floaterMode ? bp(x.simple_margin_bp) : pct(x.ytm)}</td><td>${floaterMode ? (x.term_years == null ? "—" : `${fmt(x.term_years, 2)} г.`) : (x.duration_years == null ? "—" : `${fmt(x.duration_years, 2)} г.`)}</td>
        <td class="idx-comp-horizon">${dmy(floaterMode ? x.term_date : x.matdate)}${floaterMode && x.term_date ? `<small>${x.term_type === "offer" ? "оферта" : "погашение"}</small>` : ""}</td></tr>`).join("");
    body.innerHTML = `<div class="idx-comp-meta"><span>База на <b>${dmy(d.as_of)}</b></span><a href="${d.source_url}" target="_blank" rel="noopener">Методика и данные MOEX ↗</a></div>
      <div class="idx-comp-summary">${metrics}</div>
      <div class="idx-comp-table-wrap"><table class="idx-comp-table"><thead><tr>${isStocks
        ? "<th>№</th><th>Компания / тикер</th><th>Вес</th>"
        : floaterMode
          ? "<th>№</th><th>Выпуск</th><th>Вес</th><th>Рейтинг</th><th>Simple margin</th><th>Срок</th><th>Оферта / погашение</th>"
          : "<th>№</th><th>Выпуск</th><th>Вес</th><th>Рейтинг</th><th>YTM</th><th>Дюрация</th><th>Погашение</th>"}</tr></thead><tbody>${rows || `<tr><td colspan="${isStocks ? 3 : 7}" class="muted">MOEX не вернула состав на эту дату</td></tr>`}</tbody></table></div>
      ${isStocks ? "" : floaterMode
        ? `<div class="idx-comp-foot">Simple margin учитывает контрактную маржу флоатера, текущую цену и притяжение цены к номиналу. Срок считается до ближайшей действующей оферты, а если её нет — до погашения. Верхние карточки взвешены по весам выпусков в индексе.</div>`
        : `<div class="idx-comp-foot">YTM и дюрация в верхних карточках — официальные средневзвешенные показатели всего индекса. В строках показаны доступные текущие данные отдельных выпусков; нажмите на выпуск, чтобы открыть его карточку.</div>`}`;
  } catch (e) {
    body.innerHTML = `<div class="alert error">Не удалось загрузить состав индекса. ${escA(e.message || "")}</div>`;
  }
}

async function renderIndices(v) {
  const asset = INDEX_PAGE.asset, isStocks = asset === "stocks", group = indexGroup(), period = INDEX_PAGE.period, viewType = INDEX_PAGE.view;
  const bondYield = !isStocks && viewType === "yield";
  const groups = INDEX_GROUPS[asset], periodLabel = Object.fromEntries(INDEX_PERIODS)[period], periodText = period === "ytd" ? "YTD" : periodLabel.toLowerCase();
  const key = `${asset}|${group}|${period}`;
  const hero = el(`<div class="panel idx-hero">
    <div class="idx-market-switch" role="group" aria-label="Класс активов"><span>Класс активов</span><div class="idx-switch-track">
      <button class="${!isStocks ? "on" : ""}" data-asset="bonds">Облигации</button><button class="${isStocks ? "on" : ""}" data-asset="stocks">Акции</button></div></div>
    <div class="idx-heading"><div><div class="idx-kicker">${isStocks ? "Рынок акций" : "Рынок облигаций"} · MOEX</div><h2>${isStocks ? "Индексы акций" : "Индексы и доходности"}</h2>
      <p>${isStocks ? "Основные, полной доходности, отраслевые и тематические индексы — в официальных пунктах Московской Биржи." : "Сравнивайте совокупный доход сегментов и доходность облигаций внутри тех же индексных корзин."}</p></div>
      <div class="idx-asof" id="idx-asof">Загрузка…</div></div>
    <div class="idx-controls">
      <div class="field"><label>${isStocks ? "Семейство" : "Срез рынка"}</label><div class="chips" id="idx-group">${groups.map(([k, l]) => `<span class="chip ${group === k ? "on" : ""}" data-v="${k}">${l}</span>`).join("")}</div></div>
      <div class="field"><label>Вид графика</label><div class="chips" id="idx-view"><span class="chip ${viewType === "points" ? "on" : ""}" data-v="points">Пункты</span><span class="chip ${viewType === "base100" ? "on" : ""}" data-v="base100">База 100</span><span class="chip ${viewType === "yield" ? "on" : ""}" data-v="yield">Доходность</span></div></div>
      <div class="field idx-period"><label>Период</label><div class="chips" id="idx-period">${INDEX_PERIODS.map(([k, l]) => `<span class="chip ${period === k ? "on" : ""}" data-v="${k}">${l}</span>`).join("")}</div></div>
    </div></div>`);
  v.appendChild(hero);
  hero.querySelectorAll("[data-asset]").forEach(b => b.onclick = () => { INDEX_PAGE.asset = b.dataset.asset; render(); });
  hero.querySelectorAll("#idx-group .chip").forEach(b => b.onclick = () => { if (isStocks) INDEX_PAGE.equityGroup = b.dataset.v; else INDEX_PAGE.bondGroup = b.dataset.v; render(); });
  hero.querySelectorAll("#idx-view .chip").forEach(b => b.onclick = () => { INDEX_PAGE.view = b.dataset.v; render(); });
  hero.querySelectorAll("#idx-period .chip").forEach(b => b.onclick = () => { INDEX_PAGE.period = b.dataset.v; render(); });

  const yieldHint = group === "fixed" ? " · исходные значения MOEX без ограничения YTM"
    : group === "floaters" ? ` · это YTM корзин флоатеров, не значение КС (сейчас ${fmt(CUR_KC, 2)}%) или RUONIA` : "";
  const stockTitle = group === "total_return" ? "Индексы полной доходности" : group === "sectors" ? "Отраслевые индексы" : group === "themes" ? "Тематические индексы" : "Основные индексы акций";
  const indexSub = viewType === "base100" ? `100 = первая сессия периода · справа доходность за ${periodText}`
    : viewType === "yield" ? `накопленная доходность от первой сессии периода · справа итог за ${periodText}`
    : `официальные пункты MOEX · справа доходность за ${periodText}`;
  const bondIndexTitle = group === "government" ? "Государственные и муниципальные облигации" : "Динамика индексов полной доходности";
  const panelTitle = bondYield ? "Доходность облигаций в индексной базе" : isStocks && viewType === "yield" ? "Накопленная доходность индексов акций" : isStocks ? stockTitle : bondIndexTitle;
  const panel = el(`<div class="panel idx-main"><div class="idx-chart-head"><div><h3>${panelTitle}</h3><div class="muted">${bondYield ? `% годовых · взвешенная YTM базы MOEX${yieldHint}` : indexSub}</div></div><button class="xc-btn" id="idx-fs" title="Развернуть" aria-label="Развернуть"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button></div>
    <div id="idx-cards" class="idx-cards"></div><div id="idx-chart" class="chart tall"><div class="loading">Загружаю индексы MOEX…</div></div><div id="idx-guide" class="idx-guide"></div></div>`);
  v.appendChild(panel);
  const table = el(`<div class="panel idx-table"><h3>Срез на последнюю дату</h3><div id="idx-table"><div class="loading" style="padding:30px">Загрузка…</div></div></div>`);
  v.appendChild(table);

  window.BondsMobile?.indices(v);

  let data = INDEX_PAGE.cache[key];
  if (data && data._cacheHour !== Math.floor(Date.now() / 3600000)) data = null;
  if (!data) {
    try {
      const endpoint = isStocks ? "equity_indices" : "bond_indices";
      const r = await fetch(`${API}/api/${endpoint}?group=${group}&period=${period}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json(); data._cacheHour = Math.floor(Date.now() / 3600000); INDEX_PAGE.cache[key] = data;
    } catch (e) {
      panel.querySelector("#idx-chart").innerHTML = `<div class="alert error">Не удалось загрузить индексы. ${escA(e.message || "")}</div>`;
      table.remove(); return;
    }
  }
  if (TAB !== "indices" || INDEX_PAGE.asset !== asset || indexGroup() !== group || INDEX_PAGE.period !== period || INDEX_PAGE.view !== viewType) return;
  const quoteTimes = (data.series || []).filter(s => s.points?.at(-1)?.date === data.as_of && s.quote_time).map(s => s.quote_time).sort();
  const quoteTime = quoteTimes.at(-1);
  hero.querySelector("#idx-asof").innerHTML = data.as_of ? `на <b>${dmy(data.as_of)}${quoteTime ? ' · ' + escA(quoteTime.slice(0,5)) + ' мск' : ''}</b><small>${quoteTime ? 'последний биржевой срез' : 'последние доступные данные MOEX'} · обновление раз в час</small>` : "нет данных";
  const available = (data.series || []).filter(s => indexMetric(s, viewType, asset, period).length);
  const cards = panel.querySelector("#idx-cards");
  cards.innerHTML = available.map(s => {
    const st = indexStats(s, period), stockReturn = isStocks && viewType === "yield";
    const val = bondYield ? st.ytm : stockReturn ? st.ret : st.close;
    const delta = bondYield ? st.dy : st.ret;
    const good = delta == null ? "" : (bondYield ? (delta <= 0 ? "pos" : "neg") : cls(delta));
    return `<div class="idx-card idx-card-open" style="--series:${indexColor(s)}" role="button" tabindex="0" data-compose="${escA(s.code)}" data-name="${escA(s.name)}" aria-label="Показать состав индекса ${escA(s.name)}"><div class="idx-card-name"><span class="idx-card-label"><i></i><span>${escA(s.short)}</span></span><button class="idx-compose-btn" type="button" aria-label="Состав индекса ${escA(s.short)}">Состав</button></div>
      <div class="idx-card-value">${bondYield ? (st.badYield && val == null ? `<span title="MOEX публикует аномальную YTM выше 100%">—*</span>` : pct(val)) : stockReturn ? (val == null ? "—" : `${val >= 0 ? "+" : ""}${fmt(val, 2)}%`) : (val == null ? "—" : `${fmt(val, 2)} <small>п.</small>`)}</div>
      <div class="idx-card-delta ${good}">${delta == null ? "нет сравнения" : bondYield ? `${delta > 0 ? "+" : ""}${fmt(delta, 2)} п.п. · ${periodLabel}` : stockReturn ? `за ${periodText} · от первой сессии` : `${delta >= 0 ? "+" : ""}${fmt(delta, 2)}% · ${periodLabel}`}</div></div>`;
  }).join("");
  cards.querySelectorAll("[data-compose]").forEach(card => {
    const open = () => openIndexComposition(card.dataset.compose, card.dataset.name, asset);
    card.onclick = open;
    card.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
    card.querySelector(".idx-compose-btn").onclick = e => { e.stopPropagation(); open(); };
  });

  const series = available.map(s => {
    const points = indexMetric(s, viewType, asset, period);
    const lastValue = points.filter(p => p[1] != null).at(-1)?.[1];
    const endValue = lastValue == null ? "" : `${fmt(lastValue, 1)}${bondYield || viewType === "yield" ? "%" : ""}`;
    return { name: s.short, type: "line", showSymbol: false, smooth: .12, connectNulls: false,
      data: points, lineStyle: { width: s.tone === "market" || s.code === "IMOEX" ? 3 : 2.2, color: indexColor(s) },
      itemStyle: { color: indexColor(s) }, endLabel: { show: true, color: indexColor(s), fontWeight: 700, formatter: endValue },
      labelLayout: { moveOverlap: "shiftY" }, emphasis: { focus: "series", lineStyle: { width: 4 } } };
  });
  const chartNode = panel.querySelector("#idx-chart"); chartNode.innerHTML = "";
  if (!series.length) chartNode.innerHTML = `<div class="muted" style="padding:70px;text-align:center">Для этого показателя пока нет сопоставимых данных</div>`;
  else mkChart(chartNode, {
    ...CHART_BG,
    tooltip: { trigger: "axis", axisPointer: { type: "line" }, formatter: ps => `${dmyAny(ps[0].axisValue)}<br>` + ps.filter(p => p.value?.[1] != null).map(p => `${p.marker}${p.seriesName}: <b>${bondYield ? pct(p.value[1]) : viewType === "yield" ? `${p.value[1] >= 0 ? "+" : ""}${fmt(p.value[1], 2)}%` : viewType === "base100" ? `${fmt(p.value[1], 2)} · ${p.value[1] >= 100 ? "+" : ""}${fmt(p.value[1] - 100, 2)}%` : `${fmt(p.value[1], 2)} п.`}</b>`).join("<br>") },
    legend: { type: "scroll", top: 0, data: available.map(s => s.short),
      selected: Object.fromEntries(available.map(s => [s.short, true])),
      textStyle: { color: AXIS_TXT }, icon: "roundRect", itemWidth: 14, itemHeight: 7 },
    grid: { left: 58, right: 78, top: 44, bottom: 42 },
    xAxis: { type: "time", ...AX },
    yAxis: { type: "value", name: bondYield ? "YTM, %" : viewType === "yield" ? "доходность, %" : viewType === "base100" ? "база 100" : "пункты", scale: true, ...AX,
      axisLabel: { color: AXIS_TXT, formatter: v => bondYield || viewType === "yield" ? `${fmt(v, 1)}%` : fmt(v, 0) } },
    series,
  });
  panel.querySelector("#idx-guide").innerHTML = `<div class="idx-guide-head"><b>Что стоит за линиями</b><span>код открывает индекс на MOEX</span></div>
    <div class="idx-guide-grid">${available.map(s => `<div class="idx-guide-item" style="--series:${indexColor(s)}">
      <i aria-hidden="true"></i><div><div class="idx-guide-meta"><strong>${escA(s.short)}</strong><a href="${s.url}" target="_blank" rel="noopener">${escA(s.code)}</a></div>
      <div class="idx-guide-desc">${escA(INDEX_DESCRIPTIONS[s.code] || s.name)}</div></div></div>`).join("")}</div>`;
  panel.querySelector("#idx-fs").onclick = () => { panel.classList.toggle("fullscreen"); setTimeout(() => charts.forEach(c => c.resize()), 60); };

  const rows = (data.series || []).map(s => ({ s, st: indexStats(s, period) }));
  table.querySelector("#idx-table").innerHTML = `<div class="tbl-wrap"><table><thead><tr><th>Индекс</th><th>Код</th><th>Значение</th><th>За период</th>${isStocks ? "" : "<th>YTM базы</th><th>Изменение YTM</th><th>Дюрация</th>"}</tr></thead><tbody>${rows.map(({ s, st }) => `<tr>
    <td><span class="idx-dot" style="background:${indexColor(s)}"></span><b>${escA(s.name)}</b></td>
    <td><a class="link idx-code" href="${s.url}" target="_blank" rel="noopener">${s.code}</a></td><td>${fmt(st.close, 2)}</td>
    <td class="${cls(st.ret)}">${st.ret == null ? "—" : `${st.ret >= 0 ? "+" : ""}${fmt(st.ret, 2)}%`}</td>
    ${isStocks ? "" : `<td>${pct(st.ytm)}</td>
    <td class="${st.dy == null ? "" : st.dy <= 0 ? "pos" : "neg"}">${st.dy == null ? "—" : `${st.dy > 0 ? "+" : ""}${fmt(st.dy, 2)} п.п.`}</td>
    <td>${st.dur == null ? "—" : `${fmt(st.dur / 365, 2)} г.`}</td>`}</tr>`).join("")}</tbody></table></div>`;
  if (isStocks) {
    const treatment = group === "total_return" ? "Брутто учитывает реинвестирование дивидендов до налогов; нетто — после налогообложения для указанного типа инвестора." : "Ценовые индексы не учитывают дивиденды; для оценки результата с дивидендами выберите «Полная доходность».";
    v.appendChild(el(`<div class="idx-note"><b>Как читать.</b> «Пункты» показывает официальные уровни MOEX, «База 100» приводит линии к 100, «Доходность» показывает накопленное изменение в процентах от первой сессии периода. Справа — итог ровно за ${periodText}, таблица всегда сохраняет исходные пункты. ${treatment} РТС рассчитывается в долларах США. Источник: <a href="${data.source_url}" target="_blank" rel="noopener">ПАО Московская Биржа / ISS</a>.</div>`));
  } else {
    const floaterNote = group === "floaters" ? " «На КС» и «На RUONIA» — индексы корзин флоатеров по типу базовой ставки; их YTM не равна самой КС или RUONIA." : "";
    v.appendChild(el(`<div class="idx-note"><b>Как читать.</b> «Пункты» — официальный индекс MOEX, «База 100» — тот же индекс от 100 на старте периода, «Доходность» — взвешенная YTM входящих в него облигаций. Состав базы меняется при ребалансировках.${floaterNote} YTM показывается без отсечения значений, включая выше 100%. Экстремальные значения меняют масштаб; ненужные линии можно отключить в легенде. Прочерк означает отсутствие данных за последнюю сессию. Источник: <a href="${data.source_url}" target="_blank" rel="noopener">ПАО Московская Биржа / ISS</a>.</div>`));
  }
}

// ─── Макро: ставки/инфляция, денежная масса, кредит, ставки по вкладам/кредитам, деловая
// активность (ЦБ dataservice + hd_base), рынок акций (MOEX ISS), внешний сектор. Подразделы.
const MACRO = { data: null, rc: null, rh: null, loading: false, sub: null };
const MACRO_SUBS = [["summary", "Сводка"], ["infl", "Инфляция и ДКП"], ["rates", "Ставки и ликвидность"], ["markets", "Рынки"], ["credit", "Кредит и риски"], ["banks", "Банки"], ["economy", "Экономика"], ["budget", "Бюджет и госдолг"], ["external", "Внешний сектор"]];

// Экспорт всех макро-рядов в CSV (RU-Excel: ; и запятая-десятичная, BOM)
function macroExportCSV(d) {
  const cols = [];
  const push = (name, s) => { if (s && s.length) cols.push([name, Object.fromEntries(s.map(r => [r.date, r.val]))]); };
  const ri = d.rates_infl || [];
  push("Ключевая ставка,%", ri.map(r => ({ date: r.date, val: r.rate })));
  push("Инфляция ИПЦ гг,%", ri.map(r => ({ date: r.date, val: r.cpi })));
  const m = d.money || {}; push("M0,млрд", m.m0); push("M2,млрд", m.m2); push("M1,млрд", m.m1); push("Широкая ДМ,млрд", m.broad);
  const l = d.lending || {}; push("Кредиты юрл,млрд", l.corporate); push("Кредиты физл,млрд", l.retail);
  const n = d.npl || {}; push("Просрочка юрл,млрд", n.corporate); push("Просрочка физл,млрд", n.retail);
  push("Ипотека задолж,млрд", d.mortgage_debt);
  const dr = d.deposit_rates || {}; push("Вклад до1г,%", dr.short); push("Вклад свыше1г,%", dr.long);
  const cr = d.credit_rates || {}; push("Кредит юрл до1г,%", cr.corp_short); push("Кредит юрл свыше1г,%", cr.corp_long);
  push("RUONIA,%", d.ruonia);
  const b = d.business || {}; push("Бизнес-климат", b.climate); push("Ценовые ожидания предприятий", b.price_exp);
  const fx = d.fx || {}; push("USD,руб", fx.usd); push("EUR,руб", fx.eur); push("CNY,руб", fx.cny);
  const re = d.reer || {}; push("REER, накопл. с нач. года к тому же периоду пред. года,%", re.real); push("Ном.эфф.курс, накопл. с нач. года к пред. году,%", re.nominal);
  push("IMOEX", (d.imoex || []).map(r => ({ date: r.date, val: r.close })));
  const me = d.metals || {}; push("Золото,руб/г", me.gold); push("Серебро,руб/г", me.silver); push("Платина,руб/г", me.platinum); push("Палладий,руб/г", me.palladium);
  // остальные блоки — все ряды {date,val} обходом, путь ключей = имя столбца (напр. cpi_comp.food.yoy)
  const walk = (name, x) => {
    if (Array.isArray(x)) { if (x.length && x[0] && typeof x[0] === "object" && "date" in x[0] && "val" in x[0]) push(name, x); }
    else if (x && typeof x === "object") Object.entries(x).forEach(([k, y]) => walk(`${name}.${k}`, y));
  };
  ["budget_plan", "core_infl", "cpi_comp", "ppi", "industrial", "ivbo", "retail", "wages", "real_income", "unemployment", "housing", "confidence", "gdp_q", "gdp_use",
    "reserves", "keyrate_hist", "liquidity", "money_base", "credit_econ", "households", "issuance", "ext_debt", "trade", "weekly_cpi",
    "budget", "budget_annual", "nwf", "infl_exp", "mortgage_issue", "msp_lending", "capacity",
    "gov_debt", "banking", "rate_terms", "current_account", "mortgage_npl", "moex_cap_years",
    "fin_investments", "wb", "cpi_weights", "weekly_items", "ext_debt", "trade", "reserves", "credit_econ", "households"].filter((k, i, a) => a.indexOf(k) === i).forEach(k => walk(k, d[k]));
  const dates =[...new Set(cols.flatMap(([, mp]) => Object.keys(mp)))].sort();
  const esc = v => v == null ? "" : String(v).replace(".", ",");
  const header = ["Дата", ...cols.map(c => c[0])].join(";");
  const rows = dates.map(dt => [dt, ...cols.map(([, mp]) => esc(mp[dt]))].join(";"));
  const csv = "﻿" + [header, ...rows].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `bondsai_macro_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// запрос с повторами: при перезапуске сервера (выкладка) несколько секунд ответа нет — не
// показываем ошибку сразу, пробуем ещё раз через 2 и 5 секунд
async function fetchJSONRetry(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      last = new Error("HTTP " + r.status);
    } catch (e) { last = e; }
    if (i < tries - 1) await new Promise(res => setTimeout(res, [2000, 5000][i] || 5000));
  }
  throw last;
}

async function renderMacro(v) {
  if (MACRO.data == null && !MACRO.loading) {
    MACRO.loading = true;
    v.appendChild(el(`<div class="loading">Загружаю макроданные ЦБ и Мосбиржи…</div>`));
    try {
      const [m, rc, gc] = await Promise.all([          // быстрые — блокируют рендер
        fetchJSONRetry(`${API}/api/macro`),
        fetch(`${API}/api/rating_curves`).then(x => x.json()).catch(() => null),
        fetch(`${API}/api/instrument/gcurve`).then(x => x.json()).catch(() => null),
      ]);
      MACRO.data = m; MACRO.rc = rc; MACRO.gcurve = gc;
    } catch (e) { MACRO.data = { errors: { all: String(e) } }; }
    MACRO.loading = false;
    // история спредов по рейтингам считается ~медленно (до 20с) — грузим ОТДЕЛЬНО, не блокируя
    // вкладку; график «YTM по рейтингам помесячно» просто подтянется, когда придёт.
    MACRO.rh = null;
    fetch(`${API}/api/rating_curves/history`).then(x => x.json()).then(rh => { MACRO.rh = rh; render(); }).catch(() => { MACRO.rh = {}; });
    return render();
  }
  if (MACRO.loading) { v.appendChild(el(`<div class="loading">Загружаю…</div>`)); return; }
  const d = MACRO.data || {};
  const ri = d.rates_infl || [], money = d.money || {}, lend = d.lending || {}, nplD = d.npl || {}, mortD = d.mortgage_debt || [],
    depR = d.deposit_rates || {}, credR = d.credit_rates || {}, biz = d.business || {}, fxd = d.fx || {}, reerD = d.reer || {},
    ca = d.current_account || [], imoex = d.imoex || [], L = d.latest || {}, cap = d.moex_cap || {}, rc = MACRO.rc || {}, rh = MACRO.rh || {}, gcurve = MACRO.gcurve || null, gdpq = d.gdp_q || {};
  if (!ri.length && !imoex.length && !(money.m2 || []).length) {
    MACRO.data = null;                        // ошибку не запоминаем: при следующем открытии вкладки — новая попытка
    const box = el(`<div class="panel"><h3>Макроэкономика</h3><div class="alert warn">Не удалось загрузить макроданные. <button class="btn" style="margin-left:10px;padding:4px 12px">Повторить</button></div></div>`);
    box.querySelector("button").onclick = () => render();
    v.appendChild(box);
    return;
  }
  const trln = (mlrd, dg = 1) => mlrd == null ? "—" : fmt(mlrd / 1000, dg) + " трлн ₽";
  const capT = cap.cap == null ? "—" : fmt(cap.cap / 1e12, 1) + " трлн ₽";
  const skip = n => ({ interval: Math.max(0, Math.ceil(n / 12)) });
  const MUT = cssVar("--muted", "#8aa");
  const legOf = names => ({ top: 2, right: 8, data: names, textStyle: { color: MUT, fontSize: 11 }, icon: "roundRect", itemWidth: 12, itemHeight: 8 });
  const catX = xs => ({ type: "category", data: xs, ...AX, axisLabel: { color: AXIS_TXT, hideOverlap: true } });
  const zeroLine = { silent: true, symbol: "none", lineStyle: { color: "#9aa7b0", type: "dashed", width: 1 }, data: [{ yAxis: 0 }], label: { show: false } };
  let cid = 0;
  const panel = (title, sub, height, build) => {
    const id = `mc-${++cid}`;
    const p = el(`<div class="panel" style="margin-bottom:16px"><h3>${title}${sub ? ` <span class="muted" style="font-weight:400;font-size:12px">· ${sub}</span>` : ""}</h3><div class="chart" id="${id}" style="height:${height}px"></div></div>`);
    v.appendChild(p); build(p.querySelector(`#${id}`));
  };
  const merge = (series) => {
    const dates = [...new Set(series.flatMap(s => (s || []).map(r => r.date)))].sort();
    const col = s => { const m = Object.fromEntries((s || []).map(r => [r.date, r.val])); return dates.map(dt => m[dt] ?? null); };
    return { dates, col };
  };
  // производные: рост г/г (12 мес), поэлементная операция над двумя рядами
  const mapv = (s, f) => (s || []).map(r => ({ date: r.date, val: f(r.val) }));
  const yoyOf = (s) => { const a = s || []; const m = Object.fromEntries(a.map(r => [r.date, r.val])); return a.map(r => { const [y, mm] = r.date.split("-"); const p = m[`${+y - 1}-${mm}`]; return { date: r.date, val: (p != null && p !== 0 && r.val != null) ? (r.val / p - 1) * 100 : null }; }); };
  const opSeries = (a, b, f) => { const mb = Object.fromEntries((b || []).map(r => [r.date, r.val])); return (a || []).map(r => ({ date: r.date, val: (r.val != null && mb[r.date] != null) ? f(r.val, mb[r.date]) : null })); };
  const momDelta = (s) => { const a = (s || []).filter(x => x.val != null); return a.length < 2 ? null : a[a.length - 1].val - a[a.length - 2].val; };
  const badge = (dv, unit = "п.п.", inv = false) => { if (dv == null) return ""; const flat = Math.abs(dv) < 5e-3; const up = dv > 0; const col = flat ? "#9aa7b0" : ((inv ? !up : up) ? "#1fe0a0" : "#ff6b6b"); const arr = flat ? "→" : (up ? "▲" : "▼"); return `<span style="color:${col};font-size:11px;font-weight:500;margin-left:7px">${arr} ${fmt(Math.abs(dv), 2)} ${unit}</span>`; };
  // ползунок масштаба времени (dataZoom) — добавляется пост-проходом ко всем длинным графикам
  const DZ = [{ type: "inside" }, { type: "slider", height: 15, bottom: 6, borderColor: "transparent", backgroundColor: "rgba(140,150,160,.06)", fillerColor: "rgba(140,150,160,.16)", handleSize: "70%", moveHandleSize: 4, textStyle: { color: MUT, fontSize: 9 } }];
  // метки макс/мин на серии
  const mpOf = () => ({ symbol: "pin", symbolSize: 40, label: { fontSize: 9, color: "#fff", formatter: p => fmt(p.value, 1) }, data: [{ type: "max", name: "макс" }, { type: "min", name: "мин" }] });
  // затенение кризисных периодов (контекст): COVID-2020 и 2022
  const EVENTS = { silent: true, itemStyle: { color: "rgba(140,150,160,.09)" }, label: { show: false }, data: [[{ xAxis: "03.2020" }, { xAxis: "06.2020" }], [{ xAxis: "02.2022" }, { xAxis: "05.2022" }]] };
  const XP = { type: "line", lineStyle: { color: MUT, width: 1, type: "dashed" } };  // crosshair
  // ── частота «по годам»: чип «Годы» у панели сворачивает ряды по году: sum (потоки, только полные
  // годы), last (остатки и темпы г/г — на конец года), mean (ставки, индексы — среднее за год) ──
  let FREQ = "base", AGG = "last";
  const annualize = (s, how = "last") => {
    const by = {};
    (s || []).forEach(r => { if (r && r.val != null) { const y = String(r.date).slice(0, 4); (by[y] = by[y] || []).push(r); } });
    return Object.keys(by).sort().flatMap(y => {
      const a = by[y].sort((p, q) => (p.date < q.date ? -1 : 1));
      const full = /Q\d$/.test(a[0].date) ? 4 : /^\d{4}$/.test(a[0].date) ? 1 : 12;
      if (how === "sum") return a.length < full ? [] : [{ date: y, val: a.reduce((t, r) => t + r.val, 0) }];
      if (how === "mean") return [{ date: y, val: a.reduce((t, r) => t + r.val, 0) / a.length }];
      return [{ date: y, val: a[a.length - 1].val }];
    });
  };
  const AY = (s, how) => FREQ === "year" ? annualize(s, how || AGG) : (s || []);
  // будущие периоды до конца yEnd (ось продлевается под прогноз)
  const futureTo = (yEnd, gran = "m") => {
    const out = [];
    for (let y = new Date().getFullYear(); y <= yEnd; y++) {
      if (FREQ === "year" || gran === "y") out.push(String(y));
      else if (gran === "q") for (let q = 1; q <= 4; q++) out.push(`${y}-Q${q}`);
      else for (let m = 1; m <= 12; m++) out.push(`${y}-${String(m).padStart(2, "0")}`);
    }
    return out.map(dt => ({ date: dt, val: null }));
  };
  // прогноз — пунктирные рамки диапазона «мин–макс» по годам: spans = [{y, lo, hi, color, ax?, text?}]
  // gran: m — весь год по месяцам, dec — окт–дек (показатель «декабрь к декабрю»), q — кварталы
  // Рамки — отдельная custom-серия (а не markArea): у неё нормальная ширина и в режиме «Годы»
  // (категория ± 0,42), и она участвует в масштабе оси Y (план выше факта не обрезается).
  // Подписи (b.text) — над рамкой; несколько рамок одного года — подписи столбиком.
  // b.m0 — рамка с месяца m0 до декабря (напр. ключевая «с 27.07 до конца года»).
  const fcBoxes = (node, spans, { gran = "m", lblFn = mmy } = {}) => {
    const inst = echarts.getInstanceByDom(node); if (!inst || !spans.length) return;
    const xs = ((inst.getOption().xAxis || [])[0] || {}).data || [];
    const rng = (b, g) => { const y = b.y; if (FREQ === "year") return [String(y), String(y)]; if (b.m0) return [lblFn(`${y}-${b.m0}`), lblFn(`${y}-12`)];
      return g === "q" ? [lblFn(`${y}-Q1`), lblFn(`${y}-Q4`)] : g === "dec" ? [lblFn(`${y}-10`), lblFn(`${y}-12`)] : [lblFn(`${y}-01`), lblFn(`${y}-12`)]; };
    const byAx = {};
    spans.forEach(b => {
      const [a, z] = rng(b, b.gran || gran), ia = xs.indexOf(a), iz = xs.indexOf(z); if (ia < 0 || iz < 0) return;
      // прогноз одной цифрой (экспорт/импорт/сальдо у ЦБ без вилки) — пунктирная ЛИНИЯ на его уровне,
      // рамка — только у настоящего диапазона (раньше точку раздували на ±3% и она выглядела вилкой)
      const point = Math.abs(b.hi - b.lo) < 1e-9 * Math.max(1, Math.abs(b.hi));
      (byAx[b.ax || 0] = byAx[b.ax || 0] || []).push({ b, ia, iz, point, lo: Math.min(b.lo, b.hi), hi: Math.max(b.lo, b.hi) });
    });
    const half = FREQ === "year" ? 0.42 : 0.5;
    const add = Object.entries(byAx).map(([ax, items]) => {
      // подписи одной колонки (одинаковый старт) — столбиком над самой высокой рамкой
      const grp = {}; items.forEach(it => { if (it.b.text) (grp[it.ia] = grp[it.ia] || []).push(it); });
      Object.values(grp).forEach(g => { const top = Math.max(...g.map(x => x.hi)); g.sort((p, q) => q.hi - p.hi).forEach((it, k) => { it.k = g.length - 1 - k; it.top = top; }); });
      return {
        name: "прогноз", type: "custom", yAxisIndex: +ax, silent: true, z: 1, clip: true, tooltip: { show: false },
        encode: { x: [0, 1], y: [2, 3] }, data: items.map(it => [it.ia, it.iz, it.lo, it.hi]),
        renderItem: (params, api) => {
          const it = items[params.dataIndex], c = it.b.color, bw = api.size([1, 0])[0];
          const p0 = api.coord([api.value(0), api.value(3)]), p1 = api.coord([api.value(1), api.value(2)]);
          const x0 = p0[0] - bw * half, x1 = p1[0] + bw * half;
          const ch = it.point
            ? [{ type: "line", shape: { x1: x0, y1: p0[1], x2: x1, y2: p0[1] }, style: { stroke: c, lineWidth: 2, lineDash: [6, 3] } }]
            : [{ type: "rect", shape: { x: x0, y: p0[1], width: x1 - x0, height: Math.max(2, p1[1] - p0[1]) }, style: { fill: c + "18", stroke: c, lineWidth: 1.5, lineDash: [5, 3] } }];
          if (it.b.text) { const ty = api.coord([api.value(0), it.top])[1] - 4 - it.k * 12;
            ch.push({ type: "text", x: (x0 + x1) / 2, y: ty, style: { text: it.b.text, fill: c, font: "600 10px sans-serif", align: "center", verticalAlign: "bottom" } }); }
          return { type: "group", children: ch };
        },
      };
    });
    if (!add.length) return;
    const n = (inst.getOption().series || []).length;
    inst.setOption({ series: [...Array(n).fill({}), ...add] });
    // при наведении на любой период прогнозного года — подпись: «Прогноз ЦБ на 2027: … 6–11%»
    const byYear = {}; spans.forEach(b => (byYear[b.y] = byYear[b.y] || []).push(b));
    const yearOf = lbl => { const m4 = /(\d{4})/.exec(lbl); if (m4) return +m4[1]; const m2 = /'(\d{2})/.exec(lbl) || /(\d{2})\s*$/.exec(lbl); return m2 ? 2000 + +m2[1] : null; };
    const oldF = (((inst.getOption().tooltip || [])[0]) || {}).formatter;
    inst.setOption({ tooltip: { trigger: "axis", formatter: ps => {
      const all = Array.isArray(ps) ? ps : [ps], arr = all.filter(p => p.seriesName !== "прогноз");
      const ax = String(all[0]?.axisValue ?? "");
      const base = typeof oldF === "function" && arr.length ? oldF(arr) : ax;
      const y = yearOf(ax), list = byYear[y];
      if (!list) return base;
      const groups = {}; list.forEach(b => (groups[b.src || "Прогноз ЦБ"] = groups[b.src || "Прогноз ЦБ"] || []).push(b));
      return base + Object.entries(groups).map(([src, bs]) => `<div style="margin-top:6px;padding-top:5px;border-top:1px dashed ${MUT};font-size:11px">${src} на ${y}:<br>` +
        bs.map(b => `<span style="display:inline-block;width:12px;border-top:2px dashed ${b.color};margin-right:6px;vertical-align:middle"></span>${b.name || ""}: <b>${b.lbl || ""}</b>`).join("<br>") + "</div>").join("");
    } } });
  };
  const FC = d.cbr_forecast || {}, FCR = FC.rows || {}, FCY = (FC.years || []).map(Number), FC_END = Math.max(new Date().getFullYear(), ...FCY);
  const FCN = { key_rate: ["ключевая ставка, в среднем за год", "%"], infl_dec: ["инфляция, декабрь к декабрю", "%"], infl_avg: ["инфляция, в среднем за год", "%"],
    gdp: ["рост ВВП", "%"], consumption: ["конечное потребление", "%"], hh: ["потребление домохозяйств", "%"], accumulation: ["валовое накопление", "%"], gfcf: ["инвестиции в основной капитал", "%"],
    m2: ["рост денежной массы М2", "%"], credit: ["рост кредита экономике", "%"], credit_corp: ["рост кредита организациям", "%"], credit_hh: ["рост кредита населению", "%"],
    mortgage: ["рост ипотечного портфеля", "%"], exports_usd: ["экспорт товаров", " млрд $ за год"], imports_usd: ["импорт товаров", " млрд $ за год"], current_account: ["сальдо счёта текущих операций", " млрд $ за год"] };
  const rngTxt = (lo, hi, dg = 1) => lo === hi ? fmt(lo, dg) : `${fmt(lo, dg)}–${fmt(hi, dg)}`;
  const fcSpans = (key, color, extra = {}) => Object.entries(FCR[key] || {}).filter(([y]) => +y > +(FC.fact_year || 0)).map(([y, [lo, hi]]) => ({
    y: +y, lo: extra.div ? lo / extra.div : lo, hi: extra.div ? hi / extra.div : hi, color, ax: extra.ax, text: extra.text ? rngTxt(lo, hi) : "",
    src: `Прогноз ЦБ от ${FC.asof || ""}`, name: (FCN[key] || [key])[0], lbl: rngTxt(lo, hi, (FCN[key] || [])[1] === "%" ? 1 : 0) + ((FCN[key] || [])[1] || "") }));
  const FC_NOTE = FC.asof ? ` · пунктир — прогноз ЦБ от ${FC.asof}` : "";
  // ключевая: прогноз ЦБ — СРЕДНЯЯ за год. Для текущего года это число смешивает уже прошедшие
  // месяцы с будущими → по месяцам рисуем прогноз на ОСТАТОК года из сноски ЦБ («с 27 июля до
  // конца года — 13,7–14,0%»), он сопоставим с текущим уровнем ставки; в «Годах» — среднее за год
  const KRR = FC.key_rate_rest;
  const krSpans = () => fcSpans("key_rate", "#5b8def", { text: true }).map(b => {
    if (!KRR || FREQ === "year" || String(b.y) !== KRR.year) return b;
    const d0 = KRR.from, m0 = +d0.slice(5, 7) + (+d0.slice(8, 10) > 15 ? 1 : 0);
    if (m0 > 12) return b;
    const r = rngTxt(KRR.range[0], KRR.range[1]), dmy0 = `${d0.slice(8, 10)}.${d0.slice(5, 7)}`;
    return { ...b, lo: KRR.range[0], hi: KRR.range[1], m0: String(m0).padStart(2, "0"), text: r,
      name: `ключевая ставка в среднем с ${dmy0} до конца ${b.y}`, lbl: `${r}%` + `<br><span style="opacity:.75">в среднем за весь ${b.y} год — ${b.lbl}` + (KRR.ytd_avg != null ? `, из них с 1 января уже ${fmt(KRR.ytd_avg, 1)}%` : "") + "</span>" };
  });
  // унифицированный график «несколько рядов [{date,val}]» одного юнита
  const lineChart = (node, defs, src, { unit = "%", dg = 2, area = false, mln2trln = false, zero = false, mp = false, events = true, ext = [] } = {}) => {
    src = Object.fromEntries(defs.map(([k, , , o = {}]) => [k, AY(src[k], o.agg)]));
    const { dates, col } = merge([...defs.map(([k]) => src[k]), ext]);
    const fv = v2 => mln2trln ? `${fmt(v2 / 1000, dg)} трлн ₽` : `${fmt(v2, dg)}${unit === "%" ? "%" : " " + unit}`;
    const single = defs.length === 1;
    const xl = dates.map(mmy);
    const evData = [["03.2020", "06.2020"], ["02.2022", "05.2022"]].filter(([a]) => xl.includes(a)).map(([a, b]) => [{ xAxis: a }, { xAxis: b }]);
    const evArea = evData.length ? { silent: true, itemStyle: { color: "rgba(140,150,160,.09)" }, label: { show: false }, data: evData } : undefined;
    mkChart(node, {
      ...CHART_BG,
      tooltip: { trigger: "axis", axisPointer: XP, formatter: ps => `${ps[0].axisValue}<br>` + ps.filter(p => p.data != null).map(p => `${p.marker}${p.seriesName}: <b>${fv(p.data)}</b>`).join("<br>") },
      legend: legOf(defs.map(x => x[1])), grid: { left: mln2trln ? 48 : 44, right: single ? 46 : 18, top: 34, bottom: 40 },
      xAxis: catX(dates.map(mmy)),
      yAxis: { type: "value", name: mln2trln ? "трлн ₽" : unit, scale: true, ...AX, axisLabel: { color: AXIS_TXT, formatter: mln2trln ? (val => fmt(val / 1000, 0)) : undefined } },
      series: defs.map(([k, name, color], i) => ({
        name, type: "line", data: col(src[k]), symbol: "none", connectNulls: true, lineStyle: { width: 2, color }, itemStyle: { color },
        areaStyle: area ? { color: color + "14" } : undefined,
        markLine: (zero && i === 0) ? zeroLine : undefined,
        markPoint: (mp && single) ? mpOf() : undefined,
        markArea: (events && i === 0) ? evArea : undefined,
        z: 2,
      })),
    });
  };

  // столбики (слева) + линии (справа) на одной оси дат: bars/lines = [[имя, ряд {date,val}, цвет]]
  const PAL = ["#5b8def", "#1fe0a0", "#f5913c", "#ff6b6b", "#c792ea", "#f5c542", "#8bd450", "#4fc3f7", "#e57373", "#9aa7b0", "#ffb74d", "#81c784", "#ba68c8", "#4db6ac", "#f06292", "#a1887f"];
  const barLine = (node, { bars = [], lines = [], ub = "", ul = "%", dgb = 1, dgl = 1, stack = false, colorSign = false, signColors = ["#1fe0a0", "#ff6b6b"], lblFn = mmy, ext = [] } = {}) => {
    bars = bars.map(([n, s2, c, a]) => [n, AY(s2, a), c]); lines = lines.map(([n, s2, c, a]) => [n, AY(s2, a), c]);
    const { dates, col } = merge([...[...bars, ...lines].map(x => x[1]), ext]);
    const dual = bars.length && lines.length && ub !== ul;   // вторая ось — только если единицы разные
    const unitOf = p => (p.seriesType === "bar" ? ub : ul);
    mkChart(node, {
      ...CHART_BG,
      tooltip: { trigger: "axis", axisPointer: XP, formatter: ps => `${ps[0].axisValue}<br>` + ps.filter(p => p.data != null && (p.data.value ?? p.data) != null).map(p => { const val = p.data.value ?? p.data, u = unitOf(p); return `${p.marker}${p.seriesName}: <b>${fmt(val, p.seriesType === "bar" ? dgb : dgl)}${u === "%" ? "%" : u ? " " + u : ""}</b>`; }).join("<br>") },
      legend: legOf([...bars, ...lines].map(x => x[0])), grid: { left: 50, right: dual ? 50 : 18, top: 34, bottom: 40 },
      xAxis: catX(dates.map(lblFn)),
      yAxis: [
        { type: "value", name: bars.length ? ub : ul, scale: !bars.length, ...AX },
        ...(dual ? [{ type: "value", name: ul, position: "right", scale: true, ...AX, splitLine: { show: false }, axisLabel: { color: AXIS_TXT, formatter: ul === "%" ? "{value}%" : "{value}" } }] : []),
      ],
      series: [
        ...bars.map(([name, s, color]) => ({ name, type: "bar", stack: stack ? "S" : undefined, data: col(s).map(v2 => colorSign && v2 != null ? { value: v2, itemStyle: { color: v2 >= 0 ? signColors[0] : signColors[1] } } : v2), itemStyle: { color: colorSign ? signColors[0] : color }, markLine: colorSign ? zeroLine : undefined, z: 1 })),
        ...lines.map(([name, s, color], i) => ({ name, type: "line", yAxisIndex: dual ? 1 : 0, data: col(s), symbol: "none", connectNulls: true, lineStyle: { width: 2.2, color }, itemStyle: { color }, markLine: i === 0 && !bars.length ? zeroLine : undefined, z: 3 })),
      ],
    });
  };
  // тепловая карта «ряды × последние N периодов» (напр. промпроизводство по отраслям, % г/г)
  // invert: рост = плохо (инфляция → красный); center: нейтральная точка шкалы (напр. цель 4%)
  // недели Росстата: цены снимают в понедельник («на 14 сентября»), публикуют в среду (+2 дня)
  const wkShift = (dt, days) => { const x = new Date(dt + "T12:00:00"); x.setDate(x.getDate() + days); return x; };
  const ddmm = (x, yy) => `${String(x.getDate()).padStart(2, "0")}.${String(x.getMonth() + 1).padStart(2, "0")}${yy ? "." + String(x.getFullYear()).slice(2) : ""}`;
  const wkPub = (dt, yy) => ddmm(wkShift(dt, 2), yy);
  const wkTip = dt => `опубликовано ${ddmm(wkShift(dt, 2), true)} (ср) · цены на ${ddmm(wkShift(dt, 0), true)} (пн)`;
  const heatRows = (node, rows, { n = 18, unit = "%", dg = 1, invert = false, center = 0, cap = Infinity, lblDg = 0, xFn = mmy, tipX = null, autoH = false, note = "" } = {}) => {
    if (autoH) node.style.height = `${60 + (note ? 24 : 0) + rows.length * 19}px`;
    else if (note) { if (!node.dataset.h0) node.dataset.h0 = node.clientHeight; node.style.height = `${+node.dataset.h0 + 24}px`; }
    const dates = [...new Set(rows.flatMap(([, s]) => (s || []).map(r => r.date)))].sort().slice(-n);
    const data = [], names = rows.map(r => r[0]);
    rows.forEach(([, s], yi) => { const m = Object.fromEntries((s || []).map(r => [r.date, r.val])); dates.forEach((dt, xi) => { if (m[dt] != null) data.push([xi, yi, m[dt]]); }); });
    const lim = Math.min(cap, Math.max(5, ...data.map(x => Math.abs(x[2] - center)).sort((a, b) => a - b).slice(0, Math.ceil(data.length * 0.95))));
    const pal = ["#d9534f", "#f0a9a0", "#eef0ee", "#9fdcbf", "#1c9e6e"];
    // колонка подписей — по самой длинной (≈6,3px на символ при 11px), но не шире 40% графика
    const lw = Math.round(Math.min(Math.max(node.clientWidth * 0.4, 110), Math.max(90, Math.max(...names.map(n => n.length)) * 6.3 + 14)));
    mkChart(node, {
      ...CHART_BG,
      tooltip: { formatter: p => `${names[p.value[1]]} · ${(tipX || xFn)(dates[p.value[0]])}<br><b>${fmt(p.value[2], dg)}${unit}</b>` },
      title: note ? { text: note, left: 0, top: 2, textStyle: { fontSize: 11, fontWeight: 400, color: cssVar("--muted", "#8a8f98"), width: node.clientWidth - 10, overflow: "truncate" } } : undefined,
      grid: { left: lw, right: 14, top: note ? 30 : 8, bottom: 60 },
      xAxis: { type: "category", data: dates.map(xFn), ...AX, axisLabel: { color: AXIS_TXT, rotate: dates.length > 12 ? 45 : 0, fontSize: 10, interval: 0, lineHeight: 13 }, splitArea: { show: false } },
      yAxis: { type: "category", data: names, ...AX, axisLabel: { color: AXIS_TXT, fontSize: 11, width: lw - 12, overflow: "truncate" }, inverse: true },
      visualMap: { min: center - lim, max: center + lim, show: false, inRange: { color: invert ? [...pal].reverse() : pal } },
      series: [{ type: "heatmap", data, label: { show: dates.length <= 26, fontSize: 9, color: "#223", formatter: p => lblDg ? fmt(p.value[2], lblDg) : String(Math.round(p.value[2]) || 0) }, itemStyle: { borderColor: "rgba(0,0,0,.06)", borderWidth: 1 } }],
    });
  };
  // ставки по срокам: {название срока: ряд} → линии в заданном порядке (подписи укорочены)
  const termChart = (node, grp, order) => {
    const keys = order.map(([sub, lbl]) => [Object.keys(grp || {}).find(k => k.toLowerCase().startsWith(sub.toLowerCase())), lbl]).filter(([k]) => k);
    lineChart(node, keys.map(([k, lbl], i) => [k, lbl, PAL[i % PAL.length]]), grp, { unit: "%" });
  };
  const qlab = dt => { const m = /^(\d{4})-Q(\d)$/.exec(dt); return m ? `${m[2]}кв'${m[1].slice(2)}` : dt; };

  // ══════════ ПОДАЧА: разделы «по вопросам инвестора» · главное + «Подробнее» · режимы Абс. / % г/г / Доли / % ВВП ══════════
  const ci = d.core_infl || {}, coreS = ci.core_long || [], ciY = ci.yoy || {}, ciS = ci.saar || {}, ciSA = ci.sa || {};
  const ie = d.infl_exp || {}, ce = d.credit_econ || {}, bud = d.budget || {}, ba = d.budget_annual || {};
  const rsv = d.reserves || {}, un = d.unemployment || {}, rt = d.rate_terms || {}, hh = d.households || {};
  const RB = [["AAA", "#1fe0a0"], ["AA", "#5bd6a0"], ["A", "#a8d24a"], ["BBB", "#f5c542"], ["BB", "#f5913c"], ["B", "#ff6b6b"]];
  const lastOf = s => { const a = (s || []).filter(x => x && x.val != null); return a[a.length - 1] || null; };
  const ser = (arr, f) => (arr || []).map(r => ({ date: r.date, val: f(r) }));
  const rateS = ser(ri, r => r.rate), cpiS = ser(ri, r => r.cpi), imoexS = ser(imoex, r => r.close);
  // сумма за 12 КАЛЕНДАРНЫХ месяцев (если в окне пропуск — null, а не сумма за 14 месяцев)
  const roll12 = s => { const m = Object.fromEntries((s || []).map(r => [r.date, r.val])); return (s || []).map(r => { let [y, mo] = r.date.split("-").map(Number), sum = 0; for (let k = 0; k < 12; k++) { const v2 = m[`${y}-${String(mo).padStart(2, "0")}`]; if (v2 == null) return { date: r.date, val: null }; sum += v2; if (--mo === 0) { mo = 12; y -= 1; } } return { date: r.date, val: sum }; }); };
  const r3 = s => (s || []).map((r, i, a) => i < 2 ? { date: r.date, val: null } : { date: r.date, val: (a[i].val + a[i - 1].val + a[i - 2].val) / 3 });
  const yoyAny = s => {
    const a = (s || []).filter(r => r.val != null), m = Object.fromEntries(a.map(r => [r.date, r.val]));
    return a.map(r => { const dd = r.date, p = /^\d{4}$/.test(dd) ? String(+dd - 1) : (+dd.slice(0, 4) - 1) + dd.slice(4), pv = m[p]; return { date: dd, val: pv > 0 ? (r.val / pv - 1) * 100 : null }; });
  };
  // ВВП для режима «% ВВП»: сумма последних 4 кварталов номинала (млрд ₽; все рублёвые ряды тоже в млрд)
  const gq = (gdpq.nominal || []).filter(r => r.val != null), G4 = {};
  gq.forEach((r, i) => { if (i >= 3) G4[r.date] = gq.slice(i - 3, i + 1).reduce((a, x) => a + x.val, 0); });
  const gdpAt = dt => {
    if (/^\d{4}$/.test(dt)) return G4[`${dt}-Q4`] ?? null;
    const mq = /^(\d{4})-Q(\d)$/.exec(dt), mm = /^(\d{4})-(\d{2})/.exec(dt);
    let y, q; if (mq) { y = +mq[1]; q = +mq[2]; } else if (mm) { y = +mm[1]; q = Math.ceil(+mm[2] / 3); } else return null;
    for (let k = 0; k < 3; k++) { if (G4[`${y}-Q${q}`] != null) return G4[`${y}-Q${q}`]; if (--q === 0) { q = 4; y -= 1; } }
    return null;
  };

  // ── график уровней с режимами: abs (как есть / div) · yoy (% г/г) · share (доли в сумме) · gdp (% ВВП) ──
  // defs = [[ключ, имя, цвет, {overlay:true}?]]: overlay — пунктир поверх стопки, в долях не участвует
  const MODE_LBL = { abs: "Абс.", yoy: "% г/г", share: "Доли %", gdp: "% ВВП" };
  // Короткие пояснения универсальных переключателей. Их добавляем в «?» автоматически,
  // чтобы новый чип в макроблоке не оказался без справки.
  const MODE_HELP = {
    abs: "Абсолютное значение показателя в единицах, указанных на оси графика.",
    yoy: "Изменение к тому же периоду год назад, %.",
    share: "Доля каждой части в общем объёме, %.",
    gdp: "Значение показателя к номинальному ВВП за последние 4 квартала, %.",
    year: "Годовой вид: потоки суммируются, остатки берутся на конец года, ставки и индексы усредняются.",
    week: "Понедельная динамика без укрупнения до месяца или года.",
  };
  const levelChart = (node, mode, defs, src, { unit = "", div = 1, dg = 1, kind = "line", lblFn = mmy, ext = [] } = {}) => {
    const use = mode === "share" ? defs.filter(x => !(x[3] || {}).overlay) : defs;
    let S = {}, u = unit, stack = kind === "stack" || kind === "stackbar", type = kind === "bar" || kind === "stackbar" ? "bar" : "line", area = kind === "stack" || kind === "area";
    use.forEach(([k, , , o = {}]) => { S[k] = AY((src[k] || []).filter(r => r.val != null), o.agg); });
    if (mode === "yoy") {
      // «Годы» + г/г: для остатков/средних сначала г/г по месяцам, потом последний (среднее) за год —
      // иначе незавершённый год давал «август к декабрю» (рост с начала года под подписью г/г).
      // Потоки (сумма) — г/г полных лет (незавершённый год annualize(sum) и так отбрасывает).
      use.forEach(([k, , , o = {}]) => { const ag = o.agg || AGG;
        S[k] = FREQ === "year" && ag !== "sum" ? annualize(yoyAny((src[k] || []).filter(r => r.val != null)), ag === "mean" ? "mean" : "last") : yoyAny(S[k]); });
      u = "%"; stack = false; type = "line"; area = false;
    }
    else if (mode === "gdp") { use.forEach(([k]) => { S[k] = S[k].map(r => { const g = gdpAt(r.date); return { date: r.date, val: g ? r.val / g * 100 : null }; }); }); u = "% ВВП"; }
    else if (mode === "share") {
      const { dates, col } = merge(use.map(([k]) => S[k])), cols = use.map(([k]) => col(S[k]));
      const sums = dates.map((_, i) => cols.reduce((a, c) => a + (c[i] ?? 0), 0));
      use.forEach(([k], j) => { S[k] = dates.map((dt, i) => ({ date: dt, val: sums[i] ? cols[j][i] / sums[i] * 100 : null })); });
      u = "%"; stack = true; area = type !== "bar";
    } else use.forEach(([k]) => { S[k] = S[k].map(r => ({ date: r.date, val: r.val / div })); });
    const { dates, col } = merge([...use.map(([k]) => S[k]), ext]);
    const dgs = mode === "abs" ? dg : 1, sfx = u === "%" ? "%" : u ? " " + u : "";
    const stackNames = use.filter(x => !(x[3] || {}).overlay).map(x => x[1]);
    const ovName = (use.find(x => (x[3] || {}).overlay && !(x[3] || {}).noNet) || [])[1];   // пунктир поверх стопки (напр. долг)
    const DASH_ICON = "path://M0,3h7v3h-7z M10,3h7v3h-7z M20,3h7v3h-7z";
    mkChart(node, {
      ...CHART_BG,
      tooltip: {
        trigger: "axis", axisPointer: XP, formatter: ps => {
          let s = `${ps[0].axisValue}<br>` + ps.filter(p => p.data != null).map(p => `${p.marker}${p.seriesName}: <b>${fmt(p.data, dgs)}${sfx}</b>`).join("<br>");
          if (stack && mode !== "share" && stackNames.length > 1) {
            const tot = ps.filter(p => stackNames.includes(p.seriesName)).reduce((a, p) => a + (p.data || 0), 0);
            s += `<br>итого: <b>${fmt(tot, dgs)}${sfx}</b>`;
            const ov = ovName && ps.find(p => p.seriesName === ovName);
            if (ov && ov.data != null) s += `<br>чистые, за вычетом «${ovName}»: <b>${fmt(tot - ov.data, dgs)}${sfx}</b>`;
          }
          return s;
        }
      },
      legend: legOf(use.map(([, name, , o = {}]) => o.overlay ? { name, icon: DASH_ICON } : name)), grid: { left: 52, right: 18, top: 34, bottom: 40 },
      xAxis: catX(dates.map(lblFn)),
      yAxis: { type: "value", name: u, scale: mode === "yoy" || (!stack && type === "line" && !area), max: (mode === "share" && !use.some(([k]) => (S[k] || []).some(r => r.val < 0))) ? 100 : undefined, ...AX },
      series: use.map(([k, name, color, o = {}], i) => ({
        name, type: o.overlay ? "line" : type, stack: stack && !o.overlay ? "s" : undefined, data: col(S[k]), symbol: "none", connectNulls: true,
        lineStyle: { width: o.overlay ? 2.4 : (stack ? 1 : 2.2), color, type: o.overlay ? "dashed" : "solid" }, itemStyle: { color },
        areaStyle: area && !o.overlay ? (stack ? { color: color + "55" } : { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: color + "59" }, { offset: 1, color: color + "0a" }]) }) : undefined,
        markLine: mode === "yoy" && i === 0 ? zeroLine : undefined, z: o.overlay ? 3 : 2,
      })),
    });
  };
  // в подсказку — доля просрочки в портфеле на эту дату: pairs = [[подпись, ряд % {date,val}]]
  const nplTip = (node, pairs) => {
    const inst = echarts.getInstanceByDom(node); if (!inst) return;
    const f0 = (((inst.getOption().tooltip || [])[0]) || {}).formatter; if (typeof f0 !== "function") return;
    const maps = pairs.map(([lbl, sr]) => { const m = {}; AY(sr, "last").forEach(r => { if (r.val != null) m[FREQ === "year" ? r.date.slice(0, 4) : mmy(r.date)] = r.val; }); return [lbl, m]; });
    inst.setOption({ tooltip: { formatter: ps => { const t = f0(ps), a = String((Array.isArray(ps) ? ps : [ps])[0]?.axisValue ?? "");
      const add = maps.filter(([, m]) => m[a] != null).map(([lbl, m]) => `доля просрочки, ${lbl}: <b>${fmt(m[a], 2)}%</b>`);
      return add.length ? t + `<div style="margin-top:5px;padding-top:4px;border-top:1px dashed ${MUT};font-size:11px">${add.join("<br>")}</div>` : t; } } });
  };
  const tgt = node => { const i = echarts.getInstanceByDom(node); if (i) i.setOption({ series: [{ markLine: { silent: true, symbol: "none", data: [{ yAxis: 4 }], lineStyle: { color: "#9aa7b0", type: "dashed", width: 1.2 }, label: { formatter: "цель 4%", color: MUT, fontSize: 10, position: "insideEndTop" } } }] }); };

  // ── ползунок времени: по умолчанию последние ~6 лет (месяцы) / 7 лет (кварталы), история — ползунком ──
  const postDZ = node => {
    const inst = echarts.getInstanceByDom(node); if (!inst) return;
    let opt = inst.getOption();
    if ((opt.series || []).some(s => s.type === "heatmap")) return;
    // ── раскладка без наложений: легенда — своей строкой сверху (прокрутка, если не влезает),
    // названия осей — ниже неё; подписи оси X прячутся при пересечении ──
    const lg = (opt.legend || [])[0], g0 = (opt.grid || [])[0] || {};
    const dualY = (opt.yAxis || []).length > 1;
    const fix = {};
    if (lg && (lg.data || []).length) {
      // легенда переносится на строки (≤3) целиком, график опускается на её высоту; длиннее — прокрутка
      const names = lg.data.map(x => typeof x === "string" ? x : x.name), avail = Math.max(200, node.clientWidth - 16);
      let rows = 1, lineW = 0;
      names.forEach(n => { const w = String(n).length * 6.6 + 30; if (lineW + w > avail && lineW > 0) { rows++; lineW = w; } else lineW += w; });
      const wrap = rows <= 3;
      fix.legend = wrap ? { type: "plain", top: 0, left: 8, right: 8, itemGap: 12 } : { type: "scroll", top: 0, left: 8, right: 8, pageIconSize: 10, pageTextStyle: { color: MUT }, pageIconColor: MUT };
      fix.grid = [{ ...g0, top: Math.max(+g0.top || 0, 34 + (wrap ? rows : 1) * 18), right: dualY ? Math.max(+g0.right || 0, 50) : g0.right }];
    }
    // название оси Y рисуется над осью — сверху нужно ≥36px, иначе обрезается (кривая ОФЗ)
    if ((opt.yAxis || []).some(a => a.name)) { const gg = (fix.grid || [g0])[0]; if ((+gg.top || 0) < 36) fix.grid = [{ ...gg, top: 36 }]; }
    // ось X: подписи прячутся при пересечении; справа запас ≥30px под последнюю дату (прижим крайних
    // подписей alignMin/MaxLabel не используем — он сдвигает их ПОСЛЕ проверки наложений → «01.202107.2021»)
    if ((opt.xAxis || []).length && opt.xAxis[0].type === "category") {
      fix.xAxis = [{ axisLabel: { hideOverlap: true, margin: 12 } }];   // margin: первая дата не задевает нижнюю подпись шкалы Y
      const gg = (fix.grid || [g0])[0];
      if ((+gg.right || 0) < 30) fix.grid = [{ ...gg, right: 30 }];
    }
    if (Object.keys(fix).length) { inst.setOption(fix); opt = inst.getOption(); }
    const xa = opt.xAxis && opt.xAxis[0];
    if (!xa || xa.type !== "category" || (xa.data || []).length <= Math.min(24, +node.dataset.keep || 24) || (opt.dataZoom || []).length) return;
    const dd = xa.data, lastL = String(dd[dd.length - 1]);
    const monthly = /^\d{2}\.\d{4}$/.test(lastL), quarterly = /кв'|Q\d/.test(lastL), weekly = /^\d{2}\.\d{2}\.\d{2}$/.test(lastL);
    if (!monthly && !quarterly && !weekly) return;   // годовые оси — без ползунка, видна вся история
    const keep = +node.dataset.keep || (monthly ? 72 : quarterly ? 28 : 104);
    // последний индекс с фактическими данными (ось может быть продлена в будущее под прогноз)
    const lastIdx = Math.max(-1, ...(opt.series || []).map(sr => { const a = sr.data || []; for (let i = a.length - 1; i >= 0; i--) { const v2 = a[i]; if (v2 != null && (v2.value ?? v2) != null && !(Array.isArray(v2) && v2[1] == null)) return i; } return -1; }));
    const sv = Math.max(0, (lastIdx >= 0 ? lastIdx + 1 : dd.length) - keep);
    const ev = [["03.2020", "06.2020"], ["02.2022", "05.2022"]].filter(([a]) => dd.includes(a)).map(([a, b]) => [{ xAxis: a }, { xAxis: b }]);
    // minValueSpan: ближе 3 периодов (мес./кв./нед.) не приближать
    inst.setOption({ dataZoom: [{ ...DZ[0], startValue: sv, minValueSpan: 3 }, { ...DZ[1], startValue: sv, minValueSpan: 3 }], grid: [{ ...(opt.grid && opt.grid[0]), bottom: 56 }], tooltip: { axisPointer: XP }, ...(ev.length ? { series: [{ markArea: { silent: true, itemStyle: { color: "rgba(140,150,160,.09)" }, label: { show: false }, data: ev } }] } : {}) });
  };

  // ── реестр графиков: C(раздел, заголовок, подпись, высота, build(node, mode), {modes, main, custom}) ──
  const REG = [];
  const C = (sec, title, sub, h, build, o = {}) => REG.push({ sec, title, sub, h, build, modes: o.modes || null, main: o.main !== false, custom: o.custom || null, agg: o.agg || null, base: o.base || "Мес.", alt: o.alt || null, altFor: o.altFor || null, num: o.num || null, tog: o.tog || null });
  // ── «ⓘ» у названия: при наведении — табличка методологии (что значит каждый ряд и как считается),
  // по нажатию — закрепить. Строки берутся из рядов графика в ТЕКУЩЕМ режиме + словарь METH ──
  const RS = "Росстат", CB = "ЦБ РФ", MF = "Минфин";
  const METH_G = {
    "Ключевая ставка": "Ставка Банка России по основным операциям недельного срока — главный инструмент ДКП. На графике — на конец месяца; в «Годах» — среднее за год. " + CB,
    "ИПЦ, г/г": "Индекс потребительских цен: рост стоимости корзины ~550 товаров и услуг к тому же месяцу прошлого года. " + RS,
    "ИПЦ": "Индекс потребительских цен (корзина ~550 товаров и услуг). " + RS,
    "ИПЦ факт, г/г": "Фактическая инфляция к тому же месяцу год назад — для сравнения с ожиданиями. " + RS,
    "ИПЦ всего": "Весь ИПЦ, % к тому же месяцу год назад. " + RS,
    "Базовая, г/г": "Базовый ИПЦ: инфляция без плодоовощей, топлива, тарифов ЖКУ, транспорта и других регулируемых и сезонных позиций (~70% корзины) — «устойчивая» часть роста цен. " + RS,
    "Базовая": "Базовый ИПЦ (без сезонных и регулируемых позиций, ~70% корзины), г/г. " + RS,
    "Базовый ИПЦ": "Базовый ИПЦ, месячный прирост без сезонности в годовом выражении. " + CB,
    "RUONIA": "Средневзвешенная ставка межбанковских кредитов овернайт по сделкам крупнейших банков, на конец месяца. Ниже ключевой — в системе избыток денег, выше — нехватка. " + CB,
    "КБД": "Кривая бескупонной доходности ОФЗ: доходность гособлигаций для каждого срока, строится по сделкам на Мосбирже — безрисковая ставка рынка. MOEX / " + CB,
    "IMOEX": "Индекс МосБиржи: 40–50 крупнейших акций, в рублях, ценовой (без реинвестирования дивидендов). MOEX",
    "Продовольственные": "Продовольственные товары. " + RS, "Непродовольственные": "Непродовольственные товары. " + RS, "Услуги": "Платные услуги населению. " + RS,
    "Экспорт": "Экспорт товаров. ", "Импорт": "Импорт товаров. ",
  };
  const BANK_ALL = "Банк из списка публичных (торгуются на Мосбирже). Чистая прибыль после налогов по РСБУ — форма 102 ЦБ, символ 61101 (не МСФО).";
  const METH = {
    "Ключевая ставка, инфляция и базовая инфляция": { "Рамки прогноза": "Пунктирные рамки — среднесрочный прогноз ЦБ (последний опубликованный). Синие — средняя ключевая за год (для текущего года — на оставшиеся месяцы, из сноски к прогнозу); оранжевые — инфляция декабрь к декабрю (стоят в IV квартале)." },
    "Базовая и устойчивая инфляция, г/г": {
      "Базовая без туризма": "Базовый ИПЦ без услуг зарубежного туризма (сильно зависят от курса) — расчёт ЦБ.",
      "Медиана (с весами)": "Медиана годовых приростов цен компонент ИПЦ с учётом весов: половина корзины (по весу) дорожает быстрее, половина — медленнее. Нечувствительна к скачкам отдельных товаров. " + CB,
      "Медиана (без весов)": "То же, но все компоненты считаются равными. " + CB,
      "Без 20% волатильных": "ИПЦ после исключения 20% компонент с самыми сильными историческими колебаниями цен. " + CB,
      "Трендовая (окно 5 лет)": "Оценка ЦБ устойчивой инфляции: общий «тренд», который движет ценами всех компонент (динамическая факторная модель, окно 5 лет). Меняется медленно — хороший ориентир «куда сходится» инфляция." },
    "Текущие темпы инфляции (SAAR)": {
      "ИПЦ": "Месячный прирост ИПЦ, очищенный от сезонности (SA), в годовом выражении: (1 + м/м)^12 − 1 — какой была бы годовая инфляция, если бы цены весь год росли, как в этом месяце. Шумный, но показывает разворот раньше г/г. " + CB,
      "Базовый ИПЦ": "То же для базового ИПЦ. " + CB,
      "Базовый ИПЦ, ср. 3 мес": "Среднее SAAR базового ИПЦ за 3 последних месяца — убирает шум отдельного месяца. Этот показатель ЦБ чаще всего упоминает в решениях по ставке.",
      "Модиф. базовая (усечение)": "Модифицированная базовая инфляция ЦБ: из месячных приростов компонент отбрасываются крайние (самые быстрые и самые медленные) по весу, по остальным — средняя; SA, в годовом выражении.",
      "Модиф. базовая (искл. волатильных)": "Модифицированная базовая инфляция ЦБ: ИПЦ без наиболее волатильных компонент; SA, в годовом выражении.",
      "Медиана (с весами)": "Взвешенная медиана месячных приростов цен компонент, SAAR. " + CB },
    "Инфляционные ожидания": {
      "Население: ожидаемая": "Медиана ответа на вопрос «какой будет инфляция в ближайшие 12 месяцев», %. Опрос инФОМ по заказу ЦБ.",
      "Население: наблюдаемая": "Медиана оценки людьми инфляции за прошедшие 12 месяцев, %. Обычно заметно выше официальной.",
      "Предприятия: ценовые ожидания": "Мониторинг предприятий ЦБ: баланс ответов о ценах на свою продукцию в ближайшие 3 месяца (доля ожидающих рост − доля ожидающих снижение), пункты, правая шкала." },
    "Недельная инфляция": { "Недельная инфляция": "Как считаем: Росстат каждую неделю (среда к среде) публикует изменение цены по ~110 товарам-представителям (Nedel_ipc.xlsx). Берём изменение каждого товара и усредняем с его весом в корзине ИПЦ текущего года (файл весов Росстата). Эти товары — около 37% корзины, услуги почти не входят, поэтому оценка может расходиться с официальной цифрой из пресс-релиза Росстата и с месячной инфляцией. Первая точка года охватывает новогодние недели и обычно больше. Пунктир — цель ЦБ 4% г/г, пересчитанная в неделю: (1,04)^(1/52) − 1 ≈ 0,075%. " + RS,
      "Цель 4% в неделю": "Если цены растут на 0,075% каждую неделю, за год набегает ровно 4%. Столбик выше пунктира — неделя быстрее цели, ниже — медленнее." },
    "Инфляция по компонентам, г/г": {
      "Продовольствие без плодоовощей": "Продовольственные товары без овощей, фруктов и картофеля (самые сезонные). " + CB,
      "Непрод без нефтепродуктов": "Непродовольственные товары без бензина и дизтоплива. " + CB,
      "Услуги без ЖКУ": "Услуги без жилищно-коммунальных (тарифы ЖКУ регулируются и индексируются раз в год). " + CB,
      "Плодоовощная продукция": "Овощи, фрукты, картофель — самая волатильная часть корзины. " + RS },
    "Рост цен по компонентам — тепловая карта": {
      "г/г": "Рост цен компоненты за 12 месяцев: цепочка 12 сезонно сглаженных месячных приростов ЦБ.",
      "м/м": "Прирост за месяц с учётом сезонности, %. Цель 4% в год ≈ 0,33% в месяц.",
      "SAAR": "Месячный прирост SA в годовом выражении, % — сопоставим с целью 4%.",
      "Товары · неделя": "Изменение цены к предыдущей неделе (неделя к неделе), %. 40 самых весомых товаров из недельного мониторинга Росстата. Подпись — дата публикации (среда); цель 4% в год ≈ 0,08% в неделю.",
      "Товары · месяц": "Изменение цены за календарный месяц — к концу предыдущего месяца (месяц к месяцу), %. Расчёт — недельные приросты, сложенные по сложному проценту, без сезонной очистки. Текущий месяц неполный.",
      "Товары · год": "Изменение цены за календарный год: с 1 января по 31 декабря, %. Это не г/г: для текущего года показано изменение с начала года до последней опубликованной недели. Расчёт — недельные приросты по сложному проценту.",
      "г/г · м/м · SAAR": "Компоненты ИПЦ по данным ЦБ, сезонно сглаженные (SA): г/г — за 12 месяцев, м/м — за месяц, SAAR — месячный прирост в годовом выражении.",
      "Вес после названия": "Доля компоненты в корзине ИПЦ на текущий год — структура потребительских расходов населения (Росстат). Для недель — вес конкретного товара." },
    "Реальные ставки": {
      "Ключевая − ИПЦ": "Ключевая ставка минус инфляция г/г, п.п. Больше 0 — деньги дороже, чем растут цены: ДКП жёсткая, сберегать выгодно.",
      "Вклад до 1 года − ИПЦ": "Средневзвешенная ставка по рублёвым вкладам физлиц сроком до года минус инфляция — реальная доходность вкладов.",
      "Ключевая − базовая": "Ключевая минус базовая инфляция г/г." },
    "Цены производителей (PPI), г/г": {
      "Промышленность": "Индекс цен производителей промышленных товаров: цены отгрузки (без НДС) к тому же месяцу год назад. Опережает ИПЦ на несколько месяцев. " + RS,
      "Добыча": "Добыча полезных ископаемых (нефть, газ, уголь, руды) — зависит от мировых цен и курса. " + RS,
      "Обработка": "Обрабатывающие производства. " + RS,
      "Электроэнергия, газ": "Обеспечение электроэнергией, газом и паром — в основном регулируемые тарифы. " + RS },
    "Ликвидность банковского сектора": { "Дефицит(+)/профицит(−)": "Структурный баланс ликвидности, среднее за месяц: сколько банки должны ЦБ (дефицит, > 0) или держат у него лишних денег (профицит, < 0). Дефицит толкает ставки денежного рынка вверх. " + CB },
    "Ставки по вкладам и кредитам — по срокам": {
      "_all": "Средневзвешенная ставка по операциям, проведённым за месяц, в рублях, для этого срока по договору. " + CB,
      "Ипотека": "Средневзвешенная ставка по выданным за месяц ипотечным жилищным кредитам (включая льготные программы). " + CB,
      "Автокредиты": "Средневзвешенная ставка по выданным автокредитам. " + CB },
    "Денежная масса": {
      "Широкая": "M2 + депозиты в иностранной валюте (в рублях) — вся денежная масса. " + CB,
      "M2": "Наличные вне банков + рублёвые средства населения и компаний на счетах и депозитах — «деньги в национальном определении». " + CB,
      "M1": "Наличные + рублёвые средства на текущих и расчётных счетах (без срочных депозитов) — самые «быстрые» деньги. " + CB,
      "M0 (наличные)": "Наличные деньги в обращении вне банков. " + CB },
    "Доходность по рейтингам — кривая": { "_all": "Доходность к погашению облигаций с этим кредитным рейтингом (АКРА / Эксперт РА / НКР / НРА) в зависимости от дюрации — по данным приложения." },
    "YTM по рейтингам, помесячно": { "_all": "Медианная доходность к погашению облигаций этой рейтинговой группы за месяц." },
    "Кредитный спред BB − AAA": { "BB − AAA": "Разница медианных доходностей облигаций рейтинга BB и AAA, п.п. — премия за кредитный риск; растёт в стресс." },
    "Индексы полной доходности облигаций": {
      "Гособлигации": "RGBITR — индекс полной доходности ОФЗ: цена + купоны, которые реинвестируются. MOEX",
      "Корпоративные": "RUCBTRNS — индекс полной доходности корпоративных облигаций. MOEX",
      "ВДО": "RUCBHYTR — индекс высокодоходных облигаций (низкие рейтинги). MOEX" },
    "Капитализация рынка к ВВП (индикатор Баффета)": {
      "Кап / ВВП": "Капитализация всех акций Мосбиржи ÷ номинальный ВВП, %. До 2023 — World Bank; дальше — расчёт: капитализация на последний торговый день года ÷ ВВП года; «сейчас» — капитализация на сегодня ÷ ВВП за 4 последних квартала. Ниже — рынок дешевле относительно экономики.",
      "Цель (указ № 309)": "Указ Президента № 309 от 07.05.2024: капитализация 66% ВВП к 2030 г. и 75% — к 2036 г." },
    "Кредит экономике": {
      "Кредит экономике": "Требования банковской системы к экономике: кредиты компаниям и населению + вложения банков в корпоративные облигации; прирост г/г без валютной переоценки. " + CB,
      "Корпоративные кредиты": "Кредиты банков организациям, г/г. " + CB, "Корпоративные облигации": "Вложения банков в облигации компаний, г/г. " + CB,
      "Кредиты физлицам": "Кредиты населению (ипотека, потребительские, авто), г/г. " + CB,
      "Юрлица и ИП": "Задолженность по кредитам юрлицам и ИП (резидентам) на конец месяца. " + CB, "Физлица": "Задолженность по кредитам физлицам-резидентам на конец месяца, без приобретённых банками прав требования — поэтому на ~10% меньше портфеля из обзора банковского сектора и балансов домохозяйств. " + CB,
      "Просрочка юрлиц": "Просроченная задолженность юрлиц и ИП (платежи, не внесённые в срок). " + CB, "Просрочка физлиц": "Просроченная задолженность физлиц. " + CB,
      "Просрочка юрлиц, % портфеля": "Просроченная задолженность ÷ вся задолженность юрлиц и ИП, %.", "Просрочка физлиц, % портфеля": "То же по физлицам, %.", "Просрочка ипотеки, % портфеля": "То же по ипотеке, %.",
      "Рамки прогноза": "Прогноз ЦБ роста требований к экономике, организациям и населению за год (декабрь к декабрю)." },
    "Доля просроченной задолженности": {
      "Юрлица и ИП": "Просроченная задолженность по кредитам юрлицам и ИП ÷ вся их задолженность, %. " + CB,
      "Физлица": "То же по кредитам физлицам. " + CB, "Ипотека": "То же по ипотечным жилищным кредитам. " + CB },
    "Финансы населения: сбережения и долги": {
      "Депозиты": "Вклады и средства на счетах населения в банках. " + CB, "Наличные": "Наличные деньги у населения. " + CB,
      "Акции и паи фондов": "Акции, доли в компаниях и паи инвестфондов в собственности населения. " + CB,
      "Страх. и пенс. резервы": "Резервы по страхованию жизни и пенсионные накопления (НПФ). " + CB, "Облигации": "Облигации в собственности населения. " + CB,
      "Долг: кредиты банков": "Задолженность населения перед банками — пунктир поверх стопки, в сумму активов не входит. Активы − долг = чистые финансовые активы (в подсказке)." },
    "Ипотека": {
      "Выдача за месяц": "Объём выданных за месяц ипотечных жилищных кредитов. " + CB, "Выдача за год": "Объём выданных ипотечных кредитов за год. " + CB,
      "Выдача": "Рост выдачи к тому же периоду год назад.", "Задолженность": "Весь портфель ипотеки на конец месяца. " + CB,
      "Просроченная задолженность": "Просроченная задолженность по ипотеке (платежи не в срок), с 2019 г. Доля в портфеле — в подсказке. " + CB },
    "Выдача кредитов за месяц": { "_all": "Объём новых кредитов, выданных за месяц. " + CB },
    "Кредиты МСП — задолженность": { "МСП": "Задолженность по кредитам субъектам малого и среднего предпринимательства. " + CB },
    "Банковский сектор": {
      "Активы": "Активы банковского сектора за вычетом резервов. % г/г — без валютной переоценки; трлн ₽ — остатки (внутри года — оценка по месячным темпам). Обзор ЦБ",
      "Кредиты юрл": "Корпоративные кредиты (нефинансовым и финансовым организациям, ИП). Обзор ЦБ", "Кредиты физл": "Кредиты физлицам. Обзор ЦБ",
      "Капитал": "Собственные средства (капитал) банков по Базелю III (Положение 646-П). Обзор ЦБ",
      "Средства физлиц": "Вклады населения (без счетов эскроу). Обзор ЦБ", "Средства юрлиц": "Депозиты и средства на счетах компаний. Обзор ЦБ" },
    "Чистая прибыль публичных банков": { "_all": BANK_ALL },
    "Прибыль банка с начала года — по годам": { "_all": "Чистая прибыль банка, накопленная с начала этого года (РСБУ, форма 102 ЦБ). До 2024 г. — только на конец кварталов." },
    "Нормативы банков по месяцам": { "_all": "Значение норматива банка на конец месяца (форма 135 ЦБ публикуется на 1-е число следующего месяца).",
      "Н1.0": "Достаточность совокупного капитала: капитал ÷ активы, взвешенные по риску; минимум 8%.", "Н1.1": "Достаточность базового капитала; минимум 4,5%.", "Н1.2": "Достаточность основного капитала; минимум 6%.",
      "Н2": "Мгновенная ликвидность: высоколиквидные активы ÷ обязательства до востребования; минимум 15%.", "Н3": "Текущая ликвидность: ликвидные активы ÷ обязательства до 30 дней; минимум 50%.",
      "Н4": "Долгосрочная ликвидность: кредиты сроком свыше года ÷ (капитал + долгосрочные обязательства); максимум 120%." },
    "ВВП России": {
      "Реальный рост": "Рост ВВП в постоянных ценах к тому же кварталу год назад. " + RS, "реальный рост г/г": "Рост ВВП в постоянных ценах к тому же кварталу год назад. " + RS,
      "реальный рост за год": "Рост ВВП за год в постоянных ценах. " + RS, "Номинальный рост": "Рост ВВП в текущих ценах = реальный рост + рост цен (дефлятор). " + RS,
      "ВВП (трлн ₽)": "Номинальный ВВП за квартал, трлн ₽. " + RS, "ВВП за год (трлн ₽)": "Номинальный ВВП за год. " + RS,
      "Рамки прогноза": "Прогноз ЦБ роста ВВП за год." },
    "ВВП по использованию": {
      "Домохозяйства": "Расходы домашних хозяйств на конечное потребление. " + RS, "Потребление домохозяйств": "Реальный рост расходов домохозяйств на потребление. " + RS,
      "Госуправление": "Конечное потребление госуправления (зарплаты бюджетников, закупки товаров и услуг). " + RS, "Госпотребление": "Реальный рост госпотребления. " + RS,
      "Инвестиции": "Валовое накопление основного капитала — вложения в здания, оборудование, инфраструктуру. " + RS, "Инвестиции (осн. капитал)": "Реальный рост инвестиций в основной капитал. " + RS,
      "Запасы": "Изменение запасов материальных оборотных средств (в IV квартале часто отрицательное). " + RS, "Чистый экспорт": "Экспорт − импорт товаров и услуг. " + RS,
      "Статрасхождение": "ВВП минус сумма компонент использования — расхождение между оценками ВВП методом производства и методом использования (Росстат его не публикует отдельной строкой; считаем разностью).",
      "Экспорт": "Реальный рост экспорта (Росстат перестал публиковать в 2022).", "Импорт": "Реальный рост импорта (Росстат перестал публиковать в 2022).", "ВВП": "Реальный рост ВВП. " + RS },
    "Индекс выпуска базовых отраслей, г/г": { "Выпуск базовых отраслей": "Взвешенный индекс выпуска сельского хозяйства, добычи, обработки, энергетики, строительства, транспорта, розничной и оптовой торговли — месячный прокси ВВП (~2/3 экономики). " + RS },
    "Розничная торговля": { "Всего": "Оборот розничной торговли в текущих ценах. " + RS, "Продовольственные": "Оборот продовольственными товарами. " + RS, "Непродовольственные": "Оборот непродовольственными товарами. " + RS },
    "Зарплаты": { "Зарплата": "Среднемесячная начисленная зарплата до НДФЛ. " + RS, "Номинальный рост": "Рост номинальной зарплаты г/г. " + RS, "Реальный рост": "Рост с поправкой на инфляцию: (1 + номинал) ÷ (1 + ИПЦ) − 1." },
    "Безработица": { "Безработица": "Доля безработных в рабочей силе 15+ по методологии МОТ (обследование рабочей силы), скользящее среднее за 3 месяца — таблицы Росстата. " + RS,
      "За месяц": "Уровень безработицы за отдельный месяц — из ежемесячного доклада Росстата «Социально-экономическое положение России»; выходит раньше таблиц (на 1–2 месяца). " + RS },
    "Промышленное производство, г/г": {
      "Промышленность": "Индекс промышленного производства (физический объём) к тому же месяцу год назад. " + RS,
      "Добыча": "Добыча полезных ископаемых. " + RS, "Обработка": "Обрабатывающие производства. " + RS, "Электроэнергия, газ": "Обеспечение электроэнергией, газом и паром. " + RS, "Водоснабжение": "Водоснабжение, водоотведение, утилизация отходов. " + RS },
    "Федеральный бюджет — годовые итоги": {
      "Доходы": "Все доходы федерального бюджета. " + MF, "Расходы": "Все расходы федерального бюджета. " + MF, "Дефицит/профицит": "Доходы − расходы. " + MF,
      "Дефицит — план": "Дефицит по закону о федеральном бюджете.", "LTM": "Сумма за последние 12 месяцев по помесячным данным Минфина (последний месяц может быть предварительной оценкой)." },
    "Дефицит / профицит бюджета": {
      "За месяц": "Доходы − расходы федерального бюджета за месяц. " + MF, "Сумма за 12 мес": "Скользящая сумма за 12 календарных месяцев. " + MF,
      "Дефицит(−)/профицит(+) за год": "Итог за год. " + MF, "Дефицит(−)/профицит(+) за 12 мес": "Скользящая сумма за 12 месяцев ÷ ВВП за 4 квартала. " + MF },
    "Чистое размещение ОФЗ": {
      "За месяц": "Сальдо внутреннего долга в источниках финансирования дефицита: привлечено − погашено (в основном ОФЗ, по выручке). Последние месяцы, которых нет в отчёте, — оценка. " + MF,
      "Сумма за 12 мес": "Скользящая сумма за 12 месяцев.", "Факт": "Чистое размещение за год; текущий год — с начала года.",
      "Чистое размещение за год": "Чистое размещение за год.", "План по закону о бюджете": "Чистые госзаимствования (внутренние + внешние) в источниках финансирования дефицита по закону о бюджете." },
    "Госдолг РФ (внутренний)": { "Ценные бумаги и кредиты (в осн. ОФЗ)": "Внутренний госдолг в ценных бумагах (ОФЗ по номиналу) и кредитах, на конец месяца. " + MF, "Госгарантии": "Обязательства по государственным гарантиям. " + MF },
    "Фонд национального благосостояния (ФНБ)": { "Объём ФНБ": "Средства ФНБ на конец месяца: ликвидная часть (юани и золото на счетах в ЦБ) + вложения в облигации, акции, депозиты ВЭБ. Последняя точка может быть из пресс-релиза Минфина. " + MF, "ФНБ, % ВВП": "Объём ФНБ ÷ ВВП, прогнозируемый на год. " + MF },
    "Структура доходов по годам": { "Нефтегазовые": "НДПИ на нефть и газ, НДД, экспортные пошлины, демпфер и пр. " + MF, "Ненефтегазовые": "НДС, налог на прибыль, акцизы, дивиденды госкомпаний и пр. " + MF },
    "Курс рубля": { "_all": "Официальный курс ЦБ на конец месяца, ₽ за единицу; в «Годах» — средний за год." },
    "Внешняя торговля товарами": { "Экспорт": "Экспорт товаров за месяц по методологии платёжного баланса, млрд $. " + CB, "Импорт": "Импорт товаров за месяц, млрд $. " + CB, "Сальдо": "Экспорт − импорт. " + CB },
    "Платёжный баланс — счёт текущих операций": { "Сальдо тек. операций": "Торговля товарами и услугами + первичные (проценты, дивиденды) и вторичные доходы за квартал. Больше 0 — валюты в страну приходит больше, чем уходит. Последний квартал может быть оценкой ЦБ. " + CB },
    "Международные резервы РФ": { "Резервы": "Международные резервные активы (включая замороженные), млрд $. " + CB, "Валютные резервы": "Валюта, депозиты, ценные бумаги, СДР и позиция в МВФ. " + CB, "Монетарное золото": "Золото в резервах по рыночной цене. " + CB },
    "Внешний долг РФ": { "Госуправление": "Внешний долг федеральных органов и регионов: еврооблигации, ОФЗ у нерезидентов, кредиты. " + CB, "ЦБ и банки": "Внешние обязательства ЦБ и банков. " + CB, "Прочие секторы": "Компании: кредиты, облигации, долг перед прямыми инвесторами. Последняя дата может быть оценкой ЦБ. " + CB },
  };
  METH["Ключевая ставка, инфляция и базовая инфляция (сводка)"] = METH["Ключевая ставка, инфляция и базовая инфляция"];
  METH["Кривая ОФЗ (КБД) сегодня"] = METH["Кривая ОФЗ (КБД)"] = {};
  const escH = x => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const methRows = (title, node, extra) => {
    const M = METH[title] || {}, names = [];
    const inst = node && echarts.getInstanceByDom(node);
    if (inst) (inst.getOption().series || []).forEach(sr => { if (sr.name && sr.type !== "custom" && sr.type !== "heatmap" && !/^(прогноз|Траектория)/.test(sr.name) && !names.includes(sr.name)) names.push(sr.name); });
    let rows = names.map(n => [n, M[n] || METH_G[n] || M._all || ""]).filter(r => r[1]);
    // одинаковое описание у 3+ рядов (банки, сроки, годы) — одной строкой
    const cnt = {}; rows.forEach(r => { cnt[r[1]] = (cnt[r[1]] || 0) + 1; });
    const seen = new Set();
    rows = rows.flatMap(r => { if (cnt[r[1]] < 3) return [r]; if (seen.has(r[1])) return []; seen.add(r[1]); const ns = rows.filter(x => x[1] === r[1]).map(x => x[0]); return [[ns.length > 4 ? `${ns.slice(0, 3).join(", ")} и ещё ${ns.length - 3}` : ns.join(", "), r[1]]]; });
    Object.entries(M).filter(([k]) => k !== "_all" && !names.includes(k) && (/^(Рамки|LTM|Вес |г\/г|м\/м|SAAR|По неделям|Н\d)/.test(k))).forEach(([k, v]) => rows.push([k, v]));
    const merged = [...rows, ...(extra || [])], used = new Set();
    return merged.filter(([name, text]) => text && !used.has(name) && used.add(name));
  };
  const POP = window.__mcPop || (window.__mcPop = (() => {   // одна табличка на страницу (renderMacro вызывается при каждой перерисовке)
    let box = null, pinned = false, timer = null;
    const hide = () => { if (box && !pinned) box.hidden = true; };
    const show = (btn, html) => {
      if (!box) { box = document.createElement("div"); box.className = "mc-pop"; box.hidden = true;
        box.style.cssText = "position:fixed;z-index:10000;width:min(600px,calc(100vw - 24px));max-height:70vh;overflow:auto;background:var(--panel,#fff);color:var(--text,#223);border:1px solid var(--line,#dde);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:12px 14px;font-size:12px;line-height:1.45";
        box.onmouseenter = () => clearTimeout(timer); box.onmouseleave = () => { timer = setTimeout(hide, 150); };
        document.body.appendChild(box);
        document.addEventListener("click", e => { if (pinned && !box.contains(e.target) && !e.target.closest(".mc-info")) { pinned = false; hide(); } }); }
      box.innerHTML = html; box.hidden = false;
      const r = btn.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
      box.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + "px";
      box.style.top = (r.bottom + 8 + h < innerHeight ? r.bottom + 8 : Math.max(12, r.top - h - 8)) + "px";
    };
    return { show, hide, pin: v => { pinned = v; }, isPinned: () => pinned, later: () => { clearTimeout(timer); timer = setTimeout(hide, 150); }, stop: () => clearTimeout(timer), reset: () => { pinned = false; hide(); } };
  })());
  POP.reset();   // при перерисовке вкладки закреплённая табличка закрывается
  const methHtml = (title, sub, rows) => `<div style="font-weight:600;margin-bottom:4px">${escH(title)}</div>` + (sub ? `<div class="muted" style="margin-bottom:${rows.length ? 8 : 0}px">${sub}</div>` : "")
    + (rows.length ? `<table style="border-collapse:collapse;width:100%;table-layout:fixed"><colgroup><col style="width:32%"><col></colgroup>${rows.map(([n, d0]) => `<tr><td style="padding:5px 10px 5px 0;vertical-align:top;font-weight:600;white-space:normal;text-align:left;overflow-wrap:anywhere;border-top:1px solid var(--line,#eee)">${escH(n)}</td><td style="padding:5px 0;vertical-align:top;white-space:normal;text-align:left;border-top:1px solid var(--line,#eee)">${escH(d0)}</td></tr>`).join("")}</table>` : "");
  const infoBtn = sub => ` <span class="mc-info" title="" style="cursor:help;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;border:1px solid var(--muted,#8aa);color:var(--muted,#8aa);font:600 10px/1 sans-serif;vertical-align:2px;margin-left:4px;user-select:none">i</span>`;
  const infoBox = () => "";
  const wireInfo = (p, title, sub, getNode, extra) => {
    const b = p.querySelector(".mc-info"); if (!b) return;
    const open = () => { POP.stop(); POP.show(b, methHtml(title, sub, methRows(title, getNode ? getNode() : p.querySelector(".chart"), typeof extra === "function" ? extra() : extra))); };
    b.onmouseenter = open; b.onmouseleave = () => { if (!POP.isPinned()) POP.later(); };
    b.onclick = e => { e.stopPropagation(); const was = POP.isPinned(); POP.pin(!was); if (!was) open(); else POP.hide(); };
  };
  const mkey = m => Array.isArray(m) ? m[0] : m, mlabel = m => Array.isArray(m) ? m[1] : (MODE_LBL[m] || m);
  const controlRows = c => {
    const M = METH[c.title] || {}, out = [];
    const add = (name, text) => { if (name && text) out.push([name, text]); };
    (c.modes || []).forEach(m => {
      const key = mkey(m), label = mlabel(m);
      add(label, M[label] || M[key] || MODE_HELP[key] || `Показывает график в режиме «${label}».`);
    });
    (c.alt || []).forEach(m => {
      const key = mkey(m), label = mlabel(m);
      add(label, M[label] || M[key] || MODE_HELP[key] || `Вариант отображения «${label}».`);
    });
    if (c.agg) {
      const base = c.base || "Мес.";
      add(base, base === "Кв." ? "Исходная квартальная частота без годового укрупнения." : "Исходная частота ряда: месяцы или другие периоды из источника.");
      add("Годы", MODE_HELP.year);
    }
    if (c.num) add(`${c.num.label}${c.num.unit ? `, ${c.num.unit}` : ""}`, c.num.title || "Порог отбора данных на графике.");
    if (c.tog) add(c.tog[1], c.tog[2] || "Показать или скрыть дополнительный ряд.");
    return out;
  };
  const drawPanel = (host, c) => {
    if (c.custom) return c.custom(host);
    const id = `mc-${++cid}`, keys = (c.modes || []).map(mkey), akeys = (c.alt || []).map(mkey);
    let mode = keys[0] || "abs", freq = "base", alt = akeys[0] || null, num = c.num ? c.num.def : null, tog = false;
    try { const sv = localStorage.getItem("bonds_mm_" + c.title); if (keys.includes(sv)) mode = sv; if (c.agg && localStorage.getItem("bonds_fq_" + c.title) === "year") freq = "year";
      const sa = localStorage.getItem("bonds_ma_" + c.title); if (akeys.includes(sa)) alt = sa;
      const sn = localStorage.getItem("bonds_mn_" + c.title); if (c.num && sn != null && sn !== "" && isFinite(+sn)) num = +sn;
      if (c.tog) tog = localStorage.getItem("bonds_mt_" + c.title) === "1"; } catch (e) { }
    const aggOf = m => typeof c.agg === "function" ? c.agg(m) : c.agg;
    const chipRow = (list, cur, attr) => `<div class="chips" style="margin:0">${list.map(m => `<span class="chip ${mkey(m) === cur ? "on" : ""}" data-${attr}="${mkey(m)}" style="font-size:11px;padding:3px 9px">${mlabel(m)}</span>`).join("")}</div>`;
    const p = el(`<div class="panel" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
      <h3 style="margin:0;flex:1 1 320px">${c.title}${infoBtn(c.sub)}</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;flex:0 1 auto;max-width:100%;min-width:0;align-items:center">
      ${c.num ? `<label class="muted" style="font-size:11px;display:inline-flex;align-items:center;gap:5px" title="${c.num.title || ""}">${c.num.label}<input type="number" data-n min="${c.num.min ?? 0}" step="${c.num.step ?? 0.5}" value="${num}" style="width:58px;padding:3px 6px;font-size:11px;border:1px solid var(--line,#ccd);border-radius:12px;background:transparent;color:inherit">${c.num.unit || ""}</label>` : ""}
      ${c.tog ? `<div class="chips" style="margin:0"><span class="chip ${tog ? "on" : ""}" data-t="1" title="${c.tog[2] || "Показать / скрыть"}" style="font-size:11px;padding:3px 9px">${tog ? "✓ " : "+ "}${c.tog[1]}</span></div>` : ""}
      ${c.agg ? `<div class="chips" style="margin:0" title="Частота: как в источнике или по годам">${[["base", c.base], ["year", "Годы"]].map(([k, t]) => `<span class="chip ${k === freq ? "on" : ""}" data-f="${k}" style="font-size:11px;padding:3px 9px">${t}</span>`).join("")}</div>` : ""}
      ${akeys.length > 1 ? `<span data-arow style="display:${!c.altFor || c.altFor(mode) ? "contents" : "none"}">${chipRow(c.alt, alt, "a")}</span>` : ""}
      ${keys.length > 1 ? chipRow(c.modes, mode, "m") : ""}</div></div>${infoBox(c.sub)}
      <div class="chart" id="${id}" style="height:${c.h}px;margin-top:8px"></div></div>`);
    host.appendChild(p); wireInfo(p, c.title, c.sub, null, () => controlRows(c));
    const node = p.querySelector("#" + id);
    const draw = () => {
      const i = echarts.getInstanceByDom(node); if (i) i.dispose();
      node.innerHTML = "";
      FREQ = c.agg ? freq : "base"; AGG = (c.agg && aggOf(mode)) || "last";
      try { c.build(node, mode, alt, num, tog); } catch (e) { console.warn("macro chart", c.title, e); node.innerHTML = `<div class="muted" style="padding:20px">Нет данных для этого режима</div>`; }
      finally { FREQ = "base"; AGG = "last"; }
      postDZ(node);
    };
    p.querySelectorAll("[data-a]").forEach(b => b.onclick = () => {
      alt = b.dataset.a; try { localStorage.setItem("bonds_ma_" + c.title, alt); } catch (e) { }
      p.querySelectorAll("[data-a]").forEach(x => x.classList.toggle("on", x.dataset.a === alt)); draw();
    });
    const tb = p.querySelector("[data-t]");
    if (tb) tb.onclick = () => { tog = !tog; try { localStorage.setItem("bonds_mt_" + c.title, tog ? "1" : "0"); } catch (e) { } tb.classList.toggle("on", tog); tb.textContent = (tog ? "✓ " : "+ ") + c.tog[1]; draw(); };
    const ni = p.querySelector("[data-n]");
    if (ni) ni.oninput = () => { const v2 = parseFloat(String(ni.value).replace(",", ".")); num = isFinite(v2) ? v2 : 0; try { localStorage.setItem("bonds_mn_" + c.title, num); } catch (e) { } draw(); };
    p.querySelectorAll("[data-m]").forEach(b => b.onclick = () => {
      mode = b.dataset.m; try { localStorage.setItem("bonds_mm_" + c.title, mode); } catch (e) { }
      p.querySelectorAll("[data-m]").forEach(x => x.classList.toggle("on", x.dataset.m === mode));
      const ar = p.querySelector("[data-arow]"); if (ar && c.altFor) ar.style.display = c.altFor(mode) ? "contents" : "none";
      draw();
    });
    p.querySelectorAll("[data-f]").forEach(b => b.onclick = () => {
      freq = b.dataset.f; try { localStorage.setItem("bonds_fq_" + c.title, freq); } catch (e) { }
      p.querySelectorAll("[data-f]").forEach(x => x.classList.toggle("on", x.dataset.f === freq)); draw();
    });
    draw();
  };

  // ── тулбар: обновлено + экспорт CSV ──
  const asof = d.asof ? d.asof.slice(0, 16).replace("T", " ") : "";
  const bar = el(`<div style="display:flex;justify-content:flex-end;align-items:center;gap:12px;margin:2px 0 -6px">
    ${asof ? `<span class="muted" style="font-size:11px">обновлено ${asof}</span>` : ""}
    <button class="btn ghost" id="mc-csv" style="padding:5px 11px;font-size:12px" title="Скачать все ряды в CSV">⬇ Экспорт CSV</button></div>`);
  v.appendChild(bar);
  bar.querySelector("#mc-csv").onclick = () => macroExportCSV(d);

  // ── под-навигация разделов (активный раздел запоминается; старые ключи → «Сводка») ──
  if (!MACRO.sub || !MACRO_SUBS.some(([k]) => k === MACRO.sub)) {
    let s0 = null; try { s0 = localStorage.getItem("bonds_macro_sub"); } catch (e) { }
    MACRO.sub = MACRO_SUBS.some(([k]) => k === s0) ? s0 : "summary";
  }
  const sub = MACRO.sub;
  const goSub = k => { MACRO.sub = k; try { localStorage.setItem("bonds_macro_sub", k); } catch (e) { } render(); };
  const nav = el(`<div class="chips" style="margin:16px 0 18px">` + MACRO_SUBS.map(([k, t]) => `<span class="chip ${k === sub ? "on" : ""}" data-sub="${k}">${t}</span>`).join("") + `</div>`);
  v.appendChild(nav);
  nav.querySelectorAll("[data-sub]").forEach(c => c.onclick = () => goSub(c.dataset.sub));

  // В бюджетном разделе рядом с агрегатами показываем фактический календарь
  // погашений по выпускам. Загружаем его лениво, чтобы не замедлять «Сводку».
  if (sub === "budget" && MACRO.ofzRedemption === undefined) {
    MACRO.ofzRedemption = null;
    fetch(`${API}/api/ofz_redemption`).then(r => r.ok ? r.json() : null).then(x => {
      MACRO.ofzRedemption = x || {};
      render();
    }).catch(() => { MACRO.ofzRedemption = {}; render(); });
  }

  // ═══════════════ СВОДКА: карточки с мини-графиками (клик — в раздел) ═══════════════
  if (sub === "summary") {
    const spark = (s, color = "#5b8def", n = 36) => {
      const a = (s || []).filter(x => x && x.val != null).slice(-n); if (a.length < 3) return "";
      const vs = a.map(x => x.val), lo = Math.min(...vs), hi = Math.max(...vs), W = 120, H = 30;
      const pts = vs.map((v2, i) => `${(i / (vs.length - 1) * W).toFixed(1)},${(H - 2 - (hi === lo ? (H - 4) / 2 : (v2 - lo) / (hi - lo) * (H - 4))).toFixed(1)}`).join(" ");
      return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:30px;margin-top:6px;display:block" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
    };
    const card = (label, big, subl, extra, sp, go) => `<div class="panel" data-goto="${go}" style="margin:0;cursor:pointer" title="Открыть раздел">
      <div class="muted" style="font-size:12px">${label}</div>
      <div style="display:flex;align-items:baseline;flex-wrap:wrap;margin-top:4px"><span style="font-family:var(--mono,'IBM Plex Mono',monospace);font-size:22px;font-weight:600;line-height:1.1">${big}</span>${extra || ""}</div>
      <div class="muted" style="font-size:11px;margin-top:3px">${subl}</div>${sp || ""}</div>`;
    const P = (x, dg = 2) => x == null ? "—" : fmt(x, dg) + "%";
    const coreL = lastOf(coreS), saar3 = lastOf(r3(ciSA["Базовый ИПЦ"])), ieL = lastOf(ie.expected), ruL = lastOf(d.ruonia);
    const liqL = lastOf(d.liquidity), ceL = lastOf(ce.credit), defL = lastOf(roll12(bud.balance)), rsvL = lastOf(rsv.total);
    const gL = lastOf(gdpq.growth), unL = lastOf(un.rolling3m), imL = lastOf(imoexS);
    const ofz10 = gcurve?.tenors?.find(t => Math.abs(t.period_years - 10) < 0.01);
    const cards = [
      card("Ключевая ставка", P(L.rate), "ЦБ РФ · " + (mmy(L.rate_date) || ""), badge(momDelta(rateS)), spark(rateS, "#5b8def"), "infl"),
      card("Инфляция ИПЦ, г/г", P(L.cpi), "цель 4% · " + (mmy(L.cpi_date || L.rate_date) || ""), badge(momDelta(cpiS), "п.п.", true), spark(cpiS, "#f5b13c"), "infl"),
      coreL && card("Базовая инфляция, г/г", P(coreL.val), "без волатильных цен · " + mmy(coreL.date), badge(momDelta(coreS), "п.п.", true), spark(coreS, "#5b8def"), "infl"),
      saar3 && card("Текущая инфляция (SAAR 3 мес)", P(saar3.val, 1), "базовый ИПЦ, в годовом выражении · " + mmy(saar3.date), "", spark(r3(ciSA["Базовый ИПЦ"]), "#1f4fb8"), "infl"),
      ieL && card("Инфляционные ожидания", P(ieL.val, 1), "население, на год вперёд · " + mmy(ieL.date), badge(momDelta(ie.expected), "п.п.", true), spark(ie.expected, "#f5913c"), "infl"),
      ofz10 && card("ОФЗ 10 лет (КБД)", P(ofz10.yield_pct), "безрисковая доходность · " + dmy(gcurve.tradedate), "", "", "markets"),
      ruL && card("RUONIA", P(ruL.val), "межбанк овернайт · " + mmy(ruL.date), badge(momDelta(d.ruonia)), spark(d.ruonia, "#8bd450"), "rates"),
      liqL && card("Ликвидность банков", (liqL.val >= 0 ? "дефицит " : "профицит ") + fmt(Math.abs(liqL.val) / 1000, 1) + " трлн", "среднее за месяц · " + mmy(liqL.date), "", spark(d.liquidity, "#f5913c"), "rates"),
      ceL && card("Кредит экономике, г/г", P(ceL.val, 1), "ЦБ · " + mmy(ceL.date), badge(momDelta(ce.credit)), spark(ce.credit, "#1fe0a0"), "credit"),
      defL && card("Бюджет за 12 мес", (defL.val < 0 ? "дефицит " : "профицит ") + fmt(Math.abs(defL.val) / 1000, 1) + " трлн", "федеральный · " + mmy(defL.date) + (gdpAt(defL.date) ? " · " + fmt(defL.val / gdpAt(defL.date) * 100, 1) + "% ВВП" : ""), "", spark(roll12(bud.balance), "#ff6b6b"), "budget"),
      gL && card("ВВП, реальный рост", P(gL.val, 1), "г/г · " + qlab(gL.date), "", spark(gdpq.growth, "#5b8def", 20), "economy"),
      unL && card("Безработица", P(unL.val, 1), "ср. за 3 мес · " + mmy(unL.date), "", spark(un.rolling3m, "#ff6b6b"), "economy"),
      card("Доллар США", L.usd_today != null ? fmt(L.usd_today, 2) + " ₽" : (L.usd != null ? fmt(L.usd, 2) + " ₽" : "—"),
        L.usd_today != null ? `официальный курс ЦБ · ${dmy(L.usd_today_date)}` : "ЦБ РФ · на конец " + (mmy(L.usd_date) || ""),
        L.usd_today != null && L.usd != null ? badge(L.usd_today - L.usd, "₽", true) : badge(momDelta(fxd.usd), "₽", true), spark(fxd.usd, "#5b8def"), "external"),
      rsvL && card("Международные резервы", fmt(rsvL.val, 0) + " млрд $", "ЦБ РФ · " + mmy(rsvL.date), "", spark(rsv.total, "#f5c542"), "external"),
    ].filter(Boolean);
    const grid = el(`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:18px">${cards.join("")}</div>`);
    v.appendChild(grid);
    grid.querySelectorAll("[data-goto]").forEach(c => c.onclick = () => goSub(c.dataset.goto));
  }

  // ═══════════════ ОБЩИЕ ПОСТРОИТЕЛИ (используются в нескольких разделах) ═══════════════
  const bRateInfl = node => {
    lineChart(node, [["rate", "Ключевая ставка", "#5b8def", { agg: "mean" }], ["cpi", "ИПЦ, г/г", "#f5b13c", { agg: "last" }], ["core", "Базовая, г/г", "#c792ea", { agg: "last" }]],
      { rate: rateS, cpi: cpiS, core: coreS.filter(x => x.date >= "2013") }, { unit: "%", dg: 2, ext: futureTo(FC_END) });
    const i = echarts.getInstanceByDom(node); if (i && FREQ !== "year") i.setOption({ series: [{ step: "end", lineStyle: { width: 2.6 } }] });
    tgt(node);
    // средняя ключевая за год — рамка на весь год; инфляция «дек/дек» — рамка в IV квартале
    fcBoxes(node, [...krSpans(), ...fcSpans("infl_dec", "#f5b13c").map(b => ({ ...b, gran: "dec" }))]);
  };
  const bGcurve = node => mkChart(node, {
    ...CHART_BG, tooltip: { trigger: "item", formatter: p => `срок ${fmt(p.value[0], 2)} г · <b>${pct(p.value[1])}</b>` },
    grid: { left: 46, right: 18, top: 20, bottom: 44 },
    xAxis: { type: "value", name: "срок, лет", nameLocation: "middle", nameGap: 28, min: 0, ...AX }, yAxis: { type: "value", name: "доходность, %", scale: true, ...AX },
    series: [{ name: "КБД", type: "line", smooth: true, symbol: "none", data: gcurve.tenors.map(t => [t.period_years, t.yield_pct]), lineStyle: { width: 2.5, color: "#5b8def" }, itemStyle: { color: "#5b8def" }, areaStyle: { color: "rgba(91,141,239,.06)" }, z: 2 }],
  });

  // ═══════════════ СВОДКА (графики) ═══════════════
  if (ri.length) C("summary", "Ключевая ставка, инфляция и базовая инфляция", "% · ставка — ступенькой · линия-пунктир — цель 4%" + (FC.asof ? ` · рамки — прогноз ЦБ от ${FC.asof}: синие — средняя ключевая (в текущем году — за оставшиеся месяцы, в «Годах» — за год), оранжевые — инфляция дек/дек` : ""), 330, bRateInfl, { agg: "last" });
  if (gcurve?.tenors?.length) C("summary", "Кривая ОФЗ (КБД) сегодня", `безрисковая доходность по срокам · ${dmy(gcurve.tradedate)} · MOEX`, 280, bGcurve);

  // ═══════════════ ИНФЛЯЦИЯ И ДКП ═══════════════
  if (ri.length) C("infl", "Ключевая ставка, инфляция и базовая инфляция", "% · ставка — ступенькой · линия-пунктир — цель 4%" + (FC.asof ? ` · рамки — прогноз ЦБ от ${FC.asof}: синие — средняя ключевая (в текущем году — за оставшиеся месяцы, в «Годах» — за год), оранжевые — инфляция дек/дек` : ""), 330, bRateInfl, { agg: "last" });
  if (coreS.length) C("infl", "Базовая и устойчивая инфляция, г/г", `% · до ${mmy(ci.core_long_from) || "2020"} базовая — расчёт по сезонно сглаженным данным ЦБ, далее — официальная · ЦБ «Инфляция в России»`, 330, node => {
    lineChart(node, [["cpi", "ИПЦ", "#f5b13c"], ["core", "Базовая", "#5b8def"], ["core_ex_tour", "Базовая без туризма", "#4fc3f7"], ["median_w", "Медиана (с весами)", "#c792ea"], ["median_u", "Медиана (без весов)", "#ba68c8"], ["ex20", "Без 20% волатильных", "#8bd450"], ["trend", "Трендовая (окно 5 лет)", "#ff6b6b"]],
      { cpi: cpiS, core: coreS, core_ex_tour: ciY.core_ex_tour, median_w: ciY.median_w, median_u: ciY.median_u, ex20: ciY.ex20, trend: (ci.trend || {}).t5 }, { unit: "%", dg: 2 });
    tgt(node);
  }, { agg: "last" });
  if ((ciSA["Базовый ИПЦ"] || []).length) C("infl", "Текущие темпы инфляции (SAAR)", "месячный прирост с учётом сезонности в годовом выражении, % · на это смотрит ЦБ при решении по ставке", 330, node => {
    lineChart(node, [["cpi", "ИПЦ", "#f5b13c"], ["core", "Базовый ИПЦ", "#5b8def"], ["core3", "Базовый ИПЦ, ср. 3 мес", "#1f4fb8"], ["trunc", "Модиф. базовая (усечение)", "#1fe0a0"], ["excl", "Модиф. базовая (искл. волатильных)", "#8bd450"], ["med", "Медиана (с весами)", "#c792ea"]],
      { cpi: ciSA["Все товары и услуги"], core: ciSA["Базовый ИПЦ"], core3: r3(ciSA["Базовый ИПЦ"]), trunc: (ci.modcore || {}).trunc, excl: (ci.modcore || {}).excl, med: ciS.median_w }, { unit: "%", dg: 1 });
    tgt(node);
  }, { agg: "mean" });
  if ((ie.expected || []).length || (biz.price_exp || []).length) C("infl", "Инфляционные ожидания", "население — медиана ожидаемой инфляции на год, % (слева) · предприятия — ценовые ожидания на 3 мес, баланс ответов (справа) · инФОМ / мониторинг ЦБ", 320, node => {
    const E = { e: AY(ie.expected, "mean"), o: AY(ie.observed, "mean"), c: AY(cpiS, "last"), b: AY(biz.price_exp, "mean") };
    const { dates, col } = merge([E.e, E.o, E.c, E.b]);
    const defs = [["Население: ожидаемая", E.e, "#f5913c", 0], ["Население: наблюдаемая", E.o, "#ff6b6b", 0], ["ИПЦ факт, г/г", E.c, "#5b8def", 0], ["Предприятия: ценовые ожидания", E.b, "#1fe0a0", 1]];
    mkChart(node, {
      ...CHART_BG,
      tooltip: { trigger: "axis", axisPointer: XP, formatter: ps => `${ps[0].axisValue}<br>` + ps.filter(p => p.data != null).map(p => `${p.marker}${p.seriesName}: <b>${fmt(p.data, 1)}${p.seriesName.startsWith("Предприятия") ? " п." : "%"}</b>`).join("<br>") },
      legend: legOf(defs.map(x => x[0])), grid: { left: 44, right: 46, top: 34, bottom: 40 }, xAxis: catX(dates.map(mmy)),
      yAxis: [{ type: "value", name: "%", scale: true, ...AX }, { type: "value", name: "баланс", position: "right", scale: true, ...AX, splitLine: { show: false } }],
      series: defs.map(([name, s, color, ax]) => ({ name, type: "line", yAxisIndex: ax, data: col(s), symbol: "none", connectNulls: true, lineStyle: { width: ax ? 1.6 : 2.2, color, type: ax ? "dashed" : "solid" }, itemStyle: { color }, z: 2 })),
    });
  }, { agg: "mean" });
  if ((d.weekly_cpi || []).length) C("infl", "Недельная инфляция", "% за неделю · по дате публикации Росстата (среда; цены сняты в понедельник) · средний рост цен товаров недельного набора Росстата, взвешенный по весам ИПЦ (~37% корзины) · пунктир — цель ЦБ 4% г/г в пересчёте на неделю", 280, node => {
    const s = d.weekly_cpi, xs = s.map(r => wkPub(r.date, true));
    mkChart(node, {
      ...CHART_BG, tooltip: { trigger: "axis", formatter: ps => `${wkTip(s[ps[0].dataIndex].date)}<br>за неделю: <b>${fmt(ps[0].data.value ?? ps[0].data, 3)}%</b>` },
      grid: { left: 44, right: 16, top: 16, bottom: 40 },
      xAxis: { type: "category", data: xs, ...AX, axisLabel: { color: AXIS_TXT, interval: Math.ceil(xs.length / 10) } },
      yAxis: { type: "value", name: "% / нед", scale: true, ...AX },
      // цель ЦБ 4% г/г в недельном выражении: (1,04)^(1/52) − 1 ≈ 0,075% за неделю
      series: [{ name: "Недельная инфляция", type: "bar", data: s.map(r => ({ value: r.val, itemStyle: { color: r.val >= 0 ? "#f5913c" : "#1fe0a0" } })), z: 2,
        markLine: { ...zeroLine, data: [...(zeroLine.data || []), { yAxis: +((Math.pow(1.04, 1 / 52) - 1) * 100).toFixed(4),
          lineStyle: { type: "dashed", color: "#5b8def", width: 1.5, opacity: .9 },
          label: { show: true, position: "insideEndTop", color: "#5b8def", fontSize: 10, formatter: "цель 4% г/г ≈ 0,075% в неделю" } }] } }],
    });
  });
  const cc = d.cpi_comp || {};
  if ((cc.total?.yoy || []).length) C("infl", "Инфляция по компонентам, г/г", "% · все компоненты (Росстат) или без волатильных позиций (ЦБ)", 300, (node, mode) => mode === "stable"
    ? lineChart(node, [["food_ex", "Продовольствие без плодоовощей", "#1fe0a0"], ["nonfood_ex", "Непрод без нефтепродуктов", "#5b8def"], ["services_ex", "Услуги без ЖКУ", "#ff6b6b"], ["fruitveg", "Плодоовощная продукция", "#f5913c"]], ciY, { unit: "%", dg: 1, zero: true })
    : lineChart(node, [["total", "ИПЦ всего", "#f5b13c"], ["food", "Продовольственные", "#1fe0a0"], ["nonfood", "Непродовольственные", "#5b8def"], ["services", "Услуги", "#ff6b6b"]], Object.fromEntries(["total", "food", "nonfood", "services"].map(k => [k, cc[k]?.yoy])), { unit: "%", dg: 2 }),
    { main: false, agg: "last", modes: [["all", "Все"], ["stable", "Устойчивые"]] });
  const saRows = Object.keys(ciSA).filter(k => !/^(Все товары|ИПЦ без|Базовый ИПЦ без)/.test(k));
  const wkI = (d.weekly_items || {}).items || [];
  // из SAAR (сезонно сглаженный м/м в годовом выражении, ЦБ): м/м = (1+SAAR)^(1/12)−1; г/г — цепочка 12 месяцев
  const saMom = sr => (sr || []).map(r => ({ date: r.date, val: (Math.pow(1 + r.val / 100, 1 / 12) - 1) * 100 }));
  const saYoy = sr => { const m = saMom(sr); return m.map((r, i) => { if (i < 11) return null; let pr = 1; for (let k = i - 11; k <= i; k++) pr *= 1 + m[k].val / 100; return { date: r.date, val: (pr - 1) * 100 }; }).filter(Boolean); };
  // веса в ИПЦ (структура расходов Росстата на текущий год) — в подписи строки и для фильтра «вес ≥ X%»
  const CW = (d.cpi_weights || {}).w || {}, CWY = (d.cpi_weights || {}).year || "";
  const wLbl = (nm, w) => w != null ? `${nm} · ${fmt(w, w < 1 ? 2 : 1)}%` : nm;
  if (saRows.length) C("infl", "Рост цен по компонентам — тепловая карта", "г/г — к тому же месяцу год назад (цепочка 12 сезонно сглаженных м/м) · м/м — за месяц, с учётом сезонности · SAAR — месячный прирост в годовом выражении · «Товары · неделя / месяц / год» — 40 самых весомых товаров из недельного мониторинга Росстата: % за неделю (подпись — дата публикации, среда), за календарный месяц и за год из недельных приростов · красный — быстрее цели 4% в год, зелёный — медленнее · после названия — вес в ИПЦ" + (CWY ? ` на ${CWY} г.` : "") + " (структура потребительских расходов, Росстат) · «вес ≥» — показать только компоненты с весом не меньше X%", 60 + saRows.length * 19, (node, mode, per, minW) => {
    const mw = +minW || 0, keep = w => mw <= 0 || (w != null && w >= mw);
    const WKM = { wk: "w", wkm: "m", wky: "y" };           // недельные данные Росстата по товарам
    if (WKM[mode]) {
      per = WKM[mode];
      const it = wkI.filter(x => keep(x.weight));
      if (!it.length) { node.style.height = "80px"; node.innerHTML = `<div class="muted" style="padding:20px">Нет товаров с весом ≥ ${fmt(mw, 1)}% — уменьшите порог</div>`; return; }
      // недельные приросты → за месяц / за год: произведение (1 + x) по неделям периода (неделя
      // относится к месяцу даты замера); текущий месяц/год — неполные (с начала периода)
      const lastWk = it.flatMap(x => (x.series || []).map(r => r.date)).sort().pop() || "";   // последняя неделя (пн)
      const lastW = lastWk ? ddmm(wkShift(lastWk, 0), true) : "";
      if (per === "m") return heatRows(node, it.map(x => [wLbl(x.name, x.weight), x.monthly || []]), { n: 12, invert: true, center: 4 / 12, cap: 3, dg: 2, lblDg: 1, autoH: true,
        note: `% за календарный месяц — недельные приросты месяца, сложенные по сложному проценту (без сезонной очистки, это не «м/м SA») · неделя относится к месяцу даты замера цен · ${mmy(lastWk)} — неполный, по ${lastW}`,
        xFn: m => m === lastWk.slice(0, 7) ? `${mmy(m)}\n(по ${lastW.slice(0, 5)})` : mmy(m),
        tipX: m => m === lastWk.slice(0, 7) ? `за ${mmy(m)}, неполный месяц: с 1-го по ${lastW}` : `за ${mmy(m)} (сумма недель по сложному проценту)` });
      if (per === "y") return heatRows(node, it.map(x => [wLbl(x.name, x.weight), x.yearly || []]), { n: 10, invert: true, center: 4, cap: 25, dg: 1, lblDg: 1, autoH: true,
        note: `% за календарный год — недельные приросты с 1 января по 31 декабря, сложенные по сложному проценту · ${lastWk.slice(0, 4)} — с начала года по ${lastW} · не г/г (г/г — к тому же месяцу прошлого года)`,
        xFn: y => y === lastWk.slice(0, 4) ? `${y}\n(по ${lastW.slice(0, 5)})` : y,
        tipX: y => y === lastWk.slice(0, 4) ? `с 1 января ${y} по ${lastW}` : `за ${y} год (янв–дек)` });
      return heatRows(node, it.map(x => [wLbl(x.name, x.weight), x.series]), { n: 12, invert: true, center: 4 / 52, cap: 1.2, dg: 2, lblDg: 1, autoH: true, xFn: dt => wkPub(dt), tipX: wkTip,
        note: `% за неделю · подпись — дата публикации Росстата (среда), цены сняты в понедельник · последняя: опубликована ${lastWk ? wkPub(lastWk, true) : "—"}` });
    }
    const rows = saRows.filter(k => keep(CW[k]));
    if (!rows.length) { node.style.height = "80px"; node.innerHTML = `<div class="muted" style="padding:20px">Нет компонент с весом ≥ ${fmt(mw, 1)}% — уменьшите порог</div>`; return; }
    node.style.height = `${60 + rows.length * 19}px`;
    const lab = k => wLbl(k, CW[k]);
    if (mode === "mom") return heatRows(node, rows.map(k => [lab(k), saMom(ciSA[k])]), { n: 12, invert: true, center: 4 / 12, cap: 1.2, dg: 2, lblDg: 1,
      note: "м/м — % за месяц к предыдущему месяцу, сезонно сглажено (ЦБ) · цель 4% в год ≈ 0,33% в месяц" });
    if (mode === "saar") return heatRows(node, rows.map(k => [lab(k), ciSA[k]]), { n: 12, invert: true, center: 4, cap: 12,
      note: "SAAR — месячный сезонно сглаженный прирост в пересчёте на год, % (ЦБ) · сравнивать с целью 4%" });
    heatRows(node, rows.map(k => [lab(k), saYoy(ciSA[k])]), { n: 12, invert: true, center: 4, cap: 10, lblDg: 0,
      note: "г/г — % за 12 месяцев к тому же месяцу прошлого года (цепочка 12 сезонно сглаженных м/м, ЦБ) · цель 4%" });
  }, { main: false, modes: [["yoy", "г/г"], ["mom", "м/м"], ["saar", "SAAR"], ...(wkI.length ? [["wk", "Товары · неделя"], ["wkm", "Товары · месяц"], ["wky", "Товары · год"]] : [])],
    num: { label: "вес ≥", unit: "%", def: 0, step: 0.5, min: 0, title: "Показать только компоненты с весом в ИПЦ не меньше X% (0 — все)" },
  });
  if (ri.length) C("infl", "Реальные ставки", "номинал − ИПЦ г/г, п.п. · >0 — жёсткая ДКП и выгодные сбережения", 280, node =>
    lineChart(node, [["kr", "Ключевая − ИПЦ", "#5b8def"], ["dep", "Вклад до 1 года − ИПЦ", "#1fe0a0"], ["krc", "Ключевая − базовая", "#c792ea"]],
      { kr: opSeries(rateS, cpiS, (a, b) => a - b), dep: opSeries(depR.short, cpiS, (a, b) => a - b), krc: opSeries(rateS, coreS, (a, b) => a - b) }, { unit: "п.п.", dg: 1, zero: true }), { main: false, agg: "mean" });
  const ppi = d.ppi || {};
  if ((ppi.industry?.yoy || []).length) C("infl", "Цены производителей (PPI), г/г", "% к тому же месяцу год назад · опережают ИПЦ · Росстат", 280, node =>
    lineChart(node, [["industry", "Промышленность", "#f5b13c"], ["mining", "Добыча", "#ff6b6b"], ["manuf", "Обработка", "#5b8def"], ["energy", "Электроэнергия, газ", "#1fe0a0"]], Object.fromEntries(["industry", "mining", "manuf", "energy"].map(k => [k, ppi[k]?.yoy])), { unit: "%", dg: 1, zero: true }), { main: false, agg: "last" });

  // ═══════════════ СТАВКИ И ЛИКВИДНОСТЬ ═══════════════
  if ((d.ruonia || []).length) C("rates", "RUONIA и ключевая ставка", "% годовых · ставка овернайт на конец месяца · ЦБ РФ" + (FC.asof ? ` · рамки — прогноз ЦБ средней ключевой за год (${FC.asof})` : ""), 300, node => {
    lineChart(node, [["ru", "RUONIA", "#8bd450"], ["kr", "Ключевая ставка", "#5b8def"]], { ru: d.ruonia, kr: rateS }, { unit: "%", dg: 2, ext: futureTo(FC_END) });
    fcBoxes(node, krSpans());
  }, { agg: "mean" });
  if ((d.liquidity || []).length) C("rates", "Ликвидность банковского сектора", "среднее за месяц · трлн ₽ · >0 — структурный дефицит (банки должны ЦБ), <0 — профицит · ЦБ РФ", 290, node => {
    const s = AY(d.liquidity, "mean"), xs = s.map(r => mmy(r.date));
    mkChart(node, {
      ...CHART_BG, tooltip: { trigger: "axis", formatter: ps => `${ps[0].axisValue}<br>${ps[0].data.value >= 0 ? "дефицит" : "профицит"}: <b>${fmt(Math.abs(ps[0].data.value), 2)} трлн ₽</b>${FREQ === "year" ? " (среднее за год)" : ""}` },
      grid: { left: 48, right: 18, top: 16, bottom: 40 }, xAxis: catX(xs), yAxis: { type: "value", name: "трлн ₽", ...AX },
      series: [{ name: "Дефицит(+)/профицит(−)", type: "bar", data: s.map(r => ({ value: r.val / 1000, itemStyle: { color: r.val >= 0 ? "#f5913c" : "#1fe0a0" } })), markLine: zeroLine, z: 2 }],
    });
  }, { agg: "mean" });
  const TERMS = [["\"до востреб", "До востребования"], ["до 30 дней, кроме", "До 30 дней"], ["от 31 до 90", "31–90 дней"], ["от 91 до 180", "91–180 дней"], ["от 181 дня", "181 день–1 год"], ["от 1 года до 3", "1–3 года"], ["свыше 3 лет", "Свыше 3 лет"]];
  const TERMS_C = [["до 30 дней, включая", "До 30 дней"], ["от 31 до 90", "31–90 дней"], ["от 91 до 180", "91–180 дней"], ["от 181 дня", "181 день–1 год"], ["от 1 года до 3", "1–3 года"], ["свыше 3 лет", "Свыше 3 лет"]];
  const rOne = (g, s) => Object.entries(rt[g] || {}).find(([k]) => k.toLowerCase().startsWith(s))?.[1] || [];
  const RATE_G = [["dep_retail", "Вклады физлиц", TERMS], ["dep_corp", "Вклады юрлиц", TERMS_C], ["cred_corp", "Кредиты юрлицам", TERMS_C], ["cred_retail", "Кредиты физлицам", [["по всем срокам", "Все сроки"], ...TERMS_C]], ["cred_msp", "Кредиты МСП", TERMS_C], ["mortauto", "Ипотека и авто", null]]
    .filter(([k]) => k === "mortauto" ? (rOne("cred_auto", "по всем").length || rOne("cred_mortgage", "в рублях").length) : Object.keys(rt[k] || {}).length);
  if (RATE_G.length) C("rates", "Ставки по вкладам и кредитам — по срокам", "в рублях · % годовых · средневзвешенные по операциям · ЦБ РФ", 320, (node, mode) => {
    const g = RATE_G.find(x => x[0] === mode) || RATE_G[0];
    if (g[0] === "mortauto") return lineChart(node, [["auto", "Автокредиты", "#f5913c"], ["mort", "Ипотека", "#c792ea"]], { auto: rOne("cred_auto", "по всем"), mort: rOne("cred_mortgage", "в рублях") }, { unit: "%" });
    termChart(node, rt[g[0]], g[2]);
  }, { agg: "mean", modes: RATE_G.map(([k, t]) => [k, t]) });
  if ((money.m2 || []).length) C("rates", "Денежная масса", "широкая ⊃ M2 ⊃ M1 ⊃ M0 · M1 — наличные + средства на текущих счетах · ЦБ РФ" + FC_NOTE + " (рост M2, режим % г/г)", 300, (node, mode) =>
    { levelChart(node, mode, [["broad", "Широкая", "#5b8def"], ["m2", "M2", "#1fe0a0"], ["m1", "M1", "#c792ea"], ["m0", "M0 (наличные)", "#f5b13c"]], money, { unit: mode === "gdp" ? "" : "трлн ₽", div: 1000, dg: 1, kind: mode === "yoy" ? "line" : "area", ext: mode === "yoy" ? futureTo(FC_END) : [] });
      if (mode === "yoy") fcBoxes(node, fcSpans("m2", "#1fe0a0", { text: true }).map(b => ({ ...b, gran: "dec" }))); },
    { main: false, agg: "last", modes: ["abs", "yoy", "gdp"] });

  // ═══════════════ РЫНКИ ═══════════════
  if (gcurve?.tenors?.length) C("markets", "Кривая ОФЗ (КБД)", `безрисковая доходность по срокам · ${dmy(gcurve.tradedate)} · MOEX`, 280, bGcurve);
  if (RB.some(([k]) => rc[k]?.curve?.length)) C("markets", "Доходность по рейтингам — кривая", "YTM по дюрации на сегодня · % годовых · облигации РФ", 280, node => mkChart(node, {
    ...CHART_BG, tooltip: { trigger: "item", formatter: p => `<b>${p.seriesName}</b><br>дюрация ${fmt(p.value[0], 1)} г · ${pct(p.value[1])}` },
    legend: legOf(RB.filter(([k]) => rc[k]?.curve?.length).map(([k]) => k)), grid: { left: 46, right: 18, top: 34, bottom: 44 },
    xAxis: { type: "value", name: "дюрация, лет", nameLocation: "middle", nameGap: 28, min: 0, ...AX }, yAxis: { type: "value", name: "YTM, %", scale: true, ...AX },
    series: RB.filter(([k]) => rc[k]?.curve?.length).map(([k, color]) => ({ name: k, type: "line", smooth: true, symbol: "circle", symbolSize: 5, data: rc[k].curve.map(p => [p.duration, p.ytm]), lineStyle: { width: 2, color }, itemStyle: { color }, z: 3 })),
  }));
  if (RB.some(([k]) => (rh[k] || []).length)) C("markets", "YTM по рейтингам, помесячно", "медианная доходность по кредитным группам · % · облигации РФ", 300, node => {
    const dates = [...new Set(RB.flatMap(([k]) => (rh[k] || []).map(r => r.month)))].sort();
    const colOf = k => { const m = Object.fromEntries((rh[k] || []).map(r => [r.month, r.ytm])); return dates.map(dt => m[dt] ?? null); };
    mkChart(node, {
      ...CHART_BG, tooltip: { trigger: "axis", formatter: ps => `${ps[0].axisValue}<br>` + ps.filter(p => p.data != null).map(p => `${p.marker}${p.seriesName}: <b>${pct(p.data)}</b>`).join("<br>") },
      legend: legOf(RB.filter(([k]) => (rh[k] || []).length).map(([k]) => k)), grid: { left: 44, right: 18, top: 34, bottom: 40 },
      xAxis: catX(dates.map(mmy)), yAxis: { type: "value", name: "YTM, %", scale: true, ...AX },
      series: RB.filter(([k]) => (rh[k] || []).length).map(([k, color]) => ({ name: k, type: "line", data: colOf(k), symbol: "none", connectNulls: true, lineStyle: { width: 1.8, color }, itemStyle: { color }, z: 3 })),
    });
  });
  else if (MACRO.rh === null) C("markets", "YTM по рейтингам, помесячно", "загружается история доходностей…", 60, node => { node.innerHTML = `<div class="muted" style="padding:14px">Загружаю историю доходностей по рейтингам…</div>`; });
  if ((rh.AAA || []).length && (rh.BB || []).length) C("markets", "Кредитный спред BB − AAA", "риск-премия рынка облигаций · п.п. · помесячно", 270, node => {
    const mA = Object.fromEntries((rh.AAA || []).map(r => [r.month, r.ytm]));
    lineChart(node, [["x", "BB − AAA", "#f5913c"]], { x: (rh.BB || []).map(r => ({ date: r.month, val: mA[r.month] != null ? r.ytm - mA[r.month] : null })).filter(x => x.val != null) }, { unit: "п.п.", dg: 1, area: true });
  }, { agg: "mean" });
  // (убран по просьбе пользователя: «Индексы полной доходности облигаций» — ряды в API/CSV)
  // (убраны по просьбе пользователя: IMOEX, RGBI, золото в $ — ряды остаются в API/CSV)
  const mcap = (d.wb || {}).mcap_gdp || [], capY = d.moex_cap_years || [];
  // цели указа Президента № 309 от 07.05.2024 (наццель «Устойчивая и динамичная экономика»)
  const CAP_TGT = [[2030, 66], [2036, 75]];
  if (mcap.length || capY.length) C("markets", "Капитализация рынка к ВВП (индикатор Баффета)", "% ВВП на конец года · синие — World Bank; голубые (годы, которых у WB ещё нет) — считаем сами: капитализация Мосбиржи на последний торговый день года ÷ ВВП года (Росстат) · зелёный — сейчас: капитализация Мосбиржи ÷ ВВП за 4 последних квартала · оранжевый пунктир — цели указа Президента № 309 от 07.05.2024: 66% ВВП к 2030 г., 75% — к 2036 г. · фоном — индекс МосБиржи (правая шкала) · ниже — рынок «дешевле»", 360, node => {
    const wbM = Object.fromEntries(mcap.map(r => [r.date, r.val]));
    const own = {}; capY.forEach(r => { const g = G4[`${r.date}-Q4`]; if (g) own[r.date] = { v: r.val / g * 100, capv: r.val, g, td: r.tradedate }; });
    const lastQ = Object.keys(G4).sort().pop(), g4 = lastQ ? G4[lastQ] : null, nowY = new Date().getFullYear();
    const y0 = Math.min(...mcap.map(r => +r.date), ...Object.keys(own).map(Number)), yN = CAP_TGT[CAP_TGT.length - 1][0];
    const yrs = []; for (let y = y0; y <= yN; y++) yrs.push(String(y));
    const rows = yrs.map(y => {
      if (wbM[y] != null) return { y, v: wbM[y], kind: "wb" };
      if (own[y]) return { y, kind: "own", ...own[y] };
      if (+y === nowY && cap.cap && g4) return { y, v: cap.cap / (g4 * 1e9) * 100, kind: "now", g4, q: lastQ };
      const t = CAP_TGT.find(t2 => t2[0] === +y); if (t) return { y, v: t[1], kind: "tgt" };
      return { y, v: null, kind: null };
    });
    const COL = { wb: "#5b8def", own: "#8fb3f5", now: "#1fe0a0", tgt: "#f5913c" };
    // IMOEX: закрытие на конец каждого года (для подсказки) и помесячная линия на скрытой оси времени
    const imY = {}; imoexS.forEach(r => { imY[r.date.slice(0, 4)] = r.val; });
    const x0 = `${y0}-01-01`, x1 = `${yN}-12-31`;
    mkChart(node, {
      ...CHART_BG,
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" }, formatter: ps => {
          const q = ps.find(p => p.seriesName !== "IMOEX"), r = q ? rows[q.dataIndex] : null; if (!r) return "";
          let s = `<b>${r.y}</b>`;
          if (r.kind === "wb") s += `<br>кап / ВВП: <b>${fmt(r.v, 1)}%</b> <span style="opacity:.7">(World Bank)</span>`;
          if (r.kind === "own") s += `<br>кап / ВВП: <b>${fmt(r.v, 1)}%</b><br><span style="opacity:.75">капитализация ${fmt(r.capv / 1000, 1)} трлн ₽ на ${dmy(r.td)} ÷ ВВП ${r.y} ${fmt(r.g / 1000, 1)} трлн ₽ (Росстат)</span>`;
          if (r.kind === "now") s += ` — сейчас<br>кап / ВВП: <b>${fmt(r.v, 1)}%</b><br><span style="opacity:.75">${capT} на ${dmy(cap.cap_date)} ÷ ВВП ${fmt(r.g4 / 1000, 1)} трлн (4 кв. по ${qlab(r.q)})</span>`;
          if (r.kind === "tgt") s += `<br>цель: <b>${r.v}% ВВП</b><br><span style="opacity:.75">указ Президента № 309 от 07.05.2024</span>`;
          const now = rows.find(x => x.kind === "now");
          if (r.kind === "tgt" && now) s += `<br><span style="opacity:.75">от текущих ${fmt(now.v, 1)}% — рост в ${fmt(r.v / now.v, 1)} раза (при неизменном ВВП)</span>`;
          if (imY[r.y] != null) s += `<br>IMOEX ${+r.y === nowY ? "сейчас" : "на конец года"}: <b>${fmt(imY[r.y], 0)}</b>`;
          return s;
        }
      },
      legend: legOf(["Кап / ВВП", "Цель (указ № 309)", "IMOEX"]), grid: { left: 46, right: 58, top: 34, bottom: 32 },
      xAxis: [{ type: "category", data: yrs, ...AX, axisLabel: { color: AXIS_TXT, hideOverlap: true } }, { type: "time", min: x0, max: x1, show: false }],
      yAxis: [
        { type: "value", name: "% ВВП", min: 0, max: v2 => Math.ceil(v2.max * 1.18 / 10) * 10, ...AX, axisLabel: { color: AXIS_TXT, formatter: v2 => fmt(v2, 0) + "%" } },
        { type: "value", name: "IMOEX", position: "right", scale: true, ...AX, splitLine: { show: false } },
      ],
      series: [
        { name: "IMOEX", type: "line", xAxisIndex: 1, yAxisIndex: 1, data: imoexS.map(r => [`${r.date}-15`, r.val]), symbol: "none", silent: true, lineStyle: { width: 1.4, color: "#c792ea", opacity: 0.75 }, itemStyle: { color: "#c792ea" }, areaStyle: { color: "rgba(199,146,234,.10)" }, z: 1 },
        { name: "Кап / ВВП", type: "bar", barWidth: "62%", z: 2,
          data: rows.map(r => r.v == null || r.kind === "tgt" ? null : { value: +r.v.toFixed(1), itemStyle: { color: COL[r.kind] } }), itemStyle: { color: COL.wb },
          label: { show: true, position: "top", formatter: p => fmt(p.value, 0) + "%", color: AXIS_TXT, fontSize: 9 } },
        { name: "Цель (указ № 309)", type: "bar", barGap: "-100%", barWidth: "62%", z: 3,
          data: rows.map(r => r.kind === "tgt" ? { value: r.v, itemStyle: { color: COL.tgt + "22", borderColor: COL.tgt, borderType: "dashed", borderWidth: 1.5 } } : null), itemStyle: { color: COL.tgt },
          label: { show: true, position: "insideTop", distance: 6, formatter: p => `цель\n${p.value}%`, color: COL.tgt, fontSize: 10, fontWeight: 600, lineHeight: 13 } },
        { name: "Траектория к цели", type: "line", z: 4, connectNulls: true, symbol: "none", silent: true, tooltip: { show: false },
          data: rows.map(r => r.kind === "now" || r.kind === "tgt" ? +r.v.toFixed(1) : null), lineStyle: { color: COL.tgt, type: "dashed", width: 1.5 } },
      ],
    });
  });

  // ═══════════════ КРЕДИТ И РИСКИ ═══════════════
  if ((ce.credit || []).length || (lend.corporate || []).length) C("credit", "Кредит экономике", "% г/г — официальный показатель ЦБ (кредиты + корпоблигации) · Абс./Доли/% ВВП — задолженность по кредитам юрлиц и физлиц" + (FC.asof ? ` · рамки в % г/г — прогноз ЦБ от ${FC.asof}: оранжевые — кредит экономике, синие — организациям, зелёные — населению` : ""), 330, (node, mode, _a, _n, npl) => {
    const shC = opSeries(nplD.corporate, lend.corporate, (a, b) => a / b * 100), shR = opSeries(nplD.retail, lend.retail, (a, b) => a / b * 100), shM = opSeries(d.mortgage_npl, mortD, (a, b) => a / b * 100);
    if (mode !== "yoy") {
      levelChart(node, mode, [["corporate", "Юрлица и ИП", "#5b8def"], ["retail", "Физлица", "#1fe0a0"],
        ...(npl ? [["npl_corp", "Просрочка юрлиц", "#d32f2f", { overlay: true, noNet: true }], ["npl_retail", "Просрочка физлиц", "#ff8a65", { overlay: true, noNet: true }]] : [])],
        { ...lend, npl_corp: nplD.corporate, npl_retail: nplD.retail }, { unit: "трлн ₽", div: 1000, dg: 1, kind: "stackbar" });
      if (npl) nplTip(node, [["юрлица", shC], ["физлица", shR], ["ипотека", shM]]);
      return;
    }
    // % г/г + (по переключателю) доля просрочки в портфеле, % — пунктиром на той же шкале
    lineChart(node, [["credit", "Кредит экономике", "#f5b13c"], ["corp_loans", "Корпоративные кредиты", "#5b8def"], ["corp_bonds", "Корпоративные облигации", "#c792ea"], ["retail_loans", "Кредиты физлицам", "#1fe0a0"],
      ...(npl ? [["npl_c", "Просрочка юрлиц, % портфеля", "#d32f2f"], ["npl_r", "Просрочка физлиц, % портфеля", "#ff8a65"], ["npl_m", "Просрочка ипотеки, % портфеля", "#ad1457"]] : [])],
      { ...ce, npl_c: shC, npl_r: shR, npl_m: shM }, { unit: "%", dg: 1, zero: true, ext: futureTo(FC_END) });
    if (npl) { const i = echarts.getInstanceByDom(node); if (i) i.setOption({ series: i.getOption().series.map(sr => /Просрочка/.test(sr.name) ? { lineStyle: { type: "dashed", width: 2 } } : {}) }); }
    fcBoxes(node, [...fcSpans("credit", "#f5b13c", { text: true }).map(b => ({ ...b, gran: "dec" })), ...fcSpans("credit_corp", "#5b8def", { text: true }).map(b => ({ ...b, gran: "dec" })), ...fcSpans("credit_hh", "#1fe0a0", { text: true }).map(b => ({ ...b, gran: "dec" }))]);
  }, { agg: "last", modes: ["yoy", "abs", "share", "gdp"], tog: (nplD.retail || []).length ? ["npl", "Просрочка", "Показать просроченную задолженность: в % г/г — долю просрочки в портфеле (юрлица, физлица, ипотека), в Абс./% ВВП — объём просрочки пунктиром"] : null });
  if ((nplD.retail || []).length && (lend.retail || []).length) C("credit", "Доля просроченной задолженности", "просрочка ÷ задолженность · % · ипотека — просроченная задолженность по ипотечным жилищным кредитам ÷ весь ипотечный портфель · ЦБ РФ", 280, node =>
    lineChart(node, [["corp", "Юрлица и ИП", "#5b8def"], ["retail", "Физлица", "#1fe0a0"], ["mort", "Ипотека", "#c792ea"]], { retail: opSeries(nplD.retail, lend.retail, (a, b) => a / b * 100), corp: opSeries(nplD.corporate, lend.corporate, (a, b) => a / b * 100), mort: opSeries(d.mortgage_npl, mortD, (a, b) => a / b * 100) }, { unit: "%", dg: 2 }), { agg: "last" });
  const nfs = d.nfs || {}, nfsBlocks = [...(nfs.liabilities || []), ...(nfs.stability || [])];
  if (nfsBlocks.length) C("credit", "Закредитованность компаний по отраслям", "", 0, null, {
    custom: host => {
      const id = `mc-nfs`;
      const p = el(`<div class="panel" style="margin-bottom:16px"><h3>Закредитованность и финансы компаний по отраслям${infoBtn("по отчётным годам · годовая бухотчётность нефинансовых организаций (кроме банков и страховщиков) · ЦБ РФ, «Финансовая устойчивость нефинансовых организаций»")}</h3>${infoBox("по отчётным годам · годовая бухотчётность нефинансовых организаций (кроме банков и страховщиков) · ЦБ РФ, «Финансовая устойчивость нефинансовых организаций»")}
        <div class="chips" id="${id}-sel" style="margin:6px 0 4px;flex-wrap:wrap"></div><div class="muted" id="${id}-def" style="font-size:12px;line-height:1.45;margin:2px 0 6px;max-width:1100px"></div><div class="chart" id="${id}" style="height:340px"></div></div>`);
      host.appendChild(p);
      const selBox = p.querySelector(`#${id}-sel`), node = p.querySelector(`#${id}`), defBox = p.querySelector(`#${id}-def`);
      // что это и как считается — серым над графиком для выбранного показателя
      const NFS_PAL = ["#5b8def", "#1fe0a0", "#ff6b6b", "#c792ea", "#8bd450", "#4fc3f7", "#9aa7b0", "#e57373", "#4db6ac", "#f06292", "#a1887f", "#7986cb", "#ba68c8", "#81c784", "#ffb74d"];
      const NFS_DEF = [
        [/^Обязательства/i, "Все обязательства компаний на конец года: кредиты и займы, облигации, кредиторская задолженность и прочие, трлн ₽."],
        [/стоимости финансирования/i, "Проценты к уплате ÷ кредиты и займы — средняя ставка, под которую компании обслуживают долг: 0,10 = 10% годовых. Растёт вслед за ключевой с лагом."],
        [/левериджа/i, "Заёмный капитал (кредиты, займы, облигации) ÷ собственный капитал. Больше 1 — долга больше, чем своих денег; рост — компании живут в долг."],
        [/краткосрочной задолженности/i, "Краткосрочный долг (до года) ÷ долгосрочный. Чем выше, тем больше нужно рефинансировать в ближайший год — риск при дорогих деньгах."],
        [/финансовых активов к нефинансовым/i, "Финансовые активы (деньги, депозиты, вложения, выданные займы) ÷ нефинансовые (основные средства, запасы). Выше — больше денежная подушка."],
        [/прибыли.*к собственным средствам/i, "Накопленная нераспределённая прибыль (минус непокрытый убыток) ÷ собственный капитал — какая доля капитала заработана, а не внесена владельцами. Отрицательная — накоплены убытки."],
        [/прибыли.*к нефинансовым активам/i, "Нераспределённая прибыль ÷ нефинансовые активы (основные средства, запасы) — насколько реальные активы оплачены накопленной прибылью, а не долгом."],
        [/ROE/, "Рентабельность капитала: чистая прибыль за год ÷ собственный капитал, %. Сравнивайте с ключевой ставкой: ROE ниже ставки — бизнесу выгоднее держать деньги на депозите."],
        [/ROA/, "Рентабельность активов: чистая прибыль за год ÷ все активы, %."],
        [/ROS/, "Норма чистой прибыли: чистая прибыль ÷ выручка, % — сколько копеек прибыли с рубля продаж."],
        [/ликвидности/i, "Текущая ликвидность: оборотные активы ÷ краткосрочные обязательства. Меньше 1 — краткосрочных долгов больше, чем оборотных активов, чтобы их погасить."],
      ];
      const shortT = t => t.replace(/\s*\((?![A-Z]{2,4}\))[^)]*\)/g, "").replace(/\*|,\s*трлн руб\.?/g, "").replace(/\s*нефинансовых организаций/i, "").replace(/\s+,/g, ",").trim();
      let cur = Math.max(0, nfsBlocks.findIndex(b => /леверидж/i.test(b.title)));
      try { const sv = +localStorage.getItem("bonds_mm_nfs"); if (sv >= 0 && sv < nfsBlocks.length && localStorage.getItem("bonds_mm_nfs") != null) cur = sv; } catch (e) { }
      wireInfo(p, "Закредитованность и финансы компаний по отраслям", "по отчётным годам · годовая бухотчётность нефинансовых организаций (кроме банков и страховщиков) · ЦБ РФ, «Финансовая устойчивость нефинансовых организаций»", () => null,
        () => nfsBlocks.map(b => [shortT(b.title), (NFS_DEF.find(([re]) => re.test(b.title)) || [, ""])[1]]).filter(r => r[1]));
      const draw = () => {
        selBox.innerHTML = nfsBlocks.map((b, i) => `<span class="chip ${i === cur ? "on" : ""}" data-i="${i}" style="font-size:11px">${shortT(b.title)}</span>`).join("");
        selBox.querySelectorAll("[data-i]").forEach(c => c.onclick = () => { cur = +c.dataset.i; try { localStorage.setItem("bonds_mm_nfs", cur); } catch (e) { } draw(); });
        const b = nfsBlocks[cur], names = Object.keys(b.rows), yrs = [...new Set(names.flatMap(n => b.rows[n].map(r => r.date)))].sort();
        defBox.textContent = (NFS_DEF.find(([re]) => re.test(b.title)) || [, ""])[1];
        const isPct = /%/.test(b.title), isTrln = /трлн/.test(b.title);
        const defaultOn = new Set(["Все организации", "Добыча", "Обработка", "Строительство", "Торговля", "Недвижимость", "Электроэнергетика"]);
        // легенда отраслей — переносом на строки (все видны и кликабельны), график ниже на её высоту
        let rows = 1, lineW = 0; const avail = Math.max(200, node.clientWidth - 16);
        names.forEach(n => { const w = n.length * 6.6 + 30; if (lineW + w > avail && lineW > 0) { rows++; lineW = w; } else lineW += w; });
        mkChart(node, {
          ...CHART_BG,
          tooltip: { trigger: "axis", axisPointer: XP, formatter: ps => `${ps[0].axisValue}<br>` + [...ps].sort((a, c) => (c.data ?? -1e9) - (a.data ?? -1e9)).filter(q => q.data != null).map(q => `${q.marker}${q.seriesName}: <b>${fmt(q.data, isTrln ? 1 : 2)}${isPct ? "%" : isTrln ? " трлн ₽" : ""}</b>`).join("<br>") },
          legend: { ...legOf(names), type: "plain", top: 0, left: 8, right: 8, itemGap: 12, selected: Object.fromEntries(names.map(n => [n, defaultOn.has(n)])) },
          grid: { left: 48, right: 18, top: 18 + rows * 18, bottom: 30 },
          xAxis: { type: "category", data: yrs, ...AX, axisLabel: { color: AXIS_TXT } }, yAxis: { type: "value", scale: true, ...AX },
          series: names.map((n, i) => { const m = Object.fromEntries(b.rows[n].map(r => [r.date, r.val])); const col2 = n === "Все организации" ? "#f5b13c" : NFS_PAL[i % NFS_PAL.length]; return { name: n, type: "line", data: yrs.map(y => m[y] ?? null), symbol: "circle", symbolSize: 4, lineStyle: { width: n === "Все организации" ? 3 : 1.8, color: col2 }, itemStyle: { color: col2 }, z: n === "Все организации" ? 3 : 2 }; }),
        });
      };
      draw();
    }
  });
  if ((hh.deposits || []).length) C("credit", "Финансы населения: сбережения и долги", "активы населения — стопкой · красный пунктир — долг (кредиты банков), поверх стопки, не входит в неё · в подсказке — чистые активы · ЦБ РФ", 320, (node, mode) => {
    levelChart(node, mode, [["deposits", "Депозиты", "#5b8def"], ["cash", "Наличные", "#f5b13c"], ["equity", "Акции и паи фондов", "#c792ea"], ["insurance", "Страх. и пенс. резервы", "#1fe0a0"], ["bonds", "Облигации", "#4fc3f7"], ["loans", "Долг: кредиты банков", "#e53935", { overlay: true }]], hh, { unit: "трлн ₽", div: 1000, dg: 1, kind: "stack" });
  }, { agg: "last", modes: ["abs", "share", "yoy", "gdp"] });
  if (mortD.length) C("credit", "Ипотека", "выдача (столбики, млрд ₽) и задолженность (линия, трлн ₽) · «+ Просрочка» — добавить просроченную задолженность по ипотеке (красные столбики, млрд ₽; в «% г/г» — её рост), доля просрочки в портфеле — в подсказке; с 2019 г. · ЦБ РФ" + (FC.asof ? ` · рамки в % г/г — прогноз ЦБ роста портфеля (${FC.asof})` : ""), 300, (node, mode, _a, _n, npl) => {
    const mnpl = d.mortgage_npl || [], mShare = opSeries(mnpl, mortD, (a, b) => a / b * 100);
    if (mode === "yoy") {
      const issY = FREQ === "year" ? yoyAny(annualize(d.mortgage_issue, "sum")) : yoyAny(d.mortgage_issue);
      lineChart(node, [["debt", "Задолженность", "#c792ea", { agg: "last" }], ["iss", "Выдача", "#f5913c", { agg: "last" }], ...(npl ? [["npl", "Просроченная задолженность", "#ff3b3b", { agg: "last" }]] : [])], { debt: yoyAny(mortD), iss: issY, npl: yoyAny(mnpl) }, { unit: "%", dg: 1, zero: true, ext: futureTo(FC_END) });
      fcBoxes(node, fcSpans("mortgage", "#c792ea", { text: true }).map(b => ({ ...b, gran: "dec" })));
    } else barLine(node, { bars: [[FREQ === "year" ? "Выдача за год" : "Выдача за месяц", d.mortgage_issue || [], "#f5913c", "sum"], ...(npl ? [["Просроченная задолженность", mnpl, "#ff3b3b", "last"]] : [])], lines: [["Задолженность", mortD.map(r => ({ date: r.date, val: r.val / 1000 })), "#c792ea", "last"]], ub: "млрд ₽", ul: "трлн ₽", dgb: 0, dgl: 2 });
    if (npl) nplTip(node, [["ипотека", mShare]]);
  }, { agg: "last", modes: ["abs", "yoy"], tog: (d.mortgage_npl || []).length ? ["npl", "Просрочка", "Показать просроченную задолженность по ипотеке (и её долю в портфеле — в подсказке)"] : null });
  const iss = d.issuance || {};
  if ((iss.corp || []).length) C("credit", "Выдача кредитов за месяц", "объём выданных кредитов · ЦБ РФ", 280, (node, mode) =>
    levelChart(node, mode, [["corp", "Юрлицам и ИП", "#5b8def"], ["retail", "Физлицам", "#1fe0a0"]], iss, { unit: "трлн ₽", div: 1000, dg: 2 }), { main: false, agg: "sum", modes: ["abs", "yoy", "share"] });
  if ((d.msp_lending || []).length) C("credit", "Кредиты МСП — задолженность", "субъекты малого и среднего бизнеса · ЦБ", 260, (node, mode) =>
    levelChart(node, mode, [["x", "МСП", "#f5913c"]], { x: d.msp_lending }, { unit: "трлн ₽", div: 1000, dg: 2, kind: "area" }), { main: false, agg: "last", modes: ["abs", "yoy"] });
  const bk = d.banking || {};
  const bkL = bk.levels || {};
  if ((bk.assets || []).length) C("banks", "Банковский сектор", "% г/г — прирост к тому же месяцу год назад, без валютной переоценки · трлн ₽ — остатки: на 1 января — таблица 1 обзора банковского сектора ЦБ, внутри года — по месячным темпам прироста с подгонкой к следующему 1 января (помесячных остатков ЦБ в обзоре не даёт); до 2022 — только на 1 января · капитал — собственные средства · обзор ЦБ", 300, (node, mode, alt) => {
    const abs = alt === "abs" && Object.keys(bkL).length, src = abs ? bkL : bk, o = abs ? { unit: "трлн ₽", mln2trln: true, dg: 1 } : { unit: "%", dg: 1, zero: true };
    return mode === "funds"
      ? lineChart(node, [["retail_deposits", "Средства физлиц", "#1fe0a0"], ["corp_deposits", "Средства юрлиц", "#5b8def"]], src, o)
      : lineChart(node, [["assets", "Активы", "#5b8def"], ["corp_loans", "Кредиты юрл", "#1fe0a0"], ["retail_loans", "Кредиты физл", "#8bd450"], ["capital", "Капитал", "#c792ea"]], src, o);
  }, { agg: "last", modes: [["assets", "Активы и кредиты"], ["funds", "Средства клиентов"]], alt: Object.keys(bkL).length ? [["yoy", "% г/г"], ["abs", "трлн ₽"]] : null });
  if (sub === "banks" && MACRO.bankProfits === undefined) {
    MACRO.bankProfits = null;
    fetch(`${API}/api/bank_profits`).then(x => x.json()).then(bp => { MACRO.bankProfits = bp; render(); }).catch(() => { MACRO.bankProfits = { banks: {} }; render(); });
  }
  if (sub === "banks" && MACRO.bankNorm === undefined) {
    MACRO.bankNorm = null;
    fetch(`${API}/api/bank_normatives`).then(x => x.json()).then(bn => { MACRO.bankNorm = bn; render(); }).catch(() => { MACRO.bankNorm = { banks: {} }; render(); });
  }
  const BANK_COL = ["#1fe0a0", "#5b8def", "#f5913c", "#c792ea", "#ff6b6b", "#8bd450", "#f5c542", "#5bd6a0"];
  const bp = MACRO.bankProfits;
  if (bp && bp.banks && Object.keys(bp.banks).length) {
    const order = bp.order || Object.keys(bp.banks);
    C("banks", "Чистая прибыль публичных банков", "форма 102 ЦБ · по годам или по месяцам (из накопленной с начала года) · текущий год — с начала года (светлее), его % г/г — к тем же месяцам прошлого года · 2022 не раскрывался", 330, (node, mode) => {
      // помесячно: накопленная с начала года (история с 2020 + текущий год) → прирост за месяц;
      // пропуски (до 2025 форма 102 квартальная) — прибыль квартала ÷ 3 (оценка, «≈» в подсказке)
      const estM = {};
      const monthly = (s, name) => {
        const cum = {}; [...((bp.hist || {})[name] || []), ...(s || [])].forEach(r => { cum[r.date] = r.val; });
        const byY = {}; Object.keys(cum).forEach(dt => { (byY[dt.slice(0, 4)] = byY[dt.slice(0, 4)] || {})[+dt.slice(5, 7)] = cum[dt]; });
        const out = [];
        Object.keys(byY).sort().forEach(y => { const m = byY[y], ks = Object.keys(m).map(Number).sort((a, b) => a - b); let p0 = 0, v0 = 0;
          ks.forEach(k => { const per = (m[k] - v0) / (k - p0); for (let j = p0 + 1; j <= k; j++) { const dt = `${y}-${String(j).padStart(2, "0")}`; out.push({ date: dt, val: per }); if (k - p0 > 1) estM[name + dt] = true; } p0 = k; v0 = m[k]; }); });
        return out;
      };
      const years = [...new Set(order.flatMap(n => ((bp.annual || {})[n] || []).map(r => r.date)))].sort();
      const annual = Object.fromEntries(order.map(n => { const m = Object.fromEntries(((bp.annual || {})[n] || []).map(r => [r.date, r.val])); return [n, years.map(y => ({ date: y, val: m[y] ?? null }))]; }));
      // текущий год — только январь–N (ytd): подписываем «2026 (янв–июл)», а % г/г считаем к ТЕМ ЖЕ
      // месяцам прошлого года (накопленная из истории), а не к полному году (давало −31% вместо +20%)
      const cy = String(new Date().getFullYear()), lastM = Math.max(0, ...order.map(n => +((bp.banks[n] || []).slice(-1)[0]?.date || "0-0").slice(5, 7) || 0));
      const MNS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
      const ytdLbl = lastM && lastM < 12 ? `${cy} (янв–${MNS[lastM - 1]})` : cy;
      const yoyYtd = n => { const a = annual[n].map(r => ({ ...r })), yy = yoyAny(annual[n]);
        const cur = a.find(r => r.date === cy), prevSame = ((bp.hist || {})[n] || []).find(r => r.date === `${+cy - 1}-${String(lastM).padStart(2, "0")}`);
        return yy.map(r => r.date === cy ? { date: cy, val: cur && cur.val != null && prevSame && prevSame.val > 0 ? (cur.val / prevSame.val - 1) * 100 : null } : r); };
      const src = mode === "month" ? Object.fromEntries(order.map(n => [n, monthly(bp.banks[n], n)])) : mode === "yoy" ? Object.fromEntries(order.map(n => [n, yoyYtd(n)])) : annual;
      if (mode === "month") node.dataset.keep = 12; else delete node.dataset.keep;
      const { dates, col } = merge(order.map(n => src[n]));
      const u = mode === "yoy" ? "%" : " млрд ₽";
      mkChart(node, {   // сгруппированные столбики: банк × период
        ...CHART_BG,
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: ps => { const dt = mode === "month" ? dates[ps[0].dataIndex] : null; const anyEst = dt && ps.some(p => estM[p.seriesName + dt]);
          const pv = p => (p.data != null && typeof p.data === "object") ? p.data.value : p.data;
          return `${ps[0].axisValue}<br>` + [...ps].filter(p => pv(p) != null).sort((a, b) => pv(b) - pv(a)).map(p => `${p.marker}${p.seriesName}: <b>${dt && estM[p.seriesName + dt] ? "≈" : ""}${fmt(pv(p), mode === "abs" ? 0 : 1)}${u}</b>`).join("<br>")
            + (anyEst ? `<div style="margin-top:5px;font-size:11px;opacity:.75">≈ — оценка: до 2025 г. форма 102 квартальная, прибыль квартала ÷ 3; 2022 и I кв. 2023 банки не раскрывали</div>` : ""); } },
        legend: legOf(order), grid: { left: 52, right: 18, top: 34, bottom: 36 },
        xAxis: { type: "category", data: mode === "month" ? dates.map(mmy) : dates.map(d => d === cy ? ytdLbl : d), ...AX, axisLabel: { color: AXIS_TXT, hideOverlap: true } },
        yAxis: { type: "value", name: mode === "yoy" ? "% г/г" : "млрд ₽", ...AX },
        series: order.map((n, i) => ({ name: n, type: "bar", barMaxWidth: 16, itemStyle: { color: BANK_COL[i % BANK_COL.length] }, markLine: i === 0 ? zeroLine : undefined, z: 2,
          // неполный текущий год — полупрозрачным (в «По годам» это январь–N, не весь год)
          data: col(src[n]).map((v, k) => v != null && mode !== "month" && dates[k] === cy ? { value: v, itemStyle: { opacity: 0.55 } } : v) })),
      });
    }, { modes: [["abs", "По годам"], ["yoy", "% г/г"], ["month", "По месяцам"]] });
    // один банк: прибыль с начала года накопленным итогом по месяцам, линия — год (сезонность и темп)
    const YCOL = ["#d4b106", "#9aa7b0", "#c792ea", "#f5913c", "#5b8def", "#1fe0a0"], MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
    C("banks", "Прибыль банка с начала года — по годам", "чистая прибыль накопленным итогом с начала года, млрд ₽ · каждая линия — год: видно, идёт ли банк быстрее прошлого года · с 2020 г. · до 2025 г. ЦБ публиковал форму 102 только поквартально — месяцы между кварталами показаны оценкой (прибыль квартала ÷ 3, без точки на линии; в подсказке «≈»), с 2025 — помесячно · 2022 и I кв. 2023 банки не раскрывали · форма 102 ЦБ", 340, (node, bank) => {
      const all = [...((bp.hist || {})[bank] || []), ...(bp.banks[bank] || [])];
      const byY = {}; all.forEach(r => { (byY[r.date.slice(0, 4)] = byY[r.date.slice(0, 4)] || {})[+r.date.slice(5, 7)] = r.val; });
      const ys = Object.keys(byY).sort(), lastY = ys[ys.length - 1];
      // пропущенные месяцы (квартальная отчётность) — равномерно: прирост квартала ÷ 3, от 0 в начале года;
      // после последней точки года (текущий год) не продлеваем
      const est = {};
      ys.forEach(y => { const m = byY[y], ks = Object.keys(m).map(Number).sort((a, b) => a - b); if (!ks.length) return;
        let p0 = 0, v0 = 0; est[y] = {};
        ks.forEach(k => { for (let j = p0 + 1; j < k; j++) { m[j] = v0 + (m[k] - v0) * (j - p0) / (k - p0); est[y][j] = true; } p0 = k; v0 = m[k]; }); });
      if (!ys.length) { node.innerHTML = `<div class="muted" style="padding:20px">Нет данных по банку</div>`; return; }
      mkChart(node, {
        ...CHART_BG,
        tooltip: { trigger: "axis", axisPointer: XP, formatter: ps => {
          const k = ps[0].dataIndex + 1, vals = Object.fromEntries(ys.map(y => [y, byY[y][k]]));
          return `${bank} · январь–${["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"][k - 1]}<br>` + [...ys].reverse().filter(y => vals[y] != null).map(y => {
            const pv = vals[String(+y - 1)], g = pv != null && pv > 0 ? ` <span style="opacity:.7">${vals[y] >= pv ? "+" : ""}${fmt((vals[y] / pv - 1) * 100, 0)}% к ${+y - 1}</span>` : "";
            return `${ps.find(p => p.seriesName === y)?.marker || ""}${y}: <b>${est[y]?.[k] ? "≈" : ""}${fmt(vals[y], 1)} млрд ₽</b>${g}`; }).join("<br>")
            + (ys.some(y => est[y]?.[k]) ? `<div style="margin-top:5px;font-size:11px;opacity:.75">≈ — оценка: до 2025 г. ЦБ публиковал форму 102 только поквартально, прибыль квартала разложена по месяцам поровну (÷ 3)</div>` : ""); } },
        legend: legOf(ys), grid: { left: 52, right: 44, top: 34, bottom: 30 },
        xAxis: { type: "category", data: MON, boundaryGap: false, ...AX, axisLabel: { color: AXIS_TXT } }, yAxis: { type: "value", name: "млрд ₽", ...AX },
        series: ys.map((y, i) => { const c = y === lastY ? "#1fe0a0" : YCOL[Math.max(0, YCOL.length - 1 - (ys.length - 1 - i))] || "#b0bac2";
          return { name: y, type: "line", data: MON.map((_, k) => byY[y][k + 1] == null ? null : est[y]?.[k + 1] ? { value: +byY[y][k + 1].toFixed(1), symbol: "none" } : byY[y][k + 1]), connectNulls: true, symbol: "circle", symbolSize: y === lastY ? 6 : 5,
            lineStyle: { width: y === lastY ? 3 : 1.8, color: c }, itemStyle: { color: c }, z: y === lastY ? 4 : 2,
            endLabel: { show: y === lastY, formatter: p => fmt(p.value, 0), color: c, fontSize: 10, fontWeight: 600 } }; }),
      });
    }, { modes: order.map(n => [n, n]) });
  } else if (bp === null) C("banks", "Чистая прибыль публичных банков", "загружается (форма 102 ЦБ)…", 60, node => { node.innerHTML = `<div class="muted" style="padding:14px">Загружаю прибыль публичных банков…</div>`; });
  const bn = MACRO.bankNorm;
  if (bn && bn.banks && Object.keys(bn.banks).length) {
    const NORMS = [["n10", "Н1.0 · капитал", 8], ["n11", "Н1.1 · базовый", 4.5], ["n12", "Н1.2 · основной", 6], ["n2", "Н2 · мгнов. ликв.", 15], ["n3", "Н3 · тек. ликв.", 50], ["n4", "Н4 · долгоср.", null]];
    const order = bn.order || Object.keys(bn.banks);
    C("banks", "Нормативы банков по месяцам", "% · форма 135 ЦБ, на конец месяца · с 2020 г. (2022 — начало 2023 ЦБ не раскрывал) · «Годы» — на конец года · пунктир — минимум", 340, (node, np) => {
      const nDef = NORMS.find(x => x[0] === np) || NORMS[0];
      const serOf = n => AY(((bn.banks[n] || {})[nDef[0]] || []), "last");
      const dates = [...new Set(order.flatMap(n => serOf(n).map(r => r.date)))].sort();
      const colOf = n => { const m = Object.fromEntries(serOf(n).map(r => [r.date, r.val])); return dates.map(dt => m[dt] ?? null); };
      node.dataset.keep = 12;
      mkChart(node, {
        ...CHART_BG,
        tooltip: { trigger: "axis", axisPointer: XP, formatter: ps => `${ps[0].axisValue}<br>` + ps.filter(x => x.data != null).sort((a, b) => b.data - a.data).map(x => `${x.marker}${x.seriesName}: <b>${fmt(x.data, 1)}%</b>`).join("<br>") },
        legend: legOf(order), grid: { left: 44, right: 16, top: 34, bottom: 40 }, xAxis: catX(dates.map(mmy)), yAxis: { type: "value", name: "%", scale: true, ...AX },
        // разрыв 2022–2023 (не раскрывалось) — линия не соединяется через пропуск
        series: order.map((n, i) => ({
          name: n, type: "line", data: colOf(n), symbol: FREQ === "year" ? "circle" : "none", connectNulls: false, lineStyle: { width: 1.8, color: BANK_COL[i % BANK_COL.length] }, itemStyle: { color: BANK_COL[i % BANK_COL.length] },
          markLine: (i === 0 && nDef[2] != null) ? { silent: true, symbol: "none", lineStyle: { color: "#ff6b6b", type: "dashed", width: 1.2 }, label: { formatter: `мин ${nDef[2]}%`, color: "#ff6b6b", fontSize: 9, position: "insideStartTop" }, data: [{ yAxis: nDef[2] }] } : undefined, z: 3,
        })),
      });
    }, { modes: NORMS.map(([k, t]) => [k, t.split(" · ")[0]]), agg: "last" });
  }

  // ═══════════════ ЭКОНОМИКА ═══════════════
  const gNom = gdpq.nominal || [], gGrw = gdpq.growth || [];
  if (gNom.length) C("economy", "ВВП России", "Абс.: номинал (столбики, трлн ₽) + реальный рост (линия) · % г/г: реальный и номинальный рост · Росстат" + (FC.asof ? ` · рамки — прогноз ЦБ роста ВВП за год (${FC.asof})` : ""), 330, (node, mode) => {
    const yr = FREQ === "year";
    const nomS = yr ? annualize(gNom, "sum") : gNom, grwS = yr ? annualize(gGrw, "mean") : gGrw;
    if (mode === "yoy") {
      lineChart(node, [["real", "Реальный рост", "#1fe0a0"], ["nom", "Номинальный рост", "#f5b13c"]], { real: grwS, nom: yoyAny(nomS) }, { unit: "%", dg: 1, zero: true, events: false, ext: futureTo(FC_END, "q") });
      return fcBoxes(node, fcSpans("gdp", "#1fe0a0"), { gran: "q" });
    }
    const dates = [...new Set([...nomS, ...grwS, ...futureTo(FC_END, "q")].map(r => r.date))].sort();
    const mn = Object.fromEntries(nomS.map(r => [r.date, r.val])), mg = Object.fromEntries(grwS.map(r => [r.date, r.val]));
    mkChart(node, {
      ...CHART_BG,
      tooltip: { trigger: "axis", axisPointer: XP, formatter: ps => ps[0].axisValue + "<br>" + ps.filter(p => p.data != null).map(p => `${p.marker}${p.seriesName}: <b>${p.seriesName.includes("рост") ? fmt(p.data, 1) + "%" : fmt(p.data, 1) + " трлн ₽"}</b>`).join("<br>") },
      legend: legOf([yr ? "ВВП за год (трлн ₽)" : "ВВП (трлн ₽)", yr ? "реальный рост за год" : "реальный рост г/г"]), grid: { left: 52, right: 48, top: 34, bottom: 44 },
      xAxis: catX(dates.map(qlab)),
      yAxis: [{ type: "value", name: "трлн ₽", min: 0, ...AX }, { type: "value", name: "%, г/г", position: "right", scale: true, ...AX, splitLine: { show: false }, axisLabel: { color: AXIS_TXT, formatter: "{value}%" } }],
      series: [
        { name: yr ? "ВВП за год (трлн ₽)" : "ВВП (трлн ₽)", type: "bar", data: dates.map(dt => mn[dt] != null ? +(mn[dt] / 1000).toFixed(1) : null), itemStyle: { color: "rgba(91,141,239,.55)" }, z: 1 },
        { name: yr ? "реальный рост за год" : "реальный рост г/г", type: "line", yAxisIndex: 1, data: dates.map(dt => mg[dt] ?? null), symbol: yr ? "circle" : "none", connectNulls: true, lineStyle: { width: 2.4, color: "#1fe0a0" }, itemStyle: { color: "#1fe0a0" }, markLine: zeroLine, z: 3 },
      ],
    });
    fcBoxes(node, fcSpans("gdp", "#1fe0a0", { ax: 1 }), { gran: "q", lblFn: qlab });
  }, { agg: "mean", base: "Кв.", modes: ["abs", "yoy"] });
  const gu = d.gdp_use || {}, gur = gu.real || {}, gun = gu.nominal || {};
  const GU_DEFS = [["hh", "Домохозяйства", "#1fe0a0"], ["gov", "Госуправление", "#c792ea"], ["gfcf", "Инвестиции", "#5b8def"], ["inventories", "Запасы", "#9aa7b0"], ["net_exports", "Чистый экспорт", "#f5913c"]];
  if ((gur.hh || []).length || (gun.hh || []).length) C("economy", "ВВП по использованию", "реальный рост г/г · номинал, трлн ₽ · доли · Росстат (реальные экспорт/импорт не публикуются с 2022)" + (FC.asof ? ` · рамки в «Реальном росте» — прогноз ЦБ (${FC.asof}): ВВП, потребление домохозяйств, инвестиции` : ""), 330, (node, mode) => {
    if (mode !== "real") {
      // статрасхождение = ВВП − сумма компонент (у Росстата его нет отдельной строкой): без него
      // «итого» не равно ВВП, а доли считались от суммы компонент, а не от ВВП
      const gd = Object.fromEntries((gun.gdp || []).map(r => [r.date, r.val]));
      const comp = GU_DEFS.map(([k]) => Object.fromEntries((gun[k] || []).map(r => [r.date, r.val])));
      const disc = Object.keys(gd).sort().map(dt => ({ date: dt, val: comp.every(c => c[dt] != null) ? gd[dt] - comp.reduce((a, c) => a + c[dt], 0) : null }));
      return levelChart(node, mode, [...GU_DEFS, ["disc", "Статрасхождение", "#d9d4c7"]], { ...gun, disc }, { unit: "трлн ₽", div: 1000, dg: 1, kind: "stackbar", lblFn: qlab });
    }
    lineChart(node, [["gdp", "ВВП", "#f5b13c"], ["hh", "Потребление домохозяйств", "#1fe0a0"], ["gov", "Госпотребление", "#c792ea"], ["gfcf", "Инвестиции (осн. капитал)", "#5b8def"], ["exports", "Экспорт", "#8bd450"], ["imports", "Импорт", "#ff6b6b"]], gur, { unit: "%", dg: 1, zero: true, events: false, ext: futureTo(FC_END, "q") });
    fcBoxes(node, [...fcSpans("gdp", "#f5b13c"), ...fcSpans("hh", "#1fe0a0"), ...fcSpans("gfcf", "#5b8def")], { gran: "q" });
  }, { agg: m => (m === "real" ? "mean" : "sum"), base: "Кв.", modes: [["real", "Реальный рост"], "abs", "share"] });
  if ((d.ivbo || []).length) C("economy", "Индекс выпуска базовых отраслей, г/г", "% · месячный прокси ВВП: промышленность, сельское хоз-во, стройка, торговля, транспорт · Росстат", 270, node =>
    barLine(node, { lines: [["Выпуск базовых отраслей", d.ivbo, "#5b8def"]], ul: "%" }), { agg: "mean" });
  const rtl = d.retail || {};
  if ((rtl.total || []).length) C("economy", "Розничная торговля", "оборот, трлн ₽ (продовольственные + непродовольственные) · рост г/г номинальный · Росстат", 300, (node, mode) => mode === "yoy"
    ? levelChart(node, "yoy", [["total", "Всего", "#f5b13c"], ["food", "Продовольственные", "#1fe0a0"], ["nonfood", "Непродовольственные", "#5b8def"]], rtl, {})
    : levelChart(node, mode, [["food", "Продовольственные", "#1fe0a0"], ["nonfood", "Непродовольственные", "#5b8def"]], rtl, { unit: "трлн ₽", div: 1000, dg: 2, kind: "stackbar" }),
    { agg: "sum", modes: ["abs", "yoy", "share"] });
  const wg = d.wages || {};
  if ((wg.nominal || []).length) C("economy", "Зарплаты", "среднемесячная начисленная · % г/г: номинальный и реальный рост (номинал − ИПЦ) · Росстат", 290, (node, mode) => mode === "yoy"
    ? lineChart(node, [["nom", "Номинальный рост", "#f5b13c"], ["real", "Реальный рост", "#1fe0a0"]], { nom: wg.yoy, real: opSeries(wg.yoy, cpiS, (a, b) => ((1 + a / 100) / (1 + b / 100) - 1) * 100) }, { unit: "%", dg: 1, zero: true })
    : levelChart(node, mode, [["x", "Зарплата", "#5b8def"]], { x: wg.nominal }, { unit: "тыс ₽", div: 1000, dg: 1, kind: "bar" }),
    { agg: "mean", modes: ["yoy", "abs"] });
  if ((un.rolling3m || []).length) C("economy", "Безработица", "% рабочей силы 15+ по методологии МОТ · линия — скользящее среднее за 3 месяца (таблицы Росстата, с 2017) · точки — за месяц (ежемесячный доклад Росстата, выходит раньше таблиц) · Росстат", 260, node => {
    lineChart(node, [["x", "Безработица", "#ff6b6b"], ...((un.monthly || []).length ? [["m", "За месяц", "#b71c1c"]] : [])], { x: un.rolling3m, m: un.monthly }, { unit: "%", dg: 1, area: true });
    const i = echarts.getInstanceByDom(node); if (i && (un.monthly || []).length) i.setOption({ series: [{}, { symbol: "circle", symbolSize: 5, lineStyle: { width: 1.2, type: "dotted" }, areaStyle: null }] });
  }, { agg: "mean" });
  const ip = d.industrial || {}, ipl = ip.labels || {};
  if ((ip.total || []).length) C("economy", "Промышленное производство, г/г", "% к тому же месяцу год назад · итог и разделы · Росстат", 290, node =>
    lineChart(node, [["total", "Промышленность", "#f5b13c"], ["mining", "Добыча", "#ff6b6b"], ["manuf", "Обработка", "#5b8def"], ["energy", "Электроэнергия, газ", "#1fe0a0"], ["water", "Водоснабжение", "#9aa7b0"]], ip, { unit: "%", dg: 1, zero: true }), { main: false, agg: "mean" });
  const ipKeys = ["manuf", "food", "oil_ref", "chem", "pharma", "metal", "metal_prod", "electronics", "el_equip", "machinery", "autos", "transport_eq", "mining", "energy"].filter(k => (ip[k] || []).length);
  if (ipKeys.length) C("economy", "Промпроизводство по отраслям — тепловая карта", "% г/г · по месяцам — последние 18 месяцев; «Годы» — рост за год ≈ среднее месячных г/г (текущий год — с начала года) · зелёный — рост, красный — спад · Росстат", 60 + ipKeys.length * 26, node => {
    const yr = FREQ === "year", cy = String(new Date().getFullYear());
    const lastM = Math.max(...ipKeys.map(k => +((ip[k] || []).filter(r => r.date.startsWith(cy)).slice(-1)[0]?.date.slice(5, 7) || 0)));
    const MN = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
    heatRows(node, ipKeys.map(k => [ipl[k] || k, AY(ip[k], "mean")]), yr ? { n: 12, xFn: y => y === cy && lastM && lastM < 12 ? `${y}\n(янв–${MN[lastM - 1]})` : y } : { n: 18 });
  }, { main: false, agg: "mean", base: "Мес." });
  // (убраны по просьбе пользователя: мониторинг предприятий ЦБ, индексы уверенности, цены на жильё, реальная розница по годам, реальные доходы — ряды остаются в API/CSV)

  // ═══════════════ БЮДЖЕТ И ГОСДОЛГ ═══════════════
  // Проект/утверждённый план бюджета — пунктиром; порядок: помесячные графики, затем годовые
  const BP = d.budget_plan || {}, BPm = k => Object.fromEntries((BP[k] || []).map(r => [r.date, r.val]));
  const BP_END = Math.max(new Date().getFullYear(), ...(BP.revenue || []).map(r => +r.date));
  const BP_IS_DRAFT = (BP.status || "").toLowerCase().startsWith("проект");
  const BP_SERIES_LABEL = BP_IS_DRAFT ? "Проект бюджета" : "План по закону о бюджете";
  const BP_NOTE = (BP.revenue || []).length ? ` · пунктир — ${BP.status || ("план по " + (BP.law || "закону о бюджете"))}` : "";
  const BPN = { balance: "дефицит(−)/профицит(+)", revenue: "доходы", spending: "расходы", oilgas: "нефтегазовые доходы", nonoilgas: "ненефтегазовые доходы" };
  const planBoxes = (key, color, div = 1000, perMonth = false, ax = 0) => (BP[key] || []).map(r => ({ y: +r.date, lo: r.val / div / (perMonth && FREQ !== "year" ? 12 : 1), hi: r.val / div / (perMonth && FREQ !== "year" ? 12 : 1), color, ax,
    src: BP_SERIES_LABEL, name: BPN[key] || key, lbl: `${fmt(r.val / 1000, 1)} трлн ₽ за год` + (perMonth && FREQ !== "year" ? ` (≈${fmt(r.val / 12000, 2)} в месяц)` : "") }));
  // последний месяц бюджета может быть из пресс-релиза Минфина «Предварительная оценка…» — помечаем в подсказке
  const NIE = bud.net_internal_debt_est || null;   // чистое размещение ОФЗ: месяцы-оценки (запасной путь)
  const NIS = bud.net_internal_debt_src || null;   // факт по аукционам: с какого месяца, по какую дату
  const notePrelim = node => {
    const pr = bud.prelim, inst = echarts.getInstanceByDom(node); if (!pr || !inst || FREQ === "year") return;
    const lbl = mmy(pr.date), f0 = (((inst.getOption().tooltip || [])[0]) || {}).formatter; if (typeof f0 !== "function") return;
    inst.setOption({ tooltip: { formatter: ps => { const t = f0(ps), a = (Array.isArray(ps) ? ps : [ps])[0]; return a && a.axisValue === lbl ? t + `<div style="margin-top:5px;font-size:11px;opacity:.75">предварительная оценка Минфина${pr.published ? " от " + pr.published : ""} — уточнится в отчёте</div>` : t; } } });
  };
  // LTM по помесячному бюджету: сумма 12 последних месяцев, если последний месяц — позже конца lastFactYear
  const ltmOf = lastFactYear => {
    const rv = (bud.revenue || []).filter(r => r.val != null); if (rv.length < 12) return null;
    const last = rv[rv.length - 1].date; if (!lastFactYear || last <= `${lastFactYear}-12`) return null;
    const sum12 = k => { const r12 = roll12(bud[k] || []); const x = r12.find(r => r.date === last); return x ? x.val : null; };
    const [ly, lm] = last.split("-").map(Number), fy = lm === 12 ? ly : ly - 1, fm = lm === 12 ? 1 : lm + 1;
    const from = `${String(fm).padStart(2, "0")}.${fy}`, to = `${String(lm).padStart(2, "0")}.${ly}`;
    return { key: "LTM", from, to, fromS: `${String(fm).padStart(2, "0")}.${String(fy).slice(2)}`, toS: `${String(lm).padStart(2, "0")}.${String(ly).slice(2)}`,
      prelim: !!(bud.prelim && bud.prelim.date === last), revenue: sum12("revenue"), spending: sum12("spending"), balance: sum12("balance") };
  };
  // годовые столбики с планом: факт — заливкой, план — пунктирной рамкой
  const planBar = (color, plan) => ({ value: plan, itemStyle: { color: color + "22", borderColor: color, borderType: "dashed", borderWidth: 1.5 } });
  if ((ba.revenue || []).length) C("budget", "Федеральный бюджет — годовые итоги", "доходы, расходы и дефицит/профицит по годам · Минфин, с 2006" + BP_NOTE, 330, (node, mode) => {
    if (mode === "abs") {
      const fact = ba.revenue.map(r => r.date), lastFact = fact[fact.length - 1];
      // LTM — сумма последних 12 месяцев (помесячные данные Минфина, последний месяц может быть
      // предварительной оценкой): ставим между последним годом факта и годами плана
      const L = ltmOf(lastFact), planY = (BP.revenue || []).map(r => r.date).filter(y => !fact.includes(y));
      const yrs = [...fact, ...(L ? [L.key] : []), ...planY];
      const ltmYear = (bud.revenue || []).slice(-1)[0]?.date?.slice(0, 4) || "LTM";
      const ltmV = { revenue: L?.revenue, spending: L?.spending, balance: L?.balance };
      const mp = (s, key) => { const m = Object.fromEntries((s || []).map(r => [r.date, r.val])); return yrs.map(y => y === L?.key ? (ltmV[key] != null ? +(ltmV[key] / 1000).toFixed(1) : null) : m[y] != null ? +(m[y] / 1000).toFixed(1) : null); };
      const ltmBar = (v2, color) => ({ value: v2, itemStyle: { color: color + "55", borderColor: color, borderWidth: 1.5 } });
      const withPlan = (s, key, color) => mp(s, key).map((v2, i) => yrs[i] === L?.key ? (v2 != null ? ltmBar(v2, color) : null) : v2 != null ? v2 : (BPm(key)[yrs[i]] != null ? planBar(color, +(BPm(key)[yrs[i]] / 1000).toFixed(1)) : null));
      const planLine = yrs.map(y => y === lastFact ? +(Object.fromEntries(ba.balance.map(r => [r.date, r.val]))[y] / 1000).toFixed(1) : (BPm("balance")[y] != null && planY.includes(y) ? +(BPm("balance")[y] / 1000).toFixed(1) : null));
      const head = ax => ax === L?.key ? `LTM — последние 12 месяцев: ${L.from}–${L.to}${L.prelim ? `<br><span style="opacity:.75">${L.to} — предварительная оценка Минфина${bud.prelim?.published ? " от " + bud.prelim.published : ""}</span>` : ""}` : `${ax}${planY.includes(ax) ? (BP_IS_DRAFT ? " — проект" : " — план") : ""}`;
      return mkChart(node, {
        ...CHART_BG, tooltip: { trigger: "axis", axisPointer: XP, formatter: ps => `${head(ps[0].axisValue)}<br>` + ps.filter(p => p.data != null && (p.data.value ?? p.data) != null && !(p.seriesName.includes("план") && !planY.includes(ps[0].axisValue))).map(p => `${p.marker}${p.seriesName}: <b>${fmt(p.data.value ?? p.data, 1)} трлн ₽</b>`).join("<br>") },
        legend: legOf(["Доходы", "Расходы", "Дефицит/профицит", BP_IS_DRAFT ? "Дефицит — проект" : "Дефицит — план"]), grid: { left: 46, right: 20, top: 34, bottom: 44 },
        xAxis: { type: "category", data: yrs, ...AX, axisLabel: { color: AXIS_TXT, interval: 0, fontSize: 11, lineHeight: 15, formatter: v2 => v2 === L?.key ? ltmYear : v2 } }, yAxis: [{ type: "value", name: "трлн ₽", ...AX }],
        series: [
          { name: "Доходы", type: "bar", data: withPlan(ba.revenue, "revenue", "#1fe0a0"), itemStyle: { color: "rgba(31,224,160,.6)" }, z: 1 },
          { name: "Расходы", type: "bar", data: withPlan(ba.spending, "spending", "#ff6b6b"), itemStyle: { color: "rgba(255,107,107,.6)" }, z: 1 },
          { name: "Дефицит/профицит", type: "line", data: mp(ba.balance, "balance"), symbol: "circle", symbolSize: 5, lineStyle: { width: 2.4, color: "#5b8def" }, itemStyle: { color: "#5b8def" }, markLine: zeroLine, z: 3 },
          { name: BP_IS_DRAFT ? "Дефицит — проект" : "Дефицит — план", type: "line", data: planLine, symbol: "emptyCircle", symbolSize: 6, connectNulls: true, lineStyle: { width: 2, color: "#5b8def", type: "dashed" }, itemStyle: { color: "#5b8def" }, z: 3 },
        ],
      });
    }
    levelChart(node, mode, mode === "yoy" ? [["revenue", "Доходы", "#1fe0a0"], ["spending", "Расходы", "#ff6b6b"]] : [["revenue", "Доходы", "#1fe0a0"], ["spending", "Расходы", "#ff6b6b"], ["balance", "Дефицит/профицит", "#5b8def"]], ba, { lblFn: x => x });
  }, { modes: ["abs", "yoy", "gdp"] });
  if ((bud.balance || []).length) C("budget", "Дефицит / профицит бюджета", "за месяц (млрд ₽, столбики) + сумма за 12 мес (трлн ₽, линия) · «Годы» — итог за год · % ВВП — к ВВП за 4 квартала · Минфин" + (bud.prelim ? ` · ${mmy(bud.prelim.date)} — предварительная оценка Минфина от ${bud.prelim.published || ""}` : "") + BP_NOTE, 320, (node, mode) => {
    const yr = FREQ === "year";
    if (yr) {
      if (mode === "gdp") { levelChart(node, "gdp", [["x", "Дефицит(−)/профицит(+) за год", "#5b8def"]], { x: bud.balance }, { kind: "bar", ext: futureTo(BP_END) }); return; }
      barLine(node, { bars: [["Дефицит(−)/профицит(+) за год", (bud.balance || []).map(r => ({ date: r.date, val: r.val / 1000 })), "#5b8def", "sum"]], ub: "трлн ₽", dgb: 2, colorSign: true, ext: futureTo(BP_END) });
      return fcBoxes(node, planBoxes("balance", "#5b8def"));
    }
    const r12 = roll12(bud.balance);
    if (mode === "gdp") return levelChart(node, "gdp", [["x", "Дефицит(−)/профицит(+) за 12 мес", "#5b8def"]], { x: r12.filter(r => r.val != null) }, { kind: "area" });
    barLine(node, { bars: [["За месяц", bud.balance, "#9aa7b0"]], lines: [["Сумма за 12 мес", r12.map(r => ({ date: r.date, val: r.val == null ? null : r.val / 1000 })), "#5b8def"]], ub: "млрд ₽", ul: "трлн ₽", dgb: 0, dgl: 2, colorSign: true, ext: futureTo(BP_END) });
    fcBoxes(node, planBoxes("balance", "#5b8def", 1000, false, 1));   // план годового дефицита — на шкале «за 12 мес»
    notePrelim(node);
  }, { agg: "sum", modes: ["abs", "gdp"] });
  // (убран по просьбе пользователя: «Доходы и расходы по месяцам» — ряды остаются в API/CSV; по годам с планом — в «Годовых итогах»)
  if ((bud.net_internal_debt || []).length) C("budget", "Чистое размещение ОФЗ", NIS
      ? `размещение − погашение · за месяц (млрд ₽) + сумма за 12 мес (трлн ₽) · предложение ОФЗ на рынке · с 2021 г. — факт по аукционам: выручка аукционов и ДРПА (результаты Минфина) минус погашения и амортизация ОФЗ (Мосбиржа), по ${dmy(NIS.asof)}; сверка с сальдо внутреннего долга из отчёта Минфина об исполнении бюджета — медианная разница ${fmt(NIS.check_median, 0)} млрд ₽ в месяц (${NIS.check_months} мес.) · до 2021 г. — отчёт Минфина · в «Годах»: текущий год — с начала года, пунктир — ${BP_IS_DRAFT ? "проект" : "план"} чистых госзаимствований`
      : `сальдо внутреннего долга (размещение − погашение) · за месяц (млрд ₽) + сумма за 12 мес (трлн ₽) · предложение ОФЗ на рынке · Минфин · в «Годах»: текущий год — с начала года, пунктир — ${BP_IS_DRAFT ? "проект" : "план"} чистых госзаимствований · последние месяцы, которых ещё нет в отчёте Минфина об исполнении бюджета, — оценка: изменение госдолга в ОФЗ по номиналу (Минфин, на 1-е число) − дисконт на аукционах − средняя невязка (сверка с отчётом: ±30 млрд в месяц); на графике — бледным с пунктиром`, 300, (node, mode) => {
    if (FREQ === "year") {
      if (mode === "gdp") return levelChart(node, "gdp", [["x", "Чистое размещение за год", "#1fe0a0"]], { x: bud.net_internal_debt }, { kind: "bar" });
      // полные годы + текущий год «с начала года» (N мес) + план по закону о бюджете (пунктиром поверх)
      const nd = (bud.net_internal_debt || []).filter(r => r.val != null), ann = Object.fromEntries(annualize(nd, "sum").map(r => [r.date, r.val]));
      const lastD = nd.length ? nd[nd.length - 1].date : "", ytdY = lastD.slice(0, 4), ytdN = +lastD.slice(5, 7);
      const ytd = ann[ytdY] == null && ytdY ? nd.filter(r => r.date.startsWith(ytdY)).reduce((a, r) => a + r.val, 0) : null;
      const plan = BPm("net_borrowing"), yrs = [...new Set([...Object.keys(ann), ...(ytd != null ? [ytdY] : []), ...Object.keys(plan)])].sort();
      const MN = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
      return mkChart(node, {
        ...CHART_BG,
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: ps => { const y = ps[0].axisValue; let t = `<b>${y}</b>`;
          if (ann[y] != null) t += `<br>чистое размещение за год: <b>${fmt(ann[y] / 1000, 2)} трлн ₽</b>`;
          if (y === ytdY && ytd != null && NIS) t += `<br>факт с начала года по ${dmy(NIS.asof)}: <b>${fmt(ytd / 1000, 2)} трлн ₽</b><br><span style="opacity:.75">выручка аукционов и ДРПА Минфина минус погашения и амортизация ОФЗ</span>`;
          else if (y === ytdY && ytd != null) t += `<br>факт за январь–${MN[ytdN - 1]}: <b>${fmt(ytd / 1000, 2)} трлн ₽</b>` + (NIE && NIE.from.startsWith(y) ? `<br><span style="opacity:.75">${MN[+NIE.from.slice(5) - 1]}${NIE.to !== NIE.from ? "–" + MN[+NIE.to.slice(5) - 1] : ""} — оценка: в отчёте Минфина об исполнении бюджета сальдо пока по ${MN[+NIE.from.slice(5) - 2] || "декабрь"}; считаем по изменению госдолга в ОФЗ минус дисконт на аукционах (точность ±30 млрд в месяц)</span>` : "");
          if (plan[y] != null) t += `<br>${BP_IS_DRAFT ? "проект" : "план"} на год: <b>${fmt(plan[y] / 1000, 2)} трлн ₽</b><br><span style="opacity:.75">чистое привлечение через ОФЗ: размещение минус погашение</span>` + (y === ytdY && ytd != null ? `<br>выполнено: <b>${fmt(ytd / plan[y] * 100, 0)}%</b> ${BP_IS_DRAFT ? "к проекту" : "плана"} ${NIS && NIS.partial ? "на " + dmy(NIS.asof) : "за " + ytdN + " мес."}` : "");
          return t; } },
        legend: legOf(["Факт", BP_SERIES_LABEL]), grid: { left: 50, right: 20, top: 34, bottom: 50 },
        xAxis: { type: "category", data: yrs, ...AX, axisLabel: { color: AXIS_TXT, lineHeight: 15, formatter: y => y === ytdY && ytd != null ? (NIS && NIS.partial ? `${y}\nпо ${NIS.asof.slice(8)}.${NIS.asof.slice(5, 7)}` : `${y}\n${ytdN} мес`) : y } },
        yAxis: { type: "value", name: "трлн ₽", ...AX },
        series: [
          { name: "Факт", type: "bar", barWidth: "58%", z: 2, itemStyle: { color: "#1fe0a0" },
            data: yrs.map(y => ann[y] != null ? +(ann[y] / 1000).toFixed(2) : (y === ytdY && ytd != null ? { value: +(ytd / 1000).toFixed(2), itemStyle: { color: "#1fe0a0aa" } } : null)),
            label: { show: true, position: "top", color: AXIS_TXT, fontSize: 9, formatter: p => fmt(p.value, 1) } },
          { name: BP_SERIES_LABEL, type: "bar", barWidth: "58%", barGap: "-100%", z: 3, itemStyle: { color: "#1fe0a0" },
            data: yrs.map(y => plan[y] != null ? planBar("#1fe0a0", +(plan[y] / 1000).toFixed(2)) : null),
            label: { show: true, position: "top", color: "#12a877", fontSize: 10, fontWeight: 600, formatter: p => `${BP_IS_DRAFT ? "проект" : "план"} ${fmt(p.value, 1)}` } },
        ],
      });
    }
    const r12 = roll12(bud.net_internal_debt);
    if (mode === "gdp") return levelChart(node, "gdp", [["x", "Чистое размещение за 12 мес", "#1fe0a0"]], { x: r12.filter(r => r.val != null) }, { kind: "area" });
    barLine(node, { bars: [["За месяц", bud.net_internal_debt, "#1fe0a0"]], lines: [["Сумма за 12 мес", r12.map(r => ({ date: r.date, val: r.val == null ? null : r.val / 1000 })), "#5b8def"]], ub: "млрд ₽", ul: "трлн ₽", dgb: 0, dgl: 2 });
    // месяцы-оценки (ещё нет в отчёте Минфина) — бледные столбики с пунктиром и пометкой в подсказке
    const inst = echarts.getInstanceByDom(node), estM = new Set((bud.net_internal_debt || []).filter(r => r.est).map(r => mmy(r.date)));
    const partM = NIS && NIS.partial ? mmy(NIS.partial) : null;
    if (inst && partM) {
      const o = inst.getOption(), xs = o.xAxis[0].data, f0 = o.tooltip[0].formatter;
      inst.setOption({ series: [{ data: o.series[0].data.map((v2, i) => xs[i] === partM && v2 != null ? { value: v2.value ?? v2, itemStyle: { color: "#1fe0a066", borderColor: "#1fe0a0", borderType: "dashed", borderWidth: 1.2 } } : v2) }],
        tooltip: { formatter: ps => { const t = f0(ps), a = (Array.isArray(ps) ? ps : [ps])[0]; return a && a.axisValue === partM ? t + `<div style="margin-top:5px;font-size:11px;opacity:.75">месяц не закончен: аукционы и погашения по ${dmy(NIS.asof)}</div>` : t; } } });
    }
    if (inst && estM.size) {
      const o = inst.getOption(), xs = o.xAxis[0].data, f0 = o.tooltip[0].formatter;
      inst.setOption({ series: [{ data: o.series[0].data.map((v2, i) => estM.has(xs[i]) && v2 != null ? { value: v2.value ?? v2, itemStyle: { color: "#1fe0a055", borderColor: "#1fe0a0", borderType: "dashed", borderWidth: 1.2 } } : v2) }],
        tooltip: { formatter: ps => { const t = f0(ps), a = (Array.isArray(ps) ? ps : [ps])[0]; return a && estM.has(a.axisValue) ? t + `<div style="margin-top:5px;font-size:11px;opacity:.75">оценка: изменение госдолга в ОФЗ по номиналу (Минфин) − дисконт на аукционах; в отчёте об исполнении бюджета месяца ещё нет</div>` : t; } } });
    }
  }, { agg: "sum", modes: ["abs", "gdp"] });
  if ((BP.gross_borrowing || []).length) C("budget", "Программа внутренних заимствований — проект бюджета", `размещение ОФЗ, погашение и чистое привлечение · трлн ₽ · законопроект № 615-9 от 30.09.2026 · источник: материалы Госдумы`, 280, node => {
    const yrs = (BP.gross_borrowing || []).map(r => r.date), gross = BPm("gross_borrowing"), red = BPm("debt_redemption"), net = BPm("net_borrowing");
    const issueLines = y => {
      const issues = [...(((MACRO.ofzRedemption || {}).issues || {})[y] || [])]
        .filter(x => +(x.vol_bln || 0) >= .05)
        .sort((a, b) => String(a.matdate).localeCompare(String(b.matdate)));
      if (!issues.length) return "";
      const sum = issues.reduce((s, x) => s + +(x.vol_bln || 0), 0);
      return `<div style="border-top:1px solid rgba(127,127,127,.28);margin-top:7px;padding-top:6px">
        <div style="font-size:11px;opacity:.72;margin-bottom:3px">Выпуски к погашению · ${issues.length} шт. · ${fmt(sum / 1000, 2)} трлн ₽ в обращении</div>
        <div style="font-size:11px;line-height:1.55">${issues.map(x => `<b>${escA(x.name || x.isin)}</b> · ${dmy(x.matdate)} · ${escA(String(x.type || "").replace("ОФЗ-", ""))} · <b>${fmt(x.vol_bln, x.vol_bln < 10 ? 1 : 0)} млрд ₽</b>`).join("<br>")}</div>
      </div>`;
    };
    mkChart(node, {
      ...CHART_BG,
      tooltip: { trigger: "axis", axisPointer: XP, formatter: ps => { const y = ps[0].axisValue;
        return `<div style="font-weight:600;margin-bottom:3px">${y}</div>`
          + `${ps[0]?.marker || ""}Размещение: <b>${fmt(gross[y] / 1000, 3)} трлн ₽</b><br>`
          + `${ps[1]?.marker || ""}Погашение: <b>${fmt(red[y] / 1000, 3)} трлн ₽</b><br>`
          + `${ps[2]?.marker || ""}Чистое привлечение: <b>${fmt(net[y] / 1000, 3)} трлн ₽</b>`
          + issueLines(y); } },
      legend: legOf(["Размещение", "Погашение", "Чистое привлечение"]), grid: { left: 48, right: 20, top: 34, bottom: 30 },
      xAxis: { type: "category", data: yrs, ...AX, axisLabel: { color: AXIS_TXT } }, yAxis: { type: "value", name: "трлн ₽", ...AX },
      series: [
        { name: "Размещение", type: "bar", data: yrs.map(y => gross[y] / 1000), itemStyle: { color: "#5b8def" }, barMaxWidth: 34 },
        { name: "Погашение", type: "bar", data: yrs.map(y => red[y] / 1000), itemStyle: { color: "#9aa7b0" }, barMaxWidth: 34 },
        { name: "Чистое привлечение", type: "line", data: yrs.map(y => net[y] / 1000), symbol: "circle", symbolSize: 7, lineStyle: { width: 2.4, color: "#1fe0a0" }, itemStyle: { color: "#1fe0a0" },
          label: { show: true, position: "top", offset: [12, 0], align: "left", color: AXIS_TXT, formatter: p => fmt(p.value, 1) } },
      ],
    });
  });
  const gd = d.gov_debt || {};
  if ((gd.total || []).length) C("budget", "Госдолг РФ (внутренний)", "ОФЗ и прочие бумаги/кредиты + госгарантии · на конец месяца (Минфин публикует на 1-е число следующего) · Минфин · расходы на его обслуживание Минфин с 2022 г. помесячно не раскрывает", 300, (node, mode) =>
    levelChart(node, mode, [["securities", "Ценные бумаги и кредиты (в осн. ОФЗ)", "#5b8def"], ["guarantees", "Госгарантии", "#f5c542"]], gd, { unit: "трлн ₽", div: 1000, dg: 1, kind: "stack" }),
    { agg: "last", modes: ["abs", "yoy", "gdp", "share"] });
  const _nwf = d.nwf || {};
  if ((_nwf.volume || []).length) C("budget", "Фонд национального благосостояния (ФНБ)", "подушка бюджета · Минфин", 290, (node, mode) => mode === "gdp"
    ? lineChart(node, [["x", "ФНБ, % ВВП", "#f5913c"]], { x: (_nwf.pct_gdp || []).map(r => ({ date: r.date, val: r.val * 100 })) }, { unit: "%", dg: 1, area: true })
    : levelChart(node, mode, [["x", "Объём ФНБ", "#1fe0a0"]], { x: _nwf.volume }, { unit: "трлн ₽", div: 1000, dg: 2, kind: "area" }),
    { agg: "last", modes: ["abs", "yoy", "gdp"] });
  if ((ba.oilgas || []).length) C("budget", "Структура доходов по годам", "нефтегазовые и ненефтегазовые · Минфин" + BP_NOTE, 300, (node, mode) => {
    if (mode !== "abs") return levelChart(node, mode, [["oilgas", "Нефтегазовые", "#f5913c"], ["nonoilgas", "Ненефтегазовые", "#5b8def"]], ba, { unit: "трлн ₽", div: 1000, dg: 2, kind: "stackbar", lblFn: x => x });
    const fact = ba.oilgas.map(r => r.date), planY = (BP.oilgas || []).map(r => r.date).filter(y => !fact.includes(y)), yrs = [...fact, ...planY];
    const col2 = (s, key, color) => { const m = Object.fromEntries((s || []).map(r => [r.date, r.val])); return yrs.map(y => m[y] != null ? +(m[y] / 1000).toFixed(2) : (BPm(key)[y] != null ? planBar(color, +(BPm(key)[y] / 1000).toFixed(2)) : null)); };
    mkChart(node, {
      ...CHART_BG, tooltip: { trigger: "axis", axisPointer: XP, formatter: ps => { const vals = ps.map(p => p.data?.value ?? p.data).filter(v2 => v2 != null); const tot = vals.reduce((a, b) => a + b, 0); return `${ps[0].axisValue}${planY.includes(ps[0].axisValue) ? (BP_IS_DRAFT ? " — проект" : " — план") : ""}<br>` + ps.filter(p => (p.data?.value ?? p.data) != null).map(p => `${p.marker}${p.seriesName}: <b>${fmt(p.data.value ?? p.data, 2)} трлн ₽</b> (${fmt((p.data.value ?? p.data) / tot * 100, 0)}%)`).join("<br>") + `<br>итого: <b>${fmt(tot, 2)} трлн ₽</b>`; } },
      legend: legOf(["Нефтегазовые", "Ненефтегазовые"]), grid: { left: 46, right: 20, top: 34, bottom: 30 },
      xAxis: { type: "category", data: yrs, ...AX, axisLabel: { color: AXIS_TXT } }, yAxis: [{ type: "value", name: "трлн ₽", ...AX }],
      series: [
        { name: "Нефтегазовые", type: "bar", stack: "d", data: col2(ba.oilgas, "oilgas", "#f5913c"), itemStyle: { color: "#f5913c" }, z: 1 },
        { name: "Ненефтегазовые", type: "bar", stack: "d", data: col2(ba.nonoilgas, "nonoilgas", "#5b8def"), itemStyle: { color: "#5b8def" }, z: 1 },
      ],
    });
  }, { modes: ["abs", "share", "yoy", "gdp"] });

  // ═══════════════ ВНЕШНИЙ СЕКТОР ═══════════════
  if ((fxd.usd || []).length) C("external", "Курс рубля", "на конец месяца · ₽ за единицу · «Годы» — средний курс за год · % г/г: >0 — рубль слабее · ЦБ РФ", 290, (node, mode) =>
    levelChart(node, mode, [["usd", "Доллар США", "#5b8def"], ["eur", "Евро", "#f5b13c"], ["cny", "Юань", "#ff6b6b"]], fxd, { unit: "₽", dg: 2 }), { agg: "mean", modes: ["abs", "yoy"] });
  const tr = d.trade || {};
  if ((tr.exports || []).length) C("external", "Внешняя торговля товарами", "экспорт и импорт (линии) + сальдо (столбики), млрд $ · методология платёжного баланса · ЦБ РФ" + (FC.asof ? ` · рамки — прогноз ЦБ (${FC.asof}): экспорт и импорт товаров, в месячном режиме — в среднем за месяц` : ""), 310, (node, mode) => {
    if (mode === "yoy") return levelChart(node, "yoy", [["exports", "Экспорт", "#1fe0a0"], ["imports", "Импорт", "#ff6b6b"]], tr, {});
    barLine(node, { bars: [["Сальдо", tr.balance, "#5b8def"]], lines: [["Экспорт", tr.exports, "#1fe0a0"], ["Импорт", tr.imports, "#ff6b6b"]], ub: "млрд $", ul: "млрд $", dgb: 1, colorSign: true, signColors: ["rgba(91,141,239,.7)", "#f5913c"], ext: futureTo(FC_END) });
    const per = FREQ === "year" ? 1 : 12;
    fcBoxes(node, [...fcSpans("exports_usd", "#1fe0a0", { div: per }), ...fcSpans("imports_usd", "#ff6b6b", { div: per })]);
  }, { agg: "sum", modes: ["abs", "yoy"] });
  if (ca.length) C("external", "Платёжный баланс — счёт текущих операций", "сальдо · млрд $ · квартал · «Годы» — за год · ЦБ РФ" + (FC.asof ? ` · рамки — прогноз ЦБ (${FC.asof}), в квартальном режиме — в среднем за квартал` : ""), 290, node => {
    const yr = FREQ === "year", QM = ["01", "04", "07", "10"];
    const qL = s => { const [y, m] = s.split("-"); return `${{ "01": "I", "04": "II", "07": "III", "10": "IV" }[m] || m} кв. ${y.slice(2)}`; };
    // квартальные даты ЦБ — 'ГГГГ-01/04/07/10': для годовой свёртки нужен признак квартала
    const caQ = ca.map(r => ({ date: `${r.date.slice(0, 4)}-Q${QM.indexOf(r.date.slice(5, 7)) + 1}`, val: r.val }));
    const S2 = yr ? annualize(caQ, "sum") : ca;
    const fut = [];
    for (let y = new Date().getFullYear(); y <= FC_END; y++) { if (yr) fut.push(String(y)); else QM.forEach(m => fut.push(`${y}-${m}`)); }
    const dates = [...new Set([...S2.map(r => r.date), ...fut])].sort(), mv = Object.fromEntries(S2.map(r => [r.date, r.val]));
    const estCA = new Set(ca.filter(r => r.est).map(r => r.date));
    const lbl = dt => /^\d{4}$/.test(dt) ? dt : qL(dt);
    mkChart(node, {
      ...CHART_BG, tooltip: { trigger: "axis", formatter: ps => `${ps[0].axisValue}` + ((ps[0].data?.value ?? ps[0].data) != null ? `<br>сальдо: <b>${fmt((ps[0].data.value ?? ps[0].data) / 1000, 1)} млрд $</b>` : "")
        + (!yr && estCA.has(dates[ps[0].dataIndex]) ? `<div style="margin-top:4px;font-size:11px;opacity:.75">предварительная оценка ЦБ («Оценка платёжного баланса»)</div>` : "") },
      grid: { left: 48, right: 18, top: 16, bottom: 40 }, xAxis: { type: "category", data: dates.map(lbl), ...AX, axisLabel: { color: AXIS_TXT, hideOverlap: true } },
      yAxis: { type: "value", name: "млрд $", scale: true, ...AX, axisLabel: { color: AXIS_TXT, formatter: val => fmt(val / 1000, 0) } },
      series: [{ name: "Сальдо тек. операций", type: "bar", data: dates.map(dt => mv[dt] != null ? { value: mv[dt], itemStyle: { color: mv[dt] >= 0 ? "#1fe0a0" : "#ff6b6b", ...(estCA.has(dt) && !yr ? { opacity: 0.55, borderType: "dashed", borderColor: "#1fe0a0", borderWidth: 1 } : {}) } } : null), z: 2 }],
    });
    fcBoxes(node, fcSpans("current_account", "#1fe0a0").map(b => ({ ...b, lo: b.lo * 1000 / (yr ? 1 : 4), hi: b.hi * 1000 / (yr ? 1 : 4) })), { gran: "q", lblFn: s => { const m = /^(\d{4})-Q(\d)$/.exec(s); return m ? qL(`${m[1]}-${QM[+m[2] - 1]}`) : s; } });
  }, { agg: "sum", base: "Кв." });
  if ((rsv.total || []).length) C("external", "Международные резервы РФ", "млрд $ · валютные + монетарное золото · на конец месяца (ЦБ публикует на 1-е число следующего) · недельные — на дату · ЦБ РФ", 300, (node, mode) => {
    if (mode === "week") {
      const s = rsv.weekly || [], xs = s.map(r => r.date.slice(8, 10) + "." + r.date.slice(5, 7) + "." + r.date.slice(2, 4));
      return mkChart(node, {
        ...CHART_BG, tooltip: { trigger: "axis", formatter: ps => `${ps[0].axisValue}<br>резервы: <b>${fmt(ps[0].data, 1)} млрд $</b>` },
        grid: { left: 46, right: 18, top: 16, bottom: 40 }, xAxis: { type: "category", data: xs, ...AX, axisLabel: { color: AXIS_TXT, interval: Math.ceil(xs.length / 10) } },
        yAxis: { type: "value", name: "млрд $", scale: true, ...AX },
        series: [{ name: "Резервы", type: "line", data: s.map(r => r.val), symbol: "none", lineStyle: { width: 2.2, color: "#f5c542" }, itemStyle: { color: "#f5c542" }, areaStyle: { color: "rgba(245,197,66,.08)" }, z: 2 }],
      });
    }
    levelChart(node, mode, [["fx", "Валютные резервы", "#5b8def"], ["gold", "Монетарное золото", "#f5c542"]], rsv, { unit: "млрд $", dg: 1, kind: "stack" });
  }, { agg: "last", modes: ["abs", "share", "yoy", ["week", "Понедельно"]] });
  const ed = d.ext_debt || {};
  if ((ed.total || []).length) C("external", "Внешний долг РФ", "госуправление / ЦБ и банки / прочие секторы · на конец квартала (ЦБ публикует на 1-е число следующего квартала; последняя точка может быть предварительной оценкой ЦБ) · ЦБ РФ", 290, (node, mode) =>
    { levelChart(node, mode, [["gov", "Госуправление", "#c792ea"], ["banks", "ЦБ и банки", "#5b8def"], ["other", "Прочие секторы", "#f5913c"]], ed, { unit: "млрд $", dg: 1, kind: "stack" });
      const i = echarts.getInstanceByDom(node), estD = new Set((ed.total || []).filter(r => r.est).map(r => mmy(r.date)));
      if (i && estD.size && FREQ !== "year") { const f0 = i.getOption().tooltip[0].formatter;
        i.setOption({ tooltip: { formatter: ps => { const t = f0(ps), a = (Array.isArray(ps) ? ps : [ps])[0]; return a && estD.has(a.axisValue) ? t + `<div style="margin-top:4px;font-size:11px;opacity:.75">предварительная оценка ЦБ${ed.est_updated ? " от " + ed.est_updated : ""}</div>` : t; } } }); } },
    { main: false, agg: "last", base: "Кв.", modes: ["abs", "share", "yoy"] });
  // (убраны по просьбе пользователя: эффективный курс рубля, прямые и портфельные инвестиции — ряды остаются в API/CSV)

  // ═══════════════ ОТРИСОВКА: главное → «Подробнее» (рисуется только при раскрытии) ═══════════════
  // все графики раздела открыты сразу (без «Подробнее» — просьба пользователя): сначала главные, затем остальные
  const mine = REG.filter(c => c.sec === sub);
  [...mine.filter(c => c.main), ...mine.filter(c => !c.main)].forEach(c => drawPanel(v, c));

  v.appendChild(el(`<div class="muted" style="font-size:11px;margin-top:20px;line-height:1.5">Источники: ЦБ РФ (ставки, RUONIA, ИПЦ, базовая и устойчивая инфляция — таблицы PDF «Инфляция в России» и «Аналитические показатели ценовой динамики», денежные агрегаты, кредит экономике, ликвидность, финансы населения и компаний, банки — формы 102/135, курс, резервы, внешний долг, торговля, платёжный баланс, мониторинг предприятий), Росстат (ВВП, промпроизводство, розница, зарплаты, доходы, безработица, недельный и месячный ИПЦ, цены производителей и на жильё, индексы уверенности), Минфин (бюджет, ФНБ), MOEX ISS (индексы, капитализация), инФОМ (ожидания), World Bank (кап/ВВП, госдолг). Режим «% ВВП» — к номинальному ВВП за последние 4 квартала (Росстат). Все ряды — в «Экспорт CSV».</div>`));
}

async function renderAuctions(v) {
  if (AUC.data == null && !AUC.loading) {
    AUC.loading = true;
    v.appendChild(el(`<div class="loading">Загружаю аукционы Минфина и профиль погашения…</div>`));
    try {
      const [a, r, c, o] = await Promise.all([
        fetch(`${API}/api/auctions`).then(x => x.json()),
        fetch(`${API}/api/ofz_redemption`).then(x => x.json()),
        fetch(`${API}/api/instrument/gcurve`).then(x => x.json()).catch(() => null),
        fetch(`${API}/api/universe?sectors=${encodeURIComponent("Госбумаги и регионы")}&kinds=fixed&clean=true&limit=200`).then(x => x.json()).catch(() => null),
      ]);
      AUC.data = a.auctions || []; AUC.red = r; AUC.curve = c;
      fetch(`${API}/api/ofz_curve`).then(x => x.ok ? x.json() : null).then(j => { AUC.rois = j && j.roisfix; AUC.sdfi = (j && j.swaps && j.swaps.curves) || []; if (TAB === "auctions" && (AUC.rois || AUC.sdfi.length)) render(); }).catch(() => {});
      // реальные ОФЗ-ПД (фикс-купон, серия 26xxx) для точек на кривой КБД —
      // без АД (SU46/48), линкеров (SU52) и флоатеров (SU29): у них своя доходность
      AUC.ofz = (o?.rows || []).filter(b => (b.secid || "").startsWith("SU26") && b.ytm != null && b.duration_years != null);
    } catch (e) { AUC.data = []; AUC.red = null; }
    AUC.loading = false; return render();
  }
  if (AUC.loading) { v.appendChild(el(`<div class="loading">Загружаю…</div>`)); return; }
  const all = AUC.data || [];
  if (!all.length) { v.appendChild(el(`<div class="panel"><h3>Аукционы ОФЗ</h3><div class="alert warn">Не удалось загрузить данные Минфина. Попробуйте позже.</div></div>`)); return; }

  const AUC_TYPES = ["ОФЗ-ПД", "ОФЗ-ПК", "ОФЗ-ИН", "ОФЗ-АД"];
  const typeCount = {}; all.forEach(r => { const t = (r.type || "").trim(); if (t) typeCount[t] = (typeCount[t] || 0) + 1; });
  let rows = AUC.type === "all" ? all : all.filter(r => (r.type || "").trim() === AUC.type);
  // «Доходн. / SM»: у ОФЗ-ПК в колонке SM (б.п.), у остальных доходность (%) — несравнимые единицы:
  // сортируем внутри своей группы (сначала доходности, затем SM), пустые — вниз
  const isPK = r => (r.type || "").includes("ПК");
  const sv = r => AUC.sort === "wa_yield" ? (isPK(r) ? r.sm_bp : r.wa_yield)
    : AUC.sort === "cur_yield" ? (isPK(r) ? r.cur_sm_bp : r.cur_ytm)
    : AUC.sort === "pre" ? (isPK(r) ? r.pre_sm_bp : r.pre_ytm) : r[AUC.sort];
  const mixed = AUC.sort === "wa_yield" || AUC.sort === "cur_yield" || AUC.sort === "pre";
  rows = [...rows].sort((a, b) => {
    const x = sv(a), y = sv(b); if (x == null) return 1; if (y == null) return -1;
    if (mixed && isPK(a) !== isPK(b)) return isPK(a) ? 1 : -1;
    return (x > y ? 1 : x < y ? -1 : 0) * (AUC.desc ? -1 : 1);
  });

  const typeChips = `<span class="chip ${AUC.type === "all" ? "on" : ""}" data-t="all">Все <span class="muted">${all.length}</span></span>`
    + AUC_TYPES.filter(t => typeCount[t]).map(t => `<span class="chip ${AUC.type === t ? "on" : ""}" data-t="${t}">${t} <span class="muted">${typeCount[t]}</span></span>`).join("");
  const head = el(`<div class="panel"><h3>Аукционы ОФЗ <span class="muted" style="font-weight:400;font-size:12px">· Минфин · ${all.length} аукционов за ${dmy(all[all.length - 1].date).slice(6)}–${dmy(all[0].date).slice(6)}</span></h3>
    <div class="chips" style="margin-top:8px">${typeChips}</div>
    <div class="chips" style="margin-top:10px">
      <span class="chip ${AUC.metric === "demand" ? "on" : ""}" data-m="demand">Спрос</span>
      <span class="chip ${AUC.metric === "placed" ? "on" : ""}" data-m="placed">Размещено</span>
    </div>
    <div class="chips" style="margin-top:6px">
      <span class="chip ${AUC.gran === "month" ? "on" : ""}" data-g="month">по месяцам</span>
      <span class="chip ${AUC.gran === "week" ? "on" : ""}" data-g="week">по неделям</span>
    </div>
    <div class="chart" id="auc-chart" style="height:230px;margin-top:10px"></div></div>`);
  // Кривая бескупонной доходности (КБД) — G-curve MOEX + свопы на RUONIA (ROISfix НФА) + сравнение с прошлой датой
  const curveTenors = AUC.curve && (AUC.curve.tenors || AUC.curve.curve || []);
  if (curveTenors && curveTenors.length) {
    const isoAgo = (m, y) => { const d = new Date(); d.setMonth(d.getMonth() - m); d.setFullYear(d.getFullYear() - y); return d.toISOString().slice(0, 10); };
    const PRE = [["", "Сегодня"], [isoAgo(1, 0), "Месяц назад"], [isoAgo(0, 1), "Год назад"]];
    const cmp = AUC.cmp, cd = cmp && cmp.kbd && cmp.kbd.tradedate;
    const kp = el(`<div class="panel"><h3>Кривая бескупонной доходности (КБД) <span class="muted" style="font-weight:400;font-size:12px">· гособлигации РФ · точки — реальные ОФЗ-ПД${AUC.swaps ? " · оранжевая — свопы на RUONIA (ROISfix, до 2 лет)" + ((AUC.sdfi || []).length ? " · длинные свопы — кривые СПФИ Мосбиржи" : "") : ""}</span></h3>
      <div class="chips" id="kbd-when" style="margin-bottom:8px;align-items:center">
        ${PRE.map(([d, l]) => `<span class="chip ${(AUC.cmpDate || "") === d ? "on" : ""}" data-d="${d}">${l}</span>`).join("")}
        <input type="date" id="kbd-date" value="${AUC.cmpDate || ""}" max="${new Date().toISOString().slice(0, 10)}" min="2014-01-01" style="font-size:12px;padding:4px 8px">
        <span class="chip ${AUC.swaps ? "on" : ""}" id="kbd-swaps" style="margin-left:10px" title="Фиксинг НФА ставок OIS на RUONIA: 1 нед … 2 года; при входе MOEX Passport — кривые свопов СПФИ до 10 лет">Свопы</span>
        ${AUC.cmpLoading ? `<span class="muted" style="font-size:11px">загружаю…</span>` : ""}
      </div>
      <div class="chart" id="kbd-chart" style="height:280px"></div><div id="kbd-delta" class="muted" style="font-size:11.5px;margin-top:6px"></div></div>`);
    v.appendChild(kp);
    const toPts = ten => (ten || []).map(t => [t.period_years ?? t.tenor ?? t.years, t.yield_pct ?? t.yield ?? t.value]).filter(p => p[0] != null && p[1] != null);
    const pts = toPts(curveTenors);
    const ofzPts = (AUC.ofz || []).map(b => ({ value: [b.duration_years, b.ytm], name: b.name, isin: b.isin }));
    const roisPts = t => (t || []).map(x => ({ value: [x.period_years, x.yield_pct], tenor: x.tenor, rate: x.rate }));
    const cdTxt = cd ? dmy(cd) : "";
    const series = [
      { name: "КБД", type: "line", smooth: true, symbol: "none", data: pts, color: "#5b8def", lineStyle: { width: 2.5, color: "#5b8def" }, itemStyle: { color: "#5b8def" }, areaStyle: { color: "rgba(91,141,239,.06)" }, silent: true, z: 2 },
      ...(ofzPts.length ? [{ name: "ОФЗ", type: "scatter", symbolSize: 11, data: ofzPts, itemStyle: { color: "#1fe0a0", opacity: .85 }, emphasis: { scale: 1.4 }, cursor: "pointer", z: 5 }] : []),
    ];
    if (cmp && cd) {
      series.push({ name: `КБД ${cdTxt}`, type: "line", smooth: true, symbol: "none", data: toPts(cmp.kbd.tenors), color: "#9aa7b0", lineStyle: { width: 2, type: "dashed", color: "#9aa7b0" }, silent: true, z: 1 });
      series.push({ name: `ОФЗ ${cdTxt}`, type: "scatter", symbolSize: 9, data: (cmp.ofz || []).map(b => ({ value: [b.duration_years, b.ytm], name: b.name })), itemStyle: { color: "transparent", borderColor: "#9aa7b0", borderWidth: 1.5 }, z: 4 });
    }
    if (AUC.swaps && AUC.rois && AUC.rois.tenors) series.push({ name: "Свопы RUONIA", type: "line", symbol: "circle", symbolSize: 6, data: roisPts(AUC.rois.tenors), color: "#f5913c", lineStyle: { width: 2, color: "#f5913c" }, itemStyle: { color: "#f5913c" }, z: 3 });
    // длинные свопы Мосбиржи (СПФИ): IRS на ключевую, OIS на RUONIA, IRS RUSFAR 3M — до 10 лет
    const SDFI_C = { "RUB-IRS-KEYRTE": "#9a8bff", "RUB-OIS-RUONIA": "#ffb86b", "RUB-IRS-RUSF3M": "#ff7eb6" };
    if (AUC.swaps) (AUC.sdfi || []).forEach(c => series.push({ name: c.title, type: "line", symbol: "circle", symbolSize: 5, sdfi: true,
      data: c.tenors.map(x => ({ value: [x.period_years, x.yield_pct], tenor: x.tenor, src: `${c.title} · СПФИ Мосбиржи · ${dmy(c.date)}` })),
      color: SDFI_C[c.id] || "#c792ea", lineStyle: { width: 2, color: SDFI_C[c.id] || "#c792ea" }, itemStyle: { color: SDFI_C[c.id] || "#c792ea" }, z: 3 }));
    if (AUC.swaps && cmp && cmp.swaps) (cmp.swaps.curves || []).forEach(c => series.push({ name: `${c.title} ${dmy(c.date)}`, type: "line", symbol: "none",
      data: c.tenors.map(x => ({ value: [x.period_years, x.yield_pct], tenor: x.tenor, src: `${c.title} · ${dmy(c.date)}` })),
      color: SDFI_C[c.id] || "#c792ea", lineStyle: { width: 1.5, type: "dashed", color: SDFI_C[c.id] || "#c792ea", opacity: .6 }, z: 2 }));
    if (AUC.swaps && cmp && cmp.roisfix && cmp.roisfix.tenors) series.push({ name: `Свопы ${dmy(cmp.roisfix.date)}`, type: "line", symbol: "circle", symbolSize: 5, data: roisPts(cmp.roisfix.tenors), color: "#f5913c", lineStyle: { width: 1.5, type: "dashed", color: "#f5913c", opacity: .6 }, itemStyle: { color: "#f5913c", opacity: .6 }, z: 2 });
    const kc = mkChart(kp.querySelector("#kbd-chart"), {
      ...CHART_BG,
      legend: { data: series.map(x => x.name), top: 2, right: 8, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 14 },
      tooltip: { trigger: "item", formatter: p => {
        if (p.data && p.data.src) return `<b>${p.data.src}</b><br>${p.data.tenor}: ${pct(p.value[1])}`;
        if (p.seriesName.startsWith("Свопы")) return `<b>${p.seriesName}</b> · ${p.data.tenor}<br>фиксинг ROISfix ${fmt(p.data.rate, 2)}% (простая)<br>≈ ${pct(p.value[1])} эффективная годовая — сопоставимо с КБД`;
        if (p.seriesName.startsWith("ОФЗ")) return `<b>${p.data.name}</b>${p.seriesName !== "ОФЗ" ? ` · ${p.seriesName.slice(4)}` : ""}<br>дюр ${fmt(p.value[0], 1)}г · ${pct(p.value[1])}`;
        return `${p.seriesName} ${fmt(p.value[0], 1)}г: ${pct(p.value[1])}`;
      } },
      grid: { left: 48, right: 20, top: 34, bottom: 44 },
      xAxis: { type: "value", name: "Срок / дюрация, лет", nameLocation: "middle", nameGap: 30, min: 0, ...AX },
      yAxis: { type: "value", name: "доходность, %", scale: true, ...AX },
      series,
    });
    kc.on("click", p => { if (p.data && p.data.isin) openIssue(p.data.isin); });
    // сдвиг КБД к выбранной дате на ключевых сроках
    if (cmp && cd) {
      const at = (arr, t) => { const a = arr.find(x => Math.abs(x[0] - t) < 1e-6); return a ? a[1] : null; };
      const was = toPts(cmp.kbd.tenors);
      const parts = [1, 3, 5, 10, 20].map(t => { const n = at(pts, t), w = at(was, t); if (n == null || w == null) return ""; const d = Math.round((n - w) * 100);
        return `${t} ${t === 1 ? "год" : t < 5 ? "года" : "лет"}: <b style="color:${d > 0 ? "var(--red)" : d < 0 ? "var(--green)" : "var(--muted)"}">${d > 0 ? "+" : ""}${d} б.п.</b>`; }).filter(Boolean);
      kp.querySelector("#kbd-delta").innerHTML = `Изменение КБД с ${cdTxt} (КБД на ${dmy(AUC.curve.tradedate || "")}): ${parts.join(" · ")}. Рост доходности = цены ОФЗ снизились.`;
    }
    const pick = async d => {
      AUC.cmpDate = d || null;
      if (!d) { AUC.cmp = null; return render(); }
      AUC.cmpLoading = true; render();
      try { const r = await fetch(`${API}/api/ofz_curve?date=${d}`); AUC.cmp = r.ok ? await r.json() : null; } catch (e) { AUC.cmp = null; }
      AUC.cmpLoading = false; render();
    };
    kp.querySelectorAll("#kbd-when [data-d]").forEach(c => c.onclick = () => pick(c.dataset.d));
    kp.querySelector("#kbd-date").onchange = e => pick(e.target.value);
    kp.querySelector("#kbd-swaps").onclick = () => { AUC.swaps = !AUC.swaps; render(); };
  }
  v.appendChild(head);
  head.querySelectorAll("[data-g]").forEach(c => c.onclick = () => { AUC.gran = c.dataset.g; render(); });
  head.querySelectorAll("[data-t]").forEach(c => c.onclick = () => { AUC.type = c.dataset.t; render(); });
  head.querySelectorAll("[data-m]").forEach(c => c.onclick = () => { AUC.metric = c.dataset.m; render(); });

  // профиль погашения ОФЗ по годам — стек столбиков по типу
  const red = AUC.red;
  if (red && red.years && red.years.length) {
    const RTC = { "ОФЗ-ПД": "#1fe0a0", "ОФЗ-ПК": "#f5b13c", "ОФЗ-ИН": "#9a8bff", "ОФЗ-АД": "#6f9ac9" };
    const redPanel = el(`<div class="panel" style="margin-top:12px"><h3>Погашение ОФЗ по годам <span class="muted" style="font-weight:400;font-size:12px">· млрд ₽ номинала, стек по типам · клик по году — какие выпуски гасятся</span></h3><div class="chart" id="red-chart" style="height:300px"></div></div>`);
    v.appendChild(redPanel);
    setTimeout(() => {
      const node = redPanel.querySelector("#red-chart");
      if (!node) return;
      const ch = mkChart(node, {
        ...CHART_BG,
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: ps => {
          if (!ps || !ps.length) return "";
          let tot = 0; let s = `<div style="font-weight:600;margin-bottom:2px">${ps[0].axisValue}</div>`;
          ps.forEach(p => { if (p.value) { tot += p.value; s += `${p.marker}${p.seriesName}: <b>${fmt(p.value, 0)}</b> млрд<br/>`; } });
          return s + `<div style="margin-top:2px;border-top:1px solid rgba(255,255,255,.15);padding-top:2px">Всего: <b>${fmt(tot, 0)}</b> млрд ₽</div>`;
        } },
        legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
        grid: { left: 54, right: 16, top: 34, bottom: 26 },
        xAxis: { type: "category", data: red.years, ...AX },
        yAxis: { type: "value", name: "млрд ₽", nameTextStyle: { align: "right", padding: [0, 8, 0, 0] }, ...AX },
        series: red.types.map(t => ({ name: t, type: "bar", stack: "ofz", data: red.data[t], itemStyle: { color: RTC[t] || "#888" }, emphasis: { focus: "series" }, barMaxWidth: 40 })),
      });
      ch.on("click", p => { if (p.name) showRedemptionIssues(p.name, red.issues || {}); });
    }, 30);
  }

  // график: ОБЪЁМЫ аукционов (совокупный спрос) по месяцам/неделям, стек по типу,
  // учитывает фильтр типа; в тултипе — доходность и цена по каждому выпуску
  const gran = AUC.gran || "month";
  const metric = AUC.metric || "demand";
  const metricField = metric === "placed" ? "placed_mln" : "demand_mln";
  const metricLabel = metric === "placed" ? "Размещено" : "Спрос";
  const metricGen = metric === "placed" ? "размещения" : "спроса";
  const wkKey = ds => { const d = new Date(ds + "T00:00:00Z"); const off = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - off); return d.toISOString().slice(0, 10); };
  const bucket = {}, bucketAuc = {};
  rows.forEach(r => {
    const key = gran === "week" ? wkKey(r.date) : r.date.slice(0, 7);
    const t = (r.type || "").trim();
    (bucket[key] = bucket[key] || {})[t] = (bucket[key][t] || 0) + (r[metricField] || 0) / 1000;
    (bucketAuc[key] = bucketAuc[key] || []).push(r);
  });
  const keys = Object.keys(bucket).sort();
  const labels = keys.map(k => gran === "week" ? dmy(k) : k.replace("-", "."));
  const usedTypes = AUC_TYPES.filter(t => keys.some(k => bucket[k][t]));
  // медиана доходности по периоду (только фикс-купон ПД, где есть wa_yield)
  const median = arr => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const medYield = keys.map(k => median((bucketAuc[k] || []).filter(r => (r.type || "").includes("ПД") && r.wa_yield != null).map(r => r.wa_yield)));
  // медиана объёма (спрос/размещено): по месяцам — за всё время; по неделям — за видимый на графике период
  const totalsPer = keys.map(k => usedTypes.reduce((s, t) => s + (bucket[k][t] || 0), 0));
  const zoomToIdx = (a, b) => { const n = keys.length; return [Math.max(0, Math.floor(a / 100 * (n - 1))), Math.min(n - 1, Math.ceil(b / 100 * (n - 1)))]; };
  const medWindow = (lo, hi) => median(totalsPer.slice(lo, hi + 1).filter(v => v != null));
  const medTotal = gran === "week" ? medWindow(...zoomToIdx(80, 100)) : median(totalsPer.filter(v => v != null));
  setTimeout(() => {
    const node = head.querySelector("#auc-chart");
    if (!node || !keys.length) { if (node) node.innerHTML = `<div class="muted" style="padding:20px">нет данных</div>`; return; }
    const VTC = { "ОФЗ-ПД": "#1fe0a0", "ОФЗ-ПК": "#f5b13c", "ОФЗ-ИН": "#9a8bff", "ОФЗ-АД": "#6f9ac9" };
    const aucCh = mkChart(node, {
      ...CHART_BG,
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: ps => {
        if (!ps || !ps.length) return "";
        const i = ps[0].dataIndex, list = bucketAuc[keys[i]] || [];
        let tot = 0, medv = null; let s = `<div style="font-weight:600;margin-bottom:2px">${labels[i]}</div>`;
        ps.forEach(p => { if (p.seriesName === "медиана дох. (ПД)") { medv = p.value; return; } if (p.value) { tot += p.value; s += `${p.marker}${p.seriesName}: <b>${fmt(p.value, 0)}</b> млрд<br/>`; } });
        s += `<div style="border-top:1px solid rgba(255,255,255,.15);margin-top:2px;padding-top:2px">${metricLabel}: <b>${fmt(tot, 0)}</b> млрд ₽</div>`;
        if (medv != null) s += `<div>Медиана дох.: <b style="color:#e0574a">${fmt(medv, 2)}%</b></div>`;
        s += `<div style="margin-top:4px;font-size:11px;line-height:1.5">${list.map(r => { const yv = (r.type || "").includes("ПК") ? (r.sm_bp != null ? `SM ${r.sm_bp > 0 ? "+" : ""}${r.sm_bp} б.п.` : "—") : (r.wa_yield != null ? fmt(r.wa_yield, 2) + "%" : "—"); return `<b>ОФЗ ${r.series}</b> · ${dmy(r.date)} · дох. <b>${yv}</b> · цена ${r.wa_price != null ? fmt(r.wa_price, 2) : "—"}`; }).join("<br>")}</div>`;
        return s;
      } },
      legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8, data: [...usedTypes, "медиана дох. (ПД)"] },
      grid: { left: 52, right: 52, top: 30, bottom: gran === "week" ? 46 : 26 },
      dataZoom: gran === "week" ? [
        { type: "inside", start: 80, end: 100 },
        { type: "slider", bottom: 8, height: 16, start: 80, end: 100, borderColor: "transparent",
          fillerColor: "rgba(47,224,138,.12)", handleStyle: { color: "#2fe08a", borderColor: "#2fe08a" },
          moveHandleStyle: { color: "#2fe08a" }, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 9 } },
      ] : undefined,
      xAxis: { type: "category", data: labels, ...AX, axisLabel: { color: cssVar("--muted", "#8aa"), fontSize: 10, hideOverlap: true } },
      yAxis: [
        { type: "value", name: metricLabel.toLowerCase() + ", млрд ₽", nameTextStyle: { align: "right", padding: [0, 8, 0, 0] }, ...AX },
        { type: "value", name: "медиана дох. (ПД), %", position: "right", scale: true, ...AX, splitLine: { show: false }, axisLabel: { color: "#e0574a", fontSize: 10, formatter: v => fmt(v, 0) + "%" } },
      ],
      series: [
        ...usedTypes.map((t, ti) => ({ name: t, type: "bar", stack: "v", data: keys.map(k => Math.round(bucket[k][t] || 0)), itemStyle: { color: VTC[t] }, barMaxWidth: gran === "week" ? 14 : 26,
          markLine: (ti === 0 && medTotal != null) ? {
            silent: true, symbol: "none", z: 20,
            lineStyle: { type: "dashed", color: "#8a97a0", width: 1.5 },
            label: { formatter: `медиана ${metricGen}: ${fmt(medTotal, 0)} млрд`, color: "#3a4650", fontSize: 10, fontWeight: 600, position: "insideStartTop", backgroundColor: "#fff", padding: [3, 6], borderRadius: 3, borderColor: "#d0d7dd", borderWidth: 1 },
            data: [{ yAxis: medTotal }],
          } : undefined,
        })),
        { name: "медиана дох. (ПД)", type: "line", yAxisIndex: 1, data: medYield, connectNulls: true, smooth: true, symbol: "none", itemStyle: { color: "#e0574a" }, lineStyle: { width: 3, color: "#e0574a", type: "dashed" }, z: 3, tooltip: { valueFormatter: v => v == null ? "—" : fmt(v, 2) + "%" } },
      ],
    });
    // в недельном режиме медиана спроса пересчитывается под видимый на графике период
    if (gran === "week" && aucCh) aucCh.on("datazoom", () => {
      const dz = (aucCh.getOption().dataZoom || [])[0]; if (!dz) return;
      const mv = medWindow(...zoomToIdx(dz.start, dz.end)); if (mv == null) return;
      aucCh.setOption({ series: [{ markLine: { silent: true, symbol: "none", z: 20, lineStyle: { type: "dashed", color: "#8a97a0", width: 1.5 }, label: { formatter: `медиана ${metricGen}: ${fmt(mv, 0)} млрд`, color: "#3a4650", fontSize: 10, fontWeight: 600, position: "insideStartTop", backgroundColor: "#fff", padding: [3, 6], borderRadius: 3, borderColor: "#d0d7dd", borderWidth: 1 }, data: [{ yAxis: mv }] } }] }, false);
    });
  }, 30);

  // таблица
  const arrow = k => AUC.sort === k ? (AUC.desc ? " ▾" : " ▴") : " ⇅";
  const th = AUC_COLS.map(([k, l, , al]) => `<th data-k="${k}" style="cursor:pointer;user-select:none;text-align:${al === "l" ? "left" : al === "r" ? "right" : "center"}">${l}<span class="muted" style="font-size:10px">${arrow(k)}</span></th>`).join("");
  const body = rows.map(r => `<tr>${AUC_COLS.map(([k, l, fn, al]) => `<td style="text-align:${al === "l" ? "left" : al === "r" ? "right" : "center"}">${fn(r)}</td>`).join("")}</tr>`).join("");
  const t = el(`<div class="tbl-wrap panel" style="margin-top:12px"><div style="overflow-x:auto"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div></div>`);
  t.querySelectorAll("th").forEach(h => h.onclick = () => { const k = h.dataset.k; if (AUC.sort === k) AUC.desc = !AUC.desc; else { AUC.sort = k; AUC.desc = true; } render(); });
  t.querySelectorAll("td [data-isin]").forEach(x => x.onclick = () => openIssue(x.dataset.isin));
  v.appendChild(t);
}

// ---------- Первичка (primary placements) ----------
const PLACE = { mode: "current", days: 120 };
// small inline progress bar for placement completion
function placeBar(p) {
  if (p == null) return "—";
  const c = p < 40 ? "#35d6e6" : p < 80 ? "#5ac77a" : "#8a93a3";
  return `<div style="display:flex;align-items:center;gap:6px"><div style="flex:0 0 46px;height:6px;border-radius:3px;background:var(--panel2,#1a2030);overflow:hidden"><div style="width:${Math.min(100, p)}%;height:100%;background:${c}"></div></div><span style="font-size:11px;color:var(--muted)">${fmt(p, 0)}%</span></div>`;
}
async function renderPlacements(v) {
  const cur = PLACE.mode === "current";
  v.appendChild(el(`<div class="panel"><h3>Первичный рынок — ${cur ? "календарь размещений" : "недавно размещённые"}</h3>
    <div class="chips" id="pl-mode"><span class="chip ${cur ? "on" : ""}" data-m="current">Календарь (corpbonds)</span><span class="chip ${cur ? "" : "on"}" data-m="history">История (MOEX)</span></div>
    ${cur ? "" : `<div class="chips" id="pl-days" style="margin-top:8px">${[60, 120, 180, 365].map(d => `<span class="chip ${PLACE.days === d ? "on" : ""}" data-d="${d}">${d} дней</span>`).join("")}</div>`}</div>`));
  v.querySelectorAll("#pl-mode .chip").forEach(c => c.onclick = () => { PLACE.mode = c.dataset.m; render(); });
  v.querySelectorAll("#pl-days .chip").forEach(c => c.onclick = () => { PLACE.days = +c.dataset.d; render(); });
  const host = el(`<div><div class="loading"></div></div>`);
  v.appendChild(host);
  let r = null;
  try { r = await fetch(`${API}/api/placements?mode=${PLACE.mode}&days=${PLACE.days}`).then(x => x.json()); } catch (e) { }
  host.innerHTML = "";
  if (!r || !r.rows || !r.rows.length) { host.innerHTML = `<div class="muted" style="padding:30px;text-align:center">${cur ? "Календарь размещений недоступен (источник corpbonds.ru не ответил)." : "Нет размещений за период."}</div>`; return; }

  if (cur) {   // corpbonds calendar — announced upcoming/ongoing placements
    host.appendChild(el(`<div class="panel"><div class="stat-row">
      <div class="s"><div class="l">Размещений в календаре</div><div class="v">${r.total}</div></div></div></div>`));
    const body = r.rows.map(x => `<tr ${x.isin ? `data-isin="${x.isin}"` : ""} ${x.isin ? 'style="cursor:pointer"' : ""}>
      <td><b>${dmy(x.place_date)}</b>${x.book_date ? `<div class="muted" style="font-size:10px">заявки ${dmy(x.book_date)}</div>` : ""}${x.upcoming ? '<div class="muted" style="font-size:9px;color:var(--acc)">предстоит</div>' : ""}</td>
      <td style="text-align:left">${x.isin ? `<span class="link">${x.issuer}</span>` : `<b>${x.issuer}</b>`}${x.isin ? `<div class="isin muted" style="font-size:10px;font-family:var(--mono)">${x.isin}</div>` : ""}</td>
      <td style="text-align:left;font-size:11px">${x.rating_raw || "—"}</td>
      <td><b>${x.coupon != null ? fmt(x.coupon, 2) + "%" : "—"}</b><div class="muted" style="font-size:9px">${x.is_floater ? "флоатер (спред)" : "фикс"}</div></td>
      <td style="text-align:left">${x.term || "—"}</td>
      <td style="text-align:right"><b>${x.volume ? bigMoney(x.volume) : (x.volume_raw || "—")}</b></td>
      <td style="text-align:left;font-size:11px;color:var(--muted);max-width:240px;white-space:normal">${x.note || ""}</td>
    </tr>`).join("");
    const t = el(`<div class="tbl-wrap panel"><table><thead><tr><th>Размещение</th><th style="text-align:left">Эмитент</th><th style="text-align:left">Рейтинг</th><th>Купон</th><th style="text-align:left">Срок</th><th style="text-align:right">Объём</th><th style="text-align:left">Примечание</th></tr></thead><tbody>${body}</tbody></table></div>`);
    t.querySelectorAll("tr[data-isin]").forEach(tr => tr.onclick = () => openIssue(tr.dataset.isin));
    host.appendChild(t);
    return;
  }

  // history mode — MOEX recently placed (with the editable coupon model)
  host.appendChild(el(`<div class="panel"><div class="stat-row"><div class="s"><div class="l">Размещено за ${PLACE.days} дней</div><div class="v">${r.total}</div></div></div></div>`));
  const body = r.rows.map(x => `<tr data-isin="${x.isin}">
    <td><b>${dmy(x.issue_date)}</b></td>
    <td><span class="link">${x.name}</span>${x.currency && x.currency !== "RUB" ? ` <span class="badge float" style="padding:1px 6px;font-size:9px">${x.currency}</span>` : ""}<div class="isin muted" style="font-size:11px;font-family:var(--mono)">${x.isin}</div></td>
    <td style="text-align:right"><b>${bigMoney(x.issue_volume)}</b></td>
    <td style="text-align:left">${x.sector || "—"}</td>
    <td>${ratingPill(x)}</td>
    <td><span class="badge ${x.kind}">${KIND_RU[x.kind] || "—"}</span></td>
    <td><b class="pl-ytm" data-isin="${x.isin}">${pct(x.kind === "floater" ? x.current_yield : x.ytm)}</b><div class="pl-ytm-base muted" data-isin="${x.isin}" style="font-size:9px">${x.kind !== "floater" && x.ytm != null ? "факт " + pct(x.ytm) : ""}</div></td>
    <td>${x.duration_years == null ? "—" : fmt(x.duration_years, 2)}</td>
    <td>${x.kind === "floater" ? pct(x.couponpercent) : `<input type="number" class="pl-coupon" data-isin="${x.isin}" value="${x.couponpercent ?? ""}" step="0.25" style="width:72px">`}</td>
    <td>${x.kind === "floater" || x.g_spread_bp == null ? bp(x.g_spread_bp) : `<input type="number" class="pl-gspread" data-isin="${x.isin}" value="${x.g_spread_bp}" step="10" style="width:76px">`}</td>
    <td>${dmy(x.matdate)}${x.offer_date ? `<div class="muted" style="font-size:10px">${offerWord(x)} ${dmy(x.offer_date)}</div>` : ""}</td>
  </tr>`).join("");
  const t = el(`<div class="tbl-wrap panel"><table><thead><tr><th>Размещён</th><th>Выпуск</th><th>Объём</th><th>Сектор</th><th>Рейтинг</th><th>Тип</th><th title="сначала — рыночная YTM; при вводе купона или G-спреда — модельная (к оферте, если она есть)">YTM (факт / модель)</th><th>Дюр.</th><th>Купон, %</th><th>G-спред, бп</th><th>Погашение</th></tr></thead><tbody>${body}</tbody></table></div>`);
  t.querySelectorAll("tr[data-isin]").forEach(tr => tr.onclick = () => openIssue(tr.dataset.isin));
  // per-bond модель: купон↔YTM↔G-спред связаны через КБД (= YTM − G-спред) при размещении по номиналу
  const meta = {};
  // срок модели — до оферты, если она впереди (MOEX-YTM такой бумаги тоже к оферте), иначе до погашения
  const yrsTo = x => { const od = x.offer_date && new Date(x.offer_date); const y = od && od > new Date() ? (od - new Date()) / 3.15576e10 : null; return y && y > 0.05 ? y : (x.years_to_maturity || 3); };
  r.rows.forEach(x => { meta[x.isin] = { freq: x.couponfrequency || 2, years: yrsTo(x), base: x.ytm,
    kbd: (x.ytm != null && x.g_spread_bp != null) ? x.ytm - x.g_spread_bp / 100 : null }; });
  const setYtm = (isin, ytm) => {
    const span = t.querySelector(`.pl-ytm[data-isin="${isin}"]`), b = t.querySelector(`.pl-ytm-base[data-isin="${isin}"]`);
    span.textContent = pct(ytm); const b0 = meta[isin].base;
    span.className = "pl-ytm " + (b0 != null ? (ytm > b0 ? "neg" : "pos") : "");
    b.textContent = b0 != null ? "факт " + pct(b0) : "модель";
  };
  t.querySelectorAll(".pl-coupon").forEach(inp => {
    inp.onclick = e => e.stopPropagation();
    inp.oninput = debounce(async () => {
      const c = parseFloat(inp.value), isin = inp.dataset.isin, m = meta[isin]; if (!c) return;
      const r2 = await fetch(`${API}/api/model/emission?coupon=${c}&freq=${m.freq}&years=${m.years}&price=100`).then(x => x.json()).catch(() => null);
      if (r2 && r2.ytm != null) {
        setYtm(isin, r2.ytm);
        if (m.kbd != null) { const gi = t.querySelector(`.pl-gspread[data-isin="${isin}"]`); if (gi) gi.value = Math.round((r2.ytm - m.kbd) * 100); }
      }
    }, 300);
  });
  t.querySelectorAll(".pl-gspread").forEach(inp => {
    inp.onclick = e => e.stopPropagation();
    inp.oninput = debounce(async () => {
      const g = parseFloat(inp.value), isin = inp.dataset.isin, m = meta[isin];
      if (isNaN(g) || m.kbd == null) return;
      const targetYtm = m.kbd + g / 100;
      const r2 = await fetch(`${API}/api/model/coupon?ytm=${targetYtm}&freq=${m.freq}&years=${m.years}&price=100`).then(x => x.json()).catch(() => null);
      if (r2 && r2.coupon != null) {
        const ci = t.querySelector(`.pl-coupon[data-isin="${isin}"]`); if (ci) ci.value = r2.coupon;
        setYtm(isin, r2.ytm != null ? r2.ytm : targetYtm);
      }
    }, 300);
  });
  host.appendChild(t);
}

// ---------- Динамика рынка (movers / turnover) ----------
// ---------- Issuer credit analytics ----------
const ISSUERS = { data: null, sort: { key: "nd_ebitda", dir: "asc" }, detail: null };
const ndColor = x => x == null ? "var(--muted)" : x < 2 ? "var(--pos,#2fe08a)" : x <= 4 ? "var(--amber,#f5b13c)" : "var(--neg,#ff5470)";
const rpct = (x, d = 1) => x == null ? "—" : fmt(x * 100, d) + "%";
const rnum = (x, d = 2) => x == null ? "—" : fmt(x, d) + "×";

// ═══════════════ АНАЛИТИКА ЭМИТЕНТОВ ПО СЕКТОРАМ ═══════════════
// Первый сектор — жилые застройщики: отчётность МСФО 8 групп (разбор с методологией —
// backend/app/services/data/issuers/developers) + наши рыночные данные по их облигациям.
const SECTOR = { key: "developers", data: null, period: null, sort: "lev", desc: true, meth: null, company: null, bonds: null,
  cKind: "all", cCcy: "RUB", cMetric: "auto", geo: "", rsbuYear: null, top: 10, std: "msfo" };   // фильтры кривой сектора и карты
// вкладки секторов: готовые разделы кликабельны, остальные показаны как планы —
// отчётность по ним ещё не разобрана, данные появятся так же, как у застройщиков
const SECTOR_LIST = [["developers", "Девелопмент (жильё)", true], ["leasing", "Лизинг", true],
  ["subfed", "Субфеды и ОФЗ", true], ["utilities", "Электроэнергетика и ЖКХ", true], ["retail", "Ритейл и торговля", true],
  ["oilgas", "Нефтегаз"], ["transport", "Транспорт и логистика"], ["metals", "Металлургия"]];
const SEC_PAL = ["#1fe0a0", "#45c8f1", "#5b8def", "#c792ea", "#f5b13c", "#ff9f7f", "#ff6b6b", "#8bd450"];
// шкала долговой нагрузки: от спокойного зелёного к тревожному красному через янтарь.
// голубой убран — на светлой теме он почти не читался
const levColor = v => v == null ? "#8a8f98" : v < 2 ? "#12a06a" : v < 3.5 ? "#c9a227" : v < 4.5 ? "#a8760c" : "#d9453f";

// ---------- общие панели отраслевой аналитики: кривая сектора, погашения, прочие эмитенты ----------
// Одинаковы для любого сектора — меняются только подписи. Данные приходят в едином виде:
// d.curve (выпуски сектора), d.companies[].bond_calendar (погашения), d.others (эмитенты без отчётности).
const CURVE_METRICS = { fixed: [["gspread", "G-спред к КБД"], ["ofz", "Спред к ближайшей ОФЗ"], ["ytm", "Доходность к погашению"]],
  floater: [["sm", "Простая маржа (SM)"], ["dm", "Премия к ОФЗ-ПК (DM)"]], both: [["cy", "Текущая доходность"], ["z", "Z-спред к OIS"]] };
const CURVE_GROUPS = [["fixed", "Фикс"], ["floater", "Флоатеры"], ["both", "Фикс и флоатеры"]];
const curveMetricOf = (x, m) => m === "gspread" ? x.g_spread_bp
  : m === "ofz" ? x.spread_ofz_bp
  : m === "sm" ? x.sm_bp
  : m === "dm" ? x.dm_ofz_bp
  : m === "cy" ? (x.current_yield ?? null)
  : m === "z" ? (x.z_spread_bp ?? null)
  : m === "ytm" ? x.ytm
  : x.spread_bp;
// у флоатера и фикса метрики свои; общая одна — текущая доходность, она и показывает оба типа
const curveKindOf = m => CURVE_METRICS.floater.some(([k]) => k === m) ? "floater"
  : CURVE_METRICS.both.some(([k]) => k === m) ? "all" : "fixed";
const curveCountOf = (d, kind, ccy, metric) => (d.curve || []).filter(x =>
  (kind === "all" || x.kind === kind) && (x.currency || "RUB") === ccy
  && x.tenor != null && curveMetricOf(x, metric) != null).length;
// валюты берём из самих выпусков сектора — рубль первым, остальные по алфавиту
const curveCcys = d => [...new Set((d.curve || []).map(x => x.currency || "RUB"))]
  .sort((a, b) => a === "RUB" ? -1 : b === "RUB" ? 1 : a.localeCompare(b));

// ---------- «ⓘ» рядом с заголовком: пояснение и формула во всплывающей табличке ----------
// Тот же приём, что на вкладке «Макро»: вместо абзаца под заголовком — значок, по наведению
// открывается табличка, по клику закрепляется. Так графику остаётся место, а методика рядом.
const INFO_REG = new Map();
let INFO_SEQ = 0;
// формулы в подсказке «как считается» — каждая отдельным пунктом: раньше переносы строк
// терялись, и две-три формулы сливались в один абзац
function formulaHTML(f) {
  const lines = String(f).split("\n").map(x => x.trim()).filter(Boolean);
  const box = "margin-top:10px;padding:8px 10px;border-radius:8px;background:var(--bg-2,rgba(127,127,127,.08));font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5";
  if (lines.length < 2) return `<div style="${box}">${escA(lines[0] || "")}</div>`;
  return `<ul style="${box};margin-bottom:0;padding-left:26px;display:flex;flex-direction:column;gap:6px">${lines.map(l => `<li>${escA(l)}</li>`).join("")}</ul>`;
}

function infoIcon(title, text, formula) {
  const id = "ii" + (++INFO_SEQ);
  INFO_REG.set(id, { title, text, formula });
  return `<span class="info-i" data-ii="${id}" role="button" tabindex="0" aria-label="как считается">i</span>`;
}
// «?» в правом верхнем углу плитки: пояснение по наведению, по клику закрепляется
function kpiQ(title, text, formula) {
  return infoIcon(title, text, formula).replace('class="info-i"', 'class="info-i kpi-q"').replace(">i</span>", ">?</span>");
}
const INFO_POP = () => window.__infoPop || (window.__infoPop = (() => {
  let box = null, pinned = false, timer = null;
  const hide = () => { if (box && !pinned) box.hidden = true; };
  const show = (btn, html) => {
    if (!box) {
      box = document.createElement("div");
      box.style.cssText = "position:fixed;z-index:10000;width:min(460px,calc(100vw - 24px));max-height:70vh;overflow:auto;background:var(--panel,#fff);color:var(--text,#223);border:1px solid var(--line,#dde);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:12px 14px;font-size:12.5px;line-height:1.5";
      box.hidden = true;
      box.onmouseenter = () => clearTimeout(timer);
      box.onmouseleave = () => { timer = setTimeout(hide, 150); };
      document.body.appendChild(box);
      document.addEventListener("click", e => { if (pinned && !box.contains(e.target) && !e.target.closest(".info-i")) { pinned = false; hide(); } });
    }
    box.innerHTML = html; box.hidden = false;
    const r = btn.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + "px";
    box.style.top = (r.bottom + 8 + h < innerHeight ? r.bottom + 8 : Math.max(12, r.top - h - 8)) + "px";
  };
  return { show, hide, pin: v => { pinned = v; }, isPinned: () => pinned,
    later: () => { clearTimeout(timer); timer = setTimeout(hide, 150); }, stop: () => clearTimeout(timer),
    reset: () => { pinned = false; hide(); } };
})());

function wireInfoIcons(root) {
  const POP = INFO_POP();
  POP.reset();                                   // при перерисовке закреплённая табличка закрывается
  root.querySelectorAll("[data-ii]").forEach(b => {
    const d = INFO_REG.get(b.dataset.ii);
    if (!d) return;
    const html = `<div style="font-weight:700;margin-bottom:6px">${escA(d.title)}</div>
      <div>${escA(d.text)}</div>
      ${d.formula ? formulaHTML(d.formula) : ""}`;
    const open = () => { POP.stop(); POP.show(b, html); };
    b.onmouseenter = open;
    b.onmouseleave = () => { if (!POP.isPinned()) POP.later(); };
    b.onfocus = open;
    b.onclick = e => { e.stopPropagation(); const was = POP.isPinned(); POP.pin(!was); if (!was) open(); else POP.hide(); };
  });
}

function sectorTabsHTML() {
  return `<div class="chips" style="margin:0 0 12px;padding-bottom:10px;border-bottom:1px solid var(--line)">${SECTOR_LIST.map(([k, l, ready]) => ready
    ? `<span class="chip ${k === SECTOR.key ? "on" : ""}" data-sec="${k}">${l}</span>`
    : `<span class="chip chip-off" title="раздел в работе: отчётность по сектору ещё не разобрана">${l}</span>`).join("")}</div>`;
}

function sectorCurveHTML(d, lede) {
  const ccys = curveCcys(d);
  if (!ccys.includes(SECTOR.cCcy)) SECTOR.cCcy = ccys[0] || "RUB";
  if (!CURVE_GROUPS.some(([g]) => CURVE_METRICS[g].some(([k]) => k === SECTOR.cMetric))) SECTOR.cMetric = "gspread";
  return `<div class="panel"><h3>Кривая сектора <span class="muted" style="font-weight:400;font-size:12px">· каждая точка — выпуск, клик открывает карточку</span></h3>
    <div class="muted" style="font-size:12px;max-width:720px;margin-top:4px;line-height:1.5">${lede}</div>
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;margin-top:10px">
      <div style="display:flex;flex-direction:column;gap:6px">
        <div class="muted" style="font-size:9px;letter-spacing:.14em;text-transform:uppercase">Валюта</div>
        <div class="chips" style="margin:0">${ccys.map(k =>
          `<span class="chip ${SECTOR.cCcy === k ? "on" : ""}" data-cc="${k}">${k}</span>`).join("")}</div></div>
      <div style="display:flex;gap:18px;flex-wrap:wrap">${CURVE_GROUPS.map(([grp, title]) => `
        <div style="display:flex;flex-direction:column;gap:6px">
          <div class="muted" style="font-size:9px;letter-spacing:.14em;text-transform:uppercase">${title}</div>
          ${CURVE_METRICS[grp].map(([k, l]) => {
            const ok = curveCountOf(d, curveKindOf(k), SECTOR.cCcy, k) > 0;
            const why = SECTOR.cCcy === "RUB" ? "под текущий фильтр выпусков нет"
              : `у выпусков в ${SECTOR.cCcy} эта метрика не считается: премии меряем к рублёвой кривой`;
            return `<span class="chip ${SECTOR.cMetric === k ? "on" : ""}${ok ? "" : " chip-off"}" ${ok ? `data-cm="${k}"` : `title="${why}"`} style="white-space:nowrap">${l}</span>`;
          }).join("")}</div>`).join("")}</div>
    </div>
    <div class="chart" id="sec-curve" style="height:340px;margin-top:10px"></div>
    <div class="muted" id="sec-curve-note" style="font-size:11px;margin-top:6px"></div></div>`;
}

function drawSectorCurve(host, d, othersLabel = "Прочие эмитенты") {
  const metric = x => curveMetricOf(x, SECTOR.cMetric);
  const mk0 = curveKindOf(SECTOR.cMetric);
  const pool = (d.curve || []).filter(x => (mk0 === "all" || x.kind === mk0)
    && (x.currency || "RUB") === SECTOR.cCcy && x.tenor != null && metric(x) != null);
  const unit = (SECTOR.cMetric === "ytm" || SECTOR.cMetric === "cy") ? "%" : " б.п.";
  // в процентах один мусорный выброс (глубокий дисконт у неликвида) растягивает ось до
  // сотен процентов — потолок по 98-му перцентилю; сама точка просто уходит выше
  const yv = pool.map(metric).filter(v => v != null).sort((a, b) => a - b);
  const yMax = unit === "%" && yv.length ? Math.min(60, Math.ceil(_pctile(yv, 0.98) + 1)) : null;
  const yName = { cy: "Текущая доходность, %", ytm: "Доходность, %", sm: "Простая маржа, б.п.",
    dm: "Премия к ОФЗ-ПК, б.п.", gspread: "G-спред к КБД, б.п.", ofz: "Спред к ОФЗ, б.п." }[SECTOR.cMetric] || "Премия, б.п.";
  const mk = arr => arr.map(x => ({ value: [x.tenor, metric(x)], name: x.name, isin: x.isin,
    issuer: x.issuer, rating: x.rating, kind: x.kind, ccy: x.currency, ofz: x.ofz }));
  const ofz = pool.filter(x => x.ofz);
  const rep = pool.filter(x => x.reported && !x.ofz), oth = pool.filter(x => !x.reported && !x.ofz);
  const note = host.querySelector("#sec-curve-note");
  if (!pool.length) {      // под фильтром пусто — объясняем, а не показываем пустые оси
    host.querySelector("#sec-curve").innerHTML = `<div class="muted" style="padding:26px;text-align:center;line-height:1.6">
      Под этот фильтр выпусков нет.${SECTOR.cCcy !== "RUB" ? ` Премию к рублёвой кривой по выпускам в ${SECTOR.cCcy} не считаем — для них есть доходность и текущая доходность.` : ""}</div>`;
    if (note) note.textContent = "";
    return bindSectorCurve(host, d);
  }
  const hint = { sm: " · простая маржа: надбавка к своему индексу с поправкой на цену (купонная надбавка + возврат к номиналу, разнесённый по годам)",
    dm: " · премия к государственным флоатерам: простая маржа бумаги минус простая маржа ОФЗ-ПК того же срока, с поправкой на разные индексы (ключевая ставка против RUONIA)",
    gspread: " · G-спред: доходность минус кривая ОФЗ на сроке дюрации",
    ofz: " · спред к ближайшей по дюрации ОФЗ",
    ytm: " · доходность к погашению или к оферте",
    cy: " · единственная метрика, сравнимая у фикса и флоатера: купон к цене. Доходность к погашению у флоатера не считается — будущий купон неизвестен" }[SECTOR.cMetric] || "";
  if (note) note.textContent = `${plural(pool.length, "выпуск", "выпуска", "выпусков")} на графике${pool.length < (d.curve || []).length ? ` из ${d.curve.length}` : ""}` + hint;
  const c = mkChart(host.querySelector("#sec-curve"), { ...CHART_BG,
    tooltip: { trigger: "item", formatter: p => `<b>${p.data.name}</b><br>${escA(p.data.issuer || "")}<br>${p.data.kind === "floater" ? "флоатер" : "фикс"}${p.data.ccy && p.data.ccy !== "RUB" ? " · " + p.data.ccy : ""}<br>срок ${fmt(p.value[0], 2)} г · ${fmt(p.value[1], SECTOR.cMetric === "ytm" ? 2 : 0)}${unit}${p.data.rating ? "<br>рейтинг " + p.data.rating : ""}` },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
    grid: { left: 66, right: 24, top: 34, bottom: 46 },
    xAxis: { type: "value", name: mk0 === "floater" ? "Срок до погашения / оферты, лет" : "Дюрация / срок, лет",
      nameLocation: "middle", nameGap: 30, min: 0, ...AX },
    yAxis: { type: "value", ...AX, name: yName, nameGap: 16,
      nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] }, scale: true, max: yMax },
    series: [...(ofz.length ? [{ name: "ОФЗ", type: "scatter", symbolSize: 7, data: mk(ofz), itemStyle: { color: "#2fa89b", opacity: .55 } }] : []),
      { name: "Группы с разобранной отчётностью", type: "scatter", symbolSize: 12, data: mk(rep), itemStyle: { color: "#45c8f1", borderColor: "rgba(0,0,0,.3)" } },
      { name: othersLabel, type: "scatter", symbolSize: 10, data: mk(oth), itemStyle: { color: "#8a8f98", opacity: .7 } }] });
  if (c) c.on("click", p => { if (p.data && p.data.isin) openIssue(p.data.isin); });
  bindSectorCurve(host, d);
}

function bindSectorCurve(host, d) {
  host.querySelectorAll("[data-cc]").forEach(c => c.onclick = () => {
    const ccy = c.dataset.cc;
    if (!curveCountOf(d, curveKindOf(SECTOR.cMetric), ccy, SECTOR.cMetric)) {   // метрика под эту валюту не считается
      const alt = CURVE_GROUPS.flatMap(([g]) => CURVE_METRICS[g]).find(([k]) => curveCountOf(d, curveKindOf(k), ccy, k) > 0);
      if (alt) SECTOR.cMetric = alt[0];
    }
    SECTOR.cCcy = ccy; render();
  });
  host.querySelectorAll("[data-cm]").forEach(c => c.onclick = () => { SECTOR.cMetric = c.dataset.cm; render(); });
}

// панель-заготовка под график сектора: lede — строка под заголовком либо
// {text, formula} — тогда вместо абзаца рядом с заголовком появляется значок «i»
// ── переключатель «% / ₽» в заголовке панели ──
// Суммы в рублях показываем там, где они имеют смысл: проблемные активы, стадия 3, резерв,
// структура долга. У отношений (NIM, CIR, COR, ROE, покрытие) рублёвого аналога нет
const UNIT = {};          // ключ панели → "pct" | "rub"
const UNIT_DRAW = {};     // ключ панели → перерисовка графика
function unitSw(key, def) {
  if (!UNIT[key]) UNIT[key] = def;
  return `<span class="chips unit-sw" data-unit-key="${key}" style="float:right;gap:4px;margin-left:10px">${[["pct", "%"], ["rub", "₽"]].map(([k, l]) =>
    `<span class="chip ${UNIT[key] === k ? "on" : ""}" data-unit="${k}" style="padding:3px 11px;font-size:11.5px">${l}</span>`).join("")}</span>`;
}
function wireUnitSw(root) {
  root.querySelectorAll(".unit-sw").forEach(box => box.querySelectorAll("[data-unit]").forEach(ch => ch.onclick = () => {
    const key = box.dataset.unitKey;
    UNIT[key] = ch.dataset.unit;
    box.querySelectorAll("[data-unit]").forEach(x => x.classList.toggle("on", x === ch));
    if (UNIT_DRAW[key]) UNIT_DRAW[key]();
  }));
}
const bnAxis = v => fmt(v, Math.abs(v) < 10 && v % 1 ? 1 : 0);   // подписи оси в млрд ₽

const secPanel = (title, note, lede, id, h, extra = "") => {
  const info = lede && typeof lede === "object";
  return `<div class="panel">
  <h3>${title} <span class="muted" style="font-weight:400;font-size:12px">· ${note}</span>${info ? infoIcon(title, lede.text, lede.formula) : ""}${extra}</h3>
  ${info ? "" : `<div class="muted" style="font-size:12px;max-width:720px;margin-top:4px;line-height:1.5">${lede}</div>`}
  <div class="chart" id="${id}" style="height:${h}px;margin-top:10px"></div></div>`;
};

function drawSectorRedemption(host, d) {
  const yrs = ["2026", "2027", "2028", "2029", "2030", "2031+"];
  const sum = kind => yrs.map(y => Math.round(d.companies.reduce((a, c) => a + (((c.bond_calendar || {})[kind] || {})[y] || 0), 0) / 1000 * 10) / 10);
  const redSum = sum("red"), amSum = sum("am");
  const redTotal = redSum.map((v, i) => Math.round((v + amSum[i]) * 10) / 10);   // подпись — вся стопка
  mkChart(host.querySelector("#sec-red"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: v => fmt(v, 1) + " млрд ₽" },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
    grid: { left: 58, right: 24, top: 34, bottom: 28 },
    xAxis: { type: "category", data: yrs.map(y => y === "2026" ? "IV кв. 26" : y), ...AX },
    yAxis: { type: "value", name: "млрд ₽", ...AX },
    series: [{ name: "Погашения", type: "bar", stack: "v", data: redSum, itemStyle: { color: "#f5b13c" }, barMaxWidth: 46 },
      { name: "Амортизация", type: "bar", stack: "v", data: amSum, itemStyle: { color: "#a9752a" }, barMaxWidth: 46,
        label: { show: true, position: "top", distance: 6, fontSize: 11, color: cssVar("--muted", "#8aa"),
          formatter: p => redTotal[p.dataIndex] ? fmt(redTotal[p.dataIndex], 1) : "" } },
      { name: "Оферты (put)", type: "bar", data: sum("puts"), barMaxWidth: 18,
        itemStyle: { color: "transparent", borderColor: "#8b7bff", borderWidth: 1.5, borderType: "dashed" } }] });
}

function sectorOthersHTML(d, title) {
  const bnRub = x => x == null ? "—" : fmt(x / 1e9, x >= 1e11 ? 0 : 1);
  return `<div class="panel"><h3>${title} <span class="muted" style="font-weight:400;font-size:12px">· без разобранной отчётности — только рыночные данные</span></h3>
    <div class="tbl-wrap" style="margin-top:8px;max-height:340px;overflow:auto"><table><thead><tr><th style="text-align:left">Эмитент</th><th>Рейтинг</th><th>Выпусков</th><th>Долг на рынке</th><th>Премия</th><th>Срок</th></tr></thead><tbody>${
      (d.others || []).map(o => `<tr><td style="text-align:left">${escA(o.company)}</td><td>${o.market.rating || "—"}</td><td>${o.market.issues}</td><td>${bnRub(o.market.volume)} млрд</td><td>${o.market.spread_bp == null ? "—" : "+" + fmt(o.market.spread_bp, 0) + " б.п."}</td><td>${o.market.tenor_years == null ? "—" : fmt(o.market.tenor_years, 1) + " г."}</td></tr>`).join("")
    }</tbody></table></div></div>`;
}

async function renderSector(v) {
  // держим ссылку на шапку: при кэшированных данных рендер идёт синхронно, и узла
  // ещё нет в документе — document.getElementById вернул бы null
  const head = el(`<div class="panel" id="sec-head"><div class="loading">Считаю сектор…</div></div>`);
  v.appendChild(head);
  const host = el(`<div id="sec-body"></div>`); v.appendChild(host);

  if (!SECTOR.data) {
    try { SECTOR.data = await fetch(`${API}/api/sector/${SECTOR.key}`).then(x => x.json()); }
    catch (e) { host.innerHTML = `<div class="alert error">Не удалось загрузить сектор</div>`; return; }
  }
  const d = SECTOR.data;
  if (!d || !d.companies) { host.innerHTML = `<div class="alert error">Нет данных по сектору</div>`; return; }
  if (SECTOR.key === "leasing") {
    if (SECTOR.company) { head.remove(); return renderLeasingCompany(host, d); }
    return renderLeasing(head, host, d);
  }
  if (SECTOR.key === "subfed") {
    if (SECTOR.company) { head.remove(); return renderSubfedRegion(host, d); }
    return renderSubfed(head, host, d);
  }
  if (SECTOR.key === "utilities" || SECTOR.key === "retail") {
    if (SECTOR.company) { head.remove(); return renderCorpCompany(host, d); }
    return renderCorp(head, host, d);
  }
  if (SECTOR.company) { head.remove(); return renderSectorCompany(host, d); }
  const PERIODS = d.periods || [], P = SECTOR.period && PERIODS.includes(SECTOR.period) ? SECTOR.period : d.last_period;
  const pLabel = p => p === d.last_period && /^\d+м/.test(p) ? `LTM ${p}` : p;
  const bn = x => x == null ? "—" : fmt(x / 1000, Math.abs(x) >= 100000 ? 0 : 1);   // млн ₽ → млрд
  const bnRub = x => x == null ? "—" : fmt(x / 1e9, x >= 1e11 ? 0 : 1);
  // у новых компаний история короче: последний раскрытый период у каждого свой, и в таблице
  // честнее показать его, а не пустую строку под LTM 6м2026
  const lastOf = c => { const ps = (d.periods || []).filter(x => (c.fin || {})[x]); return ps.length ? ps[ps.length - 1] : null; };
  const fin = (c, p) => (c.fin || {})[p || lastOf(c) || P] || {};
  const colorOf = c => levColor(fin(c).lev_nd_esc);

  // ── шапка: эйрбоу, заголовок, лид, переключатель периода ──
  head.innerHTML = `
    ${sectorTabsHTML()}
    <h3 style="font-size:24px;margin:2px 0 6px">Долговая нагрузка застройщиков</h3>
    <div class="kpis" style="margin-top:14px">
      <div class="kpi"><div class="label">Эмитентов с облигациями</div><div class="value">${d.kpi.issuers}</div><div class="sub">${d.kpi.issues} выпусков в секторе</div></div>
      <div class="kpi"><div class="label">Долг на рынке</div><div class="value">${bnRub(d.kpi.volume)} млрд ₽</div><div class="sub">в обращении</div></div>
      <div class="kpi"><div class="label">Медианная премия</div><div class="value">+${fmt(d.kpi.median_spread_bp, 0)} б.п.</div><div class="sub">по 8 группам с отчётностью</div></div>
      <div class="kpi"><div class="label">Отчётность</div><div class="value">${d.kpi.reported} групп</div><div class="sub">разбор от ${dmy(d.as_of)}</div></div>
    </div>`;
  v.querySelectorAll("[data-sec]").forEach(c => c.onclick = () => { SECTOR.key = c.dataset.sec; SECTOR.data = null; SECTOR.company = null; render(); });

  // ── таблица ──
  const COLS = [["company", "Группа", "l"], ["rating", "Рейтинг", "c"], ["lev", "(ЧД−эскроу)/EBITDA", "c"],
    ["corp", "Корп. ЧД/EBITDA", "c"], ["icr", "ICR · EBITDA / %", "c"], ["margin", "Маржа EBITDA", "c"], ["esc", "Покрытие эскроу", "c"],
    ["pf", "Доля ПФ", "c"], ["spread", "Премия рынка", "c"], ["vol", "Долг на рынке", "c"]];
  const val = (c, k) => { const f = fin(c), m = c.market || {};
    // рейтинг сортируем по числовой шкале агентств, а не по тексту: иначе BBB+ окажется выше A-
    return ({ company: c.company, rating: m.rating_score, lev: f.lev_nd_esc, corp: f.lev_corp, icr: f.icr, margin: f.ebitda_margin,
      esc: f.esc_cov, pf: f.pf_share, spread: m.spread_bp, vol: m.volume })[k]; };
  const tableHTML = () => {
    const rows = [...d.companies].sort((a, b) => { const x = val(a, SECTOR.sort), y = val(b, SECTOR.sort);
      if (x == null) return 1; if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y, "ru") : x - y) * (SECTOR.desc ? -1 : 1); });
    const arrow = k => SECTOR.sort === k ? (SECTOR.desc ? " ▾" : " ▴") : " ⇅";
    const body = rows.map(c => { const f = fin(c), m = c.market || {};
      const noFin = !Object.keys(c.fin || {}).length;
      return `<tr data-comp="${escA(c.company)}" style="cursor:pointer${noFin ? ";opacity:.75" : ""}"><td style="text-align:left"><b style="color:${colorOf(c)}">${c.company}</b><div class="muted" style="font-size:11px">${escA(c.full || "")}${noFin ? " · отчётность в разборе" : ""}</div></td>
        <td>${m.rating ? `<span class="pill">${m.rating}</span>`
          : c.rating_report ? `<span class="pill" title="в нашей базе рейтинга нет: он присвоен головной компании, а облигации выпускает другое юрлицо">${escA(String(c.rating_report).split(" (")[0])}</span>` : "—"}<div class="muted" style="font-size:10px">отчёт: ${escA(c.rating_report || "—")}</div></td>
        <td style="color:${levColor(f.lev_nd_esc)};font-weight:600">${f.lev_nd_esc == null ? "—" : fmt(f.lev_nd_esc, 2) + "×"}</td>
        <td>${f.lev_corp == null ? "—" : fmt(f.lev_corp, 2) + "×"}</td>
        <td title="ICR = EBITDA / процентные расходы за тот же период. Прочерк — нет данных о процентах или расходы не положительны.">${f.icr == null ? "—" : fmt(f.icr, 2) + "×"}</td>
        <td>${f.ebitda_margin == null ? "—" : fmt(f.ebitda_margin, 1) + "%"}<div class="muted" style="font-size:10px">EBITDA ${bn(f.ebitda)} млрд</div></td>
        <td>${f.esc_cov == null ? "—" : fmt(f.esc_cov, 0) + "%"}</td>
        <td>${f.pf_share == null ? "—" : fmt(f.pf_share, 0) + "%"}</td>
        <td>${m.spread_bp == null ? "—" : "+" + fmt(m.spread_bp, 0) + " б.п."}<div class="muted" style="font-size:10px">${m.issues || 0} вып.</div></td>
        <td>${bnRub(m.volume)} млрд</td></tr>`; }).join("");
    return `<div class="panel" id="sec-tbl"><h3>Показатели за ${pLabel(P)} <span class="muted" style="font-weight:400;font-size:12px">· клик по строке открывает карточку группы</span>${infoIcon("Показатели за " + pLabel(P),
        "Чистый долг за вычетом эскроу — долг минус деньги минус остатки дольщиков на счетах эскроу. Корпоративный чистый долг — долг без проектного финансирования, за вычетом всех денег: он показывает нагрузку, которую не закрывают продажи квартир. Премия рынка — медиана по выпускам группы. Прочерк в покрытии эскроу и корпоративном долге означает, что группа не раскрывает проектное финансирование отдельной строкой.",
        "(ЧД − эскроу) / EBITDA = (долг − деньги − эскроу) ÷ EBITDA\nКорп. ЧД / EBITDA = (долг − ПФ − деньги) ÷ EBITDA\nПокрытие эскроу = эскроу ÷ ПФ × 100%\nПремия = медиана: G-спред к КБД у фиксов, дисконт-маржа к ОФЗ-ПК у флоатеров")}</h3>
      <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr>${COLS.map(([k, l, al]) =>
        `<th data-k="${k}" style="cursor:pointer;user-select:none;text-align:${al === "l" ? "left" : "center"}">${l}<span class="muted" style="font-size:10px">${arrow(k)}</span></th>`).join("")}</tr></thead>
      <tbody>${body}</tbody></table></div>
      </div>`;
  };

  const sect = secPanel;

  host.innerHTML = tableHTML()
    + sect("Коэффициенты долговой нагрузки", `EBITDA за ${pLabel(P)}`,
        { text: "Оба показателя чистые: из долга вычтены деньги. Корпоративный — долг без проектного финансирования; отрицательное значение означает, что денег и эскроу больше, чем соответствующего долга. Эскроу вычитаются потому, что эти деньги дольщиков раскроются застройщику при вводе дома и пойдут на погашение проектного кредита.",
          formula: "(ЧД − эскроу) / EBITDA = (долг − деньги − эскроу) ÷ EBITDA\nКорп. ЧД / EBITDA = (долг − проектное финансирование − деньги) ÷ EBITDA" }, "sec-lev", 360)
    + sect("Траектория долговой нагрузки", "из годовых отчётов",
        { text: "Как менялось отношение чистого долга за вычетом эскроу к EBITDA. Ряд начинается с 2021 года: за 2020-й показатель раскрывают только три группы из тринадцати.",
          formula: "(ЧД − эскроу) / EBITDA за каждый год по годовой отчётности; последняя точка — LTM к отчётной дате" }, "sec-hist", 340)
    + sect("Покрытие проектного долга эскроу", `на отчётную дату ${pLabel(P)}`,
        { text: "Деньги дольщиков на эскроу против проектного кредита. Ниже 100% — часть кредита ещё не покрыта продажами и гасится будущими продажами или деньгами группы. Чем выше покрытие, тем дешевле обслуживание: по эскроу-кредитам действует льготная ставка в размере покрытой части.",
          formula: "Покрытие эскроу = остатки на счетах эскроу ÷ проектное финансирование × 100%" }, "sec-escrow", 300)
    + sect("Публичный и непубличный долг", "высота столбца — весь долг, млрд ₽",
        { text: "Публичный — биржевые облигации и ЦФА, обязательства перед рыночными инвесторами; подпись сверху — его доля во всём долге. Непубличный — банковские кредиты, включая проектное финансирование. У групп, которые не раскрывают облигации отдельной строкой, публичный долг взят как объём биржевых выпусков в обращении.",
          formula: "Доля публичного долга = облигации и ЦФА ÷ весь долг × 100%" }, "sec-pub", 320)
    + sect("Премия рынка против нагрузки", "рынок сегодня",
        { text: "По горизонтали долговая нагрузка из отчётности, по вертикали — премия облигаций к безрисковой кривой. Выше при той же нагрузке — рынок требует больше. Размер круга — объём долга группы на рынке.",
          formula: "Премия = медиана по выпускам группы: G-спред к КБД у фиксов, дисконт-маржа к ОФЗ-ПК у флоатеров" }, "sec-scatter", 340)
    + sectorCurveHTML(d, "Срок и премия облигаций жилых девелоперов. Цветом выделены группы с разобранной отчётностью.")
    + `<div class="panel"><h3>География стройки <span class="muted" style="font-weight:400;font-size:12px">· по данным ЕРЗ, клик по группе меняет карту</span>${infoIcon("География стройки",
        "Сколько метров жилья застройщик строит в каждом субъекте РФ и какую долю рынка региона занимает. Данные ЕРЗ: региональные топы застройщиков, объём текущего строительства. В режиме «Все публичные» складываются метры застройщиков с биржевыми облигациями и разобранной отчётностью — так видно, где сосредоточен сектор.",
        "Доля в регионе = метры застройщика в субъекте ÷ весь объём стройки в субъекте × 100%")}</h3>
      <div id="sec-geo" style="margin-top:10px"><div class="loading" style="padding:20px">Загружаю карту…</div></div></div>`
    + sect("Стройка по данным ЕРЗ", "Единый ресурс застройщиков, на 01.09.2026",
        { text: "Объём жилья в стройке и доля площадей с перенесённым сроком ввода. Перенос сроков — ранний сигнал проблем: деньги дольщиков на эскроу раскрываются позже, а проектный кредит обслуживать надо.",
          formula: "Доля с переносом = площади с перенесённым сроком ввода ÷ объём текущего строительства × 100%" }, "sec-erz", 330)
    + sect("Карта погашений облигаций", "по группам с отчётностью",
        { text: "Сколько номинала гасится в каждом году: погашения и амортизации. Оферты показаны отдельным столбцом — это право инвестора предъявить бумагу досрочно, а не обязательный платёж. Подпись над столбиком — сумма погашений и амортизаций за год.",
          formula: "Год = Σ по выпускам групп с отчётностью: амортизации на свои даты + остаток номинала на дату погашения" }, "sec-red", 300)
    + sectorOthersHTML(d, "Другие застройщики на рынке");

  const bindRows = () => host.querySelectorAll("tr[data-comp]").forEach(tr =>
    tr.onclick = () => openCompanyCard(tr.dataset.comp));
  const bindSort = () => host.querySelectorAll("th[data-k]").forEach(th => th.onclick = () => {
    if (SECTOR.sort === th.dataset.k) SECTOR.desc = !SECTOR.desc; else { SECTOR.sort = th.dataset.k; SECTOR.desc = true; }
    host.querySelector("#sec-tbl").outerHTML = tableHTML(); bindSort(); bindRows();
  });
  bindSort(); bindRows();
  // ── коэффициенты: парные горизонтальные бары ──
  const lv = [...d.companies].filter(c => fin(c).lev_nd_esc != null).sort((a, b) => fin(b).lev_nd_esc - fin(a).lev_nd_esc);
  // мягкая пара цветов с вертикальным градиентом; подписи горизонтальные, ось стоит на нуле
  const C_NDE = "#2fa89b", C_CORP = "#d99b3f";     // бирюзовый и янтарный: различимы и в тёмной теме
  const grad = (c1, c2) => ({ type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }] });
  const barCol = (v, color, light) => v == null ? null : ({ value: +fmt(v, 2).replace(",", "."),
    label: { position: v >= 0 ? "top" : "bottom" },
    itemStyle: { color: v >= 0 ? grad(light, color) : grad(color, light), borderRadius: v >= 0 ? [5, 5, 0, 0] : [0, 0, 5, 5] } });
  const lvChart = mkChart(host.querySelector("#sec-lev"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: v => v == null ? "—" : fmt(v, 2) + "×" },
    legend: { top: 0, left: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8, itemGap: 18 },
    grid: { left: 52, right: 20, top: 40, bottom: 34 },
    xAxis: { type: "category", data: lv.map(c => c.company), ...AX, axisTick: { show: false },
      axisLine: { show: true, onZero: true, lineStyle: { color: cssVar("--line", "#2a2f38") } },
      axisLabel: { color: cssVar("--text", "#e6e9ef"), fontSize: 11, fontWeight: 600, interval: 0, hideOverlap: false, margin: 10 } },
    yAxis: { type: "value", ...AX, splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } },
      axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "×" } },
    series: [
      { name: "(Чистый долг − эскроу) / EBITDA", type: "bar", barMaxWidth: 22, barGap: "10%", itemStyle: { color: C_NDE },
        label: { show: true, position: "top", distance: 6, fontSize: 11, fontWeight: 600, color: cssVar("--muted", "#8aa"), formatter: p => fmt(p.value, 1) },
        data: lv.map(c => barCol(fin(c).lev_nd_esc, C_NDE, "#56c4b6")) },
      { name: "Корпоративный чистый долг / EBITDA", type: "bar", barMaxWidth: 22, itemStyle: { color: C_CORP },
        label: { show: true, position: "top", distance: 6, fontSize: 11, fontWeight: 600, color: cssVar("--muted", "#8aa"), formatter: p => fmt(p.value, 1) },
        data: lv.map(c => barCol(fin(c).lev_corp, C_CORP, "#edc07a")) }] });
  if (lvChart) lvChart.on("click", p => { const nm = lv[p.dataIndex]; if (nm) openCompanyCard(nm.company); });

  // ── траектория ──
  const ser = d.series || { periods: [], order: [], data: {} };
  const comps = ser.order || Object.keys(ser.data || {});
  // показываем годы, где нагрузка есть хотя бы у половины групп: в 2020-м её раскрывают трое из 13
  const yearHas = y => comps.filter(c => ((ser.data[c] || {})[y] || {}).ratio != null).length;
  const years = (ser.periods || []).filter(y => yearHas(y) >= Math.max(3, comps.length / 2));
  // у пары групп ранние годы дают нагрузку в десятки EBITDA и сплющивают весь график —
  // шкалу подрезаем, выбросы называем под графиком
  const histVals = comps.flatMap(c => years.map(y => ((ser.data[c] || {})[y] || {}).ratio)).filter(v => v != null);
  const histCap = histVals.length && Math.max(...histVals) > 20 ? 15 : null;
  const histOut = histCap ? comps.flatMap(c => years.map(y => {
    const r = ((ser.data[c] || {})[y] || {}).ratio;
    return r != null && r > histCap ? `${c}, ${pLabel(y)} — ${fmt(r, 1)}×` : null; })).filter(Boolean) : [];
  if (histOut.length) host.querySelector("#sec-hist").insertAdjacentHTML("afterend",
    `<div class="muted" style="font-size:11px;margin-top:6px">Шкала подрезана: за пределами графика ${histOut.join("; ")} — годы, когда EBITDA была совсем небольшой.</div>`);
  mkChart(host.querySelector("#sec-hist"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true,
      formatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.filter(x => x.value != null)
        .map(x => `${x.marker} ${x.seriesName}: <b>${fmt(x.value, 2)}×</b>`).join("<br>") },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
    grid: { left: 54, right: 24, top: 36, bottom: 30 },
    xAxis: { type: "category", data: years.map(pLabel), ...AX },
    yAxis: { type: "value", name: "× EBITDA", scale: true, max: histCap, ...AX, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "×" } },
    series: comps.map((c, i) => ({ name: c, type: "line", connectNulls: true, symbol: "circle", symbolSize: 6,
      lineStyle: { width: 2, color: SEC_PAL[i % SEC_PAL.length] }, itemStyle: { color: SEC_PAL[i % SEC_PAL.length] },
      data: years.map(y => { const h = (ser.data[c] || {})[y]; return h && h.ratio != null ? +h.ratio.toFixed(2) : null; }) })) });

  // ── эскроу ──
  const ec = d.companies.map(c => ({ c: c.company, esc: fin(c).esc_cov, pf: fin(c).pf_share }))
    .filter(x => x.esc != null).sort((a, b) => b.esc - a.esc);
  mkChart(host.querySelector("#sec-escrow"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: v => v == null ? "—" : fmt(v, 0) + "%" },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
    grid: { left: 52, right: 24, top: 34, bottom: 30 },
    xAxis: { type: "category", data: ec.map(x => x.c), ...AX, axisLabel: { color: AXIS_TXT, fontSize: 11, fontWeight: 600 } },
    yAxis: { type: "value", name: "%", ...AX },
    series: [
      { name: "Покрытие эскроу", type: "bar", barMaxWidth: 30, data: ec.map(x => ({ value: Math.round(x.esc), itemStyle: { color: x.esc >= 100 ? "#1fe0a0" : x.esc >= 60 ? "#f5b13c" : "#ff6b6b" } })),
        label: { show: true, position: "top", fontSize: 11, color: AXIS_TXT, formatter: p => p.value + "%" },
        markLine: { silent: true, symbol: "none", data: [{ yAxis: 100, lineStyle: { type: "dashed", color: "#8aa", width: 1 }, label: { formatter: "100% — проектный кредит закрыт продажами", fontSize: 10, color: "#8aa", position: "insideEndTop" } }] } },
      { name: "Доля проектного финансирования в долге", type: "bar", barMaxWidth: 30, data: ec.map(x => x.pf == null ? null : Math.round(x.pf)), itemStyle: { color: "#5b8def", opacity: .55 } }] });

  // ── публичный / непубличный долг ──
  // у групп первого разбора публичный долг (облигации + ЦФА) есть в отчётности; у остальных
  // берём объём биржевых выпусков в обращении из нашей рыночной базы
  const allYears = ser.periods || [], lastY = allYears[allYears.length - 1];
  const pubOf = c => { const fromRep = ((ser.data[c.company] || {})[lastY] || {}).pub;
    if (fromRep != null) return { v: fromRep, src: "отчётность" };
    const v = (c.market || {}).volume; return v ? { v: v / 1e6, src: "биржа" } : null; };
  const pubRows = d.companies.map(c => { const p = pubOf(c), debt = fin(c).debt;
      return p && debt ? { c: c.company, pub: p.v, nonpub: Math.max(0, debt - p.v), share: 100 * p.v / debt, src: p.src } : null; })
    .filter(Boolean).sort((a, b) => (b.pub + b.nonpub) - (a.pub + a.nonpub));
  mkChart(host.querySelector("#sec-pub"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" },
      formatter: ps => { const r = pubRows[ps[0].dataIndex];
        return `<b>${r.c}</b><br>облигации и ЦФА: ${bn(r.pub)} млрд<br>банки, включая проектное: ${bn(r.nonpub)} млрд<br>доля публичного: ${fmt(r.share, 0)}%<br><span style="opacity:.7">источник: ${r.src}</span>`; } },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 62, right: 24, top: 36, bottom: 44 },
    xAxis: { type: "category", data: pubRows.map(x => x.c), ...AX, axisTick: { show: false },
      axisLine: { show: true, onZero: true, lineStyle: { color: cssVar("--line", "#2a2f38") } },
      axisLabel: { color: cssVar("--text", "#e6e9ef"), fontSize: 11, fontWeight: 600, interval: 0, margin: 10 } },
    yAxis: { type: "value", name: "млрд ₽", ...AX, splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .45 } },
      axisLabel: { color: AXIS_TXT, formatter: v => fmt(v / 1000, 0) } },
    series: [
      { name: "Непубличный — банки и займы", type: "bar", stack: "d", barMaxWidth: 34, data: pubRows.map(x => x.nonpub), itemStyle: { color: "#5b93de" } },
      { name: "Публичный — облигации и ЦФА", type: "bar", stack: "d", barMaxWidth: 34, data: pubRows.map(x => x.pub),
        itemStyle: { color: "#e3b075", borderRadius: [5, 5, 0, 0] },
        label: { show: true, position: "top", distance: 6, fontSize: 11, fontWeight: 600,
          color: cssVar("--text", "#e6e9ef"), formatter: p => fmt(pubRows[p.dataIndex].share, 0) + "%" } }] });

  // ── премия против нагрузки ──
  const pts = d.companies.filter(c => fin(c).lev_nd_esc != null && (c.market || {}).spread_bp != null)
    .map(c => ({ value: [fin(c).lev_nd_esc, c.market.spread_bp, (c.market.volume || 0) / 1e9], name: c.company,
      itemStyle: { color: colorOf(c) + "cc", borderColor: colorOf(c), borderWidth: 2 } }));
  mkChart(host.querySelector("#sec-scatter"), { ...CHART_BG,
    tooltip: { trigger: "item", formatter: p => `<b>${p.data.name}</b><br>нагрузка ${fmt(p.value[0], 2)}×<br>премия +${fmt(p.value[1], 0)} б.п.<br>долг на рынке ${fmt(p.value[2], 1)} млрд ₽` },
    grid: { left: 66, right: 80, top: 30, bottom: 48 },
    xAxis: { type: "value", name: "(ЧД − эскроу) / EBITDA", nameLocation: "middle", nameGap: 30, scale: true, ...AX,
      axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "×" } },
    yAxis: { type: "value", name: "Премия, б.п.", nameGap: 16, nameTextStyle: { align: "right", padding: [0, 8, 0, 0] }, scale: true, ...AX },
    series: [{ type: "scatter", data: pts, symbolSize: p => Math.max(14, Math.min(44, 12 + Math.sqrt(p[2]) * 3.2)),
      label: { show: true, position: "right", distance: 10, fontSize: 12, fontWeight: 600, color: cssVar("--text", "#e6e9ef"), formatter: p => p.data.name },
      labelLayout: { hideOverlap: false, moveOverlap: "shiftY" } }] });

  drawSectorCurve(host, d, "Прочие застройщики");

  // ── стройка по ЕРЗ ──
  const erz = d.companies.filter(x => x.erz).map(x => ({ c: x.company, ...x.erz }))
    .sort((a, b) => b.building_m2 - a.building_m2);
  if (erz.length) mkChart(host.querySelector("#sec-erz"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" },
      formatter: ps => { const r = erz[ps[0].dataIndex];
        return `<b>${r.c}</b> · ${escA(r.name)}<br>${escA(r.region)}<br>строится ${fmt(r.building_m2 / 1000, 0)} тыс. м²`
          + `<br>с переносом срока ${fmt(r.delayed_m2 / 1000, 0)} тыс. м² (${fmt(r.delayed_pct, 1)}%)`
          + `<br>средний перенос ${fmt(r.delay_months, 2)} мес.<br>ЖК ${r.projects} · регионов ${r.regions}`
          + `<br>место в РФ ${r.rank} · рейтинг ЕРЗ ${r.erz_rating}`; } },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 62, right: 56, top: 36, bottom: 44 },
    xAxis: { type: "category", data: erz.map(x => x.c), ...AX, axisTick: { show: false },
      axisLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38") } },
      axisLabel: { color: cssVar("--text", "#e6e9ef"), fontSize: 11, fontWeight: 600, interval: 0, margin: 10 } },
    yAxis: [{ type: "value", name: "тыс. м²", ...AX, splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .45 } },
        axisLabel: { color: AXIS_TXT, formatter: v => fmt(v / 1000, 0) } },
      { type: "value", name: "перенос, %", ...AX, nameTextStyle: { ...AX.nameTextStyle, align: "left", padding: [0, 0, 0, 8] }, splitLine: { show: false }, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } }],
    series: [
      { name: "Строится", type: "bar", barMaxWidth: 26, itemStyle: { color: "#5b93de", borderRadius: [5, 5, 0, 0] }, data: erz.map(x => x.building_m2) },
      { name: "Площади с переносом срока", type: "bar", barMaxWidth: 26, itemStyle: { color: "#d98080", borderRadius: [5, 5, 0, 0] }, data: erz.map(x => x.delayed_m2) },
      { name: "Доля с переносом, %", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 7,
        lineStyle: { width: 2, type: "dashed", color: "#e0a458" }, itemStyle: { color: "#e0a458" }, data: erz.map(x => x.delayed_pct) }] });

  drawSectorRedemption(host, d);
  wireInfoIcons(host);
  drawDevGeo(host, d);
}

// ── страница одного застройщика: отчётность по годам + его облигации ──
async function renderSectorCompany(host, d, name = SECTOR.company) {
  const c = (d.companies || []).find(x => x.company === name);
  if (!c) { SECTOR.company = null; return render(); }
  const ser = d.series || { periods: [], data: {} }, S = ser.data[name] || {};
  const years = (ser.periods || []).filter(y => S[y]);
  const P = d.last_period, fin = p => (c.fin || {})[p] || {}, F = fin(P);
  const bn = x => x == null ? "—" : fmt(x / 1000, Math.abs(x) >= 100000 ? 0 : 1);
  const bnRub = x => x == null ? "—" : fmt(x / 1e9, 1);
  const pLabel = p => p === P && /^\d+м/.test(p) ? `LTM ${p}` : p;
  const m = c.market || {};
  const kpi = (l, v, sub) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${sub || ""}</div></div>`;
  const lev = F.lev_nd_esc, levCol = levColor(lev);

  host.innerHTML = `
    <div class="toolbar"><button class="btn ghost" id="sc-back">← Ко всем застройщикам</button></div>
    <div class="panel">
      <div class="muted" style="font-size:11px;letter-spacing:.18em;text-transform:uppercase">Застройщик · отчётность МСФО ${years[0] || ""} — ${pLabel(P)}</div>
      <h3 style="font-size:22px;margin:8px 0 4px">${name} <span class="muted" style="font-weight:400;font-size:13px">${escA(c.full || "")}</span></h3>
      <div class="muted" style="font-size:12px">${m.rating ? `рейтинг ${m.rating}${m.rating_agency ? " · " + agName(m.rating_agency) : ""}` : c.rating_report ? `рейтинг ${escA(c.rating_report)}` : "рейтинга нет"}${c.rating_report ? ` · в отчётности: ${escA(c.rating_report)}` : ""} · выпусков в обращении ${m.issues || 0}</div>
      <div class="kpis" style="margin-top:14px">
        ${kpi("(ЧД − эскроу) / EBITDA", `<span style="color:${levCol}">${lev == null ? "—" : fmt(lev, 2) + "×"}</span>`, `за ${pLabel(P)}`)}
        ${kpi("Корп. ЧД / EBITDA", F.lev_corp == null ? "—" : fmt(F.lev_corp, 2) + "×", "долг без проектного")}
        ${kpi('ICR ' + infoIcon("ICR — покрытие процентов", "Во сколько раз EBITDA покрывает процентные расходы за тот же период. Это не денежный поток. Прочерк — расходы не раскрыты или не положительны; капитализированные проценты не подставляются вместо расходов.", "ICR = EBITDA / процентные расходы\nICR EBIT = операционная прибыль / процентные расходы"), F.icr == null ? "—" : fmt(F.icr, 2) + "×", `EBITDA / проценты · EBIT / проценты ${F.icr_ebit == null ? "—" : fmt(F.icr_ebit, 2) + "×"}`)}
        ${kpi("EBITDA", bn(F.ebitda) + " млрд ₽", F.ebitda_margin == null ? "" : `маржа ${fmt(F.ebitda_margin, 1)}%`)}
        ${kpi("Выручка", bn(F.revenue) + " млрд ₽", "за 12 месяцев")}
        ${kpi("Покрытие эскроу", F.esc_cov == null ? "—" : fmt(F.esc_cov, 0) + "%", F.pf_share == null ? "" : `доля ПФ ${fmt(F.pf_share, 0)}%`)}
        ${kpi("Премия рынка", m.spread_bp == null ? "—" : "+" + fmt(m.spread_bp, 0) + " б.п.", `долг на рынке ${bnRub(m.volume)} млрд ₽`)}
      </div>
      ${c.erz ? `<div style="margin-top:14px;border-top:1px solid var(--line,#2a2f38);padding-top:12px">
        <div class="muted" style="font-size:10px;letter-spacing:.16em;text-transform:uppercase;margin-bottom:8px">Стройка · ЕРЗ, ${escA(c.erz.name)}${c.erz.region ? " · " + escA(c.erz.region) : ""}</div>
        <div class="kpis">
          ${kpi("Строится", fmt(c.erz.building_m2 / 1000, 0) + " тыс. м²", `${c.erz.rank}-е место в России`)}
          ${kpi("С переносом срока", fmt(c.erz.delayed_pct, 1) + "%", `${fmt(c.erz.delayed_m2 / 1000, 0)} тыс. м² · в среднем ${fmt(c.erz.delay_months, 2)} мес.`)}
          ${kpi("Жилых комплексов", c.erz.projects, `регионов ${c.erz.regions}`)}
          ${kpi("Рейтинг ЕРЗ", fmt(c.erz.erz_rating, 1), "потребительские качества, из 5")}
        </div></div>` : ""}
    </div>
    <div class="panel"><h3>Выручка, EBITDA и прибыль <span class="muted" style="font-weight:400;font-size:12px">· млрд ₽, последний столбец — 12 месяцев к отчётной дате</span>${infoIcon("Выручка, EBITDA и прибыль",
      "Столбики — выручка, EBITDA по единой методике сектора и чистая прибыль за период; линии — маржа по каждой из них. Чистая прибыль снята из отчёта о прибыли или убытке (итоговая, вместе с неконтролирующими долями), поэтому включает переоценки, курсовые разницы и налог — в отличие от EBITDA. У ПИК за 2022 год прибыли нет: компания публикует раскрываемую отчётность без сравнительных данных.",
      "Маржа EBITDA = EBITDA ÷ выручка × 100%\nМаржа по прибыли = чистая прибыль ÷ выручка × 100%\nLTM = год − первое полугодие прошлого года + первое полугодие текущего")}</h3>
      <div class="chart" id="sc-rev" style="height:300px;margin-top:8px"></div></div>
    <div class="panel"><h3>Долговая нагрузка и покрытие эскроу <span class="muted" style="font-weight:400;font-size:12px">· во сколько EBITDA укладывается чистый долг за вычетом эскроу и сколько проектного кредита закрыто деньгами дольщиков</span>${infoIcon("Долговая нагрузка и покрытие эскроу",
      "Линия нагрузки показывает, за сколько лет текущая EBITDA покрыла бы чистый долг без учёта денег дольщиков на эскроу — эти деньги раскроются застройщику при вводе домов и пойдут на погашение проектного кредита. Покрытие эскроу — какая часть проектного долга уже обеспечена продажами; чем оно выше, тем дешевле обслуживание, потому что по эскроу-кредитам действует льготная ставка.",
      "(ЧД − эскроу) / EBITDA = (долг − деньги − эскроу) ÷ EBITDA\nПокрытие эскроу = остатки на счетах эскроу ÷ проектное финансирование × 100%")}</h3>
      <div class="chart" id="sc-lev" style="height:300px;margin-top:8px"></div></div>
    <div class="panel"><h3>Долг, деньги и эскроу <span class="muted" style="font-weight:400;font-size:12px">· млрд ₽ на конец периода</span>${infoIcon("Долг, деньги и эскроу",
      "Левый столбик — весь долг из отчётности: проектное финансирование под эскроу-объекты и прочий долг (корпоративные и земельные кредиты, облигации, ЦФА). Правый — то, что этому долгу противостоит: остатки дольщиков на счетах эскроу и деньги на балансе. Обязательства по аренде в долг не включаются.",
      "Прочий долг = весь долг − проектное финансирование\nЧД − эскроу = долг − деньги − эскроу")}</h3>
      <div class="chart" id="sc-debt" style="height:300px;margin-top:8px"></div></div>
    <div class="panel"><h3>Показатели по периодам${infoIcon("Показатели по периодам",
      "Годовые величины — из годовой отчётности, последний столбец — LTM: скользящие 12 месяцев к отчётной дате. Балансовые статьи (долг, деньги, эскроу, проектное финансирование) берутся на отчётную дату, потоковые (выручка, EBITDA, прибыль) — за период.",
      "LTM = год − первое полугодие прошлого года + первое полугодие текущего\n(ЧД − эскроу) / EBITDA = (долг − деньги − эскроу) ÷ EBITDA\nПокрытие эскроу = эскроу ÷ проектное финансирование × 100%")}</h3>
      <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th style="text-align:left">Показатель, млрд ₽</th>${years.map(y => `<th>${pLabel(y)}</th>`).join("")}</tr></thead><tbody>
        ${[["Выручка", y => S[y].rev], ["EBITDA", y => S[y].eb], ["Общий долг", y => S[y].debt],
           ["Денежные средства", y => S[y].cash], ["Эскроу", y => S[y].escrow], ["Проектное финансирование", y => S[y].pf],
           ["Чистый долг − эскроу", y => S[y].nd_esc]].map(([lbl, f]) =>
          `<tr><td style="text-align:left">${lbl}</td>${years.map(y => `<td>${bn(f(y))}</td>`).join("")}</tr>`).join("")}
        <tr><td style="text-align:left"><b>(ЧД − эскроу) / EBITDA</b></td>${years.map(y => {
          const r = S[y].ratio; return `<td style="color:${levColor(r)};font-weight:600">${r == null ? "—" : fmt(r, 2) + "×"}</td>`; }).join("")}</tr>
        <tr><td style="text-align:left">Покрытие эскроу</td>${years.map(y => `<td>${S[y].cov == null ? "—" : fmt(S[y].cov, 0) + "%"}</td>`).join("")}</tr>
        ${[["ICR · EBITDA / проценты, ×", "icr"], ["ICR · EBIT / проценты, ×", "icr_ebit"]].map(([label, key]) => `<tr><td style="text-align:left">${label}</td>${years.map(y => { const n = ((c.fin || {})[y] || {})[key]; return `<td>${n == null ? "—" : fmt(n, 2) + "×"}</td>`; }).join("")}</tr>`).join("")}
      </tbody></table></div>
      <div class="muted" style="font-size:11px;margin-top:6px">${escA(c.eb_note || "")}</div></div>
    ${(c.erz_geo || []).length ? `<div class="panel"><h3>Где строит <span class="muted" style="font-weight:400;font-size:12px">· по данным ЕРЗ, ${plural((c.erz_geo || []).length, "регион", "региона", "регионов")}</span>${infoIcon("Где строит",
      "Объём текущего строительства застройщика по субъектам РФ: метры, число жилых комплексов, доля рынка региона и место в региональном топе ЕРЗ. Сумма по регионам совпадает с объёмом стройки группы целиком.",
      "Доля в регионе = метры застройщика в субъекте ÷ весь объём стройки в субъекте × 100%")}</h3>
      <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th style="text-align:left">Регион</th><th>Строится</th><th>ЖК</th><th>Доля региона</th><th>Место в регионе</th><th>С переносом срока</th></tr></thead><tbody>${
        (c.erz_geo || []).map(g => `<tr><td style="text-align:left">${escA(g.region)}</td>
          <td>${fmt(g.building_m2 / 1000, g.building_m2 >= 1e6 ? 0 : 1)} тыс. м²</td>
          <td>${g.projects}</td><td>${fmt(g.share_pct, 1)}%</td><td>${g.rank}</td>
          <td>${g.delayed_pct ? fmt(g.delayed_pct, 1) + "%" : "—"}</td></tr>`).join("")
      }</tbody></table></div></div>` : ""}
    <div class="panel"><h3>Облигации в обращении <span class="muted" style="font-weight:400;font-size:12px">· клик открывает карточку выпуска</span></h3>
      <div id="sc-bonds"><div class="loading" style="padding:14px">Загружаю выпуски…</div></div></div>`;

  wireInfoIcons(host);
  host.querySelector("#sc-back").onclick = () => { SECTOR.company = null; render(); };

  // выручка и EBITDA
  mkChart(host.querySelector("#sc-rev"), { ...CHART_BG,
    // в одной подсказке и деньги, и проценты: столбики — млрд ₽, линии маржи — проценты
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" },
      formatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.map(p => `${p.marker} ${p.seriesName}: <b>${
        p.value == null ? "—" : p.seriesName.startsWith("Маржа") ? fmt(p.value, 1) + "%" : fmt(p.value / 1000, 1) + " млрд ₽"}</b>`).join("<br>") },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 56, right: 64, top: 36, bottom: 28 },
    xAxis: { type: "category", data: years.map(pLabel), ...AX, axisTick: { show: false } },
    yAxis: [{ type: "value", name: "млрд ₽", ...AX, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v / 1000, 0) } },
      { type: "value", name: "маржа, %", ...AX, nameTextStyle: { ...AX.nameTextStyle, align: "left", padding: [0, 0, 0, 8] }, splitLine: { show: false }, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } }],
    series: [
      { name: "Выручка", type: "bar", barMaxWidth: 30, itemStyle: { color: "#4a90d9", borderRadius: [4, 4, 0, 0] }, data: years.map(y => S[y].rev) },
      { name: "EBITDA", type: "bar", barMaxWidth: 30, itemStyle: { color: "#e0a458", borderRadius: [4, 4, 0, 0] }, data: years.map(y => S[y].eb) },
      { name: "Чистая прибыль", type: "bar", barMaxWidth: 30, itemStyle: { color: "#7b8ff0", borderRadius: [4, 4, 0, 0] }, data: years.map(y => S[y].ni ?? null) },
      { name: "Маржа EBITDA", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 6,
        lineStyle: { width: 2, type: "dashed", color: "#e0a458" }, itemStyle: { color: "#e0a458" },
        data: years.map(y => (S[y].rev && S[y].eb != null) ? +(100 * S[y].eb / S[y].rev).toFixed(1) : null) },
      { name: "Маржа по прибыли", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 6,
        lineStyle: { width: 2, type: "dashed", color: "#7b8ff0" }, itemStyle: { color: "#7b8ff0" },
        data: years.map(y => (S[y].rev && S[y].ni != null) ? +(100 * S[y].ni / S[y].rev).toFixed(1) : null) }] });

  // нагрузка и покрытие эскроу
  // ранние годы искажают обе шкалы: у РКС в 2020-м проектного кредита почти не было,
  // и покрытие эскроу выходит 5 091%, у него же нагрузка доходила до 30× при крошечной
  // EBITDA. Шкалы подрезаем по разумному потолку, а обрезанные точки называем под графиком
  const cap = (vals, lim, soft) => { const v = vals.filter(x => x != null);
    return v.length && Math.max(...v) > lim ? soft : null; };
  const covs = years.map(y => S[y].cov), rats = years.map(y => S[y].ratio);
  const covCap = cap(covs, 250, 200), ratCap = cap(rats, 20, 15);
  const clipped = years.filter(y => (covCap && S[y].cov > covCap) || (ratCap && S[y].ratio > ratCap))
    .map(y => `${pLabel(y)}: ${S[y].ratio != null && ratCap && S[y].ratio > ratCap ? `нагрузка ${fmt(S[y].ratio, 1)}×` : ""}${
      (S[y].cov != null && covCap && S[y].cov > covCap) ? `${S[y].ratio != null && ratCap && S[y].ratio > ratCap ? ", " : ""}покрытие ${fmt(S[y].cov, 0)}%` : ""}`);
  if (clipped.length) host.querySelector("#sc-lev").insertAdjacentHTML("afterend",
    `<div class="muted" style="font-size:11px;margin-top:6px">Шкала подрезана, чтобы были видны обычные годы. За пределами графика — ${clipped.join("; ")}: проектного финансирования тогда почти не было, и отношение к нему не показательно.</div>`);
  mkChart(host.querySelector("#sc-lev"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, formatter: ps => ps.map(p => `${p.marker}${p.seriesName}: <b>${p.value == null ? "—" : fmt(p.value, p.seriesIndex ? 0 : 2) + (p.seriesIndex ? "%" : "×")}</b>`).join("<br>") },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 52, right: 56, top: 36, bottom: 28 },
    xAxis: { type: "category", data: years.map(pLabel), ...AX, axisTick: { show: false } },
    yAxis: [{ type: "value", name: "× EBITDA", ...AX, max: ratCap, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "×" } },
      { type: "value", name: "эскроу, %", ...AX, max: covCap, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" }, nameTextStyle: { ...AX.nameTextStyle, align: "left", padding: [0, 0, 0, 8] }, splitLine: { show: false } }],
    series: [
      { name: "(ЧД − эскроу) / EBITDA", type: "line", symbol: "circle", symbolSize: 7, connectNulls: true,
        lineStyle: { width: 2.4, color: "#4a90d9" }, itemStyle: { color: "#4a90d9" }, data: years.map(y => S[y].ratio == null ? null : +S[y].ratio.toFixed(2)) },
      { name: "Покрытие эскроу", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 6, connectNulls: true,
        lineStyle: { width: 2, type: "dashed", color: "#3ecf8e" }, itemStyle: { color: "#3ecf8e" }, data: years.map(y => S[y].cov == null ? null : Math.round(S[y].cov)) }] });

  // долг, деньги, эскроу
  mkChart(host.querySelector("#sc-debt"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: v => v == null ? "—" : fmt(v / 1000, 1) + " млрд ₽" },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 56, right: 20, top: 36, bottom: 28 },
    xAxis: { type: "category", data: years.map(pLabel), ...AX, axisTick: { show: false } },
    yAxis: { type: "value", name: "млрд ₽", ...AX, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v / 1000, 0) } },
    series: [
      { name: "Проектное финансирование", type: "bar", stack: "d", barMaxWidth: 34, barGap: "12%", itemStyle: { color: "#4a90d9" }, data: years.map(y => S[y].pf) },
      { name: "Прочий долг", type: "bar", stack: "d", barMaxWidth: 34, itemStyle: { color: "#8aa2bd" },
        data: years.map(y => (S[y].debt == null || S[y].pf == null) ? S[y].debt : Math.max(0, S[y].debt - S[y].pf)) },
      // эскроу и деньги — соседним столбиком: это то, что противостоит долгу
      { name: "Эскроу", type: "bar", stack: "c", barMaxWidth: 34, itemStyle: { color: "#3ecf8e" }, data: years.map(y => S[y].escrow) },
      { name: "Денежные средства", type: "bar", stack: "c", barMaxWidth: 34, itemStyle: { color: "#e0a458" }, data: years.map(y => S[y].cash) }] });

  // облигации компании
  await loadCompanyBonds(host.querySelector("#sc-bonds"), m.isins || []);
}

// список выпусков эмитента под карточкой сектора — одинаков для любой отрасли
async function loadCompanyBonds(box, isinList) {
  if (!box) return;
  const isins = (isinList || []).join(",");
  if (!isins) { box.innerHTML = `<div class="muted">биржевых выпусков нет</div>`; return; }
  try {
    const r = await fetch(`${API}/api/universe?isins=${encodeURIComponent(isins)}&limit=100`).then(x => x.json());
    const rows = (r.rows || []).sort((a, b) => (a.matdate || "") < (b.matdate || "") ? -1 : 1);
    box.innerHTML = `<div class="tbl-wrap"><table><thead><tr><th style="text-align:left">Выпуск</th><th>Тип</th><th>Объём</th><th>Доходность</th><th>Премия</th><th>Дюр./срок</th><th>Погашение</th><th>Оферта</th></tr></thead><tbody>${
      rows.map(b => `<tr data-isin="${b.isin}" style="cursor:pointer"><td style="text-align:left"><span class="link">${escA(b.name)}</span><div class="muted" style="font-size:10px">${b.isin}</div></td>
        <td>${b.kind === "floater" ? "флоатер" : "фикс"}${(b.currency && b.currency !== "RUB") ? " · " + b.currency : ""}</td>
        <td>${b.issue_volume == null ? "—" : fmt(b.issue_volume / 1e9, 1) + " млрд"}</td>
        <td>${b.kind === "floater" ? (b.current_yield == null ? "—" : fmt(b.current_yield, 2) + "%") : (b.ytm == null ? "—" : fmt(b.ytm, 2) + "%")}</td>
        <td>${(b.kind === "floater" ? b.dm_ofz_bp : b.g_spread_bp) == null ? "—" : "+" + fmt(b.kind === "floater" ? b.dm_ofz_bp : b.g_spread_bp, 0) + " б.п."}</td>
        <td>${b.kind === "floater" ? (b.years_to_maturity == null ? "—" : fmt(b.years_to_maturity, 1) + " г.") : (b.duration_years == null ? "—" : fmt(b.duration_years, 2) + " г.")}</td>
        <td>${b.matdate ? dmy(b.matdate) : "—"}</td><td>${b.offer_date ? dmy(b.offer_date) : "—"}</td></tr>`).join("")
      }</tbody></table></div>`;
    box.querySelectorAll("tr[data-isin]").forEach(tr => tr.onclick = () => openIssue(tr.dataset.isin));
  } catch (e) { box.innerHTML = `<div class="muted">не удалось загрузить выпуски</div>`; }
}

// ---------- сектор «Лизинг»: кредитный профиль лизинговых компаний ----------
// Лизинг — финансовый бизнес: EBITDA и эскроу тут не считаются. Качество читается через
// маржу (NIM), эффективность (CIR), стоимость риска (COR), проблемные активы и структуру
// фондирования. Цифры приходят готовым разбором из архива отчётности, мы их не пересчитываем.
// палитра линий сектора: первые три цвета — исторические (Европлан, Балтийский, Интерлизинг),
// дальше — оттенки, различимые и на тёмной, и на светлой теме, до трёх десятков компаний
const LEASE_PAL = ["#2fa89b", "#d99b3f", "#7b8ff0", "#d9453f", "#12a06a", "#b06fd4", "#4aa3e0",
  "#c9a227", "#e2734a", "#5fb85f", "#8a6fd4", "#3f97a8", "#cf5f9e", "#7a8b3f", "#d07b7b",
  "#4f7fd4", "#a8760c", "#2f9e7a", "#9e5fb8", "#6fa8d4", "#b8873f", "#5f9e5f", "#c45f5f",
  "#6f6fd4", "#3fa8a8", "#d48f3f", "#8fb83f", "#b84a8f", "#4fb8a0", "#9e7a3f"];
const leaseColor = (i) => LEASE_PAL[i % LEASE_PAL.length];
// порог тревоги по доле проблемных активов: до 4% — спокойно, выше 10% — много
const probColor = v => v == null ? "#8a8f98" : v < 4 ? "#12a06a" : v < 8 ? "#c9a227" : v < 12 ? "#a8760c" : "#d9453f";

// склонение по числу: 1 регион / 2 региона / 5 регионов
function plural(n, one, few, many) {
  const d1 = n % 10, d2 = n % 100;
  return `${n} ` + (d1 === 1 && d2 !== 11 ? one : d1 >= 2 && d1 <= 4 && (d2 < 12 || d2 > 14) ? few : many);
}

// ---------- карта России: где какой застройщик строит (данные ЕРЗ по субъектам) ----------
let RU_MAP = null;                       // {width, height, russia, regions:[{name, d, lx, ly}]}
async function ruMap() {
  if (!RU_MAP) RU_MAP = await fetch("/ru-regions.json").then(r => r.json()).catch(() => null);
  return RU_MAP;
}
// названия субъектов у ЕРЗ и на карте пишутся по-разному: «Чувашская Республика - Чувашия»
// против «Чувашия», «г.Москва» против «Москва». Приводим к общему короткому виду: выкидываем
// слова-типы («область», «край», «республика») и сводим прилагательные формы к коротким.
// Границы слов (\b) для кириллицы в JS не работают, поэтому чистим по токенам.
const REG_STOP = new Set(["республика", "республики", "автономный", "автономная", "автономного",
  "округ", "округа", "область", "области", "край", "края", "г", "гор", "город"]);
const REG_WORD = { "чувашская": "чувашия", "чеченская": "чечня", "удмуртская": "удмуртия",
  "балкарская": "балкария", "черкесская": "черкесия", "саха": "якутия", "алания": "осетия" };
function regKey(name) {
  const raw = String(name || "").toLowerCase().replace(/ё/g, "е")
    .replace(/[«»"(),.]/g, " ").replace(/[—–\-]/g, " ").split(/\s+/).filter(Boolean);
  const w = raw.filter(t => !REG_STOP.has(t)).map(t => REG_WORD[t] || t);
  return w.filter((t, i) => t !== w[i - 1]).join(" ");
}

// шкала заливки: чем больше метров, тем насыщеннее. Ноль — нейтральный серый
function mapFill(v, max) {
  if (!v || !max) return "var(--bg-2, #eceff1)";
  const t = Math.sqrt(v / max);            // корень — иначе всё, кроме Москвы, сливается
  const stops = [[221, 238, 233], [138, 208, 193], [52, 158, 139], [16, 94, 84]];
  const i = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const f = t * (stops.length - 1) - i;
  const c = stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

async function drawDevGeo(host, d) {
  const box = host.querySelector("#sec-geo");
  if (!box) return;
  const withGeo = (d.companies || []).filter(c => (c.erz_geo || []).length);
  if (!withGeo.length) {
    box.innerHTML = `<div class="muted" style="padding:20px">Разбивка по регионам пока не собрана.</div>`;
    return;
  }
  const map = await ruMap();
  // пока грузилась карта, вкладку могли переключить — панели уже нет в документе
  if (!document.body.contains(box)) return;
  if (!map) { box.innerHTML = `<div class="muted" style="padding:20px">Карта не загрузилась.</div>`; return; }

  const pick = SECTOR.geo && withGeo.some(c => c.company === SECTOR.geo) ? SECTOR.geo : "";
  // значения по регионам: одна группа или сумма всех разобранных
  const vals = new Map();                  // regKey → {m2, projects, rows:[{company, m2, share, rank}]}
  withGeo.forEach(c => (c.erz_geo || []).forEach(g => {
    if (pick && c.company !== pick) return;
    const k = regKey(g.region);
    const cur = vals.get(k) || { m2: 0, projects: 0, name: g.region, rows: [] };
    cur.m2 += g.building_m2; cur.projects += g.projects;
    cur.rows.push({ company: c.company, m2: g.building_m2, projects: g.projects, share: g.share_pct, rank: g.rank });
    vals.set(k, cur);
  }));
  const max = Math.max(...[...vals.values()].map(v => v.m2), 1);
  const tot = [...vals.values()].reduce((a, v) => a + v.m2, 0);
  const th = (x) => fmt(x / 1000, x >= 1e6 ? 0 : 1);            // м² → тыс. м²

  const chips = `<div class="chips" style="margin-bottom:10px">
    <span class="chip ${pick ? "" : "on"}" data-geo="">Все публичные</span>
    ${withGeo.map(c => `<span class="chip ${pick === c.company ? "on" : ""}" data-geo="${escA(c.company)}">${c.company}</span>`).join("")}</div>`;

  const paths = map.regions.map(r => {
    const v = vals.get(regKey(r.name));
    return `<path d="${r.d}" data-r="${escA(r.name)}" fill="${mapFill(v && v.m2, max)}"
      stroke="var(--line,#cfd8dc)" stroke-width="0.7" style="cursor:${v ? "pointer" : "default"}"></path>`;
  }).join("");
  // Москва и Питер на карте — точки: закрасить их площадью нельзя, рисуем кружок по объёму
  const dots = map.regions.filter(r => /^(Москва|Санкт-Петербург)$/.test(r.name) && vals.get(regKey(r.name)))
    .map(r => { const v = vals.get(regKey(r.name));
      const rad = 7 + 11 * Math.sqrt(v.m2 / max);
      return `<circle cx="${r.lx}" cy="${r.ly}" r="${rad}" data-r="${escA(r.name)}" fill="${mapFill(v.m2, max)}"
        stroke="#fff" stroke-width="1.4" style="cursor:pointer"></circle>
        <text x="${r.lx}" y="${r.ly - rad - 8}" text-anchor="middle" font-size="26" font-weight="600" fill="var(--muted,#8aa)">${r.name === "Москва" ? "Москва" : "СПб"}</text>`;
    }).join("");
  // шкала заливки под картой
  const legend = `<div style="display:flex;align-items:center;gap:8px;margin-top:6px">
    <span class="muted" style="font-size:11px">0</span>
    <div style="flex:0 0 160px;height:8px;border-radius:5px;background:linear-gradient(90deg, ${mapFill(max * 0.02, max)}, ${mapFill(max * 0.35, max)}, ${mapFill(max, max)})"></div>
    <span class="muted" style="font-size:11px">${th(max)} тыс. м²</span></div>`;

  const top = [...vals.values()].sort((a, b) => b.m2 - a.m2).slice(0, 12);
  const list = top.map(v => `<tr data-rn="${escA(v.name)}" style="cursor:default">
      <td style="text-align:left">${escA(v.name)}</td>
      <td style="text-align:right;white-space:nowrap">${th(v.m2)} тыс. м²</td>
      <td style="width:38%"><div style="height:7px;border-radius:4px;background:var(--bg-2,#eceff1)">
        <div style="height:7px;border-radius:4px;width:${Math.max(3, 100 * v.m2 / max)}%;background:#2fa89b"></div></div></td>
      <td style="text-align:right">${v.projects} ЖК</td></tr>`).join("");

  box.innerHTML = `${chips}
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1 1 560px;min-width:min(320px,100%);position:relative">
        <svg viewBox="0 0 ${map.width} ${map.height}" style="width:100%;height:auto;display:block">${paths}${dots}</svg>
        ${legend}
        <div id="geo-tip" class="muted" style="position:absolute;pointer-events:none;display:none;z-index:5;background:var(--panel,#fff);border:1px solid var(--line,#dde);border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.45;color:var(--text,#223);box-shadow:0 8px 20px rgba(0,0,0,.14);max-width:260px"></div>
      </div>
      <div style="flex:1 1 320px;min-width:min(280px,100%)">
        <div class="muted" style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px">Топ регионов · ${pick ? escA(pick) : "публичные застройщики"}</div>
        <div style="overflow-x:auto"><table style="width:100%;font-size:12.5px"><tbody>${list}</tbody></table></div>
        <div class="muted" style="font-size:11px;margin-top:8px">${pick ? escA(pick) : "Публичные застройщики"} строят ${th(tot)} тыс. м² в ${plural(vals.size, "регионе", "регионах", "регионах")}${d.erz_regions && d.erz_regions.as_of ? " · данные ЕРЗ на " + dmyErz(d.erz_regions.as_of) : ""}</div>
      </div>
    </div>`;

  box.querySelectorAll("[data-geo]").forEach(c => c.onclick = () => { SECTOR.geo = c.dataset.geo; drawDevGeo(host, d); });
  const tip = box.querySelector("#geo-tip"), svg = box.querySelector("svg");
  box.querySelectorAll("[data-r]").forEach(p => {
    p.onmousemove = e => {
      const v = vals.get(regKey(p.dataset.r));
      const totals = (d.erz_regions || {}).regions || {};
      const all = totals[p.dataset.r] || Object.entries(totals).find(([k]) => regKey(k) === regKey(p.dataset.r))?.[1];
      const rows = v ? [...v.rows].sort((a, b) => b.m2 - a.m2) : [];
      const who = pick ? escA(pick) : "публичных застройщиков";
      tip.innerHTML = `<b style="color:var(--text)">${escA(p.dataset.r)}</b>`
        + (v ? `<div>в стройке у ${who} <b>${th(v.m2)} тыс. м²</b>, ${plural(v.projects, "ЖК", "ЖК", "ЖК")}</div>` : `<div>публичных застройщиков здесь нет</div>`)
        + (all && all.total_m2 ? `<div>весь регион: ${th(all.total_m2)} тыс. м²${v ? ` · доля ${fmt(100 * v.m2 / all.total_m2, 0)}%` : ""}</div>` : "")
        + rows.slice(0, 5).map(r => `<div style="margin-top:3px">${escA(r.company)} — ${th(r.m2)} тыс. м², ${r.projects} ЖК, ${fmt(r.share, 1)}% региона, ${r.rank}-е место</div>`).join("");
      const b = svg.getBoundingClientRect();
      tip.style.display = "block";
      tip.style.left = Math.min(b.width - 270, Math.max(0, e.clientX - b.left + 12)) + "px";
      tip.style.top = Math.max(0, e.clientY - b.top + 12) + "px";
    };
    p.onmouseleave = () => { tip.style.display = "none"; };
    p.onclick = () => { const v = vals.get(regKey(p.dataset.r)); if (v && v.rows.length === 1 && !pick) { SECTOR.geo = v.rows[0].company; drawDevGeo(host, d); } };
  });
}
// дата ЕРЗ приходит как YYMMDD
const dmyErz = s => /^\d{6}$/.test(String(s || "")) ? `${s.slice(4, 6)}.${s.slice(2, 4)}.20${s.slice(0, 2)}` : String(s || "");

// рынок лизинга целиком: внешняя рамка к нашим эмитентам — исследования рейтингового агентства
function leasingMarketHTML(d) {
  const m = d.market_overview;
  if (!m || !m.kpi) return "";
  const seg = (m.forecast_2026 && m.forecast_2026.segments) || [];
  const rows = seg.map(x => `<tr><td style="text-align:left">${x.name}</td>
    <td style="color:${x.growth >= 25 ? "#12a06a" : "var(--text)"};font-weight:600">+${x.growth}%</td></tr>`).join("");
  return `<div class="panel"><h3>Рынок лизинга целиком <span class="muted" style="font-weight:400;font-size:13px">· ${escA(m.source || "")}</span></h3>
    <div class="kpis" style="margin-top:8px">${m.kpi.map(k => `<div class="kpi"><div class="label">${escA(k.label)}</div>
      <div class="value">${escA(k.value)}</div><div class="sub">${escA(k.sub || "")}</div></div>`).join("")}</div>
    <div style="display:flex;gap:22px;flex-wrap:wrap;margin-top:14px">
      <div style="flex:1;min-width:320px">
        <div class="muted" style="font-size:12px;margin-bottom:6px">Новый бизнес и портфель рынка, трлн ₽${(m.history || {}).forecast ? " · пунктир — прогноз на 2026 год" : ""}</div>
        <div class="chart" id="lz-mkt-hist" style="height:230px"></div>
      </div>
      <div style="flex:1;min-width:320px">
        <div class="muted" style="font-size:12px;margin-bottom:6px">Прогноз нового бизнеса на 2026 год · ${escA((m.forecast_2026 || {}).total || "")}</div>
        <div class="chart" id="lz-mkt-fc" style="height:230px"></div>
      </div>
      <div style="flex:1;min-width:260px;display:none">
        <table class="tbl"><thead><tr><th style="text-align:left">Сегмент</th><th>Рост</th></tr></thead><tbody>${rows}</tbody></table>
      </div>
      <div style="flex:1;min-width:260px">
        <div class="muted" style="font-size:12px;margin-bottom:6px">Что важно знать</div>
        <ul style="margin:0;padding-left:18px;line-height:1.5;font-size:13px">${(m.notes || []).map(n => `<li>${escA(n)}</li>`).join("")}
          ${(m.history || {}).forecast_note ? `<li>${escA(m.history.forecast_note)}</li>` : ""}</ul>
        <div class="muted" style="font-size:11px;margin-top:8px">Источник: <a href="${escA(m.source_url || "#")}" target="_blank" rel="noopener">raexpert.ru</a> · данные на ${dmy(m.as_of)}</div>
      </div>
    </div></div>`;
}

function renderLeasing(head, host, d) {
  const P = d.last_period, order = d.order || d.companies.map(c => c.company);
  const pLabel = p => p === d.last_period && /^\d+м/.test(p) ? `LTM ${p}` : p;
  // у части компаний история короче: последний раскрытый период у каждого свой, и в таблице
  // честнее показать его, а не пустую строку под LTM 6м2026
  const lastOf = c => { const ps = (d.periods || []).filter(x => (c.fin || {})[x]); return ps.length ? ps[ps.length - 1] : null; };
  const fin = (c, p) => (c.fin || {})[p || lastOf(c) || P] || {};
  const bnRub = x => x == null ? "—" : fmt(x / 1e9, x >= 1e11 ? 0 : 1);
  const bnMln = x => x == null ? "—" : fmt(x / 1000, Math.abs(x) >= 100000 ? 0 : 1);   // млн ₽ → млрд
  const pc = (v, n = 1) => v == null ? "—" : fmt(v, n) + "%";
  const allComps = order.map(n => d.companies.find(c => c.company === n)).filter(Boolean);
  // компаний с разобранной отчётностью много, и все линии сразу читать невозможно: по умолчанию
  // показываем десятку крупнейших по долгу на рынке, остальные — по переключателю
  const volOf = c => (c.market || {}).volume || 0;
  // компании без МСФО идут по РСБУ: сводная таблица сектора по кодам строк плюс полугодие
  // со сканов раскрытия. РСБУ и МСФО не равны — отсюда пунктир на графиках
  // графики сектора показываем с 2021 года: за 2019–2020 отчётность есть у трёх компаний
  // из сорока, и левая треть каждого графика уходила в пустоту. В карточке эмитента и в
  // таблице история остаётся полной
  const per = (d.periods || []).filter(p => /^\d{4}$/.test(p) ? +p >= 2021 : true);
  const interimRsbu = (d.rsbu_interim || {}).companies || {};
  const refRsbu = (d.rsbu_ref || {}).companies || {};
  const refKey = nm => { const k = (nm || "").toLowerCase().replace(/[«»"]/g, "").replace(/^(ооо|ао|пао)\s+/, "");
    return Object.keys(refRsbu).find(x => { const y = x.toLowerCase(); return y.slice(0, 7) === k.slice(0, 7) || k.includes(y.slice(0, 9)) || y.includes(k.slice(0, 9)); }); };
  const rsbuRows = (d.others || []).map(o => {
    const years = o.rsbu || {}, inn = String(o.inn || "");
    const ref = refRsbu[refKey(o.company)] || {};
    const half = Object.values(interimRsbu).find(v => String(v.inn || "") === inn);
    const series = per.map(p => (ref[p] || {}).roe ?? (p === "6м2026" ? (half ? half.roe : null) : (years[p] || {}).roe ?? null));
    return { company: o.company, vol: (o.market || {}).volume || 0, series, rsbu: true,
             has: series.some(x => x != null) };
  }).filter(r => r.has);
  const ranked = [...allComps].sort((a, b) => volOf(b) - volOf(a));
  const showMsfo = SECTOR.std !== "rsbu", showRsbu = SECTOR.std !== "msfo";
  // «Все» — это действительно все: и разобранные по МСФО, и те, у кого только РСБУ.
  // В топах компании обоих стандартов соревнуются за места по долгу на рынке
  const pool = [...(showMsfo ? ranked.map(c => ({ c, vol: volOf(c) })) : []),
                ...(showRsbu ? rsbuRows.map(r => ({ r, vol: r.vol })) : [])].sort((a, b) => b.vol - a.vol);
  // «Все» — это все виды отчётности сразу: кнопка сама переводит переключатель стандарта
  // в «оба», поэтому в ней всегда полное число эмитентов сектора, а не число внутри фильтра
  const total = ranked.length + rsbuRows.length;
  const TOPS = [[10, "Топ-10"], [20, "Топ-20"], ["all", `Все · ${total}`]];
  if (SECTOR.top !== "all" && pool.length <= SECTOR.top) SECTOR.top = "all";
  const picked = SECTOR.top === "all" ? pool : pool.slice(0, SECTOR.top);
  const comps = picked.filter(x => x.c).map(x => x.c);
  const rsbuShown = picked.filter(x => x.r).map(x => x.r);

  head.innerHTML = `
    ${sectorTabsHTML()}
    <h3 style="font-size:24px;margin:2px 0 6px">Кредитный профиль лизинговых компаний</h3>
    <div class="kpis" style="margin-top:14px">
      <div class="kpi"><div class="label">Эмитентов с облигациями</div><div class="value">${d.kpi.issuers}</div><div class="sub">${d.kpi.issues} выпусков в секторе</div></div>
      <div class="kpi"><div class="label">Долг на рынке</div><div class="value">${bnRub(d.kpi.volume)} млрд ₽</div><div class="sub">в обращении</div></div>
      <div class="kpi"><div class="label">Медианная премия</div><div class="value">+${fmt(d.kpi.median_spread_bp, 0)} б.п.</div><div class="sub">по сектору</div></div>
      <div class="kpi"><div class="label">Отчётность</div><div class="value">${d.kpi.reported} ${plural(d.kpi.reported, "компания", "компании", "компаний")}</div><div class="sub">разбор от ${dmy(d.as_of)}</div></div>
    </div>
    ${ranked.length > 10 ? `<div class="filters" style="margin-top:12px"><div class="field full"><label>Компании на графиках и в таблице</label>
      <div class="chips" id="lz-top">${TOPS.map(([k, l]) => `<span class="chip ${String(SECTOR.top) === String(k) ? "on" : ""}" data-top="${k}">${l}</span>`).join("")}</div>
      <div class="chips" id="lz-std" style="margin-top:8px">${[["msfo", "МСФО"], ["rsbu", "РСБУ"], ["both", "Оба стандарта"]]
        .map(([k, l]) => `<span class="chip ${SECTOR.std === k ? "on" : ""}" data-std="${k}">${l}</span>`).join("")}</div>
      <div class="muted" style="font-size:11px;margin-top:4px">по долгу на рынке, от крупнейших: ${ranked.length} ${plural(ranked.length, "компания", "компании", "компаний")} с разобранной МСФО (сплошные линии) и ${rsbuRows.length} с РСБУ по кодам строк (пунктир). Маржа, эффективность и качество портфеля есть только по МСФО: в РСБУ нет ни процентных доходов, ни стадий обесценения — по нему считаются рентабельность, долг и капитал</div></div></div>` : ""}`;
  head.querySelectorAll("[data-sec]").forEach(c => c.onclick = () => { SECTOR.key = c.dataset.sec; SECTOR.data = null; SECTOR.company = null; render(); });
  head.querySelectorAll("#lz-top [data-top]").forEach(c => c.onclick = () => {
    if (c.dataset.top === "all") { SECTOR.top = "all"; SECTOR.std = "both"; }
    else SECTOR.top = +c.dataset.top;
    render();
  });
  head.querySelectorAll("#lz-std [data-std]").forEach(c => c.onclick = () => { SECTOR.std = c.dataset.std; render(); });

  const COLS = [["company", "Компания", "l"], ["rating", "Рейтинг", "c"], ["nim", "NIM", "c"],
    ["cir", "CIR", "c"], ["roe", "ROE", "c"], ["cor", "COR", "c"], ["prob", "Проблемные активы", "c"],
    ["de", "Долг / капитал", "c"], ["bond_sh", "Доля облигаций в долге", "c"],
    ["spread", "Премия рынка", "c"], ["vol", "Долг на рынке", "c"]];
  const val = (c, k) => { const f = fin(c), m = c.market || {};
    return ({ company: c.company, rating: m.rating_score, nim: f.nim, cir: f.cir, roe: f.roe,
      cor: f.cor_full, prob: f.prob_sh, de: f.de, bond_sh: f.bond_sh,
      spread: m.spread_bp, vol: m.volume })[k]; };
  const tableHTML = () => {
    const rows = [...comps].sort((a, b) => { const x = val(a, SECTOR.sort), y = val(b, SECTOR.sort);
      if (x == null) return 1; if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y, "ru") : x - y) * (SECTOR.desc ? -1 : 1); });
    const arrow = k => SECTOR.sort === k ? (SECTOR.desc ? " ▾" : " ▴") : " ⇅";
    const body = rows.map(c => { const f = fin(c), m = c.market || {};
      return `<tr data-comp="${escA(c.company)}" style="cursor:pointer">
        <td style="text-align:left"><b style="color:${probColor(f.prob_sh)}">${c.company}</b><div class="muted" style="font-size:11px">${escA(c.full || "")}</div>
          ${lastOf(c) && lastOf(c) !== P ? `<div class="muted" style="font-size:10px">данные за ${pLabel(lastOf(c))}</div>` : ""}
          ${c.note ? `<div class="muted" style="font-size:10px;max-width:320px;line-height:1.3">${escA(c.note)}</div>` : ""}</td>
        <td>${m.rating ? `<span class="pill">${m.rating}</span>` : "—"}</td>
        <td>${pc(f.nim)}<div class="muted" style="font-size:10px">спред ${pc(f.spread)}</div></td>
        <td>${pc(f.cir)}</td>
        <td style="font-weight:600">${pc(f.roe)}</td>
        <td>${pc(f.cor_full)}</td>
        <td style="color:${probColor(f.prob_sh)};font-weight:600">${pc(f.prob_sh)}<div class="muted" style="font-size:10px;font-weight:400">стадия 3 ${pc(f.s3_sh)}</div></td>
        <td>${f.de == null ? "—" : fmt(f.de, 2) + "×"}<div class="muted" style="font-size:10px">капитал/активы ${pc(f.eqa, 0)}</div></td>
        <td>${pc(f.bond_sh, 0)}</td>
        <td>${m.spread_bp == null ? "—" : "+" + fmt(m.spread_bp, 0) + " б.п."}<div class="muted" style="font-size:10px">${m.issues || 0} вып.</div></td>
        <td>${bnRub(m.volume)} млрд</td></tr>`; }).join("");
    return `<div class="panel" id="sec-tbl"><h3>Показатели за ${pLabel(P)} <span class="muted" style="font-weight:400;font-size:12px">· клик по строке открывает карточку компании</span>${infoIcon("Показатели за " + pLabel(P),
        "NIM — чистый процентный доход к средним работающим активам. CIR — операционные расходы к доходу до резервов. COR — стоимость риска: резервы и потери к средним валовым ЧИЛ. Проблемные активы — стадия 3, изъятое имущество и задолженность по расторгнутым договорам к портфелю. Премия рынка — медиана по выпускам компании.",
        "NIM = ЧПД ÷ средние (деньги + валовые ЧИЛ) × 100%\nCIR = операционные расходы ÷ (ЧПД + чистый непроцентный доход) × 100%\nCOR = резервы и потери ÷ средние валовые ЧИЛ × 100%\nROE = чистая прибыль ÷ средний капитал × 100%")}</h3>
      <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr>${COLS.map(([k, l, al]) =>
        `<th data-k="${k}" style="cursor:pointer;user-select:none;text-align:${al === "l" ? "left" : "center"}">${l}<span class="muted" style="font-size:10px">${arrow(k)}</span></th>`).join("")}</tr></thead>
      <tbody>${body}</tbody></table></div>
      </div>`;
  };

  const msfoOnly = x => SECTOR.std === "rsbu" ? "" : x;
  host.innerHTML = msfoOnly(tableHTML())
    + secPanel("Рентабельность капитала", "по годам, ROE",
        { text: "Прибыль к среднему капиталу. Падение ROE у всех трёх в 2025 году — следствие удорожания фондирования и роста резервов.",
          formula: "ROE = чистая прибыль ÷ средний капитал × 100%" }, "lz-roe", 320)
    + msfoOnly(secPanel("Эффективность", "по годам, CIR",
        { text: "Какая доля операционного дохода уходит на содержание бизнеса: чем ниже, тем эффективнее. Рост CIR при падающем портфеле означает, что расходы не сжимаются так же быстро, как доход. В расходы входят персонал, административные и амортизация; доход считается до резервов.",
          formula: "CIR = операционные расходы ÷ (чистый процентный доход + чистый непроцентный доход) × 100%" }, "lz-cir", 320))
    + msfoOnly(secPanel("Стоимость риска", "по годам, COR",
        { text: "Сколько портфеля за год ушло в резервы и потери по изъятому имуществу. Резкий рост COR — первый сигнал ухудшения качества.",
          formula: "COR = (резервы по ЧИЛ + резервы по расторгнутым договорам и претензиям + обесценение и результат выбытия изъятого имущества + расходы на его содержание + прочие резервы) ÷ средние валовые ЧИЛ × 100%" }, "lz-cor", 320))
    + msfoOnly(secPanel("Процентная маржа", "по годам, NIM",
        { text: "Сколько процентного дохода остаётся после стоимости фондирования. Маржа держится, когда компания успевает переложить подорожавшее фондирование в ставки новых договоров. Работающие активы — деньги и валовые чистые инвестиции в лизинг, средние по началу и концу периода.",
          formula: "NIM = чистый процентный доход ÷ средние (деньги + валовые ЧИЛ) × 100%" }, "lz-nim", 320))
    + msfoOnly(secPanel("Доля непроцентного дохода", "по годам",
        { text: "Какая часть операционного дохода приходится не на процентную маржу, а на страховые и агентские комиссии, услуги, операционную аренду и прочее. Высокая доля делает доход устойчивее: комиссии не зависят от стоимости фондирования, а вместе с ростом портфеля растут.",
          formula: "Доля непроцентного дохода = чистый непроцентный доход ÷ (чистый процентный доход + чистый непроцентный доход) × 100%" }, "lz-noni", 320))
    + msfoOnly(secPanel("Качество портфеля", `на отчётную дату ${pLabel(P)}`,
        { text: "Столбик — доля проблемных активов: стадия 3, изъятое имущество и задолженность по расторгнутым договорам. Точка — покрытие стадии 3 резервом. У Балтийского лизинга дефолтные договоры расторгаются почти сразу, поэтому стадия 3 у него около нуля, а покрытие выше 300%: сравнивать его стадию 3 с другими нельзя, сопоставима только доля проблемных активов.",
          formula: "Проблемные активы = (ЧИЛ стадии 3 + изъятое имущество + расторгнутые договоры) ÷ (валовые ЧИЛ + изъятое имущество + расторгнутые договоры) × 100%\nПокрытие стадии 3 = весь резерв по ЧИЛ ÷ ЧИЛ стадии 3 × 100%" }, "lz-qual", 330, unitSw("lz-qual", "pct")))
    + msfoOnly(secPanel("Долговая нагрузка и капитал", `на отчётную дату ${pLabel(P)}`,
        { text: "Долг к капиталу — рычаг лизинговой компании; капитал к активам — подушка на случай потерь по портфелю. В долг входят кредиты банков, облигации и прочие займы; обязательства по аренде и авансы лизингополучателей — нет.",
          formula: "Долг / капитал = (кредиты банков + облигации + прочие займы) ÷ капитал\nКапитал / активы = капитал ÷ активы × 100%" }, "lz-lev", 320))
    + msfoOnly(secPanel("Структура фондирования", "весь долг",
        { text: "Банковские кредиты, облигации и прочие займы. Чем выше доля облигаций, тем сильнее компания зависит от настроения рынка при рефинансировании. Подпись над столбиком — доля облигаций во всём долге.",
          formula: "Доля облигаций = облигации ÷ (кредиты банков + облигации + прочие займы) × 100%" }, "lz-fund", 320, unitSw("lz-fund", "rub")))
    + msfoOnly(secPanel("Тип ставки по всему долгу", `на отчётную дату ${pLabel(P)}`,
        { text: "Весь долг из отчётности, разложенный по типу ставки. Облигации делятся на фикс и флоатеры по нашим рыночным данным (объём выпусков в обращении). Банковские кредиты отнесены к плавающей ставке: лизинговые компании фондируются в банках по ключевой ставке плюс спред, отдельной строкой тип ставки в отчётности не раскрывается — это допущение, а не цифра из отчёта. Прочие займы показаны отдельно: по ним ставка тоже не раскрыта. Чем больше плавающая часть, тем сильнее стоимость долга ходит за ключевой ставкой.",
          formula: "Фикс = облигации × доля выпусков с фиксированным купоном\nПлавающая = облигации × доля флоатеров + банковские кредиты\nДоля плавающей = плавающая ÷ весь долг × 100%" }, "lz-rate", 320, unitSw("lz-rate", "rub")))
    + leasingMarketHTML(d)
    + sectorCurveHTML(d, "Срок и премия облигаций лизинговых компаний. Цветом выделены компании с разобранной отчётностью.")
    + secPanel("Карта погашений облигаций", "по компаниям с отчётностью",
        { text: "Сколько номинала гасится в каждом году: погашения и амортизации. Оферты показаны отдельным столбцом — это право инвестора предъявить бумагу досрочно, а не обязательный платёж. Подпись над столбиком — сумма погашений и амортизаций за год.",
          formula: "Год = Σ по выпускам компаний с отчётностью: амортизации на свои даты + остаток номинала на дату погашения" }, "sec-red", 300)
    + leasingAllHTML(d);

  const bindRows = () => host.querySelectorAll("tr[data-comp]").forEach(tr =>
    tr.onclick = () => openCompanyCard(tr.dataset.comp));
  const bindSort = () => host.querySelectorAll("th[data-k]").forEach(th => th.onclick = () => {
    if (SECTOR.sort === th.dataset.k) SECTOR.desc = !SECTOR.desc; else { SECTOR.sort = th.dataset.k; SECTOR.desc = true; }
    host.querySelector("#sec-tbl").outerHTML = tableHTML(); bindSort(); bindRows();
  });
  bindSort(); bindRows();
  wireInfoIcons(host);

  const names = comps.map(c => c.company);
  // качество портфеля раскрывается в примечаниях к годовому отчёту, в промежуточном его нет:
  // берём последний период, где показатель вообще есть, и подписываем его на оси
  const lastWith = (c, key) => { const ps = (d.periods || []).filter(x => ((c.fin || {})[x] || {})[key] != null); return ps.length ? ps[ps.length - 1] : null; };
  const finQ = c => { const p = lastWith(c, "prob_sh") || lastWith(c, "allow_sh") || lastOf(c); return (c.fin || {})[p] || {}; };
  const qNames = comps.map(c => { const p = lastWith(c, "prob_sh") || lastWith(c, "allow_sh"); return p && p !== P ? `${c.company}\n${pLabel(p)}` : c.company; });
  // семнадцать названий в строку не помещаются и наезжают друг на друга, поэтому
  // разворачиваем их по диагонали и оставляем снизу место
  const axCat = { type: "category", data: names, ...AX, axisTick: { show: false },
    axisLine: { show: true, onZero: true, lineStyle: { color: cssVar("--line", "#2a2f38") } },
    axisLabel: { color: cssVar("--text", "#e6e9ef"), fontSize: 10, fontWeight: 600, interval: 0,
      margin: 10, rotate: names.length > 8 ? 32 : 0, align: names.length > 8 ? "right" : "center",
      width: 120, overflow: "truncate" } };
  const grad = (c1, c2) => ({ type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }] });
  const pctAxis = (name) => ({ type: "value", ...AX, name, nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
    splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } },
    axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } });

  // маржа, эффективность, рентабельность и стоимость риска — динамикой по годам
  const rsbuSeries = key => key !== "roe" ? [] : rsbuShown.map((r, i) => ({
    name: r.company + " (РСБУ)", type: "line", connectNulls: true, symbol: "circle", symbolSize: 4,
    lineStyle: { width: 1.6, type: "dashed", color: leaseColor(comps.length + i), opacity: .9 },
    itemStyle: { color: leaseColor(comps.length + i) }, data: r.series }));
  const lineSeries = key => comps.map((c, i) => ({ name: c.company, type: "line", connectNulls: true,
    symbol: "circle", symbolSize: 6, lineStyle: { width: 2.4, color: leaseColor(i) }, itemStyle: { color: leaseColor(i) },
    data: per.map(pp => (c.fin[pp] || {})[key] ?? null) }));
  const lineOpt = (key, name) => ({ ...CHART_BG,
    // компании с неполной историей (Интерлизинг с 2023) не должны висеть пустой строкой
    tooltip: { trigger: "axis", confine: true, formatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.filter(x => x.value != null)
      .map(x => `${x.marker} ${x.seriesName}: <b>${fmt(x.value, 2)}%</b>`).join("<br>") },
    // компаний бывает под тридцать: легенда прокручивается в одну строку, иначе она
    // разрастается на два ряда и наезжает на подпись оси
    legend: { top: 0, type: "scroll", textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 },
      itemWidth: 14, itemHeight: 8, pageIconColor: cssVar("--muted", "#8aa"),
      pageTextStyle: { color: cssVar("--muted", "#8aa"), fontSize: 10 } },
    grid: { left: 54, right: 24, top: 52, bottom: 30 },
    xAxis: { type: "category", data: per.map(pLabel), ...AX },
    yAxis: { ...pctAxis(name), nameGap: 22 }, series: lineSeries(key).concat(rsbuSeries(key)),
    graphic: (SECTOR.std === "rsbu" && key === "roe") ? [{ type: "text", right: 16, top: 30,
      style: { text: "пунктир — РСБУ", fill: cssVar("--muted", "#8aa"), fontSize: 11 } }] : [] });
  // рынок целиком: динамика и прогноз по сегментам
  const mo = d.market_overview || {};
  const mh = mo.history;
  if (mh && host.querySelector("#lz-mkt-hist")) {
    mkChart(host.querySelector("#lz-mkt-hist"), { ...CHART_BG,
      tooltip: { trigger: "axis", confine: true, valueFormatter: v => v == null ? "—" : fmt(v / 1000, 2) + " трлн ₽" },
      legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 52, right: 18, top: 34, bottom: 28 },
      // подписываем каждый год: иначе ECharts прячет часть меток и прогнозный 2026-й
      // оказывается без подписи под самым правым столбиком
      xAxis: { type: "category", data: mh.periods, ...AX,
        axisLabel: { color: AXIS_TXT, fontSize: 11, interval: 0 } },
      yAxis: { type: "value", ...AX, name: "трлн ₽", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
        splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } },
        axisLabel: { color: AXIS_TXT, formatter: v => fmt(v / 1000, 0) } },
      series: [
        { name: "Портфель", type: "line", symbol: "circle", symbolSize: 6, smooth: false,
          lineStyle: { width: 2.4, color: "#2fa89b" }, itemStyle: { color: "#2fa89b" }, data: mh.portfolio },
        { name: "Новый бизнес", type: "bar", barMaxWidth: 26, itemStyle: { color: "#d99b3f", borderRadius: [4, 4, 0, 0] }, data: mh.new_business },
        // прогноз — такой же столбик, но пунктиром и без заливки: его не спутать с фактом,
        // а высоту видно рядом с последним фактическим годом
        ...(mh.forecast ? [{ name: "Прогноз нового бизнеса", type: "bar", barMaxWidth: 26, barGap: "-100%",
          itemStyle: { color: "transparent", borderColor: "#a8760c", borderType: "dashed",
            borderWidth: 2, borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: "top", fontSize: 11, color: "#a8760c",
            formatter: p => p.value == null ? "" : fmt(p.value / 1000, 2) + " трлн" },
          data: mh.forecast.map((v, i) => i === mh.periods.length - 1 ? v : null) }] : [])] });
  }
  const seg = ((mo.forecast_2026 || {}).segments || []).slice().sort((a, b) => a.growth - b.growth);
  if (seg.length && host.querySelector("#lz-mkt-fc")) {
    mkChart(host.querySelector("#lz-mkt-fc"), { ...CHART_BG,
      tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: v => "+" + fmt(v, 0) + "% к 2025 году" },
      grid: { left: 150, right: 34, top: 10, bottom: 28 },
      xAxis: { type: "value", ...AX, axisLabel: { color: AXIS_TXT, formatter: v => "+" + fmt(v, 0) + "%" },
        splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } } },
      yAxis: { type: "category", data: seg.map(x => x.name), ...AX,
        axisLabel: { color: cssVar("--text", "#e6e9ef"), fontSize: 11, interval: 0 } },
      series: [{ type: "bar", barMaxWidth: 16, itemStyle: { color: "#7b8ff0", borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", fontSize: 11, color: cssVar("--muted", "#8aa"), formatter: p => "+" + fmt(p.value, 0) + "%" },
        data: seg.map(x => x.growth) }] });
  }
  const mkAt = (sel, opt) => { const el = host.querySelector(sel); if (el) mkChart(el, opt); };
  mkAt("#lz-nim", lineOpt("nim", "NIM, %"));
  mkAt("#lz-cir", lineOpt("cir", "CIR, %"));
  mkAt("#lz-roe", lineOpt("roe", "ROE, %"));
  mkAt("#lz-cor", lineOpt("cor_full", "COR, %"));
  mkAt("#lz-noni", lineOpt("nonint_sh", "доля непроцентного дохода, %"));

  // качество портфеля: в процентах — доли портфеля, в рублях — суммы тех же слагаемых
  const bnq = v => v == null ? null : +(v / 1000).toFixed(2);
  UNIT_DRAW["lz-qual"] = () => {
    const rub = UNIT["lz-qual"] === "rub";
    const s3v = c => { const f = finQ(c); return rub ? (f.prob_sh == null ? null : bnq(f.s3)) : f.s3_sh; };
    const restv = c => { const f = finQ(c); if (f.prob_sh == null) return null;
      return rub ? bnq((f.repo || 0) + (f.term || 0)) : Math.max(0, +(f.prob_sh - (f.s3_sh || 0)).toFixed(2)); };
    const totv = c => { const f = finQ(c); if (f.prob_sh == null) return null;
      return rub ? (f.s3 == null ? null : (f.s3 + (f.repo || 0) + (f.term || 0)) / 1000) : f.prob_sh; };
    mkAt("#lz-qual", { ...CHART_BG,
      tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, formatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.filter(x => x.value != null).map(x =>
        `${x.marker}${x.seriesName}: <b>${x.seriesIndex === 2 || !rub ? fmt(x.value, 2) + "%" : fmt(x.value, 1) + " млрд ₽"}</b>`).join("<br>") },
      legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 54, right: 70, top: 40, bottom: names.length > 8 ? 96 : 34 },
      xAxis: { ...axCat, data: qNames },
      yAxis: [rub ? { ...pctAxis("млрд ₽"), axisLabel: { color: AXIS_TXT, formatter: bnAxis } } : pctAxis("доля портфеля, %"),
        { type: "value", ...AX, name: "покрытие, %", nameTextStyle: { ...AX.nameTextStyle, align: "left", padding: [0, 0, 0, 8] }, splitLine: { show: false }, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } }],
      series: [
        { name: "Стадия 3", type: "bar", stack: "q", barMaxWidth: 30, itemStyle: { color: "#d9453f", borderRadius: [0, 0, 0, 0] }, data: comps.map(s3v) },
        { name: "Изъятое имущество и расторгнутые договоры", type: "bar", stack: "q", barMaxWidth: 30,
          itemStyle: { color: "#e2a03f", borderRadius: [5, 5, 0, 0] }, label: { show: true, position: "top", distance: 6, fontSize: 11, color: cssVar("--muted", "#8aa"),
            formatter: p => { const t = totv(comps[p.dataIndex]); return t == null ? "" : rub ? fmt(t, t < 10 ? 1 : 0) : fmt(t, 1) + "%"; } },
          data: comps.map(restv) },
        { name: "Покрытие стадии 3 резервом", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 8,
          lineStyle: { width: 0 }, itemStyle: { color: "#7b8ff0" }, data: comps.map(c => finQ(c).s3_cov) }] });
  };
  UNIT_DRAW["lz-qual"]();

  // нагрузка и капитал
  mkAt("#lz-lev", { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" } },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 54, right: 70, top: 40, bottom: names.length > 8 ? 96 : 34 },
    xAxis: axCat,
    yAxis: [{ type: "value", ...AX, name: "× капитала", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
        splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } },
        axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "×" } },
      { type: "value", ...AX, name: "капитал/активы, %", nameTextStyle: { ...AX.nameTextStyle, align: "left", padding: [0, 0, 0, 8] }, splitLine: { show: false }, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } }],
    series: [
      { name: "Долг / капитал", type: "bar", barMaxWidth: 30, itemStyle: { color: grad("#56c4b6", "#2fa89b"), borderRadius: [5, 5, 0, 0] },
        label: { show: true, position: "top", distance: 6, fontSize: 11, color: cssVar("--muted", "#8aa"), formatter: p => p.value == null ? "" : fmt(p.value, 2) + "×" },
        data: comps.map(c => fin(c).de) },
      { name: "Капитал / активы", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 8, lineStyle: { width: 0 },
        itemStyle: { color: "#d99b3f" }, data: comps.map(c => fin(c).eqa) }] });

  // структура фондирования: в рублях — суммы, в процентах — доли во всём долге
  const fundOf = (c, k) => { const v = fin(c)[k]; return v == null ? null : +(v / 1000).toFixed(1); };   // млн → млрд
  UNIT_DRAW["lz-fund"] = () => {
    const pctM = UNIT["lz-fund"] === "pct";
    const sh = (c, k) => fin(c)[k] ?? null;
    mkAt("#lz-fund", { ...CHART_BG,
      tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: v => v == null ? "—" : pctM ? fmt(v, 1) + "%" : fmt(v, 1) + " млрд ₽" },
      legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 58, right: 24, top: 40, bottom: names.length > 8 ? 96 : 34 },
      xAxis: axCat,
      yAxis: { type: "value", ...AX, name: pctM ? "доля в долге, %" : "млрд ₽", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
        splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } },
        ...(pctM ? { max: 100, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } } : { axisLabel: { color: AXIS_TXT, formatter: bnAxis } }) },
      series: [
        { name: "Банковские кредиты", type: "bar", stack: "f", barMaxWidth: 34, itemStyle: { color: "#5b93de" }, data: comps.map(c => pctM ? sh(c, "bank_sh") : fundOf(c, "bank")) },
        { name: "Облигации", type: "bar", stack: "f", barMaxWidth: 34, itemStyle: { color: "#d99b3f" }, data: comps.map(c => pctM ? sh(c, "bond_sh") : fundOf(c, "bonds")) },
        // подпись ставим на верхний слой стопки: в рублях — доля облигаций, в процентах — весь долг
        { name: "Прочие займы", type: "bar", stack: "f", barMaxWidth: 34, itemStyle: { color: "#8aa2bd" },
          label: { show: true, position: pctM ? "insideTop" : "top", distance: 8, fontSize: 11, color: cssVar("--muted", "#8aa"),
            formatter: p => { const f = fin(comps[p.dataIndex]);
              if (pctM) return "";
              return f.bond_sh == null ? "" : fmt(f.bond_sh, 0) + "%"; } },
          data: comps.map(c => pctM ? sh(c, "oth_sh") : fundOf(c, "oth")) }] });
  };
  UNIT_DRAW["lz-fund"]();

  // тип ставки по всему долгу: облигации делим по рынку, банковские кредиты — плавающие
  const rateSplit = c => {
    const f = fin(c), m = c.market || {};
    const fx = m.volume_fixed || 0, fl = m.volume_floater || 0;
    const flShare = (fx + fl) ? fl / (fx + fl) : null;
    const bonds = f.bonds == null ? null : f.bonds / 1000;      // млн → млрд
    const bank = f.bank == null ? null : f.bank / 1000;
    const oth = f.oth == null ? null : f.oth / 1000;
    const bFix = (bonds == null || flShare == null) ? bonds : bonds * (1 - flShare);
    const bFlo = (bonds == null || flShare == null) ? null : bonds * flShare;
    const float = (bFlo || 0) + (bank || 0);
    const total = (bonds || 0) + (bank || 0) + (oth || 0);
    return { fix: bFix == null ? null : +bFix.toFixed(1), float: +float.toFixed(1),
      oth: oth == null ? null : +oth.toFixed(1), share: total ? 100 * float / total : null };
  };
  const rs = comps.map(rateSplit);
  UNIT_DRAW["lz-rate"] = () => {
    const pctM = UNIT["lz-rate"] === "pct";
    const tot = x => (x.fix || 0) + (x.float || 0) + (x.oth || 0);
    const v = (x, k) => x[k] == null ? null : pctM ? (tot(x) ? +(100 * x[k] / tot(x)).toFixed(1) : null) : x[k];
    mkAt("#lz-rate", { ...CHART_BG,
      tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: v => v == null ? "—" : pctM ? fmt(v, 1) + "%" : fmt(v, 1) + " млрд ₽" },
      legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 58, right: 24, top: 40, bottom: names.length > 8 ? 96 : 34 },
      xAxis: axCat,
      yAxis: { type: "value", ...AX, name: pctM ? "доля в долге, %" : "млрд ₽", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
        splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } },
        ...(pctM ? { max: 100, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } } : { axisLabel: { color: AXIS_TXT, formatter: bnAxis } }) },
      series: [
        { name: "Фикс — облигации", type: "bar", stack: "r", barMaxWidth: 34, itemStyle: { color: "#2fa89b" }, data: rs.map(x => v(x, "fix")) },
        { name: "Плавающая — флоатеры и банковские кредиты", type: "bar", stack: "r", barMaxWidth: 34, itemStyle: { color: "#d99b3f" }, data: rs.map(x => v(x, "float")) },
        { name: "Прочие займы — ставка не раскрыта", type: "bar", stack: "r", barMaxWidth: 34, itemStyle: { color: "#8aa2bd" },
          label: { show: !pctM, position: "top", distance: 6, fontSize: 11, color: cssVar("--muted", "#8aa"),
            formatter: p => rs[p.dataIndex].share == null ? "" : "плавающая " + fmt(rs[p.dataIndex].share, 0) + "%" },
          data: rs.map(x => v(x, "oth")) }] });
  };
  UNIT_DRAW["lz-rate"]();
  wireUnitSw(host);

  drawSectorCurve(host, d, "Прочие лизинговые компании");
  drawSectorRedemption(host, d);
  bindLeasingAll(host, d);
}

// ── все эмитенты сектора: годовая РСБУ-отчётность из ГИР БО ФНС ──
function leasingRows(d) {
  const rows = (d.others || []).map(o => ({ company: o.company, market: o.market, rsbu: o.rsbu || {}, inn: o.inn, deep: false }));
  (d.companies || []).forEach(c => rows.push({ company: c.company, market: c.market, rsbu: c.rsbu || {}, inn: c.inn, deep: true }));
  return rows;
}

function leasingAllHTML(d) {
  // к годам ГИР БО добавляем полугодие 2026-го: его мы сняли со сканов раскрытия
  const interim = (d.rsbu_interim || {}).companies || {};
  const refRsbu = (d.rsbu_ref || {}).companies || {};
  const years = (d.rsbu_years || []).filter(y => +y >= 2021).concat(
    (Object.keys(interim).length || Object.keys(refRsbu).length) ? ["6м2026"] : []);
  // сводная таблица сектора: те же коды строк, но глубже и с полугодием
  const refKey = nm => { const k = (nm || "").toLowerCase().replace(/[«»"]/g, "").replace(/^(ооо|ао|пао)\s+/, "");
    return Object.keys(refRsbu).find(x => { const y = x.toLowerCase(); return y.slice(0, 7) === k.slice(0, 7) || k.includes(y.slice(0, 9)) || y.includes(k.slice(0, 9)); }); };
  if (!years.length) return sectorOthersHTML(d, "Другие лизинговые компании на рынке");
  if (!years.includes(SECTOR.rsbuYear)) SECTOR.rsbuYear = years[years.length - 1];
  const Y = SECTOR.rsbuYear;
  const bn = x => x == null ? "—" : fmt(x / 1000, Math.abs(x) >= 100000 ? 0 : 1);      // млн → млрд
  const bnRub = x => x == null ? "—" : fmt(x / 1e9, x >= 1e11 ? 0 : 1);
  // полугодие берём из отдельного разбора: там только баланс, выручки и прибыли нет
  const byInn = {}; Object.entries(interim).forEach(([nm, v]) => { if (v.inn) byInn[String(v.inn)] = { ...v, _name: nm }; });
  // компании с разобранной МСФО: их полугодие лежит в основном блоке сектора, а не в РСБУ
  const msfoBy = {};
  (d.companies || []).forEach(c => { const f = (c.fin || {})["6м2026"]; if (f) msfoBy[c.company] = f; });
  const half = r => {
    const v = byInn[String(r.inn || "")] || interim[r.company];
    if (v) {
      // прибыль за полугодие выведена из изменения капитала — в форме 0710001 обе даты стоят рядом
      return { assets: v.assets, equity: v.eq, debt: v.debt, de: v.de, eqa: v.eqa,
        profit: v.profit_6m, roe: v.roe, roa: v.roa, note: v.note, derived: v.profit_6m != null };
    }
    const f = msfoBy[r.company] || msfoBy[(r.company || "").replace(/ · разобран МСФО$/, "")];
    if (f) return { assets: f.assets, equity: f.eq, debt: f.debt, de: f.de, eqa: f.eqa,
      profit: f.ni, roe: f.roe, msfo: true };
    return {};
  };
  const fromRef = (r, per) => { const k = refKey(r.company); const v = k && (refRsbu[k] || {})[per]; if (!v) return null;
    return { assets: v.assets, equity: v.eq, debt: v.debt, de: v.de, eqa: v.eqa,
      revenue: v.revenue, profit: v.profit, roe: v.roe, ref: true }; };
  const rows = leasingRows(d).map(r => ({ ...r, y: fromRef(r, Y) || (Y === "6м2026" ? half(r) : (r.rsbu[Y] || {})) }))
    .sort((a, b) => (b.y.assets ?? -1) - (a.y.assets ?? -1));
  const body = rows.map(r => `<tr data-lease="${escA(r.company)}" style="cursor:pointer">
      <td style="text-align:left"><b>${escA(r.company)}</b>${r.deep ? ` <span class="muted" style="font-size:10px">· разобран МСФО</span>` : ""}
        <div class="muted" style="font-size:10px">${r.inn ? "ИНН " + r.inn : "отчётность не найдена"}</div>
        ${r.y.note ? `<div class="muted" style="font-size:10px;max-width:280px;line-height:1.3">${escA(r.y.note)}</div>` : ""}</td>
      <td>${r.market && r.market.rating ? `<span class="pill">${r.market.rating}</span>` : "—"}</td>
      <td>${bn(r.y.assets)}</td>
      <td>${bn(r.y.equity)}</td>
      <td>${bn(r.y.debt)}</td>
      <td style="font-weight:600">${r.y.de == null ? "—" : fmt(r.y.de, 1) + "×"}</td>
      <td>${r.y.eqa == null ? "—" : fmt(r.y.eqa, 0) + "%"}</td>
      <td>${bn(r.y.revenue)}${Y === "6м2026" ? `<div class="muted" style="font-size:10px">не раскрыта</div>` : ""}</td>
      <td>${bn(r.y.profit)}${r.y.derived ? `<div class="muted" style="font-size:10px">из изменения капитала</div>`
        : r.y.msfo ? `<div class="muted" style="font-size:10px">МСФО, к году</div>`
        : r.y.ref && Y === "6м2026" ? `<div class="muted" style="font-size:10px">за полугодие</div>` : ""}</td>
      <td style="color:${r.y.roe == null ? "inherit" : r.y.roe < 0 ? "#d9453f" : r.y.roe > 20 ? "#12a06a" : "inherit"}">${r.y.roe == null ? "—" : fmt(r.y.roe, 1) + "%"}</td>
      <td>${r.market && r.market.spread_bp != null ? "+" + fmt(r.market.spread_bp, 0) + " б.п." : "—"}</td>
      <td>${r.market ? bnRub(r.market.volume) + " млрд" : "—"}</td></tr>`).join("");
  return `<div class="panel" id="lz-all"><h3>Все лизинговые эмитенты <span class="muted" style="font-weight:400;font-size:12px">· годовая отчётность РСБУ, клик по строке открывает карточку</span>${infoIcon("Все лизинговые эмитенты",
      "Сопоставимый срез по всему сектору: у малых компаний отчётность на раскрытии лежит сканами, поэтому берём машиночитаемую бухгалтерскую отчётность из ГИР БО ФНС — она есть у каждого российского юрлица и сведена по единым кодам строк. У трёх групп рядом есть разбор МСФО с маржой и качеством портфеля, у остальных — балансовые показатели. РСБУ и МСФО не равны: в РСБУ лизинговый портфель отражается как доходные вложения в материальные ценности, а не как чистые инвестиции в лизинг, поэтому активы и капитал могут отличаться от консолидированной отчётности.",
      "Долг = долгосрочные заёмные средства (1410) + краткосрочные (1510)\nДолг / капитал = долг ÷ капитал (1300)\nКапитал / активы = капитал ÷ баланс (1600) × 100%\nROE = чистая прибыль (2400) ÷ капитал × 100%\n\nЗа 6м2026: прибыль выведена из изменения капитала между 31.12 и 30.06 (обе даты стоят в одной форме), ROE приведён к годовым. Проверено на Роделене и КОНТРОЛ лизинге — совпало с формой 0710002 до тысячи рублей.")}</h3>
    <div class="chips" style="margin-top:10px">${years.map(y => `<span class="chip ${y === Y ? "on" : ""}" data-ry="${y}">${y}</span>`).join("")}</div>
    <div class="tbl-wrap" style="margin-top:8px;max-height:560px;overflow:auto"><table><thead><tr>
      <th style="text-align:left">Эмитент</th><th>Рейтинг</th><th>Активы</th><th>Капитал</th><th>Долг</th>
      <th>Долг / капитал</th><th>Капитал / активы</th><th>Выручка</th><th>Прибыль</th><th>ROE</th>
      <th>Премия рынка</th><th>Долг на рынке</th></tr></thead><tbody>${body}</tbody></table></div>
    <div class="muted" style="font-size:11px;margin-top:6px">Суммы в млрд ₽ · источник ${escA(d.rsbu_source || "ГИР БО ФНС")}</div></div>`;
}

function bindLeasingAll(host, d) {
  host.querySelectorAll("[data-ry]").forEach(c => c.onclick = () => {
    SECTOR.rsbuYear = c.dataset.ry;
    const box = host.querySelector("#lz-all");
    if (box) { box.outerHTML = leasingAllHTML(d); bindLeasingAll(host, d); wireInfoIcons(host); }
  });
  host.querySelectorAll("tr[data-lease]").forEach(tr => tr.onclick = () => {
    openCompanyCard(tr.dataset.lease);
  });
}

// ── карточка одной лизинговой компании: отчётность по периодам + её облигации ──
async function renderLeasingCompany(host, d, name = SECTOR.company) {
  const c = (d.companies || []).find(x => x.company === name);
  if (!c) return renderLeasingRsbu(host, d, name);
  // последний период — свой у каждой компании: у части нет последнего общего (О'КЕЙ без 6м2026)
  const per = (d.periods || []).filter(p => c.fin[p]);
  const P = per.length ? per[per.length - 1] : d.last_period, fin = p => (c.fin || {})[p] || {}, F = fin(P);
  const pLabel = p => p === d.last_period && /^\d+м/.test(p) ? `LTM ${p}` : p;
  const bn = x => x == null ? "—" : fmt(x / 1000, Math.abs(x) >= 100000 ? 0 : 1);
  const bnRub = x => x == null ? "—" : fmt(x / 1e9, 1);
  const pc = (v, n = 1) => v == null ? "—" : fmt(v, n) + "%";
  const m = c.market || {};
  const kpi = (l, v, sub) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${sub || ""}</div></div>`;
  const own = c.own || {};

  host.innerHTML = `
    <div class="toolbar"><button class="btn ghost" id="sc-back">← Ко всем лизингам</button></div>
    <div class="panel">
      <div class="muted" style="font-size:11px;letter-spacing:.18em;text-transform:uppercase">Лизинг · отчётность МСФО ${per[0] || ""} — ${pLabel(P)}</div>
      <h3 style="font-size:22px;margin:8px 0 4px">${name} <span class="muted" style="font-weight:400;font-size:13px">${escA(c.full || "")}</span></h3>
      <div class="muted" style="font-size:12px">${m.rating ? `рейтинг ${m.rating}${m.rating_agency ? " · " + agName(m.rating_agency) : ""}` : "рейтинга нет"} · выпусков в обращении ${m.issues || 0}</div>
      <div class="kpis" style="margin-top:14px">
        ${kpi("NIM", pc(F.nim, 2), `спред ${pc(F.spread, 2)} · доходность ${pc(F.yld, 1)}`)}
        ${kpi("CIR", pc(F.cir, 1), "расходы к доходу до резервов")}
        ${kpi("ROE", pc(F.roe, 1), `ROA ${pc(F.roa, 1)}`)}
        ${kpi("COR", pc(F.cor_full, 2), "резервы и потери к портфелю")}
        ${kpi("Проблемные активы", `<span style="color:${probColor(F.prob_sh)}">${pc(F.prob_sh, 1)}</span>`, `стадия 3 ${pc(F.s3_sh, 1)} · покрытие ${pc(F.s3_cov, 0)}`)}
        ${kpi("Долг / капитал", F.de == null ? "—" : fmt(F.de, 2) + "×", `капитал/активы ${pc(F.eqa, 0)} · долг на рынке ${bnRub(m.volume)} млрд ₽`)}
      </div>
      ${Object.keys(own).length ? `<div class="muted" style="font-size:11px;margin-top:10px">Компания сама раскрывает за ${pLabel(P)}: ${
        Object.entries(own[P] || {}).map(([k, v]) => `${k.toUpperCase()} ${fmt(v, 1)}%`).join(" · ") || "—"} — методики отличаются от нашей единой.</div>` : ""}
    </div>
    <div class="panel"><h3>Доходы и прибыль <span class="muted" style="font-weight:400;font-size:12px">· млрд ₽ за период</span>${infoIcon("Доходы и прибыль",
      "Из чего складывается доход лизинговой компании: процентный доход по портфелю за вычетом стоимости фондирования и непроцентный — страховые и агентские комиссии, услуги, операционная аренда и прочее. Соседний столбик — чистая прибыль после расходов, резервов и налога: при росте стоимости риска она падает быстрее дохода. Пунктир — доля непроцентного дохода: чем она выше, тем меньше прибыль зависит от процентной маржи. Подпись сверху — весь операционный доход до резервов.",
      "Операционный доход до резервов = чистый процентный доход + чистый непроцентный доход\nДоля непроцентного дохода = чистый непроцентный доход ÷ операционный доход × 100%\nЧистая прибыль = операционный доход − операционные расходы − резервы и потери − налог")}</h3>
      <div class="chart" id="lc-inc" style="height:300px;margin-top:8px"></div></div>
    <div class="panel"><h3>Портфель и капитал <span class="muted" style="font-weight:400;font-size:12px">· млрд ₽ на конец периода</span>${infoIcon("Портфель и капитал",
      "ЧИЛ — чистые инвестиции в лизинг: сколько компания вложила в предметы лизинга и ждёт обратно платежами, за вычетом резерва под ожидаемые потери. Рядом — весь долг (кредиты банков, облигации, прочие займы, без аренды и авансов) и собственный капитал. Портфель растёт быстрее капитала — растёт и рычаг.",
      "Долг = кредиты банков + облигации + прочие займы\nДолг / капитал = долг ÷ собственный капитал")}</h3>
      <div class="chart" id="lc-port" style="height:300px;margin-top:8px"></div></div>
    <div class="panel"><h3>Маржа, эффективность и рентабельность <span class="muted" style="font-weight:400;font-size:12px">· NIM и COR по левой оси, CIR и ROE по правой</span>${infoIcon("Маржа, эффективность и рентабельность",
      "Четыре показателя в одном окне: сколько компания зарабатывает на портфеле (NIM), сколько теряет на риске (COR), сколько тратит на себя (CIR) и что в итоге остаётся акционеру (ROE). Когда COR догоняет NIM, прибыль съедается резервами. Средние величины в знаменателях считаются по началу и концу периода.",
      "NIM = чистый процентный доход ÷ средние (деньги + валовые ЧИЛ) × 100%\nCOR = резервы и потери ÷ средние валовые ЧИЛ × 100%\nCIR = операционные расходы ÷ операционный доход до резервов × 100%\nROE = чистая прибыль ÷ средний капитал × 100%")}</h3>
      <div class="chart" id="lc-ratio" style="height:300px;margin-top:8px"></div></div>
    <div class="panel"><h3>Качество портфеля <span class="muted" style="font-weight:400;font-size:12px">· стадия 3, изъятое имущество и резерв</span>${unitSw("lc-qual", "pct")}${infoIcon("Качество портфеля",
      "Стадия 3 — договоры, по которым уже произошёл дефолт. Проблемные активы шире: к стадии 3 добавляются изъятые предметы лизинга, активы для продажи и задолженность по расторгнутым договорам — у части компаний проблема уходит именно туда. Покрытие показывает, какая доля стадии 3 закрыта резервом. В промежуточной отчётности разбивку портфеля по стадиям раскрывают не все — там, где её нет, столбиков не будет, но пунктирная линия резерва к портфелю показывает то же направление.",
      "Проблемные активы = (ЧИЛ стадии 3 + изъятое имущество + расторгнутые договоры) ÷ (валовые ЧИЛ + изъятое имущество + расторгнутые договоры) × 100%\nПокрытие стадии 3 = весь резерв по ЧИЛ ÷ ЧИЛ стадии 3 × 100%")}</h3>
      <div class="chart" id="lc-qual" style="height:300px;margin-top:8px"></div></div>
    <div class="panel"><h3>Структура долга <span class="muted" style="font-weight:400;font-size:12px">· весь долг</span>${unitSw("lc-fund", "rub")}${infoIcon("Структура долга",
      "Из чего состоит фондирование: банковские кредиты, биржевые облигации и прочие займы (включая займы связанных сторон). Линия — деньги на балансе. Чем выше доля облигаций, тем чаще компании приходится выходить на рынок за рефинансированием.",
      "Доля облигаций = облигации ÷ (кредиты банков + облигации + прочие займы) × 100%")}</h3>
      <div class="chart" id="lc-fund" style="height:300px;margin-top:8px"></div></div>
    <div class="panel"><h3>Показатели по периодам${infoIcon("Показатели по периодам",
      "Годовые величины — из годовой отчётности, последний столбец — LTM: скользящие 12 месяцев к отчётной дате. Балансовые статьи (ЧИЛ, капитал, долг, деньги) — на отчётную дату, потоковые (доходы, расходы, прибыль) — за период. В знаменателях коэффициентов стоят средние величины по началу и концу периода.",
      "LTM = год − первое полугодие прошлого года + первое полугодие текущего\nСредняя величина = (на начало периода + на конец периода) ÷ 2")}</h3>
      <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th style="text-align:left">Показатель</th>${per.map(p => `<th>${pLabel(p)}</th>`).join("")}</tr></thead><tbody>
        ${[["ЧИЛ, млрд ₽", p => bn(fin(p).nil)], ["Капитал, млрд ₽", p => bn(fin(p).eq)],
           ["Активы, млрд ₽", p => bn(fin(p).assets)], ["Долг, млрд ₽", p => bn(fin(p).debt)],
           ["Денежные средства, млрд ₽", p => bn(fin(p).cash)],
           ["Чистый процентный доход, млрд ₽", p => bn(fin(p).nii)],
           ["Операционные расходы, млрд ₽", p => bn(fin(p).opex)],
           ["Чистая прибыль, млрд ₽", p => bn(fin(p).ni)],
           ["NIM", p => pc(fin(p).nim, 2)], ["CIR", p => pc(fin(p).cir, 1)],
           ["COR", p => pc(fin(p).cor_full, 2)], ["ROE", p => pc(fin(p).roe, 1)],
           ["Проблемные активы", p => pc(fin(p).prob_sh, 1)],
           ["Долг / капитал", p => fin(p).de == null ? "—" : fmt(fin(p).de, 2) + "×"]].map(([lbl, f]) =>
          `<tr><td style="text-align:left">${lbl}</td>${per.map(p => `<td>${f(p)}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div>
      <div class="muted" style="font-size:11px;margin-top:6px">ЧИЛ — чистые инвестиции в лизинг. Средние величины в знаменателях считаются по началу и концу периода; LTM — год минус первое полугодие прошлого года плюс первое полугодие текущего.</div></div>
    <div class="panel"><h3>Облигации в обращении <span class="muted" style="font-weight:400;font-size:12px">· клик открывает карточку выпуска</span></h3>
      <div id="sc-bonds"><div class="loading" style="padding:14px">Загружаю выпуски…</div></div></div>`;

  host.querySelector("#sc-back").onclick = () => { SECTOR.company = null; render(); };
  const cat = { type: "category", data: per.map(pLabel), ...AX };
  const val = (k, div = 1000) => per.map(p => { const v = fin(p)[k]; return v == null ? null : +(v / div).toFixed(1); });

  mkChart(host.querySelector("#lc-port"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: v => v == null ? "—" : fmt(v, 1) + " млрд ₽" },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 58, right: 24, top: 36, bottom: 30 }, xAxis: cat,
    yAxis: { type: "value", ...AX, name: "млрд ₽", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] } },
    series: [
      { name: "ЧИЛ", type: "bar", barMaxWidth: 34, itemStyle: { color: "#2fa89b", borderRadius: [5, 5, 0, 0] }, data: val("nil") },
      { name: "Долг", type: "line", symbol: "circle", symbolSize: 7, lineStyle: { width: 2.4, color: "#d99b3f" }, itemStyle: { color: "#d99b3f" }, data: val("debt") },
      { name: "Капитал", type: "line", symbol: "circle", symbolSize: 7, lineStyle: { width: 2.4, color: "#7b8ff0" }, itemStyle: { color: "#7b8ff0" }, data: val("eq") }] });

  mkChart(host.querySelector("#lc-inc"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" },
      formatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.filter(x => x.value != null).map(x =>
        `${x.marker} ${x.seriesName}: <b>${x.seriesName.startsWith("Доля") ? fmt(x.value, 1) + "%" : fmt(x.value, 1) + " млрд ₽"}</b>`).join("<br>") },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 58, right: 64, top: 36, bottom: 30 }, xAxis: cat,
    yAxis: [{ type: "value", ...AX, name: "млрд ₽", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
      splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } } },
      { type: "value", ...AX, name: "доля, %", nameTextStyle: { ...AX.nameTextStyle, align: "left", padding: [0, 0, 0, 8] }, splitLine: { show: false }, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } }],
    series: [
      { name: "Чистый процентный доход", type: "bar", stack: "i", barMaxWidth: 26, itemStyle: { color: "#2fa89b" }, data: val("nii") },
      { name: "Чистый непроцентный доход", type: "bar", stack: "i", barMaxWidth: 26, itemStyle: { color: "#7fc9bf", borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", distance: 6, fontSize: 11, color: cssVar("--muted", "#8aa"),
          formatter: p => { const f = fin(per[p.dataIndex]); return f.opinc == null ? "" : fmt(f.opinc / 1000, 1); } },
        data: val("noni") },
      { name: "Чистая прибыль", type: "bar", barMaxWidth: 26, barGap: "14%", itemStyle: { color: "#7b8ff0", borderRadius: [4, 4, 0, 0] }, data: val("ni") },
      { name: "Доля непроцентного дохода", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 6,
        lineStyle: { width: 2, type: "dashed", color: "#d99b3f" }, itemStyle: { color: "#d99b3f" },
        data: per.map(pp => fin(pp).nonint_sh ?? null) }] });

  mkChart(host.querySelector("#lc-ratio"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, valueFormatter: v => v == null ? "—" : fmt(v, 2) + "%" },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 54, right: 64, top: 36, bottom: 30 }, xAxis: cat,
    yAxis: [{ type: "value", ...AX, name: "NIM / COR, %", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] }, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } },
      { type: "value", ...AX, name: "CIR / ROE, %", nameTextStyle: { ...AX.nameTextStyle, align: "left", padding: [0, 0, 0, 8] }, splitLine: { show: false }, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } }],
    series: [
      { name: "NIM", type: "bar", barMaxWidth: 22, itemStyle: { color: "#2fa89b", borderRadius: [4, 4, 0, 0] }, data: per.map(p => fin(p).nim ?? null) },
      { name: "COR", type: "bar", barMaxWidth: 22, itemStyle: { color: "#d9453f", borderRadius: [4, 4, 0, 0] }, data: per.map(p => fin(p).cor_full ?? null) },
      { name: "CIR", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 6, lineStyle: { width: 2, type: "dashed", color: "#d99b3f" }, itemStyle: { color: "#d99b3f" }, data: per.map(p => fin(p).cir ?? null) },
      { name: "ROE", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 7, lineStyle: { width: 2.4, color: "#7b8ff0" }, itemStyle: { color: "#7b8ff0" }, data: per.map(p => fin(p).roe ?? null) }] });

  // проблемные активы в рублях — те же слагаемые, что и в доле: стадия 3 + изъятое + расторгнутые
  const probAmt = f => f.prob_sh == null || f.s3 == null ? null : f.s3 + (f.repo || 0) + (f.term || 0);
  const bnv = v => v == null ? null : +(v / 1000).toFixed(2);                 // млн → млрд
  UNIT_DRAW["lc-qual"] = () => {
    const rub = UNIT["lc-qual"] === "rub";
    const q = k => per.map(p => { const f = fin(p);
      if (rub) return bnv(k === "prob" ? probAmt(f) : k === "s3" ? f.s3 : f.allow);
      return (k === "prob" ? f.prob_sh : k === "s3" ? f.s3_sh : f.allow_sh) ?? null; });
    mkChart(host.querySelector("#lc-qual"), { ...CHART_BG,
      tooltip: { trigger: "axis", confine: true, formatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.filter(x => x.value != null).map(x =>
        `${x.marker}${x.seriesName}: <b>${x.seriesIndex === 3 || !rub ? fmt(x.value, 2) + "%" : fmt(x.value, 1) + " млрд ₽"}</b>`).join("<br>") },
      legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 54, right: 64, top: 36, bottom: 30 }, xAxis: cat,
      yAxis: [{ type: "value", ...AX, name: rub ? "млрд ₽" : "доля портфеля, %", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
        axisLabel: { color: AXIS_TXT, formatter: v => rub ? bnAxis(v) : fmt(v, 0) + "%" } },
        { type: "value", ...AX, name: "покрытие, %", nameTextStyle: { ...AX.nameTextStyle, align: "left", padding: [0, 0, 0, 8] }, splitLine: { show: false }, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } }],
      series: [
        { name: "Проблемные активы", type: "bar", barMaxWidth: 26, itemStyle: { color: "#e2a03f", borderRadius: [4, 4, 0, 0] }, data: q("prob") },
        { name: "Стадия 3", type: "bar", barMaxWidth: 26, itemStyle: { color: "#d9453f", borderRadius: [4, 4, 0, 0] }, data: q("s3") },
        // в промежуточной отчётности разбивки портфеля по стадиям нет, а резерв есть всегда:
        // без этой линии последний столбец у половины компаний оставался бы пустым
        { name: rub ? "Резерв" : "Резерв к портфелю", type: "line", symbol: "circle", symbolSize: 6,
          lineStyle: { width: 2, type: "dashed", color: "#5c7085" }, itemStyle: { color: "#5c7085" }, data: q("allow") },
        { name: "Покрытие стадии 3", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 6, lineStyle: { width: 2, color: "#7b8ff0" }, itemStyle: { color: "#7b8ff0" }, data: per.map(p => fin(p).s3_cov ?? null) }] });
  };
  UNIT_DRAW["lc-qual"]();

  UNIT_DRAW["lc-fund"] = () => {
    const pctM = UNIT["lc-fund"] === "pct";
    const sh = k => per.map(p => fin(p)[k] ?? null);
    mkChart(host.querySelector("#lc-fund"), { ...CHART_BG,
      tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: v => v == null ? "—" : pctM ? fmt(v, 1) + "%" : fmt(v, 1) + " млрд ₽" },
      legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 58, right: 24, top: 36, bottom: 30 }, xAxis: cat,
      yAxis: { type: "value", ...AX, name: pctM ? "доля в долге, %" : "млрд ₽", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
        ...(pctM ? { max: 100, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } } : { axisLabel: { color: AXIS_TXT, formatter: bnAxis } }) },
      series: [
        { name: "Банковские кредиты", type: "bar", stack: "d", barMaxWidth: 34, itemStyle: { color: "#5b93de" }, data: pctM ? sh("bank_sh") : val("bank") },
        { name: "Облигации", type: "bar", stack: "d", barMaxWidth: 34, itemStyle: { color: "#d99b3f" }, data: pctM ? sh("bond_sh") : val("bonds") },
        { name: "Прочие займы", type: "bar", stack: "d", barMaxWidth: 34, itemStyle: { color: "#8aa2bd" }, data: pctM ? sh("oth_sh") : val("oth") },
        // деньги к доле долга не относятся — в процентах их не показываем
        ...(pctM ? [] : [{ name: "Денежные средства", type: "line", symbol: "circle", symbolSize: 6, lineStyle: { width: 2, color: "#3ecf8e" }, itemStyle: { color: "#3ecf8e" }, data: val("cash") }])] });
  };
  UNIT_DRAW["lc-fund"]();
  wireUnitSw(host);

  wireInfoIcons(host);
  await loadCompanyBonds(host.querySelector("#sc-bonds"), m.isins || []);
}

// ── карточка эмитента без разбора МСФО: годовой ряд РСБУ из ГИР БО ──
async function renderLeasingRsbu(host, d, name) {
  const o = (d.others || []).find(x => x.company === name);
  if (!o) { SECTOR.company = null; return render(); }
  const years = Object.keys(o.rsbu || {}).filter(y => +y >= 2019).sort();
  const m = o.market || {}, Y = years[years.length - 1], F = (o.rsbu || {})[Y] || {};
  const bn = x => x == null ? "—" : fmt(x / 1000, Math.abs(x) >= 100000 ? 0 : 1);
  const bnRub = x => x == null ? "—" : fmt(x / 1e9, 1);
  const pc = (v, n = 1) => v == null ? "—" : fmt(v, n) + "%";
  const kpi = (l, v, sub) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${sub || ""}</div></div>`;

  host.innerHTML = `
    <div class="toolbar"><button class="btn ghost" id="sc-back">← Ко всем лизингам</button></div>
    <div class="panel">
      <div class="muted" style="font-size:11px;letter-spacing:.18em;text-transform:uppercase">Лизинг · бухгалтерская отчётность ${years[0] || ""} — ${Y || ""}</div>
      <h3 style="font-size:22px;margin:8px 0 4px">${escA(name)}</h3>
      <div class="muted" style="font-size:12px">${m.rating ? `рейтинг ${m.rating}${m.rating_agency ? " · " + agName(m.rating_agency) : ""}` : "рейтинга нет"} · выпусков в обращении ${m.issues || 0}${o.inn ? " · ИНН " + o.inn : ""}</div>
      <div class="kpis" style="margin-top:14px">
        ${kpi("Активы", bn(F.assets) + " млрд ₽", `на конец ${Y}`)}
        ${kpi("Капитал", bn(F.equity) + " млрд ₽", `капитал/активы ${pc(F.eqa, 0)}`)}
        ${kpi("Долг", bn(F.debt) + " млрд ₽", `долг/капитал ${F.de == null ? "—" : fmt(F.de, 1) + "×"}`)}
        ${kpi("Выручка", bn(F.revenue) + " млрд ₽", `прибыль ${bn(F.profit)} млрд ₽`)}
        ${kpi("ROE", pc(F.roe), `ROA ${pc(F.roa)}`)}
        ${kpi("Премия рынка", m.spread_bp == null ? "—" : "+" + fmt(m.spread_bp, 0) + " б.п.", `долг на рынке ${bnRub(m.volume)} млрд ₽`)}
      </div>
      <div class="muted" style="font-size:11px;margin-top:10px">Источник: ${escA(d.rsbu_source || "ГИР БО ФНС")}. Это отчётность юрлица по РСБУ, а не консолидированная группа: лизинговый портфель отражён как доходные вложения в материальные ценности и суммы могут отличаться от МСФО.</div>
    </div>
    <div class="panel"><h3>Баланс по годам <span class="muted" style="font-weight:400;font-size:12px">· млрд ₽</span>${infoIcon("Баланс по годам",
      "Активы, собственный капитал и долг по данным годовой бухгалтерской отчётности. Долг — заёмные средства из обеих частей баланса, без кредиторской задолженности и авансов лизингополучателей.",
      "Долг = долгосрочные заёмные средства (строка 1410) + краткосрочные (1510)\nКапитал / активы = капитал (1300) ÷ баланс (1600) × 100%")}</h3>
      <div class="chart" id="lr-bal" style="height:300px;margin-top:8px"></div></div>
    <div class="panel"><h3>Выручка, прибыль и рентабельность <span class="muted" style="font-weight:400;font-size:12px">· млрд ₽ и %</span>${infoIcon("Выручка, прибыль и рентабельность",
      "Выручка и чистая прибыль по РСБУ, линия — рентабельность капитала. У лизинговых компаний в выручку попадают лизинговые платежи по договорам операционной аренды и выручка от продажи изъятого имущества, поэтому сравнивать её с процентным доходом по МСФО нельзя.",
      "ROE = чистая прибыль (2400) ÷ капитал (1300) × 100%\nМаржа = чистая прибыль ÷ выручка (2110) × 100%")}</h3>
      <div class="chart" id="lr-pnl" style="height:300px;margin-top:8px"></div></div>
    <div class="panel"><h3>Показатели по годам${infoIcon("Показатели по годам",
      "Все величины из годовой бухгалтерской отчётности в ГИР БО ФНС, в млрд ₽. Пустая клетка — строка в отчёте не заполнена.",
      "Долг = 1410 + 1510 · Доходные вложения — строка 1160 · Проценты к уплате — 2330")}</h3>
      <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th style="text-align:left">Показатель</th>${years.map(y => `<th>${y}</th>`).join("")}</tr></thead><tbody>
        ${[["Активы", y => bn((o.rsbu[y] || {}).assets)], ["Капитал", y => bn((o.rsbu[y] || {}).equity)],
           ["Долг", y => bn((o.rsbu[y] || {}).debt)],
           ["в т.ч. долгосрочный", y => bn((o.rsbu[y] || {}).debt_lt)],
           ["Доходные вложения", y => bn((o.rsbu[y] || {}).lease_assets)],
           ["Дебиторская задолженность", y => bn((o.rsbu[y] || {}).receivables)],
           ["Денежные средства", y => bn((o.rsbu[y] || {}).cash)],
           ["Выручка", y => bn((o.rsbu[y] || {}).revenue)],
           ["Проценты к уплате", y => bn((o.rsbu[y] || {}).interest_exp)],
           ["Чистая прибыль", y => bn((o.rsbu[y] || {}).profit)],
           ["Долг / капитал", y => { const v = (o.rsbu[y] || {}).de; return v == null ? "—" : fmt(v, 2) + "×"; }],
           ["Капитал / активы", y => pc((o.rsbu[y] || {}).eqa, 0)],
           ["ROE", y => pc((o.rsbu[y] || {}).roe)]].map(([lbl, f]) =>
          `<tr><td style="text-align:left">${lbl}</td>${years.map(y => `<td>${f(y)}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div></div>
    <div class="panel"><h3>Облигации в обращении <span class="muted" style="font-weight:400;font-size:12px">· клик открывает карточку выпуска</span></h3>
      <div id="sc-bonds"><div class="loading" style="padding:14px">Загружаю выпуски…</div></div></div>`;

  host.querySelector("#sc-back").onclick = () => { SECTOR.company = null; render(); };
  wireInfoIcons(host);
  const cat = { type: "category", data: years, ...AX };
  const val = k => years.map(y => { const v = (o.rsbu[y] || {})[k]; return v == null ? null : +(v / 1000).toFixed(1); });

  mkChart(host.querySelector("#lr-bal"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: v => v == null ? "—" : fmt(v, 1) + " млрд ₽" },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 58, right: 24, top: 36, bottom: 30 }, xAxis: cat,
    yAxis: { type: "value", ...AX, name: "млрд ₽", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
      splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } } },
    series: [
      { name: "Активы", type: "bar", barMaxWidth: 30, itemStyle: { color: "#2fa89b", borderRadius: [4, 4, 0, 0] }, data: val("assets") },
      { name: "Долг", type: "line", symbol: "circle", symbolSize: 7, lineStyle: { width: 2.4, color: "#d99b3f" }, itemStyle: { color: "#d99b3f" }, data: val("debt") },
      { name: "Капитал", type: "line", symbol: "circle", symbolSize: 7, lineStyle: { width: 2.4, color: "#7b8ff0" }, itemStyle: { color: "#7b8ff0" }, data: val("equity") }] });

  mkChart(host.querySelector("#lr-pnl"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" },
      formatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.filter(x => x.value != null).map(x =>
        `${x.marker} ${x.seriesName}: <b>${x.seriesName === "ROE" ? fmt(x.value, 1) + "%" : fmt(x.value, 1) + " млрд ₽"}</b>`).join("<br>") },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 58, right: 56, top: 36, bottom: 30 }, xAxis: cat,
    yAxis: [{ type: "value", ...AX, name: "млрд ₽", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
        splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } } },
      { type: "value", ...AX, name: "ROE, %", nameTextStyle: { ...AX.nameTextStyle, align: "left", padding: [0, 0, 0, 8] }, splitLine: { show: false }, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } }],
    series: [
      { name: "Выручка", type: "bar", barMaxWidth: 26, barGap: "12%", itemStyle: { color: "#5b93de", borderRadius: [4, 4, 0, 0] }, data: val("revenue") },
      { name: "Чистая прибыль", type: "bar", barMaxWidth: 26, itemStyle: { color: "#7b8ff0", borderRadius: [4, 4, 0, 0] }, data: val("profit") },
      { name: "ROE", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 6, lineStyle: { width: 2, type: "dashed", color: "#d99b3f" }, itemStyle: { color: "#d99b3f" },
        data: years.map(y => (o.rsbu[y] || {}).roe ?? null) }] });

  await loadCompanyBonds(host.querySelector("#sc-bonds"), m.isins || []);
}

// ---------- сектор «Субфеды»: бюджеты регионов и городов + рынок их облигаций ----------
// Регион — не компания: ни EBITDA, ни капитала у него нет. Долговую устойчивость читаем
// так же, как Минфин России: долг к собственным (налоговым и неналоговым) доходам, дефицит,
// зависимость от трансфертов и доля рыночного долга против дешёвых бюджетных кредитов.
// Покрытие данных неровное — пустая клетка значит «не найдено в открытых источниках».
const debtColor = v => v == null ? "#8a8f98" : v < 0.5 ? "#12a06a" : v < 0.85 ? "#c9a227" : v < 1.05 ? "#a8760c" : "#d9453f";

function renderSubfed(head, host, d) {
  const per = d.periods || [];
  // период по умолчанию — последний год, где показатели раскрыты у большинства: за полугодие
  // потоки не сопоставимы с годовыми, поэтому отношения к доходам там не считаются
  const filledIn = p => d.companies.reduce((a, c) => a + (((c.fin || {})[p] || {}).filled || 0), 0);
  if (!per.includes(SECTOR.period)) SECTOR.period = per.filter(p => !/^\dм/.test(p)).sort((a, b) => filledIn(b) - filledIn(a))[0] || per[per.length - 1];
  const P = SECTOR.period;
  const fin = (c, p) => (c.fin || {})[p || P] || {};
  const bnRub = x => x == null ? "—" : fmt(x / 1e9, x >= 1e11 ? 0 : 1);
  const bn = x => x == null ? "—" : fmt(x / 1000, Math.abs(x) >= 100000 ? 0 : 1);   // млн ₽ → млрд
  const pc = (v, n = 1) => v == null ? "—" : fmt(v, n) + "%";
  const comps = (d.order || []).map(n => d.companies.find(c => c.company === n)).filter(Boolean);

  head.innerHTML = `
    ${sectorTabsHTML()}
    <h3 style="font-size:24px;margin:2px 0 6px">Долговая устойчивость регионов</h3>
    <div class="kpis" style="margin-top:14px">
      <div class="kpi"><div class="label">Эмитентов с облигациями</div><div class="value">${d.kpi.issuers}</div><div class="sub">${d.kpi.issues} выпусков в обращении</div></div>
      <div class="kpi"><div class="label">Долг на рынке</div><div class="value">${bnRub(d.kpi.volume)} млрд ₽</div><div class="sub">номинал выпусков</div></div>
      <div class="kpi"><div class="label">Медианная премия</div><div class="value">+${fmt(d.kpi.median_spread_bp, 0)} б.п.</div><div class="sub">к безрисковой кривой</div></div>
      <div class="kpi"><div class="label">Бюджеты</div><div class="value">${d.kpi.reported} регионов</div><div class="sub">разбор от ${dmy(d.as_of)}</div></div>
    </div>`;
  head.querySelectorAll("[data-sec]").forEach(c => c.onclick = () => { SECTOR.key = c.dataset.sec; SECTOR.data = null; SECTOR.company = null; SECTOR.period = null; render(); });

  const COLS = [["company", "Регион", "l"], ["rating", "Рейтинг", "c"], ["debt_own", "Долг / собств. доходы", "c"],
    ["bal_inc", "Дефицит к доходам", "c"], ["grants", "Трансферты", "c"], ["svc", "Обслуживание долга", "c"],
    ["mkt", "Рыночный долг", "c"], ["spread", "Премия рынка", "c"], ["vol", "Долг на рынке", "c"]];
  const val = (c, k) => { const f = fin(c), m = c.market || {};
    return ({ company: c.company, rating: m.rating_score, debt_own: f.debt_own, bal_inc: f.bal_inc,
      grants: f.grants_share, svc: f.svc_exp, mkt: f.market_share, spread: m.spread_bp, vol: m.volume })[k]; };
  const tableHTML = () => {
    const rows = [...comps].sort((a, b) => { const x = val(a, SECTOR.sort), y = val(b, SECTOR.sort);
      if (x == null) return 1; if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y, "ru") : x - y) * (SECTOR.desc ? -1 : 1); });
    const arrow = k => SECTOR.sort === k ? (SECTOR.desc ? " ▾" : " ▴") : " ⇅";
    const body = rows.map(c => { const f = fin(c), m = c.market || {};
      return `<tr data-comp="${escA(c.company)}" style="cursor:pointer">
        <td style="text-align:left"><b style="color:${debtColor(f.debt_own)}">${escA(c.company)}</b><div class="muted" style="font-size:10px">данные за ${pLabelSub(P)}: ${f.filled || 0} из 11 показателей</div></td>
        <td>${m.rating ? `<span class="pill">${m.rating}</span>` : "—"}</td>
        <td style="color:${debtColor(f.debt_own)};font-weight:600">${f.debt_own == null ? "—" : fmt(100 * f.debt_own, 0) + "%"}<div class="muted" style="font-size:10px;font-weight:400">долг ${bn(f.debt)} млрд</div></td>
        <td>${f.bal_inc == null ? "—" : pc(f.bal_inc)}</td>
        <td>${pc(f.grants_share, 0)}</td>
        <td>${f.svc_exp == null ? "—" : pc(f.svc_exp, 2)}</td>
        <td>${pc(f.market_share, 0)}<div class="muted" style="font-size:10px">облигации ${pc(f.bonds_share, 0)}</div></td>
        <td>${m.spread_bp == null ? "—" : "+" + fmt(m.spread_bp, 0) + " б.п."}<div class="muted" style="font-size:10px">${m.issues || 0} вып.</div></td>
        <td>${bnRub(m.volume)} млрд</td></tr>`; }).join("");
    return `<div class="panel" id="sec-tbl"><h3>Бюджет и долг за ${pLabelSub(P)} <span class="muted" style="font-weight:400;font-size:12px">· клик по строке открывает карточку региона</span>${infoIcon("Бюджет и долг за " + pLabelSub(P),
        "Долг к собственным доходам — главный показатель долговой устойчивости субъекта: по нему Минфин России делит регионы на группы. Собственные доходы — налоговые и неналоговые, без федеральных трансфертов. Рыночный долг — облигации и банковские кредиты: по ним ставка рыночная, тогда как бюджетные кредиты из федерального бюджета выдаются под 0,1% годовых. Пустая клетка означает, что величина не найдена, а не ноль — под названием региона указано, сколько из 11 показателей есть. Госдолг и его структура берутся у Минфина России по всем периодам, исполнение бюджета за 2025 и 6 месяцев 2026 — из отчётов Казначейства (форма 0503317, колонка «бюджет субъекта»); за 2021–2024 потоки бюджета остаются из ручного разбора открытых источников, потому что архивы Казначейства за эти годы с сайта сняты. «Долг на рынке» — номинал выпусков в обращении по нашим рыночным данным на сегодня: он может отличаться от строки «облигации» в бюджете, потому что относится к другой дате и не учитывает уже погашенную амортизацию.",
        "Долг / собственные доходы = госдолг на конец периода ÷ (налоговые + неналоговые доходы) × 100%\nДефицит к доходам = (доходы − расходы) ÷ доходы × 100%\nТрансферты = безвозмездные поступления ÷ доходы × 100%\nРыночный долг = (облигации + кредиты банков) ÷ госдолг × 100%")}</h3>
      <div class="chips" style="margin-top:10px">${per.map(p => `<span class="chip ${p === P ? "on" : ""}" data-per="${p}">${pLabelSub(p)}</span>`).join("")}</div>
      <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr>${COLS.map(([k, l, al]) =>
        `<th data-k="${k}" style="cursor:pointer;user-select:none;text-align:${al === "l" ? "left" : "center"}">${l}<span class="muted" style="font-size:10px">${arrow(k)}</span></th>`).join("")}</tr></thead>
      <tbody>${body}</tbody></table></div></div>`;
  };

  const fed = d.federal || {}, fp = fed.periods || {}, fm = fed.market || null;
  const fedPer = Object.keys(fp).filter(p => (per.includes(p) || /^\d{4}$/.test(p))).sort();
  const fedYears = fedPer.filter(p => /^\d{4}$/.test(p) && +p >= 2015);
  const fedLast = fp[per[per.length - 1]] || fp[fedPer[fedPer.length - 1]] || {};
  const fedHTML = Object.keys(fp).length ? `<div class="panel"><h3>Российская Федерация <span class="muted" style="font-weight:400;font-size:12px">· федеральный бюджет и ОФЗ, ${pLabelSub(per[per.length - 1])}</span>${infoIcon("Российская Федерация",
      "Федеральный слой того же рынка: сколько занимает сам Минфин России и на каких условиях. Внутренний долг — остатки по ОФЗ и ГСО из данных Минфина; доля ОФЗ-ПК показывает, какая часть долга идёт за ключевой ставкой. Нефтегазовые доходы — часть бюджета, зависящая от цен на сырьё и курса. Дефицит закрывается в основном размещением ОФЗ, поэтому чем он больше, тем выше предложение бумаг на рынке — и тем шире премия, которую платят регионы и компании.",
      "Дефицит к доходам = (доходы − расходы) ÷ доходы × 100%\nДоля ОФЗ-ПК = ОФЗ с плавающим купоном ÷ внутренний долг × 100%\nДоля нефтегазовых доходов = нефтегазовые ÷ все доходы × 100%")}</h3>
    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><div class="label">Внутренний долг</div><div class="value">${fedLast.internal == null ? "—" : fmt(fedLast.internal / 1e6, 1)} трлн ₽</div><div class="sub">ОФЗ и ГСО по данным Минфина</div></div>
      <div class="kpi"><div class="label">Доля ОФЗ-ПК</div><div class="value">${fedLast.pk_share == null ? "—" : fmt(fedLast.pk_share, 0) + "%"}</div><div class="sub">долг с плавающим купоном</div></div>
      <div class="kpi"><div class="label">Дефицит к доходам</div><div class="value">${fedLast.bal_inc == null ? "—" : fmt(fedLast.bal_inc, 1) + "%"}</div><div class="sub">${fedLast.bal == null ? "" : fmt(fedLast.bal / 1e6, 1) + " трлн ₽"}</div></div>
      <div class="kpi"><div class="label">Нефтегазовые доходы</div><div class="value">${fedLast.oil_share == null ? "—" : fmt(fedLast.oil_share, 0) + "%"}</div><div class="sub">доля в доходах бюджета</div></div>
      ${fm ? `<div class="kpi"><div class="label">ОФЗ на рынке</div><div class="value">${fmt((fm.volume || 0) / 1e12, 1)} трлн ₽</div><div class="sub">${fm.issues} выпусков · флоатеров ${fm.floater_share || 0}%</div></div>` : ""}
      ${fm && fm.tenor_years != null ? `<div class="kpi"><div class="label">Срок ОФЗ</div><div class="value">${fmt(fm.tenor_years, 1)} г.</div><div class="sub">медиана по выпускам</div></div>` : ""}
    </div>
    <div class="chart" id="sf-fed" style="height:320px;margin-top:12px"></div></div>` : "";

  host.innerHTML = fedHTML + tableHTML()
    + secPanel("Долг к собственным доходам", `на конец ${pLabelSub(P)}`,
        { text: "Во сколько собственных доходов обходится накопленный долг региона. Минфин России считает субъект с долгом выше 85% собственных доходов заёмщиком с низкой долговой устойчивостью, выше 105% — требующим согласования заимствований. Собственные доходы — налоговые и неналоговые, без федеральных трансфертов.",
          formula: "Долг / собственные доходы = госдолг на конец периода ÷ (налоговые + неналоговые доходы) × 100%" }, "sf-debt", 360)
    + secPanel("Структура госдолга", `на конец ${pLabelSub(P)}, млрд ₽`,
        { text: "Из чего состоит долг: биржевые облигации, бюджетные кредиты из федерального бюджета (ставка 0,1% годовых, срок до 15 лет) и кредиты банков. Чем выше доля бюджетных кредитов, тем дешевле обслуживание, но тем сильнее регион зависит от решений федерального центра. Подпись сверху — доля рыночного долга.",
          formula: "Рыночный долг = (облигации + кредиты банков) ÷ госдолг × 100%" }, "sf-struct", 360)
    + secPanel("Дефицит бюджета и зависимость от трансфертов", `за ${pLabelSub(P)}`,
        { text: "Столбик — сальдо бюджета к доходам: отрицательное значение означает, что расходы превысили доходы и разницу закрыли долгом или остатками на счетах. Точка — доля безвозмездных поступлений из федерального бюджета: чем она выше, тем меньше регион опирается на собственную налоговую базу.",
          formula: "Дефицит к доходам = (доходы − расходы) ÷ доходы × 100%\nТрансферты = безвозмездные поступления ÷ доходы × 100%" }, "sf-deficit", 340)
    + secPanel("Траектория долга", "по годам, долг к собственным доходам",
        { text: "Как менялась долговая нагрузка регионов. Пробелы в линиях — годы, за которые показатель не найден в открытых источниках.",
          formula: "Долг / собственные доходы = госдолг на конец года ÷ (налоговые + неналоговые доходы) × 100%" }, "sf-hist", 340)
    + sectorCurveHTML(d, "Срок и премия облигаций регионов и городов. Цветом выделены эмитенты с разобранным бюджетом.")
    + secPanel("Карта погашений облигаций", "по регионам с бюджетом",
        { text: "Сколько номинала гасится в каждом году: погашения и амортизации. Субфедеральные выпуски почти всегда амортизируются — номинал возвращается частями, поэтому нагрузка размазана по годам.",
          formula: "Год = Σ по выпускам регионов: амортизации на свои даты + остаток номинала на дату погашения" }, "sec-red", 300)
    + ((d.others || []).length ? sectorOthersHTML(d, "Другие субфедеральные эмитенты") : "");

  const bindRows = () => host.querySelectorAll("tr[data-comp]").forEach(tr =>
    tr.onclick = () => openCompanyCard(tr.dataset.comp));
  const bindSort = () => {
    host.querySelectorAll("th[data-k]").forEach(th => th.onclick = () => {
      if (SECTOR.sort === th.dataset.k) SECTOR.desc = !SECTOR.desc; else { SECTOR.sort = th.dataset.k; SECTOR.desc = true; }
      host.querySelector("#sec-tbl").outerHTML = tableHTML(); bindSort(); bindRows(); wireInfoIcons(host);
    });
    host.querySelectorAll("[data-per]").forEach(c => c.onclick = () => { SECTOR.period = c.dataset.per; render(); });
  };
  bindSort(); bindRows(); wireInfoIcons(host);

  // ── федеральный бюджет и структура внутреннего долга ──
  if (fedYears.length) {
    const fv = (p, k) => { const v = (fp[p] || {})[k]; return v == null ? null : +(v / 1e6).toFixed(2); };  // млн → трлн
    mkChart(host.querySelector("#sf-fed"), { ...CHART_BG,
      tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" },
        formatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.filter(x => x.value != null).map(x =>
          `${x.marker} ${x.seriesName}: <b>${x.seriesName.startsWith("Доля") ? fmt(x.value, 1) + "%" : fmt(x.value, 2) + " трлн ₽"}</b>`).join("<br>") },
      legend: { top: 0, type: "scroll", textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: 56, right: 64, top: 40, bottom: 30 },
      xAxis: { type: "category", data: fedYears.map(pLabelSub), ...AX },
      yAxis: [{ type: "value", ...AX, name: "трлн ₽", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
          splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } } },
        { type: "value", ...AX, name: "доля ОФЗ-ПК, %", nameTextStyle: { ...AX.nameTextStyle, align: "left", padding: [0, 0, 0, 8] }, splitLine: { show: false }, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } }],
      series: [
        { name: "ОФЗ-ПД", type: "bar", stack: "f", barMaxWidth: 34, itemStyle: { color: "#2fa89b" }, data: fedYears.map(p => fv(p, "ofz_pd")) },
        { name: "ОФЗ-ПК", type: "bar", stack: "f", barMaxWidth: 34, itemStyle: { color: "#d99b3f" }, data: fedYears.map(p => fv(p, "ofz_pk")) },
        { name: "ОФЗ-ИН", type: "bar", stack: "f", barMaxWidth: 34, itemStyle: { color: "#7b8ff0" }, data: fedYears.map(p => fv(p, "ofz_in")) },
        { name: "ОФЗ-АД и ГСО", type: "bar", stack: "f", barMaxWidth: 34, itemStyle: { color: "#8aa2bd", borderRadius: [4, 4, 0, 0] },
          data: fedYears.map(p => { const a = fv(p, "ofz_ad"), g = fv(p, "gso"); return (a == null && g == null) ? null : +(((a || 0) + (g || 0))).toFixed(2); }) },
        { name: "Доля ОФЗ-ПК", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 6,
          lineStyle: { width: 2, type: "dashed", color: "#d99b3f" }, itemStyle: { color: "#d99b3f" },
          data: fedYears.map(p => (fp[p] || {}).pk_share ?? null) }] });
  }

  // ── долг к собственным доходам ──
  const withDebt = comps.filter(c => fin(c).debt_own != null).sort((a, b) => fin(b).debt_own - fin(a).debt_own);
  const catOf = arr => ({ type: "category", data: arr.map(c => c.company), ...AX, axisTick: { show: false },
    axisLine: { show: true, onZero: true, lineStyle: { color: cssVar("--line", "#2a2f38") } },
    axisLabel: { color: cssVar("--text", "#e6e9ef"), fontSize: 10, fontWeight: 600, interval: 0, rotate: 32, margin: 8 } });
  const dch = mkChart(host.querySelector("#sf-debt"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: v => v == null ? "—" : fmt(v, 0) + "%" },
    grid: { left: 54, right: 20, top: 24, bottom: 96 },
    xAxis: catOf(withDebt),
    yAxis: { type: "value", ...AX, name: "% собственных доходов", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
      splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } },
      axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } },
    series: [{ name: "Долг / собственные доходы", type: "bar", barMaxWidth: 26,
      label: { show: true, position: "top", distance: 5, fontSize: 10, color: cssVar("--muted", "#8aa"), formatter: p => fmt(p.value, 0) + "%" },
      data: withDebt.map(c => ({ value: +(100 * fin(c).debt_own).toFixed(0), itemStyle: { color: debtColor(fin(c).debt_own), borderRadius: [4, 4, 0, 0] } })),
      markLine: { silent: true, symbol: "none", lineStyle: { color: "#d9453f", type: "dashed", width: 1.2 },
        label: { formatter: "85% — порог Минфина", color: cssVar("--muted", "#8aa"), fontSize: 10 }, data: [{ yAxis: 85 }] } }] });
  if (dch) dch.on("click", p => { const c = withDebt[p.dataIndex]; if (c) openCompanyCard(c.company); });

  // ── структура долга ──
  const withStruct = comps.filter(c => fin(c).debt != null).sort((a, b) => fin(b).debt - fin(a).debt);
  const part = (c, k) => { const v = fin(c)[k]; return v == null ? null : +(v / 1000).toFixed(1); };
  mkChart(host.querySelector("#sf-struct"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: v => v == null ? "—" : fmt(v, 1) + " млрд ₽" },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 58, right: 20, top: 40, bottom: 96 },
    xAxis: catOf(withStruct),
    yAxis: { type: "value", ...AX, name: "млрд ₽", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
      splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } } },
    series: [
      { name: "Облигации", type: "bar", stack: "s", barMaxWidth: 30, itemStyle: { color: "#d99b3f" }, data: withStruct.map(c => part(c, "bonds")) },
      { name: "Кредиты банков", type: "bar", stack: "s", barMaxWidth: 30, itemStyle: { color: "#5b93de" }, data: withStruct.map(c => part(c, "bank_loans")) },
      { name: "Бюджетные кредиты", type: "bar", stack: "s", barMaxWidth: 30, itemStyle: { color: "#2fa89b" },
        label: { show: true, position: "top", distance: 5, fontSize: 10, color: cssVar("--muted", "#8aa"),
          formatter: p => { const f = fin(withStruct[p.dataIndex]); return f.market_share == null ? "" : "рынок " + fmt(f.market_share, 0) + "%"; } },
        data: withStruct.map(c => part(c, "budget_loans")) }] });

  // ── дефицит и трансферты ──
  const withBal = comps.filter(c => fin(c).bal_inc != null).sort((a, b) => fin(a).bal_inc - fin(b).bal_inc);
  mkChart(host.querySelector("#sf-deficit"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: v => v == null ? "—" : fmt(v, 1) + "%" },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 54, right: 62, top: 40, bottom: 96 },
    xAxis: catOf(withBal),
    yAxis: [{ type: "value", ...AX, name: "сальдо, %", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
        splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } }, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } },
      { type: "value", ...AX, name: "трансферты, %", nameTextStyle: { ...AX.nameTextStyle, align: "left", padding: [0, 0, 0, 8] }, splitLine: { show: false }, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } }],
    series: [
      { name: "Сальдо бюджета к доходам", type: "bar", barMaxWidth: 26,
        data: withBal.map(c => ({ value: fin(c).bal_inc, itemStyle: { color: fin(c).bal_inc >= 0 ? "#2fa89b" : "#d9453f", borderRadius: fin(c).bal_inc >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] } })) },
      { name: "Доля трансфертов", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 7, lineStyle: { width: 0 },
        itemStyle: { color: "#7b8ff0" }, data: withBal.map(c => fin(c).grants_share) }] });

  // ── траектория долга ──
  const years = per.filter(p => !/^\dм/.test(p));
  mkChart(host.querySelector("#sf-hist"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, formatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.filter(x => x.value != null)
      .map(x => `${x.marker} ${x.seriesName}: <b>${fmt(x.value, 0)}%</b>`).join("<br>") },
    legend: { top: 0, type: "scroll", textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 10 }, itemWidth: 12, itemHeight: 7 },
    grid: { left: 54, right: 24, top: 52, bottom: 30 },
    xAxis: { type: "category", data: years, ...AX },
    yAxis: { type: "value", ...AX, name: "% собственных доходов", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
      axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } },
    series: comps.map((c, i) => ({ name: c.company, type: "line", connectNulls: true, symbol: "circle", symbolSize: 5,
      lineStyle: { width: 1.8, color: SEC_PAL[i % SEC_PAL.length] }, itemStyle: { color: SEC_PAL[i % SEC_PAL.length] },
      data: years.map(y => { const f = (c.fin || {})[y]; return f && f.debt_own != null ? +(100 * f.debt_own).toFixed(0) : null; }) })) });

  drawSectorCurve(host, d, "Прочие регионы");
  drawSectorRedemption(host, d);
}

// полугодие подписываем как отчётную дату, а не как год
const pLabelSub = p => /^(\d)м(\d{4})$/.test(p) ? `6 месяцев ${p.slice(2)}` : p;

// ── карточка одного региона ──
async function renderSubfedRegion(host, d, name = SECTOR.company) {
  const c = (d.companies || []).find(x => x.company === name);
  if (!c) { SECTOR.company = null; return render(); }
  const per = (d.periods || []).filter(p => (c.fin || {})[p]);
  const years = per.filter(p => !/^\dм/.test(p));
  const P = per.filter(p => ((c.fin || {})[p] || {}).debt != null).slice(-1)[0] || per[per.length - 1];
  const fin = p => (c.fin || {})[p] || {};
  const F = fin(P), m = c.market || {};
  const bn = x => x == null ? "—" : fmt(x / 1000, Math.abs(x) >= 100000 ? 0 : 1);
  const bnRub = x => x == null ? "—" : fmt(x / 1e9, 1);
  const pc = (v, n = 1) => v == null ? "—" : fmt(v, n) + "%";
  const kpi = (l, v, sub) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${sub || ""}</div></div>`;

  host.innerHTML = `
    <div class="toolbar"><button class="btn ghost" id="sc-back">← Ко всем регионам</button></div>
    <div class="panel">
      <div class="muted" style="font-size:11px;letter-spacing:.18em;text-transform:uppercase">Субфедеральный эмитент · бюджет ${per[0] || ""} — ${pLabelSub(per[per.length - 1] || "")}</div>
      <h3 style="font-size:22px;margin:8px 0 4px">${escA(name)}</h3>
      <div class="muted" style="font-size:12px">${m.rating ? `рейтинг ${m.rating}${m.rating_agency ? " · " + agName(m.rating_agency) : ""}` : "рейтинга нет"} · выпусков в обращении ${m.issues || 0}</div>
      <div class="kpis" style="margin-top:14px">
        ${kpi("Долг / собств. доходы", `<span style="color:${debtColor(F.debt_own)}">${F.debt_own == null ? "—" : fmt(100 * F.debt_own, 0) + "%"}</span>`, `госдолг ${bn(F.debt)} млрд ₽ на конец ${pLabelSub(P)}`)}
        ${kpi("Дефицит к доходам", pc(F.bal_inc), F.bal == null ? "" : `сальдо ${bn(F.bal)} млрд ₽`)}
        ${kpi("Трансферты", pc(F.grants_share, 0), "доля безвозмездных поступлений")}
        ${kpi("Обслуживание долга", pc(F.svc_exp, 2), "к расходам бюджета")}
        ${kpi("Рыночный долг", pc(F.market_share, 0), `облигации ${pc(F.bonds_share, 0)}, банки ${pc(F.bank_share, 0)}`)}
        ${kpi("Премия рынка", m.spread_bp == null ? "—" : "+" + fmt(m.spread_bp, 0) + " б.п.", `долг на рынке ${bnRub(m.volume)} млрд ₽`)}
      </div>
      <div class="muted" style="font-size:11px;margin-top:10px">Источники${infoIcon("Источники · " + name,
        (d.sources_note || "") + ((c.sources || []).length ? "  Ручной разбор опирался на: " + (c.sources || []).join("  •  ") : ""), "")}: госдолг и его структура — Минфин России, исполнение бюджета за 2025 и 6 месяцев 2026 — Казначейство (форма 0503317, бюджет субъекта), более ранние периоды — разбор открытых источников.</div>
    </div>
    <div class="panel"><h3>Доходы, расходы и сальдо <span class="muted" style="font-weight:400;font-size:12px">· млрд ₽ за период</span>${infoIcon("Доходы, расходы и сальдо",
      "Доходы бюджета разложены на собственные (налоговые и неналоговые) и безвозмездные поступления из федерального бюджета. Линия расходов выше столбика доходов означает дефицит: разницу регион закрывает долгом или остатками на счетах.",
      "Сальдо = доходы − расходы\nТрансферты = безвозмездные поступления ÷ доходы × 100%")}</h3>
      <div class="chart" id="sf-inc" style="height:300px;margin-top:8px"></div></div>
    <div class="panel"><h3>Госдолг и его структура <span class="muted" style="font-weight:400;font-size:12px">· млрд ₽ на конец периода</span>${infoIcon("Госдолг и его структура",
      "Облигации и кредиты банков — рыночный долг: ставка по нему следует за ключевой. Бюджетные кредиты выдаются из федерального бюджета под 0,1% годовых на срок до 15 лет, поэтому регионы с их высокой долей платят за долг заметно меньше. Линия — отношение всего долга к собственным доходам.",
      "Рыночный долг = (облигации + кредиты банков) ÷ госдолг × 100%\nДолг / собственные доходы = госдолг ÷ (налоговые + неналоговые доходы) × 100%")}</h3>
      <div class="chart" id="sf-debtmix" style="height:300px;margin-top:8px"></div></div>
    <div class="panel"><h3>Показатели по периодам${infoIcon("Показатели по периодам",
      "Суммы — в млрд ₽, коэффициенты — в процентах. За полугодие отношения к доходам и расходам не считаются: полугодовые потоки несопоставимы с годовыми, поэтому в столбце 6 месяцев показаны только долг и его структура. Прочерк означает, что величина не найдена в открытых источниках.",
      "Долг / собственные доходы = госдолг ÷ (налоговые + неналоговые доходы) × 100%\nДефицит к доходам = (доходы − расходы) ÷ доходы × 100%")}</h3>
      <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th style="text-align:left">Показатель</th>${per.map(p => `<th>${pLabelSub(p)}</th>`).join("")}</tr></thead><tbody>
        ${[["Доходы, млрд ₽", p => bn(fin(p).inc)], ["в т.ч. собственные", p => bn(fin(p).own)],
           ["в т.ч. безвозмездные", p => bn(fin(p).grants)], ["Расходы, млрд ₽", p => bn(fin(p).exp)],
           ["Сальдо, млрд ₽", p => bn(fin(p).bal)], ["Обслуживание долга, млрд ₽", p => bn(fin(p).svc)],
           ["Госдолг, млрд ₽", p => bn(fin(p).debt)], ["в т.ч. облигации", p => bn(fin(p).bonds)],
           ["в т.ч. бюджетные кредиты", p => bn(fin(p).budget_loans)], ["в т.ч. кредиты банков", p => bn(fin(p).bank_loans)],
           ["Госгарантии", p => bn(fin(p).guarantees)],
           ["Долг / собственные доходы", p => fin(p).debt_own == null ? "—" : fmt(100 * fin(p).debt_own, 0) + "%"],
           ["Дефицит к доходам", p => pc(fin(p).bal_inc)], ["Трансферты", p => pc(fin(p).grants_share, 0)],
           ["Обслуживание к расходам", p => pc(fin(p).svc_exp, 2)]].map(([lbl, f]) =>
          `<tr><td style="text-align:left">${lbl}</td>${per.map(p => `<td>${f(p)}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div>
      ${Object.keys(c.notes || {}).length ? `<div class="muted" style="font-size:11px;margin-top:6px">${Object.entries(c.notes).map(([p, n]) => `<div><b>${pLabelSub(p)}:</b> ${escA(n)}</div>`).join("")}</div>` : ""}</div>
    <div class="panel"><h3>Облигации в обращении <span class="muted" style="font-weight:400;font-size:12px">· клик открывает карточку выпуска</span></h3>
      <div id="sc-bonds"><div class="loading" style="padding:14px">Загружаю выпуски…</div></div></div>`;

  host.querySelector("#sc-back").onclick = () => { SECTOR.company = null; render(); };
  wireInfoIcons(host);
  const cat = { type: "category", data: per.map(pLabelSub), ...AX };
  const val = k => per.map(p => { const v = fin(p)[k]; return v == null ? null : +(v / 1000).toFixed(1); });

  mkChart(host.querySelector("#sf-inc"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: v => v == null ? "—" : fmt(v, 1) + " млрд ₽" },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 58, right: 24, top: 36, bottom: 30 }, xAxis: cat,
    yAxis: { type: "value", ...AX, name: "млрд ₽", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
      splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } } },
    series: [
      { name: "Собственные доходы", type: "bar", stack: "i", barMaxWidth: 30, itemStyle: { color: "#2fa89b" }, data: val("own") },
      { name: "Безвозмездные поступления", type: "bar", stack: "i", barMaxWidth: 30, itemStyle: { color: "#7fc9bf", borderRadius: [4, 4, 0, 0] }, data: val("grants") },
      { name: "Расходы", type: "line", symbol: "circle", symbolSize: 7, lineStyle: { width: 2.4, color: "#d99b3f" }, itemStyle: { color: "#d99b3f" }, data: val("exp") },
      { name: "Сальдо", type: "line", symbol: "circle", symbolSize: 6, lineStyle: { width: 2, type: "dashed", color: "#7b8ff0" }, itemStyle: { color: "#7b8ff0" }, data: val("bal") }] });

  mkChart(host.querySelector("#sf-debtmix"), { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" },
      formatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.filter(x => x.value != null).map(x =>
        `${x.marker} ${x.seriesName}: <b>${x.seriesName.startsWith("Долг /") ? fmt(x.value, 0) + "%" : fmt(x.value, 1) + " млрд ₽"}</b>`).join("<br>") },
    legend: { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 58, right: 62, top: 36, bottom: 30 }, xAxis: cat,
    yAxis: [{ type: "value", ...AX, name: "млрд ₽", nameGap: 16, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
        splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } } },
      { type: "value", ...AX, name: "% собств. доходов", nameTextStyle: { ...AX.nameTextStyle, align: "left", padding: [0, 0, 0, 8] }, splitLine: { show: false }, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } }],
    series: [
      { name: "Облигации", type: "bar", stack: "d", barMaxWidth: 30, itemStyle: { color: "#d99b3f" }, data: val("bonds") },
      { name: "Кредиты банков", type: "bar", stack: "d", barMaxWidth: 30, itemStyle: { color: "#5b93de" }, data: val("bank_loans") },
      { name: "Бюджетные кредиты", type: "bar", stack: "d", barMaxWidth: 30, itemStyle: { color: "#2fa89b", borderRadius: [4, 4, 0, 0] }, data: val("budget_loans") },
      { name: "Долг / собственные доходы", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 6,
        lineStyle: { width: 2, type: "dashed", color: "#7b8ff0" }, itemStyle: { color: "#7b8ff0" },
        data: per.map(p => fin(p).debt_own == null ? null : +(100 * fin(p).debt_own).toFixed(0)) }] });

  await loadCompanyBonds(host.querySelector("#sc-bonds"), m.isins || []);
}

// ── секторы с кредитными метриками: электроэнергетика и ЖКХ, ритейл и торговля ──
// Отчётность — файлы кредитных метрик (выручка, EBITDA, долг, покрытие процентов, FCF, оборотный
// капитал) за 2021–2025 и LTM 6м2026, по МСФО и РСБУ. У РСБУ-компаний без раскрытой амортизации
// EBITDA нет — там нагрузка считается от EBIT и на графиках идёт пунктиром.
const CORP = { std: "both", sort: "vol", desc: true };
const corpFin = (c, p) => (c.fin || {})[p] || {};
const corpLast = (d, c) => { const ps = (d.periods || []).filter(p => { const f = corpFin(c, p); return f.revenue != null || f.debt != null; }); return ps.length ? ps[ps.length - 1] : null; };
const corpPer = (d, p) => p === d.last_period ? (corpFin(d.companies[0] || {}, p).x2 ? `${p} ×2` : `LTM ${p}`) : p;
// нагрузка: чистый долг / EBITDA, а без EBITDA — к EBIT (помечаем)
const corpLev = f => f.nd_ebitda != null ? { v: f.nd_ebitda, ebit: false } : f.nd_ebit != null ? { v: f.nd_ebit, ebit: true } : { v: null, ebit: false };
const corpCov = f => f.cov != null ? { v: f.cov, ebit: false } : f.ebit_cov != null ? { v: f.ebit_cov, ebit: true } : { v: null, ebit: false };
const bnM = x => x == null ? "—" : fmt(x / 1000, Math.abs(x) >= 100000 ? 0 : 1);          // млн → млрд
const pcC = (v, n = 1) => v == null ? "—" : fmt(v, n) + "%";
const xC = (v, n = 1) => v == null ? "—" : fmt(v, n) + "×";

function renderCorp(head, host, d) {
  const P = d.last_period, per = d.periods || [];
  const pLabel = p => corpPer(d, p);
  const volOf = c => (c.market || {}).volume || 0;
  const std = c => c.standard === "МСФО" ? "msfo" : "rsbu";
  const pool = d.companies.filter(c => CORP.std === "both" || std(c) === CORP.std).sort((a, b) => volOf(b) - volOf(a));
  const TOPS = [[10, "Топ-10"], [20, "Топ-20"], ["all", `Все · ${pool.length}`]];
  // общий выбор не трогаем: в энергетике 10 компаний, и «Все» иначе переезжало в ритейл с его 42
  const topEff = SECTOR.top !== "all" && pool.length <= SECTOR.top ? "all" : SECTOR.top;
  const comps = topEff === "all" ? pool : pool.slice(0, topEff);
  const k = d.kpi || {};
  const TITLE = { utilities: "Кредитный профиль энергетики и ЖКХ", retail: "Кредитный профиль ритейла и торговли" };

  head.innerHTML = `
    ${sectorTabsHTML()}
    <h3 style="font-size:24px;margin:2px 0 6px">${TITLE[d.key] || escA(d.sector)}</h3>
    <div class="kpis" style="margin-top:14px">
      <div class="kpi"><div class="label">Эмитентов с облигациями</div><div class="value">${k.issuers}</div><div class="sub">${k.issues} выпусков в секторе</div></div>
      <div class="kpi"><div class="label">Долг на рынке</div><div class="value">${fmt((k.volume || 0) / 1e9, 0)} млрд ₽</div><div class="sub">в обращении</div></div>
      <div class="kpi"><div class="label">Медианная премия</div><div class="value">${k.median_spread_bp == null ? "—" : "+" + fmt(k.median_spread_bp, 0) + " б.п."}</div><div class="sub">по компаниям с отчётностью</div></div>
      <div class="kpi"><div class="label">Отчётность</div><div class="value">${k.reported} ${plural(k.reported, "компания", "компании", "компаний")}</div><div class="sub">МСФО ${k.reported_msfo} · РСБУ ${k.reported_rsbu} · 2021 — ${pLabel(P)}</div></div>
    </div>
    <div class="filters" style="margin-top:12px"><div class="field full"><label>Компании на графиках и в таблице</label>
      <div class="chips" id="cp-top">${TOPS.map(([t, l]) => `<span class="chip ${String(topEff) === String(t) ? "on" : ""}" data-top="${t}">${l}</span>`).join("")}</div>
      <div class="chips" id="cp-std" style="margin-top:8px">${[["msfo", "МСФО"], ["rsbu", "РСБУ"], ["both", "Оба стандарта"]]
        .map(([t, l]) => `<span class="chip ${CORP.std === t ? "on" : ""}" data-std="${t}">${l}</span>`).join("")}</div>
      <div class="muted" style="font-size:11px;margin-top:4px">по долгу на рынке, от крупнейших. Где EBITDA не раскрыта (РСБУ без амортизации), нагрузка и покрытие считаются от EBIT — такие значения помечены, а на графиках идут пунктиром</div></div></div>`;
  head.querySelectorAll("[data-sec]").forEach(c => c.onclick = () => { SECTOR.key = c.dataset.sec; SECTOR.data = null; SECTOR.company = null; render(); });
  head.querySelectorAll("#cp-top [data-top]").forEach(c => c.onclick = () => { SECTOR.top = c.dataset.top === "all" ? "all" : +c.dataset.top; render(); });
  head.querySelectorAll("#cp-std [data-std]").forEach(c => c.onclick = () => { CORP.std = c.dataset.std; render(); });

  const COLS = [["company", "Компания", "l"], ["rating", "Рейтинг"], ["rev", "Выручка"], ["em", "Маржа EBITDA"], ["lev", "Чистый долг / EBITDA"],
    ["cov", "ICR · EBITDA / %"], ["fcf", "FCF / долг"], ["liq", "Деньги / короткий долг"], ["de", "Долг / капитал"], ["roe", "ROE"],
    ["spread", "Премия рынка"], ["vol", "Долг на рынке"]];
  const val = (c, key) => { const f = corpFin(c, corpLast(d, c)), m = c.market || {};
    return ({ company: c.company, rating: m.rating_score, rev: f.revenue, em: f.ebitda_m, lev: corpLev(f).v, cov: corpCov(f).v,
      fcf: f.fcf_debt, liq: f.liq, de: f.de, roe: f.roe, spread: m.spread_bp, vol: m.volume })[key]; };
  const tableHTML = () => {
    const rows = [...comps].sort((a, b) => { const x = val(a, CORP.sort), y = val(b, CORP.sort);
      if (x == null) return 1; if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y, "ru") : x - y) * (CORP.desc ? -1 : 1); });
    const arrow = key => CORP.sort === key ? (CORP.desc ? " ▾" : " ▴") : " ⇅";
    const body = rows.map(c => { const lp = corpLast(d, c), f = corpFin(c, lp), m = c.market || {}, L = corpLev(f), C = corpCov(f);
      return `<tr data-comp="${escA(c.company)}" style="cursor:pointer">
        <td style="text-align:left"><b style="color:${levColor(L.v)}">${escA(c.company)}</b> <span class="muted" style="font-size:10px">${c.standard}</span>
          ${lp && lp !== P ? `<div class="muted" style="font-size:10px">данные за ${pLabel(lp)}</div>` : ""}</td>
        <td>${m.rating ? `<span class="pill">${m.rating}</span>` : "—"}</td>
        <td>${bnM(f.revenue)} млрд<div class="muted" style="font-size:10px">рост ${pcC(f.rev_g, 0)}</div></td>
        <td>${pcC(f.ebitda_m)}</td>
        <td style="font-weight:600;color:${levColor(L.v)}">${xC(L.v, 2)}${L.ebit ? `<div class="muted" style="font-size:10px;font-weight:400">к EBIT</div>` : f.ndl_ebitda != null && f.ndl_ebitda !== f.nd_ebitda ? `<div class="muted" style="font-size:10px;font-weight:400">с арендой ${xC(f.ndl_ebitda, 2)}</div>` : ""}</td>
        <td>${xC(C.v)}${C.ebit ? `<div class="muted" style="font-size:10px">EBIT</div>` : ""}</td>
        <td>${pcC(f.fcf_debt, 0)}</td>
        <td>${f.liq != null && f.liq > 20 ? "> 20×" : xC(f.liq, 2)}</td>
        <td>${f.de == null ? "—" : (f.de < 0 ? "капитал < 0" : xC(f.de, 2))}</td>
        <td>${pcC(f.roe, 0)}</td>
        <td>${m.spread_bp == null ? "—" : (m.spread_bp >= 0 ? "+" : "") + fmt(m.spread_bp, 0) + " б.п."}<div class="muted" style="font-size:10px">${m.issues || 0} вып.</div></td>
        <td>${m.volume ? fmt(m.volume / 1e9, 1) + " млрд" : "нет бумаг"}</td></tr>`; }).join("");
    return `<div class="panel" id="cp-tbl"><h3>Показатели за последний период <span class="muted" style="font-weight:400;font-size:12px">· ${pLabel(P)}, клик по строке открывает карточку</span>${infoIcon("Показатели",
        "Чистый долг / EBITDA — сколько лет компания будет гасить долг из операционного потока. Покрытие процентов — во сколько раз EBITDA больше процентных расходов. FCF / долг — какую долю долга компания может погасить свободным денежным потоком за год. Деньги / короткий долг — хватит ли денег на погашения ближайшего года. Долг — кредиты, займы и облигации; с арендой — плюс обязательства по аренде.",
        "Чистый долг = долг − деньги − краткосрочные финвложения\nEBITDA = операционная прибыль + амортизация\nЧистый долг / EBITDA = чистый долг ÷ EBITDA\nПокрытие процентов = EBITDA ÷ процентные расходы\nFCF = операционный денежный поток − capex\nLTM = 2025 − 6м2025 + 6м2026")}</h3>
      <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr>${COLS.map(([key, l, al]) =>
        `<th data-k="${key}" style="cursor:pointer;user-select:none;text-align:${al === "l" ? "left" : "center"}">${l}<span class="muted" style="font-size:10px">${arrow(key)}</span></th>`).join("")}</tr></thead>
      <tbody>${body}</tbody></table></div></div>`;
  };

  host.innerHTML = tableHTML()
    + secPanel("Долговая нагрузка", "по годам, чистый долг / EBITDA",
        { text: "Сколько лет EBITDA нужно, чтобы погасить чистый долг. Выше 3,5× — нагрузка высокая, выше 4,5× — критическая для большинства ковенантов. Пунктир — компании без EBITDA: там нагрузка считается к EBIT, она заведомо выше.",
          formula: "Чистый долг / EBITDA = (долг − деньги − краткосрочные финвложения) ÷ EBITDA" }, "cp-lev", 320)
    + secPanel("ICR — покрытие процентов", "по годам, EBITDA / проценты",
        { text: "Во сколько раз операционный поток больше процентных расходов. Ниже 2× — компании тяжело обслуживать долг при нынешних ставках. Пунктир — покрытие от EBIT.",
          formula: "Покрытие = EBITDA ÷ процентные расходы" }, "cp-cov", 320)
    + secPanel("Рентабельность", "по годам, маржа EBITDA",
        { text: "Какая доля выручки остаётся операционным потоком до амортизации. У сетевых компаний и генерации маржа высокая и стабильная, у торговли — тонкая, и её снижение быстро бьёт по покрытию процентов.",
          formula: "Маржа EBITDA = EBITDA ÷ выручка × 100%" }, "cp-mrg", 320)
    + secPanel("Премия рынка против нагрузки", "на последнюю дату",
        { text: "Каждая точка — компания: по горизонтали чистый долг / EBITDA, по вертикали медианная премия её облигаций. Компании выше общей тенденции рынок оценивает дешевле, чем подсказывает нагрузка, — либо видит риски, которых нет в отчётности.",
          formula: "Премия = медианный G-спред выпусков компании (у флоатеров — простая маржа)" }, "cp-risk", 360)
    + secPanel("Ликвидность", "на последнюю дату, деньги / короткий долг",
        { text: "Хватит ли денег на погашения ближайшего года. Меньше 1× — компании придётся рефинансироваться или платить из потока; красным — меньше 0,5×.",
          formula: "Ликвидность = (деньги + краткосрочные финвложения) ÷ краткосрочный долг" }, "cp-liq", 320)
    + sectorCurveHTML(d, "Срок и премия облигаций сектора. Цветом выделены компании с разобранной отчётностью.")
    + secPanel("Карта погашений облигаций", "по компаниям с отчётностью",
        { text: "Сколько номинала гасится в каждом году: погашения и амортизации. Оферты — отдельным столбцом.",
          formula: "Год = Σ по выпускам: амортизации на свои даты + остаток номинала на дату погашения" }, "sec-red", 300)
    + (d.others && d.others.length ? sectorOthersHTML(d, "Прочие эмитенты сектора") : "");

  const bindRows = () => host.querySelectorAll("tr[data-comp]").forEach(tr => tr.onclick = () => openCompanyCard(tr.dataset.comp));
  const bindSort = () => host.querySelectorAll("#cp-tbl th[data-k]").forEach(th => th.onclick = () => {
    if (CORP.sort === th.dataset.k) CORP.desc = !CORP.desc; else { CORP.sort = th.dataset.k; CORP.desc = true; }
    host.querySelector("#cp-tbl").outerHTML = tableHTML(); bindSort(); bindRows(); wireInfoIcons(host);
  });
  bindSort(); bindRows(); wireInfoIcons(host);

  const mkAt = (sel, opt) => { const n = host.querySelector(sel); if (n) mkChart(n, opt); };
  // линии по годам: у компаний без EBITDA — пунктир по EBIT
  const lineOpt = (getter, name, unit, dg) => ({ ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, formatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.filter(x => x.value != null)
      .map(x => `${x.marker}${x.seriesName}: <b>${fmt(x.value, dg)}${unit}</b>`).join("<br>") },
    legend: { top: 0, type: "scroll", textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 14, itemHeight: 8,
      pageIconColor: cssVar("--muted", "#8aa"), pageTextStyle: { color: cssVar("--muted", "#8aa"), fontSize: 10 } },
    grid: { left: 54, right: 24, top: 52, bottom: 30 },
    xAxis: { type: "category", data: per.map(pLabel), ...AX },
    yAxis: { type: "value", ...AX, name, nameGap: 22, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] },
      splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } },
      axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, unit === "%" ? 0 : 1) + unit } },
    series: comps.map((c, i) => { const pts = per.map(p => getter(corpFin(c, p)));
      const ebit = pts.some(x => x && x.ebit);
      return { name: c.company + (ebit ? " (к EBIT)" : ""), type: "line", connectNulls: true, symbol: "circle", symbolSize: ebit ? 4 : 6,
        lineStyle: { width: ebit ? 1.6 : 2.4, type: ebit ? "dashed" : "solid", color: leaseColor(i) }, itemStyle: { color: leaseColor(i) },
        data: pts.map(x => x ? (x.v ?? null) : null) }; }) });
  mkAt("#cp-lev", lineOpt(corpLev, "× EBITDA", "×", 2));
  mkAt("#cp-cov", lineOpt(corpCov, "× процентов", "×", 1));
  mkAt("#cp-mrg", lineOpt(f => ({ v: f.ebitda_m, ebit: false }), "маржа, %", "%", 1));

  // премия против нагрузки
  const pts = comps.map(c => { const f = corpFin(c, corpLast(d, c)), L = corpLev(f), m = c.market || {};
    return (L.v != null && m.spread_bp != null) ? { name: c.company, value: [L.v, m.spread_bp], ebit: L.ebit, vol: m.volume || 0 } : null; }).filter(Boolean);
  mkAt("#cp-risk", { ...CHART_BG,
    tooltip: { trigger: "item", confine: true, formatter: p => `<b>${escA(p.data.name)}</b><br>нагрузка ${fmt(p.data.value[0], 2)}×${p.data.ebit ? " (к EBIT)" : ""}<br>премия ${fmt(p.data.value[1], 0)} б.п.<br>долг на рынке ${fmt(p.data.vol / 1e9, 1)} млрд ₽` },
    grid: { left: 62, right: 30, top: 30, bottom: 40 },
    xAxis: { type: "value", ...AX, name: "чистый долг / EBITDA, ×", nameLocation: "middle", nameGap: 26, splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } } },
    yAxis: { type: "value", ...AX, name: "премия, б.п.", nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] }, splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } } },
    series: [{ type: "scatter", symbolSize: v => 10, data: pts.map(p => ({ ...p, itemStyle: { color: levColor(p.value[0]), opacity: p.ebit ? .55 : .9 } })),
      label: { show: true, position: "right", fontSize: 10, color: cssVar("--muted", "#8aa"), formatter: p => p.data.name.length > 16 ? p.data.name.slice(0, 15) + "…" : p.data.name } }] });

  // ликвидность
  const names = comps.map(c => c.company);
  mkAt("#cp-liq", { ...CHART_BG,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, formatter: ps => ps.filter(x => x.data).map(x => `<b>${x.name}</b><br>деньги / короткий долг: <b>${fmt(x.data.real, 2)}×</b>`).join("") },
    grid: { left: 54, right: 24, top: 30, bottom: names.length > 8 ? 96 : 34 },
    xAxis: { type: "category", data: names, ...AX, axisTick: { show: false },
      axisLabel: { color: cssVar("--text", "#e6e9ef"), fontSize: 10, fontWeight: 600, interval: 0, rotate: names.length > 8 ? 32 : 0, align: names.length > 8 ? "right" : "center", width: 120, overflow: "truncate" } },
    yAxis: { type: "value", ...AX, name: "× короткого долга", nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] }, splitLine: { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } },
      axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 1) + "×" } },
    series: [{ name: "Деньги / короткий долг", type: "bar", barMaxWidth: 30,
      // столбик обрезаем на 5×: у Ленэнерго короткого долга почти нет, и 330× сплющивало остальных
      data: comps.map(c => { const v = corpFin(c, corpLast(d, c)).liq; return v == null ? null : { value: +Math.min(v, 5).toFixed(2), real: v, itemStyle: { color: v < 0.5 ? "#d9453f" : v < 1 ? "#e2a03f" : "#2fa89b", borderRadius: [4, 4, 0, 0] } }; }),
      label: { show: true, position: "top", fontSize: 10, color: cssVar("--muted", "#8aa"), formatter: p => p.data == null ? "" : (p.data.real > 5 ? "> 5×" : fmt(p.data.real, 1) + "×") },
      markLine: { symbol: "none", silent: true, lineStyle: { color: cssVar("--muted", "#8aa"), type: "dashed" }, label: { formatter: "1×", color: cssVar("--muted", "#8aa") }, data: [{ yAxis: 1 }] } }] });

  drawSectorCurve(host, d, "Прочие эмитенты сектора");
  drawSectorRedemption(host, d);
}

// все строки отчётности из файла за все периоды (2020 — база для средних, 6м2025 — для LTM)
const CORP_ITEMS = [
  ["Баланс", [["assets", "Активы"], ["equity", "Капитал"], ["equity_parent", "Капитал акционеров материнской компании"], ["cash", "Денежные средства"],
    ["st_fin", "Краткосрочные финвложения"], ["inventory", "Запасы"], ["receivables", "Дебиторская задолженность"], ["payables", "Кредиторская задолженность"],
    ["debt_lt", "Долгосрочные кредиты и займы"], ["debt_st", "Краткосрочные кредиты и займы"], ["lease_lt", "Аренда долгосрочная"], ["lease_st", "Аренда краткосрочная"]]],
  ["Отчёт о прибылях", [["revenue", "Выручка"], ["cogs", "Себестоимость"], ["gross_profit", "Валовая прибыль"], ["sga", "Коммерческие и управленческие"],
    ["other_oper", "Прочие операционные"], ["ebit", "Операционная прибыль (EBIT)"], ["d_a", "Амортизация"], ["ebitda_reported", "EBITDA по данным компании"],
    ["interest_exp", "Процентные расходы"], ["interest_inc", "Процентные доходы"], ["fx", "Курсовые разницы"], ["pbt", "Прибыль до налога"],
    ["tax", "Налог на прибыль"], ["net_income", "Чистая прибыль"]]],
  ["Денежный поток", [["ocf", "Операционный денежный поток"], ["capex", "Capex"], ["interest_paid", "Проценты уплаченные"],
    ["lease_paid", "Платежи по аренде"], ["dividends_paid", "Дивиденды выплаченные"]]]];
function corpItemsHTML(d, c) {
  const ps = (d.item_periods || []).filter(p => (c.items || {})[p]);
  if (!ps.length) return "";
  const cell = v => v == null ? `<span class="muted">—</span>` : fmt(v / 1000, Math.abs(v) >= 100000 ? 0 : Math.abs(v) >= 1000 ? 1 : 2);
  const rows = CORP_ITEMS.map(([sec, list]) => `<tr><td colspan="${ps.length + 1}" style="text-align:left;font-weight:700;background:var(--bg-2,rgba(127,127,127,.06))">${sec}</td></tr>`
    + list.map(([k, l]) => `<tr><td style="text-align:left">${l}</td>${ps.map(p => `<td>${cell(((c.items || {})[p] || {})[k])}</td>`).join("")}</tr>`).join("")).join("");
  const notes = ps.filter(p => (c.notes || {})[p] || (c.sources || {})[p]);
  return `<div class="panel"><h3>Отчётность по строкам <span class="muted" style="font-weight:400;font-size:12px">· млрд ₽, как в файле: все статьи и периоды</span>${infoIcon("Отчётность по строкам",
      "Исходные статьи, от которых считаются все показатели. 2020 год нужен как база для средних величин 2021-го, первое полугодие 2025-го — для расчёта LTM. Прочерк — статья не раскрыта, а не ноль.",
      "LTM 6м2026 = 2025 − 6м2025 + 6м2026 (потоки)\nБалансовые статьи LTM — на 30.06.2026")}</h3>
    <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th style="text-align:left">Статья</th>${ps.map(p => `<th>${p}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    ${notes.length ? `<details style="margin-top:12px"><summary class="muted" style="font-size:12px;cursor:pointer">Источники и примечания по периодам · ${notes.length}</summary>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px;max-width:940px">${notes.map(p => `<div style="font-size:12px;line-height:1.55">
        <b>${p}</b>${(c.sources || {})[p] ? `<div class="muted">Источник: ${escA(c.sources[p])}</div>` : ""}${(c.notes || {})[p] ? `<div class="muted">${escA(c.notes[p])}</div>` : ""}</div>`).join("")}</div></details>` : ""}
  </div>`;
}

async function renderCorpCompany(host, d, name = SECTOR.company) {
  const c = (d.companies || []).find(x => x.company === name);
  if (!c) { SECTOR.company = null; return render(); }
  const per = (d.periods || []).filter(p => { const f = corpFin(c, p); return f.revenue != null || f.debt != null; });
  const P = per[per.length - 1], F = corpFin(c, P), m = c.market || {};
  const pLabel = p => corpPer(d, p);
  const L = corpLev(F), C = corpCov(F);
  const kpi = (l, v, sub) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${sub || ""}</div></div>`;
  const noteP = c.notes && (c.notes[P] || c.notes["6м2026"] || c.notes["2025"]);
  host.innerHTML = `
    <div class="toolbar"><button class="btn ghost" id="sc-back">← Ко всему сектору</button></div>
    <div class="panel">
      <div class="muted" style="font-size:11px;letter-spacing:.18em;text-transform:uppercase">${escA(d.sector)} · отчётность ${c.standard} ${per[0] || ""} — ${pLabel(P)}</div>
      <h3 style="font-size:22px;margin:8px 0 4px">${escA(c.company)} <span class="muted" style="font-weight:400;font-size:13px">${escA(c.full || "")}</span></h3>
      <div class="muted" style="font-size:12px">${m.rating ? `рейтинг ${m.rating}${m.rating_agency ? " · " + agName(m.rating_agency) : ""}` : "рейтинга нет"} · выпусков в обращении ${m.issues || 0}${m.volume ? ` · долг на рынке ${fmt(m.volume / 1e9, 1)} млрд ₽` : ""}</div>
      <div class="kpis" style="margin-top:14px">
        ${kpi("Выручка", bnM(F.revenue) + " млрд ₽", `рост ${pcC(F.rev_g, 1)}`)}
        ${kpi("EBITDA", F.ebitda == null ? "—" : bnM(F.ebitda) + " млрд ₽", `маржа ${pcC(F.ebitda_m, 1)} · операционная ${pcC(F.op_m, 1)}`)}
        ${kpi("Чистый долг / EBITDA", `<span style="color:${levColor(L.v)}">${xC(L.v, 2)}</span>`, L.ebit ? "к EBIT: EBITDA не раскрыта" : `с арендой ${xC(F.ndl_ebitda, 2)} · чистый долг ${bnM(F.nd)} млрд`)}
        ${kpi('ICR ' + infoIcon("ICR — покрытие процентов", "Отношение EBITDA к процентным расходам за тот же период. Если EBITDA не раскрыта, используется EBIT с явной подписью. Это не денежный поток; ниже 1× выбранная прибыль меньше процентов. Прочерк означает отсутствие расчётных данных.", "ICR EBITDA = EBITDA / процентные расходы\nICR EBIT = EBIT / процентные расходы"), xC(C.v, 2), C.ebit ? "EBIT / проценты" : "EBITDA / проценты")}
        ${kpi("FCF", F.fcf == null ? "—" : bnM(F.fcf) + " млрд ₽", `к долгу ${pcC(F.fcf_debt, 0)} · capex ${pcC(F.capex_rev, 1)} выручки`)}
        ${kpi("Ликвидность", F.liq != null && F.liq > 20 ? "> 20×" : xC(F.liq, 2), "деньги / короткий долг")}
        ${kpi("ROE", pcC(F.roe, 1), `ROIC ${pcC(F.roic, 1)} · долг / капитал ${F.de == null ? "—" : F.de < 0 ? "капитал < 0" : xC(F.de, 2)}`)}
      </div>
      ${noteP ? `<details style="margin-top:12px"><summary class="muted" style="font-size:12px;cursor:pointer">Примечание к отчётности за ${pLabel(P)}</summary><div class="muted" style="font-size:12px;line-height:1.55;margin-top:6px;max-width:900px">${escA(noteP)}</div></details>` : ""}
    </div>
    ${secPanel("Выручка и EBITDA", "млрд ₽ за период, маржа по правой оси", { text: "Столбики — выручка и EBITDA, линия — маржа EBITDA. У РСБУ-компаний без раскрытой амортизации столбика EBITDA нет.", formula: "Маржа EBITDA = EBITDA ÷ выручка × 100%" }, "cc-inc", 300)}
    ${secPanel("ICR — покрытие процентов", "динамика по периодам, ×", { text: "Две отдельные линии: покрытие от EBITDA и от EBIT. Доходы и процентные расходы относятся к одному периоду. Ниже 1× прибыль соответствующего уровня не покрывает проценты; EBITDA не равна денежному потоку. Пропуски не соединяются.", formula: "ICR EBITDA = EBITDA / процентные расходы\nICR EBIT = EBIT / процентные расходы" }, "cc-icr", 280)}
    ${secPanel("Долг и нагрузка", "млрд ₽ на конец периода, нагрузка по правой оси", { text: "Долг — кредиты, займы и облигации; чистый долг — за вычетом денег и краткосрочных финвложений. Линия — чистый долг / EBITDA (без EBITDA — к EBIT, пунктиром).", formula: "Чистый долг = долг − деньги − краткосрочные финвложения" }, "cc-debt", 300)}
    ${secPanel("Структура долга", "на конец периода", { text: "Долгосрочный и краткосрочный долг и обязательства по аренде. Линия — деньги и краткосрочные финвложения: сколько из короткого долга закрывается без рефинансирования.", formula: "Доля = часть ÷ (долгосрочный + краткосрочный долг + аренда) × 100%" }, "cc-struct", 300, unitSw("cc-struct", "rub"))}
    ${secPanel("Денежный поток", "млрд ₽ за период", { text: "Операционный поток, капитальные вложения и свободный денежный поток. Отрицательный FCF финансируется долгом.", formula: "FCF = операционный денежный поток − capex" }, "cc-cf", 300)}
    ${secPanel("Оборотный капитал", "дни", { text: "Сколько дней в среднем держатся дебиторка (DSO), запасы (DIO) и кредиторка (DPO); цикл оборотного капитала — сколько дней компания кредитует сама себя. У сетей и генерации себестоимость отдельно не раскрыта, поэтому DIO и DPO условны.", formula: "DSO = средняя дебиторка ÷ выручка × 365\nDIO = средние запасы ÷ себестоимость × 365\nDPO = средняя кредиторка ÷ себестоимость × 365\nЦикл = DSO + DIO − DPO" }, "cc-wc", 300)}
    <div class="panel"><h3>Показатели по периодам${infoIcon("Показатели по периодам", "Суммы — млрд ₽; последний столбец — LTM: скользящие 12 месяцев к 30.06.2026, балансовые статьи на эту дату.", "LTM = 2025 − 6м2025 + 6м2026")}</h3>
      <div class="tbl-wrap" style="margin-top:8px"><table><thead><tr><th style="text-align:left">Показатель</th>${per.map(p => `<th>${pLabel(p)}</th>`).join("")}</tr></thead><tbody>${[
        ["Выручка, млрд ₽", f => bnM(f.revenue)], ["Рост выручки", f => pcC(f.rev_g)], ["EBITDA, млрд ₽", f => bnM(f.ebitda)],
        ["EBIT, млрд ₽", f => bnM(f.ebit)], ["Чистая прибыль, млрд ₽", f => bnM(f.ni)],
        ["Маржа EBITDA", f => pcC(f.ebitda_m)], ["Операционная маржа", f => pcC(f.op_m)], ["Чистая маржа", f => pcC(f.net_m)],
        ["Долг, млрд ₽", f => bnM(f.debt)], ["Долг с арендой, млрд ₽", f => bnM(f.debt_l)],
        ["Чистый долг, млрд ₽", f => bnM(f.nd)], ["Чистый долг с арендой, млрд ₽", f => bnM(f.nd_l)],
        ["Чистый долг / EBITDA", f => xC(f.nd_ebitda, 2)], ["Чистый долг с арендой / EBITDA", f => xC(f.ndl_ebitda, 2)],
        ["Долг / EBITDA", f => xC(f.d_ebitda, 2)], ["Чистый долг / EBIT", f => xC(f.nd_ebit, 2)],
        ["ICR · EBITDA / проценты", f => xC(f.cov, 2)], ["ICR · EBIT / проценты", f => xC(f.ebit_cov, 2)],
        ["FCF, млрд ₽", f => bnM(f.fcf)], ["FCF / долг", f => pcC(f.fcf_debt, 0)], ["Capex / выручка", f => pcC(f.capex_rev)],
        ["Деньги / короткий долг", f => f.liq != null && f.liq > 20 ? "> 20×" : xC(f.liq, 2)], ["Долг / капитал", f => f.de == null ? "—" : f.de < 0 ? "капитал < 0" : xC(f.de, 2)],
        ["Капитал / активы", f => pcC(f.eqa, 0)], ["ROE", f => pcC(f.roe)], ["ROIC", f => pcC(f.roic)],
        ["Дебиторка (DSO), дн.", f => f.dso == null ? "—" : fmt(f.dso, 0)], ["Запасы (DIO), дн.", f => f.dio == null ? "—" : fmt(f.dio, 0)],
        ["Кредиторка (DPO), дн.", f => f.dpo == null ? "—" : fmt(f.dpo, 0)], ["Цикл оборотного капитала, дн.", f => f.ccc == null ? "—" : fmt(f.ccc, 0)]]
        .map(([l, fn]) => `<tr><td style="text-align:left">${l}</td>${per.map(p => `<td>${fn(corpFin(c, p))}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>
    ${corpItemsHTML(d, c)}
    <div class="panel"><h3>Облигации в обращении</h3><div id="sc-bonds"><div class="loading"></div></div></div>`;
  host.querySelector("#sc-back").onclick = () => { SECTOR.company = null; render(); };
  wireInfoIcons(host);

  const cat = { type: "category", data: per.map(pLabel), ...AX };
  const bnv = x => x == null ? null : +(x / 1000).toFixed(1);
  const val = k => per.map(p => bnv(corpFin(c, p)[k]));
  const legend = { top: 0, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 12, itemHeight: 8 };
  const split = { show: true, lineStyle: { color: cssVar("--line", "#2a2f38"), opacity: .35 } };
  const yBn = { type: "value", ...AX, name: "млрд ₽", nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] }, splitLine: split, axisLabel: { color: AXIS_TXT, formatter: bnAxis } };
  const mk = (id, opt) => { const n = host.querySelector(id); if (n) mkChart(n, opt); };
  mk("#cc-icr", { ...CHART_BG, legend, grid: { left: 58, right: 30, top: 36, bottom: 30 }, xAxis: cat,
    tooltip: { trigger: "axis", confine: true, valueFormatter: v => xC(v, 2) },
    yAxis: { type: "value", ...AX, name: "×", splitLine: split, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 1) + "×" } },
    series: [
      { name: "ICR · EBITDA", type: "line", connectNulls: false, data: per.map(p => corpFin(c, p).cov ?? null),
        itemStyle: { color: "#2fa89b" }, lineStyle: { width: 2 },
        markLine: { silent: true, symbol: "none", data: [{ yAxis: 1, name: "Покрытие 1×" }], label: { formatter: "1×" } } },
      { name: "ICR · EBIT", type: "line", connectNulls: false, data: per.map(p => corpFin(c, p).ebit_cov ?? null),
        itemStyle: { color: "#5b93de" }, lineStyle: { width: 2, type: "dashed" } }] });
  mk("#cc-inc", { ...CHART_BG, legend, grid: { left: 58, right: 58, top: 36, bottom: 30 }, xAxis: cat,
    tooltip: { trigger: "axis", confine: true, formatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.filter(x => x.value != null).map(x => `${x.marker}${x.seriesName}: <b>${x.seriesName.startsWith("Маржа") ? fmt(x.value, 1) + "%" : fmt(x.value, 1) + " млрд ₽"}</b>`).join("<br>") },
    yAxis: [yBn, { type: "value", ...AX, name: "маржа, %", nameTextStyle: { ...AX.nameTextStyle, align: "left", padding: [0, 0, 0, 8] }, splitLine: { show: false }, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 0) + "%" } }],
    series: [{ name: "Выручка", type: "bar", barMaxWidth: 26, itemStyle: { color: "#5b93de", borderRadius: [4, 4, 0, 0] }, data: val("revenue") },
      { name: "EBITDA", type: "bar", barMaxWidth: 26, itemStyle: { color: "#2fa89b", borderRadius: [4, 4, 0, 0] }, data: val("ebitda") },
      { name: "Маржа EBITDA", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 6, lineStyle: { width: 2, type: "dashed", color: "#d99b3f" }, itemStyle: { color: "#d99b3f" }, data: per.map(p => corpFin(c, p).ebitda_m ?? null) }] });
  const levPts = per.map(p => corpLev(corpFin(c, p)));
  const levEbit = levPts.some(x => x.ebit);
  mk("#cc-debt", { ...CHART_BG, legend, grid: { left: 58, right: 58, top: 36, bottom: 30 }, xAxis: cat,
    tooltip: { trigger: "axis", confine: true, formatter: ps => `<b>${ps[0].axisValue}</b><br>` + ps.filter(x => x.value != null).map(x => `${x.marker}${x.seriesName}: <b>${x.seriesIndex === 2 ? fmt(x.value, 2) + "×" : fmt(x.value, 1) + " млрд ₽"}</b>`).join("<br>") },
    yAxis: [yBn, { type: "value", ...AX, name: "× EBITDA", nameTextStyle: { ...AX.nameTextStyle, align: "left", padding: [0, 0, 0, 8] }, splitLine: { show: false }, axisLabel: { color: AXIS_TXT, formatter: v => fmt(v, 1) + "×" } }],
    series: [{ name: "Долг", type: "bar", barMaxWidth: 26, itemStyle: { color: "#8aa2bd", borderRadius: [4, 4, 0, 0] }, data: val("debt") },
      { name: "Чистый долг", type: "bar", barMaxWidth: 26, itemStyle: { color: "#d99b3f", borderRadius: [4, 4, 0, 0] }, data: val("nd") },
      { name: levEbit ? "Чистый долг / EBIT" : "Чистый долг / EBITDA", type: "line", yAxisIndex: 1, symbol: "circle", symbolSize: 7,
        lineStyle: { width: 2.4, type: levEbit ? "dashed" : "solid", color: "#d9453f" }, itemStyle: { color: "#d9453f" }, data: levPts.map(x => x.v) }] });
  UNIT_DRAW["cc-struct"] = () => {
    const pctM = UNIT["cc-struct"] === "pct";
    const parts = per.map(p => { const f = corpFin(c, p); const lt = f.debt_lt || 0, stt = f.debt_st || 0, ls = (f.lease_lt || 0) + (f.lease_st || 0), t = lt + stt + ls;
      return { lt, stt, ls, t, cash: (f.cash || 0) + (f.st_fin || 0), has: f.debt_lt != null || f.debt_st != null }; });
    const v = (x, k) => !x.has ? null : pctM ? (x.t ? +(100 * x[k] / x.t).toFixed(1) : null) : +(x[k] / 1000).toFixed(1);
    mk("#cc-struct", { ...CHART_BG, legend, grid: { left: 58, right: 24, top: 36, bottom: 30 }, xAxis: cat,
      tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: x => x == null ? "—" : pctM ? fmt(x, 1) + "%" : fmt(x, 1) + " млрд ₽" },
      yAxis: pctM ? { type: "value", ...AX, name: "доля, %", max: 100, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] }, splitLine: split, axisLabel: { color: AXIS_TXT, formatter: x => fmt(x, 0) + "%" } } : yBn,
      series: [{ name: "Долгосрочный долг", type: "bar", stack: "s", barMaxWidth: 34, itemStyle: { color: "#5b93de" }, data: parts.map(x => v(x, "lt")) },
        { name: "Краткосрочный долг", type: "bar", stack: "s", barMaxWidth: 34, itemStyle: { color: "#d99b3f" }, data: parts.map(x => v(x, "stt")) },
        { name: "Аренда", type: "bar", stack: "s", barMaxWidth: 34, itemStyle: { color: "#8aa2bd" }, data: parts.map(x => v(x, "ls")) },
        ...(pctM ? [] : [{ name: "Деньги и финвложения", type: "line", symbol: "circle", symbolSize: 6, lineStyle: { width: 2, color: "#3ecf8e" }, itemStyle: { color: "#3ecf8e" }, data: parts.map(x => x.has ? +(x.cash / 1000).toFixed(1) : null) }])] });
  };
  UNIT_DRAW["cc-struct"]();
  wireUnitSw(host);
  mk("#cc-cf", { ...CHART_BG, legend, grid: { left: 58, right: 24, top: 36, bottom: 30 }, xAxis: cat,
    tooltip: { trigger: "axis", confine: true, axisPointer: { type: "shadow" }, valueFormatter: x => x == null ? "—" : fmt(x, 1) + " млрд ₽" }, yAxis: yBn,
    series: [{ name: "Операционный поток", type: "bar", barMaxWidth: 22, itemStyle: { color: "#2fa89b", borderRadius: [4, 4, 0, 0] }, data: val("ocf") },
      { name: "Capex", type: "bar", barMaxWidth: 22, itemStyle: { color: "#d9453f", borderRadius: [4, 4, 0, 0] }, data: per.map(p => { const x = corpFin(c, p).capex; return x == null ? null : -Math.abs(+(x / 1000).toFixed(1)); }) },
      { name: "FCF", type: "line", symbol: "circle", symbolSize: 7, lineStyle: { width: 2.4, color: "#7b8ff0" }, itemStyle: { color: "#7b8ff0" }, data: val("fcf") }] });
  mk("#cc-wc", { ...CHART_BG, legend, grid: { left: 54, right: 24, top: 36, bottom: 30 }, xAxis: cat,
    tooltip: { trigger: "axis", confine: true, valueFormatter: x => x == null ? "—" : fmt(x, 0) + " дн." },
    yAxis: { type: "value", ...AX, name: "дни", nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] }, splitLine: split },
    series: [["dso", "Дебиторка (DSO)", "#5b93de"], ["dio", "Запасы (DIO)", "#d99b3f"], ["dpo", "Кредиторка (DPO)", "#8aa2bd"], ["ccc", "Цикл оборотного капитала", "#d9453f"]]
      .map(([k2, n2, col]) => ({ name: n2, type: "line", symbol: "circle", symbolSize: 6, lineStyle: { width: k2 === "ccc" ? 2.6 : 2, color: col, type: k2 === "ccc" ? "solid" : "dashed" }, itemStyle: { color: col },
        data: per.map(p => { const x = corpFin(c, p)[k2]; return x == null ? null : Math.round(x); }) })) });
  await loadCompanyBonds(host.querySelector("#sc-bonds"), m.isins || []);
}

function renderComingSoon(v) {
  v.appendChild(el(`<div class="panel" style="text-align:center;padding:64px 20px">
    <div style="font-size:44px;margin-bottom:14px">🛠️</div>
    <div style="font-size:22px;font-weight:700;letter-spacing:.3px">Coming soon</div>
    <div class="muted" style="margin-top:10px;font-size:14px">Аналитика эмитентов в разработке — скоро здесь появятся профили эмитентов, кредитные метрики и сравнение выпусков.</div>
  </div>`));
}

async function renderIssuers(v) {
  if (ISSUERS.detail) return renderIssuerCredit(v, ISSUERS.detail);
  v.appendChild(el(`<div class="panel"><h3>Аналитика эмитентов <span class="muted" style="font-weight:400;font-size:12px">· кредитные метрики по аудированной МСФО / РСБУ</span></h3>
    <div class="muted" style="font-size:12px">Источник — аудированная отчётность (RU&nbsp;Equity&nbsp;Terminal: PDF&nbsp;МСФО + датабуки), приведённая к канону и LTM. <b>ND/EBITDA и маржи</b> надёжны; <b>ICR и Долг/Капитал</b> зависят от авто-разбора процентов/капитала — сверяйте спорные.</div></div>`));
  if (!ISSUERS.data) {
    v.appendChild(el(`<div class="loading">Загружаю отчётность эмитентов…</div>`));
    try { ISSUERS.data = await fetch(`${API}/api/issuers/credit`).then(x => x.json()); } catch (e) { ISSUERS.data = { available: false, detail: "ошибка запроса" }; }
    return render();
  }
  const d = ISSUERS.data;
  if (!d.available) {
    v.appendChild(el(`<div class="alert warn">${d.detail || "Нет данных"}.<br>Запусти терминал отчётности: <code>cd "~/Desktop/Claude Code/ru-equity-terminal" && ./run.sh</code></div>`));
    return;
  }
  const { key, dir } = ISSUERS.sort;
  const rows = [...d.rows].sort((a, b) => { const va = a[key], vb = b[key]; if (va == null) return 1; if (vb == null) return -1; const c = typeof va === "string" ? va.localeCompare(vb, "ru") : va - vb; return dir === "asc" ? c : -c; });
  const cols = [["issuer", "Эмитент", "left"], ["sector", "Сектор", "left"], ["nd_ebitda", "ND/EBITDA"], ["icr_ebitda", "ICR"], ["ebitda_margin", "EBITDA маржа"], ["net_margin", "Чист. маржа"], ["roe", "ROE"], ["rev_yoy", "Рост выр."], ["ebitda", "EBITDA"]];
  const arrow = k => key === k ? (dir === "asc" ? " ▲" : " ▼") : "";
  const head = cols.map(([k, l, al]) => `<th data-k="${k}" style="cursor:pointer;text-align:${al || "center"}">${l}${arrow(k)}</th>`).join("");
  const body = rows.map(r => `<tr data-tk="${r.ticker}"><td style="text-align:left"><span class="link">${r.issuer}</span> <span class="muted" style="font-size:10px">${r.ticker}</span></td>
    <td>${r.sector || "—"}</td>
    <td><b style="color:${ndColor(r.nd_ebitda)}">${rnum(r.nd_ebitda)}</b></td>
    <td>${rnum(r.icr_ebitda)}</td><td>${rpct(r.ebitda_margin)}</td><td>${rpct(r.net_margin)}</td>
    <td>${rpct(r.roe)}</td><td class="${r.rev_yoy >= 0 ? "pos" : "neg"}">${rpct(r.rev_yoy)}</td>
    <td>${money(r.ebitda)}</td></tr>`).join("");
  const t = el(`<div class="tbl-wrap panel"><h3>Эмитенты облигаций · ${d.count} с отчётностью <span class="muted" style="font-weight:400;font-size:12px">· ND/EBITDA: <span style="color:var(--pos,#2fe08a)">&lt;2</span> / <span style="color:var(--amber,#f5b13c)">2–4</span> / <span style="color:var(--neg,#ff5470)">&gt;4</span></span></h3>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
  v.appendChild(t);
  t.querySelectorAll("th[data-k]").forEach(th => th.onclick = () => { const k = th.dataset.k; ISSUERS.sort = key === k ? { key: k, dir: dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "issuer" || k === "sector" ? "asc" : "desc" }; render(); });
  t.querySelectorAll("tr[data-tk]").forEach(tr => tr.onclick = () => { ISSUERS.detail = tr.dataset.tk; render(); });
}

async function renderIssuerCredit(v, ticker) {
  v.appendChild(el(`<div class="toolbar"><button class="btn ghost" id="ic-back">← К списку эмитентов</button></div>`));
  v.querySelector("#ic-back").onclick = () => { ISSUERS.detail = null; render(); };
  const host = el(`<div><div class="loading">Загружаю отчётность…</div></div>`); v.appendChild(host);
  let d = null;
  try { d = await fetch(`${API}/api/issuers/credit/${encodeURIComponent(ticker)}`).then(x => x.json()); } catch (e) { }
  host.innerHTML = "";
  if (!d || !d.available) { host.appendChild(el(`<div class="alert warn">${d?.detail || "Нет данных"}</div>`)); return; }
  const b = d.base || {}, r = d.ratios || {};
  host.appendChild(el(`<div class="panel"><h3>${d.name} <span class="muted" style="font-weight:400;font-size:12px">· ${d.sector || ""} · отчётность на ${d.as_of || "—"}</span></h3>
    <div class="kpis" style="margin:0">
      <div class="kpi"><div class="label">ND / EBITDA</div><div class="value" style="color:${ndColor(r.nd_ebitda)}">${rnum(r.nd_ebitda)}</div><div class="sub">Долг/EBITDA ${rnum(r.debt_ebitda)}</div></div>
      <div class="kpi"><div class="label">ICR (EBITDA/%)</div><div class="value">${rnum(r.icr_ebitda)}</div><div class="sub">EBIT/% ${rnum(r.icr)}</div></div>
      <div class="kpi"><div class="label">Долг / Капитал</div><div class="value">${rnum(r.debt_equity)}</div><div class="sub">ЧД/Капитал ${rnum(r.nd_equity)}</div></div>
      <div class="kpi"><div class="label">EBITDA маржа</div><div class="value">${rpct(r.ebitda_margin)}</div><div class="sub">чистая ${rpct(r.net_margin)}</div></div>
      <div class="kpi"><div class="label">ROE · ROA</div><div class="value">${rpct(r.roe)}</div><div class="sub">ROA ${rpct(r.roa)}</div></div>
    </div>
    <div class="stat-row" style="margin-top:14px;gap:24px;flex-wrap:wrap">
      <div class="s"><div class="l">Выручка</div><div class="v">${money(b.revenue)}</div></div>
      <div class="s"><div class="l">EBITDA</div><div class="v">${money(b.ebitda)}</div></div>
      <div class="s"><div class="l">Чистый долг</div><div class="v">${money(b.net_debt)}</div></div>
      <div class="s"><div class="l">Общий долг</div><div class="v">${money(b.debt)}</div></div>
      <div class="s"><div class="l">Капитал</div><div class="v">${money(b.equity)}</div></div>
      <div class="s"><div class="l">Проценты (год)</div><div class="v">${money(d.interest_expense)}</div></div>
      <div class="s"><div class="l">FCF</div><div class="v ${b.fcf >= 0 ? "pos" : "neg"}">${money(b.fcf)}</div></div>
    </div></div>`));
  // trends: revenue + EBITDA over FY periods
  const fin = d.financials || {};
  const per = (fin.periods || []).map((p, i) => [p, i]).filter(([p]) => /FY$/.test(p));
  if (per.length >= 2) {
    const rowOf = code => (fin.rows || []).find(x => (x.code || x.metric) === code) || {};
    const vals = code => { const vv = rowOf(code).values || rowOf(code).vals || []; return per.map(([p, i]) => [p.replace("FY", ""), vv[i]]); };
    const chart = el(`<div class="panel"><h3>Динамика: выручка и EBITDA (годовые, ₽)</h3><div class="chart" id="ic-tr" style="height:240px"></div></div>`);
    v.appendChild(chart);
    mkChart(chart.querySelector("#ic-tr"), {
      ...CHART_BG, tooltip: { trigger: "axis", confine: true, valueFormatter: x => money(x) },
      legend: { data: ["Выручка", "EBITDA"], top: 0, textStyle: { color: cssVar("--muted", "#83968f") } },
      grid: { left: 70, right: 20, top: 28, bottom: 30 },
      xAxis: { type: "category", data: vals("revenue").map(x => x[0]), ...AX },
      yAxis: { type: "value", ...AX },
      series: [
        { name: "Выручка", type: "bar", data: vals("revenue").map(x => x[1]), itemStyle: { color: "#35d6e6" } },
        { name: "EBITDA", type: "bar", data: vals("ebitda").map(x => x[1]), itemStyle: { color: "#1fe0a0" } },
      ],
    });
  }
}

function moverBarRows(rows, turnover = false) {
  const valid = (rows || []).filter(row => Number.isFinite(turnover ? (row.volume_today ?? row.volume) : row.change_day_pct));
  const max = Math.max(0,...valid.map(row => Math.abs(turnover ? (row.volume_today ?? row.volume) : row.change_day_pct)));
  return valid.map(row => {
    const value = turnover ? (row.volume_today ?? row.volume) : row.change_day_pct;
    return {row,value,width:max ? Math.abs(value) / max * 100 : 0};
  });
}
const MOVERS = { minMln: 1, section: 'gainers' }; // min turnover filter, млн ₽
async function renderMovers(v) {
  v.appendChild(el(`<div class="panel movers-controls"><h3>Динамика рынка за день</h3>
    <div class="field" style="max-width:260px"><label>Мин. оборот за день, млн ₽</label>
      <input type="number" id="mv-min" value="${MOVERS.minMln}" step="1" min="0" style="width:120px"></div></div>`));
  const minInput = v.querySelector("#mv-min");
  minInput.oninput = debounce(() => { MOVERS.minMln = parseFloat(minInput.value) || 0; render(); }, 400);
  const host = el(`<div><div class="loading"></div></div>`); v.appendChild(host);
  let d = null;
  try { d = await fetch(`${API}/api/movers?limit=25&min_turnover=${(MOVERS.minMln || 0) * 1e6}`).then(x => x.json()); } catch (e) { }
  if (!host.isConnected || TAB !== 'movers') return;
  host.innerHTML = "";
  if (!d) { host.innerHTML = `<div class="muted" style="padding:30px;text-align:center">Нет данных — обнови рынок.</div>`; return; }
  const chgCell = c => `<span class="${c >= 0 ? "pos" : "neg"}">${c > 0 ? "+" : ""}${fmt(c, 2)}%</span>`;
  const turn = v => `${fmt((v || 0) / 1e6, 1)} млн`;
  const rowsTbl = (rows, valCol, valFn) => {
    const body = rows.map(r => `<tr data-isin="${r.isin}">
      <td style="text-align:left"><span class="link">${r.name}</span><div class="isin muted" style="font-size:10px;font-family:var(--mono)">${r.isin}</div></td>
      <td>${ratingPill(r)}</td>
      <td>${r.kind === "floater" ? `<b>${pct(r.current_yield)}</b><div class="muted" style="font-size:9px">тек.дох.</div>`
        : (r.ytm != null && (r.ytm > 60 || r.noncomparable)) ? `<span class="muted" title="Доходность ${pct(r.ytm)} — цена далеко ниже номинала (дефолт/дистресс): как доходность не сопоставима">дистресс</span>` : `<b>${pct(r.ytm)}</b>`}</td>
      <td>${turn(r.volume_today ?? r.volume)}</td>
      <td>${valFn(r)}</td></tr>`).join("");
    const t = el(`<div class="tbl-wrap panel" style="max-height:560px;overflow-y:auto"><table><thead><tr><th style="text-align:left">Выпуск</th><th>Рейтинг</th><th>Доходность</th><th>Оборот</th><th>${valCol}</th></tr></thead><tbody>${body}</tbody></table></div>`);
    t.querySelectorAll("tr[data-isin]").forEach(tr => tr.onclick = () => openIssue(tr.dataset.isin));
    return t;
  };
  host.appendChild(el(`<div class="muted" style="margin:2px 0 10px">Торговалось сегодня (оборот ≥ ${MOVERS.minMln} млн ₽): <b style="color:var(--text)">${d.traded_count}</b> выпусков</div>`));
  const sections = [['gainers','Рост цены','var(--pos,#15876b)'],['losers','Падение цены','var(--neg,#c34739)'],['turnover','Оборот','var(--acc,#8a6320)']];
  const tabs = el(`<div class="movers-tabs" role="group" aria-label="Показатель динамики">${sections.map(([key,label]) => `<button type="button" data-section="${key}" aria-pressed="${MOVERS.section === key}">${label}</button>`).join('')}</div>`);
  const g = el('<div class="movers-grid"></div>');
  host.append(tabs,g);
  for (const [key,title,color] of sections) {
    const rows = d[key] || [], turnover = key === 'turnover';
    const p = el(`<section class="panel mover-panel ${MOVERS.section === key ? 'is-active' : ''}" data-section-panel="${key}"><div class="mover-heading"><h3>${title}</h3><span>${turnover ? 'млн ₽ за день' : 'изменение за день, %'}</span></div><div class="mover-bars" role="group" aria-label="${title}"></div><button type="button" class="mover-expand"></button><details class="mover-table"><summary>Таблица · ${rows.length} выпусков</summary></details></section>`);
    g.append(p);
    let expanded = false;
    const drawBars = () => {
      const all = moverBarRows(rows,turnover), visible = expanded ? all : all.slice(0,8);
      const bars = p.querySelector('.mover-bars');
      bars.replaceChildren();
      for (const {row,value,width} of visible) {
        const label = turnover ? fmt(value / 1e6,1) : (value > 0 ? '+' : '') + fmt(value,2) + '%';
        const bar = el(`<button type="button" class="mover-bar" style="--mover-color:${color};--mover-width:${width}%" aria-label="${escA(row.name || row.isin)}: ${escA(label)}${turnover ? ' млн рублей за день' : ' за день'}" title="${escA(row.name || '')} · ${escA(row.isin)}"><span class="mover-bar-name">${escA(row.name || row.isin)}</span><span class="mover-bar-track" aria-hidden="true"><i></i></span><strong>${escA(label)}</strong></button>`);
        bar.onclick = () => openIssue(row.isin); bars.append(bar);
      }
      if (!all.length) bars.innerHTML = '<p class="muted">Нет выпусков по заданному обороту</p>';
      const button = p.querySelector('.mover-expand');
      button.hidden = all.length <= 8;
      button.textContent = expanded ? 'Свернуть до 8' : `Показать все ${all.length}`;
      button.setAttribute('aria-expanded',String(expanded));
    };
    p.querySelector('.mover-expand').onclick = () => { expanded = !expanded; drawBars(); };
    // Полные исходные строки доступны, в том числе без значения для столбца.
    const details = p.querySelector('.mover-table');
    details.addEventListener('toggle',() => {
      if (details.open && !details.querySelector('table')) details.append(rowsTbl(rows,turnover ? 'Оборот за день' : 'Δ цены',r => turnover ? turn(r.volume_today ?? r.volume) : chgCell(r.change_day_pct)));
    });
    drawBars();
  }
  tabs.querySelectorAll('[data-section]').forEach(button => button.onclick = () => {
    MOVERS.section = button.dataset.section;
    tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed',String(b === button)));
    g.querySelectorAll('[data-section-panel]').forEach(p => p.classList.toggle('is-active',p.dataset.sectionPanel === MOVERS.section));
  });

}

// ---------- Идеи (relative-value anomalies) ----------
const IDEAS = { data: null, dataMin: null, kind: "all", ccy: "RUB", rating: new Set(), minMln: 1, sortField: "deviation_bp", sortDesc: true };
const RATING_ORDER = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"];
async function renderIdeas(v) {
  const host = el(`<div><div class="loading"></div></div>`);
  if (!IDEAS.data || IDEAS.dataMin !== IDEAS.minMln) {
    try { IDEAS.data = await fetch(`${API}/api/ideas?limit=150&min_turnover=${(IDEAS.minMln || 0) * 1e6}`).then(x => x.json()); IDEAS.dataMin = IDEAS.minMln; } catch (e) { }
  }
  const d = IDEAS.data;
  const ccys = (d && d.currencies && d.currencies.length) ? d.currencies : ["RUB"];
  if (!ccys.includes(IDEAS.ccy)) IDEAS.ccy = ccys[0];
  v.appendChild(el(`<div class="panel"><h3>Идеи — относительная стоимость</h3>
    <div class="field"><label>Тип</label><div class="chips" id="id-kind">
      ${[["all", "Все"], ["fixed", "Фиксы"], ["floater", "Флоатеры"]].map(([k, l]) => `<span class="chip ${IDEAS.kind === k ? "on" : ""}" data-k="${k}">${l}</span>`).join("")}</div></div>
    <div class="field" style="margin-top:10px"><label>Валюта</label><div class="chips" id="id-ccy">
      ${ccys.map(c => `<span class="chip ${IDEAS.ccy === c ? "on" : ""}" data-c="${c}">${c}</span>`).join("")}</div></div>
    <div class="field" style="margin-top:10px"><label>Рейтинг</label><div class="chips" id="id-rt">
      ${RATING_ORDER.map(b => `<span class="chip ${IDEAS.rating.has(b) ? "on" : ""}" data-rt="${b}">${b}</span>`).join("")}</div></div>
    <div class="field" style="margin-top:10px;max-width:240px"><label title="Средний дневной оборот за ~21 торговую сессию">Мин. ср. оборот/день, млн ₽</label>
      <input type="number" id="id-min" value="${IDEAS.minMln}" step="1" min="0" style="width:120px"></div>
    </div>`));
  v.querySelectorAll("#id-kind .chip").forEach(c => c.onclick = () => { IDEAS.kind = c.dataset.k; render(); });
  v.querySelectorAll("#id-ccy .chip").forEach(c => c.onclick = () => { IDEAS.ccy = c.dataset.c; render(); });
  v.querySelectorAll("#id-rt .chip").forEach(c => c.onclick = () => { toggle(IDEAS.rating, c.dataset.rt); render(); });
  v.querySelector("#id-min").oninput = debounce(e => { IDEAS.minMln = parseFloat(e.target.value) || 0; render(); }, 450);
  v.appendChild(host);
  host.innerHTML = "";
  if (!d) { host.innerHTML = `<div class="muted" style="padding:30px;text-align:center">Нет данных — обнови рынок.</div>`; return; }
  if (window.BondsMobile?.isPhone() && TAB === 'ideas') return window.BondsMobile.ideas(host,d);
  const flt = arr => {
    const a = (arr || []).filter(r => (IDEAS.kind === "all" || r.kind === IDEAS.kind)
      && (r.currency || "RUB") === IDEAS.ccy
      && (!IDEAS.rating.size || IDEAS.rating.has(r.rating_bucket)));
    const f = IDEAS.sortField;
    // по значению со знаком (раньше по модулю: отрицательный спред вставал выше положительного); пустые — вниз
    a.sort((x, y) => { const dx = x[f], dy = y[f]; if (dx == null) return 1; if (dy == null) return -1; return IDEAS.sortDesc ? dy - dx : dx - dy; });
    return a;
  };
  const arrow = fld => IDEAS.sortField === fld ? (IDEAS.sortDesc ? " ▼" : " ▲") : "";
  const MET = { SM: "SM", G: "G-спред", Y: "YTM" };
  const metricCell = r => `<td class="${spreadCls(r.metric_bp)}">${bp(r.metric_bp)}<div class="muted" style="font-size:9px">${MET[r.metric_kind] || "G"}</div></td>`;
  const row = (r, medKey) => `<tr data-isin="${r.isin}">
    <td style="text-align:left"><span class="link">${r.name}</span><div class="muted" style="font-size:10px">${r.issuer || ""}</div></td>
    <td>${ratingPill(r)}</td>${metricCell(r)}
    <td class="muted">${bp(r[medKey])}</td>
    <td class="${r.deviation_bp >= 0 ? "pos" : "neg"}"><b>${r.deviation_bp > 0 ? "+" : ""}${fmt(r.deviation_bp, 0)}</b></td></tr>`;
  const mkTbl = (title, arr, medKey, medLabel, devLabel) => {
    const t = el(`<div><h3 style="margin:0 0 8px">${title} (${arr.length})</h3>
      <div class="tbl-wrap panel" style="max-height:560px;overflow-y:auto"><table><thead><tr>
        <th style="text-align:left">Выпуск</th><th>Рейт.</th>
        <th class="id-sort" data-f="metric_bp" style="cursor:pointer">Спред${arrow("metric_bp")}</th>
        <th class="id-sort" data-f="${medKey}" style="cursor:pointer">${medLabel}${arrow(medKey)}</th>
        <th class="id-sort" data-f="deviation_bp" style="cursor:pointer">${devLabel}${arrow("deviation_bp")}</th>
      </tr></thead><tbody>${arr.map(r => row(r, medKey)).join("") || `<tr><td colspan=5 class=muted style="padding:16px">нет</td></tr>`}</tbody></table></div></div>`);
    t.querySelectorAll("th.id-sort").forEach(th => th.onclick = () => {
      const f = th.dataset.f;
      if (IDEAS.sortField === f) IDEAS.sortDesc = !IDEAS.sortDesc; else { IDEAS.sortField = f; IDEAS.sortDesc = true; }
      render();
    });
    t.querySelectorAll("tr[data-isin]").forEach(tr => tr.onclick = () => openIssue(tr.dataset.isin));
    return t;
  };
  // Спред относительно СВОЕЙ истории: максимум (дёшево) и минимум (дорого)
  const idFilt = arr => (arr || []).filter(r => (IDEAS.kind === "all" || r.kind === IDEAS.kind)
    && (r.currency || "RUB") === IDEAS.ccy && (!IDEAS.rating.size || IDEAS.rating.has(r.rating_bucket)));
  const pctlCard = (list, color, title, desc, hi) => {
    const body = list.length ? list.map(r => `<tr data-isin="${r.isin}"><td style="text-align:left"><span class="link">${r.name}</span><div class="muted" style="font-size:10px">${r.issuer || ""}</div></td><td>${ratingPill(r)}</td><td class="${spreadCls(r.metric_bp)}">${bp(r.metric_bp)}<div class="muted" style="font-size:9px">${MET[r.metric_kind] || "G"}</div></td><td><b style="color:${hi ? (r.spread_pctl >= 85 ? "var(--pos,#2fe08a)" : "var(--text)") : (r.spread_pctl <= 15 ? "var(--neg,#ff6b6b)" : "var(--text)")}">${r.spread_pctl}</b></td></tr>`).join("") : `<tr><td colspan="4" class="muted" style="padding:14px">нет</td></tr>`;
    const node = el(`<div><div style="border-left:3px solid ${color};padding-left:10px;margin:0 0 8px"><b style="color:${color}">${title}</b> <span class="muted" style="font-size:11.5px">${desc}</span></div>
      <div class="tbl-wrap panel" style="max-height:440px;overflow-y:auto"><table><thead><tr><th style="text-align:left">Выпуск</th><th>Рейт.</th><th>Спред</th><th>Перц.</th></tr></thead><tbody>${body}</tbody></table></div></div>`);
    node.querySelectorAll("tr[data-isin]").forEach(tr => tr.onclick = () => openIssue(tr.dataset.isin));
    return node;
  };
  const hp = idFilt(d.high_pctl), lp = idFilt(d.low_pctl);
  if (hp.length || lp.length) {
    const gPctl = el(`<div class="grid2" style="margin-bottom:20px"></div>`);
    gPctl.append(
      pctlCard(hp, "#f5b13c", "Спред у исторического максимума", "перцентиль ≥ 80 — премия шире обычной, дёшево, докупка под сужение", true),
      pctlCard(lp, "var(--neg,#ff6b6b)", "Спред у исторического минимума", "перцентиль ≤ 20 — премия узкая, дорого, продажа под расширение", false),
    );
    host.appendChild(gPctl);
  }
  // Rows grouped by comparison BASIS. In each row: LEFT = дёшево (шире, купить),
  // RIGHT = дорого (уже, продать) — единообразно «слева дёшево, справа дорого».
  host.appendChild(el(`<div style="padding-left:10px;margin:4px 0 10px;border-left:3px solid var(--muted)"><b>Внутри эмитента</b> <span class="muted" style="font-size:12px">· <span style="color:var(--acc)">слева дёшево (купить)</span> · <span style="color:var(--red)">справа дорого (продать)</span></span></div>`));
  const gIss = el(`<div class="grid2"></div>`);
  gIss.append(
    mkTbl("Дёшево внутри эмитента", flt(d.intra_cheap), "issuer_median_bp", "медиана эм.", "откл, бп"),
    mkTbl("Дорого внутри эмитента", flt(d.intra_rich), "issuer_median_bp", "медиана эм.", "откл, бп"),
  );
  host.appendChild(gIss);
  host.appendChild(el(`<div style="padding-left:10px;margin:20px 0 10px;border-left:3px solid var(--muted)"><b>К рейтинговой группе</b> <span class="muted" style="font-size:12px">· <span style="color:var(--acc)">слева дёшево (купить)</span> · <span style="color:var(--red)">справа дорого (продать)</span></span></div>`));
  const gBkt = el(`<div class="grid2"></div>`);
  gBkt.append(
    mkTbl("Дёшево к рейтинговой группе", flt(d.vs_cheap), "bucket_median_bp", "медиана группы", "шире, бп"),
    mkTbl("Дорого к рейтинговой группе", flt(d.vs_rich), "bucket_median_bp", "медиана группы", "уже, бп"),
  );
  host.appendChild(gBkt);
}

// ---------- Песочница (bond set + CBR rate path → floater scenario YTM) ----------
const SANDBOX = { bonds: [], ratePath: null, start: null, anchors: null, showMeetings: false, metric: "yield", sort: null, expandSet: false };
// In the sandbox every bond has a full projected cash flow, so a floater behaves
// like a fixed bond: it gets a scenario YTM and, from it, a G-spread and a
// spread-to-OFZ. No simple margin here (that's for the "real" floater view).
const SB_METRICS = [["yield", "Доходность"], ["gspread", "G-спред"], ["ofz", "к ОФЗ"]];
const sbMetricOf = (b, m) => {
  if (b.kind === "floater") return { yield: b.scenario_ytm, gspread: b.scenario_gspread, ofz: b.scenario_ofz }[m] ?? null;
  return metricOf(b, m);
};
// Interpolate the per-meeting rate path from the year-end anchor points, so the
// user steers three numbers and the whole trajectory follows.
function sbInterp() {
  if (!SANDBOX.ratePath || !SANDBOX.ratePath.length) return;
  const A = [
    [Date.parse(SANDBOX.ratePath[0].date), SANDBOX.start],
    [Date.parse(`${ANCH_Y0}-12-31`), SANDBOX.anchors.y26],
    [Date.parse(`${ANCH_Y0 + 1}-12-31`), SANDBOX.anchors.y27],
    [Date.parse(`${ANCH_Y0 + 2}-12-31`), SANDBOX.anchors.y28],
  ];
  SANDBOX.ratePath = SANDBOX.ratePath.map(p => {
    const t = Date.parse(p.date); let r = A[A.length - 1][1];
    if (t <= A[0][0]) r = A[0][1];
    else for (let i = 0; i < A.length - 1; i++) {
      if (t >= A[i][0] && t <= A[i + 1][0]) { const f = (t - A[i][0]) / (A[i + 1][0] - A[i][0]); r = A[i][1] + f * (A[i + 1][1] - A[i][1]); break; }
    }
    return { ...p, rate: Math.max(0, +r.toFixed(2)) };
  });
}
function applySandboxForecast() {
  const draft = SANDBOX.phoneDraft;
  if (!draft) return;
  if (draft.anchors && Object.keys(draft.anchors).length) {
    if (draft.anchors?.start != null) SANDBOX.start = draft.anchors.start;
    for (const k of ['y26','y27','y28']) if (draft.anchors?.[k] != null) SANDBOX.anchors[k] = draft.anchors[k];
    sbInterp();
  }
  if (draft.rates) SANDBOX.ratePath = SANDBOX.ratePath.map((p,i) => ({...p,rate:draft.rates[i] ?? p.rate}));
  SANDBOX.phoneDraft = null;
  render();
}
function sbMapSeries(pts, phone = false) {
  return {
    type: "scatter", symbolSize: 15, data: pts,
    label: {
      show: true, position: "top", distance: 5,
      fontSize: phone ? 9 : 10, fontWeight: 400, color: AXIS_TXT,
      width: phone ? 88 : 125, overflow: "truncate",
      formatter: p => p.data.name || p.data.isin || "",
    },
    // Names stay above points; no side-column placement.
    labelLayout: { moveOverlap: "shiftY", hideOverlap: false },
    labelLine: { show: true, lineStyle: { color: AXIS_LINE, width: .7 } },
    emphasis: { label: { show: true, fontWeight: 600, overflow: "none" } },
  };
}

async function renderSandbox(v) {
  if (!SANDBOX.ratePath) {
    try { const m = await fetch(`${API}/api/cbr_meetings`).then(x => x.json()); SANDBOX.ratePath = m.path || []; } catch (e) { SANDBOX.ratePath = []; }
    const c0 = SANDBOX.ratePath.length ? SANDBOX.ratePath[0].rate : 16;
    SANDBOX.start = c0; SANDBOX.anchors = { y26: BASE_ANCHORS.y26, y27: BASE_ANCHORS.y27, y28: BASE_ANCHORS.y28 };
    sbInterp();
  }
  const cur0 = SANDBOX.start;

  // ---- rate forecast: 3 year-end anchors drive the trajectory ----
  const rp = el(`<div class="panel"><h3>Прогноз ключевой ставки ЦБ</h3>
    <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;margin-bottom:6px">
      ${ANCH_LBL.map(([k, l]) => `
        <div style="display:flex;flex-direction:column;gap:4px"><label class="muted" style="font-size:11px">${l}</label>
        <input type="number" min="0" step="0.25" inputmode="decimal" id="sb-anchor-${k}" data-anchor="${k}" value="${SANDBOX.phoneDraft?.anchors?.[k] ?? (k === "start" ? cur0 : SANDBOX.anchors[k])}" style="width:98px;font-size:15px"></div>`).join("")}
      <span class="muted" style="font-size:11px;padding-bottom:6px">задай ставку на конец года — траектория подстроится</span>
    </div>
    ${window.BondsMobile?.isPhone() ? `<button type="button" class="btn sb-apply" ${SANDBOX.phoneDraft ? '' : 'disabled'}>${SANDBOX.phoneDraft ? 'Применить прогноз' : 'Прогноз применён'}</button><p class="sb-apply-note">Ставки в % годовых. После ввода нажмите «Применить прогноз».</p>` : ''}
    <div class="chart" id="sb-rate-chart" style="height:200px"></div>
    <div style="margin-top:10px"><span class="chip" id="sb-toggle-meet">${SANDBOX.showMeetings ? "▾" : "▸"} по заседаниям</span></div>
    <div id="sb-meet" style="display:${SANDBOX.showMeetings ? "block" : "none"};margin-top:10px">
      <div class="chips" id="sb-preset" style="margin-bottom:10px">
        ${[["flat", "без изменений"], ["-0.25", "−0.25 / заседание"], ["-0.5", "−0.5 / заседание"], ["+0.25", "+0.25 / заседание"], ["+0.5", "+0.5 / заседание"]].map(([k, l]) => `<span class="chip" data-p="${k}">${l}</span>`).join("")}
      </div>
      <div id="sb-rates" style="display:flex;flex-wrap:wrap;gap:8px;max-height:160px;overflow-y:auto"></div>
    </div></div>`);
  v.appendChild(rp);
  const phoneDraft = (inp,mode,key) => {
    const value = Number(inp.value);
    if (!inp.value.trim() || !Number.isFinite(value) || value < 0) {
      inp.setAttribute('aria-invalid','true');
      if (!inp.parentElement.querySelector('.sb-input-error')) inp.after(el('<small class="sb-input-error" role="alert">Введите ставку от 0%</small>'));
      const apply = rp.querySelector('.sb-apply'); if (apply) apply.disabled = true;
      return;
    }
    inp.removeAttribute('aria-invalid');
    inp.parentElement.querySelector('.sb-input-error')?.remove();
    SANDBOX.phoneDraft ||= {}; SANDBOX.phoneDraft.mode = mode;
    const group = mode === 'anchors' ? 'anchors' : 'rates';
    SANDBOX.phoneDraft[group] ||= {}; SANDBOX.phoneDraft[group][key] = value;
    const apply = rp.querySelector('.sb-apply'); if (apply) { apply.disabled = !!rp.querySelector('[aria-invalid=true]'); apply.textContent = 'Применить прогноз'; }
  };
  rp.querySelector('.sb-apply')?.addEventListener('click', () => {
    if ([...rp.querySelectorAll('input')].some(n => n.getAttribute('aria-invalid') === 'true')) return;
    applySandboxForecast();
  });
  rp.querySelectorAll("input[data-anchor]").forEach(inp => inp.oninput = window.BondsMobile?.isPhone() ? () => phoneDraft(inp,'anchors',inp.dataset.anchor) : debounce(e => {
    const k = e.target.dataset.anchor, val = parseFloat(e.target.value);
    if (isNaN(val)) return;
    if (k === "start") SANDBOX.start = val; else SANDBOX.anchors[k] = val;
    sbInterp(); render();
  }, 400));
  rp.querySelector("#sb-toggle-meet").onclick = () => { SANDBOX.showMeetings = !SANDBOX.showMeetings; render(); };
  // presets step each successive meeting (fine-tune inside the expander)
  rp.querySelectorAll("#sb-preset .chip").forEach(c => c.onclick = () => {
    SANDBOX.phoneDraft = null;
    const p = c.dataset.p, step = p === "flat" ? 0 : parseFloat(p);
    SANDBOX.ratePath = SANDBOX.ratePath.map((x, i) => ({ ...x, rate: Math.max(0, +(cur0 + step * i).toFixed(2)) }));
    render();
  });
  const ratesBox = rp.querySelector("#sb-rates");
  SANDBOX.ratePath.forEach((p, i) => {
    const cell = el(`<div style="display:flex;flex-direction:column;gap:2px"><label class="muted" style="font-size:10px">${p.label || (p.date || "").slice(2)}</label>
      <input type="number" min="0" step="0.25" inputmode="decimal" id="sb-meeting-${i}" value="${SANDBOX.phoneDraft?.rates?.[i] ?? p.rate}" style="width:70px" data-i="${i}"></div>`);
    cell.querySelector("input").oninput = window.BondsMobile?.isPhone() ? e => phoneDraft(e.target,'meetings',i) : debounce(e => { const rate = parseFloat(e.target.value); if (Number.isFinite(rate) && rate >= 0) { SANDBOX.ratePath[i].rate = rate; render(); } }, 500);
    ratesBox.appendChild(cell);
  });
  mkChart(rp.querySelector("#sb-rate-chart"), {
    ...CHART_BG,
    tooltip: { trigger: "axis", valueFormatter: v => pct(v) },
    grid: { left: 44, right: 16, top: 12, bottom: 24 },
    xAxis: { type: "time", ...AX },
    yAxis: { type: "value", name: "ставка ЦБ, %", scale: true, ...AX },
    series: [{ type: "line", step: "end", symbol: "none", data: SANDBOX.ratePath.map(p => [p.date, p.rate]), lineStyle: { width: 2.5, color: "#8b7bff" }, areaStyle: { color: "rgba(139,123,255,.12)" } }],
  });

  // ---- bond set: screener-style rows ----
  const add = el(`<div class="panel"><h3>Бумаги в наборе (${SANDBOX.bonds.length})</h3>
    <div class="sb-add-grid">
      <div class="field"><label>Добавить эмитента</label>
        <div class="ac-wrap"><input type="text" id="sb-issuer-search" placeholder="Название эмитента — добавятся все выпуски" style="width:100%"></div></div>
      <div class="field"><label>Добавить отдельный выпуск</label>
        <div class="ac-wrap"><input type="text" id="sb-search" placeholder="Название или ISIN — начни вводить…" style="width:100%"></div></div>
    </div>
    <div id="sb-issuers"></div>
    <div id="sb-set"></div></div>`);
  v.appendChild(add);
  const addIssuer = async pick => {
    if (!pick.key) return;
    try {
      const d = await fetch(`${API}/api/issuer?q=${encodeURIComponent(pick.key)}`).then(x => x.ok ? x.json() : null);
      (d?.bonds || []).forEach(b => { if (b.isin && !SANDBOX.bonds.includes(b.isin)) SANDBOX.bonds.push(b.isin); });
      render();
    } catch (e) { }
  };
  attachAutocomplete(add.querySelector("#sb-issuer-search"), addIssuer, { issuersOnly: true, issuerAction: "add" });
  attachAutocomplete(add.querySelector("#sb-search"), pick => {
    if (pick.isin && !SANDBOX.bonds.includes(pick.isin)) { SANDBOX.bonds.push(pick.isin); render(); }
  }, { bondsOnly: true });
  const issuerHost = add.querySelector("#sb-issuers");
  const setHost = add.querySelector("#sb-set");
  if (!SANDBOX.bonds.length) {
    issuerHost.innerHTML = `<div class="sb-issuer-empty">Эмитенты пока не выбраны</div>`;
    setHost.innerHTML = `<div class="muted" style="padding:6px 2px;font-size:13px">Добавьте эмитента или отдельный выпуск — по набору построятся карта рынка и сценарный YTM флоатеров под ваш прогноз ставки.</div>`;
    return;
  }

  // fetch rows: fix → ytm, floater → scenario ytm from the projected cash flow.
  // КЭШ: статические данные бумаги (/one) не меняются между правками прогноза — тянем
  // раз; сценарий флоатера кэшируем по (isin + траектория ставки), поэтому сортировка,
  // добавление фикса, тоггл «по заседаниям» НЕ пересчитывают ничего — мгновенно. Пересчёт
  // только когда реально изменилась траектория ставки, и только у флоатеров.
  SANDBOX._one = SANDBOX._one || {};
  SANDBOX._sc = SANDBOX._sc || {};
  const pathKey = JSON.stringify(SANDBOX.ratePath);
  setHost.innerHTML = `<div class="loading" style="margin-top:12px">Считаю сценарий…</div>`;
  const rows = await Promise.all(SANDBOX.bonds.map(async isin => {
    let b = SANDBOX._one[isin];
    if (!b) { b = await fetch(`${API}/api/universe/one?isin=${isin}`).then(x => x.ok ? x.json() : null).catch(() => null); if (b) SANDBOX._one[isin] = b; }
    if (!b) return null;
    if (b.kind === "floater" && b.price != null) {
      const ck = isin + "|" + b.price + "|" + (b.settledate || "") + "|" + pathKey;
      let sc = SANDBOX._sc[ck];
      if (sc === undefined) {
        sc = await fetch(`${API}/api/model/floater_scenario`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isin, price: b.price, rate_path: SANDBOX.ratePath }) }).then(x => x.json()).catch(() => null);
        SANDBOX._sc[ck] = sc;
      }
      b.scenario_ytm = sc && sc.ytm != null ? sc.ytm : null;
      b.scenario_duration = sc && sc.duration != null ? sc.duration : null;
      b.scenario_gspread = sc && sc.gspread != null ? sc.gspread : null;
      b.scenario_ofz = sc && sc.ofz != null ? sc.ofz : null;
    }
    return b;
  }));
  const bonds = rows.filter(Boolean);
  const yOf = b => b.kind === "floater" ? b.scenario_ytm : b.ytm;
  const durOf = b => b.kind === "floater" ? b.scenario_duration : b.duration_years;

  // Selected issuers are a first-class control: show exactly which companies are
  // represented, how many of their bonds are in the set, and remove a company at once.
  const issuerGroups = [];
  const issuerByKey = new Map();
  bonds.forEach(b => {
    const name = b.issuer || b.issuer_full || "Без эмитента";
    const key = b.issuer_key || name;
    let g = issuerByKey.get(key);
    if (!g) { g = { key, name, isins: [] }; issuerByKey.set(key, g); issuerGroups.push(g); }
    g.isins.push(b.isin);
  });
  issuerGroups.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const issueWord = n => n % 10 === 1 && n % 100 !== 11 ? "выпуск" : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "выпуска" : "выпусков");
  issuerHost.innerHTML = `<div class="sb-issuer-box">
    <div class="sb-issuer-head"><span>Эмитенты в наборе</span><b>${issuerGroups.length}</b><span class="muted">Нажмите ×, чтобы убрать все бумаги эмитента</span></div>
    <div class="sb-issuer-chips">${issuerGroups.map((g, i) => `<button type="button" class="sb-issuer-chip" data-issuer-i="${i}" title="Убрать ${escA(g.name)} и все его бумаги из набора"><span>${escA(g.name)}</span><small>${g.isins.length} ${issueWord(g.isins.length)}</small><b aria-hidden="true">×</b></button>`).join("")}</div>
  </div>`;
  issuerHost.querySelectorAll("[data-issuer-i]").forEach(btn => btn.onclick = () => {
    const g = issuerGroups[+btn.dataset.issuerI];
    if (!g) return;
    const drop = new Set(g.isins);
    SANDBOX.bonds = SANDBOX.bonds.filter(isin => !drop.has(isin));
    render();
  });

  // sortable columns + collapse to first 3 (rest under a toggle)
  const valOf = (b, k) => ({
    name: b.name || "", sector: b.sector || "", rating: b.rating_score ?? -1, kind: b.kind || "",
    price: b.price ?? -1, ytm: yOf(b) ?? -1e9, dur: durOf(b) ?? -1,
    spread: (b.kind === "floater" ? b.scenario_gspread : b.g_spread_bp) ?? -1e9, matdate: b.matdate || "",
  }[k]);
  let sorted = bonds.slice();
  if (SANDBOX.sort) {
    const { key, dir } = SANDBOX.sort;
    sorted.sort((a, b) => { const va = valOf(a, key), vb = valOf(b, key); const c = typeof va === "string" ? va.localeCompare(vb, "ru") : va - vb; return dir === "asc" ? c : -c; });
  }
  const shown = SANDBOX.expandSet ? sorted : sorted.slice(0, 3);
  const cols = [["name", "Выпуск", "left"], ["sector", "Сектор", "left"], ["rating", "Рейтинг"], ["kind", "Тип"], ["price", "Цена"], ["ytm", "YTM"], ["dur", "Дюр."], ["spread", "G-спред"], ["matdate", "Погашение"]];
  const arrow = k => SANDBOX.sort && SANDBOX.sort.key === k ? (SANDBOX.sort.dir === "asc" ? " ▲" : " ▼") : "";
  const head = cols.map(([k, l, al]) => `<th data-sort="${k}" style="cursor:pointer;text-align:${al || "center"}">${l}${arrow(k)}</th>`).join("") + "<th></th>";
  const body = shown.map(b => `<tr data-isin="${b.isin}"><td style="text-align:left"><span class="link">${b.name}</span></td>
    <td style="text-align:left">${b.sector || "—"}</td>
    <td>${ratingPill(b)}</td>
    <td><span class="badge ${b.kind}">${KIND_RU[b.kind] || "—"}</span></td>
    <td>${pct(b.price, 2)}</td>
    <td><b>${pct(yOf(b))}</b>${yieldBasisBadge(b)}${b.kind === "floater" ? '<div class="muted" style="font-size:9px">сценарий</div>' : ""}</td>
    <td>${fmt(durOf(b), 2)}</td>
    <td class="${spreadCls(b.kind === "floater" ? b.scenario_gspread : b.g_spread_bp)}">${bp(b.kind === "floater" ? b.scenario_gspread : b.g_spread_bp)}</td>
    <td>${dmy(b.matdate)}</td>
    <td><span class="rm" data-x="${b.isin}" title="убрать" style="cursor:pointer;color:var(--neg);font-weight:700">✕</span></td></tr>`).join("");
  const more = bonds.length > 3
    ? `<div id="sb-more" style="cursor:pointer;text-align:center;padding:8px;margin-top:2px;color:var(--acc);font-size:13px">${SANDBOX.expandSet ? "▲ свернуть" : `▼ показать ещё ${bonds.length - 3}`}</div>`
    : "";
  setHost.innerHTML = `<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${more}`;
  setHost.querySelectorAll("th[data-sort]").forEach(th => th.onclick = () => {
    const k = th.dataset.sort, cur = SANDBOX.sort;
    SANDBOX.sort = cur && cur.key === k ? { key: k, dir: cur.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "desc" };
    render();
  });
  setHost.querySelector("#sb-more") && (setHost.querySelector("#sb-more").onclick = () => { SANDBOX.expandSet = !SANDBOX.expandSet; render(); });
  setHost.querySelectorAll("[data-x]").forEach(x => x.onclick = e => { e.stopPropagation(); SANDBOX.bonds = SANDBOX.bonds.filter(i => i !== x.dataset.x); render(); });
  setHost.querySelectorAll("tr[data-isin]").forEach(tr => tr.onclick = () => openIssue(tr.dataset.isin));

  // ---- market map of the set (metric selectable: YTM / G-спред / к ОФЗ) ----
  if (!SB_METRICS.some(([k]) => k === SANDBOX.metric)) SANDBOX.metric = "yield";
  const isYield = SANDBOX.metric === "yield";
  const chartPanel = el(`<div class="panel"><h3>Карта набора</h3>
    <div class="chips" id="sb-metric" style="margin-bottom:8px">
      ${SB_METRICS.map(([k, l]) => `<span class="chip ${SANDBOX.metric === k ? "on" : ""}" data-m="${k}">${l}</span>`).join("")}</div>
    <div class="muted" style="font-size:12px;margin:2px 0 10px 2px">
      <span style="color:#1fe0a0;font-size:14px">●</span> фикс &nbsp;·&nbsp; <span style="color:#f5b13c;font-size:14px">●</span> флоатер — сценарный YTM по прогнозу ставки</div>
    <div class="chart tall" id="sb-chart"></div></div>`);
  v.appendChild(chartPanel);
  chartPanel.querySelectorAll("#sb-metric .chip").forEach(c => c.onclick = () => { SANDBOX.metric = c.dataset.m; render(); });
  const mOf = b => sbMetricOf(b, SANDBOX.metric);
  const pts = bonds.filter(b => durOf(b) != null && mOf(b) != null).map(b => ({ value: [durOf(b), mOf(b)], name: b.name, isin: b.isin, kind: b.kind, ytm: b.ytm, yield_limitation: b.yield_limitation, yield_conditional_on_call: b.yield_conditional_on_call, itemStyle: { color: b.kind === "floater" ? "#f5b13c" : "#1fe0a0" } }));
  mkChart(chartPanel.querySelector("#sb-chart"), {
    ...CHART_BG,
    tooltip: { trigger: "item", formatter: p => `<b>${p.data.name}</b><br>дюр ${fmt(p.value[0], 2)}г · ${metricLabel(SANDBOX.metric).split(",")[0]}: <b>${isYield ? pct(p.value[1]) : bp(p.value[1])}</b>${yieldBasisBadge(p.data)}${p.data.kind === "floater" && isYield ? " (сценарий)" : ""}` },
    grid: { left: 64, right: 28, top: 44, bottom: 46 },
    xAxis: { type: "value", name: "Дюрация, лет", nameLocation: "middle", nameGap: 30, min: 0, scale: true, ...AX },
    yAxis: { type: "value", name: metricLabel(SANDBOX.metric), nameLocation: "end", nameGap: 14, nameTextStyle: { align: "right", padding: [0, 8, 0, 0] }, scale: true, ...AX },
    series: [sbMapSeries(pts, !!window.BondsMobile?.isPhone())],
  }).on("click", p => { if (p.data?.isin) openIssue(p.data.isin); });
}

// ---------- Issue card ----------
let ISSUE = null;
function openIssue(isin) { NAV_STACK.push(TAB); ISSUE = { isin, base: null, peerMode: "issuer" }; TAB = "issue"; highlightTab(); render(); }

// ---------- Issuer page (market map of one issuer's own bonds) ----------
const ISSUER = { q: null, data: null, metric: "yield", metricPick: false, kind: "all", kindPick: false, ccy: "RUB",
  sort: "duration_years", desc: false };
function openIssuer(q, view = "bonds") { NAV_STACK.push(TAB); ISSUER.q = q; ISSUER.data = null; ISSUER.ccy = "all";
  ISSUER.kind = "all"; ISSUER.metricPick = ISSUER.kindPick = false; ISSUER.view = view; TAB = "issuer"; highlightTab(); render(); }

// ── аналитика отчётности внутри карточки эмитента ──
// Карточка эмитента и карточка компании в секторе — теперь одна: переключатель «Выпуски и
// рейтинги / Отчётность и кредитный профиль». Компанию в секторе находим по ISIN выпусков:
// отраслевая метка ненадёжна (часть лизинговых компаний помечена как банки, у регионов её нет)
const SEC_CACHE = {};
function sectorData(key) {
  if (SECTOR.data && SECTOR.key === key) return Promise.resolve(SECTOR.data);
  if (!SEC_CACHE[key]) SEC_CACHE[key] = fetch(`${API}/api/sector/${key}`).then(x => x.ok ? x.json() : null).catch(() => null);
  return SEC_CACHE[key];
}
// в каких секторах искать эмитента: по отраслевой метке и по имени
function reportSectors(d) {
  const nm = (d.issuer || "").toLowerCase(), sec = d.sector || "";
  if (/минфин/.test(nm)) return [];
  const out = [];
  if (sec === "Лизинг" || /лизинг/.test(nm)) out.push("leasing");
  if (/девелоп|недвиж/i.test(sec)) out.push("developers");
  if (sec === "Госбумаги и регионы" || /област|край|республик|москва|санкт|город|округ|администрац/.test(nm)) out.push("subfed");
  return out;
}
// компания засчитывается, если эмитенту принадлежит хотя бы половина её выпусков: в субфедах
// два выпуска мэрии Новосибирска лежат внутри «Новосибирской области», и без этого правила
// карточка мэрии показывала бы бюджет области
function findSectorCompany(sd, isins) {
  const set = new Set(isins);
  let best = null, bestShare = 0;
  for (const c of [...(sd.companies || []), ...(sd.others || [])]) {
    const ci = (c.market || {}).isins || [];
    if (!ci.length) continue;
    const share = ci.filter(i => set.has(i)).length / ci.length;
    if (share > bestShare) { best = c; bestShare = share; }
  }
  return bestShare >= 0.5 ? best : null;
}
// клик по компании в секторе открывает карточку эмитента сразу на отчётности
function openCompanyCard(name) {
  const d = SECTOR.data || {};
  const c = [...(d.companies || []), ...(d.others || [])].find(x => x.company === name);
  const isin = c && ((c.market || {}).isins || [])[0];
  if (!isin) { SECTOR.company = name; return render(); }      // у эмитента нет бумаг в обращении — старая карточка
  openIssuer(isin, "report");
}
// ISIN → [сектор, компания]: индекс всех секторов с отчётностью (≈4 КБ, кэш на сервере)
let SEC_INDEX = null;
async function sectorIndex() {
  if (!SEC_INDEX) SEC_INDEX = fetch(`${API}/api/sector_index`).then(x => x.ok ? x.json() : {}).catch(() => ({}));
  return SEC_INDEX;
}
async function renderIssuerReport(host, d, keys) {
  const box = el(`<div><div class="loading">Загружаю отчётность эмитента…</div></div>`); host.appendChild(box);
  const isins = (d.bonds || []).map(b => b.isin);
  for (const key of keys) {
    const sd = await sectorData(key);
    const c = sd && findSectorCompany(sd, isins);
    if (!c) continue;
    box.innerHTML = "";
    if (key === "leasing") await renderLeasingCompany(box, sd, c.company);
    else if (key === "subfed") await renderSubfedRegion(box, sd, c.company);
    else if (key === "utilities" || key === "retail") await renderCorpCompany(box, sd, c.company);
    else await renderSectorCompany(box, sd, c.company);
    // кнопка «← ко всем …» внутри карточки эмитента не нужна: назад ведёт общая кнопка
    const back = box.querySelector("#sc-back"); if (back) (back.closest(".toolbar") || back).remove();
    return;
  }
  box.innerHTML = `<div class="panel"><div class="muted">Отчётность этого эмитента пока не разобрана.</div></div>`;
}

async function renderIssuerPage(v) {
  v.appendChild(el(`<div class="toolbar"><button class="btn ghost" id="ip-back">← Назад</button></div>`));
  v.querySelector("#ip-back").onclick = goBack;
  const host = el(`<div><div class="loading">Загружаю эмитента…</div></div>`); v.appendChild(host);
  if (!ISSUER.data) { try { ISSUER.data = await fetch(`${API}/api/issuer?q=${encodeURIComponent(ISSUER.q)}`).then(x => x.ok ? x.json() : null); } catch (e) { } }
  const d = ISSUER.data;
  host.innerHTML = "";
  if (!d) { host.innerHTML = `<div class="alert error">Эмитент не найден.</div>`; return; }
  const ccys = [...new Set(d.bonds.map(b => b.currency || "RUB"))];
  if (ISSUER.ccy !== "all" && !ccys.includes(ISSUER.ccy)) ISSUER.ccy = ccys[0];
  if (ccys.length === 1) ISSUER.ccy = ccys[0];   // одна валюта — «Все» не нужен
  // тип и метрики считаем по той валюте, которая сейчас выбрана: у Полипласта в рублях есть
  // флоатеры, а все валютные выпуски — фиксы, и доходность к погашению для них считается
  const inCcy = b => ISSUER.ccy === "all" || (b.currency || "RUB") === ISSUER.ccy;
  const pool = d.bonds.filter(inCcy);
  const hasFix = pool.some(b => b.kind !== "floater"), hasFl = pool.some(b => b.kind === "floater");
  // тип бумаг, пока его не выбрали руками, следует за валютой: в USD у эмитента одни фиксы,
  // в рублях снова появляются флоатеры — и они не должны молча пропадать с карты
  if (!hasFix || !hasFl) ISSUER.kind = hasFl && !hasFix ? "floater" : "fixed";   // один тип — выбирать нечего
  else if (!ISSUER.kindPick) ISSUER.kind = "all";
  // валютные выпуски: спред к рублёвой КБД и к ОФЗ у них пустой — метрику не предлагаем
  const fxOnly = pool.length > 0 && pool.every(b => (b.currency || "RUB") !== "RUB");
  // пока метрику не выбрали руками — показываем главную для этого типа бумаг: у фиксов это
  // доходность к погашению, та же, что в колонке таблицы ниже, иначе цифры на карте и в
  // таблице выглядят как расхождение
  if (!ISSUER.metricPick || !metricAvailable(ISSUER.metric, ISSUER.kind, fxOnly))
    ISSUER.metric = defaultMetric(ISSUER.kind);
  const ag = d.agency_ratings && d.agency_ratings.length ? d.agency_ratings : null;
  // в каких секторах есть отчётность эмитента: по индексу ISIN, а по отраслевой метке — только если
  // индекс не ответил (у Электроаппарата в справочнике машиностроение, у НоваБев — АПК)
  const idx = await sectorIndex();
  const fromIdx = [...new Set((d.bonds || []).map(b => (idx[b.isin] || [])[0]).filter(Boolean))];
  const repKeys = Object.keys(idx).length ? fromIdx : reportSectors(d);
  if (!repKeys.length) ISSUER.view = "bonds";
  const viewSw = repKeys.length ? `<div class="chips" id="ip-view" style="margin-top:12px">
      <span class="chip ${ISSUER.view !== "report" ? "on" : ""}" data-v="bonds">Выпуски и рейтинги</span>
      <span class="chip ${ISSUER.view === "report" ? "on" : ""}" data-v="report">Отчётность и кредитный профиль</span></div>` : "";
  const headHTML = `<h3>${d.issuer} <span class="muted" style="font-weight:400;font-size:13px">· ${d.count} выпусков${d.sector ? " · " + d.sector : ""}</span></h3>
    ${ag ? `<div class="muted" style="font-size:12.5px">Рейтинги эмитента: ${ag.map(a => `<b style="color:var(--text)">${agName(a.agency)}</b> ${a.rating}${a.forecast ? " (" + a.forecast.toLowerCase() + ")" : ""}${a.action_date ? " · " + dmy(a.action_date) : ""} ${trendArrow(a.trend)}`).join(" · ")}</div>` : ""}
    ${viewSw}`;
  const bindView = () => host.querySelectorAll("#ip-view [data-v]").forEach(c => c.onclick = () => { ISSUER.view = c.dataset.v; render(); });
  if (ISSUER.view === "report") {
    host.appendChild(el(`<div class="panel">${headHTML}</div>`));
    bindView();
    return renderIssuerReport(host, d, repKeys);
  }
  host.appendChild(el(`<div class="panel">${headHTML}
    <div class="filters" style="margin-top:10px">
      <div class="field"><label>Тип</label><div class="chips" id="ip-kind">
        ${[["all", "Все"], ...(hasFix ? [["fixed", "Фикс"]] : []), ...(hasFl ? [["floater", "Флоатеры"]] : [])].map(([k, l]) => `<span class="chip ${ISSUER.kind === k ? "on" : ""}" data-k="${k}">${l}</span>`).join("")}</div></div>
      <div class="field"><label>Валюта</label><div class="chips" id="ip-ccy">
        ${ccys.length > 1 ? `<span class="chip ${ISSUER.ccy === "all" ? "on" : ""}" data-c="all">Все</span>` : ""}${ccys.map(c => `<span class="chip ${ISSUER.ccy === c ? "on" : ""}" data-c="${c}">${c}</span>`).join("")}</div></div>
      <div class="field full"><label>Ось Y</label><div class="chips" id="ip-metric">
        ${metricColumns(ISSUER.metric, "data-m", ISSUER.kind, fxOnly)}</div></div>
    </div></div>`));
  host.querySelectorAll("#ip-kind .chip").forEach(c => c.onclick = () => {
    ISSUER.kind = c.dataset.k; ISSUER.kindPick = true;
    // метрики фикса и флоатера не пересекаются: при смене типа берём подходящую
    if (!metricAvailable(ISSUER.metric, ISSUER.kind, fxOnly)) ISSUER.metric = defaultMetric(ISSUER.kind);
    render();
  });
  host.querySelectorAll("#ip-ccy .chip").forEach(c => c.onclick = () => { ISSUER.ccy = c.dataset.c; render(); });
  bindView();
  host.querySelectorAll("#ip-metric [data-m]").forEach(c => c.onclick = () => {
    ISSUER.metric = c.dataset.m; ISSUER.metricPick = true; render();
  });

  // тот же график «Рейтинги по датам», что в карточке выпуска — по MOEX emitent_id эмитента
  const eidCnt = {}; (d.bonds || []).forEach(b => { if (b.emitent_id) eidCnt[b.emitent_id] = (eidCnt[b.emitent_id] || 0) + 1; });
  const eid = Object.keys(eidCnt).sort((x, y) => eidCnt[y] - eidCnt[x])[0];
  const rtHost = el(`<div id="ip-rt"></div>`);
  host.appendChild(rtHost);
  if (eid) {
    if (ISSUER.rt && ISSUER.rt.eid === eid) drawRatingTimeline(rtHost, ISSUER.rt.list, "Рейтинги эмитента по датам");
    else fetch(`${API}/api/ratings/emitent/${eid}`).then(x => x.ok ? x.json() : null).then(r => {
      if (!r) return; ISSUER.rt = { eid, list: r.agencies || [] };
      if (document.body.contains(rtHost)) drawRatingTimeline(rtHost, ISSUER.rt.list, "Рейтинги эмитента по датам");
    }).catch(() => {});
  }
  const chart = el(`<div class="panel"><h3>Карта выпусков эмитента</h3><div class="chart tall" id="ip-chart"></div>
    <div class="muted" data-chart-help>Кривая самого эмитента: ось X — дюрация (у флоатеров — срок до погашения/оферты), ось Y — выбранная метрика. Клик — карточка выпуска.</div></div>`);
  host.appendChild(chart);
  const bonds = d.bonds.filter(b => (ISSUER.kind === "all" || b.kind === ISSUER.kind) && (ISSUER.ccy === "all" || (b.currency || "RUB") === ISSUER.ccy));
  const yOf = r => metricOf(r, ISSUER.metric);
  const isY = metricIsPct(ISSUER.metric);
  // ось X: у фиксов — дюрация; у флоатеров классической дюрации нет (купон пересматривается,
  // биржа её почти не считает) → срок до оферты/погашения — как в расчёте SM и DM к ОФЗ
  const tenorOf = b => { const dt = (b.offer_date && (!b.matdate || b.offer_date < b.matdate)) ? b.offer_date : b.matdate;
    if (dt && /^\d{4}-\d{2}-\d{2}$/.test(dt)) { const t = (new Date(dt) - new Date()) / 3.15576e10; if (t > 0) return +t.toFixed(2); } return b.years_to_maturity ?? null; };
  const xOf = b => b.kind === "floater" ? tenorOf(b) : b.duration_years;
  const pts = bonds.filter(b => xOf(b) != null && yOf(b) != null && (!isY || yOf(b) > 0))
    .map(b => ({ value: [xOf(b), yOf(b)], name: b.name, isin: b.isin, kind: b.kind }));
  const yName = metricLabel(ISSUER.metric);
  // разделяем на фикс/флоатер — разный цвет, чтобы в режиме «Все» было понятно, где что
  const ptsFix = pts.filter(p => p.kind !== "floater"), ptsFl = pts.filter(p => p.kind === "floater");
  const bothKinds = ptsFix.length && ptsFl.length;
  const c = mkChart(chart.querySelector("#ip-chart"), {
    ...CHART_BG,
    tooltip: { trigger: "item", formatter: p => `<b>${p.data.name}</b><br>${p.data.kind === "floater" ? "до погашения/оферты" : "дюр"} ${fmt(p.value[0], 2)}г · ${isY ? pct(p.value[1]) : bp(p.value[1])}` },
    legend: bothKinds ? { top: 4, right: 10, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 14, itemHeight: 8, data: ["Фикс", "Флоатеры"] } : undefined,
    grid: { left: 60, right: 24, top: 40, bottom: 46 },
    xAxis: { type: "value", name: ptsFix.length && ptsFl.length ? "Дюрация (фиксы) / срок до погашения или оферты (флоатеры), лет" : ptsFl.length ? "Срок до погашения / оферты, лет" : "Дюрация, лет", nameLocation: "middle", nameGap: 30, min: 0, scale: true, ...AX },
    yAxis: { type: "value", ...AX, name: yName, nameTextStyle: { ...AX.nameTextStyle, align: "right", padding: [0, 8, 0, 0] }, scale: true },
    series: [
      { ...sbMapSeries(ptsFix, !!window.BondsMobile?.isPhone()), name: "Фикс", symbolSize: 14, itemStyle: { color: "#1fe0a0", borderColor: "#0b0f10", borderWidth: 1 } },
      { ...sbMapSeries(ptsFl, !!window.BondsMobile?.isPhone()), name: "Флоатеры", symbolSize: 14, itemStyle: { color: "#8b7bff", borderColor: "#0b0f10", borderWidth: 1 } },
    ],
  });
  c.on("click", p => { if (p.data?.isin) openIssue(p.data.isin); });
  if (bonds.length > pts.length) {
    chart.appendChild(el(`<div class="phone-chart-coverage">На карте ${pts.length} из ${bonds.length} выпусков</div>`));
    const cap = chart.querySelector(".muted");
    if (cap) cap.insertAdjacentHTML("beforeend", ` · на карте ${pts.length} из ${bonds.length} — у остальных нет рыночной доходности`);
  }
  // при смешанном типе бумаг на карте текущая доходность, а в таблице ниже — доходность к
  // погашению: цифры разные по смыслу, и без пояснения это читается как расхождение данных
  if (ISSUER.metric === "cy" && ptsFix.length) {
    const cap = chart.querySelector(".muted");
    if (cap) cap.insertAdjacentHTML("beforeend", ` · здесь текущая доходность (купон к цене) — у флоатеров доходности к погашению нет; в таблице ниже у фиксов доходность к погашению, она выше`);
  }

  // --- График погашения: будущие выплаты номинала по графику Мосбиржи — амортизации на свои даты,
  // погашение = остаток номинала, прошедшие амортизации не считаем, оферта раньше погашения —
  // остаток на дату оферты; бессрочные выпуски — отдельной строкой (даты погашения нет)
  const redHost = el(`<div id="ip-red"></div>`);
  host.appendChild(redHost);
  // График погашений показывает весь долговой профиль эмитента в выбранной валюте.
  // Переключатель «Фикс / Флоатеры» относится только к карте выпусков и таблице:
  // иначе при анализе одного типа купона пропадала часть реальных погашений эмитента.
  const redemptionBonds = d.bonds.filter(inCcy);
  const redKey = redemptionBonds.map(b => b.isin).sort().join(",");
  const drawRed = evs => {
    const showCp = !!ISSUER.redCoupons;               // «+ купоны»: купонные выплаты поверх номинала
    const cpEv = showCp ? evs.filter(e => e.date && e.type === "coupon") : [];
    const onAxis = evs.filter(e => e.date && e.type !== "coupon"), perp = evs.filter(e => !e.date);
    if (!onAxis.length && !perp.length && !cpEv.length) { redHost.innerHTML = ""; return; }
    if (!ISSUER.redGran) ISSUER.redGran = "quarter";
    const rg = ISSUER.redGran;
    const volFmt = x => { const a = Math.abs(x || 0); return a >= 1e9 ? fmt(x / 1e9, a >= 1e10 ? 0 : 1) + " млрд ₽" : a >= 1e6 ? fmt(x / 1e6, 0) + " млн ₽" : fmt(x, 0) + " ₽"; };
    const axFmt = x => { const a = Math.abs(x || 0); return a >= 1e9 ? fmt(x / 1e9, a >= 1e10 ? 0 : 1) + " млрд" : a >= 1e6 ? fmt(x / 1e6, 0) + " млн" : fmt(x, 0); };
    const pkey = ds => { const [y, m] = ds.split("-"); if (rg === "year") return y; if (rg === "quarter") return `${y}-Q${Math.floor((+m - 1) / 3) + 1}`; return `${y}-${m}`; };
    const plabel = k => { if (rg === "year") return k; if (rg === "quarter") { const [y, q] = k.split("-Q"); return `${q}кв ${y}`; } const [y, m] = k.split("-"); return `${m}.${y}`; };
    const buckets = {};
    const bk0 = () => ({ fix: 0, fl: 0, am: 0, cp: 0, cpp: 0, items: [], cps: {} });
    onAxis.forEach(e => { const k = pkey(e.date);
      const b = (buckets[k] = buckets[k] || bk0());
      if (e.type === "amort") b.am += e.amount; else if (e.kind === "floater") b.fl += e.amount; else b.fix += e.amount;
      b.items.push(e);
    });
    // купоны: известные (фикс, зафиксированный купон флоатера) и прогноз по флоатерам — отдельно
    cpEv.forEach(e => { const k = pkey(e.date);
      const b = (buckets[k] = buckets[k] || bk0());
      if (e.projected) b.cpp += e.amount; else b.cp += e.amount;
      const c = (b.cps[e.name] = b.cps[e.name] || { amount: 0, projected: false });
      c.amount += e.amount; c.projected = c.projected || !!e.projected;
    });
    const dts = [...onAxis, ...cpEv].map(e => e.date).sort();
    const keys = [];
    if (dts.length) {
      const [fy, fm] = dts[0].split("-").map(Number), [ly, lm] = dts[dts.length - 1].split("-").map(Number);
      if (rg === "year") { for (let y = fy; y <= ly; y++) keys.push(String(y)); }
      else if (rg === "quarter") { let y = fy, q = Math.floor((fm - 1) / 3) + 1; const lq = Math.floor((lm - 1) / 3) + 1; while (y < ly || (y === ly && q <= lq)) { keys.push(`${y}-Q${q}`); if (++q > 4) { q = 1; y++; } } }
      else { let y = fy, mo = fm; while (y < ly || (y === ly && mo <= lm)) { keys.push(`${y}-${String(mo).padStart(2, "0")}`); if (++mo > 12) { mo = 1; y++; } } }
    }
    keys.forEach(k => { buckets[k] = buckets[k] || bk0(); });
    const TYPE = { amort: "амортизация", maturity: "погашение", offer: "оферта" };
    const perpSum = perp.reduce((a, e) => a + e.amount, 0);
    redHost.innerHTML = `<div class="panel"><h3 data-phone-title="Погашения">График погашения выпусков <span class="muted" style="font-weight:400;font-size:12px">· все типы купона</span></h3>
      <div class="muted" data-chart-help style="font-size:12px;margin-top:2px">Будущие выплаты номинала по всем выпускам в выбранной валюте независимо от фильтра «Фикс / Флоатеры»: амортизации — на свои даты, погашение — только остаток номинала после прошедших амортизаций; если оферта раньше погашения — остаток на дату оферты${showCp ? ". Купоны — до той же даты: фикс — по графику биржи, флоатеры — прогноз по форвардам ключевой ставки / RUONIA из кривых свопов Мосбиржи" : ""}</div>
      <div class="chips" style="margin-top:8px">
        <span class="chip ${rg === "month" ? "on" : ""}" data-rg="month">по месяцам</span>
        <span class="chip ${rg === "quarter" ? "on" : ""}" data-rg="quarter">по кварталам</span>
        <span class="chip ${rg === "year" ? "on" : ""}" data-rg="year">по годам</span>
        <span class="chip ${showCp ? "on" : ""}" data-cp="1" style="margin-left:10px">+ купоны</span>
      </div>
      <div class="chart" id="ip-redemption" style="height:290px;margin-top:8px"></div>
      ${perp.length ? `<div class="muted" style="font-size:12px;margin-top:6px">Бессрочные выпуски (без даты погашения, на графике нет): ${perp.length} на ${volFmt(perpSum)} — ${perp.map(e => escA(e.name)).join(", ")}</div>` : ""}</div>`;
    redHost.querySelectorAll("[data-rg]").forEach(c => c.onclick = () => { ISSUER.redGran = c.dataset.rg; drawRed(evs); });
    redHost.querySelector("[data-cp]").onclick = () => { ISSUER.redCoupons = !ISSUER.redCoupons; drawRed(evs); };
    window.BondsMobile?.compactChartText(redHost);
    if (!keys.length) return;
    const labels = keys.map(plabel);
    mkChart(redHost.querySelector("#ip-redemption"), {
      ...CHART_BG,
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: ps => {
        if (!ps || !ps.length) return "";
        const i = ps[0].dataIndex, bk = buckets[keys[i]];
        let t = `<div style="font-weight:600;margin-bottom:2px">${labels[i]}</div>`;
        ps.forEach(p => { if (p.value) t += `${p.marker}${p.seriesName}: <b>${volFmt(p.value)}</b><br/>`; });
        t += `<div style="border-top:1px solid rgba(255,255,255,.15);margin-top:2px;padding-top:2px">Всего: <b>${volFmt(bk.fix + bk.fl + bk.am + bk.cp + bk.cpp)}</b></div>`;
        t += `<div style="margin-top:4px;font-size:11px;line-height:1.5">${bk.items.slice().sort((a, b) => a.date < b.date ? -1 : 1).map(x => `<b>${escA(x.name)}</b> · ${dmy(x.date)} · ${TYPE[x.type] || ""}${x.type === "amort" && x.pct ? " " + fmt(x.pct, 1) + "% номинала" : ""} · ${volFmt(x.amount)}${x.rescaled ? ' <span style="opacity:.7">(пересчёт на текущий номинал)</span>' : ""}`).join("<br>")}</div>`;
        const cps = Object.entries(bk.cps).sort((a, b) => b[1].amount - a[1].amount);
        if (cps.length) t += `<div style="margin-top:4px;font-size:11px;line-height:1.5;opacity:.9">купоны: ${cps.slice(0, 8).map(([n, c]) => `${escA(n)} ${volFmt(c.amount)}${c.projected ? " (прогноз)" : ""}`).join(" · ")}${cps.length > 8 ? ` · ещё ${cps.length - 8}` : ""}</div>`;
        return t;
      } },
      legend: { top: 4, right: 10, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
      grid: { left: 64, right: 24, top: showCp ? 56 : 34, bottom: rg === "month" ? 52 : 28 },   // с купонами легенда длиннее — не наезжает на подпись оси
      xAxis: { type: "category", data: labels, ...AX, axisLabel: { color: AXIS_TXT, fontSize: 10, hideOverlap: true, rotate: rg === "month" ? 40 : 0 } },
      yAxis: { type: "value", name: showCp ? "Выплаты номинала и купонов, ₽" : "Выплаты номинала, ₽", nameGap: 14, nameTextStyle: { align: "right", padding: [0, 8, 0, 0], color: cssVar("--muted", "#8aa") }, min: 0, ...AX, axisLabel: { color: AXIS_TXT, formatter: axFmt } },
      series: [
        { name: "Погашение · фикс", type: "bar", stack: "v", data: keys.map(k => Math.round(buckets[k].fix) || null), itemStyle: { color: "#1fe0a0" }, barMaxWidth: 40 },
        { name: "Погашение · флоатеры", type: "bar", stack: "v", data: keys.map(k => Math.round(buckets[k].fl) || null), itemStyle: { color: "#8b7bff" }, barMaxWidth: 40 },
        { name: "Амортизация", type: "bar", stack: "v", data: keys.map(k => Math.round(buckets[k].am) || null), itemStyle: { color: "#f5b13c" }, barMaxWidth: 40 },
        { name: "Купоны", type: "bar", stack: "v", data: keys.map(k => Math.round(buckets[k].cp) || null), itemStyle: { color: "#35d6e6" }, barMaxWidth: 40 },
        { name: "Купоны · прогноз (флоатеры)", type: "bar", stack: "v", data: keys.map(k => Math.round(buckets[k].cpp) || null), itemStyle: { color: "#35d6e655", borderColor: "#35d6e6", borderType: "dashed", borderWidth: 1 }, barMaxWidth: 40 },
      ].filter(x => x.data.some(v => v)),
    });
  };
  if (ISSUER.red && ISSUER.red.key === redKey) drawRed(ISSUER.red.events);
  else if (redKey) {
    redHost.innerHTML = `<div class="panel"><h3>График погашения выпусков</h3><div class="loading" style="padding:18px">Считаю выплаты по графикам амортизации…</div></div>`;
    fetch(`${API}/api/issuer_redemptions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isins: redKey.split(",") }) }).then(x => x.ok ? x.json() : null).then(r => {
      if (!r) { redHost.innerHTML = ""; return; }
      ISSUER.red = { key: redKey, events: r.events || [] };
      if (document.body.contains(redHost)) drawRed(ISSUER.red.events);
    }).catch(() => { redHost.innerHTML = ""; });
  }

  // сортировка (клик по заголовку); значение доходности/спреда зависит от типа
  const ipVal = b => {
    const fl = b.kind === "floater";
    if (ISSUER.sort === "ytm") return fl ? flCoupon(b) : b.ytm;       // сортируем по тому, что показано
    if (ISSUER.sort === "g_spread_bp") return fl ? b.simple_margin_bp : b.g_spread_bp;
    return b[ISSUER.sort];
  };
  const sorted = [...bonds].sort((a, b) => { const x = ipVal(a), y = ipVal(b); if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * (ISSUER.desc ? -1 : 1); });
  const IP_COLS = [["name", "Выпуск", "l"], ["kind", "Тип", "c"], ["ytm", "Доходность", "c"], ["duration_years", "Дюрация", "c"], ["g_spread_bp", "Премия", "c"], ["matdate", "Погашение", "c"]];
  const ipArrow = k => ISSUER.sort === k ? (ISSUER.desc ? " ▾" : " ▴") : " ⇅";
  const th = IP_COLS.map(([k, l, al]) => `<th data-k="${k}" style="cursor:pointer;user-select:none;text-align:${al === "l" ? "left" : "center"}">${l}<span class="muted" style="font-size:10px">${ipArrow(k)}</span></th>`).join("");
  const body = sorted.map(b => {
    const fl = b.kind === "floater";
    const freq = { 12: "ежемес.", 4: "ежекв.", 2: "полугод.", 1: "год." }[b.couponfrequency] || "";
    return `<tr data-isin="${b.isin}">
      <td style="text-align:left">
        <span class="link">${b.name}</span>${b.currency && b.currency !== "RUB" ? ` <span class="badge float" style="font-size:9px;padding:1px 5px">${b.currency}</span>` : ""}
        <div class="muted" style="font-size:10.5px;line-height:1.35">${b.issuer_full || ""}</div>
        <div class="muted" style="font-size:10px">купон ${pct(b.couponpercent)}${freq ? " · " + freq : ""}${b.price != null ? " · цена " + pct(b.price, 2) : ""}${b.years_to_maturity != null ? " · до погаш. " + fmt(b.years_to_maturity, 1) + " г" : ""}</div>
      </td>
      <td><span class="badge ${b.kind}">${KIND_RU[b.kind] || "—"}</span></td>
      <td><b>${pct(fl ? flCoupon(b) : b.ytm)}</b></td><td>${fl ? (b.years_to_maturity == null ? "—" : `${fmt(b.years_to_maturity, 1)}<div class="muted" style="font-size:9px">срок</div>`) : fmt(b.duration_years, 2)}</td>
      <td class="${spreadCls(fl ? b.simple_margin_bp : b.g_spread_bp)}">${fl ? bp(b.simple_margin_bp) : bp(b.g_spread_bp)}</td>
      <td>${dmy(b.matdate)}${b.offer_date ? `<div class="muted" style="font-size:10px">${offerWord(b)} ${dmy(b.offer_date)}</div>` : ""}</td></tr>`;
  }).join("");
  const t = el(`<div class="tbl-wrap panel"><div style="overflow-x:auto"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div></div>`);
  t.querySelectorAll("th").forEach(h => h.onclick = () => { const k = h.dataset.k; if (ISSUER.sort === k) ISSUER.desc = !ISSUER.desc; else { ISSUER.sort = k; ISSUER.desc = true; } render({ keepScroll: true }); });
  t.querySelectorAll("tr[data-isin]").forEach(tr => tr.onclick = (e) => { if (e.target.closest("th")) return; openIssue(tr.dataset.isin); });
  host.appendChild(t);
}

function issueVolumeCaption(d, original = null) {
  const currency = { RUB: "₽", USD: "$", EUR: "€", CNY: "¥" }[d.currency] || d.currency || "₽";
  const money = v => v == null || !Number.isFinite(v) ? "—" : bigMoney(v).replace("₽", escA(currency));
  return `<span class="muted" style="display:inline-flex;flex-wrap:wrap;gap:4px 12px;font-weight:400;font-size:12px;margin-left:8px"><span title="Количество облигаций × текущий номинал">остаточный объём — ${money(d.issue_volume)}</span><span title="Тот же объём облигаций × исходный номинал MOEX, до амортизации; не история доразмещений и выкупов">первоначальный — ${money(original)}</span></span>`;
}

async function renderIssue(v) {
  const isin = ISSUE.isin;
  const prevTab = NAV_STACK.length ? NAV_STACK[NAV_STACK.length - 1] : null;
  const backLabel = prevTab === "issuer" ? "← Назад к эмитенту" : "← Назад к скринеру";
  v.appendChild(el(`<div class="toolbar"><button class="btn ghost" id="i-back">${backLabel}</button>
    <button class="btn ghost" id="i-watch" style="font-size:13px">${WATCH.has(isin) ? "★ В избранном" : "☆ В избранное"}</button>
    <span class="muted" style="font-family:var(--mono)">${isin}</span></div>`));
  v.querySelector("#i-back").onclick = goBack;
  v.querySelector("#i-watch").onclick = e => { toggleWatch(isin); e.target.textContent = WATCH.has(isin) ? "★ В избранном" : "☆ В избранное"; };
  const host = el(`<div id="i-body"><div class="loading">Загружаю выпуск…</div></div>`);
  v.appendChild(host);

  if (!ISSUE.base) {
    try { ISSUE.base = await fetch(`${API}/api/universe/one?isin=${isin}`).then(x => x.ok ? x.json() : x.json().then(e => ({ error: e.detail }))); }
    catch (e) { ISSUE.base = { error: String(e) }; }
  }
  const d = ISSUE.base;
  host.innerHTML = "";
  if (!d || d.error) { host.appendChild(el(`<div class="alert error">${d?.error || "Нет в снимке"}. Нажми «⟳ Обновить рынок».</div>`)); return; }
  const isFloat = d.kind === "floater";
  // Структурная нота / бумага без сопоставимого YTM (купон ≈0 с премией, либо
  // отрицательный номинальный YTM): backend уже занулил ytm/спреды. Показываем
  // только цену, без вводящих в заблуждение YTM/спредов.
  const isStruct = !isFloat && d.ytm == null;

  // ---- header KPIs (instant, from cache) ----
  host.appendChild(el(`<div class="panel"><h3>${d.name || isin}
      <span id="i-volume-caption">${issueVolumeCaption(d)}</span>
      <span class="badge ${d.kind}" style="margin-left:8px">${KIND_RU[d.kind] || d.type_label || ""}</span>
      <span id="i-rating-head">${issueRatingHead(d)}</span>
      <span class="muted" style="font-weight:400;font-size:13px;margin-left:8px">${d.issuer ? `<span class="link" id="i-issuer">${d.issuer}</span>` : ""}${d.sector ? " · " + d.sector : ""}</span></h3>
    <div id="i-rt-wrap" style="margin:-6px 0 14px;overflow-x:auto;${d.agency_all && d.agency_all.length ? "" : "display:none"}">${d.agency_all && d.agency_all.length ? agTable(d) : ""}</div>
    <div class="kpis kpis-4" style="margin:0">
      <div class="kpi"><div class="label">${isFloat ? "Ориентир: индекс + спред" : (d.ytm_basis === "offer" ? `YTM · к ${d.offer_type === "CALL" ? "колл-опциону" : "оферте"} ${dmy(d.offer_date)}${d.offer_soon_days != null ? ` (ближайшая дата через ${d.offer_soon_days} дн. не учитывается — слишком близко)` : ""}`
          : d.ytm_basis === "mbs" ? "YTM · с учётом досрочных погашений (модель биржи)"
          : d.offer_soon_days != null ? `YTM · к погашению: ближайшая оферта или колл через ${d.offer_soon_days} дн. не учитывается — слишком близко`
          : (d.ytm_to_maturity || d.offer_date ? "YTM · к погашению" : "YTM"))}${d.ruble_basis ? ", " + d.currency : ""}</div><div class="value">${pct(isFloat ? flCoupon(d) : d.ytm)}${yieldBasisBadge(d)}</div><div class="sub">${isFloat ? `${flIndex(d)} + ${fmt(d.float_add != null ? d.float_add : (d.float_qm || 0), 2)}%${d.couponpercent != null ? ` · текущий купон ${pct(d.couponpercent)}` : ""}` : ""}<span id="i-ytm-ba" style="display:block"></span></div></div>
      <div class="kpi"><div class="label">Цена</div><div class="value">${pct(d.price, 2)}</div><div class="sub"><div id="i-price-ba"></div></div></div>
      ${isFloat
        ? `<div class="kpi">${kpiQ("Simple margin / DM к ОФЗ",
            "Simple margin — премия флоатера к своему индексу (ключевая ставка или RUONIA) с учётом цены, по методике Fabozzi. DM к ОФЗ — насколько simple margin бумаги выше, чем у ОФЗ-ПК на том же сроке. Срок — до ближайшей оферты или колла дальше 14 дней, иначе до погашения. Для флоатеров на инфляцию, золото, ипотеку не считаются.",
            "SM = (QM + (100 − P) / T) × 100 / P — QM: маржа к индексу, P: чистая цена, T: лет до оферты / погашения\nDM к ОФЗ = SM бумаги − SM ОФЗ-ПК на том же сроке (+ разница «ключевая − RUONIA» у флоатеров на ключевую)")}<div class="label">Simple margin / DM к ОФЗ</div><div class="value v2 ${spreadCls(d.simple_margin_bp)}">${bp2(d.simple_margin_bp, d.dm_ofz_bp)}</div><div class="sub" id="i-sm-ba"></div></div>`
        : d.ruble_basis
        ? `<div class="kpi"><div class="label">Тек. доходность</div><div class="value">${pct(d.current_yield)}</div><div class="sub">${couponLine(d)}</div></div>`
        : `<div class="kpi">${kpiQ("G-спред / спред к ОФЗ",
            "G-спред — премия доходности бумаги к кривой бескупонных доходностей ОФЗ (КБД Мосбиржи) на той же дюрации. Спред к ОФЗ — к доходности ближайшей по дюрации ОФЗ. Доходность — к ближайшей оферте или коллу дальше 14 дней, иначе к погашению.",
            (d.spread_calc ? `G-спред = YTM ${fmt(d.spread_calc.ytm, 2)}% − ${d.spread_calc.curve} ${fmt(d.spread_calc.benchmark_yield, 2)}% = ${bp(d.spread_calc.g_spread_bp)}` : "G-спред = YTM − доходность КБД на дюрации бумаги") + "\nСпред к ОФЗ = YTM − YTM ближайшей по дюрации ОФЗ")}<div class="label">G-спред / спред к ОФЗ</div><div class="value v2 ${spreadCls(d.g_spread_bp)}">${bp2(d.g_spread_bp, d.spread_ofz_bp)}</div><div class="sub">к КБД / к ближайшей ОФЗ по сроку</div></div>`}
      ${isFloat
        ? zKpi(d, true)
        : (d.ruble_basis ? "" : zKpi(d, false))}
      ${isFloat
        ? `<div class="kpi"><div class="label">Погашение · срок</div><div class="value" style="font-size:18px">${dmy(d.matdate)}</div><div class="sub">${d.years_to_maturity == null ? "" : "через " + fmt(d.years_to_maturity, 1) + " г"}${d.is_amortizing ? " · аморт." : ""}</div>${d.offer_date ? `<div class="sub" style="margin-top:10px">${(d.offer_type || "").toUpperCase() === "CALL" ? "Колл-опцион (CALL)" : "Оферта (PUT)"}</div><div style="font-size:16px;font-weight:600;margin-top:3px">${dmy(d.offer_date)}</div>` : ""}</div>`
        : `<div class="kpi"><div class="label">Дюрация</div><div class="value">${d.duration_years == null ? "—" : fmt(d.duration_years, 2)} <span style="font-size:14px;color:var(--muted)">лет</span></div><div class="sub">${d.matdate ? "погаш. " + dmy(d.matdate) : ""}${d.offer_date ? " / " + offerWord(d) + " " + dmy(d.offer_date) : (d.years_to_maturity != null ? " · " + fmt(d.years_to_maturity, 1) + " г" : "")}${d.is_amortizing ? " · аморт." : ""}</div></div>`}
      ${d.kind === "discount" ? '<div class="kpi"><div class="label">Купоны</div><div class="value">Нет</div><div class="sub">Дисконтный выпуск</div></div>' : `<div class="kpi"><div class="label">Купон</div><div class="value">${isFloat ? (d.float_add != null ? `${flIndex(d)}+${fmt(d.float_add, 2)}` : (d.float_qm != null ? `${flIndex(d)}+${fmt(d.float_qm, 2)}` : "плав.")) : pct(d.couponpercent)}</div><div class="sub">${isFloat ? `плавающий (к индексу ${flIndex(d)})` : "фикс. ставка"}${d.current_yield != null ? ` · тек. дох. ${pct(d.current_yield)}` : ""}</div></div>`}
      ${d.kind === "discount" ? "" : `<div class="kpi"><div class="label">Частота купона</div><div class="value" style="font-size:20px">${freqRu(d.couponfrequency)}</div><div class="sub">${d.couponfrequency ? fmt(d.couponfrequency, 0) + " раз/год" : "—"}</div></div>`}
      <button class="kpi kpi-btn" id="i-allissues" type="button"><div class="label">Эмитент</div><div class="value" style="font-size:16px">🏢 Другие выпуски</div><div class="sub" style="color:var(--acc)">открыть все →</div></button>
    </div>
    ${isFloat ? "" : `<div class="stat-row" style="margin-top:14px;align-items:center">
      <div class="s"><div class="l">Калькулятор: цена → доходность</div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
          <input type="number" id="i-price" value="${d.price ?? ""}" step="0.1" style="width:110px"> <span class="muted">% номинала →</span>
          <span class="v" id="i-ytm-calc" style="font-size:20px">${pct(d.ytm)}</span>
          <span class="muted" style="font-size:13px" id="i-ytp-calc"></span></div></div></div>`}
  </div>`));
  host.querySelector("#i-issuer")?.addEventListener("click", () => openIssuer(isin));
  host.querySelector("#i-allissues")?.addEventListener("click", () => openIssuer(isin));

  if (!isFloat) {
    const inp = host.querySelector("#i-price"), out = host.querySelector("#i-ytm-calc"), outp = host.querySelector("#i-ytp-calc");
    const kpiYtp = host.querySelector("#i-ytp-kpi");
    const calc = async (p, first) => {
      if (!p) return;
      // При ЦЕНЕ ПО УМОЛЧАНИЮ показываем ту же доходность, что в шапке (авторитетная
      // MOEX-YTM) — не пересчитываем, иначе дефолт расходится с KPI (наш метод даёт
      // чуть другую цифру). Пересчёт — только когда пользователь МЕНЯЕТ цену.
      const isDefault = d.price != null && Math.abs(p - d.price) < 0.01;
      if (isDefault) { out.textContent = d.ytm != null ? pct(d.ytm) : "—"; out.className = "v"; }
      else if (!first) out.textContent = "…";
      try {
        const r = await fetch(`${API}/api/instrument/${isin}/ytm?price=${p}`).then(x => x.json());
        // для изменённой цены: у бумаг с офертой показываем доходность К ОФЕРТЕ (там
        // купоны заданы только до пута), к погашению — вторичной строкой
        // «конец известного купона» — не оферта: после пута купон зафиксирован на несколько
        // периодов, а новой оферты ещё нет. Главной оставляем доходность к погашению (как в
        // шапке карточки), осторожную — второй строкой со своей датой
        const knownEnd = r.offer && r.offer.type === "Конец известного купона";
        // оферта через 14 дней и меньше: приём заявок закрыт — главная цифра к погашению, как в шапке
        const hasOffer = r.ytp != null && !knownEnd && d.offer_soon_days == null && d.ytm_basis !== "maturity";
        if (!isDefault) {
          const primary = hasOffer ? r.ytp : r.ytm;
          out.textContent = primary != null ? pct(primary) : "—";
          out.className = "v";
        }
        if (outp) outp.textContent = hasOffer ? `к оферте · к погашению ${pct(r.ytm)}`
          : knownEnd && r.ytp != null ? `к погашению · к ${dmy(r.offer.date)}, концу известного купона, ${pct(r.ytp)}` : "";
        if (kpiYtp && r.ytp != null && !knownEnd) kpiYtp.textContent = `к оферте: ${pct(r.ytp)}`;
      } catch (e) { if (!isDefault) out.textContent = "ошибка"; }
    };
    inp.oninput = debounce(() => calc(parseFloat(inp.value), false), 350);
    // на открытии дёргаем /ytm ТОЛЬКО у бумаг с офертой (нужна подпись «к оферте/к
    // погашению»); у остальных primary уже = YTM из шапки — лишний запрос не нужен
    if (d.offer_date) calc(d.price, true);
  }

  // Original face lookup is cached and independent of the instant card render.
  fetch(`${API}/api/universe/volumes?isin=${encodeURIComponent(isin)}`).then(r => r.ok ? r.json() : null).then(vol => {
    const caption = host.querySelector("#i-volume-caption");
    if (vol && caption && host.isConnected && ISSUE?.isin === isin) caption.innerHTML = issueVolumeCaption(vol, vol.initial_issue_volume);
  }).catch(() => {}); // Keep an honest dash if original nominal is unavailable.

  // ---- liquidity (MOEX history) ----
  wireInfoIcons(host);                        // «?» у спредов в плитках
  const liqNode = el(`<div class="panel" style="padding:13px 20px"><div id="i-liq" class="muted">Ликвидность (MOEX)…</div></div>`);
  host.appendChild(liqNode);
  loadLiquidity(isin, liqNode.querySelector("#i-liq"));

  // bid/ask — gray sub-line inside the price tile, plus YTM (fixes) or
  // simple margin (floaters) computed at the bid/ask prices.
  if (d.bid != null || d.offer != null) {
    if (isFloat) loadBidAskFloat(d, host.querySelector("#i-price-ba"), host.querySelector("#i-sm-ba"));
    else loadBidAsk(isin, d, host.querySelector("#i-price-ba"), host.querySelector("#i-ytm-ba"));
  }

  // amortization / offer schedule — explains why duration ≪ maturity
  const schedNode = el(`<div id="i-sched"></div>`);
  host.appendChild(schedNode);
  loadSchedule(isin, d, schedNode);

  // full (realized) total return over a window: price change + coupons + amort
  // рейтинги: уточнённая таблица («было» по истории агентства) и график по датам — перед полной доходностью
  const rtNode = el(`<div id="i-rt-chart"></div>`);
  host.appendChild(rtNode);
  // Always ask the detail endpoint, even if the instant screener row had no
  // rating.  A freshly assigned/changed rating must appear without reopening
  // the page, and the large badge must stay in sync with the detailed lines.
  fetch(`${API}/api/bonds/${isin}/ratings`).then(x => x.ok ? x.json() : null).then(r => {
    if (!r || ISSUE.isin !== isin) return;
    const list = r.agencies || [];
    if (list.length && r.worst) {
      Object.assign(d, {
        agency_rating: r.worst.rating, agency_bucket: r.worst.bucket, agency_name: r.worst.agency,
        agency_forecast: r.worst.forecast || r.worst.issuer_forecast || null,
        agency_trend: r.worst.trend || null, agency_all: list,
      });
      const h = document.getElementById("i-rating-head");
      if (h) h.innerHTML = issueRatingHead(d);
      const w = document.getElementById("i-rt-wrap");
      if (w) { w.style.display = ""; w.innerHTML = agTable(d, list); }
      drawRatingTimeline(rtNode, list);
    }
  }).catch(() => {});
  const trNode = el(`<div id="i-tr"></div>`);
  host.appendChild(trNode);
  lazyLoad(trNode, () => loadTotalReturn(isin, trNode, d.currency || "RUB"));

  // ---- unified group evaluation (rating group + peers + coupon model) ----
  const ge = ISSUE.ge || (ISSUE.ge = { mode: "by_rating", ymin: "", ymax: "", dmin: "", dmax: "" });
  const isFx = d.kind !== "floater";
  const gePanel = el(`<div class="panel"><h3>Оценка относительно группы <span class="muted" style="font-weight:400;font-size:12px">· ${d.currency || "RUB"}</span></h3>
    <div class="chips" id="ge-mode">
      <span class="chip ${ge.mode === 'by_rating' ? 'on' : ''}" data-m="by_rating">Тот же рейтинг</span>
      <span class="chip ${ge.mode === 'by_sector' ? 'on' : ''}" data-m="by_sector">Та же отрасль</span>
      <span class="chip ${ge.mode === 'issuer' ? 'on' : ''}" data-m="issuer">Того же эмитента</span>
    </div>
    <div class="toolbar" style="margin:12px 0 4px;font-size:12px;align-items:center">
      <span class="muted">${isFx ? "Доходность, %" : "Simple margin, б.п."}:</span>
      <input type="number" id="ge-ymin" placeholder="от" value="${ge.ymin}" style="width:66px">
      <input type="number" id="ge-ymax" placeholder="до" value="${ge.ymax}" style="width:66px">
      <span class="muted" style="margin-left:6px">Дюрация:</span>
      <input type="number" id="ge-dmin" placeholder="от" value="${ge.dmin}" style="width:66px">
      <input type="number" id="ge-dmax" placeholder="до" value="${ge.dmax}" style="width:66px">
    </div>
    <div id="ge-comment"></div>
    <div class="chart tall" id="ge-chart"><div class="loading"></div></div>
    <div id="ge-tbl"></div></div>`);
  host.appendChild(gePanel);
  gePanel.querySelectorAll("#ge-mode .chip").forEach(c => c.onclick = () => { ISSUE.ge.mode = c.dataset.m; render(); });
  const geDraw = debounce(() => drawGroupEval(isin, d, gePanel), 300);
  [["ge-ymin", "ymin"], ["ge-ymax", "ymax"], ["ge-dmin", "dmin"], ["ge-dmax", "dmax"]].forEach(([id, k]) =>
    gePanel.querySelector("#" + id).oninput = e => { ISSUE.ge[k] = e.target.value; geDraw(); });
  ISSUE.geModelYtm = null;              // coupon model lives in Первичка only
  loadGroupEval(isin, d, gePanel);   // eager — сравнение по рейтингу/эмитенту строим сразу

  // ---- history ----
  // Floater: price + simple-margin history (no YTM / G-spread). Fix: 4 charts.
  const hc = isStruct
    ? el(`<div class="grid2">
        <div class="panel" style="grid-column:1/-1"><h3>Цена, история <span class="muted" style="font-weight:400;font-size:12px">· купон ≈0 с премией — YTM и спреды неинформативны</span></h3><div class="chart" id="h-price"><div class="loading"></div></div></div>
      </div>`)
    : isFloat
    ? el(`<div class="grid2">
        <div class="panel"><h3>Цена, история <span class="muted" style="font-weight:400;font-size:12px">· флоатер</span></h3><div class="chart" id="h-price"><div class="loading"></div></div></div>
        <div class="panel"><h3>Simple margin, история</h3><div class="chart" id="h-sm"><div class="loading"></div></div></div>
      </div>`)
    : (d.ruble_basis || (d.currency && d.currency !== "RUB"))
    ? el(`<div class="grid2">
        <div class="panel"><h3>Доходность (YTM, ${d.currency}), история</h3><div class="chart" id="h-ytm"><div class="loading"></div></div></div>
        <div class="panel"><h3>Цена, история</h3><div class="chart" id="h-price"><div class="loading"></div></div></div>
      </div>`)
    : d.kind === "linker"
    ? el(`<div class="grid2">
        <div class="panel"><h3>Доходность, история <span class="muted" style="font-weight:400;font-size:11.5px">· реальная (номинал индексируется)</span></h3><div class="chart" id="h-ytm"><div class="loading"></div></div></div>
        <div class="panel"><h3>Цена, история</h3><div class="chart" id="h-price"><div class="loading"></div></div></div>
      </div>`)
    : el(`<div class="grid2">
        <div class="panel"><h3>Доходность (YTM), история</h3><div class="chart" id="h-ytm"><div class="loading"></div></div></div>
        <div class="panel"><h3>Цена, история</h3><div class="chart" id="h-price"><div class="loading"></div></div></div>
        <div class="panel"><h3>G-спред к КБД, история</h3><div class="chart" id="h-gk"><div class="loading"></div></div></div>
        <div class="panel"><h3>Спред к ОФЗ, история</h3><div class="chart" id="h-go"><div class="loading"></div></div></div>
      </div>`);
  host.appendChild(hc);
  loadIssueHistory(isin, hc, isFloat);   // eager — история + линии среднего группы сразу

  // ---- news ----
  const newsPanel = el(`<div class="panel"><h3>Новости эмитента</h3><div id="i-news"><div class="loading"></div></div></div>`);
  host.appendChild(newsPanel);
  lazyLoad(newsPanel, () => loadNews(isin, newsPanel.querySelector("#i-news")));
}

async function loadNews(isin, node) {
  let d = null;
  try { d = await fetch(`${API}/api/instrument/${isin}/news`).then(x => x.json()); } catch (e) { }
  node.innerHTML = "";
  if (!d || !d.news || !d.news.length) { node.innerHTML = `<div class="muted" style="padding:16px">Новостей не найдено${d && d.issuer ? " по «" + String(d.issuer).replace(/</g, "&lt;") + "»" : ""}.</div>`; return; }
  // сторонний RSS → экранируем текст и пускаем только http(s)-ссылки (защита от внедрения HTML/JS)
  const esc = x => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const safeUrl = u => /^https?:\/\//i.test(u || "") ? esc(u) : "#";
  node.appendChild(el(`<div>${d.news.map(n => `<div style="padding:9px 0;border-bottom:1px solid var(--line)">
    <a href="${safeUrl(n.link)}" target="_blank" rel="noopener noreferrer" style="color:var(--text);font-weight:600;text-decoration:none">${esc(n.title)}</a>
    <div class="muted" style="font-size:11px;margin-top:2px">${esc(n.source)}${n.date ? " · " + dmy(n.date) + (/\d{2}:\d{2}/.test(n.date) ? " " + n.date.slice(11, 16) : "") : ""}</div></div>`).join("")}</div>`));
}

function _tsChart(node, data, color, fmtFn) {
  node.innerHTML = "";                       // clear the loading spinner
  if (!data || !data.length) { node.innerHTML = `<div class="muted" style="padding:30px;text-align:center">Нет данных</div>`; return; }
  mkChart(node, {
    ...CHART_BG, tooltip: { trigger: "axis", formatter: (ps) => {
      if (!ps || !ps.length) return "";
      const p = ps[0]; const v = p.value ? p.value[1] : null;
      return `<div style="font-size:11px;opacity:.65">${dmyAny(p.axisValue)}</div><b>${fmtFn ? fmtFn(v) : v}</b>`;
    } },
    grid: { left: 50, right: 16, top: 16, bottom: 26 },
    xAxis: { type: "time", ...AX }, yAxis: { type: "value", scale: true, ...AX },
    color: [color],
    series: [{ type: "line", data, smooth: true, symbol: "none", lineStyle: { width: 2, color }, itemStyle: { color },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: color + "40" }, { offset: 1, color: color + "00" }]) } }],
  });
}

// как _tsChart, но со статистикой: полосы медиана / P5 / P95 и возврат перцентиля/z
function _spreadChart(node, data, color) {
  node.innerHTML = "";
  const series = (data || []).filter(p => p[1] != null);
  if (!series.length) { node.innerHTML = `<div class="muted" style="padding:30px;text-align:center">Нет данных</div>`; return null; }
  const vals = series.map(p => p[1]);
  const sorted = [...vals].sort((a, b) => a - b);
  const cur = vals[vals.length - 1];
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
  const z = (cur - mean) / std;
  const median = Math.round(_pctile(sorted, 0.5)), p5 = Math.round(_pctile(sorted, 0.05)), p95 = Math.round(_pctile(sorted, 0.95));
  const percentile = Math.round(100 * vals.filter(v => v <= cur).length / vals.length);
  // на светлых темах метки (P95/медиана/P5) — чёрным текстом БЕЗ тёмного фона
  const _lt = document.body.classList.contains("light") || document.body.classList.contains("paper");
  const ml = (yv, lineCol, labCol, txt, dash) => ({ yAxis: yv, lineStyle: { color: lineCol, width: 1, type: dash ? "dashed" : "solid" }, label: { formatter: txt, color: _lt ? "#101a17" : labCol, fontSize: 11, fontWeight: 600, position: "end", distance: 4, backgroundColor: _lt ? "transparent" : "rgba(16,22,20,.62)", padding: [2, 4], borderRadius: 3 } });
  mkChart(node, {
    ...CHART_BG, tooltip: { trigger: "axis", formatter: (ps) => {
      if (!ps || !ps.length) return "";
      let s = `<div style="font-size:11px;opacity:.65">${dmyAny(ps[0].axisValue)}</div>`;
      // одна серия (без средних) — показываем просто значение; со средними — с подписями
      if (ps.length === 1) {
        const v = ps[0].value ? ps[0].value[1] : ps[0].value;
        return s + (v != null ? `<b>${bp(Math.round(v))}</b>` : "");
      }
      ps.forEach(p => { const v = p.value ? p.value[1] : p.value; if (v != null) s += `${p.marker}${p.seriesName}: <b>${bp(Math.round(v))}</b><br/>`; });
      return s;
    } },
    grid: { left: 50, right: 104, top: 16, bottom: 26 },
    xAxis: { type: "time", ...AX }, yAxis: { type: "value", scale: true, ...AX }, color: [color],
    series: [{
      name: "эта бумага",
      type: "line", data: series, smooth: true, symbol: "none", lineStyle: { width: 2, color }, itemStyle: { color },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: color + "40" }, { offset: 1, color: color + "00" }]) },
      markLine: {
        silent: true, symbol: "none", data: [
          ml(median, "#7a8a84", "#e7eeea", "медиана " + median, false),
          ml(p95, "#5f6d67", "#c6d2cc", "P95 " + p95, true),
          ml(p5, "#5f6d67", "#c6d2cc", "P5 " + p5, true),
        ],
      },
    }],
  });
  return { cur, percentile, z, median, p5, p95, n: vals.length };
}

// развернуть график в большое интерактивное окно (зум/скролл), переиспользуя его опцию
function expandChart(sourceNode, title) {
  const ci = sourceNode && echarts.getInstanceByDom(sourceNode);
  if (!ci) return;
  const opt = ci.getOption();
  opt.dataZoom = [{ type: "inside" }, { type: "slider", bottom: 8, height: 20, borderColor: "transparent", textStyle: { color: cssVar("--muted", "#8aa") } }];
  if (opt.grid && opt.grid[0]) opt.grid[0].bottom = 58;
  const ov = el(`<div class="modal-ov"><div class="modal" style="width:min(1120px,97vw)">
    <div class="modal-title">${title} <span class="muted" style="font-weight:400;font-size:12px">· колесо — зум, тяни ползунок снизу</span><span class="link" data-close style="float:right;font-size:18px">✕</span></div>
    <div class="chart" id="xc-big" style="height:min(72vh,600px)"></div></div></div>`);
  document.body.appendChild(ov);
  ov.onclick = (e) => { if (e.target === ov || e.target.closest("[data-close]")) ov.remove(); };
  setTimeout(() => { const c = echarts.init(ov.querySelector("#xc-big"), null, { renderer: "svg" }); c.setOption(opt); charts.push(c); }, 30);
}
// добавить кнопку «развернуть» в заголовок панели графика
function addExpand(node, title) {
  if (!node || node.querySelector(".xc-btn")) return;
  node.style.position = "relative";
  const b = el(`<button class="xc-btn" title="Развернуть на весь экран" aria-label="Развернуть"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>`);
  b.onclick = (e) => { e.stopPropagation(); expandChart(node, title); };
  node.appendChild(b);
}

async function loadIssueHistory(isin, hc, isFloat) {
  let h = null;
  // средние по эмитенту/рейтингу запрашиваем сразу, параллельно с историей бумаги
  const peersP = hc.querySelector("#h-gk, #h-sm") ? fetch(`${API}/api/instrument/${isin}/peers_history`).then(x => x.json()).catch(() => null) : null;
  try { h = await fetch(`${API}/api/instrument/${isin}/history`).then(x => x.json()); } catch (e) { }
  if (!h || h.detail) {
    hc.querySelectorAll(".chart").forEach(n => n.innerHTML = `<div class="muted" style="padding:30px;text-align:center">История недоступна</div>`);
    return;
  }
  // бумага ни разу не торговалась (МТС 2Р-15: сто дней на бирже без единой сделки) — вместо
  // четырёх пустых рамок графиков говорим об этом прямо
  const _len = x => Array.isArray(x) ? x.length : 0;
  if (!_len(h.price) && !_len(h.ytm) && !_len(h.simple_margin)) {
    hc.querySelectorAll(".chart").forEach(n => n.innerHTML = `<div class="muted" style="padding:30px;text-align:center;line-height:1.5">Сделок по бумаге на бирже не было —<br>истории цены и доходности нет</div>`);
    return;
  }
  _tsChart(hc.querySelector("#h-price"), h.price, "#35d6e6", v => fmt(v, 2));
  addExpand(hc.querySelector("#h-price"), "Цена, история");
  // структурная нота: панель только с ценой — YTM/спредов нет, выходим
  if (!isFloat && !hc.querySelector("#h-ytm")) return;
  const stat = (node, st) => { if (!node || !st) return; const vc = st.percentile >= 85 ? "var(--pos,#2fe08a)" : st.percentile <= 15 ? "var(--neg,#ff6b6b)" : "var(--muted,#8aa)"; node.closest(".panel").querySelector("h3").insertAdjacentHTML("beforeend", `<span class="muted" style="display:block;margin-top:3px;font-weight:400;font-size:11.5px">сейчас <b style="color:var(--text)">${bp(st.cur)}</b> · перцентиль <b style="color:${vc}">${st.percentile}</b> · z ${st.z >= 0 ? "+" : ""}${fmt(st.z, 1)}σ · медиана ${bp(st.median)}</span>`); };
  if (isFloat) {
    stat(hc.querySelector("#h-sm"), _spreadChart(hc.querySelector("#h-sm"), h.simple_margin, "#f5b13c"));
    addExpand(hc.querySelector("#h-sm"), "Simple margin, история");
    loadPeers(isin, hc.querySelector("#h-sm"), peersP);
    return;
  }
  _tsChart(hc.querySelector("#h-ytm"), h.ytm, "#1fe0a0", v => pct(v));
  addExpand(hc.querySelector("#h-ytm"), "Доходность (YTM), история");
  // Валютные бумаги: G-спред к КБД и спред к ОФЗ не считаем (рублёвая кривая
  // к валютному потоку неприменима) — этих панелей на карточке нет.
  if (hc.querySelector("#h-gk")) {
    stat(hc.querySelector("#h-gk"), _spreadChart(hc.querySelector("#h-gk"), h.gspread_kbd, "#8b7bff"));
    addExpand(hc.querySelector("#h-gk"), "G-спред к КБД, история");
    loadPeers(isin, hc.querySelector("#h-gk"), peersP);
    if (h.benchmark_ofz) hc.querySelector("#h-go").closest(".panel").querySelector("h3").insertAdjacentHTML("beforeend", ` <span class="muted" style="font-weight:400;font-size:12px">· спред к <b style="color:var(--text)">${h.benchmark_ofz.name}</b></span>`);
    stat(hc.querySelector("#h-go"), _spreadChart(hc.querySelector("#h-go"), h.spread_ofz, "#f5b13c"));
    addExpand(hc.querySelector("#h-go"), "Спред к ОФЗ, история");
  }
}

// наложить средние по эмитенту и по рейтинговой группе на график спреда (async)
async function loadPeers(isin, node, pending) {
  if (!node) return;
  let p = null;
  try { p = await (pending || fetch(`${API}/api/instrument/${isin}/peers_history`).then(x => x.json())); } catch (e) { }
  if (!p || p.detail) return;
  const ch = echarts.getInstanceByDom(node);
  if (!ch) return;
  // Главное — СВОЯ бумага. Средние по эмитенту/рейтингу рисуем ТОЛЬКО за период,
  // когда сама бумага уже торговалась: обрезаем по диапазону её собственных дат,
  // иначе график «отдаляется» и показывает пустую групповую статистику до листинга.
  const opt0 = ch.getOption();
  const own = (opt0.series && opt0.series[0] && opt0.series[0].data) || [];
  const ownDates = own.map(pt => Array.isArray(pt) ? pt[0] : (pt && pt.value ? pt.value[0] : null)).filter(Boolean);
  const dmin = ownDates.length ? ownDates.reduce((a, b) => a < b ? a : b) : null;
  const dmax = ownDates.length ? ownDates.reduce((a, b) => a > b ? a : b) : null;
  const clip = (arr) => (dmin && dmax) ? (arr || []).filter(pt => pt[0] >= dmin && pt[0] <= dmax) : (arr || []);
  const iss = clip(p.issuer), rat = clip(p.rating);
  const extra = [], names = ["эта бумага"], byName = {};   // подсказка: по каким бумагам среднее
  const issName = `средн. эмитент (${p.issuer_n})`, ratName = `средн. рейтинг ${p.bucket || ""} (${p.rating_n})`;
  if (iss.length) { extra.push({ name: issName, type: "line", data: iss, smooth: true, symbol: "none", lineStyle: { width: 1.5, color: "#cf9d57", type: "dashed", opacity: .9 }, itemStyle: { color: "#cf9d57" } }); names.push(issName); byName[issName] = p.issuer_names || []; }
  if (rat.length) { extra.push({ name: ratName, type: "line", data: rat, smooth: true, symbol: "none", lineStyle: { width: 1.5, color: "#6f9ac9", type: "dashed", opacity: .9 }, itemStyle: { color: "#6f9ac9" } }); names.push(ratName); byName[ratName] = p.rating_names || []; }
  if (!extra.length) return;
  ch.setOption({
    legend: { top: 0, left: "center", textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 10 }, itemWidth: 13, itemHeight: 8, itemGap: 12, data: names,
      tooltip: { show: true, backgroundColor: "rgba(16,22,20,.96)", borderColor: "rgba(255,255,255,.12)", textStyle: { color: "#dfe7e3", fontSize: 11 },
        formatter: (o) => { const l = byName[o.name]; return l && l.length ? `<div style="max-width:300px;white-space:normal;line-height:1.5"><b>${o.name}</b><br>${l.join(" · ")}</div>` : o.name; } } },
    grid: { top: 34 },
    xAxis: { min: dmin || undefined, max: dmax || undefined },
    series: [{ name: "эта бумага" }, ...extra],
  });
}

async function loadBidAsk(isin, base, priceNode, ytmNode) {
  const ytmAt = async p => { if (p == null) return null; try { const r = await fetch(`${API}/api/instrument/${isin}/ytm?price=${p}`).then(x => x.json()); return base.ytm_basis !== "offer" || (r.offer && r.offer.type === "Конец известного купона") ? r.ytm : (r.ytp != null ? r.ytp : r.ytm); } catch (e) { return null; } };
  const [yb, ya] = await Promise.all([ytmAt(base.bid), ytmAt(base.offer)]);
  const rng = (a, b, suf) => a != null && b != null ? `бид–аск ${fmt(a, 2)} – ${fmt(b, 2)}${suf}` : (a != null || b != null ? `${fmt(a ?? b, 2)}${suf}` : "");
  if (priceNode) priceNode.textContent = rng(base.bid, base.offer, "%");
  if (ytmNode) ytmNode.textContent = rng(yb, ya, "%");
}

// Simple margin (Fabozzi) at a given price — mirrors the backend so we can show
// the floater's SM at the bid and ask prices without an extra round-trip.
function smAt(p, qm, years) {
  if (p == null || qm == null || p <= 0) return null;
  const pull = (years && years > 0) ? (100 - p) / years : 0;
  return Math.round((qm + pull) * (100 / p) * 100);
}
async function loadBidAskFloat(d, priceNode, smNode) {
  if (priceNode) priceNode.textContent = d.bid != null && d.offer != null
    ? `бид–аск ${fmt(d.bid, 2)} – ${fmt(d.offer, 2)}%`
    : (d.bid != null || d.offer != null ? `${fmt(d.bid ?? d.offer, 2)}%` : "");
  if (!smNode) return;
  const sb = smAt(d.bid, d.float_qm, d.years_to_maturity);   // lower price → higher SM
  const sa = smAt(d.offer, d.float_qm, d.years_to_maturity);
  smNode.textContent = (sa != null && sb != null) ? `бид–аск ${bp(sb)} – ${bp(sa)}`
    : (sa != null || sb != null ? bp(sb ?? sa) : `${couponLine(d)}`);
}

async function loadSchedule(isin, base, node) {
  let d = null;
  try { d = await fetch(`${API}/api/instrument/${isin}/schedule`).then(x => x.json()); } catch (e) { }
  if (!d || d.detail || !d.amortizing) return;      // only show for amortizing bonds
  const am = (d.amortizations || []).filter(a => (a.valueprc || 0) < 100);
  const rows = am.map(a => `<span style="display:inline-block;margin-right:14px"><b>${dmy(a.date)}</b> — ${fmt(a.valueprc, 0)}%</span>`).join("");
  node.innerHTML = "";
  node.appendChild(el(`<div class="panel" style="border-left:3px solid var(--amber,#f5b13c)">
    <b>Амортизируемый выпуск</b> <span class="muted">— номинал гасится частями, поэтому дюрация (${fmt(base.duration_years, 2)} г.) заметно короче срока до погашения (${fmt(base.years_to_maturity, 1)} г.). YTM и G-спред считаются по полному графику амортизации.</span>
    <div style="margin-top:8px;font-size:12.5px">${rows}</div></div>`));
}

const TR_RANGES = [["180", "6м"], ["365", "1г"], ["730", "2г"], ["1500", "макс"]];
const TR_STATE = {};   // isin -> days
async function loadTotalReturn(isin, node, ccy) {
  // по умолчанию «2г»: у молодой бумаги это вся история с выпуска (бэкенд обрежет по
  // дате выпуска), у старой — быстрые 2 года. «1г» прятало треть жизни молодых бумаг
  const days = TR_STATE[isin] || "730";
  const frm = new Date(Date.now() - (+days) * 864e5).toISOString().slice(0, 10);
  const ccyTag = ccy && ccy !== "RUB" ? `· <b style="color:var(--text)">в валюте выпуска (${ccy})</b>` : "· в рублях";
  node.innerHTML = `<div class="panel"><h3>Полная доходность за период <span class="muted" style="font-weight:400;font-size:12px">· цена + купоны + амортизация ${ccyTag}</span></h3>
    <div class="chips" id="tr-range" style="margin-bottom:8px">${TR_RANGES.map(([d, l]) => `<span class="chip ${d === days ? "on" : ""}" data-d="${d}">${l}</span>`).join("")}</div>
    <div id="tr-body"><div class="loading" style="padding:20px"></div></div></div>`;
  node.querySelectorAll("#tr-range .chip").forEach(c => c.onclick = () => { TR_STATE[isin] = c.dataset.d; loadTotalReturn(isin, node, ccy); });   // валюту не терять при смене периода
  let d = null;
  try { d = await fetch(`${API}/api/instrument/${isin}/total_return?frm=${frm}`).then(x => x.json()); } catch (e) { }
  const body = node.querySelector("#tr-body");
  if (!d || d.detail || !d.series?.length) { body.innerHTML = `<div class="muted">${d?.detail || "Нет данных за период"}</div>`; return; }
  const pos = d.total_return_pct >= 0;
  const mm = d.mm_series || [];
  body.innerHTML = `<div class="stat-row" style="margin-bottom:10px;gap:26px;flex-wrap:wrap">
    <div class="s"><div class="l">Полная доходность</div><div class="v" style="color:${pos ? "var(--pos,#2fe08a)" : "var(--neg,#ff5470)"}">${pct(d.total_return_pct)}</div>${d.annualized_pct != null ? `<div class="sub muted" style="font-size:12px;margin-top:2px">${pct(d.annualized_pct)} годовых</div>` : ""}</div>
    <div class="s" title="Изменение стоимости оставшегося номинала плюс выплаченная амортизация, относительно начальной цены с НКД. Возврат номинала не считается прибылью сам по себе."><div class="l">Рост цены${d.amort_pct ? " +амортиз." : ""}</div><div class="v">${pct(d.capital_pct ?? d.price_change_pct)}</div></div>
    <div class="s" title="Выплаченные купоны плюс изменение НКД, относительно начальной цены с НКД. Суммы купонов учитываются один раз, без повторного уменьшения на амортизацию."><div class="l">Купонный доход</div><div class="v">${pct(d.income_pct)}</div></div>
    ${d.amort_pct ? `<div class="s" title="Уже включён в рост цены + амортизацию и в полную доходность — повторно прибавлять не нужно."><div class="l">Возврат номинала · справочно</div><div class="v">${pct(d.amort_pct)}</div></div>` : ""}
    <div class="s"><div class="l">Период</div><div class="v" style="font-size:14px">${dmy(d.from)} → ${dmy(d.till)}${daysBetween(d.from, d.till) != null ? ` <span class="muted" style="font-size:12px">(${daysBetween(d.from, d.till)} дн.)</span>` : ""}</div></div></div>
    <div class="chart" id="tr-chart" style="height:220px"></div>`;
  mkChart(body.querySelector("#tr-chart"), {
    ...CHART_BG, tooltip: { trigger: "axis", formatter: (ps) => {
      if (!ps || !ps.length) return "";
      let s = `<div style="font-size:11px;opacity:.7">${dmyAny(ps[0].axisValue)}</div>`;
      ps.forEach(p => { s += `${p.marker}${p.seriesName}: <b>${pct(p.value ? p.value[1] : p.value)}</b><br/>`; });
      return s;
    } },
    legend: mm.length ? { top: 0, right: 6, textStyle: { color: cssVar("--muted", "#8aa"), fontSize: 10 }, itemWidth: 16, itemHeight: 8, data: ["Полная доходность", "Денежный рынок"] } : undefined,
    grid: { left: 52, right: 18, top: mm.length ? 26 : 14, bottom: 26 },
    xAxis: { type: "time", ...AX },
    yAxis: { type: "value", name: "полная доходность, %", nameTextStyle: { align: "right", padding: [0, 8, 0, 0] }, ...AX },
    series: [
      { name: "Полная доходность", type: "line", showSymbol: false, data: d.series, lineStyle: { width: 2, color: pos ? "#2fe08a" : "#ff5470" }, itemStyle: { color: pos ? "#2fe08a" : "#ff5470" },
        areaStyle: { color: pos ? "rgba(47,224,138,.10)" : "rgba(255,84,112,.10)" },
        markLine: { symbol: "none", silent: true, lineStyle: { color: cssVar("--muted", "#83968f"), type: "dashed" }, data: [{ yAxis: 0 }] } },
      ...(mm.length ? [{ name: "Денежный рынок", type: "line", showSymbol: false, data: mm, lineStyle: { width: 1.5, color: "#9aa8a3", type: "dashed" }, itemStyle: { color: "#9aa8a3" } }] : []),
    ],
  });
}

async function loadLiquidity(isin, node) {
  let d = null;
  try { d = await fetch(`${API}/api/instrument/${isin}/liquidity`).then(x => x.json()); } catch (e) { }
  if (!d || d.detail || !d.d30) { node.textContent = "Ликвидность недоступна"; return; }
  const c = LIQ_COLOR[d.liq_class] || "var(--muted)";
  const m = v => v >= 1e6 ? fmt(v / 1e6, 1) + " млн ₽" : v > 0 ? fmt(v / 1e3, 0) + " тыс ₽" : "—";
  node.innerHTML = `Ликвидность (MOEX): <b style="color:${c}">${d.liq_class}</b> · 30д ср. оборот <b style="color:var(--text)">${m(d.d30.avg_value)}</b> (медиана ${m(d.d30.median_value)}) · торговалось <b style="color:var(--text)">${d.d30.days_traded}/${d.d30.sessions}</b> сессий · ${fmt(d.d30.trades_per_day)} сдел./день · за 180д торговалось ${d.d180.days_traded}/${d.d180.sessions}`;
}

async function loadGroupEval(isin, base, panel) {
  const iss = ISSUE;             // пока грузится, пользователь мог открыть другой выпуск
  if (!iss.geData) {
    try {
      const [rc, sim] = await Promise.all([
        fetch(`${API}/api/universe/rating_curve?isin=${isin}`).then(x => x.json()).catch(() => null),
        fetch(`${API}/api/universe/similar?isin=${isin}`).then(x => x.json()).catch(() => null),
      ]);
      iss.geData = { rc, sim };
    } catch (e) { iss.geData = {}; }
  }
  if (ISSUE !== iss || !iss.ge || !panel.isConnected) return;   // карточка уже другая — не рисуем чужое
  drawGroupEval(isin, base, panel);
}

function drawGroupEval(isin, base, panel) {
  const gd = ISSUE.geData || {}, mode = ISSUE.ge.mode, ccy = base.currency;
  // Compare like with like: a FLOATER is evaluated on SIMPLE MARGIN against other
  // floaters; a FIX on YTM against the fixed-rate rating curve. Never mix them.
  const baseFloat = base.kind === "floater";
  const yOf = baseFloat ? (r => r.simple_margin_bp) : (r => r.ytm);
  const fmtY = baseFloat ? bp : pct;
  const modeGroup = (m) => {
    let g = [], cv = [], cm = null;
    if (!baseFloat && m === "by_rating" && gd.rc && gd.rc.group) {
      g = gd.rc.group; cv = gd.rc.curve || []; cm = gd.rc.comment;   // fix curve
    } else if (gd.sim) {
      g = (gd.sim[m] || []).filter(r => r.currency === ccy);         // рубли с рублями; вкл. флоатеры
    }
    // «того же эмитента» показываем ВСЕХ типов (у эмитента может не быть второго флоатера);
    // рейтинг/отрасль — только тот же тип (метрики фикса и флоатера несопоставимы)
    if (m !== "issuer") g = g.filter(r => (r.kind === "floater") === baseFloat);
    return { g, cv, cm };
  };
  let { g: group, cv: curve, cm: comment } = modeGroup(mode);
  let effMode = mode;
  // если выбранный режим пуст (напр. у NR-бумаги нет группы «тот же рейтинг») —
  // авто-переходим на первый непустой (эмитент → отрасль → рейтинг), чтобы сравнение было
  if (!group.length) {
    for (const m of ["issuer", "by_sector", "by_rating"]) {
      if (m === mode) continue;
      const r = modeGroup(m);
      if (r.g.length) { group = r.g; curve = r.cv; comment = r.cm; effMode = m; ISSUE.ge.mode = m; break; }
    }
    panel.querySelectorAll("#ge-mode .chip").forEach(c => c.classList.toggle("on", c.dataset.m === effMode));
  }
  const pf = ISSUE.ge, num = v => v === "" || v == null ? null : parseFloat(v);
  const [ymin, ymax, dmin, dmax] = [num(pf.ymin), num(pf.ymax), num(pf.dmin), num(pf.dmax)];
  group = group.filter(r => {
    const y = yOf(r), du = r.duration_years;
    if (ymin != null && (y == null || y < ymin)) return false;
    if (ymax != null && (y == null || y > ymax)) return false;
    if (dmin != null && (du == null || du < dmin)) return false;
    if (dmax != null && (du == null || du > dmax)) return false;
    return true;
  });
  const chartNode = panel.querySelector("#ge-chart"), cmtNode = panel.querySelector("#ge-comment"), tblNode = panel.querySelector("#ge-tbl");
  cmtNode.innerHTML = (effMode === "by_rating" && comment) ? `<div class="alert info">${comment}</div>` : "";
  if (!group.length) { chartNode.innerHTML = `<div class="muted" style="padding:40px;text-align:center">Нет бумаг под фильтр</div>`; tblNode.innerHTML = ""; return; }
  chartNode.innerHTML = "";
  // plot positive-yield names only; negative-YTM peers still appear in the table
  const gpts = group.filter(r => r.duration_years != null && yOf(r) != null && (baseFloat || yOf(r) > 0)).map(r => ({
    value: [r.duration_years, yOf(r)], name: r.name, isin: r.isin, rating: r.agency_rating || r.rating,
    itemStyle: { color: RATING_COLOR[r.agency_bucket || r.rating_bucket] || "#5c6f69", opacity: .55 } }));
  const self = base.duration_years != null && yOf(base) != null ? [{ value: [base.duration_years, yOf(base)], name: base.name + " (эта)" }] : [];
  const modeled = (ISSUE.geModelYtm != null && base.duration_years != null) ? [{ value: [base.duration_years, ISSUE.geModelYtm], name: "модель купона" }] : [];
  // Curve for EVERY mode: the rating fair-value curve when we have it, otherwise
  // a binned-median trend fitted through the group's own points.
  const fitLine = (effMode === "by_rating" && curve.length)
    ? curve.map(c => [c.duration, c.ytm])
    : trendCurve(gpts);
  // Fit the X axis to the data range so points don't bunch in a corner.
  const xsAll = [...gpts, ...self, ...modeled].map(p => p.value[0]).filter(x => x != null);
  const xLo = xsAll.length ? Math.min(...xsAll) : 0, xHi = xsAll.length ? Math.max(...xsAll) : 5;
  const pad = Math.max((xHi - xLo) * 0.08, 0.05);
  // явные цвета серий, чтобы значки легенды СОВПАДАЛИ с точками/линией (иначе ECharts
  // берёт палитру и «Группа»/«Кривая» показывают чужой цвет). Точки группы раскрашены
  // по рейтингу, поэтому у легенды «Группа» — нейтральный сине-серый.
  const series = [
    { name: "Группа", type: "scatter", symbolSize: 9, data: gpts, color: "#7c8b96", z: 2 },
    ...(fitLine.length ? [{ name: "Кривая", type: "line", smooth: true, symbol: "none", data: fitLine, color: "#8b7bff", lineStyle: { width: 2.5, color: "#8b7bff" }, z: 3, tooltip: { show: false } }] : []),
    { name: "Эта бумага", type: "scatter", symbolSize: 17, data: self, color: "#1fe0a0", itemStyle: { color: "#eafff6", borderColor: "#1fe0a0", borderWidth: 3, shadowBlur: 0 }, z: 5 },
    { name: "Модель купона", type: "scatter", symbol: "diamond", symbolSize: 17, data: modeled, color: "#f5b13c", itemStyle: { color: "#f5b13c", borderColor: "#0b0f10", borderWidth: 2, shadowBlur: 0 }, z: 6 },
  ];
  const c = mkChart(chartNode, {
    ...CHART_BG,
    tooltip: { trigger: "item", formatter: p => p.seriesName === "Кривая" ? `Кривая: ${fmt(p.value[0], 1)}г → ${fmtY(p.value[1])}` : `<b>${p.data.name}</b><br>${p.data.rating || ""} · дюр ${fmt(p.value[0], 2)}г · ${fmtY(p.value[1])}` },
    legend: { data: ["Группа", ...(fitLine.length ? ["Кривая"] : []), "Эта бумага", ...(modeled.length ? ["Модель купона"] : [])], top: 0, textStyle: { color: AXIS_TXT }, icon: "circle", itemWidth: 9, itemHeight: 9 },
    grid: { left: 56, right: 20, top: 34, bottom: 40 },
    xAxis: { type: "value", name: "Дюрация, лет", nameLocation: "middle", nameGap: 28, min: Math.max(0, +(xLo - pad).toFixed(2)), max: +(xHi + pad).toFixed(2), ...AX },
    yAxis: { type: "value", name: baseFloat ? "Simple margin, б.п." : "Доходность, %", scale: true, ...AX },
    series,
  });
  c.on("click", p => { if (p.data?.isin && p.data.isin !== isin) openIssue(p.data.isin); });
  // сортируемая таблица похожих выпусков (клик по заголовку)
  const gsort = ISSUE.geSort || (ISSUE.geSort = { k: "y", desc: true });
  const gval = (r, k) => ({ name: r.name || "", rating: r.rating_score ?? -1, y: (baseFloat ? flCoupon(r) : r.ytm) ?? -1e9, dur: r.duration_years ?? -1, spread: (r.kind === "floater" ? r.simple_margin_bp : r.g_spread_bp) ?? -1e9 }[k]);
  const gs = [...group].sort((a, b) => { const x = gval(a, gsort.k), y = gval(b, gsort.k); const c = typeof x === "string" ? x.localeCompare(y) : (x - y); return c * (gsort.desc ? -1 : 1); });
  const GECOLS = [["name", `Похожие выпуски (${group.length})`, "l"], ["rating", "Рейтинг", "c"], ["y", "Дох.", "c"], ["dur", "Дюр.", "c"], ["spread", "G-спред/SM", "c"]];
  const geArrow = k => gsort.k === k ? (gsort.desc ? " ▾" : " ▴") : " ⇅";
  const geth = GECOLS.map(([k, l, al]) => `<th data-gk="${k}" style="cursor:pointer;user-select:none;text-align:${al === "l" ? "left" : "center"}">${l}<span class="muted" style="font-size:10px">${geArrow(k)}</span></th>`).join("");
  const bodyR = gs.map(r => `<tr data-isin="${r.isin}"><td><span class="link">${r.name}</span></td><td>${ratingPill(r)}</td><td><b>${baseFloat ? pct(flCoupon(r)) : pct(r.ytm)}</b></td><td>${fmt(r.duration_years, 2)}</td><td class="${spreadCls(r.kind === 'floater' ? r.simple_margin_bp : r.g_spread_bp)}">${r.kind === 'floater' ? bp(r.simple_margin_bp) : bp(r.g_spread_bp)}</td></tr>`).join("");
  const t = el(`<div class="tbl-wrap" style="margin-top:12px;max-height:300px;overflow-y:auto"><table><thead><tr>${geth}</tr></thead><tbody>${bodyR}</tbody></table></div>`);
  t.querySelectorAll("th[data-gk]").forEach(h => h.onclick = () => { const k = h.dataset.gk; if (gsort.k === k) gsort.desc = !gsort.desc; else { gsort.k = k; gsort.desc = true; } drawGroupEval(isin, base, panel); });
  t.querySelectorAll("tr[data-isin]").forEach(tr => tr.onclick = (e) => { if (e.target.closest("th")) return; openIssue(tr.dataset.isin); });
  tblNode.innerHTML = ""; tblNode.appendChild(t);
}


// binned-median trend line through scatter points [{value:[x,y]}] → [[x,y]...]
function trendCurve(pts) {
  const xs = pts.map(p => p.value[0]).filter(x => x != null);
  if (xs.length < 4) return [];
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const nb = 6, step = (hi - lo) / nb || 1, out = [];
  for (let i = 0; i <= nb; i++) {
    const cx = lo + step * i;
    const ys = pts.filter(p => Math.abs(p.value[0] - cx) <= step * 0.75).map(p => p.value[1]).sort((a, b) => a - b);
    if (ys.length >= 2) out.push([+cx.toFixed(3), +ys[Math.floor(ys.length / 2)].toFixed(2)]);
  }
  return out.length >= 2 ? out : [];
}

// ---------- small utils ----------
function toggle(set, val) { set.has(val) ? set.delete(val) : set.add(val); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---------- новая версия сайта ----------
// Сайт — одностраничный: открытая вкладка живёт на том коде, с которым загрузилась, и новых
// разделов после выкладки не видит. Раз в 5 минут и при возврате на вкладку сверяем версию
// скрипта с сервером и предлагаем обновиться.
function watchVersion() {
  const cur = ((document.querySelector('script[src*="app.js"]') || {}).src || "").match(/v=(\d+)/);
  if (!cur) return;
  let shown = false;
  const check = async () => {
    if (shown || document.hidden) return;
    try {
      const html = await fetch(`/?_=${Date.now()}`, { cache: "no-store" }).then(r => r.ok ? r.text() : "");
      const v = (html.match(/app\.js\?v=(\d+)/) || [])[1];
      if (!v || v === cur[1]) return;
      shown = true;
      const b = el(`<div class="upd-bar" role="status"><span>Вышло обновление сайта</span><button class="btn">Обновить</button><button class="upd-x" aria-label="Скрыть">×</button></div>`);
      b.querySelector(".btn").onclick = () => location.reload();
      b.querySelector(".upd-x").onclick = () => b.remove();
      document.body.appendChild(b);
    } catch (e) { }
  };
  setInterval(check, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", check);
}

// ---------- подготовка карточки выпуска при наведении ----------
// Курсор задержался на строке с выпуском — просим сервер заранее подтянуть с биржи историю,
// средние спреды, погашения, новости, ликвидность и группу сравнения. К клику всё уже в кэше сервера, и карточка
// открывается сразу. Только для мыши (на телефоне наведения нет) и не больше 40 бумаг за визит.
function watchIssueHover() {
  if (!window.matchMedia || !matchMedia("(hover: hover)").matches) return;
  const done = new Set();
  let timer = null, cur = null;
  document.addEventListener("mouseover", (e) => {
    const n = e.target.closest && e.target.closest("[data-isin]");
    const isin = n && n.dataset.isin;
    if (isin === cur) return;
    cur = isin; clearTimeout(timer);
    if (!isin || done.has(isin) || done.size >= 40 || !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return;
    timer = setTimeout(() => {
      done.add(isin);
      // «Полная доходность» — с тем же периодом по умолчанию (2 года), что запросит карточка
      const trFrm = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);
      const urls = ["history", "peers_history", "schedule", "news", "liquidity", `total_return?frm=${trFrm}`]
        .map(p => `/api/instrument/${isin}/${p}`).concat([`/api/universe/rating_curve?isin=${isin}`, `/api/universe/similar?isin=${isin}`]);
      for (const u of urls) fetch(`${API}${u}`, { priority: "low" }).catch(() => { });
    }, 150);
  }, { passive: true });
}

boot();
watchVersion();
// Read the shared hourly server cache; never launch a market POST per browser.
function refreshVisibleIndicesIfDue() {
  if (document.hidden || TAB !== 'indices' || document.querySelector('dialog[open],.modal-ov')) return;
  const data = INDEX_PAGE.cache[`${INDEX_PAGE.asset}|${indexGroup()}|${INDEX_PAGE.period}`];
  if (!data || data._cacheHour !== Math.floor(Date.now() / 3600000)) render();
}
setInterval(refreshVisibleIndicesIfDue, 60000);
document.addEventListener('visibilitychange', refreshVisibleIndicesIfDue);
watchIssueHover();
