import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../public/sim.js';
import { botInput, nextPiece, RESERVE } from '../public/bots.js';

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

test('a bot Cog on a team with a human leaves the reserve in the pool, and spends freely once the team has 80', () => {
  const g = quiet(), cog = g.heroes[AMBER + COG], turret = S.buildCost('cog', 'turret');
  const builds = (scrap, reserve) => {
    g.teams[0].scrap = scrap;
    return botInput(g, cog.i, true, reserve).build !== null;
  };
  assert.equal(nextPiece(g, cog).type, 'turret', 'the first piece of the base is a Turret');
  assert.ok(builds(turret, 0), 'on a team of bots it spends its last Scrap');
  assert.ok(!builds(turret, RESERVE), 'beside a human it does not');
  assert.ok(!builds(turret + RESERVE - 1, RESERVE), 'nor when building would leave one Scrap less than the reserve');
  assert.ok(builds(turret + RESERVE, RESERVE), 'it builds when the reserve is left whole');
  assert.ok(builds(80, RESERVE), 'and with 80 in the pool');
});

// ---------------------------------------------------------------- Shield Generators and the Forge bot

test('every team\'s bot base adds Shield Generators after its first Turrets, their fields cover every guard post, and each group of pieces goes up nearest mid-map first', () => {
  const mid = { x: (S.TEAMS[0].x + S.TEAMS[1].x + S.TEAMS[2].x) / 3, y: (S.TEAMS[0].y + S.TEAMS[1].y + S.TEAMS[2].y) / 3 };
  for (const team of [0, 1, 2]) {
    const g = quiet(), cog = g.heroes[team * S.TEAM_SIZE + COG], built = [], name = S.TEAMS[team].name;
    g.teams[team].scrap = 1e6;
    for (let p; (p = nextPiece(g, cog)) && !p.up && built.length < 300;) built.push(Object.assign(S.addStruct(g, p.type, team, p.cx, p.cy), { wait: 0 }));
    assert.deepEqual(built.slice(0, 6).map((st) => st.type), ['turret', 'turret', 'turret', 'turret', 'shield', 'shield'], name);
    const gens = built.filter((st) => st.type === 'shield');
    assert.equal(gens.length, 4);
    for (let k = 0; k < S.TEAM_SIZE; k++) assert.ok(gens.some((st) => gap(st, S.post(team, k)) <= S.STRUCTS.shield.radius), `${name}: post ${k} is in a field`);
    // A group is a run of one type. Listed in one order for all, Azure spiked its gate facing mid-map first and Jade its own seventh.
    built.forEach((st, n) => n && built[n - 1].type === st.type && assert.ok(gap(st, mid) >= gap(built[n - 1], mid) - 1e-6, `${name}: piece ${n}, a ${st.type}, is nearer mid-map than the one before it`));
  }
});

test('the Forge bot goes to a broken structure at its base and Reforges it', () => {
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
});

test('the Forge bot keeps Aegis for the moment a wave lands on its squad', () => {
  const g = quiet();
  g.phase = 'night';
  g.wave = 3;
  const em = g.teams[0].ember, forge = g.heroes[AMBER + FORGE];
  forge.ult = 100;
  for (let k = 0; k < 12; k++) S.spawnEnemy(g, 'skitter', 0, em.x + 500, em.y - 120 + k * 20);
  assert.ok(!botInput(g, forge.i).r, 'the wave is still on its way');
  g.enemies.slice(0, 2).forEach((e) => place(e, forge.x + 20, forge.y));
  assert.ok(!botInput(g, forge.i).r, 'two that ran ahead are not the wave');
  g.enemies.forEach((e, k) => place(e, forge.x + 20, forge.y - 30 + k * 5));
  assert.ok(botInput(g, forge.i).r, 'the wave is on the squad');
  forge.ult = 99;
  assert.ok(!botInput(g, forge.i).r, 'nothing to spend');

  g.enemies = [];
  forge.ult = 100;
  g.heroes[AMBER + ANVIL].hp *= 0.4;
  assert.ok(!botInput(g, forge.i).r, 'one hurt teammate and no wave: it waits');
  g.heroes[AMBER + DART].hp *= 0.4;
  assert.ok(botInput(g, forge.i).r, 'two badly hurt teammates, as a raid leaves them: it does not');
});

test('a hurt Anvil bot Fortifies under fire from range, not only with a foe at arm’s length', () => {
  const g = quiet(), anvil = place(g.heroes[AMBER + ANVIL], MID.x, MID.y);
  place(g.heroes[AZURE + DART], MID.x + 400, MID.y); // well outside the Anvil's own gun
  assert.equal(botInput(g, anvil.i).r, false, 'unhurt: it keeps Fortify');
  anvil.hp = anvil.max * 0.5;
  assert.equal(botInput(g, anvil.i).r, true);
  place(g.heroes[AZURE + DART], MID.x + 900, MID.y);
  assert.equal(botInput(g, anvil.i).r, false, 'nobody in sight: nothing to Fortify against');
});

