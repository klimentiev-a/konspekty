(function(){
var TASKS=%%TASKS%%;
var KIND={test:'Тест',work:'Сдача',task:'Дело'};
var MON=['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
var WD=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'],WDL=['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'],MG=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
function rd(k,d){try{var v=JSON.parse(localStorage.getItem(k));return v==null?d:v}catch(e){return d}}
function wr(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
var done=rd('dela:done',{}),mine=rd('dela:mine',[]),filt='open',sel='',now=new Date(),vy=now.getFullYear(),vm=now.getMonth();
function p2(n){return(n<10?'0':'')+n}
function ymd(d){return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())}
var today=ymd(now);
function all(){return TASKS.concat(mine.map(function(m){return{id:m.id,date:m.date,time:m.time||'',end:'',title:m.title,course:'',kind:'task',src:'me',note:''}}))}
function endTs(t){var e=t.end||t.time||'23:59',a=e.split(':');return new Date(t.date+'T'+p2(+a[0])+':'+a[1]+':00').getTime()}
function sortF(a,b){return a.date<b.date?-1:a.date>b.date?1:((a.time||a.end||'99')<(b.time||b.end||'99')?-1:1)}
function dayName(s){var d=new Date(s+'T12:00:00'),n=Math.round((d-new Date(today+'T12:00:00'))/864e5);
  var base=d.getDate()+' '+MG[d.getMonth()]+', '+WDL[d.getDay()];
  return {t:base,r:n===0?'сегодня':n===1?'завтра':n===-1?'вчера':n>1&&n<8?'через '+n+' дн.':n<0?(-n)+' дн. назад':''}}
function when(t){if(t.time&&t.end)return t.time+' – '+t.end;if(t.time)return 'в '+t.time;if(t.end)return 'до '+t.end;return 'весь день'}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function grid(){
  var g=document.getElementById('dlg'),h=WD.map(function(w){return'<div class="h">'+w+'</div>'}).join('');
  var first=new Date(vy,vm,1),off=(first.getDay()+6)%7,dim=new Date(vy,vm+1,0).getDate(),by={};
  all().forEach(function(t){(by[t.date]=by[t.date]||[]).push(t)});
  for(var i=0;i<off;i++)h+='<div></div>';
  for(var d=1;d<=dim;d++){var s=vy+'-'+p2(vm+1)+'-'+p2(d),L=by[s]||[],dots=L.slice(0,4).map(function(t){return'<u class="'+(done[t.id]?'z':t.kind==='task'?'k':'')+'"></u>'}).join('');
    h+='<button type="button" class="d'+(s===today?' t':'')+(s===sel?' s':'')+'" data-d="'+s+'">'+d+'<i>'+dots+'</i></button>'}
  g.innerHTML=h;document.getElementById('dlm').textContent=MON[vm]+' '+vy}
function list(){
  var L=all().sort(sortF),box=document.getElementById('dll'),nowT=Date.now(),out='',cur='',n=0;
  L.forEach(function(t){var dn=!!done[t.id];
    if(sel&&t.date!==sel)return;
    if(!sel){if(filt==='open'&&dn)return;if(filt==='done'&&!dn)return}
    else if(filt==='done'&&!dn)return;
    if(t.date!==cur){cur=t.date;var dd=dayName(cur);out+='<div class="dl-day">'+dd.t+(dd.r?' <em>'+dd.r+'</em>':'')+'</div>'}
    var late=!dn&&endTs(t)<nowT;n++;
    out+='<div class="dl-it'+(dn?' dn':'')+(late?' late':'')+'"><button type="button" class="cb" data-c="'+esc(t.id)+'" aria-label="Отметить">'+(dn?'✓':'')+'</button><div class="bd"><div class="tt">'+esc(t.title)+'</div><div class="tm">'+when(t)+(late?' · просрочено':'')+'</div>'
      +(t.course?'<div class="cr"><span class="tg">'+KIND[t.kind]+'</span>'+esc(t.course)+'</div>':'<div class="cr"><span class="tg">'+KIND[t.kind]+'</span></div>')
      +(t.note?'<div class="nt">'+esc(t.note)+'</div>':'')+'</div>'+(t.src==='me'?'<button type="button" class="rm" data-r="'+esc(t.id)+'" aria-label="Удалить">×</button>':'')+'</div>'});
  box.innerHTML=n?out:'<div class="dl-empty">'+(sel?'На этот день ничего нет.':filt==='done'?'Пока ничего не отмечено.':'Впереди дел нет.')+'</div>'}
function draw(){grid();list()}
document.getElementById('dlf').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;filt=b.dataset.f;sel='';[].forEach.call(this.children,function(x){x.classList.toggle('on',x===b)});draw()});
document.getElementById('dlp').onclick=function(){vm--;if(vm<0){vm=11;vy--}draw()};
document.getElementById('dln').onclick=function(){vm++;if(vm>11){vm=0;vy++}draw()};
document.getElementById('dlg').addEventListener('click',function(e){var b=e.target.closest('.d');if(!b)return;sel=sel===b.dataset.d?'':b.dataset.d;draw()});
document.getElementById('dll').addEventListener('click',function(e){
  var c=e.target.closest('[data-c]');if(c){var k=c.dataset.c;if(done[k])delete done[k];else done[k]=1;wr('dela:done',done);draw();return}
  var r=e.target.closest('[data-r]');if(r){mine=mine.filter(function(m){return m.id!==r.dataset.r});wr('dela:mine',mine);draw()}});
document.getElementById('dla').addEventListener('submit',function(e){e.preventDefault();
  var t=document.getElementById('dlt'),d=document.getElementById('dld'),h=document.getElementById('dlh');if(!t.value.trim()||!d.value)return;
  mine.push({id:'me-'+Date.now(),title:t.value.trim(),date:d.value,time:h.value});wr('dela:mine',mine);t.value='';h.value='';draw()});
document.getElementById('dld').value=today;
draw();
})();
