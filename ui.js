// =====================================================================
//  FRONTLINE USA : interface (map, orders, panels, modals)
// =====================================================================
(function () {
'use strict';
const S = SIM, PS = S.PS, UNITS = S.UNITS, UT = S.UT;
const $ = (s, r) => (r || document).querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const SAVE_KEY = 'frontline_usa_save_v1';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const G = () => S.G;
const me = () => G().opts.player;
const nat = id => G().nations[id];
const army = id => G().armies.find(a => a.id === id);
// Game pace: game seconds per real second at 1x. The simulation is tuned in game seconds;
// the pace only decides how long that takes in real life.
const PACES = [
  { k: 'blitz', n: 'Blitz', v: 1, hint: 'Fast. A war plays out in minutes.' },
  { k: 'quick', n: 'Quick', v: 1 / 6, hint: 'An evening. Armies cross a state in about half a minute.' },
  { k: 'long', n: 'Long', v: 1 / 24, hint: 'A campaign of days. Check in a few times a day.' },
  { k: 'epic', n: 'Epic', v: 1 / 72, hint: 'A campaign of a week or more. Training takes hours.' },
];
const pace = () => (G() && G().opts.pace) || 1;
const paceOf = v => PACES.reduce((b, p) => Math.abs(Math.log(p.v / v)) < Math.abs(Math.log(b.v / v)) ? p : b, PACES[0]);
const MAX_AWAY = 90 * 60;      // at most this many game seconds are simulated while the player is away
// game seconds -> real-time text at 1x speed
function fmtDur(gs) {
  const s = Math.max(0, gs / pace());
  if (s < 90) return Math.ceil(s) + 's';
  if (s < 5400) return Math.round(s / 60) + 'm';
  const h = s / 3600;
  if (h < 48) { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return hh + 'h' + (mm ? ' ' + String(mm).padStart(2, '0') + 'm' : ''); }
  return Math.floor(h / 24) + 'd ' + Math.round(h % 24) + 'h';
}

const UI = {
  tab: 'map', selP: null, selA: null, speed: 1, dipOpen: null, dipMsg: '', confirm: '', lastSeq: 0, started: false, modal: false,
  view: { cx: MAP.w / 2, cy: MAP.h / 2, scale: 1 }, labScale: 0, labShow: null, fit: 1, W: 0, H: 0, bk: 1, sig: '', down: 0, viewInit: false, log: false, touch: 0,
};

// ------------------------------------------------------------ svg helpers
const svg = $('#map');
const L = {};
const provEls = [], bdEls = [], labEls = [], cityEls = [], stLabEls = [], fillCache = [], bdCache = [];
const badges = new Map();
function mk(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function buildMap() {
  svg.textContent = '';
  const defs = mk('defs', {}, svg);
  const pat = mk('pattern', { id: 'grid', width: 48, height: 48, patternUnits: 'userSpaceOnUse' }, defs);
  mk('path', { d: 'M48 0H0V48', fill: 'none', stroke: 'var(--grid)', 'stroke-width': 1 }, pat);
  mk('rect', { x: -3000, y: -3000, width: 7000, height: 7000, fill: 'var(--sea)' }, svg);
  mk('rect', { x: -3000, y: -3000, width: 7000, height: 7000, fill: 'url(#grid)' }, svg);
  for (const k of ['provs', 'borders', 'lanes', 'labels', 'hits', 'sel', 'routes', 'fx', 'armies']) L[k] = mk('g', {}, svg);
  MAP.provinces.forEach(p => {
    provEls[p.id] = mk('path', { d: p.d, class: 'prov', 'data-p': p.id }, L.provs);
  });
  MAP.borders.forEach((b, i) => { bdEls[i] = mk('path', { d: b.d, class: 'bd' }, L.borders); });
  L.stLines = mk('path', { d: MAP.stateLines, class: 'stl' }, L.borders);
  L.coast = mk('path', { d: MAP.coast, class: 'coast' }, L.borders);
  MAP.sea.forEach(([a, b]) => mk('line', { x1: PS[a].cx, y1: PS[a].cy, x2: PS[b].cx, y2: PS[b].cy, class: 'sealane' }, L.lanes));
  // state names when zoomed out, city names and dots when zoomed in
  MAP.states.forEach((st, i) => {
    const t = mk('text', { class: 'stlab', x: st.x, y: st.y }, L.labels);
    t.textContent = st.st;
    stLabEls[i] = t;
  });
  MAP.provinces.forEach(p => {
    cityEls[p.id] = mk('circle', { cx: p.px, cy: p.py, r: 1, class: 'city' }, L.labels);
    const t = mk('text', { class: 'lab', x: p.px, y: p.py }, L.labels);
    t.textContent = p.name;
    labEls[p.id] = t;
    if (p.area < 320) mk('circle', { cx: p.cx, cy: p.cy, r: 6, class: 'hit', 'data-p': p.id }, L.hits);
  });
  L.selOut = mk('path', { class: 'selout', d: '' }, L.sel);
  L.capDots = [];
  fillCache.length = 0; bdCache.length = 0;
}

// ------------------------------------------------------------ view / pan / zoom
function fitView() {
  UI.fit = Math.min(UI.W / MAP.w, UI.H / MAP.h) * 0.97;
  UI.view = { cx: MAP.w / 2, cy: MAP.h / 2, scale: UI.fit };
  applyView();
}
const LAB_ORDER = MAP.provinces.slice().sort((a, b) => PS[b.id].pop - PS[a.id].pop);
function applyView() {
  const v = UI.view;
  v.scale = clamp(v.scale, UI.fit * 0.85, UI.fit * 10);
  v.cx = clamp(v.cx, -80, MAP.w + 80); v.cy = clamp(v.cy, -60, MAP.h + 60);
  const w = UI.W / v.scale, h = UI.H / v.scale;
  svg.setAttribute('viewBox', `${(v.cx - w / 2).toFixed(2)} ${(v.cy - h / 2).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
  if (!labEls.length) return;
  const z = v.scale / UI.fit;
  UI.bk = (1 / v.scale) * clamp(1 + 0.14 * Math.log2(z), 0.92, 1.5);
  const fs = (9 / v.scale).toFixed(2), sw = (1.5 / v.scale).toFixed(2);
  // city names show once a province is big enough on screen to hold one
  const cities = z >= 1.7;
  // hide city names that would collide on screen, keeping the bigger cities
  if (cities && Math.abs(v.scale - UI.labScale) > v.scale * 0.02) {
    UI.labScale = v.scale;
    const placed = [], cw = 5.6 / v.scale, ch = 10 / v.scale;
    UI.labShow = new Set();
    for (const p of LAB_ORDER) {
      const w = p.name.length * cw, x0 = p.px - w / 2, y0 = p.py - 3.5 / v.scale - ch;
      if (placed.some(b => x0 < b[2] && x0 + w > b[0] && y0 < b[3] && y0 + ch > b[1])) continue;
      placed.push([x0, y0, x0 + w, y0 + ch]);
      UI.labShow.add(p.id);
    }
  }
  MAP.provinces.forEach(p => {
    const t = labEls[p.id], show = cities && UI.labShow && UI.labShow.has(p.id);
    t.style.display = show ? '' : 'none';
    cityEls[p.id].style.display = cities ? '' : 'none';
    if (!show && !cities) return;
    cityEls[p.id].setAttribute('r', (1.8 / v.scale).toFixed(2));
    t.setAttribute('font-size', fs);
    t.setAttribute('y', (p.py - 3.5 / v.scale).toFixed(2));
    t.setAttribute('stroke-width', sw);
  });
  const sfs = (10.5 / v.scale).toFixed(2);
  MAP.states.forEach((st, i) => {
    const t = stLabEls[i];
    t.style.display = cities ? 'none' : '';
    t.setAttribute('font-size', sfs);
    t.setAttribute('stroke-width', sw);
  });
  if (L.stLines) L.stLines.setAttribute('stroke-width', (1.1 / v.scale).toFixed(2));
}
function zoomAt(cx, cy, f) {
  const r = svg.getBoundingClientRect(), v = UI.view;
  const x = cx - r.left, y = cy - r.top;
  const mx = v.cx - UI.W / (2 * v.scale) + x / v.scale, my = v.cy - UI.H / (2 * v.scale) + y / v.scale;
  v.scale = clamp(v.scale * f, UI.fit * 0.85, UI.fit * 10);
  v.cx = mx - (x - UI.W / 2) / v.scale; v.cy = my - (y - UI.H / 2) / v.scale;
  applyView();
}
function focusOn(pid, zoom) {
  const d = PS[pid];
  UI.view.cx = d.cx; UI.view.cy = d.cy;
  if (zoom) UI.view.scale = Math.max(UI.view.scale, UI.fit * zoom);
  applyView();
}
function focusNation(id) {
  const ids = S.D.owned[id];
  if (!ids || !ids.length) return fitView();
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of ids) { const d = PS[p]; x0 = Math.min(x0, d.cx); x1 = Math.max(x1, d.cx); y0 = Math.min(y0, d.cy); y1 = Math.max(y1, d.cy); }
  UI.view.cx = (x0 + x1) / 2; UI.view.cy = (y0 + y1) / 2;
  UI.view.scale = clamp(Math.min(UI.W / (x1 - x0 + 170), UI.H / (y1 - y0 + 150)), UI.fit, UI.fit * 4);
  applyView();
}

const stage = $('#stage');
$('#sheet').addEventListener('pointerdown', () => { UI.touch = performance.now(); });
const pts = new Map();
let gesture = null, pinch = null;
stage.addEventListener('pointerdown', e => {
  if (e.target.closest('.mapctl')) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { stage.setPointerCapture(e.pointerId); } catch (_) {}
  if (pts.size === 1) {
    gesture = { moved: false, t: performance.now(), target: e.target, x: e.clientX, y: e.clientY };
    // pressing on one of your own armies starts a drag-to-move instead of a pan
    const b = UI.started && e.target.closest && e.target.closest('[data-a]'), ar = b && army(+b.dataset.a);
    if (ar && ar.owner === me() && !ar.strike) gesture.drag = ar.id;
  }
  if (pts.size === 2) {
    if (gesture) { gesture.moved = true; gesture.drag = null; UI.drag = null; }
    const [a, b] = [...pts.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }
});
stage.addEventListener('pointermove', e => {
  const p = pts.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pts.size === 1 && gesture) {
    if (!gesture.moved && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 7) gesture.moved = true;
    if (gesture.moved && gesture.drag) dragTo(gesture.drag, e.clientX, e.clientY);
    else if (gesture.moved) { UI.view.cx -= dx / UI.view.scale; UI.view.cy -= dy / UI.view.scale; applyView(); }
  } else if (pts.size === 2 && pinch) {
    const [a, b] = [...pts.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    UI.view.cx -= (cx - pinch.cx) / UI.view.scale; UI.view.cy -= (cy - pinch.cy) / UI.view.scale;
    if (pinch.d > 0) zoomAt(cx, cy, d / pinch.d);
    pinch = { d, cx, cy };
  }
});
function endPointer(e) {
  if (!pts.has(e.pointerId)) return;
  pts.delete(e.pointerId);
  if (pts.size === 0 && gesture) {
    const g = gesture; gesture = null; pinch = null;
    if (g.drag && g.moved) {
      const d = UI.drag; UI.drag = null;
      if (d && d.to != null && e.type === 'pointerup') { selectArmy(d.id); orderTo(d.to); }
      flush(); drawMap(performance.now());
    } else if (!g.moved && e.type === 'pointerup' && performance.now() - g.t < 700) { handleTap(g.target); flush(); drawMap(performance.now()); }
  }
  if (pts.size < 2) pinch = null;
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);
stage.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0016)); }, { passive: false });

// the province under a screen point, and the route an army would take there
function dragTo(id, x, y) {
  const a = army(id);
  if (!a) { UI.drag = null; return; }
  const el = document.elementFromPoint(x, y), hit = el && el.closest && (el.closest('[data-p]') || el.closest('[data-a]'));
  let to = null;
  if (hit && hit.dataset.p != null) to = +hit.dataset.p;
  else if (hit && hit.dataset.a != null) { const o = army(+hit.dataset.a); if (o) to = o.at != null ? o.at : o.mv.to; }
  if (UI.drag && UI.drag.id === id && UI.drag.to === to) return;
  const from = a.mv ? a.mv.to : a.at, dom = S.domOf(a);
  let route = null;
  if (to != null && to !== from) {
    if (dom === 'msl') route = S.missileOk(a, to).ok ? [to] : null;
    else route = S.findRoute(a.owner, from, to, S.armySpeed(a), dom);
  }
  UI.drag = { id, to: to === from ? null : to, route };
  drawMap(performance.now());
}

// ------------------------------------------------------------ selection and orders
function handleTap(t) {
  if (!UI.started) return;
  const a = t.closest && t.closest('[data-a]'), p = t.closest && t.closest('[data-p]');
  if (a) {
    const ar = army(+a.dataset.a);
    if (ar) {
      const loc = ar.at != null ? ar.at : ar.mv.to;
      if (ar.owner === me()) { selectArmy(ar.id); return; }
      if (UI.selA) { orderTo(loc); return; }
      selectProv(loc); return;
    }
  }
  if (p) { const pid = +p.dataset.p; if (UI.selA) orderTo(pid); else selectProv(pid); return; }
  UI.selA = null; UI.selP = null; UI.confirm = ''; dirty();
}
function selectProv(pid) { UI.selP = pid; UI.selA = null; UI.confirm = ''; if (UI.tab !== 'map') setTab('map'); dirty(); }
function selectArmy(id) {
  const a = army(id); if (!a) return;
  UI.selA = id; UI.selP = a.at != null ? a.at : a.mv.to; UI.confirm = '';
  if (UI.tab !== 'map') setTab('map');
  dirty();
}
function orderTo(pid) {
  const a = army(UI.selA);
  if (!a || a.owner !== me()) { UI.selA = null; selectProv(pid); return; }
  if (pid === a.at && !a.mv) { UI.selA = null; selectProv(pid); return; }
  // a missile strike cannot be called back, so it takes a second tap
  if (S.domOf(a) === 'msl' && a.at != null) {
    const ok = S.missileOk(a, pid);
    if (ok.ok && ok.strike && UI.confirm !== 'msl:' + pid) { UI.selP = pid; UI.confirm = 'msl:' + pid; toast('Tap ' + PS[pid].name + ' again to launch', 'info'); dirty(); return; }
  }
  const r = S.cmdMove(a.id, pid);
  toast(r.msg + (r.eta ? ` (ETA ${fmtDur(r.eta)})` : ''), r.ok ? 'ok' : 'bad');
  UI.selP = pid; UI.confirm = ''; dirty();
}

// ------------------------------------------------------------ movement geometry
// Troops cross between two provinces at the middle of their shared border (the longest stretch of it),
// not along the straight line between the two city anchors.
const CROSS = {};
{
  const best = {};
  for (const b of MAP.borders) {
    const nums = b.d.match(/-?[\d.]+/g).map(Number), pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const k = Math.min(b.a, b.b) + ':' + Math.max(b.a, b.b);
    if (best[k] && best[k] >= len) continue;
    best[k] = len;
    // the point halfway along the border
    let half = len / 2, mid = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (half <= l) { const t = l ? half / l : 0; mid = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; break; }
      half -= l;
    }
    CROSS[k] = mid;
  }
}
// the points a unit passes on one leg: from anchor, border crossing (land only), to anchor
function legPts(from, to, sea) {
  const A = [PS[from].cx, PS[from].cy], B = [PS[to].cx, PS[to].cy];
  const c = sea ? null : CROSS[Math.min(from, to) + ':' + Math.max(from, to)];
  // skip a crossing that would be a big detour (odd-shaped borders)
  if (c && Math.hypot(c[0] - A[0], c[1] - A[1]) + Math.hypot(B[0] - c[0], B[1] - c[1]) < 1.6 * Math.hypot(B[0] - A[0], B[1] - A[1]) + 4) return [A, c, B];
  return [A, B];
}
// position and heading a fraction k of the way along a polyline
function along(pts, k) {
  let tot = 0;
  const seg = [];
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); tot += l; }
  let d = clamp(k, 0, 1) * tot;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? Math.min(1, d / seg[i]) : 0, a = pts[i], b = pts[i + 1];
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI };
    }
    d -= seg[i];
  }
  return { x: pts[0][0], y: pts[0][1], ang: 0 };
}
// the whole polyline of a route: from a start point through each leg
function routePts(a, start, list) {
  const sea = S.domOf(a) === 'sea', msl = S.domOf(a) === 'msl', out = [start.pt];
  let cur = start.pid;
  for (const r of list) {
    const lp = msl ? [null, [PS[r].cx, PS[r].cy]] : legPts(cur, r, sea);
    for (let i = 1; i < lp.length; i++) out.push(lp[i]);
    cur = r;
  }
  return out;
}

// ------------------------------------------------------------ map drawing (per frame)
// NATO-style symbol for what an army mostly is (drawn left of the count)
const SYM = {
  inf: 'M-14 -4.5H-4V4.5H-14ZM-14 -4.5L-4 4.5M-4 -4.5L-14 4.5',
  mech: 'M-14 -4.5H-4V4.5H-14ZM-14 -4.5L-4 4.5M-4 -4.5L-14 4.5M-12 0a3 2.4 0 1 0 6 0a3 2.4 0 1 0 -6 0',
  arm: 'M-14 -4.5H-4V4.5H-14ZM-12 0a3 2.4 0 1 0 6 0a3 2.4 0 1 0 -6 0',
  art: 'M-14 -4.5H-4V4.5H-14ZM-10.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0',
  air: 'M-14 -4.5H-4V4.5H-14ZM-13 1.5Q-11 -2.5 -9 1.5Q-7 -2.5 -5 1.5',
  sea: 'M-9 -3.5V3M-11.5 -1.5H-6.5M-12 0.5Q-9 5 -6 0.5',
  msl: 'M-14 0H-5M-7.5 -2.5L-5 0L-7.5 2.5',
};
function symOf(a) {
  const dom = S.domOf(a);
  if (dom !== 'land') return dom;
  const w = { inf: 0, veh: 0, art: 0, air: 0, mech: 0 };
  for (const t of UT) if (a.u[t] > 0) { const c = UNITS[t].cls; const k = t === 'mech' ? 'mech' : c === 'heli' ? 'air' : c; if (w[k] !== undefined) w[k] += a.u[t] * UNITS[t].atk * UNITS[t].hp; }
  let best = 'inf', bv = -1;
  for (const k in w) if (w[k] > bv) { bv = w[k]; best = k; }
  return best === 'veh' ? 'arm' : best;
}
function makeBadge(a) {
  const n = nat(a.owner);
  const dom = S.domOf(a);
  const g = mk('g', { class: 'bdg', 'data-a': a.id }, L.armies);
  // armies are tags, fleets are hulls, missile salvos are pills
  if (dom === 'sea') mk('path', { class: 'hull', d: 'M-17 -6.5H17L13 6.5H-13Z', fill: n.color }, g);
  else mk('rect', { x: -16, y: -6.5, width: 32, height: 13, rx: dom === 'msl' ? 6.5 : 2, fill: n.color }, g);
  const sy = mk('path', { class: 'sym', d: '' }, g);
  const t = mk('text', { x: 5, y: 3.3 }, g);
  const d = mk('path', { class: 'dir', d: 'M0 -4L7 0L0 4Z', display: 'none' }, g);
  return { g, t, d, sy, sym: '', last: '' };
}
function drawMap(now) {
  const g = G(), bk = UI.bk;
  for (const p of g.provs) {
    const c = g.nations[p.owner].color;
    if (fillCache[p.id] !== c) { provEls[p.id].style.fill = c; fillCache[p.id] = c; }
  }
  MAP.borders.forEach((b, i) => {
    const diff = g.provs[b.a].owner !== g.provs[b.b].owner;
    if (bdCache[i] !== diff) { bdEls[i].setAttribute('class', diff ? 'bd nat' : 'bd'); bdCache[i] = diff; }
  });
  // capital rings
  const caps = g.nations.filter(n => n.alive).map(n => n.capital);
  while (L.capDots.length < caps.length) L.capDots.push(mk('circle', { class: 'capdot' }, L.labels));
  L.capDots.forEach((c, i) => {
    if (i >= caps.length) { c.style.display = 'none'; return; }
    c.style.display = '';
    const d = PS[caps[i]];
    c.setAttribute('cx', (d.cx - 11 * bk).toFixed(2)); c.setAttribute('cy', (d.cy - 4.5 * bk).toFixed(2)); c.setAttribute('r', (3 * bk).toFixed(2));
    c.setAttribute('stroke-width', (1.4 * bk).toFixed(2));
  });
  L.selOut.setAttribute('d', UI.selP != null ? MAP.provinces[UI.selP].d : '');
  L.selOut.setAttribute('stroke-width', (2.4 * Math.min(1.6, bk * UI.view.scale) / UI.view.scale).toFixed(2));

  // armies
  const groups = {};
  for (const a of g.armies) if (a.at != null) (groups[a.at] = groups[a.at] || []).push(a);
  const live = new Set();
  for (const a of g.armies) {
    live.add(a.id);
    let e = badges.get(a.id);
    if (!e) { e = makeBadge(a); badges.set(a.id, e); }
    let x, y, ang = null;
    if (a.at != null) {
      const grp = groups[a.at], i = grp.indexOf(a), n = grp.length, per = 3;
      const row = Math.floor(i / per), col = i % per, inRow = Math.min(per, n - row * per);
      x = PS[a.at].cx + (col - (inRow - 1) / 2) * 35 * bk;
      y = PS[a.at].cy + (9 + row * 15) * bk;
    } else {
      const k = a.mv.dur ? a.mv.t / a.mv.dur : 0;
      const pos = along(S.domOf(a) === 'msl' ? [[PS[a.mv.from].cx, PS[a.mv.from].cy], [PS[a.mv.to].cx, PS[a.mv.to].cy]] : legPts(a.mv.from, a.mv.to, S.domOf(a) === 'sea'), k);
      x = pos.x; y = pos.y + 9 * bk; ang = pos.ang;
    }
    const sym = symOf(a);
    if (e.sym !== sym) { e.sy.setAttribute('d', SYM[sym]); e.sym = sym; }
    e.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${bk.toFixed(4)})`);
    const txt = String(Math.max(1, Math.round(S.unitCount(a.u))));
    if (e.last !== txt) { e.t.textContent = txt; e.last = txt; }
    const cls = 'bdg' + (a.id === UI.selA ? ' sel' : '') + (a.owner !== me() ? ' foe' : '') + (a.strike ? ' strike' : '');
    if (e.g.getAttribute('class') !== cls) e.g.setAttribute('class', cls);
    if (ang === null) e.d.setAttribute('display', 'none');
    else { e.d.setAttribute('display', ''); e.d.setAttribute('transform', `translate(16 0) rotate(${ang.toFixed(0)}) translate(-1 0)`); }
  }
  for (const [id, e] of badges) if (!live.has(id)) { e.g.remove(); badges.delete(id); }

  // battles, sieges
  L.fx.textContent = '';
  const pulse = 1 + 0.18 * Math.sin(now / 160);
  for (const p of g.provs) {
    const d = PS[p.id];
    if (p.battle) {
      mk('circle', { cx: d.cx, cy: d.cy + 2 * bk, r: (13 * pulse * bk).toFixed(2), class: 'fxr', stroke: 'var(--warn)', 'stroke-width': (2 * bk).toFixed(2) }, L.fx);
      const s = 5 * bk, cx = d.cx, cy = d.cy + 2 * bk;
      mk('path', { d: `M${cx - s} ${cy - s}L${cx + s} ${cy + s}M${cx + s} ${cy - s}L${cx - s} ${cy + s}`, class: 'fxr', stroke: 'var(--warn)', 'stroke-width': (2 * bk).toFixed(2) }, L.fx);
    }
    if (p.cap) {
      const r = 11 * bk, c = 2 * Math.PI * r;
      mk('circle', { cx: d.cx, cy: d.cy + 2 * bk, r: r.toFixed(2), class: 'fxr', stroke: g.nations[p.cap.by].color, 'stroke-width': (3.2 * bk).toFixed(2), 'stroke-dasharray': `${(c * clamp(p.cap.p, 0, 1)).toFixed(1)} ${c.toFixed(1)}`, transform: `rotate(-90 ${d.cx} ${d.cy + 2 * bk})` }, L.fx);
    }
  }
  // routes, and the reach of a selected missile salvo
  L.routes.textContent = '';
  const sa = UI.selA && army(UI.selA);
  if (sa && sa.at != null && S.domOf(sa) === 'msl') mk('circle', { cx: PS[sa.at].cx, cy: PS[sa.at].cy, r: S.MSL_RANGE, class: 'route faint', fill: 'none', 'stroke-width': (1.2 / UI.view.scale).toFixed(2), 'stroke-dasharray': `${(5 / UI.view.scale).toFixed(1)} ${(4 / UI.view.scale).toFixed(1)}` }, L.routes);
  const dash = `${(5 / UI.view.scale).toFixed(1)} ${(4 / UI.view.scale).toFixed(1)}`;
  const line = (pts, cls, w) => mk('path', { d: 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L'), class: cls, 'stroke-width': (w / UI.view.scale).toFixed(2), 'stroke-dasharray': dash }, L.routes);
  for (const a of g.armies) {
    if (a.owner !== me() || (!a.route.length && !a.mv)) continue;
    const sel = a.id === UI.selA;
    if (!sel && !a.mv) continue;
    let start;
    if (a.mv) {
      const k = a.mv.dur ? a.mv.t / a.mv.dur : 0, leg = S.domOf(a) === 'msl' ? [[PS[a.mv.from].cx, PS[a.mv.from].cy], [PS[a.mv.to].cx, PS[a.mv.to].cy]] : legPts(a.mv.from, a.mv.to, S.domOf(a) === 'sea');
      const p = along(leg, k);
      // the rest of the current leg, then the queued legs
      const pts = [[p.x, p.y]];
      let acc = 0; const segs = [];
      for (let i = 1; i < leg.length; i++) { const l = Math.hypot(leg[i][0] - leg[i - 1][0], leg[i][1] - leg[i - 1][1]); segs.push(l); acc += l; }
      let dd = k * acc;
      for (let i = 0; i < segs.length; i++) { if (dd < segs[i]) { for (let j = i + 1; j < leg.length; j++) pts.push(leg[j]); break; } dd -= segs[i]; }
      if (pts.length === 1) pts.push(leg[leg.length - 1]);
      start = { pid: a.mv.to, pt: pts[pts.length - 1] };
      const tail = routePts(a, start, a.route);
      line(pts.concat(tail.slice(1)), 'route' + (sel ? '' : ' faint'), sel ? 1.9 : 1.2);
    } else line(routePts(a, { pid: a.at, pt: [PS[a.at].cx, PS[a.at].cy] }, a.route), 'route' + (sel ? '' : ' faint'), sel ? 1.9 : 1.2);
  }
  // drag-to-move preview
  if (UI.drag && UI.drag.to != null) {
    const a = army(UI.drag.id);
    if (a) {
      const from = a.mv ? a.mv.to : a.at;
      if (UI.drag.route) line(routePts(a, { pid: from, pt: [PS[from].cx, PS[from].cy] }, UI.drag.route), 'route drag', 2.4);
      const d = PS[UI.drag.to];
      mk('circle', { cx: d.cx, cy: d.cy, r: (7 / UI.view.scale).toFixed(2), class: 'route drag' + (UI.drag.route ? '' : ' bad'), fill: 'none', 'stroke-width': (2.2 / UI.view.scale).toFixed(2) }, L.routes);
      const eta = UI.drag.route ? (a.mv ? a.mv.dur - a.mv.t : 0) + S.routeTime(a, UI.drag.route, from) : null;
      const lab = mk('text', { x: d.cx, y: (d.cy - 11 / UI.view.scale).toFixed(2), class: 'dragEta', 'font-size': (12 / UI.view.scale).toFixed(2), 'stroke-width': (3 / UI.view.scale).toFixed(2) }, L.routes);
      lab.textContent = eta == null ? 'No route' : PS[UI.drag.to].name + ' \u00b7 ' + fmtDur(eta);
    }
  }
}

// ------------------------------------------------------------ toasts
function toast(msg, kind) {
  const box = $('#toasts');
  const d = document.createElement('div');
  d.className = 'toast ' + (kind || 'info');
  d.textContent = msg;
  box.appendChild(d);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => d.remove(), 5200);
}

// ------------------------------------------------------------ panel html
const KIND = { land: 'Army', sea: 'Fleet', msl: 'Missiles' };
const HINT = {
  land: 'Waiting for orders. Tap a province on the map to march.',
  sea: 'Fleets sail along the coast. Tap a coastal province to sail there; at war they sink ships and shell ports, but only troops can take a province.',
  msl: 'Tap an enemy province inside the dashed ring to strike it, or one of your own to move the salvo. Missiles hit once and are spent.',
};
const fmtU = u => UT.filter(t => u[t] >= 0.5).map(t => `${Math.round(u[t])} ${UNITS[t].s}`).join(' \u00b7 ') || 'no units';
const dotOf = n => `<i class="dot" style="background:${n.color}"></i>`;
const costStr = c => S.RES.filter(k => c[k]).map(k => k === 'cash' ? '$' + c[k] : c[k] + ' ' + S.RESN[k].s.toLowerCase()).join(' \u00b7 ');
const BLD = S.BLD, BK = S.BK;
const pname = pid => PS[pid].name;
const f1 = x => (Math.round(x * 10) / 10).toFixed(1);
const f2 = x => (x >= 1 ? f1(x) : (Math.round(x * 100) / 100).toFixed(2));
const sgn = x => (x >= 0 ? '+' : '') + f1(x);
function statusTags(a, b) {
  let h = '';
  if (S.atWar(a, b)) h += '<span class="tag war">War</span> ';
  if (S.allied(a, b)) h += '<span class="tag good">Ally</span> ';
  if (S.hasTreaty(a, b, 'trade')) h += '<span class="tag">Trade</span> ';
  if (S.hasTreaty(a, b, 'nap')) h += '<span class="tag">Pact</span> ';
  if (S.hasTreaty(a, b, 'access') && !S.allied(a, b)) h += '<span class="tag">Passage</span> ';
  const tl = S.truceLeft(a, b);
  if (tl > 0) h += `<span class="tag hot">Truce ${fmtDur(tl)}</span> `;
  return h;
}
function etaOf(a) {
  if (a.mv) return Math.max(0, a.mv.dur - a.mv.t) + S.routeTime(a, a.route, a.mv.to);
  return S.routeTime(a, a.route, a.at);
}

function provCard(pid) {
  const g = G(), p = g.provs[pid], d = PS[pid], o = nat(p.owner), m = me(), mine = p.owner === m;
  const r = S.provRates(pid), n = nat(m >= 0 ? m : 0);
  let h = `<div class="hd">${dotOf(o)}<h3>${d.name}</h3><small>${d.stName}</small>`;
  if (o.capital === pid) h += '<span class="tag hot">Capital</span>';
  if (d.coast) h += '<span class="tag">Coast</span>';
  if (p.battle) h += '<span class="tag war">Battle</span>';
  if (p.cap) h += '<span class="tag war">Occupied</span>';
  h += '</div>';
  h += `<div class="note">${mine ? 'Yours' : o.name}${!mine && m >= 0 ? ' &middot; ' + statusTags(m, p.owner) : ''}</div>`;
  h += `<div class="kvs">
    <div class="kv"><span>Population</span><b>${f1(d.pop)} M</b></div>
    <div class="kv"><span>Resource</span><b>${S.RESN[d.res].n}</b></div>
    <div class="kv"><span>Garrison</span><b data-bind="g:${pid}">${f1(p.garrison)}/${f1(S.maxGar(p))}</b></div>
    <div class="kv"><span>Defence</span><b>+${Math.round(S.defBonus(p) * 100)}%</b></div>
    <div class="kv"><span>Capture time</span><b>${fmtDur(S.captureTime(p))}</b></div>
    <div class="kv"><span>Unrest</span><b data-bind="un:${pid}">${Math.round(p.unrest * 100)}%</b><div class="bar ${p.unrest > 0.6 ? 'warn' : ''}"><i data-bar="un:${pid}" style="width:${Math.round(p.unrest * 100)}%"></i></div></div>
  </div>
  <div class="note">Makes per second: ${S.RES.filter(k => r[k] >= 0.005).map(k => `${f2(r[k])} ${S.RESN[k].n.toLowerCase()}`).join(', ')}${r.rp >= 0.005 ? `, ${f2(r.rp)} research` : ''}.</div>`;
  if (mine) {
    h += '<h4>Recruit here</h4>';
    for (const cat of S.CATS) {
      const list = UT.filter(t => UNITS[t].cat === cat && (UNITS[t].dom !== 'sea' || d.coast));
      if (!list.length) continue;
      h += `<div class="cat">${cat}</div><div class="btns">`;
      for (const t of list) {
        const c = S.unitCost(t), U = UNITS[t];
        if (!S.canTrain(p, t)) { h += `<button class="btn dim" disabled title="${U.d}">${U.n}<small>${S.needText(p, t)}</small></button>`; continue; }
        const ok = S.canPay(n, c);
        h += `<button class="btn ${ok ? '' : 'dim'}" data-act="recruit" data-p="${pid}" data-t="${t}" title="${U.d}">${U.n}<small>${costStr(c)} &middot; ${fmtDur(S.trainTime(p, t))}</small><small class="ef">Atk ${U.atk} &middot; HP ${U.hp} &middot; Spd ${U.spd}. ${U.d}</small></button>`;
      }
      h += '</div>';
    }
    if (p.q.length) h += `<div class="note">Training: ${p.q.map((it, i) => `${UNITS[it.type].s} <span class="mono" data-bind="q:${pid}:${i}">${fmtDur(it.left)}</span>`).join(' &rarr; ')}</div>`;
    h += '<h4>City buildings</h4>';
    if (p.bq.length) {
      h += `<div class="row" style="cursor:default"><div class="grow"><div class="nm">Constructing: ${p.bq.map((b, i) => `${BLD[b.k].n} <span class="mono" data-bind="bq:${pid}:${i}">${fmtDur(b.left)}</span>`).join(' &rarr; ')}</div>${p.cap || p.battle ? '<div class="sub">Paused while under attack</div>' : ''}<div class="bar"><i data-bar="bq:${pid}" style="width:${Math.round(100 * (1 - p.bq[0].left / p.bq[0].total))}%"></i></div></div><button class="btn" data-act="cancelbuild" data-p="${pid}">Cancel last</button></div>`;
    }
    h += '<div class="blds">';
    for (const k of BK) {
      const B = BLD[k], lvl = p.b[k], plan = S.plannedLvl(p, k), max = S.maxLvl(k);
      if (B.coast && !d.coast) continue;
      const pips = `<span class="pips">${'<i class="on"></i>'.repeat(lvl)}${'<i class="q"></i>'.repeat(plan - lvl)}${'<i></i>'.repeat(max - plan)}</span>`;
      if (plan >= max) { h += `<button class="btn bld dim" disabled><span class="bn">${B.n}${pips}</span><small>${lvl >= max ? 'Maximum level' : 'Maximum level queued'}</small><small class="ef">${B.d}</small></button>`; continue; }
      const c = S.buildCost(k, plan), ok = S.canPay(n, c) && p.bq.length < 3;
      h += `<button class="btn bld ${ok ? '' : 'dim'}" data-act="build" data-p="${pid}" data-k="${k}"><span class="bn">${B.n}${pips}</span><small>${plan ? 'To level ' + (plan + 1) : 'Build'} &middot; ${costStr(c)} &middot; ${fmtDur(S.buildTime(k, plan, m))}</small><small class="ef">${B.d}</small></button>`;
    }
    h += '</div>';
  } else {
    const have = BK.filter(k => p.b[k] > 0).map(k => `${BLD[k].n} ${p.b[k]}`);
    h += `<div class="note">Buildings: ${have.length ? have.join(', ') : 'none'}.</div>`;
    if (m >= 0) h += `<div class="btns"><button class="btn" data-act="dipopen" data-n="${p.owner}">Diplomacy with ${o.short}</button></div>`;
  }
  const here = g.armies.filter(a => a.at === pid);
  if (here.length) {
    h += '<h4>Armies here</h4>';
    for (const a of here) {
      const an = nat(a.owner);
      h += `<div class="row" tabindex="0" data-act="selarmy" data-a="${a.id}">${dotOf(an)}<div class="grow"><div class="nm">${an.short} ${KIND[S.domOf(a)].toLowerCase()}</div><div class="sub">${fmtU(a.u)}</div></div>${a.owner === m ? '<span class="tag">Select</span>' : ''}</div>`;
    }
  }
  return h;
}

// what an army is made of and how it fights: per-unit numbers with research applied, totals, matchups
const CLSN = { inf: 'infantry', veh: 'vehicles', art: 'artillery', air: 'aircraft', heli: 'helicopters', ship: 'ships', sub: 'submarines', msl: 'missiles' };
function armyStats(a) {
  const g = G(), m = S.modsOf(a.owner), dom = S.domOf(a);
  const types = UT.filter(t => a.u[t] >= 0.05);
  let fire = 0, tough = 0, n = 0;
  let h = '<table class="utab"><tr><th>Unit</th><th>No.</th><th>Atk</th><th>HP</th><th>Spd</th></tr>';
  for (const t of types) {
    const U = UNITS[t], atk = U.atk * m.atk[U.cat], hp = U.hp * m.hp[U.cat];
    fire += a.u[t] * atk; tough += a.u[t] * hp; n += a.u[t];
    h += `<tr title="${U.d}"><td>${U.n}</td><td class="mono" data-bind="ac:${a.id}:${t}">${f1(a.u[t])}</td><td class="mono">${f1(atk)}</td><td class="mono">${Math.round(hp)}</td><td class="mono">${U.spd}</td></tr>`;
  }
  h += '</table>';
  const here = a.at != null ? g.provs[a.at] : null;
  const friendly = here && (here.owner === a.owner || S.allied(a.owner, here.owner));
  const def = friendly && dom !== 'msl' ? S.defBonus(here) + S.entrench(a, here) : 0;
  h += `<div class="kvs">
    <div class="kv"><span>Firepower</span><b>${Math.round(fire)}</b></div>
    <div class="kv"><span>Toughness</span><b>${Math.round(tough)}</b></div>
    <div class="kv"><span>Speed</span><b>${S.armySpeed(a)}</b></div>
    <div class="kv"><span>Defence here</span><b>${here ? (def ? '+' + Math.round(def * 100) + '%' : 'none') : '-'}</b></div>
    ${here && friendly && dom !== 'msl' ? `<div class="kv"><span>Dug in</span><b>+${Math.round(S.entrench(a, here) * 100)}%</b></div>` : ''}
    <div class="kv"><span>Upkeep / s</span><b>${f2(types.reduce((s, t) => s + a.u[t] * UNITS[t].upk, 0))}</b></div>
  </div>`;
  // matchups: which enemy classes this force hits hard or barely scratches, and which hurt it most
  if (n > 0 && dom !== 'msl') {
    const good = [], poor = [], fear = [];
    for (const c in CLSN) {
      let w = 0, sum = 0, hit = 0, tw = 0;
      const rep = UT.find(t => UNITS[t].cls === c);
      for (const t of types) {
        const U = UNITS[t];
        sum += a.u[t] * U.atk; w += a.u[t] * U.atk * S.MULT[t][rep];
        tw += a.u[t] * S.TW[t]; hit += a.u[t] * S.TW[t] * S.CM[c][U.cls];
      }
      const r = sum ? w / sum : 0, f = tw ? hit / tw : 0;
      if (c === 'msl') continue;
      if (r >= 1.25) good.push(CLSN[c]); else if (r <= 0.35) poor.push(CLSN[c]);
      if (f >= 1.3) fear.push(CLSN[c]);
    }
    if (good.length) h += `<div class="note">Strong against ${good.join(', ')}.</div>`;
    if (poor.length) h += `<div class="note">Can barely hurt ${poor.join(', ')}.</div>`;
    if (fear.length) h += `<div class="note down">Vulnerable to ${fear.join(', ')}.</div>`;
  }
  return h;
}
function armyCard(a) {
  const g = G(), n = nat(a.owner), here = a.at != null ? a.at : a.mv.to;
  const tot = S.unitCount(a.u) || 1;
  const dom = S.domOf(a);
  let h = `<div class="hd">${dotOf(n)}<h3>${KIND[dom]} ${a.id}</h3><small>${a.at != null ? 'at ' + pname(a.at) : 'to ' + pname(a.mv.to)}</small></div>`;
  h += armyStats(a);
  if (a.mv || a.route.length) h += `<div class="note">${a.strike ? 'Missiles in flight' : dom === 'sea' ? 'Under way' : 'Marching'} &middot; ETA <b class="mono" data-bind="eta:${a.id}">${fmtDur(etaOf(a))}</b></div>`;
  else if (g.provs[here].battle) h += '<div class="note down">Engaged in battle.</div>';
  else h += `<div class="note">${HINT[dom]}</div>`;
  if (dom === 'msl' && UI.selP != null && UI.selP !== here && a.at != null) {
    const r = S.missileOk(a, UI.selP);
    h += `<h4>Target: ${PS[UI.selP].name}</h4><div class="note ${r.ok ? '' : 'down'}">${r.ok ? (r.strike ? 'In range. Tap the province again to launch.' : 'In range. The salvo will move there.') : r.msg + '.'}</div>`;
  } else if (dom === 'sea' && UI.selP != null && UI.selP !== here && !PS[UI.selP].coast) {
    h += `<h4>Target: ${PS[UI.selP].name}</h4><div class="note down">Inland. Fleets can only sail to coastal provinces.</div>`;
  } else if (UI.selP != null && UI.selP !== here) {
    const tp = g.provs[UI.selP], to = nat(tp.owner);
    h += `<h4>Target: ${PS[UI.selP].name}</h4>`;
    if (tp.owner === a.owner) h += '<div class="note">Friendly territory.</div>';
    else if (S.atWar(a.owner, tp.owner)) {
      const pr = S.predictAttack(a.owner, a.u, UI.selP);
      const txt = pr.win ? (pr.keep > 0.7 ? 'Strong advantage' : pr.keep > 0.4 ? 'Likely win, with losses' : 'Narrow win, heavy losses') : (pr.defLeft < 0.5 ? 'Close fight, probably a loss' : 'Likely defeat');
      h += `<div class="note">At war with ${to.short}. Estimated outcome: <b class="${pr.win ? 'up' : 'down'}">${txt}</b>. Garrison ${f1(tp.garrison)}.</div>`;
    } else if (S.hasAccess(a.owner, tp.owner)) h += `<div class="note">${to.short} allows your troops to pass.</div>`;
    else {
      const key = 'war:' + tp.owner, armed = UI.confirm === key;
      const tr = S.hasTreaty(a.owner, tp.owner, 'nap') || S.allied(a.owner, tp.owner);
      h += `<div class="note">At peace with ${to.short}: your troops cannot enter without passage rights.</div><div class="btns"><button class="btn warn" data-act="${armed ? 'war' : 'arm'}" data-n="${tp.owner}" data-k="${key}">${armed ? 'Confirm: declare war' + (tr ? ' (breaks a treaty)' : '') : 'Declare war on ' + to.short}</button></div>`;
    }
  }
  h += '<h4>Orders</h4><div class="btns">';
  if (a.mv || a.route.length) h += `<button class="btn" data-act="stop" data-a="${a.id}">Halt</button>`;
  if (a.at != null) {
    h += `<button class="btn" data-act="split" data-a="${a.id}" data-k="half">Split &frac12;</button><button class="btn" data-act="split" data-a="${a.id}" data-k="quarter">Split &frac14;</button>`;
    const types = UT.filter(t => a.u[t] >= 0.5);
    if (types.length > 1) for (const t of types) h += `<button class="btn" data-act="split" data-a="${a.id}" data-k="${t}">Detach ${UNITS[t].s}</button>`;
    if (g.armies.filter(x => x.owner === a.owner && x.at === a.at && !x.mv && !x.strike && S.domOf(x) === dom).length > 1) h += `<button class="btn" data-act="merge" data-p="${a.at}" data-k="${dom}">Merge all ${dom === 'sea' ? 'fleets' : dom === 'msl' ? 'salvos' : 'armies'} here</button>`;
  }
  h += `<button class="btn" data-act="selprov" data-p="${here}">Province</button><button class="btn warn" data-act="disband" data-a="${a.id}">Disband</button></div>`;
  return h;
}

function mapPanel() {
  const g = G();
  if (UI.selA) { const a = army(UI.selA); if (a) return armyCard(a); UI.selA = null; }
  if (UI.selP != null) return provCard(UI.selP);
  return `<div class="hd"><h3>Orders</h3></div>
  <p class="note">Drag an army badge onto a province to send it there (or tap the badge, then the province). Tap any province for details, recruiting and city buildings. Pinch or scroll to zoom; city names appear as you zoom in.</p>
  <div class="btns"><button class="btn" data-act="homefocus">Go to my capital</button></div>`;
}

function forcesPanel() {
  const g = G(), m = me(); if (m < 0) return '<p class="note">Observing.</p>';
  const mine = g.armies.filter(a => a.owner === m).sort((a, b) => S.unitPow(b.u) - S.unitPow(a.u));
  const n = nat(m), tot = {};
  for (const t of UT) tot[t] = 0;
  for (const a of mine) for (const t of UT) tot[t] += a.u[t];
  let h = '<h4>Total forces</h4>';
  for (const cat of S.CATS) {
    const list = UT.filter(t => UNITS[t].cat === cat && tot[t] >= 0.5);
    if (list.length) h += `<div class="cat">${cat}</div><div class="kvs">${list.map(t => `<div class="kv"><span>${UNITS[t].n}</span><b>${Math.round(tot[t])}</b></div>`).join('')}</div>`;
  }
  h += `<div class="kvs"><div class="kv"><span>Upkeep / s</span><b>${f1(n.rate.up)}</b></div></div>`;
  h += '<h4>Armies</h4>';
  if (!mine.length) h += '<p class="note">No armies. Recruit units in one of your provinces.</p>';
  for (const a of mine) {
    const st = a.mv ? `${a.strike ? 'striking' : 'heading to'} ${pname(a.mv.to)}` : (g.provs[a.at].battle ? 'in battle' : 'at ' + pname(a.at));
    h += `<div class="row" tabindex="0" data-act="selarmy" data-a="${a.id}"><div class="grow"><div class="nm">${KIND[S.domOf(a)]} ${a.id} <span class="sub">${st}</span></div><div class="sub">${fmtU(a.u)}</div></div></div>`;
  }
  const q = g.provs.filter(p => p.owner === m && p.q.length);
  h += '<h4>Training</h4>';
  if (!q.length) h += '<p class="note">Nothing in training.</p>';
  for (const p of q) h += `<div class="row" tabindex="0" data-act="selprov" data-p="${p.id}"><div class="grow"><div class="nm">${PS[p.id].name}</div><div class="sub">${p.q.map(it => UNITS[it.type].s).join(' &rarr; ')}</div></div><span class="num" data-bind="q:${p.id}:0">${fmtDur(p.q[0].left)}</span></div>`;
  return h;
}

// seconds until the current research project is done: stock pours in fast, then the income trickles in
function researchEta(n) {
  if (!n.rs) return 0;
  const rem = n.rs.need - n.rs.got, pr = S.pourRate(n), inc = Math.max(0.001, n.rate.rp);
  if (n.rp >= rem) return rem / pr;
  // the stock runs out first, then it goes at the income rate
  const tStock = n.rp / Math.max(0.001, pr - inc);
  const done = Math.min(rem, tStock * pr);
  return tStock + (rem - done) / inc;
}
function techPanel() {
  const m = me(); if (m < 0) return '<p class="note">Observing.</p>';
  const n = nat(m), T = S.TECH;
  let h = `<div class="hd"><h3>Research</h3><small>${Object.keys(n.tech).length} of ${S.TK.length} done</small></div>`;
  h += `<div class="kvs"><div class="kv"><span>Research points</span><b data-bind="rp">${Math.floor(n.rp)}</b></div><div class="kv"><span>Per second</span><b>${f2(n.rate.rp)}</b></div></div>`;
  if (n.rs) {
    const k = n.rs.k;
    h += `<div class="row" style="cursor:default"><div class="grow"><div class="nm">Researching ${T[k].n} <span class="mono" data-bind="rse">${fmtDur(researchEta(n))}</span></div><div class="sub">${T[k].d}</div><div class="bar"><i data-bar="rs" style="width:${Math.round(100 * n.rs.got / n.rs.need)}%"></i></div></div><button class="btn" data-act="cancelresearch">Cancel</button></div>`;
  } else h += '<p class="note">Nothing being researched. Pick a project below; your research points pour into it until it is done. Research labs make more points.</p>';
  for (const br of S.BRANCHES) {
    h += `<div class="cat">${br}</div><div class="btns">`;
    for (const k of S.TK.filter(k => T[k].br === br)) {
      const t = T[k], done = !!n.tech[k], open = S.techOpen(n, k), cur = n.rs && n.rs.k === k;
      const sub = done ? 'Done' : cur ? 'In progress' : !open ? 'Needs ' + t.req.filter(r => !n.tech[r]).map(r => T[r].n).join(', ') : `${S.techCost(k)} points \u00b7 tier ${t.tier}`;
      const act = !done && open && !cur && !n.rs;
      h += `<button class="btn tech ${done ? 'done' : act ? '' : 'dim'}" ${act ? `data-act="research" data-k="${k}"` : 'disabled'}><span class="bn">${done ? '\u2713 ' : ''}${t.n}</span><small>${sub}</small><small class="ef">${t.d}</small></button>`;
    }
    h += '</div>';
  }
  return h;
}

function dipDetail(o) {
  const m = me(), g = G(), their = S.opinion(o.id, m), mine = S.opinion(m, o.id);
  let h = `<div style="padding:8px 0 4px;border-bottom:1px solid var(--line)">`;
  h += `<div class="note"><b>${S.PERS[o.pers].label}</b> temperament &middot; their view of you <b class="mono ${their.total >= 0 ? 'up' : 'down'}">${their.total >= 0 ? '+' : ''}${their.total}</b></div>`;
  for (const [t, v] of their.parts.slice(0, 6)) h += `<div class="part"><span>${t}</span><b class="${v >= 0 ? 'up' : 'down'}">${v > 0 ? '+' : ''}${v}</b></div>`;
  if (UI.dipMsg) h += `<div class="msg">${UI.dipMsg}</div>`;
  const btn = (act, label, extra, cls) => `<button class="btn ${cls || ''}" data-act="dip" data-v="${act}" data-n="${o.id}" ${extra || ''}>${label}</button>`;
  h += '<div class="btns">';
  if (S.atWar(m, o.id)) h += btn('ceasefire', 'Ask for ceasefire');
  else {
    if (!S.hasTreaty(m, o.id, 'trade')) h += btn('trade', 'Trade pact<small>+7% cash for both</small>');
    if (!S.hasTreaty(m, o.id, 'nap') && !S.allied(m, o.id)) h += btn('nap', `Non-aggression pact<small>${fmtDur(360)}</small>`);
    if (!S.hasAccess(m, o.id)) h += btn('access', `Passage rights<small>${fmtDur(360)}, troops may cross</small>`);
    if (!S.allied(m, o.id)) h += btn('alliance', 'Alliance<small>shared wars</small>');
    h += btn('gift', 'Gift $100<small>improves relations</small>', 'data-x="100"');
    h += btn('tribute', 'Demand tribute<small>works only if they fear you</small>', '', 'warn');
    const key = 'war:' + o.id, armed = UI.confirm === key;
    const tr = S.hasTreaty(m, o.id, 'nap') || S.allied(m, o.id);
    h += `<button class="btn warn" data-act="${armed ? 'war' : 'arm'}" data-n="${o.id}" data-k="${key}">${armed ? 'Confirm war' + (tr ? ' (breaks treaty)' : '') : 'Declare war'}</button>`;
  }
  h += '</div>';
  const cancels = [['trade', 'trade pact'], ['nap', 'pact'], ['access', 'passage'], ['alliance', 'alliance']].filter(([k]) => S.hasTreaty(m, o.id, k));
  if (cancels.length) h += `<div class="btns">${cancels.map(([k, l]) => `<button class="btn" data-act="dip" data-v="break" data-n="${o.id}" data-x="${k}"><small style="margin:0;color:inherit">Cancel ${l}</small></button>`).join('')}</div>`;
  if (S.allied(m, o.id)) {
    const en = S.enemiesOf(m).filter(e => !S.atWar(o.id, e) && e !== o.id);
    if (en.length) h += `<h4>Call to arms</h4><div class="btns">${en.map(e => `<button class="btn" data-act="dip" data-v="callarms" data-n="${o.id}" data-x="${e}">War on ${nat(e).short}</button>`).join('')}</div>`;
  }
  h += `<div class="btns"><button class="btn" data-act="focusnat" data-n="${o.id}">Show on map</button></div>`;
  return h + '</div>';
}
function dipPanel() {
  const g = G(), m = me(); if (m < 0) return '<p class="note">Observing. Diplomacy is handled by the AI.</p>';
  let h = '';
  const props = g.proposals.filter(p => p.to === m);
  if (props.length) {
    h += '<h4>Incoming</h4>';
    for (const p of props) {
      const f = nat(p.from);
      h += `<div class="row" style="cursor:default">${dotOf(f)}<div class="grow"><div class="nm">${f.short}</div><div class="sub">${p.text} <span class="mono">${fmtDur(p.exp - g.t)}</span></div></div><button class="btn pri" data-act="pyes" data-id="${p.id}">Accept</button><button class="btn" data-act="pno" data-id="${p.id}">Decline</button></div>`;
    }
  }
  h += '<h4>Nations</h4>';
  for (const o of g.nations) {
    if (!o.alive || o.id === m) continue;
    const op = S.opinion(o.id, m).total, open = UI.dipOpen === o.id;
    h += `<div class="row" tabindex="0" data-act="dipopen" data-n="${o.id}"><div class="grow"><div class="nm">${dotOf(o)} ${o.name}</div><div class="sub">${S.D.owned[o.id].length} provinces &middot; strength ${Math.round(S.D.power[o.id] / 100)} ${statusTags(m, o.id)}</div></div><span class="num ${op >= 0 ? 'up' : 'down'}">${op >= 0 ? '+' : ''}${op}</span></div>`;
    if (open) h += dipDetail(o);
  }
  h += `<p class="note">The number is how each nation feels about you. Breaking a treaty costs reputation with everyone.</p>`;
  return h;
}

function intelPanel() {
  const g = G(), D = S.D, m = me();
  let h = '<h4>Standings</h4><table><tr><th>Nation</th><th>Provinces</th><th>Pop</th><th>Power</th></tr>';
  const rows = g.nations.filter(n => n.alive).sort((a, b) => D.owned[b.id].length - D.owned[a.id].length || D.pop[b.id] - D.pop[a.id]);
  for (const n of rows) h += `<tr><td>${dotOf(n)} ${n.id === m ? '<b>' + n.short + '</b>' : n.short}</td><td class="mono">${D.owned[n.id].length}</td><td class="mono">${Math.round(D.share[n.id] * 100)}%</td><td class="mono">${Math.round(D.power[n.id] / 100)}</td></tr>`;
  h += '</table>';
  const dead = g.nations.filter(n => !n.alive);
  if (dead.length) h += `<p class="note">Fallen: ${dead.map(n => n.short).join(', ')}</p>`;
  const pk = paceOf(pace()).k;
  h += `<h4>Game</h4><div class="opts">${paceSeg(pk, 'pace')}</div><p class="note">${paceHint(pk)} Speed buttons multiply this pace.</p>`;
  h += `<div class="opts">World runs while away: ${awaySeg(g.opts.away, 'away')}</div>`;
  h += '<div class="btns"><button class="btn" data-act="save">Save game</button><button class="btn warn" data-act="newgame">New game</button></div>';
  h += `<details><summary>How to play</summary>
  <p>Drag an army badge onto a province to send it there, or tap the badge and then the province. The dashed line shows the route, and red means there is no way through. Armies cross at the border between provinces. One that runs into a fight on the way stops to fight, then carries on once it wins. Armies need passage rights to cross land you are at peace with.</p>
  <p>A badge's symbol shows what an army mostly is: a crossed box for infantry, an oval for armor, a dot for artillery, wings for aircraft. Its card lists every unit with attack, HP and speed (research included), plus what it is strong against and what it should avoid.</p>
  <p>Declare war from the Diplomacy tab. A province falls when its garrison is beaten and you hold it long enough. Fortifications, bunkers and home soil all make that take longer.</p>
  <p>Each province is a city region that produces cash, manpower and one resource. Build in its city: an army base to train artillery and armor, an air base for air wings, defences to hold it, and industry to grow. Construction takes time, so build before the enemy comes.</p>
  <p>Fortifications help every defender, bunkers harden the garrison, anti-air shoots down air wings, hospitals cut your losses, and armies that stay put on friendly soil dig in. Artillery halves all of these bonuses.</p>
  <p>Research labs and your capital make research points. In the Tech tab, pick a project and the points pour into it: stronger units, faster armies, better anti-air and missiles, more output, and the techs that unlock strike bombers, strike cruisers and cruise missiles.</p>
  <p>Conquered provinces are restless. Keep troops there, or they rise up and return to their old owners or go independent.</p>
  <p>Ground units win and hold land: tanks break infantry, artillery and special forces ignore half of all defence bonuses, mobile flak guards the army against aircraft. Helicopters and bombers hunt tanks and guns, interceptors win the sky, patrol aircraft find submarines. Air bases train aircraft and airborne troops; a level-2 base is needed for bombers.</p>
  <p>Naval bases train ships, which sail between coastal provinces as fleets: patrol boats, destroyers (which hunt submarines), submarines (which sink ships) and strike cruisers (level-3 base). Cruise missiles come from an arms industry, fly to an enemy province in range, hit once and may wreck a level of its defences. Anti-air, flak, interceptors and destroyers shoot some of them down.</p>
  <p>There is no premium currency and no forced ending. Past 60% of the population the game asks once if you want to stop. The late game keeps going: coalitions form against a runaway power.</p></details>`;
  h += '<h4>Events</h4>';
  const ev = g.log.slice(-40).reverse();
  for (const e of ev) {
    h += `<div class="logl ${e.kind}"><time>${clockText(e.t)}</time><span>${e.txt}</span></div>`;
  }
  return h;
}

function renderPanel() {
  const el = $('#sheet'), sc = el.scrollTop;
  let h = '';
  if (UI.tab === 'map') h = mapPanel();
  else if (UI.tab === 'forces') h = forcesPanel();
  else if (UI.tab === 'dip') h = dipPanel();
  else if (UI.tab === 'tech') h = techPanel();
  else h = intelPanel();
  el.innerHTML = h;
  el.scrollTop = sc;
  $('#side').dataset.tab = UI.tab;
  UI.sig = panelSig();
}
function panelSig() {
  const g = G(), m = me();
  const n = m >= 0 ? nat(m) : null;
  let s = UI.tab + '|' + UI.confirm;
  if (UI.tab === 'map') {
    s += `|${UI.selP}|${UI.selA}`;
    const a = UI.selA ? army(UI.selA) : null;
    if (UI.selA) s += a ? [a.at, a.mv && a.mv.to, a.route.length, UT.map(t => Math.round(a.u[t])).join(','), a.at != null ? Math.round(S.entrench(a, g.provs[a.at]) * 20) : ''].join(':') : 'x';
    if (UI.selP != null) {
      const p = g.provs[UI.selP];
      s += [p.owner, BK.map(k => p.b[k]).join(''), p.bq.map(b => b.k).join(','), p.q.length, p.battle ? 1 : 0, p.cap ? 1 : 0, g.armies.filter(x => x.at === UI.selP).map(x => x.id + '.' + x.owner + '.' + Math.round(S.unitCount(x.u))).join('/')].join('|');
      if (n && p.owner === m) s += UT.map(t => S.canPay(n, S.unitCost(t)) ? 1 : 0).join('') + BK.map(k => { const l = S.plannedLvl(p, k); return l < S.maxLvl(k) && S.canPay(n, S.buildCost(k, l)) ? 1 : 0; }).join('');
      if (UI.selA && a) { const tp = g.provs[UI.selP]; s += S.atWar(a.owner, tp.owner) + '' + S.hasAccess(a.owner, tp.owner); }
    }
  } else if (UI.tab === 'forces') {
    s += g.armies.filter(a => a.owner === m).map(a => a.id + ':' + (a.at != null ? a.at : '>' + a.mv.to) + ':' + Math.round(S.unitCount(a.u))).join(',') + '|' + g.provs.filter(p => p.owner === m).map(p => p.q.length).join('');
  } else if (UI.tab === 'tech') {
    if (n) s += '|' + Object.keys(n.tech).join(',') + '|' + (n.rs ? n.rs.k : '') + '|' + f2(n.rate.rp);
  } else if (UI.tab === 'dip') {
    if (m < 0) return s + '|observer';
    s += `|${UI.dipOpen}|${UI.dipMsg}|` + g.proposals.map(p => p.id).join(',') + '|' + g.nations.filter(o => o.alive).map(o => o.id + statusTags(m, o.id).length + Math.round(S.opinion(o.id, m).total / 4)).join(',');
  } else {
    s += '|' + g.seq + '|' + g.opts.pace + g.opts.away + '|' + g.nations.map(o => (o.alive ? 1 : 0) + ':' + S.D.owned[o.id].length).join(',');
  }
  return s;
}
let dirtyFlag = true;
function dirty() { dirtyFlag = true; }
function flush() { if (dirtyFlag && UI.started && G() && !UI.modal) { dirtyFlag = false; renderPanel(); } }
function setTab(t) {
  UI.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.v === t)));
  dirty();
}

