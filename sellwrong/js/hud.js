/* =====================================================================
   SELLWRONG — the status bar and the thing in your hands
   =====================================================================

   All of this is drawn INTO the low-resolution buffer, at the same chunk
   size as the walls, before the palette snap. That is the whole point:
   a crisp modern overlay on a chunky world reads as a filter applied to
   a photograph, and one frame of it undoes everything the renderer is
   doing. The weapon, the numbers, the messages and the damage flash are
   all made of the same pixels as the floor.

   WHAT THE BAR SAYS. Doom's status bar answered "can I keep fighting" —
   ammo, health, armour, keys. This one has to answer a different
   question, because the fight is not the point:

     BURNED   how much of the store has gone. The win condition, on
              screen at all times, going up.
     FUEL     how much more of it you can take before you are down to a
              boxcutter and whatever is already alight.

   Those two are the game. Health is there because you can die, and it is
   the smallest number on the bar.
   ===================================================================== */

import * as THREE from 'three';
import { Pix, drawText, drawTextCentred, textWidth } from './pixel.js';
import { createHudMaterial } from './material.js';
import { weaponTexture } from './sprites.js';
import { WEAPONS } from './player.js';

const BAR_H = 32;

/** drawText, but every pixel becomes an n-by-n block. The big numbers on
 *  the bar need to be readable at 320 across from a metre away. */
function bigText(pix, str, x, y, key, t, scale = 2, spacing = 1) {
  const tmp = new Pix(textWidth(str, spacing) + 2, 8, 1, false);
  drawText(tmp, str, 0, 0, key, t, spacing);
  for (let sy = 0; sy < 8; sy++)
    for (let sx = 0; sx < tmp.w; sx++) {
      if (tmp.alphaAt(sx, sy) < 8) continue;
      const c = tmp.get(sx, sy);
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++)
          pix.set(x + sx * scale + dx, y + sy * scale + dy, c[0], c[1], c[2], 255);
    }
  return x + tmp.w * scale;
}

