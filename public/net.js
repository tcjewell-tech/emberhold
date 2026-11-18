// Client netcode that has to stay right over a slow, uneven connection. No DOM, so Node can test it.

/**
 * Decides which moment of the match to draw. Snapshots carry the server's clock and arrive
 * late and unevenly; this lines the two clocks up by the fastest delivery seen, then draws far
 * enough behind (base ms, plus the lateness it has been seeing) that there is always a newer
 * snapshot to blend towards.
 */
export function createTimeline({ base = 70, max = 350 } = {}) {
  let offset = null, late = 0, delay = base, last = null;
  return {
    /** A snapshot stamped serverMs arrived at local time now. */
    arrive(serverMs, now) {
      const d = now - serverMs;
      if (offset === null || d - offset > 1000) {
        offset = d; // first snapshot, or the server's clock jumped (a new match server): start afresh
        late = 0;
        return;
      }
      offset = Math.min(d, offset + 0.05); // creeps up, so a route that has got slower is followed in time
      late = Math.max(d - offset, late * 0.99);
    },
    /** The server time to draw at local time now. Never runs backwards. */
    at(now) {
      if (offset === null) return 0;
      const want = Math.min(max, base + late);
      const room = last === null ? Infinity : (now - last) * 0.1; // retime at a tenth of real speed at most: no visible jumps
      delay += Math.max(-room, Math.min(room, want - delay));
      last = now;
      return now - offset - delay;
    },
  };
}

/**
 * This player's own hero, drawn where their keys put it rather than where the server last saw
 * it. Each snapshot says which of our inputs the server had heard (ack); its position is
 * compared with where we had predicted ourselves when that input went out, so lag alone never
 * looks like an error. Real disagreements (a knock-back, a hit we did not foresee) glide in.
 * The caller moves x and y itself, then calls settle().
 */
export function createPredictor(snap = 120) {
  const sent = []; // where we were as each recent input went out
  let ex = 0, ey = 0; // correction still to glide in
  const shift = (dx, dy) => {
    me.x += dx;
    me.y += dy;
    for (const p of sent) { // past positions move too, or the same error would be corrected twice
      p.x += dx;
      p.y += dy;
    }
  };
  const me = {
    x: 0, y: 0, aim: 0, known: false,
    /** Take the server's word outright: a spawn, a dash, anything too far to glide. */
    place(p) {
      sent.length = 0;
      ex = ey = 0;
      Object.assign(me, { x: p.x, y: p.y, known: true });
    },
    /** Input number seq is going out now. */
    sent(seq) {
      sent.push({ seq, x: me.x, y: me.y });
      if (sent.length > 128) sent.shift();
    },
    /** The server, having heard input ack, has our hero at p. */
    heard(ack, p) {
      if (!me.known) return;
      const was = sent.find((e) => e.seq === ack);
      if (!was) return; // it has not heard anything we sent since we were last placed: nothing to compare yet
      const dx = p.x - was.x, dy = p.y - was.y;
      if (Math.hypot(dx, dy) > snap) return me.place(p);
      ex = dx;
      ey = dy;
    },
    settle(dt) {
      const k = Math.min(1, dt * 8);
      shift(ex * k, ey * k);
      ex -= ex * k;
      ey -= ey * k;
    },
  };
  return me;
}

/**
 * This player's own shots, drawn the moment the trigger is pulled instead of a round trip later,
 * when the server's copies arrive. step() fires local stand-ins at the gun's own rate and flies
 * them; the client orders a volley from the server each time step() makes one, and the server
 * fires one volley an order, so a stand-in always stands before its copy can come. heard() is
 * shown each snapshot's shots and hides the server's copy of every stand-in, so no shot is drawn
 * twice. A shot of ours that nobody predicted is drawn as usual, and a stand-in the server never
 * answers (the hero went down first) just flies out: only the picture is predicted, never a hit.
 * patience: ms a stand-in waits for its copy before we stop expecting one.
 */
export function createGunPredictor(patience = 1000) {
  // owed: when each unanswered stand-in gives up. hidden: the copies we do not draw, each with the time to forget it.
  const shots = [], owed = [], hidden = new Map();
  let cd = 0, last = 0;
  return {
    shots,
    /**
     * dt seconds pass, ending at local time now (ms). from is { x, y, aim, team } while the trigger is
     * held and the hero can fire, else null. gun: its row in HEROES; mult: fire-rate multiplier;
     * blocked(shot): has it hit something or left the arena. Returns true if a volley was fired.
     */
    step(dt, now, from, gun, mult, blocked, random = Math.random) {
      cd = Math.max(-dt, cd - dt); // the sim's own cooldown rule, so the two keep the same beat
      const fired = from !== null && cd <= 0;
      if (fired) {
        cd += 1 / (gun.rate * mult);
        for (let p = 0; p < gun.pellets; p++) {
          const a = from.aim + (random() - 0.5) * gun.spread; // the server rolls its own spread: ours only looks the part
          shots.push({ x: from.x, y: from.y, vx: Math.cos(a) * gun.speed, vy: Math.sin(a) * gun.speed, ttl: gun.range / gun.speed, team: from.team });
          owed.push(now + patience);
        }
      }
      for (let k = shots.length - 1; k >= 0; k--) {
        const sh = shots[k];
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        sh.ttl -= dt;
        if (sh.ttl <= 0 || blocked(sh)) shots.splice(k, 1);
      }
      return fired;
    },
    /** A snapshot arrived at local time now: its shots, our hero's slot, and the newest id it has given out. */
    heard(all, slot, newest, now) {
      while (owed.length && owed[0] < now) owed.shift();
      if (newest < last) hidden.clear(); // ids start again in a new match
      for (const sh of all) {
        if (sh.owner !== slot) continue;
        // A new shot of ours is the copy of the oldest stand-in still waiting. Once hidden it stays hidden for a
        // while after the server drops it: the picture runs behind the news, and is still showing it.
        if (sh.id > last ? owed.shift() !== undefined : hidden.has(sh.id)) hidden.set(sh.id, now + patience);
      }
      for (const [id, until] of hidden) if (until < now) hidden.delete(id);
      last = newest;
    },
    /** Is this server shot one we are already drawing a stand-in for? */
    hides: (id) => hidden.has(id),
  };
}

