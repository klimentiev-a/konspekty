#!/usr/bin/env python3
"""Главная Hub с профилями. Из шаблона src/finance/hub.html (стили, масштаб, подсказка об установке) собирает:
  index.html         — выбор профиля (Артем / Настя) и ввод пароля;
  artem.html         — разделы Артема: Учёба и Финансы;
  nastya.html        — разделы Насти: Учёба, English;
  nastya-ucheba.html — Учёба Насти (пока пусто).
Пароль сверяется по SHA-256 (в коде лежит только хэш), после ввода запоминается в localStorage и куки на год.
Это замок от случайных посетителей: файлы сайта всё равно лежат в открытом репозитории.
Запуск из корня репозитория: python3 src/finance/make_hub.py"""
import hashlib, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'src', 'logo'))
import hub as LOGO   # логотип: знак h и надпись hub рисуются одними линиями
# надпись «hub» для заголовка: «ub» цветом текста, «h» — фирменным изумрудом (цвета задаются CSS, тема меняется сама)
WORD = LOGO.wordmark('#25221C', 'hub', first='#0A9466').replace('<svg ', '<svg class="wm" role="img" aria-label="Hub" ', 1)
TPL = open(os.path.join(ROOT, 'src', 'finance', 'hub.html'), encoding='utf-8').read()
_zj = open(os.path.join(ROOT, 'src', 'finance', 'zoom.js'), encoding='utf-8').read()
ZQ_JS = '<script>' + _zj[_zj.index('/* Hub: полосы прокрутки'):] + '</script>'
_zold = "w.__t=t;w.style.transform='translate('+t[0]+'px,'+t[1]+'px)'}},true);"
_znew = "w.__t=t;w.style.transition='none';w.style.transform='translate('+t[0]+'px,'+t[1]+'px)'}\n  if(w&&w.__t){clearTimeout(w.__tm);w.__tm=setTimeout(function(){w.style.transition='transform .25s';w.style.transform='';w.__t=null},1400)}},true);"
TPL = TPL.replace(_zold, _znew).replace(".zm,.zmr,.skinmenu{zoom:var(--iz,1)}", ".zm,.zmr,.skinmenu,.zq{zoom:var(--iz,1)}")
PROF = {'artem': ('Артем', '11231', 'artem.html'), 'nastya': ('Настя', '1591', 'nastya.html')}
TOK = {p: hashlib.sha256(('hub:%s:%s' % (p, v[1])).encode()).hexdigest()[:24] for p, v in PROF.items()}

head = TPL[:TPL.index('<body>')]
tail_js = TPL[TPL.index('<script>\ntry{var t=localStorage.getItem'):TPL.index('</body>')]
foot = re.search(r'<p class="foot".*?</p>', TPL, re.S).group(0)


def gate(p):
    """Скрипт в самом начале <head>: без пароля — на главную, к вводу пароля, потом обратно."""
    return ("<script>(function(){var P='%s',T='%s';function ok(){try{if(localStorage.getItem('hub:auth:'+P)===T)return true}catch(e){}"
            "return document.cookie.indexOf('hub_'+P+'='+T)>=0}"
            "if(!ok()){document.documentElement.style.visibility='hidden';var f=location.pathname.slice(location.pathname.lastIndexOf('/')+1)||'index.html';"
            "location.replace('index.html?login='+P+'&next='+encodeURIComponent(f+location.search+location.hash))}"
            "else{try{localStorage.setItem('hub:auth:'+P,T);localStorage.setItem('hub:last',P)}catch(e){}}})();</script>") % (p, TOK[p])


EXTRA_CSS = """<style>
.top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin:-28px 0 26px}
.top a,.top button{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--muted);font:500 13.5px/1 'IBM Plex Sans',system-ui,sans-serif;text-decoration:none;cursor:pointer}
.top a:hover,.top button:hover{color:var(--fg);border-color:var(--faint)}
.prof .card{font:inherit;text-align:left;cursor:pointer;color:inherit;min-height:170px}
.av{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;font:600 24px/1 'Literata',Georgia,serif;color:var(--surface)}
.av.a{background:var(--a1)}.av.n{background:#7A5CC2}
:root[data-theme="dark"] .av.n{background:#A58BE8}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .av.n{background:#A58BE8}}
.lock{position:absolute;top:18px;right:18px;display:inline-flex;align-items:center;gap:6px;color:var(--faint);font-size:12.5px}
.lock svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.lock.open{color:var(--a2)}
.empty{margin-top:30px;padding:38px 24px;border:1px dashed var(--line);border-radius:18px;text-align:center;color:var(--muted)}
.empty .ic{font:600 34px/1 'Literata',Georgia,serif;color:var(--faint);margin-bottom:10px}
h1.brand{line-height:0;margin:4px 0 14px}h1.brand .wm{height:clamp(52px,12vw,76px);width:auto;display:block}.wm [stroke=\"#25221C\"]{stroke:var(--fg)}.wm [fill=\"#25221C\"]{fill:var(--fg)}:root[data-theme=dark] .wm [stroke=\"#0A9466\"]{stroke:#2FD69C}:root[data-theme=dark] .wm [fill=\"#0A9466\"]{fill:#2FD69C}@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .wm [stroke=\"#0A9466\"]{stroke:#2FD69C}:root:not([data-theme=light]) .wm [fill=\"#0A9466\"]{fill:#2FD69C}}
/* переключатель темы */
.top .tr{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;align-items:center}
.thm{flex:none;width:36px;height:36px;padding:0!important;justify-content:center;border:1px solid var(--line);border-radius:50%;background:var(--surface);color:var(--muted);display:grid;place-items:center;cursor:pointer}
.thm svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2}
.thm:hover{color:var(--fg)}
/* сводка «Сегодня» */
.today{display:grid;grid-template-columns:1.2fr 1fr 1.2fr;gap:12px;margin:26px 0 4px}
@media (max-width:820px){.today{grid-template-columns:1fr}}
.tb{position:relative;padding:16px 18px;border:1px solid var(--line);border-radius:16px;background:var(--surface);text-decoration:none;color:inherit;min-height:120px;transition:border-color .18s,transform .18s}
.tb:hover{border-color:var(--faint);transform:translateY(-2px)}
.tb h3{margin:0 0 8px;font:600 11.5px/1.2 'IBM Plex Sans',system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.tb .row{display:flex;gap:10px;align-items:baseline;margin:6px 0;font-size:14.5px}
.tb .row b{flex:none;font:600 14px/1.3 'IBM Plex Sans',system-ui,sans-serif;font-variant-numeric:tabular-nums;min-width:3.2em}
.tb .row span{min-width:0}.tb .row small{display:block;color:var(--faint);font-size:12.5px}
.tb .now{color:var(--a2)}.tb .mut{color:var(--muted);font-size:14px}
.tb .mk{display:flex;justify-content:space-between;gap:8px;margin:7px 0;font-size:14.5px;font-variant-numeric:tabular-nums}.tb .mk span:last-child{white-space:nowrap}
.tb .up{color:var(--a2)}.tb .dn{color:var(--a1)}
.tb .nt{font:600 16px/1.35 'Literata',Georgia,serif}.tb .nx{margin-top:6px;color:var(--muted);font-size:13.5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.tb .sk{height:12px;margin:9px 0;border-radius:6px;background:var(--line);opacity:.6}
/* окно ввода пароля */
.pin{position:fixed;inset:0;z-index:60;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.35);opacity:0;transition:opacity .2s}
.pin[hidden]{display:none}.pin.on{opacity:1}
.pin .sh{width:100%;max-width:420px;margin:0 12px calc(env(safe-area-inset-bottom,0px) + 12px);padding:22px 22px 18px;border:1px solid var(--line);border-radius:24px;background:var(--surface);
  box-shadow:0 20px 60px rgba(0,0,0,.25);transform:translateY(30px);transition:transform .35s cubic-bezier(.2,.9,.25,1);text-align:center}
.pin.on .sh{transform:none}
@media (min-width:700px){.pin{align-items:center}}
.pin .av{margin:0 auto 10px}
.pin b{display:block;font:600 21px/1.2 'Literata',Georgia,serif}
.pin small{display:block;margin-top:4px;color:var(--muted);font-size:14px}
.pin input{display:block;width:100%;margin:18px 0 6px;height:56px;border:1px solid var(--line);border-radius:16px;background:var(--bg);color:var(--fg);
  font:600 26px/1 'IBM Plex Sans',system-ui,sans-serif;letter-spacing:.45em;text-align:center;padding:0 0 0 .45em;outline:none}
.pin input:focus{border-color:var(--a2);box-shadow:0 0 0 3px color-mix(in srgb,var(--a2) 22%,transparent)}
.pin .err{min-height:20px;color:var(--a1);font-size:13.5px}
.pin .go{display:flex;width:100%;align-items:center;justify-content:center;height:50px;margin-top:6px;border:0;border-radius:999px;background:var(--a2);color:var(--surface);font:600 16px/1 'IBM Plex Sans',system-ui,sans-serif;cursor:pointer}
.pin .cancel{margin-top:6px;height:42px;width:100%;border:0;background:none;color:var(--muted);font:500 14.5px/1 'IBM Plex Sans',system-ui,sans-serif;cursor:pointer}
.pin.ok input{border-color:var(--a2);color:var(--a2)}
@keyframes shake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-8px)}40%,60%{transform:translateX(8px)}}
.pin.bad input{animation:shake .45s}
@media (prefers-reduced-motion:reduce){.pin,.pin .sh{transition:none}.pin.bad input{animation:none}}
</style>"""