test('a Forge bot out on its own goes home when a rival hero comes in sight, but stands and fights with a teammate beside it', () => {
  const g = quiet(), forge = place(g.heroes[AMBER + FORGE], MID.x, MID.y), home = S.post(0, FORGE);
  const away = gap(forge, home), rival = g.heroes[AZURE + DART];
  place(rival, forge.x + ((forge.x - home.x) / away) * 400, forge.y + ((forge.y - home.y) / away) * 400); // on the far side from home
  let input = botInput(g, forge.i);
  assert.ok(heading(input, forge, home) > 0.9, 'alone: straight home');
  assert.equal(input.fire, true, 'shooting back as it goes');
  place(g.heroes[AMBER + COG], forge.x + 50, forge.y + 50);
  assert.ok(heading(botInput(g, forge.i), forge, rival) > 0.9, 'with company: it closes to firing range instead');
});

// ---------------------------------------------------------------- the Core and Eclipses

test('with the Core standing by day, the Dart and the Anvil go and hold it; the medic follows once one is there; Cog and Forge stay home', () => {
  const g = quiet();
  g.wave = 1;
  const core = (g.core = { x: S.ARENA.x, y: S.ARENA.y, team: -1, prog: 0 });
  const towards = (k) => heading(botInput(g, AMBER + k), g.heroes[AMBER + k], core);
  assert.ok(towards(DART) > 0.95 && towards(ANVIL) > 0.95, `Dart ${towards(DART)}, Anvil ${towards(ANVIL)}`);
  for (const k of [PATCH, COG, FORGE]) {
    const withCore = botInput(g, AMBER + k);
    g.core = null;
    assert.deepEqual(withCore, botInput(g, AMBER + k), `${g.heroes[AMBER + k].kind} does just what it would with no Core`);
    g.core = core;
  }
  place(g.heroes[AMBER + ANVIL], core.x + 150, core.y);
  assert.ok(towards(PATCH) > 0.95, 'the medic goes once a teammate is nearly there');

  const dart = place(g.heroes[AMBER + DART], core.x + 20, core.y), anvil = place(g.heroes[AMBER + ANVIL], core.x - 20, core.y);
  const there = [botInput(g, dart.i), botInput(g, anvil.i)];
  assert.deepEqual(there.map((i) => [i.mx, i.my]), [[0, 0], [0, 0]], 'in the Core, they stand');
  const rival = place(g.heroes[AZURE + DART], core.x + 200, core.y);
  const holds = botInput(g, anvil.i), kites = botInput(g, dart.i);
  assert.ok(holds.fire && Math.abs(holds.aim) < 0.01 && kites.fire, 'both shoot the rival that comes for it');
  assert.ok(kites.mx < -0.9 && holds.mx === 0, 'each fighting as it does anywhere: the Dart backs off to its range, the Anvil is at its own already');
  place(rival, 300, 300);

  S.spawnEnemy(g, 'breaker', 0, g.teams[0].ember.x + 200, g.teams[0].ember.y);
  place(dart, g.teams[0].ember.x + 600, g.teams[0].ember.y);
  assert.ok(heading(botInput(g, dart.i), dart, core) < 0.5, 'and with its Ember under attack, home comes first');
});

test('on a Volatile night a bot backs away from an AI enemy that is about to burst, unless it is unhurt and the burst is small', () => {
  const g = quiet(), dart = place(g.heroes[AMBER + DART], MID.x, MID.y);
  g.phase = 'night';
  const e = S.spawnEnemy(g, 'skitter', 0, MID.x + 60, MID.y);
  e.hp = 25;
  dart.hp = dart.max - 1;
  const steps = () => heading(botInput(g, dart.i), dart, e);
  const calm = steps();
  g.eclipse = 'volatile';
  assert.ok(steps() < -0.95, `straight away from it: ${steps()}`);
  assert.ok(calm > -0.95, 'which it does not do on another night');
  e.hp = 40;
  assert.equal(steps(), calm, 'nor from one with health to spare');
  e.hp = 25;
  dart.hp = dart.max;
  assert.equal(steps(), calm, 'at full health one small burst is not worth moving for');
  S.spawnEnemy(g, 'skitter', 0, MID.x + 60, MID.y + 20).hp = 25;
  assert.ok(steps() < -0.95, 'two are, and it backs away from the nearer');
});

