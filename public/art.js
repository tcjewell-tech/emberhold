// Emberhold's pixel art, drawn in code: no image files. Everything here works in art pixels
// (one art pixel is two world units; the page scales the small canvas up with hard edges).
// Sprites are painted once on their own little canvas, outlined, and cached.
import { TEAMS, WORLD, CELL, ARENA, inArena } from './sim.js';

export const PX = 0.5; // art pixels per world unit
export const TILE = CELL * PX;
const INK = '#1b1e30', STEEL = '#8794ab', SKIN = '#eec39a', PURPLE = '#8a63e6';

/** Each match wears one of these, chosen from its seed. */
export const MOODS = [
  { name: 'Frostfall', g: '#b4c6d8', hi: '#d6e3ee', lo: '#96abc4', det: '#7d93af', water: '#2c4a6e', panel: '#1e2740', panel2: '#2a3554', edge: '#5b6b93', night: '12,18,52', warm: '#e9d2b0' },
  { name: 'Thaw', g: '#98a58d', hi: '#dfe7e6', lo: '#7f8c78', det: '#5f6c5d', water: '#2f4f4a', panel: '#27241f', panel2: '#373129', edge: '#84735a', night: '14,20,40', warm: '#c9b98f' },
  { name: 'Dusk', g: '#c2b2cf', hi: '#eedadb', lo: '#9f90ba', det: '#8172a2', water: '#3b2f5c', panel: '#281f3e', panel2: '#382b54', edge: '#8068a8', night: '26,14,54', warm: '#eccdb5' },
];

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const lit = (c, t) => (t > 0 ? mix(c, '#fff4e0', t) : mix(c, '#141a33', -t)); // lighter leans warm, darker leans blue
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177 | 0; return ((h ^ (h >> 16)) >>> 0) / 4294967296; };
const newCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

/** Whole-pixel drawing on any context. */
const pen = (c) => ({
  R: (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); },
  E(cx, cy, rx, ry, col) {
    c.fillStyle = col;
    for (let y = Math.ceil(cy - ry); y <= cy + ry; y++) {
      const half = rx * Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2)), x0 = Math.round(cx - half), x1 = Math.round(cx + half);
      if (x1 > x0) c.fillRect(x0, y, x1 - x0, 1);
    }
  },
  /** A rounded shape lit from the top left. */
  ball(cx, cy, rx, ry, col) { this.E(cx + 0.6, cy + 0.6, rx, ry, lit(col, -0.3)); this.E(cx - 0.4, cy - 0.4, rx - 0.8, ry - 0.8, col); this.E(cx - rx * 0.35, cy - ry * 0.4, rx * 0.3, ry * 0.25, lit(col, 0.35)); },
});

const cache = new Map();
function sprite(key, w, h, draw) {
  if (cache.has(key)) return cache.get(key);
  const c = newCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  draw(pen(x));
  const d = x.getImageData(0, 0, w, h).data, solid = (i, j) => i >= 0 && j >= 0 && i < w && j < h && d[(j * w + i) * 4 + 3] > 128;
  x.fillStyle = INK;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (!solid(i, j) && (solid(i - 1, j) || solid(i + 1, j) || solid(i, j - 1) || solid(i, j + 1))) x.fillRect(i, j, 1, 1);
  cache.set(key, c);
  return c;
}

