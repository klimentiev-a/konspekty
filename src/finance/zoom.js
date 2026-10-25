(function(){
var Z=[0.8,0.9,1,1.1,1.2,1.3,1.45,1.6];
function g(){try{if(!localStorage.getItem('siteZoomLocal')){localStorage.removeItem('siteZoom');localStorage.setItem('siteZoomLocal','1')}var v=parseFloat(localStorage.getItem('siteZoom'));return v>0?v:1}catch(e){return 1}}
function ap(v){var d=document.documentElement;d.style.zoom=(v===1?'':String(v));d.style.setProperty('--iz',String(+(1/v).toFixed(4)));
  if(!document.getElementById('iz-css')){var s=document.createElement('style');s.id='iz-css';s.textContent='.zm,.zmr,.skinmenu,.zq,.ztop,.zback{zoom:var(--iz,1)}html,body{overflow-x:clip}';(document.head||d).appendChild(s)}}
ap(g());
window.siteZoomGet=g;
window.siteZoom=function(d){var v=g(),i=Z.indexOf(v);if(i<0)i=2;i=d===0?2:Math.max(0,Math.min(Z.length-1,i+d));v=Z[i];try{localStorage.setItem('siteZoom',String(v))}catch(e){}ap(v);
  document.querySelectorAll('.szv').forEach(function(o){o.textContent=Math.round(v*100)+'%'});try{window.dispatchEvent(new Event('resize'))}catch(e){}return v};
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-sz]');if(!b)return;e.preventDefault();e.stopPropagation();var r0=b.getBoundingClientRect();siteZoom(+b.getAttribute('data-sz'));
  var r1=b.getBoundingClientRect(),dx=r1.left-r0.left,dy=r1.top-r0.top;if(dx||dy){try{window.scrollBy(dx,dy)}catch(er){}}
  var w=b.closest('.zm,.zmr,.skinmenu'),r2=b.getBoundingClientRect(),ex=r2.left-r0.left,ey=r2.top-r0.top;
  if(w&&(Math.abs(ex)>.5||Math.abs(ey)>.5)){var t=w.__t||[0,0];t=[t[0]-ex,t[1]-ey];w.__t=t;w.style.transition='none';w.style.transform='translate('+t[0]+'px,'+t[1]+'px)'}
  if(w&&w.__t){clearTimeout(w.__tm);w.__tm=setTimeout(function(){w.style.transition='transform .25s';w.style.transform='';w.__t=null},1400)}},true);   // кнопка остаётся под курсором
