// Emberhold browser client: sends this player's input and draws the snapshots the server
// sends back. No rules live here; canBuild is imported only to colour the build ghost.
import { WORLD, CELL, TEAMS, HEROES, HERO_IDS, STRUCTS, ENEMIES, EMBER_R, HERO_R, BUILD_RANGE, SCAV_RANGE, SCAV_TIME, canBuild, buildCost } from './sim.js';
import { interpolate } from './interp.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls = '', text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const canvas = $('game'), ctx = canvas.getContext('2d');
const shadeCanvas = document.createElement('canvas'), shade = shadeCanvas.getContext('2d');
const mini = $('minimap').getContext('2d');

const DELAY = 80; // ms behind the server we draw, so there are two snapshots to blend between
const VIEW = { w: 1600, h: 1000 }; // the most world any screen shows, so a big monitor is no advantage
const AI_COLOR = { skitter: '#b79cff', spitter: '#e58cff', breaker: '#8a6cff', colossus: '#6f4be0' };
const AI_SIDES = { skitter: 3, spitter: 4, breaker: 6, colossus: 8 };
const WHY = {
  down: 'You are down', range: 'Too far away', occupied: 'Occupied', ember: 'Too close to an Ember',
  rival: 'Too close to a rival Ember', unit: 'Something is standing there', scrap: 'Not enough Scrap',
};

let ws, slot = -1, lobby = null, latest = null, humans = [];
const snaps = []; // recent snapshots with their arrival times
const cam = { x: WORLD.w / 2, y: WORLD.h / 2, scale: 1 };
const me = { x: 0, y: 0, aim: 0, known: false }; // this player's hero, predicted locally
const keys = new Set();
const mouse = { x: innerWidth / 2, y: innerHeight / 2, wx: 0, wy: 0, left: false, right: false };
const seen = { phase: '', wave: -1, alive: [true, true, true] };
let buildType = null, ghostWhy = null, lastOrder = '', dark = 0, lastFrame = performance.now(), dpr = 1, bannerUntil = 0;

// ---------------------------------------------------------------- connection

const send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onclose = () => ($('offline').hidden = false);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'state') {
      latest = m.s;
      humans = m.humans;
      snaps.push({ at: performance.now(), s: m.s });
      if (snaps.length > 8) snaps.shift();
      onState(m.s);
    } else if (m.t === 'lobby') {
      lobby = m;
      humans = m.humans;
      if (!m.running) {
        latest = null;
        snaps.length = 0;
      }
      renderSelect();
    } else if (m.t === 'joined') {
      slot = m.slot;
      me.known = false;
      $('select').hidden = true;
      $('hud').hidden = false;
      setupHud();
    } else if (m.t === 'denied') {
      $('note').textContent =
        m.why === 'taken' ? 'Someone just took that hero. Pick another.' : m.why === 'out' ? 'That team has already fallen. Pick another.' : 'Could not join that slot.';
    }
  };
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
        const i = team * 4 + k, d = HEROES[kind], fallen = lobby.out[team];
        const card = el('button', 'card');
        card.disabled = fallen || lobby.humans[i];
        const head = el('header');
        head.append(el('b', '', d.name), el('em', '', fallen ? 'Fallen' : lobby.humans[i] ? 'Taken' : 'Bot'));
        const line = (label, text) => {
          const row = el('small');
          row.append(el('b', '', label), ` ${text}`);
          return row;
        };
        card.append(head, el('small', '', `${d.role} · ${d.gun.name} · ${d.hp} health`), line(`Q ${d.q.name}:`, d.q.text), line(`R ${d.r.name}:`, d.r.text), line('Passive:', d.passive));
        card.onclick = () => send({ t: 'join', slot: i });
        col.append(card);
      });
      return col;
    }),
  );
}

