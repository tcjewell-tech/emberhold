// Emberhold rules. Pure: no DOM, no timers, no Math.random. The match state is plain JSON,
// so the server can stringify it and tests can replay it.

export const CELL = 40;
export const COLS = 90;
export const ROWS = 85;
export const WORLD = { w: COLS * CELL, h: ROWS * CELL };

// Embers sit on grid corners so each covers a symmetric 2x2 block of cells.
export const TEAMS = [
  { name: 'Amber', color: '#ffb347', x: 1800, y: 720 },
  { name: 'Azure', color: '#5ab0ff', x: 2760, y: 2360 },
  { name: 'Jade', color: '#4fd69c', x: 840, y: 2360 },
];

/** The playable ground is a circle centred on the three Embers; outside it is open water. */
export const ARENA = { x: (TEAMS[0].x + TEAMS[1].x + TEAMS[2].x) / 3, y: (TEAMS[0].y + TEAMS[1].y + TEAMS[2].y) / 3, r: 1580 };
export const inArena = (x, y, pad = 0) => (x - ARENA.x) ** 2 + (y - ARENA.y) ** 2 <= (ARENA.r - pad) ** 2;
/** Move a unit straight back inside the circle, pad from its edge. */
function keepIn(o, pad) {
  const dx = o.x - ARENA.x, dy = o.y - ARENA.y, d = Math.hypot(dx, dy), max = ARENA.r - pad;
  if (d > max) {
    o.x = ARENA.x + (dx / d) * max;
    o.y = ARENA.y + (dy / d) * max;
  }
}

/** Temporary power-ups AI enemies sometimes drop. Any hero can grab one, rivals included. */
export const POWERUPS = {
  rush: { name: 'Rush', time: 10, speed: 1.4, text: '10 s: 40% faster' },
  fury: { name: 'Fury', time: 10, mult: 1.5, text: '10 s: 50% more gun damage' },
  mend: { name: 'Mend', heal: 0.5, text: 'Heal half your health' },
};
export const PICKUP_TTL = 20; // seconds a dropped power-up lies before it fades
export const PICKUP_R = 26; // how close a hero must walk to grab one
const DROP = { skitter: 0.03, spitter: 0.06, breaker: 0.25, colossus: 1 };

export const DAY_LENGTH = 50;
export const RESPAWN = 8;
export const START_SCRAP = 60;
export const EMBER_HP = 1500;
export const EMBER_R = 44;
export const EMBER_ARMOR = 0.3; // share of hero and Turret shot damage an Ember takes; AI enemies hit it in full
export const HERO_R = 14;
export const BUILD_RANGE = 360;
export const NO_BUILD_NEAR_RIVAL = 400;
export const SCAV_RANGE = 50;
export const SCAV_TIME = 1.5;
export const HERO_BOUNTY = 20;
export const EMBER_BOUNTY = 150;
export const AGGRO = 170;
const SPAWN_RING = 650;
const WRECKS_PER_TEAM = 6; // per day, plus three shared ones mid-map
const WALL_COST = 30; // flow-field price of chewing through a blocking structure, in cells of detour
const ULT_PER_DMG = 0.25;
const ULT_PER_HEAL = 0.4;
const ENDLESS_PACE = 0.5; // endless mode: how much of a normal night's step up in difficulty each night brings

export const HERO_IDS = ['anvil', 'dart', 'patch', 'cog', 'forge'];
export const TEAM_SIZE = HERO_IDS.length;
/** A hero's slot is team * TEAM_SIZE + its place in HERO_IDS. */
export const teamOf = (slot) => Math.floor(slot / TEAM_SIZE);
export const HEROES = {
  anvil: {
    name: 'Anvil', role: 'Vanguard', hp: 360, speed: 165, passive: 'Shield: soaks 100 damage, refills after 4 s unhurt',
    shield: { max: 100, delay: 4, rate: 25 },
    gun: { name: 'Scattergun', dmg: 12, pellets: 6, spread: 0.3, rate: 1.1, range: 320, speed: 720 },
    q: { name: 'Shockwave', cd: 8, r: 120, dmg: 20, push: 90, stun: 1.5, text: 'Knock back and stun nearby hostiles' },
    r: { name: 'Fortify', time: 6, taken: 0.25, taunt: 320, text: '6 s: take 75% less damage, nearby AI enemies target you' },
  },
  dart: {
    name: 'Dart', role: 'Striker', hp: 120, speed: 215, passive: 'Scavenges 2x faster',
    gun: { name: 'Pulse rifle', dmg: 4.5, pellets: 1, spread: 0.03, rate: 8, range: 460, speed: 900 },
    q: { name: 'Dash', cd: 4, dist: 150, text: 'Blink a short way in your move direction' },
    r: { name: 'Overdrive', time: 6, mult: 2, text: '6 s: double fire rate' },
  },
  patch: {
    name: 'Patch', role: 'Medic', hp: 140, speed: 185, passive: 'None',
    gun: { name: 'Needler', dmg: 13, pellets: 1, spread: 0.02, rate: 4, range: 460, speed: 850 },
    q: { name: 'Mend', cd: 7, r: 150, heal: 70, text: 'Heal teammates around you' },
    r: { name: 'Second Wind', text: 'Revive downed teammates and fully heal the team' },
  },
  cog: {
    name: 'Cog', role: 'Engineer', hp: 160, speed: 175, passive: 'Structures cost 25% less',
    gun: { name: 'Nailgun', dmg: 16, pellets: 1, spread: 0.02, rate: 3.5, range: 420, speed: 850 },
    q: { name: 'Sentry', cd: 14, ttl: 20, hp: 100, text: 'Drop a free Turret for 20 s' },
    r: { name: 'Overclock', time: 8, mult: 2, text: 'Repair your structures; Turrets fire 2x for 8 s' },
  },
  forge: {
    name: 'Forge', role: 'Support', hp: 150, speed: 150, passive: 'Shield field: Forge and teammates beside it carry a 50-point barrier',
    gun: { name: 'Rivet gun', dmg: 15, pellets: 1, spread: 0.02, rate: 4, range: 420, speed: 700 },
    q: { name: 'Reforge', cd: 8, r: 170, repair: 100, text: 'Repair your Walls, Turrets and Shield Generators around you' },
    r: { name: 'Aegis', time: 6, taken: 0.5, text: '6 s: your whole team takes half damage' },
  },
};

