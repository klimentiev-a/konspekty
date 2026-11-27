(function(){
var TASKS=%%TASKS%%;
var KIND={test:'Тест',work:'Сдача',task:'Дело'},KC={test:'k1',work:'k2',task:'k3'},DC={test:'',work:'b',task:'c'};
var MON=['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'],MG=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
var WS=['вс','пн','вт','ср','чт','пт','сб'],WH=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
function rd(k,d){try{var v=JSON.parse(localStorage.getItem(k));return v==null?d:v}catch(e){return d}}
function wr(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function $(i){return document.getElementById(i)}
function p2(n){return(n<10?'0':'')+n}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
var done=rd('dela:done',{}),mine=rd('dela:mine',[]),filt='open',sel='',mon=false,addOpen=false,open={};
function mskDay(ms){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms))}
function todayS(){return mskDay(Date.now())}
function ts(d,t){return new Date(d+'T'+(t||'00:00')+':00+03:00').getTime()}
function addD(s,n){var d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function dow(s){return new Date(s+'T00:00:00Z').getUTCDay()}
function diffD(a,b){return Math.round((new Date(a+'T00:00:00Z')-new Date(b+'T00:00:00Z'))/864e5)}
var vy=+todayS().slice(0,4),vm=+todayS().slice(5,7)-1;
function all(){return TASKS.concat(mine.map(function(m){return{id:m.id,date:m.date,time:m.time||'',end:'',title:m.title,course:'',kind:'task',src:'me',note:''}}))}
function st(t){return t.time?ts(t.date,t.time):null}
function en(t){return t.end?ts(t.date,t.end):t.time?ts(t.date,t.time):ts(t.date,'23:59')}
function key(t){return t.date+(t.time||t.end||'99:99')}
function sortF(a,b){var x=key(a),y=key(b);return x<y?-1:x>y?1:0}
function dur(ms){ms=Math.max(0,ms);var m=Math.floor(ms/6e4),d=Math.floor(m/1440),h=Math.floor(m%1440/60),mm=m%60;
  if(d>=1)return d+' дн. '+(h?h+' ч':'');if(h>=1)return h+' ч '+(mm?mm+' мин':'');return Math.max(1,mm)+' мин'}
function when(t){if(t.time&&t.end)return t.time+' – '+t.end;if(t.time)return 'в '+t.time;if(t.end)return 'до '+t.end;return 'весь день'}
function dots(L){return L.slice(0,4).map(function(t){return'<s class="'+(done[t.id]?'z':DC[t.kind]||'')+'"></s>'}).join('')}
function hero(){
  var now=Date.now(),L=all().filter(function(t){return!done[t.id]}),late=L.filter(function(t){return en(t)<now}),up=L.filter(function(t){return en(t)>=now}).sort(sortF),el=$('dlh');
  if(!up.length){
    el.className='dl-hero ok';
    el.innerHTML='<div class="dl-hl"><i></i>Всё чисто</div><div class="dl-hm"><div class="dl-ht"><b>Впереди дел нет</b><span>'+(late.length?'Есть просроченные: '+late.length+'. Отметь их сделанными или добавь новое дело.':'Можно добавить своё дело кнопкой ниже.')+'</span></div></div>';return}
  var t=up[0],s=st(t),e=en(t),inw=s!=null&&now>=s&&now<e,lab,cd,cap,pg='';
  if(inw){lab='Идёт сейчас';cd=dur(e-now);cap='до закрытия';pg='<div class="dl-pg"><i style="width:'+Math.min(100,Math.max(2,(now-s)/(e-s)*100)).toFixed(1)+'%"></i></div>'}
  else if(s!=null){lab='Ближайшее';cd=dur(s-now);cap='до начала'}
  else{lab='Дедлайн';cd=dur(e-now);cap='до сдачи'}
  var k=t.kind==='work'?'w2':t.kind==='task'?'w3':'';
  el.className='dl-hero '+k+(e-now<36e5&&!inw?'':'');
  var dd=t.date===todayS()?'сегодня':(function(){var a=t.date.split('-');return+a[2]+' '+MG[+a[1]-1]})();
  el.innerHTML='<div class="dl-hl"><i></i>'+lab+'</div><div class="dl-hm"><div class="dl-ht"><b>'+esc(t.title)+'</b><span>'+dd+', '+when(t)+(t.course?' · '+esc(t.course):'')+'</span></div><div class="dl-hc"><b>'+cd+'</b><span>'+cap+'</span></div></div>'+pg
    +'<div class="dl-hb"><button type="button" class="pr" data-c="'+esc(t.id)+'">Отметить сделанным</button><button type="button" data-d="'+t.date+'">Показать день</button></div>'}
function stats(){
  var now=Date.now(),td=todayS(),a=all(),op=a.filter(function(t){return!done[t.id]}),
    n1=op.filter(function(t){return t.date===td&&en(t)>=now}).length,n7=op.filter(function(t){return t.date>=td&&t.date<=addD(td,6)&&en(t)>=now}).length,
    lt=op.filter(function(t){return en(t)<now}).length,dn=a.filter(function(t){return done[t.id]}).length;
  $('dls').innerHTML='<div class="dl-st"><b>'+n1+'</b><span>сегодня осталось</span></div><div class="dl-st"><b>'+n7+'</b><span>на 7 дней</span></div>'+(lt?'<div class="dl-st bad"><b>'+lt+'</b><span>просрочено</span></div>':'')+'<div class="dl-st"><b>'+dn+'<small style="font-size:15px;color:var(--faint)"> / '+a.length+'</small></b><span>сделано</span></div>'}
function strip(){
  var td=todayS(),by={};all().forEach(function(t){(by[t.date]=by[t.date]||[]).push(t)});var h='';
  for(var i=0;i<21;i++){var s=addD(td,i);h+='<button type="button" class="dl-dp'+(s===td?' t':'')+(s===sel?' s':'')+'" data-d="'+s+'" role="option"><small>'+WS[dow(s)]+'</small><b>'+(+s.slice(8))+'</b><u>'+dots(by[s]||[])+'</u></button>'}
  $('dlw').innerHTML=h}
function month(){
  $('dlm').hidden=!mon;$('dlmb').setAttribute('aria-expanded',mon);if(!mon)return;
  var h=WH.map(function(w){return'<div class="h">'+w+'</div>'}).join(''),td=todayS(),by={};all().forEach(function(t){(by[t.date]=by[t.date]||[]).push(t)});
  var off=(new Date(Date.UTC(vy,vm,1)).getUTCDay()+6)%7,dim=new Date(Date.UTC(vy,vm+1,0)).getUTCDate();
  for(var i=0;i<off;i++)h+='<div></div>';
  for(var d=1;d<=dim;d++){var s=vy+'-'+p2(vm+1)+'-'+p2(d);h+='<button type="button" class="d'+(s===td?' t':'')+(s===sel?' s':'')+'" data-d="'+s+'">'+d+'<u>'+dots(by[s]||[])+'</u></button>'}
  $('dlg').innerHTML=h;$('dlmt').textContent=MON[vm]+' '+vy}
function list(){
  var now=Date.now(),td=todayS(),L=all().sort(sortF),out='',cur='',n=0,openDay=false;
  function close(){if(openDay){out+='</div></div>';openDay=false}}
  L.forEach(function(t){var dn=!!done[t.id];
    if(sel&&t.date!==sel)return;
    if(filt==='open'&&dn)return;if(filt==='done'&&!dn)return;
    if(t.date!==cur){close();cur=t.date;var r=diffD(cur,td),rel=r===0?'сегодня':r===1?'завтра':r===-1?'вчера':r>1&&r<15?'через '+r+' дн.':r<0?(-r)+' дн. назад':'',a=cur.split('-');
      out+='<div class="dl-day'+(r===0?' t':'')+'"><div class="dl-dh"><b>'+(+a[2])+'</b><small>'+WS[dow(cur)]+', '+MG[+a[1]-1]+'</small>'+(rel?'<span class="dl-rel">'+rel+'</span>':'')+'</div><div>';openDay=true}
    var late=!dn&&en(t)<now,e=en(t),s=st(t),inw=!dn&&s!=null&&now>=s&&now<e,foot='';
    if(!dn&&!late){if(inw)foot='<span class="ft">Идёт сейчас · осталось '+dur(e-now)+'</span>';else if(e-now<864e5)foot='<span class="ft">Осталось '+dur((s!=null&&now<s?s:e)-now)+'</span>'}
    n++;
    out+='<div class="dl-it '+KC[t.kind]+(dn?' dn':'')+(late?' late':'')+'"><div class="bd"><div class="tm"><span>'+when(t)+'</span><span class="tg">'+(late?'Просрочено':KIND[t.kind])+'</span></div><div class="tt">'+esc(t.title)+'</div>'
      +(t.course?'<div class="cr">'+esc(t.course)+'</div>':'')+foot
      +(t.note?(open[t.id]?'<div class="nt">'+esc(t.note)+'</div><button type="button" class="more" data-n="'+esc(t.id)+'">Свернуть</button>':'<button type="button" class="more" data-n="'+esc(t.id)+'">Подробнее</button>'):'')
      +'</div>'+(t.src==='me'?'<button type="button" class="rm" data-r="'+esc(t.id)+'" aria-label="Удалить">×</button>':'')+'<button type="button" class="cb" data-c="'+esc(t.id)+'" aria-label="Отметить">'+(dn?'✓':'')+'</button></div>'});
  close();
  $('dll').innerHTML=n?out:'<div class="dl-empty">'+(sel?'На этот день ничего нет.':filt==='done'?'Пока ничего не отмечено.':'Впереди дел нет.')+'</div>'}
function draw(){hero();stats();strip();month();list()}
document.addEventListener('click',function(e){
  var el=e.target.closest&&e.target.closest('[data-c],[data-d],[data-n],[data-r],[data-f],#dlmb,#dlp,#dln,#dlpl');if(!el||!el.closest('.dl'))return;
  if(el.dataset.c){var k=el.dataset.c;if(done[k])delete done[k];else done[k]=1;wr('dela:done',done);draw();return}
  if(el.dataset.n){open[el.dataset.n]=!open[el.dataset.n];list();return}
  if(el.dataset.r){mine=mine.filter(function(m){return m.id!==el.dataset.r});wr('dela:mine',mine);draw();return}
  if(el.dataset.f){filt=el.dataset.f;sel='';[].forEach.call($('dlf').children,function(x){x.classList.toggle('on',x===el)});draw();return}
  if(el.dataset.d){sel=sel===el.dataset.d?'':el.dataset.d;if(sel){vy=+sel.slice(0,4);vm=+sel.slice(5,7)-1}draw();return}
  if(el.id==='dlmb'){mon=!mon;month();return}
  if(el.id==='dlp'){vm--;if(vm<0){vm=11;vy--}month();return}
  if(el.id==='dln'){vm++;if(vm>11){vm=0;vy++}month();return}
  if(el.id==='dlpl'){addOpen=!addOpen;$('dla').hidden=!addOpen;if(addOpen)$('dlt').focus()}
});
$('dla').addEventListener('submit',function(e){e.preventDefault();
  var t=$('dlt'),d=$('dld'),h=$('dlh2');if(!t.value.trim()||!d.value)return;
  mine.push({id:'me-'+Date.now(),title:t.value.trim(),date:d.value,time:h.value});wr('dela:mine',mine);t.value='';h.value='';draw()});
$('dld').value=todayS();
draw();
setInterval(function(){hero();stats()},30000);
})();
