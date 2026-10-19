"""Данные по странам для слоя «Страны» на карте нефти и газа (energy.html).
COUNTRIES[iso3] = компактная запись. Собирается из:
  - цен на бензин (objects.GAS_PRICES, по названиям на русском → ISO3 через world/countries.json);
  - цен на дизель (ниже, срезы GlobalPetrolPrices разных дат: для каждой страны берётся самая свежая);
  - Energy Institute Statistical Review за 2024 через Our World in Data (owid_energy_2024.json, src/energy/fetch_owid.py);
  - объектов с карты (НПЗ, СПГ, месторождения, порты).
Единицы: нефть — млн т/год (1 млн т нефт. экв. = 11,63 ТВт·ч), газ — млрд м³ (1 млрд м³ = 10 ТВт·ч, как в Statistical Review)."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

# --- дизель, $ за литр, GlobalPetrolPrices ---
# срез 20.04.2026: рейтинг «100 самых дорогих» (statranker.org)
DIESEL_APR = ('20.04.2026', [
    ('Hong Kong', 4.62), ('Malawi', 3.85), ('Singapore', 3.27), ('Netherlands', 2.88), ('Liechtenstein', 2.78),
    ('Switzerland', 2.77), ('Denmark', 2.74), ('Finland', 2.67), ('France', 2.64), ('Albania', 2.63),
    ('Israel', 2.63), ('Monaco', 2.60), ('United Kingdom', 2.58), ('Ireland', 2.54), ('Lithuania', 2.53),
    ('Germany', 2.51), ('Belgium', 2.49), ('Italy', 2.47), ('Norway', 2.42), ('Croatia', 2.34),
    ('Portugal', 2.31), ('Estonia', 2.31), ('Iceland', 2.30), ('Austria', 2.29), ('Greece', 2.29),
    ('Sweden', 2.27), ('Latvia', 2.25), ('New Zealand', 2.25), ('Central African Republic', 2.24),
    ('Cyprus', 2.21), ('Czech Republic', 2.20), ('Bosnia and Herzegovina', 2.18), ('Serbia', 2.17),
    ('Laos', 2.17), ('San Marino', 2.16), ('Zimbabwe', 2.09), ('Poland', 2.09), ('Bulgaria', 2.07),
    ('Andorra', 2.07), ('Burma', 2.07), ('Luxembourg', 2.06), ('Slovakia', 2.06), ('Philippines', 2.05),
    ('Spain', 2.04), ('Slovenia', 2.04), ('Sierra Leone', 2.03), ('Ukraine', 2.03), ('Hungary', 1.99),
    ('Montenegro', 1.98), ('Romania', 1.98), ('Belize', 1.91), ('Peru', 1.89), ('Botswana', 1.87),
    ('Australia', 1.85), ('Lesotho', 1.85), ('North Macedonia', 1.79), ('Moldova', 1.74), ('South Africa', 1.74),
    ('Haiti', 1.72), ('Mali', 1.69), ('Morocco', 1.67), ('Argentina', 1.65), ('Mongolia', 1.65),
    ('Mexico', 1.63), ('Chile', 1.61), ('Turkey', 1.60), ('Nepal', 1.59), ('Armenia', 1.58),
    ('Zambia', 1.57), ('Barbados', 1.57), ('Canada', 1.55), ('Mauritius', 1.54), ('Swaziland', 1.53),
    ('Kenya', 1.52), ('South Korea', 1.51), ('Malaysia', 1.51), ('Rwanda', 1.51), ('Cameroon', 1.49),
    ('Brazil', 1.48), ('Georgia', 1.48), ('Seychelles', 1.47), ('Liberia', 1.46), ('Tanzania', 1.46),
    ('Guatemala', 1.46), ('Ghana', 1.46), ('Bahamas', 1.44), ('Namibia', 1.43), ('United States', 1.43),
    ('Suriname', 1.42), ('Malta', 1.42), ('Cambodia', 1.42), ('Jamaica', 1.42), ('Bolivia', 1.42),
    ('Sri Lanka', 1.40), ('Grenada', 1.38), ('Uganda', 1.37), ('Panama', 1.37)])
# срез 01.06.2026 (highwayandheavyparts.com, таблица по данным GlobalPetrolPrices)
DIESEL_JUN = ('01.06.2026', [
    ('Venezuela', 0.004), ('Iran', 0.006), ('Libya', 0.024), ('Algeria', 0.233), ('Turkmenistan', 0.285),
    ('Japan', 0.991), ('India', 1.02), ('United Arab Emirates', 1.17), ('Brazil', 1.36), ('United States', 1.41),
    ('Canada', 1.48), ('Mexico', 1.56), ('Germany', 2.16), ('Switzerland', 2.69), ('Liechtenstein', 2.73),
    ('Singapore', 3.04), ('Malawi', 3.85), ('Hong Kong', 4.59)])
# страницы стран на globalpetrolprices.com/<страна>/diesel_prices/ (дата — как на странице)
DIESEL_PAGES = [
    ('Russia', 1.00, '09.02.2026'), ('China', 0.93, '09.02.2026'), ('Saudi Arabia', 0.48, '09.02.2026'),
    ('Kazakhstan', 0.59, '09.02.2026'), ('Kuwait', 0.38, '09.02.2026'), ('Qatar', 0.52, '09.02.2026'),
    ('Nigeria', 0.67, '09.02.2026'), ('Egypt', 0.39, '09.03.2026'), ('Indonesia', 0.82, '12.01.2026'),
    ('Vietnam', 0.72, '09.02.2026'), ('Thailand', 0.96, '09.02.2026'), ('Pakistan', 0.96, '09.02.2026'),
    ('Belarus', 0.89, '12.01.2026'), ('Azerbaijan', 0.647, '09.02.2026'), ('Oman', 0.67, '09.02.2026'),
    ('Angola', 0.436, '09.02.2026'), ('Colombia', 0.79, '09.02.2026'), ('Uzbekistan', 1.016, '09.03.2026'),
    ('Bangladesh', 0.94, '04.05.2026')]

EN_FIX = {'Burma': 'MMR', 'Swaziland': 'SWZ', 'Czech Republic': 'CZE', 'Laos': 'LAO', 'Macedonia': 'MKD',
          'Turkey': 'TUR', 'Moldova': 'MDA', 'Hong Kong': 'HKG', 'Monaco': 'MCO', 'San Marino': 'SMR',
          'Andorra': 'AND', 'Liechtenstein': 'LIE', 'Russia': 'RUS', 'South Korea': 'KOR', 'Vietnam': 'VNM',
          'Syria': 'SYR', 'Iran': 'IRN', 'Venezuela': 'VEN', 'Tanzania': 'TZA', 'Bolivia': 'BOL'}


# названия из objects.py, которые пишутся иначе, чем в world/countries.json
RU_FIX = {'Доминиканская Республика': 'DOM', 'Каймановы острова': 'CYM', 'Кот-д’Ивуар': 'CIV'}
SHARED = {'Катар и Иран': ['QAT', 'IRN']}   # общее месторождение: считаем в обеих странах


def _d(s):
    d, m, y = s.split('.')
    return (int(y), int(m), int(d))


def build(objects, gas_prices):
    geo = json.load(open(os.path.join(ROOT, 'world', 'countries.json'), encoding='utf-8'))
    ru2iso = {g['properties']['name']: g['properties']['iso3'] for g in geo['objects']['countries']['geometries']}
    isos = set(ru2iso.values())
    ow = json.load(open(os.path.join(HERE, 'owid_energy_2024.json'), encoding='utf-8'))
    en2iso = dict(ow['names_en']); en2iso.update(EN_FIX)
    ru2iso.update({k: v for k, v in RU_FIX.items() if v in isos})
    iso2ru = {v: k for k, v in ru2iso.items() if k not in RU_FIX}
    miss = []
    C = {}

    def rec(iso):
        return C.setdefault(iso, {'n': iso2ru[iso]})

    # бензин
    for name, price, date in gas_prices:
        iso = ru2iso.get(name)
        if not iso: miss.append(('бензин', name)); continue
        rec(iso)['g'] = [round(price, 3), date]
    # дизель: самая свежая дата
    cand = {}
    def add(en, price, date):
        iso = en2iso.get(en)
        if not iso or iso not in isos: miss.append(('дизель', en)); return
        if iso not in cand or _d(date) > _d(cand[iso][1]): cand[iso] = (price, date)
    for en, p in DIESEL_APR[1]: add(en, p, DIESEL_APR[0])
    for en, p in DIESEL_JUN[1]: add(en, p, DIESEL_JUN[0])
    for en, p, dt in DIESEL_PAGES: add(en, p, dt)
    for iso, (p, dt) in cand.items(): rec(iso)['d'] = [round(p, 3), dt]
    # энергетика (2024)
    for iso, o in ow['data'].items():
        if iso not in isos: continue
        r = rec(iso)
        if 'population' in o: r['pop'] = round(o['population'])
        if 'oil_production' in o: r['op'] = round(o['oil_production'] / 11.63, 1)
        if 'oil_consumption' in o: r['oc'] = round(o['oil_consumption'] / 11.63, 1)
        if 'gas_production' in o: r['gp'] = round(o['gas_production'] / 10, 1)
        if 'gas_consumption' in o: r['gc'] = round(o['gas_consumption'] / 10, 1)
        if 'oil_share_energy' in o: r['os'] = round(o['oil_share_energy'], 1)
        if 'gas_share_energy' in o: r['gs'] = round(o['gas_share_energy'], 1)
        if 'energy_per_capita' in o: r['epc'] = round(o['energy_per_capita'] / 1000, 1)  # МВт·ч на человека
        if 'primary_energy_consumption' in o: r['pe'] = round(o['primary_energy_consumption'])
    # объекты с карты
    for o in objects:
        targets = SHARED.get(o['c']) or ([ru2iso[o['c']]] if o['c'] in ru2iso else [])
        if not targets: miss.append(('объект', o['c'])); continue
        for iso in targets:
            r = rec(iso); ob = r.setdefault('ob', {'ref': [0, 0], 'lng': [0, 0], 'field': 0, 'port': 0, 'ids': []})
            t = o['t']
            if t == 'ref': ob['ref'][0] += 1; ob['ref'][1] += o.get('v') or 0
            elif t == 'lng': ob['lng'][0] += 1; ob['lng'][1] += o.get('v') or 0
            elif t == 'field': ob['field'] += 1
            elif t == 'port': ob['port'] += 1
            ob['ids'].append(o['id'])
    # убираем страны без единого значения, кроме названия и населения
    for iso in list(C):
        if set(C[iso]) <= {'n', 'pop'}:
            del C[iso]
    return C, sorted(set(miss)), ow['source'], ow['year']
