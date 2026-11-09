#!/usr/bin/env python3
"""Тексты статей для всплывающего окошка в «Учёбе».
Берёт из конспектов и билетов все ссылки вида «ст. 25 УК РФ», скачивает только эти статьи
(КонсультантПлюс, действующая редакция; Конституция — kremlin.ru) и кладёт в laws/<код>.json.
Уже скачанное не трогает. Запуск: python3 src/laws/build_laws.py  (нужен интернет; из песочницы Claude закрыт — работает в GitHub Actions, laws.yml)."""
import json, re, os, sys, time, html, datetime, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'laws')
UA = {'User-Agent': 'Mozilla/5.0 (konspekty laws fetcher; one-off, 1 req/s)'}
CODES = {  # код → (название, документы КонсультантПлюс)
    'uk': ('УК РФ', [10699]), 'gk': ('ГК РФ', [5142, 9027, 34154, 64629]), 'upk': ('УПК РФ', [34481]),
    'gpk': ('ГПК РФ', [39570]), 'apk': ('АПК РФ', [37800]), 'koap': ('КоАП РФ', [34661]),
    'nk': ('НК РФ', [19671, 28165]), 'tk': ('ТК РФ', [34683]), 'sk': ('СК РФ', [8982]),
    'zk': ('ЗК РФ', [33773]), 'zhk': ('ЖК РФ', [51057]), 'konst': ('Конституция РФ', []),
}
WORD = {'УК': 'uk', 'ГК': 'gk', 'УПК': 'upk', 'ГПК': 'gpk', 'АПК': 'apk', 'КоАП': 'koap', 'КОАП': 'koap', 'НК': 'nk',
        'ТК': 'tk', 'СК': 'sk', 'ЗК': 'zk', 'ЖК': 'zhk', 'Конституци': 'konst', 'Основного': 'konst'}
SUBJ = {'const': 'konst', 'civil': 'gk', 'crim': 'uk'}
TKT = {'konst': 'konst', 'ugol': 'uk', 'grazh': 'gk'}
NUM = r'\d{1,4}(?:\.\d{1,2})?'
REF = re.compile(r'(?<![\wа-яё])(?:ст\.\s?ст\.|ст\.|статьи|статье|статья|статей|статью)\s*(' + NUM + r')((?:\s*\([^)]{0,50}\))?(?:\s*(?:,|и|–|—|-)\s*' + NUM + r'(?:\s*\([^)]{0,50}\))?)*)', re.I)
AFTER = re.compile(r'^\s*(?:\([^)]{0,40}\)\s*)?(?:(?:ч|п|пп|абз)\.\s?[^\s,;]{1,8}\s*){0,3}(УК|ГК|УПК|ГПК|АПК|КоАП|КОАП|НК|ТК|СК|ЗК|ЖК|Конституци|Основного)')
NOT = re.compile(r'^\s*(?:\([^)]{0,40}\)\s*)?(?:ФЗ|ФКЗ|ЕКС|Федеральн|Закон|закон|кодекс|Кодекс|Конвенци|Устав|устав|договор|Гражданск|Уголовн)')

def refs(text, default):
    """[(код, номер)] — та же логика, что в artLinkify на странице."""
    res = []
    for m in REF.finditer(text):
        after = text[m.end():m.end() + 50]
        am = AFTER.match(after)
        if am:
            code = WORD[am.group(1)]
        elif NOT.match(after):
            continue
        else:
            seg = text[max(0, m.start() - 60):m.start()]
            seg = seg[max(seg.rfind(';'), seg.rfind('\n')) + 1:]
            code = 'konst' if 'Конституци' in seg else default
            tail = seg[-80:]
            if code != 'konst' and re.search(r'(?:ФЗ|ФКЗ|УК|ГК|УПК|КоАП|НК|ТК|СК|ГПК|АПК|[Зз]акон|[Кк]одекс)(?![а-яё])', tail):
                continue
        if not code:
            continue
        for n in re.findall(NUM, m.group(1) + m.group(2)):
            res.append((code, n))
    return res

def needed():
    need = {k: set() for k in CODES}
    d = json.load(open(os.path.join(ROOT, 'src/data.json'), encoding='utf-8'))
    for s in d['subjects']:
        for n in s['notes']:
            for c, a in refs(n['md'], SUBJ.get(s['id'], '')):
                need[c].add(a)
    t = json.load(open(os.path.join(ROOT, 'src/tickets.json'), encoding='utf-8'))
    for k, v in t.items():
        for i in v:
            for c, a in refs(i['a'], TKT.get(k, '')):
                need[c].add(a)
    return need

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                b = r.read()
            time.sleep(0.4)
            return b.decode('utf-8', 'replace')
        except Exception as e:
            print('  retry', url[-50:], e, file=sys.stderr)
            time.sleep(3 + 3 * i)
    return ''

