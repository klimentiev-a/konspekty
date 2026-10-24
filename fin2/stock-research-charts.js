'use strict';
window.StockResearchCharts=(()=>{
 const color={blue:'#5b93de',green:'#2fa89b',gold:'#c68b2e',red:'#bc5c50',gray:'#8aa2bd',violet:'#8b81ba'};
 const definitions={
  finance:[['income','Выручка, EBITDA и маржа',[['revenue','bar','blue'],['ebitda','bar','green'],['ebitda_margin','line','gold',1]]],['profit','Чистая прибыль',[['np','bar','green'],['np_margin','line','gold',1],['np_reported_ifrs16','line','gray']]],['growth','Рост выручки и маржа',[['revenue_growth','line','blue'],['gross_margin','line','gray'],['ebitda_margin','line','green'],['np_margin','line','gold']]]],
  ops:[['network','Количество магазинов',[['stores','bar','blue']]],['lfl','LFL: продажи, трафик и чек',[['lfl_sales','line','blue'],['lfl_traffic','line','green'],['lfl_ticket','line','gold']]],['area','Торговая площадь',[['selling_space','bar','green']]],['ticket','Средний чек и покупки',[['average_ticket','line','gold'],['transactions','bar','blue',1]]],['retail','Розничная выручка',[['retail_revenue','bar','blue']]]],
  cash:[['flow','Из прибыли в денежный поток',[['cfo_after_lease','bar','blue'],['cash_capex','bar','gray'],['fcf_cash','bar','green']]],['debt','Долг, деньги и нагрузка',[['debt','bar','gray'],['cash','bar','green'],['net_debt','bar','blue'],['nd_ebitda','line','gold',1]]],['rent','Аренда и FCF компании',[['lease_debt','bar','gray'],['fcf_reported','bar','green']]]],
 };
 const api=()=>window.StockResearch;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const finite=Number.isFinite;
 function defs(s){const has=m=>api().records(s).some(r=>finite(api().value(r,m,s.meta.basis)));
  if(s.view==='valuation')return [['ev','EV / EBITDA',[['ev_ebitda','line','blue']]],['pe','P/E — цена к прибыли',[['pe','line','green'],['pe_reported_ifrs16','line','gray']]],['cap','Капитализация',[['capitalization',s.data.daily_valuation?'line':'bar','blue']]]];
  if(s.view==='cash')return [['flow','Денежный поток',[[s.sector==='steel'?'cfo':'cfo_after_lease','bar','blue'],['cash_capex','bar','gray'],['fcf_cash','bar','green']]],['debt','Долг и нагрузка',[['debt','bar','gray'],[has('net_debt')?'net_debt':'issuer_nd','bar','blue'],['nd_ebitda','line','gold',1]]],['coverage','Покрытие процентов',[['icr','line','green']]],['liquidity','Деньги и аренда',[['cash','bar','green'],['lease_debt','bar','gray']]],['reported','FCF и CAPEX компании',[['fcf_reported','bar','green'],['capex_reported','bar','gold']]]];
  if(s.sector==='steel'&&s.view==='finance')return [['income','Выручка и EBITDA',[['revenue','bar','blue'],['ebitda','bar','green'],['ebitda_adj','bar','gray'],['ebitda_margin','line','gold',1]]],['profit','Чистая прибыль',[['np','bar','green'],['np_parent','line','blue'],['np_margin','line','gold',1]]],definitions.finance[2]];
  if(s.sector==='steel'&&s.view==='ops')return [['production','Производство и продажи стали',[['steel_production','bar','blue'],['steel_sales','bar','green'],['steel_production_ex_nbh','bar','gray']]],['products','Продажи по продуктам',[['finished_steel_sales','bar','blue'],['semis_sales','bar','gray'],['long_steel_sales','bar','gold'],['flat_steel_sales','bar','green'],['hot_rolled_sales','bar','violet']]],['hva','Продукция HVA',[['hva_sales','bar','green'],['hva_share','line','gold',1]]],['materials','Сырьё и добыча',[['ore_sales','bar','blue'],['pellet_sales','bar','green'],['coal_production','bar','gray'],['coking_concentrate_sales','bar','gold']]],['iron','Чугун и кокс',[['pig_iron_production','bar','blue'],['coke_sales','bar','gray']]],['cost','Себестоимость сляба',[['slab_cash_cost','line','gold'],['slab_cash_cost_integrated','line','green']]]];
  return definitions[s.view]||[];
 }
 function read(r,m,s){return s.view==='valuation'?r.values[m]:api().value(r,m,s.meta.basis)}
 function rows(s){const rr=s.view==='valuation'?api().points(s).map(p=>({year:p.record.year,label:p.label,values:p.record,sources:{},entity:s.data.entity})):[...api().select(api().records(s),s.period,s.segment),...(window.StockResearchLTM?.row(s)?[window.StockResearchLTM.row(s)]:[])],mm=defs(s).flatMap(p=>p[2].map(x=>x[0])),live=rr.map(r=>mm.some(m=>finite(read(r,m,s)))),first=live.indexOf(true),last=live.lastIndexOf(true);return s.view==='valuation'?rr:first<0?[]:rr.slice(first,last+1)}
 function panels(s){return defs(s).filter(p=>p[2].some(([m])=>rows(s).some(r=>finite(read(r,m,s)))))}
 function display(v,m){if(!finite(v))return null;const kind=api().metrics[m]?.[1];return kind==='money'?v/1000:kind==='percent'?v*100:v}
 function unit(m,s){return api().unit(m,s)}
 function options(s,key){const p=panels(s).find(p=>p[0]===key);if(!p)return null;
  const rr=rows(s),phone=(s.root?.clientWidth||900)<600,series=[];
  for(const [m,type,c,axis=0] of p[2]){
   if(!rr.some(r=>finite(read(r,m,s))))continue;
   // Lines do not silently cross a reporting perimeter or accounting-basis boundary.
   let epoch=0;const rowGroups=rr.map(r=>{if(r.series_break)epoch++;const src=r.sources?.[api().metricKey(m,r.display_basis||s.meta.basis)]||{};return (src.source_entity||r.entity)+'|'+(src.basis||r.display_basis||s.meta.basis)+'|'+epoch});
   const groups=type==='line'?[...new Set(rowGroups.filter((g,i)=>finite(read(rr[i],m,s))))]:['all'];
   for(const group of groups){series.push({name:api().metrics[m][0],metric:m,type,yAxisIndex:axis,connectNulls:false,cursor:'default',symbol:'circle',symbolSize:phone?4:5,showSymbol:rr.length<24,barMaxWidth:24,itemStyle:{color:color[c],...(type==='bar'?{borderRadius:[3,3,0,0]}:{})},lineStyle:{width:2,type:axis?'dashed':'solid',color:color[c]},emphasis:{focus:'series'},data:rr.map((r,i)=>{
    const g=rowGroups[i];
    return group==='all'||group===g?display(read(r,m,s),m):null;
   })})}
   if(type==='line'&&s.data.id==='x5'&&s.scope!=='issuer')for(let i=1;i<rr.length;i++){
    const a=rr[i-1],b=rr[i],basis=r=>String((r.sources?.[api().metricKey(m,r.display_basis||s.meta.basis)]||{}).basis||r.display_basis||s.meta.basis).replace(/\s/g,'');
    const entity=r=>(r.sources?.[api().metricKey(m,r.display_basis||s.meta.basis)]||{}).source_entity||r.entity;
    if(!a.series_break&&!b.series_break&&finite(read(a,m,s))&&finite(read(b,m,s))&&basis(a)===basis(b)&&entity(a)!==entity(b)&&[entity(a),entity(b)].every(e=>/^X5 (NV|RU)$/.test(e)))series.push({name:api().metrics[m][0],metric:m,type:'line',yAxisIndex:axis,connectNulls:false,symbol:'none',lineStyle:{width:2,type:'dotted',color:color[c]},itemStyle:{color:color[c]},data:rr.map((r,j)=>j===i-1||j===i?display(read(r,m,s),m):null)});
   }
  }
  if(rr.at(-1)?.is_ltm&&series[0])series[0].markLine={silent:true,symbol:['none','none'],label:{show:false},lineStyle:{color:'#8c651f',width:1,type:'dotted',opacity:.5},data:[{xAxis:rr.length-1}]};const primary=series.find(x=>x.yAxisIndex===0)?.metric,secondary=series.find(x=>x.yAxisIndex===1)?.metric;
  const axis=m=>({type:'value',name:unit(m,s),nameTextStyle:{fontSize:10,color:'#747979'},axisLabel:{fontSize:10,color:'#747979',formatter:v=>Number(v).toLocaleString('ru-RU',{maximumFractionDigits:1})},splitLine:{lineStyle:{color:'#ddddd5',opacity:.6}},scale:false});
  return {animation:false,textStyle:{fontFamily:'IBM Plex Sans, Arial, sans-serif'},color:Object.values(color),legend:{type:new Set(series.map(x=>x.name)).size>4?'scroll':'plain',top:0,left:0,right:0,textStyle:{color:'#747979',fontSize:phone?10:11},itemWidth:11,itemHeight:7,data:[...new Set(series.map(x=>x.name))]},grid:{left:phone?58:68,right:secondary?56:rr.at(-1)?.is_ltm?40:25,top:65,bottom:phone?65:55},tooltip:{trigger:'axis',confine:true,formatter:ps=>{
   const values=ps.filter(x=>finite(x.value)),seen=new Set();return '<b>'+esc(ps[0]?.axisValue||'')+'</b><br>'+values.filter(x=>{if(seen.has(x.seriesName))return false;seen.add(x.seriesName);return true}).map(x=>`${x.marker}${esc(x.seriesName)}: <b>${Number(x.value).toLocaleString('ru-RU',{maximumFractionDigits:2})} ${unit(series[x.seriesIndex].metric,s)}</b>`).join('<br>');}},
   xAxis:{type:'category',data:rr.map(r=>r.label||r.year+(r.period==='FY'?'':' '+r.period)),axisTick:{show:false},axisLine:{lineStyle:{color:'#bfbfb5'}},axisLabel:{fontSize:10,color:'#747979',hideOverlap:true,showMaxLabel:true,rich:{ltm:{color:'#8c651f',fontWeight:600}},formatter:v=>s.view==='valuation'&&s.data.daily_valuation?String(v).slice(0,7).split('-').reverse().join('.'):String(v).startsWith('LTM')?'{ltm|LTM}\n'+String(v).split('\n')[1]:v}},yAxis:secondary?[axis(primary),{...axis(secondary),splitLine:{show:false}}]:axis(primary),series,
   ...(rr.length>18?{dataZoom:[{type:'inside',...(s.view==='valuation'&&s.data.daily_valuation?{startValue:Math.max(0,rr.length-(!s.valuationRange||s.valuationRange==='all'?rr.length:({"1y":252,"3y":756,"5y":1260,"10y":2520}[s.valuationRange]||rr.length))),endValue:rr.length-1}:{}),filterMode:'none',zoomOnMouseWheel:'ctrl',moveOnMouseWheel:false,preventDefaultMouseMove:false},{type:'slider',...(s.view==='valuation'&&s.data.daily_valuation?{startValue:Math.max(0,rr.length-(!s.valuationRange||s.valuationRange==='all'?rr.length:({"1y":252,"3y":756,"5y":1260,"10y":2520}[s.valuationRange]||rr.length)))}:{}),height:14,bottom:7,borderColor:'transparent',backgroundColor:'#f4f3ef',fillerColor:'#c5b48e33',showDetail:false}]}:{})};
 }
 function markup(s){
  const mix=window.StockResearchMix?.markup(s)||'',pp=panels(s).filter(p=>!window.StockResearchMix?.has(s,p[0])),rr=rows(s),years=[...new Set(rr.filter(r=>!r.is_ltm).map(r=>r.year))];
  if(!pp.length)return mix||'<p class="sr-history-note">Нет подтверждённых значений для выбранного расчёта. Проверьте период и настройку казначейского пакета.</p>';
  const history='История '+Math.min(...years)+'–'+Math.max(...years)+(rr.at(-1)?.is_ltm?' + LTM':'');
  const body=pp.map(([key,title,mm])=>{
   const m=mm.find(([m])=>rr.some(r=>finite(read(r,m,s))))?.[0],last=s.view==='valuation'||rr.at(-1)?.is_ltm?rr.at(-1):rr.filter(r=>finite(read(r,m,s))).at(-1);
   return '<section class="sr-dashboard-panel"><div class="sr-panel-head"><div><h3>'+esc(title)+'</h3><p>'+esc(unit(m,s))+(mm.some(x=>x[3]&&rr.some(r=>finite(read(r,x[0],s))))?' · '+esc(unit(mm.find(x=>x[3])[0],s))+' справа':'')+'</p></div><div class="sr-last"><strong>'+api().format(last?read(last,m,s):null,m)+'</strong><small>'+esc(last?.label||last?.year||'')+(last?.period==='FY'||last?.is_ltm?'':' '+esc(last?.period||''))+'</small></div></div><div class="sr-echart" data-r-chart="'+key+'" role="img" aria-label="'+esc(title)+'"><span>Загрузка графика…</span></div></section>';
  }).join('');
  return mix+'<div class="sr-history-head"><span>'+esc(history)+'</span><span>'+esc(s.view==='valuation'?'по торговым дням':s.period==='FY'?'годовые данные':s.period==='Q'?'отдельные кварталы':'накопленные периоды')+'</span></div><div class="sr-chart-grid">'+body+'</div>';
 }
 function dispose(s){for(const c of s.researchCharts||[])c.dispose();s.researchCharts=[]}
 function draw(s){if(!window.echarts)return;dispose(s);for(const n of s.root.querySelectorAll('[data-r-chart]')){const opt=options(s,n.dataset.rChart);if(!opt)continue;n.innerHTML='';const c=window.echarts.init(n,'bondsai-paper',{renderer:'svg'});c.setOption(opt);s.researchCharts.push(c)}window.StockResearchIncome?.draw(s);window.StockResearchMix?.draw(s)}
 return {options,panels,markup,draw,dispose,rows};
})();
