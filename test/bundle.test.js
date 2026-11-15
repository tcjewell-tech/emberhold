// The architectural-review skill's bundling script (.claude/skills/architectural-review/scripts/bundle.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dirname, '..', '.claude', 'skills', 'architectural-review', 'scripts', 'bundle.mjs');

/** Run the script in a fresh folder holding the given files and manifest. */
function bundle(t, sources, manifest) {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(sources)) writeFileSync(join(dir, name), text);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  const run = spawnSync(process.execPath, [script, 'manifest.json'], { cwd: dir, encoding: 'utf8' });
  let out = null;
  try { out = readFileSync(join(dir, manifest.out ?? ''), 'utf8'); } catch { /* nothing written */ }
  return { ...run, out };
}

test('the bundle holds the summary and every file whole, under its own header', (t) => {
  const code = 'export const a = 1;\r\nconst s = `tpl`;\r\n';
  const doc = '# Guide\n\n```bash\nnpm test\n```\n\n````md\nnested\n````\n';
  const r = bundle(t, { 'a.js': code, 'GUIDE.md': doc, 'summary.md': '## What to review\n\nThe thing.\n' },
    { out: 'ctx.md', title: 'Demo: context', summary: 'summary.md', files: [{ path: 'a.js', role: 'the code' }, { path: 'GUIDE.md' }] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 files.*every file identical to its source/);
  assert.ok(r.out.startsWith('# Demo: context\n\nGenerated '));
  assert.ok(r.out.includes('## What to review\n\nThe thing.'));
  assert.ok(r.out.includes('| `a.js` | 2 | the code |'));
  assert.ok(r.out.includes('## File: `a.js`\n\n```js\nexport const a = 1;\nconst s = `tpl`;\n```\n'), 'line endings are normalised, and a short fence is enough here');
  assert.ok(r.out.includes('## File: `GUIDE.md`\n\n`````markdown\n# Guide'), 'a file with a four-backtick fence inside gets a five-backtick one');
  assert.ok(r.out.includes('nested\n````\n`````\n'));
});

test('code quoted in the summary is looked up in the bundled files, and in others named as quoted', (t) => {
  const summary = '## Part\n\n```js\nexport const a = 1;\n// ...\nconst invented = true;\nstart(server);\n```\n\n```bash\nnpm test\n```\n';
  const sources = { 'a.js': 'export const a = 1;\n', 'server.js': 'function go() {\n  start(server);\n}\n', 'summary.md': summary };
  const base = { out: 'ctx.md', title: 'T', summary: 'summary.md', files: [{ path: 'a.js' }] };
  const one = bundle(t, sources, base);
  assert.equal(one.status, 0, 'a quote it cannot find is reported, not fatal');
  assert.match(one.stdout, /quotes: 2 of 3 quoted lines are not in the bundled or quoted files:\n {2}const invented = true;\n {2}start\(server\);/);
  const two = bundle(t, sources, { ...base, quoted: ['server.js'] });
  assert.match(two.stdout, /quotes: 1 of 3 .*:\n {2}const invented = true;\n(?! {2})/, 'the line from server.js is now found; shell commands are never checked');
  const clean = bundle(t, { ...sources, 'summary.md': '```js\nexport const a = 1;\n```\n' }, base);
  assert.match(clean.stdout, /quotes: all 1 quoted lines found in the source/);
});

test('it refuses a file of secrets, a missing file and a manifest with nothing in it', (t) => {
  const base = { out: 'ctx.md', title: 'T', summary: 'summary.md' };
  const secret = bundle(t, { '.env': 'KEY=1', 'summary.md': 's' }, { ...base, files: [{ path: '.env' }] });
  assert.equal(secret.status, 1);
  assert.match(secret.stderr, /secrets/);
  assert.equal(secret.out, null, 'and writes nothing');
  const missing = bundle(t, { 'summary.md': 's' }, { ...base, files: [{ path: 'gone.js' }] });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /cannot read gone\.js/);
  assert.equal(bundle(t, { 'summary.md': 's' }, { ...base, files: [] }).status, 1);
});
