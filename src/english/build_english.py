#!/usr/bin/env python3
"""Собирает english.html (курс английского A1→B1) из src/english/lessons/*.md, src/english/ref/*.md и шаблона.
Запуск из корня репозитория: python3 src/english/build_english.py [выходной файл]"""
import glob, hashlib, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from parse_lesson import parse_lesson, parse_ref, parse_items

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'english.html')
lessons, refs, bad = [], [], 0
for f in sorted(glob.glob(os.path.join(HERE, 'lessons', '[0-9]*.md'))):
    L, errs = parse_lesson(f)
    if errs:
        bad += 1; print('✗', os.path.basename(f)); [print('   -', e) for e in errs]
    else:
        lessons.append(L)
for f in sorted(glob.glob(os.path.join(HERE, 'ref', '[0-9]*.md'))):
    R, errs = parse_ref(f)
    if errs:
        bad += 1; print('✗', os.path.basename(f)); [print('   -', e) for e in errs]
    else:
        refs.append(R)
if bad:
    sys.exit('есть ошибки в файлах курса')
pl_src = open(os.path.join(HERE, 'placement.md'), encoding='utf-8').read().split('\n', 1)[1].strip().split('\n\n', 1)
pl_errs = []
pl_intro, pl_items = parse_items(pl_src[1], pl_errs, 'Входной тест')
if pl_errs or len(pl_items) != 30:
    sys.exit('входной тест: %s' % (pl_errs or len(pl_items)))
ns = [l['n'] for l in lessons]
assert ns == list(range(1, len(ns) + 1)), 'номера уроков должны идти подряд: %s' % ns
assert len({l['id'] for l in lessons}) == len(lessons), 'повторяются id уроков'

# общие стили берём из раздела «Финансы», чтобы оформление совпадало
ft = open(os.path.join(ROOT, 'src', 'finance', 'finance_template.html'), encoding='utf-8').read().split('\n')
def span(a, b):
    i = next(k for k, s in enumerate(ft) if s.startswith(a))
    j = next(k for k, s in enumerate(ft) if k >= i and s.startswith(b))
    return '\n'.join(ft[i:j + 1])
css = '\n'.join([span(':root{', '::selection'), span('.top{position:sticky', '.ibtn:hover'), span('.chip{', '.chip:hover'),
                 span('.prose{', '.prose tr:last-child'), span('.tablewrap', '.tablewrap'), span('.sw{display:flex', '.sw a.on::after'), span('main{', 'main{')])
tpl = open(os.path.join(HERE, 'english_template.html'), encoding='utf-8').read()
data = json.dumps({'lessons': lessons, 'refs': refs, 'placement': {'intro': pl_src[0].strip(), 'items': pl_items}}, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
zoom = open(os.path.join(ROOT, 'src', 'finance', 'zoom.js'), encoding='utf-8').read()
marked = open(os.path.join(ROOT, 'src', 'marked.min.js'), encoding='utf-8').read()
html = (tpl.replace('/*FINCSS*/', css).replace('<!--ZOOM-->', '<script>' + zoom + '</script><script>' + open(os.path.join(ROOT, 'src', 'finance', 'seltr.js'), encoding='utf-8').read() + '</script>')
           .replace('<!--DATA-->', '<script type="application/json" id="edata">' + data + '</script>')
           .replace('<!--MARKED-->', '<script>' + marked + '</script>'))

# замок: пускаем и Настю, и Артема
src = open(os.path.join(ROOT, 'src', 'finance', 'make_hub.py'), encoding='utf-8').read()
prof = dict(re.findall(r"'(\w+)': \('[^']+', '(\d+)'", src))
tok = {p: hashlib.sha256(('hub:%s:%s' % (p, pw)).encode()).hexdigest()[:24] for p, pw in prof.items()}
gate = ("<script>(function(){var T=%s;function ok(){for(var p in T){try{if(localStorage.getItem('hub:auth:'+p)===T[p]){localStorage.setItem('hub:last',p);return true}}catch(e){}"
        "if(document.cookie.indexOf('hub_'+p+'='+T[p])>=0){try{localStorage.setItem('hub:last',p)}catch(e){}return true}}return false}"
        "if(!ok()){document.documentElement.style.visibility='hidden';var l='nastya';"
        "var f=location.pathname.slice(location.pathname.lastIndexOf('/')+1)||'english.html';location.replace('index.html?login='+l+'&next='+encodeURIComponent(f+location.search+location.hash))}})();</script>"
        ) % json.dumps({k: tok[k] for k in ('nastya',)})
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + gate, 1)
open(out, 'w', encoding='utf-8').write(html)
words = sum(len(l['words']) for l in lessons)
print('ok', len(lessons), 'уроков', len(refs), 'справочников', words, 'слов', len(html.encode()) // 1024, 'КБ')
