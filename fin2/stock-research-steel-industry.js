'use strict';
window.StockResearchSteelIndustry=(()=>{
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const colors=['#578ed0','#2a9f91','#c78b30','#899eaf','#8b79b9','#c26f66'];
 const fmt=(v,n=1)=>Number.isFinite(v)?v.toLocaleString('ru-RU',{maximumFractionDigits:n,minimumFractionDigits:n}):'—';
 function panels(s){
  const data=s.industry;
  const a=(id,color,type='line',stack)=>data.series[id]?{id,...data.series[id],name:data.series[id].label,color,type,stack}:null;
  const peers=(metric)=>data.companies.map((c,i)=>{const row=a(c.id+'_'+metric,colors[i]);return row?{...row,name:c.name}:null;});
  const pp=[
   {key:'production',title:'Сталь: производство и потребление',unit:'млн т · Россия',wide:true,series:[a('ru_steel',colors[0],'bar'),a('ru_use',colors[2])]},
   {key:'capacity',title:'Сколько стали можно выпускать',unit:'млн т/год · Россия',series:[a('ru_capacity',colors[3]),a('ru_steel',colors[0])]},
   {key:'utilization',title:'Загрузка сталеплавильных мощностей',unit:'% · Россия · расчёт worldsteel / OECD',series:[a('ru_utilization',colors[1])]},
   {key:'rolling',title:'Выпуск горячекатаной продукции',unit:'млн т · Россия · 2008–2019',series:[a('ru_hot_rolled',colors[0],'bar')]},
   {key:'rolling-mix',title:'Плоский и сортовой прокат',unit:'млн т · Россия · 2008–2017',series:[a('ru_hot_flat',colors[0],'bar','rolled'),a('ru_hot_long',colors[1],'bar','rolled')]},
   {key:'companies',title:'Выплавка стали по компаниям',unit:'млн т за год',wide:true,series:peers('steel_production')},
   {key:'sales',title:'Продажи металлопродукции',unit:'млн т за год',series:peers('steel_sales')},
   {key:'pig',title:'Производство чугуна',unit:'млн т за год',series:peers('pig_iron_production')},
   {key:'product-mix',title:'Какой прокат продаёт Северсталь',unit:'млн т · консолидированные продажи',wide:true,series:['hot','cold','galv','coated','long','hardware','ldp','pipes','solutions','semis'].map((k,i)=>a('sv_'+k,colors[i%colors.length],'bar','products'))},
   {key:'pellets',title:'Окатыши: куда идут отгрузки',unit:'млн т · Северсталь · не производство',series:[a('sv_pellet_external',colors[0],'bar','pellets'),a('sv_pellet_internal',colors[1],'bar','pellets')]},
   {key:'pellet-production',title:'Производство окатышей',unit:'млн т · Металлоинвест · 2011–2021',series:[a('mi_pellets',colors[0],'bar')]},
   {key:'raw-production',title:'Сырьё и металлизация',unit:'млн т · Металлоинвест · переделы не складываются',series:[a('mi_ore',colors[3]),a('mi_hbi_dri',colors[1])]},
   {key:'ore',title:'Окатыши и концентрат',unit:'млн т · Северсталь · включая внутригрупповые отгрузки',series:[a('sv_pellet_total',colors[0]),a('sv_concentrate',colors[2])]},
   {key:'steel-prices',title:'Отпускные цены горячего и холодного листа',unit:'$/т · Северсталь, Российская Сталь · не рыночный спот',wide:true,series:[a('sv_hot_price',colors[0]),a('sv_cold_price',colors[1])]},
   {key:'prices',title:'Цена железной руды',unit:'$/сух. т · 62% Fe · CFR Китай',wide:true,series:[a('iron_ore_price',colors[2])]},
   {key:'demand-industry',title:'Спрос: машины и металлоизделия',unit:'Выпуск отраслей-потребителей · % г/г · Россия',series:[a('demand_machinery',colors[0]),a('demand_metal_prod',colors[1])]},
   {key:'demand-transport',title:'Спрос: автопром и транспорт',unit:'Выпуск отраслей-потребителей · % г/г · Россия',series:[a('demand_autos',colors[0]),a('demand_transport_eq',colors[4])]},
   {key:'demand-electrical',title:'Спрос: электрооборудование',unit:'Выпуск отрасли-потребителя · % г/г · Россия',series:[a('demand_el_equip',colors[1])]},
   {key:'demand-mix',title:'Кто потребляет сталь в мире',unit:'% мирового потребления · 2025 · не Россия',horizontal:true,series:[{name:'Доля отрасли',unit:'%',color:colors[0],type:'bar',source:data.demand_structure.source,rows:data.demand_structure.rows.map(r=>({date:r.label,value:r.value}))}]},
   {key:'hva',title:'Продукция с высокой добавленной стоимостью',unit:'% продаж · определения компаний',series:peers('hva_share')},
   {key:'coal',title:'Угольный бизнес Мечела',unit:'млн т добычи · периметр Эльги изменён в 2020',series:[a('mechel_coal_production',colors[3],'bar')]},
  ];
  return pp.map(p=>({...p,series:p.series.filter(a=>a&&a.rows.length)})).filter(p=>p.series.length);
 }
 function source(s,key){const a=s.industry.sources[key];return a?`<a class="sr-industry-source" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>`:'';}
 function table(s){
  const data=s.industry,years=[...new Set(data.companies.flatMap(c=>c.rows.map(r=>r.year)))].sort((a,b)=>b-a),year=years.includes(s.industryYear)?s.industryYear:years[0];
  const columns=[['steel_production','Сталь','млн т'],['pig_iron_production','Чугун','млн т'],['steel_sales','Продажи стали','млн т'],['hva_share','Доля HVA','%']];
  return `<section class="sr-industry-companies sr-dashboard-panel"><div class="sr-panel-head"><h3>Сравнить компании</h3><label>Год <select data-r-industry-year aria-label="Год сравнения компаний">${years.map(y=>`<option ${y===year?'selected':''}>${y}</option>`).join('')}</select></label></div><div class="sr-scroll"><table class="sr-table"><thead><tr><th>Компания</th>${columns.map(([,label,unit])=>`<th>${label}<small>${unit}</small></th>`).join('')}</tr></thead><tbody>${data.companies.map(c=>{const values=c.rows.find(r=>r.year===year)?.values||{};return `<tr><th><button type="button" data-r-open="${esc(c.id)}">${esc(c.name)}</button></th>${columns.map(([key,,unit])=>`<td>${fmt(Number.isFinite(values[key])?values[key]*(unit==='%'?100:1):null,2)}</td>`).join('')}</tr>`;}).join('')}</tbody></table></div></section>`;
 }
 function markup(s){
  const data=s.industry;if(!data)return '<p role="status">Загружаю отрасль…</p>';
  const tape=[['ru_steel','Выплавка стали','млн т'],['ru_use','Потребление стали','млн т'],['ru_capacity','Мощности выплавки','млн т/год'],['ru_utilization','Загрузка','%'],['iron_ore_price','Железная руда','$/сух. т']];
  const pp=panels(s),range=s.industryRange||'all';
  return `<section class="sr-industry sr-steel-industry"><div class="sr-industry-heading"><div><h2>Пульс металлургии</h2><span>Производство, сырьё и рынки сбыта</span></div><div class="sr-industry-history"><span>История с 2000 года · глубина зависит от показателя</span><div class="sr-segments" aria-label="Глубина отраслевой истории">${[['3','3 года'],['5','5 лет'],['10','10 лет'],['all','Вся история']].map(([v,label])=>`<button type="button" data-r-industry-range="${v}" aria-pressed="${range===v}">${label}</button>`).join('')}</div></div></div>
   <div class="sr-industry-tape">${tape.map(([id,label,unit])=>{const r=data.series[id].rows.at(-1);return `<div><span>${label}</span><strong>${fmt(r.value)}<small>${unit}</small></strong><time>${r.date}</time></div>`;}).join('')}</div>
   <nav class="sr-industry-jumps" aria-label="Разделы отрасли">${[['production','Производство'],['rolling','Прокат'],['pellets','Окатыши и сырьё'],['steel-prices','Цены'],['demand-industry','Спрос'],['capacity','Мощности'],['companies','Компании']].map(([k,l])=>`<a href="#steel-industry-${k}" data-industry-jump="${k}">${l}</a>`).join('')}</nav>
   <div class="sr-industry-grid">${pp.map(p=>{const dates=p.horizontal?['2025']:p.series.flatMap(a=>a.rows.map(r=>r.date)).sort();return `<section class="sr-dashboard-panel ${p.wide?'sr-industry-wide':''}" id="steel-industry-${p.key}"><div class="sr-panel-head"><div><h3>${esc(p.title)}</h3><p>${esc(p.unit)}</p></div><span class="sr-industry-span">${esc(dates[0])}${dates[0]===dates.at(-1)?'':' — '+esc(dates.at(-1))}</span></div><div class="sr-industry-chart ${p.horizontal?'sr-industry-chart-tall':''}" data-industry-chart="${p.key}" role="img" aria-label="${esc(p.title)}"></div></section>`;}).join('')}</div>
   ${table(s)}<details class="sr-industry-data"><summary>Данные и покрытие</summary><p>Производство, продажи и мощности показаны отдельно. Загрузка — расчёт по выплавке и мощностям одного года. Структура спроса — мировая; российские индексы потребителей не являются тоннажем закупок стали.</p><div class="sr-scroll"><table class="sr-table"><thead><tr><th>Показатель</th><th>История</th><th>Периодов</th></tr></thead><tbody>${Object.values(data.series).map(a=>`<tr><th>${esc(a.label)}</th><td>${a.first}–${a.last}</td><td>${a.rows.length}</td></tr>`).join('')}</tbody></table></div><ul>${data.unresolved.map(r=>`<li>${esc(r.detail)}</li>`).join('')}</ul><ul>${Object.keys(data.sources).map(key=>`<li>${source(s,key)}</li>`).join('')}</ul></details></section>`;
 }
 function csv(s){const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"',rows=[['Показатель','Период','Значение','Единица','Статус','Источник','Место','Формула']];
  for(const a of Object.values(s.industry.series))for(const r of a.rows)rows.push([a.label,r.date,r.value,a.unit,r.status||a.status,r.lineage?.url||s.industry.sources[r.source||a.source]?.url,r.location,a.formula]);
  for(const r of s.industry.demand_structure.rows)rows.push(['Мировой спрос / '+r.label,2025,r.value,'%','reported',s.industry.sources[s.industry.demand_structure.source].url,s.industry.demand_structure.location,'']);
  return '\uFEFF'+rows.map(r=>r.map(quote).join(';')).join('\r\n');
 }
 return {panels,markup,table,csv};
})();
