/* =====================================================================
   SELLWRONG — the level: sectors, lines, and what you can walk into
   =====================================================================

   This is Doom's data model, because Doom's data model is right and
   thirty years of level editors have not improved on it.

     a SECTOR is a floor height, a ceiling height, a light level, and the
       textures on the floor and ceiling. It is a region, not a room —
       one room can be five sectors if bits of it are at different
       heights, and the checkout area here is exactly that.

     a LINE is a segment with a sector on one side or on both. One side
       and it is a wall. Two sides and it is a HOLE between two sectors,
       with a bit of wall above it (the gap between the two ceilings) and
       a bit of wall below it (the gap between the two floors). That one
       idea gives you doorways, windows, steps, counters, balconies and
       doors, without a single new concept.

     a THING is something standing somewhere. A zombie, a trolley, a
       spawn point.

   Everything follows. A door is a sector whose ceiling is on the floor
   and moves up. A shelf you can shoot over is a two-sided line whose
   lower part is 48 tall. A pallet you climb is a sector 24 higher than
   the one next to it, which the step-up rule lets you walk onto without
   even slowing down.

   AUTHORING. Writing linedefs by hand is miserable, so MapBuilder takes
   POLYGONS: you hand it the outline of a region and what is in it, and
   it works out the lines. When two regions share an edge it welds them
   into a two-sided line automatically — that is the whole trick, and it
   is why the map file at the bottom of this project reads like a floor
   plan instead of like a database dump.

   The one rule the author has to keep: if two regions share PART of an
   edge, both polygons need a vertex where the sharing starts and stops.
   A wall with a doorway in it is three edges, not one. Every Doom mapper
   who ever lived had to do the same thing.
   ===================================================================== */

import { pointInPoly, polyArea2, closestOnSeg, segIntersect, dist2, MAX_STEP } from './util.js';

/* Vertices that land within this of each other are the same vertex. Map
   coordinates are integers in practice, so this only ever catches float
   drift from a computed polygon. */
const WELD = 0.25;

/**
 * Decide every wall's texture from the geometry.
 *
 * The rule is that a step's face belongs to the thing that is raised and
 * a header's face belongs to the thing that is lowered. So the LOWER
 * texture comes from whichever sector has the higher floor — the shelf,
 * the counter, the kerb — and the UPPER from whichever has the lower
 * ceiling.
 *
 * Doing this from the heights rather than as each line is created is not
 * tidying. The first version took the texture from whichever sector
 * happened to claim the line second, which meant an aisle had shelving
 * down one side and blank plaster down the other, and which side got
 * which depended on the order two rectangles appeared in the map file.
 *
 * It runs again at RUNTIME whenever a sector changes its skin, which is
 * what lets a gondola that has burnt out turn charred on both faces
 * without the map having to know anything about fire.
 */
export function assignLineTextures(lines, sectors) {
  for (const l of lines) {
    if (l.texLocked) continue;
    const f = l.front !== null ? sectors[l.front] : null;
    const b = l.back !== null ? sectors[l.back] : null;
    if (!f || !b) {
      const s = f || b;
      if (s && l.middle !== null) l.middle = s.wallTex;
      continue;
    }
    l.upper = (f.ceil <= b.ceil ? f : b).upperTex;
    l.lower = (f.floor >= b.floor ? f : b).lowerTex;
  }
}

export class MapBuilder {
  constructor(name = 'MAP01') {
    this.name = name;
    this.verts = [];        // [x, y] in map space
    this._vkey = new Map();
    this.sectors = [];
    this.lines = [];
    this._edges = new Map();
    this.things = [];
  }

  vertex(x, y) {
    /* Snap to the weld grid to build the key, so two callers who computed
       the same corner slightly differently still land on one vertex. */
    const kx = Math.round(x / WELD), ky = Math.round(y / WELD);
    const key = kx + ',' + ky;
    const hit = this._vkey.get(key);
    if (hit !== undefined) return hit;
    const i = this.verts.length;
    this.verts.push([x, y]);
    this._vkey.set(key, i);
    return i;
  }

