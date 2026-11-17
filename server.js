// Emberhold server: serves public/ and runs the one authoritative match over WebSocket.
// Clients only send inputs and draw the snapshots they get back.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { networkInterfaces, hostname } from 'node:os';
import { isIP } from 'node:net';
import { createDeflateRaw, constants } from 'node:zlib';
import { WebSocketServer } from 'ws';
import { createGame, step, snapshot, STRUCTS, TEAMS, TEAM_SIZE, teamOf } from './public/sim.js';
import { botInput } from './public/bots.js';

const PUBLIC = join(import.meta.dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const TICK = 1 / 60;
const SLOTS = TEAMS.length * TEAM_SIZE;
const FLOOD = 1000; // messages one connection may send per heartbeat; a real client sends about 150
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v) => (Number.isFinite(v) ? v : 0);
// An aim of 2^52 or more is the same bearing, but the gun's spread is too small to change it there: wrap it first.
const angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const cell = (c) => (c && Number.isInteger(c.cx) && Number.isInteger(c.cy) ? { cx: c.cx, cy: c.cy } : null);

/** Everything a client sends is untrusted: rebuild its input from scratch with known types. */
function readInput(m, seat) {
  seat.held = { mx: clamp(num(m.mx), -1, 1), my: clamp(num(m.my), -1, 1), aim: angle(num(m.aim)), fire: m.fire === true, use: m.use === true };
  if (m.q === true) seat.q = true;
  if (m.r === true) seat.r = true;
  if (Number.isSafeInteger(m.seq) && m.seq > 0) seat.seq = m.seq; // echoed in snapshots so the client can tell lag from error
  if (seat.orders.length >= 32) return;
  const build = cell(m.build), remove = cell(m.remove);
  if (build && typeof m.build.type === 'string' && Object.hasOwn(STRUCTS, m.build.type)) seat.orders.push({ seq: seat.seq, build: { type: m.build.type, ...build } });
  if (remove) seat.orders.push({ seq: seat.seq, remove });
}

/**
 * The last input of this seat's whose orders the sim has tried. Held keys, Q and R are taken up by the very next
 * tick, so for them hearing an input is acting on it; but orders wait their turn at one a tick, and an input is
 * not done until its orders have left the queue. A client that sees its order done and no structure there knows
 * it was refused.
 */
const doneTo = (seat) => (seat.orders.length ? seat.orders[0].seq - 1 : seat.seq);

/**
 * A browser names the page that opened a WebSocket in its Origin header and lets any page open one, so without
 * this a site the player visits could join, flood or restart a match bound to this computer. No Origin is a
 * non-browser client (a test), which the bind already decides about. DNS rebinding passes it: see ownHost.
 */
function sameSite({ origin, req }) {
  if (!origin) return true;
  try {
    return new URL(origin).host === String(req.headers.host).toLowerCase();
  } catch {
    return false; // e.g. "null" from a file:// page
  }
}

const NAMES = new Set(['localhost', hostname().toLowerCase(), `${hostname().toLowerCase()}.local`]);

/**
 * DNS rebinding: a site can point its own name at this computer, and its page's requests then carry that name
 * as Host and as Origin, so sameSite lets them in. A Host that is an IP address or one of this computer's own
 * names cannot be a rebound page's, so only those are served. Skipped on a public host (Render), where a name
 * is how everyone arrives and anyone may connect anyway.
 */
function ownHost(host) {
  try {
    const name = new URL(`http://${host}`).hostname;
    return isIP(name.replace(/^\[|\]$/g, '')) > 0 || NAMES.has(name);
  } catch {
    return false; // missing or malformed Host
  }
}

/** Test aid: hold each message back as a slow, uneven line would. Order is kept, as TCP keeps it. */
function slowLine(ms, jitter) {
  let due = 0;
  return (deliver) => {
    if (!ms && !jitter) return deliver();
    due = Math.max(due, performance.now() + ms + Math.random() * jitter);
    setTimeout(deliver, due - performance.now());
  };
}