function setupHud() {
  const team = slot >> 2, d = HEROES[HERO_IDS[slot & 3]];
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
    for (const h of s.heroes.slice(k * 4, k * 4 + 4)) {
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

function say(text) {
  $('banner').textContent = text;
  $('banner').style.opacity = 1;
  bannerUntil = performance.now() + 3500;
}

/** React to changes between snapshots: phase banners, fallen teams, the end screen. */
function onState(s) {
  if (slot < 0) return;
  const team = slot >> 2;
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
    const o = s.heroes[h.team * 4 + k];
    row.classList.toggle('down', !o.alive);
    row.firstChild.lastChild.textContent = who(o.i).toLowerCase();
    row.children[1].textContent = o.out ? 'out' : o.alive ? `ult ${Math.floor(o.ult)}%` : `back in ${Math.ceil(o.respawn)}s`;
    width(row, o.hp / o.max);
  });

  $('meHp').textContent = h.out ? 'Out' : h.alive ? `${Math.ceil(h.hp)} / ${h.max}${h.shieldMax ? ` + ${Math.ceil(h.shield)} shield` : ''}` : `Back in ${Math.ceil(h.respawn)}s`;
  width($('hp'), h.hp / h.max);
  $('q').classList.toggle('ready', h.alive && h.qCd <= 0);
  $('q').lastChild.textContent = h.qCd > 0 ? `${h.qCd.toFixed(1)}s` : 'Ready';
  $('r').classList.toggle('ready', h.alive && h.ult >= 100);
  $('r').lastChild.textContent = h.ult >= 100 ? 'Ready' : `${Math.floor(h.ult)}% charged`;

  $('scrap').lastChild.textContent = T.scrap;
  for (const b of $('build').querySelectorAll('button')) {
    const cost = buildCost(h.kind, b.dataset.type);
    b.lastChild.textContent = `${cost} Scrap`;
    b.classList.toggle('poor', T.scrap < cost);
    b.classList.toggle('on', buildType === b.dataset.type);
  }

  const nearWreck = h.alive && s.wrecks.some((w) => Math.hypot(w.x - h.x, w.y - h.y) < SCAV_RANGE);
  $('hint').textContent = buildType
    ? `${ghostWhy ? `${WHY[ghostWhy]}. ` : ''}Left-click places, right-click removes, Esc stops building`
    : nearWreck ? 'Hold F to scavenge' : '';
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
  for (const st of s.structs) dot(st, 2, `${TEAMS[st.team].color}99`);
  for (const w of s.wrecks) dot(w, 2, '#a8744f');
  for (const e of s.enemies) dot(e, e.type === 'colossus' ? 4 : 2, AI_COLOR.skitter);
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
  const mx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const my = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
  const len = Math.hypot(mx, my) || 1;
  return [mx / len, my / len];
}

