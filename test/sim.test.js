import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/sim.js';

const DT = 1 / 60;
const AMBER = 0, AZURE = 4, JADE = 8; // first hero slot of each team
const ANVIL = 0, DART = 1, PATCH = 2, COG = 3; // offset within a team
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
const strandAmber = (g) => g.heroes.slice(AMBER, AMBER + 4).forEach((h) => place(h, 300, 300));

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

test('a new match has three teams of four heroes camped at their own Ember', () => {
  const g = S.createGame(1);
  assert.equal(g.phase, 'day');
  assert.equal(g.teams.length, 3);
  assert.equal(g.heroes.length, 12);
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

test('a hero moves at its own speed and stops at the world edge', () => {
  const g = arena();
  const h = place(g.heroes[AMBER + DART], 1000, 1000);
  run(g, 1, { [AMBER + DART]: { mx: 1, my: 0 } });
  assert.ok(Math.abs(h.x - (1000 + S.HEROES.dart.speed)) < 1);
  run(g, 30, { [AMBER + DART]: { mx: 1, my: 0 } });
  assert.equal(h.x, S.WORLD.w - S.HERO_R);
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
  const rival = place(g.heroes[AZURE + ANVIL], MID.x + 100, MID.y);
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
  place(g.heroes[AMBER + DART], az.ember.x - 200, az.ember.y);
  S.addStruct(g, 'wall', 1, 60, 50);
  az.ember.hp = 20;
  const before = g.teams[0].scrap;
  run(g, 2, { [AMBER + DART]: { aim: 0, fire: true } });
  assert.equal(az.alive, false);
  assert.equal(g.teams[0].scrap, before + S.EMBER_BOUNTY);
  assert.ok(g.heroes.slice(AZURE, AZURE + 4).every((h) => h.out && !h.alive));
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
  assert.equal(anvil.max - anvil.hp, S.ENEMIES.skitter.dmg * 0.25);
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

test('Overdrive triples Dart\'s fire rate', () => {
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
  assert.ok(fast >= 22 && fast <= 25, `overdrive ${fast}`);
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
    const rival = place(g.heroes[AZURE + ANVIL], MID.x + 150, MID.y);
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
  assert.equal(why('wall', MID.cx + 1, MID.cy), 'occupied');
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
  place(g.heroes[AZURE + ANVIL], MID.x, MID.y + 40);
  const T = g.teams[0];
  const whole = S.addStruct(g, 'wall', 0, MID.cx + 1, MID.cy);
  const dented = S.addStruct(g, 'wall', 0, MID.cx + 2, MID.cy);
  dented.hp = dented.max / 2;

  run(g, DT, { [AZURE + ANVIL]: { remove: { cx: whole.cx, cy: whole.cy } } });
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
  const rival = place(g.heroes[AZURE + ANVIL], MID.x - 120, MID.y);
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
  const rival = place(g.heroes[AZURE + ANVIL], MID.x + 5, MID.y + 5);
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
    [AZURE + ANVIL]: { mx: -1, my: -1, aim: 4, fire: true, q: true },
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
  assert.equal(snap.heroes.length, 12);
  assert.equal(snap.spawn, undefined);
  assert.equal(snap.pending, g.spawn.length);
  assert.ok(snap.pending > 0);
});
