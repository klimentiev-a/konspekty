#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Библиотека голосов Студии: обучение голоса по примеру и озвучка ролика в его манере.
Команды:
  prep  <видео|аудио> <id>            — чистый звук, отрезок-образец 12–20 с для клона, сэмпл mp3
  style <words.json> [<id>]           — профиль манеры по таймингам слов примера (темп, паузы, медленные места)
  script <text.txt> <id>              — текст для одного дубля Cartesia с темпом по профилю (<speed ratio>)
  cut <voice.wav> <words.json> <lines.json> <id> <outdir>
                                      — нарезка дубля по фразам ролика, паузы между фразами как у примера
  add <id> <name> <provider_voice_id> [описание]  — записать голос в voices/index.json
Рабочая папка: /tmp/voices/<id>. Образец для клона кладётся в ветку voices-data (см. CLAUDE.md, 4и)."""
import sys, os, re, json, subprocess, statistics as st

NATURAL = '--natural' in sys.argv
if NATURAL: sys.argv.remove('--natural')
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIB = os.path.join(ROOT, 'voices', 'index.json')
WORK = '/tmp/voices'

def sh(*a, out=False):
    r = subprocess.run(a, capture_output=True, text=True)
    if r.returncode: raise SystemExit(r.stderr[-800:])
    return r.stderr if out else r.stdout

def dur(f):
    return float(sh('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f))

def silences(f, th='-35dB', d=0.25):
    log = sh('ffmpeg', '-hide_banner', '-i', f, '-af', f'silencedetect=n={th}:d={d}', '-f', 'null', '-', out=True)
    s = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', log)]
    e = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', log)]
    return list(zip(s, e + [None] * (len(s) - len(e))))

def prep(src, vid):
    d = os.path.join(WORK, vid); os.makedirs(d, exist_ok=True)
    full = os.path.join(d, 'full.wav')
    # голос отдельно от музыки нельзя без нейросети; берём звук как есть, режем низ и шум, выравниваем громкость
    sh('ffmpeg', '-y', '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '24000',
       '-af', 'highpass=f=70,lowpass=f=11000,afftdn=nf=-25,loudnorm=I=-18:TP=-2', full)
    T = dur(full); sil = silences(full)
    # куски речи между паузами
    segs, t = [], 0.0
    for a, b in sil:
        if a - t > 0.05: segs.append((t, a))
        t = b if b is not None else T
    if T - t > 0.05: segs.append((t, T))
    # лучшее окно 12–20 с: больше всего речи, начинается и заканчивается на паузе
    best = None
    for i in range(len(segs)):
        for j in range(i, len(segs)):
            a, b = segs[i][0], segs[j][1]
            L = b - a
            if L > 20.5: break
            if L < 10 and j < len(segs) - 1: continue
            speech = sum(y - x for x, y in segs[i:j + 1])
            sc = speech - 0.3 * max(0, 12 - L)
            if best is None or sc > best[0]: best = (sc, a, b)
    a, b = (best[1], best[2]) if best else (0, min(T, 20))
    a = max(0, a - 0.08); b = min(T, b + 0.15)
    ref = os.path.join(d, 'ref.wav')
    sh('ffmpeg', '-y', '-v', 'error', '-ss', f'{a:.2f}', '-to', f'{b:.2f}', '-i', full, ref)
    smp = os.path.join(d, 'example.mp3')
    sh('ffmpeg', '-y', '-v', 'error', '-ss', f'{a:.2f}', '-to', f'{b:.2f}', '-i', full, '-b:a', '96k', smp)
    print(json.dumps({'full': full, 'full_sec': round(T, 1), 'ref': ref, 'ref_from': round(a, 2), 'ref_sec': round(b - a, 1),
                      'pauses': len(sil)}, ensure_ascii=False))

END = re.compile(r'[.!?…]+["»)]*$'); MID = re.compile(r'[,;:—–-]$')

def sentences(words):
    out, cur = [], []
    for w in words:
        cur.append(w)
        if END.search(w['text']): out.append(cur); cur = []
    if cur: out.append(cur)
    return out

def style(words_file, vid=None):
    W = json.load(open(words_file, encoding='utf-8'))
    W = W.get('words', W) if isinstance(W, dict) else W
    W = [w for w in W if re.search(r'\w', w['text'])]
    S = sentences(W)
    gs, gc = [], []
    for i in range(len(W) - 1):
        g = (W[i + 1]['start_ms'] - W[i]['end_ms']) / 1000
        if g < 0 or g > 3 or W[i].get('brk'): continue  # brk: дальше говорит другой голос — это не пауза
        (gs if END.search(W[i]['text']) else gc if MID.search(W[i]['text']) else []).append(g)
    def rate(s):  # слогов в секунду: русская речь считается по гласным
        syl = sum(len(re.findall(r'[аеёиоуыэюяaeiouy]', w['text'].lower())) for w in s)
        t = (s[-1]['end_ms'] - s[0]['start_ms']) / 1000
        return syl / t if t > 0.3 and syl else None
    rs = [(len(s), rate(s)) for s in S]; rs = [(n, r) for n, r in rs if r]
    allr = [r for _, r in rs] or [5.5]
    short = [r for n, r in rs if n <= 3]; long = [r for n, r in rs if n > 3]
    med = st.median(allr)
    prof = {
        'syl_per_sec': round(med, 2),
        'speed': round(max(0.75, min(1.4, med / 4.2)), 2),          # 4,2 слога/с — Cartesia при speed=1 (замер 14.11)
        'short_slow': round(max(0.85, min(1.0, (st.median(short) / st.median(long)) if short and long else 0.92)), 2),
        'pause_sentence': round(st.median(gs), 2) if gs else 0.45,
        'pause_comma': round(st.median(gc), 2) if gc else 0.15,
        'pause_long': round(min(1.3, st.median(sorted(gs)[-3:])), 2) if len(gs) >= 3 else 0.8,  # пауза перед добивкой: медиана трёх самых длинных
        'pause_q3': round(st.quantiles(gs, n=4)[2], 2) if len(gs) >= 4 else 0.55,               # заметная пауза (75-й перцентиль)
        'spread': round((max(allr) - min(allr)) / med, 2) if len(allr) > 1 else 0,
        'sentences': len(S), 'words': len(W)}
    if vid:
        d = os.path.join(WORK, vid); os.makedirs(d, exist_ok=True)
        json.dump(prof, open(os.path.join(d, 'style.json'), 'w'), ensure_ascii=False, indent=1)
    print(json.dumps(prof, ensure_ascii=False))
    return prof

def load_prof(vid):
    p = os.path.join(WORK, vid, 'style.json')
    if os.path.exists(p): return json.load(open(p))
    for v in json.load(open(LIB, encoding='utf-8')):
        if v['id'] == vid: return v['style']
    raise SystemExit('нет профиля ' + vid)

def script(text_file, vid):
    """Текст для озвучки — живая речь, а не субтитры (Артём 14.11: «читает каждую букву»): строки — фразы рассказа
    со связками («и вдруг», «а», «значит»), многоточия и тире для пауз. Одна строка = один кусок нарезки (= субтитр).
    Темп — один на весь дубль (параметр speed), теги <speed> не ставим: они выравнивают интонацию."""
    P = load_prof(vid)
    lines = [l.strip() for l in open(text_file, encoding='utf-8') if l.strip()]
    print(json.dumps({'text': ' '.join(lines), 'speed': round(min(P['speed'], 1.2), 2)}, ensure_ascii=False))

def norm(s): return re.sub(r'[^\wё]', '', s.lower().replace('ё', 'е'))

NUM = {'3': 'три', '12': 'двенадцать', '13': 'тринадцать', '30': 'тридцать'}

def cut(voice, words_file, lines_file, vid, outd):
    """Сопоставляет фразы ролика со словами дубля и режет; между фразами пауза по профилю."""
    P = load_prof(vid)
    W = json.load(open(words_file, encoding='utf-8')); W = W.get('words', W) if isinstance(W, dict) else W
    W = [w for w in W if re.search(r'\w', w['text'])]
    L = json.load(open(lines_file, encoding='utf-8'))
    os.makedirs(outd, exist_ok=True)
    k, bounds = 0, []
    for line in L:
        n = len([x for x in re.findall(r'[\wё]+', line)])
        a = W[min(k, len(W) - 1)]['start_ms']; b = W[min(k + n - 1, len(W) - 1)]['end_ms']
        bounds.append((a, b)); k += n
    T = dur(voice) * 1000
    for i, (a, b) in enumerate(bounds):
        nxt = bounds[i + 1][0] if i + 1 < len(bounds) else T
        s = max(0, a - 60); e = min(T, b + min(120, (nxt - b) / 2))
        if NATURAL:  # живой дубль: режем ровно до начала следующей фразы, его паузы и есть интонация
            e = min(T, nxt - 30) if i + 1 < len(bounds) else T
        last = i == len(bounds) - 1
        txt = L[i].strip()
        # длинная пауза — перед последней фразой (добивка) и после неё; после вопроса/восклицания — заметная; иначе обычная из примера
        q3 = P.get('pause_q3', P['pause_sentence'])
        pause = P['pause_long'] if (last or i == len(bounds) - 2) else \
                q3 if (txt.endswith('?') or txt.endswith('!')) else \
                P['pause_sentence'] if END.search(txt) else max(P['pause_comma'], 0.12)
        pause = max(0.12, min(1.2, pause))
        if NATURAL: pause = 0.0 if i + 1 < len(bounds) else 0.4
        sh('ffmpeg', '-y', '-v', 'error', '-ss', f'{s/1000:.3f}', '-to', f'{e/1000:.3f}', '-i', voice,
           '-af', f'afade=t=in:d=0.01,areverse,afade=t=in:d=0.03,areverse,apad=pad_dur={pause:.2f}' if pause > 0 else 'afade=t=in:d=0.01',
           os.path.join(outd, f'c{i:02d}.wav'))
    print(json.dumps({'lines': len(L), 'words_used': k, 'words_total': len(W)}, ensure_ascii=False))

def add(vid, name, pvid, desc='', provider='cartesia'):
    lib = json.load(open(LIB, encoding='utf-8')) if os.path.exists(LIB) else []
    lib = [v for v in lib if v['id'] != vid]
    d = os.path.join(WORK, vid)
    prof = json.load(open(os.path.join(d, 'style.json')))
    ex = os.path.exists(os.path.join(d, 'example.mp3'))  # чужой звук без прав не публикуем: example только для своих/разрешённых
    os.makedirs(os.path.dirname(LIB), exist_ok=True)
    for f, to in (('example.mp3', f'{vid}-example.mp3'), ('test.mp3', f'{vid}-test.mp3')):
        if os.path.exists(os.path.join(d, f)): subprocess.run(['cp', os.path.join(d, f), os.path.join(ROOT, 'voices', to)])
    lib.append({'id': vid, 'name': name, 'desc': desc, 'provider': provider, 'voice': pvid, 'style': prof,
                'example': f'voices/{vid}-example.mp3' if ex else '', 'test': f'voices/{vid}-test.mp3'})
    json.dump(lib, open(LIB, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('ok', len(lib))

if __name__ == '__main__':
    c, a = sys.argv[1], sys.argv[2:]
    {'prep': prep, 'style': style, 'script': script, 'cut': cut, 'add': add}[c](*a)
