#!/usr/bin/env python3
"""Главная Hub с профилями. Из шаблона src/finance/hub.html (стили, масштаб, подсказка об установке) собирает:
  index.html         — выбор профиля (Артем / Настя) и ввод пароля;
  artem.html         — разделы Артема: Учёба и Финансы;
  nastya.html        — разделы Насти: Учёба, English;
  nastya-ucheba.html — Учёба Насти (расписание);
  nastya-klava.html  — клавиатурный тренажёр Насти (src/typing/).
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
# «Финансы» на главной — одна карточка; нажатие открывает выбор из трёх разделов (#fin), «← Артем» возвращает назад
cards_artem = cards_artem.replace('<div class="cards">', '<div class="cards" data-group="">', 1).replace('<a class="cover" href="finance.html#learn" aria-label="Финансы">', '<a class="cover" href="#fin" aria-label="Финансы">', 1)
cards_artem = cards_artem[:cards_artem.rindex('\n  </div>')] + """
    <div class="card u"><a class="cover" href="studio.html" aria-label="Студия"></a>
      <div class="ic">▶</div><b>Студия</b><span>Короткие вертикальные видео: сценарий, персонажи, сцены, музыка, нейроголос, запись в MP4</span>
      <div class="links"><a href="studio.html">Открыть</a></div>
    </div>
  </div>"""
cards_artem += ('''
  <div class="cards" data-group="fin" hidden>
    <div class="card f"><a class="cover" href="finance.html#learn" aria-label="Учебник финансов"></a>
      <div class="ic">₽</div><b>Учебник финансов</b><span>Инвестиции и корпоративные финансы для собеседований: 5 шагов, шпаргалки, сектора, глоссарий</span>
      <div class="links"><a href="finance.html#learn">Уроки</a><a href="finance.html#learn/sektor">Сектора</a><a href="finance.html#learn/glossariy">Глоссарий</a></div>
    </div>
    <div class="card f"><a class="cover" href="finance.html#markets" aria-label="Рынок"></a>
      <div class="ic">%</div><b>Рынок</b><span>Что происходит сегодня и почему: цены, новости с причинами, календарь</span>
      <div class="links"><a href="finance.html#markets">Сегодня</a><a href="finance.html#markets/ru">Россия</a><a href="finance.html#markets/us">Мир</a><a href="finance.html#markets/news">Новости</a></div>
    </div>
    <div class="card f"><a class="cover" href="lectures.html" aria-label="Презентации"></a>
      <div class="ic">▤</div><b>Презентации</b><span>Отрасли, сделки и модели по темам: короткие презентации по курсам School of Finance, IB Club, Campus Finance</span>
      <div class="links"><a href="lectures.html">Все темы</a></div>
    </div>
    <div class="card f"><a class="cover" href="fin2/index.html" aria-label="Облигации и акции"></a>
      <div class="ic">2</div><b>Облигации и акции</b><span>Скринеры, карточки выпусков, ОФЗ, макро, фонды</span>
      <div class="links"><a href="fin2/index.html#screener">Облигации</a><a href="fin2/akcii.html#screener">Акции</a><a href="fin2/index.html#auctions">ОФЗ</a><a href="fin2/akcii.html#funds">Фонды</a></div>
    </div>
  </div>
  <script>
  (function(){var N={fin:'Финансы'};
  function v(){var g=location.hash.slice(1);if(!N[g])g='';
    document.querySelectorAll('[data-group]').forEach(function(e){e.hidden=e.getAttribute('data-group')!==g});
    var h=document.getElementById('hh');if(h)h.textContent=N[g]||'Артем';var b=document.getElementById('hback');if(b)b.hidden=!g;
    var f=document.querySelector('.hsrch');if(f)f.hidden=!!g}
  window.addEventListener('hashchange',v);v()})();
  </script>''')
# Главная Артёма: два входа (Учёба, Финансы) и одна строка поиска по всему сайту.
HUBSEARCH = ('<form class="hsrch" action="search.html" method="get" role="search"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
             '<input type="search" name="q" placeholder="Найти по сайту: WACC, ОФЗ, сделки, юридические лица…" autocomplete="off" enterkeyhint="search" aria-label="Поиск по сайту"></form>')
artem_body = ('<div class="w">\n  ' + topbar('index.html', 'Профили', 'artem') + '\n  <a id="hback" class="hback" href="#" hidden>← Артем</a>\n  <h1 id="hh">Артем</h1>\n  ' + HUBSEARCH + '\n  '
              + cards_artem + '\n  ' + foot + '\n</div>\n' + LOGOUT_JS)
SEARCH_BTN = '<a class="sbtn" href="search.html" aria-label="Поиск по сайту"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>Поиск</a>'
artem_body = artem_body.replace('<div class="tr">', '<div class="tr">' + SEARCH_BTN, 1)
artem_html = page('Hub · Артем', artem_body, 'artem')   # просто: Артем → Учёба, Финансы (сводку «Сегодня» убрали)

# ---------------- nastya.html ----------------
nastya_cards = ('<div class="cards">\n    <div class="card u"><a class="cover" href="nastya-ucheba.html" aria-label="Учёба"></a>\n'
                '      <div class="ic">§</div><b>Учёба</b><span>Расписание группы</span>\n'
                '      <div class="links"><a href="nastya-ucheba.html">Открыть</a></div>\n    </div>\n'
                '    <div class="card e"><a class="cover" href="english.html" aria-label="English"></a>\n'
                '      <div class="ic">Aa</div><b>English</b><span>Курс A2 → B1+: уроки, слова, справочник</span>\n'
                '      <div class="links"><a href="english.html">Уроки</a><a href="english.html#words">Слова</a><a href="english.html#ref">Справочник</a></div>\n    </div>\n'
                '    <div class="card k"><a class="cover" href="nastya-klava.html" aria-label="Клавиатура"></a>\n'
                '      <div class="ic">⌨</div><b>Клавиатура</b><span>Тренажёр печати: уроки для новичка, слова, тексты, на время, игра</span>\n'
                '      <div class="links"><a href="nastya-klava.html">Учиться печатать</a></div>\n    </div>\n  </div>')
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


# ---------------- nastya-klava.html: клавиатурный тренажёр Насти ----------------
_tp = os.path.join(ROOT, 'src', 'typing')
_rd = lambda n: open(os.path.join(_tp, n), encoding='utf-8').read()
kl_body = _rd('body.html').replace('<!--TOPBAR-->', topbar('nastya.html', 'Настя') + '\n  ', 1) + '<script>\n' + _rd('data.js') + '\n' + _rd('typing.js') + '\n</script>'
kl_html = page('Клавиатура · Настя', kl_body, 'nastya').replace('</head>', '<style>\n' + _rd('typing.css') + '</style></head>', 1)


# ---------------- lectures.html: лекции-презентации (src/lectures/) ----------------
_lp = os.path.join(ROOT, 'src', 'lectures')
_lr = lambda n: open(os.path.join(_lp, n), encoding='utf-8').read()
lec_body = _lr('body.html').replace('<!--TOPBAR-->', topbar('artem.html#fin', 'Финансы') + '\n  ', 1) + '<script>\n' + _lr('lectures.js') + '\n</script>'
lec_html = page('Презентации · Hub', lec_body, 'artem').replace('</head>', '<style>\n' + _lr('lectures.css') + '</style></head>', 1)


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
var KIND={ch:'Глава',sec:'Сектор',term:'Термин',co:'Компания',tk:'Билет',nt:'Конспект',lc:'Презентация'},TAB=[['',['ch','sec','term','co','tk','nt','lc'],'Всё'],['f',['ch','sec','term','lc'],'Финансы'],['c',['co'],'Компании'],['u',['tk','nt'],'Учёба']];
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
  var id=m[2].replace(/^(learn\/sektor|learn|world\/sectors)\//,'').replace(/^glossariy\/.*/,'glossariy');try{sessionStorage.setItem(m[1]==='finance'?'fin:hl':'uch:hl',JSON.stringify({id:id,q:a.getAttribute('data-q'),hs:a.getAttribute('data-hs')||''}))}catch(x){}});
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


# slovar.html больше не собирается: словарь слит с общим поиском (search.html), старый адрес — переадресация (scripts/build_all.sh)


# замок для страниц Артема (ucheba.html, finance.html) — его вставляют make_ucheba.py и build_finance.py
open(os.path.join(ROOT, 'src', 'finance', 'gate_artem.html'), 'w', encoding='utf-8').write(gate('artem'))

# ---------------- studio.html: Студия видео (src/studio/) ----------------
_sp = os.path.join(ROOT, 'src', 'studio')
_sr = lambda n: open(os.path.join(_sp, n), encoding='utf-8').read()
st_body = _sr('body.html').replace('<!--TOPBAR-->', topbar('artem.html', 'Артём') + '\n  ', 1) + '<script>\n' + '\n'.join(_sr(n) for n in ('engine.js', 'data.js', 'audio.js', 'net.js', 'ui.js')) + '\n</script>'
st_html = page('Студия · Hub', st_body, 'artem').replace('</head>', '<style>\n' + _sr('studio.css') + '</style></head>', 1)

for name, html in (('index.html', index_html), ('artem.html', artem_html), ('nastya.html', nastya_html), ('nastya-ucheba.html', nu_html), ('nastya-klava.html', kl_html), ('search.html', search_html), ('lectures.html', lec_html), ('studio.html', st_html)):
    open(os.path.join(ROOT, name), 'w', encoding='utf-8').write(html)
    print('ok', name, len(html))
