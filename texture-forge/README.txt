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
  forge-fonts.js        typeface registry — loads one, bundles none
  forge-stage.js        the wizard's 3D building — walls, roof, orbit, picking
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
  modes/grocery.js      supermarket fixtures, stocked — seven of them
  modes/lib/            generators shared by more than one mode
  modes/_template.js    a worked example mode, off by default
  ADDING-A-MODE.md      how to write another one
  tools/smoke-test.mjs  builds every mode and checks it, seams included
  tools/feature-test.mjs  the resolution ladder, the palette, the wizard,
                          the 3D building and the grocery fixtures
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
  stone veneer. At the eave, a fascia board carrying a K-style gutter and a
  connected downspout — and no soffit, for the reason in BUILT FOR 3D above.
  Fascia depth sets the whole eave band, so it also sets how much board shows
  below the gutter.

  Windows are not all the same window. An opening carries a sash layout worked
  out once when the elevation is laid out, so the texel loop only walks it:
  double-hung with or without muntins, a casement pair, a horizontal slider
  whose panels pass one another, a picture window with operable flankers, and a
  top-hung awning light where the bathroom is. A picture window is not a
  double-hung stretched — it is wider, shorter and lower-silled, and it is sized
  that way. "Picture below, double-hung above" is the arrangement most American
  houses actually have. Doors are six-panel, four-panel, half-light or flush,
  with transoms, hoods and steps.

  A window is also a HOLE, and that is most of what makes one read. The jamb is
  a surface facing sideways into a hole and sees no sky, so it is drawn much
  darker than the casing around it; the sashes sit deeper, each behind the one
  in front; and the glass is a dark room with the sky reflected on it rather
  than a ramp to mid grey.

  The other thing that makes a wall read is the shadow line each siding course
  throws on the one below. That belongs in the base colour as well as the height
  map — it is a real material difference, since the strip under a lap never sees
  sun so it never bleaches, and dirt washing down the wall stops under the lip
  and stays. "Course shadow line" is that, with the same treatment on shingle
  butts and beside battens.

  Weathering: sun fade, peeling paint through undercoat to bare wood, drip
  streaks, splash-back, mildew, nail rust, rot and overall grunge. Paint fails a
  BOARD at a time — a board is one piece of wood with one history, and when the
  film lets go it goes from that board's own butt and cut ends inwards while its
  neighbour stays sound.

  Abandonment: boarding that went up in a hurry out of whatever was in the van,
  planks not quite level with daylight between them and nails where they cross a
  jamb, some of them prised off from the bottom because that is where a person
  is — in OSB, plywood or salvaged planks, each failing in its own way. Broken
  glass that reads as a hole with shards at the rim. Graffiti drawn as WRITING,
  in a real graffiti face (see TYPEFACES below). Vines that are rooted at grade,
  climb, branch and carry their leaves on the stem. Missing siding exposing felt
  and studs.

  Presets, fifteen of them: colonial, Cape Cod, white farmhouse, bungalow,
  Craftsman, Queen Anne, mid-century ranch, vinyl tract, shotgun house, brick
  rowhouse, stucco & parapet, and four derelicts that are derelict in different
  ways — abandoned, long empty, condemned & boarded, derelict shell. What
  separates the last four is which failure came first: nobody came back, or the
  weather got in, or the city came and closed it up.

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
  and goes again, until its length is spent. A bend is an elbow, a run that
  stops is a capped stub, and couplings and clamps sit along the runs between.
  Runs come in up to three diameters and ride on standoffs at a height you set,
  so they pass over the low blocks and behind the tall ones — which is what
  stops the pipes reading as decals. Only the lattice EDGES are stored, which is
  what keeps the lookup one step per texel however long the routes get.

  AND IT IS STACKED. Every route belongs to a LAYER, and a layer is a real
  height: layer 1 is the fattest and sits on its standoffs, and each layer above
  it clears the one below by a whole pipe width. Two things follow. A route may
  only meet a route ON ITS OWN LAYER — the walker will not enter ground another
  route on its layer holds — so what is left at a node is one run's own doubling
  back, which is a genuine tee or cross and gets a cast body. And a route
  crossing a route on ANOTHER layer needs no agreement at all: the upper one is
  a clear pipe-width above and passes over it. That is the only kind of crossing
  left in the picture, and it reads as one. Before this, every run was in one
  plane and a crossing came out as a lump of casting rather than as two pipes.

  Conduit density is PER LAYER, since each layer is its own lattice with its own
  capacity; adding layers adds conduit rather than thinning what is there over
  more planes.

  A RUN THAT STOPS GOES INTO A JUNCTION BOX. Not a capped stub and not nothing:
  a rectangular enclosure with a recessed lid, squared to the run entering it
  and long enough to swallow the end of it. It is the one fitting that is not
  optional — couplings and elbows come and go with the fittings slider, but a
  dead end always gets its box, because the thing it replaces is a conduit
  ending in mid-air.

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

Factory — 1940s brick works, panel or whole building
  Two pieces off one generator. WALL is a seamless panel: three storeys by four
  bays of steel industrial sash set into brick, tiling in both axes so the panel
  repeats into an elevation. FRONT, SIDE and BACK are one whole building
  instead — grade at the bottom, a roofline at the top, alpha outside the
  silhouette, and a ground floor that lorries reverse into. The brickwork, the
  sash and the weathering are the same code either way; what changes is whether
  the storey and bay grid wraps.

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
  steel angle or cast stone lintel, pilasters between bays, a belt course at
  every floor line, and the reveal RETURN — the brick that turns the corner and
  runs back into the hole. That last one is small and does most of the work:
  without it the wall has no thickness and an opening is a dark rectangle
  pasted on flat brick.

  As a whole building it also gets what a panel cannot have: an engineering
  brick plinth at grade taking the splash and the rising damp, and a roofline —
  parapet and coping, sawtooth north lights with glazing in the steep face, or
  a raised monitor down the middle.

  And vehicle doors, because a works is a building lorries reverse into. Roll-up
  corrugated slats on guide channels, dented and rusting in the troughs;
  sectional panels hinged together with a row of lites above head height; or a
  pair of braced sliding leaves. Any run of ground-floor bays can be doors, over
  a loading dock with rubber bumpers if you give the dock a height.

  Glass runs from filthy through painted out — the wartime habit — to broken and
  gone, and any pane can be lit from inside, which drives the emissive map.

  Presets: red brick works, sooted mill, whitewashed warehouse and derelict
  plant as panels; works street front, sawtooth shed, loading bay and derelict
  plant back as whole buildings.

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

