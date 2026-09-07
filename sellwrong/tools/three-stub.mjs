/* A stand-in for three.js, so the parts of the game that have nothing to
   do with WebGL can be tested in Node.

   The bakeries, the map builder, the collision and the state tables are
   all pure — they make typed arrays and plain objects. The only reason
   they cannot run headless is that the modules holding them also import
   three at the top for the handful of names they use to UPLOAD the
   result. This supplies those names and nothing else.

   If a test fails with "X is not a constructor", the honest fix is to
   add X here, not to work around it in the test. */
export const NearestFilter = 1003, NearestMipmapNearestFilter = 1004, LinearFilter = 1006;
export const RepeatWrapping = 1000, ClampToEdgeWrapping = 1001;
export const SRGBColorSpace = 'srgb', FrontSide = 0, BackSide = 1, DoubleSide = 2;
export const RGBAFormat = 1023, UnsignedByteType = 1009, GLSL3 = '300 es';

class Stub { constructor(o) { if (o && typeof o === 'object') Object.assign(this, o); } }
export class CanvasTexture extends Stub {
  constructor(c) { super(); this.image = c; this.repeat = new Vector2(1, 1); this.offset = new Vector2(); }
  clone() { const t = new CanvasTexture(this.image); Object.assign(t, this); return t; }
}
export class DataTexture extends Stub { constructor(d, w, h) { super(); this.image = { data: d, width: w, height: h }; } }
export class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } }
export class Vector3 extends Vector2 { constructor(x = 0, y = 0, z = 0) { super(x, y); this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
export class Color { constructor() {} setRGB() { return this; } setHex() { return this; } }
export class Group { constructor() { this.children = []; } add(o) { this.children.push(o); } clear() { this.children.length = 0; } traverse() {} }
export class Object3D extends Group {}
export class Mesh extends Stub { constructor(g, m) { super(); this.geometry = g; this.material = m; this.position = new Vector3(); this.scale = new Vector3(1, 1, 1); this.rotation = new Vector3(); } }
export class BufferGeometry { setAttribute() {} computeBoundingSphere() {} dispose() {} translate() { return this; } }
export class PlaneGeometry extends BufferGeometry {}
export class CylinderGeometry extends BufferGeometry {}
export class Float32BufferAttribute { constructor(a, n) { this.array = a; this.itemSize = n; } }
export class BufferAttribute extends Float32BufferAttribute {}
export class ShaderMaterial extends Stub { dispose() {} }
export class RawShaderMaterial extends ShaderMaterial {}
export class MeshBasicMaterial extends Stub { constructor(o) { super(o); this.color = new Color(); } dispose() {} }
export class Scene extends Group { }
export class Camera extends Stub {}
export class PerspectiveCamera extends Camera {}
export class OrthographicCamera extends Camera { updateProjectionMatrix() {} }
export class WebGLRenderTarget extends Stub { constructor(w, h) { super(); this.texture = {}; this.width = w; this.height = h; } setSize() {} }

/* Ear clipping, so sector triangulation can actually be exercised rather
   than stubbed out to nothing. Enough for the simple polygons a floor
   plan produces. */
export const ShapeUtils = {
  triangulateShape(contour) {
    const n = contour.length;
    if (n < 3) return [];
    const idx = [...Array(n).keys()];
    const area = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    let signed = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) signed += contour[j].x * contour[i].y - contour[i].x * contour[j].y;
    if (signed < 0) idx.reverse();
    const out = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < n * n + 16) {
      let clipped = false;
      for (let i = 0; i < idx.length; i++) {
        const a = contour[idx[(i + idx.length - 1) % idx.length]];
        const b = contour[idx[i]];
        const c = contour[idx[(i + 1) % idx.length]];
        if (area(a, b, c) <= 0) continue;
        let inside = false;
        for (let k = 0; k < idx.length; k++) {
          const p = contour[idx[k]];
          if (p === a || p === b || p === c) continue;
          if (area(a, b, p) >= 0 && area(b, c, p) >= 0 && area(c, a, p) >= 0) { inside = true; break; }
        }
        if (inside) continue;
        out.push([idx[(i + idx.length - 1) % idx.length], idx[i], idx[(i + 1) % idx.length]]);
        idx.splice(i, 1);
        clipped = true;
        break;
      }
      if (!clipped) break;
    }
    if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
    return out;
  },
};
