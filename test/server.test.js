import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import WS from 'ws';
import { startServer } from '../server.js';
import { createUnpacker } from '../public/net.js';
import { createGame, HEROES, TEAM_SIZE } from '../public/sim.js';

const AMBER_DART = 1, AZURE_DART = TEAM_SIZE + 1;

/** A WebSocket client that remembers what it was sent and can wait for a particular message. */
async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.binaryType = 'arraybuffer';
  const inbox = [];
  let waiting = [];
  const feed = createUnpacker((m) => {
    inbox.push(m);
    waiting = waiting.filter((w) => !(w.pred(m) && (w.resolve(m), true)));
  });
  ws.addEventListener('message', (ev) => feed(ev.data));
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('could not connect')));
  });
  return {
    ws,
    inbox,
    send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    /** The next message from now on that matches. */
    next: (pred, what = 'a message', ms = 3000) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms);
        waiting.push({ pred, resolve: (m) => (clearTimeout(timer), resolve(m)) });
      }),
    /** The first message matching, whether it already arrived or not. */
    first(pred, what) {
      const seen = inbox.find(pred);
      return seen ? Promise.resolve(seen) : this.next(pred, what);
    },
    close: () => new Promise((resolve) => (ws.addEventListener('close', resolve), ws.close())),
  };
}

const isLobby = (m) => m.t === 'lobby';
const isState = (m) => m.t === 'state';
const stateAfter = (t) => (m) => m.t === 'state' && m.s.t >= t;

/** Start a server for one test and shut it down afterwards. */
async function withServer(t, options = {}) {
  const server = await startServer({ port: 0, ...options });
  t.after(() => server.close());
  return server;
}

test('serves the game page and nothing outside public/', async (t) => {
  const { port } = await withServer(t);
  const get = (path) => fetch(`http://127.0.0.1:${port}${path}`);

  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /<title>Emberhold<\/title>/);

  const sim = await get('/sim.js');
  assert.equal(sim.status, 200);
  assert.match(sim.headers.get('content-type'), /javascript/);

  for (const path of ['/nope.js', '/%2e%2e/server.js', '/..%2fpackage.json', '/public/sim.js', '/sim.js/../../package.json']) {
    assert.equal((await get(path)).status, 404, path);
  }
  assert.equal((await fetch(`http://127.0.0.1:${port}/sim.js`, { method: 'POST' })).status, 404);
});

test('a newcomer sees an empty lobby and no match running', async (t) => {
  const { port } = await withServer(t);
  const c = await connect(port);
  const lobby = await c.first(isLobby, 'the lobby');
  assert.deepEqual(lobby.humans, Array(15).fill(false));
  assert.equal(lobby.running, false);
  await c.close();
});

test('two players take different heroes; a taken hero is refused', async (t) => {
  const { port } = await withServer(t);
  const a = await connect(port), b = await connect(port);
  a.send({ t: 'join', slot: AMBER_DART });
  assert.equal((await a.next((m) => m.t === 'joined', 'joined')).slot, AMBER_DART);

  b.send({ t: 'join', slot: AMBER_DART });
  assert.equal((await b.next((m) => m.t === 'denied', 'denied')).why, 'taken');
  b.send({ t: 'join', slot: AZURE_DART });
  assert.equal((await b.next((m) => m.t === 'joined', 'joined')).slot, AZURE_DART);

  const state = await b.next(isState, 'a state');
  assert.equal(state.humans[AMBER_DART], true);
  assert.equal(state.humans[AZURE_DART], true);
  assert.equal(state.humans.filter(Boolean).length, 2);

  a.send({ t: 'join', slot: 2 });
  assert.equal((await a.next((m) => m.t === 'denied', 'denied')).why, 'seated', 'one hero per connection');
  await a.close();
  await b.close();
});

