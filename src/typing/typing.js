/* Клавиатурный тренажёр (Hub · Настя). Данные — в data.js (KD). Состояние — localStorage «klava:v1». */
(function(){
'use strict';
var LS='klava:v1',$=function(s,r){return (r||document).querySelector(s)},$$=function(s,r){return [].slice.call((r||document).querySelectorAll(s))};
var D={lang:'ru',fix:true,kb:true,fing:true,snd:false,size:1,les:{ru:{},en:{}},hist:[],err:{ru:{},en:{}},hit:{ru:{},en:{}},opt:{words:{n:25,caps:false},time:{sec:60},sym:{kind:'mix',n:30},text:{id:'r'},game:{lv:1}},mode:'les'};
function load(){try{var j=JSON.parse(localStorage.getItem(LS)||'null');if(j)for(var k in j){if(k==='opt')for(var o in j.opt)D.opt[o]=j.opt[o];else D[k]=j[k]}}catch(e){}}
function save(){try{localStorage.setItem(LS,JSON.stringify(D))}catch(e){}}
load();
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function rnd(a){return a[Math.floor(Math.random()*a.length)]}
function shuf(a){a=a.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1)),t=a[i];a[i]=a[j];a[j]=t}return a}
function nf(v,d){return (+v).toFixed(d||0).replace('.',',')}

/* ---------- раскладки ---------- */
var LAY={
ru:{rows:[['ё1234567890-=','Ё!"№;%:?*()_+'],['йцукенгшщзхъ\\','ЙЦУКЕНГШЩЗХЪ/'],['фывапролджэ','ФЫВАПРОЛДЖЭ'],['ячсмитьбю.','ЯЧСМИТЬБЮ,']],home:'ао',script:/[а-яё]/i},
en:{rows:[['`1234567890-=','~!@#$%^&*()_+'],['qwertyuiop[]\\','QWERTYUIOP{}|'],["asdfghjkl;'",'ASDFGHJKL:"'],['zxcvbnm,./','ZXCVBNM<>?']],home:'fj',script:/[a-z]/i}};
var FING=[[1,1,2,3,4,4,5,5,6,7,8,8,8],[1,2,3,4,4,5,5,6,7,8,8,8,8],[1,2,3,4,4,5,5,6,7,8,8],[1,2,3,4,4,5,5,6,7,8]];
var FN={1:'левый мизинец',2:'левый безымянный',3:'левый средний',4:'левый указательный',5:'правый указательный',6:'правый средний',7:'правый безымянный',8:'правый мизинец',9:'большой палец'};
var KMAP={};
function kmap(l){if(KMAP[l])return KMAP[l];var m={};LAY[l].rows.forEach(function(r,ri){for(var i=0;i<r[0].length;i++){m[r[0][i]]={k:r[0][i],sh:0,f:FING[ri][i]};if(r[1][i]!==r[0][i])m[r[1][i]]={k:r[0][i],sh:1,f:FING[ri][i]}}});m[' ']={k:' ',sh:0,f:9};return KMAP[l]=m}

/* ---------- генерация текста ---------- */
function setUpTo(l,i){var s='';KD.lessons[l].slice(0,i+1).forEach(function(x){if(x.n)s+=x.n});return s}
function allIn(w,s){for(var i=0;i<w.length;i++)if(s.indexOf(w[i])<0)return false;return true}
function anyOf(w,s){for(var i=0;i<w.length;i++)if(s.indexOf(w[i])>=0)return true;return false}
function pseudo(l,set,nw){
  var V=KD.vow[l],vs=set.split('').filter(function(c){return V.indexOf(c)>=0}),cs=set.split('').filter(function(c){return V.indexOf(c)<0}),len=2+Math.floor(Math.random()*4),w='';
  var pool=function(){return nw&&Math.random()<.55?nw:set};
  for(var i=0;i<len;i++){var p=pool(),c;if(vs.length&&cs.length){var wantV=(i%2===(Math.random()<.5?0:1));var sub=p.split('').filter(function(x){return (V.indexOf(x)>=0)===wantV});c=sub.length?rnd(sub):rnd(p.split(''))}else c=rnd(p.split(''));w+=c}
  return w}
function genLetters(l,i,len){
  var L=KD.lessons[l][i],set=setUpTo(l,i),nw=L.n,dict=KD.dict[l].filter(function(w){return allIn(w,set)}),withNew=dict.filter(function(w){return anyOf(w,nw)}),out=[],tot=0;
  var useReal=Math.min(.85,withNew.length/10);
  while(tot<len){var w;if(withNew.length&&Math.random()<useReal)w=rnd(withNew);else if(dict.length>12&&Math.random()<useReal*.5)w=rnd(dict);else w=pseudo(l,set,nw);out.push(w);tot+=w.length+1}
  return out.join(' ')}
