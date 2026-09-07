/* =====================================================================
   SELLWRONG — every surface in the store, at 64 pixels
   =====================================================================

   Sixty-four pixels is not a limitation here, it is the brief. At one
   texel to one world unit a 64-pixel texture is a 64-unit wall, the
   player is 32 across and can see about eight texels of detail on a wall
   he is standing next to, and every decision about what to draw is
   really a decision about what to LEAVE OUT.

   What survives that cut, in every texture below:

     one big shape      the thing you read from across the store — the
                        shelf bands, the door panel, the corrugations
     one edge           a highlight on the top-left of it, shadow on the
                        bottom-right, always that way round
     dirt at the bottom  because that is where dirt is

   Anything finer than that is gone by the second repeat. A 64-pixel
   texture with six levels of detail in it reads, from two metres, as
   grey.

   THE STORE IS THE PALETTE'S ARGUMENT. Everything out front is bone,
   grey and that corporate red. Everything behind the swing doors is
   rust, brown and bare concrete — no branding, no paint, no pretence.
   The moment the player crosses from one to the other should be legible
   without a single sign, and it is done entirely by which ramps the
   textures on either side were allowed to draw from.
   ===================================================================== */

import * as THREE from 'three';
import { Pix, fbm, valueNoise, speckle, drawText, drawTextCentred, textWidth } from './pixel.js';
import { makeRng } from './util.js';
import { LOGO_TILES } from './art-data.js';
import { PALETTE } from './palette.js';

export class TextureBank {
  constructor() { this.map = new Map(); this.missing = new Set(); }

  add(name, pix, opts = {}) {
    const tex = new THREE.CanvasTexture(pix.toCanvas());
    tex.magFilter = THREE.NearestFilter;
    /* Chunky mipmaps: nearest WITHIN a level and nearest BETWEEN levels,
       so a floor seen edge-on stops boiling without ever going soft. A
       linear filter anywhere in that chain and the whole thing starts
       looking like a remaster. */
    tex.minFilter = THREE.NearestMipmapNearestFilter;
    tex.generateMipmaps = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.map.set(name, {
      name, texture: tex, pix,
      w: opts.w ?? pix.w,        // world units the texture spans
      h: opts.h ?? pix.h,
      masked: !!opts.masked,
    });
    return this.map.get(name);
  }

  get(name) {
    const e = this.map.get(name);
    if (e) return e;
    /* A missing texture should be loud, not invisible — a wall you can
       see through is a bug you will chase for an hour, and a magenta
       wall is a bug you fix in ten seconds. */
    if (!this.missing.has(name)) { this.missing.add(name); console.warn('missing texture:', name); }
    return this.map.get('MISSING');
  }
}

/* ====================================================================
   Shared moves

   The three or four things that go into nearly every texture, written
   once. Consistency in a generated set does not come from discipline, it
   comes from there being only one function that draws grime.
   ==================================================================== */

/** Aggregate: crushed stone of two or three grades sitting in a binder.
 *  Asphalt, concrete and terrazzo are all this with different numbers. */
function aggregate(p, seed, opts) {
  const { baseKey, baseLo, baseHi, grades } = opts;
  const n = fbm(p.w, p.h, 8, 3, seed);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      p.ink(x, y, baseKey, baseLo + n[y * p.w + x] * (baseHi - baseLo));

  for (const g of grades) {
    speckle(p.w, p.h, g.count, seed + g.count, (x, y, a, b) => {
      const r = g.min + a * (g.max - g.min);
      const t = g.lo + b * (g.hi - g.lo);
      if (r <= 0.75) { p.ink(x, y, g.key, t); return; }
      /* Stones bigger than a texel get a lit top-left and a shadowed
         bottom-right, because that is where the light is. */
      p.disc(x, y, r, g.key, t);
      p.ink(x - 1, y - 1, g.key, Math.min(1, t + 0.22));
      p.ink(x + 1, y + 1, g.key, Math.max(0, t - 0.25));
    });
  }
}

/** A crack that wanders. Wraps, because a crack that stops at the edge of
 *  the texture becomes a dotted line eight repeats later. */
function crack(p, x, y, len, key, t, seed, wander = 0.9) {
  const rng = makeRng(seed);
  let a = rng() * Math.PI * 2;
  for (let i = 0; i < len; i++) {
    p.ink(x, y, key, t);
    /* A branch now and then — real cracks fork, straight ones read as
       drawn-on scratches. */
    if (rng() < 0.05 && len > 12) crack(p, x, y, (len - i) >> 1, key, t, seed + i * 31, wander);
    a += (rng() - 0.5) * wander;
    x = Math.round(x + Math.cos(a));
    y = Math.round(y + Math.sin(a));
  }
}

/** Something wet ran down this wall and dried. */
function streaks(p, count, seed, key, t, strength = 0.4) {
  const rng = makeRng(seed);
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * p.w);
    const top = Math.floor(rng() * p.h * 0.5);
    const len = Math.floor(p.h * (0.3 + rng() * 0.7));
    const wide = rng() < 0.3 ? 2 : 1;
    for (let d = 0; d < len; d++) {
      const y = top + d;
      const fade = (1 - d / len) * strength * (0.5 + rng() * 0.5);
      for (let k = 0; k < wide; k++) p.wash(x + k, y, key, t, fade);
    }
  }
}

/* Diagonal hazard striping, tiling at 45 degrees. Wraps only when the
   stripe pitch divides the width, which for 64 and a pitch of 8 it does. */
function hazardStripes(p, pitch, keyA, tA, keyB, tB) {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const band = Math.floor(((x + y) % (pitch * 2)) / pitch);
      p.ink(x, y, band ? keyA : keyB, band ? tA : tB);
    }
}

/* ====================================================================
   The textures
   ==================================================================== */

const T = {};

/* ---------- outside: the car park ---------- */

T.ASPHALT = () => {
  const p = new Pix(64, 64, 11);
  /* Lighter than real tarmac, and deliberately. This was drawn at
     0.10-0.20 when the only asphalt in the game was a courtyard you
     stood in the middle of; across a car park the size of the one here
     it came out as a hole in the world with bay lines floating in it.
     A lit car park is a PALE surface at night — that is what the
     floodlights are for — and the darkest thing in the picture should be
     the store you are about to walk into. */
  aggregate(p, 11, {
    baseKey: 'grey', baseLo: 0.50, baseHi: 0.60,
    grades: [
      { count: 260, min: 0.4, max: 1.4, key: 'grey',  lo: 0.55, hi: 0.72 },
      { count: 90,  min: 0.6, max: 1.8, key: 'grey',  lo: 0.62, hi: 0.80 },
      { count: 40,  min: 0.4, max: 1.2, key: 'brown', lo: 0.46, hi: 0.62 },
    ],
  });
  crack(p, 12, 4, 70, 'grey', 0.30, 5);
  crack(p, 48, 40, 46, 'grey', 0.32, 9);
  /* Bitumen bleed — the shiny black patches where the binder came up */
  const n = valueNoise(64, 64, 4, 17);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
    if (n[y * 64 + x] > 0.72) p.wash(x, y, 'grey', 0.38, 0.5);
  return p.snap(0.6);
};

T.PARKLINE = () => {
  /* A whole flat of bay line, painted on thin sectors so the map decides
     where the bays go rather than the texture grid deciding for it.

     Paint does not wear off in continents, it wears off in GRAIN — the
     high spots of the asphalt polish through first and the line goes
     speckly long before it goes patchy. So the wear here is fine noise
     over a solid coat, with only a couple of genuinely bald patches, and
     a faint drag along the direction the tyres cross it. */
  const p = new Pix(64, 64, 12);
  const grain = fbm(64, 64, 32, 2, 31);     // per-texel, not per-region
  const patch = fbm(64, 64, 4, 2, 34);      // the few places it has gone

  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const g = grain[y * 64 + x];
      /* Bald only where the coarse field is really low AND the grain
         agrees — one condition alone gives blobs, both together gives
         ragged holes with speckled edges. */
      const bald = patch[y * 64 + x] < 0.34 && g < 0.56;
      if (bald) {
        p.ink(x, y, 'grey', 0.11 + g * 0.14);
      } else if (g < 0.40) {
        p.ink(x, y, 'bone', 0.40 + g * 0.5);     // polished through to the grit
      } else {
        p.ink(x, y, 'bone', 0.74 + g * 0.20);    // the paint itself
      }
    }
  }
  /* the asphalt showing through the pinholes */
  speckle(64, 64, 420, 35, (x, y, a2, b2) => {
    if (a2 > 0.42) p.wash(x, y, 'grey', 0.13, 0.30 + b2 * 0.45);
  });
  /* scuffing across the line, the way everyone drives over it */
  const rng = makeRng(36);
  for (let i = 0; i < 7; i++) {
    const y = Math.floor(rng() * 64);
    for (let x = 0; x < 64; x++) if (rng() < 0.55) p.wash(x, y, 'grey', 0.16, 0.35);
  }
  return p.snap(0.55);
};

T.KERB = () => {
  /* 64 wide, 16 tall — the lower texture on the kerb line. Precast units
     with a joint every 32, chipped where cars have kissed it. */
  const p = new Pix(64, 16, 13);
  aggregate(p, 13, { baseKey: 'bone', baseLo: 0.34, baseHi: 0.48,
    grades: [{ count: 90, min: 0.4, max: 1.1, key: 'bone', lo: 0.24, hi: 0.58 },
             { count: 30, min: 0.4, max: 0.9, key: 'grey', lo: 0.28, hi: 0.42 }] });
  for (const jx of [0, 32]) { p.vline(jx, 0, 15, 'bone', 0.16); p.vline(jx + 1, 0, 15, 'bone', 0.52); }
  p.hline(0, 63, 0, 'bone', 0.66);            // the lit top arris
  p.hline(0, 63, 15, 'grey', 0.10);
  const rng = makeRng(77);
  for (let i = 0; i < 5; i++) {               // chips
    const x = Math.floor(rng() * 64), w = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < w; k++) { p.ink(x + k, 0, 'bone', 0.22); p.ink(x + k, 1, 'bone', 0.3); }
  }
  p.grime(0.5, 'grey', 0.08, 4);
  return p.snap(0.5);
};

