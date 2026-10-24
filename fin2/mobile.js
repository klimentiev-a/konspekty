/* Phone presentation only. Prices, filters and calculations use the same
   universe, issue views and API as desktop. No parallel financial model. */
window.BondsMobile = (() => {
  const media = matchMedia('(max-width: 760px)');
  const state = { filters: false, focus: null, filterScroll: 0, menu: null, mapOpen: false };
  const paths = {
    bonds: '<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h3"/>',
    map: '<path d="M3 20h18M4 17l5-7 4 3 7-10"/><circle cx="9" cy="10" r="1"/><circle cx="13" cy="13" r="1"/>',
    indices: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    filter: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.bonds}</svg>`;
  const isPhone = () => media.matches;
  function beforeRender() {
    if (!isPhone()) return;
    state.fromTab = document.body.dataset.mobileView;
    state.scrollByTab ||= {};
    if (state.fromTab) state.scrollByTab[state.fromTab] = window.scrollY;
    const active = document.activeElement;
    state.focus = /^(u-|m-|mv-|id-|sb-)/.test(active?.id || '') ? active.id : null;
    state.filterScroll = document.querySelector('.mobile-filter-body')?.scrollTop || 0;
    document.querySelectorAll('.mobile-filter-dialog').forEach(d => d.close());
  }
  function navigate(tab, watch = false) {
    state.freshNavigation = true;
    state.filters = false;
    state.menu?.close();
    if (tab === 'screener' && UNI.f.watch !== watch) { UNI.f.watch = watch; UNI.loaded = false; }
    switchTab(tab);
    window.scrollTo(0, 0);
  }
  function shell() {
    let nav = document.getElementById('mobile-nav');
    if (!nav) {
      nav = el('<nav id="mobile-nav" aria-label="Основная навигация"></nav>');
      document.body.append(nav);
    }
    const entries = [['marketmap', 'Карта', 'map'], ['screener', 'Скринер', 'bonds'], ['indices', 'Индексы', 'indices'], ['watch', 'Избранное', 'star'], ['more', 'Ещё', 'more']];
    const current = TAB === 'screener' ? (UNI.f.watch ? 'watch' : 'screener') : TAB;
    nav.innerHTML = entries.map(([id, name, glyph]) => `<button type="button" data-mobile-tab="${id}" ${current === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${name}</span></button>`).join('');
    nav.querySelectorAll('button').forEach(b => b.onclick = () => b.dataset.mobileTab === 'more' ? menu() : navigate(b.dataset.mobileTab === 'watch' ? 'screener' : b.dataset.mobileTab, b.dataset.mobileTab === 'watch'));
    document.body.dataset.mobileView = TAB;
  }
  function menu() {
    state.menu?.remove();
    const d = el(`<dialog class="mobile-menu" aria-label="Дополнительно"><div class="mobile-sheet-head"><h2>Дополнительно</h2><button type="button" aria-label="Закрыть меню">×</button></div><div class="mobile-menu-grid">${TABS.filter(([id]) => !['screener','marketmap','indices','watch'].includes(id)).map(([id, label]) => `<button type="button" data-go="${id}">${escA(label)}<span aria-hidden="true">›</span></button>`).join('')}</div><div class="mobile-install"><b>BondsAI на главном экране</b><p>iPhone: «Поделиться» → «На экран Домой». Android: меню браузера → «Установить приложение» или «Добавить на главный экран».</p><p>Котировки и расчёты доступны при подключении к интернету.</p></div></dialog>`);
    document.body.append(d); state.menu = d;
    d.querySelector('[aria-label]').onclick = () => d.close();
    d.querySelectorAll('[data-go]').forEach(b => b.onclick = () => navigate(b.dataset.go));
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    d.showModal();
  }
  function filterCount() {
    const f = UNI.f;
    return ['rating','kinds','currencies','liq','coupon_freq','sectors'].reduce((n,k) => n + (f[k]?.size || 0), 0)
      + ['ytm_min','ytm_max','cy_min','cy_max','dur_min','dur_max','vol_min','vol_max'].filter(k => f[k] !== '' && f[k] != null).length
      + Number(!!f.has_offer) + Number(!!f.amort);
  }
  async function resetFilters() {
    ['rating','kinds','currencies','liq','coupon_freq','sectors'].forEach(k => UNI.f[k].clear());
    ['ytm_min','ytm_max','cy_min','cy_max','dur_min','dur_max','vol_min','vol_max'].forEach(k => UNI.f[k] = '');
    UNI.f.has_offer = false; UNI.f.amort = false;
    UNI.loaded = false; await loadUniverse(); render();
  }
  function screener(v) {
    const panel = v.firstElementChild;
    panel.classList.add('mobile-search-panel');
    panel.querySelector('h3').textContent = UNI.f.watch ? 'Избранное' : 'Скринер';
    panel.querySelector('h3').after(el(`<p class="mobile-snapshot">Снимок ${escA(UNI.updatedAt ? snapTime(UNI.updatedAt) : 'недоступен')} · MOEX с задержкой</p>`));
    const input = panel.querySelector('#u-search');
    input.placeholder = 'Название, эмитент или ISIN';
    input.setAttribute('aria-label', 'Поиск облигации или эмитента');
    input.autocomplete = 'off';
    panel.querySelector('#u-watch').parentElement.classList.add('mobile-watch-original');
    const filters = panel.querySelector('.filters');
    const dialog = el(`<dialog class="mobile-filter-dialog" aria-label="Фильтры облигаций"><div class="mobile-sheet-head"><h2>Фильтры</h2><button type="button" aria-label="Закрыть фильтры">×</button></div><div class="mobile-filter-body"></div><div class="mobile-sheet-foot"><button type="button" class="btn ghost" data-reset>Сбросить</button><button type="button" class="btn" data-done>Показать ${fmt(UNI.total)}</button></div></dialog>`);
    dialog.querySelector('.mobile-filter-body').append(filters);
    // Existing chip handlers and number inputs stay attached to the same nodes.
    filters.querySelectorAll('.chip').forEach(c => {
      c.tabIndex = 0; c.setAttribute('role', 'button');
      c.setAttribute('aria-pressed', c.classList.contains('on') ? 'true' : 'false');
      c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); } };
    });
    filters.querySelectorAll('.field').forEach(field => {
      const name = field.querySelector('label')?.textContent || '';
      field.querySelectorAll('input').forEach(i => {
        i.inputMode = 'decimal';
        const range = i.closest('.range');
        const label = range?.previousElementSibling?.textContent || name;
        i.setAttribute('aria-label', `${label} ${i.placeholder}`);
      });
    });
    panel.append(dialog);
    const close = () => { state.filters = false; dialog.close(); panel.querySelector('[data-open-filters]')?.focus(); };
    dialog.querySelector('[aria-label="Закрыть фильтры"]').onclick = close;
    dialog.querySelector('[data-done]').onclick = close;
    dialog.querySelector('[data-reset]').onclick = resetFilters;
    dialog.addEventListener('cancel', () => { state.filters = false; });
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    const sortOptions = [['volume','По ликвидности'],['ytm','По YTM'],['current_yield','По текущей доходности'],['spread_display','По премии'],['matdate','По сроку'],['price','По цене']];
    const sortTitle = sortOptions.find(([k]) => k === UNI.f.sort)?.[1] || 'Сортировка';
    const controls = el(`<div class="mobile-find-tools"><button type="button" class="mobile-filter-button" data-open-filters>${icon('filter')}Фильтры${filterCount() ? `<b>${filterCount()}</b>` : ''}</button><button type="button" class="mobile-sort-trigger" aria-label="Сортировка выпусков: ${escA(sortTitle)}" aria-haspopup="dialog" aria-expanded="false"><span>${escA(sortTitle)}</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><button type="button" class="mobile-sort-dir" aria-label="Изменить порядок сортировки">${UNI.f.desc ? '↓' : '↑'}</button></div>`);
    panel.append(controls);
    controls.querySelector('[data-open-filters]').onclick = () => { state.filters = true; dialog.showModal(); };
    const sortTrigger = controls.querySelector('.mobile-sort-trigger');
    sortTrigger.onclick = () => metricDropdown(panel,sortTrigger,async key => { UNI.f.sort = key; UNI.loaded = false; await loadUniverse(); render(); },{
      label:'Сортировка выпусков',caption:'Сортировать выпуски',selected:UNI.f.sort,
      options:sortOptions.map(([key,title]) => ({key,title}))
    });
    controls.querySelector('.mobile-sort-dir').onclick = async () => { UNI.f.desc = !UNI.f.desc; UNI.loaded = false; await loadUniverse(); render(); };
    const quick = el(`<div class="mobile-quick" aria-label="Тип купона">${[['','Все типы'],['fixed','Фикс'],['floater','Флоатеры']].map(([k,l]) => `<button type="button" data-kind="${k}" aria-pressed="${k ? UNI.f.kinds.size === 1 && UNI.f.kinds.has(k) : !UNI.f.kinds.size}">${l}</button>`).join('')}</div>`);
    quick.querySelectorAll('button').forEach(b => b.onclick = async () => { UNI.f.kinds.clear(); if (b.dataset.kind) UNI.f.kinds.add(b.dataset.kind); UNI.loaded = false; await loadUniverse(); render(); });
    panel.append(quick);
    v.querySelector('.tbl-wrap').classList.add('mobile-desktop-screener');
    v.children[1].classList.add('mobile-screener-stats');
    const rows = UNI.f.watch ? UNI.rows.filter(r => WATCH.has(r.isin)) : UNI.rows;
    v.append(bondList(rows, UNI.total, UNI.f.watch ? 'Избранные выпуски' : 'Выпуски'));
    if (state.filters) {
      dialog.showModal();
      dialog.querySelector('.mobile-filter-body').scrollTop = state.filterScroll;
      if (state.focus) dialog.querySelector('#' + state.focus)?.focus({preventScroll:true});
    }
  }
  function bondList(rows, total, caption = 'Выпуски', metric = null) {
    const list = el(`<section class="mobile-bond-list" aria-label="Выпуски облигаций"><div class="mobile-list-caption"><span>${escA(caption)}</span><span>${fmt(rows.length)} из ${fmt(total)}</span></div></section>`);
    rows.forEach(r => {
      const fl = r.kind === 'floater';
      const term = fl ? r.years_to_maturity : r.duration_years;
      const card = el(`<article class="mobile-bond" data-isin="${escA(r.isin)}"><div class="mobile-bond-top"><button type="button" class="mobile-bond-name">${escA(r.name || r.isin)}<small>${escA(r.isin)}</small></button><button type="button" class="mobile-star ${WATCH.has(r.isin) ? 'saved' : ''}" aria-label="${WATCH.has(r.isin) ? 'Удалить из избранного' : 'Добавить в избранное'}" aria-pressed="${WATCH.has(r.isin)}">${icon('star')}</button></div><div class="mobile-bond-tags">${ratingPill(r)}<span>${escA(KIND_RU[r.kind] || '—')}</span><span>${escA(r.currency || 'RUB')}</span></div><button type="button" class="mobile-bond-open" aria-label="Открыть ${escA(r.name || r.isin)}"><div class="mobile-bond-numbers"><div><span>${fl ? 'Simple margin' : 'YTM'}</span><strong class="mobile-main-number">${fl ? bp(r.simple_margin_bp) : pct(r.ytm)}</strong></div><div><span>Цена${r.price_stale ? ' · не свежая' : ''}</span><strong>${pct(r.price)}</strong></div><div><span>${fl ? 'Срок' : 'Дюрация'}</span><strong>${term == null ? '—' : fmt(term, 1) + ' г.'}</strong></div></div><div class="mobile-bond-coupon">${escA(couponLine(r))}</div><div class="mobile-bond-bottom"><span>${r.offer_date ? escA(offerWord(r)) + ' ' + dmy(r.offer_date) : 'Погашение ' + dmy(r.matdate)}</span><span>${r.volume == null ? 'Оборот —' : fmt(r.volume / 1e6, 1) + ' млн ₽/д'}</span></div></button></article>`);
      if (metric) {
        const main = card.querySelector('.mobile-bond-numbers > div');
        main.querySelector('span').textContent = ({yield:'YTM',sm:'Simple margin',cy:'Текущая дох.',gspread:'G-спред',dm:'DM к ОФЗ',z:'Z-спред'})[metric];
        const value = matrixValue(r,metric);
        main.querySelector('strong').textContent = ['yield','cy'].includes(metric) ? pct(value) : bp(value);
        if (fl) {
          const horizon = matrixHorizon(r);
          card.querySelector('.mobile-bond-numbers > div:last-child strong').textContent = horizon == null ? '—' : fmt(horizon,1) + ' г.';
        }
      }
      card.querySelector('.mobile-star').onclick = e => { toggleWatch(r.isin); const b = e.currentTarget; b.classList.toggle('saved', WATCH.has(r.isin)); b.setAttribute('aria-pressed', String(WATCH.has(r.isin))); b.setAttribute('aria-label', WATCH.has(r.isin) ? 'Удалить из избранного' : 'Добавить в избранное'); if (UNI.f.watch) render(); };
      card.querySelector('.mobile-bond-name').onclick = card.querySelector('.mobile-bond-open').onclick = () => { openIssue(r.isin); window.scrollTo(0,0); };
      list.append(card);
    });
    if (!rows.length) {
      const empty = el(`<div class="mobile-empty"><h3>${UNI.f.watch ? 'Здесь пока нет выпусков' : 'Ничего не найдено'}</h3><p>${UNI.f.watch ? 'Сохраняйте выпуски звёздочкой в списке или карточке. Если бумаги уже сохранены, проверьте фильтры.' : 'Смягчите условия: выбранные границы могут исключать все бумаги.'}</p><button type="button" class="btn ghost">Сбросить фильтры</button></div>`);
      empty.querySelector('button').onclick = resetFilters; list.append(empty);
    }
    return list;
  }
  const matrixState = { kind:'fixed', metric:'yield', ccy:'RUB', clean:true, sector:'',
    vol:'', freq:'', offer:false, amort:false, search:'', issuers:[], expanded:false,
    selection:null, limit:30, request:0 };
  const issuerText = value => String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[«»"']/g,'').replace(/\s+/g,' ').trim();
  function matrixIssuerKey(row) {
    const name = row.issuer || row.issuer_full;
    return row.emitent_id ? `eid:${row.emitent_id}` : name ? `name:${issuerText(name)}` : null;
  }
  function matrixIssuers(rows, query = '') {
    const groups = new Map(), q = issuerText(query);
    for (const row of rows) {
      const name = row.issuer || row.issuer_full, key = matrixIssuerKey(row);
      if (!key || !name) continue;
      if (!groups.has(key)) groups.set(key,{key,name,count:0,names:new Set()});
      const group = groups.get(key); group.count++; group.names.add(issuerText(name));
    }
    return [...groups.values()].filter(group => !q || [...group.names].some(name => name.includes(q)))
      .sort((a,b) => b.count - a.count || a.name.localeCompare(b.name,'ru'));
  }
  function matrixIssuerRows(rows, selected) {
    if (!selected.length) return rows;
    const keys = new Set(selected.map(issuer => issuer.key));
    return rows.filter(row => keys.has(matrixIssuerKey(row)));
  }
  function matrixIssuerResults(rows, selected) {
    return matrixIssuerRows(rows,selected).slice().sort((a,b) => (b.volume || 0) - (a.volume || 0));
  }
  const matrixTerms = ['3 мес.', '6 мес.', '1 г.', '2 г.', '3 г.', '>3 лет'];
  const matrixRatings = ['AAA','AA','A','BBB','BB','B','CCC','CC','C','D','NR'];
  function matrixHorizon(r, asOf = new Date().toISOString().slice(0,10)) {
    // offer_date is the backend's effective calculation horizon (excludes
    // past/too-near offers). It can be PUT or CALL; disclose that below.
    const end = r.offer_date || r.matdate;
    if (!end || !/^\d{4}-\d{2}-\d{2}/.test(end)) return null;
    const years = (Date.parse(end.slice(0,10) + 'T00:00:00Z') - Date.parse(asOf.slice(0,10) + 'T00:00:00Z')) / (864e5 * 365.25);
    return Number.isFinite(years) && years > 0 ? years : null;
  }
  function matrixBucket(years) {
    return years == null || !Number.isFinite(years) || years <= 0 ? null
      : years <= .25 ? 0 : years <= .5 ? 1 : years <= 1 ? 2 : years <= 2 ? 3 : years <= 3 ? 4 : 5;
  }
  function matrixValue(r, metric) {
    const value = ({ yield:'ytm', sm:'simple_margin_bp', cy:'current_yield',
      gspread:'g_spread_bp', dm:'dm_ofz_bp', z:'z_spread_bp' })[metric];
    if (!value || (metric === 'yield' && r.kind === 'floater') || (metric === 'sm' && r.kind !== 'floater')) return null;
    const n = r[value];
    return n != null && n !== '' && Number.isFinite(Number(n)) ? Number(n) : null;
  }
  function buildMatrix(rows, metric, asOf) {
    const cells = new Map();
    let omitted = 0;
    for (const r of rows) {
      const bucket = matrixBucket(matrixHorizon(r, asOf)), value = matrixValue(r, metric);
      if (bucket == null || value == null) { omitted++; continue; }
      const rating = r.rating_bucket || r.agency_bucket || 'NR';
      const key = `${matrixRatings.includes(rating) ? rating : 'NR'}:${bucket}`;
      if (!cells.has(key)) cells.set(key, { rows:[], values:[] });
      const cell = cells.get(key); cell.rows.push(r); cell.values.push(value);
    }
    cells.forEach(cell => {
      cell.values.sort((a,b) => a-b);
      const n = cell.values.length, mid = Math.floor(n/2);
      cell.median = n % 2 ? cell.values[mid] : (cell.values[mid-1] + cell.values[mid]) / 2;
      cell.rows.sort((a,b) => (b.volume || 0) - (a.volume || 0));
    });
    return { cells, omitted };
  }
  function matrixMetrics() {
    const options = matrixState.kind === 'fixed' ? [['yield','YTM, %'],['cy','Текущая доходность, %'],['gspread','G-спред, б.п.'],['z','Z-спред, б.п.']]
      : matrixState.kind === 'floater' ? [['sm','Simple margin, б.п.'],['cy','Текущая доходность, %'],['dm','DM к ОФЗ, б.п.'],['z','Z-спред, б.п.']]
      : [['cy','Текущая доходность, %'],['z','Z-спред, б.п.']];
    return matrixState.ccy === 'RUB' ? options : options.filter(([k]) => !['gspread','dm','z'].includes(k));
  }
  function metricPresentation(key) {
    return ({
      yield:{title:'YTM',unit:'%',hint:'До погашения или оферты'},
      sm:{title:'Simple margin',unit:'б.п.',hint:'Премия к своему индексу с учётом цены'},
      cy:{title:'Текущая доходность',unit:'%',hint:'Годовой купон относительно цены'},
      gspread:{title:'G-спред',unit:'б.п.',hint:'Премия к кривой доходности ОФЗ'},
      dm:{title:'DM к ОФЗ',unit:'б.п.',hint:'Премия к сопоставимому ОФЗ-флоатеру'},
      z:{title:'Z-спред',unit:'б.п.',hint:'Премия к кривой RUONIA OIS'}
    })[key] || {title:'Показатель',unit:'',hint:''};
  }
  let dropdownScrollState = null;
  function lockDropdownScroll(dialog) {
    if (!dropdownScrollState) {
      const body = document.body, html = document.documentElement;
      const props = ['position','top','left','right','width','overflow'];
      dropdownScrollState = {dialogs:new Set(),x:window.scrollX,y:window.scrollY,
        body:Object.fromEntries(props.map(key=>[key,body.style[key]])),overflow:html.style.overflow};
      Object.assign(body.style,{position:'fixed',top:`-${dropdownScrollState.y}px`,left:`-${dropdownScrollState.x}px`,right:'0',width:'100%',overflow:'hidden'});
      html.style.overflow = 'hidden';
    }
    const saved = dropdownScrollState;
    saved.dialogs.add(dialog);
    let released = false;
    const observer = new MutationObserver(()=>{ if (!dialog.isConnected) release(); });
    const release = () => {
      if (released) return;
      released = true; observer.disconnect(); saved.dialogs.delete(dialog);
      if (saved.dialogs.size || dropdownScrollState !== saved) return;
      dropdownScrollState = null;
      Object.assign(document.body.style,saved.body);
      const html = document.documentElement, behavior = html.style.scrollBehavior;
      html.style.overflow = saved.overflow; html.style.scrollBehavior = 'auto';
      window.scrollTo({left:saved.x,top:saved.y,behavior:'instant'});
      html.style.scrollBehavior = behavior;
    };
    observer.observe(document.body,{childList:true,subtree:true});
    dialog.addEventListener('close',release,{once:true});
    dialog.addEventListener('cancel',release,{once:true});
    return release;
  }
  function metricDropdown(root, trigger, choose, config = {}) {
    root.querySelector('.matrix-metric-menu')?.remove();
    const label = config.label || 'Показатель матрицы';
    const options = config.options || matrixMetrics().map(([key]) => ({key,...metricPresentation(key)}));
    const d = el(`<dialog class="matrix-metric-menu" aria-label="${escA(label)}"><div class="matrix-metric-label">${escA(config.caption || 'Что показать на карте')}</div><div role="radiogroup" aria-label="${escA(label)}">${options.map(m => {
      const k = m.key, checked = (config.selected ?? matrixState.metric) === k;
      return `<button type="button" class="matrix-metric-option" data-metric="${escA(k)}" role="radio" ${m.disabled ? 'disabled' : ''} aria-checked="${checked}" aria-description="${escA(m.hint || '')}" title="${escA(m.hint || '')}"><span class="matrix-metric-copy"><span class="matrix-metric-name">${escA(m.title)}<small>${escA(m.unit || '')}</small></span></span><span class="matrix-metric-tick" aria-hidden="true">${checked ? '✓' : ''}</span></button>`;
    }).join('')}</div><button type="button" class="matrix-metric-cancel">Закрыть</button></dialog>`);
    root.append(d);
    const rect = trigger.getBoundingClientRect(), width = Math.min(innerWidth - 24,Math.max(config.minWidth || 240,rect.width),320);
    d.style.width = width + 'px';
    d.style.left = Math.max(14,Math.min(rect.left,innerWidth - width - 14)) + 'px';
    // Keep it a dropdown next to its trigger, including when the page is scrolled.
    d.style.top = '12px';
    d.style.maxHeight = Math.max(100,innerHeight - 24) + 'px';
    trigger.setAttribute('aria-expanded','true');
    const releaseScroll = lockDropdownScroll(d);
    const close = () => { releaseScroll(); d.close(); };
    d.addEventListener('close', () => { releaseScroll(); trigger.setAttribute('aria-expanded','false'); d.remove(); if (trigger.isConnected) trigger.focus({preventScroll:true}); });
    d.addEventListener('click', e => { if (e.target === d) close(); });
    d.querySelector('.matrix-metric-cancel').onclick = close;
    const buttons = [...d.querySelectorAll('[data-metric]:not(:disabled)')];
    buttons.forEach((b,i) => {
      b.onclick = () => { close(); choose(b.dataset.metric); };
      b.onkeydown = e => {
        let next = i;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i+1) % buttons.length;
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i+buttons.length-1) % buttons.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = buttons.length-1;
        else return;
        e.preventDefault(); buttons[next].focus();
      };
    });
    try { d.showModal(); } catch (error) { releaseScroll(); d.remove(); throw error; }
    const height = d.offsetHeight;
    d.style.top = Math.max(12,Math.min(rect.bottom + 5 + height <= innerHeight - 12 ? rect.bottom + 5 : rect.top - height - 5,innerHeight - height - 12)) + 'px';
    (d.querySelector('[aria-checked=true]:not(:disabled)') || buttons[0])?.focus({preventScroll:true});
  }
  function matrixFilterCount() {
    return ['sector','vol','freq','offer','amort'].filter(k => matrixState[k]).length + Number(!matrixState.clean);
  }
  function matrixFilters(root) {
    root.querySelector('.matrix-filter-dialog')?.remove();
    const s = matrixState;
    const d = el(`<dialog class="mobile-filter-dialog matrix-filter-dialog" aria-label="Фильтры матрицы"><div class="mobile-sheet-head"><h2>Фильтры</h2><button type="button" aria-label="Закрыть фильтры">×</button></div><div class="mobile-filter-body matrix-filter-fields">
      <label>Сектор<select name="sector"><option value="">Все секторы</option>${(UNI.facets?.sectors || []).map(v => `<option value="${escA(v)}" ${s.sector === v ? 'selected' : ''}>${escA(v)}</option>`).join('')}</select></label>
      <label>Средний оборот, от млн ₽/д<input name="vol" type="number" min="0" step="0.1" inputmode="decimal" placeholder="Любой" value="${escA(s.vol)}"></label>
      <label>Частота купона<select name="freq"><option value="">Любая</option>${[['12','Ежемесячно'],['4','Ежеквартально'],['2','Раз в полгода'],['1','Ежегодно']].map(([k,l]) => `<option value="${k}" ${s.freq === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="matrix-check"><input name="offer" type="checkbox" ${s.offer ? 'checked' : ''}>Только с офертой / коллом</label>
      <label class="matrix-check"><input name="amort" type="checkbox" ${s.amort ? 'checked' : ''}>С амортизацией</label>
      <label class="matrix-check"><input name="clean" type="checkbox" ${s.clean ? 'checked' : ''}>Скрыть аномалии и неликвид</label>
      <p class="matrix-note">Рейтинг и срок выбираются нажатием на квадрат. Валюта и тип купона — над матрицей.</p></div><div class="mobile-sheet-foot"><button type="button" class="btn ghost" data-reset>Сбросить</button><button type="button" class="btn" data-apply>Применить</button></div></dialog>`);
    root.append(d);
    d.querySelector('[aria-label="Закрыть фильтры"]').onclick = () => d.close();
    d.querySelector('[data-reset]').onclick = () => {
      Object.assign(s,{sector:'',vol:'',freq:'',offer:false,amort:false,clean:true,selection:null});
      d.close(); render();
    };
    d.querySelector('[data-apply]').onclick = () => {
      for (const k of ['sector','vol','freq']) s[k] = d.querySelector(`[name=${k}]`).value;
      for (const k of ['offer','amort','clean']) s[k] = d.querySelector(`[name=${k}]`).checked;
      s.selection = null; d.close(); render();
    };
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    d.showModal();
  }
  async function marketMap(v) {
    const s = matrixState, request = ++s.request;
    if (!matrixMetrics().some(([k]) => k === s.metric)) s.metric = s.kind === 'fixed' ? 'yield' : s.kind === 'floater' ? 'sm' : 'cy';
    const root = el('<section class="mobile-matrix-page"><h2>Карта облигаций</h2></section>');
    v.append(root);
    const search = el(`<div class="field matrix-issuer-picker"><input type="search" role="combobox" aria-label="Выбрать эмитентов" aria-autocomplete="list" aria-controls="matrix-issuer-options" aria-expanded="false" autocomplete="off" placeholder="Выберите эмитентов" value="${escA(s.search)}" disabled><div class="matrix-issuer-menu" hidden><div class="matrix-issuer-caption">Можно выбрать несколько · по текущим фильтрам</div><div id="matrix-issuer-options" role="listbox" aria-label="Эмитенты" aria-multiselectable="true"></div></div><div class="matrix-issuer-tags" aria-label="Выбранные эмитенты"></div><span class="sr-only matrix-issuer-status" role="status"></span></div>`);
    const currencies = [...new Set(['RUB',...(UNI.facets?.currencies || []),s.ccy])];
    const tools = el(`<div class="matrix-tools"><div class="mobile-quick" aria-label="Тип купона карты">${[['fixed','Фикс'],['floater','Флоатеры'],['all','Все']].map(([k,l]) => `<button type="button" data-k="${k}" aria-pressed="${s.kind === k}">${l}</button>`).join('')}</div><button type="button" class="matrix-currency-trigger" aria-label="Валюта карты: ${escA(s.ccy)}" aria-haspopup="dialog" aria-expanded="false"><span>${escA(s.ccy)}</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div>`);
    const displayMetric = metricPresentation(s.metric);
    const heading = el(`<div class="matrix-heading"><button type="button" class="matrix-metric-trigger" aria-label="Выбрать показатель: ${displayMetric.title}, ${displayMetric.unit}" aria-haspopup="dialog" aria-expanded="false"><span><strong>${displayMetric.title}</strong><small>${displayMetric.hint}</small></span><span class="matrix-metric-unit">${displayMetric.unit}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><button type="button" class="matrix-filter-trigger" aria-label="Фильтры карты">${icon('filter')}${matrixFilterCount() ? `<b>${matrixFilterCount()}</b>` : ''}</button></div>`);
    root.append(search, tools, heading);
    const body = el('<div class="matrix-body"><div class="loading">Загружаю матрицу…</div></div>'); root.append(body);
    const update = () => { s.selection = null; s.limit = 30; render(); };
    tools.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { s.kind = b.dataset.k; update(); });
    const currencyTrigger = tools.querySelector('.matrix-currency-trigger');
    currencyTrigger.onclick = () => metricDropdown(root,currencyTrigger,key => { s.ccy = key; update(); },{
      label:'Валюта карты',caption:'Валюта',selected:s.ccy,minWidth:200,
      options:currencies.map(key => ({key,title:key,unit:({RUB:'Рубли',USD:'Доллары США',EUR:'Евро',CNY:'Юани',CHF:'Швейцарские франки'})[key] || ''}))
    });
    const metricTrigger = heading.querySelector('.matrix-metric-trigger');
    metricTrigger.onclick = () => metricDropdown(root,metricTrigger,key => { s.metric = key; update(); });
    heading.querySelector('.matrix-filter-trigger').onclick = () => matrixFilters(root);
    const qp = new URLSearchParams({limit:'5000',sort:'volume',desc:'true',currencies:s.ccy});
    if (s.kind !== 'all') qp.set('kinds',s.kind);
    else qp.set('kinds','fixed,floater');
    if (s.clean) qp.set('clean','true');
    if (s.sector) qp.set('sectors',s.sector);
    if (s.vol !== '') qp.set('vol_min',Math.max(0,Number(s.vol) || 0) * 1e6);
    if (s.freq) qp.set('coupon_freq',s.freq);
    if (s.offer) qp.set('has_offer','true');
    if (s.amort) qp.set('amort','true');
    const key = qp.toString();
    try {
      const data = await MARKET_REQUESTS.get(`/api/universe?${key}`);
      if (!Array.isArray(data.rows)) throw new Error('rows');
      if (!root.isConnected || request !== s.request || TAB !== 'marketmap') return;
      let built;
      const isPct = ['yield','cy'].includes(s.metric);
      const title = Object.fromEntries(matrixMetrics())[s.metric];
      const selectCell = key => {
        s.selection = key; s.limit = 30;
        body.querySelectorAll('[data-cell]').forEach(b => b.setAttribute('aria-pressed',String(s.selection === b.dataset.cell)));
        drawResults();
      };
      const drawResults = () => {
        const results = body.querySelector('.matrix-results');
        results.replaceChildren();
        const selected = built.cells.get(s.selection);
        if (selected) {
          const [r,b] = s.selection.split(':');
          const selectedTitle = el(`<div class="matrix-selection"><div><b>${r} · ${matrixTerms[Number(b)]}</b><small>${selected.rows.length} выпусков · медиана ${fmt(selected.median,isPct ? 2 : 0)} ${isPct ? '%' : 'б.п.'}</small></div><button type="button" aria-label="Снять выбор ячейки">×</button></div>`);
          results.append(selectedTitle, bondList(selected.rows.slice(0,s.limit), selected.rows.length, 'По ликвидности',s.metric));
          selectedTitle.querySelector('button').onclick = () => selectCell(null);
          if (selected.rows.length > s.limit) {
            const more = el('<button type="button" class="matrix-expand">Ещё выпуски</button>');
            more.onclick = () => { s.limit += 30; drawResults(); }; results.append(more);
          }
        } else if (s.issuers.length) {
          const rows = matrixIssuerResults(data.rows,s.issuers);
          results.append(el(`<div class="matrix-selection"><div><b>Выпуски выбранных эмитентов</b><small>${rows.length} выпусков · по текущим фильтрам</small></div></div>`));
          if (rows.length) {
            results.append(bondList(rows.slice(0,s.limit),rows.length,'По ликвидности',s.metric));
            if (rows.length > s.limit) {
              const more = el('<button type="button" class="matrix-expand">Ещё выпуски</button>');
              more.onclick = () => { s.limit += 30; drawResults(); }; results.append(more);
            }
          } else results.append(el('<p class="matrix-invite">У выбранных эмитентов нет выпусков по текущим фильтрам. Измените тип, валюту или фильтры.</p>'));
        } else {
          results.innerHTML = `<p class="matrix-invite">${built.cells.size ? 'Нажмите на квадрат, чтобы увидеть выпуски.' : 'По этим условиям нет данных. Измените тип, валюту или фильтры.'}</p>`;
        }
      };
      const draw = () => {
        const rows = matrixIssuerRows(data.rows,s.issuers);
        built = buildMatrix(rows, s.metric);
        const ratings = s.expanded ? matrixRatings : matrixRatings.slice(0,6);
        const allValues = [...built.cells.values()].map(c => c.median).sort((a,b) => a-b);
        const rank = val => allValues.length < 2 ? .25 : allValues.filter(x => x < val).length / (allValues.length - 1);
        body.innerHTML = `<div class="matrix-surface"><div class="matrix-subtitle">Рейтинг × срок до события</div><div class="matrix-grid" role="group" aria-label="Матрица ${escA(title)}"><span></span>${matrixTerms.map(t => `<span class="matrix-col">${t}</span>`).join('')}${ratings.map(rating => `<span class="matrix-row">${rating === 'NR' ? 'Без р.' : rating}</span>${matrixTerms.map((t,b) => {
          const key = `${rating}:${b}`, c = built.cells.get(key);
          const val = c ? fmt(c.median,isPct ? 2 : 0) : '—';
          return `<button type="button" class="matrix-cell" data-cell="${key}" ${!c ? 'disabled' : ''} aria-pressed="${s.selection === key}" aria-label="${rating}, ${t}: ${c ? `${val} ${isPct ? 'процентов' : 'базисных пунктов'}, выпусков ${c.rows.length}` : 'нет данных'}" style="--cell-alpha:${c ? (.07 + rank(c.median) * .32).toFixed(3) : 0};${val.length > 6 ? 'font-size:10px' : ''}">${val}</button>`;
        }).join('')}`).join('')}</div><button type="button" class="matrix-expand">${s.expanded ? 'Основные рейтинги ▴' : 'Все рейтинги ▾'}</button><p class="matrix-note">В ячейке — медиана. Темнее — выше значение, не оценка надёжности.</p></div><div class="matrix-results"></div><details class="matrix-method"><summary>Как читать карту</summary><p>Столбцы — до 3 и 6 месяцев, до 1, 2, 3 лет и свыше 3 лет. Используется дата оферты или колла из расчёта выпуска, иначе дата погашения. Это срок, не дюрация.</p><p>Медиана — середина значений выпусков группы, без весов. Показатель ${escA(title)} рассчитан платформой; у флоатеров YTM не показываем. Нажмите ячейку для точных значений каждого выпуска. Прочерк означает отсутствие данных, а не нулевую доходность.</p><p>Снимок: ${escA(data.updated_at ? snapTime(data.updated_at) : 'дата не получена')}. ${built.omitted ? `Без доступного показателя или будущей даты: ${built.omitted}.` : ''}${data.total > data.rows.length ? ` Загружено ${data.rows.length} из ${data.total}.` : ''}</p></details>`;
        body.querySelector('.matrix-expand').onclick = () => { s.expanded = !s.expanded; draw(); };
        drawResults();
        body.querySelectorAll('[data-cell]:not(:disabled)').forEach(b => b.onclick = () => {
          selectCell(s.selection === b.dataset.cell ? null : b.dataset.cell);
        });
      };
      const input = search.querySelector('input'), menu = search.querySelector('.matrix-issuer-menu');
      const options = search.querySelector('[role=listbox]'), tags = search.querySelector('.matrix-issuer-tags');
      let active = -1, matches = [];
      const closeMenu = () => { menu.hidden = true; input.setAttribute('aria-expanded','false'); input.removeAttribute('aria-activedescendant'); active = -1; };
      const setActive = index => {
        active = index;
        options.querySelectorAll('[role=option]').forEach((option,i) => option.classList.toggle('active',i === active));
        if (active >= 0) input.setAttribute('aria-activedescendant',`matrix-issuer-${active}`);
        else input.removeAttribute('aria-activedescendant');
      };
      const drawTags = () => {
        tags.innerHTML = s.issuers.map((issuer,i) => `<button type="button" data-remove="${i}" aria-label="Убрать эмитента ${escA(issuer.name)}"><span>${escA(issuer.name)}</span><span aria-hidden="true">×</span></button>`).join('');
        tags.querySelectorAll('[data-remove]').forEach(button => button.onclick = () => {
          s.issuers.splice(Number(button.dataset.remove),1); changed(); input.focus({preventScroll:true});
        });
      };
      const drawOptions = () => {
        matches = matrixIssuers(data.rows,s.search);
        options.innerHTML = matches.map((issuer,i) => `<button type="button" role="option" id="matrix-issuer-${i}" data-issuer="${i}" aria-selected="${s.issuers.some(item => item.key === issuer.key)}"><span>${escA(issuer.name)}<small>${issuer.count} вып.</small></span><span class="matrix-issuer-check" aria-hidden="true">${s.issuers.some(item => item.key === issuer.key) ? '✓' : '+'}</span></button>`).join('') || '<p class="matrix-issuer-empty">Эмитенты не найдены по текущим фильтрам</p>';
        setActive(-1);
        options.querySelectorAll('[data-issuer]').forEach(button => {
          button.onmousedown = e => e.preventDefault();
          button.onclick = () => chooseIssuer(Number(button.dataset.issuer));
        });
      };
      const changed = () => {
        s.selection = null; s.limit = 30; drawTags(); drawOptions(); draw();
        search.querySelector('[role=status]').textContent = s.issuers.length ? `Выбрано эмитентов: ${s.issuers.length}` : 'Все эмитенты';
      };
      const openMenu = () => { drawOptions(); menu.hidden = false; input.setAttribute('aria-expanded','true'); };
      const chooseIssuer = index => {
        const issuer = matches[index]; if (!issuer) return;
        const existing = s.issuers.findIndex(item => item.key === issuer.key);
        if (existing >= 0) s.issuers.splice(existing,1);
        else s.issuers.push({key:issuer.key,name:issuer.name});
        s.search = ''; input.value = ''; changed(); input.focus({preventScroll:true});
      };
      input.disabled = false;
      input.onfocus = openMenu;
      input.onclick = () => { if (menu.hidden) openMenu(); };
      input.oninput = e => { s.search = e.target.value; openMenu(); };
      input.onkeydown = e => {
        if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); if (menu.hidden) openMenu();
          if (matches.length) {
            setActive(active < 0 ? (e.key === 'ArrowDown' ? 0 : matches.length - 1) : (active + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
            const option = options.children[active];
            if (option.offsetTop < options.scrollTop) options.scrollTop = option.offsetTop;
            else if (option.offsetTop + option.offsetHeight > options.scrollTop + options.clientHeight) options.scrollTop = option.offsetTop + option.offsetHeight - options.clientHeight;
          }
        } else if (e.key === 'Enter' && !menu.hidden) { e.preventDefault(); if (active >= 0) chooseIssuer(active); }
      };
      search.addEventListener('focusout',e => { if (!search.contains(e.relatedTarget)) closeMenu(); });
      root.addEventListener('pointerdown',e => { if (!search.contains(e.target)) closeMenu(); });
      search.addEventListener('keydown',e => { if (e.key === 'Escape' && e.target !== input) { e.preventDefault(); input.focus({preventScroll:true}); closeMenu(); } });
      drawTags();
      draw();
    } catch (e) {
      if (root.isConnected && request === s.request) {
        body.innerHTML = '<div class="mobile-empty"><h3>Не удалось загрузить карту</h3><p>Проверьте подключение и повторите загрузку.</p><button type="button" class="btn ghost">Повторить</button></div>';
        body.querySelector('button').onclick = () => { MARKET_REQUESTS.clear(); render(); };
      }
    }
  }
  function indexCaption(asset,view,period) {
    if (asset === 'bonds' && view === 'yield') return `YTM базы, % годовых · изменение за ${period}`;
    if (view === 'base100') return `100 на старте · результат за ${period}`;
    if (view === 'yield') return `Накопленная доходность · за ${period}`;
    return `Официальные пункты MOEX · результат за ${period}`;
  }
  function indices(v) {
    if (!isPhone()) return;
    const hero = v.querySelector('.idx-hero'), panel = v.querySelector('.idx-main');
    if (!hero || !panel) return;
    if (!hero.classList.contains('mobile-index-layout')) {
      hero.classList.add('mobile-index-layout');
      const heading = hero.querySelector('.idx-heading');
      heading.querySelector('h2').textContent = 'Индексы';
      hero.prepend(heading);
      hero.querySelectorAll('.chip').forEach(c => {
        c.setAttribute('role','button'); c.tabIndex = 0;
        c.setAttribute('aria-pressed',String(c.classList.contains('on')));
        c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); } };
      });
      hero.querySelectorAll('[data-asset]').forEach(b => b.setAttribute('aria-pressed',String(b.classList.contains('on'))));
      const period = Object.fromEntries(INDEX_PERIODS)[INDEX_PAGE.period] || INDEX_PAGE.period;
      panel.querySelector('.idx-chart-head h3').textContent = INDEX_PAGE.asset === 'bonds' && INDEX_PAGE.view === 'yield' ? 'Доходность индексной базы' : 'Динамика индексов';
      panel.querySelector('.idx-chart-head .muted').textContent = indexCaption(INDEX_PAGE.asset,INDEX_PAGE.view,period);
      const chart = panel.querySelector('#idx-chart'), cards = panel.querySelector('#idx-cards');
      const chartHint = el('<p class="mobile-index-chart-hint">Нажмите на название в легенде, чтобы скрыть или вернуть линию.</p>');
      const cardHeading = el(`<div class="mobile-index-card-heading"><b>${INDEX_PAGE.asset === 'bonds' && INDEX_PAGE.view === 'yield' ? 'Доходность и состав' : 'Значения и состав'}</b><span>${INDEX_PAGE.view === 'base100' ? 'уровни — в пунктах MOEX' : 'на последнюю сессию'}</span></div>`);
      chart.after(chartHint,cardHeading,cards);
      const guide = panel.querySelector('#idx-guide');
      const guideDetails = el('<details class="mobile-index-details"><summary>Что стоит за индексами</summary></details>');
      guide.before(guideDetails); guideDetails.append(guide);
      const table = v.querySelector('.idx-table');
      if (table) {
        const details = el('<details class="mobile-index-details mobile-index-table"><summary>Подробная таблица</summary></details>');
        table.before(details); details.append(table);
      }
      // Active tabs in scroll rails must be discoverable when switching families.
      hero.querySelectorAll('#idx-group, #idx-period').forEach(rail => {
        const active = rail.querySelector('.on');
        if (active) rail.scrollLeft = Math.max(0,active.offsetLeft + active.offsetWidth - rail.offsetLeft - rail.clientWidth + 12);
      });
    }
    const note = v.querySelector('.idx-note');
    if (note && !note.closest('.mobile-index-details')) {
      const details = el('<details class="mobile-index-details mobile-index-method"><summary>Методика и источники</summary></details>');
      note.before(details); details.append(note);
    }
    v.querySelectorAll('.mobile-index-table').forEach(d => { if (!d.querySelector('.idx-table')) d.remove(); });
  }
  function ideaRows(data, filters, basis, side) {
    const key = basis === 'history' ? (side === 'wide' ? 'high_pctl' : 'low_pctl')
      : basis === 'rating' ? (side === 'wide' ? 'vs_cheap' : 'vs_rich')
      : (side === 'wide' ? 'intra_cheap' : 'intra_rich');
    const rows = (data[key] || []).filter(row => (filters.kind === 'all' || row.kind === filters.kind)
      && (row.currency || 'RUB') === filters.ccy && (!filters.rating.size || filters.rating.has(row.rating_bucket)));
    const field = basis === 'history' ? 'spread_pctl' : filters.sortField;
    const desc = basis === 'history' ? side === 'wide' : filters.sortDesc;
    return rows.sort((a,b) => {
      if (a[field] == null) return b[field] == null ? 0 : 1;
      if (b[field] == null) return -1;
      return desc ? b[field] - a[field] : a[field] - b[field];
    });
  }
  function ideas(host, data) {
    state.ideaBasis ||= 'issuer'; state.ideaSide ||= 'wide'; state.ideaLimit ||= 10;
    const basisNames = {issuer:'С эмитентом',rating:'С рейтингом',history:'Со своей историей'};
    const root = el(`<section class="phone-ideas"><p class="phone-ideas-intro">Сравниваем премию за риск, а для валютных фиксов — YTM. Более высокая премия может означать и более высокий риск.</p><div class="phone-idea-basis" role="group" aria-label="С чем сравнить">${Object.entries(basisNames).map(([key,label]) => `<button type="button" data-basis="${key}" aria-pressed="${state.ideaBasis === key}">${label}</button>`).join('')}</div><div class="phone-idea-side" role="group" aria-label="Направление премии">${[['wide','Премия выше'],['narrow','Премия ниже']].map(([key,label])=>`<button type="button" data-side="${key}" aria-pressed="${state.ideaSide === key}">${label}</button>`).join('')}</div><p class="phone-idea-explanation"></p><div class="phone-idea-sort"></div><div class="phone-idea-list"></div><button type="button" class="matrix-expand phone-idea-more">Ещё 10</button><details class="phone-idea-method"><summary>Что означают показатели</summary><p>Премия — G-спред к кривой ОФЗ у фиксов, Simple margin у флоатеров. Для валютных фиксов сравнивается YTM в б.п. 100 б.п. = 1 процентный пункт.</p><p>Сравнение с эмитентом или рейтингом — отклонение от медианы своей группы по методике платформы. История — положение премии среди доступных прошлых наблюдений: 90 означает, что она выше примерно 90% наблюдений. Это не доходность и не вероятность заработка.</p><p>Сигнал не учитывает все различия сроков, ликвидности и кредитного риска. Откройте выпуск для проверки. Расчёты не являются рекомендацией купить или продать.</p></details></section>`);
    host.replaceChildren(root);
    const draw = () => {
      const basis = state.ideaBasis, history = basis === 'history', wide = state.ideaSide === 'wide';
      const rows = ideaRows(data,IDEAS,basis,state.ideaSide);
      const measure = IDEAS.ccy === 'RUB' ? 'Премия' : 'Показатель';
      root.querySelectorAll('[data-side]').forEach(b=>{ b.textContent = `${measure} ${b.dataset.side === 'wide' ? 'выше' : 'ниже'}`; });
      root.querySelectorAll('[data-basis]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.basis === basis)));
      root.querySelectorAll('[data-side]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.side === state.ideaSide)));
      root.querySelector('.phone-idea-explanation').textContent = history
        ? (wide ? 'Премия выше обычной для этой бумаги: исторический перцентиль ≥ 80.' : 'Премия ниже обычной для этой бумаги: исторический перцентиль ≤ 20.')
        : `Премия ${wide ? 'выше' : 'ниже'} медианы ${basis === 'issuer' ? 'выпусков того же эмитента' : 'своей рейтинговой группы'}. Это повод проверить причину отклонения.`;
      const sort = root.querySelector('.phone-idea-sort');
      sort.innerHTML = `<span>${rows.length} выпусков</span>${history ? '<span>По перцентилю</span>' : `<button type="button" aria-label="Изменить сортировку идей">${IDEAS.sortField === 'metric_bp' ? 'По премии' : 'По отклонению'} ${IDEAS.sortDesc ? '↓' : '↑'}</button>`}`;
      const sortButton = sort.querySelector('button');
      if (sortButton) sortButton.onclick = () => metricDropdown(root,sortButton,key=>{
        const [field,dir] = key.split(':'); IDEAS.sortField = field; IDEAS.sortDesc = dir === 'desc'; state.ideaLimit=10; draw();
      },{label:'Сортировка идей',caption:'Сортировка',selected:`${IDEAS.sortField}:${IDEAS.sortDesc ? 'desc' : 'asc'}`,options:[
        {key:'deviation_bp:desc',title:'Отклонение: по убыванию'}, {key:'deviation_bp:asc',title:'Отклонение: по возрастанию'},
        {key:'metric_bp:desc',title:'Премия: по убыванию'}, {key:'metric_bp:asc',title:'Премия: по возрастанию'}]});
      const list = root.querySelector('.phone-idea-list'); list.replaceChildren();
      for (const row of rows.slice(0,state.ideaLimit)) {
        const metric = {SM:'Simple margin',G:'G-спред',Y:'Доходность, б.п.'}[row.metric_kind] || 'Премия';
        const median = row[basis === 'issuer' ? 'issuer_median_bp' : 'bucket_median_bp'];
        const card = el(`<article class="phone-idea-card"><button type="button" class="phone-idea-open" aria-label="Открыть ${escA(row.name || row.isin)}"><span class="phone-idea-title">${escA(row.name || row.isin)}<span aria-hidden="true">›</span></span><span class="phone-idea-issuer">${escA(row.issuer || row.isin)}</span></button><div class="phone-idea-tags">${ratingPill(row)}<span>${escA(KIND_RU[row.kind] || '')} · ${escA(row.currency || 'RUB')}</span></div><div class="phone-idea-values"><div><small>${escA(metric)}</small><b>${bp(row.metric_bp)}</b></div><div><small>${history ? 'Историч. перцентиль' : 'Медиана ' + (basis === 'issuer' ? 'эмитента' : 'рейтинга')}</small><b>${history ? (row.spread_pctl == null ? '—' : fmt(row.spread_pctl,0) + ' / 100') : bp(median)}</b></div>${history ? '' : `<div><small>Отклонение</small><b>${bp(row.deviation_bp)}</b></div>`}</div>${row.liq_warn ? `<p class="phone-idea-warning">Часть отклонения может объясняться низкой ликвидностью.</p>` : ''}<details class="phone-idea-detail"><summary>Детали сравнения</summary><p>${escA(row.isin)}${row.peer_n != null && !history ? ` · ${fmt(row.peer_n,0)} сопоставимых выпусков` : ''}</p>${!history ? `<p>Сопоставимый срок ±0,3 года; сравнение отдельно по типу купона и валюте.</p>` : ''}${row.liq_warn ? `<p>Поправка на ликвидность: ${bp(row.liq_penalty_bp)}. Отклонение после поправки: ${bp(row.liq_adjusted_bp)}.</p>` : ''}</details></article>`);
        card.querySelector('button').onclick = () => openIssue(row.isin); list.append(card);
      }
      if (!rows.length) list.innerHTML = '<div class="mobile-empty"><h3>Нет подходящих идей</h3><p>Попробуйте другое сравнение или смягчите фильтры рейтинга, типа, валюты и оборота.</p></div>';
      const more = root.querySelector('.phone-idea-more'); more.hidden = rows.length <= state.ideaLimit;
      more.textContent = `Ещё ${Math.min(10,Math.max(0,rows.length-state.ideaLimit))} · показано ${Math.min(state.ideaLimit,rows.length)} из ${rows.length}`;
    };
    root.querySelectorAll('[data-basis]').forEach(b=>b.onclick=()=>{state.ideaBasis=b.dataset.basis;state.ideaLimit=10;draw();});
    root.querySelectorAll('[data-side]').forEach(b=>b.onclick=()=>{state.ideaSide=b.dataset.side;state.ideaLimit=10;draw();});
    root.querySelector('.phone-idea-more').onclick=()=>{state.ideaLimit+=10;draw();};
    draw();
  }
  const pageTitles = {macro:'Макро',movers:'Динамика рынка',ideas:'Идеи',sandbox:'Песочница',placements:'Первичный рынок',auctions:'ОФЗ',issuers:'Аналитика эмитентов'};
  function startView(v, tab) {
    if (isPhone() && pageTitles[tab]) v.append(el(`<div class="mobile-page-heading"><h2>${pageTitles[tab]}</h2><span>Аналитика BondsAI</span></div>`));
  }
  function compactNav(nodes, label) {
    if (!nodes.length || nodes[0].parentElement.dataset.mobileNav) return;
    const original = nodes[0].parentElement;
    original.dataset.mobileNav = 'true';
    const field = el('<label class="mobile-section-select"><span></span><select></select></label>');
    field.querySelector('span').textContent = label;
    const select = field.querySelector('select'); select.setAttribute('aria-label',label);
    nodes.forEach((n,i) => {
      const option = new Option(n.textContent.trim(),String(i),false,n.classList.contains('on'));
      select.append(option);
    });
    select.onchange = () => nodes[Number(select.value)]?.click();
    original.before(field); original.classList.add('mobile-original-nav');
  }
  function accessibleChips(v) {
    v.querySelectorAll('.chip:not(.chip-off),[data-goto],.mc-info,.info-i').forEach(c => {
      if (c.tagName === 'BUTTON' || c.closest('.mobile-table-detail')) return;
      c.tabIndex = 0; c.setAttribute('role','button');
      if (c.classList.contains('chip')) c.setAttribute('aria-pressed',String(c.classList.contains('on')));
      if (c.matches('.mc-info,.info-i')) c.setAttribute('aria-label','Пояснение показателя');
      if (!c.dataset.mobileKeyboard) {
        c.dataset.mobileKeyboard = 'true';
        c.addEventListener('keydown',e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); } });
        c.addEventListener('click',() => queueMicrotask(() => {
          c.parentElement?.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed',String(x.classList.contains('on'))));
        }));
      }
    });
  }
  function macroLayout(v) {
    compactNav([...v.querySelectorAll('[data-sub]')],'Раздел Макро');
    const cards = [...v.querySelectorAll('[data-goto]')];
    if (cards.length) cards[0].parentElement.classList.add('mobile-macro-grid');
    v.querySelectorAll('h3').forEach(h => {
      if (h.parentElement.querySelector('.chart')) h.parentElement.classList.add('mobile-chart-panel');
    });
  }
  // A phone summary is a second presentation of the existing table, not a
  // second data model. Editable tables stay untouched. Originals retain all
  // sorting, links, financial inputs and precise source values in a disclosure.
  function phoneMetricPriority(label, issuer = false) {
    if (issuer) return /корп|покрытие.*эскроу/i.test(label) ? 70 : /ICR|покрыт/i.test(label) ? 95 : /EBITDA.*долг|долг.*EBITDA|ЧД|ND\/|эскроу|Н1\.0|достаточ/i.test(label) ? 100 : /премия|спред/i.test(label) ? 93 : /маржа|ROE/i.test(label) ? 80 : 0;
    return /YTM|Доходность|Simple|SM|Цена/i.test(label) ? 100 : /Дата|Погаш|Срок|Дюр|Купон|Размещено/i.test(label) ? 80 : 0;
  }
  function tableCards(table, readonly = false) {
    if (table.dataset.mobileCards || table.querySelector('input,select,textarea,button')) return;
    const headers = [...table.querySelectorAll('thead th')];
    const rows = [...table.querySelectorAll('tbody tr')];
    if (headers.length < 4 || !rows.length || (!readonly && !rows.some(r => r.matches('[data-isin],[data-comp],[data-tk]')))) return;
    table.dataset.mobileCards = 'true';
    const nameIndex = Math.max(0,headers.findIndex(h => /Выпуск|Эмитент|Компания|Бумага|Группа/i.test(h.textContent)));
    const labels = headers.map(h => h.textContent.replace(/[↕↥↧↑↓▲▼▾▴⇅]/g,'').trim());
    const sandboxTable = !!table.closest('#sb-set');
    const issuerTable = rows.some(row=>row.matches('[data-comp],[data-tk]'));
    const ratingIndex = labels.findIndex(label=>/Рейт/i.test(label));
    const oldDetail = table.closest('.mobile-table-detail');
    if (oldDetail) {
      if (oldDetail.previousElementSibling?.matches('.mobile-analytic-list')) oldDetail.previousElementSibling.remove();
      oldDetail.before(...oldDetail.childNodes); oldDetail.remove();
    }
    const cellText = cell => {
      if (!cell) return '—';
      const copy = cell.cloneNode(true);
      copy.querySelectorAll('div,small,br').forEach(n => n.before(document.createTextNode('\n')));
      return copy.textContent.trim().replace(/[\t ]+/g,' ').replace(/\n\s*\n/g,'\n') || '—';
    };
    const wrap = table.closest('.tbl-wrap,.mobile-table-scroll') || table;
    const section = el('<section class="mobile-analytic-list"><div class="mobile-analytic-tools"></div><div class="mobile-analytic-rows"></div></section>');
    const tools = section.querySelector('.mobile-analytic-tools');
    let searchText = '';
    if (issuerTable) {
      const search = el('<input type="search" class="phone-analytic-search" aria-label="Найти эмитента в списке" placeholder="Найти эмитента">');
      section.prepend(search);
      search.oninput = () => { searchText = issuerText(search.value); limit = 8; draw(); };
    }
    const sortable = headers.map((h,i) => [h,i]).filter(([h]) => h.onclick || h.matches('[data-k],.id-sort'));
    if (sortable.length) {
      const label = el('<label>Сортировка <select aria-label="Сортировка списка"></select></label>');
      label.querySelector('select').append(new Option('Выбрать показатель',''));
      sortable.forEach(([h,i]) => label.querySelector('select').append(new Option(labels[i],String(i),false,/[▲▼▾▴]/.test(h.textContent))));
      label.querySelector('select').onchange = e => { if (e.target.value !== '') headers[Number(e.target.value)].click(); };
      tools.append(label);
    }
    const count = el('<span></span>'); count.textContent = `${rows.length} в списке`; tools.append(count);
    wrap.before(section);
    const detail = el('<details class="mobile-table-detail"><summary>Полная таблица и сортировка</summary></details>');
    wrap.before(detail); detail.append(wrap);
    let limit = readonly ? 6 : issuerTable ? 8 : 12;
    const host = section.querySelector('.mobile-analytic-rows');
    function draw() {
      host.replaceChildren();
      const filtered = searchText ? rows.filter(row=>issuerText(cellText(row.cells[nameIndex])).includes(searchText)) : rows;
      count.textContent = `${Math.min(limit,filtered.length)} из ${filtered.length}`;
      filtered.slice(0,limit).forEach(row => {
        const cells = [...row.cells];
        const article = el('<article class="mobile-analytic-card"><div class="mobile-analytic-name"></div><dl></dl></article>');
        const title = article.querySelector('.mobile-analytic-name');
        const fullName = cellText(cells[nameIndex]), name = fullName.split('\n')[0];
        if (row.onclick && row.matches('[data-isin],[data-comp],[data-tk]')) {
          const b = document.createElement('button'); b.type = 'button'; b.textContent = name;
          b.onclick = () => { row.click(); window.scrollTo(0,0); }; title.append(b);
        } else title.textContent = name;
        if (fullName !== name) {
          const sub = el('<p class="mobile-analytic-fullname mobile-extra-metric"></p>');
          sub.textContent = fullName; title.after(sub);
        }
        if (ratingIndex >= 0 && ratingIndex !== nameIndex) {
          const rating = el('<div class="mobile-analytic-rating"></div>');
          const badge = cells[ratingIndex]?.querySelector('.rating-pill,.pill,.badge');
          if (badge) rating.append(badge.cloneNode(true));
          else rating.textContent = cellText(cells[ratingIndex]).split('\n')[0];
          title.after(rating);
        }
        const remove = row.querySelector('[data-x]');
        if (remove) {
          const button = el('<button type="button" class="mobile-card-remove">×</button>');
          button.setAttribute('aria-label','Убрать ' + name + ' из набора');
          button.onclick = () => remove.click(); title.append(button);
        }
        const metrics = cells.map((cell,i) => ({cell,i})).filter(({cell,i}) => i !== nameIndex && i !== ratingIndex && !cell.querySelector('[data-x]'));
        metrics.sort((a,b) => phoneMetricPriority(labels[b.i],issuerTable) - phoneMetricPriority(labels[a.i],issuerTable));
        if (sandboxTable) metrics.sort((a,b) => Number(/Цена|YTM|Рейтинг|Тип/.test(labels[b.i])) - Number(/Цена|YTM|Рейтинг|Тип/.test(labels[a.i])));
        if (readonly) metrics.sort((a,b) => Number(/Доходность|Размещено|^Спрос$|^Дата$/.test(labels[b.i])) - Number(/Доходность|Размещено|^Спрос$|^Дата$/.test(labels[a.i])));
        metrics.forEach(({cell,i},j) => {
          const box = el(`<div${j >= 3 ? ' class="mobile-extra-metric"' : ''}><dt></dt><dd></dd></div>`);
          box.querySelector('dt').textContent = labels[i] || 'Показатель';
          const lines = cellText(cell).split('\n');
          box.querySelector('dd').textContent = lines[0];
          if (lines.length > 1) {
            const note = el('<small class="mobile-extra-metric mobile-metric-note"></small>');
            note.textContent = lines.slice(1).join(' · '); box.querySelector('dd').append(note);
          }
          article.querySelector('dl').append(box);
        });
        if (metrics.length > 3 || fullName !== name) {
          const more = el('<button type="button" class="mobile-card-more" aria-expanded="false">Все показатели</button>');
          more.onclick = () => { const open = article.classList.toggle('expanded'); more.setAttribute('aria-expanded',String(open)); more.textContent = open ? 'Свернуть' : 'Все показатели'; };
          article.append(more);
        }
        host.append(article);
      });
      if (!filtered.length) host.append(el('<p class="matrix-invite">Ничего не найдено. Измените название эмитента.</p>'));
      if (filtered.length > limit) {
        const more = el('<button type="button" class="btn ghost mobile-load-more">Показать ещё</button>');
        more.onclick = () => { limit += 24; draw(); }; host.append(more);
      }
    }
    draw();
  }
  function enhanceSelect(select) {
    if (select.dataset.phoneSelect || select.multiple || select.size > 1) return;
    select.dataset.phoneSelect = 'true';
    const label = select.getAttribute('aria-label') || select.closest('label')?.querySelector('span')?.textContent || select.closest('.field')?.querySelector('label')?.textContent || 'Выбор';
    const trigger = el('<button type="button" class="phone-select-trigger" aria-haspopup="dialog" aria-expanded="false"><span></span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>');
    const sync = () => { trigger.querySelector('span').textContent = select.selectedOptions[0]?.textContent || label; trigger.setAttribute('aria-label',label.trim() + ': ' + trigger.querySelector('span').textContent); trigger.disabled = select.disabled; };
    sync(); select.addEventListener('change',sync);
    select.style.display = 'none'; select.tabIndex = -1; select.after(trigger);
    trigger.onclick = () => metricDropdown(select.closest('dialog') || select.closest('.panel') || document.getElementById('view'),trigger,key => {
      select.value = key; sync(); select.dispatchEvent(new Event('change',{bubbles:true}));
    },{label:label.trim(),caption:label.trim(),selected:select.value,options:[...select.options].map(o => ({key:o.value,title:o.textContent,disabled:o.disabled}))});
  }
  function sandboxLayout(v) {
    const chart = v.querySelector('#sb-rate-chart');
    if (chart && !chart.closest('.sb-phone-trajectory')) {
      const panel = chart.closest('.panel'); panel.classList.add('sb-phone-forecast');
      panel.querySelector('h3').textContent = 'Сценарий ставки';
      const trajectory = el(`<details class="sb-phone-trajectory" ${state.sandboxChart ? 'open' : ''}><summary>Траектория ставки</summary></details>`);
      chart.before(trajectory); trajectory.append(chart);
      trajectory.ontoggle = () => { state.sandboxChart = trajectory.open; if (trajectory.open) requestAnimationFrame(() => charts.forEach(c => !c.isDisposed() && c.resize())); };
      const toggle = panel.querySelector('#sb-toggle-meet');
      toggle.textContent = SANDBOX.showMeetings ? 'Скрыть заседания' : 'Настроить по заседаниям';
      toggle.setAttribute('aria-expanded',String(SANDBOX.showMeetings));
      if (SANDBOX.showMeetings) panel.append(panel.querySelector('.sb-apply'),panel.querySelector('.sb-apply-note'));
      panel.querySelectorAll('[data-anchor]').forEach(n => n.parentElement.classList.add('sb-phone-anchor'));
    }
    const add = v.querySelector('#sb-issuer-search')?.closest('.panel');
    if (add && !add.querySelector('.sb-phone-add-mode')) {
      add.classList.add('sb-phone-set');
      const mode = state.sandboxAddMode || 'issuer';
      const tabs = el(`<div class="mobile-quick sb-phone-add-mode" aria-label="Добавить в набор"><button type="button" data-add="issuer" aria-pressed="${mode === 'issuer'}">Эмитент</button><button type="button" data-add="bond" aria-pressed="${mode === 'bond'}">Отдельная бумага</button></div>`);
      add.querySelector('.sb-add-grid').before(tabs);
      const fields = [add.querySelector('#sb-issuer-search').closest('.field'),add.querySelector('#sb-search').closest('.field')];
      const choose = value => { state.sandboxAddMode = value; fields[0].hidden = value !== 'issuer'; fields[1].hidden = value !== 'bond'; tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.add === value))); };
      tabs.querySelectorAll('button').forEach(b => b.onclick = () => choose(b.dataset.add)); choose(mode);
      add.querySelector('#sb-issuer-search').placeholder = 'Название эмитента';
      add.querySelector('#sb-search').placeholder = 'Название или ISIN';
      fields.forEach(f => f.querySelector('label').classList.add('sr-only'));
      add.querySelectorAll('.sb-issuer-chip').forEach(original => {
        const compact = el('<div class="sb-phone-issuer"><span></span><button type="button">×</button></div>');
        compact.querySelector('span').textContent = [...original.children].filter(n => n.tagName !== 'B').map(n => n.textContent).join(' · ');
        compact.querySelector('button').setAttribute('aria-label','Убрать эмитента ' + original.querySelector('span').textContent);
        compact.querySelector('button').onclick = () => original.click(); original.before(compact); original.hidden = true;
      });
      const empty = add.querySelector('.sb-issuer-empty');
      if (empty) empty.hidden = true;
    }
    v.querySelectorAll('#sb-set table').forEach(t => tableCards(t));
    const more = v.querySelector('#sb-more');
    if (more && !more.dataset.phoneKey) { more.dataset.phoneKey = 'true'; more.setAttribute('role','button'); more.tabIndex = 0; more.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); more.click(); } }; }
  }
  function isLongChartExplanation(text) {
    return text.trim().length > 110 && !/ошибк|не удалось|устарел|нет данных|неполные данные|аномал|риск потери|дефолт/i.test(text);
  }
  function compactChartText(v) {
    if(!isPhone() || !v)return;
    v.querySelectorAll('[data-chart-help],.panel > .muted').forEach(n=>{
      if(n.closest('.mobile-chart-explanation,dialog,.modal-ov') || n.matches('.alert,.warning,.error,.loading,.phone-chart-coverage'))return;
      if(n.querySelector('button,input,select,table,.value,.kpi'))return;
      const panel=n.closest('.panel');
      if(!panel?.querySelector('.chart') || (!n.hasAttribute('data-chart-help') && !isLongChartExplanation(n.textContent)))return;
      let help=panel.querySelector(':scope > .mobile-chart-explanation');
      if(!help){help=el('<details class="mobile-chart-explanation"><summary>О графике</summary></details>');n.before(help);}
      help.append(n);
    });
    v.querySelectorAll('h3[data-phone-title]').forEach(h=>{
      if(h.dataset.phoneTitleApplied)return;
      h.dataset.phoneTitleApplied='true';
      const title=h.dataset.phoneTitle;
      h.replaceChildren(document.createTextNode(title));
    });
  }
  function denseAnalytics(v) {
    const active = ['issuers','issuer','placements','auctions'].includes(TAB);
    v.classList.toggle('phone-dense-analytics',active);
    if (!active) return;
    v.querySelectorAll('.kpis').forEach(group=>{
      if (group.dataset.phoneCompact) return;
      group.dataset.phoneCompact='true';
      const items=[...group.children];
      items.sort((a,b)=>phoneMetricPriority(b.querySelector('.label')?.textContent || '',true)-phoneMetricPriority(a.querySelector('.label')?.textContent || '',true));
      items.forEach(item=>group.append(item));
      if(items.length <= 3) return;
      const detail=el('<details class="phone-kpi-details"><summary>Остальные показатели</summary><div class="kpis"></div></details>');
      group.after(detail); detail.querySelector('.kpis').dataset.phoneCompact='true';
      items.slice(3).forEach(item=>detail.querySelector('.kpis').append(item));
    });
    v.querySelectorAll('.kpis').forEach(group=>{
      const box=group.parentElement;
      if(!box || box.matches('.panel,.phone-kpi-details') || box.closest('.phone-construction-detail')) return;
      const label=box.firstElementChild;
      if(!label || !/^Стройка\s*·\s*ЕРЗ/i.test(label.textContent.trim())) return;
      const detail=el('<details class="phone-kpi-details phone-construction-detail"><summary>Стройка и сроки · ЕРЗ</summary></details>');
      box.before(detail); detail.append(box);
    });
    const panels = new Set([...v.querySelectorAll('.chart')].map(chart=>chart.closest('.panel')).filter(Boolean));
    panels.forEach((panel,index)=>{
      if(TAB === 'auctions' && index === 0) return; // главная кривая ОФЗ остаётся открытой
      if(panel.closest('.phone-analysis-disclosure') || panel.querySelector('table,.kpis,.mobile-analytic-list,#sc-bonds')) return;
      const heading=panel.querySelector('h3'); if(!heading) return;
      const detail=el('<details class="phone-analysis-disclosure"><summary></summary></details>');
      detail.querySelector('summary').textContent=heading.childNodes[0]?.textContent.trim() || heading.textContent.trim();
      panel.before(detail); detail.append(panel);
      detail.addEventListener('toggle',()=>{if(detail.open) scheduleChartResize();});
    });
  }
  function polishSections(v) {
    v.querySelectorAll('#i-back,#ip-back').forEach(b => { b.textContent = '← Назад'; });
    if (TAB === 'macro') macroLayout(v);
    if (TAB === 'issuers') compactNav([...v.querySelectorAll('[data-sec]')],'Сектор');
    if (['movers','ideas','placements','issuers','issuer'].includes(TAB)) v.querySelectorAll('table').forEach(t => tableCards(t));
    if (TAB === 'auctions') v.querySelectorAll('table').forEach(t => {
      if ([...t.querySelectorAll('th')].some(h => /Спрос\/предл/.test(h.textContent))) tableCards(t,true);
    });
    if (TAB === 'sandbox') {
      sandboxLayout(v);
      const anchors = [...v.querySelectorAll('[data-anchor]')];
      if (anchors.length) anchors[0].parentElement.parentElement.classList.add('mobile-rate-anchors');
      v.querySelectorAll('[data-anchor],#sb-rates input').forEach(n => n.setAttribute('aria-label','Прогноз ставки · ' + (n.parentElement.querySelector('label')?.textContent || n.parentElement.textContent).trim()));
    }
    if (TAB === 'ideas') {
      const filters = v.querySelector('#id-kind')?.closest('.panel');
      if (filters && !filters.querySelector('.mobile-extra-filters')) {
        filters.classList.add('mobile-ideas-filters');
        const fields = [...filters.querySelectorAll(':scope > .field')];
        if (fields.length > 2) {
          const d = el(`<details class="mobile-extra-filters" ${state.ideasOpen ? 'open' : ''}><summary>Рейтинг и ликвидность${IDEAS.rating.size ? ' · ' + IDEAS.rating.size + ' выбрано' : ''}</summary><div></div></details>`);
          fields.slice(2).forEach(n => d.querySelector('div').append(n)); filters.append(d);
          d.ontoggle = () => { state.ideasOpen = d.open; };
        }
      }
    }
    v.querySelectorAll('th[data-k],th.id-sort').forEach(th => {
      if (th.dataset.mobileSort) return;
      th.dataset.mobileSort = 'true'; th.tabIndex = 0;
      th.setAttribute('aria-label','Сортировать по ' + th.textContent.replace(/[↕↑↓▲▼▾▴⇅]/g,'').trim());
      th.addEventListener('keydown',e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); th.click(); } });
      th.addEventListener('click',() => requestAnimationFrame(() => { if (isPhone() && v.isConnected) afterRender(); }));
    });
    // Long subtitles remain available, without crowding the graph heading.
    v.querySelectorAll('.panel h3 > .muted').forEach(n => {
      if (n.textContent.length < 24 || n.dataset.mobileCaption) return;
      n.dataset.mobileCaption = 'true';
      const h = n.closest('h3'), d = el('<details class="mobile-chart-explanation"><summary>О графике и данных</summary></details>');
      h.after(d); d.append(n);
    });
    compactChartText(v);
    denseAnalytics(v);
    accessibleChips(v);
    v.querySelectorAll('.field').forEach(field => {
      const label = field.querySelector('label')?.textContent.trim();
      if (label) field.querySelectorAll('input:not([aria-label]),select:not([aria-label])').forEach(n => n.setAttribute('aria-label',label + (n.placeholder ? ' ' + n.placeholder : '')));
    });
    v.querySelectorAll('select').forEach(enhanceSelect);
  }
  function afterRender() {
    if (!isPhone()) return;
    shell();
    polishSections(document.getElementById('view'));
    if (TAB === 'indices') indices(document.getElementById('view'));
    if (TAB === 'marketmap') {
      const panel = document.querySelector('#view > .panel');
      if (panel?.querySelector('.filters') && !panel.querySelector('.mobile-map-options')) {
        const details = el(`<details class="mobile-map-options" ${state.mapOpen ? 'open' : ''}><summary>Параметры карты · ${escA(MAP.ccy || 'все валюты')}</summary></details>`);
        [...panel.children].filter(n => n.tagName !== 'H3').forEach(n => details.append(n));
        panel.append(details);
        details.ontoggle = () => { state.mapOpen = details.open; };
        if (state.focus?.startsWith('m-')) panel.querySelector('#' + state.focus)?.focus({preventScroll:true});
      }
    }
    // Give dense analytical tables their own scroll surface, not the page.
    document.querySelectorAll('#view table').forEach(t => {
      if (!t.closest('.tbl-wrap, .mobile-table-scroll')) {
        const w = document.createElement('div'); w.className = 'mobile-table-scroll';
        t.before(w); w.append(t);
      }
    });
    if (state.focus && /^(mv-|id-|sb-)/.test(state.focus)) document.getElementById(state.focus)?.focus({preventScroll:true});
    if (!state.freshNavigation && ['issue','issuer'].includes(state.fromTab) && state.fromTab !== TAB && state.scrollByTab?.[TAB] != null) window.scrollTo(0,state.scrollByTab[TAB]);
    state.freshNavigation = false;
    requestAnimationFrame(() => charts.forEach(c => { if (!c.isDisposed()) c.resize(); }));
  }
  function tuneChart(opt, node) {
    if (!isPhone()) return;
    // Layout only: never clip, filter or recalculate observations on a phone.
    if (opt.grid && !Array.isArray(opt.grid)) {
      opt.grid = { ...opt.grid, left: 48, right: Array.isArray(opt.yAxis) && opt.yAxis.length > 1 ? 46 : 22 };
      if (opt.legend && opt.legend.show !== false && opt.legend.bottom == null) opt.grid.top = Math.max(Number(opt.grid.top) || 0, 48);
    }
    if (opt.legend && !Array.isArray(opt.legend)) opt.legend = { ...opt.legend, type: 'scroll', textStyle: { ...opt.legend.textStyle, fontSize: 10 }, itemGap: 10 };
    const axes = (value, y) => {
      const change = (a, i) => a ? { ...a, splitNumber: a.splitNumber || (y ? 4 : 3),
        axisLabel: { ...a.axisLabel, fontSize: 10, hideOverlap: true },
        ...(y && a.name ? { nameTextStyle: { ...a.nameTextStyle, fontSize: 10, align: i ? 'right' : 'left', padding: 0 } } : {}) } : a;
      return Array.isArray(value) ? value.map(change) : change(value, 0);
    };
    if (opt.xAxis) opt.xAxis = axes(opt.xAxis, false);
    if(node?.id === 'ip-chart' && opt.xAxis && !Array.isArray(opt.xAxis)) {
      if(/Дюрация \(фиксы\)/.test(opt.xAxis.name || '')) opt.xAxis.name='Дюрация / срок, лет';
      else if(/Срок до погашения/.test(opt.xAxis.name || '')) opt.xAxis.name='Срок, лет';
    }
    if (opt.yAxis) opt.yAxis = axes(opt.yAxis, true);
    if (node?.id === 'ip-redemption' && opt.grid && !Array.isArray(opt.grid)) {
      // Let ECharts measure formatted money labels (e.g. «4,0 млрд»).
      // A fixed 48px gutter clips them on narrow screens.
      opt.grid = { ...opt.grid, left: 8, containLabel: true };
    }
    if (opt.toolbox) opt.toolbox = { ...opt.toolbox, show: false };
    if (node?.id === 'idx-chart' && Array.isArray(opt.series)) {
      // Reserve a gutter for decimal endpoint labels; keep observations intact.
      opt.series = opt.series.map(s => ({ ...s, endLabel:{...s.endLabel,show:true,fontSize:9,distance:5},labelLayout:{...s.labelLayout,moveOverlap:'shiftY'} }));
      if (opt.grid && !Array.isArray(opt.grid)) {
        opt.grid.right = 76;
        const extreme = opt.series.some(s => (s.data || []).some(p => Array.isArray(p) && Math.abs(Number(p[1])) >= 10000));
        if (extreme) opt.grid.left = 72;
      }
    }
    if (node?.id?.startsWith('mc-') && Array.isArray(opt.series)) {
      // Several endpoint labels cannot fit at 320px. The original series,
      // legend and precise tooltip values stay available.
      opt.series = opt.series.map(s => ({...s,endLabel:{...s.endLabel,show:false}}));
    }
    opt.tooltip = { ...opt.tooltip, confine: true, textStyle: { ...opt.tooltip?.textStyle, fontSize: 11 },
      extraCssText: (opt.tooltip?.extraCssText || '') + 'max-width:calc(100vw - 40px);white-space:normal;overflow-wrap:anywhere;' };
  }
  media.addEventListener('change', () => { state.filters = false; state.menu?.close(); render(); });
  return { isPhone, beforeRender, afterRender, startView, screener, tuneChart, marketMap,
    matrixHorizon, matrixBucket, matrixValue, buildMatrix, matrixIssuers, matrixIssuerRows, matrixIssuerResults, metricPresentation, indices, indexCaption, ideas, ideaRows, phoneMetricPriority,
    compactChartText, isLongChartExplanation,
    invalidateMarket: () => { MARKET_REQUESTS.clear(); } };
})();
