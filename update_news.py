#!/usr/bin/env python3
"""Лента новостей → news.json (заголовки, анонс, важность) + news_text.json (подробный пересказ, грузится только при открытии новости).
Источники: десятки российских и международных RSS-лент, ленты Yahoo Finance по каждой компании США и поиск Google Новостей
(агрегирует сотни изданий). Одинаковые сюжеты из разных изданий склеиваются; чем больше изданий написало и чем «рыночнее»
тема, тем выше важность. Запускается GitHub Action'ом раз в час."""
import json, os, re, sys, time, html, hashlib, datetime, email.utils, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from newsutil import article, lead, tr, tr_list, gn_decode, CYR, UA, SPLIT

NOW = datetime.datetime.now(datetime.timezone.utc)
def ago(**kw): return (NOW - datetime.timedelta(**kw)).strftime('%Y-%m-%dT%H:%M:%SZ')
US = ['NVDA', 'AAPL', 'GOOGL', 'MSFT', 'AMZN', 'META', 'AVGO', 'TSLA', 'BRK-B', 'LLY', 'AMD', 'WMT', 'JPM', 'V', 'XOM', 'JNJ', 'MA',
      'COST', 'CVX', 'ORCL', 'KO', 'BAC', 'PG', 'UNH', 'NFLX']

def G(q, lang='ru'):
    hl = 'hl=ru&gl=RU&ceid=RU:ru' if lang == 'ru' else 'hl=en-US&gl=US&ceid=US:en'
    return 'https://news.google.com/rss/search?q=' + urllib.parse.quote(q + ' when:1d') + '&' + hl

