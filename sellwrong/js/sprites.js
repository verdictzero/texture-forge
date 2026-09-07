/* =====================================================================
   SELLWRONG — the sprite bank
   =====================================================================

   Doom's sprite naming, because it is a good scheme and because every
   piece of documentation about how Doom animates its monsters is written
   in it:

     ASSOA1   four letters of sprite name, one frame letter, one rotation
              digit. Rotation 1 is head-on, 2 through 8 go round, and 0
              means "this frame looks the same from everywhere".

   Frame letters run A, B, C... in the order the animation uses them, and
   the state tables in states.js refer to them exactly that way. So

     WALK: A A B B C C D D
     DIE:  H I J K L

   is both the documentation and the code.

   TWO MONSTERS, and they are the two Doom opens with.

     THE ASSOCIATE is the Zombieman. Slow, weak, common, still wearing
     the polo shirt, and shoots at you with a price gun. He is here to
     be the thing you are not frightened of, so that the other one lands.

     THE STOCKER is the Imp. Bigger, hunched, faster, throws a tin of
     something at your head from across the shop floor and hurts if it
     catches you. Brown apron over the same skeleton, and a longer,
     lower stride so it reads as a different animal at fifty units.

   Both are PLACEHOLDERS in the sense that the drawing is provisional,
   and NOT placeholders in the sense that the animation is real. The
   state tables, the timings, the rotations and the anchor points are all
   final. When the art arrives it drops into the same eight slots per
   frame and nothing else in the game changes.
   ===================================================================== */

import * as THREE from 'three';
import { Pix, fbm, valueNoise, speckle, drawTextCentred } from './pixel.js';
import { makeRng, pRandom } from './util.js';
import { ramp } from './palette.js';
import * as F from './figure.js';

export class SpriteBank {
  constructor() { this.frames = new Map(); this.warned = new Set(); }

  /** One frame: eight views, each a Pix. Uploaded on demand. */
  addFrame(name, letter, views, opts = {}) {
    const key = name + letter;
    const entry = {
      key, views, textures: new Array(8).fill(null),
      w: opts.w ?? views[0].w, h: opts.h ?? views[0].h,
      scale: opts.scale ?? 1,
      fullbright: !!opts.fullbright,
      /* how far up off the floor the sprite's foot sits — 0 for anything
         standing on it, positive for something hanging or flying */
      lift: opts.lift ?? 0,
    };
    this.frames.set(key, entry);
    return entry;
  }

  get(name, letter) {
    const e = this.frames.get(name + letter);
    if (e) return e;
    if (!this.warned.has(name + letter)) {
      this.warned.add(name + letter);
      console.warn('missing sprite frame:', name + letter);
    }
    return this.frames.get('MISSA');
  }

  /** Lazily upload one rotation. Most frames never face you from every
   *  angle, so most rotations are never uploaded at all. */
  texture(entry, rot) {
    let t = entry.textures[rot];
    if (t) return t;
    t = new THREE.CanvasTexture(entry.views[rot].toCanvas());
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;   // sprites do not mip: a mipped
    t.generateMipmaps = false;           // sprite loses its cut-out edge
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    entry.textures[rot] = t;
    return t;
  }
}

/* ====================================================================
   Which pose goes with which frame letter

   Doom's zombie and imp share a shape of animation, so this describes it
   once and both monsters instantiate it. Read alongside states.js: the
   letters here are the letters there.
   ==================================================================== */
/**
 * Every frame a humanoid needs, under the letters its STATE TABLE asks
 * for.
 *
 * The letters are an argument and not a constant, because the two
 * monsters do not use the same ones — and they do not because Doom's
 * two do not. The Zombieman's attack is two frames so its pain is G; the
 * Imp's is three so its pain is H and everything after it shifts by one.
 * Hard-coding G for pain and M-onwards for gibs produced a Stocker whose
 * pain frame did not exist and whose attack ended on a picture of it
 * flinching — and, quietly, a gib frame at S that overwrote something
 * else. The letters live in one place now, next to the table that names
 * them.
 */
