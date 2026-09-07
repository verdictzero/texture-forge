/* =====================================================================
   SELLWRONG — fire
   =====================================================================

   The store burning down is the game. Everything else — the zombies, the
   weapons, the layout — exists to make burning it down interesting. So
   the fire is not an effect painted over the level, it is a simulation
   running underneath it, and the level is built out of things that feed
   it.

   A GRID OF FUEL. Thirty-two units to a cell, laid over the whole map.
   Each cell knows how much there is to burn there, taken from the sector
   it sits in — a shelf of stock is worth a great deal, bare lino almost
   nothing, and the car park nothing at all. Fire spreads between
   neighbouring cells, consumes the fuel, and leaves the cell dead.

   WHAT MAKES IT A GAME AND NOT A SCREENSAVER is that the fuel is laid
   out the way a supermarket is: dense in the aisles, dense in the
   stockroom, and THIN in the walkways between them. So a fire in one
   aisle will happily eat that aisle and then stop at the cross-aisle,
   and burning the place down means deliberately carrying fire across the
   gaps. That is the whole game loop, and it falls out of the map having
   been drawn like a shop.

   WHAT FIRE CAN CROSS. A one-sided line is a wall and stops it dead. A
   two-sided line is a gap in something, and fire goes through gaps —
   under a shelf, over a counter, through a doorway. The only two-sided
   line that stops it is one whose opening has closed, which is to say a
   shut door. Worked out once at startup and stored as four bits a cell,
   because doing it per spread would be thousands of segment
   intersections a second.

   HEAT RISES AND FALLS. A cell that catches does not go instantly to
   maximum; it builds, peaks, and dies back as its fuel runs out. That
   curve is why a fire has a visible FRONT — a bright edge advancing into
   fresh stock with a dimming trail of embers behind it — instead of
   being a uniformly glowing region that grows.
   ===================================================================== */

import * as THREE from 'three';
import { createSpriteMaterial } from './material.js';
import { world } from './material.js';
import { pRandom, pChance, clamp, dist2, TICRATE } from './util.js';

const CELL = 32;

/* Heat runs 0..255. These are the shape of one cell's life. */
const IGNITE_AT   = 40;      // heat a cell starts at when it catches
const PEAK        = 255;
const RISE        = 14;      // heat gained per fire tic while fuelled
const FALL        = 9;       // heat lost per fire tic once the fuel is gone
const BURN_RATE   = 3;       // fuel consumed per fire tic, scaled by heat
const SPREAD_AT   = 90;      // heat below which a cell cannot light another

/* THE FIREBREAK RULE, and the most important number in the game.
   Fire will only TRAVEL into a cell with at least this much fuel. Below
   it a cell still burns perfectly well when something sets light to it
   directly — a flamethrower, a bottle, a member of staff who is already
   alight — but it will not catch from the cell next door.

   That single threshold is what turns the shop's floor plan into the
   level design. A gondola holds 300 and goes up like a gondola; an aisle
   holds 26 and is a firebreak. So a fire eats one run of shelving and
   stops dead at the walkway, and getting it across the walkway is the
   thing the player is actually doing all game.

   Without this the whole store went from one match in about thirty
   seconds and there was no game at all — which is what the first version
   did, and it looked wonderful and played like a screensaver. */
const SPREAD_MIN_FUEL = 60;

export class FireSystem {
  constructor(game) {
    this.game = game;
    const lv = game.level;
    const [minx, miny, maxx, maxy] = lv.bounds;
    this.originX = Math.floor(minx / CELL) * CELL - CELL;
    this.originY = Math.floor(miny / CELL) * CELL - CELL;
    this.cols = Math.ceil((maxx - this.originX) / CELL) + 2;
    this.rows = Math.ceil((maxy - this.originY) / CELL) + 2;
    const n = this.cols * this.rows;

    this.fuel  = new Uint16Array(n);
    this.fuel0 = new Uint16Array(n);
    this.heat  = new Uint8Array(n);
    this.link  = new Uint8Array(n);      // 1 E, 2 N, 4 W, 8 S
    this.sectorOf = new Int32Array(n).fill(-1);

    this.active = [];                    // cells currently alight
    this._activeSet = new Uint8Array(n);
    this.totalFuel = 0;
    this.burntFuel = 0;
    this.tics = 0;

    this._seed();
    this._linkCells();
  }

  idx(cx, cy) { return cy * this.cols + cx; }
  cellX(x) { return clamp(Math.floor((x - this.originX) / CELL), 0, this.cols - 1); }
  cellY(y) { return clamp(Math.floor((y - this.originY) / CELL), 0, this.rows - 1); }
  worldX(cx) { return this.originX + cx * CELL + CELL / 2; }
  worldY(cy) { return this.originY + cy * CELL + CELL / 2; }