FEEDS = [
    # --- Россия ---
    ('Интерфакс', 'ru', 'https://www.interfax.ru/rss.asp'),
    ('РБК', 'ru', 'https://rssexport.rbc.ru/rbcnews/news/30/full.rss'),
    ('Ведомости', 'ru', 'https://www.vedomosti.ru/rss/news'),
    ('Ведомости', 'ru', 'https://www.vedomosti.ru/rss/rubric/finance'),
    ('Ведомости', 'ru', 'https://www.vedomosti.ru/rss/rubric/business'),
    ('Коммерсантъ', 'ru', 'https://www.kommersant.ru/RSS/news.xml'),
    ('Коммерсантъ', 'ru', 'https://www.kommersant.ru/RSS/section-economics.xml'),
    ('Коммерсантъ', 'ru', 'https://www.kommersant.ru/RSS/section-business.xml'),
    ('ТАСС', 'ru', 'https://tass.ru/rss/v2.xml'),
    ('ПРАЙМ', 'ru', 'https://1prime.ru/export/rss2/index.xml'),
    ('РИА Новости', 'ru', 'https://ria.ru/export/rss2/economy/index.xml'),
    ('Лента.ру', 'ru', 'https://lenta.ru/rss/news/economics'),
    ('Известия', 'ru', 'https://iz.ru/xml/rss/all.xml'),
    ('Российская газета', 'ru', 'https://rg.ru/xml/index.xml'),
    ('Газета.ру', 'ru', 'https://www.gazeta.ru/export/rss/business.xml'),
    ('Forbes', 'ru', 'https://www.forbes.ru/newrss.xml'),
    ('Банки.ру', 'ru', 'https://www.banki.ru/xml/news.rss'),
    ('Финмаркет', 'ru', 'https://www.finmarket.ru/rss/mainnews.asp'),
    ('Frank Media', 'ru', 'https://frankmedia.ru/feed'),
    ('БКС Экспресс', 'ru', 'https://bcs-express.ru/rss'),
    ('Investing.com', 'ru', 'https://ru.investing.com/rss/news.rss'),
    ('Финам', 'ru', 'https://www.finam.ru/analysis/conews/rsspoint/'),
    ('BFM', 'ru', 'https://www.bfm.ru/news.rss'),
    ('Эксперт', 'ru', 'https://expert.ru/rss/'),
    ('Банк России', 'cbr', 'https://www.cbr.ru/rss/RssPress'),
    ('Банк России', 'cbr', 'https://www.cbr.ru/rss/eventrss'),
    # --- мир ---
    ('CNBC', 'world', 'https://www.cnbc.com/id/10000664/device/rss/rss.html'),
    ('CNBC', 'world', 'https://www.cnbc.com/id/100003114/device/rss/rss.html'),
    ('CNBC', 'world', 'https://www.cnbc.com/id/20910258/device/rss/rss.html'),
    ('CNBC', 'world', 'https://www.cnbc.com/id/19854910/device/rss/rss.html'),
    ('MarketWatch', 'world', 'https://feeds.content.dowjones.io/public/rss/mw_topstories'),
    ('MarketWatch', 'world', 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse'),
    ('WSJ', 'world', 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain'),
    ('WSJ', 'world', 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml'),
    ('Yahoo Finance', 'world', 'https://finance.yahoo.com/news/rssindex'),
    ('Financial Times', 'world', 'https://www.ft.com/markets?format=rss'),
    ('BBC', 'world', 'https://feeds.bbci.co.uk/news/business/rss.xml'),
    ('The Guardian', 'world', 'https://www.theguardian.com/business/rss'),
    ('New York Times', 'world', 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml'),
    ('Seeking Alpha', 'world', 'https://seekingalpha.com/market_currents.xml'),
    ('Investing.com', 'world', 'https://www.investing.com/rss/news.rss'),
    ('Business Insider', 'world', 'https://markets.businessinsider.com/rss/news'),
    ('Nasdaq', 'world', 'https://www.nasdaq.com/feed/rssoutbound?category=Markets'),
    ('Fortune', 'world', 'https://fortune.com/feed/fortune-feeds/?id=3230629'),
    ('The Economist', 'world', 'https://www.economist.com/finance-and-economics/rss.xml'),
    # --- крипта ---
    ('ForkLog', 'crypto', 'https://forklog.com/feed'),
    ('Bits.media', 'crypto', 'https://bits.media/rss/news/'),
    ('Cointelegraph', 'crypto', 'https://cointelegraph.com/rss'),
    ('CoinDesk', 'crypto', 'https://www.coindesk.com/arc/outboundfeeds/rss/'),
    ('Decrypt', 'crypto', 'https://decrypt.co/feed'),
    ('The Block', 'crypto', 'https://www.theblock.co/rss.xml'),
]
# поиск Google Новостей за последние сутки — сотни изданий, включая Reuters и Bloomberg
FEEDS += [(None, 'ru', G(q)) for q in ['Мосбиржа акции', 'фондовый рынок России', 'ключевая ставка ЦБ', 'курс рубля', 'ОФЗ доходность',
                                         'дивиденды совет директоров', 'нефть Brent', 'санкции банки', 'отчетность МСФО прибыль', 'атака дата-центр OR НПЗ']]
FEEDS += [(None, 'world', G(q, 'en')) for q in ['stock market today', 'Wall Street stocks', 'Federal Reserve rates', 'earnings stock shares',
                                                 'site:reuters.com markets', 'site:bloomberg.com markets', 'oil prices', 'Treasury yields']]
FEEDS += [(None, 'crypto', G('bitcoin price', 'en'))]
FEEDS += [('Yahoo Finance', 'us:' + t, 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=' + t + '&region=US&lang=en-US') for t in US]

NAMES = {'SBER': ['Сбербанк', 'Сбер'], 'GAZP': ['Газпром'], 'LKOH': ['ЛУКОЙЛ', 'Лукойл'], 'ROSN': ['Роснефть', 'Роснефти'],
         'NVTK': ['НОВАТЭК', 'Новатэк'], 'GMKN': ['Норникел', '«Норильский никель»'], 'PLZL': ['«Полюс»', 'Полюса', 'Полюс '],
         'TATN': ['Татнефть', 'Татнефти'], 'SNGS': ['Сургутнефтегаз'], 'SIBN': ['Газпром нефть', 'Газпром нефти'],
         'YDEX': ['Яндекс'], 'X5': ['X5', 'Пятёрочк', 'Пятерочк'], 'MGNT': ['Магнит'], 'MTSS': ['МТС'], 'CHMF': ['Северстал'],
         'NLMK': ['НЛМК'], 'VTBR': ['ВТБ'], 'T': ['Т-Технологи', 'Т-Банк'], 'OZON': ['Ozon', 'Озон'], 'ALRS': ['АЛРОСА', 'Алроса'],
         'PHOR': ['ФосАгро'], 'AFLT': ['Аэрофлот'], 'MOEX': ['Мосбирж', 'МосБирж', 'Московская биржа', 'Московской бирж'], 'IRAO': ['Интер РАО'],
         'RUAL': ['Русал', 'РУСАЛ'], 'TRNFP': ['Транснефт'], 'POSI': ['Positive Technologies', 'Позитив'], 'HEAD': ['HeadHunter', 'Хэдхантер', 'hh.ru']}
# американские компании и крипта: ищем по словам целиком (латиница и русские названия)
NAMES_RX = {'AAPL': r'Apple|Эппл', 'MSFT': r'Microsoft|Майкрософт', 'NVDA': r'Nvidia|NVIDIA|Nvidia\'s|Нвидиа|Nvidia’s', 'AMZN': r'Amazon|Амазон',
    'GOOGL': r'Alphabet|Google|Гугл', 'META': r'Meta Platforms|Meta(?=\s|’|\'|,)|Facebook', 'TSLA': r'Tesla|Тесла', 'BRK-B': r'Berkshire|Баффет|Buffett',
    'AVGO': r'Broadcom', 'JPM': r'JPMorgan|JP Morgan|Dimon', 'LLY': r'Eli Lilly|Lilly', 'V': r'Visa(?! Waiver)', 'XOM': r'Exxon',
    'WMT': r'Walmart', 'MA': r'Mastercard', 'UNH': r'UnitedHealth', 'JNJ': r'Johnson & Johnson|J&J', 'PG': r'Procter', 'COST': r'Costco',
    'NFLX': r'Netflix', 'KO': r'Coca-Cola|Coca Cola', 'CVX': r'Chevron', 'BAC': r'Bank of America', 'AMD': r'AMD|Advanced Micro', 'ORCL': r'Oracle',
    'BTC': r'Bitcoin|[Бб]иткоин[а-яё]*|BTC', 'ETH': r'Ethereum|[Ээ]фириум[а-яё]*|Эфир[а-яё]*|Ether\b|ETH\b', 'SOL': r'Solana|[Сс]олан[аеыу]', 'XRP': r'XRP|Ripple', 'TON': r'Toncoin|TON\b|[Тт]онкоин[а-яё]*',
    'DOGE': r'Dogecoin|DOGE', 'BNB': r'BNB|Binance Coin', 'USDT': r'Tether|USDT',
    '^GSPC': r'S&P 500|S&P|Wall Street|Уолл-стрит|американск[а-я]+ (?:рын|бирж|акци)', '^IXIC': r'Nasdaq|Насдак', '^DJI': r'Dow Jones|Dow(?= )|Доу-Джонс',
    '000688.SS': r'STAR Market|STAR 50|Star Market|Star 50|科创板|Научно-технологическ\w+ инновацион\w+ бирж\w+|Star-?market|китайск\w+ чип\w+|Cambricon|SMIC|Cambricon|Камбрикон',
    '^HSTECH': r'Hang Seng Tech|Hang Seng TECH|Hang Seng Technology|HSTECH',
    '000300.SS': r'CSI 300|CSI300|Shanghai[- ]Shenzhen 300|沪深300',
    '399006.SZ': r'ChiNext|Chinext|创业板|Shenzhen Component|Shenzhen Composite',
    '^HSCE': r'Hang Seng China Enterprises|HSCEI|H-share|H-shares',
    '^TWII': r'TAIEX|Taiex|Taiwan Weighted|TSMC|Taiwan Semiconductor|ТСМС',
    '^HSI': r'Hang Seng(?! Tech)(?! China)|Hang Seng Index|Хан[гк]\s?Сен\w*|гонконгск\w+ (?:индекс|бирж|рын)',
    '^N225': r'Nikkei|Никкей|Nikkei 225|Токийск\w+ бирж',
    '^STOXX50E': r'Euro Stoxx|STOXX 50|Stoxx 50',
    '^GDAXI': r'\bDAX\b|Франкфуртск\w+ бирж',
    '^FTSE': r'FTSE 100|FTSE|Лондонск\w+ бирж',
    '^KS11': r'KOSPI|Kospi'}
NAMES_RX = {k: re.compile(r'(?<![A-Za-zА-Яа-яЁё])(?:' + v + r')(?![a-zа-яё])') for k, v in NAMES_RX.items()}
MOEX_CO = re.compile(r'(?i)акци[яиюй]\s+(?:«)?Мос[Бб]ирж|Мос[Бб]ирж[аеиу]\S*\s+(?:увелич|сократ|отчит|выплат|направ|рекоменд|получ|заработ|снизил|нарастил)|дивиденд|прибыл|выручк|МСФО|РСБУ|комисси[ия] биржи|Moscow Exchange (?:profit|revenue|dividend)')
def tags_of(title):
    t = [k for k, v in NAMES.items() if any(n in title for n in v)] + [k for k, r in NAMES_RX.items() if r.search(title)]
    if 'MOEX' in t and not MOEX_CO.search(title):   # «индекс Мосбиржи», «торги на Мосбирже» — это рынок, а не акции самой биржи
        t.remove('MOEX')
        if re.search(r'индекс|рын[оке]|торг|акци[ийя] (?:РФ|России)', title, re.I): t.append('IMOEX')
    return t
FIN = re.compile(r'(?<![А-Яа-яЁёA-Za-z])(акци[йияюе](?! протест)(?! памяти)(?! в поддержку)|бирж|рубл[ья]|ставк|ЦБ|Банк[а-я]* России|нефт|газа?(?![а-я])|дивиденд|облигац|ОФЗ|инфляц|бюджет|IPO|SPO|санкц|прибыль|чист[а-я]+ прибыл|выручк|МСФО|сделк|ВВП|курс[аеу]? (?:доллар|рубл|юан|евро)|доллар|юан|индекс[а-я]* Мосбирж|Мосбирж|экспорт|налог|Минфин|ФРС|Brent|Urals|золот[оа](?![а-я])|инвест|капитализац|госдолг|ипотек|котировк|размещени|эмисси|банкротств|M&A|слияни|поглощени)', re.I)
def keep(x):
    if x['cat'] == 'world':
        return not re.search(r"\bMy \b|^‘|\bI \b|\bwife\b|\bhusband\b|\bsister\b|\bbrother\b|\brecipe|\bhoroscope", x['t'], re.I)
    return x['cat'] != 'ru' or x.get('tags') or FIN.search(x['t'])
def txt(el, tag):
    x = el.find(tag)
    return html.unescape(re.sub(r'<[^>]+>', ' ', x.text or '')).strip() if x is not None and x.text else ''
def when(s):
    try: return email.utils.parsedate_to_datetime(s).astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    except Exception: return None

def pull(feed):
    src, cat, url = feed
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20).read()
        root = ET.fromstring(r)
    except Exception as e:
        print('rss', src or url[:70], str(e)[:80], file=sys.stderr); return []
    res = []
    for it in list(root.iter('item'))[:(30 if src is None else 100)]:
        title, link = txt(it, 'title'), txt(it, 'link')
        d = when(txt(it, 'pubDate'))
        if not title or not link or not d or d < ago(days=5): continue
        s_ = src
        if s_ is None:   # Google Новости: издание — в <source>, оно же в конце заголовка
            s_ = (it.findtext('source') or 'Google Новости').strip()
            if title.endswith(' - ' + s_): title = title[:-len(s_) - 3].strip()
            s_ = re.sub(r'^https?://(?:www\.)?|/$', '', s_)
            if not re.search(r'[A-Za-zА-Яа-яЁё]', s_): continue   # издания на фарси, китайском и т.п. пропускаем
        desc = txt(it, 'description')
        if src is None: desc = ''
        ft = [cat[3:]] if cat.startswith('us:') else []
        x = {'t': title, 'u': link, 's': s_, 'cat': 'us' if ft else cat, 'd': min(d, NOW.strftime('%Y-%m-%dT%H:%M:%SZ')), 'x': desc[:300],
             'tags': sorted(set(tags_of(title)) | set(ft))}
        if ft: x['ft'] = ft
        if 'news.google.com' in link: x['g'] = 1
        if keep(x): res.append(x)
    return res

with ThreadPoolExecutor(8) as ex:
    items = [x for part in ex.map(pull, FEEDS) for x in part]
print('fetched', len(items))

# ---------- слияние со старой лентой ----------
try: oldn = json.load(open('news.json')).get('items', [])
except Exception: oldn = []
TEXT = {}
for fn_ in ('news_text_arch.json', 'news_text.json'):   # свежие пересказы и архив лежат в разных файлах
    try: TEXT.update(json.load(open(fn_)))
    except Exception: pass
def key(x): return (x['g'] if isinstance(x.get('g'), str) else x['u']).split('?')[0]
for x in oldn:   # старый формат: подробный текст лежал в sum
    x.setdefault('id', hashlib.md5(key(x).encode()).hexdigest()[:10])
    if x.get('sum') and x['id'] not in TEXT and (len(x['sum']) > 1 or len(x['sum'][0]) > 400):
        TEXT[x['id']] = x['sum']; x['sum'] = [lead(x['sum'])]
def ntitle(t): return re.sub(r'[^a-zа-яё0-9]+', ' ', t.lower()).strip()[:80]
seen, seent, merged = set(), set(), []
for x in sorted(oldn + items, key=lambda x: (x['d'], 'id' in x), reverse=True):
    k, nt = key(x), ntitle(x.get('to') or x['t'])
    if k in seen or nt in seent: continue
    tagged = x.get('tags') or tags_of(x['t']) or tags_of(x.get('to', ''))
    if x['d'] < (ago(days=400) if tagged else ago(days=5)) or not keep(x): continue
    seen.add(k); seent.add(nt)
    x['id'] = x.get('id') or hashlib.md5(k.encode()).hexdigest()[:10]
    x['tags'] = sorted(set(tags_of(x['t'])) | set(tags_of(x.get('to', ''))) | set(x.get('ft', [])))
    merged.append(x)
merged = merged[:4000]

# ---------- перевод англоязычных заголовков (пакетами) ----------
todo = [x for x in merged if not x.get('tr') and not CYR.search(x['t']) and x.get('trt', 0) < 3 and x['d'] > ago(days=6)]
nb = 0
for i in range(0, len(todo), 30):
    part = todo[i:i + 30]
    try:
        res = tr('\n'.join(x['t'].replace('\n', ' ') for x in part)).split('\n')
        if len(res) != len(part): raise ValueError('mismatch %d/%d' % (len(res), len(part)))
        for x, t_ in zip(part, res):
            if t_.strip():
                x['to'] = x['t']; x['t'] = t_.strip(); x['tr'] = 1
                x['tags'] = sorted(set(x['tags']) | set(tags_of(x['t'])))
        nb += 1; time.sleep(0.3)
    except Exception as e:
        for x in part: x['trt'] = x.get('trt', 0) + 1
        print('translate titles', e, file=sys.stderr)
print('title batches', nb)

# ---------- склейка одинаковых сюжетов и важность ----------
STOP = set('это этот того также будет было были могут может после более через около однако который которые которая заявил заявила сообщил сообщила рассказал году года годах время новые новый россии россия российских российской '
           'that this with from have will after says said into over about their more than what when were been while amid could would shares stock stocks'.split())
SYN = [(r'\bЦОД\w*', 'дата-центр'), (r'\bБПЛА\b', 'беспилотник'), (r'\bдрон\w*', 'беспилотник'), (r'\bdata cent', 'датацентр'), (r'дата-центр', 'датацентр'),
       (r'«|»|"', ''), (r'\bСбер\b', 'Сбербанк')]
STOP3 = set('для что как при его она они там нет все уже еще ещё под над без the and for are was has not but its new вот это'.split())
def stem(w):
    if len(w) <= 4: return w
    return w[:4] if CYR.match(w) else w[:5]
def toks(t):
    for a_, b_ in SYN: t = re.sub(a_, b_, t, flags=re.I)
    return {stem(w) for w in re.findall(r'[a-zа-яё0-9]{3,}', t.lower()) if w not in STOP and w not in STOP3}
SRCW = {'Интерфакс': 3, 'РБК': 3, 'Ведомости': 3, 'Коммерсантъ': 3, 'ТАСС': 2, 'РИА Новости': 2, 'Банк России': 4, 'Reuters': 3, 'Bloomberg': 3,
        'Bloomberg.com': 3, 'CNBC': 2, 'WSJ': 3, 'The Wall Street Journal': 3, 'Financial Times': 3, 'MarketWatch': 2, 'ПРАЙМ': 1, 'Forbes': 2, 'Известия': 1,
        'The Economist': 2, 'BBC': 1, 'CoinDesk': 2, 'Cointelegraph': 1, 'ForkLog': 1, 'Frank Media': 2, 'Финам': 1, 'БКС Экспресс': 1}
BIG = {'SBER', 'GAZP', 'LKOH', 'ROSN', 'YDEX', 'NVTK', 'GMKN', 'VTBR', 'T', 'TATN', 'PLZL', 'MOEX', 'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BTC', 'ETH', '^GSPC', '^IXIC'}
HI = re.compile(r'атак|удар|дрон|БПЛА|взрыв|пожар|хакер|DDoS|сбо[йяи]|взлом|санкц|обвал|рухн|обруш|упал[аи]? на \d|вырос(?:ли|ла)? на \d|подскоч|рекорд|дивиденд|ключев[а-я]+ ставк|ставк[а-я]* (?:ЦБ|Банка России)|снизил[а-я]* ставк|повысил[а-я]* ставк|'
                r'дефолт|банкрот|арест|национализ|конфиск|IPO|SPO|отч[её]т|МСФО|прибыл|убыт|выручк|сделк|покупк[а-я]* (?:доли|актив|компан)|продаж[а-я]* (?:доли|актив|бизнес)|слияни|поглощ|выкуп|байбэк|делистинг|прогноз|ФРС|инфляц|Brent|Urals|курс (?:доллар|рубл|юан)|'
                r'hack|cyberattack|attack|outage|plunge|plummet|soar|surge|tumble|record|earnings|guidance|acqui|merger|takeover|lawsuit|antitrust|\bSEC\b|\bFed\b|rate cut|rate hike|tariff|sanction|bankrupt|layoff|recall|downgrade|upgrade|crash|rally|sell-?off', re.I)
LO = re.compile(r'Казахстан|Узбекистан|Киргиз|Таджикистан|Туркмен|Белорус|Армени|Азербайджан|Молдав|Грузи[яи]|област[иь]|кра[еяй] |район|губернатор|мэр|депутат|спорт|футбол|хоккей|погод|ДТП|сериал|фильм|концерт|звезд|рецепт|'
                r'гороскоп|ЖКХ|пенси[ия] по|мошенник|маркетплейс[а-я]* (?:запустил|начал)|акци[яи] (?:в магазин|скидок)|скидк|распродаж|самые (?:популярные|дорогие)|рейтинг|опрос|\bhow to\b|\bbest\b|\btips\b|should you|\bdeals?\b on|review:|podcast|opinion', re.I)
LO2 = re.compile(r'наркотик|убийств|изнасил|ДТП|приговор[а-я]* (?:к|за)|экс-глав[а-я]* филиал|сотрудник[а-я]* (?:задерж|осужд)|в колонию|отпуск|свадьб|умер|скончал|\bdies\b|obituary', re.I)
for x in merged:
    x['_tk'] = toks(x.get('to') or x['t']) | toks(x['t'])
    x.pop('dup', None); x['cl'] = 1
recent = sorted([x for x in merged if x['d'] > ago(days=4)], key=lambda x: x['d'])
import math
DF = {}
for x in recent:
    for t_ in x['_tk']: DF[t_] = DF.get(t_, 0) + 1
NR = max(1, len(recent))
def W(ts): return sum(math.log(NR / DF.get(t_, 1)) for t_ in ts)
for x in recent: x['_w'] = W(x['_tk'])
def sim(a_, b_):
    it_ = a_['_tk'] & b_['_tk']
    if len(it_) < 3: return 0
    return W(it_) / max(1e-9, min(a_['_w'], b_['_w']))
clusters = []
for x in recent:
    best, bs = None, 0
    for c in clusters[-400:]:
        if (datetime.datetime.fromisoformat(x['d'][:19]) - datetime.datetime.fromisoformat(c['d'][:19])).total_seconds() > 36 * 3600: continue
        for y in c['m'][:12]:
            sc = sim(x, y)
            if sc >= 0.55 and sc > bs: best, bs = c, sc
    if best: best['m'].append(x)
    else: clusters.append({'d': x['d'], 'tk': set(x['_tk']), 'm': [x]})
# второй проход: склеиваем крупные сюжеты, которые разошлись по разным кластерам (ранние «соцсети сообщают» + поздние подтверждения)
multi = [c for c in clusters if len(c['m']) >= 2]
for c in multi:
    c['u'] = set().union(*[y['_tk'] for y in c['m']])
for i_, a_ in enumerate(multi):
    if not a_['m']: continue
    for b_ in multi[i_ + 1:]:
        if not b_['m']: continue
        if abs((datetime.datetime.fromisoformat(a_['d'][:19]) - datetime.datetime.fromisoformat(b_['d'][:19])).total_seconds()) > 36 * 3600: continue
        if len(a_['u'] & b_['u']) < 3: continue
        if any(sim(p_, q_) >= 0.6 for p_ in a_['m'][:12] for q_ in b_['m'][:12]):
            a_['m'] += b_['m']; a_['u'] |= b_['u']; b_['m'] = []
clusters = [c for c in clusters if c['m']]
PAYWALL = {'WSJ', 'The Wall Street Journal', 'Bloomberg.com', 'Bloomberg', 'Financial Times', 'The Economist', 'New York Times', "Barron's", 'Reuters'}
def base_imp(x):
    t = (x['t'] + ' ' + x.get('to', ''))
    s_ = min(6, 2 * len(HI.findall(t))) + SRCW.get(x['s'], 0)
    if x.get('tags'): s_ += 2 + (2 if set(x['tags']) & BIG else 0)
    if x['cat'] == 'cbr': s_ += 3
    if LO.search(t) and not x.get('tags'): s_ -= 4
    if LO2.search(t): s_ -= 5
    if x['cat'] == 'us' and not HI.search(t): s_ -= 2   # ленты Yahoo по тикеру — много проходных материалов
    return s_
for c in clusters:
    m = c['m']
    srcs = {y['s'] for y in m}
    rep = max(m, key=lambda y: (SRCW.get(y['s'], 0) >= 2 or CYR.search(y['t']) and SRCW.get(y['s'], 0) >= 1, y['s'] not in PAYWALL, sum(len(q) for q in TEXT.get(y['id'], [])) > 900, SRCW.get(y['s'], 0) + (1 if CYR.search(y['t']) else 0), bool(y.get('tags')), -len(y['t'])))
    tags = sorted({t for y in m for t in y.get('tags', [])})
    imp = max(base_imp(y) for y in m) + 3 * min(len(srcs) - 1, 5)
    for y in m:
        y['imp'] = imp
        if y is not rep: y['dup'] = rep['id']
    rep['cl'] = len(srcs); rep['tags'] = tags
    rep['_m'] = [y for y in m if y is not rep]
    if len(m) > 1: rep['also'] = [[y['s'], None if 'news.google.com' in y['u'] else y['u'], y['id']] for y in m if y is not rep][:8]
    else: rep.pop('also', None)
for x in merged:
    if 'imp' not in x: x['imp'] = base_imp(x)
    x.pop('_tk', None); x.pop('_w', None)
print('clusters', len(clusters), 'multi-source', sum(1 for c in clusters if len({y['s'] for y in c['m']}) > 1))

# ---------- подробный пересказ: сначала важные и свежие ----------
cand = [x for x in merged if not x.get('dup') and x['d'] > ago(days=3) and not TEXT.get(x['id']) and x.get('sf', 0) < 2]
cand += [x for x in merged if not x.get('dup') and x['d'] > ago(days=2) and TEXT.get(x['id']) and x.get('sv', 0) < 3
         and sum(len(q) for q in TEXT[x['id']]) < 900 and x.get('sf', 0) < 2]
cand += [x for x in merged if not x.get('dup') and x['d'] > ago(days=2) and x.get('_m') and not x.get('mt') and TEXT.get(x['id'])
         and sum(len(q) for q in TEXT[x['id']]) < 900 and x not in cand]
cand.sort(key=lambda x: (x['imp'] >= 6, x['d'][:13], x['imp']), reverse=True)
def one(y):
    try:
        url = y['u']
        if 'news.google.com' in url:
            url = gn_decode(url); y['u'] = url
        return article(url, y.get('to') or y['t'], y.get('x', '')) or []
    except Exception as e:
        print('article', y['s'], str(e)[:80], file=sys.stderr); return []
def work(x):
    """Пересказ сюжета: берём самый подробный текст среди изданий, которые о нём написали (до 3 попыток)."""
    best = one(x)
    others = sorted(x.get('_m', []), key=lambda y: (y['s'] in PAYWALL, -SRCW.get(y['s'], 0)))
    for y in others[:3]:
        if sum(len(q) for q in best) >= 1500: break
        alt = one(y)
        if sum(len(q) for q in alt) > sum(len(q) for q in best): best = alt
    if best and not CYR.search(' '.join(best)[:400]):
        try: best = tr_list(best)
        except Exception as e: print('translate text', e, file=sys.stderr)
    return x, best
done = 0
with ThreadPoolExecutor(6) as ex:
    for x, paras in ex.map(work, cand[:300]):
        done += 1
        if x.get('_m'): x['mt'] = 1
        old = TEXT.get(x['id']) or []
        if paras and sum(len(q) for q in paras) > sum(len(q) for q in old):
            TEXT[x['id']] = paras; x['sum'] = [lead(paras)]; x['sv'] = 3
        else:
            x['sf'] = x.get('sf', 0) + 1
            if not x.get('sum') and x.get('x') and len(x['x']) > 40: x['sum'] = [x['x'][:300]]
print('articles', done, 'of', len(cand))
for x in merged:
    x.pop('_m', None)
    if not x.get('sum') and TEXT.get(x['id']): x['sum'] = [lead(TEXT[x['id']])]
    x.pop('x', None) if x.get('sum') else None

# ---------- чистка: проходные заметки живут недолго, служебные поля убираем ----------
def alive(x):
    if x.get('tags') or x['cat'] == 'cbr': return True
    imp = x.get('imp', 0)
    return x['d'] > (ago(days=5) if imp >= 8 else ago(days=2) if imp >= 4 else ago(hours=14))
merged = [x for x in merged if alive(x) and not x.get('dup')]   # повторы сюжета не храним — они в also у главной
keepids = {x['id'] for x in merged}
for x in merged:
    for k_ in ('st', 'st2', 'trt'): x.pop(k_, None)
    if x.get('g') and 'news.google.com' not in x['u']: x.pop('g', None)
    elif isinstance(x.get('g'), str): x['g'] = 1
    if x['d'] < ago(days=3): x.pop('sf', None); x.pop('sv', None)
    if x.get('sum') or x['d'] < ago(days=2): x.pop('x', None)
    elif x.get('x'): x['x'] = x['x'][:200]
    if x.get('to') and x.get('imp', 0) < 8 and not x.get('tags') and x['d'] < ago(days=1): x.pop('to', None)
    if x.get('also'): x['also'] = [a[:2] for a in x['also']]
# ---------- запись ----------
ids = {x['id'] for x in merged}
cut10, cut30 = ago(days=10), ago(days=30)
byid = {x['id']: x for x in merged}
TEXT = {k: (v if byid[k]['d'] > cut30 else v[:3]) for k, v in TEXT.items() if k in ids and (byid[k]['d'] > cut10 or byid[k].get('tags'))}
upd = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).strftime('%d.%m.%Y %H:%M МСК')
json.dump({'updated': upd, 'items': merged}, open('news.json', 'w'), ensure_ascii=False, separators=(',', ':'))
cut2 = ago(days=2)
json.dump({k: v for k, v in TEXT.items() if byid[k]['d'] > cut2}, open('news_text.json', 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump({k: v for k, v in TEXT.items() if byid[k]['d'] <= cut2}, open('news_text_arch.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('news', len(merged), 'texts', len(TEXT), 'important', sum(1 for x in merged if x['imp'] >= 6 and not x.get('dup') and x['d'] > ago(days=1)))
