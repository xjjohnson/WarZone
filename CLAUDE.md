# WarZone / Frontline USA — project guide for Claude Code

## What this is
A single-player, real-time strategy game for the browser (mobile-first), set on a map of the United States. It is inspired by Supremacy: World War 3, but everything (names, art, nations) is original. Do not copy assets, branding or names from that game. The long-term plan is to wrap it as a phone app later.

The owner (Justin) asked for these changes relative to the original game:
1. No forced ending. Players can keep playing the late game ("ride the late game and continue").
2. No pay-to-win and no monetization of any kind.
3. Computer nations must actually do things (the original's AI is "useless"), because this is single-player.
4. More diplomacy between nations.
5. Keep the combat feel, which he likes.
6. Browser first, US map only for now (world map is a possible later step).

## Repo layout
- `sim.js`: the whole simulation, economy, combat, diplomacy and AI. Defines `const SIM = (function(){...})()` and expects a global `MAP`.
- `ui.js`: the interface, one IIFE (SVG map, pan/zoom, panels, modals, save/load, frame loop).
- `template.html`: CSS and markup with placeholders `/*MAPDATA*/ /*SIM*/ /*UI*/`.
- `mapdata.json`: generated map: `{w,h,provinces[{id,st,name,cx,cy,px,py,area,pw,coast,d,nbrs}],borders[{a,b,d}],stateLines,coast,sea[[a,b,dist]],states[{st,name,x,y}]}`. 217 city provinces, 542 borders. `cx,cy` is the anchor for badges and routes, `px,py` the city dot, `pw` the province's share of its state's population.
- `buildmap.mjs`: regenerates `mapdata.json` from us-atlas `counties-albers-10m` (975x610 Albers USA) and city data from `all-the-cities` (GeoNames). Each state is split into a few provinces named after their main city: seed cities are picked by population and spacing, and counties join the nearest seed through county adjacency, so provinces stay contiguous. `RENAME`, `SKIP`, `NOT_COASTAL` and `K_OVERRIDE` hold hand fixes. Sea lanes: Anchorage-Seattle and Honolulu-Los Angeles (330), plus short lanes that connect islands inside a state.
- `make.js`: assembles everything into one self-contained `frontline-usa.html` (about 207 KB). Copy that to `dist/index.html`, which is the playable file.
- `test.js`: headless all-AI run: `node test.js <minutes> <easy|normal|hard>`.
- `smoke.js`: jsdom UI smoke test (needs `npm install`, and reads the built `frontline-usa.html`, so run `node make.js` first).

Workflow: edit `sim.js` / `ui.js` / `template.html`, run `node make.js`, copy `frontline-usa.html` to `dist/index.html`, commit.

## Hard constraints
- Output must stay a single self-contained HTML file with no external libraries and no network calls. The only external resource allowed is Google Fonts (Big Shoulders Display, Barlow Semi Condensed, IBM Plex Mono), and every font needs a fallback stack. The game is published as a Claude artifact whose CSP blocks everything else.
- Vanilla JS, inline SVG map. Layout must work at 400px wide with no horizontal page scroll. Touch is the primary input.
- Light and dark themes via CSS tokens on `:root` (dark via `prefers-color-scheme` and `[data-theme]`). Keep the `claude:viewport-fit-sides` meta and side gutters.
- No monetization, ads or pay-to-win mechanics, ever.
- Saves go to `localStorage` key `frontline_usa_save_v1`, always inside try/catch. The save carries `G.v` (`SAVE_V`, now 2); `SIM.saveOk` rejects saves from the old 51-state map.

## Game design
**Nations.** 10 fictional regional nations covering all 51 provinces: Pacific Republic, Mountain Pact, Southwest Compact, Heartland Union, Lakes League, Delta Pact, Seaboard Commonwealth, Appalachian Federation, Atlantic Dominion, New England Concord. Each has a personality (warmonger, opportunist, turtle, diplomat, builder), a capital and a colour. Conquered provinces can revolt back to the original owner or become a "Free State" nation.

**Provinces.** Each state is split into city provinces (`PS[pid].st` is the state). The old per-state numbers in `STATE` (population, terrain, resource list) are shared out by `pw`. Nations still own whole states at the start; the capital is the biggest province of the capital state (`mainOf`).

**Economy.** Seven resources (`RES`): cash, manpower, supplies, components, fuel, electronics, rare materials, plus research points (`n.rp`). Every province makes cash and manpower from population, some supplies, and one primary resource (`PS.res`, from the state's resource list). Capitals make a trickle of everything. Units cost cash upkeep. Costs are objects keyed by resource (`canPay`, `pay`). Stocks of non-cash resources tend to pile up; the market (to-do #7) is meant to turn surplus into cash.

**City buildings.** `BLD` in `sim.js`, stored per province in `p.b[kind]` (levels 0-3), one construction at a time in `p.bq` (paused under siege). Army base (needed for artillery and armor), air base (needed for air), naval base (coastal only, port cash), recruiting office, arms industry, hospital (less damage for the owner's troops), bunkers (`fort`: defence and garrison), research lab, infrastructure. Level n costs and takes n times the base. Capture drops every building one level. AI: `aiBuild` scores projects (production first, defence by threat, economy by shortage) and keeps 40 of each resource for units.

**Units.** Infantry (`inf`), artillery (`art`), armor (`arm`), air (`air`), with a damage multiplier matrix and target weights.

**Combat.** Multi-sided `roundForces`, `K_DMG` 0.16. The defender gets a terrain plus fort bonus; artillery halves the defence bonus. A province is captured after `CAPTURE_T = 14` seconds of unopposed occupation. Garrisons regenerate. Capture gives loot. Armies move by Dijkstra pathing (`canEnter`: own land, access/alliance, or at war). `enforceBorders` ejects armies from land they no longer have the right to stand on.

**Time.** Fixed step of 0.25s game time. `secondTick` runs once per game second: battles, unrest, treaty expiry, AI scheduling, rate computation.

**No forced ending.** At 60% of population the "Dominance" modal offers Keep playing or See standings. The late game continues through coalitions against hegemons (threshold about 27% population share), unrest and uprisings. Do not add a hard win condition that stops play.

**Diplomacy.**
- Wars are stored in `G.wars` as key -> start time. IMPORTANT: `atWar` must test `!== undefined` because a war can start at t=0 (falsy).
- Treaties: truce, nap, access, trade, alliance.
- `opinion()` returns a breakdown from temperament, treaties, common enemy, border tension, hegemon fear, infamy and decaying memory events. The UI shows these reasons.
- `evalProposal` returns accept or refuse plus a reason. Alliances need a pact, trade or access deal at least 90s old (an anti-spam rule).
- Also: gifts, tribute, call to arms, join-war proposals, AI proposals to the player (ceasefire, treaties, tribute demands) handled by `answerProposal`.

**AI (`aiThink`).**
- `aiEconomy`: composition targets adapting to the enemy's mix, recruits near the front, builds forts and infrastructure.
- `aiMilitary`: fight-or-flee using deterministic `predictAttack`; stacks hold in an enemy province until it is captured (this fixed AI never capturing anything); defence dispatch with hold timers; opportunistic strikes; rally point and target with focus hysteresis; peacetime posture at borders; dust armies (<0.3 units) are cleaned up.
- `aiDiplomacy` and `aiWar`: ambition grows with peace time, hegemons draw attention, allies join wars only if they have fewer than 2 wars (stops world-war pile-ons).

## UI notes
- Panels: Map (province/army cards), Forces, Diplomacy, Intel. Tapping the active tab collapses the sheet.
- Interaction: tap an army (badge), then tap a province to move; route previews; battle and capture rings. Pan by drag, zoom by pinch or wheel. Tiny states get an invisible hit circle.
- `UI.touch` suppresses panel re-render for 700ms after a pointerdown inside the panel so taps are not eaten by re-renders.
- The page uses `grid-template-columns: minmax(0,1fr)` on `#app` — removing it breaks the mobile layout (header and tabs overflow).
- Debug handle: `window.__flusa = { UI, S, drawMap, renderPanel }` where `S` is the SIM object.
- Hot-reload hooks: `window.claude.hot.snapshot/ready`.

## Testing
- `node test.js 20 normal` — AI-only game; expect wars, captures, eliminations, uprisings, some ceasefires and no exceptions (about 1.5s for 20-30 game minutes on all difficulties).
- `node smoke.js` — jsdom run through every panel. The final war-declaration and save steps can be flaky from jsdom's slow requestAnimationFrame, or when the player gets eliminated during the simulated minutes (timing, not a bug).
- Real-browser checks used headless Chromium (`@sparticuz/chromium` + `puppeteer-core`). `@sparticuz/chromium` is ESM-only: `(await import('@sparticuz/chromium')).default`. Block all http(s) requests with request interception or Google Fonts requests make screenshots hang.
- Last perf check: step 0.25ms, draw 0.16ms, panel render 0.9ms (about 17 fps in software-rendered headless, raster-bound). Draw loop is throttled to about 30 fps.

## Known gaps / ideas for next steps
- Not yet verified on a real phone; dark theme and desktop layout were not inspected by eye.
- The Intel tab once showed stale content in a headless screenshot (probably headless slowness; unconfirmed).
- Ideas: fog of war, naval and air-base mechanics, tutorial, difficulty tuning, sound, more map regions or a world map, a Godot or Capacitor port for an app.
- Balance still needs real play: AI aggression, war length, and how fast the player snowballs.

## Style
Plain prose in explanations. Keep the code dependency-free. Prefer small, testable changes to `sim.js`, and re-run `node test.js 20 normal` after any change to the simulation or AI.
