// Builds mapdata.json: state paths (Albers USA, 975x610), shared borders, neighbor graph.
import fs from 'fs';
import { geoPath } from 'd3-geo';
import * as topo from 'topojson-client';
import { presimplify, simplify, quantile } from 'topojson-simplify';

const raw = JSON.parse(fs.readFileSync('node_modules/us-atlas/states-albers-10m.json', 'utf8'));
const t = simplify(presimplify(raw), quantile(presimplify(raw), 0.42));
const geoms = t.objects.states.geometries;
const feats = topo.feature(t, t.objects.states).features;

const path = geoPath().digits(1);
const nb = topo.neighbors(geoms);

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

// keep only real states + DC (drop territories)
const keep = [];
feats.forEach((f, i) => { if (FIPS[String(f.id).padStart(2, '0')]) keep.push(i); });
const idxOf = new Map(keep.map((srcIdx, k) => [srcIdx, k]));

function bigPolyCentroid(f) {
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let best = null, bestA = -1;
  for (const p of polys) {
    const ring = p[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = ring.length; i < n - 1; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
      const k = x0 * y1 - x1 * y0;
      a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
    }
    a /= 2;
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = [cx / (6 * a), cy / (6 * a)]; }
  }
  return { c: best, area: bestA };
}

const provinces = keep.map((srcIdx, k) => {
  const f = feats[srcIdx];
  const [abbr, name] = FIPS[String(f.id).padStart(2, '0')];
  const { c, area } = bigPolyCentroid(f);
  const b = path.bounds(f);
  return {
    id: k, abbr, name,
    cx: +c[0].toFixed(1), cy: +c[1].toFixed(1),
    area: Math.round(area),
    d: path(f),
    nbrs: nb[srcIdx].map(j => idxOf.get(j)).filter(j => j !== undefined),
  };
});

// manual sea lanes
const byAbbr = Object.fromEntries(provinces.map(p => [p.abbr, p]));
const sea = [['AK', 'WA'], ['HI', 'CA']];
for (const [a, b] of sea) {
  if (!byAbbr[a].nbrs.includes(byAbbr[b].id)) byAbbr[a].nbrs.push(byAbbr[b].id);
  if (!byAbbr[b].nbrs.includes(byAbbr[a].id)) byAbbr[b].nbrs.push(byAbbr[a].id);
}

// shared border segments per neighbor pair
const borders = [];
const seen = new Set();
for (const p of provinces) {
  for (const q of p.nbrs) {
    const key = p.id < q ? p.id + '-' + q : q + '-' + p.id;
    if (seen.has(key)) continue;
    seen.add(key);
    if ((p.abbr === 'AK' && provinces[q].abbr === 'WA') || (p.abbr === 'WA' && provinces[q].abbr === 'AK')) continue;
    if ((p.abbr === 'HI' && provinces[q].abbr === 'CA') || (p.abbr === 'CA' && provinces[q].abbr === 'HI')) continue;
    const A = geoms[keep[p.id]], B = geoms[keep[q]];
    const m = topo.mesh(t, t.objects.states, (x, y) => (x === A && y === B) || (x === B && y === A));
    const d = path(m);
    if (d) borders.push({ a: Math.min(p.id, q), b: Math.max(p.id, q), d });
  }
}

// outer coastline
const coast = path(topo.mesh(t, t.objects.states, (a, b) => a === b));

const out = {
  w: 975, h: 610,
  provinces: provinces.map(p => ({ id: p.id, abbr: p.abbr, name: p.name, cx: p.cx, cy: p.cy, area: p.area, d: p.d, nbrs: p.nbrs.sort((x, y) => x - y) })),
  borders,
  coast,
  sea: sea.map(([a, b]) => [byAbbr[a].id, byAbbr[b].id]),
};
fs.writeFileSync('mapdata.json', JSON.stringify(out));
const size = fs.statSync('mapdata.json').size;
console.log('provinces', provinces.length, 'borders', borders.length, 'bytes', size);
console.log(provinces.map(p => p.abbr + ':' + p.nbrs.length).join(' '));
const iso = provinces.filter(p => p.nbrs.length === 0);
console.log('isolated:', iso.map(p => p.abbr).join(',') || 'none');
console.log('smallest areas:', provinces.slice().sort((a, b) => a.area - b.area).slice(0, 10).map(p => p.abbr + ':' + p.area).join(' '));
