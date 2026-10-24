#!/usr/bin/env python3
"""Сборка страниц «Финансы 2»: src/fin2/{index,akcii}.html → fin2/{index,akcii}.html.
Вставляет замок Артёма (src/finance/gate_artem.html, его делает make_hub.py) и версию
файлов (?v=) из sw.js, чтобы после выпуска браузер взял свежие скрипты."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "src", "fin2")
OUT = os.path.join(ROOT, "fin2")
gate = open(os.path.join(ROOT, "src", "finance", "gate_artem.html"), encoding="utf-8").read().strip()
sw = open(os.path.join(ROOT, "sw.js"), encoding="utf-8").read()
m = re.search(r"const V = 'hub-v(\d+)'", sw)
ver = m.group(1) if m else "0"
for name in ("index.html", "akcii.html"):
    s = open(os.path.join(SRC, name), encoding="utf-8").read()
    assert "<!--GATE-->" in s, name
    # страница лежит в подпапке fin2/: вход — ../index.html, обратно — fin2/<страница>
    g = gate.replace("location.replace('index.html?login='+P+'&next='+encodeURIComponent(f+location.search+location.hash))",
                     "location.replace('../index.html?login='+P+'&next='+encodeURIComponent('fin2/'+f+location.search+location.hash))")
    assert g != gate, "замок изменился — поправь build.py"
    s = s.replace("<!--GATE-->", g).replace("__V__", ver)
    open(os.path.join(OUT, name), "w", encoding="utf-8").write(s)
print(f"ok fin2 (v{ver})")
