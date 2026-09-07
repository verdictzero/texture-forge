/* =====================================================================
   SELLWRONG — the pixel toolkit
   =====================================================================

   Every texture and every sprite in this game is generated here, in
   Javascript, at 64 pixels or less, and there is not an image file in the
   project. Two reasons, and the second is the real one.

   The first is that it loads instantly and weighs nothing.

   The second is that everything comes out of the same box of parts, so it
   all matches. A hand-drawn set of textures is only as coherent as the
   person drawing it was consistent; a generated set is coherent because
   the light comes from the same corner in all of them, the dirt is the
   same dirt, and every colour was drawn from the same fourteen ramps. The
   store looks like one store rather than like forty textures.

   THE LIGHT COMES FROM THE TOP LEFT. Always, everywhere, in every texture
   and every sprite. This is a rule, not a parameter. A rivet lit from the
   left next to a panel lit from the right is the single loudest way to
   make a wall look wrong, and the only defence is to never once make the
   choice.

   EVERYTHING TILES. A 64-pixel texture on a 512-unit wall repeats eight
   times, and a seam that would be invisible once is a stripe eight times.
   So the noise below wraps by construction — the lattice is indexed
   modulo its own size — rather than by blending the edges afterwards and
   hoping.
   ===================================================================== */

import { PALETTE, ramp, snapImageData } from './palette.js';
import { makeRng } from './util.js';

/* --------------------------------------------------------------------
   Tileable value noise

   A lattice of random values with smooth interpolation between them.
   `cells` must divide the texture size, and the lattice index wraps, so
   the result tiles exactly with no blending, no mirroring and no seam.
   ------------------------------------------------------------------ */
