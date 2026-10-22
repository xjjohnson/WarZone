// Headless smoke test: all 10 nations AI-controlled, run N game-minutes.
const fs = require('fs'), vm = require('vm');
const MAP = JSON.parse(fs.readFileSync(__dirname + '/mapdata.json', 'utf8'));
const code = fs.readFileSync(__dirname + '/sim.js', 'utf8');
const ctx = { MAP, console, Math, JSON, Object, Array, Set, Map };
vm.createContext(ctx);
vm.runInContext(code + '\n;this.SIM = SIM;', ctx);
const SIM = ctx.SIM;

const minutes = +process.argv[2] || 20;
const diff = process.argv[3] || 'normal';
SIM.newGame({ player: -1, diff });
const G = () => SIM.G;
let lastLogSeq = 0;
const counts = { war: 0, peace: 0, treaty: 0, capture: 0, elim: 0, revolt: 0, proposal: 0 };
const t0 = Date.now();
for (let s = 0; s < minutes * 60 * 4; s++) {
  SIM.step(0.25);
  if (s % 240 === 239) {
    const g = G(), D = SIM.D;
    const row = g.nations.filter(n => n.alive).map(n => `${n.short.slice(0, 4)}:${D.owned[n.id].length}p/${Math.round(D.power[n.id] / 100)}`).join(' ');
    const wars = Object.keys(g.wars).map(k => k.split('-').map(i => g.nations[i].short.slice(0, 3)).join('v')).join(',');
    console.log(`t=${String(Math.round(g.t / 60)).padStart(2)}m  ${row}  | wars: ${wars || '-'} | treaties: ${g.treaties.length} armies: ${g.armies.length}`);
  }
}
for (const e of G().log) counts[e.kind] = (counts[e.kind] || 0) + 1;
console.log('events', JSON.stringify(counts), 'ms', Date.now() - t0);
const tail = G().log.filter(e => ['war', 'capture', 'peace', 'treaty', 'elim', 'revolt'].includes(e.kind)).slice(-25);
tail.forEach(e => console.log(Math.round(e.t) + 's', e.kind, e.txt));
// sanity checks
const g = G();
for (const a of g.armies) {
  if (!g.nations[a.owner].alive) throw new Error('army of dead nation');
  for (const t of SIM.UT) if (!(a.u[t] >= 0)) throw new Error('bad units ' + JSON.stringify(a));
  if (a.at == null && !a.mv) throw new Error('army lost');
}
const mix = {};
for (const a of g.armies) for (const t of SIM.UT) mix[t] = (mix[t] || 0) + a.u[t];
console.log('units', SIM.UT.map(t => t + ':' + Math.round(mix[t] || 0)).join(' '), '| missiles hit', Math.round(g.stats.msl || 0));
const bl = {};
for (const p of g.provs) for (const k of SIM.BK) bl[k] = (bl[k] || 0) + p.b[k];
const mx = {}; for (const p of g.provs) for (const k of ['airb','naval','arms']) mx[k] = Math.max(mx[k] || 0, p.b[k]);
console.log('top levels', JSON.stringify(mx));
console.log('buildings', SIM.BK.map(k => k + ':' + bl[k]).join(' '));
for (const a of g.armies) {
  const dom = SIM.domOf(a);
  if (dom === 'sea' && a.at != null && !SIM.PS[a.at].coast) throw new Error('ship on land ' + JSON.stringify(a));
  if (dom !== 'land' && SIM.UT.some(t => a.u[t] > 0.02 && SIM.UNITS[t].dom !== dom)) throw new Error('mixed army ' + JSON.stringify(a));
}
console.log('OK');
