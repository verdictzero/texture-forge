/* =====================================================================
   SELLWRONG — the palette, and the light that falls off in bands
   =====================================================================

   Two things make a 1993 shooter look like a 1993 shooter, and neither
   of them is the polygon count.

   THE PALETTE. 256 colours and no more, so every surface in the store is
   drawn out of the same small box of crayons and the whole thing hangs
   together whether or not any individual texture is any good. Colours
   that are not in the box get snapped to the nearest one that is, and
   that snapping is what puts the faint banding into a gradient that says
   "this is old" more loudly than any amount of noise.

   These are ramps, not somebody's curated palette. A palette is a piece
   of work with a person's name on it; a ramp is arithmetic. So this file
   generates its 256 out of fourteen ramps and owes nobody anything.

   A ramp is three colours, not two. Interpolating a light brown straight
   down to black gives you a dead grey-brown that no real material does —
   real shadow keeps some hue and usually cools off on the way down. So
   every ramp is dark → mid → light with the mid off the straight line,
   and the bend in the middle is where the material actually lives.

   THE LIGHT. Doom did not multiply a surface by a light level; it picked
   one of 32 pre-darkened copies of the palette. Which means light falls
   off in visible STEPS. Walking down a dark aisle, the wall ahead does
   not fade smoothly — it drops a band at a time. That stepping is half
   the atmosphere, and smooth lighting throws it away for nothing, so the
   material shader below quantises light to 32 levels before it uses it.
   ===================================================================== */

/* --------------------------------------------------------------------
   The ramps

   A ramp is a list of STOPS — a position along the ramp and the colour
   that sits there — and the entries between them are interpolated. Two
   stops would be a straight line through RGB space, and a straight line
   through RGB space is exactly what no real material does: interpolate
   a light brown down to black and you get a dead grey-brown halfway that
   looks like nothing. Real shadow keeps its hue and usually cools on the
   way down, so most ramps here have a third stop in the middle placed
   deliberately off that line, and that bend is where the material lives.

   Fire gets seven stops, because fire is not a bend, it is a whole route:
   black to dark red to blood to ember to orange to yellow to white heat,
   and every one of those transitions is somewhere the eye will look. It
   is also the biggest ramp in the palette at 44 entries. That is not
   generosity, it is the point of the game — the store burning down is
   the only thing anybody is going to look at closely, and a flame that
   bands badly ruins the whole effect.

   gamma  bends how the entries are DISTRIBUTED along the ramp, as
          opposed to where the stops are. Above 1 spends more of the
          available entries down in the dark end, which is where the eye
          has the most resolution and where linear spacing wastes half a
          ramp on highlights nobody can tell apart.
   ------------------------------------------------------------------ */