T.CONCRETE = () => {
  const p = new Pix(64, 64, 14);
  aggregate(p, 14, { baseKey: 'bone', baseLo: 0.30, baseHi: 0.44,
    grades: [{ count: 200, min: 0.4, max: 1.0, key: 'bone', lo: 0.22, hi: 0.52 },
             { count: 60,  min: 0.4, max: 1.2, key: 'grey', lo: 0.26, hi: 0.40 }] });
  /* Broom finish — the drag marks a float leaves, all one way */
  for (let y = 0; y < 64; y++) {
    const n = valueNoise(64, 1, 16, 200 + y);
    for (let x = 0; x < 64; x++) if (n[x] > 0.6) p.wash(x, y, 'bone', 0.24, 0.3);
  }
  for (const jy of [0, 32]) p.hline(0, 63, jy, 'bone', 0.15);   // control joints
  for (const jx of [0]) p.vline(jx, 0, 63, 'bone', 0.15);
  crack(p, 20, 34, 30, 'bone', 0.12, 21);
  p.grime(0.3, 'grey', 0.1, 6);
  return p.snap(0.5);
};

/* ---------- outside: the building ---------- */

T.STORWALL = () => {
  /* Insulated render panels with a control joint every 32. The whole
     front of every big box in the world. */
  const p = new Pix(64, 64, 21);
  const n = fbm(64, 64, 16, 3, 21);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
    p.ink(x, y, 'bone', 0.50 + n[y * 64 + x] * 0.14);
  const height = new Float32Array(64 * 64).fill(0.5);
  for (const jy of [0, 32]) for (let x = 0; x < 64; x++) {
    height[jy * 64 + x] = 0.1;
    height[((jy + 1) % 64) * 64 + x] = 0.35;
  }
  for (const jx of [0]) for (let y = 0; y < 64; y++) {
    height[y * 64 + jx] = 0.1;
    height[y * 64 + ((jx + 1) % 64)] = 0.35;
  }
  p.emboss(height, 0.5, 1.0);
  streaks(p, 7, 44, 'grey', 0.14, 0.3);          // runoff below the joints
  p.grime(0.35, 'grey', 0.12, 8);
  return p.snap(0.6);
};

T.STORBASE = () => {
  /* The plinth: 64x32 of blockwork the trolleys have been hitting since
     it opened. */
  const p = new Pix(64, 32, 22);
  aggregate(p, 22, { baseKey: 'grey', baseLo: 0.40, baseHi: 0.50,
    grades: [{ count: 120, min: 0.4, max: 1.0, key: 'grey', lo: 0.34, hi: 0.56 }] });
  for (const jy of [0, 16]) p.hline(0, 63, jy, 'grey', 0.24);
  for (let y = 0; y < 32; y += 16)
    for (let x = (y % 32 ? 0 : 32); x < 64 + 32; x += 64) p.vline(x % 64, y, y + 15, 'grey', 0.24);
  p.grime(0.6, 'grey', 0.16, 9);
  return p.snap(0.5);
};

T.BRANDBAND = () => {
  /* The sign band, and the only place in the game the store says its own
     name. It says it in the same red as the blood.

     Drawn at 64x64 and declared 96 tall, so one repeat is exactly the
     fascia and the name sits where a name sits. It repeats sideways
     about sixty times across the front of the anchor, which is not a
     compromise — it is what a supermarket fascia does. */
  const p = new Pix(64, 64, 23);
  const n = fbm(64, 64, 8, 2, 23);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
    p.ink(x, y, 'red', 0.44 + n[y * 64 + x] * 0.12);
  /* the tray: a returned edge top and bottom, catching the canopy light */
  for (let y = 0; y < 4; y++) for (let x = 0; x < 64; x++) p.ink(x, y, 'red', y < 2 ? 0.66 : 0.54);
  for (let y = 58; y < 64; y++) for (let x = 0; x < 64; x++) p.ink(x, y, 'red', y > 61 ? 0.14 : 0.24);
  drawTextCentred(p, 'SELLWRONG', 32, 24, 'bone', 0.96);
  p.hline(6, 57, 36, 'bone', 0.34);
  drawTextCentred(p, 'SUPERSTORE', 32, 42, 'bone', 0.52);
  /* Half the letters have failed, which is the point of the place */
  const rng = makeRng(91);
  for (let i = 0; i < 46; i++) {
    const x = Math.floor(rng() * 64), y = 23 + Math.floor(rng() * 9);
    if (rng() < 0.5) p.ink(x, y, 'red', 0.30);
  }
  p.grime(0.4, 'grey', 0.10, 10);
  return p.snap(0.5);
};

T.STORGLAS = () => {
  /* Shopfront glazing. Dark, because you are outside looking in and the
     lights are off in half the store. */
  const p = new Pix(64, 64, 24);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const sheen = Math.max(0, 1 - Math.abs((x + y * 0.4) % 42 - 8) / 14);
    p.ink(x, y, 'blue', 0.16 + sheen * 0.20 + (y / 64) * 0.06);
  }
  /* Mullions: a vertical every 32, a transom near the top */
  for (const mx of [0, 32]) { p.vline(mx, 0, 63, 'grey', 0.42); p.vline(mx + 1, 0, 63, 'grey', 0.20); }
  p.hline(0, 63, 8, 'grey', 0.42); p.hline(0, 63, 9, 'grey', 0.20);
  p.hline(0, 63, 62, 'grey', 0.34); p.hline(0, 63, 63, 'grey', 0.16);
  /* No cracks here. There WERE three broken panes drawn into this, from
     when the glazed run across the front was twelve hundred units long;
     at nearly four thousand the same three panes repeat sixty times and
     the whole shopfront reads as wallpaper. Damage that is supposed to
     be an event cannot live in a tiling texture — it lives on UNITSHUT,
     where it is graffiti and repeating is the point. */
  for (let y = 40; y < 64; y++) for (let x = 0; x < 64; x++)   // stall riser
    p.ink(x, y, 'grey', 0.17 + ((x >> 4) & 1) * 0.02);
  p.hline(0, 63, 39, 'grey', 0.40); p.hline(0, 63, 40, 'grey', 0.20);
  /* what is behind it: the tops of the aisle runs, out of focus */
  const rng = makeRng(55);
  for (let i = 0; i < 20; i++) {
    const x = Math.floor(rng() * 64), w = 2 + Math.floor(rng() * 5);
    const top = 22 + Math.floor(rng() * 10);
    for (let y = top; y < 39; y++)
      for (let xx = x; xx < x + w; xx++) p.ink(xx % 64, y, 'grey', 0.10 + rng() * 0.06);
  }
  return p.snap(0.4);
};

/* ---------- inside: the floor and the lid ---------- */

T.LINO = () => {
  /* Vinyl composition tile, 32 to a side, the speckle running right
     through it. Every supermarket on earth. */
  const p = new Pix(64, 64, 31);
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
    /* Alternating tiles a shade apart — you only see it under the
       strip lights, which is exactly when you do see it */
    const base = (tx + ty) % 2 ? 0.60 : 0.55;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) p.ink(tx * 32 + x, ty * 32 + y, 'bone', base);
  }
  speckle(64, 64, 900, 31, (x, y, a, b) => {
    if (a < 0.55) p.ink(x, y, 'bone', 0.42 + b * 0.16);
    else if (a < 0.85) p.ink(x, y, 'bone', 0.70 + b * 0.16);
    else p.ink(x, y, 'grey', 0.30 + b * 0.2);
  });
  for (const j of [0, 32]) { p.hline(0, 63, j, 'bone', 0.34); p.vline(j, 0, 63, 'bone', 0.34); }
  /* Buffed lanes: the polished tracks worn where everyone walks */
  const n = valueNoise(64, 64, 3, 66);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
    if (n[y * 64 + x] > 0.62) p.wash(x, y, 'bone', 0.82, 0.18);
  return p.snap(0.7);
};

T.LINOWORN = () => {
  const p = T.LINO();
  p.grime(0.7, 'olive', 0.16, 12);
  crack(p, 30, 12, 40, 'grey', 0.14, 8, 1.2);
  const rng = makeRng(101);
  for (let i = 0; i < 6; i++) {           // missing tiles, screed showing
    const x = Math.floor(rng() * 60), y = Math.floor(rng() * 60), w = 3 + Math.floor(rng() * 6);
    for (let dy = 0; dy < w; dy++) for (let dx = 0; dx < w; dx++) p.ink(x + dx, y + dy, 'grey', 0.16 + rng() * 0.06);
  }
  return p.snap(0.6);
};

T.CEILTILE = () => {
  /* Mineral fibre in a tee grid — 64 is one tile plus its grid. The
     perforations are what make it read as ceiling rather than as wall. */
  const p = new Pix(64, 64, 41);
  const n = fbm(64, 64, 16, 2, 41);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
    p.ink(x, y, 'bone', 0.62 + n[y * 64 + x] * 0.10);
  speckle(64, 64, 700, 41, (x, y, a) => { if (a > 0.4) p.ink(x, y, 'bone', 0.50); });
  /* the grid */
  for (const j of [0, 1]) { p.hline(0, 63, j, 'grey', j ? 0.30 : 0.46); p.vline(j, 0, 63, 'grey', j ? 0.30 : 0.46); }
  /* Water damage. There is always water damage. */
  const st = valueNoise(64, 64, 3, 42);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = st[y * 64 + x];
    if (v > 0.66) p.wash(x, y, 'olive', 0.34, (v - 0.66) * 2.4);
  }
  return p.snap(0.5);
};

/* --------------------------------------------------------------------
   A ceiling with fittings in it

   A suspended ceiling is a grid of tiles with a fluorescent fitting every
   so often — and "every so often" is the whole problem, because a
   64-pixel texture that tiles every 64 units would put a fitting in
   every single tile.

   So this one is declared as 256 units square: one texture is a 4x4
   block of ceiling tiles with a single twin fitting in it, and the
   fittings land every 256 units instead of every 64. A texel is four
   units instead of one, which is nothing on a surface three metres over
   your head that is never seen square on.

   THE TEXTURE ONLY DRAWS THE HOUSING. The light itself is a separate
   object hanging in that housing — because a light you can shoot out is
   worth ten you cannot, and a lamp painted into the ceiling can never be
   anything but painted. The recess here is dark and stays dark; what
   makes it look lit is the thing hanging in it, and when that thing
   bursts the recess is what is left.

   The fitting is centred in the texture on purpose. Flats are aligned to
   the world grid and the vertical axis is flipped on upload, so anything
   NOT centred lands somewhere different from where it looks like it
   should, and the lamps hung in world space would miss their holes.
   ------------------------------------------------------------------ */
