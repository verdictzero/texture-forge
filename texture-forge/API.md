# The API

Texture Forge as a library rather than a tab. Everything the panel does —
every mode, every control, every preset, the whole channel set, the 16-bit
height, the readme and the glTF/OBJ geometry — is callable from a shell, from
another Node program, or from a line typed into the browser console.

It exists for the case where the textures are not the project: you are building
something else and you need a road, a wall and a roof at the right scale, and
you would rather write down what you want than click nineteen sliders.

```
node tools/forge.mjs modes
node tools/forge.mjs describe street
node tools/forge.mjs forge street --out assets/road --size 1024 --set tileM=6
```

That last command leaves `assets/road/` holding a full PBR set, a `model.gltf`
at the size the road really is, and a `manifest.json` saying which file is
which.

---

## The three layers

| | what it is | where |
|---|---|---|
| `window.ForgeAPI` | the API proper — drives the real panel in a real page | `forge-api.js` |
| `tools/forge.mjs` | a Node module that runs the page headlessly and copies bytes out | `tools/forge.mjs` |
| the same file | a command line over that module | `node tools/forge.mjs …` |

**It is one code path, not a second implementation.** Every call writes the
mode's own controls, runs the runtime's own build and packs with the runtime's
own packer. A texture forged from a script is byte-identical to one forged by
hand, and a mode added tomorrow is in the API the moment its `<script>` tag is
in `index.html` — there is no list of supported modes to keep up to date.

Which is also why the Node side drives a **browser**. Five of the generators
rasterise shapes through a 2D canvas and the channel packer is a WebGL2 shader;
a pure-Node reimplementation would be a second answer to the same question, and
the two would disagree the first time anybody touched a mode. So `forge.mjs`
launches headless Chromium, loads `index.html` off disk and talks to
`ForgeAPI`.

**Requirements:** node, `playwright` (`PLAYWRIGHT=/path` if it is installed
globally rather than beside the repo) and a Chromium (`CHROME=/path` if
playwright cannot find one). Exactly what `tools/smoke-test.mjs` already needs.
Nothing else in the app depends on any of it — the page still opens from disk
with no install and no build step.

---

## The command line

```
node tools/forge.mjs modes                          # what exists
node tools/forge.mjs describe <mode> [--json]       # every control, range and default
node tools/forge.mjs forge <mode> --out <dir> [options]
node tools/forge.mjs structure <id> --out <dir> [options]
node tools/forge.mjs batch <jobs.json> [--out <dir>]
```

| option | |
|---|---|
| `--out <dir>` | where the files go; required for `forge` and `structure` |
| `--size <n>` | resolution, 64…4096. A power of two for a tiling mode — see **Sizes** |
| `--seed <n>` | the seed |
| `--preset <id>` | applied before `--set`, so `--set` wins |
| `--set id=value` | one control. Repeatable. Values are JSON where they parse, strings where they do not |
| `--step id:ctl=v` | one control of one *structure step*. Repeatable |
| `--no-variants` | skip the extra cuts a mode declares — see **Variants** |
| `--zip` | also write the archive beside the loose files |
| `--json` | machine-readable output on stdout |
| `--stop-on-error` | `batch`: give up on the first failure instead of carrying on |

```
node tools/forge.mjs forge plating --out out/skin --preset hulk --seed 7
node tools/forge.mjs forge street  --out out/road --size 2048 --set tileM=6 --set wet=0.4
node tools/forge.mjs forge fence   --out out/fence --set type=chain --set fenceH=84
node tools/forge.mjs structure house --out out/house --size 1024 --step roof:size=2048
```

`describe` is the one to read first. It prints every control id a mode has, its
type, its range and its default, grouped the way the panel groups them — which
is everything `--set` needs and rather less than the mode file.

### batch

One browser for many textures. Launching Chromium costs a few seconds and
forging costs milliseconds, so a batch of forty is worth roughly forty times
less than forty commands.

