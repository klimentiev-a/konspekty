// Запуск: python3 -m http.server 8765 & NODE_PATH=$(npm root -g) node tests/crawl.js [страницы через запятую] [ширины через запятую]
// Полный обход сайта: все страницы и все внутренние #-маршруты, 1280 и 390 px.
// Проверки: ошибки JS/консоли, 4xx/5xx своих ресурсов, страница шире экрана, элементы за краем,
// текст вылезает из своей коробки, наложение кнопок/ссылок друг на друга, undefined/NaN в тексте, битые ссылки.
const { chromium } = require('playwright');
const fs = require('fs'), crypto = require('crypto');
const ROOT = require('path').resolve(__dirname, '..') + '/';
const B = process.env.CRAWL_BASE || 'http://127.0.0.1:8765/';   // сайт отдаёт: python3 -m http.server 8765 (из корня репозитория)
const src = fs.readFileSync(ROOT + 'src/finance/make_hub.py', 'utf8');
const prof = [...src.matchAll(/'(\w+)': \('[^']+', '(\d+)'/g)].map(m => [m[1], m[2]]);
const AUTH = prof.map(([p, pw]) => `localStorage.setItem('hub:auth:${p}','${crypto.createHash('sha256').update(`hub:${p}:${pw}`).digest('hex').slice(0, 24)}')`).join(';');
const START = ['index.html', 'artem.html', 'nastya.html', 'nastya-ucheba.html', 'ucheba.html', 'finance.html', 'politika.html',
  'english.html', 'fin-english.html', 'energy.html', 'search.html', 'search.html?q=wacc', 'slovar.html', 'fin2/index.html', 'fin2/akcii.html'];
const ONLY = process.argv[2] ? process.argv[2].split(',') : null;
const WIDTHS = process.argv[3] ? process.argv[3].split(',').map(Number) : [1280, 390];
const MAXR = +(process.env.CRAWL_MAX || 700);
const IGN = /Failed to fetch|NetworkError|Load failed|ResizeObserver|ERR_TUNNEL|ERR_FAILED|ERR_NAME|ERR_INTERNET|ERR_CONNECTION|net::|CORS|Access-Control|status of 4\d\d|status of 5\d\d|iss\.moex|mymemory|wikipedia|api\.|raw\.githubusercontent|favicon/i;

const CHECK = () => {
  const vw = innerWidth, out = { docW: document.documentElement.scrollWidth, stick: [], spill: [], overlap: [], bad: [] };
  const vis = el => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const clipped = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) || /(auto|scroll|hidden|clip)/.test(s.overflow)) return true; } return false; };
  const name = el => { let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; else if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.'); const t = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30); return t ? `${s} «${t}»` : s; };
  const all = [...document.body.querySelectorAll('*')];
  for (const el of all) {
    if (/^(SCRIPT|STYLE|SVG|PATH|G|DEFS|OPTION|BR|CANVAS)$/i.test(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 && r.left < vw && out.stick.length < 4) { if (vis(el) && !clipped(el) && !(el.closest('details:not([open])') && !el.closest('summary')) && getComputedStyle(el).position !== 'fixed') out.stick.push(name(el) + ` R=${Math.round(r.right)}`); }
    // текст вылезает из своей коробки
    const direct = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (direct && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 3 && out.spill.length < 4) {
      const s = getComputedStyle(el);
      if (s.overflowX === 'visible' && s.textOverflow !== 'ellipsis' && s.display !== 'inline' && vis(el) && !clipped(el) && !(el.closest('details:not([open])') && !el.closest('summary'))) out.spill.push(name(el) + ` ${el.scrollWidth}>${el.clientWidth}`);
    }
  }
  // наложения интерактивных элементов
  // видимая часть элемента с учётом обрезки предками (overflow hidden/auto, свёрнутые блоки)
  const clipR = el => { let r = el.getBoundingClientRect(); let L = r.left, T = r.top, R = r.right, Bt = r.bottom;
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) { const s = getComputedStyle(p); if (s.overflow !== 'visible' || s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.contentVisibility === 'hidden') { const q = p.getBoundingClientRect(); L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); Bt = Math.min(Bt, q.bottom); } if (p.tagName === 'DETAILS' && !p.open && !el.closest('summary')) return null; }
    return R - L > 4 && Bt - T > 4 ? { left: L, top: T, right: R, bottom: Bt, width: R - L, height: Bt - T } : null; };
  const ctrls = [...document.querySelectorAll('a,button,input,select,textarea,[role=button],.chip,.tab')].filter(el => vis(el)).map(el => [el, clipR(el)]).filter(([, r]) => r);
  const fixedOf = el => { for (let p = el; p; p = p.parentElement) { const s = getComputedStyle(p).position; if (s === 'fixed' || s === 'sticky') return p; } return null; };
  const fx = new Map(ctrls.map(([el]) => [el, fixedOf(el)]));
  for (let i = 0; i < ctrls.length && out.overlap.length < 5; i++) for (let j = i + 1; j < ctrls.length && out.overlap.length < 5; j++) {
    const [a, ra] = ctrls[i], [b, rb] = ctrls[j];
    if (a.contains(b) || b.contains(a)) continue;
    if (fx.get(a) !== fx.get(b)) continue;
    const inside = (x, y) => x.left <= y.left + 1 && x.right >= y.right - 1 && x.top <= y.top + 1 && x.bottom >= y.bottom - 1;
    if (inside(ra, rb) || inside(rb, ra)) continue;   // ссылка-подложка на всю карточку
    // ссылки, перенесённые на две строки: общая рамка пересекается, а сами строки нет — сравниваем по строкам
    const lines = el => getComputedStyle(el).display.startsWith('inline') && el.getClientRects().length > 1 ? [...el.getClientRects()] : null;
    const la = lines(a), lb = lines(b);
    if (la || lb) { const A = la || [ra], Bb = lb || [rb]; if (!A.some(x => Bb.some(y => Math.min(x.right, y.right) - Math.max(x.left, y.left) > 3 && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 3))) continue; }               // плавающая кнопка над контентом — не наложение вёрстки
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (w > 3 && h > 3 && w * h > 0.25 * Math.min(ra.width * ra.height, rb.width * rb.height)) {
      const ea = document.elementFromPoint(Math.max(ra.left, rb.left) + w / 2, Math.max(ra.top, rb.top) + h / 2);
      out.overlap.push(name(a) + ' × ' + name(b));
    }
  }
  const txt = document.body.innerText;
  const m = txt.match(/[^\n]{0,30}\b(undefined|NaN|\[object Object\]|Infinity)\b[^\n]{0,30}/g);
  if (m) out.bad = m.slice(0, 3);
  out.links = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
  out.txtLen = txt.length;
  return out;
};

