/* =====================================================================
   SELLWRONG — turning a floor plan into triangles
   =====================================================================

   A two-sided line is a hole between two sectors, and what you actually
   SEE at that hole is the bit of wall above it and the bit of wall below
   it. Above: the gap between the two ceilings. Below: the gap between the
   two floors. Doom called them the upper and lower textures and every
   piece of level architecture in this game is one of them —

     a doorway      upper only, lower zero
     a shop counter lower only, 40 tall, shoot over it
     a kerb         lower, 8 tall, walk over it without noticing
     a window       upper AND lower, with the gap between them the glass
     a door         upper on a sector whose ceiling is on the floor

   PEGGING is the part everyone forgets and then wonders why their door
   looks wrong. When a sector moves, the wall above it changes height —
   so does the texture on it slide with the sector, or stay nailed to the
   fixed ceiling above? Doom answered with a flag; this answers with two
   named fields, because "pegUpper: 'bottom'" is a sentence and
   "flags |= 0x0008" is a lookup.

   The default is 'bottom', which nails the texture to the MOVING edge, so
   a door's face slides up with the door instead of scrolling past it.
   That is the default precisely because doors are the common case, and
   the common case should need no flag at all.

   BATCHING. Everything with the same texture goes into one buffer, so a
   whole supermarket is about twenty draw calls. Lighting is per-vertex
   and baked, so no lights, no shadows, and nothing to update.
   ===================================================================== */

import * as THREE from 'three';
import { createWallMaterial } from './material.js';

/* A batch collects triangles for one texture and hands back a mesh. */
class Batch {
  constructor(name) { this.name = name; this.pos = []; this.uv = []; this.light = []; }
  get empty() { return this.pos.length === 0; }

  tri(ax, ay, az, au, av, bx, by, bz, bu, bv, cx, cy, cz, cu, cv, l) {
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.uv.push(au, av, bu, bv, cu, cv);
    this.light.push(l, l, l);
  }

  /* A quad as two triangles, given four corners in winding order. */
  quad(p, u, l) {
    this.tri(p[0][0], p[0][1], p[0][2], u[0][0], u[0][1],
             p[1][0], p[1][1], p[1][2], u[1][0], u[1][1],
             p[2][0], p[2][1], p[2][2], u[2][0], u[2][1], l);
    this.tri(p[0][0], p[0][1], p[0][2], u[0][0], u[0][1],
             p[2][0], p[2][1], p[2][2], u[2][0], u[2][1],
             p[3][0], p[3][1], p[3][2], u[3][0], u[3][1], l);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('light', new THREE.Float32BufferAttribute(this.light, 1));
    g.computeBoundingSphere();
    return g;
  }
}

class BatchSet {
  constructor() { this.map = new Map(); }
  get(name) {
    let b = this.map.get(name);
    if (!b) { b = new Batch(name); this.map.set(name, b); }
    return b;
  }
  toGroup(bank, opts = {}) {
    const group = new THREE.Group();
    for (const [name, b] of this.map) {
      if (b.empty) continue;
      const entry = bank.get(name);
      const mat = createWallMaterial(entry.texture, { alphaTest: entry.masked ? 0.5 : 0.0, ...opts });
      const mesh = new THREE.Mesh(b.geometry(), mat);
      mesh.frustumCulled = true;
      mesh.name = name;
      group.add(mesh);
    }
    return group;
  }
}

/* --------------------------------------------------------------------
   Vertical texture coordinates

   v(z) = (z - peg) / texHeight, where `peg` is the world height the TOP
   edge of the texture sits at. With repeat wrapping that one line covers
   every pegging case; all the cases below do is work out where the top
   edge goes.
   ------------------------------------------------------------------ */
const vAt = (z, peg, texH) => (z - peg) / texH;

/**
 * Build every triangle in the level.
 *
 * @param level  a built Level
 * @param bank   texture bank: .get(name) -> { texture, w, h, masked }
 * @returns { group, dynamic } — dynamic.rebuild() after a door moves
 */
