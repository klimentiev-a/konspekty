/* ===================== Космическая станция =====================
   Игра для Hub на общем движке engine.js. Один файл, ES5.
   Строим модули на орбитальной сетке, добываем руду дронами, торгуем,
   открываем технологии и растём до колонии на 50 человек. */
(function () {
'use strict';
var T = THREE;
var SPACE = 0x070b1a;                      // цвет космоса
var g = G.create({ key: 'station', bg: SPACE, dist: 46, minDist: 14, maxDist: 115, bound: 46 });
window.__g = g;
var scene = g.scene;
scene.fog.near = 90;                       // туман только вдали
g.hemi.color.setHex(0x9ec4ff); g.hemi.groundColor.setHex(0x263a66);
g.sun.shadow.camera.left = -40; g.sun.shadow.camera.right = 40; g.sun.shadow.camera.top = 40; g.sun.shadow.camera.bottom = -40; g.sun.shadow.camera.updateProjectionMatrix();

var CELL = 4.2, R = 11, DAY = 200;          // шаг сетки, полуразмер в клетках, длительность суток (с)
var MAXC = 320;                             // максимум связей-труб

/* ---------- палитра ---------- */
var FOOT = 0x2b3443, HULL = 0xe4eaf1, HULL2 = 0xb3c0cf, DARK = 0x485566, ACC = 0x6fd3ff, GOLD = 0xffd27a,
    PANEL = 0x1d4a9c, GREEN = 0x7ad985, CYAN = 0x9df3ff, ORANGE = 0xffa057, RED = 0xff7366, GLASS = 0xcdeeff, PURPLE = 0xc9a6ff;

/* =============== описание модулей =============== */
var DEF = {
  core:  { n: 'Ядро', e: '🛰️', d: 'Сердце станции: немного энергии, кислорода и еды, плавит руду в металл.', cost: {}, en: 6, o2: .08, food: .08, cap: 2, furnace: .5, nobuild: true },
  solar: { n: 'Солнечная панель', e: '🔆', d: 'Даёт энергию. Без неё модули работают медленнее.', cost: { metal: 20 }, en: 5 },
  hab:   { n: 'Жилой модуль', e: '🏠', d: 'Место для 4 человек. Экипаж прилетает сам, когда есть еда и кислород.', cost: { metal: 30, cr: 40 }, en: -2, cap: 4 },
  hydro: { n: 'Гидропоника', e: '🌱', d: 'Выращивает еду и немного кислорода. Рядом с генератором О₂ — на 25% больше.', cost: { metal: 35 }, en: -2, food: .35, o2: .12 },
  oxy:   { n: 'Генератор О₂', e: '🫧', d: 'Делает кислород из воды.', cost: { metal: 30, cr: 30 }, en: -3, o2: .5, tech: 'oxy' },
  lab:   { n: 'Лаборатория', e: '🔬', d: 'Очки науки открывают технологии. Рядом с жилым модулем — на 25% больше.', cost: { metal: 45, cr: 60 }, en: -3, sci: .1, work: 2 },
  dock:  { n: 'Шлюз-док', e: '🚀', d: 'Сюда прилетают грузовики по контрактам.', cost: { metal: 40, cr: 30 }, en: -1, work: 1, dock: true },
  mine:  { n: 'Шахтёрский док', e: '⛏️', d: 'Отправляет дронов к астероидам за рудой.', cost: { metal: 50 }, en: -3, work: 2, drones: 1 },
  store: { n: 'Склад', e: '📦', d: 'Больше места под еду, кислород, руду и металл (+150).', cost: { metal: 40 }, en: -.5, stor: 150, tech: 'store' },
  shop:  { n: 'Мастерская', e: '🔧', d: 'Быстро переплавляет руду в металл.', cost: { metal: 50, cr: 50 }, en: -4, work: 2, furnace: .8, tech: 'shop' },
  green: { n: 'Оранжерея', e: '🌳', d: 'Много еды и кислорода, красиво. Рядом с ней экипаж прибывает быстрее.', cost: { metal: 60, cr: 80 }, en: -3, work: 1, food: .6, o2: .3, tech: 'green' },
  radar: { n: 'Радар', e: '📡', d: 'Контракты приходят чаще и дороже, дроны летают быстрее.', cost: { metal: 50, cr: 80 }, en: -2, radar: true, tech: 'radar' },
  hotel: { n: 'Купол-отель', e: '🏨', d: 'Туристы платят кредитами. Рядом с оранжереей — на 50% больше.', cost: { metal: 80, cr: 150 }, en: -4, work: 2, food: -.15, cr: 1.2, tech: 'hotel' }
};
var ORDER = ['solar', 'hab', 'hydro', 'oxy', 'lab', 'dock', 'mine', 'store', 'shop', 'green', 'radar', 'hotel'];
var TECH = [
  { id: 'oxy', n: 'Генератор кислорода', c: 12, d: 'Новый модуль: генератор О₂' },
  { id: 'store', n: 'Склад', c: 15, d: 'Новый модуль: склад' },
  { id: 'shop', n: 'Мастерская', c: 25, req: 'store', d: 'Новый модуль: быстрая плавка руды' },
  { id: 'up2', n: 'Улучшения 2 уровня', c: 30, d: 'Модули можно улучшать до 2 уровня' },
  { id: 'green', n: 'Оранжерея', c: 40, req: 'oxy', d: 'Новый модуль: оранжерея' },
  { id: 'radar', n: 'Радар', c: 50, req: 'shop', d: 'Новый модуль: радар' },
  { id: 'sol2', n: 'Яркие панели', c: 60, req: 'up2', d: 'Солнечные панели дают на 50% больше' },
  { id: 'drone2', n: 'Быстрые дроны', c: 70, req: 'radar', d: 'Дроны быстрее и везут больше руды' },
  { id: 'up3', n: 'Улучшения 3 уровня', c: 90, req: 'up2', d: 'Модули можно улучшать до 3 уровня' },
  { id: 'hotel', n: 'Купол-отель', c: 110, req: 'green', d: 'Новый модуль: отель для туристов' }
];
var RES = [['en', '⚡', 'энергия'], ['o2', '🫧', 'кислород'], ['food', '🍏', 'еда'], ['ore', '🪨', 'руда'], ['metal', '🔩', 'металл'], ['cr', '💰', 'кредиты'], ['sci', '🔬', 'наука'], ['crew', '👩‍🚀', 'экипаж']];
var RN = { metal: 'металла', food: 'еды', o2: 'кислорода', ore: 'руды', cr: 'кредитов' };
var RI = { metal: '🔩', food: '🍏', o2: '🫧', ore: '🪨', cr: '💰', sci: '🔬' };
var GOALS = [
  { n: 'Первые шаги', t: 'Станция', d: 'Построй солнечную панель и шахтёрский док', chk: function () { return Math.min(1, cnt('solar')) * .5 + Math.min(1, cnt('mine')) * .5; }, rw: { cr: 100 } },
  { n: 'Станция', t: 'Станция', d: '5 модулей и 4 человека экипажа', chk: function () { return Math.min(S.mods.length / 5, 1) * .5 + Math.min(S.res.crew / 4, 1) * .5; }, rw: { cr: 150, metal: 40 } },
  { n: 'Наука', t: 'Станция', d: 'Открой первую технологию', chk: function () { return techCount() ? 1 : Math.min(S.res.sci / 12, .99); }, rw: { cr: 120 } },
  { n: 'База', t: 'База', d: '10 модулей и 12 человек', chk: function () { return Math.min(S.mods.length / 10, 1) * .5 + Math.min(S.res.crew / 12, 1) * .5; }, rw: { cr: 300, metal: 60 } },
  { n: 'Торговля', t: 'База', d: 'Выполни 3 контракта', chk: function () { return Math.min(S.stats.contracts / 3, 1); }, rw: { metal: 120 } },
  { n: 'Колония', t: 'Колония', d: '20 модулей и 30 человек', chk: function () { return Math.min(S.mods.length / 20, 1) * .5 + Math.min(S.res.crew / 30, 1) * .5; }, rw: { cr: 600 } },
  { n: 'Колония на 50 человек', t: 'Колония', d: 'Собери 50 человек экипажа', chk: function () { return Math.min(S.res.crew / 50, 1); }, rw: { cr: 1500 }, final: true },
  { n: 'Большая колония', t: 'Колония', d: '100 человек экипажа', chk: function () { return Math.min(S.res.crew / 100, 1); }, rw: { cr: 4000 } }
];

/* =============== состояние =============== */
var S, grid = {}, eco = { prod: 0, cons: 0, eff: 1, work: 0, workEff: 1, cap: 200, crewCap: 2, tired: false, rates: {} };
var sel = null, tool = null, uid = 1;
function newState() {
  return { v: 1, seed: (Math.random() * 1e9) | 0, time: 0, day: .3, res: { o2: 80, food: 80, ore: 0, metal: 140, cr: 220, sci: 0, crew: 2 },
    mods: [], techs: {}, goal: 0, contracts: [], stats: { built: 0, contracts: 0, ore: 0, events: 0 },
    evT: 80, ctT: 25, crewT: 0, flare: 0, help: 0 };
}
function cnt(t) { var n = 0; for (var i = 0; i < S.mods.length; i++) if (S.mods[i].t === t) n++; return n; }
function techCount() { var n = 0; for (var k in S.techs) if (S.techs[k]) n++; return n; }
function key(x, z) { return x + ',' + z; }
function lvlMul(m) { return m.l; }
function hasTech(id) { return !!S.techs[id]; }
function unlocked(t) { var d = DEF[t]; return !d.nobuild && (!d.tech || hasTech(d.tech)); }
function costOf(t, lvl) { var c = DEF[t].cost, o = {}; for (var k in c) o[k] = Math.round(c[k] * (lvl ? lvl * .8 : 1)); return o; }
function can(c) { for (var k in c) if (S.res[k] < c[k]) return false; return true; }
function pay(c, sign) { for (var k in c) S.res[k] += (sign || -1) * c[k]; }
function costStr(c) { var a = []; for (var k in c) if (c[k]) a.push(c[k] + RI[k]); return a.join(' ') || '—'; }
function spentOf(m) { var s = {}, k, c; for (var l = 0; l < m.l; l++) { c = costOf(m.t, l); for (k in c) s[k] = (s[k] || 0) + c[k]; } return s; }
function neighbors(m) { var a = [], n; n = grid[key(m.x + 1, m.z)]; if (n) a.push(n); n = grid[key(m.x - 1, m.z)]; if (n) a.push(n); n = grid[key(m.x, m.z + 1)]; if (n) a.push(n); n = grid[key(m.x, m.z - 1)]; if (n) a.push(n); return a; }
function adjHas(m, t) { var nb = neighbors(m); for (var i = 0; i < nb.length; i++) if (nb[i].t === t) return true; return false; }
function adjBonus(m) { // бонус соседства
  if (m.t === 'lab' && adjHas(m, 'hab')) return 1.25;
  if (m.t === 'hydro' && adjHas(m, 'oxy')) return 1.25;
  if (m.t === 'hotel' && adjHas(m, 'green')) return 1.5;
  return 1;
}
function modEff(m) { // эффективность модуля 0..1
  var d = DEF[m.t], e = 1;
  if (d.en < 0) e *= eco.eff;
  if (d.work) e *= eco.workEff;
  if (eco.tired && (d.work || d.sci)) e *= .5;
  return e;
}

/* =============== геометрия: слияние примитивов в один меш =============== */
var _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _s = new T.Vector3(1, 1, 1), _p = new T.Vector3();
var L = null; // текущий список частей
function part(geo, c, x, y, z, glow, rx, ry, rz, sx, sy, sz) {
  _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e); _p.set(x || 0, y || 0, z || 0); _s.set(sx || 1, sy || 1, sz || 1); _m.compose(_p, _q, _s);
  L.push({ geo: geo, m: _m.clone(), c: new T.Color(c), glow: glow || 0 });
}
function BX(w, h, d, c, x, y, z, glow, rx, ry, rz) { part(g.geo('b' + w + ',' + h + ',' + d, function () { return new T.BoxGeometry(w, h, d); }), c, x, y, z, glow, rx, ry, rz); }
function CY(rt, rb, h, seg, c, x, y, z, glow, rx, ry, rz) { part(g.geo('cy' + rt + ',' + rb + ',' + h + ',' + seg, function () { return new T.CylinderGeometry(rt, rb, h, seg); }), c, x, y, z, glow, rx, ry, rz); }
function SP(r, det, c, x, y, z, glow, sx, sy, sz) { part(g.geo('sp' + r + ',' + det, function () { return new T.IcosahedronGeometry(r, det); }), c, x, y, z, glow, 0, 0, 0, sx, sy, sz); }
function DM(r, c, x, y, z, glow) { part(g.geo('dm' + r, function () { return new T.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); }), c, x, y, z, glow); }
function TO(r, t, c, x, y, z, glow, rx, ry) { part(g.geo('to' + r + ',' + t, function () { return new T.TorusGeometry(r, t, 6, 18); }), c, x, y, z, glow, rx, ry); }
function mergeParts(parts) {
  var np = 0, i, j, ge;
  for (i = 0; i < parts.length; i++) { ge = parts[i].geo; if (ge.index) ge = ge.toNonIndexed(); parts[i].ng = ge; np += ge.attributes.position.count; }
  var pos = new Float32Array(np * 3), nor = new Float32Array(np * 3), col = new Float32Array(np * 3), glo = new Float32Array(np), o = 0;
  var v = new T.Vector3(), nm = new T.Matrix3();
  for (i = 0; i < parts.length; i++) {
    var p = parts[i], a = p.ng.attributes.position, n = p.ng.attributes.normal, cn = a.count; nm.getNormalMatrix(p.m);
    for (j = 0; j < cn; j++) {
      var k = (o + j) * 3;
      v.fromBufferAttribute(a, j).applyMatrix4(p.m); pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z;
      v.fromBufferAttribute(n, j).applyMatrix3(nm).normalize(); nor[k] = v.x; nor[k + 1] = v.y; nor[k + 2] = v.z;
      col[k] = p.c.r; col[k + 1] = p.c.g; col[k + 2] = p.c.b; glo[o + j] = p.glow;
    }
    o += cn;
  }
  var bg = new T.BufferGeometry();
  bg.setAttribute('position', new T.BufferAttribute(pos, 3)); bg.setAttribute('normal', new T.BufferAttribute(nor, 3));
  bg.setAttribute('color', new T.BufferAttribute(col, 3)); bg.setAttribute('glow', new T.BufferAttribute(glo, 1));
  bg.userData.ownGeo = true; return bg;
}
function build(f) { L = []; f(); var geo = mergeParts(L); L = null; return geo; }