test('how near death an AI enemy must be before a bot clears out grows with the enemy: a late Breaker long before a Skitter', () => {
  const flees = (wave, type, hp, endless = false) => {
    const g = Object.assign(quiet(), { wave, endless, phase: 'night', eclipse: 'volatile' }), dart = place(g.heroes[AMBER + DART], MID.x, MID.y);
    dart.hp = dart.max - 1; // hurt at all, it can afford no burst
    S.spawnEnemy(g, type, 0, MID.x + 60, MID.y).hp = hp;
    return heading(botInput(g, dart.i), dart, g.enemies[0]) < -0.95;
  };
  // A Breaker has 260 health on night 1 and 780 on night 9: 16% of those is 41.6 and 124.8. A Skitter's 16% never passes the floor of 30 here.
  assert.deepEqual([flees(1, 'breaker', 45), flees(1, 'breaker', 40)], [false, true]);
  assert.deepEqual([flees(9, 'breaker', 130), flees(9, 'breaker', 120)], [false, true], 'on night 9 it leaves a Breaker with 120 left, four times what it used to wait for');
  assert.deepEqual([flees(9, 'skitter', 31), flees(9, 'skitter', 30)], [false, true], 'the floor still holds for small ones');
  assert.deepEqual([flees(9, 'breaker', 100, true), flees(9, 'breaker', 80, true)], [false, true], 'endless night 9 is as hard as night 5: 16% of 520 is 83.2');
});

test('on a Volatile night a medic at a dying teammate and a Fortified Anvil stay while they can afford it, and a Forge on a repair run keeps a wider berth', () => {
  const night = () => Object.assign(quiet(), { phase: 'night', eclipse: 'volatile' });
  const bomb = (g, x, y) => Object.assign(S.spawnEnemy(g, 'skitter', 0, x, y), { hp: 25 });

  let g = night();
  const patch = place(g.heroes[AMBER + PATCH], MID.x, MID.y), mate = place(g.heroes[AMBER + COG], MID.x - 120, MID.y);
  patch.hp = patch.max - 1;
  const e = bomb(g, MID.x + 60, MID.y);
  mate.hp = mate.max * 0.25;
  assert.ok(heading(botInput(g, patch.i), patch, mate) > 0.95, 'a teammate under 30%: the medic goes on to it past the burst');
  mate.hp = mate.max * 0.5;
  assert.ok(heading(botInput(g, patch.i), patch, e) < -0.95, 'one that can wait: it steps clear first');
  mate.hp = mate.max * 0.25;
  for (const dy of [8, 16, 24, 32]) bomb(g, MID.x + 60, MID.y + dy);
  assert.ok(heading(botInput(g, patch.i), patch, e) < -0.95, 'and five bursts at once would cost it most of its own health: it steps clear');

  g = night();
  const anvil = place(g.heroes[AMBER + ANVIL], MID.x, MID.y);
  anvil.hp = anvil.max - 1;
  bomb(g, MID.x + 60, MID.y);
  const flees = () => heading(botInput(g, anvil.i), anvil, g.enemies[0]) < -0.95;
  assert.ok(flees(), 'an Anvil that is hurt steps clear');
  anvil.fortify = 3;
  assert.ok(!flees(), 'Fortified, it takes a quarter of the burst and stays in the fight');

  g = night();
  const em = g.teams[0].ember, wall = S.addStruct(g, 'wall', 0, em.x / S.CELL + 5, em.y / S.CELL);
  wall.hp = 100;
  bomb(g, wall.x - 160, wall.y); // 90 from the two heroes below: outside a burst's 75, inside a Forge's berth
  const walks = (k) => {
    const h = place(g.heroes[AMBER + k], wall.x - 250, wall.y), was = (g.eclipse = null, botInput(g, h.i));
    g.eclipse = 'volatile';
    return [heading(was, h, wall), heading(botInput(g, h.i), h, wall), was];
  };
  const [before, after] = walks(FORGE);
  assert.ok(before > 0.95 && after < -0.95, `the Forge was walking to the broken Wall (${before}) and now backs off (${after}), unhurt as it is`);
  const cog = walks(COG); // leaves the Cog there on a Volatile night
  assert.deepEqual(botInput(g, AMBER + COG), cog[2], 'a Cog on the same spot is out of reach and carries on as on any night');
});

test('of two hostiles with the same health a bot shoots the nearer, not the one whose team comes first', () => {
  const g = quiet(), dart = place(g.heroes[AMBER + DART], MID.x, MID.y), JADE = 2 * S.TEAM_SIZE;
  const azure = place(g.heroes[AZURE + DART], MID.x + 300, MID.y), jade = place(g.heroes[JADE + DART], MID.x - 200, MID.y);
  assert.ok(Math.abs(Math.abs(botInput(g, dart.i).aim) - Math.PI) < 0.01, 'Jade\'s Dart, to the west: nearer, though Azure\'s comes first in the list');
  place(azure, MID.x + 200, MID.y);
  place(jade, MID.x - 300, MID.y);
  assert.ok(Math.abs(botInput(g, dart.i).aim) < 0.01, 'and Azure\'s when that is the nearer');
  jade.hp -= 1;
  assert.ok(Math.abs(Math.abs(botInput(g, dart.i).aim) - Math.PI) < 0.01, 'health still comes before distance');
});
