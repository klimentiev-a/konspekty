/* ═══ Железнодорожная империя ═══
   Процедурная карта с сидом, города и производства, рельсы по A*, поезда на инстансах,
   экономика перевозок, ступени развития, события, сохранение. ES5, один файл. */
(function () {
'use strict';
var T = THREE;
var N = 60, H = N / 2, WL = 0, BRY = .62, MT = 3.3;          // размер карты, вода, мосты, порог гор
var GAP = 1.05, CAR_MAX = 6, TR_MAX = 40;                     // дистанция между вагонами, лимиты
var CARGO = ['coal', 'logs', 'grain', 'goods', 'pass', 'mail'];
var CI = { coal: { n: 'Уголь', e: '⚫', p: .9, c: 0x44464c }, logs: { n: 'Брёвна', e: '🪵', p: .9, c: 0xa5713f },
  grain: { n: 'Зерно', e: '🌾', p: 1.0, c: 0xe8c85a }, goods: { n: 'Товары', e: '📦', p: 1.6, c: 0xd9814f },
  pass: { n: 'Пассажиры', e: '🧑', p: 1.3, c: 0x5aa0e0 }, mail: { n: 'Почта', e: '✉️', p: 1.8, c: 0xe8e8f0 } };
var IND = { mine: { n: 'Шахта', e: '⛏️', prod: { coal: .5 }, acc: {} }, saw: { n: 'Лесопилка', e: '🪚', prod: { logs: .5 }, acc: {} },
  farm: { n: 'Ферма', e: '🌾', prod: { grain: .55 }, acc: {} }, fact: { n: 'Завод', e: '🏭', prod: { goods: .12 }, acc: { coal: 1, logs: 1, grain: 1 } },
  port: { n: 'Порт', e: '⚓', prod: { goods: .2 }, acc: { coal: 1, logs: 1, grain: 1, goods: 1 } }, power: { n: 'Электростанция', e: '⚡', prod: {}, acc: { coal: 1 } } };
var TT = { steam: { n: 'Паровоз', e: '🚂', sp: 2.2, cap: 24, cars: 2, price: 600, col: 0x3a3f4a, tier: 0 },
  diesel: { n: 'Тепловоз', e: '🚆', sp: 3.4, cap: 36, cars: 3, price: 1800, col: 0xd35b4f, tier: 1 },
  electric: { n: 'Электричка', e: '🚄', sp: 5, cap: 48, cars: 4, price: 4200, col: 0x4fa3d3, tier: 4 } };
var TIERS = [{ at: 0, n: '' }, { at: 4000, n: 'Тепловоз', b: 1000 }, { at: 20000, n: 'Станции 2 уровня, мосты дешевле', b: 3000 },
  { at: 60000, n: 'Длинные составы: +вагон', b: 5000 }, { at: 150000, n: 'Электричка', b: 10000 },
  { at: 400000, n: 'Станции 3 уровня, ещё +вагон', b: 20000 }, { at: 1000000, n: 'Империя построена!', b: 0 }];
var NAMES = ['Берёзовск', 'Сосновка', 'Озёрск', 'Холмогоры', 'Речное', 'Заречье', 'Каменск', 'Луговое', 'Светлогорск', 'Дубравино', 'Ясногорск', 'Боровое'];
var PAL = [0xff5a5a, 0x5ab4ff, 0x6fe3a4, 0xffd166, 0xc78bff, 0xff9b5e, 0x4fd1c5, 0xf78fb3];
var ST_COST = 400, ST_UP = [0, 800, 2000], ST_CAP = [0, 60, 140, 300];

var g = G.create({ key: 'rail', bg: 0xa9d6ea, dist: 48, minDist: 12, maxDist: 100, bound: 32 });
window.__g = g;
var scene = g.scene;

/* ---------- клетки ---------- */
function cid(i, j) { return j * N + i; }
function ci(c) { return c % N; }
function cj(c) { return (c - c % N) / N; }
function cx(c) { return ci(c) - H + .5; }
function cz(c) { return cj(c) - H + .5; }
function toCell(x, z) { var i = Math.floor(x + H), j = Math.floor(z + H); return (i < 0 || j < 0 || i >= N || j >= N) ? -1 : cid(i, j); }
function cheb(a, b) { return Math.max(Math.abs(ci(a) - ci(b)), Math.abs(cj(a) - cj(b))); }
function dist(a, b) { var dx = ci(a) - ci(b), dz = cj(a) - cj(b); return Math.sqrt(dx * dx + dz * dz); }

/* ---------- сборщик геометрии (слияние боксов/цилиндров с цветом вершин) ---------- */
var colC = {};
function C(hex) { if (colC[hex]) return colC[hex]; var c = new T.Color(hex); return colC[hex] = [c.r, c.g, c.b]; }
function GB() { this.p = []; this.n = []; this.c = []; }
GB.prototype.tri = function (a, b, c, nx, ny, nz, col) {
  this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (var k = 0; k < 3; k++) { this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); }
};
GB.prototype.quad = function (a, b, c, d, nx, ny, nz, col) { this.tri(a, b, c, nx, ny, nz, col); this.tri(a, c, d, nx, ny, nz, col); };
var FR0 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
GB.prototype.box = function (x, y, z, sx, sy, sz, col, fr) { // fr — локальные оси [X,Y,Z]
  fr = fr || FR0; var X = fr[0], Y = fr[1], Z = fr[2], hx = sx / 2, hy = sy / 2, hz = sz / 2;
  function P(i, j, k) { return [x + X[0] * i * hx + Y[0] * j * hy + Z[0] * k * hz, y + X[1] * i * hx + Y[1] * j * hy + Z[1] * k * hz, z + X[2] * i * hx + Y[2] * j * hy + Z[2] * k * hz]; }
  this.quad(P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), X[0], X[1], X[2], col);
  this.quad(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), -X[0], -X[1], -X[2], col);
  this.quad(P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1), Y[0], Y[1], Y[2], col);
  this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), -Y[0], -Y[1], -Y[2], col);
  this.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), Z[0], Z[1], Z[2], col);
  this.quad(P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), -Z[0], -Z[1], -Z[2], col);
};
GB.prototype.cyl = function (x, y, z, rt, rb, h, seg, col, a0, fr) { // цилиндр/конус вдоль локальной оси Y
  fr = fr || FR0; var X = fr[0], Y = fr[1], Z = fr[2]; a0 = a0 || 0;
  function P(r, yy, a) { var lx = Math.cos(a) * r, lz = Math.sin(a) * r; return [x + X[0] * lx + Y[0] * yy + Z[0] * lz, y + X[1] * lx + Y[1] * yy + Z[1] * lz, z + X[2] * lx + Y[2] * yy + Z[2] * lz]; }
  var i, a, b, hh = h / 2;
  for (i = 0; i < seg; i++) {
    a = a0 + i / seg * Math.PI * 2; b = a0 + (i + 1) / seg * Math.PI * 2;
    var m = (a + b) / 2, nx = Math.cos(m), nz = Math.sin(m);
    var n = [X[0] * nx + Z[0] * nz, X[1] * nx + Z[1] * nz, X[2] * nx + Z[2] * nz];
    if (rt > 0) this.quad(P(rb, -hh, b), P(rb, -hh, a), P(rt, hh, a), P(rt, hh, b), n[0], n[1], n[2], col);
    else this.tri(P(rb, -hh, b), P(rb, -hh, a), P(0, hh, a), n[0], n[1], n[2], col);
    this.tri(P(rb, -hh, a), P(rb, -hh, b), P(0, -hh, 0), -Y[0], -Y[1], -Y[2], col);
    if (rt > 0) this.tri(P(rt, hh, b), P(rt, hh, a), P(0, hh, 0), Y[0], Y[1], Y[2], col);
  }
};
GB.prototype.geo = function () {
  var geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
  geo.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
  geo.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
  return geo;
};
var VMAT = g.mat(0xffffff, { vertexColors: true });
var dummy = new T.Object3D(), tmpV = new T.Vector3(), tmpV2 = new T.Vector3(), tmpC = new T.Color();
var IMAT = g.mat(0xfffffe, { vertexColors: true }); // отдельный материал для инстансов (у всех есть instanceColor)
function inst(geoName, f, max, shadow) { var m = new T.InstancedMesh(g.geo(geoName, f), IMAT, max); m.count = 0; tmpC.setRGB(1, 1, 1); for (var i = 0; i < max; i++) m.setColorAt(i, tmpC); m.castShadow = !!shadow; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); return m; }

/* ---------- куча для A* ---------- */
function Heap() { this.k = []; this.v = []; }
Heap.prototype.push = function (key, val) {
  var k = this.k, v = this.v, i = k.length; k.push(key); v.push(val);
  while (i > 0) { var p = (i - 1) >> 1; if (k[p] <= k[i]) break; var tk = k[p]; k[p] = k[i]; k[i] = tk; var tv = v[p]; v[p] = v[i]; v[i] = tv; i = p; }
};
Heap.prototype.pop = function () {
  var k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop();
  if (k.length) { k[0] = lk; v[0] = lv; var i = 0, n = k.length; for (; ;) { var l = 2 * i + 1, r = l + 1, m = i; if (l < n && k[l] < k[m]) m = l; if (r < n && k[r] < k[m]) m = r; if (m === i) break; var tk = k[m]; k[m] = k[i]; k[i] = tk; var tv = v[m]; v[m] = v[i]; v[i] = tv; i = m; } }
  return top;
};

/* ---------- состояние ---------- */
var S = null;                       // сохраняемое состояние
var VH, CELL, FOREST, BLOCK, HC;    // высоты углов, тип клетки (0 суша,1 вода,2 гора), лес, занято, высота центра
var CITIES = [], INDS = [], PLACES = [];
var ST = [], TR = [];               // станции, поезда (рантайм-объекты)
var EDGES = {}, ADJ = {}, RAIL = {}; // рёбра путей, смежность, число рёбер в клетке
var netVer = 0, railYc = {};

