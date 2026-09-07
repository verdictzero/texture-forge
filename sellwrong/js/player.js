/* =====================================================================
   SELLWRONG — the player
   =====================================================================

   Doom's movement numbers, exactly, because they are the reason it feels
   like Doom and because approximating them gets you something that feels
   like a Doom clone.

     friction     0.90625 a tic
     walk thrust  0.78125 units a tic   ->  8.33 u/tic terminal
     run thrust   1.5625                -> 16.66 u/tic terminal
     strafe       0.75 / 1.25

   Terminal velocity is thrust / (1 - friction), which is where those
   awkward-looking fractions come from: they are 25/32 and 50/32, the
   numbers in Doom's own table. The player accelerates to full speed in
   about a third of a second and slides for about the same again after
   letting go, and that slide is most of what people mean when they say
   the movement has weight.

   NO GRAVITY, NO JUMPING, NO CROUCHING. The player is a cylinder that
   walks, climbs anything 24 or under without slowing down, and cannot
   get over anything taller. Not a simplification — a design. Every
   height in the map means something because the player cannot cheat it.

   THREE WEAPONS, and they are an argument about fire.

     BOXCUTTER  no ammo, no fire, kills one thing at a time. What is left
                when the fuel runs out, which it will.
     FLAMER     the verb the game is named after. A short cone, a lot of
                ignition, and an ammo count that is really a timer on how
                much of the store you can take.
     MOLOTOV    fire with reach. The answer to an aisle you cannot get
                into and a walkway fire will not cross by itself.
   ===================================================================== */

import { PLAYER_RADIUS, PLAYER_HEIGHT, PLAYER_EYE, MAX_STEP, TICRATE,
         angleNorm, clamp, pRandom, pRandomSpread, dist2 } from './util.js';

const FRICTION   = 0.90625;
const WALK_FWD   = 25 / 32,  RUN_FWD  = 50 / 32;
const WALK_SIDE  = 24 / 32,  RUN_SIDE = 40 / 32;
const STOP_SPEED = 0.06;
const MAX_PITCH  = 0.72;          // about 41 degrees, the usual port limit

/* THE FLAMETHROWER IS THE GAME AND IT IS NOT SUBTLE.

   A four-metre cone at forty-five degrees, enough damage to delete a
   member of staff in a fraction of a second, and it lays down enough
   accelerant that what it touches goes on burning by itself long after
   you have walked away. There is no aiming and no ammo management worth
   the name — the tank is enormous and the store is full of cans.

   The other two are written and finished and are not issued. A boxcutter
   is a more interesting weapon than a flamethrower in almost every game
   ever made, and in THIS game it is the wrong verb: the point is not to
   kill the night crew, it is to burn down the building, and the night
   crew are simply in the way. Give the player one tool that does the
   thing the game is about and the game explains itself. */
export const WEAPONS = {
  FLAMER: {
    slot: 1, name: 'FLAMER', sprite: 'FLMG',
    ready: 'A', fire: ['B', 'C'], fireTics: [2, 2],
    ammo: 'fuel', ammoPerShot: 1, autofire: true,
    /* 400 units of reach and a 45-degree cone. An aisle is 160 across
       and 600 long, so one sweep from the end of it lights most of one
       side — which is exactly the feeling being aimed for. */
    range: 400, arc: 0.78,
    damage: () => (pRandom() % 9) + 8,
    sound: 'flame',
  },

  BOXCUTTER: {
    slot: 1, name: 'BOXCUTTER', sprite: 'CUTG',
    ready: 'A', fire: ['B', 'B', 'C'], fireTics: [4, 4, 5],
    hitAt: 1,                       // which fire frame lands the blow
    ammo: null, melee: true, range: 80, arc: 0.9,
    damage: () => ((pRandom() % 8) + 1) * 2,
    sound: 'swing', hitSound: 'cut',
  },
  MOLOTOV: {
    slot: 3, name: 'MOLOTOV', sprite: 'MOLG',
    ready: 'A', fire: ['B', 'B', 'C', 'C'], fireTics: [6, 6, 8, 12],
    throwAt: 2,
    ammo: 'bottles', ammoPerShot: 1,
    sound: 'throw',
  },
};

export class Player {
  constructor(game, x, y, angle) {
    this.game = game;
    this.x = x; this.y = y; this.angle = angle; this.pitch = 0;
    this.momx = 0; this.momy = 0;
    this.radius = PLAYER_RADIUS;
    this.height = PLAYER_HEIGHT;
    this.sector = game.level.sectorAt(x, y);
    this.z = this.sector ? this.sector.floor : 0;

    this.health = 100;
    this.armour = 0;
    this.dead = false;
    this.shootable = true;
    this.monster = false;

    this.ammo = { fuel: 500, bottles: 0 };
    this.maxAmmo = { fuel: 999, bottles: 12 };
    /* One weapon issued. The other two are built and tested and stay
       switched off until there is a reason for them. */
    this.owned = { FLAMER: true };
    this.weapon = 'FLAMER';
    this.pendingWeapon = null;

    this.fireIndex = -1;      // -1 = at rest
    this.fireTics = 0;
    this.refire = false;

    this.bob = 0; this.bobPhase = 0;
    this.viewZ = this.z + PLAYER_EYE;
    this.damageFlash = 0;
    this.pickupFlash = 0;
    this.kills = 0;
    this.useCooldown = 0;
  }