LOCK_CLOSED = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'
LOCK_OPEN = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>'


OLDLINK = "<script>\n/* старые ссылки вида …/#civil-1 ведут в конспекты */\n(function(){var h=location.hash;if(h&&h.length>1)location.replace('ucheba.html'+h)})();\n</script>"
assert OLDLINK in head, 'oldlink'

THEME_BTN = '<button type="button" class="thm" id="thm" aria-label="Оформление" title="Оформление"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/></svg></button>'
THEME_JS = ''   # кнопка «Оформление» обслуживается скриптом в hub.html (меню 9 оформлений, ключ hub:skin)

def page(title, body, gate_p=None, apple_title='Hub'):
    h = head.replace('<title>Hub</title>', '<title>%s</title>' % title)
    if gate_p: h = h.replace(OLDLINK, '')
    if gate_p:
        h = h.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + gate(gate_p), 1)
    h = h.replace('</head>', EXTRA_CSS + '</head>', 1)
    return h + '<body>\n' + body + '\n' + THEME_JS + tail_js + ZQ_JS + '</body></html>\n'


def topbar(back_href, back_text, logout=None):
    lo = ('<button type="button" data-logout="%s">Выйти</button>' % logout) if logout else ''
    return ('<div class="top"><a href="%s"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" '
            'stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>%s</a><div class="tr">%s%s</div></div>') % (back_href, back_text, lo, THEME_BTN)


# «Назад» на страницах Словарь и Поиск возвращает туда, откуда пришёл (Финансы, Учёба), а не всегда на Артема
BACK_JS = ("<script>document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('.top a');"
           "if(!a||a!==document.querySelector('.top a'))return;try{var r=document.referrer;"
           "if(r&&new URL(r).origin===location.origin&&history.length>1&&!/(slovar|search)\\.html/.test(r)){e.preventDefault();history.back()}}catch(x){}});</script>")

LOGOUT_JS = ("<script>document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-logout]');if(!b)return;"
             "var p=b.getAttribute('data-logout');try{localStorage.removeItem('hub:auth:'+p)}catch(x){}"
             "document.cookie='hub_'+p+'=; max-age=0; path=/';location.href='index.html'});</script>")

# ---------------- index.html: выбор профиля ----------------
cards = ''.join(
    '<button type="button" class="card pf" data-p="%s"><span class="lock" data-lock="%s">%s<em>пароль</em></span>'
    '<div class="av %s">%s</div><b>%s</b><span>%s</span></button>' % (p, p, LOCK_CLOSED, 'a' if p == 'artem' else 'n', v[0][0], v[0],
                                                                      'Учёба и финансы' if p == 'artem' else 'Учёба')
    for p, v in PROF.items())
index_body = ('<div class="w">\n  <div class="top"><span></span><div class="tr">' + THEME_BTN + '</div></div>\n  <h1 class="brand">' + WORD + '</h1>\n  <p class="lead">Выбери профиль.</p>\n  <div class="cards prof">' + cards + '</div>\n  ' + foot + '\n</div>\n'
              '<div class="pin" hidden><div class="sh" role="dialog" aria-modal="true"><div class="av" id="pav"></div><b id="pname"></b><small>Введи пароль</small>'
              '<input id="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="12" aria-label="Пароль"><div class="err" id="perr"></div>'
              '<button type="button" class="go" id="pgo">Войти</button><button type="button" class="cancel" id="pcancel">Отмена</button></div></div>\n'
              "<script>\n(function(){\n"
              "var PROF={" + ','.join("%s:{n:'%s',t:'%s',home:'%s',c:'%s'}" % (p, v[0], TOK[p], v[2], 'a' if p == 'artem' else 'n') for p, v in PROF.items()) + "};\n"
              "var OPEN='" + LOCK_OPEN.replace("'", "\\'") + "';\n"
              r"""/* в приложении и в установленном Hub сразу открываем последний профиль (один раз за запуск; «← Профили» ведёт сюда без перехода) */
(function(){try{var app=window.HubApp||navigator.standalone===true||(window.matchMedia&&matchMedia('(display-mode: standalone)').matches);
  if(!app||location.search||sessionStorage.getItem('hub:launched'))return;sessionStorage.setItem('hub:launched','1');
  var l=localStorage.getItem('hub:last');if(l&&PROF[l]&&localStorage.getItem('hub:auth:'+l)===PROF[l].t)location.replace(PROF[l].home)}catch(e){}})();
function authed(p){try{if(localStorage.getItem('hub:auth:'+p)===PROF[p].t)return true}catch(e){}return document.cookie.indexOf('hub_'+p+'='+PROF[p].t)>=0}
function remember(p){try{localStorage.setItem('hub:auth:'+p,PROF[p].t)}catch(e){}document.cookie='hub_'+p+'='+PROF[p].t+'; max-age=31536000; path=/; SameSite=Lax'}
function sha(s){if(!(window.crypto&&crypto.subtle))return Promise.resolve('');return crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)).then(function(b){return Array.prototype.map.call(new Uint8Array(b),function(x){return ('0'+x.toString(16)).slice(-2)}).join('').slice(0,24)})}
Object.keys(PROF).forEach(function(p){if(authed(p)){var l=document.querySelector('[data-lock="'+p+'"]');l.className='lock open';l.innerHTML=OPEN+'<em>открыто</em>'}});
var q=new URLSearchParams(location.search),nextUrl=q.get('next')||'';if(!/^(fin2\/)?[a-z][a-z0-9\-]*\.html([?#].*)?$/i.test(nextUrl))nextUrl='';
var box=document.querySelector('.pin'),inp=document.getElementById('pin'),err=document.getElementById('perr'),cur=null,busy=false;
function go(p){location.href=(nextUrl&&cur===p&&q.get('login')===p)?nextUrl:PROF[p].home}
function open(p){cur=p;var av=document.getElementById('pav');av.className='av '+PROF[p].c;av.textContent=PROF[p].n.charAt(0);document.getElementById('pname').textContent=PROF[p].n;
  err.textContent='';inp.value='';box.classList.remove('ok','bad');box.hidden=false;requestAnimationFrame(function(){box.classList.add('on');setTimeout(function(){inp.focus()},60)})}
function close(){box.classList.remove('on');setTimeout(function(){box.hidden=true},220);cur=null}
function check(final){var p=cur,v=inp.value.trim();if(!p||!v||busy)return;busy=true;
  sha('hub:'+p+':'+v).then(function(h){busy=false;if(h===PROF[p].t){remember(p);box.classList.add('ok');err.textContent='';setTimeout(function(){go(p)},180)}
    else if(final){box.classList.remove('bad');void inp.offsetWidth;box.classList.add('bad');err.textContent='Неверный пароль';inp.select()}})}
document.querySelectorAll('.pf').forEach(function(b){b.addEventListener('click',function(){var p=b.getAttribute('data-p');if(authed(p)){cur=p;go(p)}else open(p)})});
inp.addEventListener('input',function(){err.textContent='';box.classList.remove('bad');check(false)});
inp.addEventListener('keydown',function(e){if(e.key==='Enter')check(true);if(e.key==='Escape')close()});
document.getElementById('pgo').onclick=function(){check(true)};
document.getElementById('pcancel').onclick=close;
box.addEventListener('click',function(e){if(e.target===box)close()});
var lp=q.get('login');if(lp&&PROF[lp]){if(authed(lp)){cur=lp;go(lp)}else open(lp)}
})();
</script>
""")
# старые ссылки вида …/#civil-1 по-прежнему ведут в конспекты (через проверку пароля Артема)
index_html = page('Hub', index_body)

