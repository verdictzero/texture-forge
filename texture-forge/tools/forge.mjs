/* =====================================================================
   TEXTURE FORGE — the command line
   =====================================================================
   The app, headless. Forge a texture set from a shell or from another
   Node program, and get PNGs, a readme and glTF/OBJ geometry on disk
   rather than in a downloads folder.

     node tools/forge.mjs modes
     node tools/forge.mjs describe plating
     node tools/forge.mjs forge plating --out assets/skin --size 1024 --set chip=0.6
     node tools/forge.mjs structure house --out assets/house --size 1024
     node tools/forge.mjs batch jobs.json --out assets

   Or as a module, which is the point of the whole exercise — one browser
   for a hundred textures rather than one each:

     import { openForge } from "./tools/forge.mjs";
     const forge = await openForge();
     await forge.write({ mode:"street", set:{ tileM:6 } }, "assets/road");
     await forge.close();

   WHY A BROWSER. The generators are the app's, unchanged: several of them
   rasterise shapes through a 2D canvas, the channel packer is a WebGL2
   shader, and the whole point of this file is that a texture forged from
   a script is the one you saw in the tab. Reimplementing any of that in
   Node would be a second answer to the same question, and the two would
   drift apart the first time a mode was added. So this drives the real
   page through Playwright and copies the bytes out.

   Needs playwright (PLAYWRIGHT=/path if it is installed globally) and a
   Chromium (CHROME=/path if playwright cannot find one) — the same
   dependency the smoke test has, and for the same reason.
   ===================================================================== */
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = pathToFileURL(path.join(HERE, "..", "index.html")).href;

const require = createRequire(import.meta.url);
function playwright() {
  for (const where of [process.env.PLAYWRIGHT, "playwright", "playwright-core",
                       "/usr/lib/node_modules/playwright", "/opt/node22/lib/node_modules/playwright"]) {
    if (!where) continue;
    try { return require(where); } catch {}
  }
  throw new Error("playwright not found — npm i -D playwright, or set PLAYWRIGHT=/path/to/playwright");
}

/* ============================ the session ============================
   One browser, one page, one boot — held open so a batch pays for it
   once. Everything below is a thin wrapper over window.ForgeAPI, which
   is where the actual argument checking lives; this side's job is
   launching, copying bytes out and putting them on disk. */

export async function openForge(opts = {}) {
  const { chromium } = playwright();
  const browser = await chromium.launch({
    executablePath: opts.chrome || process.env.CHROME || undefined,
    /* SwiftShader so the WebGL2 channel packer and the lit preview work on a
       machine with no GPU — a CI runner, a container. The packer falls back to
       the CPU loop on its own if this fails, so the output is the same either
       way; it is only slower. */
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message)));
  page.on("console", m => {
    /* the hosted fonts and the six local faces are both allowed to be missing;
       neither changes a texture that does not draw words */
    if (m.type() === "error" && !/ERR_|fonts\.googleapis|favicon/.test(m.text())) errors.push(m.text());
  });
  await page.goto(opts.app || APP);
  await page.evaluate(() => window.ForgeAPI.ready());

  /* Playwright wraps anything the page throws as "page.evaluate: Error: …",
     which turns ForgeAPI's careful message ("no such option, expected one of
     …") into noise with the useful half buried in it. Unwrap it: a caller
     driving this from a script should see the message the API wrote. */
  const call = async (fn, ...args) => {
    try { return await page.evaluate(fn, args.length === 1 ? args[0] : args); }
    catch (e) {
      const m = /^(?:page\.evaluate: )?(?:\w*Error: )?([\s\S]*)$/.exec(String(e && e.message || e));
      throw new Error(m ? m[1].split("\n    at ")[0].trim() : String(e));
    }
  };

  const api = {
    page, browser, errors,

    catalog: () => call(() => window.ForgeAPI.catalog()),
    describe: id => call(x => window.ForgeAPI.describe(x), id),
    defaults: id => call(x => window.ForgeAPI.defaults(x), id),

    /* Forge without packing: for a caller that wants to know what a spec
       comes out as — the size, the real-world scale, what derive() moved —
       before spending the PNG encoding on it. */
    forge: spec => call(x => window.ForgeAPI.forge(x), spec),

    /* Forge and pack, then hand back the manifest. The bytes stay in the
       page until pull() or write() asks for them. */
    pack: spec => call(x => window.ForgeAPI.pack(x), spec),
    structure: spec => call(x => window.ForgeAPI.structure(x), spec),

    pull: async i => Buffer.from(await call(x => window.ForgeAPI.file(x), i), "base64"),
    zip: async () => Buffer.from(await call(() => window.ForgeAPI.zip()), "base64"),
    png: async (mode, key, maxW) =>
      Buffer.from(await call(a => window.ForgeAPI.png(a[0], a[1], a[2]), [mode, key, maxW || null]), "base64"),

    palette: patch => call(x => window.ForgeAPI.palette(x), patch || null),
    bake: patch => call(x => window.ForgeAPI.bake(x), patch || null),

    /* THE ONE MOST CALLERS WANT. Forge, pack, and put the lot in a
       directory — one PNG per channel, the 16-bit height, the readme and
       the geometry, plus a manifest.json saying what everything is and at
       what real-world size, because a folder of nine PNGs is not
       self-describing. */
    async write(spec, outDir, o = {}) {
      if (!outDir) throw new Error("write() wants a directory to write into");
      const man = spec && spec.structure ? await api.structure(spec) : await api.pack(spec);
      return await drain(api, man, outDir, o);
    },

    async close() { await browser.close(); }
  };
  return api;
}