export const STRUCTS = {
  wall: { name: 'Wall', cost: 10, hp: 300, blocks: true },
  turret: { name: 'Turret', cost: 40, hp: 150, blocks: true, range: 280, dmg: 12, rate: 3 },
  spikes: { name: 'Spikes', cost: 15, hp: 400, blocks: false, dps: 30 }, // hp is wear: damage it can still deal
  // Friendly heroes within radius carry a barrier of absorb points, which refills after delay s unhurt.
  // buildTime: seconds after placing before it works. size: how wide it is drawn; it still fills its cell.
  shield: { name: 'Shield Generator', cost: 35, hp: 120, blocks: true, buildTime: 2, size: 28, radius: 90, absorb: 50, delay: 4, rate: 25 },
};

export const ENEMIES = {
  skitter: { name: 'Skitter', hp: 30, speed: 120, dmg: 8, rate: 1, r: 10, bounty: 1 },
  spitter: { name: 'Spitter', hp: 45, speed: 80, dmg: 10, rate: 0.8, r: 12, bounty: 1, range: 260 },
  breaker: { name: 'Breaker', hp: 260, speed: 60, dmg: 25, rate: 0.8, r: 20, bounty: 1, structMult: 3 },
  colossus: { name: 'Colossus', hp: 2500, speed: 45, dmg: 40, rate: 0.5, r: 36, bounty: 1, structMult: 2, slam: { r: 130, every: 4 } },
};

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const IDLE = {};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const cellOf = (v) => Math.floor(v / CELL);
const inGrid = (cx, cy) => cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS;
// Cells whose centre is on the ground: the only ones that can be built on or walked by pathing.
const LAND = Uint8Array.from({ length: COLS * ROWS }, (_, i) => inArena((i % COLS) * CELL + CELL / 2, Math.floor(i / COLS) * CELL + CELL / 2, CELL / 2));
const onLand = (cx, cy) => inGrid(cx, cy) && LAND[cy * COLS + cx] === 1;
const num = (v) => (Number.isFinite(v) ? v : 0);

/** Seeded RNG (mulberry32). Its state lives in the match so a replay is exact. */
function rand(s) {
  s.seed = (s.seed + 0x6d2b79f5) | 0;
  let t = Math.imul(s.seed ^ (s.seed >>> 15), 1 | s.seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Where hero number k of a team stands guard, and respawns. */
export function post(team, k) {
  const a = Math.PI / 4 + (k * 2 * Math.PI) / TEAM_SIZE;
  return { x: TEAMS[team].x + Math.cos(a) * 110, y: TEAMS[team].y + Math.sin(a) * 110 };
}

export function createGame(seed = 1) {
  const s = {
    // mood: which of the three colour moods the match wears. s.seed cannot say: it moves on with every random number.
    t: 0, seed: seed | 0, mood: Math.abs(seed | 0) % 3, phase: 'day', wave: 0, timer: DAY_LENGTH, winner: null, nextId: 1, sv: 0,
    endless: false, // endless mode: the match goes on until every Ember has fallen, and whoever fell last wins
    teams: TEAMS.map((T) => ({ scrap: START_SCRAP, alive: true, overclock: 0, aegis: 0, ember: { x: T.x, y: T.y, hp: EMBER_HP, max: EMBER_HP } })),
    heroes: [], enemies: [], shots: [], structs: [], wrecks: [], pickups: [], fx: [], spawn: [],
  };
  for (let team = 0; team < TEAMS.length; team++) {
    HERO_IDS.forEach((kind, k) => {
      const hp = HEROES[kind].hp, shield = HEROES[kind].shield?.max ?? 0;
      s.heroes.push({
        i: team * TEAM_SIZE + k, team, kind, ...post(team, k), aim: 0, hp, max: hp, alive: true, out: false, respawn: 0,
        shield, shieldMax: shield, shieldCd: 0, fireCd: 0, qCd: 0, ult: 0, fortify: 0, overdrive: 0, rush: 0, fury: 0, stun: 0, scav: 0, scavId: 0,
        stats: { dmg: 0, heal: 0, scrap: 0, kills: 0, pvp: 0, deaths: 0 },
      });
    });
  }
  spawnWrecks(s);
  return s;
}

/** What the server sends each client: the state minus the spawn queue, numbers rounded. */
export function snapshot(s) {
  // shortcut: whole state as JSON every time, which leans on the socket's stream compression (see server.js); send deltas if that stops being enough
  return JSON.stringify({ ...s, spawn: undefined, pending: s.spawn.length }, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v));
}

// ---------------------------------------------------------------- grid, structures, pathing

// Derived data (cell lookup, wall grid, flow fields) is kept out of the state and rebuilt
// whenever s.sv changes, so the state itself stays plain JSON.
const caches = new WeakMap();
function cache(s) {
  let c = caches.get(s);
  if (!c || c.sv !== s.sv) {
    c = { sv: s.sv, cells: new Map(), wall: new Uint8Array(COLS * ROWS), flows: [null, null, null], shields: s.structs.filter((st) => st.type === 'shield') };
    for (const st of s.structs) {
      c.cells.set(st.cy * COLS + st.cx, st);
      if (STRUCTS[st.type].blocks) c.wall[st.cy * COLS + st.cx] = 1;
    }
    caches.set(s, c);
  }
  return c;
}

export const structAt = (s, cx, cy) => (inGrid(cx, cy) ? cache(s).cells.get(cy * COLS + cx) : undefined);
const blocks = (st) => st !== undefined && STRUCTS[st.type].blocks;

export function addStruct(s, type, team, cx, cy, ttl = 0) {
  const hp = STRUCTS[type].hp;
  const st = { id: s.nextId++, type, team, cx, cy, x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2, hp, max: hp, cd: 0, aim: 0, ttl, wait: STRUCTS[type].buildTime ?? 0 };
  s.structs.push(st);
  s.sv++;
  return st;
}

function removeStruct(s, st) {
  st.dead = true;
  s.structs.splice(s.structs.indexOf(st), 1);
  s.sv++;
}

/** Distance (in cells) from every cell to a team's Ember. Walls are expensive, not impassable. */
function flow(s, team) {
  const c = cache(s);
  if (c.flows[team]) return c.flows[team];
  const d = new Float32Array(COLS * ROWS).fill(Infinity);
  const ex = TEAMS[team].x / CELL, ey = TEAMS[team].y / CELL;
  const queue = [];
  for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
    d[(ey + dy) * COLS + ex + dx] = 0;
    queue.push((ey + dy) * COLS + ex + dx);
  }
  // shortcut: label-correcting queue instead of a heap; ample for a 90x85 grid
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi], x = i % COLS, y = (i - x) / COLS;
    const enter = c.wall[i] ? WALL_COST : 0;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!onLand(nx, ny)) continue;
      if (dx && dy && (c.wall[y * COLS + nx] || c.wall[ny * COLS + x])) continue; // no squeezing past wall corners
      const nd = d[i] + (dx && dy ? 1.414 : 1) + enter;
      const n = ny * COLS + nx;
      if (nd < d[n] - 1e-3) {
        d[n] = nd;
        queue.push(n);
      }
    }
  }
  return (c.flows[team] = d);
}

