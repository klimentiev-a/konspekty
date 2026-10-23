#!/usr/bin/env python3
"""Политическая карта: собирает world/politics.json из открытых наборов.

Запускается вручную (данные обновляются раз в год или реже), в update_all.sh не входит.
Нужны: pandas, pyreadr, openpyxl, pycountry.

  python3 update_politics.py --factbook /путь/к/factbook.json --fh /путь/к/папке_с_xlsx

Источники:
  • V-Dem v16 (Varieties of Democracy, Университет Гётеборга) — тип режима и индексы, 2000–2025.
    Пакет vdemdata на GitHub, лицензия CC BY-SA 4.0.
  • Freedom House, «Свобода в мире» (Freedom in the World) — статус и балл 0–100; таблицы из пакета
    pachadotdev/freedomhouse (CC0). Год в таблице — год, который оценивается.
  • CIA World Factbook (репозиторий factbook/factbook.json) — форма правления, руководители, выборы.
  • Членство в блоках — списки сверены с сайтами организаций и Википедией на дату проверки (см. BLOCS).
"""
import argparse, datetime, glob, json, os, re, subprocess, sys, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
Y0 = 2000
MONTHS = {'January': 'января', 'February': 'февраля', 'March': 'марта', 'April': 'апреля', 'May': 'мая', 'June': 'июня', 'July': 'июля',
          'August': 'августа', 'September': 'сентября', 'October': 'октября', 'November': 'ноября', 'December': 'декабря'}
MNUM = {m: i + 1 for i, m in enumerate(MONTHS)}

# ---------- карта: ISO3 из world/countries.json ----------
def map_iso():
    t = json.load(open(os.path.join(ROOT, 'world/countries.json')))
    return {g['properties']['iso3'] for g in t['objects']['countries']['geometries'] if g['properties'].get('iso3')}

# ---------- GEC (имена файлов Factbook) → ISO3 ----------
GEC_MANUAL = {'cg': 'COD', 'iv': 'CIV', 'bm': 'MMR', 'tu': 'TUR', 'vt': 'VAT', 'pc': 'PCN', 'nn': 'SXM', 'uc': 'CUW', 'rn': 'MAF',
              'tb': 'BLM', 'mc': 'MAC', 'fk': 'FLK', 'vq': 'VIR'}
def gec_iso(rows):
    import pycountry
    idx = {}
    norm = lambda s: re.sub(r'[^a-z]', '', s.lower().replace('&', 'and'))
    for c in pycountry.countries:
        for a in (c.name, getattr(c, 'official_name', None), getattr(c, 'common_name', None)):
            if a: idx[norm(a)] = c.alpha_3
    out = {}
    for gec, sh, lg in rows:
        k = GEC_MANUAL.get(gec) or idx.get(norm(sh)) or idx.get(norm(lg))
        if k: out[gec] = k
    return out

# ---------- V-Dem ----------
VD = [('v2x_regime', 'VREG'), ('v2x_polyarchy', 'VPOLY'), ('v2x_libdem', 'VLIB'), ('v2x_civlib', 'VCIV'), ('v2x_rule', 'VRULE'), ('v2x_corr', 'VCORR')]
def load_vdem(cache):
    import pyreadr
    p = os.path.join(cache, 'vdem.RData')
    if not os.path.exists(p):
        urllib.request.urlretrieve('https://raw.githubusercontent.com/vdeminstitute/vdemdata/master/data/vdem.RData', p)
    d = pyreadr.read_r(p)['vdem']
    return d[['country_text_id', 'year'] + [c for c, _ in VD]]