  /* Every cell takes its fuel from the sector it lands in. A sector with
     fuel 0 — the car park, the tiled corridor — will never burn, and
     that is how the map author draws firebreaks. */
  _seed() {
    const lv = this.game.level;
    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const i = this.idx(cx, cy);
        const s = lv.sectorAt(this.worldX(cx), this.worldY(cy));
        if (!s) continue;
        this.sectorOf[i] = s.index;
        const f = s.fuel | 0;
        if (f <= 0) continue;
        /* a little variation, so the burn front is ragged rather than a
           expanding rectangle */
        const v = Math.max(1, Math.round(f * (0.75 + (pRandom() / 255) * 0.5)));
        this.fuel[i] = v; this.fuel0[i] = v;
        this.totalFuel += v;
      }
    }
  }

  _linkCells() {
    const lv = this.game.level;
    const DIRS = [[1, 0, 1, 4], [0, 1, 2, 8], [-1, 0, 4, 1], [0, -1, 8, 2]];
    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const i = this.idx(cx, cy);
        if (this.sectorOf[i] < 0) continue;
        const x1 = this.worldX(cx), y1 = this.worldY(cy);
        for (const [dx, dy, bit] of DIRS) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
          const j = this.idx(nx, ny);
          if (this.sectorOf[j] < 0) continue;
          if (!this._fireBlocked(x1, y1, this.worldX(nx), this.worldY(ny))) this.link[i] |= bit;
        }
      }
    }
  }

  /** Walls stop fire. Gaps do not — a shut door is the only two-sided
   *  line that counts as a wall here. */
  _fireBlocked(x1, y1, x2, y2) {
    const lv = this.game.level;
    const lines = lv.linesInBox(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2), []);
    for (const l of lines) {
      const t = segCross(x1, y1, x2, y2, l.x1, l.y1, l.x2, l.y2);
      if (t < 0) continue;
      if (l.front === null || l.back === null) return true;
      const a = lv.sectors[l.front], b = lv.sectors[l.back];
      /* A door is judged on what it will be, not on what it is right
         now. These links are worked out once at startup, with every door
         still shut, and a link that said "no" then would keep saying no
         for the rest of the level — so the stockroom would never catch
         however wide you left the door. */
      if (a.dynamic || b.dynamic) continue;
      if (Math.min(a.ceil, b.ceil) - Math.max(a.floor, b.floor) <= 0) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------
     Setting things alight
     ------------------------------------------------------------------ */

  /** Put heat into the world at a point. `strength` is roughly how much
   *  fuel is being dumped there too — a fuel can makes its own. */
  ignite(x, y, strength = 60, radius = CELL) {
    const cx0 = this.cellX(x - radius), cx1 = this.cellX(x + radius);
    const cy0 = this.cellY(y - radius), cy1 = this.cellY(y + radius);
    let lit = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = this.idx(cx, cy);
        if (this.sectorOf[i] < 0) continue;
        /* ACCELERANT. Something poured here burns even on bare lino,
           which is how you get a fire across a walkway that has nothing
           of its own to burn.

           How much is left behind decides whether the fire can then
           travel on by itself, and that is the difference between the
           two fire weapons. A flamethrower lays down about 40 — enough
           to burn where you are pointing, never enough to spread, so the
           flame goes exactly as far as you walk. A bottle lays down over
           a hundred, which is above the threshold, so its pool WILL
           reach into whatever is next to it. One is a brush; the other
           is a thrown decision. */
        if (strength > 40) {
          const target = Math.min(150, Math.round(strength * 0.62));
          if (this.fuel[i] < target) {
            const add = target - this.fuel[i];
            this.fuel[i] += add; this.fuel0[i] += add; this.totalFuel += add;
          }
        }
        if (this.fuel[i] <= 0) continue;
        if (this.heat[i] === 0) lit++;
        this.heat[i] = Math.max(this.heat[i], Math.min(PEAK, IGNITE_AT + strength));
        this._activate(i);
      }
    }
    return lit;
  }

  _activate(i) {
    if (this._activeSet[i]) return;
    this._activeSet[i] = 1;
    this.active.push(i);
  }

  heatAt(x, y) {
    const i = this.idx(this.cellX(x), this.cellY(y));
    return this.heat[i] / 255;
  }

  get burnFraction() { return this.totalFuel > 0 ? this.burntFuel / this.totalFuel : 0; }
  get burningCells() { return this.active.length; }

  /* ------------------------------------------------------------------
     One step of the simulation

     Runs every other tic. Fire is slow; running it at 35Hz costs twice
     as much and looks identical.
     ------------------------------------------------------------------ */
  tic() {
    this.tics++;
    if (this.tics & 1) return;

    const { heat, fuel, link, cols } = this;
    const next = [];
    const toIgnite = [];

    for (let k = 0; k < this.active.length; k++) {
      const i = this.active[k];
      let h = heat[i];
      const f = fuel[i];

      if (f > 0) {
        /* burning: heat climbs toward the peak and eats the fuel */
        h = Math.min(PEAK, h + RISE);
        const eat = Math.min(f, 1 + ((BURN_RATE * h) >> 8));
        fuel[i] = f - eat;
        this.burntFuel += eat;
      } else {
        /* spent: dying back to embers and then to nothing */
        h = h - FALL;
        if (h <= 0) { heat[i] = 0; this._activeSet[i] = 0; continue; }
      }
      heat[i] = h;

      /* Spread. Only a well-established cell can light another, so a
         fire has to take hold before it travels — which is what gives
         you the moment to decide whether to put more accelerant on it or
         get out of the aisle. */
      if (h >= SPREAD_AT) {
        const lk = link[i];
        if (lk & 1) this._trySpread(i + 1, toIgnite);
        if (lk & 2) this._trySpread(i + cols, toIgnite);
        if (lk & 4) this._trySpread(i - 1, toIgnite);
        if (lk & 8) this._trySpread(i - cols, toIgnite);
      }
      next.push(i);
    }

    this.active = next;
    for (const j of toIgnite) {
      if (j < 0 || j >= heat.length) continue;
      if (fuel[j] <= 0 || heat[j] > 0) continue;
      heat[j] = IGNITE_AT;
      this._activate(j);
    }

    this._burnThings();
    this._updateAtmosphere();
  }

  /** Will the fire travel here, and how eagerly?
   *
   *  Thin fuel is a firebreak, not a slow fuse: below the threshold the
   *  answer is simply no, however long the fire sits next to it. Above
   *  it, richer stock catches faster, so a fire runs down a full aisle
   *  and creeps through a half-empty one. */
  _trySpread(j, out) {
    if (j < 0 || j >= this.heat.length) return;
    const f = this.fuel[j];
    if (f < SPREAD_MIN_FUEL || this.heat[j] > 0) return;
    /* out of 256: 300 fuel is eager, 70 is reluctant */
    const chance = Math.min(80, 6 + ((f - SPREAD_MIN_FUEL) >> 2));
    if (pChance(chance)) out.push(j);
  }

  /** Anything standing in a hot cell catches, and anything alive in one
   *  gets hurt. Includes the player: there is no safe way to stand in
   *  a fire you started. */
  _burnThings() {
    const g = this.game;
    for (const a of g.actors) {
      if (a.removed || a.noclip) continue;
      const h = this.heat[this.idx(this.cellX(a.x), this.cellY(a.y))];
      if (h < 70) continue;
      if (a.flammable && !a.burning) a.ignite(280 + (pRandom() & 127));
      else if (a.shootable && !a.dead && (this.tics & 15) === 0) a.damage(3, null, { fire: true });
    }
    const p = g.player;
    if (p && !p.dead) {
      const h = this.heat[this.idx(this.cellX(p.x), this.cellY(p.y))];
      if (h > 70 && (this.tics & 7) === 0) p.damage(Math.max(2, h >> 5), null, { fire: true });
    }
  }

  /** Smoke thickens as the store goes, and the one fire light parks
   *  itself in the middle of whatever is burning nearest the player. */
  _updateAtmosphere() {
    const burn = this.burnFraction;
    world.fogDensity.value = Math.min(0.92, burn * 2.4);
    world.fogColor.value.setRGB(0.16 + burn * 0.12, 0.14 + burn * 0.07, 0.13);

    const p = this.game.player;
    if (!p) return;
    let sx = 0, sy = 0, sw = 0, near = 0;
    /* A sample, not a sum: with a whole aisle alight there can be
       hundreds of cells and the answer does not change. */
    const step = Math.max(1, this.active.length >> 6);
    for (let k = 0; k < this.active.length; k += step) {
      const i = this.active[k];
      const h = this.heat[i];
      if (h < 60) continue;
      const x = this.worldX(i % this.cols), y = this.worldY((i / this.cols) | 0);
      const d2 = dist2(x, y, p.x, p.y);
      if (d2 > 900 * 900) continue;
      const w = h / 255;
      sx += x * w; sy += y * w; sw += w; near++;
    }
    if (sw > 0.01) {
      world.fireLightPos.value.set(sx / sw, this.game.level.sectorAt(sx / sw, sy / sw)?.floor + 48 || 48, sy / sw);
      /* flicker, keyed to the tic so it is the same for everything */
      const flick = 0.86 + 0.14 * Math.sin(this.tics * 0.7) * Math.cos(this.tics * 0.31);
      world.fireLight.value = Math.min(1.5, Math.sqrt(sw * step) * 0.30) * flick;
      world.fireLightRange.value = 380 + Math.min(700, sw * step * 26);
    } else {
      world.fireLight.value *= 0.86;
    }
  }

  /* ------------------------------------------------------------------
     Drawing

     A fixed pool of quads, parked on the hottest cells near the player
     each frame. There is no per-cell sprite object and nothing is
     created or destroyed while the store burns — with a whole aisle
     alight that would be hundreds of allocations a second for something
     nobody can distinguish from sixty well-placed flames.
     ------------------------------------------------------------------ */
  /* Built on the first frame that draws, not in the constructor. The
     simulation is pure — a fuel grid and some integers — and coupling it
     to a scene graph at construction meant it could not be run or tested
     without a renderer, which is exactly backwards for the one system in
     the game whose behaviour over a thousand tics is worth checking. */
  _initSprites() {
    if (this.sprites) return;
    this.POOL = 96;
    this.sprites = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    for (let i = 0; i < this.POOL; i++) {
      const mat = createSpriteMaterial(null, { alphaTest: 0.5, fullbright: true, width: 32, height: 48 });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = 10;                 // over the world, under the HUD
      this.game.scene.add(m);
      this.sprites.push(m);
    }
    this._candidates = [];
  }

  render(camX, camY, billboardRot) {
    this._initSprites();
    const bank = this.game.sprites;
    const cand = this._candidates;
    cand.length = 0;

    /* Nothing is drawn within arm's reach. A 32-unit flame at 20 units
       from the eye is a wall of orange with nothing behind it, and
       standing in a burning aisle put one of those over the whole
       screen — which reads as a bug rather than as being on fire. Doom's
       sprite clipping did the same thing for the same reason. You still
       take the damage; you just do not have a texture pressed against
       your face. */
    const NEAR2 = 46 * 46;

    for (let k = 0; k < this.active.length; k++) {
      const i = this.active[k];
      const h = this.heat[i];
      if (h < 30) continue;
      const x = this.worldX(i % this.cols), y = this.worldY((i / this.cols) | 0);
      const d2 = dist2(x, y, camX, camY);
      if (d2 > 2000 * 2000 || d2 < NEAR2) continue;
      /* Nearest first, but weight by heat so a big fire further off
         still gets drawn ahead of an ember at your feet. */
      cand.push({ i, x, y, h, key: d2 / (0.35 + h / 255) });
    }
    cand.sort((a, b) => a.key - b.key);

    const n = Math.min(this.POOL, cand.length);
    for (let s = 0; s < this.POOL; s++) {
      const m = this.sprites[s];
      if (s >= n) { m.visible = false; continue; }
      const c = cand[s];
      /* which flame: an ember, a fire, or a proper blaze */
      const set = c.h > 200 ? 'BLAZ' : c.h > 90 ? 'FIRE' : 'EMBR';
      const letters = set === 'EMBR' ? 6 : 8;
      /* Offset by the cell index so neighbouring flames are out of step
         with each other — in phase, a wall of fire pulses like a heart. */
      const frame = String.fromCharCode(65 + ((this.tics >> 1) + c.i * 3) % letters);
      const entry = bank.get(set, frame);
      const u = m.material.uniforms;
      u.map.value = bank.texture(entry, 0);
      const sc = entry.scale * (0.7 + (c.h / 255) * 0.75);
      u.spriteScale.value.set(entry.w * sc, entry.h * sc);
      u.billboardRot.value = billboardRot;
      u.light.value = 1;
      const sec = this.game.level.sectors[this.sectorOf[c.i]];
      m.position.set(c.x, sec ? sec.floor : 0, c.y);
      m.visible = true;
    }
  }
}

/* Local copy so the fire's link pass does not import the whole of
   util's geometry section for one function. */
function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const r1 = bx - ax, r2 = by - ay, s1 = dx - cx, s2 = dy - cy;
  const den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-9) return -1;
  const t = ((cx - ax) * s2 - (cy - ay) * s1) / den;
  const u = ((cx - ax) * r2 - (cy - ay) * r1) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return -1;
  return t;
}
