// Balance harness: bot-only matches over many seeds, with each hero's numbers checked against bounds.
//
//   npm test                                 a quick sample (QUICK.matches, fixed seeds, wide bounds): catches gross skew
//   npm run balance                          the full run (60 matches from a random first seed, tight bounds) with its report
//   node test/balance.test.js 100 4242       any number of matches, from a first seed of your choice (repeats a run exactly)
//   npm run balance:endless                  endless mode: 12 matches from a random first seed, with its own report
//   node test/balance.test.js endless 30 7   the same for any match count and first seed
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
// Endless mode plays on until no Ember is left, with difficulty climbing at half pace. nights and minutes: the averages allowed.
// alone: the average minutes the last Ember may stand by itself before it falls too; under the least, endless mode adds nothing
// to a normal match, and over the most the nights have stopped getting harder fast enough to end it.
// ups: the fewest tier-2 structures the most upgraded base of a match may average (a bot base has 48 pieces): fewer, and bots have stopped using the Scrap sink.
// Where the game stood when these were set (30 matches, 2026-11-18, with tier-2 upgrades, Eclipses and the Core): 21.4 min and 17.0 nights
// on average, the last Ember alone for 0.7 min of it, every piece of the leading base upgraded; last standing Amber 10, Azure 11, Jade 9.
// History: 21.7 min and 17.0 nights before upgrades (bounds 14 to 20 nights, 18 to 26 minutes); upgrades alone made it 24.9 and 19.5
// (bounds moved to 16 to 23 and 21 to 29); Eclipses, which make every third night harder, brought it back, and the first bounds with it.
// A match costs about three times a normal one to play, hence only ten under npm test.
const ENDLESS = { matches: 10, firstSeed: 1, nights: [14, 20], minutes: [18, 26], alone: [0.3, 4], ups: 36, seats: 3 };

const LIMIT = 3600; // seconds of match time after which a match counts as unfinished

/**
 * job: { seed, endless }. alone: minutes the last Ember stood by itself (endless mode; a normal match ends the moment one is left).
 * ups: the most upgraded (tier-2) structures any one team had standing at once, looked at once a second.
 */
function playMatch({ seed, endless = false }) {
  const g = Object.assign(S.createGame(seed), { endless });
  let last = -1, ups = 0; // last: when only one Ember was left
  for (let n = 0; g.phase !== 'over' && g.t < LIMIT; n++) {
    S.step(g, g.heroes.map((h) => botInput(g, h.i)), 1 / 60);
    if (last < 0 && g.teams.filter((T) => T.alive).length <= 1) last = g.t;
    if (n % 60 === 0) ups = Math.max(ups, ...g.teams.map((_, k) => g.structs.filter((st) => st.team === k && st.tier === 2).length));
  }
  return {
    seed, endless, over: g.phase === 'over', winner: g.winner, minutes: g.t / 60, wave: g.wave, alone: last < 0 ? 0 : (g.t - last) / 60, ups,
    heroes: g.heroes.map((h) => ({ kind: h.kind, team: h.team, ...h.stats })),
  };
}

/** Play every job ({ seed, endless }), spread over the machine's cores. */
function playAll(jobs) {
  const queue = [...jobs], results = [];
  return new Promise((done, fail) => {
    const workers = Math.min(queue.length, Math.max(1, availableParallelism() >> 1)); // half the cores: under npm test the timing-sensitive server tests run beside this
    for (let k = 0; k < workers; k++) {
      const w = new Worker(new URL(import.meta.url));
      const next = () => (queue.length ? w.postMessage(queue.pop()) : w.terminate());
      w.on('error', fail);
      w.on('message', (r) => {
        results.push(r);
        next();
        if (results.length === jobs.length) done(results.sort((a, b) => a.seed - b.seed));
      });
      next();
    }
  });
}

/**
 * Per-hero averages over all matches, each beside the lineup's average. counts(r, h) picks whose numbers go in:
 * every team's by default, or (endless mode's report) only the team that was last standing.
 */
