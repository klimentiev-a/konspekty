/* Студия: интерфейс, проигрыватель, запись в видео */
(function (G) {
'use strict';
const E = G.StudioEngine, A = G.StudioAudio, N = G.StudioNet, D = G.StudioData, $ = id => document.getElementById(id);
const I = G.StudioI18n, tt = I.tt, TR = I.T;
const cv = $('cv'), cx = cv.getContext('2d'); let P, sel = 0, tab = 'script', t = 0, playing = false, clips = {}, raf = 0, t0w = 0, tFrom = 0, recording = null;

const LIBK = 'studio:lib', pk = id => 'studio:p:' + id, uid = () => Math.random().toString(36).slice(2, 9);
let lib = { active: '', items: [] }, pid = '';
function libLoad() { try { const l = JSON.parse(localStorage.getItem(LIBK)); if (l && Array.isArray(l.items)) lib = l; } catch (e) {} }
function libSave() { try { localStorage.setItem(LIBK, JSON.stringify(lib)); } catch (e) {} }
function addLib(p) { pid = uid(); lib.items.push({ id: pid, title: p.title, series: p.series || '', part: p.part || 1, upd: Date.now(), n: p.scenes.length, dur: E.total(p) }); lib.active = pid; libSave(); try { localStorage.setItem(pk(pid), JSON.stringify(p)); } catch (e) {} }
function load() {
  libLoad(); let body = null;
  if (lib.active && lib.items.some(x => x.id === lib.active)) { try { body = JSON.parse(localStorage.getItem(pk(lib.active))); } catch (e) {} }
  if (body && body.scenes && body.scenes.length) { pid = lib.active; return body; }
  let p = null; try { const s = localStorage.getItem('studio:project'); if (s) { p = JSON.parse(s); if (!(p && p.scenes && p.scenes.length)) p = null; } } catch (e) {}
  p = p || D.T.bunker(); addLib(p); return p;
}
let svT = 0; function save() { clearTimeout(svT); svT = setTimeout(saveNow, 400); }
function saveNow() { clearTimeout(svT); try { localStorage.setItem(pk(pid), JSON.stringify(P)); const m = lib.items.find(x => x.id === pid); if (m) { m.title = P.title; m.series = P.series || ''; m.part = P.part || 1; m.upd = Date.now(); m.n = P.scenes.length; m.dur = E.total(P); } lib.active = pid; libSave(); } catch (e) {} hdr(); }
function hdr() { const b = $('libbtn'); if (!b) return; b.querySelector('.n').textContent = ((P.series ? tt('Ч', 'P') + (P.part || 1) + ' · ' : '') + (P.title || tt('Без названия', 'Untitled'))); $('sbadge').textContent = '✓ ' + tt('сохранено', 'saved'); }
function fmt(s) { s = Math.max(0, s); return ((s / 60) | 0) + ':' + String((s % 60) | 0).padStart(2, '0'); }
function total() { return E.total(P); }

function frame() { cx.setTransform(cv.width / E.W, 0, 0, cv.height / E.H, 0, 0); E.drawScene(cx, P, Math.min(Math.max(t, playing || recording ? 0 : .35), Math.max(0, total() - .001))); }
function hud() { const T = total(); $('ttime').textContent = fmt(t) + ' / ' + fmt(T); $('scrub').value = T ? Math.round(t / T * 1000) : 0; const ph = $('tl').querySelector('.s-ph'); if (ph) ph.style.left = (T ? t / T * 100 : 0) + '%'; const S = E.sceneAt(P, t); [...$('tl').querySelectorAll('.s-tk')].forEach((b, i) => b.classList.toggle('on', S && i === S.i)); $('bpi').setAttribute('d', playing ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7z'); $('pplay').classList.toggle('off', playing); }
function tlBuild() { const T = total(), el = $('tl'); el.innerHTML = ''; P.scenes.forEach((s, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 's-tk'; b.style.flex = s.dur + ' 1 0'; b.textContent = (i + 1) + '. ' + s.name; b.title = s.name + ' · ' + s.dur + ' с'; b.onclick = () => { const tl = E.timeline(P); seek(tl[i].s + .01); sel = i; if (tab === 'scenes') pane(); }; el.appendChild(b); }); const ph = document.createElement('i'); ph.className = 's-ph'; el.appendChild(ph); }
function touch(structural) { if (structural) tlBuild(); frame(); hud(); save(); }

async function refreshClips() { try { clips = await N.TTS.cached(P); } catch (e) { clips = {}; } }
async function play() { if (playing) return; if (t >= total() - .05) t = 0; await refreshClips(); playing = true; tFrom = t; A.start(P, t, clips); t0w = performance.now(); loop(); hud(); }
function pause() { playing = false; A.stop(); cancelAnimationFrame(raf); hud(); }
function loop() { raf = requestAnimationFrame(() => { if (!playing) return; t = tFrom + (performance.now() - t0w) / 1000; if (t >= total()) { t = total(); frame(); pause(); t = 0; frame(); hud(); return; } frame(); hud(); loop(); }); }
async function seek(x) { const was = playing; if (was) pause(); t = Math.max(0, Math.min(total() - .01, x)); frame(); hud(); if (was) play(); }
$('bplay').onclick = $('pplay').onclick = () => playing ? pause() : play();
$('scrub').oninput = e => seek(e.target.value / 1000 * total());
cv.onclick = () => playing ? pause() : play();
document.addEventListener('keydown', e => { if (/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) return; if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); } else if (e.key === 'ArrowRight') seek(t + 1); else if (e.key === 'ArrowLeft') seek(t - 1); });

// ---------- мини-конструктор форм ----------
function h(tag, a, ...k) { const e = document.createElement(tag); if (a) for (const [x, y] of Object.entries(a)) { if (x === 'class') e.className = y; else if (x.startsWith('on')) e[x] = y; else if (y !== false && y != null) e.setAttribute(x, y === true ? '' : y); } k.flat().forEach(c => c != null && e.append(c.nodeType ? c : document.createTextNode(c))); return e; }
function fld(label, input, cls) { return h('label', { class: 's-fld ' + (cls || '') }, h('span', 0, label), input); }
const F = {
  text(o, k, label, opt = {}) { const i = h(opt.area ? 'textarea' : 'input', { type: 'text', placeholder: opt.ph || '', rows: opt.rows }); i.value = o[k] == null ? '' : o[k]; i.oninput = () => { o[k] = i.value; opt.on ? opt.on(i.value) : touch(opt.struct); }; return fld(label, i, opt.cls); },
  num(o, k, label, opt = {}) { const i = h('input', { type: 'number', min: opt.min, max: opt.max, step: opt.step || .1 }); i.value = o[k] == null ? '' : o[k]; i.oninput = () => { const v = parseFloat(i.value); if (isFinite(v)) { o[k] = v; opt.on ? opt.on(v) : touch(opt.struct); } else if (i.value === '' && opt.opt) { delete o[k]; touch(opt.struct); } }; return fld(label, i, opt.cls || 's'); },
  sel(o, k, label, opts, opt = {}) { const i = h('select'); const ent = Array.isArray(opts) ? opts.map(x => [x, x]) : Object.entries(opts); ent.forEach(([v, n]) => i.append(h('option', { value: v }, n))); i.value = o[k] == null ? ent[0][0] : o[k]; i.onchange = () => { o[k] = i.value; opt.on ? opt.on(i.value) : touch(opt.struct); }; return fld(label, i, opt.cls); },
  col(o, k, label, d) { const i = h('input', { type: 'color' }); i.value = o[k] || d || '#888888'; i.oninput = () => { o[k] = i.value; touch(); }; return fld(label, i, 's'); },
  chk(o, k, label, on) { const c = h('span', { class: 's-chip' + (o[k] ? ' on' : '') }, label); c.onclick = () => { o[k] = !o[k]; c.classList.toggle('on', !!o[k]); on ? on() : touch(); }; return c; }
};
const btn = (txt, fn, cls) => h('button', { type: 'button', class: 's-btn ' + (cls || ''), onclick: fn }, txt);
const keysStr = k => (k || []).map(x => x[0] + ':' + x[1]).join(', ');
const parseKeys = s => String(s).split(/[,;\n]/).map(x => x.trim().split(':').map(Number)).filter(a => a.length === 2 && a.every(isFinite));
function move(arr, i, d) { const j = i + d; if (j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true; }

// ---------- шаги и вкладки ----------
const STEPS = [
  { id: 'idea', ru: 'Идея', en: 'Idea', subs: [['script', 'Идея', 'Idea']] },
  { id: 'scenes', ru: 'Сцены', en: 'Scenes', subs: [['scenes', 'Сцены', 'Scenes'], ['chars', 'Персонажи', 'Characters']] },
  { id: 'look', ru: 'Вид', en: 'Look', subs: [['theme', 'Субтитры, цвета, HUD', 'Captions, colors, HUD']] },
  { id: 'sound', ru: 'Звук', en: 'Sound', subs: [['voice', 'Голос', 'Voice'], ['sound', 'Музыка и звуки', 'Music & sounds']] },
  { id: 'publish', ru: 'Выпуск', en: 'Publish', subs: [['publish', 'Выпуск', 'Publish']] }
];
let step = 0;
const stepOf = k => STEPS.findIndex(S => S.subs.some(x => x[0] === k));
function goStep(i, sk) { stopCharPv(); step = Math.max(0, Math.min(STEPS.length - 1, i)); tab = sk || STEPS[step].subs[0][0]; tabs(); pane(); const sw = $('sw'); if (sw && sw.getBoundingClientRect().top < -40 && matchMedia('(max-width:900px)').matches) $('steps').scrollIntoView({ block: 'start', behavior: 'smooth' }); }
function tabs() {
  step = Math.max(0, stepOf(tab)); const el = $('steps'); el.innerHTML = '';
  STEPS.forEach((S, i) => el.append(h('button', { type: 'button', class: 's-step' + (i === step ? ' on' : i < step ? ' done' : ''), onclick: () => goStep(i) }, h('i', 0, i < step ? '✓' : String(i + 1)), h('span', 0, tt(S.ru, S.en)))));
  const tb = $('tabs'); tb.innerHTML = ''; const S = STEPS[step];
  if (S.subs.length > 1) S.subs.forEach(x => tb.append(h('button', { type: 'button', class: x[0] === tab ? 'on' : '', role: 'tab', onclick: () => goStep(step, x[0]) }, tt(x[1], x[2]))));
  const nv = $('nav'); nv.innerHTML = '';
  nv.append(step > 0 ? btn('← ' + tt(STEPS[step - 1].ru, STEPS[step - 1].en), () => goStep(step - 1)) : h('span'));
  nv.append(step < STEPS.length - 1 ? btn(tt(STEPS[step + 1].ru, STEPS[step + 1].en) + ' →', () => goStep(step + 1), 'pri big') : h('span'));
}
function pane() { const el = $('pane'); el.innerHTML = ''; stopCharPv(); ({ script: pScript, scenes: pScenes, chars: pChars, theme: pTheme, voice: pVoice, sound: pSound, publish: pPublish })[tab](el); }
function setProject(p, keepTab) { pause(); P = p; sel = 0; t = 0; clips = {}; tlBuild(); frame(); hud(); save(); pane(); }
function openNew(p, o) { saveNow(); o = o || {}; if (o.series != null) { p.series = o.series; p.part = o.part || 1; } addLib(p); setProject(p); hdr(); }
function openId(id) { saveNow(); let p = null; try { p = JSON.parse(localStorage.getItem(pk(id))); } catch (e) {} if (!p || !p.scenes || !p.scenes.length) { lib.items = lib.items.filter(x => x.id !== id); libSave(); return false; } pid = id; lib.active = id; libSave(); setProject(p); hdr(); return true; }
function delId(id) { lib.items = lib.items.filter(x => x.id !== id); try { localStorage.removeItem(pk(id)); } catch (e) {} libSave(); if (id === pid) { const nx = lib.items.slice().sort((a, b) => b.upd - a.upd)[0]; if (!(nx && openId(nx.id))) { pid = ''; const p = D.T.blank(); addLib(p); setProject(p); hdr(); } } }
// --- окна ---
function closeModal() { const m = document.querySelector('.s-modal'); if (m) m.remove(); document.removeEventListener('keydown', escM); }
function escM(e) { if (e.key === 'Escape') closeModal(); }
function modal(title, build) { closeModal(); const bg = h('div', { class: 's-modal', onclick: e => { if (e.target === bg) closeModal(); } }); const body = h('div', { class: 's-mb' }); bg.append(h('div', { class: 's-mbox', role: 'dialog' }, h('div', { class: 's-mh' }, h('b', 0, title), h('button', { type: 'button', class: 's-x', 'aria-label': 'Close', onclick: closeModal }, '×')), body)); $('sw').append(bg); document.addEventListener('keydown', escM); build(body); return body; }
const dtf = ts => new Date(ts).toLocaleDateString(I.lang === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'short' });
function openLib() {
  saveNow();
  modal(tt('Проекты', 'Projects'), body => {
    const render = () => {
      body.innerHTML = '';
      body.append(h('div', { class: 's-row' }, btn(tt('+ Новый проект', '+ New project'), () => { closeModal(); goStep(0); }, 'pri'), btn(tt('+ Сюжетная линия', '+ Storyline'), () => { const n = prompt(tt('Название сюжетной линии', 'Storyline name')); if (n && n.trim()) { const p = D.T.blank(); p.title = n.trim() + tt(' · часть 1', ' · part 1'); openNew(p, { series: n.trim(), part: 1 }); closeModal(); goStep(0); } })));
      const gr = {}; lib.items.forEach(m => (gr[m.series || ''] = gr[m.series || ''] || []).push(m));
      const keys = Object.keys(gr).sort((a, b) => (a === '') - (b === '') || Math.max(...gr[b].map(x => x.upd)) - Math.max(...gr[a].map(x => x.upd)));
      for (const k of keys) {
        body.append(h('div', { class: 's-gh' }, h('b', 0, k || tt('Без сюжетной линии', 'No storyline')), gr[k].length > 1 || k ? h('small', 0, gr[k].length + ' ' + tt('шт.', 'items')) : null));
        gr[k].sort((a, b) => (a.part - b.part) || (a.upd - b.upd)).forEach(m => body.append(h('div', { class: 's-pj' + (m.id === pid ? ' on' : '') },
          h('div', { class: 's-pt' }, h('b', 0, (k ? tt('Часть ', 'Part ') + m.part + ' · ' : '') + m.title), h('small', 0, m.n + ' ' + tt('сцен', 'scenes') + ' · ' + fmt(m.dur) + ' · ' + dtf(m.upd))),
          m.id === pid ? h('span', { class: 's-cur' }, tt('открыт', 'open')) : btn(tt('Открыть', 'Open'), () => { if (openId(m.id)) { closeModal(); goStep(1); } else render(); }, 'sm pri'),
          btn(tt('Копия', 'Copy'), () => { saveNow(); let p = null; try { p = JSON.parse(localStorage.getItem(pk(m.id))); } catch (e) {} if (p) { p.title += tt(' (копия)', ' (copy)'); openNew(p, k ? { series: k, part: m.part } : undefined); } render(); }, 'sm'),
          btn('×', () => { if (confirm(tt('Удалить проект «' + m.title + '»? Это нельзя отменить.', 'Delete project “' + m.title + '”? This cannot be undone.'))) { delId(m.id); render(); } }, 'sm dng'))));
      }
    }; render();
  });
}
// --- Креатив: продолжения ---
function storyCtx() { return { title: P.title, names: Object.values(P.chars || {}).map(c => c.name).join(', '), sc: P.scenes.map((x, i) => (i + 1) + '. ' + x.name + ': ' + (x.caps || []).map(c => E.stripCap(c.text)).join(' / ')).join('\n') }; }
function lastLine() { for (let i = P.scenes.length - 1; i >= 0; i--) { const c = (P.scenes[i].caps || []).filter(x => x.text && x.text !== '...'); if (c.length) return E.stripCap(c[c.length - 1].text); } return ''; }
function contPrompt(idea) { const c = storyCtx(), part = (P.part || 1) + 1; return tt('Продолжение ролика «' + c.title + '» (часть ' + part + '). Герои: ' + c.names + '. Что было:\n' + c.sc + '\n\nИдея продолжения: ' + idea.title + '. ' + idea.logline + (idea.hook ? ' Первая фраза: ' + idea.hook + '.' : '') + '\nНачни с крючка, связанного с последней сценой; сохрани героев и тон.', 'Continuation of the video “' + c.title + '” (part ' + part + '). Characters: ' + c.names + '. What happened:\n' + c.sc + '\n\nContinuation idea: ' + idea.title + '. ' + idea.logline + (idea.hook ? ' First line: ' + idea.hook + '.' : '') + '\nStart with a hook tied to the last scene; keep the characters and the tone.'); }
function patterns() {
  const hero = (Object.values(P.chars || {})[0] || {}).name || tt('герой', 'the hero'), last = lastLine();
  const ls = P.scenes[P.scenes.length - 1], chp = ls && (ls.props || []).find(p => p.type === 'choice');
  const br = chp ? (chp.items || []).map(o => ({ ico: o.k, t: tt('Вариант ' + o.k, 'Option ' + o.k), l: tt('Зрители выбрали «' + o.text + '»: что происходит дальше и чем это оборачивается.', 'Viewers picked “' + o.text + '”: what happens next and what it costs.'), hook: tt('ТЫ ВЫБРАЛ ' + o.k, 'YOU PICKED ' + o.k) })) : [];
  return br.concat([
    { ico: '↯', t: tt('Поворот', 'Plot twist'), l: tt('Выясняется, что ' + hero + ' понял всё неправильно: последняя сцена («' + last + '») значит совсем другое.', hero + ' got it wrong: the last scene (“' + last + '”) means something else entirely.'), hook: tt('ЭТО БЫЛО НЕ ТАК', 'IT WAS NOT SO') },
    { ico: '▲', t: tt('Эскалация', 'Escalation'), l: tt('Ставки растут: времени меньше, угроза ближе, выбор для ' + hero + ' тяжелее.', 'Stakes rise: less time, closer threat, a harder choice for ' + hero + '.'), hook: tt('СТАЛО ХУЖЕ', 'IT GOT WORSE') },
    { ico: '↺', t: tt('Флэшбэк', 'Flashback'), l: tt('Как всё началось: сцена до первой серии, которая объясняет её финал.', 'How it began: a scene before episode one that explains its ending.'), hook: tt('ЗА ЧАС ДО ЭТОГО', 'ONE HOUR EARLIER') },
    { ico: '⇄', t: tt('Другой взгляд', 'Other side'), l: tt('Та же история глазами второго героя: он знает то, чего не знает зритель.', 'The same story through a second character who knows what the viewer does not.'), hook: tt('А ТЕПЕРЬ — ЕГО ВЕРСИЯ', 'NOW, HIS VERSION') },
    { ico: '⚑', t: tt('Развязка', 'Ending'), l: tt('Финал истории: чем закончилось, цена выбора и последняя фраза.', 'The finale: how it ended, the price of the choice and a last line.'), hook: tt('ВОТ ЧЕМ ВСЁ КОНЧИЛОСЬ', 'THIS IS HOW IT ENDED') },
    { ico: '☑', t: tt('Выбор зрителей', 'Viewers choose'), l: tt('Два варианта продолжения, зрители голосуют в комментариях, победивший вариант — следующая серия.', 'Two ways forward; viewers vote in comments and the winner becomes the next episode.'), hook: tt('ВЫБИРАЕШЬ ТЫ', 'YOU CHOOSE') }
  ]);
}
async function makePart(idea, st, done) {
  const old = P, series = P.series || P.title, part = (P.part || 1) + 1, topic = contPrompt(idea), key = N.Keys.get('anthropic');
  const keep = p => { for (const id of Object.keys(old.chars || {})) if (!p.chars[id] && Object.keys(p.chars).length < 6) p.chars[id] = JSON.parse(JSON.stringify(old.chars[id])); for (const id of Object.keys(p.chars)) if (old.chars[id]) p.chars[id] = JSON.parse(JSON.stringify(old.chars[id])); p.theme = old.theme; p.cap = Object.assign({}, old.cap); p.vignette = old.vignette; p.voice = Object.assign({}, old.voice); return p; };
  if (!key) { const p = keep(D.T.blank()); p.title = series + tt(' · часть ', ' · part ') + part; p.scenes[0].name = idea.title.slice(0, 40); p.scenes[0].caps[0].text = idea.hook || p.scenes[0].caps[0].text; aiOpt.topic = topic; openNew(p, { series, part }); aiMsg = tt('Запрос на продолжение подставлен в поле «О чём видео». Добавь ключ Claude API и нажми «Сгенерировать» — или скопируй запрос и отправь мне в чат.', 'The continuation request is in “What is the video about”. Add a Claude API key and press Generate — or copy it and send it to me in chat.'); closeModal(); goStep(0); return; }
  st.className = 's-msg'; st.textContent = tt('Claude пишет часть ' + part + '…', 'Claude is writing part ' + part + '…');
  const opt = Object.assign({}, aiOpt, { topic, lang: I.lang === 'en' ? 'English' : 'русский', len: Math.max(15, Math.min(60, Math.round(total() / 5) * 5 || 30)) });
  const p = keep(await N.AI.generate(opt, s => { st.textContent = tt(s, s); })); openNew(p, { series, part }); closeModal(); goStep(1);
}
function openCreative() {
  saveNow();
  modal('✦ ' + tt('Креатив: что дальше?', 'Creative: what next?'), body => {
    const st = h('div', { class: 's-msg' }); const hasKey = !!N.Keys.get('anthropic');
    const card = (ico, t, l, hook, idea) => h('div', { class: 's-idea' }, h('i', 0, ico), h('div', { class: 's-it' }, h('b', 0, t), h('p', 0, l), hook ? h('small', 0, tt('Крючок: ', 'Hook: ') + hook) : null, h('div', { class: 's-row' }, btn(tt('Сделать часть ', 'Make part ') + ((P.part || 1) + 1), async e => { const b = e.currentTarget; b.disabled = true; try { await makePart(idea, st); } catch (er) { st.textContent = er.message; st.className = 's-msg err'; } b.disabled = false; }, 'sm pri'), btn(tt('Скопировать запрос', 'Copy prompt'), async () => { try { await navigator.clipboard.writeText(contPrompt(idea)); st.textContent = tt('Скопировано — вставь в чат со мной', 'Copied — paste it into the chat with me'); st.className = 's-msg ok'; } catch (er) { st.textContent = contPrompt(idea); } }, 'sm'))));
    body.append(h('p', { class: 's-lead' }, tt('Варианты продолжения «' + P.title + '». Выбери, и Студия создаст следующую часть в той же сюжетной линии: герои и стиль сохранятся.', 'Ways to continue “' + P.title + '”. Pick one and the Studio creates the next part in the same storyline, keeping characters and style.')));
    body.append(h('h3', 0, tt('Идеи под твой сюжет', 'Ideas for your story')));
    const box = h('div', { class: 's-ideas' }); body.append(box);
    const gen = btn(hasKey ? tt('✦ Придумать с Claude', '✦ Ask Claude') : tt('Нужен ключ Claude API (шаг «Идея»)', 'Claude API key needed (step “Idea”)'), async () => { gen.disabled = true; st.className = 's-msg'; st.textContent = tt('Claude думает…', 'Claude is thinking…'); try { const arr = await N.AI.ideas(storyCtx(), I.lang, aiOpt.model); box.innerHTML = ''; arr.forEach(x => box.append(card('✦', x.title, x.logline, x.hook, x))); st.textContent = ''; } catch (er) { st.textContent = er.message; st.className = 's-msg err'; } gen.disabled = !N.Keys.get('anthropic'); }, 'pri'); gen.disabled = !hasKey; body.insertBefore(h('div', { class: 's-row' }, gen), box);
    body.append(h('h3', 0, tt('Ходы сюжета', 'Story moves')), h('p', { class: 's-note' }, tt('Работает без ключа: подставляется шаблон продолжения, текст пишешь сам или просишь меня в чате.', 'Works without a key: a continuation template is set up; you write the text yourself or ask me in chat.')));
    const pb = h('div', { class: 's-ideas' }); patterns().forEach(x => pb.append(card(x.ico, x.t, x.l, x.hook, { title: x.t, logline: x.l, hook: x.hook }))); body.append(pb, st);
  });
}
function staticApply() { document.querySelectorAll('[data-r]').forEach(e => { e.textContent = tt(e.dataset.r, e.dataset.e); }); document.title = 'Reel Studio · Hub'; }
function switchLang(l) { if (l === I.lang) return; pause(); P = I.mapProject(P, l); I.setLang(l); aiOpt.lang = l === 'en' ? 'English' : 'русский'; staticApply(); tlBuild(); frame(); hud(); save(); tabs(); pane(); }
$('libbtn').onclick = openLib; $('crbtn').onclick = openCreative;
document.querySelectorAll('.s-lang [data-l]').forEach(b => b.onclick = () => switchLang(b.dataset.l));
$('igbtn').onclick = () => { const on = $('ig').hidden; $('ig').hidden = !on; $('igbtn').classList.toggle('on', on); try { localStorage.setItem('studio:ig', on ? '1' : ''); } catch (e) {} };

function sceneEnd(sc) { let end = 0; (sc.caps || []).forEach(c => { end = Math.max(end, (c.at || 0) + (c.dur || 0)); }); (sc.props || []).forEach(p => { const at = p.at || 0; end = Math.max(end, p.type === 'choice' ? at + 1.2 + (p.items || []).length * .35 + 2.5 : p.dur != null && p.dur < 100 ? at + p.dur : at + 1.2); }); return end; }
function slack() { return P.scenes.filter(sc => sc.dur - sceneEnd(sc) > 1.3).length; }
function tighten() { let ch = 0; P.scenes.forEach(sc => { const nd = +Math.max(2, sceneEnd(sc) + .5).toFixed(2); if (nd < sc.dur - .05) { sc.dur = nd; ch++; } }); touch(); return ch; }
// --- Идея ---
let aiMsg = ''; let aiOpt = { topic: '', tone: 'напряжённый, как тревожный репортаж', len: 30, scenes: 6, lang: I.lang === 'en' ? 'English' : 'русский', hud: true, extra: '', model: 'claude-sonnet-5-5' };
function pScript(el) {
  el.append(h('p', { class: 's-lead' }, tt('Выбери, с чего начать. Дальше четыре шага — и ролик готов для Reels.', 'Pick a starting point. Four more steps and the video is ready for Reels.')));
  el.append(h('h3', 0, 'Шаблоны')); const g = h('div', { class: 's-hero' }); const sub = { bunker: 'Тревога, очередь, люк, 30 с', chat: 'Переписка и дверь, 18 с', finance: 'Формула и цифры, 18 с', blank: 'Одна сцена' };
  for (const k of Object.keys(D.T)) g.append(h('button', { type: 'button', class: 's-tpl', onclick: () => { { openNew(D.T[k]()); goStep(1); } } }, D.TNAMES[k], h('small', 0, sub[k]))); el.append(g);
  el.append(h('h3', 0, 'Придумать сценарий с Claude'));
  el.append(h('p', { class: 's-note' }, 'Опиши тему — Claude соберёт сцены, персонажей, фразы, звуки и счётчики. Нужен твой ключ Claude API: он хранится только в этом браузере и уходит только на api.anthropic.com.'));
  const kb = h('div', { class: 's-kbox' }); const ki = h('input', { type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off' }); ki.value = N.Keys.get('anthropic'); const ks = h('div', { class: 's-msg' });
    const kshow = (ok, msg) => { ks.className = 's-msg ' + (ok === true ? 'ok' : ok === false ? 'err' : ''); ks.textContent = msg; };
    const kcheck = async () => { const v = ki.value.trim(); N.Keys.set('anthropic', v); if (!v) return kshow(null, ''); if (!/^sk-ant-/.test(v)) return kshow(false, tt('Ключ должен начинаться с sk-ant-', 'The key must start with sk-ant-')); kshow(null, tt('Проверяю ключ…', 'Checking the key…')); try { const r = await fetch('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': v, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } }); if (r.ok) kshow(true, tt('✓ API подключён', '✓ API connected')); else if (r.status === 401 || r.status === 403) kshow(false, tt('✗ Ключ не подошёл (' + r.status + ')', '✗ The key was rejected (' + r.status + ')')); else kshow(false, tt('✗ Ответ сервиса ' + r.status, '✗ Service replied ' + r.status)); } catch (e) { kshow(false, tt('✗ Нет связи с api.anthropic.com', '✗ Cannot reach api.anthropic.com')); } };
    ki.oninput = () => { N.Keys.set('anthropic', ki.value.trim()); kshow(null, ki.value.trim() ? tt('Ключ сохранён · нажми Enter, чтобы проверить', 'Key saved · press Enter to check') : ''); }; ki.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); kcheck(); } }; ki.onchange = kcheck;
    if (ki.value) kshow(null, tt('Ключ сохранён · нажми Enter, чтобы проверить', 'Key saved · press Enter to check'));
    kb.append(fld('Ключ Claude API', ki, 'w'), ks); el.append(kb);
  el.append(F.text(aiOpt, 'topic', 'О чём видео', { area: true, rows: 3, ph: 'Например: за 47 минут до ядерного удара ты узнаёшь, что в бункере 12 мест, а людей 31', on: () => { }, cls: 'w' }));
  el.append(h('div', { class: 's-row' }, F.sel(aiOpt, 'tone', 'Тон', ['напряжённый, как тревожный репортаж', 'познавательный, с фактами и цифрами', 'смешной, с абсурдным поворотом', 'хоррор, нарастающий страх', 'мотивационный, энергичный', 'драма с неожиданной развязкой'], { on: () => { } }), F.sel(aiOpt, 'len', 'Длина, с', { 15: '15', 30: '30', 45: '45', 60: '60' }, { cls: 's', on: v => { aiOpt.len = +v; } }), F.num(aiOpt, 'scenes', 'Сцен', { min: 3, max: 12, step: 1, on: () => { } }), F.sel(aiOpt, 'lang', 'Язык', ['русский', 'English'], { on: () => { } })));
  el.append(h('div', { class: 's-row' }, F.chk(aiOpt, 'hud', 'Счётчики (HUD)', () => { })));
  el.append(F.text(aiOpt, 'extra', 'Пожелания (необязательно)', { ph: 'герой — девушка, финал с вопросом, больше цифр', on: () => { }, cls: 'w' }));
  el.append(F.text(aiOpt, 'model', 'Модель', { on: () => { }, cls: 'w' }));
  const st = h('div', { class: 's-msg' }); const go = btn('Сгенерировать', async () => { go.disabled = true; st.className = 's-msg'; try { if (!aiOpt.topic.trim()) throw new Error('Напиши тему'); aiOpt.len = +aiOpt.len; const p = await N.AI.generate(aiOpt, s => st.textContent = s); aiMsg = 'Готово: ' + p.scenes.length + ' сцен. Нажми ▶ и поправь во вкладках «Сцены», «Персонажи».'; openNew(p); goStep(1); } catch (e) { st.textContent = e.message; st.className = 's-msg err'; } go.disabled = false; }, 'pri'); if (aiMsg) { st.textContent = aiMsg; st.className = 's-msg ok'; } el.append(h('div', { class: 's-row' }, go)); el.append(st);
  el.append(h('h3', 0, 'Проект')); el.append(F.text(P, 'title', 'Название', { on: () => save(), cls: 'w' }), h('div', { class: 's-row' }, F.text(P, 'series', 'Сюжетная линия', { on: () => save() }), F.num(P, 'part', 'Часть', { min: 1, max: 99, step: 1, cls: 's', on: () => save() })));
  const fi = h('input', { type: 'file', accept: '.json,application/json', hidden: true }); fi.onchange = async () => { try { const p = JSON.parse(await fi.files[0].text()); if (!p.scenes || !p.scenes.length) throw 0; openNew(p); } catch (e) { alert(TR('Это не файл проекта Студии')); } };
  el.append(h('div', { class: 's-row' }, btn('Скачать проект (.json)', () => dl(new Blob([JSON.stringify(P, null, 1)], { type: 'application/json' }), slug() + '.json')), btn('Открыть проект', () => fi.click()), fi));
}
const slug = () => (P.title || 'video').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40) || 'video';
function dl(blob, name) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }

