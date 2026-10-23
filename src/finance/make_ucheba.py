import sys
src,out=sys.argv[1:3]
t=open(src,encoding='utf-8').read()
# стрелка в левом верхнем углу → главная «Учёба / Финансы». Цвета берутся из переменных темы, поэтому подходит к любому оформлению.
btn=('<a id="hubfix" href="artem.html" aria-label="Учёба / Финансы" title="Учёба / Финансы">'
     '<svg viewBox="0 0 24 24"><path d="M19 12H5.5M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a>')
# Стрелка живёт в шапке перед «§ Конспекты». В «Газете» и «Книге» (заголовок по центру) на компьютере —
# зеркальная пара к круглой кнопке «Aa» справа, на телефоне — слева в строке заголовка.
css=('<style>'
     '#hubfix{flex:none;display:grid;place-items:center;text-decoration:none;color:var(--fg,#25221C);width:34px;height:34px;margin:0 8px 0 -4px;'
     'background:color-mix(in srgb,var(--bg,#F4F1E8) 86%,transparent);border:1px solid var(--line,#D9D3C2);border-radius:999px;'
     'transition:background .15s,color .15s}'
     '#hubfix svg{width:16px;height:16px;transition:transform .15s}'
     '#hubfix:hover,#hubfix:active{background:var(--fg,#25221C);color:var(--bg,#F4F1E8);border-color:var(--fg,#25221C)}#hubfix:hover svg{transform:translateX(-2px)}'
     'html:root[data-skin=c] #hubfix,html:root[data-skin=f] #hubfix{position:absolute;left:4px;top:50%;margin:-18px 0 0;width:36px;height:36px}'
     '@media (min-width:900px){'
     'html:root[data-skin=c] #hubfix,html:root[data-skin=f] #hubfix{position:fixed;z-index:70;top:12px;left:18px;margin:0;width:42px;height:42px;'
     '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 2px 10px rgba(0,0,0,.08)}'
     'html:root[data-skin=c] #hubfix svg,html:root[data-skin=f] #hubfix svg{width:19px;height:19px}}'
     '@media (prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}'
     '</style>')
assert t.count('<title>Конспекты семинаров</title>')==1
t=t.replace('<title>Конспекты семинаров</title>','<title>Учёба</title>'+css,1)
old='<a class="brand" href="#" data-go="" aria-label="Все предметы">'
assert t.count(old)==1
t=t.replace(old,btn+old,1)
import os
zjs=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'zoom.js'),encoding='utf-8').read()
t=t.replace('<title>Учёба</title>','<title>Учёба</title><script>'+zjs+'</script>',1)
old='<div class="fzrow"><span>Размер текста</span><button type="button" data-fz="-1" aria-label="Меньше">А−</button><b>\'+Math.round(getFz()*100)+\'%</b><button type="button" data-fz="1" aria-label="Больше">А+</button></div>'
assert t.count(old)==1, 'fzrow'
# шрифты Google не блокируют первую отрисовку (в РФ они иногда грузятся долго)
import re
t,nf=re.subn(r'<link rel="stylesheet" href="(https://fonts\.googleapis\.com/[^"]+)">',lambda m:'<link rel="stylesheet" href="%s" media="print" onload="this.media=\'all\'"><noscript><link rel="stylesheet" href="%s"></noscript>'%(m.group(1),m.group(1)),t)
assert nf==1,'fonts'
# замок профиля «Артем» (пароль) — в самом начале <head>
_g=os.path.join(os.path.dirname(os.path.abspath(__file__)),'gate_artem.html')
assert t.count('<meta charset="utf-8">')>=1
t=t.replace('<meta charset="utf-8">','<meta charset="utf-8">'+open(_g,encoding='utf-8').read(),1)
open(out,'w',encoding='utf-8').write(t);print('ok',len(t.encode()))
