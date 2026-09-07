/* =====================================================================
   SELLWRONG — bringing real artwork in
   =====================================================================

     node tools/bake-art.mjs

   Everything else in this game is drawn by code at start-up. Two things
   cannot be: the LOGO, because a procedural approximation of somebody's
   logo is not their logo, and the WEAPON, because it is a photograph of
   a thing and there is no set of primitives that gets you there.

   So they come in as pictures and leave as SOURCE. This reads the PNGs
   in art/, finds the artwork inside each one, resamples it, snaps every
   pixel to the game's own 256-colour palette, run-length encodes it and
   writes js/art-data.js. Nothing is fetched at run time and there is
   still no build step — the build step is this file, run by hand, when
   the art changes.

   TWO WAYS OF FINDING THE ARTWORK, because the two files were made
   differently. The logo sits on a black field, so it is found by
   brightness and saturation. The weapon sits on chroma-key magenta, so
   it is found by "not that colour" — which is also how it gets its alpha
   channel, because a weapon has to be cut out, not letterboxed.

   WHY FOUR TILES FOR THE LOGO. Sixty-four pixels is the rule for every
   texture in the game and the logo does not get an exemption; it gets
   geometry instead. The four tiles are hung as a two-by-two on the
   entrance tower, which is two ceiling steps and one vertical split —
   see the sign box in js/maps/sellwrong.js. A sector engine cannot draw
   a big picture, but it can draw four small ones next to each other,
   which is the same thing and is how every large sign in Doom was done.

   THE WEAPON IS ONE TILE and it is 64x64 like everything else, with the
   gun laid across the bottom at its own aspect and the top of the frame
   left empty. That empty space is not waste: it is where the muzzle
   flame is drawn, procedurally, over the top of the photograph — which
   is how Doom did its weapons too, one still sprite and a separate
   flash.

   THE ENCODING is run-length pairs of (palette index, count) in base64.
   A logo is mostly flat colour, so a 4096-pixel tile comes out around a
   kilobyte, and the decoder is nine lines that run unchanged in Node and
   in the browser.
   ===================================================================== */

import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
import fs from 'node:fs';
import zlib from 'node:zlib';

const { PALETTE } = await import('../js/palette.js');

