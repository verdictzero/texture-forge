/* =====================================================================
   SELLWRONG — input
   =====================================================================

   One layer over keyboard, mouse, gamepad and touch, because the game
   should not care and there is no version of caring that ends well.
   Everything downstream reads the same four numbers and the same set of
   named buttons.

     move.x   -1 .. 1   strafe
     move.y   -1 .. 1   forward
     look.x             yaw this frame, in radians
     look.y             pitch this frame, in radians

   Buttons are edge-detected here rather than downstream: `pressed()` is
   true for exactly one frame, `down()` for as long as it is held. Weapon
   switching wants the first, the flamethrower wants the second, and
   working that out at each call site is how you end up with a
   flamethrower that fires once.

   MOUSE LOOK is pointer-locked and accumulates between frames rather
   than being sampled, so a fast flick is not lost between two vsyncs.
   ===================================================================== */

const KEYMAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', KeyQ: 'left',
  KeyD: 'right', KeyE: 'right',
  ArrowLeft: 'turnLeft', ArrowRight: 'turnRight',
  ShiftLeft: 'run', ShiftRight: 'run',
  Space: 'use', KeyF: 'use',
  ControlLeft: 'attack', ControlRight: 'attack',
  Digit1: 'weapon1', Digit2: 'weapon2', Digit3: 'weapon3',
  Tab: 'map', KeyM: 'map',
  Escape: 'pause', KeyP: 'pause',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.prev = new Set();
    this.mouseDown = false;
    this.mouseRight = false;
    this.mouseDX = 0; this.mouseDY = 0;
    this.wheel = 0;
    this.locked = false;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.touch = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, attack: false, use: false, weapon: 0 };
    this.hasTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this._bind();
  }

  _bind() {
    addEventListener('keydown', e => {
      const a = KEYMAP[e.code];
      if (a) { this.keys.add(a); e.preventDefault(); }
      /* raw codes too, so debug keys do not need a mapping entry */
      this.keys.add(e.code);
    });
    addEventListener('keyup', e => {
      const a = KEYMAP[e.code];
      if (a) this.keys.delete(a);
      this.keys.delete(e.code);
    });
    addEventListener('blur', () => this.keys.clear());

    this.canvas.addEventListener('mousedown', e => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.mouseRight = true;
      if (!this.locked) this.requestLock();
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.mouseRight = false;
    });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
  }

  requestLock() { this.canvas.requestPointerLock?.(); }

  down(name) { return this.keys.has(name); }
  pressed(name) { return this.keys.has(name) && !this.prev.has(name); }

  /** Call once a frame, before anything reads it. */
  sample(dt) {
    const pad = this._gamepad();

    let mx = 0, my = 0;
    if (this.down('right')) mx += 1;
    if (this.down('left')) mx -= 1;
    if (this.down('forward')) my += 1;
    if (this.down('back')) my -= 1;
    if (pad) { mx += dead(pad.axes[0]); my -= dead(pad.axes[1]); }
    mx += this.touch.move.x; my += this.touch.move.y;

    const mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; }
    this.move = { x: mx, y: my };

    let lx = this.mouseDX * this.sensitivity;
    let ly = this.mouseDY * this.sensitivity * (this.invertY ? -1 : 1);
    this.mouseDX = 0; this.mouseDY = 0;

    /* Keyboard turning and the right stick are RATES, so they scale with
       the frame; the mouse is a displacement and must not. */
    const turn = 2.6 * dt;
    if (this.down('turnLeft')) lx -= turn;
    if (this.down('turnRight')) lx += turn;
    if (pad) {
      lx += dead(pad.axes[2]) * 3.2 * dt;
      ly += dead(pad.axes[3]) * 2.2 * dt;
    }
    lx += this.touch.look.x; ly += this.touch.look.y;
    this.touch.look.x = 0; this.touch.look.y = 0;
    this.look = { x: lx, y: ly };

    this.attack = this.mouseDown || this.down('attack') || this.touch.attack ||
      !!(pad && (pad.buttons[7]?.pressed || pad.buttons[5]?.pressed));
    this.use = this.down('use') || this.touch.use ||
      !!(pad && pad.buttons[0]?.pressed);
    this.run = this.down('run') || !!(pad && pad.buttons[10]?.pressed);

    this.weaponSlot = 0;
    if (this.pressed('weapon1')) this.weaponSlot = 1;
    if (this.pressed('weapon2')) this.weaponSlot = 2;
    if (this.pressed('weapon3')) this.weaponSlot = 3;
    if (this.touch.weapon) { this.weaponSlot = this.touch.weapon; this.touch.weapon = 0; }
    this.weaponCycle = this.wheel; this.wheel = 0;
    if (pad) {
      if (pad.buttons[4]?.pressed && !this._padLB) this.weaponCycle = -1;
      this._padLB = pad.buttons[4]?.pressed;
    }

    this.pausePressed = this.pressed('pause');
    this.mapPressed = this.pressed('map');

    this.prev = new Set(this.keys);
  }

  _gamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }
}

const dead = v => (Math.abs(v || 0) < 0.18 ? 0 : v);
