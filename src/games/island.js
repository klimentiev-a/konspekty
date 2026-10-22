/* ===================================================================
   Остров-курорт · игра для Hub
   Процедурный 3D-остров (сид сохраняется), постройки с бонусами соседства
   (в духе Islanders), туристы на лодках и вертолётах, рейтинг 1–5 звёзд,
   цели-ступени, случайные события, день/ночь с огнями.
   Движок: engine.js (глобальный G), THREE r152. ES5, без модулей.
   =================================================================== */
(function () {
'use strict';
var T = THREE, PI = Math.PI;
var g = G.create({ key: 'island', bg: 0x9fd6e8, dist: 50, minDist: 14, maxDist: 95, bound: 32 });
window.__g = g;
var scene = g.scene;

/* ========== 1. Константы, типы построек, правила соседства ========== */
var N = 40;                       // клеток острова по стороне
var S = 1.5;                      // размер клетки (юниты)
var MG = 64, OFF = (MG - N) / 2;  // общий рельеф с морским дном 64×64
var LVL_Y = [0.35, 0.95, 1.55, 2.2, 3.1]; // высоты уровней: пляж, трава, трава, холм, скалы
var DAY_LEN = 150;                // секунд на сутки
var LVL_MUL = [1, 1.6, 2.4], CAP_MUL = [1, 1.5, 2], UP_COST = [0, .8, 1.2];
var ROMAN = ['', 'I', 'II', 'III'];

/* правила: [что, радиус, бонус %, максимум совпадений] */
var TYPES = {
  hut:        { n: 'Хижина',      e: '🛖', cost: 100, inc: 15,  cap: 2,  d: 'Домик на двоих. Любит пляж и пальмы, не любит шум.',
                r: [['beach', 1, 15, 1], ['palm', 1, 6, 3], ['park', 2, 10, 1], ['noise', 1, -15, 2], ['hotel', 1, -10, 1]] },
  bungalow:   { n: 'Бунгало',     e: '🏡', cost: 260, inc: 35,  cap: 4,  d: 'Уютный дом у воды. Пляж, вид на море, бассейн рядом.',
                r: [['beach', 1, 15, 1], ['sea', 1, 10, 1], ['palm', 1, 5, 4], ['pool', 2, 15, 1], ['noise', 1, -20, 2]] },
  hotel:      { n: 'Отель',       e: '🏨', cost: 900, inc: 120, cap: 12, d: 'Много гостей. Любит море, маяк, ресторан и бассейн. Не любит тесноту и шум.',
                r: [['sea', 2, 20, 1], ['lighthouse', 3, 15, 1], ['restaurant', 2, 15, 1], ['pool', 2, 15, 1], ['park', 2, 10, 1], ['hotel', 1, -15, 2], ['noise', 1, -20, 2]] },
  path:       { n: 'Дорожка',     e: '🛤️', cost: 8,   inc: 0,  d: 'По дорожкам туристы ходят быстрее. Сама соединяется с соседями.', r: [] },
  palm:       { n: 'Пальма',      e: '🌴', cost: 20,  inc: 0,  d: 'Украшение. Даёт бонус хижинам, бунгало, бару и бассейну рядом.', r: [] },
  bar:        { n: 'Пляжный бар', e: '🍹', cost: 220, inc: 40, noisy: 1, d: 'Шумное место. Хорош у пляжа и рядом с жильём, но не с другим баром.',
                r: [['beach', 1, 20, 1], ['lodging', 2, 5, 6], ['palm', 1, 5, 3], ['sea', 1, 10, 1], ['bar', 2, -25, 1]] },
  restaurant: { n: 'Ресторан',    e: '🍽️', cost: 480, inc: 60, d: 'Любит отели, вид на море и парк рядом.',
                r: [['hotel', 2, 15, 2], ['sea', 1, 15, 1], ['park', 2, 10, 1], ['lodging', 2, 4, 6], ['restaurant', 2, -20, 1]] },
  pool:       { n: 'Бассейн',     e: '🏊', cost: 380, inc: 30, d: 'Чем больше жилья вокруг, тем лучше. Два бассейна рядом — лишнее.',
                r: [['lodging', 1, 8, 6], ['palm', 1, 4, 4], ['pool', 2, -25, 1]] },
  park:       { n: 'Парк',        e: '🌳', cost: 150, inc: 8,  d: 'Тихое зелёное место. Радует соседей-жильцов.',
                r: [['lodging', 1, 5, 8], ['tree', 1, 5, 4]] },
  pier:       { n: 'Пирс',        e: '⚓', cost: 300, inc: 20, shore: 1, d: 'Сюда приплывают лодки с туристами. Только у берега.',
                r: [['lighthouse', 3, 20, 1], ['diving', 2, 15, 1], ['bar', 1, 10, 1], ['pier', 2, -20, 1]] },
  lighthouse: { n: 'Маяк',        e: '🗼', cost: 550, inc: 10, shore: 1, d: 'Светит ночью. Бонус отелям и пирсам поблизости.',
                r: [['sea', 1, 10, 3], ['hotel', 3, 5, 3]] },
  diving:     { n: 'Дайвинг',     e: '🤿', cost: 420, inc: 55, shore: 1, d: 'Подводные прогулки. Любит пирс рядом.',
                r: [['pier', 2, 20, 1], ['lodging', 2, 5, 6], ['diving', 2, -30, 1]] },
  helipad:    { n: 'Вертодром',   e: '🚁', cost: 750, inc: 25, noisy: 1, d: 'Вертолёты привозят гостей быстрее. Шумно для соседей.',
                r: [['hotel', 2, 15, 2], ['helipad', 3, -40, 1]] }
};
var ORDER = ['hut', 'bungalow', 'hotel', 'path', 'palm', 'bar', 'restaurant', 'pool', 'park', 'pier', 'lighthouse', 'diving', 'helipad'];
var UNLOCK = { hut: 0, path: 0, palm: 0, bungalow: 1, bar: 1, pool: 2, park: 2, hotel: 3, restaurant: 3, pier: 4, lighthouse: 4, diving: 5, helipad: 5 };
var LODGING = { hut: 1, bungalow: 1, hotel: 1 };
var AMEN = ['bar', 'restaurant', 'pool', 'diving', 'park', 'lighthouse', 'helipad'];
var VISIT = { bar: 1, restaurant: 1, pool: 1, park: 1, diving: 1, pier: 1, lighthouse: 1 };
var TAGN = { beach: 'пляж', sea: 'море', palm: 'пальмы', tree: 'деревья', park: 'парк', noise: 'шум', hotel: 'отель', lodging: 'гости рядом',
             bar: 'бар', pool: 'бассейн', restaurant: 'ресторан', lighthouse: 'маяк', pier: 'пирс', diving: 'дайвинг', helipad: 'вертодром' };

/* ========== 2. Состояние ========== */
var st = null, rating = { score: 0, stars: 1, parts: [] }, totals = { cap: 0, inc: 0 };
function newState(seed) {
  return { v: 1, seed: seed, money: 500, time: 0, bld: [], cut: [], goal: 0, earned: 0, won: false, nextEv: 80, tourists: 0, built: 0, days: 0 };
}
function unlocked(t) { return st.goal >= UNLOCK[t]; }
function maxLevel() { return st.goal >= 5 ? 3 : st.goal >= 3 ? 2 : 1; }

/* ========== 3. Сетка и рельеф ========== */
var W = { land: new Uint8Array(N * N), lvl: new Uint8Array(N * N), shore: new Uint8Array(N * N), decor: new Uint8Array(N * N),
          dRot: new Float32Array(N * N), dScl: new Float32Array(N * N), cellY: new Float32Array(N * N), bAt: new Int16Array(N * N),
          vy: new Float32Array((MG + 1) * (MG + 1)), cost: new Float32Array(N * N), thr: 0 };
function idx(i, j) { return i * N + j; }
function inb(i, j) { return i >= 0 && j >= 0 && i < N && j < N; }
function cx(i) { return (i - N / 2 + .5) * S; }
function cz(j) { return (j - N / 2 + .5) * S; }
function vi(i, j) { return (i + OFF) * (MG + 1) + (j + OFF); }
function cellAt(x, z) { return { i: Math.floor(x / S + N / 2), j: Math.floor(z / S + N / 2) }; }
function isLand(i, j) { return inb(i, j) && W.land[idx(i, j)] === 1; }
/* высота рельефа в точке (билинейно по вершинам) */
function terrainY(x, z) {
  var fx = x / S + N / 2, fz = z / S + N / 2, i = Math.floor(fx), j = Math.floor(fz);
  if (i < -OFF || j < -OFF || i >= N + OFF || j >= N + OFF) return -5;
  var tx = fx - i, tz = fz - j, a = W.vy[vi(i, j)], b = W.vy[vi(i + 1, j)], c = W.vy[vi(i, j + 1)], d = W.vy[vi(i + 1, j + 1)];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

function genWorld(seed) {
  var wr = g.rng(seed), nz = g.noise2(seed * 7 + 1);
  var ox = wr() * 100, oy = wr() * 100, ax = .85 + wr() * .35, ay = .85 + wr() * .35, rot = wr() * PI;
  function val(x, y) {
    var dx = x - N / 2, dy = y - N / 2;
    var rx = (dx * Math.cos(rot) - dy * Math.sin(rot)) * ax, ry = (dx * Math.sin(rot) + dy * Math.cos(rot)) * ay;
    var d = Math.sqrt(rx * rx + ry * ry) / (N / 2 - 1.5);
    return g.fbm(nz, x * .13 + ox, y * .13 + oy) + (1 - d * d) * .8;
  }
  var v = new Float32Array(N * N), i, j, k;
  for (i = 0; i < N; i++) for (j = 0; j < N; j++) v[idx(i, j)] = val(i + .5, j + .5);
  var sorted = Array.prototype.slice.call(v).sort(function (a, b) { return b - a; });
  var target = 780 + Math.floor(wr() * 90), thr = sorted[target]; W.thr = thr;
  /* суша = выше порога; оставляем только главный «материк» */
  var raw = new Uint8Array(N * N), best = 0;
  for (k = 0; k < N * N; k++) { raw[k] = v[k] > thr ? 1 : 0; if (v[k] > v[best]) best = k; }
  var q = [best], seen = new Uint8Array(N * N); seen[best] = 1; W.land.fill(0);
  while (q.length) { k = q.pop(); W.land[k] = 1; i = (k / N) | 0; j = k % N;
    var nb = [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]];
    for (var n = 0; n < 4; n++) { var a = nb[n][0], b = nb[n][1]; if (inb(a, b)) { var kk = idx(a, b); if (raw[kk] && !seen[kk]) { seen[kk] = 1; q.push(kk); } } } }
  var vmax = sorted[0];
  function lvlOf(x) { var rel = (x - thr) / (vmax - thr); return rel < .11 ? 0 : rel < .4 ? 1 : rel < .68 ? 2 : rel < .86 ? 3 : 4; }
  for (k = 0; k < N * N; k++) W.lvl[k] = W.land[k] ? lvlOf(v[k]) : 0;
  /* вершины: на суше — высота уровня (в пределах уровней соседних клеток), в море — глубина */
  for (var I = 0; I <= MG; I++) for (var J = 0; J <= MG; J++) {
    i = I - OFF; j = J - OFF; var vv = val(i, j), lo = 9, hi = -1;
    for (var di = -1; di <= 0; di++) for (var dj = -1; dj <= 0; dj++) if (isLand(i + di, j + dj)) { var l = W.lvl[idx(i + di, j + dj)]; if (l < lo) lo = l; if (l > hi) hi = l; }
    if (hi >= 0) { var lv = Math.max(lo, Math.min(hi, lvlOf(vv))); W.vy[vi(i, j)] = LVL_Y[lv]; }
    else W.vy[vi(i, j)] = Math.max(-6, Math.min(-.55, -.55 - (thr - vv) * 12));
  }
  for (i = 0; i < N; i++) for (j = 0; j < N; j++) { k = idx(i, j);
    W.cellY[k] = Math.max(W.vy[vi(i, j)], W.vy[vi(i + 1, j)], W.vy[vi(i, j + 1)], W.vy[vi(i + 1, j + 1)]);
    W.shore[k] = W.land[k] && (!isLand(i + 1, j) || !isLand(i - 1, j) || !isLand(i, j + 1) || !isLand(i, j - 1)) ? 1 : 0;
  }
  /* декор: пальмы на пляже, деревья и кусты в траве, камни на холмах */
  for (k = 0; k < N * N; k++) { var r = wr(); W.dRot[k] = wr() * PI * 2; W.dScl[k] = .8 + wr() * .45; var d = 0;
    if (W.land[k]) { var L = W.lvl[k];
      if (L === 0) d = r < .24 ? 1 : r < .3 ? 5 : 0;
      else if (L <= 2) d = r < .15 ? 2 : r < .24 ? 3 : r < .33 ? 5 : r < .36 ? 1 : 0;
      else if (L === 3) d = r < .22 ? 4 : r < .3 ? 2 : r < .36 ? 3 : 0;
      else d = r < .5 ? 4 : 0; }
    W.decor[k] = d; }
}
/* направление в открытое море от прибрежной клетки (0:+z 1:+x 2:-z 3:-x) или -1 */
function seaDir(i, j) {
  var D = [[0, 1], [1, 0], [0, -1], [-1, 0]], best = -1, bs = 0;
  for (var k = 0; k < 4; k++) { var s = 0; for (var n = 1; n <= 3; n++) if (!isLand(i + D[k][0] * n, j + D[k][1] * n)) s++; else break;
    if (s > bs) { bs = s; best = k; } }
  return bs >= 2 ? best : -1;
}

/* ========== 4. Материалы с «ночным свечением» и покачиванием ========== */
var uNight = { value: 0 }, uTime = { value: 0 }, uWave = { value: .07 };
function vcMaterial(sway, opts) {
  var m = new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .85, metalness: 0 });
  if (opts) for (var k in opts) m[k] = opts[k];
  m.onBeforeCompile = function (sh) {
    sh.uniforms.uNight = uNight; sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vGlow; uniform float uTime;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvGlow = aGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + (sway ? '\n#ifdef USE_INSTANCING\nfloat swp = uTime*1.4 + instanceMatrix[3][0]*.6 + instanceMatrix[3][2]*.4;\ntransformed.x += sin(swp)*transformed.y*transformed.y*.03; transformed.z += cos(swp*.8)*transformed.y*transformed.y*.018;\n#endif' : ''));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow; uniform float uNight;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0,.85,.5), max(vGlow,0.0)*uNight);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += (vec3(1.0,.78,.42)*max(vGlow,0.0)*.75 + diffuseColor.rgb*max(-vGlow,0.0)*1.1)*uNight;');
  };
  m.customProgramCacheKey = function () { return 'vc' + (sway ? 's' : 'n'); };
  return m;
}
var bMat = vcMaterial(false), vegMat = vcMaterial(true);
var ghostMat = new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: .75, depthWrite: false, emissive: 0x2a4a2a });

