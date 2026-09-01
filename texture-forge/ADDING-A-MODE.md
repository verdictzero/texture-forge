# Adding a mode

A mode is one surface generator: street, plating, house. The runtime
(`forge-core.js`) owns everything around it — the tab bar, the control panel,
parameter reading, presets, the lit preview, the channel views, the chips, the
PNG/zip/16-bit export. A mode supplies the parameters it wants, how big the
output is, and a function that fills typed arrays.

Adding one is two steps:

1. Copy `modes/_template.js` to `modes/<yourmode>.js`, change `id`, and write
   your generator.
2. Add `<script src="modes/<yourmode>.js"></script>` to `index.html`, after
   `forge-core.js`.

Nothing else in the app changes. Tab order follows script order.

`modes/_template.js` is a complete working mode (a plaster wall) rather than a
stub — read it alongside this file. To see it running, uncomment its script tag
in `index.html`.

---

## The mode object

```js
Forge.register({ id:"mymode", label:"My mode", /* … */ });
```

### Identity and chrome

| key | type | meaning |
|---|---|---|
| `id` | string | unique; also the deep link (`index.html#mymode`) and the DOM id prefix |
| `label` | string | text on the mode tab |
| `blurb` | string | tooltip on the mode tab |
| `title` | HTML | panel headline, e.g. `'Surface <em>Course</em>'` |
| `tagline` | string | line under the headline |
| `actionLabel` | string | the build button ("Lay surface"); lower-cased when it appears mid-sentence |
| `busyLabel` | string | status while building ("Laying…") |

### Behaviour

| key | default | meaning |
|---|---|---|
| `seamless` | `false` | output tiles: shows the 1×/2×/4× buttons, repeats in the preview, mipmaps the textures |
| `backdrops` | `false` | show the dark/sky/checker buttons — for modes whose output has an alpha cut-out |
| `flipPreviewY` | `false` | flip V in the lit preview (a facade is drawn with y up in world terms) |
| `previewSize` | none | width in px of the cheap build made while a slider is dragged; omit for no drag preview |
| `chipSource` | `176` | source width the channel chips are rendered at |
| `height16` | `true` | offer the 16-bit height PNG and include it in the zip |
| `preview` | see below | lighting constants for the GGX preview |

```js
preview:{gain:3.2,amb:1.15,specK:0.55,skyLo:[0.13,0.15,0.19],skyHi:[0.30,0.34,0.42]}
```

`gain` scales the direct light, `amb` the sky term, `specK` the specular
horizon rolloff, `skyLo`/`skyHi` the ambient gradient by normal Z.

**`seamless` and `backdrops` may be functions of the parameters** when one mode
produces more than one kind of output — the envelope mode draws cut-out wall
elevations and tiling roofs from the same panel:

```js
seamless:P=>P.face==="roof",
backdrops:P=>P.face!=="roof",
```

They are resolved once per build and read back from the build, never from the
live form, so the chrome always describes the texture actually on screen.

`seamless` and `backdrops` are independent, and both may be true at once — a
fence tiles along the run *and* is a cut-out, so it wants the tile buttons and
the backdrop buttons together.

One caveat if your mode tiles: WebGL1 cannot repeat or mipmap a
non-power-of-two texture. The runtime falls back to clamping rather than
rendering black, but the 2×/4× preview then shows a single tile — so keep
`previewSize` and every `size()` result a power of two in a seamless mode.

A seamless tile does **not** have to be square, only power-of-two on both
axes, which is what lets the fence mode hold a whole number of bays across
while reserving whatever height the fence needs: its tile height is
`k × width` with `k` a power of two, and the leftover is sky at unchanged
density rather than a stretched fence. The flat channel views repeat at the
texture's own aspect, so they agree with the lit view at every `k`. If you do
this, remember that both edges of the long axis have to wrap too — the fence
does it by making the top and bottom rows of the tile guaranteed-empty air and
writing the same constants into every fully transparent texel.

### Channels