/** The point an AI enemy at (x, y) should walk to next on its way to a team's Ember. */
function flowTarget(s, team, x, y) {
  const c = cache(s), d = flow(s, team);
  const cx = clamp(cellOf(x), 0, COLS - 1), cy = clamp(cellOf(y), 0, ROWS - 1);
  if (d[cy * COLS + cx] === 0) return s.teams[team].ember;
  let best = Infinity, bx = cx, by = cy;
  for (const [dx, dy] of DIRS) {
    const nx = cx + dx, ny = cy + dy;
    if (!onLand(nx, ny)) continue;
    if (dx && dy && (c.wall[cy * COLS + nx] || c.wall[ny * COLS + cx])) continue;
    const n = ny * COLS + nx;
    const v = d[n] + (dx && dy ? 1.414 : 1) + (c.wall[n] ? WALL_COST : 0);
    if (v < best) {
      best = v;
      bx = nx;
      by = ny;
    }
  }
  return { x: bx * CELL + CELL / 2, y: by * CELL + CELL / 2 };
}

/** Shove a unit, unless that would put it inside a blocking structure. */
function nudge(s, o, dx, dy) {
  const x = clamp(o.x + dx, HERO_R, WORLD.w - HERO_R), y = clamp(o.y + dy, HERO_R, WORLD.h - HERO_R);
  if (inArena(x, y, HERO_R) && !cache(s).wall[cellOf(y) * COLS + cellOf(x)]) {
    o.x = x;
    o.y = y;
  }
}