Grocery — supermarket fixtures, stocked
  The shelving of a shop, seen the way you see it: standing in the aisle, square
  on to a run of it. Everything is dimensioned in real millimetres — a 1219 mm
  (48 in) gondola bay standing 2134 mm (7 ft) on a 560 mm base deck, a 66 x
  122 mm can, a 26 mm ticket rail — and it cuts out on alpha, so it drops onto a
  plane at true scale and the aisle behind shows past the ends. Stand two of
  them facing each other and you have an aisle.

  SEVEN FIXTURES, because a grocery store is not one thing. Dry goods on GONDOLA
  shelving with slotted uprights, a solid base deck and a shelf-edge ticket
  strip. The PRODUCE rack: raked tiers, each shallower and further back than the
  one under it, stocked from slotted crates with a heap of one vegetable in
  each, a mister rail across the top and chalkboard headers. The MEAT multideck:
  a black surround round a well of raked decks, an air-curtain grille along the
  bottom, and a canopy with the department fascia on it and the case light under
  its lip. The DELI service counter: a stainless base with a bumper rail, a lit
  case with gastronorm pans on a raked deck, tilted glass with the sheen running
  down it, and a menu board over the top. The FROZEN reach-in doors: aluminium
  frames, handles, an LED in every mullion and glass with the frost heaviest at
  the seals. An END CAP, stacked and stepped back, one line to a tier under a
  header. And a CHECKOUT lane: belt, dividers, impulse racks either side, the
  till tower and the lane light on its pole.

  ONE SHAPE FOR EVERY PRODUCT. A can, a cereal box, a bottle of squash, a bag of
  crisps, a milk carton, a tub of yoghurt and a tray of mince are the same
  drawing problem: a silhouette that changes width as it goes up, wrapped on a
  cross-section that decides how the light falls across it. So each is two small
  functions — a profile and a section — and everything else about them is
  written once: the shelf shadow, the film sheen, the label, the setback, the
  facings. A can is a straight silhouette on a circle. A bottle is the same
  circle with a shoulder and a neck. A carton is flat with an arris. A bag is a
  soft pillow with a crimped top. Adding a product is adding two lines.

  A SHELF IS A PLANOGRAM, not a scatter. One line gets a BLOCK of facings —
  three tins of the same soup side by side — and the block next to it is a
  different line. That is most of what makes a shelf read as stocked rather than
  as noise, and it is why "how well stocked" and "faced up" are two controls
  rather than one: the first is how much of the run is filled and how many lines
  have sold out, the second is how far forward the stock is pulled and how
  straight it stands. At 1 the shop has just been fronted; at 0 it is Sunday
  evening. A line too tall for the bay it is in is simply not stocked there.

  Packaging is deliberately LOUD. A shelf of muted colours reads as a stockroom
  — brown boxes in rows — so a facing takes a hue off a wheel weighted to the
  colours print likes, a strong version of it for the body, a near-complement
  for the band and a near-white for the label patch, which is what nearly every
  package on a shelf actually is. What goes in a tray or a pan comes off a
  different wheel: meat, cheese and olives are not packaging colours.

  TWO HEIGHT FIELDS, and only one of them is exported. A shelf is nearly all
  relief — product stands 300 mm proud of a fixture 1200 mm wide — and a normal
  map taken straight off that is a page of black cliffs with the labels, can
  rims and crimps that actually read at a distance lost under them. So
  height.png and the 16-bit height carry the TRUE depth, and the normals come
  off a second field: the same surface detail at full strength plus the standing
  depth scaled by the Relief control. Set Relief to 1 and they are one field.

  Nothing here is lettered. At the size a shelf is seen the printing on a
  package is a pale patch with a dark bar in it, and a department fascia is a
  run of blocks on a varying pitch with a space every few words — which is what
  this draws, and it is what keeps the whole mode off the main thread.

  Presets: dry goods aisle, soft drinks, picked over, produce wall, meat
  multideck, deli counter, frozen doors, end cap promotion, checkout lane.

Vent — louvres, grilles, intakes and heatsinks
  Everything that moves air through a surface and everything that throws heat
  off one. Six of them: a weather LOUVRE with the drip lip out and down, a dark
  throat above each blade and mesh behind it; a GRILLE of bars over a plenum,
  vertical, horizontal or egg-crate; a HONEYCOMB intake matrix whose cells run
  back into dark; an INTAKE with a rolled lip, a receding throat, vanes across
  it and a hub; and two HEATSINKS, extruded plate fin and pin fin, seen from
  directly above, which is the only view a texture can honestly give of one.

  Two pieces off the one generator. A seamless FIELD divides the tile into a
  grid of framed panels — a plant-room louvre wall, an endless heatsink — or one
  UNIT with an alpha silhouette, a flange and its fixing screws, to drop onto a
  wall or a hull. The frame is what makes the tiling honest: the field is only
  ever drawn INSIDE a cell, and at the tile edge two half-frames meet across the
  wrap and make exactly the mullion the interior ones are. So the blade pitch,
  the hex grid and the fin count never have to wrap, and none of them has to be
  fudged to make the tile close.

  THE HEAT is the other half. Anything with a deep part can be lit from inside
  it — behind the face, at the roots where a running heatsink is actually
  hottest, or the metal itself. The glow lives in emissive.png in whatever
  colour the core is; past a point it also drags the albedo towards it, because
  a fin hot enough to light its own channels is not still grey.

  Finishes: mill aluminium, anodised, hot-dip galvanised (with the crystal
  spangle), painted steel, bare steel, copper. Bright worn edges, micro
  scratches, dust on the ledges, rust and grime over the lot.

  Presets: plant room louvre, extract grille, honeycomb intake, ram air intake,
  turbine intake, aluminium heatsink, reactor heatsink, pin-fin core, rusted
  extract louvre.