```js
channels:[
  {key:"basecolor",label:"Base colour"},
  {key:"metallic",label:"Metallic",tab:false},   // exported, but no preview tab
  …
]
```

Order sets the chip order, the tab order and the zip order. `tab:false` keeps a
channel out of the view tabs while still exporting it — use it for a channel
that is flat by design. The first channel is what the app falls back to when
the browser has no WebGL.

These keys are written for you if the corresponding buffer is present:
`basecolor`, `normal`, `roughness`, `metallic`, `ao`, `height`, `orm`,
`opacity` (needs `ALP`), `emissive` (needs `EMI`). Anything else needs a
writer — see **Custom channels**.

**Do not declare `unlit`.** The unlit bake is appended to every mode's channel
list by `Forge.register`, because it is derived from maps you already produce —
base colour, normal, roughness, metallic, AO, and whatever emissive you have —
and a mode that had to remember to declare it would eventually be a mode that
forgot. Declaring it yourself is harmless (the registry checks) but pointless.

Two things you *can* do for it:

- Write a good `AO`. On an unlit target the AO map is doing the work that
  ambient occlusion, contact shadow and every other runtime darkening trick
  would otherwise do, and the bake gives it its own amount so people can push
  it. A mode with a lazy AO bakes flat.
- If you write your own `emissive` writer (see **Custom channels**), the bake
  reads *that* rather than the runtime's default ramp, so your glow bakes in
  your colours. The cost is that the channel falls back to the CPU path for
  your mode, since the GPU packer cannot know what your writer does.

### Controls

```js
controls:[
  {title:"Output",open:true,rows:[ … ]},
  {title:"Crossings",id:"gCross",need:["cw","int"],rows:[ … ]}
]
```

A group with `need` is hidden unless `needs(P)` returns one of those keys. Row
types:

The resolution row is the one control every mode has, so the ladder lives in
one place rather than thirteen:

```js
{id:"size",type:"select",label:"Resolution",value:1024,showValue:true,
 options:Forge.sizes("square")}     // "square" -> "512 × 512"
                                    // "plain"  -> "512"        (height follows the content)
                                    // "wide"   -> "512 px wide"(dimensioned by its width)
                                    // Forge.sizes("square",2048) caps the ladder
```

It runs 64 to 4096. The small end is for pixel art, alongside the palette and
nearest-neighbour controls in the preview bar — so a new mode should keep the
house habit of snapping feature counts to whole numbers per tile and DROPPING a
feature that falls under a couple of texels rather than aliasing it, and of
naming what it dropped in `readout(P)`.

```js
{id:"tileM",label:"Tile covers",unit:"m",min:0.5,max:24,step:0.5,value:2}   // range (default)
{id:"piece",type:"select",label:"Piece",value:"none",options:[["none","Plain"],["cross","Cross-section"]]}
{id:"seed",type:"seed",value:1963}                                          // number + Roll
{type:"colors",label:"Bitumen · stone",items:[{id:"cBitumen",value:"#2b2b2c"}, …]}
{type:"checks",items:[{id:"flipG",label:"Flip green (DirectX)",value:false}]}
{id:"sign",type:"text",label:"Word",value:"OPEN",placeholder:"anything",maxlength:24}
{id:"face",type:"font",label:"Typeface",value:"auto"}   // see Lettering below
{type:"readout"}                                    // filled by readout(P)
{type:"note",html:"Standing text."}
```

Any row can carry `need:"kerb"` to hide it the same way. A select whose option
values are all numeric reads back as a number, otherwise as a string. Ranges
display with the decimal places implied by `step`. Add `showValue:true` to a
select to echo its value in the label.

Every control id must be unique within the mode; in the DOM it becomes
`<modeid>--<controlid>`, so two modes can use `size` and `seed` freely.

Two ids are conventional and the runtime does lean on them: `size` (the build
size — anything over 1024 waits for the button instead of auto-rebuilding) and
`seed` (shown in the status line).

### Presets

```js
presets:[{id:"wet",label:"Wet night",set:{tileM:4,wet:0.75,puddles:0.7}}]
```