/** A hero, 26 x 31. f: 0 standing, 1 or 2 mid-stride. */
export function heroSprite(kind, team, f = 0) {
  const T = TEAMS[team].color;
  return sprite(kind + team + f, 26, 31, (s) => {
    const cx = 13, wide = kind === 'anvil' ? 8 : kind === 'dart' ? 5.5 : 6.5;
    const cloth = kind === 'patch' ? '#e9edf2' : T, trousers = '#3d4660';
    [0, 1].forEach((k) => { const up = f === k + 1 ? 1 : 0; s.R(cx - 5 + k * 6, 22, 4, 6 - up, lit(trousers, k ? -0.25 : 0)); s.R(cx - 5 + k * 6, 27 - up, 4, 3, '#272c40'); });
    s.R(cx - wide - 2, 14, 3, 7, lit(cloth, 0.05)); s.R(cx + wide - 1, 14, 3, 7, lit(cloth, -0.35));
    s.R(cx - wide - 2, 20, 3, 2, SKIN); s.R(cx + wide - 1, 20, 3, 2, lit(SKIN, -0.2));
    s.ball(cx, 17, wide, 6.5, cloth);
    s.R(cx - wide + 1, 21, wide * 2 - 1, 2, lit(trousers, -0.1));
    if (kind === 'anvil') {
      s.ball(cx - 8, 12, 4, 3.5, STEEL); s.ball(cx + 8, 12, 4, 3.5, STEEL);
      s.R(cx - 3, 13, 6, 6, lit(T, -0.25)); s.R(cx - 2, 14, 4, 1, lit(T, 0.4));
      s.ball(cx, 7, 6.5, 6.5, STEEL); s.R(cx - 5, 7, 10, 3, INK); s.R(cx - 4, 8, 4, 1, lit(T, 0.5)); s.R(cx - 1, 1, 2, 4, T);
    } else if (kind === 'dart') {
      s.ball(cx, 7.5, 6, 6.5, T); s.E(cx, 9, 3.6, 3.2, lit(SKIN, -0.1)); s.E(cx - 0.3, 8.6, 3, 2.6, SKIN);
      s.R(cx - 2, 9, 1, 2, INK); s.R(cx + 1, 9, 1, 2, INK);
      s.R(cx - 4, 12, 9, 2, '#f1e7d2'); s.R(cx + 4, 13, 5, 2, '#f1e7d2'); s.R(cx + 7, 15, 3, 2, lit('#f1e7d2', -0.25));
      s.R(cx - 4, 15, 2, 6, lit(T, -0.3));
    } else if (kind === 'patch') {
      s.R(cx - 1, 14, 3, 7, '#d9423f'); s.R(cx - 3, 16, 7, 3, '#d9423f'); s.R(cx - 1, 14, 1, 7, '#f06a5f');
      s.R(cx - 6, 13, 12, 1, T); s.R(cx - 6, 21, 12, 1, T); s.R(cx + 4, 15, 3, 5, '#8a5a34'); s.R(cx + 4, 15, 3, 1, lit('#8a5a34', 0.3));
      s.ball(cx, 7.5, 5.5, 5.5, SKIN); s.E(cx, 5, 5.6, 3.6, '#6b4428'); s.E(cx - 1, 4.4, 4, 2.2, '#8a5a34'); s.ball(cx + 4.5, 3, 2.4, 2.4, '#6b4428');
      s.R(cx - 2, 8, 1, 2, INK); s.R(cx + 1, 8, 1, 2, INK);
    } else {
      s.R(cx - 3, 13, 6, 8, lit(T, -0.3)); s.R(cx - 2, 15, 4, 2, '#f3d06a'); s.R(cx - 8, 12, 3, 9, '#8a5a34'); s.R(cx - 8, 12, 3, 1, '#b07a48');
      s.ball(cx, 8, 5.5, 5.5, SKIN); s.E(cx, 4.6, 6.4, 3.6, lit('#e8e2d0', -0.25)); s.E(cx - 0.6, 4, 5.4, 2.8, '#e8e2d0'); s.R(cx - 7, 6, 14, 1, lit('#e8e2d0', -0.35));
      s.R(cx - 4, 8, 3, 2, INK); s.R(cx + 1, 8, 3, 2, INK); s.R(cx - 3, 8, 1, 1, '#9fe6ff'); s.R(cx + 2, 8, 1, 1, '#9fe6ff'); s.R(cx - 1, 9, 2, 1, STEEL);
    }
  });
}

