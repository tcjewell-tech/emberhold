// Blends two server snapshots so motion looks smooth between the 30 Hz updates.

const TELEPORT = 200; // further than this in one update means a respawn, not a walk: do not smear it across the map

function blend(prev, next, t, key) {
  const old = new Map(prev.map((o) => [o[key], o]));
  return next.map((n) => {
    const p = old.get(n[key]);
    if (!p || Math.hypot(n.x - p.x, n.y - p.y) > TELEPORT) return n;
    const o = { ...n, x: p.x + (n.x - p.x) * t, y: p.y + (n.y - p.y) * t };
    if (n.aim !== undefined) o.aim = p.aim + Math.atan2(Math.sin(n.aim - p.aim), Math.cos(n.aim - p.aim)) * t; // the short way round
    return o;
  });
}

/** The newer snapshot, with heroes, AI enemies and shots placed t (0..1) of the way from the older one. */
export function interpolate(prev, next, t) {
  if (!prev || t >= 1) return next;
  t = Math.max(0, t);
  return {
    ...next,
    heroes: blend(prev.heroes, next.heroes, t, 'i'),
    enemies: blend(prev.enemies, next.enemies, t, 'id'),
    shots: blend(prev.shots, next.shots, t, 'id'),
  };
}