// --- Сцены ---
function pScenes(el) {
  el.append(h('p', { class: 's-note' }, 'Нажми на сцену, чтобы править. Время субтитров, предметов и звуков — в секундах от начала сцены.'));
  el.append(h('div', { class: 's-row' }, btn(tt('Подогнать паузы', 'Trim dead time'), () => { const n = tighten(); tlBuild(); frame(); pane(); const m = h('div', { class: 's-msg ok' }, n ? tt('Подогнано сцен: ' + n + ', ролик ' + total().toFixed(1) + ' с', 'Trimmed ' + n + ' scene(s); video is ' + total().toFixed(1) + ' s') : tt('Лишних пауз нет', 'No dead time')); $('pane').prepend(m); setTimeout(() => m.remove(), 3500); }, 'sm')));
  const list = h('div', { class: 's-sc-list' });
  P.scenes.forEach((s, i) => { const c = h('div', { class: 's-card' + (i === sel ? ' on' : '') }); const hd = h('div', { class: 's-ch' }, h('b', 0, (i + 1) + '. ' + s.name + ' · ' + s.dur + ' с'), btn('↑', e => { e.stopPropagation(); if (move(P.scenes, i, -1)) { sel = i - 1; touch(1); pane(); } }, 'sm'), btn('↓', e => { e.stopPropagation(); if (move(P.scenes, i, 1)) { sel = i + 1; touch(1); pane(); } }, 'sm'), btn('Копия', e => { e.stopPropagation(); P.scenes.splice(i + 1, 0, JSON.parse(JSON.stringify(s))); sel = i + 1; touch(1); pane(); }, 'sm'), btn('✕', e => { e.stopPropagation(); if (P.scenes.length < 2) return; if (confirm(TR('Удалить сцену «' + s.name + '»?'))) { P.scenes.splice(i, 1); sel = Math.max(0, i - 1); touch(1); pane(); } }, 'sm dng')); c.append(hd); c.onclick = () => { if (sel !== i) { sel = i; seek(E.timeline(P)[i].s + .3); pane(); } }; list.append(c); if (i === sel) c.append(sceneEditor(s)); });
  el.append(list); el.append(h('div', { class: 's-row' }, btn('+ Сцена', () => { P.scenes.splice(sel + 1, 0, D.newScene()); sel++; touch(1); pane(); }, 'pri')));
}
function sceneEditor(s) {
  const w = h('div', { onclick: e => e.stopPropagation() });
  w.append(h('div', { class: 's-row' }, F.text(s, 'name', 'Название', { on: () => { touch(1); }, cls: '' }), F.num(s, 'dur', 'Длит., с', { min: 1, max: 40, struct: 1 }), F.sel(s, 'bg', 'Фон', E.BGNAMES, {}), F.num(s.zoom = s.zoom || [1, 1.06], 0, 'Зум с', { min: .8, max: 2 }), F.num(s.zoom, 1, 'Зум до', { min: .8, max: 2 })));
  w.append(h('h3', 0, 'Эффекты')); const fc = h('div', { class: 's-chips' }); s.fx = s.fx || []; for (const [k, n] of Object.entries(E.FXN)) { const c = h('span', { class: 's-chip' + (s.fx.includes(k) ? ' on' : '') }, n); c.onclick = () => { const j = s.fx.indexOf(k); j < 0 ? s.fx.push(k) : s.fx.splice(j, 1); c.classList.toggle('on', j < 0); touch(); }; fc.append(c); } w.append(fc);
  // персонажи
  w.append(h('h3', 0, 'Персонажи в сцене')); s.cast = s.cast || []; const ids = Object.fromEntries(Object.entries(P.chars).map(([k, v]) => [k, v.name || k]));
  s.cast.forEach((m, i) => { const c = h('div', { class: 's-card' }); c.append(h('div', { class: 's-row' }, F.sel(m, 'c', 'Кто', ids, {}), F.sel(m, 'anim', 'Действие', E.ANIMS, {}), F.sel(m, 'expr', 'Эмоция', E.EXPR, {}), btn('✕', () => { s.cast.splice(i, 1); touch(); pane(); }, 'sm dng')), h('div', { class: 's-row' }, F.num(m, 'x', 'X 0–1', { min: 0, max: 1, step: .05 }), F.num(m, 'y', 'Y 0–1', { min: .3, max: 1.1, step: .05 }), F.num(m, 's', 'Размер', { min: .3, max: 1.6, step: .05 }), F.num(m, 'tx', 'Идёт к X', { min: 0, max: 1, step: .05, opt: 1 }), F.num(m, 'enter', 'Входит, с', { min: 0, max: 20, opt: 1 }), F.chk(m, 'flip', 'Отразить'))); w.append(c); });
  w.append(h('div', { class: 's-row' }, btn('+ Персонаж', () => { s.cast.push({ c: Object.keys(P.chars)[0], x: .5, y: .88, s: .95, anim: 'idle', expr: 'calm' }); touch(); pane(); }, 'sm')));
  // предметы
  w.append(h('h3', 0, 'Предметы на экране')); s.props = s.props || [];
  s.props.forEach((p, i) => { const c = h('div', { class: 's-card' }); const rows = [h('div', { class: 's-row' }, F.sel(p, 'type', 'Что', E.PROPS, { on: () => { touch(); pane(); } }), F.num(p, 'x', 'X', { min: 0, max: 1, step: .05 }), F.num(p, 'y', 'Y', { min: 0, max: 1, step: .05 }), F.num(p, 's', 'Масштаб', { min: .3, max: 3, step: .1, opt: 1 }), F.num(p, 'at', 'С, с', { min: 0, max: 40 }), F.num(p, 'dur', 'Длит.', { min: .2, max: 40, opt: 1 }), btn('✕', () => { s.props.splice(i, 1); touch(); pane(); }, 'sm dng'))];
    const ty = p.type; const r2 = h('div', { class: 's-row' });
    if (['popup', 'text', 'timer', 'counter', 'bar', 'math', 'sign', 'emoji', 'icon', 'choice'].includes(ty)) r2.append(F.text(p, 'text', ty === 'emoji' ? 'Эмодзи' : 'Текст', { cls: '' }));
    if (ty === 'popup' || ty === 'choice') r2.append(F.text(p, 'text2', 'Вторая строка'));
    if (ty === 'icon') r2.append(F.sel(p, 'icon', 'Иконка', E.ICONNAMES, {}));
    if (['timer', 'counter', 'bar'].includes(ty)) r2.append(F.num(p, 'from', 'От', { step: 1, opt: 1 }), F.num(p, 'to', 'До', { step: 1, opt: 1 }), F.num(p, 'span', 'За, с', { opt: 1 }));
    if (ty === 'counter') r2.append(F.text(p, 'suffix', 'Подпись числа', { cls: 's' }));
    if (['text', 'emoji', 'icon', 'counter'].includes(ty)) r2.append(F.num(p, 'size', 'Размер', { step: 10, opt: 1 }));
    if (p.type !== 'text') r2.append(F.col(p, 'color', 'Цвет', E.THEMES[P.theme].a));
    rows.push(r2);
    if (ty === 'choice') { const ta = h('textarea', { rows: 4 }); ta.value = (p.items || []).map(o => [o.k, o.text].join(' | ')).join('\n'); ta.oninput = () => { p.items = ta.value.split('\n').filter(x => x.trim()).slice(0, 4).map((l, i) => { const a = l.split('|'); const b = a.slice(1).join('|').trim(); return b ? { k: (a[0] || '').trim().slice(0, 2) || String.fromCharCode(65 + i), text: b } : { k: String.fromCharCode(65 + i), text: l.trim() }; }); touch(); }; rows.push(fld('Варианты: буква | текст', ta, 'w')); }
    if (ty === 'cards') { const ta = h('textarea', { rows: 4 }); ta.value = (p.items || []).map(o => [o.icon, o.label, o.value || ''].join(' | ')).join('\n'); ta.oninput = () => { p.items = ta.value.split('\n').filter(x => x.trim()).map(l => { const [a, b, c] = l.split('|').map(x => x.trim()); return { icon: E.ICONNAMES.includes(a) ? a : 'star', label: b || '', value: c || '' }; }); touch(); }; rows.push(fld('Карточки: иконка | подпись | значение (иконки: ' + E.ICONNAMES.join(', ') + ')', ta, 'w')); }
    if (ty === 'chat') { const ta = h('textarea', { rows: 4 }); ta.value = (p.items || []).map(o => (o.who === 'me' ? tt('я: ', 'me: ') : tt('он: ', 'them: ')) + o.text).join('\n'); ta.oninput = () => { p.items = ta.value.split('\n').filter(x => x.trim()).map(l => { const m = /^(я|me|он|они|them)\s*:\s*(.*)$/i.exec(l); return { who: m && /^(я|me)$/i.test(m[1]) ? 'me' : 'them', text: m ? m[2] : l }; }); touch(); }; rows.push(fld('Сообщения: «я: …» или «он: …», по строке', ta, 'w'), h('div', { class: 's-row' }, F.num(p, 'gap', 'Пауза между, с', { opt: 1 }))); }
    c.append(...rows); w.append(c); });
  w.append(h('div', { class: 's-row' }, btn('+ Предмет', () => { s.props.push({ type: 'popup', text: 'ТЕКСТ', x: .5, y: .35, at: 0.5 }); touch(); pane(); }, 'sm')));
  // субтитры
  w.append(h('h3', 0, 'Субтитры и голос')); w.append(h('p', { class: 's-note' }, 'Слова в *звёздочках* выделяются цветом. Эти же фразы озвучивает нейроголос.')); s.caps = s.caps || [];
  s.caps.forEach((cp, i) => { w.append(h('div', { class: 's-row' }, F.text(cp, 'text', 'Фраза ' + (i + 1), { cls: 'w' }), F.num(cp, 'at', 'С, с', { min: 0 }), F.num(cp, 'dur', 'Длит.', { min: .3 }), btn('✕', () => { s.caps.splice(i, 1); touch(); pane(); }, 'sm dng'))); });
  w.append(h('div', { class: 's-row' }, btn('+ Фраза', () => { const last = s.caps[s.caps.length - 1]; s.caps.push({ at: last ? +(last.at + last.dur).toFixed(2) : 0, dur: 1.5, text: 'НОВАЯ *ФРАЗА*' }); touch(); pane(); }, 'sm'), btn('Разложить по сцене поровну', () => { const n = s.caps.length; if (!n) return; const d = s.dur / n; s.caps.forEach((cp, i) => { cp.at = +(i * d).toFixed(2); cp.dur = +(d - .05).toFixed(2); }); touch(); pane(); }, 'sm')));
  // звуки
  w.append(h('h3', 0, 'Звуки сцены')); s.sfx = s.sfx || [];
  s.sfx.forEach((x, i) => w.append(h('div', { class: 's-row' }, F.sel(x, 'n', 'Звук', A.SFX_NAMES, {}), F.num(x, 'at', 'С, с', { min: 0 }), F.num(x, 'dur', 'Длит.', { min: .3, opt: 1 }), F.num(x, 'v', 'Громк.', { min: 0, max: 2, step: .1, opt: 1 }), btn('▶', () => A.playSfx(x.n, x.v), 'sm'), btn('✕', () => { s.sfx.splice(i, 1); touch(); pane(); }, 'sm dng'))));
  w.append(h('div', { class: 's-row' }, btn('+ Звук', () => { s.sfx.push({ n: 'whoosh', at: 0 }); touch(); pane(); }, 'sm')));
  return w;
}