T.CEILFIT = () => {
  const p = new Pix(64, 64, 44);

  const n = fbm(64, 64, 16, 2, 44);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++)
      p.ink(x, y, 'bone', 0.58 + n[y * 64 + x] * 0.10);
  speckle(64, 64, 500, 45, (x, y, a) => { if (a > 0.45) p.ink(x, y, 'bone', 0.48); });

  /* the tee grid: a line every 16 texels, which is every 64 world units,
     which is one ceiling tile */
  for (let g = 0; g < 64; g += 16) {
    p.hline(0, 63, g, 'grey', 0.40); p.vline(g, 0, 63, 'grey', 0.40);
    p.hline(0, 63, g + 1, 'grey', 0.26); p.vline(g + 1, 0, 63, 'grey', 0.26);
  }

  /* water damage, which there always is */
  const st = valueNoise(64, 64, 3, 46);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const v = st[y * 64 + x];
      if (v > 0.62) p.wash(x, y, 'olive', 0.32, (v - 0.62) * 2.0);
    }

  /* the housing: a dark recess with the reflector visible in it, dead
     centre of the texture so the hung lamps line up with it */
  const x0 = 18, y0 = 26, w = 28, h = 12;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const edge = (y === y0 || y === y0 + h - 1) ? 0.10 : 0;
      p.ink(x, y, 'grey', 0.13 + edge);
    }
  /* the specular strip off the reflector, so the recess reads as metal
     rather than as a hole */
  p.hline(x0 + 2, x0 + w - 3, y0 + 2, 'grey', 0.30);
  p.hline(x0 + 2, x0 + w - 3, y0 + h - 3, 'grey', 0.24);
  p.frame(x0 - 1, y0 - 1, w + 2, h + 2, 'grey', 0.46);
  p.frame(x0 - 2, y0 - 2, w + 4, h + 4, 'grey', 0.22);
  return p.snap(0.5);
};

T.CEILDECK = () => {
  /* Back of house has no ceiling tiles. You look straight up at profiled
     metal deck with the purlins crossing under it, and everything up
     there is filthy because nobody has ever been up there. */
  const p = new Pix(64, 64, 42);
  const height = new Float32Array(64 * 64);
  const n = fbm(64, 64, 12, 2, 43);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      /* the deck profile: a trough, a lit rise, a flat crown */
      const r = x % 16;
      let t, hgt;
      if (r < 2)       { t = 0.09; hgt = 0.05; }
      else if (r < 4)  { t = 0.30; hgt = 0.85; }
      else if (r < 12) { t = 0.21; hgt = 0.60; }
      else if (r < 14) { t = 0.14; hgt = 0.30; }
      else             { t = 0.10; hgt = 0.10; }
      p.ink(x, y, 'grey', t + n[y * 64 + x] * 0.05);
      height[y * 64 + x] = hgt;
    }
  }
  /* the purlin running across, in front of everything */
  for (let y = 28; y < 36; y++) {
    for (let x = 0; x < 64; x++) {
      const t = y < 30 ? 0.34 : y < 34 ? 0.22 : 0.10;
      p.ink(x, y, 'grey', t);
      height[y * 64 + x] = y < 30 ? 0.95 : 0.75;
    }
  }
  for (let x = 6; x < 64; x += 16) { p.ink(x, 31, 'rust', 0.34); p.ink(x, 32, 'rust', 0.22); }  // bolts
  p.emboss(height, 0.34, 1.0);
  const rng = makeRng(44);
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(rng() * 64), y = Math.floor(rng() * 64);
    p.wash(x, y, 'rust', 0.18, 0.3 + rng() * 0.4);
  }
  p.grime(0.45, 'grey', 0.05, 13);
  return p.snap(0.4);
};

/* ---------- inside: walls ---------- */

T.WALLPANL = () => {
  const p = new Pix(64, 64, 51);
  const n = fbm(64, 64, 12, 3, 51);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
    p.ink(x, y, 'bone', 0.58 + n[y * 64 + x] * 0.12);
  p.hline(0, 63, 0, 'bone', 0.40);
  p.grime(0.45, 'grey', 0.1, 14);
  streaks(p, 4, 52, 'grey', 0.16, 0.25);
  return p.snap(0.6);
};

T.TILEWALL = () => {
  /* 8-pixel tiles with grout. The staff corridor and the toilets. */
  const p = new Pix(64, 64, 53);
  const height = new Float32Array(64 * 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const gx = x % 8, gy = y % 8;
    const grout = gx === 0 || gy === 0;
    height[y * 64 + x] = grout ? 0.2 : 0.7;
    if (grout) p.ink(x, y, 'olive', 0.22);
    else {
      const v = valueNoise(1, 1, 1, x * 131 + y * 17)[0];
      p.ink(x, y, 'bone', 0.72 + v * 0.10);
    }
  }
  p.emboss(height, 0.4, 1.0);
  p.grime(0.55, 'olive', 0.14, 15);
  return p.snap(0.5);
};

T.STOCKWAL = () => {
  /* Painted breeze block, 32x16 units, back of house. Unpainted below
     where the pallet trucks live. */
  const p = new Pix(64, 64, 54);
  const height = new Float32Array(64 * 64);
  const n = fbm(64, 64, 16, 3, 54);
  for (let y = 0; y < 64; y++) {
    const row = Math.floor(y / 16);
    for (let x = 0; x < 64; x++) {
      const off = (row % 2) * 16;
      const bx = (x + off) % 32, by = y % 16;
      const mortar = bx < 2 || by < 2;
      height[y * 64 + x] = mortar ? 0.25 : 0.72;
      p.ink(x, y, mortar ? 'grey' : 'bone', mortar ? 0.22 : (0.40 + n[y * 64 + x] * 0.14));
    }
  }
  p.emboss(height, 0.42, 1.0);
  p.grime(0.6, 'rust', 0.14, 16);
  return p.snap(0.6);
};

T.HAZARD = () => {
  const p = new Pix(64, 64, 61);
  hazardStripes(p, 8, 'yellow', 0.72, 'grey', 0.08);
  const n = fbm(64, 64, 8, 2, 62);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
    if (n[y * 64 + x] > 0.58) p.wash(x, y, 'grey', 0.14, 0.4);   // scuffed off
  return p.snap(0.5);
};

/* ---------- the fixtures: the reason anyone is here ---------- */

T.SHELFSTK = () => {
  /* A gondola full of stock, side on. Four shelves in 64, and each one is
     a row of little coloured boxes. This is the single most important
     texture in the game: it is what an aisle IS.

     The stock is drawn from every ramp at once on purpose. Everything
     else in the store is bone and grey; the shelves are the only colour
     in the room, which is exactly the trick a real supermarket pulls. */
  const p = new Pix(64, 64, 71);
  p.fill('grey', 0.16);
  const stockKeys = ['red', 'blue', 'green', 'yellow', 'olive', 'purple', 'cyan', 'pink', 'rust', 'brown'];
  const rng = makeRng(71);

  for (let shelf = 0; shelf < 4; shelf++) {
    const top = shelf * 16;
    /* the shelf pan itself: a lit lip and the shadow it throws */
    p.hline(0, 63, top + 14, 'grey', 0.52);
    p.hline(0, 63, top + 15, 'grey', 0.10);
    /* products, packed left to right in random widths */
    let x = Math.floor(rng() * 6);
    while (x < 64) {
      const w = 3 + Math.floor(rng() * 5);
      const hgt = 8 + Math.floor(rng() * 5);
      const key = stockKeys[Math.floor(rng() * stockKeys.length)];
      const t = 0.35 + rng() * 0.4;
      const y0 = top + 14 - hgt;
      for (let yy = 0; yy < hgt; yy++)
        for (let xx = 0; xx < w; xx++)
          p.ink(x + xx, y0 + yy, key, t);
      /* the lit top-left edge and a label band across it */
      p.hline(x, x + w - 1, y0, key, Math.min(1, t + 0.28));
      p.vline(x, y0, y0 + hgt - 1, key, Math.min(1, t + 0.18));
      p.vline(x + w - 1, y0, y0 + hgt - 1, key, Math.max(0, t - 0.22));
      if (w >= 5 && hgt >= 9) p.hline(x + 1, x + w - 2, y0 + 3, 'bone', 0.82);
      x += w + (rng() < 0.14 ? 1 + Math.floor(rng() * 2) : 0);   // occasional gap
    }
    /* the shelf-edge price rail */
    p.hline(0, 63, top + 15, 'yellow', 0.62);
    for (let x2 = 1; x2 < 64; x2 += 9) p.ink(x2, top + 15, 'grey', 0.1);
  }
  p.grime(0.3, 'grey', 0.1, 17);
  return p.snap(0.4);
};

T.SHELFEMP = () => {
  /* The same gondola after the panic buying. Perforated back panel,
     bare shelf pans, a couple of survivors. */
  const p = new Pix(64, 64, 72);
  p.fill('grey', 0.26);
  for (let y = 2; y < 64; y += 4) for (let x = 2; x < 64; x += 4) p.ink(x, y, 'grey', 0.12);
  const rng = makeRng(72);
  for (let shelf = 0; shelf < 4; shelf++) {
    const top = shelf * 16;
    p.hline(0, 63, top + 14, 'grey', 0.48);
    p.hline(0, 63, top + 15, 'grey', 0.08);
    p.hline(0, 63, top + 15, 'yellow', 0.5);
    for (let i = 0; i < 2; i++) {
      if (rng() < 0.45) continue;
      const x = Math.floor(rng() * 56), w = 3 + Math.floor(rng() * 4), hgt = 7 + Math.floor(rng() * 4);
      const key = ['red', 'blue', 'olive'][Math.floor(rng() * 3)];
      const t = 0.3 + rng() * 0.3, y0 = top + 14 - hgt;
      for (let yy = 0; yy < hgt; yy++) for (let xx = 0; xx < w; xx++) p.ink(x + xx, y0 + yy, key, t);
      p.hline(x, x + w - 1, y0, key, Math.min(1, t + 0.25));
    }
  }
  p.grime(0.5, 'grey', 0.08, 18);
  return p.snap(0.4);
};

