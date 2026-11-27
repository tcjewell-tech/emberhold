#!/usr/bin/env node
// Flatten a repository into one Markdown file for an outside code review.
// Self-contained and dependency-free: copy this file into any repository.
//   node scripts/bundle-review.mjs [--out <path>] [--root <dir>] [--ignore <a,b,...>]
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.nuxt', '.svelte-kit', 'out', 'coverage', '.cache', '.turbo', '.vercel']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'Cargo.lock', 'poetry.lock']);
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'avif', 'tif', 'tiff', 'psd', 'heic',
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar', 'jar',
  'pdf', 'wasm', 'exe', 'dll', 'so', 'dylib', 'bin', 'class', 'o', 'a', 'pyc', 'sqlite', 'sqlite3', 'db',
]);
const LANG = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js', json: 'json', md: 'md', css: 'css', scss: 'scss',
  html: 'html', htm: 'html', svg: 'xml', xml: 'xml', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash',
  ps1: 'powershell', yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', sql: 'sql', vue: 'vue', svelte: 'svelte',
};
const MAX_BYTES = 500 * 1024;
const SCRIPT_FILE = 'scripts/bundle-review.mjs';
const SCRIPT_CMD = `node ${SCRIPT_FILE}`;

function fail(msg) {
  console.error(`bundle-review: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { root: '.', out: null, ignore: [] };
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(out|root|ignore)(?:=(.*))?$/s.exec(argv[i]);
    if (!m) fail(`unknown argument: ${argv[i]}`);
    const value = m[2] ?? argv[++i];
    if (!value) fail(`--${m[1]} needs a value`);
    if (m[1] === 'ignore') opts.ignore.push(...value.split(',').map((s) => s.trim()).filter(Boolean));
    else opts[m[1]] = value;
  }
  return opts;
}

// One .gitignore-style entry. shortcut: no negation (!) and no character classes; enough for "basic" entries.
function toRule(line) {
  let p = line.trim();
  if (!p || p.startsWith('#') || p.startsWith('!')) return null;
  const dirOnly = p.endsWith('/');
  p = p.replace(/\/+$/, '');
  const anchored = p.includes('/');
  p = p.replace(/^\//, '');
  const re = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001')
    .replace(/\*\*/g, '\u0002')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '(?:.*/)?')
    .replace(/\u0002/g, '.*');
  return { re: new RegExp(`^${re}$`), dirOnly, anchored };
}

const matches = (rules, rel, isDir) =>
  rules.some((r) => (!r.dirOnly || isDir) && r.re.test(r.anchored ? rel : path.posix.basename(rel)));

function skipByName(name) {
  if (SKIP_FILES.has(name)) return true;
  if ((name === '.env' || name.startsWith('.env.')) && name !== '.env.example') return true;
  if (/\.(min\.js|min\.css|map|pem|key)$/i.test(name)) return true;
  return BINARY_EXT.has(path.extname(name).slice(1).toLowerCase());
}

const byName = (a, b) => {
  const x = a.name.toLowerCase(), y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
};

// Walks in tree order (directories first, then files, each alphabetical), so the tree and the sections agree.
function collect(root, rules, outAbs) {
  const files = [];
  const skipped = { files: 0, dirs: 0 };
  const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  (function walk(dir, relDir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).sort(byName);
    const rest = entries.filter((e) => !e.isDirectory()).sort(byName);
    for (const e of dirs) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (SKIP_DIRS.has(e.name) || matches(rules, rel, true)) skipped.dirs++;
      else walk(path.join(dir, e.name), rel);
    }
    for (const e of rest) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      // Symlinks are skipped: they can loop or point outside the repository.
      if (!e.isFile() || skipByName(e.name) || matches(rules, rel, false) || samePath(abs, outAbs) || fs.statSync(abs).size > MAX_BYTES) {
        skipped.files++;
        continue;
      }
      const buf = fs.readFileSync(abs);
      if (buf.includes(0)) skipped.files++;
      else files.push({ rel, text: buf.toString('utf8') });
    }
  })(root, '');
  return { files, skipped };
}

function renderTree(node, prefix = '') {
  const entries = [...node];
  return entries.flatMap(([name, child], i) => {
    const last = i === entries.length - 1;
    const line = `${prefix}${last ? '└── ' : '├── '}${name}${child ? '/' : ''}`;
    return child ? [line, ...renderTree(child, prefix + (last ? '    ' : '│   '))] : [line];
  });
}

function tree(repo, paths) {
  const root = new Map(); // a Map keeps insertion order even for names like "2024"
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) node.set(part, null);
      else {
        if (!node.has(part)) node.set(part, new Map());
        node = node.get(part);
      }
    });
  }
  return [`${repo}/`, ...renderTree(root)].join('\n');
}

// At least four backticks, and always longer than any run inside the content, so nested fences never close it.
function fence(text, lang = '') {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const f = '`'.repeat(Math.max(4, longest + 1));
  return `${f}${lang}\n${text}${text.endsWith('\n') ? '' : '\n'}${f}`;
}

function langOf(rel) {
  const base = path.posix.basename(rel);
  if (base === 'Dockerfile') return 'dockerfile';
  if (base === 'Makefile') return 'makefile';
  return LANG[path.posix.extname(base).slice(1).toLowerCase()] ?? '';
}

// Adds the "bundle" npm script by editing the text, so the file's own indentation, key order and line endings stay.
function registerScript(root) {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) return null;
  if (!fs.existsSync(path.join(root, SCRIPT_FILE))) return `package.json: not registered (${SCRIPT_FILE} is not in this root)`;
  const text = fs.readFileSync(file, 'utf8');
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return 'package.json: not registered (invalid JSON)';
  }
  if (pkg.scripts?.bundle !== undefined) return `package.json: "bundle" script ${pkg.scripts.bundle === SCRIPT_CMD ? 'already registered' : 'exists, left as it is'}`;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indentOf = (i) => /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', i) + 1))[0];
  const entry = `"bundle": "${SCRIPT_CMD}"`;
  let next;
  // shortcut: takes the first "scripts" key in the file; fine for package.json, where it is top-level.
  const m = pkg.scripts ? /"scripts"\s*:\s*\{/.exec(text) : null;
  if (m) {
    const open = m.index + m[0].length - 1;
    const close = closingBrace(text, open);
    const inner = text.slice(open + 1, close);
    const outer = indentOf(m.index);
    if (inner.trim()) {
      const end = open + 1 + inner.trimEnd().length;
      next = `${text.slice(0, end)},${eol}${indentOf(end - 1)}${entry}${text.slice(end)}`;
    } else {
      const unit = outer || '  ';
      next = `${text.slice(0, open + 1)}${eol}${outer}${unit}${entry}${eol}${outer}${text.slice(close)}`;
    }
  } else {
    const open = text.indexOf('{');
    const unit = /\n([ \t]+)"/.exec(text)?.[1] ?? '  ';
    const comma = Object.keys(pkg).length ? ',' : '';
    next = `${text.slice(0, open + 1)}${eol}${unit}"scripts": {${eol}${unit}${unit}${entry}${eol}${unit}}${comma}${text.slice(open + 1)}`;
  }
  JSON.parse(next); // never write a broken package.json
  fs.writeFileSync(file, next);
  return 'package.json: added the "bundle" script';
}

