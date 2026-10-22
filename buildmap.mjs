// Builds mapdata.json: city provinces (groups of counties, Albers USA 975x610),
// shared borders, state outlines and the neighbour graph.
//
// Each state is split into a few provinces. A province is named after its main city:
// seed cities are picked per state (big cities first, then cities far from the ones
// already picked), and every county joins the seed it can reach most cheaply through
// neighbouring counties, so provinces stay contiguous.
import fs from 'fs';
import { createRequire } from 'module';
import { geoPath, geoAlbersUsa } from 'd3-geo';
import * as topo from 'topojson-client';
import { presimplify, simplify, quantile } from 'topojson-simplify';

const require = createRequire(import.meta.url);
const CITIES = require('all-the-cities');

const raw = JSON.parse(fs.readFileSync('node_modules/us-atlas/counties-albers-10m.json', 'utf8'));
const pre = presimplify(raw);
const t = simplify(pre, quantile(pre, 0.2));
const proj = geoAlbersUsa().scale(1300).translate([487.5, 305]);
const path = geoPath().digits(1);

const FIPS = {
  '01':['AL','Alabama'],'02':['AK','Alaska'],'04':['AZ','Arizona'],'05':['AR','Arkansas'],'06':['CA','California'],
  '08':['CO','Colorado'],'09':['CT','Connecticut'],'10':['DE','Delaware'],'11':['DC','District of Columbia'],
  '12':['FL','Florida'],'13':['GA','Georgia'],'15':['HI','Hawaii'],'16':['ID','Idaho'],'17':['IL','Illinois'],
  '18':['IN','Indiana'],'19':['IA','Iowa'],'20':['KS','Kansas'],'21':['KY','Kentucky'],'22':['LA','Louisiana'],
  '23':['ME','Maine'],'24':['MD','Maryland'],'25':['MA','Massachusetts'],'26':['MI','Michigan'],'27':['MN','Minnesota'],
  '28':['MS','Mississippi'],'29':['MO','Missouri'],'30':['MT','Montana'],'31':['NE','Nebraska'],'32':['NV','Nevada'],
  '33':['NH','New Hampshire'],'34':['NJ','New Jersey'],'35':['NM','New Mexico'],'36':['NY','New York'],
  '37':['NC','North Carolina'],'38':['ND','North Dakota'],'39':['OH','Ohio'],'40':['OK','Oklahoma'],'41':['OR','Oregon'],
  '42':['PA','Pennsylvania'],'44':['RI','Rhode Island'],'45':['SC','South Carolina'],'46':['SD','South Dakota'],
  '47':['TN','Tennessee'],'48':['TX','Texas'],'49':['UT','Utah'],'50':['VT','Vermont'],'51':['VA','Virginia'],
  '53':['WA','Washington'],'54':['WV','West Virginia'],'55':['WI','Wisconsin'],'56':['WY','Wyoming'],
};
// state population in millions (used only to size the number of provinces)
const POP = { AL:5.0, AK:.7, AZ:7.2, AR:3.0, CA:39.5, CO:5.8, CT:3.6, DE:1.0, DC:.7, FL:21.5, GA:10.7, HI:1.4, ID:1.8, IL:12.8,
  IN:6.8, IA:3.2, KS:2.9, KY:4.5, LA:4.6, ME:1.4, MD:6.2, MA:7.0, MI:10.0, MN:5.7, MS:3.0, MO:6.2, MT:1.1, NE:2.0, NV:3.1,
  NH:1.4, NJ:9.3, NM:2.1, NY:20.2, NC:10.4, ND:.8, OH:11.8, OK:4.0, OR:4.2, PA:13.0, RI:1.1, SC:5.1, SD:.9, TN:6.9, TX:29.1,
  UT:3.3, VT:.6, VA:8.6, WA:7.7, WV:1.8, WI:5.9, WY:.6 };
