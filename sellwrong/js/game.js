/* =====================================================================
   SELLWRONG — the game
   =====================================================================

   Holds the level, the actors, the fire and the player, and runs the
   world at a fixed 35 Hz whatever the renderer is doing.

   THE FIXED TIMESTEP IS NOT NEGOTIABLE. Every duration in the state
   tables is in tics; every movement constant is per tic. Run the world
   off the frame time and a monster's walk cycle changes speed with the
   framerate, a door opens faster on a better machine, and the physics
   constants stop meaning what they say. So the frame time goes into an
   accumulator and the world steps in whole tics, with the leftover
   carried forward. The RENDERER can run at whatever rate it likes; the
   world runs at 35, on every machine, for ever.

   The catch-up is capped at six tics. A tab that has been in the
   background for a minute should not try to simulate a minute of
   supermarket the instant it comes back.
   ===================================================================== */

import * as THREE from 'three';
import { TICRATE, PLAYER_EYE, angleNorm, angleDiff, dist, dist2, pRandom, clamp } from './util.js';
import { Level } from './level.js';
import { buildLevelGeometry } from './mapgeo.js';
import { Actor } from './actor.js';
import { ACTORS } from './states.js';
import { Player } from './player.js';
import { FireSystem } from './fire.js';
import { world } from './material.js';
import { createSpriteMaterial } from './material.js';

const THING_TO_ACTOR = {
  ASSOCIATE: 'ASSOCIATE', STOCKER: 'STOCKER',
  CAR: 'CAR', TROLLEY: 'TROLLEY', BOLLARD: 'BOLLARD',
  FUELCAN: 'FUELCAN', CRATE: 'CRATE',
};

export class Game {
  constructor({ level, scene, camera, textures, sprites, hud, audio, input }) {
    this.level = level;
    this.scene = scene;
    this.camera = camera;
    this.textures = textures;
    this.sprites = sprites;
    this.hud = hud;
    this.sound = audio;
    this.input = input;

    this.actors = [];
    this.projectiles = [];
    this.doors = [];
    this.tics = 0;
    this.accum = 0;
    this.paused = false;
    this.state = 'play';           // play | dead | won
    this.bigMessage = null;
    this.bigMessageTics = 0;
    this.totalMonsters = 0;
    this.burnTarget = level.burnTarget ?? 60;
    this.escapeArmed = false;

    const geo = buildLevelGeometry(level, textures);
    this.geo = geo;
    scene.add(geo.group);

    this.spawnThings();
    this.fire = new FireSystem(this);

    /* the flame the player is holding, and everything else that needs a
       quad but is not an actor */
    this._projGeo = new THREE.PlaneGeometry(1, 1);
    this._projGeo.translate(0, 0.5, 0);
  }

  get burnPercent() { return this.fire ? this.fire.burnFraction * 100 : 0; }

  /* ------------------------------------------------------------------
     Populating
     ------------------------------------------------------------------ */
  spawnThings() {
    for (const t of this.level.things) {
      if (t.type === 'START') {
        this.player = new Player(this, t.x, t.y, t.angle);
        continue;
      }
      const type = THING_TO_ACTOR[t.type];
      if (!type) { console.warn('unknown thing type', t.type); continue; }
      const a = new Actor(this, type, t.x, t.y, t.angle, { variant: t.variant });
      this.actors.push(a);
      if (a.monster) this.totalMonsters++;
    }
    if (!this.player) throw new Error('map has no START');
  }

  spawn(type, x, y, z, opts = {}) {
    const a = new Actor(this, type, x, y, opts.angle || 0, opts);
    if (z !== undefined) a.z = z;
    this.actors.push(a);
    return a;
  }

  spawnPuff(x, y, z) { this.spawn('PUFF', x, y, z); }

  /* ------------------------------------------------------------------
     One tic of the world
     ------------------------------------------------------------------ */
  update(dt) {
    if (this.paused) return;
    this.accum += dt;
    const step = 1 / TICRATE;
    let n = 0;
    while (this.accum >= step && n < 6) { this.tic(); this.accum -= step; n++; }
    if (n === 6) this.accum = 0;          // we are behind; drop the debt
  }

  tic() {
    this.tics++;
    this.input.sample(1 / TICRATE);

    if (this.input.pausePressed && this.state === 'play') this.paused = !this.paused;

    this.player.tic(this.input, 1 / TICRATE);
    for (let i = 0; i < this.actors.length; i++) this.actors[i].tic();
    this.ticProjectiles();
    this.ticDoors();
    this.fire.tic();
    this.hud.ticMessages();

    if (this.bigMessageTics > 0 && --this.bigMessageTics === 0) this.bigMessage = null;

    /* the corpses and the spent puffs, cleared once a tic */
    for (let i = this.actors.length - 1; i >= 0; i--)
      if (this.actors[i].removed) this.actors.splice(i, 1);

    this.checkObjective();

    if (this.sound) {
      this.sound.listener = this.player;
      this.sound.setAmbience(Math.min(1, this.fire.burningCells / 90));
    }
  }

