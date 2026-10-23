const fs = require('fs');
const dir = __dirname;
// The GitHub repo whose releases the game checks for updates (must be public).
const UPDATE_REPO = process.env.UPDATE_REPO || 'xjjohnson/WarZone';

// version, date and release notes come from the top entry of CHANGELOG.md
function readChangelog() {
  const md = fs.readFileSync(dir + '/CHANGELOG.md', 'utf8');
  const m = md.match(/^## (\d+)\.(\d+)\.(\d+)\s*\(([\d-]+)\)\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  if (!m) throw new Error('CHANGELOG.md needs a top entry like "## 1.2.0 (2026-11-01)"');
  const [maj, min, pat] = [+m[1], +m[2], +m[3]];
  if (min > 99 || pat > 99) throw new Error('minor and patch versions must stay below 100');
  const notes = m[5].split('\n').filter(l => /^\s*[-*] /.test(l)).map(l => l.replace(/^\s*[-*] /, '').trim());
  return { version: `${maj}.${min}.${pat}`, code: maj * 10000 + min * 100 + pat, date: m[4], notes };
}
const info = Object.assign(readChangelog(), { repo: UPDATE_REPO });

let t = fs.readFileSync(dir + '/template.html', 'utf8');
const map = fs.readFileSync(dir + '/mapdata.json', 'utf8');
const sim = fs.readFileSync(dir + '/sim.js', 'utf8');
const ui = fs.readFileSync(dir + '/ui.js', 'utf8');
t = t.replace('/*BUILD*/', () => 'const BUILD = ' + JSON.stringify(info) + ';')
  .replace('/*MAPDATA*/', () => 'const MAP = ' + map + ';').replace('/*SIM*/', () => sim).replace('/*UI*/', () => ui);
fs.writeFileSync(dir + '/frontline-usa.html', t);
// frontline-usa.html is the Claude artifact source (the artifact adds the document skeleton);
// dist/index.html is a complete page for GitHub Pages and the Android app
const page = '<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">\n' + t;
fs.mkdirSync(dir + '/dist', { recursive: true });
fs.writeFileSync(dir + '/dist/index.html', page);
fs.writeFileSync(dir + '/dist/version.json', JSON.stringify(info, null, 2) + '\n');
console.log('built v' + info.version, (t.length / 1024).toFixed(0) + ' KB');
