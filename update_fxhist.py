#!/usr/bin/env python3
"""История официальных курсов ЦБ РФ (fxhist.json) для вкладки «Валюты» на сайте.
Формат: {"dates": ["2026-09-01", ...], "v": {"USD": [81.2, ...], ...}} — курс за 1 единицу валюты в рублях,
значения выровнены с dates (None — нет данных). Берём архив cbr-xml-daily.ru; за запуск докачиваем не более 45 пропущенных дней
(за несколько часовых запусков история заполнится), хранится последние 400 дней. Без сети/при ошибке файл не портится."""
import json, sys, datetime, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (hub-bot)'}
BASE = 'https://www.cbr-xml-daily.ru/'
DAYS, MAXFETCH = 400, 45

def get(url, t=12):
    r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=t)
    return json.loads(r.read().decode('utf-8'))

try:
    H = json.load(open('fxhist.json'))
    rows = {d: {c: H['v'][c][i] for c in H['v']} for i, d in enumerate(H['dates'])}
except Exception:
    rows = {}

def add(j):
    d = j['Date'][:10]
    rows[d] = {c: round(v['Value'] / (v.get('Nominal') or 1), 6) for c, v in j['Valute'].items()}

try:
    add(get(BASE + 'daily_json.js'))
except Exception as e:
    print('fxhist сегодня:', e, file=sys.stderr)

today = datetime.date.today()
fetched = misses = 0
for k in range(0, 160):
    if fetched >= MAXFETCH or misses > 25: break
    d = today - datetime.timedelta(days=k)
    ds = d.isoformat()
    if ds in rows or d.weekday() >= 5: continue      # выходные: ЦБ курсы не публикует отдельно
    try:
        add(get(BASE + 'archive/%d/%02d/%02d/daily_json.js' % (d.year, d.month, d.day)))
        fetched += 1
    except Exception:
        misses += 1                                   # праздники и 404 — пропускаем

if not rows:
    print('fxhist: данных нет, файл не меняю', file=sys.stderr); sys.exit(0)
dates = sorted(rows)[-DAYS:]
codes = sorted({c for d in dates for c in rows[d]})
out = {'dates': dates, 'v': {c: [rows[d].get(c) for d in dates] for c in codes}}
json.dump(out, open('fxhist.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('fxhist: %d дней, %d валют, докачано %d' % (len(dates), len(codes), fetched))
