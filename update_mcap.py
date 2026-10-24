#!/usr/bin/env python3
"""Снимок рыночной капитализации компаний для «Рейтинга компаний мира» → world/mcap.json.
Обновляется раз в 3 дня, а при жёстких новостях — сразу (не чаще раза в 6 часов):
  • индекс Мосбиржи, S&P 500 или Nasdaq за день ±3% и больше;
  • новость с важностью imp ≥ 18 за последние 2 часа с «жёстким» словом (санкции, ставка, обвал, дефолт…).
Источник: companiesmarketcap.com (топ-500 мира, страницы 1–5); российские компании — капитализация Мосбиржи из markets.json.
Если страницы не загрузились или разметка изменилась (меньше 300 строк) — старый файл остаётся как есть."""
import json, glob, os, re, sys, time, unicodedata, urllib.request
from datetime import datetime, timezone, timedelta

OUT = 'world/mcap.json'
EVERY = timedelta(days=3)
MIN_TRIGGER_GAP = timedelta(hours=6)
HARD = re.compile(r'санкц|ставк[аиу] цб|ключев\w+ ставк|обвал|крах|дефолт|рухн|обруш|взлет|sanction|crash|plunge|plummet|surge|default|rate (cut|hike)', re.I)

# Компании, у которых тикера в списке нет или он другой (проверено вручную): слой|название → тикер на companiesmarketcap
MAN = """ae|ADNOC Gas|ADNOCGAS.AE
ae|TAQA (Abu Dhabi National Energy)|TAQA.AE
ae|Emirates NBD|EMIRATESNBD.AE
ae|First Abu Dhabi Bank|FAB.AE
ae|e& (Emirates Telecommunications Group)|EAND.AE
br|Petrobras|PBR
br|Vale|VALE
br|Itaú Unibanco|ITUB
br|Ambev|ABEV
br|BTG Pactual|BPAC3.SA
ch|Glencore|GLCNF
ch|Roche|RO.SW
ch|Novartis|NVS
ch|UBS|UBS
cn|ICBC|1398.HK
cn|Agricultural Bank of China|601288.SS
cn|China Construction Bank|601939.SS
cn|Bank of China|601988.SS
cn|Ping An Insurance|601318.SS
cn|Alibaba Group|BABA
cn|Tencent|TCEHY
cn|Bank of Communications|601328.SS
cn|Industrial Bank|601166.SS
cn|Xiaomi|XIACF
cn|Zijin Mining|601899.SS
cn|Luxshare Precision|002475.SZ
de|SAP|SAP
de|Rheinmetall|RHM.F
de|Siemens Energy|ENR.F
de|Deutsche Bank|DB
es|Santander|SAN
fr|TotalEnergies|TTE
fr|Sanofi|SNY
gb|Shell|SHEL
gb|BP|BP
gb|HSBC|HSBC
gb|Lloyds Banking Group|LYG
gb|Barclays|BCS
gb|Unilever|UL
gb|AstraZeneca|AZN
gb|Rio Tinto|RIO
gb|GSK|GSK
gb|NatWest Group|NWG
gb|British American Tobacco|BTI
gb|Diageo|DEO
gb|RELX|RELX
gb|National Grid|NGG
in|ICICI Bank|IBN
in|Infosys|INFY
it|Eni|E
it|Ferrari|RACE
jp|Toyota Motor|TM
jp|Sony Group|SONY
jp|Mizuho Financial Group|MFG
jp|Takeda|TAK
nl|ASML|ASML
nl|ING|ING
se|Volvo|VOLV-A.ST
se|Atlas Copco|ATCO-B.ST"""
MAN = {(a, b): c for a, b, c in (x.split('|') for x in MAN.split('\n'))}
ALIAS = {'GOOGL': 'GOOG', 'BRK.B': 'BRK-B'}


def now(): return datetime.now(timezone.utc)


def load(p, d=None):
    try: return json.load(open(p, encoding='utf-8'))
    except Exception: return d


def decide(old):
    force = '--force' in sys.argv
    if force: return 'вручную'
    if not old or not old.get('t'): return 'первый снимок'
    t = datetime.fromisoformat(old['t'])
    age = now() - t
    if age >= EVERY: return 'прошло 3 дня'
    if age < MIN_TRIGGER_GAP: return None
    m = load('markets.json', {}) or {}
    for k, grp in (('IMOEX', 'idx'), ('^GSPC', 'us'), ('^IXIC', 'us')):
        ch = ((m.get(grp) or {}).get(k) or {}).get('ch')
        if ch is not None and abs(ch) >= 3: return 'индекс %s %+.1f%% за день' % (k, ch)
    n = (load('news.json', {}) or {}).get('items', [])
    lim = now() - timedelta(hours=2)
    for x in n:
        try:
            if int(x.get('imp') or 0) >= 18 and HARD.search(x.get('t', '')) and datetime.fromisoformat(x['d'].replace('Z', '+00:00')) >= lim:
                return 'жёсткая новость: ' + x['t'][:80]
        except Exception: pass
    return None


def fetch_cmc():
    rows = {}
    for p in range(1, 6):
        url = 'https://companiesmarketcap.com/' + ('' if p == 1 else 'page/%d/' % p)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'Accept-Language': 'en'})
        try: html = urllib.request.urlopen(req, timeout=40).read().decode('utf-8', 'replace')
        except Exception as e:
            print('страница', p, 'не загрузилась:', e); continue
        for m in re.finditer(r'class="company-name">([^<]+)</div>\s*<div class="company-code">(?:<span[^>]*></span>)?([^<]+)</div>.*?<td class="td-right" data-sort="(\d+)"', html, re.S):
            tk = m.group(2).strip().upper(); v = int(m.group(3)) / 1e9
            if v > 0: rows.setdefault(tk, round(v, 2))
        time.sleep(1.5)
    return rows


def main():
    old = load(OUT)
    why = decide(old)
    if not why: print('капитализация: обновление не нужно'); return
    print('капитализация: обновляю —', why)
    cap = fetch_cmc()
    if len(cap) < 300: print('::warning::companiesmarketcap: получено %d строк, файл не меняю' % len(cap)); return
    mk = load('markets.json', {}) or {}
    usd = ((mk.get('fx') or {}).get('Valute') or {}).get('USD')
    rub = usd['Value'] / usd['Nominal'] if usd else None
    out = {}
    for f in sorted(glob.glob('world/companies/??.json')):
        L = os.path.basename(f)[:2]
        for c in load(f, {}).get('items', []):
            t = (c.get('ticker') or '').upper(); v = None
            if L == 'ru':
                r = (mk.get('ru') or {}).get(t.split('.')[0]) if t else None
                if r and r.get('cap') and rub: v = round(r['cap'] / rub, 1)
            else:
                k = MAN.get((L, c['name'])) or ALIAS.get(t, t)
                v = cap.get(k.upper()) if k else None
            if v: out[L + '|' + c['name']] = v
    if len(out) < 200: print('::warning::сопоставилось только %d компаний, файл не меняю' % len(out)); return
    n = now()
    res = {'t': n.isoformat(timespec='seconds'), 'asof': (n + timedelta(hours=3)).strftime('%Y-%m-%d'), 'why': why,
           'src': 'companiesmarketcap.com (топ-500 мира); российские — Мосбиржа, пересчёт по курсу ЦБ' + (' %.2f ₽' % rub if rub else ''), 'c': out}
    json.dump(res, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('капитализация: записано', len(out), 'компаний')


main()
