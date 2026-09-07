/* =====================================================================
   SELLWRONG — materials, and light that steps instead of fading
   =====================================================================

   There is one material in this game and it is unlit. Nothing here has a
   normal, nothing has a specular, nothing is lit by a light source. A
   surface's brightness is a number the map author wrote down, darkened by
   how far away it is, and quantised into 32 steps on the way.

   That last part is the whole trick. Doom did not multiply anything by
   anything — it kept 32 pre-darkened copies of the palette and picked
   one. So light does not fade down a corridor, it STEPS down, and you can
   see the steps, and after thirty years those steps are what the eye
   reads as "this is that kind of game". Smooth falloff costs nothing and
   throws it all away.

   FAKE CONTRAST comes free with the same idea. Doom nudged the light
   level up on walls running east-west and down on walls running
   north-south. It is not a lighting model — there is no sun and the
   nudge is the same at midnight — but it means a corner between two walls
   is always visible, in a renderer with no shading at all. Baked into the
   vertex light by the geometry builder, so it costs nothing here either.

   SMOKE is the one thing that moves. As the store burns, uFogDensity
   climbs and the far end of every aisle goes grey, which is both the
   atmosphere and an honest gameplay signal: when you can no longer see
   the checkouts from Aisle 6, it is time to leave.
   ===================================================================== */

import * as THREE from 'three';

/* Every material in the game shares these objects. Mutate .value on one
   and the whole store changes on the next frame — no walking a scene
   graph, no keeping a list. */
export const world = {
  globalLight:  { value: 1.0 },      // damage flash, light-amp pickup, blackout
  lightFalloff: { value: 1400.0 },   // units at which the diminishing bottoms out
  minLight:     { value: 0.12 },     // how dark the far end of a lit room gets
  fogColor:     { value: new THREE.Color(0x0a0a0c) },
  fogNear:      { value: 300.0 },
  fogFar:       { value: 2200.0 },
  fogDensity:   { value: 0.0 },      // smoke — driven by how much of the store is alight
  tint:         { value: new THREE.Color(1, 1, 1) },  // pain red, pickup gold

  /* THE FIRE GLOW. One light, for the whole game.

     Everything else here is unlit on purpose, but a store that is
     burning down and does not get brighter as it burns is a store that
     is not really burning. So there is exactly one point light, parked
     at the centre of mass of whatever is alight nearest the player, and
     its intensity is how much of it there is. One light is enough
     because from inside a burning aisle the whole aisle is the light —
     you never see two fires as two sources, you see the room glowing.

     It is added AFTER the light is quantised into its 32 steps, so the
     glow slides smoothly over the banding instead of fighting it. */
  fireLightPos:   { value: new THREE.Vector3(0, -10000, 0) },
  fireLightRange: { value: 512.0 },
  fireLight:      { value: 0.0 },
  fireLightColor: { value: new THREE.Color(1.0, 0.55, 0.18) },
};

const COMMON_VERT = /* glsl */`
varying vec2  vUv;
varying float vLight;
varying float vDepth;
varying vec3  vWorld;

#ifdef PER_VERTEX_LIGHT
  attribute float light;
#else
  uniform float light;
#endif

#ifdef BILLBOARD
  uniform float billboardRot;    // yaw the quad is turned to, in world space
  uniform vec2  spriteScale;     // width, height in world units
  uniform vec2  spriteOffset;    // x nudge, y lift off the floor
#endif

void main() {
  vUv = uv;
  vLight = light;

  vec3 p = position;

  #ifdef BILLBOARD
    /* The quad is authored as a unit square with its foot at y=0. Scale it,
       nudge it, then spin it about Y only — never about X. A Doom sprite
       stays bolt upright however far you are looking up or down; tilting it
       to face the camera properly is the one "improvement" that instantly
       stops it looking like Doom. */
    p.x *= spriteScale.x;
    p.y *= spriteScale.y;
    p.x += spriteOffset.x;
    p.y += spriteOffset.y;
    float c = cos(billboardRot), s = sin(billboardRot);
    p = vec3(p.x * c, p.y, -p.x * s);
  #endif

  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const COMMON_FRAG = /* glsl */`
uniform sampler2D map;
uniform float alphaTest;
uniform float fullbright;      // 1.0 = ignore distance and sector light entirely
uniform float globalLight;
uniform float lightFalloff;
uniform float minLight;
uniform vec3  fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float fogDensity;
uniform vec3  tint;
uniform vec3  fireLightPos;
uniform float fireLightRange;
uniform float fireLight;
uniform vec3  fireLightColor;

