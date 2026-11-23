// Nothing here runs the browser client. These catch the breakages reading the files can:
// an import the modules do not export, a page element the script expects and the page lacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const client = read('public/client.js'), page = read('public/index.html');

test('client.js imports only names its modules export', async () => {
  const imports = [...client.matchAll(/import \{([^}]+)\} from '\.\/([\w-]+\.js)'/g)];
  assert.ok(imports.length >= 3, 'found the import lines');
  for (const [, names, file] of imports) {
    const mod = await import(`../public/${file}`);
    for (const name of names.split(',').map((n) => n.trim())) assert.ok(name in mod, `${file} does not export ${name}`);
  }
});

test('every page element client.js asks for by id exists in index.html', () => {
  const ids = new Set([...client.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]));
  assert.ok(ids.size > 10, 'found the lookups');
  for (const id of ids) assert.ok(page.includes(`id="${id}"`), `index.html has no element with id "${id}"`);
});

test('the preview configs start the real server', () => {
  const { configurations } = JSON.parse(read('.claude/launch.json'));
  for (const c of configurations) assert.equal(c.runtimeArgs[0], 'server.js', c.name);
});

test('the client has a key for every call the sim knows, shows its new keys on the page, and leaves F to scavenging', async () => {
  const { PINGS } = await import('../public/sim.js');
  const keyed = client.match(/CALL_KEYS = \{([^}]+)\}/)[1], said = client.match(/CALLS = \{([^}]+)\}/)[1];
  assert.deepEqual([...keyed.matchAll(/Key\w: '(\w+)'/g)].map((m) => m[1]).sort(), [...PINGS].sort(), 'a key for each call, and no other');
  for (const kind of PINGS) assert.ok(said.includes(`${kind}:`), `nothing to say for the call "${kind}"`);
  for (const k of ['T', 'Z', 'X', 'C', '?', 'M', 'F']) assert.ok(page.includes(`<kbd>${k}</kbd>`), `the page does not show the ${k} key`);
  assert.ok(client.includes("use = keys.has('KeyF')") && client.includes("e.code === 'KeyT'"), 'F scavenges; auto-fire is on T');
  assert.match(client, /contrast: false, autofire: false, rings: true/, 'the three new settings and what they start as');
});

test('the master volume is a number from 0 to 1, and only a number in that range changes it', async () => {
  const { createSound } = await import('../public/sound.js');
  const sound = createSound();
  assert.equal(sound.volume(0.4), 0.4);
  for (const junk of [-0.1, 1.5, NaN, '0.9', null, undefined]) assert.equal(sound.volume(junk), 0.4, `${junk} is not a volume`);
  assert.equal(sound.volume(0), 0);
  assert.doesNotThrow(() => sound.play('Build'), 'at volume 0 nothing is played: here, with no audio to play on, that would throw');
  assert.equal(sound.volume(1), 1);
});

test('every structure has a build button and every hero\'s gun has a sound', async () => {
  const { STRUCTS, HEROES } = await import('../public/sim.js');
  const { createSound } = await import('../public/sound.js');
  for (const type of Object.keys(STRUCTS)) assert.ok(page.includes(`data-type="${type}"`), `no build button for ${type}`);
  const names = createSound().names;
  for (const h of Object.values(HEROES)) assert.ok(names.includes(h.gun.name), `no sound called ${h.gun.name}`);
});