# ---------------- artem.html ----------------
cards_artem = re.search(r'<div class="cards">.*?\n  </div>', TPL, re.S).group(0)
# Главная Артёма: Учёба · Финансы (→ Финансы 1, Финансы 2) · Другое (всё остальное). Подразделы — в той же
# странице по адресу artem.html#fin и #other, кнопка «Назад» телефона возвращает к трём карточкам.
_cards = {re.search(r'href="([^"]+)"', c).group(1): c for c in re.findall(r'    <div class="card[^"]*">.*?\n    </div>', cards_artem, re.S)}
def _card(href): return _cards[href]
_fin1 = _card('finance.html').replace('<b>Финансы</b>', '<b>Финансы 1</b>', 1).replace('aria-label="Финансы"', 'aria-label="Финансы 1"', 1)
_main = ('<div class="cards" data-group="">\n' + _card('ucheba.html') + '\n'
         '    <div class="card f"><a class="cover" href="#fin" aria-label="Финансы"></a>\n'
         '      <div class="ic">₽</div><b>Финансы</b><span>Финансы 1: обучение, рынки, мир. Финансы 2: облигации и акции РФ. Рынок: что шарить</span>\n'
         '      <div class="links"><a href="finance.html">Финансы 1</a><a href="fin2/index.html#screener">Финансы 2</a><a href="rynok.html">Рынок</a></div>\n    </div>\n'
         '    <div class="card e"><a class="cover" href="#other" aria-label="Другое"></a>\n'
         '      <div class="ic">⋯</div><b>Другое</b><span>Политика, английский, нефть и газ</span>\n'
         '      <div class="links"><a href="politika.html">Политика</a><a href="fin-english.html">Английский</a><a href="energy.html">Нефть и газ</a></div>\n    </div>\n  </div>')
_fin = '<div class="cards" data-group="fin" hidden>\n' + _fin1 + '\n' + _card('fin2/index.html') + '\n' + _card('rynok.html') + '\n  </div>'
_oth = ('<div class="cards" data-group="other" hidden>\n' + '\n'.join(c for h, c in _cards.items() if h not in ('ucheba.html', 'finance.html', 'fin2/index.html', 'rynok.html')) + '\n  </div>')
cards_artem = _main + '\n  ' + _fin + '\n  ' + _oth + r"""
  <script>
  (function(){var N={fin:'Финансы',other:'Другое'};
  function v(){var g=location.hash.slice(1);if(!N[g])g='';
    document.querySelectorAll('[data-group]').forEach(function(e){e.hidden=e.getAttribute('data-group')!==g});
    var h=document.getElementById('hh');if(h)h.textContent=N[g]||'Артем';var b=document.getElementById('hback');if(b)b.hidden=!g}
  window.addEventListener('hashchange',v);v()})();
  </script>"""
TODAY = ('<div class="today">'
         '<a class="tb" id="t-sched" href="ucheba.html#schedule"><h3>Пары</h3><div class="sk"></div><div class="sk" style="width:70%"></div></a>'
         '<a class="tb" id="t-mkt" href="finance.html#markets"><h3>Рынок сейчас</h3><div class="sk"></div><div class="sk" style="width:60%"></div></a>'
         '<a class="tb" id="t-news" href="finance.html#markets/news"><h3>Главная новость</h3><div class="sk"></div><div class="sk" style="width:80%"></div></a></div>')
TODAY_JS = r'''<script>
/* сводка «Сегодня»: ближайшие пары, рынок, главная новость — из тех же файлов, что и разделы (берутся из кэша мгновенно) */
(function(){
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function J(u){return fetch(u).then(function(r){if(!r.ok)throw 0;return r.json()})}
function nf(v,d){return Number(v).toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d})}
function pc(v){if(v==null||isNaN(v))return '';return '<span class="'+(v>=0?'up':'dn')+'">'+(v>0?'+':'')+nf(v,2)+'%</span>'}
function ymd(d){return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)}
var now=new Date(),today=ymd(now),hm=('0'+now.getHours()).slice(-2)+':'+('0'+now.getMinutes()).slice(-2);
J('schedule.json?t='+Date.now()).then(function(j){
  var L=(j.list||j||[]).slice().sort(function(a,b){return (a.d+a.b)<(b.d+b.b)?-1:1});
  var rest=L.filter(function(x){return x.d===today&&x.e>hm}),head='Сегодня',day=today;
  if(!rest.length){var nx=L.filter(function(x){return x.d>today})[0];if(nx){day=nx.d;rest=L.filter(function(x){return x.d===day});
    var dd=new Date(day+'T12:00:00'),diff=Math.round((new Date(day+'T00:00:00')-new Date(today+'T00:00:00'))/864e5);
    head=diff===1?'Завтра':dd.toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}}
  var h='<h3>Пары · '+esc(head)+'</h3>';
  if(!rest.length)h+='<p class="mut">В расписании ближайших пар нет.</p>';
  rest.slice(0,3).forEach(function(x){var on=x.d===today&&x.b<=hm&&x.e>hm;
    h+='<div class="row'+(on?' now':'')+'"><b>'+esc(x.b)+'</b><span>'+esc(x.n)+'<small>'+esc([x.k,x.r?'ауд. '+x.r:''].filter(Boolean).join(' · '))+(on?' · идёт сейчас':'')+'</small></span></div>'});
  if(rest.length>3)h+='<p class="mut">и ещё '+(rest.length-3)+'</p>';
  document.getElementById('t-sched').innerHTML=h;
}).catch(function(){document.getElementById('t-sched').innerHTML='<h3>Пары</h3><p class="mut">Расписание откроется в разделе Учёба.</p>'});
J('markets.json').then(function(m){
  var h='<h3>Рынок · '+esc((m.updated||'').replace(/^\d\d\.\d\d\.\d{4}\s*/,''))+'</h3>',ix=(m.idx||{}).IMOEX,us=m.fx&&m.fx.Valute&&m.fx.Valute.USD,btc=(m.crypto||[]).filter(function(x){return x.s==='BTC'})[0],sp=(m.us||{})['^GSPC'];
  if(ix)h+='<div class="mk"><span>Индекс Мосбиржи</span><span>'+nf(ix.v,0)+' '+pc(ix.ch)+'</span></div>';
  if(us)h+='<div class="mk"><span>Доллар (ЦБ)</span><span>'+nf(us.Value,2)+' ₽ '+pc((us.Value/us.Previous-1)*100)+'</span></div>';
  if(btc)h+='<div class="mk"><span>Bitcoin</span><span>$'+nf(btc.p,0)+' '+pc(btc.c24)+'</span></div>';
  if(sp&&sp.p)h+='<div class="mk"><span>S&amp;P 500</span><span>'+nf(sp.p,0)+' '+pc(sp.ch)+'</span></div>';
  document.getElementById('t-mkt').innerHTML=h;
}).catch(function(){document.getElementById('t-mkt').innerHTML='<h3>Рынок</h3><p class="mut">Открой «Финансы → Рынки».</p>'});
J('news.json').then(function(n){
  var lim=new Date(Date.now()-30*36e5).toISOString(),a=(n.items||[]).filter(function(x){return !x.dup&&x.d>=lim}).sort(function(x,y){return (y.imp||0)-(x.imp||0)});
  var x=a[0];if(!x)throw 0;var el=document.getElementById('t-news');el.href='finance.html#markets/news/'+x.id;
  el.innerHTML='<h3>Главная новость'+(x.cl>1?' · '+x.cl+' изд.':'')+'</h3><div class="nt">'+esc(x.t)+'</div>'+(x.sum&&x.sum[0]?'<div class="nx">'+esc(x.sum[0])+'</div>':'');
}).catch(function(){document.getElementById('t-news').innerHTML='<h3>Новости</h3><p class="mut">Лента — в «Финансы → Новости».</p>'});
})();
</script>'''

artem_body = ('<div class="w">\n  ' + topbar('index.html', 'Профили', 'artem') + '\n  <a id="hback" class="hback" href="#" hidden>← Артем</a>\n  <h1 id="hh">Артем</h1>\n  '
              + cards_artem + '\n  ' + foot + '\n</div>\n' + LOGOUT_JS)
SEARCH_BTN = '<a class="sbtn" href="search.html" aria-label="Поиск по сайту"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>Поиск</a>'
SLOVAR_BTN = '<a class="sbtn" href="slovar.html" aria-label="Словарь терминов">Словарь</a>'
artem_body = artem_body.replace('<div class="tr">', '<div class="tr">' + SLOVAR_BTN + SEARCH_BTN, 1)
artem_html = page('Hub · Артем', artem_body, 'artem')   # просто: Артем → Учёба, Финансы (сводку «Сегодня» убрали)

