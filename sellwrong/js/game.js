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
import { charredName } from './textures.js';
import { assignLineTextures } from './level.js';
import { createSpriteMaterial } from './material.js';
import { buildSlideDoors } from './slidedoor.js';
import { buildSky, followSky } from './sky.js';

const THING_TO_ACTOR = {
  ASSOCIATE: 'ASSOCIATE', STOCKER: 'STOCKER',
  CAR: 'CAR', TROLLEY: 'TROLLEY', BOLLARD: 'BOLLARD',
  FUELCAN: 'FUELCAN', CRATE: 'CRATE', LAMP: 'LAMP',
};

/* How far a fitting throws light and how much it is worth at the source.
   340 is a little over one grid step, so every point on the shop floor is
   reached by two or three of them and losing one is a noticeable dent
   rather than a blackout — until you shoot out the neighbours too. */
const LAMP_RANGE = 340;
const LAMP_GAIN = 0.30;

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
    this.lamps = [];
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

    this.lamps = [];
    this.spawnThings();
    this.relight();
    this.geo.rebuildStatic();          // with the lamps' light in it
    this.slideDoors = buildSlideDoors(this);
    this.sky = buildSky(textures);
    scene.add(this.sky);
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
      /* Lights are laid on a grid over the whole map; the ones that fell
         outdoors, into a doorway, or under a low ceiling are dropped
         here rather than described twice in the map file. */
      if (type === 'LAMP') {
        const sec = this.level.sectorAt(t.x, t.y);
        if (!sec || sec.outdoor || sec.ceil < 200) continue;
      }
      const a = new Actor(this, type, t.x, t.y, t.angle, { variant: t.variant });
      this.actors.push(a);
      if (a.monster) this.totalMonsters++;
      if (type === 'LAMP') this.lamps.push(a);
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
     Light that comes from somewhere

     A sector's brightness is its own ambient — emergency lighting,
     whatever comes through the front — plus every working fitting that
     can see it. Which means shooting one out genuinely takes light away,
     and a fire working its way along a run of them puts an aisle out
     one section at a time.

     The reach test is done NEAR THE CEILING on purpose. Walls run floor
     to ceiling and stop it, so light does not pass between rooms; but a
     gondola is only 80 tall and the ceiling is 352, so light passes over
     the shelves into the next aisle, which is what light does.
     ------------------------------------------------------------------ */
  /**
   * Sample points across a sector, so its brightness is an AVERAGE over
   * its area rather than the value at one arbitrary place in it.
   *
   * The first version measured each lamp against the nearest point of
   * the sector's bounding box, which for a 600-unit aisle is distance
   * zero from every fitting along its length — so every sector summed
   * four or five lamps at full strength, clamped to 1.0, and shooting
   * them out changed nothing anywhere. A long room is not close to a
   * lamp; parts of it are.
   */
  _sectorSamples(s) {
    if (s._samples) return s._samples;
    const [x0, y0, x1, y1] = s.bbox;
    const nx = Math.min(3, Math.max(1, Math.round((x1 - x0) / 220)));
    const ny = Math.min(3, Math.max(1, Math.round((y1 - y0) / 220)));
    const pts = [];
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++)
        pts.push([x0 + (x1 - x0) * ((i + 0.5) / nx), y0 + (y1 - y0) * ((j + 0.5) / ny)]);
    s._samples = pts;
    return pts;
  }

  /**
   * Which lamps can possibly reach a point.
   *
   * The naive version — every sector against every lamp — is fine in a
   * corner shop and quadratic everywhere else. A store with two hundred
   * and fifty fittings and two hundred and fifty sectors is sixty
   * thousand sight tests per relight, and a relight happens every time a
   * fire takes out a run of lights, which is constantly.
   *
   * So the lamps go in a uniform grid whose cell is exactly LAMP_RANGE.
   * Nothing outside the nine cells around a point can be within range of
   * it, by construction, and the nine cells hold four or five fittings
   * instead of two hundred and fifty. It is Doom's blockmap applied to
   * light, which is what a blockmap is for.
   */
  _buildLampGrid() {
    const cell = LAMP_RANGE;
    const g = new Map();
    for (const lamp of this.lamps) {
      if (lamp.dead || lamp.removed) continue;
      const k = Math.floor(lamp.x / cell) + ',' + Math.floor(lamp.y / cell);
      let b = g.get(k);
      if (!b) g.set(k, b = []);
      b.push(lamp);
    }
    this._lampGrid = g;
    this._lampCell = cell;
  }

  relight() {
    const L = this.level;
    this._buildLampGrid();
    const cell = this._lampCell, grid = this._lampGrid;
    const near = [];
    for (const s of L.sectors) {
      if (s.outdoor) { s.light = s.ambient; continue; }
      const pts = this._sectorSamples(s);
      let total = 0;
      for (const [px, py] of pts) {
        near.length = 0;
        const gx = Math.floor(px / cell), gy = Math.floor(py / cell);
        for (let j = -1; j <= 1; j++)
          for (let i = -1; i <= 1; i++) {
            const b = grid.get((gx + i) + ',' + (gy + j));
            if (b) for (let k = 0; k < b.length; k++) near.push(b[k]);
          }
        for (const lamp of near) {
          const d = Math.hypot(px - lamp.x, py - lamp.y);
          if (d >= LAMP_RANGE) continue;
          const tz = Math.min(s.ceil - 8, lamp.z);
          if (d > 1 && L.sightBlocked(lamp.x, lamp.y, lamp.z, px, py, tz)) continue;
          total += LAMP_GAIN * Math.pow(1 - d / LAMP_RANGE, 1.2);
        }
      }
      s.light = Math.min(1, s.ambient + total / pts.length);
    }
  }

  onLampDestroyed(lamp) {
    /* Relighting walks every lamp against every sector, so it is not done
       per lamp — a fire takes out a whole run of them within a second or
       two and one rebuild covers the lot. */
    this._geoDirty = true;
    this._geoAt = this.tics + 10;
  }

  /** What comes out of a light when it goes: bright, brief, and it falls. */
  spawnSparks(x, y, z, n) {
    for (let i = 0; i < n; i++) {
      const a = (pRandom() / 255) * Math.PI * 2;
      const sp = 0.8 + (pRandom() / 255) * 4.2;
      this.projectiles.push({
        kind: 'SPARK', x, y, z,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: -(0.4 + (pRandom() / 255) * 1.8),
        gravity: -0.85, owner: null, life: 16 + (pRandom() & 15),
        sprite: 'SPRK', frame: 'A', mesh: null, damage: 0,
      });
    }
  }

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
    for (let i = 0; i < this.slideDoors.length; i++) this.slideDoors[i].tic();
    this.fire.tic();
    this.applyChar();
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

  /**
   * Swap a burnt-out region's surfaces for their charred twins.
   *
   * Debounced, because half a dozen gondolas can pass the threshold in
   * the same second and each swap costs a full rebuild of the level's
   * static geometry. Collecting them and rebuilding once every twenty
   * tics turns six hitches into one that nobody sees.
   */
  applyChar() {
    const f = this.fire;
    if (f.newlyCharred.length) {
      for (const si of f.newlyCharred) {
        const s = this.level.sectors[si];
        for (const k of ['floorTex', 'ceilTex', 'wallTex', 'upperTex', 'lowerTex']) {
          const burnt = charredName(s[k]);
          if (burnt !== s[k] && this.textures.map.has(burnt)) s[k] = burnt;
        }
      }
      /* A slider whose entrance has burned is not a door any more. */
      for (const d of this.slideDoors)
        if (d.spec.sector && f.newlyCharred.includes(d.spec.sector.index)) d.jam();
      f.newlyCharred.length = 0;
      this._geoDirty = true;
      this._geoAt = this.tics + 20;
    }
    if (this._geoDirty && this.tics >= this._geoAt) {
      this._geoDirty = false;
      this.relight();
      assignLineTextures(this.level.lines, this.level.sectors);
      this.geo.rebuildStatic();
      this.geo.rebuild();
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
      /* Where "out" is, is the map's business. The footway in front of
         the shops is outdoors too, and standing on the pavement while the
         parade goes up behind you is not getting clear of it. */
      const s = this.level.sectorAt(this.player.x, this.player.y, this.player.sector);
      const out = this.level.escapeY ?? 340;
      if (s && s.outdoor && s.fuel === 0 && this.player.y < out) this.win();
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
      if (p.kind === 'SPARK') p.frame = p.life > 11 ? 'A' : p.life > 5 ? 'B' : 'C';
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
    if (p.kind === 'SPARK') return;          // it just goes out
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
    this.camera.position.set(p.x, p.viewZ, -p.y);
    followSky(this.sky, this.camera);
    this.camera.rotation.set(p.pitch, p.angle - Math.PI / 2, 0, 'YXZ');

    /* Every billboard in the scene is spun to the same yaw — they face
       the camera PLANE, not the camera point, which is what stops
       sprites near the edge of the screen turning to look at you. */
    const billboardRot = p.angle - Math.PI / 2;

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
      const e = this.sprites.get(p.sprite, p.frame || 'A');
      const u = p.mesh.material.uniforms;
      u.map.value = this.sprites.texture(e, 0);
      u.spriteScale.value.set(e.w * e.scale, e.h * e.scale);
      u.billboardRot.value = billboardRot;
      u.fullbright.value = (p.kind === 'MOLO' || p.kind === 'SPARK') ? 1 : 0;
      u.light.value = this.level.sectorAt(p.x, p.y)?.light ?? 0.6;
      /* the quad's foot is its origin, so lift it by half its height to
         put the thing itself where the projectile is */
      p.mesh.position.set(p.x, p.z - (e.h * e.scale) / 2, -p.y);
    }
  }
}
