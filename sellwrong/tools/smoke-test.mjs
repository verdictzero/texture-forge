/* =====================================================================
   SELLWRONG — smoke test
   =====================================================================

   node tools/smoke-test.mjs

   No install, no browser. Everything that is not WebGL is checked here:
   the palette, the texture and sprite bakeries, the map, the collision,
   the state tables and the fire grid.

   The checks earn their place by having caught something. Each one below
   corresponds to a bug that reached a screenshot before it was found:

     - a sprite whose art wrapped around the edge of its own canvas, so
       a forearm drawn off the bottom appeared in the sky
     - a monster state naming a frame letter the bakery never made, so
       the Stocker's pain frame did not exist
     - a wall texture chosen by which sector was DECLARED first, so an
       aisle had shelving down one side and blank plaster down the other
     - a move long enough to step clean through a wall without any test
       noticing it had been there

   A test suite for a game is mostly worthless — you cannot assert that
   something is fun. But every one of those was a data error with a
   correct answer, and every one of them is cheaper to catch here.
   ===================================================================== */

import { register } from 'node:module';
register('./loader.mjs', import.meta.url);

/* Enough of a canvas for Pix.toCanvas to succeed, which is the only DOM
   call anywhere in the bakeries. With this the test can build a real
   TextureBank, a real SpriteBank and a real Game, and exercise the
   game's OWN lighting code rather than a copy of it kept in step by
   hand — which is the kind of copy that drifts and then passes while the
   game is broken. */
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData() {},
    }),
  }),
};

let pass = 0, fail = 0;
const problems = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; return true; }
  fail++; problems.push(`${name}${detail ? ' — ' + detail : ''}`);
  return false;
}
const section = s => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);
const note = (k, v) => console.log(`    ${k.padEnd(34)} ${v}`);

/* ---------- palette ---------- */
section('palette');
const pal = await import('../js/palette.js');
check('256 entries', pal.PALETTE.length === 256, `got ${pal.PALETTE.length}`);
check('every entry is 3 bytes', pal.PALETTE.every(c => c.length === 3 && c.every(v => v >= 0 && v <= 255)));
check('fire ramp runs dark to light',
  pal.ramp('fire', 0)[0] < 20 && pal.ramp('fire', 1)[0] > 240);
check('ramps are monotonic in luma', ['grey', 'red', 'blue', 'fire'].every(k => {
  let last = -1;
  for (let i = 0; i <= 10; i++) {
    const c = pal.ramp(k, i / 10);
    const l = c[0] * 0.3 + c[1] * 0.6 + c[2] * 0.1;
    if (l < last - 2) return false;
    last = l;
  }
  return true;
}));
{
  const t0 = Date.now();
  const atlas = pal.buildLutAtlas();
  note('lut atlas', `${atlas.width}x${atlas.height} in ${Date.now() - t0}ms`);
  check('lut is the right size', atlas.data.length === atlas.width * atlas.height * 4);
  const N = pal.LUT_SIZE, W = atlas.width;
  const look = (r, g, b) => {
    const R = Math.round(r / 255 * (N - 1)), G = Math.round(g / 255 * (N - 1)), B = Math.round(b / 255 * (N - 1));
    const o = ((G * W) + (B * N + R)) * 4;
    return [atlas.data[o], atlas.data[o + 1], atlas.data[o + 2]];
  };
  check('lut snaps to real palette entries',
    [[255, 255, 255], [0, 0, 0], [255, 140, 20], [90, 90, 100]].every(c => {
      const s = look(...c);
      return pal.PALETTE.some(p => p[0] === s[0] && p[1] === s[1] && p[2] === s[2]);
    }));
}

/* ---------- the pixel toolkit ---------- */
section('pixel toolkit');
const pix = await import('../js/pixel.js');
{
  const n = pix.valueNoise(64, 64, 8, 42);
  let edge = 0, interior = 0;
  for (let y = 0; y < 64; y++) {
    edge = Math.max(edge, Math.abs(n[y * 64 + 63] - n[y * 64]));
    for (let x = 1; x < 64; x++) interior = Math.max(interior, Math.abs(n[y * 64 + x] - n[y * 64 + x - 1]));
  }
  check('value noise tiles', edge <= interior * 1.1, `edge jump ${edge.toFixed(3)} vs ${interior.toFixed(3)}`);

  /* the wrap/clip distinction, which is the bug that put a forearm in
     the sky */
  const wrapping = new pix.Pix(16, 16, 1, true);
  wrapping.ink(20, 20, 'red', 1);
  check('a wrapping surface wraps', wrapping.alphaAt(4, 4) > 0);
  const clipping = new pix.Pix(16, 16, 1, false);
  clipping.ink(20, 20, 'red', 1);
  clipping.ink(-3, 8, 'red', 1);
  let any = 0;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (clipping.alphaAt(x, y) > 0) any++;
  check('a clipping surface discards', any === 0, `${any} stray pixels`);
}

