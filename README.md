# WarZone (Frontline USA)

Single-player real-time strategy game on a map of the United States, inspired by Supremacy: World War 3. Original names and art.

- AI nations that recruit, fight, defend, ally and negotiate
- Diplomacy: ceasefires, non-aggression, access, trade, alliances, gifts, tribute, calls to arms
- No pay-to-win, no forced ending (endless late game)

## Play
- Android: install the APK from the [latest release](https://github.com/xjjohnson/WarZone/releases/latest). The game checks for new versions itself (Intel tab, Updates) and downloads them; your saved game carries over.
- Browser: the GitHub Pages site of this repo, or open `dist/index.html` (mobile friendly, autosaves to localStorage).

## Releasing an update
Add an entry at the top of `CHANGELOG.md` with a higher version number and merge to `main`. The `Build and release` workflow builds the game and the APK, publishes the release and updates the web version.

## Develop
- `sim.js` game simulation + AI, `ui.js` interface, `template.html` markup/CSS, `mapdata.json` map
- `node make.js` rebuilds `frontline-usa.html` and `dist/` (the version comes from `CHANGELOG.md`)
- `app/` is the Android app (Capacitor); CI builds the APK
- `node buildmap.mjs` regenerates the map from us-atlas
- `node test.js 20 normal` headless AI-vs-AI run
