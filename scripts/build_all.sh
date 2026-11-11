#!/usr/bin/env bash
# Собирает все страницы сайта из исходников:
#   src/finance/hub.html + make_hub.py      → index.html, artem.html, nastya.html, nastya-ucheba.html, nastya-klava.html (+ замок для Артема)
#   src/index.src.html + make_ucheba.py     → ucheba.html
#   src/finance/content/*.md + шаблон       → finance.html
#   src/english/lessons|ref/*.md + шаблон   → english.html (курс английского)
#   src/fin2/*.html (шаблоны)              → fin2/index.html, fin2/akcii.html (Финансы 2: облигации и акции)
#   старые адреса (politika, energy, rynok, slovar) → страницы-переадресации
set -e
cd "$(git rev-parse --show-toplevel)"
python3 src/lectures/build.py
python3 src/pytrainer/build.py
python3 src/finance/make_hub.py
python3 src/finance/make_ucheba.py src/index.src.html ucheba.html
python3 src/finance/build_finance.py src/finance/content src/marked.min.js finance.html
python3 src/english/build_english.py
python3 src/fin2/build.py
python3 src/finance/make_search.py
# Страницы, которых больше нет: переадресация на новые адреса (закладки и старые ссылки продолжают работать)
python3 - <<'PY'
R={'politika.html':'artem.html','energy.html':'artem.html','rynok.html':'finance.html#markets','slovar.html':'search.html','bootcamp.html':'ucheba.html#ai-1','fin-english.html':'artem.html','istoriya.html':'artem.html'}
for f,to in R.items():
    open(f,'w',encoding='utf-8').write('<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url='+to+'"><script>location.replace("'+to+'"+(location.search||"")'+('' if '#' in to else '+location.hash')+')</script><title>Переадресация</title></head><body><a href="'+to+'">'+to+'</a></body></html>')
print('ok переадресации', ', '.join(R))
PY
# Синхронизация прогресса между устройствами: подключаем sync.js первым скриптом (идемпотентно)
python3 - <<'PY'
import re
for f in ['index.html','artem.html','nastya.html','nastya-ucheba.html','nastya-klava.html','ucheba.html','finance.html','english.html']:
    s = open(f, encoding='utf-8').read()
    if 'src="tables.js"' not in s:
        s = s.replace('<meta charset="utf-8">', '<meta charset="utf-8"><script src="tables.js"></script>', 1)
    if 'src="sync.js"' in s:
        open(f, 'w', encoding='utf-8').write(s); continue
    s2 = s.replace('<meta charset="utf-8">', '<meta charset="utf-8"><script src="sync.js"></script>', 1)
    assert s2 != s, f
    open(f, 'w', encoding='utf-8').write(s2)
print('ok sync.js подключён')
PY
