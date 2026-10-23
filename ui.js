// =====================================================================
//  FRONTLINE USA : interface (map, orders, panels, modals)
// =====================================================================
(function () {
'use strict';
const S = SIM, PS = S.PS, UNITS = S.UNITS, UT = S.UT;
const $ = (s, r) => (r || document).querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const SAVE_KEY = 'frontline_usa_save_v1';
const BACKUP_KEY = 'frontline_usa_save_backup';   // the save as it was before a new version first loaded it
// version info from CHANGELOG.md, injected by make.js
const BINFO = typeof BUILD !== 'undefined' ? BUILD : { version: 'dev', code: 0, date: '', notes: [], repo: '' };
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
  L.terr = mk('image', { x: 0, y: 0, width: MAP.w, height: MAP.h, preserveAspectRatio: 'none', class: 'terr' }, svg);
  mk('rect', { x: 0, y: 0, width: MAP.w, height: MAP.h, class: 'terrshade' }, svg);
  UI.terrainDone = false;
  for (const k of ['provs', 'borders', 'lanes', 'roads', 'labels', 'hits', 'sel', 'routes', 'fx', 'armies']) L[k] = mk('g', {}, svg);
  MAP.provinces.forEach(p => {
    provEls[p.id] = mk('path', { d: p.d, class: 'prov', 'data-p': p.id }, L.provs);
  });
  MAP.borders.forEach((b, i) => { bdEls[i] = mk('path', { d: b.d, class: 'bd' }, L.borders); });
  L.stLines = mk('path', { d: MAP.stateLines, class: 'stl' }, L.borders);
  L.coast = mk('path', { d: MAP.coast, class: 'coast' }, L.borders);
  MAP.sea.forEach(([a, b]) => mk('line', { x1: PS[a].px, y1: PS[a].py, x2: PS[b].px, y2: PS[b].py, class: 'sealane' }, L.lanes));
  // the road network troops march along, and its waypoints (sea lanes are drawn above)
  L.road = mk('path', { class: 'road', d: S.ROADS.filter(r => r.length < 3).map(([a, b]) => `M${S.NODES[a][0]} ${S.NODES[a][1]}L${S.NODES[b][0]} ${S.NODES[b][1]}`).join('') }, L.roads);
  L.wpt = mk('path', { class: 'wpt', d: '' }, L.roads);
  UI.wptScale = 0;
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


// ------------------------------------------------------------ terrain art
// The land is painted once into a canvas and shown as an image under the nation colours: a biome colour per
// state (blended across borders by drawing small and scaling up), relief from hand-placed mountain ridges with
// noise and hill shading, fine grain, and a shallow-water glow off the coast. No image files are needed.
const BIOME_OF = { WA: 'forest', OR: 'forest', CA: 'farm', NV: 'desert', AZ: 'desert', NM: 'desert', UT: 'dry', ID: 'mount', MT: 'prairie', WY: 'dry',
  CO: 'prairie', ND: 'prairie', SD: 'prairie', NE: 'prairie', KS: 'prairie', OK: 'prairie', TX: 'prairie', MN: 'forest', IA: 'farm', MO: 'farm',
  AR: 'forest', LA: 'swamp', WI: 'forest', IL: 'farm', MI: 'forest', IN: 'farm', OH: 'farm', KY: 'forest', TN: 'forest', MS: 'swamp', AL: 'forest',
  GA: 'forest', FL: 'tropic', SC: 'forest', NC: 'forest', VA: 'forest', WV: 'forest', PA: 'forest', NY: 'forest', VT: 'forest', NH: 'forest',
  ME: 'forest', MA: 'forest', RI: 'forest', CT: 'forest', NJ: 'farm', DE: 'farm', MD: 'forest', DC: 'farm', AK: 'tundra', HI: 'tropic' };
const BIOME_RGB = { forest: [74, 112, 66], farm: [150, 165, 98], prairie: [176, 168, 112], dry: [168, 150, 110], desert: [204, 178, 132],
  mount: [128, 128, 98], swamp: [96, 128, 78], tropic: [104, 150, 82], tundra: [150, 156, 132] };
function biomeOf(p) {
  let b = BIOME_OF[p.st] || 'farm';
  if ((p.st === 'WA' || p.st === 'OR') && p.px > 120) b = 'dry';                // east of the Cascades
  if (p.st === 'CA' && (p.py > 360 || p.px > 120)) b = 'desert';                 // southern California and the desert east
  if (p.st === 'TX' && p.px < 420) b = 'desert';                                 // west Texas
  if (p.st === 'TX' && p.px > 560) b = 'swamp';                                  // the Gulf coast and piney east
  if ((p.st === 'MT' || p.st === 'WY' || p.st === 'CO') && p.px < 330) b = 'mount';
  if (p.st === 'MN' && p.py > 140) b = 'farm';
  return b;
}
// mountain ridges in map units: [polyline, width, height]
const RIDGES = [
  [[[205, 55], [250, 125], [300, 190], [325, 250], [318, 300], [305, 350], [298, 400], [292, 440]], 30, 1],
  [[[160, 85], [178, 160], [200, 200]], 26, 0.7],
  [[[222, 190], [232, 260], [236, 320]], 16, 0.6],
  [[[96, 18], [92, 80], [86, 140], [80, 192]], 12, 0.8],
  [[[80, 200], [98, 262], [116, 322], [132, 362]], 13, 0.95],
  [[[40, 60], [44, 180], [62, 300], [92, 372]], 9, 0.4],
  [[[140, 220], [175, 250], [200, 300]], 34, 0.32],
  [[[680, 425], [718, 372], [758, 312], [790, 262], [822, 220], [858, 172], [878, 122]], 19, 0.55],
  [[[862, 120], [872, 100]], 18, 0.45], [[[900, 112], [906, 96]], 16, 0.42],
  [[[540, 345], [575, 360]], 30, 0.25], [[[386, 170], [394, 180]], 11, 0.32],
  [[[40, 515], [100, 505], [150, 520]], 16, 0.85],
];
function segDist(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / L, 0, 1) : 0;
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}
// smooth value noise with hashed lattice points
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (i, j) => { let n = (i * 374761393 + j * 668265263) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function buildTerrain(k) {
  let cv, c2;
  try { cv = document.createElement('canvas'); c2 = cv.getContext && cv.getContext('2d'); } catch (_) { return null; }
  if (!c2 || typeof Path2D === 'undefined') return null;
  const W = Math.round(MAP.w * k), H = Math.round(MAP.h * k);
  cv.width = W; cv.height = H;
  const paths = MAP.provinces.map(p => new Path2D(p.d));
  // land mask at full size
  c2.setTransform(k, 0, 0, k, 0, 0);
  c2.fillStyle = '#fff'; paths.forEach(p => c2.fill(p));
  const mask = c2.getImageData(0, 0, W, H).data;
  // biome colours drawn small, then scaled up so neighbouring biomes blend
  const sk = 0.12, sw = Math.ceil(MAP.w * sk), sh = Math.ceil(MAP.h * sk);
  const sm = document.createElement('canvas'); sm.width = sw; sm.height = sh;
  const s2 = sm.getContext('2d'); s2.setTransform(sk, 0, 0, sk, 0, 0);
  MAP.provinces.forEach((p, i) => { const c = BIOME_RGB[biomeOf(p)]; s2.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; s2.fill(paths[i]); s2.lineWidth = 6; s2.strokeStyle = s2.fillStyle; s2.stroke(paths[i]); });
  c2.setTransform(1, 0, 0, 1, 0, 0); c2.clearRect(0, 0, W, H); c2.imageSmoothingEnabled = true;
  c2.drawImage(sm, 0, 0, W, H);
  const col = c2.getImageData(0, 0, W, H);
  // land nearness for the coastal glow, by the same trick
  const gm = document.createElement('canvas'); gm.width = sw; gm.height = sh;
  const g2 = gm.getContext('2d'); g2.setTransform(sk, 0, 0, sk, 0, 0); g2.fillStyle = '#fff'; paths.forEach(p => g2.fill(p));
  c2.clearRect(0, 0, W, H); c2.drawImage(gm, 0, 0, W, H);
  const near = c2.getImageData(0, 0, W, H).data;
  // elevation on a coarse grid (one cell per map unit)
  const EW = MAP.w + 2, EH = MAP.h + 2, elev = new Float32Array(EW * EH);
  const boxes = RIDGES.map(([pts, w]) => [Math.min(...pts.map(p => p[0])) - 2.5 * w, Math.min(...pts.map(p => p[1])) - 2.5 * w, Math.max(...pts.map(p => p[0])) + 2.5 * w, Math.max(...pts.map(p => p[1])) + 2.5 * w]);
  for (let y = 0; y < EH; y++) for (let x = 0; x < EW; x++) {
    let e = 0;
    for (let ri = 0; ri < RIDGES.length; ri++) {
      const [pts, w, h] = RIDGES[ri], bx = boxes[ri];
      if (x < bx[0] || x > bx[2] || y < bx[1] || y > bx[3]) continue;
      let d = Infinity;
      for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(x, y, pts[i - 1], pts[i]));
      if (d < w * 2.5) e = Math.max(e, h * Math.exp(-(d * d) / (w * w)));
    }
    elev[y * EW + x] = e;
  }
  const el = (x, y) => { const xi = Math.min(EW - 2, Math.max(0, x | 0)), yi = Math.min(EH - 2, Math.max(0, y | 0)), fx = x - xi, fy = y - yi, i = yi * EW + xi;
    return (elev[i] * (1 - fx) + elev[i + 1] * fx) * (1 - fy) + (elev[i + EW] * (1 - fx) + elev[i + EW + 1] * fx) * fy; };
  // height field: ridged noise where the land is high, gentle rolls elsewhere
  const hf = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (mask[i * 4 + 3] < 128 && near[i * 4 + 3] < 200) continue;          // open sea
    const mx = x / k, my = y / k, e = el(mx, my);
    let h = vnoise(mx * 0.05, my * 0.05) * 2.2 + vnoise(mx * 0.22, my * 0.22) * 0.5;
    if (e > 0.02) {
      let r = 0, amp = 1, f = 0.09;
      for (let o = 0; o < 4; o++) { r += amp * (1 - Math.abs(vnoise(mx * f, my * f) * 2 - 1)); amp *= 0.5; f *= 2.1; }
      h += e * (0.35 + 0.65 * r / 1.875) * 22;
    }
    hf[i] = h;
  }
  const out = c2.createImageData(W, H), o = out.data, c = col.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, j = i * 4, mx = x / k, my = y / k;
    if (mask[j + 3] < 128) {
      // sea: a pale glow near the coast that fades out
      const n = near[j + 3] / 255;
      if (n > 0.02) { o[j] = 150; o[j + 1] = 196; o[j + 2] = 214; o[j + 3] = Math.round(150 * Math.min(1, n * 1.6)); }
      continue;
    }
    const e = el(mx, my), hx = hf[i + (x < W - 1 ? 1 : 0)] - hf[i - (x > 0 ? 1 : 0)], hy = hf[i + (y < H - 1 ? W : 0)] - hf[i - (y > 0 ? W : 0)];
    const shade = clamp(1 + (-hx - hy) * 0.55 * k, 0.55, 1.45);
    const grain = 0.9 + 0.2 * (0.6 * vnoise(mx * 0.9, my * 0.9) + 0.4 * vnoise(mx * 2.7, my * 2.7));
    let r = c[j], g = c[j + 1], b = c[j + 2];
    // rock and snow with height
    const rock = clamp(e * 1.15, 0, 0.75), snow = clamp((e - 0.72) * 3, 0, 0.8) * (0.6 + 0.4 * vnoise(mx * 0.3, my * 0.3));
    r += (132 - r) * rock; g += (122 - g) * rock; b += (104 - b) * rock;
    r += (236 - r) * snow; g += (238 - g) * snow; b += (240 - b) * snow;
    o[j] = clamp(r * shade * grain, 0, 255); o[j + 1] = clamp(g * shade * grain, 0, 255); o[j + 2] = clamp(b * shade * grain, 0, 255); o[j + 3] = 255;
  }
  c2.putImageData(out, 0, 0);
  try { return cv.toDataURL('image/webp', 0.86); } catch (_) { return null; }
}
function paintTerrain() {
  if (UI.terrainDone || !L.terr) return;
  UI.terrainDone = true;
  const t0 = performance.now();
  const url = buildTerrain(Math.min(2, Math.max(1.2, (window.devicePixelRatio || 1) * 0.9)));
  UI.terrainMs = Math.round(performance.now() - t0);
  if (url) { L.terr.setAttribute('href', url); document.documentElement.classList.add('terrain'); }
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
    // bigger cities get bigger markers
    cityEls[p.id].setAttribute('r', ((1.6 + (PS[p.id].pop >= 8 ? 1.4 : PS[p.id].pop >= 3 ? 0.7 : 0)) / v.scale).toFixed(2));
    cityEls[p.id].setAttribute('stroke-width', (0.9 / v.scale).toFixed(2));
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
  // roads fade in as you zoom; waypoint markers keep the same size on screen
  if (L.road) {
    L.roads.style.display = z >= 1.6 ? '' : 'none';
    L.roads.style.opacity = clamp((z - 1.6) / 1.2, 0.3, 1).toFixed(2);
    L.road.setAttribute('stroke-width', (0.9 / v.scale).toFixed(2));
    if (z >= 1.6 && Math.abs(v.scale - UI.wptScale) > v.scale * 0.05) {
      UI.wptScale = v.scale;
      const r = 2.6 / v.scale, h = (r * 1.7).toFixed(2), w = r.toFixed(2);
      let d = '';
      for (let i = PS.length; i < S.NODES.length; i++) { const n = S.NODES[i]; d += `M${(n[0] - r).toFixed(1)} ${(n[1] + r * 0.8).toFixed(1)}l${w} -${h}l${w} ${h}z`; }
      L.wpt.setAttribute('d', d);
    }
  }
}
// map coordinates under a screen point
function mapPt(x, y) {
  const r = svg.getBoundingClientRect(), v = UI.view;
  return [v.cx - UI.W / (2 * v.scale) + (x - r.left) / v.scale, v.cy - UI.H / (2 * v.scale) + (y - r.top) / v.scale];
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
// a tap on a resource in the top bar opens the market (handled on the bar, since its chips are redrawn often)
{
  let down = null;
  $('#res').addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  $('#res').addEventListener('pointerup', e => {
    const c = e.target.closest && e.target.closest('.rs[data-act]');
    if (c && down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 8 && UI.started) { $('#side').classList.remove('collapsed'); setTab('market'); }
    down = null;
  });
}
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
      if (d && d.to != null && e.type === 'pointerup') { selectArmy(d.id); orderTo(d.to, d.node, true); }
      flush(); drawMap(performance.now());
    } else if (!g.moved && e.type === 'pointerup' && performance.now() - g.t < 700) { handleTap(g.target, g.x, g.y); flush(); drawMap(performance.now()); }
  }
  if (pts.size < 2) pinch = null;
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);
stage.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0016)); }, { passive: false });