function hAt(x, z) { // билинейная высота поверхности
  var fx = x + H, fz = z + H; var i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0) i = 0; if (j < 0) j = 0; if (i > N - 1) i = N - 1; if (j > N - 1) j = N - 1;
  var u = fx - i, v = fz - j, W1 = N + 1, a = VH[j * W1 + i], b = VH[j * W1 + i + 1], c = VH[(j + 1) * W1 + i], d = VH[(j + 1) * W1 + i + 1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function railY(c) { return CELL[c] === 1 ? BRY : Math.max(.22, HC[c] + .1); }
function isWater(c) { return CELL[c] === 1; }

/* ---------- генерация мира ---------- */
function genWorld(seed) {
  var r = g.rng(seed), n1 = g.noise2(seed), n2 = g.noise2(seed * 3 + 11), n3 = g.noise2(seed * 7 + 5), W1 = N + 1, i, j, c;
  VH = new Float32Array(W1 * W1);
  for (j = 0; j < W1; j++) for (i = 0; i < W1; i++) {
    var e = g.fbm(n1, i * .055 + 10.3, j * .055 + 4.7), h = (e - .345) * 12;
    if (h > 2.2) h = 2.2 + (h - 2.2) * .3;                                      // плоскогорья вместо сплошных гор
    var m = g.fbm(n2, i * .07 + 2, j * .07 + 9); if (m > .6) h += (m - .6) * 30; // отдельные горные массивы
    var ed = Math.min(i, j, N - i, N - j); if (ed < 3) h -= (3 - ed) * .6; // края чуть ниже
    VH[j * W1 + i] = h;
  }
  function carve(cc) {
    var ii = ci(cc), jj = cj(cc), k = [jj * W1 + ii, jj * W1 + ii + 1, (jj + 1) * W1 + ii, (jj + 1) * W1 + ii + 1], q;
    for (q = 0; q < 4; q++) VH[k[q]] = Math.min(VH[k[q]], -.45);
    for (var dj = -1; dj <= 2; dj++) for (var di = -1; di <= 2; di++) { var vi = ii + di, vj = jj + dj; if (vi < 0 || vj < 0 || vi > N || vj > N) continue; var idx = vj * W1 + vi; VH[idx] = Math.min(VH[idx], .7); } // пологие берега
  }
  function hc(cc) { return hAt(cx(cc), cz(cc)); }
  for (var rv = 0; rv < 3; rv++) { // реки: стекают с холмов до воды
    var cur = -1, tries = 0;
    while (tries++ < 400) { c = cid(3 + Math.floor(r() * (N - 6)), 3 + Math.floor(r() * (N - 6))); var hh = hc(c); if (hh > 1.4 && hh < 3.2) { cur = c; break; } }
    if (cur < 0) continue;
    var vis = {}, step;
    for (step = 0; step < 160; step++) {
      vis[cur] = 1; carve(cur); var best = -1, bh = 1e9, ii = ci(cur), jj = cj(cur);
      for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
        if (!di && !dj) continue; var ni = ii + di, nj = jj + dj; if (ni < 1 || nj < 1 || ni >= N - 1 || nj >= N - 1) continue;
        var nc = cid(ni, nj); if (vis[nc]) continue; var v = hc(nc) + (r() - .5) * .5 + (di && dj ? .3 : 0); if (v < bh) { bh = v; best = nc; }
      }
      if (best < 0) break; cur = best; if (hc(cur) < -.2) { carve(cur); break; }
    }
  }
  CELL = new Uint8Array(N * N); HC = new Float32Array(N * N); FOREST = new Uint8Array(N * N); BLOCK = new Uint8Array(N * N);
  for (c = 0; c < N * N; c++) { HC[c] = hc(c); CELL[c] = HC[c] < WL ? 1 : HC[c] > MT ? 2 : 0; }
  // города
  CITIES = []; INDS = []; var names = NAMES.slice(); for (i = names.length - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); var t = names[i]; names[i] = names[j]; names[j] = t; }
  function slope(cc) { var ii = ci(cc), jj = cj(cc), k = [VH[jj * W1 + ii], VH[jj * W1 + ii + 1], VH[(jj + 1) * W1 + ii], VH[(jj + 1) * W1 + ii + 1]]; return Math.max(k[0], k[1], k[2], k[3]) - Math.min(k[0], k[1], k[2], k[3]); }
  function farFrom(cc, list, d) { for (var q = 0; q < list.length; q++) if (dist(cc, list[q].c) < d) return false; return true; }
  var md = 11, tries = 0;
  while (CITIES.length < 10 && tries++ < 6000) {
    if (tries === 3000) md = 9;
    c = cid(4 + Math.floor(r() * (N - 8)), 4 + Math.floor(r() * (N - 8)));
    if (CELL[c] !== 0 || HC[c] < .15 || HC[c] > 2.4 || slope(c) > .8 || !farFrom(c, CITIES, md)) continue;
    CITIES.push({ kind: 'city', c: c, x: cx(c), z: cz(c), n: names[CITIES.length], lvl: 1, grow: 0, last: {}, served: false });
  }
  // производства
  function nearWater(cc) { var ii = ci(cc), jj = cj(cc); for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) { var ni = ii + di, nj = jj + dj; if (ni >= 0 && nj >= 0 && ni < N && nj < N && CELL[cid(ni, nj)] === 1) return true; } return false; }
  function nearCity(cc) { var best = 1e9; for (var q = 0; q < CITIES.length; q++) best = Math.min(best, dist(cc, CITIES[q].c)); return best; }
  var want = ['mine', 'saw', 'farm', 'fact', 'port', 'power', 'mine', 'farm', 'saw', 'fact'];
  for (var w = 0; w < want.length; w++) {
    var k = want[w]; tries = 0;
    while (tries++ < 4000) {
      c = cid(3 + Math.floor(r() * (N - 6)), 3 + Math.floor(r() * (N - 6)));
      if (CELL[c] !== 0 || slope(c) > 1.0 || !farFrom(c, INDS, 5) || nearCity(c) < 3.5) continue;
      var ok = k === 'mine' ? HC[c] > 1.6 : k === 'farm' ? HC[c] < 1.3 : k === 'port' ? nearWater(c) : k === 'fact' ? nearCity(c) < 8 : k === 'saw' ? g.fbm(n3, ci(c) * .09, cj(c) * .09) > .5 : true;
      if (tries > 2500) ok = true;
      if (!ok) continue;
      INDS.push({ kind: k, c: c, x: cx(c), z: cz(c), n: IND[k].n, buf: 0, served: false, last: {} }); break;
    }
  }
  PLACES = CITIES.concat(INDS);
  for (i = 0; i < PLACES.length; i++) { BLOCK[PLACES[i].c] = 1; PLACES[i].id = i; }
  for (i = 0; i < CITIES.length; i++) for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) { // площадь вокруг ратуши: без рельсов и станций
    var pi = ci(CITIES[i].c) + di, pj = cj(CITIES[i].c) + dj; if (pi < 0 || pj < 0 || pi >= N || pj >= N) continue; var pc = cid(pi, pj); if (!BLOCK[pc]) BLOCK[pc] = 3; }
  for (i = 0; i < INDS.length; i++) { var nc2 = 1e9, nn = ''; for (j = 0; j < CITIES.length; j++) { var dd = dist(INDS[i].c, CITIES[j].c); if (dd < nc2) { nc2 = dd; nn = CITIES[j].n; } } INDS[i].n = IND[INDS[i].kind].n + ' у ' + nn; }
  // лес
  for (c = 0; c < N * N; c++) {
    if (CELL[c] !== 0 || BLOCK[c]) continue;
    var f = g.fbm(n3, ci(c) * .09 + 1, cj(c) * .09 + 3); var nearP = false;
    for (i = 0; i < PLACES.length; i++) if (cheb(c, PLACES[i].c) <= (PLACES[i].kind === 'city' ? 2 : 1)) { nearP = true; break; }
    if (nearP) continue;
    if (f > .63) FOREST[c] = 2; else if (f > .56) FOREST[c] = 1; else if (f > .5 && r() < .2) FOREST[c] = 1;
  }
}

/* ---------- рендер мира ---------- */
var terrain, water, waterPos, trees, houses, windows, lamps, stMesh, railMesh, crates, people, smoke, heads, locos = {}, wagons, labels = [], ring, preview, prevPos;
function buildTerrain() {
  var b = new GB(), W1 = N + 1, i, j, r2 = g.rng(S.seed + 99);
  for (j = 0; j < N; j++) for (i = 0; i < N; i++) {
    var c = cid(i, j), h = HC[c], col;
    if (h < -.6) col = 0x6f8f6a; else if (h < .25) col = 0xe3cf92; else if (h < 1.5) col = 0x8ccb66; else if (h < 2.5) col = 0x6fab57; else if (h < MT) col = 0x9c9b7f; else if (h < 4.4) col = 0x8e8f9c; else col = 0xf1f4f8;
    var cc = C(col), v = 1 + (r2() - .5) * .08, cv = [cc[0] * v, cc[1] * v, cc[2] * v];
    var x0 = i - H, z0 = j - H, a = [x0, VH[j * W1 + i], z0], bb = [x0 + 1, VH[j * W1 + i + 1], z0], d = [x0, VH[(j + 1) * W1 + i], z0 + 1], e = [x0 + 1, VH[(j + 1) * W1 + i + 1], z0 + 1];
    b.tri(a, d, bb, 0, 1, 0, cv); b.tri(bb, d, e, 0, 1, 0, cv);
  }
  terrain = new T.Mesh(b.geo(), VMAT); terrain.receiveShadow = true; scene.add(terrain);
  var base = new T.Mesh(new T.BoxGeometry(N, 5, N), g.mat(0x5b4b3f)); base.position.y = -3.4; scene.add(base);
  var wg = new T.PlaneGeometry(N, N, 36, 36); wg.rotateX(-Math.PI / 2);
  water = new T.Mesh(wg, g.mat(0x4aa3d6, { transparent: true, opacity: .78, roughness: .4, metalness: .1 })); water.position.y = WL - .02; water.receiveShadow = true; scene.add(water);
  waterPos = wg.attributes.position;
}
function buildTrees() {
  var r = g.rng(S.seed + 5), list = [], c, k;
  for (c = 0; c < N * N; c++) if (FOREST[c]) for (k = 0; k < FOREST[c]; k++) list.push(c);
  if (list.length > 1100) list.length = 1100;
  trees = inst('tree', function () { var b = new GB(); b.cyl(0, .18, 0, .06, .08, .36, 5, C(0x7a5236)); b.cyl(0, .56, 0, 0, .3, .6, 6, C(0x5fae5a)); b.cyl(0, .92, 0, 0, .21, .5, 6, C(0x6cc26a), .5); return b.geo(); }, list.length, true);
  trees.count = list.length; trees.userData.cells = list; trees.userData.data = [];
  for (k = 0; k < list.length; k++) {
    c = list[k]; var x = cx(c) + (r() - .5) * .8, z = cz(c) + (r() - .5) * .8, sc = .7 + r() * .55;
    trees.userData.data.push([x, z, sc, r() * 6.3]);
    dummy.position.set(x, hAt(x, z) - .05, z); dummy.rotation.set(0, r() * 6.3, 0); dummy.scale.setScalar(sc); dummy.updateMatrix(); trees.setMatrixAt(k, dummy.matrix);
    tmpC.setRGB(.85 + r() * .3, .9 + r() * .2, .85 + r() * .3); trees.setColorAt(k, tmpC);
  }
  trees.instanceMatrix.needsUpdate = true; if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
}
function refreshTrees() { // деревья на клетках с путями/станциями прячем
  var d = trees.userData, k;
  for (k = 0; k < d.cells.length; k++) {
    var c = d.cells[k], hide = RAIL[c] || BLOCK[c] === 2 || HOUSE_CELLS[c], t = d.data[k];
    dummy.position.set(t[0], hAt(t[0], t[1]) - .05, t[1]); dummy.rotation.set(0, t[3], 0); dummy.scale.setScalar(hide ? 0 : t[2]); dummy.updateMatrix(); trees.setMatrixAt(k, dummy.matrix);
  }
  trees.instanceMatrix.needsUpdate = true;
}
function houseGeo() { var b = new GB(); b.box(0, .21, 0, .55, .42, .55, C(0xf2e6d0)); b.cyl(0, .56, 0, 0, .44, .3, 4, C(0xc25a4a), Math.PI / 4); b.box(.16, .6, .1, .08, .22, .08, C(0x6a5a5a)); return b.geo(); }
function hallGeo() { var b = new GB(); b.box(0, .04, 0, 1.9, .08, 1.9, C(0xcfc3ad)); b.box(0, .45, 0, 1.1, .8, .9, C(0xf4ecd8)); b.cyl(0, 1.05, 0, 0, .78, .45, 4, C(0xb5533f), Math.PI / 4); b.box(.42, .8, .3, .3, 1.5, .3, C(0xe9dcc2)); b.cyl(.42, 1.72, .3, 0, .26, .35, 4, C(0x8a5a5a), Math.PI / 4); b.cyl(-.5, .3, -.6, .06, .06, .5, 4, C(0x6a6a6a)); return b.geo(); }
var HOUSE_CELLS = {}; // клетка → домик
function buildCities() { // ратуши + подписи (один раз)
  for (var i = 0; i < CITIES.length; i++) {
    var ct = CITIES[i], m = new T.Mesh(g.geo('hall', hallGeo), VMAT); m.position.set(ct.x, HC[ct.c], ct.z); m.castShadow = true; m.receiveShadow = true; scene.add(m); ct.mesh = m;
    ct.label = makeLabel(ct.x, HC[ct.c] + 2.6, ct.z); updateLabel(ct);
  }
  houses = inst('house', houseGeo, 260, true);
  windows = new T.InstancedMesh(g.geo('win', function () { return new T.BoxGeometry(.12, .13, .03); }), new T.MeshBasicMaterial({ color: 0xffd98a }), 560); windows.count = 0; windows.frustumCulled = false; scene.add(windows);
}
function rebuildHouses() {
  var n = 0, w = 0, i, k;
  HOUSE_CELLS = {};
  for (i = 0; i < CITIES.length; i++) {
    var ct = CITIES[i], r = g.rng(S.seed + 1000 + i), cnt = 2 + ct.lvl * 3, rad = 1 + Math.ceil(ct.lvl * .7), cand = [], ii = ci(ct.c), jj = cj(ct.c), di, dj;
    for (dj = -rad; dj <= rad; dj++) for (di = -rad; di <= rad; di++) {
      if (!di && !dj) continue; var ni = ii + di, nj = jj + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      var c = cid(ni, nj); if (CELL[c] !== 0 || (BLOCK[c] && BLOCK[c] !== 3) || RAIL[c]) continue;
      cand.push({ c: c, d: Math.sqrt(di * di + dj * dj) + r() * .9 });
    }
    cand.sort(function (a, b) { return a.d - b.d; });
    for (k = 0; k < cnt && k < cand.length && n < 260; k++) {
      var cc = cand[k].c, x = cx(cc) + (r() - .5) * .3, z = cz(cc) + (r() - .5) * .3, rot = Math.floor(r() * 4) * Math.PI / 2, y = hAt(x, z);
      HOUSE_CELLS[cc] = ct;
      dummy.position.set(x, y, z); dummy.rotation.set(0, rot, 0); dummy.scale.setScalar(.9 + r() * .25); dummy.updateMatrix(); houses.setMatrixAt(n, dummy.matrix);
      tmpC.setHSL(.07 + r() * .12, .35, .8); houses.setColorAt(n, tmpC); n++;
      if (w < 558) { tmpV.set(-.14, .22, .28).applyMatrix4(dummy.matrix); windows.setMatrixAt(w, dummy.matrix.clone().setPosition(tmpV)); w++; tmpV.set(.14, .22, .28).applyMatrix4(dummy.matrix); windows.setMatrixAt(w, dummy.matrix.clone().setPosition(tmpV)); w++; }
    }
  }
  houses.count = n; houses.instanceMatrix.needsUpdate = true; if (houses.instanceColor) houses.instanceColor.needsUpdate = true;
  windows.count = w; windows.instanceMatrix.needsUpdate = true;
  if (trees) refreshTrees();
}
function indGeo(k) {
  return g.geo('ind' + k, function () {
    var b = new GB();
    if (k === 'mine') { b.cyl(0, .35, 0, .2, 1.0, .7, 7, C(0x6b5a4a)); b.box(-.35, .7, .3, .08, 1.4, .08, C(0x5a4a3a)); b.box(.35, .7, .3, .08, 1.4, .08, C(0x5a4a3a)); b.box(0, 1.4, .3, .9, .1, .1, C(0x5a4a3a)); b.cyl(0, 1.3, .3, .14, .14, .08, 8, C(0x444), 0, [[1, 0, 0], [0, 0, 1], [0, -1, 0]]); b.box(.5, .15, -.4, .35, .25, .25, C(0x3a3a40)); }
    else if (k === 'saw') { b.box(0, .3, 0, 1.3, .6, .8, C(0xb98a5a)); b.cyl(0, .72, 0, 0, .8, .35, 4, C(0x7a4a2a), Math.PI / 4); for (var i = 0; i < 3; i++) b.cyl(-.1 + i * .22 - .3, .12, .75, .1, .1, .9, 6, C(0xa5713f), 0, [[0, 1, 0], [1, 0, 0], [0, 0, 1]]); b.cyl(-.3, .22, .75, .1, .1, .9, 6, C(0xb07a44), 0, [[0, 1, 0], [1, 0, 0], [0, 0, 1]]); b.cyl(.6, .45, .3, .12, .12, .04, 8, C(0x9a9aa0), 0, [[0, 1, 0], [1, 0, 0], [0, 0, 1]]); }
    else if (k === 'farm') { b.box(0, .3, 0, .9, .6, .7, C(0xc9463d)); b.cyl(0, .72, 0, 0, .62, .35, 4, C(0x7a3a30), Math.PI / 4); b.cyl(.75, .45, -.2, .2, .2, .9, 8, C(0xd8d2c0)); b.cyl(.75, .98, -.2, 0, .24, .18, 8, C(0x9a3a30)); b.box(-.9, .03, .6, .9, .06, .5, C(0xe0c868)); b.box(-.9, .03, 0, .9, .06, .5, C(0xc9b860)); b.box(0, .03, .85, .9, .06, .4, C(0xd4c070)); }
    else if (k === 'fact') { b.box(0, .4, 0, 1.6, .8, 1.0, C(0xb9705a)); for (var q = -2; q <= 1; q++) b.box(q * .4 + .2, .95, 0, .4, .3, 1.0, C(0x9a5a48), [[.7, .7, 0], [-.7, .7, 0], [0, 0, 1]]); b.cyl(-.5, 1.3, -.3, .12, .14,1.3, 7, C(0x6a6a70)); b.cyl(.3, 1.2, -.3, .1, .12, 1.1, 7, C(0x6a6a70)); b.box(0, .1, .7, 1.2, .2, .3, C(0x7a7a80)); }
    else if (k === 'port') { b.box(0, .3, 0, 1.2, .6, .7, C(0x8aa0b4)); b.box(0, .62, 0, 1.25, .08, .75, C(0x5a7084)); b.box(0, .12, 1.0, .8, .12, 1.6, C(0xa0845a)); b.box(.4, 1.0, .9, .12, 1.8, .12, C(0xd99a3a)); b.box(.4, 1.85, .4, .12, .1, 1.5, C(0xd99a3a)); b.box(-.4, .2, -.6, .3, .3, .3, C(0xd9814f)); b.box(-.05, .2, -.6, .3, .3, .3, C(0x5aa0e0)); }
    else { b.box(0, .4, 0, 1.3, .8, .8, C(0xb8b0a0)); b.cyl(.0, .95, -.1, .42, .55, 1.3, 9, C(0xd2d0cc)); b.cyl(-.7, 1.0, .2, .1, .12, 1.8, 7, C(0x8a8a90)); b.box(.6, .3, .5, .3, .2, .3, C(0x3a3a40)); b.box(.6, .55, .5, .2, .3, .05, C(0x5a7a9a)); }
    return b.geo();
  });
}
function buildInds() {
  for (var i = 0; i < INDS.length; i++) {
    var d = INDS[i], m = new T.Mesh(indGeo(d.kind), VMAT); m.position.set(d.x, HC[d.c], d.z); m.rotation.y = (d.kind === 'port') ? portRot(d) : 0; m.castShadow = true; m.receiveShadow = true; scene.add(m); d.mesh = m;
    d.label = makeLabel(d.x, HC[d.c] + 2.4, d.z); updateLabel(d);
  }
}
function portRot(d) { var ii = ci(d.c), jj = cj(d.c), ds = [[0, 1, 0], [1, 0, Math.PI / 2], [0, -1, Math.PI], [-1, 0, -Math.PI / 2]]; for (var k = 0; k < 4; k++) { var ni = ii + ds[k][0], nj = jj + ds[k][1]; if (ni >= 0 && nj >= 0 && ni < N && nj < N && CELL[cid(ni, nj)] === 1) return ds[k][2]; } return 0; }