export function buildLevelGeometry(level, bank) {
  const statics = new BatchSet();

  /* A line is dynamic if either sector it touches can move, because the
     wall above a door changes height every tic the door is opening. */
  const dynamicLines = new Set();
  for (const l of level.lines) {
    const f = l.front !== null ? level.sectors[l.front] : null;
    const b = l.back !== null ? level.sectors[l.back] : null;
    if ((f && f.dynamic) || (b && b.dynamic)) dynamicLines.add(l);
  }
  const staticLines = level.lines.filter(l => !dynamicLines.has(l));
  const dynamicSectors = level.sectors.filter(s => s.dynamic);
  const staticSectors = level.sectors.filter(s => !s.dynamic);

  for (const s of staticSectors) addFlats(statics, level, s, bank);
  for (const l of staticLines) addLine(statics, level, l, bank);

  const group = new THREE.Group();
  group.name = 'level-static';
  group.add(statics.toGroup(bank));

  /* Doors and lifts get their own buffers, thrown away and rebuilt when
     they move. It is a handful of quads — cheaper than any clever
     partial-update scheme, and impossible to get subtly wrong. */
  const dynGroup = new THREE.Group();
  dynGroup.name = 'level-dynamic';
  group.add(dynGroup);

  function rebuild() {
    for (const child of dynGroup.children) {
      child.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
    dynGroup.clear();
    const dyn = new BatchSet();
    for (const s of dynamicSectors) addFlats(dyn, level, s, bank);
    for (const l of dynamicLines) addLine(dyn, level, l, bank);
    dynGroup.add(dyn.toGroup(bank));
  }
  rebuild();

  return { group, rebuild, dynamicSectors, dynamicLines };
}

/* --------------------------------------------------------------------
   Floors and ceilings

   Flats are aligned to the world grid, not to the sector, which is why
   Doom floors run continuously through a doorway instead of restarting
   at every threshold. u = x/64, v = y/64, and nothing else to decide.
   ------------------------------------------------------------------ */
function addFlats(set, level, s, bank) {
  const pts = s.poly.map(p => new THREE.Vector2(p[0], p[1]));
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(pts, []); }
  catch (e) { console.warn('sector', s.index, 'would not triangulate', e); return; }

  const sky = s.ceilTex === 'SKY';

  if (s.floorTex && s.floorTex !== 'NONE') {
    const t = bank.get(s.floorTex);
    const b = set.get(s.floorTex);
    for (const [a, bb, c] of tris) {
      /* Reversed relative to the map winding: the ring is
         counter-clockwise in map space, which faces DOWN once y becomes
         the world's z. A floor you can only see from underneath is a
         floor you will spend an hour debugging. */
      const p0 = pts[c], p1 = pts[bb], p2 = pts[a];
      b.tri(
        p0.x, s.floor, p0.y, p0.x / t.w, p0.y / t.h,
        p1.x, s.floor, p1.y, p1.x / t.w, p1.y / t.h,
        p2.x, s.floor, p2.y, p2.x / t.w, p2.y / t.h,
        s.light);
    }
  }

  /* A sky ceiling is a hole, not a surface — nothing is drawn and the
     background shows through. */
  if (!sky && s.ceilTex && s.ceilTex !== 'NONE') {
    const t = bank.get(s.ceilTex);
    const b = set.get(s.ceilTex);
    for (const [a, bb, c] of tris) {
      const p0 = pts[a], p1 = pts[bb], p2 = pts[c];
      b.tri(
        p0.x, s.ceil, p0.y, p0.x / t.w, p0.y / t.h,
        p1.x, s.ceil, p1.y, p1.x / t.w, p1.y / t.h,
        p2.x, s.ceil, p2.y, p2.x / t.w, p2.y / t.h,
        s.light);
    }
  }
}

/* --------------------------------------------------------------------
   Walls
   ------------------------------------------------------------------ */