function cap(w){return w.charAt(0).toUpperCase()+w.slice(1)}
function genWords(l,n,caps){var d=shuf(KD.dict[l]),o=[];for(var i=0;i<n;i++){var w=d[i%d.length];o.push(caps&&Math.random()<.35?cap(w):w)}return o.join(' ')}
function genDigits(){var k=Math.floor(Math.random()*5);if(k===0)return String(Math.floor(Math.random()*9000+1000));if(k===1)return String(Math.floor(Math.random()*90+10))+'.'+('0'+Math.floor(Math.random()*12+1)).slice(-2)+'.'+(2000+Math.floor(Math.random()*30));if(k===2)return Math.floor(Math.random()*90+1)+','+Math.floor(Math.random()*90+10);if(k===3)return String(Math.floor(Math.random()*900000+100000));return Math.floor(Math.random()*20+1)+'-'+Math.floor(Math.random()*90+10)+'-'+Math.floor(Math.random()*90+10)}
function genSym(l,kind,n){
  var d=KD.dict[l],o=[];
  for(var i=0;i<n;i++){var r=Math.random(),w=rnd(d);
    if(kind==='dig'||(kind==='mix'&&r<.4))o.push(genDigits());
    else if(kind==='pun'||kind==='mix'){var t=Math.floor(Math.random()*5);o.push(t===0?w+',':t===1?w+'!':t===2?w+'?':t===3?'('+w+')':'"'+w+'"')}}
  return o.join(' ')}
function lessonText(l,i){
  var L=KD.lessons[l][i],k=L.k;
  if(!k)return genLetters(l,i,i<4?90:130);
  var all=setUpTo(l,KD.lessons[l].length-1),ru=l==='ru';
  if(k==='caps'){var w=shuf(KD.dict[l]).slice(0,16).map(function(x,j){return j%2?x:cap(x)});return w.join(' ')}
  if(k==='pun1'){var s=shuf(KD.dict[l]).slice(0,5).map(function(x,j){return x+(j%2?'.':',')}).join(' ');return s+' '+shuf(KD.dict[l]).slice(0,4).join(', ')+'.'}
  if(k==='dig')return genDigits()+' '+genDigits()+' '+genWords(l,3)+' '+genDigits()+' '+genDigits()+' '+genWords(l,2)+' '+genDigits()+' '+genDigits()
  if(k==='pun2')return genSym(l,'pun',14);
  if(k==='sent')return shuf(KD.sent[l]).slice(0,4).join(' ');
  return shuf(KD.sent[l]).slice(0,3).join(' ')+' '+rnd(KD.texts[l].filter(function(x){return x.c==='t'})).s.split('. ').slice(0,2).join('. ')}

/* ---------- состояние запуска ---------- */
var R=null,TM=null,GM=null,AC=null,ROOT=$('#kl');
function beep(ok){if(!D.snd)return;try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();var o=AC.createOscillator(),g=AC.createGain();o.type=ok?'triangle':'square';o.frequency.value=ok?680:180;g.gain.value=ok?.04:.05;o.connect(g);g.connect(AC.destination);o.start();o.stop(AC.currentTime+(ok?.04:.09))}catch(e){}}

/* ---------- клавиатура на экране ---------- */
function kbHTML(l){
  var h='<div class="kb" data-l="'+l+'">';
  LAY[l].rows.forEach(function(r,ri){
    h+='<div class="kr r'+ri+'">';
    for(var i=0;i<r[0].length;i++){
      var c=r[0][i],sh=r[1][i]!==c?r[1][i]:'',isL=/[a-zа-яё]/i.test(c),face=isL?c.toUpperCase():c,sup=(sh&&!isL)?'<i>'+esc(sh)+'</i>':'';
      h+='<span class="kk f'+FING[ri][i]+(LAY[l].home.indexOf(c)>=0?' hm':'')+'" data-k="'+esc(c)+'">'+sup+esc(face)+'</span>'}
    if(ri===0)h+='<span class="kk kw f8 bk" data-k="bs">⌫</span>';
    h+='</div>'});
  return h+'<div class="kr r4"><span class="kk kw f1 shl" data-k="shl">Shift</span><span class="kk ksp f9" data-k=" ">пробел</span><span class="kk kw f8 shr" data-k="shr">Shift</span></div></div>'}