/* ========== 5. Сборщик low-poly моделей (слитая геометрия с цветом вершин) ========== */
var C = { wood: 0x9a6a43, wood2: 0xb98558, straw: 0xdcbb6e, white: 0xf7f2e8, cream: 0xf2e4c9, terra: 0xd4694e, blue: 0x4aa3d4, pool: 0x62d3e8,
          glass: 0x35506e, dark: 0x4b4139, grey: 0x8f9195, red: 0xd94f4f, leaf: 0x5db25b, leaf2: 0x4b9d4a, palm: 0x4fae4c, sand: 0xead9a7,
          stone: 0xb9b1a0, earth: 0xb7a176, lamp: 0xfff0b0, flag: 0xff6b5e, yellow: 0xf4c84a, path: 0xe3d4b2, grass: 0x7fcb6e, fire: 0xff8c3a, skin: 0xf1c9a5 };
var _m4 = new T.Matrix4(), _e = new T.Euler(), _q = new T.Quaternion(), _v = new T.Vector3(), _s = new T.Vector3();
function Mdl() { this.p = []; }
Mdl.prototype.add = function (geo, c, x, y, z, rx, ry, rz, glow, sx, sy, sz) {
  _v.set(x || 0, y || 0, z || 0); _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e); _s.set(sx || 1, sy || 1, sz || 1);
  _m4.compose(_v, _q, _s); if (geo.index) { var ng = geo.toNonIndexed(); geo.dispose(); geo = ng; } geo.applyMatrix4(_m4);
  this.p.push({ g: geo, c: c, gl: glow || 0 }); return this;
};
Mdl.prototype.box = function (w, h, d, c, x, y, z, ry, glow) { return this.add(new T.BoxGeometry(w, h, d), c, x, y, z, 0, ry, 0, glow); };
Mdl.prototype.cyl = function (rt, rb, h, seg, c, x, y, z, glow, rz, rx) { return this.add(new T.CylinderGeometry(rt, rb, h, seg), c, x, y, z, rx, 0, rz, glow); };
Mdl.prototype.cone = function (r, h, seg, c, x, y, z, glow, ry) { return this.add(new T.ConeGeometry(r, h, seg), c, x, y, z, 0, ry, 0, glow); };
Mdl.prototype.ico = function (r, det, c, x, y, z, glow, sy) { return this.add(new T.IcosahedronGeometry(r, det), c, x, y, z, 0, 0, 0, glow, 1, sy || 1, 1); };
Mdl.prototype.pyr = function (w, h, c, x, y, z) { return this.add(new T.ConeGeometry(w * .72, h, 4), c, x, y, z, 0, PI / 4, 0); }; // пирамидальная крыша
Mdl.prototype.build = function () {
  var n = 0, i, p, k, v; for (i = 0; i < this.p.length; i++) n += this.p[i].g.attributes.position.count;
  var pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), gl = new Float32Array(n), o = 0, cc = new T.Color();
  for (i = 0; i < this.p.length; i++) { p = this.p[i]; k = p.g.attributes.position.count; cc.setHex(p.c);
    pos.set(p.g.attributes.position.array, o * 3); nor.set(p.g.attributes.normal.array, o * 3);
    for (v = 0; v < k; v++) { col[(o + v) * 3] = cc.r; col[(o + v) * 3 + 1] = cc.g; col[(o + v) * 3 + 2] = cc.b; gl[o + v] = p.gl; }
    o += k; p.g.dispose(); }
  var geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
  geo.setAttribute('color', new T.BufferAttribute(col, 3)); geo.setAttribute('aGlow', new T.BufferAttribute(gl, 1));
  geo.computeBoundingSphere(); return geo;
};
function footing(m) { m.box(1.3, .7, 1.3, C.earth, 0, -.32, 0); }
function lampPost(m, x, y, z, h) { m.cyl(.025, .025, h || .55, 4, C.dark, x, y + (h || .55) / 2, z); m.ico(.06, 0, C.lamp, x, y + (h || .55) + .04, z, 1); }
function umbrella(m, x, y, z, c) { m.cyl(.02, .02, .55, 4, C.dark, x, y + .27, z); m.cone(.28, .13, 6, c || C.flag, x, y + .6, z); }
function winBox(m, w, h, x, y, z, ry) { m.box(w, h, .04, C.glass, x, y, z, ry, 1); }

