/* Студия: шаблоны проектов и значения по умолчанию */
(function (G) {
'use strict';
const cap = (at, dur, text) => ({ at, dur, text });
const hero = { name: 'Герой', hood: '#4caf50', hair: '#46281e', skin: '#f7c8a0', pants: '#283046', hairStyle: 'short', acc: 'none' };
const T = {};
T.bunker = () => ({ v: 1, title: 'Бункер за 30 секунд', theme: 'bunker', vignette: true,
  hud: { on: true, plates: [
    { label: 'ДО УДАРА', fmt: 'time', keys: [[0, 2820], [4.5, 2760], [25.5, 180], [30, 150]], color: '#e53935' },
    { label: 'МЕСТ В УБЕЖИЩЕ', fmt: 'num', keys: [[0, 12]], color: '#2ecc71' }],
    bar: { label: 'ЛЮДЕЙ', max: 31, mark: 12, keys: [[0, 1], [4.5, 1], [9, 9], [11.2, 31], [30, 31]] } },
  chars: { hero, neighbor: { name: 'Сосед', hood: '#ef6c00', hair: '#222', skin: '#e0a878', pants: '#37474f', hairStyle: 'bald', acc: 'beard' } },
  cap: { size: 104, y: .66 }, music: { style: 'tension', vol: .55 }, voice: { on: false, provider: 'elevenlabs', voiceId: '', model: '', speed: 1, key: '' },
  scenes: [
    { name: 'Ночь, сигнал', dur: 4.5, bg: 'bedroom', zoom: [1, 1.12], fx: ['redpulse', 'dust'],
      cast: [{ c: 'hero', x: .38, y: .86, s: .95, anim: 'shake', expr: 'shock' }],
      props: [{ type: 'icon', icon: 'phone', x: .78, y: .55, size: 150, at: 1.2 }, { type: 'emoji', text: '⚠️', x: .5, y: .3, size: 220, at: 1.4, dur: 3 }],
      caps: [cap(0, 1.4, '*3:07* НОЧИ'), cap(1.4, 1.5, 'ПРИШЁЛ СИГНАЛ *ТРЕВОГИ*'), cap(2.9, 1.6, 'ДО УДАРА — *47 МИНУТ*')], sfx: [{ n: 'alert', at: 1.3 }, { n: 'siren', at: 2.4 }, { n: 'heartbeat', at: 0 }] },
    { name: 'Бег по коридору', dur: 4.5, bg: 'corridor', zoom: [1, 1.1], fx: ['shake', 'redpulse'],
      cast: [{ c: 'hero', x: .5, y: .95, s: 1, anim: 'run', expr: 'scared' }],
      caps: [cap(0, 1.5, 'В ПОДВАЛЕ ЕСТЬ *УБЕЖИЩЕ*'), cap(1.5, 1.5, 'ОДНО НА ВЕСЬ ДОМ'), cap(3, 1.5, 'И БЕЖИТ ТУДА *ВСЕ*')], sfx: [{ n: 'steps', at: 0, dur: 4.5 }, { n: 'whoosh', at: 0 }] },
    { name: 'Очередь', dur: 5.5, bg: 'hall', zoom: [1, 1.08], fx: ['redpulse'],
      cast: [{ c: 'hero', x: .32, y: .93, s: .85, anim: 'idle', expr: 'scared' }, { c: 'neighbor', x: .68, y: .93, s: .85, anim: 'point', expr: 'angry', flip: true }],
      props: [{ type: 'counter', x: .5, y: .3, from: 1, to: 31, size: 200, text: 'ЛЮДЕЙ У ДВЕРИ', at: 1.5, dur: 4, color: '#ff5252', span: 2.2 }],
      caps: [cap(0, 1.5, 'МЕСТ — *12*'), cap(1.5, 1.5, 'ЛЮДЕЙ — *31*'), cap(3, 2.5, 'ТЫ — *ТРИНАДЦАТЫЙ*')], sfx: [{ n: 'crowd', at: 0, dur: 5.5 }, { n: 'hit', at: 3 }] },
    { name: 'Запас', dur: 5.5, bg: 'grid', zoom: [1, 1.06],
      props: [{ type: 'cards', y: .42, items: [{ icon: 'water', label: 'ВОДА', value: '3 дня', color: '#4fc3f7' }, { icon: 'food', label: 'ЕДА', value: '3 дня', color: '#ffb74d' }, { icon: 'filter', label: 'ФИЛЬТР', value: '1 шт', color: '#81c784' }], at: 1.5 }],
      caps: [cap(0, 1.5, 'ВНУТРИ ЗАПАС НА *3 ДНЯ*'), cap(1.5, 2, 'ВОДА. ЕДА. *ФИЛЬТР*'), cap(3.5, 2, 'НА *12* ЧЕЛОВЕК')], sfx: [{ n: 'ding', at: 1.6 }, { n: 'ding', at: 1.9 }, { n: 'ding', at: 2.2 }] },
    { name: 'Люк', dur: 5.5, bg: 'hatch', zoom: [1, 1.12], fx: ['redpulse', 'shake'],
      props: [{ type: 'timer', x: .5, y: .3, from: 180, to: 0, text: 'ДВЕРЬ ЗАКРОЕТСЯ', at: 1.5, dur: 4, span: 4 }],
      caps: [cap(0, 1.6, 'ДВЕРЬ ЗАКРОЕТСЯ *САМА*'), cap(1.6, 2, 'ЧЕРЕЗ *3 МИНУТЫ*'), cap(3.6, 1.9, 'ВНУТРИ — ТОЛЬКО *12*')], sfx: [{ n: 'creak', at: 0.3 }, { n: 'tick', at: 1.5, dur: 4 }] },
    { name: 'Выбор', dur: 4.5, bg: 'doorway', zoom: [1.1, 1],
      cast: [{ c: 'hero', x: .5, y: .9, s: 1.05, anim: 'shake', expr: 'scared' }],
      props: [{ type: 'emoji', text: '❓', x: .5, y: .22, size: 240, at: 2 }],
      caps: [cap(0, 2, '*ЛИШНИЙ* — ТЫ'), cap(2, 2.5, 'ЧТО *ДЕЛАЕШЬ?*')], sfx: [{ n: 'riser', at: 0, dur: 4 }, { n: 'boom', at: 3.9 }] }
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
G.StudioData = { T, TNAMES: { bunker: 'Бункер: 30 секунд', chat: 'Жуткая переписка', finance: 'Финансы: сложный процент', blank: 'Пустой проект' },
  newScene: () => ({ name: 'Новая сцена', dur: 4, bg: 'gradient', zoom: [1, 1.06], fx: [], cast: [], props: [], caps: [cap(0, 3.6, 'НОВЫЙ *ТЕКСТ*')], sfx: [] }), hero };
})(window);
