#!/usr/bin/env python3
"""Собирает игры: src/games/shell.html + engine.js + <игра>.js → game-<id>.html, и список games.html.
Запуск из корня репозитория: python3 src/games/build_games.py"""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'src', 'games')
rd = lambda p: open(p, encoding='utf-8').read()
shell = rd(os.path.join(D, 'shell.html'))
engine = rd(os.path.join(D, 'engine.js'))
gate = rd(os.path.join(ROOT, 'src', 'finance', 'gate_artem.html')).strip()
GAMES = [  # id, название, акцент, описание, эмодзи
    ('island', 'Остров-курорт', '#ffcf5a', 'Строй пляжи, отели и порт на 3D-острове, принимай туристов и расти от хижины до курорта мечты.', '🏝️'),
    ('station', 'Космическая станция', '#6fd3ff', 'Собирай модули на орбите, добывай руду с астероидов и расти от маленькой базы до колонии.', '🛰️'),
    ('rail', 'Железнодорожная империя', '#ff9b5e', 'Соединяй города рельсами, пускай поезда с грузами и пассажирами, зарабатывай на маршрутах.', '🚂'),
]
inject = lambda h: h.replace('<meta charset="utf-8">', '<meta charset="utf-8"><script src="sync.js"></script>', 1) if False else h
for gid, title, acc, desc, em in GAMES:
    p = os.path.join(D, gid + '.js')
    if not os.path.exists(p):
        print('нет', p); continue
    css = os.path.join(D, gid + '.css')
    h = shell.replace('/*TITLE*/', title).replace('/*ACC*/', acc).replace('<!--GATE-->', gate)
    h = h.replace('/*GAMECSS*/', rd(css) if os.path.exists(css) else '')
    h = h.replace('/*ENGINE*/', engine).replace('/*GAME*/', rd(p))
    open(os.path.join(ROOT, 'game-%s.html' % gid), 'w', encoding='utf-8').write(h)
    print('ok game-%s.html' % gid, len(h) // 1024, 'KB')

cards = ''.join('<a class="gc" href="game-%s.html" style="--c:%s"><div class="em">%s</div><b>%s</b><span>%s</span><i>Играть →</i></a>' % (i, a, e, t, d) for i, t, a, d, e in GAMES)
lst = rd(os.path.join(D, 'list.html')).replace('<!--GATE-->', gate).replace('<!--CARDS-->', cards)
open(os.path.join(ROOT, 'games.html'), 'w', encoding='utf-8').write(lst)
print('ok games.html')
