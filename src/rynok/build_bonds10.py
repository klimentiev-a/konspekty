#!/usr/bin/env python3
"""Собирает данные вкладки «Риск и доходность»: src/rynok/bonds10.json.
Берёт: историю индексов Мосбиржи (ветка bonds10-data, делает GitHub Actions: scripts/bonds10_fetch.py),
текущий рынок облигаций (ветка fin2-data: data/universe.json, rating_curves.json, ofz_curve.json).
Запуск: python3 src/rynok/build_bonds10.py <папка с индексами> <папка data из fin2-data>"""
import json, os, sys, statistics as st
from collections import defaultdict
IDX, F2 = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
old = json.load(open(os.path.join(HERE, 'bonds10.json'), encoding='utf-8'))
def load(c):
    d = json.load(open(os.path.join(IDX, c + '.json'), encoding='utf-8')); ci = d['cols'].index('CLOSE'); ti = d['cols'].index('TRADEDATE')
    return {r[ti]: r[ci] for r in d['rows'] if r[ci]}
def ann(c, y0=2016, y1=2025):
    s = load(c); ds = sorted(s)
    def at(y):
        k = [x for x in ds if x <= '%d-12-31' % y]; return s[k[-1]] if k else None
    return {y: round((at(y) / at(y - 1) - 1) * 100, 2) for y in range(y0, y1 + 1) if at(y) and at(y - 1)}
RGBITR = ann('RGBITR'); CORP_OLD = ann('RUCBITR'); CORP_NEW = ann('RUCBTRNS')
NEW = {k: ann('RUCBTR%sNS' % k) for k in ('AAA', 'AA', 'A', 'BBB')}
OLD = {k: ann('RUCBITR' + k) for k in ('BBB', 'BB', 'B')}   # BBB: рейтинг ≥ BBB-; BB: BB- … BBB-; B: B- … BB-
HY = ann('RUCBHYTR')
# ВДО 2021: индекс считается с 26 марта 2021
s = load('RUCBHYTR'); ds = sorted(s); k21 = [x for x in ds if x <= '2021-12-31']; HY21 = round((s[k21[-1]] / s[k21[0]] - 1) * 100, 2)
YR = list(range(2016, 2026))
ofy = {r['y']: r for r in old['years']}
def cell(v, src): return {'v': v, 's': src}
rows = []
def mk(key, lab, getter, note):
    cells = {}; real = 0
    for y in YR:
        v, s_ = getter(y); cells[y] = cell(v, s_); real += (s_ == 'r')
    vals = [cells[y]['v'] for y in YR]
    p = 1.0
    for v in vals: p *= 1 + v / 100
    rows.append({'k': key, 'lab': lab, 'y': {str(y): cells[y] for y in YR}, 'x': round(p, 3), 'cagr': round((p ** 0.1 - 1) * 100, 2),
                 'worst': min(vals), 'neg': sum(1 for v in vals if v < 0), 'real': real, 'note': note})
mk('OFZ', 'ОФЗ', lambda y: (RGBITR[y], 'r'), 'RGBITR, полная доходность ОФЗ')
for k in ('AAA', 'AA', 'A', 'BBB'):
    mk(k, k, lambda y, k=k: (NEW[k][y], 'r') if y >= 2019 else (OLD['BBB'][y], 'e'),
       'индекс Мосбиржи RUCBTR%sNS с 2019; до 2019 такого индекса нет — взят индекс всех бумаг с рейтингом не ниже BBB- (оценка)' % k)
mk('BB', 'BB', lambda y: (OLD['BB'][y], 'r') if y <= 2022 else (HY[y], 'e'),
   'индекс Мосбиржи RUCBITRBB (BB- … BBB-) до 2022; после него индекс закрыт — взят индекс ВДО RUCBHYTR (оценка)')
mk('B', 'B', lambda y: (OLD['B'][y], 'r') if y <= 2022 else (HY[y], 'e'),
   'индекс Мосбиржи RUCBITRB (B- … BB-) до 2022; после него индекс закрыт — взят индекс ВДО RUCBHYTR (оценка)')
mk('CORP', 'Все корпоративные', lambda y: (CORP_OLD[y], 'r') if y <= 2022 else (CORP_NEW[y], 'r'),
   'RUCBITR до 2022, RUCBTRNS (рейтинг не ниже A-) с 2023')
