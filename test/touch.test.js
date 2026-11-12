import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stickVector } from '../public/touch.js';

test('a thumb stick gives a direction and how far it is pushed, and ignores a resting thumb', () => {
  assert.deepEqual(stickVector(3, -4), { x: 0, y: 0, mag: 0 }, 'a small wobble is nothing');
  const half = stickVector(25, 0);
  assert.deepEqual([half.x, half.y, half.mag], [1, 0, 0.5]);
  const far = stickVector(0, -400);
  assert.deepEqual([far.x, far.y, far.mag], [0, -1, 1], 'dragging past the rim is still full speed, not more');
  const diag = stickVector(30, 30);
  assert.ok(Math.abs(Math.hypot(diag.x, diag.y) - 1) < 1e-9, 'the direction is always unit length');
});
