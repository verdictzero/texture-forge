/* =====================================================================
   SELLWRONG — the store
   =====================================================================

   A floor plan, written as bands. X runs east, Y runs north, and the
   player arrives from the south with the whole front of the building in
   front of him.

     y -1000 ┌───────────────────────────────────────────┐
             │              CAR PARK                     │  he starts here
     y   120 │  bays, and whatever is still parked in     │
     y   360 ├───────────────────────────────────────────┤
             │  footway, under the sign                  │
     y   424 ├──────────────── SELLWRONG ────────────────┤
     y   440 │  FRONT END: doors, trolleys, checkouts    │
     y   760 ├───────────────────────────────────────────┤
             │  SHOP FLOOR: six gondola runs, N-S        │
     y  1360 ├─────────── mid cross-aisle ───────────────┤
             │  and six more                             │
     y  1940 ├───────────────────────────────────────────┤
             │  back cross-aisle, deli counter           │
     y  2020 ├══════════ STAFF ONLY ══════════════════════┤
             │  STOCKROOM  │  DOCK   │  OFFICE           │
     y  2400 └───────────────────────────────────────────┘

   WHY THIS SHAPE. The fire system reads its fuel out of the sectors, so
   the floor plan IS the difficulty curve. The gondola runs are dense
   fuel in long strips; the cross-aisles between them are nearly bare.
   Set light to Aisle 3 and it will eat Aisle 3 and stop, politely, at
   the cross-aisle — and then it is your problem how to get it across.
   That is the game, and it is a consequence of the shop being drawn like
   a shop rather than of any rule written down anywhere.

   The car park has no fuel at all, which makes it the safe room: the one
   place you can stand and watch what you have done.

   HEIGHTS. Gondolas are 56 — the same as the player, so you cannot see
   over them and an aisle is a corridor. The front-end fixtures are 40,
   below eye level, so the front of the store is open and you can see the
   doors from the checkouts. That contrast is doing all the work of a
   level-design pass: tense in the aisles, exposed at the front.
   ===================================================================== */

import { MapBuilder } from '../level.js';
import { RectMap } from './rectmap.js';

/* --- the grid the whole shop is drawn on -------------------------- */
const X = [200, 340, 480, 600, 760, 880, 1040, 1160, 1320, 1440, 1600, 1720, 1880, 2000, 2160, 2400];
const Y = [440, 540, 660, 760, 1360, 1460, 1940, 2020];

/* which x-bands are gondola, and which are the aisles between them */
const SHELF_COLS = [[2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13]];
const SHELF_ROWS = [[3, 4], [5, 6]];

const WALL = 16;                  // the void between two rooms IS the wall

/* Light levels. Doom's sectors run 0-255 and "normal indoor" is around
   160-192, which is 0.63-0.75 here; its "dark" is about 96, or 0.38. The
   first pass at this map was written with the shop floor at 0.4-0.6 and
   the whole store came out unreadable — dark is a place you have BEEN
   somewhere brighter, and if it is all dark it is just murky. So: the
   front of the store is brightly lit, the aisles are a notch down, and
   the back of house is genuinely dark, which is the only place that
   should be.

   The store is also open at night with half its lights off, which is why
   nothing here reaches 1.0 and why the car park is the dimmest place in
   the level that you can still see across. */

/* heights */
const FLOOR_OUT = 0, FLOOR_WALK = 12;
const CEIL_SKY = 320, CEIL_CANOPY = 288;
const CEIL_SHOP = 176, CEIL_BOH = 208;
const H_GONDOLA = 56;             // player eye is 41: you cannot see over
const H_FIXTURE = 40;             // you can

/* how well each kind of place burns, per fire cell */
const FUEL = {
  none: 0, walk: 26, front: 34, gondola: 300, produce: 150,
  chill: 70, deli: 120, stock: 340, dock: 190, office: 200, corridor: 8,
};