function humanoidFrames(bank, name, skin, gait, opts = {}) {
  const L = {
    walk: ['A', 'B', 'C', 'D'], stand: 'W', attack: ['E', 'F'], pain: 'G',
    death: ['H', 'I', 'J', 'K', 'L'],
    xdeath: ['M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'],
    ...(opts.letters || {}),
  };

  const walk = F.walkKeys(gait);
  const attack = F.attackPoses(opts.attack || {});      // [wind, cock, release]
  const stand = F.standPose(gait);
  const deaths = F.deathPoses();
  const ro = { rig: opts.rig || F.RIG, scaleX: opts.scaleX || 1, scaleY: opts.scaleY || 1 };

  L.walk.forEach((ltr, i) => bank.addFrame(name, ltr, F.renderAllRotations(walk[i], skin, ro)));

  /* A dedicated idle, so a thing standing still is not frozen mid-stride.
     Doom reused its first two walk frames for this; a separate pose is
     better and costs one frame. */
  bank.addFrame(name, L.stand, F.renderAllRotations(stand, skin, ro));

  /* Two attack frames take the wind-up and the release; three take the
     extra beat in between. */
  const chosen = L.attack.length >= 3 ? attack : [attack[0], attack[2]];
  L.attack.forEach((ltr, i) => bank.addFrame(name, ltr, F.renderAllRotations(chosen[i], skin, ro)));

  bank.addFrame(name, L.pain, F.renderAllRotations(F.painPose(), skin, ro));

  /* Death, single-rotation, exactly as Doom stored it. */
  deaths.forEach((p, i) => bank.addFrame(name, L.death[i], F.renderAllRotations(p, skin, { ...ro, only: 2 })));

  /* And the other way out. */
  gibFrames(skin, L.xdeath.length).forEach((views, i) => bank.addFrame(name, L.xdeath[i], views));
}

/* --------------------------------------------------------------------
   Coming apart

   Not a posed figure — a posed figure cannot do this. A burst of chunks
   thrown outward under gravity, drawn as one sprite per tic of the
   throw, settling into a spread on the floor. The last frame is what
   stays there, so it is drawn wettest.
   ------------------------------------------------------------------ */
function gibFrames(skin, n) {
  const rng = makeRng(4242);
  const chunks = [];
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const sp = 0.7 + rng() * 2.6;
    chunks.push({
      x: 32 + (rng() - 0.5) * 6, y: 34 + (rng() - 0.5) * 16,
      vx: Math.cos(a) * sp, vy: -(1.2 + rng() * 3.4),
      r: 1 + rng() * 2.6,
      key: rng() < 0.68 ? 'red' : (rng() < 0.5 ? skin.body : 'flesh'),
      t: 0.18 + rng() * 0.4,
      rest: 0,
    });
  }
  const out = [];
  for (let f = 0; f < n; f++) {
    const p = new Pix(64, 64, 900 + f, false);
    /* the pool underneath, which only grows */
    const pool = Math.min(1, f / (n - 1));
    for (let i = 0; i < 60 * pool; i++) {
      const a = rng() * Math.PI * 2, d = rng() * 22 * pool;
      p.disc(32 + Math.cos(a) * d, 60 + Math.sin(a) * d * 0.28, 1 + rng() * 2, 'red', 0.10 + rng() * 0.14);
    }
    for (const c of chunks) {
      p.disc(Math.round(c.x), Math.round(c.y), c.r, c.key, c.t);
      p.ink(Math.round(c.x - 1), Math.round(c.y - 1), c.key, Math.min(0.95, c.t + 0.3));
      /* advance the throw for the next frame */
      c.x += c.vx; c.y += c.vy; c.vy += 0.85;
      if (c.y > 60 - c.r) { c.y = 60 - c.r; c.vy *= -0.24; c.vx *= 0.55; }
    }
    p.snap(0.3);
    const one = p;
    out.push(new Array(8).fill(one));       // rotation 0: same from everywhere
  }
  return out;
}

/* ====================================================================
   The two of them
   ==================================================================== */

/** A name badge, a lanyard, an apron — the bits that are painted on top
 *  of a finished figure rather than built into the skeleton. */
function associateDecor(pix, ctx) {
  const { P, sk, facingUs } = ctx;
  const C = P(sk.chest);
  if (facingUs) {
    /* the badge, still on. This is the only thing on the sprite that is
       not red, grey or skin, so it is what your eye lands on. */
    pix.ink(Math.round(C[0] + 4), Math.round(C[1] + 1), 'bone', 0.9);
    pix.ink(Math.round(C[0] + 5), Math.round(C[1] + 1), 'bone', 0.9);
    pix.ink(Math.round(C[0] + 4), Math.round(C[1] + 2), 'bone', 0.7);
    pix.ink(Math.round(C[0] + 5), Math.round(C[1] + 2), 'blue', 0.6);
    /* the collar */
    pix.ink(Math.round(C[0] - 1), Math.round(C[1] - 4), 'red', 0.72);
    pix.ink(Math.round(C[0] + 1), Math.round(C[1] - 4), 'red', 0.72);
  }
}

