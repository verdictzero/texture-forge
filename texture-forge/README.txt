TEXTURE FORGE
=============

One procedural PBR texture tool, one tab per surface. Open index.html in a
browser — no install, no build step, no network needed. Everything runs
locally in the page. The same files are also live at
https://verdictzero.github.io/texture-forge/ — see ON THE WEB below.

Keep the folder together: index.html loads forge-core.js and the files in
modes/. Opening index.html on its own gives you an empty app.

Every mode previews with a real-time GGX lit view (drag to move the light) and
exports a full PBR set as PNG, individually or all at once as a .zip.

  index.html            the app
  forge-core.js         shared runtime: panel, preview, export, zip, wizard
  forge-palette.js      palette, dither and nearest-neighbour filtering
  modes/street.js       asphalt and street layout
  modes/plating.js      seamless riveted aircraft skin
  modes/house.js        American house front elevation
  modes/envelope.js     the side and back of that same house
  modes/roof.js         seamless roofing over it
  modes/fence.js        fencing: board, picket, rail, chain link, mesh, iron
  modes/hazard.js       caution striping and industrial floor marking
  modes/ruins.js        ruin-stone plating with etched circuit traces
  modes/hull.js         starship aztec hull plating
  modes/greeble.js      machined surface clutter, stacked and routed
  modes/factory.js      1940s brick factory wall with steel sash windows
  modes/diner.js        chrome-and-neon diner, front, side and back
  modes/lib/            generators shared by more than one mode
  modes/_template.js    a worked example mode, off by default
  ADDING-A-MODE.md      how to write another one
  tools/smoke-test.mjs  builds every mode and checks it, seams included
  tools/feature-test.mjs  the resolution ladder, the palette and the wizard
  .nojekyll             stops GitHub Pages ever filtering modes/_template.js


BUILT FOR 3D
------------

Every map here is made to be applied to 3D geometry, and that geometry is seen
from the side or from above. Never from below. Nothing here draws the underside
of anything.

That is a rule about content, not about rendering. A tiling material is a face
you look at square on; an elevation is a wall you stand in front of; a roof is a
plane you look down at. So the house family gives you a fascia board with a
gutter hanging off it and stops there — no soffit, because the soffit is the
underside of the eave overhang and no camera in that arrangement can see it. The
overhang itself is roof geometry in your engine, and its underside is a face you
either never build or never look at.

The same test applies to anything new: if a detail would only be visible by
looking up at the surface, it does not belong in the texture. Relief that reads
in the height and normal maps is fine — a projecting sill, a door hood, a rivet
head — because that is still the face you are looking at, standing proud of
itself.


MODES
-----

Street — asphalt and street layout
  Everything is dimensioned in real metres: tile size, stone size in mm, crack
  cells, lane widths, dash cycles. Zooming out genuinely adds detail rather
  than magnifying it, with texel-aware antialiasing and automatic aggregate
  LOD.

  Surface: three grades of faceted crushed aggregate in bitumen, fines,
  ravelling, alligator and long cracks, sealant, potholes, patches, paving
  joints, wheel rutting and polish, oil, dust, wetness and standing water.

  Street pieces: plain, full cross-section, edge / centre / lane lines, stop
  bar, crosswalk (4 styles), turn arrows, 4-way intersection, parking bays.
  The asphalt always tiles both ways so every piece butts against every other;
  only the markings decide whether a piece repeats. Dash cycles snap to whole
  repeats.

  Kerb and footway: gutter pan, kerb, footway with crossfall, control and
  expansion joints, broom finish, slab settlement, kerb paint, dirt verge, and
  a full concrete distress stack (spalling, crazing, cracked slabs, popouts,
  efflorescence, moss).

  Edge decay: any combination of the four tile edges can be eaten inward, so a
  piece ends in a torn edge rather than a ruled one. It is layered twice over.
  The NOISE is layered — chunk, block and crumb bands of it — and so is the
  ROAD: the wearing course goes first, the binder course under it next, then
  the granular base, then subgrade, each eaten back a little less far than the
  one above, which is what gives a real break its concentric strata instead of
  one clean bite. The push inward is linear in the distance travelled, which is
  what spreads those strata evenly across the reach rather than bunching all
  three into the last few centimetres.

  Chunkiness decides HOW it fails: bound asphalt lifts out in slabs with
  straight edges, so a chunk's resistance is constant across it and the break
  lands on the chunk boundary; an unbound shoulder crumbles instead. Loose
  chunks of the old surface lie in the break, the standing lip is undercut and
  shadowed, and no marking decal is drawn over a hole.

  A decayed side is a torn side, so that axis stops repeating — the tag under
  the preview and the readme in the zip both say which axes still do. Kerb and
  footway decay with everything else; the decay is applied to the finished
  surface, whatever material that surface turned out to be.

  Presets: close-up 1 m, highway 12 m, backroad, wet night, kerbside street,
  kerbside wrecked, broken edge, intersection.

