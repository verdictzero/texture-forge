/* =====================================================================
   SELLWRONG — the parade
   =====================================================================

   SellWrong is not a building, it is the middle of a building. It is the
   anchor of a strip mall: one long shed cut into tenancies, with the big
   one in the centre paying most of the rent and six small ones either
   side hanging on. That framing is doing more work than it looks like it
   is, because it answers the two questions the level otherwise cannot:
   why the store is this shape, and what is on the other side of a wall
   you have just set fire to.

                 P Y L O N
     y -2600 ┌──────────────────────────────────────────────────┐
             │  verge, and the way in off the road               │
             │  ── seven rows of bays, three driving lanes ──    │  start
     y  -296 │  fire lane: nobody parks in front of the doors    │
     y  -136 ├────────────── canopy, piers, fascias ────────────┤
     y   -96 │  FOOTWAY, one kerb step up, running the whole     │
     y   -16 │  length of the parade                            │
             ├──┬──┬──┬═══════════════════════════════┬──┬──┬───┤
     y     0 │V │W │C ║  S E L L W R O N G            ║K │P │V  │
             │  │  │  ║  front end                    ║  │  │   │
     y   400 │  │  │  ║  twelve gondola runs, three   ║  │  │   │
             └──┴──┴──╢  deep, with cross-aisles      ╟──┴──┴───┘
     y  2620 ─────────╢  back cross-aisle, deli       ╟
     y  2776 ═════════╬══════ STAFF ONLY ═════════════╬
             │  STOCKROOM   │   DOCK    │   OFFICE    │
     y  3400 └──────────────────────────────────────────┘
           x -1176                                        x 5440

   THE SIZE. Three times the floor area of the first cut, and spent on
   MORE RUNS rather than on wider ones: twelve columns of gondola instead
   of six, three rows deep instead of two. Aisle widths are untouched at
   160, because an aisle is a corridor and the whole tension of the shop
   floor is that you cannot see down the next one. Scaling that number up
   with everything else would have produced a bigger shop that played
   smaller.

   THE FIRE READS THE FLOOR PLAN. Fuel lives in sectors, so the layout IS
   the difficulty curve: gondola runs are dense fuel in long strips,
   cross-aisles are nearly bare. Set light to one run and it will eat that
   run and stop, politely, at the cross-aisle. Getting it across is the
   game, and it is a consequence of the place being drawn like a shop
   rather than of any rule written down anywhere.

   THE FOOTWAY IS THE FUSE. It has a little fuel — less than an aisle,
   more than nothing — which means a store that is properly alight will
   eventually walk itself out of the front doors and along the parade into
   the chemist and the kebab shop, in its own time, without you. It also
   means the way out can be on fire when you need it. The car park has no
   fuel at all, and is the only place in the level you can stand and watch
   what you have done.
   ===================================================================== */

import { MapBuilder } from '../level.js';
import { RectMap } from './rectmap.js';

/* --- the one rule ------------------------------------------------- */
const WALL = 16;                  // the void between two rooms IS the wall

/* =====================================================================
   THE GRID

   Written as generators rather than as a list of numbers, because at
   twelve columns a hand-typed X array stops being a floor plan and
   starts being a place typos live.
   ===================================================================== */

/* the anchor's interior */
export const ANCHOR_X0 = 200, ANCHOR_X1 = 4080;
export const ANCHOR_Y0 = 0,   ANCHOR_Y1 = 3400;

/* the gondola field: twelve columns of 120 with 160 between them */
const NCOL = 12, GOND_W = 120, AISLE_W = 160, GX0 = 480;
const colX = k => GX0 + k * (GOND_W + AISLE_W);
const GX1 = colX(NCOL - 1) + GOND_W;                 // 3680, the east edge
/* The middle of the aisle between column k and column k+1. Everything
   dropped on the shop floor is placed with this rather than with a typed
   coordinate: an aisle is 160 wide with 120 of shelving either side of
   it, so a number arrived at by eye lands inside a gondola about half the
   time — and a fuel can inside a gondola is a can you cannot pick up. */
const aisleX = k => colX(k) + GOND_W + AISLE_W / 2;

/* the perimeter strips the runs stop short of */
const WEST_WALK = 340;               // ANCHOR_X0..340 is fixture, 340..GX0 is aisle
const EAST_DEPT = 3840;              // GX1..3840 is aisle, 3840..ANCHOR_X1 is chill

/* the runs, north from the front */
const ROWS = [
  { y0: 400,  y1: 1080 },
  { y0: 1220, y1: 1900 },
  { y0: 2040, y1: 2620 },
];
const Y_MAT = 0, Y_TILL = 120, Y_TILLEND = 260, Y_FRONTX = 400;
const Y_BACKX = 2620, Y_BACKXEND = 2760;
const BOH_Y0 = Y_BACKXEND + WALL, BOH_Y1 = ANCHOR_Y1;

/* =====================================================================
   OUTSIDE — heights

   The whole exterior is three horizontal bands and they are all made of
   ceiling heights, because a ceiling height is the only way a Doom-shaped
   engine can draw a band across a facade:

     the SHOPFRONT is what you see under the canopy, floor to soffit
     the FASCIA is the step between the soffit and the canopy edge, which
       is where every tenant's name goes and is exactly one repeat tall
     the PARAPET is everything from the canopy edge up to the sky
   ===================================================================== */
const FLOOR_OUT = 0, FLOOR_WALK = 12;
const CEIL_SKY = 480;             // the parapet line: the top of the building
const CEIL_EDGE = 328;            // the outer edge of the canopy
const CEIL_SOFF = 232;            // the soffit over the footway
/* The fascia band is CEIL_EDGE - CEIL_SOFF = 96, and every fascia texture
   in the game is declared 96 tall, so one repeat is exactly one sign.
   It was 32 to begin with, which is one repeat of a 32-tall texture and
   therefore looked correct in isolation and vanished at any distance —
   a fascia is about a fifth of a strip mall's height, not a fifteenth,
   and from the back of a car park a fifteenth is not there at all. */