  get eyeZ() { return this.viewZ; }

  /* ------------------------------------------------------------------
     One tic
     ------------------------------------------------------------------ */
  tic(input, dt) {
    if (this.useCooldown > 0) this.useCooldown--;
    if (this.damageFlash > 0) this.damageFlash--;
    if (this.pickupFlash > 0) this.pickupFlash--;

    if (this.dead) { this.deathTic(); return; }

    this.turn(input);
    this.move(input);
    this.weaponTic(input);

    if (input.use && this.useCooldown === 0) { this.use(); this.useCooldown = 8; }
  }

  turn(input) {
    this.angle -= input.look.x;
    this.angle = angleNorm(this.angle);
    this.pitch = clamp(this.pitch - input.look.y, -MAX_PITCH, MAX_PITCH);
  }

  move(input) {
    const run = input.run;
    const fwd = (run ? RUN_FWD : WALK_FWD) * input.move.y;
    const side = (run ? RUN_SIDE : WALK_SIDE) * input.move.x;

    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    this.momx += c * fwd + s * side;
    this.momy += s * fwd - c * side;

    /* Friction, then the dead zone that stops a player drifting for ever
       at a hundredth of a unit a tic. */
    this.momx *= FRICTION; this.momy *= FRICTION;
    if (Math.abs(this.momx) < STOP_SPEED) this.momx = 0;
    if (Math.abs(this.momy) < STOP_SPEED) this.momy = 0;

    const lv = this.game.level;
    const [nx, ny] = lv.slideMove(this.x, this.y, this.momx, this.momy,
                                  this.radius, this.z, this.height, false);
    /* Bumping into a monster stops you the same way a wall does — and
       being able to shove past them would make every corridor free. */
    const blocked = this.thingInWay(nx, ny);
    if (!blocked) { this.x = nx; this.y = ny; }
    else { this.momx *= 0.2; this.momy *= 0.2; }

    const sec = lv.sectorAt(this.x, this.y, this.sector);
    if (sec) {
      this.sector = sec;
      /* Step up or down. Instant, like Doom — the smoothing is in the
         view height below, not in the body. */
      this.z = sec.floor;
    }

    /* View bob. Doom's: proportional to the square of the speed, capped,
       and driven by a phase that only advances while you are moving. */
    const speed2 = this.momx * this.momx + this.momy * this.momy;
    const targetBob = Math.min(16, speed2 * 0.32);
    this.bob += (targetBob - this.bob) * 0.25;
    this.bobPhase += 0.19;
    const eye = this.z + PLAYER_EYE + Math.sin(this.bobPhase) * this.bob * 0.5;
    /* the eye lags the feet, so a kerb is a lurch and not a teleport */
    this.viewZ += (eye - this.viewZ) * 0.45;
  }