/* материал с вершинными цветами и «ночным свечением» (атрибут glow) */
var nightU = { value: 0 };
function glowMat(o) {
  var m = new T.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .72, metalness: .08 });
  if (o) for (var k in o) m[k] = o[k];
  m.onBeforeCompile = function (sh) {
    sh.uniforms.uNight = nightU;
    sh.vertexShader = 'attribute float glow;\nvarying float vGlow;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    sh.fragmentShader = 'varying float vGlow;\nuniform float uNight;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow * (0.6 + 2.4 * uNight);');
  };
  m.customProgramCacheKey = function () { return 'glow'; };
  return m;
}
var hullMat = glowMat();

/* =============== модели модулей =============== */
function foot() { BX(3.4, .3, 3.4, FOOT, 0, .15, 0); BX(3.1, .12, 3.1, DARK, 0, .36, 0); }
function winRing(r, y, n, c) { for (var k = 0; k < n; k++) { var a = k / n * Math.PI * 2; BX(.34, .26, .12, c || GOLD, Math.cos(a) * r, y, Math.sin(a) * r, 1, 0, Math.PI / 2 - a, 0); } }
var MODEL = {
  core: function () {
    foot(); CY(1.5, 1.7, 2, 8, HULL, 0, 1.4, 0); winRing(1.52, 1.5, 8);
    SP(1.15, 1, HULL2, 0, 3.1, 0); CY(.07, .07, 2.2, 5, DARK, 0, 4.9, 0); SP(.22, 1, ACC, 0, 6.05, 0, 1);
    BX(1.3, .4, .7, HULL2, 1.9, .9, 0); BX(1.3, .4, .7, HULL2, -1.9, .9, 0); BX(.7, .4, 1.3, HULL2, 0, .9, 1.9); BX(.7, .4, 1.3, HULL2, 0, .9, -1.9);
    BX(1.2, .06, .2, ACC, 1.9, 1.12, 0, .8); BX(1.2, .06, .2, ACC, -1.9, 1.12, 0, .8); BX(.2, .06, 1.2, ACC, 0, 1.12, 1.9, .8); BX(.2, .06, 1.2, ACC, 0, 1.12, -1.9, .8);
  },
  solar: function () {
    foot(); CY(.45, .5, 1.1, 8, HULL, 0, .95, 0); CY(.12, .12, 1.4, 5, DARK, 0, 1.6, 0);
    BX(1.45, .08, 3.2, PANEL, -.95, 2.1, 0, .25, 0, 0, .35); BX(1.45, .08, 3.2, PANEL, .95, 2.1, 0, .25, 0, 0, -.35);
    BX(1.5, .04, .08, HULL2, -.95, 2.16, -.8, 0, 0, 0, .35); BX(1.5, .04, .08, HULL2, -.95, 2.16, .8, 0, 0, 0, .35);
    BX(1.5, .04, .08, HULL2, .95, 2.16, -.8, 0, 0, 0, -.35); BX(1.5, .04, .08, HULL2, .95, 2.16, .8, 0, 0, 0, -.35);
    SP(.14, 1, GOLD, 0, 2.4, 0, 1);
  },
  hab: function () {
    foot(); CY(1.05, 1.05, 2.4, 10, HULL, 0, 1.35, 0, 0, Math.PI / 2, 0, 0); CY(1.12, 1.12, .3, 10, HULL2, 0, 1.35, 0, 0, Math.PI / 2, 0, 0);
    for (var k = -1; k <= 1; k++) { BX(.12, .3, .34, GOLD, 1.0, 1.55, k * .7, 1); BX(.12, .3, .34, GOLD, -1.0, 1.55, k * .7, 1); }
    BX(.6, .5, .8, HULL2, 0, 2.5, -.9); SP(.12, 1, RED, 0, 2.85, -.9, 1);
  },
  hydro: function () {
    foot(); BX(2.9, 1.0, 2.9, HULL, 0, .9, 0); BX(2.6, .9, 2.6, GREEN, 0, 1.8, 0, .35); BX(2.75, .12, 2.75, HULL2, 0, 2.3, 0);
    BX(2.5, .08, .4, 0xe4ffd0, 0, 2.38, -.7, .6); BX(2.5, .08, .4, 0xe4ffd0, 0, 2.38, .7, .6);
    CY(.08, .08, .9, 5, DARK, 1.2, 2.7, 1.2); SP(.1, 1, GREEN, 1.2, 3.2, 1.2, 1);
  },
  oxy: function () {
    foot(); BX(2.8, .9, 2.0, HULL, 0, .85, 0); CY(.55, .55, 2.2, 8, CYAN, -.8, 2.3, 0, .3); CY(.55, .55, 2.2, 8, CYAN, .8, 2.3, 0, .3);
    SP(.55, 1, HULL2, -.8, 3.4, 0); SP(.55, 1, HULL2, .8, 3.4, 0); BX(.2, .2, 1.8, DARK, 0, 2.2, 0); BX(.9, .35, .5, HULL2, 0, 1.45, 1.0); BX(.6, .15, .1, CYAN, 0, 1.45, 1.26, 1);
  },
  lab: function () {
    foot(); CY(1.5, 1.6, 1.6, 6, HULL, 0, 1.2, 0); CY(1.1, 1.1, .5, 6, HULL2, 0, 2.25, 0); winRing(1.5, 1.3, 6, GLASS);
    SP(.7, 1, 0xd8f4ff, 0, 2.8, 0, .5); CY(.06, .06, 1.6, 5, DARK, 1.0, 3.2, -1.0); BX(.3, .3, .3, PURPLE, 1.0, 4.05, -1.0, 1);
  },
  dock: function () {
    foot(); BX(2.0, 1.2, 3.0, HULL, -.6, .95, 0); BX(1.2, .14, 3.2, DARK, 1.0, .44, 0); BX(1.0, .05, .2, GOLD, 1.0, .52, -1.2, 1); BX(1.0, .05, .2, GOLD, 1.0, .52, 0, 1); BX(1.0, .05, .2, GOLD, 1.0, .52, 1.2, 1);
    TO(.75, .14, ACC, -.6, 1.7, 1.52, .6, 0, 0); BX(.5, .4, .6, HULL2, -.6, 1.8, -1.3); SP(.12, 1, RED, 1.55, .62, 1.55, 1); SP(.12, 1, GREEN, 1.55, .62, -1.55, 1);
  },
  mine: function () {
    foot(); BX(2.2, 1.1, 1.6, HULL, 0, .9, -.6); BX(2.8, .14, 1.2, DARK, 0, .44, 1.0);
    CY(.12, .12, 2.6, 5, HULL2, -1.0, 1.9, 1.3); BX(2.0, .14, .14, HULL2, -.2, 3.2, 1.3); CY(.05, .05, 1.0, 4, DARK, .8, 2.7, 1.3); BX(.4, .3, .3, ORANGE, .8, 2.1, 1.3, .3);
    BX(.6, .3, .8, 0x6b7a8c, -.6, 1.55, -.6); BX(.6, .3, .8, 0x6b7a8c, .6, 1.55, -.6); BX(.2, .1, .2, GOLD, 1.2, .55, 1.4, 1); BX(.2, .1, .2, GOLD, -1.2, .55, 1.4, 1);
  },
  store: function () {
    foot(); BX(1.3, 1.0, 2.8, 0xff9b5e, -.8, .95, 0); BX(1.3, 1.0, 2.8, 0x5aa9e6, .8, .95, 0); BX(1.3, 1.0, 2.8, 0xffd166, 0, 1.95, 0);
    BX(1.36, .12, .12, DARK, -.8, 1.0, -.9); BX(1.36, .12, .12, DARK, -.8, 1.0, .9); BX(1.36, .12, .12, DARK, .8, 1.0, -.9); BX(1.36, .12, .12, DARK, .8, 1.0, .9); BX(1.36, .12, .12, DARK, 0, 2.0, 0);
    SP(.1, 1, GOLD, 0, 2.6, 1.1, 1);
  },
  shop: function () {
    foot(); BX(2.9, 1.3, 2.4, HULL, 0, 1.0, 0); BX(2.4, .5, 2.0, HULL2, 0, 1.9, 0);
    CY(.3, .35, 1.4, 6, DARK, .9, 2.6, -.6); BX(.8, .6, .1, ORANGE, 0, .9, 1.25, 1); BX(.5, .5, .6, DARK, -1.0, 2.35, .5); SP(.16, 1, ORANGE, -1.0, 2.75, .5, .8);
  },
  green: function () {
    foot(); CY(1.55, 1.65, .5, 10, HULL, 0, .6, 0); DM(1.5, 0xaee6ff, 0, .85, 0, .12);
    CY(0, .5, 1.0, 5, GREEN, -.5, 1.3, -.3); CY(0, .4, .8, 5, 0x5cc06a, .5, 1.2, .4); CY(0, .35, .7, 5, GREEN, .2, 1.15, -.6); CY(.06, .06, .5, 4, 0x8a5a3a, -.5, .95, -.3);
    TO(1.55, .06, HULL2, 0, 1.6, 0, 0, Math.PI / 2); SP(.14, 1, GREEN, 0, 2.45, 0, 1);
  },
  radar: function () {
    foot(); BX(1.8, 1.0, 1.8, HULL, 0, .9, 0); CY(.25, .3, 1.4, 6, HULL2, 0, 2.1, 0); winRing(.92, 1.0, 4, GLASS);
    SP(.12, 1, RED, 1.0, 1.55, 1.0, 1); SP(.12, 1, RED, -1.0, 1.55, -1.0, 1);
  },
  hotel: function () {
    foot(); CY(1.6, 1.7, .6, 12, HULL, 0, .65, 0); DM(1.55, 0xfff1cf, 0, .95, 0, .3); TO(1.6, .07, GOLD, 0, 1.0, 0, .7, Math.PI / 2);
    BX(.7, .9, .7, HULL2, 0, 1.3, 0); BX(.5, .5, .5, GOLD, 0, 2.0, 0, .9); SP(.3, 1, GOLD, 0, 2.55, 0, .9);
    BX(.7, .3, .25, GOLD, 1.3, .5, 1.3, 1); BX(.7, .3, .25, GOLD, -1.3, .5, -1.3, 1);
  }
};