/* The entrance canopy comes FORWARD. A supermarket entrance is not a
   hole in a flat elevation, it is a porch, and eighty units of it here
   does more to say "the doors are there" than any amount of signage —
   including from the far end of the lot, where it is the only part of
   the parade that breaks the line. */
const PORCH_D = 80;

/* =====================================================================
   THE SIGN BOX

   The logo is a picture, and a picture cannot be a texture here because
   every texture in the game is 64 pixels and the logo does not get an
   exemption. It gets geometry instead: four 64-pixel tiles hung as a
   two-by-two, which in a sector engine means TWO CEILING STEPS for the
   rows and ONE VERTICAL SPLIT for the columns.

   Going south from the tower face, each strip is taller than the one
   behind it, because an upper texture is only visible from the side with
   the higher ceiling:

     the porch     ceil 328    its upper is the BOTTOM row
     strip 1       ceil 440    its upper is the TOP row
     strip 2       ceil 552    its upper is the parapet cap above the sign
     the lot       ceil 640    sky, so the step in it draws nothing

   The strips are six units deep, so the top row stands six units proud
   of the bottom one — about a degree and a half of rake across a
   224-tall sign, and the price of having rows at all. It lands on the
   black band between the roundel and the lettering, where the logo has
   a seam of its own anyway. */
export const SIGN_ROW = 112;                // one tile tall
export const SIGN_H = SIGN_ROW * 2;         // 224
/* The artwork's own aspect, from tools/bake-logo.mjs. Get this wrong and
   the logo is stretched; the smoke test checks it against LOGO_ASPECT. */
export const SIGN_W = 280;                  // 1.25 : 1, and 140 to a tile
const SIGN_STEP = 6;                        // how deep each strip is

/* inside */
export const CEIL_SHOP = 352, CEIL_BOH = 416, CEIL_UNIT = 240;
export const H_GONDOLA = 80;      // taller than you: an aisle is a canyon
export const H_FIXTURE = 40;      // below eye level: the front stays open

/* the doors */
const DOOR_TOP = 210;             // how tall a leaf is
const ENTRY_W = 224;              // clear opening, so a leaf runs 112

/* =====================================================================
   THE CAR PARK

   Bays are drawn with a TEXTURE, not with a sector each. One repeat of
   BAYROW is one bay — 186 across, 180 deep — so a row of forty is one
   rectangle with the right floor on it, and moving a row is changing one
   number instead of forty. The cars are then placed on the same pitch by
   the same arithmetic, which is the only way they stay in the bays.
   ===================================================================== */
const BAY_W = 186, BAY_D = 180, LANE_D = 160;
const LOT_X0 = -1400, LOT_X1 = 5680;
const CANOPY_Y = -136;                       // the outer edge of the canopy
const FIRELANE_Y = CANOPY_Y - LANE_D;        // -296: nobody parks here

/* Seven rows in three back-to-back pairs and a single, with a driving
   lane between each pair. Written as a script so the lot reads top to
   bottom the way you drive into it. */
const LOT_PLAN = [
  { kind: 'bay',  n: 1 },        // -296
  { kind: 'lane' },
  { kind: 'bay',  n: 2 },        // back to back
  { kind: 'lane' },
  { kind: 'bay',  n: 2 },
  { kind: 'lane' },
  { kind: 'bay',  n: 2 },
];

/* =====================================================================
   THE TENANCIES

   Six in-line units, three each side, and only two of them are open.
   The rest are a shopfront and nothing behind it, which costs one wall
   and buys the whole read of the place: a parade with two thirds of it
   dark is a parade that has been dying for years, and the anchor going
   up is the last thing that was ever going to happen to it.

   `in` is true for the ones you can walk into.
   ===================================================================== */
const UNIT_W = 432;
const UNIT_Y1 = 620;                          // in-line units are shallow

/* west wing, running away from the anchor; east wing mirrors it */
const WEST_UNITS = [
  { name: 'chemist',    front: 'UNITGLAS', fascia: 'FASCHEM', in: true },
  { name: 'laundrette', front: 'UNITSHUT', fascia: 'FASWASH', in: false },
  { name: 'unit to let west', front: 'UNITVOID', fascia: 'FASVOID', in: false },
];
const EAST_UNITS = [
  { name: 'kebab shop', front: 'UNITGLAS', fascia: 'FASFOOD', in: true },
  { name: 'phone shop', front: 'UNITGLAS', fascia: 'FASPHON', in: false },
  { name: 'unit to let east', front: 'UNITSHUT', fascia: 'FASVOID', in: false },
];

/* =====================================================================
   FUEL

   Everything indoors has SOME, because a cell with none can never catch
   and would leave a permanent hole in the burn. The car park is the only
   zero on the list and it is a zero on purpose.
   ===================================================================== */
/* The footway is the odd one, and it is worth saying why it holds more
   than an aisle does. Percolation in a WIDE region is two-dimensional and
   forgiving: a burning cell in a 160-wide aisle has neighbours in every
   direction and a front that stalls in one place carries on in another.
   The footway is eighty deep and six and a half thousand long — two and a
   half cells wide — so it is very nearly one-dimensional, and a
   one-dimensional front only has to fail ONCE to fail for good.

   At the same fuel as an aisle it made it to the neighbouring units about
   half the time, which is the worst possible answer: "the whole parade
   burns eventually" stops being a property and becomes a coin flip you
   cannot see. So there is more to burn out here than the geometry alone
   would suggest — litter, the mats, the bins, the trolleys — and the fuse
   lights every time. */