  thingInWay(nx, ny) {
    for (const a of this.game.actors) {
      if (a.removed || !a.solid || a.dead || a.noclip) continue;
      const rr = this.radius + a.radius;
      if (dist2(nx, ny, a.x, a.y) < rr * rr) {
        if (a.info.pushable) {           // trolleys move, they do not stop you
          const d = Math.hypot(a.x - nx, a.y - ny) || 1;
          a.x += ((a.x - nx) / d) * 6; a.y += ((a.y - ny) / d) * 6;
          a.updateSector();
          continue;
        }
        return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------
     Weapons
     ------------------------------------------------------------------ */
  get def() { return WEAPONS[this.weapon]; }
  get firing() { return this.fireIndex >= 0; }

  ammoFor(w) { const d = WEAPONS[w]; return d.ammo ? this.ammo[d.ammo] : Infinity; }
  hasAmmo(w) { const d = WEAPONS[w]; return !d.ammo || this.ammo[d.ammo] >= (d.ammoPerShot || 1); }

  selectSlot(n) {
    for (const [k, d] of Object.entries(WEAPONS))
      if (d.slot === n && this.owned[k]) { if (k !== this.weapon) this.pendingWeapon = k; return; }
  }

  cycleWeapon(dir) {
    const list = Object.keys(WEAPONS).filter(k => this.owned[k]);
    const i = list.indexOf(this.weapon);
    this.pendingWeapon = list[((i + dir) % list.length + list.length) % list.length];
  }

  weaponTic(input) {
    if (input.weaponSlot) this.selectSlot(input.weaponSlot);
    if (input.weaponCycle) this.cycleWeapon(input.weaponCycle > 0 ? 1 : -1);

    if (this.firing) {
      if (--this.fireTics > 0) return;
      const d = this.def;
      /* the frame we are ABOUT to leave is the one that does the damage */
      this.fireIndex++;
      if (this.fireIndex === d.hitAt) this.meleeSwing(d);
      if (this.fireIndex === d.throwAt) this.throwBottle();
      if (this.fireIndex >= d.fire.length) {
        this.fireIndex = -1;
        /* holding the button on an automatic goes straight round again */
        if (d.autofire && input.attack && this.hasAmmo(this.weapon)) this.startFire();
        return;
      }
      this.fireTics = d.fire ? d.fireTics[Math.min(this.fireIndex, d.fireTics.length - 1)] : 4;
      if (d.autofire) this.flameTic(d);
      return;
    }

    /* only swap weapons between shots, never during one */
    if (this.pendingWeapon) {
      this.weapon = this.pendingWeapon;
      this.pendingWeapon = null;
      this.game.message(WEAPONS[this.weapon].name);
      return;
    }
    if (input.attack) {
      if (this.hasAmmo(this.weapon)) this.startFire();
      else if (!this._dryClick) { this.game.message('NO ' + (this.def.ammo || 'AMMO').toUpperCase()); this._dryClick = true; }
    } else this._dryClick = false;
  }

  startFire() {
    const d = this.def;
    if (d.ammo) this.ammo[d.ammo] -= d.ammoPerShot || 1;
    this.fireIndex = 0;
    this.fireTics = d.fireTics[0];
    this.game.sound?.play(d.sound, this);
    if (d.autofire) this.flameTic(d);
    /* Being shot at wakes the store up, and so does setting fire to it. */
    this.game.noise(this, d.autofire ? 900 : 700);
  }

  /** The boxcutter: everything in a cone in front, nearest first. */
  meleeSwing(d) {
    const best = this.game.actorsInCone(this, d.range, d.arc, true);
    if (!best.length) return;
    const a = best[0];
    a.damage(d.damage(), this);
    this.game.sound?.play(d.hitSound, this);
    this.game.spawnPuff(a.x, a.y, a.z + a.height * 0.6);
  }

  /** The flamer: a cone of ignition, which is a different thing from a
   *  cone of damage and the reason this weapon is interesting. The cone
   *  is walked in rings, and each ring stops at the first wall it meets,
   *  so the flame goes round corners no better than you can see round
   *  them. */
  flameTic(d) {
    const step = 32;
    for (let r = 24; r <= d.range; r += step) {
      const spread = (r / d.range) * d.arc * 0.5;
      for (let k = -2; k <= 2; k++) {
        const a = this.angle + k * spread * 0.5;
        const fx = this.x + Math.cos(a) * r;
        const fy = this.y + Math.sin(a) * r;
        /* Stop at the first wall — a flamethrower that reaches through
           the frozen aisle into the stockroom is not a weapon, it is a
           cheat code. */
        if (this.game.level.rayHitWall(this.x, this.y, this.viewZ - 12, fx, fy, this.viewZ - 12)) break;
        this.game.fire.ignite(fx, fy, 150 - (r / d.range) * 40, 26);
      }
    }
    for (const a of this.game.actorsInCone(this, d.range, d.arc, true)) {
      a.damage(d.damage(), this, { fire: true });
      if (a.flammable) a.ignite(300);
    }
  }

  throwBottle() {
    this.game.spawnMolotov(this);
  }

  /* ------------------------------------------------------------------
     Using things
     ------------------------------------------------------------------ */
  use() { this.game.tryUse(this); }

  /* ------------------------------------------------------------------
     Being hurt
     ------------------------------------------------------------------ */
  damage(amount, source, opts = {}) {
    if (this.dead) return;
    if (this.armour > 0) {
      const soak = Math.min(this.armour, Math.floor(amount / 3));
      this.armour -= soak; amount -= soak;
    }
    this.health -= amount;
    this.damageFlash = Math.min(16, 5 + amount * 0.6);
    this.game.sound?.play(opts.fire ? 'burn' : 'hurt', this);
    /* the shove, so a hit from the side moves you */
    if (source) {
      const a = Math.atan2(this.y - source.y, this.x - source.x);
      const push = Math.min(6, amount * 0.22);
      this.momx += Math.cos(a) * push; this.momy += Math.sin(a) * push;
    }
    if (this.health <= 0) this.die();
  }

  give(kind, amount) {
    if (kind === 'health') {
      const before = this.health;
      this.health = Math.min(100, this.health + amount);
      if (this.health === before) return false;
    } else {
      const cap = this.maxAmmo[kind] ?? 999;
      if (this.ammo[kind] >= cap) return false;
      this.ammo[kind] = Math.min(cap, this.ammo[kind] + amount);
    }
    this.pickupFlash = 8;
    return true;
  }

  die() {
    this.dead = true;
    this.health = 0;
    this.deathViewTarget = this.z + 8;
    this.game.sound?.play('playerDie', this);
    this.game.onPlayerDied();
  }

  deathTic() {
    /* the view sinks to the floor and stays there */
    this.viewZ += (this.z + 8 - this.viewZ) * 0.12;
    this.momx *= 0.86; this.momy *= 0.86;
    const [nx, ny] = this.game.level.slideMove(this.x, this.y, this.momx, this.momy, this.radius, this.z, 8, false);
    this.x = nx; this.y = ny;
  }
}
