// Bot heroes. botInput() looks at the match and returns the same input object a human
// client sends, so bots play by exactly the rules players do. It keeps no memory.
import { HEROES, HERO_IDS, STRUCTS, ENEMIES, TEAMS, CELL, EMBER_R, SCAV_RANGE, SCAV_TIME, canBuild, buildCost, post, structAt, nearestHostile, enemyDmg } from './sim.js';

const SIGHT = 520;
const LEASH = 280; // how far from their Ember bots will chase at night
const AEGIS_WORTH = 0.35; // a Forge spends Aegis when the wave that is landing would cost the squad this share of its health while it lasts
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const MID = { x: (TEAMS[0].x + TEAMS[1].x + TEAMS[2].x) / 3, y: (TEAMS[0].y + TEAMS[1].y + TEAMS[2].y) / 3 };

/**
 * The base a bot Cog builds, in order: Turrets, two Shield Generators, a Wall ring (the side
 * facing mid-map first), Spikes in its four corner gates, more Turrets, two more Shield
 * Generators. The gates are at the corners, each with a Turret behind it, so no rival base
 * has a straight shot through one. The four generators' fields cover every guard post.
 */
const BLUEPRINTS = TEAMS.map((T) => {
  const ex = T.x / CELL, ey = T.y / CELL;
  const at = (type) => ([dx, dy]) => ({ type, cx: ex + dx, cy: ey + dy });
  const fromMid = ([dx, dy]) => Math.hypot(T.x + (dx + 0.5) * CELL - MID.x, T.y + (dy + 0.5) * CELL - MID.y);
  const walls = [], gates = [];
  for (let dx = -5; dx <= 4; dx++) for (let dy = -5; dy <= 4; dy++) {
    if (dx !== -5 && dx !== 4 && dy !== -5 && dy !== 4) continue;
    const corner = (dx <= -4 || dx >= 3) && (dy <= -4 || dy >= 3);
    (corner ? gates : walls).push([dx, dy]);
  }
  walls.sort((a, b) => fromMid(a) - fromMid(b));
  return [
    ...[[2, 2], [-3, -3], [-3, 2], [2, -3]].map(at('turret')),
    ...[[1, 1], [-2, -2]].map(at('shield')),
    ...walls.map(at('wall')),
    ...gates.map(at('spikes')),
    ...[[3, -1], [-4, 0], [0, 3], [-1, -4]].map(at('turret')),
    ...[[-2, 1], [1, -2]].map(at('shield')),
  ];
});

/** The next missing blueprint piece the team can afford, or null (save up, or nothing left). */
export function nextPiece(s, h) {
  for (const p of BLUEPRINTS[h.team]) {
    if (structAt(s, p.cx, p.cy)) continue;
    if (s.teams[h.team].scrap < buildCost(h.kind, p.type)) return null;
    const why = canBuild(s, h.i, p.type, p.cx, p.cy);
    if (why === null || why === 'range') return { ...p, ready: why === null };
  }
  return null;
}

/** The rival Ember to raid: the next team round, unless the other rival's Ember is clearly (20%) weaker. */
function raidTarget(s, h) {
  let best = null, score = Infinity;
  for (const step of [1, 2]) {
    const T = s.teams[(h.team + step) % 3];
    const v = T.ember.hp / T.ember.max + (step - 1) * 0.2;
    if (T.alive && v < score) {
      score = v;
      best = T.ember;
    }
  }
  return best;
}

/** The nearest wreck this bot can reach, strip and carry home before dark, skipping ones a teammate is closer to. */
function pickWreck(s, h, em, maxFromHome) {
  const speed = HEROES[h.kind].speed;
  let best = null, score = Infinity;
  for (const w of s.wrecks) {
    const d = gap(h, w), back = gap(w, em);
    if (back > maxFromHome || s.timer < (d + back) / speed + SCAV_TIME + 4) continue;
    let v = d;
    for (const o of s.heroes) if (o !== h && o.alive && o.team === h.team && gap(o, w) < d) v += 250;
    if (v < score) {
      score = v;
      best = w;
    }
  }
  return best;
}

/**
 * What to shoot when no unit is in reach: a rival Ember in range (anything standing in the
 * line of fire takes the hits first, which is how a breach gets made), else the nearest
 * rival Wall or Turret.
 */
function rivalThing(s, h, range) {
  const ember = s.teams.find((T, k) => k !== h.team && T.alive && gap(h, T.ember) - EMBER_R < range)?.ember;
  if (ember) return ember;
  let best = null, bd = range;
  for (const st of s.structs) {
    const d = gap(h, st);
    if (st.team !== h.team && st.type !== 'spikes' && d < bd) {
      bd = d;
      best = st;
    }
  }
  return best;
}

