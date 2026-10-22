# WarZone (Frontline USA)

Single-player real-time strategy game on a map of the United States, inspired by Supremacy: World War 3. Original names and art.

- AI nations that recruit, fight, defend, ally and negotiate
- Diplomacy: ceasefires, non-aggression, access, trade, alliances, gifts, tribute, calls to arms
- No pay-to-win, no forced ending (endless late game)

## Play
Open `dist/index.html` in a browser (mobile friendly, autosaves to localStorage).

## Develop
- `sim.js` game simulation + AI, `ui.js` interface, `template.html` markup/CSS, `mapdata.json` map
- `npm install && node make.js` rebuilds `frontline-usa.html` (copy to `dist/index.html`)
- `node buildmap.mjs` regenerates the map from us-atlas
- `node test.js 20 normal` headless AI-vs-AI run