T.SHELFBAK = () => {
  /* Back-to-back gondolas: what you see is the perforated steel. */
  const p = new Pix(64, 64, 73);
  const n = fbm(64, 64, 8, 2, 73);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
    p.ink(x, y, 'grey', 0.28 + n[y * 64 + x] * 0.08);
  for (let y = 2; y < 64; y += 4) for (let x = 2; x < 64; x += 4) {
    p.ink(x, y, 'grey', 0.12);
    p.ink(x, y - 1, 'grey', 0.40);
  }
  /* uprights every 32 */
  for (const ux of [0, 32]) {
    for (let y = 0; y < 64; y++) { p.ink(ux, y, 'grey', 0.42); p.ink(ux + 1, y, 'grey', 0.20); }
    for (let y = 3; y < 64; y += 5) p.ink(ux, y, 'grey', 0.10);   // slot punchings
  }
  p.grime(0.4, 'rust', 0.16, 19);
  return p.snap(0.4);
};

T.SHELFEND = () => {
  /* The end cap: a promotional block and a screaming price. Where the
     margin is. */
  const p = new Pix(64, 64, 74);
  p.fill('grey', 0.18);
  const rng = makeRng(74);
  for (let y = 22; y < 62; y++) for (let x = 4; x < 60; x++) p.ink(x, y, 'red', 0.34 + rng() * 0.1);
  for (let y = 22; y < 62; y += 8) p.hline(4, 59, y, 'red', 0.20);
  for (let x = 4; x < 60; x += 8) p.vline(x, 22, 61, 'red', 0.20);
  p.hline(4, 59, 22, 'red', 0.58);
  p.vline(4, 22, 61, 'red', 0.5);
  /* the sign above it */
  for (let y = 4; y < 20; y++) for (let x = 2; x < 62; x++) p.ink(x, y, 'yellow', 0.72);
  p.frame(2, 4, 60, 16, 'yellow', 0.3);
  drawTextCentred(p, 'SALE', 32, 6, 'red', 0.28);
  drawTextCentred(p, '99P', 32, 13, 'red', 0.28);
  p.grime(0.25, 'grey', 0.1, 20);
  return p.snap(0.4);
};

T.FREEZDOR = () => {
  /* Glass freezer door: frame, frost, cold light, and the stock behind
     it going soft. */
  const p = new Pix(64, 64, 81);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    /* the goods, blurred by the glass into bands of colour */
    const shelf = Math.floor(y / 16);
    const band = valueNoise(1, 1, 1, shelf * 977 + Math.floor(x / 6) * 31)[0];
    const key = ['blue', 'cyan', 'bone', 'red'][Math.floor(band * 4) % 4];
    p.ink(x, y, key, 0.22 + band * 0.2);
  }
  for (let s = 0; s < 4; s++) { p.hline(0, 63, s * 16 + 15, 'grey', 0.34); p.hline(0, 63, s * 16, 'grey', 0.12); }
  /* frost creeping in from the frame */
  const fr = fbm(64, 64, 8, 3, 82);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const edge = Math.min(x, 63 - x, y, 63 - y) / 14;
    const f = Math.max(0, 1 - edge) * fr[y * 64 + x];
    if (f > 0.18) p.wash(x, y, 'cyan', 0.72, f);
  }
  /* the frame and the handle */
  for (const fx of [0, 1, 62, 63]) p.vline(fx, 0, 63, 'grey', fx < 2 ? 0.5 : 0.24);
  for (const fy of [0, 1, 62, 63]) p.hline(0, 63, fy, 'grey', fy < 2 ? 0.5 : 0.24);
  for (let y = 20; y < 44; y++) { p.ink(3, y, 'grey', 0.62); p.ink(4, y, 'grey', 0.3); }
  /* the specular streak down the glass */
  for (let y = 0; y < 64; y++) { const x = 46 - Math.floor(y * 0.12); p.wash(x, y, 'cyan', 0.9, 0.35); p.wash(x + 1, y, 'cyan', 0.9, 0.18); }
  return p.snap(0.4);
};

T.CHILLER = () => {
  /* Open multideck: the stuff nobody took, lit blue from within. */
  const p = new Pix(64, 64, 83);
  p.fill('grey', 0.14);
  const rng = makeRng(83);
  for (let s = 0; s < 4; s++) {
    const top = s * 16;
    for (let y = top + 2; y < top + 14; y++) for (let x = 0; x < 64; x++) p.ink(x, y, 'blue', 0.14);
    let x = 0;
    while (x < 64) {
      const w = 4 + Math.floor(rng() * 4);
      if (rng() > 0.28) {
        const key = ['pink', 'bone', 'red', 'olive'][Math.floor(rng() * 4)];
        const t = 0.3 + rng() * 0.35;
        for (let yy = top + 5; yy < top + 14; yy++) for (let xx = 0; xx < w - 1; xx++) p.ink(x + xx, yy, key, t);
        p.hline(x, x + w - 2, top + 5, key, Math.min(1, t + 0.25));
      }
      x += w;
    }
    p.hline(0, 63, top + 14, 'grey', 0.44);
    p.hline(0, 63, top + 15, 'grey', 0.06);
    p.hline(0, 63, top + 2, 'cyan', 0.66);              // the cold strip light
    p.hline(0, 63, top + 3, 'cyan', 0.3);
  }
  return p.snap(0.4);
};

T.PRODUCE = () => {
  /* A produce bench, raked toward you, going over. */
  const p = new Pix(64, 64, 84);
  p.fill('green', 0.10);
  const rng = makeRng(84);
  for (let s = 0; s < 3; s++) {
    const top = 6 + s * 20;
    for (let i = 0; i < 60; i++) {
      const cx = Math.floor(rng() * 64), cy = top + Math.floor(rng() * 12);
      const r = 1 + rng() * 1.8;
      const key = ['green', 'olive', 'red', 'yellow', 'purple'][Math.floor(rng() * 5)];
      const t = 0.28 + rng() * 0.45;
      p.disc(cx, cy, r, key, t);
      p.ink(cx - 1, cy - 1, key, Math.min(1, t + 0.3));       // the wet highlight
    }
    p.hline(0, 63, top + 13, 'brown', 0.3);
    p.hline(0, 63, top + 14, 'brown', 0.12);
  }
  p.grime(0.4, 'olive', 0.1, 21);
  return p.snap(0.4);
};

T.DELICASE = () => {
  /* The serve-over counter. A raked bed of trays behind curved glass,
     a chrome rail across the front, and a stainless kick below.

     Built in bands top to bottom so it reads as a CABINET at a distance
     rather than as things floating in a box — the rail and the kick are
     what sell it, not the meat. */
  const p = new Pix(64, 64, 85);
  const rng = makeRng(85);

  /* 0-10  the lit canopy over the counter */
  for (let y = 0; y < 10; y++) for (let x = 0; x < 64; x++) p.ink(x, y, 'grey', 0.30 - y * 0.012);
  p.hline(0, 63, 8, 'bone', 0.92);                  // the strip light in it
  p.hline(0, 63, 9, 'yellow', 0.60);

  /* 10-42  the raked display bed, lit from that strip */
  for (let y = 10; y < 42; y++) for (let x = 0; x < 64; x++)
    p.ink(x, y, 'grey', 0.34 - (y - 10) * 0.004);
  for (let row = 0; row < 4; row++) {
    const y0 = 12 + row * 7;
    let x = 1 + Math.floor(rng() * 3);
    while (x < 63) {
      const w = 7 + Math.floor(rng() * 6);
      const key = rng() < 0.55 ? 'pink' : rng() < 0.6 ? 'red' : 'bone';
      const t = 0.32 + rng() * 0.34;
      /* the enamel tray, then what is in it */
      for (let yy = 0; yy < 6; yy++) for (let xx = 0; xx < w - 1 && x + xx < 64; xx++)
        p.ink(x + xx, y0 + yy, 'bone', 0.52);
      for (let yy = 1; yy < 5; yy++) for (let xx = 1; xx < w - 2 && x + xx < 64; xx++)
        p.ink(x + xx, y0 + yy, key, t);
      p.hline(x + 1, Math.min(63, x + w - 3), y0 + 1, key, Math.min(1, t + 0.26));
      p.hline(x, Math.min(63, x + w - 2), y0 + 5, 'grey', 0.14);   // the tray's shadow
      if (w > 9) { p.ink(x + 2, y0 + 3, 'yellow', 0.85); p.ink(x + 3, y0 + 3, 'yellow', 0.85); }  // the ticket
      x += w;
    }
  }

  /* 42-52  the glass, catching the canopy. Drawn as a wash so the trays
     stay visible through it, which is the entire point of glass. */
  for (let y = 10; y < 46; y++) {
    const sx = 50 - Math.floor((y - 10) * 0.55);
    p.wash(sx, y, 'cyan', 0.86, 0.40);
    p.wash(sx + 1, y, 'cyan', 0.86, 0.20);
    p.wash(12 - Math.floor((y - 10) * 0.2), y, 'cyan', 0.86, 0.16);
  }
  p.hline(0, 63, 44, 'cyan', 0.78);                 // the bottom edge of the glass
  p.hline(0, 63, 45, 'grey', 0.44);
  p.hline(0, 63, 46, 'grey', 0.12);

  /* 47-64  the stainless front and the kick, both scuffed */
  for (let y = 47; y < 64; y++) for (let x = 0; x < 64; x++)
    p.ink(x, y, 'grey', y < 50 ? 0.46 : y < 60 ? 0.38 : 0.24);
  p.hline(0, 63, 47, 'grey', 0.62);
  p.hline(0, 63, 59, 'grey', 0.16);
  for (let x = 0; x < 64; x++) if (rng() < 0.4) p.wash(x, 50 + Math.floor(rng() * 9), 'grey', 0.5, 0.35);
  p.grime(0.4, 'grey', 0.1, 22);
  return p.snap(0.4);
};

T.CHECKOUT = () => {
  /* The side of a till bank: laminate panel, a rubber bumper rail, the
     belt just visible over the top. */
  const p = new Pix(64, 64, 86);
  const n = fbm(64, 64, 10, 2, 86);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
    p.ink(x, y, 'bone', 0.52 + n[y * 64 + x] * 0.08);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 64; x++) p.ink(x, y, 'grey', 0.14);   // the belt
  p.hline(0, 63, 8, 'grey', 0.44);
  for (let y = 30; y < 36; y++) for (let x = 0; x < 64; x++) p.ink(x, y, 'red', 0.36);  // bumper
  p.hline(0, 63, 30, 'red', 0.58);
  p.hline(0, 63, 35, 'red', 0.16);
  for (const vx of [0, 32]) p.vline(vx, 9, 63, 'bone', 0.34);
  p.grime(0.5, 'grey', 0.1, 22);
  return p.snap(0.5);
};

