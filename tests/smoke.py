#!/usr/bin/env python3
"""Проверка сайта в настоящем браузере (Chromium): все страницы открываются без ошибок JavaScript,
ничего не вылезает за экран телефона, нет «undefined»/«NaN». Запуск: python3 tests/smoke.py [папка сайта]
Код выхода 1 — найдены проблемы (GitHub пришлёт письмо о неудачной проверке)."""
import sys, os, re, threading, functools, http.server, hashlib
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
PORT = 8799
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
B = 'http://127.0.0.1:%d/' % PORT

tok = lambda p, pw: hashlib.sha256(('hub:%s:%s' % (p, pw)).encode()).hexdigest()[:24]
src = open(os.path.join(ROOT, 'src', 'finance', 'make_hub.py'), encoding='utf-8').read()
prof = dict(re.findall(r"'(\w+)': \('[^']+', '(\d+)'", src))
AUTH = ';'.join("localStorage.setItem('hub:auth:%s','%s')" % (p, tok(p, pw)) for p, pw in prof.items())

PAGES = ['index.html', 'artem.html', 'nastya.html', 'nastya-ucheba.html',
         'ucheba.html', 'ucheba.html#schedule', 'ucheba.html#tickets', 'ucheba.html#session', 'ucheba.html#credits', 'ucheba.html#about',
         'finance.html', 'finance.html#home', 'finance.html#learn', 'finance.html#calc/npv', 'finance.html#calc/dcf', 'finance.html#calc/lbo',
         'finance.html#markets', 'finance.html#markets/news', 'finance.html#markets/ru', 'finance.html#markets/us',
         'finance.html#markets/crypto', 'finance.html#markets/bonds', 'finance.html#markets/fx', 'finance.html#markets/cal',
         'finance.html#markets/ru/SBER', 'finance.html#markets/us/NVDA', 'finance.html#markets/crypto/BTC', 'finance.html#markets/idx/IMOEX', 'finance.html#markets/daily', 'finance.html#markets/week', 'finance.html#markets/macro', 'finance.html#markets/divs', 'finance.html#markets/events', 'finance.html#markets/ru/VKCO', 'finance.html#markets/us/ASML.AS', 'finance.html#markets/us/7203.T', 'finance.html#markets/idx/^N225', 'deep.html', 'energy.html', 'search.html',
         'finance.html#world', 'english.html', 'english.html#words', 'english.html#words/list', 'english.html#ref', 'english.html#ref/vremena', 'finance.html#world/compare', 'finance.html#world/ranking', 'finance.html#world/life', 'finance.html#world/fav', 'finance.html#world/country/DEU', 'finance.html#world/companies', 'finance.html#world/ru-regions/Москва', 'finance.html#markets/week', 'finance.html#markets/macro', 'finance.html#markets/divs', 'finance.html#markets/events', 'finance.html#calc/yield', 'search.html', 'search.html?q=wacc', 'finance.html#world/sectors', 'finance.html#world/sectors/neft-gaz', 'finance.html#learn/marshrut', 'finance.html#learn/model-3-otchetov']
IGNORE = re.compile(r'Failed to fetch|NetworkError|Load failed|ResizeObserver')

problems = []
with sync_playwright() as p:
    br = p.chromium.launch()
    for vw, theme in (((390, 844), 'dark'), ((1280, 900), 'light')):
        ctx = br.new_context(viewport={'width': vw[0], 'height': vw[1]}, color_scheme=theme, service_workers='block')
        ctx.add_init_script("try{%s}catch(e){}" % AUTH)
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
        pg.goto(B + 'finance.html#learn'); pg.wait_for_timeout(800)
        chapters = sorted(set(pg.evaluate("Array.from(document.querySelectorAll('a[href^=\"#learn/\"]')).map(a=>a.getAttribute('href'))")))
        pg.goto(B + 'english.html'); pg.wait_for_timeout(600)
        lessons = sorted(set(pg.evaluate("Array.from(document.querySelectorAll('a[href^=\"#lesson/\"]')).map(a=>a.getAttribute('href'))")))
        for u in PAGES + ['finance.html' + h for h in chapters] + ['english.html' + h for h in lessons]:
            errs.clear()
            pg.goto(B + u); pg.wait_for_timeout(2500 if 'markets' in u else 700)
            bad = [e for e in errs if not IGNORE.search(e)]
            sw = pg.evaluate('document.documentElement.scrollWidth')
            txt = pg.inner_text('body')
            if bad: problems.append('%s [%d]: ошибка JS: %s' % (u, vw[0], bad[0]))
            if sw > vw[0] + 2: problems.append('%s [%d]: страница шире экрана (%d px)' % (u, vw[0], sw))
            if re.search(r'\bundefined\b|\bNaN\b', txt): problems.append('%s [%d]: в тексте undefined/NaN' % (u, vw[0]))
            if 'index.html?login=' in pg.url and 'index' not in u: problems.append('%s [%d]: не пустил замок паролем' % (u, vw[0]))
        ctx.close()
    br.close()
srv.shutdown()
print('Проверено страниц: %d × 2 размера экрана' % (len(PAGES) + len(chapters) + len(lessons)))
if problems:
    print('\n'.join('✗ ' + x for x in problems)); sys.exit(1)
print('✓ ошибок нет')