// --- Персонажи ---
let cpRaf = 0; function stopCharPv() { cancelAnimationFrame(cpRaf); cpRaf = 0; }
const rnd = a => a[Math.floor(Math.random() * a.length)];
function pChars(el) {
  let cur = Object.keys(P.chars)[0]; const wrap = h('div'); el.append(wrap);
  const draw = () => {
    wrap.innerHTML = ''; stopCharPv(); const ids = Object.keys(P.chars); if (!P.chars[cur]) cur = ids[0]; const ch = P.chars[cur];
    wrap.append(h('div', { class: 's-row' }, F.sel({ v: cur }, 'v', 'Персонаж', Object.fromEntries(ids.map(k => [k, P.chars[k].name || k])), { on: v => { cur = v; draw(); } }), btn('+ Новый', () => { const id = 'c' + Date.now().toString(36).slice(-4); P.chars[id] = Object.assign({}, D.hero, { name: 'Персонаж ' + (ids.length + 1), hood: rnd(['#e53935', '#1e88e5', '#8e24aa', '#fb8c00', '#00897b']), hair: rnd(['#222', '#6d4c41', '#c9a227', '#b0381a']) }); cur = id; save(); draw(); }, 'sm'), btn('Удалить', () => { if (ids.length < 2) return; if (confirm(TR('Удалить персонажа? Он пропадёт из сцен.'))) { delete P.chars[cur]; P.scenes.forEach(s => s.cast = (s.cast || []).filter(m => m.c !== cur)); cur = Object.keys(P.chars)[0]; touch(); draw(); } }, 'sm dng')));
    const pv = h('canvas', { width: 380, height: 520 }), an = { v: 'idle' }, ex = { v: 'calm' }; const fs = h('div', { class: 's-fs' });
    fs.append(h('div', { class: 's-row' }, F.text(ch, 'name', 'Имя', { on: () => save(), cls: '' }), F.sel(ch, 'hairStyle', 'Причёска', E.HAIR, { on: () => touch() }), F.sel(ch, 'acc', 'Аксессуар', E.ACC, { on: () => touch() })), h('div', { class: 's-row' }, F.col(ch, 'hood', 'Одежда'), F.col(ch, 'pants', 'Брюки'), F.col(ch, 'hair', 'Волосы'), F.col(ch, 'skin', 'Кожа')), h('div', { class: 's-row' }, F.sel(an, 'v', 'Анимация (показ)', E.ANIMS, { on: () => { } }), F.sel(ex, 'v', 'Эмоция (показ)', E.EXPR, { on: () => { } }), F.chk(ch, 'phoneHold', 'Телефон в руке', () => { ch.hold = ch.phoneHold ? 'phone' : undefined; touch(); })), h('div', { class: 's-row' }, btn('Случайный вид', () => { Object.assign(ch, { hood: rnd(['#e53935', '#1e88e5', '#8e24aa', '#fb8c00', '#00897b', '#546e7a', '#f06292']), pants: rnd(['#283046', '#37474f', '#4e342e', '#212121']), hair: rnd(['#222', '#6d4c41', '#c9a227', '#b0381a', '#5d4037', '#9e9e9e']), skin: rnd(['#f7c8a0', '#e0a878', '#c68a5c', '#8d5a3a', '#fde0c8']), hairStyle: rnd(Object.keys(E.HAIR)), acc: rnd(Object.keys(E.ACC)) }); touch(); draw(); }, 'sm')));
    wrap.append(h('div', { class: 's-cpv' }, pv, fs)); const c2 = pv.getContext('2d'); const T0 = performance.now();
    const lp = () => { if (!pv.isConnected) return; const tt = (performance.now() - T0) / 1000; c2.clearRect(0, 0, 380, 520); c2.fillStyle = '#10131c'; c2.fillRect(0, 0, 380, 520); c2.save(); E.drawChar(c2, ch, 190, 500, .82, tt, an.v, ex.v, false); c2.restore(); cpRaf = requestAnimationFrame(lp); }; lp();
  }; draw();
}

