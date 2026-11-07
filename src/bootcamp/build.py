"""Собирает bootcamp.html (конспекты курса «Введение в ИИ»: только теория) из src/bootcamp/lessons/NN_slug.md и template.html.
Формат занятия:
  # Занятие N. Название
  short: одна строка о чём занятие
  date: 7 нояб
  далее обычный markdown (## разделы, ### подразделы, таблицы).
Запуск из корня репозитория: python3 src/bootcamp/build.py [выходной файл]"""
import glob, hashlib, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'bootcamp.html')

def parse(path):
    errs = []
    md = open(path, encoding='utf-8').read().replace('\r', '')
    m = re.match(r'^# Занятие (\d+)\. (.+)\n((?:[a-z]+: .*\n)+)', md)
    if not m:
        return None, ['нет заголовка «# Занятие N. Название» и строк short/date']
    meta = dict(re.findall(r'^([a-z]+): (.*)$', m.group(3), re.M))
    for k in ('short',):
        if k not in meta: errs.append('нет поля ' + k)
    body = md[m.end():].strip('\n')
    words = len(body.split())
    L = {'n': int(m.group(1)), 'title': m.group(2).strip(), 'short': meta.get('short', ''), 'date': meta.get('date', ''),
         'min': max(3, round(words / 180)), 'theory': body, 'text': re.sub(r'[#*`|>_-]+', ' ', body),
         'id': re.sub(r'^\d+_', '', os.path.splitext(os.path.basename(path))[0])}
    if words < 300: errs.append('текст короче 300 слов')
    return L, errs

lessons, bad = [], 0
for f in sorted(glob.glob(os.path.join(HERE, 'lessons', '[0-9]*.md'))):
    L, errs = parse(f)
    if errs:
        bad += 1; print('✗', os.path.basename(f)); [print('   -', e) for e in errs]
    else:
        lessons.append(L)
if bad: sys.exit('есть ошибки в файлах занятий')
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
data = json.dumps({'lessons': lessons}, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
zoom = open(os.path.join(ROOT, 'src', 'finance', 'zoom.js'), encoding='utf-8').read()
marked = open(os.path.join(ROOT, 'src', 'marked.min.js'), encoding='utf-8').read()
html = (tpl.replace('/*FINCSS*/', css).replace('<!--ZOOM-->', '<script>' + zoom + '</script><script>' + open(os.path.join(ROOT, 'src', 'finance', 'seltr.js'), encoding='utf-8').read() + '</script>')
           .replace('<!--DATA-->', '<script type="application/json" id="edata">' + data + '</script>')
           .replace('<!--MARKED-->', '<script>' + marked + '</script>'))

# замок: только Артем
src = open(os.path.join(ROOT, 'src', 'finance', 'make_hub.py'), encoding='utf-8').read()
prof = dict(re.findall(r"'(\w+)': \('[^']+', '(\d+)'", src))
tok = {p: hashlib.sha256(('hub:%s:%s' % (p, pw)).encode()).hexdigest()[:24] for p, pw in prof.items()}
gate = ("<script>(function(){var T=%s;function ok(){for(var p in T){try{if(localStorage.getItem('hub:auth:'+p)===T[p]){localStorage.setItem('hub:last',p);return true}}catch(e){}"
        "if(document.cookie.indexOf('hub_'+p+'='+T[p])>=0){try{localStorage.setItem('hub:last',p)}catch(e){}return true}}return false}"
        "if(!ok()){document.documentElement.style.visibility='hidden';var l='artem';"
        "var f=location.pathname.slice(location.pathname.lastIndexOf('/')+1)||'bootcamp.html';location.replace('index.html?login='+l+'&next='+encodeURIComponent(f+location.search+location.hash))}})();</script>"
        ) % json.dumps({k: tok[k] for k in ('artem',)})
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + gate, 1)
open(out, 'w', encoding='utf-8').write(html)
print('ok', len(lessons), 'занятий', sum(l['min'] for l in lessons), 'мин', len(html.encode()) // 1024, 'КБ')
