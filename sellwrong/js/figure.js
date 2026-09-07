/* =====================================================================
   SELLWRONG — the articulated figure
   =====================================================================

   Doom's monsters are eight photographs of a clay model taken from eight
   angles, and every frame of every animation is another eight
   photographs. That is why they turn so convincingly and why nobody has
   ever matched the look by drawing sprites by hand: the rotations agree
   with each other because they are the same object.

   So this does the same thing with a very small stick man. A pose is a
   set of joint angles; the joints are placed in 3D by forward kinematics;
   the result is rotated to eight yaws and flattened to eight 64-pixel
   sprites. The rotations agree because they are the same object.

   That buys three things that hand-drawn placeholders do not:

     a real walk cycle    the legs pass through the poses of an actual
                          gait, so the thing WALKS instead of cycling
                          between four drawings of standing
     free rotations       draw the pose once, get all eight views
     free variants        change four colours and the shelf-stacker is a
                          different monster with the same skeleton

   And when the real art arrives, the state tables and the animation
   timing do not change at all. Only this file goes in the bin, which is
   the whole point of building it this way round.

   THE ROTATION MATHS, once, so it is never guessed at again:

     local +x  the figure's own right
     local +y  up
     local +z  the way it is facing

     phi = -rot * 45 degrees
     screenX = -(x cos phi + z sin phi)
     screenY = -y
     depth   =  -x sin phi + z cos phi      (bigger is nearer the camera)

   At rot 0 the figure faces you and its right hand is on your left,
   which is what looking at somebody is. At rot 4 it faces away. Rots
   5, 6 and 7 are 3, 2 and 1 mirrored — the same trick Doom used to store
   five lumps per frame instead of eight.
   ===================================================================== */

import { Pix } from './pixel.js';

export const ROTATIONS = 8;

/* --------------------------------------------------------------------
   The rig

   Lengths in sprite pixels, which are world units, because one texel is
   one unit everywhere in this game. A person is 56 tall, which is what
   Doom's player is, and that is not a coincidence — a doorway that fits
   the player has to fit the zombie coming through it.
   ------------------------------------------------------------------ */
export const RIG = {
  hipY: 24, hipX: 4,
  shoulderY: 40, shoulderX: 7,
  neckY: 43, headY: 49, headR: 5.2,
  thigh: 12, shin: 12,
  upperArm: 10, foreArm: 10,
  torsoW: 8, torsoR: 5.5,
  limbR: 2.6, armR: 2.2,
};

/* One joint chain.
   `a`    swings forward and back in the figure's own sagittal plane,
          which is where a limb does nearly all of its work
   `side` splays the whole limb outward, away from the body

   The splay is not decoration. A limb that only swings along Z vanishes
   when the figure is walking straight at you: the swing is entirely
   toward the camera, so it projects to nothing and four different walk
   frames come out as four drawings of somebody standing still. A few
   degrees of splay that changes across the cycle puts the movement back
   into the axis the camera can actually see. Doom's artists did the same
   thing by hand and for the same reason — its front-view walk frames are
   more bow-legged than its side views are. */
function chain(ox, oy, oz, len1, a1, side1, len2, a2) {
  const c1 = Math.cos(a1), s1 = Math.sin(a1);
  const cs = Math.cos(side1), ss = Math.sin(side1);
  const k = [ox + c1 * ss * len1, oy - c1 * cs * len1, oz + s1 * len1];
  const t = a1 + a2, ct = Math.cos(t), st = Math.sin(t);
  const e = [k[0] + ct * ss * len2, k[1] - ct * cs * len2, k[2] + st * len2];
  return [k, e];
}

/**
 * Build joint positions in figure-local space from a pose.
 *
 * A pose is angles, not positions, so two poses can be blended and a
 * pose can be mirrored by swapping left for right — neither of which
 * works if you author the positions directly.
 */
