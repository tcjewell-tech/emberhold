import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('every npm script that names a file names one that exists', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const [name, cmd] of Object.entries(scripts)) {
    for (const file of cmd.split(/[\s"']+/).filter((w) => w.endsWith('.js') && !w.includes('*'))) assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `npm run ${name} names ${file}`);
  }
});
