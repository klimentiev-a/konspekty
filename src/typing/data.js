/* Данные тренажёра: словари, тексты, уроки. Все тексты написаны для этого сайта. */
var KD={};
KD.dict={
ru:('дом лес мир год день ночь свет стол окно дверь книга ручка слово буква строка текст урок класс школа город улица дорога река озеро море гора поле трава цветок дерево птица рыба кошка собака лошадь корова мышь волк лиса заяц медведь еж '+
'вор лов дар рад ода вал вол ров лад лак лара фара фаза дала ждал ждали овал ворон волна вода дрова парад пара ладно пол полка пропал просто проза пара парта раб рай ропот ворота дорога рамка рама лапа папа мама дача '+
'вода вдова пожар поход проход вопрос ответ друг подруга брат сестра отец мать сын дочь семья дед баба муж жена человек люди дети ребенок мальчик девочка '+
'утро день вечер ночь неделя месяц год час минута секунда сегодня завтра вчера сейчас потом всегда никогда иногда часто редко рано поздно быстро медленно '+
'хлеб молоко сыр масло яйцо мясо рыба суп каша чай кофе сахар соль вода сок яблоко груша банан лимон картошка морковь капуста огурец помидор лук чеснок '+
'рука нога голова глаз ухо нос рот зуб волос лицо спина плечо палец сердце '+
'красный синий зеленый желтый белый черный серый голубой розовый оранжевый '+
'большой маленький новый старый добрый злой умный глупый веселый грустный тихий громкий сильный слабый легкий тяжелый светлый темный теплый холодный горячий '+
'читать писать думать знать понимать говорить слушать смотреть видеть идти бежать ехать лететь плыть стоять сидеть лежать спать жить любить хотеть мочь уметь учить учиться работать играть гулять '+
'делать брать давать искать находить терять покупать продавать платить считать помогать просить спрашивать отвечать начинать заканчивать открывать закрывать '+
'экзамен задача решение вопрос ответ тема лекция семинар зачет оценка группа курс студент преподаватель аудитория тетрадь учебник конспект расписание '+
'компьютер клавиатура мышь экран кнопка файл папка письмо сообщение сайт страница ссылка пароль телефон интернет программа приложение сеть '+
'деньги цена рубль банк счет карта доход расход бюджет вклад кредит налог рынок товар услуга прибыль акция облигация ставка курс '+
'эхо этап этаж этот эти экран экзамен экспресс эксперт электрон электричество энергия поэт эпоха эффект '+
'объект объем съезд подъезд объявление въезд подъем съесть объяснить обьект '+
'цель центр цена цвет цирк цифра цепь церковь цветок шапка шум шаг школа шкаф шорты щека щенок щит щетка борщ товарищ тещи '+
'чай час часть чашка число чудо чужой чистый честный чувство человек четыре '+
'фото фильм фрукт фонарь форма фирма физика факт февраль финал '+
'юг юбка юный юрист июль июнь ночью ясно якорь яблоко ягода язык яркий январь явно яма '+
'мост метро место машина мясо мыло мера минута музыка модель можно много мало между метр масса '+
'бумага белка берег билет блюдо болото брюки быстро буря бабушка байка борода '+
'тепло метель снег дождь ветер туман гроза солнце луна звезда небо облако радуга мороз жара весна лето осень зима '+
'путь поезд самолет автобус машина дорога вокзал билет багаж маршрут остановка паспорт гостиница '+
'правда счастье радость мечта цель успех друг привычка пример причина смысл тишина порядок').split(' ').filter(function(w,i,a){return w&&a.indexOf(w)===i}),
en:('the be to of and a in that have it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us '+
'house city street river water light night road table window door book pen word letter line text class school lesson friend family mother father brother sister child woman man girl boy teacher student '+
'read write learn study think know understand speak listen watch see walk run drive fly swim stand sit sleep live love want need try help ask answer start finish open close '+
'red blue green yellow white black gray small big old young happy sad quiet loud strong weak light heavy warm cold hot fast slow early late '+
'bread milk cheese butter egg meat fish soup tea coffee sugar salt apple lemon banana potato '+
'money price bank card income budget market share profit rate today tomorrow yesterday always never often seldom '+
'keyboard computer screen mouse button file folder message site page link password phone program network').split(' ').filter(function(w,i,a){return w&&a.indexOf(w)===i})
};
KD.vow={ru:'аоуыэяюеи',en:'aeiouy'};
/* Уроки: n — новые буквы; тип по умолчанию «буквы». */
KD.lessons={
ru:[
{t:'Указательные пальцы: а о',n:'ао'},{t:'Средние пальцы: в л',n:'вл'},{t:'Безымянные пальцы: ы д',n:'ыд'},{t:'Мизинцы: ф ж',n:'фж'},
{t:'Тянемся к центру: п р',n:'пр'},{t:'Верхний ряд, указательные: е н',n:'ен'},{t:'Верхний ряд: к г',n:'кг'},{t:'Верхний ряд: у ш',n:'уш'},
{t:'Верхний ряд: ц щ',n:'цщ'},{t:'Верхний ряд: й з',n:'йз'},{t:'Нижний ряд: м и т ь',n:'мить'},{t:'Нижний ряд: с б',n:'сб'},
{t:'Нижний ряд: ч ю',n:'чю'},{t:'Крайние буквы: я х',n:'ях'},{t:'Редкие буквы: э ъ',n:'эъ'},
{t:'Заглавные буквы',k:'caps'},{t:'Точка и запятая',k:'pun1'},{t:'Цифры',k:'dig'},{t:'Знаки: ! ? : ; ( ) -',k:'pun2'},{t:'Предложения',k:'sent'},{t:'Итоговый текст',k:'final'}],
en:[
{t:'Указательные: f j',n:'fj'},{t:'Средние: d k',n:'dk'},{t:'Безымянные: s l',n:'sl'},{t:'Мизинцы: a ;',n:'a;'},{t:'Центр: g h',n:'gh'},
{t:'Верхний ряд: r u e i',n:'ruei'},{t:'Верхний ряд: t y w o',n:'tywo'},{t:'Верхний ряд: q p',n:'qp'},{t:'Нижний ряд: v m c ,',n:'vmc'},{t:'Нижний ряд: b n x .',n:'bnx'},{t:'Буква z',n:'z'},
{t:'Заглавные буквы',k:'caps'},{t:'Точка и запятая',k:'pun1'},{t:'Цифры',k:'dig'},{t:'Предложения',k:'sent'},{t:'Итоговый текст',k:'final'}]
};
KD.sent={
ru:['Мы начинаем с простого.','Утром я пью чай и читаю.','Сегодня хороший день для учёбы.','Не спеши, главное — без ошибок.','Каждый день понемногу — и скорость растёт.','Руки лежат на клавишах спокойно.','Смотри на экран, а не на клавиатуру.','Привет! Как дела?','В субботу мы идём гулять, а в воскресенье отдыхаем.','Кофе остыл, но работа не ждёт.','Дождь кончился, и на улице стало тихо.','Хорошая привычка — это маленький шаг каждый день.'].map(function(s){return s.replace(/ё/g,'е')}),
en:['We start with something simple.','I drink tea and read in the morning.','Today is a good day to study.','Do not rush, accuracy comes first.','A little every day makes you faster.','Keep your hands calm on the keys.','Look at the screen, not at the keyboard.','Hello! How are you?','On Saturday we walk, and on Sunday we rest.','The coffee is cold, but work will not wait.']
};
KD.texts={
ru:[
{id:'r1',c:'t',t:'Как учиться печатать',s:'Печатать вслепую не так трудно, как кажется. Нужно положить пальцы на среднюю строку, смотреть на экран и не торопиться. Сначала важна точность, скорость придёт сама. Десять минут в день дадут больше, чем час раз в неделю.'},
{id:'r2',c:'t',t:'Утро в городе',s:'Город просыпается медленно. Сначала зажигаются окна на верхних этажах, потом открываются булочные, и по улицам разносится запах свежего хлеба. Люди идут на работу, держа в руках стаканы с горячим кофе.'},
{id:'r3',c:'t',t:'Про привычки',s:'Привычка — это то, что мы делаем без усилий. Чтобы она появилась, нужно повторять одно и то же действие в одно и то же время. Не ставь слишком больших целей. Пусть будет пять минут, но каждый день.'},
{id:'r4',c:'t',t:'Перед экзаменом',s:'Перед экзаменом лучше выспаться, чем читать конспект до утра. Мозг запоминает во сне. Повтори главное, выпей воды, возьми с собой паспорт и ручку. Если стало страшно, сделай три медленных вдоха.'},
{id:'r5',c:'t',t:'Про деньги',s:'Бюджет — это не запрет, а план. Запиши, сколько денег приходит и куда они уходят. Отложи небольшую часть сразу, как только получил доход. Через год ты удивишься, сколько накопилось.'},
{id:'r6',c:'t',t:'Облака',s:'Облака состоят из мельчайших капель воды и кристалликов льда. Они кажутся лёгкими, но целое облако может весить как сотня слонов. Просто эта масса распределена по огромному объёму воздуха.'.replace(/ё/g,'е')},
{id:'r7',c:'t',t:'Выходные',s:'В субботу мы поехали за город. Было тепло, пахло травой и дымом. Мы долго шли по тропинке вдоль реки, потом сидели на берегу, пили чай из термоса и ничего не делали. Это было лучшее время недели.'},
{id:'r8',c:'t',t:'Про сон',s:'Взрослому человеку нужно семь–восемь часов сна. Если ложиться в одно и то же время, засыпать становится проще. За час до сна лучше убрать телефон: яркий экран мешает мозгу понять, что наступила ночь.'},
{id:'r9',c:'w',t:'Скороговорки',s:'Карл у Клары украл кораллы, а Клара у Карла украла кларнет. Тридцать три корабля лавировали, лавировали, да не вылавировали. На дворе трава, на траве дрова.'},
{id:'r10',c:'w',t:'Ещё скороговорки',s:'Шла Саша по шоссе и сосала сушку. Сорок сорок съели сорок сыроежек. Бык тупогуб, тупогубенький бычок, у быка губа бела была тупа.'}].map(function(x){x.s=x.s.replace(/ё/g,'е');return x}),
en:[
{id:'e1',c:'t',t:'How to learn typing',s:'Touch typing is easier than it looks. Put your fingers on the home row, look at the screen and do not hurry. Accuracy matters first, and speed will come by itself. Ten minutes every day work better than one hour a week.'},
{id:'e2',c:'t',t:'Morning in the city',s:'The city wakes up slowly. First the windows on the top floors light up, then the bakeries open, and the smell of fresh bread fills the streets. People go to work with hot coffee in their hands.'},
{id:'e3',c:'t',t:'About habits',s:'A habit is something we do without effort. To build one, repeat the same action at the same time. Do not set huge goals. Five minutes is enough, but do it every single day.'},
{id:'e4',c:'t',t:'Before an exam',s:'Before an exam it is better to sleep than to read your notes until morning. The brain stores memories during sleep. Repeat the main points, drink some water and take your passport and a pen.'},
{id:'e5',c:'t',t:'About money',s:'A budget is not a ban, it is a plan. Write down how much money comes in and where it goes. Put aside a small part as soon as you get your income. In a year you will be surprised how much you have saved.'}]
};

