# Калории (отдельное приложение, не часть Hub): src/kalorii/template.html →
#   kalorii/index.html (страница на сайте: приложение открывает её, обновляется без переустановки; в Hub не показывается)
#   android-kalorii/app/src/main/assets/index.html (встроенная копия для работы без сети)
import os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
t = open(os.path.join(ROOT, 'src', 'kalorii', 'template.html'), encoding='utf-8').read()
import time
t = t.replace('__BUILD__', str(int(time.time())))
for d in (os.path.join(ROOT, 'kalorii'), os.path.join(ROOT, 'android-kalorii', 'app', 'src', 'main', 'assets')):
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'index.html'), 'w', encoding='utf-8').write(t)
print('ok kalorii (приложение)')
