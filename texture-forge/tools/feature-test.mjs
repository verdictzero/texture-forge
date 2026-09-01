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
    /* THE WRAP AGAINST A DELIBERATELY WRONG PAIRING, which is what a broken
       wrap would BE: the last row against rows it has nothing to do with. A
       fixed multiple of a handful of interior pairs measures how busy the mode
       is more than whether it wraps — a loom is quiet plate with a few busy
       rows through it, so eight arbitrary rows are a low bar that any row
       carrying a run along it clears, seam or no seam. Measured over eight
       seeds and both modes, a wrap that closes comes out at 0.1–0.6 of the
       wrong pairing and a wrong pairing is 1.0 by construction. */
    const mism = (a, st2, f, at) => (at.reduce((t, k) => t + f(a, st2, k[0], k[1]), 0)) / at.length;
    return {
      span, used,
      wrapX: d(B.A, 3, W - 1, 0),
      bogX: mism(B.A, 3, d, [[W - 1, W >> 1], [W - 1, W >> 2], [W - 1, (3 * W) >> 2]]),
      wrapY: dr(B.A, 3, H - 1, 0),
      bogY: mism(B.A, 3, dr, [[H - 1, H >> 1], [H - 1, H >> 2], [H - 1, (3 * H) >> 2]]),
      plan: window.Forge.byId["conduit"].plan(window.Forge.active().P)
    };
  });
  /* the cavity is 95 mm by default and the loom has to be spread through it,
     not sitting in one plane at the bottom of it */
  ok("the loom occupies the whole cavity", R.span > 0.05 && R.span < 0.30,
     (R.span * 1000).toFixed(0) + " mm of relief");
  ok("the layers are spread through it, not stacked in one plane", R.used >= 5,
     R.used + " of 10 height bands carry real area");

  /* a wrap that closes agrees with itself far better than two rows picked at
     random do; a wrap that does not is exactly a pair picked at random */
  ok("the tile wraps left to right", R.wrapX <= R.bogX * 0.65,
     R.wrapX.toFixed(1) + " across the wrap vs " + R.bogX.toFixed(1) +
     " for columns that do not belong together");
  ok("and top to bottom", R.wrapY <= R.bogY * 0.65,
     R.wrapY.toFixed(1) + " across the wrap vs " + R.bogY.toFixed(1) +
     " for rows that do not belong together");
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

/* ==================== where a run is allowed to stop ====================
   Nothing may end in mid-air. A run either has NO ENDS — it is a closed curve
   with a whole number of tiles of winding, so it leaves one edge, arrives at
   the other and comes back to where it started — or it terminates in a
   junction box bolted to the backplane, or (in a framed bay) leaves through
   the frame.

   A BOX IS THE ONLY FLAT THING IN THE PICTURE, which is what makes this
   measurable from outside. Every other surface a loom has is curved: a
   conduit's crown falls a thirtieth of a millimetre a texel, a fillet turns, a
   backplane oil-cans. A cast lid does not move at all. So the check counts
   texels standing above the first stratum whose whole eight-neighbourhood is
   identical to within a micron, and compares a build where every run is asked
   to be endless against one where none is: the second is thick with boxes and
   the first has next to none. */
