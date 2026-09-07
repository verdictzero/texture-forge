/* =====================================================================
   SELLWRONG — state tables
   =====================================================================

   Doom's monsters are a linked list of states. Each one says which
   sprite frame to show, how many tics to show it for, one function to
   call the moment it starts, and which state to go to next. That is the
   entire animation system and the entire AI scheduler, and it is the
   reason a Doom monster feels like it has WEIGHT: the thing cannot
   change its mind mid-frame, because the frame owns the next several
   tics and there is nowhere for a change of mind to go.

   Read a run of states out loud and you have the animation:

     RUN: A 4, A 4, B 4, B 4, C 4, C 4, D 4, D 4, back to the start

   Each walk frame is held twice — eight states, four drawings — which
   makes the cycle 32 tics, a bit under a second, which is the pace of a
   walk. A_Chase runs on every one of those eight, so the monster gets
   eight chances a cycle to notice you have moved.

   TIMING IS IN TICS, always. 35 to the second, exactly as Doom, and the
   numbers below are Doom's own numbers wherever there was an equivalent
   monster to steal from — which for these two there was.

   THE TWO OF THEM

     ASSOCIATE   the Zombieman. 20 health, painchance 200 (so he flinches
                 at nearly anything), a slow ranged attack, speed 8.
                 Dies in one shell. He is the tutorial.

     STOCKER     the Imp. 60 health, painchance 200, a melee AND a thrown
                 attack, speed 8 but a longer stride so he closes faster.
                 Three of these in one aisle is a real problem.
   ===================================================================== */

/* Every state: [sprite, frame, tics, action, next]. -1 tics means stay
   here forever, which is what a corpse does. */
export const STATES = {};

function S(name, sprite, frame, tics, action, next, opts = {}) {
  STATES[name] = { name, sprite, frame, tics, action, next, ...opts };
}

/* Helper for a run of alternating held frames — the walk cycles below
   are all this shape, and writing them out longhand invites a typo that
   makes one monster limp for reasons nobody can find. */
function walkCycle(prefix, sprite, tics, action, loopTo) {
  const letters = ['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D'];
  letters.forEach((L, i) => {
    const name = `${prefix}${i + 1}`;
    const next = i === letters.length - 1 ? loopTo : `${prefix}${i + 2}`;
    S(name, sprite, L, tics, action, next);
  });
}

/* ---------------------------------------------------------------------
   THE ASSOCIATE
   ------------------------------------------------------------------- */
S('ASSO_STAND',  'ASSO', 'W', 10, 'A_Look', 'ASSO_STAND2');
S('ASSO_STAND2', 'ASSO', 'W', 10, 'A_Look', 'ASSO_STAND');
walkCycle('ASSO_RUN', 'ASSO', 4, 'A_Chase', 'ASSO_RUN1');

/* Aim, fire, recover. The long first state is the tell — you get ten
   tics of seeing him raise the thing before it goes off, which is what
   makes the attack fair. */
S('ASSO_ATK1', 'ASSO', 'E', 10, 'A_FaceTarget', 'ASSO_ATK2');
S('ASSO_ATK2', 'ASSO', 'F',  8, 'A_PosAttack',  'ASSO_ATK3');
S('ASSO_ATK3', 'ASSO', 'E',  8, null,           'ASSO_RUN1');

S('ASSO_PAIN',  'ASSO', 'G', 3, null,     'ASSO_PAIN2');
S('ASSO_PAIN2', 'ASSO', 'G', 3, 'A_Pain', 'ASSO_RUN1');

S('ASSO_DIE1', 'ASSO', 'H', 5, null,       'ASSO_DIE2');
S('ASSO_DIE2', 'ASSO', 'I', 5, 'A_Scream', 'ASSO_DIE3');
S('ASSO_DIE3', 'ASSO', 'J', 5, 'A_Fall',   'ASSO_DIE4');
S('ASSO_DIE4', 'ASSO', 'K', 5, null,       'ASSO_DIE5');
S('ASSO_DIE5', 'ASSO', 'L', -1, null,      null);

S('ASSO_XDIE1', 'ASSO', 'M', 5, 'A_XScream', 'ASSO_XDIE2');
S('ASSO_XDIE2', 'ASSO', 'N', 5, null,        'ASSO_XDIE3');
S('ASSO_XDIE3', 'ASSO', 'O', 5, 'A_Fall',    'ASSO_XDIE4');
S('ASSO_XDIE4', 'ASSO', 'P', 5, null,        'ASSO_XDIE5');
S('ASSO_XDIE5', 'ASSO', 'Q', 5, null,        'ASSO_XDIE6');
S('ASSO_XDIE6', 'ASSO', 'R', 5, null,        'ASSO_XDIE7');
S('ASSO_XDIE7', 'ASSO', 'S', 5, null,        'ASSO_XDIE8');
S('ASSO_XDIE8', 'ASSO', 'T', 5, null,        'ASSO_XDIE9');
S('ASSO_XDIE9', 'ASSO', 'U', -1, null,       null);