export function skeleton(pose, rig = RIG) {
  const p = pose;
  const bob = p.bob || 0;
  const lean = p.lean || 0;                 // forward tip of the whole body
  const sway = p.sway || 0;                 // side-to-side roll

  const hipY = rig.hipY + bob;
  const leanZ = z => z;
  /* The spine tips forward about the hips, so the shoulders travel
     further than the pelvis does — which is what a hunch IS. */
  const spineLen = rig.shoulderY - rig.hipY;
  const chestX = Math.sin(sway) * spineLen;
  const chestY = hipY + Math.cos(lean) * spineLen;
  const chestZ = Math.sin(lean) * spineLen;

  const neck = [chestX * 0.9, hipY + Math.cos(lean) * (rig.neckY - rig.hipY), Math.sin(lean) * (rig.neckY - rig.hipY)];
  const headTilt = p.headTilt || 0;
  const headSide = p.headSide || 0;
  const head = [
    neck[0] + Math.sin(headSide) * (rig.headY - rig.neckY),
    neck[1] + Math.cos(headTilt) * (rig.headY - rig.neckY),
    neck[2] + Math.sin(headTilt) * (rig.headY - rig.neckY),
  ];

  const [lKnee, lFoot] = chain(-rig.hipX, hipY, 0, rig.thigh, p.lHip || 0, -(p.lHipSide || 0), rig.shin, p.lKnee || 0);
  const [rKnee, rFoot] = chain( rig.hipX, hipY, 0, rig.thigh, p.rHip || 0,  (p.rHipSide || 0), rig.shin, p.rKnee || 0);

  const lSh = [chestX - rig.shoulderX, chestY, chestZ];
  const rSh = [chestX + rig.shoulderX, chestY, chestZ];
  const [lElb, lHand] = chain(lSh[0], lSh[1], lSh[2], rig.upperArm, p.lSh || 0, -(p.lShSide || 0), rig.foreArm, p.lElb || 0);
  const [rElb, rHand] = chain(rSh[0], rSh[1], rSh[2], rig.upperArm, p.rSh || 0,  (p.rShSide || 0), rig.foreArm, p.rElb || 0);

  return {
    hip: [chestX * 0.2, hipY, chestZ * 0.2],
    chest: [chestX, chestY, chestZ],
    neck, head,
    lHip: [-rig.hipX, hipY, 0], rHip: [rig.hipX, hipY, 0],
    lKnee, lFoot, rKnee, rFoot,
    lSh, rSh, lElb, lHand, rElb, rHand,
  };
}

/* --------------------------------------------------------------------
   Drawing

   Every limb is a tapered capsule lit from the top left, which for a
   figure eleven pixels across is the entire lighting model. The interior
   shading comes from how far a pixel sits from the bone's axis and which
   way — up and to the left is lit, down and to the right is not.
   ------------------------------------------------------------------ */
function capsule(pix, x0, y0, r0, x1, y1, r1, key, t, roundness = 0.30) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.max(1, Math.hypot(dx, dy));
  const steps = Math.ceil(len * 2);
  /* the axis, and the normal to it, for working out which side of the
     limb a pixel is on */
  const ax = dx / len, ay = dy / len;
  const nx = -ay, ny = ax;

  for (let s = 0; s <= steps; s++) {
    const f = s / steps;
    const cx = x0 + dx * f, cy = y0 + dy * f;
    const r = r0 + (r1 - r0) * f;
    const ri = Math.ceil(r);
    for (let py = -ri; py <= ri; py++) {
      for (let px = -ri; px <= ri; px++) {
        const d = Math.hypot(px, py);
        if (d > r) continue;
        /* how far across the limb, -1 on one edge to +1 on the other */
        const across = (px * nx + py * ny) / Math.max(0.5, r);
        /* the top-left rule: this is the only light in the game */
        const lit = (-across * (nx - ny) * 0.5) + (d / Math.max(0.5, r)) * -0.10;
        pix.ink(Math.round(cx + px), Math.round(cy + py), key, clamp01(t + lit * roundness));
      }
    }
  }
}

const clamp01 = v => v < 0.02 ? 0.02 : v > 0.98 ? 0.98 : v;

function ball(pix, x, y, r, key, t, roundness = 0.34) {
  const ri = Math.ceil(r);
  for (let py = -ri; py <= ri; py++)
    for (let px = -ri; px <= ri; px++) {
      const d = Math.hypot(px, py);
      if (d > r) continue;
      const lit = (-px - py) / (r * 2) - (d / r) * 0.18;
      pix.ink(Math.round(x + px), Math.round(y + py), key, clamp01(t + lit * roundness));
    }
}

/* --------------------------------------------------------------------
   One view

   Bones are collected with a depth, sorted, and drawn far to near. That
   is the whole of the hidden surface removal, and at this size it is
   enough: an arm behind the body is drawn first and the body covers it.
   ------------------------------------------------------------------ */
