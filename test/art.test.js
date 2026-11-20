// A smoke test of the browser's drawing code, run in Node against a stand-in for the canvas. It cannot say
// whether anything looks right; it catches a module that no longer loads, a painter that throws, and a thing
// the game can hold that nothing can draw. interp.js and touch.js have their own tests of what they compute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRUCTS, ENEMIES, HEROES, HERO_IDS, POWERUPS, TEAMS, CELL, createGame, addStruct, spawnEnemy } from '../public/sim.js';

/** A 2D context that accepts anything and counts what it was asked to fill. Sprites are made on canvases like it. */
function fakeCanvas() {
  const made = { fills: 0 };
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...a) => {
      if (k === 'fillRect' || k === 'fill') made.fills++;
      return k === 'getImageData' ? { data: new Uint8ClampedArray(a[2] * a[3] * 4) } : ctx; // a gradient, a pattern: more of the same
    }),
    set: (t, k, v) => ((t[k] = v), true),
  });
  return { ctx, made, canvas: { width: 0, height: 0, getContext: () => ctx } };
}

test('every browser module but the client itself loads without a page', async () => {
  for (const file of ['art', 'interp', 'touch', 'sound', 'net', 'bots', 'sim']) await import(`../public/${file}.js`);
});

test('the art module keeps its scale, and has a mood for every match', async () => {
  const { PX, TILE, MOODS } = await import('../public/art.js');
  assert.equal(TILE, CELL * PX, 'a tile is one grid cell in art pixels');
  for (const seed of [0, 1, 2, 3, -7, 123456]) assert.ok(MOODS[createGame(seed).mood], `seed ${seed} has a mood`);
  for (const m of MOODS) for (const k of ['g', 'hi', 'lo', 'det', 'water', 'panel', 'panel2', 'edge']) assert.match(m[k], /^#[0-9a-f]{6}$/, `${m.name}.${k} is a colour`);
});

test('everything the game can hold has a painter, and each one draws without throwing', async (t) => {
  const { canvas, ctx, made } = fakeCanvas();
  globalThis.document = { createElement: () => fakeCanvas().canvas };
  t.after(() => delete globalThis.document);
  const { createArt, heroSprite, ground } = await import('../public/art.js');
  const art = createArt(ctx), g = createGame(1);
  const drew = (what, paint) => {
    const before = made.fills;
    paint();
    assert.ok(made.fills > before, `${what} drew nothing`);
  };

  for (const type of Object.keys(STRUCTS)) {
    assert.equal(typeof art[type], 'function', `no painter for the structure "${type}"`);
    const st = addStruct(g, type, 0, 40 + made.fills % 7, 30);
    drew(type, () => art[type](st, 10, 10));
    drew(`a damaged, upgraded ${type}`, () => art[type]({ ...st, tier: 2, hp: st.max * 0.3, wait: 0 }, 10, 10));
  }
  drew('the upgrade mark', () => art.tier2(10, 10));
  drew('the Core', () => art.core(80, 80, '#ffd35a', 700));
  for (const frac of [0, 0.4, 1]) drew(`the Core's ring at ${frac}`, () => art.coreRing(80, 80, frac, '#ffd35a', 700));
  drew('a shield field', () => art.field(g.structs.find((st) => st.type === 'shield'), 10, 10, 500));
  drew('a Sentry', () => art.turret({ ...g.structs.find((st) => st.type === 'turret'), ttl: 5 }, 10, 10));
  for (const a of [0, 1, 2, 3, 4, 5, 6]) drew(`the pointer at angle ${a}`, () => art.pointer(100, 100, a, '#ff6b6b', a * 300));

  for (const type of Object.keys(ENEMIES)) {
    const e = spawnEnemy(g, type, 0, 500, 500);
    art.enemy(e, 50, 50, 0); // a sprite, pasted with drawImage: nothing to count
    art.enemy({ ...e, stun: 1 }, 50, 50, 100);
    drew(`a ${type} with an Ash Storm's shield`, () => art.enemy({ ...e, shield: 20 }, 50, 50, 100, 43));
    drew(`the eyes of a ${type}`, () => art.eyes(e, 50, 50));
  }
  for (const h of g.heroes) {
    assert.ok(heroSprite(h.kind, h.team), `${h.kind} has a sprite`);
    for (const walking of [false, true]) art.hero({ ...h, shield: 20, shieldMax: 50 }, 50, 50, 1, { walking, mine: walking, t: 250, aegis: walking });
  }
  assert.deepEqual(Object.keys(HEROES), HERO_IDS, 'and there is no hero the loop above missed');
  TEAMS.forEach((_, k) => { art.ember(k, 60, 60, 0.5, true, 300); art.ember(k, 60, 60, 0, false, 300); });
  for (const kind of Object.keys(POWERUPS)) art.pickup({ kind, ttl: 2 }, 5, 5, 400);
  art.wreck(5, 5);
  drew('a shot', () => art.shot({ vx: 300, vy: 0, team: 0, owner: 1 }, 5, 5));
  for (const kind of ['ring', 'pop', 'heal', 'down', 'fall', 'power', 'blast', 'capture']) art.fx({ kind, team: 0, ttl: 0.2, r: 40 }, 5, 5, 20);
  drew('a spark', () => art.spark({ t: 0.1, life: 0.4, color: '#ffffff', size: 2 }, 5, 5));
  for (const mood of [0, 1, 2]) assert.ok(ground(mood), `mood ${mood} has ground`);
  assert.equal(canvas.width, 0, 'and nothing resized the screen');
});
