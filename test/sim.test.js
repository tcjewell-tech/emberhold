import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/sim.js';

const DT = 1 / 60;
const AMBER = 0, AZURE = S.TEAM_SIZE, JADE = 2 * S.TEAM_SIZE; // first hero slot of each team
const ANVIL = 0, DART = 1, PATCH = 2, COG = 3, FORGE = 4; // offset within a team
const MID = { x: 1820, y: 1500, cx: 45, cy: 37 }; // centre of a cell on open ground, far from every Ember

/** A match with the clock frozen in daytime and no wrecks, so only what a test adds matters. */
function arena(seed = 1) {
  const g = S.createGame(seed);
  g.timer = 1e9;
  g.wrecks = [];
  return g;
}

function run(g, seconds, inputs = {}) {
  for (let n = Math.round(seconds / DT); n > 0; n--) S.step(g, typeof inputs === 'function' ? inputs(g) : inputs, DT);
  return g;
}

const place = (h, x, y) => Object.assign(h, { x, y });
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const strandAmber = (g) => g.heroes.slice(AMBER, AMBER + S.TEAM_SIZE).forEach((h) => place(h, 300, 300));

/** Amber's Ember boxed in by its own Walls, optionally with a two-cell gap on the north side. */
function ringAroundAmber(g, leaveGap) {
  const ex = g.teams[0].ember.x / S.CELL, ey = g.teams[0].ember.y / S.CELL;
  const walls = [];
  for (let dx = -5; dx <= 4; dx++) for (let dy = -5; dy <= 4; dy++) {
    if (dx !== -5 && dx !== 4 && dy !== -5 && dy !== 4) continue;
    if (leaveGap && dy === -5 && (dx === -1 || dx === 0)) continue;
    walls.push(S.addStruct(g, 'wall', 0, ex + dx, ey + dy));
  }
  return walls;
}

// ---------------------------------------------------------------- setup and movement

test('a new match has three teams of five heroes camped at their own Ember', () => {
  const g = S.createGame(1);
  assert.equal(g.phase, 'day');
  assert.equal(g.teams.length, 3);
  assert.equal(g.heroes.length, 15);
  for (const h of g.heroes) {
    assert.ok(gap(h, g.teams[h.team].ember) < 150);
    assert.equal(h.hp, S.HEROES[h.kind].hp);
  }
  assert.deepEqual(g.heroes.slice(JADE).map((h) => h.kind), S.HERO_IDS);
  assert.equal(g.heroes[JADE].team, 2);
  assert.deepEqual(g.teams.map((t) => t.scrap), [S.START_SCRAP, S.START_SCRAP, S.START_SCRAP]);
  assert.ok(g.wrecks.length > 10);
});

test('every team has the same wrecks on its doorstep', () => {
  for (const seed of [1, 2, 3]) {
    const g = S.createGame(seed);
    const count = [0, 0, 0], worth = [0, 0, 0];
    for (const w of g.wrecks) {
      const d = g.teams.map((T) => gap(w, T.ember));
      const home = d.indexOf(Math.min(...d));
      count[home]++;
      worth[home] += w.scrap;
    }
    assert.deepEqual(count, [count[0], count[0], count[0]], `seed ${seed} counts ${count}`);
    assert.ok(Math.max(...worth) - Math.min(...worth) <= 0.05 * Math.max(...worth), `seed ${seed} worth ${worth}`);
  }
});

test('a hero moves at its own speed and stops at the edge of the round arena', () => {
  const g = arena();
  const h = place(g.heroes[AMBER + DART], 1000, 1000);
  run(g, 1, { [AMBER + DART]: { mx: 1, my: 0 } });
  assert.ok(Math.abs(h.x - (1000 + S.HEROES.dart.speed)) < 1);
  run(g, 30, { [AMBER + DART]: { mx: 1, my: 0 } });
  assert.ok(Math.abs(gap(h, S.ARENA) - (S.ARENA.r - S.HERO_R)) < 0.01, 'held at the shore');
  assert.ok(h.x < S.WORLD.w - 200, 'well short of the old square edge');
});

test('the arena is round: nothing is built, spawned or shot beyond its edge', () => {
  const g = arena();
  const corner = { x: 60, y: 60 }; // a corner of the old square map, out over the water
  assert.equal(S.inArena(corner.x, corner.y), false);
  const h = place(g.heroes[AMBER + COG], S.ARENA.x, S.ARENA.y - S.ARENA.r + 100);
  const cx = Math.floor(h.x / S.CELL), cy = Math.floor((S.ARENA.y - S.ARENA.r - 30) / S.CELL);
  g.teams[0].scrap = 1000;
  assert.equal(S.canBuild(g, h.i, 'wall', cx, cy), 'bounds');
  const e = S.spawnEnemy(g, 'skitter', 0, corner.x, corner.y);
  assert.ok(S.inArena(e.x, e.y), 'a spawn out over the water comes ashore');
  for (const T of S.TEAMS) assert.ok(gap(T, S.ARENA) < S.ARENA.r - 400, 'every Ember has room behind it');
  const d = S.TEAMS.map((T) => gap(T, S.ARENA));
  assert.ok(Math.max(...d) - Math.min(...d) < 30, 'and they sit about equally far from the middle');
});

test('AI enemies sometimes drop power-ups; any hero who walks over one gets its effect', () => {
  const g = arena();
  const dart = place(g.heroes[AMBER + DART], 1500, 1500);
  let drops = 0;
  for (let k = 0; k < 40; k++) { // the Colossus always drops; Breakers often
    const e = S.spawnEnemy(g, k ? 'breaker' : 'colossus', 0, 1500, 1200);
    e.hp = 1;
    g.shots.push({ id: g.nextId++, x: e.x, y: e.y, vx: 0, vy: 0, ttl: 1, dmg: 5, team: 0, owner: dart.i });
    S.step(g, [], DT);
    drops = g.pickups.length;
  }
  assert.ok(drops >= 5 && drops < 40, `${drops} drops from 40 kills`);
  assert.ok(g.pickups.every((p) => p.kind in S.POWERUPS && p.ttl > 0));

  g.pickups = [{ id: 1, kind: 'rush', x: 1500, y: 1500, ttl: 5 }];
  S.step(g, [], DT);
  assert.equal(g.pickups.length, 0);
  assert.ok(dart.rush > 9, 'Rush is on');
  const x0 = dart.x;
  run(g, 1, { [dart.i]: { mx: 1, my: 0 } });
  assert.ok(Math.abs(dart.x - x0 - S.HEROES.dart.speed * S.POWERUPS.rush.speed) < 2, 'and the hero runs 40% faster');

  dart.hp = 20;
  g.pickups = [{ id: 2, kind: 'mend', x: dart.x, y: dart.y, ttl: 5 }];
  S.step(g, [], DT);
  assert.equal(dart.hp, 20 + dart.max * S.POWERUPS.mend.heal, 'Mend heals half');

  g.pickups = [{ id: 3, kind: 'fury', x: 3000, y: 3000, ttl: 0.5 }];
  run(g, 1);
  assert.equal(g.pickups.length, 0, 'an untouched power-up fades');
});

test('Fury makes gun shots hit harder', () => {
  const g = arena();
  const dart = place(g.heroes[AMBER + DART], 1500, 1500);
  dart.fury = 5;
  S.step(g, { [dart.i]: { fire: true, aim: 0 } }, DT);
  assert.equal(g.shots.at(-1).dmg, S.HEROES.dart.gun.dmg * S.POWERUPS.fury.mult);
});

test('moving diagonally is no faster than moving straight', () => {
  const g = arena();
  const h = place(g.heroes[AMBER + DART], 1000, 1000);
  run(g, 1, { [AMBER + DART]: { mx: 1, my: 1 } });
  assert.ok(Math.abs(gap(h, { x: 1000, y: 1000 }) - S.HEROES.dart.speed) < 1);
});

// ---------------------------------------------------------------- shooting, teams, PvP

test('shots kill an AI enemy and pay the shooter\'s team', () => {
  const g = arena();
  const h = place(g.heroes[AMBER + DART], MID.x, MID.y);
  S.spawnEnemy(g, 'skitter', 0, MID.x + 150, MID.y);
  const before = g.teams[0].scrap;
  run(g, 1.5, { [AMBER + DART]: { aim: 0, fire: true } });
  assert.equal(g.enemies.length, 0);
  assert.equal(g.teams[0].scrap, before + S.ENEMIES.skitter.bounty);
  assert.equal(h.stats.kills, 1);
  assert.ok(h.ult > 0);
});

test('there is no friendly fire', () => {
  const g = arena();
  const me = place(g.heroes[AMBER + DART], MID.x, MID.y);
  const mate = place(g.heroes[AMBER + PATCH], MID.x + 100, MID.y);
  run(g, 1, { [AMBER + DART]: { aim: 0, fire: true } });
  assert.equal(mate.hp, mate.max);
  assert.equal(me.hp, me.max, 'nor does a hero hit themself');
});

test('a rival hero can be shot down, pays a bounty, and respawns at their own Ember', () => {
  const g = arena();
  const me = place(g.heroes[AMBER + DART], MID.x, MID.y);
  const rival = place(g.heroes[AZURE + COG], MID.x + 100, MID.y);
  const before = g.teams[0].scrap;
  run(g, 6, { [AMBER + DART]: { aim: 0, fire: true } });
  assert.equal(rival.alive, false);
  assert.equal(g.teams[0].scrap, before + S.HERO_BOUNTY);
  assert.equal(me.stats.pvp, 1);
  assert.equal(rival.stats.deaths, 1);
  run(g, S.RESPAWN);
  assert.equal(rival.alive, true);
  assert.equal(rival.hp, rival.max);
  assert.ok(gap(rival, g.teams[1].ember) < 150);
});

