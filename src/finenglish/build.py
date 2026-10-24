#!/usr/bin/env python3
"""Собирает fin-english.html (финансы по-английски: теория по темам + слова, без заданий)
из src/finenglish/lessons/NN_slug.md и шаблона template.html.
Формат темы:
  # Topic N. Title
  short: одна строка по-русски
  level: B1 / B2 / C1
  unit: 1..4
  minutes: 8
  ## Theory      — markdown по-английски, русский перевод терминов в скобках при первом упоминании
  ## Words       — таблица | Term | Перевод | Example |
Запуск из корня репозитория: python3 src/finenglish/build.py [выходной файл]"""
import glob, hashlib, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'fin-english.html')

UNITS = {1: ('Statements and cash', 'Отчётность и денежные потоки'), 2: ('Valuation and modelling', 'Оценка и моделирование'),
         3: ('Markets and instruments', 'Рынки и инструменты'), 4: ('Deals, debt, macro, accounting', 'Сделки, долг, макро, учёт')}

def parse(path):
    errs = []
    md = open(path, encoding='utf-8').read().replace('\r', '')
    m = re.match(r'^# Topic (\d+)\. (.+)\n((?:[a-z]+: .*\n)+)', md)
    if not m:
        return None, ['нет заголовка «# Topic N. Title» и строк short/level/unit/minutes']
    meta = dict(re.findall(r'^([a-z]+): (.*)$', m.group(3), re.M))
    for k in ('short', 'level', 'unit', 'minutes'):
        if k not in meta: errs.append('нет поля ' + k)
    L = {'n': int(m.group(1)), 'title': m.group(2).strip(), 'short': meta.get('short', ''), 'level': meta.get('level', ''),
         'unit': int(meta.get('unit', '1') or 1), 'min': int(meta.get('minutes', '8') or 8),
         'id': re.sub(r'^\d+_', '', os.path.splitext(os.path.basename(path))[0])}
    rest = md[m.end():]
    secs = re.split(r'^## (Theory|Words)\s*$', rest, flags=re.M)
    S = {}
    for i in range(1, len(secs) - 1, 2): S[secs[i]] = secs[i + 1].strip('\n')
    if 'Theory' not in S: errs.append('нет раздела «## Theory»')
    if 'Words' not in S: errs.append('нет раздела «## Words»')
    if errs: return L, errs
    L['theory'] = S['Theory']
    if len(L['theory'].split()) < 400: errs.append('Theory короче 500 слов')
    words = []
    for ln in S['Words'].split('\n'):
        ln = ln.strip()
        if not ln.startswith('|') or re.match(r'^\|\s*-', ln) or re.match(r'^\|\s*Term', ln, re.I): continue
        c = [x.strip() for x in ln.strip('|').split('|')]
        if len(c) < 3: errs.append('Words: строка не из 3 колонок: ' + ln[:50]); continue
        words.append({'w': c[0], 't': c[1], 'x': c[2]})
    if len(words) < 10: errs.append('Words: меньше 10 слов')
    L['words'] = words
    if '|' in re.sub(r'\|', '', L['theory']): pass
    return L, errs

lessons, bad = [], 0
for f in sorted(glob.glob(os.path.join(HERE, 'lessons', '[0-9]*.md'))):
    L, errs = parse(f)
    if errs:
        bad += 1; print('✗', os.path.basename(f)); [print('   -', e) for e in errs]
    else:
        lessons.append(L)
if bad: sys.exit('есть ошибки в файлах тем')
ns = [l['n'] for l in lessons]
assert ns == list(range(1, len(ns) + 1)), 'номера тем должны идти подряд: %s' % ns
assert len({l['id'] for l in lessons}) == len(lessons), 'повторяются id тем'

# общие стили берём из раздела «Финансы», чтобы оформление совпадало
ft = open(os.path.join(ROOT, 'src', 'finance', 'finance_template.html'), encoding='utf-8').read().split('\n')
def span(a, b):
    i = next(k for k, s in enumerate(ft) if s.startswith(a))
    j = next(k for k, s in enumerate(ft) if k >= i and s.startswith(b))
    return '\n'.join(ft[i:j + 1])
css = '\n'.join([span(':root{', '::selection'), span('.top{position:sticky', '.ibtn:hover'), span('.chip{', '.chip:hover'),
                 span('.prose{', '.prose tr:last-child'), span('.tablewrap', '.tablewrap'), span('.sw{display:flex', '.sw a.on::after'), span('main{', 'main{')])
tpl = open(os.path.join(HERE, 'template.html'), encoding='utf-8').read()
data = json.dumps({'lessons': lessons, 'units': UNITS}, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
zoom = open(os.path.join(ROOT, 'src', 'finance', 'zoom.js'), encoding='utf-8').read()
marked = open(os.path.join(ROOT, 'src', 'marked.min.js'), encoding='utf-8').read()
html = (tpl.replace('/*FINCSS*/', css).replace('<!--ZOOM-->', '<script>' + zoom + '</script>')
           .replace('<!--DATA-->', '<script type="application/json" id="edata">' + data + '</script>')
           .replace('<!--MARKED-->', '<script>' + marked + '</script>'))

# замок: только Артем
src = open(os.path.join(ROOT, 'src', 'finance', 'make_hub.py'), encoding='utf-8').read()
prof = dict(re.findall(r"'(\w+)': \('[^']+', '(\d+)'", src))
tok = {p: hashlib.sha256(('hub:%s:%s' % (p, pw)).encode()).hexdigest()[:24] for p, pw in prof.items()}
gate = ("<script>(function(){var T=%s;function ok(){for(var p in T){try{if(localStorage.getItem('hub:auth:'+p)===T[p]){localStorage.setItem('hub:last',p);return true}}catch(e){}"
        "if(document.cookie.indexOf('hub_'+p+'='+T[p])>=0){try{localStorage.setItem('hub:last',p)}catch(e){}return true}}return false}"
        "if(!ok()){document.documentElement.style.visibility='hidden';var l='artem';"
        "var f=location.pathname.slice(location.pathname.lastIndexOf('/')+1)||'fin-english.html';location.replace('index.html?login='+l+'&next='+encodeURIComponent(f+location.search+location.hash))}})();</script>"
        ) % json.dumps({k: tok[k] for k in ('artem',)})
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + gate, 1)
open(out, 'w', encoding='utf-8').write(html)
words = sum(len(l['words']) for l in lessons)
print('ok', len(lessons), 'тем', words, 'слов', len(html.encode()) // 1024, 'КБ')
