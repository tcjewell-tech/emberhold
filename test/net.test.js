import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimeline, createPredictor, createGunPredictor, createBuildPredictor } from '../public/net.js';

// ---------------------------------------------------------------- timeline

/**
 * Snapshots leave the server every 33.3 ms and arrive `late(k)` ms after the fastest possible
 * delivery; the client draws at 60 fps. Returns what happened on every frame after warm-up.
 */
function watch({ late, seconds = 6, warmup = 2, clockGap = 5000 }) {
  const tl = createTimeline();
  const arrivals = [];
  for (let k = 0; k < seconds * 30; k++) arrivals.push({ serverMs: k * 1000 / 30, at: clockGap + k * 1000 / 30 + late(k) });
  arrivals.sort((a, b) => a.at - b.at);
  const frames = [];
  let newest = -Infinity;
  for (let f = 0; f < seconds * 60; f++) {
    const now = clockGap + f * 1000 / 60;
    while (arrivals.length && arrivals[0].at <= now) {
      const a = arrivals.shift();
      tl.arrive(a.serverMs, a.at);
      newest = Math.max(newest, a.serverMs);
    }
    if (newest === -Infinity) continue;
    const at = tl.at(now);
    if (now - clockGap >= warmup * 1000) frames.push({ now, at, behind: now - clockGap - at, starved: at > newest });
  }
  return frames;
}

test('on a steady line the timeline draws a fixed short way behind the server', () => {
  const frames = watch({ late: () => 40 });
  for (const f of frames) assert.ok(f.behind > 100 && f.behind < 125, `drew ${f.behind} ms behind (40 ms line + about 70)`);
  assert.equal(frames.filter((f) => f.starved).length, 0);
});

test('on a jittery line it draws further behind, so it never runs out of snapshots', () => {
  let r = 7;
  const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const frames = watch({ late: () => 40 + rand() * 60 });
  assert.equal(frames.filter((f) => f.starved).length, 0, 'always has a newer snapshot to blend towards');
  assert.ok(frames.every((f) => f.behind < 40 + 70 + 60 + 20), 'but no further behind than the jitter calls for');
});

test('the timeline never runs backwards, even through a lag spike', () => {
  const frames = watch({ late: (k) => (k >= 90 && k < 100 ? 250 : 20), warmup: 0 });
  for (let k = 1; k < frames.length; k++) assert.ok(frames[k].at > frames[k - 1].at, `frame ${k} went back in time`);
});

test('after a spike it settles back to drawing close behind', () => {
  const frames = watch({ late: (k) => (k >= 30 && k < 40 ? 250 : 20), seconds: 20, warmup: 18 });
  assert.ok(frames.every((f) => f.behind < 20 + 70 + 30), `still ${frames[0].behind} ms behind`);
});

test('a jump in the server clock (a new match server) is taken as a fresh start', () => {
  const tl = createTimeline();
  tl.arrive(500000, 1000);
  tl.arrive(0, 3000); // the server restarted: its clock is back at zero
  tl.arrive(33, 3033);
  const at = tl.at(3040);
  assert.ok(at > -100 && at < 40, `drawing at ${at}`);
});

// ---------------------------------------------------------------- own-hero prediction

/**
 * One hero walking east on a line with `lag` ms each way. The client moves itself at once and
 * sends inputs; the server moves the real hero when they arrive and sends its position back.
 */
function drive({ lag, seconds, walkFor = 0, speed = 200, knock, each }) {
  const me = createPredictor();
  me.place({ x: 0, y: 0 });
  const server = { x: 0, mx: 0, ack: 0 };
  const up = [], down = [];
  let seq = 0;
  for (let f = 0; f < seconds * 60; f++) {
    const t = f * 1000 / 60, mx = t < walkFor * 1000 ? 1 : 0;
    while (up.length && up[0].at <= t) Object.assign(server, { mx: up[0].mx, ack: up.shift().seq });
    server.x += (server.mx * speed) / 60;
    if (knock && Math.abs(t - knock.at * 1000) < 1) server.x += knock.by;
    if (f % 2 === 0) down.push({ at: t + lag, ack: server.ack, x: server.x });

    while (down.length && down[0].at <= t) {
      const m = down.shift();
      me.heard(m.ack, { x: m.x, y: 0 });
    }
    me.x += (mx * speed) / 60;
    me.settle(1 / 60);
    if (f % 2 === 0) {
      me.sent(++seq);
      up.push({ at: t + lag, seq, mx });
    }
    if (each) each({ t: t / 1000, me, server, ideal: (speed * Math.min(t + 1000 / 60, walkFor * 1000)) / 1000 });
  }
  return { me, server };
}

