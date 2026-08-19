TEXTURE FORGE
=============

One procedural PBR texture tool, one tab per surface. Open index.html in a
browser — no install, no build step, no network needed. Everything runs
locally in the page.

Keep the folder together: index.html loads forge-core.js and the files in
modes/. Opening index.html on its own gives you an empty app.

Every mode previews with a real-time GGX lit view (drag to move the light) and
exports a full PBR set as PNG, individually or all at once as a .zip.

  index.html            the app
  forge-core.js         shared runtime: panel, preview, export, zip
  modes/street.js       asphalt and street layout
  modes/plating.js      seamless riveted aircraft skin
  modes/house.js        American house front elevation
  modes/envelope.js     the side and back of that same house
  modes/roof.js         seamless roofing over it
  modes/fence.js        fencing: board, picket, rail, chain link, mesh, iron
  modes/hazard.js       caution striping and industrial floor marking
  modes/ruins.js        ruin-stone plating with etched circuit traces
  modes/lib/            generators shared by more than one mode
  modes/_template.js    a worked example mode, off by default
  ADDING-A-MODE.md      how to write another one
  tools/smoke-test.mjs  builds every mode and checks it, seams included


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

  Presets: close-up 1 m, highway 12 m, backroad, wet night, kerbside street,
  kerbside wrecked, intersection.

Plating — seamless riveted aircraft skin
  Staggered panel bays with lap-joint steps, rivets (universal dome, flush
  countersunk or mixed, optional double rows and field doubler patches),
  three-layer chipping from paint through zinc-chromate primer to bare
  aluminium, scratches, streaks and seam grime.

  Tiles seamlessly in both axes.
  Presets: weathered warbird, clean airliner, bare aluminium, derelict hulk.

House — American house front elevation
  A composed facade rather than a tiling texture, dimensioned in feet. Output
  is non-square at uniform texel density and carries an alpha channel, so a
  gable front gives you a real cut-out silhouette to drop onto a plane.

  Cladding: clapboard, vinyl, board and batten, wood shingle, brick, stucco,
  stone veneer. Openings: double-hung sashes with configurable lites, casing,
  projecting sills, shutters, and six-panel / four-panel / half-light / flush
  doors with transoms, hoods and steps. Full eave assembly with a K-style
  gutter, fascia, vented soffit and a connected downspout.

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


COORDINATING ONE BUILDING
-------------------------
The front, the side, the back and the roof are four textures of one house, and
dialling the same twenty settings into four panels by hand is how they end up
not matching. Tick "Coordinate with..." in any of the house, envelope or roof
panels and every setting those panels share — the seed, the cladding, the trim,
the colours, the weathering, the storey heights — is mirrored across them the
moment it changes, in whichever direction you edit.

Resolution is deliberately left out of the link: how many texels you want of a
given face is a property of the export, not of the house.

Turning the link off in any one panel turns it off in all of them, and every
panel keeps whatever it had at that moment.


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

It needs playwright; PLAYWRIGHT= and CHROME= point it at an install if it is
not sitting beside the repo.


HISTORY
-------
This replaces the four separate tools in texture-toolkit.zip. street-forge,
panel-forge and elevation-forge are now the street, plating and house modes;
their generators are unchanged, so the same seed and settings give the same
pixels as before, and exported file names are unchanged. asphalt-forge was
already superseded by street-forge and has not been carried over.

The envelope, roof, hazard, fence and ruins modes came later: envelope shares
the house generator so the faces of one building agree, roof and fence are new
and belong beside it, hazard is new, and ruins is the separate Plating
Fabricator tool brought in as a mode.