/* ---------- textures ---------- */
section('textures');
const tex = await import('../js/textures.js');
{
  const names = Object.keys(tex.TEXTURE_GENERATORS);
  note('generators', names.length);
  let opaque = 0, sized = 0;
  const t0 = Date.now();
  for (const n of names) {
    const p = tex.TEXTURE_GENERATORS[n]();
    if (!check(`${n} produces pixels`, p && p.w > 0 && p.h > 0)) continue;
    check(`${n} is 64px or under`, p.w <= 64 && p.h <= 64, `${p.w}x${p.h}`);
    let a = 0;
    for (let i = 3; i < p.data.length; i += 4) if (p.data[i] > 8) a++;
    if (a === p.w * p.h) opaque++;
    sized++;
  }
  note('baked', `${sized} in ${Date.now() - t0}ms, ${opaque} fully opaque`);
}

/* ---------- sprites and states ---------- */
section('sprites and states');
const spr = await import('../js/sprites.js');
const st = await import('../js/states.js');
{
  const bank = spr.bakeSprites();
  note('sprite frames', bank.frames.size);

  check('every state points at a state that exists',
    Object.values(st.STATES).every(s => !s.next || st.STATES[s.next]),
    Object.values(st.STATES).filter(s => s.next && !st.STATES[s.next]).map(s => s.name).join(', '));

  check('every actor type names states that exist',
    Object.entries(st.ACTORS).every(([, a]) =>
      ['spawn', 'see', 'pain', 'melee', 'missile', 'death', 'xdeath'].every(k => !a[k] || st.STATES[a[k]])));

  /* THE ONE. A state naming a frame the bakery never drew renders as the
     missing-sprite placeholder, in the middle of a fight, once. */
  const missing = [];
  for (const [n, s] of Object.entries(st.STATES)) {
    const key = s.sprite + s.frame;
    if (bank.frames.has(key)) continue;
    if (s.sprite.startsWith('CAR') && bank.frames.has('CAR0' + s.frame)) continue;
    missing.push(`${n} wants ${key}`);
  }
  check('every state has the sprite frame it names', missing.length === 0, missing.join(', '));

  check('every frame has all eight rotations',
    [...bank.frames.values()].every(f => f.views.length === 8 && f.views.every(v => v && v.w > 0)));

  check('sprites are 64px or under',
    [...bank.frames.values()].every(f => f.views[0].w <= 64 && f.views[0].h <= 64));

  /* a walking figure must actually differ between frames, or it is four
     drawings of standing still */
  const diff = (a, b) => { let d = 0; for (let i = 0; i < a.data.length; i += 4) if (a.data[i + 3] !== b.data[i + 3]) d++; return d; };
  for (const name of ['ASSO', 'STKR']) {
    for (const rot of [0, 2]) {
      const A = bank.get(name, 'A').views[rot], B = bank.get(name, 'B').views[rot];
      check(`${name} walk moves at rotation ${rot}`, diff(A, B) > 40, `${diff(A, B)} pixels differ`);
    }
  }
  const w = spr.bakeWeapons();
  note('weapon frames', w.size);
  check('weapon frames all present',
    ['CUTGA', 'CUTGB', 'CUTGC', 'FLMGA', 'FLMGB', 'FLMGC', 'MOLGA', 'MOLGB', 'MOLGC'].every(k => w.has(k)));
}