test('a Wall stops rival shots and rival heroes but not its owners', () => {
  const g = arena();
  const me = place(g.heroes[AMBER + DART], MID.x, MID.y);
  const wall = S.addStruct(g, 'wall', 1, MID.cx + 2, MID.cy); // Azure's, spans x 1880..1920
  const behind = place(g.heroes[AZURE + PATCH], MID.x + 160, MID.y);
  run(g, 0.5, { [AMBER + DART]: { aim: 0, fire: true } });
  assert.ok(wall.hp < wall.max);
  assert.equal(behind.hp, behind.max);
  run(g, 0.5, { [AZURE + PATCH]: { aim: Math.PI, fire: true } });
  assert.ok(me.hp < me.max, 'the owner shoots out through their own Wall');
  run(g, 2, { [AMBER + DART]: { mx: 1 } });
  assert.ok(me.x < 1880, 'a rival cannot walk in');
  run(g, 2, { [AZURE + PATCH]: { mx: -1 } });
  assert.ok(behind.x < 1880, 'the owner walks through');
});

test('an Ember shrugs off most hero fire', () => {
  const g = arena();
  const az = g.teams[1].ember;
  place(g.heroes[AMBER + DART], az.x - 200, az.y);
  run(g, 1.2, { [AMBER + DART]: { aim: 0, fire: true } }); // 8 shots land: about 70 damage before armour
  const lost = az.max - az.hp;
  assert.ok(lost > 0 && lost < 40, `lost ${lost}`);
});

test('destroying a rival Ember pays out and eliminates that team', () => {
  const g = arena();
  const az = g.teams[1];
  place(g.heroes[AMBER + DART], az.ember.x, az.ember.y - 200); // from the north: no Azure hero stands in that line of fire
  S.addStruct(g, 'wall', 1, 60, 50);
  az.ember.hp = 20;
  const before = g.teams[0].scrap;
  run(g, 2, { [AMBER + DART]: { aim: Math.PI / 2, fire: true } });
  assert.equal(az.alive, false);
  assert.equal(g.teams[0].scrap, before + S.EMBER_BOUNTY);
  assert.ok(g.heroes.slice(AZURE, AZURE + S.TEAM_SIZE).every((h) => h.out && !h.alive));
  assert.equal(g.structs.filter((st) => st.team === 1).length, 0);
  assert.equal(g.phase, 'day');
  assert.equal(g.winner, null);
});

test('AI enemies of a fallen Ember march on the nearest survivor', () => {
  const g = arena();
  const e = S.spawnEnemy(g, 'skitter', 1, 2700, 1800);
  g.teams[1].ember.hp = 0;
  run(g, 0.1);
  assert.equal(e.team, 0);
});

test('the last Ember standing wins', () => {
  const g = arena();
  g.teams[0].ember.hp = 0;
  run(g, DT);
  assert.equal(g.phase, 'day');
  g.teams[2].ember.hp = 0;
  run(g, DT);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 1);
});

test('two last Embers falling together is a draw, and a finished match is frozen', () => {
  const g = arena();
  g.teams[0].ember.hp = 0;
  run(g, DT);
  g.teams[1].ember.hp = 0;
  g.teams[2].ember.hp = 0;
  run(g, DT);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, -1);
  const frozen = JSON.stringify(g);
  run(g, 1, { [AMBER + DART]: { mx: 1, fire: true } });
  assert.equal(JSON.stringify(g), frozen);
});

// ---------------------------------------------------------------- abilities

test('Shockwave hurts, stuns and throws back nearby hostiles, then goes on cooldown', () => {
  const g = arena();
  const anvil = place(g.heroes[AMBER + ANVIL], MID.x, MID.y);
  const e = S.spawnEnemy(g, 'breaker', 0, MID.x + 60, MID.y);
  const rival = place(g.heroes[AZURE + DART], MID.x, MID.y + 80);
  run(g, DT, { [AMBER + ANVIL]: { q: true } });
  assert.ok(e.x > MID.x + 60 + 50);
  assert.ok(e.stun > 0);
  assert.equal(e.hp, e.max - S.HEROES.anvil.q.dmg);
  assert.ok(rival.y > MID.y + 80 + 50);
  assert.equal(rival.hp, rival.max - S.HEROES.anvil.q.dmg);
  run(g, DT, { [AMBER + ANVIL]: { q: true } });
  assert.equal(e.hp, e.max - S.HEROES.anvil.q.dmg, 'no second blast while cooling down');
  assert.ok(anvil.qCd > S.HEROES.anvil.q.cd - 0.1);
});

test('Dash blinks Dart along its movement, but not through a rival Wall', () => {
  const g = arena();
  const h = place(g.heroes[AMBER + DART], MID.x, MID.y);
  run(g, DT, { [AMBER + DART]: { mx: 0, my: -1, q: true } });
  assert.ok(Math.abs(MID.y - h.y - S.HEROES.dart.q.dist) < 5);

  const g2 = arena();
  const h2 = place(g2.heroes[AMBER + DART], MID.x, MID.y);
  S.addStruct(g2, 'wall', 1, MID.cx + 2, MID.cy);
  run(g2, DT, { [AMBER + DART]: { mx: 1, my: 0, q: true } });
  assert.ok(h2.x < 1880);
});

test('a tiny move does not stretch Dash beyond its distance', () => {
  const g = arena();
  const h = place(g.heroes[AMBER + DART], MID.x, MID.y);
  run(g, DT, { [AMBER + DART]: { mx: 5e-324, my: 5e-324, q: true } });
  const went = gap(h, MID);
  assert.ok(Math.abs(went - S.HEROES.dart.q.dist) < 5, `went ${went}`);
});

test('Mend heals teammates in range up to full health, and nobody else', () => {
  const g = arena();
  const patch = place(g.heroes[AMBER + PATCH], MID.x, MID.y);
  const mate = place(g.heroes[AMBER + DART], MID.x + 50, MID.y);
  const rival = place(g.heroes[AZURE + DART], MID.x, MID.y + 50);
  mate.hp = 30;
  rival.hp = 30;
  patch.hp = patch.max - 10;
  run(g, DT, { [AMBER + PATCH]: { q: true } });
  assert.equal(mate.hp, 30 + S.HEROES.patch.q.heal);
  assert.equal(patch.hp, patch.max);
  assert.equal(rival.hp, 30);
  assert.equal(patch.stats.heal, S.HEROES.patch.q.heal + 10);
  assert.ok(patch.ult > 0);
});

test('Sentry drops a free Turret that expires', () => {
  const g = arena();
  place(g.heroes[AMBER + COG], MID.x, MID.y);
  const before = g.teams[0].scrap;
  run(g, DT, { [AMBER + COG]: { q: true } });
  assert.equal(g.structs.length, 1);
  assert.equal(g.structs[0].type, 'turret');
  assert.equal(g.structs[0].team, 0);
  assert.equal(g.teams[0].scrap, before);
  run(g, S.HEROES.cog.q.ttl + 0.1);
  assert.equal(g.structs.length, 0);
});

// ---------------------------------------------------------------- ultimates

test('an ultimate needs a full charge and spends it', () => {
  const g = arena();
  const anvil = g.heroes[AMBER + ANVIL];
  anvil.ult = 99;
  run(g, DT, { [AMBER + ANVIL]: { r: true } });
  assert.equal(anvil.fortify, 0);
  anvil.ult = 100;
  run(g, DT, { [AMBER + ANVIL]: { r: true } });
  assert.ok(anvil.fortify > 0);
  assert.equal(anvil.ult, 0);
});

test('Fortify cuts damage taken by 75%', () => {
  const g = arena();
  const anvil = place(g.heroes[AMBER + ANVIL], MID.x, MID.y);
  anvil.ult = 100;
  run(g, DT, { [AMBER + ANVIL]: { r: true } });
  S.spawnEnemy(g, 'skitter', 0, MID.x + 20, MID.y);
  run(g, 0.2);
  assert.equal(anvil.shieldMax - anvil.shield, S.ENEMIES.skitter.dmg * 0.25);
});

test('Fortify pulls in AI enemies that would otherwise walk past', () => {
  const g = arena();
  const anvil = place(g.heroes[AMBER + ANVIL], MID.x, MID.y);
  const e = S.spawnEnemy(g, 'skitter', 2, MID.x - 200, MID.y); // Jade's Ember lies further left
  run(g, 0.5);
  const ignoring = gap(e, anvil);
  assert.ok(ignoring > 200);
  anvil.ult = 100;
  run(g, 1, { [AMBER + ANVIL]: { r: true } });
  assert.ok(gap(e, anvil) < ignoring - 60);
});

test('Overdrive doubles Dart\'s fire rate', () => {
  const shotsInOneSecond = (overdrive) => {
    const g = arena();
    const h = place(g.heroes[AMBER + DART], MID.x, MID.y);
    if (overdrive) {
      h.ult = 100;
      run(g, DT, { [AMBER + DART]: { r: true } });
    }
    const first = g.nextId;
    run(g, 1, { [AMBER + DART]: { aim: 0, fire: true } });
    return g.nextId - first;
  };
  const normal = shotsInOneSecond(false), fast = shotsInOneSecond(true);
  assert.ok(normal >= 7 && normal <= 9, `normal ${normal}`);
  assert.ok(fast >= 15 && fast <= 17, `overdrive ${fast}`);
});

test('Second Wind revives downed teammates and fully heals the team', () => {
  const g = arena();
  const patch = g.heroes[AMBER + PATCH], downed = g.heroes[AMBER + DART], hurt = g.heroes[AMBER + ANVIL];
  Object.assign(downed, { alive: false, hp: 0, respawn: 5 });
  hurt.hp = 10;
  patch.ult = 100;
  run(g, DT, { [AMBER + PATCH]: { r: true } });
  assert.equal(downed.alive, true);
  assert.equal(downed.hp, downed.max);
  assert.equal(hurt.hp, hurt.max);
  assert.equal(patch.ult, 0, 'its own healing does not recharge it');
});

