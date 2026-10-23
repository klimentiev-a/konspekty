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
        out.append(['sec', title, (short + '. ' + x).strip() if not h else x, 'finance.html#world/sectors/' + sid, h])
for tt in T.RICH:
    out.append(['term', tt[1], tt[2], 'finance.html#learn/glossariy'])
for tt in T.EXTRA:
    out.append(['term', tt[1], tt[2], 'finance.html#learn/glossariy'])
for x in S.RU: out.append(['co', x[1] + ' · ' + x[0], x[2] + ' · акции Мосбиржи', 'finance.html#markets/ru/' + x[0]])
for x in S.US: out.append(['co', x[1] + ' · ' + x[0], x[2] + ' · акции США', 'finance.html#markets/us/' + x[0]])
# компании из слоёв карты (штаб-квартира → регион)
ix = json.load(open(os.path.join(ROOT, 'world', 'regions', 'index.json'), encoding='utf-8'))
for l in ix['layers']:
    if not l.get('companies'): continue
    c = json.load(open(os.path.join(ROOT, 'world', 'companies', l['companies'] + '.json'), encoding='utf-8'))
    det = {}
    dp = os.path.join(ROOT, 'world', 'companies', l['companies'] + '-detail.json')
    if os.path.exists(dp): det = json.load(open(dp, encoding='utf-8')).get('items', {})
    for it in c['items']:
        d = det.get(it['name']) or {}
        txt = ' · '.join(x for x in [it.get('region', ''), d.get('what', ''), (d.get('ceo') or {}).get('n', ''), it.get('ticker', '')] if x)
        out.append(['co', it['name'], txt, 'finance.html#world/' + l['id'] + '/' + it.get('region', '')])
# финансы по-английски (fin-english.html)
for f in sorted(glob.glob(os.path.join(ROOT, 'src', 'finenglish', 'lessons', '[0-9]*.md'))):
    t = open(f, encoding='utf-8').read().strip().split('\n')
    title = re.sub(r'^# Topic \d+\. ', '', t[0]).strip(); short = t[1][6:].strip() if len(t) > 1 and t[1].startswith('short:') else ''
    fid = re.sub(r'^\d+_', '', os.path.splitext(os.path.basename(f))[0])
    body = '\n'.join(t[2:]).split('## Words')[0].replace('## Theory', '')
    for h, x in sections(body):
        if h == 'Theory': h = ''
        out.append(['en', title, (short + '. ' + x).strip() if not h else x, 'fin-english.html#t/' + fid, h])
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
p = os.path.join(ROOT, 'search-index.json')
open(p, 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
print('ok search-index', len(out), os.path.getsize(p) // 1024, 'KB')