/* подписи (спрайты с названием и значками спроса) */
function makeLabel(x, y, z) {
  var c = document.createElement('canvas'); c.width = 256; c.height = 64;
  var tex = new T.CanvasTexture(c), sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(4.8, 1.2, 1); sp.position.set(x, y, z); sp.userData.c = c; scene.add(sp); labels.push(sp); return sp;
}
function updateLabel(p) {
  var sp = p.label, c = sp.userData.c, x = c.getContext('2d'); x.clearRect(0, 0, 256, 64);
  var txt = p.kind === 'city' ? p.n + ' · ' + p.lvl : IND[p.kind].e + ' ' + IND[p.kind].n;
  var need = '';
  if (p.kind === 'city') { for (var i = 0; i < CARGO.length; i++) { var k = CARGO[i]; if (cityAcc(p)[k] && (!(p.last[k] >= 0) || S.t - p.last[k] > 100)) need += CI[k].e; } }
  else { var ac = IND[p.kind].acc; for (var kk in ac) if (!(p.last && S.t - (p.last[kk] || -999) < 100)) need += CI[kk].e; }
  if (!p.served) need = '🚉?';
  x.font = '700 26px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  var w = x.measureText(txt).width + 20;
  x.fillStyle = 'rgba(10,20,30,.62)'; x.beginPath(); x.roundRect ? x.roundRect(128 - w / 2, 2, w, 34, 10) : x.rect(128 - w / 2, 2, w, 34); x.fill();
  x.fillStyle = '#fff'; x.fillText(txt, 128, 19);
  if (need) { x.font = '22px system-ui,sans-serif'; x.fillText(need, 128, 50); }
  sp.material.map.needsUpdate = true;
}
function cityAcc(ct) { return { pass: 1, mail: 1, goods: 1, grain: ct.lvl >= 2 ? 1 : 0 }; }
function placeAcc(p) { return p.kind === 'city' ? cityAcc(p) : IND[p.kind].acc; }
function placeProd(p) {
  if (p.kind !== 'city') return IND[p.kind].prod;
  var m = (S.ev && S.ev.type === 'holiday' && S.ev.p === p.id && S.t < S.ev.until) ? 3 : 1;
  return { pass: (.12 + .1 * p.lvl) * m * (S.powered ? 1.2 : 1), mail: .04 + .03 * p.lvl };
}

/* ---------- сеть путей ---------- */
function ek(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
function addEdge(a, b) { var k = ek(a, b); if (EDGES[k]) return false; EDGES[k] = 1; (ADJ[a] = ADJ[a] || []).push(b); (ADJ[b] = ADJ[b] || []).push(a); RAIL[a] = (RAIL[a] || 0) + 1; RAIL[b] = (RAIL[b] || 0) + 1; return true; }
function delEdge(a, b) { var k = ek(a, b); if (!EDGES[k]) return; delete EDGES[k]; ADJ[a].splice(ADJ[a].indexOf(b), 1); ADJ[b].splice(ADJ[b].indexOf(a), 1); RAIL[a]--; RAIL[b]--; }
function bridgeCost() { return S.tier >= 2 ? 70 : 120; }
function stepMoney(u, v) { var diag = ci(u) !== ci(v) && cj(u) !== cj(v); var m = diag ? 35 : 25; m += Math.abs(railY(u) - railY(v)) * 40; if (isWater(u) || isWater(v)) m += bridgeCost(); if (FOREST[v]) m += 8; return m; }
function stepCost(u, v, diag) {
  var base = diag ? 1.414 : 1; if (EDGES[ek(u, v)]) return base * .25;
  var c = base; if (isWater(v)) c += 3; if (isWater(u)) c += 1; c += Math.abs(railY(u) - railY(v)) * 3; if (FOREST[v]) c += .4; return c;
}
function astar(a, b) { // путь по сетке от клетки a до b (8 направлений), null если нет
  var G2 = new Float32Array(N * N), came = new Int32Array(N * N), closed = new Uint8Array(N * N), i; for (i = 0; i < N * N; i++) { G2[i] = 1e9; came[i] = -1; }
  var open = new Heap(); G2[a] = 0; open.push(0, a); var bi = ci(b), bj = cj(b);
  while (open.k.length) {
    var u = open.pop(); if (closed[u]) continue; closed[u] = 1; if (u === b) break;
    var ui = ci(u), uj = cj(u);
    for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
      if (!di && !dj) continue; var ni = ui + di, nj = uj + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      var v = cid(ni, nj); if (closed[v]) continue; if (v !== b && (CELL[v] === 2 || BLOCK[v] === 1 || BLOCK[v] === 3)) continue;
      var diag = di && dj;
      if (diag) { if (CELL[cid(ui + di, uj)] === 2 || CELL[cid(ui, uj + dj)] === 2) continue; if (EDGES[ek(cid(ui + di, uj), cid(ui, uj + dj))]) continue; }
      var ng = G2[u] + stepCost(u, v, diag);
      if (ng < G2[v]) { G2[v] = ng; came[v] = u; var dx = Math.abs(ni - bi), dz = Math.abs(nj - bj); open.push(ng + Math.max(dx, dz) + .414 * Math.min(dx, dz), v); }
    }
  }
  if (came[b] < 0 && a !== b) return null;
  var path = [b], cur = b; while (cur !== a) { cur = came[cur]; path.push(cur); } path.reverse(); return path;
}
function pathMoney(p) { var m = 0; for (var i = 1; i < p.length; i++) if (!EDGES[ek(p[i - 1], p[i])]) m += stepMoney(p[i - 1], p[i]); return Math.round(m); }
function railPath(a, b) { // кратчайший путь по рельсам (Дейкстра)
  if (a === b) return [a];
  var D = {}, came = {}, open = new Heap(); D[a] = 0; open.push(0, a);
  while (open.k.length) {
    var u = open.pop(); if (u === b) break; var ad = ADJ[u]; if (!ad) continue;
    for (var i = 0; i < ad.length; i++) { var v = ad[i], nd = D[u] + (ci(u) !== ci(v) && cj(u) !== cj(v) ? 1.414 : 1); if (!(v in D) || nd < D[v]) { D[v] = nd; came[v] = u; open.push(nd, v); } }
  }
  if (!(b in came)) return null; var p = [b], c = b; while (c !== a) { c = came[c]; p.push(c); } p.reverse(); return p;
}
function buildRailMesh() {
  if (railMesh) { scene.remove(railMesh); railMesh.geometry.dispose(); }
  var b = new GB(), piers = {}, cw = C(0x6b5440), cs = C(0x9aa0a8), cg = C(0xa39d8f), cd = C(0xb8a992), cp = C(0x7f7f86), k;
  for (k in EDGES) {
    var ab = k.split('|'), a = +ab[0], c2 = +ab[1], x0 = cx(a), y0 = railY(a), z0 = cz(a), x1 = cx(c2), y1 = railY(c2), z1 = cz(c2);
    var dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, len = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= len; dy /= len; dz /= len;
    var sl = Math.sqrt(dx * dx + dz * dz), sx = dz / sl, sz = -dx / sl;                // боковая ось
    var ux = dy * sz - 0, uy = dz * sx - dx * sz, uz = -dy * sx; var ul = Math.sqrt(ux * ux + uy * uy + uz * uz); ux /= ul; uy /= ul; uz /= ul; // «верх» = d × side
    var fr = [[sx, 0, sz], [ux, uy, uz], [dx, dy, dz]], mx = (x0 + x1) / 2, my = (y0 + y1) / 2, mz = (z0 + z1) / 2, wa = isWater(a), wb = isWater(c2);
    if (wa || wb) b.box(mx, my - .06, mz, .9, .12, len + .1, cd, fr); else b.box(mx, my - .04, mz, .8, .08, len, cg, fr);
    var n = Math.max(2, Math.round(len / .33)), i;
    for (i = 0; i < n; i++) { var t = (i + .5) / n - .5; b.box(mx + dx * t * len + ux * .03, my + dy * t * len + uy * .03, mz + dz * t * len + uz * .03, .6, .05, .12, cw, fr); }
    b.box(mx + sx * .2 + ux * .09, my + uy * .09, mz + sz * .2 + uz * .09, .06, .07, len + .08, cs, fr);
    b.box(mx - sx * .2 + ux * .09, my + uy * .09, mz - sz * .2 + uz * .09, .06, .07, len + .08, cs, fr);
    var ends = [a, c2];
    for (i = 0; i < 2; i++) if (isWater(ends[i]) && !piers[ends[i]]) { piers[ends[i]] = 1; var ex = cx(ends[i]), ez = cz(ends[i]), top = BRY - .1, bot = -1.2; b.box(ex, (top + bot) / 2, ez, .36, top - bot, .36, cp); }
  }
  railMesh = new T.Mesh(b.geo(), VMAT); railMesh.receiveShadow = true; railMesh.castShadow = false; scene.add(railMesh);
  netVer++;
}
function buildTrack(a, b) { // проложить путь между клетками (станции/рельсы), вернуть стоимость или -1
  var p = astar(a, b); if (!p) { g.toast('Сюда путь не проложить', 'bad'); g.sfx('bad'); return -1; }
  var cost = pathMoney(p);
  if (cost > S.money) { g.toast('Не хватает денег: нужно ' + g.fmt(cost), 'bad'); g.sfx('bad'); return -1; }
  S.money -= cost; var added = 0;
  for (var i = 1; i < p.length; i++) if (addEdge(p[i - 1], p[i])) added++;
  afterNetChange(); g.sfx('place');
  if (added) g.toast('Путь проложен: ' + (p.length - 1) + ' клеток за ' + g.fmt(cost)); else g.toast('Путь уже есть');
  return cost;
}
function removeRailAt(c) {
  var ad = (ADJ[c] || []).slice(); if (!ad.length) return false;
  for (var i = 0; i < ad.length; i++) delEdge(c, ad[i]);
  S.money += ad.length * 15; afterNetChange(); g.sfx('remove'); return true;
}
function afterNetChange() { buildRailMesh(); refreshTrees(); rebuildHouses(); updateServing(); checkGoals(); hudDirty = true; }

