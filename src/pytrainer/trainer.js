(function(){
'use strict';
var PYO='https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
var LS='pyd:v1',EXAM_MIN=80,RUN_MS=4000;
var $=function(i){return document.getElementById(i)};
function toTop(){var d=$('pd');if(!d)return;var r=d.getBoundingClientRect();if(r.top<0)window.scrollTo({top:r.top+window.scrollY-70})}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function fmt(n){return (Math.round(n*100)/100).toString().replace('.',',')}
function inl(s){return esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')}
function paras(s){return String(s).split(/\n\n+/).map(function(p){return '<p>'+inl(p).replace(/\n/g,'<br>')+'</p>'}).join('')}
/* ---------- хранилище ---------- */
var SETV='2026-11-13';/* версия набора задач: при смене прогресс и код старых задач сбрасываются */
var P={code:{},tr:{},ex:{},setv:SETV};
try{var raw=JSON.parse(localStorage.getItem(LS)||'null');if(raw&&typeof raw==='object'&&raw.setv===SETV){P.code=raw.code||{};P.tr=raw.tr||{};P.ex=raw.ex||{}}}catch(e){}
function save(){try{P.setv=SETV;localStorage.setItem(LS,JSON.stringify(P))}catch(e){}}
/* ---------- подсветка кода ---------- */
var KW={and:1,as:1,break:1,class:1,continue:1,def:1,elif:1,else:1,except:1,False:1,finally:1,for:1,from:1,if:1,import:1,in:1,is:1,lambda:1,None:1,not:1,or:1,pass:1,return:1,True:1,try:1,while:1,with:1};
var BI={print:1,input:1,int:1,len:1,range:1,set:1,list:1,dict:1,str:1,float:1,sum:1,min:1,max:1,sorted:1,map:1,abs:1,round:1,type:1,enumerate:1,zip:1};
function hl(code){
  return String(code).replace(/(#[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_][A-Za-z_0-9]*)\b|([^]|\n)/g,function(m,c,s,n,w,o){
    if(c)return '<span class="hc">'+esc(c)+'</span>';
    if(s)return '<span class="hs">'+esc(s)+'</span>';
    if(n)return '<span class="hn">'+n+'</span>';
    if(w)return KW[w]===1?'<span class="hk">'+w+'</span>':BI[w]===1?'<span class="hb">'+w+'</span>':w;
    return esc(o);
  });
}
/* ---------- Python в браузере (Pyodide в воркере) ---------- */
var HARNESS=[
"import sys, io",
"def run_user(pre, code, stdin):",
"    g = {'__name__': '__main__'}",
"    old = (sys.stdin, sys.stdout, sys.stderr)",
"    out = io.StringIO()",
"    sys.stdin = io.StringIO(stdin); sys.stdout = out; sys.stderr = out",
"    et = em = ''; ln = 0",
"    try:",
"        if pre: exec(compile(pre, '<условие>', 'exec'), g)",
"        exec(compile(code, '<решение>', 'exec'), g)",
"    except SystemExit:",
"        pass",
"    except BaseException as e:",
"        et = type(e).__name__; em = str(e)",
"        if isinstance(e, SyntaxError):",
"            ln = e.lineno or 0",
"            em = e.msg or ''",
"        else:",
"            tb = e.__traceback__",
"            while tb is not None:",
"                if tb.tb_frame.f_code.co_filename == '<решение>': ln = tb.tb_lineno",
"                tb = tb.tb_next",
"    finally:",
"        sys.stdin, sys.stdout, sys.stderr = old",
"    return (out.getvalue()[:20000], et, em, ln)"
].join('\n');
var WSRC='var py=null;var HARNESS='+JSON.stringify(HARNESS)+';\n'+
'self.onmessage=async function(e){var m=e.data;try{\n'+
'if(m.t==="init"){importScripts(m.base+"pyodide.js");py=await loadPyodide({indexURL:m.base});py.runPython(HARNESS);postMessage({t:"ready"});return}\n'+
'if(m.t==="run"){var f=py.globals.get("run_user");var r=f(m.pre,m.code,m.stdin);var a=r.toJs();r.destroy();f.destroy();postMessage({t:"res",id:m.id,out:a[0],et:a[1],em:a[2],ln:a[3]})}\n'+
'}catch(x){postMessage({t:"fail",id:m.id,msg:String(x&&x.message||x)})}};';
var W=null,WREADY=null,WQ=Promise.resolve(),RID=0,WSTAT='idle';
function setStat(s,txt){WSTAT=s;var el=$('pst');if(el){el.textContent=txt||'';el.className='pst'+(s==='fail'?' err':'')}}
function startWorker(){
  if(W)return WREADY;
  setStat('load','Загружаю Python (один раз, около 10 МБ)…');
  var url=URL.createObjectURL(new Blob([WSRC],{type:'text/javascript'}));
  var w=new Worker(url);W=w;
  WREADY=new Promise(function(res,rej){
    w.onmessage=function(e){var m=e.data;if(m.t==='ready'){setStat('ok','Python готов');res(w)}else if(m.t==='fail'&&m.id==null){rej(new Error(m.msg))}};
    w.onerror=function(e){rej(new Error(e.message||'ошибка воркера'))};
    w.postMessage({t:'init',base:PYO});
  });
  WREADY.catch(function(err){W=null;WREADY=null;try{w.terminate()}catch(x){}setStat('fail','Python не загрузился (нужен интернет). Задачи и разборы работают без него.')});
  return WREADY;
}
function killWorker(){if(W){try{W.terminate()}catch(e){}}W=null;WREADY=null;WSTAT='idle'}
function runPy(pre,code,stdin){
  var job=function(){
    return startWorker().then(function(w){
      return new Promise(function(res){
        var id=++RID,done=false;
        var tm=setTimeout(function(){if(done)return;done=true;killWorker();res({out:'',et:'Timeout',em:'',ln:0,timeout:true})},RUN_MS);
        w.onmessage=function(e){var m=e.data;if(m.id!==id||done)return;done=true;clearTimeout(tm);if(m.t==='res')res({out:m.out,et:m.et,em:m.em,ln:m.ln});else res({out:'',et:'InternalError',em:m.msg,ln:0})};
        w.postMessage({t:'run',id:id,pre:pre,code:code,stdin:stdin});
      });
    },function(){return {out:'',et:'LoadError',em:'',ln:0}});
  };
  WQ=WQ.then(job,job);return WQ;
}
/* ---------- понятные ошибки ---------- */
var TIPS={
  SyntaxError:'Синтаксическая ошибка: проверьте двоеточия после `if`, `elif`, `else`, `for`, `while`, парные скобки и кавычки.',
  IndentationError:'Ошибка отступа: тело `if`, `for`, `while` должно быть сдвинуто вправо (4 пробела), и все строки одного блока — на одном уровне.',
  TabError:'В отступах смешаны табуляция и пробелы: используйте только пробелы.',
  NameError:'Имя не найдено: опечатка в названии или переменная ещё не создана на этом месте.',
  TypeError:'Несовместимые типы. Частая причина: число из `input()` не превращено в `int(...)`, а строка сравнивается или складывается с числом.',
  ValueError:'Значение не подходит: например, `int("abc")` или распаковка `a, b = ...` не в то число переменных. Проверьте `split` и формат ввода.',
  IndexError:'Выход за границы списка: индекс больше последнего. Проверьте `range(len(...))` и размеры списков.',
  KeyError:'В словаре нет такого ключа. Проверьте `in` перед обращением или используйте перебор по ключам.',
  EOFError:'Программа запросила больше строк `input()`, чем есть во входных данных. Проверьте, сколько раз вызывается `input()` и условие выхода из цикла.',
  ZeroDivisionError:'Деление на ноль: проверьте, что делитель не равен нулю (например, длина списка).',
  AttributeError:'У этого значения нет такого метода: проверьте, к чему применяете `.split`, `.append` и т. п. (строка или список).',
  UnboundLocalError:'Переменная используется до присваивания.'
};
function errText(r){
  if(r.timeout)return {head:'Программа не завершилась за '+RUN_MS/1000+' секунды',tip:'Похоже на бесконечный цикл. В `while True` нужен `break` (например, на слове `END`), а в `while` с условием оно должно когда-нибудь стать ложным.'};
  if(r.et==='LoadError')return {head:'Python не загрузился',tip:'Нужен интернет: при первом запуске скачивается интерпретатор (≈10 МБ). Обновите страницу и повторите.'};
  var head=(r.ln?'Строка '+r.ln+': ':'')+r.et+(r.em?': '+r.em:'');
  return {head:head,tip:TIPS[r.et]||''};
}
/* ---------- сравнение вывода ---------- */
function normOut(s){s=String(s||'');if(!s.trim())return '';return s.replace(/\r/g,'').split('\n').map(function(l){return l.replace(/\s+$/,'')}).join('\n').replace(/\n+$/,'')}
function why(got,exp,t,code){
  var tips=[],g=got.split('\n'),e=exp.split('\n');
  if(/input\(\s*['"]/.test(code||''))tips.push('В `input("...")` написан текст: он тоже попадает в вывод и портит ответ. Пишите просто `input()`.');
  if(!got&&exp)tips.push('Ничего не напечатано. Проверьте условие `if` (оно не сработало?) и что `print` стоит в нужном блоке.');
  else if(got&&!exp)tips.push('Нужно было ничего не печатать, а напечатано лишнее. Проверьте граничное условие (`<` и `<=`, `>` и `>=`) и условие в `if`.');
  else{
    if(got.length>exp.length&&got.slice(-exp.length)===exp&&got.slice(0,got.length-exp.length).indexOf('\n')<0)tips.push('Перед ответом напечатан лишний текст. Не пишите пояснение в `input("...")` и в `print`: нужно печатать только ответ.');
    if(g.length!==e.length)tips.push('Количество строк вывода не совпадает: ожидается '+e.length+', у вас '+g.length+'. Проверьте, что печатается по одному на строку, а не списком или через пробел (и наоборот).');
    else if(g.slice().sort().join('\n')===e.slice().sort().join('\n'))tips.push('Те же строки, но в другом порядке. Порядок должен совпадать с порядком во входных данных или в словаре.');
    if(/^-?\d+$/.test(got)&&/^-?\d+$/.test(exp)&&Math.abs(+got-+exp)===1)tips.push('Ответ отличается ровно на 1: обычно это граница (`<` вместо `<=`) или счётчик, начатый не с нуля.');
    if(got.charAt(0)==='['&&exp.charAt(0)!=='[')tips.push('Напечатан список целиком, а нужны элементы по одному (цикл с `print`).');
    if(got.charAt(0)!=='['&&exp.charAt(0)==='[')tips.push('Нужно напечатать список целиком: `print(список)`, а не элементы по одному.');
    if(got.replace(/\s+/g,'')===exp.replace(/\s+/g,''))tips.push('Различаются только пробелы или переводы строк между словами. Проверьте `print` с запятой (через пробел) и `end`.');
    if(/^\d+(\.\d+)?$/.test(got)&&got.indexOf('.')>=0&&exp.indexOf('.')<0)tips.push('Получилось дробное число: используйте `//` (целочисленное деление) или `int`.');
  }
  if(!tips.length&&/\d/.test(t.i))tips.push('Проверьте границу на числе из этого теста: `<` или `<=`, `>` или `>=` (в условии «не больше», «строго больше», «не меньше»).');
  if(!tips.length)tips.push('Результат не совпал. Прогоните свою программу на этом входе вручную («Свой ввод») и сравните с ожиданием по шагам.');
  return tips;
}
function diffBox(a,b,cls){
  var A=a.split('\n'),B=b.split('\n'),out=[];
  for(var i=0;i<Math.max(A.length,B.length);i++){var x=i<A.length?A[i]:null,same=x===B[i];out.push(x===null?'':'<span class="'+(same?'':'bad')+'">'+esc(x||' ')+'</span>')}
  return out.join('\n');
}
/* ---------- состояние ---------- */
var S={v:null,mode:'train',i:0,exam:null,timer:null,busy:false,sol:false};
function variant(id){for(var k=0;k<PYD.length;k++)if(PYD[k].id===id)return PYD[k];return PYD[0]}
function curTask(){return variant(S.v).tasks[S.i]}
function trRes(id){return P.tr[id]||(P.tr[id]={ok:0,att:0})}
function exOf(v){return P.ex[v]}
function taskPts(t,r){return r&&r.ok?t.pts*Math.max(0,1-0.1*(r.fail||0)):0}
function examScore(v){var e=exOf(v),s=0;if(!e)return 0;variant(v).tasks.forEach(function(t){s+=taskPts(t,e.r[t.id])});return s}
function statusOf(t){
  if(S.mode==='exam'){var r=exOf(S.v).r[t.id];return r?(r.ok?'ok':(r.fail?'bad':'')):''}
  var r2=P.tr[t.id];return r2?(r2.ok?'ok':(r2.att?'bad':'')):'';
}
/* ---------- меню ---------- */
function renderMenu(){
  stopTimer();S.sol=false;$('pd').classList.remove('inwork');
  var h='';
  h+='<div class="ph3">Выбери вариант</div><div class="pvars">';
  PYD.forEach(function(v){
    var e=exOf(v.id),dots=v.tasks.map(function(t){var s;if(S.mode==='exam'){var r=e&&e.r[t.id];s=r?(r.ok?'ok':(r.fail?'bad':'')):''}else{var q=P.tr[t.id];s=q?(q.ok?'ok':(q.att?'bad':'')):''}return '<i class="pdot '+s+'" title="'+esc(t.title)+'"></i>'}).join('');
    var solved=v.tasks.filter(function(t){var q=P.tr[t.id];return q&&q.ok}).length;
    var lab,sub;
    if(S.mode==='exam'){
      if(e&&!e.fin){lab='Продолжить';sub='идёт контрольная'}else if(e&&e.fin){lab='Заново';sub='результат: '+fmt(examScore(v.id))+' из 10'}else{lab='Начать';sub='10 задач, 10 баллов, '+EXAM_MIN+' минут'}
    }else{lab='Открыть';sub=solved?'решено '+solved+' из 10':'10 задач, 10 баллов'}
    h+='<div class="pvar"><h3><i>'+esc(v.name.slice(-1))+'</i>'+esc(v.name)+'</h3><p>'+esc(v.sub)+' · '+esc(sub)+'</p><div class="pp">'+dots+'</div><div class="prow">'+
       '<button type="button" class="pbtn pri" data-start="'+v.id+'">'+lab+'</button>'+
       (S.mode==='exam'&&e&&e.fin?'<button type="button" class="pbtn" data-res="'+v.id+'">Итог и разбор</button>':'')+'</div></div>';
  });
  h+='</div><p class="pnote"><b>Как это работает.</b> Читаешь задачу, пишешь код, жмёшь «Проверить»: программа запускается здесь же (при первом запуске Python грузится ≈10 МБ, нужен интернет) и сравнивает вывод с ответом на всех тестах. Два примера видны в условии, остальные тесты скрыты, как на настоящей проверке. Посмотреть готовое решение и разбор можно только после первой проверки. Прогресс хранится в этом браузере.</p>';
  $('pv-menu').innerHTML=h;$('pv-menu').hidden=false;$('pv-work').hidden=true;$('pv-end').hidden=true;
}
/* ---------- рабочее окно ---------- */
function startVariant(v){
  S.v=v;S.i=0;S.sol=false;
  if(S.mode==='exam'){
    var e=exOf(v);
    if(!e||e.fin){variant(v).tasks.forEach(function(t){delete P.code[t.id]});P.ex[v]={start:Date.now(),fin:false,r:{}};save()}
  }
  renderWork();
}
function renderWork(){
  var v=variant(S.v),t=curTask(),ex=S.mode==='exam';
  var tabs=v.tasks.map(function(x,k){return '<button type="button" class="ptab '+statusOf(x)+(k===S.i?' cur':'')+'" data-i="'+k+'" aria-label="Задача '+(k+1)+'">'+(k+1)+'<small>'+fmt(x.pts)+' б.</small></button>'}).join('');
  var ex2=t.tests.slice(0,2).map(function(x,k){return '<div class="pex"><div><small>Пример '+(k+1)+' — ввод</small><pre class="pbk">'+esc(x.i)+'</pre></div><div><small>вывод</small><pre class="pbk">'+esc(x.o||'(пусто)')+'</pre></div></div>'}).join('');
  var h='<div class="pbar"><button type="button" class="pbtn sm" data-a="menu">← Варианты</button><span class="ptt">'+esc(v.name)+' · '+esc(v.sub)+'</span>'+(ex?'<span class="pbadge ex">Контрольная</span>':'')+'<span class="pspc"></span>'+
    (ex?'<span class="pscore">Баллы: <b id="pscore">'+fmt(examScore(S.v))+'</b> / 10</span><span class="ptimer" id="ptimer">--:--</span><button type="button" class="pbtn sm" data-a="finish">Завершить</button>':'')+'</div>'+
    '<nav class="ptabs" id="ptabs">'+tabs+'</nav>'+
    '<div class="pgrid"><article class="ptask"><button type="button" class="pbtn sm pqc" data-a="tkx">✕ Закрыть условие</button><h2>Задача '+t.n+'. '+esc(t.title)+'</h2><div class="pmeta"><span class="pts">'+fmt(t.pts)+' балла</span><span>'+esc(t.topics)+'</span></div>'+paras(t.text)+
      '<h4>Формат ввода</h4><p>'+inl(t.fin)+'</p><h4>Формат вывода</h4><p>'+inl(t.fout)+'</p><h4>Примеры</h4>'+ex2+'<p class="pst" style="margin:6px 0 0">Остальные тесты скрыты: проверьте пустой ответ, равенство границе и один элемент.</p></article>'+
    '<div class="pcode"><button type="button" class="pbtn sm pqb" data-a="tk">📖 Условие</button>'+(t.pre?'<div class="ppre-l">В окне уже задано (не переписывайте, используйте):</div><pre class="pbk ppre" id="ppre">'+hl(t.pre)+'</pre>':'')+
      '<textarea id="pcode" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="Код решения" placeholder="Напишите решение здесь"></textarea>'+
      '<div class="pkeys"><button type="button" class="pbtn sm" data-k="tab" title="Tab">⇥ отступ</button><button type="button" class="pbtn sm" data-k="untab" title="Shift+Tab">⇤ назад</button><button type="button" class="pbtn sm" data-k="colon">:</button><button type="button" class="pbtn sm" data-k="q">\'\'</button><button type="button" class="pbtn sm" data-k="br">[]</button><button type="button" class="pbtn sm" data-k="par">()</button></div>'+
      '<div class="pact"><button type="button" class="pbtn" data-a="run" title="Ctrl+Enter">▶ Запустить</button><button type="button" class="pbtn pri" data-a="check">✓ Проверить</button>'+
        '<button type="button" class="pbtn" id="psolb" data-a="sol"'+(ex?' disabled title="Откроется после завершения"':(solOpen(t)?'':' disabled title="Сначала нажми «Проверить»"'))+'>Посмотреть ответ</button><button type="button" class="pbtn sm" data-a="reset">Сбросить код</button></div>'+
      '<details class="pin"><summary>Свой ввод для запуска</summary><textarea id="pin" spellcheck="false" aria-label="Входные данные"></textarea></details>'+
      '<div class="pst" id="pst"></div><div class="pout" id="pout"></div></div></div><div id="psol"></div>';
  closeTask();$('pd').classList.add('inwork');var w=$('pv-work');w.innerHTML=h;w.hidden=false;$('pv-menu').hidden=true;$('pv-end').hidden=true;
  var ta=$('pcode');ta.value=P.code[t.id]||'';
  $('pin').value=t.tests[0].i;
  ta.addEventListener('input',function(){P.code[t.id]=ta.value;clearTimeout(S.sv);S.sv=setTimeout(save,400)});
  ta.addEventListener('keydown',editorKeys);
  setStat(WSTAT,WSTAT==='ok'?'Python готов':'');
  if(ex)startTimer();else stopTimer();
  if(WSTAT==='idle')setTimeout(function(){startWorker().catch(function(){})},600);
  toTop();
}
function closeTask(){var d=document.getElementById('pqs');if(d)d.remove()}
function openTask(){
  var el=document.querySelector('.ptask');if(!el)return;closeTask();
  var d=document.createElement('div');d.id='pqs';d.innerHTML='<div class="ptask">'+el.innerHTML+'</div>';
  d.addEventListener('click',function(e){if(e.target===d||(e.target.closest&&e.target.closest('[data-a="tkx"]')))closeTask()});
  document.body.appendChild(d);
}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeTask()});
function editorKeys(e){
  var ta=e.target;
  if(e.key==='Tab'){e.preventDefault();e.shiftKey?dedent(ta):indent(ta)}
  else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();doRun()}
  else if(e.key==='Enter'&&!e.shiftKey&&!e.altKey){
    var v=ta.value,s=ta.selectionStart,ls=v.lastIndexOf('\n',s-1)+1,line=v.slice(ls,s),ind=line.match(/^ */)[0],extra=/:\s*$/.test(line)?'    ':'';
    e.preventDefault();ins(ta,'\n'+ind+extra);
  }
}
function ins(ta,txt){ta.focus();var ok=false;try{ok=document.execCommand('insertText',false,txt)}catch(x){}if(!ok){ta.setRangeText(txt,ta.selectionStart,ta.selectionEnd,'end');ta.dispatchEvent(new Event('input'))}}
function indent(ta){
  var v=ta.value,a=ta.selectionStart,b=ta.selectionEnd;
  if(a===b||v.slice(a,b).indexOf('\n')<0){ins(ta,'    ');return}
  var ls=v.lastIndexOf('\n',a-1)+1,blk=v.slice(ls,b).replace(/^/gm,'    ');
  ta.setSelectionRange(ls,b);ins(ta,blk);ta.setSelectionRange(ls,ls+blk.length);
}
function dedent(ta){
  var v=ta.value,a=ta.selectionStart,b=ta.selectionEnd,ls=v.lastIndexOf('\n',a-1)+1,blk=v.slice(ls,b),nb=blk.replace(/^( {1,4}|\t)/gm,'');
  if(nb===blk)return;ta.setSelectionRange(ls,b);ins(ta,nb);ta.setSelectionRange(Math.max(ls,a-(blk.length-nb.length)>0?Math.max(ls,a-4):ls),ls+nb.length);
}
function keyBtn(k){
  var ta=$('pcode');if(!ta)return;
  if(k==='tab')indent(ta);else if(k==='untab')dedent(ta);
  else if(k==='colon')ins(ta,':');
  else{var pair={q:["''",1],br:['[]',1],par:['()',1]}[k];ins(ta,pair[0]);var p=ta.selectionStart-pair[1];ta.setSelectionRange(p,p)}
}
/* ---------- таймер ---------- */
function startTimer(){
  stopTimer();var e=exOf(S.v);if(!e||e.fin)return;
  var tick=function(){
    var left=Math.max(0,EXAM_MIN*60000-(Date.now()-e.start)),m=Math.floor(left/60000),s=Math.floor(left/1000)%60,el=$('ptimer');
    if(el){el.textContent=(m<10?'0':'')+m+':'+(s<10?'0':'')+s;el.className='ptimer'+(left<5*60000?' low':'')}
    if(left<=0){stopTimer();finishExam(true)}
  };
  tick();S.timer=setInterval(tick,1000);
}
function stopTimer(){if(S.timer){clearInterval(S.timer);S.timer=null}}
/* ---------- запуск и проверка ---------- */
function setBusy(b){S.busy=b;['run','check'].forEach(function(a){var el=document.querySelector('[data-a="'+a+'"]');if(el)el.disabled=b})}
function outBox(){return $('pout')}
function doRun(){
  if(S.busy)return;var t=curTask(),code=$('pcode').value;
  if(!code.trim()){outBox().innerHTML='<div class="pbox err"><h5>Код пустой</h5><p class="pout-tip">Напишите решение и запустите снова.</p></div>';return}
  setBusy(true);outBox().innerHTML='<div class="pbox"><h5>Запускаю…</h5></div>';
  runPy(t.pre,code,$('pin').value+'\n').then(function(r){
    setBusy(false);var b='';
    if(r.et){var er=errText(r);b+='<div class="pbox err"><h5>'+esc(er.head)+'</h5>'+(r.out?'<small>Вывод до ошибки:</small><pre class="pbk">'+esc(r.out)+'</pre>':'')+(er.tip?'<p class="pout-tip">'+inl(er.tip)+'</p>':'')+'</div>'}
    else b+='<div class="pbox"><h5>Вывод программы</h5><pre class="pbk">'+(r.out?esc(r.out):'(ничего не напечатано)')+'</pre></div>';
    outBox().innerHTML=b;
  });
}
function doCheck(){
  if(S.busy)return;var t=curTask(),code=$('pcode').value,ex=S.mode==='exam';
  if(!code.trim()){outBox().innerHTML='<div class="pbox err"><h5>Код пустой</h5><p class="pout-tip">Напишите решение и нажмите «Проверить».</p></div>';return}
  setBusy(true);var res=[],i=0;
  var next=function(){
    if(i>=t.tests.length)return Promise.resolve();
    var tt=t.tests[i];outBox().innerHTML='<div class="pbox"><h5>Проверяю… '+(i+1)+' из '+t.tests.length+'</h5></div>';
    return runPy(t.pre,code,tt.i+'\n').then(function(r){
      var got=normOut(r.out),ok=!r.et&&got===tt.o;res.push({ok:ok,r:r,got:got,t:tt,k:i});i++;
      if(r.timeout||r.et==='LoadError'){return Promise.resolve()}
      return next();
    });
  };
  next().then(function(){
    setBusy(false);
    var load=res.length&&res[res.length-1].r.et==='LoadError';
    if(load){outBox().innerHTML='<div class="pbox err"><h5>Python не загрузился</h5><p class="pout-tip">'+inl(errText(res[res.length-1].r).tip)+'</p></div>';return}
    var passed=res.filter(function(x){return x.ok}).length,all=passed===t.tests.length;
    /* учёт */
    if(ex){var e=exOf(S.v),r=e.r[t.id]||(e.r[t.id]={ok:0,fail:0});if(!r.ok){if(all)r.ok=1;else r.fail=(r.fail||0)+1}save();if($('pscore'))$('pscore').textContent=fmt(examScore(S.v))}
    else{var q=trRes(t.id);q.att=(q.att||0)+1;if(all)q.ok=1;save()}
    refreshTabs();if(!ex&&$('psolb'))$('psolb').disabled=false;
    outBox().innerHTML=renderCheck(t,res,passed,all,ex);
    if(all&&!ex)$('pst').textContent='';
  });
}
function renderCheck(t,res,passed,all,ex){
  var chips=t.tests.map(function(x,k){var r=res[k];return '<span class="pt '+(r?(r.ok?'ok':'bad'):'')+'">'+(k<2?'пример '+(k+1):'тест '+(k+1))+(r?(r.ok?' ✓':' ✗'):' —')+'</span>'}).join('');
  var h='<div class="pbox '+(all?'ok':'bad')+'"><h5>'+(all?'Все тесты пройдены ✓':'Пройдено '+passed+' из '+t.tests.length)+'</h5><div class="ptests">'+chips+'</div>';
  if(all){
    var r0=ex?exOf(S.v).r[t.id]:null;
    h+='<p class="pout-tip">'+(ex?'Задача засчитана: '+fmt(taskPts(t,r0))+' из '+fmt(t.pts)+' б.'+(r0&&r0.fail?' (штраф за '+r0.fail+' неверн. проверк.)':''):'Сравните своё решение с разбором: идея важнее текста, у задачи часто несколько верных решений.')+'</p>';
    h+='<div class="pact" style="margin-top:8px">'+(S.i<variant(S.v).tasks.length-1?'<button type="button" class="pbtn pri sm" data-a="next">Следующая задача →</button>':'')+(ex?'':'<button type="button" class="pbtn sm" data-a="sol">Показать разбор</button>')+'</div>';
  }else{
    var f=res.filter(function(x){return !x.ok})[0];
    if(f.r.et){var er=errText(f.r);h+='<p class="pout-tip"><b>'+esc(er.head)+'</b>'+(er.tip?'<br>'+inl(er.tip):'')+'</p>'}
    var show=!ex||f.k<2;
    if(show){
      h+='<small class="pst">Первый непройденный тест ('+(f.k<2?'пример '+(f.k+1):'скрытый тест '+(f.k+1))+'). Ввод:</small><pre class="pbk">'+esc(f.t.i)+'</pre>';
      if(!f.r.et){h+='<div class="pdiff"><div><small>Ожидалось</small><pre class="pbk">'+(f.t.o?esc(f.t.o):'(пусто)')+'</pre></div><div><small>У вас</small><pre class="pbk">'+(f.got?diffBox(f.got,f.t.o):'(пусто)')+'</pre></div></div>';
        if(!ex){var tips=why(f.got,f.t.o,f.t,$('pcode').value);h+='<div class="pout-tip"><b>Возможные причины:</b><ul>'+tips.map(function(x){return '<li>'+inl(x)+'</li>'}).join('')+'</ul></div>'}}
    }else{h+='<p class="pout-tip">Скрытый тест не пройден (в контрольной его данные не показываются). Проверьте пустой результат, равенство границе, один элемент.</p>'}
    if(ex)h+='<p class="pout-tip">Неверная проверка: −10% от баллов этой задачи.</p>';
  }
  return h+'</div>';
}
function refreshTabs(){
  var v=variant(S.v);
  var el=$('ptabs');if(!el)return;
  Array.prototype.forEach.call(el.children,function(b,k){b.className='ptab '+statusOf(v.tasks[k])+(k===S.i?' cur':'')});
}
/* ---------- подсказка и разбор ---------- */
function doHint(){
  var t=curTask();outBox().innerHTML='<div class="pbox"><h5>💡 Подсказка</h5><p class="pout-tip">'+inl(t.hint)+'</p></div>';
}
function solView(t,bare){
  var h='<div class="psol"><h3>Разбор. Задача '+t.n+': '+esc(t.title)+'</h3>'+
    '<h4>Идея</h4><p>'+inl(t.idea)+'</p>'+
    '<h4>Решение</h4><pre class="pbk">'+hl(t.sol)+'</pre>'+
    '<h4>Разбор по шагам</h4><ol>'+t.steps.map(function(x){return '<li>'+inl(x)+'</li>'}).join('')+'</ol>'+
    (t.trace?'<h4>Пример по шагам</h4><p class="ptrace">'+inl(t.trace)+'</p>':'')+
    '<h4>Частые ошибки</h4><ul>'+t.mist.map(function(x){return '<li>'+inl(x)+'</li>'}).join('')+'</ul>'+
    (bare?'':'<div class="prow"><button type="button" class="pbtn sm" data-a="paste">Вставить решение в редактор</button><button type="button" class="pbtn sm" data-a="solclose">Скрыть разбор</button></div>')+'</div>';
  return h;
}
function solOpen(t){var q=P.tr[t.id];return !!(q&&q.att)}
function doSol(){
  var t=curTask();if(S.mode!=='exam'&&!solOpen(t)){var el0=$('pst');if(el0)el0.textContent='Сначала проверь своё решение: нажми «Проверить».';return}$('psol').innerHTML=solView(t);S.sol=true;
  var el=$('psol');if(el.scrollIntoView)el.scrollIntoView({behavior:'smooth',block:'start'});
}
/* ---------- завершение контрольной ---------- */
function finishExam(auto){
  var e=exOf(S.v);if(!e||e.fin)return;
  if(!auto&&!confirm('Завершить контрольную? Нерешённые задачи получат 0 баллов.'))return;
  e.fin=Date.now();save();stopTimer();renderEnd(S.v,auto);
}
function renderEnd(vid,auto){
  S.v=vid;var v=variant(vid),e=exOf(vid),sc=examScore(vid);
  var rows=v.tasks.map(function(t){var r=e.r[t.id]||{},p=taskPts(t,r);return '<tr><td>'+t.n+'</td><td>'+esc(t.title)+'</td><td>'+(r.ok?'решена':'не решена')+'</td><td>'+(r.fail||0)+'</td><td>'+fmt(p)+' из '+fmt(t.pts)+'</td><td><button type="button" class="pbtn sm" data-an="'+(t.n-1)+'">Разбор</button></td></tr>'}).join('');
  var spent=Math.min(EXAM_MIN*60000,e.fin-e.start),m=Math.floor(spent/60000);
  var h='<div class="pbar"><button type="button" class="pbtn sm" data-a="menu">← Варианты</button><span class="ptt">'+esc(v.name)+' · итог</span></div>'+
    (auto?'<p class="pnote">Время вышло: контрольная завершена автоматически.</p>':'')+
    '<div class="pbig">'+fmt(sc)+' <small>из 10 баллов · потрачено '+m+' мин</small></div>'+
    '<div class="ptblw"><table class="ptbl"><thead><tr><th>№</th><th>Задача</th><th>Итог</th><th>Неверных проверок</th><th>Баллы</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="pact"><button type="button" class="pbtn pri" data-start="'+vid+'">Пройти заново</button><button type="button" class="pbtn" data-a="train">Открыть в режиме тренировки</button></div><div id="psol-end"></div>';
  $('pd').classList.add('inwork');var el=$('pv-end');el.innerHTML=h;el.hidden=false;$('pv-menu').hidden=true;$('pv-work').hidden=true;toTop();
}
/* ---------- события ---------- */
document.addEventListener('click',function(ev){
  var b=ev.target.closest&&ev.target.closest('button'),pd=$('pd');if(!b||!pd||!pd.contains(b))return;
  if(b.dataset.m){S.mode=b.dataset.m;renderMenu();return}
  if(b.dataset.start){var v=b.dataset.start;if(S.mode==='exam'){var e=exOf(v);if(e&&e.fin&&!confirm('Начать заново? Прежний результат и код этого варианта будут стёрты.'))return}startVariant(v);return}
  if(b.dataset.res){renderEnd(b.dataset.res);return}
  if(b.dataset.i!==undefined){S.i=+b.dataset.i;S.sol=false;renderWork();return}
  if(b.dataset.k){keyBtn(b.dataset.k);return}
  if(b.dataset.an!==undefined){var t=variant(S.v).tasks[+b.dataset.an];$('psol-end').innerHTML=solView(t,true);$('psol-end').scrollIntoView({behavior:'smooth'});return}
  var a=b.dataset.a;if(!a)return;
  if(a==='menu'){if(S.mode==='exam'&&exOf(S.v)&&!exOf(S.v).fin)stopTimer();renderMenu()}
  else if(a==='tk')openTask();
  else if(a==='tkx')closeTask();
  else if(a==='run')doRun();
  else if(a==='check')doCheck();
  else if(a==='hint')doHint();
  else if(a==='sol')doSol();
  else if(a==='solclose'){$('psol').innerHTML='';S.sol=false}
  else if(a==='paste'){var t2=curTask();$('pcode').value=t2.sol+'\n';P.code[t2.id]=$('pcode').value;save();window.scrollTo({top:$('pcode').getBoundingClientRect().top+scrollY-80,behavior:'smooth'})}
  else if(a==='reset'){if(!confirm('Стереть код этой задачи?'))return;var t3=curTask();$('pcode').value='';delete P.code[t3.id];save();$('pout').innerHTML=''}
  else if(a==='next'){if(S.i<variant(S.v).tasks.length-1){S.i++;S.sol=false;renderWork()}}
  else if(a==='finish')finishExam(false);
  else if(a==='train'){S.mode='train';startVariant(S.v)}
});
/* запрет закрытия с запущенным таймером не нужен: состояние хранится, время идёт по часам */
window.PYT={mount:function(){stopTimer();S.sol=false;if($('pd'))renderMenu()}};
if($('pd'))window.PYT.mount();
})();