T.TROLLEY = () => {
  /* A nested rank of trolleys, as a wall. Reads as a mess of wire. */
  const p = new Pix(64, 48, 87);
  p.clear();
  for (let x = 0; x < 64; x += 4) p.vline(x, 6, 40, 'grey', 0.5);
  for (let y = 8; y < 40; y += 6) p.hline(0, 63, y, 'grey', 0.44);
  for (let x = 0; x < 64; x += 16) { p.vline(x, 0, 47, 'grey', 0.62); p.vline(x + 1, 0, 47, 'grey', 0.3); }
  p.hline(0, 63, 6, 'grey', 0.66);
  p.hline(0, 63, 41, 'grey', 0.24);
  return p.snap(0.4);
};

/* ---------- back of house ---------- */

T.STOCKFLR = () => {
  const p = new Pix(64, 64, 91);
  aggregate(p, 91, { baseKey: 'grey', baseLo: 0.20, baseHi: 0.30,
    grades: [{ count: 160, min: 0.4, max: 1.0, key: 'grey', lo: 0.14, hi: 0.34 }] });
  /* the yellow racking lines everybody ignores */
  for (const ly of [0, 1]) p.hline(0, 63, ly, 'yellow', 0.5 - ly * 0.15);
  crack(p, 8, 40, 44, 'grey', 0.1, 33);
  p.grime(0.5, 'rust', 0.18, 23);
  const rng = makeRng(92);
  for (let i = 0; i < 4; i++) {                    // forklift tyre marks
    const y = Math.floor(rng() * 64);
    for (let x = 0; x < 64; x++) if (rng() < 0.7) p.wash(x, y, 'grey', 0.08, 0.5);
  }
  return p.snap(0.5);
};

T.DOCKDOOR = () => {
  /* Roller shutter: galvanised lath, not timber. Steel first, rust
     second — the earlier version drew the whole thing out of the rust
     ramp and came out looking like decking. */
  const p = new Pix(64, 64, 93);
  const height = new Float32Array(64 * 64);
  const n = fbm(64, 64, 12, 2, 94);
  for (let y = 0; y < 64; y++) {
    const s2 = y % 8;
    /* one lath: shadowed roll at the top, lit crown, falling away below */
    const t = s2 === 0 ? 0.10 : s2 === 1 ? 0.44 : s2 === 2 ? 0.38 : s2 < 6 ? 0.30 : 0.18;
    const hgt = s2 === 0 ? 0.05 : s2 <= 2 ? 0.9 : s2 < 6 ? 0.6 : 0.25;
    for (let x = 0; x < 64; x++) {
      p.ink(x, y, 'grey', t + n[y * 64 + x] * 0.06);
      height[y * 64 + x] = hgt;
    }
  }
  p.emboss(height, 0.30, 1.0);
  /* Rust, where water sat: along the lath rolls and up from the bottom */
  const r = fbm(64, 64, 6, 3, 95);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const seam = (y % 8) <= 1 ? 1.4 : 0.6;
      const low = 0.35 + Math.pow(y / 63, 2) * 0.9;
      const v = r[y * 64 + x] * seam * low;
      if (v > 0.62) p.wash(x, y, 'rust', 0.30 + (v - 0.62) * 0.7, Math.min(0.85, (v - 0.62) * 2.4));
    }
  }
  /* the guide channels down both edges */
  for (const gx of [0, 1, 62, 63]) {
    for (let y = 0; y < 64; y++) p.ink(gx, y, 'grey', gx === 0 || gx === 62 ? 0.44 : 0.16);
  }
  p.grime(0.5, 'grey', 0.08, 24);
  return p.snap(0.5);
};

T.DOORSTAF = () => {
  /* The swing door between the store and the truth. */
  const p = new Pix(64, 64, 95);
  const n = fbm(64, 64, 8, 2, 95);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
    p.ink(x, y, 'grey', 0.32 + n[y * 64 + x] * 0.08);
  p.frame(2, 2, 60, 60, 'grey', 0.5);
  p.frame(3, 3, 58, 58, 'grey', 0.18);
  for (let y = 44; y < 62; y++) for (let x = 4; x < 60; x++) p.ink(x, y, 'grey', 0.44);  // kick plate
  p.hline(4, 59, 44, 'grey', 0.62);
  for (let y = 10; y < 22; y++) for (let x = 14; x < 50; x++) p.ink(x, y, 'bone', 0.86); // the sign
  drawTextCentred(p, 'STAFF', 32, 12, 'red', 0.3);
  drawTextCentred(p, 'ONLY', 32, 19, 'red', 0.3);
  p.grime(0.6, 'grey', 0.1, 25);
  return p.snap(0.5);
};

T.DOORTRAK = () => {
  /* What you see above a door: the track it hangs from. 64x16. */
  const p = new Pix(64, 16, 96);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 64; x++) p.ink(x, y, 'grey', y < 3 ? 0.16 : y < 6 ? 0.38 : 0.24);
  p.hline(0, 63, 3, 'grey', 0.54);
  p.hline(0, 63, 15, 'grey', 0.08);
  for (let x = 4; x < 64; x += 16) { p.vline(x, 4, 14, 'grey', 0.44); p.vline(x + 1, 4, 14, 'grey', 0.14); }
  p.grime(0.4, 'grey', 0.08, 26);
  return p.snap(0.4);
};

T.CARDBOX = () => {
  /* A stack of cases. The most flammable wall in the building, and it
     looks it. */
  const p = new Pix(64, 64, 97);
  const rng = makeRng(97);
  for (let row = 0; row < 3; row++) {
    const top = row * 22 - 2;
    let x = -Math.floor(rng() * 10);
    while (x < 64) {
      const w = 16 + Math.floor(rng() * 12);
      const t = 0.38 + rng() * 0.16;
      for (let y = top; y < top + 22 && y < 64 + 22; y++)
        for (let xx = 0; xx < w; xx++) p.ink(x + xx, y, 'brown', t);
      p.hline(x, x + w - 1, top, 'brown', Math.min(1, t + 0.22));
      p.vline(x, top, top + 21, 'brown', Math.min(1, t + 0.14));
      p.vline(x + w - 1, top, top + 21, 'brown', Math.max(0, t - 0.2));
      p.hline(x, x + w - 1, top + 21, 'brown', Math.max(0, t - 0.24));
      /* tape down the middle, and a printed panel */
      p.vline(x + (w >> 1), top, top + 21, 'bone', 0.7);
      for (let k = 0; k < 3; k++) p.hline(x + 3, x + w - 4, top + 6 + k * 4, 'brown', Math.max(0, t - 0.16));
      x += w;
    }
  }
  p.grime(0.4, 'grey', 0.12, 27);
  return p.snap(0.5);
};

T.PALLET = () => {
  const p = new Pix(64, 16, 98);
  p.clear();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 64; x++) p.ink(x, y, 'brown', 0.30);
  p.hline(0, 63, 0, 'brown', 0.52);
  p.hline(0, 63, 15, 'brown', 0.12);
  for (const bx of [4, 30, 56]) for (let y = 3; y < 13; y++) for (let x = 0; x < 6; x++) p.ink(bx + x, y, 'brown', 0.22);
  for (let y = 4; y < 12; y++) for (let x = 0; x < 64; x++)
    if (!((x >= 4 && x < 10) || (x >= 30 && x < 36) || (x >= 56 && x < 62))) p.set(x, y, 0, 0, 0, 0);
  return p.snap(0.4);
};

/* ---------- lights, signs, and the thing that says GO THIS WAY ---------- */

T.LIGHTPAN = () => {
  /* A recessed fluorescent panel. Fullbright in the ceiling. */
  const p = new Pix(64, 64, 101);
  p.fill('grey', 0.3);
  for (let y = 6; y < 58; y++) for (let x = 6; x < 58; x++) p.ink(x, y, 'bone', 0.95);
  for (const gx of [22, 42]) p.vline(gx, 6, 57, 'grey', 0.4);
  p.frame(5, 5, 54, 54, 'grey', 0.5);
  p.frame(6, 6, 52, 52, 'bone', 0.7);
  return p.snap(0.3);
};

T.EXITSIGN = () => {
  const p = new Pix(64, 32, 102);
  p.fill('grey', 0.12);
  for (let y = 4; y < 28; y++) for (let x = 4; x < 60; x++) p.ink(x, y, 'green', 0.30);
  p.frame(4, 4, 56, 24, 'green', 0.55);
  drawTextCentred(p, 'EXIT', 32, 12, 'green', 0.95);
  return p.snap(0.3);
};

/* --------------------------------------------------------------------
   THE STRIP

   SellWrong is the anchor of a parade, and a parade is a single long
   building carved into tenancies. Everything below is that carving:
   the piers that separate one shop from the next, the fascia band each
   tenant gets to put a name on, the parapet that hides the plant, and
   the glazing — which comes in three states, because the three states
   ARE the story of the place. Trading, gone, and never let.
   ------------------------------------------------------------------ */

/* --------------------------------------------------------------------
   THE LOGO

   The one piece of art in this game that is not drawn by code, because a
   procedural approximation of somebody's logo is not their logo. It
   arrives as run-length pairs of palette indices — see
   tools/bake-logo.mjs, which is the build step, run by hand, when the
   logo changes — and it is already in the game's 256 colours, so there
   is nothing to snap and nothing to dither.

   Sixty-four pixels is the rule and the logo does not get an exemption.
   It gets GEOMETRY instead: four tiles hung as a two-by-two on the
   entrance tower, which is two ceiling steps and one vertical split. A
   sector engine cannot draw a big picture; it can draw four small ones
   next to each other, which is the same thing and is how every large
   sign in Doom was done.
   ------------------------------------------------------------------ */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64R = (() => { const r = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) r[B64.charCodeAt(i)] = i; return r; })();

/** Base64 run-length pairs back to 64x64 palette indices. */
function decodeTile(str) {
  const bytes = [];
  let acc = 0, bits = 0;
  for (let i = 0; i < str.length; i++) {
    const v = B64R[str.charCodeAt(i)];
    if (v < 0) continue;                       // padding
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); }
  }
  const px = new Uint8Array(64 * 64);
  let p = 0;
  for (let i = 0; i + 1 < bytes.length && p < px.length; i += 2)
    for (let n = bytes[i + 1]; n > 0 && p < px.length; n--) px[p++] = bytes[i];
  return px;
}