// the province and waypoint under a screen point, and the road an army would take there
function dragTo(id, x, y) {
  const a = army(id);
  if (!a) { UI.drag = null; return; }
  const el = document.elementFromPoint(x, y), hit = el && el.closest && (el.closest('[data-p]') || el.closest('[data-a]'));
  const dom = S.domOf(a);
  let to = null, node = null;
  if (hit && hit.dataset.p != null) { to = +hit.dataset.p; const [mx, my] = mapPt(x, y); node = dom === 'land' ? S.nearestNode(to, mx, my) : to; }
  else if (hit && hit.dataset.a != null) { const o = army(+hit.dataset.a); if (o) { node = dom === 'land' ? nodeOf(o) : S.NODE_P[nodeOf(o)]; to = S.NODE_P[node]; } }
  if (UI.drag && UI.drag.id === id && UI.drag.node === node) return;
  const from = routeStart(a);
  let route = null;
  if (node != null && node !== from) {
    if (dom === 'msl') route = S.missileOk(a, to).ok ? [to] : null;
    else route = S.nodeRoute(a.owner, from, node, S.armySpeed(a), dom);
  }
  UI.drag = node === from ? { id, to: null, node: null, route: null } : { id, to, node, route };
  drawMap(performance.now());
}

// ------------------------------------------------------------ selection and orders
function handleTap(t, x, y) {
  if (!UI.started) return;
  const a = t.closest && t.closest('[data-a]'), p = t.closest && t.closest('[data-p]');
  if (a) {
    const ar = army(+a.dataset.a);
    if (ar) {
      const loc = ar.at != null ? ar.at : ar.mv.to;
      if (ar.owner === me()) { selectArmy(ar.id); return; }
      if (UI.selA) { orderTo(loc, nodeOf(ar), true); return; }
      selectProv(loc); return;
    }
  }
  if (p) {
    const pid = +p.dataset.p;
    if (!UI.selA) { selectProv(pid); return; }
    // march to the waypoint nearest the tap; inside the army's own province only a tap close to one counts
    const [mx, my] = mapPt(x, y), node = S.nearestNode(pid, mx, my), n = S.NODES[node];
    orderTo(pid, node, Math.hypot(n[0] - mx, n[1] - my) * UI.view.scale < 22);
    return;
  }
  UI.selA = null; UI.selP = null; UI.confirm = ''; dirty();
}
function selectProv(pid) { UI.selP = pid; UI.selA = null; UI.confirm = ''; if (UI.tab !== 'map') setTab('map'); dirty(); }
function selectArmy(id) {
  const a = army(id); if (!a) return;
  UI.selA = id; UI.selP = a.at != null ? a.at : a.mv.to; UI.confirm = '';
  if (UI.tab !== 'map') setTab('map');
  dirty();
}
function orderTo(pid, node, near) {
  const a = army(UI.selA);
  if (!a || a.owner !== me()) { UI.selA = null; selectProv(pid); return; }
  const dom = S.domOf(a);
  if (dom !== 'land') node = null;
  if (pid === a.at && !a.mv && (dom !== 'land' || !near || node === a.n)) { UI.selA = null; selectProv(pid); return; }
  // a missile strike cannot be called back, so it takes a second tap
  if (S.domOf(a) === 'msl' && a.at != null) {
    const ok = S.missileOk(a, pid);
    if (ok.ok && ok.strike && UI.confirm !== 'msl:' + pid) { UI.selP = pid; UI.confirm = 'msl:' + pid; toast('Tap ' + PS[pid].name + ' again to launch', 'info'); dirty(); return; }
  }
  const r = S.cmdMove(a.id, pid, node);
  toast(r.msg + (r.eta ? ` (ETA ${fmtDur(r.eta)})` : ''), r.ok ? 'ok' : 'bad');
  UI.selP = pid; UI.confirm = ''; dirty();
}