Plating — seamless riveted aircraft skin
  Staggered panel bays with lap-joint steps, rivets (universal dome, flush
  countersunk or mixed, optional double rows and field doubler patches),
  three-layer chipping from paint through zinc-chromate primer to bare
  aluminium, scratches, streaks and seam grime.

  The rivets are sieved as they are laid. A head that would land on a head
  already down is dropped rather than stacked on it, which is what stops the
  panel corner — where a stringer row crosses a butt row — growing a doubled,
  lumpy fastener. Only rivets from different runs are tested against each
  other: the pitch inside a run is deliberate, and both sides of one seam count
  as a single run, so a double row never culls itself. Stringers go down first,
  so it is the shorter butt row that stops short at a corner, which is what a
  real airframe does.

  A field patch is a doubler, and it is placed like one. It picks a panel and
  either LAPS one of that panel's seams — borrowing the seam line's own rivets,
  at that line's own pitch and phase, as the patch's edge row, and adding
  nothing beside it — or it sits as an island in the middle of the panel with
  the best part of a pitch of bare skin between it and every seam line. The one
  thing it cannot do is lay a row a fraction of a pitch off an existing one.

  Tiles seamlessly in both axes.
  Presets: weathered warbird, clean airliner, bare aluminium, derelict hulk.

House — American house front elevation
  A composed facade rather than a tiling texture, dimensioned in feet. Output
  is non-square at uniform texel density and carries an alpha channel, so a
  gable front gives you a real cut-out silhouette to drop onto a plane.

  Cladding: clapboard, vinyl, board and batten, wood shingle, brick, stucco,
  stone veneer. Openings: double-hung sashes with configurable lites, casing,
  projecting sills, shutters, and six-panel / four-panel / half-light / flush
  doors with transoms, hoods and steps. At the eave, a fascia board carrying a
  K-style gutter and a connected downspout — and no soffit, for the reason in
  BUILT FOR 3D above. Fascia depth sets the whole eave band, so it also sets
  how much board shows below the gutter.

  Weathering: sun fade, peeling paint through undercoat to bare wood, drip
  streaks, splash-back, mildew, nail rust, rot and overall grunge.
  Abandonment: boarded windows (OSB, plywood or salvaged planks), broken
  glass, graffiti, climbing vines, missing siding exposing felt and studs.

  Presets: colonial, bungalow, brick rowhouse, vinyl tract, abandoned,
  derelict shell.

Envelope — the rest of the house
  The house mode draws the street front; this one draws everything else, off
  the same generator and the same seed, so with matching settings the faces
  belong to one building: the siding courses line up, the trim is the same
  stock, the weathering carries over.

  Side elevation: the depth of the house, not the facade width. An eave-front
  house presents a gable end from the side and a gable-front house presents an
  eave wall — the mode makes that substitution for you. Stair landing window,
  bathroom window, blank bays, optional service door, and a choice of which end
  of the house you are looking at (the two ends are not mirror images).

  Back elevation: back door or sliding patio door, the kitchen window beside
  it, and the service clutter that only ever lands on the faces nobody
  photographs — meter and board, vent stack, dryer vent, hose bib, back light.
  A chimney can run up either plain face and is part of the cut-out silhouette.

  Presets: the same six the house mode offers, so the faces agree.