/**
 * Structures this player has just ordered, shown at once while the server's answer is on its way.
 * place() adds one. heard() is shown the newest snapshot's structures and the last of our inputs
 * whose orders the server has tried (the snapshot's `done`): an order whose structure (same cell, team, type and tier) now stands is paid
 * for; one the server has acted on without building it was refused and is dropped at once, as is
 * one still unanswered after `patience` ms (a lost connection) and a paid one whose structure is
 * already gone again. shown() is given the structures
 * being drawn (a little behind the newest), and drops each paid order once they include it, so
 * the stand-in hands over to the real thing without a gap.
 */
export function createBuildPredictor(patience = 1000) {
  let orders = [];
  const at = (list, o) => list.some((st) => st.cx === o.cx && st.cy === o.cy && st.team === o.team && st.type === o.type && (st.tier ?? 1) === (o.tier ?? 1)); // an upgrade is answered by the upgraded structure, not the one it was ordered on
  return {
    list: () => orders,
    /** o: a structure-shaped object (type, team, cx, cy, ...) with its cost in Scrap and the seq of the input that orders it. */
    place(o, now) {
      orders.push({ ...o, paid: false, until: now + patience });
    },
    /** done: the last of our inputs whose orders the server has tried (the snapshot's `done` entry for our slot). */
    heard(structs, now, done = -1) {
      orders = orders.filter((o) => {
        const built = at(structs, o);
        if (o.paid && !built) return false; // built, and destroyed or removed before the picture ever showed it
        o.paid = built;
        return built || (!(done >= o.seq) && o.until > now); // tried and not built: refused, so its Scrap and its picture go back now
      });
    },
    shown(structs) {
      orders = orders.filter((o) => !(o.paid && at(structs, o)));
    },
    has: (cx, cy) => orders.some((o) => o.cx === cx && o.cy === cy),
    /** Scrap promised to orders the server has not yet charged for. */
    cost: () => orders.reduce((t, o) => t + (o.paid ? 0 : o.cost), 0),
  };
}

/**
 * This player's own ability bursts, shown the moment the key is pressed. cast() adds a local
 * burst; heard() is shown each snapshot's effects and hides the server's copy of each burst
 * when it arrives: the first new effect of that kind with our hero's slot as its owner (the sim
 * puts an owner on the effect of a hero's Q or R, so a teammate's beside us is never taken for ours).
 * patience: ms we wait for that copy.
 */
export function createFxPredictor(patience = 1000) {
  let local = [], owed = [];
  const hidden = new Map(); // the copies we do not draw, each with the time to forget it
  return {
    list: () => local,
    /** f: { kind, x, y, r, team, owner }, as the sim's own effect of a hero's Q or R is. */
    cast(f, now) {
      local.push({ ...f, id: 0, ttl: 0.45 }); // an effect lasts 0.45 s in the sim
      owed.push({ ...f, until: now + patience });
    },
    step(dt) {
      for (const f of local) f.ttl -= dt;
      local = local.filter((f) => f.ttl > 0);
    },
    /** fx: a snapshot's effects. last: the newest id the snapshot before it had given out. */
    heard(fx, last, now) {
      owed = owed.filter((o) => o.until > now);
      for (const f of fx) {
        const k = f.id > last && f.owner !== undefined ? owed.findIndex((o) => o.kind === f.kind && o.owner === f.owner) : -1;
        if (k < 0) continue;
        owed.splice(k, 1);
        hidden.set(f.id, now + patience); // outlasts the effect: the picture runs behind the news, and shows it a little longer
      }
      for (const [id, until] of hidden) if (until < now) hidden.delete(id);
    },
    hides: (id) => hidden.has(id),
  };
}

/**
 * Reads the server's messages. Every message arrives as one stream of raw-deflate data
 * (newline-separated JSON), compressed by the server itself: some hosts' proxies strip the
 * WebSocket's own compression, which would send each player about 700 KB/s instead of about 40.
 * Returns feed(data): pass it each message's ArrayBuffer, in order.
 */
export function createUnpacker(onMessage) {
  const ds = new DecompressionStream('deflate-raw'), writer = ds.writable.getWriter();
  const reader = ds.readable.pipeThrough(new TextDecoderStream()).getReader();
  (async () => {
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += value;
      for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) onMessage(JSON.parse(buf.slice(0, i)));
    }
  })().catch(() => {}); // a broken stream means a dead connection, which reconnects anyway
  return (data) => writer.write(new Uint8Array(data)).catch(() => {});
}