// ------------------------------------------------------------ movement geometry
// Land armies march along the road network (S.NODES, S.ROADS) and stand on its nodes; node i < PS.length
// is province i's city. Fleets and missiles go straight from city to city.
const NXY = i => S.NODES[i];
const nodeOf = a => a.mv ? a.mv.tn : a.n;
const routeStart = a => a.mv ? a.mv.tn : a.n;
// where an army is drawn: on its node, or part way along the current leg (with its heading)
function armyPos(a) {
  if (!a.mv) { const n = NXY(a.n); return { x: n[0], y: n[1], ang: null }; }
  const A = NXY(a.mv.fn), B = NXY(a.mv.tn), k = a.mv.dur ? clamp(a.mv.t / a.mv.dur, 0, 1) : 0;
  return { x: A[0] + (B[0] - A[0]) * k, y: A[1] + (B[1] - A[1]) * k, ang: Math.atan2(B[1] - A[1], B[0] - A[0]) * 180 / Math.PI };
}
// the polyline of the road ahead: from where the army is, through each node still to come
function routePts(a, list) {
  const p = armyPos(a), out = [[p.x, p.y]];
  if (a.mv) out.push(NXY(a.mv.tn));
  for (const r of list) out.push(NXY(r));
  return out;
}

// ------------------------------------------------------------ map drawing (per frame)
// Unit figures: a small silhouette of what an army mostly is (and its second arm, if that is a big
// part of it), drawn left of the count. Each figure fits a 12 x 9 box around its centre.
const FIG = {
  inf: 'M-1 -3.3a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0ZM-1.6 -1.6H1.6L2 1.4H1.2L1.6 4.5H0.4L0 1.9L-0.4 4.5H-1.6L-1.2 1.4H-2ZM1.4 -1.1L5 -3.4L5.4 -2.8L1.8 -0.5Z',
  abn: 'M-5.5 -1.2Q0 -8.5 5.5 -1.2ZM-5 -1.2L-0.8 2.2L-0.5 1.7L-4.2 -1.2ZM5 -1.2L0.8 2.2L0.5 1.7L4.2 -1.2ZM-0.9 1.6a0.9 0.9 0 1 0 1.8 0a0.9 0.9 0 1 0 -1.8 0ZM-1 2.4H1L0.8 4.6H-0.8Z',
  mech: 'M-6 0.3L-4.3 -3H2.6L6 0.3V2.1H-6ZM-4.8 2.6a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0ZM-1.3 2.6a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0ZM2.2 2.6a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0Z',
  arm: 'M-6 1.4H6L4.8 4.2H-4.8ZM-5.6 -1H5V1H-5.6ZM-3 -3.6H1.8L2.6 -1H-3.6ZM2 -2.8H6.6V-1.9H2Z',
  art: 'M-3.4 0.6L5.4 -4.2L5.9 -3.4L-2.8 1.4ZM-6 1.2H1.2L2.2 2.4H-6ZM-2.6 2.8a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0 -3.8 0Z',
  flak: 'M-6 0.6H6V2.6H-6ZM3 -1.6H5.8V0.6H3ZM-3.4 -1H0.8V0.6H-3.4ZM-2.4 -1L0.6 -5L1.2 -4.6L-1.6 -0.8ZM-0.8 -1L2.2 -5L2.8 -4.6L0 -0.8ZM-4.6 3.2a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0ZM2.4 3.2a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0 -2.2 0Z',
  heli: 'M-3 -1.4Q1.5 -3.2 4 -0.4Q3 2 -2.2 1.6ZM-3 -0.6H-6.6V0.4H-3ZM-6.4 -2.2H-5.6V1.2H-6.4ZM-6 -4H5.6V-3.3H-6ZM0 -3.4H0.9V-1.8H0ZM-2.6 3H3.2V3.7H-2.6ZM-1.4 1.6H-0.7V3.2H-1.4ZM1.4 1.4H2.1V3.2H1.4Z',
  ftr: 'M0 -4.8L0.8 -1.6L6 1.4V2.6L0.8 1.2L0.6 3.4L2 4.3V4.9L0 4.4L-2 4.9V4.3L-0.6 3.4L-0.8 1.2L-6 2.6V1.4L-0.8 -1.6Z',
  bmb: 'M0 -4.8L1 -2.2V-1.2L6.5 0.6V1.9L1 1.2L0.8 3.4L2.6 4.4V5L0 4.5L-2.6 5V4.4L-0.8 3.4L-1 1.2L-6.5 1.9V0.6L-1 -1.2V-2.2Z',
  pat: 'M-0.6 -4.4H0.6V4.2H-0.6ZM-6.2 -1.2H6.2V0.4H-6.2ZM-2.4 3.2H2.4V4.4H-2.4ZM-3.6 -2.8h1.2v3.4h-1.2zM2.4 -2.8h1.2v3.4h-1.2z',
  ship: 'M-6.5 0.6H6.5L5 3.6H-5ZM-3 -1.6H2V0.6H-3ZM-1.1 -4.2H-0.1V-1.6H-1.1ZM2 -0.7H5.2V0H2Z',
  sub: 'M-6 1Q-6 -1 -3 -1H4Q6.5 -1 6.5 1Q6.5 3 4 3H-3Q-6 3 -6 1ZM-1.2 -3.4H1.4V-1H-1.2ZM-0.2 -4.6H0.4V-3.4H-0.2Z',
  msl: 'M-6 -0.9H3.4L6.4 0L3.4 0.9H-6ZM-6 -0.9L-6.6 -3H-5.2L-3.8 -0.9ZM-6 0.9L-6.6 3H-5.2L-3.8 0.9Z',
};
const FIG_OF = { inf: 'inf', sf: 'inf', abn: 'abn', mech: 'mech', arm: 'arm', art: 'art', flak: 'flak', heli: 'heli', ftr: 'ftr', bmb: 'bmb', pat: 'pat', pb: 'ship', dd: 'ship', cru: 'ship', sub: 'sub', msl: 'msl' };
// the figures for an army: its strongest arm, plus a second one that makes up at least a quarter of it
function figsOf(a) {
  const w = {}; let tot = 0;
  for (const t of UT) if (a.u[t] > 0) { const k = FIG_OF[t], v = a.u[t] * UNITS[t].atk * UNITS[t].hp; w[k] = (w[k] || 0) + v; tot += v; }
  const ks = Object.keys(w).sort((x, y) => w[y] - w[x]);
  if (!ks.length) return ['inf'];
  return ks.length > 1 && w[ks[1]] >= tot * 0.25 ? ks.slice(0, 2) : ks.slice(0, 1);
}
function makeBadge(a) {
  const g = mk('g', { class: 'bdg', 'data-a': a.id }, L.armies);
  return { g, key: '', d: null };
}
// (re)draw a badge's contents: a pin down to its node, the frame, the figures and the count
function fillBadge(e, a, stem) {
  const n = nat(a.owner), dom = S.domOf(a), figs = figsOf(a);
  const txt = String(Math.max(1, Math.round(S.unitCount(a.u))));
  const key = figs.join('+') + '|' + txt + '|' + stem + '|' + n.color;
  if (e.key === key) return;
  e.key = key; e.g.textContent = '';
  const fw = 13 * figs.length, tw = 5.8 * txt.length + 3, w = fw + tw + 4, x0 = -w / 2;
  if (stem) mk('path', { class: 'pin', d: 'M-2.6 -7L0 -11L2.6 -7Z' }, e.g);
  // armies are tags, fleets are hulls, missile salvos are pills
  if (dom === 'sea') mk('path', { class: 'hull', d: `M${x0 - 2} -7.5H${-x0 + 2}L${-x0 - 2} 7.5H${x0 + 2}Z`, fill: n.color }, e.g);
  else mk('rect', { x: x0, y: -7.5, width: w, height: 15, rx: dom === 'msl' ? 7.5 : 2, fill: n.color }, e.g);
  figs.forEach((f, i) => mk('path', { class: 'fig', d: FIG[f], transform: `translate(${(x0 + 8.5 + 13 * i).toFixed(1)} 0)` }, e.g));
  const t = mk('text', { x: (x0 + fw + 2 + tw / 2).toFixed(1), y: 3.3 }, e.g);
  t.textContent = txt;
  e.d = mk('path', { class: 'dir', d: 'M0 -4L7 0L0 4Z', display: 'none' }, e.g);
  e.w = w;
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

  // armies stand on road nodes; several on one node stack below it
  const groups = {};
  for (const a of g.armies) if (!a.mv) (groups[a.n] = groups[a.n] || []).push(a);
  const live = new Set();
  for (const a of g.armies) {
    live.add(a.id);
    let e = badges.get(a.id);
    if (!e) { e = makeBadge(a); badges.set(a.id, e); }
    const pos = armyPos(a);
    let x = pos.x, y = pos.y + 11 * bk, stem = true;
    if (!a.mv) {
      const grp = groups[a.n], i = grp.indexOf(a), n = grp.length, per = 3;
      const row = Math.floor(i / per), col = i % per, inRow = Math.min(per, n - row * per);
      x += (col - (inRow - 1) / 2) * 36 * bk;
      y += row * 17 * bk;
      stem = n === 1 || (row === 0 && col === Math.floor((inRow - 1) / 2));
    }
    fillBadge(e, a, stem);
    e.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${bk.toFixed(4)})`);
    const cls = 'bdg' + (a.id === UI.selA ? ' sel' : '') + (a.owner !== me() ? ' foe' : '') + (a.strike ? ' strike' : '');
    if (e.g.getAttribute('class') !== cls) e.g.setAttribute('class', cls);
    if (pos.ang === null) e.d.setAttribute('display', 'none');
    else { e.d.setAttribute('display', ''); e.d.setAttribute('transform', `translate(${(e.w / 2 + 1).toFixed(1)} 0) rotate(${pos.ang.toFixed(0)}) translate(-1 0)`); }
  }
  for (const [id, e] of badges) if (!live.has(id)) { e.g.remove(); badges.delete(id); }
  // where each province's fighting is: around the armies standing in it, else its city
  const spot = pid => {
    let sx = 0, sy = 0, k = 0;
    for (const a of g.armies) if (a.at === pid && !a.mv) { const n = NXY(a.n); sx += n[0]; sy += n[1]; k++; }
    return k ? [sx / k, sy / k] : [PS[pid].px, PS[pid].py];
  };

  // battles, sieges
  L.fx.textContent = '';
  const pulse = 1 + 0.18 * Math.sin(now / 160);
  for (const p of g.provs) {
    if (!p.battle && !p.cap) continue;
    const [sx, sy] = spot(p.id), d = { cx: sx, cy: sy };
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
    line(routePts(a, a.route), 'route' + (sel ? '' : ' faint'), sel ? 1.9 : 1.2);
  }
  // drag-to-move preview
  if (UI.drag && UI.drag.to != null) {
    const a = army(UI.drag.id);
    if (a) {
      const from = routeStart(a), dn = NXY(UI.drag.node);
      if (UI.drag.route) line(routePts(a, UI.drag.route), 'route drag', 2.4);
      const d = { cx: dn[0], cy: dn[1] };
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
  while (box.children.length > 2) box.firstChild.remove();
  setTimeout(() => d.remove(), 4200);
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
// small icons (16 x 16): resources are filled, tab icons are drawn as lines
const ICON = {
  cash: 'M1.5 4h13v8h-13ZM8 5.8a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 1 0 0-4.4ZM3 5.5v1.5h1.5M13 10.5v-1.5h-1.5',
  man: 'M8 1.5a2.6 2.6 0 1 1 0 5.2a2.6 2.6 0 1 1 0-5.2ZM2.5 14.5c0-3.2 2.4-5.4 5.5-5.4s5.5 2.2 5.5 5.4Z',
  sup: 'M1.5 3h13v3h-13ZM2.5 7h11v7h-11ZM6 8.6h4v1.4H6Z',
  comp: 'M7 1h2l.4 2 1.5.6 1.7-1.2 1.4 1.4-1.2 1.7.6 1.5 2 .4v2l-2 .4-.6 1.5 1.2 1.7-1.4 1.4-1.7-1.2-1.5.6L9 15H7l-.4-2-1.5-.6-1.7 1.2-1.4-1.4 1.2-1.7L2.6 9 1 9V7l2-.4.6-1.5L2.4 3.4l1.4-1.4 1.7 1.2L7 2.6ZM8 5.6a2.4 2.4 0 1 0 0 4.8a2.4 2.4 0 1 0 0-4.8Z',
  fuel: 'M3.5 3.5h6l3 3v8h-9ZM4.5 1h4v2h-4ZM5.6 8l1-1 1.4 1.4L9.4 7l1 1-1.4 1.4 1.4 1.4-1 1-1.4-1.4-1.4 1.4-1-1L7 9.4Z',
  elec: 'M4 4h8v8H4ZM6 6v4h4V6ZM5 1.5h1v2H5ZM7.5 1.5h1v2h-1ZM10 1.5h1v2h-1ZM5 12.5h1v2H5ZM7.5 12.5h1v2h-1ZM10 12.5h1v2h-1ZM1.5 5h2v1h-2ZM1.5 7.5h2v1h-2ZM1.5 10h2v1h-2ZM12.5 5h2v1h-2ZM12.5 7.5h2v1h-2ZM12.5 10h2v1h-2Z',
  rare: 'M4.5 2h7l3 4-6.5 8.5L1.5 6ZM5.3 3.2 3.4 5.8h2.7ZM10.7 3.2 9.9 5.8h2.7Z',
  rp: 'M5.5 1.5h5v1.3h-.9v3.4l3.9 6.3c.6 1-.1 2.2-1.2 2.2H3.7c-1.1 0-1.8-1.2-1.2-2.2l3.9-6.3V2.8h-.9ZM5 10.2h6l-1.9-3.1V2.8H6.9v4.3Z',
  army: 'M2 10.5c0-3.6 2.7-6.3 6-6.3s6 2.7 6 6.3ZM.8 11.5h14.4v1.6H.8Z',
};
const TICON = {
  map: 'M1.5 3.5l4-1.5 5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5ZM5.5 2v10.5M10.5 3.5V14',
  forces: 'M1.5 10.5h13l-1.5 3h-10ZM2.5 10.5V8h10.5v2.5M5 8l.8-2.5h4.4L11 8M10.5 6.2h4.5',
  dip: 'M3 14.5V1.5M3 2.5h9.5l-2 3 2 3H3',
  tech: 'M5.5 1.5h5M6.8 1.5v4.6l-3.9 6.3c-.5.9.1 1.9 1.1 1.9h8c1 0 1.6-1 1.1-1.9L9.2 6.1V1.5M4.4 10h7.2',
  market: 'M1.8 6h12.4l-1.6 7.5H3.4ZM5 6l3-4 3 4M6 8.5v2.8M10 8.5v2.8',
  intel: 'M1.5 14.5h13M4 12.5V8M8 12.5V3.5M12 12.5V6',
};
const ico = (k, cls) => `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 16 16" aria-hidden="true"><path d="${ICON[k]}" fill-rule="evenodd"/></svg>`;
const tico = k => `<svg class="ico t" viewBox="0 0 16 16" aria-hidden="true"><path d="${TICON[k]}"/></svg>`;
const figSvg = t => `<svg class="fico" viewBox="-7 -5.5 14 11" aria-hidden="true"><path d="${FIG[FIG_OF[t]]}"/></svg>`;
// numbers that fit: 1234 stays, 12345 becomes 12.3k
const kfmt = v => { v = Math.floor(v); return Math.abs(v) >= 100000 ? Math.round(v / 1000) + 'k' : Math.abs(v) >= 10000 ? (Math.round(v / 100) / 10) + 'k' : String(v); };
// a cost as icon chips
const costH = c => S.RES.filter(k => c[k]).map(k => `<span class="cs">${ico(k)}${c[k]}</span>`).join('');
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
  if (a.mv) return Math.max(0, a.mv.dur - a.mv.t) + S.routeTime(a, a.route, a.mv.tn);
  return S.routeTime(a, a.route, a.n);
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
  <h4>Output per second</h4><div class="prod">${S.RES.filter(k => r[k] >= 0.005).map(k => `<span class="cs" title="${S.RESN[k].n}">${ico(k)}${f2(r[k])}</span>`).join('')}${r.rp >= 0.005 ? `<span class="cs" title="Research">${ico('rp')}${f2(r.rp)}</span>` : ''}</div>`;
  if (mine) {
    h += '<h4>Recruit here</h4>';
    for (const cat of S.CATS) {
      const list = UT.filter(t => UNITS[t].cat === cat && (UNITS[t].dom !== 'sea' || d.coast));
      if (!list.length) continue;
      h += `<div class="cat">${cat}</div><div class="ugrid">`;
      for (const t of list) {
        const c = S.unitCost(t), U = UNITS[t];
        if (!S.canTrain(p, t)) { h += `<button class="btn unit dim" disabled title="${U.d}"><span class="un">${figSvg(t)}${U.n}</span><small class="need">${S.needText(p, t)}</small></button>`; continue; }
        const ok = S.canPay(n, c);
        h += `<button class="btn unit ${ok ? '' : 'dim'}" data-act="recruit" data-p="${pid}" data-t="${t}" title="${U.d}"><span class="un">${figSvg(t)}${U.n}</span><span class="cost">${costH(c)}<span class="cs tm">${fmtDur(S.trainTime(p, t))}</span></span><small class="st">Atk ${U.atk} &middot; HP ${U.hp} &middot; Spd ${U.spd}</small><small class="ef">${U.d}</small></button>`;
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
      h += `<button class="btn bld ${ok ? '' : 'dim'}" data-act="build" data-p="${pid}" data-k="${k}"><span class="bn">${B.n}${pips}</span><small>${plan ? 'To level ' + (plan + 1) : 'Build'} &middot; ${fmtDur(S.buildTime(k, plan, m))}</small><span class="cost">${costH(c)}</span><small class="ef">${B.d}</small></button>`;
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
    h += `<tr title="${U.d}"><td>${figSvg(t)} ${U.n}</td><td class="mono" data-bind="ac:${a.id}:${t}">${f1(a.u[t])}</td><td class="mono">${f1(atk)}</td><td class="mono">${Math.round(hp)}</td><td class="mono">${U.spd}</td></tr>`;
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
    if (g.armies.filter(x => x.owner === a.owner && x.at === a.at && x.n === a.n && !x.mv && !x.strike && S.domOf(x) === dom).length > 1) h += `<button class="btn" data-act="merge" data-p="${a.at}" data-n="${a.n}" data-k="${dom}">Merge all ${dom === 'sea' ? 'fleets' : dom === 'msl' ? 'salvos' : 'armies'} here</button>`;
  }
  h += `<button class="btn" data-act="selprov" data-p="${here}">Province</button><button class="btn warn" data-act="disband" data-a="${a.id}">Disband</button></div>`;
  return h;
}

function mapPanel() {
  const g = G();
  if (UI.selA) { const a = army(UI.selA); if (a) return armyCard(a); UI.selA = null; }
  if (UI.selP != null) return provCard(UI.selP);
  return missionsHtml() + `<div class="hd"><h3>Orders</h3></div>
  <p class="note">Troops march along the roads. Drag an army onto any waypoint or city to send it there (or tap the army, then the spot). Tap any province for details, recruiting and city buildings. Pinch or scroll to zoom; city names appear as you zoom in.</p>
  <div class="btns"><button class="btn" data-act="homefocus">Go to my capital</button></div>`;
}

// the player's missions: goal, progress and reward
function missionsHtml() {
  const g = G(), ms = g.missions;
  if (me() < 0 || !ms) return '';
  let h = `<div class="hd"><h3>Missions</h3><small>${ms.done} done</small></div>`;
  if (!ms.list.length) return h + '<p class="note">New missions are on their way.</p>';
  for (const m of ms.list) {
    const { have, need } = S.mInfo(m), pct = Math.round(100 * have / need);
    const cnt = need > 1 ? ` <span class="mono">${Math.floor(have)}/${need}</span>` : '';
    h += `<div class="row mis"><div class="grow"><div class="nm">${m.t}${cnt}</div><div class="sub">${m.d}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="sub rew">Reward: ${S.rewardText(m.rew)}</div></div>`;
    h += `<div class="mbt">${m.tgt != null ? `<button class="btn" data-act="mfocus" data-p="${m.tgt}">Show</button>` : ''}<button class="btn" data-act="mskip" data-x="${m.id}"><small style="margin:0">Skip</small></button></div></div>`;
  }
  return h;
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
    if (list.length) h += `<div class="cat">${cat}</div><div class="kvs">${list.map(t => `<div class="kv"><span>${figSvg(t)} ${UNITS[t].n}</span><b>${Math.round(tot[t])}</b></div>`).join('')}</div>`;
  }
  h += `<div class="kvs"><div class="kv"><span>Upkeep / s</span><b>${f1(n.rate.up)}</b></div></div>`;
  h += '<h4>Armies</h4>';
  if (!mine.length) h += '<p class="note">No armies. Recruit units in one of your provinces.</p>';
  for (const a of mine) {
    const st = a.mv ? `${a.strike ? 'striking' : 'heading to'} ${pname(a.mv.to)}` : (g.provs[a.at].battle ? 'in battle' : 'at ' + pname(a.at));
    h += `<div class="row" tabindex="0" data-act="selarmy" data-a="${a.id}"><span class="figs">${figsOf(a).map(f => `<svg class="fico" viewBox="-7 -5.5 14 11" aria-hidden="true"><path d="${FIG[f]}"/></svg>`).join('')}</span><div class="grow"><div class="nm">${KIND[S.domOf(a)]} ${a.id} <span class="sub">${st}</span></div><div class="sub">${fmtU(a.u)}</div></div></div>`;
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
    h += `<div class="cat">${br}</div><div class="ugrid">`;
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

// the world market: sell surplus for cash, buy what runs short
function marketPanel() {
  const m = me(); if (m < 0) return '<p class="note">Observing.</p>';
  const n = nat(m), g = G(), fee = S.mktFee(m), auto = n.auto || {};
  let h = `<div class="hd"><h3>Market</h3><small>fee ${Math.round(fee * 100)}%</small></div>`;
  h += `<p class="note">Every nation trades here. Selling pushes a price down and buying pushes it up, and prices drift back over a few minutes, so sell in steps. ${fee > 0.06 ? 'A trade pact with any nation halves the fee.' : 'Your trade pact halves the fee.'}</p>`;
  h += `<div class="kvs"><div class="kv"><span>Cash</span><b>$${Math.floor(n.cash)}</b></div><div class="kv"><span>Net from trade</span><b class="${(n.mktNet || 0) >= 0 ? 'up' : 'down'}">${(n.mktNet || 0) >= 0 ? '+' : '-'}$${Math.abs(Math.round(n.mktNet || 0))}</b></div></div>`;
  for (const k of S.MKT_RES) {
    const p = S.mktPrice(k), prev = S.MKT_BASE[k] * g.mkt.prev[k];
    const tr = p > prev * 1.03 ? ' <span class="up">\u25b2</span>' : p < prev * 0.97 ? ' <span class="down">\u25bc</span>' : '';
    h += `<div class="mrow"><div class="mtop"><b>${ico(k)}${S.RESN[k].n}</b><span class="mono">${Math.floor(n[k])} <em class="${n.rate[k] >= 0 ? 'up' : 'down'}">${sgn(n.rate[k])}/s</em></span></div>`;
    h += `<div class="sub mono">sell $${f2(p * (1 - fee))} \u00b7 buy $${f2(p * (1 + fee))} each${tr} \u00b7 ${Math.round(100 * g.mkt.idx[k])}% of normal</div><div class="btns">`;
    for (const q of [50, 250]) {
      const qt = S.mktQuote(m, k, -q), ok = n[k] >= q && qt.cash >= 0.5;
      h += `<button class="btn${ok ? '' : ' dim'}" ${ok ? `data-act="trade" data-k="${k}" data-x="${-q}"` : 'disabled'}>Sell ${q}<small>+$${Math.round(qt.cash)}</small></button>`;
    }
    for (const q of [50, 250]) {
      const qt = S.mktQuote(m, k, q), ok = n.cash >= qt.cash;
      h += `<button class="btn${ok ? '' : ' dim'}" ${ok ? `data-act="trade" data-k="${k}" data-x="${q}"` : 'disabled'}>Buy ${q}<small>-$${Math.round(qt.cash)}</small></button>`;
    }
    const cur = auto[k] || 0, i = S.AUTO_STEPS.indexOf(cur), nx = S.AUTO_STEPS[(i + 1) % S.AUTO_STEPS.length];
    h += `<button class="btn" data-act="autosell" data-k="${k}" data-x="${nx}">Auto-sell<small>${cur ? 'above ' + cur : 'off'}</small></button></div></div>`;
  }
  h += '<p class="note">Auto-sell sells anything above the level you pick every few seconds, also while you are away. Tap it to step through off, 250, 500, 1000 and 2500.</p>';
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
  h += updatesHtml();
  h += `<details><summary>How to play</summary>
  <p>Drag an army badge onto a province to send it there, or tap the badge and then the province. Land armies only travel along the road network (the thin lines; the small triangles are waypoints) and can stop and dig in at any waypoint or city. The dashed line shows the route, and red means there is no way through. One that runs into a fight on the way stops to fight, then carries on once it wins. Armies need passage rights to cross land you are at peace with.</p>
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
  else if (UI.tab === 'market') h = marketPanel();
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
    if (UI.selP == null && !UI.selA && g.missions) s += '|' + g.missions.done + ':' + g.missions.list.map(x => x.id + '.' + Math.floor(S.mInfo(x).have * 20 / S.mInfo(x).need)).join(',');
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
  } else if (UI.tab === 'market') {
    if (n) s += '|' + S.MKT_RES.map(k => [Math.floor(n[k] / 10), Math.round(S.mktPrice(k) * 100), (n.auto || {})[k] || 0].join(':')).join(',') + '|' + Math.floor(n.cash / 10) + '|' + S.mktFee(m);
  } else if (UI.tab === 'tech') {
    if (n) s += '|' + Object.keys(n.tech).join(',') + '|' + (n.rs ? n.rs.k : '') + '|' + f2(n.rate.rp);
  } else if (UI.tab === 'dip') {
    if (m < 0) return s + '|observer';
    s += `|${UI.dipOpen}|${UI.dipMsg}|` + g.proposals.map(p => p.id).join(',') + '|' + g.nations.filter(o => o.alive).map(o => o.id + statusTags(m, o.id).length + Math.round(S.opinion(o.id, m).total / 4)).join(',');
  } else {
    s += '|' + g.seq + '|' + g.opts.pace + g.opts.away + '|' + UPD.state + '|' + g.nations.map(o => (o.alive ? 1 : 0) + ':' + S.D.owned[o.id].length).join(',');
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
  const chip = (k, lab, val, rate) => `<span class="rs" title="${lab}"${k === 'cash' || k === 'rp' ? '' : ' data-act="mkt"'}>${ico(k)}<b>${kfmt(val)}</b>${rate == null ? '' : `<em class="${rate >= 0 ? 'up' : 'down'}">${sgn(rate)}</em>`}</span>`;
  const units = S.D.armiesBy[m].reduce((s, a) => s + S.unitCount(a.u), 0);
  const resH = chip('cash', 'Cash', n.cash, r.net) + S.RES.filter(k => k !== 'cash').map(k => chip(k, S.RESN[k].n, n[k], r[k])).join('') + chip('rp', 'Research points', n.rp, r.rp) + chip('army', 'Units in your armies', units, null);
  if (resH !== UI.resH) { $('#res').innerHTML = resH; UI.resH = resH; }
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
  let badSave = '';
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (s) { const o = JSON.parse(s); badSave = S.saveWhy(o); if (!badSave) saved = { day: clockText(o.t, o.opts.pace || 1), who: o.opts.player >= 0 ? o.nations[o.opts.player].short : 'Observer' }; }
  } catch (_) { badSave = 'The save is damaged.'; }
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
  ${badSave ? `<p class="note">Your saved game cannot be continued. ${badSave}</p>` : ''}
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
  if (m >= 0) toast('Your armies are the badges: the figure shows the troop type, the number the unit count. Drag one along the roads to move it.', 'ok');
}
function saveNow(quiet) {
  try { stamp(); localStorage.setItem(SAVE_KEY, S.serialize()); if (!quiet) toast('Game saved', 'ok'); }
  catch (_) { if (!quiet) toast('Could not save in this browser', 'bad'); }
}
function loadSaved() {
  let s;
  try { s = localStorage.getItem(SAVE_KEY); } catch (_) { return false; }
  if (!s) return false;
  try {
    const o = JSON.parse(s);
    if (o.build !== BINFO.version || o.v !== S.SAVE_V) { try { localStorage.setItem(BACKUP_KEY, s); } catch (_) {} }
    S.load(s); afterStart(); resumeFromSave(); return true;
  } catch (e) { toast('Could not continue: ' + (e.message || 'the save is damaged'), 'bad'); return true; }
}
// remember when (in real time) the world was last advanced, and whether it was paused
function stamp() { const g = G(); if (g) { g.wall = Date.now(); g.paused = UI.speed === 0; g.build = BINFO.version; } }
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