/* ---------- the map ---------- */
section('the map');
const MAP = await import('../js/maps/sellwrong.js');
const { buildSellWrong } = MAP;
const level = buildSellWrong();
{
  note('sectors / lines / vertices', `${level.sectors.length} / ${level.lines.length} / ${level.verts.length}`);
  note('things', level.things.length);

  /* Lamps are laid on a grid over the whole map and the ones that miss
     the building are dropped when the level is populated, so they are
     the one thing allowed to start outside a sector. */
  const placed = level.things.filter(t => t.type !== 'LAMP');
  check('every thing stands in a sector',
    placed.every(t => level.sectorAt(t.x, t.y)),
    placed.filter(t => !level.sectorAt(t.x, t.y)).map(t => `${t.type}@${t.x},${t.y}`).join(' '));

  check('there is a start', level.things.some(t => t.type === 'START'));

  check('no sector is inside out', level.sectors.every(s => {
    let a = 0;
    for (let i = 0, j = s.poly.length - 1; i < s.poly.length; j = i++)
      a += s.poly[j][0] * s.poly[i][1] - s.poly[i][0] * s.poly[j][1];
    return a > 0;
  }));

  check('every sector has a floor below its ceiling',
    level.sectors.every(s => s.ceil >= s.floor));

  check('every two-sided line has both its skins',
    level.lines.every(l => l.front === null || l.back === null ||
      (l.upper !== undefined && l.lower !== undefined)));

  /* the bug where an aisle had shelving on one side only */
  const shelfLines = level.lines.filter(l => l.lower === 'SHELFSTK').length;
  check('gondola faces got the gondola texture', shelfLines >= 20, `${shelfLines} lines`);
  const glass = level.lines.filter(l => l.middle === 'STORGLAS').length;
  check('the shopfront is glazed', glass >= 2, `${glass} segments`);

  /* A gondola you can see over is not an aisle, it is a low wall. The
     player is 56 with an eye at 41; anything at 56 exactly is the least
     useful height there is. */
  check('gondolas are taller than the player', MAP.H_GONDOLA > 56, `${MAP.H_GONDOLA}`);
  check('front fixtures are below eye level', MAP.H_FIXTURE < 41, `${MAP.H_FIXTURE}`);
  const gond = level.sectors.find(s => s.name === 'gondola');
  check('gondola sectors are at that height', gond && gond.floor === MAP.H_GONDOLA);

  /* A fixture texture whose declared world height does not match the
     fixture shows a slice of a second copy of itself, cut off wherever
     the fixture happens to end. */
  const declared = { SHELFSTK: MAP.H_GONDOLA, SHELFEMP: MAP.H_GONDOLA, FREEZDOR: MAP.H_GONDOLA,
                     CHECKOUT: MAP.H_FIXTURE, CHILLER: MAP.H_FIXTURE,
                     PRODUCE: MAP.H_FIXTURE, DELICASE: MAP.H_FIXTURE };
  const mismatched = Object.entries(declared)
    .filter(([n, h]) => (tex.TEXTURE_SIZES[n] || {}).h !== h)
    .map(([n, h]) => `${n} declared ${(tex.TEXTURE_SIZES[n] || {}).h} wants ${h}`);
  check('fixture textures are sized to their fixtures', mismatched.length === 0, mismatched.join(', '));

  /* the lights */
  const lamps = level.things.filter(t => t.type === 'LAMP');
  check('the ceiling has fittings in it', lamps.length > 30, `${lamps.length} placed`);
  const indoors = lamps.filter(t => { const s = level.sectorAt(t.x, t.y); return s && !s.outdoor && s.ceil >= 200; });
  note('lamps placed / kept', `${lamps.length} / ${indoors.length}`);
  check('most of the shop gets a fitting', indoors.length > 30, `${indoors.length} kept`);
  check('the ceiling texture spans four tiles', (tex.TEXTURE_SIZES.CEILFIT || {}).w === 256);

  /* fuel has to be laid out as a shop or the fire has no shape */
  const fuelOf = n => level.sectors.filter(s => s.name === n).reduce((a, s) => a + s.fuel, 0) /
                      Math.max(1, level.sectors.filter(s => s.name === n).length);
  note('fuel: gondola / aisle / car park', `${fuelOf('gondola')} / ${fuelOf('aisle')} / ${fuelOf('car park')}`);
  check('gondolas hold far more fuel than the aisles', fuelOf('gondola') > fuelOf('aisle') * 4);
  check('the car park will not burn', fuelOf('car park') === 0);
}

