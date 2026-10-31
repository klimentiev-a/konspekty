#!/usr/bin/env python3
"""Страница «Рынок: что шарить» — 5 вариантов оформления одного содержания.
src/rynok/content.json (факты, источники) + common.js + vN.html → rynok-N.html, index.html → rynok.html.
Вставляет замок Артёма (gate_artem.html) и zoom.js (масштаб, «Наверх», «Назад», service worker)."""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "src", "rynok")


def rd(*p):
    return open(os.path.join(*p), encoding="utf-8").read()


gate = rd(ROOT, "src", "finance", "gate_artem.html").strip()
zoom = "<script>" + rd(ROOT, "src", "finance", "zoom.js") + "</script>"
data = json.loads(rd(SRC, "content.json"))
common = "<script>" + rd(SRC, "common.js").replace(
    "/*DATA*/", json.dumps(data, ensure_ascii=False).replace("</", "<\\/")) + "</script>"
pages = [("index.html", "rynok.html")] + [("v%d.html" % i, "rynok-%d.html" % i) for i in range(1, 6)]
for src, out in pages:
    s = rd(SRC, src)
    for tag in ("<!--GATE-->", "<!--ZOOM-->"):
        assert tag in s, (src, tag)
    s = s.replace("<!--GATE-->", gate).replace("<!--ZOOM-->", zoom).replace("<!--COMMON-->", common)
    open(os.path.join(ROOT, out), "w", encoding="utf-8").write(s)
print("ok rynok: " + ", ".join(o for _, o in pages))