function enemySprite(type, f, stunned) {
  const P = stunned ? '#7fa8ff' : type === 'colossus' ? '#c2476f' : PURPLE, D = stunned ? '#5d7fd0' : type === 'colossus' ? '#8a2f55' : '#5b40b5', eye = '#ffd35a';
  if (type === 'skitter') return sprite('sk' + f + stunned, 22, 15, (s) => {
    for (const side of [-1, 1]) for (let k = 0; k < 3; k++) { const y = 5 + k * 3 + ((k + f) % 2), x = 11 + side * 6; s.R(x - (side < 0 ? 3 : 0), y, 4, 1, lit(P, -0.5)); s.R(x + side * 4 - (side < 0 ? 0 : 1), y + 1, 1, 2, lit(P, -0.5)); }
    s.ball(11, 7, 6, 4.5, P); s.ball(11, 11, 3.5, 2.6, lit(P, -0.15)); s.R(8, 11, 2, 2, eye); s.R(12, 11, 2, 2, eye);
  });
  if (type === 'spitter') return sprite('sp' + f + stunned, 22, 28, (s) => {
    s.R(5, 23, 3, 4, lit(P, -0.5)); s.R(14, 23, 3, 4, lit(P, -0.5));
    s.ball(11, 16 - f, 7.5, 8, lit(P, 0.1)); s.E(11, 18 - f, 4, 4.5, '#b9f27c'); s.E(10.4, 17.2 - f, 2.6, 3, '#e3ffb0');
    s.ball(11, 7 - f, 5, 5, P); s.E(11, 9 - f, 2.6, 2, INK); s.R(10, 9 - f, 2, 1, '#b9f27c'); s.R(7, 5 - f, 2, 2, eye); s.R(13, 5 - f, 2, 2, eye);
  });
  return sprite(type + f + stunned, 38, 34, (s) => { // breaker; a colossus is this, redder and drawn double size
    for (const side of [-1, 1]) for (let k = 0; k < 3; k++) s.R(19 + side * 14 - 2, 12 + k * 6 + ((k + f) % 2), 5, 3, lit(D, -0.45));
    s.ball(19, 15, 14, 12, D);
    for (let k = 0; k < 3; k++) { s.R(8 + k, 10 + k * 5, 22 - k * 2, 1, lit(D, -0.4)); s.R(8 + k, 11 + k * 5, 22 - k * 2, 1, lit(D, 0.2)); }
    s.R(18, 4, 1, 22, lit(D, -0.4));
    s.ball(19, 26, 7, 5, P); s.R(15, 26, 3, 2, eye); s.R(21, 26, 3, 2, eye);
    s.R(11, 27, 3, 5, '#c3ccdb'); s.R(25, 27, 3, 5, STEEL); s.R(12, 31, 2, 2, '#c3ccdb'); s.R(25, 31, 2, 2, STEEL);
  });
}

const wreckSprite = () => sprite('wreck', 48, 26, (s) => {
  const R = '#7a4a36', H = '#5c6478';
  s.ball(22, 16, 19, 8, H); s.ball(30, 12, 11, 7, R); s.R(8, 14, 12, 2, lit(H, -0.4)); s.R(26, 9, 9, 1, lit(R, 0.3)); s.R(34, 13, 2, 6, lit(R, -0.4));
  s.R(12, 6, 3, 9, H); s.R(12, 6, 1, 9, lit(H, 0.3)); s.R(15, 8, 8, 2, lit(H, -0.2)); s.R(20, 13, 4, 3, '#f2c66d'); s.R(20, 13, 4, 1, '#fff0b8');
  for (let i = 6; i < 40; i += 2) if (hash(i, 7) < 0.6) s.R(i, 8 + Math.abs(22 - i) / 4 - (i > 22 && i < 38 ? 3 : 0), 2, 2, '#f4f8fb');
});

/**
 * The ground for the whole map in one mood: soft drifts from smooth noise, trodden warm
 * ground round each Ember, then sparse tufts and stones. Built once per mood, about 3 million pixels.
 */
