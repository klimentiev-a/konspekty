#!/usr/bin/env python3
"""История индексов облигаций Мосбиржи (ISS, без ключа) -> bonds10-data/<код>.json.
Запускается в GitHub Actions (из песочницы Мосбиржа недоступна). Для вкладки «Риск и доходность»."""
import json, os, sys, time, urllib.request, urllib.parse
OUT = sys.argv[1] if len(sys.argv) > 1 else 'bonds10-data'
os.makedirs(OUT, exist_ok=True)
CODES = ['RGBITR', 'RGBI', 'RGBEY', 'RUCBITR', 'MICEXCBITR', 'RUCBTRNS', 'RUCBTRAAANS', 'RUCBTRAANS', 'RUCBTRANS', 'RUCBTRBBBNS',
         'RUCBTRB2B3B', 'RUCBHYTR', 'RUCBITRBBB', 'RUCBITRBB', 'RUCBITRB', 'RUCBICP', 'RUCBTR3YNS', 'RUCBTR5YNS', 'RUCBITR1Y',
         'RUCBTRAAA', 'RUCBTRAA', 'RUCBTRA', 'RUCBTRBBB', 'RUCBTRBB', 'RUCBTRB']
def get(url, tries=2):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'hub-bonds10'}), timeout=25) as r:
                return json.load(r)
        except Exception as e:
            err = e; time.sleep(2)
    raise err
# какие индексы вообще есть (для лога и поиска кодов)
found = {}
for q in ('RUCB', 'RGBI', 'MICEXCB', 'RUMB', 'RUFL'):
    try:
        j = get('https://iss.moex.com/iss/engines/stock/markets/index/securities.json?iss.meta=off&q=' + q + '&securities.columns=SECID,SHORTNAME,NAME')
        for r in j['securities']['data']: found[r[0]] = r[2]
    except Exception as e:
        print('поиск', q, e)
json.dump(found, open(os.path.join(OUT, '_list.json'), 'w'), ensure_ascii=False, indent=0)
print('индексов найдено', len(found))
summary = {}
todo = ['RUCBTRAAANS', 'RUCBTRAANS', 'RUCBTRANS', 'RUCBTRBBBNS', 'RUCBTRNS', 'RUCBHYTR', 'RUCBITRBBB', 'RUCBITRBB', 'RUCBITRB', 'RUCBTRB2B3B', 'RUCBITR1Y', 'RUCBKEYTR', 'RUCBRNTR']
T0 = time.time()
for code in todo:
    if time.time() - T0 > 900: print('лимит времени'); break
    rows, cols, start = [], None, 0
    urls = ['https://iss.moex.com/iss/history/engines/stock/markets/index/securities/%s.json' % code,
            'https://iss.moex.com/iss/history/engines/stock/markets/index/boards/SNDX/securities/%s.json' % code]
    for base in urls:
        rows, cols, start = [], None, 0
        try:
            while True:
                j = get(base + '?iss.meta=off&from=2010-01-01&start=%d' % start)
                h = j['history']; cols = h['columns']; d = h['data']
                if not d: break
                rows += d; start += len(d)
                if len(d) < 100: break
        except Exception as e:
            print(code, 'ошибка', e)
        if rows: break
    if rows:
        json.dump({'code': code, 'cols': cols, 'rows': rows}, open(os.path.join(OUT, code + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    summary[code] = (rows[0][cols.index('TRADEDATE')], rows[-1][cols.index('TRADEDATE')], len(rows)) if rows else None
    print(code, summary[code])
    if not rows:
        try:
            print('  бумага:', json.dumps(get('https://iss.moex.com/iss/securities/%s.json?iss.meta=off&iss.only=boards' % code).get('boards', {}).get('data'), ensure_ascii=False)[:300])
        except Exception as e:
            print('  бумага: ошибка', e)
json.dump(summary, open(os.path.join(OUT, '_summary.json'), 'w'), ensure_ascii=False)
