/* =====================================================================
   SELLWRONG — actors: the state machine, and Doom's chase
   =====================================================================

   An actor is a position, a state, and a countdown. Every tic the
   countdown drops by one; when it hits zero the actor moves to the next
   state, which sets a new sprite frame, a new countdown, and calls one
   action function. Everything a monster does happens inside an action
   function called from a state, which is why Doom monsters can be
   interrupted but never caught halfway through a decision.

   THE CHASE is P_NewChaseDir, reproduced closely, because it is the
   single most important forty lines in the game and nothing simpler
   behaves like it. A monster does not path-find. It picks whichever of
   eight compass directions points most nearly at you, tries to walk that
   way, and if it cannot, works through the others in a randomised order
   until something gives. What comes out of that is a thing that
   confidently walks into a shelf, hesitates, slides along it, finds the
   end and comes round — with no graph, no nodes, and no map data at all.

   The refusal to turn round unless there is nothing else left
   (`turnaround` is tried last, always) is what stops monsters
   oscillating in a doorway, and is the detail most reimplementations
   drop.

   BURNING is this game's own addition and it is deliberately not a
   status effect on a health bar. A burning zombie keeps chasing you,
   takes damage on a timer, LIGHTS WHAT IT WALKS OVER, and dies on its
   feet somewhere in the frozen goods. Set one alight at the end of an
   aisle and it will do more damage to the store than you will.
   ===================================================================== */

import * as THREE from 'three';
import { createSpriteMaterial } from './material.js';
import { STATES, ACTORS, stateOf } from './states.js';
import { angleNorm, angleDiff, pRandom, pRandomSpread, pChance, dist, dist2, TICRATE } from './util.js';

/* Doom's eight, in Doom's order. Index 8 is "nowhere to go". */
export const DI = { EAST: 0, NORTHEAST: 1, NORTH: 2, NORTHWEST: 3, WEST: 4, SOUTHWEST: 5, SOUTH: 6, SOUTHEAST: 7, NODIR: 8 };
const DIR_ANGLE = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, -3 * Math.PI / 4, -Math.PI / 2, -Math.PI / 4];
const OPPOSITE = [DI.WEST, DI.SOUTHWEST, DI.SOUTH, DI.SOUTHEAST, DI.EAST, DI.NORTHEAST, DI.NORTH, DI.NORTHWEST, DI.NODIR];
const DIAGONALS = [DI.NORTHWEST, DI.NORTHEAST, DI.SOUTHWEST, DI.SOUTHEAST];

let nextId = 1;

export class Actor {
  constructor(game, typeName, x, y, angle = 0, opts = {}) {
    const info = ACTORS[typeName];
    if (!info) throw new Error('no such actor type: ' + typeName);

    this.id = nextId++;
    this.game = game;
    this.type = typeName;
    this.info = info;
    this.x = x; this.y = y; this.z = 0;
    this.angle = angle;
    this.momx = 0; this.momy = 0; this.momz = 0;

    this.radius = info.radius ?? 16;
    this.height = info.height ?? 56;
    this.health = info.health ?? 1000;
    this.speed = info.speed ?? 0;
    this.mass = info.mass ?? 100;

    this.monster = !!info.monster;
    this.solid = info.solid ?? !!info.monster;
    this.shootable = info.shootable ?? !!info.monster;
    this.noclip = !!info.noclip;
    this.flammable = !!info.flammable;
    this.fuel = info.fuel ?? 0;
    this.flat = !!info.flat;

    this.target = null;
    this.threshold = 0;
    this.reactiontime = info.reaction ?? 0;
    this.movedir = DI.NODIR;
    this.movecount = 0;
    this.justAttacked = false;
    this.dead = false;
    this.removed = false;

    /* fire */
    this.burning = 0;            // tics left alight
    this.burnTick = 0;
    this.burnSprite = null;

    this.variant = opts.variant ?? 0;
    this.spriteOverride = opts.sprite || null;

    this.sector = game.level.sectorAt(x, y);
    this.z = this.sector ? this.sector.floor : 0;
    /* things that hang measure down from the ceiling, not up from the
       floor — a light over a shelf is at the same height as one over the
       aisle beside it, and the shelf's floor is 80 units higher */
    if (info.hangBelow && this.sector) this.z = this.sector.ceil - info.hangBelow;

    this.state = null;
    this.stateTics = 0;
    this.setState(info.spawn);

    this.mesh = null;
    this._lastKey = '';
  }

