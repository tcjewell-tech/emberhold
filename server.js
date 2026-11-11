// Emberhold server: serves public/ and runs the one authoritative match over WebSocket.
// Clients only send inputs and draw the snapshots they get back.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';
import { createGame, step, snapshot, STRUCTS } from './public/sim.js';
import { botInput } from './public/bots.js';

const PUBLIC = join(import.meta.dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const TICK = 1 / 60;
const SLOTS = 12;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v) => (Number.isFinite(v) ? v : 0);
const cell = (c) => (c && Number.isInteger(c.cx) && Number.isInteger(c.cy) ? { cx: c.cx, cy: c.cy } : null);

/** Everything a client sends is untrusted: rebuild its input from scratch with known types. */
function readInput(m, seat) {
  seat.held = { mx: clamp(num(m.mx), -1, 1), my: clamp(num(m.my), -1, 1), aim: num(m.aim), fire: m.fire === true, use: m.use === true };
  if (m.q === true) seat.q = true;
  if (m.r === true) seat.r = true;
  if (seat.orders.length >= 32) return;
  const build = cell(m.build), remove = cell(m.remove);
  if (build && typeof m.build.type === 'string' && Object.hasOwn(STRUCTS, m.build.type)) seat.orders.push({ build: { type: m.build.type, ...build } });
  if (remove) seat.orders.push({ remove });
}

/** newGame is injectable so tests can start from a prepared match. */
export async function startServer({ port = 3000, host = '127.0.0.1', seed = Date.now() & 0x7fffffff, newGame = createGame } = {}) {
  let game = null;
  const seats = new Map(); // hero slot -> { ws, held, q, r, orders } for each human player

  const http = createServer(async (req, res) => {
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

  const wss = new WebSocketServer({ server: http, maxPayload: 2048 });
  const humans = () => Array.from({ length: SLOTS }, (_, i) => seats.has(i));
  const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
  const lobby = () => ({ t: 'lobby', humans: humans(), running: game !== null, out: game ? game.teams.map((T) => !T.alive) : [false, false, false] });
  const tellAll = () => wss.clients.forEach((ws) => send(ws, lobby()));

  function join_(ws, slot) {
    const deny = (why) => send(ws, { t: 'denied', why });
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) return deny('bad');
    if (ws.slot >= 0) return deny('seated');
    if (seats.has(slot)) return deny('taken');
    if (game && game.phase !== 'over' && !game.teams[slot >> 2].alive) return deny('out');
    game ??= newGame(seed++);
    ws.slot = slot;
    seats.set(slot, { ws, held: {}, q: false, r: false, orders: [] });
    send(ws, { t: 'joined', slot });
    tellAll();
  }

  wss.on('connection', (ws) => {
    ws.slot = -1;
    send(ws, lobby());
    ws.on('error', () => {}); // e.g. an oversized message; ws then closes the socket and 'close' cleans up
    ws.on('message', (data) => {
      let m;
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'join') join_(ws, m.slot);
      else if (ws.slot < 0) return;
      else if (m.t === 'input') readInput(m, seats.get(ws.slot));
      else if (m.t === 'restart' && game.phase === 'over') {
        game = newGame(seed++);
        tellAll();
      }
    });
    ws.on('close', () => {
      if (ws.slot < 0) return;
      seats.delete(ws.slot); // a bot takes the hero over
      if (!seats.size) game = null; // nobody left to play for
      tellAll();
    });
  });

  function tick() {
    const manned = [0, 1, 2].map((team) => [0, 1, 2, 3].some((k) => seats.has(team * 4 + k)));
    const inputs = game.heroes.map((h) => {
      const seat = seats.get(h.i);
      if (!seat) return botInput(game, h.i, !manned[h.team]); // bots never spend a human team's Scrap
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
    const msg = `{"t":"state","humans":${JSON.stringify(humans())},"s":${snapshot(game)}}`;
    for (const ws of wss.clients) if (ws.readyState === 1 && ws.bufferedAmount < 1e6) ws.send(msg); // skip clients that cannot keep up
  }, 8);

  await new Promise((resolve, reject) => http.once('error', reject).listen(port, host, resolve));
  return {
    port: http.address().port,
    async close() {
      clearInterval(loop);
      for (const ws of wss.clients) ws.terminate();
      http.closeAllConnections();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => http.close(resolve));
    },
  };
}

if (import.meta.main) {
  const lan = process.argv.includes('--lan');
  const { port } = await startServer({ port: Number(process.env.PORT) || 3000, host: lan ? '0.0.0.0' : '127.0.0.1' });
  console.log(`Emberhold is running: http://localhost:${port}`);
  if (lan) {
    const addresses = Object.values(networkInterfaces()).flat().filter((a) => a.family === 'IPv4' && !a.internal);
    for (const a of addresses) console.log(`Others on your network can join at http://${a.address}:${port}`);
  } else console.log('Only this computer can connect. Run "npm run lan" to let others on your network join.');
}
