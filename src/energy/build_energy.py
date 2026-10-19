#!/usr/bin/env python3
"""Собирает energy.html (карта нефти и газа) из routes.py + energy_template.html. Запуск из корня: python3 src/energy/build_energy.py"""
import hashlib, importlib.util, json, os, re
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
sp = importlib.util.spec_from_file_location('routes', os.path.join(HERE, 'routes.py')); m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m)
sp2 = importlib.util.spec_from_file_location('objects', os.path.join(HERE, 'objects.py')); ob = importlib.util.module_from_spec(sp2); sp2.loader.exec_module(ob)
for o in ob.O:
    assert -90 <= o['y'] <= 90 and -180 <= o['x'] <= 180 and o['t'] in ('ref','field','lng','port'), o['n']
for q in ob.QUIZ: assert 0 <= q['a'] < len(q['o'])
ids = [r['id'] for r in m.ROUTES]; assert len(ids) == len(set(ids)), 'повторы id'
for r in m.ROUTES:
    assert len(r['pts']) >= 2 and all(-180 <= x <= 180 and -90 <= y <= 90 for x, y in r['pts']), r['id']
    assert r['kind'] in ('oil', 'gas', 'lng') and r.get('v', 0) >= 0
sp3 = importlib.util.spec_from_file_location('countries', os.path.join(HERE, 'countries.py')); cs = importlib.util.module_from_spec(sp3); sp3.loader.exec_module(cs)
COUNTRIES, MISS, C_SRC, C_YEAR = cs.build(ob.O, ob.GAS_PRICES)
print('страны:', len(COUNTRIES), '| не сопоставлено:', MISS)
data = json.dumps({'countries': COUNTRIES, 'cSrc': C_SRC, 'cYear': C_YEAR, 'gasSrcNote': ob.GAS_SRC, 'routes': [{k: (list(map(list, v)) if k == 'pts' else v) for k, v in r.items()} for r in m.ROUTES],
                   'objects': ob.O, 'world': ob.WORLD, 'production': ob.PRODUCTION, 'gas': ob.GAS_PRICES, 'gasSrc': ob.GAS_SRC, 'regions': ob.REGIONS, 'records': ob.RECORDS, 'quiz': ob.QUIZ, 'companies': ob.COMPANIES, 'timeline': ob.TIMELINE, 'scen': ob.SCEN, 'wiki': ob.WIKI, 'deals': m.DEALS, 'dealsAsOf': m.DEALS_AS_OF, 'chokes': [{'n': c['n'], 'x': c['x'], 'y': c['y'], 't': c['t']} for c in m.CHOKES]}, ensure_ascii=False, separators=(',', ':'))
ft = open(os.path.join(ROOT, 'src', 'finance', 'finance_template.html'), encoding='utf-8').read().split('\n')
def span(a, b):
    i = next(k for k, s in enumerate(ft) if s.startswith(a)); j = next(k for k, s in enumerate(ft) if k >= i and s.startswith(b)); return '\n'.join(ft[i:j + 1])
css = '\n'.join([span(':root{', '::selection'), span('.top{position:sticky', '.ibtn:hover'), span('.chip{', '.chip:hover'), span('main{', 'main{')])
zoom = open(os.path.join(ROOT, 'src', 'finance', 'zoom.js'), encoding='utf-8').read()
html = open(os.path.join(HERE, 'energy_template.html'), encoding='utf-8').read()
html = html.replace('/*FINCSS*/', css).replace('<!--ZOOM-->', '<script>' + zoom + '</script>').replace('<!--DATA-->', '<script type="application/json" id="edata">' + data.replace('</', '<\\/') + '</script>')
gate = open(os.path.join(ROOT, 'src', 'finance', 'gate_artem.html'), encoding='utf-8').read().strip()
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + gate, 1)
open(os.path.join(ROOT, 'energy.html'), 'w', encoding='utf-8').write(html)
print('ok', len(m.ROUTES), 'маршрутов', len(html.encode()) // 1024, 'КБ')