if (want("ends")) {
  console.log("\n— where a run is allowed to stop —");

  const flatAt = (mode, cfg) => page.evaluate(async ([m, c]) => {
    for (const k in c) window.Forge.setParam(m, k, c[k]);
    return null;
  }, [mode, cfg]);

  const measure = mode => page.evaluate(m => {
    const st = window.Forge.active(), B = st.B, W = B.W, H = B.H, HG = B.HGT;
    const floor = window.Forge.byId[m].plan(st.P).strata[0] + 0.002;
    const flat = new Uint8Array(W * H);
    let above = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, h = HG[i];
      if (h <= floor) continue;
      above++;
      let same = true;
      for (let dy = -1; dy <= 1 && same; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (Math.abs(HG[i + dy * W + dx] - h) > 1e-6) { same = false; break; }
      if (same) flat[i] = 1;
    }
    /* COUNT THE PLATEAUX, NOT THEIR AREA. A box's area depends on the bundle
       it swallows and on how long the run got, so an area is as much a measure
       of what size things came out as of how many of them there are. How many
       separate dead-flat islands there are is a count of lids. */
    const seen = new Uint8Array(W * H), stack = new Int32Array(W * H);
    let plateaux = 0;
    for (let s0 = 0; s0 < W * H; s0++) {
      if (!flat[s0] || seen[s0]) continue;
      let sp = 0; stack[sp++] = s0; seen[s0] = 1; let n = 0;
      while (sp > 0) {
        const i = stack[--sp]; n++;
        const x = i % W, y = (i / W) | 0;
        const nb = [((x + 1) % W) + y * W, ((x + W - 1) % W) + y * W,
                    x + ((y + 1) % H) * W, x + ((y + H - 1) % H) * W];
        for (const j of nb) if (flat[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j; }
      }
      if (n > 300) plateaux++;
    }
    return { plateaux, above: above / (W * H) };
  }, mode);

  /* a deliberately bare build: the only flat things left in it are lids */
  const bare = {
    size: 512, piece: "tile", clampAmt: 0, tieAmt: 0, braceAmt: 0, lamps: 0,
    wRibbon: 0, ribHMm: 0, holeMm: 0, mCurve: 0, mGrain: 0, mDust: 0,
    oil: 0, dust: 0, heat: 0, scuff: 0
  };

  for (const mode of ["conduit", "raceway"]) {
    await page.click(`#modebar-tabs [data-mode="${mode}"]`);
    await settle();

    const census = () => page.evaluate(() => window.Forge.active().B.census);

    await flatAt(mode, { ...bare, endless: 0 });
    await page.click(`#${mode}--forge`); await settle();
    const none = await measure(mode), nc = await census();

    await flatAt(mode, { ...bare, endless: 1 });
    await page.click(`#${mode}--forge`); await settle();
    const all = await measure(mode), ac = await census();

    /* the bug this is here for: a run left to stop where its length ran out,
       which is a cable sawn through in mid-air */
    /* THE COUNT COMES OFF THE BUILD, not off the picture. Whether a loop closed
       and whether a box had room are decided while a run is laid, and no amount
       of measuring the height field afterwards recovers it: a box's area
       depends on the bundle it swallows and on how long the run got, so an area
       is as much a measure of what size things came out as of how many. */
    const ends = c => c.bundles * 2 - c.closed * 2;

    /* the bug this is here for: a run left to stop where its length ran out,
       which is a cable sawn through in mid-air */
    ok(mode + ": nothing is left ending in nothing",
       nc.closed === 0 && nc.boxes + nc.glands + nc.tees === ends(nc),
       nc.bundles + " runs: " + nc.boxes + " boxes, " + nc.glands +
       " grommets and " + nc.tees + " breakouts over " + ends(nc) + " ends");
    ok(mode + ": and a box is what almost all of them get",
       nc.glands <= ends(nc) * 0.25,
       nc.glands + " of " + ends(nc) + " ends fell back to a grommet");
    ok(mode + ": asking for endless runs gets them",
       ac.closed >= ac.bundles * 0.3 && ac.boxes < nc.boxes,
       ac.closed + " of " + ac.bundles + " runs closed, leaving " + ac.boxes +
       " boxes against " + nc.boxes);
    /* and a box is a real object in the height field, not only a flag */
    ok(mode + ": the boxes are really there", none.plateaux >= 6,
       none.plateaux + " dead-flat plateaux — nothing else in a loom is flat");

    /* closing them must not empty the picture out */
    ok(mode + ": closing the runs does not empty the bay", all.above > none.above * 0.6,
       (all.above * 100).toFixed(0) + "% of the tile still stands proud, " +
       "against " + (none.above * 100).toFixed(0) + "%");
  }

  /* greeble's dead ends, where the box is the one fitting that is NOT optional */
  await page.click('#modebar-tabs [data-mode="greeble"]');
  await settle();
  const gcfg = { size: 512, tileM: 1, pipes: 1, pipeGrid: 5, pipeD: 70,
                 pipeGauge: 1, pipeLayers: 1, pipeRise: 0.6, blockH: 22,
                 pipeFit: 0, mGrain: 0, mDust: 0, mCurve: 0 };
  await page.evaluate(c => { for (const k in c) window.Forge.setParam("greeble", k, c[k]); }, gcfg);
  await page.click("#greeble--forge"); await settle();
  const gm = await page.evaluate(c => {
    const B = window.Forge.active().B;
    const MM = 0.001 / c.tileM;
    const R0 = Math.min(c.pipeD * MM * 0.5, 0.38 / c.pipeGrid);
    const seat = c.blockH * MM * c.pipeRise;
    return { hMax: B.hMax, crown: seat + R0, box: seat + R0 * 1.22 };
  }, gcfg);
  /* with the fittings slider at zero there are no couplings and no elbows, so
     anything standing above a bare pipe's crown is a junction box — and there
     has to be one, because a dead end is not optional */
  ok("greeble: a dead end gets its box even with fittings off", gm.hMax >= gm.box,
     "tallest " + (gm.hMax * 1000).toFixed(1) + " vs a bare crown at " +
     (gm.crown * 1000).toFixed(1) + " and a box at " + (gm.box * 1000).toFixed(1) +
     " tile-thousandths");
}

/* ==================== greeble's conduit, stacked ====================
   The third routing model, and the oldest: a walker on a lattice rather than a
   polyline. It gained the same two properties by a different mechanism — a
   route may not enter a node another route ON ITS LAYER holds, and each layer
   stands a fat pipe's clearance above the one below — so what is checked here
   is that the second height is real and carries conduit, which a single-layer
   build cannot produce however dense it is. */
if (want("greeble")) {
  console.log("\n— greeble's stacked conduit —");
  await page.click('#modebar-tabs [data-mode="greeble"]');
  await settle();
  const set = async o => {
    await page.evaluate(c => { for (const k in c) window.Forge.setParam("greeble", k, c[k]); }, o);
    await page.click("#greeble--forge");
    await settle();
  };
  const above = cut => page.evaluate(c => {
    const B = window.Forge.active().B, HG = B.HGT;
    let a = 0;
    for (let i = 0; i < HG.length; i++) if (HG[i] > c) a++;
    return a / HG.length;
  }, cut);
  const hMax = () => page.evaluate(() => window.Forge.active().B.hMax);

  const base = { size: 512, tileM: 2, pipes: 1, pipeGrid: 6, pipeD: 60,
                 pipeGauge: 3, pipeFit: 0.9 };

  await set({ ...base, pipeLayers: 1 });
  const h1 = await hMax();

  await set({ ...base, pipeLayers: 3 });
  const h3 = await hMax(), over = await above(h1);

  /* the bug this is here for: layers that are only a painting order and not a
     height, which leaves every run in one plane and every crossing a fused
     lump — the whole point of the change */
  ok("greeble: a second layer is a second height", h3 > h1 * 1.15,
     "tallest thing " + (h1 * 1000).toFixed(1) + " → " + (h3 * 1000).toFixed(1) +
     " tile-thousandths");
  /* and it is not just headroom: a real fraction of the tile is conduit sitting
     ABOVE everything a flat build can reach, blocks and all */
  ok("greeble: the upper layers carry conduit, not just headroom", over > 0.003,
     (over * 100).toFixed(1) + "% of the tile stands above anything a " +
     "single-layer build reaches");
}

/* ==================== the strata, and keeping out of each other ====================
   The two properties the loom library exists to guarantee, checked on both
   routing models: that a layer clears the one under it, and that nothing in a
   layer passes through anything else in it.

   THE SECOND ONE IS TOPOLOGICAL, because it has to be. Two bundles crossing at
   the same height do not stack — the stamp Z-tests, so the taller sample wins
   and the crossing leaves no extra relief to measure. What it leaves is a
   MERGE: two islands of conduit become one. So the check builds a deliberately
   bare configuration — one layer, eight single conduits, no clamps, no braces,
   a flat backplane — and counts the connected islands standing above the
   layer's floor. Eight runs that never touch leave separate islands; the same
   eight before this work fused into one, measured. */
if (want("strata")) {
  console.log("\n— the strata, and keeping out of each other —");

  const bare = {
    size: 512, piece: "tile", layers: 1, bundles: 8, groupMax: 1,
    clampAmt: 0, tieAmt: 0, braceAmt: 0, branches: 0, lamps: 0,
    ribHMm: 0, holeMm: 0, mCurve: 0, mGrain: 0, mDust: 0
  };

  for (const mode of ["conduit", "raceway"]) {
    await page.click(`#modebar-tabs [data-mode="${mode}"]`);
    await settle();

    /* first the stack, at the mode's own defaults */
    const st = await page.evaluate(m => {
      const P = window.Forge.active().P;
      return window.Forge.byId[m].plan(P);
    }, mode);
    let clears = true, rising = true;
    for (let l = 1; l < st.strata.length; l++) {
      if (st.strata[l] <= st.strata[l - 1]) rising = false;
      if (st.strata[l] < st.strata[l - 1] + st.crowns[l - 1] - 1e-9) clears = false;
    }
    ok(mode + ": the layers rise", rising,
       st.strata.map(z => (z * 1000).toFixed(0)).join(", ") + " mm");
    /* the bug this is here for: spreading the layers evenly over the cavity
       puts a 23 mm conduit on a stratum 13 mm below the next one, so the fat
       runs stand up through two layers and the strata never read */
    ok(mode + ": each layer clears the tallest thing under it", clears,
       "crowns " + st.crowns.map(h => (h * 1000).toFixed(0)).join(", ") + " mm");

    const cav = await page.evaluate(() => +window.Forge.active().P.cavityMm / 1000);
    ok(mode + ": the stack fits the cavity", st.stackM <= cav + 1e-9,
       (st.stackM * 1000).toFixed(0) + " mm of stack in a " +
       (cav * 1000).toFixed(0) + " mm cavity" +
       (st.gaugeScale < 0.995 ? " (gauges cut to " + Math.round(st.gaugeScale * 100) + "%)" : ""));

    /* then the islands, on a deliberately bare configuration — and put the
       mode back afterwards, because the sections below share these modes and
       inherit whatever is left set on them */
    const was = await page.evaluate(([m, c]) => {
      const P = window.Forge.active().P, keep = {};
      for (const k in c) { keep[k] = P[k]; window.Forge.setParam(m, k, c[k]); }
      return keep;
    }, [mode, bare]);
    await page.click(`#${mode}--forge`);
    await settle();
    const isl = await page.evaluate(m => {
      const stt = window.Forge.active(), B = stt.B, W = B.W, H = B.H, HG = B.HGT;
      const pl = window.Forge.byId[m].plan(stt.P);
      const cut = pl.strata[0] + pl.crowns[0] * 0.15;
      const mask = new Uint8Array(W * H);
      let area = 0;
      for (let i = 0; i < W * H; i++) if (HG[i] > cut) { mask[i] = 1; area++; }
      /* four-connected, ON THE TORUS: a run that leaves one edge and arrives at
         the other is one island, not two */
      const seen = new Uint8Array(W * H), stack = new Int32Array(W * H), sizes = [];
      for (let s0 = 0; s0 < W * H; s0++) {
        if (!mask[s0] || seen[s0]) continue;
        let sp = 0; stack[sp++] = s0; seen[s0] = 1; let n = 0;
        while (sp > 0) {
          const i = stack[--sp]; n++;
          const x = i % W, y = (i / W) | 0;
          const nb = [((x + 1) % W) + y * W, ((x + W - 1) % W) + y * W,
                      x + ((y + 1) % H) * W, x + ((y + H - 1) % H) * W];
          for (const j of nb) if (mask[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j; }
        }
        sizes.push(n);
      }
      return { area: area / (W * H), big: sizes.filter(n => n > W * H * 0.002).length };
    }, mode);
    ok(mode + ": eight runs on one layer stay eight things", isl.big >= 5,
       isl.big + " separate islands over " + (isl.area * 100).toFixed(1) +
       "% of the tile — fused, this is 1");
    await page.evaluate(([m, c]) => { for (const k in c) window.Forge.setParam(m, k, c[k]); },
                        [mode, was]);
  }

  /* and the machinery underneath, on its own terms */
  const lib = await page.evaluate(() => {
    const L = window.ForgeLoom;
    const g = { bay: false, Wm: 0.62, Hm: 0.62, TW: 512, TH: 512, pxM: 512 / 0.62, mpp: 0.62 / 512 };
    const C = L.claims(g, 0.004);
    const o = {};
    C.span(0.30, 0.30, 1, 0, 0.01);
    o.marks = C.taken(0.30, 0.30) && !C.taken(0.30, 0.34);
    /* the width test has to find a claimed band lying between its samples */
    o.width = !C.clearAt(0.30, 0.28, 0, 1, 0.03);
    C.clear();
    /* the tile is a torus: a span laid across x = 0 is claimed at x = Wm too */
    C.span(0.001, 0.5, 0, 1, 0.006);
    o.wraps = C.taken(0.001, 0.5) && C.taken(0.001, 0.4945);
    C.clear();
    o.cleared = !C.taken(0.30, 0.30);
    /* the trail holds its marks back so a route does not trip over its own feet */
    const T = C.trail(0.01, 10);
    for (let i = 0; i < 5; i++) T.push(0.1 + i * 0.001, 0.1, 0, 1);
    o.lagged = !C.taken(0.1, 0.1);
    T.flush();
    o.flushed = C.taken(0.1, 0.1);

    /* the stack: a fat layer under a thin one has to push it up by the fat one */
    const S = L.strata([{ layer: 0, kind: 0, r: 0.020, fitK: 0 },
                        { layer: 1, kind: 0, r: 0.004, fitK: 0 }], 2, 0.30, 0, 0);
    o.stacked = S.z[1] >= S.z[0] + L.standing(0, 0.020, 0) - 1e-9 && S.scale === 1;
    /* and a stack that does not fit is scaled until it does */
    const T2 = L.strata([{ layer: 0, kind: 0, r: 0.050, fitK: 0 },
                         { layer: 1, kind: 0, r: 0.050, fitK: 0 }], 2, 0.05, 0, 0);
    o.scaled = T2.scale < 1 && T2.top <= 0.05 + 1e-9;
    return o;
  });
  ok("claims: a span marks the ground it covers and nothing else", lib.marks);
  ok("claims: a band between the width samples is still found", lib.width);
  ok("claims: the grid wraps with the tile", lib.wraps);
  ok("claims: clearing empties it", lib.cleared);
  ok("claims: the trail lags, then flushes", lib.lagged && lib.flushed);
  ok("strata: a layer starts above the crown of the one below", lib.stacked);
  ok("strata: a stack too deep for the cavity is scaled to fit", lib.scaled);
}

/* ============================ the raceway ============================
   The second routing model over the same loom library. What makes it a
   different mode is that everything is axis-aligned between filleted corners,
   so that is what gets measured — and measured against the wandering one next
   door rather than against a number picked out of the air, because "how
   orthogonal is this picture" has no absolute scale. */
if (want("raceway")) {
  console.log("\n— the conduit raceway —");

  /* the fraction of strongly-sloped texels whose height gradient points within
     12° of an axis. A raceway's straights are all axis-aligned, so their edges
     are too; a hand-dressed loom's runs point anywhere. */
  const axisness = async id => {
    await page.click(`#modebar-tabs [data-mode="${id}"]`);
    await settle();
    await page.evaluate(m => window.Forge.setParam(m, "size", 512), id);
    await page.click(`#${id}--forge`);
    await settle();
    return await page.evaluate(() => {
      const B = window.Forge.active().B, W = B.W, H = B.H, HGT = B.HGT;
      let on = 0, tot = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const dx = HGT[i + 1] - HGT[i - 1], dy = HGT[i + W] - HGT[i - W];
        const m = Math.hypot(dx, dy);
        if (m < 1e-4) continue;
        tot++;
        let a = Math.atan2(dy, dx) * 180 / Math.PI;
        a = Math.abs(((a % 90) + 90) % 90);      // fold onto 0..90
        if (a < 12 || a > 78) on++;
      }
      return tot ? on / tot : 0;
    });
  };
  const race = await axisness("raceway");
  const loom = await axisness("conduit");
  ok("the raceway builds", race > 0);
  ok("its runs are axis-aligned, and the loom's are not",
     race > loom * 1.25,
     "within 12° of an axis: raceway " + (race * 100).toFixed(1) +
     "%, conduit " + (loom * 100).toFixed(1) + "%");

  await page.click('#modebar-tabs [data-mode="raceway"]');
  await settle();
  const R = await page.evaluate(() => {
    const B = window.Forge.active().B, W = B.W, H = B.H;
    const d = (a, st, x1, x2) => {
      let s = 0;
      for (let y = 0; y < H; y++) s += Math.abs(a[(y * W + x1) * st] - a[(y * W + x2) * st]);
      return s / H;
    };
    const dr = (a, st, y1, y2) => {
      let s = 0;
      for (let x = 0; x < W; x++) s += Math.abs(a[(y1 * W + x) * st] - a[(y2 * W + x) * st]);
      return s / W;
    };
    const mism = (a, st, f, at) => (at.reduce((t, k) => t + f(a, st, k[0], k[1]), 0)) / at.length;
    return { wrapX: d(B.A, 3, W - 1, 0),
             bogX: mism(B.A, 3, d, [[W - 1, W >> 1], [W - 1, W >> 2], [W - 1, (3 * W) >> 2]]),
             wrapY: dr(B.A, 3, H - 1, 0),
             bogY: mism(B.A, 3, dr, [[H - 1, H >> 1], [H - 1, H >> 2], [H - 1, (3 * H) >> 2]]),
             span: B.hMax - B.hMin };
  });
  ok("the tile wraps left to right", R.wrapX <= R.bogX * 0.65,
     R.wrapX.toFixed(1) + " across the wrap vs " + R.bogX.toFixed(1) +
     " for columns that do not belong together");
  ok("and top to bottom", R.wrapY <= R.bogY * 0.65,
     R.wrapY.toFixed(1) + " across the wrap vs " + R.bogY.toFixed(1) +
     " for rows that do not belong together");
  ok("the run occupies the cavity", R.span > 0.04 && R.span < 0.30,
     (R.span * 1000).toFixed(0) + " mm of relief");

  /* THE BRACING IS THE OTHER HALF OF THE MODE, so it has to reach the picture
     — and the check has to be that the picture CHANGED, not that the parameter
     was written. Comparing height rather than colour, because a brace is a
     piece of geometry and would still count as present if it were only a
     different shade of grey. */
  const braceSig = async v => {
    await page.evaluate(x => window.Forge.setParam("raceway", "braceAmt", x), v);
    await page.click("#raceway--forge");
    await settle();
    return await page.evaluate(() => {
      const B = window.Forge.active().B, N = B.W * B.H;
      let sum = 0;
      for (let i = 0; i < N; i += 7) sum += B.HGT[i];
      return { sum, hi: B.hMax };
    });
  };
  const on = await braceSig(1), off = await braceSig(0);
  ok("bracing reaches the height field, not just the parameters",
     Math.abs(on.sum - off.sum) > Math.abs(off.sum) * 1e-4 && on.hi > off.hi,
     "peak " + (on.hi * 1000).toFixed(1) + " mm braced vs " +
     (off.hi * 1000).toFixed(1) + " mm bare");
  await page.evaluate(() => window.Forge.setParam("raceway", "braceAmt", 1));
  await page.click("#raceway--forge");
  await settle();

  /* the bend radius is a floor rather than a setting, and the readout has to
     say when it bound — a silently ignored control is worse than no control */
  const said = await page.evaluate(async () => {
    window.Forge.setParam("raceway", "bendMm", 4);
    window.Forge.setParam("raceway", "groupMax", 8);
    document.getElementById("raceway--forge").click();
    await new Promise(r => setTimeout(r, 400));
    return document.getElementById("raceway--readout").textContent;
  });
  await settle();
  ok("it says when the bend radius had to be opened up", /opened to \d+/.test(said),
     said.replace(/\s+/g, " ").slice(-96));

  /* the framed piece, same contract as the loom's */
  await page.selectOption("#raceway--piece", "bay");
  await page.click("#raceway--forge");
  await settle();
  const bay = await page.evaluate(() => {
    const st = window.Forge.active(), B = st.B, N = B.W * B.H;
    let clear = 0, solid = 0;
    for (let i = 0; i < N; i++) { if (B.ALP[i] < 8) clear++; else if (B.ALP[i] > 247) solid++; }
    return { clear: clear / N, solid: solid / N,
             cutout: window.Forge.byId["raceway"].plan(st.P).cutout };
  });
  ok("the bay is a cut-out piece", bay.cutout === true);
  ok("the bay silhouette is opaque in the middle", bay.solid > 0.5,
     (bay.solid * 100).toFixed(1) + "% fully opaque");
  await page.selectOption("#raceway--piece", "tile");
}

if (errors.length) { fails++; console.log("\npage errors:\n" + errors.join("\n")); }
console.log(fails ? `\nFAIL (${fails})` : "\nALL GOOD");
await browser.close();
/* NOT process.exit(): it does not wait for stdout to drain, and piping this
   into anything — a grep, a log file, CI — was losing the last few lines,
   including the verdict. Setting the code lets node exit on its own once the
   output is out. */
process.exitCode = fails ? 1 : 0;