  /* ------------------------------------------------------------------
     The state machine
     ------------------------------------------------------------------ */
  setState(name) {
    /* A chain of zero-tic states resolves in one go, the way Doom's
       P_SetMobjState does — that is how a state can be a pure action
       with no frame of its own. The counter stops an accidental cycle
       from locking the game up. */
    let guard = 0;
    while (name) {
      const st = stateOf(name);
      if (!st) { this.remove(); return false; }
      this.state = st;
      this.stateTics = st.tics;
      if (st.action) this.doAction(st.action);
      if (this.removed) return false;
      if (st.tics !== 0) return true;
      name = st.next;
      if (++guard > 64) { console.warn('state loop at', st.name); return true; }
    }
    this.remove();
    return false;
  }

  tic() {
    if (this.removed) return;
    if (this.burning > 0) this.burnTic();
    if (this.stateTics === -1) return;          // resting for ever
    if (--this.stateTics > 0) return;
    if (this.state.next) this.setState(this.state.next);
    else this.remove();
  }

  doAction(name) {
    const fn = ACTIONS[name];
    if (fn) fn(this);
    else console.warn('no action', name);
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    if (this.mesh) { this.game.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = null; }
    if (this.burnSprite) { this.burnSprite.remove(); this.burnSprite = null; }
  }

  /* ------------------------------------------------------------------
     Moving
     ------------------------------------------------------------------ */
  get eyeZ() { return this.z + this.height * 0.72; }

  /** Try to walk `speed` units in the current movedir. Doom's P_TryWalk:
   *  either the whole step happens or none of it does — no sliding for
   *  monsters, because sliding is what lets them ooze through gaps a
   *  player could not. */
  tryWalk(dir = this.movedir) {
    if (dir === DI.NODIR) return false;
    const a = DIR_ANGLE[dir];
    const nx = this.x + Math.cos(a) * this.speed;
    const ny = this.y + Math.sin(a) * this.speed;
    if (!this.canStandAt(nx, ny)) return false;
    this.x = nx; this.y = ny;
    this.updateSector();
    /* Doom re-randomises movecount here, which is why a monster commits
       to a direction for a while instead of jittering every tic. */
    this.movecount = pRandom() & 15;
    return true;
  }

  canStandAt(nx, ny) {
    const lv = this.game.level;
    const [rx, ry, hit] = lv.slideMove(this.x, this.y, nx - this.x, ny - this.y, this.radius, this.z, this.height, true);
    if (hit || Math.abs(rx - nx) > 0.01 || Math.abs(ry - ny) > 0.01) return false;
    /* and nothing solid already standing there */
    for (const o of this.game.actors) {
      if (o === this || o.removed || !o.solid || o.dead) continue;
      const rr = this.radius + o.radius;
      if (dist2(nx, ny, o.x, o.y) < rr * rr) return false;
    }
    if (this.game.player && !this.game.player.dead) {
      const p = this.game.player;
      const rr = this.radius + p.radius;
      if (dist2(nx, ny, p.x, p.y) < rr * rr) return false;
    }
    return true;
  }

  updateSector() {
    const s = this.game.level.sectorAt(this.x, this.y, this.sector);
    if (s) { this.sector = s; this.z = s.floor; }
  }

