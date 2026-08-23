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

The other half is your eyes. Load `index.html` from disk — no server needed —
and watch the console. Then:

- every preset builds without an error
- dragging a slider gives a preview and releasing rebuilds (below 1024)
- each channel tab renders, and the chips match them
- the zip contains one PNG per channel plus the readme
- for a seamless mode, 4×4 tiling shows no seam at the tile edges
