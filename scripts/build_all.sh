#!/usr/bin/env bash
# Собирает все страницы сайта из исходников:
#   src/finance/hub.html + make_hub.py      → index.html, artem.html, nastya.html, nastya-ucheba.html (+ замок для Артема)
#   src/index.src.html + make_ucheba.py     → ucheba.html
#   src/finance/content/*.md + шаблон       → finance.html
#   src/english/lessons|ref/*.md + шаблон   → english.html (курс английского)
set -e
cd "$(git rev-parse --show-toplevel)"
python3 src/finance/make_hub.py
python3 src/finance/make_ucheba.py src/index.src.html ucheba.html
python3 src/finance/build_finance.py src/finance/content src/marked.min.js finance.html
python3 src/english/build_english.py
python3 src/energy/build_energy.py
python3 src/finance/make_search.py
# Синхронизация прогресса между устройствами: подключаем sync.js первым скриптом (идемпотентно)
python3 - <<'PY'
import re
for f in ['index.html','artem.html','nastya.html','nastya-ucheba.html','ucheba.html','finance.html','english.html','energy.html']:
    if f=='energy.html' and not __import__('os').path.exists(f): continue
    s = open(f, encoding='utf-8').read()
    if 'src="tables.js"' not in s:
        s = s.replace('<meta charset="utf-8">', '<meta charset="utf-8"><script src="tables.js"></script>', 1)
    if 'src="sync.js"' in s or f=='energy.html':
        open(f, 'w', encoding='utf-8').write(s); continue
    s2 = s.replace('<meta charset="utf-8">', '<meta charset="utf-8"><script src="sync.js"></script>', 1)
    assert s2 != s, f
    open(f, 'w', encoding='utf-8').write(s2)
print('ok sync.js подключён')
PY