export function renderFigure(pose, rot, skin, opts = {}) {
  const W = opts.width || 64, H = opts.height || 64;
  const pix = new Pix(W, H, opts.seed || 1, false);   // a sprite must not wrap
  const rig = opts.rig || RIG;
  const sk = skeleton(pose, rig);

  const phi = -rot * (Math.PI / 4);
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const cx = W / 2, baseY = H - 1 - (opts.footRoom || 1);

  /* local -> screen, plus the depth we sort on */
  const P = j => {
    const [x, y, z] = j;
    return [
      cx + (-(x * cos + z * sin)) * (opts.scaleX || 1),
      baseY - y * (opts.scaleY || 1),
      -x * sin + z * cos,
    ];
  };

  const parts = [];
  const bone = (a, b, ra, rb, key, t, round) => {
    const A = P(a), B = P(b);
    parts.push({ z: (A[2] + B[2]) * 0.5, draw: () => capsule(pix, A[0], A[1], ra, B[0], B[1], rb, key, t, round) });
  };
  const blob = (a, r, key, t, round) => {
    const A = P(a);
    parts.push({ z: A[2], draw: () => ball(pix, A[0], A[1], r, key, t, round) });
  };

  /* legs */
  bone(sk.lHip, sk.lKnee, rig.limbR + 0.5, rig.limbR, skin.legs, skin.legsT);
  bone(sk.lKnee, sk.lFoot, rig.limbR, rig.limbR - 0.5, skin.legs, skin.legsT);
  bone(sk.rHip, sk.rKnee, rig.limbR + 0.5, rig.limbR, skin.legs, skin.legsT);
  bone(sk.rKnee, sk.rFoot, rig.limbR, rig.limbR - 0.5, skin.legs, skin.legsT);
  /* shoes, so the feet are not just the ends of the trousers */
  blob(sk.lFoot, rig.limbR - 0.3, skin.shoes, skin.shoesT);
  blob(sk.rFoot, rig.limbR - 0.3, skin.shoes, skin.shoesT);

  /* torso: hips to chest, fat, in whatever the thing is wearing */
  bone(sk.hip, sk.chest, rig.torsoR - 1, rig.torsoR, skin.body, skin.bodyT, 0.34);

  /* arms */
  bone(sk.lSh, sk.lElb, rig.armR + 0.4, rig.armR, skin.sleeve, skin.sleeveT);
  bone(sk.lElb, sk.lHand, rig.armR, rig.armR - 0.4, skin.skin, skin.skinT);
  bone(sk.rSh, sk.rElb, rig.armR + 0.4, rig.armR, skin.sleeve, skin.sleeveT);
  bone(sk.rElb, sk.rHand, rig.armR, rig.armR - 0.4, skin.skin, skin.skinT);
  blob(sk.lHand, rig.armR - 0.2, skin.skin, skin.skinT);
  blob(sk.rHand, rig.armR - 0.2, skin.skin, skin.skinT);

  /* neck and head */
  bone(sk.neck, sk.head, 2.2, 2.6, skin.skin, skin.skinT);
  blob(sk.head, rig.headR, skin.skin, skin.skinT, 0.40);

  parts.sort((a, b) => a.z - b.z);
  for (const p of parts) p.draw();

  /* --- the bits that are drawn ON the finished figure, front only --- */
  const H2 = P(sk.head);
  const facingUs = Math.cos(phi) > 0.2;         // rot 0, 1 and 7
  const profile  = Math.abs(Math.cos(phi)) <= 0.2;

  if (skin.decorate) skin.decorate(pix, { P, sk, rot, phi, facingUs, profile, H2, skin });

  /* Eyes. Only when there is a face pointed anywhere near us, and always
     the brightest thing on the sprite — in a dark aisle the eyes are how
     you find out something is there. */
  if (facingUs || profile) {
    const ex = H2[0], ey = H2[1] - 1;
    const spread = facingUs ? 2 : 1;
    const off = profile ? (Math.sin(phi) > 0 ? 2 : -2) : 0;
    pix.ink(Math.round(ex - spread + off), Math.round(ey), skin.eye, skin.eyeT);
    if (facingUs) pix.ink(Math.round(ex + spread + off), Math.round(ey), skin.eye, skin.eyeT);
  }

  return pix;
}

/* --------------------------------------------------------------------
   Poses

   A walk is four keys and everybody's is the same shape:

     CONTACT  one heel down in front, the other toe down behind, the
              body at its lowest
     PASS     the back leg swings through under the body, knee bent, the
              body at its highest — this is the frame that sells it
     CONTACT  the mirror of the first
     PASS     the mirror of the second

   Doom held each of its four walk frames for four tics, and so does the
   state table that drives these. Arms swing opposite the legs, because
   that is what stops a person falling over and what makes a drawing of
   one look alive.
   ------------------------------------------------------------------ */
const D = Math.PI / 180;