Roof — seamless roofing
  Three-tab and architectural asphalt shingle, wood shake, slate, clay barrel
  tile, standing-seam and corrugated metal, rolled roofing with gravel ballast.

  Every dimension is in real inches, and the course, tab, pan and corrugation
  counts are snapped so a whole number fits the tile — which is what lets it
  repeat without a seam. The readout says how many inches the tile covers, what
  exposure you actually got (not always the one you asked for), and warns when a
  tab or a rib falls below a couple of texels.

  Weathering: granule loss, algae streaking down-slope, moss and lichen in the
  shaded laps, sun bleaching, cupping and curling butts, missing tabs showing
  the deck, tar patches, nail pops, rust and chalking on metal.

  There is deliberately no pitch control: this texture is the roof plane's own
  surface unrolled, and a plane is not foreshortened by its own slope — the
  camera does that when you tilt it into the scene.

  Presets: three-tab, architectural, algae belt, storm-worn, cedar shake, Welsh
  slate, mission tile, standing seam, corrugated barn, gravel ballast.

Fence — a run of fencing, seamless along the run
  Seven types, all dimensioned in real inches because fencing is sold in
  inches: board privacy, picket, split rail and ranch rail, chain link,
  welded wire site panel, ornamental iron and palisade, corrugated hoarding.
  Output carries alpha, so it is a cut-out you drop on a plane — and it
  repeats along the run, so one tile is a whole fence.

  The tile edge falls on a post CENTRELINE. That post is drawn once, its left
  half in the last texels and its right half in the first, so repeating gives
  neither a doubled post nor a halved one, and every per-post and per-board
  random is hashed on the piece index modulo the count per tile.

  The aspect ratio is the mode's other problem. A fence run is long and short,
  and WebGL will not repeat a texture whose axes are not powers of two, so the
  tile height is a power-of-two multiple of its width — the smallest one that
  clears the fence plus a hard four inches of ground and four of air — and the
  leftover is spent on ground and sky at unchanged density. Nothing is
  stretched: a circle stays a circle, which is what keeps the chain-link weave
  at 45 degrees. The readout says how much of the tile is sky and gives you the
  V range to crop if you do not want it; only U has to wrap for a fence run.

  The ground is a band of clutter that fades out before the bottom edge rather
  than an opaque ground plane, so the tile wraps vertically too and the card
  sits in terrain instead of on a hard line of dirt.

  Chain link gets the detail it deserves: the diamond period is snapped so a
  whole number fits the tile (2 in mesh on a 10 ft bay comes out at 1.973 in,
  and two bays per tile snaps it to 2.000), the wire is round with a real
  over-under weave carried in the normal map, the fabric height lands the
  selvage on a knuckle at both ends, and there are tension bars, tie wires,
  privacy slats and barbed extension arms. A 9-gauge wire is 1.3 texels at
  1024, so alpha is the exact area of the wire inside each texel — never a
  threshold — and below two texels a feature keeps its opacity and loses its
  shape rather than aliasing. The readout names everything it dropped.

  Weathering in causal order: for timber, mill marks, raised grain, UV
  silvering, cupping, splits, knots (some of which fall out), nail stain and
  tannate halos, paint that fails a whole flake at a time, missing and broken
  boards, and sag; for steel, galvanising spangle, white rust where water
  sits, red rust only where the coating has actually gone — cut ends, welds,
  abraded contacts, fixings — dents, and chalking. Then ground splash, moss
  and dirt in the low spots.

  Presets: suburban privacy, weathered grey board, board-on-board cedar, white
  picket, split rail, industrial chain link, chain link with barbed arms,
  slatted chain link, temporary site mesh, steel palisade, ornamental iron,
  corrugated hoarding.