const logoTile = i => () => {
  const px = decodeTile(LOGO_TILES[i]);
  const p = new Pix(64, 64, 200 + i, false);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const c = PALETTE[px[y * 64 + x]];
    p.set(x, y, c[0], c[1], c[2], 255);
  }
  return p;                                    // already in the palette
};
T.LOGO0 = logoTile(0);   // top left
T.LOGO1 = logoTile(1);   // top right
T.LOGO2 = logoTile(2);   // bottom left
T.LOGO3 = logoTile(3);   // bottom right

T.NIGHTSKY = () => {
  /* The sky, wrapped round a cylinder. Doom's sky was a cylinder too, and
     for the same reason: it is the only projection that costs nothing and
     the only one where turning your head does the right thing.

     Read bottom to top, because that is the order the light arrives in.
     The bottom band is SODIUM — the town's street lighting bounced off
     the underside of the cloud, which is why a city sky at night is
     orange and not black, and which is the single thing that makes the
     car park read as somewhere rather than as an absence. Above it the
     glow loses out to the cloud, and only at the top is there anything
     you could call night. */
  const p = new Pix(64, 64, 120);
  for (let y = 0; y < 64; y++) {
    const t = y / 63;                       // 0 at the top, 1 at the horizon
    for (let x = 0; x < 64; x++) {
      const glow = Math.pow(t, 2.6);
      p.ink(x, y, glow > 0.30 ? 'rust' : 'blue', 0.34 + glow * 0.52);
    }
  }
  /* cloud, lit from underneath by the town */
  const n = fbm(64, 64, 16, 4, 121);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = n[y * 64 + x], t = y / 63;
    if (v < 0.52) continue;
    const lit = (v - 0.52) * 1.6 * (0.25 + t * 0.9);
    p.wash(x, y, t > 0.62 ? 'rust' : 'grey', 0.46 + lit * 0.6, Math.min(0.85, lit * 1.6));
  }
  /* the few stars that make it through */
  const rng = makeRng(122);
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(rng() * 64), y = Math.floor(rng() * 30);
    if (n[y * 64 + x] > 0.5) continue;
    p.ink(x, y, 'bone', 0.30 + rng() * 0.45);
  }
  return p.snap(0.35);
};

T.HATCHKEEP = () => {
  /* KEEP CLEAR. The hatched apron across the front of every supermarket,
     which exists so the fire brigade can get to the doors — a detail
     that has become funny in this particular car park. */
  const p = T.ASPHALT();
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const d = (x + y) % 22;
    if (d > 4) continue;
    const t = d === 0 || d === 4 ? 0.42 : 0.74;
    if (((x * 7 + y * 13) % 11) < 2) continue;       // worn through
    p.ink(x, y, 'bone', t);
  }
  return p.snap(0.5);
};

T.BAYROW = () => {
  /* A car park bay, and ONE REPEAT IS ONE BAY: declared 186 across and
     180 deep, so a row of forty bays is one sector with this on the floor
     instead of forty sectors with a line between them. The whole car park
     costs about a dozen polygons because of this texture, and moving a
     row is changing one number rather than forty.

     The line is on the left edge only, so each bay draws its own and the
     row comes out with a line every 186 either way you tile it. */
  const p = new Pix(64, 64, 126);
  const n = fbm(64, 64, 20, 4, 126);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
    p.ink(x, y, 'grey', 0.52 + n[y * 64 + x] * 0.11);
  const rng = makeRng(127);
  for (let i = 0; i < 700; i++) {                    // the aggregate
    const x = Math.floor(rng() * 64), y = Math.floor(rng() * 64);
    p.ink(x, y, 'grey', 0.47 + rng() * 0.20);
  }
  /* where the car sits: oil, and tyres that have polished the tarmac */
  for (let y = 14; y < 54; y++) for (let x = 16; x < 52; x++) {
    const d = Math.max(Math.abs(x - 34) / 18, Math.abs(y - 34) / 20);
    if (d < 1) p.ink(x, y, 'grey', 0.45 - (1 - d) * 0.07);
  }
  for (const tx of [24, 44]) for (let y = 20; y < 48; y++)
    if (rng() < 0.7) p.ink(tx + (rng() < 0.5 ? 0 : 1), y, 'grey', 0.40);
  for (let i = 0; i < 26; i++) {                     // sump drips
    const x = 30 + Math.floor(rng() * 9), y = 30 + Math.floor(rng() * 9);
    p.ink(x, y, 'grey', 0.30);
  }
  /* the line: worn, because everything here is */
  for (let y = 0; y < 64; y++) {
    if (rng() < 0.16) continue;
    p.ink(0, y, 'bone', 0.62 + rng() * 0.2);
    p.ink(1, y, 'bone', 0.44 + rng() * 0.2);
  }
  for (let x = 0; x < 8; x++) if (rng() < 0.7) p.ink(x, 0, 'bone', 0.40);
  p.grime(0.35, 'grey', 0.06, 128);
  return p.snap(0.55);
};

T.PILASTER = () => {
  /* The pier between two shops. Brick, because the developer spent the
     brick budget on the bits between the windows and nowhere else. */
  const p = new Pix(64, 64, 130);
  aggregate(p, 130, { baseKey: 'rust', baseLo: 0.40, baseHi: 0.50,
    grades: [{ count: 90, min: 0.5, max: 1.2, key: 'rust', lo: 0.34, hi: 0.56 }] });
  /* stretcher bond: courses of 8, half-lapped */
  const height = new Float32Array(64 * 64).fill(0.55);
  for (let cy = 0; cy < 64; cy += 8) {
    for (let x = 0; x < 64; x++) height[cy * 64 + x] = 0.18;
    const off = (cy / 8) & 1 ? 0 : 16;
    for (let bx = 0; bx < 64; bx += 32) {
      const jx = (bx + off) % 64;
      for (let y = cy + 1; y < cy + 8; y++) height[y * 64 + jx] = 0.1;
    }
  }
  p.emboss(height, 0.55, 1.0);
  streaks(p, 5, 131, 'grey', 0.22, 0.24);
  p.grime(0.4, 'grey', 0.18, 132);
  return p.snap(0.55);
};

T.PARAPET = () => {
  /* The band above every fascia: coping, and the top of a wall that was
     only ever meant to be seen from a car park. */
  const p = new Pix(64, 32, 133);
  const n = fbm(64, 32, 16, 3, 133);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++)
    p.ink(x, y, 'grey', 0.50 + n[y * 64 + x] * 0.12);
  /* the coping is the top four rows, lighter and with an open joint */
  for (let y = 0; y < 5; y++) for (let x = 0; x < 64; x++) p.ink(x, y, 'grey', 0.64 + n[y * 64 + x] * 0.08);
  p.hline(0, 63, 5, 'grey', 0.20);
  p.hline(0, 63, 6, 'grey', 0.70);
  for (const jx of [12, 44]) p.vline(jx, 0, 4, 'grey', 0.30);
  streaks(p, 9, 134, 'grey', 0.28, 0.5);         // it has been raining for thirty years
  p.grime(0.5, 'grey', 0.20, 135);
  return p.snap(0.5);
};

T.SOFFIT = () => {
  /* Under the canopy: perforated metal deck with a downlight in every
     fourth tray. Ceiling flat over the whole footway. */
  const p = new Pix(64, 64, 136);
  p.fill('grey', 0.42);
  for (let x = 0; x < 64; x += 16) {                 // the trays
    for (let y = 0; y < 64; y++) {
      p.ink(x, y, 'grey', 0.26);
      p.ink(x + 1, y, 'grey', 0.52);
      p.ink(x + 15, y, 'grey', 0.28);
    }
  }
  const rng = makeRng(137);                          // the perforations
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(rng() * 64), y = Math.floor(rng() * 64);
    if (x % 16 < 3) continue;
    p.ink(x, y, 'grey', 0.24);
  }
  /* one downlight, off-centre so a run of them does not read as a grid */
  p.disc(40, 22, 6, 'grey', 0.54);
  p.disc(40, 22, 5, 'bone', 0.86);
  p.disc(40, 22, 3, 'bone', 0.98);
  p.grime(0.45, 'grey', 0.20, 138);
  return p.snap(0.5);
};

/* --- glazing, in its three states -------------------------------- */

T.UNITGLAS = () => {
  /* An in-line unit's shopfront: smaller panes than the anchor's, a
     stall riser at the bottom, and the lights still on inside. */
  const p = new Pix(64, 64, 140);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const sheen = Math.max(0, 1 - Math.abs((x + y * 0.55) % 30 - 6) / 11);
    p.ink(x, y, 'cyan', 0.13 + sheen * 0.17 + (1 - y / 64) * 0.10);
  }
  /* something is in there, blurred by the glass */
  const rng = makeRng(141);
  for (let i = 0; i < 14; i++) {
    const x = 4 + Math.floor(rng() * 56), h = 6 + Math.floor(rng() * 16);
    for (let y = 46 - h; y < 46; y++) p.ink(x, y, rng() < 0.5 ? 'yellow' : 'bone', 0.22 + rng() * 0.2);
  }
  for (const mx of [0, 21, 42]) { p.vline(mx, 0, 63, 'bone', 0.30); p.vline(mx + 1, 0, 63, 'grey', 0.16); }
  p.hline(0, 63, 6, 'bone', 0.30); p.hline(0, 63, 7, 'grey', 0.16);   // transom
  for (let y = 48; y < 64; y++) for (let x = 0; x < 64; x++)          // stall riser
    p.ink(x, y, 'grey', 0.20 + ((x + y) & 1) * 0.03);
  p.hline(0, 63, 47, 'bone', 0.34);
  p.grime(0.3, 'grey', 0.09, 142);
  return p.snap(0.45);
};

