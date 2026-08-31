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

/* ============================ the chrome ============================
   The frame is now doing real work — a searchable mode browser, typed values,
   a control filter — and all of it is the kind of thing that breaks silently. */
if (want("chrome")) {
  console.log("\n— chrome —");
  await page.click('#modebar-tabs [data-mode="factory"]');
  await settle();
  /* The wizard section ran before this one and left the factory drawing a
     whole elevation, where "tile covers" is not a control that exists. Sections
     inherit each other's state by design — they share one page — so a section
     that needs a particular row on screen says so.

     selectOption rather than Forge.setParam: setParam writes the value and
     marks the build stale but deliberately does not run the mode's derive or
     the row-visibility pass, so the panel would still be showing an elevation's
     controls. Driving the real control fires the real handler. */
  await page.selectOption("#factory--piece", "wall");
  await settle();

  /* a number you can type */
  await page.fill("#factory--tileW-val", "22.5");
  await page.dispatchEvent("#factory--tileW-val", "change");
  await settle();
  ok("a typed value reaches the parameters",
     Math.abs((await page.evaluate(() => window.Forge.state("factory").P.tileW)) - 22.5) < 1e-6,
     "P.tileW = " + (await page.evaluate(() => window.Forge.state("factory").P.tileW)));
  /* off-step is snapped, and the box is rewritten with what it landed on, so
     what you see is always what the generator got */
  await page.fill("#factory--tileW-val", "13.7");
  await page.dispatchEvent("#factory--tileW-val", "change");
  await settle();
  const shown = await page.inputValue("#factory--tileW-val");
  ok("off-step is snapped and the box says so",
     (await page.evaluate(() => window.Forge.state("factory").P.tileW)) === 13.5 &&
     parseFloat(shown) === 13.5, "box reads " + shown);
  /* out of range is clamped rather than accepted */
  await page.fill("#factory--tileW-val", "999");
  await page.dispatchEvent("#factory--tileW-val", "change");
  await settle();
  ok("out of range is held to the control's own limits",
     (await page.evaluate(() => window.Forge.state("factory").P.tileW)) === 40);
  await page.fill("#factory--tileW-val", "14");
  await page.dispatchEvent("#factory--tileW-val", "change");
  await settle();

  /* the control filter */
  await page.fill("#factory--find", "rivet");
  const none = await page.$$eval("#panel-factory .row:not(.nomatch):not([hidden])", n => n.length);
  await page.fill("#factory--find", "brick");
  const some = await page.$$eval("#panel-factory .row:not(.nomatch):not([hidden])", n => n.length);
  ok("the control filter hides what does not match", none === 0, none + " rows for 'rivet'");
  ok("and keeps what does", some > 0 && some < 40, some + " rows for 'brick'");
  await page.fill("#factory--find", "");

  /* the mode browser */
  await page.click("#browse");
  ok("the browser opens", !(await page.$eval("#modesheet", n => n.hidden)));
  const cards = await page.$$eval("#modegrid .modecard", n => n.length);
  ok("every mode has a card", cards === (await page.evaluate(() => window.Forge.modes.length)),
     cards + " cards");
  await page.fill("#modesearch", "neon");
  const hit = await page.$$eval("#modegrid .modecard:not([hidden])", n => n.map(c => c.dataset.mode));
  ok("it searches the blurbs, not just the names", hit.includes("diner"),
     "'neon' -> " + (hit.join(", ") || "nothing"));
  await page.keyboard.press("Enter");
  await settle();
  ok("Enter takes the first hit",
     (await page.evaluate(() => window.Forge.active().mode.id)) === "diner");
  ok("and closes behind itself", await page.$eval("#modesheet", n => n.hidden));

  /* the panel toggle survives a round trip */
  await page.click("#panelbtn");
  const off = await page.evaluate(() => document.body.dataset.panel);
  await page.click("#panelbtn");
  ok("the panel collapses and comes back", off === "off" &&
     (await page.evaluate(() => document.body.dataset.panel)) === "on");
  await page.click('#modebar-tabs [data-mode="factory"]');
  await settle();
}

/* ============================ worker threads ============================
   The pool cannot be reached from file:// — a worker there has no origin — so
   this section serves the directory over http for the length of it. That is
   also how the thing is actually deployed, and the rest of the suite stays on
   file:// on purpose, because the readme claims that works.

   The claim being tested is not "it is faster". It is that a build off the
   main thread is the SAME BUILD: identical bytes, from the same parameters,
   whichever thread ran it. A generator that quietly took a different path in a
   worker — a missing typeface, a canvas that antialiases differently — would
   be worse than no threading at all. */
