#!/usr/bin/env python3
"""Страница «Рынок: что шарить» (rynok.html): вкладки Главное · Цены · Россия · Мир · Компании · Новости · Календарь.
src/rynok/content.json (разбор и источники) + common.js + page.html → rynok.html. Цены и новости — живьём из markets.json и news.json.
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
pages = [("page.html", "rynok.html")]
for src, out in pages:
    s = rd(SRC, src)
    for tag in ("<!--GATE-->", "<!--ZOOM-->"):
        assert tag in s, (src, tag)
    s = s.replace("<!--GATE-->", gate).replace("<!--ZOOM-->", zoom).replace("<!--COMMON-->", common)
    open(os.path.join(ROOT, out), "w", encoding="utf-8").write(s)
print("ok rynok: " + ", ".join(o for _, o in pages))