test('input drives the sender\'s hero and nobody else\'s', async (t) => {
  const { port } = await withServer(t);
  const a = await connect(port), b = await connect(port), watcher = await connect(port);
  a.send({ t: 'join', slot: AMBER_DART });
  b.send({ t: 'join', slot: AZURE_DART });
  await b.next((m) => m.t === 'joined', 'joined');

  watcher.send({ t: 'input', mx: -1, my: -1, fire: true }); // not seated: must be ignored
  const before = (await a.next(isState, 'a state')).s;
  a.send({ t: 'input', mx: 1, my: 0, aim: 0, fire: false, use: false });
  const after = (await a.next(stateAfter(before.t + 0.5), 'half a second of play')).s;

  const dt = after.t - before.t;
  const moved = after.heroes[AMBER_DART].x - before.heroes[AMBER_DART].x;
  assert.ok(moved > HEROES.dart.speed * (dt - 0.25) && moved <= HEROES.dart.speed * dt + 1, `moved ${moved} in ${dt}s`);
  assert.equal(after.heroes[AMBER_DART].y, before.heroes[AMBER_DART].y);
  assert.equal(after.heroes[AZURE_DART].x, before.heroes[AZURE_DART].x, 'the other human did not move');
  assert.equal(after.heroes[AZURE_DART].y, before.heroes[AZURE_DART].y);
  await Promise.all([a.close(), b.close(), watcher.close()]);
});

test('malformed and hostile messages are ignored and the match carries on', async (t) => {
  const { port } = await withServer(t);
  const a = await connect(port), vandal = await connect(port);
  a.send({ t: 'join', slot: AMBER_DART });
  await a.next((m) => m.t === 'joined', 'joined');

  for (const junk of [
    'not json', '[]', 'null', '42', '{"t":"join"}', '{"t":"join","slot":99}', '{"t":"join","slot":"1"}', '{"t":"join","slot":1.5}',
    '{"t":"restart"}', '{"t":"__proto__"}',
  ]) vandal.send(junk);
  a.send('{"t":"input","mx":"x","my":1e999,"aim":null,"fire":"yes","q":1,"build":{"type":"constructor","cx":1e99,"cy":null},"remove":"all"}');
  a.send('{"t":"input","mx":5,"my":-5,"build":{"type":"wall","cx":-3,"cy":2.5}}');
  vandal.send('x'.repeat(5000)); // over the size cap: the server drops this connection

  const s0 = (await a.next(isState, 'a state')).s;
  const s1 = (await a.next(stateAfter(s0.t + 0.3), 'the match to carry on')).s;
  const me = s1.heroes[AMBER_DART];
  assert.ok([me.x, me.y, me.aim, me.hp].every(Number.isFinite));
  assert.ok(s1.structs.every((st) => Number.isInteger(st.cx) && st.cx >= 0 && Number.isInteger(st.cy)), 'nothing got built from the junk');
  assert.ok(s1.teams.every((T) => Number.isInteger(T.scrap)));

  const fresh = await connect(port);
  assert.equal((await fresh.first(isLobby, 'the lobby')).running, true, 'the server still accepts players');
  await Promise.all([a.close(), fresh.close()]);
});

test('bots build on every team, including one with a human on it', async (t) => {
  const { port } = await withServer(t);
  const a = await connect(port);
  a.send({ t: 'join', slot: AMBER_DART });
  const { s } = await a.next(stateAfter(2), 'two seconds of play');
  for (const team of [0, 1, 2]) assert.ok(s.structs.some((st) => st.team === team && st.ttl === 0), `team ${team} built`);
  await a.close();
});

test('a player who leaves hands their hero to a bot; the last one out ends the match', async (t) => {
  const { port } = await withServer(t, { grace: 0.05 });
  const a = await connect(port), b = await connect(port);
  a.send({ t: 'join', slot: AMBER_DART });
  b.send({ t: 'join', slot: AZURE_DART });
  await b.next((m) => m.t === 'joined', 'joined');
  await a.close();

  const lobby = await b.next((m) => m.t === 'lobby' && !m.humans[AMBER_DART], 'the lobby to update');
  assert.equal(lobby.humans[AZURE_DART], true);
  const s0 = (await b.next(isState, 'a state')).s;
  const s1 = (await b.next(stateAfter(s0.t + 1), 'a second of play')).s;
  const bot = (s) => s.heroes[AMBER_DART];
  assert.ok(Math.hypot(bot(s1).x - bot(s0).x, bot(s1).y - bot(s0).y) > 50, 'the abandoned hero is now walking about on its own');

  await b.close();
  const c = await connect(port);
  await c.first((m) => isLobby(m) && !m.running, 'the match to end'); // times out if the match is still running
  await c.close();
});

