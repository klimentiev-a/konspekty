/* Студия: движок рисования. draw(ctx, проект, t) — чистая функция времени: один и тот же кадр при предпросмотре и записи. */
(function (G) {
'use strict';
const TT = s => (G.StudioT ? G.StudioT(s) : s);
const W = 1080, H = 1920;
const FONT = "'Inter','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * clamp(t);
const easeOut = x => 1 - Math.pow(1 - clamp(x), 3);
const easeBack = x => { x = clamp(x); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

const THEMES = {
  bunker:  { name: 'Бункер',   a: '#e53935', b: '#2ecc71', hl: '#ffd600', ink: '#f5f7fc', sky: ['#1b1624', '#07080f'], wall: '#1b2030', floor: '#10131c', light: '#ffd27a' },
  horror:  { name: 'Хоррор',   a: '#b71c1c', b: '#7e57c2', hl: '#ff5252', ink: '#e8e6ee', sky: ['#120a14', '#030306'], wall: '#1a1220', floor: '#0b0810', light: '#c9a0ff' },
  finance: { name: 'Финансы',  a: '#ef5350', b: '#26c281', hl: '#ffd600', ink: '#f2f6fb', sky: ['#14233b', '#070d18'], wall: '#17263d', floor: '#0d1626', light: '#7fb8ff' },
  space:   { name: 'Космос',   a: '#ff7043', b: '#4dd0e1', hl: '#ffee58', ink: '#f2f4ff', sky: ['#0b0f2a', '#02030a'], wall: '#141a3d', floor: '#0a0d26', light: '#9fb4ff' },
  neon:    { name: 'Неон',     a: '#ff2e93', b: '#00e5ff', hl: '#fff176', ink: '#fdf5ff', sky: ['#1d0b33', '#06030f'], wall: '#26104a', floor: '#12082a', light: '#ff7bd0' },
  day:     { name: 'Светлая',  a: '#e53935', b: '#1e9e5a', hl: '#ffb300', ink: '#ffffff', sky: ['#8fc6ff', '#dbeeff'], wall: '#cdd9e8', floor: '#9fb0c6', light: '#fff3b0' }
};

function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); }
function fillRR(c, x, y, w, h, r, fill, stroke, lw) { rr(c, x, y, w, h, r); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 3; c.stroke(); } }
function ell(c, x, y, rx, ry, fill, stroke, lw) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 3; c.stroke(); } }
function line(c, x0, y0, x1, y1, col, w) { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
function poly(c, pts, fill) { c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fillStyle = fill; c.fill(); }
function glow(c, x, y, r, col, a = 1) { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.save(); c.globalAlpha = a; c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); c.restore(); }
function shade(hex, f) { const n = parseInt(hex.slice(1), 16); const r = clamp(((n >> 16) & 255) * f, 0, 255), g = clamp(((n >> 8) & 255) * f, 0, 255), b = clamp((n & 255) * f, 0, 255); return `rgb(${r | 0},${g | 0},${b | 0})`; }
function txt(c, s, x, y, size, fill, o = {}) {
  c.font = `${o.w || 900} ${size}px ${o.f || FONT}`; c.textAlign = o.al || 'center'; c.textBaseline = o.bl || 'middle';
  if (o.stroke) { c.lineJoin = 'round'; c.strokeStyle = o.stroke; c.lineWidth = o.sw || size * 0.1; c.strokeText(s, x, y); }
  c.fillStyle = fill; c.fillText(s, x, y);
}
function wrapLines(c, s, maxW) { const words = String(s).split(' '), out = []; let cur = ''; for (const w of words) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t; } if (cur) out.push(cur); return out; }

/* ---------------- ПЕРСОНАЖИ ---------------- */
const HAIR = { short: 'Короткие', spiky: 'Ёжик', long: 'Длинные', bun: 'Пучок', cap: 'Кепка', bald: 'Лысый', curly: 'Кудри' };
const ACC = { none: 'Нет', glasses: 'Очки', mask: 'Маска', helmet: 'Каска', phones: 'Наушники', beard: 'Борода', tie: 'Галстук', crown: 'Корона' };
const ANIMS = { idle: 'Стоит', talk: 'Говорит', walk: 'Идёт', run: 'Бежит', shake: 'Трясётся', point: 'Показывает', wave: 'Машет', sit: 'Сидит', fall: 'Падает' };
const EXPR = { calm: 'Спокоен', scared: 'Испуган', shock: 'Шок', happy: 'Рад', angry: 'Зол', sad: 'Грустит', sleep: 'Спит' };