function addLine(set, level, l, bank) {
  const front = l.front !== null ? level.sectors[l.front] : null;
  const back  = l.back  !== null ? level.sectors[l.back]  : null;

  if (!front && !back) return;

  /* One-sided: a plain wall, floor to ceiling, seen from the sector that
     owns it. */
  if (!back || !front) {
    const s = front || back;
    const facingFront = !!front;
    const tex = l.middle || 'WALL';
    if (tex === 'NONE') return;
    addQuad(set, l, bank, tex, s.floor, s.ceil, facingFront,
            pegOf(l, 'middle', s.floor, s.ceil, s, bank.get(tex).h),
            s.light + l.contrast);
    return;
  }

  const skyBoth = front.ceilTex === 'SKY' && back.ceilTex === 'SKY';

  /* Front side. Standing in the front sector looking at the line: the
     upper is what hangs down from your ceiling to theirs, the lower is
     what rises from your floor to theirs. */
  if (front.ceil > back.ceil && l.upper && l.upper !== 'NONE' && !skyBoth)
    addQuad(set, l, bank, l.upper, back.ceil, front.ceil, true,
            pegOf(l, 'upper', back.ceil, front.ceil, front, bank.get(l.upper).h),
            front.light + l.contrast);

  if (back.floor > front.floor && l.lower && l.lower !== 'NONE')
    addQuad(set, l, bank, l.lower, front.floor, back.floor, true,
            pegOf(l, 'lower', front.floor, back.floor, front, bank.get(l.lower).h),
            front.light + l.contrast);

  /* Back side — the same two pieces, seen the other way round. */
  if (back.ceil > front.ceil && l.upper && l.upper !== 'NONE' && !skyBoth)
    addQuad(set, l, bank, l.upper, front.ceil, back.ceil, false,
            pegOf(l, 'upper', front.ceil, back.ceil, back, bank.get(l.upper).h),
            back.light + l.contrast);

  if (front.floor > back.floor && l.lower && l.lower !== 'NONE')
    addQuad(set, l, bank, l.lower, back.floor, front.floor, false,
            pegOf(l, 'lower', back.floor, front.floor, back, bank.get(l.lower).h),
            back.light + l.contrast);

  /* A middle texture on a two-sided line is the thing IN the hole: a
     grating, a shop window, a wire shelf you can see through. Drawn both
     ways, masked, spanning the open gap. */
  if (l.middle && l.middle !== 'NONE') {
    const top = Math.min(front.ceil, back.ceil);
    const bot = Math.max(front.floor, back.floor);
    if (top > bot) {
      const th = bank.get(l.middle).h;
      const peg = l.pegMiddle === 'bottom' ? bot + th : top;
      addQuad(set, l, bank, l.middle, bot, top, true,  peg + l.yoff, front.light + l.contrast);
      addQuad(set, l, bank, l.middle, bot, top, false, peg + l.yoff, back.light + l.contrast);
    }
  }
}

/* Where the top edge of the texture sits, in world height. */
function pegOf(l, which, zLow, zHigh, sector, texH) {
  let peg;
  if (which === 'upper') {
    /* 'bottom' nails the texture to the lower (moving) ceiling, so a
       door's face travels with the door. This is the default because
       doors are the common case. */
    peg = (l.pegUpper === 'top') ? zHigh : zLow + texH;
  } else if (which === 'lower') {
    /* 'top' nails it to the top of the step, which is what a counter, a
       kerb and a pallet all want. Doom's own default measured down from
       the ceiling instead; that is available, but it is not the one you
       reach for. */
    peg = (l.pegLower === 'ceiling') ? sector.ceil : zHigh;
  } else {
    peg = (l.pegMiddle === 'bottom') ? zLow + texH : zHigh;
  }
  return peg + l.yoff;
}

/**
 * One wall quad.
 *
 * `facingFront` decides the winding. The front sector is on the RIGHT of
 * v1->v2, so a quad wound v1,v2 faces LEFT — the back. Getting this
 * backwards gives you a level you can see straight through from outside
 * and not at all from inside.
 */
function addQuad(set, l, bank, texName, zBot, zTop, facingFront, peg, light) {
  if (zTop <= zBot) return;
  const t = bank.get(texName);
  const b = set.get(texName);
  const { x1, y1, x2, y2, len } = l;

  /* u runs from whichever end this side measures from. Doom starts the
     front side's texture at v1 and the back side's at v2, so a two-sided
     line's two faces both read left-to-right from their own viewpoint. */
  const u0 = l.xoff / t.w;
  const u1 = (l.xoff + len) / t.w;
  const vB = vAt(zBot, peg, t.h), vT = vAt(zTop, peg, t.h);
  const lit = Math.max(0.02, Math.min(1.4, light));

  if (facingFront) {
    b.quad(
      [[x2, zBot, y2], [x1, zBot, y1], [x1, zTop, y1], [x2, zTop, y2]],
      [[u1, vB],       [u0, vB],       [u0, vT],       [u1, vT]],
      lit);
  } else {
    b.quad(
      [[x1, zBot, y1], [x2, zBot, y2], [x2, zTop, y2], [x1, zTop, y1]],
      [[u1, vB],       [u0, vB],       [u0, vT],       [u1, vT]],
      lit);
  }
}