// hand overrides for the number of provinces in a state
const K_OVERRIDE = { DC: 1, RI: 1, DE: 1, HI: 2, AK: 3 };
// short names for city provinces whose GeoNames name is long or awkward
const RENAME = { 'NY:New York City': 'New York', 'NY:Manhattan': 'New York', 'DC:Washington, D.C.': 'Washington', 'HI:Urban Honolulu': 'Honolulu',
  'TN:Nashville-Davidson': 'Nashville', 'KY:Louisville-Jefferson County': 'Louisville', 'KY:Lexington-Fayette': 'Lexington',
  'IN:Indianapolis (balance)': 'Indianapolis', 'GA:Augusta-Richmond County': 'Augusta', 'GA:Athens-Clarke County': 'Athens',
  'GA:Macon-Bibb County': 'Macon', 'GA:Columbus-Muscogee': 'Columbus', 'AK:Anchorage Municipality': 'Anchorage',
  'ID:Boise City': 'Boise', 'NJ:South Vineland': 'Vineland', 'KY:Ironville': 'Ashland', 'IN:Hammond': 'Gary' };
// cities that GeoNames lists as separate places but are neighbourhoods or suburbs of a bigger seed
const SKIP = new Set(['Brooklyn', 'Queens', 'The Bronx', 'Staten Island', 'Borough of Queens', 'Borough of Bronx', 'East Los Angeles', 'Paradise', 'Spring Valley',
  'Sunrise Manor', 'Enterprise', 'Metairie', 'Metairie Terrace', 'Brandon', 'Arlington Heights', 'Highlands Ranch', 'Columbia Heights', 'East New York',
  'Kalawao', 'Pearl City', 'Waipahu', 'Kailua', 'Kaneohe', 'College', 'Juneau and', 'West Coon Rapids']);
// manual provinces that touch the sea but are not coastal in the data (or the reverse)
const NOT_COASTAL = new Set(['TX:El Paso', 'TX:Laredo', 'TX:Odessa', 'WA:Spokane', 'ME:Presque Isle', 'NY:Plattsburgh', 'MN:Moorhead', 'NH:Berlin']);

// ------------------------------------------------------------ counties
const cgeoms = t.objects.counties.geometries;
const cfeats = topo.feature(t, t.objects.counties).features;
const cnb = topo.neighbors(cgeoms);
const counties = cfeats.map((f, i) => {
  const st = FIPS[String(f.id).slice(0, 2)];
  return { i, st: st ? st[0] : null, f, c: path.centroid(f), a: path.area(f) };
});