`set` is control id → value; anything not listed keeps its current value, which
is how the originals behaved.

### Parameter hooks

```js
derive(P,ui)      // clamp or fix up parameters; ui.set(id,value) writes back to the form
needs(P)          // -> ["road","kerb"]; drives row and group visibility
readout(P)        // -> HTML for the {type:"readout"} row
tileTag(P)        // -> the note in the bottom right of the stage
sizeTag(P)        // -> extra status text, e.g. "2 m"
autonote(P)       // -> override the line under the build button
```

All are optional.

### Size and build

```js
size(P,preview)   // -> {w,h}. Called with preview=true for the drag preview.
build(P,io)       // fill buffers, then io.done(B)
```

`io` carries `{W,H,preview,progress(t),done(B)}` where `W`/`H` are what `size()`
returned. Report progress 0→1 and call `done` exactly once. Work in bands with
a `setTimeout` between them — a synchronous loop over a 4096² tile freezes the
tab and the progress bar with it:

```js
const band=Math.max(8,Math.round(65536/S));
let y=0;
function pass1(){
  const end=Math.min(S,y+band);
  for(;y<end;y++){ /* … */ }
  if(y<S){io.progress(y/S*0.7);setTimeout(pass1,0);}
  else{io.progress(0.75);setTimeout(pass2,0);}
}
```

`B` is a plain object of typed arrays, all `W*H` long (`A` and `NRM` are
`W*H*3`):

| field | type | required |
|---|---|---|
| `A` | `Uint8ClampedArray` RGB | yes |
| `NRM` | `Uint8ClampedArray` RGB | yes |
| `RGH`, `MET`, `AO` | `Uint8ClampedArray` | yes |
| `HGT` | `Float32Array` | yes |
| `hMin`, `hMax` | number | yes — the height range, used by the 8/16-bit height maps |
| `ALP` | `Uint8ClampedArray` | only for cut-out modes |
| `EMI` | `Uint8ClampedArray` | only if something glows |
| anything else | | whatever your custom writers need |

### Threading

```js
threadable   // true, false, or a function of P
```

Set it and your generator runs on a worker instead of on the thread drawing the
page. Nothing else changes: the runtime hands your `build(P, io)` the same `io`
and takes the same `B` back through the same `done`.

What you must be sure of is that your generator produces the **same bytes**
either way. The worker has `window` aliased to `self`, and a `document` that
returns an `OffscreenCanvas` from `createElement("canvas")` and throws for
anything else — so shape rasterisation is fine. What is NOT fine is anything
that depends on the page: a typeface registered against the document is
invisible to a worker, and a build using one would come back quietly different
rather than merely late. That is why `house`, `envelope` and `diner` declare a
function rather than `true` — they say no when there is lettering on the build.

The feature test compares a worker build against a main-thread build byte for
byte, so if you get this wrong it will say so.

### Real-world size, and the geometry export

Optional, but do it. Declare `plan(P)` and every zip your mode produces gains
`model.gltf`, `model.obj` and `model.mtl` — a plane at the size you actually
drew, with your maps already wired to it, so the export lands in Blender at true
scale instead of as nine PNGs and a paragraph about what to scale a plane to.

```js
plan(P)   // -> {w, h, cutout, eaves, tile, roof}
```

**`w` and `h` are METRES, always**, whatever unit the mode itself thinks in —
the house and the diner work in feet, the roof in inches, the vent in
millimetres, and each of them converts here. This is the single easiest thing
to get wrong and it is the one thing the feature test checks by value rather
than by shape.

| field | meaning |
|---|---|
| `w`, `h` | the real size of the face or of one tile, in metres |
| `cutout` | true if `A`'s alpha is a silhouette — the material gets `alphaMode: MASK` |
| `eaves` | where the walls stop and a roof would start; defaults to `h` |
| `tile` | for a tiling material, the repeat size, so a roof plane can be given UVs that repeat at true size rather than stretching one copy |
| `roof` | only the FIRST face of a structure needs this: `{kind:"flat"\|"gable", pitch, ridge:"x"\|"z"}` |