/* ---------------------------------------------------------------------
   THE STOCKER

   Three tics a frame instead of four, so the same eight-state cycle
   takes 24 tics rather than 32. He does not move much faster than the
   Associate; he just looks like he means it, which turns out to matter
   more.
   ------------------------------------------------------------------- */
S('STKR_STAND',  'STKR', 'W', 10, 'A_Look', 'STKR_STAND2');
S('STKR_STAND2', 'STKR', 'W', 10, 'A_Look', 'STKR_STAND');
walkCycle('STKR_RUN', 'STKR', 3, 'A_Chase', 'STKR_RUN1');

S('STKR_ATK1', 'STKR', 'E', 8, 'A_FaceTarget', 'STKR_ATK2');
S('STKR_ATK2', 'STKR', 'F', 8, 'A_FaceTarget', 'STKR_ATK3');
S('STKR_ATK3', 'STKR', 'G', 6, 'A_StockAttack', 'STKR_RUN1');

S('STKR_PAIN',  'STKR', 'H', 2, null,     'STKR_PAIN2');
S('STKR_PAIN2', 'STKR', 'H', 2, 'A_Pain', 'STKR_RUN1');

S('STKR_DIE1', 'STKR', 'I', 8, null,       'STKR_DIE2');
S('STKR_DIE2', 'STKR', 'J', 8, 'A_Scream', 'STKR_DIE3');
S('STKR_DIE3', 'STKR', 'K', 6, null,       'STKR_DIE4');
S('STKR_DIE4', 'STKR', 'L', 6, 'A_Fall',   'STKR_DIE5');
S('STKR_DIE5', 'STKR', 'M', -1, null,      null);

S('STKR_XDIE1', 'STKR', 'N', 5, 'A_XScream', 'STKR_XDIE2');
S('STKR_XDIE2', 'STKR', 'O', 5, null,        'STKR_XDIE3');
S('STKR_XDIE3', 'STKR', 'P', 5, 'A_Fall',    'STKR_XDIE4');
S('STKR_XDIE4', 'STKR', 'Q', 5, null,        'STKR_XDIE5');
S('STKR_XDIE5', 'STKR', 'R', 5, null,        'STKR_XDIE6');
S('STKR_XDIE6', 'STKR', 'S', 5, null,        'STKR_XDIE7');
S('STKR_XDIE7', 'STKR', 'T', 5, null,        'STKR_XDIE8');
S('STKR_XDIE8', 'STKR', 'U', 5, null,        'STKR_XDIE9');
S('STKR_XDIE9', 'STKR', 'V', -1, null,       null);

/* ---------------------------------------------------------------------
   Things that are not monsters
   ------------------------------------------------------------------- */
S('CAR_STAND',   'CAR0', 'A', -1, null, null);
S('TRLY_STAND',  'TRLY', 'A', -1, null, null);
S('BOLL_STAND',  'BOLL', 'A', -1, null, null);
S('GCAN_STAND',  'GCAN', 'A', -1, null, null);
S('CRAT_STAND',  'CRAT', 'A', -1, null, null);
S('BLUD_REST',   'BLUD', 'A', -1, null, null);

/* The lights. Lit until something breaks them, then dark for ever — the
   burst itself is three tics of nothing, long enough for A_Burst to
   throw the sparks and for the room to notice it has got darker. */
S('LAMP_LIT',   'LAMP', 'A', -1, null, null, { fullbright: true });
S('LAMP_BURST', 'LAMP', 'B', 3, 'A_LampBurst', 'LAMP_DEAD');
S('LAMP_DEAD',  'LAMP', 'B', -1, null, null);
S('SPARK1', 'SPRK', 'A', 3, null, 'SPARK2');
S('SPARK2', 'SPRK', 'B', 3, null, 'SPARK3');
S('SPARK3', 'SPRK', 'C', 4, null, null);

/* The flame that sits on something burning. Loops for ever; the fire
   system removes it when the fuel runs out. */
['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach((L, i, arr) =>
  S(`FIRE${i + 1}`, 'FIRE', L, 2, null, `FIRE${(i + 1) % arr.length + 1}`, { fullbright: true }));
['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach((L, i, arr) =>
  S(`BLAZ${i + 1}`, 'BLAZ', L, 2, null, `BLAZ${(i + 1) % arr.length + 1}`, { fullbright: true }));