export function valueNoise(w, h, cells, seed) {
  const rng = makeRng(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rng();

  const out = new Float32Array(w * h);
  const sx = cells / w, sy = cells / h;
  for (let y = 0; y < h; y++) {
    const fy = y * sy, iy = Math.floor(fy), ty = fy - iy;
    const wy = ty * ty * (3 - 2 * ty);                  // smoothstep, not linear:
    const y0 = ((iy % cells) + cells) % cells;          // linear leaves visible
    const y1 = (y0 + 1) % cells;                        // creases on the lattice
    for (let x = 0; x < w; x++) {
      const fx = x * sx, ix = Math.floor(fx), tx = fx - ix;
      const wx = tx * tx * (3 - 2 * tx);
      const x0 = ((ix % cells) + cells) % cells;
      const x1 = (x0 + 1) % cells;
      const a = g[y0 * cells + x0], b = g[y0 * cells + x1];
      const c = g[y1 * cells + x0], d = g[y1 * cells + x1];
      out[y * w + x] = (a + (b - a) * wx) + ((c + (d - c) * wx) - (a + (b - a) * wx)) * wy;
    }
  }
  return out;
}

/** Octaves of value noise, each twice as fine and half as strong. */
export function fbm(w, h, baseCells, octaves, seed, gain = 0.5) {
  const out = new Float32Array(w * h);
  let amp = 1, total = 0, cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(w, h, cells, seed + o * 7919);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= gain;
    cells *= 2;
    if (cells > w) break;                    // finer than a texel is just noise
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Scattered points, tiling — the flecks in terrazzo, the grit in asphalt. */
export function speckle(w, h, count, seed, fn) {
  const rng = makeRng(seed);
  for (let i = 0; i < count; i++) fn(Math.floor(rng() * w), Math.floor(rng() * h), rng(), rng());
}

/* --------------------------------------------------------------------
   Pix — a small drawing surface that wraps

   Everything here takes coordinates modulo the size, so a shape drawn
   over the right-hand edge continues on the left. That is what makes a
   crack that runs off the texture reappear where it should, which is the
   difference between a tiling texture and a tiled one.
   ------------------------------------------------------------------ */
export class Pix {
  /**
   * `wrap` decides what happens when you draw off the edge, and getting
   * it wrong is invisible until it is baffling.
   *
   * A TEXTURE wraps. A crack that runs off the right-hand side has to
   * come back on the left or it becomes a dotted line eight repeats
   * later. Everything in textures.js depends on this.
   *
   * A SPRITE must not. A weapon is composed with its forearm running off
   * the bottom of the frame on purpose, and with wrapping on, that
   * forearm reappears at the TOP of the sprite — which is exactly what
   * happened: a brown triangle floating in the sky at a fixed point on
   * screen, in every shot, from every angle.
   */
  constructor(w, h = w, seed = 1, wrap = true) {
    this.w = w; this.h = h;
    this.wrap = wrap;
    this.data = new Uint8ClampedArray(w * h * 4);
    this.rng = makeRng(seed);
    this.seed = seed;
  }

  /** -1 means "off the edge, and this surface does not wrap". Every
   *  writer below checks for it. */
  idx(x, y) {
    if (this.wrap) {
      x = ((x % this.w) + this.w) % this.w;
      y = ((y % this.h) + this.h) % this.h;
    } else {
      x |= 0; y |= 0;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    }
    return (y * this.w + x) * 4;
  }

  set(x, y, r, g, b, a = 255) {
    const i = this.idx(x, y);
    if (i < 0) return;
    const d = this.data;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
  }

  /* The workhorse. Nothing in this project picks a colour any other way:
     a ramp name and a position along it. */
  ink(x, y, key, t, a = 255) {
    const c = ramp(key, t);
    this.set(x, y, c[0], c[1], c[2], a);
  }

  /* Blend toward a ramp colour — how dirt, shadow and stains go on over
     whatever was already there. */
  wash(x, y, key, t, amount) {
    if (amount <= 0) return;
    const i = this.idx(x, y), d = this.data;
    if (i < 0) return;
    const c = ramp(key, t);
    const k = amount > 1 ? 1 : amount;
    d[i]     += (c[0] - d[i]) * k;
    d[i + 1] += (c[1] - d[i + 1]) * k;
    d[i + 2] += (c[2] - d[i + 2]) * k;
  }

  /* Multiply what is there — shading that keeps the material's own hue,
     which is the difference between a shadow and a grey smear. */
  shade(x, y, mul) {
    const i = this.idx(x, y), d = this.data;
    if (i < 0) return;
    d[i] *= mul; d[i + 1] *= mul; d[i + 2] *= mul;
  }

  get(x, y) {
    const i = this.idx(x, y), d = this.data;
    if (i < 0) return [0, 0, 0, 0];
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }
  alphaAt(x, y) { const i = this.idx(x, y); return i < 0 ? 0 : this.data[i + 3]; }

  fill(key, t) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.ink(x, y, key, t);
  }
  clear() { this.data.fill(0); }

  /** fn(x, y) -> [key, t] | null. The general "paint this region" call. */
  rect(x0, y0, w, h, fn) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const c = fn(x, y, x - x0, y - y0);
        if (c) this.ink(x, y, c[0], c[1], c[2] === undefined ? 255 : c[2]);
      }
    }
  }
  box(x0, y0, w, h, key, t, a = 255) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.ink(x, y, key, t, a);
  }
  hline(x0, x1, y, key, t, a = 255) { for (let x = x0; x <= x1; x++) this.ink(x, y, key, t, a); }
  vline(x, y0, y1, key, t, a = 255) { for (let y = y0; y <= y1; y++) this.ink(x, y, key, t, a); }
  frame(x0, y0, w, h, key, t) {
    this.hline(x0, x0 + w - 1, y0, key, t);
    this.hline(x0, x0 + w - 1, y0 + h - 1, key, t);
    this.vline(x0, y0, y0 + h - 1, key, t);
    this.vline(x0 + w - 1, y0, y0 + h - 1, key, t);
  }

  /* Bresenham, wrapping. Used for cracks, scratches and cable runs. */
  line(x0, y0, x1, y1, key, t, a = 255) {
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (;;) {
      this.ink(x0, y0, key, t, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  disc(cx, cy, r, key, t, a = 255) {
    const r2 = r * r;
    for (let y = -Math.ceil(r); y <= Math.ceil(r); y++)
      for (let x = -Math.ceil(r); x <= Math.ceil(r); x++)
        if (x * x + y * y <= r2) this.ink(cx + x, cy + y, key, t, a);
  }

  /* --------------------------------------------------------------------
     Relief

     Give it a height field and it lights the surface from the top left,
     everywhere, forever. A raised edge catches light on its top and left
     and drops shadow on its bottom and right — which is the whole of the
     lighting model in a texture like this, and the reason a 64-pixel
     brick reads as a brick.

     The difference is taken with WRAPPING neighbours, so relief on a
     feature that crosses the edge of the texture is continuous with the
     copy next door.
     ------------------------------------------------------------------ */
  emboss(height, strength = 0.35, ambient = 1.0) {
    const { w, h } = this;
    const out = new Uint8ClampedArray(this.data);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = height[y * w + x];
        const l = height[y * w + ((x - 1 + w) % w)];
        const u = height[((y - 1 + h) % h) * w + x];
        /* Slope toward the light, top-left. Positive means this pixel
           rises away from its lit neighbours, so it catches light. */
        const slope = ((c - l) + (c - u)) * 0.5;
        const k = ambient + slope * strength * 8;
        const i = (y * w + x) * 4;
        out[i]     = this.data[i]     * k;
        out[i + 1] = this.data[i + 1] * k;
        out[i + 2] = this.data[i + 2] * k;
      }
    }
    this.data.set(out);
    return this;
  }

  /* A one-pixel dark line down the right and bottom of a rectangle and a
     light one up its top and left. The cheapest possible relief, and on a
     64-pixel texture usually the most convincing. */
  bevel(x0, y0, w, h, lightKey, lightT, darkKey, darkT) {
    this.hline(x0, x0 + w - 1, y0, lightKey, lightT);
    this.vline(x0, y0, y0 + h - 1, lightKey, lightT);
    this.hline(x0, x0 + w - 1, y0 + h - 1, darkKey, darkT);
    this.vline(x0 + w - 1, y0, y0 + h - 1, darkKey, darkT);
  }

  /** Grime in the corners and along the bottom — where it actually
   *  collects in a building nobody has cleaned since the incident. */
  grime(amount = 0.35, key = 'grey', t = 0.06, seed = 3) {
    const n = fbm(this.w, this.h, 4, 3, seed + this.seed);
    for (let y = 0; y < this.h; y++) {
      const low = Math.pow(y / (this.h - 1), 2.2);      // heaviest at the skirting
      for (let x = 0; x < this.w; x++) {
        const v = n[y * this.w + x];
        this.wash(x, y, key, t, amount * low * (0.35 + v * 0.9));
      }
    }
    return this;
  }

  /** Copy another Pix in, honouring its alpha. Sprites are assembled this
   *  way — a body, then arms, then a head, each drawn once. */
  blit(src, dx, dy) {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const a = src.alphaAt(x, y);
        if (a < 8) continue;
        const c = src.get(x, y);
        this.set(dx + x, dy + y, c[0], c[1], c[2], a);
      }
    }
    return this;
  }

  /** Mirror left-to-right — how a sprite's 8 rotations get away with
   *  drawing only 5 of them, exactly as Doom's own sprites did. */
  mirrored() {
    const p = new Pix(this.w, this.h, this.seed, this.wrap);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = this.get(this.w - 1 - x, y);
        p.set(x, y, c[0], c[1], c[2], c[3]);
      }
    return p;
  }

  /* Snap every pixel to the palette. Called once, at the end, on
     everything — so what ends up on the wall is genuinely 256-colour art
     and not a truecolour image that merely looks like one. */
  snap(dither = 0) {
    const img = { data: this.data, width: this.w, height: this.h };
    snapImageData(img, dither);
    return this;
  }

  toCanvas() {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(this.w, this.h);
    img.data.set(this.data);
    ctx.putImageData(img, 0, 0);
    return c;
  }
}