  /**
   * Add a region.
   *
   * poly    array of [x,y] in map space, in any winding — we fix it
   * props   floor, ceil, light, floorTex, ceilTex, wallTex, plus anything
   *         the game wants to hang off a sector (fuel, name, tag…)
   *
   * Returns the sector index.
   */
  sector(poly, props = {}) {
    /* Force counter-clockwise. Everything downstream — which side of a
       line a sector is on, which way a floor triangle faces — depends on
       knowing the winding, and the cheapest place to know it is here. */
    const pts = polyArea2(poly) < 0 ? poly.slice().reverse() : poly.slice();

    const idx = this.sectors.length;
    const s = {
      index: idx,
      floor: props.floor ?? 0,
      ceil: props.ceil ?? 128,
      light: props.light ?? 0.75,
      floorTex: props.floorTex ?? 'FLAT',
      ceilTex: props.ceilTex ?? 'FLAT',
      poly: pts,
      vidx: pts.map(p => this.vertex(p[0], p[1])),
      wallTex: props.wallTex ?? 'WALL',
      upperTex: props.upperTex ?? props.wallTex ?? 'WALL',
      lowerTex: props.lowerTex ?? props.wallTex ?? 'WALL',
      tag: props.tag ?? 0,
      name: props.name ?? '',
      /* the game's own business, carried along for the ride */
      fuel: props.fuel ?? 0,          // how well this region burns
      outdoor: !!props.outdoor,
      dynamic: !!props.dynamic,       // a door or lift — geometry rebuilt at runtime
      special: props.special ?? null,
      bbox: null,
    };
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const [x, y] of pts) {
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    s.bbox = [minx, miny, maxx, maxy];
    this.sectors.push(s);

    /* Walk the ring. The sector is on the LEFT of every edge, because the
       ring is counter-clockwise. */
    const n = s.vidx.length;
    for (let i = 0; i < n; i++) this._edge(s.vidx[i], s.vidx[(i + 1) % n], idx, props);
    return idx;
  }

  /**
   * `sectorOnLeft` is on the left of a->b.
   *
   * Doom's convention is that a line's FRONT side is the one on its
   * right, so the line gets stored running b->a and this sector becomes
   * its front. If the edge already exists, the other sector got here
   * first and this one is the back.
   */
  _edge(a, b, sectorOnLeft, props) {
    const key = a < b ? a + ':' + b : b + ':' + a;
    const existing = this._edges.get(key);
    if (!existing) {
      const line = {
        index: this.lines.length,
        v1: b, v2: a,
        front: sectorOnLeft, back: null,
        upper: null, middle: props.wallTex ?? 'WALL', lower: null,
        blocking: false,        // forced solid even when two-sided
        blockSight: false,      // stops monsters seeing through a two-sided line
        unpegUpper: false, unpegLower: false,
        xoff: 0, yoff: 0,
        special: null, tag: 0,
      };
      this.lines.push(line);
      this._edges.set(key, line);
      return line;
    }
    /* Second sector on this edge. It goes on whichever side is free. */
    if (existing.v1 === a && existing.v2 === b) existing.back = sectorOnLeft;
    else if (existing.front === null) existing.front = sectorOnLeft;
    else existing.back = sectorOnLeft;

    /* A two-sided line is a hole, so the middle texture goes away unless
       somebody deliberately puts one back (a grating, a shop window).
       The upper and lower skins are NOT decided here — see
       finishTextures, which decides them from the heights once both
       sectors are known. */
    existing.middle = null;
    return existing;
  }

  /** Find lines between two given sectors — how the map file reaches in to
   *  put a door special or a shop window on a specific opening. */
  linesBetween(sa, sb) {
    return this.lines.filter(l =>
      (l.front === sa && l.back === sb) || (l.front === sb && l.back === sa));
  }

  /** Every line of a sector that has nothing on the other side. */
  outerLines(s) {
    return this.lines.filter(l => (l.front === s || l.back === s) && (l.front === null || l.back === null));
  }

  finishTextures() { assignLineTextures(this.lines, this.sectors); }

  thing(type, x, y, angle = 0, props = {}) {
    this.things.push({ type, x, y, angle, ...props });
    return this.things[this.things.length - 1];
  }