function drawChar(c, ch, x, y, s, t, anim, expr, flip) {
  ch = ch || {};
  const hood = ch.hood || '#4caf50', hair = ch.hair || '#46281e', skin = ch.skin || '#f7c8a0', pants = ch.pants || '#283046';
  c.save(); c.translate(x, y); if (flip) c.scale(-1, 1); c.scale(s, s); c.translate(-230, -580);
  let la = 0, lb = 0, aa = 0, ab = 0, dx = 0, dy = 0, rot = 0;
  const f = anim === 'run' ? 15 : 8;
  if (anim === 'run') { la = Math.sin(t * f) * 38; lb = -la; aa = -la * 1.1; ab = la * 1.1; dy = -Math.abs(Math.sin(t * f)) * 16; }
  else if (anim === 'walk') { la = Math.sin(t * f) * 22; lb = -la; aa = -la * .8; ab = la * .8; dy = -Math.abs(Math.sin(t * f)) * 6; }
  else if (anim === 'shake') { dx = Math.sin(t * 55) * 5; dy = Math.cos(t * 47) * 3; aa = Math.sin(t * 38) * 8; ab = -aa; }
  else if (anim === 'point') { aa = 100 + Math.sin(t * 6) * 4; ab = 5; dy = Math.sin(t * 2.4) * 3; }
  else if (anim === 'wave') { aa = 150 + Math.sin(t * 9) * 28; dy = Math.sin(t * 2.4) * 3; }
  else if (anim === 'sit') { la = 85; lb = 80; dy = 40; }
  else if (anim === 'fall') { rot = clamp(t / 0.5) * 80; }
  else { dy = Math.sin(t * 2.4) * 4; aa = Math.sin(t * 2.4) * 3; ab = -aa; }
  if (expr === 'sleep') dy += 6;
  c.translate(dx, dy); if (rot) { c.translate(230, 580); c.rotate(rot * Math.PI / 180); c.translate(-230, -580); }
  const cx = 230;
  const limb = (px, py, a, L, w, col) => { const ex = px + L * Math.sin(a * Math.PI / 180), ey = py + L * Math.cos(a * Math.PI / 180); line(c, px, py, ex, ey, col, w); return [ex, ey]; };
  // задние: нога, рука
  let e = limb(cx + 22, 400, lb, anim === 'sit' ? 110 : 160, 50, shade(pants, .85)); ell(c, e[0] + 3, e[1] + 6, 37, 18, '#181a22');
  e = limb(cx - 70, 250, ab, 150, 40, shade(hood, .8)); ell(c, e[0], e[1], 20, 20, skin);
  fillRR(c, cx - 82, 215, 164, 210, 34, hood); fillRR(c, cx - 40, 330, 80, 55, 16, shade(hood, .82));
  if (ch.acc === 'tie') poly(c, [[cx - 12, 218], [cx + 12, 218], [cx + 18, 300], [cx, 330], [cx - 18, 300]], '#c62828');
  e = limb(cx - 22, 400, la, anim === 'sit' ? 110 : 160, 50, pants); ell(c, e[0] + 3, e[1] + 6, 37, 18, '#20222c');
  // голова
  const hs = ch.hairStyle || 'short';
  if (hs === 'long') fillRR(c, cx - 86, 60, 172, 220, 70, hair);
  if (hs === 'bun') ell(c, cx, 10, 34, 34, hair);
  if (hs === 'curly') for (let i = 0; i < 9; i++) ell(c, cx - 64 + i * 16, 36 + Math.abs(i - 4) * 5, 26, 26, hair);
  if (hs !== 'bald') ell(c, cx, 100, 80, 80, hair);
  ell(c, cx, 125, 66, 71, skin); ell(c, cx - 66, 127, 8, 15, skin); ell(c, cx + 66, 127, 8, 15, skin);
  if (hs === 'spiky') for (let i = 0; i < 6; i++) poly(c, [[cx - 66 + i * 26, 56], [cx - 56 + i * 26, -2 - (i % 2) * 14], [cx - 40 + i * 26, 56]], hair);
  if (hs === 'cap') { fillRR(c, cx - 80, 24, 160, 62, 40, '#d84315'); fillRR(c, cx - 14, 66, 120, 20, 10, '#bf360c'); }
  if (hs === 'long') { ell(c, cx - 56, 90, 38, 50, hair); ell(c, cx + 56, 90, 38, 50, hair); }
  if (ch.acc === 'helmet') { c.beginPath(); c.arc(cx, 92, 86, Math.PI, 0); c.closePath(); c.fillStyle = '#ffb300'; c.fill(); fillRR(c, cx - 96, 88, 192, 16, 8, '#e69500'); }
  if (ch.acc === 'crown') poly(c, [[cx - 54, 30], [cx - 54, -22], [cx - 28, 8], [cx, -34], [cx + 28, 8], [cx + 54, -22], [cx + 54, 30]], '#ffca28');
  // лицо
  const ey = 124, t6 = t * 6;
  const eye = (sx, rx, ry, pupil) => { ell(c, cx + sx, ey, rx, ry, '#fafcff', '#1e1e28', 3); ell(c, cx + sx, ey, pupil, pupil, '#14141e'); };
  if (expr === 'scared') { eye(-26, 14, 16, 6); eye(26, 14, 16, 6); line(c, cx - 44, ey - 34, cx - 14, ey - 26, hair, 7); line(c, cx + 44, ey - 34, cx + 14, ey - 26, hair, 7); ell(c, cx, 170, 13, 15, '#6e1e28'); ell(c, cx + 59, 92, 7, 12, '#78beff'); }
  else if (expr === 'shock') { eye(-26, 16, 18, 4); eye(26, 16, 18, 4); ell(c, cx, 172, 16, 19, '#6e1e28'); }
  else if (expr === 'happy') { c.strokeStyle = '#1e1e28'; c.lineWidth = 6; c.lineCap = 'round'; for (const sx of [-26, 26]) { c.beginPath(); c.arc(cx + sx, ey + 4, 11, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); } c.beginPath(); c.arc(cx, 156, 26, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke(); }
  else if (expr === 'angry') { eye(-26, 10, 9, 5); eye(26, 10, 9, 5); line(c, cx - 44, ey - 22, cx - 12, ey - 8, hair, 8); line(c, cx + 44, ey - 22, cx + 12, ey - 8, hair, 8); line(c, cx - 18, 172, cx + 18, 166, '#8a3a34', 6); }
  else if (expr === 'sad') { eye(-26, 9, 10, 5); eye(26, 9, 10, 5); line(c, cx - 44, ey - 16, cx - 14, ey - 26, hair, 6); line(c, cx + 44, ey - 16, cx + 14, ey - 26, hair, 6); c.strokeStyle = '#8a3a34'; c.lineWidth = 5; c.beginPath(); c.arc(cx, 186, 20, 1.15 * Math.PI, 1.85 * Math.PI); c.stroke(); ell(c, cx - 40, ey + 24, 5, 9, '#78beff'); }
  else if (expr === 'sleep') { line(c, cx - 36, ey, cx - 16, ey, '#1e1e28', 5); line(c, cx + 16, ey, cx + 36, ey, '#1e1e28', 5); line(c, cx - 14, 168, cx + 14, 168, '#8a3a34', 5); txt(c, 'z', cx + 80, 50 - (t * 20 % 30), 38, '#cfe0ff'); }
  else { for (const sx of [-26, 26]) ell(c, cx + sx, ey, 8, 9, '#18181f'); if (anim === 'talk') ell(c, cx, 168, 15, 6 + Math.abs(Math.sin(t * 14)) * 12, '#6e1e28'); else line(c, cx - 16, 168, cx + 16, 168, '#96504a', 5); }
  if (ch.acc === 'glasses') { c.strokeStyle = '#14141e'; c.lineWidth = 6; ell(c, cx - 26, ey, 24, 21, 'rgba(180,220,255,.25)', '#14141e', 6); ell(c, cx + 26, ey, 24, 21, 'rgba(180,220,255,.25)', '#14141e', 6); line(c, cx - 2, ey, cx + 2, ey, '#14141e', 6); }
  if (ch.acc === 'mask') { fillRR(c, cx - 56, 140, 112, 54, 22, '#e8f1f7', '#9db4c4', 3); line(c, cx - 56, 154, cx - 70, 140, '#9db4c4', 3); line(c, cx + 56, 154, cx + 70, 140, '#9db4c4', 3); }
  if (ch.acc === 'beard') { c.beginPath(); c.arc(cx, 150, 60, 0.05 * Math.PI, 0.95 * Math.PI); c.lineTo(cx - 56, 150); c.closePath(); c.fillStyle = hair; c.fill(); ell(c, cx, 170, 14, 5, '#7a3a34'); }
  if (ch.acc === 'phones') { c.strokeStyle = '#222'; c.lineWidth = 12; c.beginPath(); c.arc(cx, 98, 74, Math.PI * 1.02, Math.PI * 1.98); c.stroke(); fillRR(c, cx - 88, 100, 26, 56, 12, '#111'); fillRR(c, cx + 62, 100, 26, 56, 12, '#111'); }
  // передняя рука
  e = limb(cx + 70, 250, aa, 150, 40, hood); ell(c, e[0], e[1], 20, 20, skin);
  if (ch.hold === 'phone') { fillRR(c, e[0] - 6, e[1] - 74, 58, 98, 10, '#14161f'); fillRR(c, e[0] - 1, e[1] - 69, 48, 88, 7, '#96c8ff'); }
  c.restore();
}

/* ---------------- ФОНЫ ---------------- */
const BG = {
  gradient(c, t, p) { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, p.sky[0]); g.addColorStop(1, p.sky[1]); c.fillStyle = g; c.fillRect(0, 0, W, H); },
  bedroom(c, t, p) {
    BG.gradient(c, t, { sky: [p.wall, '#05060a'] }); c.fillStyle = p.floor; c.fillRect(0, 1350, W, 570);
    fillRR(c, 640, 380, 330, 430, 14, '#0a0d1a', '#2a3350', 8); const g = c.createLinearGradient(640, 380, 970, 810); g.addColorStop(0, 'rgba(90,120,200,.5)'); g.addColorStop(1, 'rgba(20,30,70,.2)'); fillRR(c, 650, 390, 310, 410, 8, g);
    line(c, 805, 390, 805, 800, '#2a3350', 6); line(c, 650, 595, 960, 595, '#2a3350', 6); ell(c, 720, 470, 34, 34, '#dfe8ff');
    fillRR(c, 60, 1120, 520, 250, 26, '#243055'); fillRR(c, 60, 1060, 220, 120, 28, '#e8ecff'); fillRR(c, 90, 1230, 480, 140, 20, '#3a4a80');
    glow(c, 860, 1180, 250, p.light, .35); fillRR(c, 835, 1190, 50, 160, 8, '#1a1a22'); ell(c, 860, 1180, 54, 40, '#ffd27a');
  },
  corridor(c, t, p, sc) {
    const vx = W / 2, vy = 760; BG.gradient(c, t, { sky: ['#0b0d14', '#05060a'] });
    poly(c, [[0, 0], [vx - 120, vy - 100], [vx - 120, vy + 150], [0, H]], p.wall); poly(c, [[W, 0], [vx + 120, vy - 100], [vx + 120, vy + 150], [W, H]], p.wall);
    poly(c, [[0, H], [vx - 120, vy + 150], [vx + 120, vy + 150], [W, H]], p.floor); poly(c, [[0, 0], [vx - 120, vy - 100], [vx + 120, vy - 100], [W, 0]], '#0a0c14');
    const sp = (t * 0.9) % 1;
    for (let i = 5; i >= 0; i--) { const z = (i + 1 - sp) / 6, k = 1 - z; const y = vy + 150 + (H - vy - 150) * k * k, w = 120 + (W / 2 - 120) * k * k;
      c.fillStyle = `rgba(255,210,122,${.12 + .5 * k})`; fillRR(c, vx - 70 * (1 + k * 2), vy - 100 - (vy - 100) * k * k * .9, 140 * (1 + k * 2), 12 + 30 * k, 4, c.fillStyle); line(c, vx - w, y, vx + w, y, 'rgba(255,255,255,.05)', 3 + 8 * k); }
    glow(c, vx, vy, 360, 'rgba(255,230,160,.5)', .6);
  },
  hall(c, t, p) {
    BG.gradient(c, t, { sky: [p.wall, '#06070d'] }); c.fillStyle = p.floor; c.fillRect(0, 1180, W, 740);
    for (let i = 0; i < 6; i++) { glow(c, 90 + i * 180, 190, 200, 'rgba(255,210,122,.5)', .6); fillRR(c, 40 + i * 180, 170, 100, 18, 8, '#ffe3a6'); }
    const R = rng(7); for (let row = 0; row < 3; row++) for (let i = 0; i < 13; i++) { const x = 30 + i * 85 + (row % 2) * 40 + R() * 20, y = 1080 + row * 110, s = .12 + row * .02, wob = Math.sin(t * 3 + i + row) * 2;
      c.fillStyle = shade(['#2d3a5c', '#3a2d4c', '#2d4c3f', '#4c3d2d'][(i + row) % 4], .9); fillRR(c, x - 26, y - 95 + wob, 52, 100, 18, c.fillStyle); ell(c, x, y - 116 + wob, 22, 24, '#c9a07a'); }
  },
  grid(c, t, p) { BG.gradient(c, t, p); c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 2; const o = (t * 20) % 90; for (let x = -o; x < W; x += 90) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); } for (let y = -o; y < H; y += 90) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); } },
  hatch(c, t, p) {
    BG.gradient(c, t, { sky: ['#12151f', '#06070b'] }); const cx = W / 2, cy = 900;
    for (let i = 0; i < 14; i++) fillRR(c, 0, i * 140, W, 8, 2, 'rgba(255,255,255,.04)');
    ell(c, cx, cy, 440, 440, '#2a3042', '#475069', 14); ell(c, cx, cy, 380, 380, '#1a1f2e', '#323a52', 8);
    for (let i = 0; i < 12; i++) { const a = i * TAU / 12; ell(c, cx + Math.cos(a) * 410, cy + Math.sin(a) * 410, 14, 14, '#566082'); }
    c.save(); c.translate(cx, cy); c.rotate(Math.sin(t * .8) * .15); ell(c, 0, 0, 90, 90, '#3a4258', '#586284', 10); for (let i = 0; i < 3; i++) { c.rotate(TAU / 3); fillRR(c, -14, -250, 28, 250, 12, '#586284'); ell(c, 0, -250, 28, 28, '#6e7a9e'); } c.restore();
    fillRR(c, cx - 150, cy + 470, 300, 56, 12, '#e53935'); txt(c, TT('УБЕЖИЩЕ'), cx, cy + 498, 34, '#fff'); glow(c, cx, cy, 700, 'rgba(229,57,53,.18)', .5 + .3 * Math.sin(t * 5));
  },
  doorway(c, t, p) { BG.gradient(c, t, { sky: [p.wall, '#05060a'] }); fillRR(c, 270, 380, 540, 1000, 18, '#05060a', '#40486a', 14); const g = c.createLinearGradient(0, 400, 0, 1380); g.addColorStop(0, '#fff6c8'); g.addColorStop(1, '#ffb74d'); fillRR(c, 290, 400, 500, 960, 8, g); glow(c, 540, 880, 600, 'rgba(255,220,140,.5)', .6); c.fillStyle = p.floor; c.fillRect(0, 1380, W, 540); },
  city(c, t, p) {
    BG.gradient(c, t, p); const R = rng(11); for (let i = 0; i < 70; i++) { c.fillStyle = `rgba(255,255,255,${.2 + .6 * R() * (.7 + .3 * Math.sin(t * 2 + i))})`; c.fillRect(R() * W, R() * 800, 3, 3); }
    ell(c, 800, 380, 70, 70, '#f1f4ff'); glow(c, 800, 380, 260, 'rgba(200,215,255,.5)', .5);
    let x = -20; const R2 = rng(5); while (x < W) { const w = 90 + R2() * 90, h = 380 + R2() * 800; c.fillStyle = shade(p.wall, .6 + R2() * .5); c.fillRect(x, H - 420 - h, w, h + 420);
      for (let yy = H - 400 - h; yy < H - 440; yy += 56) for (let xx = x + 12; xx < x + w - 24; xx += 32) if (R2() > .55) { c.fillStyle = R2() > .5 ? 'rgba(255,214,120,.85)' : 'rgba(150,200,255,.6)'; c.fillRect(xx, yy, 16, 26); } x += w + 6; }
    c.fillStyle = p.floor; c.fillRect(0, 1500, W, 420);
  },
  street(c, t, p) { BG.gradient(c, t, p); c.fillStyle = '#0c0e16'; c.fillRect(0, 1200, W, 720); const o = (t * 600) % 240; for (let i = -1; i < 6; i++) fillRR(c, i * 240 - o + 40, 1560, 120, 18, 6, 'rgba(255,255,255,.5)'); for (let i = 0; i < 4; i++) { const x = 120 + i * 300; fillRR(c, x, 700, 14, 520, 4, '#1b2030'); glow(c, x + 7, 700, 220, 'rgba(255,214,120,.55)', .7); ell(c, x + 7, 700, 28, 14, '#ffe9a8'); } },
  office(c, t, p) { BG.gradient(c, t, { sky: [p.wall, '#06080f'] }); fillRR(c, 80, 300, 920, 520, 14, '#0a1020', '#34405e', 8); const g = c.createLinearGradient(0, 310, 0, 810); g.addColorStop(0, '#2a3a66'); g.addColorStop(1, '#0f1730'); fillRR(c, 92, 312, 896, 496, 8, g); c.fillStyle = p.floor; c.fillRect(0, 1380, W, 540); fillRR(c, 120, 1180, 840, 40, 8, '#2c3552'); fillRR(c, 150, 1220, 40, 200, 6, '#232b44'); fillRR(c, 890, 1220, 40, 200, 6, '#232b44'); fillRR(c, 360, 980, 360, 200, 12, '#0c1220', '#4a5a8a', 6); fillRR(c, 370, 990, 340, 180, 6, '#1b3a5c'); glow(c, 540, 1080, 340, 'rgba(110,170,255,.4)', .6); },
  space(c, t, p) { BG.gradient(c, t, p); const R = rng(3); for (let i = 0; i < 140; i++) { const sp = .05 + R() * .3; c.fillStyle = `rgba(255,255,255,${.3 + R() * .7})`; c.fillRect(R() * W, (R() * H + t * 40 * sp * 10) % H, 2 + R() * 3, 2 + R() * 3); } ell(c, 780, 520, 260, 260, '#2c4a86'); ell(c, 720, 470, 220, 190, 'rgba(120,170,255,.35)'); glow(c, 780, 520, 420, 'rgba(110,160,255,.3)', .5); c.save(); c.translate(300, 1320); c.rotate(-.3); ell(c, 0, 0, 110, 38, '#8a96b8'); ell(c, 0, -26, 56, 30, '#bcd6ff'); c.restore(); },
  lab(c, t, p) { BG.gradient(c, t, { sky: [p.wall, '#070b12'] }); c.fillStyle = 'rgba(255,255,255,.04)'; for (let x = 0; x < W; x += 120) for (let y = 0; y < 1300; y += 120) c.fillRect(x + 3, y + 3, 114, 114); c.fillStyle = p.floor; c.fillRect(0, 1380, W, 540); fillRR(c, 60, 1180, 960, 40, 8, '#3a4666'); for (let i = 0; i < 3; i++) { const x = 220 + i * 320; c.beginPath(); c.moveTo(x - 50, 1000); c.lineTo(x + 50, 1000); c.lineTo(x + 90, 1180); c.lineTo(x - 90, 1180); c.closePath(); c.fillStyle = ['rgba(80,230,160,.7)', 'rgba(255,120,200,.7)', 'rgba(110,190,255,.7)'][i]; c.fill(); for (let b = 0; b < 4; b++) ell(c, x - 30 + b * 20, 1160 - ((t * 60 + b * 40 + i * 20) % 120), 7, 7, 'rgba(255,255,255,.7)'); } },
  forest(c, t, p) { BG.gradient(c, t, { sky: ['#0f2b22', '#04100c'] }); const R = rng(9); for (let i = 0; i < 14; i++) { const x = R() * W, h = 700 + R() * 700; fillRR(c, x, H - 480 - h, 36 + R() * 40, h, 8, shade('#1b3b2e', .5 + R() * .6)); ell(c, x + 30, H - 480 - h, 130, 160, shade('#245a3f', .5 + R() * .5)); } c.fillStyle = '#0a1a14'; c.fillRect(0, 1450, W, 470); }
};
const BGNAMES = { gradient: 'Градиент', bedroom: 'Спальня ночью', corridor: 'Коридор', hall: 'Зал с толпой', grid: 'Сетка', hatch: 'Люк убежища', doorway: 'Дверной проём', city: 'Город', street: 'Улица', office: 'Офис', space: 'Космос', lab: 'Лаборатория', forest: 'Лес' };