Conduit — the loom behind an access panel
  Undo a row of quarter-turn fasteners, lift the panel off an engine nacelle or
  an equipment bay, and what is behind it is not a thing, it is STRATA — and the
  strata are the subject. A ribbed backplane with flanged lightening holes, in
  shadow. The fat items that went in first: lagged pipe, flexible duct, coolant
  lines. Groups of smaller conduits routed together over them. And on top, the
  things that were meant to be reached.

  A GROUP, NOT A PIPE. Every route carries a BUNDLE: several conduits laid
  parallel at a fixed pitch, riding one path, so the whole ribbon snakes as one
  and on a bend the inner conduits take a tighter radius than the outer ones.
  That difference is most of what tells a loom from some pipes that happen to be
  near each other. Clamps span the whole bundle and cable ties fall between
  them, which is the reason a group stays a group.

  Routes are INTEGRATED rather than plotted: a heading plus a smoothly varying
  turn, with the turn clamped so the curvature never exceeds one over the
  minimum bend radius — a real constraint, and one a loom that violates looks
  wrong before you can say why. Occasionally a route takes a corner, spending a
  stretch turning at the limit, which is what a loom does when it reaches the
  end of a bay. Every run comes from somewhere and goes somewhere: the last few
  centimetres at each end sink away behind the layers below, with a collar where
  they go, rather than stopping in a flat disc in mid-air.

  THE STRATA ARE WORKED OUT, NOT SPACED OUT. A layer's floor is the layer below
  it plus the tallest thing standing on that layer, so every layer clears the
  one under it by construction. Spread evenly through the cavity instead —
  which is the obvious thing, and was the first thing — a 46 mm duct on the
  bottom stratum of a 95 mm bay four layers deep has its crown ten millimetres
  up through the next layer and ten through the one after, so the fat runs stand
  out of the stratum they belong to and the layering, which is the subject,
  never reads. If the stack comes out deeper than the cavity, every gauge in it
  is scaled until it fits, and the readout says by how much: that is the honest
  answer to five layers in sixty millimetres.

  NOTHING ENDS IN MID-AIR. A conduit that stops in the middle of a panel is not
  a conduit; nothing in an airframe ends in nothing. So there are exactly three
  ways a run may finish and every route carries one at each end.

  A run may have NO ENDS. It is constructed as a closed curve with a whole
  number of tiles of winding — P(t) = t·D + Σ A sin(2πkt) + B cos(2πkt), where D
  is the winding — so it leaves one edge, arrives at the other and comes back to
  where it started, exactly, by arithmetic rather than by tolerance. Walking a
  heading and hoping to arrive home does not converge, and steering it home over
  the last stretch leaves a kink at the join that nothing hides. The only thing
  left to control is the shape, and that is the bend clamp: curvature comes
  straight off the same derivatives, so the harmonics are scaled back until the
  tightest point on the loop is inside the minimum radius. Everything that
  REPEATS along such a run is snapped to a whole number over its length too —
  corrugations, the braid helix, jointing collars, clamps, ties, ident bands,
  lamps — because a pitch that does not divide the loop leaves one short measure
  at the join, which is the single thing that gives an endless run away.

  Or it terminates in a JUNCTION BOX: a cast enclosure with a lid, four screws
  and a mounting flange, bolted to the backplane, the conduit entering square
  through a gland and stopping inside. The box is placed BACKWARDS over the run
  rather than beyond it — a run that stopped because something was in the way
  has nothing but taken ground in front of it — so its far face lands on the tip
  and it needs no ground the run was not already occupying. A box has to have
  room to exist: where one will not fit, the run is SHORTENED until it does.

  Or, in a framed bay only, it leaves through the FRAME, which is a bulkhead
  grommet and a real penetration rather than a fade. That is also the last
  resort on a seamless tile when a run can be shortened no further and still no
  box will fit.

  Two enclosures may not stand in the same place, so the boxes keep a claims
  grid of their own that is never cleared; and a box is bolted to the plate, so
  it is in the way of every layer it stands taller than, not only the one whose
  run it terminates. A run may still pass OVER one, which is what runs do.

  HOW A RUN IS ACTUALLY LAID DOWN, because it is the difference between a pipe
  and a pipe with a rash on it. The stamp walks a route's centreline and lays a
  span across it at each step. The span is laid on a texel grid it is almost
  never square to, and it used to be sampled at a fixed one-texel spacing and
  rounded — which is a rotated unit lattice landing on a square grid, and a
  rotated unit lattice does not land one point to a texel. At 45° consecutive
  samples come down TWO texels apart on the diagonal and the texels between them
  are written by nobody, so the backplane shows through in a checkerboard
  straight down the middle of the pipe. A straight run at a fixed angle aliases
  the same way every step and you read it as texture; a BEND sweeps through
  every angle at once, the checkerboard's phase drifts along it, and the whole
  thing reads as moiré. At 1024 px it was one texel in sixty of the conduit.

  So the span is walked on the GRID rather than along the line: one axis at a
  time, from the texel at one end of it to the texel at the other, which visits
  every texel the span crosses exactly once at any angle, for about the same
  number of samples the old spacing was costing. Sampling harder would not have
  fixed it — two samples half a texel apart still round to positions a diagonal
  apart when their fractions straddle the same boundary. And since each texel is
  now visited as itself, the offset it is at comes off its own position rather
  than off how far along the walk it is, so the cross-section is read where the
  texel actually sits.

  AND THE OUTSIDE OF A BEND TRAVELS FURTHER than the centreline the route was
  resampled along. Eight tenths of a texel at the centre carries the far edge of
  a wide bundle eight tenths times (1 + reach / bend radius), which on a flat
  ribbon a hundred texels across, turning through a corner a couple of hundred
  texels round, is well over one — so consecutive spans land more than a texel
  apart out there and leave a TRANSVERSE SLOT between them: a gap cut across
  the cable, widest on the outer side of the turn and closing to nothing on the
  inner. It is a different fault from the rotated lattice and it survived that
  fix untouched. The walk now sub-steps: how far the outermost texel of a span
  actually moves between two route points is the centre's own travel plus the
  reach times how much the normal turned, and the step is divided until that is
  under a texel. A straight run turns not at all and never subdivides, so it is
  paid only where it is needed, and the build time does not move.

  (A route WRAPS, and two points either side of the wrap are stored a whole tile
  apart. Interpolating between those sweeps a span across the picture and leaves
  a long straight scar over empty plate — which is what the first attempt did,
  and what looking at it caught. A real step is one stepM long by construction,
  so anything several times that is a wrap and is drawn as the single span it
  always was.)

  AND NOTHING IN A LAYER PASSES THROUGH ANYTHING ELSE IN IT. Two bundles at one
  height that cross do not read as one over the other — the stamp Z-tests, so
  there is nothing to separate them and the join comes out a lumpy mass. So each
  layer keeps a claims grid: a route marks the ground it takes as it lays it
  down, and every later route in that layer steers around it, the way a person
  dressing a loom does. A route with nowhere left to go ends there, and its tail
  dives under whatever stopped it. Crossing BETWEEN layers is untouched — it is
  what the strata are for.

  Six finishes, and each one is GEOMETRY rather than a decal — the rings, the
  weave and the spiral go into the height field before the normal is differenced
  out of it, so they survive being lit from any direction. Rigid tube with
  jointing collars, corrugated flex, braided hose, spiral wrap, flat ribbon
  (wide and thin, not a slab), and lagged pipe with its cloth and banding.
  Ident sleeving in six colours, whole runs of coloured sleeve, and indicator
  lamps in emissive.

  Two pieces off the one generator. A seamless FIELD is an endless equipment bay
  or hull interior; one framed BAY is a single access opening with a lip,
  fasteners and an alpha silhouette, to drop onto a hull so the hull shows
  through around it.

  THE AO DOES TWO JOBS here. Local occlusion the way every mode does it, AND a
  depth term: how far into the cavity a texel sits, independent of its
  neighbours. A blur cannot see that — a conduit four layers down is dark
  because it is four layers down, not because the texel beside it is higher —
  and without it the strata all read at one brightness, which is the whole
  subject gone.

  Presets: engine bay, wiring harness, hydraulic run, access hatch, reactor
  conduit, crawlspace.

  Capped at 2048: the mode carries an extra word a texel for the stamp, and its
  subject is a panel a few hundred millimetres across, where 2048 is already
  better than three texels to the millimetre.