/** Mirror a pose left-for-right. Two of the four walk keys are free. */
export function mirrorPose(p) {
  return {
    ...p,
    lHip: p.rHip, rHip: p.lHip,
    lKnee: p.rKnee, rKnee: p.lKnee,
    lHipSide: p.rHipSide, rHipSide: p.lHipSide,
    lSh: p.rSh, rSh: p.lSh,
    lElb: p.rElb, rElb: p.lElb,
    lShSide: p.rShSide, rShSide: p.lShSide,
    sway: -(p.sway || 0),
    headSide: -(p.headSide || 0),
  };
}

/**
 * The walk, parameterised so one function gives both monsters their gait.
 *
 *   stride   how far the legs swing — a shuffle or a stride
 *   lean     how far forward the body is tipped
 *   armSwing how much the arms answer the legs; near zero for something
 *            walking with its arms already out in front of it
 *   drag     holds one leg back and bends its knee less, so the thing
 *            limps instead of marching. This is what makes it read as a
 *            zombie rather than as a man out for a walk.
 */
export function walkKeys(o = {}) {
  const stride = (o.stride ?? 26) * D;
  const lean = (o.lean ?? 10) * D;
  const arm = (o.armSwing ?? 18) * D;
  const drag = (o.drag ?? 0);
  const base = { lean, headTilt: (o.headTilt ?? 8) * D, headSide: (o.headSide ?? 0) * D };

  /* How far the limbs splay outward, and how much that changes across
     the cycle. This is the front view's entire supply of movement. */
  const splay = (o.splay ?? 9) * D;
  const armSplay = (o.armSplay ?? 14) * D;

  /* contact: feet apart, arms out from the body */
  const contact = {
    ...base,
    lHip: stride, lKnee: 6 * D, lHipSide: splay,
    rHip: -stride * (1 - drag * 0.5), rKnee: (18 + drag * 26) * D, rHipSide: splay * 0.7,
    lSh: -arm + (o.armBase ?? 0) * D, lElb: (o.elbowBase ?? 22) * D, lShSide: armSplay,
    rSh: arm + (o.armBase ?? 0) * D, rElb: (o.elbowBase ?? 22) * D, rShSide: armSplay * 0.5,
    bob: -1, sway: 3 * D,
  };
  /* pass: the swinging leg comes in under the body and the stance leg
     takes the weight, so the feet are at their closest and the body at
     its highest */
  const pass = {
    ...base,
    lHip: stride * 0.15, lKnee: 4 * D, lHipSide: splay * 0.15,
    rHip: stride * 0.35, rKnee: (52 + drag * 20) * D, rHipSide: splay * 1.5,
    lSh: (o.armBase ?? 0) * D, lElb: (o.elbowBase ?? 22) * D, lShSide: armSplay * 0.4,
    rSh: (o.armBase ?? 0) * D, rElb: (o.elbowBase ?? 22) * D, rShSide: armSplay * 1.3,
    bob: 1, sway: 0,
  };
  return [contact, pass, mirrorPose(contact), mirrorPose(pass)];
}

/** Standing about, waiting for someone to walk into the aisle. */
export function standPose(o = {}) {
  return {
    lean: (o.lean ?? 6) * D, headTilt: (o.headTilt ?? 6) * D, headSide: (o.headSide ?? -6) * D,
    lHip: 3 * D, lKnee: 5 * D, rHip: -3 * D, rKnee: 8 * D,
    lSh: (o.armBase ?? 4) * D, lElb: (o.elbowBase ?? 24) * D,
    rSh: (o.armBase ?? -2) * D, rElb: (o.elbowBase ?? 20) * D,
    bob: 0, sway: 1 * D,
  };
}

/**
 * Winding up, and then the release.
 *
 * Three poses, not two. Doom's Zombieman raises and fires — two frames.
 * Its Imp draws back, draws back FURTHER, and throws — three, and the
 * middle one is the tell that gives you time to move. A caller that only
 * wants two takes the first and the last.
 */
