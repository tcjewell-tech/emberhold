# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Emberhold: a top-down browser game. Three teams (Amber, Azure, Jade) of five heroes (Anvil, Dart, Patch, Cog, Forge) each guard an Ember. AI enemies attack every Ember each night; rival heroes can attack at any time; the last Ember standing wins. Bots play every hero no human picks. `README.md` has the player-facing rules and controls.

## Commands

```bash
npm install
npm start          # http://localhost:3000, this computer only (PORT env overrides the port)
npm run lan        # same, bound to 0.0.0.0: for a LAN, or as the start command on an internet host
npm start -- --lag=150 --jitter=40   # simulate a slow line (round-trip ms, extra ms each way)
npm test           # node --test "test/*.test.js"
npm run balance    # 60 bot-only matches from a random seed, every hero checked against bounds (under a minute)
node test/balance.test.js 100 4242   # the same for any match count and first seed; a seed repeats a run exactly
node --test test/bots.test.js                                     # one file
node --test --test-name-pattern="Anvil bot raids" test/bots.test.js   # one test
```

There is no build step, linter or bundler. The only dependency is `ws`. The code uses `import.meta.main` and `import.meta.dirname`, so it needs a recent Node (developed on v26). `.claude/launch.json` defines the preview servers `emberhold` and `emberhold-slow` (simulated lag), both on port 3000.

## Architecture

One code path: the server is always authoritative, solo play included.

- `public/sim.js` holds every rule. It is pure and headless: `createGame(seed)` returns the state, `step(state, inputs, dt)` advances it. It lives in `public/` because both sides import it: the server runs it, and the browser imports its constants and `canBuild` (for the build ghost) from the same file.
- `public/bots.js` exports `botInput(state, heroIndex, spend)`. It returns the same input object a human client sends, and keeps no memory between calls. `spend` (default true) lets the bot use its team's Scrap; the server lets bots build on every team, a human's included, and the touch client passes false when it borrows `botInput` for auto-aim.
- `server.js` exports `startServer()`. It serves `public/` and runs one match at 60 Hz, sending the whole state as JSON at 30 Hz. The match is created when the first human joins and discarded `grace` seconds (default 60) after the last one leaves; a human who leaves hands their hero to a bot.
- `public/client.js` only sends input and draws. It blends snapshots with `public/interp.js` and predicts its own hero locally.
- `public/net.js` is the client netcode that must hold up over the internet, kept free of the DOM so Node can test it: `createTimeline` (which moment to draw) and `createPredictor` (own-hero prediction).

### Things that span files