# --- текущий рынок
u = json.load(open(os.path.join(F2, 'universe.json'), encoding='utf-8')); C = u['cols']; R = [dict(zip(C, r)) for r in u['rows']]
rub = [r for r in R if r['currency'] in ('SUR', 'RUB') or r['faceunit'] in ('SUR', 'RUB')]
g = defaultdict(list)
for r in rub: g[r['rating_bucket'] or '—'].append(r)
rc = json.load(open(os.path.join(F2, 'rating_curves.json'), encoding='utf-8'))
oc = json.load(open(os.path.join(F2, 'ofz_curve.json'), encoding='utf-8'))
kbd = {t['period_years']: t['yield_pct'] for t in oc['kbd']['tenors']}
now = {}
for k in ('AAA', 'AA', 'A', 'BBB', 'BB', 'B'):
    v = g[k]; y2 = [p['ytm'] for p in rc[k]['curve'] if p['duration'] == 2][0]
    fx = [x['ytm'] for x in v if x['kind'] == 'fixed' and x['ytm'] and 0 < x['ytm'] < 80 and not x['noncomparable']]
    now[k] = {'n': len(v), 'iss': len({x['emitent_id'] or x['issuer'] for x in v}), 'y2': y2, 'ymed': round(st.median(fx), 2) if fx else None, 'nfix': len(fx)}
now['ofz2'] = kbd[2.0]
risk = {'total': len(R), 'rub': len(rub), 'iss': len({r['emitent_id'] or r['issuer'] for r in rub}), 'asof': u.get('updated_at', '')[:10],
        'unrated': len(g['—']), 'default_issues': len(g['D']) + len(g['CC']) + len(g['CCC'])}
old['fact'] = {'rows': rows, 'hy21': HY21}
old['now'] = now
old['ofzcurve'] = {str(int(k) if k == int(k) else k): v for k, v in kbd.items() if k in (1.0, 2.0, 3.0, 5.0, 10.0)}
old['mkt'] = risk
# вероятность дефолта эмитента за год по рейтингу (Эксперт РА, матрица 2001/02–2021/22; AAA — оценка НКР 0,12%, факт 0)
old['pdy'] = {'AAA': 0.12, 'AA': 0.25, 'A': 0.84, 'BBB': 1.90, 'BB': 3.47, 'B': 7.94}
old['pdy26'] = {'AAA': 0.12, 'AA': 0.25, 'A': 0.84, 'BBB': 1.57, 'BB': 4.27, 'B': 5.5}
SRC0 = [['Мосбиржа ISS: история индексов облигаций (RGBITR, RUCBITR, RUCBTRAAANS…RUCBTRBBBNS, RUCBITRBBB/BB/B, RUCBHYTR)', 'https://iss.moex.com/iss/engines/stock/markets/index/securities.json'],
        ['Мосбиржа: индексы корпоративных облигаций по рейтингам', 'https://www.moex.com/ru/index/RUCBTRNS'],
        ['Выпуски, доходности, рейтинги: «Облигации и акции» (fin2-data, снимок Мосбиржи и рейтинговых агентств)', 'fin2/index.html#screener']]
old['sources'] = SRC0 + [x for x in old['sources'] if x[1] not in {s[1] for s in SRC0}]
# годовой ряд для нижних блоков: реальные индексы вместо пересказа
old['years'] = [dict(y=y, ofz=RGBITR[y], corp=(CORP_OLD[y] if y <= 2022 else CORP_NEW[y]), vdo=(HY21 if y == 2021 else HY.get(y)), key=ofy[y]['key'], infl=ofy[y]['infl']) for y in YR]
def cum(vals):
    p = 1.0
    for v in vals: p *= 1 + v / 100
    return p
cm = {}
for name, (a, b) in {'10': (2016, 2025), '5': (2021, 2025), '3': (2023, 2025)}.items():
    n = b - a + 1; d = {}
    for kk in ('ofz', 'corp', 'vdo', 'key', 'infl'):
        v = [r[kk] for r in old['years'] if a <= r['y'] <= b]
        if any(x is None for x in v): continue
        pp_ = cum(v); d[kk] = {'x': round(pp_, 3), 'cagr': round((pp_ ** (1 / n) - 1) * 100, 2)}
    for kk in d: d[kk]['real'] = round(d[kk]['x'] / d['infl']['x'], 3)
    cm[name] = {'from': a, 'to': b, 'n': n, 'r': d}
old['cum'] = cm
json.dump(old, open(os.path.join(HERE, 'bonds10.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
for r in rows: print(r['k'], r['x'], r['cagr'], 'худший', r['worst'], 'минусов', r['neg'], 'реал.лет', r['real'])
print(now); print(risk)