Raceway — conduit dressed to a lattice, braced at intervals
  The other way a bundle of conduit gets from one end of a machine to the
  other. Not hand-dressed and following the shape of what it passes — that is
  the conduit mode above — but INSTALLED: everything runs along one of two
  axes, every direction change is a right angle, and every right angle is a
  radiused bend rather than a mitre, because conduit does not fold.

  Three things make it read as installed work rather than as pipes. THE
  LATTICE: runs start on a grid and their legs are whole multiples of it, so
  parallel runs line up with each other instead of merely being parallel, and
  the grid is snapped so a whole number of cells fits the tile. THE FILLET: a
  corner is a quarter-circle of a radius you could put on a drawing, and a
  group taking it keeps its pitch, so the inner conduits ride a tighter arc
  than the outer ones and the whole group fans slightly through the turn —
  which is what a real one does and what a mitre can never look like. THE
  BRACE: groups are held at intervals by a spacer comb rather than strapped
  down — a bracket that stands BETWEEN the conduits and posts up at each edge
  of the group, holding them at their spacing without hiding any of them.

  THE BEND RADIUS IS NOT A STYLE SETTING. Below about the group's own
  half-width plus a couple of conduit radii, the innermost conduit's arc turns
  inside out — its centre passes the centre of the turn — and the group crosses
  over itself in the corner. So the radius you ask for is a floor: the widest
  group opens it up as far as it has to, and the readout says so rather than
  quietly ignoring you.

  JUNCTIONS. A run can branch, and the branch is smooth: a child starts at a
  point on its parent CARRYING THE PARENT'S HEADING and then immediately takes
  a fillet, so its conduits leave the group parallel to the ones staying behind
  and peel away through the bend. Started square instead, it would be a pipe
  butted against another pipe.

  AND IT DOES NOT END EITHER. Same three terminations as the loom, and the
  endless one is built differently because a raceway is not a curve, it is a
  CIRCUIT: a cyclic list of axis-aligned moves whose displacement is a whole
  number of tiles across and exactly nothing down. It is constructed
  geometrically — the vertices computed, the quarter circles drawn as quarter
  circles — because the open walk's integrated corners are a hundredth of a
  millimetre out apiece, which does not matter when a run has ends and shows as
  a step at the wrap when it does not. Every leg has to be longer than two
  fillets or consecutive corners eat each other, and on a small tile with a wide
  group the answer is often no corners at all — which is not a failure. A
  straight run across a torus is as endless as anything.

  KEEPING OUT OF EACH OTHER. Same rule as the loom next door — nothing in a
  layer passes through anything else in it — but a raceway cannot swerve, since
  every leg is on an axis and a lean would cost it the only thing it is for. So
  it turns EARLY instead: it sights one full fillet ahead, which is exactly the
  distance it needs in order to have turned by the time it arrives, and when
  that ground is taken the corner it was going to make further along happens
  here, towards whichever side is open. Mid-fillet there is nothing to be done,
  so a run boxed in there ends and its tail dives under what boxed it in. A
  branch is exempt where it leaves its parent: a junction is not a collision.

  Presets: cable tray, cooling manifold, server backplane, bulkhead run,
  reactor spine, braced access panel.

  Same two pieces, same materials, same finishes, same backplane, framed bay,
  strata and claims grid as the conduit mode — all of that is
  modes/lib/loom.js, shared between them. The only thing either mode
  contributes is where the runs go and what holds them: one integrates a
  heading with a wandering turn, the other walks a lattice and fillets every
  corner, and the stamp cannot tell them apart.

