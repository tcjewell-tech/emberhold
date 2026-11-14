// Emberhold browser client: sends this player's input and draws the snapshots the server
// sends back. No rules live here; canBuild is imported only to colour the build ghost.
import { WORLD, CELL, TEAMS, HEROES, HERO_IDS, STRUCTS, ENEMIES, EMBER_R, HERO_R, BUILD_RANGE, SCAV_RANGE, SCAV_TIME, canBuild, buildCost, moveHero, ARENA, POWERUPS, TEAM_SIZE, teamOf } from './sim.js';
import { interpolate } from './interp.js';
import { createTimeline, createPredictor, createUnpacker } from './net.js';
import { PX, TILE, MOODS, ground, heroSprite, createArt } from './art.js';
import { createSound } from './sound.js';
import { createTouch } from './touch.js';
import { botInput, nextPiece } from './bots.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls = '', text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const canvas = $('game'), ctx = canvas.getContext('2d'), art = createArt(ctx), sound = createSound();
const shadeCanvas = document.createElement('canvas'), shade = shadeCanvas.getContext('2d');
const mini = $('minimap').getContext('2d');

const VIEW = { w: 704, h: 440 }; // the most art pixels any screen shows, so a big monitor is no advantage
const FX_SOUND = { ring: 'Shockwave', dash: 'Dash', heal: 'Mend', down: 'Hero down', scrap: 'Scavenge', ult: 'Ultimate', pop: 'Hit', power: 'Power-up', fix: 'Build' };
const WHY = {
  down: 'You are down', range: 'Too far away', occupied: 'Occupied', ember: 'Too close to an Ember',
  rival: 'Too close to a rival Ember', unit: 'Something is standing there', scrap: 'Not enough Scrap', bounds: 'Out over the water',
};

let ws, slot = -1, lobby = null, latest = null, humans = [], seq = 0, timeline = createTimeline();
const key = crypto.getRandomValues(new Uint32Array(4)).join('-'); // proves a reconnecting player is the one who held the seat
const snaps = []; // recent snapshots, each with the server time (ms) it shows
const cam = { x: WORLD.w / 2, y: WORLD.h / 2, scale: 1 };
const me = createPredictor(); // this player's hero, predicted locally
const keys = new Set();
const mouse = { x: innerWidth / 2, y: innerHeight / 2, wx: 0, wy: 0, left: false, right: false };
const seen = { phase: '', wave: -1, alive: [true, true, true] };
let buildType = null, ghostWhy = null, lastOrder = '', dark = 0, lastFrame = performance.now(), zoom = 2, mood = -1, bannerUntil = 0;
const heard = { id: 0, phase: '', hp: 0, built: 0, hitAt: 0 }, strides = new Map();

// ---------------------------------------------------------------- connection

const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  timeline = createTimeline(); // a new connection may be a new server, with its clock back at zero
  snaps.length = 0;
  let seated = false;
  ws.onclose = (ev) => {
    $('offline').textContent = ev.code === 1013 ? 'The server is full. Trying again…' : 'Connection lost. Reconnecting…';
    $('offline').hidden = false;
    setTimeout(connect, 1500);
  };
  ws.binaryType = 'arraybuffer';
  const feed = createUnpacker((m) => {
    if (m.t === 'state') {
      latest = m.s;
      humans = m.humans;
      const at = (m.n * 1000) / 60;
      timeline.arrive(at, performance.now());
      snaps.push({ at, s: m.s });
      if (snaps.length > 30) snaps.shift();
      if (slot >= 0 && m.s.heroes[slot].alive) me.heard(m.acks[slot], m.s.heroes[slot]);
      hear(m.s);
      onState(m.s);
    } else if (m.t === 'lobby') {
      $('offline').hidden = true;
      lobby = m;
      humans = m.humans;
      if (!m.running) {
        latest = null;
        snaps.length = 0;
      }
      if (slot >= 0 && !seated) {
        seated = true; // reconnected: ask for our hero back, once
        send({ t: 'join', slot, key });
      }
      renderSelect();
    } else if (m.t === 'joined') {
      seated = true;
      slot = m.slot;
      me.known = false;
      $('select').hidden = true;
      $('hud').hidden = false;
      setupHud();
    } else if (m.t === 'denied') {
      if (slot >= 0) { // our hero was not there to take back: choose again
        slot = -1;
        $('select').hidden = false;
        $('hud').hidden = true;
      }
      $('note').textContent =
        m.why === 'taken' ? 'Someone just took that hero. Pick another.' : m.why === 'out' ? 'That team has already fallen. Pick another.' : 'Could not join that slot.';
    }
  });
  ws.onmessage = (ev) => feed(ev.data);
}

