# Сводит food/src/*.json (таблицы КБЖУ сетей с официальных сайтов) в food/db.json для страницы «Калории».
import glob, json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
chains = []
for f in sorted(glob.glob(os.path.join(ROOT, 'food', 'src', '*.json'))):
    d = json.load(open(f, encoding='utf-8'))
    items = []
    for i in d.get('items', []):
        try:
            items.append({'n': i['name'], 'cat': i.get('cat', ''), 'g': i.get('grams'), 'k': float(i['kcal']), 'p': float(i['p']), 'f': float(i['f']), 'c': float(i['c'])})
        except Exception:
            continue
    if items:
        chains.append({'id': os.path.basename(f)[:-5], 'name': d['chain'], 'aliases': d.get('aliases', []), 'sources': d.get('sources', []), 'fetched': d.get('fetched', ''), 'items': items})
out = os.path.join(ROOT, 'food', 'db.json')
json.dump({'chains': chains}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('ok food/db.json:', ', '.join('%s %d' % (c['name'], len(c['items'])) for c in chains) or 'пусто')
