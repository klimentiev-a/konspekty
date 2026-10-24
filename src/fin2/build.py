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
    s = s.replace("<!--GATE-->", gate).replace("__V__", ver)
    open(os.path.join(OUT, name), "w", encoding="utf-8").write(s)
print(f"ok fin2 (v{ver})")