const who = (i) => (i === slot ? 'You' : humans[i] ? 'Player' : 'Bot');

// ---------------------------------------------------------------- screens

function renderSelect() {
  $('teams').replaceChildren(
    ...TEAMS.map((T, team) => {
      const col = el('div', 'team');
      col.style.setProperty('--team', T.color);
      col.append(el('h3', '', `Team ${T.name}`));
      HERO_IDS.forEach((kind, k) => {
        const i = team * TEAM_SIZE + k, d = HEROES[kind], fallen = lobby.out[team];
        const card = el('button', 'card');
        card.disabled = fallen || lobby.humans[i];
        const head = el('header');
        head.append(el('b', '', d.name), el('em', '', fallen ? 'Fallen' : lobby.humans[i] ? 'Taken' : 'Bot'));
        const line = (label, text) => {
          const row = el('small');
          row.append(el('b', '', label), ` ${text}`);
          return row;
        };
        card.append(heroSprite(kind, team), head, el('small', '', `${d.role} · ${d.gun.name} · ${d.hp} health`), line(`Q ${d.q.name}:`, d.q.text), line(`R ${d.r.name}:`, d.r.text), line('Passive:', d.passive));
        card.onclick = () => send({ t: 'join', slot: i, key });
        col.append(card);
      });
      return col;
    }),
  );
}

function setupHud() {
  const team = teamOf(slot), d = HEROES[HERO_IDS[slot % TEAM_SIZE]];
  $('embers').replaceChildren(
    ...TEAMS.map((T, k) => {
      const box = el('div', 'ember'), top = el('span'), bar = el('div', 'bar');
      box.style.setProperty('--team', T.color);
      top.append(el('b', '', T.name + (k === team ? ' (you)' : '')), el('em', 'num'));
      bar.append(el('i'));
      box.append(top, bar);
      return box;
    }),
  );
  $('squad').style.setProperty('--team', TEAMS[team].color);
  $('squad').replaceChildren(
    ...HERO_IDS.map((kind) => {
      const row = el('div', 'mate'), name = el('span'), bar = el('div', 'bar');
      name.append(el('b', '', HEROES[kind].name), ' ', el('em'));
      bar.append(el('i'));
      row.append(name, el('em', 'num'), bar);
      return row;
    }),
  );
  $('me').style.setProperty('--team', TEAMS[team].color);
  $('meName').textContent = `${d.name} · ${d.role}`;
  $('q').children[1].textContent = d.q.name;
  $('r').children[1].textContent = d.r.name;
}

function scoreTable(s) {
  const table = el('table'), head = el('tr'), body = el('tbody');
  for (const t of ['Hero', 'Played by', 'Damage', 'Healing', 'Scrap found', 'AI kills', 'Hero kills', 'Deaths']) head.append(el('th', '', t));
  s.teams.forEach((T, k) => {
    const title = el('tr', 'teamrow'), cell = el('td', '', `Team ${TEAMS[k].name}${T.alive ? '' : ' (fallen)'}`);
    title.style.setProperty('--team', TEAMS[k].color);
    cell.colSpan = 8;
    title.append(cell);
    body.append(title);
    for (const h of s.heroes.filter((o) => o.team === k)) {
      const row = el('tr', h.i === slot ? 'you' : ''), st = h.stats;
      for (const v of [HEROES[h.kind].name, who(h.i), Math.round(st.dmg), Math.round(st.heal), st.scrap, st.kills, st.pvp, st.deaths]) row.append(el('td', 'num', String(v)));
      body.append(row);
    }
  });
  const thead = el('thead');
  thead.append(head);
  table.append(thead, body);
  return table;
}