# ---------- Freedom House ----------
def load_fh(folder):
    import pandas as pd
    st = pd.ExcelFile(os.path.join(folder, 'country-rating-status.xlsx'))
    sc = pd.ExcelFile(os.path.join(folder, 'country-score.xlsx'))
    status, score = {}, {}
    SC = {'Not Free': 0, 'Partially Free': 1, 'Partly Free': 1, 'Free': 2}
    for s in st.sheet_names:
        d = st.parse(s)
        for _, r in d.iterrows():
            iso = r['iso3c'] if isinstance(r['iso3c'], str) else ('FSM' if r['country'] == 'Micronesia' else None)
            if iso and r['status'] in SC: status[(iso, int(r['year']))] = SC[r['status']]
    for s in sc.sheet_names:
        d = sc.parse(s)
        d = d[d['iso3c'].notna() | (d['country'] == 'Micronesia')].copy()
        d.loc[d['country'] == 'Micronesia', 'iso3c'] = 'FSM'
        g = d.groupby(['iso3c', 'year'])['score'].agg(['sum', 'count'])
        for (iso, y), r in g.iterrows():
            if r['count'] == 25: score[(iso, int(y))] = int(r['sum'])   # 25 подпунктов (A1–G4) → итог 0–100
    return status, score

# ---------- Factbook ----------
TITLES = [('Vice President', 'Вице-президент'), ('President', 'Президент'), ('Prime Minister', 'Премьер-министр'), ('Premier', 'Премьер'),
          ('Chancellor', 'Канцлер'), ('Chief Executive', 'Глава администрации'), ('Supreme Leader', 'Верховный лидер'), ('General Secretary', 'Генеральный секретарь'),
          ('Chairman', 'Председатель'), ('Chair', 'Председатель'), ('King', 'Король'), ('Queen', 'Королева'), ('Emperor', 'Император'), ('Sultan', 'Султан'),
          ('Emir', 'Эмир'), ('Amir', 'Эмир'), ('Grand Duke', 'Великий герцог'), ('Prince', 'Князь / принц'), ('Pope', 'Папа римский'),
          ('Captain Regent', 'Капитан-регент'), ('Governor General', 'Генерал-губернатор'), ('Governor', 'Губернатор'), ('Chief Minister', 'Главный министр'),
          ('Premier', 'Премьер'), ('Taoiseach', 'Премьер-министр (тишех)'), ('Co-prince', 'Сокнязь')]
PHR = [('President of the Executive Yuan', 'Председатель Исполнительного юаня'), ('State Affairs Commission', 'Комиссия по государственным делам'),
       ("Supreme People's Assembly", 'Верховное народное собрание'), ('Crown Prince', 'Наследный принц'), ('Deputy Prime Minister', 'Вице-премьер'),
       ('Prime Minister', 'Премьер-министр'), ('Vice President', 'Вице-президент'), ('President', 'Президент'), ('Chairman', 'Председатель'),
       ('General Secretary', 'Генеральный секретарь'), ('Supreme Leader', 'Верховный лидер'), ('Premier', 'Премьер'), ('King', 'Король'), (' and ', ' и ')]
def tr_name(n):
    for en, ru in PHR: n = n.replace(en, ru)
    return n
def ru_date(s):
    s = s.strip()
    for en, ru in MONTHS.items(): s = s.replace(en, ru)
    return s
def parse_since(s):
    m = re.search(r'(\d{1,2})?\s*(January|February|March|April|May|June|July|August|September|October|November|December)?\s*((?:19|20)\d\d)', s)
    if not m: return None
    d = int(m.group(1)) if m.group(1) else 1
    mo = MNUM.get(m.group(2), 1) if m.group(2) else 1
    try: return datetime.date(int(m.group(3)), mo, d).isoformat()
    except ValueError: return None
def leader(txt):
    """«President Vladimir PUTIN (since 7 May 2012); …» → {'t': 'Президент', 'n': 'Vladimir PUTIN', 'since': '2012-05-07', 'sr': '7 мая 2012'}"""
    if not txt: return None
    t = re.sub(r'<[^>]+>', ' ', txt).replace('&nbsp;', ' ').strip()
    first = re.split(r';|\bnote\b', t)[0].strip()
    m = re.search(r'\(since ([^)]+)\)', first)
    since = parse_since(m.group(1)) if m else None
    nm = re.sub(r'\s*\(since [^)]+\)', '', first).strip()
    ttl = ''
    for en, ru in TITLES:
        if nm.startswith(en):
            ttl = ru; nm = nm[len(en):].strip(); break
    if len(nm) > 80 or not nm: return None
    nm = tr_name(nm)
    return {'t': ttl, 'n': nm, 'since': since, 'sr': ru_date(m.group(1)) if m else None}
