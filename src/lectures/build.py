#!/usr/bin/env python3
"""Лекции: колоды из src/lectures/decks/*.json → lectures/<id>.json + lectures/index.json.
Проверяет формат (тип слайдов, последний слайд — итог, группа из списка, пустые строки). Запуск из корня: python3 src/lectures/build.py"""
import os, re, json, glob, ast, sys

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
GROUPS = ['M&A и сделки', 'LBO и моделирование', 'Оценка', 'Отчётность и учёт', 'PE и венчур', 'Нефть и газ', 'Металлы и добыча', 'TMT и медиа', 'Телеком',
          'Финтех и банки', 'Страхование и пенсии', 'Инфраструктура и проекты', 'Недвижимость и ритейл', 'Налоги', 'Кейсы M&A', 'Крипта и альтернативы', 'Макро и Excel', 'Здравоохранение и прочее']
TYPES = {'points', 'table', 'formula', 'steps', 'compare', 'stats', 'qa', 'takeaway'}
SOURCES = {'School of Finance', 'IB Club', 'Campus Finance', 'Skillspace'}

# названия глав учебника: id → заголовок
src = open(os.path.join(ROOT, 'src', 'finance', 'build_finance.py'), encoding='utf-8').read()
IDS = ast.literal_eval(re.search(r'IDS = (\{.*?\})\n', src, re.S).group(1))
HUB = {}
for f in sorted(glob.glob(os.path.join(ROOT, 'src', 'finance', 'content', '*.md'))):
    st = os.path.basename(f)[:-3]; nn = st.split('_')[0]
    cid = IDS.get(nn) or re.sub(r'^\d+_', '', st)
    first = open(f, encoding='utf-8').readline().strip()
    if first.startswith('# '): HUB[cid] = re.sub(r'^Тема \d+\.\s*', '', first[2:]).strip()


def walk(o, path, errs):
    if isinstance(o, str):
        if not o.strip(): errs.append('пустая строка ' + path)
    elif isinstance(o, list):
        for i, x in enumerate(o): walk(x, '%s[%d]' % (path, i), errs)
    elif isinstance(o, dict):
        for k, v in o.items():
            if k != 'cols': walk(v, path + '.' + k, errs)


def check(d, fn):
    e = []
    for k in ('id', 'title', 'group', 'source', 'desc', 'slides'):
        if not d.get(k): e.append('нет поля ' + k)
    if d.get('group') not in GROUPS: e.append('группа не из списка: %r' % d.get('group'))
    if d.get('source') not in SOURCES: e.append('источник не из списка: %r' % d.get('source'))
    if d.get('id') and d['id'] != os.path.basename(fn)[:-5]: e.append('id не совпадает с именем файла')
    if d.get('id') and not re.fullmatch(r'[a-z0-9][a-z0-9-]*', d['id']): e.append('плохой id')
    sl = d.get('slides') or []
    if len(sl) < 6: e.append('мало слайдов: %d' % len(sl))
    for i, s in enumerate(sl):
        if s.get('t') not in TYPES: e.append('слайд %d: тип %r' % (i + 1, s.get('t')))
        if s.get('t') != 'qa' and not s.get('h'): e.append('слайд %d: нет заголовка' % (i + 1))
    if sl and sl[-1].get('t') != 'takeaway': e.append('последний слайд не takeaway')
    for i, s in enumerate(sl[:-1]):
        if s.get('t') == 'takeaway': e.append('takeaway не в конце: слайд %d' % (i + 1))
    for s in sl:
        for k in ('note', 'n', 'lead', 'ex'):
            if k in s and not str(s[k]).strip(): del s[k]
        if s.get('t') == 'table':
            s['cols'] = [(c if str(c).strip() else ' ') for c in s.get('cols', [])]
        if s.get('t') == 'table': s['rows'] = [[(c if str(c).strip() else '—') for c in r] for r in s.get('rows', [])]
    walk(d, d.get('id', fn), e)
    d['hub'] = [h for h in d.get('hub', []) if h in HUB]
    return e


decks, bad = [], 0
for fn in sorted(glob.glob(os.path.join(HERE, 'decks', '*.json'))):
    try: d = json.load(open(fn, encoding='utf-8'))
    except Exception as ex:
        print('ОШИБКА JSON', fn, ex); bad += 1; continue
    err = check(d, fn)
    if err:
        print('ОШИБКА', os.path.basename(fn), '; '.join(err[:6])); bad += 1; continue
    decks.append(d)

out = os.path.join(ROOT, 'lectures'); os.makedirs(out, exist_ok=True)
for f in glob.glob(os.path.join(out, '*.json')): os.remove(f)
idx = []
for d in decks:
    n = len(d['slides']) + 1
    json.dump(d, open(os.path.join(out, d['id'] + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    heads = ' '.join((s.get('h') or s.get('q') or '') for s in d['slides'])
    idx.append({'id': d['id'], 'title': d['title'], 'group': d['group'], 'source': d['source'], 'level': d.get('level', 'base'), 'desc': d['desc'],
                'tags': d.get('tags', []), 'n': n, 'min': max(2, round((n - 1) * 0.7)), 'q': heads})
idx.sort(key=lambda x: (GROUPS.index(x['group']), x['title']))
hubused = sorted({h for d in decks for h in d['hub']})
json.dump({'decks': idx, 'hub': {h: HUB[h] for h in hubused}}, open(os.path.join(out, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('ok lectures: %d колод, %d слайдов, ошибок %d' % (len(decks), sum(len(d['slides']) for d in decks), bad))
sys.exit(1 if bad and os.environ.get('LEC_STRICT') else 0)