function stockerDecor(pix, ctx) {
  const { P, sk, facingUs } = ctx;
  const C = P(sk.chest);
  if (facingUs) {
    /* the apron, hanging off the front of it */
    for (let y = -2; y < 9; y++)
      for (let x = -4; x <= 4; x++)
        if (Math.abs(x) < 5 - Math.max(0, y - 5))
          pix.ink(Math.round(C[0] + x), Math.round(C[1] + y), 'brown', 0.42 + (x < 0 ? 0.08 : -0.06));
    pix.hline(Math.round(C[0] - 4), Math.round(C[0] + 4), Math.round(C[1] - 2), 'brown', 0.58);
  }
}

export const ASSOCIATE_SKIN = {
  legs: 'grey', legsT: 0.20, shoes: 'grey', shoesT: 0.09,
  body: 'red', bodyT: 0.42, sleeve: 'red', sleeveT: 0.48,
  skin: 'flesh', skinT: 0.42, eye: 'yellow', eyeT: 0.95,
  decorate: associateDecor,
};

export const STOCKER_SKIN = {
  legs: 'olive', legsT: 0.22, shoes: 'grey', shoesT: 0.08,
  body: 'brown', bodyT: 0.34, sleeve: 'olive', sleeveT: 0.30,
  skin: 'flesh', skinT: 0.30, eye: 'red', eyeT: 0.90,
  decorate: stockerDecor,
};

/* ====================================================================
   Fire

   The PSX Doom fire routine, which is thirty lines and still the best
   looking fire anybody has put in a game of this shape.

   Seed the bottom row at maximum heat. For every cell above, take the
   cell below, subtract a small random amount, and shift it sideways by
   the same random amount. That is the whole algorithm. The subtraction
   is the cooling, and the sideways shift by the SAME random value is the
   part that matters — it correlates the flicker with the decay, so the
   flame licks instead of dissolving.

   Run it forty times before capturing anything so it settles, then grab
   one frame every few iterations. It never loops perfectly, which is
   also true of fire.
   ==================================================================== */
export function fireFrames(w, h, count, seed = 7, opts = {}) {
  const rng = makeRng(seed);
  const MAX = 36;                              // heat levels
  const grid = new Int16Array(w * h);
  const taper = opts.taper ?? 0.55;            // how much the base narrows

  const seedRow = () => {
    for (let x = 0; x < w; x++) {
      /* narrower at the edges, so the flame is a flame and not a wall */
      const d = Math.abs(x - (w - 1) / 2) / ((w - 1) / 2);
      const hot = Math.max(0, 1 - Math.pow(d, 1.6) / taper);
      grid[(h - 1) * w + x] = Math.round(MAX * hot);
    }
  };
  seedRow();

  const step = () => {
    for (let y = h - 1; y > 0; y--) {
      for (let x = 0; x < w; x++) {
        const src = grid[y * w + x];
        if (src <= 0) { grid[(y - 1) * w + x] = 0; continue; }
        const r = Math.floor(rng() * 3);
        const dst = x - r + 1;
        if (dst < 0 || dst >= w) continue;
        grid[(y - 1) * w + dst] = Math.max(0, src - (r & 1) - (rng() < 0.28 ? 1 : 0));
      }
    }
  };

  for (let i = 0; i < 60; i++) step();          // let it settle

  const out = [];
  for (let f = 0; f < count; f++) {
    for (let i = 0; i < 3; i++) step();
    const p = new Pix(w, h, seed + f, false);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = grid[y * w + x];
        if (v <= 0) continue;
        p.ink(x, y, 'fire', Math.min(1, v / MAX));
      }
    p.snap(0);
    out.push(p);
  }
  return out;
}

/* ====================================================================
   Props

   Cars, trolleys, bollards and the things you set alight. All of them
   are placeholders in the sense that they are simple; none of them is a
   placeholder in the sense that it is missing.
   ==================================================================== */

/**
 * A car, from eight angles.
 *
 * Not modelled — parameterised. The silhouette of a box seen from above
 * at angle t is |L cos t| + |W sin t| wide, so the drawing is that wide
 * and everything on it is placed as a fraction of that width. Eight
 * consistent views out of one equation, which is all a placeholder needs
 * and rather more than a placeholder usually gets.
 */
