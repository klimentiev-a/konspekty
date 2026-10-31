#!/usr/bin/env python3
"""Архив новостей по каждой компании / монете / индексу → OUT/hist/news-<ru|us|cr|ix>-<KEY>.json (ветка data).
Источник — поиск Google Новостей (RSS). На каждый день, когда цена сдвинулась на 1% и больше (крипта — 2%, индексы — 0,8%),
ищем новости за этот и предыдущий день, оставляем до 5 самых «рыночных» заголовков. Плюс каждые 3 часа — свежие новости за 2 дня.
За запуск делается ограниченное число запросов, поэтому архив за год набирается за несколько часов и дальше только дополняется.
У лучшей новости каждого такого дня расшифровываем ссылку, вытаскиваем суть статьи и переводим англоязычное."""
import json, os, re, sys, time, hashlib, datetime, urllib.request, urllib.parse, email.utils, html
import xml.etree.ElementTree as ET
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from newsutil import summarize, tr, tr_list, gn_decode, UA, CYR

OUT = sys.argv[1] if len(sys.argv) > 1 else 'hist_out'
H = os.path.join(OUT, 'hist'); os.makedirs(H, exist_ok=True)
NOW = datetime.datetime.now(datetime.timezone.utc)
TODAY = NOW.date()
GN_BUDGET, DEC_BUDGET, TR_BUDGET = 330, 180, 60   # запросов поиска / расшифровок+сутей / пакетов перевода за запуск

RU = {'SBER': 'Сбербанк', 'LKOH': 'ЛУКОЙЛ', 'ROSN': 'Роснефть', 'NVTK': 'НОВАТЭК', 'SIBN': '"Газпром нефть"', 'GAZP': 'Газпром',
      'GMKN': 'Норникель', 'TATN': 'Татнефть', 'PLZL': '"Полюс" золото', 'YDEX': 'Яндекс', 'TRNFP': 'Транснефть', 'SNGS': 'Сургутнефтегаз',
      'T': '"Т-Технологии" OR "Т-Банк"', 'VTBR': 'ВТБ', 'OZON': 'Ozon', 'PHOR': 'ФосАгро', 'CHMF': 'Северсталь', 'X5': '"X5" ритейлер OR "Корпоративный центр ИКС 5"',
      'NLMK': 'НЛМК', 'RUAL': 'Русал', 'MOEX': 'Мосбиржа акции', 'MTSS': 'МТС', 'IRAO': '"Интер РАО"', 'MGNT': '"Магнит" ритейлер OR "акции Магнита"',
      'ALRS': 'АЛРОСА', 'HEAD': 'HeadHunter OR Хэдхантер', 'AFLT': 'Аэрофлот', 'POSI': '"Positive Technologies" OR "Группа Позитив"'}
US = {'NVDA': 'Nvidia stock', 'AAPL': 'Apple stock', 'GOOGL': 'Alphabet stock', 'MSFT': 'Microsoft stock', 'AMZN': 'Amazon stock', 'META': 'Meta Platforms stock',
      'AVGO': 'Broadcom stock', 'TSLA': 'Tesla stock', 'BRK-B': 'Berkshire Hathaway', 'LLY': 'Eli Lilly stock', 'AMD': 'AMD stock', 'WMT': 'Walmart stock',
      'JPM': 'JPMorgan stock', 'V': 'Visa stock', 'XOM': 'Exxon Mobil stock', 'JNJ': 'Johnson & Johnson stock', 'MA': 'Mastercard stock', 'COST': 'Costco stock',
      'CVX': 'Chevron stock', 'ORCL': 'Oracle stock', 'KO': 'Coca-Cola stock', 'BAC': 'Bank of America stock', 'PG': 'Procter & Gamble stock',
      'UNH': 'UnitedHealth stock', 'NFLX': 'Netflix stock'}