/* ---------- a PNG reader, only as much as one is ---------- */
function readPNG(file) {
  const d = fs.readFileSync(file);
  let pos = 8, w = 0, h = 0, bitDepth = 8, colorType = 6, idat = [];
  let palette = null, trns = null;
  while (pos < d.length) {
    const len = d.readUInt32BE(pos), type = d.toString('ascii', pos + 4, pos + 8);
    const data = d.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} not supported`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`colour type ${colorType} not supported`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride), p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride)); p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 255;
      else if (filter === 2) line[i] = (line[i] + b) & 255;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(out, y * stride); prev = line;
  }

  /* everything becomes RGBA, whatever it arrived as */
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * channels, o = i * 4;
    if (colorType === 6) { rgba[o] = out[s]; rgba[o+1] = out[s+1]; rgba[o+2] = out[s+2]; rgba[o+3] = out[s+3]; }
    else if (colorType === 2) { rgba[o] = out[s]; rgba[o+1] = out[s+1]; rgba[o+2] = out[s+2]; rgba[o+3] = 255; }
    else if (colorType === 0) { rgba[o] = rgba[o+1] = rgba[o+2] = out[s]; rgba[o+3] = 255; }
    else if (colorType === 4) { rgba[o] = rgba[o+1] = rgba[o+2] = out[s]; rgba[o+3] = out[s+1]; }
    else { const q = out[s] * 3; rgba[o] = palette[q]; rgba[o+1] = palette[q+1]; rgba[o+2] = palette[q+2];
           rgba[o+3] = trns && out[s] < trns.length ? trns[out[s]] : 255; }
  }
  return { w, h, data: rgba };
}

/* ---------- where the artwork is ----------
   The bounding box of everything that is not the background. Background
   is judged as "dark AND unsaturated", which keeps the black outline and
   the black trolley — both of which are the logo — and drops the field
   they are sitting on.

   SATURATION IS MEANINGLESS IN THE DARK, and that is worth stating
   because it cost an iteration: (0, 2, 1) — a single unit of compression
   noise on a black field — has a max of 2 and a min of 0, so
   (max-min)/max is 1.0 and it reads as the most saturated pixel in the
   image. Every corner of a black background therefore counted as
   artwork, and the crop came out as the whole picture. Saturation only
   means anything above a brightness floor. */
const INK = 40;                    // below this, a pixel is background
function artBounds(img) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const o = (y * img.w + x) * 4;
      const r = img.data[o], g = img.data[o+1], b = img.data[o+2], a = img.data[o+3];
      if (a < 8) continue;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      /* Saturated OR bright, and in either case not in the dark. The
         white script and the red band both pass; a black field does not. */
      if (!(mx > INK && (sat > 0.35 || mx > 150))) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}

/* Anything separated from the main mass by a gap of empty columns is a
   watermark, a sparkle, or somebody's corner logo, and is not wanted. */
function trimOutliers(img, [x0, y0, x1, y1]) {
  const col = new Int32Array(img.w);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const o = (y * img.w + x) * 4;
      const r = img.data[o], g = img.data[o+1], b = img.data[o+2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx > INK && ((mx - mn) / mx > 0.35 || mx > 150)) col[x]++;
    }
  /* the widest run of non-empty columns wins */
  let best = [x0, x0], run = null;
  for (let x = x0; x <= x1 + 1; x++) {
    /* A handful of stray pixels is not a column of artwork — the
       sparkle in the corner of this particular file lit up two columns
       at a threshold of zero. */
    if (x <= x1 && col[x] > 2) { if (!run) run = [x, x]; else run[1] = x; }
    else if (run) { if (run[1] - run[0] > best[1] - best[0]) best = run; run = null; }
  }
  return [best[0], y0, best[1], y1];
}

/* ---------- resampling ---------- */
function resample(img, box, W, H) {
  const [bx0, by0, bx1, by1] = box;
  const sw = bx1 - bx0 + 1, sh = by1 - by0 + 1;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy0 = by0 + (y * sh) / H, sy1 = by0 + ((y + 1) * sh) / H;
    for (let x = 0; x < W; x++) {
      const sx0 = bx0 + (x * sw) / W, sx1 = bx0 + ((x + 1) * sw) / W;
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = Math.floor(sy0); yy < Math.max(Math.ceil(sy1), Math.floor(sy0) + 1); yy++)
        for (let xx = Math.floor(sx0); xx < Math.max(Math.ceil(sx1), Math.floor(sx0) + 1); xx++) {
          if (xx < 0 || yy < 0 || xx >= img.w || yy >= img.h) continue;
          const o = (yy * img.w + xx) * 4;
          r += img.data[o]; g += img.data[o+1]; b += img.data[o+2]; n++;
        }
      const o = (y * W + x) * 4;
      out[o] = r / n; out[o+1] = g / n; out[o+2] = b / n; out[o+3] = 255;
    }
  }
  return { w: W, h: H, data: out };
}

/* ---------- to the game's palette ---------- */
const nearest = (r, g, b) => {
  let best = 0, bd = Infinity;
  for (let i = 0; i < PALETTE.length; i++) {
    const c = PALETTE[i];
    const dr = r - c[0], dg = g - c[1], db = b - c[2];
    /* the same 3:6:1 weighting the rest of the palette work uses */
    const d = dr * dr * 3 + dg * dg * 6 + db * db;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
};

/* ---------- run-length, then base64 ---------- */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function encode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] +
           (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') +
           (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}
function rle(indices) {
  const out = [];
  let i = 0;
  while (i < indices.length) {
    const v = indices[i]; let n = 1;
    while (i + n < indices.length && indices[i + n] === v && n < 255) n++;
    out.push(v, n); i += n;
  }
  return out;
}

/* ---------- chroma key ----------
   Magenta out, alpha in. The test is in hue terms rather than distance
   from one exact colour, because the edges of a keyed image are a smooth
   run of half-magenta pixels and a distance test either keeps a violet
   fringe or eats the artwork. Anything where red and blue both clearly
   beat green is the key. */
function chromaCut(img) {
  for (let i = 0; i < img.w * img.h; i++) {
    const o = i * 4;
    const r = img.data[o], g = img.data[o + 1], b = img.data[o + 2];
    const key = r > g + 40 && b > g + 40 && r > 80 && b > 80;
    if (key) { img.data[o + 3] = 0; continue; }
    /* Half-keyed edge pixels: pull the magenta back out of them, or the
       whole silhouette gets a violet rim that survives palette snapping
       and reads as a halo. */
    const spill = Math.min(r, b) - g;
    if (spill > 0) {
      img.data[o] = r - spill * 0.7;
      img.data[o + 2] = b - spill * 0.7;
    }
  }
  return img;
}

/** Bounding box of everything still opaque. */
function alphaBounds(img) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      if (img.data[(y * img.w + x) * 4 + 3] < 128) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  return [x0, y0, x1, y1];
}

/** Resample carrying alpha, weighting colour by coverage. */
function resampleRGBA(img, box, W, H) {
  const [bx0, by0, bx1, by1] = box;
  const sw = bx1 - bx0 + 1, sh = by1 - by0 + 1;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy0 = by0 + (y * sh) / H, sy1 = by0 + ((y + 1) * sh) / H;
    for (let x = 0; x < W; x++) {
      const sx0 = bx0 + (x * sw) / W, sx1 = bx0 + ((x + 1) * sw) / W;
      let r = 0, g = 0, b = 0, a = 0, n = 0, cov = 0;
      for (let yy = Math.floor(sy0); yy < Math.max(Math.ceil(sy1), Math.floor(sy0) + 1); yy++)
        for (let xx = Math.floor(sx0); xx < Math.max(Math.ceil(sx1), Math.floor(sx0) + 1); xx++) {
          if (xx < 0 || yy < 0 || xx >= img.w || yy >= img.h) continue;
          const o = (yy * img.w + xx) * 4, w = img.data[o + 3] / 255;
          r += img.data[o] * w; g += img.data[o + 1] * w; b += img.data[o + 2] * w;
          a += img.data[o + 3]; cov += w; n++;
        }
      const o = (y * W + x) * 4, c = Math.max(1e-6, cov);
      out[o] = r / c; out[o + 1] = g / c; out[o + 2] = b / c;
      /* One threshold, no dithered edge: the renderer alpha-tests at 0.5
         and a soft edge would just be a hard edge in a random place. */
      out[o + 3] = (a / n) > 110 ? 255 : 0;
    }
  }
  return { w: W, h: H, data: out };
}

/* ---------- go ---------- */
const HERE = new URL('.', import.meta.url);
const art = f => new URL('../art/' + f, HERE);

/* ===== the logo: four tiles, no alpha ===== */
function bakeLogo() {
  const img = readPNG(art('logo.png'));
  const box = trimOutliers(img, artBounds(img));
  const [bx0, by0, bx1, by1] = box;
  const SW = bx1 - bx0 + 1, SH = by1 - by0 + 1;
  const PAD = Math.round(Math.max(SW, SH) * 0.03);
  const padded = [Math.max(0, bx0 - PAD), Math.max(0, by0 - PAD),
                  Math.min(img.w - 1, bx1 + PAD), Math.min(img.h - 1, by1 + PAD)];
  const small = resample(img, padded, 128, 128);
  const tiles = [];
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
    const idx = new Uint8Array(64 * 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const o = ((ty * 64 + y) * 128 + (tx * 64 + x)) * 4;
      idx[y * 64 + x] = nearest(small.data[o], small.data[o + 1], small.data[o + 2]);
    }
    tiles.push(encode(rle(idx)));
  }
  const aspect = (padded[2] - padded[0] + 1) / (padded[3] - padded[1] + 1);
  console.log(`logo:   artwork ${SW}x${SH}, aspect ${aspect.toFixed(3)}, ` +
              `${tiles.reduce((a, t) => a + t.length, 0)} chars`);
  return { tiles, aspect };
}

/* ===== the weapon: one 64x64 tile, cut out, laid along the bottom =====
   Index 255 is the transparent one. That costs a palette entry and buys
   a decoder that is the same nine lines as the logo's — the alternative
   is a second plane of alpha for a picture that is either on or off. */
const CLEAR = 255;
function bakeWeapon() {
  const img = chromaCut(readPNG(art('flamer.png')));
  const [bx0, by0, bx1, by1] = alphaBounds(img);
  const SW = bx1 - bx0 + 1, SH = by1 - by0 + 1;
  const aspect = SW / SH;
  /* Full width, natural aspect, sitting on the bottom edge. What is left
     above it is where the flame goes. */
  const w = 64, h = Math.max(1, Math.min(64, Math.round(64 / aspect)));
  const small = resampleRGBA(img, [bx0, by0, bx1, by1], w, h);
  const idx = new Uint8Array(64 * 64).fill(CLEAR);
  const top = 64 - h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    if (small.data[o + 3] < 128) continue;
    idx[(top + y) * 64 + x] = Math.min(254, nearest(small.data[o], small.data[o + 1], small.data[o + 2]));
  }
  const packed = encode(rle(idx));
  console.log(`weapon: artwork ${SW}x${SH}, aspect ${aspect.toFixed(3)}, ` +
              `drawn ${w}x${h} at y ${top}, ${packed.length} chars`);
  return { tile: packed, aspect, drawnH: h, top };
}

const logo = bakeLogo();
const gun = bakeWeapon();

const out = `/* GENERATED by tools/bake-art.mjs — do not edit by hand.

   Real artwork, resampled, snapped to the game's 256 colours and
   run-length encoded. Sources are in art/; re-run the tool when they
   change and read the numbers it prints.

   Palette index ${CLEAR} means TRANSPARENT in the weapon tile. The logo
   tiles are fully opaque and use all 256. */

/** Width over height of the logo artwork the four tiles were cut from.
    SIGN_W / SIGN_H in js/maps/sellwrong.js has to match this or the
    logo comes out stretched; the smoke test checks that it does. */
export const LOGO_ASPECT = ${logo.aspect.toFixed(4)};

/** Logo tiles in reading order: top-left, top-right, bottom-left, bottom-right. */
export const LOGO_TILES = [
${logo.tiles.map(t => '  ' + JSON.stringify(t)).join(',\n')},
];

/** The palette index that means "nothing here" in the weapon tile. */
export const CLEAR_INDEX = ${CLEAR};

/** The flamethrower, cut out of its chroma key and laid along the
    bottom of a 64x64 frame. Rows 0..${gun.top - 1} are empty, and that is
    deliberate: it is where the muzzle flame is drawn. */
export const WEAPON_TILE = ${JSON.stringify(gun.tile)};
export const WEAPON_TOP = ${gun.top};
`;
fs.writeFileSync(new URL('../js/art-data.js', HERE), out);
console.log(`wrote js/art-data.js (${out.length} bytes)`);