def clean(t):
    t = re.sub(r'<br\s*/?>', ' ', t)
    t = re.sub(r'<[^>]+>', '', t)
    t = html.unescape(t).replace('\xa0', ' ')
    t = re.sub(r'\s+', ' ', t).strip()
    # пометки КонсультантПлюс об изменениях: «(в ред. … от 08.12.2003 N 162-ФЗ)»
    t = re.sub(r'\s*\((?:[^()]|\([^()]*\))*?\d{2}\.\d{2}\.\d{4}\s+N\s+[\d\w\-]+(?:[^()]|\([^()]*\))*?\)', '', t)
    return t.strip()

DROP = ('КонсультантПлюс', 'Информация об изменениях', 'Список изменяющих', 'Примечание', 'Позиции высших', 'Путеводител',
        'Открыть полный', 'Нормативные акты', 'Утратил', 'См. ')

def parse_article(page):
    m = re.search(r'<div class="document-page__content[^"]*">(.*?)<div class="full-text', page, re.S)
    if not m:
        return None
    body = m.group(1)
    h = re.search(r'<h1>(.*?)</h1>', body, re.S)
    title = clean(h.group(1)) if h else ''
    title = re.sub(r'^.*?Статья\s+[\d.]+\.?\s*', '', title)
    paras = []
    for p in re.findall(r'<p(?:\s[^>]*)?>(.*?)</p>', body[h.end():] if h else body, re.S):
        t = clean(p)
        if not t or t.startswith(DROP) or re.fullmatch(r'\(.*\)', t):
            continue
        paras.append(t)
    return {'t': title, 'p': paras}

def toc(doc):
    page = get('https://www.consultant.ru/document/cons_doc_LAW_%d/' % doc)
    out = {}
    for href, name in re.findall(r'<a href="(/document/cons_doc_LAW_%d/[0-9a-f]{40}/)">\s*(Статья [^<]+)</a>' % doc, page):
        mm = re.match(r'Статья\s+([\d.]+?)\.?\s', name + ' ')
        if mm:
            out.setdefault(mm.group(1), 'https://www.consultant.ru' + href)
    print('toc', doc, len(out), file=sys.stderr)
    return out

def konst():
    page = get('http://www.kremlin.ru/acts/constitution/item')
    out = {}
    for m in re.finditer(r'<h3[^>]*>\s*<span[^>]*>\s*(?:<a[^>]*></a>)?\s*Статья\s+(\d+(?:\.\d+)?)\s*</span>.*?</h3>(.*?)(?=<h3|<h2|$)', page, re.S):
        n = m.group(1)
        paras = [clean(p) for p in re.findall(r'<p(?:\s[^>]*)?>(.*?)</p>', m.group(2), re.S)]
        paras = [p for p in paras if p and not p.startswith(DROP)]
        if paras and n not in out:
            out[n] = {'t': '', 'p': paras}
    print('konst', len(out), file=sys.stderr)
    return out

def main():
    os.makedirs(OUT, exist_ok=True)
    need = needed()
    today = datetime.datetime.utcnow().strftime('%Y-%m-%d')
    index = {}
    for code, (title, docs) in CODES.items():
        path = os.path.join(OUT, code + '.json')
        have = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else {}
        want = sorted(need[code], key=lambda x: float(x))
        if code == 'konst':
            if any(a not in have for a in want):
                k = konst()
                for a in want:
                    if a in k:
                        have[a] = k[a]
        elif any(a not in have for a in want):
            urls = {}
            for d in docs:
                urls.update(toc(d))
            todo = []
            for a in want:
                if a in have:
                    continue
                if a not in urls:
                    print('  нет в оглавлении', code, a, file=sys.stderr)
                    continue
                todo.append(a)
            def one(a):
                return a, parse_article(get(urls[a]))
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(8) as ex:
                for a, art in ex.map(one, todo):
                    if art and art['p']:
                        have[a] = art
                        print('  ok', code, a, len(art['p']), file=sys.stderr, flush=True)
                    else:
                        print('  не разобрана', code, a, file=sys.stderr, flush=True)
        for a in list(have):
            if a.startswith('_'):
                del have[a]
        have = {a: have[a] for a in sorted(have, key=float)}
        out = {'_asof': today, '_name': title}
        out.update(have)
        json.dump(out, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        index[code] = {'n': title, 'a': list(have.keys())}
    json.dump({'asof': today, 'codes': index}, open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print({c: len(v['a']) for c, v in index.items()}, 'нужно:', {c: len(s) for c, s in need.items()})

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'need':
        n = needed()
        print({c: len(s) for c, s in n.items()})
    else:
        main()
