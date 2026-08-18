TEXTURE FORGE
=============

One procedural PBR texture tool, one tab per surface. Open index.html in a
browser — no install, no build step, no network needed. Everything runs
locally in the page.

Keep the folder together: index.html loads forge-core.js and the files in
modes/. Opening index.html on its own gives you an empty app.

Every mode previews with a real-time GGX lit view (drag to move the light) and
exports a full PBR set as PNG, individually or all at once as a .zip.

  index.html          the app
  forge-core.js       shared runtime: panel, preview, export, zip
  modes/street.js     asphalt and street layout
  modes/plating.js    seamless riveted aircraft skin
  modes/house.js      American house front elevation
  modes/_template.js  a worked example mode, off by default
  ADDING-A-MODE.md    how to write a fourth one


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


EXPORTED MAPS
-------------
Base colour, normal, roughness, metallic, AO, height, ORM (packed), plus
per-mode extras: markings alpha decal (street), material ID / emissive /
opacity (house). Each zip also contains a 16-bit height PNG and a readme
giving the real-world size of the tile so displacement comes out true to life.

File names carry the mode, seed and size, so exports from different sessions
never collide: street_cross_1963_2048_normal.png, panel_1947_1024_orm.png,
house_1912_1024x1300_basecolor.png.

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


HISTORY
-------
This replaces the four separate tools in texture-toolkit.zip. street-forge,
panel-forge and elevation-forge are now the street, plating and house modes;
their generators are unchanged, so the same seed and settings give the same
pixels as before, and exported file names are unchanged. asphalt-forge was
already superseded by street-forge and has not been carried over.