  checkObjective() {
    if (this.state !== 'play') return;
    const burn = this.burnPercent;
    if (!this.escapeArmed && burn >= this.burnTarget) {
      this.escapeArmed = true;
      this.sound?.play('alarm', null);
      this.message('THE STORE IS GOING. GET OUT.');
      this.setBigMessage('GET TO THE CAR PARK', 210);
    }
    if (this.escapeArmed) {
      const s = this.level.sectorAt(this.player.x, this.player.y, this.player.sector);
      if (s && s.outdoor && this.player.y < 340) this.win();
    }
  }

  win() {
    this.state = 'won';
    this.setBigMessage(`SELLWRONG IS CLOSED\n${Math.round(this.burnPercent)}% BURNED  ${this.player.kills} STAFF`, 100000);
  }

  onPlayerDied() {
    this.state = 'dead';
    this.setBigMessage('YOU DIED IN AISLE 5\nPRESS SPACE', 100000);
  }

  onMonsterKilled(a, source) { if (source === this.player) this.player.kills++; }

  message(t) { this.hud.message(t); }
  setBigMessage(t, tics) { this.bigMessage = t; this.bigMessageTics = tics; }

  /* ------------------------------------------------------------------
     Weapons reaching into the world
     ------------------------------------------------------------------ */

  /** Everything alive in a cone in front of `from`, nearest first. */
  actorsInCone(from, range, arc, shootableOnly = true) {
    const out = [];
    const r2 = range * range;
    for (const a of this.actors) {
      if (a.removed || a.dead || a === from) continue;
      if (shootableOnly && !a.shootable) continue;
      const d2 = dist2(from.x, from.y, a.x, a.y);
      if (d2 > r2) continue;
      const ang = Math.atan2(a.y - from.y, a.x - from.x);
      if (Math.abs(angleDiff(ang, from.angle)) > arc) continue;
      if (this.level.sightBlocked(from.x, from.y, from.eyeZ, a.x, a.y, a.z + a.height * 0.5)) continue;
      out.push({ a, d2 });
    }
    out.sort((p, q) => p.d2 - q.d2);
    return out.map(o => o.a);
  }

  /** A shot that arrives instantly. Walks the ray, takes the nearest of
   *  the first actor it crosses and the first wall. */
  hitscan(from, angle, range, damage) {
    const tx = from.x + Math.cos(angle) * range;
    const ty = from.y + Math.sin(angle) * range;
    const z = from.eyeZ;

    const wall = this.level.rayHitWall(from.x, from.y, z, tx, ty, z);
    const maxT = wall ? wall.t : 1;

    let best = null, bestT = maxT;
    const targets = from === this.player ? this.actors : [this.player, ...this.actors];
    for (const a of targets) {
      if (!a || a === from || a.removed || a.dead || !a.shootable) continue;
      /* project the actor onto the ray and see if it is within its
         radius of the line */
      const dx = tx - from.x, dy = ty - from.y;
      const len2 = dx * dx + dy * dy;
      let t = ((a.x - from.x) * dx + (a.y - from.y) * dy) / len2;
      if (t <= 0 || t >= bestT) continue;
      const px = from.x + dx * t, py = from.y + dy * t;
      if (dist2(px, py, a.x, a.y) > a.radius * a.radius) continue;
      /* and that the shot is at a height the thing occupies */
      if (z < a.z - 8 || z > a.z + a.height + 8) continue;
      bestT = t; best = { a, x: px, y: py };
    }

    if (best) {
      best.a.damage(damage, from);
      this.spawnPuff(best.x, best.y, z);
      return best.a;
    }
    if (wall) this.spawnPuff(wall.x, wall.y, wall.z);
    return null;
  }

  /* ------------------------------------------------------------------
     Things in the air

     Not Actors. A projectile lives for under a second, moves in a
     straight line or an arc, and hits one thing — none of which the
     state machine helps with, and all of which it would make slower.
     ------------------------------------------------------------------ */
  spawnMissile(from, target, kind) {
    const speed = kind === 'TIN' ? 22 : 26;
    const a = Math.atan2(target.y - from.y, target.x - from.x);
    const z = from.z + from.height * 0.62;
    const dz = ((target.z + target.height * 0.5) - z) / Math.max(1, dist(from.x, from.y, target.x, target.y) / speed);
    this.projectiles.push({
      kind, x: from.x, y: from.y, z,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, vz: dz,
      gravity: 0, owner: from, life: 140, sprite: 'TINS', mesh: null, damage: 10,
    });
  }

