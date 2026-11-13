#!/usr/bin/env python3
"""Скачивает расписание группы с hse.ru и сохраняет нужные пары в schedule.json.
Запускается GitHub Actions по расписанию (см. .github/workflows/schedule.yml)."""
import datetime, html, json, os, re, sys, urllib.parse, urllib.request

GROUP = "48037"
URL = ("https://www.hse.ru/ba/dlawyer/timetable?fromdate={a}&todate={b}&groupoid=" + GROUP +
       "&receiverType=3&timetable-courses=2&timetable-groups=" + GROUP + "&timetable-view-switcher=list")
# (часть названия дисциплины, id предмета на сайте или None)
KEEP = [("Гражданское право", "civil"), ("Конституционное право", "const"),
        ("Уголовное право", "crim"), ("Основы программирования на Python", "python")]
COURSE = "2 курс"  # поле parentschedule вида «ФП_Бак 2 курс Юриспруденция: цифровой юрист …»
KINDS = (("лекц", "Лекция"), ("семин", "Семинар"), ("практ", "Практика"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schedule.json")


DIAG = []


def fetch(a, b):
    local = os.environ.get("LOCAL_HTML")
    if local:
        return open(local, encoding="utf-8", errors="replace").read()
    req = urllib.request.Request(URL.format(a=a, b=b), headers={"User-Agent": "Mozilla/5.0 (konspekty schedule bot)", "Accept-Language": "ru"})
    with urllib.request.urlopen(req, timeout=40) as r:
        body = r.read().decode("utf-8", "replace")
        DIAG.append(f"HTTP {r.status} {r.geturl()}")
        return body


API_CANDIDATES = [
    "https://www.hse.ru/api/timetable/lessons?fromdate={a}&todate={b}&groupoid=" + GROUP + "&receiverType=3",
    "https://www.hse.ru/api/timetable/lessons?fromdate={a}&todate={b}&groupoid=" + GROUP + "&receiverType=3&timetable-courses=2&timetable-groups=" + GROUP,
    "https://ruz.hse.ru/api/schedule/group/" + GROUP + "?start={a}&finish={b}&lng=1",
]


def find_lessons(obj, acc=None):
    """Ищет в произвольном JSON словари-пары (с полем beginLesson)."""
    acc = [] if acc is None else acc
    if isinstance(obj, dict):
        if "beginLesson" in obj and "discipline" in obj:
            acc.append(obj)
        else:
            for v in obj.values():
                find_lessons(v, acc)
    elif isinstance(obj, list):
        for v in obj:
            find_lessons(v, acc)
    return acc


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (konspekty schedule bot)", "Accept": "application/json, text/html;q=0.8", "Accept-Language": "ru"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.status, r.read().decode("utf-8", "replace")


def convert(x):
    name = str(x.get("discipline", ""))
    hit = next((k for k in KEEP if k[0] in name), None)
    if not hit or not x.get("date") or not x.get("beginLesson"):
        return None
    if COURSE not in str(x.get("parentschedule", "")):
        return None
    kd = str(x.get("kindOfWork", "")).lower()
    kind = next((v for k, v in KINDS if k in kd), str(x.get("kindOfWork", "")))
    return {"d": str(x["date"]).replace(".", "-"), "b": x["beginLesson"], "e": x["endLesson"],
            "n": re.sub(r"\s*\((рус|анг)\)\s*$", "", name), "k": kind,
            "r": str(x.get("auditorium", "")), "s": hit[1], "t": x.get("lecturer_title") or x.get("lecturer") or "",
            "m": x.get("lecturerEmail") or "", "q": x.get("lecturer_rank") or "", "bd": x.get("building") or "",
            "g": x.get("group") or "", "u": x.get("url1") or ""}


def from_api(a, b):
    """Пробует JSON-эндпоинты; возвращает список пар или None."""
    for tpl in API_CANDIDATES:
        url = tpl.format(a=a, b=b)
        try:
            st, body = get(url)
        except Exception as e:
            DIAG.append(f"API {url} -> ОШИБКА {e!r}")
            continue
        DIAG.append(f"API {url} -> HTTP {st}, {len(body)} байт, начало: " + re.sub(r"\s+", " ", body[:300]))
        try:
            raw = find_lessons(json.loads(body))
        except ValueError:
            continue
        got = [c for c in map(convert, raw) if c]
        DIAG.append(f"    найдено пар в JSON: {len(raw)}, нужных: {len(got)}")
        if raw:
            return got
    return None


def discover(page):
    """Ищет в скриптах страницы адреса API (для диагностики)."""
    for src in re.findall(r'<script[^>]+src="([^"]+)"', page):
        if re.search(r"timetable", src, re.I):
            url = urllib.parse.urljoin("https://www.hse.ru/", src)
            try:
                st, js = get(url)
            except Exception as e:
                DIAG.append(f"JS {url} -> ОШИБКА {e!r}")
                continue
            urls = sorted(set(re.findall(r"""["'](/?(?:api|ajax)[^"'\s]{3,120})["']""", js)) | set(re.findall(r"""["']([^"'\s]*(?:lessons|timetable)[^"'\s]{0,100})["']""", js)))
            DIAG.append(f"JS {url} ({len(js)} байт), адреса: {urls[:25]}")


def parse(page):
    out = []
    for raw in re.findall(r'data-lesson-source="([^"]*)"', page):
        try:
            c = convert(json.loads(html.unescape(raw)))
        except ValueError:
            continue
        if c:
            out.append(c)
    return out


def main():
    today = datetime.date.today()
    monday = today - datetime.timedelta(days=today.weekday())
    lessons, ok = [], 0
    for w in range(26):  # эта неделя и ещё 25 вперёд (~полгода)
        a = monday + datetime.timedelta(days=7 * w)
        b = a + datetime.timedelta(days=6)
        try:
            api = None if os.environ.get("LOCAL_HTML") else from_api(a.strftime("%Y.%m.%d"), b.strftime("%Y.%m.%d"))
            if api is not None:
                print(f"{a}..{b}: через API, нужных пар {len(api)}")
                lessons += api
                ok += 1
                continue
            page = fetch(a.strftime("%Y.%m.%d"), b.strftime("%Y.%m.%d"))
            if w == 0 and not os.environ.get("LOCAL_HTML"):
                discover(page)
            got = parse(page)
            print(f"{a}..{b}: страница {len(page)} байт, пар найдено {len(got)}")
            t = re.search(r"<title>(.*?)</title>", page, re.S)
            DIAG.append(f"{a}..{b}: {len(page)} байт; title={t.group(1).strip()[:120] if t else None}; lesson-node={page.count('lesson-node')}; lesson-source={page.count('data-lesson-source')}; пар={len(got)}")
            if not got:
                DIAG.append("начало страницы: " + re.sub(r"\s+", " ", page[:400]))
            lessons += got
            ok += 1
        except Exception as e:  # не роняем workflow
            print(f"{a}..{b}: ошибка {e!r}")
            DIAG.append(f"{a}..{b}: ОШИБКА {e!r}")
        if os.environ.get("LOCAL_HTML"):
            break
    open(os.path.join(os.path.dirname(OUT), "schedule_debug.txt"), "w", encoding="utf-8").write("\n".join(DIAG) + "\n")
    if not ok or not lessons:
        print("Не удалось получить пары — schedule.json не менялся.")
        return 0
    # Недели, по которым вышка вернула пусто (расписание сняли или обновляют), не стираем:
    # оставляем прежние пары этих недель, чтобы сайт не терял расписание.
    def wk(ds):
        d0 = datetime.date.fromisoformat(ds)
        return d0 - datetime.timedelta(days=d0.weekday())
    try:
        prev = json.load(open(OUT, encoding="utf-8")).get("list") or []
    except Exception:
        prev = []
    got_weeks = {wk(l["d"]) for l in lessons}
    kept = [l for l in prev if wk(l["d"]) not in got_weeks]
    if kept and not os.environ.get("LOCAL_HTML"):
        print(f"Сохранено прежних пар за недели, где вышка вернула пусто: {len(kept)}")
        lessons = lessons + kept
    seen, uniq = set(), []
    for l in sorted(lessons, key=lambda l: (l["d"], l["b"], l["n"])):
        key = (l["d"], l["b"], l["n"], l["r"])
        if key not in seen:
            seen.add(key); uniq.append(l)
    try:
        old = json.load(open(OUT, encoding="utf-8")).get("list")
    except Exception:
        old = None
    if uniq == old:
        print("Без изменений.")
        return 0
    json.dump({"updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "list": uniq},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"Записано пар: {len(uniq)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
