# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Emberhold: a top-down browser game. Three teams (Amber, Azure, Jade) of four heroes (Anvil, Dart, Patch, Cog) each guard an Ember. AI enemies attack every Ember each night; rival heroes can attack at any time; the last Ember standing wins. Bots play every hero no human picks. `README.md` has the player-facing rules and controls.

## Commands

```bash
npm install
npm start          # http://localhost:3000, this computer only (PORT env overrides the port)
npm run lan        # same, bound to 0.0.0.0 for others on the network
npm test           # node --test "test/*.test.js"
node --test test/bots.test.js                                     # one file
node --test --test-name-pattern="Anvil bot raids" test/bots.test.js   # one test
```

There is no build step, linter or bundler. The only dependency is `ws`. The code uses `import.meta.main` and `import.meta.dirname`, so it needs a recent Node (developed on v26). `.claude/launch.json` defines the preview server `emberhold` on port 3000.

## Architecture

One code path: the server is always authoritative, solo play included.

- `public/sim.js` holds every rule. It is pure and headless: `createGame(seed)` returns the state, `step(state, inputs, dt)` advances it. It lives in `public/` because both sides import it: the server runs it, and the browser imports its constants and `canBuild` (for the build ghost) from the same file.
- `public/bots.js` exports `botInput(state, heroIndex, spend)`. It returns the same input object a human client sends, and keeps no memory between calls. `spend` is false for bots on a team that has a human, so they never spend that team's Scrap.
- `server.js` exports `startServer()`. It serves `public/` and runs one match at 60 Hz, sending the whole state as JSON at 30 Hz. The match is created when the first human joins and discarded when the last one leaves; a human who leaves hands their hero to a bot.
- `public/client.js` only sends input and draws. It renders about 80 ms behind, blending snapshots with `public/interp.js`, and predicts its own hero's walking locally.

### Things that span files

- **Inputs.** Humans and bots both produce `{mx, my, aim, fire, use, q, r, build, remove}`. `step` takes an array (or object) indexed by hero slot. Held fields are state; `q`, `r`, `build`, `remove` are one-shot. The server rebuilds every client input from scratch in `readInput` before the sim sees it.
- **Hero slots.** A hero's index is `team * 4 + k`, where `k` is its position in `HERO_IDS` (`anvil, dart, patch, cog`). Tests, the server's seats and the client all rely on this.
- **State is plain JSON.** The snapshot is `JSON.stringify(state)`, so nothing non-serialisable may go in it. Derived data (cell lookup, wall grid, one flow field per Ember) lives in a `WeakMap` in `sim.js` keyed by the state and rebuilt when `s.sv` changes. Anything that adds or removes a structure must bump `s.sv`; use `addStruct` and the existing removal path rather than touching `s.structs` directly.
- **Determinism.** The sim uses its own seeded RNG; the same seed and inputs must give the same state (a test checks it). Do not use `Math.random` or the clock in `sim.js` or `bots.js`.
- **Hostility.** Every hero, shot and structure carries a `team`; AI enemies are hostile to all three. There is no friendly fire within a team, and a team walks and shoots through its own Walls.
- **Static files.** The server only serves a literal file name directly inside `public/` ending in `.html`, `.js` or `.css`. A new asset type or a subfolder needs that check in `server.js` changed.

## Tests

Node's built-in runner, no test dependencies. `test/sim.test.js` covers rules, `test/bots.test.js` covers bot decisions plus seeded full bot-only matches checked for sane state, `test/server.test.js` starts a real server on a random port with WebSocket clients (`newGame` is injectable so a test can start from a prepared match).

Bot tests mostly build a state by hand (place heroes, set `g.wave`, clear `g.wrecks`) and assert on a single `botInput` result, using the `quiet()` and `heading()` helpers in `test/bots.test.js`.

Nothing automated covers the browser client; check drawing and HUD changes by playing in a browser.

## Balance changes

Hero, structure and enemy numbers are the tables at the top of `sim.js` (`HEROES`, `STRUCTS`, `ENEMIES`). Judge a balance or bot-behaviour change by running bot-only matches headlessly over several seeds and comparing per-hero `stats` (`dmg`, `kills`, `pvp`, `deaths`), match length and which team wins:

```js
const g = createGame(seed);
while (g.phase !== 'over' && g.t < 3600) step(g, g.heroes.map((h) => botInput(g, h.i)), 1 / 60);
```

Nine matches is a noisy sample; win counts per team swing widely at that size.

## Known limits

- Built for one machine or a LAN: full-state snapshots every tick, no delta compression.
- One match per server process.
- Client prediction covers plain walking only (no wall collisions); the server position corrects it.
