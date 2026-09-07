/* =====================================================================
   SELLWRONG — laying out a shop in rectangles
   =====================================================================

   MapBuilder welds two sectors into a doorway when they share an EDGE,
   and "share an edge" means share both its endpoints. So a long wall
   with a shop floor on one side and three rooms on the other has to be
   drawn as three edges, with a vertex where each room starts and stops.
   Every Doom mapper has done this by hand and every Doom mapper has got
   it wrong at least once, because the vertex you forgot produces a
   sector that is silently inside-out somewhere across the map.

   So it is done here instead. Give it rectangles; it finds, for every
   edge, which other rectangles abut part of it, and splits that edge at
   their corners. What comes out is a set of polygons whose shared edges
   agree exactly, by construction.

   WALLS ARE THE GAPS. Two rectangles that touch become an opening
   between two rooms — that is what touching MEANS here. So a wall is
   drawn by NOT putting a rectangle there: leave sixteen units between
   two rooms and the void between them is the wall, with a one-sided
   line facing into each. A doorway is a small rectangle bridging that
   gap, which is exactly what a doorway is in a real building.

   Everything below follows from that one rule, and it is the rule that
   makes the shop layout in sellwrong.js readable as a floor plan.
   ===================================================================== */

export class RectMap {
  constructor(mb) { this.mb = mb; this.rects = []; }

  /** x0<x1, y0<y1. Props go straight through to MapBuilder.sector. */
  add(x0, y0, x1, y1, props = {}) {
    if (x1 <= x0 || y1 <= y0) throw new Error(`degenerate rect ${x0},${y0} ${x1},${y1}`);
    const r = { x0, y0, x1, y1, props, sector: -1 };
    this.rects.push(r);
    return r;
  }

  /** Named bands, so a floor plan can be written as "x band 4 to 6". */
  static bands(list) {
    return {
      v: list,
      at: i => list[i],
      span: (a, b) => [list[a], list[b]],
    };
  }

  _overlap(a0, a1, b0, b1) { return Math.min(a1, b1) - Math.max(a0, b0) > 1e-6; }

  /** Split points along one edge of `r`, from every rect that abuts it. */
  _splits(r, side) {
    const out = new Set();
    for (const o of this.rects) {
      if (o === r) continue;
      if (side === 'bottom') {
        if (o.y1 !== r.y0 || !this._overlap(r.x0, r.x1, o.x0, o.x1)) continue;
        if (o.x0 > r.x0 && o.x0 < r.x1) out.add(o.x0);
        if (o.x1 > r.x0 && o.x1 < r.x1) out.add(o.x1);
      } else if (side === 'top') {
        if (o.y0 !== r.y1 || !this._overlap(r.x0, r.x1, o.x0, o.x1)) continue;
        if (o.x0 > r.x0 && o.x0 < r.x1) out.add(o.x0);
        if (o.x1 > r.x0 && o.x1 < r.x1) out.add(o.x1);
      } else if (side === 'left') {
        if (o.x1 !== r.x0 || !this._overlap(r.y0, r.y1, o.y0, o.y1)) continue;
        if (o.y0 > r.y0 && o.y0 < r.y1) out.add(o.y0);
        if (o.y1 > r.y0 && o.y1 < r.y1) out.add(o.y1);
      } else {
        if (o.x0 !== r.x1 || !this._overlap(r.y0, r.y1, o.y0, o.y1)) continue;
        if (o.y0 > r.y0 && o.y0 < r.y1) out.add(o.y0);
        if (o.y1 > r.y0 && o.y1 < r.y1) out.add(o.y1);
      }
    }
    return [...out].sort((a, b) => a - b);
  }

  /** Turn every rectangle into a sector. Counter-clockwise, starting at
   *  the south-west corner and going east along the bottom. */
  build() {
    /* An overlap is always a mistake and always produces a level with a
       room you can stand in two of at once. Cheap to check, miserable to
       find later. */
    for (let i = 0; i < this.rects.length; i++)
      for (let j = i + 1; j < this.rects.length; j++) {
        const a = this.rects[i], b = this.rects[j];
        if (this._overlap(a.x0, a.x1, b.x0, b.x1) && this._overlap(a.y0, a.y1, b.y0, b.y1))
          throw new Error(`rects overlap: [${a.x0},${a.y0},${a.x1},${a.y1}] and [${b.x0},${b.y0},${b.x1},${b.y1}]`);
      }

    for (const r of this.rects) {
      const poly = [];
      poly.push([r.x0, r.y0]);
      for (const x of this._splits(r, 'bottom')) poly.push([x, r.y0]);
      poly.push([r.x1, r.y0]);
      for (const y of this._splits(r, 'right')) poly.push([r.x1, y]);
      poly.push([r.x1, r.y1]);
      for (const x of this._splits(r, 'top').slice().reverse()) poly.push([x, r.y1]);
      poly.push([r.x0, r.y1]);
      for (const y of this._splits(r, 'left').slice().reverse()) poly.push([r.x0, y]);
      r.sector = this.mb.sector(poly, r.props);
      r.props.__index = r.sector;
    }
    return this.rects;
  }
}