test('with 200 ms of round-trip lag, your hero still moves exactly as your keys say', () => {
  let worst = 0;
  const { me, server } = drive({ lag: 100, seconds: 3, walkFor: 2, each: ({ me, ideal }) => (worst = Math.max(worst, Math.abs(me.x - ideal))) });
  assert.ok(worst < 8, `drifted ${worst.toFixed(1)} px from where the keys put it (no rubber-banding, no slide after stopping)`);
  assert.ok(Math.abs(me.x - server.x) < 1, 'and ends where the server has it');
});

test('when the server moves your hero (a knock-back), the prediction glides there without overshooting', () => {
  let most = 0;
  const { me, server } = drive({ lag: 100, seconds: 2.5, knock: { at: 1, by: 60 }, each: ({ me }) => (most = Math.max(most, me.x)) });
  assert.equal(server.x, 60);
  assert.ok(Math.abs(me.x - 60) < 1, `ended at ${me.x}`);
  assert.ok(most <= 60.5, `overshot to ${most}`);
});

test('a big jump (a dash, a respawn) is taken at once rather than glided', () => {
  const seen = [];
  drive({ lag: 100, seconds: 1.5, knock: { at: 1, by: 300 }, each: ({ t, me }) => seen.push({ t, x: me.x }) });
  const firstMove = seen.find((p) => p.x > 0);
  assert.equal(firstMove.x, 300, 'one step, no in-between positions');
});

test('a snapshot from before the server heard us is not mistaken for an error', () => {
  const me = createPredictor();
  me.place({ x: 0, y: 0 });
  me.sent(1);
  me.x = 30; // walked on while input 1 is still on its way
  me.heard(0, { x: 0, y: 0 });
  for (let k = 0; k < 60; k++) me.settle(1 / 60);
  assert.equal(me.x, 30);
});

// ---------------------------------------------------------------- own shots and builds, predicted

const GUN = { rate: 4, pellets: 1, spread: 0, range: 400, speed: 800 };
const FROM = { x: 100, y: 100, aim: 0, team: 0 };
const FRAME = 1 / 60, never = () => false;
const mine = (id) => ({ id, owner: 3 });

test('a held trigger fires a stand-in shot at once, then at the gun\'s own rate', () => {
  const gun = createGunPredictor();
  assert.equal(gun.step(FRAME, 0, FROM, GUN, 1, never), true, 'on the very first frame');
  assert.equal(gun.shots.length, 1);
  assert.ok(Math.abs(gun.shots[0].x - (100 + 800 * FRAME)) < 1e-9 && gun.shots[0].y === 100, 'it flies along the aim');
  let volleys = 1;
  for (let f = 1; f < 600; f++) volleys += gun.step(FRAME, f * 1000 * FRAME, FROM, GUN, 1, never);
  assert.ok(volleys === 40 || volleys === 41, `10 s at 4 a second: ${volleys}`);

  const fast = createGunPredictor();
  let doubled = 0;
  for (let f = 0; f < 600; f++) doubled += fast.step(FRAME, f * 1000 * FRAME, FROM, GUN, 2, never);
  assert.ok(doubled === 80 || doubled === 81, `twice as fast under a multiplier: ${doubled}`);

  const idle = createGunPredictor();
  assert.equal(idle.step(FRAME, 0, null, GUN, 1, never), false, 'no trigger, no shot');
  assert.equal(idle.shots.length, 0);
});

test('a scattergun fires every pellet, fanned across its spread', () => {
  const gun = createGunPredictor(), rolls = [0, 0.5, 1];
  gun.step(FRAME, 0, FROM, { ...GUN, pellets: 3, spread: 0.4 }, 1, never, () => rolls.shift());
  assert.deepEqual(gun.shots.map((sh) => +Math.atan2(sh.vy, sh.vx).toFixed(6)), [-0.2, 0, 0.2]);
});