Sheet · Plate · Slab — three panels off one generator
  What they have in common is that they are all a PANEL: a piece of material
  with a real thickness, real edges and real fixings, rather than a pattern
  printed on nothing.

  SHEET is a rusted metal sheet and it tiles. Flat, corrugated or box profile
  with the rib pitch snapped to the tile, welded seams with a rippled bead, and
  one fixing per crown per purlin with a bonded washer under the head and rust
  weeping from it. The paint is modelled as a film with HOLES in it rather than
  a layer over rust, because that is the order it fails in: the steel corrodes
  first, the swelling lifts the film, the film breaks away and takes the primer
  with it. That is why its edges are hard and stand a little proud.

  PLATE is one riveted metal panel, cut out. A bevel round the edge, which is
  the only place a plate's thickness ever shows and without which the piece
  reads as a decal; rivets at a pitch SNAPPED to each side so one lands exactly
  on every corner; domed, countersunk, low button or hex bolt heads, each with
  the ring of bruised bare metal the gun left round it; an optional pressed
  stiffening swage and a lap over its neighbour.

  SLAB is one precast concrete panel, cut out. A chamfered arris all round —
  not decoration: a sharp arris in concrete does not survive being lifted —
  smooth, board-marked, ribbed or exposed-aggregate form finish, form-tie holes
  with the mortar that never quite matched and the stain that runs from them,
  lifting sockets with their galvanised ferrules, cracking with the rust of the
  bar behind it, efflorescence, dirt washing down from the top and moss rising
  from the bottom. And BLOWHOLES — the little round craters air trapped against
  the formwork leaves, which are the one detail that says poured rather than
  modelled, and which live almost entirely in the height and the AO.

  Presets: corrugated barn, box profile, welded tank plate, derelict shed; hull
  plate, access panel, bolted bulkhead, wreck plate; precast cladding,
  board-marked, exposed aggregate, ribbed weathered, ruined panel.


COORDINATING ONE BUILDING
-------------------------
The front, the side, the back and the roof are four textures of one house, and
dialling the same twenty settings into four panels by hand is how they end up
not matching. There are two ways round that, for the two situations you are
actually in.

THE WIZARD, for when you do not yet know what the building is. The buttons
beside the mode tabs — "Whole structure: House · Diner · Factory" — walk you
through the
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

AND IT SHOWS YOU THE BUILDING. Opening a wizard opens a "3D building" tab —
only there, because outside one there is no building to draw — and it is what
the wizard starts on. Four walls and a roof, at true scale, standing on a
ground under a sky. Drag to orbit, wheel to zoom, shift-drag to walk the sun
round, and click any wall to go and work on that face.

Two things feed it, and they arrive at different rates.

  THE SHAPE is pure arithmetic. Every mode's plan() already reports the real
  size of the face it would draw, in metres, because that is what writes the
  glTF — so the box follows a slider as fast as you can move it, with nothing
  forged at all. Widen the facade and the building widens; add a storey and it
  grows; set the depth on the side step and the box gets deeper while you are
  still dragging.

  THE SURFACES arrive one face at a time, as each step is actually built. What
  has not been forged yet is drawn as massing — pale, matte, ruled diagonally,
  so it cannot be mistaken for a face somebody chose to make grey.

IT IS THE EXPORT'S OWN GEOMETRY. The scene comes out of the same call, with the
same plans, that writes model.gltf when the wizard packs the archive. That is
deliberate: it is not a second idea of what the building is, so it cannot drift
from the first. If a roof plane floats above a parapet here, it floats in
Blender too — and you find out before you export rather than after. (It has
already earned that: the flat roof quad was wound against its own normal, which
shades correctly in anything reading the vertex normal and turns into a hole in
anything culling back faces. The stage draws the export's scene, so it made a
hole, and the exporter was fixed.)

The step rail marks what exists. A tick is a face forged off exactly the
numbers it would open with now; a recycle mark is one forged off different
ones, because a later step changed something it had inherited. Neither is an
error — a building whose back does not match its front is a legitimate thing to
want — but you should be able to see which you have.

"Forge every face" fills the whole building in at preview resolution in a
couple of seconds. It is the look, not the export.

The last button on that bar packs the lot: every face built at full size, each
in its own folder with its own maps and its own readme, plus a readme for the
building. That is the point of it — the structure leaves as one object rather
than as four exports you have to remember to line up afterwards.

House walks front, side, back, roof. Diner walks front, side, back off one
streamline body, so the bands land at the same heights on each face and the
neon carries round the corner.

No WebGL, no tab: everything else in the wizard works exactly as it did.

THE LINK, for when you already have a house and want to change it. Tick
"Coordinate with..." in any of the house, envelope or roof panels and every
setting those panels share is mirrored across them the moment it changes, in
whichever direction you edit. Turning the link off in any one panel turns it off
in all of them, and every panel keeps whatever it had at that moment.

Neither one carries resolution, and the wizard does not carry the face either:
how many texels you want of a given face is a property of the export, not of the
building, and which face a step is is the one thing that step exists to pin.


TYPEFACES
---------
Some things a texture needs are LETTERS — a tag sprayed on a derelict wall being
the obvious one — and letters want a typeface. Drawn as curly strokes instead,
graffiti comes out as a smear that reads as a stain: the eye knows at once that
nobody wrote it.

THE APP BUNDLES NO FONT, deliberately. This repository carries six graffiti
faces in fonts/, and that directory is already outside the published site — the
Pages workflow uploads texture-forge/ and nothing above it, and it has to stay
that way because the app fetches that directory at runtime from one level up.

None of the six is ours to publish. fonts/README.txt quotes what each one
actually ships with and is the authority; in short, two are personal-use or demo
cuts, one is donationware whose commercial use needs the author's agreement, and
three came with no licence FILE — terms unknown, not terms granted. Their terms
also govern what you do with a texture you export with them, not just whether
the files ship. Copying them in beside index.html would publish all six.

So a face arrives one of three ways instead:

  dropped in     the reliable one. "Load…" beside the face picker takes a
                 .ttf/.otf/.woff and registers it straight from its bytes.
                 Nothing is fetched, nothing is published, and it works on the
                 hosted copy exactly as it does locally.
  found locally  from the repository ROOT — say `python3 -m http.server`
                 there, then open /texture-forge/index.html — the six in
                 fonts/ are one directory up and load on their own. Opened
                 straight off disk as a file:// page they still loaded in
                 the Chromium these checks run in, which lets a page read a
                 directory above its own; Firefox and Safari confine a
                 file:// page to its own directory and are expected to
                 refuse, which nothing here can test.
  not at all     on the hosted copy they are not there. It fails quietly and
                 the mode falls back to what it did before.