/** Play what changed since the last snapshot: new shots and effects near the camera, the turn of day, our Ember being hit. */
function hear(s) {
  const near = (o) => clamp(1 - Math.hypot(o.x - cam.x, o.y - cam.y) / 900, 0, 1);
  const team = teamOf(slot), mine = slot >= 0 ? s.teams[team] : null;
  if (heard.id && mine) { // not on the first snapshot, when everything is new
    const guns = new Map();
    for (const sh of s.shots) {
      if (sh.id <= heard.id) continue;
      const name = sh.owner >= 0 ? HEROES[s.heroes[sh.owner].kind].gun.name : sh.team < 0 ? 'Spit' : 'Turret', k = name + sh.owner;
      guns.set(k, [name, Math.max(guns.get(k)?.[1] ?? 0, near(sh) * (sh.owner === slot ? 1 : 0.6))]); // one sound per shooter, not per pellet
    }
    [...guns.values()].sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([name, vol]) => sound.play(name, vol));
    let pops = 0;
    for (const f of s.fx) {
      if (f.id <= heard.id) continue;
      if (f.kind === 'fall') sound.play('Ember lost', 0.7);
      else if (FX_SOUND[f.kind] && (f.kind !== 'pop' || pops++ < 2)) sound.play(FX_SOUND[f.kind], near(f) * (f.kind === 'pop' ? 0.5 : 1));
    }
    if (s.phase !== heard.phase) {
      if (s.phase === 'night') sound.play('Night falls');
      else if (s.phase === 'day') sound.play('Dawn');
      else if (s.phase === 'over') sound.play(s.winner === team ? 'Victory' : 'Ember lost');
    }
    const now = performance.now(), built = s.structs.reduce((n, st) => n + (st.team === team && st.ttl === 0), 0);
    if (mine.ember.hp < heard.hp && now > heard.hitAt + 900) {
      heard.hitAt = now;
      sound.play('Ember hit', 0.8);
    }
    if (built > heard.built) sound.play('Build', 0.7);
    heard.built = built;
  }
  Object.assign(heard, { id: s.nextId - 1, phase: s.phase, hp: mine ? mine.ember.hp : 0 });
}

function say(text) {
  $('banner').textContent = text;
  $('banner').style.opacity = 1;
  bannerUntil = performance.now() + 3500;
}

/** React to changes between snapshots: phase banners, fallen teams, the end screen. */
function onState(s) {
  if (slot < 0) return;
  const team = teamOf(slot);
  if (s.phase !== seen.phase || s.wave !== seen.wave) {
    if (s.phase === 'night') say(`Night ${s.wave}: defend your Ember`);
    else if (s.phase === 'day') say(`Day ${s.wave + 1}: scavenge, build, raid`);
  }
  s.teams.forEach((T, k) => {
    if (!T.alive && seen.alive[k]) say(k === team ? 'Your Ember is lost. WASD moves the camera.' : `Team ${TEAMS[k].name} has fallen`);
    seen.alive[k] = T.alive;
  });
  if (s.phase === 'over' && seen.phase !== 'over') {
    $('result').textContent = s.winner < 0 ? 'No Ember survives' : `Team ${TEAMS[s.winner].name} wins`;
    $('resultSub').textContent = s.winner === team ? 'Your Ember holds' : 'Your Ember is lost';
    $('endScores').replaceChildren(scoreTable(s));
    setBuild(null);
  }
  $('end').hidden = s.phase !== 'over';
  seen.phase = s.phase;
  seen.wave = s.wave;
}