function closingBrace(text, open) {
  let depth = 0;
  for (let i = open, inString = false; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error('unbalanced braces in package.json');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = path.resolve(opts.root);
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) fail(`--root is not a directory: ${opts.root}`);
  const repo = path.basename(root);
  const outAbs = path.resolve(opts.out ?? `${repo}-review-bundle.md`);

  const rules = opts.ignore.map(toRule).filter(Boolean);
  const gitignore = path.join(root, '.gitignore');
  if (fs.existsSync(gitignore)) rules.push(...fs.readFileSync(gitignore, 'utf8').split(/\r?\n/).map(toRule).filter(Boolean));

  const { files, skipped } = collect(root, rules, outAbs);
  const body = [
    '# Directory tree',
    '',
    fence(tree(repo, files.map((f) => f.rel)), 'text'),
    '',
    '# Files',
    '',
    ...files.flatMap((f) => [`## ${f.rel}`, '', fence(f.text, langOf(f.rel)), '']),
  ].join('\n');
  const tokens = Math.ceil(body.length / 4);
  const header = [
    `# Review bundle: ${repo}`,
    '',
    `- Repository: ${repo}`,
    `- Generated: ${new Date().toISOString()}`,
    `- Files included: ${files.length}`,
    `- Approximate tokens: ${tokens} (characters / 4)`,
    '',
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, header + body);
  console.log(`Bundled ${files.length} files (skipped ${skipped.files} files, ${skipped.dirs} directories) -> ${outAbs} (~${tokens} tokens)`);
  const registered = registerScript(root);
  if (registered) console.log(registered);
}

main();