```json
[
  { "mode": "street",  "out": "road",  "size": 2048, "set": { "tileM": 6 } },
  { "mode": "plating", "out": "skin",  "size": 1024, "preset": "hulk" },
  { "structure": "house", "out": "house", "size": 1024 }
]
```

```
node tools/forge.mjs batch jobs.json --out assets
```

Each job is written to `<--out>/<out>`. A job that will not forge is reported
against its own name and the rest still run; the exit code is 1 if any failed.

---

## As a Node module

```js
import { openForge } from "./tools/forge.mjs";

const forge = await openForge();

const road = await forge.write({ mode: "street", size: 1024, set: { tileM: 6 } }, "assets/road");
console.log(road.out, road.maps[""].basecolor);
//   assets/road   street_none_1963_1024_basecolor.png   — names are relative to `out`
console.log(road.plan);
//   { w: 6, h: 6, cutout: false, tile: 6, eaves: 6, units: "metres" }

await forge.write({ structure: "house", size: 1024 }, "assets/house");

await forge.close();                       // one browser, closed once
```

| call | |
|---|---|
| `catalog()` | every mode and structure, with ids and channel keys |
| `describe(mode)` | one mode's full schema — controls, presets, channels, plan |
| `defaults(mode)` | the parameter bag at declared defaults |
| `forge(spec)` | build, and report what it came out as — **no files** |
| `pack(spec)` | build and pack; the bytes stay in the page |
| `structure(spec)` | walk a structure's steps and pack the building |
| `write(spec, dir)` | `pack` or `structure`, then put the files on disk. The usual one |
| `pull(i)` | one packed file as a `Buffer` |
| `zip()` | the whole archive as a `Buffer` |
| `png(mode, key, maxW)` | one channel of the last build, `maxW` for a thumbnail |
| `palette(patch)` / `bake(patch)` | the two global look settings — see below |
| `close()` | shut the browser |

`openForge({ chrome, app })` overrides the Chromium binary and the page URL.

### A spec

```js
{
  mode: "plating",      // required (or `structure` for a building)
  preset: "hulk",       // optional, applied first
  size: 1024,           // optional shorthand for set.size
  seed: 7,              // optional shorthand for set.seed
  set: { rivStyle: "flush", chip: 0.6 },
  keep: false,          // see Reproducibility
  variants: true        // see Variants
}
```

A structure spec takes `structure`, an optional `size` and `seed` for the whole
building, and `steps` keyed by **step id** — not by mode id, because a diner's
front and side are the same mode and want different values:

```js
{
  structure: "diner",
  size: 1024,
  steps: {
    front: { preset: "nightshift" },   // see below
    roof:  { size: 2048 }              // one face at a higher resolution
  }
}
```

A step may name a `preset`, and it means what the button means: that panel is
reset to its declared defaults before the preset is applied, which throws away
what the step inherited from the ones before it — and what it settles is then
what the steps *after* it inherit. That is right on the first step and worth
thinking about on the third.

---

## In the browser

`window.ForgeAPI` is the same object, unwrapped — useful in the console, and
what `forge.mjs` is talking to.

```js
await ForgeAPI.ready();
const out = await ForgeAPI.forge({ mode: "hull", size: 512, seed: 5 });
const man = await ForgeAPI.pack({ mode: "hull", size: 512, seed: 5 });
const png = ForgeAPI.file(0);                   // base64
```

`catalog`, `describe`, `defaults`, `forge`, `pack`, `structure`, `palette` and
`bake` are as above. Getting bytes out is different, because a page-to-driver
hop is JSON: `pack()` puts the files in a slot and returns a manifest, and
`file(i)` / `text(i)` pull them one at a time. `zip()` returns the archive.

`ForgeAPI.params(mode)`, `.reset(mode)` and `.set(mode, values)` poke at a
panel without building, for a caller that wants to look before it forges.

---

## What comes out

One directory per texture, holding what the download button packs:

