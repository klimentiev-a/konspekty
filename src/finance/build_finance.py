#!/usr/bin/env python3
"""Сборка finance.html: python3 build_finance.py CONTENT_DIR MARKED_JS OUT_HTML"""
import sys, os, re, json, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import static_data as S
import universe as UNI

cdir, marked_path, out = sys.argv[1:4]
IDS = {'01':'ib','02':'otchetnost','03':'npv-irr','04':'wacc','05':'dcf','06':'multiplikatory','07':'metody','08':'sektory',
       '09':'koeffitsienty','10':'ma-lbo','11':'rynki-kapitala','12':'rossiya','13':'sobesedovanie','14':'excel','15':'makro','16':'kpi','17':'struktura-kapitala','18':'praktikum','19':'karera','20':'project-black','21':'stazhirovka','22':'keysy','98':'glossariy','99':'istochniki'}

def qa(md):
    # «**N. Вопрос**\nОтвет…» → <details>
    out, lines, i = [], md.split('\n'), 0
    while i < len(lines):
        m = re.match(r'^\*\*(\d+)\.\s+(.+?)\*\*\s*$', lines[i])
        if m:
            ans = []
            i += 1
            while i < len(lines) and lines[i].strip() and not lines[i].startswith('#') and not re.match(r'^\*\*\d+\.', lines[i]):
                ans.append(lines[i]); i += 1
            out.append('<details class="qa"><summary><span>%s</span>%s</summary><div>\n\n%s\n\n</div></details>\n' % (m.group(1), m.group(2), '\n'.join(ans)))
            continue
        out.append(lines[i]); i += 1
    return '\n'.join(out)

def check(md):
    # раздел «## Проверь себя» (до следующего «## » или конца) → вопросы-раскрывашки в любой главе и секторе
    m = re.search(r'^## Проверь себя[^\n]*\n', md, re.M)
    if not m: return md
    rest = md[m.end():]
    n = re.search(r'^## ', rest, re.M)
    part, tail = (rest[:n.start()], rest[n.start():]) if n else (rest, '')
    if '<details class="qa">' not in part: part = qa(part)
    return md[:m.end()] + '\n<p class="qahint">нажми на вопрос, чтобы увидеть ответ</p>\n\n' + part + tail


def read_md(f, ids=None):
    name = os.path.basename(f)
    b = name[:2]
    t = open(f, encoding='utf-8').read().strip().split('\n')
    title = t[0].lstrip('# ').strip()
    assert len(t) > 1 and t[1].startswith('short:'), f
    short = t[1][6:].strip()
    md = '\n'.join(t[2:]).strip() + '\n'
    if ids is not None and b in ('13', '18', '20', '21'): md = qa(md)
    md = check(md)
    # id: из словаря IDS (старые главы), иначе — из имени файла после «NN_»: 23_model-3-otchetov.md → model-3-otchetov
    fid = (ids or {}).get(b) or re.sub(r'^\d+_', '', os.path.splitext(name)[0])
    return {'id': fid, 'title': title, 'short': short, 'md': md}


# ссылки на карточки компаний, которых нет в справочнике сайта, превращаем в обычный текст (иначе «Компания не найдена»)
KNOWN = {'ru': {x[0] for x in S.RU}, 'us': {x[0] for x in S.US}}
def fix_links(md):
    def rep(m):
        kind, tic = m.group(2), m.group(3).upper()
        return m.group(0) if tic in KNOWN[kind] else m.group(1)
    return re.sub(r'\[([^\]]+)\]\(#markets/(ru|us)/([A-Za-z0-9.\-]+)\)', rep, md)
_read = read_md
def read_md(f, ids=None):
    c = _read(f, ids); c['md'] = fix_links(c['md']); return c

chs = [read_md(f, IDS) for f in sorted(glob.glob(os.path.join(cdir, '*.md')))]
# сектора мировой экономики (finance.html#world/sectors): src/finance/sectors/NN_<id>.md, формат как у глав
sdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sectors')
secs = [read_md(f) for f in sorted(glob.glob(os.path.join(sdir, '[0-9]*.md')))]

import terms as TM
gl = open(os.path.join(cdir, '98_glossary.md'), encoding='utf-8').read()
TERMS = TM.build(gl)
for x in TERMS:
    x['p'] = [re.sub(r'(?<!\\)\((?!\?)', '(?:', s.replace('\\w', '[а-яёА-ЯЁa-zA-Z]')) for s in x['p']]
static = {'ru': S.RU, 'ru_asof': S.RU_ASOF, 'ru_sect': S.RU_SECT, 'ru_sect_asof': S.RU_SECT_ASOF,
          'us': S.US, 'us_asof': S.US_ASOF, 'us_sect': S.US_SECT, 'us_sect_asof': S.US_SECT_ASOF,
          'uni': {'ru': UNI.RU, 'world': UNI.world_json(), 'region': UNI.REGION, 'country': UNI.COUNTRY}, 'macro': S.MACRO, 'kbd': S.KBD, 'keyrate': S.KEYRATE, 'cal': S.CAL, 'events': json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'events.json'), encoding='utf-8'))}
data = json.dumps({'chapters': chs, 'sectors': secs, 'static': static, 'terms': TERMS}, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
tpl = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'finance_template.html'), encoding='utf-8').read()
assert '<!--DATA-->' in tpl and '<!--MARKED-->' in tpl
tpl = tpl.replace('<!--ZOOM-->', '<script>' + open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'zoom.js'), encoding='utf-8').read() + '</script>')
html = tpl.replace('<!--DATA-->', '<script type="application/json" id="fdata">' + data + '</script>') \
          .replace('<!--MARKED-->', '<script>' + open(marked_path, encoding='utf-8').read() + '</script>')
_g = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gate_artem.html')
if os.path.exists(_g):   # замок профиля «Артем»
    html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + open(_g, encoding='utf-8').read(), 1)
open(out, 'w', encoding='utf-8').write(html)
# politika.html — та же сборка, только политическая карта (JS смотрит на data-app="pol")
pol = html.replace('<html lang="ru">', '<html lang="ru" data-app="pol">', 1).replace('<title>Финансы</title>', '<title>Политика</title>', 1)
_pd = json.loads(data); _pd['chapters'] = []; _pd['sectors'] = []; _pd['terms'] = []   # главы и сектора «Политике» не нужны — файл в десятки раз легче
pol = pol.replace('<script type="application/json" id="fdata">' + data + '</script>', '<script type="application/json" id="fdata">' + json.dumps(_pd, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/') + '</script>')
open(os.path.join(os.path.dirname(out) or '.', 'politika.html'), 'w', encoding='utf-8').write(pol)
print('ok', len(chs), 'chapters', len(secs), 'sectors', len(TERMS), 'terms', len(html.encode()), 'bytes')