export class Hud {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-160, 160, 100, -100, -100, 100);
    this.width = 320; this.height = 200;

    /* the weapon */
    const geo = new THREE.PlaneGeometry(1, 1);
    this.weaponMesh = new THREE.Mesh(geo, createHudMaterial(null));
    this.weaponMesh.renderOrder = 1;
    this.weaponMesh.frustumCulled = false;
    this.scene.add(this.weaponMesh);

    /* the bar */
    this.barPix = null;
    this.barTex = null;
    this.barMesh = new THREE.Mesh(geo, createHudMaterial(null));
    this.barMesh.renderOrder = 3;
    this.barMesh.frustumCulled = false;
    this.scene.add(this.barMesh);

    /* the full-screen wash for damage and pickups */
    this.tintMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xff0000, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    this.tintMesh.renderOrder = 2;
    this.tintMesh.frustumCulled = false;
    this.scene.add(this.tintMesh);

    /* messages and the big middle-of-the-screen text */
    this.msgPix = null; this.msgTex = null;
    this.msgMesh = new THREE.Mesh(geo, createHudMaterial(null));
    this.msgMesh.renderOrder = 4;
    this.msgMesh.frustumCulled = false;
    this.msgMesh.visible = false;
    this.scene.add(this.msgMesh);

    this.messages = [];
    this._barKey = '';
    this._msgKey = '';
  }

  resize(w, h) {
    this.width = w; this.height = h;
    this.camera.left = -w / 2; this.camera.right = w / 2;
    this.camera.top = h / 2; this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
    this._barKey = '';           // force a rebuild at the new width
    this._msgKey = '';
  }

  message(text, tics = 105) {
    this.messages.push({ text: String(text).toUpperCase(), tics });
    if (this.messages.length > 4) this.messages.shift();
  }

  ticMessages() {
    for (const m of this.messages) m.tics--;
    this.messages = this.messages.filter(m => m.tics > 0);
  }

  /* ------------------------------------------------------------------
     The bar

     Rebuilt only when something on it changed. Every value that appears
     goes into the key, so a frame in which nothing moved costs one
     string comparison.
     ------------------------------------------------------------------ */
  buildBar(p) {
    const w = this.width;
    const key = [w, p.health | 0, p.armour | 0, p.ammo.fuel | 0, p.ammo.bottles | 0,
                 p.weapon, Math.round(this.game.burnPercent), p.kills, this.game.totalMonsters].join('|');
    if (key === this._barKey) return;
    this._barKey = key;

    const pix = new Pix(w, BAR_H, 1, false);
    /* the bar itself: a dark plate with a lit top edge */
    for (let y = 0; y < BAR_H; y++)
      for (let x = 0; x < w; x++)
        pix.ink(x, y, 'grey', y < 2 ? 0.22 : 0.09 + (y / BAR_H) * 0.03);
    pix.hline(0, w - 1, 0, 'grey', 0.34);
    pix.hline(0, w - 1, 1, 'grey', 0.16);

    const cell = w / 5;
    const label = (x, s) => drawText(pix, s, Math.round(x), 5, 'grey', 0.42);

    /* BURNED — the objective, and the only thing on the bar that is
       allowed to be the brightest thing on the bar */
    const burn = Math.round(this.game.burnPercent);
    label(6, 'BURNED');
    bigText(pix, String(burn).padStart(2, ' ') + '%', 6, 13, 'fire', burn > 66 ? 0.92 : burn > 33 ? 0.78 : 0.62, 2);
    /* and a gauge under it, because a number going up is less legible
       than a bar filling */
    const gw = Math.round(cell - 16);
    for (let x = 0; x < gw; x++) {
      const f = x / gw;
      const on = f * 100 <= burn;
      pix.ink(6 + x, 29, on ? 'fire' : 'grey', on ? 0.45 + f * 0.5 : 0.14);
      pix.ink(6 + x, 30, on ? 'fire' : 'grey', on ? 0.30 + f * 0.4 : 0.10);
    }
    /* the target line */
    const tx = 6 + Math.round(gw * this.game.burnTarget / 100);
    pix.ink(tx, 28, 'bone', 0.8); pix.ink(tx, 29, 'bone', 0.8); pix.ink(tx, 30, 'bone', 0.8);

    /* FUEL */
    label(cell + 6, 'FUEL');
    const fuel = p.ammo.fuel | 0;
    bigText(pix, String(fuel).padStart(3, ' '), cell + 6, 13, 'yellow',
            fuel > 60 ? 0.80 : fuel > 20 ? 0.66 : 0.44, 2);

    /* the weapon you are holding, and the ones you are not */
    label(cell * 2 + 6, 'ARMS');
    let ax = cell * 2 + 6;
    for (const [k, d] of Object.entries(WEAPONS)) {
      const has = p.owned[k];
      const on = k === p.weapon;
      bigText(pix, String(d.slot), Math.round(ax), 13, on ? 'yellow' : 'grey', on ? 0.86 : (has ? 0.34 : 0.14), 2);
      ax += 12;
    }
    drawText(pix, WEAPONS[p.weapon].name.slice(0, 9), Math.round(cell * 2 + 6), 26, 'bone', 0.5);

    /* HEALTH */
    label(cell * 3 + 6, 'HEALTH');
    const hp = Math.max(0, p.health | 0);
    bigText(pix, String(hp).padStart(3, ' ') + '%', cell * 3 + 6, 13, 'red',
            hp > 60 ? 0.72 : hp > 25 ? 0.62 : 0.50, 2);

    /* KILLS, and the bottles, which share the last cell */
    label(cell * 4 + 6, 'KILLS');
    bigText(pix, `${p.kills}`, cell * 4 + 6, 13, 'bone', 0.72, 2);
    drawText(pix, 'BOTTLES ' + (p.ammo.bottles | 0), Math.round(cell * 4 + 6), 26, 'green', 0.62);

    pix.snap(0);
    if (this.barTex) this.barTex.dispose();
    this.barTex = new THREE.CanvasTexture(pix.toCanvas());
    this.barTex.magFilter = THREE.NearestFilter;
    this.barTex.minFilter = THREE.NearestFilter;
    this.barTex.generateMipmaps = false;
    this.barTex.colorSpace = THREE.SRGBColorSpace;
    this.barTex.needsUpdate = true;
    this.barMesh.material.uniforms.map.value = this.barTex;
    this.barPix = pix;
  }

  buildMessages() {
    const big = this.game.bigMessage;
    const key = this.messages.map(m => m.text).join('/') + '#' + (big || '') + '#' + this.width;
    if (key === this._msgKey) return;
    this._msgKey = key;
    if (!this.messages.length && !big) { this.msgMesh.visible = false; return; }

    const h = 60;
    const pix = new Pix(this.width, h, 1, false);
    this.messages.forEach((m, i) => drawText(pix, m.text, 4, 4 + i * 8, 'bone', 0.86));
    if (big) {
      const lines = big.split('\n');
      lines.forEach((ln, i) => {
        const y = 26 + i * 12;
        const tw = textWidth(ln) * 2;
        bigText(pix, ln, Math.round((this.width - tw) / 2), y, 'fire', 0.85, 2);
      });
    }
    pix.snap(0);
    if (this.msgTex) this.msgTex.dispose();
    this.msgTex = new THREE.CanvasTexture(pix.toCanvas());
    this.msgTex.magFilter = THREE.NearestFilter;
    this.msgTex.minFilter = THREE.NearestFilter;
    this.msgTex.generateMipmaps = false;
    this.msgTex.colorSpace = THREE.SRGBColorSpace;
    this.msgTex.needsUpdate = true;
    this.msgMesh.material.uniforms.map.value = this.msgTex;
    this.msgMesh.scale.set(this.width, h, 1);
    this.msgMesh.position.set(0, this.height / 2 - h / 2, 0);
    this.msgMesh.visible = true;
  }

  /* ------------------------------------------------------------------
     Per frame
     ------------------------------------------------------------------ */
  update(player, weaponBank) {
    const W = this.width, H = this.height;

    this.buildBar(player);
    this.buildMessages();
    this.barMesh.scale.set(W, BAR_H, 1);
    this.barMesh.position.set(0, -H / 2 + BAR_H / 2, 0);

    /* the weapon: which frame, and where the bob has put it */
    const d = WEAPONS[player.weapon];
    const letter = player.firing ? (d.fire[Math.min(player.fireIndex, d.fire.length - 1)]) : d.ready;
    const entry = weaponBank.get(d.sprite + letter) || weaponBank.get(d.sprite + d.ready);
    if (entry) {
      this.weaponMesh.material.uniforms.map.value = weaponTexture(entry);
      /* Scaled so the weapon is about two-thirds of the frame height,
         whatever the chunkiness setting is — the weapon should not get
         smaller because somebody chose a sharper picture. */
      const s = (H * 0.62) / entry.h;
      this.weaponMesh.scale.set(entry.w * s, entry.h * s, 1);
      const bobX = Math.cos(player.bobPhase) * player.bob * 0.55;
      const bobY = Math.abs(Math.sin(player.bobPhase)) * player.bob * 0.5;
      /* sits low and right, the way it is drawn */
      this.weaponMesh.position.set(
        W * 0.10 + bobX,
        -H / 2 + BAR_H + (entry.h * s) / 2 - H * 0.10 - bobY,
        0);
      this.weaponMesh.visible = !player.dead;
    }

    /* the wash over everything */
    /* Doom's damage flash is a few frames of a shifted palette, not a
       red filter left over the picture. At 0.55 across a dark stockroom
       the whole level went the colour of the inside of an eyelid and
       stayed there — which is not feedback, it is a fault. */
    let tintA = 0, tintC = 0xff2010;
    if (player.damageFlash > 0) tintA = Math.min(0.30, player.damageFlash / 70);
    else if (player.pickupFlash > 0) { tintA = Math.min(0.18, player.pickupFlash / 60); tintC = 0xffd060; }
    if (player.dead) tintA = Math.max(tintA, 0.35);
    this.tintMesh.material.opacity = tintA;
    this.tintMesh.material.color.setHex(tintC);
    this.tintMesh.scale.set(W, H, 1);
    this.tintMesh.visible = tintA > 0.002;
  }
}
