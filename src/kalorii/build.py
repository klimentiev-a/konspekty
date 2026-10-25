# Калории: src/kalorii/template.html → kalorii.html (замок Артёма + zoom.js)
import os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
rd = lambda *p: open(os.path.join(ROOT, *p), encoding='utf-8').read()
t = rd('src', 'kalorii', 'template.html')
t = t.replace('<!--GATE-->', rd('src', 'finance', 'gate_artem.html').strip()).replace('/*ZOOM*/', rd('src', 'finance', 'zoom.js'))
open(os.path.join(ROOT, 'kalorii.html'), 'w', encoding='utf-8').write(t)
print('ok kalorii')
