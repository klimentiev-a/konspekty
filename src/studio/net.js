/* Студия: ключи, нейроголос (ElevenLabs / OpenAI), сценарий через Claude API. Ключи лежат только в localStorage этого браузера. */
(function (G) {
'use strict';
const E = G.StudioEngine, A = G.StudioAudio, D = G.StudioData;
const Keys = {
  all() { try { return JSON.parse(localStorage.getItem('studio:keys') || '{}'); } catch (e) { return {}; } },
  get(k) { return this.all()[k] || ''; },
  set(k, v) { const a = this.all(); if (v) a[k] = v; else delete a[k]; try { localStorage.setItem('studio:keys', JSON.stringify(a)); } catch (e) {} }
};
// IndexedDB-кэш озвучки: одна и та же фраза не оплачивается дважды
const DB = {
  open() { return this._p || (this._p = new Promise((res, rej) => { try { const r = indexedDB.open('studio', 1); r.onupgradeneeded = () => r.result.createObjectStore('tts'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } })); },
  async get(k) { try { const db = await this.open(); return await new Promise(res => { const q = db.transaction('tts').objectStore('tts').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } },
  async set(k, v) { try { const db = await this.open(); await new Promise(res => { const tx = db.transaction('tts', 'readwrite'); tx.objectStore('tts').put(v, k); tx.oncomplete = res; tx.onerror = res; }); } catch (e) {} },
  async clear() { try { const db = await this.open(); await new Promise(res => { const tx = db.transaction('tts', 'readwrite'); tx.objectStore('tts').clear(); tx.oncomplete = res; tx.onerror = res; }); } catch (e) {} }
};
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];
const TTS = {
  buf: {},
  key(v, text) { return [v.provider, v.voiceId || '', v.model || '', v.speed || 1, v.tone || '', E.stripCap(text)].join('|'); },
  async voices() { const k = Keys.get('eleven'); if (!k) throw new Error('Нет ключа ElevenLabs'); const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': k } }); if (!r.ok) throw new Error('ElevenLabs: ' + r.status + ' ' + (await r.text()).slice(0, 160)); const j = await r.json(); return (j.voices || []).map(x => ({ id: x.voice_id, name: x.name, lang: (x.labels && (x.labels.language || x.labels.accent)) || '' })); },
  async fetchAudio(v, text) {
    text = E.stripCap(text);
    if (v.provider === 'openai') {
      const k = Keys.get('openai'); if (!k) throw new Error('Нет ключа OpenAI');
      const body = { model: v.model || 'gpt-4o-mini-tts', voice: v.voiceId || 'onyx', input: text, response_format: 'mp3', speed: v.speed || 1 };
      if (v.tone && /mini-tts/.test(body.model)) body.instructions = v.tone;
      const r = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('OpenAI: ' + r.status + ' ' + (await r.text()).slice(0, 160)); return r.arrayBuffer();
    }
    const k = Keys.get('eleven'); if (!k) throw new Error('Нет ключа ElevenLabs'); if (!v.voiceId) throw new Error('Не выбран голос ElevenLabs');
    const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(v.voiceId) + '?output_format=mp3_44100_128', { method: 'POST', headers: { 'xi-api-key': k, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, model_id: v.model || 'eleven_multilingual_v2', voice_settings: { stability: .45, similarity_boost: .8, style: .3, speed: Math.min(1.2, Math.max(.7, v.speed || 1)) } }) });
    if (!r.ok) throw new Error('ElevenLabs: ' + r.status + ' ' + (await r.text()).slice(0, 160)); return r.arrayBuffer();
  },
  // вернуть AudioBuffer из памяти/кэша; make=true — при отсутствии заказать у сервиса
  async clip(v, text, make) {
    const k = this.key(v, text); if (this.buf[k]) return this.buf[k];
    let ab = await DB.get(k);
    if (!ab && make) { ab = await this.fetchAudio(v, text); await DB.set(k, ab); }
    if (!ab) return null; const b = await A.decode(ab); this.buf[k] = b; return b;
  },
  // карта clips для проигрывателя: только то, что уже есть
  async cached(P) { const out = {}; if (!P.voice || !P.voice.on) return out; for (let si = 0; si < P.scenes.length; si++) for (let ci = 0; ci < (P.scenes[si].caps || []).length; ci++) { const b = await this.clip(P.voice, P.scenes[si].caps[ci].text, false); if (b) out[si + ':' + ci] = b; } return out; },
  // озвучить все субтитры и подогнать тайминги под длину речи
  async all(P, onProgress) {
    const v = P.voice, items = []; P.scenes.forEach((sc, si) => (sc.caps || []).forEach((cp, ci) => items.push([si, ci, cp])));
    const lens = {}; let n = 0;
    for (const [si, ci, cp] of items) { onProgress && onProgress(n, items.length, cp.text); const b = await this.clip(v, cp.text, true); lens[si + ':' + ci] = b.duration; n++; }
    onProgress && onProgress(n, items.length, '');
    P.scenes.forEach((sc, si) => { let at = .15; (sc.caps || []).forEach((cp, ci) => { const d = lens[si + ':' + ci]; cp.at = +at.toFixed(2); cp.dur = +(d + .25).toFixed(2); at += d + .3; }); sc.dur = +Math.max(sc.dur, at + .3).toFixed(2); });
    return lens;
  }
};

const AI = {
  schema() {
    return `Ты — сценарист коротких вертикальных видео (Reels/Shorts/TikTok) в стиле «текст на экране + персонаж + напряжение/факт». Верни ТОЛЬКО один JSON-объект без пояснений и без markdown.
Формат:
{"title":"...","theme":"${Object.keys(E.THEMES).join('|')}","chars":{"hero":{"name":"...","hood":"#rrggbb","hair":"#rrggbb","skin":"#rrggbb","pants":"#rrggbb","hairStyle":"${Object.keys(E.HAIR).join('|')}","acc":"${Object.keys(E.ACC).join('|')}"}},
"music":{"style":"${Object.keys(A.MUSIC_NAMES).join('|')}"},
"hud":{"on":true|false,"plates":[{"label":"ДО УДАРА","fmt":"time|num","suffix":"","keys":[[секунда,значение],...],"color":"#rrggbb"}],"bar":{"label":"...","max":число,"mark":число|null,"keys":[[секунда,значение],...]}|null},
"scenes":[{"name":"...","dur":секунды,"bg":"${Object.keys(E.BGNAMES).join('|')}","zoom":[1,1.1],"fx":[из: ${Object.keys(E.FXN).join(', ')}],
 "cast":[{"c":"hero","x":0..1,"y":0.8..0.95,"s":0.8..1.1,"anim":"${Object.keys(E.ANIMS).join('|')}","expr":"${Object.keys(E.EXPR).join('|')}","flip":false}],
 "props":[{"type":"${Object.keys(E.PROPS).join('|')}","text":"...","text2":"...","x":0..1,"y":0.2..0.5,"at":сек от начала сцены,"dur":сек,"icon":"${E.ICONNAMES.join('|')}","items":[...],"from":0,"to":0}],
 "caps":[{"at":сек от начала сцены,"dur":сек,"text":"КОРОТКАЯ ФРАЗА С *ВЫДЕЛЕННЫМ* СЛОВОМ"}],
 "sfx":[{"n":"${Object.keys(A.SFX_NAMES).join('|')}","at":сек,"dur":сек для steps/siren/tick/crowd/riser/geiger}]}]}
Правила: субтитры КАПСОМ, 2–5 слов, одна мысль, ключевое слово в *звёздочках*; сцены 3–6 секунд, фразы внутри сцены подряд без разрывов; первая фраза — крючок, последняя — вопрос или поворот; у каждой сцены свой фон и 2–5 звуков; сумма dur сцен = запрошенной длине. Если уместно, финал — выбор зрителей: prop choice с text «ЧТО ДЕЛАЕШЬ?», text2 «ПИШИ A, B ИЛИ C», items=[{"k":"A","text":"..."},…] из 2–3 вариантов. Предметы: cards.items=[{"icon","label","value","color"}], chat.items=[{"who":"me|them","text"}], timer from/to в секундах, counter from/to. Пиши на запрошенном языке, коротко и конкретно, без воды.`;
  },
  async ideas(ctx, lang, model) {
    const k = Keys.get('anthropic'); if (!k) throw new Error('Нет ключа Claude API (вкладка «Сценарий»)');
    const en = lang === 'en';
    const sys = (en ? 'You are a showrunner for short vertical videos (Reels). Reply with ONE JSON array only, no markdown. ' : 'Ты — шоураннер коротких вертикальных видео (Reels). Верни ТОЛЬКО один JSON-массив, без markdown. ') + (en ? 'Exactly 4 different continuation ideas, each {"kind":"twist|escalation|flashback|other-side|ending|choice","title":"short title of the next episode","logline":"1-2 sentences what happens","hook":"first on-screen line, ALL CAPS, 2-5 words"}. Ideas must differ in direction, follow from the last scene and keep the heroes.' : 'Ровно 4 разных идеи продолжения, каждая {"kind":"twist|escalation|flashback|other-side|ending|choice","title":"короткое название следующей серии","logline":"1–2 предложения, что происходит","hook":"первая фраза на экране КАПСОМ, 2–5 слов"}. Идеи должны идти в разные стороны, вытекать из последней сцены и сохранять героев.');
    const user = (en ? 'Episode: ' : 'Серия: ') + ctx.title + '\n' + (en ? 'Characters: ' : 'Герои: ') + ctx.names + '\n' + (en ? 'What happened:\n' : 'Что было:\n') + ctx.sc;
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'content-type': 'application/json' }, body: JSON.stringify({ model: model || 'claude-sonnet-5-5', max_tokens: 1800, system: sys, messages: [{ role: 'user', content: user }] }) });
    if (!r.ok) throw new Error('Claude API: ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const j = await r.json(); const text = (j.content || []).map(b => b.text || '').join(''); const a = text.indexOf('['), b = text.lastIndexOf(']'); if (a < 0 || b < a) throw new Error('Ответ без JSON');
    let arr; try { arr = JSON.parse(text.slice(a, b + 1)); } catch (e) { throw new Error('Не удалось разобрать JSON: ' + e.message); }
    return arr.slice(0, 4).map(x => ({ kind: String(x.kind || 'other').slice(0, 20), title: String(x.title || '').slice(0, 80), logline: String(x.logline || '').slice(0, 300), hook: String(x.hook || '').slice(0, 60) })).filter(x => x.title);
  },
  async generate(opt, onStatus) {
    const k = Keys.get('anthropic'); if (!k) throw new Error('Нет ключа Claude API (вкладка «Сценарий»)');
    const user = `Тема: ${opt.topic}\nТон/жанр: ${opt.tone}\nДлительность: ${opt.len} секунд\nЯзык: ${opt.lang}\nСцен: примерно ${opt.scenes}\nHUD (плашки со счётчиками): ${opt.hud ? 'нужен, если подходит теме' : 'не нужен'}\n${opt.extra ? 'Пожелания: ' + opt.extra : ''}`;
    onStatus && onStatus('Запрос к Claude…');
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'content-type': 'application/json' }, body: JSON.stringify({ model: opt.model || 'claude-sonnet-5-5', max_tokens: 8000, system: this.schema(), messages: [{ role: 'user', content: user }] }) });
    if (!r.ok) throw new Error('Claude API: ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const j = await r.json(); const text = (j.content || []).map(b => b.text || '').join('');
    return this.parse(text, opt);
  },
  parse(text, opt) {
    const a = text.indexOf('{'), b = text.lastIndexOf('}'); if (a < 0 || b < a) throw new Error('Ответ без JSON');
    let o; try { o = JSON.parse(text.slice(a, b + 1)); } catch (e) { throw new Error('Не удалось разобрать JSON: ' + e.message); }
    return this.sanitize(o, opt);
  },
  sanitize(o, opt) {
    const P = D.T.blank(); const col = (c, d) => /^#[0-9a-f]{6}$/i.test(c || '') ? c : d;
    const pick = (v, list, d) => (list.includes(v) ? v : d), num = (v, d, a, b) => { v = +v; return isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
    P.title = String(o.title || (opt && opt.topic) || 'Видео').slice(0, 80); P.theme = pick(o.theme, Object.keys(E.THEMES), 'bunker');
    P.music = { style: pick(o.music && o.music.style, Object.keys(A.MUSIC_NAMES), 'tension'), vol: .5 };
    P.chars = {}; Object.entries(o.chars || {}).slice(0, 6).forEach(([id, c]) => { P.chars[String(id).slice(0, 20)] = { name: String(c.name || id).slice(0, 30), hood: col(c.hood, '#4caf50'), hair: col(c.hair, '#46281e'), skin: col(c.skin, '#f7c8a0'), pants: col(c.pants, '#283046'), hairStyle: pick(c.hairStyle, Object.keys(E.HAIR), 'short'), acc: pick(c.acc, Object.keys(E.ACC), 'none') }; });
    if (!Object.keys(P.chars).length) P.chars.hero = Object.assign({}, D.hero); const cid = Object.keys(P.chars)[0];
    const h = o.hud || {}; const keys = k => Array.isArray(k) ? k.filter(x => Array.isArray(x) && isFinite(x[0]) && isFinite(x[1])).map(x => [+x[0], +x[1]]) : [];
    P.hud = { on: !!h.on, plates: (h.plates || []).slice(0, 2).map(p => ({ label: String(p.label || '').slice(0, 24), fmt: p.fmt === 'time' ? 'time' : 'num', suffix: String(p.suffix || '').slice(0, 6), keys: keys(p.keys).length ? keys(p.keys) : [[0, 0]], color: col(p.color, undefined) })), bar: h.bar ? { label: String(h.bar.label || '').slice(0, 24), max: num(h.bar.max, 100, 1, 1e9), mark: h.bar.mark == null ? null : num(h.bar.mark, 0, 0, 1e9), keys: keys(h.bar.keys).length ? keys(h.bar.keys) : [[0, 0]] } : null };
    if (!P.hud.plates.length && !P.hud.bar) P.hud.on = false;
    P.scenes = (o.scenes || []).slice(0, 14).map((s, i) => {
      const sc = D.newScene(); sc.name = String(s.name || 'Сцена ' + (i + 1)).slice(0, 40); sc.dur = num(s.dur, 4, 1.5, 20); sc.bg = pick(s.bg, Object.keys(E.BG), 'gradient');
      sc.zoom = Array.isArray(s.zoom) ? [num(s.zoom[0], 1, .8, 1.6), num(s.zoom[1], 1.08, .8, 1.6)] : [1, 1.08]; sc.fx = (s.fx || []).filter(f => E.FXN[f]);
      sc.cast = (s.cast || []).slice(0, 4).map(m => ({ c: P.chars[m.c] ? m.c : cid, x: num(m.x, .5, 0, 1), y: num(m.y, .88, .5, 1), s: num(m.s, .95, .3, 1.5), anim: pick(m.anim, Object.keys(E.ANIMS), 'idle'), expr: pick(m.expr, Object.keys(E.EXPR), 'calm'), flip: !!m.flip }));
      sc.props = (s.props || []).slice(0, 5).filter(p => E.PROPS[p.type]).map(p => ({ type: p.type, text: String(p.text || '').slice(0, 80), text2: String(p.text2 || '').slice(0, 80), x: num(p.x, .5, 0, 1), y: num(p.y, .38, 0, 1), at: num(p.at, 0, 0, 30), dur: p.dur == null ? undefined : num(p.dur, 3, .3, 30), icon: pick(p.icon, E.ICONNAMES, 'star'), items: Array.isArray(p.items) ? p.items.slice(0, 5) : undefined, from: p.from, to: p.to, color: p.color && col(p.color, undefined) }));
      sc.caps = (s.caps || []).slice(0, 6).filter(c => c && c.text).map(c => ({ at: num(c.at, 0, 0, 30), dur: num(c.dur, 1.5, .4, 20), text: String(c.text).toUpperCase().slice(0, 70) }));
      if (!sc.caps.length) sc.caps = [{ at: 0, dur: Math.max(1, sc.dur - .3), text: '...' }];
      sc.sfx = (s.sfx || []).slice(0, 8).filter(x => A.SFX_NAMES[x.n]).map(x => ({ n: x.n, at: num(x.at, 0, 0, 30), dur: x.dur ? num(x.dur, 3, .3, 20) : undefined })); return sc;
    });
    if (!P.scenes.length) throw new Error('В ответе нет сцен');
    return P;
  }
};
G.StudioNet = { Keys, DB, TTS, AI, OPENAI_VOICES };
})(window);
