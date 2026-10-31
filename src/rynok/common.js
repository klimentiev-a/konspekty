/* Общие функции страниц «Рынок: что шарить» (rynok-1…5.html). Данные D вставляет build.py. */
var D = /*DATA*/;
(function () {
  var r = document.documentElement;
  try { var t = localStorage.getItem('theme'); if (t === 'dark' || t === 'light') r.setAttribute('data-theme', t); } catch (e) {}
})();
var R = {
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); },
  src: {},
  num: function (v, d) { return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }); },
  pct: function (v) { if (v == null || isNaN(v)) return ''; return (v > 0 ? '+' : v < 0 ? '−' : '') + R.num(Math.abs(v), 2) + '%'; },
  links: function (ids, cls) {
    return (ids || []).map(function (id) { var s = R.src[id]; if (!s) return '';
      var host = ''; try { host = new URL(s.u).hostname.replace(/^www\./, ''); } catch (e) {}
      return '<a class="' + (cls || 'srcl') + '" href="' + R.esc(s.u) + '" target="_blank" rel="noopener" title="' + R.esc(s.t) + '">' + R.esc(host) + '</a>'; }).join('');
  },
  region: function (x) { return x === 'ru' ? 'Россия' : 'Мир'; },
  days: function (iso) { var t = new Date(iso + 'T12:00:00+03:00') - new Date(); return Math.ceil(t / 864e5); },
  dateRu: function (iso) { var m = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']; var p = iso.split('-'); return (+p[2]) + ' ' + m[+p[1] - 1]; },
  dateShort: function (iso) { var p = iso.split('-'); return p[2] + '.' + p[1]; },
  get: function (m, l) {
    try {
      var k = l[1], x;
      if (l[0] === 'idx') { x = m.idx[k]; return x && { txt: R.num(x.v, 1), ch: x.ch }; }
      if (l[0] === 'fx') { x = m.fx.Valute[k]; return x && { txt: R.num(x.Value, 2) + ' ₽', ch: (x.Value / x.Previous - 1) * 100 }; }
      if (l[0] === 'kbd') { x = (m.kbd.pts || []).filter(function (p) { return p[0] === k; })[0]; return x && { txt: R.num(x[1], 2) + '%', ch: null }; }
      if (l[0] === 'energy') { x = m.energy[k]; return x && { txt: '$' + R.num(x.p, 1), ch: x.ch }; }
      if (l[0] === 'us') { x = m.us[k]; return x && { txt: R.num(x.p, 0), ch: x.ch }; }
      if (l[0] === 'crypto') { x = (m.crypto || []).filter(function (c) { return c.s === k; })[0]; return x && { txt: '$' + R.num(x.p, 0), ch: x.c24 }; }
    } catch (e) {}
    return null;
  },
  /* Живые цены из markets.json (обновляется каждый час). cb({id:{txt,ch}}, 'дата') */
  live: function (cb) {
    var ctl = window.AbortController ? new AbortController() : null;
    if (ctl) setTimeout(function () { ctl.abort(); }, 6000);
    fetch('markets.json?t=' + Math.floor(Date.now() / 6e5), ctl ? { signal: ctl.signal } : {}).then(function (r) { return r.json(); }).then(function (m) {
      var o = {}; D.kpi.forEach(function (k) { if (k.live) { var v = R.get(m, k.live); if (v) o[k.id] = v; } });
      cb(o, m.updated || '');
    }).catch(function () { cb(null, ''); });
  },
  themeBtn: function (b) {
    function cur() { var a = document.documentElement.getAttribute('data-theme'); if (a) return a; return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
    function lab() { b.textContent = cur() === 'dark' ? '☀' : '☾'; b.title = cur() === 'dark' ? 'Светлая тема' : 'Тёмная тема'; }
    lab();
    b.addEventListener('click', function () { var n = cur() === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n); try { localStorage.setItem('theme', n); } catch (e) {} lab(); });
  },
  copy: function (txt, el) {
    function ok() { if (el) { var o = el.textContent; el.textContent = 'Скопировано'; setTimeout(function () { el.textContent = o; }, 1300); } }
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(ok, function () {}); else ok();
  }
};
D.sources.forEach(function (s) { R.src[s.id] = s; });
/* Верхняя полоса: «Назад» к выбору вариантов + переключатель 1–5 (видна сразу, без прокрутки) */
(function () {
  function go() {
    if (document.getElementById('rnav')) return;
    var m = location.pathname.match(/rynok-(\d)\.html$/), cur = m ? +m[1] : 0;
    var st = document.createElement('style');
    st.textContent = '#rnav{display:flex;align-items:center;gap:8px;flex-wrap:wrap;max-width:1280px;margin:0 auto;padding:12px 18px 0;font:500 14px/1 "IBM Plex Sans",system-ui,sans-serif}' +
      '#rnav a{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 13px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--fg);text-decoration:none}' +
      '#rnav a:hover{border-color:var(--faint)}#rnav .bk{font-weight:600}#rnav .sp{flex:1}#rnav .lb{color:var(--muted);font-size:13px}' +
      '#rnav .v{min-width:36px;justify-content:center;padding:0 10px;font-weight:600}#rnav .v.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}' +
      '@media(max-width:520px){#rnav .lb{display:none}}';
    document.head.appendChild(st);
    var n = document.createElement('nav'); n.id = 'rnav'; n.setAttribute('aria-label', 'Навигация');
    var h = '<a class="bk" href="rynok.html" title="К выбору вариантов">← Назад</a><span class="sp"></span><span class="lb">Вариант</span>';
    for (var i = 1; i <= 5; i++) h += '<a class="v' + (i === cur ? ' on' : '') + '" href="rynok-' + i + '.html"' + (i === cur ? ' aria-current="page"' : '') + '>' + i + '</a>';
    n.innerHTML = h; document.body.insertBefore(n, document.body.firstChild);
  }
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
})();