const grounds = [];
export function ground(mood) {
  if (grounds[mood]) return grounds[mood];
  const M = MOODS[mood], w = WORLD.w * PX, h = WORLD.h * PX, c = newCanvas(w, h), x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data;
  const tones = [M.lo, mix(M.g, M.lo, 0.5), M.g, mix(M.g, M.hi, 0.5), M.hi, mix(M.warm, M.g, 0.5), M.warm, M.water, lit(M.water, 0.2), lit(M.lo, -0.35), M.hi].map(rgb);
  const grid = (n, ox) => { const cols = Math.ceil(w / n) + 2, rows = Math.ceil((h * 1.5) / n) + 2, v = new Float32Array(cols * rows); for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) v[j * cols + i] = hash(i + ox, j); return { n, cols, v }; };
  const ease = (t) => t * t * (3 - 2 * t);
  const noise = (G, px, py) => { const gx = Math.floor(px / G.n), gy = Math.floor(py / G.n), fx = ease(px / G.n - gx), fy = ease(py / G.n - gy), i = gy * G.cols + gx, a = G.v[i], b = G.v[i + 1], cc = G.v[i + G.cols], dd = G.v[i + G.cols + 1]; return a + (b - a) * fx + (cc - a) * fy + (a - b - cc + dd) * fx * fy; };
  const big = grid(46, 0), small = grid(17, 99);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const n = noise(big, i, j * 1.5) * 0.65 + noise(small, i, j * 1.5) * 0.35;
    let t = n > 0.7 ? 4 : n > 0.62 ? 3 : n < 0.29 ? 0 : n < 0.36 ? 1 : 2;
    // Beyond the arena's edge: a dark shore, a line of surf, then open water with ripples.
    const out = Math.hypot(i / PX - ARENA.x, j / PX - ARENA.y) - ARENA.r;
    if (out > -6) t = out < 0 ? 9 : out < 4 ? 10 : n > 0.66 && hash(i >> 2, j) < 0.5 ? 8 : 7;
    for (const T of TEAMS) {
      const dx = i - T.x * PX, dy = (j - T.y * PX) * 1.25;
      if (Math.abs(dx) > 60 || Math.abs(dy) > 60) continue;
      const dist = Math.hypot(dx, dy);
      if (dist < 46) t = dist < 30 || hash(i, j) < 0.7 ? 6 : 5;
      else if (dist < 58 && hash(i, j) < (58 - dist) / 14) t = 5;
    }
    const k = (j * w + i) * 4, col = tones[t];
    d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const s = pen(x);
  for (let j = 0; j < h; j += 5) for (let i = 0; i < w; i += 5) {
    const r = hash(i + 7, j + 3);
    if (!inArena(i / PX, j / PX, 12)) continue;
    if (r < 0.02) { s.R(i, j, 3, 1, M.det); s.R(i + 1, j - 1, 1, 1, M.det); }
    else if (r < 0.03) { s.E(i, j, 2.5, 1.8, lit(M.det, -0.2)); s.R(i - 1, j - 1, 2, 1, lit(M.det, 0.4)); }
    else if (r < 0.05) s.R(i, j, 2, 1, M.hi);
  }
  return (grounds[mood] = c);
}