  /** Doom's P_NewChaseDir. See the note at the top of the file. */
  newChaseDir() {
    const target = this.target;
    if (!target) { this.movedir = DI.NODIR; return; }
    const olddir = this.movedir;
    const turnaround = OPPOSITE[olddir];

    const dx = target.x - this.x;
    const dy = target.y - this.y;

    let d1 = dx > 10 ? DI.EAST : dx < -10 ? DI.WEST : DI.NODIR;
    let d2 = dy < -10 ? DI.SOUTH : dy > 10 ? DI.NORTH : DI.NODIR;

    /* straight at it, diagonally, if both axes want to move */
    if (d1 !== DI.NODIR && d2 !== DI.NODIR) {
      this.movedir = DIAGONALS[((dy < 0) ? 2 : 0) + ((dx > 0) ? 1 : 0)];
      if (this.movedir !== turnaround && this.tryWalk()) return;
    }

    /* otherwise the bigger axis first — usually. The dice are Doom's:
       one time in five it tries the shorter axis first, which is what
       stops a room full of monsters all taking the same route. */
    if (pRandom() > 200 || Math.abs(dy) > Math.abs(dx)) { const t = d1; d1 = d2; d2 = t; }
    if (d1 === turnaround) d1 = DI.NODIR;
    if (d2 === turnaround) d2 = DI.NODIR;

    if (d1 !== DI.NODIR) { this.movedir = d1; if (this.tryWalk()) return; }
    if (d2 !== DI.NODIR) { this.movedir = d2; if (this.tryWalk()) return; }

    /* nothing obvious left: work round the compass, from a random end */
    if (pRandom() & 1) {
      for (let dir = DI.EAST; dir <= DI.SOUTHEAST; dir++)
        if (dir !== turnaround) { this.movedir = dir; if (this.tryWalk()) return; }
    } else {
      for (let dir = DI.SOUTHEAST; dir >= DI.EAST; dir--)
        if (dir !== turnaround) { this.movedir = dir; if (this.tryWalk()) return; }
    }

    /* and only now, give up and turn round */
    if (turnaround !== DI.NODIR) { this.movedir = turnaround; if (this.tryWalk()) return; }
    this.movedir = DI.NODIR;
  }

  /* ------------------------------------------------------------------
     Seeing and hitting
     ------------------------------------------------------------------ */
  canSee(other) {
    if (!other) return false;
    return !this.game.level.sightBlocked(this.x, this.y, this.eyeZ, other.x, other.y, other.eyeZ);
  }

  /** Doom's 180-degree cone, plus the "or it is right on top of me"
   *  escape that stops you sneaking up on something you are touching. */
  inSightCone(other) {
    if (dist2(this.x, this.y, other.x, other.y) < 128 * 128) return true;
    const a = Math.atan2(other.y - this.y, other.x - this.x);
    return Math.abs(angleDiff(a, this.angle)) <= Math.PI / 2;
  }

  checkMeleeRange() {
    const t = this.target;
    if (!t || !this.info.meleeRange) return false;
    const r = this.info.meleeRange + t.radius;
    if (dist2(this.x, this.y, t.x, t.y) > r * r) return false;
    return this.canSee(t);
  }

  /** Doom's P_CheckMissileRange, simplified but keeping the two bits
   *  that matter: closer means more likely, and there is a floor on how
   *  often it can fire at all. */
  checkMissileRange() {
    const t = this.target;
    if (!t || !this.canSee(t)) return false;
    let d = dist(this.x, this.y, t.x, t.y) - 64;
    if (!this.info.melee && d > 200) d = 200;      // ranged-only pushes harder
    if (d > (this.info.missileRange ?? 1600)) return false;
    /* one roll in 256 scaled by distance: point blank is a near
       certainty, across the shop floor is a maybe */
    return pRandom() >= Math.min(200, d / 8);
  }

  damage(amount, source, opts = {}) {
    if (this.dead || this.removed || !this.shootable) return;
    this.health -= amount;

    if (this.health <= 0) { this.die(source, amount, opts); return; }

    /* Being shot makes a monster look at whoever did it, unless it is
       already very cross with somebody else. */
    if (source && source !== this && (!this.target || this.threshold <= 0)) {
      this.target = source;
      this.threshold = 100;
      if (this.state === stateOf(this.info.spawn) && this.info.see) this.setState(this.info.see);
    }
    if (this.info.painchance && pRandom() < this.info.painchance && this.info.pain) {
      this.setState(this.info.pain);
    }
  }