function carViews(bodyKey, bodyT, seed) {
  const rng = makeRng(seed);
  const L = 60, W = 26;                         // in sprite pixels, before scaling
  const out = [];
  for (let rot = 0; rot < 8; rot++) {
    const p = new Pix(64, 32, seed + rot, false);
    const th = rot * Math.PI / 4;
    /* A box's width on screen is its OWN width across the view plus its
       own length along it. The car's length runs along its facing axis,
       so at rot 0 — nose-on — the length is pointing at the camera and
       contributes nothing, and what you see is 26 units of bonnet. The
       first version of this had L and W the wrong way round and produced
       a car park of cars all parked broadside to everything. */
    const span = Math.abs(W * Math.cos(th)) + Math.abs(L * Math.sin(th));
    const x0 = Math.round(32 - span / 2), x1 = Math.round(32 + span / 2);
    const side = Math.abs(Math.sin(th));        // 1 = broadside, 0 = nose-on
    const groundY = 30;
    const bodyTop = 14 + Math.round((1 - side) * 1);
    const roofTop = 6;

    /* body */
    for (let y = bodyTop; y <= groundY - 3; y++)
      for (let x = x0; x <= x1; x++) {
        const edge = (x === x0 || x === x1) ? -0.16 : 0;
        p.ink(x, y, bodyKey, bodyT + (y === bodyTop ? 0.22 : edge));
      }
    /* cabin, shorter than the body and set back a little at an angle */
    const cabW = Math.round(span * (0.42 + side * 0.16));
    const cabOff = Math.round(Math.sin(th) * span * 0.06);
    const cx0 = 32 - (cabW >> 1) + cabOff, cx1 = cx0 + cabW;
    for (let y = roofTop; y < bodyTop; y++)
      for (let x = cx0; x <= cx1; x++)
        p.ink(x, y, bodyKey, bodyT - 0.06);
    /* glass */
    for (let y = roofTop + 2; y < bodyTop - 1; y++)
      for (let x = cx0 + 2; x <= cx1 - 2; x++)
        p.ink(x, y, 'blue', 0.14 + (y - roofTop) * 0.02);
    p.hline(cx0, cx1, roofTop, bodyKey, bodyT + 0.26);
    /* wheels: two when broadside, one arch when end on */
    const wy = groundY - 3;
    const wheels = side > 0.4 ? [x0 + Math.round(span * 0.18), x1 - Math.round(span * 0.18)]
                              : [Math.round((x0 + x1) / 2)];
    for (const wx of wheels) {
      p.disc(wx, wy, 3.4, 'grey', 0.07);
      p.disc(wx, wy, 1.6, 'grey', 0.26);
    }
    /* lights, on whichever end is pointing anywhere near us */
    const facing = Math.cos(th);
    if (facing > 0.3) { p.disc(x0 + 3, bodyTop + 3, 1.6, 'bone', 0.86); p.disc(x1 - 3, bodyTop + 3, 1.6, 'bone', 0.86); }
    else if (facing < -0.3) { p.disc(x0 + 3, bodyTop + 3, 1.4, 'red', 0.66); p.disc(x1 - 3, bodyTop + 3, 1.4, 'red', 0.66); }
    /* the shadow it sits in */
    for (let x = x0; x <= x1; x++) { p.ink(x, groundY, 'grey', 0.05); p.ink(x, groundY + 1, 'grey', 0.06); }
    /* rust and filth, because nobody has moved these in a while */
    for (let i = 0; i < 40; i++) {
      const x = x0 + Math.floor(rng() * Math.max(1, span)), y = bodyTop + Math.floor(rng() * 12);
      if (rng() < 0.5) p.wash(x, y, 'rust', 0.24, 0.4);
    }
    p.snap(0.3);
    out.push(p);
  }
  return out;
}

/** Anything that is the same from every side: barrels, cans, bollards. */
function radial(draw, w = 32, h = 40, seed = 1) {
  const p = new Pix(w, h, seed, false);
  draw(p);
  p.snap(0.3);
  return new Array(8).fill(p);
}

/* ====================================================================
   Bake the lot
   ==================================================================== */
