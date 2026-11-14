import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/sim.js';
import { botInput, nextPiece } from '../public/bots.js';

const DT = 1 / 60;
const AMBER = 0, AZURE = S.TEAM_SIZE;
const ANVIL = 0, DART = 1, PATCH = 2, COG = 3, FORGE = 4;
const MID = { x: 1820, y: 1500 };
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const place = (h, x, y) => Object.assign(h, { x, y });
const squad = (g, team) => g.heroes.filter((h) => h.team === team);

/** Every hero played by a bot. */
function play(g, seconds, { spend = true, until, each } = {}) {
  for (let n = Math.round(seconds / DT); n > 0 && !(until && until(g)); n--) {
    S.step(g, g.heroes.map((h) => botInput(g, h.i, spend)), DT);
    if (each) each(g, n);
  }
  return g;
}

/** Things that must hold in every state of every match. */
function assertSane(g) {
  const at = ` (t=${g.t.toFixed(1)}s, wave ${g.wave})`;
  const inWorld = (o) => o.x >= 0 && o.y >= 0 && o.x <= S.WORLD.w && o.y <= S.WORLD.h;
  for (const h of g.heroes) {
    assert.ok([h.x, h.y, h.aim, h.hp, h.ult].every(Number.isFinite), `hero ${h.i} has a non-number${at}`);
    assert.ok(h.hp >= 0 && h.hp <= h.max && h.ult >= 0 && h.ult <= 100 && inWorld(h), `hero ${h.i} out of range${at}`);
    assert.ok(h.alive ? h.hp > 0 : h.hp === 0, `hero ${h.i} alive/hp mismatch${at}`);
  }
  for (const e of g.enemies) assert.ok(Number.isFinite(e.x + e.y + e.hp) && e.hp > 0 && e.hp <= e.max && inWorld(e), `bad enemy ${JSON.stringify(e)}${at}`);
  for (const sh of g.shots) assert.ok(Number.isFinite(sh.x + sh.y + sh.vx + sh.vy), `bad shot${at}`);
  for (const T of g.teams) {
    assert.ok(Number.isInteger(T.scrap) && T.scrap >= 0, `Scrap ${T.scrap}${at}`);
    assert.ok(T.ember.hp >= 0 && T.ember.hp <= T.ember.max, `Ember hp ${T.ember.hp}${at}`);
    assert.equal(T.alive, T.ember.hp > 0, `Ember alive/hp mismatch${at}`);
  }
  const cells = new Set(g.structs.map((st) => st.cy * S.COLS + st.cx));
  assert.equal(cells.size, g.structs.length, `two structures share a cell${at}`);
  for (const st of g.structs) assert.ok(st.hp > 0 && st.hp <= st.max && g.teams[st.team].alive, `bad structure ${JSON.stringify(st)}${at}`);
}

test('bots scavenge by day and are back at their Ember by nightfall', () => {
  const g = play(S.createGame(1), S.DAY_LENGTH + 1, { until: (g) => g.phase === 'night' });
  assert.equal(g.phase, 'night');
  for (let team = 0; team < 3; team++) {
    assert.ok(squad(g, team).reduce((n, h) => n + h.stats.scrap, 0) > 0, `team ${team} gathered Scrap`);
  }
  for (const h of g.heroes) assert.ok(gap(h, g.teams[h.team].ember) < 300, `hero ${h.i} is home`);
});

test('bots hold their Embers through the first night', () => {
  const g = play(S.createGame(2), 240, { until: (g) => g.wave === 1 && g.phase === 'day' });
  assert.equal(g.phase, 'day');
  assert.ok(g.teams.every((T) => T.alive));
  for (let team = 0; team < 3; team++) {
    assert.ok(squad(g, team).reduce((n, h) => n + h.stats.kills, 0) > 0, `team ${team} got kills`);
  }
});

test('a bot Cog fortifies an all-bot base, but never spends a human team\'s Scrap', () => {
  const built = play(S.createGame(1), S.DAY_LENGTH - 5);
  for (let team = 0; team < 3; team++) assert.ok(built.structs.some((st) => st.team === team && st.ttl === 0), `team ${team} built`);

  const saved = play(S.createGame(1), S.DAY_LENGTH - 5, { spend: false });
  assert.equal(saved.structs.filter((st) => st.ttl === 0).length, 0);
  assert.ok(saved.teams.every((T) => T.scrap >= S.START_SCRAP));
});