function hud() {
  const s = latest, h = s.heroes[slot], T = s.teams[h.team], d = HEROES[h.kind];
  const width = (node, frac) => (node.querySelector('i').style.width = `${clamp(frac, 0, 1) * 100}%`);
  $('phaseName').textContent = s.phase === 'night' ? `Night ${s.wave}` : s.phase === 'day' ? `Day ${s.wave + 1}` : 'Match over';
  const left = s.enemies.length + s.pending;
  $('phaseInfo').textContent = s.phase === 'night' ? `${left} AI ${left === 1 ? 'enemy' : 'enemies'} left` : s.phase === 'day' ? `Night falls in ${Math.ceil(s.timer)}s` : '';

  [...$('embers').children].forEach((box, k) => {
    const E = s.teams[k];
    box.classList.toggle('fallen', !E.alive);
    box.querySelector('em').textContent = E.alive ? Math.ceil(E.ember.hp) : 'Fallen';
    width(box, E.ember.hp / E.ember.max);
  });
  [...$('squad').children].forEach((row, k) => {
    const o = s.heroes[h.team * TEAM_SIZE + k];
    row.classList.toggle('down', !o.alive);
    row.firstChild.lastChild.textContent = who(o.i).toLowerCase();
    row.children[1].textContent = o.out ? 'out' : o.alive ? `ult ${Math.floor(o.ult)}%` : `back in ${Math.ceil(o.respawn)}s`;
    width(row, o.hp / o.max);
  });

  const buffs = ['rush', 'fury'].filter((k) => h[k] > 0).map((k) => ` · ${POWERUPS[k].name} ${Math.ceil(h[k])}s`).join('');
  $('meHp').textContent = h.out ? 'Out' : h.alive ? `${Math.ceil(h.hp)} / ${h.max}${h.shieldMax ? ` + ${Math.ceil(h.shield)} shield` : ''}${buffs}` : `Back in ${Math.ceil(h.respawn)}s`;
  width($('hp'), h.hp / h.max);
  $('q').classList.toggle('ready', h.alive && h.qCd <= 0);
  $('q').lastChild.textContent = h.qCd > 0 ? `${h.qCd.toFixed(1)}s` : 'Ready';
  $('r').classList.toggle('ready', h.alive && h.ult >= 100);
  $('r').lastChild.textContent = h.ult >= 100 ? 'Ready' : `${Math.floor(h.ult)}% charged`;

  $('scrap').lastChild.textContent = T.scrap;
  for (const b of $('build').querySelectorAll('button[data-type]')) {
    const cost = buildCost(h.kind, b.dataset.type);
    b.lastChild.textContent = `${cost} Scrap`;
    b.classList.toggle('poor', T.scrap < cost);
    b.classList.toggle('on', buildType === b.dataset.type);
  }

  const nearWreck = h.alive && s.wrecks.some((w) => Math.hypot(w.x - h.x, w.y - h.y) < SCAV_RANGE);
  $('hint').textContent = buildType
    ? `${ghostWhy ? `${WHY[ghostWhy]}. ` : ''}${touch.used ? 'Drag onto the ground and let go to build' : 'Left-click places, right-click removes, Esc stops building'}`
    : nearWreck && !touch.used ? 'Hold F to scavenge' : '';
  if (performance.now() > bannerUntil) $('banner').style.opacity = 0;
  if (!$('scores').hidden) $('scores').firstElementChild.replaceChildren(scoreTable(s));
}

function minimap() {
  const s = latest, k = 180 / WORLD.w;
  const dot = (o, size, color) => {
    mini.fillStyle = color;
    mini.fillRect(o.x * k - size / 2, o.y * k - size / 2, size, size);
  };
  mini.clearRect(0, 0, 180, 170);
  mini.strokeStyle = 'rgba(255,255,255,0.25)';
  mini.beginPath();
  mini.arc(ARENA.x * k, ARENA.y * k, ARENA.r * k, 0, 7);
  mini.stroke();
  for (const st of s.structs) dot(st, 2, `${TEAMS[st.team].color}99`);
  for (const w of s.wrecks) dot(w, 2, '#a8744f');
  for (const p of s.pickups) dot(p, 3, '#ffffff');
  for (const e of s.enemies) dot(e, e.type === 'colossus' ? 4 : 2, '#b79cff');
  s.teams.forEach((T, i) => {
    if (!T.alive) return;
    mini.fillStyle = TEAMS[i].color;
    mini.beginPath();
    mini.arc(T.ember.x * k, T.ember.y * k, 5, 0, 7);
    mini.fill();
  });
  for (const h of s.heroes) if (h.alive) dot(h, h.i === slot ? 5 : 3, h.i === slot ? '#ffffff' : TEAMS[h.team].color);
  const hw = innerWidth / 2 / cam.scale, hh = innerHeight / 2 / cam.scale;
  mini.strokeStyle = 'rgba(255,255,255,0.5)';
  mini.strokeRect((cam.x - hw) * k, (cam.y - hh) * k, hw * 2 * k, hh * 2 * k);
}

// ---------------------------------------------------------------- input

function moveVec() {
  if (touch.move.mag) return [touch.move.x, touch.move.y];
  const mx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const my = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
  const len = Math.hypot(mx, my) || 1;
  return [mx / len, my / len];
}