# ---------------- nastya.html ----------------
nastya_cards = ('<div class="cards">\n    <div class="card u"><a class="cover" href="nastya-ucheba.html" aria-label="Учёба"></a>\n'
                '      <div class="ic">§</div><b>Учёба</b><span>Расписание группы</span>\n'
                '      <div class="links"><a href="nastya-ucheba.html">Открыть</a></div>\n    </div>\n'
                '    <div class="card e"><a class="cover" href="english.html" aria-label="English"></a>\n'
                '      <div class="ic">Aa</div><b>English</b><span>Курс A2 → B1+: уроки, слова, справочник</span>\n'
                '      <div class="links"><a href="english.html">Уроки</a><a href="english.html#words">Слова</a><a href="english.html#ref">Справочник</a></div>\n    </div>\n  </div>')
nastya_body = ('<div class="w">\n  ' + topbar('index.html', 'Профили', 'nastya') + '\n  <h1>Настя</h1>\n  <p class="lead">Выбери раздел.</p>\n  '
               + nastya_cards + '\n  ' + foot + '\n</div>\n' + LOGOUT_JS)
nastya_html = page('Hub · Настя', nastya_body, 'nastya')

NU_CSS = """<style>
.wk{display:flex;align-items:center;gap:8px;margin:18px 0 4px}
.wk button{min-width:44px;height:42px;padding:0 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--fg);font:500 15px/1 'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;cursor:pointer}
.wk button:hover{border-color:var(--a2);color:var(--a2)}.wk .cur{flex:1;text-align:center;font:600 16px/1.2 'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-variant-numeric:tabular-nums}
.wk .now{font-size:13px}
.sd{margin-top:22px}.sd h2{margin:0 0 4px;font:600 12px/1.2 'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)}
.sd h2 em{margin-left:6px;font-style:normal;color:var(--a2)}.sd.today h2{color:var(--a2)}
.sd .none{margin:0;padding:10px 0;border-top:1px solid var(--line);color:var(--faint);font-size:14.5px}.sd .lst{border-bottom:1px solid var(--line)}
details.nx{border-top:1px solid var(--line)}details.nx>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:76px 1fr auto 14px;gap:0 12px;align-items:center;padding:13px 0}
details.nx>summary::-webkit-details-marker{display:none}.nd{font:600 14px/1.25 'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-variant-numeric:tabular-nums;color:var(--fg)}.nd small{display:block;font-weight:400;color:var(--muted)}
.nt b{display:block;font-weight:600;line-height:1.3}.nt i{display:block;font-style:normal;color:var(--muted);font-size:13.5px;margin-top:2px}
.rm{font-size:13.5px;color:var(--muted);white-space:nowrap;text-align:right}.cv{width:8px;height:8px;border-right:2px solid var(--faint);border-bottom:2px solid var(--faint);transform:rotate(45deg);transition:transform .2s;margin-top:-4px}
details.nx[open] .cv{transform:rotate(225deg);margin-top:2px}
details.nx.now{box-shadow:inset 3px 0 0 var(--a2);padding-left:10px;margin-left:-10px;background:linear-gradient(90deg,color-mix(in srgb,var(--a2) 9%,transparent),transparent)}
details.nx.past>summary{opacity:.5}
.mo{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 20px;padding:0 0 16px 88px;font-size:14.5px;line-height:1.45}.mo .k{display:block;font:600 11px/1.3 'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);margin-bottom:1px}
.next{margin-top:22px;padding:16px 18px;border:1px solid var(--line);border-radius:18px;background:var(--surface)}.next h2{margin:0 0 6px;font:600 12px/1.2 'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)}
.next .row{display:grid;grid-template-columns:112px 1fr;gap:12px;padding:8px 0;border-top:1px solid var(--line)}.next .row:first-of-type{border-top:0}.next .row b{font-variant-numeric:tabular-nums}.next .row small{display:block;color:var(--muted)}
.src{margin:22px 0 0;color:var(--faint);font-size:13px}
@media(max-width:560px){details.nx>summary{grid-template-columns:64px 1fr 14px}.rm{display:none}.mo{padding-left:76px}}
</style>"""
NU_JS = r"""<script>
(function(){
var el=document.getElementById('sch'),LIST=[],UPD='',GRP='',wk=0,MON=['янв.','февр.','марта','апр.','мая','июня','июля','авг.','сент.','окт.','нояб.','дек.'],WD=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function ymd(d){return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)}
function ts(x,t){return Date.parse(x.d+'T'+t+':00+03:00')}
function pair(x,now,nd){var s=ts(x,x.b),e=ts(x,x.e),cls='nx'+(s<=now&&e>now?' now':'')+(e<=now?' past':'');
  var more=(x.t?'<div><span class="k">Преподаватель</span><b>'+esc(x.t)+'</b></div>':'')+'<div><span class="k">Где</span>'+(x.r?'ауд. '+esc(x.r):'—')+(x.bd?', '+esc(x.bd):'')+'</div><div><span class="k">Время</span>'+esc(x.b)+'–'+esc(x.e)+(x.k?' · '+esc(x.k):'')+'</div>';
  return '<details class="'+cls+'"><summary><span class="nd">'+esc(x.b)+'<small>'+esc(x.e)+'</small></span><span class="nt"><b>'+esc(x.n)+'</b><i>'+esc([x.k,x.t].filter(Boolean).join(' · '))+((s<=now&&e>now)?' · идёт сейчас':'')+'</i></span><span class="rm">'+(x.r?'ауд. '+esc(x.r):'—')+'</span><span class="cv"></span></summary><div class="mo">'+more+'</div></details>'}
function draw(){
  var now=Date.now(),mon=new Date();mon.setHours(12,0,0,0);mon.setDate(mon.getDate()-((mon.getDay()+6)%7)+7*wk);
  var days=[];for(var i=0;i<7;i++){var d=new Date(mon.getTime());d.setDate(mon.getDate()+i);days.push(d)}
  var a=days[0],z=days[6],today=ymd(new Date()),h='';
  var up=LIST.filter(function(x){return ts(x,x.e)>now}).slice(0,4);
  if(wk===0&&up.length){h+='<section class="next"><h2>Ближайшие пары</h2>'+up.map(function(x){var dd=new Date(x.d+'T12:00:00'),diff=Math.round((new Date(x.d+'T00:00:00')-new Date(today+'T00:00:00'))/864e5);
    return '<div class="row"><b>'+esc(x.b)+'–'+esc(x.e)+'<small>'+(diff===0?'сегодня':diff===1?'завтра':WD[dd.getDay()]+', '+dd.getDate()+' '+MON[dd.getMonth()])+'</small></b><span>'+esc(x.n)+'<small>'+esc([x.k,x.r?'ауд. '+x.r:''].filter(Boolean).join(' · '))+'</small></span></div>'}).join('')+'</section>'}
  h+='<div class="wk"><button type="button" data-wk="-1" aria-label="Прошлая неделя">←</button><span class="cur">'+a.getDate()+' '+MON[a.getMonth()]+' – '+z.getDate()+' '+MON[z.getMonth()]+'</span><button type="button" data-wk="1" aria-label="Следующая неделя">→</button>'+(wk?'<button type="button" class="now" data-wk="0">Сегодня</button>':'')+'</div>';
  var any=false;
  days.forEach(function(d,k){var s=ymd(d),l=LIST.filter(function(x){return x.d===s});if(!l.length&&k>=5)return;any=any||l.length>0;
    h+='<div class="sd'+(s===today?' today':'')+'"><h2>'+WD[d.getDay()]+', '+d.getDate()+' '+MON[d.getMonth()]+(s===today?'<em>сегодня</em>':'')+'</h2>'+(l.length?'<div class="lst">'+l.map(function(x){return pair(x,now)}).join('')+'</div>':'<p class="none">Нет пар</p>')+'</div>'});
  var last=LIST.length?LIST[LIST.length-1].d:'';
  if(!any&&last&&ymd(mon)>last)h+='<p class="src">Дальше расписания пока нет — оно загружено до '+last.split('-').reverse().join('.')+' и обновляется само.</p>';
  h+='<p class="src">Расписание обновляется автоматически с pleh.tech · группа '+esc(GRP)+(UPD?' · обновлено '+esc(UPD.replace('T',' ').replace('Z',' UTC')):'')+'</p>';
  el.innerHTML=h;
}
el.addEventListener('click',function(e){var b=e.target.closest('[data-wk]');if(!b)return;var v=+b.getAttribute('data-wk');wk=v===0?0:wk+v;draw()});
var sx=null;el.addEventListener('touchstart',function(e){sx=e.touches[0].clientX},{passive:true});
el.addEventListener('touchend',function(e){if(sx==null)return;var dx=e.changedTouches[0].clientX-sx;sx=null;if(Math.abs(dx)>70&&!e.target.closest('details[open]')){wk+=dx<0?1:-1;draw()}},{passive:true});
fetch('schedule_nastya.json?t='+Date.now(),{cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(j){
  LIST=(j.list||[]).slice().sort(function(a,b){return (a.d+a.b)<(b.d+b.b)?-1:1});UPD=j.updated||'';GRP=j.group||'';draw()})
  .catch(function(){el.innerHTML='<p class="src">Расписание скоро появится.</p>'});
})();
</script>"""
nu_body = ('<div class="w">\n  ' + topbar('nastya.html', 'Настя') + '\n  <h1>Расписание</h1>\n  <p class="lead">Группа 15.24Д-ЭБ01/25с.</p>\n'
           '  <div id="sch"><p class="src">Загружаю…</p></div>\n</div>\n' + NU_JS)