/**
 * newGame is injectable so tests can start from a prepared match.
 * grace: seconds an empty match is kept, so a dropped connection is not the end of it.
 * beat: ms between heartbeats; a connection silent for a whole beat is dropped.
 * lag, jitter: simulate a slow line (round-trip ms, plus up to jitter ms each way) to try the game under internet conditions.
 * anyHost: serve any Host name (a public host reached by its domain); otherwise only IP addresses and this computer's names.
 */
export async function startServer({
  port = 3000, host = '127.0.0.1', seed = Date.now() & 0x7fffffff, newGame = createGame,
  grace = 60, beat = 5000, maxClients = 40, lag = 0, jitter = 0, anyHost = false,
} = {}) {
  let game = null, idle = null;
  const seats = new Map(); // hero slot -> { ws, key, held, q, r, seq, orders } for each human player
  const known = (req) => anyHost || ownHost(req.headers.host);

  const http = createServer(async (req, res) => {
    if (!known(req)) return res.writeHead(403).end();
    // public/ is flat, and only a literal file name is ever served, so no path can climb out of it.
    const path = req.url.split('?')[0];
    const name = path === '/' ? 'index.html' : path.slice(1);
    if (req.method !== 'GET' || !/^[\w-]+\.(html|js|css)$/.test(name)) return res.writeHead(404).end();
    try {
      const body = await readFile(join(PUBLIC, name));
      res.writeHead(200, { 'content-type': MIME[extname(name)], 'cache-control': 'no-store' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });

  // Snapshots are the whole state as JSON. Each one is nearly the same as the last, so one
  // deflate stream per player takes about 650 KB/s down to about 25. It is done here rather than
  // by the WebSocket's own compression, which some hosts' proxies strip (Render's does).
  const wss = new WebSocketServer({ server: http, maxPayload: 2048, verifyClient: (info) => known(info.req) && sameSite(info) });
  const humans = () => Array.from({ length: SLOTS }, (_, i) => seats.has(i));
  const post = (ws, text) => ws.down(() => {
    if (ws.readyState !== 1) return;
    ws.z.write(`${text}
`);
    ws.z.flush(constants.Z_SYNC_FLUSH, () => {
      if (ws.readyState === 1 && ws.out.length) ws.send(Buffer.concat(ws.out.splice(0)));
    });
  });
  const send = (ws, msg) => post(ws, JSON.stringify(msg));
  const lobby = () => ({ t: 'lobby', humans: humans(), running: game !== null, endless: game !== null && game.endless, out: game && game.phase !== 'over' ? game.teams.map((T) => !T.alive) : [false, false, false] }); // a finished match can be joined on any team, to play again
  const tellAll = () => wss.clients.forEach((ws) => send(ws, lobby()));

  /** key: a secret the client made up. Showing it again takes the seat back from a connection that died unnoticed. */
  function join_(ws, slot, key, endless) {
    const deny = (why) => send(ws, { t: 'denied', why });
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) return deny('bad');
    if (ws.slot >= 0) return deny('seated');
    key = typeof key === 'string' ? key.slice(0, 64) : '';
    const old = seats.get(slot);
    if (old && !(key && old.key === key)) return deny('taken');
    if (game && game.phase !== 'over' && !game.teams[teamOf(slot)].alive) return deny('out');
    if (old) {
      old.ws.slot = -1; // so its close does not give the seat away
      old.ws.terminate();
    }
    clearTimeout(idle);
    game ??= Object.assign(newGame(seed++), { endless: endless === true }); // whoever starts the match picks its mode
    ws.slot = slot;
    seats.set(slot, { ws, key, held: {}, q: false, r: false, seq: 0, orders: [] });
    send(ws, { t: 'joined', slot });
    tellAll();
  }

  wss.on('connection', (ws) => {
    ws.on('error', () => {}); // e.g. an oversized message; ws then closes the socket and 'close' cleans up
    Object.assign(ws, { slot: -1, alive: true, msgs: 0, up: slowLine(lag / 2, jitter), down: slowLine(lag / 2, jitter), z: createDeflateRaw(), out: [] });
    ws.z.on('data', (chunk) => ws.out.push(chunk));
    if (wss.clients.size > maxClients) return ws.close(1013, 'full');
    send(ws, lobby());
    ws.on('pong', () => (ws.alive = true));
    ws.on('message', (data) => ws.up(() => {
      ws.alive = true;
      if (++ws.msgs > FLOOD) return ws.terminate();
      let m;
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'join') join_(ws, m.slot, m.key, m.endless);
      else if (ws.slot < 0) return;
      else if (m.t === 'input') readInput(m, seats.get(ws.slot));
      else if (m.t === 'restart' && game.phase === 'over') {
        game = Object.assign(newGame(seed++), { endless: game.endless }); // the same mode again
        tellAll();
      }
    }));
    ws.on('close', () => {
      ws.z.close();
      if (ws.slot < 0) return;
      seats.delete(ws.slot); // a bot takes the hero over
      ws.slot = -1;
      tellAll();
      if (seats.size) return;
      // Nobody left. Bots play on for a while in case the last player's line only dropped.
      idle = setTimeout(() => {
        game = null;
        tellAll();
      }, grace * 1000);
    });
  });

  const heart = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) ws.terminate(); // not a word, nor an answer to the last ping: the line is dead
      else {
        Object.assign(ws, { alive: false, msgs: 0 });
        ws.ping();
      }
    }
  }, beat);

  function tick() {
    const inputs = game.heroes.map((h) => {
      const seat = seats.get(h.i);
      if (!seat) return botInput(game, h.i); // bots build on every team, a human's included
      const inp = { ...seat.held, q: seat.q, r: seat.r, ...seat.orders.shift() };
      seat.q = seat.r = false;
      return inp;
    });
    step(game, inputs, TICK);
  }

  let last = performance.now(), owed = 0, ticks = 0;
  const loop = setInterval(() => {
    const now = performance.now();
    owed = Math.min(owed + (now - last) / 1000, 0.25); // after a stall, drop the backlog rather than fast-forward
    last = now;
    if (!game) return void (owed = 0);
    let send30 = false;
    for (; owed >= TICK; owed -= TICK) {
      tick();
      if (++ticks % 2 === 0) send30 = true;
    }
    if (!send30) return;
    const acks = Array.from({ length: SLOTS }, (_, i) => seats.get(i)?.seq ?? 0);
    const done = Array.from({ length: SLOTS }, (_, i) => (seats.has(i) ? doneTo(seats.get(i)) : 0));
    const msg = `{"t":"state","n":${ticks},"acks":${JSON.stringify(acks)},"done":${JSON.stringify(done)},"humans":${JSON.stringify(humans())},"s":${snapshot(game)}}`;
    for (const ws of wss.clients) if (ws.bufferedAmount < 1e6) post(ws, msg); // skip clients that cannot keep up
  }, 8);

  await new Promise((resolve, reject) => http.once('error', reject).listen(port, host, resolve));
  return {
    port: http.address().port,
    async close() {
      clearInterval(loop);
      clearInterval(heart);
      clearTimeout(idle);
      for (const ws of wss.clients) {
        ws.slot = -1; // shutting down: its close must not start the empty-match countdown
        ws.terminate();
      }
      http.closeAllConnections();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => http.close(resolve));
    },
  };
}

if (import.meta.main) {
  const render = process.env.RENDER === 'true'; // Render sets RENDER; its proxy needs us on every interface, reached by its domain
  const lan = process.argv.includes('--lan') || render;
  const flag = (name) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]) || 0;
  const lag = flag('lag'), jitter = flag('jitter');
  const anyHost = render || process.argv.includes('--any-host');
  const { port } = await startServer({ port: Number(process.env.PORT) || 3000, host: lan ? '0.0.0.0' : '127.0.0.1', lag, jitter, anyHost });
  if (lag || jitter) console.log(`Simulating a slow line: ${lag} ms round trip, up to ${jitter} ms of jitter each way.`);
  console.log(`Emberhold is running: http://localhost:${port}`);
  if (lan) {
    const addresses = Object.values(networkInterfaces()).flat().filter((a) => a.family === 'IPv4' && !a.internal);
    for (const a of addresses) console.log(`Others on your network can join at http://${a.address}:${port}`);
  } else console.log('Only this computer can connect. Run "npm run lan" to let others on your network join.');
}