Hazard — caution striping and floor marking
  Painted safety marking on a real floor, dimensioned in millimetres: diagonal
  hazard stripes, chevrons, zebra edging, chequer, keep-clear crosshatch, solid
  zones, or bare floor. Concrete (troweled, broom, polished, sealed), steel
  diamond plate, steel plate or asphalt underneath. Laid as paint, epoxy,
  thermoplastic, tape or anti-slip grit.

  A diagonal stripe at an arbitrary angle does not tile, and this is the mode's
  central problem. The field only repeats when its two frequency components are
  whole numbers of repeats per tile edge, so the mode snaps them and tells you
  what it actually built — 200 mm at 45 degrees on a 2 m tile comes out as
  202.03 mm, exactly. If you need both numbers exact, it will tell you the tile
  size that makes them exact instead. You can also turn the snap off for a
  one-off piece, and the tag under the preview says the edges will not match.

  Colour standards are the real ones — OSHA/ANSI safety yellow on black, red on
  white, green, blue, orange, radiation magenta on yellow, ICAO obstruction
  orange — and the readout names what each one means.

  Wear in the order it actually happens: repaint ghosting under the new
  marking, traffic polishing the film, flakes letting go a whole chip at a time
  at the band edges and in the wheel tracks, scratches, tyre scuffs and skids,
  rust creeping out of the cut edges on steel, oil, efflorescence, and dirt
  settling into whatever is left low.

  Presets: loading bay, forklift aisle, fire door keep-clear, machine guard,
  radiation store, weathered dock plate, fresh repaint, chequer pad.

Ruins — ruin-stone plating with etched circuit traces
  The Plating Fabricator tool, folded in: seamless stone plating cut into
  staggered rectangular and L-shaped plates, with circuit traces routed across
  each plate by one of eight generators — wandering routes, serpentine
  switchbacks, spirals, nested contours, parallel bus ranks, radial hubs, pad
  and link nodes, or a branching labyrinth. Junction bores where three or more
  plates meet, vias on the traces, and a bevel that can be etched into the
  stone or embossed proud of it.

  Four stone themes: ashen ruin, verdigris bronze, gunmetal cyan, obsidian
  amber. Everything derives from a greyscale relief pass, so switching etched
  to embossed inverts the normal, AO and roughness for free.

  It also exports a pre-lit channel — a baked diffuse for unlit or legacy
  shaders, lit from its own angle and elevation. Use it INSTEAD of the PBR set,
  never alongside it.

Hull — starship aztec plating
  The quilted hull skin of screen starships. The thing worth knowing about it
  is that the quilt is a SPECULAR effect: the plates are very nearly the same
  colour and very nearly coplanar, and what makes the pattern appear is that
  each one takes the light slightly differently. Open the roughness tab and the
  whole design is there; open the base colour tab and it is close to a flat
  pale grey. That is the correct result, not a bug, and it is why the defaults
  keep albedo variation down at a few per cent — push it past about 0.3 and the
  hull stops reading as a starship and starts reading as a patchwork quilt.

  Plates come off a wrapping quilt of rows and staggered columns that then
  subdivides, so the sizes are a small family of related ones rather than
  arbitrary. Over them sits a coarser grid of structural bays with a heavier
  scribe line, access hatches with corner fasteners, trim panels in an accent
  colour, and bands of windows that light up — unlit panes stay dark glass
  rather than black holes, and lit ones drive the emissive map in the window
  colour you pick.

  Dimensioned in metres. The readout will tell you when the plates or the
  scribe lines have got smaller than the resolution can hold.

  Presets: refit (fine and cold), TV era (broad and warm), nacelle skin (no
  windows), battle-scored.

