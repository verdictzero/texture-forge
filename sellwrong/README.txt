SELLWRONG
=========

A Doom-style shooter in which you invade a supermarket and burn it down.

Open index.html in a browser. No install, no build step, no network. Every
texture, every sprite, every sound and the whole level are generated in the
page at start-up, in about half a second. The only file it loads is a
vendored copy of three.js sitting next to it.

  index.html            the page
  css/style.css         the furniture around the frame
  vendor/three.module.js  three r160, local so the game runs off a memory stick
  js/                   the game
  tools/smoke-test.mjs  node tools/smoke-test.mjs — no install, no browser


WHAT YOU DO
-----------

You start in the car park at night. The store is in front of you, the doors
are open, and the night crew are still inside.

Burn 60% of it, then get back to the car park.

  WASD          move            MOUSE     look
  SHIFT         run             LMB/CTRL  attack
  SPACE / F     open, use       1 2 3     boxcutter, flamer, molotov
  [  ]          chunkiness      N         palette on / off
  ESC           pause

Gamepad works. Mouse look needs a click to grab the pointer.


THE ONE IDEA
------------

The fire is a simulation running under the level, not an effect painted on
top of it. There is a grid of FUEL over the whole map, and every cell takes
its value from the sector it lands in.

  a gondola of stock    300      goes up like a gondola of stock
  a produce bench       150
  the stockroom         340
  the aisle between     26       a firebreak
  the car park          0        will not burn at all, ever

Fire spreads between neighbouring cells, but only into a cell holding at
least 60. Below that a cell burns perfectly well when something sets light
to it directly — your flamethrower, a bottle, or a member of staff who is
already alight — but it will not catch from the cell next door.

That one threshold is the game. Light one run of shelving and it will eat
that run and stop, politely, at the walkway. Getting it across the walkway
is what you are doing all night:

  the FLAMER lays down about 40 units of accelerant. Enough to burn where
    you are pointing; never enough to spread. The fire goes exactly as far
    as you walk, and no further.

  the MOLOTOV lays down over a hundred, which is above the threshold. Its
    pool WILL reach into whatever is beside it. You get three.

  a BURNING ASSOCIATE keeps chasing you, sets light to what it walks over,
    and dies on its feet somewhere in the frozen goods. Set one alight at
    the end of an aisle and it will do more damage to the store than you
    will.

The car park has no fuel, which makes it the safe room: the one place you
can stand and watch what you have done.


HOW IT IS BUILT
---------------

It is Doom's architecture, on purpose, because Doom's architecture is right
and because every piece of documentation about how Doom works is written in
its terms.

UNITS ARE DOOM UNITS. The player is 56 tall with his eye at 41, he is 32
across, and he steps up anything 24 or under without noticing. A wall
texture is 64 across and 64 up. That last one is the reason for the choice:
at 64 units to a 64-pixel texture the mapping between world and art is one
texel to one unit, everywhere, with no scale factor to carry around.

THE LEVEL IS SECTORS AND LINEDEFS. A sector is a floor height, a ceiling
height, a light level and two flats. A line has a sector on one side or on
both; two sides makes it a hole, with a bit of wall above (the gap between
the ceilings) and a bit of wall below (the gap between the floors). Every
piece of architecture in the store is one of those two pieces:

  a doorway         upper only
  a checkout        lower only, 40 tall, you can see over it
  a gondola         lower only, 56 tall — the same as you, so you cannot
  a kerb            lower, 12 tall, walked over without noticing
  the staff door    a sector whose ceiling is on the floor and rises

WALLS ARE THE GAPS. Two rectangles that touch become an opening between two
rooms — that is what touching means. A wall is drawn by NOT putting a
rectangle there: leave sixteen units between two rooms and the void between
them is the wall. A doorway is a small rectangle bridging that gap, which is
what a doorway is in a real building. js/maps/sellwrong.js reads as a floor
plan because of that one rule.

MONSTERS ARE STATE TABLES. Each state says which sprite frame, how many
tics, one function to call, and which state comes next. Read a run of them
out loud and you have the animation:

  RUN: A 4, A 4, B 4, B 4, C 4, C 4, D 4, D 4, and round again

Eight states, four drawings, 32 tics — a bit under a second, which is the
pace of a walk. A_Chase runs on every one of the eight, so the monster gets
eight chances a cycle to notice you have moved.

THE CHASE IS P_NewChaseDir. A monster does not path-find. It picks whichever
of eight compass directions points most nearly at you, tries to walk that
way, and if it cannot, works through the others in a randomised order until
something gives. What comes out is a thing that confidently walks into a
shelf, hesitates, slides along it, finds the end and comes round — with no
graph, no nodes, and no map data at all. It refuses to turn round until
there is nothing else left, which is what stops monsters oscillating in a
doorway and is the detail most reimplementations drop.

THE WORLD RUNS AT 35 HZ, always. Every duration in the state tables is in
tics and every movement constant is per tic, so the frame time goes into an
accumulator and the world steps in whole tics. The renderer runs at whatever
rate it likes. Doom's movement numbers are used exactly —

  friction     0.90625 a tic
  walk thrust  0.78125   ->  8.33 u/tic terminal  (292 u/s)
  run thrust   1.5625    -> 16.66 u/tic terminal  (583 u/s)

