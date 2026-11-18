import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimeline, createPredictor, createGunPredictor, createBuildPredictor, createFxPredictor } from '../public/net.js';

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
  assert.equal(gun.hides(9), true, 'and a little longer: the picture runs behind the news, and still has it');
  gun.heard([], 3, 12, 1400);
  assert.equal(gun.hides(9), false, 'forgotten a second after it was last seen');
});

/**
 * A trigger held for five seconds on a line with the given one-way delays (ms), as the client plays it:
 * every stand-in volley sends an order, the server fires a volley for each order as soon as it is heard and
 * its cooldown allows, and its shots reach us with the next 30 Hz snapshot. We draw at 60 fps, `phase` ms
 * out of step with the server. Returns how many shots the server fired and how many pictures were drawn.
 */
function holdTrigger(gun, phase, up = 0, down = 0, gunDef = GUN) {
  const gapMs = 1000 / gunDef.rate, flight = (gunDef.range / gunDef.speed) * 1000, serverShots = [];
  const events = [];
  for (let n = 0; n * 1000 / 30 < 6500; n++) events.push({ at: n * 1000 / 30 + down, snap: n * 1000 / 30 });
  for (let n = 0; phase + n * 1000 / 60 < 6500; n++) events.push({ at: phase + n * 1000 / 60 });
  events.sort((a, b) => a.at - b.at);
  const copies = new Set();
  let standIns = 0, lastFired = -Infinity;
  for (const e of events) {
    if (e.snap === undefined) {
      if (!gun.step(FRAME, e.at, e.at < 5000 ? FROM : null, gunDef, 1, never)) continue;
      standIns += gunDef.pellets;
      lastFired = Math.max(e.at + up, lastFired + gapMs - 1000 * FRAME); // the order's volley: when it is heard, or when the gun has cooled
      for (let p = 0; p < gunDef.pellets; p++) serverShots.push({ id: serverShots.length + 1, owner: 3, fired: lastFired });
      continue;
    }
    const live = serverShots.filter((sh) => sh.fired <= e.snap && sh.fired > e.snap - flight);
    gun.heard(live, 3, serverShots.filter((sh) => sh.fired <= e.snap).length, e.at);
    for (const sh of live) if (!gun.hides(sh.id)) copies.add(sh.id);
  }
  return { fired: serverShots.length, standIns, copies: copies.size };
}

