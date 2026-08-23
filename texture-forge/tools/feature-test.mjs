/* Checks over the things the smoke test does not touch: the resolution ladder,
   the palette and dither pipeline, the structure wizard, and both halves of the
   graffiti typeface path.

     node tools/feature-test.mjs            # all of them
     node tools/feature-test.mjs palette    # one of them

   Same requirements as smoke-test.mjs — playwright (PLAYWRIGHT=/path if it is
   installed globally) and a Chromium (CHROME=/path). Nothing in the app depends
   on this file; it is a check, not a build step. */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let chromium;
for (const where of [process.env.PLAYWRIGHT, "playwright", "playwright-core"]) {
  if (!where) continue;
  try { ({ chromium } = require(where)); break; } catch {}
}
if (!chromium) {
  console.error("playwright not found — npm i -D playwright, or set PLAYWRIGHT=/path/to/playwright");
  process.exit(2);
}
const APP = pathToFileURL(path.join(HERE, "..", "index.html")).href;
const only = process.argv.slice(2);
const want = name => !only.length || only.includes(name);

let fails = 0;
const ok = (name, cond, extra = "") => {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (extra ? "  — " + extra : ""));
  if (!cond) fails++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
});
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("console", m => {
  if (m.type() === "error" && !/ERR_CONNECTION|fonts\.googleapis/.test(m.text())) errors.push(m.text());
});
await page.goto(APP);
await page.waitForTimeout(500);

/* Watch the build state rather than the status line: switching back to a mode
   that is already built shows its previous result without regenerating it, and
   that status carries no timing, so waiting for one hangs for as long as you
   let it. */
const settle = async (tries = 400) => {
  for (let i = 0; i < tries; i++) {
    const s = await page.evaluate(() => {
      const a = window.Forge.active();
      return { busy: !!a.busy, built: !!a.built };
    });
    if (!s.busy && s.built) return await page.$eval("#status", n => n.textContent);
    await page.waitForTimeout(150);
  }
  return "TIMEOUT";
};
/* how many distinct colours a channel actually holds — the only direct way to
   see whether a palette bit */
const distinct = (key, res) => page.evaluate(([k, r]) => {
  const cv = window.Forge.makeMap(k, r);
  const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
  const s = new Set();
  for (let i = 0; i < d.length; i += 4) s.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return s.size;
}, [key, res]);

/* ============================ the resolution ladder ============================
   Every mode has to survive the small end: below about 256 px most of them are
   dropping features rather than shrinking them, and a mode that divides by a
   count it snapped to zero falls over here and nowhere else. */
if (want("sizes")) {
  console.log("\n— resolution ladder —");
  const modes = await page.evaluate(() => window.Forge.modes.map(m => ({
    id: m.id, channels: m.channels.map(c => c.key)
  })));
  for (const m of modes) {
    await page.click(`#modebar-tabs [data-mode="${m.id}"]`);
    await settle();
    for (const S of [64, 256]) {
      const before = errors.length;
      const set = await page.evaluate(([id, s]) => window.Forge.setParam(id, "size", s), [m.id, S]);
      if (!set) { ok(`${m.id} offers ${S}`, false); continue; }
      await page.click(`#${m.id}--forge`);
      await page.waitForTimeout(100);
      const st = await settle();
      const bad = await page.evaluate(keys => keys.filter(k => {
        try { const cv = window.Forge.makeMap(k, 64); return !cv || !cv.width || !cv.height; }
        catch { return true; }
      }), m.channels);
      ok(`${m.id} @ ${S}`, /ms$/.test(st) && !bad.length && errors.length === before,
         st + (bad.length ? " bad:[" + bad + "]" : "") + errors.slice(before).join(" | "));
    }
  }
}

