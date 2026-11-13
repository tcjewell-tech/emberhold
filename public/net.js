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
 * Reads the server's messages. Every message arrives as one stream of raw-deflate data
 * (newline-separated JSON), compressed by the server itself: some hosts' proxies strip the
 * WebSocket's own compression, which would send each player about 260 KB/s instead of about 25.
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
