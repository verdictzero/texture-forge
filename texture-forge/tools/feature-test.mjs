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
  const structs = await page.evaluate(() => window.Forge.structures.map(s =>
    ({ id: s.id, n: s.steps.length, fresh: s.steps.map(x => !!x.fresh) })));
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

    /* WHERE A GROUP ENDS, INHERITANCE ENDS. A structure whose steps are the
       faces of one building carries everything forward, which is the whole
       point. A structure whose steps are several DIFFERENT buildings — the
       town's house, then its diner, then its works, then the road — marks the
       first step of each as `fresh`, and that step is supposed to arrive with
       nothing: a diner opening on the house's clapboard and storey height is a
       house with a neon sign on it. So a fresh step is checked for the
       opposite of what the others are. */
    let group = 0;
    for (let k = 1; k < s.n; k++) {
      await page.click("#wiz-next");
      await settle();
      if (s.fresh[k]) group = k;
      const fresh = s.fresh[k];
      const seed = await page.evaluate(() => window.Forge.active().P.seed);
      const marked = await page.evaluate(() =>
        document.querySelectorAll("#panel-" + window.Forge.active().mode.id + " .row.carried").length);
      if (fresh) {
        /* NOTHING CARRIED IN is the claim, and it is the only one available:
           a fresh step opens on whatever its own mode is holding, which in a
           session that has already walked the diner structure is the seed that
           walk left behind. What must not happen is the step BEFORE it writing
           into it. */
        ok(`${s.id}: step ${k + 1} starts fresh`, marked === 0,
           `${marked} rows carried in — it opens on what its own mode holds`);
      } else if (group > 0) {
        /* inside a later group: it inherits from that group's own first step,
           which never saw 4242 */
        ok(`${s.id}: step ${k + 1} inherits from its own group`, marked > 0,
           marked + " rows, seed " + seed);
      } else {
        ok(`${s.id}: step ${k + 1} inherits the seed`, seed === 4242, String(seed));
        ok(`${s.id}: step ${k + 1} marks what it inherited`, marked > 0, marked + " rows");
      }
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
   orthogonal is this picture" has no absolute scale.

   MEASURED OFF THE RUNS THEMSELVES, not off the picture. This used to fold the
   height gradient of every strongly-sloped texel in the tile, which counts the
   backplane ribs, the frame, the fastener rows and the lids of the junction
   boxes along with the cable — most of a tile that is mostly not cable. That
   was survivable while the boxes sat at whatever angle their run happened to
   be on. Once every box lands on a quarter turn in BOTH modes the box lids
   stopped telling the two apart and started diluting the thing that does, and
   at one seed the contrast had already collapsed to 1.14 with no change to
   either router.

   The tag has the answer exactly: every texel a route owns carries how far
   along that route it is, in millimetres, so the gradient of THAT field points
   along the run. No lighting, no backplane, no lids — just the direction the
   cable is travelling, which is what the claim was always about. */
if (want("raceway")) {
  console.log("\n— the conduit raceway —");

  /* the fraction of a mode's route length whose heading is within 12° of an
     axis. A raceway is straights between fillets, so most of its length is on
     an axis; a hand-dressed loom's runs point anywhere. */
  const axisness = async (id, seed) => {
    await page.click(`#modebar-tabs [data-mode="${id}"]`);
    await settle();
    await page.evaluate(([m, sd]) => {
      window.Forge.setParam(m, "size", 512);
      window.Forge.setParam(m, "seed", sd);
    }, [id, seed]);
    await page.click(`#${id}--forge`);
    await settle();
    return await page.evaluate(() => {
      const B = window.Forge.active().B, W = B.W, H = B.H, TAG = B.TAG;
      if (!TAG) return -1;
      const own = i => (TAG[i] >>> 24) & 255, alo = i => TAG[i] & 0x3fff;
      let on = 0, tot = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x, o = own(i);
        if (o >= 253) continue;                       // backplane, frame, box
        /* all four neighbours on the same route, or the difference is across a
           boundary rather than along a run */
        if (own(i + 1) !== o || own(i - 1) !== o || own(i + W) !== o || own(i - W) !== o) continue;
        const dx = alo(i + 1) - alo(i - 1), dy = alo(i + W) - alo(i - W);
        if (Math.abs(dx) > 40 || Math.abs(dy) > 40) continue;   // the seam wraps
        if (!dx && !dy) continue;
        let a = Math.atan2(dy, dx) * 180 / Math.PI;
        a = Math.abs(((a % 90) + 90) % 90);           // fold onto 0..90
        if (a < 12 || a > 78) on++;
        tot++;
      }
      return tot ? on / tot : 0;
    });
  };
  /* PINNED SEEDS, and more than one of them. Whichever seed the sections above
     happened to leave loaded is not a measurement, and the gap between the two
     modes is a good deal wider at some seeds than others — 2201 is the
     narrowest of the ones tried. */
  let built = false;
  for (const seed of [4118, 2201]) {
    const race = await axisness("raceway", seed);
    const loom = await axisness("conduit", seed);
    if (!built) { ok("the raceway builds", race > 0); built = true; }
    ok(`@${seed}: its runs are axis-aligned, and the loom's are not`,
       race > loom * 1.25,
       "within 12° of an axis: raceway " + (race * 100).toFixed(1) +
       "%, conduit " + (loom * 100).toFixed(1) + "%");
  }

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

/* ============================ the 3D building ============================
   The wizard draws the building it is describing, out of ForgeModel's own
   scene. What that has to be true of:

     the box is the PLANS — its dimensions are the ones every step's plan()
     declares, so the thing you orbit is the thing that exports;
     the shape is LIVE — it follows a dimension slider with nothing forged;
     the surfaces ARRIVE — walking a step puts that face on the building;
     a face that was overtaken SAYS SO rather than passing as current;
     and every triangle in the exported scene is wound to agree with the
     normal it declares, which is the defect this view found on its first
     afternoon.
   ========================================================================= */
if (want("stage")) {
  console.log("\n— the 3D building —");

  const stageUp = await page.evaluate(() => !!(window.ForgeStage && window.ForgeStage.available()));
  ok("the stage has a context", stageUp);

  /* ---- every triangle agrees with the normal it claims ------------------
     A face wound against its own normal shades correctly anywhere that reads
     the vertex normal and turns into a hole anywhere that culls back faces.
     Checked over every structure's scene rather than over one. */
  const wound = await page.evaluate(() => {
    const M = window.ForgeModel, out = [];
    for (const s of window.Forge.structures) {
      /* a town is not one building and has no front face to hand this; its own
         section checks the winding of a whole town instead */
      if (s.town) continue;
      const by = {};
      for (const step of s.steps) {
        const st = window.Forge.state(step.mode);
        const P = Object.assign(JSON.parse(JSON.stringify(st.P)), step.set || {});
        const plan = M.planOf(st.mode, P);
        by[step.id] = { plan, material: { name: step.id, maps: {}, cutout: plan.cutout } };
      }
      const S = M.buildingScene(s.id, { front: by.front, side: by.side, back: by.back, roof: by.roof });
      let bad = 0, tris = 0;
      for (const m of S.meshes) {
        for (let i = 0; i < m.idx.length; i += 3) {
          const a = m.idx[i] * 3, b = m.idx[i + 1] * 3, c = m.idx[i + 2] * 3;
          const e1 = [m.pos[b] - m.pos[a], m.pos[b + 1] - m.pos[a + 1], m.pos[b + 2] - m.pos[a + 2]];
          const e2 = [m.pos[c] - m.pos[a], m.pos[c + 1] - m.pos[a + 1], m.pos[c + 2] - m.pos[a + 2]];
          const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          const d = g[0] * m.nrm[a] + g[1] * m.nrm[a + 1] + g[2] * m.nrm[a + 2];
          tris++;
          if (d <= 0) bad++;
        }
      }
      out.push({ id: s.id, tris, bad, meshes: S.meshes.map(m => m.name) });
    }
    return out;
  });
  for (const r of wound)
    ok(`${r.id}: every triangle is wound to its own normal`, r.bad === 0,
       `${r.tris - r.bad}/${r.tris} · ${r.meshes.join(" ")}`);

  /* ONE BUILDING'S STRUCTURES ONLY. This whole section is about a box whose
     dimensions are the front's and the side's plans; a town has neither and is
     checked by its own section, which asks the questions a town raises
     instead. */
  for (const s of await page.evaluate(() => window.Forge.structures
        .filter(x => !x.town).map(x => ({ id: x.id, n: x.steps.length })))) {
    console.log(`  · ${s.id}`);
    await page.evaluate(n => {
      for (const st of window.Forge.structures.find(x => x.id === n).steps)
        window.Forge.setParam(st.mode, "size", 256);
    }, s.id);
    await page.click(`[data-struct="${s.id}"]`);
    await settle();

    ok(`${s.id}: the wizard opens on the building`,
       (await page.$eval("#tabs .tab[aria-pressed=true]", n => n.textContent)) === "3D building");
    ok(`${s.id}: the 3D canvas is the one on screen`,
       await page.$eval("#solid", n => n.classList.contains("on")));

    /* ---- the box is the plans, not a guess at them --------------------- */
    const box = await page.evaluate(n => {
      const S = window.Forge.structures.find(x => x.id === n), M = window.ForgeModel;
      const P = id => {
        const step = S.steps.find(x => x.id === id);
        return step ? M.planOf(window.Forge.state(step.mode).mode,
                               Object.assign(JSON.parse(JSON.stringify(window.Forge.state(step.mode).P)),
                                             step.set || {})) : null;
      };
      return { stage: window.ForgeStage.debug().bounds, front: P("front"), side: P("side") };
    }, s.id);
    const near = (a, b, e = 0.02) => Math.abs(a - b) < e;
    ok(`${s.id}: the box is as wide as the front says`, near(box.stage.w, box.front.w),
       box.stage.w.toFixed(2) + " vs " + box.front.w.toFixed(2) + " m");
    ok(`${s.id}: the box is as deep as the side says`, near(box.stage.d, box.side.w),
       box.stage.d.toFixed(2) + " vs " + box.side.w.toFixed(2) + " m");

    /* ---- one mesh per wall, all four, pointing at their own step -------- */
    const meshes = await page.evaluate(() => window.ForgeStage.debug().meshes);
    const walls = meshes.filter(m => m.face);
    ok(`${s.id}: four walls and a roof stand on a ground`,
       walls.length === 5 && meshes.length === 6,
       walls.map(m => m.name + ":" + m.face).join(" "));
    ok(`${s.id}: both sides come off the one side elevation`,
       walls.filter(m => m.face === "side").length === 2);

    /* ---- the shape follows a slider, with nothing forged ---------------- */
    /* FOUND, not guessed: every structure names its width differently, and a
       hard-coded list picks the factory's PANEL tile rather than its elevation.
       So this asks the plan — the control that widens the face is whichever one
       widens plan().w, and planOf is pure arithmetic, so trying them all costs
       nothing and cannot be wrong. */
    const dim = await page.evaluate(n => {
      const S = window.Forge.structures.find(x => x.id === n);
      const step = S.steps[0], st = window.Forge.state(step.mode), M = window.ForgeModel;
      const planFor = over => {
        const P = Object.assign(JSON.parse(JSON.stringify(st.P)), step.set || {}, over);
        return M.planOf(st.mode, P).w;
      };
      const base = planFor({});
      for (const d of st.params) {
        if (d.kind !== "range" || d.id === "size" || d.id === "seed") continue;
        const v = st.P[d.id];
        if (!(v > 0)) continue;
        const up = Math.min(d.max === undefined ? v * 1.5 : +d.max, v * 1.5);
        if (up <= v) continue;
        if (planFor({ [d.id]: up }) > base * 1.15) return { mode: st.mode.id, id: d.id, v: v, to: up };
      }
      return null;
    }, s.id);
    if (dim) {
      const w0 = await page.evaluate(() => window.ForgeStage.debug().bounds.w);
      await page.evaluate(d => window.Forge.setParam(d.mode, d.id, d.to), dim);
      /* deliberately WITHOUT waiting for a build: the massing is arithmetic */
      await page.evaluate(() => document.getElementById("app")
        .dispatchEvent(new Event("input", { bubbles: true })));
      await page.waitForTimeout(220);
      const w1 = await page.evaluate(() => window.ForgeStage.debug().bounds.w);
      ok(`${s.id}: the box follows ${dim.id} before anything is forged`, w1 > w0 * 1.2,
         w0.toFixed(2) + " → " + w1.toFixed(2) + " m");
      await page.evaluate(d => window.Forge.setParam(d.mode, d.id, d.v), dim);
      await page.evaluate(() => document.getElementById("app")
        .dispatchEvent(new Event("input", { bubbles: true })));
      /* setParam marks the build stale without starting one, so there is
         nothing here for settle() to wait for — and waiting for it burns a
         minute per structure on a timeout that means nothing */
      await page.waitForTimeout(200);
    }

    /* ---- the surfaces arrive as the steps are walked -------------------- */
    await page.click("#wiz-see");
    for (let i = 0; i < 900; i++) {
      const t = await page.$eval("#status", n => n.textContent);
      if (/faces forged|Could not/.test(t)) break;
      await page.waitForTimeout(200);
    }
    await settle();
    const made = await page.evaluate(() => ({
      faces: window.ForgeStage.debug().faces,
      rail: [...document.querySelectorAll("#wiz-steps .tab")].map(t => t.dataset.made || "-")
    }));
    ok(`${s.id}: every face is on the building`, made.faces.length === s.n,
       made.faces.join(" "));
    ok(`${s.id}: the rail ticks every face`, made.rail.every(x => x === "yes"),
       made.rail.join(" "));

    /* ---- and says so when one is overtaken ----------------------------- */
    const stale = await page.evaluate(n => {
      const S = window.Forge.structures.find(x => x.id === n);
      const st = window.Forge.state(S.steps[0].mode);
      window.Forge.setParam(st.mode.id, "seed", (st.P.seed | 0) + 7);
      document.getElementById("app").dispatchEvent(new Event("input", { bubbles: true }));
      return null;
    }, s.id);
    await page.waitForTimeout(240);
    const rail2 = await page.evaluate(() =>
      [...document.querySelectorAll("#wiz-steps .tab")].map(t => t.dataset.made || "-"));
    ok(`${s.id}: a face built on other numbers is flagged`, rail2.some(x => x === "stale"),
       rail2.join(" "));

    /* ---- a wall in the middle of the view is pickable ------------------- */
    const hit = await page.evaluate(() => {
      const cv = document.getElementById("solid"), r = cv.getBoundingClientRect();
      return window.ForgeStage.pick(r.left + r.width / 2, r.top + r.height / 2);
    });
    ok(`${s.id}: the walls are pickable`, !!hit, "hit " + hit);

    await page.click("#wiz-exit");
    await page.waitForTimeout(250);
    ok(`${s.id}: leaving takes the building away`,
       !(await page.evaluate(() => window.ForgeStage.debug().scene)) &&
       (await page.evaluate(() => window.ForgeStage.debug().faces.length)) === 0);
    ok(`${s.id}: and takes the tab with it`,
       !(await page.evaluate(() =>
         [...document.querySelectorAll("#tabs .tab")].some(t => t.dataset.view === "building"))));
  }
}

/* ============================ the grocery fixtures ============================
   Seven fixtures out of one generator. What has to be true of them:

     every piece builds, and at the small end of the ladder too;
     the box is the MILLIMETRES it claims — bays times bay width, in metres;
     stock responds to the stock control rather than to nothing;
     SHORT stock survives, which is the defect that made a chiller deck of
       50 mm trays look like nobody had filled it (the shelf fascia was drawn
       over the top of them);
     the two height fields are two fields — the height map carries the true
       depth whatever Relief is set to, and the normal map does not;
     it cuts out, and it glows only where there is a lamp.
   ============================================================================= */
if (want("grocery")) {
  console.log("\n— grocery fixtures —");
  await page.evaluate(() => window.Forge.activate("grocery"));
  await page.waitForTimeout(200);

  const pieces = await page.evaluate(() =>
    [...document.querySelectorAll("#grocery--piece option")].map(o => o.value));
  ok("every fixture is offered", pieces.length >= 7, pieces.join(" "));

  /* what the material id buffer says the face is made of */
  const census = () => page.evaluate(() => {
    const B = window.Forge.active().B, N = B.W * B.H;
    const by = {}, MAT = B.MAT, ALP = B.ALP, E = B.EMC;
    let opaque = 0, clear = 0, lit = 0;
    for (let i = 0; i < N; i++) {
      by[MAT[i]] = (by[MAT[i]] || 0) + 1;
      if (ALP[i] > 247) opaque++; else if (ALP[i] < 8) clear++;
      if (E[i * 3] + E[i * 3 + 1] + E[i * 3 + 2] > 12) lit++;
    }
    return { by, N, opaque: opaque / N, clear: clear / N, lit: lit / N };
  });
  const build = async (set, size) => {
    await page.evaluate(o => {
      for (const k in o) if (k !== "__size") window.Forge.setParam("grocery", k, o[k]);
      window.Forge.setParam("grocery", "size", o.__size);
    }, Object.assign({ __size: size || 512 }, set));
    await page.click("#grocery--forge");
    return await settle();
  };

  /* ---- every piece builds, and survives the small end ------------------- */
  for (const piece of pieces) {
    const before = errors.length;
    const t = await build({ piece }, 512);
    const c = await census();
    ok(`${piece}: builds`, t !== "TIMEOUT" && c.opaque > 0.10,
       (c.opaque * 100).toFixed(0) + "% opaque");
    ok(`${piece}: nothing thrown`, errors.length === before, errors.slice(before).join(" | "));
  }
  for (const piece of pieces) {
    const before = errors.length;
    const t = await build({ piece }, 128);
    ok(`${piece}: survives 128 px`, t !== "TIMEOUT" && errors.length === before,
       errors.slice(before).join(" | "));
  }

  /* ---- the box is the millimetres it claims ---------------------------- */
  const dims = await page.evaluate(() => {
    const st = window.Forge.state("grocery"), out = [];
    for (const [bays, bayW, fixH] of [[1, 1219, 2134], [4, 900, 1800], [2, 1600, 2400]]) {
      window.Forge.setParam("grocery", "piece", "gondola");
      window.Forge.setParam("grocery", "bays", bays);
      window.Forge.setParam("grocery", "bayW", bayW);
      window.Forge.setParam("grocery", "fixH", fixH);
      const p = window.ForgeModel.planOf(st.mode, st.P);
      out.push({ bays, bayW, fixH, w: p.w, h: p.h, cutout: p.cutout });
    }
    return out;
  });
  for (const d of dims) {
    ok(`${d.bays}x${d.bayW} mm is ${(d.bays * d.bayW / 1000).toFixed(3)} m across`,
       Math.abs(d.w - d.bays * d.bayW / 1000) < 1e-6, d.w.toFixed(4) + " m");
    ok(`${d.fixH} mm tall is ${(d.fixH / 1000).toFixed(3)} m`,
       Math.abs(d.h - d.fixH / 1000) < 1e-6, d.h.toFixed(4) + " m");
  }
  ok("a fixture is a cut-out piece", dims.every(d => d.cutout));

  /* ---- stock follows the stock control --------------------------------- */
  const PRODUCT = [5, 6, 7, 8, 9, 10];                    // card, can, bottle, film, produce, meat
  const stocked = c => PRODUCT.reduce((a, m) => a + (c.by[m] || 0), 0) / c.N;
  await build({ piece: "gondola", bays: 3, bayW: 1219, fixH: 2134, shelves: 4, fill: 1, tidy: 0.9 });
  const full = stocked(await census());
  await build({ piece: "gondola", fill: 0.15 });
  const bare = stocked(await census());
  ok("a full shelf holds more than a picked-over one", full > bare * 1.6,
     (full * 100).toFixed(1) + "% vs " + (bare * 100).toFixed(1) + "% of the face");
  ok("a full shelf is properly full", full > 0.16, (full * 100).toFixed(1) + "%");

  /* ---- SHORT STOCK SURVIVES. The shelf fascia used to be drawn above the
     shelf line, which painted it straight over anything shorter than about
     60 mm — so a chiller deck of trays came out looking unstocked. ---- */
  await build({ piece: "meat", bays: 3, fixH: 2000, deckN: 4, chillMix: "meat", fill: 0.95 });
  const meat = await census();
  ok("a chiller deck of trays is actually stocked",
     (meat.by[10] || 0) / meat.N > 0.035,
     (((meat.by[10] || 0) / meat.N) * 100).toFixed(2) + "% of the face is tray");

  /* ---- two height fields, and only one of them is exported ------------- */
  /* MEASURED THROUGH AN UNSATURATED WINDOW. At the normal strength anybody
     would actually use, the step from a package to the shelf behind it pins
     the normal flat against the surface at Relief 0 and at Relief 1 alike —
     157 units of gradient and 6 both come out as "sideways", and the mean
     tilt cannot tell them apart. Turning the strength down to the control's
     own minimum puts both inside the range where the field is still readable,
     which is where the difference between them lives. */
  const relief = async r => {
    await build({ piece: "gondola", shelves: 4, fill: 1, relief: r, normalStr: 0.1 });
    return await page.evaluate(() => {
      const B = window.Forge.active().B, N = B.W * B.H, NRM = B.NRM;
      /* OVER THE STOCK ONLY. Relief scales how much of a PACKAGE's standing
         depth reaches the normals; the shelf boards, the uprights and the
         ticket rails keep their own relief either way, and averaged over the
         whole face they are most of the bending and swamp the thing being
         measured. */
      const PROD = { 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1 };
      /* AND AT THE STEEPEST END OF IT. Most of a package is its flat front,
         which leans the same amount whatever Relief is; the standing depth
         shows up only where the package ENDS, which is a small share of its
         texels and is averaged away. The 95th percentile is that edge. */
      const hist = new Float64Array(256);
      let n = 0;
      for (let i = 0; i < N; i++) {
        if (!B.ALP[i] || !PROD[B.MAT[i]]) continue;
        hist[255 - NRM[i * 3 + 2]]++;
        n++;
      }
      let acc = 0, p95 = 0;
      for (let k = 255; k >= 0; k--) {
        acc += hist[k];
        if (acc >= n * 0.05) { p95 = k / 255; break; }
      }
      return { range: B.hMax - B.hMin, tilt: p95, n: n };
    });
  };
  const r0 = await relief(0), r1 = await relief(1);
  ok("the height map carries the true depth at either Relief",
     Math.abs(r0.range - r1.range) < 1e-4,
     r0.range.toFixed(5) + " vs " + r1.range.toFixed(5) + " face widths");
  ok("Relief decides how much of it reaches the normals", r1.tilt > r0.tilt * 3,
     r0.tilt.toFixed(4) + " -> " + r1.tilt.toFixed(4) +
     " tilt at the stock's steepest 5%, measured at 0.1 normal strength");

  /* ---- the alpha is the silhouette, whatever shape that is ------------
     A gondola run IS a rectangle in elevation — there is nothing to cut away,
     and an alpha with a hole in it would be a bug. A checkout lane is mostly
     not there: two impulse racks, a counter and a pole, with the queue's own
     space between them. Both are the same channel doing its job. ---- */
  await build({ piece: "gondola", shelves: 4, fill: 0.9, relief: 0.22 });
  const gond = await census();
  ok("a shelf run is a solid rectangle", gond.opaque > 0.995,
     (gond.opaque * 100).toFixed(2) + "% opaque");
  await build({ piece: "checkout", bays: 3, fixH: 1500 });
  const lane = await census();
  ok("a checkout lane cuts out round itself", lane.clear > 0.20 && lane.opaque > 0.30,
     (lane.clear * 100).toFixed(0) + "% clear, " + (lane.opaque * 100).toFixed(0) + "% opaque");
  await build({ piece: "gondola", shelves: 4, fill: 0.9, relief: 0.22 });
  ok("a dry goods bay has no light in it", gond.lit < 0.0005,
     (gond.lit * 100).toFixed(3) + "% lit");
  ok("and it is made of steel, shelf, ticket and stock",
     [2, 3, 4].every(m => (gond.by[m] || 0) > 0) &&
     PRODUCT.filter(m => (gond.by[m] || 0) > 0).length >= 3,
     Object.keys(gond.by).sort((a, b) => a - b).join(","));
  await build({ piece: "meat", deckN: 4, canopyMm: 420 });
  const chill = await census();
  ok("a chiller case has its canopy light", chill.lit > 0.002,
     (chill.lit * 100).toFixed(2) + "% lit");
}

/* ============================ the loom's rasteriser ============================
   A conduit is drawn by walking its centreline and laying a span across it, and
   there are TWO ways that leaves holes in the run.

   ACROSS. The span is laid on a grid it is almost never square to. Sampled at a
   fixed spacing and rounded, a rotated span does not land one point to a texel:
   at 45° consecutive samples come down two texels apart on the diagonal and the
   texels between them are written by nobody. Swept round a bend through every
   angle, the misses drift and the whole thing reads as moiré.

   ALONG. The route is resampled at its CENTRELINE, so the outer edge of a wide
   bundle travels further than a step. Past a texel, consecutive spans leave a
   transverse slot — a gap cut across the cable, widest on the outside of a turn.

   TWO MEASURES, because neither metric sees both faults. A PIT — a texel a
   fifth of the whole relief below EVERY one of its eight neighbours — catches
   the first and is blind to the second, a slot being a line rather than a
   point. A GAP ALONG THE RUN catches the second, off the tag the stamp already
   keeps: the same route, at the same place across it, on both sides of
   something that is not that route. Neither is a proxy — nothing in this mode
   draws a one-texel hole in the middle of a pipe, and a conduit's surface is
   continuous along its own length — and the honest sliver of plate BETWEEN two
   pipes of a bundle fails the second test on the across byte, which is how the
   two are told apart.
   ============================================================================== */
if (want("raster")) {
  console.log("\n— the loom's rasteriser —");
  const build = async (mode, seed, size) => {
    await page.evaluate(m => window.Forge.activate(m), mode);
    await page.waitForTimeout(150);
    await page.evaluate(([m, sd, sz]) => {
      window.Forge.setParam(m, "seed", sd);
      window.Forge.setParam(m, "size", sz);
    }, [mode, seed, size]);
    await page.click(`#${mode}--forge`);
    await settle();
  };

  /* ---- pits: a texel the span missed --------------------------------- */
  const pits = () => page.evaluate(() => {
    const B = window.Forge.active().B, W = B.W, H = B.H, G = B.HGT;
    let hi = -1e9, lo = 1e9;
    for (let i = 0; i < W * H; i++) { const h = G[i]; if (h > hi) hi = h; if (h < lo) lo = h; }
    const cut = (hi - lo) * 0.20, mid = lo + (hi - lo) * 0.25;
    let holes = 0, raised = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, h = G[i];
      let mn = 1e9;
      for (const d of [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1]) {
        const v = G[i + d]; if (v < mn) mn = v;
      }
      if (h > mid) raised++;
      if (mn - h > cut) holes++;
    }
    return { holes, raised, rate: holes / Math.max(1, raised) };
  });

  /* ---- gaps: a slot cut across the run -------------------------------- */
  const gaps = () => page.evaluate(() => {
    const B = window.Forge.active().B, W = B.W, H = B.H, TAG = B.TAG;
    if (!TAG) return { missing: true };
    const own = i => (TAG[i] >>> 24) & 255,
          acr = i => ((TAG[i] >>> 14) & 255) - 128,
          prt = i => (TAG[i] >>> 22) & 3;
    let gaps = 0, surface = 0;
    for (let i = 0; i < W * H; i++) if (own(i) < 250) surface++;
    const K = 4;
    for (let y = K; y < H - K; y++) for (let x = K; x < W - K; x++) {
      const i = y * W + x;
      if (own(i) < 250) continue;
      let hit = false;
      for (const d of [1, W, W + 1, W - 1]) {
        /* WALK OUT TO THE FIRST CONDUIT EITHER SIDE rather than probing at a
           fixed distance: a fixed reach steps clean over a conduit two texels
           wide and pairs its far neighbour with something on the other side of
           it, which is a false gap. */
        let a = -1, c = -1, k1 = 0, k2 = 0;
        for (let k = 1; k <= K; k++) if (own(i - k * d) < 250) { a = i - k * d; k1 = k; break; }
        for (let k = 1; k <= K; k++) if (own(i + k * d) < 250) { c = i + k * d; k2 = k; break; }
        if (a < 0 || c < 0 || k1 + k2 - 1 > 3) continue;
        if (own(a) === own(c) && prt(a) === prt(c) && Math.abs(acr(a) - acr(c)) <= 6) {
          hit = true; break;
        }
      }
      if (hit) gaps++;
    }
    return { gaps, surface, rate: gaps / Math.max(1, surface) };
  });

  /* WHERE THE TEETH ARE. The bars sit well under what each fault gave and well
     over what the fixed walk gives, but they do not bite equally everywhere and
     it is worth saying which cases are load-bearing. The across fault showed
     everywhere (conduit 1.60% of pits, raceway 0.90%). The along fault is
     concentrated in WIDE bundles on TIGHT bends, so raceway — braced runs
     turning square corners — carries it at 1.14% of its surface in gaps and
     0.12% in pits, while conduit's flat ribbons are a minority of a mixed tile
     and move it only from 0.048% to 0.040%. Raceway is what catches a
     regression here; conduit's rows are the shape of the claim rather than the
     proof of it. */
  for (const [mode, seed] of [["conduit", 4118], ["conduit", 2201],
                              ["raceway", 4118], ["raceway", 77], ["greeble", 4118]]) {
    await build(mode, seed, 1024);
    const p = await pits();
    ok(`${mode} @${seed}: the span leaves no holes across the run`, p.rate < 0.0005,
       `${p.holes} pits in ${p.raised} raised = ${(p.rate * 100).toFixed(3)}%`);
    if (mode !== "greeble") {
      const g = await gaps();
      ok(`${mode} @${seed}: and none along it`, !g.missing && g.rate < 0.0010,
         g.missing ? "the build did not hand back its tag"
                   : `${g.gaps} gap texels in ${g.surface} of surface = ` +
                     `${(g.rate * 100).toFixed(3)}%`);
    }
  }
  /* and it has to hold at every resolution, because the across fault was the
     span's spacing against the grid and that is exactly what a resolution
     changes */
  for (const size of [256, 512, 2048]) {
    await build("conduit", 4118, size);
    const p = await pits();
    ok(`conduit @${size} px: still no holes`, p.rate < 0.0008,
       `${p.holes} pits = ${(p.rate * 100).toFixed(3)}%`);
  }
}