A face registered there is available to every mode, so the next one that wants
lettering does not have to solve this again.


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
Base colour, normal, roughness, metallic, AO, height, ORM (packed) and the
UNLIT BAKE — see below — plus per-mode extras: a markings alpha decal (street),
a paint alpha decal and material ID (hazard), material ID / emissive / opacity
(house and envelope), material ID / opacity / an infill mask (fence).
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


THE UNLIT BAKE
--------------
A PBR set is a description of a material. It says how the surface answers
light, and it needs a renderer holding a light to mean anything. Plenty of work
has no renderer holding anything: a retro or stylised target, a sprite sheet, a
low-end platform, an engine set to unlit or emissive, a viewport with no
lighting rig at all. So every mode also exports unlit.png — the whole material
with one lighting solution already frozen into the colour.

It is the SAME shading model as the lit preview: GGX specular, Smith
visibility, Schlick Fresnel, a two-colour hemisphere ambient, AO, emissive,
Reinhard and gamma. That is deliberate. A bake computed some other way would be
a second opinion rather than a render, and you would have no way to judge it
before exporting it.

What it does NOT share is the preview's light. The preview light is a thing you
drag to inspect a surface — it moves constantly and has no numbers on it. A
bake is an artefact you ship, so it gets its own controls, on their own bar
that appears when you select the Unlit tab:

  key           direction in degrees, azimuth and elevation, and an exposure
  ambient       an amount, plus the sky colour and the ground bounce under it
  surface       how hard AO bakes in, and how much specular to allow
  grade         contrast and saturation, applied after the curve
  retro         the bake's OWN palette, dither and amount

That last one is separate from the palette bar above it on purpose. "Quantise
the albedo" and "quantise the pre-lit map" are different decisions, and a
full-colour base colour feeding a sixteen-level pre-lit map is a thing people
want — one shared setting cannot say it. It defaults to off.

The settings are written into the zip's readme, so a bake can be reproduced
from the file six months later.

Two things worth knowing:

- MORE AMBIENT THAN LOOKS RIGHT. A strong key and little ambient is punchy on
  screen and wrong in a bake: every texel facing away from the key goes to near
  black and STAYS there, because on an unlit target no fill light is coming
  later to open it up. The defaults carry more ambient than the preview does.

- IT IS NOT A REPLACEMENT FOR basecolor.png. Feeding a baked map into a lit
  shader lights it twice. Use one or the other.

Nothing in a mode declares it. The channel is added centrally, because it is
derived from maps every mode already produces — base colour, normal, roughness,
metallic, AO and whatever emissive it has — and a mode that had to remember to
declare it would eventually be a mode that forgot. Where a mode writes its own
emissive ramp, the bake reads THAT, so a heatsink glowing orange and a sign
glowing green bake in their own colours rather than in a guess at them.


THREADS AND THE GPU
-------------------
Two things moved off the thread that draws the page.

WORKER THREADS. A generator is a per-texel loop over typed arrays and has no
business on the thread that is also trying to keep a slider moving. It runs on
a worker now (forge-worker.js), and the difference is not subtle — measured on
a four-core machine, a 2048-square factory build:

               frames drawn   worst stall   95th-percentile frame
  main thread       137          4.95 s            119 ms
  a worker          681          0.52 s             17 ms

Same eleven and a half seconds of work either way. A BUILD IS NOT SPLIT ACROSS
THREADS: every generator is a sequential row loop, and banding one would mean
rewriting sixteen of them. What is parallel is whole builds — and the place
that matters is a structure, where the four faces of a building go out to the
pool together instead of queueing. That comes out at about 1.5x on four cores;
the PNG encoding and the zipping are still one thread and are most of what is
left.

A mode opts in with `threadable`, which may be a function of its parameters.
Two say no conditionally: the graffiti faces and the diner's neon sign are
drawn with typefaces registered against the DOCUMENT, and a worker cannot see
one — off thread those builds would come back subtly wrong rather than merely
late. The pool also cannot exist at all on file://, where a worker has no
origin, so every path ends in "do it on the main thread instead", quietly.

Worker builds are checked against main-thread builds byte for byte by the
feature test, which is the only claim about them worth making.

THE GPU. The generators are sixteen hand-written per-texel loops in JavaScript
and none of them has been ported to GLSL — that is a different piece of work.
What HAS moved is the one heavy thing every mode does identically at the end:
turning the finished buffers into images. That was a JS loop over every texel
of every channel, which for a 4096-square house with ten channels is a hundred
and sixty million iterations per export, plus the chip strip, plus a pass for
every preview upload while you drag. It is now a fragment shader
(forge-gpu.js), and the buffers upload straight from the typed arrays they
were built in — A and NRM are already tightly packed RGB8, the single channels
are R8, the height field is R32F — so there is no CPU pass to prepare the CPU
pass being removed.

WHICH PATH IS FASTER IS A PROPERTY OF THE MACHINE, so the two are raced once,
at a real export size, on the machine actually running them, and the answer is
kept against that machine's renderer string. A software WebGL implementation —
SwiftShader, llvmpipe — is the same CPU running a rasteriser instead of
running the loop, and loses badly, so those are ruled out by name before the
race. The line under Channels says which path is live.

A channel a MODE writes itself stays on the CPU, because it is arbitrary
JavaScript. So does a palettised base colour, because the quantiser wants the
pixels back and reading them back would give away what was gained. The unlit
bake goes back to the CPU for both of those reasons: whenever its own palette
is on, and whenever the mode owns the emissive ramp the bake is reading, which
the shader cannot know about.

The GPU output is checked against the CPU output byte for byte. Two channels
are allowed to disagree slightly, because they are the only two doing
arithmetic rather than copying, scaling and rounding: the height field by one
least-significant bit (a float divide on the GPU against a double one in JS),
and the unlit bake by two (pow, sqrt and a divide, and a GPU's highp float is
not a double). In practice both come in well under that — the bake differs on
about three bytes in a quarter of a million, by one.

The bake's real constraint is not precision, it is knowledge. Where a mode
writes its own emissive ramp, the shader has no way to know what that ramp is,
so the bake for that mode is rendered on the CPU. That is most of the modes
here, and it is the reason the packer's parity check runs over two of them: one
that owns its emissive and one that does not, since only the second is a case
the GPU ever actually renders.