/* ---------- станции ---------- */
function stRadius(st) { return 2 + st.lvl; }
function stationAt(c) { for (var i = 0; i < ST.length; i++) if (ST[i].c === c) return ST[i]; return null; }
function stationNear(c) { var st = stationAt(c); if (st) return st; for (var i = 0; i < ST.length; i++) if (cheb(ST[i].c, c) <= 1) return ST[i]; return null; }
function placeStation(c) {
  if (c < 0 || CELL[c] !== 0 || BLOCK[c]) { g.toast('Здесь нельзя строить', 'bad'); g.sfx('bad'); return null; }
  if (S.money < ST_COST) { g.toast('Нужно ' + ST_COST + ' на станцию', 'bad'); g.sfx('bad'); return null; }
  S.money -= ST_COST; var st = { c: c, lvl: 1, stock: {}, serves: [], acc: {}, n: '' }; for (var i = 0; i < CARGO.length; i++) st.stock[CARGO[i]] = 0;
  ST.push(st); BLOCK[c] = 2; updateServing(); buildStations(); refreshTrees(); rebuildHouses(); g.sfx('place');
  if (!st.serves.length) g.toast('Рядом нет городов и производств — станция будет пустой', 'bad'); else g.toast('Станция у: ' + st.n);
  checkGoals(); hudDirty = true; return st;
}
function removeStation(st) {
  var i = ST.indexOf(st); if (i < 0) return; ST.splice(i, 1); BLOCK[st.c] = 0; S.money += ST_COST * .5;
  for (var k = 0; k < TR.length; k++) { var tr = TR[k], r = tr.route; for (var q = r.length - 1; q >= 0; q--) { if (r[q] === st) r.splice(q, 1); } if (r.length < 2) { tr.state = 'idle'; } else if (tr.at === st || tr.to === st) { tr.at = r[0]; tr.to = null; tr.state = 'wait'; tr.wt = .5; } }
  updateServing(); buildStations(); rebuildHouses(); g.sfx('remove'); hudDirty = true;
}
function upgradeStation(st) {
  if (st.lvl >= 3) return; var need = st.lvl === 1 ? 2 : 5; if (S.tier < need) { g.toast('Откроется на ступени ' + need, 'bad'); return; }
  var cost = ST_UP[st.lvl]; if (S.money < cost) { g.toast('Нужно ' + g.fmt(cost), 'bad'); g.sfx('bad'); return; }
  S.money -= cost; st.lvl++; updateServing(); buildStations(); g.sfx('up'); g.toast('Станция улучшена: уровень ' + st.lvl, 'good'); hudDirty = true;
}
function updateServing() { // кто кого обслуживает + названия станций
  var i, k;
  for (i = 0; i < PLACES.length; i++) { PLACES[i].st = null; PLACES[i].served = false; }
  for (i = 0; i < ST.length; i++) { var st = ST[i]; st.serves = []; st.acc = {}; }
  for (k = 0; k < PLACES.length; k++) { var p = PLACES[k], best = null, bd = 1e9; for (i = 0; i < ST.length; i++) { var d = cheb(ST[i].c, p.c); if (d <= stRadius(ST[i]) && d < bd) { bd = d; best = ST[i]; } } if (best) { p.st = best; p.served = true; best.serves.push(p); } }
  for (i = 0; i < ST.length; i++) { var s2 = ST[i]; s2.serves.sort(function (a, b) { return (a.kind === 'city' ? 0 : 1) - (b.kind === 'city' ? 0 : 1); }); var acc = {}; for (k = 0; k < s2.serves.length; k++) { var a2 = placeAcc(s2.serves[k]); for (var q in a2) if (a2[q]) acc[q] = 1; } s2.acc = acc; s2.n = s2.serves.length ? s2.serves[0].n : 'пустошь'; }
  for (i = 0; i < PLACES.length; i++) updateLabel(PLACES[i]);
  compComponents();
}
var COMP = {};
function compComponents() { // компоненты связности по рельсам → сколько городов соединено
  var id = 0, c; COMP = {};
  for (c in ADJ) { if (COMP[c] !== undefined || !ADJ[c].length) continue; id++; var stack = [+c]; COMP[c] = id; while (stack.length) { var u = stack.pop(), ad = ADJ[u]; for (var i = 0; i < ad.length; i++) { var v = ad[i]; if (COMP[v] === undefined) { COMP[v] = id; stack.push(v); } } } }
  var byComp = {}, i2;
  for (i2 = 0; i2 < CITIES.length; i2++) { var ct = CITIES[i2]; ct.conn = false; if (ct.st && COMP[ct.st.c] !== undefined) { var k = COMP[ct.st.c]; (byComp[k] = byComp[k] || []).push(ct); } }
  S.connected = 0; for (var k2 in byComp) if (byComp[k2].length >= 2) for (i2 = 0; i2 < byComp[k2].length; i2++) { byComp[k2][i2].conn = true; S.connected++; }
}
function stGeo() { var b = new GB(); b.box(0, .06, 0, 1.6, .12, 1.1, C(0xbcb5a6)); b.box(0, .34, -.3, .55, .45, .5, C(0xe9d9b8)); b.cyl(0, .68, -.3, 0, .46, .25, 4, C(0x5a7a9a), Math.PI / 4); b.box(.6, .42, .3, .05, .6, .05, C(0x3a3a40)); b.box(-.6, .5, .25, .3, .14, .04, C(0xf0f0f0)); b.box(0, .55, .1, .5, .03, .7, C(0x6a8aa4)); b.box(-.22, .35, .3, .04, .4, .04, C(0x3a3a40)); b.box(.22, .35, .3, .04, .4, .04, C(0x3a3a40)); return b.geo(); }
function buildStations() {
  if (!stMesh) { stMesh = inst('st', stGeo, 64, true); lamps = new T.InstancedMesh(g.geo('lamp', function () { return new T.IcosahedronGeometry(.08, 0); }), new T.MeshBasicMaterial({ color: 0xffe9a0 }), 64); lamps.count = 0; lamps.frustumCulled = false; scene.add(lamps); }
  for (var i = 0; i < ST.length && i < 64; i++) {
    var st = ST[i], ad = ADJ[st.c], yaw = 0; if (ad && ad.length) yaw = Math.atan2(cx(ad[0]) - cx(st.c), cz(ad[0]) - cz(st.c));
    st.yaw = yaw; dummy.position.set(cx(st.c), railY(st.c) - .12, cz(st.c)); dummy.rotation.set(0, yaw, 0); dummy.scale.setScalar(1 + (st.lvl - 1) * .18); dummy.updateMatrix(); stMesh.setMatrixAt(i, dummy.matrix);
    tmpV.set(.6, .75, .3).applyMatrix4(dummy.matrix); lamps.setMatrixAt(i, dummy.matrix.clone().setPosition(tmpV));
  }
  stMesh.count = Math.min(ST.length, 64); stMesh.instanceMatrix.needsUpdate = true; lamps.count = stMesh.count; lamps.instanceMatrix.needsUpdate = true;
}
function stLoad(st) { var s = 0; for (var i = 0; i < CARGO.length; i++) s += st.stock[CARGO[i]]; return s; }
function updateQueues() { // ящики и человечки у станций: чем больше ждёт, тем длиннее ряды
  if (!crates) { crates = inst('crate', function () { return new T.BoxGeometry(.2, .2, .2); }, 300, false); people = inst('man', function () { var b = new GB(); b.cyl(0, .1, 0, .05, .06, .2, 5, C(0x3a6ad0)); b.cyl(0, .25, 0, .05, .05, .09, 5, C(0xf0c8a0)); return b.geo(); }, 200, false); }
  var nc = 0, np = 0, i, k;
  for (i = 0; i < ST.length; i++) {
    var st = ST[i], r = g.rng(i * 77 + 3), cap = ST_CAP[st.lvl], sy = Math.sin(st.yaw || 0), cy = Math.cos(st.yaw || 0), slot = 0;
    for (k = 0; k < CARGO.length; k++) {
      var ty = CARGO[k], n = Math.min(14, Math.floor(st.stock[ty] / 6)); if (!n) continue;
      for (var q = 0; q < n; q++, slot++) {
        var row = Math.floor(slot / 7), col = slot % 7, lx = -.75 + col * .25, lz = .85 + row * .28; // ряды сбоку от платформы
        var x = cx(st.c) + lx * cy + lz * sy, z = cz(st.c) - lx * sy + lz * cy, y = hAt(x, z);
        if (ty === 'pass') { if (np >= 200) continue; dummy.position.set(x, y, z); dummy.rotation.set(0, r() * 6.3, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); people.setMatrixAt(np, dummy.matrix); tmpC.setHSL(r(), .6, .55); people.setColorAt(np, tmpC); np++; }
        else { if (nc >= 300) continue; dummy.position.set(x, y + .1, z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(stLoad(st) > cap ? 1.15 : 1); dummy.updateMatrix(); crates.setMatrixAt(nc, dummy.matrix); tmpC.setHex(CI[ty].c); crates.setColorAt(nc, tmpC); nc++; }
      }
    }
  }
  crates.count = nc; crates.instanceMatrix.needsUpdate = true; if (crates.instanceColor) crates.instanceColor.needsUpdate = true;
  people.count = np; people.instanceMatrix.needsUpdate = true; if (people.instanceColor) people.instanceColor.needsUpdate = true;
}

/* ---------- поезда ---------- */
function locoGeo(k) {
  return g.geo('loco' + k, function () {
    var b = new GB(), col = C(TT[k].col), dark = C(0x2b2d33), glass = C(0x9fd3ea), ZX = [[0, 0, -1], [0, 1, 0], [1, 0, 0]];
    b.box(0, .14, 0, .5, .12, 1.0, dark);
    for (var w = -1; w <= 1; w += 2) for (var q = -.3; q <= .31; q += .3) b.cyl(w * .22, .12, q, .1, .1, .06, 7, dark, 0, ZX);
    if (k === 'steam') { b.cyl(0, .42, .1, .2, .2, .62, 8, C(0x2f5d3a), 0, [[1, 0, 0], [0, 0, 1], [0, -1, 0]]); b.cyl(0, .42, .42, .21, .21, .06, 8, C(0xd9a63a), 0, [[1, 0, 0], [0, 0, 1], [0, -1, 0]]); b.box(0, .45, -.33, .5, .5, .34, C(0xb3372b)); b.box(0, .72, -.33, .54, .05, .38, dark); b.cyl(0, .76, .35, .06, .08, .28, 6, dark); b.cyl(0, .66, .0, .09, .1, .1, 6, C(0xd9a63a)); b.box(0, .5, -.16, .4, .18, .03, glass); b.box(0, .2, .52, .44, .16, .1, C(0xb3372b), [[1, 0, 0], [0, .8, .6], [0, -.6, .8]]); }
    else if (k === 'diesel') { b.box(0, .42, -.1, .5, .46, .8, col); b.box(0, .34, .5, .48, .3, .4, col); b.box(0, .68, -.1, .52, .06, .84, dark); b.box(0, .52, .32, .42, .18, .03, glass); b.box(-.26, .45, -.1, .02, .2, .5, C(0xf0e6c0)); b.box(.26, .45, -.1, .02, .2, .5, C(0xf0e6c0)); }
    else { b.box(0, .42, 0, .5, .44, 1.04, col); b.box(0, .66, 0, .5, .05, 1.0, C(0xe8eef2)); b.box(0, .5, .53, .4, .22, .02, glass); b.box(0, .78, -.2, .04, .2, .3, dark); b.box(0, .9, -.2, .3, .02, .06, dark); b.box(-.26, .4, 0, .02, .1, .9, C(0xf0f0f0)); b.box(.26, .4, 0, .02, .1, .9, C(0xf0f0f0)); }
    return b.geo();
  });
}
function wagonGeo() { var b = new GB(), dark = C(0x2b2d33), ZX = [[0, 0, -1], [0, 1, 0], [1, 0, 0]]; b.box(0, .14, 0, .46, .1, .9, dark); for (var w = -1; w <= 1; w += 2) for (var q = -.3; q <= .31; q += .6) b.cyl(w * .2, .12, q, .09, .09, .06, 7, dark, 0, ZX); b.box(0, .4, 0, .46, .36, .86, C(0xffffff)); b.box(0, .59, 0, .4, .04, .8, C(0xcccccc)); return b.geo(); }
function buildTrainMeshes() {
  for (var k in TT) locos[k] = inst('loco' + k, locoGeo.bind(null, k), TR_MAX, true);
  wagons = inst('wagon', wagonGeo, TR_MAX * CAR_MAX, true);
  heads = new T.InstancedMesh(g.geo('head', function () { return new T.IcosahedronGeometry(.06, 0); }), new T.MeshBasicMaterial({ color: 0xfff4c0 }), TR_MAX); heads.count = 0; heads.frustumCulled = false; scene.add(heads);
}
function carsOf(type) { return TT[type].cars + (S.tier >= 3 ? 1 : 0) + (S.tier >= 5 ? 1 : 0); }
function capOf(type) { return TT[type].cap + (S.tier >= 3 ? 12 : 0) + (S.tier >= 5 ? 12 : 0); }
function newTrain(type, route) {
  var tr = { id: S.nextId++, type: type, route: route, color: PAL[S.nextId % PAL.length], cargo: [], earned: 0, at: route[0], to: null, ri: 0, dir: 1, state: 'wait', wt: .5, s: 0, L: 0, pts: null, cells: null, rev: false, lineVer: -1 };
  TR.push(tr); routeLine(tr); return tr;
}
function buyTrain(type, route) {
  var pr = TT[type].price; if (S.tier < TT[type].tier) { g.toast('Откроется на ступени ' + TT[type].tier, 'bad'); return null; }
  if (route.length < 2) { g.toast('Нужно хотя бы 2 станции', 'bad'); return null; }
  for (var i = 1; i < route.length; i++) if (!railPath(route[i - 1].c, route[i].c)) { g.toast('Станции ' + route[i - 1].n + ' и ' + route[i].n + ' не соединены рельсами', 'bad'); g.sfx('bad'); return null; }
  if (TR.length >= TR_MAX) { g.toast('Слишком много поездов', 'bad'); return null; }
  if (S.money < pr) { g.toast('Нужно ' + g.fmt(pr), 'bad'); g.sfx('bad'); return null; }
  S.money -= pr; var tr = newTrain(type, route.slice()); g.sfx('up'); g.toast(TT[type].n + ' вышел на маршрут', 'good'); checkGoals(); hudDirty = true; return tr;
}
function sellTrain(tr) { var i = TR.indexOf(tr); if (i < 0) return; TR.splice(i, 1); S.money += Math.round(TT[tr.type].price * .5); if (tr.line) { scene.remove(tr.line); tr.line.geometry.dispose(); } g.sfx('remove'); hudDirty = true; }
function nextStop(tr) { // следующая станция по маршруту (кольцо для 3+, туда-обратно для 2)
  var r = tr.route, i = r.indexOf(tr.at); if (i < 0) i = 0;
  if (r.length === 2) return r[(i + 1) % 2];
  return r[(i + 1) % r.length];
}
function setPath(tr, cells) {
  var old = tr.cells, pts = [], tail = [], i, ncar = carsOf(tr.type);
  var reversal = old && old.length >= 2 && cells.length >= 2 && cells[1] === old[old.length - 2];
  if (old && !reversal) { for (i = Math.max(0, old.length - 9); i < old.length - 1; i++) tail.push(old[i]); }
  if (reversal) tr.rev = !tr.rev;
  var all = tail.concat(cells), cum = [0];
  for (i = 0; i < all.length; i++) pts.push(cx(all[i]), railY(all[i]) + .1, cz(all[i]));
  for (i = 1; i < all.length; i++) { var dx = pts[i * 3] - pts[i * 3 - 3], dy = pts[i * 3 + 1] - pts[i * 3 - 2], dz = pts[i * 3 + 2] - pts[i * 3 - 1]; cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz)); }
  tr.pts = pts; tr.cum = cum; tr.L = cum[cum.length - 1]; tr.cells = cells; tr.s = Math.min(tr.L, tail.length ? cum[tail.length] : (ncar - 1) * GAP);
}
function depart(tr) {
  if (tr.route.length < 2) { tr.state = 'idle'; return; }
  var to = nextStop(tr), p = railPath(tr.at.c, to.c);
  if (!p) { tr.state = 'find'; tr.wt = 2; return; }
  tr.to = to; setPath(tr, p); tr.state = 'move'; if (sel === tr) g.tone(520, .25, 'triangle', .06, 1.3);
}
function arrive(tr) {
  var st = tr.to; tr.at = st; tr.to = null; tr.state = 'wait'; tr.wt = 1.5;
  var earned = 0, i, k;
  for (i = tr.cargo.length - 1; i >= 0; i--) { // выгрузка
    var c = tr.cargo[i]; if (!st.acc[c.t]) continue;
    var d = Math.max(2, dist(c.from.c, st.c)), mult = 1;
    if (S.ev && S.t < S.ev.until) { if (S.ev.type === 'fair' && st.serves.indexOf(PLACES[S.ev.p]) >= 0) mult *= 2; if (S.ev.type === 'urgent' && S.ev.st === c.from && S.ev.cargo === c.t) mult *= 3; }
    var inc = c.a * d * CI[c.t].p * mult; earned += inc; S.stats.deliv += c.a;
    for (k = 0; k < st.serves.length; k++) { var p = st.serves[k], acc = placeAcc(p); if (!acc[c.t]) continue; p.last[c.t] = S.t; if (p.kind === 'city') p.grow += c.a * (c.t === 'goods' ? 1 : c.t === 'mail' ? .8 : c.t === 'grain' ? .7 : .5) * (S.powered ? 1.5 : 1); else if (p.kind === 'fact') p.buf += c.a; else if (p.kind === 'power') p.buf += c.a; if (p.kind === 'port') earned += inc * .3; break; }
    tr.cargo.splice(i, 1);
  }
  if (earned > 0) { earned = Math.round(earned); S.money += earned; S.earned += earned; tr.earned += earned; incAcc += earned; g.float('+' + g.fmt(earned), cx(st.c), railY(st.c) + 1.4, cz(st.c)); if (S.t - lastCoin > .4) { g.sfx('coin'); lastCoin = S.t; } }
  // погрузка: берём то, что примет какая-то другая станция маршрута
  var cap = capOf(tr.type), have = 0; for (i = 0; i < tr.cargo.length; i++) have += tr.cargo[i].a;
  var types = CARGO.slice().sort(function (a, b) { return CI[b].p - CI[a].p; });
  for (i = 0; i < types.length && have < cap; i++) {
    var t = types[i], amt = Math.floor(st.stock[t]); if (amt < 1) continue; var ok = false;
    for (k = 0; k < tr.route.length; k++) if (tr.route[k] !== st && tr.route[k].acc[t]) { ok = true; break; }
    if (!ok) continue; var take = Math.min(amt, cap - have); st.stock[t] -= take; have += take; tr.cargo.push({ t: t, a: take, from: st }); tr.wt += .1;
  }
  for (k = 0; k < st.serves.length; k++) updateLabel(st.serves[k]);
  queueDirty = true; if (sel === tr || sel === st) panelDirty = true;
}
function routeLine(tr) { // цветная линия маршрута (как в метро)
  var cells = [], i, r = tr.route;
  for (i = 1; i < r.length; i++) { var p = railPath(r[i - 1].c, r[i].c); if (p) cells = cells.concat(i > 1 ? p.slice(1) : p); }
  if (r.length > 2) { var p2 = railPath(r[r.length - 1].c, r[0].c); if (p2) cells = cells.concat(p2.slice(1)); }
  var arr = new Float32Array(Math.max(2, cells.length) * 3);
  for (i = 0; i < cells.length; i++) { arr[i * 3] = cx(cells[i]); arr[i * 3 + 1] = railY(cells[i]) + .2; arr[i * 3 + 2] = cz(cells[i]); }
  if (!tr.line) { var geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(arr, 3)); tr.line = new T.Line(geo, new T.LineBasicMaterial({ color: tr.color, transparent: true, opacity: .75 })); scene.add(tr.line); }
  else { tr.line.geometry.dispose(); var geo2 = new T.BufferGeometry(); geo2.setAttribute('position', new T.BufferAttribute(arr, 3)); tr.line.geometry = geo2; }
  tr.line.geometry.setDrawRange(0, cells.length); tr.lineVer = netVer;
}
function posAt(tr, s, out) { // точка на пути на расстоянии s → out [x,y,z,dirx,diry,dirz]
  var cum = tr.cum, pts = tr.pts, n = cum.length; if (s <= 0) s = 0; if (s >= tr.L) s = tr.L;
  var i = 1; while (i < n - 1 && cum[i] < s) i++;
  var a = i - 1, seg = cum[i] - cum[a], t = seg > 0 ? (s - cum[a]) / seg : 0;
  var dx = pts[i * 3] - pts[a * 3], dy = pts[i * 3 + 1] - pts[a * 3 + 1], dz = pts[i * 3 + 2] - pts[a * 3 + 2];
  out[0] = pts[a * 3] + dx * t; out[1] = pts[a * 3 + 1] + dy * t; out[2] = pts[a * 3 + 2] + dz * t; out[3] = dx; out[4] = dy; out[5] = dz;
}
var P0 = [0, 0, 0, 0, 0, 0], P1 = [0, 0, 0, 0, 0, 0];
function drawTrains(t) {
  var cnt = { steam: 0, diesel: 0, electric: 0 }, wn = 0, hn = 0, i, k, night = g.dayLight < .4;
  for (i = 0; i < TR.length; i++) {
    var tr = TR[i]; if (!tr.pts) continue; var ncar = carsOf(tr.type);
    for (k = 0; k < ncar; k++) { // k — позиция от головы; паровоз спереди (или сзади при реверсе)
      var s = tr.s - k * GAP, isLoco = tr.rev ? k === ncar - 1 : k === 0;
      posAt(tr, s - .3, P0); posAt(tr, s + .3, P1);
      dummy.position.set((P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2 + Math.sin(t * 9 + i * 1.7 + k) * .012, (P0[2] + P1[2]) / 2);
      var fwd = isLoco && tr.rev ? -1 : 1;
      tmpV.set(dummy.position.x + (P1[0] - P0[0]) * fwd, dummy.position.y + (P1[1] - P0[1]) * fwd, dummy.position.z + (P1[2] - P0[2]) * fwd);
      if (tmpV.distanceToSquared(dummy.position) < 1e-6) tmpV.z += fwd;
      dummy.lookAt(tmpV); dummy.rotateZ(Math.sin(t * 7 + i + k * 2) * .015); dummy.scale.setScalar(1); dummy.updateMatrix();
      if (isLoco) {
        var lm = locos[tr.type], idx = cnt[tr.type]++; lm.setMatrixAt(idx, dummy.matrix);
        if (night && hn < TR_MAX) { tmpV2.set(0, .45, .52).applyMatrix4(dummy.matrix); heads.setMatrixAt(hn++, dummy.matrix.clone().setPosition(tmpV2)); }
        if (tr.type === 'steam' && tr.state === 'move' && Math.random() < .25) { tmpV2.set(0, .9, .35).applyMatrix4(dummy.matrix); puff(tmpV2.x, tmpV2.y, tmpV2.z, .12); }
      } else {
        var wi = tr.rev ? k : k - 1, cg = tr.cargo[wi]; wagons.setMatrixAt(wn, dummy.matrix); tmpC.setHex(cg ? CI[cg.t].c : 0xb8b2a8); wagons.setColorAt(wn, tmpC); wn++;
      }
    }
  }
  for (k in locos) { locos[k].count = cnt[k]; locos[k].instanceMatrix.needsUpdate = true; }
  wagons.count = wn; wagons.instanceMatrix.needsUpdate = true; if (wagons.instanceColor) wagons.instanceColor.needsUpdate = true;
  heads.count = hn; heads.instanceMatrix.needsUpdate = true; heads.visible = night;
}
function updTrains(dt) {
  for (var i = 0; i < TR.length; i++) {
    var tr = TR[i];
    if (tr.lineVer !== netVer) routeLine(tr);
    if (tr.state === 'idle') continue;
    if (tr.state === 'wait' || tr.state === 'find') { tr.wt -= dt; if (tr.wt <= 0) depart(tr); continue; }
    tr.s += TT[tr.type].sp * dt; if (tr.s >= tr.L) { tr.s = tr.L; arrive(tr); }
  }
}

/* ---------- дым ---------- */
var SM = [], SM_N = 160, smI = 0;
function buildSmoke() { smoke = new T.InstancedMesh(g.geo('puff', function () { return new T.IcosahedronGeometry(.14, 0); }), new T.MeshStandardMaterial({ color: 0xe8e8ee, transparent: true, opacity: .55, flatShading: true }), SM_N); smoke.count = SM_N; smoke.frustumCulled = false; scene.add(smoke); for (var i = 0; i < SM_N; i++) SM.push({ x: 0, y: -9, z: 0, vx: 0, vy: 0, vz: 0, life: 0, sc: 1 }); }
function puff(x, y, z, sc) { var p = SM[smI = (smI + 1) % SM_N]; p.x = x; p.y = y; p.z = z; p.vx = (Math.random() - .5) * .25; p.vy = .5 + Math.random() * .3; p.vz = (Math.random() - .5) * .25; p.life = 1; p.sc = sc || 1; }
function updSmoke(dt) {
  for (var i = 0; i < SM_N; i++) {
    var p = SM[i]; if (p.life <= 0) { dummy.scale.setScalar(0); dummy.position.set(0, -9, 0); } else { p.life -= dt * .5; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; dummy.position.set(p.x, p.y, p.z); dummy.scale.setScalar(p.sc * (1.6 - p.life) * .9); }
    dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); smoke.setMatrixAt(i, dummy.matrix);
  }
  smoke.instanceMatrix.needsUpdate = true;
}