test('Overclock repairs the team\'s own structures only', () => {
  const g = arena();
  const cog = place(g.heroes[AMBER + COG], MID.x, MID.y);
  const mine = S.addStruct(g, 'wall', 0, MID.cx + 1, MID.cy);
  const theirs = S.addStruct(g, 'wall', 1, MID.cx + 3, MID.cy);
  mine.hp = theirs.hp = 5;
  cog.ult = 100;
  run(g, DT, { [AMBER + COG]: { r: true } });
  assert.equal(mine.hp, mine.max);
  assert.equal(theirs.hp, 5);
});

test('Overclock makes Turrets fire about twice as fast', () => {
  const dealt = (overclock) => {
    const g = arena();
    S.addStruct(g, 'turret', 0, MID.cx, MID.cy);
    const rival = place(g.heroes[AZURE + COG], MID.x + 150, MID.y);
    if (overclock) g.heroes[AMBER + COG].ult = 100;
    run(g, 2, { [AMBER + COG]: { r: true } });
    return rival.max - rival.hp;
  };
  const normal = dealt(false);
  assert.ok(normal > 0);
  assert.ok(dealt(true) >= normal * 1.5);
});

// ---------------------------------------------------------------- scavenging and building

test('holding use next to a wreck for long enough banks its Scrap', () => {
  const g = arena();
  const h = place(g.heroes[AMBER + PATCH], MID.x, MID.y);
  g.wrecks.push({ id: 9001, x: MID.x + 20, y: MID.y, scrap: 25 });
  const before = g.teams[0].scrap;
  run(g, S.SCAV_TIME - 0.2, { [AMBER + PATCH]: { use: true } });
  assert.equal(g.wrecks.length, 1);
  run(g, 0.3, { [AMBER + PATCH]: { use: true } });
  assert.equal(g.wrecks.length, 0);
  assert.equal(g.teams[0].scrap, before + 25);
  assert.equal(h.stats.scrap, 25);
});

test('letting go of use, or standing too far away, banks nothing', () => {
  const g = arena();
  place(g.heroes[AMBER + PATCH], MID.x, MID.y);
  g.wrecks.push({ id: 9001, x: MID.x + 20, y: MID.y, scrap: 25 });
  run(g, 1, { [AMBER + PATCH]: { use: true } });
  run(g, 0.1);
  run(g, 1, { [AMBER + PATCH]: { use: true } });
  assert.equal(g.wrecks.length, 1);

  g.wrecks[0].x = MID.x + S.SCAV_RANGE + 30;
  run(g, 3, { [AMBER + PATCH]: { use: true } });
  assert.equal(g.wrecks.length, 1);
});

test('Dart scavenges twice as fast', () => {
  const g = arena();
  place(g.heroes[AMBER + DART], MID.x, MID.y);
  g.wrecks.push({ id: 9001, x: MID.x + 20, y: MID.y, scrap: 25 });
  run(g, S.SCAV_TIME / 2 + 0.1, { [AMBER + DART]: { use: true } });
  assert.equal(g.wrecks.length, 0);
});

test('building spends Scrap and is refused when a rule is broken', () => {
  const g = arena();
  const me = AMBER + ANVIL;
  const h = place(g.heroes[me], MID.x, MID.y);
  const T = g.teams[0];
  T.scrap = 100;
  run(g, DT, { [me]: { build: { type: 'wall', cx: MID.cx + 1, cy: MID.cy } } });
  assert.equal(T.scrap, 100 - S.STRUCTS.wall.cost);
  assert.equal(g.structs.length, 1);

  const why = (type, cx, cy) => S.canBuild(g, me, type, cx, cy);
  assert.equal(why('wall', MID.cx + 2, MID.cy), null);
  assert.equal(why('turret', MID.cx + 1, MID.cy), 'occupied');
  assert.equal(why('wall', MID.cx + 12, MID.cy), 'range');
  assert.equal(why('constructor', MID.cx + 2, MID.cy), 'type');
  assert.equal(why('wall', MID.cx + 0.5, MID.cy), 'bounds');
  assert.equal(why('wall', -1, MID.cy), 'bounds');
  S.spawnEnemy(g, 'skitter', 0, MID.x + 3 * S.CELL, MID.y).stun = 100;
  assert.equal(why('wall', MID.cx + 3, MID.cy), 'unit', 'no walling an enemy in place');
  assert.equal(why('spikes', MID.cx + 3, MID.cy), null);
  T.scrap = 5;
  assert.equal(why('wall', MID.cx + 2, MID.cy), 'scrap');
  T.scrap = 100;

  place(h, T.ember.x + 100, T.ember.y);
  assert.equal(why('wall', T.ember.x / S.CELL, T.ember.y / S.CELL), 'ember');

  const az = g.teams[1].ember;
  place(h, az.x - 300, az.y);
  const near = { type: 'wall', cx: Math.floor(h.x / S.CELL) + 1, cy: Math.floor(h.y / S.CELL) };
  assert.equal(why(near.type, near.cx, near.cy), 'rival');
  run(g, DT, { [me]: { build: near } });
  assert.equal(T.scrap, 100, 'a refused order costs nothing');
  assert.equal(g.structs.length, 1);
});

test('Cog builds for 25% less', () => {
  const g = arena();
  place(g.heroes[AMBER + COG], MID.x, MID.y);
  g.teams[0].scrap = 100;
  run(g, DT, { [AMBER + COG]: { build: { type: 'turret', cx: MID.cx + 1, cy: MID.cy } } });
  assert.equal(g.teams[0].scrap, 100 - S.STRUCTS.turret.cost * 0.75);
});

test('removing your own structure refunds half its cost, scaled by its health', () => {
  const g = arena();
  place(g.heroes[AMBER + ANVIL], MID.x, MID.y);
  place(g.heroes[AZURE + COG], MID.x, MID.y + 40);
  const T = g.teams[0];
  const whole = S.addStruct(g, 'wall', 0, MID.cx + 1, MID.cy);
  const dented = S.addStruct(g, 'wall', 0, MID.cx + 2, MID.cy);
  dented.hp = dented.max / 2;

  run(g, DT, { [AZURE + COG]: { remove: { cx: whole.cx, cy: whole.cy } } });
  assert.equal(g.structs.length, 2, 'a rival cannot remove it');

  const before = T.scrap;
  run(g, DT, { [AMBER + ANVIL]: { remove: { cx: whole.cx, cy: whole.cy } } });
  assert.equal(T.scrap, before + S.STRUCTS.wall.cost / 2);
  run(g, DT, { [AMBER + ANVIL]: { remove: { cx: dented.cx, cy: dented.cy } } });
  assert.equal(T.scrap, before + S.STRUCTS.wall.cost / 2 + Math.floor(S.STRUCTS.wall.cost / 4));
  assert.equal(g.structs.length, 0);
});

// ---------------------------------------------------------------- AI enemies and fortifications

test('AI enemies walk round to a gap rather than chew through a Wall', () => {
  const g = arena();
  strandAmber(g);
  const walls = ringAroundAmber(g, true);
  const em = g.teams[0].ember;
  S.spawnEnemy(g, 'skitter', 0, em.x, em.y + 560);
  run(g, 25);
  assert.ok(em.hp < em.max, 'the enemy reached the Ember');
  assert.ok(walls.every((w) => w.hp === w.max), 'no Wall was attacked');
});

test('AI enemies break through when a base is sealed', () => {
  const g = arena();
  strandAmber(g);
  const walls = ringAroundAmber(g, false);
  const em = g.teams[0].ember;
  S.spawnEnemy(g, 'skitter', 0, em.x, em.y + 560);
  run(g, 25);
  assert.equal(em.hp, em.max);
  assert.ok(walls.some((w) => w.hp < w.max));
});

test('AI enemies that reach an Ember damage it', () => {
  const g = arena();
  strandAmber(g);
  const em = g.teams[0].ember;
  S.spawnEnemy(g, 'skitter', 0, em.x + 150, em.y);
  run(g, 3);
  assert.ok(em.hp < em.max);
});

test('a Turret shoots rival heroes and AI enemies, never teammates', () => {
  const g = arena();
  S.addStruct(g, 'turret', 0, MID.cx, MID.cy);
  const mate = place(g.heroes[AMBER + DART], MID.x + 60, MID.y);
  const rival = place(g.heroes[AZURE + COG], MID.x - 120, MID.y);
  const e = S.spawnEnemy(g, 'breaker', 2, MID.x, MID.y + 200);
  e.stun = 100;
  run(g, 1.5);
  assert.ok(rival.hp < rival.max);
  assert.equal(mate.hp, mate.max);
  Object.assign(rival, { alive: false, respawn: 1e9 });
  run(g, 1.5);
  assert.ok(e.hp < e.max);
});

test('Spikes hurt AI enemies and rival heroes standing on them, then wear out', () => {
  const g = arena();
  const spikes = S.addStruct(g, 'spikes', 0, MID.cx, MID.cy);
  const e = S.spawnEnemy(g, 'breaker', 2, MID.x, MID.y);
  e.stun = 100;
  const rival = place(g.heroes[AZURE + COG], MID.x + 5, MID.y + 5);
  const mate = place(g.heroes[AMBER + DART], MID.x - 5, MID.y - 5);
  run(g, 1);
  assert.ok(e.hp < e.max);
  assert.ok(rival.hp < rival.max);
  assert.equal(mate.hp, mate.max);
  assert.ok(spikes.hp < spikes.max);
  run(g, 20);
  assert.equal(g.structs.length, 0);
});

// ---------------------------------------------------------------- day and night

test('when the day runs out, night sends an equal pack at every living Ember', () => {
  const g = S.createGame(3);
  g.timer = 0.05;
  run(g, 0.1);
  assert.equal(g.phase, 'night');
  assert.equal(g.wave, 1);
  const per = [0, 0, 0];
  for (const sp of g.spawn) per[sp.team]++;
  assert.ok(per[0] > 0);
  assert.deepEqual(per, [per[0], per[0], per[0]]);
});