/* ---------- lighting ---------- */
section('lighting');
{
  /* A REAL Game, with the real lamps and the real relight(). */
  const { Game } = await import('../js/game.js');
  const bank = tex.bakeTextures();
  const sprBank = spr.bakeSprites();
  const fakeHud = { message() {}, ticMessages() {} };
  const g = new Game({
    level, scene: new (await import('three')).Scene(), camera: {},
    textures: bank, sprites: sprBank, hud: fakeHud, audio: null,
    input: { sample() {} },
  });
  note('lamps kept', g.lamps.length);
  check('the ceiling has working fittings', g.lamps.length > 30, `${g.lamps.length}`);

  const shop = level.sectors.filter(s => !s.outdoor && s.ceil >= 200);
  const avg = shop.reduce((a, s) => a + s.light, 0) / shop.length;
  const lo = Math.min(...shop.map(s => s.light));
  note('shop light: average / darkest', `${avg.toFixed(2)} / ${lo.toFixed(2)}`);
  check('the shop is lit by its fittings', avg > 0.55 && avg < 0.98, `average ${avg.toFixed(2)}`);
  check('nothing indoors is left pitch dark', lo > 0.30, `darkest ${lo.toFixed(2)}`);
  check('the light is not all clamped to full',
    shop.filter(s => s.light >= 0.999).length < shop.length * 0.5,
    `${shop.filter(s => s.light >= 0.999).length} of ${shop.length} at full`);

  /* Shoot out everything over one aisle and it must actually go dark. */
  const aisle = shop.find(s => s.name === 'aisle');
  const cx = (aisle.bbox[0] + aisle.bbox[2]) / 2, cy = (aisle.bbox[1] + aisle.bbox[3]) / 2;
  const before = aisle.light;
  let killed = 0;
  for (const l of g.lamps) {
    if (Math.hypot(l.x - cx, l.y - cy) > 380) continue;
    l.damage(50, null);
    killed++;
  }
  g.relight();
  note('one aisle, fittings shot out', `${killed} lamps, ${before.toFixed(2)} -> ${aisle.light.toFixed(2)}`);
  check('shooting the lights out makes it darker', aisle.light < before - 0.15,
        `${before.toFixed(2)} -> ${aisle.light.toFixed(2)}`);
  check('the ambient survives, so it is dark and not blind',
        aisle.light >= aisle.ambient - 1e-6 && aisle.light > 0.1,
        `${aisle.light.toFixed(2)} vs ambient ${aisle.ambient}`);
  check('a burst lamp is dead and shows its broken frame',
        g.lamps.some(l => l.dead && l.state && l.state.sprite === 'LAMP'));
  check('bursting a lamp throws sparks', g.projectiles.some(p => p.kind === 'SPARK'));
}

/* ---------- collision ---------- */
section('collision');
{
  const { MapBuilder } = await import('../js/level.js');
  const mb = new MapBuilder('T');
  mb.sector([[0, 0], [256, 0], [256, 96], [256, 160], [256, 256], [0, 256]], { floor: 0, ceil: 128 });
  mb.sector([[256, 0], [512, 0], [512, 256], [256, 256], [256, 160], [256, 96]], { floor: 0, ceil: 128 });
  const lv = mb.build();
  const at = (r, x, y) => Math.abs(r[0] - x) < 1.5 && Math.abs(r[1] - y) < 1.5;

  check('walks through an opening', at(lv.slideMove(200, 128, 100, 0, 16, 0, 56), 300, 128));
  check('stops at a wall', at(lv.slideMove(400, 128, 200, 0, 16, 0, 56), 496, 128));
  check('slides along a wall', at(lv.slideMove(100, 240, 40, 40, 16, 0, 56), 140, 240));
  /* a move longer than the radius must not step over the wall entirely */
  check('does not tunnel through a wall', at(lv.slideMove(100, 128, 0, 900, 16, 0, 56), 100, 240));

  lv.sectors[1].floor = 24;
  check('climbs a 24 step', at(lv.slideMove(200, 128, 100, 0, 16, 0, 56), 300, 128));
  lv.sectors[1].floor = 40;
  check('a 40 step is a wall', !at(lv.slideMove(200, 128, 100, 0, 16, 0, 56), 300, 128));
  lv.sectors[1].floor = 0; lv.sectors[1].ceil = 40;
  check('a low ceiling blocks', !at(lv.slideMove(200, 128, 100, 0, 16, 0, 56), 300, 128));
  lv.sectors[1].ceil = 128;

  check('sight passes through an opening', !lv.sightBlocked(100, 128, 41, 400, 128, 41));
  lv.sectors[1].floor = 0; lv.sectors[1].ceil = 0;      // a shut door
  check('sight stops at a shut door', lv.sightBlocked(100, 128, 41, 400, 128, 41));
}