/* модели построек по типу и уровню */
var MODELS = {};
var MK = {
  hut: function (m, l) {
    footing(m); m.box(1.0, .1, 1.0, C.wood2, 0, .05, 0); m.box(.72, .5, .72, C.wood, 0, .35, 0); m.pyr(.98, .5, C.straw, 0, .85, 0);
    m.box(.2, .3, .04, C.dark, 0, .25, .37); winBox(m, .16, .14, .22, .42, .37);
    m.ico(.06, 0, C.grey, .45, .04, .55); m.ico(.06, 0, C.grey, .58, .04, .45); m.ico(.07, 0, C.fire, .52, .1, .52, -1); // костёр
    if (l >= 2) { m.box(.6, .08, .5, C.wood2, 0, .04, .75); m.cyl(.03, .03, .5, 4, C.wood, -.25, .3, .95); m.cyl(.03, .03, .5, 4, C.wood, .25, .3, .95);
      m.box(.7, .05, .55, C.straw, 0, .6, .8); m.ico(.05, 0, C.lamp, 0, .5, .95, 1); }
    if (l >= 3) { m.box(.45, .4, .45, C.wood, -.55, .3, -.2); m.pyr(.6, .35, C.straw, -.55, .67, -.2); winBox(m, .14, .12, -.55, .32, .03);
      m.ico(.07, 0, C.flag, -.5, .14, .45); m.ico(.07, 0, C.yellow, -.3, .14, .55); }
  },
  bungalow: function (m, l) {
    footing(m); m.box(1.2, .1, 1.2, C.wood2, 0, .05, 0); m.box(.9, .55, .85, C.white, 0, .4, 0); m.box(1.0, .08, .95, C.terra, 0, .72, 0);
    winBox(m, .25, .2, -.24, .42, .43); winBox(m, .25, .2, .24, .42, .43); m.box(.2, .36, .04, C.dark, 0, .28, .43); winBox(m, .3, .2, .46, .42, 0, PI / 2);
    m.cyl(.03, .03, .4, 4, C.wood, -.55, .25, .55); m.cyl(.03, .03, .4, 4, C.wood, .55, .25, .55);
    if (l >= 2) { m.box(.6, .45, .6, C.cream, -.1, 1.0, -.05); m.box(.7, .07, .7, C.terra, -.1, 1.26, -.05); winBox(m, .3, .18, -.1, 1.0, .26);
      m.box(.9, .04, .04, C.wood, 0, .95, .4); }
    if (l >= 3) { umbrella(m, .42, .76, .32, C.yellow); m.box(.2, .06, .4, C.white, .22, .8, .1); m.ico(.05, 0, C.lamp, -.55, .55, .55, 1); }
  },
  hotel: function (m, l) {
    var H = [1.5, 2.2, 3.0][l - 1], F = [3, 4, 6][l - 1]; footing(m); m.box(1.2, .2, 1.2, C.stone, 0, .1, 0); m.box(.85, H, .85, C.cream, 0, .2 + H / 2, 0);
    var sp = (H - .3) / F; for (var f = 0; f < F; f++) { var y = .45 + f * sp; winBox(m, .62, .17, 0, y, .44); winBox(m, .62, .17, 0, y, -.44);
      winBox(m, .62, .17, .44, y, 0, PI / 2); winBox(m, .62, .17, -.44, y, 0, PI / 2); }
    m.box(.95, .08, .95, C.dark, 0, .2 + H + .04, 0); m.box(.5, .05, .3, C.terra, 0, .55, .58); m.cyl(.02, .02, .35, 4, C.dark, -.2, .37, .7); m.cyl(.02, .02, .35, 4, C.dark, .2, .37, .7);
    if (l >= 2) { m.box(.5, .9, .6, C.cream, .6, .65, .1); m.box(.56, .06, .66, C.dark, .6, 1.13, .1); winBox(m, .35, .17, .6, .7, .41); }
    if (l >= 3) { m.box(.7, .18, .08, C.lamp, 0, .2 + H + .2, 0, 0, 1); m.box(.4, .06, .3, C.pool, .15, .2 + H + .11, -.2, 0, -.5); }
  },
  bar: function (m, l) {
    footing(m); m.box(1.3, .08, 1.3, C.sand, 0, .04, 0); m.box(.9, .42, .35, C.wood, 0, .29, .15); m.box(.95, .05, .4, C.wood2, 0, .52, .15);
    m.cyl(.04, .04, 1.1, 4, C.wood, -.4, .55, -.2); m.cyl(.04, .04, 1.1, 4, C.wood, .4, .55, -.2); m.cone(.85, .45, 8, C.straw, 0, 1.22, -.05);
    m.cyl(.08, .08, .25, 5, C.wood2, -.3, .2, .5); m.cyl(.08, .08, .25, 5, C.wood2, 0, .2, .5); m.cyl(.08, .08, .25, 5, C.wood2, .3, .2, .5);
    m.ico(.05, 0, C.lamp, -.4, .95, .3, 1); m.ico(.05, 0, C.lamp, 0, .98, .35, 1); m.ico(.05, 0, C.lamp, .4, .95, .3, 1);
    m.ico(.04, 0, C.flag, -.2, .58, .1); m.ico(.04, 0, C.yellow, 0, .58, .1); m.ico(.04, 0, C.pool, .2, .58, .1);
    if (l >= 2) { umbrella(m, -.5, .08, -.5, C.white); umbrella(m, .5, .08, -.5, C.flag); m.cyl(.14, .14, .03, 6, C.white, -.5, .4, -.5); m.cyl(.14, .14, .03, 6, C.white, .5, .4, -.5); }
    if (l >= 3) { m.box(.5, .12, .35, C.wood, 0, .1, -.5); m.ico(.05, 0, C.lamp, -.55, 1.0, .55, 1); m.ico(.05, 0, C.lamp, .55, 1.0, .55, 1); m.box(.02, .02, 1.1, C.dark, 0, 1.0, .55); }
  },
  restaurant: function (m, l) {
    footing(m); m.box(1.25, .12, 1.25, C.stone, 0, .06, 0); m.box(1.0, .6, .8, C.cream, 0, .42, -.1); m.box(1.1, .1, .9, C.terra, 0, .77, -.1);
    winBox(m, .7, .3, 0, .42, .31); winBox(m, .3, .25, .51, .42, -.1, PI / 2); winBox(m, .3, .25, -.51, .42, -.1, PI / 2);
    m.box(.12, .3, .12, C.grey, .35, .9, -.3); m.box(.9, .06, .35, C.wood2, 0, .15, .5); m.cyl(.12, .12, .03, 6, C.white, -.3, .38, .5); umbrella(m, -.3, .18, .5, C.red);
    if (l >= 2) { m.cyl(.12, .12, .03, 6, C.white, .3, .38, .5); umbrella(m, .3, .18, .5, C.white); lampPost(m, .58, .12, .58, .5); lampPost(m, -.58, .12, .58, .5); }
    if (l >= 3) { m.box(.7, .45, .6, C.cream, 0, 1.05, -.15); winBox(m, .45, .2, 0, 1.05, .16); m.box(.8, .08, .7, C.terra, 0, 1.3, -.15); }
  },
  pool: function (m, l) {
    footing(m); m.box(1.35, .1, 1.35, C.cream, 0, .05, 0); m.box(.95, .12, .95, C.white, 0, .06, 0); m.box(.85, .08, .85, C.pool, 0, .09, 0, 0, -.6);
    m.box(.18, .06, .4, C.white, -.55, .16, .3); m.box(.18, .06, .4, C.white, -.55, .16, -.2); umbrella(m, .55, .1, .45, C.flag);
    if (l >= 2) { m.cyl(.06, .06, .9, 5, C.blue, .45, .4, -.3, 0, .9); m.cyl(.03, .03, .5, 4, C.white, .5, .25, -.5); }
    if (l >= 3) { m.box(.3, .3, .3, C.wood, .55, .25, -.45); m.pyr(.45, .25, C.straw, .55, .5, -.45); m.ico(.05, 0, C.lamp, .55, .3, -.25, 1); }
  },
  pier: function (m, l) {
    var w = [.55, .8, 1.0][l - 1], h = w / 2 - .06; m.box(w, .08, 2.6, C.wood2, 0, .1, 1.0);
    m.cyl(.05, .05, 1.6, 4, C.wood, h, -.6, .6); m.cyl(.05, .05, 1.6, 4, C.wood, -h, -.6, .6); m.cyl(.05, .05, 1.6, 4, C.wood, h, -.6, 1.9); m.cyl(.05, .05, 1.6, 4, C.wood, -h, -.6, 1.9);
    lampPost(m, h, .14, 2.15, .6); m.cyl(.04, .04, .15, 5, C.dark, -h, .2, 1.0); m.cyl(.04, .04, .15, 5, C.dark, -h, .2, 2.0);
    if (l >= 2) { m.cyl(.03, .03, .7, 4, C.wood, h - .05, .5, 1.3); m.cyl(.03, .03, .7, 4, C.wood, -h + .05, .5, 1.3); m.cyl(.03, .03, .7, 4, C.wood, h - .05, .5, 1.9); m.cyl(.03, .03, .7, 4, C.wood, -h + .05, .5, 1.9); m.box(w + .1, .05, .75, C.straw, 0, .88, 1.6); }
    if (l >= 3) { m.box(.3, .05, .12, C.wood, -h + .1, .3, .2); m.box(.02, .02, .5, C.dark, 0, .3, .2); m.ico(.04, 0, C.flag, h - .05, .95, 2.3); m.ico(.04, 0, C.yellow, -h + .05, .95, 2.3); }
  },
  lighthouse: function (m, l) {
    var H = [1.8, 2.4, 3.0][l - 1]; footing(m); m.cyl(.42, .48, .3, 8, C.stone, 0, .15, 0); m.cyl(.22, .32, H, 8, C.white, 0, .3 + H / 2, 0);
    m.cyl(.3, .32, .22, 8, C.red, 0, .3 + H * .35, 0); m.cyl(.26, .29, .22, 8, C.red, 0, .3 + H * .72, 0); m.cyl(.36, .36, .08, 8, C.dark, 0, .3 + H + .02, 0);
    m.cyl(.2, .2, .32, 6, C.lamp, 0, .3 + H + .2, 0, -1); m.cone(.27, .3, 6, C.red, 0, .3 + H + .5, 0); m.box(.16, .26, .04, C.dark, 0, .43, .32);
    if (l >= 3) { m.box(.45, .4, .45, C.white, .55, .5, .2); m.box(.52, .07, .52, C.terra, .55, .73, .2); winBox(m, .16, .14, .55, .5, .43); }
  },
  diving: function (m, l) {
    footing(m); m.box(1.25, .1, 1.25, C.wood2, 0, .05, 0); m.box(.65, .5, .55, C.blue, -.2, .38, -.15); m.box(.75, .07, .65, C.white, -.2, .66, -.15);
    winBox(m, .25, .18, -.2, .42, .13); m.box(.16, .3, .04, C.dark, -.45, .27, .13); m.cyl(.02, .02, .9, 4, C.dark, .5, .55, -.5); m.box(.22, .14, .02, C.flag, .61, .95, -.5);
    m.cyl(.06, .06, .32, 6, C.yellow, .35, .27, -.15); m.cyl(.06, .06, .32, 6, C.yellow, .47, .27, -.05); m.box(.28, .12, .62, C.white, .3, .16, .35);
    if (l >= 2) { m.cyl(.06, .06, .32, 6, C.yellow, .4, .27, -.3); m.cyl(.06, .06, .32, 6, C.yellow, .52, .27, -.22); m.box(.3, .04, .3, C.wood, .44, .12, -.18); }
    if (l >= 3) { m.box(.3, .2, .25, C.blue, .3, .3, .35); m.ico(.05, 0, C.lamp, -.55, .5, .55, 1); m.cyl(.025, .025, .5, 4, C.dark, -.55, .25, .55); }
  },
  park: function (m, l) {
    m.box(1.42, .06, 1.42, C.grass, 0, .03, 0); m.box(1.42, .02, .26, C.path, 0, .065, 0); m.box(.26, .02, 1.42, C.path, 0, .065, 0);
    m.cyl(.04, .05, .3, 4, C.wood, -.42, .2, -.42); m.ico(.22, 0, C.leaf2, -.42, .48, -.42); m.cyl(.04, .05, .3, 4, C.wood, .42, .2, -.42); m.ico(.19, 0, C.leaf, .42, .45, -.42);
    m.cyl(.04, .05, .3, 4, C.wood, -.42, .2, .42); m.ico(.17, 0, C.leaf, -.42, .42, .42); m.box(.3, .04, .12, C.wood2, .42, .2, .42); m.box(.3, .12, .03, C.wood2, .42, .26, .36);
    if (l >= 2) { m.cyl(.22, .25, .12, 8, C.stone, 0, .11, 0); m.ico(.1, 0, C.pool, 0, .2, 0, -.5); m.ico(.06, 0, C.flag, .5, .12, .1); m.ico(.06, 0, C.yellow, -.5, .12, -.1); }
    if (l >= 3) { lampPost(m, .5, .06, 0, .5); lampPost(m, -.5, .06, 0, .5); }
  },
  helipad: function (m, l) {
    footing(m); m.cyl(.66, .66, .1, 12, C.grey, 0, .05, 0); m.box(.1, .03, .5, C.white, -.17, .11, 0); m.box(.1, .03, .5, C.white, .17, .11, 0); m.box(.34, .03, .1, C.white, 0, .11, 0);
    m.ico(.05, 0, C.lamp, .55, .14, .55, 1); m.ico(.05, 0, C.lamp, -.55, .14, .55, 1); m.ico(.05, 0, C.lamp, .55, .14, -.55, 1); m.ico(.05, 0, C.lamp, -.55, .14, -.55, 1);
    m.cyl(.015, .015, .6, 4, C.dark, .62, .4, -.62); m.cone(.06, .22, 5, C.flag, .62, .62, -.62);
    if (l >= 2) { m.cyl(.12, .12, .3, 6, C.red, -.6, .25, -.6); m.cyl(.12, .12, .3, 6, C.red, -.6, .25, -.35); }
    if (l >= 3) { m.box(.25, .6, .25, C.white, .6, .4, .3); m.box(.3, .15, .3, C.glass, .6, .78, .3, 0, 1); }
  },
  palm: function (m) {
    m.cyl(.07, .12, 2.0, 5, C.wood, .0, 1.0, 0, 0, .12);
    for (var k = 0; k < 6; k++) { var leaf = new T.BoxGeometry(.18, .03, .95); leaf.translate(0, 0, .45); leaf.rotateX(.55); m.add(leaf, C.palm, -.24, 2.05, 0, 0, k * PI / 3 + .3, 0); }
    m.ico(.07, 0, C.wood2, -.2, 1.95, .06); m.ico(.07, 0, C.wood2, -.3, 1.92, -.06);
  },
  tree: function (m) { m.cyl(.07, .11, .6, 5, C.wood, 0, .3, 0); m.ico(.42, 1, C.leaf, 0, .9, 0, 0, .9); m.ico(.28, 0, C.leaf2, .2, 1.15, .1); },
  bush: function (m) { m.ico(.26, 0, C.leaf, 0, .18, 0, 0, .8); m.ico(.18, 0, C.leaf2, .2, .14, .1); m.ico(.05, 0, C.flag, -.1, .36, .1); },
  rock: function (m) { m.ico(.38, 0, C.grey, 0, .1, 0, 0, .65); m.ico(.2, 0, 0x7f8186, .3, .08, .15); },
  tuft: function (m) { m.cone(.1, .32, 4, C.leaf, 0, .16, 0); m.cone(.08, .26, 4, C.leaf2, .12, .13, .08); m.ico(.04, 0, C.yellow, 0, .34, 0); },
  tourist: function (m) { m.cyl(.09, .12, .3, 5, C.white, 0, .17, 0); m.ico(.085, 0, C.skin, 0, .42, 0); m.cone(.11, .07, 5, C.straw, 0, .49, 0); },
  boat: function (m) {
    m.box(.55, .22, 1.2, C.white, 0, .12, 0); m.box(.45, .12, 1.0, C.blue, 0, 0, 0); var bow = new T.ConeGeometry(.28, .45, 4); bow.rotateY(PI / 4); m.add(bow, C.white, 0, .12, .8, PI / 2, 0, 0);
    m.box(.32, .26, .4, C.blue, 0, .36, -.15); winBox(m, .2, .12, 0, .38, .06); m.cyl(.02, .02, 1.0, 4, C.dark, 0, .75, .15); m.box(.02, .62, .5, C.white, 0, .95, .42); m.ico(.04, 0, C.flag, 0, 1.28, .15);
  },
  heli: function (m) { m.box(.45, .32, .9, C.red, 0, .3, 0); m.ico(.2, 0, C.glass, 0, .32, .48, 1); m.box(.1, .1, .85, C.red, 0, .4, -.8); m.box(.04, .3, .22, C.red, 0, .56, -1.15);
    m.box(.04, .03, .85, C.dark, -.22, .08, 0); m.box(.04, .03, .85, C.dark, .22, .08, 0); m.cyl(.04, .04, .12, 5, C.dark, 0, .52, 0); },
  rotor: function (m) { m.box(1.7, .02, .08, C.dark, 0, 0, 0); m.box(.08, .02, 1.7, C.dark, 0, 0, 0); },
  ptile: function (m) { m.box(.62, .07, .62, C.path, 0, .035, 0); },
  parm: function (m) { m.box(.62, .07, .46, C.path, 0, .035, .53); },
  plamp: function (m) { lampPost(m, 0, 0, 0, .55); }
};
function model(key) {
  if (MODELS[key]) return MODELS[key];
  var mm = /^([a-z]+)(\d)?$/.exec(key), m = new Mdl(); MK[mm[1]](m, +(mm[2] || 1));
  return MODELS[key] = m.build();
}