  build() { this.finishTextures(); return new Level(this); }
}

/* =====================================================================
   Level — the built map, plus everything that asks it questions
   ===================================================================== */

const BLOCK = 128;      // Doom's blockmap cell, and still the right size

export class Level {
  constructor(mb) {
    this.name = mb.name;
    this.verts = mb.verts;
    this.sectors = mb.sectors;
    this.lines = mb.lines;
    this.things = mb.things;

    /* Runtime heights start at the authored ones. Doors and lifts move
       these; the geometry for those sectors is rebuilt when they do. */
    for (const s of this.sectors) {
      s.baseFloor = s.floor;
      s.baseCeil = s.ceil;
      s.baseLight = s.light;
    }

    /* Cache each line's geometry once. This gets hit thousands of times a
       second by collision and sight checks and it never changes. */
    for (const l of this.lines) {
      const [x1, y1] = this.verts[l.v1], [x2, y2] = this.verts[l.v2];
      l.x1 = x1; l.y1 = y1; l.x2 = x2; l.y2 = y2;
      l.dx = x2 - x1; l.dy = y2 - y1;
      l.len = Math.hypot(l.dx, l.dy);
      /* Doom's fake contrast: a wall running east-west reads a notch
         brighter and one running north-south a notch darker. There is no
         sun and the nudge is the same at midnight; it exists so that the
         corner between two walls is visible in a renderer that does no
         shading at all. Worth every one of the four lines. */
      l.contrast = Math.abs(l.dy) < 0.01 ? 0.055 : Math.abs(l.dx) < 0.01 ? -0.055 : 0;
    }

    this._buildBounds();
    this._buildBlockmap();
  }

  /** Redo every wall's texture after some sectors changed their skins. */
  refreshTextures() {
    assignLineTextures(this.lines, this.sectors);
  }

  _buildBounds() {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const [x, y] of this.verts) {
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    this.bounds = [minx, miny, maxx, maxy];
    this.originX = Math.floor(minx / BLOCK) * BLOCK - BLOCK;
    this.originY = Math.floor(miny / BLOCK) * BLOCK - BLOCK;
    this.cols = Math.ceil((maxx - this.originX) / BLOCK) + 2;
    this.rows = Math.ceil((maxy - this.originY) / BLOCK) + 2;
  }

