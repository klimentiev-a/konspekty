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
T.futures = () => ({ v: 1, title: 'Фьючерс за 30 секунд', theme: 'finance', vignette: true, outFade: false, handheld: true,
  hud: { on: false, plates: [], bar: null },
  chars: { baker: { name: 'Пекарь', hood: '#eceff1', hair: '#5a3a22', skin: '#f2c6a0', pants: '#37474f', hairStyle: 'bald', acc: 'none' }, farmer: { name: 'Фермер', hood: '#6d8b3a', hair: '#3a2a20', skin: '#e0a878', pants: '#3e4a5e', hairStyle: 'cap', acc: 'beard' } },
  cap: { size: 96, y: .7, pop: 'word' }, music: { style: 'explainer', vol: .32 }, voice: { on: false, provider: 'elevenlabs', voiceId: '', model: '', speed: 1, key: '' },
  scenes: [
    { name: 'Заголовок', dur: 2.2, bg: 'grid', zoom: [1.15, 1], tr: 'flash', fx: ['dust'],
      props: [{ type: 'text', text: 'ФЬЮЧЕРС', x: .5, y: .34, size: 165, color: '#ffd600', at: .05 }, { type: 'popup', text: 'FUTURES', text2: 'ЗА 30 СЕКУНД', x: .5, y: .48, at: .35 }],
      caps: [cap(0, 2, ' ')], sfx: [{ n: 'whoosh', at: 0 }, { n: 'hit', at: .05 }] },
    { name: 'Договор', dur: 5.4, bg: 'office', zoom: [1, 1.08], tr: 'whip',
      props: [{ type: 'contract', x: .5, y: .37, at: 0, items: [{ k: 'ЧТО', v: 'купить / продать', cap: 1 }, { k: 'КОГДА', v: 'в будущем', cap: 1, off: .9 }, { k: 'ЦЕНА', v: 'фиксируем сегодня', color: '#1e9e5a', cap: 2, off: .5 }] }],
      caps: [Object.assign(cap(0, 1.2, 'ЭТО *ДОГОВОР*'), { kick: true }), cap(1.2, 2, 'КУПИТЬ ИЛИ ПРОДАТЬ *В БУДУЩЕМ*'), cap(3.2, 2, 'ПО ЦЕНЕ *СЕГОДНЯШНЕГО* ДНЯ')], sfx: [{ n: 'ding', cap: 1 }, { n: 'ding', cap: 1, at: .9 }, { n: 'cash', cap: 2, at: .5 }] },
    { name: 'Пекарь и фермер', dur: 4.6, bg: 'street', zoom: [1.06, 1], tr: 'punch',
      cast: [{ c: 'baker', x: .27, y: .99, s: .88, anim: 'talk', expr: 'happy' }, { c: 'farmer', x: .73, y: .99, s: .88, anim: 'talk', expr: 'happy', flip: true }],
      props: [{ type: 'contract', x: .5, y: .33, s: .95, cap: 1, text: 'ДОГОВОР', items: [{ k: 'ТОВАР', v: 'пшеница', cap: 1 }, { k: 'СРОК', v: 'через 3 месяца', cap: 1, off: .5 }, { k: 'ЦЕНА', v: '100 ₽', color: '#1e9e5a', cap: 1, off: 1.2 }] }],
      caps: [cap(0, 1.8, '*ПЕКАРЬ* И *ФЕРМЕР*'), cap(1.8, 2.6, 'ПШЕНИЦА ЧЕРЕЗ 3 МЕСЯЦА — *100 ₽*')], sfx: [{ n: 'whoosh', cap: 1 }, { n: 'ding', cap: 1, at: 1.2 }] },
    { name: 'Рост', dur: 3.2, bg: 'grid', zoom: [1, 1.06], tr: 'whip',
      props: [{ type: 'pricechart', x: .5, y: .36, at: .05, fixed: 100, to: 120, span: 1.6, title: 'ЦЕНА ПШЕНИЦЫ ЧЕРЕЗ 3 МЕСЯЦА', text: 'ПЕКАРЬ +20 ₽' }],
      caps: [cap(0, 3, 'ВЫРОСЛА ДО 120 — *ПЕКАРЬ В ПЛЮСЕ*')], sfx: [{ n: 'riser', at: 0, dur: 1.6 }, { n: 'win', at: 1.7 }] },
    { name: 'Падение', dur: 3, bg: 'grid', zoom: [1, 1.06], tr: 'whip',
      props: [{ type: 'pricechart', x: .5, y: .36, at: .05, fixed: 100, to: 80, span: 1.4, title: 'ЦЕНА ПШЕНИЦЫ ЧЕРЕЗ 3 МЕСЯЦА', text: 'ФЕРМЕР +20 ₽' }],
      caps: [cap(0, 2.8, 'УПАЛА ДО 80 — *ФЕРМЕР В ПЛЮСЕ*')], sfx: [{ n: 'whoosh', at: 0 }, { n: 'win', at: 1.5 }] },
    { name: 'Биржа', dur: 2.2, bg: 'city', zoom: [1.08, 1], tr: 'punch',
      props: [{ type: 'contract', x: .5, y: .38, s: 1.05, at: 0, text: 'ДОГОВОР', items: [{ k: 'ТОВАР', v: 'пшеница' }, { k: 'СРОК', v: 'через 3 месяца' }, { k: 'ЦЕНА', v: '100 ₽', color: '#1e9e5a' }], stamp: 'БИРЖА', stamp2: 'ГАРАНТИРУЕТ', stampCap: 0, stampOff: .7 }],
      caps: [cap(0, 2, 'СДЕЛКУ ГАРАНТИРУЕТ *БИРЖА*')], sfx: [{ n: 'hit', cap: 0, at: .7 }], kicks: [.7] },
    { name: 'Залог и плечо', dur: 5, bg: 'grid', zoom: [1, 1.1], tr: 'flash',
      props: [{ type: 'cards', x: .5, y: .3, s: 1.45, cap: 0, items: [{ icon: 'wheat', label: 'ВЕСЬ КОНТРАКТ', value: '100%', color: '#90a4ae' }, { icon: 'lock', label: 'ТВОЙ ЗАЛОГ', value: 'ЧАСТЬ', color: '#ffd600' }] },
              { type: 'arrow', x: .36, y: .52, s: 1.1, rot: 180, color: '#26c281', cap: 1, off: .3 }, { type: 'arrow', x: .64, y: .52, s: 1.1, color: '#ef5350', cap: 1, off: .7 }],
      caps: [cap(0, 2.4, 'ПЛАТИШЬ НЕ ВСЁ — *ТОЛЬКО ЗАЛОГ*'), Object.assign(cap(2.4, 2.6, 'ПРИБЫЛЬ И УБЫТОК — *В РАЗЫ БОЛЬШЕ*'), { kick: true })], sfx: [{ n: 'ding', cap: 0, at: .2 }, { n: 'ding', cap: 0, at: .45 }, { n: 'hit', cap: 1 }, { n: 'win', cap: 1, at: .4 }, { n: 'fail', cap: 1, at: .9 }] },
    { name: 'Логотип', dur: 3.1, bg: 'gradient', zoom: [1, 1.04], tr: 'flash', fx: ['dust'],
      props: [{ type: 'logo', x: .5, y: .44, size: 560, at: .05, text: 'ПОДПИСЫВАЙСЯ', src: '', src2: '' }],
      caps: [cap(0, 1.5, '  ')], sfx: [{ n: 'whoosh', at: 0 }, { n: 'boom', at: .45, v: .5 }, { n: 'cash', at: 1.05 }, { n: 'ding', at: 1.65 }] }
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

const base = (o) => Object.assign({ v: 1, vignette: true, handheld: true, hud: { on: false, plates: [], bar: null }, cap: { size: 104, y: .66, pop: 'word' }, voice: { on: false, provider: 'elevenlabs', voiceId: '', model: '', speed: 1, key: '' } }, o);
T.tips = () => base({ title: '5 финансовых привычек', theme: 'finance', music: { style: 'lofi', vol: .45 },
  chars: { hero: { name: 'Ведущая', hood: '#7e57c2', hair: '#3b2a22', skin: '#f2c6a0', pants: '#263042', hairStyle: 'ponytail', acc: 'earring' } },
  scenes: [
    { name: 'Крючок', dur: 3.4, bg: 'desk', zoom: [1.1, 1], tr: 'punch', cast: [{ c: 'hero', x: .5, y: .985, s: .7, anim: 'talk', expr: 'wink' }], caps: [cap(0, 3.2, '5 ПРИВЫЧЕК, КОТОРЫЕ *ДЕЛАЮТ* БОГАЧЕ')], sfx: [{ n: 'pop', at: 0 }, { n: 'whoosh', at: 0 }] },
    { name: 'Привычка 1', dur: 4.2, bg: 'stock', zoom: [1, 1.08], tr: 'whip', props: [{ type: 'cards', y: .3, at: .3, items: [{ icon: 'money', label: '1', value: 'ПЛАТИ СЕБЕ ПЕРВЫМ' }] }], caps: [cap(0, 4, 'ОТКЛАДЫВАЙ *10%* СРАЗУ С ДОХОДА')], sfx: [{ n: 'ding', at: .4 }] },
    { name: 'Привычка 2', dur: 4.2, bg: 'stock', zoom: [1, 1.08], tr: 'whip', props: [{ type: 'cards', y: .3, at: .3, items: [{ icon: 'lock', label: '2', value: 'ПОДУШКА БЕЗОПАСНОСТИ' }] }], caps: [cap(0, 4, 'РЕЗЕРВ НА *6 МЕСЯЦЕВ* РАСХОДОВ')], sfx: [{ n: 'ding', at: .4 }] },
    { name: 'Привычка 3', dur: 4.2, bg: 'stock', zoom: [1, 1.08], tr: 'whip', props: [{ type: 'cards', y: .3, at: .3, items: [{ icon: 'chart', label: '3', value: 'ИНВЕСТИРУЙ РЕГУЛЯРНО' }] }], caps: [cap(0, 4, 'ПО СУММЕ — КАЖДЫЙ *МЕСЯЦ*')], sfx: [{ n: 'ding', at: .4 }] },
    { name: 'Привычка 4', dur: 4.2, bg: 'stock', zoom: [1, 1.08], tr: 'whip', props: [{ type: 'cards', y: .3, at: .3, items: [{ icon: 'warning', label: '4', value: 'ДОЛГИ — ПО УБЫВАНИЮ СТАВКИ' }] }], caps: [cap(0, 4, 'СНАЧАЛА ПОГАСИ *ДОРОГИЕ* КРЕДИТЫ')], sfx: [{ n: 'ding', at: .4 }] },
    { name: 'Привычка 5', dur: 4.2, bg: 'stock', zoom: [1, 1.08], tr: 'whip', props: [{ type: 'cards', y: .3, at: .3, items: [{ icon: 'clock', label: '5', value: 'ДАЙ ДЕНЬГАМ ВРЕМЯ' }] }], caps: [cap(0, 4, 'СЛОЖНЫЙ ПРОЦЕНТ *РАБОТАЕТ* ГОДАМИ')], sfx: [{ n: 'ding', at: .4 }] },
    { name: 'Финал', dur: 4, bg: 'desk', zoom: [1, 1.1], tr: 'punch', cast: [{ c: 'hero', x: .5, y: .985, s: .7, anim: 'wave', expr: 'happy' }], caps: [cap(0, 1.8, '*СОХРАНИ*, ЧТОБЫ НЕ ПОТЕРЯТЬ'), cap(1.9, 2, 'КАКАЯ ПРИВЫЧКА *ТВОЯ*?')], sfx: [{ n: 'sparkle', at: 0 }] }
  ] });
T.news = () => base({ title: 'Новость дня', theme: 'neon', music: { style: 'news', vol: .4 },
  chars: { anchor: { name: 'Диктор', hood: '#263a5e', hair: '#222', skin: '#e0a878', pants: '#1b2538', hairStyle: 'side', acc: 'tie' } },
  scenes: [
    { name: 'Заставка', dur: 3, bg: 'neon', zoom: [1.1, 1], tr: 'flash', fx: ['scan'], props: [{ type: 'popup', text: 'СРОЧНО', text2: 'главное за минуту', y: .3, at: .1 }], caps: [cap(0, 2.8, 'ГЛАВНОЕ ЗА *МИНУТУ*')], sfx: [{ n: 'alert', at: 0 }] },
    { name: 'Новость', dur: 5, bg: 'desk', zoom: [1, 1.08], tr: 'whip', cast: [{ c: 'anchor', x: .5, y: .985, s: .7, anim: 'talk', expr: 'calm' }], props: [{ type: 'counter', x: .5, y: .2, from: 0, to: 16, suffix: ' %', size: 120, text: 'КЛЮЧЕВАЯ СТАВКА', at: .3, span: 2 }], caps: [cap(0, 4.8, 'ВАШ ЗАГОЛОВОК *ЗДЕСЬ*')], sfx: [{ n: 'typing', at: 0, dur: 2 }] },
    { name: 'Что значит', dur: 5, bg: 'stock', zoom: [1, 1.08], tr: 'whip', props: [{ type: 'cards', y: .3, at: .3, items: [{ icon: 'bank', label: 'БАНКИ', value: 'вклады дороже' }, { icon: 'house', label: 'ИПОТЕКА', value: 'платежи выше' }] }], caps: [cap(0, 4.8, 'ЧТО ЭТО *ЗНАЧИТ* ДЛЯ ТЕБЯ')], sfx: [{ n: 'ding', at: .4 }] },
    { name: 'Итог', dur: 4, bg: 'neon', zoom: [1.05, 1], tr: 'punch', cast: [{ c: 'anchor', x: .5, y: .985, s: .7, anim: 'point', expr: 'calm' }], caps: [cap(0, 3.8, 'ПОДПИШИСЬ — *РАЗБЕРЁМ* ДАЛЬШЕ')], sfx: [{ n: 'whoosh', at: 0 }] }
  ] });
T.ad = () => base({ title: 'Реклама продукта', theme: 'gold', music: { style: 'funk', vol: .4 },
  chars: { hero: { name: 'Клиент', hood: '#ef5350', hair: '#6d4c41', skin: '#c68a5c', pants: '#283046', hairStyle: 'afro', acc: 'sunglasses' } },
  scenes: [
    { name: 'Проблема', dur: 3.6, bg: 'cafe', zoom: [1.1, 1], tr: 'punch', cast: [{ c: 'hero', x: .5, y: .985, s: .7, anim: 'shake', expr: 'sad' }], caps: [cap(0, 3.4, 'НАДОЕЛО *ТЕРЯТЬ* ВРЕМЯ?')], sfx: [{ n: 'fail', at: 1.8 }] },
    { name: 'Решение', dur: 4.4, bg: 'neon', zoom: [1, 1.1], tr: 'flash', props: [{ type: 'image', y: .38, size: 640, at: .2 }], caps: [cap(0, 4.2, 'ВСТРЕЧАЙ *НОВОЕ* РЕШЕНИЕ')], sfx: [{ n: 'sparkle', at: .2 }, { n: 'whoosh2', at: 0 }] },
    { name: 'Выгоды', dur: 5, bg: 'gradient', zoom: [1, 1.06], tr: 'whip', props: [{ type: 'cards', y: .3, at: .3, items: [{ icon: 'bolt', label: 'БЫСТРО', value: '' }, { icon: 'lock', label: 'НАДЁЖНО', value: '' }, { icon: 'money', label: 'ВЫГОДНО', value: '' }] }], caps: [cap(0, 4.8, 'БЫСТРО. *НАДЁЖНО*. ВЫГОДНО')], sfx: [{ n: 'ding', at: .4 }, { n: 'ding', at: .8 }, { n: 'ding', at: 1.2 }] },
    { name: 'Призыв', dur: 4, bg: 'sunset', zoom: [1, 1.1], tr: 'punch', cast: [{ c: 'hero', x: .5, y: .985, s: .7, anim: 'cheer', expr: 'happy' }], props: [{ type: 'popup', text: 'ПЕРЕЙДИ ПО ССЫЛКЕ', text2: 'в описании профиля', y: .26, at: .4 }], caps: [cap(0, 3.8, '*ПОПРОБУЙ* СЕГОДНЯ')], sfx: [{ n: 'win', at: .2 }] }
  ] });
T.motivation = () => base({ title: 'Мотивация: начни сегодня', theme: 'sunset', music: { style: 'epic', vol: .5 },
  chars: { hero: { name: 'Бегун', hood: '#ffd166', hair: '#222', skin: '#f7c8a0', pants: '#1e2a44', hairStyle: 'mohawk', acc: 'headband' } },
  scenes: [
    { name: 'Утро', dur: 3.6, bg: 'sunset', zoom: [1.1, 1], tr: 'fade', cast: [{ c: 'hero', x: .5, y: .985, s: .7, anim: 'think', expr: 'calm' }], caps: [cap(0, 3.4, 'КАЖДОЕ УТРО — *ВЫБОР*')], sfx: [{ n: 'wind', at: 0, dur: 3 }] },
    { name: 'Бег', dur: 4.4, bg: 'beach', zoom: [1, 1.08], tr: 'whip', cast: [{ c: 'hero', x: .5, y: .985, s: .7, anim: 'run', expr: 'angry' }], caps: [cap(0, 4.2, 'ТРУДНО *СЕЙЧАС* — ЛЕГКО ПОТОМ')], sfx: [{ n: 'steps', at: 0, dur: 4 }, { n: 'riser', at: 0, dur: 4 }] },
    { name: 'Прыжок', dur: 4, bg: 'city', zoom: [1, 1.12], tr: 'punch', cast: [{ c: 'hero', x: .5, y: .985, s: .7, anim: 'jump', expr: 'happy' }], caps: [cap(0, 3.8, 'ШАГ ЗА ШАГОМ — *ПОБЕДА*')], sfx: [{ n: 'boom', at: 0 }, { n: 'applause', at: .6, dur: 3 }] },
    { name: 'Финал', dur: 4, bg: 'sunset', zoom: [1, 1.08], tr: 'fade', cast: [{ c: 'hero', x: .5, y: .985, s: .7, anim: 'cheer', expr: 'love' }], caps: [cap(0, 3.8, '*НАЧНИ* СЕГОДНЯ')], sfx: [{ n: 'sparkle', at: 0 }] }
  ] });
T.quiz = () => base({ title: 'Угадай и ответь', theme: 'mint', music: { style: 'retro', vol: .4 },
  chars: { hero: { name: 'Ведущий', hood: '#ff6b6b', hair: '#6d4c41', skin: '#f7c8a0', pants: '#263042', hairStyle: 'curly', acc: 'glasses' } },
  scenes: [
    { name: 'Вопрос', dur: 4.5, bg: 'classroom', zoom: [1.1, 1], tr: 'punch', cast: [{ c: 'hero', x: .5, y: .985, s: .7, anim: 'talk', expr: 'smirk' }], props: [{ type: 'math', text: '2 + 2 × 2 = ?', y: .22, at: .3 }], caps: [cap(0, 4.2, '99% ОШИБАЮТСЯ В *ЭТОМ*')], sfx: [{ n: 'pop', at: .3 }] },
    { name: 'Варианты', dur: 6, bg: 'grid', zoom: [1, 1.05], tr: 'whip', props: [{ type: 'choice', text: 'ВЫБЕРИ ОТВЕТ', items: [{ k: 'A', text: '8' }, { k: 'B', text: '6' }, { k: 'C', text: '4' }], at: .3 }], caps: [cap(0, 5.8, 'А, Б ИЛИ *В*? ПИШИ В КОММЕНТАХ')], sfx: [{ n: 'tick', at: 0, dur: 5 }] },
    { name: 'Ответ', dur: 4, bg: 'classroom', zoom: [1, 1.1], tr: 'flash', cast: [{ c: 'hero', x: .5, y: .985, s: .7, anim: 'dance', expr: 'happy' }], props: [{ type: 'popup', text: 'ОТВЕТ: 6', text2: 'сначала умножение', y: .24, at: .3 }], caps: [cap(0, 3.8, 'СНАЧАЛА *УМНОЖЕНИЕ*')], sfx: [{ n: 'win', at: .3 }] }
  ] });
T.blank = () => ({ v: 1, title: 'Новое видео', theme: 'bunker', vignette: true, hud: { on: false, plates: [], bar: null },
  chars: { hero }, cap: { size: 104, y: .66 }, music: { style: 'none', vol: .5 }, voice: { on: false, provider: 'elevenlabs', voiceId: '', model: '', speed: 1, key: '' },
  scenes: [{ name: 'Сцена 1', dur: 4, bg: 'gradient', zoom: [1, 1.08], cast: [{ c: 'hero', x: .5, y: .9, s: 1, anim: 'talk', expr: 'calm' }], caps: [cap(0, 3.6, 'ТВОЙ *ТЕКСТ* ЗДЕСЬ')], sfx: [] }] });
for (const k of Object.keys(T)) { const f = T[k]; T[k] = () => { const p = f(); const I = G.StudioI18n; return I && I.lang === 'en' ? I.mapProject(p, 'en') : p; }; }
G.StudioData = { T, TNAMES: { bunker: 'Бункер: ты тринадцатый', futures: 'Финансы: фьючерс за 30 секунд', chat: 'Жуткая переписка', finance: 'Финансы: сложный процент', tips: 'Список: 5 советов', news: 'Новость дня', ad: 'Реклама продукта', motivation: 'Мотивация', quiz: 'Викторина', blank: 'Пустой проект' },
  newScene: () => ({ name: 'Новая сцена', dur: 4, bg: 'gradient', zoom: [1, 1.06], fx: [], cast: [], props: [], caps: [cap(0, 3.6, 'НОВЫЙ *ТЕКСТ*')], sfx: [] }), hero };
})(window);
