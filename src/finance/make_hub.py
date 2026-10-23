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
PROF = {'artem': ('Артем', '11231', 'artem.html'), 'nastya': ('Настя', '1591', 'nastya.html')}
TOK = {p: hashlib.sha256(('hub:%s:%s' % (p, v[1])).encode()).hexdigest()[:24] for p, v in PROF.items()}

head = TPL[:TPL.index('<body>')]
tail_js = TPL[TPL.index('<script>\ntry{var t=localStorage.getItem'):TPL.index('</body>')]
foot = re.search(r'<div class="zmr">.*?</p>', TPL, re.S).group(0)


def gate(p):
    """Скрипт в самом начале <head>: без пароля — на главную, к вводу пароля, потом обратно."""
    return ("<script>(function(){var P='%s',T='%s';function ok(){try{if(localStorage.getItem('hub:auth:'+P)===T)return true}catch(e){}"
            "return document.cookie.indexOf('hub_'+P+'='+T)>=0}"
            "if(!ok()){document.documentElement.style.visibility='hidden';var f=location.pathname.slice(location.pathname.lastIndexOf('/')+1)||'index.html';"
            "location.replace('index.html?login='+P+'&next='+encodeURIComponent(f+location.search+location.hash))}"
            "else{try{localStorage.setItem('hub:auth:'+P,T);localStorage.setItem('hub:last',P)}catch(e){}}})();</script>") % (p, TOK[p])