// live numbers that change without a re-render
function updateBinds() {
  const g = G();
  document.querySelectorAll('#sheet [data-bind]').forEach(e => {
    const k = e.dataset.bind.split(':');
    let v = null;
    if (k[0] === 'g') { const p = g.provs[+k[1]]; v = `${f1(p.garrison)}/${f1(S.maxGar(p))}`; }
    else if (k[0] === 'un') v = Math.round(g.provs[+k[1]].unrest * 100) + '%';
    else if (k[0] === 'q') { const it = g.provs[+k[1]].q[+k[2]]; v = it ? fmtDur(it.left) : ''; }
    else if (k[0] === 'bq') { const b = (g.provs[+k[1]].bq || [])[+k[2]]; v = b ? fmtDur(b.left) : ''; }
    else if (k[0] === 'ac') { const a = army(+k[1]); v = a ? f1(a.u[k[2]]) : ''; }
    else if (k[0] === 'eta') { const a = army(+k[1]); v = a ? fmtDur(etaOf(a)) : ''; }
    else if (k[0] === 'rp') v = Math.floor(nat(me()).rp);
    else if (k[0] === 'rse') v = fmtDur(researchEta(nat(me())));
    if (v !== null && e.textContent !== String(v)) e.textContent = v;
  });
  document.querySelectorAll('#sheet [data-bar]').forEach(e => {
    const k = e.dataset.bar.split(':');
    if (k[0] === 'un') e.style.width = Math.round(g.provs[+k[1]].unrest * 100) + '%';
    else if (k[0] === 'bq') { const b = g.provs[+k[1]].bq[0]; e.style.width = b ? Math.round(100 * (1 - b.left / b.total)) + '%' : '100%'; }
    else if (k[0] === 'rs') { const rs = nat(me()).rs; e.style.width = rs ? Math.round(100 * rs.got / rs.need) + '%' : '100%'; }
  });
}