nu_html = page('Учёба · Настя', nu_body, 'nastya').replace('</head>', NU_CSS + '</head>', 1)


# ---------------- search.html: поиск по всему сайту Артема ----------------
SEARCH_CSS = """<style>
.sbtn{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid var(--line);border-radius:999px;color:var(--fg);text-decoration:none;font:500 14px/1 system-ui,sans-serif;background:var(--surface)}
.sbtn:hover{border-color:var(--faint)}
.sq{position:relative;margin:6px 0 12px}.sq input{width:100%;font:500 17px/1.2 system-ui,sans-serif;padding:14px 16px 14px 44px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--fg);outline:none}
.sq input:focus{border-color:var(--a2,#1F6B57);box-shadow:0 0 0 3px color-mix(in srgb,var(--a2,#1F6B57) 18%,transparent)}
.sq svg{position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--faint)}
.sf{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px}.sf button{border:1px solid var(--line);background:var(--surface);color:var(--fg);padding:7px 12px;border-radius:999px;font:500 13px/1 system-ui,sans-serif;cursor:pointer}
.sf button.on{background:var(--a2,#1F6B57);border-color:var(--a2,#1F6B57);color:#fff}.sf em{font-style:normal;opacity:.65;margin-left:4px}
.sr a{display:block;padding:12px 2px;border-top:1px solid var(--line);color:var(--fg);text-decoration:none}.sr a:first-child{border-top:0}.sr a:hover b,.sr a.kb b{color:var(--a2,#1F6B57)}.sr a.kb{background:color-mix(in srgb,var(--a2,#1F6B57) 7%,transparent)}
.sr b{display:block;font:600 16px/1.3 system-ui,sans-serif}.sr small{color:var(--faint);font:500 11px/1 system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase}.sr p{margin:4px 0 0;color:var(--muted);font:400 14px/1.4 system-ui,sans-serif}
.sr mark{background:color-mix(in srgb,#E8B100 38%,transparent);color:inherit;border-radius:3px;padding:0 1px}
.sm{color:var(--muted);font:400 14px/1.5 system-ui,sans-serif;padding:18px 0}
.sr a{animation:up .22s ease both}
</style>"""
SEARCH_JS = r"""<script>
/* Поиск по всему сайту: тот же алгоритм, что в разделе «Финансы» — основы слов (окончания), формулы, раскладка в обе стороны, транслит, совпадение по заголовку раздела выше, чем по тексту. Переход открывает нужный раздел с подсветкой. */
(function(){
var KIND={ch:'Глава',sec:'Сектор',term:'Термин',co:'Компания',tk:'Билет',nt:'Конспект',en:'English'},TAB=[['',['ch','sec','term','co','tk','nt','en'],'Всё'],['f',['ch','sec','term'],'Финансы'],['e',['en'],'English'],['c',['co'],'Компании'],['u',['tk','nt'],'Учёба']];
var IDX=null,Q='',tab='',box=document.getElementById('sr'),inp=document.getElementById('q'),tabs=document.getElementById('sf'),kb=-1,res=[];
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function lc(x){return String(x==null?'':x).toLowerCase().replace(/ё/g,'е')}
function nzf(x){return lc(x).replace(/\s+/g,'').replace(/\*/g,'×').replace(/[-–—]/g,'−').replace(/÷/g,'/').replace(/[`$]/g,'')}
function escRe(c){return c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function isFormula(q){return /[=×*÷\/^+−\-()<>≈≥≤]/.test(q)&&q.replace(/\s+/g,'').length>=3}
function toks(q){return lc(q).split(/[\s,;]+/).filter(Boolean).map(function(t){return t.length>5&&/[а-яе]/.test(t)?t.slice(0,t.length-2):t})}
var RU='йцукенгшщзхъфывапролджэячсмитьбю',EN="qwertyuiop[]asdfghjkl;'zxcvbnm,.";
function cyr(q){return /[а-яё]/i.test(q)&&!/[a-z]/i.test(q)}
function layoutFix(q){return Array.from(q.toLowerCase()).map(function(c){var k=RU.indexOf(c);return k>=0?EN[k]:c}).join('').replace(/[\[\];',.]/g,'')}
function layoutRev(q){return Array.from(q.toLowerCase()).map(function(c){var k=EN.indexOf(c);return k>=0?RU[k]:c}).join('')}
var TR={а:'a',б:'b',в:'[wv]',г:'g',д:'d',е:'[ei]',ё:'e',ж:'(?:zh|j)',з:'z',и:'[ie]',й:'[yji]',к:'[kc]',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'[sc]',т:'t',у:'[uy]',ф:'(?:f|ph)',х:'[hx]',ц:'c',ч:'(?:ch|c)',ш:'(?:sh|s)',щ:'(?:sh|s)',ы:'[yi]',э:'e',ю:'(?:yu|u)',я:'(?:ya|a)',ь:'',ъ:''};
function translitSrc(q){var pv='';return '\\b'+Array.from(lc(q).replace(/\s+/g,'')).map(function(c){var r=TR[c]!=null?TR[c]:escRe(c);if(c===pv&&r)r=r+'?';pv=c;return r}).join('')}
function qrx(q,g){var f=isFormula(q);
  var src=f?Array.from(q.replace(/\s+/g,'')).map(function(c){if(c==='*'||c==='×')return '[*×]';if(c==='-'||c==='−'||c==='–')return '[-−–]';if(c==='/'||c==='÷')return '[/÷]';if(/[еёЕЁ]/.test(c))return '[еёЕЁ]';return escRe(c)}).join('\\s*')
  :toks(q).map(function(t){return escRe(t).replace(/[её]/g,'[её]')}).join('|')+(cyr(q)&&q.replace(/\s+/g,'').length>=3?'|'+translitSrc(q):'');
  return new RegExp(src,g?'gi':'i')}
function wsIn(h,t){var i=-1;while((i=h.indexOf(t,i+1))>=0){if(i===0||/[^а-яa-z0-9]/.test(h.charAt(i-1)))return true}return false}
function load(){box.innerHTML='<p class="sm">Загружаю индекс…</p>';
  fetch('search-index.json').then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(j){IDX=j.map(function(x){var h=x[4]||'';return {k:x[0],t:x[1],x:x[2],u:x[3],h:h,tn:lc(x[1]),hn:lc(h),xn:lc(x[2]),nz:nzf(x[2]),intro:!h}});run()})
  .catch(function(){box.innerHTML='<p class="sm">Не удалось загрузить индекс поиска. <button type="button" class="sbtn" id="rt">Повторить</button></p>';var b=document.getElementById('rt');if(b)b.onclick=load})}
function core(q,tr){
  var f=isFormula(q),qn=nzf(q),tk=toks(q),phr=lc(q.trim()),out=[],trx=tr?new RegExp(translitSrc(q),'i'):null,trh=tr?new RegExp('^'+translitSrc(q).replace(/^\\b/,'')+'.{0,3}$','i'):null;
  IDX.forEach(function(it){var sc=0,head=it.intro?it.tn:it.hn;
    if(trx){var h=trx.test(head)||trx.test(it.tn),m=trx.test(it.xn);if(!h&&!m)return;sc=(m?2:0)+(h?30:0)+(trx.test(it.tn)&&it.intro?40:0);if(trh.test(head))sc+=60}
    else if(f){var k=it.nz.indexOf(qn);if(k<0)return;sc=10;var o=0,j=k;while(j>=0&&o<5){o++;j=it.nz.indexOf(qn,j+1)}sc+=o;if(head.indexOf(lc(q))>=0)sc+=6}
    else{var first=-1,inWord=false,ctHit=tk.every(function(t){return it.tn.indexOf(t)>=0});
      for(var a=0;a<tk.length;a++){var t=tk[a],pl=it.xn.indexOf(t),ph=head.indexOf(t),pt=it.tn.indexOf(t);
        if(pl<0&&ph<0&&pt<0)return;
        var cnt=0,jj=pl;while(jj>=0&&cnt<5){cnt++;jj=it.xn.indexOf(t,jj+1)}sc+=cnt;
        if(!wsIn(it.xn,t)&&!wsIn(head,t)&&!wsIn(it.tn,t))inWord=true;
        if(pl>=0&&(first<0||pl<first))first=pl}
      var hAll=tk.every(function(t){return head.indexOf(t)>=0}),hs0=head.replace(/^[\d.\s№]+/,'');
      if(hs0===phr||(hs0.indexOf(phr)===0&&hs0.length<=phr.length+3))sc+=60;
      if(hAll){sc+=30;if(head.indexOf(tk[0])<=1)sc+=10;if(it.k==='term'||it.k==='co')sc+=25}
      else if(tk.some(function(t){return head.indexOf(t)>=0}))sc+=5;
      if(first>=0&&first<160)sc+=4;if(tk.length>1&&it.xn.indexOf(phr)>=0)sc+=8;
      if(ctHit)sc+=it.intro?45:8;
      if(inWord)sc*=.2;if(it.k==='tk')sc*=.7;if(it.x.length<40)sc*=.5}
    if(sc>0)out.push({it:it,s:sc})});
  out.sort(function(a,b){return b.s-a.s});return out}
function hl(t,re){return esc(t).replace(new RegExp(re.source,'gi'),function(m){return '<mark>'+m+'</mark>'})}
function snip(it,re){var x=it.x,m=new RegExp(re.source,'i').exec(x),i=m?m.index:0,a=Math.max(0,i-60),b=Math.min(x.length,i+170);
  if(a>0){var sa=x.indexOf(' ',a);if(sa>-1&&sa<i)a=sa+1}if(b<x.length){var sb=x.lastIndexOf(' ',b);if(sb>i)b=sb}
  return (a>0?'…':'')+hl(x.slice(a,b),re)+(b<x.length?'…':'')}
function run(){if(!IDX)return;var q=Q.trim();
  if(q.length<2){box.innerHTML='<p class="sm">Начни вводить: «WACC», «Сбербанк», «ст. 125», «лизинг», «FV=PV*(1+r)»… Ищет по главам, терминам, секторам, компаниям, билетам и конспектам.</p>';tabs.innerHTML='';res=[];return}
  var all=core(q),qe=q,note='';
  if(!cyr(q)&&/^[a-z\[\];',.\s]{2,}$/i.test(q)&&!all.length){var qr=layoutRev(q),Ar=core(qr);if(Ar.length){all=Ar;qe=qr;note='Раскладка: искали «'+qr+'»'}}
  if(cyr(q)){var q2=layoutFix(q);if(/^[a-z0-9 ]{2,}$/.test(q2)){var A2=core(q2);if(A2.length>all.length){all=A2;qe=q2;note='Раскладка: искали «'+q2+'»'}}
    if(q.replace(/\s+/g,'').length>=3&&all.length<4){var A3=core(q,true);if(A3.length>all.length){all=A3;note='Похоже на латинское написание, показаны совпадения по звучанию'}}}
  var re=qrx(qe,true);
  var cnt={};TAB.forEach(function(t){cnt[t[0]]=all.filter(function(r){return t[1].indexOf(r.it.k)>=0}).length});
  tabs.innerHTML=TAB.map(function(t){return '<button type="button" data-t="'+t[0]+'" class="'+(t[0]===tab?'on':'')+'">'+t[2]+'<em>'+cnt[t[0]]+'</em></button>'}).join('');
  var cur=TAB.filter(function(t){return t[0]===tab})[0],per={},list=[];
  all.forEach(function(r){if(cur[1].indexOf(r.it.k)<0)return;var key=r.it.u;per[key]=(per[key]||0)+1;if(per[key]<=3&&list.length<50)list.push(r)});res=list;kb=-1;
  box.innerHTML=(note?'<p class="sm">'+esc(note)+'</p>':'')+(list.length?list.map(function(r,i){var it=r.it;
    return '<a href="'+esc(it.u)+'" data-i="'+i+'" data-q="'+esc(qe)+'" data-hs="'+esc(it.intro?'':it.h)+'"><small>'+KIND[it.k]+(it.intro||it.k==='co'||it.k==='term'||it.k==='tk'?'':' · '+esc(it.t))+'</small><b>'+hl(it.intro||!it.h?it.t:it.h,re)+'</b><p>'+snip(it,re)+'</p></a>'}).join('')
    :'<p class="sm">Ничего не найдено по «'+esc(q)+'». Попробуй корень слова, другое написание или формулу без пробелов.</p>')}
var tm=null;inp.addEventListener('input',function(){Q=inp.value;clearTimeout(tm);tm=setTimeout(function(){run();try{history.replaceState(null,'',Q?'?q='+encodeURIComponent(Q):location.pathname)}catch(e){}},120)});
tabs.addEventListener('click',function(e){var b=e.target.closest('[data-t]');if(!b)return;tab=b.getAttribute('data-t');run()});
box.addEventListener('click',function(e){var a=e.target.closest('a[data-q]');if(!a)return;var u=a.getAttribute('href'),m=u.match(/^(finance|ucheba)\.html#(.+)$/);if(!m)return;
  var id=m[2].replace(/^(learn|world\/sectors)\//,'');try{sessionStorage.setItem(m[1]==='finance'?'fin:hl':'uch:hl',JSON.stringify({id:id,q:a.getAttribute('data-q'),hs:a.getAttribute('data-hs')||''}))}catch(x){}});
inp.addEventListener('keydown',function(e){var as=box.querySelectorAll('a');if(!as.length)return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();kb=Math.max(0,Math.min(as.length-1,kb+(e.key==='ArrowDown'?1:-1)));as.forEach(function(a,i){a.classList.toggle('kb',i===kb)});as[kb].scrollIntoView({block:'nearest'})}
  if(e.key==='Enter'){var a=as[Math.max(0,kb)];if(a)a.click()}});
document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==inp){e.preventDefault();inp.focus()}});
var q0=new URLSearchParams(location.search).get('q');if(q0){inp.value=q0;Q=q0}
inp.focus();load();
})();
</script>"""
search_body = ('<div class="w">\n  ' + topbar('artem.html', 'Артем') + '\n  <h1>Поиск</h1>\n'
               '  <div class="sq"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
               '<input id="q" type="search" placeholder="Что найти?" autocomplete="off" enterkeyhint="search" aria-label="Поиск по сайту"></div>\n'
               '  <div class="sf" id="sf" role="group" aria-label="Фильтр"></div>\n  <div class="sr" id="sr" aria-live="polite"></div>\n</div>\n')