if (want("threads")) {
  console.log("\n— worker threads —");
  const http = await import("node:http");
  const fs = await import("node:fs");
  const root = path.join(HERE, "..");
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".txt": "text/plain",
                  ".md": "text/markdown", ".png": "image/png" };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(root, rel);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port + "/index.html";

  const wp = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const werr = [];
  wp.on("pageerror", e => werr.push(e.message));
  wp.on("console", m => {
    if (m.type() === "error" && !/404|googleapis|ERR_CONNECTION/.test(m.text())) werr.push(m.text());
  });
  await wp.goto(base);
  const wsettle = async () => {
    for (let i = 0; i < 400; i++) {
      const s = await wp.evaluate(() => { const a = window.Forge.active(); return { b: !!a.busy, d: !!a.built }; });
      if (!s.b && s.d) return true;
      await wp.waitForTimeout(150);
    }
    return false;
  };
  await wsettle();

  const pool = await wp.evaluate(() => window.Forge.pool());
  ok("the pool comes up when it can be reached", !pool.off && pool.ready > 0, JSON.stringify(pool));

  /* every mode says whether it is safe off thread, and two of them say it
     depends on whether there is lettering on the build */
  const flags = await wp.evaluate(() => window.Forge.modes.map(m => ({
    id: m.id, t: typeof m.threadable === "function" ? "conditional" : !!m.threadable
  })));
  ok("every mode has an opinion about threading",
     flags.every(f => f.t !== undefined && f.t !== false),
     flags.filter(f => f.t !== true).map(f => f.id + ":" + f.t).join(", ") || "all plain true");

  /* THE CLAIM. Same parameters, both threads, byte for byte. */
  for (const id of ["factory", "vent", "slab", "hazard"]) {
    await wp.click(`#modebar-tabs [data-mode="${id}"]`);
    await wsettle();
    await wp.evaluate(m => window.Forge.setParam(m, "size", 256), id);
    await wp.click(`#${id}--forge`);
    await wsettle();
    const hashes = await wp.evaluate(async (mid) => {
      const st = window.Forge.state(mid);
      const grab = () => {
        const cv = window.Forge.makeMap("basecolor");
        const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
        let h = 2166136261 >>> 0;
        for (let i = 0; i < d.length; i += 7) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
        const n = window.Forge.makeMap("normal");
        const e = n.getContext("2d").getImageData(0, 0, n.width, n.height).data;
        for (let i = 0; i < e.length; i += 7) { h ^= e[i]; h = Math.imul(h, 16777619) >>> 0; }
        return h.toString(16);
      };
      const threaded = grab();
      /* now the same build with the pool refused, on this thread */
      const P = JSON.parse(JSON.stringify(st.P));
      const dim = st.mode.size(P, false);
      const B = await new Promise((res, rej) => {
        try {
          st.mode.build(P, { W: dim.w, H: dim.h, preview: false, progress: () => {}, done: res });
        } catch (e) { rej(e); }
      });
      B.W = dim.w; B.H = dim.h;
      const keep = st.B;
      st.B = B; window.Forge.state(mid).B = B;
      const main = grab();
      st.B = keep;
      return { threaded, main };
    }, id);
    ok(id + ": a worker build is the same build",
       hashes.threaded === hashes.main, hashes.threaded + " vs " + hashes.main);
  }

  /* and the wizard uses more than one of them */
  await wp.click('[data-struct="factory"]');
  await wsettle();
  await wp.evaluate(() => { for (const m of window.Forge.modes) window.Forge.setParam(m.id, "size", 256); });
  await wp.click("#wiz-all");
  for (let i = 0; i < 400; i++) {
    const t = await wp.$eval("#status", n => n.textContent);
    if (/packed|Could not/.test(t)) break;
    await wp.waitForTimeout(200);
  }
  const packed = await wp.$eval("#status", n => n.textContent);
  const after = await wp.evaluate(() => window.Forge.pool());
  ok("a structure packs across threads", /faces packed/.test(packed) && after.ready > 1,
     packed + " | " + JSON.stringify(after));
  ok("no errors on the threaded path", werr.length === 0, werr.slice(0, 3).join(" | "));
  await wp.close();
  await new Promise(r => server.close(r));
}