/* --------------------------------------------------------------------
   A tiny 4x6 typeface

   For price tags, aisle numbers and the word SELLWRONG on the front of
   the building. The canvas API could draw text, but it antialiases, and
   antialiased text snapped to a 256-colour palette at 64 pixels turns to
   mud. Bitmaps it is. Six rows of four bits each, packed one row per
   nibble-pair — legible at this size, which is the only requirement.
   ------------------------------------------------------------------ */
const FONT = {
  A:[0x6,0x9,0x9,0xF,0x9,0x9], B:[0xE,0x9,0xE,0x9,0x9,0xE], C:[0x6,0x9,0x8,0x8,0x9,0x6],
  D:[0xE,0x9,0x9,0x9,0x9,0xE], E:[0xF,0x8,0xE,0x8,0x8,0xF], F:[0xF,0x8,0xE,0x8,0x8,0x8],
  G:[0x6,0x9,0x8,0xB,0x9,0x7], H:[0x9,0x9,0xF,0x9,0x9,0x9], I:[0x7,0x2,0x2,0x2,0x2,0x7],
  J:[0x1,0x1,0x1,0x1,0x9,0x6], K:[0x9,0xA,0xC,0xC,0xA,0x9], L:[0x8,0x8,0x8,0x8,0x8,0xF],
  M:[0x9,0xF,0xF,0x9,0x9,0x9], N:[0x9,0xD,0xF,0xB,0x9,0x9], O:[0x6,0x9,0x9,0x9,0x9,0x6],
  P:[0xE,0x9,0x9,0xE,0x8,0x8], Q:[0x6,0x9,0x9,0xB,0xA,0x5], R:[0xE,0x9,0x9,0xE,0xA,0x9],
  S:[0x7,0x8,0x6,0x1,0x1,0xE], T:[0xF,0x4,0x4,0x4,0x4,0x4], U:[0x9,0x9,0x9,0x9,0x9,0x6],
  V:[0x9,0x9,0x9,0x9,0x6,0x6], W:[0x9,0x9,0x9,0xF,0xF,0x9], X:[0x9,0x9,0x6,0x6,0x9,0x9],
  Y:[0x9,0x9,0x6,0x4,0x4,0x4], Z:[0xF,0x1,0x2,0x4,0x8,0xF],
  0:[0x6,0x9,0xB,0xD,0x9,0x6], 1:[0x2,0x6,0x2,0x2,0x2,0x7], 2:[0x6,0x9,0x1,0x2,0x4,0xF],
  3:[0xE,0x1,0x6,0x1,0x1,0xE], 4:[0x9,0x9,0xF,0x1,0x1,0x1], 5:[0xF,0x8,0xE,0x1,0x1,0xE],
  6:[0x6,0x8,0xE,0x9,0x9,0x6], 7:[0xF,0x1,0x2,0x4,0x4,0x4], 8:[0x6,0x9,0x6,0x9,0x9,0x6],
  9:[0x6,0x9,0x9,0x7,0x1,0x6],
  '.':[0,0,0,0,0,0x4], ',':[0,0,0,0,0x4,0x8], '!':[0x4,0x4,0x4,0x4,0,0x4],
  '?':[0x6,0x9,0x1,0x2,0,0x2], '-':[0,0,0,0xF,0,0], '$':[0x6,0xD,0x6,0xB,0x6,0x4],
  '%':[0x9,0x1,0x2,0x4,0x8,0x9], '/':[0x1,0x1,0x2,0x4,0x8,0x8], ':':[0,0x4,0,0,0x4,0],
  '&':[0x4,0xA,0x4,0xA,0x9,0x7], "'":[0x4,0x4,0,0,0,0], ' ':[0,0,0,0,0,0],
};

export function textWidth(str, spacing = 1) { return str.length * (4 + spacing) - spacing; }

export function drawText(pix, str, x, y, key, t, spacing = 1) {
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const g = FONT[ch] || FONT[' '];
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 4; c++)
        if (g[r] & (8 >> c)) pix.ink(cx + c, y + r, key, t);
    cx += 4 + spacing;
  }
  return cx;
}

/** Same, centred on a given x. */
export function drawTextCentred(pix, str, cx, y, key, t, spacing = 1) {
  return drawText(pix, str, cx - (textWidth(str, spacing) >> 1), y, key, t, spacing);
}