— because terminal velocity is thrust over one-minus-friction, and those
awkward fractions are 25/32 and 50/32, the numbers in Doom's own table.


HOW IT LOOKS
------------

Everything is drawn into a buffer about 200 pixels tall and thrown at the
screen with no smoothing. The vertical resolution is fixed — that is the
chunkiness control, on [ and ] — and the width follows the window's shape,
so a wider monitor shows MORE STORE rather than the same store stretched.
The status bar and the weapon go into the same buffer, at the same chunk
size, because a crisp overlay on a chunky world reads as a filter applied to
a photograph.

256 COLOURS. Fourteen ramps, generated, so nothing here is anybody's palette
and there is nothing to attribute. A ramp is a list of stops with the middle
one deliberately off the straight line between the ends, because
interpolating a light brown to black gives a dead grey-brown that no real
material does. Fire gets seven stops and 44 of the 256 entries, because the
store burning down is the only thing anyone is going to look at closely.

Colours are snapped to the palette on the GPU through a 32x32x32 lookup
cube, built once at start-up, flattened into a 1024x32 texture. Dither
first, then snap: dithering afterwards would put back colours the palette
does not contain.

LIGHT STEPS, IT DOES NOT FADE. Doom did not multiply a surface by a light
level, it kept 32 pre-darkened copies of the palette and picked one. So
brightness drops a BAND at a time down a dark aisle, and those steps are
half the atmosphere. The material shader quantises light to 32 levels before
it uses it. Doom's fake contrast comes with the same idea: walls running
east-west read a notch brighter and north-south a notch darker, so a corner
is visible in a renderer that does no shading at all.

ONE LIGHT, for the fire. Everything else is unlit, but a store that is
burning down and does not get brighter as it burns is not really burning. It
parks itself at the centre of mass of whatever is alight nearest you, and it
is added after the light is quantised, so the glow slides smoothly over the
banding instead of fighting it.


THE ART
-------

There is not an image file in this project. Two reasons, and the second is
the real one: it loads instantly, and everything comes out of the same box
of parts so it all matches. The light comes from the top left in every
texture and every sprite — a rule, not a parameter, because a rivet lit from
the left next to a panel lit from the right is the loudest way to make a
wall look wrong.

MAX 64 PIXELS, everywhere. That is not a limitation, it is the brief. What
survives the cut, in every texture: one big shape you can read across the
store, one lit edge, and dirt at the bottom. Anything finer is gone by the
second repeat.

THE MONSTERS ARE A SKELETON. Doom's are eight photographs of a clay model,
which is why they turn convincingly: the rotations agree because they are
the same object. So js/figure.js poses a small articulated figure in 3D and
flattens it to eight views. A walk is four keys — contact, pass, contact,
pass — with the arms answering the legs, and the whole cycle costs one set
of joint angles rather than thirty-two drawings.

Limbs also SPLAY, a few degrees, changing across the cycle. A limb that only
swings forward and back vanishes when the figure walks straight at you: the
swing is entirely toward the camera, so four walk frames come out as four
drawings of standing still. Doom's artists drew their front-view frames more
bow-legged than their side views for exactly this reason.

THE FIRE is the PSX Doom routine, which is thirty lines and still the best
looking fire anyone has put in a game of this shape. Seed the bottom row
hot; for every cell above, take the one below, subtract a small random
amount, and shift it sideways by the SAME random amount. The shared random
value is the part that matters — it correlates the flicker with the decay,
so the flame licks instead of dissolving.

The two monsters are Doom's opening two. The ASSOCIATE is the Zombieman: 20
health, painchance 200, a slow ranged attack, still wearing the polo shirt.
He is there to be the thing you are not frightened of, so that the other one
lands. The STOCKER is the Imp: 60 health, hunched, faster, and it throws a
tin of something at your head from across the shop floor.

Both are placeholders in the sense that the DRAWING is provisional, and not
placeholders in the sense that the animation is. The state tables, the
timings, the eight rotations and the anchor points are final. Real art drops
into the same eight slots per frame and nothing else changes.


THE TEST
--------

  node tools/smoke-test.mjs

No install and no browser — a stub stands in for three.js, since the
bakeries, the map builder, the collision and the state tables are all pure.
115 checks. Every one of them earns its place by having caught something
that had already reached a screenshot:

  a sprite whose art wrapped round the edge of its own canvas, so a forearm
    drawn off the bottom appeared in the sky, at a fixed point on screen,
    in every shot
  a monster state naming a frame letter the bakery never made, so the
    Stocker's pain frame did not exist
  a wall texture chosen by whichever sector was DECLARED first, so an aisle
    had shelving down one side and blank plaster down the other
  a move long enough to step clean through a wall with nothing noticing it
    had been there
  a single match taking the entire store in thirty seconds, which looked
    wonderful and played like a screensaver


WHAT IS NOT DONE
----------------

  the cars are placeholders and are meant to be
  no music
  no second level, and no level-to-level flow
  the Stocker's thrown tin has no trail and is easy to miss
  touch controls are wired in input.js but have no on-screen buttons
  no save
