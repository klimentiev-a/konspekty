#!/usr/bin/env python3
"""Собирает tasks.js для тренажёра «Демо-КР по Python»: берёт tasks_a/b/c.py, прогоняет эталонные решения
на входных данных и сохраняет ожидаемые ответы. Эталон — единственный источник правды: ответ в тесте = вывод эталона."""
import io, os, sys, json, contextlib, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
VARS = [('A', 'tasks_a.py', 'Вариант А', 'Библиотека и банк'), ('B', 'tasks_b.py', 'Вариант Б', 'Школа и турагентство'),
        ('C', 'tasks_c.py', 'Вариант В', 'Транспорт и онлайн-магазин')]

def run(pre, code, lines):
    g = {}
    old_in, old_out = sys.stdin, sys.stdout
    sys.stdin = io.StringIO('\n'.join(lines) + '\n')
    buf = io.StringIO(); sys.stdout = buf
    try:
        if pre: exec(compile(pre, '<pre>', 'exec'), g)
        exec(compile(code, '<sol>', 'exec'), g)
    finally:
        sys.stdin, sys.stdout = old_in, old_out
    return buf.getvalue()

def norm(s):
    return '\n'.join(l.rstrip() for l in s.rstrip('\n').split('\n')) if s.strip() else ''

out, errs, total = [], [], 0
for vid, fn, vname, vsub in VARS:
    spec = importlib.util.spec_from_file_location(fn[:-3], os.path.join(HERE, fn)); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    tasks = []
    pts = 0
    for t in m.TASKS:
        tests = []
        for ins in t['inputs']:
            try: o = norm(run(t['pre'], t['sol'], ins))
            except Exception as e: errs.append('%s%d: %r на %r' % (vid, t['n'], e, ins)); o = ''
            tests.append({'i': '\n'.join(ins), 'o': o})
        empties = sum(1 for x in tests if not x['o'])
        outs = {x['o'] for x in tests}
        if len(outs) < 3: errs.append('%s%d: мало разных ответов (%d)' % (vid, t['n'], len(outs)))
        d = {'id': '%s%d' % (vid, t['n']), 'n': t['n'], 'pts': t['pts'], 'title': t['title'], 'topics': t['topics'], 'text': t['text'], 'fin': t['fin'], 'fout': t['fout'],
             'pre': t['pre'], 'tests': tests, 'sol': t['sol'].rstrip('\n'), 'hint': t['hint'], 'idea': t['idea'], 'steps': t['steps'], 'mist': t['mist'], 'trace': t.get('trace', '')}
        for k in ('hint', 'idea', 'steps', 'mist', 'text'):
            if not d[k]: errs.append('%s: пусто %s' % (d['id'], k))
        pts += t['pts']; tasks.append(d)
    if len(tasks) != 10: errs.append('%s: задач %d' % (vid, len(tasks)))
    if abs(pts - 10) > 1e-9: errs.append('%s: сумма баллов %s' % (vid, pts))
    out.append({'id': vid, 'name': vname, 'sub': vsub, 'tasks': tasks}); total += len(tasks)

if errs:
    print('\n'.join(errs)); sys.exit(1)
js = 'var PYD=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n'
open(os.path.join(HERE, 'tasks.js'), 'w', encoding='utf-8').write(js)
_r=lambda n: open(os.path.join(HERE,n),encoding='utf-8').read()
os.makedirs(os.path.join(os.path.dirname(os.path.dirname(HERE)),'pytrainer'),exist_ok=True)
_app="(function(){var st=document.getElementById('pyt-css');if(!st){st=document.createElement('style');st.id='pyt-css';st.textContent="+json.dumps(_r('trainer.css'),ensure_ascii=False)+";document.head.appendChild(st)}})();\n"+js+"\n"+_r('trainer.js')
open(os.path.join(os.path.dirname(os.path.dirname(HERE)),'pytrainer','app.js'),'w',encoding='utf-8').write(_app)
print('ok pytrainer: %d вариантов, %d задач, tasks.js %d байт' % (len(out), total, len(js.encode())))
if '-v' in sys.argv:
    for v in out:
        for t in v['tasks']:
            print('==', t['id'], t['title'])
            for x in t['tests']: print('  ', repr(x['i']), '=>', repr(x['o']))