/* ---------- fire ---------- */
section('fire');
{
  /* The fire system wants a whole Game; give it the two things it reads. */
  const { FireSystem } = await import('../js/fire.js');
  const fake = { level, player: { x: 1240, y: -520, dead: false, damage() {} }, actors: [], sound: null };
  const t0 = Date.now();
  const fire = new FireSystem(fake);
  note('fuel grid', `${fire.cols}x${fire.rows}, ${fire.totalFuel} total fuel, ${Date.now() - t0}ms`);
  check('the store holds fuel', fire.totalFuel > 100000);
  check('nothing is alight to begin with', fire.liveCells === 0);
  check('burn starts at zero', fire.burnFraction === 0);

  /* light one gondola and let it run */
  /* ONE MATCH, AND ENOUGH TIME. The requirement is that the whole shop
     goes eventually, which is a statement about percolation: every cell
     must light more than one neighbour on average, or the fire stalls
     somewhere and that region can never burn because burnt fuel does not
     come back. So this is the check that matters most in the file. */
  fire.ignite(540, 1000, 200, 40);
  /* liveCells, not burningCells: the latter is what the status bar shows
     and counts only cells that are actually alight, which is zero until
     the simulation has stepped at least once. */
  check('ignition takes', fire.liveCells > 0);

  let stalled = -1;
  for (let i = 0; i < 40000; i++) {
    fire.tic();
    if (i > 20 && fire.liveCells === 0) { stalled = i; break; }
  }
  const burnt = fire.burnFraction;
  note('one match, left alone', `${(burnt * 100).toFixed(1)}% burned` +
    (stalled >= 0 ? `, went out after ${stalled} tics` : ', still going at 40000 tics'));
  check('one match takes essentially the whole shop', burnt > 0.97,
        `${(burnt * 100).toFixed(1)}% — the fire stalled somewhere`);

  /* and it must still not touch the car park */
  let lotBurnt = 0;
  for (let i = 0; i < fire.heat.length; i++) {
    const s = fire.sectorOf[i] >= 0 ? level.sectors[fire.sectorOf[i]] : null;
    if (s && s.outdoor && (fire.heat[i] > 0 || fire.fuel[i] < fire.fuel0[i])) lotBurnt++;
  }
  check('the car park does not burn', lotBurnt === 0, `${lotBurnt} cells burnt outdoors`);

  /* Every region of the shop must actually be REACHED, not just 97% of
     the fuel. A stockroom that never catches is a hole in the map. */
  const reached = {};
  for (let i = 0; i < fire.heat.length; i++) {
    const si = fire.sectorOf[i];
    if (si < 0) continue;
    const s = level.sectors[si];
    if (s.outdoor || s.fuel <= 0) continue;
    const r = reached[s.name] || (reached[s.name] = { cells: 0, burnt: 0 });
    r.cells++;
    if (fire.fuel[i] < fire.fuel0[i]) r.burnt++;
  }
  const untouched = Object.entries(reached).filter(([, r]) => r.burnt / r.cells < 0.9)
    .map(([n, r]) => `${n} ${((r.burnt / r.cells) * 100).toFixed(0)}%`);
  note('regions reached', `${Object.keys(reached).length - untouched.length}/${Object.keys(reached).length}`);
  check('the fire reaches every part of the shop', untouched.length === 0, untouched.join(', '));

  /* Regions that have burnt should have SAID so — a store that burns down
     and looks identical afterwards is an animation, not a simulation. */
  const charred = level.sectors.filter(s => s.charred).length;
  const burnable = level.sectors.filter(s => !s.outdoor && s.fuel > 0).length;
  note('sectors charred', `${charred}/${burnable}`);
  check('burnt regions get charred surfaces', charred >= burnable * 0.9, `${charred} of ${burnable}`);
  const bank = new Set(Object.keys(tex.TEXTURE_GENERATORS).map(n => n));
  check('every charrable texture has a burnt twin',
    tex.CHARRABLE.every(n => bank.has(n)),
    tex.CHARRABLE.filter(n => !bank.has(n)).join(', '));

  /* And the player's weapon has to be much faster than waiting. */
  const f2 = new FireSystem(fake);
  f2.ignite(540, 1000, 150, 26);
  let ticsAlone = 0;
  while (f2.burnFraction < 0.20 && ticsAlone < 40000) { f2.tic(); ticsAlone++; }
  note('20% by spreading alone', `${ticsAlone} tics (${(ticsAlone / 35).toFixed(0)}s)`);
  check('spreading alone is slow enough to leave room for a player', ticsAlone > 600,
        `${ticsAlone} tics is too fast to be worth a weapon`);
}

/* ---------- verdict ---------- */
console.log(`\n  ${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`);
if (fail) { console.log('\n' + problems.map(p => '    ! ' + p).join('\n')); process.exit(1); }