IX = {'IMOEX': ('индекс Мосбиржи', 'ru'), 'RGBI': ('ОФЗ доходности', 'ru'), '^GSPC': ('S&P 500 stocks', 'en'), '^IXIC': ('Nasdaq stocks', 'en'), '^DJI': ('Dow Jones', 'en')}
CR = {'BTC': 'Bitcoin price', 'ETH': 'Ethereum price', 'SOL': 'Solana price', 'XRP': 'XRP price', 'BNB': 'BNB price', 'DOGE': 'Dogecoin price',
      'TON': 'Toncoin', 'ADA': 'Cardano price', 'TRX': 'TRON TRX price'}

IXQ2 = {'ix-IMOEX': ('рынок акций России на фоне переговоры OR санкции OR ставка OR нефть', 'ru'), 'ix-RGBI': ('ОФЗ на фоне ставка OR ЦБ OR инфляция', 'ru'),
        'ix-_GSPC': ('Wall Street stocks amid Fed OR tariffs OR Trump OR Ukraine', 'en'), 'ix-_IXIC': ('Nasdaq amid Fed OR tariffs OR AI', 'en'), 'ix-_DJI': ('Dow Jones amid Fed OR tariffs OR Trump', 'en')}
RU_EN = {'SBER': 'Sberbank', 'LKOH': 'Lukoil', 'ROSN': 'Rosneft', 'NVTK': 'Novatek', 'SIBN': 'Gazprom Neft', 'GAZP': 'Gazprom', 'GMKN': 'Nornickel OR "Norilsk Nickel"',
         'TATN': 'Tatneft', 'PLZL': 'Polyus gold', 'YDEX': 'Yandex', 'TRNFP': 'Transneft', 'SNGS': 'Surgutneftegas', 'T': '"T-Bank" OR "T-Technologies"', 'VTBR': 'VTB bank',
         'OZON': 'Ozon', 'PHOR': 'PhosAgro', 'CHMF': 'Severstal', 'X5': '"X5 Group"', 'NLMK': 'NLMK', 'RUAL': 'Rusal', 'MOEX': '"Moscow Exchange"', 'MTSS': 'MTS Russia',
         'IRAO': '"Inter RAO"', 'MGNT': 'Magnit retailer', 'ALRS': 'Alrosa', 'HEAD': 'HeadHunter Russia', 'AFLT': 'Aeroflot', 'POSI': '"Positive Technologies"', 'IMOEX': 'Russian stocks MOEX'}
ENT = []   # (файл, запрос, язык, порог, источник цен)
for k, q in RU.items(): ENT.append(('ru-' + k, q, 'ru', 0.01, ('iss', 'shares', k)))
for k, (q, l) in IX.items(): ENT.append(('ix-' + k.replace('^', '_'), q, l, 0.008, ('iss', 'index', k) if l == 'ru' else ('hist', 'us-' + k.replace('^', '_'))))
for k, q in US.items(): ENT.append(('us-' + k, q, 'en', 0.01, ('hist', 'us-' + k)))
for k, q in CR.items(): ENT.append(('cr-' + k, q, 'en', 0.02, ('hist', 'cr-' + k)))

def get(url, t=20, data=None):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA, data=data), timeout=t).read()
def iso(d): return d.strftime('%Y-%m-%d')

def series(src):
    """[(дата 'YYYY-MM-DD', цена)] за ~год по дням."""
    if src[0] == 'iss':
        url = ('https://iss.moex.com/iss/engines/stock/markets/%s/securities/%s/candles.json?iss.meta=off&interval=24&from=%s&candles.columns=begin,close'
               % (src[1], src[2], iso(TODAY - datetime.timedelta(days=1830))))
        rows, start = [], 0
        while True:
            j = json.loads(get(url + '&start=%d' % start))
            d = j['candles']['data']; rows += d
            if len(d) < 500: break
            start += len(d)
        return [(r[0][:10], r[1]) for r in rows if r[1]]
    try:
        j = json.load(open(os.path.join(H, src[1] + '.json')))
        return [(iso(datetime.date(1970, 1, 1) + datetime.timedelta(days=a)), b) for a, b in j.get('d', [])]
    except Exception:
        return []