test('bots fight rival heroes they meet', () => {
  const g = S.createGame(1);
  g.timer = 1e9;
  g.wrecks = [];
  const mine = place(g.heroes[AMBER + DART], MID.x, MID.y);
  const theirs = place(g.heroes[AZURE + ANVIL], MID.x + 200, MID.y);
  assert.equal(botInput(g, mine.i).fire, true);
  assert.equal(botInput(g, theirs.i).fire, true, 'both open fire on sight');
  for (let n = 0; n < 180; n++) S.step(g, { [mine.i]: botInput(g, mine.i), [theirs.i]: botInput(g, theirs.i) }, DT);
  // Only the Anvil is sure to be hurt: a Dart backs away faster than Scattergun pellets can reach it.
  assert.ok(theirs.shield < theirs.shieldMax);
  assert.ok(gap(mine, theirs) > 200, 'the Dart keeps its distance');
});

test('Anvil and Dart bots set out to raid a rival Ember once the first night is over', () => {
  const firstDay = play(S.createGame(1), 5);
  const later = S.createGame(1);
  later.wave = 1;
  play(later, 5);
  for (const k of [ANVIL, DART]) {
    const nearestRival = (g) => Math.min(gap(g.heroes[AMBER + k], g.teams[1].ember), gap(g.heroes[AMBER + k], g.teams[2].ember));
    assert.ok(nearestRival(later) < nearestRival(firstDay) - 200, `hero ${k} closed on a rival Ember`);
  }
  assert.ok(gap(later.heroes[AMBER + PATCH], later.teams[0].ember) < 900, 'Patch stays near home');
});

/** Which rival Ember (team index) a team's Dart bot is walking towards. */
function raidTarget(g, team) {
  const anvil = g.heroes[team * S.TEAM_SIZE + DART], input = botInput(g, anvil.i);
  const toward = (k) => {
    const em = g.teams[k].ember, d = gap(anvil, em);
    return (input.mx * (em.x - anvil.x) + input.my * (em.y - anvil.y)) / d;
  };
  const [a, b] = [0, 1, 2].filter((k) => k !== team);
  return toward(a) > toward(b) ? a : b;
}

test('with the Embers level, each team raids a different rival', () => {
  const g = S.createGame(1);
  g.wave = 1;
  assert.deepEqual([0, 1, 2].map((team) => raidTarget(g, team)), [1, 2, 0]);
});

test('a badly hurt Ember draws both rivals', () => {
  const g = S.createGame(1);
  g.wave = 1;
  g.teams[0].ember.hp *= 0.5;
  assert.equal(raidTarget(g, 1), 0);
  assert.equal(raidTarget(g, 2), 0);
});

test('a raiding bot in range of a rival Ember shoots at it', () => {
  const g = S.createGame(1);
  g.wave = 1;
  g.wrecks = [];
  const az = g.teams[1].ember;
  g.heroes.slice(AZURE, AZURE + S.TEAM_SIZE).forEach((h) => place(h, 300, 300));
  const dart = place(g.heroes[AMBER + DART], az.x - 400, az.y);
  S.addStruct(g, 'wall', 1, Math.floor(dart.x / S.CELL) + 2, Math.floor(dart.y / S.CELL) + 3); // nearer, but off the line
  const input = botInput(g, dart.i);
  assert.equal(input.fire, true);
  assert.ok(Math.abs(input.aim) < 0.01, 'aims straight at the Ember, not at the nearest Wall');
});

test('the Patch bot mends a hurt teammate standing next to it', () => {
  const g = S.createGame(1);
  const patch = g.heroes[AMBER + PATCH], mate = g.heroes[AMBER + DART];
  place(mate, patch.x + 20, patch.y);
  assert.equal(botInput(g, patch.i).q, false);
  mate.hp = mate.max * 0.3;
  assert.equal(botInput(g, patch.i).q, true);
});

for (const seed of [1, 2, 3]) {
  test(`soak: twelve bots play seed ${seed} to the end without breaking the match`, (t) => {
    const g = S.createGame(seed);
    const CAP_MINUTES = 40;
    let biggest = 0;
    const started = performance.now();
    play(g, CAP_MINUTES * 60, {
      until: (g) => g.phase === 'over',
      each: (g, n) => {
        if (n % 20 === 0) assertSane(g);
        if (n % 600 === 0) biggest = Math.max(biggest, S.snapshot(g).length);
      },
    });
    assertSane(g);
    assert.equal(g.phase, 'over', `match still running after ${CAP_MINUTES} simulated minutes`);
    assert.ok(g.winner >= -1 && g.winner <= 2);
    const pvp = g.heroes.reduce((n, h) => n + h.stats.pvp, 0);
    const winner = g.winner < 0 ? 'draw' : `Team ${S.TEAMS[g.winner].name} wins`;
    t.diagnostic(
      `seed ${seed}: ${winner} on wave ${g.wave} after ${(g.t / 60).toFixed(1)} simulated min; ` +
        `${pvp} hero-vs-hero kills; biggest snapshot ${(biggest / 1024).toFixed(1)} KB; ` +
        `${((performance.now() - started) / g.t).toFixed(2)} ms of CPU per simulated second`,
    );
  });
}