export function bakeSprites() {
  const bank = new SpriteBank();
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /* --- something visibly wrong, for a frame that does not exist --- */
  {
    const p = new Pix(32, 48, 1, false);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++)
      if (((x >> 2) + (y >> 2)) & 1) p.set(x, y, 255, 0, 255, 255);
    bank.addFrame('MISS', 'A', new Array(8).fill(p));
  }

  /* --- the Associate: a shuffle, arms hanging, one leg dragging --- */
  humanoidFrames(bank, 'ASSO', ASSOCIATE_SKIN,
    { stride: 22, lean: 13, armSwing: 13, drag: 0.7, headTilt: 12, headSide: -8, splay: 9, armSplay: 15 },
    { attack: { windSh: -30, windElb: 70, relSh: 74, relElb: 10, relSpread: 18 } });

  /* --- the Stocker: longer, lower, arms already out in front --- */
  humanoidFrames(bank, 'STKR', STOCKER_SKIN,
    { stride: 30, lean: 26, armSwing: 7, drag: 0.25, headTilt: 20, headSide: 0, splay: 13, armSplay: 26,
      armBase: 46, elbowBase: 40 },
    {
      rig: { ...F.RIG, thigh: 13, shin: 13, upperArm: 12, foreArm: 12, torsoR: 6.2, headR: 5.6, limbR: 3.0, armR: 2.5 },
      attack: { lean: 16, windSh: -18, windElb: 96, windSpread: 40, releaseLean: 26, relSh: 96, relElb: 6, relSpread: 30 },
      /* three attack frames, so everything after them shifts up one —
         exactly the way Doom's Imp differs from its Zombieman */
      letters: {
        attack: ['E', 'F', 'G'], pain: 'H',
        death: ['I', 'J', 'K', 'L', 'M'],
        xdeath: ['N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V'],
      },
    });

  /* --- fire, in three sizes --- */
  fireFrames(32, 48, 8, 7).forEach((p, i) =>
    bank.addFrame('FIRE', 'ABCDEFGH'[i], new Array(8).fill(p), { fullbright: true }));
  /* Scaled up with the ceiling: a fully involved gondola throws a flame
     about 160 units, which in a 352 room reads as serious and in the old
     176 one would have been through the tiles. */
  fireFrames(48, 64, 8, 19, { taper: 0.8 }).forEach((p, i) =>
    bank.addFrame('BLAZ', 'ABCDEFGH'[i], new Array(8).fill(p), { fullbright: true, scale: 2.5 }));
  fireFrames(24, 24, 6, 31, { taper: 0.9 }).forEach((p, i) =>
    bank.addFrame('EMBR', 'ABCDEF'[i], new Array(8).fill(p), { fullbright: true }));

  /* --- cars: three of them, so a car park is not one car forty times --- */
  const CARS = [['blue', 0.30, 501], ['red', 0.34, 502], ['bone', 0.44, 503],
                ['olive', 0.28, 504], ['grey', 0.24, 505]];
  CARS.forEach(([key, t, seed], i) =>
    bank.addFrame('CAR' + i, 'A', carViews(key, t, seed), { scale: 3.0 }));

  /* --- a trolley, abandoned mid-aisle --- */
  bank.addFrame('TRLY', 'A', radial(p => {
    for (let x = 4; x < 28; x += 3) p.vline(x, 8, 26, 'grey', 0.44);
    for (let y = 10; y < 26; y += 4) p.hline(4, 27, y, 'grey', 0.40);
    p.hline(3, 28, 8, 'grey', 0.62);
    p.hline(4, 27, 27, 'grey', 0.22);
    p.vline(3, 8, 27, 'grey', 0.5); p.vline(28, 8, 27, 'grey', 0.5);
    for (const wx of [6, 25]) { p.disc(wx, 36, 2.2, 'grey', 0.12); p.vline(wx, 27, 34, 'grey', 0.34); }
    p.hline(6, 25, 4, 'red', 0.5);                    // the handle
  }, 32, 40, 601), { scale: 1.1 });

  /* --- the yellow bollards outside the doors --- */
  bank.addFrame('BOLL', 'A', radial(p => {
    for (let y = 6; y < 40; y++)
      for (let x = 12; x < 21; x++) {
        const band = (y > 14 && y < 20) || (y > 28 && y < 34);
        p.ink(x, y, band ? 'grey' : 'yellow', band ? 0.12 : (0.62 - (x - 12) * 0.03));
      }
    p.disc(16, 6, 4.4, 'yellow', 0.74);
    for (let x = 10; x < 23; x++) p.ink(x, 40, 'grey', 0.06);
  }, 32, 42, 602));

  /* --- the reason the store is going to burn --- */
  bank.addFrame('GCAN', 'A', radial(p => {
    for (let y = 14; y < 36; y++) for (let x = 8; x < 25; x++)
      p.ink(x, y, 'red', 0.30 + (x < 14 ? 0.12 : 0) - (y > 30 ? 0.08 : 0));
    p.hline(8, 24, 14, 'red', 0.56);
    p.vline(8, 14, 35, 'red', 0.48);
    p.vline(24, 14, 35, 'red', 0.16);
    for (let x = 11; x < 22; x++) p.ink(x, 11, 'grey', 0.34);      // the handle
    p.vline(11, 11, 14, 'grey', 0.34); p.vline(21, 11, 14, 'grey', 0.34);
    for (let y = 8; y < 14; y++) for (let x = 24; x < 28; x++) p.ink(x, y, 'grey', 0.26);  // the spout
    drawTextCentred(p, 'FUEL', 16, 22, 'bone', 0.9);
    for (let x = 6; x < 27; x++) p.ink(x, 36, 'grey', 0.06);
  }, 32, 38, 603));

  /* --- a stack of cases, which is a fire waiting to be told about it --- */
  bank.addFrame('CRAT', 'A', radial(p => {
    const rng = makeRng(604);
    for (let row = 0; row < 3; row++) {
      const y0 = 40 - (row + 1) * 13;
      const w = 26 - row * 3, x0 = 16 - (w >> 1) + Math.round((rng() - 0.5) * 3);
      for (let y = y0; y < y0 + 13; y++) for (let x = x0; x < x0 + w; x++)
        p.ink(x, y, 'brown', 0.36 + rng() * 0.05);
      p.hline(x0, x0 + w - 1, y0, 'brown', 0.58);
      p.vline(x0, y0, y0 + 12, 'brown', 0.48);
      p.vline(x0 + w - 1, y0, y0 + 12, 'brown', 0.20);
      p.hline(x0, x0 + w - 1, y0 + 12, 'brown', 0.16);
      p.vline(x0 + (w >> 1), y0, y0 + 12, 'bone', 0.66);
    }
  }, 32, 42, 604), { scale: 1.4 });

  /* --- what is left where somebody was --- */
  bank.addFrame('BLUD', 'A', radial(p => {
    const rng = makeRng(605);
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2, d = rng() * 13;
      p.disc(16 + Math.cos(a) * d, 20 + Math.sin(a) * d * 0.4, 1 + rng() * 2.6, 'red', 0.10 + rng() * 0.12);
    }
  }, 32, 32, 605));

  /* --- things thrown at you, and things you throw --- */
  bank.addFrame('TINS', 'A', radial(p => {
    for (let y = 8; y < 22; y++) for (let x = 9; x < 19; x++)
      p.ink(x, y, 'grey', 0.42 + (x < 13 ? 0.16 : -0.06));
    p.hline(9, 18, 8, 'grey', 0.66); p.hline(9, 18, 21, 'grey', 0.14);
    for (let y = 12; y < 18; y++) p.hline(9, 18, y, 'red', 0.38 + (y === 12 ? 0.2 : 0));
  }, 28, 28, 606), { lift: 24 });

  bank.addFrame('MOLO', 'A', radial(p => {
    for (let y = 12; y < 26; y++) for (let x = 11; x < 19; x++)
      p.ink(x, y, 'green', 0.26 + (x < 15 ? 0.12 : -0.04));
    for (let y = 7; y < 12; y++) p.hline(13, 16, y, 'green', 0.32);
    p.disc(14, 5, 2.6, 'fire', 0.60);
    p.disc(14, 3, 1.8, 'fire', 0.88);
    p.disc(14, 1, 1.1, 'fire', 0.97);
  }, 30, 30, 607), { fullbright: true, lift: 24 });

  /* --- the blood that is still in the air --- */
  ['A', 'B', 'C'].forEach((L, i) => {
    bank.addFrame('PUFF', L, radial(p => {
      const rng = makeRng(700 + i);
      const spread = 3 + i * 4;
      for (let k = 0; k < 12 - i * 2; k++) {
        const a = rng() * Math.PI * 2, d = rng() * spread;
        p.disc(12 + Math.cos(a) * d, 12 + Math.sin(a) * d, 1.4 - i * 0.3, 'red', 0.34 - i * 0.08);
      }
    }, 24, 24, 700 + i), { lift: 24 });
  });

  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  console.log(`baked ${bank.frames.size} sprite frames in ${ms.toFixed(0)}ms`);
  return bank;
}