/* ---------- экономика (тик раз в игровую секунду) ---------- */
var incAcc = 0, incT = 0, lastCoin = -9, queueDirty = true, hudDirty = true, panelDirty = false;
function tick() {
  S.t++; var i, k;
  S.powered = false;
  for (i = 0; i < INDS.length; i++) { var d = INDS[i]; if (d.kind === 'power' && d.buf > 0) { d.buf = Math.max(0, d.buf - .25); S.powered = true; } }
  for (i = 0; i < PLACES.length; i++) {
    var p = PLACES[i], st = p.st; if (!st) continue; var pr = placeProd(p), cap = ST_CAP[st.lvl] * 2;
    if (p.kind === 'fact' && p.buf > 0) { var use = Math.min(p.buf, .6); p.buf -= use; st.stock.goods += use * .8; }
    for (k in pr) { if (stLoad(st) < cap) st.stock[k] += pr[k]; }
    if (p.kind === 'city') { var need = 60 * Math.pow(p.lvl, 1.6); if (p.grow >= need && p.lvl < 6) { p.grow -= need; p.lvl++; rebuildHouses(); updateServing(); g.sfx('up'); g.toast(p.n + ' вырос до уровня ' + p.lvl + '!', 'gold'); g.float('★', p.x, HC[p.c] + 2, p.z, '#fff'); } }
  }
  if (S.t % 2 === 0) queueDirty = true;
  if (S.t % 20 === 0) for (i = 0; i < PLACES.length; i++) updateLabel(PLACES[i]);
  // доход в минуту (скользящее)
  incT++; if (incT >= 5) { S.rate = Math.round((S.rate || 0) * .5 + incAcc * 12 * .5); incAcc = 0; incT = 0; }
  // дым заводов
  for (i = 0; i < INDS.length; i++) { var q = INDS[i]; if ((q.kind === 'fact' || q.kind === 'power') && q.served) puff(q.x + (q.kind === 'fact' ? -.5 : -.7), HC[q.c] + 1.95, q.z + (q.kind === 'fact' ? -.3 : .2), .9); }
  checkTier(); checkGoals(); events(); hudDirty = true;
}
function checkTier() {
  while (S.tier < TIERS.length - 1 && S.earned >= TIERS[S.tier + 1].at) {
    S.tier++; var t = TIERS[S.tier]; S.money += t.b || 0; g.sfx('up');
    if (S.tier === TIERS.length - 1) { win(); } else g.modal('<h2>⭐ Ступень ' + S.tier + '</h2><p><b>' + t.n + '</b></p><p>Бонус: +' + g.fmt(t.b) + ' 💰</p><div class="btns"><button class="btn" data-close>Отлично</button></div>');
    buildDock();
  }
}
var GOALS = [
  { t: 'Поставь станцию рядом с городом', f: function () { var n = 0; for (var i = 0; i < CITIES.length; i++) if (CITIES[i].st) n++; return [Math.min(n, 1), 1]; }, b: 300, h: 'Нажми «Станция» внизу, потом на клетку рядом с городом' },
  { t: 'Поставь вторую станцию у другого города', f: function () { var n = 0; for (var i = 0; i < CITIES.length; i++) if (CITIES[i].st) n++; return [Math.min(n, 2), 2]; }, b: 300, h: 'Ещё одна станция — у соседнего города' },
  { t: 'Соедини две станции путём', f: function () { return [S.connected >= 2 ? 1 : 0, 1]; }, b: 500, h: 'Нажми «Путь», затем на первую станцию и на вторую' },
  { t: 'Купи паровоз и запусти маршрут', f: function () { return [Math.min(TR.length, 1), 1]; }, b: 500, h: 'Нажми «Поезд», выбери станции маршрута и запусти' },
  { t: 'Соедини 3 города', f: function () { return [Math.min(S.connected, 3), 3]; }, b: 1000, h: 'Станция у третьего города + путь к сети' },
  { t: 'Заработай 20 тыс', f: function () { return [Math.min(S.earned, 20000), 20000]; }, b: 2000, h: 'Больше поездов и грузов: шахта → завод → город' },
  { t: 'Соедини 5 городов', f: function () { return [Math.min(S.connected, 5), 5]; }, b: 3000, h: '' },
  { t: 'Заработай 150 тыс', f: function () { return [Math.min(S.earned, 150000), 150000]; }, b: 8000, h: 'Улучшай станции, пускай тепловозы' },
  { t: 'Соедини все города', f: function () { return [S.connected, CITIES.length]; }, b: 15000, h: '' },
  { t: 'Заработай 1 млн', f: function () { return [Math.min(S.earned, 1e6), 1e6]; }, b: 0, h: '' },
  { t: 'Свободная игра — расти дальше', f: function () { return [S.earned, S.earned]; }, b: 0, h: '' }
];
function checkGoals() {
  if (!S) return;
  var was = S.goal;
  while (S.goal < GOALS.length - 1) { var gl = GOALS[S.goal], v = gl.f(); if (v[0] < v[1]) break; S.goal++; S.money += gl.b; g.toast('Цель выполнена: ' + gl.t + (gl.b ? ' · +' + g.fmt(gl.b) : ''), 'gold'); g.sfx('up'); }
  if (was !== S.goal && !mode) hint(defaultHint());
  hudDirty = true;
}
function events() {
  if (S.ev && S.t >= S.ev.until) { S.ev = null; hudDirty = true; }
  if (S.ev || TR.length < 1) return;
  S.evT -= 1; if (S.evT > 0) return; S.evT = 70 + Math.floor(Math.random() * 60);
  var r = Math.random(), i;
  if (r < .3) { var ct = CITIES[Math.floor(Math.random() * CITIES.length)]; S.ev = { type: 'fair', p: ct.id, until: S.t + 90, txt: 'Ярмарка в ' + ct.n + ': доставки туда ×2' }; }
  else if (r < .6) { var cands = []; for (i = 0; i < ST.length; i++) for (var k = 0; k < CARGO.length; k++) if (ST[i].stock[CARGO[k]] >= 10) cands.push([i, CARGO[k]]); if (!cands.length) { S.evT = 10; return; } var c = cands[Math.floor(Math.random() * cands.length)]; S.ev = { type: 'urgent', st: ST[c[0]], cargo: c[1], until: S.t + 120, txt: 'Срочный груз: ' + CI[c[1]].n.toLowerCase() + ' со станции «' + ST[c[0]].n + '» ×3' }; }
  else if (r < .85) { var ct2 = CITIES[Math.floor(Math.random() * CITIES.length)]; S.ev = { type: 'holiday', p: ct2.id, until: S.t + 60, txt: 'Праздник в ' + ct2.n + ': пассажиров ×3' }; }
  else { var bonus = 500 + Math.round(S.earned * .02); S.money += bonus; g.toast('Субсидия от губернии: +' + g.fmt(bonus), 'gold'); g.sfx('coin'); return; }
  g.toast('Событие: ' + S.ev.txt, 'gold'); g.tone(660, .2, 'triangle', .08); hudDirty = true;
}
function win() { S.won = true; g.modal('<h2>🏆 Империя построена!</h2><p>Ты заработал <b>1 млн</b> и соединил страну рельсами. Можно играть дальше: растить города, пускать электрички и бить рекорды.</p><div class="btns"><button class="btn" data-close>Ехать дальше</button></div>'); }