/** Held state goes out 30 times a second; one-shot orders (q, r, build, remove) ride along at once. */
function sendInput(extra) {
  if (slot < 0) return;
  const [mx, my] = moveVec();
  send({ t: 'input', mx, my, aim: me.aim, fire: mouse.left && !buildType, use: keys.has('KeyF'), ...extra });
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
  if (e.code === 'Escape') setBuild(null);
  else if (/^Digit[123]$/.test(e.code)) {
    const type = ['wall', 'turret', 'spikes'][e.code.at(-1) - 1];
    setBuild(buildType === type ? null : type);
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
for (const b of $('build').querySelectorAll('button')) b.onclick = () => setBuild(buildType === b.dataset.type ? null : b.dataset.type);
$('again').onclick = () => send({ t: 'restart' });
setInterval(sendInput, 33);

// ---------------------------------------------------------------- camera and prediction

const toWorld = (px, py) => ({ x: cam.x + (px - innerWidth / 2) / cam.scale, y: cam.y + (py - innerHeight / 2) / cam.scale });

function follow(dt) {
  const h = slot >= 0 ? latest.heroes[slot] : null;
  const [mx, my] = moveVec();
  if (h && h.alive) {
    if (!me.known || Math.hypot(me.x - h.x, me.y - h.y) > 120) Object.assign(me, { x: h.x, y: h.y, known: true }); // spawned, dashed or thrown: take the server's word
    else {
      // shortcut: predicts plain walking only (no wall collisions); the pull toward the server's position corrects it within a few frames
      const v = h.stun > 0 ? 0 : HEROES[h.kind].speed * dt, pull = Math.min(1, dt * 8);
      me.x = clamp(me.x + mx * v, HERO_R, WORLD.w - HERO_R);
      me.y = clamp(me.y + my * v, HERO_R, WORLD.h - HERO_R);
      me.x += (h.x - me.x) * pull;
      me.y += (h.y - me.y) * pull;
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
  cam.scale = Math.max(innerWidth / VIEW.w, innerHeight / VIEW.h);
  const hw = innerWidth / 2 / cam.scale, hh = innerHeight / 2 / cam.scale;
  cam.x = clamp(cam.x, Math.min(hw, WORLD.w / 2), Math.max(WORLD.w - hw, WORLD.w / 2));
  cam.y = clamp(cam.y, Math.min(hh, WORLD.h / 2), Math.max(WORLD.h - hh, WORLD.h / 2));
  Object.assign(mouse, { wx: toWorld(mouse.x, mouse.y).x, wy: toWorld(mouse.x, mouse.y).y });
  me.aim = Math.atan2(mouse.wy - me.y, mouse.wx - me.x);
}

// ---------------------------------------------------------------- drawing

function fit() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = shadeCanvas.width = w;
  canvas.height = shadeCanvas.height = h;
}

function worldSpace(c) {
  const k = cam.scale * dpr;
  c.setTransform(k, 0, 0, k, canvas.width / 2 - cam.x * k, canvas.height / 2 - cam.y * k);
}

const circle = (c, x, y, r) => {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
};

function polygon(x, y, r, sides, turn) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = turn + (i / sides) * Math.PI * 2;
    ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

function healthBar(x, y, w, frac, color) {
  ctx.fillStyle = '#05080e';
  ctx.fillRect(x - 1, y - 1, w + 2, 6);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * clamp(frac, 0, 1), 4);
}

function drawWreck(w, s) {
  ctx.save();
  ctx.translate(w.x, w.y);
  ctx.rotate(w.id * 2.4);
  ctx.fillStyle = '#6b4a35';
  ctx.strokeStyle = '#a8744f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [x, y] of [[-16, -8], [4, -14], [17, -3], [9, 12], [-12, 10]]) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f2c66d';
  ctx.fillRect(-4, -4, 7, 5);
  ctx.restore();
  const picker = s.heroes.find((h) => h.alive && h.scavId === w.id && h.scav > 0);
  if (!picker) return;
  ctx.strokeStyle = TEAMS[picker.team].color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(w.x, w.y, 26, -Math.PI / 2, -Math.PI / 2 + (picker.scav / SCAV_TIME) * Math.PI * 2);
  ctx.stroke();
}

function drawStruct(st) {
  const color = TEAMS[st.team].color, x = st.cx * CELL, y = st.cy * CELL;
  if (st.type === 'spikes') {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3 + 0.6 * (st.hp / st.max);
    for (let i = 0; i < 9; i++) {
      const px = x + 8 + (i % 3) * 12, py = y + 12 + Math.floor(i / 3) * 12;
      ctx.beginPath();
      ctx.moveTo(px - 4, py + 4);
      ctx.lineTo(px, py - 6);
      ctx.lineTo(px + 4, py + 4);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }
  ctx.fillStyle = '#18233a';
  ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
  ctx.fillStyle = `${color}40`;
  ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash(st.ttl > 0 ? [5, 4] : []); // a Sentry is temporary
  ctx.strokeRect(x + 3, y + 3, CELL - 6, CELL - 6);
  ctx.setLineDash([]);
  if (st.type === 'turret') {
    ctx.strokeStyle = '#dfe7f5';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(st.x, st.y);
    ctx.lineTo(st.x + Math.cos(st.aim) * 19, st.y + Math.sin(st.aim) * 19);
    ctx.stroke();
    ctx.fillStyle = color;
    circle(ctx, st.x, st.y, 10);
    ctx.fill();
  }
  if (st.hp < st.max) healthBar(x + 6, y + CELL - 9, CELL - 12, st.hp / st.max, color);
}

function drawEmber(T, k, now) {
  const { x, y, hp, max } = T.ember, color = TEAMS[k].color;
  if (!T.alive) {
    ctx.fillStyle = '#161d2a';
    ctx.strokeStyle = '#2c3648';
    ctx.lineWidth = 3;
    circle(ctx, x, y, EMBER_R);
    ctx.fill();
    ctx.stroke();
    return;
  }
  const glow = 170 * (1 + 0.06 * Math.sin(now / 300 + k));
  const g = ctx.createRadialGradient(x, y, 8, x, y, glow);
  g.addColorStop(0, `${color}cc`);
  g.addColorStop(0.3, `${color}44`);
  g.addColorStop(1, `${color}00`);
  ctx.fillStyle = g;
  circle(ctx, x, y, glow);
  ctx.fill();
  ctx.fillStyle = color;
  circle(ctx, x, y, EMBER_R);
  ctx.fill();
  ctx.fillStyle = '#fff3d6';
  circle(ctx, x, y, EMBER_R * 0.45);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#05080e';
  circle(ctx, x, y, EMBER_R + 10);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, EMBER_R + 10, -Math.PI / 2, -Math.PI / 2 + (hp / max) * Math.PI * 2);
  ctx.stroke();
}

function drawEnemy(e) {
  const d = ENEMIES[e.type];
  ctx.fillStyle = e.stun > 0 ? '#7fa8ff' : AI_COLOR[e.type];
  ctx.strokeStyle = '#1a1030';
  ctx.lineWidth = 2;
  polygon(e.x, e.y, d.r + 2, AI_SIDES[e.type], e.id);
  ctx.fill();
  ctx.stroke();
  if (e.type === 'colossus') {
    ctx.fillStyle = '#ffd0f0';
    circle(ctx, e.x, e.y, 9);
    ctx.fill();
  }
  if (e.hp < e.max) healthBar(e.x - d.r, e.y - d.r - 10, d.r * 2, e.hp / e.max, '#e58cff');
}

function drawHero(h) {
  const mine = h.i === slot && me.known, color = TEAMS[h.team].color;
  const x = mine ? me.x : h.x, y = mine ? me.y : h.y, aim = mine ? me.aim : h.aim;
  ctx.strokeStyle = '#dfe7f5';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(aim) * 8, y + Math.sin(aim) * 8);
  ctx.lineTo(x + Math.cos(aim) * 25, y + Math.sin(aim) * 25);
  ctx.stroke();
  ctx.fillStyle = color;
  circle(ctx, x, y, HERO_R);
  ctx.fill();
  ctx.lineWidth = mine ? 3 : 2;
  ctx.strokeStyle = mine ? '#ffffff' : '#05080e';
  ctx.stroke();
  ctx.fillStyle = '#05080e';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(HEROES[h.kind].name[0], x, y + 1);
  const ring = (r, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = 3;
    circle(ctx, x, y, r);
    ctx.stroke();
  };
  if (h.fortify > 0) ring(HERO_R + 7, '#ffe9a8');
  if (h.overdrive > 0) ring(HERO_R + 7, '#ff7ad9');
  if (h.stun > 0) ring(HERO_R + 4, '#7fa8ff');
  healthBar(x - 18, y - 28, 36, h.hp / h.max, color);
  if (h.shieldMax) healthBar(x - 18, y - 33, 36, h.shield / h.shieldMax, '#9fd0ff');
  ctx.fillStyle = '#cfd8e8';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(HEROES[h.kind].name, x, y - (h.shieldMax ? 43 : 38));
}

function drawShot(sh) {
  ctx.strokeStyle = sh.team < 0 ? '#ff9ad5' : TEAMS[sh.team].color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sh.x, sh.y);
  ctx.lineTo(sh.x - sh.vx * 0.025, sh.y - sh.vy * 0.025);
  ctx.stroke();
}