/* =====================================================================
   The things in your hands
   =====================================================================

   Doom drew the weapon as a sprite pinned to the bottom of the 320x200
   frame, bobbing with the walk, and that is exactly what these are.
   Sixty-four pixels each, blown up on screen, so they are as chunky as
   the walls — a crisp weapon over a chunky world is the fastest way to
   break the whole illusion.

   Three of them, and between them they are the game's argument:

     BOXCUTTER  free, silent, and it does not start fires. What you use
                when the fuel has gone.
     FLAMER     the main verb. Sets light to the aisle, the stock and
                whatever is walking down it.
     MOLOTOV    fire you can throw. The answer to a fire that will not
                cross a walkway.
   ===================================================================== */

function weaponPix(w, h, draw, seed) {
  const p = new Pix(w, h, seed, false);   // drawn off the edge on purpose
  draw(p, makeRng(seed));
  p.snap(0.3);
  return p;
}

/* A tapered bar between two points, lit from the top left like
   everything else. The weapons are all built out of these. */
function bar(p, x0, y0, x1, y1, r0, r1, key, t) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len, ny = dx / len;
  for (let s = 0; s <= len * 2; s++) {
    const f = s / (len * 2);
    const cx = x0 + dx * f, cy = y0 + dy * f, r = r0 + (r1 - r0) * f;
    for (let o = -Math.ceil(r); o <= Math.ceil(r); o++) {
      const d = Math.abs(o) / Math.max(0.6, r);
      if (d > 1) continue;
      /* the lit side is whichever one faces up and left */
      const lit = -(o / Math.max(0.6, r)) * (nx - ny) * 0.5 - d * 0.16;
      p.ink(Math.round(cx + nx * o), Math.round(cy + ny * o), key, Math.max(0.03, Math.min(0.97, t + lit * 0.42)));
    }
  }
}

