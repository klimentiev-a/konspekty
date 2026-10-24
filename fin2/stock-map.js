'use strict';
window.StockMap = (() => {
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (v,d=2) => v == null ? '—' : Number(v).toLocaleString('ru-RU',{maximumFractionDigits:d,minimumFractionDigits:d});
  const cap = v => v >= 1e12 ? num(v/1e12)+' трлн ₽' : num(v/1e9)+' млрд ₽';
  const change = v => v == null ? '—' : (v>0?'+':'')+num(v)+'%';
  function color(v) {
    if(v == null) return '#e4e5e2';
    if(v <= -3) return '#a64b42'; if(v < -1) return '#c98c80'; if(v < 0) return '#ebcfc6';
    if(v === 0) return '#edede7'; if(v < 1) return '#cce2d5'; if(v < 3) return '#78ac97'; return '#327b65';
  }
  const MIN_CAP = 1e9;
  function group(items, threshold=MIN_CAP) {
    const sectors = new Map();
    for(const r of items) {
      if(!(Number.isFinite(r.cap) && r.cap>0)) continue;
      if(!sectors.has(r.sector)) sectors.set(r.sector,{name:r.sector,value:0,children:[]});
      const g=sectors.get(r.sector); g.value+=r.cap;
      if(r.cap < threshold) {
        let other=g.children.find(n=>n.aggregate);
        if(!other){other={name:'Другое',aggregate:true,sector:r.sector,value:0,members:[],itemStyle:{color:'#e4e5e2'},label:{color:'#535952'}};g.children.push(other);}
        other.value+=r.cap;other.members.push(r);
      }else g.children.push({name:r.ticker,value:r.cap,ticker:r.ticker,change:r.change,itemStyle:{color:color(r.change)},label:{color:r.change!=null && Math.abs(r.change)>=3?'#fff':'#202326'}});
    }
    return [...sectors.values()].sort((a,b)=>b.value-a.value).map(g=>({...g,children:g.children.sort((a,b)=>b.value-a.value)}));
  }
  let request=null, loaded=null, active=null;
  async function fetchMap() {
    if(loaded && Date.now()-loaded.at<300000) return loaded.data;
    if(request) return request;
    request=(async()=>{
      let d;
      try {const response=await fetch('/api/stock_market_map');if(!response.ok)throw Error();d=await response.json();if(!d.items?.length)throw Error();}
      catch {const response=await fetch('/stock-market.json');if(!response.ok)throw Error('Не удалось загрузить карту');d=await response.json();d.snapshot=true;}
      loaded={at:Date.now(),data:d};return d;
    })().finally(()=>{request=null;});
    return request;
  }
  function detail(r,total) {
    const dlg=document.getElementById('company-dialog');
    document.getElementById('company-content').innerHTML=`<div class="dialog-head"><div><small>${esc(r.ticker)} · ${esc(r.share_type)}</small><h1 id="company-title">${esc(r.name)}</h1><p>${esc(r.full_name)}</p></div><button class="close" data-close aria-label="Закрыть карточку">×</button></div><div class="notice">Реальные данные MOEX ISS с задержкой. Цена: ${esc(r.price_date)} ${r.price_source==='LAST'?esc(r.quote_time):'· предыдущая сессия'}.</div><div class="company-stats"><div><small>Капитализация выпуска</small><strong>${cap(r.cap)}</strong></div><div><small>Цена</small><strong>${num(r.price,2)} ₽</strong></div><div><small>К предыдущей сессии</small><strong>${change(r.change)}</strong></div></div><div class="thesis"><h3>${esc(r.sector)}</h3><p>${r.sector_index?'Сектор по составу индекса '+esc(r.sector_index):'В отраслевых индексах не найден. Сектор не присваиваем автоматически.'}</p><p>Доля в показанной капитализации рынка: ${num(r.cap/total*100)}%. Оборот за день: ${r.turnover==null?'—':cap(r.turnover)}.</p></div><details><summary>Источник и методика</summary><p>Капитализация: ${esc(r.cap_source)}. Это стоимость отдельного выпуска акций, без поправки на free-float.</p><p>ISIN: ${esc(r.isin)||'—'}</p><a target="_blank" rel="noopener" href="https://www.moex.com/ru/issue.aspx?board=TQBR&code=${encodeURIComponent(r.ticker)}">Страница выпуска на Мосбирже</a></details>`;
    const explanation=document.createElement('p');
    explanation.textContent=r.sector_method==='StockAI'?'Классификация StockAI по профилю бизнеса. '+(r.sector_note||''):(r.sector_index?'Сектор по составу индекса '+r.sector_index:'Классификация не подтверждена');
    document.querySelector('#company-content .thesis p').replaceWith(explanation);
    if(r.sector_source_url){const a=document.createElement('a');a.href=r.sector_source_url;a.target='_blank';a.rel='noopener';a.textContent='Источник классификации';document.querySelector('#company-content .thesis').append(a);}
    const research=window.StockWorkspace?.companyLink?.(r.ticker);if(research){const a=document.createElement('a');a.className='ai-bank-shortcut';a.href=research;a.textContent='Открыть анализ компании';a.onclick=()=>dlg.close();document.getElementById('company-content').append(a)}
    dlg.showModal();
  }
  function otherDetail(node,total) {
    const dlg=document.getElementById('company-dialog');
    document.getElementById('company-content').innerHTML=`<div class="dialog-head"><div><small>${esc(node.sector)}</small><h1 id="company-title">Другое</h1></div><button class="close" data-close aria-label="Закрыть карточку">×</button></div><p>Выпуски с капитализацией меньше 1 млрд ₽ объединены. Их суммарная площадь сохранена; индивидуально они не показаны на карте.</p><div class="notice">${node.members.length} выпусков · ${cap(node.value)} · ${num(node.value/total*100)}% от рынка</div><div class="map-rows">${node.members.map(r=>`<div class="map-aggregate-row"><span><b>${esc(r.ticker)}</b><small>${esc(r.name)}</small></span><span>${cap(r.cap)}</span></div>`).join('')}</div>`;
    dlg.showModal();
  }
  function sectorPicker(select) {
    const trigger=document.createElement('button');
    trigger.type='button';trigger.className='map-sector-trigger';
    trigger.setAttribute('aria-label','Сектор карты');trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
    const menu=document.createElement('dialog');menu.className='map-sector-menu';menu.setAttribute('aria-label','Выберите сектор');
    select.hidden=true;select.before(trigger);select.after(menu);
    const sync=()=>{
      trigger.textContent=select.selectedOptions[0]?.textContent||'Весь рынок';
      menu.innerHTML='<div class="map-sector-caption">Сектор рынка</div><div class="map-sector-options" role="group" aria-label="Сектора">'+Array.from(select.options,o=>`<button type="button" role="radio" aria-checked="${o.value===select.value}" data-value="${esc(o.value)}"><span>${esc(o.textContent)}</span><span aria-hidden="true">${o.value===select.value?'✓':''}</span></button>`).join('')+'</div>';
    };
    const close=()=>menu.close();let previousOverflow;
    trigger.onclick=()=>{
      sync();const box=trigger.getBoundingClientRect();
      const width=Math.min(340,innerWidth-24),height=Math.min(460,innerHeight-32);
      menu.style.width=width+'px';menu.style.maxHeight=height+'px';
      menu.style.left=Math.max(12,Math.min(box.left,innerWidth-width-12))+'px';
      menu.style.top=Math.max(12,Math.min(box.bottom+6,innerHeight-height-12))+'px';
      previousOverflow=document.documentElement.style.overflow;document.documentElement.style.overflow='hidden';
      menu.showModal();trigger.setAttribute('aria-expanded','true');
      menu.querySelector('[aria-checked="true"]')?.focus({preventScroll:true});
    };
    menu.addEventListener('close',()=>{document.documentElement.style.overflow=previousOverflow||'';trigger.setAttribute('aria-expanded','false');trigger.focus({preventScroll:true});});
    menu.addEventListener('click',e=>{
      const option=e.target.closest('[data-value]');
      if(option){select.value=option.dataset.value;close();select.dispatchEvent(new Event('change',{bubbles:true}));}
      else if(e.target===menu){const r=menu.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}
    });
    menu.addEventListener('keydown',e=>{
      if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
      e.preventDefault();const options=Array.from(menu.querySelectorAll('[data-value]')),i=options.indexOf(document.activeElement);
      options[e.key==='Home'?0:e.key==='End'?options.length-1:(i+(e.key==='ArrowDown'?1:-1)+options.length)%options.length]?.focus();
    });
    sync();return sync;
  }
  async function mount(root) {
    if(!root)return;
    if(active){active.observer?.disconnect();active.chart?.dispose();}
    root.classList.add('stock-market-root');
    root.innerHTML='<section class="panel market-map-panel"><h1>Карта рынка акций</h1><p role="status">Загружаем капитализации и составы секторов…</p><div class="market-treemap map-skeleton" aria-hidden="true"></div></section>';
    const state={root,chart:null,observer:null};active=state;
    let data;
    try {data=await fetchMap();}catch {if(!root.isConnected)return;root.innerHTML='<section class="panel"><h1>Карта рынка акций</h1><p>Биржевые данные недоступны. Попробуйте ещё раз.</p><button type="button" class="text-button" data-map-retry>Повторить</button></section>';root.querySelector('[data-map-retry]').onclick=()=>mount(root);return;}
    if(!root.isConnected || active!==state)return;
    if(window.StockValuation)data=await window.StockValuation.mapData(data);if(!root.isConnected||active!==state)return;
    const items=data.items||[], total=items.reduce((s,r)=>s+r.cap,0),groups=group(items);
    root.innerHTML=`<section class="panel market-map-panel"><div class="section-label"><div><h1>Карта рынка акций</h1><p>Площадь — капитализация · цвет — изменение за день</p></div><button type="button" class="text-button" data-map-refresh>Обновить</button></div><div class="map-toolbar"><select aria-label="Сектор карты" id="map-sector"><option value="">Весь рынок</option>${groups.map(g=>`<option>${esc(g.name)}</option>`).join('')}</select><span>${items.length} выпусков · ${cap(total)}</span></div><div class="market-treemap" role="img" aria-label="Карта капитализации акций по секторам. Полный доступный список находится под графиком."></div><div class="map-legend"><span>Падение</span>${[-4,-2,-.5,0,.5,2,4].map(v=>`<i style="background:${color(v)}" title="${change(v)}"></i>`).join('')}<span>Рост</span><span class="legend-missing">Серый — нет изменения</span></div><p class="map-datestamp">${data.snapshot?'Сохранённый снимок':'Снимок MOEX'}: ${esc(data.as_of)} · загружен ${esc(new Date(data.fetched_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}))} МСК${data.stale?' · источник недоступен, данные устарели':''}. Обновление данных — не чаще раза в 5 минут.</p><details class="map-method"><summary>Периметр, сектора и методика</summary><p>${esc(data.methodology)}</p><p>На карте ${items.length} из ${data.universe_count} выпусков TQBR. Без капитализации: ${data.excluded.length}. Без отраслевой классификации: ${items.filter(r=>!r.sector_index).length}. ${data.sector_errors.length?'Не загружены составы: '+esc(data.sector_errors.join(', '))+'.':''}</p><p>Капитализация сектора — сумма выпусков на карте. Это не вес отраслевого индекса. Изменение цвета не включает дивиденды; серый цвет не означает нулевую доходность.</p><p>Составы индексов: ${Object.entries(data.sector_dates).map(([k,v])=>esc(k)+' на '+esc(v)).join('; ')}.</p>${data.excluded.length?'<p>Не вошли в площадь: '+data.excluded.map(r=>esc(r.ticker)).join(', ')+'.</p>':''}<a target="_blank" rel="noopener" href="${esc(data.source_url)}">Источник MOEX ISS</a></details><details class="map-list"><summary>Все выпуски <span data-map-count>${items.length}</span></summary><input type="search" placeholder="Название или тикер" aria-label="Поиск на карте"><div class="map-rows"></div></details></section>`;
    if(data.treasury_excluded){const note=document.createElement('p');note.className='sr-valuation-policy';note.setAttribute('role','status');note.textContent='Без казначейских и квазиказначейских акций. Пакет подтверждён для '+items.length+' выпусков; '+data.treasury_unknown.length+' без подтверждённого пакета не включены в площадь карты. Размер — по последним подключённым раскрытиям.';root.querySelector('.map-toolbar').after(note);}
    root.querySelector('.legend-missing').textContent='Серый — «Другое» или нет данных';
    const method=root.querySelector('.map-method');
    method.querySelectorAll('p')[1].textContent=`Проверено ${items.length} выпусков TQBR. Ниже 1 млрд ₽: ${items.filter(r=>r.cap<MIN_CAP).length} выпусков — объединены в «Другое» внутри своего сектора. Без капитализации: ${data.excluded.length}. Без классификации: ${items.filter(r=>r.sector==='Без классификации').length}.`;
    const explanation=document.createElement('p');explanation.textContent='Классификация StockAI по бизнесу не равна включению в отраслевой индекс. Отдельные сектора выделены для медицины, промышленности, холдингов и упаковки. У каждого выпуска указан метод классификации.';method.append(explanation);
    const chartNode=root.querySelector('.market-treemap'),select=root.querySelector('#map-sector'),search=root.querySelector('input');
    const byTicker=new Map(items.map(r=>[r.ticker,r]));
    const syncPicker=sectorPicker(select);
    const draw=()=>{
      syncPicker();
      const shown=items.filter(r=>!select.value||r.sector===select.value);
      root.querySelector('.map-toolbar>span').textContent=`${shown.length} выпусков · ${cap(shown.reduce((sum,r)=>sum+r.cap,0))}`;
      if(window.echarts){
        // A new tree means a new view rectangle. notMerge alone leaves the
        // previous treemap's internal zoom/transform behind on sector changes.
        state.chart?.dispose();
        state.chart=echarts.init(chartNode,'bondsai-paper',{renderer:'svg'});
        state.chart.setOption({
          animation:false, animationDuration:0, animationDurationUpdate:0,
          tooltip:{confine:true,formatter:p=>{
            if(p.data?.aggregate)return `<b>Другое · ${esc(p.data.sector)}</b><br>${p.data.members.length} выпусков меньше 1 млрд ₽<br>Капитализация: ${cap(p.value)}`;
            const r=byTicker.get(p.data?.ticker);
            return r?`<b>${esc(r.name)} · ${esc(r.ticker)}</b><br>${esc(r.sector)}<br>Капитализация: ${cap(r.cap)}<br>За день: ${change(r.change)}<br>Цена: ${num(r.price,2)} ₽`:`${esc(p.name)}<br>${cap(p.value)}`;
          }},
          series:[{
            type:'treemap',id:'stock-market-tree',width:'100%',height:'100%',top:0,left:0,
            roam:false,nodeClick:false,visibleMin:0,childrenVisibleMin:0,breadcrumb:{show:false},
            label:{show:true,fontFamily:'system-ui',fontSize:12,overflow:'truncate',formatter:p=>p.data.aggregate?`Другое\n${p.data.members.length} вып.`:p.data.ticker?`${p.name}\n${change(p.data.change)}`:p.name},
            upperLabel:{show:false,height:23,fontSize:11,color:'#535952',overflow:'truncate',formatter:p=>p.name},
            itemStyle:{borderColor:'#f1f0ec',borderWidth:2,gapWidth:2},
            levels:[{upperLabel:{show:false},itemStyle:{borderWidth:0,gapWidth:7}},
              {upperLabel:{show:true},itemStyle:{borderColor:'#eeede7',borderWidth:1,gapWidth:1}},
              {upperLabel:{show:false},itemStyle:{borderWidth:0,gapWidth:0}}],data:group(shown)
          }]
        });
        bindChart();
      }else chartNode.innerHTML='<p>Графическая библиотека недоступна. Полный список акций доступен ниже.</p>';
      renderRows();
    };
    function renderRows(){
      const q=search.value.toLowerCase(),view=items.filter(r=>!select.value||r.sector===select.value);
      const rows=view.filter(r=>r.cap>=MIN_CAP&&(r.name+' '+r.ticker).toLowerCase().includes(q));
      const otherNodes=group(view).flatMap(g=>g.children.filter(n=>n.aggregate)).filter(n=>!q||('другое '+n.sector).toLowerCase().includes(q)||n.members.some(r=>(r.ticker+' '+r.name).toLowerCase().includes(q)));
      root.querySelector('.map-list summary').firstChild.textContent='На карте: ';
      root.querySelector('[data-map-count]').textContent=`выпусков: ${rows.length}${otherNodes.length?'; групп «Другое»: '+otherNodes.length:''}`;
      root.querySelector('.map-rows').innerHTML=rows.map(r=>`<button type="button" data-map-ticker="${esc(r.ticker)}"><span><b>${esc(r.ticker)}</b><small>${esc(r.name)}</small></span><span>${cap(r.cap)}</span><span style="color:${r.change==null?'#747979':r.change>=0?'#267260':'#ae5144'}">${change(r.change)}</span></button>`).join('')+otherNodes.map(n=>`<button type="button" data-map-other="${esc(n.sector)}"><span><b>Другое</b><small>${esc(n.sector)}</small></span><span>${cap(n.value)}</span><span>${n.members.length} вып.</span></button>`).join('')||'<p>Нет совпадений. Измените поиск или сектор.</p>';
    }
    select.onchange=draw;search.oninput=renderRows;
    root.querySelector('[data-map-refresh]').onclick=()=>{loaded=null;mount(root);};
    root.querySelector('.map-list').addEventListener('click',e=>{const b=e.target.closest('[data-map-ticker]'),o=e.target.closest('[data-map-other]');if(b)detail(byTicker.get(b.dataset.mapTicker),total);if(o){const node=group(items).find(g=>g.name===o.dataset.mapOther)?.children.find(n=>n.aggregate);if(node)otherDetail(node,total);}});
    draw();
    function bindChart(){state.chart?.on('click',p=>{const r=byTicker.get(p.data?.ticker);if(p.data?.aggregate)otherDetail(p.data,total);else if(r)detail(r,total);else if(p.data?.children){select.value=p.name;draw();}});}
    // Treemap retains its old view rectangle on ECharts resize. Rebuild the
    // layout at the new dimensions instead of clipping the desktop layout.
    let frame=0,lastWidth=chartNode.clientWidth,lastHeight=chartNode.clientHeight;
    state.observer=new ResizeObserver(()=>{
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        if(!root.isConnected){state.observer.disconnect();state.chart?.dispose();return;}
        const width=chartNode.clientWidth,height=chartNode.clientHeight;
        if(width===lastWidth && height===lastHeight)return;
        lastWidth=width;lastHeight=height;
        draw();
      });
    });state.observer.observe(chartNode);
  }
  return {mount,group,color,MIN_CAP};
})();