/** Painters for one target canvas. Positions are art pixels on that canvas. */
export function createArt(g) {
  const S = pen(g);
  const put = (c, cx, footY, scale = 1) => g.drawImage(c, Math.round(cx - (c.width * scale) / 2), Math.round(footY - c.height * scale), c.width * scale, c.height * scale);
  const shadow = (x, y, rx) => { g.globalAlpha = 0.22; S.E(x, y, rx, rx * 0.4, '#141a33'); g.globalAlpha = 1; };
  function meter(x, y, w, frac, col, h = 3) {
    frac = Math.max(0, Math.min(1, frac));
    S.R(x - 1, y - 1, w + 2, h + 2, INK); S.R(x, y, w, h, '#343b55');
    const f = Math.round(w * frac); S.R(x, y, f, h, col); S.R(x, y, f, 1, lit(col, 0.45)); if (h > 2) S.R(x, y + h - 1, f, 1, lit(col, -0.3));
  }
  /** A circle of dots: every `gap`-th art pixel of the arc from a0, `turn` of the way round. */
  function ring(x, y, r, col, { gap = 1, turn = 1, a0 = 0, thick = 1 } = {}) {
    const n = Math.max(8, Math.round(Math.PI * 2 * r));
    for (let k = 0; k < n * turn; k += gap) { const a = a0 + (k / n) * Math.PI * 2; S.R(x + Math.cos(a) * r - thick / 2, y + Math.sin(a) * r - thick / 2, thick, thick, col); }
  }
  function gun(kind, x, y, aim) {
    const len = kind === 'dart' ? 15 : kind === 'anvil' ? 10 : 9, thick = kind === 'anvil' ? 4 : 3, hy = y - 11;
    for (let k = 5; k < len; k++) S.R(x + Math.cos(aim) * k - thick / 2, hy + Math.sin(aim) * k - thick / 2, thick, thick, INK);
    for (let k = 5; k < len - 1; k++) S.R(x + Math.cos(aim) * k - 0.5, hy + Math.sin(aim) * k - 1, thick - 2, 1, k > len - 4 ? '#c3ccdb' : STEEL);
  }
  return {
    S, meter, ring,
    /** x, y: where the hero's feet are. h is the hero from the snapshot. */
    hero(h, x, y, aim, { walking, mine, t }) {
      const T = TEAMS[h.team].color;
      shadow(x, y, 9);
      if (h.fortify > 0) ring(x, y - 10, 19, '#ffe9a8', { gap: 2, a0: t / 300, thick: 2 });
      if (h.overdrive > 0) ring(x, y - 10, 17, '#ff7ad9', { gap: 3, a0: -t / 120, thick: 2 });
      if (h.rush > 0) ring(x, y - 10, 15, '#5ad1ff', { gap: 4, a0: t / 90, thick: 2 });
      if (h.fury > 0) ring(x, y - 10, 21, '#ff5a4f', { gap: 5, a0: -t / 200, thick: 2 });
      if (Math.sin(aim) < 0) gun(h.kind, x, y, aim);
      put(heroSprite(h.kind, h.team, walking ? 1 + (Math.floor(t / 180) % 2) : 0), x, y + 1);
      if (Math.sin(aim) >= 0) gun(h.kind, x, y, aim);
      if (h.stun > 0) for (let k = 0; k < 3; k++) { const a = t / 200 + k * 2.1; S.R(x + Math.cos(a) * 9 - 1, y - 30 + Math.sin(a) * 3, 2, 2, '#9fd0ff'); }
      meter(x - 9, y - 36, 18, h.hp / h.max, T);
      if (h.shieldMax) { const w = Math.round(18 * h.shield / h.shieldMax); S.R(x - 10, y - 40, 20, 3, INK); S.R(x - 9, y - 39, w, 1, '#bfe9ff'); }
      if (mine) { S.R(x - 2, y - (h.shieldMax ? 47 : 44), 5, 3, INK); S.R(x - 1, y - (h.shieldMax ? 46 : 43), 3, 1, '#ffffff'); S.R(x, y - (h.shieldMax ? 45 : 42), 1, 2, '#ffffff'); }
    },
    enemy(e, x, y, t) {
      const f = Math.floor(t / 150 + e.id) % 2, big = e.type === 'colossus', c = enemySprite(e.type, f, e.stun > 0), scale = big ? 2 : 1;
      shadow(x, y, (c.width * scale) / 2.4);
      put(c, x, y + 2, scale);
      if (e.hp < e.max) meter(x - 9 * scale, y - c.height * scale - 3, 18 * scale, e.hp / e.max, '#e58cff', big ? 3 : 2);
    },
    /** Eyes that show through the dark. */
    eyes(e, x, y) {
      const big = e.type === 'colossus' ? 2 : 1, w = (e.type === 'skitter' ? 3 : e.type === 'spitter' ? 4 : 4) * big, up = (e.type === 'skitter' ? 3 : e.type === 'spitter' ? 22 : 6) * big;
      S.R(x - w, y - up, 2 * big, 2 * big, '#ffd35a'); S.R(x + w - 2 * big, y - up, 2 * big, 2 * big, '#ffd35a');
    },
    wall(st, x, y) {
      const T = TEAMS[st.team].color, hurt = st.hp / st.max;
      S.R(x - 1, y - 1, 22, 22, INK);
      S.R(x, y, 20, 14, STEEL); S.R(x, y, 20, 2, lit(STEEL, 0.45)); S.R(x, y, 2, 14, lit(STEEL, 0.25)); S.R(x + 18, y + 2, 2, 12, lit(STEEL, -0.25));
      S.R(x + 3, y + 5, 14, 5, T); S.R(x + 3, y + 5, 14, 1, lit(T, 0.45)); S.R(x + 3, y + 9, 14, 1, lit(T, -0.35));
      S.R(x + 3, y + 3, 1, 1, INK); S.R(x + 16, y + 3, 1, 1, INK); S.R(x + 3, y + 11, 1, 1, INK); S.R(x + 16, y + 11, 1, 1, INK);
      S.R(x, y + 14, 20, 6, lit(STEEL, -0.5)); S.R(x, y + 14, 20, 1, lit(STEEL, -0.3)); S.R(x + 6, y + 15, 1, 5, lit(STEEL, -0.65)); S.R(x + 13, y + 15, 1, 5, lit(STEEL, -0.65));
      for (let i = 0; i < 20; i += 2) if (hash(st.cx * 20 + i, st.cy) < 0.55) S.R(x + i, y - 1, 2, hash(st.cx * 20 + i, st.cy + 1) < 0.4 ? 3 : 2, '#f4f8fb');
      if (hurt < 0.75) { S.R(x + 8, y + 1, 1, 5, INK); S.R(x + 9, y + 5, 1, 5, INK); S.R(x + 7, y + 4, 1, 1, INK); }
      if (hurt < 0.45) { S.R(x + 10, y + 9, 1, 8, INK); S.R(x + 11, y + 12, 2, 1, INK); S.R(x + 14, y + 2, 1, 4, INK); S.R(x + 4, y + 10, 1, 6, INK); }
    },
    spikes(st, x, y) {
      const T = TEAMS[st.team].color, left = Math.ceil(6 * st.hp / st.max);
      S.R(x + 1, y + 2, 18, 17, INK); S.R(x + 2, y + 3, 16, 15, '#3a4158'); S.R(x + 2, y + 3, 16, 1, '#4b536e'); S.R(x + 2, y + 16, 16, 2, T);
      [[4, 9], [10, 8], [15, 10], [7, 14], [13, 15], [3, 15]].slice(0, left).forEach(([i, j]) => { // blades wear away as it is used up
        S.R(x + i - 1, y + j - 1, 3, 2, INK); S.R(x + i, y + j - 4, 1, 4, INK); S.R(x + i - 1, y + j - 3, 1, 3, '#dfe6f0'); S.R(x + i, y + j - 1, 1, 1, STEEL);
      });
    },
    /** A Sentry (st.ttl > 0) is the same gun on a light tripod. */
    turret(st, x, y) {
      const T = TEAMS[st.team].color, cx = x + 10, cy = y + 8, sentry = st.ttl > 0;
      shadow(cx, cy + 9, 11);
      if (sentry) { S.R(cx - 8, cy + 7, 2, 4, INK); S.R(cx + 6, cy + 7, 2, 4, INK); S.R(cx - 1, cy + 8, 2, 4, INK); S.R(cx - 7, cy + 5, 14, 2, lit(STEEL, -0.3)); }
      else { S.E(cx, cy + 6, 10, 6, INK); S.E(cx, cy + 5, 9, 5, lit(STEEL, -0.35)); S.E(cx, cy + 4, 9, 4.5, STEEL); S.E(cx - 2, cy + 3, 5, 2, lit(STEEL, 0.3)); }
      for (let k = 4; k < 15; k++) S.R(cx + Math.cos(st.aim) * k - 2, cy - 2 + Math.sin(st.aim) * k * 0.8 - 2, 4, 4, INK);
      for (let k = 4; k < 14; k++) S.R(cx + Math.cos(st.aim) * k - 1, cy - 2 + Math.sin(st.aim) * k * 0.8 - 1, 2, 1, '#c3ccdb');
      S.E(cx, cy - 1, 7, 7, INK); S.ball(cx, cy - 1, 6, 6, T);
      if (st.hp < st.max) meter(x + 2, y + 21, 16, st.hp / st.max, T, 2);
    },
    /** A stone bowl with a flame in the team's colour; the flame shrinks as the Ember is hurt. */
    ember(k, x, y, frac, alive, t) {
      const T = TEAMS[k].color, f = Math.floor(t / 100);
      shadow(x, y + 9, 24);
      S.E(x, y + 5, 21, 10, INK); S.E(x, y + 5, 20, 9, '#4b4f66'); S.E(x, y + 3, 20, 8, '#8a8fa8'); S.E(x - 4, y + 1, 10, 2.5, '#b4b9cc'); S.E(x, y + 3, 15, 5, '#2b1a1c');
      for (let a = 0; a < 6; a++) S.R(x - 18 + a * 7, y + 9 - Math.abs(a - 2.5) * 1.2, 3, 2, T);
      if (!alive) { for (let c = 0; c < 6; c++) S.R(x - 9 + c * 3.4, y + 2 + hash(c, 3) * 3, 2, 1, '#55505a'); return; }
      for (let c = 0; c < 9; c++) S.R(x - 11 + c * 2.6 + hash(c, f) * 2, y + 2 + hash(c, 3) * 3, 2, 1, hash(c, f + 9) < 0.5 ? T : lit(T, 0.5));
      const size = 0.45 + 0.55 * frac;
      const tongue = (w, h, col, ph) => { for (let j = 0; j < h; j++) { const u = j / h, ww = Math.max(1, w * (1 - u ** 1.5)), sway = Math.sin(f * 0.9 + ph + u * 4) * u * 3; S.R(x - ww / 2 + sway, y + 4 - j, Math.round(ww), 1, col); } };
      tongue(24 * size, (38 + (f % 3)) * size, lit(T, -0.4), 0); tongue(18 * size, (30 + ((f + 1) % 3)) * size, T, 1.3); tongue(11 * size, (21 + (f % 2)) * size, lit(T, 0.5), 2.1); tongue(4, 11 * size, '#fffaf0', 0.4);
      for (let c = 0; c < 4; c++) { const u = ((f + c * 5) % 16) / 16; S.R(x - 9 + hash(c, 2) * 18 + Math.sin(u * 6 + c) * 3, y - 26 * size - u * 26, 1, 1, u < 0.5 ? lit(T, 0.5) : T); }
      meter(x - 20, y + 19, 40, frac, T, 3);
    },
    wreck(x, y) { shadow(x, y + 3, 22); put(wreckSprite(), x, y + 8); },
    /** A dropped power-up: a bobbing gem in its colour, blinking as it is about to fade. */
    pickup(p, x, y, t) {
      if (p.ttl < 4 && Math.floor(t / 150) % 2) return;
      const col = { rush: '#5ad1ff', fury: '#ff5a4f', mend: '#63d07a' }[p.kind], bob = Math.round(Math.sin(t / 250 + p.id) * 2), gy = y - 9 + bob;
      shadow(x, y, 6);
      this.glow(x, gy, 16, col, 0.5);
      S.E(x, gy, 7, 7, INK); S.ball(x, gy, 6, 6, col);
      const W = '#ffffff';
      if (p.kind === 'mend') { S.R(x - 1, gy - 3, 2, 6, W); S.R(x - 3, gy - 1, 6, 2, W); }
      else if (p.kind === 'rush') { S.R(x - 3, gy - 2, 1, 1, W); S.R(x - 2, gy - 1, 1, 1, W); S.R(x - 3, gy, 1, 1, W); S.R(x, gy - 2, 1, 1, W); S.R(x + 1, gy - 1, 1, 1, W); S.R(x, gy, 1, 1, W); }
      else { S.R(x - 1, gy - 3, 2, 2, W); S.R(x - 2, gy - 1, 4, 2, W); S.R(x - 1, gy + 1, 2, 2, W); }
    },
    shot(sh, x, y) {
      const col = sh.team < 0 ? '#b9f27c' : TEAMS[sh.team].color, a = Math.atan2(sh.vy, sh.vx);
      for (let k = 1; k <= 7; k++) { g.globalAlpha = 1 - k / 8; S.R(x - Math.cos(a) * k * 1.5 - 1, y - Math.sin(a) * k * 1.5 - 1, k < 3 ? 2 : 1, k < 3 ? 2 : 1, col); }
      g.globalAlpha = 0.35; S.E(x, y, 3.5, 3.5, col); g.globalAlpha = 1; S.R(x - 1, y - 1, 2, 2, '#ffffff');
    },
    /** A burst that grows and fades: f is the effect from the snapshot, r its radius in art pixels. */
    fx(f, x, y, r) {
      const p = Math.max(0, Math.min(1, 1 - f.ttl / 0.45));
      const col = f.kind === 'heal' ? '#7dffa8' : f.kind === 'down' ? '#ff6b6b' : f.kind === 'scrap' ? '#f2c66d' : f.kind === 'ult' ? '#ffffff' : f.team < 0 ? '#e58cff' : TEAMS[f.team].color;
      const rad = r * (f.kind === 'dash' ? 1 : 0.3 + 0.7 * p) * (f.kind === 'fall' ? 1.6 : 1);
      g.globalAlpha = 1 - p;
      ring(x, y, rad, col, { thick: f.kind === 'fall' ? 4 : 2, gap: p > 0.6 ? 2 : 1 });
      if (f.kind === 'heal' || f.kind === 'pop') { g.globalAlpha = (1 - p) * 0.25; S.E(x, y, rad, rad, col); }
      if (f.kind === 'scrap' || f.kind === 'heal') for (let k = 0; k < 5; k++) { g.globalAlpha = 1 - p; S.R(x - 8 + hash(k, f.id) * 16, y - p * 16 - hash(k, 5) * 8, 2, 2, col); }
      g.globalAlpha = 1;
    },
    /** A soft additive glow, for fire. */
    glow(x, y, r, col, a) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = a; g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    },
  };
}