test('"Play again" starts a fresh match, but only once the match is over', async (t) => {
  let made = 0;
  const { port } = await withServer(t, {
    newGame(seed) {
      const g = createGame(seed);
      if (made++ === 0) g.teams[1].ember.hp = g.teams[2].ember.hp = 0; // the first match ends on its first tick
      return g;
    },
  });
  const a = await connect(port);
  a.send({ t: 'join', slot: AMBER_DART });
  const over = await a.next((m) => m.t === 'state' && m.s.phase === 'over', 'the match to end');
  assert.equal(over.s.winner, 0);

  a.send({ t: 'restart' });
  const fresh = await a.next((m) => m.t === 'state' && m.s.phase === 'day', 'a fresh match');
  assert.equal(fresh.humans[AMBER_DART], true, 'players keep their heroes');
  assert.equal(made, 2);

  a.send({ t: 'restart' }); // mid-match: ignored
  await a.next(stateAfter(fresh.s.t + 0.3), 'play to continue');
  assert.equal(made, 2);
  await a.close();
});

// ---------------------------------------------------------------- playing over the internet

test('snapshots are compressed on the wire', async (t) => {
  const { port } = await withServer(t);
  // Without the WebSocket's own compression, as behind a proxy that strips it: the game must compress by itself.
  const ws = new WS(`ws://127.0.0.1:${port}`, { perMessageDeflate: false });
  t.after(() => ws.terminate());
  await new Promise((resolve) => ws.on('open', resolve));
  ws.send(JSON.stringify({ t: 'join', slot: AMBER_DART }));
  let chars = 0, states = 0, done;
  const feed = createUnpacker((m) => (chars += JSON.stringify(m).length, m.t === 'state' && ++states >= 60 && done()));
  await new Promise((resolve) => ((done = resolve), ws.on('message', (data) => feed(data))));
  const wire = ws._socket.bytesRead;
  assert.ok(wire < chars / 8, `${states} states of ${chars} characters took ${wire} bytes`);
});

test('each snapshot carries the server tick and the last input heard from every player', async (t) => {
  const { port } = await withServer(t);
  const a = await connect(port);
  a.send({ t: 'join', slot: AMBER_DART });
  const first = await a.next(isState, 'a state');
  assert.equal(first.acks.length, 15);
  assert.equal(first.acks[AMBER_DART], 0, 'nothing heard yet');
  a.send({ t: 'input', mx: 0, my: 0, seq: 41 });
  a.send({ t: 'input', mx: 0, my: 0, seq: 'x' }); // not a number: ignored
  const later = await a.next((m) => isState(m) && m.acks[AMBER_DART] === 41, 'the input to be acknowledged');
  assert.ok(Number.isInteger(later.n) && later.n > first.n, 'the tick count moves on');
  // A snapshot goes out each time the tick count passes an even number, stamped with the count as it then stands.
  // On a quiet machine that is every two ticks; a busy one runs several ticks before it sends, so only the bounds hold.
  let prev = later;
  for (let k = 0; k < 10; k++) {
    const next = await a.next(isState, 'the next state');
    assert.ok(next.n > prev.n, 'the tick count never stands still or runs back');
    prev = next;
  }
  assert.ok(prev.n - later.n >= 19, `never more than one snapshot for every second tick: 10 took ${prev.n - later.n} ticks`);
  await a.close();
});

test('a match outlives a short loss of its last player, who gets their hero back', async (t) => {
  const { port } = await withServer(t, { grace: 5 });
  const a = await connect(port);
  a.send({ t: 'join', slot: AMBER_DART });
  const before = (await a.next(stateAfter(0.3), 'some play')).s;
  await a.close();

  const back = await connect(port);
  assert.equal((await back.first(isLobby, 'the lobby')).running, true, 'the match is still there');
  back.send({ t: 'join', slot: AMBER_DART });
  const after = (await back.next(isState, 'a state')).s;
  assert.ok(after.t > before.t, 'the same match, further on');
  await back.close();
});

