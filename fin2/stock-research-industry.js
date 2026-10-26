'use strict';
window.StockResearchIndustry = (() => {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite = Number.isFinite;
  const fmt = (v, n = 1) => finite(v) ? v.toLocaleString('ru-RU', {maximumFractionDigits:n, minimumFractionDigits:n}) : '—';
  const colors = ['#578ed0','#2a9f91','#c78b30','#899eaf','#8b79b9','#c26f66'];
  const palette = {total:colors[0],food:colors[1],nonfood:colors[2]};
  const period = d => /^\d{4}-Q[1-4]$/.test(d) ? d.slice(5)+' '+d.slice(0,4) : /^\d{4}-\d{2}$/.test(d) ? d.slice(5)+'.'+d.slice(0,4) : d;
  const requests=new Map();
  async function ensure(s) {
    const sector=s.sector==='steel'?'steel':'retail',url=sector==='steel'?'/steel-data/steel-industry.json?v=1':'/research-data/retail-industry.json?v=1';
    if (!requests.has(sector)) requests.set(sector,fetch(url).then(r => {
      if (!r.ok) throw Error('Не удалось загрузить отраслевые показатели');
      return r.json();
    }).catch(e => {requests.delete(sector); throw e;}));
    const data=await requests.get(sector);
    if((s.sector==='steel'?'steel':'retail')===sector)s.industry=data;
  }
  const selectedCompany = s => s.industry.companies.find(c => c.id === s.industryCompany) || s.industry.companies[0];
  const fromSeries = (s, id, color, type='line', stack) => {
    const a=s.industry.series[id];
    const short={cpi_total:'Общая',cpi_food:'Продукты',cpi_nonfood:'Непрод',annual_cpi_food:'ИПЦ продуктов · среднее',annual_cpi_total:'Общий ИПЦ · среднее'};
    return a && {id, name:short[id]||a.label.replace('Непродовольственные товары','Непрод'), rows:a.rows, unit:a.unit, source:a.source, color, type, stack, status:a.status, breaks:a.series_breaks};
  };
  const companySeries = (s, company, metric, name, color) => ({id:company.id+'_'+metric,name:name||company.name,color,
    rows:company.rows.filter(r=>finite(r.values[metric])).map(r=>({date:String(r.year),value:r.values[metric],series_break:r.series_break})),unit:'%',source:'companies',type:'line'});
  function panels(s) {
    if(s.sector==='steel')return window.StockResearchSteelIndustry.panels(s);
    const a=(id,c,type,stack)=>fromSeries(s,id,c,type,stack), company=selectedCompany(s);
    const allMarket = prefix => ['total','food','nonfood'].map(k=>a(prefix+k,palette[k]));
    const pp = [
      {key:'turnover',title:'Сколько тратят на покупки',unit:'трлн ₽ в месяц',source:'trade',wide:true,
        series:['food','nonfood'].map(k=>({...a('turnover_'+k,palette[k],'bar','turnover'),scale:.001}))},
      {key:'growth',title:'Как растут продажи',unit:'% г/г',source:'trade',series:allMarket('nominal_')},
      {key:'inflation',title:'Как растут цены',unit:'% г/г',source:'prices',series:allMarket('cpi_')},
      {key:'physical',title:'Деньги и физический объём',unit:'% к предыдущему году',source:'trade',
        series:[{...a('annual_nominal_total',colors[0],'bar'),name:'Оборот · в текущих ценах'},a('physical_total',colors[1])]},
      {key:'deflated',title:'Продажи с поправкой на инфляцию',unit:'Оценка по ИПЦ · % г/г',source:'trade',series:allMarket('deflated_')},
      {key:'income',title:'Доходы покупателей',unit:'Реальный рост · % г/г',source:'income',
        series:[a('real_income',colors[0]),a('real_disposable',colors[1])]},
      {key:'wages',title:'Зарплаты и покупательная способность',unit:'% г/г',source:'wages',
        series:[a('wage_nominal',colors[0]),a('wage_real',colors[1])]},
      {key:'confidence',title:'Готовы ли люди покупать',unit:'Индекс потребительской уверенности · баланс, %',source:'confidence',series:[a('confidence',colors[0])]},
      {key:'expectations',title:'Какую инфляцию ощущают и ждут',unit:'% · опрос населения',source:'expectations',
        series:[a('observed_inflation',colors[2]),a('expected_inflation',colors[0])]},
      {key:'savings',title:'Сколько доходов сберегают',unit:'% · сезонно скорректировано',source:'savings',series:[a('saving_rate',colors[0])]},
      {key:'assets',title:'Депозиты и кредиты населения',unit:'трлн ₽ · остаток, не поток сбережений',source:'assets',
        series:[{...a('household_deposits',colors[1]),scale:.001},{...a('household_loans',colors[4]),scale:.001}]},
      {key:'structure',title:'Продукты и непрод: структура расходов',unit:'% оборота розницы',source:'trade',
        series:['food','nonfood'].map(k=>({...a('share_'+k,palette[k],'line','share'),area:true}))},
      {key:'online',title:'Объём интернет-торговли',unit:'трлн ₽ за год · АКИТ / Сбер2B',source:'akit',
        series:[{...a('online_domestic',colors[0],'bar','online'),scale:.001},{...a('online_crossborder',colors[4],'bar','online'),scale:.001}]},
      {key:'categories',title:'Что покупают онлайн',unit:'% внутреннего онлайн-рынка · 2025',source:'akit',horizontal:true,
        series:[{name:'Доля категории',color:colors[0],type:'bar',unit:'%',rows:s.industry.online_categories.rows.map(r=>({date:r.label,value:r.value}))}]},
      {key:'leaders',title:'Крупные сети и продуктовый рынок',unit:'% г/г · оценка INFOLine / X5',source:'infoline_x5',
        series:[a('infoline_market_growth',colors[3]),a('infoline_top10_growth',colors[1])]},
      {key:'companies',title:'Компании на фоне рынка',unit:'Рост годовой выручки · %',source:'companies',wide:true,
        series:[...s.industry.companies.map((c,i)=>companySeries(s,c,'comparison_growth',c.name,colors[i])),a('infoline_market_growth',colors[5])]},
      {key:'basket',title:'Чек, трафик и инфляция',unit:company.name+' · % за год',source:'companies',company:true,
        series:[companySeries(s,company,'lfl_ticket','LFL чек',colors[0]),companySeries(s,company,'lfl_traffic','LFL трафик',colors[1]),
          companySeries(s,company,'lfl_sales','LFL продажи',colors[4]),a('annual_cpi_'+company.benchmark,colors[2])]},
      {key:'expansion',title:'Расширение сети и рост продаж',unit:company.name+' · % за год',source:'companies',company:true,
        series:[companySeries(s,company,'comparison_growth','Рост выручки',colors[0]),companySeries(s,company,'stores_growth','Рост числа магазинов',colors[1]),companySeries(s,company,'area_growth','Рост торговой площади',colors[2])]},
      {key:'cost',title:'Цена роста бизнеса',unit:company.name+' · % выручки',source:'companies',company:true,
        series:[companySeries(s,company,'capex_share','CAPEX / выручка',colors[2]),companySeries(s,company,'ebitda_margin','Маржа EBITDA',colors[0]),companySeries(s,company,'fcf_share','FCF / выручка',colors[1])]}
    ];
    return pp.map(p=>({...p,series:p.series.filter(a=>a && a.rows.some(r=>finite(r.value)))})).filter(p=>p.series.length);
  }
  function timeline(p) {
    const dates=[...new Set(p.series.flatMap(s=>s.rows.map(r=>r.date)))].sort();
    if (p.horizontal) return p.series[0].rows.map(r=>r.date);
    if (dates.every(d=>/^\d{4}-\d{2}$/.test(d))) {
      const out=[];let [y,m]=dates[0].split('-').map(Number);const last=dates.at(-1);
      while (`${y}-${String(m).padStart(2,'0')}`<=last) {out.push(`${y}-${String(m).padStart(2,'0')}`);if (++m>12) {m=1;y++;}}
      return out;
    }
    if(dates.every(d=>/^\d{4}$/.test(d))) return Array.from({length:Number(dates.at(-1))-Number(dates[0])+1},(_,i)=>String(Number(dates[0])+i));
    if(dates.every(d=>/^\d{4}-Q[1-4]$/.test(d))){const out=[];let y=Number(dates[0].slice(0,4)),q=Number(dates[0].at(-1));while(`${y}-Q${q}`<=dates.at(-1)){out.push(`${y}-Q${q}`);if(++q>4){q=1;y++;}}return out;}
    return dates;
  }
  function options(s,key) {
    const p=panels(s).find(p=>p.key===key);if (!p) return null;
    const dates=timeline(p), small=(s.root?.clientWidth||1200)<600;
    const series=p.series.map(a=>{
      const map=new Map(a.rows.map(r=>[r.date,r]));
      return {name:a.name,type:a.type||'line',stack:a.stack,connectNulls:false,showSymbol:dates.length<24,symbolSize:4,
        barMaxWidth:p.horizontal?18:22,itemStyle:{color:a.color,borderRadius:a.type==='bar'?[2,2,0,0]:undefined},lineStyle:{width:2,color:a.color},
        ...(a.area?{areaStyle:{opacity:.75}}:{}),data:dates.map(d=>finite(map.get(d)?.value)?map.get(d).value*(a.scale||1):null)};
    });
    const names=series.map(a=>a.name), selected=p.key==='companies'?Object.fromEntries(names.map((n,i)=>[n,i<3||i===names.length-1])):undefined;
    const number=v=>Number(v).toLocaleString('ru-RU',{maximumFractionDigits:1});
    const x={type:'category',data:dates,axisTick:{show:false},axisLabel:{color:'#747979',fontSize:11,hideOverlap:true,formatter:period},axisLine:{lineStyle:{color:'#c8cbc7'}}};
    const y={type:'value',axisLabel:{color:'#747979',fontSize:11,formatter:v=>number(v)+(p.horizontal?'%':'')},splitLine:{lineStyle:{color:'#e6e7e1'}},...(p.key==='structure'?{min:0,max:100}:{})};
    const endYear=Number(dates.at(-1)?.slice(0,4)), years=Number(s.industryRange||0), start=years?Math.max(0,dates.findIndex(d=>Number(d.slice(0,4))>=endYear-years+1)):0;
    if(p.key==='online')series[0].markLine={silent:true,symbol:['none','none'],lineStyle:{type:'dotted',color:'#899eaf'},label:{show:true,formatter:'Методика',fontSize:9,color:'#65747d',position:'insideEndTop'},data:[{xAxis:'2018'},{xAxis:'2024'}]};
    return {animation:false,textStyle:{fontFamily:'IBM Plex Sans, Arial, sans-serif'},
      legend:{type:names.length>5?'scroll':'plain',left:0,right:0,top:0,itemWidth:12,itemHeight:7,textStyle:{fontSize:11,color:'#626b6c'},...(selected?{selected}:{})},
      grid:{top:names.length>3?72:52,left:p.horizontal?(small?140:185):small?52:58,right:p.horizontal?40:25,bottom:p.horizontal?24:dates.length>20?64:35},
      xAxis:p.horizontal?y:x,yAxis:p.horizontal?{...x,inverse:true,axisLabel:{...x.axisLabel,width:small?122:166,overflow:'break',fontSize:11}}:y,
      tooltip:{trigger:'axis',confine:true,formatter:points=>{
        const head=p.horizontal?points[0]?.name:period(points[0]?.axisValue||'');
        const unit=p.horizontal?'%':p.unit.includes('трлн')?'трлн ₽':s.sector==='steel'?(p.unit.includes('$/сух.')?'$/сух. т':p.unit.includes('$/т')?'$/т':p.unit.includes('млн т/год')?'млн т/год':p.unit.includes('млн т')?'млн т':'%'):'%';
        return '<b>'+esc(head)+'</b><br>'+points.filter(a=>finite(a.value)).map(a=>a.marker+esc(a.seriesName)+': <b>'+number(a.value)+' '+unit+'</b>').join('<br>');
      }},series,
      ...(!p.horizontal&&dates.length>20?{dataZoom:[{type:'inside',startValue:start,endValue:dates.length-1,filterMode:'none',zoomOnMouseWheel:'ctrl',moveOnMouseWheel:false},{type:'slider',height:14,bottom:8,startValue:start,endValue:dates.length-1,filterMode:'none',showDetail:false,borderColor:'transparent',fillerColor:'#578ed022'}]}:{})};
  }
  function source(s,key) {const a=s.industry.sources[key];return a?`<a class="sr-industry-source" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>`:'';}
  function table(s) {
    const available=[...new Set(s.industry.companies.flatMap(c=>c.rows.map(r=>r.year)))].filter(y=>y>=2015).sort((a,b)=>b-a);
    const year=available.includes(s.industryYear)?s.industryYear:available[0];
    const cols=[['comparison_growth','Рост выручки','%'],['lfl_sales','LFL продажи','%'],['lfl_traffic','Трафик','%'],['lfl_ticket','Чек','%'],['stores','Магазины','шт.'],['capex_share','CAPEX / выручка','%'],['fcf_share','FCF / выручка','%']];
    return `<section class="sr-industry-companies sr-dashboard-panel"><div class="sr-panel-head"><h3>Сравнить компании</h3><label>Год <select data-r-industry-year aria-label="Год сравнения компаний">${available.map(y=>`<option value="${y}" ${y===year?'selected':''}>${y}</option>`).join('')}</select></label></div><div class="sr-scroll"><table class="sr-table"><thead><tr><th>Компания</th>${cols.map(([,label,unit])=>`<th>${label}<small>${unit}</small></th>`).join('')}</tr></thead><tbody>${s.industry.companies.map(c=>{const row=c.rows.find(r=>r.year===year),v=row?.values||{};return `<tr><th><button type="button" data-r-open="${esc(c.id)}">${esc(c.name)}</button><small>${esc(c.perimeter)}</small></th>${cols.map(([key,,unit])=>`<td>${fmt(v[key],unit==='шт.'?0:1)}</td>`).join('')}</tr>`}).join('')}</tbody></table></div></section>`;
  }
  function markup(s) {
    if(s.sector==='steel')return window.StockResearchSteelIndustry.markup(s);
    const data=s.industry;if(!data)return '<p role="status">Загрузка отраслевых данных…</p>';
    const last=id=>data.series[id].rows.at(-1);
    const tape=[['turnover_total','Оборот розницы',.001,'трлн ₽'],['nominal_total','Рост продаж',1,'% г/г'],['cpi_food','Инфляция продуктов',1,'% г/г'],['real_disposable','Располагаемые доходы',1,'% г/г'],['saving_rate','Норма сбережений',1,'%']];
    const range=s.industryRange||'all';
    const snapshot=data.snapshot_at.slice(0,10).split('-').reverse().join('.');
    const pp=panels(s);
    const structure=data.market_structure;
    return `<section class="sr-industry"><div class="sr-industry-heading"><div><h2>Пульс ритейла</h2><span>Спрос, цены и экономика торговых сетей</span></div><div class="sr-industry-history"><span>Срез ${snapshot}</span><div class="sr-segments" aria-label="Глубина отраслевой истории">${[['3','3 года'],['5','5 лет'],['10','10 лет'],['all','Вся история']].map(([v,label])=>`<button type="button" data-r-industry-range="${v}" aria-pressed="${range===v}">${label}</button>`).join('')}</div></div></div>
      <div class="sr-industry-tape">${tape.map(([id,label,scale,unit])=>{const r=last(id);return `<div><span>${label}</span><strong>${fmt(r?.value*scale)}<small>${unit}</small></strong><time>${period(r?.date||'')}</time></div>`}).join('')}</div>
      <nav class="sr-industry-jumps" aria-label="Разделы отрасли">${[['turnover','Спрос'],['inflation','Цены'],['income','Покупатель'],['online','Онлайн'],['companies','Компании']].map(([key,label])=>`<a href="#retail-industry-${key}" data-industry-jump="${key}">${label}</a>`).join('')}</nav>
      <div class="sr-industry-grid">${pp.map(p=>`<section class="sr-dashboard-panel ${p.wide?'sr-industry-wide':''}" id="retail-industry-${p.key}"><div class="sr-panel-head"><div><h3>${esc(p.title)}</h3><p>${esc(p.unit)}</p></div>${source(s,p.source)}</div>${p.company?`<div class="sr-segments sr-industry-company-choice" aria-label="Компания на графике">${data.companies.map(c=>`<button type="button" data-r-industry-company="${esc(c.id)}" aria-pressed="${selectedCompany(s).id===c.id}">${esc(c.name)}</button>`).join('')}</div>`:''}<div class="sr-industry-chart ${p.horizontal?'sr-industry-chart-tall':''}" data-industry-chart="${p.key}" role="img" aria-label="${esc(p.title)}"></div></section>`).join('')}</div>
      <section class="sr-industry-market sr-dashboard-panel"><h3>Продовольственная розница: структура рынка</h3><div><span>Объём рынка · ${structure.year}</span><strong>${fmt(structure.food_market_billion_rub/1000)} трлн ₽</strong></div><div class="sr-market-share" aria-label="Доля десяти крупнейших игроков ${structure.top10_share}%"><span style="width:${structure.top10_share}%">Топ-10 <b>${fmt(structure.top10_share)}%</b></span><span style="width:${structure.other_share}%">Другие <b>${fmt(structure.other_share)}%</b></span></div>${source(s,structure.source)}</section>
      ${table(s)}
      <details class="sr-industry-data"><summary>Данные и источники</summary><p>Расчётные ряды отмечены как оценки. Рост выручки компаний и рост рынка — разные периметры; их разница не является изменением доли рынка. Все данные доступны в CSV.</p><ul>${Object.entries(data.sources).map(([k])=>`<li>${source(s,k)}</li>`).join('')}</ul><ul>${data.unresolved.map(r=>`<li>${esc(r.detail)}</li>`).join('')}</ul></details></section>`;
  }
  function draw(s) {
    if(!window.echarts)return;
    for(const node of s.root.querySelectorAll('[data-industry-chart]')) {
      const chart=window.echarts.init(node,'bondsai-paper',{renderer:'svg'});chart.setOption(options(s,node.dataset.industryChart));
      (s.researchCharts||=[]).push(chart);
    }
  }
  function csv(s) {
    if(s.sector==='steel')return window.StockResearchSteelIndustry.csv(s);
    const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    const rows=[['Показатель','Период','Значение','Единица','Статус','Источник','Срез','Формула']];
    for(const a of Object.values(s.industry.series))for(const r of a.rows)rows.push([a.label,r.date,r.value,a.unit,a.status,s.industry.sources[a.source]?.url,s.industry.sources[a.source]?.snapshot,a.formula]);
    const percent=new Set(['comparison_growth','revenue_growth','lfl_sales','lfl_traffic','lfl_ticket','ebitda_margin','capex_share','fcf_share','stores_growth','area_growth']);
    const names={comparison_growth:'Рост выручки',comparison_revenue:'Выручка для сравнения',stores_growth:'Рост числа магазинов',area_growth:'Рост торговой площади',capex_share:'CAPEX / выручка',fcf_share:'FCF / выручка'};
    for(const c of s.industry.companies)for(const r of c.rows)for(const [k,v] of Object.entries(r.values)){
      const definition=s.industry.company_metric_definitions?.[k];
      rows.push([c.name+' / '+(names[k]||window.StockResearch?.metrics[k]?.[0]||k),r.year,v,definition?.unit||(percent.has(k)?'%':k==='stores'?'шт.':k==='selling_space'?'тыс. м²':'млн ₽'),'company_data',r.sources?.[k]?.url||'akcii.html#research?sector=retail&company='+c.id+'&view=sources',s.industry.built_at,c.perimeter+(definition?.formula?' · '+definition.formula:'')]);
    }
    return '\uFEFF'+rows.map(r=>r.map(quote).join(';')).join('\r\n');
  }
  function download(s) {
    const blob=new Blob([csv(s)],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=s.sector==='steel'?'StockAI-Металлургия-отрасль.csv':'StockAI-Ритейл-отрасль.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return {ensure,panels,options,markup,draw,csv,download,timeline,table};
})();