- **Inputs.** Humans and bots both produce `{mx, my, aim, fire, use, q, r, build, remove}`. `step` takes an array (or object) indexed by hero slot. Held fields are state; `q`, `r`, `build`, `remove` are one-shot. The server rebuilds every client input from scratch in `readInput` before the sim sees it.
- **Hero slots.** A hero's index is `team * TEAM_SIZE + k`, where `k` is its position in `HERO_IDS` (`anvil, dart, patch, cog, forge`); `teamOf(slot)` gives the team. A Shield Generator's field (and a Forge's own) raises a nearby hero's `shieldMax` each tick. Tests, the server's seats and the client all rely on this.
- **State is plain JSON.** The snapshot is `JSON.stringify(state)`, so nothing non-serialisable may go in it. Derived data (cell lookup, wall grid, one flow field per Ember) lives in a `WeakMap` in `sim.js` keyed by the state and rebuilt when `s.sv` changes. Anything that adds or removes a structure must bump `s.sv`; use `addStruct` and the existing removal path rather than touching `s.structs` directly.
- **Determinism.** The sim uses its own seeded RNG; the same seed and inputs must give the same state (a test checks it). Do not use `Math.random` or the clock in `sim.js` or `bots.js`.
- **Hostility.** Every hero, shot and structure carries a `team`; AI enemies are hostile to all three. There is no friendly fire within a team, and a team walks and shoots through its own Walls.
- **Netcode contract.** Each `state` message carries `n` (the server tick, which is the clock the client's timeline runs on, not arrival time) and `acks` (per hero slot, the last input `seq` the server has heard). The client compares the server's position for its hero with where it had predicted itself when input `acks[slot]` went out, so lag is not mistaken for error. It walks its prediction with the sim's own `moveHero`, so Walls stop it exactly as they stop the server.
- **Bandwidth.** Snapshots stay whole-state JSON; one deflate stream per connection, run by `server.js` itself and read by `createUnpacker` in `net.js`, does the delta work (about 650 KB/s raw, about 25 KB/s on the wire). Every server message goes through it as newline-separated JSON. It is not left to the WebSocket's `perMessageDeflate`, because Render's proxy strips that. Adding fields that change every tick for every entity costs more than their size suggests.
- **Connections.** A client makes up a `key` and sends it with `join`; showing it again takes its seat back from a connection that died unnoticed. The server pings every `beat` ms and drops silent connections, refuses connections past `maxClients`, and cuts off one that floods.
- **Look and sound.** `public/art.js` paints everything in art pixels (`PX` = 0.5 art pixels per world unit) on a small canvas the page scales up by a whole number; sprites are drawn once in code, outlined and cached. `public/sound.js` synthesises every effect. There are no image or audio files. `client.js` plays sounds from what changed between snapshots (`hear`), using the ids on shots and effects. The match's colour mood is `s.mood`, fixed at `createGame` from the seed (`s.seed` itself is the RNG state and changes constantly); the HUD's panel colours follow it through CSS variables. The HUD font is Silkscreen from Google Fonts, falling back to monospace offline.
- **Touch.** `public/touch.js` turns a thumb drag into the same move input the keyboard produces, so nothing in the sim or server knows which a player uses; phone and PC are one client, not two versions. On touch, `sendInput` in `client.js` takes aim and fire from `botInput` (the bots' own target choice) and scavenges automatically near a wreck, leaving the player to move, build and use Q and R. Building on touch has two styles chosen under Settings (saved in localStorage): drag to place, or Auto-build, which places `nextPiece` from `bots.js` (the bot Cog's blueprint). Touch-only HUD pieces carry the `touchonly` class and show when `body.touch` is set.
- **Arena and power-ups.** The playable ground is the circle `ARENA` in `sim.js` (centred on the three Embers); `inArena`, `keepIn` and the `LAND` cell mask keep heroes, enemies, shots, wrecks, building and pathing inside it, while `WORLD` is still the rectangle the grid and ground image cover. Killed AI enemies may drop `s.pickups` (`POWERUPS`: rush, fury, mend) using the seeded RNG; heroes carry `rush` and `fury` timers.
- **Static files.** The server only serves a literal file name directly inside `public/` ending in `.html`, `.js` or `.css`. A new asset type or a subfolder needs that check in `server.js` changed.

## Tests

Node's built-in runner, no test dependencies. `test/sim.test.js` covers rules, `test/bots.test.js` covers bot decisions plus seeded full bot-only matches checked for sane state, `test/server.test.js` starts a real server on a random port with WebSocket clients (`newGame` is injectable so a test can start from a prepared match).

`test/balance.test.js` is the balance harness. It plays bot-only matches on worker threads and fails when a hero's damage per minute or deaths per match stray too far from the average of the five, when a team wins far from a third of the matches, or when matches run too short, too long or never end. Under `npm test` it plays 12 fixed-seed matches against wide bounds (`QUICK`); given a match count on the command line it plays that many against tight ones (`FULL`) and prints a per-hero table.

Bot tests mostly build a state by hand (place heroes, set `g.wave`, clear `g.wrecks`) and assert on a single `botInput` result, using the `quiet()` and `heading()` helpers in `test/bots.test.js`.

Nothing automated covers the browser client; check drawing and HUD changes by playing in a browser.

## Balance changes

Hero, structure and enemy numbers are the tables at the top of `sim.js` (`HEROES`, `STRUCTS`, `ENEMIES`). Judge a balance or bot-behaviour change with the harness: run `node test/balance.test.js 60 1001` before and after (the same first seed plays the same matches) and compare the tables, then `npm run balance` for a fresh random sample. Change a bound in `FULL` or `QUICK` only on purpose, and say why in the commit.

Damage per minute settles to within a point or two of the average by 12 matches. Deaths need 60 to settle to about a tenth, and a team's win count swings by several even then.

## Known limits

- One match per server process, open to anyone who has the address (no rooms, no password).
- Only your own hero's movement is predicted. Shots, abilities and builds happen when the server hears them, so they lag by the connection's delay; there is no lag compensation for aiming.
- No automated test covers the browser's use of `net.js`; `test/net.test.js` covers the module itself.
