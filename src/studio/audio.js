/* Студия: звук. Всё синтезируется WebAudio, файлов нет. Планирование от абсолютного времени контекста — тот же граф идёт и в динамики, и в запись. */
(function (G) {
'use strict';
const E = G.StudioEngine;
let ctx = null, master = null, recDest = null, noiseBuf = null, bus = null;
function init() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  ctx = new (G.AudioContext || G.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = .9; master.connect(ctx.destination);
  recDest = ctx.createMediaStreamDestination(); master.connect(recDest);
  const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; noiseBuf = b;
  return ctx;
}
const SFX_NAMES = { alert: 'Сигнал тревоги', siren: 'Сирена', steps: 'Шаги', heartbeat: 'Сердцебиение', whoosh: 'Свист', hit: 'Удар', tick: 'Тиканье', riser: 'Нарастание', creak: 'Скрип двери', crowd: 'Гул толпы', geiger: 'Счётчик Гейгера', beep: 'Писк', boom: 'Взрыв', ding: 'Уведомление', glitch: 'Глитч', typing: 'Печать', cash: 'Монеты', win: 'Победа', fail: 'Провал', wind: 'Ветер' };
function osc(o, type, f0, f1, t0, t1, g0, g1, dst) { t0 = Math.max(0, t0); t1 = Math.max(t0 + .01, t1); const g = ctx.createGain(), s = ctx.createOscillator(); s.type = type; s.frequency.setValueAtTime(f0, t0); if (f1 != null) s.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t1); g.gain.setValueAtTime(g0, t0); g.gain.exponentialRampToValueAtTime(Math.max(1e-4, g1), t1); s.connect(g); g.connect(dst); s.start(t0); s.stop(t1 + .05); return { s, g }; }
function noise(t0, t1, g0, g1, dst, ftype, f0, f1, q) { const g = ctx.createGain(), s = ctx.createBufferSource(), f = ctx.createBiquadFilter(); s.buffer = noiseBuf; s.loop = true; f.type = ftype || 'lowpass'; f.frequency.setValueAtTime(f0 || 1000, t0); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t1); if (q) f.Q.value = q; g.gain.setValueAtTime(g0, t0); g.gain.exponentialRampToValueAtTime(Math.max(1e-4, g1), t1); s.connect(f); f.connect(g); g.connect(dst); s.start(t0, Math.random()); s.stop(t1 + .05); }
const SFX = {
  alert(t, d, v, o) { for (let i = 0; i < 3; i++) { osc(0, 'square', 880, 880, t + i * .32, t + i * .32 + .22, .12 * v, .001, o); osc(0, 'square', 1320, 1320, t + i * .32, t + i * .32 + .22, .06 * v, .001, o); } },
  siren(t, d, v, o) { const L = d || 2.6, s = ctx.createOscillator(), g = ctx.createGain(); s.type = 'sawtooth'; for (let i = 0; i < L / 1.4 + 1; i++) { s.frequency.setValueAtTime(500, t + i * 1.4); s.frequency.linearRampToValueAtTime(900, t + i * 1.4 + .7); s.frequency.linearRampToValueAtTime(500, t + i * 1.4 + 1.4); } g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.12 * v, t + .15); g.gain.setValueAtTime(.12 * v, t + L - .3); g.gain.linearRampToValueAtTime(0, t + L); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200; s.connect(f); f.connect(g); g.connect(o); s.start(t); s.stop(t + L + .1); },
  steps(t, d, v, o) { const L = d || 3, n = Math.floor(L / .24); for (let i = 0; i < n; i++) { const tt = t + i * .24; noise(tt, tt + .09, .5 * v, .001, o, 'lowpass', 700, 200); osc(0, 'sine', 120, 50, tt, tt + .09, .35 * v, .001, o); } },
  heartbeat(t, d, v, o) { const L = d || 3.5, n = Math.floor(L / .78); for (let i = 0; i < n; i++) { const tt = t + i * .78; osc(0, 'sine', 70, 40, tt, tt + .16, .7 * v, .001, o); osc(0, 'sine', 62, 38, tt + .2, tt + .38, .5 * v, .001, o); } },
  whoosh(t, d, v, o) { noise(t, t + .7, .001, .45 * v, o, 'bandpass', 300, 3500, 1.2); noise(t + .35, t + .85, .4 * v, .001, o, 'bandpass', 3500, 300, 1.2); },
  hit(t, d, v, o) { osc(0, 'sine', 160, 40, t, t + .35, .9 * v, .001, o); noise(t, t + .12, .5 * v, .001, o, 'lowpass', 3000, 400); },
  tick(t, d, v, o) { const L = d || 3, n = Math.floor(L / .5); for (let i = 0; i < n; i++) osc(0, 'square', i % 2 ? 1500 : 1900, 1500, t + i * .5, t + i * .5 + .03, .12 * v, .001, o); },
  riser(t, d, v, o) { const L = d || 3.5; osc(0, 'sawtooth', 70, 640, t, t + L, .02 * v, .22 * v, o); noise(t, t + L, .01, .3 * v, o, 'bandpass', 200, 5000, 1); },
  creak(t, d, v, o) { const s = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(); s.type = 'sawtooth'; s.frequency.setValueAtTime(140, t); s.frequency.linearRampToValueAtTime(260, t + .5); s.frequency.linearRampToValueAtTime(110, t + 1.4); f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 6; g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.2 * v, t + .3); g.gain.linearRampToValueAtTime(.0001, t + 1.5); s.connect(f); f.connect(g); g.connect(o); s.start(t); s.stop(t + 1.6); },
  crowd(t, d, v, o) { const L = d || 4; noise(t, t + L, .001, .001, o, 'bandpass', 500, 500, .6); const g = ctx.createGain(); g.gain.setValueAtTime(.001, t); g.gain.linearRampToValueAtTime(.35 * v, t + L * .6); g.gain.linearRampToValueAtTime(.001, t + L); g.connect(o); const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(); s.buffer = noiseBuf; s.loop = true; f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = .7; s.connect(f); f.connect(g); s.start(t); s.stop(t + L + .1); for (let i = 0; i < L * 3; i++) osc(0, 'triangle', 180 + Math.random() * 120, 150 + Math.random() * 100, t + Math.random() * L, t + Math.random() * L + .4, .02 * v, .001, o); },
  geiger(t, d, v, o) { const L = d || 3; let tt = t; while (tt < t + L) { noise(tt, tt + .012, .35 * v, .001, o, 'highpass', 2500); tt += .03 + Math.random() * (.25 * (1 - (tt - t) / L) + .02); } },
  beep(t, d, v, o) { osc(0, 'sine', 1000, 1000, t, t + .25, .2 * v, .001, o); },
  boom(t, d, v, o) { osc(0, 'sine', 90, 25, t, t + 1.8, 1 * v, .001, o); noise(t, t + 1.6, .8 * v, .001, o, 'lowpass', 2000, 80); },
  ding(t, d, v, o) { osc(0, 'sine', 1320, 1320, t, t + .5, .25 * v, .001, o); osc(0, 'sine', 1980, 1980, t + .08, t + .6, .15 * v, .001, o); },
  glitch(t, d, v, o) { for (let i = 0; i < 9; i++) osc(0, 'square', 200 + Math.random() * 2000, null, t + i * .045, t + i * .045 + .035, .1 * v, .001, o); noise(t, t + .4, .25 * v, .001, o, 'highpass', 4000); },
  typing(t, d, v, o) { const L = d || 2; for (let tt = t; tt < t + L; tt += .06 + Math.random() * .1) noise(tt, tt + .02, .25 * v, .001, o, 'highpass', 2000); },
  cash(t, d, v, o) { for (let i = 0; i < 4; i++) { osc(0, 'sine', 2400 + i * 300, 2400 + i * 300, t + i * .07, t + i * .07 + .3, .12 * v, .001, o); } },
  win(t, d, v, o) { [523, 659, 784, 1047].forEach((f, i) => osc(0, 'triangle', f, f, t + i * .11, t + i * .11 + .5, .2 * v, .001, o)); },
  fail(t, d, v, o) { [392, 330, 262, 196].forEach((f, i) => osc(0, 'sawtooth', f, f, t + i * .2, t + i * .2 + .5, .1 * v, .001, o)); },
  wind(t, d, v, o) { const L = d || 4; noise(t, t + L / 2, .02, .25 * v, o, 'bandpass', 300, 900, 2); noise(t + L / 2, t + L, .25 * v, .02, o, 'bandpass', 900, 300, 2); }
};
const MUSIC_NAMES = { none: 'Без музыки', tension: 'Напряжение', calm: 'Спокойная', action: 'Экшен', sad: 'Грустная', mystery: 'Тайна' };
function pad(t, L, freqs, vol, o, type) { for (const f of freqs) { const s = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter(); s.type = type || 'sawtooth'; s.frequency.value = f; s.detune.value = (Math.random() - .5) * 14; fl.type = 'lowpass'; fl.frequency.value = 600; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(1.5, L / 3)); g.gain.setValueAtTime(vol, t + L - .8); g.gain.linearRampToValueAtTime(0, t + L); s.connect(fl); fl.connect(g); g.connect(o); s.start(t); s.stop(t + L + .1); } }
const MUSIC = {
  tension(t, L, o) { pad(t, L, [55, 55.4, 82.4, 110.3], .05, o); const lf = ctx.createOscillator(), lg = ctx.createGain(); lf.frequency.value = .25; lg.gain.value = .02; lf.connect(lg); lg.connect(o.gain); lf.start(t); lf.stop(t + L); for (let i = 0; i < L / .52; i++) osc(0, 'sine', 62, 44, t + i * .52, t + i * .52 + .14, .14, .001, o); for (let i = 0; i < L / 4; i++) osc(0, 'sine', 740 + (i % 2) * 40, 740, t + 1 + i * 4, t + 3.2 + i * 4, .006, .0001, o); osc(0, 'sawtooth', 220, 880, t + L - 5, t + L, .001, .02, o); },
  calm(t, L, o) { const ch = [[261.6, 329.6, 392], [220, 277.2, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]]; for (let i = 0; i * 4 < L; i++) pad(t + i * 4, Math.min(4.4, L - i * 4 + .4), ch[i % 4], .035, o, 'triangle'); for (let i = 0; i < L / .5; i++) { const n = ch[((i / 8) | 0) % 4]; osc(0, 'sine', n[i % 3] * 2, n[i % 3] * 2, t + i * .5, t + i * .5 + .45, .03, .0001, o); } },
  action(t, L, o) { const bpm = 128, b = 60 / bpm, bass = [55, 55, 65.4, 49]; for (let i = 0; i * b < L; i++) { const tt = t + i * b; osc(0, 'sine', 130, 45, tt, tt + .22, .5, .001, o); if (i % 2) noise(tt + b / 2, tt + b / 2 + .05, .12, .001, o, 'highpass', 6000); if (i % 4 === 2) noise(tt, tt + .12, .22, .001, o, 'bandpass', 1800, 1500, 1); osc(0, 'sawtooth', bass[((i / 8) | 0) % 4] * 2, bass[((i / 8) | 0) % 4] * 2, tt + b / 2, tt + b * .95, .08, .001, o); } },
  sad(t, L, o) { const ch = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 233, 293.7], [164.8, 207.7, 246.9]]; for (let i = 0; i * 5 < L; i++) pad(t + i * 5, Math.min(5.5, L - i * 5 + .5), ch[i % 4], .04, o, 'triangle'); for (let i = 0; i < L / 2.5; i++) osc(0, 'sine', [440, 523, 392, 349][i % 4], null, t + i * 2.5, t + i * 2.5 + 2, .04, .0001, o); },
  mystery(t, L, o) { pad(t, L, [73.4, 110, 146.8], .035, o); for (let i = 0; i < L / 1.7; i++) { const f = [659, 784, 587, 880, 698][(i * 3) % 5]; osc(0, 'sine', f, f, t + i * 1.7, t + i * 1.7 + 1.3, .04, .0001, o); osc(0, 'sine', f * 2.76, f * 2.76, t + i * 1.7, t + i * 1.7 + .6, .012, .0001, o); } for (let i = 0; i < L / 3.2; i++) noise(t + i * 3.2, t + i * 3.2 + 2, .001, .05, o, 'bandpass', 1500, 400, 3); }
};
let preview = null;
function playSfx(name, vol) { init(); const t = ctx.currentTime + .03, b = ctx.createGain(); b.gain.value = 1; b.connect(master); (SFX[name] || SFX.beep)(t, 0, vol == null ? 1 : vol, b); setTimeout(() => b.disconnect(), 6000); }
function playMusic(style, vol) { init(); stopPreview(); if (!MUSIC[style]) return; const b = ctx.createGain(); b.gain.value = (vol == null ? .5 : vol); b.connect(master); MUSIC[style](ctx.currentTime + .03, 10, b); preview = b; setTimeout(() => { if (preview === b) stopPreview(); }, 10300); }
function stopPreview() { if (preview) { try { preview.disconnect(); } catch (e) {} preview = null; } }