// ------------------------------------------------------------ header / resources
// campaign clock: real time the war has taken at 1x on this pace
function clockText(t, p) {
  const s = (t === undefined ? G().t : t) / (p || pace());
  const day = Math.floor(s / 86400) + 1, h = Math.floor(s % 86400 / 3600), mm = Math.floor(s % 3600 / 60);
  return `Day ${day} ${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
function renderHeader() {
  const g = G(), m = me(), n = m >= 0 ? nat(m) : null;
  $('#whoName').textContent = n ? n.short : 'Observer';
  $('#whoDot').style.background = n ? n.color : 'var(--ink2)';
  $('#clock').textContent = clockText() + (n ? ` \u00b7 ${S.D.owned[m].length} provinces` : '');
  if (!n) { $('#res').innerHTML = `<span class="rs"><small>${g.nations.filter(x => x.alive).length} nations alive</small></span>`; return; }
  const r = n.rate;
  const chip = (lab, val, rate) => `<span class="rs"><small>${lab}</small><b>${Math.floor(val)}</b><em class="${rate >= 0 ? 'up' : 'down'}">${sgn(rate)}</em></span>`;
  const units = S.D.armiesBy[m].reduce((s, a) => s + S.unitCount(a.u), 0);
  $('#res').innerHTML = chip('Cash', n.cash, r.net) + S.RES.filter(k => k !== 'cash').map(k => chip(S.RESN[k].s, n[k], r[k])).join('') + chip('Research', n.rp, r.rp) + `<span class="rs"><small>Army</small><b>${Math.round(units)}</b></span>`;
  const pend = g.proposals.filter(p => p.to === m).length, bd = $('#dipBadge');
  bd.hidden = !pend; bd.textContent = pend;
}

// ------------------------------------------------------------ modals
function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="mwrap">${html}</div>`; m.hidden = false; UI.modal = true; m.scrollTop = 0; }
function closeModal() { $('#modal').hidden = true; UI.modal = false; }
let startDiff = 'normal', startPace = 'long', startAway = true;
const paceSeg = (cur, act) => `<div class="seg" role="group" aria-label="Game pace">${PACES.map(p => `<button data-act="${act}" data-v="${p.k}" aria-pressed="${p.k === cur}">${p.n}</button>`).join('')}</div>`;
const awaySeg = (on, act) => `<div class="seg" role="group" aria-label="World runs while away"><button data-act="${act}" data-v="1" aria-pressed="${!!on}">On</button><button data-act="${act}" data-v="0" aria-pressed="${!on}">Off</button></div>`;
const paceHint = k => PACES.find(p => p.k === k).hint;
function showStart() {
  let saved = null;
  try { const s = localStorage.getItem(SAVE_KEY); if (s) { const o = JSON.parse(s); if (S.saveOk(o)) saved = { day: clockText(o.t, o.opts.pace || 1), who: o.opts.player >= 0 ? o.nations[o.opts.player].short : 'Observer' }; } } catch (_) {}
  let cards = '';
  S.NATIONS.forEach((def, i) => {
    const ps = PS.filter(p => def.states.includes(p.st));
    const pop = ps.reduce((s, p) => s + p.pop, 0), inc = ps.reduce((s, p) => s + p.cash, 0);
    const cap = ps.filter(p => p.st === def.cap).sort((a, b) => b.pop - a.pop)[0];
    cards += `<button class="nc" data-act="pick" data-v="${i}"><div class="strip" style="background:${def.color}"></div><div class="in"><b>${def.name}</b><span>${def.states.length} states &middot; ${ps.length} provinces &middot; capital ${cap.name}</span><div class="st">${Math.round(pop)}M people &middot; $${inc.toFixed(1)}/s</div></div></button>`;
  });
  modal(`<div class="title">Frontline<br>USA</div>
  <p class="lede">Real-time grand strategy on the American map. Ten rival powers, one continent. No premium currency, no timers to buy out, no forced ending.</p>
  ${saved ? `<div class="btns"><button class="btn pri" data-act="continue">Continue &middot; ${saved.who}, ${saved.day}</button></div>` : ''}
  <h4>AI difficulty</h4>
  <div class="opts"><div class="seg" role="group" aria-label="AI difficulty">${['easy', 'normal', 'hard'].map(d => `<button data-act="diff" data-v="${d}" aria-pressed="${d === startDiff}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}</div></div>
  <h4>Game pace</h4>
  <div class="opts">${paceSeg(startPace, 'pace0')}</div><p class="note" id="paceHint">${paceHint(startPace)}</p>
  <h4>World keeps running while you are away</h4>
  <div class="opts">${awaySeg(startAway, 'away0')}</div>
  <p class="note">When on, the war goes on while this page is closed, like a real campaign. Your garrisons, forts and training queues carry on; your armies hold where you left them. While you are gone your generals only defend: idle armies move to cover threatened provinces, but they never attack, recruit or spend. A paused game stays frozen.</p>
  <h4>Choose your nation</h4>
  <div class="cards">${cards}</div>
  <div class="btns"><button class="btn" data-act="pick" data-v="-1">Watch the AI play</button></div>`);
}
function startNew(i) {
  S.newGame({ player: i, diff: startDiff, pace: PACES.find(p => p.k === startPace).v, away: startAway });
  afterStart();
}
function afterStart() {
  badges.forEach(e => e.g.remove()); badges.clear();
  fillCache.length = 0; bdCache.length = 0;
  UI.selA = null; UI.dipOpen = null; UI.dipMsg = ''; UI.confirm = ''; UI.lastSeq = G().seq; UI.started = true; UI.speed = 1;
  const m = me();
  UI.selP = m >= 0 ? nat(m).capital : null;
  setSpeed(1); setTab('map');
  closeModal();
  if (UI.W) { if (m >= 0) focusNation(m); else fitView(); }
  renderHeader(); renderPanel(); drawMap(performance.now());
  if (m >= 0) toast('Your armies are the numbered badges. Drag one onto a province to send it there.', 'ok');
}
function saveNow(quiet) {
  try { stamp(); localStorage.setItem(SAVE_KEY, S.serialize()); if (!quiet) toast('Game saved', 'ok'); }
  catch (_) { if (!quiet) toast('Could not save in this browser', 'bad'); }
}
function loadSaved() {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (!s) return false;
    S.load(s); afterStart(); resumeFromSave(); return true;
  } catch (_) { return false; }
}
// remember when (in real time) the world was last advanced, and whether it was paused
function stamp() { const g = G(); if (g) { g.wall = Date.now(); g.paused = UI.speed === 0; } }
function resumeFromSave() {
  const g = G();
  if (g.paused) { setSpeed(0); toast('Paused. Press play to resume.', 'info'); return; }
  if (g.opts.away && g.wall) catchUp(Date.now() - g.wall);
}

// ------------------------------------------------------------ offline progress
// Run the world forward for the real time the player was away, in small slices so the page stays responsive.
let catching = false;
function catchUp(ms) {
  const g = G();
  if (catching || !g || !g.opts.away || ms < 4000) return;
  const want = ms / 1000 * pace(), secs = Math.min(want, MAX_AWAY);
  if (secs < 1) return;
  catching = true;
  const seq0 = g.seq, m = me(), owned0 = m >= 0 ? S.D.owned[m].length : 0, t0 = g.t;
  modal(`<div class="title">While you were away</div><p class="lede">${fmtDur(want)} have passed. Catching the world up&hellip;</p><div class="bar"><i id="cuBar" style="width:0%"></i></div>`);
  let done = 0;
  const slice = () => {
    const end = performance.now() + 30;
    G().caretaker = true;     // your generals hold the line while you are gone
    while (done < secs && performance.now() < end) { const d = Math.min(5, secs - done); S.advance(d); done += d; }
    G().caretaker = false;
    const bar = document.getElementById('cuBar');
    if (bar) bar.style.width = Math.round(100 * done / secs) + '%';
    if (done < secs) { setTimeout(slice, 0); return; }
    catching = false;
    stamp();
    const gg = G(), ev = gg.log.filter(e => e.s > seq0 && e.kind !== 'proposal' && (e.me || e.kind === 'elim'));
    const offers = gg.proposals.filter(p => p.to === m).length;
    const lines = ev.slice(-14).map(e => `<div class="logl ${e.kind}"><time>${clockText(e.t)}</time><span>${e.txt}</span></div>`).join('');
    const now = m >= 0 ? S.D.owned[m].length : 0;
    const head = m >= 0 ? (!gg.nations[m].alive ? 'Your nation fell while you were away.' : now === owned0 ? `You still hold all ${now} of your provinces.` : now > owned0 ? `You now hold ${now} provinces (up from ${owned0}).` : `You hold ${now} provinces, down from ${owned0}.`) : '';
    UI.lastSeq = gg.seq;
    modal(`<div class="title">While you were away</div><p class="lede">${fmtDur(gg.t - t0)} of war went by${want > secs ? ` (the world moves at most ${fmtDur(MAX_AWAY)} while you are gone)` : ''}. ${head}</p>${lines || '<p class="note">Nothing important happened on your borders.</p>'}${offers ? `<p class="note">${offers} diplomatic offer${offers > 1 ? 's are' : ' is'} waiting in the Diplomacy tab.</p>` : ''}<div class="btns"><button class="btn pri" data-act="keep">Continue</button></div>`);
    renderHeader(); dirty();
  };
  setTimeout(slice, 0);
}

// ------------------------------------------------------------ actions (delegated clicks)
function setSpeed(v) {
  UI.speed = v;
  document.querySelectorAll('.speed button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.v === v)));
}
function doDip(action, to, x) {
  const r = S.diplo(action, me(), to, x);
  UI.dipMsg = r.msg;
  if (action === 'war' && r.ok) { UI.dipMsg = r.msg; }
  UI.confirm = '';
  toast(r.msg, r.ok ? 'ok' : 'bad');
  dirty();
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act, d = t.dataset;
  const m = G() ? me() : -1;
  switch (act) {
    case 'speed': setSpeed(+d.v); break;
    case 'tab': if (d.v === UI.tab) $('#side').classList.toggle('collapsed'); else { $('#side').classList.remove('collapsed'); setTab(d.v); } break;
    case 'zoom': { const r = svg.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, +d.v); break; }
    case 'fit': fitView(); break;
    case 'pick': startNew(+d.v); break;
    case 'pace0': startPace = d.v; document.querySelectorAll('[data-act="pace0"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === startPace))); { const h = $('#paceHint'); if (h) h.textContent = paceHint(startPace); } break;
    case 'away0': startAway = d.v === '1'; document.querySelectorAll('[data-act="away0"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === d.v))); break;
    case 'pace': G().opts.pace = PACES.find(p => p.k === d.v).v; toast(`Pace set to ${PACES.find(p => p.k === d.v).n}`, 'ok'); dirty(); break;
    case 'away': G().opts.away = d.v === '1'; stamp(); dirty(); break;
    case 'diff': startDiff = d.v; document.querySelectorAll('[data-act="diff"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === startDiff))); break;
    case 'continue': if (!loadSaved()) toast('No save found', 'bad'); break;
    case 'recruit': { const r = S.cmdRecruit(m, +d.p, d.t); toast(r.msg, r.ok ? 'ok' : 'bad'); dirty(); break; }
    case 'build': { const r = S.cmdBuild(m, +d.p, d.k); toast(r.msg, r.ok ? 'ok' : 'bad'); dirty(); break; }
    case 'research': { const r = S.cmdResearch(m, d.k); toast(r.msg, r.ok ? 'ok' : 'bad'); dirty(); break; }
    case 'cancelresearch': { const r = S.cmdCancelResearch(m); toast(r.msg, r.ok ? 'ok' : 'bad'); dirty(); break; }
    case 'cancelbuild': { const r = S.cmdCancelBuild(m, +d.p); toast(r.msg, r.ok ? 'ok' : 'bad'); dirty(); break; }
    case 'selarmy': selectArmy(+d.a); break;
    case 'selprov': selectProv(+d.p); break;
    case 'stop': S.cmdStop(+d.a); toast('Halting at the next stop', 'ok'); dirty(); break;
    case 'split': { const r = S.cmdSplit(+d.a, d.k); toast(r.msg, r.ok ? 'ok' : 'bad'); if (r.ok) { UI.selA = r.id; } dirty(); break; }
    case 'merge': { const r = S.cmdMerge(m, +d.p, d.k); toast(r.msg, r.ok ? 'ok' : 'bad'); if (r.ok) UI.selA = r.id; dirty(); break; }
    case 'disband': S.cmdDisband(+d.a); UI.selA = null; toast('Army disbanded', 'ok'); dirty(); break;
    case 'homefocus': { const c = nat(m).capital; selectProv(c); focusOn(c, 1.8); break; }
    case 'focusnat': focusNation(+d.n); break;
    case 'dipopen': {
      UI.dipOpen = UI.dipOpen === +d.n && UI.tab === 'dip' ? null : +d.n; UI.dipMsg = ''; UI.confirm = '';
      if (UI.tab !== 'dip') setTab('dip');
      dirty(); break;
    }
    case 'dip': doDip(d.v, +d.n, d.x !== undefined ? (isNaN(+d.x) ? d.x : +d.x) : undefined); break;
    case 'arm': UI.confirm = d.k; dirty(); break;
    case 'war': doDip('war', +d.n); break;
    case 'pyes': { const r = S.answerProposal(+d.id, true); toast(r.msg, r.ok ? 'ok' : 'bad'); dirty(); break; }
    case 'pno': { const r = S.answerProposal(+d.id, false); toast(r.msg, 'info'); dirty(); break; }
    case 'save': saveNow(); break;
    case 'newgame': saveNow(true); UI.started = true; showStart(); break;
    case 'keep': closeModal(); break;
    case 'watch': G().opts.player = -1; closeModal(); dirty(); break;
    case 'finish': closeModal(); setTab('intel'); break;
  }
  flush();
});
document.addEventListener('keydown', e => {
  if (!UI.started || UI.modal) return;
  if (e.key === ' ') { e.preventDefault(); setSpeed(UI.speed === 0 ? 1 : 0); }
  else if (e.key === '1') setSpeed(1); else if (e.key === '2') setSpeed(4); else if (e.key === '3') setSpeed(16);
  else if (e.key === 'Escape') { UI.selA = null; UI.selP = null; dirty(); }
  else if (e.key === 'Enter' && e.target.matches && e.target.matches('.row')) e.target.click();
});

// ------------------------------------------------------------ frame loop
let last = performance.now(), lastWall = Date.now(), acc = 0, uiClock = 0, saveClock = 0, lastDraw = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const wall = Date.now(), gap = wall - lastWall; lastWall = wall;
  if (UI.started && G()) {
    // the tab was hidden or the device slept: let the world catch up
    if (gap > 4000 && UI.speed > 0 && !UI.modal) catchUp(gap);
    if (UI.speed > 0 && !UI.modal) {
      acc += dt * UI.speed * pace();
      let n = 0;
      while (acc >= 0.25 && n < 40) { S.step(0.25); acc -= 0.25; n++; }
      if (n === 40) acc = 0;
      else if (acc > 0) { S.step(acc); acc = 0; }   // slow paces advance a sliver every frame so movement stays smooth
    }
    if (now - lastDraw >= 33) { lastDraw = now; drawMap(now); }
    uiClock += dt; saveClock += dt;
    if (uiClock > 0.25) { uiClock = 0; tickUI(); }
    if (saveClock > 20) { saveClock = 0; if (!UI.modal) saveNow(true); }
  }
  requestAnimationFrame(frame);
}
function tickUI() {
  const g = G();
  renderHeader();
  for (const e of g.log) {
    if (e.s <= UI.lastSeq) continue;
    UI.lastSeq = e.s;
    if (e.me || e.kind === 'elim' || e.kind === 'revolt') toast(e.txt, e.kind);
  }
  if (g.flags.dominanceAsk && !UI.modal) {
    g.flags.dominanceAsk = false;
    modal(`<div class="title">Dominance</div><p class="lede">Your nation now holds more than 60% of the population. You can stop here and look at the standings, or keep going. The world will not let you rest: neighbours form coalitions, conquered provinces revolt, and rivals rebuild.</p><div class="btns"><button class="btn pri" data-act="keep">Keep playing</button><button class="btn" data-act="finish">See standings</button></div>`);
  }
  if (g.flags.playerDead && !UI.modal) {
    g.flags.playerDead = false;
    modal(`<div class="title">Fallen</div><p class="lede">${nat(g.opts.player).name} has been eliminated. You can keep watching the war play out, or start again.</p><div class="btns"><button class="btn pri" data-act="watch">Keep watching</button><button class="btn" data-act="newgame">New game</button></div>`);
  }
  if (!UI.modal) {
    if (dirtyFlag || (UI.sig !== panelSig())) { if (!pts.size && performance.now() - UI.touch > 700) { dirtyFlag = false; renderPanel(); } }
    else updateBinds();
  }
}

// ------------------------------------------------------------ boot
new ResizeObserver(() => {
  const r = stage.getBoundingClientRect();
  UI.W = r.width; UI.H = r.height;
  if (!UI.W || !UI.H) return;
  if (!UI.viewInit) { UI.viewInit = true; fitView(); if (UI.started && G() && me() >= 0) focusNation(me()); }
  else applyView();
}).observe(stage);

function boot(data) {
  data = data || {};
  buildMap();
  requestAnimationFrame(frame);
  if (data.save) { try { S.load(data.save); afterStart(); if (data.ui) { UI.speed = data.ui.speed === undefined ? 1 : data.ui.speed; setSpeed(UI.speed); } return; } catch (_) {} }
  showStart();
}
const hot = window.claude && window.claude.hot;
try { if (hot && hot.snapshot) hot.snapshot(() => ({ save: UI.started && G() ? S.serialize() : null, ui: { speed: UI.speed } })); } catch (_) {}
if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {});
document.addEventListener('visibilitychange', () => { if (document.hidden && UI.started && G() && !UI.modal) saveNow(true); });
window.__flusa = { UI, S, drawMap, renderPanel, catchUp, fmtDur };
})();
