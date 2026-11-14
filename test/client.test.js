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

test('every structure has a build button and every hero\'s gun has a sound', async () => {
  const { STRUCTS, HEROES } = await import('../public/sim.js');
  const { createSound } = await import('../public/sound.js');
  for (const type of Object.keys(STRUCTS)) assert.ok(page.includes(`data-type="${type}"`), `no build button for ${type}`);
  const names = createSound().names;
  for (const h of Object.values(HEROES)) assert.ok(names.includes(h.gun.name), `no sound called ${h.gun.name}`);
});