/* ============================ the GPU channel packer ============================
   The runtime races the two paths and picks the winner for the machine, so on
   a software rasteriser — which is what a headless browser has — it will
   correctly never choose the GPU. That is exactly why this forces it: the code
   still has to be right on the machines that do choose it, and "it matches the
   CPU path byte for byte" is the only claim worth making about it. */
if (want("gpu")) {
  console.log("\n— GPU channel packing —");
  const info = await page.evaluate(() => ({
    there: !!window.ForgeGPU,
    renderer: window.ForgeGPU ? window.ForgeGPU.renderer() : null,
    software: window.ForgeGPU ? window.ForgeGPU.software() : null,
    available: window.ForgeGPU ? window.ForgeGPU.available() : null
  }));
  ok("the packer is loaded", info.there);
  console.log("       renderer: " + info.renderer);
  ok("a software renderer is not offered as a fast path",
     !info.software || info.available === false,
     "software=" + info.software + " available=" + info.available);

  /* TWO MODES, and the second one is not padding. The factory writes its own
     emissive ramp, and the runtime therefore never sends its unlit bake to the
     GPU — the shader has no way to know a mode has replaced the ramp the bake
     reads. Checking the bake on the factory alone would either be skipped or,
     if the guard were bypassed, would compare the factory's ramp against the
     shader's default and fail for a reason that cannot reach a user. So the
     bake is checked on a mode that does NOT own its emissive, which is the
     only case the GPU ever actually renders it in. */
  for (const mode of ["factory", "conduit"]) {
  await page.click(`#modebar-tabs [data-mode="${mode}"]`);
  await settle();
  await page.evaluate(m => window.Forge.setParam(m, "size", 256), mode);
  await page.click(`#${mode}--forge`);
  await settle();

  const r = await page.evaluate(() => {
    const st = window.Forge.active();
    const out = [];
    for (const c of st.mode.channels) {
      const k = c.key;
      if (!window.ForgeGPU.handles(k)) continue;
      if (st.custom && (k in st.custom)) continue;
      /* the same rule the runtime applies in makeMap */
      if (k === "unlit" && st.custom && ("emissive" in st.custom)) continue;
      window.ForgeGPU.force(true);
      const g = window.ForgeGPU.channel(st.B, k, st.B.W, st.B.H);
      window.ForgeGPU.force(null);
      if (!g) { out.push({ k, fail: "the GPU path returned nothing" }); continue; }
      const c2 = document.createElement("canvas");
      c2.width = st.B.W; c2.height = st.B.H;
      const ctx = c2.getContext("2d");
      const img = ctx.createImageData(st.B.W, st.B.H), o = img.data;
      const w = st.writers[k];
      for (let i = 0; i < st.B.W * st.B.H; i++) o[i * 4 + 3] = w(i, o, i * 4);
      const gd = g.getContext("2d").getImageData(0, 0, g.width, g.height).data;
      let n = 0, worst = 0;
      for (let i = 0; i < gd.length; i++) {
        const d = Math.abs(gd[i] - o[i]);
        if (d) { n++; if (d > worst) worst = d; }
      }
      out.push({ k, n, worst, of: gd.length });
    }
    return out;
  });
  for (const d of r) {
    if (d.fail) { ok(d.k + ": renders", false, d.fail); continue; }
    /* the height field is the one channel where the two arithmetics can
       disagree — a float divide on the GPU against a double one in JS — and a
       single least-significant bit on a handful of texels is the whole of it */
    /* Two channels are allowed to disagree, and only these two. The height
       field by one code value — a float divide on the GPU against a double one
       in JS. The unlit bake by two, because it is the one channel running pow,
       sqrt and a divide where the rest are copies, scales and rounds; it is a
       picture rather than data anybody reads a value out of. */
    const bar = d.k === "height" ? 1 : d.k === "unlit" ? 2 : 0;
    ok(mode + " " + d.k + ": GPU matches the CPU path", d.worst <= bar,
       d.n + " of " + d.of + " bytes differ, worst by " + d.worst);
  }
  }
}

/* ============================ geometry out ============================
   The exporter's contract is that a mode's plan() is in METRES and the glTF
   it produces is at true scale — so this checks the numbers rather than that
   the file merely parses. A mode reporting feet as metres would give a house
   three times too big and nothing else in the app would notice. */
