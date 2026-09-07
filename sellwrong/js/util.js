/* =====================================================================
   SELLWRONG — the small stuff everything else stands on
   =====================================================================

   Units are Doom units, and that is a decision, not an accident. The
   player is 56 tall with his eye at 41, he is 32 across, and he steps up
   anything 24 or under without noticing it. A door is 72 clear. A wall
   texture is 64 across and 64 up.

   That last one is the whole reason for the choice: at 64 units to a
   64-pixel texture the mapping between the world and the art is one
   texel to one unit, everywhere, with no scale factor to carry around
   and no chance of a wall that samples its texture at some awkward 1.37
   repeats. Ask for a 96-wide wall and you get one and a half repeats,
   which is exactly what you would have got in 1993.

   Time is tics. Doom runs its world at 35 Hz and every duration in the
   state tables below is written in tics, so a frame that lasts 4 is
   4/35 of a second and always will be, however fast the renderer goes.
   ===================================================================== */

export const TICRATE   = 35;
export const SEC       = 1 / TICRATE;

/* the body plan, in units */
export const PLAYER_RADIUS = 16;
export const PLAYER_HEIGHT = 56;
export const PLAYER_EYE    = 41;
export const MAX_STEP      = 24;   // climbed without slowing down
export const TEXEL         = 64;   // one texture, one wall, one unit each

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp  = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/* Shortest way round the circle: the difference between two angles, always
   in -PI..PI, so "turn toward" never takes the long way. */
export function angleNorm(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}
export const angleDiff = (a, b) => angleNorm(a - b);

/* Turn at most `step` radians of the way from `from` to `to`. Monsters use
   this so they swing round to face you over a few tics instead of snapping. */
export function turnToward(from, to, step) {
  const d = angleDiff(to, from);
  if (Math.abs(d) <= step) return to;
  return from + Math.sign(d) * step;
}

export const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
export const dist  = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

/* ----------------------------------------------------------------------
   Randomness

   Two kinds, and mixing them up causes bugs that only show on someone
   else's machine.

   rng()      seeded and reproducible. Everything that BUILDS the world
              uses this: the textures, the sprites, where the dirt goes.
              Same seed, same store, every time — which is the only way
              to tell whether a change to the texture bakery improved
              anything or just moved it.

   pRandom()  gameplay randomness, 0..255, the way Doom's P_Random works.
              Whether this shot hits, how far the blood flies, which way a
              confused zombie wanders. Nobody needs it reproducible.
   -------------------------------------------------------------------- */

/* xorshift32 — small, fast, and good enough for pictures of dirt */
export function makeRng(seed) {
  let s = (seed | 0) || 0x9e3779b9;
  return function rng() {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s |= 0;
    return ((s >>> 0) / 4294967296);
  };
}
/* handy wrappers over a seeded rng */
export function rngKit(seed) {
  const r = makeRng(seed);
  return {
    f: r,
    range: (a, b) => a + r() * (b - a),
    int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(r() * arr.length) % arr.length],
    chance: (p) => r() < p,
  };
}

let _pr = 0x1f2e3d4c;
export function pRandom() {          // 0..255, like Doom's
  _pr ^= _pr << 13; _pr |= 0;
  _pr ^= _pr >>> 17;
  _pr ^= _pr << 5;  _pr |= 0;
  return (_pr >>> 0) & 255;
}
/* Doom's idiom for a signed spread: two rolls subtracted, which gives a
   little triangular hump around zero rather than a flat spread. Used for
   spray, wander and pain wobble. */
export const pRandomSpread = () => pRandom() - pRandom();
export const pChance = (n) => pRandom() < n;      // n out of 256

/* ----------------------------------------------------------------------
   Geometry helpers used by both the collision code and the map builder
   -------------------------------------------------------------------- */

/* Which side of the line (ax,ay)->(bx,by) does (px,py) fall on?
   > 0 is left of the direction of travel, < 0 is right, 0 is on it.
   Doom calls this the "side" of a linedef and so does everything here. */
export const cross2 = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);

/* Closest point to (px,py) on the SEGMENT ab, and how far along it is.
   Returns [x, y, t] with t clamped into 0..1, so it is the segment and
   not the infinite line — which matters at corners, where the nearest
   thing to you is an endpoint rather than a face. */
export function closestOnSeg(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return [ax, ay, 0];
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [ax + dx * t, ay + dy * t, t];
}

/* Do segments ab and cd cross? Returns the fraction along ab, or -1.
   This is the line-of-sight test: walk the segment from the monster's eye
   to yours and see whether anything opaque got in the way. */
export function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const r1 = bx - ax, r2 = by - ay;
  const s1 = dx - cx, s2 = dy - cy;
  const den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-9) return -1;            // parallel
  const t = ((cx - ax) * s2 - (cy - ay) * s1) / den;
  const u = ((cx - ax) * r2 - (cy - ay) * r1) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return -1;
  return t;
}

/* Is (px,py) inside the polygon? Even-odd crossing count. Used to work out
   which sector a thing was dropped in when the map author did not say. */
export function pointInPoly(pts, px, py) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* Signed area, doubled. Positive means the ring runs counter-clockwise.
   The map builder uses the sign to decide which way a floor polygon faces
   so that no sector is accidentally laid face-down. */
export function polyArea2(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a;
}
