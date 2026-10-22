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

const UI = {
  tab: 'map', selP: null, selA: null, speed: 1, dipOpen: null, dipMsg: '', confirm: '', lastSeq: 0, started: false, modal: false,
  view: { cx: MAP.w / 2, cy: MAP.h / 2, scale: 1 }, fit: 1, W: 0, H: 0, bk: 1, sig: '', down: 0, viewInit: false, log: false, touch: 0,
};

// ------------------------------------------------------------ svg helpers
const svg = $('#map');
const L = {};
const provEls = [], bdEls = [], labEls = [], fillCache = [], bdCache = [];
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
  mk('path', { d: MAP.coast, class: 'coast' }, L.borders);
  MAP.sea.forEach(([a, b]) => mk('line', { x1: PS[a].cx, y1: PS[a].cy, x2: PS[b].cx, y2: PS[b].cy, class: 'sealane' }, L.lanes));
  MAP.provinces.forEach(p => {
    const t = mk('text', { class: 'lab', x: p.cx, y: p.cy }, L.labels);
    t.textContent = p.abbr;
    labEls[p.id] = t;
    if (p.area < 1200) mk('circle', { cx: p.cx, cy: p.cy, r: 7, class: 'hit', 'data-p': p.id }, L.hits);
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
function applyView() {
  const v = UI.view;
  v.scale = clamp(v.scale, UI.fit * 0.85, UI.fit * 10);
  v.cx = clamp(v.cx, -80, MAP.w + 80); v.cy = clamp(v.cy, -60, MAP.h + 60);
  const w = UI.W / v.scale, h = UI.H / v.scale;
  svg.setAttribute('viewBox', `${(v.cx - w / 2).toFixed(2)} ${(v.cy - h / 2).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
  if (!labEls.length) return;
  const z = v.scale / UI.fit;
  UI.bk = (1 / v.scale) * clamp(1 + 0.14 * Math.log2(z), 0.92, 1.5);
  const fs = (9.5 / v.scale).toFixed(2);
  MAP.provinces.forEach(p => {
    const t = labEls[p.id];
    t.setAttribute('font-size', fs);
    t.setAttribute('y', (p.cy - 4 / v.scale).toFixed(2));
    t.style.display = (p.area < 1200 && z < 2.6) ? 'none' : '';
    t.setAttribute('stroke-width', (1.5 / v.scale).toFixed(2));
  });
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
  if (pts.size === 1) gesture = { moved: false, t: performance.now(), target: e.target, x: e.clientX, y: e.clientY };
  if (pts.size === 2) {
    if (gesture) gesture.moved = true;
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
    if (gesture.moved) { UI.view.cx -= dx / UI.view.scale; UI.view.cy -= dy / UI.view.scale; applyView(); }
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
    if (!g.moved && e.type === 'pointerup' && performance.now() - g.t < 700) { handleTap(g.target); flush(); drawMap(performance.now()); }
  }
  if (pts.size < 2) pinch = null;
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);
stage.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0016)); }, { passive: false });

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
  const r = S.cmdMove(a.id, pid);
  toast(r.msg + (r.eta ? ` (ETA ${Math.ceil(r.eta)}s)` : ''), r.ok ? 'ok' : 'bad');
  UI.selP = pid; UI.confirm = ''; dirty();
}

// ------------------------------------------------------------ map drawing (per frame)
function makeBadge(a) {
  const n = nat(a.owner);
  const g = mk('g', { class: 'bdg', 'data-a': a.id }, L.armies);
  mk('rect', { x: -11, y: -6.5, width: 22, height: 13, rx: 2, fill: n.color }, g);
  const t = mk('text', { y: 3.3 }, g);
  const d = mk('path', { class: 'dir', d: 'M0 -4L7 0L0 4Z', display: 'none' }, g);
  return { g, t, d, last: '' };
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
      x = PS[a.at].cx + (col - (inRow - 1) / 2) * 25 * bk;
      y = PS[a.at].cy + (9 + row * 15) * bk;
    } else {
      const f = PS[a.mv.from], t = PS[a.mv.to], k = a.mv.dur ? a.mv.t / a.mv.dur : 0;
      x = f.cx + (t.cx - f.cx) * k; y = f.cy + (t.cy - f.cy) * k + 9 * bk;
      ang = Math.atan2(t.cy - f.cy, t.cx - f.cx) * 180 / Math.PI;
    }
    e.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${bk.toFixed(4)})`);
    const txt = String(Math.max(1, Math.round(S.unitCount(a.u))));
    if (e.last !== txt) { e.t.textContent = txt; e.last = txt; }
    const cls = 'bdg' + (a.id === UI.selA ? ' sel' : '') + (a.owner !== me() ? ' foe' : '');
    if (e.g.getAttribute('class') !== cls) e.g.setAttribute('class', cls);
    if (ang === null) e.d.setAttribute('display', 'none');
    else { e.d.setAttribute('display', ''); e.d.setAttribute('transform', `translate(11 0) rotate(${ang.toFixed(0)}) translate(-1 0)`); }
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
  // routes
  L.routes.textContent = '';
  for (const a of g.armies) {
    if (a.owner !== me() || (!a.route.length && !a.mv)) continue;
    const sel = a.id === UI.selA;
    if (!sel && !a.mv) continue;
    const pts2 = [];
    if (a.mv) {
      const f = PS[a.mv.from], t = PS[a.mv.to], k = a.mv.dur ? a.mv.t / a.mv.dur : 0;
      pts2.push([f.cx + (t.cx - f.cx) * k, f.cy + (t.cy - f.cy) * k]);
      pts2.push([t.cx, t.cy]);
    } else pts2.push([PS[a.at].cx, PS[a.at].cy]);
    for (const r of a.route) pts2.push([PS[r].cx, PS[r].cy]);
    if (pts2.length < 2) continue;
    mk('path', { d: 'M' + pts2.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L'), class: 'route' + (sel ? '' : ' faint'), 'stroke-width': ((sel ? 1.9 : 1.2) / UI.view.scale).toFixed(2), 'stroke-dasharray': `${(5 / UI.view.scale).toFixed(1)} ${(4 / UI.view.scale).toFixed(1)}` }, L.routes);
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
const fmtU = u => UT.filter(t => u[t] >= 0.5).map(t => `${Math.round(u[t])} ${UNITS[t].s}`).join(' · ') || 'no units';
const dotOf = n => `<i class="dot" style="background:${n.color}"></i>`;
const costStr = c => [c.c ? '$' + c.c : '', c.st ? c.st + ' st' : '', c.f ? c.f + ' fu' : ''].filter(Boolean).join(' · ');
const f1 = x => (Math.round(x * 10) / 10).toFixed(1);
const sgn = x => (x >= 0 ? '+' : '') + f1(x);
function statusTags(a, b) {
  let h = '';
  if (S.atWar(a, b)) h += '<span class="tag war">War</span> ';
  if (S.allied(a, b)) h += '<span class="tag good">Ally</span> ';
  if (S.hasTreaty(a, b, 'trade')) h += '<span class="tag">Trade</span> ';
  if (S.hasTreaty(a, b, 'nap')) h += '<span class="tag">Pact</span> ';
  if (S.hasTreaty(a, b, 'access') && !S.allied(a, b)) h += '<span class="tag">Passage</span> ';
  const tl = S.truceLeft(a, b);
  if (tl > 0) h += `<span class="tag hot">Truce ${Math.ceil(tl)}s</span> `;
  return h;
}
function etaOf(a) {
  if (a.mv) return Math.max(0, a.mv.dur - a.mv.t) + S.routeTime(a, a.route, a.mv.to);
  return S.routeTime(a, a.route, a.at);
}

function provCard(pid) {
  const g = G(), p = g.provs[pid], d = PS[pid], o = nat(p.owner), m = me(), mine = p.owner === m;
  const r = S.provRates(pid), n = nat(m >= 0 ? m : 0);
  let h = `<div class="hd">${dotOf(o)}<h3>${d.name}</h3><small>${d.abbr}</small>`;
  if (o.capital === pid) h += '<span class="tag hot">Capital</span>';
  if (p.battle) h += '<span class="tag war">Battle</span>';
  if (p.cap) h += '<span class="tag war">Occupied</span>';
  h += '</div>';
  h += `<div class="note">${mine ? 'Yours' : o.name}${!mine && m >= 0 ? ' &middot; ' + statusTags(m, p.owner) : ''}</div>`;
  h += `<div class="kvs">
    <div class="kv"><span>Population</span><b>${d.pop} M</b></div>
    <div class="kv"><span>Garrison</span><b data-bind="g:${pid}">${f1(p.garrison)}/${f1(S.maxGar(p))}</b></div>
    <div class="kv"><span>Defence</span><b>+${Math.round(S.defBonus(p) * 100)}%</b></div>
    <div class="kv"><span>Fort / Infra</span><b>${p.fort} / ${p.infra}</b></div>
    <div class="kv"><span>Unrest</span><b data-bind="un:${pid}">${Math.round(p.unrest * 100)}%</b><div class="bar ${p.unrest > 0.6 ? 'warn' : ''}"><i data-bar="un:${pid}" style="width:${Math.round(p.unrest * 100)}%"></i></div></div>
  </div>
  <div class="note">Produces ${f1(r.c)} cash, ${f1(r.s)} steel, ${f1(r.f)} fuel per second.</div>`;
  if (mine) {
    h += '<h4>Recruit here</h4><div class="btns">';
    for (const t of UT) {
      const c = S.unitCost(t), ok = S.canPay(n, c);
      h += `<button class="btn ${ok ? '' : 'dim'}" data-act="recruit" data-p="${pid}" data-t="${t}">${UNITS[t].n}<small>${costStr(c)} &middot; ${UNITS[t].time}s</small></button>`;
    }
    h += '</div>';
    if (p.q.length) h += `<div class="note">Training: ${p.q.map((it, i) => `${UNITS[it.type].s} <span class="mono" data-bind="q:${pid}:${i}">${Math.ceil(it.left)}</span>s`).join(' &rarr; ')}</div>`;
    h += '<h4>Build</h4><div class="btns">';
    for (const [k, nm, eff, lvl] of [['fort', 'Fortify', '+25% defence, bigger garrison', p.fort], ['infra', 'Develop', '+25% output', p.infra]]) {
      if (lvl >= S.MAXLVL) h += `<button class="btn dim" disabled>${nm}<small>Maximum level</small></button>`;
      else { const c = S.buildCost(k, lvl), ok = S.canPay(n, c); h += `<button class="btn ${ok ? '' : 'dim'}" data-act="build" data-p="${pid}" data-k="${k}">${nm} to ${lvl + 1}<small>${costStr(c)}</small><small>${eff}</small></button>`; }
    }
    h += '</div>';
  } else if (m >= 0) {
    h += `<div class="btns"><button class="btn" data-act="dipopen" data-n="${p.owner}">Diplomacy with ${o.short}</button></div>`;
  }
  const here = g.armies.filter(a => a.at === pid);
  if (here.length) {
    h += '<h4>Armies here</h4>';
    for (const a of here) {
      const an = nat(a.owner);
      h += `<div class="row" tabindex="0" data-act="selarmy" data-a="${a.id}">${dotOf(an)}<div class="grow"><div class="nm">${an.short}</div><div class="sub">${fmtU(a.u)}</div></div>${a.owner === m ? '<span class="tag">Select</span>' : ''}</div>`;
    }
  }
  return h;
}

function armyCard(a) {
  const g = G(), n = nat(a.owner), here = a.at != null ? a.at : a.mv.to;
  const tot = S.unitCount(a.u) || 1;
  let h = `<div class="hd">${dotOf(n)}<h3>Army ${a.id}</h3><small>${a.at != null ? 'at ' + PS[a.at].abbr : 'to ' + PS[a.mv.to].abbr}</small></div>`;
  h += '<div class="kvs">';
  for (const t of UT) if (a.u[t] >= 0.5) h += `<div class="kv"><span>${UNITS[t].n}</span><b data-bind="ac:${a.id}:${t}">${Math.round(a.u[t])}</b></div>`;
  h += `<div class="kv"><span>Speed</span><b>${S.armySpeed(a)}</b></div></div>`;
  if (a.mv || a.route.length) h += `<div class="note">Marching &middot; ETA <b class="mono" data-bind="eta:${a.id}">${Math.ceil(etaOf(a))}</b>s</div>`;
  else if (g.provs[here].battle) h += '<div class="note down">Engaged in battle.</div>';
  else h += '<div class="note">Waiting for orders. Tap a state on the map to march.</div>';
  if (UI.selP != null && UI.selP !== here) {
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
    if (g.armies.filter(x => x.owner === a.owner && x.at === a.at && !x.mv).length > 1) h += `<button class="btn" data-act="merge" data-p="${a.at}">Merge all here</button>`;
  }
  h += `<button class="btn" data-act="selprov" data-p="${here}">Province</button><button class="btn warn" data-act="disband" data-a="${a.id}">Disband</button></div>`;
  return h;
}

function mapPanel() {
  const g = G();
  if (UI.selA) { const a = army(UI.selA); if (a) return armyCard(a); UI.selA = null; }
  if (UI.selP != null) return provCard(UI.selP);
  return `<div class="hd"><h3>Orders</h3></div>
  <p class="note">Tap an army badge, then tap a state to march. Tap any state for details, recruiting and building. Pinch or scroll to zoom.</p>
  <div class="btns"><button class="btn" data-act="homefocus">Go to my capital</button></div>`;
}

function forcesPanel() {
  const g = G(), m = me(); if (m < 0) return '<p class="note">Observing.</p>';
  const mine = g.armies.filter(a => a.owner === m).sort((a, b) => S.unitPow(b.u) - S.unitPow(a.u));
  const n = nat(m), tot = { inf: 0, art: 0, arm: 0, air: 0 };
  for (const a of mine) for (const t of UT) tot[t] += a.u[t];
  let h = `<h4>Total forces</h4><div class="kvs">${UT.map(t => `<div class="kv"><span>${UNITS[t].n}</span><b>${Math.round(tot[t])}</b></div>`).join('')}<div class="kv"><span>Upkeep / s</span><b>${f1(n.rate.up)}</b></div></div>`;
  h += '<h4>Armies</h4>';
  if (!mine.length) h += '<p class="note">No armies. Recruit units in one of your states.</p>';
  for (const a of mine) {
    const st = a.mv ? `marching to ${PS[a.mv.to].abbr}` : (g.provs[a.at].battle ? 'in battle' : 'at ' + PS[a.at].abbr);
    h += `<div class="row" tabindex="0" data-act="selarmy" data-a="${a.id}"><div class="grow"><div class="nm">Army ${a.id} <span class="sub">${st}</span></div><div class="sub">${fmtU(a.u)}</div></div></div>`;
  }
  const q = g.provs.filter(p => p.owner === m && p.q.length);
  h += '<h4>Training</h4>';
  if (!q.length) h += '<p class="note">Nothing in training.</p>';
  for (const p of q) h += `<div class="row" tabindex="0" data-act="selprov" data-p="${p.id}"><div class="grow"><div class="nm">${PS[p.id].name}</div><div class="sub">${p.q.map(it => UNITS[it.type].s).join(' &rarr; ')}</div></div><span class="num" data-bind="q:${p.id}:0">${Math.ceil(p.q[0].left)}</span></div>`;
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
    if (!S.hasTreaty(m, o.id, 'nap') && !S.allied(m, o.id)) h += btn('nap', 'Non-aggression pact<small>6 min</small>');
    if (!S.hasAccess(m, o.id)) h += btn('access', 'Passage rights<small>6 min, troops may cross</small>');
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
      h += `<div class="row" style="cursor:default">${dotOf(f)}<div class="grow"><div class="nm">${f.short}</div><div class="sub">${p.text} <span class="mono">${Math.max(0, Math.ceil(p.exp - g.t))}s</span></div></div><button class="btn pri" data-act="pyes" data-id="${p.id}">Accept</button><button class="btn" data-act="pno" data-id="${p.id}">Decline</button></div>`;
    }
  }
  h += '<h4>Nations</h4>';
  for (const o of g.nations) {
    if (!o.alive || o.id === m) continue;
    const op = S.opinion(o.id, m).total, open = UI.dipOpen === o.id;
    h += `<div class="row" tabindex="0" data-act="dipopen" data-n="${o.id}"><div class="grow"><div class="nm">${dotOf(o)} ${o.name}</div><div class="sub">${S.D.owned[o.id].length} states &middot; strength ${Math.round(S.D.power[o.id] / 100)} ${statusTags(m, o.id)}</div></div><span class="num ${op >= 0 ? 'up' : 'down'}">${op >= 0 ? '+' : ''}${op}</span></div>`;
    if (open) h += dipDetail(o);
  }
  h += `<p class="note">The number is how each nation feels about you. Breaking a treaty costs reputation with everyone.</p>`;
  return h;
}

function intelPanel() {
  const g = G(), D = S.D, m = me();
  let h = '<h4>Standings</h4><table><tr><th>Nation</th><th>States</th><th>Pop</th><th>Power</th></tr>';
  const rows = g.nations.filter(n => n.alive).sort((a, b) => D.owned[b.id].length - D.owned[a.id].length || D.pop[b.id] - D.pop[a.id]);
  for (const n of rows) h += `<tr><td>${dotOf(n)} ${n.id === m ? '<b>' + n.short + '</b>' : n.short}</td><td class="mono">${D.owned[n.id].length}</td><td class="mono">${Math.round(D.share[n.id] * 100)}%</td><td class="mono">${Math.round(D.power[n.id] / 100)}</td></tr>`;
  h += '</table>';
  const dead = g.nations.filter(n => !n.alive);
  if (dead.length) h += `<p class="note">Fallen: ${dead.map(n => n.short).join(', ')}</p>`;
  h += '<h4>Game</h4><div class="btns"><button class="btn" data-act="save">Save game</button><button class="btn warn" data-act="newgame">New game</button></div>';
  h += `<details><summary>How to play</summary>
  <p>Tap an army badge, then tap a state to march there. Armies need passage rights to cross land you are at peace with.</p>
  <p>Declare war from the Diplomacy tab. A state falls when its garrison is beaten and you hold it for a few seconds.</p>
  <p>Conquered states are restless. Keep troops there, or they rise up and return to their old owners or go independent.</p>
  <p>Armor beats infantry, air beats armor, infantry handles air, artillery shines behind a front. Fortify the border you expect to be hit.</p>
  <p>There is no premium currency and no forced ending. Past 60% of the population the game asks once if you want to stop. The late game keeps going: coalitions form against a runaway power.</p></details>`;
  h += '<h4>Events</h4>';
  const ev = g.log.slice(-40).reverse();
  for (const e of ev) {
    const mm = Math.floor(e.t / 60), ss = Math.floor(e.t % 60);
    h += `<div class="logl ${e.kind}"><time>${mm}:${String(ss).padStart(2, '0')}</time><span>${e.txt}</span></div>`;
  }
  return h;
}

function renderPanel() {
  const el = $('#sheet'), sc = el.scrollTop;
  let h = '';
  if (UI.tab === 'map') h = mapPanel();
  else if (UI.tab === 'forces') h = forcesPanel();
  else if (UI.tab === 'dip') h = dipPanel();
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
    if (UI.selA) s += a ? [a.at, a.mv && a.mv.to, a.route.length, UT.map(t => Math.round(a.u[t])).join(',')].join(':') : 'x';
    if (UI.selP != null) {
      const p = g.provs[UI.selP];
      s += [p.owner, p.fort, p.infra, p.q.length, p.battle ? 1 : 0, p.cap ? 1 : 0, g.armies.filter(x => x.at === UI.selP).map(x => x.id + '.' + x.owner + '.' + Math.round(S.unitCount(x.u))).join('/')].join('|');
      if (n && p.owner === m) s += UT.map(t => S.canPay(n, S.unitCost(t)) ? 1 : 0).join('') + [['fort', p.fort], ['infra', p.infra]].map(([k, l]) => l < S.MAXLVL && S.canPay(n, S.buildCost(k, l)) ? 1 : 0).join('');
      if (UI.selA && a) { const tp = g.provs[UI.selP]; s += S.atWar(a.owner, tp.owner) + '' + S.hasAccess(a.owner, tp.owner); }
    }
  } else if (UI.tab === 'forces') {
    s += g.armies.filter(a => a.owner === m).map(a => a.id + ':' + (a.at != null ? a.at : '>' + a.mv.to) + ':' + Math.round(S.unitCount(a.u))).join(',') + '|' + g.provs.filter(p => p.owner === m).map(p => p.q.length).join('');
  } else if (UI.tab === 'dip') {
    s += `|${UI.dipOpen}|${UI.dipMsg}|` + g.proposals.map(p => p.id).join(',') + '|' + g.nations.filter(o => o.alive).map(o => o.id + statusTags(m, o.id).length + Math.round(S.opinion(o.id, m).total / 4)).join(',');
  } else {
    s += '|' + g.seq + '|' + g.nations.map(o => (o.alive ? 1 : 0) + ':' + S.D.owned[o.id].length).join(',');
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
    else if (k[0] === 'q') { const it = g.provs[+k[1]].q[+k[2]]; v = it ? Math.ceil(it.left) : ''; }
    else if (k[0] === 'ac') { const a = army(+k[1]); v = a ? Math.round(a.u[k[2]]) : ''; }
    else if (k[0] === 'eta') { const a = army(+k[1]); v = a ? Math.ceil(etaOf(a)) : ''; }
    if (v !== null && e.textContent !== String(v)) e.textContent = v;
  });
  document.querySelectorAll('#sheet [data-bar]').forEach(e => {
    const k = e.dataset.bar.split(':');
    if (k[0] === 'un') e.style.width = Math.round(g.provs[+k[1]].unrest * 100) + '%';
  });
}

// ------------------------------------------------------------ header / resources
function renderHeader() {
  const g = G(), m = me(), n = m >= 0 ? nat(m) : null;
  $('#whoName').textContent = n ? n.short : 'Observer';
  $('#whoDot').style.background = n ? n.color : 'var(--ink2)';
  const day = Math.floor(g.t / 2) + 1;
  $('#clock').textContent = `Day ${day}` + (n ? ` · ${S.D.owned[m].length} states` : '');
  if (!n) { $('#res').innerHTML = `<span class="rs"><small>${g.nations.filter(x => x.alive).length} nations alive</small></span>`; return; }
  const r = n.rate;
  const chip = (lab, val, rate) => `<span class="rs"><small>${lab}</small><b>${Math.floor(val)}</b><em class="${rate >= 0 ? 'up' : 'down'}">${sgn(rate)}</em></span>`;
  const units = S.D.armiesBy[m].reduce((s, a) => s + S.unitCount(a.u), 0);
  $('#res').innerHTML = chip('Cash', n.cash, r.net) + chip('Steel', n.steel, r.s) + chip('Fuel', n.fuel, r.f) + `<span class="rs"><small>Army</small><b>${Math.round(units)}</b></span>`;
  const pend = g.proposals.filter(p => p.to === m).length, bd = $('#dipBadge');
  bd.hidden = !pend; bd.textContent = pend;
}

// ------------------------------------------------------------ modals
function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="mwrap">${html}</div>`; m.hidden = false; UI.modal = true; m.scrollTop = 0; }
function closeModal() { $('#modal').hidden = true; UI.modal = false; }
let startDiff = 'normal';
function showStart() {
  let saved = null;
  try { const s = localStorage.getItem(SAVE_KEY); if (s) { const o = JSON.parse(s); saved = { day: Math.floor(o.t / 2) + 1, who: o.opts.player >= 0 ? o.nations[o.opts.player].short : 'Observer' }; } } catch (_) {}
  let cards = '';
  S.NATIONS.forEach((def, i) => {
    const pop = def.states.reduce((s, ab) => s + PS.find(p => p.abbr === ab).pop, 0);
    const inc = def.states.reduce((s, ab) => { const p = PS.find(q => q.abbr === ab); return s + p.cash; }, 0);
    cards += `<button class="nc" data-act="pick" data-v="${i}"><div class="strip" style="background:${def.color}"></div><div class="in"><b>${def.name}</b><span>${def.states.length} states &middot; capital ${def.cap}</span><div class="st">${Math.round(pop)}M people &middot; $${inc.toFixed(1)}/s</div></div></button>`;
  });
  modal(`<div class="title">Frontline<br>USA</div>
  <p class="lede">Real-time grand strategy on the American map. Ten rival powers, one continent. No premium currency, no timers to buy out, no forced ending.</p>
  ${saved ? `<div class="btns"><button class="btn pri" data-act="continue">Continue &middot; ${saved.who}, day ${saved.day}</button></div>` : ''}
  <h4>AI difficulty</h4>
  <div class="opts"><div class="seg" role="group" aria-label="AI difficulty">${['easy', 'normal', 'hard'].map(d => `<button data-act="diff" data-v="${d}" aria-pressed="${d === startDiff}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}</div></div>
  <h4>Choose your nation</h4>
  <div class="cards">${cards}</div>
  <div class="btns"><button class="btn" data-act="pick" data-v="-1">Watch the AI play</button></div>`);
}
function startNew(i) {
  S.newGame({ player: i, diff: startDiff });
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
  if (m >= 0) toast('Your armies are the numbered badges. Tap one, then tap a state.', 'ok');
}
function saveNow(quiet) {
  try { localStorage.setItem(SAVE_KEY, S.serialize()); if (!quiet) toast('Game saved', 'ok'); }
  catch (_) { if (!quiet) toast('Could not save in this browser', 'bad'); }
}
function loadSaved() {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (!s) return false;
    S.load(s); afterStart(); return true;
  } catch (_) { return false; }
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
    case 'diff': startDiff = d.v; document.querySelectorAll('[data-act="diff"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === startDiff))); break;
    case 'continue': if (!loadSaved()) toast('No save found', 'bad'); break;
    case 'recruit': { const r = S.cmdRecruit(m, +d.p, d.t); toast(r.msg, r.ok ? 'ok' : 'bad'); dirty(); break; }
    case 'build': { const r = S.cmdBuild(m, +d.p, d.k); toast(r.msg, r.ok ? 'ok' : 'bad'); dirty(); break; }
    case 'selarmy': selectArmy(+d.a); break;
    case 'selprov': selectProv(+d.p); break;
    case 'stop': S.cmdStop(+d.a); toast('Halting at the next stop', 'ok'); dirty(); break;
    case 'split': { const r = S.cmdSplit(+d.a, d.k); toast(r.msg, r.ok ? 'ok' : 'bad'); if (r.ok) { UI.selA = r.id; } dirty(); break; }
    case 'merge': { const r = S.cmdMerge(m, +d.p); toast(r.msg, r.ok ? 'ok' : 'bad'); if (r.ok) UI.selA = r.id; dirty(); break; }
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
  else if (e.key === '1') setSpeed(1); else if (e.key === '2') setSpeed(2); else if (e.key === '3') setSpeed(4);
  else if (e.key === 'Escape') { UI.selA = null; UI.selP = null; dirty(); }
  else if (e.key === 'Enter' && e.target.matches && e.target.matches('.row')) e.target.click();
});

// ------------------------------------------------------------ frame loop
let last = performance.now(), acc = 0, uiClock = 0, saveClock = 0, lastDraw = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (UI.started && G()) {
    if (UI.speed > 0 && !UI.modal) {
      acc += dt * UI.speed;
      let n = 0;
      while (acc >= 0.25 && n < 40) { S.step(0.25); acc -= 0.25; n++; }
      if (n === 40) acc = 0;
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
    modal(`<div class="title">Dominance</div><p class="lede">Your nation now holds more than 60% of the population. You can stop here and look at the standings, or keep going. The world will not let you rest: neighbours form coalitions, conquered states revolt, and rivals rebuild.</p><div class="btns"><button class="btn pri" data-act="keep">Keep playing</button><button class="btn" data-act="finish">See standings</button></div>`);
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
  if (data.save) { try { S.load(data.save); afterStart(); if (data.ui) { UI.speed = data.ui.speed || 1; setSpeed(UI.speed); } return; } catch (_) {} }
  showStart();
}
const hot = window.claude && window.claude.hot;
try { if (hot && hot.snapshot) hot.snapshot(() => ({ save: UI.started && G() ? S.serialize() : null, ui: { speed: UI.speed } })); } catch (_) {}
if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {});
window.__flusa = { UI, S, drawMap, renderPanel };
})();
