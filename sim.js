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
// Units. cls: combat class (sets the damage table); dom: land (ground and air, march together),
// sea (ships, sail the coast) or msl (missiles, fly to a target and hit once).
// need: buildings (and levels) the province needs to train it; fast: buildings whose level speeds training;
// vs: this unit's own damage multipliers by target class, over the class table; ign: share of defence bonuses it ignores.
const UNITS = {
  // ground
  inf:  { n: 'Rifle infantry',       s: 'Inf',  cat: 'Ground', cls: 'inf',  dom: 'land', atk: 3,   hp: 12, spd: 14, time: 7,  upk: 0.05, cost: { cash: 40, man: 6, sup: 5 },                         need: null,         fast: ['army', 'recr'], d: 'Cheap and steady. Holds ground and handles helicopters.' },
  mech: { n: 'Mechanized infantry',  s: 'Mech', cat: 'Ground', cls: 'veh',  dom: 'land', atk: 4,   hp: 16, spd: 18, time: 10, upk: 0.08, cost: { cash: 50, man: 6, sup: 4, comp: 10, fuel: 5 },          need: { army: 1 },  fast: ['army'], d: 'Infantry in armored carriers: tougher and faster.' },
  abn:  { n: 'Airborne troops',      s: 'Abn',  cat: 'Ground', cls: 'inf',  dom: 'land', atk: 4,   hp: 11, spd: 16, time: 12, upk: 0.08, cost: { cash: 55, man: 5, sup: 6, elec: 5 },                  need: { airb: 1 },  fast: ['airb'], d: 'Trained at an air base. An army of only airborne troops and aircraft is flown, at air speed.' },
  sf:   { n: 'Special forces',       s: 'SF',   cat: 'Ground', cls: 'inf',  dom: 'land', atk: 7,   hp: 12, spd: 16, time: 16, upk: 0.12, cost: { cash: 80, man: 4, sup: 6, elec: 10 },                need: { army: 2 },  fast: ['army'], ign: 0.5, d: 'Elite raiders. Ignore half of the enemy defence bonuses.' },
  art:  { n: 'Field artillery',      s: 'Art',  cat: 'Ground', cls: 'art',  dom: 'land', atk: 7,   hp: 8,  spd: 11, time: 11, upk: 0.08, cost: { cash: 50, man: 4, sup: 4, comp: 20 },                 need: { army: 1 },  fast: ['army'], ign: 0.5, d: 'Shells dug-in defenders. Ignores half of all defence bonuses.' },
  arm:  { n: 'Battle tank',          s: 'Tank', cat: 'Ground', cls: 'veh',  dom: 'land', atk: 8,   hp: 20, spd: 19, time: 14, upk: 0.12, cost: { cash: 70, man: 4, comp: 25, fuel: 15 },               need: { army: 1 },  fast: ['army'], d: 'Breaks infantry lines. Weak against attack helicopters and bombers.' },
  flak: { n: 'Mobile flak',          s: 'Flak', cat: 'Ground', cls: 'veh',  dom: 'land', atk: 4,   hp: 14, spd: 17, time: 11, upk: 0.08, cost: { cash: 55, man: 3, comp: 18, fuel: 6, elec: 6 },       need: { army: 1 },  fast: ['army'], vs: { air: 2.4, heli: 2.6, msl: 3 }, d: 'Anti-air that marches with the army. Shoots down aircraft and missiles.' },
  // air
  heli: { n: 'Attack helicopter',    s: 'Heli', cat: 'Air',    cls: 'heli', dom: 'land', atk: 8,   hp: 9,  spd: 36, time: 15, upk: 0.12, cost: { cash: 75, man: 2, comp: 14, fuel: 14, elec: 8 },     need: { airb: 1 },  fast: ['airb'], d: 'Tank hunter. Vulnerable to flak and infantry.' },
  ftr:  { n: 'Interceptor',          s: 'Int',  cat: 'Air',    cls: 'air',  dom: 'land', atk: 9,   hp: 10, spd: 60, time: 18, upk: 0.15, cost: { cash: 90, man: 2, comp: 15, fuel: 18, elec: 15 },    need: { airb: 1 },  fast: ['airb'], vs: { air: 2.2, heli: 2.2, msl: 1.5, inf: 0.35, veh: 0.3, art: 0.35, ship: 0.3, sub: 0 }, d: 'Wins the sky: hunts enemy aircraft and missiles, weak against ground targets.' },
  bmb:  { n: 'Strike bomber',        s: 'Bmb',  cat: 'Air',    cls: 'air',  dom: 'land', atk: 12,  hp: 12, spd: 44, time: 24, upk: 0.2,  cost: { cash: 120, man: 2, comp: 22, fuel: 25, elec: 12 },    need: { airb: 2 },  fast: ['airb'], vs: { air: 0.2, heli: 0.3, inf: 1.3, veh: 1.8, art: 1.8, ship: 1.6, sub: 0.1 }, d: 'Heavy strikes on armor, guns and ships. Easy prey for interceptors.' },
  pat:  { n: 'Patrol aircraft',      s: 'Pat',  cat: 'Air',    cls: 'air',  dom: 'land', atk: 6,   hp: 10, spd: 50, time: 16, upk: 0.1,  cost: { cash: 70, man: 2, comp: 10, fuel: 14, elec: 12 },     need: { airb: 1 },  fast: ['airb'], vs: { sub: 3, ship: 1.3, air: 0.3, heli: 0.5, inf: 0.4, veh: 0.4, art: 0.4 }, d: 'Finds and sinks submarines, and harries ships near the coast.' },
  // sea
  pb:   { n: 'Patrol boat',          s: 'PB',   cat: 'Sea',    cls: 'ship', dom: 'sea',  atk: 5,   hp: 14, spd: 30, time: 12, upk: 0.08, cost: { cash: 50, man: 3, comp: 15, fuel: 10 },               need: { naval: 1 }, fast: ['naval'], d: 'Fast coastal boat. Cheap screen for the fleet.' },
  dd:   { n: 'Destroyer',            s: 'DD',   cat: 'Sea',    cls: 'ship', dom: 'sea',  atk: 9,   hp: 26, spd: 26, time: 24, upk: 0.16, cost: { cash: 110, man: 4, comp: 35, fuel: 18, elec: 10 },    need: { naval: 2 }, fast: ['naval'], vs: { sub: 2, air: 1.2, heli: 1.2, msl: 1.5 }, d: 'Escort that hunts submarines and shoots at aircraft.' },
  sub:  { n: 'Attack submarine',     s: 'Sub',  cat: 'Sea',    cls: 'sub',  dom: 'sea',  atk: 10,  hp: 16, spd: 22, time: 26, upk: 0.15, cost: { cash: 110, man: 3, comp: 30, fuel: 10, elec: 15, rare: 5 }, need: { naval: 2 }, fast: ['naval'], d: 'Sinks ships and is hard to hit. Only destroyers and patrol aircraft find it.' },
  cru:  { n: 'Strike cruiser',       s: 'Cru',  cat: 'Sea',    cls: 'ship', dom: 'sea',  atk: 12,  hp: 40, spd: 22, time: 40, upk: 0.25, cost: { cash: 180, man: 5, comp: 55, fuel: 25, elec: 20, rare: 10 }, need: { naval: 3 }, fast: ['naval'], d: 'Big guns for shore bombardment and fleet battles.' },
  // missiles
  msl:  { n: 'Cruise missile',       s: 'Msl',  cat: 'Missile', cls: 'msl', dom: 'msl',  atk: 200, hp: 2,  spd: 90, time: 20, upk: 0.02, cost: { cash: 100, comp: 20, fuel: 12, elec: 20, rare: 10 },  need: { arms: 1 },  fast: ['arms'], ign: 0.5, d: 'Flies to a province at war with you and hits once, often wrecking a level of its defences. Flak, interceptors and anti-air can shoot it down.' },
};
const UT = Object.keys(UNITS);

// Research. One project at a time; research points pour into it until its cost is met
// (a saved-up stock pours in faster, but never all at once).
// fx: atk / hp: multipliers by unit category; fly: speed of armies that fly; march: speed of other land armies;
// out: all province output; cash: cash only; train / build: share of training / construction time saved;
// med: share of damage your troops take less; fort: extra defence per fortification level;
// aa: anti-air strength; evade: share of your missiles that slip past interception; range: missile range;
// unlock: unit types that need this tech.
const TECH = {
  inf1: { n: 'Infantry doctrine',     br: 'Ground',  tier: 1, fx: { atk: { Ground: 0.1 } }, d: 'Ground units hit 10% harder.' },
  arm1: { n: 'Composite armor',       br: 'Ground',  tier: 2, req: ['inf1'], fx: { hp: { Ground: 0.12 } }, d: 'Ground units are 12% tougher.' },
  cmb1: { n: 'Combined arms',         br: 'Ground',  tier: 3, req: ['arm1'], fx: { atk: { Ground: 0.1 }, hp: { Ground: 0.05 } }, d: 'Ground units hit 10% harder and are 5% tougher.' },
  jet1: { n: 'Jet engines',           br: 'Air',     tier: 1, fx: { atk: { Air: 0.08 }, fly: 0.15 }, d: 'Aircraft hit 8% harder, and armies that fly are 15% faster.' },
  bmb1: { n: 'Strategic aviation',    br: 'Air',     tier: 2, req: ['jet1'], fx: { unlock: ['bmb'] }, d: 'Unlocks the strike bomber (needs an air base at level 2).' },
  stl1: { n: 'Stealth airframes',     br: 'Air',     tier: 3, req: ['bmb1'], fx: { hp: { Air: 0.15 }, atk: { Air: 0.08 } }, d: 'Aircraft are 15% tougher and hit 8% harder.' },
  gun1: { n: 'Naval gunnery',         br: 'Sea',     tier: 1, fx: { atk: { Sea: 0.12 } }, d: 'Ships hit 12% harder.' },
  cap1: { n: 'Capital ships',         br: 'Sea',     tier: 2, req: ['gun1'], fx: { unlock: ['cru'] }, d: 'Unlocks the strike cruiser (needs a naval base at level 3).' },
  son1: { n: 'Sonar and damage control', br: 'Sea',  tier: 3, req: ['cap1'], fx: { hp: { Sea: 0.15 }, atk: { Sea: 0.05 } }, d: 'Ships are 15% tougher and hit 5% harder.' },
  gm1:  { n: 'Guided missiles',       br: 'Missile', tier: 1, fx: { unlock: ['msl'] }, d: 'Unlocks the cruise missile (needs an arms industry).' },
  rad1: { n: 'Radar network',         br: 'Missile', tier: 2, fx: { aa: 0.3 }, d: 'Anti-air, flak, interceptors and destroyers shoot 30% better, at aircraft and missiles alike.' },
  tfg1: { n: 'Terrain-following guidance', br: 'Missile', tier: 3, req: ['gm1'], fx: { evade: 0.4, range: 0.25 }, d: '40% of your missiles slip past interception, and they fly 25% further.' },
  ind1: { n: 'Industrial automation', br: 'Economy', tier: 1, fx: { out: 0.08 }, d: 'Every province makes 8% more of everything.' },
  log1: { n: 'Logistics',             br: 'Economy', tier: 1, fx: { march: 0.1, train: 0.1 }, d: 'Land armies march 10% faster and units train 10% faster.' },
  med1: { n: 'Field medicine',        br: 'Economy', tier: 2, req: ['log1'], fx: { med: 0.06 }, d: 'Your troops take 6% less damage everywhere.' },
  eng1: { n: 'Engineering corps',     br: 'Economy', tier: 2, req: ['ind1'], fx: { build: 0.2, fort: 0.05 }, d: 'Construction is 20% faster and each fortification level adds 5% more defence.' },
  fin1: { n: 'Modern finance',        br: 'Economy', tier: 3, req: ['ind1'], fx: { cash: 0.1, out: 0.04 }, d: 'Cash income +10% and all output +4%.' },
};
const TK = Object.keys(TECH);
const BRANCHES = ['Ground', 'Air', 'Sea', 'Missile', 'Economy'];
const TIER_RP = { 1: 120, 2: 300, 3: 600 };
const techCost = k => TIER_RP[TECH[k].tier];
// research points per second a project can absorb: the nation's own rate plus a share of its stock
const pourRate = n => (n.rate ? n.rate.rp : 0) * 1.5 + 0.3;
for (const k of TK) for (const t of TECH[k].fx.unlock || []) UNITS[t].tech = k;
const CATS = ['Ground', 'Air', 'Sea', 'Missile'];
// damage multiplier by class: CM[attacker class][target class]
const CM = {
  inf:  { inf: 1,   veh: 0.55, art: 1.2, air: 0.3,  heli: 0.6, ship: 0.15, sub: 0,   msl: 0.1 },
  veh:  { inf: 1.5, veh: 1,    art: 1.3, air: 0.1,  heli: 0.3, ship: 0.3,  sub: 0,   msl: 0 },
  art:  { inf: 1.4, veh: 1.1,  art: 1,   air: 0.05, heli: 0.1, ship: 0.6,  sub: 0,   msl: 0 },
  air:  { inf: 1,   veh: 1.5,  art: 1.3, air: 1,    heli: 1.2, ship: 1.2,  sub: 0.2, msl: 0.5 },
  heli: { inf: 1.1, veh: 1.8,  art: 1.3, air: 0.2,  heli: 0.8, ship: 0.8,  sub: 0.3, msl: 0 },
  ship: { inf: 1.1, veh: 1,    art: 1.1, air: 0.6,  heli: 0.8, ship: 1,    sub: 0.5, msl: 0.5 },
  sub:  { inf: 0,   veh: 0,    art: 0,   air: 0,    heli: 0,   ship: 1.8,  sub: 0.6, msl: 0 },
  msl:  { inf: 1.3, veh: 1.5,  art: 1.5, air: 0.2,  heli: 0.3, ship: 1.6,  sub: 0,   msl: 0 },
};
// how likely a class is to take hits
const TWC = { inf: 1, veh: 1, art: 0.45, air: 0.8, heli: 0.8, ship: 1, sub: 0.5, msl: 0.3 };
const MULT = {}, TW = {};
for (const t of UT) {
  const U = UNITS[t]; MULT[t] = {}; TW[t] = TWC[U.cls];
  for (const t2 of UT) { const c2 = UNITS[t2].cls; MULT[t][t2] = U.vs && U.vs[c2] !== undefined ? U.vs[c2] : CM[U.cls][c2]; }
}
const AIRCLS = { air: 1, heli: 1, msl: 1 };
const isAirT = t => !!AIRCLS[UNITS[t].cls];
const isAir = {}; for (const t of UT) isAir[t] = isAirT(t);
const AIR_T = UT.filter(isAirT);
const LAND_T = UT.filter(t => UNITS[t].dom === 'land'), SEA_T = UT.filter(t => UNITS[t].dom === 'sea'), MSL_T = UT.filter(t => UNITS[t].dom === 'msl');
const GROUND_T = UT.filter(t => UNITS[t].cat === 'Ground');
const K_DMG = 0.16;
const CAPTURE_T = 20;      // base seconds of unopposed occupation to take a province
const MAX_LVL = 3;         // default building cap (BLD entries may set their own max)

