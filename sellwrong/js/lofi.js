/* =====================================================================
   SELLWRONG — the lo-fi pipeline
   =====================================================================

   The whole game is drawn into a buffer about 320 pixels tall and then
   thrown at the screen with no smoothing whatsoever. Everything else in
   here follows from that one decision.

   WHY A FIXED HEIGHT AND NOT A FIXED SIZE. Doom was 320x200 on a 4:3
   monitor, which nobody has any more. Lock the width too and a modern
   window gets black bars down both sides; let both float and the game
   gets sharper on a bigger monitor, which is the exact opposite of the
   point. So the vertical resolution is fixed — that is the "how chunky
   is it" control — and the width follows the window's shape. The camera's
   field of view is vertical, so a wider window shows you MORE STORE
   rather than the same store stretched, which is how a widescreen port
   ought to behave.

   WHY THE HUD GOES IN THE SAME BUFFER. If the status bar and the weapon
   in your hands are drawn at native resolution over a chunky world, the
   whole illusion collapses — you get a crisp modern overlay sitting on a
   retro photograph. So the overlay scene renders into the same low-res
   target, at the same chunk size, and the palette snap eats all of it
   together.

   THE ORDER MATTERS. Dither, then snap. Dithering after the snap would
   just put colours back that the palette does not contain. Dither first
   and the error the snap is about to make gets spread into a fine
   checker instead of a hard band, which is how a 256-colour gradient
   ever looked like a gradient.
   ===================================================================== */

import * as THREE from 'three';
import { buildLutAtlas, LUT_SIZE } from './palette.js';

const POST_VERT = /* glsl */`
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const POST_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tFrame;
uniform sampler2D tLut;
uniform vec2  uFrameSize;     // the low-res buffer, in pixels
uniform float uDither;        // 0 = off, ~1 = one palette step of wobble
uniform float uLutSize;
uniform float uSnap;          // 0 = truecolour passthrough, 1 = full palette
varying vec2 vUv;

/* 4x4 ordered Bayer, built the way Bayer matrices are actually defined:
   recursively out of the 2x2 one. M4(x,y) = 4*M2(low bits) + M2(high
   bits), where M2 is [[0,2],[3,1]] and works out to (2x+3y) mod 4. Four
   lines of arithmetic instead of a 16-entry uniform array and the
   dependent read that comes with it. */
float bayer2(float x, float y) { return mod(2.0 * x + 3.0 * y, 4.0); }

float bayer4(vec2 p) {
  vec2 f = mod(floor(p), 4.0);
  float lo = bayer2(mod(f.x, 2.0), mod(f.y, 2.0));
  float hi = bayer2(floor(f.x * 0.5), floor(f.y * 0.5));
  return 4.0 * lo + hi;                 // 0..15
}

/* Nearest palette entry, via the atlas: 32 slices of 32x32 side by side.
   Blue picks the slice, red is x within it, green is y. Sampled NEAREST,
   so this is a genuine snap and not a blend of two palette entries — a
   blend would put colours on screen that are not in the palette, which
   is the one thing this whole file exists to prevent. */
vec3 palSnap(vec3 c) {
  float N = uLutSize;
  c = clamp(c, 0.0, 1.0);
  float r = floor(c.r * (N - 1.0) + 0.5);
  float g = floor(c.g * (N - 1.0) + 0.5);
  float b = floor(c.b * (N - 1.0) + 0.5);
  vec2 uv = vec2((b * N + r + 0.5) / (N * N), (g + 0.5) / N);
  return texture2D(tLut, uv).rgb;
}

void main() {
  vec3 c = texture2D(tFrame, vUv).rgb;

  if (uDither > 0.0) {
    vec2 px = vUv * uFrameSize;
    /* Bayer as an ordered threshold in -0.5..0.5, scaled to about one
       palette step. Bigger than that and it stops being dither and
       starts being noise. */
    float t = (bayer4(px) / 15.0 - 0.5) * uDither * (1.0 / 32.0);
    c += t;
  }

  vec3 snapped = palSnap(c);
  gl_FragColor = vec4(mix(c, snapped, uSnap), 1.0);
}
`;

export class LofiPipeline {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} opts
   *   height   internal vertical resolution — the chunkiness control
   *   dither   ordered-dither strength before the palette snap
   *   snap     0..1 blend toward the palette; 1 is the honest answer
   */
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.height = opts.height ?? 200;
    this.maxWidth = opts.maxWidth ?? 1024;

    this.target = new THREE.WebGLRenderTarget(320, this.height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.target.texture.generateMipmaps = false;

    /* The palette, as a texture. Built once — 32768 nearest-colour
       searches, about 40ms, and then never again. */
    const atlas = buildLutAtlas();
    this.lut = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RGBAFormat);
    this.lut.minFilter = THREE.NearestFilter;
    this.lut.magFilter = THREE.NearestFilter;
    this.lut.wrapS = this.lut.wrapT = THREE.ClampToEdgeWrapping;
    this.lut.generateMipmaps = false;
    this.lut.needsUpdate = true;

    this.material = new THREE.RawShaderMaterial({
      uniforms: {
        tFrame:     { value: this.target.texture },
        tLut:       { value: this.lut },
        uFrameSize: { value: new THREE.Vector2(320, this.height) },
        uDither:    { value: opts.dither ?? 1.0 },
        uLutSize:   { value: LUT_SIZE },
        uSnap:      { value: opts.snap ?? 1.0 },
      },
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
    });

    /* One triangle, not two. A full-screen triangle has no seam down the
       diagonal and shades every pixel exactly once. */
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new THREE.Mesh(geo, this.material);
    this.quad.frustumCulled = false;
    this.postScene = new THREE.Scene();
    this.postScene.add(this.quad);
    this.postCamera = new THREE.Camera();

    this.width = 320;
    this.displayW = 640;
    this.displayH = 400;
  }

  /* Called on resize, and whenever the chunkiness control moves. */
  resize(displayW, displayH) {
    this.displayW = Math.max(1, displayW);
    this.displayH = Math.max(1, displayH);
    const aspect = this.displayW / this.displayH;
    const h = this.height;
    const w = Math.min(this.maxWidth, Math.max(64, Math.round(h * aspect)));
    if (w !== this.width || this.target.height !== h) {
      this.width = w;
      this.target.setSize(w, h);
      this.material.uniforms.uFrameSize.value.set(w, h);
    }
    this.renderer.setSize(this.displayW, this.displayH, false);
    return { width: w, height: h };
  }

  setHeight(h) {
    this.height = Math.max(60, Math.round(h));
    this.resize(this.displayW, this.displayH);
  }

  get aspect() { return this.width / this.height; }

  /**
   * World first, then the overlay on top of it, both into the low-res
   * buffer; then the whole buffer through the palette and onto the screen.
   * The overlay clears depth but not colour, so the weapon draws over the
   * world without the world's depth values fighting it.
   */
  render(scene, camera, overlayScene, overlayCamera) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.clear(true, true, true);
    r.render(scene, camera);
    if (overlayScene && overlayCamera) {
      r.clearDepth();
      r.render(overlayScene, overlayCamera);
    }
    r.setRenderTarget(null);
    r.clear(true, true, true);
    r.render(this.postScene, this.postCamera);
  }
}
