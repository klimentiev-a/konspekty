#!/usr/bin/env python3
"""Тексты статей из готовых файлов Артёма (когда сайты закрыты): ГК — PDF Гаранта, УК — .doc.
Запуск: python3 src/laws/from_files.py <код> <файл.txt> [garant|plain]. Берёт только нужные статьи (build_laws.needed()), дописывает в laws/<код>.json."""
import json, re, sys, os, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_laws as B

HEAD = re.compile(r'^\s*(Статья)\s+(\d{1,4}(?:\.\d{1,2})?)\.\s+(.+?)\s*$')
STOP = re.compile(r'^\s*(Раздел|Подраздел|Глава|Параграф|§|Часть\s+(первая|вторая|третья|четвёртая|четвертая)|Книга)\b')
JUNK = re.compile(r'^\s*(Дата актуализации|Актуальную версию|WWW\.GARANT|ГАРАНТ|\d{1,4})\s*$|Дата актуализации|garant\.ru|^\s*по состоянию на', re.I)

def parse(path, mode):
    lines = open(path, encoding='utf-8', errors='replace').read().replace('\f', '\n').split('\n')
    arts, cur = {}, None
    for ln in lines:
        m = HEAD.match(ln)
        if m and (mode == 'plain' or len(ln) - len(ln.lstrip()) >= 3 or True):
            n = m.group(2)
            cur = {'t': m.group(3), 'p': [], 'n': n}
            if n not in arts:
                arts[n] = cur
            else:
                cur = None  # повтор (например, в оглавлении или утратившая сила) — первый вариант оставляем
            continue
        if cur is None:
            continue
        if STOP.match(ln) and (len(ln) - len(ln.lstrip()) >= 3 or mode == 'plain'):
            cur = None
            continue
        if JUNK.search(ln) or not ln.strip():
            if mode == 'plain' and not ln.strip():
                cur['p'].append('')
            continue
        s = ln.strip()
        if mode == 'garant':
            new = (len(ln) - len(ln.lstrip())) >= 4
        else:
            new = True
        if new or not cur['p']:
            cur['p'].append(s)
        else:
            cur['p'][-1] += ' ' + s
    for a in arts.values():
        a['p'] = [re.sub(r'\s+', ' ', p).strip() for p in a['p'] if p.strip()]
        a['p'] = [B.clean(p) for p in a['p']]
        a['p'] = [p for p in a['p'] if p and not p.startswith(B.DROP)]
    return arts

if __name__ == '__main__':
    code, path = sys.argv[1], sys.argv[2]
    mode = sys.argv[3] if len(sys.argv) > 3 else 'garant'
    arts = parse(path, mode)
    need = B.needed()[code]
    out_path = os.path.join(B.OUT, code + '.json')
    have = json.load(open(out_path, encoding='utf-8')) if os.path.exists(out_path) else {}
    add = 0
    for a in sorted(need, key=float):
        if a in arts and arts[a]['p']:
            have[a] = {'t': arts[a]['t'], 'p': arts[a]['p']}; add += 1
        else:
            print('нет в файле', code, a)
    asof = sys.argv[4] if len(sys.argv) > 4 else datetime.date.today().isoformat()
    have.pop('_asof', None); have.pop('_name', None)
    out = {'_asof': asof, '_name': B.CODES[code][0]}
    out.update({a: have[a] for a in sorted(have, key=float)})
    os.makedirs(B.OUT, exist_ok=True)
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(code, 'добавлено', add, 'из', len(need), 'всего', len(have))