MICRO DETAIL
------------
The house, envelope, factory and diner modes each end with one more pass that
looks at a texel's NEIGHBOURS rather than at the texel. Three things live
there, and none of them can be seen from inside a per-texel loop:

  Dust on the ledges     dust, soot and worse settle on anything that faces
                         up — a sill, a belt course, a coping, the top of a
                         door canopy, the flat of a band. The generator does
                         not know it drew one; the height field does. A texel
                         is on a ledge when it stands proud of the wall just
                         above it, which is one sliding window down each
                         column and nothing else.

  Edges & crevices       an arris that has been knocked about catches the
                         light and a joint beside it holds dirt. Both come
                         straight off the curvature of the height field —
                         positive where the surface is locally convex,
                         negative where it is concave.

  Fine tooth & flecks    the grain under everything, in ROUGHNESS only, plus
                         the dark and pale flecks in any real material. It
                         costs nothing in the normal map and it is most of
                         what stops a large flat area reading as a rendered
                         plane.

Every field in that pass is held so its finest octave stays several texels
wide. Value noise doubles its lattice per octave, so a base period of 300 over
three octaves lands its finest cells at about one texel of a 1024 map — and a
cell that small does not read as grain, it reads as square blocks.

The generator is shared: modes/lib/micro.js.


GEOMETRY OUT
------------
Every zip also contains model.gltf, model.obj and model.mtl: the surface as
something you can import, at true scale in metres, with the maps already wired
to it.

  model.gltf   glTF 2.0. Blender: File > Import > glTF 2.0. This app is a
               natural fit for the format — glTF reads roughness from the green
               channel of one image and metallic from its blue, and occlusion
               from that same image's red, which is exactly what orm.png
               already is. One image, three slots, nothing to repack. Cut-out
               faces arrive with alpha clipping on.
  model.obj    the same geometry for anything that does not read glTF.
  model.mtl    OBJ cannot address one channel of an image, so this points at
               roughness.png and metallic.png instead of the packed one.

Both are written Y-up, which is glTF's own convention and the default Blender's
OBJ importer expects, so the two land in the same orientation and a wall
arrives standing up.