EXTRA_CSS = """<style>
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-28px 0 26px}
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
.top .tr{display:flex;gap:8px;align-items:center}
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
    return h + '<body>\n' + body + '\n' + THEME_JS + tail_js + '</body></html>\n'


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
var q=new URLSearchParams(location.search),nextUrl=q.get('next')||'';if(!/^[a-z][a-z0-9\-]*\.html([?#].*)?$/i.test(nextUrl))nextUrl='';
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

artem_body = ('<div class="w">\n  ' + topbar('index.html', 'Профили', 'artem') + '\n  <h1>Артем</h1>\n  '
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
</style>"""
SEARCH_JS = r"""<script>
(function(){
var KIND={ch:'Глава',sec:'Сектор',term:'Термин',co:'Компания',tk:'Билет',nt:'Конспект'},TAB=[['',['ch','sec','term','co','tk','nt'],'Всё'],['f',['ch','sec','term'],'Финансы'],['c',['co'],'Компании'],['u',['tk','nt'],'Учёба']];
var IDX=null,Q='',tab='',box=document.getElementById('sr'),inp=document.getElementById('q'),tabs=document.getElementById('sf'),kb=-1,res=[];
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function norm(s){return String(s||'').toLowerCase().replace(/ё/g,'е')}
function toks(q){return norm(q).split(/[^a-zа-я0-9]+/).filter(function(x){return x.length>0})}
function stem(w){return w.length>5?w.slice(0,w.length-2):w.length>3?w.slice(0,w.length-1):w}
function load(){box.innerHTML='<p class="sm">Загружаю индекс…</p>';
  fetch('search-index.json').then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(j){IDX=j.map(function(x){return {k:x[0],t:x[1],x:x[2],u:x[3],tn:norm(x[1]),xn:norm(x[2])}});run()})
  .catch(function(){box.innerHTML='<p class="sm">Не удалось загрузить индекс поиска. <button type="button" class="sbtn" id="rt">Повторить</button></p>';var b=document.getElementById('rt');if(b)b.onclick=load})}
function score(it,ts,ph){var s=0,i,t,tn=it.tn,xn=it.xn;
  if(ph&&tn.indexOf(ph)>=0)s+=30;if(ph&&xn.indexOf(ph)>=0)s+=6;
  for(i=0;i<ts.length;i++){t=ts[i];var st=stem(t),a=tn.indexOf(st),b=xn.indexOf(st);
    if(a<0&&b<0)return 0;
    if(a>=0)s+=(a===0||tn.charAt(a-1)===' ')?12:7;if(b>=0)s+=2+Math.min(3,(xn.split(st).length-1)*.5)}
  return s}
function snip(it,ts){var x=it.x,xn=it.xn,p=-1,i,st;for(i=0;i<ts.length&&p<0;i++){st=stem(ts[i]);p=xn.indexOf(st)}
  var a=Math.max(0,p<0?0:p-60),sn=x.slice(a,a+170);if(a>0)sn='…'+sn;if(a+170<x.length)sn+='…';return hl(sn,ts)}
function hl(t,ts){var h=esc(t);ts.forEach(function(w){var st=stem(w);if(st.length<2)return;h=h.replace(new RegExp('('+st.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'[а-яa-z0-9]*)','gi'),'<mark>$1</mark>')});return h}
function run(){if(!IDX)return;var ts=toks(Q);
  if(!ts.length){box.innerHTML='<p class="sm">Начни вводить: «WACC», «Сбербанк», «ст. 125», «лизинг»… Ищет по главам, терминам, секторам, компаниям, билетам и конспектам.</p>';tabs.innerHTML='';res=[];return}
  var ph=norm(Q).trim(),all=[];IDX.forEach(function(it){var s=score(it,ts,ph);if(s>0)all.push({it:it,s:s})});all.sort(function(a,b){return b.s-a.s});
  var cnt={};TAB.forEach(function(t){cnt[t[0]]=all.filter(function(r){return t[1].indexOf(r.it.k)>=0}).length});
  tabs.innerHTML=TAB.map(function(t){return '<button type="button" data-t="'+t[0]+'" class="'+(t[0]===tab?'on':'')+'">'+t[2]+'<em>'+cnt[t[0]]+'</em></button>'}).join('');
  var cur=TAB.filter(function(t){return t[0]===tab})[0],list=all.filter(function(r){return cur[1].indexOf(r.it.k)>=0}).slice(0,40);res=list;kb=-1;
  box.innerHTML=list.length?list.map(function(r,i){var it=r.it;return '<a href="'+esc(it.u)+'" data-i="'+i+'"><small>'+KIND[it.k]+'</small><b>'+hl(it.t,ts)+'</b><p>'+snip(it,ts)+'</p></a>'}).join(''):'<p class="sm">Ничего не найдено по «'+esc(Q)+'». Попробуй другое слово или часть слова.</p>'}
var tm=null;inp.addEventListener('input',function(){Q=inp.value;clearTimeout(tm);tm=setTimeout(function(){run();try{history.replaceState(null,'',Q?'?q='+encodeURIComponent(Q):location.pathname)}catch(e){}},120)});
tabs.addEventListener('click',function(e){var b=e.target.closest('[data-t]');if(!b)return;tab=b.getAttribute('data-t');run()});
inp.addEventListener('keydown',function(e){var as=box.querySelectorAll('a');if(!as.length)return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();kb=Math.max(0,Math.min(as.length-1,kb+(e.key==='ArrowDown'?1:-1)));as.forEach(function(a,i){a.classList.toggle('kb',i===kb)});as[kb].scrollIntoView({block:'nearest'})}
  if(e.key==='Enter'){var a=as[Math.max(0,kb)];if(a)location.href=a.getAttribute('href')}});
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
def _slovar_data():
    out = []; seen = set()
    for l in open(os.path.join(ROOT, 'src', 'finance', 'content', '98_glossary.md'), encoding='utf-8'):
        m = re.match(r'^\| \*\*(.+?)\*\* \|(.*?)\|(.*?)\|(.*)\|\s*$', l)
        if not m: continue
        t, full, d, f = [x.strip() for x in m.groups()]
        out.append({'t': t, 'f': full, 'd': d, 'x': f, 'u': 'finance.html#learn/glossariy/' + urllib.parse.quote(re.sub(r'\s+', ' ', t), safe='')}); seen.add(t.lower())
    for pats, title, d in list(_T.RICH) + list(_T.EXTRA):
        head = re.split(r'\s[—-]\s', title)[0].strip()
        if head.lower() in seen: continue
        seen.add(head.lower())
        out.append({'t': title, 'f': '', 'd': d, 'x': '', 'u': 'finance.html#learn/glossariy'})
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
.tk.web{border-style:dashed}.tk.web .src{color:var(--faint);font:400 12px/1.4 system-ui,sans-serif;margin-top:6px}
.sh{margin:18px 0 8px;color:var(--faint);font:600 12px/1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}
.sm{color:var(--muted);font:400 14px/1.5 system-ui,sans-serif;padding:8px 0}
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
  h+='<a href="'+esc(e.u)+'">Разобрано в курсе →</a></div>';return h}
var box=document.getElementById('sr'),web=document.getElementById('web'),inp=document.getElementById('q'),tmr=null,seq=0;
function wiki(q){
  var my=++seq,cy=isCyr(q),lang=cy?'ru':'en',other=cy?'en':'ru';
  web.innerHTML='<div class="sh">Из интернета (Википедия)</div><p class="sm">Ищу…</p>';
  var u='https://'+lang+'.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=3&gsrsearch='+encodeURIComponent(q+(cy?' финансы':' finance'))+'&prop=extracts|langlinks|info&exintro=1&explaintext=1&exchars=650&lllang='+other+'&lllimit=1&inprop=url';
  fetch(u).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(j){
    if(my!==seq)return;var pg=j.query&&j.query.pages?Object.keys(j.query.pages).map(function(k){return j.query.pages[k]}).sort(function(a,b){return a.index-b.index}):[];
    if(!pg.length){web.innerHTML='<div class="sh">Из интернета (Википедия)</div><p class="sm">Ничего не нашлось. Попробуй написать по-английски или иначе.</p>';return}
    web.innerHTML='<div class="sh">Из интернета (Википедия)</div>'+pg.map(function(p){
      var ll=p.langlinks&&p.langlinks[0]?p.langlinks[0]['*']:'';
      return '<div class="tk web"><h2>'+esc(p.title)+'</h2>'+(ll?'<div class="en">'+(cy?'По-английски':'По-русски')+': '+esc(ll)+'</div>':'')+'<div class="lb">Суть</div><p>'+esc(p.extract||'')+'</p><div class="src">Википедия, не проверено по курсу. Формул здесь нет — их смотри в карточках выше.</div><a href="'+esc(p.fullurl)+'" target="_blank" rel="noopener">Открыть статью →</a></div>'}).join('')})
  .catch(function(){if(my!==seq)return;web.innerHTML='<div class="sh">Из интернета (Википедия)</div><p class="sm">Не получилось достучаться до Википедии. Проверь интернет.</p>'});
}
function run(){
  var q=inp.value.trim();
  if(q.length<2){box.innerHTML='<p class="sm">Напиши термин по-русски или по-английски: «WACC», «вакк», «чистый долг», «accretion», «ebitda». Покажу расшифровку, перевод, суть и формулу из курса, а ниже — что есть в Википедии.</p>';web.innerHTML='';seq++;return}
  var r=local(q);
  box.innerHTML=r.length?'<div class="sh">Из курса</div>'+r.map(function(x){return card(x.e)}).join(''):'<div class="sh">Из курса</div><p class="sm">В курсе такого термина нет. Напиши мне в чат — добавлю.</p>';
  clearTimeout(tmr);tmr=setTimeout(function(){wiki(q)},450);
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