export function attackPoses(o = {}) {
  const wind = {
    lean: (o.lean ?? 4) * D, headTilt: 2 * D,
    lHip: 10 * D, lKnee: 12 * D, rHip: -12 * D, rKnee: 20 * D,
    lSh: (o.windSh ?? -40) * D, lElb: (o.windElb ?? 80) * D, lShSide: (o.windSpread ?? 30) * D,
    rSh: (o.windSh ?? -40) * D, rElb: (o.windElb ?? 80) * D, rShSide: (o.windSpread ?? 30) * D,
    bob: -1, sway: 0,
  };
  const release = {
    lean: (o.releaseLean ?? 16) * D, headTilt: 10 * D,
    lHip: 16 * D, lKnee: 8 * D, rHip: -16 * D, rKnee: 14 * D,
    lSh: (o.relSh ?? 82) * D, lElb: (o.relElb ?? 8) * D, lShSide: (o.relSpread ?? 22) * D,
    rSh: (o.relSh ?? 82) * D, rElb: (o.relElb ?? 8) * D, rShSide: (o.relSpread ?? 22) * D,
    bob: 0, sway: 0,
  };
  /* the extra beat: further back, weight shifted, about to happen */
  const cock = {
    lean: (o.lean ?? 4) * D - 10 * D, headTilt: 0,
    lHip: 14 * D, lKnee: 10 * D, rHip: -16 * D, rKnee: 24 * D,
    lSh: ((o.windSh ?? -40) - 28) * D, lElb: ((o.windElb ?? 80) + 18) * D, lShSide: ((o.windSpread ?? 30) + 10) * D,
    rSh: ((o.windSh ?? -40) - 28) * D, rElb: ((o.windElb ?? 80) + 18) * D, rShSide: ((o.windSpread ?? 30) + 10) * D,
    bob: -2, sway: -4 * D,
  };
  return [wind, cock, release];
}

/** Hit, and recoiling from it. */
export function painPose(o = {}) {
  return {
    lean: -(o.lean ?? 14) * D, headTilt: -18 * D, headSide: 12 * D,
    lHip: -10 * D, lKnee: 26 * D, rHip: 14 * D, rKnee: 10 * D,
    lSh: -46 * D, lElb: 54 * D, lShSide: 34 * D,
    rSh: -34 * D, rElb: 66 * D, rShSide: 26 * D,
    bob: -2, sway: -8 * D,
  };
}

/**
 * Going down.
 *
 * Five poses, and the fifth is the one that stays on the floor for the
 * rest of the level, so it is the one worth getting right: nothing
 * standing, everything flat, and the body foreshortened almost to
 * nothing because you are looking down the length of it.
 */
export function deathPoses() {
  return [
    /* the stagger */
    { lean: 26 * D, headTilt: -20 * D, lHip: -18 * D, lKnee: 30 * D, rHip: 12 * D, rKnee: 16 * D,
      lSh: -70 * D, lElb: 40 * D, rSh: -60 * D, rElb: 30 * D, bob: -1 },
    /* knees going */
    { lean: 44 * D, headTilt: -10 * D, lHip: -40 * D, lKnee: 74 * D, rHip: -20 * D, rKnee: 60 * D,
      lSh: -30 * D, lElb: 20 * D, rSh: -20 * D, rElb: 16 * D, bob: -8 },
    /* down on them */
    { lean: 66 * D, headTilt: 10 * D, lHip: -66 * D, lKnee: 96 * D, rHip: -50 * D, rKnee: 88 * D,
      lSh: 30 * D, lElb: 10 * D, rSh: 20 * D, rElb: 8 * D, bob: -14 },
    /* pitching forward */
    { lean: 80 * D, headTilt: 24 * D, lHip: -80 * D, lKnee: 100 * D, rHip: -74 * D, rKnee: 96 * D,
      lSh: 70 * D, lElb: 4 * D, rSh: 62 * D, rElb: 4 * D, bob: -19 },
    /* and there it stays */
    { lean: 88 * D, headTilt: 30 * D, lHip: -88 * D, lKnee: 92 * D, rHip: -84 * D, rKnee: 90 * D,
      lSh: 84 * D, lElb: 2 * D, rSh: 80 * D, rElb: 2 * D, bob: -22 },
  ];
}

/**
 * Every rotation of one pose, with 5, 6 and 7 mirrored off 3, 2 and 1
 * exactly as Doom stored them.
 *
 * `only` collapses the frame to a single view used from every angle —
 * Doom's rotation 0, which is what all of its death frames are. That is
 * not laziness on Doom's part and it is not laziness here: a body
 * pitching forward is moving almost entirely along its own facing axis,
 * so the head-on view of it is a figure that appears to shrink rather
 * than to fall. One good three-quarter view, shown from everywhere,
 * reads as dying from every angle. The head-on one never does.
 */
export function renderAllRotations(pose, skin, opts = {}) {
  const out = [];
  if (opts.only !== undefined) {
    const one = renderFigure(pose, opts.only, skin, opts).snap(0.3);
    for (let r = 0; r < ROTATIONS; r++) out[r] = one;
    return out;
  }
  for (let r = 0; r <= 4; r++) out[r] = renderFigure(pose, r, skin, opts);
  out[5] = out[3].mirrored();
  out[6] = out[2].mirrored();
  out[7] = out[1].mirrored();
  for (const p of out) p.snap(0.3);
  return out;
}