function fist(p, cx, cy, r, key, t) {
  for (let y = -r; y <= r; y++)
    for (let x = -r * 1.15; x <= r * 1.15; x++) {
      const d = Math.hypot(x / 1.15, y);
      if (d > r) continue;
      p.ink(Math.round(cx + x), Math.round(cy + y), key, t + (-x - y) / (r * 5) - d / (r * 8));
    }
  /* knuckles */
  for (let k = -1; k <= 2; k++) p.ink(Math.round(cx + k * 2), Math.round(cy - r * 0.55), key, t - 0.10);
}

export function bakeWeapons() {
  const W = new Map();
  const add = (name, pix, opts = {}) => W.set(name, { pix, ...opts });

  /* ---- the boxcutter ----------------------------------------------
     Forearm out of the bottom-right corner, hand on the body, blade
     pointing up and left at the middle of the screen. The two swing
     frames carry the whole assembly through an arc rather than sliding
     it, so the blade travels further than the elbow does — which is what
     a swing is. */
  const cutter = (swing) => weaponPix(64, 64, (p) => {
    const ang = [-0.55, -1.15, -0.05][swing];      // wind, through, follow
    const reach = [0, 6, -3][swing];
    const ex = 58, ey = 66;                        // the elbow, off-frame
    const hx = Math.round(ex + Math.cos(ang) * (22 + reach));
    const hy = Math.round(ey + Math.sin(ang) * (22 + reach));
    bar(p, ex, ey, hx, hy, 5.4, 3.8, 'flesh', 0.40);          // forearm
    fist(p, hx, hy, 4.4, 'flesh', 0.44);                       // hand
    const bx = Math.round(hx + Math.cos(ang) * 9);
    const by = Math.round(hy + Math.sin(ang) * 9);
    bar(p, hx, hy, bx, by, 3.4, 2.8, 'yellow', 0.50);          // the body
    bar(p, hx, hy, bx, by, 1.2, 1.0, 'yellow', 0.28);          // its groove
    const tx = Math.round(bx + Math.cos(ang) * 11);
    const ty = Math.round(by + Math.sin(ang) * 11);
    bar(p, bx, by, tx, ty, 1.8, 0.9, 'grey', 0.88);            // the blade
    bar(p, bx, by, tx, ty, 0.6, 0.4, 'grey', 0.97);            // its edge
  }, 800 + swing * 7);
  add('CUTGA', cutter(0)); add('CUTGB', cutter(1)); add('CUTGC', cutter(2));

  /* ---- the flamer -------------------------------------------------
     A pressure sprayer with the tank strapped under the grip and a
     pilot flame on the nozzle. The nozzle sits low and right so the
     stream has the whole upper left of the frame to throw itself into,
     which is where the middle of the screen is from here. */
  const NOZ = [22, 22];
  const flamer = (fireFrame) => weaponPix(64, 64, (p, rng) => {
    const kick = fireFrame * 2;
    const gx = 46 - kick * 0.4, gy = 52 + kick;
    /* the tank */
    for (let y = Math.round(gy) - 2; y < 64; y++)
      for (let x = 48; x < 62; x++) {
        const edge = (x === 48 || x === 61) ? -0.14 : 0;
        p.ink(x, y, 'red', 0.30 + (x < 53 ? 0.12 : 0) + edge);
      }
    p.hline(48, 61, Math.round(gy) - 2, 'red', 0.56);
    bar(p, 54, Math.round(gy), 50, 40, 1.6, 1.4, 'grey', 0.34);   // feed hose
    /* the lance, grip to nozzle */
    bar(p, gx, gy, NOZ[0] + kick * 0.5, NOZ[1] + kick, 3.4, 2.4, 'grey', 0.32);
    bar(p, gx, gy, NOZ[0] + kick * 0.5, NOZ[1] + kick, 1.1, 0.8, 'grey', 0.52);
    /* the hand on the grip, and the forearm behind it */
    bar(p, 62, 66, gx + 3, gy + 4, 5.6, 4.2, 'flesh', 0.40);
    fist(p, Math.round(gx), Math.round(gy), 4.8, 'flesh', 0.44);
    /* the nozzle */
    bar(p, NOZ[0] + 5 + kick * 0.5, NOZ[1] + 5 + kick, NOZ[0] + kick * 0.5, NOZ[1] + kick, 3.0, 2.2, 'grey', 0.44);

    if (fireFrame === 0) {
      p.disc(NOZ[0] - 1, NOZ[1] - 2, 1.5, 'fire', 0.70);
      p.disc(NOZ[0] - 1, NOZ[1] - 4, 1.0, 'fire', 0.92);
    } else {
      /* The stream. Thrown up and to the left along a widening cone,
         hottest at the nozzle and cooling as it goes, with the far end
         breaking into separate blobs the way a real one does. */
      const n = fireFrame, ox = NOZ[0] + kick * 0.5, oy = NOZ[1] + kick;
      const count = 150 + n * 90;
      for (let i = 0; i < count; i++) {
        const t = Math.pow(rng(), 0.65);                 // bunched near the nozzle
        const reach = (16 + n * 9) * t;
        const spread = t * (5 + n * 4);
        const dirx = -0.72, diry = -0.70;
        const px = ox + dirx * reach + (rng() - 0.5) * spread * 2;
        const py = oy + diry * reach + (rng() - 0.5) * spread * 1.4;
        if (px < -3 || py < -3) continue;
        const heat = Math.max(0.10, 1.0 - t * (0.5 + rng() * 0.55));
        p.disc(Math.round(px), Math.round(py), 0.7 + (1 - t) * 2.6, 'fire', heat);
      }
    }
  }, 810 + fireFrame * 13);
  add('FLMGA', flamer(0));
  add('FLMGB', flamer(1), { fullbright: true });
  add('FLMGC', flamer(2), { fullbright: true });

  /* ---- the molotov ------------------------------------------------ */
  const molly = (stage) => weaponPix(64, 64, (p) => {
    if (stage === 2) {
      /* thrown: an empty hand still following through */
      bar(p, 60, 66, 40, 44, 5.6, 4.0, 'flesh', 0.40);
      fist(p, 39, 42, 4.6, 'flesh', 0.44);
      return;
    }
    const lift = stage === 1 ? -13 : 0;
    const bx = 40, by = 40 + lift;
    /* forearm and hand first, so the bottle sits IN it */
    bar(p, 60, 66, bx + 5, by + 20, 5.6, 4.2, 'flesh', 0.40);
    /* the bottle */
    for (let y = by; y < by + 19; y++)
      for (let x = bx - 6; x < bx + 6; x++) {
        const edge = (x === bx - 6 || x === bx + 5) ? -0.10 : 0;
        p.ink(x, y, 'green', 0.24 + (x < bx - 1 ? 0.11 : -0.03) + edge);
      }
    p.hline(bx - 6, bx + 5, by, 'green', 0.44);
    bar(p, bx, by, bx, by - 8, 2.6, 2.0, 'green', 0.28);        // the neck
    /* the fuel in it, and the line it stops at */
    for (let y = by + 6; y < by + 18; y++) p.hline(bx - 5, bx + 4, y, 'olive', 0.28 + (y - by) * 0.006);
    p.hline(bx - 5, bx + 4, by + 6, 'olive', 0.46);
    /* the hand, over the bottle */
    fist(p, bx + 1, by + 15, 5.0, 'flesh', 0.45);
    /* the rag and what is happening to it */
    bar(p, bx, by - 8, bx - 1, by - 14, 2.2, 1.6, 'bone', 0.66);
    p.disc(bx - 1, by - 17, 2.6, 'fire', 0.58);
    p.disc(bx - 1, by - 19, 1.8, 'fire', 0.84);
    p.disc(bx - 1, by - 21, 1.1, 'fire', 0.96);
  }, 820 + stage * 5);
  add('MOLGA', molly(0));
  add('MOLGB', molly(1));
  add('MOLGC', molly(2));

  for (const [, e] of W) { e.texture = null; e.w = e.pix.w; e.h = e.pix.h; }
  return W;
}

export function weaponTexture(entry) {
  if (entry.texture) return entry.texture;
  const t = new THREE.CanvasTexture(entry.pix.toCanvas());
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  entry.texture = t;
  return t;
}