const ENTRENCH_T = 60;     // seconds standing still on friendly soil to dig in fully
const ENTRENCH_MAX = 0.3;  // defence bonus when fully dug in
const FLAK = 0.5;          // hp of damage per anti-air level per second against enemy air

// City buildings. Cost and build time are for level 1: level n costs n times as much and takes
// 1 + 0.6(n-1) times as long. `max` overrides the default cap of MAX_LVL.
const BLD = {
  army:  { n: 'Army base',         d: 'Needed to train artillery and armor. Ground units train 15% faster per level.', cost: { cash: 80, sup: 15, comp: 15 },  time: 30 },
  airb:  { n: 'Air base',          d: 'Needed to train air wings. They train 15% faster per level.',                   cost: { cash: 110, comp: 20, fuel: 15 }, time: 40 },
  naval: { n: 'Naval base',        d: 'Coastal cities only. Port trade: +15% cash here per level.',                     cost: { cash: 100, sup: 10, comp: 20 }, time: 40, coast: true },
  recr:  { n: 'Recruiting office', d: '+0.15 manpower per level. Infantry trains 15% faster per level.',                  cost: { cash: 60, sup: 12 },            time: 20 },
  arms:  { n: 'Arms industry',     d: '+0.4 components per level. Needed to build cruise missiles.',                   cost: { cash: 110, sup: 15, rare: 15 }, time: 45 },
  hosp:  { n: 'Hospital',          d: 'Your troops here take 10% less damage per level, and the garrison recovers faster.', cost: { cash: 80, sup: 15, elec: 10 }, time: 30 },
  fort:  { n: 'Fortifications',    d: '+20% defence for all defenders per level, a bigger garrison and a slower capture.', cost: { cash: 60, sup: 10, comp: 12 }, time: 20, max: 5 },
  bunk:  { n: 'Bunkers',           d: 'The garrison takes less damage, +2 garrison and faster refill per level.',       cost: { cash: 70, sup: 10, comp: 25 },  time: 25 },
  aa:    { n: 'Anti-air',          d: 'Shoots at enemy aircraft over the city and blunts air strikes.',                 cost: { cash: 60, comp: 20, elec: 10 }, time: 20 },
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
// Sea graph: ships sail between coastal provinces that touch, along the sea lanes, and across a few
// short gaps where the coast between two ports is not a province of its own.
const SEA_LINKS = [['ME', 'Portland', 'MA', 'Boston'], ['NY', 'New York', 'NJ', 'Toms River']];
const SEA_NB = PS.map(p => p.coast ? p.nbrs.filter(q => PS[q].coast) : []);
for (const [s1, n1, s2, n2] of SEA_LINKS) {
  const a = PS.find(p => p.st === s1 && p.name === n1), b = PS.find(p => p.st === s2 && p.name === n2);
  if (!a || !b || !a.coast || !b.coast) continue;
  if (!SEA_NB[a.id].includes(b.id)) { SEA_NB[a.id].push(b.id); SEA_NB[b.id].push(a.id); }
  if (!EDGE[a.id * NP + b.id]) EDGE[a.id * NP + b.id] = EDGE[b.id * NP + a.id] = Math.hypot(a.cx - b.cx, a.cy - b.cy);
}
const nbrsOf = (dom, u) => dom === 'sea' ? SEA_NB[u] : PS[u].nbrs;
// Road network (buildroads.mjs): node i < NP is province i's city, the rest are waypoints.
// Land armies travel only along roads and can stop at any node; fleets and missiles go city to city.
const NODES = MAPD.nodes, NN = NODES.length;
const NODE_P = NODES.map(n => n[2]);
const RADJ = Array.from({ length: NN }, () => []);
const RLEN = new Map();
MAPD.roads.forEach(([a, b, d]) => {
  const w = d || Math.hypot(NODES[a][0] - NODES[b][0], NODES[a][1] - NODES[b][1]);
  RADJ[a].push(b); RADJ[b].push(a); RLEN.set(a * NN + b, w); RLEN.set(b * NN + a, w);
});
const NODES_OF = PS.map(() => []);
NODES.forEach((n, i) => NODES_OF[n[2]].push(i));
const ROAD_K = 0.85;    // roads wind a little, so road distance is scaled to keep the old travel times
const MSL_RANGE = 260;     // how far (map units) a missile flies
const mslDist = (a, b) => Math.hypot(PS[a].cx - PS[b].cx, PS[a].cy - PS[b].cy);
// Alaska and Hawaii are drawn as insets, so map distance means nothing across them
const INSET = { AK: 1, HI: 1 };
const inRange = (a, b, nat) => (INSET[PS[a].st] || INSET[PS[b].st] ? PS[a].st === PS[b].st : true) && mslDist(a, b) <= mslRange(nat);
const mslRange = nat => MSL_RANGE * (1 + (nat == null ? 0 : modsOf(nat).range));

// ---------------------------------------------------------------- state
let G = null;
let D = null;     // derived caches, rebuilt every second

const pers = n => PERS[n.pers];
// what a nation's finished research adds up to
function calcMods(n) {
  const m = { atk: {}, hp: {}, fly: 0, march: 0, out: 0, cash: 0, train: 0, build: 0, med: 0, fort: 0, aa: 0, evade: 0, range: 0 };
  for (const c of ['Ground', 'Air', 'Sea', 'Missile']) { m.atk[c] = 1; m.hp[c] = 1; }
  for (const k in n.tech || {}) {
    const fx = TECH[k] && TECH[k].fx;
    if (!fx) continue;
    for (const f in fx) {
      if (f === 'atk' || f === 'hp') for (const c in fx[f]) m[f][c] += fx[f][c];
      else if (f !== 'unlock') m[f] += fx[f];
    }
  }
  n.mods = m;
  return m;
}
const modsOf = id => { const n = G.nations[id]; return (n && (n.mods || calcMods(n))) || NOMODS; };
const NOMODS = calcMods({ tech: {} });
const hasTech = (id, k) => !!(G.nations[id] && G.nations[id].tech && G.nations[id].tech[k]);
// rough fighting strength; a missile counts for little because it is spent in one hit
const POW = {}; for (const t of UT) POW[t] = UNITS[t].dom === 'msl' ? 50 : UNITS[t].atk * UNITS[t].hp;
const unitPow = u => UT.reduce((s, t) => s + u[t] * POW[t], 0);
const unitCount = u => UT.reduce((s, t) => s + u[t], 0);
const cloneU = u => { const o = {}; for (const t of UT) o[t] = u[t] || 0; return o; };
const emptyU = () => { const o = {}; for (const t of UT) o[t] = 0; return o; };
const garU = g => { const o = emptyU(); o.inf = g; return o; };
// which kind of army a unit belongs to, and an army's kind
const domOf = a => { for (const t of UT) if (a.u[t] > 0.02 && UNITS[t].dom !== 'land') return UNITS[t].dom; return 'land'; };
const groundCount = u => GROUND_T.reduce((s, t) => s + u[t], 0);
const maxGar = p => PS[p.id].gar * (p.orig === p.owner ? 1.6 : 1) + 1.5 * p.b.fort + 2 * p.b.bunk + (G.nations[p.owner] && G.nations[p.owner].capital === p.id ? 3 : 0);
const isCapital = p => !!G.nations[p.owner] && G.nations[p.owner].capital === p.id;
// home soil (a nation's original provinces) is defended harder, the capital hardest
const homeBonus = p => (p.orig === p.owner ? 0.25 : 0) + (isCapital(p) ? 0.25 : 0);
const defBonus = p => PS[p.id].def + (0.2 + modsOf(p.owner).fort) * p.b.fort + homeBonus(p);
const captureTime = p => CAPTURE_T * (1 + 0.25 * p.b.fort + 0.25 * p.b.bunk + (p.orig === p.owner ? 0.5 : 0) + (isCapital(p) ? 0.5 : 0));
// armies standing still on their own or allied soil dig in over time
const entrench = (a, p) => (a.since == null || a.mv) ? 0 : ENTRENCH_MAX * clamp((G.t - a.since) / ENTRENCH_T, 0, 1);
const armySpeed = a => {
  const m = modsOf(a.owner), base = rawSpeed(a);
  if (domOf(a) !== 'land') return base;
  return Math.round(base * (1 + (isFlying(a) ? m.fly : m.march)));
};
const isFlying = a => { for (const t of UT) if (a.u[t] > 0.3 && t !== 'abn' && !isAirT(t)) return false; return true; };
const rawSpeed = a => {
  let s = 999, onlyFliers = true;
  for (const t of UT) if (a.u[t] > 0.3) {
    if (t === 'abn' || isAirT(t)) continue;
    onlyFliers = false; s = Math.min(s, UNITS[t].spd);
  }
  // airborne troops travelling with nothing but aircraft are flown in
  if (onlyFliers) { s = 999; for (const t of UT) if (a.u[t] > 0.3 && isAirT(t)) s = Math.min(s, UNITS[t].spd); if (s === 999) s = 40; if (a.u.abn > 0.3) s = Math.min(s, 40); }
  return s;
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
  const tm = modsOf(p.owner);
  const m = (1 + 0.25 * b.infra + tm.out) * (1 - 0.6 * p.unrest) * (p.cap ? 0.5 : 1);
  const capital = n.capital === pid;
  out.cash += d.cash * m * (capital ? 1.25 : 1) * (1 + 0.15 * b.naval + tm.cash);
  out.man += (d.man + 0.15 * b.recr) * m;
  out[d.res] += RES_RATE * m;
  out.sup += SUP_BASE * m;
  out.comp += 0.4 * b.arms * m;
  out.rp += (0.25 * b.lab + (capital ? 0.15 : 0)) * (1 - 0.6 * p.unrest);
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

// ---------------------------------------------------------------- market
// One world market where every nation sells surplus for cash and buys what it lacks. Each resource has a
// base price; a price index (G.mkt.idx) falls as nations sell and rises as they buy, by a factor of e for
// every MKT_DEPTH units, and drifts back towards 1. Each trade pays a fee, halved with any trade pact.
const MKT_RES = ['man', 'sup', 'comp', 'fuel', 'elec', 'rare'];
const MKT_BASE = { man: 0.8, sup: 0.6, comp: 1.5, fuel: 1.3, elec: 1.7, rare: 1.9 };
const MKT_DEPTH = 800;
const MKT_MIN = 0.3, MKT_MAX = 3;
const AUTO_STEPS = [0, 250, 500, 1000, 2500];     // auto-sell thresholds the player can pick (0 = off)
const newMkt = () => ({ idx: Object.fromEntries(MKT_RES.map(k => [k, 1])), prev: Object.fromEntries(MKT_RES.map(k => [k, 1])) });
const mktFee = nat => G.treaties.some(t => t.type === 'trade' && (t.a === nat || t.b === nat)) ? 0.05 : 0.1;
const mktPrice = k => MKT_BASE[k] * G.mkt.idx[k];
// what q units would cost (q > 0, buying) or fetch (q < 0, selling), walking the price as the trade fills
function mktQuote(nat, k, q) {
  const i0 = G.mkt.idx[k], fee = mktFee(nat);
  if (q > 0) {
    const i1 = Math.min(MKT_MAX, i0 * Math.exp(q / MKT_DEPTH));
    return { cash: MKT_BASE[k] * MKT_DEPTH * (i1 - i0) * (1 + fee), idx: i1, fee };
  }
  const i1 = Math.max(MKT_MIN, i0 * Math.exp(q / MKT_DEPTH));
  return { cash: MKT_BASE[k] * MKT_DEPTH * (i0 - i1) * (1 - fee), idx: i1, fee };
}
function cmdTrade(nat, k, q) {
  const n = G.nations[nat];
  if (!n || !MKT_BASE[k] || !q) return { ok: false, msg: 'Nothing to trade' };
  if (q < 0 && n[k] < -q - 1e-9) return { ok: false, msg: `Not enough ${RESN[k].n.toLowerCase()}` };
  const qt = mktQuote(nat, k, q);
  if (q > 0 && n.cash < qt.cash) return { ok: false, msg: 'Not enough cash' };
  if (q < 0 && qt.cash < 0.5) return { ok: false, msg: 'Nobody is buying at this price' };
  n[k] += q; n.cash += q > 0 ? -qt.cash : qt.cash; G.mkt.idx[k] = qt.idx;
  n.mktNet = (n.mktNet || 0) + (q > 0 ? -qt.cash : qt.cash);
  if (q < 0) n.mktSold = (n.mktSold || 0) + qt.cash;
  return { ok: true, msg: `${q > 0 ? 'Bought' : 'Sold'} ${Math.abs(Math.round(q))} ${RESN[k].n.toLowerCase()} for $${Math.round(qt.cash)}`, cash: qt.cash };
}
// prices drift back to normal with a little noise; the player's auto-sell runs every 10 seconds
function mktTick() {
  for (const k of MKT_RES) {
    let i = G.mkt.idx[k];
    i += (1 - i) * 0.004 + i * rnd(-0.004, 0.004);
    G.mkt.idx[k] = clamp(i, MKT_MIN, MKT_MAX);
  }
  if (Math.floor(G.t) % 60 === 0) G.mkt.prev = Object.assign({}, G.mkt.idx);
  if (Math.floor(G.t) % 10 === 0) for (const n of G.nations) {
    if (!n.alive || !n.auto) continue;
    for (const k of MKT_RES) {
      const cap = n.auto[k];
      if (cap && n[k] > cap + 5 && G.mkt.idx[k] > MKT_MIN * 1.2) cmdTrade(n.id, k, -Math.min(n[k] - cap, 150));
    }
  }
}
function cmdAutoSell(nat, k, cap) {
  const n = G.nations[nat];
  if (!MKT_BASE[k]) return { ok: false, msg: 'Unknown resource' };
  n.auto = n.auto || {};
  n.auto[k] = cap || 0;
  return { ok: true, msg: cap ? `Selling ${RESN[k].n.toLowerCase()} above ${cap}` : `Auto-sell for ${RESN[k].n.toLowerCase()} off` };
}
// ---------------------------------------------------------------- missions
// Goals for the player made from the state of the game, three at a time. Progress is checked every second;
// a finished mission pays its reward at once (resources and research points, never anything bought) and a
// new one is drawn a little later. A mission that can no longer be done is quietly replaced.
const MISSION_SLOTS = 3;
const totUnits = nid => G.armies.reduce((s, a) => s + (a.owner === nid ? unitCount(a.u) : 0), 0);
const techCount = n => Object.keys(n.tech || {}).length;
const maxBld = (nid, k) => (D.owned[nid] || []).reduce((m, pid) => Math.max(m, G.provs[pid].b[k]), 0);
// each kind: when it can be offered, how to set it up, and its progress [have, need]
const MISSIONS = {
  capture: {
    ok: nid => enemiesOf(nid).length > 0,
    make(n) {
      const own = new Set(D.owned[n.id]), cands = [];
      for (const pid of own) for (const q of PS[pid].nbrs) if (atWar(n.id, G.provs[q].owner) && !cands.includes(q)) cands.push(q);
      if (!cands.length) return null;
      cands.sort((a, b) => maxGar(G.provs[a]) * (1 + G.provs[a].b.fort) - maxGar(G.provs[b]) * (1 + G.provs[b].b.fort));
      const q = cands[Math.floor(rnd(0, Math.min(3, cands.length)))], o = G.nations[G.provs[q].owner];
      return { tgt: q, w: 3, t: `Take ${PS[q].name}`, d: `Capture ${PS[q].name} (${PS[q].stName}) from ${o.name}.` };
    },
    prog: (n, m) => [G.provs[m.tgt].owner === n.id ? 1 : 0, 1],
    alive: (n, m) => G.provs[m.tgt].owner === n.id || atWar(n.id, G.provs[m.tgt].owner),
  },
  kills: {
    ok: nid => enemiesOf(nid).length > 0,
    make(n) { const N = Math.max(6, Math.round(totUnits(n.id) * 0.5 / 5) * 5); return { base: n.kills || 0, goal: N, w: 2, t: `Destroy ${N} enemy units`, d: 'Units destroyed in any battle your forces fight in count, including garrisons.' }; },
    prog: (n, m) => [(n.kills || 0) - m.base, m.goal],
    alive: n => enemiesOf(n.id).length > 0,
  },
  build: {
    ok: () => true,
    make(n) {
      const opts = ['fort', 'aa', 'lab', 'arms', 'hosp', 'airb', 'army', 'infra', 'recr', 'bunk'].filter(k => BLD[k] && maxBld(n.id, k) < maxLvl(k));
      if (PS[n.capital].coast || D.owned[n.id].some(pid => PS[pid].coast)) if (maxBld(n.id, 'naval') < maxLvl('naval')) opts.push('naval');
      if (!opts.length) return null;
      const k = opts[Math.floor(rnd(0, opts.length))], L = maxBld(n.id, k) + 1;
      return { bk: k, goal: L, w: 1 + 0.5 * L, t: `Build ${BLD[k].n} level ${L}`, d: `Raise a ${BLD[k].n.toLowerCase()} to level ${L} in any of your cities.` };
    },
    prog: (n, m) => [maxBld(n.id, m.bk), m.goal],
  },
  train: {
    ok: () => true,
    make(n) {
      const cats = ['Ground', 'Ground', 'Air'];
      if (D.owned[n.id].some(pid => PS[pid].coast && G.provs[pid].b.naval > 0)) cats.push('Sea');
      const c = cats[Math.floor(rnd(0, cats.length))], N = c === 'Ground' ? 8 : 4;
      return { cat: c, base: (n.trained || {})[c] || 0, goal: N, w: c === 'Ground' ? 1.5 : 2, t: `Train ${N} ${c.toLowerCase()} units`, d: c === 'Sea' ? 'Ships come from cities with a naval base.' : c === 'Air' ? 'Aircraft and helicopters need an air base.' : 'Any ground unit counts.' };
    },
    prog: (n, m) => [((n.trained || {})[m.cat] || 0) - m.base, m.goal],
  },
  research: {
    ok: n => techCount(G.nations[n]) < TK.length,
    make(n) { return { base: techCount(n), goal: 1, w: 1.5, t: 'Finish a research project', d: 'Pick one in the Tech tab; research labs make it faster.' }; },
    prog: (n, m) => [techCount(n) - m.base, m.goal],
  },
  pact: {
    ok: nid => !G.treaties.some(t => t.type === 'trade' && (t.a === nid || t.b === nid)),
    make() { return { w: 1, t: 'Sign a trade pact', d: 'Propose one to any nation in the Diplomacy tab. It adds cash and halves your market fee.' }; },
    prog: n => [G.treaties.some(t => t.type === 'trade' && (t.a === n.id || t.b === n.id)) ? 1 : 0, 1],
  },
  ally: {
    ok: nid => alliesOf(nid).length === 0,
    make() { return { w: 2, t: 'Form an alliance', d: 'Nations ally with friends: build trust with a pact or a trade deal first.' }; },
    prog: n => [alliesOf(n.id).length ? 1 : 0, 1],
  },
  market: {
    ok: () => true,
    make(n) { const N = Math.max(150, Math.round(n.rate.cash * 40 / 50) * 50); return { base: n.mktSold || 0, goal: N, w: 1, t: `Earn $${N} on the market`, d: 'Sell surplus resources in the Market tab, or let auto-sell do it.' }; },
    prog: (n, m) => [(n.mktSold || 0) - m.base, m.goal],
  },
  grow: {
    ok: nid => enemiesOf(nid).length > 0,
    make(n) { const N = D.owned[n.id].length + 2; return { goal: N, w: 3, t: `Hold ${N} provinces`, d: 'Expand your territory.' }; },
    prog: (n, m) => [D.owned[n.id].length, m.goal],
  },
  army: {
    ok: () => true,
    make(n) { const N = Math.round(totUnits(n.id) * 1.3 / 5) * 5 + 5; return { goal: N, w: 1.5, t: `Field ${N} units`, d: 'Count every unit in all your armies, fleets and salvos.' }; },
    prog: (n, m) => [totUnits(n.id), m.goal],
  },
};
const mInfo = m => { const n = G.nations[G.opts.player]; const [have, need] = MISSIONS[m.k].prog(n, m); return { have: Math.max(0, Math.min(have, need)), need }; };
// reward: cash worth about a minute and a half of income per weight point, a material and some research
function missionReward(n, w) {
  const r = { cash: Math.round(Math.max(60, n.rate.cash * 25) * w / 5) * 5 };
  const mats = ['comp', 'fuel', 'elec', 'rare'];
  const lo = mats.sort((a, b) => n[a] - n[b])[0];
  r[lo] = Math.round(30 * w);
  if (w >= 1.5) r.rp = Math.round(15 * w);
  return r;
}
function newMission(n) {
  const ms = G.missions, used = new Set(ms.list.map(m => m.k));
  const kinds = Object.keys(MISSIONS).filter(k => !used.has(k) && k !== ms.last && MISSIONS[k].ok(n.id));
  for (let tries = 0; tries < 6 && kinds.length; tries++) {
    const k = kinds.splice(Math.floor(rnd(0, kinds.length)), 1)[0];
    const m = MISSIONS[k].make(n);
    if (!m) continue;
    Object.assign(m, { id: ms.next++, k, at: G.t });
    m.rew = missionReward(n, m.w);
    if (MISSIONS[k].prog(n, m)[0] >= MISSIONS[k].prog(n, m)[1]) { ms.next--; continue; }
    ms.list.push(m);
    return m;
  }
  return null;
}
function missionTick() {
  const pid = G.opts.player, n = pid >= 0 && G.nations[pid];
  if (!n || !n.alive) return;
  const ms = G.missions || (G.missions = { list: [], next: 1, done: 0, wait: 0 });
  for (const m of ms.list.slice()) {
    const K = MISSIONS[m.k], [have, need] = K.prog(n, m);
    if (have >= need) {
      ms.list.splice(ms.list.indexOf(m), 1); ms.done++; ms.last = m.k;
      for (const k in m.rew) n[k] += m.rew[k];
      log(`Mission complete: ${m.t}. Reward ${rewardText(m.rew)}`, 'mission', { nats: [n.id] });
      ms.wait = G.t + 30;
    } else if (K.alive && !K.alive(n, m)) ms.list.splice(ms.list.indexOf(m), 1);
  }
  if (ms.list.length < MISSION_SLOTS && G.t >= (ms.wait || 0)) { newMission(n); ms.wait = G.t + (ms.list.length < MISSION_SLOTS ? 5 : 0); }
}
// drop a mission the player does not want; a new one is drawn a minute later
function cmdSkipMission(id) {
  const ms = G.missions, m = ms && ms.list.find(x => x.id === id);
  if (!m) return { ok: false, msg: 'No such mission' };
  ms.list.splice(ms.list.indexOf(m), 1); ms.last = m.k; ms.wait = G.t + 60;
  return { ok: true, msg: 'Mission dropped. A new one comes in a minute.' };
}
const rewardText = r => Object.keys(r).map(k => k === 'cash' ? '$' + r[k] : k === 'rp' ? r[k] + ' research' : r[k] + ' ' + RESN[k].n.toLowerCase()).join(', ');

// computer nations sell what piles up and buy what runs short
function aiMarket(n) {
  const P = pers(n);
  for (const k of MKT_RES) {
    const keep = k === 'man' ? 250 : 300, idx = G.mkt.idx[k];
    if (n[k] > keep && (idx > 0.55 || (n.cash < 60 && idx > MKT_MIN * 1.1))) {
      cmdTrade(n.id, k, -Math.min((n[k] - keep) * 0.3, 80));
    } else if (n[k] < 30 && n.cash > P.reserve * 1.5 && idx < 1.6) {
      cmdTrade(n.id, k, 40);
    }
  }
}
const unitCost = t => UNITS[t].cost;
const scaleCost = (c, f) => { const o = {}; for (const k in c) o[k] = Math.round(c[k] * f); return o; };
const buildCost = (kind, lvl) => scaleCost(BLD[kind].cost, lvl + 1);
const buildTime = (kind, lvl, nat) => Math.round(BLD[kind].time * (1 + 0.6 * lvl) * (nat == null ? 1 : 1 - modsOf(nat).build));
const maxLvl = kind => BLD[kind].max || MAX_LVL;
// level a building will reach once everything already queued is finished
const plannedLvl = (p, kind) => p.b[kind] + p.bq.filter(b => b.k === kind).length;
// can province p train unit type t, and how long does it take there
const canTrain = (p, t) => {
  const U = UNITS[t];
  if (U.dom === 'sea' && !PS[p.id].coast) return false;
  if (U.tech && !hasTech(p.owner, U.tech)) return false;
  return !U.need || Object.keys(U.need).every(k => p.b[k] >= U.need[k]);
};
// what a province still lacks to train t, as text
const needText = (p, t) => {
  const U = UNITS[t];
  if (U.dom === 'sea' && !PS[p.id].coast) return 'Coastal cities only';
  if (U.tech && !hasTech(p.owner, U.tech)) return 'Needs research: ' + TECH[U.tech].n;
  const miss = Object.keys(U.need || {}).filter(k => p.b[k] < U.need[k]);
  return miss.length ? 'Needs ' + miss.map(k => BLD[k].n.toLowerCase() + (U.need[k] > 1 ? ' ' + U.need[k] : '')).join(', ') : '';
};
const trainTime = (p, t) => UNITS[t].time * (1 - 0.15 * Math.max(...UNITS[t].fast.map(k => p.b[k]))) * (1 - modsOf(p.owner).train);

function prodTick(dt) {
  for (const p of G.provs) {
    if (p.cap || p.siege) continue;       // no training or building under siege
    if (p.bq.length) {
      const b = p.bq[0];
      b.left -= dt;
      if (b.left <= 0) {
        p.bq.shift();
        p.b[b.k] = Math.min(maxLvl(b.k), p.b[b.k] + 1);
        if (G.nations[p.owner].player) log(`${BLD[b.k].n} level ${p.b[b.k]} finished in ${PS[p.id].name}`, 'build', { pid: p.id, nats: [p.owner] });
      }
    }
    if (!p.q.length) continue;
    const it = p.q[0];
    it.left -= dt;
    if (it.left <= 0) {
      p.q.shift();
      const dom = UNITS[it.type].dom;
      let a = G.armies.find(x => x.owner === p.owner && x.at === p.id && x.n === p.id && !x.mv && !x.route.length && !x.strike && domOf(x) === dom);
      if (a) a.u[it.type] += 1;
      else { a = newArmy(p.owner, p.id); a.u[it.type] = 1; }
      const tn = G.nations[p.owner], cat = UNITS[it.type].cat;
      tn.trained = tn.trained || {}; tn.trained[cat] = (tn.trained[cat] || 0) + 1;
    }
  }
}
// research in progress
function researchTick(dt) {
  for (const n of G.nations) {
    if (!n.alive || !n.rs) continue;
    const pour = Math.min(n.rp, pourRate(n) * dt, n.rs.need - n.rs.got);
    n.rp -= pour; n.rs.got += pour;
    if (n.rs.got < n.rs.need - 1e-6) continue;
    const k = n.rs.k;
    n.tech[k] = 1; n.rs = null; calcMods(n);
    if (n.player) log(`Research complete: ${TECH[k].n}`, 'build', { nats: [n.id] });
  }
}
const techOpen = (n, k) => !n.tech[k] && (!TECH[k].req || TECH[k].req.every(r => n.tech[r]));
function cmdResearch(nat, k) {
  const n = G.nations[nat], T = TECH[k];
  if (!T) return { ok: false, msg: 'Unknown research' };
  if (n.tech[k]) return { ok: false, msg: 'Already researched' };
  if (!techOpen(n, k)) return { ok: false, msg: 'Needs ' + T.req.filter(r => !n.tech[r]).map(r => TECH[r].n).join(', ') + ' first' };
  if (n.rs) return { ok: false, msg: 'Already researching ' + TECH[n.rs.k].n };
  n.rs = { k, got: 0, need: techCost(k) };
  return { ok: true, msg: `Researching ${T.n}` };
}
function cmdCancelResearch(nat) {
  const n = G.nations[nat];
  if (!n.rs) return { ok: false, msg: 'Nothing to cancel' };
  n.rp += n.rs.got / 2; const k = n.rs.k; n.rs = null;
  return { ok: true, msg: `${TECH[k].n} cancelled, half refunded` };
}
function newArmy(owner, at) {
  const a = { id: G.nextArmy++, owner, u: emptyU(), at, n: at, mv: null, route: [], since: G.t };
  G.armies.push(a);
  return a;
}

// ---------------------------------------------------------------- movement
function edgeTime(i, j, speed) { return (EDGE[i * NP + j] || 100) / speed; }

// Dijkstra over provinces the nation may enter, with a small binary heap.
// Returns { dist, prev }; stops early once `to` is settled (if given).
function dijkstra(nat, from, speed, to, dom) {
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
    for (const v of nbrsOf(dom, u)) {
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
function findRoute(nat, from, to, speed, dom) {
  if (from === to) return [];
  if (dom === 'sea' && !PS[to].coast) return null;
  return pathTo(dijkstra(nat, from, speed, to, dom), from, to);
}
// time to travel a node route (land: roads; sea: city to city; missiles: straight)
function legTime(a, u, v, sp) {
  const dom = domOf(a);
  if (dom === 'msl') return mslDist(NODE_P[u], NODE_P[v]) / sp;
  if (dom === 'sea') return edgeTime(NODE_P[u], NODE_P[v], sp);
  return (RLEN.get(u * NN + v) || 100) * ROAD_K / sp;
}
function routeTime(a, route, startNode) {
  const sp = armySpeed(a); let t = 0, cur = startNode;
  for (const r of route) { t += legTime(a, cur, r, sp); cur = r; }
  return t;
}
// shortest road path between two nodes, only through the given provinces
function roadPath(fromN, toN, allowed) {
  if (fromN === toN) return [];
  const dist = new Map([[fromN, 0]]), prev = new Map(), done = new Set();
  const open = [fromN];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(open[i]) < dist.get(open[bi])) bi = i;
    const u = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    if (done.has(u)) continue;
    done.add(u);
    if (u === toN) break;
    for (const v of RADJ[u]) {
      if (done.has(v) || !allowed.has(NODE_P[v])) continue;
      const d = dist.get(u) + RLEN.get(u * NN + v);
      if (!(dist.get(v) <= d)) { dist.set(v, d); prev.set(v, u); open.push(v); }
    }
  }
  if (!prev.has(toN)) return null;
  const r = []; let c = toN;
  while (c !== fromN) { r.unshift(c); c = prev.get(c); }
  return r;
}
// node route from node fromN to node toN: the province route picks the corridor, the roads inside it the way
function nodeRoute(nat, fromN, toN, speed, dom) {
  const fp = NODE_P[fromN], tp = NODE_P[toN];
  const pr = findRoute(nat, fp, tp, speed, dom);
  if (!pr) return null;
  if (dom === 'sea') return pr;              // fleets sail from city to city (a city's node id is its province id)
  return roadPath(fromN, toN, new Set([fp, ...pr]));
}
// the node an army goes to in a province: the given one if it lies there, else the city
const nodeIn = (pid, node) => node != null && NODE_P[node] === pid ? node : pid;
function nearestNode(pid, x, y) {
  let best = pid, bd = Infinity;
  for (const i of NODES_OF[pid]) { const d = (NODES[i][0] - x) ** 2 + (NODES[i][1] - y) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}
// can this missile army fly to dest: a strike on an enemy, or a transfer to friendly ground
function missileOk(a, dest) {
  if (a.mv || a.strike) return { ok: false, msg: 'Already launched' };
  if (!inRange(a.at, dest, a.owner)) return { ok: false, msg: 'Out of missile range' };
  const o = G.provs[dest].owner;
  if (atWar(a.owner, o) || (D.armyAt[dest] || []).some(x => atWar(a.owner, x.owner))) return { ok: true, strike: true };
  if (o === a.owner || allied(a.owner, o)) return { ok: true, strike: false };
  return { ok: false, msg: 'Missiles can only strike a nation you are at war with' };
}
function orderMove(a, dest, node) {
  const sp = armySpeed(a), dom = domOf(a);
  a.held = null;
  if (dom === 'msl') {
    if (a.at === dest) return { ok: true, msg: 'Holding position' };
    const m = missileOk(a, dest);
    if (!m.ok) return m;
    const dur = mslDist(a.at, dest) / sp;
    a.mv = { from: a.at, to: dest, fn: a.n, tn: dest, t: 0, dur }; a.at = null; a.route = []; a.strike = m.strike;
    return { ok: true, msg: m.strike ? 'Missiles launched' : 'Missiles relocating', eta: dur };
  }
  if (dom === 'sea' && !PS[dest].coast) return { ok: false, msg: 'Ships can only sail to coastal provinces.' };
  const target = dom === 'sea' ? dest : nodeIn(dest, node);
  if (!a.mv) {
    if (a.n === target || (a.at === dest && node == null)) { a.route = []; return { ok: true, msg: 'Holding position' }; }
    const r = nodeRoute(a.owner, a.n, target, sp, dom);
    if (!r) return { ok: false, msg: dom === 'sea' ? 'No sea route there. Ships need open water and permission to pass.' : 'No permitted route. Declare war or get passage rights first.' };
    const eta = routeTime(a, r, a.n);
    a.route = r; startNext(a);
    return { ok: true, msg: 'Moving out', eta };
  }
  // already on the road: either carry on to the next stop, or turn around
  const fwdRoute = a.mv.tn === target ? [] : nodeRoute(a.owner, a.mv.tn, target, sp, dom);
  const fwdCost = a.mv.dur - a.mv.t + (fwdRoute ? routeTime(a, fwdRoute, a.mv.tn) : Infinity);
  let backRoute = null, backCost = Infinity;
  if (canEnter(a.owner, a.mv.from)) {
    backRoute = a.mv.fn === target ? [] : nodeRoute(a.owner, a.mv.fn, target, sp, dom);
    if (backRoute) backCost = a.mv.t + routeTime(a, backRoute, a.mv.fn);
  }
  if (fwdCost === Infinity && backCost === Infinity) return { ok: false, msg: 'No permitted route.' };
  if (backCost < fwdCost) {
    const { from, to, fn, tn, t, dur } = a.mv;
    a.mv = { from: to, to: from, fn: tn, tn: fn, t: dur - t, dur };
    if (from === to) a.at = from;
    a.route = backRoute;
    return { ok: true, msg: 'Turning back', eta: backCost };
  }
  a.route = fwdRoute;
  return { ok: true, msg: 'Redirected', eta: fwdCost };
}
// set off along the next leg; inside one province the army stays there (and can be fought)
function startNext(a) {
  const next = a.route.shift();
  if (next === undefined) { a.route = []; return; }
  const np = NODE_P[next], here = NODE_P[a.n];
  if (!canEnter(a.owner, np)) { a.route = []; return; }
  a.mv = { from: here, to: np, fn: a.n, tn: next, t: 0, dur: legTime(a, a.n, next, armySpeed(a)) };
  a.at = np === here ? here : null;
}
function hostileHere(nat, pid) {
  const p = G.provs[pid];
  if (atWar(nat, p.owner) && p.garrison > 0.3) return true;
  for (const x of G.armies) if (x.at === pid && x.owner !== nat && atWar(nat, x.owner)) return true;
  return false;
}
// armies that stopped to fight on the way pick their march back up once nothing hostile is left here
function resumeMarches() {
  for (const a of G.armies) {
    if (!a.held || a.mv || a.at == null) continue;
    if (a.route.length) { a.held = null; continue; }
    if (hostileHere(a.owner, a.at)) continue;
    const rest = a.held; a.held = null;
    if (rest.every(n => canEnter(a.owner, NODE_P[n]))) { a.route = rest; startNext(a); }
  }
}
function moveTick(dt) {
  for (const a of G.armies) {
    if (!a.mv) continue;
    a.mv.t += dt;
    if (a.mv.t >= a.mv.dur) {
      const entered = a.mv.from !== a.mv.to, over = a.mv.t - a.mv.dur;
      a.at = a.mv.to; a.n = a.mv.tn; a.mv = null;
      if (entered || !a.route.length) a.since = G.t;
      // engaged: stop and fight, then carry on to the destination once the way is clear
      if (hostileHere(a.owner, a.at)) { if (a.route.length) a.held = a.route; a.route = []; }
      else if (a.route.length) { startNext(a); if (a.mv) a.mv.t = Math.min(over, a.mv.dur); }
    }
  }
}
// pull armies out of territory they no longer have the right to stand in
function enforceBorders() {
  for (const a of G.armies) {
    if (a.at == null || a.strike || a.mv) continue;
    if (canEnter(a.owner, a.at)) continue;
    // nearest tile we may stand on
    const dom = domOf(a);
    const seen = new Set([a.at]); let frontier = [[a.at, []]], dest = null;
    while (frontier.length && !dest) {
      const nxt = [];
      for (const [u, path] of frontier) for (const v of nbrsOf(dom, u)) {
        if (seen.has(v)) continue; seen.add(v);
        const o = G.provs[v].owner;
        if (o === a.owner || hasAccess(a.owner, o)) { dest = path.concat([v]); break; }
        nxt.push([v, path.concat([v])]);
      }
      frontier = nxt;
    }
    if (!dest) continue;
    const last = dest[dest.length - 1];
    a.route = dom === 'sea' ? dest : (roadPath(a.n, last, new Set([a.at, ...dest])) || []);
    if (a.route.length) startNext(a);
  }
}

// ---------------------------------------------------------------- combat
function sizeOf(f) { let s = 0; for (const t of UT) s += f.u[t] * TW[t]; return s; }
function roundForces(forces, dt, noise) {
  const dmg = forces.map(() => emptyU());
  const sizes = forces.map(sizeOf);
  const act = forces.map(f => UT.filter(t => f.u[t] > 0));      // unit types each side still has
  for (let i = 0; i < forces.length; i++) {
    const f = forces[i];
    if (sizes[i] <= 0.01) continue;
    let tot = 0; const foes = [];
    for (let j = 0; j < forces.length; j++) if (j !== i && sizes[j] > 0.01 && atWar(f.nat, forces[j].nat)) { foes.push(j); tot += sizes[j]; }
    if (!foes.length) continue;
    const fm = modsOf(f.nat);
    for (const at of act[i]) {
      const c = f.u[at], U = UNITS[at], M = MULT[at];
      const base = c * U.atk * fm.atk[U.cat] * K_DMG * dt * (noise ? rnd(0.88, 1.12) : 1) * (f.gar ? 0.8 : 1);
      for (const j of foes) {
        const e = forces[j], share = sizes[j] / tot;
        // artillery, special forces and missiles ignore part of every defensive bonus; anti-air only matters against air
        const bonus = ((e.db || 0) + (e.hard || 0) + (isAir[at] ? 0.4 * (e.aa || 0) : 0)) * (1 - (U.ign || 0));
        const k = base * share * (1 - (e.med || 0)) / (1 + bonus) / sizes[j], dj = dmg[j];
        for (const dt2 of act[j]) dj[dt2] += k * e.u[dt2] * TW[dt2] * M[dt2];
      }
    }
  }
  // anti-air batteries fire at hostile air wings in the province
  for (let i = 0; i < forces.length; i++) {
    const f = forces[i];
    if (!f.flak || sizes[i] <= 0.01) continue;
    let air = 0;
    for (let j = 0; j < forces.length; j++) if (j !== i && atWar(f.nat, forces[j].nat)) for (const t of AIR_T) air += forces[j].u[t] * TW[t];
    if (air <= 0) continue;
    for (let j = 0; j < forces.length; j++) if (j !== i && atWar(f.nat, forces[j].nat)) for (const t of AIR_T) if (forces[j].u[t] > 0) dmg[j][t] += f.flak * FLAK * dt * forces[j].u[t] * TW[t] / air;
  }
  for (let i = 0; i < forces.length; i++) for (const t of act[i]) {
    const fm = modsOf(forces[i].nat);
    forces[i].u[t] = Math.max(0, forces[i].u[t] - dmg[i][t] * (1 - fm.med) / (UNITS[t].hp * fm.hp[UNITS[t].cat]));
    if (forces[i].u[t] < 0.02) forces[i].u[t] = 0;
  }
  return dmg;
}
function forcesIn(pid, clone, list) {
  const p = G.provs[pid], out = [];
  list = list || (D.armyAt[pid] || []);
  const db = defBonus(p), med = 0.1 * p.b.hosp, aa = p.b.aa * (1 + modsOf(p.owner).aa);
  if (p.garrison > 0.05) out.push({ nat: p.owner, u: clone ? garU(p.garrison) : null, gar: true, ref: p, db, med, aa, hard: 0.5 * p.b.bunk, flak: aa });
  for (const a of list) {
    if (a.at !== pid || (domOf(a) === 'msl' && !a.strike)) continue;
    const isDef = a.owner === p.owner || allied(a.owner, p.owner);
    out.push({ nat: a.owner, u: clone ? cloneU(a.u) : a.u, ref: a, db: isDef ? db + entrench(a, p) : 0, aa: isDef ? aa : 0, med: a.owner === p.owner ? med : 0 });
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

// anti-air, flak, interceptors and destroyers shoot down part of an incoming missile salvo before it hits
function intercept(forces) {
  for (const f of forces) {
    if (!f.ref || !f.ref.strike || !(f.u.msl > 0)) continue;
    let kill = 0;
    for (const g of forces) if (g !== f && atWar(f.nat, g.nat)) kill += (0.25 * (g.flak || 0) + (0.3 * g.u.flak + 0.15 * g.u.ftr + 0.2 * g.u.dd + 0.1 * g.u.cru) * (1 + modsOf(g.nat).aa));
    f.u.msl = Math.max(0, f.u.msl - Math.min(f.u.msl * 0.9, kill * rnd(0.6, 1.2) * (1 - modsOf(f.nat).evade)));
  }
}
function processBattles() {
  const at = {}, gone = new Set();
  for (const a of G.armies) if (a.at != null) (at[a.at] = at[a.at] || []).push(a);
  for (const p of G.provs) {
    const here = (at[p.id] || []).filter(a => !gone.has(a) && G.nations[a.owner].alive && a.at === p.id);
    let hostile = false;
    const nats = new Set(here.map(a => a.owner));
    if (p.garrison > 0.05) nats.add(p.owner);
    const list = [...nats];
    for (let i = 0; i < list.length && !hostile; i++) for (let j = i + 1; j < list.length; j++) if (atWar(list[i], list[j])) { hostile = true; break; }
    p.battle = hostile;
    // a siege (which stops training and building) needs enemy troops or aircraft; ships and missiles only raid
    p.siege = hostile && here.some(a => atWar(a.owner, p.owner) && domOf(a) === 'land');
    if (hostile) {
      const forces = forcesIn(p.id, false, here);
      const gf = forces.find(f => f.gar);
      let gu = null;
      if (gf) { gu = garU(p.garrison); gf.u = gu; }
      const before = new Map(forces.filter(f => f.ref && !f.gar).map(f => [f.ref, unitCount(f.u)]));
      const garBefore = p.garrison;
      intercept(forces);
      const salvo = forces.filter(f => f.ref && f.ref.strike).map(f => [f, f.u.msl || 0]);
      roundForces(forces, 1, true);
      if (gu) p.garrison = gu.inf;
      // missiles are spent on impact, and may wreck a level of the defences
      for (const [f, m] of salvo) {
        if (atWar(f.nat, p.owner)) for (let i = 0; i < Math.round(m); i++) {
          const hit = ['fort', 'bunk', 'aa'].filter(k => p.b[k] > 0);
          if (hit.length && Math.random() < 0.4) p.b[hit[Math.floor(Math.random() * hit.length)]]--;
        }
        G.stats.msl = (G.stats.msl || 0) + m;
        f.u.msl = 0;
      }
      for (const f of forces) {
        const lost = f.gar ? garBefore - p.garrison : (before.get(f.ref) || 0) - unitCount(f.u);
        if (f.ref && !f.gar) {
          if (lost > 0) G.nations[f.nat].lost = (G.nations[f.nat].lost || 0) + lost;
          if (unitCount(f.u) < 0.4) gone.add(f.ref);
        }
        // the units a side loses count as kills for the sides fighting it
        if (lost > 0) {
          const foes = [...new Set(forces.filter(g => atWar(g.nat, f.nat)).map(g => g.nat))];
          for (const e of foes) G.nations[e].kills = (G.nations[e].kills || 0) + lost / foes.length;
        }
      }
      p.lastBattle = G.t;
    } else if (p.garrison < maxGar(p)) {
      const enemyPresent = here.some(a => atWar(a.owner, p.owner));
      if (!enemyPresent) p.garrison = Math.min(maxGar(p), p.garrison + 0.05 + 0.015 * p.b.fort + 0.02 * p.b.bunk + 0.02 * p.b.hosp);
    }
    // missiles that arrive with nothing left to hit are lost
    if (!hostile) for (const a of here) if (a.strike) gone.add(a);
    // occupation: only ground troops take a province, and any defending army or fleet stops it
    const present = here.filter(a => !gone.has(a) && domOf(a) !== 'msl');
    const ownerSide = present.some(a => a.owner === p.owner || allied(a.owner, p.owner));
    const occ = present.filter(a => atWar(a.owner, p.owner) && groundCount(a.u) >= 0.3);
    if (occ.length && !ownerSide && p.garrison < 0.3) {
      let best = occ[0];
      for (const a of occ) if (unitPow(a.u) > unitPow(best.u)) best = a;
      const by = best.owner;
      const ct = captureTime(p);
      if (p.cap && p.cap.by === by) p.cap.p += 1 / ct; else p.cap = { by, p: 1 / ct };
      if (p.cap.p >= 1) { if (gone.size) { G.armies = G.armies.filter(a => !gone.has(a)); gone.clear(); } capture(p, by); }
    } else if (p.cap) {
      p.cap.p -= 0.12;
      if (p.cap.p <= 0) p.cap = null;
    }
  }
  if (gone.size) G.armies = G.armies.filter(a => !gone.has(a));
}

function capture(p, by) {
  const old = p.owner, O = G.nations[old], B = G.nations[by];
  const wasCap = O.capital === p.id;
  p.owner = by; p.garrison = 0.5; p.cap = null;
  for (const k of BK) p.b[k] = Math.max(0, p.b[k] - 1);      // the fighting wrecks a level of everything
  p.unrest = p.orig === by ? 0.15 : 0.65; p.q = []; p.bq = []; p.battle = false; p.siege = false;
  // missiles stored here are destroyed on the ground
  G.armies = G.armies.filter(a => !(a.at === p.id && a.owner === old && domOf(a) === 'msl'));
  const d = PS[p.id];
  B.cash += 15 + d.pop * 3; B[d.res] += 15;
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
  p.unrest = 0.3; p.q = []; p.bq = [];
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
  return { dur: G.wars[k] !== undefined ? G.t - G.wars[k] : 0, a: ws.caps[a] || 0, b: ws.caps[b] || 0, last: ws.last || G.wars[k] || 0, by: ws.by };
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
  G.wstat[key(a, b)] = { caps: {}, last: G.t, by: a };
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
    // alliances are defensive: allies only follow an attack on a runaway power
    if (attackerAlly && !(D.share[target] > 0.27)) continue;
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
// share of the rivals' forces in each combat class (inf, veh, art, air, heli, ship, sub, msl)
function enemyComp(ids) {
  const ck = ids.join(',');
  if (opMemo && opMemo.has('ec' + ck)) return opMemo.get('ec' + ck);
  const c = {}; let tot = 0;
  for (const k in CM) c[k] = 0;
  for (const id of ids) for (const a of D.armiesBy[id]) for (const t of UT) { c[UNITS[t].cls] += a.u[t]; tot += a.u[t]; }
  for (const k in c) c[k] = tot ? c[k] / tot : 0;
  if (!tot) c.inf = 1;
  if (opMemo) opMemo.set('ec' + ck, c);
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
const airShare = ids => { const c = enemyComp(ids); return c.air + c.heli + 0.5 * c.msl; };
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
  // the land army's mix, adapted to what the enemy fields
  const want = { inf: 0.26, mech: 0.12, abn: 0.03, sf: 0.03, art: 0.12, arm: 0.2, flak: 0.05, heli: 0.06, ftr: 0.06, bmb: 0.04, pat: 0.01 };
  const rivals = wars.length ? wars : alive().filter(o => o.id !== nid && !allied(nid, o.id) && borders(nid, o.id)).map(o => o.id);
  const ec = enemyComp(rivals.length ? rivals : []);
  const shift = (from, to, v) => { const d = Math.min(v, want[from]); want[from] -= d; want[to] += d; };
  if (ec.veh > 0.33) { shift('inf', 'heli', 0.05); shift('arm', 'bmb', 0.03); shift('inf', 'art', 0.02); }
  if (ec.inf > 0.55) { shift('inf', 'arm', 0.08); shift('inf', 'mech', 0.04); shift('inf', 'art', 0.03); }
  if (ec.air + ec.heli > 0.15) { shift('arm', 'flak', 0.07); shift('bmb', 'ftr', 0.03); shift('heli', 'ftr', 0.03); shift('inf', 'flak', 0.02); }
  if (ec.sub > 0.02) shift('bmb', 'pat', 0.03);
  if (wars.length) {
    // dug-in enemies need guns: artillery and special forces ignore half of fort, bunker and anti-air bonuses
    let fz = 0, nf = 0;
    for (const e of wars) for (const pid of D.owned[e]) if (PS[pid].nbrs.some(q => G.provs[q].owner === nid)) { const q = G.provs[pid]; fz += q.b.fort + q.b.bunk; nf++; }
    if (nf && fz / nf >= 1.5) { shift('inf', 'art', 0.06); shift('arm', 'sf', 0.03); }
  }
  // fleets: worth having on a coast with rivals that sail or own ports; missiles once at war
  let coastal = 0;
  for (const pid of owned) if (PS[pid].coast) coastal++;
  const rivalCoast = rivals.some(r => D.owned[r].some(pid => PS[pid].coast));
  const navyWant = coastal && rivalCoast ? (wars.length ? 2 + 0.3 * coastal : 1 + 0.15 * coastal) : 0;
  const seaMix = { pb: 0.35, dd: 0.3, sub: 0.2, cru: 0.15 };
  if (ec.sub > 0.02) { seaMix.dd += 0.15; seaMix.pb -= 0.15; }
  const mslWant = wars.length ? 1 + owned.length / 10 : 0;
  const have = emptyU(); let landTot = 0, seaTot = 0, mslTot = 0;
  const count = (t, v) => { have[t] += v; const d = UNITS[t].dom; if (d === 'sea') seaTot += v; else if (d === 'msl') mslTot += v; else landTot += v; };
  for (const a of D.armiesBy[nid]) for (const t of UT) count(t, a.u[t]);
  for (const pid of owned) for (const it of G.provs[pid].q) count(it.type, 1);
  const reserve = wars.length ? P.reserve * 0.3 : P.reserve;
  // every other think, construction gets first call on the cash
  const buildFirst = (n.ai.cycle || 0) % 2 === 1;
  // and when its best project is not yet affordable, recruiting leaves the cash for it
  if (buildFirst) { const need = aiBuild(n, wars, reserve, ts); if (need) n.ai.save = { c: need, until: G.t + 15 }; else n.ai.save = null; }
  const sv = n.ai.save && n.ai.save.until > G.t ? n.ai.save.c : 0;
  const uReserve = reserve + (sv && !(wars.length && ts[n.capital] > 3) ? sv : 0);
  const armyCap = 10 + owned.length * 1.8 + Math.max(0, n.rate.cash) * 4;
  // where each unit type can be trained right now
  let siteMemo = {};
  const site = t => siteMemo[t] !== undefined ? siteMemo[t] : (siteMemo[t] = findSite(t));
  const findSite = t => {
    let bestP = -1, bestS = -1;
    for (const pid of owned) {
      const p = G.provs[pid];
      if (p.q.length >= 2 || p.cap || p.siege || !canTrain(p, t)) continue;
      let f = 0;
      if (t !== 'inf') for (const k of UNITS[t].fast) f = Math.max(f, p.b[k]);
      const s = ts[pid] + 0.5 * f + Math.random() * 0.4;
      if (s > bestS) { bestS = s; bestP = pid; }
    }
    return bestP;
  };
  // how far each unit type is below its target, on one scale: land by share of the army,
  // ships by share of the wanted fleet, missiles by how short the stock is
  const gap = t => {
    const d = UNITS[t].dom;
    if (d === 'sea') return navyWant > seaTot ? 0.6 * (seaMix[t] * navyWant - have[t]) / navyWant : -1;
    if (d === 'msl') return mslWant > mslTot ? 0.12 * (mslWant - mslTot) / mslWant : -1;
    return want[t] - have[t] / Math.max(1, landTot);
  };
  let made = 0;
  while (made < 3 && landTot + seaTot + mslTot < armyCap) {
    if (n.rate.net < 0.25 && landTot > 14 && !wars.length) break;
    const order = UT.map(t => [t, gap(t) + Math.random() * 0.01]).sort((a, b) => b[1] - a[1]);
    let pick = null, where = -1, saving = false;
    for (const [t, g] of order) {
      // save up cash for what the forces are short of instead of filling up on whatever is cheapest
      // (a missing material cannot be saved for, so then anything goes)
      if (saving && g < 0.02) break;
      if (g < -0.06 && t !== 'inf') continue;
      const c = unitCost(t);
      if (RES.some(k => k !== 'cash' && c[k] && n[k] < c[k])) continue;
      where = site(t);
      if (where < 0) continue;
      if (n.cash - c.cash < uReserve) { saving = true; continue; }
      pick = t; break;
    }
    if (!pick) break;
    cmdRecruit(nid, where, pick);       // recruit near the front
    count(pick, 1); made++; siteMemo = {};
  }
  if (!buildFirst && !aiBuild(n, wars, reserve, ts)) n.ai.save = null;
}
// pick the most useful construction projects for this nation
function aiBuild(n, wars, reserve, ts) {
  const nid = n.id, P = pers(n), owned = D.owned[nid];
  if (n.cash < reserve + 40 || Math.random() > 0.7) return 0;
  const busy = owned.reduce((s, pid) => s + (G.provs[pid].bq.length ? 1 : 0), 0);
  const slots = Math.min(4, 1 + Math.floor(owned.length / 8)) - busy;
  if (slots <= 0) return 0;
  const count = {};
  for (const k of BK) count[k] = 0;
  const levels = {};
  for (const k of BK) levels[k] = 0;
  const maxB = {};
  for (const k of BK) maxB[k] = 0;
  for (const pid of owned) for (const k of BK) { const l = G.provs[pid].b[k]; if (l > 0) count[k]++; levels[k] += l; maxB[k] = Math.max(maxB[k], l); }
  // how much of the rivals' strength flies
  const rivals = wars.length ? wars : alive().filter(o => o.id !== nid && !allied(nid, o.id) && borders(nid, o.id)).map(o => o.id);
  const airThreat = rivals.length ? airShare(rivals) : 0;
  const coastWar = rivals.some(r => D.owned[r].some(pid => PS[pid].coast));
  // how badly we need more of a resource: high when the stock is low
  const short = r => clamp(1.5 - n[r] / 400, 0.05, 1.5);
  const opts = [];
  for (const pid of owned) {
    const p = G.provs[pid], d = PS[pid], t = ts[pid] || 0;
    if (p.bq.length || p.cap || p.siege) continue;
    const add = (k, sc) => {
      if (sc <= 0 || p.b[k] >= maxLvl(k) || (BLD[k].coast && !d.coast)) return;
      const v = sc / (1 + p.b[k]) * (0.75 + Math.random() * 0.5);
      if (v >= 0.15) opts.push([v, pid, k]);          // not worth the cash otherwise
    };
    // production: enough army bases, spread along the front, and at least one air base
    if (count.army < 1 + owned.length / 7) add('army', 2 + 0.5 * t + d.pop * 0.2);
    else if (p.b.army) add('army', 0.3 * t);
    if (count.airb < 1 + owned.length / 12 && owned.length >= 3) add('airb', (count.airb ? 1.2 : 2.2) + d.pop * 0.2 - 0.3 * t);
    else if (p.b.airb) add('airb', wars.length ? 0.6 : 0.2);
    if (p.b.airb && maxB.airb < 2 && owned.length >= 6) add('airb', 3.2);      // one level-2 base for bombers
    // defence where it is needed; anti-air wherever rivals fly, and always some over the capital
    const capB = n.capital === pid ? 1.5 : 1, tc = Math.min(t, 5);
    add('fort', (wars.length ? 0.9 : 0.3) * tc * capB * P.caution);
    if (p.b.fort) add('bunk', (wars.length ? 0.7 : 0.2) * tc * capB * P.caution);
    add('aa', t * (0.1 + 4 * airThreat) * capB + (n.capital === pid && !p.b.aa ? 0.8 : 0));
    add('hosp', (wars.length ? 0.35 : 0.1) * t);
    // economy
    add('infra', P.econ * (d.cash + RES_RATE) * 1.4);
    add('recr', P.econ * (0.25 + d.pop * 0.12) * short('man'));
    add('arms', P.econ * 1.4 * short('comp') + (wars.length && !count.arms ? 0.8 : 0));
    add('naval', P.econ * d.cash * 0.5 + (coastWar && count.naval < 2 ? 1.4 : 0) + (coastWar && p.b.naval && maxB.naval < 3 ? 2.4 : 0));
    add('lab', (0.3 + 0.6 * P.econ) * (levels.lab < 1 + owned.length / 8 ? 1.4 : 0.2) * (1 + 0.1 * d.pop));
  }
  opts.sort((a, b) => b[0] - a[0]);
  let made = 0, need = 0, top = 0;
  const keep = wars.length ? 15 : 40;
  for (const [v, pid, k] of opts) {
    if (made >= slots) break;
    if (need && v < 0.6 * top) break;      // saving for something better: do not fritter the cash away
    const c = buildCost(k, G.provs[pid].b[k]);
    if (RES.some(r => r !== 'cash' && c[r] && n[r] - c[r] < keep)) continue;   // keep stock for units
    if (!top) top = v;
    if (n.cash - c.cash < reserve) { if (!made && !need) need = c.cash; continue; }
    if (cmdBuild(nid, pid, k).ok) made++;
  }
  return made ? 0 : need;       // cash the best project still needs
}

// pick the next research project: by temperament, what the wars need and what it can build
function aiResearch(n) {
  if (n.rs) return;
  const nid = n.id, P = pers(n), wars = enemiesOf(nid), owned = D.owned[nid];
  const rivals = wars.length ? wars : alive().filter(o => o.id !== nid && !allied(nid, o.id) && borders(nid, o.id)).map(o => o.id);
  const air = rivals.length ? airShare(rivals) : 0;
  const coast = owned.some(pid => PS[pid].coast && G.provs[pid].b.naval);
  const wt = { Ground: 0.6 + 0.6 * P.aggr, Air: 0.7 + 0.5 * P.aggr, Sea: coast ? 0.8 : 0.05, Missile: 0.6 + (wars.length ? 0.6 : 0), Economy: 0.5 + 0.8 * P.econ };
  let best = null, bs = 0;
  for (const k of TK) {
    if (!techOpen(n, k)) continue;
    const T = TECH[k];
    let sc = wt[T.br] / Math.pow(T.tier, 0.4);
    if (k === 'rad1') sc *= 1 + 3 * air;
    if (k === 'gm1' && wars.length) sc *= 1.5;
    if (k === 'log1' || k === 'ind1') sc *= 1.3;
    sc *= 0.7 + Math.random() * 0.6;
    if (sc > bs) { bs = sc; best = k; }
  }
  if (best) cmdResearch(nid, best);
}

// ---------------------------------------------------------------- AI : military
function mergeIdle(nid) {
  const groups = {};
  for (const a of G.armies) if (a.owner === nid && a.at != null && !a.mv && !a.route.length && !a.strike) { const k = a.n + domOf(a); (groups[k] = groups[k] || []).push(a); }
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

// defOnly: the caretaker that guards an absent player's nation (fight or fall back, cover threatened states, nothing else)
function aiMilitary(n, defOnly) {
  const nid = n.id, P = pers(n);
  const diffAggr = G.opts.diff === 'hard' ? 1.15 : G.opts.diff === 'easy' ? 0.8 : 1;
  const aggr = P.aggr * diffAggr;
  if (!defOnly) mergeIdle(nid);
  refresh();
  let stacks = G.armies.filter(a => a.owner === nid && available(a) && domOf(a) === 'land');
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
      if (p.owner !== nid && atWar(nid, p.owner) && groundCount(s.u) >= 0.3) used.add(s);
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
  if (defOnly) return;

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
            const merged = G.armies.find(a => a.owner === nid && a.at === best.R && !a.mv && domOf(a) === 'land');
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

// fleets: fight or fall back, sink enemy ships, shell enemy ports (which keeps their garrison down
// for the land attack), and gather in a home port in peacetime
function aiNavy(n, defOnly) {
  const nid = n.id, wars = enemiesOf(nid);
  const fleets = G.armies.filter(a => a.owner === nid && available(a) && domOf(a) === 'sea' && !(a.hold > G.t));
  if (!fleets.length) return;
  const mine = f => f.nat === nid || allied(f.nat, nid);
  for (const s of fleets) {
    const here = s.at, p = G.provs[here];
    if (p.battle) {
      const fs = forcesIn(here, true);
      for (let i = 0; i < 60; i++) roundForces(fs, 1, false);
      const ml = fs.filter(mine).reduce((x, f) => x + unitCount(f.u), 0), fl = fs.filter(f => atWar(f.nat, nid)).reduce((x, f) => x + unitCount(f.u), 0);
      if (ml < 0.5 && fl > 1) {
        const esc = SEA_NB[here].filter(q => canEnter(nid, q) && !hostileHere(nid, q)).sort((a, b) => (G.provs[b].owner === nid) - (G.provs[a].owner === nid))[0];
        if (esc !== undefined) { orderMove(s, esc); continue; }
      }
      s.hold = G.t + 6;
      continue;
    }
    // shelling a port whose garrison is gone: stay a while if our troops are coming
    if (p.owner !== nid && atWar(nid, p.owner) && G.t - s.since < 50 && PS[here].nbrs.some(q => (D.armyAt[q] || []).some(a => a.owner === nid))) continue;
    let best = -1, bs = 0;
    if (wars.length && !defOnly) {
      const dj = dijkstra(nid, here, armySpeed(s), undefined, 'sea');
      const focus = n.ai.focus && n.ai.focus.T;
      for (let pid = 0; pid < NP; pid++) {
        if (!PS[pid].coast || pid === here || !(dj.dist[pid] < 90)) continue;
        const o = G.provs[pid].owner;
        const fleet = (D.armyAt[pid] || []).filter(a => atWar(nid, a.owner) && domOf(a) === 'sea').reduce((x, a) => x + unitPow(a.u), 0);
        if (!atWar(nid, o) && !fleet) continue;
        let sc = fleet / 150 + (atWar(nid, o) ? 0.3 * provValue(pid, nid) : 0) + (pid === focus ? 4 : 0) - dj.dist[pid] * 0.03;
        if (PS[pid].nbrs.some(q => (D.armyAt[q] || []).some(a => a.owner === nid && domOf(a) === 'land'))) sc += 2;
        if (sc <= bs) continue;
        const pr = predictAttack(nid, s.u, pid);
        if (pr.win && pr.keep > 0.5) { bs = sc; best = pid; }
      }
    }
    // defend our own coast against raiding fleets
    if (best < 0) for (const pid of D.owned[nid]) {
      if (!PS[pid].coast || pid === here) continue;
      if (!(D.armyAt[pid] || []).some(a => atWar(nid, a.owner) && domOf(a) === 'sea')) continue;
      const pr = predictAttack(nid, s.u, pid);
      if (pr.win && pr.keep > 0.4) { best = pid; break; }
    }
    if (best >= 0) { orderMove(s, best); continue; }
    // otherwise gather in the home port: our best naval base, or the capital's coast
    if (p.owner === nid && p.b.naval) {
      let port = here, pv = -1;
      for (const pid of D.owned[nid]) { const q = G.provs[pid]; const v = q.b.naval * 2 + threatScore(nid, pid); if (PS[pid].coast && q.b.naval && v > pv) { pv = v; port = pid; } }
      if (port !== here && SEA_NB[here].length && Math.random() < 0.5) orderMove(s, port);
    } else if (p.owner !== nid) {
      const home = D.owned[nid].find(pid => G.provs[pid].b.naval) ;
      if (home !== undefined) orderMove(s, home);
    }
  }
}
// missiles: fire at the biggest enemy concentration, a dug-in province we are attacking, or a fleet
function aiMissiles(n) {
  const nid = n.id, wars = enemiesOf(nid);
  if (!wars.length) return;
  const sal = G.armies.filter(a => a.owner === nid && available(a) && domOf(a) === 'msl' && !a.strike);
  if (!sal.length) return;
  const focus = n.ai.focus && n.ai.focus.T;
  const cands = new Set();
  for (const e of wars) for (const pid of D.owned[e]) if (PS[pid].nbrs.some(q => G.provs[q].owner === nid || allied(G.provs[q].owner, nid)) || PS[pid].coast) cands.add(pid);
  for (const a of G.armies) if (a.at != null && atWar(nid, a.owner)) cands.add(a.at);
  for (const s of sal) {
    let best = -1, bs = 2.5 + 0.8 * s.u.msl;
    for (const pid of cands) {
      if (!inRange(s.at, pid, nid)) continue;
      const p = G.provs[pid];
      let sc = 0;
      for (const a of D.armyAt[pid] || []) if (atWar(nid, a.owner)) sc += unitPow(a.u) / 120;
      if (atWar(nid, p.owner)) {
        sc += p.garrison * 0.25 + (p.b.fort + p.b.bunk + p.b.aa) * 0.5;
        if (pid === focus) sc *= 2;
        if ((D.armyAt[pid] || []).some(a => a.owner === nid)) sc *= 1.5;
        if (isCapital(p)) sc += 1;
      }
      sc -= (p.b.aa + (D.armyAt[pid] || []).reduce((x, a) => x + a.u.flak + a.u.ftr, 0)) * 0.3;
      if (sc > bs) { bs = sc; best = pid; }
    }
    if (best >= 0) { orderMove(s, best); continue; }
    // nothing in range: move up to a city closer to the enemy
    let to = -1, dmin = Infinity;
    for (const pid of D.owned[nid]) {
      if (pid === s.at || !inRange(s.at, pid, nid) || G.provs[pid].battle) continue;
      let d = Infinity;
      for (const c of cands) d = Math.min(d, mslDist(pid, c));
      if (d < dmin - 30) { dmin = d; to = pid; }
    }
    let dnow = Infinity;
    for (const c of cands) dnow = Math.min(dnow, mslDist(s.at, c));
    if (to >= 0 && ![...cands].some(c => inRange(s.at, c, nid)) && dmin < dnow) orderMove(s, to);
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
    // no vultures: a nation already at war is left alone unless it is a runaway power
    // (opportunists may still join a one-front war if they are clearly stronger)
    const busy = enemiesOf(c.id).length;
    if (!hegemon && busy >= 2) continue;
    if (!hegemon && busy === 1 && n.pers !== 'opportunist') continue;
    let need = 1.25 / aggr;
    need *= clamp(1 - (G.t - n.ai.lastWar - 180) / 2400, 0.78, 1);     // restlessness after long peace
    if (hegemon) need *= 0.75;
    if (hasTreaty(nid, c.id, 'nap') || hasTreaty(nid, c.id, 'trade')) need *= 1.35;
    if (busy === 1 && !hegemon) need *= 1.3;
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
  // allies join our wars: when we were attacked, or against a runaway power
  for (const e of enemiesOf(nid)) for (const x of alliesOf(nid)) {
    if (warStat(nid, e).by === nid && !(D.share[e] > 0.27)) continue;
    if (enemiesOf(e).length >= 3) continue;
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
// Runs an absent player's nation: keeps recruiting and building defences, defends, and takes peace
// when the war is going badly. Accepts offered trade and non-aggression pacts. Never declares war, attacks,
// or signs anything else (alliances, passage, tribute, joining wars).
function caretaker(n) {
  if (!n.alive) return;
  aiEconomy(n);
  aiMilitary(n, true);
  aiNavy(n, true);
  for (const pr of G.proposals.slice()) {
    if (pr.to !== n.id) continue;
    if (pr.kind === 'ceasefire' && (shouldSeekPeace(n.id, pr.from) || evalProposal('ceasefire', n.id, pr.from).ok)) answerProposal(pr.id, true);
    else if (pr.kind === 'trade' || pr.kind === 'nap') answerProposal(pr.id, true);     // harmless goodwill
  }
}
function aiThink(n) {
  if (!n.alive) return;
  opMemo = new Map();
  aiEconomy(n);
  aiMilitary(n);
  aiNavy(n);
  aiMissiles(n);
  aiResearch(n);
  aiMarket(n);
  n.ai.cycle = (n.ai.cycle || 0) + 1;
  opMemo = null;
  if (n.ai.cycle % 4 === 0) { aiDiplomacy(n); aiWar(n); }
}

// ---------------------------------------------------------------- player commands
function cmdRecruit(nat, pid, type) {
  const n = G.nations[nat], p = G.provs[pid];
  if (p.owner !== nat) return { ok: false, msg: 'Not your province' };
  if (p.cap || p.siege) return { ok: false, msg: 'Province is under siege' };
  if (!canTrain(p, type)) return { ok: false, msg: needText(p, type) };
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
  if (p.cap) return { ok: false, msg: 'Province is under occupation' };
  if (p.bq.length >= 3) return { ok: false, msg: 'Construction queue is full' };
  const lvl = plannedLvl(p, kind);
  if (lvl >= maxLvl(kind)) return { ok: false, msg: 'Already at maximum level' };
  const c = buildCost(kind, lvl);
  if (!canPay(n, c)) return { ok: false, msg: 'Not enough resources' };
  pay(n, c);
  const tm = buildTime(kind, lvl, nat);
  p.bq.push({ k: kind, left: tm, total: tm, c });
  return { ok: true, msg: `${B.n} level ${lvl + 1} under construction` };
}
// cancel the last queued project (or the current one when nothing else is queued), half refunded
function cmdCancelBuild(nat, pid) {
  const n = G.nations[nat], p = G.provs[pid];
  if (p.owner !== nat || !p.bq.length) return { ok: false, msg: 'Nothing under construction' };
  const it = p.bq.pop(), c = it.c || {};
  for (const k in c) n[k] += c[k] / 2;
  return { ok: true, msg: `${BLD[it.k].n} cancelled, half refunded` };
}
function cmdMove(aid, dest, node) {
  const a = G.armies.find(x => x.id === aid);
  if (!a) return { ok: false, msg: 'Army not found' };
  return orderMove(a, dest, node);
}
function cmdStop(aid) {
  const a = G.armies.find(x => x.id === aid);
  if (a) { a.route = []; a.held = null; }
}
function cmdSplit(aid, mode) {
  const a = G.armies.find(x => x.id === aid);
  if (!a || a.at == null || a.mv) return { ok: false, msg: 'Army must be stationary' };
  const b = emptyU();
  if (mode === 'half') { for (const t of UT) { b[t] = a.u[t] / 2; a.u[t] -= b[t]; } }
  else if (mode === 'quarter') { for (const t of UT) { b[t] = a.u[t] / 4; a.u[t] -= b[t]; } }
  else if (UT.includes(mode)) { b[mode] = a.u[mode]; a.u[mode] = 0; }
  if (unitCount(b) < 0.5 || unitCount(a.u) < 0.5) { for (const t of UT) a.u[t] += b[t]; return { ok: false, msg: 'Too small to split' }; }
  const n = newArmy(a.owner, a.at); n.u = b; n.n = a.n;
  return { ok: true, msg: 'Army split', id: n.id };
}
function cmdMerge(nat, pid, dom, node) {
  let list = G.armies.filter(a => a.owner === nat && a.at === pid && !a.mv && !a.strike);
  if (node != null) list = list.filter(a => a.n === node);
  // armies, fleets and missiles do not mix: merge the kind asked for, or the most common one here
  if (!dom) { const c = {}; for (const a of list) c[domOf(a)] = (c[domOf(a)] || 0) + 1; dom = Object.keys(c).sort((x, y) => c[y] - c[x])[0]; }
  list = list.filter(a => domOf(a) === dom);
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
  resumeMarches();
  unrestTick();
  mktTick();
  missionTick();
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
    if (n.player && !G.opts.autoplay) {
      if (G.caretaker && G.t >= n.ai.next) { caretaker(n); n.ai.next = G.t + 2.2 + rnd(0, 1.2); }
      continue;
    }
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
  researchTick(dt);
  moveTick(dt);
  G.acc1 += dt;
  while (G.acc1 >= 1) { G.acc1 -= 1; secondTick(); }
}

// ---------------------------------------------------------------- setup / save
const SAVE_V = 5;
// the main province of a state: the one with the most people
const mainOf = st => byState[st].reduce((a, b) => (PS[b].pop > PS[a].pop ? b : a));
const startStock = f => ({ cash: 400 * f, man: 60 * f, sup: 90 * f, comp: 90 * f, fuel: 70 * f, elec: 40 * f, rare: 40 * f, rp: 30 * f, tech: {}, rs: null });
function newGame(opts) {
  // pace: game seconds per real second at 1x speed (UI only); away: the world keeps running while the tab is closed
  opts = Object.assign({ player: 0, diff: 'normal', pace: 1, away: false }, opts || {});
  G = { v: SAVE_V, t: 0, acc1: 0, opts, nations: [], provs: [], armies: [], nextArmy: 1, wars: {}, treaties: [], nextTid: 1,
        memory: [], proposals: [], nextProp: 1, log: [], seq: 0, flags: {}, grace: 240, wstat: {}, stats: {}, mkt: newMkt(),
        missions: { list: [], next: 1, done: 0, wait: 20 } };
  NATIONS.forEach((def, i) => G.nations.push(Object.assign({
    id: i, name: def.name, short: def.short, color: def.color, pers: def.pers, player: i === opts.player, alive: true,
    capital: mainOf(def.cap), infamy: 0, rate: zeroRate(),
    ai: { next: rnd(0.5, 4), focus: null, tprop: {}, lastWar: 0 }, orig: i,
  }, startStock(1))));
  MAPD.provinces.forEach((p, i) => G.provs.push({ id: i, owner: -1, orig: -1, garrison: 0, b: emptyB(), bq: [], unrest: 0, cap: null, q: [], battle: false }));
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
      if (pid === n.capital) { a.u.inf += 4; a.u.arm += 2; a.u.art += 2; a.u.ftr += 1; }
    }
    // a coastal capital starts with a small flotilla
    if (PS[n.capital].coast) { const f = newArmy(n.id, n.capital); f.u.pb = 2; }
  }
  refresh(); computeRates();
  log('The map is drawn. Borders are quiet, for now.', 'info', {});
  return G;
}
function serialize() { return JSON.stringify(G); }
function load(str) {
  const g = JSON.parse(str);
  if (!saveOk(g)) throw new Error('This save is from an older version of the map');
  G = g;
  for (const a of G.armies) if (a.since === undefined) a.since = a.mv ? null : G.t;
  if (!G.opts.pace) G.opts.pace = 1;
  if (!G.stats) G.stats = {};
  if (!G.mkt) G.mkt = newMkt();
  if (!G.missions) G.missions = { list: [], next: 1, done: 0, wait: 0 };
  for (const n of G.nations) { if (!n.tech) n.tech = {}; if (n.rs === undefined) n.rs = null; calcMods(n); }
  refresh(); computeRates(); return G;
}
const saveOk = o => !!o && o.v === SAVE_V && !!o.provs && o.provs.length === NP;
// run the world forward by `secs` of game time (offline progress, tests)
function advance(secs) {
  let left = secs;
  while (left > 1e-9) { const d = Math.min(0.25, left); step(d); left -= d; }
}

return {
  MULT, CM, TW, K_DMG,
  TECH, TK, BRANCHES, techCost, pourRate, techOpen, cmdResearch, cmdCancelResearch, modsOf, mslRange, hasTech,
  UT, UNITS, CATS, PERS, MSL_RANGE, domOf, needText, missileOk, isAirT, inRange, NATIONS, PS, MAXLVL: MAX_LVL, CAPTURE_T, RES, RESN, BLD, BK, byState, captureTime, entrench, plannedLvl, maxLvl, advance,
  get G() { return G; }, get D() { return D; },
  newGame, step, serialize, load, saveOk, refresh, computeRates,
  atWar, allied, hasTreaty, hasAccess, truceLeft, opinion, canEnter, borders,
  unitPow, unitCount, armySpeed, routeTime, findRoute, nodeRoute, nearestNode, nodeIn, NODES, NODE_P, NODES_OF, ROADS: MAPD.roads, predictAttack, defBonus, maxGar,
  buildCost, buildTime, unitCost, canPay, provRates, canTrain, trainTime,
  mInfo, rewardText, cmdSkipMission, MKT_RES, MKT_BASE, AUTO_STEPS, mktPrice, mktQuote, mktFee, cmdTrade, cmdAutoSell,
  cmdRecruit, cmdBuild, cmdCancelBuild, cmdMove, cmdStop, cmdSplit, cmdMerge, cmdDisband,
  diplo, answerProposal, caretaker, evalProposal, warStat, enemiesOf, alliesOf, pers,
};
})();