/* ========== 6. Сцена: рельеф, вода, звёзды, декор ========== */
var terrain = null, water, stars, deco = {}, DEC_KEYS = [null, 'palm', 'tree', 'bush', 'rock', 'tuft'];
var dummy = new T.Object3D(), tmpC = new T.Color();
function buildTerrain() {
  var n = MG * MG * 6, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), o = 0, wr = g.rng(st.seed + 99);
  var LC = [0xf0dfa8, 0x9fd66a, 0x7cc45a, 0x8fb35e, 0xa39b8c], cA = new T.Color(), cB = new T.Color(0xd9cc9a), cD = new T.Color(0x1d6e8c);
  function put(x, y, z) { pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z; col[o * 3] = cA.r; col[o * 3 + 1] = cA.g; col[o * 3 + 2] = cA.b; o++; }
  for (var i = -OFF; i < N + OFF; i++) for (var j = -OFF; j < N + OFF; j++) {
    var y00 = W.vy[vi(i, j)], y10 = W.vy[vi(i + 1, j)], y01 = W.vy[vi(i, j + 1)], y11 = W.vy[vi(i + 1, j + 1)];
    var x0 = cx(i) - S / 2, x1 = x0 + S, z0 = cz(j) - S / 2, z1 = z0 + S, jit = .94 + wr() * .12;
    if (isLand(i, j)) { var L = W.lvl[idx(i, j)]; if (L >= 2 && Math.max(y00, y10, y01, y11) - Math.min(y00, y10, y01, y11) > 1.0) L = 4; cA.setHex(LC[L]).multiplyScalar(jit); }
    else { var dep = Math.min(1, -(y00 + y10 + y01 + y11) / 4 / 4.5); cA.copy(cB).lerp(cD, dep).multiplyScalar(jit); }
    if (Math.abs(y00 - y11) < Math.abs(y10 - y01)) { put(x0, y00, z0); put(x0, y01, z1); put(x1, y11, z1); put(x0, y00, z0); put(x1, y11, z1); put(x1, y10, z0); }
    else { put(x1, y10, z0); put(x0, y00, z0); put(x0, y01, z1); put(x1, y10, z0); put(x0, y01, z1); put(x1, y11, z1); }
  }
  var geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('color', new T.BufferAttribute(col, 3)); geo.computeVertexNormals();
  terrain = new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .95 })); terrain.receiveShadow = true; terrain.castShadow = true; scene.add(terrain);
  var bed = new T.Mesh(new T.BoxGeometry(400, 1, 400), g.mat(0x1a6684)); bed.position.y = -6.4; scene.add(bed);
}
function buildWater() {
  var geo = new T.PlaneGeometry(300, 300, 96, 96); geo.rotateX(-PI / 2);
  var m = new T.MeshStandardMaterial({ color: 0x35b3d6, transparent: true, opacity: .8, roughness: .3, metalness: .05, flatShading: true });
  m.onBeforeCompile = function (sh) { sh.uniforms.uTime = uTime; sh.uniforms.uWave = uWave; sh.uniforms.uNight = uNight;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime, uWave;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += (sin(transformed.x*.45+uTime*1.3)+sin(transformed.z*.38-uTime*1.1)+sin((transformed.x+transformed.z)*.22+uTime*.7)*1.4)*uWave;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(.012,.07,.1)*uNight;'); };
  m.customProgramCacheKey = function () { return 'water'; };
  water = new T.Mesh(geo, m); water.renderOrder = 1; scene.add(water);
  /* звёзды */
  var sp = new Float32Array(400 * 3), wr = g.rng(5);
  for (var i = 0; i < 400; i++) { var a = wr() * PI * 2, b = wr() * PI * .45 + .08, r = 320; sp[i * 3] = Math.cos(a) * Math.cos(b) * r; sp[i * 3 + 1] = Math.sin(b) * r; sp[i * 3 + 2] = Math.sin(a) * Math.cos(b) * r; }
  var sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(sp, 3));
  stars = new T.Points(sg, new T.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false })); scene.add(stars);
}
function buildDecor(kind) {
  var key = DEC_KEYS[kind], list = [], k;
  for (k = 0; k < N * N; k++) if (W.decor[k] === kind) list.push(k);
  if (deco[kind]) { scene.remove(deco[kind]); deco[kind].dispose(); }
  var veg = kind !== 4, mesh = new T.InstancedMesh(model(key), veg ? vegMat : bMat, Math.max(1, list.length)); mesh.count = list.length; mesh.frustumCulled = false;
  mesh.castShadow = kind === 1 || kind === 2; mesh.receiveShadow = kind === 4;
  for (var n = 0; n < list.length; n++) { k = list[n]; var i = (k / N) | 0, j = k % N, sc = W.dScl[k];
    dummy.position.set(cx(i) + Math.cos(W.dRot[k]) * .35, terrainY(cx(i), cz(j)) - .03, cz(j) + Math.sin(W.dRot[k]) * .35); dummy.rotation.set(0, W.dRot[k], 0); dummy.scale.set(sc, sc, sc); dummy.updateMatrix(); mesh.setMatrixAt(n, dummy.matrix); }
  scene.add(mesh); deco[kind] = mesh;
}
function cutDecor(k) { if (!W.decor[k]) return; var kind = W.decor[k]; W.decor[k] = 0; st.cut.push(k); buildDecor(kind); }

/* ========== 7. Постройки (InstancedMesh по типу и уровню) ========== */
var IM = {}, beams = [];
function imFor(key, need) {
  var m = IM[key];
  if (!m || m.instanceMatrix.count < need) { var cap = Math.max(need, m ? m.instanceMatrix.count * 2 : 48); if (m) { scene.remove(m); m.dispose(); }
    m = new T.InstancedMesh(model(key), key === 'palm' ? vegMat : bMat, cap); m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; scene.add(m); IM[key] = m; }
  return m;
}
function reindex() { W.bAt.fill(-1); for (var k = 0; k < st.bld.length; k++) W.bAt[idx(st.bld[k].i, st.bld[k].j)] = k; }
function refreshBuildings() {
  var cnt = {}, k, b, key;
  for (k = 0; k < st.bld.length; k++) { b = st.bld[k]; if (b.t === 'path') continue; key = b.t === 'palm' ? 'palm' : b.t + b.l; cnt[key] = (cnt[key] || 0) + 1; }
  for (key in IM) IM[key].count = 0;
  for (key in cnt) imFor(key, cnt[key]).count = 0;
  for (k = 0; k < st.bld.length; k++) { b = st.bld[k]; if (b.t === 'path') continue; key = b.t === 'palm' ? 'palm' : b.t + b.l; var m = IM[key];
    dummy.position.set(cx(b.i), W.cellY[idx(b.i, b.j)], cz(b.j)); dummy.rotation.set(0, b.r * PI / 2, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); m.setMatrixAt(m.count++, dummy.matrix); }
  for (key in IM) IM[key].instanceMatrix.needsUpdate = true;
  refreshPaths(); refreshBeams();
}
var pTile, pArm, pLamp;
function refreshPaths() {
  var tiles = [], arms = [], lamps = [], k, b;
  for (k = 0; k < st.bld.length; k++) { b = st.bld[k]; if (b.t !== 'path') continue; tiles.push(b); if ((b.i * 7 + b.j * 3) % 4 === 0) lamps.push(b);
    var D = [[0, 1], [1, 0], [0, -1], [-1, 0]]; for (var d = 0; d < 4; d++) { var ni = b.i + D[d][0], nj = b.j + D[d][1]; if (!inb(ni, nj)) continue; var o = W.bAt[idx(ni, nj)]; if (o >= 0 && st.bld[o].t !== 'palm') arms.push([b, d]); } }
  function ens(m, geoKey, n) { if (!m || m.instanceMatrix.count < n) { if (m) { scene.remove(m); m.dispose(); } m = new T.InstancedMesh(model(geoKey), bMat, Math.max(n, m ? m.instanceMatrix.count * 2 : 64)); m.frustumCulled = false; m.receiveShadow = true; scene.add(m); } m.count = 0; return m; }
  pTile = ens(pTile, 'ptile', tiles.length); pArm = ens(pArm, 'parm', arms.length); pLamp = ens(pLamp, 'plamp', lamps.length);
  dummy.scale.set(1, 1, 1);
  for (k = 0; k < tiles.length; k++) { b = tiles[k]; dummy.position.set(cx(b.i), W.cellY[idx(b.i, b.j)], cz(b.j)); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); pTile.setMatrixAt(pTile.count++, dummy.matrix); }
  for (k = 0; k < arms.length; k++) { b = arms[k][0]; dummy.position.set(cx(b.i), W.cellY[idx(b.i, b.j)], cz(b.j)); dummy.rotation.set(0, arms[k][1] * PI / 2, 0); dummy.updateMatrix(); pArm.setMatrixAt(pArm.count++, dummy.matrix); }
  for (k = 0; k < lamps.length; k++) { b = lamps[k]; dummy.position.set(cx(b.i) + .5, W.cellY[idx(b.i, b.j)], cz(b.j) + .5); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); pLamp.setMatrixAt(pLamp.count++, dummy.matrix); }
  pTile.instanceMatrix.needsUpdate = pArm.instanceMatrix.needsUpdate = pLamp.instanceMatrix.needsUpdate = true;
}
var beamGeo = null, beamMat = new T.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: .18, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending, fog: false });
function refreshBeams() { // лучи маяков (не больше 6)
  for (var k = 0; k < beams.length; k++) scene.remove(beams[k]); beams = [];
  if (!beamGeo) { beamGeo = new T.ConeGeometry(.9, 8, 8, 1, true); beamGeo.rotateX(PI / 2); beamGeo.translate(0, 0, -4); }
  for (k = 0; k < st.bld.length && beams.length < 6; k++) { var b = st.bld[k]; if (b.t !== 'lighthouse') continue;
    var m = new T.Mesh(beamGeo, beamMat); m.position.set(cx(b.i), W.cellY[idx(b.i, b.j)] + .5 + [1.8, 2.4, 3.0][b.l - 1] + .2, cz(b.j)); m.rotation.y = k; m.visible = false; scene.add(m); beams.push(m); }
}

/* ========== 8. Правила соседства, экономика, рейтинг ========== */
function evalRules(t, i, j) {
  var rules = TYPES[t].r, parts = [], pct = 0;
  for (var n = 0; n < rules.length; n++) { var ru = rules[n], what = ru[0], r = ru[1], cells = [], cnt = 0;
    for (var di = -r; di <= r; di++) for (var dj = -r; dj <= r; dj++) { if (!di && !dj) continue; var ni = i + di, nj = j + dj, hit = false, ci = -1;
      if (!inb(ni, nj)) { hit = what === 'sea'; } else { ci = idx(ni, nj); var bi = W.bAt[ci], bt = bi >= 0 ? st.bld[bi].t : null;
        if (what === 'sea') hit = !W.land[ci];
        else if (what === 'beach') hit = W.land[ci] && W.lvl[ci] === 0 && (bi < 0 || bt === 'palm');
        else if (what === 'palm') hit = W.decor[ci] === 1 || bt === 'palm';
        else if (what === 'tree') hit = W.decor[ci] === 2 || W.decor[ci] === 3;
        else if (what === 'noise') hit = !!(bt && TYPES[bt].noisy);
        else if (what === 'lodging') hit = !!(bt && LODGING[bt]);
        else hit = bt === what; }
      if (hit) { cnt++; if (ci >= 0) cells.push(ci); } }
    if (cnt) { var c = Math.min(cnt, ru[3]); parts.push({ k: what, v: ru[2] * c, cells: cells }); pct += ru[2] * c; } }
  return { pct: Math.max(-50, Math.min(100, pct)), parts: parts };
}
function bInc(b) { return TYPES[b.t].inc * (1 + b.pct / 100) * LVL_MUL[b.l - 1]; }
function bCap(b) { return TYPES[b.t].cap ? Math.round(TYPES[b.t].cap * CAP_MUL[b.l - 1]) : 0; }
function occupancy() { return totals.cap ? Math.min(1, agents.length / totals.cap) : 0; }
function incomePerMin() { return totals.inc * occupancy() * evMult(); }
function targetTourists() { return Math.floor(totals.cap * (.55 + .09 * rating.stars) * evTMult()); }
function recalc() {
  reindex(); totals.cap = 0; totals.inc = 0; var k, b, have = {}, nAm = 0, lp = 0, nl = 0, lv = 0, nb = 0;
  for (k = 0; k < st.bld.length; k++) { b = st.bld[k]; var ev = evalRules(b.t, b.i, b.j); b.pct = ev.pct; b.parts = ev.parts; totals.cap += bCap(b); totals.inc += bInc(b);
    if (AMEN.indexOf(b.t) >= 0 && !have[b.t]) { have[b.t] = 1; nAm++; }
    if (LODGING[b.t]) { lp += Math.max(-30, Math.min(60, b.pct)); nl++; }
    if (b.t !== 'path' && b.t !== 'palm') { lv += b.l; nb++; } }
  var p1 = nAm * 7, p2 = nl ? Math.round(lp / nl * .6 * Math.min(1, nl / 5)) : 0, p3 = nb ? Math.round((lv / nb - 1) * 10) : 0, p4 = evRating();
  var sc = Math.max(0, Math.min(100, p1 + p2 + p3 + p4));
  rating.score = sc; rating.stars = sc < 20 ? 1 : sc < 40 ? 2 : sc < 60 ? 3 : sc < 80 ? 4 : 5;
  rating.parts = [['Разнообразие', nAm + ' из 7 видов', p1], ['Уют жилья', nl ? 'средний бонус ' + (lp / nl >= 0 ? '+' : '') + Math.round(lp / nl) + '%' : 'нет жилья', p2],
                  ['Улучшения', nb ? 'средний уровень ' + (lv / nb).toFixed(1) : '—', p3], ['Событие', p4 ? 'временный бонус' : '—', p4]];
  rebuildCost(); uiDirty = true;
}
function starsTxt(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= n ? '★' : '☆'; return s; }

