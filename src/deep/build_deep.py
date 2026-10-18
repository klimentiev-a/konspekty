#!/usr/bin/env python3
"""Собирает deep.html (игра «Глубина») и deep_freq.txt (частоты слов). Запуск из корня: python3 src/deep/build_deep.py
Глубина ответа считается механически по частоте слова в русских текстах (wordfreq, zipf)."""
import json, os, importlib.util
from wordfreq import zipf_frequency, top_n_list
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
sp = importlib.util.spec_from_file_location('prompts', os.path.join(HERE, 'prompts.py')); m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m)
def zf(w):
    w = w.lower().replace('ё', 'е')
    return max(zipf_frequency(w, 'ru'), zipf_frequency(w, 'en'))
out = []
for q, a in m.P:
    names = [x.split('=')[0] for x in a.split('|')]
    assert len(names) >= 20 and len(names) == len(set(names)), q
    items = []
    for ent in a.split('|'):
        keys = ent.split('=')
        z = max(zf(k) for k in keys)
        items.append([keys[0], keys, round(max(z, 1.0), 1)])
    out.append({'q': q, 'a': items})
data = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
html = open(os.path.join(HERE, 'deep_template.html'), encoding='utf-8').read().replace('/*DATA*/', data.replace('</', '<\\/'))
open(os.path.join(ROOT, 'deep.html'), 'w', encoding='utf-8').write(html)
seen = set(); lines = []
for w in top_n_list('ru', 60000):
    w = w.replace('ё', 'е')
    if w in seen or not w.replace('-', '').isalpha(): continue
    seen.add(w); lines.append('%s\t%d' % (w, round(zipf_frequency(w, 'ru') * 10)))
open(os.path.join(ROOT, 'deep_freq.txt'), 'w', encoding='utf-8').write('\n'.join(lines))
print('ok deep.html', len(m.P), 'вопросов; deep_freq.txt', len(lines), 'слов')
