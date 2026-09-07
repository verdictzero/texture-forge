/* =====================================================================
   SELLWRONG — noises
   =====================================================================

   Synthesised, not sampled. Same reason as the textures: nothing to
   load, nothing to license, and everything comes out of one place so it
   all sits together. Six primitives — a noise burst, a tone sweep, a
   click, a thud, a hiss and a crackle — and every sound in the game is
   some arrangement of those.

   Sounds are POSITIONED. A zombie groaning two aisles over is quieter
   than one behind you, and that is most of what a Doom soundscape does
   for you: it tells you what is in the room before you can see it.
   Distance attenuation only — no panning — because Doom did not pan
   either and stereo separation on a thing you cannot see turns out to be
   less useful than it sounds.
   ===================================================================== */

const DEFS = {
  /* the store */
  ignite:    { kind: 'hiss',  dur: 0.55, f0: 900,  f1: 200,  gain: 0.30 },
  flame:     { kind: 'hiss',  dur: 0.20, f0: 1400, f1: 500,  gain: 0.16 },
  burn:      { kind: 'hiss',  dur: 0.35, f0: 600,  f1: 160,  gain: 0.22 },
  explode:   { kind: 'boom',  dur: 0.90, f0: 180,  f1: 30,   gain: 0.60 },
  throw:     { kind: 'sweep', dur: 0.18, f0: 500,  f1: 900,  gain: 0.16, wave: 'triangle' },
  glass:     { kind: 'noise', dur: 0.30, f0: 4200, f1: 1600, gain: 0.30 },

  /* weapons */
  swing:     { kind: 'sweep', dur: 0.12, f0: 700,  f1: 260,  gain: 0.14, wave: 'triangle' },
  cut:       { kind: 'noise', dur: 0.10, f0: 2600, f1: 700,  gain: 0.26 },

  /* the staff */
  assoSee:   { kind: 'sweep', dur: 0.42, f0: 210,  f1: 130,  gain: 0.30, wave: 'sawtooth' },
  assoPain:  { kind: 'sweep', dur: 0.22, f0: 330,  f1: 170,  gain: 0.30, wave: 'square' },
  assoDie:   { kind: 'sweep', dur: 0.72, f0: 260,  f1: 60,   gain: 0.34, wave: 'sawtooth' },
  assoIdle:  { kind: 'sweep', dur: 0.34, f0: 165,  f1: 120,  gain: 0.14, wave: 'sawtooth' },
  assoShoot: { kind: 'noise', dur: 0.09, f0: 3000, f1: 900,  gain: 0.34 },
  stkrSee:   { kind: 'sweep', dur: 0.50, f0: 150,  f1: 95,   gain: 0.34, wave: 'sawtooth' },
  stkrPain:  { kind: 'sweep', dur: 0.24, f0: 240,  f1: 120,  gain: 0.32, wave: 'square' },
  stkrDie:   { kind: 'sweep', dur: 0.95, f0: 190,  f1: 42,   gain: 0.38, wave: 'sawtooth' },
  stkrIdle:  { kind: 'sweep', dur: 0.40, f0: 120,  f1: 88,   gain: 0.15, wave: 'sawtooth' },
  stkrThrow: { kind: 'sweep', dur: 0.16, f0: 420,  f1: 700,  gain: 0.20, wave: 'triangle' },
  stkrHit:   { kind: 'thud',  dur: 0.16, f0: 220,  f1: 70,   gain: 0.36 },
  gib:       { kind: 'noise', dur: 0.42, f0: 1500, f1: 180,  gain: 0.44 },
  bodyfall:  { kind: 'thud',  dur: 0.28, f0: 130,  f1: 44,   gain: 0.30 },

  /* you */
  hurt:      { kind: 'sweep', dur: 0.24, f0: 420,  f1: 200,  gain: 0.30, wave: 'square' },
  playerDie: { kind: 'sweep', dur: 1.30, f0: 340,  f1: 46,   gain: 0.44, wave: 'sawtooth' },
  pickup:    { kind: 'sweep', dur: 0.14, f0: 700,  f1: 1300, gain: 0.22, wave: 'square' },
  noammo:    { kind: 'click', dur: 0.05, f0: 240,  f1: 160,  gain: 0.18 },

  /* the building */
  dooropen:  { kind: 'sweep', dur: 0.60, f0: 90,   f1: 190,  gain: 0.24, wave: 'sawtooth' },
  doorclose: { kind: 'sweep', dur: 0.55, f0: 190,  f1: 80,   gain: 0.24, wave: 'sawtooth' },
  switch:    { kind: 'click', dur: 0.07, f0: 900,  f1: 400,  gain: 0.24 },
  alarm:     { kind: 'sweep', dur: 0.70, f0: 880,  f1: 660,  gain: 0.22, wave: 'square' },
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.listener = { x: 0, y: 0 };
    this.maxDistance = 1800;
    this._noiseBuf = null;
    this._lastAt = new Map();       // one of each sound per few tics, at most
  }

  /* Browsers will not start an AudioContext until the user has done
     something, so this is called from the first click. */
  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this._makeNoise();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) { if (this.master) this.master.gain.value = v; }

  _makeNoise() {
    const n = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    /* pink-ish: white noise run through a one-pole low pass, which is
       much closer to fire and to impacts than white ever is */
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = last * 0.86 + w * 0.14;
      d[i] = last * 3.2 + w * 0.3;
    }
    this._noiseBuf = buf;
  }

  play(name, from) {
    if (!name || !this.enabled || !this.ctx) return;
    const def = DEFS[name];
    if (!def) return;

    /* Distance. A sound with no source is the player's own and plays at
       full volume. */
    let gain = def.gain;
    if (from && from !== this.listener) {
      const d = Math.hypot(from.x - this.listener.x, from.y - this.listener.y);
      if (d > this.maxDistance) return;
      gain *= Math.max(0, 1 - d / this.maxDistance) ** 1.7;
      if (gain < 0.004) return;
    }

    /* Twenty of the same groan in one tic is a buzz, not a soundscape. */
    const now = this.ctx.currentTime;
    const last = this._lastAt.get(name) || -1;
    if (now - last < 0.045) return;
    this._lastAt.set(name, now);

    const g = this.ctx.createGain();
    g.connect(this.master);
    const t = now;
    const dur = def.dur;

    if (def.kind === 'noise' || def.kind === 'hiss' || def.kind === 'boom' || def.kind === 'thud') {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = true;
      src.playbackRate.value = def.kind === 'boom' ? 0.5 : 1;
      const f = this.ctx.createBiquadFilter();
      f.type = (def.kind === 'boom' || def.kind === 'thud') ? 'lowpass' : 'bandpass';
      f.Q.value = def.kind === 'hiss' ? 0.7 : 1.4;
      f.frequency.setValueAtTime(def.f0, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(20, def.f1), t + dur);
      src.connect(f); f.connect(g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, dur * 0.2));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.start(t); src.stop(t + dur + 0.02);
    } else {
      const o = this.ctx.createOscillator();
      o.type = def.wave || 'sine';
      o.frequency.setValueAtTime(def.f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, def.f1), t + dur);
      o.connect(g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
    }
  }

  /** The bed of noise a burning building makes. Started once the fire
   *  gets going and modulated by how much of the store is alight. */
  startAmbience() {
    if (!this.ctx || this._amb) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 0.4;
    const g = this.ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    this._amb = { src, g, f };
  }

  setAmbience(level) {
    if (!this._amb) return;
    const g = this._amb.g.gain;
    g.setTargetAtTime(Math.min(0.30, level * 0.34), this.ctx.currentTime, 0.6);
    this._amb.f.frequency.setTargetAtTime(500 + level * 1600, this.ctx.currentTime, 0.6);
  }
}