['A', 'B', 'C', 'D', 'E', 'F'].forEach((L, i, arr) =>
  S(`EMBR${i + 1}`, 'EMBR', L, 3, null, `EMBR${(i + 1) % arr.length + 1}`, { fullbright: true }));

/* Blood in the air, which then is not. */
S('PUFF1', 'PUFF', 'A', 4, null, 'PUFF2');
S('PUFF2', 'PUFF', 'B', 4, null, 'PUFF3');
S('PUFF3', 'PUFF', 'C', 4, null, null);      // null next = remove me

/* =====================================================================
   Actor types

   Doom's mobjinfo, minus the fields nothing here uses. Health, speed and
   painchance are the three that decide how a monster feels, and they are
   Doom's numbers because Doom's numbers are correct.
   ===================================================================== */
export const ACTORS = {
  ASSOCIATE: {
    name: 'SellWrong Associate',
    spawn: 'ASSO_STAND', see: 'ASSO_RUN1', pain: 'ASSO_PAIN',
    missile: 'ASSO_ATK1', death: 'ASSO_DIE1', xdeath: 'ASSO_XDIE1',
    health: 20, radius: 20, height: 56, speed: 8, mass: 100,
    painchance: 200, reaction: 8,
    /* Below this much damage in one hit there is no gib — you have to
       really mean it. Doom used the corpse health going past -spawnhealth. */
    gibHealth: -20,
    monster: true, flammable: true, dropItem: null,
    sightRange: 2400, missileRange: 1600,
    seeSound: 'assoSee', painSound: 'assoPain', deathSound: 'assoDie', activeSound: 'assoIdle',
  },
  STOCKER: {
    name: 'Night Stocker',
    spawn: 'STKR_STAND', see: 'STKR_RUN1', pain: 'STKR_PAIN',
    melee: 'STKR_ATK1', missile: 'STKR_ATK1', death: 'STKR_DIE1', xdeath: 'STKR_XDIE1',
    health: 60, radius: 20, height: 56, speed: 8, mass: 100,
    painchance: 200, reaction: 8, gibHealth: -60,
    monster: true, flammable: true,
    sightRange: 2400, missileRange: 2000, meleeRange: 64,
    seeSound: 'stkrSee', painSound: 'stkrPain', deathSound: 'stkrDie', activeSound: 'stkrIdle',
  },

  /* Scenery. Solid, mostly, and most of it burns. */
  CAR:     { name: 'Car',     spawn: 'CAR_STAND',  radius: 46, height: 60, solid: true, health: 100,
             shootable: true, flammable: true, fuel: 220, explodes: true, variants: 5 },
  TROLLEY: { name: 'Trolley', spawn: 'TRLY_STAND', radius: 16, height: 44, solid: true, pushable: true },
  BOLLARD: { name: 'Bollard', spawn: 'BOLL_STAND', radius: 10, height: 42, solid: true },
  FUELCAN: { name: 'Fuel can', spawn: 'GCAN_STAND', radius: 12, height: 38, solid: false,
             shootable: true, health: 1, flammable: true, fuel: 400, explodes: true, pickup: 'fuel' },
  CRATE:   { name: 'Stock',   spawn: 'CRAT_STAND', radius: 20, height: 58, solid: true,
             shootable: true, health: 40, flammable: true, fuel: 300 },

  /* A fitting. Not solid — you walk under it — but shootable, and the
     fire reaches it too: the burn check is two-dimensional, so anything
     alight on the floor below will eventually take out the light above
     it, which is exactly right. It does not itself burn. */
  LAMP:    { name: 'Light', spawn: 'LAMP_LIT', death: 'LAMP_BURST',
             radius: 26, height: 14, health: 10, shootable: true, solid: false,
             flammable: false, hangBelow: 34, fullbright: true },

  FIRE:    { name: 'Fire',    spawn: 'FIRE1', radius: 12, height: 48, noclip: true, fullbright: true },
  BLAZE:   { name: 'Blaze',   spawn: 'BLAZ1', radius: 20, height: 80, noclip: true, fullbright: true },
  EMBER:   { name: 'Ember',   spawn: 'EMBR1', radius: 8,  height: 24, noclip: true, fullbright: true },
  PUFF:    { name: 'Blood',   spawn: 'PUFF1', radius: 4,  height: 8,  noclip: true },
  GORE:    { name: 'Gore',    spawn: 'BLUD_REST', radius: 4, height: 2, noclip: true, flat: true },
};

export function stateOf(name) {
  const s = STATES[name];
  if (!s) console.warn('missing state:', name);
  return s || null;
}