A mode with no `plan()` still exports; it gets a one-metre square and the
model readme says so, which is better than geometry that quietly lies about
its scale.

The wizard uses the same hook for a whole building: the front and back at their
own widths, the side elevation used twice because that is what the two sides of
a building are, and the roof sitting at `eaves`. See forge-model.js.

**And `plan()` is what the wizard's 3D view draws.** The stage
(forge-stage.js) builds its scene from the same `ForgeModel.buildingScene`
call, off the same plans, that writes `model.gltf` — so a mode in a structure
gets a live 3D building for nothing, and gets it *before* anything is forged,
because `plan()` is arithmetic rather than a build. Two consequences worth
knowing:

- **Your `plan()` had better be cheap and side-effect-free.** It is called for
  every step of the structure on every nudge of a slider. Compute geometry,
  return numbers; do not build anything.
- **If it lies, you can see it lie.** A face whose declared width does not
  match what it drew makes a box that does not close. That is the point of
  drawing the export's own geometry rather than a second idea of it.

### Custom channels

```js
writers:function(B,P){
  return {markings:function(i,o,k){
    o[k]=236;o[k+1]=235;o[k+2]=230;
    return B.MK[i];                 // the return value is the alpha
  }};
}
```

`i` indexes the source texel, `o`/`k` are the destination `ImageData` array and
offset. Return the alpha byte. Writers are resolved once per build, not per
texel, so a custom channel costs no more than a built-in one.

### Export text

```js
fileBase(P,W,H)   // -> "street_cross_1963_2048"; the runtime appends _<channel>.png, .zip, _readme.txt
readme(P,info)    // -> the text file packed into the zip
```

`info` is `{W,H,hMin,hMax,normalNote}`, where `normalNote` is already phrased
as "OpenGL (green up)" or "DirectX (green down)" from `P.flipG`.

---

## Sharing code between modes

Two modes that are really one generator belong in `modes/lib/`. The house and
envelope modes are the worked example: `modes/lib/house-shell.js` holds the
whole facade generator plus the control groups and presets they have in
common, and each mode file is a thin registration over it —

```js
Forge.register({
  id:"house",
  presets:Shell.PRESETS,
  controls:[ /* the groups only this mode has */ ]
    .concat(Shell.controls(["cladding","openings","glass","weathering"])),
  size:function(P,preview){return Shell.size(P,"front",preview);},
  build:function(P,io){return Shell.build(P,io,"front");}
});
```

A library does not have to be a whole generator. `modes/lib/quilt.js` is the
other shape: one piece of geometry — a subdivision of the tile into rectangles
that wraps — shared by two modes that look nothing alike, the hull mode drawing
it as a sheen pattern a millimetre deep and the greeble mode extruding it into
blocks. It is worth pulling out precisely because getting it to wrap is fiddly
and getting it wrong is subtle: see the note in that file about why the carving
is shifted off the tile edge.

A library is a plain script that publishes one global (`window.HouseShell`,
`window.RoofGen`, `window.Quilt`) and is listed in `index.html` **before** the
modes that use it. Two rules earn their keep:

- **Latch your state per build.** A library with module-level parameter state
  is re-entered by the other mode's readout on every keystroke, and builds run
  in bands across `setTimeout`. Capture what the build needs at the top and
  re-assert it at the start of each band; a build half-drawn with another
  mode's parameters is a maddening bug to find.
- **Key any cache by what varies.** One geometry slot shared by three faces
  means the front's readme prints the side's dimensions.


### A worked one: two routing models, one loom

`modes/lib/loom.js` is the sharpest example of where the line goes. Two modes
draw bundles of conduit on a backplane: `conduit` integrates a heading with a
wandering turn, `raceway` walks a lattice and fillets every corner. Everything
else — the materials, the cross-section tables, the stamp, the backplane, the
framed bay, the shading, the occlusion — is identical, so it lives in the
library and the modes contribute one function each.

