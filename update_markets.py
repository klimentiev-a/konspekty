#!/usr/bin/env python3
"""Снимок рынков → markets.json (запускается GitHub Action'ом).
Страница finance.html берёт живые данные прямо из браузера, а этот файл —
запасной вариант и единственный источник цен по США (у бесплатных американских
котировок нет доступа из браузера)."""
import json, urllib.request, urllib.parse, datetime, time, sys, os
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src', 'finance'))
import universe as UNI

UA = {'User-Agent': 'Mozilla/5.0 (konspekty markets snapshot)'}
RU = ['SBER','LKOH','ROSN','NVTK','SIBN','GAZP','GMKN','TATN','PLZL','YDEX','TRNFP','SNGS','T','VTBR','OZON','PHOR',
      'CHMF','X5','NLMK','RUAL','MOEX','MTSS','IRAO','MGNT','ALRS','HEAD','AFLT','POSI']
# весь мир: справочник src/finance/universe.py (≈330 бумаг) + индексы США/мира
WORLD = [w[0] for w in UNI.WORLD]
US = WORLD + ['^GSPC','^IXIC','^DJI','^STOXX50E','^FTSE','^GDAXI','^N225','^HSI','000001.SS','^BSESN','^KS11']

def get(url, t=20):
    r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=t)
    return json.loads(r.read().decode('utf-8'))

def iss(block):
    return {row[block['columns'].index('SECID')]: dict(zip(block['columns'], row)) for row in block['data']}

out = {'updated': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3))).strftime('%d.%m.%Y %H:%M МСК')}
old = {}
try: old = json.load(open('markets.json'))
except Exception: pass

try:
    # все акции режима TQBR (основной режим, ~250 бумаг): имя, уровень листинга, капитализация, оборот
    j = get('https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off'
            '&iss.only=securities,marketdata&securities.columns=SECID,PREVPRICE,SHORTNAME,SECNAME,LISTLEVEL'
            '&marketdata.columns=SECID,LAST,LCURRENTPRICE,LASTTOPREVPRICE,UPDATETIME,VALTODAY,ISSUECAPITALIZATION', 40)
    s, m = iss(j['securities']), iss(j['marketdata'])
    out['ru'] = {}
    for k, a in s.items():
        b = m.get(k, {}); p = b.get('LAST') or b.get('LCURRENTPRICE') or a.get('PREVPRICE')
        if not p: continue
        u = UNI.RU.get(k)
        row = {'p': p, 'ch': b.get('LASTTOPREVPRICE') if b.get('LAST') else ((p / a['PREVPRICE'] - 1) * 100 if a.get('PREVPRICE') else None), 'tm': b.get('UPDATETIME'),
               'n': (u[0] if u else (a.get('SHORTNAME') or k)), 'lvl': a.get('LISTLEVEL'), 'vol': b.get('VALTODAY') or 0}
        cap = b.get('ISSUECAPITALIZATION')
        if cap: row['cap'] = round(cap / 1e9, 1)   # млрд ₽
        out['ru'][k] = row
    if len(out['ru']) < 50: raise Exception('слишком мало бумаг: %d' % len(out['ru']))
except Exception as e:
    print('moex shares', e, file=sys.stderr); out['ru'] = old.get('ru')

try:
    j = get('https://iss.moex.com/iss/engines/stock/markets/index/securities.json?iss.meta=off&iss.only=marketdata'
            '&marketdata.columns=SECID,CURRENTVALUE,LASTCHANGEPRC,UPDATETIME&securities=IMOEX,RTSI,RGBI,MOEXOG,MOEXFN,MOEXMM,MOEXIT')
    out['idx'] = {k: {'v': v['CURRENTVALUE'], 'ch': v['LASTCHANGEPRC'], 'tm': v['UPDATETIME']} for k, v in iss(j['marketdata']).items()}
except Exception as e:
    print('moex idx', e, file=sys.stderr); out['idx'] = old.get('idx')

out['bonds'] = {}
for kind, board in (('ofz', 'TQOB'), ('corp', 'TQCB')):
    try:
        j = get('https://iss.moex.com/iss/engines/stock/markets/bonds/boards/' + board + '/securities.json?iss.meta=off&iss.only=securities,marketdata'
                '&securities.columns=SECID,SHORTNAME,MATDATE,OFFERDATE,COUPONPERCENT,COUPONPERIOD,PREVPRICE,FACEUNIT,FACEVALUE,YIELDATPREVWAPRICE,LISTLEVEL'
                '&marketdata.columns=SECID,LAST,YIELD,DURATION,VALTODAY,UPDATETIME', 40)
        s, m = iss(j['securities']), iss(j['marketdata'])
        a_ = []
        for k, x in s.items():
            if kind == 'ofz' and not k.startswith(('SU24', 'SU25', 'SU26')): continue
            y = m.get(k, {})
            a_.append({'id': k, 'n': x.get('SHORTNAME'), 'mat': x.get('MATDATE'), 'off': x.get('OFFERDATE'), 'c': x.get('COUPONPERCENT'), 'per': x.get('COUPONPERIOD'),
                       'p': y.get('LAST') or x.get('PREVPRICE'), 'y': y.get('YIELD') or x.get('YIELDATPREVWAPRICE'), 'd': (y.get('DURATION') or 0) / 365 or None,
                       'vol': y.get('VALTODAY') or 0, 'cur': x.get('FACEUNIT'), 'fv': x.get('FACEVALUE'), 'lvl': x.get('LISTLEVEL')})
        if kind == 'corp': a_ = sorted(a_, key=lambda z: z['vol'] or 0, reverse=True)[:600]
        out['bonds'][kind] = a_
    except Exception as e:
        print('bonds', kind, e, file=sys.stderr)
        out['bonds'][kind] = (old.get('bonds') or {}).get(kind)