/* ---------------- ИКОНКИ И ПРЕДМЕТЫ ---------------- */
const ICONS = {
  water(c, s, col) { c.beginPath(); c.moveTo(0, -s); c.quadraticCurveTo(s * .9, 0, s * .6, s * .5); c.arc(0, s * .35, s * .6, 0, Math.PI); c.quadraticCurveTo(-s * .9, 0, 0, -s); c.fillStyle = col || '#4fc3f7'; c.fill(); },
  food(c, s, col) { fillRR(c, -s * .6, -s * .6, s * 1.2, s * 1.3, s * .18, col || '#ffb74d'); fillRR(c, -s * .6, -s * .25, s * 1.2, s * .5, 0, '#fff3e0'); },
  filter(c, s, col) { ell(c, 0, 0, s * .8, s * .8, col || '#81c784'); for (let i = -2; i <= 2; i++) line(c, -s * .5, i * s * .25, s * .5, i * s * .25, 'rgba(0,0,0,.35)', s * .08); },
  door(c, s, col) { fillRR(c, -s * .5, -s * .85, s, s * 1.7, s * .1, col || '#8d6e63'); ell(c, s * .25, 0, s * .08, s * .08, '#ffe082'); },
  key(c, s, col) { ell(c, -s * .35, 0, s * .32, s * .32, null, col || '#ffd54f', s * .14); line(c, -s * .05, 0, s * .8, 0, col || '#ffd54f', s * .14); line(c, s * .55, 0, s * .55, s * .26, col || '#ffd54f', s * .12); },
  phone(c, s, col) { fillRR(c, -s * .4, -s * .8, s * .8, s * 1.6, s * .14, '#1a1d29', col || '#9ad', s * .06); fillRR(c, -s * .3, -s * .62, s * .6, s * 1.2, s * .06, col || '#90caf9'); },
  skull(c, s, col) { ell(c, 0, -s * .1, s * .7, s * .65, col || '#eceff1'); fillRR(c, -s * .3, s * .3, s * .6, s * .4, s * .08, col || '#eceff1'); ell(c, -s * .25, -s * .1, s * .17, s * .2, '#14161f'); ell(c, s * .25, -s * .1, s * .17, s * .2, '#14161f'); },
  heart(c, s, col) { c.beginPath(); c.moveTo(0, s * .7); c.bezierCurveTo(-s * 1.2, -s * .1, -s * .5, -s * .9, 0, -s * .3); c.bezierCurveTo(s * .5, -s * .9, s * 1.2, -s * .1, 0, s * .7); c.fillStyle = col || '#ef5350'; c.fill(); },
  money(c, s, col) { ell(c, 0, 0, s * .8, s * .8, col || '#ffc107', '#b28704', s * .08); txt(c, '$', 0, s * .04, s * 1.1, '#7a5a00'); },
  chart(c, s, col) { [.5, 1, .75, 1.35].forEach((h, i) => fillRR(c, -s * .8 + i * s * .42, s * .7 - h * s, s * .3, h * s, s * .05, col || '#4dd0e1')); },
  rocket(c, s, col) { poly(c, [[0, -s], [s * .4, s * .2], [-s * .4, s * .2]], col || '#eceff1'); poly(c, [[-s * .4, s * .2], [-s * .8, s * .75], [-s * .2, s * .4]], '#e53935'); poly(c, [[s * .4, s * .2], [s * .8, s * .75], [s * .2, s * .4]], '#e53935'); ell(c, 0, -s * .2, s * .16, s * .16, '#4fc3f7'); },
  bolt(c, s, col) { poly(c, [[s * .2, -s], [-s * .5, s * .1], [-s * .05, s * .1], [-s * .2, s], [s * .5, -s * .2], [s * .05, -s * .2]], col || '#ffee58'); },
  lock(c, s, col) { c.strokeStyle = col || '#b0bec5'; c.lineWidth = s * .16; c.beginPath(); c.arc(0, -s * .2, s * .4, Math.PI, 0); c.stroke(); fillRR(c, -s * .6, -s * .2, s * 1.2, s * .9, s * .12, col || '#ffd54f'); },
  fire(c, s, col) { c.beginPath(); c.moveTo(0, -s); c.bezierCurveTo(s * .9, -s * .1, s * .8, s * .8, 0, s * .8); c.bezierCurveTo(-s * .8, s * .8, -s * .9, -s * .1, 0, -s); c.fillStyle = col || '#ff7043'; c.fill(); ell(c, 0, s * .4, s * .3, s * .4, '#ffee58'); },
  radiation(c, s, col) { ell(c, 0, 0, s * .9, s * .9, '#ffd600', '#14161f', s * .07); for (let i = 0; i < 3; i++) { c.save(); c.rotate(i * TAU / 3); c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, s * .7, -Math.PI / 2 - .5, -Math.PI / 2 + .5); c.closePath(); c.fillStyle = '#14161f'; c.fill(); c.restore(); } ell(c, 0, 0, s * .16, s * .16, '#14161f'); },
  house(c, s, col) { poly(c, [[0, -s], [s, -s * .1], [-s, -s * .1]], '#e53935'); fillRR(c, -s * .75, -s * .1, s * 1.5, s * .9, s * .06, col || '#ffcc80'); fillRR(c, -s * .15, s * .2, s * .3, s * .6, s * .04, '#6d4c41'); },
  clock(c, s, col) { ell(c, 0, 0, s * .9, s * .9, '#fafafa', col || '#455a64', s * .1); line(c, 0, 0, 0, -s * .55, '#263238', s * .1); line(c, 0, 0, s * .4, s * .15, '#263238', s * .1); },
  warning(c, s, col) { poly(c, [[0, -s], [s, s * .8], [-s, s * .8]], col || '#ffd600'); txt(c, '!', 0, s * .3, s * 1.1, '#14161f'); },
  star(c, s, col) { c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? s * .4 : s, a = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fillStyle = col || '#ffd54f'; c.fill(); },
  user(c, s, col) { ell(c, 0, -s * .4, s * .38, s * .38, col || '#b0bec5'); c.beginPath(); c.arc(0, s * .9, s * .8, Math.PI, 0); c.fillStyle = col || '#b0bec5'; c.fill(); }
};
const ICONNAMES = Object.keys(ICONS);
function icon(c, name, x, y, s, col) { c.save(); c.translate(x, y); (ICONS[name] || ICONS.star)(c, s, col); c.restore(); }
const PROPS = { popup: 'Плашка', cards: 'Карточки', text: 'Крупный текст', timer: 'Таймер', counter: 'Счётчик', chat: 'Чат', sign: 'Табличка', emoji: 'Эмодзи', icon: 'Иконка', bar: 'Полоса', math: 'Формула', arrow: 'Стрелка', choice: 'Выбор A/B/C' };

