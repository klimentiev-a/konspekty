/* Таблицы на узком экране: строки превращаются в карточки, без горизонтальной прокрутки */
(function(){
  var css='@media (max-width:640px){'+
  '.tablewrap:has(>table.cards){overflow:visible!important;border:0!important}'+
  'table.cards{display:block;width:100%!important;border:0}'+
  'table.cards thead{display:none}'+
  'table.cards tbody{display:block}'+
  'table.cards tr{display:block;margin:0 0 10px;padding:6px 12px;border:1px solid var(--line,#8884);border-radius:10px;background:var(--card,transparent)}'+
  'table.cards td,table.cards th{display:block;width:auto!important;max-width:none!important;border:0!important;padding:5px 0!important;text-align:left!important;white-space:normal!important;position:static!important;overflow-wrap:anywhere}'+
  'table.cards td[data-label]:not([data-label=""])::before{content:attr(data-label);display:block;font:600 11px/1.3 var(--sans,system-ui);letter-spacing:.04em;text-transform:uppercase;opacity:.6;margin-bottom:1px}'+
  'table.cards code{white-space:normal;overflow-wrap:anywhere}'+
  'table.cards td:first-child{font-weight:700}'+
  'table.cards td:empty{display:none}'+
  '}.fx{display:block;margin-top:4px;opacity:.85;font-size:.92em}';
  var st=document.createElement('style');st.textContent=css;
  (document.head||document.documentElement).appendChild(st);
  function fix(t){
    if(t.dataset.cz)return;
    var th=t.querySelectorAll('thead th');
    if(!th.length){var r=t.querySelector('tr');if(r&&r.querySelector('th'))th=r.querySelectorAll('th');}
    if(!th.length||t.querySelector('[colspan]'))return;
    t.dataset.cz=1;
    var labs=[].map.call(th,function(h){return h.textContent.trim()});
    [].forEach.call(t.querySelectorAll('tbody tr, tr'),function(tr){
      if(tr.querySelector('th')&&!tr.querySelector('td'))return;
      [].forEach.call(tr.children,function(c,i){if(!c.hasAttribute('data-label'))c.setAttribute('data-label',i?labs[i]||'':'')});
    });
    t.classList.add('cards');
  }
  function run(){[].forEach.call(document.querySelectorAll('table'),fix)}
  var q;function sched(){clearTimeout(q);q=setTimeout(run,60)}
  function init(){run();new MutationObserver(sched).observe(document.body,{childList:true,subtree:true})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