/* ============================ palette and dither ============================ */
if (want("palette")) {
  console.log("\n— palette and dither —");
  const parsed = await page.evaluate(() => ({
    hex: window.Palette.parse("#ff0000\n00ff00\n#0000FF\n# note\nff0000").length,
    gpl: window.Palette.parse("GIMP Palette\nName: x\n#\n255 0 0\tRed\n0 255 0\tGreen\n0 0 255\tBlue").length,
    css: window.Palette.parse(":root{--a:#112233;--b:#445566}").length,
    sheet: (() => {
      const n = 8, cell = 16, c = document.createElement("canvas");
      c.width = n * cell; c.height = cell;
      const g = c.getContext("2d");
      for (let i = 0; i < n; i++) { g.fillStyle = `rgb(${i * 30},${255 - i * 30},${i * 17})`; g.fillRect(i * cell, 0, cell, cell); }
      const img = g.getImageData(0, 0, c.width, c.height);
      return window.Palette.fromImageData(img.data, c.width, c.height).length;
    })()
  }));
  ok("hex list parses, duplicates dropped", parsed.hex === 3, JSON.stringify(parsed));
  ok("GIMP .gpl parses", parsed.gpl === 3);
  ok("hexes lifted out of CSS", parsed.css === 2);
  ok("swatch sheet reads back as 8 colours", parsed.sheet === 8);

  await page.click('#modebar-tabs [data-mode="greeble"]');
  await settle();
  await page.evaluate(() => window.Forge.setParam("greeble", "size", 128));
  await page.click("#greeble--forge");
  await settle();

  ok("full colour is many-coloured", (await distinct("basecolor", 128)) > 400);
  for (const [pal, dither, cap] of [["grey8", "none", 8], ["grey8", "bayer4", 8],
                                    ["grey8", "fs", 8], ["rgb332", "bayer8", 256]]) {
    const before = errors.length;
    await page.evaluate(([p, d]) => { window.Palette.set("id", p); window.Palette.set("dither", d); }, [pal, dither]);
    await page.waitForTimeout(250);
    const n = await distinct("basecolor", 128);
    ok(`${pal} + ${dither} snaps to <= ${cap}`, n > 1 && n <= cap && errors.length === before, n + " colours");
  }
  /* the whole point of restricting it to the base colour */
  ok("data channels are never quantised", (await distinct("normal", 128)) > 400);

  await page.evaluate(() => window.Palette.set("nearest", false));
  await page.waitForTimeout(120);
  const off = await page.evaluate(() => document.body.dataset.nearest);
  await page.evaluate(() => window.Palette.set("nearest", true));
  await page.waitForTimeout(120);
  const on = await page.evaluate(() => document.body.dataset.nearest);
  ok("nearest drives the filtering flag", off === "off" && on === "on", off + "/" + on);
  await page.evaluate(() => window.Palette.set("id", "none"));
  await page.waitForTimeout(150);
}

/* ============================ the structure wizard ============================ */
if (want("wizard")) {
  console.log("\n— structure wizard —");
  const structs = await page.evaluate(() => window.Forge.structures.map(s => ({ id: s.id, n: s.steps.length })));
  ok("structures registered", structs.length > 0, JSON.stringify(structs));

  for (const s of structs) {
    console.log(`  · ${s.id}`);
    /* park every mode at a known resolution first, so "the wizard did not
       carry it" is a claim about the wizard and not about whatever the last
       check happened to leave behind */
    await page.evaluate(n => {
      for (const st of window.Forge.structures.find(x => x.id === n).steps)
        window.Forge.setParam(st.mode, "size", 256);
    }, s.id);
    await page.click(`[data-struct="${s.id}"]`);
    await settle();
    ok(`${s.id}: wizard bar opens`, !(await page.$eval("#wizbar", n => n.hidden)));
    ok(`${s.id}: mode tabs are held while it runs`,
       (await page.evaluate(() => document.body.dataset.wizard)) === "on");

    /* a seed set on the first step has to reach every later one: it is the
       single value that decides whether the faces are one object */
    const firstMode = await page.evaluate(() => window.Forge.active().mode.id);
    await page.evaluate(() => {
      const m = window.Forge.active().mode.id;
      window.Forge.setParam(m, "seed", 4242);
      window.Forge.setParam(m, "size", 512);        // the one thing that must NOT follow
    });
    await page.click(`#${await page.evaluate(() => window.Forge.active().mode.id)}--forge`);
    await settle();

    for (let k = 1; k < s.n; k++) {
      await page.click("#wiz-next");
      await settle();
      const seed = await page.evaluate(() => window.Forge.active().P.seed);
      ok(`${s.id}: step ${k + 1} inherits the seed`, seed === 4242, String(seed));
      const marked = await page.evaluate(() =>
        document.querySelectorAll("#panel-" + window.Forge.active().mode.id + " .row.carried").length);
      ok(`${s.id}: step ${k + 1} marks what it inherited`, marked > 0, marked + " rows");
      /* Resolution must not follow the building around. Only checkable where
         the step is a DIFFERENT mode — steps that re-enter one mode share its
         single state, so there is no second resolution for it to leak into. */
      const here = await page.evaluate(() => ({ m: window.Forge.active().mode.id,
                                                size: window.Forge.active().P.size }));
      if (here.m !== firstMode)
        ok(`${s.id}: step ${k + 1} kept its own resolution`, here.size === 256, String(here.size));
    }

    /* and the whole thing has to leave as one archive */
    await page.evaluate(n => {
      for (const st of window.Forge.structures.find(x => x.id === n).steps)
        window.Forge.setParam(st.mode, "size", 256);
    }, s.id);
    const before = errors.length;
    await page.click("#wiz-all");
    for (let i = 0; i < 600; i++) {
      const t = await page.$eval("#status", n => n.textContent);
      if (/packed|Could not/.test(t)) break;
      await page.waitForTimeout(250);
    }
    const msg = await page.$eval("#status", n => n.textContent);
    const name = await page.$eval("#zipsave", n => n.hidden ? "" : n.getAttribute("download"));
    ok(`${s.id}: every face packed into one archive`,
       msg.includes(s.n + " faces packed") && name.startsWith(s.id + "_"), msg + " | " + name);
    ok(`${s.id}: no errors while packing`, errors.length === before, errors.slice(before).join(" | "));

    await page.click("#wiz-exit");
    await page.waitForTimeout(200);
    ok(`${s.id}: leaving gives the mode tabs back`,
       (await page.evaluate(() => document.body.dataset.wizard)) === "off");
  }
}