/* =============== сцена: небо, планета, астероиды =============== */
function radialTex(stops, size) {
  size = size || 128; var c = document.createElement('canvas'); c.width = c.height = size; var x = c.getContext('2d');
  var gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (var i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
  x.fillStyle = gr; x.fillRect(0, 0, size, size); return new T.CanvasTexture(c);
}
function nebulaTex(seed, h1, h2) {
  var size = 256, c = document.createElement('canvas'); c.width = c.height = size; var x = c.getContext('2d'), r = g.rng(seed);
  x.globalCompositeOperation = 'lighter';
  for (var i = 0; i < 11; i++) {
    var cx = 128 + (r() - .5) * 150, cy = 128 + (r() - .5) * 150, rad = 25 + r() * 70, h = r() < .5 ? h1 : h2;
    var gr = x.createRadialGradient(cx, cy, 0, cx, cy, rad); gr.addColorStop(0, 'hsla(' + h + ',85%,55%,.2)'); gr.addColorStop(1, 'hsla(' + h + ',75%,60%,0)');
    x.fillStyle = gr; x.fillRect(0, 0, size, size);
  }
  x.globalCompositeOperation = 'destination-in';
  var mk = x.createRadialGradient(128, 128, 0, 128, 128, 128); mk.addColorStop(0, 'rgba(0,0,0,1)'); mk.addColorStop(.55, 'rgba(0,0,0,.7)'); mk.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = mk; x.fillRect(0, 0, size, size); return new T.CanvasTexture(c);
}
var sky = new T.Group(); scene.add(sky);
(function makeStars() {
  var N = 2600, r = g.rng(77), pos = new Float32Array(N * 3), col = new Float32Array(N * 3), c = new T.Color();
  for (var i = 0; i < N; i++) {
    var u = r() * 2 - 1, ph = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), d = 400;
    pos[i * 3] = s * Math.cos(ph) * d; pos[i * 3 + 1] = u * d; pos[i * 3 + 2] = s * Math.sin(ph) * d;
    var b = .35 + r() * .65, t = r(); c.setHSL(t < .15 ? .6 : t < .3 ? .1 : 0, t < .3 ? .5 : 0, b);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  var ge = new T.BufferGeometry(); ge.setAttribute('position', new T.BufferAttribute(pos, 3)); ge.setAttribute('color', new T.BufferAttribute(col, 3));
  var pts = new T.Points(ge, new T.PointsMaterial({ size: 2.1, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: .95, depthWrite: false }));
  pts.frustumCulled = false; sky.add(pts);
  var nb = [[0xb08cff, 380, 320, 40, -200, 1], [0x6fd3ff, 300, -300, -20, 220, 2], [0xff8cc8, 260, 90, -70, 330, 3]];
  for (var k = 0; k < nb.length; k++) {
    var sp = new T.Sprite(new T.SpriteMaterial({ map: nebulaTex(k + 11, k === 1 ? 190 : 275, k === 2 ? 330 : 215), color: nb[k][0], transparent: true, opacity: .7, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
    var sc = nb[k][1]; sp.scale.set(sc, sc, 1); sp.position.set(nb[k][2], nb[k][3], nb[k][4]); sky.add(sp);
  }
})();
var sunSp = new T.Sprite(new T.SpriteMaterial({ map: radialTex([[0, 'rgba(255,255,255,1)'], [.12, 'rgba(255,250,220,1)'], [.3, 'rgba(255,220,150,.45)'], [1, 'rgba(255,200,120,0)']], 256), transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false }));
sunSp.scale.set(90, 90, 1); sky.add(sunSp);

/* планета: фасетчатая, с городами-огоньками (glow) */
var planet = new T.Group(); planet.position.set(-30, -240, -50); planet.rotation.x = 1.15; planet.rotation.z = .3; scene.add(planet);
(function makePlanet() {
  var PR = 150, geo = new T.IcosahedronGeometry(PR, 24), n = g.noise2(4242), pos = geo.attributes.position, cnt = pos.count;
  var col = new Float32Array(cnt * 3), glo = new Float32Array(cnt), c = new T.Color(), v = new T.Vector3(), r = g.rng(99);
  for (var i = 0; i < cnt; i += 3) {
    var cx = 0, cy = 0, cz = 0, j;
    for (j = 0; j < 3; j++) { cx += pos.getX(i + j); cy += pos.getY(i + j); cz += pos.getZ(i + j); }
    v.set(cx, cy, cz).normalize();
    var h = g.fbm(n, v.x * 2.6 + 7, v.y * 2.6 + 7) * .55 + g.fbm(n, v.z * 2.6 + 19, v.y * 2.6 + 3) * .45, lat = Math.abs(v.y), gl = 0;
    if (h < .49) c.setHex(0x123a72); else if (h < .52) c.setHex(0x2467ad); else if (h < .6) c.setHex(0x4f8f4c); else if (h < .68) c.setHex(0x7f8f45); else c.setHex(0x9e9684);
    if (lat > .88) c.lerp(new T.Color(0xdbe8f0), Math.min(1, (lat - .88) * 10));
    if (h >= .52 && h < .68 && lat < .8 && r() < .05) { c.setHex(0xd9bf86); gl = .8; }
    var dr = h >= .5 ? 1 + (h - .5) * .06 : 1;
    for (j = 0; j < 3; j++) { col[(i + j) * 3] = c.r; col[(i + j) * 3 + 1] = c.g; col[(i + j) * 3 + 2] = c.b; glo[i + j] = gl; pos.setXYZ(i + j, pos.getX(i + j) * dr, pos.getY(i + j) * dr, pos.getZ(i + j) * dr); }
  }
  geo.setAttribute('color', new T.BufferAttribute(col, 3)); geo.setAttribute('glow', new T.BufferAttribute(glo, 1));
  var pm = glowMat({ fog: false, roughness: .9 }); var mesh = new T.Mesh(geo, pm); planet.add(mesh);
  var atm = new T.Mesh(new T.IcosahedronGeometry(PR * 1.06, 12), new T.ShaderMaterial({
    uniforms: { col: { value: new T.Color(0x6fb8ff) }, sunDir: { value: new T.Vector3(0, 1, 0) } },
    vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); vP = mv.xyz; gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 col; uniform vec3 sunDir; varying vec3 vN; varying vec3 vP; void main(){ vec3 n = normalize(vN); float f = 1.0 - abs(dot(n, normalize(-vP))); float a = pow(f, 3.2); float l = max(0., dot(n, sunDir)) * .75 + .25; gl_FragColor = vec4(col * a * 1.5 * l, a * l); }',
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.FrontSide
  })); planet.add(atm); planet.userData.atm = atm;
})();

/* астероиды: 3 кластера, вращающиеся вокруг станции */
var ROCKS = 54, rockInst, clusters = [];
(function makeRocks() {
  var geo = new T.IcosahedronGeometry(1, 1), pos = geo.attributes.position, r = g.rng(5), v = new T.Vector3();
  for (var i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); var k = .75 + r() * .5; pos.setXYZ(i, v.x * k, v.y * (k * .8), v.z * k); }
  geo.computeVertexNormals();
  rockInst = new T.InstancedMesh(geo, g.mat(0x8c8275, { fog: false, roughness: .95 }), ROCKS); rockInst.frustumCulled = false; scene.add(rockInst);
  for (var c = 0; c < 3; c++) {
    var cl = { a: c * 2.1 + .4, rad: 58 + c * 9, y: -6 + c * 7, spd: .012 + c * .004, rocks: [] };
    for (var j = 0; j < ROCKS / 3; j++) cl.rocks.push({ ox: (r() - .5) * 16, oy: (r() - .5) * 7, oz: (r() - .5) * 16, s: .5 + r() * 1.6, rx: r() * 6, ry: r() * 6, w: (r() - .5) * .8 });
    clusters.push(cl);
  }
})();
var _v = new T.Vector3(), _v2 = new T.Vector3(), _v3 = new T.Vector3(), dummy = new T.Object3D();
function rockPos(ci, ri, out) { var cl = clusters[ci], rk = cl.rocks[ri]; return out.set(Math.cos(cl.a) * cl.rad + rk.ox, cl.y + rk.oy, Math.sin(cl.a) * cl.rad + rk.oz); }
function updRocks(dt) {
  var i = 0;
  for (var c = 0; c < 3; c++) { var cl = clusters[c]; cl.a += cl.spd * dt;
    for (var j = 0; j < cl.rocks.length; j++) { var rk = cl.rocks[j]; rk.ry += rk.w * dt; rockPos(c, j, dummy.position); dummy.rotation.set(rk.rx, rk.ry, 0); dummy.scale.setScalar(rk.s); dummy.updateMatrix(); rockInst.setMatrixAt(i++, dummy.matrix); } }
  rockInst.instanceMatrix.needsUpdate = true;
}

/* =============== инстансы модулей, труб, потоков =============== */
var inst = {}, MAXM = 160;
for (var tk in MODEL) { var im = new T.InstancedMesh(build(MODEL[tk]), hullMat, MAXM); im.count = 0; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; scene.add(im); inst[tk] = im; }
var lvlInst = new T.InstancedMesh(build(function () { TO(1.95, .07, ACC, 0, 0, 0, .7, Math.PI / 2); }), hullMat, MAXM * 2); lvlInst.count = 0; lvlInst.frustumCulled = false; scene.add(lvlInst);
var wheelInst = new T.InstancedMesh(build(function () { TO(1.45, .1, HULL2, 0, 0, 0); CY(.2, .2, .5, 6, DARK, 0, 0, 0, 0, Math.PI / 2); for (var k = 0; k < 3; k++) BX(.08, 2.9, .08, HULL2, 0, 0, 0, 0, 0, 0, k * Math.PI / 3); BX(.5, .25, .2, GOLD, 0, 1.45, 0, 1); }), hullMat, MAXM); wheelInst.count = 0; wheelInst.frustumCulled = false; scene.add(wheelInst);
var dishInst = new T.InstancedMesh(build(function () { CY(1.1, .15, .45, 10, HULL2, 0, .3, 0, 0, -.6); CY(.05, .05, .9, 4, DARK, 0, .7, .25, 0, -.6); SP(.12, 1, ACC, 0, 1.1, .5, 1); }), hullMat, MAXM); dishInst.count = 0; dishInst.frustumCulled = false; scene.add(dishInst);
var tubeInst = new T.InstancedMesh(g.geo('tube', function () { return new T.CylinderGeometry(.32, .32, 1.3, 7); }), g.mat(0xaebccb, { emissive: 0x6fd3ff, emissiveIntensity: .18, roughness: .6 }), MAXC); tubeInst.count = 0; tubeInst.frustumCulled = false; scene.add(tubeInst);
/* частицы потоков по трубам */
var dotTex = radialTex([[0, 'rgba(255,255,255,1)'], [.35, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']], 64);
var flowGeo = new T.BufferGeometry(), flowPos = new Float32Array(MAXC * 3 * 3), flowCol = new Float32Array(MAXC * 3 * 3);
flowGeo.setAttribute('position', new T.BufferAttribute(flowPos, 3).setUsage(T.DynamicDrawUsage)); flowGeo.setAttribute('color', new T.BufferAttribute(flowCol, 3));
var flow = new T.Points(flowGeo, new T.PointsMaterial({ size: .55, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false })); flow.frustumCulled = false; scene.add(flow);
var conns = [];
var FLOWC = { solar: new T.Color(0xffd27a), hydro: new T.Color(0x7ad985), green: new T.Color(0x7ad985), oxy: new T.Color(0x9df3ff), mine: new T.Color(0xffa057), shop: new T.Color(0xffa057), lab: new T.Color(0xc9a6ff), hotel: new T.Color(0xffd27a) };
var FLOWD = new T.Color(0x8fd0ff);
/* подсветка клеток и выбора */
var cellInst = new T.InstancedMesh(g.geo('cellq', function () { var r = new T.RingGeometry(1.75, 1.95, 4); r.rotateX(-Math.PI / 2); r.rotateY(Math.PI / 4); return r; }), new T.MeshBasicMaterial({ color: ACC, transparent: true, opacity: .45, depthWrite: false }), 200);
cellInst.count = 0; cellInst.frustumCulled = false; scene.add(cellInst);
var hover = new T.Mesh(g.geo('cellf', function () { var p = new T.PlaneGeometry(3.8, 3.8); p.rotateX(-Math.PI / 2); return p; }), new T.MeshBasicMaterial({ color: ACC, transparent: true, opacity: .25, depthWrite: false })); hover.visible = false; hover.position.y = .05; scene.add(hover);
var selRing = new T.Mesh(g.geo('selr', function () { var r = new T.RingGeometry(2.0, 2.25, 32); r.rotateX(-Math.PI / 2); return r; }), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .8, depthWrite: false })); selRing.visible = false; selRing.position.y = .06; scene.add(selRing);
/* дроны и корабли */
var MAXD = 48, droneInst = new T.InstancedMesh(build(function () { BX(.5, .25, .7, HULL, 0, 0, 0); CY(.1, .1, .6, 5, DARK, 0, 0, 0, 0, 0, 0, Math.PI / 2); SP(.12, 1, ORANGE, 0, .18, 0, 1); BX(.25, .12, .25, GOLD, 0, -.16, .2, .6); }), hullMat, MAXD);
droneInst.count = 0; droneInst.frustumCulled = false; scene.add(droneInst);
var MAXS = 6, shipInst = new T.InstancedMesh(build(function () { BX(1.3, .9, 3.4, HULL, 0, 0, 0); BX(1.5, .6, 1.2, HULL2, 0, .55, -.6); BX(.9, .35, .2, GLASS, 0, .55, 1.1, 1); BX(1.1, .9, 1.0, 0xff9b5e, 0, 0, .2); BX(1.1, .9, 1.0, 0x5aa9e6, 0, 0, -.9); CY(.3, .35, .8, 6, DARK, .55, 0, -1.9, 0, Math.PI / 2); CY(.3, .35, .8, 6, DARK, -.55, 0, -1.9, 0, Math.PI / 2); SP(.2, 1, CYAN, .55, 0, -2.3, 1); SP(.2, 1, CYAN, -.55, 0, -2.3, 1); BX(2.4, .08, .5, PANEL, 0, .3, -1.2, .2); }), hullMat, MAXS);
shipInst.count = 0; shipInst.frustumCulled = false; scene.add(shipInst);
var drones = [], ships = [];
/* метеоры: пучок отрезков */
var MET = 40, metGeo = new T.BufferGeometry(), metPos = new Float32Array(MET * 6); metGeo.setAttribute('position', new T.BufferAttribute(metPos, 3).setUsage(T.DynamicDrawUsage));
var meteors = new T.LineSegments(metGeo, new T.LineBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: .9, blending: T.AdditiveBlending, fog: false })); meteors.visible = false; meteors.frustumCulled = false; scene.add(meteors);
var metList = [], metT = 0;

/* =============== сборка инстансов после изменения модулей =============== */
function rebuild() {
  var i, m, k, cntT = {}, nl = 0, nw = 0, nd = 0;
  grid = {};
  for (k in inst) inst[k].count = 0;
  for (i = 0; i < S.mods.length; i++) { m = S.mods[i]; grid[key(m.x, m.z)] = m; m.px = m.x * CELL; m.pz = m.z * CELL; }
  for (i = 0; i < S.mods.length; i++) {
    m = S.mods[i]; var im = inst[m.t]; if (!im) continue;
    dummy.position.set(m.px, 0, m.pz); dummy.rotation.set(0, (m.t === 'hab' || m.t === 'mine' || m.t === 'dock') ? 0 : ((m.x * 3 + m.z * 5) % 4) * Math.PI / 2, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
    im.setMatrixAt(im.count++, dummy.matrix);
    for (k = 1; k < m.l; k++) { dummy.position.set(m.px, .5 + (k - 1) * .22, m.pz); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); lvlInst.setMatrixAt(nl++, dummy.matrix); }
    if (m.t === 'hab') nw++; if (m.t === 'radar') nd++;
  }
  for (k in inst) inst[k].instanceMatrix.needsUpdate = true;
  lvlInst.count = nl; lvlInst.instanceMatrix.needsUpdate = true; wheelInst.count = nw; dishInst.count = nd;
  /* трубы и потоки */
  conns.length = 0;
  for (i = 0; i < S.mods.length; i++) { m = S.mods[i]; var a = grid[key(m.x + 1, m.z)], b = grid[key(m.x, m.z + 1)]; if (a) conns.push({ a: m, b: a }); if (b) conns.push({ a: m, b: b }); }
  if (conns.length > MAXC) conns.length = MAXC;
  for (i = 0; i < conns.length; i++) {
    var c = conns[i], ax = c.a.px, az = c.a.pz, bx = c.b.px, bz = c.b.pz;
    dummy.position.set((ax + bx) / 2, .95, (az + bz) / 2); dummy.rotation.set(ax === bx ? Math.PI / 2 : 0, 0, ax === bx ? 0 : Math.PI / 2); dummy.scale.setScalar(1); dummy.updateMatrix(); tubeInst.setMatrixAt(i, dummy.matrix);
    var da = c.a.x * c.a.x + c.a.z * c.a.z, db = c.b.x * c.b.x + c.b.z * c.b.z; // поток идёт к ядру
    c.from = da > db ? c.a : c.b; c.to = da > db ? c.b : c.a; var col = FLOWC[c.from.t] || FLOWD;
    for (k = 0; k < 3; k++) { var o = (i * 3 + k) * 3; flowCol[o] = col.r; flowCol[o + 1] = col.g; flowCol[o + 2] = col.b; }
  }
  tubeInst.count = conns.length; tubeInst.instanceMatrix.needsUpdate = true; flowGeo.attributes.color.needsUpdate = true; flowGeo.setDrawRange(0, conns.length * 3);
  syncDrones(); updCells(); recalc();
}
function updSpin(t) {
  var nw = 0, nd = 0, i, m;
  for (i = 0; i < S.mods.length; i++) {
    m = S.mods[i];
    if (m.t === 'hab') { dummy.position.set(m.px, 1.35, m.pz + .95); dummy.rotation.set(0, 0, t * .5 + i); dummy.scale.setScalar(1); dummy.updateMatrix(); wheelInst.setMatrixAt(nw++, dummy.matrix); }
    else if (m.t === 'radar') { dummy.position.set(m.px, 2.75, m.pz); dummy.rotation.set(0, t * .8 + i, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); dishInst.setMatrixAt(nd++, dummy.matrix); }
  }
  if (nw) wheelInst.instanceMatrix.needsUpdate = true; if (nd) dishInst.instanceMatrix.needsUpdate = true;
}
var flowT = 0;
function updFlow(dt) {
  flowT += dt * (.25 + .75 * eco.eff) * .5;
  for (var i = 0; i < conns.length; i++) {
    var c = conns[i];
    for (var k = 0; k < 3; k++) { var ph = (flowT + k / 3 + i * .37) % 1, o = (i * 3 + k) * 3; flowPos[o] = c.from.px + (c.to.px - c.from.px) * ph; flowPos[o + 1] = .95 + Math.sin(ph * Math.PI) * .25; flowPos[o + 2] = c.from.pz + (c.to.pz - c.from.pz) * ph; }
  }
  flowGeo.attributes.position.needsUpdate = true;
}
function updCells() { // подсветка доступных клеток в режиме постройки
  var n = 0;
  if (tool) for (var i = 0; i < S.mods.length && n < 200; i++) {
    var m = S.mods[i], d = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var k = 0; k < 4; k++) { var x = m.x + d[k][0], z = m.z + d[k][1]; if (Math.abs(x) > R || Math.abs(z) > R || grid[key(x, z)] || grid['c' + key(x, z)]) continue; grid['c' + key(x, z)] = 1; dummy.position.set(x * CELL, .04, z * CELL); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); cellInst.setMatrixAt(n++, dummy.matrix); }
  }
  for (var kk in grid) if (kk.charAt(0) === 'c') delete grid[kk];
  cellInst.count = n; cellInst.instanceMatrix.needsUpdate = true;
}
function canPlaceAt(x, z) { if (Math.abs(x) > R || Math.abs(z) > R || grid[key(x, z)]) return false; return !!(grid[key(x + 1, z)] || grid[key(x - 1, z)] || grid[key(x, z + 1)] || grid[key(x, z - 1)]); }