function summarise(results, counts = () => true) {
  const n = results.length, minutes = results.reduce((t, r) => t + r.minutes, 0);
  const heroes = S.HERO_IDS.map((kind) => {
    const sum = { dmg: 0, heal: 0, kills: 0, pvp: 0, deaths: 0 };
    let played = 0, mins = 0; // heroes of this kind counted, and the minutes they played
    for (const r of results) {
      for (const h of r.heroes) {
        if (h.kind !== kind || !counts(r, h)) continue;
        for (const f in sum) sum[f] += h[f];
        played++;
        mins += r.minutes;
      }
    }
    const per = (v) => v / (played || 1);
    return { kind, name: S.HEROES[kind].name, dpm: sum.dmg / (mins || 1), heal: per(sum.heal), kills: per(sum.kills), pvp: per(sum.pvp), deaths: per(sum.deaths) };
  });
  const mean = (f) => heroes.reduce((t, h) => t + h[f], 0) / heroes.length;
  const avg = { dpm: mean('dpm'), kills: mean('kills'), deaths: mean('deaths') };
  for (const h of heroes) Object.assign(h, { dpmVs: h.dpm / avg.dpm - 1, killsVs: h.kills / avg.kills - 1, deathsVs: h.deaths / avg.deaths });
  return {
    n, heroes, unfinished: results.filter((r) => !r.over).length, minutes: minutes / n, waves: results.reduce((t, r) => t + r.wave, 0) / n,
    alone: results.reduce((t, r) => t + r.alone, 0) / n, ups: results.reduce((t, r) => t + r.ups, 0) / n,
    wins: S.TEAMS.map((_, k) => results.filter((r) => r.winner === k).length), draws: results.filter((r) => r.over && r.winner < 0).length,
  };
}

const pct = (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;

/** The per-hero table: one line of headings, then a line for each hero. */
function table(sum) {
  const cols = ['Hero', 'Damage/min', 'vs average', 'AI kills', 'vs average', 'Hero kills', 'Deaths', 'vs average', 'Healed or repaired'];
  const rows = sum.heroes.map((h) => [h.name, h.dpm.toFixed(0), pct(h.dpmVs), h.kills.toFixed(1), pct(h.killsVs), h.pvp.toFixed(1), h.deaths.toFixed(2), pct(h.deathsVs - 1), h.heal.toFixed(0)]);
  const wide = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)));
  return [cols, ...rows].map((r) => r.map((v, i) => (i ? v.padStart(wide[i]) : v.padEnd(wide[i]))).join('  '));
}

const tally = (sum) => S.TEAMS.map((T, k) => `${T.name} ${sum.wins[k]} (${Math.round((sum.wins[k] / sum.n) * 100)}%)`).join(', ');

function report(sum, seeds) {
  return [
    `Balance: ${sum.n} bot-only matches, seeds ${seeds[0]} to ${seeds.at(-1)}`,
    `Finished ${sum.n - sum.unfinished} of ${sum.n}; average ${sum.minutes.toFixed(1)} min, ${sum.waves.toFixed(1)} nights`,
    `Wins: ${tally(sum)}, draws ${sum.draws}`,
    `The most upgraded base in a match had ${sum.ups.toFixed(1)} tier-2 structures on average`,
    '', ...table(sum), '',
  ].join('\n');
}

/** sum: every team's numbers. last: only those of the team that was last standing in each match. */
function endlessReport(sum, last, seeds) {
  return [
    `Endless mode: ${sum.n} bot-only matches, seeds ${seeds[0]} to ${seeds.at(-1)}`,
    `Finished ${sum.n - sum.unfinished} of ${sum.n}; average ${sum.minutes.toFixed(1)} min, ${sum.waves.toFixed(1)} nights; the last Ember stood alone for ${sum.alone.toFixed(1)} min on average`,
    `Last standing: ${tally(sum)}, none ${sum.draws}`,
    `The most upgraded base in a match had ${sum.ups.toFixed(1)} tier-2 structures on average`,
    '', 'The team that was last standing, a hero a match:', ...table(last), '',
  ].join('\n');
}

/** No team should take far more or less than a third of the matches that had a winner. */
function seatsTest(name, sum, seats) {
  test(name, () => {
    const decided = sum.n - sum.draws - sum.unfinished, spread = seats * Math.sqrt((decided * 2) / 9); // binomial, p = 1/3
    sum.wins.forEach((w, k) => assert.ok(Math.abs(w - decided / 3) <= spread, `${S.TEAMS[k].name}: ${w} of ${decided}, more than ${seats} standard deviations from a third`));
  });
}