function ringsOf(f) { const g = f.geometry; return g.type === 'Polygon' ? [g.coordinates] : g.coordinates; }
function inRing(x, y, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function inFeat(x, y, f) {
  for (const poly of ringsOf(f)) {
    if (!inRing(x, y, poly[0])) continue;
    let hole = false;
    for (let k = 1; k < poly.length; k++) if (inRing(x, y, poly[k])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}
const bboxes = cfeats.map(f => path.bounds(f));
function countyAt(x, y, st) {
  for (const c of counties) {
    if (st && c.st !== st) continue;
    const b = bboxes[c.i];
    if (x < b[0][0] || x > b[1][0] || y < b[0][1] || y > b[1][1]) continue;
    if (inFeat(x, y, c.f)) return c.i;
  }
  return -1;
}
function nearestCounty(x, y, st) {
  let best = -1, bd = Infinity;
  for (const c of counties) if (c.st === st) { const d = Math.hypot(c.c[0] - x, c.c[1] - y); if (d < bd) { bd = d; best = c.i; } }
  return best;
}

// ------------------------------------------------------------ cities
const cities = [];
for (const c of CITIES) {
  if (c.country !== 'US' || !POP[c.adminCode] || c.population < 1) continue;
  const p = proj(c.loc.coordinates);
  if (!p) continue;
  cities.push({ name: c.name, st: c.adminCode, pop: c.population, x: p[0], y: p[1], cap: c.featureCode === 'PPLA' });
}
for (const c of cities) {
  c.county = countyAt(c.x, c.y, c.st);
  if (c.county < 0) c.county = nearestCounty(c.x, c.y, c.st);
}

// ------------------------------------------------------------ split states
const provOfCounty = new Array(counties.length).fill(-1);
const provinces = [];
const states = Object.values(FIPS).map(([abbr, name]) => ({ abbr, name }));
for (const S of states) {
  const cs = counties.filter(c => c.st === S.abbr);
  const area = cs.reduce((s, c) => s + c.a, 0);
  let K = K_OVERRIDE[S.abbr] || Math.round(Math.sqrt(area) / 26 + Math.sqrt(POP[S.abbr]) / 1.6);
  K = Math.max(1, Math.min(10, K));
  const cand = cities.filter(c => c.st === S.abbr && c.pop >= 2000 && !SKIP.has(c.name)).sort((a, b) => b.pop - a.pop);
  const seeds = [];
  const minSpace = Math.sqrt(area / K) * 0.45;
  while (seeds.length < K && cand.length) {
    let best = null, bs = -1;
    for (const c of cand) {
      if (seeds.some(s => s.county === c.county)) continue;
      const d = seeds.length ? Math.min(...seeds.map(s => Math.hypot(s.x - c.x, s.y - c.y))) : 1;
      if (seeds.length && d < minSpace) continue;
      const sc = Math.pow(c.pop, 0.45) * (seeds.length ? Math.pow(d, 1.3) : 1);
      if (sc > bs) { bs = sc; best = c; }
    }
    if (!best) break;
    seeds.push(best);
  }
  // grow regions: multi-source shortest path over county adjacency inside the state
  const dist = new Map(), owner = new Map();
  const base = provinces.length;
  seeds.forEach((s, k) => { dist.set(s.county, 0); owner.set(s.county, base + k); });
  const open = seeds.map(s => s.county);
  while (open.length) {
    open.sort((a, b) => dist.get(b) - dist.get(a));
    const u = open.pop();
    for (const v of cnb[u]) {
      if (counties[v].st !== S.abbr) continue;
      const w = Math.hypot(counties[u].c[0] - counties[v].c[0], counties[u].c[1] - counties[v].c[1]);
      const nd = dist.get(u) + w;
      if (!dist.has(v) || nd < dist.get(v)) { if (!dist.has(v)) open.push(v); dist.set(v, nd); owner.set(v, owner.get(u)); }
    }
  }
  for (const c of cs) {
    if (owner.has(c.i)) continue;          // islands and exclaves: nearest seed
    let bk = 0, bd = Infinity;
    seeds.forEach((s, k) => { const d = Math.hypot(s.x - c.c[0], s.y - c.c[1]); if (d < bd) { bd = d; bk = k; } });
    owner.set(c.i, base + bk);
  }
  seeds.forEach((s, k) => provinces.push({ id: base + k, st: S.abbr, stName: S.name, name: RENAME[S.abbr + ':' + s.name] || s.name, city: [s.x, s.y], counties: [] }));
  for (const c of cs) { provOfCounty[c.i] = owner.get(c.i); provinces[owner.get(c.i)].counties.push(c.i); }
}

// a province with no counties (should not happen) would break everything
for (const p of provinces) if (!p.counties.length) throw new Error('empty province ' + p.name);
// duplicate names inside one state are confusing; across states we add the state in the UI
const seenName = {};
for (const p of provinces) { const k = p.name; if (seenName[k]) { seenName[k].dup = true; p.dup = true; } else seenName[k] = p; }

// ------------------------------------------------------------ merge counties into provinces
const pgeoms = provinces.map(p => {
  const g = topo.mergeArcs(t, p.counties.map(i => cgeoms[i]));
  return { type: g.type, arcs: g.arcs, id: p.id };
});
const T2 = { type: 'Topology', transform: t.transform, arcs: t.arcs, objects: { provs: { type: 'GeometryCollection', geometries: pgeoms } } };
const pfeats = topo.feature(T2, T2.objects.provs).features;
const pnb = topo.neighbors(pgeoms);

// population share inside the state: mostly city population, a little by land area
for (const S of states) {
  const ps = provinces.filter(p => p.st === S.abbr);
  const cpop = ps.map(p => cities.filter(c => c.st === S.abbr && provOfCounty[c.county] === p.id).reduce((s, c) => s + c.pop, 0));
  const areas = ps.map(p => path.area(pfeats[p.id]));
  const ct = cpop.reduce((a, b) => a + b, 0) || 1, at = areas.reduce((a, b) => a + b, 0) || 1;
  ps.forEach((p, k) => { p.pw = 0.8 * cpop[k] / ct + 0.2 * areas[k] / at; p.area = Math.round(areas[k]); });
}

// anchor: a point well inside the province (grid search for the point farthest from the edge)
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let k = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; k = Math.max(0, Math.min(1, k));
  return Math.hypot(px - ax - k * dx, py - ay - k * dy);
}
function anchorOf(f, city) {
  const polys = ringsOf(f);
  // the part that holds the city, or failing that the largest part
  let big = polys.find(p => inFeat(city[0], city[1], { geometry: { type: 'Polygon', coordinates: p } })), ba = -1;
  if (!big) for (const p of polys) { const a = Math.abs(path.area({ type: 'Polygon', coordinates: p })); if (a > ba) { ba = a; big = p; } }
  const ff = { geometry: { type: 'Polygon', coordinates: big } };
  const xs = big[0].map(q => q[0]), ys = big[0].map(q => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const edge = (x, y) => { let m = Infinity; for (const r of big) for (let i = 0; i < r.length - 1; i++) m = Math.min(m, segDist(x, y, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1])); return m; };
  let best = null, bs = -Infinity;
  const N = 24;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const x = x0 + (x1 - x0) * i / N, y = y0 + (y1 - y0) * j / N;
    if (!inFeat(x, y, ff)) continue;
    const e = edge(x, y);
    // prefer points near the city when the gain in clearance is small
    const sc = Math.min(e, 9) - 0.2 * Math.hypot(x - city[0], y - city[1]);
    if (sc > bs) { bs = sc; best = [x, y]; }
  }
  if (!best) best = path.centroid(f);
  return best;
}

// coast: length of edge that no other province shares, not counting land borders with Canada and Mexico
const LANDLOCKED = new Set(['AZ', 'NM', 'ND', 'MT', 'ID', 'VT', 'NV', 'UT', 'CO', 'WY', 'NE', 'KS', 'OK', 'SD', 'IA', 'MO', 'AR', 'TN', 'KY', 'WV', 'DC']);
function lenOf(geo) {
  let L = 0;
  const lines = geo.type === 'MultiLineString' ? geo.coordinates : [geo.coordinates];
  for (const l of lines) for (let i = 0; i < l.length - 1; i++) L += Math.hypot(l[i + 1][0] - l[i][0], l[i + 1][1] - l[i][1]);
  return L;
}

const out = provinces.map(p => {
  const f = pfeats[p.id];
  const anc = anchorOf(f, p.city);
  const ext = topo.mesh(T2, T2.objects.provs, (a, b) => a === b && a === pgeoms[p.id]);
  const coastLen = lenOf(ext);
  return {
    id: p.id, st: p.st, name: p.name, cx: +anc[0].toFixed(1), cy: +anc[1].toFixed(1),
    px: +p.city[0].toFixed(1), py: +p.city[1].toFixed(1), area: p.area, pw: +p.pw.toFixed(3),
    coast: !LANDLOCKED.has(p.st) && !NOT_COASTAL.has(p.st + ':' + p.name) && coastLen > 6 ? 1 : 0,
    d: path(f), nbrs: pnb[p.id].slice(),
  };
});

// sea lanes: Alaska and Hawaii, plus any province left without a land neighbour
const byName = (st, name) => out.find(p => p.st === st && p.name === name);
const nearestIn = (p, pred) => { let b = null, bd = Infinity; for (const q of out) if (q !== p && pred(q)) { const d = Math.hypot(q.cx - p.cx, q.cy - p.cy); if (d < bd) { bd = d; b = q; } } return b; };
const sea = [];
const lane = (a, b, d) => { if (!a || !b || a === b || a.nbrs.includes(b.id)) return; a.nbrs.push(b.id); b.nbrs.push(a.id); sea.push([a.id, b.id, d]); };
const ak = out.filter(p => p.st === 'AK').sort((a, b) => b.pw - a.pw)[0];
const hi = out.filter(p => p.st === 'HI').sort((a, b) => b.pw - a.pw)[0];
lane(ak, byName('WA', 'Seattle') || out.find(p => p.st === 'WA'), 330);
lane(hi, byName('CA', 'Los Angeles') || out.find(p => p.st === 'CA'), 330);
for (const p of out) if (!p.nbrs.length) lane(p, nearestIn(p, q => q.st === p.st) || nearestIn(p, () => true), 90);
// make sure every state is internally connected (islands, peninsulas)
for (const S of states) {
  const ps = out.filter(p => p.st === S.abbr);
  if (ps.length < 2) continue;
  for (;;) {
    const seen = new Set([ps[0].id]), st = [ps[0]];
    while (st.length) { const u = st.pop(); for (const v of u.nbrs) if (out[v].st === S.abbr && !seen.has(v)) { seen.add(v); st.push(out[v]); } }
    const rest = ps.filter(p => !seen.has(p.id));
    if (!rest.length) break;
    let best = null;
    for (const a of ps.filter(p => seen.has(p.id))) for (const b of rest) { const d = Math.hypot(a.cx - b.cx, a.cy - b.cy); if (!best || d < best[2]) best = [a, b, d]; }
    lane(best[0], best[1], Math.max(60, Math.round(best[2])));
  }
}
for (const p of out) p.nbrs.sort((x, y) => x - y);

// shared border segments per neighbouring pair (for national borders), state lines, coastline
const borders = [];
for (const p of out) for (const q of pnb[p.id]) {
  if (q < p.id) continue;
  const A = pgeoms[p.id], B = pgeoms[q];
  const d = path(topo.mesh(T2, T2.objects.provs, (x, y) => (x === A && y === B) || (x === B && y === A)));
  if (d) borders.push({ a: p.id, b: q, d });
}
const stOf = g => out[g.id].st;
const stateLines = path(topo.mesh(T2, T2.objects.provs, (a, b) => a !== b && stOf(a) !== stOf(b)));
const coast = path(topo.mesh(T2, T2.objects.provs, (a, b) => a === b));
// state label points: population-weighted mean of province anchors
const stLabels = states.map(S => {
  const ps = out.filter(p => p.st === S.abbr);
  const big = ps.slice().sort((a, b) => b.area - a.area)[0];
  return { st: S.abbr, name: S.name, x: big.cx, y: big.cy };
});

const json = { w: 975, h: 610, provinces: out, borders, stateLines, coast, sea, states: stLabels };
fs.writeFileSync('mapdata.json', JSON.stringify(json));
const size = fs.statSync('mapdata.json').size;
console.log('provinces', out.length, 'borders', borders.length, 'sea', sea.length, 'bytes', size);
for (const S of states) console.log(S.abbr, out.filter(p => p.st === S.abbr).map(p => p.name + (p.coast ? '*' : '') + '(' + p.pw + ')').join(', '));
console.log('isolated:', out.filter(p => !p.nbrs.length).map(p => p.name).join(',') || 'none');
console.log('smallest:', out.slice().sort((a, b) => a.area - b.area).slice(0, 12).map(p => p.name + ':' + p.area).join(' '));
console.log('dups:', provinces.filter(p => p.dup).map(p => p.name + '/' + p.st).join(' '));