KEYW = re.compile(r'акци|дивиденд|прибыл|выручк|отч[её]т|МСФО|РСБУ|санкц|упал|рост|вырос|подешев|подорож|рекоменд|совет директоров|байбэк|выкуп|SPO|IPO|прогноз|снизил|повысил|рекорд|обвал|ралли|котировк|капитализац|'
                  r'shares|stock|fell|falls|rose|rises|drop|jump|slide|slump|surge|soar|plunge|tumble|rall|earnings|revenue|guidance|downgrade|upgrade|price target|sell-?off|record|outlook|forecast|lawsuit|deal|acquir|ETF|liquidat|SEC\b', re.I)
NOISE = re.compile(r'\b(?:\d+ (?:best|top)|should you buy|is it time to|motley fool|prediction:|here.s why|zacks rank)\b', re.I)
DRIVER = [(re.compile(r'переговор|перемири|мирн\w* (?:план|процесс|соглаш|договор|урегулир)|урегулир|\bСВО\b|ceasefire|peace|truce', re.I), 7),
          (re.compile(r'Украин|Трамп|Путин|Зеленск|Песков|саммит|Уиткофф|Ukraine|Trump|Putin|Witkoff', re.I), 3),
          (re.compile(r'санкц|пошлин|тариф|sanction|tariff', re.I), 4),
          (re.compile(r'ключев\w* ставк|ставк\w* ЦБ|Банк\w* России|\bФРС\b|\bFed\b|rate (?:cut|hike)|инфляц|inflation', re.I), 4),
          (re.compile(r'нефт|Brent|ОПЕК|OPEC|\boil\b', re.I), 3), (re.compile(r'рубл|юан|ruble', re.I), 2)]
CAUSAL = re.compile(r'на фоне|из-за|после того|благодаря|в ожидании|ожидани|надежд|опасени|amid|on hopes|on fears|hopes|fears', re.I)
GENERIC = re.compile(r'итоги торгов|закрылся|закрыл|закрытие торгов|торги на Мосбирже|обзор рынка|прибавил|потерял|\bвырос|\bупал|снизился|рынок акций РФ|stocks (?:close|end)|Wall Street (?:closes|ends)', re.I)
def junk(t): return len(t) < 28 or t.endswith('..') or re.match(r'Москва\.\s*\d', t) is not None
def score(t, ix=False):
    sc = len(KEYW.findall(t)) * 2 - (3 if NOISE.search(t) else 0) - (9 if junk(t) else 0)
    if ix:   # для индексов важна ПРИЧИНА движения, а не пересказ «индекс вырос на 1%»
        sc += sum(w for r, w in DRIVER if r.search(t)) + (3 if CAUSAL.search(t) else 0) - (4 if GENERIC.search(t) else 0)
    return sc

STOP = {'gn': False}
def gsearch(q, lang):
    if STOP['gn']: return []
    hl = 'hl=ru&gl=RU&ceid=RU:ru' if lang == 'ru' else 'hl=en-US&gl=US&ceid=US:en'
    try:
        raw = get('https://news.google.com/rss/search?q=' + urllib.parse.quote(q) + '&' + hl)
    except urllib.error.HTTPError as e:
        if e.code in (429, 503, 403): STOP['gn'] = True
        print('gn', e.code, q, file=sys.stderr); return []
    except Exception as e:
        print('gn', e, q, file=sys.stderr); return []
    out = []
    for it in ET.fromstring(raw).iter('item'):
        t = html.unescape(it.findtext('title') or '').strip()
        src = (it.findtext('source') or '').strip()
        if src and t.endswith(' - ' + src): t = t[:-len(src) - 3].strip()
        try: d = email.utils.parsedate_to_datetime(it.findtext('pubDate')).astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        except Exception: continue
        u = (it.findtext('link') or '').strip()
        if t and u: out.append({'t': t, 's': src or 'Google Новости', 'd': d, 'g': u})
    time.sleep(0.8)
    return out

def toks(t):
    t = re.sub(r'(?i)\bЦОД\w*', 'дата центр', t); t = re.sub(r'(?i)БПЛА|дрон\w*', 'беспилотник', t)
    return {(w[:4] if re.match('[а-яё]', w) else w[:5]) for w in re.findall(r'[a-zа-яё0-9]{4,}', t.lower())}
