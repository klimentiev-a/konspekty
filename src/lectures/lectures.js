(function(){
'use strict';
var $=function(i){return document.getElementById(i)};
var GROUPS={'M&A и сделки':[205,'M&A'],'LBO и моделирование':[262,'LBO'],'Оценка':[160,'EV'],'Отчётность и учёт':[28,'P&L'],'PE и венчур':[330,'PE'],'Нефть и газ':[215,'Oil'],'Металлы и добыча':[38,'Me'],'TMT и медиа':[285,'TMT'],'Телеком':[190,'Tel'],'Финтех и банки':[145,'Fin'],'Страхование и пенсии':[5,'Ins'],'Инфраструктура и проекты':[55,'Inf'],'Недвижимость и ритейл':[345,'RE'],'Налоги':[95,'Tax'],'Кейсы M&A':[238,'Case'],'Крипта и альтернативы':[300,'Alt'],'Макро и Excel':[175,'Xl'],'Здравоохранение и прочее':[125,'Med']};
var ORDER=Object.keys(GROUPS);
var IDX=null,DECK=null,CUR=0,TOTAL=0,LAST=0,SEEN={},Q='',GF='';
var LS='lec:v1';
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function gh(g){return (GROUPS[g]||[160])[0]}
function load(){try{return JSON.parse(localStorage.getItem(LS))||{}}catch(e){return {}}}
function save(o){try{localStorage.setItem(LS,JSON.stringify(o))}catch(e){}}
function prog(id){var p=load()[id];return p||null}
function setProg(){if(!DECK)return;var o=load();var p=o[DECK.id]||{i:0,m:0,s:[]};p.i=CUR;p.t=Date.now();p.n=TOTAL;SEEN[CUR]=1;p.s=Object.keys(SEEN).map(Number);p.m=p.s.length;o[DECK.id]=p;save(o)}
function norm(s){return String(s||'').toLowerCase().replace(/ё/g,'е')}
var RU='йцукенгшщзхъфывапролджэячсмитьбю',EN="qwertyuiop[]asdfghjkl;'zxcvbnm,.";
function swapL(s){return s.split('').map(function(c){var i=EN.indexOf(c);return i>=0?RU[i]:c}).join('')}
function stem(w){return w.length>5?w.slice(0,w.length-2):w.length>3?w.slice(0,w.length-1):w}
function qwords(q){q=norm(q).trim();if(!q)return [];var a=q.split(/\s+/);if(/^[a-z\[\];',.\s]+$/.test(q)&&/[\[\];',.]/.test(q))a=swapL(q).split(/\s+/);return a.map(stem)}
function hay(d){return norm([d.title,d.desc,(d.tags||[]).join(' '),d.group,d.source,d.q||''].join(' '))}

/* ---------- каталог ---------- */
function card(d){
  var p=prog(d.id),pc=p&&p.n?Math.min(100,Math.round(100*(p.m||0)/p.n)):0,done=p&&p.n&&p.m>=p.n;
  return '<a class="lcard'+(done?' done':'')+'" href="#'+esc(d.id)+(p&&p.i?'/'+(p.i+1):'')+'" style="--h:'+gh(d.group)+'">'+
    '<div class="lcov" data-g="'+esc((GROUPS[d.group]||[0,''])[1])+'"><span>'+esc(d.group)+'</span></div>'+
    '<div class="lcb"><b>'+esc(d.title)+'</b><p>'+esc(d.desc)+'</p>'+
    '<div class="lmeta"><span>'+esc(d.source)+'</span><span>'+d.n+' слайдов · ~'+d.min+' мин</span>'+(d.level==='pro'?'<span class="pro">углублённо</span>':'')+'</div></div>'+
    '<div class="lpr"><i style="width:'+pc+'%"></i></div></a>';
}
function matches(d){
  if(GF&&d.group!==GF)return false;
  var w=qwords(Q);if(!w.length)return true;var h=hay(d);
  return w.every(function(x){return h.indexOf(x)>=0});
}
function drawList(){
  var ds=IDX.decks.filter(matches),by={};
  ds.forEach(function(d){(by[d.group]=by[d.group]||[]).push(d)});
  var cont=[];
  if(!Q&&!GF){
    var o=load();cont=IDX.decks.filter(function(d){var p=o[d.id];return p&&p.m>0&&p.m<p.n}).sort(function(a,b){return (o[b.id].t||0)-(o[a.id].t||0)}).slice(0,4);
  }
  $('lcont').innerHTML=cont.length?'<div class="lh3"><span>Продолжить</span><i></i></div><div class="lgrid">'+cont.map(card).join('')+'</div>':'';
  var h='';
  ORDER.concat(Object.keys(by).filter(function(g){return ORDER.indexOf(g)<0})).forEach(function(g){
    if(!by[g])return;
    h+='<div class="lh3" style="--h:'+gh(g)+'"><b>'+esc(g)+'</b><i></i><span>'+by[g].length+'</span></div><div class="lgrid">'+by[g].map(card).join('')+'</div>';
  });
  $('lall').innerHTML=h;$('lempty').hidden=ds.length>0;
  var cnt={};IDX.decks.forEach(function(d){cnt[d.group]=(cnt[d.group]||0)+1});
  var c='<button type="button" class="lchip'+(GF?'':' on')+'" data-g="">Все <em>'+IDX.decks.length+'</em></button>';
  ORDER.forEach(function(g){if(cnt[g])c+='<button type="button" class="lchip'+(GF===g?' on':'')+'" data-g="'+esc(g)+'">'+esc(g)+' <em>'+cnt[g]+'</em></button>'});
  $('lchips').innerHTML=c;
}

/* ---------- слайды ---------- */
function items(a){return a.map(function(x,i){
  var s=typeof x==='string'?'<span>'+esc(x)+'</span>':'<b>'+esc(x.b)+'</b>'+(x.d?' — <span>'+esc(x.d)+'</span>':'');
  return '<li class="a" style="--i:'+(i+2)+'">'+s+'</li>'}).join('')}
function head(s){return '<h3 class="a">'+esc(s.h)+'</h3>'}
function render(s,i){
  var t=s.t,h='';
  if(t==='points')h=head(s)+(s.lead?'<p class="lead a" style="--i:1">'+esc(s.lead)+'</p>':'')+'<ul class="pt">'+items(s.items||[])+'</ul>';
  else if(t==='table'){
    h=head(s)+'<div class="tw a" style="--i:1"><table><thead><tr>'+(s.cols||[]).map(function(c){return '<th>'+esc(c)+'</th>'}).join('')+'</tr></thead><tbody>'+
      (s.rows||[]).map(function(r){return '<tr>'+r.map(function(c){return '<td>'+esc(c)+'</td>'}).join('')+'</tr>'}).join('')+'</tbody></table></div>'+(s.note?'<p class="nt a" style="--i:2">'+esc(s.note)+'</p>':'');
  }
  else if(t==='formula')h=head(s)+'<div class="fm">'+(s.f||[]).map(function(f,k){return '<div class="f a" style="--i:'+(k+1)+'">'+esc(f)+'</div>'}).join('')+'</div>'+(s.ex?'<div class="ex a" style="--i:5"><b>Пример.</b> '+esc(String(s.ex).replace(/^Пример:?\s*/i,''))+'</div>':'')+(s.note?'<p class="nt a" style="--i:6">'+esc(s.note)+'</p>':'');
  else if(t==='steps')h=head(s)+'<ol class="st">'+(s.steps||[]).map(function(x,k){return '<li class="a" style="--i:'+(k+1)+'"><b>'+esc(x.h)+'</b>'+(x.d?'<p>'+esc(x.d)+'</p>':'')+'</li>'}).join('')+'</ol>';
  else if(t==='compare'){
    var side=function(o,k){return '<div class="a" style="--i:'+k+'"><h4>'+esc(o.h)+'</h4><ul>'+(o.items||[]).map(function(x){return '<li>'+esc(x)+'</li>'}).join('')+'</ul></div>'};
    h=head(s)+'<div class="cp">'+side(s.l||{},1)+side(s.r||{},2)+'</div>';
  }
  else if(t==='stats')h=head(s)+'<div class="ss">'+(s.stats||[]).map(function(x,k){return '<div class="a" style="--i:'+(k+1)+'"><b>'+esc(x.v)+'</b><span>'+esc(x.l)+'</span></div>'}).join('')+'</div>'+(s.note?'<p class="nt a" style="--i:5">'+esc(s.note)+'</p>':'');
  else if(t==='qa')h='<div class="a"><span class="qk">'+esc(s.h||'Как спросят')+'</span><div class="qq">'+esc(s.q)+'</div></div><button type="button" class="qa-b a" style="--i:2" data-qa="1">Показать ответ</button><div class="qa-a" hidden>'+esc(s.a)+'</div>';
  else if(t==='takeaway')h=head(s)+'<ul class="tl">'+(s.items||[]).map(function(x,k){return '<li class="a" style="--i:'+(k+1)+'">'+esc(x)+'</li>'}).join('')+'</ul>';
  else h=head(s);
  return '<div class="sc'+(t==='takeaway'?' tk':'')+'">'+h+'</div>'+foot(i);
}
function foot(i){return '<div class="sft"><span>'+esc(DECK.title)+'</span><span>'+(i+1)+' / '+TOTAL+'</span></div>'}
function cover(){
  var d=DECK;
  return '<div class="sc cv"><span class="kg a">'+esc(d.group)+'</span><h3 class="a" style="--i:1">'+esc(d.title)+'</h3><p class="ds a" style="--i:2">'+esc(d.desc)+'</p>'+
    '<div class="tg a" style="--i:3"><span>'+esc(d.source)+'</span><span>'+(TOTAL-1)+' слайдов</span><span>~'+Math.max(2,Math.round((TOTAL-1)*0.7))+' мин</span>'+(d.level==='pro'?'<span>углублённо</span>':'')+'</div>'+
    ((d.tags||[]).length?'<div class="tg a" style="--i:4">'+d.tags.slice(0,6).map(function(x){return '<span>'+esc(x)+'</span>'}).join('')+'</div>':'')+
    '<div class="go a" style="--i:5">Листай дальше →</div></div>'+foot(0);
}
function slideTitle(s){return s.h||(s.t==='qa'?s.q:'')||''}
var KIND={points:'Тезисы',table:'Таблица',formula:'Формулы',steps:'Шаги',compare:'Сравнение',stats:'Цифры',qa:'Вопрос',takeaway:'Итог'};

function show(i,dir){
  if(!DECK)return;
  i=Math.max(0,Math.min(TOTAL-1,i));var first=(CUR===i&&!dir);
  CUR=i;
  var sl=$('slide');
  sl.innerHTML=i===0?cover():render(DECK.slides[i-1],i);
  var sc=sl.querySelector('.sc');if(dir>0)sc.classList.add('fl');else if(dir<0)sc.classList.add('fr');
  $('np').disabled=i===0;$('nn').disabled=i===TOTAL-1;
  $('cnt').textContent=(i+1)+' / '+TOTAL;
  $('sbi').style.width=Math.round(100*(i+1)/TOTAL)+'%';
  var s=i>0?DECK.slides[i-1]:null,n=s&&s.n;
  $('notes').hidden=!n;$('notes').innerHTML=n?'<b>Подробнее</b>'+esc(n):'';
  setProg();dots();
  var h='#'+DECK.id+(i>0?'/'+(i+1):'');
  if(location.hash!==h){try{history.replaceState(null,'',h)}catch(e){location.hash=h}}
}
function dots(){
  var h='';for(var i=0;i<TOTAL;i++)h+='<button type="button" role="tab" aria-label="Слайд '+(i+1)+'" data-i="'+i+'" class="'+(i===CUR?'on':(SEEN[i]?'seen':''))+'"></button>';
  $('dots').innerHTML=h;
}
function overview(on){
  var o=$('ovw');
  if(!on){o.hidden=true;document.body.style.overflow='';return}
  var h='<div class="oh"><span>'+esc(DECK.title)+'</span><button type="button" class="lb" data-close="1">Закрыть (Esc)</button></div><div class="og">';
  for(var i=0;i<TOTAL;i++){
    var s=i?DECK.slides[i-1]:null;
    h+='<button type="button" class="o'+(i===CUR?' on':(SEEN[i]?' seen':''))+'" data-i="'+i+'"><span class="on1">'+(i+1)+' · '+(s?KIND[s.t]||'':'Обложка')+'</span><span class="on2">'+esc(s?slideTitle(s):DECK.title)+'</span></button>';
  }
  o.innerHTML=h+'</div>';o.hidden=false;document.body.style.overflow='hidden';
  var b=o.querySelector('.on');if(b)b.scrollIntoView({block:'center'});
}

/* ---------- маршруты ---------- */
function setBack(deck){
  var a=document.querySelector('.top a');if(!a)return;
  a.setAttribute('href',deck?'#':'artem.html#fin');a.lastChild.textContent=deck?'Лекции':'Финансы';
}
function route(){
  var m=location.hash.replace(/^#/,'').split('/'),id=m[0];
  if(!IDX)return;
  var d=IDX.decks.filter(function(x){return x.id===id})[0];
  if(!d){DECK=null;$('lv-deck').hidden=true;$('lv-list').hidden=false;document.title='Лекции · Hub';setBack(false);drawList();return}
  var want=m[1]?Math.max(1,parseInt(m[1],10)||1)-1:null;
  if(DECK&&DECK.id===id){if(want!=null&&want!==CUR)show(want,want>CUR?1:-1);return}
  $('lv-list').hidden=true;$('lv-deck').hidden=false;setBack(true);
  $('slide').innerHTML='<div class="sc"><p class="lead">Загрузка…</p></div>';
  fetch('lectures/'+encodeURIComponent(id)+'.json').then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(j){
    DECK=j;TOTAL=j.slides.length+1;var p=prog(id);SEEN={};(p&&p.s||[]).forEach(function(x){SEEN[x]=1});
    document.title=j.title+' · Лекции';
    $('lw').style.setProperty('--h',gh(j.group));
    $('dg').textContent=j.group;$('dt').textContent=j.title;
    related(j);
    CUR=-1;show(want!=null?want:0,0);window.scrollTo(0,0);
  }).catch(function(){$('slide').innerHTML='<div class="sc"><p class="lead">Не удалось загрузить лекцию. Проверь сеть и обнови страницу.</p></div>'});
}
function related(j){
  var h='',hubs=(j.hub||[]);
  if(hubs.length){h+='<div><h5>В учебнике</h5><div class="rc">'+hubs.map(function(x){var t=(IDX.hub||{})[x];return t?'<a href="finance.html#learn/'+esc(x)+'">'+esc(t)+'</a>':''}).join('')+'</div></div>'}
  var same=IDX.decks.filter(function(d){return d.group===j.group&&d.id!==j.id}).slice(0,8);
  if(same.length)h+='<div><h5>Ещё: '+esc(j.group)+'</h5><div class="rc">'+same.map(function(d){return '<a href="#'+esc(d.id)+'">'+esc(d.title)+'</a>'}).join('')+'</div></div>';
  $('rel').innerHTML=h;
}

/* ---------- события ---------- */
function go(d){show(CUR+d,d)}
function fs(){var s=$('stage');if(document.fullscreenElement||document.webkitFullscreenElement){(document.exitFullscreen||document.webkitExitFullscreen).call(document)}else{var f=s.requestFullscreen||s.webkitRequestFullscreen;if(f)f.call(s)}}
document.addEventListener('click',function(e){
  var t=e.target;if(!t.closest)return;
  var c=t.closest('.lchip');if(c){GF=c.getAttribute('data-g');drawList();return}
  var b=t.closest('#np');if(b){go(-1);return}b=t.closest('#nn');if(b){go(1);return}
  b=t.closest('#dots [data-i]');if(b){var i=+b.getAttribute('data-i');show(i,i>CUR?1:-1);return}
  b=t.closest('#ovw [data-i]');if(b){var k=+b.getAttribute('data-i');overview(false);show(k,k>CUR?1:-1);return}
  if(t.closest('[data-close]')){overview(false);return}
  if(t.closest('#bgrid')){overview(true);return}
  if(t.closest('#bfs')){fs();return}
  b=t.closest('[data-qa]');if(b){b.hidden=true;var a=b.nextElementSibling;if(a)a.hidden=false;return}
});
document.addEventListener('keydown',function(e){
  if(!DECK||$('lv-deck').hidden)return;
  var tg=e.target&&e.target.tagName;if(tg==='INPUT'||tg==='TEXTAREA'||e.ctrlKey||e.metaKey||e.altKey)return;
  var k=e.key;
  if(!$('ovw').hidden){if(k==='Escape')overview(false);return}
  if(k==='ArrowRight'||k==='PageDown'||(k===' '&&!e.shiftKey)){e.preventDefault();go(1)}
  else if(k==='ArrowLeft'||k==='PageUp'||(k===' '&&e.shiftKey)){e.preventDefault();go(-1)}
  else if(k==='Home'){e.preventDefault();show(0,-1)}
  else if(k==='End'){e.preventDefault();show(TOTAL-1,1)}
  else if(k==='f'||k==='F'||k==='а'||k==='А'){fs()}
  else if(k==='g'||k==='G'||k==='п'||k==='П'){overview(true)}
  else if(k==='Enter'){var b=$('slide').querySelector('[data-qa]');if(b&&!b.hidden)b.click()}
});
/* свайп */
(function(){
  var x0=0,y0=0,t0=0,on=false;
  var st=$('stage');
  st.addEventListener('touchstart',function(e){if(e.touches.length!==1){on=false;return}if(e.target.closest('.tw'))return;on=true;x0=e.touches[0].clientX;y0=e.touches[0].clientY;t0=Date.now()},{passive:true});
  st.addEventListener('touchend',function(e){if(!on)return;on=false;var t=e.changedTouches[0],dx=t.clientX-x0,dy=t.clientY-y0;
    if(Math.abs(dx)>46&&Math.abs(dx)>Math.abs(dy)*1.5&&Date.now()-t0<700)go(dx<0?1:-1)},{passive:true});
  /* тап по правому/левому краю слайда на телефоне */
  st.addEventListener('click',function(e){
    if(!matchMedia('(hover:none)').matches)return;
    if(e.target.closest('button,a,.tw,.nv'))return;
    var r=st.getBoundingClientRect(),x=e.clientX-r.left;
    if(x>r.width*0.78)go(1);else if(x<r.width*0.22)go(-1);
  });
})();
$('lq').addEventListener('input',function(){Q=this.value;drawList()});
window.addEventListener('hashchange',route);
fetch('lectures/index.json').then(function(r){return r.json()}).then(function(j){IDX=j;drawList();route()}).catch(function(){$('lall').innerHTML='<p class="lempty">Не удалось загрузить список лекций. Проверь сеть и обнови страницу.</p>'});
})();