test('clearing the night brings dawn: Walls repaired, fresh wrecks, Embers not healed', () => {
  const g = S.createGame(3);
  g.timer = 0.05;
  run(g, 0.1);
  const wall = S.addStruct(g, 'wall', 0, MID.cx, MID.cy);
  wall.hp = 10;
  g.teams[0].ember.hp = 900;
  g.spawn = [];
  g.enemies = [];
  g.wrecks = [];
  run(g, DT);
  assert.equal(g.phase, 'day');
  assert.equal(wall.hp, wall.max);
  assert.ok(g.wrecks.length > 10);
  assert.equal(g.teams[0].ember.hp, 900);
  assert.ok(Math.abs(g.timer - S.DAY_LENGTH) < 0.1);
});

// ---------------------------------------------------------------- engine guarantees

test('the same seed and inputs always produce the same match', () => {
  const script = (g) => ({
    [AMBER + DART]: { mx: Math.cos(g.t), my: Math.sin(g.t), aim: g.t, fire: true },
    [AZURE + COG]: { mx: -1, my: -1, aim: 4, fire: true, q: true },
    [JADE + COG]: { q: true, build: { type: 'wall', cx: 25, cy: 60 } },
  });
  const play = (seed) => {
    const g = S.createGame(seed);
    g.timer = 3;
    return JSON.stringify(run(g, 15, script));
  };
  assert.equal(play(7), play(7));
  assert.notEqual(play(7), play(8));
});

test('garbage input cannot corrupt the match', () => {
  const g = arena();
  const junk = {
    0: 'lol',
    1: { mx: NaN, my: Infinity, aim: 'x', fire: 1, build: { type: 'wall', cx: 1e9, cy: NaN }, remove: 7 },
    2: null,
    3: { q: 1, r: {}, build: 'x', remove: { cx: 'a' } },
  };
  run(g, 0.5, junk);
  const numbers = g.heroes.flatMap((h) => [h.x, h.y, h.aim, h.hp]);
  assert.ok(numbers.every(Number.isFinite));
  assert.ok(g.teams.every((t) => Number.isInteger(t.scrap) && t.scrap >= 0));
});

test('a snapshot is JSON for the client, with a count in place of the spawn queue', () => {
  const g = S.createGame(1);
  g.timer = 0.01;
  run(g, 0.1);
  const snap = JSON.parse(S.snapshot(g));
  assert.equal(snap.heroes.length, 15);
  assert.equal(snap.spawn, undefined);
  assert.equal(snap.pending, g.spawn.length);
  assert.ok(snap.pending > 0);
  assert.ok(!S.snapshot(Object.assign(g, { onlyEclipse: 'volatile' })).includes('onlyEclipse'), 'what the balance harness sets on a match is not sent either');
});

test('a ping stands on the caller\'s team for eight seconds; a hero that is down can make one; nothing else is taken for one', () => {
  const g = arena(), dart = g.heroes[AMBER + DART];
  assert.ok(g.teams.every((T) => !('ping' in T)), 'a new match has none, so none is in the snapshot');
  run(g, DT, { [dart.i]: { ping: 'core' } });
  assert.deepEqual([g.teams[0].ping.kind, Math.round(g.teams[0].ping.ttl)], ['core', S.PING_TTL]);
  assert.ok(!('ping' in g.teams[1]) && !('ping' in g.teams[2]), 'only its own team');
  run(g, 5);
  Object.assign(dart, { alive: false, hp: 0, respawn: 100 });
  run(g, DT, { [dart.i]: { ping: 'raid' } });
  assert.deepEqual([g.teams[0].ping.kind, Math.round(g.teams[0].ping.ttl)], ['raid', S.PING_TTL], 'a new call takes the old one\'s place, with its own eight seconds');
  run(g, S.PING_TTL);
  assert.ok(!('ping' in g.teams[0]), 'and then it is gone from the state, not left there empty');
  for (const junk of ['attack', 7, true, null, {}, ['core']]) run(g, DT, { [dart.i]: { ping: junk } });
  assert.ok(!('ping' in g.teams[0]), 'only the three known calls count');
});

// ---------------------------------------------------------------- Anvil's shield

test('only Anvil carries a shield, and it soaks damage before health does', () => {
  const g = arena();
  assert.deepEqual(g.heroes.slice(0, 4).map((h) => h.shieldMax), [S.HEROES.anvil.shield.max, 0, 0, 0]);
  const anvil = place(g.heroes[AMBER + ANVIL], MID.x, MID.y);
  S.spawnEnemy(g, 'skitter', 0, MID.x + 20, MID.y);
  run(g, 0.2);
  assert.equal(anvil.shield, anvil.shieldMax - S.ENEMIES.skitter.dmg);
  assert.equal(anvil.hp, anvil.max);
});

test('a hit bigger than the shield spills into health', () => {
  const g = arena();
  const anvil = place(g.heroes[AMBER + ANVIL], MID.x, MID.y);
  Object.assign(anvil, { shield: 3, shieldCd: 1 }); // hit a moment ago, so not refilling
  S.spawnEnemy(g, 'skitter', 0, MID.x + 20, MID.y);
  run(g, 0.2);
  assert.equal(anvil.shield, 0);
  assert.equal(anvil.hp, anvil.max - (S.ENEMIES.skitter.dmg - 3));
});

test('the shield refills only after a spell without taking damage', () => {
  const g = arena();
  const anvil = place(g.heroes[AMBER + ANVIL], MID.x, MID.y);
  const { delay, rate } = S.HEROES.anvil.shield;
  S.spawnEnemy(g, 'skitter', 0, MID.x + 20, MID.y);
  run(g, 0.2);
  g.enemies = [];
  anvil.shield = 0;
  run(g, delay - 0.5);
  assert.equal(anvil.shield, 0, 'still waiting');
  run(g, 1.5);
  assert.ok(Math.abs(anvil.shield - rate) < rate * 0.4, `about one second of refill, got ${anvil.shield}`);
  run(g, 10);
  assert.equal(anvil.shield, anvil.shieldMax, 'and it stops at full');
});

test('a respawned Anvil comes back with a full shield', () => {
  const g = arena();
  const anvil = g.heroes[AMBER + ANVIL];
  Object.assign(anvil, { alive: false, hp: 0, shield: 0, respawn: 0.1 });
  run(g, 0.2);
  assert.equal(anvil.alive, true);
  assert.equal(anvil.shield, anvil.shieldMax);
});

test('a match keeps one colour mood from start to finish, and seeds in a row take each mood in turn', () => {
  const g = S.createGame(7);
  const mood = g.mood;
  for (let n = 0; n < 600; n++) S.step(g, [], DT);
  assert.equal(g.mood, mood);
  assert.deepEqual([7, 8, 9].map((seed) => S.createGame(seed).mood).sort(), [0, 1, 2]);
});

// ---------------------------------------------------------------- Shield Generator and Forge

test('a Shield Generator, once built, gives friendly heroes in its field a barrier that soaks damage', () => {
  const g = arena(), D = S.STRUCTS.shield;
  const dart = place(g.heroes[AMBER + DART], MID.x, MID.y);
  const rival = place(g.heroes[AZURE + DART], MID.x + 40, MID.y + 40);
  const far = place(g.heroes[AMBER + PATCH], MID.x + 40 + D.radius + 20, MID.y);
  S.addStruct(g, 'shield', 0, MID.cx + 1, MID.cy); // one cell east: 40 from dart and rival, just out of reach of far
  run(g, D.buildTime - 0.5);
  assert.equal(dart.shieldMax, 0, 'nothing while it is still being built');
  run(g, 0.5 + D.absorb / D.rate + 0.1);
  assert.equal(dart.shield, D.absorb, 'the barrier fills');
  assert.equal(rival.shieldMax, 0, 'a rival in the field gets nothing');
  assert.equal(far.shieldMax, 0, 'nor does a teammate outside it');

  S.spawnEnemy(g, 'skitter', 0, MID.x - 20, MID.y);
  run(g, 0.2);
  assert.equal(dart.shield, D.absorb - S.ENEMIES.skitter.dmg);
  assert.equal(dart.hp, dart.max, 'the barrier took the hit');

  g.enemies = [];
  place(dart, MID.x - 300, MID.y);
  run(g, DT);
  assert.deepEqual([dart.shieldMax, dart.shield], [0, 0], 'walking out of the field drops the barrier');
});

test('a Forge carries the same field: teammates beside it gain the barrier until it goes down', () => {
  const g = arena(), D = S.STRUCTS.shield;
  const forge = place(g.heroes[AMBER + FORGE], MID.x, MID.y);
  const mate = place(g.heroes[AMBER + DART], MID.x + 50, MID.y);
  const rival = place(g.heroes[AZURE + DART], MID.x - 50, MID.y);
  run(g, DT);
  assert.deepEqual([forge.shieldMax, mate.shieldMax, rival.shieldMax], [D.absorb, D.absorb, 0]);
  Object.assign(forge, { alive: false, hp: 0, respawn: 5 });
  run(g, DT);
  assert.equal(mate.shieldMax, 0);
});

test('Reforge repairs the team\'s own structures in reach, and is not spent when nothing needs it', () => {
  const g = arena(), q = S.HEROES.forge.q, me = AMBER + FORGE;
  const forge = place(g.heroes[me], MID.x, MID.y);
  const wall = S.addStruct(g, 'wall', 0, MID.cx + 2, MID.cy), far = S.addStruct(g, 'wall', 0, MID.cx + 8, MID.cy);
  const theirs = S.addStruct(g, 'wall', 1, MID.cx - 2, MID.cy);
  run(g, DT, { [me]: { q: true } });
  assert.equal(forge.qCd, 0, 'nothing damaged: the cooldown is kept');
  for (const st of [wall, far, theirs]) st.hp = 50;
  run(g, DT, { [me]: { q: true } });
  assert.deepEqual([wall.hp, far.hp, theirs.hp], [50 + q.repair, 50, 50], 'only its own team\'s, only in reach');
  assert.equal(forge.qCd, q.cd);
  assert.ok(forge.ult > 0, 'repairing charges Aegis');
});