if (want("model")) {
  console.log("\n— geometry —");
  const R = await page.evaluate(() => {
    const M = window.ForgeModel;
    if (!M) return { missing: true };
    const out = { plans: [], guessed: [] };
    for (const m of window.Forge.modes) {
      const st = window.Forge.state(m.id);
      const p = M.planOf(m, st.P);
      if (p.guessed) out.guessed.push(m.id);
      else out.plans.push({ id: m.id, w: p.w, h: p.h, cutout: p.cutout, eaves: p.eaves });
    }
    const maps = { basecolor: "a_basecolor.png", normal: "a_normal.png",
                   orm: "a_orm.png", roughness: "a_r.png", metallic: "a_m.png",
                   opacity: "a_o.png" };
    const face = { plan: { w: 8, h: 6, eaves: 5, cutout: true,
                           roof: { kind: "gable", pitch: 6, ridge: "x" } },
                   material: { name: "front", maps, cutout: true } };
    const side = { plan: { w: 10, h: 7.5, eaves: 5, cutout: true },
                   material: { name: "side", maps, cutout: true } };
    const roof = { plan: { w: 2, h: 2, tile: 2, cutout: false },
                   material: { name: "roof", maps, cutout: false } };
    const S = M.buildingScene("t", { front: face, side, back: face, roof });
    const doc = JSON.parse(M.gltf(S));
    const objText = M.obj(S, "model.mtl");
    let lo = Infinity, hi = -Infinity;
    for (const a of doc.accessors) if (a.type === "VEC3" && a.min) {
      lo = Math.min(lo, a.min[1]); hi = Math.max(hi, a.max[1]);
    }
    return Object.assign(out, {
      meshes: doc.meshes.length, materials: doc.materials.length,
      mask: doc.materials.filter(m => m.alphaMode === "MASK").length,
      packed: doc.materials.filter(m => m.occlusionTexture &&
        m.pbrMetallicRoughness.metallicRoughnessTexture &&
        m.occlusionTexture.index === m.pbrMetallicRoughness.metallicRoughnessTexture.index).length,
      yLo: lo, yHi: hi,
      bufOK: doc.buffers[0].uri.startsWith("data:application/octet-stream;base64,"),
      objVerts: (objText.match(/^v /gm) || []).length,
      objFaces: (objText.match(/^f /gm) || []).length
    });
  });
  ok("the exporter is loaded", !R.missing);
  if (!R.missing) {
    ok("a building is five planes", R.meshes === 5, R.meshes + " meshes");
    ok("three materials, one per face", R.materials === 3, R.materials + " materials");
    ok("cut-out faces mask their alpha", R.mask === 2, R.mask + " of 3 masked");
    ok("orm.png serves occlusion AND metallic-roughness", R.packed === 3,
       R.packed + " materials share the one packed image");
    ok("the buffer is inline", R.bufOK);
    ok("the roof closes the gable exactly", Math.abs(R.yHi - 7.5) < 0.001,
       "ridge at " + R.yHi.toFixed(3) + " m, the gable face is 7.5 m tall");
    ok("the walls stand on the ground", Math.abs(R.yLo) < 1e-6, "lowest y " + R.yLo);
    ok("the OBJ carries the same geometry", R.objVerts === 24 && R.objFaces === 12,
       R.objVerts + " verts, " + R.objFaces + " faces");
    /* the check that catches a unit slip: a house is about eight metres wide,
       not eight feet and not twenty-six */
    const byId = Object.fromEntries(R.plans.map(p => [p.id, p]));
    if (byId.house) ok("the house reports metres, not feet",
                       byId.house.w > 5 && byId.house.w < 25, byId.house.w.toFixed(2) + " m wide");
    if (byId.factory) ok("the factory reports a real works", byId.factory.w > 4,
                         byId.factory.w.toFixed(2) + " m");
    if (byId.roof) ok("the roof reports its repeat in metres",
                      byId.roof.w > 0.3 && byId.roof.w < 8, byId.roof.w.toFixed(3) + " m");
    if (byId.vent) ok("the vent reports millimetres as metres",
                      byId.vent.w > 0.05 && byId.vent.w < 5, byId.vent.w.toFixed(3) + " m");
    console.log("       no declared size (1 m plane, and the readme says so): " +
                (R.guessed.join(", ") || "none"));
  }
}

/* ============================ the unlit bake ============================
   The bake is the one channel derived from the OTHERS rather than from the
   generator, so what is checked here is that it is on every mode, that it
   answers its own controls rather than the preview's, that its palette is
   genuinely independent of the palette bar, and that it is not quietly the
   base colour with a curve on it. */