```
street_none_1963_1024_basecolor.png   one PNG per channel the mode declares
street_none_1963_1024_normal.png      …roughness, metallic, ao, height, orm
street_none_1963_1024_unlit.png       the unlit bake — every mode has one
street_none_1963_1024_height16.png    16-bit greyscale height
street_none_1963_1024_readme.txt      what the maps are and how they were made
model.gltf  model.obj  model.mtl      a plane at the real size, maps wired up
model_readme.txt
manifest.json                         written by forge.mjs, not by the app
```

The stem is the mode's own `fileBase(P, W, H)` — whatever it thinks names this
build, which for the street is the piece, the seed and the size. Do not parse
it; read `maps` below.

`manifest.json` is the machine-readable half, and the reason a folder of nine
PNGs is not something you have to guess at:

```jsonc
{
  "mode": "street", "w": 1024, "h": 1024, "ms": 412,
  "fileBase": "street_none_1963_1024",
  "seamless": true, "cutout": false,
  "plan": { "w": 6, "h": 6, "cutout": false, "tile": 6, "eaves": 6, "units": "metres" },
  "maps": { "": { "basecolor": "street_none_1963_1024_basecolor.png", … ,
                  "model": "model.gltf" } },
  "readout": "171 px/m · 5.9 mm per texel · …",
  "params": { …every parameter the generator was actually handed… },
  "out":    "assets/road",
  "files":  [ { "name": …, "bytes": … } ]
}
```

`maps` is keyed by folder — `""` for a plain build, the variant or step folder
otherwise — so wiring a material up is a lookup rather than a name parse.

`plan` is **metres, always**, whatever unit the mode itself thinks in. That is
what makes the output composable: a 6 m road tile and a 7.9 m house front go
into the same scene at the same scale without anybody guessing.

A structure adds one folder per face, a whole-building `model.gltf` rather than
four planes, and a `faces` array in the manifest saying which folder is which
face of what.

---

## Things worth knowing

**Reproducibility.** Every `forge()` resets the mode to its **declared
defaults** first, then applies the preset, then your values. The spec is the
whole description: the same spec gives the same texture in the same session,
after twenty other builds, or in a fresh browser tomorrow. Pass `keep: true` to
build on whatever the panel is holding instead — useful for exploring, wrong
for anything you want to be able to rebuild.

**What actually landed.** A slider clamps to its ends and snaps to its step,
and a mode's `derive()` rewrites parameters behind both. You get it back:
`params` in the result is what the generator was really handed, `adjusted` names
anything that moved, and `unknown` names control ids the mode does not have —
which is what a typo looks like, since a mode with no such control is otherwise
silent about it. A bad *value* for a control that does exist is an error, with
the valid options in the message.

**Sizes.** 64 to 4096. A seamless mode wants a power of two: WebGL1 cannot
repeat or mipmap anything else, and the tiled preview quietly shows one tile if
you ignore this. `describe` reports `seamless` per mode.

**Variants.** Some modes declare extra cuts of the same texture — the hull packs
the plating with windows *and* the blank plating to put between the window
bands, off the same seed and the same quilt. They arrive in their own folders
and the manifest names them. `--no-variants` (or `variants: false`) packs only
what you asked for.

**Lettering.** Modes that draw words — house, diner, the graffiti — need a
typeface, and the app deliberately bundles none (see the top of
`forge-fonts.js`). Headless, there is no registered face, so those modes take
their own fallback. Everything else is unaffected.

**Palette and the unlit bake** are global rather than per-mode, and both reach
the exported PNGs. `forge.palette({ id, dither, strength })` and
`forge.bake({ gain, ao, emi, … })` set them; both return their state, and both
persist for the rest of the session, so set them before a batch rather than
in the middle of one.

**Threads and the GPU.** A mode that declares itself threadable is built on a
worker, and the channel packer uses WebGL2 where there is one. Headless on a
machine with no GPU both fall back on their own, and the output is the same
either way — only slower.

---

## Checking it

The API has its own section in the feature test, which covers the things that
would otherwise go quietly wrong: that a spec is reproducible, that a preset
and a `--set` actually change the pixels, that clamping and unknown ids are
reported, and that a packed set holds one PNG per declared channel.

```
node tools/feature-test.mjs api
```