/* ---------- сохранение ---------- */
function serialize() {
  var i, o = { v: 1, seed: S.seed, money: S.money, earned: S.earned, tier: S.tier, goal: S.goal, t: S.t, day: S.day, evT: S.evT, nextId: S.nextId, won: S.won, help: S.help, stats: S.stats, rate: S.rate,
    cities: CITIES.map(function (c) { return { lvl: c.lvl, grow: c.grow, last: c.last }; }), inds: INDS.map(function (d) { return { buf: d.buf, last: d.last || {} }; }),
    stations: ST.map(function (s) { return { c: s.c, lvl: s.lvl, stock: s.stock }; }), edges: Object.keys(EDGES),
    trains: TR.map(function (t) { return { type: t.type, route: t.route.map(function (s) { return ST.indexOf(s); }), color: t.color, earned: t.earned, at: ST.indexOf(t.at), to: t.to ? ST.indexOf(t.to) : -1, rev: t.rev, s: t.s, state: t.state, cells: t.cells, cargo: t.cargo.map(function (c) { return { t: c.t, a: c.a, from: ST.indexOf(c.from) }; }) }; }),
    ev: S.ev ? { type: S.ev.type, p: S.ev.p, st: S.ev.st ? ST.indexOf(S.ev.st) : -1, cargo: S.ev.cargo, until: S.ev.until, txt: S.ev.txt } : null };
  return o;
}
function newState(seed) { return { v: 1, seed: seed, money: 3000, earned: 0, tier: 0, goal: 0, t: 0, day: .32, evT: 60, nextId: 1, won: false, help: false, stats: { deliv: 0 }, rate: 0, ev: null, connected: 0, powered: false }; }
function restore(o) { // применяет сохранение к миру; бросает исключение при повреждении
  var i, k;
  if (!o || o.v !== 1 || typeof o.seed !== 'number') throw new Error('bad save');
  S = newState(o.seed); S.money = +o.money || 0; S.earned = +o.earned || 0; S.tier = o.tier | 0; S.goal = o.goal | 0; S.t = o.t | 0; S.day = +o.day || .32; S.evT = o.evT | 0; S.nextId = o.nextId | 1; S.won = !!o.won; S.help = !!o.help; S.stats = o.stats || { deliv: 0 }; S.rate = o.rate | 0;
  if (!isFinite(S.money)) S.money = 0;
  genWorld(S.seed);
  for (i = 0; i < CITIES.length && o.cities && i < o.cities.length; i++) { CITIES[i].lvl = Math.max(1, Math.min(6, o.cities[i].lvl | 0)); CITIES[i].grow = +o.cities[i].grow || 0; CITIES[i].last = o.cities[i].last || {}; }
  for (i = 0; i < INDS.length && o.inds && i < o.inds.length; i++) { INDS[i].buf = +o.inds[i].buf || 0; INDS[i].last = o.inds[i].last || {}; }
  for (i = 0; i < (o.stations || []).length; i++) { var s = o.stations[i], st = { c: s.c | 0, lvl: Math.max(1, Math.min(3, s.lvl | 0)), stock: {}, serves: [], acc: {}, n: '' }; for (k = 0; k < CARGO.length; k++) st.stock[CARGO[k]] = Math.max(0, +(s.stock || {})[CARGO[k]] || 0); if (st.c >= 0 && st.c < N * N) { ST.push(st); BLOCK[st.c] = 2; } }
  for (i = 0; i < (o.edges || []).length; i++) { var ab = String(o.edges[i]).split('|'); if (ab.length === 2) addEdge(+ab[0], +ab[1]); }
  for (i = 0; i < (o.trains || []).length; i++) {
    var t = o.trains[i]; if (!TT[t.type]) continue; var route = []; for (k = 0; k < t.route.length; k++) if (ST[t.route[k]]) route.push(ST[t.route[k]]);
    if (route.length < 2) continue;
    var tr = { id: S.nextId++, type: t.type, route: route, color: t.color || PAL[0], cargo: [], earned: +t.earned || 0, at: ST[t.at] || route[0], to: null, state: 'wait', wt: .3, s: 0, L: 0, pts: null, cells: null, rev: !!t.rev, lineVer: -1 };
    for (k = 0; k < (t.cargo || []).length; k++) if (ST[t.cargo[k].from]) tr.cargo.push({ t: t.cargo[k].t, a: +t.cargo[k].a || 0, from: ST[t.cargo[k].from] });
    if (t.state === 'move' && ST[t.to] && t.cells && t.cells.length >= 2) { tr.to = ST[t.to]; var rv = tr.rev; tr.cells = null; setPath(tr, t.cells); tr.rev = rv; tr.s = Math.min(tr.L, +t.s || 0); tr.state = 'move'; }
    TR.push(tr);
  }
  if (o.ev && o.ev.type) S.ev = { type: o.ev.type, p: o.ev.p, st: ST[o.ev.st] || null, cargo: o.ev.cargo, until: o.ev.until | 0, txt: o.ev.txt || '' };
}

