# Калории (отдельное приложение): src/kalorii/template.html → android-kalorii/app/src/main/assets/index.html
import os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
out = os.path.join(ROOT, 'android-kalorii', 'app', 'src', 'main', 'assets')
os.makedirs(out, exist_ok=True)
t = open(os.path.join(ROOT, 'src', 'kalorii', 'template.html'), encoding='utf-8').read()
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(t)
print('ok kalorii (приложение)')