def norm(t): return re.sub(r'\W+', ' ', t.lower()).strip()[:70]
def merge(db, found, ix=False):
    have = {norm(x.get('to') or x['t']) for x in db['items']}
    n = 0
    for x in found:
        k = norm(x['t'])
        if k in have: continue
        have.add(k); x['id'] = hashlib.md5(x['g'].encode()).hexdigest()[:10]; db['items'].append(x); n += 1
    # не больше 5 лучших на день, храним ~5 лет
    cut = iso(TODAY - datetime.timedelta(days=1840))
    byday = {}
    for x in db['items']:
        if x['d'][:10] >= cut: byday.setdefault(x['d'][:10], []).append(x)
    keep = []
    for day, a in byday.items():
        a.sort(key=lambda x: (bool(x.get('sum')), score(x.get('to') or x['t'], ix)), reverse=True)
        pick = []   # до 5 разных сюжетов за день: почти одинаковые заголовки не дублируем
        for x in a:
            tk = toks(x.get('to') or x['t'])
            if any(len(tk & p_) >= 3 and len(tk & p_) / max(1, min(len(tk), len(p_))) >= 0.6 for _, p_ in pick): continue
            pick.append((x, tk))
            if len(pick) >= 5: break
        keep += [x for x, _ in pick]
    db['items'] = sorted(keep, key=lambda x: x['d'], reverse=True)
    return n

dbs, moves, changed = {}, [], set()
for f, q, lang, thr, src in ENT:
    p = os.path.join(H, 'news-' + f + '.json')
    try: db = json.load(open(p))
    except Exception: db = {'items': [], 'qd': {}, 'rq': ''}
    if f.startswith('ix-') and db.get('v') != 2: db['qd'] = {}; db['v'] = 2; changed.add(f)   # новая логика «причин»: перезапрашиваем дни индексов, новые дни — первыми
    dbs[f] = db
    try: ser = series(src)
    except Exception as e: print('series', f, e, file=sys.stderr); ser = []
    for i in range(1, len(ser)):
        r = ser[i][1] / ser[i - 1][1] - 1
        old = ser[i][0] < iso(TODAY - datetime.timedelta(days=372))   # глубже года берём только сильные движения (3x порога), иначе запросов слишком много
        if abs(r) >= (thr * 3 if old else thr) and ser[i][0] not in db['qd'] and ser[i][0] < iso(TODAY - datetime.timedelta(days=1)):
            moves.append((ser[i][0], abs(r), f, q, lang))

used = 0
# 1) свежие новости (раз в 3 часа на каждую бумагу)
for f, q, lang, thr, src in ENT:
    db = dbs[f]
    if used >= GN_BUDGET or STOP['gn']: break
    if db.get('rq') and (NOW - datetime.datetime.strptime(db['rq'], '%Y-%m-%dT%H:%MZ').replace(tzinfo=datetime.timezone.utc)).total_seconds() < 3 * 3600: continue
    found = gsearch(q + ' when:2d', lang); used += 1
    if found or not STOP['gn']:
        merge(db, found, f.startswith('ix-')); db['rq'] = NOW.strftime('%Y-%m-%dT%H:%MZ'); changed.add(f)