if (want("bake")) {
  console.log("\n— the unlit bake —");
  const there = await page.evaluate(() => !!window.ForgeUnlit);
  ok("the bake module is loaded", there);

  const missing = await page.evaluate(() =>
    window.Forge.modes.filter(m => m.channels.filter(c => c.key === "unlit").length !== 1)
      .map(m => m.id));
  ok("every mode carries exactly one unlit channel", missing.length === 0,
     missing.length ? "missing or duplicated on: " + missing.join(", ") : "");

  await page.click('#modebar-tabs [data-mode="vent"]');
  await settle();
  await page.evaluate(() => window.Forge.setParam("vent", "size", 256));
  await page.click("#vent--forge");
  await settle();

  /* a bake that does not move when the key moves is a stale closure, which is
     exactly what this was the first time it was written */
  const sig = () => page.evaluate(() => {
    const cv = window.Forge.makeMap("unlit", 96);
    return cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data.join(",");
  });
  const a0 = await sig();
  await page.evaluate(() => window.ForgeUnlit.set("az", 135));
  const a1 = await sig();
  await page.evaluate(() => window.ForgeUnlit.set("az", 315));
  const a2 = await sig();
  ok("the bake follows its own key light", a0 !== a1);
  ok("and comes back when the key does", a0 === a2);

  /* it must not simply be the albedo: if AO, the normal and the sky are doing
     nothing then this is a tone curve, not a bake */
  const differs = await page.evaluate(() => {
    const u = window.Forge.makeMap("unlit", 96).getContext("2d")
      .getImageData(0, 0, 96, 96).data;
    const a = window.Forge.makeMap("basecolor", 96).getContext("2d")
      .getImageData(0, 0, 96, 96).data;
    let n = 0;
    for (let i = 0; i < u.length; i += 4) if (Math.abs(u[i] - a[i]) > 6) n++;
    return n / (u.length / 4);
  });
  ok("the bake is a render, not a curve on the albedo", differs > 0.35,
     (differs * 100).toFixed(0) + "% of texels differ from base colour");

  /* the AO amount has to reach the picture, since on an unlit target it is
     doing the work every runtime darkening trick would otherwise do */
  const aoMoves = await page.evaluate(async () => {
    const s = () => window.Forge.makeMap("unlit", 64).getContext("2d")
      .getImageData(0, 0, 64, 64).data.join(",");
    const before = s();
    window.ForgeUnlit.set("ao", 2);
    const after = s();
    window.ForgeUnlit.set("ao", 1);
    return before !== after;
  });
  ok("the AO amount reaches the bake", aoMoves);

  /* the whole point of a separate profile: quantise one, not the other */
  const pal = await page.evaluate(async () => {
    window.ForgeUnlit.set("palId", "rgb8");
    window.ForgeUnlit.set("palDither", "none");
    const count = k => {
      const cv = window.Forge.makeMap(k, 96);
      const d = cv.getContext("2d").getImageData(0, 0, 96, 96).data;
      const set = new Set();
      for (let i = 0; i < d.length; i += 4) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return set.size;
    };
    const r = { unlit: count("unlit"), base: count("basecolor") };
    window.ForgeUnlit.set("palId", "none");
    return r;
  });
  ok("the bake's palette quantises the bake", pal.unlit <= 512,
     pal.unlit + " colours in unlit.png at RGB 8·8·8");
  ok("and leaves the base colour alone", pal.base > 512,
     pal.base + " colours still in basecolor.png");

  const said = await page.evaluate(() => window.ForgeUnlit.describe());
  ok("the settings are written down for the readme", /az/.test(said) && /exposure/.test(said),
     said.slice(0, 60) + "…");
}

/* ============================ the conduit loom ============================
   A mode whose subject is depth, so the checks are about depth: that the
   layers actually occupy different heights, that a group is a group, and that
   the seamless piece closes.  */
