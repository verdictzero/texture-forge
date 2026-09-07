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
  SHIFT         run             LMB/CTRL  flamethrower
  SPACE / F     open, use       ESC       pause
  [  ]          chunkiness      N         palette on / off

Gamepad works. Mouse look needs a click to grab the pointer.

One weapon, and it is a flamethrower: four metres of reach, a
forty-five degree cone, and a tank that holds five hundred with cans
scattered over the whole store. A boxcutter and a molotov are written,
tested and switched off — a boxcutter is a more interesting weapon than
a flamethrower in almost every game ever made, and in this one it is the
wrong verb.


THE ONE IDEA
------------

The fire is a simulation running under the level, not an effect painted on
top of it. There is a grid of FUEL over the whole map, and every cell takes
its value from the sector it lands in.

  a gondola of stock    300      goes up like a gondola of stock
  the stockroom         340
  a produce bench       150
  the aisle between      55      creeps
  the car park            0      will not burn at all, ever

Everything indoors goes eventually, from one match, with nobody helping.
That is a requirement, and it is a statement about percolation rather than
about flammability: a fire crossing a region survives only if each burning
cell lights, on average, MORE THAN ONE new one before it burns out.

  expected spreads  =  tics alight  x  chance/256  x  neighbours

Above one and it runs away and takes everything connected to it. Below one
it peters out, and no amount of waiting brings it back, because a burnt cell
has no fuel left to relight. There is no middle setting.

So both terms are tuned per cell from how rich it is, and both point the
same way. Rich stock burns HOT and FAST and throws sparks eagerly; thin
fuel SMOULDERS, never getting hot, burning a unit at a time, staying alight
long enough to pass the fire on. A bare walkway gets about 1.9 expected
spreads and a gondola about 25 — both above one, so both go.

What differs is PACE, and that is the whole feel of it:

  a gondola of stock     a cell every 0.6s — a full run is up in ten
  bare lino              a cell every 3.4s — an aisle takes twenty to cross

Left completely alone, one match takes the entire shop in about a hundred
seconds. Your flamethrower is roughly ten times faster than that, which is
the point of carrying it — you are not starting the fire so much as
deciding where it starts and how long the store has.

A BURNING ASSOCIATE is the third way it travels. It keeps chasing you, sets
light to what it walks over, and dies on its feet somewhere in the frozen
goods. Set one alight at the end of an aisle and it will do more damage to
the store than you will.

The car park has no fuel at all and never burns, which makes it the safe
room: the one place you can stand and watch what you have done.


WHAT IS LEFT AFTERWARDS
-----------------------

A store that burns down and looks identical afterwards is an animation,
not a simulation. Two things stop that.

EMBERS. A cell whose fuel is spent drops to a low glow and sits there for
most of a minute before going cold, rather than fading out in a second.
Ground you have already taken stays visibly taken, and an aisle you gutted
five minutes ago is still ticking over in the dark behind you.

CHARRING. Every surface that can burn has a charred twin, generated from
the original rather than drawn separately — so a shelf that goes up turns
into a burnt version of ITSELF and stays in register. Three things happen
to it, and all three are needed or it just looks dim: it goes dark but
unevenly, with soot in the recesses so the relief is still legible; it
goes pale and patchy where the ash settles, which is what stops it reading
as "the lights went out"; and a few embers survive in the cracks as the
only saturated colour left.

When a region is half gone its surfaces are swapped, all at once, and the
level geometry is rebuilt. That costs about ten milliseconds and happens
perhaps twenty times in a level, debounced so that six gondolas passing
the line in the same second produce one rebuild rather than six.

The ambient light also lifts as the store goes — partly embers, partly the
roof no longer being entirely there. A gutted store lit only by embers is
accurately almost pitch black, and you still have to find the way out of
it, so accuracy loses that one on purpose.


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

THE LIGHTS ARE OBJECTS, NOT PAINT. A suspended ceiling is a grid of tiles
with a fluorescent fitting every so often, and "every so often" is the
problem: a 64-pixel texture tiling every 64 units puts a fitting in every
tile. So the ceiling texture is declared as 256 units square — one texture
is a 4x4 block of tiles with a single housing in it — and the fittings land
every 256 units. A texel is four units instead of one, which is nothing on
a surface three metres over your head.

The texture only draws the HOUSING. The light itself hangs in it as a
separate object, because a light you can shoot out is worth ten you cannot,
and a lamp painted into the ceiling can never be anything but painted. Each
one has ten health. Shoot it, or let a fire get under it — the burn check
is two-dimensional, so anything alight on the floor below will eventually
take out the light above it — and it bursts, showers sparks that fall, and
goes dark for the rest of the level.

A sector's brightness is its own AMBIENT — emergency lighting, whatever
comes through the front — plus every working fitting that can see it. So
shooting one out genuinely takes light away, and a fire working its way
along a run of them puts an aisle out a section at a time. The reach test
is done near the ceiling on purpose: walls run floor to ceiling and stop
it, but a gondola is only 80 tall under a 352 ceiling, so light passes over
the shelves into the next aisle, which is what light does.

A sector is lit by the AVERAGE over sample points across its area, not by
the value at one place in it. The first version measured each lamp against
the nearest point of the sector's bounding box, which for a 600-unit aisle
is distance zero from every fitting along its length — so every sector
summed four or five lamps at full strength, clamped, and shooting them out
changed nothing anywhere. A long room is not close to a lamp; parts of it
are.

ONE MORE LIGHT, for the fire. Everything else is unlit, but a store that is
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
  a hard fuel threshold that stopped fire crossing a walkway at all, which
    meant most of the shop could never burn — the check now runs one match
    for forty thousand tics and demands every region of the store, and
    demands that every region says so afterwards
  sector light measured to a bounding box, which pinned the whole shop at
    full brightness and made the lights unshootable in effect — the check
    now bursts every fitting over one aisle and demands it get darker
  a fixture texture whose declared world height did not match the fixture,
    showing a slice of a second copy of itself cut off at the floor


WHAT IS NOT DONE
----------------

  the cars are placeholders and are meant to be
  no music
  no second level, and no level-to-level flow
  the boxcutter and the molotov are built and switched off
  the Stocker's thrown tin has no trail and is easy to miss
  touch controls are wired in input.js but have no on-screen buttons
  no save