function kbMark(ch){
  $$('.kk.on',ROOT).forEach(function(n){n.classList.remove('on')});
  var hint=$('#khint');
  if(ch==null){if(hint)hint.textContent='';return}
  var m=kmap(R.lang)[ch];if(!m){if(hint)hint.textContent='';return}
  var el=$('.kk[data-k="'+m.k.replace(/"/g,'\\"').replace(/\\/g,'\\\\')+'"]',ROOT);if(el)el.classList.add('on');
  var sf='';if(m.sh){var sn=m.f<=4?'shr':'shl';var se=$('.kk[data-k="'+sn+'"]',ROOT);if(se)se.classList.add('on');sf=' + Shift '+(m.f<=4?'правым':'левым')+' мизинцем'}
  if(hint)hint.innerHTML='Дальше: <b>'+esc(ch===' '?'пробел':ch)+'</b> — '+FN[m.f]+sf}
function kbFlash(ch,ok){
  var m=kmap(R.lang)[ch];if(!m)return;var el=$('.kk[data-k="'+m.k.replace(/"/g,'\\"').replace(/\\/g,'\\\\')+'"]',ROOT);if(!el)return;
  el.classList.remove('hit','bad');void el.offsetWidth;el.classList.add(ok?'hit':'bad');setTimeout(function(){el.classList.remove('hit','bad')},180)}

/* ---------- запуск режимов ---------- */
function mkRun(cfg){
  var t=cfg.text;
  return {mode:cfg.mode,lang:cfg.lang||D.lang,text:t,st:new Array(t.length).fill(0),idx:0,keys:0,errs:0,t0:0,tEnd:0,limit:cfg.limit||0,les:cfg.les,okT:[],em:{},hm:{},done:false,label:cfg.label||'',stream:!!cfg.stream}}
function start(cfg){
  stopAll();R=mkRun(cfg);show('run');
  $('#ktext').innerHTML=R.text.split('').map(function(c,i){return '<span class="c" data-i="'+i+'">'+(c===' '?'&nbsp;':esc(c))+'</span>'}).join('');
  $('#kbox').scrollTop=0;
  $('#kkb').innerHTML=D.kb?kbHTML(R.lang):'';$('#kkb').hidden=!D.kb;$('#khint').hidden=!D.fing;
  ROOT.classList.toggle('nof',!D.fing);
  mark();stats();focusIn();
  if(R.limit){$('#kbar').hidden=false}else $('#kbar').hidden=false}
function more(){
  if(!R.stream)return;var add=' '+genWords(R.lang,40,false);var base=R.text.length;R.text+=add;
  for(var i=0;i<add.length;i++){R.st.push(0);var s=document.createElement('span');s.className='c';s.setAttribute('data-i',base+i);s.innerHTML=add[i]===' '?'&nbsp;':esc(add[i]);$('#ktext').appendChild(s)}}
function mark(){
  var cur=$('.c.cur',ROOT);if(cur)cur.classList.remove('cur');
  var el=$('.c[data-i="'+R.idx+'"]',ROOT);if(el){el.classList.add('cur');var b=$('#kbox'),lh=el.offsetHeight;b.scrollTop=Math.max(0,el.offsetTop-lh*1.2)}
  kbMark(R.idx<R.text.length?R.text[R.idx]:null)}
function paint(i){var el=$('.c[data-i="'+i+'"]',ROOT);if(!el)return;el.className='c'+(R.st[i]===1?' ok':R.st[i]===2?' er':'')}
function wrongLayout(ch,exp){
  var ls=LAY[R.lang].script,other=R.lang==='ru'?/[a-z]/i:/[а-яё]/i;
  return ls.test(exp)&&other.test(ch)}
function warn(t){var w=$('#kwarn');w.textContent=t;w.hidden=false;clearTimeout(warn.t);warn.t=setTimeout(function(){w.hidden=true},2600)}
function onChar(ch){
  if(!R||R.done||R.mode==='game')return;
  if(R.idx>=R.text.length)return;
  var exp=R.text[R.idx];
  if(wrongLayout(ch,exp)){warn(R.lang==='ru'?'Включи русскую раскладку: Alt+Shift или Win+Пробел':'Switch to the English layout: Alt+Shift or Win+Space');return}
  var now=performance.now();if(!R.t0){R.t0=now;if(R.limit)tick()}
  R.keys++;var hk=R.hm,ok=ch===exp;hk[exp]=(hk[exp]||0)+1;
  if(ok){R.st[R.idx]=1;R.okT.push(now-R.t0);R.idx++;beep(true);kbFlash(exp,true)}
  else{R.errs++;R.em[exp]=(R.em[exp]||0)+1;beep(false);kbFlash(exp,false);
    if(D.fix){var el=$('.c[data-i="'+R.idx+'"]',ROOT);if(el){el.classList.add('shake');setTimeout(function(){el.classList.remove('shake')},200)}}
    else{R.st[R.idx]=2;R.idx++}}
  if(ok||!D.fix)paint(R.idx-1);
  if(R.stream&&R.text.length-R.idx<70)more();
  if(!R.limit&&R.idx>=R.text.length){finish();return}
  mark();stats()}
function onBack(){
  if(!R||R.done||D.fix||R.idx<=0||R.mode==='game')return;
  R.idx--;R.st[R.idx]=0;paint(R.idx);mark()}
function tick(){
  clearInterval(TM);TM=setInterval(function(){
    if(!R||R.done){clearInterval(TM);return}
    var el=(performance.now()-R.t0)/1000;stats();
    if(R.limit&&el>=R.limit)finish()},100)}
function elapsed(){return R.t0?((R.tEnd||performance.now())-R.t0)/1000:0}
function calc(){
  var el=Math.max(.001,elapsed()),okc=R.st.filter(function(x){return x===1}).length,cpm=okc/el*60,acc=R.keys?(R.keys-R.errs)/R.keys*100:100;
  return {el:el,okc:okc,cpm:cpm,wpm:cpm/5,acc:acc}}
function stats(){
  if(!R||!$('#kst'))return;var c=calc();
  $('#ks-cpm').textContent=R.t0?nf(c.cpm,0):'0';$('#ks-wpm').textContent=R.t0?nf(c.wpm,0):'0';$('#ks-acc').textContent=nf(c.acc,0)+'%';
  var el=R.t0?c.el:0,t=R.limit?Math.max(0,R.limit-el):el;$('#ks-tm').textContent=Math.floor(t/60)+':'+('0'+Math.floor(t%60)).slice(-2);
  var pr=R.limit?Math.min(1,el/R.limit):R.idx/R.text.length;$('#kbarf').style.width=(pr*100)+'%'}
function rate(c){return c<60?'Первые шаги':c<120?'Новичок':c<200?'Уверенный':c<300?'Быстрый':'Мастер'}
function finish(){
  if(!R||R.done)return;R.done=true;R.tEnd=performance.now();clearInterval(TM);
  if(R.limit&&R.t0)R.tEnd=Math.min(R.tEnd,R.t0+R.limit*1000);
  var c=calc(),res={d:Date.now(),m:R.mode,l:R.lang,cpm:Math.round(c.cpm),acc:Math.round(c.acc*10)/10,sec:Math.round(c.el),ch:c.okc};
  if(c.okc>=10||R.mode==='les'){D.hist.push(res);if(D.hist.length>300)D.hist=D.hist.slice(-300)}
  for(var k in R.em){D.err[R.lang][k]=(D.err[R.lang][k]||0)+R.em[k]}
  for(var k2 in R.hm){D.hit[R.lang][k2]=(D.hit[R.lang][k2]||0)+R.hm[k2]}
  var extra='',les=R.les;
  if(les!=null){var L=KD.lessons[R.lang][les],goal=lessonGoal(les),pass=c.acc>=90&&c.cpm>=goal,stars=!pass?0:(c.acc>=97&&c.cpm>=goal*1.3?3:c.acc>=94&&c.cpm>=goal*1.1?2:1),old=D.les[R.lang][les]||{};
    D.les[R.lang][les]={s:Math.max(stars,old.s||0),b:Math.max(Math.round(c.cpm),old.b||0),a:Math.max(Math.round(c.acc),old.a||0)};
    res.pass=pass;res.stars=stars;res.goal=goal;res.les=les}
  save();showResult(c,res)}
function lessonGoal(i){return Math.round(40+i*3.2)}
function sparkline(){
  var T=R.okT,el=Math.max(1,Math.ceil(elapsed())),b=[];for(var s=0;s<el;s++)b.push(0);
  T.forEach(function(t){var s=Math.min(el-1,Math.floor(t/1000));b[s]++});
  var sm=b.map(function(v,i){var a=0,n=0;for(var j=Math.max(0,i-2);j<=Math.min(b.length-1,i+2);j++){a+=b[j];n++}return a/n*60});
  var W=520,H=110,mx=Math.max.apply(0,sm.concat([60])),pts=sm.map(function(v,i){return (sm.length<2?W/2:i/(sm.length-1)*(W-20)+10).toFixed(1)+','+(H-10-v/mx*(H-24)).toFixed(1)}).join(' ');
  return '<svg class="kspark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" role="img" aria-label="Скорость по секундам"><line x1="10" x2="'+(W-10)+'" y1="'+(H-10)+'" y2="'+(H-10)+'" class="ax"/><polyline points="'+pts+'" fill="none" stroke="var(--a2)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/><text x="12" y="14">пик '+nf(mx,0)+' зн/мин</text></svg>'}
function showResult(c,res){
  show('res');
  var worst=Object.keys(R.em).sort(function(a,b){return R.em[b]-R.em[a]}).slice(0,5).map(function(k){return '<span class="kchip">'+esc(k===' '?'пробел':k)+' <small>×'+R.em[k]+'</small></span>'}).join('');
  var h='<div class="kres-h"><div><div class="kbig">'+nf(c.cpm,0)+'<small> зн/мин</small></div><div class="kr2">'+nf(c.wpm,0)+' слов/мин · '+rate(c.cpm)+'</div></div>';
  if(res.les!=null){h+='<div class="kstars" aria-label="Звёзды">'+[1,2,3].map(function(i){return '<span class="'+(i<=res.stars?'on':'')+'">★</span>'}).join('')+'</div>'}
  h+='</div><div class="kgrid"><div><b>'+nf(c.acc,0)+'%</b><span>точность</span></div><div><b>'+R.errs+'</b><span>ошибок</span></div><div><b>'+nf(c.el,0)+' с</b><span>время</span></div><div><b>'+c.okc+'</b><span>знаков</span></div></div>';
  if(res.les!=null){h+='<p class="kmsg '+(res.pass?'good':'bad')+'">'+(res.pass?'Урок пройден! ':'Цель урока: точность от 90% и скорость от '+res.goal+' зн/мин. ')+(res.pass&&res.stars<3?'Для трёх звёзд — точность от 97% и скорость '+Math.round(res.goal*1.3)+'+.':'')+'</p>'}
  else if(c.acc<90)h+='<p class="kmsg bad">Много ошибок. Сбавь скорость: сначала точность, потом скорость.</p>';
  h+=R.mode==='game'?'':(sparkline()+(worst?'<div class="kwst"><span>Чаще всего промахи:</span> '+worst+'</div>':''));
  h+='<div class="kact">'+(res.les!=null&&res.pass&&res.les<KD.lessons[R.lang].length-1?'<button class="kbtn pri" data-a="next">Следующий урок →</button>':'')+'<button class="kbtn'+(res.les!=null&&res.pass?'':' pri')+'" data-a="again">Ещё раз</button><button class="kbtn" data-a="menu">Выбрать другое</button></div>';
  $('#kres').innerHTML=h}

/* ---------- игра «Дождь слов» ---------- */
function startGame(){
  stopAll();show('game');var lv=D.opt.game.lv,box=$('#kgame');box.innerHTML='';
  R={mode:'game',lang:D.lang,text:'',st:[],idx:0,keys:0,errs:0,t0:performance.now(),em:{},hm:{},okT:[],done:false};
  GM={words:[],buf:'',score:0,lives:5,spawn:0,last:performance.now(),gap:[2600,2000,1500][lv-1],speed:[34,48,66][lv-1],lv:lv,typed:0,level:1,killed:0};
  $('#kkb2').innerHTML=D.kb?kbHTML(D.lang):'';$('#kkb2').hidden=!D.kb;ROOT.classList.toggle('nof',!D.fing);R.lang=D.lang;gameHud();focusIn();
  (function loop(t){if(!GM)return;var dt=Math.min(.1,(t-GM.last)/1000);GM.last=t;GM.spawn+=dt*1000;
    if(GM.spawn>=GM.gap){GM.spawn=0;var d=KD.dict[R.lang].filter(function(w){return w.length>=3&&w.length<=(GM.lv===1?6:GM.lv===2?8:10)}),w=rnd(d),bw=box.clientWidth,el=document.createElement('span');el.className='gw';el.textContent=w;box.appendChild(el);var ww=el.offsetWidth;GM.words.push({w:w,el:el,x:Math.random()*Math.max(1,bw-ww-10)+5,y:-30});}
    var bh=box.clientHeight,sp=GM.speed*(1+(GM.level-1)*.12);
    for(var i=GM.words.length-1;i>=0;i--){var o=GM.words[i];o.y+=sp*dt;o.el.style.transform='translate('+o.x+'px,'+o.y+'px)';
      if(o.y>bh-30){o.el.remove();GM.words.splice(i,1);GM.lives--;GM.buf='';box.classList.add('hurt');setTimeout(function(){box.classList.remove('hurt')},200);gameHud();if(GM.lives<=0){gameOver();return}}}
    gameMarks();GM.raf=requestAnimationFrame(loop)})(performance.now())}
function gameMarks(){
  var kb=null;GM.words.forEach(function(o){var m=o.w.indexOf(GM.buf)===0&&GM.buf;o.el.innerHTML=m?'<u>'+esc(o.w.slice(0,GM.buf.length))+'</u>'+esc(o.w.slice(GM.buf.length)):esc(o.w);o.el.classList.toggle('act',!!m)});
  var next=null,best=-1;GM.words.forEach(function(o){if(o.w.indexOf(GM.buf)===0&&o.y>best){best=o.y;next=o}});
  if(next&&GM.buf.length<next.w.length)kbMark(next.w[GM.buf.length])}
function gameHud(){$('#kg-sc').textContent=GM.score;$('#kg-lv').textContent=GM.level;$('#kg-li').textContent='♥'.repeat(Math.max(0,GM.lives))+'♡'.repeat(Math.max(0,5-GM.lives))}
function gameChar(ch){
  if(!GM)return;var nb=GM.buf+ch;R.keys++;
  var hit=GM.words.filter(function(o){return o.w.indexOf(nb)===0});
  if(!hit.length){R.errs++;beep(false);return}
  GM.buf=nb;GM.typed++;beep(true);R.hm[ch]=(R.hm[ch]||0)+1;
  var done=GM.words.filter(function(o){return o.w===nb})[0];
  if(done){done.el.classList.add('pop');var el=done.el;setTimeout(function(){el.remove()},180);GM.words.splice(GM.words.indexOf(done),1);GM.score+=nb.length*10;GM.killed++;GM.buf='';if(GM.killed%8===0){GM.level++;GM.gap=Math.max(650,GM.gap*.9)}gameHud()}}
function gameOver(){
  cancelAnimationFrame(GM.raf);var el=(performance.now()-R.t0)/1000,c=GM.typed/el*60,sc=GM.score,lv=GM.level;GM=null;R.done=true;
  D.hist.push({d:Date.now(),m:'game',l:R.lang,cpm:Math.round(c),acc:R.keys?Math.round((R.keys-R.errs)/R.keys*1000)/10:100,sec:Math.round(el),ch:R.keys-R.errs,sc:sc});
  var rec=D.opt.game['best'+D.opt.game.lv]||0,isRec=sc>rec;if(isRec)D.opt.game['best'+D.opt.game.lv]=sc;save();show('res');
  $('#kres').innerHTML='<div class="kres-h"><div><div class="kbig">'+sc+'<small> очков</small></div><div class="kr2">уровень '+lv+' · '+nf(c,0)+' зн/мин'+(isRec?' · новый рекорд!':rec?' · рекорд '+rec:'')+'</div></div></div><div class="kact"><button class="kbtn pri" data-a="again">Играть ещё</button><button class="kbtn" data-a="menu">Выбрать другое</button></div>'}

/* ---------- экраны ---------- */
var V='menu';
function show(v){V=v;['menu','run','res','game'].forEach(function(x){var e=$('#kv-'+x);if(e)e.hidden=x!==v});$('#kmodes').hidden=(v!=='menu');ROOT.classList.toggle('running',v==='run'||v==='game');if(v==='menu')window.scrollTo({top:0})}
function stopAll(){clearInterval(TM);if(GM){cancelAnimationFrame(GM.raf);GM=null}}
function focusIn(){var i=$('#kin');i.value='';try{i.focus({preventScroll:true})}catch(e){i.focus()}}
var MODES=[['les','Уроки','Для новичка: буква за буквой'],['words','Слова','Случайные слова'],['text','Тексты','Готовые отрывки'],['time','На время','15 секунд — 3 минуты'],['sym','Цифры и знаки','Числа и пунктуация'],['game','Дождь слов','Игра на скорость'],['stat','Статистика','Прогресс и слабые клавиши']];
function chips(name,opts,cur,fmt){return '<div class="kchips" data-o="'+name+'">'+opts.map(function(o){return '<button type="button" class="kchip2'+(String(o)===String(cur)?' on':'')+'" data-v="'+o+'">'+(fmt?fmt(o):o)+'</button>'}).join('')+'</div>'}
function menuHTML(){
  var l=D.lang,m=D.mode,h='';
  if(m==='les'){
    var ls=KD.lessons[l],done=ls.filter(function(x,i){return D.les[l][i]&&D.les[l][i].s>0}).length,first=0;for(var i=0;i<ls.length;i++){if(!(D.les[l][i]&&D.les[l][i].s>0)){first=i;break}first=i}
    h+='<p class="kdesc">Каждый урок учит несколько новых клавиш. Печатай всеми десятью пальцами и не смотри на клавиатуру. Пройдено: <b>'+done+' из '+ls.length+'</b>.</p><div class="klg">';
    ls.forEach(function(x,i){var r=D.les[l][i]||{},st=r.s||0;h+='<button type="button" class="klc'+(i===first&&!st?' next':'')+(st?' done':'')+'" data-les="'+i+'"><i>'+(i+1)+'</i><b>'+esc(x.t)+'</b><span class="kst">'+[1,2,3].map(function(n){return '<em class="'+(n<=st?'on':'')+'">★</em>'}).join('')+'</span>'+(r.b?'<small>лучший: '+r.b+' зн/мин</small>':'<small>цель: '+lessonGoal(i)+' зн/мин</small>')+'</button>'});
    h+='</div>'}
  else if(m==='words'){var o=D.opt.words;h+='<p class="kdesc">Случайные частые слова. Хорошая разминка.</p><div class="kopt"><span>Сколько слов</span>'+chips('words.n',[10,25,50,100],o.n)+'</div><div class="kopt"><span>Заглавные</span>'+chips('words.caps',[0,1],o.caps?1:0,function(v){return v?'Да':'Нет'})+'</div><button class="kbtn pri big" data-a="go">Начать</button>'}
  else if(m==='text'){h+='<p class="kdesc">Выбери отрывок или нажми «Случайный».</p><div class="ktl"><button type="button" class="kt" data-tx="r"><b>Случайный</b><small>любой отрывок</small></button>'+KD.texts[l].map(function(x){return '<button type="button" class="kt" data-tx="'+x.id+'"><b>'+esc(x.t)+'</b><small>'+x.s.length+' знаков · '+(x.c==='w'?'скороговорки':'текст')+'</small></button>'}).join('')+'</div>'}
  else if(m==='time'){var o=D.opt.time;h+='<p class="kdesc">Печатай, пока не кончится время. Слова будут появляться без остановки.</p><div class="kopt"><span>Время</span>'+chips('time.sec',[15,30,60,120,180],o.sec,function(v){return v<60?v+' с':v/60+' мин'})+'</div><button class="kbtn pri big" data-a="go">Начать</button>'}
  else if(m==='sym'){var o=D.opt.sym;h+='<p class="kdesc">Цифры и знаки — самое неудобное для новичков. Тренируйся отдельно.</p><div class="kopt"><span>Что печатать</span>'+chips('sym.kind',['dig','pun','mix'],o.kind,function(v){return {dig:'Цифры',pun:'Знаки',mix:'Вместе'}[v]})+'</div><div class="kopt"><span>Сколько</span>'+chips('sym.n',[15,30,60],o.n)+'</div><button class="kbtn pri big" data-a="go">Начать</button>'}
  else if(m==='game'){var o=D.opt.game;h+='<p class="kdesc">Слова падают сверху. Набери слово целиком, пока оно не упало. 5 жизней. Чем дальше, тем быстрее.</p><div class="kopt"><span>Сложность</span>'+chips('game.lv',[1,2,3],o.lv,function(v){return ['Лёгкая','Средняя','Быстрая'][v-1]})+'</div><div class="kopt"><span>Рекорд</span><b>'+(o['best'+o.lv]||0)+' очков</b></div><button class="kbtn pri big" data-a="go">Играть</button>'}
  else h+=statHTML();
  return h}
function statHTML(){
  var H=D.hist.filter(function(x){return x.l===D.lang}),n=H.length;
  if(!n)return '<p class="kdesc">Пока пусто. Пройди любой урок или тест, и здесь появится прогресс.</p>';
  var best=Math.max.apply(0,H.map(function(x){return x.cpm})),last=H.slice(-10),avg=last.reduce(function(a,x){return a+x.cpm},0)/last.length,acc=last.reduce(function(a,x){return a+x.acc},0)/last.length,sec=H.reduce(function(a,x){return a+x.sec},0);
  var W=560,Hh=140,L=H.slice(-30),mx=Math.max.apply(0,L.map(function(x){return x.cpm}).concat([60])),bw=(W-30)/L.length;
  var bars=L.map(function(x,i){var hh=x.cpm/mx*(Hh-34);return '<rect x="'+(20+i*bw+1).toFixed(1)+'" y="'+(Hh-18-hh).toFixed(1)+'" width="'+Math.max(2,bw-3).toFixed(1)+'" height="'+hh.toFixed(1)+'" rx="2" class="'+(x.acc<90?'lo':'')+'"><title>'+x.cpm+' зн/мин, точность '+x.acc+'%</title></rect>'}).join('');
  var h='<div class="kgrid big"><div><b>'+best+'</b><span>лучшая скорость, зн/мин</span></div><div><b>'+nf(avg,0)+'</b><span>средняя (10 последних)</span></div><div><b>'+nf(acc,0)+'%</b><span>точность (10 последних)</span></div><div><b>'+Math.round(sec/60)+' мин</b><span>всего практики · '+n+' заходов</span></div></div>'
  +'<h3 class="kh3">Скорость последних заходов</h3><svg class="kspark bars" viewBox="0 0 '+W+' '+Hh+'" preserveAspectRatio="none"><line x1="14" x2="'+(W-6)+'" y1="'+(Hh-18)+'" y2="'+(Hh-18)+'" class="ax"/>'+bars+'<text x="16" y="12">макс. '+mx+' зн/мин · красные — точность ниже 90%</text></svg>';
  var er=D.err[D.lang],ht=D.hit[D.lang],keys=Object.keys(er).filter(function(k){return (ht[k]||0)>=3}).sort(function(a,b){return er[b]/(ht[b])-er[a]/(ht[a])}).slice(0,6);
  h+='<h3 class="kh3">Слабые клавиши</h3>'+(keys.length?'<p class="kdesc">'+keys.map(function(k){return '<span class="kchip">'+esc(k===' '?'пробел':k)+' <small>'+nf(er[k]/ht[k]*100,0)+'%</small></span>'}).join(' ')+'<br>Процент — доля промахов на этой клавише. Потренируй её в уроках.</p>':'<p class="kdesc">Пока мало данных.</p>')
  +'<button class="kbtn" data-a="reset">Сбросить статистику и уроки</button>';
  return h}
function drawMenu(){
  $('#kmodes').innerHTML=MODES.map(function(x){return '<button type="button" class="kmode'+(D.mode===x[0]?' on':'')+'" data-m="'+x[0]+'"><b>'+x[1]+'</b><small>'+x[2]+'</small></button>'}).join('');
  $('#kv-menu').innerHTML=menuHTML();
  $$('[data-lang]').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-lang')===D.lang)});
  [['fix'],['kb'],['fing'],['snd']].forEach(function(a){var b=$('[data-tg="'+a[0]+'"]');if(b){b.classList.toggle('on',!!D[a[0]]);b.setAttribute('aria-pressed',!!D[a[0]])}});
  $('#kroot-size').textContent=Math.round(D.size*100)+'%';ROOT.style.setProperty('--ks',D.size)}
function go(){
  var l=D.lang,m=D.mode;
  if(m==='words'){var o=D.opt.words;start({mode:'words',text:genWords(l,o.n,o.caps)})}
  else if(m==='time'){start({mode:'time',text:genWords(l,60,false),limit:D.opt.time.sec,stream:true})}
  else if(m==='sym'){var o2=D.opt.sym;start({mode:'sym',text:genSym(l,o2.kind,o2.n)})}
  else if(m==='game')startGame()}
function startLesson(i){D.lastLes=i;start({mode:'les',les:i,text:lessonText(D.lang,i)})}
function startText(id){var a=KD.texts[D.lang],x=id==='r'?rnd(a):a.filter(function(t){return t.id===id})[0];D.lastText=x.id;start({mode:'text',text:x.s})}
function again(){var m=R&&R.mode;if(m==='les')startLesson(R.les);else if(m==='text')startText(D.lastText||'r');else if(m==='game')startGame();else go()}

/* ---------- события ---------- */
ROOT.addEventListener('click',function(e){
  var t=e.target.closest('button,[data-les],[data-tx]');
  if(!t){if(e.target.closest('#kstage,#kv-game'))focusIn();return}
  var v;
  if((v=t.getAttribute('data-m'))){D.mode=v;save();drawMenu();return}
  if((v=t.getAttribute('data-lang'))){D.lang=v;save();drawMenu();return}
  if((v=t.getAttribute('data-tg'))){D[v]=!D[v];save();drawMenu();if(V==='run'||V==='game'){$('#kkb').hidden=!D.kb;$('#khint').hidden=!D.fing;ROOT.classList.toggle('nof',!D.fing);if(R&&V==='run'){$('#kkb').innerHTML=D.kb?kbHTML(R.lang):'';mark()}}return}
  if((v=t.getAttribute('data-sz'))){D.size=Math.max(.8,Math.min(1.6,Math.round((D.size+(+v))*100)/100));save();drawMenu();return}
  if(t.hasAttribute('data-les')){startLesson(+t.getAttribute('data-les'));return}
  if(t.hasAttribute('data-tx')){startText(t.getAttribute('data-tx'));return}
  if((v=t.getAttribute('data-v'))!==null&&t.parentNode.hasAttribute('data-o')){var p=t.parentNode.getAttribute('data-o').split('.');var val=/^\d+$/.test(v)?+v:v;if(p[1]==='caps')val=!!+v;D.opt[p[0]][p[1]]=val;save();drawMenu();return}
  if((v=t.getAttribute('data-a'))){
    if(v==='go')go();else if(v==='again')again();else if(v==='menu'){stopAll();R=null;show('menu');drawMenu()}
    else if(v==='next'){startLesson(R.les+1)}
    else if(v==='quit'){stopAll();if(R&&!R.done&&R.mode!=='game'&&R.keys>=10){finish()}else{R=null;show('menu');drawMenu()}}
    else if(v==='redo'){again()}
    else if(v==='reset'){if(t.getAttribute('data-sure')){D.hist=[];D.les={ru:{},en:{}};D.err={ru:{},en:{}};D.hit={ru:{},en:{}};D.opt.game.best1=D.opt.game.best2=D.opt.game.best3=0;save();drawMenu()}else{t.setAttribute('data-sure','1');t.textContent='Точно сбросить? Нажми ещё раз';setTimeout(function(){drawMenu()},3500)}}
    return}});
var IN=$('#kin');
IN.addEventListener('input',function(){var s=IN.value;IN.value='';if(!s)return;for(var i=0;i<s.length;i++){var c=s[i];if(c==='\n'||c==='\r')continue;if(V==='game')gameChar(c);else onChar(c)}});
IN.addEventListener('keydown',function(e){
  if(e.key==='Backspace'){e.preventDefault();onBack();return}
  if(e.key==='Escape'){e.preventDefault();var q=$('[data-a="quit"]');if(V==='run'||V==='game')q.click();return}
  if(e.key==='Tab'&&(V==='run')){e.preventDefault();again();return}
  if(e.key==='Enter'){e.preventDefault()}});
IN.addEventListener('blur',function(){if(V==='run'||V==='game')ROOT.classList.add('blur')});
IN.addEventListener('focus',function(){ROOT.classList.remove('blur')});
document.addEventListener('keydown',function(e){
  if((V==='run'||V==='game')&&document.activeElement!==IN&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&(e.key.length===1||e.key==='Backspace'||e.key==='Escape')&&!/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName||'')){focusIn()}
  if(V==='res'&&(e.key==='Enter')){var b=$('#kres .kbtn.pri');if(b){e.preventDefault();b.click()}}});
window.__klava={D:D,KD:KD,gen:lessonText,get R(){return R}};
show('menu');drawMenu();
})();
