// Balance harness: bot-only matches over many seeds, with each hero's numbers checked against bounds.
//
//   npm test                                 a quick sample (QUICK.matches, fixed seeds, wide bounds): catches gross skew
//   npm run balance                          the full run (60 matches from a random first seed, tight bounds) with its report
//   node test/balance.test.js 100 4242       any number of matches, from a first seed of your choice (repeats a run exactly)
//
// A hero is flagged when its damage per minute or its deaths per match stray too far from the
// average of the five heroes. Matches run on worker threads, on half the machine's cores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import * as S from '../public/sim.js';
import { botInput } from '../public/bots.js';

// dmg: how far (as a share) a hero's damage per minute may sit from the lineup's average.
// deaths: the same for deaths per match, as [least, most] times the average.
// minutes: the average match length allowed. seats: how many standard deviations a team's wins may sit from a third.
// Where the game stood when these were set (three runs of 60): damage within 10% of the average for every hero;
// deaths 0.8 to 1.4 times the average for every hero, Cog the most and Dart the least.
// Twelve matches pin damage down just as well but leave deaths about a quarter of the average either way, hence QUICK's width.
const FULL = { dmg: 0.2, deaths: [0.5, 1.6], minutes: [8, 15], seats: 3 };
const QUICK = { matches: 12, firstSeed: 1, dmg: 0.3, deaths: [0.33, 2], minutes: [7, 16], seats: 3 };

const LIMIT = 3600; // seconds of match time after which a match counts as unfinished

function playMatch(seed) {
  const g = S.createGame(seed);
  while (g.phase !== 'over' && g.t < LIMIT) S.step(g, g.heroes.map((h) => botInput(g, h.i)), 1 / 60);
  return { seed, over: g.phase === 'over', winner: g.winner, minutes: g.t / 60, wave: g.wave, heroes: g.heroes.map((h) => ({ kind: h.kind, ...h.stats })) };
}

/** Play one match per seed, spread over the machine's cores. */
function playAll(seeds) {
  const queue = [...seeds], results = [];
  return new Promise((done, fail) => {
    const workers = Math.min(queue.length, Math.max(1, availableParallelism() >> 1)); // half the cores: under npm test the timing-sensitive server tests run beside this
    for (let k = 0; k < workers; k++) {
      const w = new Worker(new URL(import.meta.url));
      const next = () => (queue.length ? w.postMessage(queue.pop()) : w.terminate());
      w.on('error', fail);
      w.on('message', (r) => {
        results.push(r);
        next();
        if (results.length === seeds.length) done(results.sort((a, b) => a.seed - b.seed));
      });
      next();
    }
  });
}

/** Per-hero averages over all matches and all three teams, each beside the lineup's average. */
function summarise(results) {
  const n = results.length, minutes = results.reduce((t, r) => t + r.minutes, 0);
  const heroes = S.HERO_IDS.map((kind) => {
    const sum = { dmg: 0, heal: 0, kills: 0, pvp: 0, deaths: 0 };
    for (const r of results) for (const h of r.heroes) if (h.kind === kind) for (const f in sum) sum[f] += h[f];
    const per = (v) => v / (n * S.TEAMS.length);
    return { kind, name: S.HEROES[kind].name, dpm: sum.dmg / (minutes * S.TEAMS.length), heal: per(sum.heal), kills: per(sum.kills), pvp: per(sum.pvp), deaths: per(sum.deaths) };
  });
  const mean = (f) => heroes.reduce((t, h) => t + h[f], 0) / heroes.length;
  const avg = { dpm: mean('dpm'), kills: mean('kills'), deaths: mean('deaths') };
  for (const h of heroes) Object.assign(h, { dpmVs: h.dpm / avg.dpm - 1, killsVs: h.kills / avg.kills - 1, deathsVs: h.deaths / avg.deaths });
  return {
    n, heroes, unfinished: results.filter((r) => !r.over).length, minutes: minutes / n, waves: results.reduce((t, r) => t + r.wave, 0) / n,
    wins: S.TEAMS.map((_, k) => results.filter((r) => r.winner === k).length), draws: results.filter((r) => r.over && r.winner < 0).length,
  };
}

