/* =====================================================================
   SELLWRONG — the automatic doors
   =====================================================================

   Doom had exactly one door: a ceiling that goes up. Every "door" in the
   original game is that, dressed differently, because the renderer could
   move a sector's height and could not move anything sideways. A shop
   entrance is the one thing in a supermarket that a rising ceiling
   cannot fake — a supermarket entrance slides, everybody has walked
   through ten thousand of them, and a rising portcullis at the front of
   a SellWrong would be the first thing anyone noticed.

   So these are not sectors. They are two quads on a track, held in front
   of the shopfront the way a real slider's leaves run in front of the
   glazing line, and the only thing they share with a Doom door is the
   part that matters: WHAT THEY DO TO THE MAP. A shut door sets
   `blocking` on the lines across the opening and the collision system
   treats them as wall; an open one clears it and the opening is a hole
   again. Nothing else in the engine has to know these exist.

   Two consequences worth stating, because they are the reason the doors
   feel right rather than merely move right:

   THEY OPEN FOR ANYTHING. The trigger is a proximity test against the
   player AND every solid actor, so the staff walk out through them, and
   a store you have set alight vents itself through a front door that
   keeps being opened by whatever is coming at you.

   THEY BURN. Once the entrance is charred the leaves are stuck: the
   glass is gone, the motor with it, and the doors stop being a door and
   start being a hole with two burnt frames in it. Which is a nicer way
   of saying that after a certain point in a match you can no longer shut
   the front of the shop behind you.
   ===================================================================== */

import * as THREE from 'three';
import { createWallMaterial } from './material.js';
import { dist } from './util.js';

/* Leaf light is baked per vertex, the same as every wall, so it goes
   through the same clamp the map geometry uses. */
const litOf = l => Math.max(0.02, Math.min(1.4, l));

export class SlideDoor {
  /**
   * @param game
   * @param spec {
   *   x0,y0,x1,y1  the opening, left to right AS SEEN FROM OUTSIDE
   *   zBot,zTop    how tall the leaves are
   *   standoff     units towards the outside the track sits proud of the
   *                wall; a slider whose leaves are coplanar with the
   *                glazing z-fights against it from every angle
   *   lines        the level lines the opening is made of
   *   sector       whose light the leaves take
   *   travel       how far each leaf runs; default is its own width, so
   *                a fully open door is a fully clear opening
   *   speed        units per tic
   *   triggerR     how close something has to be
   *   hold         tics to stay open once nothing is near
   * }
   */
  constructor(game, spec) {
    this.game = game;
    this.spec = spec;
    const { x0, y0, x1, y1 } = spec;

    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1) throw new Error('slide door has no width');
    this.len = len;
    this.dx = dx / len; this.dy = dy / len;
    /* The outward normal. Rotating the along-wall direction by -90 gives
       the side the door faces; the map picks which side by the SIGN of
       standoff, so a door in the back wall of the building does not need
       a different rule. */
    this.nx = this.dy; this.ny = -this.dx;

    this.zBot = spec.zBot ?? 0;
    this.zTop = spec.zTop ?? 128;
    this.half = len / 2;
    this.travel = spec.travel ?? this.half;
    this.speed = spec.speed ?? 7;
    this.triggerR = spec.triggerR ?? 180;
    this.hold = spec.hold ?? 60;

    this.open = 0;                 // 0 shut, 1 fully open
    this.timer = 0;
    this.state = 'shut';
    this.jammed = false;           // the fire got it
    this._light = -1;

