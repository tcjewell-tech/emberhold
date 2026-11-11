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

## Test

```bash
npm test
```

`public/sim.js` holds every rule and runs headless; `public/bots.js` plays the bot heroes;
`server.js` runs the one authoritative match; `public/client.js` only sends input and draws.