T.UNITSHUT = () => {
  /* Shut up: the roller down, and everybody who walks past has had a
     go at it. */
  const p = new Pix(64, 64, 143);
  for (let y = 0; y < 64; y++) {
    const rib = y % 6;
    const t = rib === 0 ? 0.26 : rib === 1 ? 0.52 : rib === 5 ? 0.32 : 0.42;
    for (let x = 0; x < 64; x++) p.ink(x, y, 'grey', t);
  }
  const rng = makeRng(144);
  for (let i = 0; i < 5; i++) {                       // tags
    const cx = 6 + rng() * 52, cy = 14 + rng() * 38;
    const key = ['red', 'green', 'purple', 'cyan'][Math.floor(rng() * 4)];
    let x = cx, y = cy;
    for (let s = 0; s < 14; s++) {
      const nx = x + (rng() - 0.5) * 16, ny = y + (rng() - 0.5) * 11;
      p.line(Math.round(x), Math.round(y), Math.round(nx), Math.round(ny), key, 0.5 + rng() * 0.3);
      x = nx; y = ny;
    }
  }
  for (let x = 0; x < 64; x++) { p.ink(x, 62, 'grey', 0.22); p.ink(x, 63, 'grey', 0.50); }
  p.grime(0.55, 'rust', 0.22, 145);
  return p.snap(0.5);
};

T.UNITVOID = () => {
  /* Never let. Whitewash on the inside of the glass, and an agent's
     board nobody has taken down. */
  const p = new Pix(64, 64, 146);
  const n = fbm(64, 64, 12, 3, 146);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
    p.ink(x, y, 'bone', 0.42 + n[y * 64 + x] * 0.22);
  const rng = makeRng(147);                            // brush strokes
  for (let i = 0; i < 22; i++) {
    const y0 = Math.floor(rng() * 64), h = 2 + Math.floor(rng() * 4);
    for (let y = y0; y < y0 + h && y < 64; y++)
      for (let x = 0; x < 64; x++) p.ink(x, y, 'bone', 0.52 + Math.sin(x * 0.3 + i) * 0.06);
  }
  for (const mx of [0, 32]) { p.vline(mx, 0, 63, 'grey', 0.34); p.vline(mx + 1, 0, 63, 'grey', 0.18); }
  p.box(14, 18, 36, 22, 'grey', 0.18);                 // the board
  p.frame(14, 18, 36, 22, 'red', 0.55);
  drawTextCentred(p, 'TO LET', 32, 23, 'red', 0.9);
  drawTextCentred(p, '0800', 32, 31, 'grey', 0.7);
  for (let y = 48; y < 64; y++) for (let x = 0; x < 64; x++) p.ink(x, y, 'grey', 0.20);
  p.grime(0.4, 'grey', 0.10, 148);
  return p.snap(0.5);
};

/* --- fascias -----------------------------------------------------
   One band per tenancy, and the name repeats along it. A 64-unit
   repeat means a 432-wide unit says its own name seven times, which is
   both what cheap signage looks like from a car park and the only way
   to get legible letters out of a texture this size. */
const fascia = (seed, text, bg, bgT, fg, fgT) => () => {
  const p = new Pix(64, 64, seed);
  const n = fbm(64, 64, 8, 2, seed);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
    p.ink(x, y, bg, bgT + n[y * 64 + x] * 0.10);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 64; x++) p.ink(x, y, bg, bgT + 0.20);
  for (let y = 58; y < 64; y++) for (let x = 0; x < 64; x++)
    p.ink(x, y, bg, Math.max(0.05, bgT - 0.14));
  p.hline(0, 63, 63, 'grey', 0.10);
  drawTextCentred(p, text, 32, 28, fg, fgT);
  p.grime(0.35, 'grey', 0.09, seed + 1);
  return p.snap(0.5);
};

T.FASCHEM = fascia(150, 'CHEMIST', 'green', 0.30, 'bone', 0.92);
T.FASPHON = fascia(152, 'PHONES', 'blue', 0.34, 'yellow', 0.90);
T.FASFOOD = fascia(154, 'KEBAB', 'red', 0.36, 'yellow', 0.92);
T.FASWASH = fascia(156, 'WASH', 'cyan', 0.26, 'blue', 0.55);
T.FASVOID = fascia(158, 'TO LET', 'grey', 0.22, 'grey', 0.55);

T.PYLONSGN = () => {
  /* The freestanding sign at the mouth of the car park. Board on top,
     post below, and ONE repeat covers the whole 340-unit monolith — so
     the picture is drawn once and stretched rather than tiled, which is
     the only way to keep the board at the top where a board goes. */
  const p = new Pix(48, 64, 160);
  p.fill('grey', 0.16);
  for (let y = 28; y < 64; y++) for (let x = 0; x < 48; x++)      // the post
    p.ink(x, y, 'grey', x < 8 || x > 39 ? 0.12 : 0.24);
  p.vline(9, 28, 63, 'grey', 0.34);
  p.box(1, 1, 46, 26, 'red', 0.42);                                // the board
  p.frame(1, 1, 46, 26, 'grey', 0.30);
  p.frame(2, 2, 44, 24, 'bone', 0.55);
  drawTextCentred(p, 'SELL', 24, 5, 'bone', 0.95);
  drawTextCentred(p, 'WRONG', 24, 12, 'bone', 0.95);
  p.hline(4, 43, 19, 'bone', 0.30);
  drawTextCentred(p, 'OPEN 24H', 24, 21, 'yellow', 0.80);
  streaks(p, 5, 161, 'grey', 0.12, 0.4);
  p.grime(0.4, 'grey', 0.10, 162);
  return p.snap(0.5);
};

T.POSTMETL = () => {
  /* Galvanised column: car park lighting, and the bollards. */
  const p = new Pix(64, 64, 164);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const round = Math.sin((x / 64) * Math.PI);        // fake the cylinder
    p.ink(x, y, 'grey', 0.14 + round * 0.26);
  }
  const rng = makeRng(165);
  for (let i = 0; i < 90; i++) {                       // spangle
    const x = Math.floor(rng() * 64), y = Math.floor(rng() * 64);
    p.ink(x, y, 'grey', 0.20 + rng() * 0.26);
  }
  p.grime(0.5, 'rust', 0.09, 166);
  return p.snap(0.5);
};

T.TROLLRAI = () => {
  /* The trolley bay: galvanised rail, and the sign nobody obeys. */
  const p = new Pix(64, 48, 168);
  p.clear();
  for (const ry of [6, 26]) for (let x = 0; x < 64; x++) {
    p.ink(x, ry, 'grey', 0.18); p.ink(x, ry + 1, 'grey', 0.44); p.ink(x, ry + 2, 'grey', 0.24);
  }
  for (const px of [4, 32, 60]) for (let y = 4; y < 48; y++) {
    p.ink(px, y, 'grey', 0.18); p.ink(px + 1, y, 'grey', 0.42);
  }
  p.box(36, 34, 24, 12, 'blue', 0.30);
  p.frame(36, 34, 24, 12, 'bone', 0.55);
  drawTextCentred(p, 'BAY', 48, 37, 'bone', 0.85);
  return p.snap(0.4);
};

/* --- the doors themselves -----------------------------------------
   Two leaves, and they are drawn as WHOLE leaves rather than as a
   tiling pattern: the quad maps 0..1 in both directions, so the stiles
   land where the stiles go instead of wherever the repeat happens to
   fall. Everything not glass or frame is transparent, so the doors are
   something you look THROUGH at the store you are about to burn.

   The two are mirror images and drawn by one function, because a pair
   of sliders that are not each other's mirror looks wrong immediately
   and nobody can say why. */
const slideLeaf = (seed, mirrored) => () => {
  const p = new Pix(64, 64, seed, false);            // no wrap: a sprite, not a tile
  p.clear();
  const STILE = 5;
  /* the meeting stile is thicker, and it is the edge the two leaves
     close against — so it is on the right for the left leaf */
  const inner = mirrored ? 0 : 64 - STILE - 3;
  const outer = mirrored ? 64 - STILE : 0;
  const frame = (x0, w) => {
    for (let y = 0; y < 64; y++) for (let x = x0; x < x0 + w; x++) {
      const e = (x === x0 || x === x0 + w - 1);
      p.ink(x, y, 'grey', e ? 0.30 : 0.52);
    }
  };
  /* glass first, so the frame sits over it */
  for (let y = 3; y < 61; y++) for (let x = 3; x < 61; x++) {
    const sheen = Math.max(0, 1 - Math.abs((x * (mirrored ? -1 : 1) + y * 0.6) % 34 - 7) / 12);
    const a = Math.round(40 + sheen * 90);
    p.ink(x, y, 'cyan', 0.16 + sheen * 0.26, a);
  }
  frame(inner, STILE + 3);
  frame(outer, STILE);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 64; x++) p.ink(x, y, 'grey', y === 0 ? 0.28 : 0.50);
  for (let y = 58; y < 64; y++) for (let x = 0; x < 64; x++) p.ink(x, y, 'grey', y > 61 ? 0.22 : 0.46);
  /* the green man, centred on each leaf and mirrored with it */
  const gx = mirrored ? 38 : 26;
  p.disc(gx, 30, 6, 'green', 0.40, 210);
  p.disc(gx, 30, 5, 'green', 0.72, 235);
  p.ink(gx, 27, 'bone', 0.9); p.ink(gx, 28, 'bone', 0.9);
  p.line(gx - 2, 29, gx + 2, 32, 'bone', 0.9);
  p.line(gx - 1, 30, gx + 1, 34, 'bone', 0.9);
  return p.snap(0.3);
};

T.SLIDEL = slideLeaf(170, false);
T.SLIDER = slideLeaf(172, true);

/* --- what the bigger shop floor needed ---------------------------- */

T.SHELFMIX = () => {
  /* A run somebody has already been down: half of it faced up, half of
     it gone, and the gaps showing the back panel through. Four shelves
     in 64 pixels, declared as 80 units tall, exactly like its neighbours
     — the stretch is a quarter and it lands on a picture of tins. */
  const p = new Pix(64, 64, 174);
  const rng = makeRng(174);
  p.fill('grey', 0.14);
  for (let sy = 0; sy < 64; sy += 16) {
    for (let y = sy; y < sy + 3; y++) for (let x = 0; x < 64; x++)   // the shelf edge
      p.ink(x, y, 'grey', y === sy ? 0.34 : 0.20);
    let x = 1;
    while (x < 63) {
      const w = 3 + Math.floor(rng() * 6);
      if (rng() < 0.45) { x += w; continue; }                        // a hole in the facing
      const key = ['red', 'yellow', 'green', 'blue', 'olive', 'purple'][Math.floor(rng() * 6)];
      const t = 0.24 + rng() * 0.42, h = 8 + Math.floor(rng() * 5);
      for (let y = sy + 3; y < Math.min(sy + 3 + h, 64); y++)
        for (let xx = x; xx < Math.min(x + w, 63); xx++)
          p.ink(xx, y, key, t + (xx === x ? 0.12 : 0));
      x += w + 1;
    }
  }
  p.grime(0.35, 'grey', 0.08, 175);
  return p.snap(0.55);
};

