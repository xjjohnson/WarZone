// Adds the road network to mapdata.json: `nodes` [[x, y, pid], ...] and `roads` [[a, b], ...]
// (a third number is a sea lane's travel distance). Run after buildmap.mjs: node buildroads.mjs
//
// Node i < number of provinces is that province's city (its px, py). The rest are waypoints spread
// through each province (a Poisson-disk scatter), joined by a Gabriel graph so the roads look like a
// mesh of triangles that never cross. A road stays inside the one or two provinces it links, every
// province's roads are connected, and every pair of neighbouring provinces gets at least one road.
import fs from 'fs';

const SPACING = 15;          // map units between waypoints
const EDGE_GAP = 2.5;        // keep waypoints this far from a province border
const MAX_ROAD = 2.3 * SPACING;

const map = JSON.parse(fs.readFileSync('mapdata.json', 'utf8'));
const P = map.provinces, NP = P.length;

// province outlines as rings of points (paths only use M, L and Z)
const rings = P.map(p => p.d.split('M').filter(Boolean).map(s => s.replace(/Z/g, '').split('L').map(q => q.split(',').map(Number))));
const bbox = rings.map(rs => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
});
function inside(pid, x, y) {
  const b = bbox[pid];
  if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  let c = false;
  for (const r of rings[pid]) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function edgeDist(pid, x, y) {
  let best = Infinity;
  for (const r of rings[pid]) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, ay] = r[j], [bx, by] = r[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}
// deterministic pseudo-random numbers
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const nodes = P.map(p => [p.px, p.py, p.id]);
const tooClose = (x, y, r) => nodes.some(n => (n[0] - x) ** 2 + (n[1] - y) ** 2 < r * r);
for (let pid = 0; pid < NP; pid++) {
  const [x0, y0, x1, y1] = bbox[pid];
  // jittered grid candidates, accepted when far enough from every node already placed
  const cands = [];
  for (let y = y0; y <= y1; y += SPACING * 0.5) for (let x = x0; x <= x1; x += SPACING * 0.5)
    cands.push([x + (rnd() - 0.5) * SPACING * 0.5, y + (rnd() - 0.5) * SPACING * 0.5, rnd()]);
  cands.sort((a, b) => a[2] - b[2]);
  for (const [x, y] of cands) {
    if (!inside(pid, x, y) || tooClose(x, y, SPACING)) continue;
    if (edgeDist(pid, x, y) < EDGE_GAP) continue;
    nodes.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, pid]);
  }
}
const N = nodes.length;
const byProv = P.map(() => []);
nodes.forEach((n, i) => byProv[n[2]].push(i));
const nb = P.map(p => new Set(p.nbrs));
const d2 = (a, b) => (nodes[a][0] - nodes[b][0]) ** 2 + (nodes[a][1] - nodes[b][1]) ** 2;

// a road may only run through the provinces at its two ends
function staysIn(a, b) {
  const pa = nodes[a][2], pb = nodes[b][2];
  for (let k = 1; k < 10; k++) {
    const x = nodes[a][0] + (nodes[b][0] - nodes[a][0]) * k / 10, y = nodes[a][1] + (nodes[b][1] - nodes[a][1]) * k / 10;
    if (!inside(pa, x, y) && !inside(pb, x, y)) return false;
  }
  return true;
}
const roads = new Map();
const key = (a, b) => a < b ? a + ':' + b : b + ':' + a;
const add = (a, b, d) => { if (!roads.has(key(a, b))) roads.set(key(a, b), d ? [Math.min(a, b), Math.max(a, b), d] : [Math.min(a, b), Math.max(a, b)]); };
for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
  const pa = nodes[a][2], pb = nodes[b][2];
  if (pa !== pb && !nb[pa].has(pb)) continue;
  const dab = d2(a, b);
  if (dab > MAX_ROAD * MAX_ROAD) continue;
  // Gabriel test: no other node inside the circle whose diameter is a-b
  const mx = (nodes[a][0] + nodes[b][0]) / 2, my = (nodes[a][1] + nodes[b][1]) / 2, r2 = dab / 4;
  let ok = true;
  for (let c = 0; c < N && ok; c++) if (c !== a && c !== b && (nodes[c][0] - mx) ** 2 + (nodes[c][1] - my) ** 2 < r2 * 0.98) ok = false;
  if (ok && staysIn(a, b)) add(a, b);
}
// join two node sets by their closest pair
function closest(A, B) {
  let best = null, bd = Infinity;
  for (const a of A) for (const b of B) { const d = d2(a, b); if (d < bd) { bd = d; best = [a, b]; } }
  return best;
}
// connect each province's own roads
const adj = () => { const g = Array.from({ length: N }, () => []); for (const [a, b] of roads.values()) { g[a].push(b); g[b].push(a); } return g; };
for (let pid = 0; pid < NP; pid++) {
  for (;;) {
    const g = adj(), own = new Set(byProv[pid]), seen = new Set([pid]), st = [pid];
    while (st.length) { const u = st.pop(); for (const v of g[u]) if (own.has(v) && !seen.has(v)) { seen.add(v); st.push(v); } }
    if (seen.size === own.size) break;
    const [a, b] = closest([...seen], byProv[pid].filter(i => !seen.has(i)));
    add(a, b);
  }
}
// every pair of neighbours gets a road; sea lanes join the two cities and carry their distance
const lane = {};
for (const [a, b, d] of map.sea) lane[key(a, b)] = d;
let added = 0;
for (const p of P) for (const q of p.nbrs) {
  if (q < p.id) continue;
  if (lane[key(p.id, q)]) { add(p.id, q, lane[key(p.id, q)]); continue; }
  const has = [...roads.values()].some(([a, b]) => (nodes[a][2] === p.id && nodes[b][2] === q) || (nodes[a][2] === q && nodes[b][2] === p.id));
  if (!has) { const [a, b] = closest(byProv[p.id], byProv[q]); add(a, b); added++; }
}
map.nodes = nodes;
map.roads = [...roads.values()];
fs.writeFileSync('mapdata.json', JSON.stringify(map));
console.log(N, 'nodes,', map.roads.length, 'roads,', added, 'border links added');