if (want("conduit")) {
  console.log("\n— the conduit loom —");
  await page.click('#modebar-tabs [data-mode="conduit"]');
  await settle();
  await page.evaluate(() => window.Forge.setParam("conduit", "size", 512));
  await page.click("#conduit--forge");
  const st = await settle();
  ok("the loom builds", st !== "TIMEOUT", st);

  const R = await page.evaluate(() => {
    const B = window.Forge.active().B, W = B.W, H = B.H, N = W * H;
    /* how much of the cavity depth the height field actually uses, and how
       evenly — a loom that came out as one layer would have a spike */
    const lo = B.hMin, hi = B.hMax, span = hi - lo;
    const bins = new Array(10).fill(0);
    for (let i = 0; i < N; i++) {
      const t = (B.HGT[i] - lo) / (span || 1);
      bins[Math.min(9, Math.max(0, Math.floor(t * 10)))]++;
    }
    const used = bins.filter(b => b > N * 0.01).length;
    /* the seam, against a typical interior column */
    const d = (a, st2, x1, x2) => {
      let s = 0;
      for (let y = 0; y < H; y++) s += Math.abs(a[(y * W + x1) * st2] - a[(y * W + x2) * st2]);
      return s / H;
    };
    const dr = (a, st2, y1, y2) => {
      let s = 0;
      for (let x = 0; x < W; x++) s += Math.abs(a[(y1 * W + x) * st2] - a[(y2 * W + x) * st2]);
      return s / W;
    };
    let inX = 0, inY = 0;
    for (let k = 1; k <= 8; k++) { inX += d(B.A, 3, k * 50, k * 50 + 1); inY += dr(B.A, 3, k * 50, k * 50 + 1); }
    return {
      span, used,
      wrapX: d(B.A, 3, W - 1, 0), inX: inX / 8,
      wrapY: dr(B.A, 3, H - 1, 0), inY: inY / 8,
      plan: window.Forge.byId["conduit"].plan(window.Forge.active().P)
    };
  });
  /* the cavity is 95 mm by default and the loom has to be spread through it,
     not sitting in one plane at the bottom of it */
  ok("the loom occupies the whole cavity", R.span > 0.05 && R.span < 0.30,
     (R.span * 1000).toFixed(0) + " mm of relief");
  ok("the layers are spread through it, not stacked in one plane", R.used >= 5,
     R.used + " of 10 height bands carry real area");

  /* a seam that is no worse than any other pair of neighbouring columns is not
     a seam; comparing it against a fixed threshold would only measure how busy
     the mode is */
  ok("the tile wraps left to right", R.wrapX <= R.inX * 1.35,
     R.wrapX.toFixed(1) + " across the wrap vs " + R.inX.toFixed(1) + " inside");
  ok("and top to bottom", R.wrapY <= R.inY * 1.35,
     R.wrapY.toFixed(1) + " across the wrap vs " + R.inY.toFixed(1) + " inside");
  ok("it reports a real panel size in metres", R.plan.w > 0.15 && R.plan.w < 2.5,
     R.plan.w.toFixed(3) + " m");
  ok("the seamless piece is not a cut-out", R.plan.cutout === false);

  /* and the framed piece is, with a silhouette that is actually cut */
  await page.selectOption("#conduit--piece", "bay");
  await page.click("#conduit--forge");
  await settle();
  const bay = await page.evaluate(() => {
    const st2 = window.Forge.active(), B = st2.B, N = B.W * B.H;
    let clear = 0, solid = 0;
    for (let i = 0; i < N; i++) { if (B.ALP[i] < 8) clear++; else if (B.ALP[i] > 247) solid++; }
    return {
      clear: clear / N, solid: solid / N,
      cutout: window.Forge.byId["conduit"].plan(st2.P).cutout
    };
  });
  ok("the bay is a cut-out piece", bay.cutout === true);
  /* the bug this is here for: a silhouette seeded at zero rather than −1 puts
     every texel in the middle of the anti-aliasing band, and the whole piece
     comes out a uniform ghost */
  ok("the bay silhouette is opaque in the middle", bay.solid > 0.5,
     (bay.solid * 100).toFixed(1) + "% fully opaque");
  ok("and cut away at the corners", bay.clear > 0.001 && bay.clear < 0.25,
     (bay.clear * 100).toFixed(2) + "% fully clear");
  await page.selectOption("#conduit--piece", "tile");
}

if (errors.length) { fails++; console.log("\npage errors:\n" + errors.join("\n")); }
console.log(fails ? `\nFAIL (${fails})` : "\nALL GOOD");
await browser.close();
/* NOT process.exit(): it does not wait for stdout to drain, and piping this
   into anything — a grep, a log file, CI — was losing the last few lines,
   including the verdict. Setting the code lets node exit on its own once the
   output is out. */
process.exitCode = fails ? 1 : 0;