/* =============== экономика =============== */
function recalc() {
  var prod = 0, cons = 0, work = 0, cap = 200, crewCap = 0, i, m, d;
  for (i = 0; i < S.mods.length; i++) {
    m = S.mods[i]; d = DEF[m.t];
    if (d.en > 0) prod += d.en * m.l * (m.t === 'solar' && hasTech('sol2') ? 1.5 : 1);
    else cons += -d.en * (1 + .5 * (m.l - 1));
    if (d.work) work += d.work; if (d.stor) cap += d.stor * m.l; if (d.cap) crewCap += d.cap * m.l;
  }
  if (S.flare > 0) prod *= 1.6;
  eco.prod = prod; eco.cons = cons; eco.eff = cons > prod ? Math.max(.25, prod / cons) : 1;
  eco.work = work; eco.workEff = work > 0 ? Math.min(1, S.res.crew / work) : 1; eco.cap = cap; eco.crewCap = crewCap;
  eco.tired = S.res.o2 <= 0 || S.res.food <= 0;
}
function tick(dt) {
  var r = S.res, i, m, d, e, b, rt = eco.rates; S.time += dt;
  recalc();
  rt.o2 = -r.crew * .05; rt.food = -r.crew * .05; rt.sci = 0; rt.cr = 0; rt.metal = 0;
  for (i = 0; i < S.mods.length; i++) {
    m = S.mods[i]; d = DEF[m.t]; e = modEff(m) * m.l; b = adjBonus(m);
    if (d.food) rt.food += d.food * e * b; if (d.o2) rt.o2 += d.o2 * e * b; if (d.sci) rt.sci += d.sci * e * b; if (d.cr) rt.cr += d.cr * e * b;
    if (d.furnace && dt > 0) { var cv = Math.min(r.ore, d.furnace * e * dt); r.ore -= cv; r.metal += cv; rt.metal += cv / dt; }
  }
  r.food = Math.max(0, Math.min(eco.cap, r.food + rt.food * dt)); r.o2 = Math.max(0, Math.min(eco.cap, r.o2 + rt.o2 * dt));
  r.sci += rt.sci * dt; r.cr += rt.cr * dt; r.metal = Math.min(eco.cap, r.metal); r.ore = Math.min(eco.cap, r.ore);
  /* экипаж прибывает */
  if (r.crew < eco.crewCap && r.food > 8 && r.o2 > 8) {
    S.crewT += dt * (cnt('green') ? 1.3 : 1);
    if (S.crewT >= 14) { S.crewT = 0; r.crew++; var h = findMod('hab') || S.mods[0]; g.float('+1 👩‍🚀', h.px, 3.4, h.pz, '#9df3ff'); }
  } else S.crewT = Math.max(0, S.crewT);
  if (S.flare > 0) S.flare -= dt;
  if (eco.tired) { tiredT += dt; if (tiredT > 40) { tiredT = 0; g.toast(r.o2 <= 0 ? 'Кислорода не хватает — экипаж работает вполсилы' : 'Еды не хватает — экипаж работает вполсилы'); } }
  else if ((rt.o2 < 0 && r.o2 < 40) || (rt.food < 0 && r.food < 40)) { tiredT += dt; if (tiredT > 60) { tiredT = 0; g.toast(rt.o2 < 0 && r.o2 < 40 ? 'Кислород убывает: пригодится генератор О₂ или гидропоника' : 'Еда убывает: пригодится гидропоника или оранжерея'); } }
  updDrones(dt); updShips(dt); updContracts(dt); updEvents(dt); checkGoal();
  S.day = (S.day + dt / DAY) % 1;
}
var tiredT = 0;
function findMod(t) { for (var i = 0; i < S.mods.length; i++) if (S.mods[i].t === t) return S.mods[i]; return null; }