  die(source, overkill = 0, opts = {}) {
    if (this.dead) return;
    this.dead = true;
    this.solid = false;
    this.shootable = false;
    this.target = null;
    this.height = 8;                 // you can walk over a body

    if (this.info.explodes) { this.game.explode(this); }

    const gibbed = this.info.xdeath && this.health < (this.info.gibHealth ?? -1000);
    const st = gibbed ? this.info.xdeath : this.info.death;
    if (st) this.setState(st);
    else this.remove();

    if (this.monster) this.game.onMonsterKilled(this, source);
    if (this.type === 'LAMP') this.game.onLampDestroyed(this);
  }

  /* ------------------------------------------------------------------
     On fire

     Damage on a timer, a flame drawn on top, and — the part that makes
     it worth having — it keeps setting light to the floor it walks over.
     ------------------------------------------------------------------ */
  ignite(tics = 350) {
    if (!this.flammable || this.removed) return;
    const wasAlight = this.burning > 0;
    this.burning = Math.max(this.burning, tics);
    if (!wasAlight) {
      this.game.sound?.play('ignite', this);
      /* Whatever this thing is worth as fuel goes into the floor under
         it the moment it catches — a pallet of stock alight is a fire in
         the AISLE, not a fire on a prop. */
      if (this.fuel > 0) this.game.fire?.ignite(this.x, this.y, this.fuel);
    }
  }

  burnTic() {
    this.burning--;
    if (this.burning <= 0) { this.burning = 0; if (this.burnSprite) { this.burnSprite.remove(); this.burnSprite = null; } return; }
    if (++this.burnTick >= 12) {
      this.burnTick = 0;
      if (!this.dead) this.damage(this.monster ? 4 : 8, this.game.player, { fire: true });
      /* it drags the fire along behind it */
      this.game.fire?.ignite(this.x, this.y, 26);
    }
  }