/** Held state goes out 30 times a second; one-shot orders (q, r, build, remove) ride along at once. */
function sendInput(extra) {
  if (slot < 0) return;
  const [mx, my] = moveVec();
  me.sent(++seq);
  let fire = mouse.left && !buildType, use = keys.has('KeyF');
  if (touch.used && latest) {
    // On touch the hero aims, fires and scavenges by itself, picking targets as the bots do, so thumbs are free to move and build.
    const h = latest.heroes[slot], auto = botInput(latest, slot, false);
    fire = auto.fire;
    use = h.alive && latest.wrecks.some((w) => Math.hypot(w.x - h.x, w.y - h.y) < SCAV_RANGE);
    if (fire) me.aim = auto.aim;
    else if (mx || my) me.aim = Math.atan2(my, mx); // nothing to shoot: face the way we walk
  }
  send({ t: 'input', seq, mx, my, aim: me.aim, fire, use, ...extra });
}

function setBuild(type) {
  buildType = type;
  ghostWhy = null;
  canvas.style.cursor = type ? 'cell' : 'crosshair';
}

/** In build mode, place (left button) or remove (right button) at the cell under the cursor; dragging paints. */
function order() {
  if (!buildType || !latest || slot < 0) return;
  const at = toWorld(mouse.x, mouse.y);
  const cx = Math.floor(at.x / CELL), cy = Math.floor(at.y / CELL);
  const key = `${mouse.left}${buildType}${cx},${cy}`;
  if (key === lastOrder) return;
  if (mouse.left && canBuild(latest, slot, buildType, cx, cy) === null) sendInput({ build: { type: buildType, cx, cy } });
  else if (mouse.right) sendInput({ remove: { cx, cy } });
  else return;
  lastOrder = key;
}

addEventListener('keydown', (e) => {
  if (slot < 0) return;
  if (e.code === 'Tab') {
    e.preventDefault();
    if ($('scores').hidden && latest) $('scores').firstElementChild.replaceChildren(scoreTable(latest));
    $('scores').hidden = !latest;
  }
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyM') say(sound.toggle() ? 'Sound off' : 'Sound on'), showSettings();
  if (e.code === 'Escape') setBuild(null);
  else if (/^Digit[1-9]$/.test(e.code)) {
    const type = Object.keys(STRUCTS)[e.code.at(-1) - 1]; // 1 Wall, 2 Turret, 3 Spikes, 4 Shield: the build bar's order
    if (type) setBuild(buildType === type ? null : type);
  }
  sendInput({ q: e.code === 'KeyQ', r: e.code === 'KeyR' }); // changes go out at once, not on the next 33 ms beat
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Tab') $('scores').hidden = true;
  sendInput();
});
addEventListener('blur', () => {
  keys.clear();
  mouse.left = mouse.right = false;
  $('scores').hidden = true;
});
addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  if (mouse.left || mouse.right) order(); // paint while dragging
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.left = false;
  if (e.button === 2) mouse.right = false;
  sendInput();
});
canvas.addEventListener('mousedown', (e) => {
  mouse.x = e.clientX; // a press can arrive without a move before it (touchpads, automation)
  mouse.y = e.clientY;
  if (e.button === 0) mouse.left = true;
  if (e.button === 2) mouse.right = true;
  lastOrder = '';
  order();
  sendInput();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Touch: a stick for moving; aim, fire and scavenge are automatic (see sendInput).
// Building on touch takes one of two styles, picked under Settings:
//   drag: drag from Wall, Turret or Spikes onto the ground; a ghost follows the thumb and it is placed on release.
//   auto: one Auto-build button places the next piece of the base layout the bot Cog builds.
let removing = false, dragging = null;
const prefs = { build: 'drag' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('emberhold-prefs') || '{}')); } catch { /* defaults */ }
const touch = createTouch(canvas, {
  building: () => buildType !== null && !dragging,
  point(x, y, down) {
    Object.assign(mouse, { x, y, left: down && !removing, right: down && removing });
    if (down) order();
    else lastOrder = '';
  },
});
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
$('q').onclick = () => sendInput({ q: true });
$('r').onclick = () => sendInput({ r: true });
$('rm').onclick = () => $('rm').classList.toggle('on', (removing = !removing));
for (const b of $('build').querySelectorAll('button[data-type]')) {
  b.onclick = () => setBuild(buildType === b.dataset.type ? null : b.dataset.type);
  b.addEventListener('touchstart', (e) => {
    e.preventDefault();
    dragging = { id: e.changedTouches[0].identifier };
    setBuild(b.dataset.type);
    mouse.x = -1e4; // no ghost until the thumb is over the ground
  }, { passive: false });
}
addEventListener('touchmove', (e) => {
  const t = dragging && [...e.changedTouches].find((t) => t.identifier === dragging.id);
  if (!t) return;
  e.preventDefault();
  Object.assign(mouse, { x: t.clientX, y: t.clientY - 40 }); // the ghost sits just above the thumb, where it can be seen
}, { passive: false });
const drop = (e) => {
  const t = dragging && [...e.changedTouches].find((t) => t.identifier === dragging.id);
  if (!t) return;
  dragging = null;
  const onGround = document.elementFromPoint(t.clientX, t.clientY) === canvas;
  if (onGround && latest && slot >= 0) {
    Object.assign(mouse, { x: t.clientX, y: t.clientY - 40, left: !removing, right: removing });
    follow(0); // world position of the release point
    lastOrder = '';
    order();
    if (ghostWhy && !removing) say(WHY[ghostWhy]);
  }
  mouse.left = mouse.right = false;
  setBuild(null);
};
addEventListener('touchend', drop);
addEventListener('touchcancel', drop);
$('auto').onclick = () => {
  if (!latest || slot < 0) return;
  const h = latest.heroes[slot], piece = h.alive ? nextPiece(latest, h) : null;
  if (!h.alive) say('You are down');
  else if (!piece) say('Nothing to build: save up more Scrap');
  else if (!piece.ready) say('Go closer to your Ember to build');
  else sendInput({ build: { type: piece.type, cx: piece.cx, cy: piece.cy } });
};

