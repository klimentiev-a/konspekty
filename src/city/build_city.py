#!/usr/bin/env python3
"""Собирает city.html (симулятор города) из src/city/city_template.html. Запуск из корня: python3 src/city/build_city.py"""
import os, re
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
ft = open(os.path.join(ROOT, 'src', 'finance', 'finance_template.html'), encoding='utf-8').read().split('\n')
def span(a, b):
    i = next(k for k, s in enumerate(ft) if s.startswith(a)); j = next(k for k, s in enumerate(ft) if k >= i and s.startswith(b)); return '\n'.join(ft[i:j + 1])
css = span(':root{', '::selection')
zoom = open(os.path.join(ROOT, 'src', 'finance', 'zoom.js'), encoding='utf-8').read()
html = open(os.path.join(HERE, 'city_template.html'), encoding='utf-8').read()
html = html.replace('/*FINCSS*/', css).replace('<!--ZOOM-->', '<script>' + zoom + '</script>')
gate = open(os.path.join(ROOT, 'src', 'finance', 'gate_artem.html'), encoding='utf-8').read().strip()
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + gate, 1)
open(os.path.join(ROOT, 'city.html'), 'w', encoding='utf-8').write(html)
print('ok city.html', len(html.encode()) // 1024, 'КБ')
