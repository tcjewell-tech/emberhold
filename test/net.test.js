import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimeline, createPredictor } from '../public/net.js';

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