/* ========== 9. Стройка, улучшение, снос ========== */
function canPlace(t, i, j, free) {
  if (!inb(i, j) || !W.land[idx(i, j)]) return 'Строить можно только на суше';
  var ci = idx(i, j), tp = TYPES[t];
  if (W.lvl[ci] >= 4) return 'Скалы — здесь не построить';
  if (W.bAt[ci] >= 0) return 'Клетка занята';
  if (tp.shore && !W.shore[ci]) return 'Только у берега';
  if (t === 'pier' && seaDir(i, j) < 0) return 'Нужно открытое море рядом';
  if (free) return null;
  if (!unlocked(t)) return 'Откроется после цели ' + UNLOCK[t];
  if (st.money < tp.cost) return 'Не хватает денег';
  return null;
}
function place(t, i, j, free) {
  var why = canPlace(t, i, j, free); if (why) return why;
  var r = (t === 'pier' || t === 'diving') ? Math.max(0, seaDir(i, j)) : Math.floor(Math.random() * 4);
  if (t === 'lighthouse') r = Math.max(0, seaDir(i, j));
  var b = { t: t, i: i, j: j, l: 1, r: r, pct: 0, parts: [], paid: free ? 0 : TYPES[t].cost };
  if (!free) st.money -= TYPES[t].cost; st.bld.push(b); st.built++;
  cutDecor(idx(i, j));
  recalc(); refreshBuildings();
  if (!free) { g.sfx('place'); if (b.pct) g.float((b.pct > 0 ? '+' : '') + b.pct + '%', cx(i), W.cellY[idx(i, j)] + 1.6, cz(j), b.pct > 0 ? '#6fe3a4' : '#ff7a6b'); }
  return null;
}
function upgradeCost(b) { return Math.round(TYPES[b.t].cost * UP_COST[b.l]); }
function upgrade(b) {
  if (b.l >= 3 || !TYPES[b.t].cap && !TYPES[b.t].inc) return false; if (b.l >= maxLevel()) { g.toast('Уровень ' + ROMAN[b.l + 1] + ' откроется позже', 'bad'); return false; }
  var c = upgradeCost(b); if (st.money < c) { g.toast('Не хватает денег: ' + g.fmt(c), 'bad'); g.sfx('bad'); return false; }
  st.money -= c; b.paid = (b.paid || 0) + c; b.l++; recalc(); refreshBuildings(); g.sfx('up');
  g.float(TYPES[b.t].n + ' ' + ROMAN[b.l], cx(b.i), W.cellY[idx(b.i, b.j)] + 2, cz(b.j), '#ffd166'); burst(cx(b.i), W.cellY[idx(b.i, b.j)] + 1, cz(b.j), 14, 0xffd166, 2); return true;
}
function demolish(b) {
  var k = st.bld.indexOf(b); if (k < 0) return; var back = Math.floor((b.paid || 0) * .5);
  st.bld.splice(k, 1); st.money += back; recalc(); refreshBuildings(); g.sfx('remove');
  for (var a = 0; a < agents.length; a++) { var ag = agents[a]; if (ag.home === b) ag.home = null; if (ag.tgt === b) { ag.tgt = null; ag.route = null; ag.timer = 0; } }
  if (back) g.float('+' + back, cx(b.i), W.cellY[idx(b.i, b.j)] + 1.5, cz(b.j));
}

/* ========== 10. Поиск пути (Дейкстра на сетке) ========== */
var dist = new Float32Array(N * N), prev = new Int16Array(N * N), hK = new Float32Array(N * N * 2), hV = new Int16Array(N * N * 2);
function rebuildCost() {
  for (var k = 0; k < N * N; k++) { if (!W.land[k]) { W.cost[k] = 0; continue; } var L = W.lvl[k], c = L === 0 ? 1.5 : L >= 4 ? 7 : 2.2;
    if (W.decor[k] === 2 || W.decor[k] === 3) c += 1; var bi = W.bAt[k]; if (bi >= 0) c = st.bld[bi].t === 'path' ? 1 : st.bld[bi].t === 'palm' ? c : 5; W.cost[k] = c; }
}
function findRoute(from, to) {
  if (from === to) return [to]; dist.fill(1e9); var hn = 0, D = [1, -1, N, -N];
  function push(key, v) { var i = hn++; while (i > 0) { var p = (i - 1) >> 1; if (hK[p] <= key) break; hK[i] = hK[p]; hV[i] = hV[p]; i = p; } hK[i] = key; hV[i] = v; }
  function pop() { var v = hV[0], key = hK[--hn], val = hV[hn], i = 0; while (true) { var l = i * 2 + 1; if (l >= hn) break; if (l + 1 < hn && hK[l + 1] < hK[l]) l++; if (hK[l] >= key) break; hK[i] = hK[l]; hV[i] = hV[l]; i = l; } hK[i] = key; hV[i] = val; return v; }
  dist[from] = 0; prev[from] = -1; push(0, from); var guard = 0;
  while (hn && guard++ < 20000) { var u = pop(), du = dist[u]; if (u === to) break; var ui = (u / N) | 0, uj = u % N;
    for (var d = 0; d < 4; d++) { var vn = u + D[d]; if (vn < 0 || vn >= N * N) continue; if (d < 2 && ((vn / N) | 0) !== ui) continue; if (!W.cost[vn]) continue;
      var nd = du + W.cost[vn]; if (nd < dist[vn]) { dist[vn] = nd; prev[vn] = u; push(nd, vn); } } }
  if (dist[to] >= 1e9) return null; var path = [], c = to; while (c !== from && c >= 0) { path.push(c); c = prev[c]; } path.reverse(); return path;
}

/* ========== 11. Туристы ========== */
var agents = [], AG_MAX = 320, agMesh, agColDirty = false;
var PAL = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e1d3, 0xf38181, 0xa8e6cf, 0xff8b94, 0x8c7ae6, 0xffffff, 0x74b9ff, 0xfd79a8, 0x55efc4, 0xffb347];
function spawnAgent(i, j, home) {
  if (agents.length >= AG_MAX) return null;
  var a = { x: cx(i) + (Math.random() - .5) * .6, z: cz(j) + (Math.random() - .5) * .6, y: 0, ox: (Math.random() - .5) * .7, oz: (Math.random() - .5) * .7, route: null, ri: 0,
            s: 'idle', tgt: null, home: home || null, timer: .5 + Math.random(), col: PAL[Math.floor(Math.random() * PAL.length)], yaw: Math.random() * 6, k: Math.random() * 6, leave: false };
  agents.push(a); agColDirty = true; return a;
}
function freeLodging() { var best = null, n = 0; for (var k = 0; k < st.bld.length; k++) { var b = st.bld[k]; if (LODGING[b.t] && (b.guests || 0) < bCap(b)) { n++; if (Math.random() < 1 / n) best = b; } } return best; }
function countGuests() { for (var k = 0; k < st.bld.length; k++) st.bld[k].guests = 0; for (var a = 0; a < agents.length; a++) if (agents[a].home) agents[a].home.guests = (agents[a].home.guests || 0) + 1; }
function agentCell(a) { var c = cellAt(a.x, a.z); return inb(c.i, c.j) ? idx(c.i, c.j) : -1; }
function goTo(a, cellIdx, tgt) { var from = agentCell(a); if (from < 0) return false; var r = findRoute(from, cellIdx); if (!r) return false; a.route = r; a.ri = 0; a.tgt = tgt || null; a.s = 'go'; return true; }
function nearestOf(a, filter) { var best = null, bd = 1e9; for (var k = 0; k < st.bld.length; k++) { var b = st.bld[k]; if (!filter(b)) continue; var d = Math.abs(cx(b.i) - a.x) + Math.abs(cz(b.j) - a.z); if (d < bd) { bd = d; best = b; } } return best; }
function nextActivity(a) {
  if (a.leave) { var p = nearestOf(a, function (b) { return b.t === 'pier' || b.t === 'helipad'; }); if (!p || !goTo(a, idx(p.i, p.j), p)) { a.dead = true; } else a.s = 'leave'; return; }
  if (!a.home) { a.home = freeLodging(); if (!a.home) { a.leave = true; a.timer = 0; return; } }
  var r = Math.random();
  if (a.tgt !== a.home && r < .55) { goTo(a, idx(a.home.i, a.home.j), a.home) || (a.timer = 3); return; }
  if (r < .8) { var list = []; for (var k = 0; k < st.bld.length; k++) if (VISIT[st.bld[k].t] && st.bld[k] !== a.tgt) list.push(st.bld[k]);
    if (list.length) { var b = list[Math.floor(Math.random() * list.length)]; if (goTo(a, idx(b.i, b.j), b)) return; } }
  /* на пляж: случайная песчаная клетка недалеко */
  for (var tr = 0; tr < 8; tr++) { var i = a.home.i + Math.floor(Math.random() * 13) - 6, j = a.home.j + Math.floor(Math.random() * 13) - 6;
    if (inb(i, j) && W.land[idx(i, j)] && W.lvl[idx(i, j)] === 0 && W.bAt[idx(i, j)] < 0) { if (goTo(a, idx(i, j), null)) return; } }
  goTo(a, idx(a.home.i, a.home.j), a.home) || (a.timer = 3);
}
var lastFloat = 0;
function arrived(a) {
  if (a.s === 'leave') { a.dead = true; return; }
  a.s = 'stay'; a.timer = 8 + Math.random() * 14;
  if (a.tgt && a.tgt !== a.home && VISIT[a.tgt.t]) { var tip = a.tgt.l + (a.tgt.t === 'restaurant' || a.tgt.t === 'diving' ? 1 : 0); st.money += tip; st.earned += tip;
    if (g.time - lastFloat > .35) { lastFloat = g.time; g.float('+' + tip, a.x, a.y + 1.2, a.z); } }
}
function agStep(a, dt) {
  a.timer -= dt;
  if (a.route) { var ti = a.route[a.ri], tx = cx((ti / N) | 0) + a.ox, tz = cz(ti % N) + a.oz, dx = tx - a.x, dz = tz - a.z, d = Math.sqrt(dx * dx + dz * dz);
    var bi = W.bAt[ti], sp = (bi >= 0 && st.bld[bi].t === 'path' ? 2.1 : 1.35) * dt;
    if (d <= sp) { a.x = tx; a.z = tz; a.ri++; if (a.ri >= a.route.length) { a.route = null; arrived(a); } } else { a.x += dx / d * sp; a.z += dz / d * sp; a.yaw = Math.atan2(dx, dz); } }
  else if (a.timer <= 0) nextActivity(a);
}
function updateAgents(dt) {
  var k, a; for (k = 0; k < agents.length; k++) agStep(agents[k], dt);
  for (k = agents.length - 1; k >= 0; k--) if (agents[k].dead) { agents.splice(k, 1); agColDirty = true; }
  st.tourists = agents.length;
  var hide = ev && ev.id === 'storm'; agMesh.count = agents.length;
  for (k = 0; k < agents.length; k++) { a = agents[k]; a.y = terrainY(a.x, a.z); var s = hide ? 0 : .95;
    dummy.position.set(a.x, a.y + (a.s === 'stay' ? Math.abs(Math.sin(uTime.value * 3 + a.k)) * .04 : 0), a.z); dummy.rotation.set(0, a.yaw, 0); dummy.scale.set(s, s, s); dummy.updateMatrix(); agMesh.setMatrixAt(k, dummy.matrix); }
  agMesh.instanceMatrix.needsUpdate = true;
  if (agColDirty) { for (k = 0; k < agents.length; k++) agMesh.setColorAt(k, tmpC.setHex(agents[k].col)); if (agMesh.instanceColor) agMesh.instanceColor.needsUpdate = true; agColDirty = false; }
}