Greeble — machined surface clutter
  The fine mechanical detail that makes a hull, a machine bay or a reactor face
  read as built rather than moulded. A base plate carries a field of extruded
  blocks at a small number of quantised heights, separated by a gap that shows
  the plate underneath, with chamfered edges. Those three things together —
  discrete levels, a real gap, a bevel — are the difference between greebling
  and lumpy noise. A block can also have one corner clipped at forty-five
  degrees; that is a silhouette change, so it goes into the block's own edge
  distance and every gap, bevel and inset downstream follows it for free.

  Three things then stack on that, and the stacking is the point.

  TIERS. A block can carry a smaller plate on top of it, and that plate another
  one again, up to four deep. Each tier is clipped by its host's inner mask, so
  a sub-plate can never overhang the thing it stands on, and each is a fraction
  of the height of the one below. A tier can also go DOWN instead of up — a bay
  machined into the block rather than a plate bolted onto it — as often as the
  recessed-blocks slider says, which is what gives the shapes somewhere to sit
  below the face around them. The topmost plate present is the one that takes
  the shape, the bolts and the lamp, which is what makes a stack read as an
  assembly rather than as a pile.

  SHAPES. Each top face takes at most one, from eleven: louvred vent, round
  port, recessed pocket, stacked cap, heat-sink fins, hex boss, perforated
  grille, stepped pad, bolted hatch with its own ring of fasteners, drum, and
  wedge. They are chosen by WEIGHT rather than down a chain, so no shape
  starves the ones after it: a shape at zero never appears, doubling one makes
  it twice as likely against the rest, and how many faces carry a shape at all
  is a separate slider. Anything whose detail would fall below about three
  texels — vent slots, grille holes — is dropped whole rather than aliased,
  because a grey mush of half-texel slots is worse than none.

  CONDUIT, routed rather than ruled. A walker starts at a node of a coarse
  lattice, lays a random number of cells in one direction, turns ninety degrees
  and goes again, until its length is spent. Several walkers share the lattice,
  so where two runs meet at a node the meeting is a real tee or cross with a
  cast body on it; a bend is an elbow, a run that stops is a capped stub, and
  couplings and clamps sit along the runs between. Runs come in up to three
  diameters and ride on standoffs at a height you set, so they pass over the low
  blocks and behind the tall ones — which is what stops the pipes reading as
  decals. Only the lattice EDGES are stored, which is what keeps the lookup one
  step per texel however long the routes get.

  This one is the opposite of the hull mode next door: nearly all of its
  character is in HEIGHT, and the colour map is mostly dirt. Blocks stand tens
  of millimetres proud before the tiers stack on top of them, which is more
  relief than a normal map carries convincingly at a grazing angle — displace it
  if the surface is ever seen from the side.

  Dimensioned in metres and millimetres. The readout says what the tiers stack
  to, what the conduit lattice does to the largest diameter you asked for, and
  which of it has got too small to read. Presets: hull greeble (fine), machine
  bay (coarse), reactor face (lit), service panel (shallow), pipe works
  (conduit heavy).

Factory — 1940s brick factory wall
  A whole wall panel rather than a material: three storeys by four bays of steel
  industrial sash set into brick, tiling in both axes so the panel repeats into
  an elevation.

  The window is the point. A factory sash of this period is a grid of small
  panes in thin steel bars, split across the middle by a heavier transom into an
  upper and a lower half, each half carrying its own pane grid, with the row of
  panes against the transom being the operable hopper. Pane counts are not a
  slider: you give a target pane size and the mode snaps the count so a whole
  number fits each half, which is what real steel sash did and what keeps the
  bars square. At the default 14 m tile that lands on six 433 mm panes across
  and three above and below the transom, and the readout tells you so.

  Brick courses and brick lengths are snapped the same way, which is what makes
  it seamless — the readout gives you the course height it actually built, in
  millimetres, rather than quietly stretching the bond. Common, running, English
  and stack bonds, with flashed headers, spalled faces and lost pointing.

  Around the openings: cast stone sills, a choice of soldier course, painted
  steel angle or cast stone lintel, pilasters between bays, and a belt course at
  every floor line — which is the one horizontal detail that can repeat
  honestly, so there is no plinth and no parapet. Cap it with your own geometry.

  Glass runs from filthy through painted out — the wartime habit — to broken and
  gone, and any pane can be lit from inside, which drives the emissive map.

  Presets: red brick works, sooted mill, whitewashed warehouse, derelict plant.