function drawFx(f) {
  const p = clamp(1 - f.ttl / 0.45, 0, 1); // 0 at birth, 1 as it fades out
  const color = f.kind === 'heal' ? '#7dffa8' : f.kind === 'down' ? '#ff6b6b' : f.kind === 'scrap' ? '#f2c66d' : f.kind === 'ult' ? '#ffffff' : f.team < 0 ? '#e58cff' : TEAMS[f.team].color;
  ctx.globalAlpha = 1 - p;
  ctx.strokeStyle = color;
  ctx.lineWidth = f.kind === 'fall' ? 10 : 4;
  circle(ctx, f.x, f.y, f.r * (f.kind === 'dash' ? 1 : 0.3 + 0.7 * p) * (f.kind === 'fall' ? 1.6 : 1));
  ctx.stroke();
  if (f.kind === 'heal' || f.kind === 'pop') {
    ctx.fillStyle = color;
    ctx.globalAlpha = (1 - p) * 0.25;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Night: darken the screen, with pools of light round Embers, heroes and Turrets. */
function nightfall(s) {
  dark += ((s.phase === 'night' ? 1 : 0) - dark) * 0.04;
  if (dark < 0.02) return;
  shade.setTransform(1, 0, 0, 1, 0, 0);
  shade.globalCompositeOperation = 'source-over';
  shade.clearRect(0, 0, shadeCanvas.width, shadeCanvas.height);
  shade.fillStyle = `rgba(3, 6, 16, ${0.72 * dark})`;
  shade.fillRect(0, 0, shadeCanvas.width, shadeCanvas.height);
  shade.globalCompositeOperation = 'destination-out';
  worldSpace(shade);
  const light = (x, y, r) => {
    const g = shade.createRadialGradient(x, y, r * 0.25, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    shade.fillStyle = g;
    circle(shade, x, y, r);
    shade.fill();
  };
  for (const T of s.teams) if (T.alive) light(T.ember.x, T.ember.y, 460);
  for (const h of s.heroes) if (h.alive) h.i === slot && me.known ? light(me.x, me.y, 300) : light(h.x, h.y, 190);
  for (const st of s.structs) if (st.type === 'turret') light(st.x, st.y, 130);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(shadeCanvas, 0, 0);
  worldSpace(ctx);
}

/** Build mode: the cell under the cursor, green if it can be built on, and the build range. */
function drawGhost() {
  const h = latest.heroes[slot];
  if (!h.alive) return;
  const cx = Math.floor(mouse.wx / CELL), cy = Math.floor(mouse.wy / CELL);
  ghostWhy = canBuild(latest, slot, buildType, cx, cy);
  ctx.fillStyle = ghostWhy ? 'rgba(255,107,107,0.25)' : 'rgba(125,255,168,0.25)';
  ctx.strokeStyle = ghostWhy ? '#ff6b6b' : '#7dffa8';
  ctx.lineWidth = 2;
  ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL);
  ctx.strokeRect(cx * CELL, cy * CELL, CELL, CELL);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.setLineDash([6, 8]);
  circle(ctx, me.x, me.y, BUILD_RANGE);
  ctx.stroke();
  ctx.setLineDash([]);
  if (STRUCTS[buildType].range) {
    ctx.strokeStyle = 'rgba(125,255,168,0.3)';
    circle(ctx, (cx + 0.5) * CELL, (cy + 0.5) * CELL, STRUCTS[buildType].range);
    ctx.stroke();
  }
}

function draw(s, now) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#070b12';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!s) return;
  worldSpace(ctx);
  const hw = innerWidth / 2 / cam.scale, hh = innerHeight / 2 / cam.scale;
  const inView = (o, pad = 60) => Math.abs(o.x - cam.x) < hw + pad && Math.abs(o.y - cam.y) < hh + pad;

  ctx.fillStyle = '#0e1624';
  ctx.fillRect(0, 0, WORLD.w, WORLD.h);
  ctx.strokeStyle = 'rgba(130,160,210,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.max(0, Math.floor((cam.x - hw) / CELL) * CELL); x <= Math.min(WORLD.w, cam.x + hw); x += CELL) {
    ctx.moveTo(x, Math.max(0, cam.y - hh));
    ctx.lineTo(x, Math.min(WORLD.h, cam.y + hh));
  }
  for (let y = Math.max(0, Math.floor((cam.y - hh) / CELL) * CELL); y <= Math.min(WORLD.h, cam.y + hh); y += CELL) {
    ctx.moveTo(Math.max(0, cam.x - hw), y);
    ctx.lineTo(Math.min(WORLD.w, cam.x + hw), y);
  }
  ctx.stroke();
  ctx.strokeStyle = '#2a3a58';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, WORLD.w, WORLD.h);

  for (const w of s.wrecks) if (inView(w)) drawWreck(w, s);
  for (const st of s.structs) if (inView(st)) drawStruct(st);
  s.teams.forEach((T, k) => inView(T.ember, 220) && drawEmber(T, k, now));
  for (const e of s.enemies) if (inView(e)) drawEnemy(e);
  for (const h of s.heroes) if (h.alive && inView(h)) drawHero(h);
  for (const sh of s.shots) if (inView(sh)) drawShot(sh);
  for (const f of s.fx) if (inView(f, 400)) drawFx(f);
  nightfall(s);
  if (buildType && slot >= 0) drawGhost();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  fit();
  if (!latest) return draw(null, now);
  // Draw the moment DELAY ms ago: blend the two snapshots either side of it.
  const at = now - DELAY;
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
