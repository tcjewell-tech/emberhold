// Touch controls: a stick appears under the thumb and moves the hero. Aiming, firing and
// scavenging are automatic on touch (see client.js), so a phone player's hands are free to
// move and build. Touch still only produces the same input a keyboard and mouse do, so the
// rules never know which a player is using.

/** A thumb dragged (dx, dy) from where it landed: a unit direction, and how far (0 to 1). Small drags count as nothing. */
export function stickVector(dx, dy, radius = 50, dead = 0.18) {
  const d = Math.hypot(dx, dy), mag = Math.min(1, d / radius);
  return mag < dead ? { x: 0, y: 0, mag: 0 } : { x: dx / d, y: dy / d, mag };
}

/**
 * Listens for touches on the canvas. The first finger down is the move stick. While
 * building() is true, any other finger points at a build cell: point(x, y, down).
 * Returns live state: used (any touch seen) and move {x, y, mag}.
 */
export function createTouch(canvas, { building, point }) {
  const state = { used: false, move: { x: 0, y: 0, mag: 0 } };
  let stick = null, pointer = null; // { id, x0, y0 } and a finger id
  const el = document.getElementById('stick');
  const show = (dx = 0, dy = 0) => {
    el.hidden = !stick;
    if (!stick) return;
    const k = Math.min(1, 50 / (Math.hypot(dx, dy) || 1));
    el.style.left = `${stick.x0}px`;
    el.style.top = `${stick.y0}px`;
    el.firstElementChild.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  };
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // also stops the browser inventing mouse clicks from taps
    state.used = true;
    document.body.classList.add('touch');
    for (const t of e.changedTouches) {
      // In build mode a tap builds. With no stick held, a touch on the left half still starts the stick, so you can walk.
      if (building() && pointer === null && (stick || t.clientX > innerWidth / 2)) {
        pointer = t.identifier;
        point(t.clientX, t.clientY, true);
      } else if (!stick) {
        stick = { id: t.identifier, x0: t.clientX, y0: t.clientY };
        show();
      }
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === pointer) point(t.clientX, t.clientY, true);
      else if (t.identifier === stick?.id) {
        const dx = t.clientX - stick.x0, dy = t.clientY - stick.y0;
        state.move = stickVector(dx, dy);
        show(dx, dy);
      }
    }
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === pointer) {
        pointer = null;
        point(t.clientX, t.clientY, false);
      } else if (t.identifier === stick?.id) {
        stick = null;
        state.move = { x: 0, y: 0, mag: 0 };
        show();
      }
    }
  };
  canvas.addEventListener('touchend', end);
  canvas.addEventListener('touchcancel', end);
  return state;
}