The interface is a **polyline**, not a callback. A mode hands over positions and
tangents already resampled at `ForgeLoom.stepM(g)`, plus a description of what
holds the bundle down; the library never asks the mode a question during the
stamp. Two reasons that shape is worth copying:

- the hot loop stays monomorphic. A per-step callback into mode code would be
  called a few million times a build and would defeat every hoist in it.
- the tangent travels *with* the position. On a seamless tile the position
  wraps, so differencing consecutive points reads the wrap as a jump a whole
  tile wide — the library would have to know which mode wrapped and where.

The library also owns two things the *routers* use rather than the stamp, and
they are worth knowing about because they are the difference between layers and
a pile:

- `ForgeLoom.strata(specs, layers, cav, seat, air)` works out where each layer
  sits from the tallest thing actually standing on the layer below, and scales
  every gauge if the stack comes out deeper than the cavity. Spreading layers
  evenly through the cavity looks equivalent and is not: a fat run on a low
  stratum then stands up through two layers above it.
- `ForgeLoom.claims(g, cellM)` is a grid of ground already taken, cleared
  between layers. A router marks what it lays down — lagged, so it does not
  trip over its own feet — and steers around what is already there. It has to,
  because the stamp's Z-test separates two bundles only when they are at
  different heights, and two at the same height that cross come out as one lump.

Both take a mode's own decisions as input rather than making them: `conduit`
dodges by leaning on its heading, `raceway` cannot and turns a corner early
instead.

A third piece of the same contract is `capA` / `capB` on every route, which say
what is standing at each end — `"box"`, `"gland"` or `"none"` — and `closed`,
which says the polyline's last point runs into its first. The library stamps the
boxes and closes every repeat on a closed run; `ForgeLoom.boxOf(route, end)`
hands back the box a mode is about to ask for, so the mode can check it has room
before committing to it. The rule this exists to enforce is worth stating
plainly, because it is a modelling rule rather than a rendering one: **nothing
may end in mid-air.** A run either has no ends, or it ends at something that
could be bolted there.

The cost of sharing is that **parameter names become an interface**. The library
reads `cavityMm`, `ribMm`, `oil`, `aoStr` and a dozen more straight off the
mode's parameters, so both modes declare controls with those ids. That is
written down at the top of the library, and it is the thing to check first when
a mode built on a shared file comes out wrong.

One trap it is worth naming, because both of those numbers have a legitimate
zero: read a parameter with a real default rather than `+p.x || d`. `ribHMm` at
zero means *no ribs*, and `0 || 7` is seven millimetres of rib with a row of
rivets down it — a slider whose own minimum silently does the opposite of what
it says.

## Talking to another mode

Modes are otherwise sealed from each other, with one exception:

```js
Forge.setParam(modeId, id, value)   // -> true if it changed something
```

It writes a parameter into another mode's panel — the form and the parameter
object — and marks that mode's last build stale so it rebuilds when you switch
to it. It deliberately does **not** run the other mode's `derive`, so two modes
can mirror each other without ping-ponging, and it returns `false` when the
target mode is not loaded, has no such control, or already holds the value.

The house family uses it from each mode's `derive` to keep the front, the side,
the back and the roof describing one building (`HouseShell.coordinate`). If you
build a family like that, two things are worth copying: mirror on the edit that
switches the link *off* as well as while it is on — otherwise the other panels
sit there still believing they are linked — and set the link flag on the
targets as you go, so they do not each fire their own off-mirror later.

## Lettering

Anything that has to draw WORDS — a tag on a wall, a sign, a stencil — needs a
typeface, and the app deliberately bundles none: the six graffiti faces in this
repository's `fonts/` are personal-use cuts, donationware, or came with no
licence file (fonts/README.txt is the authority on which is which), and
publishing them beside `index.html` would be redistributing them. `forge-fonts.js`
is the registry that gets round it.