const RAMPS = [
  /* greys — concrete, steel, shadow. Cool at the bottom, because a shadow
     full of skylight is blue and a shadow full of nothing is still not
     brown. */
  { key:'grey',   n:32, gamma:1.30, stops:[[0,[6,7,11]],[0.5,[92,94,102]],[1,[248,248,252]]] },
  /* bone — lino, ceiling tile, painted breeze block */
  { key:'bone',   n:16, gamma:1.25, stops:[[0,[22,20,17]],[0.5,[130,124,108]],[1,[244,238,216]]] },
  /* brown — cardboard, shelf backing, particle board */
  { key:'brown',  n:16, gamma:1.20, stops:[[0,[18,12,8]],[0.5,[104,68,40]],[1,[214,168,116]]] },
  /* red — blood, and the SellWrong corporate red, which is the same
     colour, which is the joke */
  { key:'red',    n:16, gamma:1.20, stops:[[0,[16,4,4]],[0.5,[136,22,20]],[1,[248,116,96]]] },
  /* flesh — what is left of the staff */
  { key:'flesh',  n:16, gamma:1.20, stops:[[0,[20,12,12]],[0.5,[130,92,76]],[1,[240,206,180]]] },
  /* green — the uniform polo, and produce */
  { key:'green',  n:16, gamma:1.20, stops:[[0,[6,14,8]],[0.5,[52,104,52]],[1,[168,228,150]]] },
  /* olive — the uniform after a week, and old lettuce */
  { key:'olive',  n:16, gamma:1.20, stops:[[0,[14,14,8]],[0.5,[90,88,44]],[1,[204,200,140]]] },
  /* blue — freezer glow, cold cases, the signage */
  { key:'blue',   n:16, gamma:1.25, stops:[[0,[4,6,18]],[0.5,[40,60,132]],[1,[152,184,248]]] },
  /* cyan — frost, and the light coming off the ice */
  { key:'cyan',   n:12, gamma:1.20, stops:[[0,[6,16,18]],[0.5,[60,132,140]],[1,[188,248,252]]] },
  /* yellow — hazard tape, price tags, SALE */
  { key:'yellow', n:16, gamma:1.15, stops:[[0,[20,16,4]],[0.5,[168,144,24]],[1,[252,248,140]]] },
  /* rust — trolleys, shelf uprights, the dock door */
  { key:'rust',   n:16, gamma:1.20, stops:[[0,[16,9,6]],[0.5,[118,62,30]],[1,[224,150,92]]] },
  /* purple — the neon over the deli, and bruises */
  { key:'purple', n:12, gamma:1.20, stops:[[0,[12,6,16]],[0.5,[80,44,108]],[1,[204,164,240]]] },
  /* pink — the meat counter, which is worse than the blood */
  { key:'pink',   n:12, gamma:1.20, stops:[[0,[22,10,12]],[0.5,[164,84,92]],[1,[252,196,196]]] },
  /* FIRE. Seven stops and 44 entries, spaced by hand. The stops are
     bunched toward the bottom because most of a flame, most of the time,
     is the dull end — the white heat is a few pixels at the base of it. */
  { key:'fire',   n:44, gamma:1.0, stops:[
      [0.00,[  0,  0,  0]],
      [0.10,[ 34,  0,  0]],
      [0.24,[ 96,  6,  0]],
      [0.40,[168, 26,  0]],
      [0.56,[226, 74,  6]],
      [0.72,[248, 142, 14]],
      [0.87,[252, 216, 62]],
      [1.00,[255, 255, 226]] ] },
];

/* Where each ramp starts, filled in as we build */
export const RAMP = {};

function rampColors(spec) {
  const { n, stops } = spec;
  const gamma = spec.gamma ?? 1.0;
  const out = [];
  for (let i = 0; i < n; i++) {
    /* gamma bends the DISTRIBUTION; the stops decide the route */
    const t = Math.pow(i / (n - 1), gamma === 1 ? 1 : 1 / gamma);
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [p0, c0] = stops[k], [p1, c1] = stops[k + 1];
    const span = Math.max(1e-6, p1 - p0);
    const f = Math.max(0, Math.min(1, (t - p0) / span));
    /* smoothstep between stops, so a stop is a place the ramp passes
       through smoothly rather than a kink you can see */
    const s = f * f * (3 - 2 * f);
    out.push([0, 1, 2].map(j => Math.max(0, Math.min(255, Math.round(c0[j] + (c1[j] - c0[j]) * s)))));
  }
  return out;
}

/* ---- build the 256 ---- */
export const PALETTE = (() => {
  const pal = [];
  for (const r of RAMPS) {
    RAMP[r.key] = { start: pal.length, n: r.n };
    for (const c of rampColors(r)) pal.push(c);
  }
  /* Whatever is left over becomes pure saturated markers — useful when a
     placeholder needs to SCREAM that it is a placeholder. */
  const markers = [[255,0,255],[0,255,255],[255,255,0],[255,0,0],[0,255,0],[0,0,255],[255,128,0],[128,0,255]];
  let m = 0;
  while (pal.length < 256) pal.push(markers[m++ % markers.length].slice());
  return pal.slice(0, 256);
})();

/* Pick a colour out of a named ramp with a 0..1 position. Every texture and
   every sprite in the game asks for its colours this way, which is what
   keeps them looking like they came out of the same box. */
export function ramp(key, t) {
  const r = RAMP[key];
  const i = Math.max(0, Math.min(r.n - 1, Math.round(t * (r.n - 1))));
  return PALETTE[r.start + i];
}
export function rampCss(key, t) { const c = ramp(key, t); return `rgb(${c[0]},${c[1]},${c[2]})`; }
export function rampIndex(key, t) {
  const r = RAMP[key];
  return r.start + Math.max(0, Math.min(r.n - 1, Math.round(t * (r.n - 1))));
}

