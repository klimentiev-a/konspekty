/* Hub service worker.
   Страницы и картинки — сразу из кэша (мгновенно), а в фоне проверяется новая версия; если она вышла — странице приходит сигнал «обновлено».
   Данные (*.json) — сначала сеть (свежие котировки и новости), если сеть не ответила за 4 с — из кэша.
   Шрифты Google и история цен с GitHub — из кэша с фоновым обновлением. */
const V = 'hub-v218', STATIC = V + '-static', DATA = 'hub-data', EXT = 'hub-ext';
const CORE = ['./', 'index.html', 'artem.html', 'nastya.html', 'ucheba.html', 'finance.html', 'politika.html', 'fin-english.html', 'manifest.webmanifest', 'icon-192.png?v=31', 'apple-touch-icon.png?v=31'];

// офлайн: страницы, библиотеки и данные карты/расписания/рынков кладём в кэш заранее
const WARM_STATIC = ['sync.js', 'tables.js', 'english.html', 'energy.html', 'nastya-ucheba.html', 'vendor/d3.min.js', 'vendor/topojson-client.min.js'];
const WARM_JSON = ['quiz.json', 'world.json', 'world/countries.json', 'world/regions/index.json', 'schedule.json', 'schedule_nastya.json', 'markets.json', 'world/mcap.json', 'news.json', 'news_text.json', 'search-index.json', 'digest.json', 'corp_cal.json', 'fin.json', 'svodka.json'];
async function warm() {
  const sc = await caches.open(STATIC), dc = await caches.open(DATA);
  await Promise.allSettled(CORE.concat(WARM_STATIC).map(async u => { const r = await fetch(u, { cache: 'no-cache' }); if (r.ok) await sc.put(u, r); }));
  const put = async u => { const r = await fetch(u, { cache: 'no-cache' }); if (r.ok) { const k = new URL(u, location.href); await dc.put(k.origin + k.pathname, await stamp(r)); } };
  await Promise.allSettled(WARM_JSON.map(put));
  try {
    const ix = await (await fetch('world/regions/index.json')).json(), f = [];
    ix.layers.forEach(l => { f.push('world/regions/' + l.id + '.json', 'world/regions/geo/' + l.id + '.json'); if (l.companies) f.push('world/companies/' + l.companies + '.json', 'world/companies/' + l.companies + '-detail.json'); if (l.sectors) f.push('world/regions/' + l.sectors + '.json'); });
    (ix.cos || []).forEach(c => f.push('world/companies/' + c.id + '.json', 'world/companies/' + c.id + '-detail.json'));
    f.push('world/wages.json', 'world/tax.json', 'world/politics.json');
    await Promise.allSettled(f.map(put));
  } catch (e) {}
}
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(STATIC).then(c => c.addAll(CORE)).catch(() => {}).then(() => warm()).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => ![STATIC, DATA, EXT].includes(x)).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});

// GitHub Pages пересобирает сайт каждый час (обновление новостей) и меняет ETag у всех файлов,
// поэтому «новая версия» определяется по содержимому, а не по заголовкам.
async function changed(oldRes, newRes) {
  try { const [a, b] = await Promise.all([oldRes.clone().text(), newRes.clone().text()]); return a !== b; } catch (e) { return false; }
}

// страница могла ещё не успеть открыться, когда пришла новая версия, — запоминаем и отвечаем на её вопрос «я свежая?»
const UPDATED = new Map();   // путь → когда пришла новая версия
function pth(u) { const p = new URL(u).pathname; return p.endsWith('/') ? p + 'index.html' : p; }
async function notify(url) {
  UPDATED.set(pth(url), Date.now());
  const cs = await self.clients.matchAll({ type: 'window' });
  cs.forEach(c => { if (pth(c.url) === pth(url)) c.postMessage({ t: 'hub-updated', url }); });
}
self.addEventListener('message', e => {
  if (e.data && e.data.t === 'hub-warm') { e.waitUntil(warm()); return; }
  if (!e.data || e.data.t !== 'hub-check' || !e.source) return;
  const t = UPDATED.get(pth(e.data.url));
  if (t && Date.now() - t < 20000) { UPDATED.delete(pth(e.data.url)); e.source.postMessage({ t: 'hub-updated', url: e.data.url }); }
});

// кэш сразу, сеть в фоне
async function swr(ev, req, cacheName, watch) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: false });
  const old = hit && watch ? hit.clone() : null;   // копия до того, как страница прочитает ответ
  const net = fetch(req, { cache: 'no-cache' }).then(async res => {
    if (res && (res.ok || res.type === 'opaque')) {
      if (old && await changed(old, res)) notify(req.url);
      await cache.put(req, res.clone());
    }
    return res;
  }).catch(() => null);
  if (hit) { ev.waitUntil(net); return hit; }
  const res = await net;
  if (res) return res;
  if (req.mode === 'navigate') return (await caches.match('index.html')) || Response.error();
  return Response.error();
}

// данные (*.json): если в кэше свежая копия (моложе 10 минут) — отдаём сразу и обновляем фоном;
// иначе сеть, но ждём не дольше 1,5 с, потом кэш
async function stamp(res) {
  const h = new Headers(res.headers); h.set('x-sw-time', String(Date.now()));
  return new Response(await res.clone().blob(), { status: res.status, statusText: res.statusText, headers: h });
}
async function nf(ev, req, cacheName, ms) {
  const cache = await caches.open(cacheName);
  const u = new URL(req.url), key = u.origin + u.pathname;   // ?t=… не плодит копии в кэше
  const hit = await cache.match(key);
  const net = fetch(req, { cache: 'no-cache' }).then(async res => { if (res && res.ok) await cache.put(key, await stamp(res)); return res; });
  net.catch(() => {});
  if (hit && Date.now() - (+hit.headers.get('x-sw-time') || 0) < 10 * 60 * 1000) { ev.waitUntil(net.catch(() => {})); return hit; }
  const timeout = new Promise(r => setTimeout(() => r(null), ms));
  const first = await Promise.race([net.catch(() => null), timeout]);
  if (first) return first;
  if (hit) { ev.waitUntil(net.catch(() => {})); return hit; }
  try { return await net; } catch (e) { return Response.error(); }
}

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    if (/\.json$/.test(u.pathname)) { e.respondWith(nf(e, r, DATA, 1500)); return; }
    e.respondWith(swr(e, r, STATIC, r.mode === 'navigate' || /\.html$|\/$/.test(u.pathname)));
    return;
  }
  if (u.hostname === 'raw.githubusercontent.com' && /news-live\.json$/.test(u.pathname)) return;   // живая лента — всегда из сети, без кэша
  if (u.hostname === 'raw.githubusercontent.com' && /\/fin2-data\//.test(u.pathname)) { e.respondWith(nf(e, r, DATA, 4000)); return; }   // «Финансы 2»: снимок рынка — сначала сеть
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com' || u.hostname === 'raw.githubusercontent.com') {
    e.respondWith(swr(e, r, EXT, false));
  }
});