const pct = (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;

function report(sum, seeds) {
  const cols = ['Hero', 'Damage/min', 'vs average', 'AI kills', 'vs average', 'Hero kills', 'Deaths', 'vs average', 'Healed or repaired'];
  const rows = sum.heroes.map((h) => [h.name, h.dpm.toFixed(0), pct(h.dpmVs), h.kills.toFixed(1), pct(h.killsVs), h.pvp.toFixed(1), h.deaths.toFixed(2), pct(h.deathsVs - 1), h.heal.toFixed(0)]);
  const wide = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((v, i) => (i ? v.padStart(wide[i]) : v.padEnd(wide[i]))).join('  ');
  return [
    `Balance: ${sum.n} bot-only matches, seeds ${seeds[0]} to ${seeds.at(-1)}`,
    `Finished ${sum.n - sum.unfinished} of ${sum.n}; average ${sum.minutes.toFixed(1)} min, ${sum.waves.toFixed(1)} nights`,
    `Wins: ${S.TEAMS.map((T, k) => `${T.name} ${sum.wins[k]} (${Math.round((sum.wins[k] / sum.n) * 100)}%)`).join(', ')}, draws ${sum.draws}`,
    '', line(cols), ...rows.map(line), '',
  ].join('\n');
}

if (!isMainThread) parentPort.on('message', (seed) => parentPort.postMessage(playMatch(seed)));
else {
  const full = process.argv[2] !== undefined; // a match count on the command line asks for the full run
  const B = full ? FULL : QUICK, n = full ? Math.max(1, +process.argv[2] || 60) : QUICK.matches;
  const first = full ? Math.floor(+process.argv[3]) || 1 + Math.floor(Math.random() * 1e6) : QUICK.firstSeed;
  const seeds = Array.from({ length: n }, (_, k) => first + k);
  const sum = summarise(await playAll(seeds));
  console.log(report(sum, seeds));
  if (full) console.log(`Repeat this exact run with: node test/balance.test.js ${n} ${first}\n`);

  test(`balance: all ${n} matches finish`, () => assert.equal(sum.unfinished, 0));
  test(`balance: matches average ${B.minutes[0]} to ${B.minutes[1]} minutes`, () => {
    assert.ok(sum.minutes >= B.minutes[0] && sum.minutes <= B.minutes[1], `average match is ${sum.minutes.toFixed(1)} min`);
  });
  test('balance: no team wins far more or less than a third of the matches', () => {
    const decided = sum.n - sum.draws - sum.unfinished, spread = B.seats * Math.sqrt((decided * 2) / 9); // binomial, p = 1/3
    sum.wins.forEach((w, k) => assert.ok(Math.abs(w - decided / 3) <= spread, `${S.TEAMS[k].name} won ${w} of ${decided}: more than ${B.seats} standard deviations from a third`));
  });
  for (const h of sum.heroes) {
    test(`balance: ${h.name}'s damage per minute is within ${B.dmg * 100}% of the lineup's average`, () => {
      assert.ok(Math.abs(h.dpmVs) <= B.dmg, `${h.name} deals ${pct(h.dpmVs)} against the average (${h.dpm.toFixed(0)} a minute)`);
    });
    test(`balance: ${h.name} dies ${B.deaths[0]} to ${B.deaths[1]} times as often as the lineup's average`, () => {
      assert.ok(h.deathsVs >= B.deaths[0] && h.deathsVs <= B.deaths[1], `${h.name} dies ${h.deathsVs.toFixed(2)} times as often as the average (${h.deaths.toFixed(2)} a match)`);
    });
  }
}