async function drain(api, man, outDir, o = {}) {
  await fs.mkdir(outDir, { recursive: true });
  const written = [];
  for (const f of man.files) {
    /* the page names the folders — a mode's variants, a structure's steps —
       so a file name may carry a path, and the directory has to exist */
    const dest = path.join(outDir, f.name);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, await api.pull(f.index));
    written.push(f.name);
  }
  const manifest = { ...man, files: man.files.map(f => ({ name: f.name, bytes: f.bytes })), out: outDir };
  if (o.manifest !== false)
    await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { ...manifest, written };
}

/* ============================ argument parsing ============================
   --set is repeatable and takes id=value; values are read as JSON where
   they parse and as strings where they do not, so --set flipG=true is a
   boolean and --set sign=OPEN is a word. */

function parseArgs(argv) {
  const out = { _: [], set: {}, steps: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    /* --no-variants is the negation of --variants, not a control called
       "no-variants" — which is what it silently became before */
    if (/^--no-[a-z]/.test(a)) { out[a.slice(5)] = false; continue; }
    const eq = a.indexOf("=");
    const key = eq < 0 ? a.slice(2) : a.slice(2, eq);
    let val = eq < 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true) : a.slice(eq + 1);
    if (key === "set" || key === "step") {
      const at = String(val).indexOf("=");
      if (at < 0) throw new Error(`--${key} wants id=value, got ${val}`);
      const id = String(val).slice(0, at), v = value(String(val).slice(at + 1));
      if (key === "set") out.set[id] = v;
      else {                                     /* --step front:size=2048 */
        const dot = id.indexOf(":");
        if (dot < 0) throw new Error("--step wants stepid:control=value");
        const s = id.slice(0, dot), c = id.slice(dot + 1);
        (out.steps[s] || (out.steps[s] = {}))[c] = v;
      }
      continue;
    }
    out[key] = val === true ? true : value(String(val));
  }
  return out;
}
const value = s => { try { return JSON.parse(s); } catch { return s; } };

/* ============================ the commands ============================ */

const HELP = `texture-forge — procedural PBR textures, headless

  node tools/forge.mjs modes
  node tools/forge.mjs describe <mode> [--json]
  node tools/forge.mjs forge <mode> --out <dir> [options]
  node tools/forge.mjs structure <id> --out <dir> [options]
  node tools/forge.mjs batch <jobs.json> [--out <dir>]

Options
  --out <dir>        where the files go (required for forge/structure)
  --size <n>         resolution, 64…4096; a power of two for a tiling mode
  --seed <n>         the seed
  --preset <id>      apply a preset before --set
  --set id=value     one control; repeatable. Values are JSON where they parse
  --step id:ctl=v    one control of one structure step; repeatable
  --no-variants      skip the extra cuts a mode declares
  --zip              also write <fileBase>.zip beside the loose files
  --json             machine-readable output on stdout
  --stop-on-error    batch: give up on the first job that fails (default: carry on)

Examples
  node tools/forge.mjs forge street --out out/road --size 2048 --set tileM=6 --set wet=0.4
  node tools/forge.mjs forge plating --out out/skin --preset hulk --seed 7
  node tools/forge.mjs structure house --out out/house --size 1024 --step roof:size=2048
`;