// --- Тема и HUD ---
function pTheme(el) {
  el.append(h('h3', 0, 'Палитра')); const g = h('div', { class: 's-grid' }); for (const [k, th] of Object.entries(E.THEMES)) { const b = h('button', { type: 'button', class: 's-thm' + (P.theme === k ? ' on' : ''), onclick: () => { P.theme = k; touch(); pane(); } }, th.name, h('i', { style: `background:linear-gradient(90deg,${th.sky[0]},${th.a} 40%,${th.b} 70%,${th.hl})` })); g.append(b); } el.append(g);
  el.append(h('h3', 0, 'Субтитры')); P.cap = P.cap || { size: 104, y: .66 }; el.append(h('div', { class: 's-row' }, F.num(P.cap, 'size', 'Размер', { min: 50, max: 160, step: 4 }), F.num(P.cap, 'y', 'Высота 0–1', { min: .2, max: .95, step: .02 }), F.col(P.cap, 'hl', 'Цвет выделения', E.THEMES[P.theme].hl)));
  el.append(h('div', { class: 's-row' }, F.chk(P, 'vignette', 'Виньетка', () => touch())));
  el.append(h('h3', 0, 'HUD: плашки и полоса')); P.hud = P.hud || { on: false, plates: [], bar: null }; const H = P.hud;
  el.append(h('p', { class: 's-note' }, 'Значения меняются по ключевым точкам «секунда:значение» на всём видео. Время — формат мм:сс.'));
  el.append(h('div', { class: 's-row' }, F.chk(H, 'on', 'Показывать HUD', () => touch())));
  for (let i = 0; i < 2; i++) { const p = H.plates[i]; const c = h('div', { class: 's-card' }); if (!p) { c.append(btn('+ Плашка ' + (i + 1), () => { H.plates[i] = { label: 'МЕТКА', fmt: 'num', keys: [[0, 0], [30, 100]] }; H.on = true; touch(); pane(); }, 'sm')); } else { const ks = { v: keysStr(p.keys) }; c.append(h('div', { class: 's-row' }, F.text(p, 'label', 'Подпись ' + (i + 1), {}), F.sel(p, 'fmt', 'Формат', { num: 'Число', time: 'Время мм:сс' }, {}), F.text(p, 'suffix', 'Суффикс', { cls: 's' }), F.col(p, 'color', 'Цвет', i ? E.THEMES[P.theme].b : E.THEMES[P.theme].a), btn('✕', () => { H.plates.splice(i, 1); touch(); pane(); }, 'sm dng')), h('div', { class: 's-row' }, F.text(ks, 'v', 'Точки (сек:значение, через запятую)', { cls: 'w', on: v => { const k = parseKeys(v); if (k.length) { p.keys = k; touch(); } } }))); } el.append(c); }
  const c = h('div', { class: 's-card' }); if (!H.bar) c.append(btn('+ Полоса', () => { H.bar = { label: 'ПОЛОСА', max: 100, mark: null, keys: [[0, 0], [30, 100]] }; H.on = true; touch(); pane(); }, 'sm')); else { const b = H.bar, ks = { v: keysStr(b.keys) }; c.append(h('div', { class: 's-row' }, F.text(b, 'label', 'Подпись полосы', {}), F.num(b, 'max', 'Максимум', { step: 1 }), F.num(b, 'mark', 'Отметка', { step: 1, opt: 1 }), btn('✕', () => { H.bar = null; touch(); pane(); }, 'sm dng')), h('div', { class: 's-row' }, F.text(ks, 'v', 'Точки (сек:значение)', { cls: 'w', on: v => { const k = parseKeys(v); if (k.length) { b.keys = k; touch(); } } }))); } el.append(c);
}