// ------------------------------------------------------------ updates
// New versions are published as GitHub releases of BINFO.repo (tag v1.2.3, with the APK and index.html attached).
// The Android app downloads the new APK; the web copy on GitHub Pages just reloads. Other copies (the Claude
// artifact, a local file) do not go online at all.
const SEEN_KEY = 'frontline_usa_seen_version';
const UPD = { state: 'idle', rel: null, at: 0, msg: '' };   // state: idle, checking, current, newer, error
const inApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const onPages = () => /\.github\.io$/.test(location.hostname);
const canCheck = () => !!BINFO.repo && typeof fetch === 'function' && (inApp() || onPages());
const relUrl = () => `https://github.com/${BINFO.repo}/releases/latest`;
const verCode = v => { const m = /(\d+)\.(\d+)\.(\d+)/.exec(v || ''); return m ? +m[1] * 10000 + +m[2] * 100 + +m[3] : 0; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
async function checkUpdate(manual) {
  if (!canCheck() || UPD.state === 'checking') return;
  UPD.state = 'checking'; UPD.at = Date.now(); if (manual) dirty();
  try {
    const r = await fetch(`https://api.github.com/repos/${BINFO.repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 404 ? 'no release published yet' : 'server answered ' + r.status);
    const j = await r.json(), apk = (j.assets || []).find(a => /\.apk$/i.test(a.name));
    UPD.rel = {
      version: String(j.tag_name || '').replace(/^v/, ''), date: (j.published_at || '').slice(0, 10),
      notes: String(j.body || '').split('\n').filter(l => /^\s*[-*] /.test(l)).map(l => l.replace(/^\s*[-*] /, '').trim()),
      apk: apk ? apk.browser_download_url : null, page: j.html_url || relUrl(),
    };
    const newer = verCode(UPD.rel.version) > BINFO.code;
    UPD.state = newer ? 'newer' : 'current';
    if (newer && !UPD.told) { UPD.told = true; toast(`Version ${UPD.rel.version} is out. Get it under Updates in the Intel tab.`, 'ok'); }
    if (manual && !newer) toast('You have the latest version', 'ok');
  } catch (e) {
    UPD.state = 'error'; UPD.msg = (e && e.message) || 'offline';
    if (manual) toast('Could not check for updates (' + UPD.msg + ')', 'bad');
  }
  const b = $('#updBadge'); if (b) b.hidden = UPD.state !== 'newer';
  dirty();
}
function getUpdate() {
  const rel = UPD.rel;
  if (!rel) return;
  if (UI.started && G()) saveNow(true);
  if (inApp()) {
    // the app hands links outside itself to the phone's browser, which downloads the APK; tapping it installs over this one
    location.href = rel.apk || rel.page;
    toast('Downloading. When it finishes, open the file to install. Your game is saved and carries over.', 'ok');
  } else location.replace(location.pathname + '?v=' + encodeURIComponent(rel.version));
}
function restoreBackup() {
  try {
    const b = localStorage.getItem(BACKUP_KEY);
    if (!b) { toast('No backup', 'bad'); return; }
    if (UI.confirm !== 'restore') { UI.confirm = 'restore'; dirty(); return; }
    UI.confirm = '';
    localStorage.setItem(SAVE_KEY, b); localStorage.removeItem(BACKUP_KEY);
    S.load(b); afterStart(); toast('Backup restored', 'ok');
  } catch (e) { toast('Could not restore: ' + (e.message || 'damaged backup'), 'bad'); }
}
function updatesHtml() {
  const rel = UPD.rel, newer = UPD.state === 'newer';
  let h = `<h4>Updates</h4><p class="note">You have version ${BINFO.version}${BINFO.date ? ' (' + BINFO.date + ')' : ''}.`;
  if (!canCheck()) h += ` This copy does not check for updates. The newest version and the Android app are on the <a href="${relUrl()}" target="_blank" rel="noopener">releases page</a>.</p>`;
  else {
    h += ' ' + ({ idle: '', checking: 'Checking&hellip;', current: 'It is the latest.', error: 'Could not reach the update server.' }[UPD.state] || '');
    h += newer ? ` <b>Version ${esc(rel.version)} is out${rel.date ? ' (' + rel.date + ')' : ''}.</b>` : '';
    h += '</p><div class="btns">';
    if (newer) h += `<button class="btn pri" data-act="updget">${inApp() ? (rel.apk ? 'Download update' : 'Open release page') : 'Reload to update'}</button>`;
    h += `<button class="btn" data-act="updcheck"${UPD.state === 'checking' ? ' disabled' : ''}>Check for updates</button></div>`;
    if (newer && inApp()) h += '<p class="note">Android asks once to allow installs from your browser. Your saved game carries over to the new version.</p>';
  }
  const notes = newer && rel.notes.length ? rel.notes : BINFO.notes, nv = newer && rel.notes.length ? rel.version : BINFO.version;
  if (notes.length) h += `<details><summary>What's new in ${esc(nv)}</summary>${notes.map(n => `<p>${esc(n)}</p>`).join('')}</details>`;
  let backup = false; try { backup = !!localStorage.getItem(BACKUP_KEY); } catch (_) {}
  if (backup) h += `<div class="btns"><button class="btn${UI.confirm === 'restore' ? ' warn' : ''}" data-act="restore">${UI.confirm === 'restore' ? 'Tap again: replace this game with the backup' : 'Restore save from before the last update'}</button></div>`;
  return h;
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
    case 'trade': { const r = S.cmdTrade(m, d.k, +d.x); toast(r.msg, r.ok ? 'ok' : 'bad'); UI.touch = 0; dirty(); break; }
    case 'autosell': { const r = S.cmdAutoSell(m, d.k, +d.x); toast(r.msg, r.ok ? 'ok' : 'bad'); UI.touch = 0; dirty(); break; }
    case 'research': { const r = S.cmdResearch(m, d.k); toast(r.msg, r.ok ? 'ok' : 'bad'); dirty(); break; }
    case 'cancelresearch': { const r = S.cmdCancelResearch(m); toast(r.msg, r.ok ? 'ok' : 'bad'); dirty(); break; }
    case 'cancelbuild': { const r = S.cmdCancelBuild(m, +d.p); toast(r.msg, r.ok ? 'ok' : 'bad'); dirty(); break; }
    case 'selarmy': selectArmy(+d.a); break;
    case 'selprov': selectProv(+d.p); break;
    case 'stop': S.cmdStop(+d.a); toast('Halting at the next stop', 'ok'); dirty(); break;
    case 'split': { const r = S.cmdSplit(+d.a, d.k); toast(r.msg, r.ok ? 'ok' : 'bad'); if (r.ok) { UI.selA = r.id; } dirty(); break; }
    case 'merge': { const r = S.cmdMerge(m, +d.p, d.k, d.n != null ? +d.n : null); toast(r.msg, r.ok ? 'ok' : 'bad'); if (r.ok) UI.selA = r.id; dirty(); break; }
    case 'disband': S.cmdDisband(+d.a); UI.selA = null; toast('Army disbanded', 'ok'); dirty(); break;
    case 'mfocus': selectProv(+d.p); focusOn(+d.p, 2.2); break;
    case 'mskip': { const r = S.cmdSkipMission(+d.x); toast(r.msg, r.ok ? 'info' : 'bad'); UI.touch = 0; dirty(); break; }
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
    case 'updcheck': checkUpdate(true); break;
    case 'updget': getUpdate(); break;
    case 'restore': restoreBackup(); break;
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
  document.querySelectorAll('#tabs button').forEach(b => { if (TICON[b.dataset.v] && !b.querySelector('.ico')) b.insertAdjacentHTML('afterbegin', tico(b.dataset.v)); });
  requestAnimationFrame(frame);
  setTimeout(paintTerrain, 60);
  if (data.save) { try { S.load(data.save); afterStart(); if (data.ui) { UI.speed = data.ui.speed === undefined ? 1 : data.ui.speed; setSpeed(UI.speed); } return; } catch (_) {} }
  showStart();
}
const hot = window.claude && window.claude.hot;
try { if (hot && hot.snapshot) hot.snapshot(() => ({ save: UI.started && G() ? S.serialize() : null, ui: { speed: UI.speed } })); } catch (_) {}
if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (UI.started && G() && !UI.modal) saveNow(true); }
  else if (Date.now() - UPD.at > 3600e3) checkUpdate(false);
});
setTimeout(() => checkUpdate(false), 8000);
setInterval(() => checkUpdate(false), 6 * 3600e3);
try {
  const seen = localStorage.getItem(SEEN_KEY);
  if (seen && seen !== BINFO.version) setTimeout(() => toast(`Updated to version ${BINFO.version}. See what's new under Updates in the Intel tab.`, 'ok'), 1500);
  localStorage.setItem(SEEN_KEY, BINFO.version);
} catch (_) {}
window.__flusa = { UI, S, drawMap, renderPanel, catchUp, fmtDur };
})();
