#!/usr/bin/env python3
"""История цен Мосбиржи (индексы и все акции TQBR из markets.json) → OUT/hist/ix-<ID>.json и ru-<TIC>.json.
Нужна как запасной источник для графиков Хаба: браузер у части пользователей не доверяет сертификату iss.moex.com.
Формат тот же, что у update_history.py: {"name","updated","d":[[день,цена]…] (1 год по дням),"w":[…] (5 лет по неделям)}; день = дни с 1970-01-01.
Запуск: python3 update_moex_hist.py hist  (папка с веткой data; к .changed прибавляет число обновлённых файлов)."""
import json, os, sys, time, datetime, ssl, urllib.request
from concurrent.futures import ThreadPoolExecutor
OUT = sys.argv[1] if len(sys.argv) > 1 else 'hist_out'
os.makedirs(os.path.join(OUT, 'hist'), exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (konspekty moex history)'}
ISS = 'https://iss.moex.com/iss/engines/stock/markets/'
FRESH = int(os.environ.get('MOEX_FRESH_H', '20')) * 3600
today = datetime.date.today()
# iss.moex.com отдаёт сертификат от российского корневого УЦ (Минцифры), которого нет в системных хранилищах (ни у браузеров, ни в GitHub Actions).
# Проверку НЕ отключаем: докладываем официальный корневой сертификат в список доверенных только для этого скрипта.
RU_CA_URLS = ['https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt', 'https://www.gosuslugi.ru/crt/rootca_ssl_rsa2022.cer']
def make_ctx():
    ctx = ssl.create_default_context()
    for u in RU_CA_URLS:
        try:
            raw = urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20).read()
            pem = raw.decode('ascii') if b'BEGIN CERTIFICATE' in raw else ssl.DER_cert_to_PEM_cert(raw)
            ctx.load_verify_locations(cadata=pem)
            print('корневой сертификат РФ подключён:', u, file=sys.stderr)
            return ctx
        except Exception as e:
            print('корневой сертификат', u, e, file=sys.stderr)
    return ctx
CTX = make_ctx()
def get(url, t=25):
    last = None
    for i in range(3):
        try:
            return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=t, context=CTX).read().decode('utf-8'))
        except ssl.SSLError as e:
            raise
        except Exception as e:
            if 'CERTIFICATE_VERIFY_FAILED' in str(e): raise
            last = e; time.sleep(1.5 * (i + 1))
    raise last
def fname(key): return os.path.join(OUT, 'hist', key + '.json')
def stamp(): return datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%MZ')
def age(key):
    try:
        u = json.load(open(fname(key))).get('updated', '')
        return (datetime.datetime.utcnow() - datetime.datetime.strptime(u, '%Y-%m-%dT%H:%MZ')).total_seconds()
    except Exception:
        return 1e12
def day(s): return (datetime.date.fromisoformat(s[:10]) - datetime.date(1970, 1, 1)).days
def candles(path, interval, days):
    frm = (today - datetime.timedelta(days=days)).isoformat()
    j = get(ISS + path + '/candles.json?iss.meta=off&interval=%d&from=%s&candles.columns=begin,close' % (interval, frm))
    out = []
    for b, c in j['candles']['data']:
        if c is not None: out.append([day(b), round(c, 6 if c < 1 else 2)])
    return out
def one(item):
    key, path, name = item
    if age(key) < FRESH: return 0
    try:
        d = candles(path, 24, 372); w = candles(path, 7, 1830)
        if len(d) < 2 and len(w) < 2: raise ValueError('пусто')
        json.dump({'name': name, 'cur': 'RUB', 'd': d, 'w': w, 'updated': stamp()}, open(fname(key), 'w'), separators=(',', ':'))
        return 1
    except Exception as e:
        print('moex', key, e, file=sys.stderr); return 0
m = json.load(open('markets.json'))
try:
    get(ISS + 'index/securities/IMOEX/candles.json?iss.meta=off&interval=24&from=' + (today - datetime.timedelta(days=5)).isoformat() + '&candles.columns=begin,close')
except Exception as e:
    print('Мосбиржа недоступна, пропускаем:', e, file=sys.stderr); sys.exit(0)
items = [('ix-' + k, 'index/securities/' + k, k) for k in m.get('idx', {})]
items += [('ru-' + t, 'shares/securities/' + t, (v or {}).get('n') or t) for t, v in m.get('ru', {}).items()]
with ThreadPoolExecutor(6) as ex:
    n = sum(ex.map(one, items))
print('moex history: обновлено %d из %d' % (n, len(items)), file=sys.stderr)
cf = os.path.join(OUT, '.changed')
try: prev = int(open(cf).read().strip() or 0)
except Exception: prev = 0
open(cf, 'w').write(str(prev + n))