/* --------------------------------------------------------------------
   The lookup cube

   Snapping a colour to the palette means finding the nearest of 256, and
   doing that per pixel per frame on the CPU is out of the question. So we
   do it once, up front, for every colour there is — at 32 levels per
   channel, which is 32768 cells — and hand the result to the GPU as a 3D
   texture. After that a palette snap is one texture fetch.

   32 levels is the right size. At 16 the cube itself starts quantising
   before the palette gets a chance to, and you can see it. At 64 the
   build takes eight times as long to produce a result nobody can tell
   apart from 32.

   Distance is weighted 3:6:1 across R:G:B — the eye's own weighting.
   Plain RGB distance picks green when it should pick grey and gives the
   whole image a faint sickly cast.
   ------------------------------------------------------------------ */
export const LUT_SIZE = 32;

/* Laid out as a 2D atlas rather than a real 3D texture: 32 slices of
   32x32 side by side, so 1024x32. A genuine sampler3D would be tidier,
   but this works on anything that can draw a triangle, needs no WebGL2
   feature check, and the indexing is three lines of shader either way.

   Slice = blue. Within a slice, x = red and y = green. */
export function buildLutAtlas(palette = PALETTE) {
  const N = LUT_SIZE, W = N * N, H = N;
  const data = new Uint8Array(W * H * 4);
  const pr = new Float64Array(256), pg = new Float64Array(256), pb = new Float64Array(256);
  for (let i = 0; i < 256; i++) { pr[i] = palette[i][0]; pg[i] = palette[i][1]; pb[i] = palette[i][2]; }

  for (let g = 0; g < N; g++) {
    const gv = (g * 255) / (N - 1);
    for (let b = 0; b < N; b++) {
      const bv = (b * 255) / (N - 1);
      for (let r = 0; r < N; r++) {
        const rv = (r * 255) / (N - 1);
        let best = 0, bestD = Infinity;
        for (let i = 0; i < 256; i++) {
          const dr = rv - pr[i], dg = gv - pg[i], db = bv - pb[i];
          const d = 3 * dr * dr + 6 * dg * dg + db * db;
          if (d < bestD) { bestD = d; best = i; }
        }
        const o = ((g * W) + (b * N + r)) * 4;
        data[o]     = palette[best][0];
        data[o + 1] = palette[best][1];
        data[o + 2] = palette[best][2];
        data[o + 3] = 255;
      }
    }
  }
  return { data, width: W, height: H };
}

/* --------------------------------------------------------------------
   Nearest palette entry, on the CPU

   The texture bakery needs this: it draws with the 2D canvas API, which
   antialiases and blends and generally produces colours that are not in
   the palette, and then every texture gets swept through here so that
   what ends up on the wall is genuinely 256-colour art rather than a
   truecolour image that merely looks like one.
   ------------------------------------------------------------------ */
const _snapCache = new Int16Array(1 << 15).fill(-1);   // keyed on rgb555

export function nearestIndex(r, g, b) {
  const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  const hit = _snapCache[key];
  if (hit >= 0) return hit;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < 256; i++) {
    const p = PALETTE[i];
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const d = 3 * dr * dr + 6 * dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  _snapCache[key] = best;
  return best;
}

/* Snap an ImageData in place. Alpha is left alone — it is a cut-out mask,
   not a colour, and rounding it turns a sprite's edge to lace.

   The optional ordered dither is a 4x4 Bayer matrix nudging each pixel a
   little up or down before the snap, which trades a hard band for a fine
   checker. On a 64px texture seen from two metres that reads as texture;
   on a sprite it reads as dirt. Both are what we want. */
const BAYER4 = [
   0,  8,  2, 10,
  12,  4, 14,  6,
   3, 11,  1,  9,
  15,  7, 13,  5,
];

export function snapImageData(img, dither = 0) {
  const d = img.data, w = img.width;
  for (let i = 0, px = 0; i < d.length; i += 4, px++) {
    if (d[i + 3] < 8) { d[i + 3] = 0; continue; }        // transparent stays transparent
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (dither > 0) {
      const x = px % w, y = (px / w) | 0;
      const t = (BAYER4[(y & 3) * 4 + (x & 3)] / 15 - 0.5) * dither;
      r = Math.max(0, Math.min(255, r + t));
      g = Math.max(0, Math.min(255, g + t));
      b = Math.max(0, Math.min(255, b + t));
    }
    const p = PALETTE[nearestIndex(r | 0, g | 0, b | 0)];
    d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
    d[i + 3] = 255;                                       // no partial alpha, ever
  }
  return img;
}