/* =============== постройка, улучшение, снос =============== */
function place(t, x, z, free) {
  var d = DEF[t]; if (!d || !unlocked(t)) return 'Модуль ещё не открыт';
  if (!canPlaceAt(x, z)) return 'Строить можно только рядом со станцией';
  if (S.mods.length >= MAXM) return 'Станция слишком большая';
  var c = costOf(t, 0); if (!free && !can(c)) return 'Не хватает ресурсов: ' + costStr(c);
  if (!free) pay(c);
  var m = { id: uid++, t: t, x: x, z: z, l: 1 }; S.mods.push(m); S.stats.built++;
  rebuild(); g.sfx('place'); g.float(d.e, m.px, 3, m.pz, '#fff');
  if (S.stats.built === 1) hint('Теперь жилой модуль 🏠 — экипаж прилетит сам'); else if (S.stats.built === 3) hint('Лаборатория 🔬 даёт науку, а она открывает новые модули'); else if (S.stats.built >= 5) hint('');
  return null;
}
function upgrade(m) {
  if (m.l >= 3) return 'Максимальный уровень';
  if (m.l === 1 && !hasTech('up2')) return 'Нужна технология «Улучшения 2 уровня»';
  if (m.l === 2 && !hasTech('up3')) return 'Нужна технология «Улучшения 3 уровня»';
  var c = costOf(m.t, m.l); if (!can(c)) return 'Не хватает ресурсов: ' + costStr(c);
  pay(c); m.l++; rebuild(); g.sfx('up'); g.float('ур. ' + m.l, m.px, 3.4, m.pz, '#ffd27a'); return null;
}
function connectedWithout(rm) { // проверка связности без модуля rm
  var seen = {}, st = [S.mods[0]], n = 0; seen[S.mods[0].id] = 1;
  while (st.length) { var m = st.pop(); n++; var nb = neighbors(m); for (var i = 0; i < nb.length; i++) if (nb[i] !== rm && !seen[nb[i].id]) { seen[nb[i].id] = 1; st.push(nb[i]); } }
  return n === S.mods.length - (rm ? 1 : 0);
}
function demolish(m) {
  if (m.t === 'core') return 'Ядро снести нельзя';
  if (!connectedWithout(m)) return 'Так станция развалится на части — сначала снеси модули дальше от ядра';
  var back = spentOf(m), k; for (k in back) back[k] = Math.round(back[k] * .5); pay(back, 1);
  S.mods.splice(S.mods.indexOf(m), 1); if (sel === m) select(null);
  rebuild(); g.sfx('remove'); g.float('+' + costStr(back), m.px, 3, m.pz, '#ffd27a'); return null;
}
function research(id) {
  var t = null; for (var i = 0; i < TECH.length; i++) if (TECH[i].id === id) t = TECH[i];
  if (!t || S.techs[id]) return 'Уже открыто';
  if (t.req && !S.techs[t.req]) return 'Сначала нужно: ' + techName(t.req);
  if (S.res.sci < t.c) return 'Не хватает науки';
  S.res.sci -= t.c; S.techs[id] = 1; g.sfx('up'); g.toast('Открыто: ' + t.n, 'good'); buildDock(); return null;
}
function techName(id) { for (var i = 0; i < TECH.length; i++) if (TECH[i].id === id) return TECH[i].n; return id; }