// ---------------------------------------------------------------- smarter decisions

/** A quiet daytime match with no wrecks, for asking one bot what it would do. */
function quiet() {
  const g = S.createGame(1);
  g.timer = 1e9;
  g.wrecks = [];
  return g;
}
/** How directly an input walks from a hero towards a point: 1 straight at it, -1 straight away, 0 standing still. */
const heading = (input, h, p) => (input.mx * (p.x - h.x) + input.my * (p.y - h.y)) / (gap(h, p) || 1);

test('a bot finishes off the weakest hostile in range rather than the nearest', () => {
  const g = quiet();
  const dart = place(g.heroes[AMBER + DART], MID.x, MID.y);
  S.spawnEnemy(g, 'breaker', 0, MID.x + 100, MID.y);
  const weak = S.spawnEnemy(g, 'breaker', 0, MID.x, MID.y + 250);
  weak.hp = 5;
  const input = botInput(g, dart.i);
  assert.equal(input.fire, true);
  assert.ok(Math.abs(input.aim - Math.PI / 2) < 0.01, `aim ${input.aim}`);
});

test('a raider picks off a rival Turret from outside its reach', () => {
  const g = quiet();
  g.wave = 1;
  g.heroes.slice(AZURE, AZURE + S.TEAM_SIZE).forEach((h) => place(h, 300, 300));
  const turret = S.addStruct(g, 'turret', 1, 60, 59); // west of Azure's Ember
  const anvil = g.heroes[AMBER + ANVIL];
  assert.ok(S.HEROES.anvil.gun.range > S.STRUCTS.turret.range, 'the Scattergun outranges a Turret');

  place(anvil, turret.x - 250, turret.y); // inside the Turret's reach
  let input = botInput(g, anvil.i);
  assert.equal(input.fire, true);
  assert.ok(Math.abs(input.aim) < 0.01, 'aims at the Turret');
  assert.ok(heading(input, anvil, turret) < -0.9, 'backs out of its reach');

  place(anvil, turret.x - (S.STRUCTS.turret.range + 20), turret.y); // out of its reach, inside our own
  input = botInput(g, anvil.i);
  assert.equal(input.fire, true);
  assert.ok(Math.abs(input.aim) < 0.01);
  assert.equal(Math.hypot(input.mx, input.my), 0, 'holds there');
});

test('by day, bots near home run back when their Ember is attacked', () => {
  const g = quiet();
  const em = g.teams[0].ember;
  const patch = place(g.heroes[AMBER + PATCH], em.x, em.y + 700);
  g.wrecks.push({ id: 9001, x: em.x, y: em.y + 850, scrap: 20 });
  assert.ok(heading(botInput(g, patch.i), patch, g.wrecks[0]) > 0.9, 'normally it goes for the wreck');
  place(g.heroes[AZURE + DART], em.x + 200, em.y);
  assert.ok(heading(botInput(g, patch.i), patch, em) > 0.9, 'with a raider at the Ember it heads home');
});

test('a badly hurt bot under attack falls back to its Patch', () => {
  const g = quiet();
  g.phase = 'night';
  const em = g.teams[0].ember;
  const dart = place(g.heroes[AMBER + DART], em.x + 150, em.y);
  const patch = place(g.heroes[AMBER + PATCH], em.x - 150, em.y);
  S.spawnEnemy(g, 'skitter', 0, em.x + 400, em.y);
  dart.hp = dart.max * 0.2;
  const input = botInput(g, dart.i);
  assert.ok(heading(input, dart, patch) > 0.9);
  assert.equal(input.fire, true, 'still shooting as it goes');
});

test('the Patch bot goes to a hurt teammate', () => {
  const g = quiet();
  g.phase = 'night';
  const em = g.teams[0].ember;
  const patch = place(g.heroes[AMBER + PATCH], em.x - 150, em.y);
  const mate = place(g.heroes[AMBER + ANVIL], em.x + 150, em.y + 100);
  assert.ok(heading(botInput(g, patch.i), patch, mate) < 0.9, 'not while everyone is healthy');
  mate.hp = mate.max * 0.4;
  assert.ok(heading(botInput(g, patch.i), patch, mate) > 0.9);
});