try:
    j = get('https://iss.moex.com/iss/engines/stock/zcyc.json?iss.meta=off&iss.only=yearyields&yearyields.columns=tradedate,tradetime,period,value')
    last = {}
    for r in j['yearyields']['data']: last[r[2]] = r
    pts = [[p_, last[p_][3]] for p_ in sorted(last) if p_ >= 0.5]
    r0 = j['yearyields']['data'][-1]
    out['kbd'] = {'date': r0[0] + ' ' + str(r0[1] or '')[:5] + ' (снимок)', 'pts': pts}
except Exception as e:
    print('kbd', e, file=sys.stderr); out['kbd'] = old.get('kbd')

try:
    out['fx'] = get('https://www.cbr-xml-daily.ru/daily_json.js')
except Exception as e:
    print('cbr', e, file=sys.stderr); out['fx'] = old.get('fx')

try:
    a = get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=25&page=1&price_change_percentage=24h,7d')
    out['crypto'] = [{'s': x['symbol'].upper(), 'id': x['id'], 'n': x['name'], 'p': x['current_price'], 'c24': x.get('price_change_percentage_24h_in_currency'),
                      'c7': x.get('price_change_percentage_7d_in_currency'), 'cap': x.get('market_cap'), 'vol': x.get('total_volume')} for x in a]
except Exception as e:
    print('coingecko', e, file=sys.stderr); out['crypto'] = old.get('crypto')

def yq(t):
    """цена и дневное изменение одной бумаги (Yahoo chart, 5 дней)"""
    j = get('https://query1.finance.yahoo.com/v8/finance/chart/' + urllib.parse.quote(t) + '?range=5d&interval=1d', 15)
    r0 = j['chart']['result'][0]; meta = r0['meta']
    cl = [c for c in (r0['indicators']['quote'][0].get('close') or []) if c]
    p = meta.get('regularMarketPrice') or (cl[-1] if cl else None)
    pc = cl[-2] if len(cl) >= 2 else (meta.get('previousClose') or meta.get('chartPreviousClose'))
    row = {'p': p, 'ch': (p / pc - 1) * 100 if p and pc else None, 'cur': meta.get('currency')}
    if meta.get('currency') == 'GBp' and p: row['p'] = p / 100; row['cur'] = 'GBP'   # Лондон котирует в пенсах
    return row

def spark(batch):
    """пакетный запрос: до 40 бумаг за раз"""
    j = get('https://query1.finance.yahoo.com/v8/finance/spark?symbols=' + urllib.parse.quote(','.join(batch)) + '&range=5d&interval=1d', 25)
    res = {}
    for r in (j.get('spark') or {}).get('result') or []:
        try:
            x = r['response'][0]; meta = x['meta']
            cl = [c for c in (x['indicators']['quote'][0].get('close') or []) if c]
            p = meta.get('regularMarketPrice') or (cl[-1] if cl else None)
            pc = cl[-2] if len(cl) >= 2 else (meta.get('previousClose') or meta.get('chartPreviousClose'))
            row = {'p': p, 'ch': (p / pc - 1) * 100 if p and pc else None, 'cur': meta.get('currency')}
            if meta.get('currency') == 'GBp' and p: row['p'] = p / 100; row['cur'] = 'GBP'
            res[r['symbol']] = row
        except Exception: pass
    return res

t_us = time.time()
us = {}
# 1) пакетами через spark (быстро), 2) что не пришло — по одной в 6 потоков
for i in range(0, len(US), 40):
    try: us.update(spark(US[i:i + 40]))
    except Exception as e: print('spark', i, e, file=sys.stderr)
missing = [t for t in US if t not in us]
def one(t):
    try: return t, yq(t)
    except Exception as e: print('yahoo', t, e, file=sys.stderr); return t, None
with ThreadPoolExecutor(6) as ex:
    for t, row in ex.map(one, missing):
        if row: us[t] = row
# что не удалось сейчас — берём из прошлого снимка (чтобы таблица не пустела)
for t, row in (old.get('us') or {}).items():
    if t not in us and t in US: us[t] = row
print('yahoo: %d из %d за %d с (spark %d)' % (len(us), len(US), time.time() - t_us, len(US) - len(missing)), file=sys.stderr)
out['us'] = us or old.get('us') or {}

# нефть и газ (Yahoo, фьючерсы): Brent, WTI, Henry Hub, TTF + 30 дней закрытий для мини-графика
EN = [('BZ=F', 'Brent', '$/барр'), ('CL=F', 'WTI', '$/барр'), ('NG=F', 'Henry Hub', '$/млн BTU'), ('TTF=F', 'TTF (Европа)', '€/МВт·ч')]
energy = {}
for t, n, u in EN:
    try:
        j = get('https://query1.finance.yahoo.com/v8/finance/chart/' + urllib.parse.quote(t) + '?range=1mo&interval=1d')
        r0 = j['chart']['result'][0]
        cl = [round(c, 3) for c in (r0['indicators']['quote'][0].get('close') or []) if c]
        p = r0['meta'].get('regularMarketPrice') or (cl[-1] if cl else None)
        pc = cl[-2] if len(cl) >= 2 else (r0['meta'].get('previousClose') or r0['meta'].get('chartPreviousClose'))
        if p:
            energy[t] = {'n': n, 'u': u, 'p': p, 'ch': (p / pc - 1) * 100 if pc else None, 's': cl[-30:]}
    except Exception as e:
        print('yahoo energy', t, e, file=sys.stderr)
    time.sleep(0.4)
out['energy'] = energy or old.get('energy') or {}

json.dump(out, open('markets.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('ok', {k: (len(v) if hasattr(v, '__len__') else v) for k, v in out.items()})