/** The hostile unit in range with the least health left: bots finish what they start. */
function weakestHostile(s, h, range) {
  let best = null;
  for (const o of [...s.enemies, ...s.heroes]) {
    if (o.i !== undefined && (!o.alive || o.team === h.team)) continue;
    if (gap(h, o) <= range && (!best || o.hp < best.hp)) best = o;
  }
  return best;
}

function nearestRivalTurret(s, h, range) {
  let best = null, bd = range;
  for (const st of s.structs) {
    const d = gap(h, st);
    if (st.team !== h.team && st.type === 'turret' && d < bd) {
      bd = d;
      best = st;
    }
  }
  return best;
}

const crowd = (s, h, r) =>
  s.enemies.filter((e) => gap(h, e) < r).length + s.heroes.filter((o) => o.alive && o.team !== h.team && gap(h, o) < r).length;

/** Damage a second that the AI enemies now in reach of this team's living heroes can deal them: the size of the wave that is landing at this moment. */
function incoming(s, team) {
  const mates = s.heroes.filter((o) => o.team === team && o.alive);
  const reach = (e, r) => mates.some((m) => gap(m, e) < r);
  let dps = 0;
  for (const e of s.enemies) {
    const d = ENEMIES[e.type];
    if (reach(e, d.range ?? d.r + 60)) dps += enemyDmg(s, e.type) * d.rate; // a melee enemy this close lands its first hit within half a second
    if (d.slam && reach(e, d.slam.r)) dps += enemyDmg(s, e.type) / d.slam.every;
  }
  return dps;
}