// --- Мои голоса: обученные по примерам (voices/index.json, собирает scripts/voice/voice.py) ---
function voiceLib(el, V) {
  const box = h('div', { class: 's-vlib' }, h('p', { class: 's-note' }, tt('Голоса, обученные по твоим примерам: тембр клонирован, темп и паузы взяты из примера. Новый голос: скинь Claude в чат видео или звук (10–60 с одного человека, лучше без музыки) и напиши, как назвать. Ролик с этим голосом тоже собирает Claude: напиши «озвучь голосом …».', 'Voices trained on your examples: timbre cloned, pace and pauses taken from the example. New voice: send Claude a video or audio clip (10–60 s, one speaker, ideally no music) and a name. Claude also renders videos with these voices.')));
  el.append(box);
  fetch('voices/index.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : []).catch(() => []).then(L => {
    if (!L.length) { box.append(h('p', { class: 's-msg' }, tt('Пока нет обученных голосов.', 'No trained voices yet.'))); return; }
    for (const v of L) {
      const s = v.style || {}, on = V.voiceId === v.id;
      const pick = h('button', { class: 's-btn sm' + (on ? ' pri' : ''), onclick: () => { V.voiceId = v.id; V.on = true; save(); pane(); } }, on ? tt('✓ Выбран', '✓ Selected') : tt('Выбрать', 'Select'));
      const meta = tt(`темп ×${s.speed || 1} · пауза после фразы ${s.pause_sentence ?? '–'} с · короткие фразы ×${s.short_slow || 1}`, `pace ×${s.speed || 1} · sentence pause ${s.pause_sentence ?? '–'} s · short lines ×${s.short_slow || 1}`);
      const au = (src, lab) => src ? h('div', { class: 's-vau' }, h('span', 0, lab), h('audio', { controls: true, preload: 'none', src })) : null;
      box.append(h('div', { class: 's-vcard' + (on ? ' on' : '') }, h('div', { class: 's-vhead' }, h('b', 0, v.name), pick), v.desc ? h('p', { class: 's-note' }, v.desc) : null, h('p', { class: 's-msg' }, meta), au(v.example, tt('Пример', 'Example')), au(v.test, tt('Как говорит клон', 'Clone'))));
    }
  });
}

