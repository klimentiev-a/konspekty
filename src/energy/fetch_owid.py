#!/usr/bin/env python3
"""Скачивает owid-energy-data.csv (Our World in Data, на основе Energy Institute Statistical Review)
и сохраняет компактный срез за 2024 год в src/energy/owid_energy_2024.json.
Запуск: python3 src/energy/fetch_owid.py  (сборка energy.html читает готовый JSON и не ходит в сеть)."""
import csv, io, json, os, urllib.request

URL = 'https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv'
YEAR = '2024'
HERE = os.path.dirname(os.path.abspath(__file__))
FIELDS = ['population', 'oil_production', 'oil_consumption', 'gas_production', 'gas_consumption',
          'oil_share_energy', 'gas_share_energy', 'energy_per_capita', 'primary_energy_consumption']

raw = urllib.request.urlopen(URL, timeout=120).read().decode('utf-8')
rows = list(csv.DictReader(io.StringIO(raw)))
out, names = {}, {}
for r in rows:
    iso = r['iso_code']
    if len(iso) != 3 or iso.startswith('OWID'):
        continue
    names[r['country']] = iso
    if r['year'] != YEAR:
        continue
    rec = {}
    for f in FIELDS:
        v = r[f]
        if v != '':
            rec[f] = round(float(v), 3)
    if rec:
        out[iso] = rec
json.dump({'year': int(YEAR), 'source': 'Energy Institute Statistical Review of World Energy через Our World in Data (owid/energy-data)',
           'data': out, 'names_en': names}, open(os.path.join(HERE, 'owid_energy_2024.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))
print('ok', len(out), 'стран с данными за', YEAR, ';', len(names), 'названий')