/* =============== дроны =============== */
function syncDrones() {
  var want = [], i, m, k;
  for (i = 0; i < S.mods.length; i++) { m = S.mods[i]; if (m.t === 'mine') for (k = 0; k < m.l + 1; k++) want.push(m.id + ':' + k); }
  for (i = drones.length - 1; i >= 0; i--) if (want.indexOf(drones[i].k) < 0) drones.splice(i, 1);
  for (i = 0; i < want.length && drones.length < MAXD; i++) {
    var found = false; for (k = 0; k < drones.length; k++) if (drones[k].k === want[i]) { found = true; break; }
    if (!found) { var id = +want[i].split(':')[0], mm = null; for (k = 0; k < S.mods.length; k++) if (S.mods[k].id === id) mm = S.mods[k];
      drones.push({ k: want[i], m: mm, st: 0, t: Math.random() * 2, p: new T.Vector3(mm.px, 1.2, mm.pz + 1), ci: 0, ri: 0, dir: new T.Vector3(0, 0, 1) }); }
  }
  for (i = 0; i < drones.length; i++) { var dd = drones[i], id2 = +dd.k.split(':')[0]; dd.m = null; for (k = 0; k < S.mods.length; k++) if (S.mods[k].id === id2) dd.m = S.mods[k]; }
  droneInst.count = drones.length;
}
function moveTo(p, tgt, v, dt, dir) { _v.subVectors(tgt, p); var d = _v.length(); if (d < 1e-3) return true; var s = Math.min(d, v * dt); dir.copy(_v).multiplyScalar(1 / d); p.addScaledVector(dir, s); return d - s < .3; }
function updDrones(dt) {
  var spd = (hasTech('drone2') ? 20 : 14) * (cnt('radar') ? 1.2 : 1), carry = hasTech('drone2') ? 8 : 5;
  for (var i = 0; i < drones.length; i++) {
    var d = drones[i], m = d.m; if (!m) continue;
    var e = modEff(m), pad = _v2.set(m.px + .3, 1.3, m.pz + 1.1);
    if (d.st === 0) { d.t += dt * e; if (d.t > 1.5) { d.t = 0; d.ci = (Math.random() * 3) | 0; d.ri = (Math.random() * clusters[0].rocks.length) | 0; d.st = 1; } }
    else if (d.st === 1) { rockPos(d.ci, d.ri, _v3); _v3.y += 2.2; if (moveTo(d.p, _v3, spd * (.5 + .5 * e), dt, d.dir)) { d.st = 2; d.t = 0; } }
    else if (d.st === 2) { d.t += dt * e; rockPos(d.ci, d.ri, _v3); _v3.y += 2.2; d.p.lerp(_v3, Math.min(1, dt * 2)); if (d.t > 2.5) { d.st = 3; } }
    else if (d.st === 3) { if (moveTo(d.p, pad, spd * (.5 + .5 * e), dt, d.dir)) { d.st = 0; d.t = 0; var got = carry + (m.l - 1) * 2; S.res.ore = Math.min(eco.cap, S.res.ore + got); S.stats.ore += got; if (Math.random() < .5) g.float('+' + got + ' 🪨', m.px, 3.2, m.pz, '#ffa057'); } }
    dummy.position.copy(d.p); dummy.position.y += Math.sin(g.time * 3 + i) * .12; _v.copy(d.p).add(d.dir); dummy.lookAt(_v); dummy.scale.setScalar(1); dummy.updateMatrix(); droneInst.setMatrixAt(i, dummy.matrix);
  }
  if (drones.length) droneInst.instanceMatrix.needsUpdate = true;
}

/* =============== контракты и корабли =============== */
var CT = [['metal', 30, 70, 5.2], ['food', 25, 60, 3.6], ['o2', 25, 60, 3.6], ['ore', 40, 100, 2.4]];
function genContract() {
  var r = Math.random, k = CT[(r() * CT.length) | 0], sc = Math.min(3, 1 + S.stats.contracts * .08), n = Math.round((k[1] + r() * (k[2] - k[1])) * sc / 5) * 5;
  var cr = Math.round(n * k[3] * (1.1 + r() * .4) * (cnt('radar') ? 1.25 : 1) / 10) * 10;
  return { id: uid++, res: k[0], n: n, cr: cr, st: 'offer' };
}
function updContracts(dt) {
  var offers = 0, i; for (i = 0; i < S.contracts.length; i++) if (S.contracts[i].st === 'offer') offers++;
  S.ctT -= dt * (cnt('radar') ? 1.5 : 1);
  if (S.ctT <= 0) { S.ctT = 45 + Math.random() * 25; if (offers < 3) { S.contracts.push(genContract()); g.toast('Новый контракт 📋', ''); updBadge(); if (panelMode === 'ct') showContracts(); } }
}
function accept(c) {
  if (c.st !== 'offer') return 'Контракт уже принят';
  if (!findMod('dock')) return 'Нужен шлюз-док 🚀';
  var act = 0; for (var i = 0; i < S.contracts.length; i++) if (S.contracts[i].st === 'active') act++;
  if (act >= 3) return 'Уже 3 корабля в пути — подожди';
  c.st = 'active'; spawnShip(c); g.sfx('click'); updBadge(); return null;
}
function decline(c) { var i = S.contracts.indexOf(c); if (i >= 0) S.contracts.splice(i, 1); if (c.st === 'active') c.st = 'cancel'; updBadge(); }
function spawnShip(c, kind) {
  if (ships.length >= MAXS) return null;
  var a = Math.random() * Math.PI * 2, s = { c: c, kind: kind || 'cargo', st: 'in', p: new T.Vector3(Math.cos(a) * 110, 14, Math.sin(a) * 110), dir: new T.Vector3(0, 0, 1), t: 0, out: new T.Vector3(Math.cos(a + 2) * 120, 18, Math.sin(a + 2) * 120) };
  ships.push(s); shipInst.count = ships.length; return s;
}
function shipTarget(s, out) { var d = s.kind === 'trader' ? S.mods[0] : (findMod('dock') || S.mods[0]); return out.set(d.px + 1.0, 2.6, d.pz); }
function updShips(dt) {
  for (var i = ships.length - 1; i >= 0; i--) {
    var s = ships[i];
    if (s.st === 'in') { shipTarget(s, _v3); if (moveTo(s.p, _v3, 16, dt, s.dir)) { s.st = 'wait'; s.t = 0; if (s.kind === 'cargo') g.toast('Грузовик прибыл: нужно ' + s.c.n + ' ' + RN[s.c.res]); } }
    else if (s.st === 'wait') {
      s.t += dt; shipTarget(s, _v3); s.p.lerp(_v3, Math.min(1, dt));
      if (s.kind === 'cargo') { var c = s.c; if (c.st !== 'active') s.st = 'out'; else if (S.res[c.res] >= c.n) { S.res[c.res] -= c.n; S.res.cr += c.cr; c.st = 'done'; S.stats.contracts++; decline(c); g.sfx('coin'); g.float('+' + c.cr + ' 💰', s.p.x, s.p.y + 2, s.p.z, '#ffd166'); g.toast('Контракт выполнен: +' + c.cr + ' кредитов', 'good'); s.st = 'out'; if (panelMode === 'ct') showContracts(); } }
      else if (s.t > 25) s.st = 'out';
    }
    else if (s.st === 'out') { if (moveTo(s.p, s.out, 18, dt, s.dir)) { ships.splice(i, 1); shipInst.count = ships.length; continue; } }
    dummy.position.copy(s.p); dummy.position.y += Math.sin(g.time * 1.5 + i) * .15; _v.copy(s.p).add(s.dir); dummy.lookAt(_v); dummy.scale.setScalar(1); dummy.updateMatrix(); shipInst.setMatrixAt(i, dummy.matrix);
  }
  if (ships.length) shipInst.instanceMatrix.needsUpdate = true;
}

/* =============== события =============== */
function updEvents(dt) {
  S.evT -= dt;
  if (S.evT > 0) return;
  S.evT = 100 + Math.random() * 70; S.stats.events++;
  var r = Math.random();
  if (r < .35) startMeteors();
  else if (r < .6) traderEvent();
  else if (r < .85) { S.flare = 45; g.toast('Солнечная вспышка: энергии в 1,6 раза больше на 45 с', 'gold'); g.sfx('up'); }
  else { if (S.res.crew < eco.crewCap) { S.res.crew += 2; g.toast('Попутный шаттл привёз +2 человека экипажа', 'good'); } else { S.res.cr += 120; g.toast('Попутный шаттл поделился +120 кредитами', 'good'); } g.sfx('coin'); }
}
function startMeteors() {
  metList.length = 0; metT = 12; meteors.visible = true;
  for (var i = 0; i < MET; i++) metList.push({ x: (Math.random() - .5) * 140, y: 30 + Math.random() * 30, z: (Math.random() - .5) * 140, vx: -18 - Math.random() * 10, vy: -9 - Math.random() * 6, vz: 6 + Math.random() * 6, d: Math.random() * 12 });
  g.toast('Метеоритный дождь! Дроны соберут обломки', 'gold');
}
function updMeteors(dt) {
  if (!meteors.visible) return;
  metT -= dt;
  for (var i = 0; i < MET; i++) {
    var m = metList[i]; m.d -= dt;
    if (m.d > 0) { metPos[i * 6] = metPos[i * 6 + 3] = 999; continue; }
    m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
    if (m.y < -30) { m.x = (Math.random() - .5) * 140; m.y = 40 + Math.random() * 20; m.z = (Math.random() - .5) * 140; }
    metPos[i * 6] = m.x; metPos[i * 6 + 1] = m.y; metPos[i * 6 + 2] = m.z; metPos[i * 6 + 3] = m.x - m.vx * .18; metPos[i * 6 + 4] = m.y - m.vy * .18; metPos[i * 6 + 5] = m.z - m.vz * .18;
  }
  metGeo.attributes.position.needsUpdate = true;
  if (metT <= 0) { meteors.visible = false; var got = 15 + 8 * cnt('mine'); S.res.ore = Math.min(eco.cap, S.res.ore + got); g.toast('Метеоритный дождь прошёл: +' + got + ' руды', 'good'); g.float('+' + got + ' 🪨', 0, 7, 0, '#ffa057'); }
}
function traderEvent() {
  spawnShip(null, 'trader');
  var offers = [{ t: 'Купить 50 металла за 140 кредитов', ok: function () { return S.res.cr >= 140; }, f: function () { S.res.cr -= 140; S.res.metal = Math.min(eco.cap, S.res.metal + 50); } }];
  if (S.res.food >= 40) offers.push({ t: 'Продать 40 еды за 110 кредитов', ok: function () { return S.res.food >= 40; }, f: function () { S.res.food -= 40; S.res.cr += 110; } });
  if (S.res.ore >= 50) offers.push({ t: 'Продать 50 руды за 100 кредитов', ok: function () { return S.res.ore >= 50; }, f: function () { S.res.ore -= 50; S.res.cr += 100; } });
  offers.push({ t: 'Купить 30 еды за 60 кредитов', ok: function () { return S.res.cr >= 60; }, f: function () { S.res.cr -= 60; S.res.food = Math.min(eco.cap, S.res.food + 30); } });
  var html = '<h2>🛸 Дружелюбный торговец</h2><p>Пролетал мимо и предлагает обмен. Можно отказаться — обид не будет.</p><div class="btns" style="flex-direction:column;align-items:stretch">';
  for (var i = 0; i < offers.length; i++) html += '<button class="btn alt" data-i="' + i + '"' + (offers[i].ok() ? '' : ' disabled') + '>' + offers[i].t + '</button>';
  html += '<button class="btn" data-close>Спасибо, не надо</button></div>';
  g.modal(html); var bs = g.$('modalBox').querySelectorAll('[data-i]');
  for (var k = 0; k < bs.length; k++) bs[k].onclick = function () { var o = offers[+this.getAttribute('data-i')]; if (o.ok()) { o.f(); g.sfx('coin'); g.toast('Сделка заключена', 'good'); } g.closeModal(); };
}