    this.group = new THREE.Group();
    this.group.name = 'slide-door';
    this.leaves = [
      this._leaf('SLIDEL', -1),
      this._leaf('SLIDER', +1),
    ];
    for (const l of this.leaves) this.group.add(l.mesh);
    this._setBlocked(true);
    this._place();
  }

  /**
   * One leaf. `dir` is which way it runs: -1 towards (x0,y0).
   *
   * The quad is built in the leaf's OWN space — origin at the middle of
   * the opening, running along +X — and the mesh is then rotated onto
   * the wall once. Sliding it is then a single position write per tic
   * instead of rebuilding four vertices, which matters because these
   * move every tic that anything is standing near them.
   */
  _leaf(texName, dir) {
    const bank = this.game.textures;
    const entry = bank.get(texName);
    const mat = createWallMaterial(entry.texture, {
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });

    const w = this.half, h = this.zTop - this.zBot;
    /* x from 0 to w for the right leaf, -w to 0 for the left, so each
       one is drawn where it sits when the door is shut. */
    const xa = dir < 0 ? -w : 0, xb = dir < 0 ? 0 : w;
    const g = new THREE.BufferGeometry();
    /* Doom's world is XY-with-Z-up; the renderer's is XZ-with-Y-up, and
       every other quad in this game is built with that swap already
       applied, so these are too. */
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      xa, this.zBot, 0, xb, this.zBot, 0, xb, this.zTop, 0,
      xa, this.zBot, 0, xb, this.zTop, 0, xa, this.zTop, 0,
    ], 3));
    /* 0..1 across the leaf and 0..1 up it: the picture IS the leaf, so
       the stiles land where the stiles go rather than wherever a 64-unit
       repeat happens to fall. Neither leaf flips its u — SLIDEL and
       SLIDER are already drawn as each other's mirror, because a pair of
       sliders that are not looks wrong immediately and nobody can say
       why. */
    g.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0,
    ], 2));
    g.setAttribute('light', new THREE.Float32BufferAttribute(new Float32Array(6).fill(1), 1));
    /* The entrance is indoors, so the leaves diminish like a wall. */
    g.setAttribute('sky', new THREE.Float32BufferAttribute(new Float32Array(6), 1));

    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return { mesh, dir, mat, geom: g };
  }

  /** Put both leaves where `this.open` says they are. */
  _place() {
    const { x0, y0 } = this.spec;
    const cx = x0 + this.dx * this.half + this.nx * (this.spec.standoff ?? 0);
    const cy = y0 + this.dy * this.half + this.ny * (this.spec.standoff ?? 0);
    const yaw = Math.atan2(this.dy, this.dx);
    const slid = this.open * this.travel;
    for (const l of this.leaves) {
      const px = cx + this.dx * slid * l.dir;
      const py = cy + this.dy * slid * l.dir;
      /* world Y is up; the map's Y is the renderer's -Z */
      l.mesh.position.set(px, 0, -py);
      l.mesh.rotation.set(0, yaw, 0);
    }
  }

  /** Doors are wall when shut and hole when not. */
  _setBlocked(on) {
    if (this._blocked === on) return;
    this._blocked = on;
    for (const l of this.spec.lines) l.blocking = on;
  }

  /** Anything solid close enough to trip the mat. */
  _somebodyNear() {
    const g = this.game;
    const { x0, y0 } = this.spec;
    const cx = x0 + this.dx * this.half, cy = y0 + this.dy * this.half;
    const r = this.triggerR;
    if (g.player && !g.player.dead && dist(g.player.x, g.player.y, cx, cy) < r) return true;
    for (const a of g.actors) {
      if (!a.solid || a.dead || a.removed) continue;
      if (!a.monster) continue;              // trolleys do not open doors
      if (dist(a.x, a.y, cx, cy) < r) return true;
    }
    return false;
  }

  tic() {
    /* Burnt out: the leaves stay wherever the fire caught them, and the
       opening stays an opening. */
    if (this.jammed) { this._setBlocked(false); return; }

    const near = this._somebodyNear();
    if (near) {
      if (this.state === 'shut' || this.state === 'closing') {
        if (this.state === 'shut') this.game.sound?.play('dooropen', this._at());
        this.state = 'opening';
      }
      this.timer = this.hold;
    }

    if (this.state === 'opening') {
      this.open = Math.min(1, this.open + this.speed / Math.max(1, this.travel));
      if (this.open >= 1) this.state = 'open';
    } else if (this.state === 'open') {
      if (!near && this.timer > 0 && --this.timer === 0) {
        this.state = 'closing';
        this.game.sound?.play('doorclose', this._at());
      }
    } else if (this.state === 'closing') {
      this.open = Math.max(0, this.open - this.speed / Math.max(1, this.travel));
      if (this.open <= 0) this.state = 'shut';
    }

    /* A leaf that has moved at all has stopped being a wall. Doom made
       the same call — a door is passable the instant it starts to open —
       and it is the difference between a door you walk through and a
       door you wait at. */
    this._setBlocked(this.open < 0.12);
    this._place();
    this._syncLight();
  }

  _at() {
    const { x0, y0 } = this.spec;
    return { x: x0 + this.dx * this.half, y: y0 + this.dy * this.half };
  }

  /** Take the entrance's light, and notice when the fire has been through. */
  _syncLight() {
    const s = this.spec.sector;
    const lit = litOf((s ? s.light : 1) + 0.06);
    if (Math.abs(lit - this._light) < 0.01) return;
    this._light = lit;
    for (const l of this.leaves) {
      const a = l.geom.getAttribute('light');
      a.array.fill(lit);
      a.needsUpdate = true;
    }
  }

  /** The fire has reached the entrance: the doors are finished. */
  jam() {
    if (this.jammed) return;
    this.jammed = true;
    /* Stuck part-open, which reads as failed rather than as tidied away. */
    this.open = Math.max(this.open, 0.55);
    this._place();
    this._setBlocked(false);
  }
}

/**
 * Build every slider a level asked for. The map declares them because
 * only the map knows which lines are the opening; everything after that
 * is the same for all of them.
 */
export function buildSlideDoors(game) {
  const specs = game.level.slideDoors || [];
  const out = [];
  for (const spec of specs) {
    const d = new SlideDoor(game, spec);
    game.scene.add(d.group);
    out.push(d);
  }
  return out;
}