varying vec2  vUv;
varying float vLight;
varying float vDepth;
varying vec3  vWorld;

void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < alphaTest) discard;

  /* Distance diminishing. Linear in depth, because Doom's was too, and
     because an inverse-square falloff in a corridor lit by nothing in
     particular just looks broken. */
  float dim = 1.0 - clamp(vDepth / lightFalloff, 0.0, 1.0);
  float l = vLight * mix(minLight, 1.0, dim) * globalLight;

  /* THE STEP. 32 levels, same as Doom's 32 colormaps. Everything above is
     continuous maths; this is the line that makes it look right. */
  l = floor(l * 32.0 + 0.5) * (1.0 / 32.0);

  l = mix(l, 1.0, fullbright);
  vec3 c = t.rgb * l * tint;

  /* Firelight, added on top of the banded light rather than folded into
     it — a smooth glow crossing the steps is what a real light in a
     stepped-lighting room looks like. Falls off as the square of the
     distance and is clamped, so standing in it does not blow out to
     white. */
  if (fireLight > 0.0) {
    float fd = distance(vWorld, fireLightPos);
    float fa = clamp(1.0 - fd / fireLightRange, 0.0, 1.0);
    fa *= fa;
    c += t.rgb * fireLightColor * (fa * fireLight * (1.0 - fullbright * 0.7));
  }

  /* Smoke. Multiplied by fogDensity so a store that is not yet on fire has
     no haze at all rather than a permanent grey wash. */
  float f = clamp((vDepth - fogNear) / max(1.0, fogFar - fogNear), 0.0, 1.0) * fogDensity;
  c = mix(c, fogColor * max(l, 0.35), f);

  gl_FragColor = vec4(c, t.a);
}
`;

function baseUniforms(texture, opts) {
  return {
    map:          { value: texture },
    alphaTest:    { value: opts.alphaTest ?? 0.0 },
    fullbright:   { value: opts.fullbright ? 1.0 : 0.0 },
    globalLight:  world.globalLight,
    lightFalloff: world.lightFalloff,
    minLight:     world.minLight,
    fireLightPos:   world.fireLightPos,
    fireLightRange: world.fireLightRange,
    fireLight:      world.fireLight,
    fireLightColor: world.fireLightColor,
    fogColor:     world.fogColor,
    fogNear:      world.fogNear,
    fogFar:       world.fogFar,
    fogDensity:   world.fogDensity,
    tint:         world.tint,
  };
}

/* Level geometry: light is baked per vertex by the map builder, so an
   entire store's worth of walls sharing one texture is one draw call. */
export function createWallMaterial(texture, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: baseUniforms(texture, opts),
    defines: { PER_VERTEX_LIGHT: '' },
    vertexShader: COMMON_VERT,
    fragmentShader: COMMON_FRAG,
    transparent: !!opts.transparent,
    side: opts.side ?? THREE.FrontSide,
    depthWrite: opts.depthWrite !== false,
    toneMapped: false,
    fog: false,
  });
}

/* Sprites: one light value for the whole quad, updated each tic from
   whichever sector the thing is standing in. */
export function createSpriteMaterial(texture, opts = {}) {
  const u = baseUniforms(texture, opts);
  u.light         = { value: opts.light ?? 1.0 };
  u.billboardRot  = { value: 0.0 };
  u.spriteScale   = { value: new THREE.Vector2(opts.width ?? 64, opts.height ?? 64) };
  u.spriteOffset  = { value: new THREE.Vector2(0, 0) };
  return new THREE.ShaderMaterial({
    uniforms: u,
    defines: { BILLBOARD: '' },
    vertexShader: COMMON_VERT,
    fragmentShader: COMMON_FRAG,
    transparent: !!opts.transparent,
    side: THREE.DoubleSide,
    depthWrite: opts.depthWrite !== false,
    toneMapped: false,
    fog: false,
  });
}

/* Flat, screen-space, no world lighting at all — the weapon in your hands
   and the status bar. Doom drew these straight into the frame buffer and
   so do we. */
export function createHudMaterial(texture) {
  const u = baseUniforms(texture, { alphaTest: 0.5, fullbright: true });
  u.light = { value: 1.0 };
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: COMMON_VERT,
    fragmentShader: COMMON_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
}
