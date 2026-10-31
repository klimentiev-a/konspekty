/* Страница «Рынок: что шарить» (rynok.html). Данные D вставляет build.py из content.json. */
var D = /*DATA*/;
(function () {
  try { var t = localStorage.getItem('theme'); if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t); } catch (e) {}
})();
var R = {
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); },
  src: {},
  num: function (v, d) { return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }); },
  pct: function (v) { if (v == null || isNaN(v)) return ''; return (v > 0 ? '+' : v < 0 ? '−' : '') + R.num(Math.abs(v), 2) + '%'; },
  cls: function (v) { return v == null || isNaN(v) ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : ''; },
  links: function (ids) {
    return (ids || []).map(function (id) { var s = R.src[id]; if (!s) return '';
      var host = ''; try { host = new URL(s.u).hostname.replace(/^www\./, ''); } catch (e) {}
      return '<a class="srcl" href="' + R.esc(s.u) + '" target="_blank" rel="noopener" title="' + R.esc(s.t) + '">' + R.esc(host) + '</a>'; }).join('');
  },
  region: function (x) { return x === 'ru' ? 'Россия' : 'Мир'; },
  days: function (iso) { return Math.ceil((new Date(iso + 'T12:00:00+03:00') - new Date()) / 864e5); },
  dateRu: function (iso) { var m = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']; var p = iso.split('-'); return (+p[2]) + ' ' + m[+p[1] - 1]; },
  ago: function (iso) { var m = (Date.now() - new Date(iso)) / 6e4; if (m < 60) return Math.max(1, Math.round(m)) + ' мин назад'; if (m < 1440) return Math.round(m / 60) + ' ч назад';
    var d = new Date(iso); return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); },
  get: function (m, l) {
    try {
      var k = l[1], x;
      if (l[0] === 'idx') { x = m.idx[k]; return x && { txt: R.num(x.v, 1), ch: x.ch }; }
      if (l[0] === 'fx') { x = m.fx.Valute[k]; return x && { txt: R.num(x.Value / (x.Nominal || 1), 2) + ' ₽', ch: (x.Value / x.Previous - 1) * 100 }; }
      if (l[0] === 'kbd') { x = (m.kbd.pts || []).filter(function (p) { return p[0] === k; })[0]; return x && { txt: R.num(x[1], 2) + '%', ch: null }; }
      if (l[0] === 'energy') { x = m.energy[k]; return x && { txt: (x.u && x.u.indexOf('$') === 0 ? '$' : '') + R.num(x.p, x.p < 10 ? 2 : 1), ch: x.ch }; }
      if (l[0] === 'us') { x = m.us[k]; return x && { txt: R.num(x.p, x.p < 1000 ? 2 : 0), ch: x.ch }; }
      if (l[0] === 'ru') { x = m.ru[k]; return x && { txt: R.num(x.p, x.p < 10 ? 3 : x.p < 1000 ? 2 : 1) + ' ₽', ch: x.ch }; }
      if (l[0] === 'crypto') { x = (m.crypto || []).filter(function (c) { return c.s === k; })[0]; return x && { txt: '$' + R.num(x.p, x.p < 10 ? 2 : 0), ch: x.c24 }; }
    } catch (e) {}
    return null;
  },
  getJSON: function (u, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    if (ctl) setTimeout(function () { ctl.abort(); }, ms || 7000);
    return fetch(u + (u.indexOf('?') < 0 ? '?' : '&') + 't=' + Math.floor(Date.now() / 6e5), ctl ? { signal: ctl.signal } : {}).then(function (r) { if (!r.ok) throw 0; return r.json(); });
  },
  themeBtn: function (b) {
    function cur() { var a = document.documentElement.getAttribute('data-theme'); if (a) return a; return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
    function lab() { b.textContent = cur() === 'dark' ? '☀' : '☾'; b.title = cur() === 'dark' ? 'Светлая тема' : 'Тёмная тема'; }
    lab();
    b.addEventListener('click', function () { var n = cur() === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n); try { localStorage.setItem('theme', n); } catch (e) {} lab(); });
  }
};
D.sources.forEach(function (s) { R.src[s.id] = s; });
