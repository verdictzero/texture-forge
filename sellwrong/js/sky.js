/* =====================================================================
   SELLWRONG — the sky
   =====================================================================

   A sky sector in this engine draws nothing and lets the background
   through, which is exactly what Doom did and is fine as long as the
   only thing outdoors is a courtyard. It stopped being fine when the
   store got a car park six thousand units across: a flat clear colour
   behind a strip mall does not read as night, it reads as the level
   having run out.

   So the background gets a cylinder, and it is a cylinder for the same
   reason Doom's was. A sphere needs a projection and a cube needs six
   textures and a seam policy; a cylinder needs one strip of pixels and
   turning your head does the right thing for free, because turning your
   head IS the texture's u coordinate. Pitching up and down slides v,
   which is wrong in a way nobody has ever noticed in thirty years.

   Two rules and it is convincing:

   IT IS AT INFINITY. Every frame it is moved to sit on the camera, so
   walking never gets you nearer to it. That is the whole trick — a sky
   you can approach is a wall with clouds on it.

   IT IS NOT LIT. Fullbright, no fog, no distance diminishing, drawn
   first with depth writes off so everything in the world lands in front
   of it whatever the far plane is doing.
   ===================================================================== */

import * as THREE from 'three';
import { createSpriteMaterial } from './material.js';

const RADIUS = 4200;          // inside the camera's far plane, always
const BOTTOM = -1400, TOP = 3000;
const REPEATS = 3;            // times the strip goes round the horizon

export function buildSky(bank) {
  /* Not cloned: NIGHTSKY is on nothing else in the game, so the wrap and
     repeat settings it needs can just be its own. */
  const tex = bank.get('NIGHTSKY').texture;
  tex.wrapS = THREE.RepeatWrapping;
  /* Clamped vertically: repeating would put a second horizon overhead. */
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(REPEATS, 1);
  tex.needsUpdate = true;

  const g = new THREE.CylinderGeometry(RADIUS, RADIUS, TOP - BOTTOM, 24, 1, true);
  g.translate(0, (TOP + BOTTOM) / 2, 0);

  const mat = createSpriteMaterial(tex, { fullbright: true });
  mat.side = THREE.BackSide;
  mat.depthWrite = false;
  mat.depthTest = false;
  /* The sprite material's billboard vertex path would spin this to face
     the camera, which for a cylinder you are standing inside is not a
     thing that means anything. Take the plain path instead. */
  delete mat.defines.BILLBOARD;
  mat.needsUpdate = true;

  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return mesh;
}

/** Park it on the camera, so it can never be walked towards. */
export function followSky(mesh, camera) {
  mesh.position.set(camera.position.x, 0, camera.position.z);
}
