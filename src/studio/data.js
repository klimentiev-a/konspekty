/* Студия: шаблоны проектов и значения по умолчанию */
(function (G) {
'use strict';
const cap = (at, dur, text) => ({ at, dur, text });
const hero = { name: 'Герой', hood: '#4caf50', hair: '#46281e', skin: '#f7c8a0', pants: '#283046', hairStyle: 'short', acc: 'none' };
const T = {};
T.bunker = () => ({ v: 1, title: 'Ты тринадцатый', theme: 'bunker', vignette: true, outFade: false, handheld: true,
  hud: { on: true, plates: [],
    bar: { label: 'ЛЮДЕЙ У ДВЕРИ', max: 30, mark: 12, keys: [[0, 0], [11.4, 1], [13.4, 30], [40, 30]] } },
  chars: { hero: { name: 'Ты', hood: '#5c6bc0', hair: '#3b2a22', skin: '#f2c6a0', pants: '#263042', hairStyle: 'short', acc: 'tie' }, guard: { name: 'Охранник', hood: '#37474f', hair: '#222', skin: '#e0a878', pants: '#263238', hairStyle: 'cap', acc: 'beard' } },
  cap: { size: 104, y: .66, pop: 'word' }, music: { style: 'thriller', vol: .5 }, voice: { on: false, provider: 'elevenlabs', voiceId: '', model: '', speed: 1, key: '' },
  scenes: [
    { name: 'Офис', dur: 3, bg: 'office', zoom: [1.12, 1], tr: 'fade', fx: ['dust'],
      cast: [{ c: 'hero', x: .5, y: .93, s: .95, anim: 'sit', expr: 'calm' }],
      caps: [cap(0, 1.4, 'ОБЫЧНЫЙ *ВТОРНИК*'), cap(1.4, 1.6, 'ТЫ СИДИШЬ В *ОФИСЕ*')], sfx: [{ n: 'typing', at: 0, dur: 2.8 }] },
    { name: 'Сирена', dur: 3.6, bg: 'office', zoom: [1, 1.18], tr: 'flash', fx: ['redpulse', 'shake', 'siren'],
      cast: [{ c: 'hero', x: .5, y: .93, s: 1, anim: 'shake', expr: 'scared' }],
      props: [{ type: 'sign', text: 'ВОЗДУШНАЯ ТРЕВОГА', x: .5, y: .42, at: .1, dur: 3.4, color: '#e53935' }],
      caps: [Object.assign(cap(0, 1.6, 'И ВДРУГ — *СИРЕНА*'), { kick: true }), cap(1.6, 1.8, 'ЭТО *НЕ* УЧЕНИЯ')], sfx: [{ n: 'siren', at: 0, dur: 3.6 }, { n: 'alert', at: 0 }, { n: 'hit', at: 0 }, { n: 'heartbeat', cap: 1, dur: 2 }] },
    { name: 'Бег', dur: 4.5, bg: 'corridor', zoom: [1, 1.14], tr: 'whip', fx: ['shake', 'redpulse'],
      cast: [{ c: 'hero', x: .5, y: .95, s: 1, anim: 'run', expr: 'scared' }],
      caps: [cap(0, 2.3, 'ОДНО *УБЕЖИЩЕ* НА ВСЁ ЗДАНИЕ'), Object.assign(cap(2.3, 2, 'ЛИФТ СТОИТ — *БЕГОМ*'), { kick: true })], sfx: [{ n: 'whoosh', at: 0 }, { n: 'steps', cap: 1, dur: 2.2 }] },
    { name: 'Очередь', dur: 4.8, bg: 'hall', zoom: [1.06, 1], tr: 'punch', fx: ['redpulse'],
      cast: [{ c: 'hero', x: .3, y: .93, s: .85, anim: 'idle', expr: 'scared' }],
      props: [{ type: 'counter', x: .5, y: .36, from: 1, to: 30, size: 220, text: 'ЛЮДЕЙ У ДВЕРИ', cap: 0, off: .2, dur: 2.2, color: '#ff5252', span: 1.2 },
              { type: 'counter', x: .5, y: .36, from: 30, to: 12, size: 220, text: 'МЕСТ ВНУТРИ', cap: 1, dur: 4, color: '#2ecc71', span: .7 }],
      caps: [cap(0, 1.7, 'У ДВЕРИ — *30* ЧЕЛОВЕК'), Object.assign(cap(1.7, 1.4, 'А МЕСТ — *12*'), { kick: true }), cap(3.1, 1.6, 'ОХРАНА *СЧИТАЕТ*...')], sfx: [{ n: 'crowd', at: 0, dur: 4.6 }, { n: 'hit', cap: 1 }, { n: 'tick', cap: 2, dur: 1.5 }] },
    { name: 'Тринадцатый', dur: 4.6, bg: 'doorway', zoom: [1, 1.16], tr: 'punch', fx: ['redpulse'],
      cast: [{ c: 'hero', x: .32, y: .93, s: .9, anim: 'shake', expr: 'shock' }, { c: 'guard', x: .7, y: .93, s: .9, anim: 'point', expr: 'angry', flip: true }],
      props: [{ type: 'text', text: '13', x: .5, y: .35, size: 420, color: '#ff3b3b', cap: 1, off: .35, dur: 3 }, { type: 'emoji', text: '✋', x: .72, y: .52, size: 170, cap: 2 }],
      caps: [cap(0, 1.6, '*ДВЕНАДЦАТЫЙ* — ПРОШЁЛ'), Object.assign(cap(1.6, 1.6, 'А ТЫ... *ТРИНАДЦАТЫЙ*'), { cut: 1.6, kick: true }), Object.assign(cap(3.2, 1.2, 'МЕСТА *НЕТ*'), { kick: true })], sfx: [{ n: 'heartbeat', cap: 1, dur: 1.6 }, { n: 'boom', cap: 1, at: .35 }, { n: 'hit', cap: 2 }] },
    { name: 'Люк', dur: 3.6, bg: 'hatch', zoom: [1, 1.12], tr: 'whip', fx: ['redpulse', 'shake'],
      props: [{ type: 'timer', x: .5, y: .36, from: 180, to: 171, text: 'ДВЕРЬ ЗАКРОЕТСЯ', at: .2, dur: 3.4, span: 9 }],
      caps: [cap(0, 1.8, 'ДВЕРЬ ЗАКРОЕТСЯ *САМА*'), cap(1.8, 1.6, 'ЧЕРЕЗ *3 МИНУТЫ*')], sfx: [{ n: 'creak', at: .1 }, { n: 'tick', at: .2, dur: 3.4 }] },
    { name: 'Выбор', dur: 4.7, bg: 'doorway', zoom: [1.1, 1], tr: 'flash', fx: ['dust'],
      cast: [{ c: 'hero', x: .5, y: .98, s: .78, anim: 'shake', expr: 'scared' }],
      props: [{ type: 'choice', y: .47, cap: 0, off: 1.7, text: 'ЧТО ДЕЛАЕШЬ?', text2: 'ПИШИ A, B ИЛИ C', items: [{ k: 'A', text: 'Отдать место коллеге' }, { k: 'B', text: 'Протолкнуться силой' }, { k: 'C', text: 'Искать другое укрытие' }] }],
      caps: [Object.assign(cap(0, 1.4, 'И ЛИШНИЙ ЗДЕСЬ — *ТЫ*'), { kick: true })], sfx: [{ n: 'boom', at: 0 }, { n: 'ding', cap: 0, at: 1.4 }, { n: 'ding', cap: 0, at: 1.75 }, { n: 'ding', cap: 0, at: 2.1 }] }
  ] });
T.chat = () => ({ v: 1, title: 'Жуткая переписка', theme: 'horror', vignette: true,
  hud: { on: false, plates: [], bar: null }, chars: { hero: { name: 'Лена', hood: '#7e57c2', hair: '#2b1a12', skin: '#f3c9a5', pants: '#263042', hairStyle: 'long', acc: 'none', hold: 'phone' } },
  cap: { size: 100, y: .66 }, music: { style: 'mystery', vol: .5 }, voice: { on: false, provider: 'elevenlabs', voiceId: '', model: '', speed: 1, key: '' },
  scenes: [
    { name: 'Ночь', dur: 5, bg: 'bedroom', zoom: [1, 1.1], fx: ['noise', 'dust'], cast: [{ c: 'hero', x: .4, y: .9, s: 1, anim: 'idle', expr: 'calm' }], caps: [cap(0, 2.4, 'НОЧЬЮ ПРИШЛО *СООБЩЕНИЕ*'), cap(2.4, 2.4, 'ОТ ЧЕЛОВЕКА, КОТОРОГО *НЕТ*')], sfx: [{ n: 'ding', at: 1 }, { n: 'heartbeat', at: 2 }] },
    { name: 'Чат', dur: 8, bg: 'gradient', zoom: [1, 1.05], fx: ['glitch', 'scan'], props: [{ type: 'chat', y: .38, items: [{ who: 'them', text: 'Ты дома?' }, { who: 'me', text: 'Кто это?' }, { who: 'them', text: 'Не включай свет' }, { who: 'them', text: 'Я за твоей дверью' }], gap: 1.6, at: .3 }], caps: [cap(0, 3.5, 'ОН ЗНАЛ, ЧТО Я *ОДНА*'), cap(3.5, 4, 'СВЕТ ВЫКЛЮЧИЛСЯ *САМ*')], sfx: [{ n: 'ding', at: .4 }, { n: 'ding', at: 2 }, { n: 'ding', at: 3.6 }, { n: 'glitch', at: 5 }, { n: 'riser', at: 4, dur: 4 }] },
    { name: 'Дверь', dur: 5, bg: 'corridor', zoom: [1, 1.2], fx: ['shake', 'flash', 'dark'], cast: [{ c: 'hero', x: .5, y: .95, s: 1.05, anim: 'shake', expr: 'shock' }], caps: [cap(0, 2.5, 'ЗА ДВЕРЬЮ *ДЫШАЛИ*'), cap(2.5, 2.5, 'И ЭТО БЫЛО *УТРОМ*')], sfx: [{ n: 'creak', at: .5 }, { n: 'boom', at: 3 }] }
  ] });
T.finance = () => ({ v: 1, title: 'Сложный процент', theme: 'finance', vignette: true,
  hud: { on: true, plates: [{ label: 'ВЗНОС В МЕСЯЦ', fmt: 'num', suffix: ' ₽', keys: [[0, 10000]], color: '#26c281' }, { label: 'ЛЕТ', fmt: 'num', keys: [[0, 0], [20, 30]], color: '#ffd600' }], bar: { label: 'КАПИТАЛ, ТЫС ₽', max: 20000, keys: [[0, 0], [20, 17000]] } },
  chars: { hero: { name: 'Инвестор', hood: '#1e88e5', hair: '#3a2a20', skin: '#f2c6a0', pants: '#263042', hairStyle: 'short', acc: 'glasses' } },
  cap: { size: 100, y: .66 }, music: { style: 'calm', vol: .45 }, voice: { on: false, provider: 'elevenlabs', voiceId: '', model: '', speed: 1, key: '' },
  scenes: [
    { name: 'Идея', dur: 6, bg: 'office', zoom: [1, 1.08], cast: [{ c: 'hero', x: .5, y: .95, s: 1, anim: 'talk', expr: 'happy' }], props: [{ type: 'icon', icon: 'money', x: .5, y: .24, size: 150, at: 1 }], caps: [cap(0, 3, '10 000 ₽ В МЕСЯЦ *30 ЛЕТ*'), cap(3, 3, 'ПРИ *10%* ГОДОВЫХ')], sfx: [{ n: 'ding', at: 1 }] },
    { name: 'Формула', dur: 7, bg: 'grid', zoom: [1, 1.05], props: [{ type: 'math', text: 'S = P·(1+r)ⁿ', y: .4, at: .4 }, { type: 'counter', x: .5, y: .56, from: 0, to: 22800, suffix: ' тыс ₽', size: 110, text: 'ИТОГО', at: 2, span: 3 }], caps: [cap(0, 3, 'ДЕНЬГИ РАСТУТ *НА ДЕНЬГИ*'), cap(3, 4, 'ВЛОЖИЛ 3,6 МЛН — ПОЛУЧИЛ *22,8*')], sfx: [{ n: 'tick', at: 2, dur: 3 }, { n: 'ding', at: 5 }] },
    { name: 'Вывод', dur: 5, bg: 'city', zoom: [1.05, 1], cast: [{ c: 'hero', x: .5, y: .96, s: 1, anim: 'wave', expr: 'happy' }], caps: [cap(0, 2.5, 'ГЛАВНОЕ — *ВРЕМЯ*'), cap(2.5, 2.5, 'НАЧНИ *СЕГОДНЯ*')], sfx: [{ n: 'whoosh', at: 0 }] }
  ] });
T.blank = () => ({ v: 1, title: 'Новое видео', theme: 'bunker', vignette: true, hud: { on: false, plates: [], bar: null },
  chars: { hero }, cap: { size: 104, y: .66 }, music: { style: 'none', vol: .5 }, voice: { on: false, provider: 'elevenlabs', voiceId: '', model: '', speed: 1, key: '' },
  scenes: [{ name: 'Сцена 1', dur: 4, bg: 'gradient', zoom: [1, 1.08], cast: [{ c: 'hero', x: .5, y: .9, s: 1, anim: 'talk', expr: 'calm' }], caps: [cap(0, 3.6, 'ТВОЙ *ТЕКСТ* ЗДЕСЬ')], sfx: [] }] });
for (const k of Object.keys(T)) { const f = T[k]; T[k] = () => { const p = f(); const I = G.StudioI18n; return I && I.lang === 'en' ? I.mapProject(p, 'en') : p; }; }
G.StudioData = { T, TNAMES: { bunker: 'Бункер: ты тринадцатый', chat: 'Жуткая переписка', finance: 'Финансы: сложный процент', blank: 'Пустой проект' },
  newScene: () => ({ name: 'Новая сцена', dur: 4, bg: 'gradient', zoom: [1, 1.06], fx: [], cast: [], props: [], caps: [cap(0, 3.6, 'НОВЫЙ *ТЕКСТ*')], sfx: [] }), hero };
})(window);