  /* Two grids over the same cells: which LINES touch a cell, and which
     SECTORS overlap it. The first answers "what can I bump into"; the
     second answers "what am I standing on". Both would otherwise be a
     scan of the whole map every time anything moved. */
  _buildBlockmap() {
    const n = this.cols * this.rows;
    this.blockLines = Array.from({ length: n }, () => []);
    this.blockSectors = Array.from({ length: n }, () => []);

    for (const l of this.lines) {
      const c0 = this._col(Math.min(l.x1, l.x2)), c1 = this._col(Math.max(l.x1, l.x2));
      const r0 = this._row(Math.min(l.y1, l.y2)), r1 = this._row(Math.max(l.y1, l.y2));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++)
          this.blockLines[r * this.cols + c].push(l);
    }
    for (const s of this.sectors) {
      const c0 = this._col(s.bbox[0]), c1 = this._col(s.bbox[2]);
      const r0 = this._row(s.bbox[1]), r1 = this._row(s.bbox[3]);
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++)
          this.blockSectors[r * this.cols + c].push(s);
    }
  }

  _col(x) { return Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.originX) / BLOCK))); }
  _row(y) { return Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.originY) / BLOCK))); }

  /** Every line that could touch the box, without duplicates. */
  linesInBox(minx, miny, maxx, maxy, out = []) {
    out.length = 0;
    const c0 = this._col(minx), c1 = this._col(maxx);
    const r0 = this._row(miny), r1 = this._row(maxy);
    /* Stamp rather than a Set: a Set allocates on every query and this
       runs several times per actor per tic. */
    this._stamp = (this._stamp || 0) + 1;
    const st = this._stamp;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = this.blockLines[r * this.cols + c];
        for (let i = 0; i < cell.length; i++) {
          const l = cell[i];
          if (l._stamp === st) continue;
          l._stamp = st;
          out.push(l);
        }
      }
    }
    return out;
  }

  /** Which sector is (x,y) in? null if it is off the map. */
  sectorAt(x, y, hint = null) {
    /* Almost every call is "still in the same sector as last frame", so
       try that first and skip the grid entirely. */
    if (hint && this._inSector(hint, x, y)) return hint;
    const cell = this.blockSectors[this._row(y) * this.cols + this._col(x)];
    for (let i = 0; i < cell.length; i++) if (this._inSector(cell[i], x, y)) return cell[i];
    return null;
  }

  _inSector(s, x, y) {
    const b = s.bbox;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
    return pointInPoly(s.poly, x, y);
  }

  /* --------------------------------------------------------------------
     What a line does to something trying to walk through it

     A two-sided line is a hole, but not every hole is passable. Doom's
     four reasons, and they are still the right four:

       the map said so         a shop counter you cannot vault
       the gap is too short    ducking is not in this game either
       the step is too tall    24 units is a kerb, 25 is a wall
       the drop is too far     only applies to monsters, who are sensible

     Returns null if you may pass, otherwise the reason.
     ------------------------------------------------------------------ */
  lineBlocks(line, fromZ, height, isMonster) {
    if (line.back === null || line.front === null) return 'solid';
    if (line.blocking) return 'blocking';
    if (isMonster && line.blockMonsters) return 'blockmonsters';
    const a = this.sectors[line.front], b = this.sectors[line.back];
    const openTop = Math.min(a.ceil, b.ceil);
    const openBottom = Math.max(a.floor, b.floor);
    if (openTop - openBottom < height) return 'toolow';
    if (openBottom - fromZ > MAX_STEP) return 'toohigh';
    if (isMonster && fromZ - openBottom > 96) return 'toofar';   // monsters do not jump off things
    return null;
  }

  /**
   * Slide a circle from (x,y) by (dx,dy) and return where it ends up.
   *
   * Doom's method, and the reason its movement feels the way it does:
   * try the whole move; if it fails, try the move with X alone, then with
   * Y alone. Running into a wall at an angle therefore slides along it
   * rather than stopping dead, and it does so with no contact normals, no
   * penetration solving and no chance of resting inside geometry.
   *
   * SUBSTEPPING is not optional and does not belong to the caller. A move
   * longer than the radius can start on one side of a wall and end far
   * enough past it that neither the destination circle nor anything else
   * notices the wall was ever there, and on a slow frame every move is
   * that long. So the step is chopped here, where it cannot be forgotten,
   * rather than in each of the several places that want to move something.
   */
  slideMove(x, y, dx, dy, radius, z, height, isMonster = false) {
    const len = Math.hypot(dx, dy);
    const maxStep = Math.max(1, radius * 0.5);
    const steps = len > maxStep ? Math.ceil(len / maxStep) : 1;
    if (steps === 1) return this._slideOnce(x, y, dx, dy, radius, z, height, isMonster);

    const sx = dx / steps, sy = dy / steps;
    let cx = x, cy = y, hit = false;
    for (let i = 0; i < steps; i++) {
      const r = this._slideOnce(cx, cy, sx, sy, radius, z, height, isMonster);
      /* Stop early once we are wedged: another dozen substeps against the
         same corner will not free us and they are not free. */
      if (r[0] === cx && r[1] === cy) { hit = true; break; }
      cx = r[0]; cy = r[1];
      if (r[2]) hit = true;
    }
    return [cx, cy, hit];
  }

  _slideOnce(x, y, dx, dy, radius, z, height, isMonster) {
    if (this._canMove(x, y, x + dx, y + dy, radius, z, height, isMonster)) return [x + dx, y + dy, false];
    if (dx !== 0 && this._canMove(x, y, x + dx, y, radius, z, height, isMonster)) return [x + dx, y, true];
    if (dy !== 0 && this._canMove(x, y, x, y + dy, radius, z, height, isMonster)) return [x, y + dy, true];
    return [x, y, true];
  }

  /**
   * Two tests, and both are needed.
   *
   * The destination circle overlapping the line catches the ordinary case
   * — walking up to a wall and coming to rest against it.
   *
   * The path from here to there CROSSING the line catches the case that
   * the first test cannot see at all: a move long enough to finish on the
   * far side of a wall with clear air on both sides of it. The first test
   * looks only at where you land, and where you land is fine; it is the
   * wall you went through on the way that was the problem.
   */
  _canMove(fx, fy, tx, ty, radius, z, height, isMonster) {
    const minx = Math.min(fx, tx) - radius, maxx = Math.max(fx, tx) + radius;
    const miny = Math.min(fy, ty) - radius, maxy = Math.max(fy, ty) + radius;
    const lines = this.linesInBox(minx, miny, maxx, maxy, this._moveScratch || (this._moveScratch = []));
    const r2 = radius * radius;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      let touching = segIntersect(fx, fy, tx, ty, l.x1, l.y1, l.x2, l.y2) >= 0;
      if (!touching) {
        const [px, py] = closestOnSeg(l.x1, l.y1, l.x2, l.y2, tx, ty);
        touching = dist2(px, py, tx, ty) < r2;
      }
      if (!touching) continue;
      if (this.lineBlocks(l, z, height, isMonster)) return false;
    }
    return true;
  }

  /**
   * Can an eye at (ax,ay,az) see a point at (bx,by,bz)?
   *
   * Doom's REJECT table did this in one array lookup; we do it the honest
   * way and walk the segment. Cheap enough — a monster only asks when it
   * is idle and only every few tics.
   *
   * A two-sided line does not block sight unless the gap between the
   * floors and ceilings at the crossing point has closed past the ray,
   * which is what stops a zombie tracking you through a shut door but
   * lets it see you over a shelf.
   */
  sightBlocked(ax, ay, az, bx, by, bz) {
    const lines = this.linesInBox(
      Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by),
      this._sightScratch || (this._sightScratch = []));
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const t = segIntersect(ax, ay, bx, by, l.x1, l.y1, l.x2, l.y2);
      if (t < 0) continue;
      if (l.front === null || l.back === null || l.blockSight) return true;
      const fs = this.sectors[l.front], bs = this.sectors[l.back];
      const openTop = Math.min(fs.ceil, bs.ceil);
      const openBottom = Math.max(fs.floor, bs.floor);
      if (openTop <= openBottom) return true;
      const z = az + (bz - az) * t;
      if (z < openBottom || z > openTop) return true;
    }
    return false;
  }

  /** Cast a ray and return the nearest wall hit, or null. Hitscan weapons
   *  and thrown bottles both need this. */
  rayHitWall(ax, ay, az, bx, by, bz) {
    const lines = this.linesInBox(
      Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by),
      this._rayScratch || (this._rayScratch = []));
    let best = null, bestT = Infinity;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const t = segIntersect(ax, ay, bx, by, l.x1, l.y1, l.x2, l.y2);
      if (t < 0 || t >= bestT) continue;
      let solid = (l.front === null || l.back === null || l.blocking);
      if (!solid) {
        const fs = this.sectors[l.front], bs = this.sectors[l.back];
        const openTop = Math.min(fs.ceil, bs.ceil);
        const openBottom = Math.max(fs.floor, bs.floor);
        const z = az + (bz - az) * t;
        solid = (z < openBottom || z > openTop);
      }
      if (solid) { bestT = t; best = l; }
    }
    if (!best) return null;
    return {
      line: best, t: bestT,
      x: ax + (bx - ax) * bestT,
      y: ay + (by - ay) * bestT,
      z: az + (bz - az) * bestT,
    };
  }

  /** Every sector whose polygon overlaps a circle — how a fire finds the
   *  regions it is allowed to spread into. */
  sectorsNear(x, y, radius, out = []) {
    out.length = 0;
    const c0 = this._col(x - radius), c1 = this._col(x + radius);
    const r0 = this._row(y - radius), r1 = this._row(y + radius);
    this._sstamp = (this._sstamp || 0) + 1;
    const st = this._sstamp;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const cell = this.blockSectors[r * this.cols + c];
        for (let i = 0; i < cell.length; i++) {
          const s = cell[i];
          if (s._sstamp === st) continue;
          s._sstamp = st;
          out.push(s);
        }
      }
    }
    return out;
  }
}