  spawnMolotov(player) {
    const speed = 30;
    /* Thrown, not fired: it arcs, and the pitch you are looking at
       decides how far. Lobbing one over a gondola into the next aisle is
       a shot the player has to learn, and it is worth learning. */
    const up = 7 + Math.sin(-player.pitch) * 14;
    this.projectiles.push({
      kind: 'MOLO', x: player.x, y: player.y, z: player.viewZ - 6,
      vx: Math.cos(player.angle) * speed, vy: Math.sin(player.angle) * speed, vz: up,
      gravity: -1.1, owner: player, life: 200, sprite: 'MOLO', mesh: null, damage: 0,
    });
  }

  ticProjectiles() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.vz += p.gravity;
      const nx = p.x + p.vx, ny = p.y + p.vy, nz = p.z + p.vz;

      let hit = null;
      const wall = this.level.rayHitWall(p.x, p.y, p.z, nx, ny, nz);
      if (wall) hit = { x: wall.x, y: wall.y, z: wall.z, actor: null };

      if (!hit) {
        const targets = p.owner === this.player ? this.actors : [this.player, ...this.actors];
        for (const a of targets) {
          if (!a || a === p.owner || a.removed || a.dead || !a.shootable) continue;
          const rr = a.radius + 10;
          if (dist2(nx, ny, a.x, a.y) > rr * rr) continue;
          if (nz < a.z - 8 || nz > a.z + a.height + 8) continue;
          hit = { x: nx, y: ny, z: nz, actor: a };
          break;
        }
      }

      const sec = this.level.sectorAt(nx, ny);
      if (!hit && sec && nz <= sec.floor + 4) hit = { x: nx, y: ny, z: sec.floor, actor: null };