test('the burst of a hero\'s Q or R names its hero, so that hero\'s client can tell it from a teammate\'s', () => {
  const g = arena(), me = AMBER + ANVIL;
  place(g.heroes[me], MID.x, MID.y).ult = 100;
  run(g, DT, { [me]: { q: true, r: true } });
  assert.deepEqual(g.fx.map((f) => [f.kind, f.owner]), [['ring', me], ['ult', me]]);
  g.fx.length = 0;
  S.spawnEnemy(g, 'skitter', 0, MID.x + 120, MID.y).hp = 0.1;
  g.heroes[me].aim = 0;
  for (let k = 0; k < 60 && !g.fx.length; k++) run(g, DT, { [me]: { fire: true, aim: 0 } });
  assert.ok(g.fx.length && g.fx.every((f) => !('owner' in f)), 'nothing else carries one: it would only be bytes in every snapshot');
});

test('canCast, heroSpeed and heroFireMult say what step itself will do (the client predicts by them)', () => {
  const g = arena(), anvil = place(g.heroes[AMBER + ANVIL], MID.x, MID.y), forge = place(g.heroes[AMBER + FORGE], MID.x, MID.y);
  assert.equal(S.canCast(g, anvil, 'q'), true);
  assert.equal(S.canCast(g, anvil, 'r'), false, 'no charge yet');
  anvil.ult = 100;
  assert.equal(S.canCast(g, anvil, 'r'), true);
  anvil.qCd = 2;
  assert.equal(S.canCast(g, anvil, 'q'), false, 'cooling down');
  Object.assign(anvil, { qCd: 0, stun: 0.5 });
  assert.deepEqual([S.canCast(g, anvil, 'q'), S.canCast(g, anvil, 'r')], [false, false], 'stunned');
  Object.assign(anvil, { stun: 0, alive: false });
  assert.deepEqual([S.canCast(g, anvil, 'q'), S.canCast(g, anvil, 'r')], [false, false], 'down');

  const wall = S.addStruct(g, 'wall', 0, MID.cx + 2, MID.cy);
  assert.equal(S.canCast(g, forge, 'q'), false, 'Reforge with nothing to mend');
  wall.hp -= 1;
  assert.equal(S.canCast(g, forge, 'q'), true);
  assert.equal(S.canCast(g, { ...forge, x: forge.x + 2000 }, 'q'), false, 'asked of another spot: out of reach');

  const dart = g.heroes[AMBER + DART];
  assert.equal(S.heroSpeed(dart), S.HEROES.dart.speed);
  assert.equal(S.heroFireMult(dart), 1);
  Object.assign(dart, { rush: 1, overdrive: 1 });
  assert.equal(S.heroSpeed(dart), S.HEROES.dart.speed * S.POWERUPS.rush.speed);
  assert.equal(S.heroFireMult(dart), S.HEROES.dart.r.mult);
});

test('Triage: a Patch walks a fifth faster towards an injured teammate, and no faster otherwise', () => {
  const g = arena(), T = S.HEROES.patch.triage, base = S.HEROES.patch.speed;
  const patch = place(g.heroes[AMBER + PATCH], MID.x, MID.y), mate = place(g.heroes[AMBER + COG], MID.x + 200, MID.y);
  assert.equal(S.heroSpeed(patch, g, 1, 0), base, 'nobody is hurt');
  mate.hp = mate.max * T.below - 1;
  assert.equal(S.heroSpeed(patch, g, 1, 0), base * T.speed, 'straight at a teammate under half health');
  assert.equal(S.heroSpeed(patch, g, -1, 0), base, 'walking straight away from them');
  assert.equal(S.heroSpeed(patch, g, 0, 1), base, 'or across: circling is not going to them');
  assert.equal(S.heroSpeed(patch, g, 0.5, 0.3), base * T.speed, 'a little off the line still is, and at any pace');
  assert.equal(S.heroSpeed({ ...patch, x: mate.x + 200 }, g, -1, 0), base * T.speed, 'asked of a copy standing elsewhere, as the client asks: it is the way from there that counts');
  Object.assign(mate, { alive: false, hp: 0 });
  assert.equal(S.heroSpeed(patch, g, 1, 0), base, 'a teammate who is down is not a patient');
  Object.assign(mate, { alive: true, hp: mate.max * T.below - 1 });
  assert.equal(S.heroSpeed(patch, g, 0, 0), base, 'standing still');
  assert.equal(S.heroSpeed(patch), base, 'asked without the match and the move, it is the plain speed as before');
  assert.equal(S.heroSpeed(g.heroes[AMBER + DART], g, 1, 0), S.HEROES.dart.speed, 'only the Patch has it');
  const rival = place(g.heroes[AZURE + COG], MID.x - 200, MID.y);
  rival.hp = 1;
  assert.equal(S.heroSpeed(patch, g, -1, 0), base, 'a hurt rival is nobody\'s patient');
  run(g, 0.5, { [patch.i]: { mx: 1, my: 0 } });
  assert.ok(Math.abs(patch.x - (MID.x + base * T.speed * 0.5)) < 0.01, 'and step moves it by that speed');
});

test('Aegis halves the damage the whole team takes, for as long as it lasts', () => {
  const g = arena(), r = S.HEROES.forge.r, bite = S.ENEMIES.skitter.dmg;
  const dart = place(g.heroes[AMBER + DART], MID.x, MID.y);
  const hitTaken = () => {
    dart.hp = dart.max;
    S.spawnEnemy(g, 'skitter', 0, MID.x + 20, MID.y);
    run(g, 0.2);
    g.enemies = [];
    return dart.max - dart.hp;
  };
  g.heroes[AMBER + FORGE].ult = 100;
  run(g, DT, { [AMBER + FORGE]: { r: true } }); // from its post, far from the Dart
  assert.equal(hitTaken(), bite * r.taken);
  run(g, r.time);
  assert.equal(hitTaken(), bite, 'full damage again once it runs out');
});

test('shotHit names what a shot has run into: a rival Wall but not its own team\'s, an AI enemy, a rival hero', () => {
  const g = S.createGame(1), shot = (team, x, y) => ({ x, y, team });
  const wall = S.addStruct(g, 'wall', 0, 40, 40);
  assert.equal(S.shotHit(g, shot(0, wall.x, wall.y)), null, 'a team shoots through its own Walls');
  assert.equal(S.shotHit(g, shot(1, wall.x, wall.y)).st, wall);
  assert.equal(S.shotHit(g, shot(-1, wall.x, wall.y)).st, wall, 'AI shots are stopped by everyone\'s');
  const e = S.spawnEnemy(g, 'skitter', 0, 1500, 1500);
  assert.equal(S.shotHit(g, shot(0, 1505, 1500)).e, e);
  assert.equal(S.shotHit(g, shot(-1, 1505, 1500)), null, 'AI shots pass AI enemies');
  const rival = g.heroes[AZURE];
  assert.equal(S.shotHit(g, shot(0, rival.x, rival.y)).h, rival);
  assert.equal(S.shotHit(g, shot(1, rival.x, rival.y)), null, 'no friendly fire');
  assert.equal(S.shotHit(g, shot(0, g.teams[2].ember.x, g.teams[2].ember.y)).ember, 2);
});

test('endless mode plays on with one Ember left, and ends when it falls with the last to fall as winner', () => {
  const g = arena();
  g.endless = true;
  g.teams[0].ember.hp = 0;
  g.teams[2].ember.hp = 0;
  run(g, DT);
  assert.equal(g.phase, 'day', 'one Ember left: not over');
  S.startNight(g);
  assert.ok(g.spawn.every((sp) => sp.team === 1) && g.spawn.length > 0, 'the nights keep coming, for the team that is left');
  g.teams[1].ember.hp = 0;
  run(g, DT);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 1);

  const draw = arena();
  draw.endless = true;
  for (const T of draw.teams) T.ember.hp = 0;
  run(draw, DT);
  assert.equal(draw.phase, 'over');
  assert.equal(draw.winner, -1, 'all falling together is a draw');
});

test('endless mode climbs in difficulty at a gentler pace, night for night', () => {
  const night5 = (endless) => {
    const g = arena();
    g.endless = endless;
    g.wave = 4;
    S.startNight(g);
    return { pack: g.spawn.length, hp: S.spawnEnemy(g, 'skitter', 0, 1500, 1500).max, dmg: S.enemyDmg(g, 'skitter') };
  };
  const normal = night5(false), endless = night5(true), first = S.ENEMIES.skitter;
  assert.ok(endless.pack < normal.pack && endless.hp < normal.hp && endless.dmg < normal.dmg, 'easier than a normal fifth night');
  assert.ok(endless.hp > first.hp && endless.dmg > first.dmg, 'but harder than the first');
});

test('dash, which the client borrows to predict its own, blinks the way the hero moves or else the way it aims', () => {
  const g = S.createGame(1), h = { x: 1800, y: 1500, aim: Math.PI / 2, team: 0 }, far = S.HEROES.dart.q.dist;
  S.dash(g, h, 1, 0);
  assert.ok(Math.abs(h.x - (1800 + far)) < 1e-6 && h.y === 1500);
  S.dash(g, h, 0, 0);
  assert.ok(Math.abs(h.y - (1500 + far)) < 1e-6, 'standing still: along the aim');
  const wall = S.addStruct(g, 'wall', 1, Math.floor(h.x / S.CELL) + 2, Math.floor(h.y / S.CELL));
  S.dash(g, h, 1, 0);
  assert.ok(h.x < wall.x - S.CELL / 2, 'a rival Wall stops it');
});

// ---------------------------------------------------------------- tier-2 upgrades