/** spend: whether this bot may use its team's Scrap (false when a human is on the team). */
export function botInput(s, i, spend = true) {
  const h = s.heroes[i];
  const out = { mx: 0, my: 0, aim: h.aim, fire: false, use: false, q: false, r: false, build: null, remove: null };
  if (!h.alive) return out;
  const def = HEROES[h.kind], gun = def.gun, em = s.teams[h.team].ember;
  const night = s.phase === 'night';
  const foe = nearestHostile(s, h.team, h.x, h.y, SIGHT);
  const foeD = foe ? gap(h, foe) : Infinity;
  const hurt = h.hp < h.max * 0.35;
  // By day, anyone close enough to help comes home when something hostile reaches the Ember.
  const defend = night || (gap(h, em) < 1200 && nearestHostile(s, h.team, em.x, em.y, 450) !== null);

  // Where to be. A healthy bot with nothing to defend and time to get home roams: builds, raids or scavenges.
  let goal = post(h.team, HERO_IDS.indexOf(h.kind)), stopAt = 12, wreck = null, fixed = hurt;
  const raider = (h.kind === 'anvil' || h.kind === 'dart') && s.wave >= 1;
  // Raiders are far from help, so they turn for home at half health rather than a third.
  const exposed = h.shieldMax > 0 && h.shield === 0 && h.hp < h.max * 0.75; // shield broken: step out and let it refill
  const roam = !defend && !exposed && h.hp >= h.max * (raider ? 0.5 : 0.35) && s.timer > gap(h, em) / def.speed + 3;
  const mates = s.heroes.filter((o) => o.team === h.team && o.alive && o !== h);
  const medic = mates.find((o) => o.kind === 'patch');
  const patient = h.kind === 'patch' && !hurt ? mates.filter((o) => o.hp < o.max * 0.6 && gap(h, o) < 500).sort((a, c) => a.hp / a.max - c.hp / c.max)[0] : null;
  // A Forge defending home goes to the most broken Wall, Turret or Shield Generator near its Ember, to Reforge it.
  const broken = h.kind === 'forge' && !hurt && defend
    ? s.structs.filter((st) => st.team === h.team && st.type !== 'spikes' && st.hp < st.max * 0.7 && gap(st, em) < LEASH).sort((a, c) => a.hp / a.max - c.hp / c.max)[0] : null;
  // A Forge out on its own is slow and no match for raiders: with a rival hero in sight and no teammate beside it, it goes home.
  const outmatched = h.kind === 'forge' && !defend && !mates.some((o) => gap(h, o) < 300) && s.heroes.some((o) => o.alive && o.team !== h.team && gap(h, o) < SIGHT);
  if (patient || broken) {
    goal = patient || broken; // a medic's first job is to get Mend in reach of whoever needs it most; a Forge's, Reforge
    stopAt = def.q.r * 0.6;
    fixed = true;
  } else if (hurt && defend && medic) {
    goal = medic; // badly hurt in a fight: fall back to the medic rather than trade shots
    stopAt = HEROES.patch.q.r * 0.6;
  } else if (outmatched) {
    fixed = true; // straight home to its post, shooting back but not stopping to duel
  } else if (roam) {
    const piece = spend && h.kind === 'cog' ? nextPiece(s, h) : null;
    // The Dart leads the raid. An Anvil goes only as its bodyguard: alone it is too slow to get back out.
    const lead = h.kind === 'anvil' ? mates.find((o) => o.kind === 'dart') : null;
    const rival = raider && (lead || h.kind === 'dart') ? raidTarget(s, h) : null;
    if (piece) {
      goal = em; // every blueprint cell is in build range from the Ember itself
      if (piece.ready) out.build = { type: piece.type, cx: piece.cx, cy: piece.cy };
    } else if (rival) {
      goal = rival;
      stopAt = gun.range * 0.85;
      if (lead) { // a step ahead of the Dart, between it and what it is raiding
        const t = 50 / (gap(lead, rival) || 1);
        goal = { x: lead.x + (rival.x - lead.x) * t, y: lead.y + (rival.y - lead.y) * t };
        stopAt = 40;
      }
    } else if ((wreck = pickWreck(s, h, em, h.kind === 'dart' ? Infinity : 900))) {
      goal = wreck;
      stopAt = SCAV_RANGE - 15;
    }
  }

  // A power-up close by is worth a short detour, unless the bot is busy healing or hurt and heading for help.
  const pick = (s.pickups || []).filter((p) => gap(h, p) < 260 && (!night || gap(p, em) < LEASH + 100)).sort((a, c) => gap(h, a) - gap(h, c))[0];
  if (pick && !fixed) {
    goal = pick;
    stopAt = 0;
  }

  // What to shoot: the weakest hostile unit in range (finish kills), else a rival Turret, Ember or Wall in range.
  const turret = foeD <= gun.range ? null : nearestRivalTurret(s, h, gun.range);
  const target = weakestHostile(s, h, gun.range) || turret || rivalThing(s, h, gun.range);
  if (target) {
    out.aim = Math.atan2(target.y - h.y, target.x - h.x);
    out.fire = true;
  }

  // How to move: hold a firing band around a foe worth fighting, or around a Turret we outrange; otherwise head for the goal.
  let to = goal;
  if (fixed) to = goal;
  else if (foe && (defend || (roam && foeD < gun.range * 1.1))) {
    stopAt = 12;
    if (foeD > gun.range * 0.8) to = foe;
    else if (foeD < gun.range * 0.45) to = { x: 2 * h.x - foe.x, y: 2 * h.y - foe.y };
    else to = h;
    if (night && gap(h, em) > LEASH) to = goal;
  } else if (turret && roam && gun.range > STRUCTS.turret.range + 20) {
    const d = gap(h, turret);
    stopAt = 0;
    to = d < STRUCTS.turret.range + 10 ? { x: 2 * h.x - turret.x, y: 2 * h.y - turret.y } : d > gun.range - 10 ? turret : h;
  }
  const dx = to.x - h.x, dy = to.y - h.y, d = Math.hypot(dx, dy);
  if (d > stopAt && d > 0) {
    out.mx = dx / d;
    out.my = dy / d;
  } else if (wreck && to === wreck) out.use = true;

  // Abilities. The sim ignores q on cooldown and r without a full charge.
  if (h.kind === 'anvil') {
    const close = foeD < def.q.r * 0.8 ? crowd(s, h, def.q.r) : 0;
    out.q = close >= 2 || (close === 1 && foe.i !== undefined);
    // Fortify answers being hurt by anything that can reach it, guns at range included, not only a crowd at arm's length.
    out.r = (h.hp < h.max * 0.6 && foeD < SIGHT) || (foeD < 250 && crowd(s, h, 250) >= 4);
  } else if (h.kind === 'dart') {
    out.q = foeD < 90;
    out.r = foeD < gun.range;
  } else if (h.kind === 'patch') {
    const squad = s.heroes.filter((o) => o.team === h.team && !o.out);
    out.q = squad.some((o) => o.alive && o.hp < o.max * 0.65 && gap(h, o) <= def.q.r);
    out.r = squad.some((o) => !o.alive) || squad.filter((o) => o.hp < o.max * 0.4).length >= 2;
  } else if (h.kind === 'forge') {
    out.q = s.structs.some((st) => st.team === h.team && st.type !== 'spikes' && st.hp < st.max * 0.7 && gap(h, st) <= def.q.r);
    // Aegis goes up as a wave lands, not after it has done its damage: when six seconds of the AI enemies in reach
    // would cost the squad AEGIS_WORTH of the health it has left. Against rival heroes it still waits for two teammates to be badly hurt.
    const squad = s.heroes.filter((o) => o.team === h.team && o.alive);
    const wave = incoming(s, h.team) * def.r.time >= AEGIS_WORTH * squad.reduce((t, o) => t + o.hp + o.shield, 0);
    out.r = h.ult >= 100 && (wave || squad.filter((o) => o.hp < o.max * 0.5).length >= 2);
  } else {
    out.q = foeD < 400;
    out.r = s.structs.some((st) => st.team === h.team && st.type !== 'spikes' && st.hp < st.max * 0.5);
  }
  return out;
}