# 2) дни с заметным движением цены — от новых к старым
moves.sort(key=lambda m: (m[0], m[1]), reverse=True)
for day, ar, f, q, lang in moves:
    if used >= GN_BUDGET or STOP['gn']: break
    d = datetime.date.fromisoformat(day)
    found = gsearch('%s after:%s before:%s' % (q, iso(d - datetime.timedelta(days=2)), iso(d + datetime.timedelta(days=2))), lang); used += 1
    if STOP['gn']: break
    if f.startswith('ix-') and f in IXQ2 and not STOP['gn'] and used < GN_BUDGET:   # отдельный запрос про причины: переговоры, санкции, ставка, нефть
        found += gsearch('%s after:%s before:%s' % (IXQ2[f][0], iso(d - datetime.timedelta(days=2)), iso(d + datetime.timedelta(days=2))), IXQ2[f][1]); used += 1
    nxt = iso(d + datetime.timedelta(days=1))
    found = [x for x in found if iso(d - datetime.timedelta(days=1)) <= x['d'][:10] <= day or (x['d'][:10] == nxt and x['d'][11:13] < '06')]
    kk = f.split('-', 1)[1]
    if not found and kk in RU_EN and used < GN_BUDGET:   # по-русски ничего — пробуем международную прессу
        alt = gsearch('%s after:%s before:%s' % (RU_EN[kk], iso(d - datetime.timedelta(days=2)), iso(d + datetime.timedelta(days=2))), 'en'); used += 1
        found = [x for x in alt if iso(d - datetime.timedelta(days=1)) <= x['d'][:10] <= day or (x['d'][:10] == nxt and x['d'][11:13] < '06')]
    merge(dbs[f], found, f.startswith('ix-')); dbs[f]['qd'][day] = len(found); changed.add(f)
print('google news queries', used, 'moves left', max(0, len(moves) - used), 'stopped' if STOP['gn'] else '')

# 3) перевод англоязычных заголовков (пакетами)
nb = 0
for f, db in dbs.items():
    todo = [x for x in db['items'] if not x.get('tr') and not CYR.search(x['t'])]
    for i in range(0, len(todo), 25):
        if nb >= TR_BUDGET: break
        part = todo[i:i + 25]
        try:
            res = tr('\n'.join(x['t'].replace('\n', ' ') for x in part)).split('\n')
            if len(res) == len(part):
                for x, t_ in zip(part, res):
                    if t_.strip(): x['to'] = x['t']; x['t'] = t_.strip(); x['tr'] = 1
                changed.add(f)
            nb += 1; time.sleep(0.3)
        except Exception as e:
            print('translate', e, file=sys.stderr); nb = TR_BUDGET
print('translate batches', nb)

# 4) пересказ главной новости каждого дня (сначала свежие); если у главной не вышло — берём следующую по важности
LOWSRC = {'The Motley Fool', 'Motley Fool', 'Zacks', 'Zacks Investment Research', 'InvestorPlace', 'Simply Wall St', 'Simply Wall Street', 'MarketBeat', 'Benzinga', 'Stocktwits'}
def rank(x, ix=False): return score(x.get('to') or x['t'], ix) - (3 if x.get('s') in LOWSRC else 0)
cand = []
for f, db in dbs.items():
    byday = {}
    for x in db['items']: byday.setdefault(x['d'][:10], []).append(x)
    for day, a in byday.items():
        if any(x.get('sum') for x in a): continue
        a = [x for x in a if x.get('sf', 0) < 2]
        if a: cand.append((day, f, max(a, key=lambda x: rank(x, f.startswith('ix-')))))
cand.sort(key=lambda c: c[0], reverse=True)
cand = cand[:DEC_BUDGET]
from concurrent.futures import ThreadPoolExecutor
def work(c):
    day, f, x = c
    try:
        if 'u' not in x: x['u'] = gn_decode(x['g'])
        s_ = summarize(x['u'], x.get('to') or x['t'], '')
        if s_ and not CYR.search(' '.join(s_)[:400]):
            try: s_ = tr_list(s_)
            except Exception: pass
        if s_: x['sum'] = s_[:7]
        else: x['sf'] = x.get('sf', 0) + 1
    except Exception as e:
        x['sf'] = x.get('sf', 0) + 1
        print('decode', f, str(e)[:80], file=sys.stderr)
    return f
with ThreadPoolExecutor(6) as ex:
    for f in ex.map(work, cand): changed.add(f)
nd = len(cand)
print('summaries', nd)

for f in changed:
    db = dbs[f]
    json.dump(db, open(os.path.join(H, 'news-' + f + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
try: prev = int(open(os.path.join(OUT, '.changed')).read() or 0)
except Exception: prev = 0
open(os.path.join(OUT, '.changed'), 'w').write(str(prev + len(changed)))
print('entity news files updated', len(changed))