/* ============================ typefaces ============================
   The graffiti stencil has two paths and only one of them normally runs. Where
   the six local faces are reachable — which, opened straight off disk, they are
   in Chromium — every build takes the typeface path and the scrawl fallback is
   exercised by nothing. "none" is the setting that reaches it on purpose.

   setParam only marks the build stale, so this drives the controls the way a
   person does and lets the panel's own handler queue the rebuild. */
if (want("fonts")) {
  console.log("\n— typefaces —");
  const n = await page.evaluate(() => window.ForgeFonts ? ForgeFonts.list().length : -1);
  ok("the font registry is there", n >= 0, n + " face(s)");
  await page.click('#modebar-tabs [data-mode="house"]');
  await settle();
  const build = async (vals) => {
    await page.evaluate(v => {
      for (const k in v) {
        const el = document.getElementById("house--" + k);
        if (!el) continue;
        el.value = v[k];
        el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
      }
    }, vals);
    await page.waitForTimeout(250);
    await settle();
    return page.evaluate(() => {
      const B = window.Forge.active().B, N = B.W * B.H;
      let hash = 2166136261 >>> 0, hot = 0;
      for (let i = 0; i < N; i++) {
        if (!B.ALP[i]) continue;
        const r = B.A[i * 3], g = B.A[i * 3 + 1], b = B.A[i * 3 + 2];
        if (Math.max(r, g, b) - Math.min(r, g, b) > 45) hot++;
        hash ^= r; hash = Math.imul(hash, 16777619) >>> 0;
        hash ^= g; hash = Math.imul(hash, 16777619) >>> 0;
      }
      return { hot, hash: hash.toString(16) };
    });
  };
  const before = errors.length;
  const bare   = await build({ size: 256, aband: 1, vines: 0, graffiti: 0 });
  const face   = await build({ graffiti: 0.9, graffFont: "auto" });
  const scrawl = await build({ graffiti: 0.9, graffFont: "none" });
  ok("graffiti at zero leaves the wall alone", bare.hash !== face.hash,
     bare.hash + " vs " + face.hash);
  ok("a tag puts strong colour on a grey wall", face.hot > bare.hot,
     bare.hot + " → " + face.hot + " saturated texels");
  if (n > 0)
    ok("the scrawl fallback draws something else", scrawl.hash !== face.hash,
       "face " + face.hash + " vs scrawl " + scrawl.hash);
  ok("the fallback still writes on the wall", scrawl.hot > bare.hot,
     bare.hot + " → " + scrawl.hot + " saturated texels");
  ok("neither path throws", errors.length === before);
}

if (errors.length) { fails++; console.log("\npage errors:\n" + errors.join("\n")); }
console.log(fails ? `\nFAIL (${fails})` : "\nALL GOOD");
await browser.close();
process.exit(fails ? 1 : 0);