/* ---------- Второй уровень сложности ---------- */
KD.long={
ru:('ответственность возможность необходимость деятельность образование информация организация производство управление развитие обеспечение требование соглашение обязательство собственность имущество представитель законодательство регулирование ограничение исполнение рассмотрение определение распределение особенность достижение преимущество подготовка конкуренция инвестиции стоимость рентабельность ликвидность прибыльность доходность волатильность инфляция девальвация капитализация диверсификация '+
'университет специальность аудитория расписание преподаватель студенческий экзаменационный дисциплина семестровый библиотека лаборатория практика исследование конференция презентация '+
'путешествие приключение впечатление удивительный замечательный великолепный неожиданный одновременно по-прежнему благодаря несмотря вследствие относительно соответствующий '+
'компьютерный программирование разработчик приложение платформа инструмент технология автоматизация пользователь настройка подключение обновление безопасность '+
'здравоохранение строительство транспортный промышленность сельскохозяйственный электростанция телекоммуникация '+
'взаимодействие самостоятельный целеустремленный трудолюбивый основополагающий последовательность одновременность переосмысление противоречивый').split(' ').map(function(w){return w.replace(/ё/g,'е')}),
en:('responsibility opportunity necessity activity education information organization production management development requirement agreement obligation ownership representative legislation regulation restriction performance consideration distribution achievement advantage preparation competition investment profitability liquidity volatility inflation capitalization diversification '+
'university specialty classroom schedule professor semester discipline library laboratory research conference presentation '+
'adventure impression wonderful unexpected simultaneously nevertheless throughout regardless appropriate programming developer application platform automation security configuration communication environment').split(' ')
};
KD.sent2={
ru:['Если сумма вклада — 250 000 рублей, а ставка составляет 14,5% годовых, то за год доход будет около 36 250 рублей.','Встреча назначена на 12.03.2027 в 15:30 (аудитория 4-17); при опоздании более чем на 10 минут вход закрыт.','«Не откладывай на завтра то, что можно сделать сегодня», — говорил мой дед, но сам всегда делал наоборот.','Контракт № 48/2026 подписан сторонами; оплата — в течение 5 (пяти) рабочих дней, иначе начисляется неустойка: 0,1% в день.','Во-первых, нужно проверить исходные данные; во-вторых — сравнить их с прошлым годом; в-третьих, сделать выводы.','Почему, когда спешишь, ошибок больше? Потому что мозг опережает пальцы, а пальцы не успевают за мозгом!','Температура упала до −5 °C, поэтому электричка опоздала на 20 минут, а кофе в буфете закончился ещё утром.','Курс вырос на 3,2% (до 98,40 за доллар), однако аналитики ждут коррекции: «рынок перегрет», — пишет «Коммерсантъ».','Сначала — разминка, затем — основная часть, в конце — растяжка; так советует тренер, и с ним трудно спорить.','Проект включает три этапа: анализ (2 недели), разработку (6 недель) и тестирование (3 недели); итого — 11 недель.'].map(function(s){return s.replace(/ё/g,'е').replace(/−/g,'-').replace(/°C/g,'C')}),
en:['If the deposit is 250,000 dollars and the rate is 14.5% a year, the income after one year will be about 36,250 dollars.','The meeting is set for 12.03.2027 at 3:30 p.m. (room 4-17); if you are more than 10 minutes late, the door is closed.','"Do not put off until tomorrow what you can do today," my grandfather used to say, but he always did the opposite.','Contract No. 48/2026 is signed; payment is due within 5 (five) working days, otherwise a penalty of 0.1% per day applies.','First, check the source data; second, compare it with last year; third, draw conclusions.','Why are there more mistakes when you hurry? Because the brain runs ahead of the fingers, and the fingers cannot keep up!']
};
/* d: 1 — лёгкий, 2 — средний, 3 — сложный */
KD.texts.ru.forEach(function(x){x.d=x.c==='w'?3:(x.s.length<260?1:2)});
KD.texts.en.forEach(function(x){x.d=x.s.length<230?1:2});
KD.texts.ru=KD.texts.ru.concat([
{id:'h1',c:'t',d:3,t:'Бюджет студента (с цифрами)',s:'Допустим, стипендия составляет 4 800 рублей в месяц, подработка приносит ещё 15 000, а расходы — 17 350: проезд (2 200), еда (9 500), связь (650), учёба и прочее (5 000). Остаток — 2 450 рублей, то есть около 12,4% дохода. Если откладывать их ежемесячно, за год накопится 29 400 рублей; при ставке 14% годовых набежит ещё примерно 2 000.'},
{id:'h2',c:'t',d:3,t:'Как работает память',s:'Память делится на кратковременную и долговременную: информация сначала попадает в «буфер» объёмом 5–9 элементов, а затем, при повторении, переходит дальше. Именно поэтому интервальные повторения (через 1 день, 3 дня, неделю, месяц) эффективнее, чем «зубрёжка» за ночь до экзамена; об этом писал ещё Эббингауз — и его выводы подтверждаются до сих пор.'},
{id:'h3',c:'t',d:3,t:'Деловое письмо',s:'Уважаемые коллеги! Направляю вам проект договора № 17/2026 для согласования. Просим рассмотреть его до 20.11.2026 и сообщить замечания; после этого документ будет передан на подпись руководителю (приложение 1 — спецификация, приложение 2 — график платежей). Если возникнут вопросы, пишите на почту или звоните: 8 (800) 555-35-35. С уважением, отдел договорной работы.'},
{id:'h4',c:'t',d:3,t:'Про инфляцию',s:'Инфляция — это устойчивый рост общего уровня цен, при котором каждая денежная единица покупает всё меньше товаров и услуг. Центральный банк борется с ней, повышая ключевую ставку: кредиты дорожают, спрос падает, а рост цен замедляется. Однако у такой политики есть цена — замедление экономики, рост безработицы и снижение инвестиций; поэтому решение всегда является компромиссом.'},
{id:'h5',c:'t',d:2,t:'Путешествие на поезде',s:'Поезд отправлялся в 6:40, и мы пришли на вокзал заранее, чтобы не спешить. В вагоне пахло чаем и свежим бельём, за окном медленно проплывали поля, перелески и маленькие станции с одинаковыми названиями. К вечеру разговоры стихли, и осталось только мерное постукивание колёс.'},
{id:'h6',c:'t',d:3,t:'Алгоритм и программа',s:'Алгоритм — это конечная последовательность чётких шагов, приводящая к результату; программа — запись алгоритма на языке, понятном компьютеру. Хороший алгоритм обладает свойствами: детерминированностью, массовостью, результативностью и дискретностью. Сложность оценивают не секундами, а числом операций в зависимости от размера входных данных, например линейно или квадратично.'},
{id:'h7',c:'t',d:3,t:'Договор и обязательство',s:'Обязательство — это правоотношение, в силу которого одно лицо (должник) обязано совершить в пользу другого лица (кредитора) определённое действие либо воздержаться от него, а кредитор вправе требовать исполнения. Обязательства возникают из договоров, причинения вреда, неосновательного обогащения и иных оснований; исполнять их следует надлежащим образом, в установленный срок.'},
{id:'h8',c:'t',d:2,t:'Зачем нужна скорость печати',s:'Быстрая печать экономит время каждый день: конспекты, письма, курсовые, чаты. При скорости 200 знаков в минуту страница текста набирается примерно за 9 минут, а при скорости 100 — почти за 20. Но важнее скорости точность: исправлять ошибки дольше, чем печатать медленнее, но чисто.'}
].map(function(x){x.s=x.s.replace(/ё/g,'е').replace(/²/g,'2');return x}));
KD.texts.en=KD.texts.en.concat([
{id:'g1',c:'t',d:3,t:'A student budget (with numbers)',s:'Suppose the scholarship is 480 dollars a month, a part-time job brings another 1,500, and expenses are 1,735: transport (220), food (950), phone (65), study and other costs (500). What remains is 245 dollars, about 12.4% of income. If you save it every month, you will have 2,940 in a year; at 14% interest you will earn roughly 200 more.'},
{id:'g2',c:'t',d:3,t:'How memory works',s:'Memory is divided into short-term and long-term: information first enters a buffer of 5-9 items and, with repetition, moves further. That is why spaced repetition (after 1 day, 3 days, a week, a month) works better than cramming the night before an exam; Ebbinghaus wrote about it long ago, and his conclusions still hold.'},
{id:'g3',c:'t',d:3,t:'On inflation',s:'Inflation is a sustained rise in the general price level, so each unit of money buys fewer goods and services. A central bank fights it by raising the key rate: loans become more expensive, demand falls, and price growth slows down. However, such a policy has a cost - slower growth, higher unemployment and lower investment; therefore every decision is a compromise.'},
{id:'g4',c:'t',d:2,t:'A trip by train',s:'The train left at 6:40, and we came to the station early so as not to hurry. The carriage smelled of tea and fresh linen, and outside the window fields, groves and small stations with identical names slowly floated past. By evening the talk faded, and only the steady knocking of the wheels remained.'}
]);
/* Нормализация: только знаки, которые есть на клавиатуре */
(function(){var f=function(s){return s.replace(/[—–−]/g,'-').replace(/[«»„“”]/g,'"').replace(/…/g,'...').replace(/[’‘]/g,"'")};
['ru','en'].forEach(function(l){KD.texts[l].forEach(function(x){x.s=f(x.s)});KD.sent[l]=KD.sent[l].map(f);KD.sent2[l]=KD.sent2[l].map(f)})})();
