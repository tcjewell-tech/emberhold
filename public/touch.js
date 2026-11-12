// Touch controls: a stick appears under each thumb. The left one moves; the right one aims and
// fires while held. They only produce the same move, aim and fire a keyboard and mouse do, so
// the rules never know which a player is using.

/** A thumb dragged (dx, dy) from where it landed: a unit direction, and how far (0 to 1). Small drags count as nothing. */
export function stickVector(dx, dy, radius = 50, dead = 0.18) {
  const d = Math.hypot(dx, dy), mag = Math.min(1, d / radius);
  return mag < dead ? { x: 0, y: 0, mag: 0 } : { x: dx / d, y: dy / d, mag };
}

/**
 * A thumb is less exact than a mouse, so on touch the aim snaps to the hostile nearest the
 * thumb's direction, if one is within `cone` radians of it and in gun range. Otherwise the
 * aim is left as it is.
 */
export function aimAssist(aim, from, targets, range, cone = 0.3) {
  let best = aim, off = cone;
  for (const t of targets) {
    const dx = t.x - from.x, dy = t.y - from.y;
    if (Math.hypot(dx, dy) > range) continue;
    const a = Math.atan2(dy, dx), d = Math.abs(Math.atan2(Math.sin(a - aim), Math.cos(a - aim)));
    if (d < off) {
      off = d;
      best = a;
    }
  }
  return best;
}

/**
 * Listens for touches on the canvas. building(): whether build mode is on, in which case a
 * touch on the right half points at a cell (point(x, y, down)) instead of aiming.
 * Returns live state: used (any touch seen), move {x, y}, aim (radians or null), fire.
 */
export function createTouch(canvas, { building, point }) {
  const state = { used: false, move: { x: 0, y: 0 }, aim: null, fire: false };
  const held = {}; // L, R: a stick { id, x0, y0 }; B: the finger pointing at a build cell
  const show = (side, s, dx = 0, dy = 0) => {
    const el = document.getElementById(`stick${side}`), d = Math.hypot(dx, dy) || 1, k = Math.min(1, 50 / d);
    el.hidden = !s;
    if (!s) return;
    el.style.left = `${s.x0}px`;
    el.style.top = `${s.y0}px`;
    el.firstElementChild.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  };
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // also stops the browser inventing mouse clicks from taps
    state.used = true;
    document.body.classList.add('touch');
    for (const t of e.changedTouches) {
      const side = t.clientX < innerWidth / 2 ? 'L' : 'R';
      if (side === 'R' && building()) {
        held.B = { id: t.identifier };
        point(t.clientX, t.clientY, true);
      } else if (!held[side]) {
        held[side] = { id: t.identifier, x0: t.clientX, y0: t.clientY };
        show(side, held[side]);
      }
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (held.B?.id === t.identifier) point(t.clientX, t.clientY, true);
      for (const side of ['L', 'R']) {
        const s = held[side];
        if (s?.id !== t.identifier) continue;
        const dx = t.clientX - s.x0, dy = t.clientY - s.y0, v = stickVector(dx, dy);
        if (side === 'L') state.move = v;
        else {
          if (v.mag) state.aim = Math.atan2(v.y, v.x);
          state.fire = v.mag > 0;
        }
        show(side, s, dx, dy);
      }
    }
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (held.B?.id === t.identifier) {
        delete held.B;
        point(t.clientX, t.clientY, false);
      }
      for (const side of ['L', 'R']) {
        if (held[side]?.id !== t.identifier) continue;
        delete held[side];
        show(side, null);
        if (side === 'L') state.move = { x: 0, y: 0 };
        else Object.assign(state, { aim: null, fire: false });
      }
    }
  };
  canvas.addEventListener('touchend', end);
  canvas.addEventListener('touchcancel', end);
  return state;
}