test('ordering the same structure again on your own upgrades it once, for its cost again, with half as much more health', () => {
  const g = arena();
  const me = AMBER + ANVIL, T = g.teams[0], cell = { cx: MID.cx + 2, cy: MID.cy };
  place(g.heroes[me], MID.x, MID.y);
  T.scrap = 200;
  const order = (type, who = me) => run(g, DT, { [who]: { build: { type, ...cell } } });
  order('turret');
  const st = g.structs[0], sv = g.sv;
  st.hp = 10;
  assert.equal(S.canBuild(g, me, 'wall', cell.cx, cell.cy), 'occupied', 'a different structure is not an upgrade');
  place(g.heroes[AZURE + ANVIL], MID.x, MID.y + 60);
  assert.equal(S.canBuild(g, AZURE + ANVIL, 'turret', cell.cx, cell.cy), 'occupied', 'nor is a rival\'s order');
  T.scrap = S.STRUCTS.turret.cost - 1;
  assert.equal(S.canBuild(g, me, 'turret', cell.cx, cell.cy), 'scrap');
  T.scrap = 100;
  order('turret');
  assert.deepEqual([g.structs.length, st.tier, st.max, st.hp, T.scrap, g.sv], [1, 2, S.STRUCTS.turret.hp * 1.5, S.STRUCTS.turret.hp * 1.5, 100 - S.STRUCTS.turret.cost, sv], 'the same structure, mended and tougher; nothing was added, so no rebuild of the cache');
  order('turret');
  assert.deepEqual([S.canBuild(g, me, 'turret', cell.cx, cell.cy), st.max, T.scrap], ['occupied', 225, 60], 'only once');
  run(g, DT, { [me]: { remove: cell } });
  assert.equal(T.scrap, 60 + S.STRUCTS.turret.cost, 'removing it gives back half of both payments');
});

test('a structure still being built, and a Sentry, cannot be upgraded', () => {
  const g = arena();
  const me = AMBER + COG, T = g.teams[0];
  place(g.heroes[me], MID.x, MID.y);
  T.scrap = 500;
  run(g, DT, { [me]: { build: { type: 'shield', cx: MID.cx + 2, cy: MID.cy } } });
  assert.equal(S.canBuild(g, me, 'shield', MID.cx + 2, MID.cy), 'occupied', 'not until it works');
  run(g, S.STRUCTS.shield.buildTime + DT);
  assert.equal(S.canBuild(g, me, 'shield', MID.cx + 2, MID.cy), null);
  run(g, DT, { [me]: { q: true } });
  const sentry = g.structs.find((st) => st.ttl > 0);
  assert.equal(S.canBuild(g, me, 'turret', sentry.cx, sentry.cy), 'occupied');
});

test('an upgraded Turret, Spikes and Shield Generator each do half as much more', () => {
  const g = arena();
  const me = AMBER + DART, h = place(g.heroes[me], MID.x, MID.y), T = g.teams[0];
  T.scrap = 1000;
  const twice = (type, cx) => {
    run(g, DT, { [me]: { build: { type, cx, cy: MID.cy } } });
    run(g, 3); // a Shield Generator takes two seconds to build
    run(g, DT, { [me]: { build: { type, cx, cy: MID.cy } } });
    return g.structs.find((st) => st.cx === cx);
  };
  assert.equal(h.shieldMax, 0);
  assert.equal(twice('shield', MID.cx + 1).tier, 2);
  run(g, DT);
  assert.equal(h.shieldMax, S.STRUCTS.shield.absorb * 1.5, 'the field of an upgraded generator lends a barrier of 75');

  const spikes = twice('spikes', MID.cx + 4), turret = twice('turret', MID.cx - 2);
  const foe = S.spawnEnemy(g, 'breaker', 0, spikes.x, spikes.y);
  foe.stun = 100;
  const before = foe.hp;
  run(g, DT);
  assert.ok(Math.abs(before - foe.hp - S.STRUCTS.spikes.dps * 1.5 * DT) < 1e-9, 'Spikes cut half as deep again');
  run(g, 0.2);
  const shot = g.shots.find((sh) => sh.owner === -1 && sh.team === 0);
  assert.equal(shot.dmg, S.STRUCTS.turret.dmg * 1.5, `the Turret (tier ${turret.tier}) hits half as hard again`);
});

// ---------------------------------------------------------------- Eclipses

test('every third night falls under an Eclipse, never the same one twice running, and it lifts at dawn', () => {
  const nights = (g, n) => {
    const seen = [];
    for (let k = 1; k <= n; k++) {
      S.startNight(g);
      seen.push(g.eclipse);
      g.spawn = [];
      S.startDay(g);
      assert.equal(g.eclipse, null, 'dawn lifts it');
    }
    return seen;
  };
  const seen = nights(arena(7), 36);
  seen.forEach((id, k) => assert.equal(id !== null, (k + 1) % 3 === 0, `night ${k + 1}`));
  const had = seen.filter(Boolean);
  assert.ok(had.every((id) => S.ECLIPSE_IDS.includes(id)));
  assert.ok(had.every((id, k) => id !== had[k - 1]), `no two running the same: ${had}`);
  assert.equal(new Set(had).size, 4, 'and in twelve Eclipses all four come up');
  assert.deepEqual(S.ECLIPSE_IDS, ['blood_moon', 'iron_tide', 'ash_storm', 'volatile']);

  const endless = nights(Object.assign(arena(7), { endless: true }), 16).map((id) => id !== null);
  assert.deepEqual(endless.slice(8), [true, false, false, true, false, true, true, true], 'endless mode: nights 9, 12, 14, 15 and 16 of 9 to 16');
});

test('a match told to play one Eclipse has it on every Eclipse night, and no match is told so unless something sets it', () => {
  assert.ok(!('onlyEclipse' in S.createGame(1)), 'not a field of a match as it is made, so not in the snapshot');
  const g = Object.assign(arena(), { onlyEclipse: 'volatile', wave: 2 }), seen = [];
  for (let night = 3; night <= 8; night++) {
    S.startNight(g);
    seen.push(g.eclipse);
    S.startDay(g);
  }
  assert.deepEqual(seen, ['volatile', null, null, 'volatile', null, null], 'nights 3 and 6: the same one twice running, which the game by itself never does');
});

test('Blood Moon: AI enemies move a quarter faster and pick up heroes from 60% further off', () => {
  const walked = (eclipse) => {
    const g = Object.assign(arena(), { eclipse });
    const e = S.spawnEnemy(g, 'skitter', 0, MID.x, MID.y);
    run(g, 1);
    return gap(e, MID);
  };
  assert.ok(Math.abs(walked('blood_moon') / walked(null) - 1.25) < 1e-6);

  const chases = (eclipse) => {
    const g = Object.assign(arena(), { eclipse });
    const e = S.spawnEnemy(g, 'skitter', 0, MID.x, MID.y);
    const hero = place(g.heroes[JADE + DART], MID.x, MID.y + S.AGGRO * 1.5); // away from the way to Amber's Ember
    const before = gap(e, hero);
    run(g, 0.5);
    return gap(e, hero) < before - 20;
  };
  assert.deepEqual([chases(null), chases('blood_moon')], [false, true]);
});

test('Iron Tide: twice the Breakers, and AI enemies hit structures a quarter harder but Embers as before', () => {
  let tides = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const g = arena(seed);
    g.wave = 2;
    S.startNight(g);
    const breakers = g.spawn.filter((sp) => sp.team === 0 && sp.type === 'breaker').length;
    assert.equal(breakers, g.eclipse === 'iron_tide' ? 4 : 2, `seed ${seed}, ${g.eclipse}`);
    tides += g.eclipse === 'iron_tide';
  }
  assert.ok(tides > 0, 'some seed gave an Iron Tide');

  const slammed = (eclipse) => {
    const g = Object.assign(arena(), { eclipse });
    const wall = S.addStruct(g, 'wall', 0, MID.cx + 2, MID.cy);
    S.spawnEnemy(g, 'colossus', 0, MID.x, MID.y).slam = DT / 2; // its ground-slam goes off on the first tick
    run(g, DT);
    return wall.max - wall.hp;
  };
  const slam = S.ENEMIES.colossus.dmg * S.ENEMIES.colossus.structMult;
  assert.deepEqual([slammed(null), slammed('iron_tide')], [slam, slam * 1.25]);

  const g = Object.assign(arena(), { eclipse: 'iron_tide' }), em = g.teams[0].ember;
  strandAmber(g);
  S.spawnEnemy(g, 'skitter', 0, em.x + S.EMBER_R + 12, em.y);
  run(g, 0.1);
  assert.equal(em.max - em.hp, S.ENEMIES.skitter.dmg, 'the Ember takes the usual bite');
});

test('Ash Storm: Turrets see three quarters as far, and AI enemies come with a shield that goes before their health', () => {
  const fires = (eclipse, away) => {
    const g = Object.assign(arena(), { eclipse });
    S.addStruct(g, 'turret', 0, MID.cx, MID.cy);
    S.spawnEnemy(g, 'breaker', 0, MID.x + away, MID.y).stun = 100;
    run(g, 0.5);
    return g.shots.length > 0;
  };
  const range = S.STRUCTS.turret.range;
  assert.deepEqual([fires(null, range * 0.9), fires('ash_storm', range * 0.9), fires('ash_storm', range * 0.7)], [true, false, true]);

  const g = Object.assign(arena(), { eclipse: 'ash_storm' });
  const spikes = S.addStruct(g, 'spikes', 0, MID.cx, MID.cy);
  const e = S.spawnEnemy(g, 'breaker', 0, spikes.x, spikes.y);
  e.stun = 100;
  assert.equal(e.shield, 26, 'on a first night, the shield in the table');
  run(g, 0.5);
  assert.ok(Math.abs(e.shield - 11) < 1e-6 && e.hp === e.max, `after 15 damage: shield ${e.shield}, health ${e.hp} of ${e.max}`);
  run(g, 1);
  assert.ok(!('shield' in e) && Math.abs(e.max - e.hp - 19) < 1e-6, `after 45: shield ${e.shield}, ${e.max - e.hp} health lost`);
  assert.equal(S.spawnEnemy(Object.assign(arena(), { eclipse: null }), 'breaker', 0, MID.x, MID.y).shield, undefined, 'no shield on another night');
});

