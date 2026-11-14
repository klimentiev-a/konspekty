# -*- coding: utf-8 -*-
"""Голос: локальная озвучка с клонированием тембра. Запуск: run.bat (или python app.py)."""
import os, sys, json, time, shutil, subprocess, threading, wave, struct, math, re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

ROOT = os.path.dirname(os.path.abspath(__file__))
VOICES = os.path.join(ROOT, "voices")
OUT = os.path.join(ROOT, "out")
PORT = 7860
FAKE = "--fake" in sys.argv  # проверка интерфейса без модели
os.makedirs(VOICES, exist_ok=True); os.makedirs(OUT, exist_ok=True)

_tts = None
_lock = threading.Lock()
SR = 24000

def get_tts():
    global _tts
    if _tts is None:
        import torch
        from TTS.api import TTS
        dev = "cuda" if torch.cuda.is_available() else "cpu"
        print("Загружаю модель XTTS-v2 (первый раз скачивает ~2 ГБ), устройство:", dev, flush=True)
        _tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(dev)
    return _tts

def safe(name):
    return re.sub(r"[^\w\- ]", "", name, flags=re.U).strip()[:40] or "voice"

def refs(voice):
    d = os.path.join(VOICES, voice)
    if not os.path.isdir(d): return []
    return sorted(os.path.join(d, f) for f in os.listdir(d) if f.lower().endswith(".wav"))

def list_voices():
    r = []
    for v in sorted(os.listdir(VOICES)):
        if os.path.isdir(os.path.join(VOICES, v)):
            r.append({"name": v, "refs": [os.path.basename(x) for x in refs(v)]})
    return r

def has_ffmpeg():
    return shutil.which("ffmpeg") is not None

def to_wav(src, dst, max_sec=25):
    if not has_ffmpeg():
        if src.lower().endswith(".wav"):
            shutil.copy(src, dst); return
        raise RuntimeError("Для mp3/mp4 нужен ffmpeg (см. README). Либо загрузи .wav")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-t", str(max_sec), "-vn", "-ac", "1", "-ar", str(SR),
                    "-af", "highpass=f=60,loudnorm=I=-20", dst], check=True)

def write_wav(path, samples):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", max(-32768, min(32767, int(s * 32767)))) for s in samples))

def read_wav(path):
    with wave.open(path, "rb") as w:
        n = w.getnframes(); raw = w.readframes(n); ch = w.getnchannels(); sw = w.getsampwidth()
    fmt = "<%dh" % (len(raw) // 2)
    d = struct.unpack(fmt, raw)
    if ch > 1: d = d[::ch]
    return [x / 32768 for x in d]

def synth_chunk(text, voice, speed, temp):
    """Возвращает список сэмплов (float, 24 кГц)."""
    if FAKE:
        n = int(SR * max(0.6, len(text) * 0.055)); f = 180 + (len(text) % 7) * 12
        return [0.2 * math.sin(2 * math.pi * f * i / SR) * min(1, i / 2000, (n - i) / 2000) for i in range(n)]
    tts = get_tts()
    tmp = os.path.join(OUT, "_tmp.wav")
    kw = dict(text=text, speaker_wav=refs(voice), language="ru", file_path=tmp)
    try:
        tts.tts_to_file(speed=speed, temperature=temp, repetition_penalty=5.0, top_k=50, top_p=0.85, **kw)
    except TypeError:
        tts.tts_to_file(**kw)
    return read_wav(tmp)

def generate(voice, text, speed, temp, pause):
    """Абзацы озвучиваются целиком (интонация течёт), между ними пауза. «//» = ещё пауза."""
    paras = [p.strip() for p in re.split(r"\n+", text) if p.strip()]
    out, marks, t = [], [], 0.0
    for p in paras:
        extra = 0.0
        while p.endswith("//"):
            p = p[:-2].strip(); extra += 0.5
        if not p: 
            out += [0.0] * int(SR * extra); t += extra; continue
        s = synth_chunk(p, voice, speed, temp)
        marks.append({"text": p, "start": round(t, 2), "end": round(t + len(s) / SR, 2)})
        gap = pause + extra
        out += s + [0.0] * int(SR * gap); t += len(s) / SR + gap
    name = "%s_%s.wav" % (voice, time.strftime("%H%M%S"))
    write_wav(os.path.join(OUT, name), out)
    with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(marks, f, ensure_ascii=False, indent=1)
    return {"file": name, "marks": marks, "sec": round(len(out) / SR, 1)}

PAGE = open(os.path.join(ROOT, "ui.html"), encoding="utf-8").read() if os.path.exists(os.path.join(ROOT, "ui.html")) else "ui.html not found"

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code); self.send_header("Content-Type", ctype + ("; charset=utf-8" if "json" in ctype or "html" in ctype else ""))
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/": return self.send(200, PAGE.encode("utf-8"), "text/html")
        if u.path == "/api/voices": return self.send(200, {"voices": list_voices(), "ffmpeg": has_ffmpeg(), "fake": FAKE})
        if u.path.startswith("/out/"):
            p = os.path.join(OUT, os.path.basename(unquote(u.path[5:])))
            if os.path.isfile(p): return self.send(200, open(p, "rb").read(), "audio/wav" if p.endswith(".wav") else "application/json")
        self.send(404, {"error": "нет"})
    def do_POST(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        n = int(self.headers.get("Content-Length", 0)); body = self.rfile.read(n)
        try:
            if u.path == "/api/upload":
                v = safe(q.get("voice", ["voice"])[0]); fn = safe(os.path.splitext(q.get("name", ["clip"])[0])[0])
                d = os.path.join(VOICES, v); os.makedirs(d, exist_ok=True)
                raw = os.path.join(d, "_raw_" + q.get("name", ["clip"])[0])
                open(raw, "wb").write(body)
                to_wav(raw, os.path.join(d, fn + ".wav")); os.remove(raw)
                return self.send(200, {"ok": True})
            if u.path == "/api/gen":
                j = json.loads(body.decode("utf-8"))
                if not refs(j["voice"]) and not FAKE: return self.send(400, {"error": "У голоса нет образцов. Загрузи запись (10–30 секунд)."})
                with _lock:
                    r = generate(j["voice"], j["text"], float(j.get("speed", 1.0)), float(j.get("temp", 0.7)), float(j.get("pause", 0.5)))
                return self.send(200, r)
            if u.path == "/api/like":  # понравился дубль: стал новым образцом
                j = json.loads(body.decode("utf-8")); v = safe(j["voice"])
                d = os.path.join(VOICES, v); os.makedirs(d, exist_ok=True)
                liked = sorted(f for f in os.listdir(d) if f.startswith("liked_"))
                while len(liked) >= 3: os.remove(os.path.join(d, liked.pop(0)))
                shutil.copy(os.path.join(OUT, os.path.basename(j["file"])), os.path.join(d, "liked_%d.wav" % int(time.time())))
                return self.send(200, {"ok": True})
            if u.path == "/api/delref":
                j = json.loads(body.decode("utf-8")); p = os.path.join(VOICES, safe(j["voice"]), os.path.basename(j["ref"]))
                if os.path.isfile(p): os.remove(p)
                return self.send(200, {"ok": True})
        except Exception as e:
            return self.send(500, {"error": str(e)})
        self.send(404, {"error": "нет"})

if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    print("Открой в браузере: http://localhost:%d" % PORT, flush=True)
    try:
        import webbrowser; webbrowser.open("http://localhost:%d" % PORT)
    except Exception: pass
    srv.serve_forever()
