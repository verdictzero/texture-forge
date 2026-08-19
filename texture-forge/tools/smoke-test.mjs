/* Smoke test over every registered mode.
   Builds each one, checks the channels, walks the view tabs, and — for tiling
   modes — measures whether the texture actually wraps.

     node tools/smoke-test.mjs                 # every mode
     node tools/smoke-test.mjs hazard roof     # just these

   Needs playwright (PLAYWRIGHT=/path if it is installed globally) and a
   Chromium (CHROME=/path if playwright cannot find one). Nothing else in the app
   depends on this file; it is a check, not a build step. */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* playwright is a dev dependency of this check, not of the app, so it may be
   installed globally rather than beside the repo — PLAYWRIGHT=/path/to/it */
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
const SHOTS = process.env.SHOTS || path.join(HERE, "shots");
const only = process.argv.slice(2);

let fails = 0;
const ok = (name, cond, extra = "") => {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (extra ? "  — " + extra : ""));
  if (!cond) fails++;
};

/* Runs in the page. Renders one channel and compares the wrap-around edge
   difference against the sharpest interior edge in the same image. A seamless
   texture may legitimately carry a hard edge that lands on the tile boundary —
   a panel seam, a shingle butt — but it may not differ across the wrap by more
   than its own sharpest feature. That is the bar. */
const seamRatio = ([key, res]) => {
  const cv = window.Forge.makeMap(key, res);
  const { width: w, height: h } = cv;
  const d = cv.getContext("2d").getImageData(0, 0, w, h).data;
  const px = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  const colDiff = (a, b) => { let s = 0; for (let y = 0; y < h; y++) s += diff(px(a, y), px(b, y)); return s / h; };
  const rowDiff = (a, b) => { let s = 0; for (let x = 0; x < w; x++) s += diff(px(x, a), px(x, b)); return s / w; };
  const ix = [], iy = [];
  for (let x = 0; x < w - 1; x++) ix.push(colDiff(x, x + 1));
  for (let y = 0; y < h - 1; y++) iy.push(rowDiff(y, y + 1));
  const max = a => a.reduce((m, v) => v > m ? v : m, 0);
  const wrapX = colDiff(w - 1, 0), wrapY = rowDiff(h - 1, 0);
  const mx = Math.max(max(ix), 1), my = Math.max(max(iy), 1);
  return { ratio: Math.max(wrapX / mx, wrapY / my), wrapX, wrapY, maxX: mx, maxY: my };
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("console", m => {
  if (m.type() === "error" && !/ERR_CONNECTION|fonts\.googleapis/.test(m.text())) errors.push(m.text());
});

const status = () => page.$eval("#status", n => n.textContent);
const settle = async (tries = 600) => {
  for (let i = 0; i < tries; i++) {
    const s = await status();
    if (/ms$/.test(s)) return s;
    await page.waitForTimeout(250);
  }
  return "TIMEOUT: " + await status();
};

await page.goto(APP);
await page.waitForTimeout(500);
const modes = await page.evaluate(() => window.Forge.modes.map(m => ({
  id: m.id,
  channels: m.channels.map(c => c.key),
  tabs: m.channels.filter(c => c.tab !== false).map(c => c.key)
})));
console.log("registered modes:", modes.map(m => m.id).join(", ") || "(none)");
if (!modes.length) fails++;

for (const m of modes) {
  if (only.length && !only.includes(m.id)) continue;
  console.log(`\n— ${m.id} —`);
  const before = errors.length;
  await page.click(`#modebar-tabs [data-mode="${m.id}"]`);
  const st = await settle();
  ok("builds", /ms$/.test(st), st);
  if (!/ms$/.test(st)) continue;

  const chips = await page.$$eval("#chips canvas", ns => ns.length);
  ok(`one chip per channel (${m.channels.length})`, chips === m.channels.length, "got " + chips);

  /* read the chip at its own size: a non-square mode comes back shorter than
     it is wide, and asking for a square region pads the rest with transparent
     black — which makes every channel look varied and hides a flat one */
  const flat = await page.evaluate(keys => keys.filter(k => {
    const cv = window.Forge.makeMap(k, 64);
    const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4)
      for (let c = 0; c < 3; c++) { const v = d[i + c]; if (v < lo) lo = v; if (v > hi) hi = v; }
    return hi - lo < 2;
  }), m.channels);
  console.log("       flat channels: " + (flat.join(", ") || "none"));

  for (const v of ["lit", ...m.tabs]) {
    await page.click(`#tabs [data-view="${v}"]`).catch(() => {});
    await page.waitForTimeout(150);
  }
  ok("every view tab renders", errors.length === before, errors.slice(before).join(" | "));
  await page.click(`#tabs [data-view="lit"]`).catch(() => {});
  await page.waitForTimeout(200);

  if (await page.evaluate(() => !document.getElementById("tiles").hidden)) {
    for (const key of ["basecolor", "height"]) {
      const r = await page.evaluate(seamRatio, [key, 256]);
      ok(`${key} tiles`, r.ratio <= 1.05,
        `wrap ${r.wrapX.toFixed(1)}/${r.wrapY.toFixed(1)} vs sharpest interior ${r.maxX.toFixed(1)}/${r.maxY.toFixed(1)}`);
    }
  } else {
    console.log("       (cut-out mode — seam check skipped)");
  }

  await page.screenshot({ path: path.join(SHOTS, `mode-${m.id}.png`) }).catch(() => {});
}

if (errors.length) { fails++; console.log("\npage errors:\n" + errors.join("\n")); }
console.log(fails ? `\nFAIL (${fails})` : "\nALL GOOD");
await browser.close();
process.exit(fails ? 1 : 0);