Diner — American chrome and neon, every face
  One prefabricated streamline diner drawn from the front, the long side or the
  back, off the same body, so the three faces agree: the bands land at the same
  heights and the neon runs round the corner. An elevation with an alpha cut-out
  rather than a tiling material, with the top corners rounded the way a
  streamline body is.

  The vocabulary is the real one. From grade up: a glazed tile skirt, a band of
  porcelain enamel on chrome battens, the window band in plate glass with chrome
  mullions, another enamel band, and the eyebrow — the projecting cornice the
  neon runs along. Horizontally fluted stainless can take any of the solid
  bands; it is the signature material and the one that reads as a diner from
  across the street. Bay spacing and enamel panel width are snapped so a whole
  number fits the face, and the readout says what it landed on. The back swaps
  the glass for solid panel and gains a kitchen exhaust duct, a steel service
  door with a kick plate, and the bulkhead light over it.

  The doors are doors. A door starts at the PAVEMENT, so the entrance runs floor
  to head straight through the tile skirt and the enamel band the way an opening
  does, and the shopfront glazing stops at its jamb instead of running behind
  it. A leaf is a frame — two stiles, a top rail, a deeper bottom rail that
  takes the kick — with glass in the hole, and over that a kick plate brushed
  duller than the frame it is screwed to, a glazing bead round each pane, the
  reveal shadow where the leaf sits back behind the jamb, a threshold plate, and
  a pull held off the leaf on standoffs with its own shadow under it. Every
  member is the same polished metal; what tells them apart is how much light
  each one takes, which is why drawing them in one flat chrome gives you a white
  rectangle instead of a door.

  Single leaf, a double pair meeting in the middle with a pull on each leading
  stile, or a single leaf with fixed sidelights. Full glass or half glass over a
  solid panel. A tubular pull, a D-handle or a push bar across. Handing, and a
  transom light that appears only when there is room for its rail, its cap and
  some glass between them. The service door on the back does the same in steel:
  single or double, three butt hinges down the hanging stile, a lever on a rose,
  and an optional vision lite.

  THE NEON IS ENTIRELY EMISSIVE, and that is the point of the mode. The tube
  itself stays pale glass in the base colour whether it is lit or not — which is
  exactly what neon looks like in daylight and with the power off. Every bit of
  the glow, in each run's own colour, is in emissive.png. Turn that map off in
  your engine and you have a diner at noon; turn it on and you have one at
  midnight, and the Lit slider is a dimmer rather than a repaint. Painting the
  glow into the albedo is the usual mistake and it can never be switched off.

  The sign is real tubing too: the word is stroked, not filled, with round
  joins, so it is a bent tube following the letter outline rather than a glowing
  solid — and its halo is the tube blurred, which is most of what sells neon.

  Presets: chrome classic, turquoise & cream, night shift, closed up.


COORDINATING ONE BUILDING
-------------------------
The front, the side, the back and the roof are four textures of one house, and
dialling the same twenty settings into four panels by hand is how they end up
not matching. There are two ways round that, for the two situations you are
actually in.

THE WIZARD, for when you do not yet know what the building is. The buttons
beside the mode tabs — "Whole structure: House · Diner" — walk you through the
faces in the order you would really decide them, and every step OPENS with what
the steps before it settled on — every setting its mode declares that an earlier
step also declared. The side elevation already knows the width, the storeys, the
cladding, the trim and the weathering by the time you see it; the roof already
knows the seed. What a step CANNOT inherit is anything no earlier face had a
control for — the depth of the house is the side's own to set, because the front
elevation never showed it — and the step notes say so as you go.