search_html = page('Hub · Поиск', search_body, 'artem').replace('</head>', SEARCH_CSS + '</head>', 1).replace('</body>', SEARCH_JS + BACK_JS + '</body>', 1)


# ---------------- slovar.html: «Словарь» — термин на русском или английском → расшифровка, перевод, суть, формула ----------------
import json as _json
sys.path.insert(0, os.path.join(ROOT, 'src', 'finance'))
import urllib.parse
import terms as _T
def _lesson_index():
    import ast, glob
    src = open(os.path.join(ROOT, 'src', 'finance', 'build_finance.py'), encoding='utf-8').read()
    m = re.search(r'IDS = (\{.*?\})', src, re.S); ids = ast.literal_eval(m.group(1))
    L = []
    for f in sorted(glob.glob(os.path.join(ROOT, 'src', 'finance', 'content', '*.md'))):
        nm = os.path.basename(f); nn = nm[:2]
        if nn in ('98', '99', '35', '69'): continue
        fid = ids.get(nn) or re.sub(r'\.md$', '', nm[3:])
        lines = open(f, encoding='utf-8').read().split('\n')
        title = next((x.lstrip('# ').strip() for x in lines if x.strip()), fid)
        L.append((fid, title, lines, fid.startswith('shpargalka-')))
    return L