// --- Голос ---
function pVoice(el) {
  const V = P.voice = P.voice || { on: false, provider: 'elevenlabs', voiceId: '', model: '', speed: 1 }; delete V.key;
  if (V.provider !== 'clone') el.append(h('p', { class: 's-note' }, 'Нейроголос озвучивает субтитры. Нужен ключ сервиса: он хранится только в этом браузере и уходит только в сам сервис. Каждая фраза заказывается один раз и кэшируется на устройстве. Услуга платная по тарифу сервиса.'));
  el.append(h('div', { class: 's-row' }, F.chk(V, 'on', 'Озвучивать ролик', () => { touch(); }), F.sel(V, 'provider', 'Сервис', { clone: tt('Мои голоса (обученные)', 'My voices (trained)'), elevenlabs: 'ElevenLabs', openai: 'OpenAI TTS', piper: tt('Бесплатный (в браузере)', 'Free (in browser)') }, { on: () => { V.voiceId = ''; V.model = ''; save(); pane(); }, cls: '' })));
  const kn = V.provider === 'openai' ? 'openai' : 'eleven'; const kb = h('div', { class: 's-kbox' }); const ki = h('input', { type: 'password', placeholder: V.provider === 'openai' ? 'sk-…' : 'ключ ElevenLabs', autocomplete: 'off' }); ki.value = N.Keys.get(kn); ki.oninput = () => N.Keys.set(kn, ki.value.trim()); kb.append(fld('Ключ ' + (V.provider === 'openai' ? 'OpenAI' : 'ElevenLabs'), ki, 'w')); if (V.provider !== 'piper' && V.provider !== 'clone') el.append(kb);
  const st = h('div', { class: 's-msg' });
  if (V.provider === 'piper') { if (!V.voiceId) V.voiceId = 'ru_RU-irina-medium'; el.append(h('p', { class: 's-note' }, tt('Бесплатно и без лимитов: голос работает прямо в браузере. Первый раз скачивается модель (десятки МБ), дальше быстро. Звучит ровнее, чем ElevenLabs.', 'Free and unlimited: the voice runs in your browser. The model downloads once (tens of MB). Sounds flatter than ElevenLabs.')), h('div', { class: 's-row' }, F.sel(V, 'voiceId', 'Голос', N.PIPER_VOICES, { on: () => save() }))); }
  if (V.provider === 'piper' || V.provider === 'clone') { /* голос выбран ниже/выше */ }
  else if (V.provider === 'openai') { el.append(h('div', { class: 's-row' }, F.sel(V, 'voiceId', 'Голос', ['', ...N.OPENAI_VOICES].map(x => x || 'onyx').filter((x, i, a) => a.indexOf(x) === i), { on: () => save() }), F.sel(V, 'model', 'Модель', { '': 'gpt-4o-mini-tts', 'tts-1': 'tts-1', 'tts-1-hd': 'tts-1-hd' }, { on: () => save() }))); if (!V.voiceId) V.voiceId = 'onyx'; el.append(F.text(V, 'tone', 'Манера речи (только gpt-4o-mini-tts)', { ph: 'Говори тревожно, быстро, как диктор новостей', cls: 'w', on: () => save() })); }
  else { const sv = h('select'); sv.append(h('option', { value: V.voiceId || '' }, V.voiceId || 'Голос не выбран')); sv.value = V.voiceId || ''; sv.onchange = () => { V.voiceId = sv.value; save(); }; el.append(h('div', { class: 's-row' }, fld('Голос', sv, ''), btn('Загрузить мои голоса', async () => { st.className = 's-msg'; st.textContent = 'Загружаю…'; try { const vs = await N.TTS.voices(); sv.innerHTML = ''; vs.forEach(v => sv.append(h('option', { value: v.id }, v.name + (v.lang ? ' · ' + v.lang : '')))); sv.value = V.voiceId && vs.some(v => v.id === V.voiceId) ? V.voiceId : (vs[0] && vs[0].id) || ''; V.voiceId = sv.value; save(); st.textContent = 'Голосов: ' + vs.length; st.className = 's-msg ok'; } catch (e) { st.textContent = e.message; st.className = 's-msg err'; } }, 'sm'))); el.append(h('div', { class: 's-row' }, F.text(V, 'voiceId', 'или вставь ID голоса', { on: () => save(), cls: '' }), F.sel(V, 'model', 'Модель', { '': 'eleven_multilingual_v2', eleven_turbo_v2_5: 'eleven_turbo_v2_5', eleven_flash_v2_5: 'eleven_flash_v2_5' }, { on: () => save() }))); }
  if (V.provider === 'clone') voiceLib(el, V);
  el.append(h('div', { class: 's-row' }, F.num(V, 'speed', 'Скорость', { min: .7, max: 1.3, step: .05, on: () => save() })));
  const pr = h('div', { class: 's-prog' }, h('i')); pr.hidden = true;
  el.append(h('div', { class: 's-row' }, btn('Проба голоса', async () => { st.className = 's-msg'; st.textContent = 'Синтез…'; try { const b = await N.TTS.clip(V, 'Через три минуты дверь закроется сама.', true); const ctx = A.init(), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(); st.textContent = 'Играет'; st.className = 's-msg ok'; } catch (e) { st.textContent = e.message; st.className = 's-msg err'; } }, 'sm'), btn('Озвучить весь ролик и подогнать тайминги', async function () { st.className = 's-msg'; pr.hidden = false; try { V.on = true; await N.TTS.all(P, (n, m, tx) => { pr.firstChild.style.width = (m ? n / m * 100 : 0) + '%'; st.textContent = n + ' из ' + m + (tx ? ': ' + tx : ''); }); st.textContent = 'Готово. Длительность сцен подогнана под речь, ролик ' + total().toFixed(1) + ' с.'; st.className = 's-msg ok'; tlBuild(); frame(); hud(); save(); await refreshClips(); } catch (e) { st.textContent = e.message; st.className = 's-msg err'; } }, 'sm pri'), btn('Очистить кэш озвучки', async () => { await N.DB.clear(); N.TTS.buf = {}; clips = {}; st.textContent = 'Кэш очищен'; }, 'sm dng')));
  el.append(pr, st);
}

