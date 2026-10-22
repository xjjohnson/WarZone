// jsdom smoke test: boot the page, start a game, click through every panel, run game time, look for exceptions.
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync(__dirname + '/frontline-usa.html', 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail && e.detail.stack || e.message)));
vc.on('error', e => errors.push('console.error: ' + e));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://example.test/', resources: undefined,
  beforeParse(w) {
    w.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() { setTimeout(() => this.cb(), 5); } };
    w.Element.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 400, height: 330, right: 400, bottom: 330 }; };
    w.Element.prototype.setPointerCapture = function () {};
    w.addEventListener('error', e => errors.push('window error: ' + e.message + ' @' + e.lineno));
  } });
const w = dom.window, d = w.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const click = sel => { const el = d.querySelector(sel); if (!el) throw new Error('missing ' + sel); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); };
(async () => {
  await sleep(200);
  console.log('modal visible:', !d.getElementById('modal').hidden, 'cards:', d.querySelectorAll('.nc').length);
  click('[data-act="pick"][data-v="2"]');
  await sleep(100);
  const { S, UI } = w.__flusa;
  console.log('started', UI.started, 'player', S.G.opts.player, 'panel:', d.querySelector('#sheet h3') && d.querySelector('#sheet h3').textContent);
  console.log('res:', d.getElementById('res').textContent.replace(/\s+/g, ' '));
  // recruit
  click('[data-act="recruit"][data-t="inf"]'); click('[data-act="recruit"][data-t="arm"]'); click('[data-act="build"][data-k="fort"]');
  await sleep(350);
  console.log('construction:', JSON.stringify(S.G.provs[UI.selP].bq), 'queue:', S.G.provs[UI.selP].q.map(q => q.type).join(','));
  click('[data-act="cancelbuild"]'); await sleep(350); click('[data-act="build"][data-k="army"]'); await sleep(50);
  // a patrol boat if the capital is a port, and the recruit list grouped by category
  if (d.querySelector('[data-act="recruit"][data-t="pb"]')) { click('[data-act="recruit"][data-t="pb"]'); await sleep(50); }
  console.log('categories:', [...d.querySelectorAll('#sheet .cat')].map(e => e.textContent).join(','), 'queue now:', S.G.provs[UI.selP].q.map(q => q.type).join(','));
  // tabs
  for (const t of ['forces', 'dip', 'tech', 'intel', 'map']) { click(`[data-act="tab"][data-v="${t}"]`); await sleep(350); console.log('tab', t, 'len', d.getElementById('sheet').innerHTML.length); }
  // research: start a project from the Tech tab, then cancel and restart it
  click('[data-act="tab"][data-v="tech"]'); await sleep(350);
  click('[data-act="research"][data-k="ind1"]'); await sleep(350);
  console.log('researching:', S.G.nations[2].rs && S.G.nations[2].rs.k, 'cards:', d.querySelectorAll('#sheet .btn.tech').length);
  // select own army, then a neighbour
  const mine = S.G.armies.find(a => a.owner === 2 && a.at != null && S.PS[a.at].nbrs.some(q => S.G.provs[q].owner !== 2));
  click(`[data-act="tab"][data-v="forces"]`); await sleep(350);
  click(`[data-act="selarmy"][data-a="${mine.id}"]`); await sleep(350);
  console.log('army card:', d.querySelector('#sheet h3').textContent);
  const nb = S.PS[mine.at].nbrs.find(q => S.G.provs[q].owner !== 2);
  UI.selP = nb; await sleep(350);
  console.log('target note:', d.getElementById('sheet').textContent.replace(/\s+/g, ' ').slice(0, 260));
  // diplomacy: open a neighbour nation, try treaties
  click('[data-act="tab"][data-v="dip"]'); await sleep(350);
  const nOwner = S.G.provs[nb].owner;
  click(`[data-act="dipopen"][data-n="${nOwner}"]`); await sleep(350);
  for (const v of ['trade', 'nap', 'access', 'alliance', 'gift']) { const b = d.querySelector(`[data-act="dip"][data-v="${v}"]`); if (b) { b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await sleep(300); console.log(v, '->', (d.querySelector('.msg') || {}).textContent); } }
  // run game time at speed: 6 game minutes
  for (let i = 0; i < 6 * 60 * 4; i++) { S.step(0.25); if (i % 120 === 0) await sleep(30); }
  await sleep(500);
  console.log('after sim: clock', d.getElementById('clock').textContent, 'badges', d.querySelectorAll('.bdg').length, 'armies', S.G.armies.length, 'toasts', d.querySelectorAll('.toast').length);
  for (const t of ['forces', 'dip', 'tech', 'intel', 'map']) { click(`[data-act="tab"][data-v="${t}"]`); await sleep(350); }
  // declare war flow + proposal handling
  click('[data-act="tab"][data-v="dip"]'); await sleep(350);
  const foe = S.G.nations.find(n => n.alive && n.id !== 2 && n.id !== nOwner && !S.atWar(2, n.id) && !S.allied(2, n.id));
  if (foe) {
    click(`[data-act="dipopen"][data-n="${foe.id}"]`); await sleep(350);
    if (!d.querySelector('[data-act="arm"]')) console.log('NO ARM BUTTON; foe', foe.id, foe.short, 'open', UI.dipOpen, 'text:', d.getElementById('sheet').textContent.replace(/\s+/g, ' ').slice(0, 400));
    click('[data-act="arm"]'); await sleep(350);
    click('[data-act="war"]'); await sleep(350);
    console.log('war declared:', S.atWar(2, foe.id));
  }
  // missiles: build a salvo at the capital and check the strike card
  const g = S.G, cap = g.nations[2].capital, wars = Object.keys(g.wars).map(k => k.split('-').map(Number)).filter(p => p.includes(2)).map(p => p[0] === 2 ? p[1] : p[0]);
  g.provs[cap].b.arms = 1; g.nations[2].tech.gm1 = 1; Object.assign(g.nations[2], { cash: 2000, comp: 500, fuel: 500, elec: 500, rare: 500 });
  console.log('missile recruit:', S.cmdRecruit(2, cap, 'msl').msg);
  for (let i = 0; i < 25 * 4; i++) S.step(0.25);
  const sal = g.armies.find(a => a.owner === 2 && S.domOf(a) === 'msl');
  if (sal && sal.at != null) {
    const tgt = S.PS.map(p => p.id).find(pid => wars.includes(g.provs[pid].owner) && S.missileOk(sal, pid).ok);
    click(`[data-act="tab"][data-v="forces"]`); await sleep(350);
    click(`[data-act="selarmy"][data-a="${sal.id}"]`); await sleep(350);
    if (tgt !== undefined) { UI.selP = tgt; await sleep(350); }
    console.log('missile card:', d.getElementById('sheet').textContent.replace(/\s+/g, ' ').slice(0, 200));
    if (tgt !== undefined) { console.log('launch:', S.cmdMove(sal.id, tgt).msg); for (let i = 0; i < 20 * 4; i++) S.step(0.25); console.log('salvo left:', g.armies.includes(sal), 'missiles hit', Math.round(g.stats.msl || 0)); }
  } else console.log('no salvo (capital may have fallen)');
  for (let i = 0; i < 3 * 60 * 4; i++) S.step(0.25);
  await sleep(500);
  console.log('proposals', S.G.proposals.length, 'log', S.G.log.length);
  // an idle player can be overrun by now: dismiss the Fallen or Dominance modal
  const dismiss = d.querySelector('#modal:not([hidden]) [data-act="watch"], #modal:not([hidden]) [data-act="keep"]');
  if (dismiss) { console.log('dismissing modal:', dismiss.dataset.act); dismiss.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await sleep(100); }
  click('[data-act="tab"][data-v="intel"]'); await sleep(350); click('[data-act="save"]');
  console.log('player tech:', Object.keys(S.G.nations[2].tech).join(',') || 'none', 'rs', JSON.stringify(S.G.nations[2].rs));
  console.log('saved bytes', (w.localStorage.getItem('frontline_usa_save_v1') || '').length);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); console.log(errors.join('\n')); process.exit(1); });