test('a raider turns for home at half health', () => {
  const g = quiet();
  g.wave = 1;
  const em = g.teams[0].ember, rival = g.teams[1].ember;
  const dart = place(g.heroes[AMBER + DART], (em.x + rival.x) / 2, (em.y + rival.y) / 2);
  assert.ok(heading(botInput(g, dart.i), dart, rival) > 0.9, 'healthy: presses on');
  dart.hp = dart.max * 0.45;
  assert.ok(heading(botInput(g, dart.i), dart, em) > 0.9, 'hurt: heads back');
});

test('a raiding Anvil whose shield is broken pulls back to let it refill', () => {
  const g = quiet();
  g.wave = 1;
  const em = g.teams[0].ember, rival = g.teams[1].ember;
  const anvil = place(g.heroes[AMBER + ANVIL], (em.x + rival.x) / 2, (em.y + rival.y) / 2);
  place(g.heroes[AMBER + DART], anvil.x + (rival.x - em.x) * 0.1, anvil.y + (rival.y - em.y) * 0.1); // its Dart, further along
  anvil.hp = anvil.max * 0.7;
  assert.ok(heading(botInput(g, anvil.i), anvil, rival) > 0.9, 'shield up: presses on');
  anvil.shield = 0;
  assert.ok(heading(botInput(g, anvil.i), anvil, em) > 0.9, 'shield down: backs off');
});

test('the Anvil bot raids a step ahead of its Dart, never alone', () => {
  const g = quiet();
  g.wave = 1;
  const em = g.teams[0].ember, rival = g.teams[1].ember;
  const anvil = place(g.heroes[AMBER + ANVIL], (em.x + rival.x) / 2, (em.y + rival.y) / 2);
  const dart = place(g.heroes[AMBER + DART], anvil.x, anvil.y - 400); // off to one side of the road to Azure
  assert.ok(heading(botInput(g, anvil.i), anvil, dart) > 0.9, 'goes to its Dart, not the rival Ember');
  const d = gap(em, rival);
  place(dart, anvil.x - (rival.x - em.x) * 50 / d, anvil.y - (rival.y - em.y) * 50 / d); // 50 px behind, on the road to Azure
  const ahead = botInput(g, anvil.i);
  assert.equal(Math.hypot(ahead.mx, ahead.my), 0, 'holds its place in front');
  Object.assign(dart, { alive: false, hp: 0 });
  assert.ok(heading(botInput(g, anvil.i), anvil, em) > 0.9, 'Dart down: heads home');
});

// ---------------------------------------------------------------- Shield Generators and the Forge bot

test('the bot base adds Shield Generators after its first Turrets, and their fields cover every guard post', () => {
  const g = quiet(), cog = g.heroes[AMBER + COG], types = [];
  g.teams[0].scrap = 1e6;
  for (let p; (p = nextPiece(g, cog)) && types.length < 300;) {
    types.push(p.type);
    S.addStruct(g, p.type, 0, p.cx, p.cy).wait = 0;
  }
  assert.deepEqual(types.slice(0, 6), ['turret', 'turret', 'turret', 'turret', 'shield', 'shield']);
  const gens = g.structs.filter((st) => st.type === 'shield');
  assert.equal(gens.length, 4);
  for (let k = 0; k < S.TEAM_SIZE; k++) assert.ok(gens.some((st) => gap(st, S.post(0, k)) <= S.STRUCTS.shield.radius), `post ${k} is in a field`);
});

test('the Forge bot goes to a broken structure at its base and Reforges it, and calls Aegis when teammates are badly hurt', () => {
  const g = quiet();
  g.phase = 'night';
  const em = g.teams[0].ember, forge = place(g.heroes[AMBER + FORGE], em.x - 100, em.y - 200);
  const wall = S.addStruct(g, 'wall', 0, em.x / S.CELL - 5, em.y / S.CELL); // west of the Ember; the Forge's guard post is east
  assert.ok(heading(botInput(g, forge.i), forge, wall) < 0.9, 'not while everything is whole');
  wall.hp = wall.max * 0.5;
  let input = botInput(g, forge.i);
  assert.ok(heading(input, forge, wall) > 0.9 && !input.q, 'out of reach: walks to it');
  place(forge, wall.x + 60, wall.y);
  input = botInput(g, forge.i);
  assert.ok(input.q && !input.r);
  for (const k of [ANVIL, DART]) g.heroes[AMBER + k].hp *= 0.4;
  assert.ok(botInput(g, forge.i).r);
});