/* =============== цели =============== */
function checkGoal() {
  var gl = GOALS[S.goal]; if (!gl) return;
  if (gl.chk() >= 1) {
    pay(gl.rw, 1); S.goal++; g.sfx('up'); g.toast('Цель «' + gl.n + '» выполнена! Награда: ' + costStr(gl.rw), 'gold');
    if (gl.final) g.modal('<h2>🏆 Колония на 50 человек!</h2><p>Это была большая цель. Станция стала настоящей колонией — можно играть дальше, строить и украшать её сколько хочется.</p><div class="btns"><button class="btn" data-close>Продолжить</button></div>');
    showGoal();
  }
}
function updGoalBar() { var p = GOALS[S.goal] ? GOALS[S.goal].chk() : 1, bar = g.$('goal').querySelector('i'); if (bar) bar.style.width = Math.round(p * 100) + '%'; }
function showGoal() {
  var gl = GOALS[S.goal], el = g.$('goal');
  if (!gl) { el.innerHTML = '<b>Колония</b>Все цели выполнены — свободная игра'; el.classList.add('on'); return; }
  el.innerHTML = '<b>' + gl.t + ' · цель ' + (S.goal + 1) + '/' + GOALS.length + '</b>' + gl.d + '<div class="bar"><i></i></div>'; el.classList.add('on');
}

/* =============== HUD =============== */
var chips = {};
function buildRes() {
  var el = g.$('res'); el.innerHTML = '';
  for (var i = 0; i < RES.length; i++) { var d = document.createElement('div'); d.className = 'rc'; d.innerHTML = '<span class="ic">' + RES[i][1] + '</span><b>0</b><small>' + RES[i][2] + '</small>'; d.title = RES[i][2]; el.appendChild(d); chips[RES[i][0]] = d; }
}
function fr(n) { return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1); }
function updRes() {
  var r = S.res, rt = eco.rates;
  function set(k, txt, cls) { var c = chips[k]; c.firstChild.nextSibling.textContent = txt; c.className = 'rc' + (cls ? ' ' + cls : ''); }
  set('en', fr(eco.prod - eco.cons), eco.cons > eco.prod ? 'warn' : eco.prod - eco.cons >= 3 ? 'good' : '');
  set('o2', Math.round(r.o2) + ' ' + fr(rt.o2 || 0), r.o2 <= 0 ? 'warn' : ''); set('food', Math.round(r.food) + ' ' + fr(rt.food || 0), r.food <= 0 ? 'warn' : '');
  set('ore', Math.round(r.ore)); set('metal', Math.round(r.metal)); set('cr', g.fmt(r.cr)); set('sci', Math.round(r.sci));
  set('crew', r.crew + '/' + eco.crewCap + (eco.work ? ' · 👷' + Math.min(r.crew, eco.work) + '/' + eco.work : ''), eco.workEff < 1 ? 'warn' : '');
}
var dockBtns = {};
function buildDock() {
  var el = g.$('dockIn'); el.innerHTML = ''; dockBtns = {};
  var b = document.createElement('button'); b.className = 'bi'; b.innerHTML = '<span class="e">🔬</span>Наука<span class="p" id="sciP"></span>'; b.onclick = function () { g.sfx('click'); if (panelMode === 'tech') closePanel(); else showTech(); }; el.appendChild(b); dockBtns.tech = b;
  b = document.createElement('button'); b.className = 'bi'; b.innerHTML = '<span class="e">📋</span>Контракты<span class="n" id="ctN" style="display:none"></span>'; b.onclick = function () { g.sfx('click'); if (panelMode === 'ct') closePanel(); else showContracts(); }; el.appendChild(b); dockBtns.ct = b;
  for (var i = 0; i < ORDER.length; i++) (function (t) {
    if (!unlocked(t)) return;
    var d = DEF[t], bb = document.createElement('button'); bb.className = 'bi'; bb.innerHTML = '<span class="e">' + d.e + '</span>' + d.n + '<span class="p">' + costStr(costOf(t, 0)) + '</span>'; bb.title = d.d;
    bb.onclick = function () { g.sfx('click'); setTool(tool === t ? null : t); }; el.appendChild(bb); dockBtns[t] = bb;
  })(ORDER[i]);
  updBadge(); updDockState();
}
function updDockState() { for (var t in dockBtns) { if (!DEF[t]) continue; var bb = dockBtns[t]; bb.classList.toggle('off', !can(costOf(t, 0))); bb.classList.toggle('on', tool === t); } var sp = g.$('sciP'); if (sp) sp.textContent = Math.round(S.res.sci); }
function updBadge() { var n = 0, i; for (i = 0; i < S.contracts.length; i++) if (S.contracts[i].st === 'offer') n++; var e = g.$('ctN'); if (e) { e.style.display = n ? '' : 'none'; e.textContent = n; } }
function setTool(t) { tool = t; select(null); updDockState(); updCells(); hover.visible = false; if (t) { var d = DEF[t]; openPanel('build'); g.$('panel').innerHTML = '<h3>' + d.e + ' ' + d.n + '</h3><p>' + d.d + '</p>' + rowsFor(t, 1) + '<p>Нажми на подсвеченную клетку рядом со станцией. Правая кнопка или Esc — отмена.</p><div class="btns"><button class="btn alt" id="pClose">Отмена</button></div>'; g.$('pClose').onclick = function () { setTool(null); }; } else if (panelMode === 'build') closePanel(); }
function hint(t) { g.$('hint').textContent = t; }
var panelMode = null;
function openPanel(m) { panelMode = m; g.$('panel').classList.add('on'); }
function closePanel() { panelMode = null; g.$('panel').classList.remove('on'); if (sel) { sel = null; selRing.visible = false; } }
function rowsFor(t, l) {
  var d = DEF[t], a = [], mul = l || 1;
  a.push(['⚡ Энергия', fr(d.en > 0 ? d.en * mul * (t === 'solar' && hasTech('sol2') ? 1.5 : 1) : d.en * (1 + .5 * (mul - 1)))]);
  if (d.food) a.push(['🍏 Еда', fr(d.food * mul) + '/с']); if (d.o2) a.push(['🫧 Кислород', fr(d.o2 * mul) + '/с']); if (d.sci) a.push(['🔬 Наука', fr(d.sci * mul) + '/с']);
  if (d.cr) a.push(['💰 Кредиты', fr(d.cr * mul) + '/с']); if (d.furnace) a.push(['🔧 Плавка руды', fr(d.furnace * mul) + '/с']); if (d.drones) a.push(['🛸 Дроны', String(mul + 1)]);
  if (d.cap) a.push(['👩‍🚀 Места', '+' + d.cap * mul]); if (d.stor) a.push(['📦 Хранилище', '+' + d.stor * mul]); if (d.work) a.push(['👷 Нужно людей', String(d.work)]);
  if (d.dock) a.push(['🚀 Корабли', 'принимает']); if (d.radar) a.push(['📡 Контракты', 'чаще и дороже']);
  var h = ''; for (var i = 0; i < a.length; i++) h += '<div class="row"><span>' + a[i][0] + '</span><span>' + a[i][1] + '</span></div>'; return h;
}
function select(m) {
  sel = m; selRing.visible = !!m;
  if (!m) { if (panelMode === 'mod') closePanel(); return; }
  selRing.position.set(m.px, .06, m.pz); showModPanel(m);
}
function showModPanel(m) {
  var d = DEF[m.t], e = modEff(m), b = adjBonus(m), up = m.l < 3 ? costOf(m.t, m.l) : null, back = spentOf(m), k; for (k in back) back[k] = Math.round(back[k] * .5);
  var h = '<h3>' + d.e + ' ' + d.n + ' · ур. ' + m.l + '</h3><p>' + d.d + '</p>' + rowsFor(m.t, m.l);
  if (d.en < 0 || d.work) h += '<div class="row"><span>Работает на</span><span' + (e < 1 ? ' style="color:var(--bad)"' : '') + '>' + Math.round(e * 100) + '%</span></div>';
  if (b > 1) h += '<div class="row"><span>Соседство</span><span style="color:var(--ok)">+' + Math.round((b - 1) * 100) + '%</span></div>';
  h += '<div class="btns">';
  if (m.t !== 'core') { if (up) h += '<button class="btn" id="pUp">Улучшить · ' + costStr(up) + '</button>'; h += '<button class="btn bad" id="pDel">Снести · +' + costStr(back) + '</button>'; }
  h += '<button class="btn alt" id="pClose">✕</button></div>';
  openPanel('mod'); g.$('panel').innerHTML = h;
  var bu = g.$('pUp'), bd = g.$('pDel'); if (bu) bu.onclick = function () { var r = upgrade(m); if (r) { g.toast(r, 'bad'); g.sfx('bad'); } else showModPanel(m); };
  if (bd) bd.onclick = function () { var r = demolish(m); if (r) { g.toast(r, 'bad'); g.sfx('bad'); } };
  g.$('pClose').onclick = function () { select(null); };
}
function showTech() {
  var h = '<h3>🔬 Технологии</h3><p>Очки науки: <b style="color:var(--ink)">' + Math.round(S.res.sci) + '</b>. Лаборатории дают науку.</p>';
  for (var i = 0; i < TECH.length; i++) {
    var t = TECH[i], done = !!S.techs[t.id], lock = t.req && !S.techs[t.req];
    h += '<div class="tk' + (done ? ' done' : lock ? ' lock' : '') + '"><div><b>' + t.n + '</b><br><small>' + t.d + (lock ? ' · после: ' + techName(t.req) : '') + '</small></div>';
    h += done ? '<span>✓</span>' : '<button class="btn" data-t="' + t.id + '"' + (lock || S.res.sci < t.c ? ' disabled' : '') + '>' + t.c + '🔬</button>'; h += '</div>';
  }
  h += '<div class="btns"><button class="btn alt" id="pClose">✕</button></div>';
  openPanel('tech'); var p = g.$('panel'); p.innerHTML = h;
  var bs = p.querySelectorAll('[data-t]'); for (var k = 0; k < bs.length; k++) bs[k].onclick = function () { var r = research(this.getAttribute('data-t')); if (r) { g.toast(r, 'bad'); g.sfx('bad'); } showTech(); };
  g.$('pClose').onclick = closePanel;
}
function showContracts() {
  var h = '<h3>📋 Контракты</h3><p>' + (findMod('dock') ? 'Грузовик прилетит к шлюзу и подождёт, пока ресурсы соберутся. Отказ — без штрафа.' : 'Чтобы принимать контракты, построй шлюз-док 🚀.') + '</p>';
  var n = 0;
  for (var i = 0; i < S.contracts.length; i++) {
    var c = S.contracts[i]; n++;
    h += '<div class="ct"><b>Доставь ' + c.n + ' ' + RN[c.res] + ' ' + RI[c.res] + '</b> → <span style="color:var(--gold)">' + c.cr + ' 💰</span>';
    if (c.st === 'offer') h += '<div class="btns"><button class="btn" data-a="' + i + '">Принять</button><button class="btn alt" data-d="' + i + '">Отказаться</button></div>';
    else h += '<br><small>' + (S.res[c.res] >= c.n ? 'Грузовик в пути…' : 'Корабль ждёт: есть ' + Math.floor(S.res[c.res]) + ' из ' + c.n) + '</small><div class="btns"><button class="btn alt" data-d="' + i + '">Отменить</button></div>';
    h += '</div>';
  }
  if (!n) h += '<div class="ct">Пока предложений нет — новые появляются сами, радар ускоряет.</div>';
  h += '<div class="btns"><button class="btn alt" id="pClose">✕</button></div>';
  openPanel('ct'); var p = g.$('panel'); p.innerHTML = h;
  var bs = p.querySelectorAll('[data-a]'), k; for (k = 0; k < bs.length; k++) bs[k].onclick = function () { var r = accept(S.contracts[+this.getAttribute('data-a')]); if (r) { g.toast(r, 'bad'); g.sfx('bad'); } else g.toast('Грузовик вылетел к станции', 'good'); showContracts(); };
  bs = p.querySelectorAll('[data-d]'); for (k = 0; k < bs.length; k++) bs[k].onclick = function () { decline(S.contracts[+this.getAttribute('data-d')]); g.sfx('click'); showContracts(); };
  g.$('pClose').onclick = closePanel;
}
function helpModal() {
  g.modal('<h2>🛰️ Космическая станция</h2><p>Собирай станцию из модулей и расти до колонии на 50 человек. Спешить некуда: ничего не ломается, штрафов нет.</p><ul>' +
    '<li><b>Модули</b> строятся только рядом с уже построенными: выбери модуль внизу и нажми на подсвеченную клетку.</li>' +
    '<li><b>⚡ Энергия</b>: панели дают, остальные тратят. Если не хватает — модули просто работают медленнее.</li>' +
    '<li><b>👩‍🚀 Экипаж</b> прилетает сам, когда есть еда, кислород и место в жилых модулях. Лаборатории, доки и мастерские требуют людей.</li>' +
    '<li><b>🪨 Руда</b>: шахтёрский док отправляет дронов к астероидам. Ядро и мастерская плавят руду в металл.</li>' +
    '<li><b>📋 Контракты</b>: грузовики платят кредитами за металл, еду, кислород. Отказ — без штрафа.</li>' +
    '<li><b>🔬 Наука</b> открывает новые модули и улучшения до 3 уровня. Снос возвращает половину цены.</li></ul>' +
    '<p>Камера: тяни — вращение, колесо или щипок — зум, правая кнопка или WASD — сдвиг.</p><div class="btns"><button class="btn" data-close>Поехали</button></div>');
}