window.addEventListener('storage',function(e){if(e.key==='siteZoom')ap(g())});
document.addEventListener('DOMContentLoaded',function(){var v=g();document.querySelectorAll('.szv').forEach(function(o){o.textContent=Math.round(v*100)+'%'})});
})();
/* Hub: service worker (мгновенная загрузка из кэша), тихое обновление до новой версии, фоновая подгрузка соседних разделов */
(function(){
  if(!('serviceWorker' in navigator)||!/^https?:$/.test(location.protocol))return;
  try{navigator.serviceWorker.register('sw.js').catch(function(){})}catch(e){}
  var t0=Date.now(),touched=false,shown=false;
  ['pointerdown','keydown','scroll','touchstart'].forEach(function(ev){window.addEventListener(ev,function(){touched=true},{passive:true,once:true})});
  function page(u){u=(u||'').replace(/[?#].*$/,'');var f=u.slice(u.lastIndexOf('/')+1);return f||'index.html'}
  navigator.serviceWorker.addEventListener('message',function(e){
    if(!e.data||e.data.t!=='hub-updated'||shown||page(e.data.url)!==page(location.href))return;
    shown=true;
    var rk='hubReload:'+page(location.href),last=0;try{last=+sessionStorage.getItem(rk)||0}catch(er){}
    if(Date.now()-last<30000)return;                                  // эта страница только что перезагрузилась на свежую версию
    var d=document.createElement('div');
    d.setAttribute('role','status');
    d.style.cssText='position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 16px);transform:translate(-50%,140%);z-index:9999;display:flex;align-items:center;gap:12px;padding:8px 8px 8px 16px;border-radius:999px;border:1px solid var(--line,#D9D3C2);background:var(--surface,#FBF9F3);color:var(--fg,#25221C);box-shadow:0 10px 30px rgba(0,0,0,.18);font:500 14px/1.2 system-ui,sans-serif;white-space:nowrap;transition:transform .4s cubic-bezier(.2,.9,.25,1)';
    d.innerHTML='<span>Hub обновился</span><button type="button" style="border:0;border-radius:999px;padding:9px 14px;background:var(--a2,var(--accent,#1F6B57));color:#fff;font:600 14px/1 system-ui,sans-serif;cursor:pointer">Обновить</button>';
    d.querySelector('button').onclick=function(){try{sessionStorage.setItem(rk,String(Date.now()))}catch(er){}location.reload()};
    document.body.appendChild(d);requestAnimationFrame(function(){requestAnimationFrame(function(){d.style.transform='translate(-50%,0)'})});
  });
  function ask(){var c=navigator.serviceWorker.controller;if(c)c.postMessage({t:'hub-check',url:location.href})}
  ask();setTimeout(ask,1500);setTimeout(ask,4000);
  window.addEventListener('load',function(){setTimeout(function(){
    try{if(navigator.connection&&navigator.connection.saveData)return}catch(e){}
    ['index.html','finance.html','ucheba.html'].forEach(function(p){if(page(location.href)!==p)fetch(p).catch(function(){})});
  },5000)});
})();
/* Приложение Hub (Android): цвет системных полос берём из фона сайта, но зовём приложение только когда цвет реально изменился
   (раньше приложение реагировало на любое изменение стилей страницы, в т.ч. при прокрутке, и телефон перерисовывал экран — отсюда рывки и тормоза) */
(function(){
  if(!window.HubApp||!HubApp.bar)return;
  window.__hubObs=1;                     // не даём приложению ставить своего «наблюдателя» за стилями
  var last='',t=null;
  function send(){t=null;try{var c=getComputedStyle(document.body||document.documentElement).backgroundColor;if(c&&c!==last){last=c;HubApp.bar(c)}}catch(e){}}
  function later(){if(!t)t=setTimeout(send,120)}
  try{new MutationObserver(later).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-skin']})}catch(e){}
  try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',later)}catch(e){}
  document.addEventListener('DOMContentLoaded',later);
})();

/* Hub: офлайн — плашка «нет сети» и разовая загрузка данных в кэш (раз в 12 часов) */
(function(){
  var p=null;
  function show(){if(p||document.getElementById('hub-off'))return;p=document.createElement('div');p.id='hub-off';p.setAttribute('role','status');
    p.style.cssText='position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 10px);transform:translateX(-50%);z-index:9998;padding:7px 14px;border-radius:999px;background:rgba(32,30,26,.92);color:#fff;font:500 13px/1.2 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.25);white-space:nowrap;max-width:92vw;overflow:hidden;text-overflow:ellipsis';
    p.textContent='Нет сети · показаны сохранённые данные';(document.body||document.documentElement).appendChild(p)}
  function hide(){if(p&&p.parentNode)p.parentNode.removeChild(p);p=null}
  function upd(){navigator.onLine===false?show():hide()}
  window.addEventListener('offline',upd);window.addEventListener('online',function(){hide();warm()});
  document.addEventListener('DOMContentLoaded',upd);
  function warm(){try{if(!navigator.serviceWorker||!navigator.serviceWorker.controller||navigator.onLine===false)return;if(navigator.connection&&navigator.connection.saveData)return;
    var t=+localStorage.getItem('hub:warm')||0;if(Date.now()-t<432e5)return;localStorage.setItem('hub:warm',String(Date.now()));navigator.serviceWorker.controller.postMessage({t:'hub-warm'})}catch(e){}}
  window.addEventListener('load',function(){setTimeout(warm,6000)});
})();

/* Hub: полосы прокрутки в цвет темы, без стрелок; маленькие кнопки масштаба в правом верхнем углу всех страниц */
(function(){
  var css='::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-corner{background:transparent}'+
  '::-webkit-scrollbar-thumb{background:var(--faint,#857E6E);border-radius:8px;border:2px solid transparent;background-clip:padding-box}::-webkit-scrollbar-thumb:hover{background:var(--muted,#665F52);background-clip:padding-box;border:2px solid transparent}'+
  '::-webkit-scrollbar-button{display:none;width:0;height:0}'+
  '@supports not selector(::-webkit-scrollbar){*{scrollbar-width:thin;scrollbar-color:var(--faint,#857E6E) transparent}}'+
  '.zq{position:fixed;bottom:14px;right:14px;top:auto;z-index:60;display:flex;align-items:center;height:24px;border:1px solid var(--line,#D9D3C2);border-radius:999px;background:color-mix(in srgb,var(--surface,var(--bg,#FBF9F3)) 88%,transparent);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);overflow:hidden;opacity:.62;transition:opacity .15s;zoom:var(--iz,1)}'+
  '.zq:hover,.zq:focus-within{opacity:1}.zq button{height:24px;min-width:26px;padding:0 7px;border:0;background:none;color:var(--muted,#665F52);font:600 11px/1 system-ui,sans-serif;cursor:pointer}'+
  '.zq button:hover{color:var(--fg,#25221C);background:color-mix(in srgb,var(--fg,#25221C) 8%,transparent)}.zq i{width:1px;height:12px;background:var(--line,#D9D3C2)}'+
  '.ztop{position:fixed;right:14px;bottom:48px;z-index:60;width:40px;height:40px;border-radius:50%;border:1px solid var(--line,#D9D3C2);background:color-mix(in srgb,var(--surface,var(--bg,#FBF9F3)) 92%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:var(--accent,var(--a2,var(--fg,#25221C)));display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.22);opacity:0;visibility:hidden;transform:translateY(10px) scale(.9);transition:opacity .2s,transform .2s,visibility .2s,background .15s;zoom:var(--iz,1)}'+
  '.ztop.on{opacity:.92;visibility:visible;transform:none}.ztop.on:hover{opacity:1;background:var(--accent,var(--a2,var(--fg,#25221C)));color:var(--bg,#fff)}.ztop svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}'+
  '.zback{position:fixed;left:14px;top:calc(env(safe-area-inset-top,0px) + 14px);z-index:60;width:40px;height:40px;border-radius:50%;border:1px solid var(--line,#D9D3C2);background:color-mix(in srgb,var(--surface,var(--bg,#FBF9F3)) 92%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:var(--accent,var(--a2,var(--fg,#25221C)));display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.22);opacity:0;visibility:hidden;transform:translateX(-10px) scale(.9);transition:opacity .2s,transform .2s,visibility .2s,background .15s;zoom:var(--iz,1)}'+
  '.zback.on{opacity:.92;visibility:visible;transform:none}.zback.on:hover{opacity:1;background:var(--accent,var(--a2,var(--fg,#25221C)));color:var(--bg,#fff)}.zback svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}'+
  '@media (prefers-reduced-motion:reduce){.ztop,.zback{transition:none}}';
  function go(){
    if(!document.head||document.getElementById('zq-css'))return;
    var st=document.createElement('style');st.id='zq-css';st.textContent=css;document.head.appendChild(st);
    var d=document.createElement('div');d.className='zq';d.setAttribute('role','group');d.setAttribute('aria-label','Масштаб страницы');
    d.innerHTML='<button type="button" data-sz="-1" aria-label="Уменьшить" title="Уменьшить масштаб">A−</button><i></i><button type="button" data-sz="1" aria-label="Увеличить" title="Увеличить масштаб">A+</button>';
    document.body.appendChild(d);
    var tb=document.createElement('button');tb.type='button';tb.className='ztop';tb.setAttribute('aria-label','Наверх');tb.title='Наверх';
    tb.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';document.body.appendChild(tb);
    var home=/(^|\/)(index|artem|nastya)?(\.html)?$/.test(location.pathname)&&!/\/(fin2|games|docs)\//.test(location.pathname)&&/(^|\/)(index|artem|nastya)\.html$|\/$/.test(location.pathname);
    var bk=null;
    if(!home){bk=document.createElement('button');bk.type='button';bk.className='zback';bk.setAttribute('aria-label','Назад');bk.title='Назад';
      bk.innerHTML='<svg viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>';document.body.appendChild(bk);
      bk.addEventListener('click',function(){var same=false;try{same=document.referrer&&new URL(document.referrer).origin===location.origin}catch(e){}
        if(history.length>1&&same)history.back();else location.href=(/\/fin2\//.test(location.pathname)?'../':'')+'index.html'})}
    function tvis(){var y=window.pageYOffset||document.documentElement.scrollTop||0;tb.classList.toggle('on',y>500);if(bk)bk.classList.toggle('on',y>500)}
    window.addEventListener('scroll',tvis,{passive:true});tvis();
    tb.addEventListener('click',function(){var rm=false;try{rm=matchMedia('(prefers-reduced-motion:reduce)').matches}catch(e){}window.scrollTo({top:0,behavior:rm?'auto':'smooth'})});
    function vis(e){var r=e.getBoundingClientRect(),cs=getComputedStyle(e);return r.width>=8&&r.height>=8&&cs.visibility!=='hidden'&&cs.display!=='none'&&cs.opacity!=='0'}
    function place(){return;
      var W=window.innerWidth,els=[].slice.call(document.querySelectorAll('a,button,input,select')).filter(function(e){return !d.contains(e)&&vis(e)}),
          top=els.filter(function(e){var r=e.getBoundingClientRect();return r.top<64&&r.bottom>0&&r.right>W-300&&r.left>W*0.55});
      return;
      var L=Math.min.apply(null,top.map(function(e){return e.getBoundingClientRect().left})),
          r0=top.filter(function(e){return e.getBoundingClientRect().left===L})[0].getBoundingClientRect();
      d.style.right=Math.round(W-L+6)+'px';d.style.top=Math.max(2,Math.round(r0.top+(r0.height-24)/2))+'px';
      var a=d.getBoundingClientRect(),hit=els.some(function(e){var r=e.getBoundingClientRect();return r.top<a.bottom&&r.bottom>a.top&&r.left<a.right&&r.right>a.left&&r.top<90});
      if(hit){d.style.right='6px';d.style.top=Math.round(Math.max.apply(null,top.map(function(e){return e.getBoundingClientRect().bottom}))+4)+'px'}
    }
    window.__zqPlace=place;
    [200,900,2500].forEach(function(t){setTimeout(place,t)});
    window.addEventListener('resize',function(){setTimeout(place,60)});
  }
  if(document.body)go();else document.addEventListener('DOMContentLoaded',go);
})();