_LESS = _lesson_index()
_WEAK = ('sobesedovanie', 'stazhirovka', 'praktikum', 'keysy', 'karera', 'project-black', 'interesnoe')
def _find_lesson(names):
    best = None
    for ni, n in enumerate(names):
        n = n.strip()
        if len(n) < 3: continue
        if re.search(r'[A-Z]{2,}', n) or (' ' not in n and n.isascii()):
            rx = re.compile(r'(?<![A-Za-zА-Яа-яЁё0-9])' + re.escape(n).replace('\\/', r'\s*/\s*') + r'(?![A-Za-zА-Яа-яЁё0-9])', re.I)
        else:
            rx = re.compile(re.escape(n[:-1] if len(n) > 6 else n), re.I)
        wn = 1.0 if ni == 0 else .5
        for fid, title, lines, sh in _LESS:
            tot = 0; top = (0, '')
            hd = ''
            for ln in lines:
                ishd = ln.startswith('#')
                if ishd: hd = ln.lstrip('# ').strip()
                if not rx.search(ln): continue
                if re.match(r'(Проверь себя|Вопросы|Частые)', hd) and not ishd: ls = .3
                elif ishd: ls = 25
                elif '**' in ln and any(rx.search(x) for x in re.findall(r'\*\*([^*]+)\*\*', ln)): ls = 6
                else: ls = 1
                tot += ls
                if ls > top[0]: top = (ls, hd)
            if not tot: continue
            sc = min(tot, 45) * wn
            if rx.search(title): sc += 20 * wn
            if sh: sc *= .3
            if fid in _WEAK: sc *= .35
            if best is None or sc > best[0]: best = (sc, fid, title, top[1], n)
    return best
_ALIAS = {'Модель Гордона': ['Гордон'], 'Gordon growth model': ['Гордон'], 'EBITDA margin': ['маржа EBITDA', 'рентабельность по EBITDA']}
def _slovar_data():
    out = []; seen = set()
    def lesson(head, full):
        names = [head] + [x for x in re.split(r'\s*[/,;]\s*', full or '') if x]
        names += re.findall(r'\(([^)]{3,40})\)', head + ' ' + (full or ''))
        names += [re.sub(r'\s*\(.*?\)', '', x) for x in names]
        names += _ALIAS.get(head, [])
        b = _find_lesson([x for x in dict.fromkeys(names)])
        if not b or b[0] < 3: return None
        return b
    def entry(t, full, d, f, gl):
        head = re.split(r'\s[—-]\s', t)[0].strip()
        e = {'t': t, 'f': full, 'd': d, 'x': f, 'u': gl, 'g': gl}
        b = lesson(head, full)
        if b:
            e['u'] = 'finance.html#learn/' + b[1]; e['ut'] = b[2]; e['hq'] = b[4]; e['hs'] = b[3]
        return e
    for l in open(os.path.join(ROOT, 'src', 'finance', 'content', '98_glossary.md'), encoding='utf-8'):
        m = re.match(r'^\| \*\*(.+?)\*\* \|(.*?)\|(.*?)\|(.*)\|\s*$', l)
        if not m: continue
        t, full, d, f = [x.strip() for x in m.groups()]
        out.append(entry(t, full, d, f, 'finance.html#learn/glossariy/' + urllib.parse.quote(re.sub(r'\s+', ' ', t), safe=''))); seen.add(t.lower())
    for pats, title, d in list(_T.RICH) + list(_T.EXTRA):
        head = re.split(r'\s[—-]\s', title)[0].strip()
        if head.lower() in seen: continue
        seen.add(head.lower())
        out.append(entry(title, '', d, '', 'finance.html#learn/glossariy'))
    return out