/* ---------- ввод и выбор ---------- */
var mode = null, sel = null, trackA = null, routeDraft = [], draftType = 'steam', editTrain = null, hoverCell = -1, lastHover = 0, prevCache = { b: -1, p: null, cost: 0 };
function pickCell(e) { var hit = g.pickObjects(e, [terrain, water]); return hit ? toCell(hit.point.x, hit.point.z) : -1; }
function pickTrain(e) { var hit = g.pickObjects(e, [terrain, water]); if (!hit) return null; var best = null, bd = 1.2; for (var i = 0; i < TR.length; i++) { var tr = TR[i]; if (!tr.pts) continue; posAt(tr, tr.s, P0); var ddx = P0[0] - hit.point.x, ddz = P0[2] - hit.point.z, d = Math.sqrt(ddx * ddx + ddz * ddz); if (d < bd) { bd = d; best = tr; } } return best; }
function placeAtCell(c) { for (var i = 0; i < PLACES.length; i++) { var p = PLACES[i]; if (cheb(p.c, c) <= (p.kind === 'city' ? 1 : 1)) return p; } return HOUSE_CELLS[c] || null; }
g.onTap = function (e, btn) {
  if (btn === 2) { setMode(null); return; }
  var c = pickCell(e); if (c < 0) { select(null); return; }
  if (mode === 'station') { var st = placeStation(c); if (st) { select(st); if (!e.shiftKey) setMode(null); } return; }
  if (mode === 'track') {
    var s2 = stationNear(c), target = s2 ? s2.c : (RAIL[c] ? c : -1);
    if (target < 0) { g.toast('Нажми на станцию или рельсы', 'bad'); return; }
    if (!trackA) { if (!s2) { g.toast('Сначала выбери станцию', 'bad'); return; } trackA = s2; setRing(s2.c); hint('Теперь нажми на вторую станцию (или на рельсы) — путь проложится сам'); return; }
    if (target === trackA.c) return;
    if (buildTrack(trackA.c, target) >= 0) { trackA = s2 || trackA; setRing(trackA.c); hint('Ещё путь от «' + trackA.n + '»? Нажми на следующую станцию. Правая кнопка — выход'); preview.visible = false; }
    return;
  }
  if (mode === 'train') { var s3 = stationNear(c); if (!s3) { g.toast('Нажми на станцию, чтобы добавить её в маршрут', 'bad'); return; } if (routeDraft[routeDraft.length - 1] === s3) return; routeDraft.push(s3); g.sfx('click'); setRing(s3.c); panelTrainNew(); return; }
  if (mode === 'demolish') { var s4 = stationAt(c); if (s4) { removeStation(s4); g.toast('Станция снесена, вернули ' + ST_COST * .5); return; } if (removeRailAt(c)) { g.toast('Рельсы убраны'); return; } g.toast('Тут нечего сносить'); return; }
  var tr = pickTrain(e); if (tr) { select(tr); return; }
  var s5 = stationNear(c); if (s5) { select(s5); return; }
  var p = placeAtCell(c); if (p) { select(p); return; }
  select(null);
};
g.onHover = function (e) {
  var now = performance.now(); if (now - lastHover < 60) return; lastHover = now;
  var c = pickCell(e), tip = g.$('tip'); hoverCell = c;
  if (c < 0) { tip.style.display = 'none'; return; }
  var txt = '';
  if (mode === 'track' && trackA) {
    var s2 = stationNear(c), target = s2 ? s2.c : (RAIL[c] ? c : -1);
    if (target >= 0 && target !== trackA.c) {
      if (prevCache.b !== target) { prevCache.b = target; prevCache.p = astar(trackA.c, target); prevCache.cost = prevCache.p ? pathMoney(prevCache.p) : 0; showPreview(prevCache.p); }
      txt = prevCache.p ? 'Путь: ' + (prevCache.p.length - 1) + ' клеток · ' + g.fmt(prevCache.cost) + ' 💰' : 'Путь не проложить';
    } else { preview.visible = false; prevCache.b = -1; }
  }
  if (!txt) { var s3 = stationNear(c); if (s3) txt = '🚉 Станция «' + s3.n + '»'; else { var p = placeAtCell(c); if (p) txt = p.kind === 'city' ? '🏙 ' + p.n + ' · уровень ' + p.lvl : IND[p.kind].e + ' ' + p.n; else if (RAIL[c]) txt = '🛤 Рельсы'; else if (CELL[c] === 2) txt = '⛰ Горы — не проехать'; else if (CELL[c] === 1) txt = '🌊 Вода — нужен мост'; } }
  if (txt) { tip.textContent = txt; tip.style.display = 'block'; tip.style.left = Math.min(innerWidth - 220, e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 16) + 'px'; } else tip.style.display = 'none';
};
function showPreview(p) { if (!p) { preview.visible = false; return; } var n = Math.min(p.length, 400); for (var i = 0; i < n; i++) { prevPos.setXYZ(i, cx(p[i]), railY(p[i]) + .35, cz(p[i])); } prevPos.needsUpdate = true; preview.geometry.setDrawRange(0, n); preview.visible = true; }
function setRing(c) { if (c < 0) { ring.visible = false; return; } ring.position.set(cx(c), railY(c) + .05, cz(c)); ring.visible = true; }
function select(o) { sel = o; if (!o) { g.$('panel').classList.remove('on'); setRing(-1); return; } if (o.c !== undefined && !o.route) setRing(o.c); else setRing(-1); renderPanel(); }
function setMode(m) {
  if (mode === m) m = null; mode = m; trackA = null; routeDraft = []; editTrain = null; preview.visible = false; prevCache.b = -1; setRing(-1);
  var bs = g.$('dockIn').children; for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].dataset.m === m);
  g.$('panel').classList.remove('on'); sel = null;
  if (m === 'station') hint('Нажми на клетку рядом с городом или производством (радиус 3 клетки). Shift — несколько подряд');
  else if (m === 'track') hint('Нажми на первую станцию');
  else if (m === 'train') { hint('Нажимай на станции маршрута по порядку, потом «Запустить»'); panelTrainNew(); }
  else if (m === 'demolish') hint('Нажми на станцию или рельсы, чтобы убрать (часть денег вернётся)');
  else hint(defaultHint());
}
function defaultHint() { return GOALS[S.goal].h || 'Нажми на город, станцию или поезд, чтобы узнать подробности'; }
g.onKey = function (k) { if (k === 'escape') setMode(null); else if (k === '1') setMode('station'); else if (k === '2') setMode('track'); else if (k === '3') setMode('train'); else if (k === '4') setMode('demolish'); };