  /* ------------------------------------------------------------------
     Drawing

     One quad per actor, spun about Y only, with the frame and rotation
     chosen fresh each render. Nothing is cached across frames because
     both can change every tic and the lookup is a Map hit.
     ------------------------------------------------------------------ */
  ensureMesh() {
    if (this.mesh) return;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);          // the foot of the quad is the origin
    const mat = createSpriteMaterial(null, { alphaTest: 0.5, transparent: false, width: 64, height: 64 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;   // the quad is spun in the shader,
    this.game.scene.add(this.mesh);    // so its bounds are a lie
  }

  render(camX, camY, billboardRot) {
    if (this.removed || !this.state) return;
    this.ensureMesh();

    /* Which of the eight views. rot 0 is head-on. */
    let rot = 0;
    if (!this.flat) {
      const toViewer = Math.atan2(camY - this.y, camX - this.x);
      const rel = angleNorm(this.angle - toViewer);
      rot = ((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8;
    }

    const spr = this.spriteOverride || (this.info.variants
      ? this.state.sprite.slice(0, 3) + (this.variant % this.info.variants)
      : this.state.sprite);
    const entry = this.game.sprites.get(spr, this.state.frame);
    const key = entry.key + rot;
    const u = this.mesh.material.uniforms;
    if (key !== this._lastKey) {
      this._lastKey = key;
      u.map.value = this.game.sprites.texture(entry, rot);
      const s = entry.scale;
      u.spriteScale.value.set(entry.w * s, entry.h * s);
    }
    u.billboardRot.value = billboardRot;
    u.fullbright.value = (this.info.fullbright || this.state.fullbright) ? 1 : 0;
    u.light.value = this.sector ? this.sector.light : 0.7;
    /* A car in the back row of the car park has to diminish the way the
       tarmac under it does, or it turns into a silhouette while the bay
       around it stays lit. */
    if (u.sky) u.sky.value = this.sector ? (this.sector.sky ?? (this.sector.outdoor ? 1 : 0)) : 0;
    this.mesh.position.set(this.x, this.z + (entry.lift || 0), -this.y);
  }
}

/* =====================================================================
   Action functions

   Called by name from the state tables. Each one is the whole of what
   the monster does at that moment.
   ===================================================================== */
export const ACTIONS = {
  /* Standing about until somebody walks into the aisle. */
  A_Look(a) {
    const p = a.game.player;
    if (!p || p.dead) return;
    if (!a.canSee(p)) return;
    if (!a.inSightCone(p)) return;
    if (dist2(a.x, a.y, p.x, p.y) > (a.info.sightRange ?? 2000) ** 2) return;
    a.target = p;
    a.game.sound?.play(a.info.seeSound, a);
    if (a.info.see) a.setState(a.info.see);
  },

  /* The whole of a monster's decision-making, once per walk frame. */
  A_Chase(a) {
    if (a.reactiontime > 0) a.reactiontime--;
    if (a.threshold > 0) {
      if (!a.target || a.target.dead) a.threshold = 0;
      else a.threshold--;
    }

    /* lost it? look for something else, else go back to standing */
    if (!a.target || a.target.dead) {
      const p = a.game.player;
      if (p && !p.dead && a.canSee(p) && dist2(a.x, a.y, p.x, p.y) < (a.info.sightRange ?? 2000) ** 2) {
        a.target = p;
      } else {
        a.setState(a.info.spawn);
        return;
      }
    }

    /* Never twice in a row. Doom's rule, and the reason a monster that
       has just shot at you takes a step before it shoots again — which
       is the window you actually play in. */
    if (a.justAttacked) { a.justAttacked = false; a.newChaseDir(); return; }

    if (a.info.melee && a.checkMeleeRange()) {
      a.game.sound?.play(a.info.attackSound, a);
      a.setState(a.info.melee);
      return;
    }
    if (a.info.missile && !a.movecount && a.checkMissileRange()) {
      a.setState(a.info.missile);
      a.justAttacked = true;
      return;
    }

    if (--a.movecount < 0 || !a.tryWalk()) a.newChaseDir();

    /* the occasional groan from somewhere in the store */
    if (pRandom() < 3) a.game.sound?.play(a.info.activeSound, a);

    /* face the way it is going */
    if (a.movedir !== DI.NODIR) a.angle = DIR_ANGLE[a.movedir];
  },

  A_FaceTarget(a) {
    if (!a.target) return;
    a.angle = Math.atan2(a.target.y - a.y, a.target.x - a.x);
  },

  /* The Associate's price gun: a hitscan with a spread, one shot. */
  A_PosAttack(a) {
    if (!a.target) return;
    ACTIONS.A_FaceTarget(a);
    a.game.sound?.play('assoShoot', a);
    const spread = (pRandomSpread() / 255) * 0.14;
    const damage = ((pRandom() % 5) + 1) * 3;
    a.game.hitscan(a, a.angle + spread, 2200, damage);
  },

  /* The Stocker throws a tin. Slow enough to dodge if you see it leave
     his hand, which is what the two 8-tic wind-up frames are for. */
  A_StockAttack(a) {
    if (!a.target) return;
    ACTIONS.A_FaceTarget(a);
    if (a.checkMeleeRange()) {
      a.game.sound?.play('stkrHit', a);
      a.target.damage(((pRandom() % 8) + 1) * 3, a);
      return;
    }
    a.game.sound?.play('stkrThrow', a);
    a.game.spawnMissile(a, a.target, 'TIN');
  },

  /* Glass, a pop, and a shower of sparks that falls. */
  A_LampBurst(a) {
    a.game.sound?.play('lampbreak', a);
    a.game.spawnSparks(a.x, a.y, a.z + 10, 10 + (pRandom() & 7));
  },

  A_Pain(a) { a.game.sound?.play(a.info.painSound, a); },
  A_Scream(a) { a.game.sound?.play(a.info.deathSound, a); },
  A_XScream(a) { a.game.sound?.play('gib', a); },

  /* It is on the floor now: no longer solid, no longer in the way. */
  A_Fall(a) {
    a.solid = false;
    a.height = 8;
    a.game.sound?.play('bodyfall', a);
  },
};