```js
const face = window.ForgeFonts && ForgeFonts.resolve(P.myFontControl);
if (face) {
  ctx.font = size + 'px "' + face.css + '", sans-serif';
  ctx.fillText(word, x, y);
} else {
  // draw whatever you did before — a face is never guaranteed
}
```

`resolve()` takes what the control holds: a specific id, `"auto"` for whatever is
registered, or `"none"` to ask for your fallback on purpose. It returns null when
there is nothing, and **your mode must cope with that** — on the hosted copy the
six local faces are not there at all, and a browser with a strict file:// origin
will not reach them either.

A `type:"font"` control gives the user a picker plus a Load button that registers
a file straight from its bytes, so it works on the hosted copy too. Faces are
global: one registered for your mode is available to every other.

## Structures: several faces of one thing

A house is four textures and a diner is three. `Forge.setParam` above is how two
modes mirror each other once you already have a building; a **structure** is how
you get one in the first place — a guided walk through the faces where each step
opens with what the steps before it settled on.

```js
Forge.registerStructure({
  id:"house",
  label:"House",
  blurb:"Front, side, back and roof of one building",
  steps:[
    {id:"front",label:"Front",mode:"house",   set:{},              note:"…"},
    {id:"side", label:"Side", mode:"envelope",set:{face:"side"},   note:"…"},
    {id:"back", label:"Back", mode:"envelope",set:{face:"back"},   note:"…"},
    {id:"roof", label:"Roof", mode:"roof",    set:{},              note:"…"}
  ]
});
```

Each step names a mode and whatever that step pins down. On entering a step the
runtime writes every parameter that step's mode declares **and** an earlier step
also declared, then applies the step's own `set` over the top — so what the step
pins always beats anything carried. Inherited rows are marked in the panel and
un-mark themselves the moment you touch one, and what you put there is what the
later steps inherit instead.

Three ids are never carried: `size`, because how many texels a face needs is a
property of the export rather than of the building, and `face` and `piece`,
because naming which side of the thing this step draws is the one job a step
exists to do.

Steps may repeat a mode (`side` and `back` are both the envelope) — the runtime
just re-enters it with different pinned values. The last button on the wizard bar
builds every step at full size and packs them into one archive, a folder per
step, so register a structure only when every one of its modes is loaded in
`index.html`.

A structure also gets the **3D building** tab for free, provided its step ids
are `front`, `side`, `back` and `roof` — that is what `buildingScene` reads to
decide which plane a face goes on. "Forge every face" beside it fills the whole
building in at preview resolution; it is the look rather than the export.

## Drawing a thing that is not square to the grid

If your mode sweeps a shape along a path — a pipe, a cable, a moulding, a road
marking on a curve — do not sample its cross-section at a fixed spacing and
round each sample to a texel. A run of points one texel apart, rotated off the
grid, does not land one point to a texel: at 45° consecutive samples come down
two texels apart on the diagonal and the texels between them are written by
nobody. On a straight run at a fixed angle that reads as texture and you may
never notice; on a bend, which sweeps through every angle at once, the misses
drift along it and the whole thing reads as moiré.

Sampling harder does not fix it. Two samples half a texel apart still round to
positions a diagonal apart when their fractions straddle the same boundary — it
only makes the holes rarer.

Walk the **grid** instead: step one axis at a time from the texel at one end of
the span to the texel at the other. That visits every texel the span crosses,
exactly once, at any angle, and costs about what the old spacing did. Work out
what offset each texel is at from its own position — a dot product with the
normal — rather than from how far along the walk it is, and the profile is read
where the texel actually sits.

And **the outside of a bend travels further than the centreline you resampled
along**. A step of 0.8 texels at the centre carries the far edge of a shape
`reach` wide 0.8 × (1 + reach / bend radius) — over a texel as soon as the shape
is wide or the bend is tight — and consecutive spans then leave a slot cut
across it. Sub-step: the outermost point's travel is the centre's own plus the
reach times how much the normal turned, and divide the step until that is under
a texel. Straight runs never subdivide, so it is paid only where it is needed.