export function buildSellWrong() {
  const mb = new MapBuilder('SELLWRONG');
  const rm = new RectMap(mb);

  /* =================================================================
     OUTSIDE
     ================================================================= */
  const lotProps = {
    floor: FLOOR_OUT, ceil: CEIL_SKY, light: 0.46, outdoor: true,
    floorTex: 'ASPHALT', ceilTex: 'SKY', wallTex: 'STORBASE',
    upperTex: 'STORWALL', lowerTex: 'KERB', fuel: FUEL.none, name: 'car park',
  };

  rm.add(-400, -1000, 184, 424, { ...lotProps });
  rm.add(2416, -1000, 3000, 424, { ...lotProps });
  rm.add(184, -1000, 2416, 120, { ...lotProps, name: 'car park south' });

  /* One row of bays across the front. Paint on thin sectors, so where
     the bays go is a decision the map makes and not the texture grid. */
  {
    const PITCH = 186, LINE = 12;
    let x = 184;
    while (x < 2416) {
      const lineEnd = Math.min(2416, x + LINE);
      rm.add(x, 120, lineEnd, 320, { ...lotProps, floorTex: 'PARKLINE', name: 'bay line' });
      const bayEnd = Math.min(2416, x + PITCH);
      if (bayEnd > lineEnd) rm.add(lineEnd, 120, bayEnd, 320, { ...lotProps, name: 'bay' });
      x += PITCH;
    }
    rm.add(184, 320, 2416, 360, { ...lotProps, name: 'lot kerbside' });
  }

  /* The footway, one kerb-step up, under a canopy. The 32 units between
     the canopy and the sky is the sign band — the only place in the game
     the store says its own name. */
  {
    const walk = (name, x0, x1, wall, light) => rm.add(x0, 360, x1, 424, {
      floor: FLOOR_WALK, ceil: CEIL_CANOPY, light, outdoor: true,
      floorTex: 'CONCRETE', ceilTex: 'CEILDECK', wallTex: wall,
      upperTex: 'BRANDBAND', lowerTex: 'KERB', fuel: FUEL.none, name,
    });
    /* Three sections, because a wall is only ever ONE texture per
       segment and the glazing has to be a segment of its own. Splitting
       the footway splits the wall behind it, which is the only lever
       there is. The glazed middle is also brighter, from the light
       coming out through it. */
    walk('footway', 184, 700, 'STORWALL', 0.44);
    walk('footway glazed', 700, 1900, 'STORGLAS', 0.62);
    walk('footway', 1900, 2416, 'STORWALL', 0.44);
  }

  /* =================================================================
     THE WAY IN — a rectangle bridging the wall void, which is what a
     doorway is
     ================================================================= */
  rm.add(X[7], 424, X[8], 440, {
    floor: FLOOR_WALK, ceil: 152, light: 0.70,
    floorTex: 'LINO', ceilTex: 'CEILTILE', wallTex: 'STORGLAS',
    upperTex: 'DOORTRAK', lowerTex: 'STORBASE', fuel: FUEL.walk, name: 'entrance',
  });

  /* =================================================================
     THE SHOP FLOOR
     ================================================================= */
  const shop = (name, light, fuel, extra = {}) => ({
    floor: FLOOR_WALK, ceil: CEIL_SHOP, light,
    floorTex: 'LINO', ceilTex: 'CEILTILE', wallTex: 'WALLPANL',
    upperTex: 'WALLPANL', lowerTex: 'WALLPANL', fuel, name, ...extra,
  });

  /* --- front end: entrance strip, checkouts, and the cross-aisle --- */
  rm.add(X[0], Y[0], X[15], Y[1], shop('entrance mat', 0.86, FUEL.front, { floorTex: 'LINOWORN' }));

  /* checkouts: four blocks you can see over, and the lanes between */
  {
    const tills = [[3, 4], [5, 6], [7, 8], [9, 10]];
    let cur = 0;
    for (const [a, b] of tills) {
      if (X[a] > X[cur]) rm.add(X[cur], Y[1], X[a], Y[2], shop('checkout lane', 0.82, FUEL.front));
      rm.add(X[a], Y[1], X[b], Y[2], shop('checkout', 0.74, FUEL.front, {
        floor: H_FIXTURE, floorTex: 'CHECKOUT', lowerTex: 'CHECKOUT',
      }));
      cur = b;
    }
    rm.add(X[cur], Y[1], X[15], Y[2], shop('checkout lane', 0.82, FUEL.front));
  }
  rm.add(X[0], Y[2], X[15], Y[3], shop('front cross-aisle', 0.84, FUEL.walk));

  /* --- the aisles ------------------------------------------------- */
  for (const [ra, rb] of SHELF_ROWS) {
    let cur = 0;
    for (const [a, b] of SHELF_COLS) {
      if (X[a] > X[cur]) rm.add(X[cur], Y[ra], X[a], Y[rb], shop('aisle', 0.70, FUEL.walk));
      rm.add(X[a], Y[ra], X[b], Y[rb], shop('gondola', 0.66, FUEL.gondola, {
        floor: H_GONDOLA, floorTex: 'SHELFBAK',
        lowerTex: ra === 3 ? 'SHELFSTK' : 'SHELFEMP',
      }));
      cur = b;
    }
    rm.add(X[cur], Y[ra], X[15], Y[rb], shop('aisle', 0.72, FUEL.walk));
  }
  rm.add(X[0], Y[4], X[15], Y[5], shop('mid cross-aisle', 0.80, FUEL.walk));

  /* --- perimeter departments, replacing the outer aisle columns ---- */
  /* west: produce, at bench height so the west side stays open */
  for (const [ra, rb] of SHELF_ROWS) {
    rm.rects = rm.rects.filter(r => !(r.x0 === X[0] && r.y0 === Y[ra] && r.x1 === X[1] && r.y1 === Y[rb]));
  }
  /* (the aisle loop above already covered x0..x2 as one walkway strip;
     carve the west 140 out of it as bench, and leave x1..x2 to walk on) */
  for (const [ra, rb] of SHELF_ROWS) {
    const walk = rm.rects.find(r => r.x0 === X[0] && r.y0 === Y[ra] && r.x1 === X[2]);
    if (walk) walk.x0 = X[1];
    rm.add(X[0], Y[ra], X[1], Y[rb], shop('produce', 0.76, FUEL.produce, {
      floor: H_FIXTURE, floorTex: 'PRODUCE', lowerTex: 'PRODUCE',
    }));
  }
  /* east: chillers in the first run, freezer doors in the second */
  for (let i = 0; i < SHELF_ROWS.length; i++) {
    const [ra, rb] = SHELF_ROWS[i];
    const walk = rm.rects.find(r => r.x0 === X[13] && r.y0 === Y[ra] && r.x1 === X[15]);
    if (walk) walk.x1 = X[14];
    rm.add(X[14], Y[ra], X[15], Y[rb], shop(i ? 'freezer' : 'chiller', i ? 0.82 : 0.76, FUEL.chill, {
      floor: i ? H_GONDOLA : H_FIXTURE,
      floorTex: 'SHELFBAK', lowerTex: i ? 'FREEZDOR' : 'CHILLER',
    }));
  }

  /* --- back cross-aisle, with the deli counter in it ---------------- */
  rm.add(X[0], Y[6], X[5], Y[7], shop('back cross-aisle', 0.62, FUEL.walk));
  rm.add(X[5], Y[6], X[8], Y[7], shop('deli', 0.72, FUEL.deli, {
    floor: H_FIXTURE, floorTex: 'SHELFBAK', lowerTex: 'DELICASE',
  }));
  rm.add(X[8], Y[6], X[15], Y[7], shop('back cross-aisle', 0.58, FUEL.walk));

  /* =================================================================
     BACK OF HOUSE

     Different ramps entirely: rust, brown and bare concrete, no paint
     and no branding. Crossing the swing door should feel like leaving
     the part of the building that was ever meant for you.
     ================================================================= */
  const BOH_Y0 = Y[7] + WALL, BOH_Y1 = 2400;
  const boh = (name, light, fuel, extra = {}) => ({
    floor: FLOOR_WALK, ceil: CEIL_BOH, light,
    floorTex: 'STOCKFLR', ceilTex: 'CEILDECK', wallTex: 'STOCKWAL',
    upperTex: 'STOCKWAL', lowerTex: 'STOCKWAL', fuel, name, ...extra,
  });

  rm.add(200, BOH_Y0, 1200, BOH_Y1, boh('stockroom', 0.40, FUEL.stock));
  rm.add(1216, BOH_Y0, 1800, BOH_Y1, boh('loading dock', 0.46, FUEL.dock, { wallTex: 'DOCKDOOR' }));
  rm.add(1816, BOH_Y0, 2400, BOH_Y1, boh('office', 0.52, FUEL.office, {
    floorTex: 'LINOWORN', wallTex: 'TILEWALL', upperTex: 'TILEWALL', lowerTex: 'TILEWALL',
  }));

  /* the swing door out of the shop, and the openings behind it */
  const doorSector = rm.add(X[3], Y[7], X[4], BOH_Y0, {
    floor: FLOOR_WALK, ceil: FLOOR_WALK, light: 0.46,      // shut: ceiling on the floor
    floorTex: 'STOCKFLR', ceilTex: 'CEILDECK', wallTex: 'DOORSTAF',
    upperTex: 'DOORSTAF', lowerTex: 'DOORSTAF',
    fuel: FUEL.corridor, dynamic: true, name: 'staff door',
    special: { kind: 'door', openTo: 152, speed: 4, wait: 140 },
  });
  rm.add(1200, 2120, 1216, 2280, boh('stock to dock', 0.42, FUEL.corridor));
  rm.add(1800, 2120, 1816, 2240, boh('dock to office', 0.44, FUEL.corridor));

  /* a second way back in, from the dock to the shop floor: the roller
     shutter the night crew leave open */
  rm.add(X[10], Y[7], X[11], BOH_Y0, boh('shutter opening', 0.44, FUEL.corridor, {
    ceil: 136, wallTex: 'DOCKDOOR', upperTex: 'DOCKDOOR', lowerTex: 'DOCKDOOR',
  }));

  rm.build();

  /* -----------------------------------------------------------------
     Dressing the openings

     Two things the rectangles cannot say: the glass across the front,
     and the fact that the entrance has no door in it.
     ----------------------------------------------------------------- */
  const S = mb.sectors;
  const byName = n => S.filter(s => s.name === n);

  /* The entrance itself is a hole, so its upper texture is the header
     above the doors and its lower is nothing. */
  const entrance = byName('entrance')[0];
  for (const l of mb.linesBetween(entrance.index, byName('entrance mat')[0].index)) {
    l.upper = 'DOORTRAK'; l.pegUpper = 'bottom'; l.texLocked = true;
  }

  /* =================================================================
     THINGS
     ================================================================= */

  /* the player, at the far end of the car park looking at the building */
  mb.thing('START', 1240, -520, Math.PI / 2);

  /* --- cars, in the bays ------------------------------------------- */
  const parked = [
    [330, 210, 0], [700, 220, 1], [1060, 205, 2], [1800, 215, 3],
    [2160, 210, 4], [520, 218, 1], [1980, 200, 0],
  ];
  parked.forEach(([x, y, v], i) => mb.thing('CAR', x, y, Math.PI / 2 + (i % 3 - 1) * 0.06, { variant: v }));
  /* and a couple abandoned across the lane, because everyone left in a hurry */
  mb.thing('CAR', 900, -160, 0.3, { variant: 2 });
  mb.thing('CAR', 1650, -300, -0.2, { variant: 4 });

  /* --- the furniture of a shop front ------------------------------- */
  for (const x of [X[7] - 40, X[8] + 40]) mb.thing('BOLLARD', x, 392, 0);
  for (let i = 0; i < 5; i++) mb.thing('TROLLEY', 980 + i * 26, 500 + (i % 2) * 18, 0.4 * i);
  mb.thing('TROLLEY', 1500, 700, 1.2);
  mb.thing('TROLLEY', 640, 1400, 2.4);
  mb.thing('TROLLEY', 2060, 1700, 0.1);

  /* --- what you need, and where it is ------------------------------ */
  mb.thing('FUELCAN', 250, 2300, 0);        // stockroom
  mb.thing('FUELCAN', 300, 2200, 0);
  mb.thing('FUELCAN', 1500, 2320, 0);       // the dock
  mb.thing('FUELCAN', 2280, 2100, 0);       // the office
  mb.thing('FUELCAN', 2080, 1000, 0);       // one out on the shop floor

  /* --- stock, which is fuel that gets in the way ------------------- */
  const crates = [
    [420, 2120], [470, 2200], [560, 2300], [900, 2280], [1050, 2140],
    [1320, 2300], [1420, 2160], [1700, 2320], [2000, 2260],
    [X[3] + 60, 1400], [X[9] + 70, 1400], [2080, 780],
  ];
  for (const [x, y] of crates) mb.thing('CRATE', x, y, 0);

  /* --- the staff ---------------------------------------------------
     Spread so the front of the store is nearly empty and the back is
     not. Walking in should feel survivable and being at the far end of
     Aisle 5 should not. */
  const associates = [
    [X[3] + 80, 900], [X[5] + 80, 1180], [X[7] + 80, 980],
    [X[9] + 80, 1600], [X[11] + 80, 1250], [X[13] + 60, 1500],
    [X[3] + 80, 1700], [X[7] + 60, 1800], [1000, 1980], [1800, 1990],
    [430, 2100], [700, 2250], [1400, 2200],
  ];
  for (const [x, y] of associates) mb.thing('ASSOCIATE', x, y, Math.random() * Math.PI * 2);

  const stockers = [
    [X[5] + 80, 1620], [X[9] + 70, 900], [X[11] + 70, 1750],
    [600, 2320], [1500, 2100], [2100, 2200], [2080, 1300],
  ];
  for (const [x, y] of stockers) mb.thing('STOCKER', x, y, Math.random() * Math.PI * 2);

  const level = mb.build();
  level.burnTarget = 60;         // per cent of the store, to win
  level.title = 'SELLWRONG — SUPERSTORE';
  return level;
}