/* ========================= junction boxes on the square =========================
   A junction box is bolted to the backplane, and the backplane is ribbed,
   drilled and framed on the square. A cast enclosure hung at thirty-seven
   degrees to all of it is the one thing in a picture of an equipment bay that
   looks placed rather than installed — nobody drills a mounting pattern
   off-axis to suit a cable.

   TWO CLAIMS, and they need different tests. That the BOX is on a quarter turn
   is a property of one function and is checked as one: boxOf is handed a route
   pointing at every angle in turn and has to come back with an axis vector
   every time. That the RUN ARRIVES square is a property of the whole build —
   the run has to be walked back for a place where it nearly does and then bent
   the rest of the way — and comes off the census, which reports the angle the
   conduit actually meets its box at.
   ============================================================================== */
if (want("boxes")) {
  console.log("\n— junction boxes on the square —");

  /* ---- the box's own frame, over every heading ------------------------ */
  const frames = await page.evaluate(() => {
    const L = window.ForgeLoom;
    if (!L || !L.boxOf) return { missing: true };
    const out = { n: 0, offAxis: 0, worstSkew: 0, headings: [] };
    for (let deg = 0; deg < 360; deg += 3) {
      const a = deg * Math.PI / 180, tx = Math.cos(a), ty = Math.sin(a);
      /* a straight synthetic run on that heading — nothing in boxOf cares
         about anything but the tangents and the sizes */
      const n = 120, pts = new Float64Array(n * 4);
      for (let i = 0; i < n; i++) {
        pts[i * 4] = 0.2 + tx * i * 0.001; pts[i * 4 + 1] = 0.2 + ty * i * 0.001;
        pts[i * 4 + 2] = tx; pts[i * 4 + 3] = ty;
      }
      const R = { kind: 0, pts, nPts: n, len: n * 0.001,
                  half: 0.012, r: 0.006, z0: 0.01, pitch: 0.012, n: 1 };
      for (const end of [true, false]) {
        const b = L.boxOf(R, end);
        out.n++;
        if (!b) { out.offAxis++; continue; }
        /* an axis vector: one component exactly +/-1, the other exactly 0 */
        const okv = (b.tx === 0 && Math.abs(b.ty) === 1) ||
                    (b.ty === 0 && Math.abs(b.tx) === 1);
        if (!okv) { out.offAxis++; out.headings.push(deg); }
        if (b.skew > out.worstSkew) out.worstSkew = b.skew;
      }
    }
    return out;
  });
  ok("boxOf is reachable", !frames.missing);
  if (!frames.missing) {
    ok("every box is on a quarter turn, from every heading",
       frames.offAxis === 0,
       `${frames.n - frames.offAxis}/${frames.n} square` +
       (frames.headings.length ? " · off at " + frames.headings.slice(0, 6).join(", ") + " deg" : ""));
    /* and it reports how far it had to snap, which is what the placement
       search steers on — for a run pointing at 45 degrees that is the full 45 */
    ok("and it reports how far it snapped", frames.worstSkew > 0.7 && frames.worstSkew < 0.8,
       (frames.worstSkew * 180 / Math.PI).toFixed(1) + " deg at the worst heading");
  }

  /* ---- and squaring the tail is all or nothing ------------------------- */
  /* squareInto MOVES THE TIP, so the box that gets painted is not the one the
     mode tested for clear ground. settleBox tests the one that will be painted
     and, when it lands on something, has to put the tail back exactly. */
  const settle2 = await page.evaluate(() => {
    const L = window.ForgeLoom;
    if (!L.settleBox) return { missing: true };
    const mk = () => {
      const n = 160, pts = new Float64Array(n * 4);
      let x = 0.2, y = 0.2, h = 0.4;
      for (let i = 0; i < n; i++) {
        h += 0.02;                                   // a run that curves, so it has skew to lose
        pts[i * 4] = x; pts[i * 4 + 1] = y; pts[i * 4 + 2] = Math.cos(h); pts[i * 4 + 3] = Math.sin(h);
        x += Math.cos(h) * 0.001; y += Math.sin(h) * 0.001;
      }
      return { kind: 0, pts, nPts: n, len: n * 0.001, half: 0.012, r: 0.004,
               z0: 0.010, pitch: 0.012, n: 1 };
    };
    const g = { Wm: 0.62, Hm: 0.62, bay: false };
    const no = mk(), before = Array.from(no.pts);
    /* accept only the box the run already had — which is to say, refuse the
       one squaring the tail would have produced */
    const was = L.boxOf(no, true);
    const kept = L.settleBox(no, true, 0.05, g, b => b.x === was.x && b.y === was.y);
    let moved = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== no.pts[i]) moved++;
    const yes = mk();
    const done = L.settleBox(yes, true, 0.05, g, () => true);
    let shifted = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== yes.pts[i]) shifted++;
    return { restored: moved, keptSkew: kept ? kept.skew : -1,
             squaredSkew: done ? done.skew : -1, shifted };
  });
  ok("settleBox is reachable", !settle2.missing);
  if (!settle2.missing) {
    ok("a refused squaring leaves the run exactly as the router laid it",
       settle2.restored === 0, `${settle2.restored} of the run's numbers changed`);
    ok("and an accepted one bends the tail and takes the skew out",
       settle2.shifted > 0 && settle2.squaredSkew < settle2.keptSkew,
       `${(settle2.squaredSkew * 180 / Math.PI).toFixed(1)} deg squared vs ` +
       `${(settle2.keptSkew * 180 / Math.PI).toFixed(1)} deg as laid, ` +
       `${settle2.shifted} numbers moved`);
  }

  /* ---- and the run arrives square ------------------------------------- */
  for (const [mode, seeds] of [["conduit", [4118, 7, 2201]], ["raceway", [4118, 77]]]) {
    for (const seed of seeds) {
      await page.evaluate(m => window.Forge.activate(m), mode);
      await page.waitForTimeout(150);
      await page.evaluate(([m, sd]) => {
        window.Forge.setParam(m, "seed", sd);
        window.Forge.setParam(m, "size", 1024);
      }, [mode, seed]);
      await page.click(`#${mode}--forge`);
      await settle();
      const c = await page.evaluate(() => window.Forge.active().B.census || null);
      ok(`${mode} @${seed}: the census survives the build`, !!c && c.boxes >= 0,
         c ? `${c.boxes} boxes, ${c.closed}/${c.bundles} closed` : "no census came back");
      if (c && c.boxes && c.loadAvg !== undefined) {
        /* NOT AN ASSERTION, A READING. How much of a box's footprint was
           already cable when it was put down. It cannot be driven to zero from
           here: the cable is under the box because the RUN is over that cable,
           and an upper layer is allowed to lie along a lower one. Printed so a
           change that makes it worse is at least visible. */
        console.log(`       cable already under a box: mean ` +
                    `${(c.loadAvg * 100).toFixed(0)}%, worst ${(c.loadMax * 100).toFixed(0)}%`);
      }
      if (c && c.boxes && c.skewMax !== undefined) {
        /* THE CLAIM IS ABOUT THE BOXES THAT WERE SQUARED. Before the snap the
           conduit met its box at whatever angle it happened to be on — 8
           degrees on average across these seeds and 39 at the worst. The run is
           walked back for a place where it nearly agrees and then bent the rest
           of the way, and where that is allowed to happen it lands under a
           degree.

           IT IS NOT ALWAYS ALLOWED TO HAPPEN, and lumping the two together
           would hide which half moved. Bending the tail moves the tip, so the
           box that gets painted is not the one the ground was checked for;
           when THAT one lands on another enclosure the tail goes back exactly
           as the router laid it and the run keeps its angle. A box at twenty
           degrees is a smaller lie than two boxes in the same place, and a run
           that ends mid-fillet, boxed in, has no room to bend and no straight
           leg to walk back to either. So the squared ones carry the claim and
           the declined ones are reported beside them. */
        ok(`${mode} @${seed}: the run enters its box square`,
           c.skewSq < 3,
           `${c.squared} squared, mean ${c.skewSq.toFixed(1)} deg · ` +
           `${c.refused} declined, all ends mean ${c.skewAvg.toFixed(1)} deg, ` +
           `worst ${c.skewMax.toFixed(1)}`);
      }
    }
  }
}

