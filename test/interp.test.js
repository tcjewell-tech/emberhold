import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolate } from '../public/interp.js';

const snap = (over) => ({ t: 1, phase: 'day', heroes: [], enemies: [], shots: [], structs: [], ...over });

test('things in both snapshots glide between their two positions', () => {
  const a = snap({ heroes: [{ i: 0, x: 0, y: 0, aim: 0 }], enemies: [{ id: 5, x: 10, y: 10 }], shots: [{ id: 9, x: 100, y: 0 }] });
  const b = snap({ phase: 'night', heroes: [{ i: 0, x: 10, y: 20, aim: 1 }], enemies: [{ id: 5, x: 30, y: 10 }], shots: [{ id: 9, x: 140, y: 0 }] });
  const m = interpolate(a, b, 0.25);
  assert.deepEqual({ ...m.heroes[0], aim: 0 }, { i: 0, x: 2.5, y: 5, aim: 0 });
  assert.ok(Math.abs(m.heroes[0].aim - 0.25) < 1e-9);
  assert.deepEqual(m.enemies[0], { id: 5, x: 15, y: 10 });
  assert.deepEqual(m.shots[0], { id: 9, x: 110, y: 0 });
  assert.equal(m.phase, 'night', 'everything that is not a position comes from the newer snapshot');
  assert.deepEqual(interpolate(a, b, 0).heroes[0], a.heroes[0]);
  assert.deepEqual(interpolate(a, b, 1).heroes[0], b.heroes[0]);
});

test('new arrivals appear where the newer snapshot puts them; the departed vanish', () => {
  const a = snap({ enemies: [{ id: 5, x: 0, y: 0 }, { id: 6, x: 50, y: 50 }] });
  const b = snap({ enemies: [{ id: 5, x: 10, y: 0 }, { id: 7, x: 99, y: 99 }] });
  assert.deepEqual(interpolate(a, b, 0.5).enemies, [{ id: 5, x: 5, y: 0 }, { id: 7, x: 99, y: 99 }]);
});

test('a hero that teleported (respawn) is not smeared across the map', () => {
  const a = snap({ heroes: [{ i: 0, x: 0, y: 0, aim: 0 }] });
  const b = snap({ heroes: [{ i: 0, x: 900, y: 900, aim: 0 }] });
  assert.deepEqual(interpolate(a, b, 0.5).heroes[0], b.heroes[0]);
});

test('aim turns the short way round', () => {
  const a = snap({ heroes: [{ i: 0, x: 0, y: 0, aim: 3.1 }] });
  const b = snap({ heroes: [{ i: 0, x: 0, y: 0, aim: -3.1 }] });
  const aim = interpolate(a, b, 0.5).heroes[0].aim;
  assert.ok(Math.abs(Math.abs(aim) - Math.PI) < 0.05, `aim ${aim} should stay near pi, not swing through 0`);
});

test('with only one snapshot there is nothing to blend', () => {
  const b = snap({ heroes: [{ i: 0, x: 1, y: 2, aim: 0 }] });
  assert.equal(interpolate(null, b, 0.5), b);
});
