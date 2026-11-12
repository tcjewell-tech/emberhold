# Emberhold

Three teams (Amber, Azure, Jade) each guard an Ember. AI enemies attack every Ember each
night; rival heroes can attack at any time. The last Ember standing wins. Bots play every
hero nobody picks. Bots on a team with a human never spend Scrap: building is your job.

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
Q and R for your ability and ultimate. To build, tap Wall, Turret or Spikes and then the
ground (Remove switches to removing); tap the same button again to stop. The scoreboard and
the sound switch are keyboard-only for now.

## Play over the internet

The game is built to play over the internet: each player uses about 25 KB/s, your own hero
answers your keys at once whatever the lag, and a dropped connection reconnects by itself and
gives you your hero back (an empty match is kept for 60 seconds).

The server has to run somewhere the other players can reach. Start it with `npm run lan`,
which listens on every network interface, on the port in the `PORT` environment variable or
3000. Served over HTTPS, the page switches to a secure WebSocket by itself.

Anyone who has the address can join, and there is one match per server.

To feel what a slow connection is like before you put it online:

```bash
npm start -- --lag=150 --jitter=40
```

`--lag` is the round trip in milliseconds; `--jitter` adds up to that many more each way.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse / left-click | Aim / fire |
| Q | Ability |
| R | Ultimate (when charged) |
| F (hold) | Scavenge a wreck for Scrap |
| 1 2 3 | Build Wall / Turret / Spikes: left-click places (drag to paint), right-click removes, Esc stops |
| Tab (hold) | Scoreboard |
| M | Sound on or off |

## Test

```bash
npm test
```

`public/sim.js` holds every rule and runs headless; `public/bots.js` plays the bot heroes;
`server.js` runs the one authoritative match; `public/client.js` only sends input and draws;
`public/net.js` keeps the picture smooth and your own hero responsive over a slow connection;
`public/art.js` draws the pixel art and `public/sound.js` makes the sound effects, both in code
with no image or audio files. Each match wears one of three colour moods (Frostfall, Thaw, Dusk).