test('a held trigger draws every shot once, as its stand-in, with no lag or with a lot, whatever the frame timing', () => {
  for (const [up, down] of [[0, 0], [2, 2], [20, 20], [150, 150], [400, 400]]) {
    for (const phase of [0, 3, 7, 11, 15]) {
      const r = holdTrigger(createGunPredictor(), phase, up, down);
      assert.deepEqual([r.standIns, r.copies], [r.fired, 0], `${up + down} ms round trip, frames ${phase} ms out of step: ${r.standIns} stand-ins and ${r.copies} copies drawn for ${r.fired} fired`);
    }
  }
  const scatter = holdTrigger(createGunPredictor(), 7, 0, 0, { ...GUN, rate: 1.1, pellets: 6 });
  assert.deepEqual([scatter.standIns, scatter.copies], [scatter.fired, 0], 'a scattergun at no lag');
  const fast = holdTrigger(createGunPredictor(), 7, 75, 75, { ...GUN, rate: 16 });
  assert.deepEqual([fast.standIns, fast.copies], [fast.fired, 0], 'the fastest gun in the game (Dart in Overdrive)');
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

const wall = (cx, cy) => ({ type: 'wall', team: 0, cx, cy, cost: 10 });
const built = (cx, cy, more) => ({ type: 'wall', team: 0, cx, cy, ...more }); // as a snapshot shows it

test('an ordered structure is shown at once, charged until the server has it and kept until the drawn world has it', () => {
  const b = createBuildPredictor(1000);
  b.place(wall(4, 5), 0);
  assert.equal(b.list().length, 1);
  assert.equal(b.has(4, 5), true);
  assert.equal(b.cost(), 10);
  b.heard([], 100);
  b.shown([]);
  assert.equal(b.cost(), 10, 'no answer yet');
  b.heard([built(4, 5)], 200);
  assert.equal(b.cost(), 0, 'the newest snapshot has it: its Scrap is already gone from the team\'s');
  b.shown([]);
  assert.equal(b.list().length, 1, 'but the picture, which runs behind, does not show it yet');
  b.heard([built(4, 5)], 5000);
  assert.equal(b.list().length, 1, 'a paid order does not time out while its structure stands');
  b.shown([built(4, 5)]);
  assert.equal(b.list().length, 0, 'the real one has taken its place');
  assert.equal(b.has(4, 5), false);
});

test('an order the server has acted on and not built is taken away at once, and its Scrap comes back', () => {
  const b = createBuildPredictor(1000);
  b.place({ ...wall(4, 5), seq: 12 }, 0);
  b.place({ ...wall(5, 5), seq: 13 }, 10);
  b.heard([], 80, 11);
  assert.equal(b.cost(), 20, 'the server has not come to either yet');
  b.heard([], 110, 12);
  assert.deepEqual(b.list().map((o) => o.cx), [5], 'input 12 is done and nothing stands in its cell: refused, a round trip after the click');
  assert.equal(b.cost(), 10);
  assert.equal(b.has(4, 5), false, 'and the cell can be tried again');
  b.heard([built(5, 5)], 140, 13);
  assert.equal(b.cost(), 0, 'the other was built');
  assert.equal(b.list().length, 1);

  const other = createBuildPredictor(1000);
  other.place({ ...wall(6, 5), type: 'turret', seq: 20 }, 0);
  other.heard([built(6, 5), built(6, 5, { type: 'turret', team: 1 })], 50, 19);
  assert.equal(other.cost(), 10, 'a teammate\'s Wall or a rival\'s Turret in that cell is not ours');
  other.heard([built(6, 5)], 80, 20);
  assert.equal(other.list().length, 0, 'so with input 20 done, ours was refused');
});

test('an order the server never answers is taken away when its patience runs out', () => {
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
  b.heard([built(4, 5)], 200); // built
  b.heard([], 900); // destroyed, or removed, while the tab was in the background and nothing was being drawn
  b.shown([]);
  assert.equal(b.list().length, 0);
  assert.equal(b.has(4, 5), false, 'and the cell can be built on again');
});

test('our own ability burst shows at once, and the server copy of it is hidden when it arrives', () => {
  const fx = createFxPredictor(1000), ring = { kind: 'ring', x: 100, y: 100, r: 120, team: 0, owner: 0 };
  fx.cast(ring, 0);
  assert.equal(fx.list().length, 1, 'drawn from the moment of the key press');
  const { owner, ...slam } = { ...ring, id: 8 }; // a Colossus slam is a ring too, and nobody's
  const theirs = { ...ring, id: 7, team: 1, owner: 5 }, other = { ...ring, id: 9, kind: 'heal' }, copy = { ...ring, id: 10, x: 130 }, next = { ...ring, id: 11 };
  fx.heard([theirs, slam, other, copy, next], 6, 300);
  assert.deepEqual([7, 8, 9, 10, 11].map(fx.hides), [false, false, false, true, false], 'only the first burst of that kind that is our own hero\'s');
  fx.heard([copy], 11, 330);
  assert.equal(fx.hides(10), true, 'for as long as it lasts');
  fx.heard([], 11, 360);
  assert.equal(fx.hides(10), true, 'and a little longer, while the picture, which runs behind, still has it');
  fx.heard([], 11, 1400);
  assert.equal(fx.hides(10), false);
  for (let f = 0; f < 30; f++) fx.step(1 / 60);
  assert.equal(fx.list().length, 0, 'the local burst fades like any other, in 0.45 s');
});

test('a burst the server never answers stops waiting, and an old effect is never taken for its copy', () => {
  const fx = createFxPredictor(1000), heal = { kind: 'heal', x: 0, y: 0, r: 150, team: 2, owner: 12 };
  fx.cast(heal, 0);
  fx.heard([{ ...heal, id: 4 }], 5, 100);
  assert.equal(fx.hides(4), false, 'it was already there before we pressed the key');
  fx.heard([{ ...heal, id: 20 }], 5, 1500);
  assert.equal(fx.hides(20), false, 'a second has passed: that one is somebody else\u2019s');
});

test('two teammates using their Ultimates side by side each keep their own burst', () => {
  const ours = { kind: 'ult', x: 100, y: 100, r: 70, team: 0, owner: 3 }, mates = { ...ours, x: 110, owner: 4, id: 7 };
  const fx = createFxPredictor(1000);
  fx.cast(ours, 0);
  fx.heard([mates], 6, 100); // the teammate's reaches us first, a step away from where we stand
  assert.equal(fx.hides(7), false, 'the teammate\'s burst is drawn: it is not the copy of ours');
  fx.heard([mates, { ...ours, id: 9 }], 7, 130);
  assert.deepEqual([7, 9].map(fx.hides), [false, true], 'and ours, when it comes, is the one hidden');

  const theirs = createFxPredictor(1000); // the same moment on the teammate's screen
  theirs.cast({ ...ours, x: 110, owner: 4 }, 0);
  theirs.heard([mates, { ...ours, id: 9 }], 6, 130);
  assert.deepEqual([7, 9].map(theirs.hides), [true, false]);
});
