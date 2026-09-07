/* =====================================================================
   SELLWRONG — boot
   =====================================================================

   Bake the art, build the shop, wire it up, and hand the frame loop over
   to Game.

   Nothing is downloaded. Every texture and every sprite in the game is
   generated in this process, at start-up, in about half a second, which
   is why there is a loading bar at all and why it only ever says four
   things.
   ===================================================================== */

import * as THREE from 'three';
import { LofiPipeline } from './lofi.js';
import { bakeTextures } from './textures.js';
import { bakeSprites, bakeWeapons } from './sprites.js';
import { buildSellWrong } from './maps/sellwrong.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { world } from './material.js';
import { TICRATE } from './util.js';

const $ = id => document.getElementById(id);
const status = (text, pct) => {
  const s = $('load-status'), b = $('load-bar');
  if (s) s.textContent = text;
  if (b) b.style.width = (pct * 100).toFixed(0) + '%';
};

/* How chunky. The vertical resolution of the internal buffer — width
   follows the window's shape, so a wider monitor shows more store rather
   than the same store stretched. */
const DETAIL = [120, 150, 200, 240, 300, 400];
let detailIndex = 2;

async function boot() {
  const container = $('game');
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);              // the pipeline decides the resolution, not the display
  renderer.autoClear = false;
  renderer.setClearColor(0x05060a, 1);
  container.appendChild(renderer.domElement);
  renderer.domElement.id = 'view';

  const scene = new THREE.Scene();
  /* Sky sectors draw nothing, so what shows through is this. A night
     that is not quite black, so a silhouette against it still reads. */
  scene.background = new THREE.Color(0x0a0c14);

  const camera = new THREE.PerspectiveCamera(72, 1.6, 4, 6000);

  /* yield to the browser between steps so the loading bar can move */
  const breathe = () => new Promise(r => setTimeout(r, 0));

  status('BAKING TEXTURES', 0.05); await breathe();
  const textures = bakeTextures();

  status('BAKING SPRITES', 0.35); await breathe();
  const sprites = bakeSprites();
  const weapons = bakeWeapons();

  status('BUILDING SELLWRONG', 0.70); await breathe();
  const level = buildSellWrong();

  status('OPENING', 0.90); await breathe();
  const hud = new Hud(null);
  const audio = new Audio();
  const input = new Input(renderer.domElement);
  const game = new Game({ level, scene, camera, textures, sprites, hud, audio, input });
  hud.game = game;

  const pipeline = new LofiPipeline(renderer, { height: DETAIL[detailIndex], dither: 1.0, snap: 1.0 });

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    const r = pipeline.resize(w, h);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    hud.resize(r.width, r.height);
  }
  addEventListener('resize', resize);
  resize();

  /* The car park is outdoors at night and the store has its own lights,
     so the distance falloff has to reach a long way or the far end of
     the shop floor is simply black. */
  world.lightFalloff.value = 3400;
  world.minLight.value = 0.22;

  status('READY', 1.0);
  const loading = $('loading');
  const title = $('title');
  loading.classList.add('gone');
  title.classList.remove('gone');

  let started = false;
  function start() {
    if (started) return;
    started = true;
    title.classList.add('gone');
    audio.resume();
    audio.startAmbience();
    input.requestLock();
    /* Space starts the game and Space is also Use, so without this the
       first thing that ever happens is NOTHING TO USE. */
    input.keys.clear();
    game.message('SELLWRONG SUPERSTORE');
    game.message('BURN ' + game.burnTarget + '% AND GET OUT');
  }
  addEventListener('keydown', e => {
    if (!started && (e.code === 'Space' || e.code === 'Enter')) { start(); return; }
    /* dead, and asked to try again */
    if (started && game.state !== 'play' && e.code === 'Space') location.reload();
    if (e.code === 'BracketLeft') setDetail(detailIndex - 1);
    if (e.code === 'BracketRight') setDetail(detailIndex + 1);
    if (e.code === 'KeyN') {                       // palette off, for comparison
      const u = pipeline.material.uniforms.uSnap;
      u.value = u.value > 0.5 ? 0 : 1;
    }
  });
  renderer.domElement.addEventListener('mousedown', () => { if (!started) start(); else audio.resume(); });

  function setDetail(i) {
    detailIndex = Math.max(0, Math.min(DETAIL.length - 1, i));
    pipeline.setHeight(DETAIL[detailIndex]);
    resize();
    game.message('DETAIL ' + DETAIL[detailIndex] + 'P');
  }

  /* ---- the loop ---------------------------------------------------- */
  let last = performance.now();
  let fpsAccum = 0, fpsFrames = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;

    if (started) game.update(dt);
    game.render();
    hud.update(game.player, weapons);
    pipeline.render(scene, camera, hud.scene, hud.camera);

    fpsAccum += dt; fpsFrames++;
    if (fpsAccum > 0.5) {
      const el = $('fps');
      if (el) el.textContent = `${Math.round(fpsFrames / fpsAccum)} FPS  ${pipeline.width}x${pipeline.height}  ` +
        `${game.actors.length} things  ${game.fire.burningCells} alight`;
      fpsAccum = 0; fpsFrames = 0;
    }
  }
  requestAnimationFrame(frame);

  /* let the console poke at it */
  window.SELLWRONG = { game, pipeline, renderer, scene, camera, textures, sprites, world, level };
}

boot().catch(e => {
  console.error(e);
  status('FAILED: ' + e.message, 1);
  const s = $('load-status');
  if (s) s.style.color = '#f44';
});