function showSettings() {
  for (const b of $('settings').querySelectorAll('[data-build]')) b.classList.toggle('on', b.dataset.build === prefs.build);
  $('soundSet').textContent = sound.muted() ? 'Sound: off' : 'Sound: on';
  document.body.classList.toggle('autobuild', prefs.build === 'auto');
}
$('gear').onclick = () => { $('settings').hidden = !$('settings').hidden; showSettings(); };
$('settingsDone').onclick = () => ($('settings').hidden = true);
$('soundSet').onclick = () => { sound.toggle(); showSettings(); };
for (const b of $('settings').querySelectorAll('[data-build]')) b.onclick = () => {
  prefs.build = b.dataset.build;
  try { localStorage.setItem('emberhold-prefs', JSON.stringify(prefs)); } catch { /* not remembered */ }
  showSettings();
};
showSettings();
$('again').onclick = () => send({ t: 'restart' });
setInterval(sendInput, 33);

// ---------------------------------------------------------------- camera and prediction

const toWorld = (px, py) => ({ x: cam.x + (px - innerWidth / 2) / cam.scale, y: cam.y + (py - innerHeight / 2) / cam.scale });

function follow(dt) {
  const h = slot >= 0 ? latest.heroes[slot] : null;
  const [mx, my] = moveVec();
  if (h && h.alive) {
    if (!me.known) me.place(h);
    else {
      // Walk by the sim's own rule, so rival Walls stop the prediction just as they stop the server.
      const v = h.stun > 0 ? 0 : HEROES[h.kind].speed * (h.rush > 0 ? POWERUPS.rush.speed : 1) * dt;
      me.team = h.team;
      moveHero(latest, me, mx * v, my * v);
      me.settle(dt);
    }
    cam.x = me.x;
    cam.y = me.y;
  } else {
    me.known = false;
    if (!h || h.out) {
      cam.x += mx * 900 * dt; // spectating: WASD flies the camera
      cam.y += my * 900 * dt;
    }
  }
  cam.scale = zoom * PX;
  const hw = innerWidth / 2 / cam.scale, hh = innerHeight / 2 / cam.scale;
  cam.x = clamp(cam.x, Math.min(hw, WORLD.w / 2), Math.max(WORLD.w - hw, WORLD.w / 2));
  cam.y = clamp(cam.y, Math.min(hh, WORLD.h / 2), Math.max(WORLD.h - hh, WORLD.h / 2));
  Object.assign(mouse, { wx: toWorld(mouse.x, mouse.y).x, wy: toWorld(mouse.x, mouse.y).y });
  if (!touch.used) me.aim = Math.atan2(mouse.wy - me.y, mouse.wx - me.x); // on touch, sendInput aims
}

// ---------------------------------------------------------------- drawing

