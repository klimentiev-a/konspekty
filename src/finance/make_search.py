#!/usr/bin/env python3
"""Собирает search-index.json — индекс для страницы «Поиск» (главы, сектора, термины, компании, билеты, конспекты).
Формат: список [вид, заголовок, текст, ссылка]. Запуск: python3 src/finance/make_search.py (из корня репозитория)."""
import os, re, json, ast, sys, glob
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import static_data as S, terms as T

def clean(md, n):
    t = re.sub(r'```.*?```', ' ', md, flags=re.S)
    t = re.sub(r'<[^>]+>', ' ', t); t = re.sub(r'!?\[([^\]]*)\]\([^)]*\)', r'\1', t)
    t = re.sub(r'[*_`>#|]+', ' ', t); t = re.sub(r'\s+', ' ', t).strip()
    return t[:n]

def sections(md, n=600):
    """Разделы по заголовкам ##/###: [(заголовок или '', текст)]. Первый — вводный (без заголовка)."""
    out = []; cur = ['', []]; code = False
    for l in md.split('\n'):
        if l.startswith('```'): code = not code
        m = None if code else re.match(r'^#{2,3}\s+(.*)', l)
        if m:
            out.append(cur); cur = [re.sub(r'[*`]', '', m.group(1)).strip(), []]; continue
        cur[1].append(l)
    out.append(cur)
    return [(h, clean('\n'.join(t), n)) for h, t in out if clean('\n'.join(t), 60)]

src = open(os.path.join(HERE, 'build_finance.py'), encoding='utf-8').read()
IDS = ast.literal_eval(re.search(r'IDS = (\{.*?\})\n', src, re.S).group(1))
out = []
for f in sorted(glob.glob(os.path.join(HERE, 'content', '*.md'))):
    name = os.path.basename(f); b = name.split('_')[0]
    t = open(f, encoding='utf-8').read().strip().split('\n')
    title = t[0].lstrip('# ').strip(); short = t[1][6:].strip() if len(t) > 1 and t[1].startswith('short:') else ''
    fid = IDS.get(b) or re.sub(r'^\d+_', '', os.path.splitext(name)[0])
    secs = sections('\n'.join(t[2:]))
    for h, x in secs:
        out.append(['ch', title, (short + '. ' + x).strip() if not h else x, 'finance.html#learn/' + fid, h])
for f in sorted(glob.glob(os.path.join(HERE, 'sectors', '*.md'))):
    t = open(f, encoding='utf-8').read().strip().split('\n')
    title = t[0].lstrip('# ').strip(); short = t[1][6:].strip() if len(t) > 1 and t[1].startswith('short:') else ''
    sid = re.sub(r'^\d+_', '', os.path.splitext(os.path.basename(f))[0])
    for h, x in sections('\n'.join(t[2:])):
        out.append(['sec', title, (short + '. ' + x).strip() if not h else x, 'finance.html#learn/sektor/' + sid, h])
def _thead(t): return re.split(r'\s+[—(]', t)[0].strip()
for tt in T.RICH:
    out.append(['term', tt[1], tt[2], 'finance.html#learn/glossariy/' + _thead(tt[1])])
for tt in T.EXTRA:
    out.append(['term', tt[1], tt[2], 'finance.html#learn/glossariy/' + _thead(tt[1])])
for x in S.RU: out.append(['co', x[1] + ' · ' + x[0], x[2] + ' · акции Мосбиржи', 'finance.html#markets/ru/' + x[0]])
for x in S.US: out.append(['co', x[1] + ' · ' + x[0], x[2] + ' · акции США', 'finance.html#markets/us/' + x[0]])
# компании мира из справочника сайта (карточка с графиком и новостями)
import universe as UNI
for w in UNI.WORLD:
    if w[0] not in {x[0] for x in S.US}:
        out.append(['co', w[1] + ' · ' + w[0], w[3] + ' · ' + (UNI.COUNTRY.get(w[2], w[2])), 'finance.html#markets/us/' + w[0]])
# билеты и конспекты (Учёба)
tk = json.load(open(os.path.join(ROOT, 'src', 'tickets.json'), encoding='utf-8'))
KEY = {'konst': 'const', 'ugol': 'crim', 'grazh': 'civil'}; LAB = {'konst': 'Конституционное право', 'ugol': 'Уголовное право', 'grazh': 'Гражданское право'}
for k, lst in tk.items():
    for t in lst:
        out.append(['tk', '№ %s. %s' % (t['n'], t['q']), LAB.get(k, k) + '. ' + clean(t["a"], 800), 'ucheba.html#tickets-%s-%s' % (KEY.get(k, k), t['n'])])
html = open(os.path.join(ROOT, 'src', 'index.src.html'), encoding='utf-8').read()
m = re.search(r'id="data">(.*?)</script>', html, re.S)
if m:
    d = json.loads(m.group(1))
    for sj in d.get('subjects', []):
        for n in sj.get('notes', []):
            for h, x in sections(n.get('md', '')):
                out.append(['nt', n['title'], (sj['name'] + '. ' + x) if not h else x, 'ucheba.html#' + n['id'], h])
# лекции-презентации: кусками по 4 слайда, ссылка на первый слайд куска
def _stext(s):
    parts = [s.get('h', ''), s.get('lead', ''), s.get('q', ''), s.get('a', ''), s.get('ex', ''), s.get('note', '')] + list(s.get('f', []))
    for x in s.get('items', []): parts.append(x if isinstance(x, str) else x.get('b', '') + ' ' + x.get('d', ''))
    for x in s.get('steps', []): parts.append(x.get('h', '') + ' ' + x.get('d', ''))
    for x in s.get('stats', []): parts.append(x.get('v', '') + ' ' + x.get('l', ''))
    for k in ('l', 'r'):
        if s.get(k): parts += [s[k].get('h', '')] + list(s[k].get('items', []))
    parts += list(s.get('cols', [])) + [c for r in s.get('rows', []) for c in r]
    return ' '.join(p for p in parts if p)
for f in sorted(glob.glob(os.path.join(ROOT, 'src', 'lectures', 'decks', '*.json'))):
    d = json.load(open(f, encoding='utf-8'))
    out.append(['lc', d['title'], d['group'] + '. ' + d['desc'] + ' ' + ' '.join(d.get('tags', [])), 'lectures.html#' + d['id']])
    sl = d['slides']
    for i in range(0, len(sl), 5):
        ch = sl[i:i + 5]
        out.append(['lc', d['title'], clean(' '.join(_stext(s) for s in ch), 480), 'lectures.html#%s/%d' % (d['id'], i + 2), ch[0].get('h') or ch[0].get('q', '')])
p = os.path.join(ROOT, 'search-index.json')
open(p, 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
print('ok search-index', len(out), os.path.getsize(p) // 1024, 'KB')
