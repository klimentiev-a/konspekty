#!/usr/bin/env python3
"""Сборка «Аналитика эмитента»: src/emitent/emitent.html → emitent.html (корень сайта).
Вставляет замок Артёма (src/finance/gate_artem.html) и версию из sw.js."""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
gate = open(os.path.join(ROOT, "src", "finance", "gate_artem.html"), encoding="utf-8").read().strip()
sw = open(os.path.join(ROOT, "sw.js"), encoding="utf-8").read()
ver = (re.search(r"const V = 'hub-v(\d+)'", sw) or [0, "0"])[1]
s = open(os.path.join(ROOT, "src", "emitent", "emitent.html"), encoding="utf-8").read()
assert "<!--GATE-->" in s
s = s.replace("<!--GATE-->", gate).replace("__V__", ver)
open(os.path.join(ROOT, "emitent.html"), "w", encoding="utf-8").write(s)
print(f"ok emitent (v{ver})")
