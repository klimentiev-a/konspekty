/* Студия: язык интерфейса RU / EN. Словарь RU→EN, перевод готового DOM, перевод содержимого проекта */
(function (G) {
'use strict';
const EN = {
'с':'s','Сценарий':'Script','Сцены':'Scenes','Персонажи':'Characters','Тема и HUD':'Theme & HUD','Голос':'Voice','Звук':'Sound','Экспорт':'Export',
'напряжённый, как тревожный репортаж':'tense, like a breaking-news report','русский':'Russian','Придумать сценарий с Claude':'Write a script with Claude',
'Опиши тему — Claude соберёт сцены, персонажей, фразы, звуки и счётчики. Нужен твой ключ Claude API: он хранится только в этом браузере и уходит только на api.anthropic.com.':'Describe the topic and Claude builds scenes, characters, captions, sounds and counters. Needs your Claude API key: it stays in this browser and is sent only to api.anthropic.com.',
'Ключ Claude API':'Claude API key','О чём видео':'What is the video about',
'Например: за 47 минут до ядерного удара ты узнаёшь, что в бункере 12 мест, а людей 31':'e.g. 47 minutes before the strike you learn the bunker has 12 places and 31 people',
'Тон':'Tone','познавательный, с фактами и цифрами':'educational, with facts and numbers','смешной, с абсурдным поворотом':'funny, with an absurd twist','хоррор, нарастающий страх':'horror, rising dread','мотивационный, энергичный':'motivational, energetic','драма с неожиданной развязкой':'drama with a twist ending',
'Длина, с':'Length, s','Сцен':'Scenes','Язык':'Language','Счётчики (HUD)':'Counters (HUD)','Пожелания (необязательно)':'Wishes (optional)','герой — девушка, финал с вопросом, больше цифр':'heroine is a girl, ending with a question, more numbers','Модель':'Model','Сгенерировать':'Generate','Напиши тему':'Write a topic',
'Шаблоны':'Templates','Тревога, очередь, люк, 30 с':'Alarm, queue, hatch, 30 s','Переписка и дверь, 18 с':'Chat and a door, 18 s','Формула и цифры, 18 с':'Formula and numbers, 18 s','Одна сцена':'One scene',
'Проект':'Project','Название':'Title','Это не файл проекта Студии':'This is not a Studio project file','Скачать проект (.json)':'Download project (.json)','Открыть проект':'Open project',
'Нажми на сцену, чтобы править. Время субтитров, предметов и звуков — в секундах от начала сцены.':'Tap a scene to edit it. Times of captions, props and sounds are in seconds from the scene start.',
'Копия':'Copy','+ Сцена':'+ Scene','Длит., с':'Dur., s','Фон':'Background','Зум с':'Zoom from','Зум до':'Zoom to','Эффекты':'Effects','Персонажи в сцене':'Characters in scene','Кто':'Who','Действие':'Action','Эмоция':'Emotion','Размер':'Size','Идёт к X':'Walks to X','Входит, с':'Enters, s','Отразить':'Flip','+ Персонаж':'+ Character',
'Предметы на экране':'On-screen props','Что':'What','Масштаб':'Scale','С, с':'From, s','Длит.':'Dur.','Эмодзи':'Emoji','Текст':'Text','Вторая строка':'Second line','Иконка':'Icon','От':'From','До':'To','За, с':'Over, s','Подпись числа':'Number label','Цвет':'Color',
'Сообщения: «я: …» или «он: …», по строке':'Messages: “me: …” or “them: …”, one per line','Пауза между, с':'Pause between, s','+ Предмет':'+ Prop','ТЕКСТ':'TEXT',
'Субтитры и голос':'Captions & voice','Слова в *звёздочках* выделяются цветом. Эти же фразы озвучивает нейроголос.':'Words in *asterisks* get the highlight color. The same lines are read by the AI voice.',
'Фраза ':'Line ','+ Фраза':'+ Line','НОВАЯ *ФРАЗА*':'NEW *LINE*','Разложить по сцене поровну':'Spread evenly over the scene','Звуки сцены':'Scene sounds','Громк.':'Vol.','+ Звук':'+ Sound',
'Персонаж':'Character','+ Новый':'+ New','Персонаж ':'Character ','Удалить':'Delete','Имя':'Name','Причёска':'Hair style','Аксессуар':'Accessory','Одежда':'Hoodie','Брюки':'Pants','Волосы':'Hair','Кожа':'Skin','Анимация (показ)':'Animation (preview)','Эмоция (показ)':'Emotion (preview)','Телефон в руке':'Phone in hand','Случайный вид':'Randomize','Палитра':'Palette',
'Субтитры':'Captions','Высота 0–1':'Height 0–1','Цвет выделения':'Highlight color','Виньетка':'Vignette','HUD: плашки и полоса':'HUD: plates and bar',
'Значения меняются по ключевым точкам «секунда:значение» на всём видео. Время — формат мм:сс.':'Values change along keypoints “second:value” across the whole video. Time uses the mm:ss format.',
'Показывать HUD':'Show HUD','+ Плашка ':'+ Plate ','МЕТКА':'LABEL','Подпись ':'Label ','Формат':'Format','Число':'Number','Время мм:сс':'Time mm:ss','Суффикс':'Suffix','Точки (сек:значение, через запятую)':'Points (sec:value, comma-separated)','+ Полоса':'+ Bar','ПОЛОСА':'BAR','Подпись полосы':'Bar label','Максимум':'Maximum','Отметка':'Mark','Точки (сек:значение)':'Points (sec:value)',
'Нейроголос озвучивает субтитры. Нужен ключ сервиса: он хранится только в этом браузере и уходит только в сам сервис. Каждая фраза заказывается один раз и кэшируется на устройстве. Услуга платная по тарифу сервиса.':'An AI voice reads the captions. Needs a service key: it is stored only in this browser and sent only to the service. Each line is ordered once and cached on your device. The service is paid per its own plan.',
'Озвучивать ролик':'Voice the video','Сервис':'Service','ключ ElevenLabs':'ElevenLabs key','Ключ ':'Key ','Манера речи (только gpt-4o-mini-tts)':'Delivery style (gpt-4o-mini-tts only)','Говори тревожно, быстро, как диктор новостей':'Speak anxiously and fast, like a news anchor','Голос не выбран':'No voice selected','Загрузить мои голоса':'Load my voices','Загружаю…':'Loading…','или вставь ID голоса':'or paste a voice ID','Скорость':'Speed','Проба голоса':'Voice test','Синтез…':'Synthesizing…','Через три минуты дверь закроется сама.':'In three minutes the door will close by itself.','Играет':'Playing',
'Озвучить весь ролик и подогнать тайминги':'Voice the whole video and fit the timing','Очистить кэш озвучки':'Clear voice cache','Кэш очищен':'Cache cleared',
'Музыка':'Music','Стиль':'Style','Громкость 0–1':'Volume 0–1','Приглушать под голос':'Duck under voice','▶ Послушать стиль':'▶ Preview style','■ Стоп':'■ Stop','Библиотека звуков':'Sound library',
'Нажми, чтобы послушать. Добавлять в сцену — во вкладке «Сцены», блок «Звуки сцены».':'Tap to listen. Add them to a scene in the “Scenes” step, block “Scene sounds”.',
'Запись идёт в реальном времени: ролик проигрывается и записывается вместе со звуком, поэтому не сворачивай вкладку, пока идёт запись. Chrome и Edge дают MP4 или WebM; Safari — MP4.':'Recording runs in real time: the video plays and is recorded with sound, so keep this tab open while it runs. Chrome and Edge give MP4 or WebM; Safari gives MP4.',
'540×960 (быстро, лёгкий)':'540×960 (fast, light)','720×1280 (по умолчанию)':'720×1280 (default)','1080×1920 (максимум)':'1080×1920 (maximum)','Записать видео':'Record video','Запись… ':'Recording… ','Готово':'Done','Сохранить текущий кадр (PNG)':'Save current frame (PNG)','Этот браузер не умеет записывать видео':'This browser cannot record video','Ошибка записи':'Recording error',
'проект сохраняется в браузере':'project is saved in your browser',
'Герой':'Hero','Бункер за 30 секунд':'Bunker in 30 seconds','ДО УДАРА':'UNTIL IMPACT','МЕСТ В УБЕЖИЩЕ':'PLACES IN SHELTER','ЛЮДЕЙ':'PEOPLE','Сосед':'Neighbor','Ночь, сигнал':'Night, alert','*3:07* НОЧИ':'*3:07* AM','ПРИШЁЛ СИГНАЛ *ТРЕВОГИ*':'AN *ALERT* ARRIVED','ДО УДАРА — *47 МИНУТ*':'IMPACT IN *47 MINUTES*',
'Бег по коридору':'Running down the hall','В ПОДВАЛЕ ЕСТЬ *УБЕЖИЩЕ*':'THE BASEMENT HAS A *SHELTER*','ОДНО НА ВЕСЬ ДОМ':'ONE FOR THE WHOLE BUILDING','И БЕЖИТ ТУДА *ВСЕ*':'AND *EVERYONE* RUNS THERE','Очередь':'The queue','ЛЮДЕЙ У ДВЕРИ':'PEOPLE AT THE DOOR','МЕСТ — *12*':'PLACES — *12*','ЛЮДЕЙ — *31*':'PEOPLE — *31*','ТЫ — *ТРИНАДЦАТЫЙ*':'YOU ARE *THIRTEENTH*',
'Запас':'Supplies','ВОДА':'WATER','3 дня':'3 days','ЕДА':'FOOD','ФИЛЬТР':'FILTER','1 шт':'1 pc','ВНУТРИ ЗАПАС НА *3 ДНЯ*':'INSIDE: SUPPLIES FOR *3 DAYS*','ВОДА. ЕДА. *ФИЛЬТР*':'WATER. FOOD. *FILTER*','НА *12* ЧЕЛОВЕК':'FOR *12* PEOPLE',
'Люк':'The hatch','ДВЕРЬ ЗАКРОЕТСЯ':'THE DOOR WILL CLOSE','ДВЕРЬ ЗАКРОЕТСЯ *САМА*':'THE DOOR CLOSES *BY ITSELF*','ЧЕРЕЗ *3 МИНУТЫ*':'IN *3 MINUTES*','ВНУТРИ — ТОЛЬКО *12*':'INSIDE: ONLY *12*','Выбор':'The choice','*ЛИШНИЙ* — ТЫ':'YOU ARE THE *EXTRA ONE*','ЧТО *ДЕЛАЕШЬ?*':'WHAT DO YOU *DO?*',
'Жуткая переписка':'Creepy chat','Лена':'Lena','Ночь':'Night','НОЧЬЮ ПРИШЛО *СООБЩЕНИЕ*':'A *MESSAGE* CAME AT NIGHT','ОТ ЧЕЛОВЕКА, КОТОРОГО *НЕТ*':'FROM SOMEONE WHO *DOESN’T EXIST*','Чат':'Chat','Ты дома?':'Are you home?','Кто это?':'Who is this?','Не включай свет':'Don’t turn on the light','Я за твоей дверью':'I’m behind your door','ОН ЗНАЛ, ЧТО Я *ОДНА*':'HE KNEW I WAS *ALONE*','СВЕТ ВЫКЛЮЧИЛСЯ *САМ*':'THE LIGHT WENT OUT *BY ITSELF*','Дверь':'The door','ЗА ДВЕРЬЮ *ДЫШАЛИ*':'SOMEONE *BREATHED* BEHIND IT','И ЭТО БЫЛО *УТРОМ*':'AND IT WAS *MORNING*',
'Сложный процент':'Compound interest','ВЗНОС В МЕСЯЦ':'MONTHLY DEPOSIT','ЛЕТ':'YEARS','КАПИТАЛ, ТЫС ₽':'CAPITAL, K ₽','Инвестор':'Investor','Идея':'Idea','10 000 ₽ В МЕСЯЦ *30 ЛЕТ*':'10,000 ₽ A MONTH FOR *30 YEARS*','ПРИ *10%* ГОДОВЫХ':'AT *10%* A YEAR','Формула':'Formula',' тыс ₽':'k ₽','ИТОГО':'TOTAL','ДЕНЬГИ РАСТУТ *НА ДЕНЬГИ*':'MONEY GROWS *ON MONEY*','ВЛОЖИЛ 3,6 МЛН — ПОЛУЧИЛ *22,8*':'PUT IN 3.6M — GOT *22.8*','Вывод':'Takeaway','ГЛАВНОЕ — *ВРЕМЯ*':'WHAT MATTERS: *TIME*','НАЧНИ *СЕГОДНЯ*':'START *TODAY*',
'Новое видео':'New video','Сцена 1':'Scene 1','ТВОЙ *ТЕКСТ* ЗДЕСЬ':'YOUR *TEXT* HERE','Бункер: 30 секунд':'Bunker: 30 seconds','Финансы: сложный процент':'Finance: compound interest','Пустой проект':'Blank project','Новая сцена':'New scene','НОВЫЙ *ТЕКСТ*':'NEW *TEXT*',
'Сигнал тревоги':'Alarm','Сирена':'Siren','Шаги':'Footsteps','Сердцебиение':'Heartbeat','Свист':'Whoosh','Удар':'Hit','Тиканье':'Ticking','Нарастание':'Riser','Скрип двери':'Door creak','Гул толпы':'Crowd murmur','Счётчик Гейгера':'Geiger counter','Писк':'Beep','Взрыв':'Explosion','Уведомление':'Notification','Глитч':'Glitch','Печать':'Stamp','Монеты':'Coins','Победа':'Win','Провал':'Fail','Ветер':'Wind',
'Без музыки':'No music','Напряжение':'Tension','Спокойная':'Calm','Экшен':'Action','Грустная':'Sad','Тайна':'Mystery','Бункер':'Bunker','Хоррор':'Horror','Финансы':'Finance','Космос':'Space','Неон':'Neon','Светлая':'Light',
'Короткие':'Short','Ёжик':'Spiky','Длинные':'Long','Пучок':'Bun','Кепка':'Cap','Лысый':'Bald','Кудри':'Curly','Нет':'None','Очки':'Glasses','Маска':'Mask','Каска':'Helmet','Наушники':'Headphones','Борода':'Beard','Галстук':'Tie','Корона':'Crown',
'Стоит':'Standing','Говорит':'Talking','Идёт':'Walking','Бежит':'Running','Трясётся':'Shaking','Показывает':'Pointing','Машет':'Waving','Сидит':'Sitting','Падает':'Falling','Спокоен':'Calm','Испуган':'Scared','Шок':'Shock','Рад':'Happy','Зол':'Angry','Грустит':'Sad','Спит':'Asleep',
'УБЕЖИЩЕ':'SHELTER','Градиент':'Gradient','Спальня ночью':'Bedroom at night','Коридор':'Corridor','Зал с толпой':'Crowded hall','Сетка':'Grid','Люк убежища':'Shelter hatch','Дверной проём':'Doorway','Город':'City','Улица':'Street','Офис':'Office','Лаборатория':'Lab','Лес':'Forest',
'Плашка':'Popup','Карточки':'Cards','Крупный текст':'Big text','Таймер':'Timer','Счётчик':'Counter','Табличка':'Sign','Полоса':'Bar','Стрелка':'Arrow','ДО ЗАКРЫТИЯ':'UNTIL CLOSING',
'Тряска камеры':'Camera shake','Вспышки':'Flashes','Красная пульсация':'Red pulse','Мигалка':'Beacon','Дождь':'Rain','Снег':'Snow','Пыль':'Dust','Строки ТВ':'TV scanlines','Зерно':'Grain','Затемнение':'Darkening','Ударная волна':'Shockwave',
'Нет ключа ElevenLabs':'No ElevenLabs key','Нет ключа OpenAI':'No OpenAI key','Не выбран голос ElevenLabs':'No ElevenLabs voice selected','Нет ключа Claude API (вкладка «Сценарий»)':'No Claude API key (step “Idea”)','Запрос к Claude…':'Asking Claude…','Ответ без JSON':'Reply has no JSON','В ответе нет сцен':'The reply has no scenes','Видео':'Video','Сцена ':'Scene ',
/* новый интерфейс */
'Сюжетная линия':'Storyline','Часть':'Part','Выбор A/B/C':'Choice A/B/C','Варианты: буква | текст':'Options: letter | text','Бункер: ты тринадцатый':'Bunker: you are number 13','Ты тринадцатый':'You are number 13','Ты':'You','Охранник':'Guard','Офис':'Office','Сирена':'Siren','Бег':'Run','Тринадцатый':'Thirteenth','МЕСТ В БУНКЕРЕ':'PLACES IN BUNKER','ОБЫЧНЫЙ *ВТОРНИК*':'JUST A NORMAL *TUESDAY*','ТЫ В *ОФИСЕ*':'YOU ARE AT THE *OFFICE*','ВОЗДУШНАЯ ТРЕВОГА':'AIR RAID ALERT','ВДРУГ — *СИРЕНА*':'SUDDENLY — A *SIREN*','ЭТО *НЕ* УЧЕНИЕ':'THIS IS *NOT* A DRILL','ОДНО *УБЕЖИЩЕ* НА ЗДАНИЕ':'ONE *SHELTER* PER BUILDING','ЛИФТ СТОИТ — *БЕГОМ*':'LIFT IS DOWN — *RUN*','У ДВЕРИ — *30*':'*30* AT THE DOOR','МЕСТ — ТОЛЬКО *12*':'ONLY *12* PLACES','ОХРАНА *СЧИТАЕТ*':'THE GUARD IS *COUNTING*','*ДВЕНАДЦАТЫЙ* ПРОШЁЛ':'THE *TWELFTH* WENT IN','ТЫ — *ТРИНАДЦАТЫЙ*':'YOU ARE *THIRTEENTH*','МЕСТА *НЕТ*':'NO *ROOM* LEFT','ЧТО ДЕЛАЕШЬ?':'WHAT DO YOU DO?','ПИШИ A, B ИЛИ C':'COMMENT A, B OR C','Отдать место коллеге':'Give the spot to a colleague','Протолкнуться силой':'Push through by force','Искать другое укрытие':'Find another shelter','ДВЕРЬ ЗАКРОЕТСЯ *САМА*':'THE DOOR CLOSES *BY ITSELF*','ЧЕРЕЗ *3 МИНУТЫ*':'IN *3 MINUTES*','*ЛИШНИЙ* — ТЫ':'YOU ARE THE *EXTRA ONE*','ЧТО *ДЕЛАЕШЬ?*':'WHAT DO YOU *DO?*','Идея ':'Idea ','Вид':'Look','Выпуск':'Publish','Музыка и звуки':'Music & sounds','Рамка Instagram':'Instagram frame','Чистый кадр':'Clean frame',
'От идеи до готового Reels: пять шагов, сверху вниз.':'From idea to finished Reel in five steps.','Назад':'Back','Дальше':'Next','Скрыть подсказки':'Hide tips'
};
let lang = 'ru'; try { lang = localStorage.getItem('studio:lang') || ((navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en'); } catch (e) {}
const RX = [
 [/^Готово: (\d+) сцен\. Нажми ▶ и поправь во вкладках «Сцены», «Персонажи»\.$/, 'Done: $1 scenes. Press ▶ and tweak them in the “Scenes” step.'],
 [/^Голосов: (\d+)$/, 'Voices: $1'], [/^Запись… (\d+)%$/, 'Recording… $1%'], [/^Скачать \.(\w+) \((.+) МБ\)$/, 'Download .$1 ($2 MB)'],
 [/^Готово\. Длительность сцен подогнана под речь, ролик ([\d.,]+) с\.$/, 'Done. Scene lengths fit the speech; the video is $1 s.'],
 [/^(\d+) из (\d+)$/, '$1 of $2'], [/^Сцена (\d+)$/, 'Scene $1'], [/^Фраза (\d+)$/, 'Line $1'], [/^Персонаж (\d+)$/, 'Character $1'], [/^Ключ (.+)$/, 'Key $1'],
 [/^Claude API: (.*)$/, 'Claude API: $1'], [/^Не удалось разобрать JSON: (.*)$/, 'Could not parse JSON: $1'], [/^Удалить сцену «(.*)»\?$/, 'Delete scene “$1”?'],
 [/^Заменить текущий проект шаблоном «(.*)»\?$/, 'Replace the current project with the template “$1”?'], [/^Удалить персонажа\? Он пропадёт из сцен\.$/, 'Delete the character? It will disappear from the scenes.'],
 [/^Подпись (\d+)$/, 'Label $1'], [/^Карточки: иконка \| подпись \| значение \(иконки: (.*)$/, 'Cards: icon | label | value (icons: $1'],
 [/^(\d+)\. (.*)$/, null]
];
let rev = null;
function revMap() { if (!rev) { rev = {}; for (const [k, v] of Object.entries(EN)) if (!(v in rev)) rev[v] = k; } return rev; }
function T(s) {
  if (lang !== 'en' || typeof s !== 'string') return s;
  if (EN[s] != null) return EN[s];
  for (const [re, to] of RX) { if (to && re.test(s)) return s.replace(re, to); }
  let q; if ((q = /^(\d+)\. (.*) · ([\d.,]+) с$/.exec(s))) return q[1] + '. ' + T(q[2]) + ' · ' + q[3] + ' s'; if ((q = /^▶ (.+)$/.exec(s))) return '▶ ' + T(q[1]);
  const m = /^(\d+)\. (.+)$/.exec(s); if (m && EN[m[2]] != null) return m[1] + '. ' + EN[m[2]];
  return s;
}
function tt(ru, en) { return lang === 'en' ? en : ru; }
function deep(o, f) { if (typeof o === 'string') return f(o); if (Array.isArray(o)) return o.map(x => deep(x, f)); if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o)) r[k] = deep(o[k], f); return r; } return o; }
/* содержимое проекта: строки по словарю в нужную сторону (для шаблонов и смены языка) */
function mapProject(P, to) { const m = to === 'en' ? EN : revMap(); const skip = k => k === 'bg' || k === 'type' || k === 'c' || k === 'n' || k === 'theme' || k === 'style' || k === 'fmt' || k === 'icon' || k === 'anim' || k === 'expr' || k === 'who' || k === 'hairStyle' || k === 'acc' || k === 'hold' || k === 'provider' || k === 'voiceId' || k === 'model' || k === 'hood' || k === 'hair' || k === 'skin' || k === 'pants' || k === 'color' || k === 'hl';
  const w = (o, key) => { if (typeof o === 'string') return !skip(key) && m[o] != null ? m[o] : o; if (Array.isArray(o)) return o.map(x => w(x, key)); if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o)) r[k] = w(o[k], k); return r; } return o; };
  return w(P, ''); }