async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (!cmd || cmd === "help" || args.help) { process.stdout.write(HELP); return 0; }

  const json = !!args.json;
  const say = (obj, human) => {
    if (json) console.log(JSON.stringify(obj, null, 2));
    else human();
  };

  const forge = await openForge();
  try {
    if (cmd === "modes") {
      const cat = await forge.catalog();
      say(cat, () => {
        console.log("modes");
        for (const m of cat.modes)
          console.log(`  ${m.id.padEnd(10)} ${m.seamless ? "tiles " : "      "} ${m.label} — ${m.blurb}`);
        console.log("\nstructures");
        for (const s of cat.structures)
          console.log(`  ${s.id.padEnd(10)} ${s.steps.map(x => x.id).join(" → ")}  ${s.blurb}`);
      });
      return 0;
    }

    if (cmd === "describe") {
      const id = args._[1];
      if (!id) throw new Error("describe wants a mode id");
      const d = await forge.describe(id);
      say(d, () => {
        console.log(`${d.id} — ${d.label}\n${d.tagline || d.blurb}`);
        console.log(`\n  ${d.seamless ? "tiles" : "single piece"}${d.plan ? `, ${d.plan.w} × ${d.plan.h} m` : ""}`);
        console.log(`  channels: ${d.channels.map(c => c.key).join(", ")}`);
        if (d.presets.length) console.log(`  presets:  ${d.presets.map(p => p.id).join(", ")}`);
        let group = null;
        console.log("\ncontrols");
        for (const c of d.controls) {
          if (c.group !== group) { group = c.group; console.log(`\n  [${group}]`); }
          const range = c.kind === "range" ? `${c.min}…${c.max} step ${c.step}${c.unit ? " " + c.unit : ""}`
            : c.kind === "select" && Array.isArray(c.options) ? c.options.map(o => o.value).join("|")
            : c.kind;
          console.log(`  ${String(c.id).padEnd(14)} ${String(JSON.stringify(c.default)).padEnd(10)} ${range}`);
        }
      });
      return 0;
    }

    if (cmd === "forge" || cmd === "structure") {
      const id = args._[1];
      if (!id) throw new Error(`${cmd} wants an id`);
      if (!args.out) throw new Error("--out <dir> is required");
      const spec = cmd === "forge"
        ? { mode: id, set: args.set, preset: args.preset, size: args.size, seed: args.seed,
            variants: args.variants === false ? false : undefined }
        : { structure: id, steps: args.steps, size: args.size, seed: args.seed };
      const res = await forge.write(spec, args.out);
      if (args.zip) await fs.writeFile(path.join(args.out, (res.fileBase || res.name) + ".zip"), await forge.zip());
      say(res, () => {
        console.log(`${res.written.length} files → ${args.out}`);
        if (res.w) console.log(`  ${res.w} × ${res.h}${res.plan ? `  (${res.plan.w} × ${res.plan.h} m)` : ""}  ${res.ms} ms`);
        if (res.readout) console.log(`  ${res.readout}`);
        if (res.adjusted) console.log(`  adjusted: ${JSON.stringify(res.adjusted)}`);
        if (res.unknown) console.log(`  UNKNOWN CONTROLS: ${JSON.stringify(res.unknown)}`);
      });
      return 0;
    }

    if (cmd === "batch") {
      const file = args._[1];
      if (!file) throw new Error("batch wants a jobs.json");
      const jobs = JSON.parse(await fs.readFile(file, "utf8"));
      const list = Array.isArray(jobs) ? jobs : jobs.jobs;
      const base = args.out || jobs.out || ".";
      /* ONE BAD SPEC IS NOT A BAD BATCH. Forty textures is exactly where a
         typo in the eleventh is most expensive, so a job that will not forge
         is reported against its own name and the rest still run. Pass
         --stop-on-error to go back to failing on the first one. */
      const done = [];
      let bad = 0;
      for (const job of list) {
        const name = job.mode || job.structure || "?";
        const out = path.join(base, job.out || name);
        try {
          const res = await forge.write(job, out);
          done.push({ ok: true, job: name, ...res });
          if (!json) console.log(`${name.padEnd(12)} → ${out}  (${res.written.length} files)`);
        } catch (e) {
          bad++;
          done.push({ ok: false, job: name, out, error: String(e && e.message || e) });
          if (!json) console.error(`${name.padEnd(12)} FAILED  ${e && e.message || e}`);
          if (args["stop-on-error"]) break;
        }
      }
      if (json) console.log(JSON.stringify(done, null, 2));
      return bad ? 1 : 0;
    }

    throw new Error(`unknown command ${cmd}\n\n${HELP}`);
  } finally {
    if (forge.errors.length) console.error("page errors:\n  " + forge.errors.join("\n  "));
    await forge.close();
  }
}

/* run only when this file IS the command; importing it must not launch a browser */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    /* NOT process.exit(): it does not wait for stdout to drain, and piping this
       into a file or a jq was losing the tail of the JSON. */
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(String(e && e.message || e));
    process.exitCode = 1;
  }
}