(async () => {
  const br = await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium', args: ['--headless=new'] } : {});
  const report = [], pagesSeen = new Set(), brokenLinks = new Map();
  for (const vw of WIDTHS) {
    const ctx = await br.newContext({ viewport: { width: vw, height: 860 }, serviceWorkers: 'block' });
    await ctx.addInitScript(`try{${AUTH};sessionStorage.setItem('bonds_splash_seen','1')}catch(e){}`);
    await ctx.route(/^(?!http:\/\/127\.0\.0\.1)/, r => r.abort());    // внешняя сеть всё равно недоступна — не ждём таймаутов
    const pg = await ctx.newPage();
    let errs = [], bad = [];
    pg.on('pageerror', e => errs.push('JS ' + String(e.message).slice(0, 160)));
    pg.on('console', m => { if (m.type() === 'error' && !IGN.test(m.text())) errs.push('C ' + m.text().slice(0, 160)); });
    pg.on('response', r => { const u = r.url(); if (r.status() >= 400 && u.startsWith(B)) bad.push(r.status() + ' ' + u.slice(B.length, B.length + 80)); });
    pg.on('dialog', d => d.dismiss().catch(() => { }));
    for (const start of (ONLY || START)) {
      const queue = [start], seen = new Set([start]);
      let n = 0;
      while (queue.length && n < MAXR) {
        const u = queue.shift(); n++;
        errs = []; bad = [];
        try {
          const samePage = u.split('#')[0] === (pg.url().slice(B.length).split('#')[0]) && u.includes('#');
          if (samePage) { await pg.evaluate(h => { location.hash = h; }, u.split('#')[1]); }
          else await pg.goto(B + u, { waitUntil: 'load', timeout: 30000 });
          await pg.waitForTimeout(/markets|world|fin2|politika|energy/.test(u) ? 1500 : 450);
          await pg.evaluate(() => window.scrollTo(0, 0));
          const r = await pg.evaluate(CHECK);
          const issues = [];
          if (errs.length) issues.push('ОШИБКИ ' + JSON.stringify([...new Set(errs)].slice(0, 3)));
          if (bad.length) issues.push('404 ' + JSON.stringify([...new Set(bad)].slice(0, 3)));
          if (r.docW > vw + 2) issues.push(`ШИРЕ ЭКРАНА ${r.docW}`);
          if (r.stick.length) issues.push('ЗА КРАЕМ ' + JSON.stringify(r.stick));
          if (r.spill.length) issues.push('ВЫЛЕЗАЕТ ' + JSON.stringify(r.spill));
          if (r.overlap.length) issues.push('НАЛОЖЕНИЕ ' + JSON.stringify(r.overlap));
          if (r.bad.length) issues.push('ТЕКСТ ' + JSON.stringify(r.bad));
          if (r.txtLen < 40) issues.push('ПУСТО ' + r.txtLen);
          if (issues.length) report.push(`${vw} ${u}\n   ${issues.join('\n   ')}`);
          const base = u.split('#')[0];
          for (const h of r.links) {
            if (!h || /^(mailto|tel|javascript|data|blob)/i.test(h)) continue;
            if (/^https?:/i.test(h)) continue;
            let next;
            if (h.startsWith('#')) { if (h.length < 2) continue; next = base + h; }
            else { const abs = new URL(h, B + u); if (!abs.href.startsWith(B)) continue; next = abs.href.slice(B.length); if (!next.split('#')[0].split('?')[0]) next = 'index.html'; const f = next.split('#')[0].split('?')[0]; if (!pagesSeen.has(f)) { pagesSeen.add(f); if (!fs.existsSync(ROOT + decodeURIComponent(f))) brokenLinks.set(f, u); } if (next.split('#')[0] !== base.split('#')[0]) continue; }
            if (!seen.has(next)) { seen.add(next); queue.push(next); }
          }
        } catch (e) { report.push(`${vw} ${u}\n   СБОЙ ${String(e.message).slice(0, 160)}`); }
      }
      console.error(`${vw} ${start}: маршрутов ${n}${queue.length ? ' (+' + queue.length + ' не обойдено)' : ''}`);
    }
    await ctx.close();
  }
  await br.close();
  for (const [f, from] of brokenLinks) report.push(`БИТАЯ ССЫЛКА ${f} (со страницы ${from})`);
  fs.writeFileSync(process.env.CRAWL_OUT || 'crawl.out', report.join('\n') + '\n');
  console.error('итого проблемных маршрутов:', report.length);
})();