      if (hit || --p.life <= 0) {
        this.projectileHit(p, hit || { x: p.x, y: p.y, z: p.z, actor: null });
        if (p.mesh) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
        this.projectiles.splice(i, 1);
        continue;
      }
      p.x = nx; p.y = ny; p.z = nz;
    }
  }

  projectileHit(p, at) {
    if (p.kind === 'MOLO') {
      this.sound?.play('glass', at);
      this.sound?.play('ignite', at);
      /* A big, hot, generous splash — enough accelerant to light a
         walkway that has no fuel of its own, which is exactly what it is
         for. */
      this.fire.ignite(at.x, at.y, 190, 68);
      for (const a of this.actorsInConeAround(at, 90)) { a.damage(12, p.owner, { fire: true }); a.ignite?.(340); }
      return;
    }
    if (at.actor) { at.actor.damage(p.damage, p.owner); this.spawnPuff(at.x, at.y, at.z); }
    else this.spawnPuff(at.x, at.y, at.z);
  }

  actorsInConeAround(at, radius) {
    const out = [];
    const r2 = radius * radius;
    for (const a of this.actors)
      if (!a.removed && !a.dead && a.shootable && dist2(at.x, at.y, a.x, a.y) < r2) out.push(a);
    if (this.player && !this.player.dead && dist2(at.x, at.y, this.player.x, this.player.y) < r2) out.push(this.player);
    return out;
  }

  /** A car or a fuel can going up. */
  explode(a) {
    this.sound?.play('explode', a);
    this.fire.ignite(a.x, a.y, 230, 86);
    for (const o of this.actorsInConeAround(a, 150)) {
      if (o === a) continue;
      const d = dist(a.x, a.y, o.x, o.y);
      o.damage(Math.round(60 * (1 - d / 150)), null, { fire: true });
      o.ignite?.(320);
    }
  }

  /** Doom's P_NoiseAlert, with a radius instead of a flood fill. Firing
   *  a weapon is how you wake the store up, and the flamethrower is
   *  louder than the boxcutter for the obvious reason. */
  noise(from, radius) {
    const r2 = radius * radius;
    for (const a of this.actors) {
      if (!a.monster || a.dead || a.target) continue;
      if (dist2(from.x, from.y, a.x, a.y) > r2) continue;
      a.target = this.player;
      this.sound?.play(a.info.seeSound, a);
      if (a.info.see) a.setState(a.info.see);
    }
  }

  /* ------------------------------------------------------------------
     Doors
     ------------------------------------------------------------------ */
  tryUse(player) {
    const reach = 80;
    const tx = player.x + Math.cos(player.angle) * reach;
    const ty = player.y + Math.sin(player.angle) * reach;
    const hit = this.level.rayHitWall(player.x, player.y, player.viewZ, tx, ty, player.viewZ);
    if (hit && this.activateLine(hit.line, player)) return true;
    /* nothing square on: try anything special nearby, so you do not
       have to line up on a doorway to open it */
    const near = this.level.linesInBox(player.x - reach, player.y - reach, player.x + reach, player.y + reach, []);
    for (const l of near) if (this.activateLine(l, player)) return true;
    this.message('NOTHING TO USE');
    return false;
  }

  activateLine(line, activator) {
    for (const si of [line.front, line.back]) {
      if (si === null) continue;
      const s = this.level.sectors[si];
      if (!s.special || s.special.kind !== 'door') continue;
      return this.openDoor(s);
    }
    return false;
  }

  openDoor(s) {
    let d = this.doors.find(x => x.sector === s);
    if (d) {
      /* used again while moving: reverse it, the way Doom's do */
      if (d.state === 'opening') { d.state = 'closing'; return true; }
      if (d.state === 'open') { d.timer = 0; return true; }
      if (d.state === 'closing') { d.state = 'opening'; return true; }
      return true;
    }
    d = { sector: s, state: 'opening', timer: 0, speed: s.special.speed ?? 4,
          openTo: s.special.openTo ?? 152, closedAt: s.floor };
    this.doors.push(d);
    this.sound?.play('dooropen', { x: s.bbox[0], y: s.bbox[1] });
    return true;
  }

  ticDoors() {
    if (!this.doors.length) return;
    let changed = false;
    for (let i = this.doors.length - 1; i >= 0; i--) {
      const d = this.doors[i];
      const s = d.sector;
      if (d.state === 'opening') {
        s.ceil = Math.min(d.openTo, s.ceil + d.speed);
        changed = true;
        if (s.ceil >= d.openTo) { d.state = 'open'; d.timer = s.special.wait ?? 140; }
      } else if (d.state === 'open') {
        if (d.timer > 0 && --d.timer === 0) {
          /* do not close it on somebody's head */
          if (this.somethingUnder(s)) d.timer = 35;
          else { d.state = 'closing'; this.sound?.play('doorclose', { x: s.bbox[0], y: s.bbox[1] }); }
        }
      } else {
        if (this.somethingUnder(s)) { d.state = 'opening'; continue; }
        s.ceil = Math.max(d.closedAt, s.ceil - d.speed);
        changed = true;
        if (s.ceil <= d.closedAt) { this.doors.splice(i, 1); }
      }
    }
    if (changed) this.geo.rebuild();
  }

  somethingUnder(s) {
    const [x0, y0, x1, y1] = s.bbox;
    const inside = (o) => o && !o.removed && !o.dead && o.x > x0 - 16 && o.x < x1 + 16 && o.y > y0 - 16 && o.y < y1 + 16;
    if (inside(this.player)) return true;
    for (const a of this.actors) if (a.solid && inside(a)) return true;
    return false;
  }

  /* ------------------------------------------------------------------
     Drawing
     ------------------------------------------------------------------ */
  render() {
    const p = this.player;
    this.camera.position.set(p.x, p.viewZ, p.y);
    this.camera.rotation.set(p.pitch, -Math.PI / 2 - p.angle, 0, 'YXZ');

    /* Every billboard in the scene is spun to the same yaw — they face
       the camera PLANE, not the camera point, which is what stops
       sprites near the edge of the screen turning to look at you. */
    const billboardRot = -p.angle - Math.PI / 2;

    for (const a of this.actors) a.render(p.x, p.y, billboardRot);
    this.fire.render(p.x, p.y, billboardRot);
    this.renderProjectiles(billboardRot);

    /* the red mist of being nearly dead */
    const hurt = clamp(1 - p.health / 100, 0, 1);
    world.tint.value.setRGB(1, 1 - hurt * 0.22, 1 - hurt * 0.3);
  }

  renderProjectiles(billboardRot) {
    for (const p of this.projectiles) {
      if (!p.mesh) {
        const mat = createSpriteMaterial(null, { alphaTest: 0.5, width: 32, height: 32 });
        p.mesh = new THREE.Mesh(this._projGeo, mat);
        p.mesh.frustumCulled = false;
        this.scene.add(p.mesh);
      }
      const e = this.sprites.get(p.sprite, 'A');
      const u = p.mesh.material.uniforms;
      u.map.value = this.sprites.texture(e, 0);
      u.spriteScale.value.set(e.w * e.scale, e.h * e.scale);
      u.billboardRot.value = billboardRot;
      u.fullbright.value = p.kind === 'MOLO' ? 1 : 0;
      u.light.value = this.level.sectorAt(p.x, p.y)?.light ?? 0.6;
      /* the quad's foot is its origin, so lift it by half its height to
         put the thing itself where the projectile is */
      p.mesh.position.set(p.x, p.z - (e.h * e.scale) / 2, p.y);
    }
  }
}
