/* Общий движок игр Hub: three.js (глобальный THREE), камера-орбита, лимит FPS, адаптивное качество,
   день/ночь, выбор клетки мышью/пальцем, сохранение, звук, HUD.
   Использование: var g = G.create({key:'island', bg:0x9fd6e8, ...}); g.onUpdate=function(dt,t){...}; g.start(); */
(function (W) {
  'use strict';
  var FPS_CAP = 100;
  var Q = [ // уровни качества: 0 — самый лёгкий
    { pr: 0.75, shadow: false, sm: 0,    aa: false, far: 140 },
    { pr: 1.0,  shadow: false, sm: 0,    aa: false, far: 180 },
    { pr: 1.25, shadow: true,  sm: 1024, aa: true,  far: 220 },
    { pr: 1.75, shadow: true,  sm: 2048, aa: true,  far: 260 }
  ];

  function rng(seed) { // mulberry32
    var a = seed >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function noise2(seed) { // простой value-noise 0..1
    var r = rng(seed), P = []; for (var i = 0; i < 256; i++) P.push(r());
    function h(x, y) { return P[((x * 73856093) ^ (y * 19349663)) & 255]; }
    function sm(t) { return t * t * (3 - 2 * t); }
    return function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
      var a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
      return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
    };
  }
  function fbm(n, x, y) { return n(x, y) * .5 + n(x * 2, y * 2) * .25 + n(x * 4, y * 4) * .125 + n(x * 8, y * 8) * .0625; }

  function create(opt) {
    opt = opt || {};
    var host = document.getElementById('stage');
    var g = { opt: opt, THREE: THREE, rng: rng, noise2: noise2, fbm: fbm, time: 0, paused: false, speed: 1 };
    var ql = +(localStorage.getItem('games:q') || -1); var auto = ql < 0 || isNaN(ql);
    var mobile = /Android|iPhone|iPad/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 900);
    if (auto) ql = mobile ? 1 : 2;
    g.quality = ql; g.autoQuality = auto;

    var renderer = new THREE.WebGLRenderer({ antialias: Q[ql].aa, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q[ql].pr));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = Q[ql].shadow; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    var scene = new THREE.Scene();
    var bg = new THREE.Color(opt.bg || 0x9fd6e8);
    scene.background = bg.clone(); scene.fog = new THREE.Fog(bg.getHex(), 60, Q[ql].far);
    var cam = new THREE.PerspectiveCamera(40, 1, 0.5, 500);
    var hemi = new THREE.HemisphereLight(0xffffff, 0x6b7a5a, 0.75); scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xfff2d6, 1.9);
    sun.castShadow = Q[ql].shadow; sun.shadow.mapSize.set(Q[ql].sm || 512, Q[ql].sm || 512);
    var sc = sun.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 200;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
    scene.add(sun); scene.add(sun.target);
    g.renderer = renderer; g.scene = scene; g.camera = cam; g.sun = sun; g.hemi = hemi;

    /* ---------- камера-орбита ---------- */
    var cs = { tx: 0, tz: 0, ty: 0, yaw: .8, pitch: .85, dist: opt.dist || 38, minD: opt.minDist || 10, maxD: opt.maxDist || 80,
               gyaw: .8, gpitch: .85, gdist: opt.dist || 38, gtx: 0, gtz: 0, bound: opt.bound || 40 };
    g.cam = cs;
    function applyCam(dt) {
      var k = 1 - Math.pow(.0015, dt);
      cs.yaw += (cs.gyaw - cs.yaw) * k; cs.pitch += (cs.gpitch - cs.pitch) * k; cs.dist += (cs.gdist - cs.dist) * k;
      cs.tx += (cs.gtx - cs.tx) * k; cs.tz += (cs.gtz - cs.tz) * k;
      var cp = Math.cos(cs.pitch), d = cs.dist;
      cam.position.set(cs.tx + Math.sin(cs.yaw) * cp * d, cs.ty + Math.sin(cs.pitch) * d, cs.tz + Math.cos(cs.yaw) * cp * d);
      cam.lookAt(cs.tx, cs.ty, cs.tz);
      sun.target.position.set(cs.tx, 0, cs.tz); sun.target.updateMatrixWorld();
    }
    g.focus = function (x, z, dist) { cs.gtx = x; cs.gtz = z; if (dist) cs.gdist = dist; };

    /* ---------- ввод: вращение, перемещение, зум, тап ---------- */
    var el = renderer.domElement; el.style.touchAction = 'none';
    var ptrs = {}, np = 0, down = null, moved = 0, lastPinch = 0, lastAng = 0, lastMid = null;
    var ray = new THREE.Raycaster(), v2 = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
    g.groundY = 0;
    function ndc(e) { var r = el.getBoundingClientRect(); v2.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); return v2; }
    g.groundAt = function (e) { ray.setFromCamera(ndc(e), cam); plane.constant = -g.groundY; return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null; };
    g.pickObjects = function (e, objs) { ray.setFromCamera(ndc(e), cam); var r = ray.intersectObjects(objs, true); return r.length ? r[0] : null; };
    function pan(dx, dy) {
      var s = cs.dist * .0016, sy = Math.sin(cs.yaw), cy = Math.cos(cs.yaw);
      cs.gtx -= (dx * cy + dy * sy) * s; cs.gtz -= (-dx * sy + dy * cy) * s;
      var b = cs.bound; cs.gtx = Math.max(-b, Math.min(b, cs.gtx)); cs.gtz = Math.max(-b, Math.min(b, cs.gtz));
    }
    el.addEventListener('pointerdown', function (e) {
      el.setPointerCapture(e.pointerId); ptrs[e.pointerId] = { x: e.clientX, y: e.clientY, b: e.button }; np = Object.keys(ptrs).length;
      if (np === 1) { down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button }; moved = 0; }
      if (np === 2) { var p = Object.values(ptrs); lastPinch = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); lastAng = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x); lastMid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }; moved = 99; }
    });
    el.addEventListener('pointermove', function (e) {
      var p = ptrs[e.pointerId];
      if (!p) { if (g.onHover) g.onHover(e); return; }
      var dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (np === 1) {
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 6) {
          if (p.b === 2 || e.shiftKey || (g.dragMode === 'pan')) pan(dx, dy);
          else if (p.b === 1) pan(dx, dy);
          else { cs.gyaw -= dx * .006; cs.gpitch = Math.max(.25, Math.min(1.4, cs.gpitch + dy * .005)); }
        }
        if (g.onDragMove && down) g.onDragMove(e, moved > 6);
      } else if (np === 2) {
        var q = Object.values(ptrs), d = Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y), a = Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x);
        var mid = { x: (q[0].x + q[1].x) / 2, y: (q[0].y + q[1].y) / 2 };
        cs.gdist = Math.max(cs.minD, Math.min(cs.maxD, cs.gdist * lastPinch / d)); lastPinch = d;
        var da = a - lastAng; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; cs.gyaw -= da; lastAng = a;
        if (lastMid) pan(mid.x - lastMid.x, mid.y - lastMid.y); lastMid = mid;
      }
    });
    function up(e) {
      var wasOne = np === 1; delete ptrs[e.pointerId]; np = Object.keys(ptrs).length;
      if (wasOne && down && moved <= 6 && performance.now() - down.t < 500) { if (g.onTap) g.onTap(e, down.b); }
      if (g.onDragEnd && wasOne) g.onDragEnd(e, moved > 6);
      if (np < 2) lastMid = null; if (np === 0) down = null;
    }
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', function (e) { e.preventDefault(); cs.gdist = Math.max(cs.minD, Math.min(cs.maxD, cs.gdist * Math.exp(e.deltaY * .0011))); }, { passive: false });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    addEventListener('keydown', function (e) {
      if (/INPUT|TEXTAREA/.test((e.target || {}).tagName || '')) return;
      var s = 3, sy = Math.sin(cs.yaw), cy = Math.cos(cs.yaw), k = e.key.toLowerCase();
      if (k === 'a' || k === 'arrowleft') { cs.gtx -= cy * s; cs.gtz += sy * s; }
      else if (k === 'd' || k === 'arrowright') { cs.gtx += cy * s; cs.gtz -= sy * s; }
      else if (k === 'w' || k === 'arrowup') { cs.gtx -= sy * s; cs.gtz -= cy * s; }
      else if (k === 's' || k === 'arrowdown') { cs.gtx += sy * s; cs.gtz += cy * s; }
      else if (k === 'q') cs.gyaw += .3; else if (k === 'e') cs.gyaw -= .3;
      else if (k === ' ') { g.paused = !g.paused; if (g.onPause) g.onPause(g.paused); e.preventDefault(); }
      else if (g.onKey) g.onKey(k, e);
      var b = cs.bound; cs.gtx = Math.max(-b, Math.min(b, cs.gtx)); cs.gtz = Math.max(-b, Math.min(b, cs.gtz));
    });

    /* ---------- размер ---------- */
    function resize() { var w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); el.style.width = w + 'px'; el.style.height = h + 'px'; cam.aspect = w / h; cam.updateProjectionMatrix(); }
    addEventListener('resize', resize); resize();

    /* ---------- качество ---------- */
    g.setQuality = function (n, manual) {
      n = Math.max(0, Math.min(Q.length - 1, n)); g.quality = n; var q = Q[n];
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.pr)); resize();
      renderer.shadowMap.enabled = q.shadow; sun.castShadow = q.shadow;
      if (q.shadow && sun.shadow.map && sun.shadow.mapSize.x !== q.sm) { sun.shadow.mapSize.set(q.sm, q.sm); sun.shadow.map.dispose(); sun.shadow.map = null; }
      scene.fog.far = q.far;
      scene.traverse(function (o) { if (o.material) { var ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(function (m) { m.needsUpdate = true; }); } });
      if (manual) { try { localStorage.setItem('games:q', String(n)); } catch (e) { } g.autoQuality = false; }
      if (g.onQuality) g.onQuality(n);
    };

    /* ---------- день / ночь: t от 0 до 1 (0.25 — рассвет, 0.5 — полдень, 0.75 — закат) ---------- */
    var cDay = new THREE.Color(opt.bg || 0x9fd6e8), cNight = new THREE.Color(0x0b1430), cDusk = new THREE.Color(0xf4a46a), tmp = new THREE.Color();
    g.dayLight = 1;
    g.setDay = function (t) {
      t = ((t % 1) + 1) % 1; var a = t * Math.PI * 2 - Math.PI / 2; // sin>0 днём
      var h = Math.sin(a); var day = Math.max(0, Math.min(1, h * 2.2 + .35)); g.dayLight = day;
      sun.position.set(cs.tx + Math.cos(a) * 70, Math.max(8, h * 80 + 10), cs.tz + 28);
      var dusk = Math.max(0, 1 - Math.abs(h) * 3.2);
      tmp.copy(cNight).lerp(cDay, day).lerp(cDusk, dusk * .55 * (day > 0 ? 1 : 0));
      scene.background.copy(tmp); scene.fog.color.copy(tmp);
      sun.intensity = 0.1 + 1.35 * day; hemi.intensity = 0.22 + 0.42 * day;
      sun.color.setHex(dusk > .4 ? 0xffb27a : 0xfff2d6);
      if (opt.dayBg) { }
      if (g.onDay) g.onDay(day, t);
    };

    /* ---------- сохранение ---------- */
    var KEY = 'games:' + (opt.key || 'x');
    g.save = function (obj) { try { localStorage.setItem(KEY, JSON.stringify(obj)); return true; } catch (e) { return false; } };
    g.load = function () { try { var s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
    g.wipe = function () { try { localStorage.removeItem(KEY); } catch (e) { } };

    /* ---------- звук ---------- */
    var AC = null, muted = localStorage.getItem('games:mute') === '1';
    function ac() { if (!AC) { try { AC = new (W.AudioContext || W.webkitAudioContext)(); } catch (e) { } } return AC; }
    g.tone = function (f, d, type, vol, slide) {
      if (muted) return; var a = ac(); if (!a) return; if (a.state === 'suspended') a.resume();
      var o = a.createOscillator(), gn = a.createGain(), t = a.currentTime;
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + d);
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol || .12, t + .015); gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(gn); gn.connect(a.destination); o.start(t); o.stop(t + d + .02);
    };
    var SFX = {
      place: function () { g.tone(330, .12, 'triangle', .14, 1.6); setTimeout(function () { g.tone(494, .14, 'triangle', .1); }, 60); },
      bad: function () { g.tone(150, .18, 'sawtooth', .08, .6); },
      coin: function () { g.tone(880, .09, 'square', .05); setTimeout(function () { g.tone(1318, .14, 'square', .05); }, 70); },
      up: function () { [392, 523, 659, 784].forEach(function (f, i) { setTimeout(function () { g.tone(f, .16, 'triangle', .1); }, i * 80); }); },
      click: function () { g.tone(520, .05, 'triangle', .06); },
      remove: function () { g.tone(260, .16, 'triangle', .1, .5); }
    };
    g.sfx = function (n) { if (SFX[n]) SFX[n](); };
    g.setMuted = function (m) { muted = !!m; try { localStorage.setItem('games:mute', m ? '1' : '0'); } catch (e) { } };
    g.isMuted = function () { return muted; };

    /* ---------- материалы и геометрия ---------- */
    var matC = {};
    g.mat = function (color, o) {
      var k = color + (o ? JSON.stringify(o) : ''); if (matC[k]) return matC[k];
      var p = { color: color, flatShading: true, roughness: .85, metalness: 0 }; if (o) for (var i in o) p[i] = o[i];
      return matC[k] = new THREE.MeshStandardMaterial(p);
    };
    var geoC = {};
    g.geo = function (name, f) { return geoC[name] || (geoC[name] = f()); };
    g.box = function (w, h, d, color, x, y, z, o) { var m = new THREE.Mesh(g.geo('b' + w + ',' + h + ',' + d, function () { return new THREE.BoxGeometry(w, h, d); }), g.mat(color, o)); m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; m.receiveShadow = true; return m; };
    g.cyl = function (rt, rb, h, color, x, y, z, seg, o) { seg = seg || 8; var m = new THREE.Mesh(g.geo('c' + rt + ',' + rb + ',' + h + ',' + seg, function () { return new THREE.CylinderGeometry(rt, rb, h, seg); }), g.mat(color, o)); m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; m.receiveShadow = true; return m; };
    g.cone = function (r, h, color, x, y, z, seg, o) { return g.cyl(0, r, h, color, x, y, z, seg || 6, o); };
    g.sphere = function (r, color, x, y, z, o) { var m = new THREE.Mesh(g.geo('s' + r, function () { return new THREE.IcosahedronGeometry(r, 1); }), g.mat(color, o)); m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; return m; };
    g.dispose = function (obj) { obj.traverse(function (o) { if (o.userData && o.userData.ownGeo && o.geometry) o.geometry.dispose(); }); };

    /* ---------- плавающие цифры («+5») ---------- */
    var floaters = [];
    g.float = function (text, x, y, z, color) {
      var c = document.createElement('canvas'); c.width = 128; c.height = 48; var x2 = c.getContext('2d');
      x2.font = '700 30px system-ui,sans-serif'; x2.textAlign = 'center'; x2.textBaseline = 'middle'; x2.lineWidth = 6; x2.strokeStyle = 'rgba(0,0,0,.55)'; x2.strokeText(text, 64, 26); x2.fillStyle = color || '#ffe27a'; x2.fillText(text, 64, 26);
      var tex = new THREE.CanvasTexture(c), sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      sp.scale.set(3.2, 1.2, 1); sp.position.set(x, y, z); sp.renderOrder = 10; scene.add(sp); floaters.push({ sp: sp, t: 0 });
    };
    function updFloaters(dt) {
      for (var i = floaters.length - 1; i >= 0; i--) { var f = floaters[i]; f.t += dt; f.sp.position.y += dt * 1.6; f.sp.material.opacity = Math.max(0, 1 - f.t / 1.4);
        if (f.t > 1.4) { scene.remove(f.sp); f.sp.material.map.dispose(); f.sp.material.dispose(); floaters.splice(i, 1); } }
    }

    /* ---------- HUD ---------- */
    var hud = document.getElementById('hud');
    g.hud = hud;
    g.toast = function (txt, kind) {
      var d = document.createElement('div'); d.className = 'toast ' + (kind || ''); d.textContent = txt;
      var box = document.getElementById('toasts'); if (!box) return; box.appendChild(d);
      setTimeout(function () { d.classList.add('out'); setTimeout(function () { d.remove(); }, 400); }, 2600);
      while (box.children.length > 4) box.firstChild.remove();
    };
    g.fmt = function (n) { n = Math.round(n); var a = Math.abs(n); if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.0', '') + ' млн'; if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace('.0', '') + ' тыс'; return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
    g.modal = function (html, onClose) {
      var m = document.getElementById('modal'), b = document.getElementById('modalBox'); b.innerHTML = html; m.classList.add('on');
      function close() { m.classList.remove('on'); m.onclick = null; if (onClose) onClose(); }
      g.closeModal = close; var x = b.querySelectorAll('[data-close]'); for (var i = 0; i < x.length; i++) x[i].onclick = close;
      m.onclick = function (e) { if (e.target === m) close(); };
    };
    g.$ = function (id) { return document.getElementById(id); };

    /* ---------- главный цикл: лимит FPS и адаптивное качество ---------- */
    var last = 0, acc = 0, frames = 0, slow = 0, fast = 0, running = false, hidden = false, fps = 0, fpsT = 0, fpsN = 0, warm = 0;
    g.fps = function () { return fps; };
    function frame(now) {
      if (!running) return;
      requestAnimationFrame(frame);
      if (hidden) return;
      var el2 = now - last;
      if (el2 < 1000 / FPS_CAP - 1.5) return; // лимит кадров
      last = now; var dt = Math.min(el2 / 1000, .1);
      g.time += dt;
      if (!g.paused && g.onUpdate) g.onUpdate(dt * g.speed, g.time);
      updFloaters(dt); applyCam(dt);
      if (g.onFrame) g.onFrame(dt, g.time);
      renderer.render(scene, cam);
      fpsN++; fpsT += el2; if (fpsT >= 1000) { fps = Math.round(fpsN * 1000 / fpsT); fpsN = 0; fpsT = 0; if (g.onFps) g.onFps(fps); }
      // адаптивное качество: смотрим на среднюю длительность кадра
      acc += el2; frames++;
      if (frames >= 45) {
        var avg = acc / frames; acc = 0; frames = 0; warm++;
        if (g.autoQuality && warm > 2) {
          if (avg > 24 && g.quality > 0) { if (++slow >= 2) { g.setQuality(g.quality - 1); slow = 0; warm = 0; } } else slow = 0;
          if (avg < 11.5 && g.quality < Q.length - 1 && !mobile) { if (++fast >= 8) { g.setQuality(g.quality + 1); fast = 0; warm = 0; } } else fast = 0;
        }
      }
    }
    document.addEventListener('visibilitychange', function () { hidden = document.hidden; last = performance.now(); });
    g.start = function () { if (running) return; running = true; last = performance.now(); resize(); requestAnimationFrame(frame); };
    g.stop = function () { running = false; };
    g.renderOnce = function () { applyCam(1); renderer.render(scene, cam); };

    /* автосохранение */
    setInterval(function () { if (g.onAutosave && !document.hidden) g.onAutosave(); }, 8000);
    addEventListener('pagehide', function () { if (g.onAutosave) g.onAutosave(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden && g.onAutosave) g.onAutosave(); });

    /* общие кнопки в шапке */
    g.wireBar = function () {
      var m = g.$('bMute'), q = g.$('bQual'), p = g.$('bPause'), r = g.$('bReset');
      if (m) { m.textContent = muted ? '🔇' : '🔊'; m.onclick = function () { g.setMuted(!muted); m.textContent = muted ? '🔇' : '🔊'; g.sfx('click'); }; }
      var names = ['Эко', 'Норм', 'Красиво', 'Ультра'];
      function qt() { if (q) q.textContent = (g.autoQuality ? 'Авто · ' : '') + names[g.quality]; }
      if (q) { q.onclick = function () { var n = g.autoQuality ? 0 : g.quality + 1; if (n > 3) { g.autoQuality = true; try { localStorage.removeItem('games:q'); } catch (e) { } qt(); return; } g.setQuality(n, true); qt(); }; qt(); g.onQuality = qt; }
      if (p) { p.onclick = function () { g.paused = !g.paused; p.textContent = g.paused ? '▶' : '⏸'; }; g.onPause = function (v) { p.textContent = v ? '▶' : '⏸'; }; }
      if (r) r.onclick = function () { if (confirm('Начать заново? Сохранение будет удалено.')) { g.wipe(); g.noSave = true; location.reload(); } };
      var ff = g.$('bSpeed'); if (ff) { ff.onclick = function () { g.speed = g.speed === 1 ? 2 : g.speed === 2 ? 4 : 1; ff.textContent = '×' + g.speed; g.sfx('click'); }; }
    };
    g.setDay(0.4);
    return g;
  }
  W.G = { create: create, rng: rng, noise2: noise2, fbm: fbm, FPS_CAP: FPS_CAP };
})(window);
