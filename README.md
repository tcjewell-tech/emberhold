# Emberhold

Three teams (Amber, Azure, Jade) each guard an Ember. AI enemies attack every Ember each
night; rival heroes can attack at any time. The last Ember standing wins. Bots play every
hero nobody picks, and bot teammates build a base with your team's Scrap, as you can too.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000 and pick a team and hero. To let others on your network join,
use `npm run lan` and give them the address it prints.

### On a phone or tablet

Turn it sideways and drag anywhere to move. Your hero aims, fires and scavenges wrecks by
itself, choosing targets the way the bots do, so your thumbs are free to move and build. Tap
Q and R for your ability and ultimate. A faint ring shows how far your gun reaches.

Settings offers two ways to build on a touch screen:
- **Drag to place:** drag Wall, Turret, Spikes or Shield onto the ground and let go (Remove switches
  to removing).
- **Auto-build:** one button builds the next piece of a ready-made base around your Ember.

The scoreboard is keyboard-only for now.

## Play over the internet

The game is built to play over the internet: each player uses about 40 KB/s, your own hero
answers your keys at once whatever the lag, your shots, the structures you place and Dart's Dash
happen on screen at once too, and a dropped connection reconnects by itself and gives you your hero back (an empty
match is kept for 60 seconds). Hits still land when the server hears them.

The server has to run somewhere the other players can reach. Start it with `npm run lan`,
which listens on every network interface, on the port in the `PORT` environment variable or
3000. Served over HTTPS, the page switches to a secure WebSocket by itself.

Players reach the server by its IP address or the computer's own name. On a host they reach by
a domain name, start it with `npm run lan -- --any-host` (on Render this is automatic).

Anyone who has the address can join, and there is one match per server.

To feel what a slow connection is like before you put it online:

```bash
npm start -- --lag=150 --jitter=40
```

`--lag` is the round trip in milliseconds; `--jitter` adds up to that many more each way.

## Endless mode

Tick **Endless mode** on the hero select screen before you start a match. The match then does
not stop when one Ember is left: the nights keep coming until every Ember has fallen, and the
team that fell last held out longest. Each night is harder than the one before, but the climb
is half as steep as in a normal match. The first player in picks the mode; Play again keeps it.

## Power-ups

AI enemies sometimes drop a glowing gem that lasts 20 seconds. Any hero can grab one by
walking over it, rivals included: **Rush** (blue, 10 s of 40% more speed), **Fury** (red,
10 s of 50% more gun damage) or **Mend** (green, heals half your health). Bigger enemies drop
them more often; the Colossus always does.

The arena is round, ringed by water.

## Upgrades

Build the same structure again on one of your team's own and it is upgraded: it is mended,
and from then on has half as much more health and does half as much more (a Turret's damage,
Spikes' damage, a Shield Generator's barrier: 75 points). It costs what the structure cost,
works once for each structure, and shows as gold corners. Click the structure to do it;
dragging a line of Walls across it does not. Bots upgrade their base once it is complete,
and on a team with a human they leave 35 Scrap in the pool for the humans to spend.

## Shield Generator and Forge

A **Shield Generator** (35 Scrap) starts working 2 seconds after you place it. Friendly heroes
within its ring carry a 50-point barrier that takes damage before their health does; it
refills after 4 seconds without being hit and is lost on walking out of the ring.

**Forge** is the fifth hero on each team, a slow support. It carries the same
shield field for itself and teammates beside it. **Reforge** (Q) repairs your Walls, Turrets
and Shield Generators around it; **Aegis** (R) halves the damage your whole team takes for
6 seconds.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse / left-click | Aim / fire |
| Q | Ability |
| R | Ultimate (when charged) |
| F (hold) | Scavenge a wreck for Scrap |
| 1 2 3 4 | Build Wall / Turret / Spikes / Shield Generator: left-click places (drag to paint), left-click on your own structure upgrades it, right-click removes, Esc stops |
| Tab (hold) | Scoreboard |
| Q / E, Space or left-click (once your Ember is lost) | Follow the previous / next Ember or hero still in the match; W A S D flies the camera freely again |
| M | Sound on or off |

## Test

```bash
npm test
npm run balance
npm run balance:endless
```

`npm run balance` plays 60 bot-only matches and reports each hero's damage, kills and deaths
beside the lineup's average, failing if a hero strays too far from it.
`npm run balance:endless` plays 12 endless matches and reports how many nights they last, how long
the last Ember stands alone, and the numbers of the team that was last standing.

`public/sim.js` holds every rule and runs headless; `public/bots.js` plays the bot heroes;
`server.js` runs the one authoritative match; `public/client.js` only sends input and draws;
`public/net.js` keeps the picture smooth and your own hero responsive over a slow connection;
`public/art.js` draws the pixel art and `public/sound.js` makes the sound effects, both in code
with no image or audio files. Each match wears one of three colour moods (Frostfall, Thaw, Dusk).
Big moments (an Ember falling, a Colossus going down) throw sparks and shake the screen. Settings has
"Screen shake: off" to keep the camera still; it starts off if your system asks for reduced motion.