/* ========== 12. Лодки и вертолёт ========== */
var boats = [], boatMesh, heli = null, heliMesh, rotorMesh, DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
function inTransit() { var n = 0; for (var k = 0; k < boats.length; k++) if (boats[k].n) n += boats[k].n; if (heli && heli.n) n += heli.n; return n; }
function spawnBoat(pier, n) {
  var d = DIRS[pier.r], px = cx(pier.i), pz = cz(pier.j), dock = { x: px + d[0] * 2.6 + d[1] * .75, z: pz + d[1] * 2.6 - d[0] * .75 }, side = Math.random() < .5 ? 1 : -1;
  boats.push({ x: dock.x + d[0] * 60 + d[1] * side * 12, z: dock.z + d[1] * 60 - d[0] * side * 12, dock: dock, yaw: 0, s: 'in', t: 0, n: n, pier: pier, k: Math.random() * 6, d: d });
}
function updateBoats(dt) {
  for (var k = boats.length - 1; k >= 0; k--) { var b = boats[k]; b.t += dt;
    if (b.s === 'in' || b.s === 'out') { var tx = b.s === 'in' ? b.dock.x : b.ox, tz = b.s === 'in' ? b.dock.z : b.oz, dx = tx - b.x, dz = tz - b.z, d = Math.sqrt(dx * dx + dz * dz), sp = (b.s === 'in' && d < 8 ? 3 + d * .5 : 8) * dt;
      if (d <= sp) { b.x = tx; b.z = tz; if (b.s === 'in') { b.s = 'dock'; b.t = 0; } else { boats.splice(k, 1); continue; } }
      else { b.x += dx / d * sp; b.z += dz / d * sp; b.yaw = Math.atan2(dx, dz); if (Math.random() < dt * 6) emit(b.x - dx / d * .7, .05, b.z - dz / d * .7, 0, .2, 0, .9, .14, 0xffffff, 0); } }
    else if (b.s === 'dock') { if (b.n > 0 && b.t > .8) { if (st.bld.indexOf(b.pier) >= 0) { for (var n = 0; n < b.n; n++) spawnAgent(b.pier.i, b.pier.j); st.money += b.n * 2; st.earned += b.n * 2; g.float('+' + b.n * 2 + ' 🧳', b.x, 1.6, b.z, '#ffffff'); g.sfx('coin'); } b.n = 0; }
      if (b.t > 4) { b.s = 'out'; b.ox = b.x + b.d[0] * 70 + b.d[1] * (Math.random() - .5) * 40; b.oz = b.z + b.d[1] * 70 - b.d[0] * (Math.random() - .5) * 40; } }
    else if (b.s === 'race') { b.ang += dt * b.sp; b.x = b.cx + Math.cos(b.ang) * b.rad; b.z = b.cz + Math.sin(b.ang) * b.rad; b.yaw = Math.atan2(-Math.sin(b.ang), Math.cos(b.ang)) + (b.sp > 0 ? 0 : PI); if (b.t > b.life) { boats.splice(k, 1); continue; } }
  }
  boatMesh.count = Math.min(boats.length, 16);
  for (k = 0; k < boatMesh.count; k++) { b = boats[k]; dummy.position.set(b.x, .02 + Math.sin(uTime.value * 2 + b.k) * .05, b.z); dummy.rotation.set(Math.sin(uTime.value * 1.7 + b.k) * .04, b.yaw, Math.sin(uTime.value * 2.3 + b.k) * .06); dummy.scale.set(1.1, 1.1, 1.1); dummy.updateMatrix(); boatMesh.setMatrixAt(k, dummy.matrix); }
  boatMesh.instanceMatrix.needsUpdate = true;
}
function spawnHeli(pad, n) { var a = Math.random() * PI * 2; heli = { x: cx(pad.i) + Math.cos(a) * 60, z: cz(pad.j) + Math.sin(a) * 60, y: 14, pad: pad, n: n, s: 'in', t: 0, yaw: 0 }; heliMesh.visible = true; }
function updateHeli(dt) {
  if (!heli) return; var h = heli, px = cx(h.pad.i), pz = cz(h.pad.j), py = W.cellY[idx(h.pad.i, h.pad.j)] + .15; h.t += dt; rotorMesh.rotation.y += dt * 25;
  if (h.s === 'in') { var dx = px - h.x, dz = pz - h.z, d = Math.sqrt(dx * dx + dz * dz), sp = 11 * dt; if (d > 1.5) { h.x += dx / d * sp; h.z += dz / d * sp; h.yaw = Math.atan2(dx, dz); h.y = py + 3 + Math.min(11, d * .25); }
    else { h.y -= 2.5 * dt; if (h.y <= py) { h.y = py; h.s = 'dock'; h.t = 0; if (st.bld.indexOf(h.pad) >= 0) { for (var k = 0; k < h.n; k++) spawnAgent(h.pad.i, h.pad.j); st.money += h.n * 2; g.float('+' + h.n * 2 + ' 🧳', px, py + 1.5, pz, '#ffffff'); } h.n = 0; burst(px, py + .2, pz, 10, 0xd8d0b8, .6); } } }
  else if (h.s === 'dock') { if (h.t > 3) { h.s = 'out'; var a = Math.random() * PI * 2; h.ox = px + Math.cos(a) * 70; h.oz = pz + Math.sin(a) * 70; } }
  else { h.y += 3 * dt; if (h.y > py + 4) { var ex = h.ox - h.x, ez = h.oz - h.z, e = Math.sqrt(ex * ex + ez * ez); h.x += ex / e * 12 * dt; h.z += ez / e * 12 * dt; h.yaw = Math.atan2(ex, ez); if (e < 2) { heli = null; heliMesh.visible = false; return; } } }
  heliMesh.position.set(h.x, h.y, h.z); heliMesh.rotation.set(h.s === 'dock' ? 0 : .12, h.yaw, 0);
}
function updateArrivals(dt) {
  var need = targetTourists() - agents.length - inTransit(), k, b;
  for (k = 0; k < st.bld.length; k++) { b = st.bld[k]; if (b.t !== 'pier' && b.t !== 'helipad') continue; b.bt = (b.bt === undefined ? 2 : b.bt) - dt; if (b.bt > 0) continue;
    if (b.t === 'pier') { var busy = false; for (var n = 0; n < boats.length; n++) if (boats[n].pier === b) busy = true; if (busy || boats.length >= 10) continue;
      if (need > 0) { var cnt = Math.min(need, 2 + b.l * 2); spawnBoat(b, cnt); need -= cnt; b.bt = 14 - b.l * 2; } else if (Math.random() < .3 && boats.length < 4) { spawnBoat(b, 0); b.bt = 20; } else b.bt = 3; }
    else { if (heli) continue; if (need > 0) { var c2 = Math.min(need, 3 + b.l * 2); spawnHeli(b, c2); need -= c2; b.bt = 24 - b.l * 3; } else b.bt = 4; } }
  /* лишние туристы уезжают */
  var extra = agents.length - targetTourists(); if (extra > 1 && Math.random() < dt * .5) { for (k = 0; k < agents.length && extra > 0; k++) if (!agents[k].leave && agents[k].s !== 'go') { agents[k].leave = true; agents[k].timer = 0; extra--; } }
}

/* ========== 13. Частицы (один InstancedMesh) ========== */
var PMAX = 240, parts = [], pMesh, pNext = 0;
function emit(x, y, z, vx, vy, vz, life, size, color, grav, tall) {
  var p = parts[pNext], pi = pNext; pNext = (pNext + 1) % PMAX; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = p.max = life; p.size = size; p.g = grav || 0; p.tall = tall || 1; p.grow = color === 0xd8d8d8;
  pMesh.setColorAt(pi, tmpC.setHex(color)); pMesh.instanceColor.needsUpdate = true;
}
function burst(x, y, z, n, color, speed) { for (var k = 0; k < n; k++) { var a = Math.random() * PI * 2, b = Math.random() * PI; emit(x, y, z, Math.sin(b) * Math.cos(a) * speed, Math.abs(Math.cos(b)) * speed + .5, Math.sin(b) * Math.sin(a) * speed, 1.2 + Math.random() * .6, .14, color, -3); } }
function updateParts(dt) {
  for (var k = 0; k < PMAX; k++) { var p = parts[k]; if (p.life <= 0) { if (p.shown) { dummy.scale.set(0, 0, 0); dummy.position.set(0, -20, 0); dummy.updateMatrix(); pMesh.setMatrixAt(k, dummy.matrix); p.shown = false; } continue; }
    p.life -= dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; var f = p.life / p.max, s = p.size * (p.grow ? (1.6 - f) : f < .3 ? f / .3 : 1);
    dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(p.x, p.y * 2, 0); dummy.scale.set(s, s * p.tall, s); dummy.updateMatrix(); pMesh.setMatrixAt(k, dummy.matrix); p.shown = true; }
  pMesh.instanceMatrix.needsUpdate = true;
}
var emitT = 0;
function ambientEmit(dt) {
  emitT += dt; if (emitT < .45) return; emitT = 0; var night = uNight.value > .3, occ = occupancy();
  for (var k = 0; k < st.bld.length; k++) { var b = st.bld[k]; if (Math.random() > .5) continue; var x = cx(b.i), y = W.cellY[idx(b.i, b.j)], z = cz(b.j), c = Math.cos(b.r * PI / 2), s = Math.sin(b.r * PI / 2);
    if (b.t === 'restaurant' && occ > 0) emit(x + .35 * c - .3 * s, y + 1.05, z + .35 * s + .3 * c, (Math.random() - .5) * .2, .7, (Math.random() - .5) * .2, 2.2, .16, 0xd8d8d8, 0);
    else if (b.t === 'hut' && night) emit(x + .52 * c + .52 * s, y + .15, z - .52 * s + .52 * c, (Math.random() - .5) * .3, 1 + Math.random(), (Math.random() - .5) * .3, .7, .07, 0xffa040, -.5);
    else if (b.t === 'bar' && night && occ > .3 && Math.random() < .3) burst(x, y + 1.0, z, 3, PAL[Math.floor(Math.random() * PAL.length)], 1); }
  if (ev && ev.id === 'storm') { for (k = 0; k < 24; k++) emit(g.cam.tx + (Math.random() - .5) * 50, 10 + Math.random() * 6, g.cam.tz + (Math.random() - .5) * 50, 0, -14, 0, 1.1, .08, 0xcfe6ff, 0, 10); }
  if (ev && ev.id === 'festival' && st.bld.length) { var fb = st.bld[Math.floor(Math.random() * st.bld.length)]; if (night) burst(cx(fb.i), W.cellY[idx(fb.i, fb.j)] + 5 + Math.random() * 3, cz(fb.j), 22, PAL[Math.floor(Math.random() * PAL.length)], 3.5);
    else burst(cx(fb.i), W.cellY[idx(fb.i, fb.j)] + 2, cz(fb.j), 8, PAL[Math.floor(Math.random() * PAL.length)], 1.5); }
}

/* ========== 14. События ========== */
var ev = null, after = null;
var EVENTS = [
  { id: 'regatta', w: 3, n: '⛵ Регата у острова', dur: 45, msg: 'Яхты кружат вокруг острова — туристы в восторге, доход ×1.3' },
  { id: 'star', w: 3, n: '🌟 Звезда-гость', dur: 60, msg: 'Знаменитость отдыхает у вас: рейтинг +15 на минуту' },
  { id: 'festival', w: 3, n: '🎉 Фестиваль', dur: 50, msg: 'Музыка и салют! Доход ×1.6, гостей больше' },
  { id: 'blogger', w: 2, n: '📸 Тревел-блогер', dur: 70, msg: 'Остров попал в ленту: туристов на 30% больше' },
  { id: 'storm', w: 2, n: '🌧️ Тропический ливень', dur: 30, msg: 'Гости пережидают дождь внутри. Ничего не сломается, обещаем' }
];
function evMult() { var m = 1; if (ev) m *= ev.id === 'regatta' ? 1.3 : ev.id === 'festival' ? 1.6 : ev.id === 'storm' ? .6 : ev.id === 'star' ? 1.2 : 1; if (after) m *= 1.15; return m; }
function evTMult() { return ev && ev.id === 'blogger' ? 1.3 : ev && ev.id === 'festival' ? 1.2 : 1; }
function evRating() { return ev && ev.id === 'star' ? 15 : 0; }
function startEvent(id) {
  var e = null; for (var k = 0; k < EVENTS.length; k++) if (EVENTS[k].id === id) e = EVENTS[k]; if (!e) return;
  ev = { id: e.id, t: e.dur, n: e.n }; g.toast(e.n + ': ' + e.msg, 'gold'); g.sfx('up');
  if (e.id === 'regatta') { var cxs = 0, czs = 0, n = 0; for (k = 0; k < N * N; k++) if (W.land[k]) { cxs += cx((k / N) | 0); czs += cz(k % N); n++; }
    for (k = 0; k < 5; k++) boats.push({ s: 'race', x: 0, z: 0, yaw: 0, t: 0, n: 0, k: k, cx: cxs / n, cz: czs / n, rad: 36 + k * 2.5, ang: k * 1.2, sp: (.12 + k * .015) * (k % 2 ? 1 : -1), life: e.dur }); }
  if (e.id === 'storm') uWave.value = .2;
  recalc();
}
function updateEvents(dt) {
  if (ev) { ev.t -= dt; if (ev.t <= 0) { if (ev.id === 'storm') { after = { t: 60 }; g.toast('Дождь прошёл, воздух свежий: доход +15% на минуту', 'good'); uWave.value = .07; } ev = null; recalc(); } }
  if (after) { after.t -= dt; if (after.t <= 0) after = null; }
  st.nextEv -= dt;
  if (st.nextEv <= 0 && !ev && st.goal >= 1 && agents.length >= 4) { var tw = 0, k; for (k = 0; k < EVENTS.length; k++) tw += EVENTS[k].w; var r = Math.random() * tw;
    for (k = 0; k < EVENTS.length; k++) { r -= EVENTS[k].w; if (r <= 0) { startEvent(EVENTS[k].id); break; } } st.nextEv = 90 + Math.random() * 60; }
}

/* ========== 15. Цели ========== */
function cntT(t) { var n = 0; for (var k = 0; k < st.bld.length; k++) if (st.bld[k].t === t) n++; return n; }
var GOALS = [
  { t: 'Построй 3 хижины', p: function () { return [cntT('hut'), 3]; }, rw: 250, un: 'Открыты бунгало и пляжный бар' },
  { t: 'Прими 10 туристов', p: function () { return [agents.length, 10]; }, rw: 300, un: 'Открыты бассейн и парк' },
  { t: 'Рейтинг 2 звезды', p: function () { return [rating.score, 20]; }, rw: 400, un: 'Открыты отель и ресторан, улучшения до уровня II' },
  { t: 'Прими 40 туристов', p: function () { return [agents.length, 40]; }, rw: 600, un: 'Открыты пирс и маяк' },
  { t: 'Рейтинг 3 звезды', p: function () { return [rating.score, 40]; }, rw: 900, un: 'Открыты дайвинг и вертодром, улучшения до уровня III' },
  { t: 'Прими 100 туристов', p: function () { return [agents.length, 100]; }, rw: 1500 },
  { t: 'Рейтинг 4 звезды', p: function () { return [rating.score, 60]; }, rw: 2500 },
  { t: '5 звёзд и 200 туристов', p: function () { return [Math.min(agents.length, 200) + Math.min(rating.score, 80) * 2.5, 400]; }, sub: function () { return agents.length + '/200 · ' + starsTxt(rating.stars); }, rw: 5000, fin: 1 },
  { t: 'Прими 300 туристов', p: function () { return [agents.length, 300]; }, rw: 5000 },
  { t: 'Доход 3000 в минуту', p: function () { return [Math.round(incomePerMin()), 3000]; }, rw: 10000 }
];
function checkGoals() {
  var G1 = GOALS[st.goal]; if (!G1) return; var p = G1.p();
  if (p[0] >= p[1]) { st.money += G1.rw; st.goal++; g.sfx('up'); g.toast('Цель выполнена: ' + G1.t + ' · +' + g.fmt(G1.rw), 'gold'); if (G1.un) setTimeout(function () { g.toast(G1.un, 'good'); }, 900);
    buildDock(); uiDirty = true;
    if (G1.fin && !st.won) { st.won = true; setTimeout(function () { g.modal('<h2>🏆 Курорт мечты!</h2><p>Пять звёзд и двести гостей — остров стал легендой. Награда: <b>+5 000</b>.</p><p>Можно играть дальше: расширяться, улучшать всё до уровня III и ловить новые цели.</p><div class="btns"><button class="btn" data-close>Продолжить</button></div>'); }, 1200); } }
  renderGoal();
}
function renderGoal() {
  var el = g.$('goal'), G1 = GOALS[st.goal]; if (!el) return;
  if (!G1) { el.className = 'on'; el.innerHTML = '<b>Все цели выполнены</b>Свободная игра — стройте в своё удовольствие'; return; }
  var p = G1.p(), f = Math.max(0, Math.min(1, p[0] / p[1]));
  el.className = 'on'; el.innerHTML = '<b>Цель ' + (st.goal + 1) + ' · награда ' + g.fmt(G1.rw) + '</b>' + G1.t + ' <span style="color:var(--dim)">' + (G1.sub ? G1.sub() : (Math.min(p[0], p[1]) | 0) + '/' + p[1]) + '</span><div class="bar"><i style="width:' + (f * 100).toFixed(0) + '%"></i></div>';
}