/* ---------- HUD ---------- */
function hint(t) { g.$('hint').textContent = t || ''; }
function hex6(n) { var s = n.toString(16); while (s.length < 6) s = '0' + s; return '#' + s; }
function buildDock() {
  var d = g.$('dockIn'), items = [['station', '🚉', 'Станция', ST_COST], ['track', '🛤️', 'Путь', 0], ['train', '🚂', 'Поезд', 0], ['demolish', '🧨', 'Снести', 0]], html = '';
  for (var i = 0; i < items.length; i++) html += '<button class="bi' + (mode === items[i][0] ? ' on' : '') + '" data-m="' + items[i][0] + '"><span class="k">' + (i + 1) + '</span><span class="e">' + items[i][1] + '</span>' + items[i][2] + (items[i][3] ? '<span class="p">' + items[i][3] + '</span>' : '<span class="p">&nbsp;</span>') + '</button>';
  d.innerHTML = html;
  for (i = 0; i < d.children.length; i++) d.children[i].onclick = function () { g.sfx('click'); setMode(this.dataset.m); };
}
function renderRes() {
  var tn = TIERS[S.tier + 1], html = '<span class="rc"><span class="ic">💰</span><b>' + g.fmt(S.money) + '</b></span>' +
    '<span class="rc' + (S.rate > 0 ? ' good' : '') + '"><span class="ic">📈</span><b>' + g.fmt(S.rate || 0) + '</b><small>/мин</small></span>' +
    '<span class="rc"><span class="ic">🏙</span><b>' + S.connected + '/' + CITIES.length + '</b></span>' +
    '<span class="rc"><span class="ic">⭐</span><b>' + S.tier + '</b>' + (tn ? '<small>' + g.fmt(S.earned) + ' / ' + g.fmt(tn.at) + '</small>' : '') + '</span>';
  g.$('res').innerHTML = html;
  var gl = GOALS[S.goal], v = gl.f(), pct = v[1] > 0 ? Math.min(100, v[0] / v[1] * 100) : 100;
  var ev = (S.ev && S.t < S.ev.until) ? '<div class="ev">🎉 ' + S.ev.txt + ' · ' + (S.ev.until - S.t) + ' с</div>' : '';
  g.$('goal').innerHTML = '<b>Цель ' + (S.goal + 1) + '</b>' + gl.t + (v[1] > 1 && S.goal < GOALS.length - 1 ? ' <span class="dim">' + g.fmt(v[0]) + ' / ' + g.fmt(v[1]) + '</span>' : '') + '<div class="bar"><i style="width:' + pct + '%"></i></div>' + ev;
  g.$('goal').classList.add('on');
}
function cargoList(obj, isTrain) {
  var h = '', i; if (isTrain) { for (i = 0; i < obj.length; i++) h += '<span class="cg">' + CI[obj[i].t].e + ' ' + obj[i].a + '</span>'; }
  else for (i = 0; i < CARGO.length; i++) { var k = CARGO[i], v = Math.floor(obj[k]); if (v > 0) h += '<span class="cg">' + CI[k].e + ' ' + v + '</span>'; }
  return h || '<span class="dim">пусто</span>';
}
function renderPanel() {
  var p = g.$('panel'), h = '', i, o = sel; if (!o) return;
  if (o.route) { // поезд
    var tt = TT[o.type]; h += '<h3><i class="dot" style="background:' + hex6(o.color) + '"></i> ' + tt.n + ' №' + o.id + '</h3><p>' + (o.state === 'idle' ? 'Стоит: маршрут разорван' : o.state === 'find' ? 'Ищет путь до «' + (nextStop(o) || {}).n + '»' : o.state === 'wait' ? 'На станции «' + o.at.n + '»' : 'Едет к «' + (o.to || {}).n + '»') + '</p>';
    h += '<div class="row"><span>Маршрут</span><span>' + o.route.map(function (s) { return s.n; }).join(' → ') + '</span></div>';
    h += '<div class="row"><span>Скорость / мест</span><span>' + tt.sp + ' · ' + capOf(o.type) + '</span></div><div class="row"><span>Заработал</span><span>' + g.fmt(o.earned) + '</span></div><div class="row"><span>Груз</span><span>' + cargoList(o.cargo, true) + '</span></div>';
    h += '<div class="btns"><button class="btn alt" id="pbRoute">Новый маршрут</button><button class="btn bad" id="pbSell">Продать · ' + Math.round(tt.price * .5) + '</button></div>';
    p.innerHTML = h; p.classList.add('on');
    g.$('pbSell').onclick = function () { sellTrain(o); select(null); };
    g.$('pbRoute').onclick = function () { setMode('train'); editTrain = o; draftType = o.type; panelTrainNew(); };
  } else if (o.stock) { // станция
    var cap = ST_CAP[o.lvl], ld = stLoad(o);
    h += '<h3>🚉 Станция «' + o.n + '»</h3><p>Уровень ' + o.lvl + ' · радиус ' + stRadius(o) + ' кл. · ' + (COMP[o.c] !== undefined ? 'в сети' : 'не подключена') + '</p>';
    h += '<div class="row"><span>Склад</span><span>' + Math.floor(ld) + ' / ' + cap + (ld > cap ? ' <b style="color:var(--bad)">очередь!</b>' : '') + '</span></div><div class="row"><span>Ждут отправки</span><span>' + cargoList(o.stock) + '</span></div>';
    h += '<div class="row"><span>Обслуживает</span><span>' + (o.serves.map(function (q) { return (q.kind === 'city' ? '🏙 ' : IND[q.kind].e + ' ') + q.n; }).join(', ') || '—') + '</span></div>';
    var acc = Object.keys(o.acc).map(function (k) { return CI[k].e; }).join(' ');
    h += '<div class="row"><span>Принимает</span><span>' + (acc || '—') + '</span></div>';
    h += '<div class="btns"><button class="btn" id="pbTrack">Путь отсюда</button><button class="btn" id="pbTrain">Поезд отсюда</button>' + (o.lvl < 3 ? '<button class="btn alt" id="pbUp">Улучшить · ' + ST_UP[o.lvl] + (S.tier < (o.lvl === 1 ? 2 : 5) ? ' (ступень ' + (o.lvl === 1 ? 2 : 5) + ')' : '') + '</button>' : '') + '<button class="btn bad" id="pbDel">Снести</button></div>';
    p.innerHTML = h; p.classList.add('on');
    g.$('pbTrack').onclick = function () { setMode('track'); trackA = o; setRing(o.c); hint('Теперь нажми на вторую станцию — путь проложится сам'); };
    g.$('pbTrain').onclick = function () { setMode('train'); routeDraft = [o]; setRing(o.c); panelTrainNew(); };
    if (g.$('pbUp')) g.$('pbUp').onclick = function () { upgradeStation(o); renderPanel(); };
    g.$('pbDel').onclick = function () { removeStation(o); select(null); };
  } else if (o.kind === 'city') {
    var need = 60 * Math.pow(o.lvl, 1.6), pr = placeProd(o);
    h += '<h3>🏙 ' + o.n + '</h3><p>Город ' + o.lvl + ' уровня · ' + g.fmt(600 * o.lvl * o.lvl + o.grow * 10) + ' жителей</p>';
    h += '<div class="row"><span>Рост</span><span>' + Math.floor(o.grow) + ' / ' + Math.floor(need) + (o.lvl >= 6 ? ' (макс.)' : '') + '</span></div><div class="bar2"><i style="width:' + Math.min(100, o.grow / need * 100) + '%"></i></div>';
    h += '<div class="row"><span>Даёт</span><span>' + CI.pass.e + ' ' + pr.pass.toFixed(2) + '/с · ' + CI.mail.e + ' ' + pr.mail.toFixed(2) + '/с</span></div>';
    var ac = cityAcc(o), needs = []; for (i = 0; i < CARGO.length; i++) if (ac[CARGO[i]]) needs.push(CI[CARGO[i]].e + ' ' + CI[CARGO[i]].n.toLowerCase());
    h += '<div class="row"><span>Хочет</span><span>' + needs.join(', ') + '</span></div><div class="row"><span>Станция</span><span>' + (o.st ? '«' + o.st.n + '»' + (o.conn ? ' · соединён' : ' · нет связи') : '<b style="color:var(--bad)">нет</b>') + '</span></div>';
    h += '<p class="dim">Город растёт, когда ему привозят пассажиров, почту, товары' + (o.lvl >= 2 ? ' и зерно' : '') + '. Чем больше город, тем больше пассажиров.</p>';
    p.innerHTML = h; p.classList.add('on');
  } else { // производство
    var d = IND[o.kind], prod = Object.keys(d.prod).map(function (k) { return CI[k].e + ' ' + CI[k].n.toLowerCase() + ' ' + d.prod[k] + '/с'; }).join(', '), acc2 = Object.keys(d.acc).map(function (k) { return CI[k].e + ' ' + CI[k].n.toLowerCase(); }).join(', ');
    h += '<h3>' + d.e + ' ' + o.n + '</h3><p>' + (o.kind === 'fact' ? 'Делает товары из угля, брёвен и зерна' : o.kind === 'port' ? 'Покупает любое сырьё и товары дороже на 30%, привозит товары' : o.kind === 'power' ? 'Жжёт уголь: пока есть топливо, все города растут в 1,5 раза быстрее' : 'Добывает сырьё — вези на завод или в порт') + '</p>';
    if (prod) h += '<div class="row"><span>Даёт</span><span>' + prod + '</span></div>';
    if (acc2) h += '<div class="row"><span>Принимает</span><span>' + acc2 + '</span></div>';
    if (o.kind === 'fact' || o.kind === 'power') h += '<div class="row"><span>Запас сырья</span><span>' + Math.floor(o.buf) + (o.kind === 'power' ? (o.buf > 0 ? ' · ⚡ работает' : ' · нет угля') : '') + '</span></div>';
    h += '<div class="row"><span>Станция</span><span>' + (o.st ? '«' + o.st.n + '»' : '<b style="color:var(--bad)">нет</b>') + '</span></div>';
    p.innerHTML = h; p.classList.add('on');
  }
}
function panelTrainNew() {
  var p = g.$('panel'), h = '<h3>' + (editTrain ? 'Новый маршрут для №' + editTrain.id : 'Новый поезд') + '</h3><p>Нажимай на станции по порядку (2 и больше). 2 станции — туда-обратно, 3+ — по кругу.</p>';
  if (!editTrain) { h += '<div class="tt">'; for (var k in TT) { var t = TT[k], lock = S.tier < t.tier; h += '<button class="tb' + (draftType === k ? ' on' : '') + (lock ? ' off' : '') + '" data-t="' + k + '"><span class="e">' + t.e + '</span><b>' + t.n + '</b><small>' + (lock ? 'ступень ' + t.tier : 'скорость ' + t.sp + ' · ' + capOf(k) + ' мест · ' + g.fmt(t.price)) + '</small></button>'; } h += '</div>'; }
  h += '<div class="row"><span>Маршрут</span><span>' + (routeDraft.length ? routeDraft.map(function (s) { return s.n; }).join(' → ') : '<span class="dim">нажми на станции</span>') + '</span></div>';
  h += '<div class="btns"><button class="btn" id="pbGo"' + (routeDraft.length < 2 ? ' disabled' : '') + '>' + (editTrain ? 'Назначить' : 'Запустить · ' + g.fmt(TT[draftType].price)) + '</button><button class="btn alt" id="pbClr">Очистить</button><button class="btn alt" id="pbX">Отмена</button></div>';
  p.innerHTML = h; p.classList.add('on');
  var bs = p.querySelectorAll('.tb'); for (var i = 0; i < bs.length; i++) bs[i].onclick = function () { if (S.tier < TT[this.dataset.t].tier) { g.toast('Откроется на ступени ' + TT[this.dataset.t].tier, 'bad'); return; } draftType = this.dataset.t; g.sfx('click'); panelTrainNew(); };
  g.$('pbClr').onclick = function () { routeDraft = []; setRing(-1); panelTrainNew(); };
  g.$('pbX').onclick = function () { setMode(null); };
  g.$('pbGo').onclick = function () {
    if (editTrain) { for (var i = 1; i < routeDraft.length; i++) if (!railPath(routeDraft[i - 1].c, routeDraft[i].c)) { g.toast('Станции не соединены рельсами', 'bad'); return; } editTrain.route = routeDraft.slice(); editTrain.at = routeDraft[0]; editTrain.to = null; editTrain.state = 'wait'; editTrain.wt = .3; editTrain.cells = null; editTrain.pts = null; routeLine(editTrain); var tr0 = editTrain; setMode(null); select(tr0); g.toast('Маршрут назначен', 'good'); return; }
    var tr = buyTrain(draftType, routeDraft); if (tr) { var keep = routeDraft; setMode(null); select(tr); }
  };
}
function showHelp() {
  g.modal('<h2>🚂 Железнодорожная империя</h2><p>Соединяй города рельсами и зарабатывай на перевозках. Спешить некуда — штрафов нет.</p><ul>' +
    '<li><b>Станция</b> — ставь рядом с городом или производством (радиус 3 клетки).</li>' +
    '<li><b>Путь</b> — нажми на одну станцию, потом на другую: рельсы проложатся сами, через реки — мосты.</li>' +
    '<li><b>Поезд</b> — выбери тип, нажми на станции маршрута и запусти. Он сам грузит то, что нужно дальше по маршруту. Доход = объём × расстояние.</li>' +
    '<li>Города растут от пассажиров, почты, товаров и зерна. Шахта, лесопилка и ферма дают сырьё, завод делает из него товары, порт покупает всё, электростанция на угле ускоряет рост.</li>' +
    '<li>Ступени развития открывают новые поезда, станции и вагоны.</li></ul>' +
    '<p>Камера: тащи — вращение, колесо или щипок — зум, два пальца или правая кнопка — сдвиг.</p><div class="btns"><button class="btn" data-close>Поехали!</button></div>', function () { S.help = true; });
}

/* ---------- запуск ---------- */
function init() {
  var saved = g.load(), ok = false;
  if (saved) { try { restore(saved); ok = true; } catch (e) { ok = false; if (window.console) console.warn('Сохранение повреждено, новая игра', e); } }
  if (!ok) { ST = []; TR = []; EDGES = {}; ADJ = {}; RAIL = {}; S = newState(Math.floor(Math.random() * 1e9)); genWorld(S.seed); }
  buildTerrain(); buildTrees(); buildCities(); buildInds(); buildTrainMeshes(); buildSmoke();
  ring = new T.Mesh(new T.TorusGeometry(.75, .07, 6, 24), new T.MeshBasicMaterial({ color: 0xff9b5e })); ring.rotation.x = Math.PI / 2; ring.visible = false; scene.add(ring);
  var pg = new T.BufferGeometry(); prevPos = new T.BufferAttribute(new Float32Array(400 * 3), 3); pg.setAttribute('position', prevPos); pg.setDrawRange(0, 0);
  preview = new T.Line(pg, new T.LineBasicMaterial({ color: 0xff9b5e })); preview.visible = false; preview.frustumCulled = false; scene.add(preview);
  buildRailMesh(); refreshTrees(); updateServing(); buildStations(); rebuildHouses(); updateQueues();
  for (var i = 0; i < TR.length; i++) routeLine(TR[i]);
  buildDock(); g.wireBar(); renderRes(); setMode(null);
  g.$('bHelp').onclick = showHelp;
  var c0 = CITIES[0]; g.cam.tx = g.cam.gtx = c0.x; g.cam.tz = g.cam.gtz = c0.z;
  g.onAutosave = function () { if (!g.noSave && S) g.save(serialize()); };
  g.onDay = function (day) { var night = day < .4; windows.visible = night; lamps.visible = night; };
  g.setDay(S.day);
  if (!S.help) showHelp();
  g.start();
}
var acc = 0, hudT = 0;
g.onUpdate = function (dt, t) {
  if (!S) return;
  acc += dt; var n = 0; while (acc >= 1 && n < 8) { acc -= 1; n++; tick(); }
  S.day += dt / 240; g.setDay(S.day);
  updTrains(dt); updSmoke(dt);
  // вода: лёгкая зыбь
  var wp = waterPos, k; for (k = 0; k < wp.count; k++) { var x = wp.getX(k), z = wp.getZ(k); wp.setY(k, Math.sin(x * .9 + t * 1.4) * .05 + Math.cos(z * .8 + t * 1.1 + x * .3) * .05); } wp.needsUpdate = true;
  if (queueDirty) { queueDirty = false; updateQueues(); }
  hudT += dt; if (hudDirty && hudT > .25) { hudT = 0; hudDirty = false; renderRes(); if (sel && !mode) renderPanel(); }
  if (ring.visible) ring.rotation.z += dt;
};
g.onFrame = function (dt, t) { drawTrains(t); };

/* тестовый доступ: симуляция из консоли/тестов */
window.__game = { g: g, state: function () { return S; }, world: function () { return { cities: CITIES, inds: INDS, stations: ST, trains: TR, cell: CELL, hc: HC }; },
  placeStation: placeStation, buildTrack: buildTrack, buyTrain: buyTrain, upgradeStation: upgradeStation, removeStation: removeStation, removeRailAt: removeRailAt,
  astar: astar, cid: cid, serialize: serialize, tick: tick, genStats: function (seed) { genWorld(seed); var w = 0, m = 0, f = 0; for (var i = 0; i < N * N; i++) { if (CELL[i] === 1) w++; if (CELL[i] === 2) m++; if (FOREST[i]) f++; } return { water: w, mount: m, forest: f, cities: CITIES.length, inds: INDS.map(function (d) { return d.kind; }).join(',') }; }, step: function (sec) { for (var i = 0; i < sec * 10; i++) g.onUpdate(.1, g.time + i * .1); }, setMode: setMode, select: select };
init();
})();
