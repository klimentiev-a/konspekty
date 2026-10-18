#!/usr/bin/env python3
"""Собирает deep.html (игра «Глубина»). Запуск из корня: python3 src/deep/build_deep.py"""
import json, os, importlib.util
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
sp = importlib.util.spec_from_file_location('prompts', os.path.join(HERE, 'prompts.py')); m = importlib.util.module_from_spec(sp); sp.loader.exec_module(m)
for q, a in m.P:
    names = [x.split('=')[0] for x in a.split('|')]
    assert len(names) >= 20 and len(names) == len(set(names)), q
data = json.dumps([{'q': q, 'a': a} for q, a in m.P], ensure_ascii=False, separators=(',', ':'))
html = open(os.path.join(HERE, 'deep_template.html'), encoding='utf-8').read().replace('/*DATA*/', data.replace('</', '<\\/'))
open(os.path.join(ROOT, 'deep.html'), 'w', encoding='utf-8').write(html)
print('ok deep.html', len(m.P), 'вопросов')
