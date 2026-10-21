(function(){
var Z=[0.8,0.9,1,1.1,1.2,1.3,1.45,1.6];
function g(){try{if(!localStorage.getItem('siteZoomLocal')){localStorage.removeItem('siteZoom');localStorage.setItem('siteZoomLocal','1')}var v=parseFloat(localStorage.getItem('siteZoom'));return v>0?v:1}catch(e){return 1}}
function ap(v){var d=document.documentElement;d.style.zoom=(v===1?'':String(v));d.style.setProperty('--iz',String(+(1/v).toFixed(4)));
  if(!document.getElementById('iz-css')){var s=document.createElement('style');s.id='iz-css';s.textContent='.zm,.zmr,.skinmenu{zoom:var(--iz,1)}html,body{overflow-x:clip}';(document.head||d).appendChild(s)}}
ap(g());
window.siteZoomGet=g;
window.siteZoom=function(d){var v=g(),i=Z.indexOf(v);if(i<0)i=2;i=d===0?2:Math.max(0,Math.min(Z.length-1,i+d));v=Z[i];try{localStorage.setItem('siteZoom',String(v))}catch(e){}ap(v);
  document.querySelectorAll('.szv').forEach(function(o){o.textContent=Math.round(v*100)+'%'});try{window.dispatchEvent(new Event('resize'))}catch(e){}return v};
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-sz]');if(!b)return;e.preventDefault();e.stopPropagation();var r0=b.getBoundingClientRect();siteZoom(+b.getAttribute('data-sz'));
  var r1=b.getBoundingClientRect(),dx=r1.left-r0.left,dy=r1.top-r0.top;if(dx||dy){try{window.scrollBy(dx,dy)}catch(er){}}
  var w=b.closest('.zm,.zmr,.skinmenu'),r2=b.getBoundingClientRect(),ex=r2.left-r0.left,ey=r2.top-r0.top;
  if(w&&(Math.abs(ex)>.5||Math.abs(ey)>.5)){var t=w.__t||[0,0];t=[t[0]-ex,t[1]-ey];w.__t=t;w.style.transform='translate('+t[0]+'px,'+t[1]+'px)'}},true);   // кнопка остаётся под курсором
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
