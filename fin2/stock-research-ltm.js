'use strict';
// A separate trailing column: never rewrite annual observations or blend perimeters.
window.StockResearchLTM=(()=>{
 const finite=Number.isFinite,api=()=>window.StockResearch;
 const qnum=p=>({FY:4,H1:2,'9M':3,Q1:1,Q2:2,Q3:3,Q4:4})[p];
 const end=(y,q)=>y+'-'+({1:'03-31',2:'06-30',3:'09-30',4:'12-31'})[q];
 function trailing(rows,y,q,key){const get=(y,p)=>rows.find(r=>r.year===y&&r.period===p)?.values?.[key];
  if(q===4&&finite(get(y,'FY')))return get(y,'FY');
  const p=({1:'Q1',2:'H1',3:'9M'})[q],parts=[get(y-1,'FY'),get(y,p),get(y-1,p)];
  if(p&&parts.every(finite))return parts[0]+parts[1]-parts[2];
  const quarters=Array.from({length:4},(_,i)=>{const n=y*4+q-3+i;return get(Math.floor((n-1)/4),'Q'+((n-1)%4+1));});
  return quarters.every(finite)?quarters.reduce((a,b)=>a+b,0):null;
 }
 function row(s){if(s.period!=='FY'||!['finance','cash'].includes(s.view)||s.segment!=='Группа')return null;
  const rr=api().records(s).filter(r=>r.segment==='Группа'),annual=api().select(rr,'FY','Группа').filter(r=>finite(api().value(r,'revenue',s.meta.basis))||finite(api().value(r,'ebitda',s.meta.basis))),last=annual.at(-1);if(!last)return null;
  const entity=last.entity,basis=last.display_basis||s.meta.basis,records=rr.filter(r=>r.entity===entity&&(r.display_basis||s.meta.basis)===basis),cutoff=s.data.asof||s.manifest?.asof||'0000-00-00';
  const events=(s.data.release_calendar||[]).filter(e=>e.entity===entity&&e.published<=cutoff&&e.period_end<=cutoff&&qnum(e.period));
  const event=events.sort((a,b)=>a.period_end.localeCompare(b.period_end)).at(-1),y=event?.year||last.year,q=event?qnum(event.period):4,dt=event?.period_end||end(y,q);if(dt>cutoff)return null;
  const values={},sources={},flow=['revenue','gross','ebitda','ebitda_adj','ebit','np','np_parent','np_reported_ifrs16','cfo','cfo_after_lease','cfo_native','cash_capex','capex_reported','fcf_cash','fcf_reported','finance_expense'];
  for(const m of flow){const key=api().metricKey(m,basis),v=trailing(records,y,q,key);values[key]=v;sources[key]={formula:'FY прошлого года + текущий накопленный период − сопоставимый прошлогодний период; иначе четыре наблюдаемых квартала',source_entity:entity,basis,period_end:dt};}
  const get=m=>values[api().metricKey(m,basis)],put=(m,v)=>{values[api().metricKey(m,basis)]=v};
  for(const[m,n]of [['ebitda_margin','ebitda'],['np_margin','np'],['gross_margin','gross'],['ebit_margin','ebit']])put(m,finite(get(n))&&get('revenue')>0?get(n)/get('revenue'):null);
  const prior=trailing(records,y-1,q,api().metricKey('revenue',basis));put('revenue_growth',finite(get('revenue'))&&prior>0?get('revenue')/prior-1:null);
  // Stocks are taken at the same report date, never added over four quarters.
  const balance=records.find(r=>r.year===y&&r.period===({1:'Q1',2:'H1',3:'9M',4:'FY'})[q]);
  for(const m of ['debt','cash','net_debt','issuer_nd','lease_debt'])put(m,api().value(balance,m,basis));
  const nd=get('net_debt')??get('issuer_nd');put('nd_ebitda',finite(nd)&&get('ebitda')>0?nd/get('ebitda'):null);
  put('icr',finite(get('finance_expense'))&&Math.abs(get('finance_expense'))>0&&finite(get('ebit'))?get('ebit')/Math.abs(get('finance_expense')):null);
  return {entity,year:y,period:'LTM',segment:'Группа',display_basis:basis,period_end:dt,published:event?.published||null,label:'LTM\n'+dt.split('-').reverse().join('.'),values,sources,is_ltm:true};
 }
 return {row,trailing};
})();