function drawProp(c, p, t, th, sc) {
  const at = p.at || 0, dur = p.dur == null ? 999 : p.dur, lt = t - at;
  if (lt < 0 || lt > dur) return;
  const pop = easeBack(lt / .28), fade = clamp((dur - lt) / .15), x = (p.x == null ? .5 : p.x) * W, y = (p.y == null ? .4 : p.y) * H, s = p.s || 1, col = p.color || th.a;
  c.save(); c.globalAlpha = fade; c.translate(x, y); c.scale(s * (.6 + .4 * pop), s * (.6 + .4 * pop)); if (p.rot) c.rotate(p.rot * Math.PI / 180);
  const T = p.text || '', T2 = p.text2 || '';
  switch (p.type) {
    case 'popup': { c.font = `900 56px ${FONT}`; const w = Math.max(520, Math.min(900, c.measureText(T).width + 120)), h = T2 ? 200 : 130; glow(c, 0, 0, 480, col, .25); fillRR(c, -w / 2, -h / 2, w, h, 28, 'rgba(8,11,22,.94)', col, 6); txt(c, T, 0, T2 ? -34 : 0, 56, th.ink); if (T2) txt(c, T2, 0, 42, 38, col, { w: 800 }); break; }
    case 'cards': { const it = p.items || [], n = it.length || 1, cw = Math.min(300, (940 - (n - 1) * 24) / n), tw = n * cw + (n - 1) * 24; it.forEach((o, i) => { const bx = -tw / 2 + i * (cw + 24), k = easeBack((lt - i * .12) / .3); c.save(); c.translate(bx + cw / 2, 0); c.scale(.6 + .4 * k, .6 + .4 * k); c.globalAlpha = clamp(k); fillRR(c, -cw / 2, -150, cw, 300, 26, 'rgba(8,11,22,.92)', o.color || col, 5); icon(c, o.icon || 'star', 0, -50, cw * .22, o.color); txt(c, o.label || '', 0, 70, 32, th.ink, { w: 800 }); if (o.value) txt(c, o.value, 0, 118, 44, o.color || th.hl); c.restore(); }); break; }
    case 'text': { c.font = `900 ${p.size || 110}px ${FONT}`; const ls = wrapLines(c, T, 940); ls.forEach((l, i) => txt(c, l, 0, (i - (ls.length - 1) / 2) * (p.size || 110) * 1.1, p.size || 110, p.color || th.ink, { stroke: '#000', sw: 14 })); break; }
    case 'timer': { const v = Math.max(0, lerp(p.from == null ? 180 : p.from, p.to == null ? 0 : p.to, lt / Math.max(.1, Math.min(dur, p.span || dur)))) | 0; fillRR(c, -270, -110, 540, 220, 30, 'rgba(8,11,22,.94)', col, 6); txt(c, T || TT('ДО ЗАКРЫТИЯ'), 0, -66, 34, '#c8cde0', { w: 800 }); txt(c, String((v / 60) | 0).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0'), 0, 20, 124, (v < 30 && ((lt * 4) | 0) % 2) ? '#ff8a80' : col); break; }
    case 'counter': { const v = Math.round(lerp(p.from || 0, p.to == null ? 100 : p.to, easeOut(lt / (p.span || 1.6)))); txt(c, (p.prefix || '') + v.toLocaleString('ru-RU') + (p.suffix || ''), 0, 0, p.size || 190, col, { stroke: '#000', sw: 18 }); if (T) txt(c, T, 0, (p.size || 190) * .65, 50, th.ink, { stroke: '#000', sw: 10 }); break; }
    case 'chat': { const ms = p.items || []; let yy = -(ms.length * 130) / 2; ms.forEach((m, i) => { const k = easeBack((lt - i * (p.gap || .9)) / .3); if (k <= 0) { yy += 130; return; } const me = m.who === 'me'; c.font = `700 40px ${FONT}`; const w = Math.min(760, c.measureText(m.text).width + 70); c.save(); c.globalAlpha = clamp(k); c.translate(me ? 440 : -440, yy); c.scale(.7 + .3 * k, .7 + .3 * k); fillRR(c, me ? -w : 0, -52, w, 104, 40, me ? '#2f7cf6' : '#2a2f40'); txt(c, m.text, me ? -w / 2 : w / 2, 0, 40, '#fff', { w: 700 }); c.restore(); yy += 130; }); break; }
    case 'sign': { fillRR(c, -20, 40, 40, 360, 8, '#4b4f60'); c.font = `900 70px ${FONT}`; const w = c.measureText(T).width + 110; fillRR(c, -w / 2, -80, w, 150, 18, col, '#fff', 8); txt(c, T, 0, -5, 70, '#fff'); break; }
    case 'emoji': { c.font = `${p.size || 260}px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.translate(0, Math.sin(lt * 3) * 10); c.fillText(T || '🔥', 0, 0); break; }
    case 'icon': { icon(c, p.icon || 'star', 0, Math.sin(lt * 3) * 8, p.size || 200, p.color); if (T) txt(c, T, 0, (p.size || 200) + 70, 50, th.ink, { stroke: '#000', sw: 10 }); break; }
    case 'bar': { const k = clamp(lerp(p.from || 0, p.to == null ? 1 : p.to, lt / (p.span || dur > 100 ? 3 : p.span || dur))); fillRR(c, -420, -30, 840, 60, 28, 'rgba(8,11,22,.92)', '#46506e', 4); fillRR(c, -412, -22, Math.max(24, 824 * k), 44, 22, col); txt(c, T, 0, -66, 40, th.ink, { w: 800 }); txt(c, Math.round(k * 100) + '%', 0, 0, 34, '#fff'); break; }
    case 'math': { c.font = `800 ${p.size || 84}px ui-monospace,Consolas,monospace`; const w = c.measureText(T).width + 100; fillRR(c, -w / 2, -80, w, 160, 24, 'rgba(8,11,22,.94)', col, 5); txt(c, T, 0, 0, p.size || 84, th.ink, { f: 'ui-monospace,Consolas,monospace', w: 800 }); break; }
    case 'choice': { const it = p.items || [], n = Math.max(1, it.length), ch = 150, gap = 26, tot = n * ch + (n - 1) * gap, cols = ['#ff5a7d', '#4fc3f7', '#ffd54a', '#7ddc8a']; if (T) txt(c, T, 0, -tot / 2 - 80, 56, th.ink, { w: 900 }); it.forEach((o, i) => { const k = easeBack((lt - .3 - i * .35) / .32), cc = o.color || cols[i % 4], by = -tot / 2 + i * (ch + gap) + ch / 2, s2 = o.text || ''; c.save(); c.translate(0, by); c.scale(.7 + .3 * k, .7 + .3 * k); c.globalAlpha = clamp(k); fillRR(c, -470, -ch / 2, 940, ch, 30, 'rgba(8,11,22,.94)', cc, 6); c.fillStyle = cc; c.beginPath(); c.arc(-375, 0, 52, 0, 7); c.fill(); txt(c, o.k || String.fromCharCode(65 + i), -375, 3, 64, '#0b0e18', { w: 900 }); txt(c, s2, -305, 0, s2.length > 30 ? 38 : s2.length > 22 ? 44 : 52, th.ink, { al: 'left', w: 800 }); c.restore(); }); if (T2) { const k = clamp((lt - .3 - n * .35) / .3), pul = 1 + Math.sin(lt * 5) * .04; c.save(); c.globalAlpha = k; c.translate(0, tot / 2 + 90); c.scale(pul, pul); c.font = `900 48px ${FONT}`; const tw2 = c.measureText(T2).width + 70; fillRR(c, -tw2 / 2, -46, tw2, 92, 46, 'rgba(8,11,22,.92)', th.hl, 4); txt(c, T2, 0, 2, 48, th.hl, { w: 900 }); c.restore(); } break; }
    case 'arrow': { c.translate(0, Math.sin(lt * 6) * 14); poly(c, [[0, 120], [-90, 10], [-34, 10], [-34, -120], [34, -120], [34, 10], [90, 10]], col); break; }
  }
  c.restore();
}

/* ---------------- ЭФФЕКТЫ ---------------- */
const FXN = { shake: 'Тряска камеры', flash: 'Вспышки', redpulse: 'Красная пульсация', siren: 'Мигалка', rain: 'Дождь', snow: 'Снег', dust: 'Пыль', glitch: 'Глитч', scan: 'Строки ТВ', noise: 'Зерно', dark: 'Затемнение', shock: 'Ударная волна' };
function drawFx(c, fx, t, th, dur) {
  for (const f of fx || []) {
    if (f === 'redpulse') { c.fillStyle = `rgba(229,57,53,${.08 + .12 * (Math.sin(t * 6) * .5 + .5)})`; c.fillRect(0, 0, W, H); }
    else if (f === 'siren') { const k = Math.sin(t * 7); c.fillStyle = k > 0 ? `rgba(255,40,40,${.22 * k})` : `rgba(40,100,255,${-.22 * k})`; c.fillRect(0, 0, W, H); }
    else if (f === 'flash') { const k = Math.pow(Math.max(0, Math.sin(t * 9) * Math.sin(t * 2.3)), 6); if (k > 0) { c.fillStyle = `rgba(255,255,255,${k * .55})`; c.fillRect(0, 0, W, H); } }
    else if (f === 'rain') { const R = rng(21); c.strokeStyle = 'rgba(190,210,255,.35)'; c.lineWidth = 3; for (let i = 0; i < 90; i++) { const x = R() * W, y = (R() * H + t * 1900 * (.6 + R() * .5)) % H; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 18, y + 70); c.stroke(); } }
    else if (f === 'snow') { const R = rng(22); c.fillStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i < 90; i++) { const x = (R() * W + Math.sin(t + i) * 30) % W, y = (R() * H + t * 160 * (.5 + R())) % H; ell(c, x, y, 4 + R() * 5, 4 + R() * 5, c.fillStyle); } }
    else if (f === 'dust') { const R = rng(23); for (let i = 0; i < 60; i++) { const x = (R() * W + t * 18 * (R() - .5) * 4 + W) % W, y = (R() * H - t * 22 * R() + H) % H; ell(c, x, y, 3, 3, `rgba(255,230,180,${.15 + .3 * R()})`); } }
    else if (f === 'glitch') { const k = (t * 8) | 0; if (k % 5 === 0) { const R = rng(k); for (let i = 0; i < 4; i++) { c.fillStyle = `rgba(${R() > .5 ? '255,40,80' : '40,220,255'},.25)`; c.fillRect(0, R() * H, W, 10 + R() * 60); } } }
    else if (f === 'scan') { c.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < H; y += 6) c.fillRect(0, y, W, 2); }
    else if (f === 'noise') { const R = rng((t * 20) | 0); c.fillStyle = 'rgba(255,255,255,.06)'; for (let i = 0; i < 260; i++) c.fillRect(R() * W, R() * H, 3, 3); }
    else if (f === 'dark') { c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(0, 0, W, H); }
    else if (f === 'shock') { const k = (t % 1.4) / 1.4; c.strokeStyle = `rgba(255,255,255,${.5 * (1 - k)})`; c.lineWidth = 14; c.beginPath(); c.arc(W / 2, 900, k * 1300, 0, TAU); c.stroke(); }
  }
}

/* ---------------- HUD ---------------- */
function keyval(keys, t) { if (!keys || !keys.length) return 0; if (t <= keys[0][0]) return keys[0][1]; for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) return lerp(keys[i - 1][1], keys[i][1], (t - keys[i - 1][0]) / Math.max(1e-6, keys[i][0] - keys[i - 1][0])); return keys[keys.length - 1][1]; }
function drawHud(c, hud, t, th) {
  if (!hud || hud.on === false) return;
  const pl = (hud.plates || []).slice(0, 2), y0 = hud.y == null ? 250 : hud.y;
  pl.forEach((p, i) => {
    const x = i ? 560 : 40, v = keyval(p.keys, t), col = p.color || (i ? th.b : th.a);
    fillRR(c, x, y0, 480, 150, 26, 'rgba(8,11,22,.92)', col, 4); txt(c, p.label || '', x + 240, y0 + 28, 30, '#c8cde0', { w: 700 });
    let s; if (p.fmt === 'time') { const r = Math.max(0, v | 0); s = String((r / 60) | 0).padStart(2, '0') + ':' + String(r % 60).padStart(2, '0'); } else s = Math.round(v).toLocaleString('ru-RU') + (p.suffix || '');
    const blink = p.fmt === 'time' && v < 600 && ((v | 0) % 2) ? shade(col.startsWith('#') ? col : '#e53935', 1.35) : col; txt(c, s, x + 240, y0 + 86, 84, blink);
  });
  const b = hud.bar; if (b) {
    const y = y0 + 174, v = keyval(b.keys, t), max = b.max || 100, mark = b.mark; fillRR(c, 40, y, 1000, 52, 20, 'rgba(8,11,22,.92)', '#46506e', 3);
    const x0 = 54, x1 = 1026, fx = x0 + (x1 - x0) * clamp(v / max), tk = mark != null ? x0 + (x1 - x0) * mark / max : x1;
    fillRR(c, x0, y + 12, Math.max(8, Math.min(fx, tk) - x0), 28, 12, b.color || th.b); if (mark != null && fx > tk) { c.fillStyle = th.a; c.fillRect(tk, y + 12, fx - tk, 28); c.fillStyle = '#fff'; c.fillRect(tk - 2, y + 6, 4, 40); }
    txt(c, b.label || '', 72, y + 27, 24, '#fff', { al: 'left', w: 800, stroke: '#000', sw: 4 }); txt(c, String(Math.round(v)), x1 - 14, y + 27, 30, v > (mark == null ? 1e9 : mark) ? '#ff968c' : '#fff', { al: 'right', stroke: '#000', sw: 4 });
  }
}

/* ---------------- СУБТИТРЫ ---------------- */
function parseCap(s) { const out = []; let on = false; for (const w of String(s).split(' ')) { let hl = on; let word = w; if (word.startsWith('*')) { on = true; hl = true; word = word.slice(1); } if (word.endsWith('*')) { on = false; word = word.slice(0, -1); } if (word) out.push({ w: word, hl }); } return out; }
function stripCap(s) { return String(s).replace(/\*/g, ''); }
function drawCap(c, cap, lt, th, P) {
  const o = P.cap || {}, size = o.size || 104, words = parseCap(cap.text);
  c.font = `900 ${size}px ${FONT}`; const maxW = 960, lines = []; let cur = [];
  for (const w of words) { const test = cur.concat(w).map(x => x.w).join(' '); if (c.measureText(test).width > maxW && cur.length) { lines.push(cur); cur = [w]; } else cur.push(w); } if (cur.length) lines.push(cur);
  const sc = lt < .14 ? .88 + .12 * easeBack(lt / .14) : 1, cy = (o.y == null ? .72 : o.y) * H, lh = size * 1.12;
  c.save(); c.translate(W / 2, cy); c.scale(sc, sc);
  lines.forEach((ln, li) => { const yy = (li - (lines.length - 1) / 2) * lh, full = ln.map(x => x.w).join(' '), wid = c.measureText(full).width; let x = -wid / 2; const sp = c.measureText(' ').width;
    for (const w of ln) { c.textAlign = 'left'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.lineWidth = size * .1; c.strokeStyle = '#000'; c.strokeText(w.w, x, yy); c.fillStyle = w.hl ? (o.hl || th.hl) : th.ink; c.fillText(w.w, x, yy); x += c.measureText(w.w).width + sp; } });
  c.restore();
}

/* ---------------- СБОРКА КАДРА ---------------- */
function timeline(P) { let s = 0; return P.scenes.map(sc => { const o = { s, e: s + sc.dur, sc }; s += sc.dur; return o; }); }
function total(P) { return P.scenes.reduce((a, s) => a + (+s.dur || 0), 0); }
function sceneAt(P, t) { const tl = timeline(P); for (let i = 0; i < tl.length; i++) if (t < tl[i].e || i === tl.length - 1) return { i, ...tl[i], lt: Math.max(0, t - tl[i].s) }; return null; }

function drawScene(c, P, t) {
  const th = THEMES[P.theme] || THEMES.bunker, S = sceneAt(P, t); if (!S) { c.fillStyle = '#000'; c.fillRect(0, 0, W, H); return; }
  const sc = S.sc, lt = S.lt;
  c.save();
  const z = lerp((sc.zoom || [1, 1])[0], (sc.zoom || [1, 1])[1], lt / Math.max(.1, sc.dur)); let sx = 0, sy = 0;
  if ((sc.fx || []).includes('shake')) { sx = Math.sin(t * 61) * 9; sy = Math.cos(t * 53) * 9; }
  c.translate(W / 2 + sx, H / 2 + sy); c.scale(z, z); c.translate(-W / 2, -H / 2);
  (BG[sc.bg] || BG.gradient)(c, lt, th, sc);
  for (const m of (sc.cast || [])) { const ch = (P.chars || {})[m.c]; let x = (m.x == null ? .5 : m.x), y = (m.y == null ? .78 : m.y); if (m.tx != null) { const k = easeOut(lt / Math.max(.3, sc.dur * (m.span || 1))); x = lerp(x, m.tx, k); } if (m.ty != null) { const k = easeOut(lt / Math.max(.3, sc.dur * (m.span || 1))); y = lerp(y, m.ty, k); }
    let anim = m.anim || 'idle'; const enter = m.enter == null ? 0 : m.enter; if (lt < enter) continue; drawChar(c, ch, x * W, y * H, (m.s || .9) * (m.pop === false ? 1 : .6 + .4 * easeBack((lt - enter) / .3)), lt, anim, m.expr || 'calm', m.flip); }
  for (const p of (sc.props || [])) drawProp(c, p, lt, th, sc);
  c.restore();
  drawFx(c, sc.fx, t, th, sc.dur);
  // виньетка
  if (P.vignette !== false) { const g = c.createRadialGradient(W / 2, H / 2, W * .45, W / 2, H / 2, H * .72); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.62)'); c.fillStyle = g; c.fillRect(0, 0, W, H); }
  drawHud(c, P.hud, t, th);
  for (const cp of (sc.caps || [])) if (lt >= cp.at && lt < cp.at + cp.dur) { drawCap(c, cp, lt - cp.at, th, P); break; }
  if (lt < .16) { c.fillStyle = `rgba(0,0,0,${1 - lt / .16})`; c.fillRect(0, 0, W, H); }
  if (S.i === P.scenes.length - 1 && P.outFade !== false && t > total(P) - .3) { c.fillStyle = `rgba(0,0,0,${clamp((t - (total(P) - .3)) / .3)})`; c.fillRect(0, 0, W, H); }
}

G.StudioEngine = { W, H, THEMES, HAIR, ACC, ANIMS, EXPR, BG, BGNAMES, ICONNAMES, PROPS, FXN, drawChar, drawScene, total, timeline, sceneAt, parseCap, stripCap, keyval, FONT };
})(window);
