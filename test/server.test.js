import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server.js';
import { createGame, HEROES } from '../public/sim.js';

const AMBER_DART = 1, AZURE_DART = 5;

/** A WebSocket client that remembers what it was sent and can wait for a particular message. */
async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const inbox = [];
  let waiting = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    inbox.push(m);
    waiting = waiting.filter((w) => !(w.pred(m) && (w.resolve(m), true)));
  });
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
  assert.deepEqual(lobby.humans, Array(12).fill(false));
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
  assert.equal(s1.structs.filter((st) => st.team === 0).length, 0, 'nothing got built');
  assert.ok(s1.teams.every((T) => Number.isInteger(T.scrap)));

  const fresh = await connect(port);
  assert.equal((await fresh.first(isLobby, 'the lobby')).running, true, 'the server still accepts players');
  await Promise.all([a.close(), fresh.close()]);
});

test('bots on a team with a human never spend its Scrap; all-bot teams build', async (t) => {
  const { port } = await withServer(t);
  const a = await connect(port);
  a.send({ t: 'join', slot: AMBER_DART });
  const { s } = await a.next(stateAfter(2), 'two seconds of play');
  const built = (team) => s.structs.filter((st) => st.team === team && st.ttl === 0).length;
  assert.equal(built(0), 0);
  assert.ok(built(1) > 0 && built(2) > 0);
  await a.close();
});

test('a player who leaves hands their hero to a bot; the last one out ends the match', async (t) => {
  const { port } = await withServer(t);
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