Inherited rows are marked with a rule down their left edge, and
the moment you change one it stops being inherited and becomes what the faces
after it inherit instead. You can step back and forward, and jump to any step
you have reached.

The last button on that bar packs the lot: every face built at full size, each
in its own folder with its own maps and its own readme, plus a readme for the
building. That is the point of it — the structure leaves as one object rather
than as four exports you have to remember to line up afterwards.

House walks front, side, back, roof. Diner walks front, side, back off one
streamline body, so the bands land at the same heights on each face and the
neon carries round the corner.

THE LINK, for when you already have a house and want to change it. Tick
"Coordinate with..." in any of the house, envelope or roof panels and every
setting those panels share is mirrored across them the moment it changes, in
whichever direction you edit. Turning the link off in any one panel turns it off
in all of them, and every panel keeps whatever it had at that moment.

Neither one carries resolution, and the wizard does not carry the face either:
how many texels you want of a given face is a property of the export, not of the
building, and which face a step is is the one thing that step exists to pin.


PALETTE, DITHER AND NEAREST
---------------------------
The bar above the preview. Three controls that only matter once you are working
small, and that are really one decision: I want this to read as pixel art rather
than as a photograph.

The palette snaps the base colour to a fixed set of colours. It is applied in
ONE place — the runtime's makeMap(), which every chip, every preview upload,
every single-channel download and every zip entry already goes through — so what
you see on screen is exactly what lands in the file. There is no separate
"export palettised" step to forget to tick.

ONLY THE BASE COLOUR IS TOUCHED. Normal, roughness, metallic, AO, height and ORM
are data, not pictures: a normal map snapped to sixteen colours is a broken
normal map and a dithered height field is a field of noise. The readme in the
zip records which palette and dither produced the base colour and says the rest
is untouched.

Dither is none, ordered 2x2 / 4x4 / 8x8, or Floyd-Steinberg, with an amount. The
amplitude is scaled by the palette's own median nearest-neighbour distance
rather than by a notional "levels" count, because a palette you loaded has no
levels — too little and the ordered pattern does nothing, too much and the
texture turns to static. Alpha is never quantised and never diffused into, so a
cut-out silhouette does not fringe.

Load your own palette with the button or by dropping it on the bar:

  .hex .txt    one hex per line
  .gpl         GIMP
  .pal         JASC
  .css .json   or anything else with hex colours in it
  an image     a swatch sheet. Every distinct colour covering more than a token
               area becomes an entry, in the sheet's own reading order, so a
               sheet laid out as ramps comes back as ramps.

Loaded palettes persist, so the one you work in is still there tomorrow. The
built-ins are deliberately just generated ramps — a palette is somebody's work,
and shipping a named one means shipping their name with it.

Nearest keeps the texels square under magnification in the lit preview, the flat
channel views and the chips. Minification still goes through mipmaps when the
tile repeats, but the nearest level of them, so a 4x4 repeat stays blocky rather
than shimmering into noise.

Every mode offers the same resolution ladder — 64, 128, 256, 512, 1024, 2048,
4096 — and the small end is what these three controls are for. Nothing in the
generators changes to get there: every mode already snaps its feature counts to
whole numbers per tile and drops anything falling under a couple of texels
rather than aliasing it, and every readout already names what it had to let go.


EXPORTED MAPS
-------------
Base colour, normal, roughness, metallic, AO, height, ORM (packed), plus
per-mode extras: a markings alpha decal (street), a paint alpha decal and
material ID (hazard), material ID / emissive / opacity (house and envelope),
material ID / opacity / an infill mask (fence), and a pre-lit bake (ruins).
Each zip also contains a 16-bit height PNG and
a readme giving the real-world size of the tile so displacement comes out true
to life.

File names carry the mode, seed and size, so exports from different sessions
never collide: street_cross_1963_2048_normal.png, panel_1947_1024_orm.png,
house_1912_1024x1300_basecolor.png. The fence carries both axes in its name
because its aspect changes with the fence: fence_chain_1948_2048x1024_orm.png.