def classify(raw):
    t = re.sub(r'<[^>]+>', '', raw or '').replace('&nbsp;', ' ').strip().lower()
    if not t: return None
    if 'free association' not in t and re.search(r'territory|overseas|collectivit|dependency|special administrative|non-self-governing|commonwealth in political union', t): return 9
    if re.search(r'communist|single-party|one-party|dictatorship|authoritarian', t): return 6
    if re.search(r'theocra|islamic republic|ecclesiastical', t): return 7
    if re.search(r'military|in transition|transitional', t): return 8
    if re.search(r'absolute monarchy|sultanate|emirate|federation of monarchies', t): return 5
    if 'monarchy' in t: return 3 if 'parliamentary' in t else 4
    if re.search(r'semi-presidential|mixed presidential', t): return 1
    if 'presidential' in t: return 0
    if re.search(r'parliamentary|republic|democracy', t): return 2
    return None
def first_year(txt):
    m = re.search(r'\b(19|20)\d\d\b', txt or '')
    return int(m.group(0)) if m else None
def nextel_code(txt):
    if not txt: return 0
    t = txt.lower()
    if re.search(r'postpone|delay|tbd|no new date|supposed to|unclear|indefinite', t): return 0
    y = first_year(txt)
    if y is None or y < 2026: return 0
    return 1 if y == 2026 else 2 if y == 2027 else 3 if y == 2028 else 4 if y <= 2030 else 5
def split_orgs(o):
    out, depth, tok = [], 0, ''
    for ch in o:
        if ch == '(': depth += 1
        if ch == ')': depth -= 1
        if ch == ',' and depth == 0: out.append(tok.strip()); tok = ''
        else: tok += ch
    out.append(tok.strip())
    return out