function nearest(list, x, y, range, ok) {
  let best = null, bd = range * range;
  for (const o of list) {
    if (!ok(o)) continue;
    const d = dist2(x, y, o.x, o.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** Nearest AI enemy or rival hero within range of (x, y). Used by Turrets and bots. */
export function nearestHostile(s, team, x, y, range) {
  const e = nearest(s.enemies, x, y, range, (o) => !o.dead);
  const h = nearest(s.heroes, x, y, range, (o) => o.alive && o.team !== team);
  if (!e || !h) return e || h;
  return dist2(x, y, e.x, e.y) <= dist2(x, y, h.x, h.y) ? e : h;
}

function nearestEmber(s, x, y) {
  let best = -1, bd = Infinity;
  s.teams.forEach((T, k) => {
    const d = dist2(x, y, T.ember.x, T.ember.y);
    if (T.alive && d < bd) {
      bd = d;
      best = k;
    }
  });
  return best;
}

// ---------------------------------------------------------------- damage and rewards

/** owner: the hero slot whose Q or R this is, so its client can tell its own burst from a teammate's. Left off every other effect. */
function addFx(s, kind, x, y, r, team, owner) {
  const f = { id: s.nextId++, kind, x, y, r, team, ttl: 0.45 };
  if (owner !== undefined) f.owner = owner;
  s.fx.push(f);
}

function credit(s, owner, dmg) {
  if (owner < 0) return;
  const h = s.heroes[owner];
  h.stats.dmg += dmg;
  h.ult = Math.min(100, h.ult + dmg * ULT_PER_DMG);
}

function hurtEnemy(s, e, dmg, team, owner) {
  if (e.dead) return;
  credit(s, owner, Math.min(dmg, e.hp));
  e.hp -= dmg;
  if (e.hp > 0) return;
  e.dead = true;
  if (team >= 0) s.teams[team].scrap += ENEMIES[e.type].bounty;
  if (owner >= 0) s.heroes[owner].stats.kills++;
  addFx(s, 'pop', e.x, e.y, ENEMIES[e.type].r * 2, -1);
  if (rand(s) < DROP[e.type]) {
    const kinds = Object.keys(POWERUPS);
    s.pickups.push({ id: s.nextId++, kind: kinds[Math.floor(rand(s) * kinds.length)], x: e.x, y: e.y, ttl: PICKUP_TTL });
  }
}

function hurtHero(s, h, dmg, team, owner) {
  if (!h.alive) return;
  if (h.fortify > 0) dmg *= HEROES.anvil.r.taken;
  if (s.teams[h.team].aegis > 0) dmg *= HEROES.forge.r.taken;
  credit(s, owner, Math.min(dmg, h.hp + h.shield));
  if (h.shieldMax) h.shieldCd = shieldOf(h).delay; // any hit, absorbed or not, restarts the wait
  const soaked = Math.min(h.shield, dmg);
  h.shield -= soaked;
  h.hp -= dmg - soaked;
  if (h.hp > 0) return;
  Object.assign(h, { hp: 0, alive: false, respawn: RESPAWN, fortify: 0, overdrive: 0, rush: 0, fury: 0, stun: 0, scav: 0, scavId: 0 });
  h.stats.deaths++;
  if (team >= 0) s.teams[team].scrap += HERO_BOUNTY;
  if (owner >= 0) s.heroes[owner].stats.pvp++;
  addFx(s, 'down', h.x, h.y, 40, h.team);
}

function hurtStruct(s, st, dmg, owner) {
  if (st.dead) return;
  credit(s, owner, Math.min(dmg, st.hp));
  st.hp -= dmg;
  if (st.hp <= 0) removeStruct(s, st);
}

function hurtEmber(s, k, dmg, team, owner) {
  const T = s.teams[k];
  if (!T.alive || T.ember.hp <= 0) return;
  credit(s, owner, Math.min(dmg, T.ember.hp));
  T.ember.hp -= dmg;
  if (T.ember.hp > 0) return;
  T.ember.hp = 0; // the team is eliminated at the end of this step
  if (team >= 0) s.teams[team].scrap += EMBER_BOUNTY;
}

/** The rule a hero's barrier refills by: its own (Anvil), else the Shield Generator's. */
const shieldOf = (h) => HEROES[h.kind].shield ?? STRUCTS.shield;

/** Is this hero inside a shield field: a working Shield Generator of its team, or a living Forge teammate (itself included)? */
function shielded(s, h) {
  const r2 = STRUCTS.shield.radius ** 2, near = (o) => o.team === h.team && dist2(h.x, h.y, o.x, o.y) <= r2;
  return cache(s).shields.some((st) => st.wait <= 0 && near(st)) || s.heroes.some((o) => o.kind === 'forge' && o.alive && near(o));
}

function heal(src, o, amount, charges) {
  const a = Math.min(amount, o.max - o.hp);
  o.hp += a;
  src.stats.heal += a;
  if (charges) src.ult = Math.min(100, src.ult + a * ULT_PER_HEAL);
}

function revive(h, atEmber) {
  if (atEmber) Object.assign(h, post(h.team, HERO_IDS.indexOf(h.kind)));
  Object.assign(h, { alive: true, hp: h.max, shield: h.shieldMax, shieldCd: 0, respawn: 0 });
}

function eliminate(s, k) {
  const T = s.teams[k];
  T.alive = false;
  T.ember.hp = 0;
  for (const h of s.heroes) if (h.team === k) Object.assign(h, { alive: false, out: true, hp: 0 });
  s.structs = s.structs.filter((st) => st.team !== k);
  s.sv++;
  addFx(s, 'fall', T.ember.x, T.ember.y, 240, k);
}

function shoot(s, x, y, angle, speed, range, dmg, team, owner) {
  s.shots.push({ id: s.nextId++, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, ttl: range / speed, dmg, team, owner });
}

// ---------------------------------------------------------------- heroes

/** Heroes walk through their own team's structures; a rival's blocking structure stops them. */
export function moveHero(s, h, dx, dy) {
  // shortcut: collides on the hero's centre point, so a body can overlap a wall edge by its radius
  const c = cache(s), here = cellOf(h.y) * COLS + cellOf(h.x);
  const open = (x, y) => {
    const i = cellOf(y) * COLS + cellOf(x);
    return i === here || !c.wall[i] || c.cells.get(i).team === h.team;
  };
  const nx = clamp(h.x + dx, HERO_R, WORLD.w - HERO_R);
  if (open(nx, h.y)) h.x = nx;
  const ny = clamp(h.y + dy, HERO_R, WORLD.h - HERO_R);
  if (open(h.x, ny)) h.y = ny;
  keepIn(h, HERO_R);
}

export function buildCost(kind, type) {
  return Math.round(STRUCTS[type].cost * (kind === 'cog' ? 0.75 : 1));
}

const nearLivingEmber = (s, x, y, r, skipTeam) =>
  s.teams.some((T, k) => T.alive && k !== skipTeam && dist2(x, y, T.ember.x, T.ember.y) < r * r);

const hostileInCell = (s, team, cx, cy) =>
  s.enemies.some((e) => !e.dead && cellOf(e.x) === cx && cellOf(e.y) === cy) ||
  s.heroes.some((h) => h.alive && h.team !== team && cellOf(h.x) === cx && cellOf(h.y) === cy);

/** Why hero i may not build this here, or null if they may. */
export function canBuild(s, i, type, cx, cy) {
  const h = s.heroes[i];
  if (!h || !h.alive) return 'down';
  if (!Object.hasOwn(STRUCTS, type)) return 'type';
  if (!Number.isInteger(cx) || !Number.isInteger(cy) || !onLand(cx, cy)) return 'bounds';
  const x = cx * CELL + CELL / 2, y = cy * CELL + CELL / 2;
  if (dist2(h.x, h.y, x, y) > BUILD_RANGE * BUILD_RANGE) return 'range';
  if (structAt(s, cx, cy)) return 'occupied';
  if (nearLivingEmber(s, x, y, 60, -1)) return 'ember';
  if (nearLivingEmber(s, x, y, NO_BUILD_NEAR_RIVAL, h.team)) return 'rival';
  if (STRUCTS[type].blocks && hostileInCell(s, h.team, cx, cy)) return 'unit';
  if (s.teams[h.team].scrap < buildCost(h.kind, type)) return 'scrap';
  return null;
}

function tryBuild(s, h, b) {
  if (canBuild(s, h.i, b.type, b.cx, b.cy) !== null) return;
  s.teams[h.team].scrap -= buildCost(h.kind, b.type);
  addStruct(s, b.type, h.team, b.cx, b.cy);
}

function tryRemove(s, h, r) {
  const st = structAt(s, r.cx, r.cy);
  if (!st || st.team !== h.team || st.ttl > 0 || dist2(h.x, h.y, st.x, st.y) > BUILD_RANGE * BUILD_RANGE) return;
  s.teams[h.team].scrap += Math.floor((STRUCTS[st.type].cost / 2) * (st.hp / st.max));
  removeStruct(s, st);
}

/** Dart's Dash: a blink the way it is moving (the way it aims, if standing still). The client runs this too, to predict its own. */
export function dash(s, h, mx, my) {
  let ux = mx, uy = my;
  if (!ux && !uy) {
    ux = Math.cos(h.aim);
    uy = Math.sin(h.aim);
  }
  const len = Math.hypot(ux, uy), hop = HEROES.dart.q.dist / 10;
  for (let k = 0; k < 10; k++) moveHero(s, h, (ux / len) * hop, (uy / len) * hop); // small hops so a rival Wall stops it
}

// The client reads the next three too, to predict its own hero by the same rules.
/** How many times its gun's usual rate a hero fires at. */
export const heroFireMult = (h) => (h.overdrive > 0 ? HEROES.dart.r.mult : 1);
/** World units a second. */
export const heroSpeed = (h) => HEROES[h.kind].speed * (h.rush > 0 ? POWERUPS.rush.speed : 1);

/**
 * May this hero use its Q or R (key 'q' or 'r') now? Forge's Reforge needs something of its team's in reach to mend.
 * Cog's Sentry can still find no room once this says yes: ability() has the last word on that.
 */
export function canCast(s, h, key) {
  if (!h.alive || h.stun > 0) return false;
  if (key === 'r') return h.ult >= 100;
  const q = HEROES[h.kind].q;
  return h.qCd <= 0 && (h.kind !== 'forge' || s.structs.some((st) => st.team === h.team && st.type !== 'spikes' && st.hp < st.max && dist2(h.x, h.y, st.x, st.y) <= q.r * q.r));
}

/** Q, once canCast allows it. Returns false if nothing happened, so the cooldown is not spent. */
function ability(s, h, mx, my) {
  const q = HEROES[h.kind].q;
  if (h.kind === 'anvil') {
    const blast = (o) => {
      o.stun = o.i === undefined ? q.stun : q.stun / 2;
      nudge(s, o, ...push(h, o, q.push));
    };
    for (const e of s.enemies) {
      if (e.dead || dist2(h.x, h.y, e.x, e.y) > q.r * q.r) continue;
      hurtEnemy(s, e, q.dmg, h.team, h.i);
      blast(e);
    }
    for (const o of s.heroes) {
      if (!o.alive || o.team === h.team || dist2(h.x, h.y, o.x, o.y) > q.r * q.r) continue;
      hurtHero(s, o, q.dmg, h.team, h.i);
      if (o.alive) blast(o);
    }
    addFx(s, 'ring', h.x, h.y, q.r, h.team, h.i);
  } else if (h.kind === 'dart') {
    addFx(s, 'dash', h.x, h.y, 22, h.team, h.i);
    dash(s, h, mx, my);
  } else if (h.kind === 'patch') {
    for (const o of s.heroes) if (o.alive && o.team === h.team && dist2(h.x, h.y, o.x, o.y) <= q.r * q.r) heal(h, o, q.heal, true);
    addFx(s, 'heal', h.x, h.y, q.r, h.team, h.i);
  } else if (h.kind === 'forge') {
    let fixed = 0;
    for (const st of s.structs) {
      if (st.team !== h.team || st.type === 'spikes' || dist2(h.x, h.y, st.x, st.y) > q.r * q.r) continue;
      const a = Math.min(q.repair, st.max - st.hp);
      st.hp += a;
      fixed += a;
    }
    h.ult = Math.min(100, h.ult + fixed * ULT_PER_HEAL);
    h.stats.heal += fixed; // repairs count beside healing on the scoreboard
    addFx(s, 'fix', h.x, h.y, q.r, h.team, h.i);
  } else {
    const cx = cellOf(h.x), cy = cellOf(h.y);
    const spot = [[0, 0], ...DIRS].find(([dx, dy]) => {
      const x = (cx + dx) * CELL + CELL / 2, y = (cy + dy) * CELL + CELL / 2;
      return onLand(cx + dx, cy + dy) && !structAt(s, cx + dx, cy + dy) && !nearLivingEmber(s, x, y, 60, -1) && !hostileInCell(s, h.team, cx + dx, cy + dy);
    });
    if (!spot) return false;
    const st = addStruct(s, 'turret', h.team, cx + spot[0], cy + spot[1], q.ttl);
    st.hp = st.max = q.hp;
  }
  return true;
}

const push = (from, o, d) => {
  const a = Math.atan2(o.y - from.y, o.x - from.x);
  return [Math.cos(a) * d, Math.sin(a) * d];
};

/** R. */
function ultimate(s, h) {
  const r = HEROES[h.kind].r;
  h.ult = 0;
  addFx(s, 'ult', h.x, h.y, 70, h.team, h.i);
  if (h.kind === 'anvil') h.fortify = r.time;
  else if (h.kind === 'dart') h.overdrive = r.time;
  else if (h.kind === 'patch') {
    for (const o of s.heroes) {
      if (o.team !== h.team || o.out) continue;
      if (!o.alive) revive(o, false);
      heal(h, o, o.max, false); // no charge from its own healing, or it would refill itself
    }
  } else if (h.kind === 'forge') s.teams[h.team].aegis = r.time;
  else {
    for (const st of s.structs) if (st.team === h.team && st.type !== 'spikes') st.hp = st.max;
    s.teams[h.team].overclock = r.time;
  }
}

function updateHero(s, h, raw, dt) {
  if (h.out) return;
  if (!h.alive) {
    h.respawn -= dt;
    if (h.respawn <= 0) revive(h, true);
    return;
  }
  const inp = raw && typeof raw === 'object' ? raw : IDLE;
  const def = HEROES[h.kind];
  h.fireCd = Math.max(-dt, h.fireCd - dt); // may sit one tick below zero so the average fire rate is exact
  h.qCd = Math.max(0, h.qCd - dt);
  h.fortify = Math.max(0, h.fortify - dt);
  h.overdrive = Math.max(0, h.overdrive - dt);
  h.rush = Math.max(0, h.rush - dt);
  h.fury = Math.max(0, h.fury - dt);
  h.shieldCd = Math.max(0, h.shieldCd - dt);
  h.shieldMax = (def.shield?.max ?? 0) + (shielded(s, h) ? STRUCTS.shield.absorb : 0); // the barrier is lost on leaving the field
  h.shield = Math.min(h.shieldMax, h.shield + (h.shieldCd === 0 ? shieldOf(h).rate * dt : 0));
  if (h.stun > 0) {
    h.stun = Math.max(0, h.stun - dt);
    h.scav = 0;
    return;
  }

  if (Number.isFinite(inp.aim)) h.aim = inp.aim;
  let mx = num(inp.mx), my = num(inp.my);
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  const speed = heroSpeed(h);
  moveHero(s, h, mx * speed * dt, my * speed * dt);

  const under = structAt(s, cellOf(h.x), cellOf(h.y));
  if (under && under.type === 'spikes' && under.team !== h.team) {
    const d = Math.min(STRUCTS.spikes.dps * dt, under.hp);
    hurtHero(s, h, d, under.team, -1);
    hurtStruct(s, under, d, -1);
    if (!h.alive) return;
  }

  if (inp.fire && h.fireCd <= 0) {
    const g = def.gun;
    h.fireCd += 1 / (g.rate * heroFireMult(h));
    for (let p = 0; p < g.pellets; p++) shoot(s, h.x, h.y, h.aim + (rand(s) - 0.5) * g.spread, g.speed, g.range, g.dmg * (h.fury > 0 ? POWERUPS.fury.mult : 1), h.team, h.i);
  }
  if (inp.q && canCast(s, h, 'q') && ability(s, h, mx, my)) h.qCd = def.q.cd;
  if (inp.r && canCast(s, h, 'r')) ultimate(s, h);

  const wreck = inp.use ? nearest(s.wrecks, h.x, h.y, SCAV_RANGE, (w) => !w.dead) : null;
  if (!wreck) h.scav = h.scavId = 0;
  else {
    if (h.scavId !== wreck.id) h.scav = 0;
    h.scavId = wreck.id;
    h.scav += dt * (h.kind === 'dart' ? 2 : 1);
    if (h.scav >= SCAV_TIME) {
      wreck.dead = true;
      s.teams[h.team].scrap += wreck.scrap;
      h.stats.scrap += wreck.scrap;
      h.scav = h.scavId = 0;
      addFx(s, 'scrap', wreck.x, wreck.y, 30, h.team);
    }
  }

  if (inp.build && typeof inp.build === 'object') tryBuild(s, h, inp.build);
  if (inp.remove && typeof inp.remove === 'object') tryRemove(s, h, inp.remove);
}

// ---------------------------------------------------------------- structures

function updateStructs(s, dt) {
  for (const T of s.teams) {
    T.overclock = Math.max(0, T.overclock - dt);
    T.aegis = Math.max(0, T.aegis - dt);
  }
  for (const st of [...s.structs]) {
    if (st.dead) continue;
    if (st.ttl > 0 && (st.ttl -= dt) <= 0) {
      removeStruct(s, st);
      continue;
    }
    if (st.wait > 0) st.wait = Math.max(0, st.wait - dt); // still being built: does nothing yet
    if (st.type !== 'turret' || st.wait > 0) continue;
    const def = STRUCTS.turret;
    st.cd -= dt * (s.teams[st.team].overclock > 0 ? HEROES.cog.r.mult : 1);
    if (st.cd > 0) continue;
    const target = nearestHostile(s, st.team, st.x, st.y, def.range);
    if (!target) {
      st.cd = 0.1; // look again shortly rather than every tick
      continue;
    }
    st.aim = Math.atan2(target.y - st.y, target.x - st.x);
    st.cd = 1 / def.rate;
    shoot(s, st.x, st.y, st.aim, 700, def.range + 40, def.dmg, st.team, -1);
  }
}

// ---------------------------------------------------------------- AI enemies

/** How hard tonight is: the night's number, or in endless mode ENDLESS_PACE of the way from night to night, so it climbs slowly. */
const level = (s) => (s.endless ? 1 + (s.wave - 1) * ENDLESS_PACE : s.wave);

/** What one hit from an AI enemy of this type does tonight: a tenth more each level after the first. */
export const enemyDmg = (s, type) => ENEMIES[type].dmg * (1 + 0.1 * Math.max(0, level(s) - 1));

export function spawnEnemy(s, type, team, x, y) {
  const def = ENEMIES[type], hp = def.hp * (1 + 0.25 * Math.max(0, level(s) - 1));
  const e = { id: s.nextId++, type, team, x, y, hp, max: hp, cd: 0, stun: 0 };
  keepIn(e, ENEMIES[type].r + 4); // a spawn point out over the water comes ashore at the edge
  if (def.slam) e.slam = def.slam.every;
  s.enemies.push(e);
  return e;
}

/** The hero an AI enemy chases: the nearest in aggro range, with a Fortified Anvil seeming closer. */
function pickPrey(s, e) {
  const taunt = (AGGRO / HEROES.anvil.r.taunt) ** 2;
  let prey = null, best = AGGRO * AGGRO;
  for (const h of s.heroes) {
    if (!h.alive) continue;
    const d = dist2(e.x, e.y, h.x, h.y) * (h.fortify > 0 ? taunt : 1);
    if (d < best) {
      best = d;
      prey = h;
    }
  }
  return prey;
}

function updateEnemy(s, e, dt) {
  const def = ENEMIES[e.type];
  const under = structAt(s, cellOf(e.x), cellOf(e.y));
  if (under && under.type === 'spikes') {
    const d = Math.min(STRUCTS.spikes.dps * dt, under.hp);
    hurtEnemy(s, e, d, under.team, -1);
    hurtStruct(s, under, d, -1);
    if (e.dead) return;
  }
  if (e.stun > 0) {
    e.stun -= dt;
    return;
  }
  e.cd = Math.max(0, e.cd - dt);
  if (!s.teams[e.team].alive) {
    const k = nearestEmber(s, e.x, e.y);
    if (k < 0) return;
    e.team = k;
  }
  const em = s.teams[e.team].ember;
  const dmg = enemyDmg(s, e.type);
  const emberD = Math.hypot(em.x - e.x, em.y - e.y);
  const strike = (hit) => {
    if (e.cd > 0) return;
    e.cd = 1 / def.rate;
    hit();
  };

  if (def.slam && (e.slam -= dt) <= 0) {
    e.slam = def.slam.every;
    const r2 = def.slam.r * def.slam.r;
    for (const h of s.heroes) if (dist2(e.x, e.y, h.x, h.y) < r2) hurtHero(s, h, dmg, -1, -1);
    for (const st of [...s.structs]) if (dist2(e.x, e.y, st.x, st.y) < r2) hurtStruct(s, st, dmg * def.structMult, -1);
    addFx(s, 'ring', e.x, e.y, def.slam.r, -1);
  }

  const prey = pickPrey(s, e);
  if (def.range) {
    const target =
      nearest(s.heroes, e.x, e.y, def.range, (h) => h.alive) ||
      nearest(s.structs, e.x, e.y, def.range, (st) => st.type === 'turret') ||
      (emberD < def.range + EMBER_R ? em : null);
    if (target) {
      strike(() => shoot(s, e.x, e.y, Math.atan2(target.y - e.y, target.x - e.x), 420, def.range + 80, dmg, -1, -1));
      return;
    }
  } else if (prey && dist2(e.x, e.y, prey.x, prey.y) < (def.r + HERO_R + 8) ** 2) {
    strike(() => hurtHero(s, prey, dmg, -1, -1));
    return;
  } else if (emberD < def.r + EMBER_R + 8) {
    strike(() => hurtEmber(s, e.team, dmg, -1, -1));
    return;
  }

  const goal = prey || flowTarget(s, e.team, e.x, e.y);
  const gx = goal.x - e.x, gy = goal.y - e.y, gl = Math.hypot(gx, gy) || 1;
  const ux = gx / gl, uy = gy / gl;
  const ahead = structAt(s, cellOf(e.x + ux * (def.r + 4)), cellOf(e.y + uy * (def.r + 4)));
  if (blocks(ahead)) {
    strike(() => hurtStruct(s, ahead, dmg * (def.structMult || 1), -1));
    return;
  }
  e.x += ux * def.speed * dt;
  e.y += uy * def.speed * dt;
  keepIn(e, def.r);
}

/** Keep AI enemies from stacking on one spot. */
function separate(s) {
  const E = s.enemies;
  for (let a = 0; a < E.length; a++) {
    const p = E[a];
    if (p.dead) continue;
    const pr = ENEMIES[p.type].r;
    for (let b = a + 1; b < E.length; b++) {
      const q = E[b];
      const dx = q.x - p.x, dy = q.y - p.y, rr = pr + ENEMIES[q.type].r;
      if (q.dead || Math.abs(dx) >= rr || Math.abs(dy) >= rr) continue;
      const d = Math.hypot(dx, dy);
      if (d >= rr || d < 0.01) continue;
      const k = ((rr - d) / d) * 0.25;
      nudge(s, p, -dx * k, -dy * k);
      nudge(s, q, dx * k, dy * k);
    }
  }
}

// ---------------------------------------------------------------- shots

/**
 * What a shot has run into where it now is, or null: a rival's blocking structure (st), a rival
 * Ember (ember: its team), an AI enemy (e) or a rival hero (h), tried in that order. A shot is
 * hostile to everything not on its own team; AI shots (team -1) are hostile to all. The client
 * asks the same of the shots it predicts, so they stop where the server's will.
 */
export function shotHit(s, sh) {
  const st = structAt(s, cellOf(sh.x), cellOf(sh.y));
  if (blocks(st) && st.team !== sh.team) return { st };
  const ember = s.teams.findIndex((T, i) => T.alive && i !== sh.team && dist2(sh.x, sh.y, T.ember.x, T.ember.y) < EMBER_R * EMBER_R);
  if (ember >= 0) return { ember };
  const e = sh.team >= 0 && s.enemies.find((o) => !o.dead && dist2(sh.x, sh.y, o.x, o.y) < (ENEMIES[o.type].r + 3) ** 2);
  if (e) return { e };
  const h = s.heroes.find((o) => o.alive && o.team !== sh.team && dist2(sh.x, sh.y, o.x, o.y) < (HERO_R + 3) ** 2);
  return h ? { h } : null;
}

function updateShots(s, dt) {
  for (const sh of s.shots) {
    sh.x += sh.vx * dt;
    sh.y += sh.vy * dt;
    sh.ttl -= dt;
    if (sh.ttl <= 0 || !inArena(sh.x, sh.y)) {
      sh.dead = true;
      continue;
    }
    const hit = shotHit(s, sh);
    if (!hit) continue;
    if (hit.st) hurtStruct(s, hit.st, sh.dmg, sh.owner);
    else if (hit.e) hurtEnemy(s, hit.e, sh.dmg, sh.team, sh.owner);
    else if (hit.h) hurtHero(s, hit.h, sh.dmg, sh.team, sh.owner);
    else hurtEmber(s, hit.ember, sh.dmg * (sh.team >= 0 ? EMBER_ARMOR : 1), sh.team, sh.owner);
    sh.dead = true;
  }
}

// ---------------------------------------------------------------- day, night, outcome

const CENTRE = { x: (TEAMS[0].x + TEAMS[1].x + TEAMS[2].x) / 3, y: (TEAMS[0].y + TEAMS[1].y + TEAMS[2].y) / 3 };
const FACING = TEAMS.map((T) => Math.atan2(CENTRE.y - T.y, CENTRE.x - T.x)); // each Ember's bearing to mid-map

/**
 * Fair pickings: every wreck is laid out three times, once per Ember, at the same distance
 * and the same bearing relative to mid-map. The further out, the richer; three rich
 * wrecks sit in the contested middle.
 */
function spawnWrecks(s) {
  s.wrecks = [];
  const inWorld = (p) => inArena(p.x, p.y, 100);
  for (let tries = 0; s.wrecks.length < WRECKS_PER_TEAM * 3 && tries < 500; tries++) {
    const r = Math.sqrt(220 ** 2 + rand(s) * (900 ** 2 - 220 ** 2)), a = rand(s) * Math.PI * 2;
    const trio = TEAMS.map((T, k) => ({ x: T.x + Math.cos(FACING[k] + a) * r, y: T.y + Math.sin(FACING[k] + a) * r }));
    if (!trio.every(inWorld)) continue;
    for (const p of trio) s.wrecks.push({ id: s.nextId++, ...p, scrap: Math.round(8 + r / 60) });
  }
  FACING.forEach((f) => s.wrecks.push({ id: s.nextId++, x: CENTRE.x - Math.cos(f) * 120, y: CENTRE.y - Math.sin(f) * 120, scrap: 40 }));
}

function pack(wave, boss) {
  const list = [];
  const add = (type, n) => {
    for (let k = 0; k < n; k++) list.push(type);
  };
  add('skitter', Math.round(6 + 4 * wave)); // wave may be a fraction in endless mode
  add('spitter', Math.round(Math.max(0, 3 * (wave - 1))));
  add('breaker', Math.round(Math.max(0, 2 * (wave - 2))));
  add('colossus', boss ? 1 : 0);
  return list;
}

export function startNight(s) {
  s.phase = 'night';
  s.wave++;
  s.timer = 0;
  const list = pack(level(s), s.wave % 5 === 0), gap = Math.min(0.45, 16 / list.length);
  list.forEach((type, k) => {
    s.teams.forEach((T, team) => T.alive && s.spawn.push({ type, team, at: s.t + 1 + k * gap }));
  });
}

export function startDay(s) {
  s.phase = 'day';
  s.timer = DAY_LENGTH;
  for (const st of s.structs) if (st.type !== 'spikes') st.hp = st.max;
  spawnWrecks(s);
}

const alive = (o) => !o.dead;

/** Advance the match by dt seconds. inputs[i] is hero i's input (see README); missing means idle. */
export function step(s, inputs, dt = 1 / 60) {
  if (s.phase === 'over') return s;
  inputs ||= IDLE;
  s.t += dt;
  if (s.phase === 'day') {
    s.timer -= dt;
    if (s.timer <= 0) startNight(s);
  } else {
    while (s.spawn.length && s.spawn[0].at <= s.t) {
      const sp = s.spawn.shift(), a = rand(s) * Math.PI * 2;
      spawnEnemy(s, sp.type, sp.team, TEAMS[sp.team].x + Math.cos(a) * SPAWN_RING, TEAMS[sp.team].y + Math.sin(a) * SPAWN_RING);
    }
  }

  for (const h of s.heroes) updateHero(s, h, inputs[h.i], dt);
  updateStructs(s, dt);
  for (const e of s.enemies) if (!e.dead) updateEnemy(s, e, dt);
  separate(s);
  updateShots(s, dt);

  s.enemies = s.enemies.filter(alive);
  s.shots = s.shots.filter(alive);
  s.wrecks = s.wrecks.filter(alive);
  for (const p of s.pickups) {
    p.ttl -= dt;
    const h = s.heroes.find((o) => o.alive && dist2(o.x, o.y, p.x, p.y) < PICKUP_R * PICKUP_R);
    if (p.ttl <= 0 || !h) continue;
    p.ttl = 0;
    if (p.kind === 'mend') h.hp = Math.min(h.max, h.hp + h.max * POWERUPS.mend.heal);
    else h[p.kind] = POWERUPS[p.kind].time;
    addFx(s, 'power', p.x, p.y, 34, h.team);
  }
  s.pickups = s.pickups.filter((p) => p.ttl > 0);
  for (const f of s.fx) f.ttl -= dt;
  s.fx = s.fx.filter((f) => f.ttl > 0);

  if (s.phase === 'night' && !s.spawn.length && !s.enemies.length) startDay(s);

  // Decided once per step, so two Embers falling in the same step is a draw, not a win.
  const standing = () => s.teams.flatMap((T, k) => (T.alive ? [k] : []));
  const before = standing();
  s.teams.forEach((T, k) => T.alive && T.ember.hp <= 0 && eliminate(s, k));
  const living = standing();
  if (living.length <= (s.endless ? 0 : 1)) {
    s.phase = 'over';
    s.winner = living.length ? living[0] : s.endless && before.length === 1 ? before[0] : -1; // endless: the last to fall
  }
  return s;
}