/* =============== ввод =============== */
var lastCell = null;
function cellAt(e) { var p = g.groundAt(e); if (!p) return null; return { x: Math.round(p.x / CELL), z: Math.round(p.z / CELL) }; }
g.onTap = function (e, btn) {
  if (btn === 2) { setTool(null); return; }
  var c = cellAt(e); if (!c) return;
  if (tool) {
    var r = place(tool, c.x, c.z); if (r) { g.toast(r, 'bad'); g.sfx('bad'); }
    else if (!can(costOf(tool, 0))) setTool(null);
    return;
  }
  var m = grid[key(c.x, c.z)];
  if (m) { select(m); g.sfx('click'); } else { select(null); if (panelMode) closePanel(); }
};
g.onHover = function (e) {
  var c = cellAt(e), tip = g.$('tip'); if (!c) { hover.visible = false; tip.style.display = 'none'; return; }
  var m = grid[key(c.x, c.z)];
  if (tool) { var ok = canPlaceAt(c.x, c.z); hover.visible = ok; hover.position.set(c.x * CELL, .05, c.z * CELL); hover.material.color.setHex(ok ? ACC : RED); }
  else hover.visible = false;
  if (m && !tool) { tip.style.display = 'block'; tip.textContent = DEF[m.t].e + ' ' + DEF[m.t].n + ' · ур. ' + m.l; tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; } else tip.style.display = 'none';
};
g.onKey = function (k) { if (k === 'escape') { setTool(null); select(null); closePanel(); } };
g.$('bHelp').onclick = function () { g.sfx('click'); helpModal(); };

/* =============== сохранение / загрузка =============== */
function save() { if (g.noSave) return; g.save({ v: 1, seed: S.seed, time: S.time, day: S.day, res: S.res, mods: S.mods.map(function (m) { return { t: m.t, x: m.x, z: m.z, l: m.l }; }), techs: S.techs, goal: S.goal, contracts: S.contracts, stats: S.stats, evT: S.evT, ctT: S.ctT, crewT: S.crewT, flare: S.flare, help: S.help }); }
function load() {
  var d = g.load(); if (!d || d.v !== 1) return false;
  try {
    var st = newState(), k, i;
    for (k in st.res) if (typeof d.res[k] === 'number' && isFinite(d.res[k])) st.res[k] = Math.max(0, d.res[k]);
    st.seed = +d.seed || st.seed; st.time = +d.time || 0; st.day = isFinite(+d.day) ? +d.day : .3; st.goal = Math.min(GOALS.length, +d.goal || 0);
    st.techs = {}; for (k in d.techs || {}) if (TECH.some(function (t) { return t.id === k; })) st.techs[k] = 1;
    st.stats = d.stats && typeof d.stats === 'object' ? { built: +d.stats.built || 0, contracts: +d.stats.contracts || 0, ore: +d.stats.ore || 0, events: +d.stats.events || 0 } : st.stats;
    st.evT = +d.evT || 80; st.ctT = +d.ctT || 25; st.crewT = +d.crewT || 0; st.flare = +d.flare || 0; st.help = +d.help || 0;
    var mods = [], seen = {};
    for (i = 0; i < (d.mods || []).length; i++) { var m = d.mods[i]; if (!m || !DEF[m.t] || !isFinite(+m.x) || !isFinite(+m.z) || seen[key(m.x, m.z)]) continue; seen[key(m.x, m.z)] = 1; mods.push({ id: uid++, t: m.t, x: +m.x | 0, z: +m.z | 0, l: Math.max(1, Math.min(3, +m.l | 0)) }); }
    if (!mods.length || mods[0].t !== 'core' || mods[0].x !== 0 || mods[0].z !== 0) throw new Error('core');
    st.mods = mods;
    for (i = 0; i < (d.contracts || []).length; i++) { var c = d.contracts[i]; if (c && RN[c.res] && isFinite(+c.n) && isFinite(+c.cr)) st.contracts.push({ id: uid++, res: c.res, n: +c.n, cr: +c.cr, st: c.st === 'active' ? 'active' : 'offer' }); }
    S = st; ships.length = 0; shipInst.count = 0; rebuild();
    if (!connectedWithout(null)) throw new Error('conn');
    for (i = 0; i < S.contracts.length; i++) if (S.contracts[i].st === 'active') { var s = spawnShip(S.contracts[i]); if (s) { shipTarget(s, s.p); s.st = 'wait'; } }
    return true;
  } catch (e) { return false; }
}
function start() {
  if (!load()) { S = newState(); S.mods.push({ id: uid++, t: 'core', x: 0, z: 0, l: 1 }); rebuild(); }
  buildRes(); buildDock(); showGoal(); updRes(); g.setDay(S.day);
  if (!S.help) { S.help = 1; helpModal(); hint('Выбери модуль внизу и нажми на подсвеченную клетку рядом со станцией'); }
  else if (S.mods.length < 5) hint('Выбери модуль внизу и нажми на подсвеченную клетку рядом со станцией');
}
g.onAutosave = save;

/* =============== кадр =============== */
var hudT = 0, _sd = new T.Vector3();
g.onDay = function (day) { // космос: фон всегда тёмный, ночь — тень планеты
  scene.background.setHex(SPACE); scene.fog.color.setHex(SPACE); nightU.value = 1 - day;
  g.hemi.intensity = .25 + .35 * day;
};
g.onUpdate = function (dt) { tick(dt); g.setDay(S.day); };
g.onFrame = function (dt, t) {
  updSpin(t); updFlow(dt); updRocks(dt); updMeteors(dt);
  planet.rotation.y += dt * .012;
  sky.position.copy(g.camera.position);
  _sd.copy(g.sun.position).sub(g.sun.target.position).normalize(); sunSp.position.copy(_sd).multiplyScalar(380);
  var fl = S.flare > 0 ? 1.25 + Math.sin(t * 6) * .12 : 1; sunSp.scale.set(90 * fl, 90 * fl, 1);
  planet.userData.atm.material.uniforms.sunDir.value.copy(_sd).transformDirection(g.camera.matrixWorldInverse);
  if (sel) selRing.material.opacity = .6 + Math.sin(t * 4) * .25;
  hudT += dt; if (hudT > .3) { hudT = 0; updRes(); updDockState(); updGoalBar(); if (panelMode === 'mod' && sel) { var e = g.$('panel').querySelector('.row span[style]'); if (e) e.textContent = Math.round(modEff(sel) * 100) + '%'; } }
};

/* тестовый доступ: симуляция из консоли/тестов */
window.__game = { state: function () { return S; }, eco: eco, DEF: DEF, TECH: TECH, GOALS: GOALS, place: place, upgrade: upgrade, demolish: demolish, research: research, accept: accept, decline: decline, tick: tick, rebuild: rebuild, canPlaceAt: canPlaceAt, save: save, load: load, grid: function () { return grid; }, ships: ships, drones: drones, fire: function () { S.evT = 0; updEvents(0); }, meteors: startMeteors, trader: traderEvent };

g.wireBar(); start(); g.start();
})();