const between = (v, [lo, hi]) => v >= lo && v <= hi;
const seedsFrom = (first, n) => Array.from({ length: n }, (_, k) => first + k);
const anySeed = (arg) => Math.floor(+arg) || 1 + Math.floor(Math.random() * 1e6);

if (!isMainThread) parentPort.on('message', (job) => parentPort.postMessage(playMatch(job)));
else {
  // No argument: the quick sample of both modes (npm test). A match count: the full run of normal matches. "endless": endless mode alone.
  const [arg, arg2, arg3] = process.argv.slice(2), mode = arg === undefined ? 'quick' : arg === 'endless' ? 'endless' : 'full';
  const B = mode === 'full' ? FULL : QUICK, n = mode === 'full' ? Math.max(1, +arg || 60) : mode === 'quick' ? QUICK.matches : 0;
  const seeds = seedsFrom(mode === 'full' ? anySeed(arg2) : QUICK.firstSeed, n);
  const endlessSeeds = mode === 'full' ? [] : seedsFrom(mode === 'quick' ? ENDLESS.firstSeed : anySeed(arg3), mode === 'quick' ? ENDLESS.matches : Math.max(1, +arg2 || 12));
  const played = await playAll([...seeds.map((seed) => ({ seed })), ...endlessSeeds.map((seed) => ({ seed, endless: true }))]);
  const sum = summarise(played.filter((r) => !r.endless)), longRuns = played.filter((r) => r.endless);
  if (n) console.log(report(sum, seeds));
  if (mode === 'full') console.log(`Repeat this exact run with: node test/balance.test.js ${n} ${seeds[0]}\n`);

  if (longRuns.length) {
    const all = summarise(longRuns), E = ENDLESS;
    console.log(endlessReport(all, summarise(longRuns, (r, h) => h.team === r.winner), endlessSeeds));
    if (mode === 'endless') console.log(`Repeat this exact run with: node test/balance.test.js endless ${all.n} ${endlessSeeds[0]}\n`);
    test(`endless: all ${all.n} matches end, each with a team that was last to fall`, () => assert.equal(all.unfinished + all.draws, 0));
    test(`endless: matches average ${E.nights[0]} to ${E.nights[1]} nights and ${E.minutes[0]} to ${E.minutes[1]} minutes`, () => {
      assert.ok(between(all.waves, E.nights) && between(all.minutes, E.minutes), `average match is ${all.waves.toFixed(1)} nights, ${all.minutes.toFixed(1)} min`);
    });
    test(`endless: the last Ember stands alone for ${E.alone[0]} to ${E.alone[1]} minutes on average`, () => {
      assert.ok(between(all.alone, E.alone), `it stands alone for ${all.alone.toFixed(1)} min`);
    });
    test(`endless: the most upgraded base of a match has at least ${E.ups} tier-2 structures on average`, () => assert.ok(all.ups >= E.ups, `it has ${all.ups.toFixed(1)}`));
    seatsTest('endless: no team is last standing far more or less often than a third of the time', all, E.seats);
  }

  if (n) test(`balance: all ${n} matches finish`, () => assert.equal(sum.unfinished, 0));
  if (n) test(`balance: matches average ${B.minutes[0]} to ${B.minutes[1]} minutes`, () => assert.ok(between(sum.minutes, B.minutes), `average match is ${sum.minutes.toFixed(1)} min`));
  if (n) seatsTest('balance: no team wins far more or less than a third of the matches', sum, B.seats);
  for (const h of n ? sum.heroes : []) {
    test(`balance: ${h.name}'s damage per minute is within ${B.dmg * 100}% of the lineup's average`, () => {
      assert.ok(Math.abs(h.dpmVs) <= B.dmg, `${h.name} deals ${pct(h.dpmVs)} against the average (${h.dpm.toFixed(0)} a minute)`);
    });
    test(`balance: ${h.name} dies ${B.deaths[0]} to ${B.deaths[1]} times as often as the lineup's average`, () => {
      assert.ok(h.deathsVs >= B.deaths[0] && h.deathsVs <= B.deaths[1], `${h.name} dies ${h.deathsVs.toFixed(2)} times as often as the average (${h.deaths.toFixed(2)} a match)`);
    });
  }
}