/* ========== 16. HUD: ресурсы, док, панель, подсказки ========== */
var uiDirty = true, tool = null, sel = null, hov = { i: -1, j: -1 }, prevTap = -1, tipXY = { x: 0, y: 0 };
function buildRes() {
  g.$('res').innerHTML = '<div class="rc" id="rMoney" title="Деньги"><span class="ic">💰</span><b>0</b><small></small></div>' +
    '<div class="rc" id="rTour" title="Туристы на острове / мест"><span class="ic">🧳</span><b>0</b><small></small></div>' +
    '<div class="rc" id="rStar" title="Рейтинг курорта"><span class="ic">⭐</span><b>☆☆☆☆☆</b><small></small></div>' +
    '<div class="rc" id="rDay"><span class="ic">☀️</span><b>1</b><small>день</small></div>';
  g.$('rStar').onclick = function () { showRating(); }; g.$('rTour').onclick = function () { showTourists(); };
}
function updateRes() {
  var m = g.$('rMoney'), inc = incomePerMin(); m.children[1].textContent = g.fmt(st.money); m.children[2].textContent = '+' + g.fmt(inc) + '/мин'; m.className = 'rc' + (st.money < 50 ? ' warn' : '');
  var t = g.$('rTour'); t.children[1].textContent = agents.length; t.children[2].textContent = 'из ' + totals.cap + ' мест';
  var s = g.$('rStar'); s.children[1].textContent = starsTxt(rating.stars); s.children[2].textContent = rating.score + '/100';
  var d = g.$('rDay'); d.children[0].textContent = uNight.value > .5 ? '🌙' : '☀️'; d.children[1].textContent = Math.floor(st.time / DAY_LEN) + 1;
}
function buildDock() {
  var box = g.$('dockIn'); box.innerHTML = '';
  ORDER.forEach(function (t, k) { var tp = TYPES[t], d = document.createElement('div'), un = unlocked(t); d.className = 'bi' + (un ? '' : ' off'); d.dataset.t = t;
    d.innerHTML = '<span class="k">' + (k < 9 ? k + 1 : '') + '</span><span class="e">' + (un ? tp.e : '🔒') + '</span>' + tp.n + '<span class="p">' + (un ? g.fmt(tp.cost) : 'цель ' + UNLOCK[t]) + '</span>';
    d.onclick = function () { if (!un) { g.toast(tp.n + ' откроется после цели ' + UNLOCK[t], 'bad'); return; } setTool(tool === t ? null : t); };
    box.appendChild(d); });
  updateDock();
}
function updateDock() { var ch = g.$('dockIn').children; for (var k = 0; k < ch.length; k++) { var t = ch[k].dataset.t; ch[k].classList.toggle('on', tool === t); ch[k].classList.toggle('poor', unlocked(t) && st.money < TYPES[t].cost); } }
function setTool(t) { tool = t; sel = null; prevTap = -1; closePanel(); updateDock(); g.sfx('click'); if (t) { ghost.geometry = model(t === 'palm' ? 'palm' : t + '1'); } updatePreview(); setHint(); }
function setHint() {
  var h = g.$('hint');
  if (tool) h.textContent = isTouchDev ? 'Нажми на клетку — предпросмотр, ещё раз — построить' : 'Нажми на клетку острова · ПКМ или Esc — отмена';
  else if (totals.cap === 0) h.textContent = 'Выбери здание внизу и нажми на клетку острова';
  else if (!cntT('pier') && !cntT('helipad')) h.textContent = 'Нужен пирс или вертодром, чтобы приезжали гости';
  else h.textContent = '';
}
function closePanel() { g.$('panel').className = ''; }
function showPanel(html) { var p = g.$('panel'); p.innerHTML = html; p.className = 'on'; var c = p.querySelector('[data-close]'); if (c) c.onclick = function () { closePanel(); sel = null; updatePreview(); }; }
function partsHtml(parts) { var s = ''; for (var k = 0; k < parts.length; k++) { var p = parts[k]; s += '<div class="row"><span>' + TAGN[p.k] + '</span><span class="' + (p.v > 0 ? 'good' : 'bad') + '">' + (p.v > 0 ? '+' : '') + p.v + '%</span></div>'; } return s || '<div class="row"><span>Соседство</span><span>без бонусов</span></div>'; }
function showBuilding(b) {
  var tp = TYPES[b.t], h = '<h3>' + tp.e + ' ' + tp.n + (b.l > 1 ? ' ' + ROMAN[b.l] : '') + '</h3><p>' + tp.d + '</p>';
  if (tp.inc) h += '<div class="row"><span>Доход</span><span>' + g.fmt(bInc(b) * occupancy() * evMult()) + '/мин <small style="color:var(--dim)">(' + g.fmt(bInc(b)) + ' при полной загрузке)</small></span></div>';
  if (tp.cap) h += '<div class="row"><span>Мест / гостей</span><span>' + bCap(b) + ' / ' + (b.guests || 0) + '</span></div>';
  if (b.t === 'pier') h += '<div class="row"><span>Лодка привозит</span><span>до ' + (2 + b.l * 2) + ' гостей</span></div>';
  if (b.t === 'helipad') h += '<div class="row"><span>Вертолёт привозит</span><span>до ' + (3 + b.l * 2) + ' гостей</span></div>';
  if (tp.r.length) h += '<div class="row"><span>Соседство</span><span class="' + (b.pct >= 0 ? 'good' : 'bad') + '">' + (b.pct > 0 ? '+' : '') + b.pct + '%</span></div>' + partsHtml(b.parts);
  h += '<div class="btns">';
  if (tp.inc && b.l < 3) h += '<button class="btn" id="pUp">⬆ Уровень ' + ROMAN[b.l + 1] + ' · ' + g.fmt(upgradeCost(b)) + '</button>';
  h += '<button class="btn bad" id="pDel">Снести · +' + g.fmt(Math.floor((b.paid || 0) * .5)) + '</button><button class="btn alt" data-close>✕</button></div>';
  showPanel(h); var u = g.$('pUp'); if (u) u.onclick = function () { if (upgrade(b)) showBuilding(b); };
  g.$('pDel').onclick = function () { demolish(b); sel = null; closePanel(); updatePreview(); setHint(); };
}
function showRating() {
  var h = '<h3>⭐ Рейтинг курорта</h3><p>' + starsTxt(rating.stars) + ' · ' + rating.score + ' из 100</p>';
  for (var k = 0; k < rating.parts.length; k++) { var p = rating.parts[k]; h += '<div class="row"><span>' + p[0] + ' <small>' + p[1] + '</small></span><span class="' + (p[2] >= 0 ? 'good' : 'bad') + '">' + (p[2] > 0 ? '+' : '') + p[2] + '</span></div>'; }
  h += '<p style="margin-top:10px">Разнообразие — по 7 за каждый вид: бар, ресторан, бассейн, дайвинг, парк, маяк, вертодром. Уют — средний бонус соседства у жилья. Улучшения — средний уровень построек.</p><div class="btns"><button class="btn alt" data-close>Закрыть</button></div>';
  showPanel(h);
}
function showTourists() {
  var h = '<h3>🧳 Туристы</h3><p>На острове ' + agents.length + ' из ' + totals.cap + ' мест. При рейтинге ' + starsTxt(rating.stars) + ' заполняется ' + Math.round((.55 + .09 * rating.stars) * 100) + '% мест.</p>' +
    '<div class="row"><span>Пирсов</span><span>' + cntT('pier') + '</span></div><div class="row"><span>Вертодромов</span><span>' + cntT('helipad') + '</span></div><div class="row"><span>В пути</span><span>' + inTransit() + '</span></div>' +
    '<p style="margin-top:10px">Гости живут в хижинах, бунгало и отелях, ходят в бары, рестораны и на пляж и оставляют чаевые. Больше мест и звёзд — больше гостей.</p><div class="btns"><button class="btn alt" data-close>Закрыть</button></div>';
  showPanel(h);
}
function showHelp() {
  g.modal('<h2>🏝️ Остров-курорт</h2><p>Спокойная стройка: без штрафов и таймеров. Только остров, море и гости.</p><ul>' +
    '<li>Выбери постройку внизу и нажми на клетку суши.</li><li>Соседство решает: бар у пляжа — плюс, отель у маяка — плюс, два шумных рядом — минус. Подсветка и подсказка покажут бонус заранее.</li>' +
    '<li>Туристы приплывают на пирс, живут в хижинах, бунгало и отелях и платят. Больше мест и звёзд — больше гостей.</li><li>Рейтинг ⭐ растёт от разнообразия, уюта жилья и улучшений. Цели открывают новые постройки.</li>' +
    '<li>Нажми на здание — улучшить до уровня III или снести (вернётся половина цены).</li></ul>' +
    '<p>Камера: тяни — вращать, колесо или щипок — зум, правая кнопка или Shift — двигать, WASD. Пробел — пауза.</p><div class="btns"><button class="btn" data-close>Поехали</button></div>');
}