test('a player whose line went dead takes their seat back with their key; nobody else can', async (t) => {
  const { port } = await withServer(t);
  const a = await connect(port);
  a.send({ t: 'join', slot: AMBER_DART, key: 'secret-a' });
  await a.next((m) => m.t === 'joined', 'joined');
  const dropped = new Promise((resolve) => a.ws.addEventListener('close', resolve));

  const thief = await connect(port);
  thief.send({ t: 'join', slot: AMBER_DART, key: 'a-guess' });
  assert.equal((await thief.next((m) => m.t === 'denied', 'a refusal')).why, 'taken');
  thief.send({ t: 'join', slot: AMBER_DART });
  assert.equal((await thief.next((m) => m.t === 'denied', 'a refusal')).why, 'taken', 'no key is not a key');

  const again = await connect(port); // the same player on a new connection, the old one not yet known to be dead
  again.send({ t: 'join', slot: AMBER_DART, key: 'secret-a' });
  assert.equal((await again.next((m) => m.t === 'joined', 'joined')).slot, AMBER_DART);
  await dropped; // the old connection is closed
  await thief.next(isState, 'play to go on');
  assert.ok(thief.inbox.filter(isLobby).every((m) => m.humans[AMBER_DART]), 'the seat never fell to a bot');
  await Promise.all([thief.close(), again.close()]);
});

test('a connection that has gone silent is dropped', async (t) => {
  const { port } = await withServer(t, { beat: 100 });
  // A bare socket that completes the WebSocket handshake and then never answers a ping.
  const sock = net.connect(port, '127.0.0.1');
  t.after(() => sock.destroy());
  sock.on('error', () => {});
  sock.resume(); // read and discard, or the close would never be noticed
  const started = performance.now();
  sock.write('GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
  await new Promise((resolve, reject) => {
    sock.on('close', resolve);
    setTimeout(() => reject(new Error('still connected after 2 s')), 2000).unref();
  });
  assert.ok(performance.now() - started >= 90, 'not before it had a chance to answer');
});

test('a full server turns newcomers away; a flooding connection is cut off', async (t) => {
  const { port } = await withServer(t, { maxClients: 2 });
  const a = await connect(port), b = await connect(port);
  const extra = new WebSocket(`ws://127.0.0.1:${port}`);
  const closed = await new Promise((resolve) => extra.addEventListener('close', resolve));
  assert.equal(closed.code, 1013);

  a.send({ t: 'join', slot: AMBER_DART });
  await a.next((m) => m.t === 'joined', 'joined');
  const cut = new Promise((resolve) => b.ws.addEventListener('close', resolve));
  for (let k = 0; k < 1500; k++) b.send({ t: 'input', mx: 1, my: 0 });
  await cut;
  await a.next(isState, 'the match to carry on');
  await a.close();
});

test('the simulated-lag option holds messages back each way and keeps their order', async (t) => {
  const { port } = await withServer(t, { lag: 200, jitter: 30 });
  const a = await connect(port);
  const sent = performance.now();
  a.send({ t: 'join', slot: AMBER_DART });
  await a.next((m) => m.t === 'joined', 'joined');
  assert.ok(performance.now() - sent >= 190, `the reply took ${performance.now() - sent} ms`);
  await a.next(stateAfter(0.5), 'some play');
  const ticks = a.inbox.filter(isState).map((m) => m.n);
  assert.deepEqual(ticks, [...ticks].sort((x, y) => x - y));
  await a.close();
});

test('whoever starts the match picks endless mode, and it survives Play again', async (t) => {
  const { port } = await withServer(t, { newGame: (seed) => { const g = createGame(seed); for (const T of g.teams) T.ember.hp = 0; return g; } });
  const a = await connect(port);
  await a.first(isLobby, 'the lobby');
  a.send({ t: 'join', slot: 0, key: 'k', endless: true });
  const over = await a.next((m) => m.t === 'state' && m.s.phase === 'over', 'the match to end');
  assert.equal(over.s.endless, true);
  assert.equal((await a.first((m) => isLobby(m) && m.running, 'the lobby')).endless, true);
  a.send({ t: 'restart' });
  assert.equal((await a.next((m) => m.t === 'state' && m.s.t < over.s.t + 1 && m.s !== over.s && m.n > over.n, 'a fresh match')).s.endless, true);
  await a.close();

  const other = await withServer(t);
  const b = await connect(other.port);
  await b.first(isLobby, 'the lobby');
  b.send({ t: 'join', slot: 0, key: 'k', endless: 'yes' });
  assert.equal((await b.next(isState, 'a state')).s.endless, false, 'only a plain true turns it on');
  await b.close();
});