T.BAKECASE = () => {
  /* The bakery: a warm case, and the only thing in the building that
     ever smelled good. */
  const p = new Pix(64, 40, 176);
  p.fill('bone', 0.20);
  for (let y = 0; y < 6; y++) for (let x = 0; x < 64; x++) p.ink(x, y, 'grey', 0.38);
  for (let y = 6; y < 30; y++) for (let x = 0; x < 64; x++) p.ink(x, y, 'yellow', 0.18 + (30 - y) / 90);
  const rng = makeRng(177);
  for (let i = 0; i < 26; i++) {                    // loaves and trays
    const cx = 4 + Math.floor(rng() * 56), cy = 12 + Math.floor(rng() * 15);
    const r = 2 + Math.floor(rng() * 3);
    p.disc(cx, cy, r, 'brown', 0.42 + rng() * 0.3);
    p.ink(cx, cy - r, 'brown', 0.72);
  }
  for (const sy of [10, 20]) p.hline(0, 63, sy, 'grey', 0.30);
  for (let y = 30; y < 40; y++) for (let x = 0; x < 64; x++)
    p.ink(x, y, 'grey', 0.22 + ((x >> 3) & 1) * 0.05);
  p.hline(0, 63, 30, 'bone', 0.48);
  p.grime(0.3, 'grey', 0.07, 178);
  return p.snap(0.5);
};

T.MISSING = () => {
  /* Loud on purpose. See TextureBank.get. */
  const p = new Pix(64, 64, 1);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const c = ((x >> 3) + (y >> 3)) & 1;
    p.set(x, y, c ? 255 : 0, 0, c ? 255 : 0, 255);
  }
  drawTextCentred(p, 'NO', 32, 20, 'bone', 1);
  drawTextCentred(p, 'TEX', 32, 30, 'bone', 1);
  return p;
};

/* --------------------------------------------------------------------
   After the fire

   A store that burns down and looks exactly the same afterwards is not
   burning down, it is playing an animation. So every surface that can
   burn gets a charred twin, generated from the original rather than
   drawn separately — which keeps the two in register, so a shelf that
   goes up turns into a burnt version of ITSELF rather than into a
   different shelf.

   Three things happen to a surface that has been on fire, and all three
   are needed or it just looks dim:

     it goes DARK, but not uniformly — soot collects in the recesses and
       the raised edges stay comparatively bare, so the relief that was
       there before is still legible, only inverted
     it goes GREY in patches, because ash is pale, and those patches are
       what stop it reading as "the lights went out"
     a few EMBERS survive, and they are the only saturated colour left
   ------------------------------------------------------------------ */
export function charVariant(src, seed) {
  const p = new Pix(src.w, src.h, seed, src.wrap);
  p.data.set(src.data);

  const soot = fbm(src.w, src.h, 8, 3, seed);
  const ash = fbm(src.w, src.h, 16, 2, seed + 991);

  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const i = p.idx(x, y);
      if (i < 0 || p.data[i + 3] < 8) continue;
      const d = p.data;
      const lum = (d[i] * 0.3 + d[i + 1] * 0.6 + d[i + 2] * 0.1) / 255;
      const s = soot[y * src.w + x];

      /* Soot sticks where the surface was already dark — the recesses.
         Charring uniformly flattens the relief to a grey rectangle.

         The first pass at this took everything down to about a tenth,
         which is what a burnt surface really reflects and which made the
         gutted store literally unreadable — and you have to walk back
         out through it. So it keeps rather more than it should, and the
         ash below is doing most of the work of making it legible. */
      const keep = 0.17 + s * 0.24 + lum * 0.22;
      d[i] *= keep; d[i + 1] *= keep * 0.95; d[i + 2] *= keep * 0.88;

      /* ash: pale, patchy, and the only thing you can actually see by */
      const a = ash[y * src.w + x];
      if (a > 0.52) p.wash(x, y, 'grey', 0.34 + (a - 0.52) * 0.9, (a - 0.52) * 1.5);
      if (a > 0.78 && s > 0.5) p.wash(x, y, 'grey', 0.52, (a - 0.78) * 1.6);
    }
  }

  /* the last of it, still glowing in the cracks */
  speckle(src.w, src.h, Math.round(src.w * src.h * 0.022), seed + 77, (x, y, a, b) => {
    if (p.alphaAt(x, y) < 8) return;
    if (a > 0.80) p.ink(x, y, 'fire', 0.34 + b * 0.34);
    else if (a > 0.45) p.wash(x, y, 'fire', 0.18, 0.40);
  });
  return p.snap(0.4);
}

/* Everything that can be on fire and is looked at afterwards. Walls and
   ceilings included: smoke blackens a ceiling long before flame reaches
   it, and a store where only the shelves changed looks like the shelves
   were swapped out. */
export const CHARRABLE = [
  'SHELFSTK', 'SHELFEMP', 'SHELFBAK', 'SHELFEND', 'CHILLER', 'FREEZDOR',
  'PRODUCE', 'DELICASE', 'CHECKOUT', 'CARDBOX', 'PALLET', 'TROLLEY',
  'LINO', 'LINOWORN', 'CEILTILE', 'CEILFIT', 'CEILDECK', 'WALLPANL', 'TILEWALL',
  'STOCKFLR', 'STOCKWAL', 'DOORSTAF', 'DOCKDOOR', 'HAZARD', 'CONCRETE',
  /* the strip: the neighbours burn too, once you have walked the fire
     out of the anchor and along the footway */
  'SHELFMIX', 'BAKECASE', 'UNITGLAS', 'UNITSHUT', 'UNITVOID', 'SOFFIT',
  'FASCHEM', 'FASPHON', 'FASFOOD', 'FASWASH', 'FASVOID', 'PILASTER',
  /* and the sign goes with it, which is the shot worth having */
  'LOGO0', 'LOGO1', 'LOGO2', 'LOGO3',
];

/** The charred name for a texture, or the texture itself if it has none. */
export const charredName = n => (n && CHARRABLE.includes(n)) ? n + '_B' : n;

/* --------------------------------------------------------------------
   Textures whose world footprint is not their pixel size

   Two different reasons appear here and they are worth separating.

   FIXTURES are sized so that one repeat of the texture is exactly the
   height of the thing it is on. A shelf texture 64 tall on an 80-tall
   gondola would show a quarter of a second copy of itself cut off at the
   floor; declared as 80 it simply stretches by a quarter, which on a
   picture of tins nobody will ever notice. These numbers MUST match the
   fixture heights in the map, and the smoke test checks that they do.

   CEILINGS go the other way, covering four times the world they have
   pixels for, so that a light fitting lands every four tiles instead of
   in every one.
   ------------------------------------------------------------------ */
const SIZES = {
  KERB:     { w: 64, h: 16 },
  STORBASE: { w: 64, h: 32 },
  BRANDBAND:{ w: 64, h: 96 },   // one repeat is the fascia band
  DOORTRAK: { w: 64, h: 16 },
  EXITSIGN: { w: 64, h: 32 },
  PALLET:   { w: 64, h: 16, masked: true },
  TROLLEY:  { w: 64, h: 48, masked: true },

  /* fixtures — one repeat is the whole fixture */
  SHELFSTK: { w: 64, h: 80 },      // H_GONDOLA
  SHELFEMP: { w: 64, h: 80 },
  FREEZDOR: { w: 64, h: 80 },
  CHECKOUT: { w: 64, h: 40 },      // H_FIXTURE
  CHILLER:  { w: 64, h: 40 },
  PRODUCE:  { w: 64, h: 40 },
  DELICASE: { w: 64, h: 40 },
  SHELFMIX: { w: 64, h: 80 },      // H_GONDOLA
  BAKECASE: { w: 64, h: 40 },      // H_FIXTURE

  /* THE LOGO. One repeat is one quarter of the sign, and these numbers
     are the sign box in the map divided by two — SIGN_W / 2 across and
     SIGN_H / 2 up. Change one and you must change the other or the logo
     stretches; the smoke test checks that they still agree. */
  LOGO0:    { w: 140, h: 112 },
  LOGO1:    { w: 140, h: 112 },
  LOGO2:    { w: 140, h: 112 },
  LOGO3:    { w: 140, h: 112 },

  /* the strip */
  BAYROW:   { w: 186, h: 180 },    // one repeat is one parking bay
  PARAPET:  { w: 64, h: 32 },
  FASCHEM:  { w: 64, h: 96 },      // one repeat is one sign
  FASPHON:  { w: 64, h: 96 },
  FASFOOD:  { w: 64, h: 96 },
  FASWASH:  { w: 64, h: 96 },
  FASVOID:  { w: 64, h: 96 },
  TROLLRAI: { w: 64, h: 48, masked: true },
  /* The pylon is a monolith, not a tiling wall: one repeat covers the
     whole 340 of it, so the board stays at the top where a board goes. */
  PYLONSGN: { w: 96, h: 340 },
  /* Door leaves are mapped 0..1 by the slider, never by the wall
     builder, so these numbers only matter if one ends up on a line. */
  SLIDEL:   { w: 96, h: 248, masked: true },
  SLIDER:   { w: 96, h: 248, masked: true },

  /* ceilings — four tiles to a texture, so the fittings are spaced out */
  CEILFIT:  { w: 256, h: 256 },
};

export function bakeTextures() {
  const bank = new TextureBank();
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const raw = {};
  for (const [name, gen] of Object.entries(T)) {
    const pix = gen();
    raw[name] = pix;
    bank.add(name, pix, SIZES[name] || {});
  }
  /* and the same surfaces again, after the fire has been through */
  CHARRABLE.forEach((name, i) => {
    if (!raw[name]) { console.warn('nothing to char:', name); return; }
    bank.add(name + '_B', charVariant(raw[name], 3300 + i * 31), SIZES[name] || {});
  });
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  console.log(`baked ${bank.map.size} textures in ${ms.toFixed(0)}ms`);
  return bank;
}

export const TEXTURE_NAMES = Object.keys(T);
export { SIZES as TEXTURE_SIZES };
export { T as TEXTURE_GENERATORS };
