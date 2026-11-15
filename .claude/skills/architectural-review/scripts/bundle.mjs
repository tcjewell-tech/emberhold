// Builds one markdown file from a written summary and a list of source files, for an outside reviewer.
//   node bundle.mjs <manifest.json>
// manifest: { "out": "name.md", "title": "...", "summary": "summary.md", "files": [{ "path": "src/a.js", "role": "what it is" }], "quoted": ["other.js"] }
// out, files and quoted are relative to the current directory (the repository root); summary may be anywhere.
// Every file is embedded whole, then read back out of the bundle and compared with its source.
// Code quoted in the summary is looked up, line by line, in the bundled files and in the optional quoted ones.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, extname } from 'node:path';

const fail = (why) => {
  console.error(`bundle: ${why}`);
  process.exit(1);
};
const read = (p) => {
  try {
    return readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    return fail(`cannot read ${p}`);
  }
};
const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return ''; // not a git repository: the header just says less
  }
};

const manifestPath = process.argv[2];
if (!manifestPath) fail('usage: node bundle.mjs <manifest.json>');
let m;
try {
  m = JSON.parse(read(manifestPath));
} catch {
  fail(`${manifestPath} is not valid JSON`);
}
if (!m.out || !m.title || !m.summary || !Array.isArray(m.files) || !m.files.length) fail('the manifest needs out, title, summary and a non-empty files list');

// The bundle leaves this machine, so files that exist to hold secrets never go in it.
const SECRET = /^\.env|\.(pem|key|pfx|p12)$|^id_(rsa|ed25519)/i;
const LANG = { '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'ts', '.tsx': 'tsx', '.jsx': 'jsx', '.json': 'json', '.md': 'markdown', '.html': 'html', '.css': 'css', '.py': 'python', '.yaml': 'yaml', '.yml': 'yaml', '.sh': 'bash', '.sql': 'sql', '.go': 'go', '.rs': 'rust', '.java': 'java', '.cs': 'csharp', '.rb': 'ruby' };

const files = m.files.map((f) => {
  if (SECRET.test(basename(f.path))) fail(`${f.path} looks like a file of secrets and will not be bundled`);
  const text = read(f.path).replace(/\n+$/, '');
  // A fence one backtick longer than the longest run inside the file can never be closed by the file's own text.
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return { ...f, text, block: `${fence}${LANG[extname(f.path).toLowerCase()] ?? ''}\n${text}\n${fence}`, lines: text.split('\n').length };
});

const commit = git('rev-parse', '--short', 'HEAD'), branch = git('rev-parse', '--abbrev-ref', 'HEAD'), subject = git('log', '-1', '--format=%s');
const dirty = git('status', '--porcelain', '--', ...files.map((f) => f.path)) !== '';
const stamp = commit ? ` from \`${branch}\` at commit \`${commit}\` (${subject})${dirty ? ', with uncommitted changes in the bundled files' : ''}` : '';
const doc = [
  `# ${m.title}`, '',
  `Generated ${new Date().toISOString().slice(0, 10)}${stamp}.`, '',
  read(m.summary).trim(), '',
  '## Files in this bundle', '',
  '| File | Lines | Role |', '|---|---|---|',
  ...files.map((f) => `| \`${f.path}\` | ${f.lines} | ${f.role ?? ''} |`), '',
  ...files.flatMap((f) => [`## File: \`${f.path}\``, '', f.block, '']),
].join('\n');
writeFileSync(m.out, doc);

// Read it back: each file's block must be in the bundle exactly as built from the source just re-read.
const written = read(m.out);
for (const f of files) {
  if (!written.includes(`## File: \`${f.path}\`\n\n${f.block}\n`) || read(f.path).replace(/\n+$/, '') !== f.text) fail(`${f.path} in ${m.out} does not match its source`);
}
// Quotes in the summary: a line in a code block of a source language should be a line of some source we were given.
const sources = [...files, ...(m.quoted ?? []).map((path) => ({ path, text: read(path) }))];
const langs = new Set(sources.map((f) => LANG[extname(f.path).toLowerCase()]).filter((l) => l && l !== 'markdown' && l !== 'json'));
const known = new Set(sources.flatMap((f) => f.text.split('\n').map((l) => l.trim())));
let checked = 0;
const unknown = [];
for (const [, lang, body] of read(m.summary).matchAll(/^```(\w+)\n([\s\S]*?)^```$/gm)) {
  if (!langs.has(lang)) continue;
  for (const line of body.split('\n').map((l) => l.trim())) {
    if (line.length < 4 || /^(\/\/|#)?\s*(\.\.\.|…)/.test(line)) continue; // braces, and elisions such as "// ..."
    checked++;
    if (!known.has(line)) unknown.push(line);
  }
}
if (unknown.length) console.log(`quotes: ${unknown.length} of ${checked} quoted lines are not in the bundled or quoted files:\n${unknown.map((l) => `  ${l}`).join('\n')}`);
else if (checked) console.log(`quotes: all ${checked} quoted lines found in the source`);
console.log(`${m.out}: ${files.length} files, ${written.split('\n').length} lines, ${Buffer.byteLength(written)} bytes, every file identical to its source${commit ? `, at commit ${commit}` : ''}`);