test('stand-in shots fly until their range runs out or something blocks them', () => {
  const gun = createGunPredictor();
  gun.step(FRAME, 0, FROM, GUN, 1, never);
  for (let f = 1; f < 29; f++) gun.step(FRAME, f, null, GUN, 1, never);
  assert.equal(gun.shots.length, 1, 'still in range after 29 frames (387 of 400 units)');
  gun.step(FRAME, 30, null, GUN, 1, never);
  gun.step(FRAME, 31, null, GUN, 1, never);
  assert.equal(gun.shots.length, 0, 'spent');

  gun.step(1, 2000, null, GUN, 1, never); // let the cooldown run out
  gun.step(FRAME, 3000, FROM, GUN, 1, (sh) => sh.x > 150);
  for (let f = 0; f < 5; f++) gun.step(FRAME, 3000, null, GUN, 1, (sh) => sh.x > 150);
  assert.equal(gun.shots.length, 0, 'stopped by what it ran into');
});

test('the server\'s copy of a predicted shot is hidden; a shot nobody predicted is shown', () => {
  const gun = createGunPredictor();
  gun.heard([mine(5)], 3, 5, 0);
  assert.equal(gun.hides(5), false, 'fired before we predicted anything: drawn as the server sends it');
  gun.step(FRAME, 100, FROM, GUN, 1, never);
  gun.heard([mine(5), mine(9), { id: 10, owner: 4 }], 3, 10, 250);
  assert.equal(gun.hides(9), true, 'the copy of our stand-in');
  assert.equal(gun.hides(5), false);
  assert.equal(gun.hides(10), false, 'someone else\'s shot is never hidden');
  gun.heard([mine(9), mine(12)], 3, 12, 280);
  assert.equal(gun.hides(9), true, 'for as long as it flies');
  assert.equal(gun.hides(12), false, 'one stand-in hides one copy, not the next shot as well');
  gun.heard([], 3, 12, 310);
  assert.equal(gun.hides(9), false, 'forgotten once it is gone');
});

test('a stand-in the server never answers stops waiting, so a later shot is not hidden by mistake', () => {
  const gun = createGunPredictor(1000);
  gun.step(FRAME, 0, FROM, GUN, 1, never);
  gun.heard([mine(7)], 3, 7, 1500);
  assert.equal(gun.hides(7), false);
});

test('a new match starts its ids again, and prediction carries on', () => {
  const gun = createGunPredictor();
  gun.heard([], 3, 5000, 0);
  gun.heard([], 3, 20, 100); // the new match's first snapshot
  gun.step(FRAME, 200, FROM, GUN, 1, never);
  gun.heard([mine(31)], 3, 31, 300);
  assert.equal(gun.hides(31), true);
});

const wall = (cx, cy) => ({ type: 'wall', cx, cy, cost: 10 });

test('an ordered structure is shown at once, charged until the server has it and kept until the drawn world has it', () => {
  const b = createBuildPredictor(1000);
  b.place(wall(4, 5), 0);
  assert.equal(b.list().length, 1);
  assert.equal(b.has(4, 5), true);
  assert.equal(b.cost(), 10);
  b.heard([], 100);
  b.shown([]);
  assert.equal(b.cost(), 10, 'no answer yet');
  b.heard([{ cx: 4, cy: 5 }], 200);
  assert.equal(b.cost(), 0, 'the newest snapshot has it: its Scrap is already gone from the team\'s');
  b.shown([]);
  assert.equal(b.list().length, 1, 'but the picture, which runs behind, does not show it yet');
  b.heard([{ cx: 4, cy: 5 }], 5000);
  assert.equal(b.list().length, 1, 'a paid order does not time out while its structure stands');
  b.shown([{ cx: 4, cy: 5 }]);
  assert.equal(b.list().length, 0, 'the real one has taken its place');
  assert.equal(b.has(4, 5), false);
});

test('an order the server refuses is taken away when its patience runs out', () => {
  const b = createBuildPredictor(1000);
  b.place(wall(1, 1), 0);
  b.place(wall(2, 1), 600);
  b.heard([], 999);
  assert.equal(b.list().length, 2);
  b.heard([], 1001);
  assert.deepEqual(b.list().map((o) => o.cx), [2], 'the first has waited a second');
  assert.equal(b.cost(), 10);
});

test('an order that was built and is gone again before the picture showed it is dropped, not left as a ghost', () => {
  const b = createBuildPredictor(1000);
  b.place(wall(4, 5), 0);
  b.heard([{ cx: 4, cy: 5 }], 200); // built
  b.heard([], 900); // destroyed, or removed, while the tab was in the background and nothing was being drawn
  b.shown([]);
  assert.equal(b.list().length, 0);
  assert.equal(b.has(4, 5), false, 'and the cell can be built on again');
});