/* ============================== the town ==============================
   A town is the one thing in here that is not a texture. It is a street grid
   with a few hundred buildings standing on it, assembled out of thirteen
   textures the wizard forges once — so what is worth checking is the
   arithmetic and the assembly, not the pixels.

   THREE CLAIMS. That the LAYOUT is a town: buildings inside their blocks and
   not in the road, not standing in each other, and shops on the through road
   rather than scattered. That the GEOMETRY is one town rather than four
   hundred loose planes: one mesh per material, every triangle wound to its own
   normal, every triangle tagged with the building it belongs to. And that
   DESIGN MODE actually changes the town it is pointed at.
   ====================================================================== */
if (want("town")) {
  console.log("\n— the town —");

  const lib = await page.evaluate(() => {
    const T = window.ForgeTown;
    if (!T) return { missing: true };
    const sizes = { house: {w:9.8,d:11.5}, diner: {w:14,d:9}, factory: {w:26,d:34} };
    const P = { seed:1963, cols:6, rows:5, blockW:70, blockD:55, roadM:14,
                jitter:0.35, setback:5, gap:2.5, density:0.9, industry:0.6 };
    const L = T.layout(P, sizes);
    T.settle(L);
    const c = T.census(L);

    /* the footprint of a lot, axis-aligned — every rotation here is a quarter
       turn, so the box is the width and depth swapped or not */
    const boxOf = l => {
      const flat = Math.abs(Math.cos(l.rot)) > 0.5;
      const w = flat ? l.w : l.d, d = flat ? l.d : l.w;
      return { x0:l.px-w/2, x1:l.px+w/2, z0:l.pz-d/2, z1:l.pz+d/2 };
    };
    let overlaps = 0, worstOverlap = 0, outside = 0, inRoad = 0;
    const B = L.lots.map(boxOf);
    for (let i = 0; i < B.length; i++) {
      const blk = L.blocks[L.lots[i].block];
      if (B[i].x0 < blk.x0-0.05 || B[i].x1 > blk.x1+0.05 ||
          B[i].z0 < blk.z0-0.05 || B[i].z1 > blk.z1+0.05) outside++;
      /* a corridor is the ground between two blocks, so anything outside its
         own block IS in the road — counted separately because that is the one
         that looks wrong rather than merely tight */
      for (const st of L.streets) {
        const h = st.w/2;
        const rx0 = st.axis==="z" ? st.x-h : st.x0, rx1 = st.axis==="z" ? st.x+h : st.x1;
        const rz0 = st.axis==="z" ? st.z0 : st.z-h, rz1 = st.axis==="z" ? st.z1 : st.z+h;
        if (Math.min(B[i].x1,rx1) - Math.max(B[i].x0,rx0) > 0.2 &&
            Math.min(B[i].z1,rz1) - Math.max(B[i].z0,rz0) > 0.2) { inRoad++; break; }
      }
      for (let j = i+1; j < B.length; j++) {
        const ox = Math.min(B[i].x1,B[j].x1) - Math.max(B[i].x0,B[j].x0);
        const oz = Math.min(B[i].z1,B[j].z1) - Math.max(B[i].z0,B[j].z0);
        if (ox > 0.05 && oz > 0.05) { overlaps++; if (ox*oz > worstOverlap) worstOverlap = ox*oz; }
      }
    }
    /* the diner is a landmark rather than a lot type: one of it, on a through
       road, over frontage it took from several house lots, and bigger than
       anything else standing on a lot */
    let mainLots = 0;
    for (const l of L.lots) if (l.main) mainLots++;
    /* SNAPSHOT IT NOW. The design-mode check further down retypes a lot in
       place, and a live reference to it would report the house it became. */
    const dnSnap = L.lots.filter(l => l.type === "diner")
      .map(d => ({w:d.w, d:d.d, scale:d.scale, main:d.main,
                  frontage:d.frontage, landmark:!!d.landmark}));
    const houses = L.lots.filter(l => l.type === "house");
    const widestHouse = houses.reduce((a,l) => Math.max(a,l.w), 0);
    const three = T.layout(Object.assign({}, P, {diners:3}), sizes);
    const none = T.layout(Object.assign({}, P, {diners:0}), sizes);
    /* a works stands in its own ground rather than in a row */
    const worksWhole = L.lots.filter(l => l.type==="factory").every(l => l.side==="whole");

    /* and the grid follows the road texture rather than a number of its own */
    const wide = T.layout(Object.assign({}, P, {roadM: 24}), sizes);

    /* ONE TEXTURE IS NOT ONE BUILDING. Every house comes off the same four
       faces, so what has to differ is everything else: how it is massed, which
       way its ridge runs, how tall it is, how far back it sits and what colour
       somebody painted it. Counted as distinct SIGNATURES, because "they look
       different" is not a measurement. */
    /* THE STYLE ALONE, kept apart from the size. A house is a different size
       on a different block whatever the variety is doing — the blocks jitter —
       so folding the size in would let the layout answer a question about the
       buildings. */
    const styleSig=l=>[l.style.wing,l.style.mirror?1:0,l.style.ridge,l.style.flat?1:0,
                       l.style.stack?1:0,Math.round(l.style.hMul*40),
                       Math.round(l.style.setbackK*20),l.style.tint%10].join(",");
    const sig=l=>styleSig(l)+"|"+Math.round(l.w*4)+","+Math.round(l.d*4);
    const hSig=new Set(houses.map(sig));
    const wings={},tints=new Set(),ridges=new Set();
    for(const l of houses){
      wings[l.style.wing]=(wings[l.style.wing]|0)+1;
      tints.add(l.style.tint%10);ridges.add(l.style.ridge);
    }
    /* and the off switch is a real one: at variety 0 every house is the
       elevation exactly as forged, which is the town this used to make */
    const plainT=T.settle(T.layout(Object.assign({}, P, {variety:0}), sizes));
    const plainH=plainT.lots.filter(l=>l.type==="house");
    const plainSig=new Set(plainH.map(styleSig));

    /* design mode: put a house on a diner's lot and the size follows */
    const lot = L.lots.find(l => l.type === "diner");
    const was = lot ? {w:lot.w,d:lot.d,type:lot.type} : null;
    const swapped = lot ? T.retype(lot, "house", sizes) : false;
    /* and a works will not go on a house lot, because it does not fit */
    const houseLot = L.lots.find(l => l.type === "house" && l.side !== "whole");
    const refused = houseLot ? !T.retype(houseLot, "factory", sizes) : false;

    return { c, overlaps, worstOverlap, outside, inRoad,
             dn: dnSnap,
             widestHouse, mainShare: mainLots/L.lots.length, worksWhole,
             houses: houses.length, hSig: hSig.size, wings, nTints: tints.size,
             stacks: houses.filter(l => l.style.stack).length,
             nRidges: ridges.size, plainH: plainH.length, plainSig: plainSig.size,
             three: three.lots.filter(l => l.type === "diner").length,
             none: none.lots.filter(l => l.type === "diner").length,
             roadM: L.roadM, wideRoadM: wide.roadM, wideW: wide.bounds.w, W: L.bounds.w,
             was, now: lot ? {w:lot.w,d:lot.d,type:lot.type} : null, swapped, refused };
  });
  ok("the town library is loaded", !lib.missing);
  if (!lib.missing) {
    ok("it lays out a town", lib.c.lots > 60 && lib.c.blocks === 30,
       `${lib.c.lots} buildings on ${lib.c.blocks} blocks · ` +
       Object.keys(lib.c.by).sort().map(k => lib.c.by[k] + " " + k).join(", ") +
       ` · ${lib.c.streets} street runs, ${lib.c.junctions} junctions`);
    ok("no building stands in another", lib.overlaps === 0,
       `${lib.overlaps} pairs overlap, worst ${lib.worstOverlap.toFixed(1)} m²`);
    ok("and none of them stands in the road", lib.outside === 0 && lib.inRoad === 0,
       `${lib.outside} outside their own block, ${lib.inRoad} in a corridor`);
    /* ONE DINER, AND A BIG ONE. Weighted per lot it came out thirty times a
       town, every one shrunk to a house's frontage — thirty small diners is
       not a town, it is a food court. */
    ok("a town gets one diner", lib.dn.length === 1,
       `${lib.dn.length} diners in a town of ${lib.c.lots} buildings`);
    ok("and it is a landmark rather than a lot",
       lib.dn.length === 1 && lib.dn[0].landmark && lib.dn[0].main &&
       lib.dn[0].scale >= 1 && lib.dn[0].w > lib.widestHouse * 1.3,
       lib.dn.length
         ? `${lib.dn[0].w.toFixed(1)} × ${lib.dn[0].d.toFixed(1)} m at ` +
           `${lib.dn[0].scale.toFixed(2)}× on ${lib.dn[0].frontage.toFixed(1)} m of ` +
           `main-street frontage, against the widest house at ${lib.widestHouse.toFixed(1)} m`
         : "none placed");
    /* and the count is a number, not a coincidence */
    ok("ask for three and get three, ask for none and get none",
       lib.three === 3 && lib.none === 0,
       `${lib.three} and ${lib.none}`);
    ok("and the works stands in its own ground", lib.worksWhole,
       "every factory has a block to itself");
    /* TWO HUNDRED HOUSES OFF ONE ELEVATION, and not two hundred of the same
       box. The number that matters is how many of them are distinguishable
       from each other, not how many knobs were turned. */
    ok("no two houses in a row are the same building",
       lib.hSig > lib.houses * 0.75 && lib.nTints >= 6 && lib.nRidges === 2,
       `${lib.hSig} distinguishable of ${lib.houses} houses · ` +
       Object.keys(lib.wings).sort().map(k => lib.wings[k] + " " + k).join(", ") +
       ` · ${lib.nTints} colours · ${lib.stacks} with a stack · ridges both ways`);
    /* and it is a control, not a coincidence: turned off, the town is the one
       this made before any of it — every house the elevation as forged */
    ok("and turning variety off puts every house back",
       lib.plainSig === 1 && lib.plainH > 100,
       `${lib.plainSig} style among ${lib.plainH} houses at variety 0 — ` +
       "the elevation exactly as forged, which is the town this used to make");
    /* the road texture spans a whole cross-section, so the grid has to be
       built around ITS width or the kerbs land in the wrong place */
    ok("the street's own tile sets the corridor width",
       lib.roadM === 14 && lib.wideRoadM === 24 && lib.wideW > lib.W,
       `14 m of road makes a ${lib.W.toFixed(0)} m town, 24 m makes ${lib.wideW.toFixed(0)} m`);
    ok("design mode can put a different building on a lot",
       lib.swapped && lib.now.type === "house" && lib.now.w !== lib.was.w,
       `${lib.was.type} ${lib.was.w.toFixed(1)}×${lib.was.d.toFixed(1)} → ` +
       `${lib.now.type} ${lib.now.w.toFixed(1)}×${lib.now.d.toFixed(1)} m`);
    ok("and refuses the one that will not fit", lib.refused,
       "a works does not go on a house lot");
  }

  /* ---- the geometry -------------------------------------------------- */
  const geo = await page.evaluate(() => {
    const T = window.ForgeTown, M = window.ForgeModel;
    if (!T || !M || !M.townScene) return { missing: true };
    const face = (n, w, h, extra) => Object.assign(
      { plan:{w,h,cutout:true,eaves:h,tile:0,roof:null}, material:{name:n,maps:{},cutout:true} },
      extra || {});
    const kit = {
      house:{ front: face("house_front",9.8,9.2,{plan:{w:9.8,h:9.2,eaves:6.4,cutout:true,tile:0,
                                                       roof:{kind:"gable",pitch:7,ridge:"x"}}}),
              side: face("house_side",11.5,9.2), back: face("house_back",9.8,9.2),
              roof: {plan:{w:2,h:2,tile:2,eaves:0,cutout:false},material:{name:"house_roof",maps:{}}} },
      diner:{ front: face("diner_front",14,6), side: face("diner_side",9,6),
              back: face("diner_back",14,6),
              roof: {plan:{w:2,h:2,tile:2,eaves:0,cutout:false},material:{name:"flat_roof",maps:{}}} },
      factory:{ front: face("factory_front",26,14), side: face("factory_side",34,14),
                back: face("factory_back",26,14),
                roof: {plan:{w:4,h:4,tile:4,eaves:0,cutout:false},material:{name:"flat_roof",maps:{}}} },
      street:{ run:{plan:{w:14,h:14,tile:14,cutout:false},material:{name:"road",maps:{}}},
               inter:{plan:{w:14,h:14,tile:14,cutout:false},material:{name:"junction",maps:{}}} }
    };
    const sizes = { house:{w:9.8,d:11.5}, diner:{w:14,d:9}, factory:{w:26,d:34} };
    const L = T.settle(T.layout({seed:1963,cols:6,rows:5,blockW:70,blockD:55,roadM:14,
                                 jitter:0.35,density:0.9}, sizes));
    const S = M.townScene("town", L, kit);
    let verts = 0, tris = 0, biggest = 0, backwards = 0, untagged = 0;
    for (const m of S.meshes) {
      verts += m.pos.length/3; tris += m.idx.length/3;
      biggest = Math.max(biggest, m.pos.length/3);
      if (!m.tag || m.tag.length !== m.idx.length/3) untagged++;
      for (let i = 0; i < m.idx.length; i += 3) {
        const P = k => [m.pos[k*3], m.pos[k*3+1], m.pos[k*3+2]];
        const a = P(m.idx[i]), b = P(m.idx[i+1]), c = P(m.idx[i+2]);
        const u = [b[0]-a[0],b[1]-a[1],b[2]-a[2]], v = [c[0]-a[0],c[1]-a[1],c[2]-a[2]];
        const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
        const k = m.idx[i]*3;
        if (n[0]*m.nrm[k] + n[1]*m.nrm[k+1] + n[2]*m.nrm[k+2] <= 0) backwards++;
      }
    }
    /* the selected building comes out on its own so it can be lit alone */
    const S2 = M.townScene("town", L, kit, {select: L.lots[7].i});
    const sel = S2.meshes.filter(m => m.sel);
    const selTags = [...new Set(sel.flatMap(m => m.tag || []))];
    const faces = new Set(S.materials.map(m => m.face || m.name));
    const painted = S.materials.filter(m => m.tint).length;
    return { meshes: S.meshes.length, mats: S.materials.length, faces: faces.size,
             painted, verts, tris, biggest,
             backwards, untagged, lots: L.lots.length,
             selMeshes: sel.length, selTris: sel.reduce((a,m)=>a+m.idx.length/3,0),
             selTags, want: L.lots[7].i };
  });
  ok("the town assembles into geometry", !geo.missing);
  if (!geo.missing) {
    /* ONE MESH PER MATERIAL, not one per building. Two hundred meshes of twenty
       vertices is two hundred draw calls and a stage in single figures. */
    ok("one mesh per texture, not one per building",
       geo.meshes <= geo.mats + 2 && geo.tris > geo.lots * 8,
       `${geo.lots} buildings · ${geo.tris} triangles in ${geo.meshes} meshes ` +
       `over ${geo.mats} materials · biggest mesh ${geo.biggest} verts`);
    ok("and no mesh can outgrow a 16-bit index", geo.biggest < 65536,
       `${geo.biggest} vertices in the biggest one`);
    ok("every triangle is wound to its own normal", geo.backwards === 0,
       `${geo.backwards} wound backwards — a back-face cull makes holes of those`);
    /* which building did I click? The material cannot answer it: a hundred
       houses share one. */
    ok("every triangle knows which building it belongs to", geo.untagged === 0,
       `${geo.untagged} meshes without a tag per triangle`);
    /* THE PAINT TRAVELS. One image worn in several colours is several
       materials sharing one texture, which is what glTF's baseColorFactor and
       OBJ's Kd are for — so the town arrives painted rather than arriving grey
       with a note about it. */
    ok("the paint is materials, not extra textures",
       geo.painted >= 6 && geo.faces <= 12,
       `${geo.mats} materials over ${geo.faces} forged textures, ` +
       `${geo.painted} of them carrying a colour`);
    ok("and the selected one comes out on its own",
       geo.selMeshes > 0 && geo.selTags.length === 1 && geo.selTags[0] === geo.want,
       `${geo.selTris} triangles in ${geo.selMeshes} meshes, all tagged ${geo.selTags.join(",")}`);
  }
}

