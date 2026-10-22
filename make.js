const fs = require('fs');
const dir = __dirname;
let t = fs.readFileSync(dir + '/template.html', 'utf8');
const map = fs.readFileSync(dir + '/mapdata.json', 'utf8');
const sim = fs.readFileSync(dir + '/sim.js', 'utf8');
const ui = fs.readFileSync(dir + '/ui.js', 'utf8');
t = t.replace('/*MAPDATA*/', () => 'const MAP = ' + map + ';').replace('/*SIM*/', () => sim).replace('/*UI*/', () => ui);
fs.writeFileSync(dir + '/frontline-usa.html', t);
console.log('built', (t.length / 1024).toFixed(0) + ' KB');