One trap in that: if your path **wraps** for a seamless tile, two consecutive
points either side of the wrap are stored a whole tile apart, and interpolating
between them sweeps a span right across the picture. Guard it — a real step is
one step long by construction, so anything several times that is a wrap.

`stamp()` in `modes/lib/loom.js` is the worked example for all of it.

## Things bolted to a surface belong on that surface's axes

A cast enclosure, a bracket, a nameplate — anything mounted rather than routed
— is fixed with a pattern somebody drilled, and nobody drills off-axis to suit
a cable. So snap its orientation to the nearest quarter turn, and then deal
with the consequence: whatever attaches to it has to arrive on that axis too,
or the fitting between them sits crooked.

Two moves, and you generally want both. Look for a place along the route where
it already nearly agrees — but **bound that search**, because every step you
trim off a run to square it up is a step off the run, and hunting the whole
length for the best spot can cost you a third of the routes in the picture.
Then bend the last stretch onto the axis at the tightest radius the thing will
take. `boxOf` / `squareInto` in `modes/lib/loom.js` are the pair.

## Shared helpers

On the `Forge` object, so a mode does not carry its own copy:

```js
Forge.clamp(x,a,b)  Forge.lerp(a,b,t)  Forge.smoothstep(e0,e1,x)
Forge.mulberry32(seed)          // -> rng()
Forge.hashi(x,y,seed)           // integer hash -> 0..1
Forge.vnoise(x,y,period,seed)   // value noise wrapping at `period` — tileable
Forge.fbm(u,v,period,oct,seed)
Forge.vnoise2(x,y,px,py,seed)   // independent period per axis, for stretched grain
Forge.fbm2(u,v,px,py,oct,seed)
Forge.wrapDist(a,b)             // distance on a unit torus
Forge.hex2rgb("#rrggbb")
Forge.blurWrap(src,n,r)         // separable box blur, wrapping (square)
Forge.blurClamp(src,w,h,r)      // separable box blur, clamped at the edges
```

Anything a single mode needs and nobody else does — a Worley variant, a
rotation table — belongs in that mode's file.

## Conventions worth keeping

- **Dimension in real units.** Street works in metres, house in feet. It is
  what makes the output composable and makes "zoom out" mean more detail
  rather than bigger blobs.
- **Warn in the readout when the resolution cannot hold the detail** rather
  than silently producing mush.
- **Drop detail grades that fall below a couple of texels.** Aliased noise
  looks worse than absent noise.
- **Keep metallic honest.** Flat black for dielectrics, and say so in the
  readme if you cheat (house does, for glass).
- **Side or top, never underneath.** These maps go onto 3D geometry that is
  seen from the side or from above, so never draw the underside of anything.
  The house family carries a fascia and a gutter but no soffit for exactly
  this reason: the soffit faces down and nothing looks up at it. Relief that
  stands proud of the face you are looking at — a sill, a hood, a rivet — is
  a different thing and is fine.

## Checking a mode

`tools/smoke-test.mjs` does the mechanical half: it builds every registered
mode, checks the channels it declares actually render, walks the view tabs, and
measures whether a tiling mode really tiles (the wrap difference against the
sharpest interior edge — the only test that does not fail a texture with hard
edges in it).

```
node tools/smoke-test.mjs            # every mode
node tools/smoke-test.mjs mymode     # just yours
```

`tools/feature-test.mjs` covers the things that are not per-mode — the
resolution ladder, the palette, the wizard, typefaces, the chrome, worker
threads, the GPU packer, the geometry export and the unlit bake:

```
node tools/feature-test.mjs          # all of it
node tools/feature-test.mjs bake     # one section
```

The other half is your eyes. Load `index.html` from disk — no server needed —
and watch the console. Then:

- every preset builds without an error
- dragging a slider gives a preview and releasing rebuilds (below 1024)
- each channel tab renders, and the chips match them
- the zip contains one PNG per channel plus the readme
- for a seamless mode, 4×4 tiling shows no seam at the tile edges
