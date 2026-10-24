'use strict';
window.StockValuation=(()=>{
 const finite=Number.isFinite,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let include=true,registry=null,pending=null,version=0,initialized=false;const requests=new Map(),cache=new WeakMap();
 try{include=localStorage.getItem('stockai-include-treasury')!=='false'}catch{}
 function included(){return include}
 // Legacy include flag means shares remain in gross capitalization, not checkbox state.
 function adjusted(){return !include}
 function setAdjusted(v){setIncluded(!v)}
 function setIncluded(v){include=!!v;version++;try{localStorage.setItem('stockai-include-treasury',String(include))}catch{}sync();window.dispatchEvent?.(new Event('stockai-valuation-policy'));}
 function sync(){if(typeof document==='undefined')return;for(const n of document.querySelectorAll?.('[data-stock-treasury]')||[])n.checked=adjusted();}
 async function ready(){if(registry)return registry;if(!pending)pending=fetch('/valuation-daily/treasury.json').then(r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{if(!Array.isArray(d.observations))throw Error();registry=d;version++;return d}).catch(()=>{pending=null;return {observations:[],unavailable:true}});return pending;}
 async function ensure(data){await ready();const url=data.valuation_daily_url;if(!url)return;if(!/^\/valuation-daily\/[a-z0-9-]+\.json$/.test(url))throw Error('Некорректный адрес дневной истории');if(!requests.has(url))requests.set(url,fetch(url).then(r=>{if(!r.ok)throw Error('Не удалось загрузить дневную историю');return r.json()}).then(d=>{if(d.frequency!=='daily'||!Array.isArray(d.rows)||!Array.isArray(d.contexts))throw Error('Некорректная дневная история');return d}).catch(e=>{requests.delete(url);throw e}));const daily=await requests.get(url);if(data.daily_valuation!==daily){data.daily_valuation=daily;version++;}}
 function observation(ticker,dt,issued,entity){const found=(registry?.observations||[]).filter(o=>o.ticker===ticker&&(!entity||o.entity===entity)&&o.as_of<=dt&&o.published<dt&&Date.parse(dt)-Date.parse(o.as_of)<=550*86400000&&finite(o.count)&&o.count>=0&&finite(issued)&&issued>0&&o.issued_shares===issued&&o.count<=issued);return found.sort((a,b)=>a.as_of.localeCompare(b.as_of)||a.published.localeCompare(b.published)).at(-1)||null;}
 function adjust(point,mode=include){const p={...point,treasury_mode:mode?'included':'excluded'};if(mode)return p;
  const cc=point.equity_components?.length?point.equity_components:[{ticker:point.ticker,issued_shares:point.issued_shares,price:point.price}];
  const facts=cc.map(c=>observation(c.ticker,point.date,c.issued_shares,point.entity));
  if(!finite(point.capitalization)||point.capitalization<=0||facts.some(o=>!o)||!facts.length){return {...p,capitalization:null,pe:null,pe_reported_ifrs16:null,ev_ebitda:null,treasury_status:'unknown',treasury_note:'Нет подтверждённого размера пакета для этой даты и этого выпуска. Пропуск не равен нулю.'};}
  const cap=cc.length===1?point.capitalization*(1-facts[0].count/cc[0].issued_shares):point.capitalization-cc.reduce((a,c,i)=>a+c.price*facts[i].count/1e6,0);
  if(!finite(cap)||cap<0)return {...p,capitalization:null,pe:null,pe_reported_ifrs16:null,ev_ebitda:null,treasury_status:'unknown'};
  const v=point.ltm_values||{},np=v.np,eb=v.ebitda,native=v.np_reported_ifrs16;
  return {...p,capitalization:cap,pe:finite(np)&&np>0?cap/np:null,pe_reported_ifrs16:finite(native)&&native>0?cap/native:null,ev_ebitda:finite(eb)&&eb>0&&finite(point.net_debt)?(cap+point.net_debt)/eb:null,treasury_status:'excluded',treasury_facts:facts,treasury_note:'Вычтен последний подтверждённый в базе пакет, доступный до даты котировки. Долг и прибыль не меняются.'};
 }
 function records(data){const cached=cache.get(data);if(cached?.version===version)return cached.rows;
  const daily=data.daily_valuation,raw=daily?daily.rows.map(r=>({...daily.contexts[r.context],...r,month:r.date.slice(0,7),year:Number(r.date.slice(0,4)),mode:daily.mode,source_entity:daily.contexts[r.context]?.entity})):(data.valuation_mode==='ltm_release_gated_revised'?data.valuation||[]:(data.valuation||[]).filter(v=>v.month?.endsWith('-12')));
  const rows=raw.map(p=>adjust(p));cache.set(data,{version,rows});return rows;
 }
 function note(s){if(s.view!=='valuation')return '';const rows=records(s.data),daily=s.data.daily_valuation,last=rows.at(-1),label=daily?'По торговым дням':'Сохранённая история';
  const basis=(daily?.mode||s.data.valuation_mode)==='ltm_release_gated_revised'?'LTM':'Ретроспектива, не LTM';
  let text=label+' · '+basis+'. '+(include?'Казначейские акции включены в капитализацию.':'Без казначейских и квазиказначейских акций.');
  if(!include){if(last?.treasury_status==='unknown')text+=' На последнюю дату размер пакета не подтверждён — скорректированные значения недоступны.';else if(last?.treasury_facts?.length)text+=' Пакет на '+last.treasury_facts.map(o=>o.as_of).join(' / ')+'.';if(last?.treasury_facts?.some(o=>o.precision_units>1))text+=' Пакет округлён в источнике.';text+=' Неизвестный пакет — пропуск, не ноль.';}
  const status=basis+' · '+(include?'полная капитализация':'капитализация за вычетом казначейского пакета');
  const unavailable=!include&&last?.treasury_status==='unknown';
  return '<div class="sr-valuation-policy"><span role="status">'+esc(status)+(unavailable?' — нет данных о пакете на последнюю дату':'')+'</span><details><summary>Как рассчитано</summary><p>'+esc(text)+'</p></details></div>';
 }
 async function mapData(data){if(include)return data;await ready();const items=[],unknown=[];
  for(const r of data.items||[]){const dt=r.price_date||data.as_of,latest=registry?.observations?.filter(o=>o.ticker===r.ticker&&o.published<dt&&o.as_of<=dt).sort((a,b)=>a.as_of.localeCompare(b.as_of)).at(-1),size=registry?.latest_issue_sizes?.[r.ticker],issued=r.issued_shares??(size?.date<=dt&&Date.parse(dt)-Date.parse(size.date)<=7*86400000?size.issued_shares:null);
   const o=observation(r.ticker,dt,issued,latest?.entity);if(!o){unknown.push(r.ticker);continue;}
   const cap=r.cap*(1-o.count/issued);items.push({...r,cap,cap_source:r.cap_source+' × (1 − пакет / выпущенные акции)',treasury_asof:o.as_of});}
  return {...data,items,treasury_unknown:unknown,treasury_excluded:true};
 }
 function init(){if(initialized)return;initialized=true;sync();document.addEventListener('change',e=>{if(e.target.matches?.('[data-stock-treasury]'))setAdjusted(e.target.checked)});ready();}
 return {included,setIncluded,adjusted,setAdjusted,ready,ensure,records,adjust,observation,note,mapData,init};
})();