const FUEL = {
  none: 0, footway: 120, walk: 55, front: 62, corridor: 62,
  gondola: 300, produce: 150, bakery: 210, chill: 90, deli: 120,
  stock: 340, dock: 190, office: 200,
  unit: 240, kitchen: 330,
};

export function buildSellWrong() {
  const mb = new MapBuilder('SELLWRONG');
  const rm = new RectMap(mb);

  /* The ends of the parade, once the wings are laid out.

     One unit takes UNIT_W of frontage plus the WALL beside it, and that
     is the whole arithmetic — the wall belongs to the unit, not to the
     joint. Writing it as `ANCHOR_X0 - WALL - n * (UNIT_W + WALL)` counts
     the wall next to the anchor twice, which leaves a sixteen-unit void
     between the west wing and the anchor: no sector, so a wall, so the
     footway is severed and the west half of the parade is unreachable on
     foot. It showed up as the fire refusing to spread west while
     spreading three thousand units east, which is the kind of symptom
     that takes an hour to trace back to an off-by-one in a constant. */
  const PARADE_X0 = ANCHOR_X0 - WEST_UNITS.length * (UNIT_W + WALL);
  const PARADE_X1 = ANCHOR_X1 + EAST_UNITS.length * (UNIT_W + WALL);

  /* =================================================================
     THE CAR PARK
     ================================================================= */
  const lot = (name, extra = {}) => ({
    /* A supermarket car park at night is FLOODLIT — that is the whole
       point of one — so this is the brightest sector in the level and the
       store is the dark thing you are walking into. Getting this wrong the
       first time made the parade a black mass at any distance and taught
       me that "it is night" is not a lighting design. */
    floor: FLOOR_OUT, ceil: CEIL_SKY, light: 0.74, outdoor: true,
    floorTex: 'ASPHALT', ceilTex: 'SKY', wallTex: 'STORBASE',
    upperTex: 'STORWALL', lowerTex: 'KERB', fuel: FUEL.none, name, ...extra,
  });

  /* The fire lane, hard up against the canopy, with the entrance porch
     pushed out into it. Three pieces, because the porch is a rectangle
     that has to not be fire lane. */
  const PORCH_X0 = 1756, PORCH_X1 = 2524;
  const PORCH_Y = CANOPY_Y - PORCH_D;                  // the tower face
  const SIGN_X0 = (PORCH_X0 + PORCH_X1 - SIGN_W) / 2;  // centred on the doors
  const SIGN_XM = SIGN_X0 + SIGN_W / 2, SIGN_X1 = SIGN_X0 + SIGN_W;
  const S1_Y = PORCH_Y - SIGN_STEP, S2_Y = S1_Y - SIGN_STEP;
  const TALL_X0 = SIGN_X0 - 60, TALL_X1 = SIGN_X1 + 60, TALL_Y = S2_Y - 48;
  const lane = (extra = {}) => lot('fire lane', { floorTex: 'HATCHKEEP', ...extra });

  rm.add(LOT_X0, FIRELANE_Y, PORCH_X0, CANOPY_Y, lane());
  rm.add(PORCH_X1, FIRELANE_Y, LOT_X1, CANOPY_Y, lane());
  /* the lane in front of the tower, carved round the sign box */
  rm.add(PORCH_X0, FIRELANE_Y, TALL_X0, PORCH_Y, lane());
  rm.add(TALL_X1, FIRELANE_Y, PORCH_X1, PORCH_Y, lane());
  rm.add(TALL_X0, FIRELANE_Y, TALL_X1, TALL_Y, lane());
  /* A taller piece of sky in front of the sign, so the top of the box has
     somewhere to be. Both this and its neighbours have a sky ceiling, so
     the step between them draws nothing at all. */
  rm.add(TALL_X0, TALL_Y, TALL_X1, S2_Y, lane({ ceil: 640 }));
  rm.add(TALL_X0, S2_Y, SIGN_X0, PORCH_Y, lane());
  rm.add(SIGN_X1, S2_Y, TALL_X1, PORCH_Y, lane());

  /* the two strips: the top row of the logo, then the cap above it */
  /* NOT A SKY CEILING, and that is the whole trick. A line between two
     sectors that both have sky overhead draws no upper at all — which is
     right everywhere else (it is how a step in the sky stays invisible)
     and is exactly wrong here, because the upper IS the sign. Both
     strips inherit from `lot`, so both were sky, so both rows of the
     logo were silently not built. */
  const signStrip = (name, ceil, upper) => ({
    ...lot(name), ceil, upperTex: upper,
    floorTex: 'CONCRETE', ceilTex: 'SOFFIT',
  });
  /* NEAREST THE TOWER IS THE TOP ROW, and it has to be: each strip's
     upper texture is the band between ITS ceiling and the ceiling of the
     thing behind it, so the order is porch, then the row above it, then
     the cap. Putting the cap next to the porch instead makes the gap
     between porch and cap 224 units tall, which is two repeats of a
     112-tall tile — and the sign renders the bottom half of the logo
     twice, once squashed, which is exactly what it did. */
  rm.add(SIGN_X0, S1_Y, SIGN_XM, PORCH_Y, signStrip('sign box', 328 + SIGN_ROW, 'LOGO0'));
  rm.add(SIGN_XM, S1_Y, SIGN_X1, PORCH_Y, signStrip('sign box', 328 + SIGN_ROW, 'LOGO1'));
  rm.add(SIGN_X0, S2_Y, SIGN_X1, S1_Y, signStrip('sign cap', 328 + SIGN_H, 'PARAPET'));

  /* and then the rows, walking south */
  let y = FIRELANE_Y;
  const bayRows = [];
  for (const step of LOT_PLAN) {
    if (step.kind === 'lane') {
      rm.add(LOT_X0, y - LANE_D, LOT_X1, y, lot('driving lane'));
      y -= LANE_D;
      continue;
    }
    for (let i = 0; i < step.n; i++) {
      const y0 = y - BAY_D;
      /* Rows in a back-to-back pair face each other, which the texture
         cannot know — so the row records which way its cars point and
         the parking is done from that. */
      bayRows.push({ y0, y1: y, facing: i === 0 ? -Math.PI / 2 : Math.PI / 2 });
      rm.add(LOT_X0, y0, LOT_X1, y, lot('bays', { floorTex: 'BAYROW' }));
      y -= BAY_D;
    }
  }
  const LOT_Y0 = y - 460;
  const VERGE_Y1 = y;

  /* The pylon sign at the mouth of the car park.

     It is a HOLE: a ring of four thin sectors with a 96-unit void in the
     middle, so all four faces of the void are one-sided walls taking the
     ring's texture — and one repeat of PYLONSGN covers the whole 480 of
     it, board at the top and post below, because the texture is declared
     as tall as the thing rather than tiled up it. A monolith built out
     of an absence, which is the only kind of freestanding object a
     sector engine can make without inventing a new primitive. */
  const PYL_X = 980, PYL_Y = LOT_Y0 + 200, PYL_W = 96, PYL_R = 40;
  const pylProps = lot('pylon base', { floorTex: 'CONCRETE', wallTex: 'PYLONSGN' });
  const bandX0 = PYL_X - PYL_R, bandX1 = PYL_X + PYL_W + PYL_R;
  const bandY0 = PYL_Y - PYL_R, bandY1 = PYL_Y + PYL_W + PYL_R;

  rm.add(LOT_X0, LOT_Y0, bandX0, VERGE_Y1, lot('verge'));
  rm.add(bandX1, LOT_Y0, LOT_X1, VERGE_Y1, lot('verge'));
  rm.add(bandX0, LOT_Y0, bandX1, bandY0, lot('verge'));
  rm.add(bandX0, bandY1, bandX1, VERGE_Y1, lot('verge'));
  rm.add(bandX0, bandY0, bandX1, PYL_Y, { ...pylProps });
  rm.add(bandX0, PYL_Y + PYL_W, bandX1, bandY1, { ...pylProps });
  rm.add(bandX0, PYL_Y, PYL_X, PYL_Y + PYL_W, { ...pylProps });
  rm.add(PYL_X + PYL_W, PYL_Y, bandX1, PYL_Y + PYL_W, { ...pylProps });

  /* =================================================================
     THE CANOPY AND THE FOOTWAY

     Two strips running the whole parade. The canopy edge sits at lot
     level so the kerb step happens UNDER it, which is what a strip mall
     does and what makes the fascia read as a band rather than as the top
     of a wall. Between the two: a fascia exactly one repeat tall.
     ================================================================= */
  const edgeProps = name => ({
    floor: FLOOR_OUT, ceil: CEIL_EDGE, light: 0.70, outdoor: true, sky: 0.7,
    floorTex: 'ASPHALT', ceilTex: 'SOFFIT', wallTex: 'PILASTER',
    upperTex: 'PARAPET',                 // what the lot sees above the canopy
    lowerTex: 'KERB', fuel: FUEL.none, name,
  });
  const walkProps = (name, front, fascia, light) => ({
    /* A lid over your head and open on one side: not a room, not the
       open air. The soffit downlights are why it is lit at all. */
    floor: FLOOR_WALK, ceil: CEIL_SOFF, light, outdoor: true, sky: 0.55,
    floorTex: 'CONCRETE', ceilTex: 'SOFFIT', wallTex: front,
    upperTex: fascia,                    // the sign band, seen from the lot
    lowerTex: 'KERB', fuel: FUEL.footway, name,
  });

  /* Every tenancy contributes one canopy-edge segment and one footway
     segment; between them sits a PIER, which is a 16-wide void in the
     canopy edge only — the footway runs through unbroken so you can walk
     the whole parade, and the pier stands at the kerb line where a pier
     goes. */
  const bays = [];             // [x0, x1, front, fascia, name, enterable]
  {
    let x = PARADE_X0;
    for (let i = WEST_UNITS.length - 1; i >= 0; i--) {
      const u = WEST_UNITS[i];
      bays.push({ x0: x, x1: x + UNIT_W, ...u });
      x += UNIT_W + WALL;
    }
    bays.push({ x0: ANCHOR_X0, x1: ANCHOR_X1, name: 'sellwrong',
                front: 'STORGLAS', fascia: 'BRANDBAND', in: true, anchor: true });
    x = ANCHOR_X1 + WALL;
    for (const u of EAST_UNITS) {
      bays.push({ x0: x, x1: x + UNIT_W, ...u });
      x += UNIT_W + WALL;
    }
  }

  /* one footway strip per tenancy, plus a 16-wide brick one at every
     joint, so the pier reads all the way through to the shopfront */
  for (let i = 0; i < bays.length; i++) {
    const b = bays[i];
    const light = b.front === 'UNITGLAS' ? 0.62 : b.anchor ? 0.68 : 0.46;
    rm.add(b.x0, -96, b.x1, -WALL, walkProps(`footway ${b.name}`, b.front, b.fascia, light));
    if (b.anchor) {
      /* Three pieces, and the middle one comes forward over the doors —
         except the middle one is itself four, because the two under the
         sign carry the bottom row of the logo as their upper texture and
         a sector has exactly one of those. */
      rm.add(b.x0, CANOPY_Y, PORCH_X0, -96, edgeProps(`canopy ${b.name}`));
      rm.add(PORCH_X1, CANOPY_Y, b.x1, -96, edgeProps(`canopy ${b.name}`));
      rm.add(PORCH_X0, PORCH_Y, SIGN_X0, -96, edgeProps('entrance porch'));
      rm.add(SIGN_X1, PORCH_Y, PORCH_X1, -96, edgeProps('entrance porch'));
      rm.add(SIGN_X0, PORCH_Y, SIGN_XM, -96,
        { ...edgeProps('entrance porch'), upperTex: 'LOGO2' });
      rm.add(SIGN_XM, PORCH_Y, SIGN_X1, -96,
        { ...edgeProps('entrance porch'), upperTex: 'LOGO3' });
    } else {
      rm.add(b.x0, CANOPY_Y, b.x1, -96, edgeProps(`canopy ${b.name}`));
    }
    if (i + 1 < bays.length) {
      const jx = b.x1;
      rm.add(jx, -96, jx + WALL, -WALL, walkProps('pier', 'PILASTER', 'PARAPET', 0.42));
      /* and NOT a canopy-edge rect over the joint: that void is the pier */
    }
  }
  /* the two ends of the parade get a pier as well */
  rm.add(PARADE_X0 - WALL, -96, PARADE_X0, -WALL, walkProps('pier', 'PILASTER', 'PARAPET', 0.42));
  rm.add(PARADE_X1, -96, PARADE_X1 + WALL, -WALL, walkProps('pier', 'PILASTER', 'PARAPET', 0.42));

  /* =================================================================
     THE ANCHOR — the shop floor
     ================================================================= */
  const shop = (name, light, fuel, extra = {}) => ({
    floor: FLOOR_WALK, ceil: CEIL_SHOP, light,
    floorTex: 'LINO', ceilTex: 'CEILFIT', wallTex: 'WALLPANL',
    upperTex: 'WALLPANL', lowerTex: 'WALLPANL', fuel, name, ...extra,
  });

  /* --- the way in: two sets of sliders, and the mullion between them - */
  const ENT_A0 = 1876, ENT_B0 = 2180;
  const entryProps = n => ({
    floor: FLOOR_WALK, ceil: CEIL_SOFF, light: 0.66,
    floorTex: 'LINO', ceilTex: 'CEILTILE', wallTex: 'STORGLAS',
    upperTex: 'STORGLAS', lowerTex: 'STORBASE', fuel: FUEL.walk, name: n,
  });
  const entryA = rm.add(ENT_A0, -WALL, ENT_A0 + ENTRY_W, 0, entryProps('entrance'));
  const entryB = rm.add(ENT_B0, -WALL, ENT_B0 + ENTRY_W, 0, entryProps('exit'));

  /* --- front end ---------------------------------------------------- */
  const mat = rm.add(ANCHOR_X0, Y_MAT, ANCHOR_X1, Y_TILL,
    shop('entrance mat', 0.34, FUEL.front, { floorTex: 'LINOWORN' }));

  /* eight tills across the front, and the lanes between them */
  {
    const TILL_W = 180, TILL_PITCH = 400, NTILL = 8;
    let cur = ANCHOR_X0;
    for (let k = 0; k < NTILL; k++) {
      const a = GX0 + k * TILL_PITCH, b = a + TILL_W;
      if (a > cur) rm.add(cur, Y_TILL, a, Y_TILLEND, shop('checkout lane', 0.30, FUEL.front));
      rm.add(a, Y_TILL, b, Y_TILLEND, shop('checkout', 0.28, FUEL.front, {
        floor: H_FIXTURE, floorTex: 'CHECKOUT', lowerTex: 'CHECKOUT',
      }));
      cur = b;
    }
    rm.add(cur, Y_TILL, ANCHOR_X1, Y_TILLEND, shop('checkout lane', 0.30, FUEL.front));
  }
  rm.add(ANCHOR_X0, Y_TILLEND, ANCHOR_X1, Y_FRONTX, shop('front cross-aisle', 0.30, FUEL.walk));

  /* --- the runs ------------------------------------------------------
     Three rows of twelve. The facing on a gondola alternates by run and
     by column so that no two neighbours are the same picture, which at
     twelve columns is the difference between a supermarket and a
     wallpaper sample. */
  const FACINGS = ['SHELFSTK', 'SHELFMIX', 'SHELFEMP'];
  ROWS.forEach((row, ri) => {
    const { y0, y1 } = row;
    /* the west walkway, between the perimeter department and column 0 */
    rm.add(WEST_WALK, y0, GX0, y1, shop('aisle', 0.24, FUEL.walk));
    for (let k = 0; k < NCOL; k++) {
      const a = colX(k), b = a + GOND_W;
      rm.add(a, y0, b, y1, shop('gondola', 0.24, FUEL.gondola, {
        floor: H_GONDOLA, floorTex: 'SHELFBAK',
        lowerTex: FACINGS[(ri + k) % FACINGS.length],
      }));
      if (k + 1 < NCOL) rm.add(b, y0, colX(k + 1), y1, shop('aisle', 0.24, FUEL.walk));
    }
    rm.add(GX1, y0, EAST_DEPT, y1, shop('aisle', 0.25, FUEL.walk));
  });

  rm.add(ANCHOR_X0, ROWS[0].y1, ANCHOR_X1, ROWS[1].y0, shop('mid cross-aisle', 0.28, FUEL.walk));
  rm.add(ANCHOR_X0, ROWS[1].y1, ANCHOR_X1, ROWS[2].y0, shop('rear cross-aisle', 0.26, FUEL.walk));

  /* --- perimeter departments ---------------------------------------
     The west strip is bench height so that side of the store stays open;
     the east strip is chill, and the middle run of it is freezer doors
     at full gondola height so the east wall is not one long low shelf. */
  const WEST = [
    { name: 'produce', fuel: FUEL.produce, tex: 'PRODUCE',  h: H_FIXTURE, light: 0.28 },
    { name: 'bakery',  fuel: FUEL.bakery,  tex: 'BAKECASE', h: H_FIXTURE, light: 0.34 },
    { name: 'flowers', fuel: FUEL.produce, tex: 'PRODUCE',  h: H_FIXTURE, light: 0.26 },
  ];
  const EAST = [
    { name: 'chiller', fuel: FUEL.chill, tex: 'CHILLER',  h: H_FIXTURE, light: 0.36 },
    { name: 'freezer', fuel: FUEL.chill, tex: 'FREEZDOR', h: H_GONDOLA, light: 0.40 },
    { name: 'dairy',   fuel: FUEL.chill, tex: 'CHILLER',  h: H_FIXTURE, light: 0.36 },
  ];
  ROWS.forEach((row, ri) => {
    const w = WEST[ri], e = EAST[ri];
    rm.add(ANCHOR_X0, row.y0, WEST_WALK, row.y1, shop(w.name, w.light, w.fuel, {
      floor: w.h, floorTex: 'SHELFBAK', lowerTex: w.tex,
    }));
    rm.add(EAST_DEPT, row.y0, ANCHOR_X1, row.y1, shop(e.name, e.light, e.fuel, {
      floor: e.h, floorTex: 'SHELFBAK', lowerTex: e.tex,
    }));
  });

  /* --- back cross-aisle, with the deli counter in it ----------------- */
  rm.add(ANCHOR_X0, Y_BACKX, 1200, Y_BACKXEND, shop('back cross-aisle', 0.22, FUEL.walk));
  rm.add(1200, Y_BACKX, 2200, Y_BACKXEND, shop('deli', 0.30, FUEL.deli, {
    floor: H_FIXTURE, floorTex: 'SHELFBAK', lowerTex: 'DELICASE',
  }));
  rm.add(2200, Y_BACKX, 2900, Y_BACKXEND, shop('back cross-aisle', 0.20, FUEL.walk));
  rm.add(2900, Y_BACKX, 3600, Y_BACKXEND, shop('butchery', 0.28, FUEL.deli, {
    floor: H_FIXTURE, floorTex: 'SHELFBAK', lowerTex: 'DELICASE',
  }));
  rm.add(3600, Y_BACKX, ANCHOR_X1, Y_BACKXEND, shop('back cross-aisle', 0.20, FUEL.walk));

  /* =================================================================
     BACK OF HOUSE

     Different ramps entirely: rust, brown and bare concrete, no paint
     and no branding. Crossing the swing door should feel like leaving
     the part of the building that was ever meant for you.
     ================================================================= */
  const boh = (name, light, fuel, extra = {}) => ({
    floor: FLOOR_WALK, ceil: CEIL_BOH, light,
    floorTex: 'STOCKFLR', ceilTex: 'CEILDECK', wallTex: 'STOCKWAL',
    upperTex: 'STOCKWAL', lowerTex: 'STOCKWAL', fuel, name, ...extra,
  });

  rm.add(ANCHOR_X0, BOH_Y0, 1800, BOH_Y1, boh('stockroom', 0.16, FUEL.stock));
  rm.add(1816, BOH_Y0, 2900, BOH_Y1, boh('loading dock', 0.18, FUEL.dock, { wallTex: 'DOCKDOOR' }));
  rm.add(2916, BOH_Y0, ANCHOR_X1, BOH_Y1, boh('office', 0.22, FUEL.office, {
    floorTex: 'LINOWORN', wallTex: 'TILEWALL', upperTex: 'TILEWALL', lowerTex: 'TILEWALL',
  }));
  rm.add(1800, BOH_Y0 + 120, 1816, BOH_Y1 - 120, boh('stock to dock', 0.18, FUEL.corridor));
  rm.add(2900, BOH_Y0 + 120, 2916, BOH_Y1 - 160, boh('dock to office', 0.18, FUEL.corridor));

  /* the swing door out of the shop floor */
  const staffDoor = rm.add(700, Y_BACKXEND, 820, BOH_Y0, {
    floor: FLOOR_WALK, ceil: FLOOR_WALK, light: 0.46,      // shut: ceiling on the floor
    floorTex: 'STOCKFLR', ceilTex: 'CEILDECK', wallTex: 'DOORSTAF',
    upperTex: 'DOORSTAF', lowerTex: 'DOORSTAF',
    fuel: FUEL.corridor, dynamic: true, name: 'staff door',
    special: { kind: 'door', openTo: 152, speed: 4, wait: 140 },
  });
  /* and the roller shutter the night crew left open */
  rm.add(2400, Y_BACKXEND, 2560, BOH_Y0, boh('shutter opening', 0.18, FUEL.corridor, {
    ceil: 136, wallTex: 'DOCKDOOR', upperTex: 'DOCKDOOR', lowerTex: 'DOCKDOOR',
  }));

  /* =================================================================
     THE NEIGHBOURS

     Two of the six are open. They are small, they are full of things
     that burn, and they are on the other side of a footway that has just
     enough fuel to carry a fire — which is the entire reason they exist.
     ================================================================= */
  for (const b of bays) {
    if (b.anchor || !b.in) continue;
    const kitchen = b.name === 'kebab shop';
    const base = (name, light, fuel, extra = {}) => ({
      floor: FLOOR_WALK, ceil: CEIL_UNIT, light,
      floorTex: kitchen ? 'TILEWALL' : 'LINO', ceilTex: 'CEILTILE',
      wallTex: kitchen ? 'TILEWALL' : 'WALLPANL',
      upperTex: kitchen ? 'TILEWALL' : 'WALLPANL',
      lowerTex: kitchen ? 'TILEWALL' : 'WALLPANL',
      fuel, name, ...extra,
    });
    const mid = (b.x0 + b.x1) / 2;
    /* the sales floor: a run of shelving down each side and a gangway
       between them, then the counter, then whatever is behind it */
    const shelf = { floor: H_GONDOLA, floorTex: 'SHELFBAK', lowerTex: 'SHELFMIX' };
    rm.add(b.x0, 0, b.x0 + 100, 380, base(`${b.name} shelving`, 0.40, FUEL.unit, shelf));
    rm.add(b.x0 + 100, 0, b.x1 - 100, 380, base(b.name, 0.44, kitchen ? FUEL.kitchen : FUEL.unit));
    rm.add(b.x1 - 100, 0, b.x1, 380, base(`${b.name} shelving`, 0.40, FUEL.unit, shelf));
    /* The counter, with a flap at one end. Without the flap the room
       behind it is a sector nobody can enter — the fire gets in, because
       fire does not step, but the staff cannot come out and you cannot go
       in, and a room like that is scenery pretending to be a room. */
    rm.add(b.x0, 380, b.x1 - 110, 440, base(`${b.name} counter`, 0.40, FUEL.unit, {
      floor: H_FIXTURE, floorTex: 'SHELFBAK', lowerTex: kitchen ? 'DELICASE' : 'CHECKOUT',
    }));
    rm.add(b.x1 - 110, 380, b.x1, 440, base(`${b.name} flap`, 0.42, FUEL.walk));
    rm.add(b.x0, 440, b.x1, UNIT_Y1, base(kitchen ? 'kitchen' : 'dispensary', 0.34,
      kitchen ? FUEL.kitchen : FUEL.office));
    /* the way in, bridging the shopfront wall */
    rm.add(mid - 60, -WALL, mid + 60, 0, base(`${b.name} door`, 0.50, FUEL.walk, {
      ceil: 192, wallTex: 'UNITGLAS', upperTex: 'UNITGLAS', lowerTex: 'STORBASE',
    }));
  }

  rm.build();

  /* -----------------------------------------------------------------
     Dressing the openings
     ----------------------------------------------------------------- */
  const S = mb.sectors;
  const byName = n => S.filter(s => s.name === n);

  /* Glazing carries on above both entrances, which is what a big-box
     front actually looks like and beats thirteen repeats of a door track
     stacked up the header. */
  for (const e of [entryA, entryB]) {
    for (const l of mb.linesBetween(e.sector, mat.sector)) {
      l.upper = 'STORGLAS'; l.pegUpper = 'bottom'; l.texLocked = true;
    }
  }

  /* =================================================================
     THE SLIDING DOORS

     Declared here because only the map knows which lines are the
     opening. The leaves live in the MIDDLE of the sixteen-unit wall
     void, so opening one slides it into the thickness of the wall where
     there is nothing to draw and nothing to fight with — which is what a
     slider in a deep reveal does in a real building.
     ================================================================= */
  const slide = [];
  for (const e of [entryA, entryB]) {
    const x0 = e.x0, x1 = e.x1;
    const lines = [
      ...mb.linesBetween(e.sector, mat.sector),
      ...mb.lines.filter(l => (l.front === e.sector || l.back === e.sector) &&
        Math.abs(l.y1 - (-WALL)) < 0.5 && Math.abs(l.y2 - (-WALL)) < 0.5),
    ];
    slide.push({
      x0, y0: -WALL / 2, x1, y1: -WALL / 2,
      zBot: FLOOR_WALK, zTop: DOOR_TOP,
      standoff: 0, travel: (x1 - x0) / 2,
      speed: 5, triggerR: 250, hold: 70,
      lines, sector: S[e.sector],
    });
  }

  /* =================================================================
     THINGS
     ================================================================= */

  /* the player, out at the mouth of the car park, looking at the sign */
  mb.thing('START', 1240, LOT_Y0 + 200, Math.PI / 2);

  /* --- the cars ------------------------------------------------------
     Placed on the bay pitch, from the same arithmetic that drew the
     bays, so every one of them is IN a bay. They are things with a
     position, an angle and a variant, and nothing else — which is the
     shape a loader for real models wants, so when the 3D cars arrive the
     only change is what gets drawn at each of these.

     A car park that is FULL is wrong for this: the place is half empty
     because half the town has already left, so bays are taken at about
     one in three, thinning towards the back. */
  {
    let seed = 20250907;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    bayRows.forEach((row, ri) => {
      const cy = (row.y0 + row.y1) / 2;
      const n = Math.floor((LOT_X1 - LOT_X0) / BAY_W);
      const take = 0.42 - ri * 0.045;                 // emptier towards the road
      for (let i = 0; i < n; i++) {
        if (rnd() > take) continue;
        const cx = LOT_X0 + (i + 0.5) * BAY_W;
        /* nobody parks in the two bays either side of the entrance */
        if (Math.abs(cx - (ENT_A0 + ENTRY_W)) < 200 && ri === 0) continue;
        mb.thing('CAR', cx, cy + (rnd() - 0.5) * 14, row.facing + (rnd() - 0.5) * 0.10,
          { variant: Math.floor(rnd() * 5) });
      }
    });
    /* and three abandoned across the lanes, because everyone left at once */
    mb.thing('CAR', 1500, FIRELANE_Y - 60, 0.35, { variant: 2 });
    mb.thing('CAR', 3100, FIRELANE_Y - 80, -0.25, { variant: 4 });
    mb.thing('CAR', 620, FIRELANE_Y - 700, 1.4, { variant: 1 });
  }

  /* --- the furniture of a shop front --------------------------------- */
  for (const x of [ENT_A0 - 70, ENT_B0 + ENTRY_W + 70]) mb.thing('BOLLARD', x, -116, 0);
  for (let i = 0; i < 7; i++) mb.thing('TROLLEY', ENT_B0 + 300 + i * 26, -70 + (i % 2) * 16, 0.4 * i);
  for (let i = 0; i < 5; i++) mb.thing('TROLLEY', ENT_A0 - 400 + i * 24, -60 - (i % 3) * 14, 0.3 * i);
  for (const [x, yy] of [[900, 300], [2600, 1500], [3500, 2300], [1700, 900], [400, 2400]])
    mb.thing('TROLLEY', x, yy, 1.2);

  /* --- what you need, and where it is --------------------------------
     The only ammunition in the game, so there is a lot of it and it is
     spread over the whole store: running dry with one weapon is not a
     challenge, it is a soft lock. Laid on a coarse grid through the shop
     floor and then thickened in the back, rather than listed by hand,
     because at this size a hand-written list is how a corner of the map
     ends up with nothing in it. */
  {
    const cans = [];
    /* the shop floor: every other aisle, at four depths, staggered */
    for (let k = 0; k < NCOL - 1; k += 2)
      ROWS.forEach((row, ri) => {
        const t = ((k / 2) + ri) % 2 ? 0.32 : 0.68;
        cans.push([aisleX(k), row.y0 + (row.y1 - row.y0) * t]);
      });
    /* The cross-aisles, where you will be when you run dry crossing one.
       The BACK cross-aisle has the deli and the butchery counters
       standing in it, so its cans go in the gaps between them rather than
       on the same column as the rest. */
    for (const x of [aisleX(1), aisleX(5), aisleX(9)])
      cans.push([x, 330], [x, 1150], [x, 1970]);
    for (const x of [700, 2550, 3850]) cans.push([x, 2690]);
    /* the back of house, where you will be by the time you need it */
    cans.push([300, 2900], [520, 3300], [1100, 3050], [1600, 3320],
              [2000, 2900], [2500, 3300], [2750, 3000],
              [3100, 2950], [3600, 3300], [3950, 3050]);
    /* and one in each of the neighbours, for when you go along the row */
    cans.push([-48, 200], [-48, 560], [4312, 200], [4312, 560]);
    for (const [x, yy] of cans) mb.thing('FUELCAN', x, yy, 0);
  }

  /* --- stock, which is fuel that gets in the way --------------------- */
  {
    const crates = [
      [300, 2860], [400, 3000], [560, 3200], [900, 3100], [1200, 2900],
      [1450, 3260], [1700, 2980], [2000, 3200], [2300, 2880], [2600, 3120],
      [2750, 3300], [3050, 2900], [3300, 3200], [3600, 2950], [3900, 3260],
      [aisleX(2), 1150], [aisleX(5), 1150], [aisleX(8), 1150],
      [aisleX(3), 1970], [aisleX(7), 1970], [aisleX(10), 1970],
      [3760, 700], [3760, 1500], [420, 1450],
    ];
    for (const [x, yy] of crates) mb.thing('CRATE', x, yy, 0);
  }

  /* --- the lights ----------------------------------------------------
     One fitting every 256 units on the same grid and at the same offset
     as the housings drawn into the ceiling texture, so each lamp hangs in
     a hole rather than beside one. Anything that lands outdoors, in a
     doorway or under a low ceiling is dropped when the level is
     populated — covering the building and filtering is much easier than
     describing the shape of the shop twice. */
  {
    const PITCH = 256, OFF = 126;
    for (let gx = Math.floor(PARADE_X0 / PITCH); gx * PITCH + OFF < PARADE_X1; gx++)
      for (let gy = 0; gy * PITCH + OFF < ANCHOR_Y1; gy++)
        mb.thing('LAMP', gx * PITCH + OFF, gy * PITCH + OFF, 0);
  }

  /* --- the staff -----------------------------------------------------
     Spread by department rather than by hand, so that tripling the floor
     area did not mean tripling a list of coordinates and getting one of
     them wrong. Thin at the front, thick at the back: walking in should
     feel survivable and being at the far end of Aisle 9 should not. */
  {
    let seed = 777;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const place = (type, x, yy) => mb.thing(type, x, yy, rnd() * Math.PI * 2);

    /* one or two per aisle, deeper into the store the further back */
    ROWS.forEach((row, ri) => {
      for (let k = 0; k < NCOL - 1; k++) {
        const x = colX(k) + GOND_W + AISLE_W / 2;
        const n = ri === 0 ? (k % 3 === 0 ? 1 : 0) : (k % 2 === 0 ? 2 : 1);
        for (let i = 0; i < n; i++)
          place(rnd() < 0.28 ? 'STOCKER' : 'ASSOCIATE',
                x + (rnd() - 0.5) * 60, row.y0 + 60 + rnd() * (row.y1 - row.y0 - 120));
      }
    });
    /* the perimeter, the front end and the counters */
    /* The perimeter departments are all FIXTURES at bench or gondola
       height, so a member of staff placed "in produce" is standing on top
       of the produce. They go in the walkway beside it, which is where
       they would be anyway. */
    for (const [x, yy] of [[410, 700], [410, 1600], [410, 2400],
                           [3760, 700], [3760, 1600], [3760, 2400],
                           [800, 2690], [2500, 2690], [3800, 2690],
                           [900, 320], [2900, 320], [3550, 180]])
      place('ASSOCIATE', x, yy);
    /* and the back of house, which is where the night crew are */
    for (const [x, yy] of [[400, 2900], [700, 3150], [1100, 3300], [1500, 2900],
                           [2100, 3100], [2500, 2950], [2800, 3300],
                           [3100, 3050], [3500, 2900], [3900, 3200],
                           [600, 3350], [1900, 3350]])
      place('STOCKER', x, yy);
    /* two in each of the neighbours */
    for (const b of bays) {
      if (b.anchor || !b.in) continue;
      const mid = (b.x0 + b.x1) / 2;
      place('ASSOCIATE', mid - 40, 240);
      place('STOCKER', mid + 40, 520);
    }
  }

  const level = mb.build();
  level.slideDoors = slide;
  level.burnTarget = 60;          // per cent of the parade, to win
  /* Where "outside" starts, for the escape. The footway is outdoors and
     is NOT far enough: getting clear means getting off the pavement and
     out into the lot, past the fire lane. */
  level.escapeY = FIRELANE_Y - 40;
  level.title = 'SELLWRONG — SUPERSTORE';
  return level;
}