A single mode exports a single plane. A STRUCTURE — the House, Factory or
Diner buttons in the top bar — exports the building: four walls off three
elevations (the two sides are the same elevation seen from opposite ends,
which is what the wizard's side face is), and a roof on top. The roof sits at
the EAVES rather than at the top of the silhouette, because a parapet or a
gable is drawn into the wall texture; put the plane at the top and it floats
above the building it belongs to. Where there is a gable, the ridge is taken
from the gable face's own silhouette so the plane closes the triangle exactly
rather than leaving a slot of daylight.

A cut-out face is a flat plane with the silhouette punched into its alpha.
That is deliberate: the roofline is part of the texture, so the plane carries
it without any geometry. It reads correctly from any angle you would
photograph a building from, and it is a flat plane if you walk round the
corner.

Two modes do not declare a real-world size — plating and ruins are scaled in
texels rather than in metres — so they export a one-metre plane and the model
readme says so rather than pretending.


USING IT
--------
- The tabs along the top switch mode. Each keeps its own settings, and the URL
  follows, so index.html#house opens straight into the house mode. At sixteen
  modes the strip is a way of getting BACK to one rather than of finding one,
  so there is also a browser: the Modes button, or K, or ctrl/cmd-K. It is the
  same list grouped and described, and it searches the blurbs — "neon" finds
  the diner, "hex" finds the vent, "rust" finds three of them.

- Every slider's number is an INPUT. Click it and type. All of these are real
  dimensions and somebody may have the number on a drawing in front of them;
  dragging to 4.35 when you want 4.40 is the worst thing about a slider. A
  typed value is held to the control's range and snapped to its step, exactly
  as dragging is — the slider stays the single source of truth for a parameter
  — and the box is rewritten with what it landed on when you leave it, so what
  you see is always what the generator got.

- A big mode carries forty controls behind eight collapsed groups. The Find
  box at the top of the panel filters them by name; / jumps to it.

- Keys, none of which fire while you are typing in a field: K browses the
  modes, P shows or hides the control panel, B or Enter builds, / finds a
  control, [ and ] step through the channel views, Esc closes the browser.

- Drag the divider between the panel and the preview to resize it; double-click
  it to put it back.

- ON A PHONE it is three panes and a tab bar rather than a panel beside a
  preview: Controls, Preview, Export. A forty-control panel and a preview
  cannot usefully share a phone screen, and stacking them just means scrolling
  past one to reach the other. The panes that are off screen are not unmounted,
  so the preview keeps its build and switching back is instant. Pressing the
  build button from the Controls pane takes you to the Preview, because that is
  what you asked to see. The structure buttons move into the mode browser,
  which is where you go to choose what to make anyway.

- Everything sized for touch is behind a pointer query rather than a width one,
  so a touchscreen laptop gets the big targets and a narrow desktop window does
  not.

- Switching back to a mode you have already built shows the previous result
  without regenerating it. Results above 1024 px are dropped when you leave
  the mode rather than held in memory, so they rebuild on return.

- A preset button describes a whole thing, not a patch on what was on screen:
  every control goes back to its declared default first and then the preset is
  applied. Only the seed, the resolution and which face you are on survive it,
  because those belong to the export rather than to the thing being described.

- A face's height follows its real proportions, not the resolution slider — a
  three-storey gable end can be four times taller than it is wide. Where the
  full width would make an image too large to hold in memory, the width comes
  down until it fits and the size line says so, rather than the tab dying.

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
is why index.html is the landing page, and why fonts/ stays out of the published
site. Not because the app ignores it — it fetches it at runtime from one
directory up — but precisely because it does not own those files. The upload
boundary is what keeps them unpublished, so it is load-bearing: moving fonts/
inside texture-forge/ would put all six on a public URL.

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
that each structure wizard carries its settings forward, marks what it
inherited, refuses to carry the resolution, and packs every face into one
archive, and that graffiti draws through both of its paths — a real typeface
where one is registered, and the scrawl fallback, which is otherwise exercised
by nothing because the local faces load.

It also covers the thirteen things that are easy to break silently:

  chrome    a typed value reaches the parameters and is clamped and snapped,
            the control filter hides what does not match, and the mode browser
            searches the blurbs rather than only the names
  threads   the pool comes up, every mode has an opinion about threading, and
            a worker build is the SAME BUILD as a main-thread one — byte for
            byte, from the same parameters. This section serves the directory
            over http for its own length, because a worker cannot be reached
            from file:// and the rest of the suite stays there on purpose.
  gpu       the GPU channel packer's output matches the CPU path byte for byte
            (the height field is allowed one least-significant bit, which is a
            float divide against a double one, and the unlit bake two, which is
            pow and sqrt; both come in under it), and a software renderer is
            never offered as a fast path. It runs over a mode that writes its
            own emissive ramp and one that does not, because the bake only
            reaches the GPU in the second case
  model     a mode's plan() is in METRES whatever it counts in — a house is
            about eight metres wide, not eight — and the glTF a building
            produces stands on the ground with its roof closing the gable
  bake      the unlit channel is on every mode exactly once, it answers its
            OWN key rather than the preview's (a stale closure here is silent
            and total), it is a render rather than a tone curve on the albedo,
            and its palette quantises the bake while leaving base colour alone
  conduit   the loom spreads through the whole cavity instead of stacking in
            one plane, the seamless piece wraps, and the framed one is opaque
            in the middle — the check that catches a silhouette seeded at zero
            rather than −1, which makes a whole piece a uniform ghost. The wrap
            is measured against a DELIBERATELY WRONG PAIRING of rows rather
            than a multiple of a handful of interior ones: a fixed multiple
            measures how busy the mode is more than whether it closes, and a
            loom is quiet plate with a few busy rows through it, so any row
            carrying a run along it clears that bar, seam or no seam
  greeble   a second conduit layer is a second HEIGHT rather than a painting
            order, and it carries conduit standing above anything a flat build
            can reach
  ends      nothing is left ending in mid-air. THE COUNT COMES OFF THE BUILD
            rather than off the picture: whether a loop closed and whether a
            box had room are decided while a run is being laid, and no amount
            of measuring the height field afterwards recovers it — a box's area
            depends on the bundle it swallows and on how long the run got, so
            an area is as much a measure of what size things came out as of how
            many there are. So the build carries a census (which also goes into
            the exported readme, because what is in the picture is part of what
            the picture is), and the check asserts the invariant on it: every
            end of every open run is a box, a bulkhead grommet or a breakout
            where a branch leaves its parent, and almost all of them are boxes.
            Then that the boxes are real objects and not just a flag —
            A JUNCTION BOX IS THE ONLY FLAT THING IN THE PICTURE, since every
            other surface a loom has is curved and a conduit's crown falls a
            thirtieth of a millimetre a texel, so counting dead-flat plateaux
            counts lids. Greeble is checked differently: with its fittings
            slider at zero there are no couplings and no elbows, so anything
            standing above a bare pipe's crown is a box — and there has to be
            one, because a dead end is the one fitting that is not optional
  strata    the two guarantees the loom library exists for, on both routing
            models: that a layer's floor clears the crown of the layer under
            it, and that nothing in a layer passes through anything else in it.
            The second is TOPOLOGICAL, because it has to be — the stamp
            Z-tests, so a crossing at one height leaves no extra relief to
            measure, only a MERGE — so it builds one layer of eight single
            conduits on a flat backplane and counts the islands standing above
            the layer floor. Separate runs leave six or seven; fused, and
            measured on the code before this change, they leave exactly one.
            The claims grid and the stack are also exercised directly
  raceway   the runs really are axis-aligned, measured against the wandering
            mode next door rather than against a number picked out of the air,
            since "how orthogonal is this picture" has no absolute scale; and
            the bracing reaches the HEIGHT field rather than only the
            parameters
  stage     the wizard's 3D building is the BUILDING: its box is as wide as the
            front's plan says and as deep as the side's, four walls and a roof
            stand on a ground, and both sides come off the one side elevation.
            The shape follows a dimension slider with nothing forged — and the
            slider is FOUND rather than named, by asking each structure's plan
            which of its controls widens the face, because a hard-coded list
            picks the factory's panel tile instead of its elevation. Then that
            walking the steps puts each face on the building, that the rail
            says which faces were forged off numbers a later step has since
            changed, that a wall in the middle of the view is pickable, and
            that leaving takes the building and the tab away with it. And, over
            every structure's scene, that EVERY TRIANGLE IS WOUND TO AGREE WITH
            THE NORMAL IT DECLARES — which is how the flat roof quad was found
            to be wound backwards: correct in anything shading off the vertex
            normal, a hole in anything culling back faces
  raster    the loom's span leaves no holes in the run, against BOTH of the two
            faults that put them there. ACROSS: the span is laid on a grid it is
            almost never square to, and sampled at fixed spacing and rounded, a
            rotated span does not land one point to a texel — at 45° consecutive
            samples come down two apart on the diagonal and the texels between
            them are written by nobody, which swept round a bend reads as moiré.
            ALONG: the route is resampled at its centreline, so the outside of a
            bend travels further than a step and consecutive spans leave a slot
            cut across the cable. Two measures, because one metric could not see
            both. A PIT — a texel a fifth of the relief below EVERY one of its
            eight neighbours — catches the first; nothing in the mode draws a
            one-texel hole in the middle of a pipe. A GAP ALONG THE RUN catches
            the second, off the tag the stamp already keeps: the same route, at
            the same place across it, on both sides of something that is not
            that route. The honest sliver of plate BETWEEN two pipes of a bundle
            fails that test on the across byte, which is what makes it a
            property and not a proxy. Checked on conduit, raceway and greeble,
            and at 256, 512, 1024 and 2048 px, because the first fault was the
            span's spacing against the grid and that is what a resolution
            changes
  grocery   every fixture builds and survives 128 px; the box is the
            millimetres it claims, bays times bay width, in metres; stock
            follows the stock control; SHORT STOCK SURVIVES, which is the
            defect that had a chiller deck of 50 mm trays looking unstocked
            because the shelf fascia was drawn over the top of them; the two
            height fields really are two, so the height map carries the same
            true depth at either Relief while the normals do not; and it glows
            only where there is a lamp — a dry goods bay has no light in it and
            a chiller case has its canopy

  node tools/feature-test.mjs               # all of them
  node tools/feature-test.mjs palette       # one of them
  node tools/feature-test.mjs threads gpu   # or several

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