/* ============================ the hull's windows ============================
   Nothing that holds pressure has square corners — a corner is where the hoop
   stress goes to find something to tear — so every port cut in a real hull is
   a slot with radiused ends or a plain circle. These were rectangles, which
   read as a decal painted on the plating rather than a hole cut through it.

   MEASURED OFF THE METALLIC MAP. A pane is the deliberate glass cheat, 0.85
   against a hull of 0.15, which is a cleaner mask than the height field and
   does not depend on how deep the recess happens to be scaled.

   THE SHAPE CLAIM IS THE CORNER. A rectangle fills the corner of its own
   bounding box and a capsule does not, so walking out to the corner answers
   "capsule or rectangle" on its own — and the extents answer which way round
   it is laid and which of them came out round.
   ========================================================================== */
if (want("hull")) {
  console.log("\n— the hull's windows —");
  await page.click('#modebar-tabs [data-mode="hull"]');
  await settle();

  const panes = async set => {
    /* THE GRID THE TEST WALKS IS THE GRID THE MODE DREW, taken from the same
       numbers rather than typed twice — a scan on five bands over a texture of
       three lands its samples between the panes and reports nonsense with
       total confidence, which is exactly what it did. */
    const P = Object.assign({ size: 512, tileM: 12, winRows: 3, winPitch: 2.0, winLit: 1,
                              winW: 0.8, winH: 1.8, hatch: 0, winGrime: 0, winRoom: 1,
                              winGlow: 0.8, winRough: 0.07, winMetal: 0.85 }, set);
    await page.evaluate(p => { for (const k in p) window.Forge.setParam("hull", k, p[k]); }, P);
    await page.click("#hull--forge");
    await settle();
    return await page.evaluate(([nBands, pitch, tile]) => {
      const B = window.Forge.active().B, S = B.W, MET = B.MET;
      const nCols = Math.max(1, Math.round(tile / pitch));
      const on = (x, y) => MET[((y % S + S) % S) * S + ((x % S + S) % S)] > 128;
      const at = (a, x, y) => a[((y % S + S) % S) * S + ((x % S + S) % S)];
      const out = [];
      let emiMax = 0, hullR = 0, hullM = 0, hullN = 0, paneR = 0, paneM = 0, paneN = 0;
      for (let k = 0; k < S * S; k++) {
        if (B.EMI && B.EMI[k] > emiMax) emiMax = B.EMI[k];
        if (MET[k] > 128) { paneR += B.RGH[k]; paneM += MET[k]; paneN++; }
        else { hullR += B.RGH[k]; hullM += MET[k]; hullN++; }
      }
      for (let j = 0; j < nBands; j++) for (let i = 0; i < nCols; i++) {
        const cx = Math.round((i + 0.5) / nCols * S), cy = Math.round((j + 0.5) / nBands * S);
        if (!on(cx, cy)) { out.push(null); continue; }
        /* how far the pane reaches from its own centre, each way */
        let du = 0, dv = 0;
        while (du < S / 2 && on(cx + du + 1, cy)) du++;
        while (dv < S / 2 && on(cx, cy + dv + 1)) dv++;
        /* and whether the corner of that bounding box is inside it, which is
           the whole difference between a capsule and a rectangle */
        const corner = on(cx + Math.round(du * 0.86), cy + Math.round(dv * 0.86));
        /* the middle of the glass against the LAST TEXEL of it before the
           seal. Not a fraction of the way out: the grime pulls the metallic
           mask in, so a fraction of the masked radius lands further inside
           than intended and on a small pane lands clean. Two texels in from
           that, though, or the antialiasing ramp on the silhouette itself
           shows up as a difference when there is no grime at all. */
        const ex = cx + Math.max(1, du - 2);
        out.push({ du, dv, corner,
                   rMid: at(B.RGH, cx, cy), rEdge: at(B.RGH, ex, cy),
                   mMid: at(MET, cx, cy),   mEdge: at(MET, ex, cy),
                   emi: B.EMI ? at(B.EMI, cx, cy) : 0 });
      }
      return { nCols, panes: out, emiMax,
               hullR: hullR / Math.max(1, hullN), hullM: hullM / Math.max(1, hullN),
               paneR: paneR / Math.max(1, paneN), paneM: paneM / Math.max(1, paneN),
               paneN };
    }, [P.winRows, P.winPitch, P.tileM]);
  };

  const V = await panes({ winShape: "vcap", winRound: 0 });
  const found = V.panes.filter(Boolean);
  ok("the hull cuts windows", found.length >= 10,
     `${found.length} panes of ${V.panes.length} cells`);
  ok("a pane is a capsule, not a rectangle",
     found.length > 0 && found.every(p => !p.corner),
     `${found.filter(p => p.corner).length} of ${found.length} fill the corner of ` +
     "their own bounding box — a rectangle fills it, a capsule cannot");
  ok("and it stands upright when asked to",
     found.every(p => p.dv > p.du * 1.4),
     `reach ${found[0].du} across, ${found[0].dv} along`);

  const H = await panes({ winShape: "hcap", winRound: 0 });
  const hFound = H.panes.filter(Boolean);
  ok("the same shape lies down when asked to",
     hFound.length > 0 && hFound.every(p => p.du > p.dv * 1.4) && hFound.every(p => !p.corner),
     `reach ${hFound[0].du} across, ${hFound[0].dv} along — and still no corner`);

  /* A CIRCLE IS THE SAME CAPSULE WITH NO STRAIGHT SECTION, which is what lets
     the round ones sit in a row of slots and belong to it: same radius, same
     reveal, same glass. So at one, every pane is as wide as it is tall. */
  const R = await panes({ winShape: "vcap", winRound: 1 });
  const rFound = R.panes.filter(Boolean);
  const round = p => Math.abs(p.dv - p.du) <= Math.max(1, p.du * 0.25);
  ok("all round when the fraction is one",
     rFound.length > 0 && rFound.every(round),
     `${rFound.filter(round).length} of ${rFound.length} are as wide as they are tall`);
  ok("and the round ones are the same width as the slots",
     rFound.length > 0 && found.length > 0 && Math.abs(rFound[0].du - found[0].du) <= 1,
     `circle reaches ${rFound[0].du}, capsule reaches ${found[0].du} — the same radius`);

  const M = await panes({ winShape: "vcap", winRound: 0.5 });
  const mFound = M.panes.filter(Boolean);
  const nRound = mFound.filter(round).length;
  ok("and scattered through the rows in between",
     nRound > 0 && nRound < mFound.length,
     `${nRound} round among ${mFound.length - nRound} slots`);

  /* =================== the glass, with nothing switched on ===================
     HALF THE WINDOWS ON A HULL ARE DARK at any moment, and a black rectangle is
     what a decal looks like. The model kits for the six-foot Enterprise-D
     supply clear, white and DARK-TINTED plastic for exactly this reason. So an
     unlit pane has to be a whole material in the channels that do not care
     whether anything is switched on behind it — which is the claim, and it is
     checked with the emissive turned off completely. */
  const D = await panes({ winShape: "vcap", winRound: 0, winLit: 0, winGlow: 0,
                          winGrime: 0.5, winGrimeW: 0.45 });
  ok("with every window unlit the emissive is empty", D.emiMax === 0,
     `brightest emissive texel ${D.emiMax}`);
  ok("and the glass is still glass in roughness and metallic",
     D.paneN > 500 && D.paneR < D.hullR * 0.6 && D.paneM > D.hullM * 3,
     `panes read ${D.paneR.toFixed(0)} rough / ${D.paneM.toFixed(0)} metallic ` +
     `against a hull at ${D.hullR.toFixed(0)} / ${D.hullM.toFixed(0)}`);
  /* THE DIRT IS AT THE SEAL, which is where it always is: the middle of a pane
     gets wiped and the last centimetre against the frame does not. */
  const dirty = D.panes.filter(Boolean);
  ok("and the dirt is at the seal, not spread over the pane",
     dirty.length > 0 && dirty.every(p => p.rEdge > p.rMid + 8 && p.mEdge < p.mMid - 8),
     `edge ${dirty[0].rEdge} rough / ${dirty[0].mEdge} metallic against ` +
     `${dirty[0].rMid} / ${dirty[0].mMid} in the middle of the same pane`);
  const clean = await panes({ winShape: "vcap", winRound: 0, winLit: 0, winGlow: 0,
                              winGrime: 0 });
  const flat = clean.panes.filter(Boolean);
  ok("and turning the grime off takes it away",
     flat.every(p => Math.abs(p.rEdge - p.rMid) <= 4 && Math.abs(p.mEdge - p.mMid) <= 4),
     "the pane reads the same at its edge as in its middle");

  /* A ROOM IS SEVERAL WINDOWS. On the six-foot Enterprise-D the panes of one
     compartment were meant to be all lit or all dark together — the two rows on
     deck nine famously are not, and that is exactly what a per-pane coin flip
     looks like. */
  const rooms = async n => {
    /* A ROOM HAS TO DIVIDE THE COUNT ACROSS THE TILE or the one straddling the
       seam is half lit, so the mode walks the asked-for length down to the
       nearest divisor. Twelve metres at a one-metre pitch is twelve panes,
       which three divides exactly — ask on a pitch it does not and the mode is
       right to give you two and the test would be wrong to complain. */
    const R2 = await panes({ winShape: "vcap", winRound: 0, winLit: 0.5, winGlow: 1,
                             winGrime: 0, winRoom: n, winPitch: 1.0 });
    const lit = R2.panes.map(p => p ? (p.emi > 0 ? 1 : 0) : null);
    let breaks = 0, runs = 0;
    for (let b = 0; b * R2.nCols < lit.length; b++)
      for (let i = 0; i < R2.nCols; i += n) {
        const room = lit.slice(b * R2.nCols + i, b * R2.nCols + i + n).filter(v => v !== null);
        if (!room.length) continue;
        runs++;
        if (room.some(v => v !== room[0])) breaks++;
      }
    return { breaks, runs, lit: lit.filter(v => v === 1).length, all: lit.filter(v => v !== null).length };
  };
  const R3 = await rooms(3);
  ok("windows light in rooms, not one at a time",
     R3.breaks === 0 && R3.lit > 0 && R3.lit < R3.all,
     `${R3.runs} rooms of three, ${R3.breaks} of them split · ` +
     `${R3.lit} of ${R3.all} panes lit`);

  /* ============== the plating stops, and the surround is a forging ==========
     Two defects that both live in the HEIGHT field, so both are measured
     there rather than off the metallic mask the shape tests use.

     THE PLATING RAN STRAIGHT ACROSS THE GLASS. The pane used to be carved out
     of the finished quilt, so the plate scribe lines, the bay lines and the
     hatch rings all continued over it and came out of the normal map as
     mullions dividing every port into panels — which is what the screenshot
     that started this shows. The claim is that the assembly sits on a flat
     machined pad, and a pad is FLAT: the height range inside the glass has to
     be a rounding error against the depth of a scribe line. It was a whole
     scribe line deep.

     AND THE SURROUND WAS A SCRIBE LINE. It was a hair over the plate seam in
     width and half a plate's relief in depth, which is the one weight on a
     hull that reads as engraved. A frame welded into a penetration is thick
     and it stands PROUD, so the collar is walked outward from the glass in
     texels and its height taken against the plating datum. */
  const collars = async set => {
    const P = Object.assign({ size: 512, tileM: 12, winRows: 3, winPitch: 2.0,
                              winW: 0.8, winH: 1.8, winShape: "vcap", winRound: 0,
                              winLit: 0, winGlow: 0, winGrime: 0, winRoom: 1,
                              hatch: 0.5, scribeW: 25, scribeD: 5, plateH: 1.5,
                              winFrame: 0.35, winLipH: 14 }, set);
    await page.evaluate(p => { for (const k in p) window.Forge.setParam("hull", k, p[k]); }, P);
    await page.click("#hull--forge");
    await settle();
    return await page.evaluate(([nBands, pitch, tile, lipMM, plateMM, scribeMM]) => {
      const B = window.Forge.active().B, S = B.W, MET = B.MET, HGT = B.HGT;
      const nCols = Math.max(1, Math.round(tile / pitch));
      const at = (a, x, y) => a[((y % S + S) % S) * S + ((x % S + S) % S)];
      const on = (x, y) => at(MET, x, y) > 128;
      const mm = h => h * tile * 1000;               // tile-width units to mm
      /* the plating datum. The median of the whole field is the plating by a
         wide margin — windows are a few per cent of a hull — and it does not
         care where the quilt happens to have put its seams. */
      const sorted = Float32Array.from(HGT).sort();
      const datum = sorted[sorted.length >> 1];
      /* a collar texel stands clear of BOTH the asked-for lip and the plate's
         own relief, so "no collar at all" cannot be faked by plate jitter */
      const thr = Math.max(lipMM * 0.4, plateMM * 1.5) / 1000 / tile;
      const out = [];
      for (let j = 0; j < nBands; j++) for (let i = 0; i < nCols; i++) {
        const cx = Math.round((i + 0.5) / nCols * S), cy = Math.round((j + 0.5) / nBands * S);
        if (!on(cx, cy)) { out.push(null); continue; }
        let du = 0, dv = 0;
        while (du < S / 2 && on(cx + du + 1, cy)) du++;
        while (dv < S / 2 && on(cx, cy + dv + 1)) dv++;
        /* IS THE GLASS FLAT? A box safely inside the pane, so the reveal wall
           and the antialiasing on the silhouette are both well outside it. */
        const ru = Math.max(1, Math.round(du * 0.6)), rv = Math.max(1, Math.round(dv * 0.6));
        let lo = Infinity, hi = -Infinity;
        for (let y = -rv; y <= rv; y++) for (let x = -ru; x <= ru; x++) {
          const h = at(HGT, cx + x, cy + y);
          if (h < lo) lo = h; if (h > hi) hi = h;
        }
        /* THE COLLAR, walked outward from the last texel of glass */
        let lipPx = 0, lipTop = -Infinity;
        for (let k = 1; k < S / 4; k++) {
          const h = at(HGT, cx + du + k, cy);
          if (h - datum <= thr) break;
          lipPx++; if (h > lipTop) lipTop = h;
        }
        out.push({ du, dv, flatMM: mm(hi - lo), lipPx,
                   lipMM: lipPx ? mm(lipTop - datum) : 0 });
      }
      return { nCols, panes: out.filter(Boolean),
               scribePx: scribeMM / 1000 / tile * S };
    }, [P.winRows, P.winPitch, P.tileM, P.winLipH, P.plateH, P.scribeW]);
  };

  const C = await collars({});
  ok("the plating stops at the window",
     C.panes.length > 6 && C.panes.every(p => p.flatMM < 5 * 0.25),
     `${C.panes.filter(p => p.flatMM >= 1.25).length} of ${C.panes.length} panes carry a ` +
     `quilt seam across the glass · worst ` +
     `${Math.max(...C.panes.map(p => p.flatMM)).toFixed(2)} mm of relief inside the ` +
     `pane against a 5 mm scribe line`);
  ok("and the surround is a collar, not a scribe line",
     C.panes.every(p => p.lipPx >= 3 && p.lipPx >= C.scribePx * 2.5),
     `${Math.min(...C.panes.map(p => p.lipPx))}–${Math.max(...C.panes.map(p => p.lipPx))} px ` +
     `of collar against a ${C.scribePx.toFixed(1)} px scribe line`);
  ok("and it stands proud of the plating",
     C.panes.every(p => p.lipMM > 14 * 0.5),
     `collar tops out ${(C.panes.reduce((a, p) => a + p.lipMM, 0) / C.panes.length).toFixed(1)} mm ` +
     `above the plating, asked for 14`);

  /* AND BOTH OF ITS DIMENSIONS ARE DRIVEN, or the collar is a constant with a
     control wired to nothing — which is what the old reveal very nearly was. */
  const thin = await collars({ winFrame: 0.12 }), thick = await collars({ winFrame: 0.75 });
  const mean = c => c.panes.reduce((a, p) => a + p.lipPx, 0) / c.panes.length;
  ok("the width control drives the collar",
     mean(thick) > mean(thin) * 2.5,
     `${mean(thin).toFixed(1)} px at 0.12 of the pane radius, ` +
     `${mean(thick).toFixed(1)} px at 0.75`);
  const flush = await collars({ winLipH: 0 });
  ok("and taking the relief out lays it flat",
     flush.panes.every(p => p.lipPx === 0),
     `${flush.panes.filter(p => p.lipPx > 0).length} of ${flush.panes.length} panes still ` +
     `stand proud at 0 mm of relief`);

  /* A PANE LONGER THAN ITS OWN CELL runs into its neighbour and a row of
     windows becomes one lit stripe, so both axes are clamped to the pitch. */
  const B2 = await panes({ winShape: "vcap", winRound: 0, winH: 4, winW: 3 });
  const bFound = B2.panes.filter(Boolean);
  const cellPx = 512 / B2.nCols;
  ok("a pane too big for its pitch is cut down to fit",
     bFound.length > 0 && bFound.every(p => p.du * 2 < cellPx),
     `asked for 3 m across on a ${(12 / B2.nCols).toFixed(1)} m pitch; ` +
     `reaches ${bFound[0].du} px of a ${cellPx.toFixed(0)} px cell`);
}

if (errors.length) { fails++; console.log("\npage errors:\n" + errors.join("\n")); }
console.log(fails ? `\nFAIL (${fails})` : "\nALL GOOD");
await browser.close();
/* NOT process.exit(): it does not wait for stdout to drain, and piping this
   into anything — a grep, a log file, CI — was losing the last few lines,
   including the verdict. Setting the code lets node exit on its own once the
   output is out. */
process.exitCode = fails ? 1 : 0;