function fit() {
  // A whole number of screen pixels to each art pixel, so the art stays crisp.
  // On a phone that means whole device pixels: its CSS pixels are several device pixels wide.
  const dpr = devicePixelRatio || 1;
  zoom = Math.max(1, Math.ceil(Math.max((innerWidth * dpr) / VIEW.w, (innerHeight * dpr) / VIEW.h))) / dpr;
  const w = Math.ceil(innerWidth / zoom), h = Math.ceil(innerHeight / zoom);
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = shadeCanvas.width = w;
  canvas.height = shadeCanvas.height = h;
  canvas.style.width = `${w * zoom}px`;
  canvas.style.height = `${h * zoom}px`;
}

/** Each match wears the mood its seed picked (s.mood); the HUD panels take its colours too. */
function wear(k) {
  if (k === mood) return;
  mood = k;
  for (const v of ['panel', 'panel2', 'edge']) document.documentElement.style.setProperty(`--${v}`, MOODS[k][v]);
}

/** Night: darken the screen, with pools of light round Embers, heroes, Turrets and shots. */
function nightfall(s, X, Y) {
  dark += ((s.phase === 'night' ? 1 : 0) - dark) * 0.04;
  if (dark < 0.02) return;
  shade.globalCompositeOperation = 'source-over';
  shade.clearRect(0, 0, shadeCanvas.width, shadeCanvas.height);
  shade.fillStyle = `rgba(${MOODS[mood].night},${0.76 * dark})`;
  shade.fillRect(0, 0, shadeCanvas.width, shadeCanvas.height);
  shade.globalCompositeOperation = 'destination-out';
  const light = (x, y, r) => {
    if (x < -r || y < -r || x > shadeCanvas.width + r || y > shadeCanvas.height + r) return;
    const g = shade.createRadialGradient(x, y, r * 0.25, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    shade.fillStyle = g;
    shade.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (const T of s.teams) if (T.alive) light(X(T.ember.x), Y(T.ember.y) - 6, 230);
  for (const h of s.heroes) if (h.alive) h.i === slot && me.known ? light(X(me.x), Y(me.y) - 6, 150) : light(X(h.x), Y(h.y) - 6, 95);
  for (const st of s.structs) if (st.type === 'turret' || st.type === 'shield') light(X(st.x), Y(st.y), 65);
  for (const sh of s.shots) light(X(sh.x), Y(sh.y), 16);
  ctx.drawImage(shadeCanvas, 0, 0);
}

/** Build mode: the cell under the cursor, green if it can be built on, and the build range. */
function drawGhost(X, Y) {
  const h = latest.heroes[slot];
  if (!h.alive) return;
  const cx = Math.floor(mouse.wx / CELL), cy = Math.floor(mouse.wy / CELL), x = X(cx * CELL), y = Y(cy * CELL);
  ghostWhy = canBuild(latest, slot, buildType, cx, cy);
  const col = ghostWhy ? '#ff6b6b' : '#7dffa8';
  ctx.globalAlpha = 0.3;
  art.S.R(x, y, TILE, TILE, col);
  ctx.globalAlpha = 1;
  art.S.R(x, y, TILE, 1, col); art.S.R(x, y + TILE - 1, TILE, 1, col); art.S.R(x, y, 1, TILE, col); art.S.R(x + TILE - 1, y, 1, TILE, col);
  art.ring(X(me.x), Y(me.y), BUILD_RANGE * PX, 'rgba(255,255,255,0.4)', { gap: 5 });
  const reach = STRUCTS[buildType].range ?? STRUCTS[buildType].radius; // a Turret's gun, a Shield Generator's field
  if (reach) art.ring(x + TILE / 2, y + TILE / 2, reach * PX, 'rgba(125,255,168,0.6)', { gap: 3 });
}

function draw(s, now) {
  const W = canvas.width, H = canvas.height;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#10131f';
  ctx.fillRect(0, 0, W, H);
  if (!s) return;
  wear(s.mood);
  // The camera moves a whole art pixel at a time, so nothing shimmers as it scrolls.
  const ox = Math.round(cam.x * PX - W / 2), oy = Math.round(cam.y * PX - H / 2);
  const X = (v) => Math.round(v * PX) - ox, Y = (v) => Math.round(v * PX) - oy;
  const inView = (o, pad = 40) => { const x = X(o.x), y = Y(o.y); return x > -pad && y > -pad && x < W + pad && y < H + pad; };
  ctx.drawImage(ground(mood), -ox, -oy);

  // Everything that stands on the ground, drawn back to front so nearer things overlap farther ones.
  const standing = [];
  const stand = (y, paint) => standing.push([y, paint]);
  for (const st of s.structs) {
    if (!inView(st)) continue;
    const x = X(st.cx * CELL), y = Y(st.cy * CELL);
    if (st.type === 'spikes') art.spikes(st, x, y); // flat on the ground: under everything
    else stand(st.y + CELL / 2, () => art[st.type](st, x, y));
    if (st.type === 'shield' && !(st.wait > 0)) art.field(st, x, y, now); // flat too, so it never tints whoever stands behind it
  }
  for (const p of s.pickups) if (inView(p)) stand(p.y, () => art.pickup(p, X(p.x), Y(p.y), now));
  for (const w of s.wrecks) {
    if (!inView(w)) continue;
    stand(w.y, () => art.wreck(X(w.x), Y(w.y)));
    const picker = s.heroes.find((h) => h.alive && h.scavId === w.id && h.scav > 0);
    if (picker) stand(w.y + 1, () => art.ring(X(w.x), Y(w.y), 17, TEAMS[picker.team].color, { turn: picker.scav / SCAV_TIME, a0: -Math.PI / 2, thick: 2 }));
  }
  s.teams.forEach((T, k) => inView(T.ember, 120) && stand(T.ember.y + 12, () => art.ember(k, X(T.ember.x), Y(T.ember.y), T.ember.hp / T.ember.max, T.alive, now)));
  for (const e of s.enemies) if (inView(e)) stand(e.y, () => art.enemy(e, X(e.x), Y(e.y) + ENEMIES[e.type].r * PX * 0.6, now));
  for (const h of s.heroes) {
    if (!h.alive) continue;
    const mine = h.i === slot && me.known, p = mine ? me : h;
    // A hero is mid-stride for a moment after it last moved.
    const was = strides.get(h.i);
    if (!was || Math.hypot(p.x - was.x, p.y - was.y) > 0.4) strides.set(h.i, { x: p.x, y: p.y, until: was ? now + 140 : 0 });
    if (inView(p)) stand(p.y, () => art.hero(h, X(p.x), Y(p.y) + 7, mine ? me.aim : h.aim, { walking: now < strides.get(h.i).until, mine, t: now, aegis: s.teams[h.team].aegis > 0 }));
  }
  standing.sort((a, b) => a[0] - b[0]).forEach(([, paint]) => paint());

  s.teams.forEach((T, k) => T.alive && inView(T.ember, 160) && art.glow(X(T.ember.x), Y(T.ember.y) - 8, 90 + 60 * dark, TEAMS[k].color, 0.2));
  nightfall(s, X, Y);
  if (dark > 0.3) for (const e of s.enemies) if (inView(e)) art.eyes(e, X(e.x), Y(e.y) + ENEMIES[e.type].r * PX * 0.6); // a wave is seen coming
  for (const sh of s.shots) if (inView(sh)) art.shot(sh, X(sh.x), Y(sh.y));
  for (const f of s.fx) if (inView(f, 200)) art.fx(f, X(f.x), Y(f.y), f.r * PX);
  if (buildType && slot >= 0) drawGhost(X, Y);
  if (touch.used && slot >= 0 && me.known) art.ring(X(me.x), Y(me.y), HEROES[s.heroes[slot].kind].gun.range * PX, 'rgba(255,255,255,0.4)', { gap: 4 }); // how far the automatic gun reaches
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  fit();
  if (!latest) return draw(null, now);
  // Draw a moment a little behind the newest snapshot: blend the two either side of it.
  const at = timeline.at(now);
  let k = snaps.length - 1;
  while (k > 0 && snaps[k].at > at) k--;
  const a = snaps[k], b = snaps[k + 1];
  follow(dt);
  draw(b ? interpolate(a.s, b.s, (at - a.at) / (b.at - a.at)) : a.s, now);
  if (slot >= 0 && (mouse.left || mouse.right)) order(); // the hero may have walked a new cell under a held cursor
}

connect();
requestAnimationFrame(frame);
// The HUD and minimap refresh on a clock, not per frame, so they read the same at any frame rate.
setInterval(() => {
  if (!latest || slot < 0) return;
  hud();
  minimap();
}, 100);