SLOVAR_DATA = _json.dumps(_slovar_data(), ensure_ascii=False).replace('</', '<\\/')
SLOVAR_CSS = """<style>
.sq{position:relative;margin:6px 0 12px}.sq input{width:100%;font:500 17px/1.2 system-ui,sans-serif;padding:14px 16px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--fg);outline:none}
.sq input:focus{border-color:var(--a2,#1F6B57);box-shadow:0 0 0 3px color-mix(in srgb,var(--a2,#1F6B57) 18%,transparent)}
.tk{border:1px solid var(--line);background:var(--surface);border-radius:14px;padding:14px 16px;margin:0 0 12px}
.tk h2{margin:0 0 2px;font:700 19px/1.3 system-ui,sans-serif}.tk .en{color:var(--muted);font:500 13.5px/1.4 system-ui,sans-serif;margin:0 0 8px}
.tk .lb{color:var(--faint);font:600 11px/1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;margin:10px 0 3px}
.tk p{margin:0;font:400 15px/1.5 system-ui,sans-serif}.tk code{display:block;margin-top:2px;padding:8px 10px;background:color-mix(in srgb,var(--fg) 6%,transparent);border-radius:8px;font:500 14px/1.45 ui-monospace,Menlo,monospace;white-space:normal}
.tk .fx{display:block;color:var(--muted);font:400 13px/1.45 system-ui,sans-serif;margin-top:4px}
.tk a{color:var(--a2,#1F6B57);font:500 13.5px/1 system-ui,sans-serif;text-decoration:none;display:inline-block;margin-top:10px}
.tk .gl{display:block;margin-top:8px;color:var(--faint);font-weight:400}.tk .ls{display:block}.tk.web{border-style:dashed}.tk.web .src{color:var(--faint);font:400 12px/1.4 system-ui,sans-serif;margin-top:6px}
.sh{margin:18px 0 8px;color:var(--faint);font:600 12px/1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}
.sm{color:var(--muted);font:400 14px/1.5 system-ui,sans-serif;padding:8px 0}
.wbtn{display:block;width:100%;min-height:48px;margin:18px 0 4px;padding:0 16px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--fg);font:600 15px system-ui,sans-serif;cursor:pointer}
</style>"""
SLOVAR_JS = r"""<script>
(function(){
var D=__DATA__;
var RU='йцукенгшщзхъфывапролджэячсмитьбю',EN="qwertyuiop[]asdfghjkl;'zxcvbnm,.";
var TR={а:'a',б:'b',в:'[wv]',г:'g',д:'d',е:'[ei]',ё:'e',ж:'(?:zh|j)',з:'z',и:'[ie]',й:'[yji]',к:'[kc]',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'[sc]',т:'t',у:'[uy]',ф:'(?:f|ph)',х:'[hx]',ц:'c',ч:'(?:ch|c)',ш:'(?:sh|s)',щ:'(?:sh|s)',ы:'[yi]',э:'e',ю:'(?:yu|u)',я:'(?:ya|a)',ь:'',ъ:''};
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function lc(x){return String(x||'').toLowerCase().replace(/ё/g,'е')}
function plain(h){return String(h||'').replace(/<[^>]+>/g,'')}
function escRe(x){return x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function isCyr(q){return /[а-яё]/i.test(q)&&!/[a-z]/i.test(q)}
function layout(q){return Array.from(q.toLowerCase()).map(function(c){var k=RU.indexOf(c);return k>=0?EN[k]:c}).join('').replace(/[\[\];',.]/g,'')}
function tsrc(q){var pv='';return '\\b'+Array.from(lc(q).replace(/\s+/g,'')).map(function(c){var r=TR[c]!=null?TR[c]:escRe(c);if(c===pv&&r)r=r+'?';pv=c;return r}).join('')}
D.forEach(function(e){var h=e.t.split(/\s[—-]\s/)[0];e.head=lc(h);e.all=lc(e.t+' '+e.f);e.words=e.all.split(/[^a-zа-я0-9&]+/).filter(Boolean)});
function local(q){
  var ql=lc(q.trim()),out=[];if(ql.length<2)return out;
  var rxs=[new RegExp('^'+escRe(ql))];
  var alts=[ql];
  if(isCyr(q)){var lf=layout(q);if(/^[a-z0-9 ]{2,}$/.test(lf))alts.push(lf);}
  D.forEach(function(e){
    var sc=0;
    alts.forEach(function(a){
      if(e.head===a)sc=Math.max(sc,100);
      else if(e.head.indexOf(a)===0&&a.length>=2)sc=Math.max(sc,70-Math.min(30,e.head.length-a.length));
      else if(e.words.indexOf(a)>=0)sc=Math.max(sc,60);
      else if(a.length>=4&&e.all.indexOf(a)>=0)sc=Math.max(sc,35)});
    if(!sc&&isCyr(q)&&ql.replace(/\s+/g,'').length>=3){var rx=new RegExp(tsrc(q),'i');if(rx.test(e.head)&&e.head.length<=Math.max(8,ql.length*2+2))sc=90-Math.abs(e.head.length-ql.replace(/\s+/g,'').length)*4;else if(e.words.some(function(w){return rx.test(w)&&w.length<=ql.length*2+2}))sc=45}
    if(!sc&&ql.length>=4){var st=ql.length>5?ql.slice(0,-2):ql;if(e.all.indexOf(st)>=0)sc=25}
    if(sc)out.push({e:e,sc:sc})});
  out.sort(function(a,b){return b.sc-a.sc});return out.slice(0,5);
}
function card(e){
  var h='<div class="tk"><h2>'+esc(e.t.split(/\s[—-]\s/)[0])+'</h2>';
  if(e.f)h+='<div class="en">'+esc(e.f)+'</div>';
  else if(e.t.indexOf(' — ')>0)h+='<div class="en">'+esc(e.t.split(' — ').slice(1).join(' — '))+'</div>';
  h+='<div class="lb">Суть</div><p>'+esc(e.d)+'</p>';
  if(e.x)h+='<div class="lb">Формула</div>'+e.x.replace(/<code>/g,'<code>').replace(/<span class="fx">/g,'<span class="fx">');
  if(e.ut)h+='<a class="ls" href="'+esc(e.u)+'" data-hq="'+esc(e.hq||'')+'" data-hs="'+esc(e.hs||'')+'" data-lid="'+esc(e.u.split('#learn/')[1])+'">Разобрано в уроке: '+esc(e.ut)+' →</a><a class="gl" href="'+esc(e.g)+'">Вариант в глоссарии</a>';
  else h+='<a class="ls" href="'+esc(e.g)+'">Разобрано в курсе →</a>';
  return h+'</div>'}
document.addEventListener('click',function(ev){var a=ev.target.closest&&ev.target.closest('a[data-lid]');if(a)try{sessionStorage.setItem('fin:hl',JSON.stringify({id:a.getAttribute('data-lid'),q:a.getAttribute('data-hq'),hs:a.getAttribute('data-hs')}))}catch(x){}});
var box=document.getElementById('sr'),web=document.getElementById('web'),inp=document.getElementById('q'),tmr=null,seq=0;
var FIN=/финанс|эконом|бухгалтер|учёт|учет|аудит|инвест|банк|акци[июя]|облигац|кредит|займ|налог|рынок|рынк|бирж|капитал|прибыл|выруч|доход|стоимост|валют|страхов|торгов|бизнес|компани|предприят|производств|логистик|цепочк|автомобил|сборк|таможн|пошлин|товар|актив|долг|процент|ставк|менеджмент|маркетинг|контракт|финтех|криптовалют|\b(financ|econom|account|audit|invest|bank|stock|share|bond|credit|loan|debt|tax|market|exchange|capital|profit|revenue|income|valuation|currency|insurance|trading|trade|business|company|corporat|manufactur|supply chain|logistic|asset|equity|interest rate|management|marketing|customs|tariff|assembl|automotive|vehicle)/i;
function nrm(x){return String(x||'').toLowerCase().replace(/[^a-zа-яё0-9]+/g,'')}
function wapi(lang,qs){return fetch('https://'+lang+'.wikipedia.org/w/api.php?action=query&format=json&origin=*&'+qs).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(j){var p=j.query&&j.query.pages?j.query.pages:{};return Object.keys(p).map(function(k){return p[k]})})}
function wiki(q){
  var my=++seq,cy=isCyr(q),lang=cy?'ru':'en',other=cy?'en':'ru',nq=nrm(q),H='<div class="sh">Из интернета (Википедия)</div>';
  web.innerHTML=H+'<p class="sm">Ищу…</p>';
  var X='&prop=extracts|langlinks|info&exintro=1&explaintext=1&exchars=700&lllang='+other+'&lllimit=1&inprop=url';
  Promise.all([wapi(lang,'titles='+encodeURIComponent(q)+'&redirects=1'+X).catch(function(){return[]}),wapi(lang,'generator=search&gsrlimit=15&gsrsearch='+encodeURIComponent('intitle:'+q)+X).catch(function(){return null})]).then(function(rs){
    if(my!==seq)return;
    if(rs[1]===null&&!rs[0].length)throw 0;
    var ex=rs[0].filter(function(p){return p.missing===undefined&&p.extract});
    var se=(rs[1]||[]).sort(function(a,b){return a.index-b.index}).filter(function(p){return nrm(p.title).indexOf(nq)>=0}).sort(function(a,b){return nrm(a.title).length-nrm(b.title).length});
    var seen={},pg=ex.concat(se).filter(function(p){var k=nrm(p.title);if(seen[k])return false;seen[k]=1;return FIN.test(p.title+' '+(p.extract||''))&&!/значения\)|disambiguation/i.test(p.title)}).slice(0,3);
    if(!pg.length){web.innerHTML=H+'<p class="sm">Подходящей статьи Википедии про финансы не нашлось (искал по названию «'+esc(q)+'»). Попробуй полное название или другой язык.</p>';return}
    var need=!cy?pg.filter(function(p){return p.langlinks&&p.langlinks[0]}):[];
    var ru={};
    var step=need.length?wapi('ru','titles='+encodeURIComponent(need.map(function(p){return p.langlinks[0]['*']}).join('|'))+'&prop=extracts&exintro=1&explaintext=1&exchars=700&redirects=1').then(function(rp){rp.forEach(function(r){ru[nrm(r.title)]=r.extract||''})}).catch(function(){}):Promise.resolve();
    return step.then(function(){
      if(my!==seq)return;
      web.innerHTML=H+pg.map(function(p){
        var ll=p.langlinks&&p.langlinks[0]?p.langlinks[0]['*']:'';
        var ex=(!cy&&ll&&ru[nrm(ll)])||p.extract||'';var inRu=cy||(ll&&ru[nrm(ll)]);
        var ttl=inRu&&!cy&&ll?ll:p.title;
        return '<div class="tk web"><h2>'+esc(ttl)+'</h2>'+(ll?'<div class="en">'+(cy?'По-английски':'English')+': '+esc(cy?ll:p.title)+'</div>':'')+'<div class="lb">Суть</div><p>'+esc(ex)+'</p><div class="src">Википедия'+(inRu||cy?'':' (по-английски: русской статьи нет)')+', не проверено по курсу. Формул здесь нет — их смотри в карточках выше.</div><a href="'+esc(p.fullurl)+'" target="_blank" rel="noopener">Открыть статью →</a></div>'}).join('')});
  }).catch(function(){if(my!==seq)return;web.innerHTML=H+'<p class="sm">Не получилось достучаться до Википедии. Проверь интернет.</p>'});
}
function run(){
  var q=inp.value.trim();
  if(q.length<2){box.innerHTML='<p class="sm">Напиши термин по-русски или по-английски: «WACC», «вакк», «чистый долг», «accretion», «ebitda». Покажу расшифровку, перевод, суть и формулу из курса, а если в курсе нет — можно поискать в Википедии кнопкой.</p>';web.innerHTML='';seq++;return}
  var r=local(q);
  box.innerHTML=r.length?'<div class="sh">Из курса</div>'+r.map(function(x){return card(x.e)}).join(''):'<div class="sh">Из курса</div><p class="sm">В курсе такого термина нет. Напиши мне в чат — добавлю.</p>';
  clearTimeout(tmr);seq++;web.innerHTML='<button type="button" class="wbtn" id="wbtn">Поискать «'+esc(q)+'» в интернете</button><p class="sm">Покажу только статьи Википедии про финансы и смежные темы.</p>';document.getElementById('wbtn').onclick=function(){wiki(q)};
}
inp.addEventListener('input',run);
var q0=new URLSearchParams(location.search).get('q');if(q0)inp.value=q0;run();inp.focus();
})();
</script>"""
slovar_body = ('<div class="w">\n  ' + topbar('artem.html', 'Артем') + '\n  <h1>Словарь</h1>\n'
               '  <div class="sq"><input id="q" type="search" placeholder="Любой финансовый термин: WACC, вакк, чистый долг…" autocomplete="off" enterkeyhint="search" aria-label="Термин"></div>\n'
               '  <div id="sr"></div><div id="web"></div>\n</div>\n')
slovar_html = page('Hub · Словарь', slovar_body, 'artem').replace('</head>', SLOVAR_CSS + '</head>', 1).replace('</body>', SLOVAR_JS.replace('__DATA__', SLOVAR_DATA) + BACK_JS + '</body>', 1)
open(os.path.join(ROOT, 'slovar.html'), 'w', encoding='utf-8').write(slovar_html)
print('ok slovar.html', len(slovar_html))

# замок для страниц Артема (ucheba.html, finance.html) — его вставляют make_ucheba.py и build_finance.py
open(os.path.join(ROOT, 'src', 'finance', 'gate_artem.html'), 'w', encoding='utf-8').write(gate('artem'))

for name, html in (('index.html', index_html), ('artem.html', artem_html), ('nastya.html', nastya_html), ('nastya-ucheba.html', nu_html), ('search.html', search_html)):
    open(os.path.join(ROOT, name), 'w', encoding='utf-8').write(html)
    print('ok', name, len(html))
