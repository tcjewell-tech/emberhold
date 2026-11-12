import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stickVector, aimAssist } from '../public/touch.js';

test('a thumb stick gives a direction and how far it is pushed, and ignores a resting thumb', () => {
  assert.deepEqual(stickVector(3, -4), { x: 0, y: 0, mag: 0 }, 'a small wobble is nothing');
  const half = stickVector(25, 0);
  assert.deepEqual([half.x, half.y, half.mag], [1, 0, 0.5]);
  const far = stickVector(0, -400);
  assert.deepEqual([far.x, far.y, far.mag], [0, -1, 1], 'dragging past the rim is still full speed, not more');
  const diag = stickVector(30, 30);
  assert.ok(Math.abs(Math.hypot(diag.x, diag.y) - 1) < 1e-9, 'the direction is always unit length');
});

test('touch aim snaps to a hostile close to where the thumb points', () => {
  const me = { x: 0, y: 0 }, foe = { x: 300, y: 30 }; // about 0.1 rad below straight east
  const aim = aimAssist(0, me, [foe], 400);
  assert.ok(Math.abs(aim - Math.atan2(30, 300)) < 1e-9);
});

test('touch aim is left alone when nothing is near the line of fire or in range', () => {
  const me = { x: 0, y: 0 };
  assert.equal(aimAssist(0, me, [{ x: 0, y: 300 }], 400), 0, 'a hostile off to the side');
  assert.equal(aimAssist(0, me, [{ x: 900, y: 0 }], 400), 0, 'a hostile out of range');
  assert.equal(aimAssist(1.2, me, [], 400), 1.2, 'nobody about');
});

test('with two hostiles in the cone, touch aim takes the one nearer the thumb direction', () => {
  const me = { x: 0, y: 0 }, near = { x: 200, y: 10 }, wide = { x: 200, y: -50 };
  assert.ok(Math.abs(aimAssist(0, me, [wide, near], 400) - Math.atan2(10, 200)) < 1e-9);
  assert.ok(Math.abs(aimAssist(Math.PI - 0.05, me, [{ x: -200, y: -10 }], 400) - Math.atan2(-10, -200)) < 1e-9, 'works across the +-180 degree seam');
});