test('an Ash Storm\'s shield and a Volatile burst grow with the night, at half pace in endless mode', () => {
  const A = S.ECLIPSES.ash_storm, V = S.ECLIPSES.volatile, on = (wave, more) => Object.assign(arena(), { wave, ...more });
  assert.deepEqual([1, 3, 6, 9].map((wave) => S.ashShield(on(wave))), [26, 34, 46, 57], 'under the old flat 35 on night 3, the first with an Eclipse, and over it from night 6');
  assert.equal(S.ashShield(on(9, { endless: true })), Math.round(A.shield * (1 + A.shieldGrow * 4)), 'night 9 of an endless match is as hard as night 5');
  assert.equal(S.spawnEnemy(on(6, { eclipse: 'ash_storm' }), 'skitter', 0, MID.x, MID.y).shield, 46, 'which is what an AI enemy arrives with');
  for (const [wave, blast] of [[1, 22], [3, 24.2], [6, 27.5], [9, 30.8]]) assert.ok(Math.abs(S.volatileBlast(on(wave)) - blast) < 1e-9, `night ${wave}: ${S.volatileBlast(on(wave))}`);
  assert.ok(Math.abs(S.volatileBlast(on(9, { endless: true })) - V.blast * (1 + V.blastGrow * 4)) < 1e-9);

  const g = on(6, { eclipse: 'volatile' });
  const spikes = S.addStruct(g, 'spikes', 0, MID.cx, MID.cy);
  const e = S.spawnEnemy(g, 'skitter', 0, spikes.x, spikes.y);
  Object.assign(e, { stun: 100, hp: 10 });
  const dart = place(g.heroes[AZURE + DART], spikes.x, spikes.y + V.r - 5), out = place(g.heroes[JADE + DART], spikes.x, spikes.y - V.r - 5);
  run(g, 0.5);
  assert.ok(e.dead && Math.abs(dart.max - dart.hp - 27.5) < 1e-9, `the burst on night 6 does ${dart.max - dart.hp}`);
  assert.equal(out.hp, out.max, 'and reaches no further than it did');
});

test('every rule an Eclipse brings that is not a number is registered against that Eclipse', () => {
  assert.deepEqual(Object.keys(S.ECLIPSE_HOOKS), ['ash_storm', 'volatile']);
  for (const [id, hooks] of Object.entries(S.ECLIPSE_HOOKS)) {
    assert.ok(id in S.ECLIPSES, id);
    for (const [when, fn] of Object.entries(hooks)) assert.ok(['spawn', 'death'].includes(when) && typeof fn === 'function', `${id}.${when}`);
  }
});

test('a Volatile chain of any length goes off in one tick without a deeper stack, and a structure that falls to it costs its neighbours nothing', () => {
  // 8000 AI enemies in one spot, each a burst from death: as calls within calls that is 16000 frames, more than the stack holds.
  const g = Object.assign(arena(), { eclipse: 'volatile' }), N = 8000;
  strandAmber(g);
  const pack = Array.from({ length: N }, () => Object.assign(S.spawnEnemy(g, 'skitter', 0, MID.x, MID.y), { hp: 9 })); // under the 9.9 a burst does to an AI enemy
  const frail = S.addStruct(g, 'wall', 1, MID.cx + 1, MID.cy), wall = S.addStruct(g, 'wall', 1, MID.cx - 1, MID.cy), turret = S.addStruct(g, 'turret', 1, MID.cx, MID.cy + 1);
  frail.hp = 10; // falls to the first burst, while the loop over the structures is on it
  Object.assign(wall, { hp: 1e7, max: 1e7 });
  Object.assign(turret, { hp: 1e7, max: 1e7 });
  const scrap = g.teams[0].scrap, sv = g.sv;
  pack[0].dead = true;
  S.ECLIPSE_HOOKS.volatile.death(g, pack[0], 0);
  assert.ok(pack.every((e) => e.dead), 'the first burst set off all the rest');
  assert.equal(g.teams[0].scrap - scrap, (N - 1) * S.ENEMIES.skitter.bounty, 'each paid to the team that started it, at its plain bounty');
  assert.equal(g.fx.filter((f) => f.kind === 'blast').length, N, 'one burst each');
  assert.ok(frail.dead && !g.structs.includes(frail) && g.sv === sv + 1, 'the frail Wall is gone, and the structures are known to have changed');
  const took = [wall, turret].map((st) => Math.round((st.max - st.hp) / S.volatileBlast(g)));
  assert.deepEqual(took, [N, N], 'and the Wall and the Turret beside it were hit by every burst, none skipped');

  // A second chain in the same match starts clean: nothing was left waiting from the first.
  const [a, b] = [0, 1].map(() => Object.assign(S.spawnEnemy(g, 'skitter', 0, MID.x + 400, MID.y), { hp: 9 }));
  a.dead = true;
  S.ECLIPSE_HOOKS.volatile.death(g, a, 0);
  assert.ok(b.dead);
});

test('Volatile: a dying AI enemy bursts, hurting heroes and structures near it in full and other AI enemies at 45% (in chains) but no Ember; a kill pays one more Scrap, a death in the chain does not', () => {
  const g = Object.assign(arena(), { eclipse: 'volatile' }), em = g.teams[0].ember, V = S.ECLIPSES.volatile;
  strandAmber(g);
  const spikes = S.addStruct(g, 'spikes', 0, em.x / S.CELL + 1, em.y / S.CELL); // 63 from the Ember's middle: inside every burst below
  const a = S.spawnEnemy(g, 'skitter', 0, spikes.x, spikes.y);
  const b = S.spawnEnemy(g, 'skitter', 0, spikes.x, spikes.y - 50);
  const c = S.spawnEnemy(g, 'skitter', 0, spikes.x, spikes.y + 30); // off the Spikes; 30 from a, 80 from b: in reach of the first burst only
  a.stun = b.stun = c.stun = 100;
  b.hp = 9; // the first burst is enough to set it off
  const wall = S.addStruct(g, 'wall', 2, spikes.cx + 1, spikes.cy); // 40 from a, 64 from b
  const dart = place(g.heroes[AZURE + DART], spikes.x, spikes.y + 50); // 50 from a, 100 from b
  const far = place(g.heroes[JADE + DART], spikes.x, spikes.y + 200);
  const scrap = g.teams[0].scrap;
  run(g, 1.2); // the Spikes take a's 30 health in a second
  assert.ok(a.dead && b.dead, 'the burst of the first set off the second');
  assert.equal(dart.max - dart.hp, V.blast, 'one burst reached the hero');
  assert.equal(far.hp, far.max);
  assert.equal(wall.max - wall.hp, 2 * V.blast, 'both reached the Wall');
  assert.equal(em.hp, em.max, 'neither hurt the Ember');
  assert.ok(!c.dead && Math.abs(c.max - c.hp - V.blast * V.toEnemies) < 1e-9, `an AI enemy takes ${V.toEnemies} of a burst, so a healthy one outlives it: ${c.max - c.hp}`);
  assert.equal(g.teams[0].scrap - scrap, 2 * S.ENEMIES.skitter.bounty + V.scrap, 'the team whose Spikes killed the first is paid for both, with the extra for the one it killed and not for the one the burst did');

  const calm = arena();
  const sp = S.addStruct(calm, 'spikes', 0, MID.cx, MID.cy);
  S.spawnEnemy(calm, 'skitter', 0, sp.x, sp.y).stun = 100;
  const near = place(calm.heroes[AZURE + DART], sp.x, sp.y + 50);
  run(calm, 1.2);
  assert.deepEqual([near.hp, calm.teams[0].scrap - scrap], [near.max, S.ENEMIES.skitter.bounty], 'on another night nothing bursts');
});

// ---------------------------------------------------------------- the Core

const coreIn = (g) => (g.core = { x: S.ARENA.x, y: S.ARENA.y, team: -1, prog: 0 });
const atCore = (h, dx = 0) => place(h, S.ARENA.x + dx, S.ARENA.y);

test('the Core appears twelve seconds into every other day from the second, once, and goes at dusk', () => {
  const g = S.createGame(1);
  run(g, 20);
  assert.equal(g.core, null, 'not on the first day');
  Object.assign(g, { wave: 1, timer: S.DAY_LENGTH, coreSpawned: false });
  run(g, S.CORE_DEF.spawnDelay - 0.1);
  assert.equal(g.core, null);
  run(g, 0.2);
  assert.deepEqual(g.core, { x: S.ARENA.x, y: S.ARENA.y, team: -1, prog: 0 });
  assert.equal(S.shotHit(g, { x: g.core.x, y: g.core.y, team: 0 }), null, 'it is not in the way of a shot');
  g.core = null; // as if taken
  run(g, 5);
  assert.equal(g.core, null, 'only one a day');
  coreIn(g);
  g.timer = 0.05;
  run(g, 0.1);
  assert.deepEqual([g.phase, g.core], ['night', null], 'dusk takes it away');
  g.enemies = [];
  g.spawn = [];
  run(g, DT);
  assert.deepEqual([g.phase, g.wave, g.coreSpawned], ['day', 2, false]);
  run(g, S.CORE_DEF.spawnDelay + 5);
  assert.equal(g.core, null, 'the third day has none: it is left for raiding');
  for (const [wave, has] of [[3, true], [4, false], [5, true]]) {
    Object.assign(g, { wave, timer: S.DAY_LENGTH, core: null, coreSpawned: false });
    run(g, S.CORE_DEF.spawnDelay + 0.1);
    assert.equal(g.core !== null, has, `day ${wave + 1}`);
  }
});