# ---------- блоки ----------
# full — полноправные члены; mid — промежуточный статус (наблюдатель, партнёр, кандидат, приостановлено); notes — пояснения к стране.
# Списки собраны 23.10.2026 по сайтам организаций / Википедии; Factbook (сентябрь 2026) использован для перекрёстной проверки.
def S(x): return x.split()
BLOCS = [
 dict(id='NATO', name='НАТО', en='NATO', mid_label='', src='nato.int (список стран-членов)', url='https://www.nato.int/cps/en/natohq/nato_countries.htm', asof='2026-10-23',
      full=S('ALB BEL BGR CAN HRV CZE DNK EST FIN FRA DEU GRC HUN ISL ITA LVA LTU LUX MNE MKD NOR POL PRT ROU SVK SVN ESP SWE NLD TUR GBR USA'), mid=[], notes={}),
 dict(id='EU', name='Евросоюз', en='EU', mid_label='Кандидат на вступление', src='Список — european-union.europa.eu (первые 20 из 27 проверены по странице; остальные — по Factbook и Википедии); кандидаты — Википедия', url='https://european-union.europa.eu/principles-countries-history/eu-countries_en', asof='2026-10-23',
      full=S('AUT BEL BGR HRV CYP CZE DNK EST FIN FRA DEU GRC HUN IRL ITA LVA LTU LUX MLT NLD POL PRT ROU SVK SVN ESP SWE'),
      mid=S('ALB MDA MNE MKD SRB UKR BIH GEO TUR'), notes={'GEO': 'процесс вступления остановлен с июля 2024', 'TUR': 'переговоры заморожены'}),
 dict(id='SCO', name='ШОС', en='SCO', mid_label='Наблюдатель или партнёр по диалогу', src='Википедия (сайт ШОС не отдаёт списки); Factbook отстаёт — Индию, Иран, Белоруссию там нет среди членов', url='https://en.wikipedia.org/wiki/Shanghai_Cooperation_Organisation', asof='2026-10-23',
      full=S('CHN KAZ KGZ RUS TJK UZB IND PAK IRN BLR'), mid=S('AFG MNG ARM AZE BHR KHM EGY KWT LAO MDV MMR NPL QAT SAU LKA TUR ARE'), notes={'AFG': 'наблюдатель, участие приостановлено с 2021'}),
 dict(id='BRICS', name='БРИКС', en='BRICS', mid_label='Страна-партнёр', src='Википедия', url='https://en.wikipedia.org/wiki/BRICS', asof='2026-10-23',
      full=S('BRA RUS IND CHN ZAF EGY ETH IRN ARE IDN'), mid=S('SAU DZA BLR BOL CUB KAZ MYS NGA THA TUR UGA UZB VNM'), notes={'SAU': 'приглашена, участие публично не подтверждено'}),
 dict(id='EAEU', name='ЕАЭС', en='EAEU', mid_label='Наблюдатель', src='eaeunion.org', url='https://eaeunion.org/?lang=en', asof='2026-10-23',
      full=S('ARM BLR KAZ KGZ RUS'), mid=S('UZB CUB'), notes={}),
 dict(id='CSTO', name='ОДКБ', en='CSTO', mid_label='', src='Википедия', url='https://en.wikipedia.org/wiki/Collective_Security_Treaty_Organization', asof='2026-10-23',
      full=S('ARM BLR KAZ KGZ RUS TJK'), mid=[], notes={'ARM': 'участие заморожено с февраля 2024, о выходе объявлено в июне 2024'}),
 dict(id='CIS', name='СНГ', en='CIS', mid_label='Ассоциированный член', src='Википедия', url='https://en.wikipedia.org/wiki/Commonwealth_of_Independent_States', asof='2026-10-23',
      full=S('ARM AZE BLR KAZ KGZ MDA RUS TJK UZB'), mid=S('TKM'), notes={'MDA': 'выход вступает в силу 8 апреля 2027'}),
 dict(id='OPEC', name='ОПЕК', en='OPEC', mid_label='ОПЕК+ (не член ОПЕК)', src='Википедия; выход ОАЭ — JPT/SPE (1 мая 2026)', url='https://en.wikipedia.org/wiki/OPEC', asof='2026-10-23',
      full=S('DZA COG GNQ GAB IRN IRQ KWT LBY NGA SAU VEN'), mid=S('AZE BHR BRA BRN KAZ MYS MEX OMN RUS SSD SDN'), notes={'ARE': 'вышли из ОПЕК и ОПЕК+ с 1 мая 2026'}),
 dict(id='ASEAN', name='АСЕАН', en='ASEAN', mid_label='Наблюдатель', src='Википедия', url='https://en.wikipedia.org/wiki/ASEAN', asof='2026-10-23',
      full=S('BRN KHM IDN LAO MYS MMR PHL SGP THA TLS VNM'), mid=S('PNG'), notes={'TLS': 'принят 26 октября 2025'}),
 dict(id='G20', name='G20', en='G20', mid_label='', src='Википедия (ещё в G20: Евросоюз и Африканский союз как организации)', url='https://en.wikipedia.org/wiki/G20', asof='2026-10-23',
      full=S('ARG AUS BRA CAN CHN FRA DEU IND IDN ITA JPN MEX RUS SAU ZAF KOR TUR GBR USA'), mid=[], notes={}),
 dict(id='OECD', name='ОЭСР', en='OECD', mid_label='Кандидат на вступление', src='Википедия', url='https://en.wikipedia.org/wiki/OECD', asof='2026-10-23',
      full=S('AUS AUT BEL CAN CHL COL CRI CZE DNK EST FIN FRA DEU GRC HUN ISL IRL ISR ITA JPN LVA LTU LUX MEX NLD NZL NOR POL PRT SVK SVN KOR ESP SWE CHE TUR GBR USA'),
      mid=S('ARG BRA BGR HRV IDN PER ROU THA'), notes={}),
 dict(id='COE', name='Совет Европы', en='Council of Europe', mid_label='', src='Википедия (Россия исключена 15 марта 2022)', url='https://en.wikipedia.org/wiki/Council_of_Europe', asof='2026-10-23',
      full=S('ALB AND ARM AUT AZE BEL BIH BGR HRV CYP CZE DNK EST FIN FRA GEO DEU GRC HUN ISL IRL ITA LVA LIE LTU LUX MLT MDA MCO MNE NLD MKD NOR POL PRT ROU SMR SRB SVK SVN ESP SWE CHE TUR UKR GBR'), mid=[], notes={'RUS': 'исключена 15 марта 2022'}),
 dict(id='AU', name='Африканский союз', en='African Union', mid_label='Членство приостановлено', src='Википедия', url='https://en.wikipedia.org/wiki/African_Union', asof='2026-10-23',
      full=S('DZA AGO BEN BWA BDI CMR CPV CAF TCD COM COD COG DJI EGY GNQ ERI SWZ ETH GAB GMB GHA GIN CIV KEN LSO LBR LBY MWI MRT MUS MAR MOZ NAM NGA RWA ESH STP SEN SYC SLE SOM ZAF SSD TZA TGO TUN UGA ZMB ZWE'),
      mid=S('BFA GNB MDG MLI NER SDN'), notes={'ESH': 'в союзе представлена САДР (Сахарская Арабская Демократическая Республика)'}),
 dict(id='LAS', name='Лига арабских государств', en='Arab League', mid_label='', src='Википедия', url='https://en.wikipedia.org/wiki/Arab_League', asof='2026-10-23',
      full=S('DZA BHR COM DJI EGY IRQ JOR KWT LBN LBY MRT MAR OMN PSE QAT SAU SOM SDN SYR TUN ARE YEM'), mid=[], notes={}),
]
# соответствие кодов блоков в Factbook (для перекрёстной проверки)
FB_ORG = {'NATO': 'NATO', 'EU': 'EU', 'SCO': 'SCO', 'BRICS': 'BRICS', 'EAEU': 'EAEU', 'CSTO': 'CSTO', 'CIS': 'CIS', 'OPEC': 'OPEC', 'ASEAN': 'ASEAN', 'G20': 'G-20', 'OECD': 'OECD', 'COE': 'CE', 'AU': 'AU', 'LAS': 'LAS'}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--factbook', default='/home/claude/factbook/factbook.json')
    ap.add_argument('--fh', default='.')
    ap.add_argument('--cache', default='/tmp')
    ap.add_argument('--out', default=os.path.join(ROOT, 'world/politics.json'))
    a = ap.parse_args()
    ISO = map_iso()

    # --- Factbook ---
    rows, recs = [], {}
    for p in sorted(glob.glob(a.factbook + '/*/*.json')):
        reg = os.path.basename(os.path.dirname(p))
        if reg == 'meta': continue
        gec = os.path.basename(p)[:-5]
        try: d = json.load(open(p))
        except Exception: continue
        g = d.get('Government', {})
        cn = g.get('Country name', {})
        rows.append((gec, (cn.get('conventional short form') or {}).get('text', ''), (cn.get('conventional long form') or {}).get('text', '')))
        recs[gec] = g
    g2i = gec_iso(rows)
    fb_asof = ''
    try: fb_asof = subprocess.check_output(['git', '-C', a.factbook, 'log', '-1', '--format=%cs'], text=True).strip()
    except Exception: pass

    st = {}
    orgs = {}
    for gec, g in recs.items():
        iso = g2i.get(gec)
        if not iso or iso not in ISO: continue
        ex = g.get('Executive branch', {})
        gt = (g.get('Government type') or {}).get('text', '')
        cs = leader((ex.get('chief of state') or {}).get('text'))
        hg = leader((ex.get('head of government') or {}).get('text'))
        le = re.sub(r'<[^>]+>', ' ', (ex.get('most recent election date') or {}).get('text', '')).strip()
        ne = re.sub(r'<[^>]+>', ' ', (ex.get('expected date of next election') or {}).get('text', '')).strip()
        r = {'GOVF': classify(gt), 'NEXTEL': nextel_code(ne)}
        if gt: r['gov'] = re.sub(r'<[^>]+>|&nbsp;', ' ', gt).strip()[:140]
        if cs: r['cs'] = cs
        if hg and (not cs or hg['n'] != cs['n']): r['hg'] = hg
        led = ru_date(le)
        if le and len(le) < 40 and not re.search(r'[A-Za-z]', led): r['le'] = led
        elif first_year(le): r['le'] = str(first_year(le))
        ned = ru_date(ne)
        if r['NEXTEL']:
            r['ne'] = ned if len(ne) < 40 and not re.search(r'[A-Za-z]', ned) else str(first_year(ne))
        st[iso] = r
        o = (g.get('International organization participation') or {}).get('text', '')
        orgs[iso] = [x for x in split_orgs(re.sub(r'<[^>]+>', '', o))]

    # --- V-Dem ---
    vd = load_vdem(a.cache)
    vd = vd[vd['year'] >= Y0]
    Y1 = int(vd['year'].max())
    years = list(range(Y0, Y1 + 1))
    data = {}
    def put(iso, code, y, v):
        if iso not in ISO or v is None: return
        arr = data.setdefault(iso, {}).setdefault(code, [None] * len(years))
        arr[y - Y0] = v
    for _, r in vd.iterrows():
        iso, y = r['country_text_id'], int(r['year'])
        for col, code in VD:
            v = r[col]
            if v != v: continue
            put(iso, code, y, int(v) if code == 'VREG' else round(float(v), 3))
    # --- Freedom House ---
    fs, fc = load_fh(a.fh)
    FH1 = max(y for _, y in fs)
    for (iso, y), v in fs.items():
        if Y0 <= y <= Y1: put(iso, 'FHST', y, v)
    for (iso, y), v in fc.items():
        if Y0 <= y <= Y1: put(iso, 'FHSC', y, v)

    # --- блоки ---
    blocs = []
    for b in BLOCS:
        full = [i for i in b['full'] if i in ISO]
        mid = [i for i in b['mid'] if i in ISO]
        miss = [i for i in b['full'] + b['mid'] if i not in ISO]
        # перекрёстная проверка с Factbook
        key = FB_ORG[b['id']]
        fbf = {i for i, t in orgs.items() if any(x == key for x in t)}
        if fbf:
            print('%-6s сверка с Factbook: только у нас %s | только в Factbook %s' % (b['id'], sorted(set(full) - fbf), sorted(fbf - set(full))))
        if miss: print('  нет на карте:', miss)
        out = {k: b[k] for k in ('id', 'name', 'en', 'mid_label', 'src', 'url', 'asof')}
        out.update(full=full, mid=mid, notes={k: v for k, v in b['notes'].items() if k in ISO})
        blocs.append(out)

    # описание полей
    res = {
        'updated': datetime.date.today().isoformat(), 'years': years, 'vdem_last': Y1, 'fh_last': FH1, 'factbook_asof': fb_asof,
        'data': data, 'st': st, 'blocs': blocs,
        'src': {
            'vdem': 'V-Dem, набор данных v16 (Varieties of Democracy, Университет Гётеборга), CC BY-SA 4.0',
            'fh': 'Freedom House, «Свобода в мире» (Freedom in the World): таблицы пакета freedomhouse (pachadotdev/freedomhouse), лицензия CC0',
            'fb': 'CIA World Factbook (factbook/factbook.json), состояние на ' + fb_asof,
        },
    }
    with open(a.out, 'w') as f: json.dump(res, f, ensure_ascii=False, separators=(',', ':'))
    print('готово:', a.out, os.path.getsize(a.out) // 1024, 'КБ; стран в рядах', len(data), 'в справке', len(st), 'годы', years[0], '–', Y1, 'FH до', FH1)

if __name__ == '__main__':
    main()