// запуск всего проекта с момента from (сек)
function start(P, from, clips) {
  init(); stop(); const t0 = ctx.currentTime + .08, tot = E.total(P); bus = ctx.createGain(); bus.gain.value = 1; bus.connect(master);
  const mus = ctx.createGain(), vol = (P.music && P.music.vol != null ? P.music.vol : .5); mus.gain.value = vol; mus.connect(bus);
  const sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(bus);
  const rem = Math.max(.1, tot - from);
  if (P.music && MUSIC[P.music.style]) MUSIC[P.music.style](t0, rem, mus);
  const tl = E.timeline(P); const voiceIv = [];
  tl.forEach(({ s, sc }, si) => {
    (sc.sfx || []).forEach(x => { const at = s + (x.at || 0) - from; if (at < -.05 && !(x.dur && at + x.dur > 0)) return; const tt = t0 + Math.max(0, at), d = x.dur ? (at < 0 ? x.dur + at : x.dur) : 0; if (SFX[x.n]) SFX[x.n](tt, d, x.v == null ? 1 : x.v, sfxBus); });
    (sc.caps || []).forEach((cp, ci) => { const buf = clips && clips[si + ':' + ci]; if (!buf) return; const at = s + cp.at - from; if (at + buf.duration < 0) return; const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; g.gain.value = 1.35; src.connect(g); g.connect(bus); const off = Math.max(0, -at); src.start(t0 + Math.max(0, at), off); voiceIv.push([Math.max(0, at), Math.max(0, at) + buf.duration - off]); });
  });
  if (voiceIv.length && P.music && (P.music.duck !== false)) { const lo = vol * .3; mus.gain.setValueAtTime(vol, t0); voiceIv.forEach(([a, b]) => { mus.gain.setTargetAtTime(lo, t0 + a - .05, .08); mus.gain.setTargetAtTime(vol, t0 + b + .05, .25); }); }
  return { t0, ctx };
}
function stop() { if (bus) { try { bus.gain.setTargetAtTime(0, ctx.currentTime, .02); const b = bus; setTimeout(() => { try { b.disconnect(); } catch (e) {} }, 200); } catch (e) {} bus = null; } }
G.StudioAudio = { init, start, stop, playSfx, playMusic, stopPreview, SFX_NAMES, MUSIC_NAMES, get ctx() { return ctx; }, get recStream() { init(); return recDest.stream; }, decode: ab => { init(); return ctx.decodeAudioData(ab.slice(0)); } };
})(window);