/* ========== 17. Курсор, предпросмотр, подсветка соседей ========== */
var ghost, cursor, hl, hlPlus, hlMinus;
function buildCursor() {
  ghost = new T.Mesh(model('hut1'), ghostMat); ghost.visible = false; scene.add(ghost);
  cursor = new T.Mesh(new T.PlaneGeometry(1.5, 1.5).rotateX(-PI / 2), new T.MeshBasicMaterial({ color: 0xffcf5a, transparent: true, opacity: .35, depthWrite: false })); cursor.visible = false; scene.add(cursor);
  hl = new T.InstancedMesh(new T.PlaneGeometry(1.4, 1.4).rotateX(-PI / 2), new T.MeshBasicMaterial({ transparent: true, opacity: .42, depthWrite: false }), 64); hl.count = 0; hl.frustumCulled = false; scene.add(hl);
  hl.setColorAt(0, tmpC.setHex(0xffffff));
  var pm = new Mdl(); pm.box(.5, .05, .13, 0xffffff, 0, 0, 0); pm.box(.13, .05, .5, 0xffffff, 0, 0, 0); var mm = new Mdl(); mm.box(.5, .05, .13, 0xffffff, 0, 0, 0);
  hlPlus = new T.InstancedMesh(pm.build(), new T.MeshBasicMaterial({ color: 0x1f8f4a }), 64); hlMinus = new T.InstancedMesh(mm.build(), new T.MeshBasicMaterial({ color: 0xb8332a }), 64);
  hlPlus.count = hlMinus.count = 0; hlPlus.frustumCulled = hlMinus.frustumCulled = false; scene.add(hlPlus); scene.add(hlMinus);
}
function showCells(parts) {
  hl.count = hlPlus.count = hlMinus.count = 0; dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
  for (var k = 0; k < parts.length && hl.count < 64; k++) { var p = parts[k]; for (var n = 0; n < p.cells.length && hl.count < 64; n++) { var ci = p.cells[n], i = (ci / N) | 0, j = ci % N;
    dummy.position.set(cx(i), Math.max(.05, W.cellY[ci]) + .06, cz(j)); dummy.updateMatrix(); hl.setMatrixAt(hl.count, dummy.matrix); hl.setColorAt(hl.count, tmpC.setHex(p.v > 0 ? 0x5fe08a : 0xff7a6b)); hl.count++;
    dummy.position.y += .06; dummy.updateMatrix(); var mk = p.v > 0 ? hlPlus : hlMinus; mk.setMatrixAt(mk.count++, dummy.matrix); } }
  hl.instanceMatrix.needsUpdate = hlPlus.instanceMatrix.needsUpdate = hlMinus.instanceMatrix.needsUpdate = true; if (hl.instanceColor) hl.instanceColor.needsUpdate = true;
}
function tipHtml(t, i, j, why, compact) {
  var tp = TYPES[t]; if (why) return '<b>' + tp.e + ' ' + tp.n + '</b> · <span class="bad">' + why + '</span>';
  var ev1 = evalRules(t, i, j), s = '<b>' + tp.e + ' ' + tp.n + '</b>' + (compact ? '' : ' · ' + g.fmt(tp.cost));
  if (tp.inc) s += ' · ' + (compact ? '' : g.fmt(tp.inc) + ' → ') + '<b>' + g.fmt(tp.inc * (1 + ev1.pct / 100)) + '</b>/мин <span class="' + (ev1.pct >= 0 ? 'good' : 'bad') + '">' + (ev1.pct > 0 ? '+' : '') + ev1.pct + '%</span>';
  if (ev1.parts.length) { s += compact ? ' <small>(' : '<br><small>'; for (var k = 0; k < ev1.parts.length; k++) s += (k ? ' · ' : '') + TAGN[ev1.parts[k].k] + ' ' + (ev1.parts[k].v > 0 ? '+' : '') + ev1.parts[k].v; s += compact ? ')</small>' : '</small>'; }
  return s;
}
function updatePreview() {
  var tip = g.$('tip'), i = hov.i, j = hov.j, ok = inb(i, j);
  cursor.visible = ok; if (ok) cursor.position.set(cx(i), Math.max(.05, W.cellY[idx(i, j)]) + .08, cz(j));
  if (tool && ok) { var why = canPlace(tool, i, j); ghost.visible = true; ghost.position.set(cx(i), Math.max(.1, W.cellY[idx(i, j)]), cz(j));
    ghost.rotation.y = (tool === 'pier' || tool === 'diving' || tool === 'lighthouse') ? Math.max(0, seaDir(i, j)) * PI / 2 : 0; ghostMat.emissive.setHex(why ? 0x702020 : 0x2a4a2a);
    var ev1 = why ? { parts: [] } : evalRules(tool, i, j); showCells(ev1.parts); var html = tipHtml(tool, i, j, why, isTouchDev);
    if (isTouchDev) { tip.style.display = 'none'; g.$('hint').innerHTML = html + (why ? '' : ' · <b>ещё раз — построить</b>'); }
    else { tip.style.display = 'block'; tip.innerHTML = html; tip.style.left = Math.min(innerWidth - 310, tipXY.x + 18) + 'px'; tip.style.top = Math.max(60, tipXY.y - 62) + 'px'; } }
  else { ghost.visible = false; tip.style.display = 'none'; if (isTouchDev && !sel) setHint(); if (sel) showCells(sel.parts); else hl.count = hlPlus.count = hlMinus.count = 0; }
}
function pickCell(e) { // луч от плоскости y=4 до y=-1, ищем первую точку под рельефом (море считаем за y=0)
  g.groundY = 4; var a = g.groundAt(e); g.groundY = -1; var b = g.groundAt(e); g.groundY = 0; if (!a || !b) return null;
  function under(t) { var x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t; return Math.max(0, terrainY(x, z)) >= a.y + (b.y - a.y) * t; }
  var t0 = 0, t1 = 1, k;
  for (k = 1; k <= 24; k++) if (under(k / 24)) { t0 = (k - 1) / 24; t1 = k / 24; break; }
  if (k <= 24) for (k = 0; k < 6; k++) { var tm = (t0 + t1) / 2; if (under(tm)) t1 = tm; else t0 = tm; }
  return cellAt(a.x + (b.x - a.x) * t1, a.z + (b.z - a.z) * t1);
}
var isTouchDev = navigator.maxTouchPoints > 1 && /Android|iPhone|iPad/i.test(navigator.userAgent);
g.onHover = function (e) { if (e.pointerType === 'touch') return; tipXY.x = e.clientX; tipXY.y = e.clientY; var c = pickCell(e); var i = c ? c.i : -1, j = c ? c.j : -1; if (i !== hov.i || j !== hov.j || tool) { hov.i = i; hov.j = j; updatePreview(); } };
g.onTap = function (e, btn) {
  if (e.pointerType === 'touch') isTouchDev = true;
  if (btn === 2) { if (tool) setTool(null); return; }
  var c = pickCell(e); if (!c) return; hov.i = c.i; hov.j = c.j; var ci = inb(c.i, c.j) ? idx(c.i, c.j) : -1;
  if (tool) {
    if (isTouchDev && prevTap !== ci) { prevTap = ci; updatePreview(); return; }
    var why = place(tool, c.i, c.j); if (why) { g.toast(why, 'bad'); g.sfx('bad'); }
    prevTap = -1; if (isTouchDev) { hov.i = hov.j = -1; } updatePreview(); setHint(); checkGoals(); return;
  }
  var bi = ci >= 0 ? W.bAt[ci] : -1;
  if (bi >= 0) { sel = st.bld[bi]; countGuests(); showBuilding(sel); g.sfx('click'); } else { sel = null; closePanel(); }
  updatePreview();
};
g.onKey = function (k, e) {
  if (k === 'escape') { setTool(null); sel = null; closePanel(); updatePreview(); }
  else if (/^[1-9]$/.test(k)) { var t = ORDER[+k - 1]; if (t && unlocked(t)) setTool(tool === t ? null : t); }
  else if ((k === 'delete' || k === 'x') && sel) { demolish(sel); sel = null; closePanel(); updatePreview(); }
  else if (k === 'u' && sel) { if (upgrade(sel)) showBuilding(sel); }
  else if (k === 'h') showHelp();
};

/* ========== 18. Сохранение и запуск ========== */
function save() { if (g.noSave || !st) return; var o = { v: 1, seed: st.seed, money: Math.round(st.money), time: st.time, goal: st.goal, earned: Math.round(st.earned), won: st.won, nextEv: st.nextEv, built: st.built, cut: st.cut, tourists: agents.length, bld: [] };
  for (var k = 0; k < st.bld.length; k++) { var b = st.bld[k]; o.bld.push([b.t, b.i, b.j, b.l, b.r, b.paid || 0]); } g.save(o); }
g.onAutosave = save;
function load() {
  var o = g.load(); if (!o || o.v !== 1 || typeof o.seed !== 'number' || !isFinite(o.seed)) return null;
  try { var s = newState(o.seed); s.money = isFinite(+o.money) ? +o.money : 500; s.time = isFinite(+o.time) ? +o.time : 0; s.goal = Math.max(0, Math.min(GOALS.length, o.goal | 0)); s.earned = +o.earned || 0; s.won = !!o.won;
    s.nextEv = isFinite(+o.nextEv) ? +o.nextEv : 80; s.built = o.built | 0; s.cut = []; s.loadTourists = Math.max(0, Math.min(AG_MAX, o.tourists | 0)); s.loadBld = [];
    if (o.cut instanceof Array) for (var k = 0; k < o.cut.length; k++) if (o.cut[k] >= 0 && o.cut[k] < N * N) s.cut.push(o.cut[k] | 0);
    if (o.bld instanceof Array) for (k = 0; k < o.bld.length; k++) { var b = o.bld[k]; if (b instanceof Array && TYPES[b[0]] && inb(b[1] | 0, b[2] | 0)) s.loadBld.push({ t: b[0], i: b[1] | 0, j: b[2] | 0, l: Math.max(1, Math.min(3, b[3] | 0)), r: (b[4] | 0) & 3, paid: +b[5] || 0 }); }
    return s; } catch (e) { return null; }
}
function startPier() { // бесплатный причал у южного берега
  var best = -1, bs = 1e9; for (var k = 0; k < N * N; k++) { if (!W.shore[k] || W.lvl[k] !== 0 || W.bAt[k] >= 0) continue; var i = (k / N) | 0, j = k % N; if (seaDir(i, j) < 0) continue; var sc = Math.abs(i - N / 2) + (N - j); if (sc < bs) { bs = sc; best = k; } }
  if (best < 0) for (k = 0; k < N * N; k++) if (W.shore[k] && W.lvl[k] < 4 && seaDir((k / N) | 0, k % N) >= 0) { best = k; break; }
  if (best >= 0) { place('pier', (best / N) | 0, best % N, true); st.bld[st.bld.length - 1].paid = 300; }
}
function init() {
  var s = load(), fresh = !s; st = s || newState(Math.floor(Math.random() * 1e9));
  genWorld(st.seed);
  for (var k = 0; k < st.cut.length; k++) W.decor[st.cut[k]] = 0;
  buildTerrain(); buildWater(); for (k = 1; k <= 5; k++) buildDecor(k); buildCursor();
  agMesh = new T.InstancedMesh(model('tourist'), bMat, AG_MAX); agMesh.count = 0; agMesh.frustumCulled = false; scene.add(agMesh);
  boatMesh = new T.InstancedMesh(model('boat'), bMat, 16); boatMesh.count = 0; boatMesh.frustumCulled = false; boatMesh.castShadow = true; scene.add(boatMesh);
  heliMesh = new T.Mesh(model('heli'), bMat); heliMesh.castShadow = true; heliMesh.visible = false; rotorMesh = new T.Mesh(model('rotor'), bMat); rotorMesh.position.y = .6; heliMesh.add(rotorMesh); scene.add(heliMesh);
  pMesh = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ transparent: true, opacity: .85, depthWrite: false }), PMAX); pMesh.frustumCulled = false; scene.add(pMesh);
  for (k = 0; k < PMAX; k++) { parts.push({ life: 0, shown: false }); pMesh.setColorAt(k, tmpC.setHex(0xffffff)); dummy.scale.set(0, 0, 0); dummy.position.set(0, -20, 0); dummy.updateMatrix(); pMesh.setMatrixAt(k, dummy.matrix); }
  reindex();
  if (st.loadBld) { for (k = 0; k < st.loadBld.length; k++) { var b = st.loadBld[k], ci = idx(b.i, b.j); if (W.land[ci] && W.bAt[ci] < 0) { st.bld.push(b); W.bAt[ci] = st.bld.length - 1; } } delete st.loadBld; }
  recalc(); refreshBuildings();
  if (fresh || !cntT('pier') && !st.bld.length) startPier();
  if (st.loadTourists) { for (k = 0; k < st.loadTourists; k++) { var h = freeLodging(); if (!h) break; var a = spawnAgent(h.i, h.j, h); if (a) { a.tgt = h; a.s = 'stay'; a.timer = Math.random() * 10; h.guests = (h.guests || 0) + 1; } } delete st.loadTourists; }
  /* камера на центр острова */
  var sx = 0, sz = 0, n = 0; for (k = 0; k < N * N; k++) if (W.land[k]) { sx += cx((k / N) | 0); sz += cz(k % N); n++; }
  g.cam.tx = g.cam.gtx = sx / n; g.cam.tz = g.cam.gtz = sz / n + 4; if (innerWidth < 600) g.cam.dist = g.cam.gdist = 68;
  buildRes(); buildDock(); renderGoal(); setHint(); g.wireBar(); g.$('bHelp').onclick = showHelp;
  if (fresh) { g.toast('Добро пожаловать на остров! Старт: 500 монет и причал', 'gold'); setTimeout(showHelp, 400); }
  g.start();
}

/* ========== 19. Главный цикл ========== */
var uiT = 0, goalT = 0, guestT = 0, fpsEl = g.$('fps');
g.onUpdate = function (dt) {
  st.time += dt; g.setDay((st.time / DAY_LEN + .3) % 1);
  var inc = incomePerMin() / 60 * dt; st.money += inc; st.earned += inc;
  updateArrivals(dt); updateAgents(dt); updateBoats(dt); updateHeli(dt); updateEvents(dt); ambientEmit(dt); updateParts(dt);
  guestT += dt; if (guestT > 2) { guestT = 0; countGuests(); }
  goalT += dt; if (goalT > .5) { goalT = 0; checkGoals(); }
  uiT += dt; if (uiT > .3 || uiDirty) { uiT = 0; uiDirty = false; updateRes(); updateDock(); if (!tool) setHint(); }
};
g.onFrame = function (dt) {
  uTime.value += dt; for (var k = 0; k < beams.length; k++) { beams[k].visible = uNight.value > .2; beams[k].rotation.y += dt * .9; }
  if (fpsEl && g.fps()) fpsEl.textContent = g.fps() + ' fps';
};
g.onDay = function (day) {
  var night = Math.max(0, Math.min(1, (.42 - day) / .3)); uNight.value = night; stars.material.opacity = night * .9; beamMat.opacity = .18 * night;
  g.sun.intensity *= 1 - night * .5; g.hemi.intensity *= 1 - night * .45; // ночью темнее, чтобы огни были заметнее
  if (ev && ev.id === 'storm') { g.sun.intensity *= .45; g.hemi.intensity *= .7; scene.background.multiplyScalar(.72); scene.fog.color.copy(scene.background); }
};

/* для тестов: доступ к состоянию и шагу симуляции */
window.__game = { state: function () { return st; }, W: W, pick: pickCell, terrainY: terrainY, place: place, upgrade: upgrade, demolish: demolish, tick: function (dt) { g.onUpdate(dt); }, agents: agents, rating: rating, totals: totals, types: TYPES, startEvent: startEvent, income: incomePerMin };
init();
})();