Notes worth knowing:

- Metallic is flat black in the street mode by design — asphalt, water and
  road paint are all dielectric. In the house mode glass is deliberately set
  metallic as a cheat so an opaque pane reads as glass; set it to 0 if your
  engine does real transparent glass.

- Use the 16-bit height for displacement wherever the texture contains a large
  step (a kerb, a window reveal). At 8 bits those steps eat most of the range
  and the fine surface bands.

- Heavier resolutions build on demand: dragging a slider shows a small preview
  and releasing rebuilds at full size, up to 1024. Above that, press the build
  button. Exports refuse to run off a preview.

- If a download does not start, click the orange Save button that appears next
  to it — that path cannot be blocked by the browser.


USING IT
--------
- The tabs along the top switch mode. Each keeps its own settings, and the URL
  follows, so index.html#house opens straight into the house mode.

- Switching back to a mode you have already built shows the previous result
  without regenerating it. Results above 1024 px are dropped when you leave
  the mode rather than held in memory, so they rebuild on return.

- The tabs in the preview bar switch between the lit view and the individual
  channels. 1x/2x/4x repeats the tile — seamless modes only. Dark/sky/checker
  set the backdrop behind a cut-out — house only.


ON THE WEB
----------
Every push to main publishes this directory at

  https://verdictzero.github.io/texture-forge/

.github/workflows/static.yml does it. There is nothing to build, so the deploy
is a straight copy: the workflow uploads texture-forge/ and GitHub Pages serves
it. The publish root is this directory rather than the repository root, which
is why index.html is the landing page, and why fonts/ — third-party font files
the app never loads — stays out of the published site.

The mode is in the URL there too, so
https://verdictzero.github.io/texture-forge/#fence opens straight into fencing.

Pages is configured with GitHub Actions as its source, so the workflow is the
whole configuration; nothing is served from a branch. Deploying through Actions
does not run Jekyll, so .nojekyll changes nothing today. It is there so that
switching Pages to "deploy from a branch" later cannot silently swallow
modes/_template.js and any other underscore-prefixed file.


CHECKING IT
-----------
tools/smoke-test.mjs builds every registered mode in a headless browser and
checks that each one produces the channels it declares, that every view renders
without an error, and — for the tiling modes — that the texture really does
wrap: it measures the difference across the tile boundary against the sharpest
edge inside the same image, which is the only definition of "seamless" that
survives a texture with hard edges in it.

  node tools/smoke-test.mjs                 # every mode
  node tools/smoke-test.mjs hazard          # one of them

tools/feature-test.mjs covers the things that are not per-mode: that every mode
survives the small end of the resolution ladder with all of its channels intact,
that the palette parses hex lists, GIMP and JASC files, CSS and swatch sheets
and then actually snaps the base colour while leaving the data channels alone,
and that each structure wizard carries its settings forward, marks what it
inherited, refuses to carry the resolution, and packs every face into one
archive.

  node tools/feature-test.mjs               # all three
  node tools/feature-test.mjs palette       # one of them

Both need playwright; PLAYWRIGHT= and CHROME= point them at an install if it is
not sitting beside the repo.


HISTORY
-------
This replaces the four separate tools in texture-toolkit.zip. street-forge,
panel-forge and elevation-forge are now the street, plating and house modes,
and exported file names are unchanged. asphalt-forge was already superseded by
street-forge and has not been carried over.

Those generators came over as they stood, and the house still matches the old
tool pixel for pixel. Two have since moved on: plating now sieves its rivets
against each other and anchors its field patches, so a seed gives the same
panels and the same wear as before but not the same rivets, and street has
gained edge decay, which is off by default and changes nothing until a side is
turned on.

The envelope, roof, hazard, fence and ruins modes came later: envelope shares
the house generator so the faces of one building agree, roof and fence are new
and belong beside it, hazard is new, and ruins is the separate Plating
Fabricator tool brought in as a mode.
