/* Студия: шаблоны проектов и значения по умолчанию */
(function (G) {
'use strict';
const cap = (at, dur, text) => ({ at, dur, text });
const hero = { name: 'Герой', hood: '#4caf50', hair: '#46281e', skin: '#f7c8a0', pants: '#283046', hairStyle: 'short', acc: 'none' };
const T = {};
T.bunker = () => ({ v: 1, title: 'Ты тринадцатый', theme: 'bunker', vignette: true, outFade: false,
  hud: { on: true, plates: [
    { label: 'ДО УДАРА', fmt: 'time', keys: [[0, 2700], [7.9, 2640], [26.1, 200], [31.7, 180]], color: '#e53935' },
    { label: 'МЕСТ В БУНКЕРЕ', fmt: 'num', keys: [[0, 12]], color: '#2ecc71' }],
    bar: { label: 'ЛЮДЕЙ', max: 30, mark: 12, keys: [[0, 1], [11.6, 1], [14.2, 30], [31.7, 30]] } },
  chars: { hero: { name: 'Ты', hood: '#5c6bc0', hair: '#3b2a22', skin: '#f2c6a0', pants: '#263042', hairStyle: 'short', acc: 'tie' }, guard: { name: 'Охранник', hood: '#37474f', hair: '#222', skin: '#e0a878', pants: '#263238', hairStyle: 'cap', acc: 'beard' } },
  cap: { size: 104, y: .66 }, music: { style: 'tension', vol: .55 }, voice: { on: false, provider: 'elevenlabs', voiceId: '', model: '', speed: 1, key: '' },
  scenes: [
    { name: 'Офис', dur: 3.9, bg: 'office', zoom: [1, 1.1], fx: ['dust'],
      cast: [{ c: 'hero', x: .5, y: .93, s: .95, anim: 'sit', expr: 'calm' }],
      caps: [cap(0, 1.6, 'ОБЫЧНЫЙ *ВТОРНИК*'), cap(1.6, 1.8, 'ТЫ В *ОФИСЕ*')], sfx: [{ n: 'typing', at: 0, dur: 2.5 }] },
    { name: 'Сирена', dur: 4, bg: 'office', zoom: [1, 1.14], fx: ['redpulse', 'shake', 'siren'],
      cast: [{ c: 'hero', x: .5, y: .93, s: 1, anim: 'shake', expr: 'scared' }],
      props: [{ type: 'sign', text: 'ВОЗДУШНАЯ ТРЕВОГА', x: .5, y: .44, at: .2, dur: 3.6, color: '#e53935' }],
      caps: [cap(0, 1.6, 'ВДРУГ — *СИРЕНА*'), cap(1.6, 1.9, 'ЭТО *НЕ* УЧЕНИЕ')], sfx: [{ n: 'siren', at: 0, dur: 3.8 }, { n: 'alert', at: 0 }, { n: 'heartbeat', at: 1 }] },
    { name: 'Бег', dur: 3.7, bg: 'corridor', zoom: [1, 1.1], fx: ['shake', 'redpulse'],
      cast: [{ c: 'hero', x: .5, y: .95, s: 1, anim: 'run', expr: 'scared' }],
      caps: [cap(0, 1.7, 'ОДНО *УБЕЖИЩЕ* НА ЗДАНИЕ'), cap(1.7, 1.6, 'ЛИФТ СТОИТ — *БЕГОМ*')], sfx: [{ n: 'steps', at: 0, dur: 3.6 }, { n: 'whoosh', at: 0 }] },
    { name: 'Очередь', dur: 5.1, bg: 'hall', zoom: [1, 1.08], fx: ['redpulse'],
      cast: [{ c: 'hero', x: .3, y: .93, s: .85, anim: 'idle', expr: 'scared' }],
      props: [{ type: 'counter', x: .5, y: .37, from: 1, to: 30, size: 200, text: 'ЛЮДЕЙ У ДВЕРИ', at: .4, dur: 4.4, color: '#ff5252', span: 1.6 }],
      caps: [cap(0, 1.5, 'У ДВЕРИ — *30*'), cap(1.5, 1.6, 'МЕСТ — ТОЛЬКО *12*'), cap(3.1, 1.5, 'ОХРАНА *СЧИТАЕТ*')], sfx: [{ n: 'crowd', at: 0, dur: 5 }, { n: 'hit', at: 3.1 }] },
    { name: 'Тринадцатый', dur: 5.1, bg: 'doorway', zoom: [1, 1.1], fx: ['redpulse'],
      cast: [{ c: 'hero', x: .32, y: .93, s: .9, anim: 'shake', expr: 'shock' }, { c: 'guard', x: .7, y: .93, s: .9, anim: 'point', expr: 'angry', flip: true }],
      props: [{ type: 'emoji', text: '✋', x: .7, y: .3, size: 210, at: 1.5 }],
      caps: [cap(0, 1.5, '*ДВЕНАДЦАТЫЙ* ПРОШЁЛ'), cap(1.5, 1.8, 'ТЫ — *ТРИНАДЦАТЫЙ*'), cap(3.3, 1.3, 'МЕСТА *НЕТ*')], sfx: [{ n: 'hit', at: 1.5 }, { n: 'heartbeat', at: 0 }, { n: 'boom', at: 3.3 }] },
    { name: 'Люк', dur: 4.3, bg: 'hatch', zoom: [1, 1.12], fx: ['redpulse', 'shake'],
      props: [{ type: 'timer', x: .5, y: .38, from: 180, to: 0, text: 'ДВЕРЬ ЗАКРОЕТСЯ', at: .3, dur: 3.7, span: 3.7 }],
      caps: [cap(0, 1.7, 'ДВЕРЬ ЗАКРОЕТСЯ *САМА*'), cap(1.7, 2, 'ЧЕРЕЗ *3 МИНУТЫ*')], sfx: [{ n: 'creak', at: .2 }, { n: 'tick', at: .3, dur: 3.7 }] },
    { name: 'Выбор', dur: 6.5, bg: 'doorway', zoom: [1.06, 1],
      cast: [{ c: 'hero', x: .5, y: .98, s: .78, anim: 'shake', expr: 'scared' }],
      props: [{ type: 'choice', y: .46, at: 1.5, text: 'ЧТО ДЕЛАЕШЬ?', text2: 'ПИШИ A, B ИЛИ C', items: [{ k: 'A', text: 'Отдать место коллеге' }, { k: 'B', text: 'Протолкнуться силой' }, { k: 'C', text: 'Искать другое укрытие' }] }],
      caps: [cap(0, 1.4, '*ЛИШНИЙ* — ТЫ')], sfx: [{ n: 'riser', at: 0, dur: 5 }, { n: 'ding', at: 1.9 }, { n: 'ding', at: 2.25 }, { n: 'ding', at: 2.6 }] }
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