/* DOM */
function trNode(n) {
  if (lang !== 'en') return;
  if (n.nodeType === 3) { const v = n.nodeValue, t = v.trim(); if (!t) return; const r = T(t); if (r !== t) n.nodeValue = v.replace(t, r); return; }
  if (n.nodeType !== 1) return; if (/^(SCRIPT|STYLE|CANVAS|TEXTAREA)$/.test(n.tagName)) { if (n.tagName === 'TEXTAREA') for (const a of ['placeholder']) { const x = n.getAttribute(a); if (x) n.setAttribute(a, T(x)); } return; }
  for (const a of ['placeholder', 'title', 'aria-label']) { const x = n.getAttribute && n.getAttribute(a); if (x) { const r = T(x); if (r !== x) n.setAttribute(a, r); } }
  for (const c of Array.from(n.childNodes)) trNode(c);
}
let mo = null;
function watch(root) { if (mo) mo.disconnect(); mo = new MutationObserver(ms => { mo.disconnect(); for (const m of ms) { if (m.type === 'characterData') trNode(m.target); else m.addedNodes.forEach(trNode); } mo.observe(root, { childList: true, characterData: true, subtree: true }); }); mo.observe(root, { childList: true, characterData: true, subtree: true }); }
function setLang(l) { lang = l; try { localStorage.setItem('studio:lang', l); } catch (e) {} document.documentElement.setAttribute('data-slang', l); }
G.StudioI18n = { T, tt, mapProject, deep, setLang, watch, trNode, get lang() { return lang; }, EN };
G.StudioT = T;
document.documentElement.setAttribute('data-slang', lang);
})(window);
