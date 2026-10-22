// =====================================================================
//  FRONTLINE USA : simulation core (economy, combat, AI, diplomacy)
//  Pure logic. Expects a global MAP (see buildmap.mjs).
// =====================================================================
const SIM = (function () {
'use strict';

const rnd = (a, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const key = (a, b) => (a < b ? a + '-' + b : b + '-' + a);

// ---------------------------------------------------------------- data
// resources: cash pays for everything and for upkeep; the rest come from provinces
const RES = ['cash', 'man', 'sup', 'comp', 'fuel', 'elec', 'rare'];
const RESN = {
  cash: { n: 'Cash',           s: 'Cash' },
  man:  { n: 'Manpower',       s: 'Men' },
  sup:  { n: 'Supplies',       s: 'Sup' },
  comp: { n: 'Components',     s: 'Comp' },
  fuel: { n: 'Fuel',           s: 'Fuel' },
  elec: { n: 'Electronics',    s: 'Elec' },
  rare: { n: 'Rare materials', s: 'Rare' },
};
const UT = ['inf', 'art', 'arm', 'air'];
// need: building required in the province to train it; fast: building whose level speeds training
const UNITS = {
  inf: { n: 'Infantry',  s: 'Inf', atk: 3, hp: 12, spd: 14, time: 7,  upk: 0.05, cost: { cash: 40,  man: 6, sup: 5 },                    need: null,   fast: ['army', 'recr'] },
  art: { n: 'Artillery', s: 'Art', atk: 7, hp: 8,  spd: 11, time: 11, upk: 0.08, cost: { cash: 70,  man: 4, sup: 4, comp: 20 },          need: 'army', fast: ['army'] },
  arm: { n: 'Armor',     s: 'Arm', atk: 8, hp: 20, spd: 19, time: 14, upk: 0.12, cost: { cash: 90,  man: 4, comp: 25, fuel: 15 },        need: 'army', fast: ['army'] },
  air: { n: 'Air wing',  s: 'Air', atk: 9, hp: 10, spd: 48, time: 18, upk: 0.15, cost: { cash: 120, man: 2, comp: 15, fuel: 25, elec: 15 }, need: 'airb', fast: ['airb'] },
};
// damage multiplier: MULT[attacker][defender]
const MULT = {
  inf: { inf: 1,   art: 1.2, arm: 0.5, air: 0.35 },
  art: { inf: 1.4, art: 1,   arm: 1.2, air: 0.1 },
  arm: { inf: 1.5, art: 1.3, arm: 1,   air: 0.1 },
  air: { inf: 1,   art: 1.3, arm: 1.7, air: 1 },
};
const TW = { inf: 1, art: 0.45, arm: 1, air: 0.8 };   // how likely a type is to take hits
const K_DMG = 0.16;
const CAPTURE_T = 14;      // seconds of unopposed occupation to take a province
const MAX_LVL = 3;

// City buildings. Cost and build time are for level 1; level n costs and takes n times as much.
const BLD = {
  army:  { n: 'Army base',         d: 'Needed to train artillery and armor. Ground units train 15% faster per level.', cost: { cash: 80, sup: 15, comp: 15 },  time: 30 },
  airb:  { n: 'Air base',          d: 'Needed to train air wings. They train 15% faster per level.',                   cost: { cash: 110, comp: 20, fuel: 15 }, time: 40 },
  naval: { n: 'Naval base',        d: 'Coastal cities only. Port trade: +15% cash here per level.',                     cost: { cash: 100, sup: 10, comp: 20 }, time: 40, coast: true },
  recr:  { n: 'Recruiting office', d: '+0.15 manpower per level. Infantry trains 15% faster per level.',                  cost: { cash: 60, sup: 12 },            time: 20 },
  arms:  { n: 'Arms industry',     d: '+0.2 components per level.',                                                     cost: { cash: 110, comp: 10, rare: 15 }, time: 45 },
  hosp:  { n: 'Hospital',          d: 'Your troops here take 10% less damage per level, and the garrison recovers faster.', cost: { cash: 80, sup: 15, elec: 10 }, time: 30 },
  fort:  { n: 'Bunkers',           d: '+25% defence and +2 garrison per level.',                                        cost: { cash: 60, sup: 10, comp: 12 },  time: 25 },
  lab:   { n: 'Research lab',      d: '+0.2 research per level. Research points will unlock upgrades.',                 cost: { cash: 120, elec: 15, rare: 15 }, time: 50 },
  infra: { n: 'Infrastructure',    d: '+25% output here per level.',                                                    cost: { cash: 90, sup: 10, comp: 8 },  time: 35 },
};
const BK = Object.keys(BLD);
const emptyB = () => { const b = {}; for (const k of BK) b[k] = 0; return b; };

// per state: [population (millions), terrain defence, resources its provinces produce (biggest province first)]
const STATE = {
  AL:[5.0,.05,'comp elec sup'], AK:[.7,.2,'fuel rare'], AZ:[7.2,.1,'rare elec'], AR:[3.0,.1,'sup rare fuel'], CA:[39.5,.05,'elec sup fuel comp'],
  CO:[5.8,.2,'elec rare fuel comp'], CT:[3.6,0,'comp elec'], DE:[1.0,0,'comp'], DC:[.7,0,'elec'], FL:[21.5,0,'sup elec rare'],
  GA:[10.7,.05,'sup comp'], HI:[1.4,.1,'sup'], ID:[1.8,.2,'rare sup'], IL:[12.8,0,'comp elec sup'], IN:[6.8,0,'comp sup'],
  IA:[3.2,0,'sup'], KS:[2.9,0,'sup fuel'], KY:[4.5,.1,'fuel comp'], LA:[4.6,0,'fuel sup'], ME:[1.4,.15,'sup rare'],
  MD:[6.2,.05,'elec comp'], MA:[7.0,.05,'elec comp'], MI:[10.0,0,'comp rare'], MN:[5.7,.05,'sup elec comp rare'], MS:[3.0,0,'sup fuel'],
  MO:[6.2,.05,'sup comp'], MT:[1.1,.2,'rare fuel'], NE:[2.0,0,'sup'], NV:[3.1,.1,'rare'], NH:[1.4,.15,'elec sup'],
  NJ:[9.3,0,'comp elec'], NM:[2.1,.15,'fuel rare'], NY:[20.2,.05,'elec comp sup fuel'], NC:[10.4,.1,'elec sup rare'], ND:[.8,0,'fuel sup'],
  OH:[11.8,0,'comp fuel'], OK:[4.0,0,'fuel'], OR:[4.2,.1,'elec sup'], PA:[13.0,.1,'comp fuel sup'], RI:[1.1,0,'comp'],
  SC:[5.1,0,'comp sup'], SD:[.9,0,'sup'], TN:[6.9,.1,'comp sup'], TX:[29.1,0,'fuel elec sup comp'], UT:[3.3,.2,'rare elec'],
  VT:[.6,.15,'sup'], VA:[8.6,.1,'elec sup'], WA:[7.7,.1,'elec sup'], WV:[1.8,.2,'fuel rare'], WI:[5.9,0,'sup comp'], WY:[.6,.2,'fuel rare'],
};
const NATIONS = [
  { name: 'Pacific Republic',      short: 'Pacific',    color: '#2FBF8A', pers: 'builder',     cap: 'CA', states: ['WA','OR','CA','NV','AK','HI'] },
  { name: 'Mountain Pact',         short: 'Mountain',   color: '#9B7DE8', pers: 'turtle',      cap: 'CO', states: ['ID','MT','WY','UT','CO'] },
  { name: 'Southwest Compact',     short: 'Southwest',  color: '#F0913F', pers: 'warmonger',   cap: 'TX', states: ['AZ','NM','TX','OK'] },
  { name: 'Heartland Union',       short: 'Heartland',  color: '#E3C440', pers: 'opportunist', cap: 'MN', states: ['ND','SD','NE','KS','MN','MO'] },
  { name: 'Lakes League',          short: 'Lakes',      color: '#4C8DF2', pers: 'builder',     cap: 'IL', states: ['WI','MI','IL','IN','OH','IA'] },
  { name: 'Delta Pact',            short: 'Delta',      color: '#E0576B', pers: 'warmonger',   cap: 'LA', states: ['AR','LA','MS','AL'] },
  { name: 'Seaboard Commonwealth', short: 'Seaboard',   color: '#25B7C4', pers: 'diplomat',    cap: 'GA', states: ['GA','FL','SC','NC'] },
  { name: 'Appalachian Federation',short: 'Appalachia', color: '#B98259', pers: 'opportunist', cap: 'TN', states: ['TN','KY','VA','WV'] },
  { name: 'Atlantic Dominion',     short: 'Atlantic',   color: '#E68AB8', pers: 'opportunist', cap: 'PA', states: ['PA','NJ','DE','MD','DC'] },
  { name: 'New England Concord',   short: 'New England',color: '#A9B4D6', pers: 'diplomat',    cap: 'NY', states: ['NY','CT','RI','MA','VT','NH','ME'] },
];

const PERS = {
  warmonger:   { label: 'Expansionist', aggr: 1.35, caution: 0.7, diplo: 0.55, econ: 0.8,  base: -8, reserve: 30 },
  opportunist: { label: 'Opportunist',  aggr: 1.0,  caution: 1.0, diplo: 0.85, econ: 1.0,  base: -2, reserve: 80 },
  turtle:      { label: 'Defensive',    aggr: 0.55, caution: 1.5, diplo: 1.0,  econ: 1.1,  base: 0,  reserve: 150 },
  diplomat:    { label: 'Diplomatic',   aggr: 0.75, caution: 1.1, diplo: 1.45, econ: 1.1,  base: 8,  reserve: 110 },
  builder:     { label: 'Industrial',   aggr: 0.8,  caution: 1.0, diplo: 1.15, econ: 1.35, base: 4,  reserve: 130 },
};

// ---------------------------------------------------------------- static map data
const MAPD = MAP;
const NP = MAPD.provinces.length;
const stName = {};
MAPD.states.forEach(s => { stName[s.st] = s.name; });
const byState = {};
MAPD.provinces.forEach(p => { (byState[p.st] = byState[p.st] || []).push(p.id); });
// each province produces one resource; a state's provinces take turns through its list, biggest first
const resOf = {};
for (const st in byState) {
  const list = STATE[st][2].split(' ');
  byState[st].slice().sort((a, b) => MAPD.provinces[b].pw - MAPD.provinces[a].pw).forEach((pid, i) => { resOf[pid] = list[i % list.length]; });
}
const PS = MAPD.provinces.map(p => {
  const s = STATE[p.st], pop = s[0] * p.pw;
  return {
    id: p.id, name: p.name, abbr: p.st, st: p.st, stName: stName[p.st], cx: p.cx, cy: p.cy, px: p.px, py: p.py, nbrs: p.nbrs, coast: !!p.coast,
    pop: Math.round(pop * 100) / 100, def: s[1], res: resOf[p.id],
    cash: (0.5 + 0.5 * Math.log(1 + s[0])) * p.pw,     // the old per-state cash, shared out by population
    man: 0.02 + 0.015 * pop,
    gar: 1.2 + Math.pow(pop, 0.35),
  };
});
const RES_RATE = 0.16;          // primary resource per province per second
const CAP_TRICKLE = 0.12;      // a capital makes a little of everything
const SUP_BASE = 0.04;         // every province grows some food and supplies
const CAPW = MAPD.states.length / NP;   // weight of one capture in war scores (about one state per state's worth of provinces)
const EDGE = new Float64Array(NP * NP);
MAPD.provinces.forEach(p => p.nbrs.forEach(q => {
  const a = PS[p.id], b = PS[q];
  EDGE[p.id * NP + q] = Math.hypot(a.cx - b.cx, a.cy - b.cy);
}));
MAPD.sea.forEach(([a, b, d]) => { EDGE[a * NP + b] = d; EDGE[b * NP + a] = d; });

// ---------------------------------------------------------------- state
let G = null;
let D = null;     // derived caches, rebuilt every second

const pers = n => PERS[n.pers];
const unitPow = u => UT.reduce((s, t) => s + u[t] * UNITS[t].atk * UNITS[t].hp, 0);
const unitCount = u => UT.reduce((s, t) => s + u[t], 0);
const cloneU = u => ({ inf: u.inf, art: u.art, arm: u.arm, air: u.air });
const emptyU = () => ({ inf: 0, art: 0, arm: 0, air: 0 });
const maxGar = p => PS[p.id].gar + 2 * p.b.fort + (G.nations[p.owner] && G.nations[p.owner].capital === p.id ? 3 : 0);
const defBonus = p => PS[p.id].def + 0.25 * p.b.fort;
const armySpeed = a => {
  let s = 999;
  for (const t of UT) if (a.u[t] > 0.3) s = Math.min(s, UNITS[t].spd);
  return s === 999 ? UNITS.inf.spd : s;
};

// ---------------------------------------------------------------- relations helpers
const atWar = (a, b) => a !== b && G.wars[key(a, b)] !== undefined;
const hasTreaty = (a, b, type) => G.treaties.some(t => t.type === type && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
const allied = (a, b) => a !== b && hasTreaty(a, b, 'alliance');
const hasAccess = (a, b) => a === b || allied(a, b) || hasTreaty(a, b, 'access');
const truceLeft = (a, b) => {
  const t = G.treaties.find(t => t.type === 'truce' && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
  return t ? Math.max(0, t.exp - G.t) : 0;
};
const alive = () => G.nations.filter(n => n.alive);
const enemiesOf = id => G.nations.filter(n => n.alive && n.id !== id && atWar(id, n.id)).map(n => n.id);
const alliesOf = id => G.nations.filter(n => n.alive && allied(id, n.id)).map(n => n.id);
const canEnter = (nat, pid) => {
  const o = G.provs[pid].owner;
  return o === nat || hasAccess(nat, o) || atWar(nat, o);
};

function addTreaty(type, a, b, dur) {
  G.treaties.push({ id: G.nextTid++, type, a, b, t0: G.t, exp: dur ? G.t + dur : null });
}
function removeTreaties(a, b, types) {
  G.treaties = G.treaties.filter(t => !(((t.a === a && t.b === b) || (t.a === b && t.b === a)) && types.includes(t.type)));
}

// ---------------------------------------------------------------- log / memory
function log(txt, kind, o) {
  o = o || {};
  const me = G.opts.player;
  const involvesMe = me >= 0 && ((o.nats || []).includes(me));
  G.seq++;
  G.log.push({ s: G.seq, t: G.t, txt, kind: kind || 'info', pid: o.pid === undefined ? null : o.pid, me: involvesMe });
  if (G.log.length > 250) G.log.shift();
}
function remember(holder, about, txt, v, half, cap) {
  half = half || 240; cap = cap || 80;
  const ex = G.memory.find(m => m.a === holder && m.b === about && m.txt === txt);
  if (ex) { ex.v = clamp(effMem(ex) + v, -cap, cap); ex.t = G.t; ex.half = half; return; }
  G.memory.push({ a: holder, b: about, txt, v: clamp(v, -cap, cap), t: G.t, half });
}
const effMem = m => m.v * Math.pow(0.5, (G.t - m.t) / m.half);

function opinion(a, b) {
  const A = G.nations[a], parts = []; let tot = 0;
  const add = (txt, v) => { if (Math.abs(v) >= 1) { parts.push([txt, Math.round(v)]); tot += v; } };
  add('Temperament', pers(A).base);
  if (allied(a, b)) add('Allied', 35);
  if (hasTreaty(a, b, 'trade')) add('Trade pact', 12);
  if (hasTreaty(a, b, 'nap')) add('Non-aggression pact', 8);
  if (hasTreaty(a, b, 'access')) add('Passage agreement', 6);
  if (atWar(a, b)) add('At war', -45);
  let shared = 0, onAlly = 0, allyOnMe = 0;
  for (const c of G.nations) {
    if (!c.alive || c.id === a || c.id === b) continue;
    if (atWar(a, c.id) && atWar(b, c.id)) shared++;
    if (atWar(b, c.id) && allied(a, c.id)) onAlly++;
    if (atWar(a, c.id) && allied(b, c.id)) allyOnMe++;
  }
  add('Common enemy', Math.min(24, shared * 12));
  add('At war with our ally', -22 * Math.min(2, onAlly));
  add('Allied with our enemy', -14 * Math.min(2, allyOnMe));
  // troops parked on our soil
  let tension = 0;
  if (!atWar(a, b) && !hasAccess(a, b)) {
    for (const ar of G.armies) if (ar.owner === b && ar.at != null && G.provs[ar.at].owner === a) tension++;
  }
  add('Their troops on our land', -10 * Math.min(2, tension));
  // fear of a runaway power
  const sh = D ? D.share[b] || 0 : 0;
  if (sh > 0.27 && (D.share[a] || 0) < sh) add('Fear of their dominance', -Math.min(45, (sh - 0.27) * 150));
  add('Reputation', -0.5 * G.nations[b].infamy);
  // rivals on a shared border
  if (!allied(a, b) && !hasTreaty(a, b, 'nap') && pers(A).aggr > 1.1 && borders(a, b)) add('Border rivalry', -6);
  const seen = {};
  for (const m of G.memory) {
    if (m.a !== a || m.b !== b) continue;
    const v = effMem(m);
    if (Math.abs(v) < 1) continue;
    seen[m.txt] = (seen[m.txt] || 0) + v;
  }
  for (const k in seen) add(k, seen[k]);
  tot = clamp(tot, -100, 100);
  parts.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  return { total: Math.round(tot), parts };
}
function borders(a, b) {
  for (const pid of D.owned[a] || []) for (const q of PS[pid].nbrs) if (G.provs[q].owner === b) return true;
  return false;
}
function inContact(a, b) {
  const mine = [a].concat(alliesOf(a));
  for (const m of mine) for (const pid of D.owned[m] || []) for (const q of PS[pid].nbrs) if (G.provs[q].owner === b) return true;
  return false;
}

// ---------------------------------------------------------------- derived cache
function refresh() {
  const d = { owned: {}, pop: {}, power: {}, armiesBy: {}, armyAt: {}, share: {}, total: 0 };
  for (const n of G.nations) { d.owned[n.id] = []; d.pop[n.id] = 0; d.power[n.id] = 0; d.armiesBy[n.id] = []; }
  for (const p of G.provs) {
    d.owned[p.owner].push(p.id);
    d.pop[p.owner] += PS[p.id].pop;
    d.total += PS[p.id].pop;
    d.power[p.owner] += p.garrison * UNITS.inf.atk * UNITS.inf.hp * 0.6;
  }
  for (const a of G.armies) {
    d.armiesBy[a.owner].push(a);
    d.power[a.owner] += unitPow(a.u);
    if (a.at != null) (d.armyAt[a.at] = d.armyAt[a.at] || []).push(a);
  }
  for (const n of G.nations) d.share[n.id] = d.total ? d.pop[n.id] / d.total : 0;
  D = d;
}

// ---------------------------------------------------------------- economy
const zeroRate = () => { const r = { rp: 0, up: 0, net: 0 }; for (const k of RES) r[k] = 0; return r; };
// what one province makes per second for its owner (before trade and difficulty)
function provOut(pid, out) {
  const p = G.provs[pid], d = PS[pid], n = G.nations[p.owner], b = p.b;
  out = out || zeroRate();
  const m = (1 + 0.25 * b.infra) * (1 - 0.6 * p.unrest) * (p.cap ? 0.5 : 1);
  const capital = n.capital === pid;
  out.cash += d.cash * m * (capital ? 1.25 : 1) * (1 + 0.15 * b.naval);
  out.man += (d.man + 0.15 * b.recr) * m;
  out[d.res] += RES_RATE * m;
  out.sup += SUP_BASE * m;
  out.comp += 0.2 * b.arms * m;
  out.rp += 0.2 * b.lab * (1 - 0.6 * p.unrest);
  if (capital) for (const k of RES) if (k !== 'cash' && k !== 'man') out[k] += CAP_TRICKLE;
  return out;
}
function computeRates() {
  const diff = G.opts.diff === 'hard' ? 1.2 : G.opts.diff === 'easy' ? 0.85 : 1;
  for (const n of G.nations) {
    const r = zeroRate();
    if (!n.alive) { n.rate = r; continue; }
    for (const pid of D.owned[n.id]) provOut(pid, r);
    let trade = 0;
    for (const t of G.treaties) if (t.type === 'trade' && (t.a === n.id || t.b === n.id)) trade += 0.07;
    r.cash *= 1 + Math.min(0.21, trade);
    const mul = n.player ? 1 : diff;
    for (const k of RES) r[k] *= mul;
    for (const a of D.armiesBy[n.id]) for (const t of UT) r.up += a.u[t] * UNITS[t].upk;
    r.net = r.cash - r.up;
    n.rate = r;
  }
}
const provRates = pid => provOut(pid);
function econTick(dt) {
  for (const n of G.nations) {
    if (!n.alive) continue;
    const r = n.rate;
    n.cash += r.net * dt;
    for (const k of RES) if (k !== 'cash') n[k] += r[k] * dt;
    n.rp += r.rp * dt;
    if (n.cash < 0) {
      n.cash = 0;
      // unpaid armies melt away
      for (const a of D.armiesBy[n.id]) for (const t of UT) a.u[t] *= 1 - 0.004 * dt;
    }
  }
}
const canPay = (n, c) => RES.every(k => !c[k] || n[k] >= c[k]);
const pay = (n, c) => { for (const k of RES) if (c[k]) n[k] -= c[k]; };
const unitCost = t => UNITS[t].cost;
const scaleCost = (c, f) => { const o = {}; for (const k in c) o[k] = Math.round(c[k] * f); return o; };
const buildCost = (kind, lvl) => scaleCost(BLD[kind].cost, lvl + 1);
const buildTime = (kind, lvl) => BLD[kind].time * (lvl + 1);
// can province p train unit type t, and how long does it take there
const canTrain = (p, t) => !UNITS[t].need || p.b[UNITS[t].need] > 0;
const trainTime = (p, t) => UNITS[t].time * (1 - 0.15 * Math.max(...UNITS[t].fast.map(k => p.b[k])));

function prodTick(dt) {
  for (const p of G.provs) {
    if (p.cap || p.battle) continue;       // no training or building under siege
    if (p.bq) {
      p.bq.left -= dt;
      if (p.bq.left <= 0) {
        const k = p.bq.k; p.bq = null;
        p.b[k] = Math.min(MAX_LVL, p.b[k] + 1);
        if (G.nations[p.owner].player) log(`${BLD[k].n} level ${p.b[k]} finished in ${PS[p.id].name}`, 'build', { pid: p.id, nats: [p.owner] });
      }
    }
    if (!p.q.length) continue;
    const it = p.q[0];
    it.left -= dt;
    if (it.left <= 0) {
      p.q.shift();
      let a = G.armies.find(x => x.owner === p.owner && x.at === p.id && !x.mv && !x.route.length);
      if (a) a.u[it.type] += 1;
      else { a = newArmy(p.owner, p.id); a.u[it.type] = 1; }
    }
  }
}
function newArmy(owner, at) {
  const a = { id: G.nextArmy++, owner, u: emptyU(), at, mv: null, route: [] };
  G.armies.push(a);
  return a;
}

// ---------------------------------------------------------------- movement
function edgeTime(i, j, speed) { return (EDGE[i * NP + j] || 100) / speed; }

// Dijkstra over provinces the nation may enter, with a small binary heap.
// Returns { dist, prev }; stops early once `to` is settled (if given).
function dijkstra(nat, from, speed, to) {
  const dist = new Float64Array(NP).fill(Infinity), prev = new Int16Array(NP).fill(-1), done = new Uint8Array(NP);
  const hp = [], hk = [];
  const push = (v, k) => {
    let i = hp.length; hp.push(v); hk.push(k);
    while (i > 0) { const j = (i - 1) >> 1; if (hk[j] <= hk[i]) break; [hp[i], hp[j]] = [hp[j], hp[i]]; [hk[i], hk[j]] = [hk[j], hk[i]]; i = j; }
  };
  const pop = () => {
    const v = hp[0], lv = hp.pop(), lk = hk.pop();
    if (hp.length) {
      hp[0] = lv; hk[0] = lk; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < hp.length && hk[l] < hk[m]) m = l;
        if (r < hp.length && hk[r] < hk[m]) m = r;
        if (m === i) break;
        [hp[i], hp[m]] = [hp[m], hp[i]]; [hk[i], hk[m]] = [hk[m], hk[i]]; i = m;
      }
    }
    return v;
  };
  dist[from] = 0; push(from, 0);
  while (hp.length) {
    const u = pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === to) break;
    for (const v of PS[u].nbrs) {
      if (done[v] || !canEnter(nat, v)) continue;
      const hostile = G.provs[v].owner !== nat && atWar(nat, G.provs[v].owner);
      const w = edgeTime(u, v, speed) + (hostile && v !== to ? 14 : 0);
      if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; push(v, dist[v]); }
    }
  }
  return { dist, prev };
}
function pathTo(dj, from, to) {
  if (from === to) return [];
  if (dj.prev[to] < 0) return null;
  const r = []; let c = to;
  while (c !== from) { r.unshift(c); c = dj.prev[c]; }
  return r;
}
function findRoute(nat, from, to, speed) {
  if (from === to) return [];
  return pathTo(dijkstra(nat, from, speed, to), from, to);
}
function routeTime(a, route, startPid) {
  const sp = armySpeed(a); let t = 0, cur = startPid;
  for (const r of route) { t += edgeTime(cur, r, sp); cur = r; }
  return t;
}
function orderMove(a, dest) {
  const sp = armySpeed(a);
  if (!a.mv) {
    if (a.at === dest) { a.route = []; return { ok: true, msg: 'Holding position' }; }
    const r = findRoute(a.owner, a.at, dest, sp);
    if (!r) return { ok: false, msg: 'No permitted route. Declare war or get passage rights first.' };
    a.route = r; startNext(a);
    return { ok: true, msg: 'Moving out', eta: routeTime(a, r, a.at) };
  }
  // already on the road: either carry on to the next stop, or turn around
  const fwdRoute = findRoute(a.owner, a.mv.to, dest, sp) || (a.mv.to === dest ? [] : null);
  const fwdCost = a.mv.dur - a.mv.t + (fwdRoute ? routeTime(a, fwdRoute, a.mv.to) : Infinity);
  let backRoute = null, backCost = Infinity;
  if (canEnter(a.owner, a.mv.from)) {
    backRoute = a.mv.from === dest ? [] : findRoute(a.owner, a.mv.from, dest, sp);
    if (backRoute) backCost = a.mv.t + routeTime(a, backRoute, a.mv.from);
  }
  if (fwdCost === Infinity && backCost === Infinity) return { ok: false, msg: 'No permitted route.' };
  if (backCost < fwdCost) {
    const { from, to, t, dur } = a.mv;
    a.mv = { from: to, to: from, t: dur - t, dur };
    a.route = backRoute;
    return { ok: true, msg: 'Turning back', eta: backCost };
  }
  a.route = fwdRoute;
  return { ok: true, msg: 'Redirected', eta: fwdCost };
}
function startNext(a) {
  const next = a.route.shift();
  if (next === undefined) { a.route = []; return; }
  if (!canEnter(a.owner, next)) { a.route = []; return; }
  a.mv = { from: a.at, to: next, t: 0, dur: edgeTime(a.at, next, armySpeed(a)) };
  a.at = null;
}
function hostileHere(nat, pid) {
  const p = G.provs[pid];
  if (atWar(nat, p.owner) && p.garrison > 0.3) return true;
  for (const x of G.armies) if (x.at === pid && x.owner !== nat && atWar(nat, x.owner)) return true;
  return false;
}
function moveTick(dt) {
  for (const a of G.armies) {
    if (!a.mv) continue;
    a.mv.t += dt;
    if (a.mv.t >= a.mv.dur) {
      a.at = a.mv.to; a.mv = null;
      if (hostileHere(a.owner, a.at)) a.route = [];         // engaged: stop and fight
      else if (a.route.length) startNext(a);
    }
  }
}
// pull armies out of territory they no longer have the right to stand in
function enforceBorders() {
  for (const a of G.armies) {
    if (a.at == null) continue;
    if (canEnter(a.owner, a.at)) continue;
    // nearest tile we may stand on
    const seen = new Set([a.at]); let frontier = [[a.at, []]], dest = null;
    while (frontier.length && !dest) {
      const nxt = [];
      for (const [u, path] of frontier) for (const v of PS[u].nbrs) {
        if (seen.has(v)) continue; seen.add(v);
        const o = G.provs[v].owner;
        if (o === a.owner || hasAccess(a.owner, o)) { dest = path.concat([v]); break; }
        nxt.push([v, path.concat([v])]);
      }
      frontier = nxt;
    }
    if (dest) { a.route = dest; startNext(a); }
  }
}

// ---------------------------------------------------------------- combat
function sizeOf(f) { let s = 0; for (const t of UT) s += f.u[t] * TW[t]; return s; }
function roundForces(forces, dt, noise) {
  const dmg = forces.map(() => emptyU());
  const sizes = forces.map(sizeOf);
  for (let i = 0; i < forces.length; i++) {
    const f = forces[i];
    if (sizes[i] <= 0.01) continue;
    let tot = 0; const foes = [];
    for (let j = 0; j < forces.length; j++) if (j !== i && sizes[j] > 0.01 && atWar(f.nat, forces[j].nat)) { foes.push(j); tot += sizes[j]; }
    if (!foes.length) continue;
    for (const at of UT) {
      const c = f.u[at]; if (c <= 0) continue;
      const base = c * UNITS[at].atk * K_DMG * dt * (noise ? rnd(0.88, 1.12) : 1) * (f.gar ? 0.8 : 1);
      for (const j of foes) {
        const e = forces[j], share = sizes[j] / tot;
        for (const dt2 of UT) {
          if (e.u[dt2] <= 0) continue;
          const tsh = e.u[dt2] * TW[dt2] / sizes[j];
          const bonus = (e.db || 0) * (at === 'art' ? 0.5 : 1);
          dmg[j][dt2] += base * share * tsh * MULT[at][dt2] * (1 - (e.med || 0)) / (1 + bonus);
        }
      }
    }
  }
  for (let i = 0; i < forces.length; i++) for (const t of UT) {
    forces[i].u[t] = Math.max(0, forces[i].u[t] - dmg[i][t] / UNITS[t].hp);
    if (forces[i].u[t] < 0.02) forces[i].u[t] = 0;
  }
  return dmg;
}
function forcesIn(pid, clone) {
  const p = G.provs[pid], out = [];
  const db = defBonus(p), med = 0.1 * p.b.hosp;
  if (p.garrison > 0.05) out.push({ nat: p.owner, u: clone ? { inf: p.garrison, art: 0, arm: 0, air: 0 } : null, gar: true, ref: p, db, med });
  for (const a of G.armies) {
    if (a.at !== pid) continue;
    const isDef = a.owner === p.owner || allied(a.owner, p.owner);
    out.push({ nat: a.owner, u: clone ? cloneU(a.u) : a.u, ref: a, db: isDef ? db : 0, med: a.owner === p.owner ? med : 0 });
  }
  return out;
}
// expected result if `units` (nation `nat`) attack province `pid` right now
function predictAttack(nat, units, pid, extraDefense) {
  const forces = forcesIn(pid, true);
  forces.push({ nat, u: cloneU(units), db: 0, att: true });
  if (extraDefense) forces.push(extraDefense);
  const startA = unitCount(units) || 1;
  const hostileDef = forces.filter(f => !f.att && atWar(f.nat, nat));
  const defStart = hostileDef.reduce((s, f) => s + unitCount(f.u), 0) || 1;
  for (let i = 0; i < 160; i++) {
    roundForces(forces, 1, false);
    const a = forces.find(f => f.att);
    const dLeft = hostileDef.reduce((s, f) => s + unitCount(f.u), 0);
    if (unitCount(a.u) < 0.3 || dLeft < 0.3) break;
  }
  const a = forces.find(f => f.att);
  const left = hostileDef.reduce((s, f) => s + unitCount(f.u), 0);
  return { win: left < 0.3 && unitCount(a.u) > 0.3, keep: unitCount(a.u) / startA, defLeft: left / defStart };
}

function processBattles() {
  for (const p of G.provs) {
    const here = [];
    for (const a of G.armies) if (a.at === p.id) here.push(a);
    let hostile = false;
    const nats = new Set(here.map(a => a.owner));
    if (p.garrison > 0.05) nats.add(p.owner);
    const list = [...nats];
    for (let i = 0; i < list.length && !hostile; i++) for (let j = i + 1; j < list.length; j++) if (atWar(list[i], list[j])) { hostile = true; break; }
    p.battle = hostile;
    if (hostile) {
      const forces = forcesIn(p.id, false);
      const gf = forces.find(f => f.gar);
      let gu = null;
      if (gf) { gu = { inf: p.garrison, art: 0, arm: 0, air: 0 }; gf.u = gu; }
      const before = new Map(forces.filter(f => f.ref && !f.gar).map(f => [f.ref, unitCount(f.u)]));
      roundForces(forces, 1, true);
      if (gu) p.garrison = gu.inf;
      for (const f of forces) if (f.ref && !f.gar) {
        const a = f.ref;
        const lost = (before.get(a) || 0) - unitCount(a.u);
        if (lost > 0) G.nations[a.owner].lost = (G.nations[a.owner].lost || 0) + lost;
        if (unitCount(a.u) < 0.4) { G.armies = G.armies.filter(x => x !== a); }
      }
      p.lastBattle = G.t;
    } else if (p.garrison < maxGar(p)) {
      const enemyPresent = here.some(a => atWar(a.owner, p.owner));
      if (!enemyPresent) p.garrison = Math.min(maxGar(p), p.garrison + 0.05 + 0.015 * p.b.fort + 0.02 * p.b.hosp);
    }
    // occupation
    const present = G.armies.filter(a => a.at === p.id);
    const ownerSide = present.some(a => a.owner === p.owner || allied(a.owner, p.owner));
    const occ = present.filter(a => atWar(a.owner, p.owner));
    if (occ.length && !ownerSide && p.garrison < 0.3) {
      let best = occ[0];
      for (const a of occ) if (unitPow(a.u) > unitPow(best.u)) best = a;
      const by = best.owner;
      if (p.cap && p.cap.by === by) p.cap.p += 1 / CAPTURE_T; else p.cap = { by, p: 1 / CAPTURE_T };
      if (p.cap.p >= 1) capture(p, by);
    } else if (p.cap) {
      p.cap.p -= 0.12;
      if (p.cap.p <= 0) p.cap = null;
    }
  }
}

function capture(p, by) {
  const old = p.owner, O = G.nations[old], B = G.nations[by];
  const wasCap = O.capital === p.id;
  p.owner = by; p.garrison = 0.5; p.cap = null;
  for (const k of BK) p.b[k] = Math.max(0, p.b[k] - 1);      // the fighting wrecks a level of everything
  p.bq = null;
  p.unrest = p.orig === by ? 0.15 : 0.65; p.q = []; p.battle = false;
  const d = PS[p.id];
  B.cash += 30 + d.pop * 6; B[d.res] += 30;
  const k = key(old, by);
  const ws = G.wstat[k] || (G.wstat[k] = { caps: {}, last: G.t });
  ws.caps[by] = (ws.caps[by] || 0) + CAPW; ws.last = G.t;
  B.taken = (B.taken || 0) + 1;
  log(`${B.short} captured ${d.name} from ${O.short}`, 'capture', { pid: p.id, nats: [by, old] });
  if (wasCap) {
    const rest = G.provs.filter(q => q.owner === old).sort((a, b) => PS[b.id].pop - PS[a.id].pop);
    if (rest.length) { O.capital = rest[0].id; log(`${O.short} moves its capital to ${PS[rest[0].id].name}`, 'info', { nats: [old] }); }
  }
  refresh();
  if (!G.provs.some(q => q.owner === old)) eliminate(old, by);
}
function eliminate(id, by) {
  const n = G.nations[id];
  n.alive = false;
  G.armies = G.armies.filter(a => a.owner !== id);
  G.treaties = G.treaties.filter(t => t.a !== id && t.b !== id);
  for (const k of Object.keys(G.wars)) { const [x, y] = k.split('-').map(Number); if (x === id || y === id) delete G.wars[k]; }
  G.proposals = G.proposals.filter(p => p.from !== id);
  log(`${n.name} has been eliminated`, 'elim', { nats: [id, by] });
  if (G.opts.player === id) G.flags.playerDead = true;
  refresh();
}

// ---------------------------------------------------------------- unrest and uprisings
function unrestTick() {
  for (const n of G.nations) {
    if (!n.alive) continue;
    const owned = D.owned[n.id];
    let foreign = 0;
    for (const pid of owned) if (G.provs[pid].orig !== n.id) foreign++;
    const over = foreign / Math.max(3, owned.length - foreign);      // conquests vs core
    for (const pid of owned) {
      const p = G.provs[pid];
      const garrisoned = G.armies.some(a => a.at === pid && a.owner === n.id);
      if (p.orig === n.id) { p.unrest = Math.max(0, p.unrest - 0.006 - (garrisoned ? 0.01 : 0)); continue; }
      let d = 0.0014 * (over - 0.35) - (garrisoned ? 0.011 : 0) - (p.b.fort * 0.002) - 0.0012;
      if (!garrisoned && p.garrison < 1) d += 0.001;
      p.unrest = clamp(p.unrest + d, 0, 1);
      if (p.unrest >= 1 && !garrisoned) revolt(p);
    }
  }
}
function revolt(p) {
  const old = G.nations[p.owner], d = PS[p.id];
  const origin = G.nations[p.orig];
  p.unrest = 0.3; p.q = []; p.bq = null;
  if (origin && origin.alive && origin.id !== p.owner) {
    p.owner = origin.id; p.garrison = 2;
    log(`${d.name} rises up against ${old.short} and returns to ${origin.short}`, 'revolt', { pid: p.id, nats: [old.id, origin.id] });
  } else {
    const id = G.nations.length;
    const keys = Object.keys(PERS);
    const hue = Math.floor(rnd(0, 360));
    G.nations.push(Object.assign({ id, name: 'Free State of ' + d.name, short: 'Free ' + d.name, color: `hsl(${hue} 55% 62%)`, pers: keys[Math.floor(rnd(0, keys.length))],
      player: false, alive: true, capital: p.id, infamy: 0, rate: zeroRate(),
      ai: { next: G.t + 3, focus: null, tprop: {}, lastWar: G.t }, orig: id }, startStock(0.4)));
    p.owner = id; p.orig = id; p.garrison = 3;
    const a = newArmy(id, p.id); a.u.inf = 4;
    log(`${d.name} declares independence from ${old.short}`, 'revolt', { pid: p.id, nats: [old.id, id] });
    if (!atWar(id, old.id)) G.wars[key(id, old.id)] = G.t;
  }
  refresh();
  if (!G.provs.some(q => q.owner === old.id)) eliminate(old.id, p.owner);
}

// ---------------------------------------------------------------- diplomacy
function warStat(a, b) {
  const k = key(a, b), ws = G.wstat[k] || { caps: {}, last: 0 };
  return { dur: G.wars[k] !== undefined ? G.t - G.wars[k] : 0, a: ws.caps[a] || 0, b: ws.caps[b] || 0, last: ws.last || G.wars[k] || 0 };
}
function declareWar(a, b, why) {
  if (a === b || !G.nations[a].alive || !G.nations[b].alive) return { ok: false, msg: 'Invalid target' };
  if (atWar(a, b)) return { ok: false, msg: 'Already at war' };
  const tl = truceLeft(a, b);
  if (tl > 0) return { ok: false, msg: `A truce holds for another ${Math.ceil(tl)}s` };
  const A = G.nations[a], B = G.nations[b];
  let broke = false;
  if (allied(a, b)) {
    broke = true; A.infamy = Math.min(100, A.infamy + 30);
    removeTreaties(a, b, ['alliance']);
    remember(b, a, 'Betrayed our alliance', -60, 900, 100);
    for (const c of G.nations) if (c.alive && c.id !== a && c.id !== b) remember(c.id, a, 'Broke an alliance', -12, 700, 40);
  } else if (hasTreaty(a, b, 'nap')) {
    broke = true; A.infamy = Math.min(100, A.infamy + 15);
    removeTreaties(a, b, ['nap']);
    remember(b, a, 'Broke our non-aggression pact', -40, 700, 80);
    for (const c of G.nations) if (c.alive && c.id !== a && c.id !== b) remember(c.id, a, 'Breaks treaties', -6, 600, 30);
  }
  removeTreaties(a, b, ['access', 'trade', 'nap']);
  G.wars[key(a, b)] = G.t;
  G.wstat[key(a, b)] = { caps: {}, last: G.t };
  remember(b, a, 'Declared war on us', -35, 500, 80);
  log(`${A.short} declared war on ${B.short}${broke ? ' (breaking a treaty)' : ''}`, 'war', { nats: [a, b] });
  // allies pile in
  for (const x of G.nations) {
    if (!x.alive || x.id === a || x.id === b) continue;
    const defenderAlly = allied(x.id, b) && !allied(x.id, a);
    const attackerAlly = allied(x.id, a) && !allied(x.id, b);
    if (!defenderAlly && !attackerAlly) continue;
    const target = defenderAlly ? a : b, friend = defenderAlly ? b : a;
    if (atWar(x.id, target) || truceLeft(x.id, target) > 0) continue;
    if (x.player) {
      propose(friend, x.id, 'joinwar', `${G.nations[friend].short} asks you to join the war against ${G.nations[target].short}.`, { target }, 60);
    } else {
      const op = opinion(x.id, friend).total;
      const willing = op >= 25 && enemiesOf(x.id).length < 2 && D.power[x.id] > D.power[target] * 0.35 && Math.random() < (defenderAlly ? 0.7 : 0.45);
      if (willing) declareWar(x.id, target, 'ally');
    }
  }
  enforceBorders();
  return { ok: true, msg: `War declared on ${B.short}` };
}
function makePeace(a, b) {
  delete G.wars[key(a, b)];
  removeTreaties(a, b, ['truce']);
  addTreaty('truce', a, b, 150);
  remember(a, b, 'Ended the war', 8, 300, 20); remember(b, a, 'Ended the war', 8, 300, 20);
  log(`${G.nations[a].short} and ${G.nations[b].short} agreed a ceasefire`, 'peace', { nats: [a, b] });
  G.nations[a].ai.lastWar = G.t; G.nations[b].ai.lastWar = G.t;
  enforceBorders();
}

// How would nation r answer a proposal from nation p?
function evalProposal(kind, r, p, extra) {
  const R = G.nations[r], P = pers(R), op = opinion(r, p).total;
  const no = m => ({ ok: false, msg: m }), yes = m => ({ ok: true, msg: m || 'Agreed' });
  if (atWar(r, p) && kind !== 'ceasefire') return no('We are at war with you.');
  const pw = D.power[p] / Math.max(1, D.power[r]);
  switch (kind) {
    case 'ceasefire': {
      if (!atWar(r, p)) return no('We are not at war.');
      const ws = warStat(r, p), ratio = 1 / pw;
      let sc = (1 - ratio) * 1.6 + clamp(ws.dur / 500, 0, 1.2) - (ws.a - ws.b) * 0.25 + (G.t - ws.last > 150 ? 0.4 : 0) - (P.aggr - 1) * 0.5;
      if (D.share[p] > 0.4 && p !== r) sc -= 0.4;
      if (ws.dur < 40) sc -= 0.8;
      return sc > 0.55 ? yes('Peace, for now.') : no(ratio > 1 ? 'We believe we are winning this war.' : 'The war goes on. We are not ready to stop.');
    }
    case 'nap': {
      if (hasTreaty(r, p, 'nap') || allied(r, p)) return no('Already covered by a treaty.');
      if (R.ai.warTarget === p) return no('We have other plans for you.');
      return op >= 6 - P.diplo * 8 ? yes() : no('We do not trust you enough yet.');
    }
    case 'access': {
      if (hasAccess(r, p) && p !== r) return no('You already have passage.');
      let need = 10 - P.diplo * 8;
      if (pw > 2 && !hasTreaty(r, p, 'nap')) need = 15;
      return op >= need ? yes() : no('We will not let your troops cross our land.');
    }
    case 'alliance': {
      if (allied(r, p)) return no('We are already allies.');
      const seasoned = G.treaties.some(t => (t.type === 'nap' || t.type === 'trade' || t.type === 'access') && ((t.a === r && t.b === p) || (t.a === p && t.b === r)) && G.t - t.t0 > 90);
      if (!seasoned) return no('Alliances are built on trust. Hold a pact or trade deal with us for a while first.');
      if (alliesOf(r).length >= 3) return no('We have enough alliances.');
      if (G.nations[p].infamy > 40) return no('Your word is not worth much.');
      for (const e of enemiesOf(r)) if (allied(p, e)) return no('You are allied with our enemy.');
      for (const al of alliesOf(r)) if (atWar(al, p)) return no('You are at war with our ally.');
      return op >= 48 - P.diplo * 10 ? yes('Together, then.') : no('We are not close enough for that.');
    }
    case 'trade': {
      if (hasTreaty(r, p, 'trade')) return no('We already trade.');
      return op >= -4 - P.diplo * 3 ? yes() : no('Not interested in trading with you.');
    }
    case 'callarms': {
      const t = extra;
      if (!allied(r, p) && op < 35) return no('We are not obliged to fight your wars.');
      if (allied(r, t)) return no('We are allied with them.');
      if (truceLeft(r, t) > 0) return no('We have a truce with them.');
      if (op < 20) return no('You ask too much of us.');
      if (D.power[t] > D.power[r] * 2.2 * P.aggr) return no('That enemy is too strong for us.');
      return yes('We will stand with you.');
    }
    case 'tribute': {
      const fear = pw * (borders(r, p) ? 1 : 0.6);
      return fear * P.caution > 1.7 ? yes('Take it. Do not ask again soon.') : no('Come and take it.');
    }
  }
  return no('No.');
}
function applyAgreement(kind, a, b, extra) {
  const A = G.nations[a], B = G.nations[b];
  if (kind === 'ceasefire') { makePeace(a, b); return; }
  if (kind === 'nap') { addTreaty('nap', a, b, 360); log(`${A.short} and ${B.short} signed a non-aggression pact`, 'treaty', { nats: [a, b] }); }
  if (kind === 'access') { addTreaty('access', a, b, 360); log(`${A.short} and ${B.short} agreed passage rights`, 'treaty', { nats: [a, b] }); }
  if (kind === 'alliance') {
    removeTreaties(a, b, ['nap', 'access']);
    addTreaty('alliance', a, b, 0);
    log(`${A.short} and ${B.short} formed an alliance`, 'treaty', { nats: [a, b] });
  }
  if (kind === 'trade') { addTreaty('trade', a, b, 0); log(`${A.short} and ${B.short} opened a trade pact`, 'treaty', { nats: [a, b] }); }
  if (kind === 'callarms') { declareWar(b, extra, 'called'); return; }
  remember(a, b, 'Signed an agreement', 6, 300, 24); remember(b, a, 'Signed an agreement', 6, 300, 24);
}
function propose(from, to, kind, text, data, ttl) {
  if (G.proposals.some(p => p.from === from && p.kind === kind && p.to === to)) return;
  if (G.proposals.length >= 5) return;
  G.proposals.push({ id: G.nextProp++, from, to, kind, text, data: data || {}, t0: G.t, exp: G.t + (ttl || 50) });
  G.seq++;
  G.log.push({ s: G.seq, t: G.t, txt: `${G.nations[from].short}: ${text}`, kind: 'proposal', pid: null, me: true });
}
function answerProposal(id, yes) {
  const i = G.proposals.findIndex(p => p.id === id);
  if (i < 0) return { ok: false, msg: 'Offer expired' };
  const pr = G.proposals[i]; G.proposals.splice(i, 1);
  const me = pr.to;
  if (!yes) { remember(pr.from, me, 'Turned down our offer', -3, 200, 15); return { ok: true, msg: 'Declined' }; }
  if (pr.kind === 'tribute') {
    const n = G.nations[me], amt = Math.min(n.cash, pr.data.amount);
    n.cash -= amt; G.nations[pr.from].cash += amt;
    remember(pr.from, me, 'Paid tribute', 4, 300, 20);
    return { ok: true, msg: `Paid ${Math.round(amt)} cash` };
  }
  if (pr.kind === 'joinwar') { return declareWar(me, pr.data.target, 'ally'); }
  if (pr.kind === 'ceasefire' && !atWar(me, pr.from)) return { ok: false, msg: 'No longer at war' };
  applyAgreement(pr.kind, pr.from, me, pr.data.target);
  return { ok: true, msg: 'Agreed' };
}

// player-facing diplomacy entry point
function diplo(action, from, to, extra) {
  const A = G.nations[from], B = G.nations[to];
  if (!B.alive) return { ok: false, msg: 'Nation no longer exists' };
  if (action === 'war') return declareWar(from, to);
  if (action === 'gift') {
    const amt = extra || 100;
    if (A.cash < amt) return { ok: false, msg: 'Not enough cash' };
    A.cash -= amt; B.cash += amt;
    remember(to, from, 'Gift received', Math.min(30, amt / 6), 240, 40);
    return { ok: true, msg: `${B.short} appreciates the gift` };
  }
  if (action === 'tribute') {
    const r = evalProposal('tribute', to, from);
    const amt = Math.round(Math.max(60, B.cash * 0.3));
    if (r.ok && !B.player) {
      const take = Math.min(B.cash, amt); B.cash -= take; A.cash += take;
      remember(to, from, 'Extorted us', -25, 600, 50);
      return { ok: true, msg: `${B.short} pays ${Math.round(take)} cash under protest` };
    }
    remember(to, from, 'Threatened us', -15, 400, 40);
    return { ok: false, msg: r.msg };
  }
  if (action === 'break') {
    const t = extra;
    if (!hasTreaty(from, to, t)) return { ok: false, msg: 'No such treaty' };
    removeTreaties(from, to, [t]);
    remember(to, from, 'Cancelled our agreement', -8, 300, 30);
    enforceBorders();
    return { ok: true, msg: 'Treaty cancelled' };
  }
  const r = evalProposal(action, to, from, extra);
  if (!r.ok) {
    if (action !== 'ceasefire') remember(to, from, 'Pestering us', -1, 120, 6);
    return r;
  }
  applyAgreement(action, from, to, extra);
  return r;
}

// ---------------------------------------------------------------- AI : economy
function enemyComp(ids) {
  const c = { inf: 0, art: 0, arm: 0, air: 0 }; let tot = 0;
  for (const id of ids) for (const a of D.armiesBy[id]) for (const t of UT) { c[t] += a.u[t]; tot += a.u[t]; }
  for (const t of UT) c[t] = tot ? c[t] / tot : 0.25;
  return c;
}
// opinions are costly to compute, so the AI caches them for one think
let opMemo = null;
const opn = (a, b) => {
  if (!opMemo) return opinion(a, b).total;
  const k = a * 1000 + b;
  let v = opMemo.get(k);
  if (v === undefined) { v = opinion(a, b).total; opMemo.set(k, v); }
  return v;
};
function threatScore(nid, pid) {
  let s = 0;
  for (const q of PS[pid].nbrs) {
    const o = G.provs[q].owner;
    if (o === nid) continue;
    if (atWar(nid, o)) s += 3;
    else if (allied(nid, o)) s += 0;
    else s += opn(nid, o) < -10 ? 1.2 : 0.3;
  }
  for (const a of D.armyAt[pid] || []) if (atWar(nid, a.owner)) s += 4;
  if (G.nations[nid].capital === pid) s += 0.6;
  return s;
}
function aiEconomy(n) {
  const nid = n.id, P = pers(n), owned = D.owned[nid];
  if (!owned.length) return;
  const wars = enemiesOf(nid);
  const ts = {};
  for (const pid of owned) ts[pid] = threatScore(nid, pid);
  let want = { inf: 0.42, art: 0.16, arm: 0.30, air: 0.12 };
  if (wars.length) {
    const ec = enemyComp(wars);
    if (ec.arm > 0.33) { want.air += 0.1; want.art += 0.05; want.arm -= 0.08; want.inf -= 0.07; }
    if (ec.inf > 0.55) { want.arm += 0.1; want.art += 0.05; want.inf -= 0.15; }
    if (ec.air > 0.18) { want.inf += 0.1; want.arm -= 0.05; want.air -= 0.05; }
  }
  const have = emptyU(); let tot = 0;
  for (const a of D.armiesBy[nid]) for (const t of UT) { have[t] += a.u[t]; tot += a.u[t]; }
  for (const pid of owned) for (const it of G.provs[pid].q) { have[it.type] += 1; tot += 1; }
  const reserve = wars.length ? P.reserve * 0.3 : P.reserve;
  const armyCap = 10 + owned.length * 1.8 + Math.max(0, n.rate.cash) * 4;
  // where each unit type can be trained right now
  const site = t => {
    let bestP = -1, bestS = -1;
    for (const pid of owned) {
      const p = G.provs[pid];
      if (p.q.length >= 2 || p.cap || p.battle || !canTrain(p, t)) continue;
      const s = ts[pid] + (t === 'inf' ? 0 : 0.5 * Math.max(...UNITS[t].fast.map(k => p.b[k]))) + Math.random() * 0.4;
      if (s > bestS) { bestS = s; bestP = pid; }
    }
    return bestP;
  };
  let made = 0;
  while (made < 3 && tot < armyCap) {
    if (n.rate.net < 0.25 && tot > 14 && !wars.length) break;
    const order = UT.slice().sort((a, b) => (want[b] - have[b] / Math.max(1, tot)) - (want[a] - have[a] / Math.max(1, tot)));
    let pick = null, where = -1;
    for (const t of order) {
      if (!canPay(n, unitCost(t)) || n.cash - UNITS[t].cost.cash < reserve) continue;
      where = site(t);
      if (where >= 0) { pick = t; break; }
    }
    if (!pick) break;
    cmdRecruit(nid, where, pick);       // recruit near the front
    have[pick] += 1; tot += 1; made++;
  }
  aiBuild(n, wars, reserve, ts);
}
// pick the most useful construction projects for this nation
function aiBuild(n, wars, reserve, ts) {
  const nid = n.id, P = pers(n), owned = D.owned[nid];
  if (n.cash < 120 * P.econ + reserve || Math.random() > 0.7) return;
  const busy = owned.reduce((s, pid) => s + (G.provs[pid].bq ? 1 : 0), 0);
  const slots = Math.min(4, 1 + Math.floor(owned.length / 8)) - busy;
  if (slots <= 0) return;
  const count = {};
  for (const k of BK) count[k] = 0;
  const levels = {};
  for (const k of BK) levels[k] = 0;
  for (const pid of owned) for (const k of BK) { const l = G.provs[pid].b[k]; if (l > 0) count[k]++; levels[k] += l; }
  // how badly we need more of a resource: high when the stock is low
  const short = r => clamp(1.5 - n[r] / 400, 0.05, 1.5);
  const opts = [];
  for (const pid of owned) {
    const p = G.provs[pid], d = PS[pid], t = ts[pid] || 0;
    if (p.bq || p.cap || p.battle) continue;
    const add = (k, sc) => {
      if (sc <= 0 || p.b[k] >= MAX_LVL || (BLD[k].coast && !d.coast)) return;
      opts.push([sc / (1 + p.b[k]) * (0.75 + Math.random() * 0.5), pid, k]);
    };
    // production: enough army bases, spread along the front, and at least one air base
    if (count.army < 1 + owned.length / 7) add('army', 2 + 0.5 * t + d.pop * 0.2);
    else if (p.b.army) add('army', 0.3 * t);
    if (!count.airb && owned.length >= 3) add('airb', 2.2 + d.pop * 0.2 - 0.3 * t);
    else if (p.b.airb && wars.length) add('airb', 0.6);
    // defence where it is needed
    add('fort', (wars.length ? 0.9 : 0.3) * t);
    add('hosp', (wars.length ? 0.35 : 0.1) * t);
    // economy
    add('infra', P.econ * (d.cash + RES_RATE) * 1.4);
    add('recr', P.econ * (0.25 + d.pop * 0.12) * short('man'));
    add('arms', P.econ * 0.8 * short('comp'));
    add('naval', P.econ * d.cash * 0.5);
    add('lab', (P.econ - 0.6) * (levels.lab < 1 + owned.length / 10 ? 1.5 : 0));
  }
  opts.sort((a, b) => b[0] - a[0]);
  let made = 0;
  for (const [, pid, k] of opts) {
    if (made >= slots) break;
    const c = buildCost(k, G.provs[pid].b[k]);
    if (n.cash - c.cash < reserve || RES.some(r => r !== 'cash' && c[r] && n[r] - c[r] < 40)) continue;   // keep stock for units
    if (cmdBuild(nid, pid, k).ok) made++;
  }
}

// ---------------------------------------------------------------- AI : military
function mergeIdle(nid) {
  const groups = {};
  for (const a of G.armies) if (a.owner === nid && a.at != null && !a.mv && !a.route.length) (groups[a.at] = groups[a.at] || []).push(a);
  for (const pid in groups) {
    const g = groups[pid];
    if (g.length < 2) continue;
    g.sort((x, y) => unitPow(y.u) - unitPow(x.u));
    for (let i = 1; i < g.length; i++) { for (const t of UT) g[0].u[t] += g[i].u[t]; }
    const dead = new Set(g.slice(1));
    G.armies = G.armies.filter(a => !dead.has(a));
  }
}
function sumUnits(list) { const u = emptyU(); for (const a of list) for (const t of UT) u[t] += a.u[t]; return u; }
function provValue(pid, nid) {
  const d = PS[pid], p = G.provs[pid];
  let lv = 0;
  for (const k of BK) lv += p.b[k];
  return d.pop * 0.6 + 1 + lv * 0.5 + (G.nations[p.owner].capital === pid ? 8 : 0) + (p.orig === nid ? 3 : 0);
}
const available = (a) => a.at != null && !a.mv;

function aiMilitary(n) {
  const nid = n.id, P = pers(n);
  const diffAggr = G.opts.diff === 'hard' ? 1.15 : G.opts.diff === 'easy' ? 0.8 : 1;
  const aggr = P.aggr * diffAggr;
  mergeIdle(nid);
  refresh();
  let stacks = G.armies.filter(a => a.owner === nid && available(a));
  const wars = enemiesOf(nid);
  const used = new Set();
  const order = (a, pid) => { orderMove(a, pid); used.add(a); };
  // travel time from a stack to every province, one search per stack
  const djc = new Map();
  const tt = (s, pid) => {
    let dj = djc.get(s);
    if (!dj) { dj = dijkstra(nid, s.at, armySpeed(s)); djc.set(s, dj); }
    return dj.dist[pid];
  };

  // 1. fight or flee where a battle is already on
  for (const s of stacks) {
    const p = G.provs[s.at];
    if (!p.battle) {
      // keep standing in an enemy province until it falls
      if (p.owner !== nid && atWar(nid, p.owner)) used.add(s);
      continue;
    }
    const fs = forcesIn(s.at, true);
    for (let i = 0; i < 140; i++) {
      roundForces(fs, 1, false);
      const mineLeft = fs.filter(f => f.nat === nid || allied(f.nat, nid)).reduce((x, f) => x + unitCount(f.u), 0);
      const foeLeft = fs.filter(f => atWar(f.nat, nid)).reduce((x, f) => x + unitCount(f.u), 0);
      if (mineLeft < 0.3 || foeLeft < 0.3) break;
    }
    const mineLeft = fs.filter(f => f.nat === nid || allied(f.nat, nid)).reduce((x, f) => x + unitCount(f.u), 0);
    const foeLeft = fs.filter(f => atWar(f.nat, nid)).reduce((x, f) => x + unitCount(f.u), 0);
    if (mineLeft < 0.5 && foeLeft > 2 && n.capital !== s.at) {
      let esc = null, bestE = -1;
      for (const q of PS[s.at].nbrs) {
        if (!canEnter(nid, q) || hostileHere(nid, q)) continue;
        const sc = (G.provs[q].owner === nid ? 2 : 0) + Math.random();
        if (sc > bestE) { bestE = sc; esc = q; }
      }
      if (esc !== null) order(s, esc);
    } else used.add(s);
  }
  stacks = stacks.filter(s => !used.has(s) && !(s.hold > G.t));

  // 2. defence: cover provinces that are about to be hit
  const threats = [];
  for (const pid of D.owned[nid]) {
    const p = G.provs[pid];
    let thr = 0;
    for (const a of D.armyAt[pid] || []) if (atWar(nid, a.owner)) thr += unitPow(a.u);
    for (const q of PS[pid].nbrs) for (const a of D.armyAt[q] || []) if (atWar(nid, a.owner)) thr += unitPow(a.u) * 0.7;
    for (const a of G.armies) if (a.mv && a.mv.to === pid && atWar(nid, a.owner)) thr += unitPow(a.u);
    if (thr <= 0) continue;
    const db = 1 + defBonus(p);
    let local = p.garrison * 36 * db;
    for (const a of D.armyAt[pid] || []) if (a.owner === nid) local += unitPow(a.u) * db;
    if (thr > local * 0.7) threats.push({ pid, thr, local, cap: n.capital === pid });
  }
  threats.sort((x, y) => (y.cap ? 1e6 : 0) + y.thr - ((x.cap ? 1e6 : 0) + x.thr));
  const threatened = new Set(threats.map(t => t.pid));
  for (const t of threats) {
    let have = t.local;
    const cands = stacks.filter(s => !used.has(s) && s.at !== t.pid && !threatened.has(s.at))
      .map(s => ({ s, tt: tt(s, t.pid) }))
      .filter(x => x.tt < 45).sort((x, y) => x.tt - y.tt);
    for (const c of cands) {
      if (have > t.thr * 1.1) break;
      order(c.s, t.pid); have += unitPow(c.s.u);
      c.s.hold = G.t + c.tt + 15;
    }
  }
  stacks = stacks.filter(s => !used.has(s));

  // 3. offence
  if (wars.length && stacks.length) {
    // opportunistic strikes from where we already stand
    for (const s of stacks.slice()) {
      for (const q of PS[s.at].nbrs) {
        const o = G.provs[q].owner;
        if (!atWar(nid, o) || !canEnter(nid, q)) continue;
        const pr = predictAttack(nid, s.u, q);
        if (pr.win && pr.keep > 0.65) { order(s, q); break; }
      }
    }
    stacks = stacks.filter(s => !used.has(s));
    if (stacks.length) {
      const cand = [];
      for (const e of wars) for (const tp of D.owned[e]) for (const r of PS[tp].nbrs) {
        const R = G.provs[r];
        if (R.owner === nid || allied(R.owner, nid)) cand.push({ R: r, T: tp, e });
      }
      const total = sumUnits(stacks);
      const cache = {};
      let best = null;
      const keepNeed = clamp(0.55 / Math.pow(aggr, 1.2), 0.25, 0.7);
      for (const c of cand) {
        const pr = cache[c.T] || (cache[c.T] = predictAttack(nid, total, c.T));
        const win = pr.win && pr.keep >= keepNeed;
        let score = provValue(c.T, nid) * (win ? 1 : 0.05) + (win ? pr.keep * 2 : 0);
        if (n.ai.focus && n.ai.focus.T === c.T && n.ai.focus.R === c.R && G.t - n.ai.focus.t < 90) score *= 1.6;
        if (!best || score > best.score) best = { ...c, score, win, pr };
      }
      if (best && best.win) {
        if (!n.ai.focus || n.ai.focus.T !== best.T || n.ai.focus.R !== best.R) n.ai.focus = { R: best.R, T: best.T, t: G.t };
        const atR = stacks.filter(s => s.at === best.R);
        if (atR.length) {
          const u = sumUnits(atR);
          const pr = predictAttack(nid, u, best.T);
          if (pr.win && pr.keep >= keepNeed * 0.9) {
            mergeIdle(nid);
            const merged = G.armies.find(a => a.owner === nid && a.at === best.R && !a.mv);
            if (merged) order(merged, best.T);
          }
        }
        for (const s of stacks) if (!used.has(s) && s.at !== best.R && G.armies.includes(s)) order(s, best.R);
      } else {
        n.ai.focus = null;
        // nothing winnable yet: mass at the busiest front and keep building
        const fronts = [...new Set(cand.map(c => c.R))];
        if (fronts.length) {
          const fts = {};
          for (const f of fronts) fts[f] = threatScore(nid, f);
          fronts.sort((a, b) => fts[b] - fts[a]);
          for (const s of stacks) if (!used.has(s) && !fronts.includes(s.at)) order(s, fronts[0]);
        }
      }
    }
  }

  // 4. peacetime posture: move interior stacks to the border
  stacks = stacks.filter(s => !used.has(s) && G.armies.includes(s));
  if (stacks.length) {
    const fronts = D.owned[nid].filter(pid => PS[pid].nbrs.some(q => G.provs[q].owner !== nid && !allied(G.provs[q].owner, nid)));
    if (fronts.length) {
      const fts = {};
      for (const f of fronts) fts[f] = threatScore(nid, f);
      const load = {};
      for (const a of G.armies) if (a.owner === nid) { const loc = a.at != null ? a.at : a.mv.to; load[loc] = (load[loc] || 0) + unitPow(a.u); }
      for (const s of stacks) {
        if (fronts.includes(s.at) || s.route.length) continue;
        let bp = -1, bs = -Infinity;
        for (const f of fronts) {
          const d = tt(s, f);
          const sc = fts[f] * 400 - (load[f] || 0) * 0.5 - (d === Infinity ? 600 : d * 2);
          if (sc > bs) { bs = sc; bp = f; }
        }
        if (bp >= 0) { orderMove(s, bp); load[bp] = (load[bp] || 0) + unitPow(s.u); }
      }
    }
  }
}

// ---------------------------------------------------------------- AI : diplomacy
function shouldSeekPeace(a, e) {
  const ws = warStat(a, e), P = pers(G.nations[a]);
  const ratio = D.power[a] / Math.max(1, D.power[e]);
  const sc = (1 - ratio) * 1.6 + clamp(ws.dur / 500, 0, 1.2) - (ws.a - ws.b) * 0.25 + (G.t - ws.last > 150 ? 0.4 : 0) - (P.aggr - 1) * 0.5;
  return ws.dur > 40 && sc > 0.55;
}
function aiWar(n) {
  const nid = n.id, P = pers(n);
  const aggr = P.aggr * (G.opts.diff === 'hard' ? 1.15 : G.opts.diff === 'easy' ? 0.8 : 1);
  if (G.t < G.grace) return;
  const wars = enemiesOf(nid);
  if (wars.length >= (aggr > 1.2 ? 2 : 1)) return;
  if (G.t - n.ai.lastWar < 120) return;
  if (Math.random() > 0.3) return;
  let best = null;
  for (const c of G.nations) {
    if (!c.alive || c.id === nid || atWar(nid, c.id) || allied(nid, c.id) || truceLeft(nid, c.id) > 0) continue;
    if (!inContact(nid, c.id)) continue;
    let my = D.power[nid], th = D.power[c.id];
    for (const x of G.nations) {
      if (!x.alive || x.id === nid || x.id === c.id) continue;
      if (allied(c.id, x.id) && !allied(nid, x.id)) th += D.power[x.id] * 0.6;
      if (allied(nid, x.id) && !allied(c.id, x.id)) my += D.power[x.id] * 0.4;
    }
    const ratio = my / Math.max(1, th);
    const hegemon = D.share[c.id] > 0.27 && D.share[nid] < D.share[c.id];
    let need = 1.25 / aggr;
    need *= clamp(1 - (G.t - n.ai.lastWar - 180) / 2400, 0.78, 1);     // restlessness after long peace
    if (hegemon) need *= 0.75;
    if (hasTreaty(nid, c.id, 'nap') || hasTreaty(nid, c.id, 'trade')) need *= 1.35;
    if (ratio < need) continue;
    let prize = 0;
    for (const pid of D.owned[c.id]) if (PS[pid].nbrs.some(q => G.provs[q].owner === nid)) prize += provValue(pid, nid);
    const score = (ratio - need) * 2 + prize * 0.05 - opinion(nid, c.id).total * 0.01 + (hegemon ? 1 : 0);
    if (!best || score > best.score) best = { id: c.id, score };
  }
  if (best) { n.ai.warTarget = best.id; declareWar(nid, best.id, 'ambition'); n.ai.lastWar = G.t; }
}
function cd(n, k, secs) { if ((n.ai.tprop[k] || 0) > G.t) return false; n.ai.tprop[k] = G.t + secs; return true; }
function aiDiplomacy(n) {
  const nid = n.id, P = pers(n);
  // peace
  for (const e of enemiesOf(nid)) {
    if (!shouldSeekPeace(nid, e)) continue;
    const E = G.nations[e];
    if (E.player) { if (cd(n, 'cf' + e, 90)) propose(nid, e, 'ceasefire', 'proposes a ceasefire.', {}, 50); }
    else if (evalProposal('ceasefire', e, nid).ok) makePeace(nid, e);
  }
  // allies join our wars
  for (const e of enemiesOf(nid)) for (const x of alliesOf(nid)) {
    const X = G.nations[x];
    if (atWar(x, e) || truceLeft(x, e) > 0 || allied(x, e)) continue;
    if (X.player) { if (cd(n, 'jw' + e + x, 120)) propose(nid, x, 'joinwar', `asks you to join the war against ${G.nations[e].short}.`, { target: e }, 60); }
    else if (enemiesOf(x).length < 2 && evalProposal('callarms', x, nid, e).ok && Math.random() < 0.5) declareWar(x, e, 'ally');
  }
  // treaties
  const others = alive().filter(o => o.id !== nid && !atWar(nid, o.id)).sort(() => Math.random() - 0.5).slice(0, 3);
  for (const o of others) {
    if (Math.random() > 0.25 * P.diplo) continue;
    const kinds = ['trade', 'nap', 'access', 'alliance'].filter(k => {
      if (k === 'trade') return !hasTreaty(nid, o.id, 'trade');
      if (k === 'nap') return !hasTreaty(nid, o.id, 'nap') && !allied(nid, o.id);
      if (k === 'access') return !hasAccess(nid, o.id);
      if (k === 'alliance') return !allied(nid, o.id) && D.share[nid] < 0.45;
    });
    if (!kinds.length) continue;
    const k = kinds[Math.floor(Math.random() * kinds.length)];
    if (!cd(n, k + o.id, 100)) continue;
    if (!evalProposal(k, nid, o.id).ok) continue;           // we only offer what we would accept ourselves
    if (o.player) propose(nid, o.id, k, ({ trade: 'offers a trade pact.', nap: 'offers a non-aggression pact.', access: 'asks for passage rights.', alliance: 'proposes an alliance.' })[k], {}, 60);
    else if (evalProposal(k, o.id, nid).ok) applyAgreement(k, nid, o.id);
  }
  // keep friendships warm
  for (const o of alive()) if (o.id !== nid && !atWar(nid, o.id) && (hasTreaty(nid, o.id, 'trade') || allied(nid, o.id)) && Math.random() < 0.4) remember(nid, o.id, 'Peaceful relations', 2, 400, 15);
  // renew expiring pacts
  for (const t of G.treaties.slice()) {
    if (!t.exp || (t.type !== 'nap' && t.type !== 'access')) continue;
    if (t.a !== nid && t.b !== nid) continue;
    if (t.exp - G.t > 45) continue;
    const o = t.a === nid ? t.b : t.a;
    if (G.nations[o].player) continue;
    if (evalProposal(t.type, nid, o).ok || opinion(nid, o).total > 10) { t.exp = G.t + 360; }
  }
  // the strong lean on the weak
  const me = G.opts.player;
  if (me >= 0 && G.nations[me].alive && !atWar(nid, me) && !allied(nid, me) && G.t > G.grace + 60 && G.t - (n.ai.lastTribute || 0) > 300 &&
      D.power[nid] > D.power[me] * 2 && borders(nid, me) && pers(n).aggr > 0.9 && Math.random() < 0.15) {
    n.ai.lastTribute = G.t;
    const amt = Math.round(Math.max(80, G.nations[me].cash * 0.25));
    propose(nid, me, 'tribute', `demands ${amt} cash as tribute.`, { amount: amt }, 60);
  }
}
function aiThink(n) {
  if (!n.alive) return;
  opMemo = new Map();
  aiEconomy(n);
  aiMilitary(n);
  n.ai.cycle = (n.ai.cycle || 0) + 1;
  opMemo = null;
  if (n.ai.cycle % 4 === 0) { aiDiplomacy(n); aiWar(n); }
}

// ---------------------------------------------------------------- player commands
function cmdRecruit(nat, pid, type) {
  const n = G.nations[nat], p = G.provs[pid];
  if (p.owner !== nat) return { ok: false, msg: 'Not your province' };
  if (p.cap || p.battle) return { ok: false, msg: 'Province is under siege' };
  if (!canTrain(p, type)) return { ok: false, msg: `Needs a ${BLD[UNITS[type].need].n.toLowerCase()} here` };
  if (p.q.length >= 6) return { ok: false, msg: 'Training queue is full' };
  const c = unitCost(type);
  if (!canPay(n, c)) return { ok: false, msg: 'Not enough resources' };
  pay(n, c);
  const tm = trainTime(p, type);
  p.q.push({ type, left: tm, total: tm });
  return { ok: true, msg: `${UNITS[type].n} queued` };
}
function cmdBuild(nat, pid, kind) {
  const n = G.nations[nat], p = G.provs[pid], B = BLD[kind];
  if (!B) return { ok: false, msg: 'Unknown building' };
  if (p.owner !== nat) return { ok: false, msg: 'Not your province' };
  if (B.coast && !PS[pid].coast) return { ok: false, msg: 'Only coastal cities can have a naval base' };
  if (p.bq) return { ok: false, msg: `Already building ${BLD[p.bq.k].n.toLowerCase()} here` };
  if (p.cap || p.battle) return { ok: false, msg: 'Province is under siege' };
  const lvl = p.b[kind];
  if (lvl >= MAX_LVL) return { ok: false, msg: 'Already at maximum level' };
  const c = buildCost(kind, lvl);
  if (!canPay(n, c)) return { ok: false, msg: 'Not enough resources' };
  pay(n, c);
  const tm = buildTime(kind, lvl);
  p.bq = { k: kind, left: tm, total: tm };
  return { ok: true, msg: `${B.n} level ${lvl + 1} under construction (${tm}s)` };
}
function cmdCancelBuild(nat, pid) {
  const n = G.nations[nat], p = G.provs[pid];
  if (p.owner !== nat || !p.bq) return { ok: false, msg: 'Nothing under construction' };
  const c = buildCost(p.bq.k, p.b[p.bq.k]);
  for (const k in c) n[k] += c[k] / 2;
  p.bq = null;
  return { ok: true, msg: 'Construction cancelled, half refunded' };
}
function cmdMove(aid, dest) {
  const a = G.armies.find(x => x.id === aid);
  if (!a) return { ok: false, msg: 'Army not found' };
  return orderMove(a, dest);
}
function cmdStop(aid) {
  const a = G.armies.find(x => x.id === aid);
  if (a) a.route = [];
}
function cmdSplit(aid, mode) {
  const a = G.armies.find(x => x.id === aid);
  if (!a || a.at == null) return { ok: false, msg: 'Army must be stationary' };
  const b = emptyU();
  if (mode === 'half') { for (const t of UT) { b[t] = a.u[t] / 2; a.u[t] -= b[t]; } }
  else if (mode === 'quarter') { for (const t of UT) { b[t] = a.u[t] / 4; a.u[t] -= b[t]; } }
  else if (UT.includes(mode)) { b[mode] = a.u[mode]; a.u[mode] = 0; }
  if (unitCount(b) < 0.5 || unitCount(a.u) < 0.5) { for (const t of UT) a.u[t] += b[t]; return { ok: false, msg: 'Too small to split' }; }
  const n = newArmy(a.owner, a.at); n.u = b;
  return { ok: true, msg: 'Army split', id: n.id };
}
function cmdMerge(nat, pid) {
  const list = G.armies.filter(a => a.owner === nat && a.at === pid && !a.mv);
  if (list.length < 2) return { ok: false, msg: 'Nothing to merge' };
  list.sort((x, y) => unitPow(y.u) - unitPow(x.u));
  for (let i = 1; i < list.length; i++) for (const t of UT) list[0].u[t] += list[i].u[t];
  const dead = new Set(list.slice(1));
  G.armies = G.armies.filter(a => !dead.has(a));
  list[0].route = [];
  return { ok: true, msg: 'Armies merged', id: list[0].id };
}
function cmdDisband(aid) {
  G.armies = G.armies.filter(a => a.id !== aid);
}

// ---------------------------------------------------------------- main loop
function secondTick() {
  G.armies = G.armies.filter(a => unitCount(a.u) >= 0.3);
  refresh();
  processBattles();
  unrestTick();
  // treaties expire
  for (const t of G.treaties.slice()) if (t.exp && t.exp <= G.t) {
    G.treaties.splice(G.treaties.indexOf(t), 1);
    if (t.type !== 'truce') log(`${G.nations[t.a].short} and ${G.nations[t.b].short}: ${t.type === 'nap' ? 'non-aggression pact' : 'passage agreement'} expired`, 'treaty', { nats: [t.a, t.b] });
    enforceBorders();
  }
  G.proposals = G.proposals.filter(p => p.exp > G.t && G.nations[p.from].alive);
  // infamy fades
  for (const n of G.nations) if (n.infamy > 0) n.infamy = Math.max(0, n.infamy - 0.04);
  // prune memories
  if (G.memory.length > 400) G.memory = G.memory.filter(m => Math.abs(effMem(m)) >= 1);
  refresh();
  computeRates();
  for (const n of G.nations) {
    if (!n.alive) continue;
    if (n.player && !G.opts.autoplay) continue;
    if (G.t >= n.ai.next) { aiThink(n); n.ai.next = G.t + 2.2 + rnd(0, 1.2); }
  }
  // milestones
  const me = G.opts.player;
  if (me >= 0 && G.nations[me].alive && D.share[me] >= 0.6 && !G.flags.dominance) { G.flags.dominance = 1; G.flags.dominanceAsk = true; }
}
function step(dt) {
  G.t += dt;
  econTick(dt);
  prodTick(dt);
  moveTick(dt);
  G.acc1 += dt;
  while (G.acc1 >= 1) { G.acc1 -= 1; secondTick(); }
}

// ---------------------------------------------------------------- setup / save
const SAVE_V = 2;
// the main province of a state: the one with the most people
const mainOf = st => byState[st].reduce((a, b) => (PS[b].pop > PS[a].pop ? b : a));
const startStock = f => ({ cash: 400 * f, man: 60 * f, sup: 90 * f, comp: 90 * f, fuel: 70 * f, elec: 40 * f, rare: 40 * f, rp: 0 });
function newGame(opts) {
  opts = Object.assign({ player: 0, diff: 'normal' }, opts || {});
  G = { v: SAVE_V, t: 0, acc1: 0, opts, nations: [], provs: [], armies: [], nextArmy: 1, wars: {}, treaties: [], nextTid: 1,
        memory: [], proposals: [], nextProp: 1, log: [], seq: 0, flags: {}, grace: 90, wstat: {} };
  NATIONS.forEach((def, i) => G.nations.push(Object.assign({
    id: i, name: def.name, short: def.short, color: def.color, pers: def.pers, player: i === opts.player, alive: true,
    capital: mainOf(def.cap), infamy: 0, rate: zeroRate(),
    ai: { next: rnd(0.5, 4), focus: null, tprop: {}, lastWar: 0 }, orig: i,
  }, startStock(1))));
  MAPD.provinces.forEach((p, i) => G.provs.push({ id: i, owner: -1, orig: -1, garrison: 0, b: emptyB(), bq: null, unrest: 0, cap: null, q: [], battle: false }));
  NATIONS.forEach((def, i) => def.states.forEach(st => byState[st].forEach(pid => { const p = G.provs[pid]; p.owner = i; p.orig = i; })));
  // starting buildings: a developed capital, and an army base in each state's main city
  for (const n of G.nations) {
    for (const st of NATIONS[n.id].states) G.provs[mainOf(st)].b.army = 1;
    const c = G.provs[n.capital].b;
    Object.assign(c, { army: 2, airb: 1, recr: 1, fort: 1, infra: 1 });
    if (PS[n.capital].coast) c.naval = 1;
  }
  G.provs.forEach(p => { p.garrison = maxGar(p); });
  refresh();
  // one army per state, in its main city, sized by the state's population
  for (const n of G.nations) {
    for (const st of NATIONS[n.id].states) {
      const pid = mainOf(st), pop = STATE[st][0], a = newArmy(n.id, pid);
      a.u.inf = 2 + Math.round(Math.pow(pop, 0.3));
      const border = byState[st].some(q => PS[q].nbrs.some(r => G.provs[r].owner !== n.id));
      if (border && pop > 3) a.u.arm = 1;
      if (pid === n.capital) { a.u.inf += 4; a.u.arm += 2; a.u.art += 2; a.u.air += 1; }
    }
  }
  refresh(); computeRates();
  log('The map is drawn. Borders are quiet, for now.', 'info', {});
  return G;
}
function serialize() { return JSON.stringify(G); }
function load(str) {
  const g = JSON.parse(str);
  if (g.v !== SAVE_V || !g.provs || g.provs.length !== NP) throw new Error('This save is from an older version of the map');
  G = g; refresh(); computeRates(); return G;
}
const saveOk = o => !!o && o.v === SAVE_V && !!o.provs && o.provs.length === NP;

return {
  UT, UNITS, PERS, NATIONS, PS, MAXLVL: MAX_LVL, CAPTURE_T, RES, RESN, BLD, BK, byState,
  get G() { return G; }, get D() { return D; },
  newGame, step, serialize, load, saveOk, refresh, computeRates,
  atWar, allied, hasTreaty, hasAccess, truceLeft, opinion, canEnter, borders,
  unitPow, unitCount, armySpeed, routeTime, findRoute, predictAttack, defBonus, maxGar,
  buildCost, buildTime, unitCost, canPay, provRates, canTrain, trainTime,
  cmdRecruit, cmdBuild, cmdCancelBuild, cmdMove, cmdStop, cmdSplit, cmdMerge, cmdDisband,
  diplo, answerProposal, evalProposal, warStat, enemiesOf, alliesOf, pers,
};
})();