// --- Звук ---
function pSound(el) {
  P.music = P.music || { style: 'none', vol: .5 };
  el.append(h('h3', 0, 'Музыка')); el.append(h('div', { class: 's-row' }, F.sel(P.music, 'style', 'Стиль', A.MUSIC_NAMES, { on: () => save() }), F.num(P.music, 'vol', 'Громкость 0–1', { min: 0, max: 1, step: .05, on: () => save() }), F.chk(P.music, 'duck', 'Приглушать под голос', () => save())));
  if (P.music.duck === undefined) P.music.duck = true;
  el.append(h('div', { class: 's-row' }, btn('▶ Послушать стиль', () => A.playMusic(P.music.style, P.music.vol), 'sm'), btn('■ Стоп', () => A.stopPreview(), 'sm')));
  el.append(h('h3', 0, 'Библиотека звуков')); el.append(h('p', { class: 's-note' }, 'Нажми, чтобы послушать. Добавлять в сцену — во вкладке «Сцены», блок «Звуки сцены».')); const g = h('div', { class: 's-sfx' }); for (const [k, n] of Object.entries(A.SFX_NAMES)) g.append(btn('▶ ' + n, () => A.playSfx(k), 'sm')); el.append(g);
}

// --- Выпуск ---
function hashtags() { const txt = P.scenes.flatMap(sc => sc.caps.map(c => E.stripCap(c.text))).join(' ').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' '); const cnt = {}; txt.split(/\s+/).filter(w => w.length >= 5).forEach(w => cnt[w] = (cnt[w] || 0) + 1); const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => '#' + x[0]); return top.concat(I.lang === 'en' ? ['#reels', '#fyp'] : ['#рилс', '#рекомендации']).join(' '); }
function postText() { const first = P.scenes[0] && P.scenes[0].caps[0] ? E.stripCap(P.scenes[0].caps[0].text) : ''; const low = first.charAt(0) + first.slice(1).toLowerCase(); return (P.title || '') + (low ? ' — ' + low + '…' : '') + '\n\n' + tt('Досмотри до конца 👇', 'Watch till the end 👇') + '\n\n' + hashtags(); }
function checks() {
  const T = total(), out = [], cap = P.cap || { size: 104, y: .66 };
  out.push(T > 90 ? [0, tt('Длина ' + T.toFixed(0) + ' с — Reels принимает до 90 с', T.toFixed(0) + ' s — Reels accept up to 90 s')] : T < 7 ? [0, tt('Длина ' + T.toFixed(0) + ' с — коротковато, лучше 7–60 с', T.toFixed(0) + ' s — a bit short, 7–60 s works best')] : [1, tt('Длина ' + T.toFixed(0) + ' с — подходит для Reels', T.toFixed(0) + ' s — good length for Reels')]);
  const c0 = P.scenes[0] && P.scenes[0].caps[0]; out.push(c0 && c0.at <= 1.5 && c0.text && c0.text !== '...' ? [1, tt('Крючок: фраза появляется в первые 1,5 с', 'Hook: a line appears in the first 1.5 s')] : [0, tt('Крючок: добавь фразу в самом начале (первые 1,5 с)', 'Hook: add a line at the very start (first 1.5 s)')]);
  const lines = 2, bottom = (cap.y == null ? .72 : cap.y) + (cap.size * 1.12 * lines / 2) / 1920;
  out.push(bottom <= .74 ? [1, tt('Субтитры в безопасной зоне Instagram', 'Captions are inside the Instagram safe zone')] : [0, tt('Субтитры внизу закроются подписью и кнопками Instagram', 'Bottom captions will be covered by Instagram’s caption and buttons'), () => { cap.y = .62; P.cap = cap; touch(); pane(); }, tt('Поднять', 'Raise')]);
  const snd = (P.music && P.music.style && P.music.style !== 'none') || (P.voice && P.voice.on); out.push(snd ? [1, tt('Звук: музыка или голос включены', 'Sound: music or voice is on')] : [0, tt('Тишина: добавь музыку или голос', 'Silent: add music or a voice'), () => goStep(3, 'sound'), tt('К звуку', 'To sound')]);
  const sl = slack(); out.push(sl ? [0, tt(sl + ' сцен с паузой дольше 1,3 с в конце — ролик тянется', sl + ' scene(s) end with a pause over 1.3 s — the video drags'), () => { tighten(); frame(); tlBuild(); pane(); }, tt('Подогнать', 'Tighten')] : [1, tt('Темп: без мёртвых пауз', 'Pace: no dead pauses')]);
  const empty = P.scenes.filter(sc => !sc.caps.some(c => c.text && c.text !== '...')).length; out.push(empty ? [0, tt(empty + ' сцен без текста — зритель уйдёт', empty + ' scene(s) without text — viewers may leave'), () => goStep(1, 'scenes'), tt('К сценам', 'To scenes')] : [1, tt('В каждой сцене есть текст', 'Every scene has text')]);
  return out;
}
function pPublish(el) {
  const o = { res: '720' }; el.append(h('p', { class: 's-lead' }, tt('Проверь ролик, запиши видео и забери текст для поста.', 'Check the video, record it, and grab the post text.')));
  el.append(h('h3', 0, tt('Проверка перед публикацией', 'Pre-publish check')));
  const ig = $('ig'); if (ig.hidden) { ig.hidden = false; $('igbtn').classList.add('on'); }
  for (const [ok, msg, fix, fl] of checks()) el.append(h('div', { class: 's-ck' + (ok ? '' : ' bad') }, h('span', { class: 'ic' }, ok ? '✓' : '!'), h('span', { class: 't' }, msg), fix ? btn(fl, fix, 'sm') : null));
  el.append(h('h3', 0, tt('Записать видео', 'Record video')));
  el.append(h('p', { class: 's-note' }, 'Запись идёт в реальном времени: ролик проигрывается и записывается вместе со звуком, поэтому не сворачивай вкладку, пока идёт запись. Chrome и Edge дают MP4 или WebM; Safari — MP4.'));
  el.append(h('div', { class: 's-row' }, F.sel(o, 'res', 'Размер', { 540: '540×960 (быстро, лёгкий)', 720: '720×1280 (по умолчанию)', 1080: '1080×1920 (максимум)' }, { on: () => { }, cls: '' })));
  const st = h('div', { class: 's-msg' }), pr = h('div', { class: 's-prog' }, h('i')), res = h('div', { class: 's-res' }); pr.hidden = true;
  const rb = btn('● ' + tt('Записать видео', 'Record video'), async () => { rb.disabled = true; res.innerHTML = ''; pr.hidden = false; $('ig').hidden = true; $('igbtn').classList.remove('on'); st.className = 's-msg'; try { const out = await record(+o.res, 30, p => { pr.firstChild.style.width = p * 100 + '%'; st.textContent = 'Запись… ' + Math.round(p * 100) + '%'; }); const ext = /mp4/.test(out.type) ? 'mp4' : 'webm'; const url = URL.createObjectURL(out); res.append(h('video', { src: url, controls: true, playsinline: true }), btn('Скачать .' + ext + ' (' + (out.size / 1048576).toFixed(1) + ' МБ)', () => dl(out, slug() + '.' + ext), 'pri')); st.textContent = 'Готово'; st.className = 's-msg ok'; } catch (e) { st.textContent = e.message; st.className = 's-msg err'; } pr.hidden = true; rb.disabled = false; }, 'pri big');
  el.append(h('div', { class: 's-row' }, rb, btn('Сохранить текущий кадр (PNG)', () => { const c = document.createElement('canvas'); c.width = 1080; c.height = 1920; const x = c.getContext('2d'); E.drawScene(x, P, Math.min(t, total() - .01)); c.toBlob(b => dl(b, slug() + '_' + t.toFixed(1) + 's.png')); })), pr, st, res);
  el.append(h('h3', 0, tt('Текст для поста', 'Post text')));
  const ta = h('textarea', { class: 's-post', rows: 6 }); ta.value = postText();
  el.append(ta, h('div', { class: 's-row' }, btn(tt('Скопировать', 'Copy'), async () => { try { await navigator.clipboard.writeText(ta.value); } catch (e) { ta.select(); document.execCommand('copy'); } }, 'sm'), btn(tt('Обновить', 'Regenerate'), () => { ta.value = postText(); }, 'sm')));
  el.append(h('h3', 0, tt('Что дальше?', 'What next?')), h('div', { class: 's-row' }, btn('✦ ' + tt('Креатив: варианты продолжения', 'Creative: ways to continue'), openCreative, 'pri')));
  el.append(h('p', { class: 's-note' }, tt('Загрузи файл в Instagram: «Создать» → Reels → выбери видео из галереи. Проект хранится в этом браузере; сохрани его файлом на вкладке «Идея».', 'Upload the file in Instagram: Create → Reels → pick the video from your gallery. The project lives in this browser; save it as a file in the “Idea” step.')));
}
function pickMime() { const c = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']; return c.find(m => G.MediaRecorder && MediaRecorder.isTypeSupported(m)) || ''; }
async function record(width, fps, onp) {
  if (!G.MediaRecorder) throw new Error('Этот браузер не умеет записывать видео');
  pause(); await refreshClips(); const hgt = Math.round(width * 16 / 9), c = document.createElement('canvas'); c.width = width; c.height = hgt; const x = c.getContext('2d'); const T = total();
  const vs = c.captureStream(fps), as = A.recStream; const stream = new MediaStream([...vs.getVideoTracks(), ...as.getAudioTracks()]); const mime = pickMime(); const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: width >= 1080 ? 10e6 : 6e6, audioBitsPerSecond: 160000 }); const chunks = []; rec.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
  const done = new Promise((res, rej) => { rec.onstop = res; rec.onerror = e => rej(e.error || new Error('Ошибка записи')); });
  const draw = tt => { x.setTransform(width / E.W, 0, 0, hgt / E.H, 0, 0); E.drawScene(x, P, Math.min(tt, T - .001)); };
  draw(0); rec.start(250); recording = true; t = 0; A.start(P, 0, clips); const w0 = performance.now();
  await new Promise(res => { const step = () => { const tt = (performance.now() - w0) / 1000; draw(tt); t = Math.min(tt, T); frame(); hud(); onp && onp(Math.min(1, tt / (T + .4))); if (tt >= T + .4) return res(); setTimeout(step, 1000 / fps - 2); }; step(); });
  A.stop(); await new Promise(r => setTimeout(r, 250)); rec.stop(); await done; recording = false; t = 0;
  return new Blob(chunks, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] });
}

// ---------- старт ----------
P = load(); hdr(); staticApply(); tabs(); tlBuild(); frame(); hud(); pane(); I.trNode($('sw')); I.watch($('sw'));
try { if (localStorage.getItem('studio:ig') === '1') { $('ig').hidden = false; $('igbtn').classList.add('on'); } } catch (e) {}
G.Studio = { get P() { return P; }, get lib() { return lib; }, openNew, openId, setProject, seek, play, pause, frame, record, N };
})(window);