test('who is in the Core\'s ring: the living heroes of standing teams, and the lead goes to the team with the most', () => {
  const g = arena(), D = S.CORE_DEF;
  coreIn(g);
  assert.deepEqual(S.coreContestants(g), { n: [0, 0, 0], teams: 0, lead: -1 });
  atCore(g.heroes[AMBER + DART], D.radius - 1);
  const azure = atCore(g.heroes[AZURE + DART], -D.radius - 1); // a step outside
  assert.deepEqual(S.coreContestants(g), { n: [1, 0, 0], teams: 1, lead: 0 });
  atCore(azure, -40);
  assert.deepEqual(S.coreContestants(g), { n: [1, 1, 0], teams: 2, lead: -1 }, 'one each: nobody leads');
  const anvil = atCore(g.heroes[AZURE + ANVIL], 40);
  atCore(g.heroes[JADE + COG]);
  assert.deepEqual(S.coreContestants(g), { n: [1, 2, 1], teams: 3, lead: 1 }, 'more than any other team, not more than the rest together');
  Object.assign(anvil, { alive: false, hp: 0, respawn: 100 });
  assert.deepEqual(S.coreContestants(g), { n: [1, 1, 1], teams: 3, lead: -1 }, 'a hero that is down does not count');
  g.teams[1].alive = g.teams[2].alive = false;
  assert.deepEqual(S.coreContestants(g), { n: [1, 0, 0], teams: 1, lead: 0 }, 'nor do the heroes of a team whose Ember has fallen');
});

test('one team alone at the Core takes it in six seconds, and is paid: Scrap, Ember health, Ultimate charge and Rush', () => {
  const g = arena(), T = g.teams[0], D = S.CORE_DEF;
  coreIn(g);
  atCore(g.heroes[AMBER + DART], D.radius - 5);
  Object.assign(g.heroes[AMBER + COG], { alive: false, hp: 0, respawn: 100 });
  T.ember.hp = 1000;
  g.heroes[AMBER + ANVIL].ult = 80;
  const scrap = T.scrap;
  run(g, D.captureTime - 0.1);
  assert.deepEqual([g.core.team, Math.round(g.core.prog * 10) / 10, T.scrap], [0, 5.9, scrap], 'nearly there, nothing paid yet');
  run(g, 0.2);
  assert.equal(g.core, null);
  assert.deepEqual([T.scrap - scrap, T.ember.hp], [D.scrapReward, 1000 + D.emberHeal]);
  assert.deepEqual(g.heroes.slice(AMBER, AMBER + S.TEAM_SIZE).map((h) => h.ult), [100, D.ultGrant, D.ultGrant, 0, D.ultGrant], 'every living hero of the team, wherever it is; capped at 100; nothing for the one that is down');
  assert.ok(g.heroes[AMBER + PATCH].rush > D.rush - 0.2 && g.heroes[AZURE + DART].rush === 0);
  assert.ok(g.fx.some((f) => f.kind === 'capture' && f.team === 0));

  const full = arena();
  coreIn(full);
  atCore(full.heroes[JADE + ANVIL]);
  full.teams[2].ember.hp = full.teams[2].ember.max - 20;
  run(full, D.captureTime + 0.1);
  assert.equal(full.teams[2].ember.hp, full.teams[2].ember.max, 'the Ember is never mended past full');
});

test('at dusk a Core half taken or more pays the team that leads it with its own progress half, and any other Core nothing', () => {
  const D = S.CORE_DEF;
  /** Amber's Ember and Scrap after a dusk that finds Amber's progress at `prog` and the ring as `setup` left it. */
  const dusk = (prog, setup) => {
    const g = arena(), T = g.teams[0];
    Object.assign(coreIn(g), { team: 0, prog });
    setup(g);
    T.ember.hp = 1000;
    const scrap = T.scrap, rival = g.teams[1].scrap;
    S.startNight(g);
    assert.equal(g.core, null, 'the Core goes at dusk whatever it paid');
    assert.equal(g.teams[1].scrap, rival, 'a rival is never paid for progress that is not its own');
    return { g, paid: [T.scrap - scrap, T.ember.hp - 1000], taken: g.fx.some((f) => f.kind === 'capture') };
  };
  const amber = (g) => atCore(g.heroes[AMBER + DART], -40), azure = (g) => atCore(g.heroes[AZURE + DART], 40);
  const half = dusk(D.captureTime * D.dusk, amber);
  assert.deepEqual([half.paid, half.taken], [[Math.round(D.scrapReward * D.dusk), Math.round(D.emberHeal * D.dusk)], true], 'half the Scrap and half the mending, and the capture is shown');
  assert.deepEqual([half.g.heroes[AMBER + ANVIL].ult, half.g.heroes[AMBER + ANVIL].rush], [D.ultGrant * D.dusk, 0], 'half the Ultimate charge, and no Rush');
  const none = [[0, 0], false];
  assert.deepEqual(Object.values(dusk(D.captureTime * D.dusk - 0.1, amber)).slice(1), none, 'under half way: nothing');
  assert.deepEqual(Object.values(dusk(5, (g) => (amber(g), azure(g)))).slice(1), none, 'tied at dusk: nothing');
  assert.deepEqual(Object.values(dusk(5, azure)).slice(1), none, 'a rival alone in the ring, still running Amber\'s progress down: nothing, to either');
  assert.deepEqual(Object.values(dusk(5, () => {})).slice(1), none, 'nobody there: nothing');
});

test('a contested Core goes, slower, to the team with the most heroes at it; a tie holds it where it is; a rival\'s progress is run down before a new team\'s counts', () => {
  const g = arena(), D = S.CORE_DEF, cents = (v) => Math.round(v * 100) / 100;
  coreIn(g);
  const amber = atCore(g.heroes[AMBER + DART], -40), azure = g.heroes[AZURE + DART], home = { x: azure.x, y: azure.y };
  const prog = () => cents(g.core.prog);
  run(g, 2);
  assert.deepEqual([g.core.team, prog()], [0, 2]);
  atCore(azure, 40);
  run(g, 3);
  assert.deepEqual([g.core.team, prog()], [0, 2], 'one against one: it stays where it is, and nobody gains or loses');
  const second = atCore(g.heroes[AMBER + ANVIL], -80);
  run(g, 2);
  assert.deepEqual([g.core.team, prog()], [0, cents(2 + 2 * D.contestedRate)], 'two against one: Amber fills it again, at the contested pace');
  atCore(g.heroes[AZURE + ANVIL], 80);
  atCore(g.heroes[AZURE + PATCH], 110);
  run(g, 1);
  const left = cents(2 + 2 * D.contestedRate - D.contestedRundown);
  assert.deepEqual([g.core.team, prog()], [0, left], 'three against two: Azure has it now, and runs Amber\'s progress down first');
  place(amber, 300, 300);
  place(second, 300, 340);
  run(g, 1);
  assert.deepEqual([g.core.team, prog()], [0, cents(left - 1)], 'faster with Amber gone: a second a second');
  run(g, left - 1 + 1);
  assert.ok(g.core.team === 1 && prog() > 0.9 && prog() <= 1, `then it is Azure\'s, and climbs: ${prog()}`);

  const fresh = arena();
  coreIn(fresh);
  atCore(fresh.heroes[AMBER + DART], -40);
  atCore(fresh.heroes[AZURE + DART], 40);
  atCore(fresh.heroes[AZURE + ANVIL], 80);
  run(fresh, 2);
  assert.deepEqual([fresh.core.team, cents(fresh.core.prog)], [1, cents(2 * D.contestedRate)], 'an empty Core fought over two to one fills for the two, at the contested pace');
  run(fresh, (D.captureTime - 2 * D.contestedRate) / D.contestedRate + 0.1);
  assert.equal(fresh.core, null, 'and they take it in the end: no stalemate');
  assert.ok(fresh.fx.some((f) => f.kind === 'capture' && f.team === 1));

  for (const h of g.heroes) if (h.team === 1 && h !== azure) place(h, 300, 300 + h.i * 40);
  g.core.prog = 1;
  place(azure, home.x, home.y);
  run(g, 1);
  assert.deepEqual([g.core.team, prog()], [1, 1 - D.decayRate], 'nobody there: it drains at half speed');
  run(g, 1.5);
  assert.deepEqual([g.core.team, prog()], [-1, 0], 'to nothing, and then it is nobody\'s');
  Object.assign(azure, { alive: false, hp: 0, respawn: 100 });
  atCore(azure);
  run(g, 1);
  assert.equal(prog(), 0, 'a hero that is down does not hold it');
});

test('the same seed and inputs give the same match with an Eclipse and a Core in it', () => {
  const play = (seed) => {
    const g = S.createGame(seed), seen = { core: false, eclipse: false, taken: false };
    Object.assign(g, { wave: 5, timer: S.DAY_LENGTH }); // the sixth day has a Core, and the sixth night brings an Eclipse
    run(g, 75, (s) => {
      seen.core ||= s.core !== null;
      seen.eclipse ||= s.eclipse !== null;
      seen.taken ||= s.fx.some((f) => f.kind === 'capture');
      const h = s.heroes[AMBER + DART], to = s.core || s.teams[0].ember;
      const dx = to.x - h.x, dy = to.y - h.y, d = Math.hypot(dx, dy);
      return { [AMBER + DART]: { mx: d > 30 ? dx / d : 0, my: d > 30 ? dy / d : 0, aim: Math.atan2(dy, dx), fire: s.phase === 'night' }, [AZURE + COG]: { q: true, fire: true, aim: s.t } };
    });
    assert.deepEqual(seen, { core: true, eclipse: true, taken: true }, 'the match had a Core, taken, and an Eclipse');
    return JSON.stringify(g);
  };
  assert.equal(play(11), play(11));
  assert.notEqual(play(11), play(12));
});
