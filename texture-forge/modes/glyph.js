/* =====================================================================
   MODE: glyph — a constructed writing system, keyed to English
   =====================================================================

   This mode invents an ALPHABET and then sets English in it. Every glyph
   stands for one Latin character, so the same seed gives you a script you
   can actually write in, a key sheet that says which glyph is which, and
   a font atlas an engine can look characters up in.

   WHY IT IS BUILT AS A SCRIPT AND NOT AS SQUIGGLES. A random path per
   letter looks like noise and reads as noise, because what makes writing
   look like writing is not the shapes — it is that the shapes are all
   obviously made by the same hand, out of the same few moves, by somebody
   who had reasons. Five of those reasons are modelled here, and between
   them they do nearly all of the work:

     one construction   Every glyph in a script is built on the same
                        skeleton: a stave with twigs, a walk on a lattice,
                        a headline bar with pendants, spokes and arcs off
                        a centre, wedges pressed at four angles. Pick the
                        construction and the alphabet hangs together
                        whatever the seed does inside it.
     one hand           Stroke weight, pen angle and contrast, slant,
                        how much anything curves, what happens at a free
                        end. Fixed per script, applied to every glyph, so
                        the whole set looks WRITTEN rather than drawn.
     frequency          Common letters are simple and rare letters are
                        complicated, in every script that evolved rather
                        than being designed in an afternoon. E gets two
                        strokes and Q gets five.
     families           A real alphabet has relatives. P and B are one
                        shape apart, so are T and D, F and V, S and Z —
                        and the letter you write most often is the one
                        with nothing added to it. Here the twenty-six
                        letters are nine such pairs, a run of five vowels
                        and three leftovers, and the members of a family
                        share a skeleton and differ by a mark.
     a numeral rule     Digits are never arbitrary. They are tallies, or
                        two registers of five, or dots in a binary field,
                        or ticks around a ring — a RULE, which the readme
                        states, so the numbers in an inscription are
                        countable rather than decorative.

   ALIEN, OR A REFORM OF OURS. Those are two different fictions and the
   mode does both. An INVENTED script owes Latin nothing. A REFORMED one
   starts from the single-stroke Latin skeleton in modes/lib/stroke.js and
   drifts: strokes are dropped, vertices are snapped onto the script's own
   lattice, the hand is applied. At a little drift it is a stylised Latin
   somebody could still read; at a lot it is unrecognisable but was not
   always. That is the difference between an alien inscription and a
   future human one, and it is one control.

   NO TWO GLYPHS MAY BE THE SAME GLYPH, and that is a claim rather than a
   hope: every candidate is rasterised into a small grid and compared
   against every glyph already accepted — including its mirror and its
   half-turn, because a script that tolerates b/d confusion is a script
   you have to read twice. A collision is re-rolled, and a glyph that
   cannot be made distinct gets a mark that makes it so. The readout
   quotes the closest pair in the set.

   FOUR PIECES, one generator:

     chart   the key sheet: every glyph with its Latin equivalent under
             it, the family table, the numeral rule, and the inscription
             set once in each alphabet. This is the Rosetta stone, and
             without it nothing else in the mode means anything.
     atlas   a power-of-two font atlas, sixteen cells by sixteen, the
             glyph for code point c in cell (c mod 16, c div 16), ink
             white, alpha the coverage. Drop it in an engine with the
             advance widths out of glyphs.json and you can type in it.
     plate   an inscription on something: cut into stone, etched into
             steel, cast, inlaid, printed, or lit from behind.
     field   a seamless wall of writing, for covering something large in
             a language nobody has to be able to read.

   IT DRAWS ITS OWN LETTERS, both alphabets — the invented one by
   construction and the Latin captions from the stroke library — so the
   whole mode runs on a worker thread. A mode that reached for a
   registered typeface could not.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      fbm=Forge.fbm,fbm2=Forge.fbm2,vnoise2=Forge.vnoise2,hex2rgb=Forge.hex2rgb,
      blurClamp=Forge.blurClamp,blurWrap=Forge.blurWrap,mulberry32=Forge.mulberry32;

const num=(v,d)=>{const n=+v;return isFinite(n)?n:d;};
const str=(v,d)=>(v===undefined||v===null||v==="")?d:String(v);
const bool=(v,d)=>(v===undefined||v===null)?d:!!v;
const TAU=Math.PI*2,DEG=Math.PI/180;

/* A stable integer hash of a string, so every part of the generator can
   have its own random stream off the one seed without the streams being
   correlated — the glyph for A must not move because the glyph for B was
   re-rolled. FNV-1a, which is four lines and good enough for this. */
function hstr(s,seed){
  let h=(2166136261^(seed|0))>>>0;
  s=String(s);
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  return h>>>0;
}
const rngFor=(seed,tag)=>mulberry32(hstr(tag,seed));
const pick=(rng,arr)=>arr[Math.min(arr.length-1,Math.floor(rng()*arr.length))];
/* Fisher-Yates on a copy. Used for choosing WHICH lattice heights a stave's
   twigs sit at, where drawing with replacement would put two twigs on top of
   each other and lose a stroke the complexity budget already paid for. */
function shuffled(rng,arr){
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));const t=a[i];a[i]=a[j];a[j]=t;}
  return a;
}

/* ============================ the inventory ============================

   ORDER IS FREQUENCY, most common first, from the letter counts everybody
   quotes (ETAOIN SHRDLU and then the tail). Two things read it: how many
   strokes a letter is allowed, and which member of a family gets the
   unmarked form. Both of those are the same principle — what you write
   most, you write with the least — and it is the single cheapest thing
   that makes an invented alphabet look evolved rather than enumerated. */
const FREQ="ETAOINSHRDLCUMWFGYPBVKJXQZ";
const RANK={};
for(let i=0;i<FREQ.length;i++)RANK[FREQ[i]]=i;

/* THE FAMILIES ARE PHONOLOGICAL, because that is what makes a relative a
   relative: P and B are the same gesture voiced or not, and every writing
   system that was ever reformed on purpose ends up writing them a mark
   apart. Nine such pairs, the five vowels as one run, and H Q X — which
   are a family only in the sense that English spelling left them over.

   Within a family the characters are listed MOST FREQUENT FIRST, and the
   first one gets the bare skeleton.

   THE ORDER OF THE LIST IS THE ORDER THEY SHARE IN, as the families control
   is turned up, and it is deliberately the voicing PAIRS first. A pair costs
   one marked form and buys the clearest relationship in the language, so it
   is the cheapest sharing there is. The five-vowel run is the other extreme:
   one skeleton carrying four different marks means five letters that are the
   same letter at a glance, which is a real abugida and is a lot to ask of a
   reader — so it shares only at the very top of the control, where somebody
   has asked for exactly that. */
const FAMILIES=[
  {key:"stopP", label:"labial stops",       chars:"PB"},
  {key:"stopT", label:"alveolar stops",     chars:"TD"},
  {key:"stopK", label:"velar stops",        chars:"KG"},
  {key:"fricS", label:"sibilants",          chars:"SZ"},
  {key:"nasal", label:"nasals",             chars:"NM"},
  {key:"liquid",label:"liquids",            chars:"RL"},
  {key:"fricF", label:"labial fricatives",  chars:"FV"},
  {key:"fricC", label:"affricates",         chars:"CJ"},
  {key:"glide", label:"glides",             chars:"WY"},
  {key:"other", label:"H, Q and X",         chars:"HQX"},
  {key:"vowel", label:"vowels",             chars:"EAOIU"}
];
const LETTERS="ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS="0123456789";
const PUNCT=".,:;!?-'()/";
/* which family each letter is in, and where in it */
const FAMOF={};
for(const F of FAMILIES)
  for(let i=0;i<F.chars.length;i++)FAMOF[F.chars[i]]={fam:F.key,i:i,of:F.chars.length};

/* ============================ the scripts ============================

   One row per writing system. `build` names the CONSTRUCTION — the shape
   of the skeleton every glyph in that script is made of — and the rest is
   the HAND: how the skeleton gets drawn. The seed decides what each letter
   does inside the construction; the row decides what the whole set looks
   like, which is why changing the seed gives you another alphabet in the
   same script rather than a different script.

   Lengths are in CAP HEIGHTS. A glyph box runs y = 0 at the cap line to
   y = 1 at the baseline, and marks live in the ascender and descender
   zones either side of that, so one number sets the scale of everything
   and an inscription has a real vertical rhythm.

     aw     nominal advance, cap heights. Narrow scripts look compressed
            and carved; wide ones look relaxed and cursive.
     wt     stroke weight. 0.06 is a scribe's pen, 0.20 is a chisel.
     con    pen CONTRAST: 0 is a monoline, 1 is a broad nib where a stroke
            across the pen is fat and one along it is hairline. This is
            the single thing that most makes a script look written by a
            hand holding a tool at an angle, which is what `pen` is.
     curve  how much a straight skeleton bows. 0 is carved, 1 is drawn.
     term   what happens at a FREE end — one not shared with another
            stroke. Decorating every endpoint instead is what makes an
            invented alphabet look like decorated line soup.
     join   none, `base` (letters run into each other along the baseline,
            as a cursive does), or `head` (a bar runs across the whole
            word above them, as Devanagari's shirorekha does).
     num    the numeral rule. See numeralOf().
     sep    what goes between words: a gap, an interpunct, or a rule.
            Monumental Latin used the interpunct and no gap at all.
     mono   every glyph on one advance, as a machine script is. */
const SCRIPTS={
  rune   :{label:"Carved runic — stave and twigs",build:"stave", aw:0.52,wt:0.115,con:0.00,pen:0,
           slant:0, curve:0.00,term:"butt", joint:"miter",join:"none",num:"tally",  sep:"dot", dir:"ltr",mono:false,
           note:"A stave with twigs off it, because that is what you can cut across the grain of wood or in stone with two strokes."},
  lapid  :{label:"Angular lapidary",             build:"trail", aw:0.62,wt:0.105,con:0.25,pen:25,
           slant:0, curve:0.08,term:"serif",joint:"miter",join:"none",num:"quinary",sep:"dot", dir:"ltr",mono:false,
           note:"A walk on a lattice, seriffed at the free ends — an inscription cut with a flat chisel."},
  broad  :{label:"Broad-nib formal hand",        build:"trail", aw:0.66,wt:0.155,con:0.80,pen:30,
           slant:6, curve:0.45,term:"flag", joint:"round",join:"none",num:"quinary",sep:"gap", dir:"ltr",mono:false,
           note:"The same lattice, written rather than cut: a broad nib held at thirty degrees, so a stroke across it is fat and one along it is a hairline."},
  flow   :{label:"Cursive, joined at the line",  build:"lobe",  aw:0.58,wt:0.105,con:0.55,pen:35,
           slant:11,curve:0.90,term:"round",joint:"round",join:"base",num:"quinary",sep:"gap", dir:"ltr",mono:false,
           note:"Lobes above and below a baseline, entered and left at the line, so the letters of a word run into one another without lifting the pen."},
  veda   :{label:"Headline bar script",          build:"bar",   aw:0.60,wt:0.120,con:0.35,pen:0,
           slant:0, curve:0.35,term:"butt", joint:"round",join:"head",num:"quinary",sep:"gap", dir:"ltr",mono:false,
           note:"Pendants hanging from a headline, and the headline runs unbroken across a whole word — so a word is one object and a space is a real gap in the bar."},
  xeno   :{label:"Radial xenoglyph",             build:"radial",aw:0.80,wt:0.095,con:0.00,pen:0,
           slant:0, curve:1.00,term:"round",joint:"round",join:"none",num:"ring",   sep:"rule",dir:"rtl",mono:true,
           note:"Spokes and arcs about a centre at a fixed number of stations. Nothing here is on a human axis, which is the point."},
  seal   :{label:"Sealed block",                 build:"box",   aw:0.86,wt:0.105,con:0.15,pen:0,
           slant:0, curve:0.10,term:"butt", joint:"miter",join:"none",num:"tally",  sep:"gap", dir:"ttb",mono:true,
           note:"Every sign in its own frame with the marks inside it, set in columns. A seal script: the box is the glyph as much as the strokes are."},
  wedge  :{label:"Impressed wedge",              build:"wedge", aw:0.70,wt:0.130,con:0.00,pen:0,
           slant:0, curve:0.00,term:"butt", joint:"miter",join:"none",num:"tally",  sep:"gap", dir:"ltr",mono:false,
           note:"Clusters of wedges pressed at four angles. Deep at the head and feathering to the tail, because that is what a stylus leaves in wet clay."},
  circuit:{label:"Circuit gothic",               build:"ortho", aw:0.60,wt:0.090,con:0.00,pen:0,
           slant:0, curve:0.00,term:"dot",  joint:"miter",join:"none",num:"binary", sep:"rule",dir:"ltr",mono:true,
           note:"Right angles and terminal pads, drawn the way a layout tool draws a net. A script for people who learned to write from a schematic."},
  matrix :{label:"Machine dot matrix",           build:"dots",  aw:0.58,wt:0.145,con:0.00,pen:0,
           slant:0, curve:0.00,term:"butt", joint:"round",join:"none",num:"binary", sep:"gap", dir:"ltr",mono:true,
           note:"A five by three field of dots, on or off. The least a machine can print and still be read, and the only construction here with no strokes in it at all."}
};
const SCRIPT_KEYS=Object.keys(SCRIPTS);
const scriptOf=P=>SCRIPTS[str(P.script,"rune")]||SCRIPTS.rune;

/* ============================ substrates ============================
   What the writing is ON. `core` is what a tool finds when it cuts through
   the face, which is the whole difference between carving granite (the cut
   is the same stone, lighter because it is fresh) and carving an anodised
   plate (the cut is bare metal under a coloured oxide).

   `grain` picks how the surface reads close up: `speck` is the crystal of
   an igneous stone, `bed` the sedimentary layering of a soft one, `roll`
   the directional finish of mill-rolled metal, `tooth` the fibre of a
   sheet, `smooth` a glaze or a moulding. `patina` is how readily it
   corrodes into the recesses, which is why bronze looks like bronze. */
const MATS={
  granite:{name:"carved granite",            sub:"#555a5e",core:"#7d8286",met:0.03,rough:0.72,gloss:0.22,
           thick:30, grain:"speck",patina:0.10,emit:false},
  sand   :{name:"sandstone",                 sub:"#b09871",core:"#c6b091",met:0.02,rough:0.84,gloss:0.10,
           thick:40, grain:"bed",  patina:0.25,emit:false},
  conc   :{name:"cast concrete",             sub:"#9d9c97",core:"#aaa9a3",met:0.02,rough:0.80,gloss:0.12,
           thick:50, grain:"speck",patina:0.30,emit:false},
  steel  :{name:"brushed stainless",         sub:"#aeb3b7",core:"#c3c8cc",met:0.90,rough:0.32,gloss:0.60,
           thick:3,  grain:"roll", patina:0.05,emit:false},
  bronze :{name:"patinated bronze",          sub:"#8a6a3c",core:"#c9a05a",met:0.88,rough:0.42,gloss:0.44,
           thick:6,  grain:"roll", patina:1.00,emit:false},
  alu    :{name:"anodised aluminium",        sub:"#2b2e31",core:"#c8ccce",met:0.80,rough:0.38,gloss:0.52,
           thick:2,  grain:"roll", patina:0.08,emit:false},
  ceramic:{name:"glazed ceramic",            sub:"#e4e0d4",core:"#c0a98c",met:0.02,rough:0.14,gloss:0.94,
           thick:8,  grain:"smooth",patina:0.12,emit:false},
  polymer:{name:"moulded polymer",           sub:"#3a3d42",core:"#5a5e64",met:0.02,rough:0.44,gloss:0.48,
           thick:3,  grain:"smooth",patina:0.04,emit:false},
  vellum :{name:"printed sheet",             sub:"#e9e2cf",core:"#e9e2cf",met:0.00,rough:0.86,gloss:0.08,
           thick:0.3,grain:"tooth",patina:0.14,emit:false},
  panel  :{name:"lit panel, dark glass",     sub:"#14171c",core:"#14171c",met:0.04,rough:0.10,gloss:0.96,
           thick:6,  grain:"smooth",patina:0.00,emit:true}
};
const MAT_KEYS=Object.keys(MATS);
const matOf=P=>MATS[str(P.material,"granite")]||MATS.granite;

/* ============================ processes ============================
   How the writing got onto the substrate. Relief and colour at once, and
   not independently: a letter cut into stone is darker because it is in
   shadow and because dirt collects in it, and a letter cast proud is
   lighter for the same two reasons inverted.

     depth     millimetres, signed. Negative is into the face.
     ink       what COLOUR the mark comes out: `core` is what the tool found
               under the face, `face` is the face itself, `own` is a third
               material the process brought with it.
     ground    and what colour everything AROUND the mark is. This is the
               field that needs two entries rather than one, and relief
               carving is why: cutting a letter in relief does not cut the
               letter, it cuts the GROUND away and leaves the letter standing
               on the original face. So the letter is the face and the ground
               is fresh stone — the opposite way round from an incised one,
               which is the whole visual difference between a Roman
               inscription and a Victorian shop sign.
     soft      how rounded the mark's own edge is. A cast letter has no sharp
               arris anywhere on it and a cut one is all arris.
     dirt      how much weathering gathers in or against the mark.
     lip       material displaced to the rim, which is what a punch does and
               a chisel does not.
     emit      the mark is a light source rather than a surface. */
const MARKS={
  incise:{name:"cut in with a chisel",    depth:-2.5, ink:"core",ground:"face",soft:0.10,dirt:1.00,lip:0.00,inkGloss:-0.12,emit:false},
  etch  :{name:"etched shallow",          depth:-0.35,ink:"core",ground:"face",soft:0.25,dirt:0.70,lip:0.00,inkGloss:-0.22,emit:false},
  relief:{name:"carved in relief, proud", depth: 1.8, ink:"face",ground:"core",soft:0.20,dirt:0.30,lip:0.00,inkGloss:-0.05,emit:false},
  cast  :{name:"cast proud in the mould", depth: 1.2, ink:"face",ground:"face",soft:0.75,dirt:0.40,lip:0.00,inkGloss: 0.00,emit:false},
  punch :{name:"punched, with a lip",     depth:-1.1, ink:"core",ground:"face",soft:0.40,dirt:0.85,lip:0.45,inkGloss:-0.10,emit:false},
  inlay :{name:"inlaid flush",            depth:-0.05,ink:"own", ground:"face",soft:0.05,dirt:0.35,lip:0.00,inkGloss: 0.25,emit:false},
  print :{name:"printed on the face",     depth: 0.00,ink:"own", ground:"face",soft:0.15,dirt:0.10,lip:0.00,inkGloss: 0.05,emit:false},
  lume  :{name:"lit from behind",         depth: 0.00,ink:"own", ground:"face",soft:0.30,dirt:0.00,lip:0.00,inkGloss: 0.10,emit:true}
};
const MARK_KEYS=Object.keys(MARKS);
const markOf=P=>MARKS[str(P.marking,"incise")]||MARKS.incise;

/* ============================ the hand ============================
   Everything about HOW the skeletons get drawn, resolved once. The script
   row is the default and the panel can take it over wholesale — one switch
   rather than ten, because a hand is a single decision and tweaking the
   weight without meaning to change the script is the common case.

   The seed picks what the script row leaves open: which marks this
   alphabet uses to tell relatives apart, where it puts them, how many
   stations a radial script has, which side a stave is drawn on. Those are
   properties of the WHOLE alphabet, so they are drawn here and not
   per glyph — an alphabet that marked B with a dot and D with a bar is
   two alphabets. */
const MARK_SHAPES=["dot","twin","bar","tick","ring","hook","cross"];
/* A dot matrix has no strokes in it, so it cannot hang a bar or a hook off a
   letter without stopping being a dot matrix. Two shapes in four positions is
   eight distinguishable marks, which is more than the longest family needs. */
function marksFor(build){
  if(build==="dots")return ["dot","twin"];
  if(build==="wedge")return ["dot","twin","bar","tick"];
  return MARK_SHAPES;
}
function slotsFor(build){
  /* a mark INSIDE the glyph only works where the construction leaves a
     middle to put it in; anywhere else it lands on top of a stroke and
     neither shape survives */
  return (build==="box"||build==="radial")
    ? ["in","above","below","right","left"]
    : ["above","below","right","left"];
}
function handOf(P){
  const S=scriptOf(P),seed=P.seed|0;
  const rng=rngFor(seed,"hand");
  const auto=bool(P.handAuto,true);
  const H={
    key:str(P.script,"rune"),S:S,build:S.build,note:S.note,
    aw:   auto?S.aw   :clamp(num(P.aw,S.aw),0.35,1.2),
    wt:   auto?S.wt   :clamp(num(P.wt,S.wt),0.03,0.30),
    con:  auto?S.con  :clamp(num(P.con,S.con),0,1),
    pen:  (auto?S.pen :num(P.pen,S.pen))*DEG,
    slant:(auto?S.slant:num(P.slant,S.slant))*DEG,
    curve:auto?S.curve:clamp(num(P.curve,S.curve),0,1),
    term: auto?S.term :str(P.term,S.term),
    joint:S.joint,
    join: str(P.join,"auto")==="auto"?S.join:str(P.join,S.join),
    dir:  str(P.dir ,"auto")==="auto"?S.dir :str(P.dir ,S.dir),
    sep:  str(P.sep ,"auto")==="auto"?S.sep :str(P.sep ,S.sep),
    num:  S.num,
    mono: S.mono
  };
  /* the alphabet's own mark vocabulary and where it hangs them */
  const mk=marksFor(H.build);
  H.marks=shuffled(rng,mk).slice(0,Math.min(3,mk.length));
  H.slots=shuffled(rng,slotsFor(H.build)).slice(0,4);
  H.ring =pick(rng,[6,6,8]);              /* radial stations */
  H.stave=pick(rng,[0.14,0.14,0.5]);      /* where a stave stands, in aw */
  H.bear =H.wt*0.85+0.035;                /* side bearing */
  return H;
}

/* ============================ stroke primitives ============================
   A glyph is a list of strokes in its own box: x from 0 rightwards, y from
   0 at the CAP LINE to 1 at the BASELINE, y down like every other raster
   in the app. Marks live outside that, between -0.4 and 1.4, which is what
   gives an inscription an ascender and a descender zone to breathe in.

     L  polyline. `bow` bends every segment of it by that fraction of the
        segment's own length, which is how one lattice serves a carved
        script and a drawn one.
     A  circular arc, canvas angles (0 is +x, and +y is DOWN, so the half
        above the baseline is PI to TAU).
     W  a wedge: wide at p[0], a point at p[1]. An impression, not a line.
     D  a filled dot. */
const L=(p,bow,cl)=>({k:"L",p:p,bow:bow||0,cl:!!cl});
const A=(cx,cy,r,a0,a1)=>({k:"A",c:[cx,cy],r:r,a0:a0,a1:a1});
const W=(x0,y0,x1,y1,w)=>({k:"W",p:[[x0,y0],[x1,y1]],w:w});
const D=(x,y,r)=>({k:"D",c:[x,y],r:r});

/* HOW MUCH THERE IS TO DRAW. Counting stroke OBJECTS is the obvious measure
   and it is nearly useless: a walk on the lattice comes back as one polyline
   whether it took two steps or seven, so a five-stroke letter and a two-stroke
   letter both report 1 and the whole frequency-to-complexity relationship
   disappears into the count. What a reader meets is SEGMENTS — each straight
   run, each arc, each wedge, each dot — so that is what is counted, in the
   readout, in the readme and in the test that checks common letters come out
   simpler than rare ones. */
function segsOf(s){
  let n=0;
  for(const st of s)
    n+=(st.k==="L")?Math.max(1,st.p.length-1)+(st.cl?1:0):1;
  return n;
}

/* the ink box of a set of strokes, stroke weight included — everything that
   places a glyph or a mark measures from this rather than from the box the
   construction nominally drew in, because nothing fills its own box */
function inkOf(s,wt){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  const add=(x,y)=>{if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;};
  for(const st of s){
    if(st.k==="L"||st.k==="W")for(const q of st.p)add(q[0],q[1]);
    else if(st.k==="A"){
      /* the extremes of an arc are its ends plus whichever axis crossings it
         sweeps through — taking just the ends understates a half circle by
         its whole bulge */
      add(st.c[0]+Math.cos(st.a0)*st.r,st.c[1]+Math.sin(st.a0)*st.r);
      add(st.c[0]+Math.cos(st.a1)*st.r,st.c[1]+Math.sin(st.a1)*st.r);
      const lo=Math.min(st.a0,st.a1),hi=Math.max(st.a0,st.a1);
      for(let k=-2;k<=4;k++){
        const a=k*Math.PI/2;
        if(a>=lo&&a<=hi)add(st.c[0]+Math.cos(a)*st.r,st.c[1]+Math.sin(a)*st.r);
      }
    }else if(st.k==="D"){add(st.c[0]-st.r,st.c[1]-st.r);add(st.c[0]+st.r,st.c[1]+st.r);}
  }
  if(!isFinite(x0))return [0,0,0,0];
  const h=wt*0.5;
  return [x0-h,y0-h,x1+h,y1+h];
}

/* ============================ the constructions ============================
   Nine of them. Each takes the hand, a stroke budget and its own random
   stream, and returns strokes. The budget comes from how common the letter
   is, so these are all written to spend it rather than to hit it exactly —
   a construction that cannot use a fifth stroke should return four.

   What they have in common is that EVERY ONE RETURNS A CONNECTED SHAPE.
   A glyph in two pieces reads as two glyphs, which is the one error in an
   invented alphabet that no amount of styling recovers from. */

/* a stave with twigs: cut it across the grain and you get this */
function cStave(H,n,rng){
  const aw=H.aw,sx=H.stave*aw,both=H.stave>0.3;
  const s=[L([[sx,0],[sx,1]])];
  const hs=shuffled(rng,[0.10,0.26,0.42,0.58,0.74,0.90]).slice(0,Math.max(1,n));
  hs.sort((a,b)=>a-b);
  for(const h of hs){
    const side=both?pick(rng,[-1,1]):1;
    const reach=(both?0.42:0.80)*aw;
    const dy=pick(rng,[-0.20,-0.12,0,0.12,0.20]);
    const kind=pick(rng,["line","line","chev","hook","cross"]);
    if(kind==="cross"&&both)
      s.push(L([[sx-reach,h+dy],[sx+reach,h-dy]],H.curve*0.2));
    else if(kind==="chev")
      s.push(L([[sx,h-0.17],[sx+side*reach,h],[sx,h+0.17]],H.curve*0.25));
    else if(kind==="hook")
      s.push(L([[sx,h],[sx+side*reach,h+0.10],[sx+side*reach*0.55,h+0.26]],H.curve*0.45));
    else
      s.push(L([[sx,h],[sx+side*reach,clamp(h+dy,0,1)]],H.curve*0.25));
  }
  return s;
}

/* a walk on a 3 x 4 lattice. One trail, no edge twice, no doubling straight
   back on itself — which is what keeps it reading as a letter rather than as
   a scribble that happens to be connected. */
const TCOLS=3,TROWS=4;
function tnode(H,c,r){return [c/(TCOLS-1)*H.aw, r/(TROWS-1)];}
function cTrail(H,n,rng){
  const used={};
  const key=(a,b)=>a<b?a+"-"+b:b+"-"+a;
  const id=(c,r)=>r*TCOLS+c;
  let c=pick(rng,[0,0,1,2,2]),r=pick(rng,[0,0,3,3,1]);
  const pts=[[c,r]];
  let lastd=null;
  for(let step=0;step<n;step++){
    const opts=[];
    for(let dc=-1;dc<=1;dc++)for(let dr=-1;dr<=1;dr++){
      if(!dc&&!dr)continue;
      const nc=c+dc,nr=r+dr;
      if(nc<0||nc>=TCOLS||nr<0||nr>=TROWS)continue;
      if(used[key(id(c,r),id(nc,nr))])continue;
      if(lastd&&lastd[0]===-dc&&lastd[1]===-dr)continue;   /* no reversal */
      /* a long move reads as a stroke and a short one as a joint, so lean on
         the long ones — an alphabet of single-cell hops is a maze */
      const wgt=(Math.abs(dc)+Math.abs(dr)>1)?1:2;
      for(let k=0;k<wgt;k++)opts.push([dc,dr]);
    }
    if(!opts.length)break;
    const d=pick(rng,opts);
    used[key(id(c,r),id(c+d[0],r+d[1]))]=1;
    c+=d[0];r+=d[1];lastd=d;
    pts.push([c,r]);
  }
  const s=[L(pts.map(q=>tnode(H,q[0],q[1])),H.curve*0.55)];
  /* one branch off a node already visited keeps it connected and stops every
     glyph being a single unbranched path, which is its own tell */
  if(pts.length>2&&rng()<0.45){
    const at=pts[1+Math.floor(rng()*(pts.length-2))];
    const dc=pick(rng,[-1,0,1]),dr=pick(rng,[-1,0,1]);
    const nc=clamp(at[0]+dc,0,TCOLS-1),nr=clamp(at[1]+dr,0,TROWS-1);
    if(nc!==at[0]||nr!==at[1])
      s.push(L([tnode(H,at[0],at[1]),tnode(H,nc,nr)],H.curve*0.4));
  }
  return s;
}

/* right angles only, with a pad at each free end. A net, not a letter. */
function cOrtho(H,n,rng){
  let c=pick(rng,[0,1,2]),r=pick(rng,[0,3]);
  const pts=[[c,r]];
  let axis=pick(rng,[0,1]);
  for(let step=0;step<n;step++){
    const opts=[];
    if(axis===0){for(const d of[-2,-1,1,2]){const nc=c+d;if(nc>=0&&nc<TCOLS)opts.push([nc,r]);}}
    else        {for(const d of[-3,-2,-1,1,2,3]){const nr=r+d;if(nr>=0&&nr<TROWS)opts.push([c,nr]);}}
    if(!opts.length){axis^=1;continue;}
    const p=pick(rng,opts);
    if(p[0]===c&&p[1]===r){axis^=1;continue;}
    c=p[0];r=p[1];pts.push([c,r]);
    axis^=1;
  }
  return [L(pts.map(q=>tnode(H,q[0],q[1])))];
}

/* spokes and arcs about a centre at a fixed number of stations. Connected
   through the centre, which is why there is always at least one spoke. */
function cRadial(H,n,rng){
  const cx=H.aw*0.5,cy=0.5,R=0.45,ring=H.ring;
  const st=shuffled(rng,Array.from({length:ring},(_,i)=>i)).slice(0,Math.max(2,Math.min(ring,n)));
  st.sort((a,b)=>a-b);
  const ang=i=>i/ring*TAU-Math.PI*0.5;
  const s=[];
  let spokes=0;
  for(const i of st){
    const a=ang(i),rr=pick(rng,[R,R,R*0.62]);
    if(rng()<0.72){s.push(L([[cx,cy],[cx+Math.cos(a)*rr,cy+Math.sin(a)*rr]]));spokes++;}
  }
  if(!spokes){const a=ang(st[0]);s.push(L([[cx,cy],[cx+Math.cos(a)*R,cy+Math.sin(a)*R]]));}
  /* arcs between stations that are already on a spoke, so nothing floats */
  for(let i=0;i+1<st.length;i++){
    if(rng()<0.5)continue;
    s.push(A(cx,cy,R,ang(st[i]),ang(st[i+1])));
  }
  if(rng()<0.22)s.push(A(cx,cy,R*0.30,0,TAU));            /* a full inner ring */
  return s;
}

/* lobes on a baseline, entered and left at the line so a word can be
   written without lifting the pen */
function cLobe(H,n,rng){
  const aw=H.aw,yb=0.88,s=[];
  s.push(L([[0,yb],[aw*0.17,yb]]));                       /* entry */
  s.push(L([[aw*0.83,yb],[aw,yb]]));                      /* exit  */
  const lobes=Math.max(1,Math.min(2,n-1));
  for(let i=0;i<lobes;i++){
    const x0=aw*(0.14+i*0.38),x1=x0+aw*(0.40+rng()*0.16);
    const up=rng()<0.7;
    const r=(Math.min(x1,aw*0.98)-x0)*0.5;
    s.push(A((x0+Math.min(x1,aw*0.98))*0.5,yb,r,up?Math.PI:0,up?TAU:Math.PI));
  }
  if(n>=3){                                               /* an ascender */
    const x=aw*pick(rng,[0.17,0.5,0.83]);
    s.push(L([[x,yb],[x,0.04]],H.curve*0.3));
    if(rng()<0.5)s.push(L([[x,0.04],[x+aw*0.26,0.16]],H.curve*0.6));
  }
  if(n>=5)s.push(D(aw*0.5,yb+0.30,H.wt*0.75));            /* a point below */
  return s;
}

/* a headline with pendants hanging off it. A word under one bar. */
function cBar(H,n,rng){
  const aw=H.aw,s=[L([[0,0],[aw,0]])];
  /* FOUR STATIONS, NOT THREE. Three positions times five pendant kinds is
     about sixty shapes before the hand is applied, and twenty-six letters out
     of sixty means half the alphabet is somebody else's letter with one thing
     moved — this construction was the one that kept running up against the
     distinctness floor. Four stations is four times the room. */
  const xs=shuffled(rng,[0.14,0.38,0.62,0.86]).slice(0,clamp(n-1,1,4));
  xs.sort((a,b)=>a-b);
  for(const f of xs){
    const x=aw*f,kind=pick(rng,["stem","foot","loop","hook","dot","halt"]);
    if(kind==="loop"){
      s.push(L([[x,0],[x,0.52]]));
      s.push(A(x,0.72,0.22,-Math.PI*0.5,Math.PI*1.5));
    }else if(kind==="foot"){
      s.push(L([[x,0],[x,0.92],[x+aw*0.26,0.92]],H.curve*0.3));
    }else if(kind==="hook"){
      s.push(L([[x,0],[x,0.70],[x-aw*0.22,0.90]],H.curve*0.6));
    }else if(kind==="dot"){
      s.push(L([[x,0],[x,0.56]]));s.push(D(x,0.82,H.wt*0.85));
    }else if(kind==="halt"){
      s.push(L([[x,0],[x,0.44]]));
      s.push(L([[x-aw*0.16,0.44],[x+aw*0.16,0.44]]));
    }else{
      s.push(L([[x,0],[x,pick(rng,[0.74,0.92,1.0])]],H.curve*0.25));
    }
  }
  if(n>=5)s.push(L([[aw*0.2,1.0],[aw*0.8,1.0]],H.curve*0.3));
  return s;
}

/* every sign in its own frame. The box is as much the glyph as the marks. */
function cBox(H,n,rng){
  const aw=H.aw,i=0.05*aw,x0=i,x1=aw-i,y0=0.03,y1=0.97;
  const s=[];
  const open=rng()<0.3?Math.floor(rng()*4):-1;            /* one side left out */
  const c=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
  if(open<0)s.push(L(c,H.curve*0.12,true));
  else{
    const seq=[];
    for(let k=1;k<=4;k++)seq.push(c[(open+k)%4]);
    s.push(L(seq,H.curve*0.12));
  }
  const cells=[];
  for(let r=0;r<3;r++)for(let cc=0;cc<3;cc++)
    cells.push([lerp(x0,x1,(cc+1)/4),lerp(y0,y1,(r+1)/4)]);
  for(const p of shuffled(rng,cells).slice(0,Math.max(1,n-1))){
    const k=pick(rng,["hbar","vbar","dot","diag","ring"]),u=(x1-x0)*0.22,v=(y1-y0)*0.20;
    if(k==="hbar")s.push(L([[p[0]-u,p[1]],[p[0]+u,p[1]]]));
    else if(k==="vbar")s.push(L([[p[0],p[1]-v],[p[0],p[1]+v]]));
    else if(k==="diag")s.push(L([[p[0]-u,p[1]-v],[p[0]+u,p[1]+v]]));
    else if(k==="ring")s.push(A(p[0],p[1],Math.min(u,v),0,TAU));
    else s.push(D(p[0],p[1],H.wt*0.8));
  }
  return s;
}

/* wedges pressed into clay: a cluster, not a scatter, because a scribe's
   hand stays where it is and turns the stylus */
function cWedge(H,n,rng){
  const aw=H.aw,s=[];
  const ORI=[[1,0],[0,1],[0.72,0.72],[0.72,-0.72]];
  const cells=[];
  for(let r=0;r<3;r++)for(let c=0;c<2;c++)cells.push([lerp(aw*0.14,aw*0.86,c),lerp(0.14,0.86,r/2)]);
  const put=shuffled(rng,cells).slice(0,Math.max(2,Math.min(cells.length,n+1)));
  for(const p of put){
    const o=pick(rng,ORI),len=0.20+rng()*0.16;
    s.push(W(p[0],p[1],clamp(p[0]+o[0]*len*0.9,0,aw),clamp(p[1]+o[1]*len,-0.05,1.05),H.wt*1.5));
  }
  if(n>=5){                                               /* a winkelhaken */
    const p=pick(rng,put);
    s.push(W(p[0],p[1],p[0]+0.10,p[1]+0.10,H.wt*1.2));
  }
  return s;
}

/* three by five dots, on or off. The least a machine can print. */
function cDots(H,n,rng){
  const aw=H.aw,r=H.wt*0.80,cells=[];
  for(let row=0;row<5;row++)for(let col=0;col<3;col++)
    cells.push([lerp(aw*0.18,aw*0.82,col/2),lerp(0.08,0.92,row/4),row]);
  /* FEWER CELLS, NOT MORE. Light eleven of the fifteen and every glyph is
     every other glyph with a cell moved: there are not enough patterns left
     to be distinct in. Three to eight is where a 5 x 3 matrix has room. */
  const want=clamp(n+2,3,8);
  const take=shuffled(rng,cells).slice(0,want);
  /* a glyph that misses the top or the bottom row sits at the wrong height
     in a line of them, and in a matrix script that reads as a typo */
  const need=row=>{
    if(take.some(c=>c[2]===row))return;
    const add=pick(rng,cells.filter(c=>c[2]===row));
    take.push(add);
  };
  need(0);need(4);
  return take.map(c=>D(c[0],c[1],r));
}

const BUILDERS={stave:cStave,trail:cTrail,ortho:cOrtho,radial:cRadial,
                lobe:cLobe,bar:cBar,box:cBox,wedge:cWedge,dots:cDots};

/* ============================ sit on the line ============================
   SIT ON THE BASELINE AND REACH THE CAP LINE. A walk on a lattice can quite
   legitimately use three of its twelve nodes and come out a third of the cap
   height tall, and an alphabet of those reads as damaged: the short ones float
   in the middle of the line, every cell on the key sheet is mostly empty, and
   the atlas — which must share ONE scale across every cell or the advances in
   glyphs.json mean nothing — ends up sizing the whole set off whichever glyph
   happened to be tallest. A cap height most letters do not reach is not a cap
   height.

   This is a correction to the two WALKS and to nothing else, for two reasons.
   The other seven constructions already span the band by construction — a
   stave runs the full height by definition, a frame is the band, a dot matrix
   is forced to light its top and bottom rows — so a general fit-up would be a
   no-op on them at best. And it is applied on the Y AXIS ALONE: scaling both
   axes to fix the height is what turns a short glyph into one three times the
   width of its neighbours, which is a worse defect than the one being fixed.
   Neither walk emits an arc, so stretching one axis cannot turn a circle into
   an ellipse here — which is exactly why this would not be safe to do
   generally, and why the numeral rules, which are full of arcs and design
   their own vertical extent anyway, do not go through it.

   A walk that came out FLAT is left at its own size and centred on the band.
   Stretching a row of collinear points to the full cap height does not make a
   letter, it makes a vertical line. */
const FITY={trail:1,ortho:1};
function bandFit(s,H){
  if(!s||!s.length||!FITY[H.build])return s;
  const ink=inkOf(s,0),a=ink[1],b=ink[3],h=b-a;
  if(!(h>1e-6))return s;
  const flat=h<0.22;
  const my=flat?(y=>y+(0.5-(a+b)*0.5)):(y=>(y-a)/h);
  return s.map(st=>{
    if(st.k==="D")return D(st.c[0],my(st.c[1]),st.r);
    if(st.k==="W")return W(st.p[0][0],my(st.p[0][1]),st.p[1][0],my(st.p[1][1]),st.w);
    if(st.k==="A")return st;                    /* a walk never emits one */
    return L(st.p.map(q=>[q[0],my(q[1])]),st.bow,st.cl);
  });
}

/* ============================ family marks ============================
   What tells one member of a family from another. The unmarked form goes to
   whichever member you write most often, so the mark is the cost of the rarer
   sound — which is how every writing system that ever did this did it.

   A mark is placed off the glyph's INK box rather than off its nominal box,
   because nothing fills its own box and a mark set from the box is a mark
   that floats on the narrow glyphs and collides on the wide ones. */
function markStrokes(kind,slot,ink,H){
  const x0=ink[0],y0=ink[1],x1=ink[2],y1=ink[3];
  const cx=(x0+x1)*0.5,cy=(y0+y1)*0.5;
  /* A MARK HAS TO BE WORTH SEEING. Sized by eye it comes out around a
     twentieth of the glyph's ink, which is under the difference floor the
     alphabet is held to — so every family member fails its own distinctness
     test and gets a second mark piled on it. A fifth of the cap height is
     about a Devanagari matra or a Hebrew dagesh, and it passes. */
  const g=H.wt*1.4+0.045,u=0.105;
  let mx=cx,my=cy,vert=false;
  if(slot==="above"){my=y0-g-u;}
  else if(slot==="below"){my=y1+g+u;}
  else if(slot==="right"){mx=x1+g+u;vert=true;}
  else if(slot==="left"){mx=x0-g-u;vert=true;}
  /* a bar or a twin lies ACROSS the direction it was hung from, or it reads as
     a continuation of the stroke it is next to rather than as a mark */
  switch(kind){
    case "dot":  return [D(mx,my,H.wt*1.15)];
    case "twin": return vert?[D(mx,my-u*0.8,H.wt*0.95),D(mx,my+u*0.8,H.wt*0.95)]
                           :[D(mx-u*0.8,my,H.wt*0.95),D(mx+u*0.8,my,H.wt*0.95)];
    case "bar":  return vert?[L([[mx,my-u],[mx,my+u]])]:[L([[mx-u,my],[mx+u,my]])];
    case "tick": return [L([[mx-u*0.8,my+u*0.8],[mx+u*0.8,my-u*0.8]])];
    case "ring": return [A(mx,my,u*0.80,0,TAU)];
    case "hook": return [L([[mx-u,my-u*0.4],[mx+u*0.35,my],[mx-u*0.25,my+u]],0.5)];
    default:     return [L([[mx-u,my-u],[mx+u,my+u]]),L([[mx+u,my-u],[mx-u,my+u]])];
  }
}
/* member i of a family, attempt a: the pair (kind, slot) walks both lists at
   different strides, so five vowels get five visibly different marks out of
   three shapes and four positions rather than the same one in five places */
/* A WEDGE SCRIPT PRESSES ITS MARKS and a dot matrix prints them as dots.
   A hand that writes every letter with one tool and then hangs a pen stroke
   off it is not one hand, and it is the first thing the eye catches. */
function markIn(s,H){
  if(H.build!=="wedge")return s;
  const out=[];
  for(const st of s){
    if(st.k==="L"){for(let i=0;i+1<st.p.length;i++)
      out.push(W(st.p[i][0],st.p[i][1],st.p[i+1][0],st.p[i+1][1],H.wt*1.3));}
    else if(st.k==="A"){
      out.push(W(st.c[0]+Math.cos(st.a0)*st.r,st.c[1]+Math.sin(st.a0)*st.r,
                 st.c[0]+Math.cos(st.a1)*st.r,st.c[1]+Math.sin(st.a1)*st.r,H.wt*1.3));
    }else out.push(st);
  }
  return out;
}
function markFor(i,a,H){
  return {kind:H.marks[(i-1+a)%H.marks.length],
          slot:H.slots[(i-1+a*2)%H.slots.length]};
}

/* ============================ numerals ============================
   DIGITS ARE NEVER ARBITRARY. Every numeral system that was not borrowed
   wholesale is a rule you can see: strokes you count, two registers of five,
   a position around a ring, a field of bits. So the digits here are generated
   from a rule the script declares and the readme states, which means the
   numbers in an inscription can be read off the key rather than memorised.

   Zero is always a DIFFERENT KIND OF SIGN, never the rule applied to nothing,
   because a mark meaning "none" was invented separately everywhere it was
   invented at all — and because an empty glyph is a hole in the line. */
function numeralOf(d,H,rng){
  const aw=H.aw,s=[];
  const rule=H.num;
  if(d===0){
    /* a ring with a bar through it: none of the rules can produce this, which
       is the point of it */
    s.push(A(aw*0.5,0.5,Math.min(aw*0.38,0.34),0,TAU));
    s.push(L([[aw*0.5-0.22,0.72],[aw*0.5+0.22,0.28]]));
    return s;
  }
  if(rule==="tally"){
    /* groups of five, the fifth struck across the other four */
    const groups=[];
    let left=d;
    while(left>0){groups.push(Math.min(5,left));left-=Math.min(5,left);}
    let x=aw*0.12;
    for(const gn of groups){
      const bars=Math.min(4,gn);
      for(let i=0;i<bars;i++)s.push(L([[x+i*0.085,0.12],[x+i*0.085,0.88]]));
      if(gn===5)s.push(L([[x-0.03,0.82],[x+bars*0.085,0.18]]));
      x+=bars*0.085+0.13;
    }
    return s;
  }
  if(rule==="quinary"){
    /* upper register: how many fives. lower register: the remainder. */
    const fives=Math.floor(d/5),ones=d%5;
    for(let i=0;i<fives;i++)s.push(L([[aw*0.14,0.22+i*0.12],[aw*0.86,0.22+i*0.12]]));
    for(let i=0;i<ones;i++){
      const x=aw*(0.18+i*0.16);
      s.push(L([[x,0.56],[x,0.92]]));
    }
    if(!ones)s.push(D(aw*0.5,0.80,H.wt*0.8));
    return s;
  }
  if(rule==="ring"){
    /* A DIAL: the tick's POSITION is the number, not how many ticks there are.
       Counting ticks round a circle puts 8 and 9 one tick apart out of nine,
       which is the hardest thing on the sheet to read; a pointer at one of ten
       stations puts every pair a whole station apart. */
    const cx=aw*0.5,cy=0.5,R=Math.min(aw*0.40,0.34);
    s.push(A(cx,cy,R,0,TAU));
    const a=d/10*TAU-Math.PI*0.5;
    s.push(L([[cx+Math.cos(a)*(R*0.25),cy+Math.sin(a)*(R*0.25)],
              [cx+Math.cos(a)*(R+0.14),cy+Math.sin(a)*(R+0.14)]]));
    return s;
  }
  /* binary: four bits in a field, with the field drawn so zero is a sign */
  const x0=aw*0.18,x1=aw*0.82,y0=0.14,y1=0.86;
  s.push(L([[x0-0.05,y0-0.05],[x1+0.05,y0-0.05],[x1+0.05,y1+0.05],[x0-0.05,y1+0.05]],0,true));
  for(let b=0;b<4;b++){
    if(!((d>>b)&1))continue;
    s.push(D(lerp(x0,x1,(b&1)?1:0),lerp(y0,y1,(b&2)?1:0),H.wt*1.30));
  }
  return s;
}
const NUMNOTE={
  tally  :"strokes you count, in groups of five with the fifth struck across the other four",
  quinary:"two registers: a bar in the upper one for each five, a tick in the lower one for each remaining unit",
  ring   :"a ring with a tick at one of ten stations around it, counting clockwise from the top",
  binary :"four bits in a field — the low bit at the top left, then across, then down"
};

/* ============================ punctuation ============================
   Primitive on purpose. Punctuation in every script that has it is dots,
   strokes and arcs, because it was added late by people who wanted something
   that could not be mistaken for a letter — so it is the one part of an
   invented alphabet that should NOT look invented. What the script does to it
   is apply its own idiom: a wedge script presses them, a dot matrix prints
   them as dots. */
function punctOf(ch,H){
  const aw=H.aw,m=aw*0.5,r=H.wt*0.85;
  switch(ch){
    case ".": return [D(m,0.92,r)];
    case ",": return [D(m,0.92,r),L([[m,0.98],[m-0.07,1.22]],0.4)];
    case ":": return [D(m,0.34,r),D(m,0.92,r)];
    case ";": return [D(m,0.34,r),D(m,0.92,r),L([[m,0.98],[m-0.07,1.22]],0.4)];
    case "!": return [L([[m,0.06],[m,0.66]]),D(m,0.92,r)];
    case "?": return [L([[m-aw*0.26,0.20],[m,0.06],[m+aw*0.22,0.22],[m,0.46],[m,0.62]],0.5),D(m,0.92,r)];
    case "-": return [L([[aw*0.16,0.52],[aw*0.84,0.52]])];
    case "'": return [L([[m,0.04],[m-0.04,0.28]])];
    case "(": return [A(m+aw*0.30,0.5,0.52,Math.PI*0.72,Math.PI*1.28)];
    case ")": return [A(m-aw*0.30,0.5,0.52,-Math.PI*0.28,Math.PI*0.28)];
    case "/": return [L([[aw*0.12,1.0],[aw*0.88,0.0]])];
    default:  return [D(m,0.5,r)];
  }
}

/* ============================ the idiom ============================
   One construction's signature move, applied to strokes that came from
   somewhere else — a reformed Latin letter, or a piece of punctuation. This
   is what stops a reform looking like Latin with the serifs filed off. */
function manhattan(pts){
  const out=[pts[0]];
  for(let i=1;i<pts.length;i++){
    const a=out[out.length-1],b=pts[i];
    if(Math.abs(b[0]-a[0])>1e-6&&Math.abs(b[1]-a[1])>1e-6)out.push([b[0],a[1]]);
    out.push(b);
  }
  return out;
}
function idiomise(s,H,rng){
  const aw=H.aw;
  if(H.build==="dots"){
    /* light the cell if any stroke passes near it — which is a dot-matrix
       font doing exactly what a dot-matrix font does */
    const r=H.wt*0.80,on=[],near=aw*0.19;
    for(let row=0;row<5;row++)for(let col=0;col<3;col++){
      const px=lerp(aw*0.18,aw*0.82,col/2),py=lerp(0.08,0.92,row/4);
      let hit=false;
      for(const st of s){
        if(st.k==="D"){if(Math.hypot(st.c[0]-px,st.c[1]-py)<near)hit=true;}
        else if(st.k==="A"){
          for(let t=0;t<=12&&!hit;t++){
            const a=lerp(st.a0,st.a1,t/12);
            if(Math.hypot(st.c[0]+Math.cos(a)*st.r-px,st.c[1]+Math.sin(a)*st.r-py)<near)hit=true;
          }
        }else for(let i=0;i+1<st.p.length&&!hit;i++){
          const A0=st.p[i],B0=st.p[i+1];
          for(let t=0;t<=8;t++){
            const qx=lerp(A0[0],B0[0],t/8),qy=lerp(A0[1],B0[1],t/8);
            if(Math.hypot(qx-px,qy-py)<near){hit=true;break;}
          }
        }
        if(hit)break;
      }
      if(hit)on.push(D(px,py,r));
    }
    return on.length?on:[D(aw*0.5,0.5,r)];
  }
  if(H.build==="wedge"){
    const out=[];
    for(const st of s){
      if(st.k==="D"){out.push(W(st.c[0],st.c[1],st.c[0]+0.1,st.c[1]+0.1,H.wt*1.3));continue;}
      if(st.k==="A"){
        for(let t=0;t<3;t++){
          const a0=lerp(st.a0,st.a1,t/3),a1=lerp(st.a0,st.a1,(t+1)/3);
          out.push(W(st.c[0]+Math.cos(a0)*st.r,st.c[1]+Math.sin(a0)*st.r,
                     st.c[0]+Math.cos(a1)*st.r,st.c[1]+Math.sin(a1)*st.r,H.wt*1.4));
        }
        continue;
      }
      for(let i=0;i+1<st.p.length;i++)
        out.push(W(st.p[i][0],st.p[i][1],st.p[i+1][0],st.p[i+1][1],H.wt*1.5));
    }
    return out;
  }
  if(H.build==="ortho"){
    return s.map(st=>st.k==="L"?L(manhattan(st.p),0,st.cl):st);
  }
  if(H.build==="lobe"){
    const out=s.map(st=>st.k==="L"?L(st.p,H.curve*0.6,st.cl):st);
    out.unshift(L([[0,0.88],[aw*0.17,0.88]]));
    out.push(L([[aw*0.83,0.88],[aw,0.88]]));
    return out;
  }
  if(H.build==="bar"){
    const out=s.slice();out.unshift(L([[0,0],[aw,0]]));return out;
  }
  if(H.build==="box"){
    const out=s.map(st=>st.k==="L"?L(st.p.map(q=>[lerp(aw*0.22,aw*0.78,q[0]/aw),
                                                  lerp(0.20,0.80,q[1])]),st.bow,st.cl):
                                   (st.k==="D"?D(lerp(aw*0.22,aw*0.78,st.c[0]/aw),
                                                 lerp(0.20,0.80,st.c[1]),st.r*0.8):st));
    out.unshift(L([[aw*0.05,0.03],[aw*0.95,0.03],[aw*0.95,0.97],[aw*0.05,0.97]],0,true));
    return out;
  }
  if(H.build==="stave"){
    const sx=H.stave*aw;
    const hasStave=s.some(st=>st.k==="L"&&st.p.some(q=>Math.abs(q[0]-sx)<aw*0.12&&q[1]<0.12)&&
                                           st.p.some(q=>Math.abs(q[0]-sx)<aw*0.12&&q[1]>0.88));
    const out=s.slice();
    if(!hasStave)out.unshift(L([[sx,0],[sx,1]]));
    return out;
  }
  return s;
}

/* ============================ the reform ============================
   A script that is OURS, later. It starts from the single-stroke Latin
   skeleton — the same alphabet the pcb mode screens its legends in — and
   drifts away from it by the four things that actually happen to letters
   over centuries of being written quickly by people who are not thinking
   about it:

     strokes are dropped   and the ones that go are the short ones. Every
                           simplification in the history of writing took the
                           fussy bits off and left the armature.
     vertices snap         onto whatever lattice the hand habitually moves
                           on, because a scribe repeating a shape ten
                           thousand times regularises it towards the moves
                           their hand already makes.
     the idiom arrives     a reformed letter in a wedge script is pressed,
                           in a dot matrix it is printed as dots, under a
                           headline script it grows a headline.
     forms turn over       mirrorings and quarter turns are everywhere in
                           the record — archaic Greek, the runes, and every
                           alphabet deliberately reformed on paper, which
                           tends to pair related sounds as rotations of one
                           another on purpose.

   At no drift it is a stylised Latin anyone can read. At full drift it is
   unrecognisable, and was not always — which is the whole fiction. */
function snapPt(q,H,t){
  let bx,by;
  if(H.build==="radial"){
    const cx=H.aw*0.5,cy=0.5,R=0.45;
    let best=[cx,cy],bd=Math.hypot(q[0]-cx,q[1]-cy);
    for(const rr of [R,R*0.62])for(let i=0;i<H.ring;i++){
      const a=i/H.ring*TAU-Math.PI*0.5;
      const px=cx+Math.cos(a)*rr,py=cy+Math.sin(a)*rr,d=Math.hypot(q[0]-px,q[1]-py);
      if(d<bd){bd=d;best=[px,py];}
    }
    bx=best[0];by=best[1];
  }else{
    const c=clamp(Math.round(q[0]/H.aw*(TCOLS-1)),0,TCOLS-1);
    const r=clamp(Math.round(q[1]*(TROWS-1)),0,TROWS-1);
    const n=tnode(H,c,r);bx=n[0];by=n[1];
  }
  return [lerp(q[0],bx,t),lerp(q[1],by,t)];
}
function flipX(s,aw){
  return s.map(st=>{
    if(st.k==="A")return A(aw-st.c[0],st.c[1],st.r,Math.PI-st.a1,Math.PI-st.a0);
    if(st.k==="D")return D(aw-st.c[0],st.c[1],st.r);
    if(st.k==="W")return W(aw-st.p[0][0],st.p[0][1],aw-st.p[1][0],st.p[1][1],st.w);
    return L(st.p.map(q=>[aw-q[0],q[1]]),st.bow,st.cl);
  });
}
/* a quarter turn about the middle of the glyph box, back into the same box */
function rotQ(s,aw){
  const cx=aw*0.5,cy=0.5,k=aw>0?1/aw:1;
  const m=q=>[cx+(cy-q[1])*aw,cy+(q[0]-cx)*k];
  return s.map(st=>{
    if(st.k==="A")return A(m(st.c)[0],m(st.c)[1],st.r,st.a0+Math.PI*0.5,st.a1+Math.PI*0.5);
    if(st.k==="D")return D(m(st.c)[0],m(st.c)[1],st.r);
    if(st.k==="W")return W(m(st.p[0])[0],m(st.p[0])[1],m(st.p[1])[0],m(st.p[1])[1],st.w);
    return L(st.p.map(m),st.bow,st.cl);
  });
}
/* `push` is WHICH TRY THIS IS. A reform of X is a reform of X: drop the short
   strokes, snap the rest, apply the idiom, and you get the same answer every
   time — so asking for another candidate the way the invented path does, by
   handing it a fresh random stream, gets you the same glyph back. A reform that
   cannot be made distinct therefore has to DRIFT FURTHER: a little more
   regularisation, a different stroke sacrificed, and the turnings brought
   forward. Which is also the honest fiction — two letters that collided is
   exactly the pressure that moves a script on. */
function reformOf(ch,H,rng,drift,push){
  const src=window.ForgeStroke&&ForgeStroke.GLY[ch];
  if(!src)return null;
  push=push||0;
  const dr=clamp(drift+push*0.05,0,1);
  const k=H.aw/4.2;
  let s=src.map(pl=>L(pl.map(q=>[q[0]*k,q[1]/ForgeStroke.CAP])));
  if(s.length>1){
    const len=st=>{let t=0;for(let i=0;i+1<st.p.length;i++)
      t+=Math.hypot(st.p[i+1][0]-st.p[i][0],st.p[i+1][1]-st.p[i][1]);return t;};
    const keep=Math.max(1,Math.round(s.length*(1-dr*0.5)));
    const byLen=s.map(st=>({st:st,l:len(st)})).sort((a,b)=>b.l-a.l).map(o=>o.st);
    /* the longest stroke is the armature and always survives; after that, a
       later try sacrifices a different one */
    const rest=byLen.slice(1);
    const off=rest.length?push%rest.length:0;
    s=[byLen[0]].concat(rest.slice(off).concat(rest.slice(0,off)).slice(0,keep-1));
  }
  const t=clamp(dr*1.15,0,1);
  if(t>0.01)s=s.map(st=>L(st.p.map(q=>snapPt(q,H,t)),st.bow,st.cl));
  s=idiomise(s,H,rng);
  if((dr>0.5||push>=4)&&rng()<0.40)s=flipX(s,H.aw);
  if((dr>0.7||push>=6)&&rng()<0.35)s=rotQ(s,H.aw);
  return s;
}

/* ============================ no two the same ============================
   Every candidate is stamped into a small grid and compared against every
   glyph already in the alphabet — and against its MIRROR and its HALF TURN
   too, because b/d and n/u confusion is a real defect of a real alphabet
   and an invented one has no excuse for it.

   The grid is stamped by hand rather than through a canvas on purpose: this
   decides which glyphs the alphabet ends up containing, so it has to give
   the same answer on a worker thread as on the page, and canvas antialiasing
   is not a thing to promise that about. */
const SW=22,SH=30;
function sigOf(s,H){
  const sig=new Uint8Array(SW*SH);
  const bw=Math.max(0.2,H.aw*1.8),by0=-0.42,bh=1.84;
  const cxOf=x=>x/bw*SW,cyOf=y=>(y-by0)/bh*SH;
  const rad=Math.max(0.65,(H.wt*0.5/bw*SW+H.wt*0.5/bh*SH)*0.5);
  const disc=(x,y,r)=>{
    const i0=Math.max(0,Math.floor(x-r)),i1=Math.min(SW-1,Math.ceil(x+r));
    const j0=Math.max(0,Math.floor(y-r)),j1=Math.min(SH-1,Math.ceil(y+r));
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      const dx=i+0.5-x,dy=j+0.5-y;
      if(dx*dx+dy*dy<=r*r)sig[j*SW+i]=1;
    }
  };
  const run=(x0,y0,x1,y1,r)=>{
    const n=Math.max(1,Math.ceil(Math.hypot(x1-x0,y1-y0)/0.4));
    for(let i=0;i<=n;i++)disc(lerp(x0,x1,i/n),lerp(y0,y1,i/n),r);
  };
  for(const st of s){
    if(st.k==="D")disc(cxOf(st.c[0]),cyOf(st.c[1]),Math.max(0.65,st.r/bw*SW));
    else if(st.k==="A"){
      const n=Math.max(4,Math.ceil(Math.abs(st.a1-st.a0)/0.25));
      for(let i=0;i<n;i++){
        const a0=lerp(st.a0,st.a1,i/n),a1=lerp(st.a0,st.a1,(i+1)/n);
        run(cxOf(st.c[0]+Math.cos(a0)*st.r),cyOf(st.c[1]+Math.sin(a0)*st.r),
            cxOf(st.c[0]+Math.cos(a1)*st.r),cyOf(st.c[1]+Math.sin(a1)*st.r),rad);
      }
    }else if(st.k==="W"){
      run(cxOf(st.p[0][0]),cyOf(st.p[0][1]),cxOf(st.p[1][0]),cyOf(st.p[1][1]),
          Math.max(0.8,st.w*0.5/bw*SW));
    }else{
      for(let i=0;i+1<st.p.length;i++)
        run(cxOf(st.p[i][0]),cyOf(st.p[i][1]),cxOf(st.p[i+1][0]),cyOf(st.p[i+1][1]),rad);
      if(st.cl&&st.p.length>2)
        run(cxOf(st.p[st.p.length-1][0]),cyOf(st.p[st.p.length-1][1]),
            cxOf(st.p[0][0]),cyOf(st.p[0][1]),rad);
    }
  }
  return sig;
}
/* HOW MUCH OF THE INK IS DIFFERENT, as a fraction of the heavier of the two.
   Intersection over union is the obvious measure here and it is the wrong one:
   a family mark is a few per cent of a glyph's ink, so two letters that differ
   by exactly the thing that is SUPPOSED to tell them apart score 0.85 on it
   and get thrown away. What matters is whether there is enough visible
   difference to see, which is the symmetric difference — and holding the
   alphabet to a floor on that has a second effect worth having: it is what
   forces a distinguishing mark to be big enough to be a distinguishing
   mark. */
function diffOf(a,b){
  let d=0,na=0,nb=0;
  for(let i=0;i<a.length;i++){
    const x=a[i],y=b[i];
    if(x!==y)d++;
    if(x)na++;
    if(y)nb++;
  }
  const m=Math.max(na,nb,1);
  return d/m;
}
function sigMirX(a){
  const o=new Uint8Array(a.length);
  for(let j=0;j<SH;j++)for(let i=0;i<SW;i++)o[j*SW+i]=a[j*SW+(SW-1-i)];
  return o;
}
function sigRot(a){
  const o=new Uint8Array(a.length);
  for(let j=0;j<SH;j++)for(let i=0;i<SW;i++)o[j*SW+i]=a[(SH-1-j)*SW+(SW-1-i)];
  return o;
}
/* How different is different enough, as a fraction of the heavier glyph's
   ink. The straight comparison is the strict one; a glyph that is only
   somebody else's MIRROR or half turn is allowed to be nearer, because
   turning a form over is how related letters actually get made — just not so
   near that the pair is one letter drawn twice. */
const MIN_DIFF=0.13,MIN_FLIP=0.07;
/* ONE DIGIT AGAINST ANOTHER IS HELD TO A LOWER FLOOR, and that is a decision
   about reading rather than a concession. A systematic numeral set is meant to
   be read by COUNTING — four tallies against five, two bits set against
   three — so consecutive numbers in it are near each other by construction,
   and forcing them apart would be destroying the rule to satisfy a test of
   it. They still may not be the same sign. Against letters and punctuation a
   digit is held to the full floor, because THERE counting is no help: you
   cannot count your way out of mistaking a numeral for a letter. */
const DIG_DIFF=0.045,DIG_FLIP=0.030;
/* -> how close this candidate came to the limit. Over 1 is too close. */
function tooClose(cs,other,relax){
  const fd=relax?DIG_DIFF:MIN_DIFF,ff=relax?DIG_FLIP:MIN_FLIP;
  const d0=diffOf(cs,other),d1=diffOf(cs,sigMirX(other)),d2=diffOf(cs,sigRot(other));
  return Math.max(d0>0?fd/d0:Infinity,
                  d1>0?ff/d1:Infinity,
                  d2>0?ff/d2:Infinity);
}

/* ============================ the alphabet ============================
   ONE FUNCTION, memoised, and everything reads it: the build, the readout,
   the readme, the key sheet, the atlas and the exported glyphs.json. That is
   not tidiness — the key sheet IS the key to the inscription, and a chart
   generated by a second, nearly identical code path is a key that decodes a
   plate it does not quite agree with. */
let CACHE=null;
function alphKey(P){
  return [str(P.script,"rune"),P.seed|0,str(P.origin,"alien"),num(P.drift,0.5),
    num(P.famAmt,0.7),num(P.complex,0.5),bool(P.ruleNum,true)?1:0,
    bool(P.handAuto,true)?1:[num(P.aw,0),num(P.wt,0),num(P.con,0),num(P.pen,0),
                            num(P.slant,0),num(P.curve,0),str(P.term,"")].join(",")
  ].join("|");
}
function budgetOf(rank,cx){
  const lo=2+Math.round(cx*1.2);
  return Math.round(lerp(lo,lo+1+Math.round(cx*4),rank/(FREQ.length-1)));
}
function alphabetOf(P){
  const key=alphKey(P);
  if(CACHE&&CACHE.key===key)return CACHE.A;
  const H=handOf(P),seed=P.seed|0;
  const reform=str(P.origin,"alien")==="reform";
  const drift=clamp(num(P.drift,0.5),0,1);
  const cx=clamp(num(P.complex,0.5),0,1);
  /* HOW MANY FAMILIES ACTUALLY SHARE. At zero every letter is its own
     invention and the control is off in a way you can test; at one all eleven
     share. They come in the order they are declared, vowels first, because
     that is the group where sharing shows. */
  const shareN=Math.round(clamp(num(P.famAmt,0.7),0,1)*FAMILIES.length);
  const G={},sig={},cls={},order=[];
  let worst=0,worstPair="";
  /* accept a glyph, or say why not. `make(a)` is tried for a = 0, 1, 2 … and
     has to be deterministic in a, so a re-roll is a different glyph rather
     than the same glyph again. */
  /* ACCEPT A GLYPH, OR SAY WHY NOT. `stages` is tried in order — each stage a
     different idea of what this character could be, each with its own number
     of goes — and the first candidate that clears every glyph already in the
     alphabet wins. The best near miss is kept all the way through, because the
     last resort is built on it. */
  function accept(ch,kind,stages){
    /* INFINITY, not two. `v` is a floor divided by a difference, so two glyphs
       that are nearly the same score far above any small number — and a
       sentinel of 2 meant the best candidate was never recorded at all and the
       character was quietly left out of the alphabet. A hole in an alphabet is
       the one defect here that cannot be styled around. */
    let hit=null,best=null,bestV=Infinity;
    const judge=cand=>{
      const cs=sigOf(cand,H);
      let v=0,who="";
      for(const o of order){
        const d=tooClose(cs,sig[o],kind==="digit"&&cls[o]==="digit");
        if(d>v){v=d;who=o;}
      }
      return {s:cand,sig:cs,v:v,who:who};
    };
    for(const stage of stages){
      for(let a=0;a<stage.tries&&!hit;a++){
        const cand=stage.make(a);
        if(!cand||!cand.length)continue;
        const r=judge(cand);
        if(r.v<bestV){bestV=r.v;best=r;}
        if(r.v<1)hit=r;
      }
      if(hit)break;
    }
    /* Nothing in any stage was distinct enough: take the best near miss and
       hang a mark on it that nothing else has. One mark first, then two at
       different slots — two marks is ugly and it is always available, so the
       escalation terminates. A glyph that is merely ugly beats two letters
       that are the same letter. */
    let rec=hit||best;
    if(!hit&&best){
      for(let a=0;a<24;a++){
        const m=markFor(1+(a%3),a,H),ink=inkOf(best.s,H.wt);
        let cand=best.s.concat(markIn(markStrokes(m.kind,m.slot,ink,H),H));
        let meta={kind:m.kind,slot:m.slot,forced:true};
        if(a>=12){
          const m2=markFor(1+((a+1)%3),a+3,H);
          cand=cand.concat(markIn(markStrokes(m2.kind,m2.slot,ink,H),H));
          meta={kind:m.kind+"+"+m2.kind,slot:m.slot+"+"+m2.slot,forced:true};
        }
        cand.mark=best.s.mark||meta;cand.fam=best.s.fam;cand.fi=best.s.fi;
        const r=judge(cand);
        if(r.v<1){rec=r;break;}
        if(r.v<rec.v)rec=r;
      }
    }
    /* AND IT IS NEVER EMPTY. Every path above can in principle come back with
       nothing — a reform of a character the Latin alphabet has no stroke form
       for, a construction that could not use its budget — and the answer to
       that is a glyph, not a gap. */
    if(!rec){
      const fb=bandFit(BUILDERS[H.build](H,3,rngFor(seed,"fallback:"+ch)),H);
      rec=judge(fb);
    }
    G[ch]={s:rec.s,mark:rec.s.mark||null,fam:rec.s.fam||null,fi:rec.s.fi};
    sig[ch]=rec.sig;
    cls[ch]=kind;
    order.push(ch);
    /* `v` is already a FRACTION OF THE LIMIT — the strict limit for a straight
       comparison, the looser one for a mirror or a half turn, the lower one
       between two digits — so one number covers them all and 1.0 means "as
       close as this alphabet allows". */
    if(rec.v>worst){worst=rec.v;worstPair=ch+"/"+(rec.who||"?");}
  }
  /* a character on its own terms: invented from the construction, or reformed
     from its Latin ancestor */
  const solo=(ch,rank,tag)=>({tries:reform?16:12,make:a=>{
    const rng=rngFor(seed,tag+":"+ch+":"+a);
    return bandFit(reform?reformOf(ch,H,rng,drift,a)
                         :BUILDERS[H.build](H,budgetOf(rank,cx),rng),H);
  }});

  /* ---- the letters, family by family ---- */
  let forcedSolo=0;
  for(let fi=0;fi<FAMILIES.length;fi++){
    const F=FAMILIES[fi],shares=fi<shareN;
    /* the family's skeleton is as simple as its most common member deserves */
    let bestRank=99;
    for(const c of F.chars)bestRank=Math.min(bestRank,RANK[c]);
    if(!shares){
      for(const ch of F.chars)accept(ch,"letter",[solo(ch,RANK[ch],"ch")]);
      continue;
    }
    /* THE LEADER GOES FIRST AND WHAT IT GETS IS THE FAMILY'S SKELETON. Picking
       a skeleton up front and checking it afterwards is how the rest of a
       family ends up built on a form the leader itself was not allowed to
       have — the check rejected it, the leader took something else, and the
       other four kept the reject. */
    const lead=F.chars[0];
    accept(lead,"letter",[solo(lead,bestRank,"fam:"+F.key)]);
    const base=G[lead].s;
    for(let i=1;i<F.chars.length;i++){
      const ch=F.chars[i],had=order.length;
      accept(ch,"letter",[
        {tries:14,make:a=>{
          const m=markFor(i,a,H);
          /* THE META RIDES ON THE CANDIDATE. Which attempt won is known only
             inside accept(), and an array will carry a property perfectly
             well — so the winning glyph arrives already knowing what mark it
             is wearing, instead of accept() having to report it back. */
          const cand=base.concat(markIn(markStrokes(m.kind,m.slot,inkOf(base,H.wt),H),H));
          cand.mark=m;cand.fam=F.key;cand.fi=i;
          return cand;
        }},
        /* A MEMBER A MARK CANNOT SAVE LEAVES THE FAMILY. Relatives are a
           convenience and being readable is not, so where no mark in the
           alphabet's vocabulary puts this member clear of everything else, it
           gets a form of its own instead. The readout counts these, because a
           script with a lot of them is a script whose families are not doing
           the work the control says they are. */
        solo(ch,RANK[ch],"solo")
      ]);
      /* a member built from the family skeleton SHARES ITS STROKE OBJECTS,
         because that is what concat does — so object identity on the first one
         says which stage won, and no bookkeeping has to be kept in step */
      if(order.length>had&&G[ch].s[0]!==base[0]){forcedSolo++;G[ch].solo=true;}
    }
  }
  /* ---- the digits ---- */
  const ruleNum=bool(P.ruleNum,true);
  for(let d=0;d<10;d++){
    const ch=String(d);
    accept(ch,"digit",[{tries:6,make:a=>{
      const rng=rngFor(seed,"num:"+ch+":"+a);
      /* NOT band-fitted. A numeral rule designs its own vertical extent on
         purpose — two registers, a dial, a field of bits — and it is the only
         thing here that draws arcs, which the walk fit is explicitly not safe
         for. Stretching a zero's slash while leaving its ring alone is what
         that costs. */
      if(ruleNum)return a===0?numeralOf(d,H,rng):idiomise(numeralOf(d,H,rng),H,rng);
      return bandFit(reform?reformOf(ch,H,rng,drift,a)
                           :BUILDERS[H.build](H,budgetOf(14,cx),rng),H);
    }}]);
  }
  /* ---- punctuation ---- */
  for(const ch of PUNCT){
    accept(ch,"punct",[{tries:4,make:a=>{
      const rng=rngFor(seed,"pun:"+ch+":"+a);
      const s=punctOf(ch,H);
      return a===0?s:idiomise(s,H,rng);
    }}]);
  }

  /* ---- metrics. The glyph is positioned by its OWN ink, so a narrow letter
     is narrow and a letter with a mark hanging off its left edge does not
     start half a stroke into the one before it. ---- */
  let maxInk=0;
  for(const ch of order){
    const ink=inkOf(G[ch].s,H.wt);
    G[ch].ink=ink;
    maxInk=Math.max(maxInk,ink[2]-ink[0]);
  }
  const mono=H.mono?Math.max(H.aw,maxInk)+H.bear*2:0;
  for(const ch of order){
    const ink=G[ch].ink,w=ink[2]-ink[0];
    if(mono){G[ch].adv=mono;G[ch].ox=(mono-w)*0.5-ink[0];}
    else    {G[ch].adv=w+H.bear*2;G[ch].ox=H.bear-ink[0];}
    G[ch].n=segsOf(G[ch].s);
  }
  /* THE EM IS MEASURED, NOT ASSUMED. Every piece has to lay these glyphs out,
     and all three of them want ONE scale and ONE baseline across the whole
     alphabet rather than each glyph fitted to its own ink: a key sheet exists
     to be compared across, and an atlas whose cells each found their own scale
     would set text that jumps about. So the alphabet reports the box that
     holds all of it — how far the highest mark reaches above the cap line, how
     far the longest tail goes below the baseline, and the widest advance —
     and the layouts divide by that. A guessed constant here is what makes
     every glyph sit at a third of the size of its cell. */
  let eTop=Infinity,eBot=-Infinity,eAdv=0;
  for(const ch of order){
    const ink=G[ch].ink;
    if(ink[1]<eTop)eTop=ink[1];
    if(ink[3]>eBot)eBot=ink[3];
    if(G[ch].adv>eAdv)eAdv=G[ch].adv;
  }
  const A0={
    H:H,G:G,order:order,key:key,
    em:{top:eTop,bot:eBot,h:Math.max(0.2,eBot-eTop),maxAdv:Math.max(0.1,eAdv)},
    reform:reform,drift:drift,shareN:shareN,ruleNum:ruleNum,
    mono:mono,
    worst:worst,worstPair:worstPair,forcedSolo:forcedSolo,
    /* the thinnest thing anybody has to be able to see. With a broad nib the
       hairline is a fraction of the nominal weight, and it is the hairline
       that decides whether this alphabet survives being 96 px tall. */
    thin:H.wt*(1-H.con*0.80),
    markSize:0.105*2,
    strokes:order.reduce((a,c)=>a+G[c].n,0),
    signs:order.length
  };
  CACHE={key:key,A:A0};
  return A0;
}

/* ============================ drawing a glyph ============================

   The skeleton is geometry; the HAND is what happens when a tool is dragged
   along it. Three things here are the difference between an alphabet and a
   diagram of one.

   CONTRAST IS PER SEGMENT. A broad nib is a line, not a point: a stroke
   drawn across it is as wide as the nib and one drawn along it is as thin as
   the nib is sharp, and everything between follows the sine of the angle
   between them. So a polyline cannot be stroked in one go once contrast is
   asked for — each segment gets its own width. The cost is that joins have
   to be round, which is correct: no pen has ever made a mitre.

   TERMINALS GO ON FREE ENDS ONLY. An endpoint that meets another stroke is a
   joint and decorating it is the single thing that makes invented lettering
   look like decorated line soup. So the ends are worked out first, by
   looking for any other vertex close enough to be the same point.

   A WEDGE IS DEEP AT THE HEAD. In the relief mask it is filled with a
   gradient rather than a flat tone, because a stylus pressed into clay goes
   in at the head and comes out feathering at the tail — which is what makes
   cuneiform read as pressed rather than as drawn triangles. The colour pass
   fills it solid; only the depth tapers. */
function endsOf(s,wt){
  const verts=[],ends=[];
  const add=(p,q)=>{ends.push({p:p,q:q});};
  for(const st of s){
    if(st.k==="L"){
      for(const q of st.p)verts.push(q);
      if(!st.cl&&st.p.length>1){
        add(st.p[0],st.p[1]);
        add(st.p[st.p.length-1],st.p[st.p.length-2]);
      }
    }else if(st.k==="A"){
      const e0=[st.c[0]+Math.cos(st.a0)*st.r,st.c[1]+Math.sin(st.a0)*st.r];
      const e1=[st.c[0]+Math.cos(st.a1)*st.r,st.c[1]+Math.sin(st.a1)*st.r];
      verts.push(e0,e1);
      if(Math.abs(st.a1-st.a0)<TAU-1e-6){
        const i0=lerp(st.a0,st.a1,0.08),i1=lerp(st.a1,st.a0,0.08);
        add(e0,[st.c[0]+Math.cos(i0)*st.r,st.c[1]+Math.sin(i0)*st.r]);
        add(e1,[st.c[0]+Math.cos(i1)*st.r,st.c[1]+Math.sin(i1)*st.r]);
      }
    }else if(st.k==="W"){verts.push(st.p[0],st.p[1]);}
    else if(st.k==="D"){verts.push(st.c);}
  }
  const eps=Math.max(wt*0.7,0.02),e2=eps*eps;
  return ends.filter(e=>{
    let n=0;
    for(const v of verts){
      const dx=v[0]-e.p[0],dy=v[1]-e.p[1];
      if(dx*dx+dy*dy<e2)n++;
    }
    return n<=1;                      /* itself and nothing else */
  });
}

/* the transform from glyph space to the canvas. (x,y) is the left of the
   advance on the BASELINE, `size` is the cap height in canvas units. */
function xformer(x,y,size,H,gl,mirror){
  const tn=Math.tan(H.slant);
  if(mirror)return (px,py)=>[x+(gl.adv-(gl.ox+px)-(1-py)*tn)*size,y+(py-1)*size];
  return (px,py)=>[x+(gl.ox+px+(1-py)*tn)*size,y+(py-1)*size];
}
/* The width this segment gets: the full weight where it runs across the nib,
   a hairline where it runs along it. `ax`/`ay` are a delta in CANVAS units —
   the slant and any mirroring have already been applied, and both change the
   angle a stroke meets the pen at — while `size` is the cap height, which is
   what the weight is a fraction of. Passing 1 for that draws the whole script
   at a fifth of a pixel, which does not look like a thin stroke on screen: it
   looks like the arcs and the stems are missing and only the dots came out. */
function segWidth(H,ax,ay,size){
  const base=H.wt*size;
  if(H.con<0.02)return base;
  const th=Math.atan2(ay,ax);
  const thin=1-H.con*0.80;
  return base*lerp(thin,1,Math.abs(Math.sin(th-H.pen)));
}
function bowTo(g,a,b,bow){
  if(!bow){g.lineTo(b[0],b[1]);return;}
  const mx=(a[0]+b[0])*0.5,my=(a[1]+b[1])*0.5;
  const dx=b[0]-a[0],dy=b[1]-a[1];
  g.quadraticCurveTo(mx-dy*bow,my+dx*bow,b[0],b[1]);
}
function drawGlyphAt(g,gl,H,x,y,size,o){
  o=o||{};
  const T=xformer(x,y,size,H,gl,o.mirror);
  const mask=!!o.mask;
  const flat=H.con<0.02;
  g.lineJoin=flat?H.joint:"round";
  g.lineCap=(H.term==="round"||!flat)?"round":"butt";
  for(const st of gl.s){
    if(st.k==="D"){
      const c=T(st.c[0],st.c[1]);
      g.beginPath();g.arc(c[0],c[1],Math.max(0.35,st.r*size),0,TAU);g.fill();
      continue;
    }
    if(st.k==="W"){
      const a=T(st.p[0][0],st.p[0][1]),b=T(st.p[1][0],st.p[1][1]);
      let dx=b[0]-a[0],dy=b[1]-a[1];
      const len=Math.hypot(dx,dy)||1;
      const nx=-dy/len,ny=dx/len,hw=st.w*0.5*size;
      g.beginPath();
      g.moveTo(a[0]+nx*hw,a[1]+ny*hw);
      g.lineTo(b[0],b[1]);
      g.lineTo(a[0]-nx*hw,a[1]-ny*hw);
      g.closePath();
      if(mask){
        const grd=g.createLinearGradient(a[0],a[1],b[0],b[1]);
        grd.addColorStop(0,"#ffffff");grd.addColorStop(1,"#4a4a4a");
        const was=g.fillStyle;g.fillStyle=grd;g.fill();g.fillStyle=was;
      }else g.fill();
      continue;
    }
    if(st.k==="A"){
      /* an arc has one width unless the pen is being modelled, in which case
         it is swept in steps and each step gets the width of its own tangent */
      if(flat){
        g.lineWidth=segWidth(H,1,0,size);
        g.beginPath();
        const n=Math.max(6,Math.ceil(Math.abs(st.a1-st.a0)/0.20));
        for(let i=0;i<=n;i++){
          const a=lerp(st.a0,st.a1,i/n),p=T(st.c[0]+Math.cos(a)*st.r,st.c[1]+Math.sin(a)*st.r);
          if(i)g.lineTo(p[0],p[1]);else g.moveTo(p[0],p[1]);
        }
        g.stroke();
      }else{
        const n=Math.max(8,Math.ceil(Math.abs(st.a1-st.a0)/0.14));
        for(let i=0;i<n;i++){
          const a0=lerp(st.a0,st.a1,i/n),a1=lerp(st.a0,st.a1,(i+1)/n);
          const p=T(st.c[0]+Math.cos(a0)*st.r,st.c[1]+Math.sin(a0)*st.r);
          const q=T(st.c[0]+Math.cos(a1)*st.r,st.c[1]+Math.sin(a1)*st.r);
          g.lineWidth=segWidth(H,q[0]-p[0],q[1]-p[1],size);
          g.beginPath();g.moveTo(p[0],p[1]);g.lineTo(q[0],q[1]);g.stroke();
        }
      }
      continue;
    }
    const pts=st.p.map(q=>T(q[0],q[1]));
    if(flat){
      g.lineWidth=segWidth(H,1,0,size);
      g.beginPath();g.moveTo(pts[0][0],pts[0][1]);
      for(let i=1;i<pts.length;i++)bowTo(g,pts[i-1],pts[i],st.bow);
      if(st.cl)g.closePath();
      g.stroke();
    }else{
      const seq=st.cl?pts.concat([pts[0]]):pts;
      for(let i=1;i<seq.length;i++){
        g.lineWidth=segWidth(H,seq[i][0]-seq[i-1][0],seq[i][1]-seq[i-1][1],size);
        g.beginPath();g.moveTo(seq[i-1][0],seq[i-1][1]);
        bowTo(g,seq[i-1],seq[i],st.bow);
        g.stroke();
      }
    }
  }
  /* ---- terminals ---- */
  if(H.term==="butt"||H.term==="round")return;
  const ends=gl.ends||(gl.ends=endsOf(gl.s,H.wt));
  g.lineCap="round";g.lineJoin="round";
  for(const e of ends){
    const p=T(e.p[0],e.p[1]),q=T(e.q[0],e.q[1]);
    let dx=p[0]-q[0],dy=p[1]-q[1];
    const len=Math.hypot(dx,dy)||1;
    dx/=len;dy/=len;
    const nx=-dy,ny=dx,w=H.wt*size;
    if(H.term==="dot"){
      g.beginPath();g.arc(p[0],p[1],w*0.95,0,TAU);g.fill();
    }else if(H.term==="serif"){
      g.lineWidth=w*0.72;
      g.beginPath();
      g.moveTo(p[0]+nx*w*1.15,p[1]+ny*w*1.15);
      g.lineTo(p[0]-nx*w*1.15,p[1]-ny*w*1.15);
      g.stroke();
    }else if(H.term==="flag"){
      const a=Math.atan2(dy,dx)+Math.PI*0.62;
      g.lineWidth=w*0.78;
      g.beginPath();g.moveTo(p[0],p[1]);
      g.lineTo(p[0]+Math.cos(a)*w*2.0,p[1]+Math.sin(a)*w*2.0);
      g.stroke();
    }else if(H.term==="barb"){
      const a=Math.atan2(-dy,-dx)+Math.PI*0.28;
      g.lineWidth=w*0.7;
      g.beginPath();g.moveTo(p[0],p[1]);
      g.lineTo(p[0]+Math.cos(a)*w*1.8,p[1]+Math.sin(a)*w*1.8);
      g.stroke();
    }
  }
}

/* ============================ setting a line ============================
   A token is a glyph, a word gap or a line break. Widths are in CAP HEIGHTS
   throughout and the size is applied last, which is what lets the fitter ask
   "how wide is this at any size" once instead of re-measuring per try. */
const WORDGAP=0.34;
function tokensOf(text,A,track){
  const out=[];
  const s=String(text==null?"":text).toUpperCase();
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(ch==="\n"){out.push({br:true});continue;}
    if(ch===" "||ch==="\t"){out.push({sp:true,w:WORDGAP});continue;}
    const gl=A.G[ch];
    if(!gl){out.push({sp:true,w:WORDGAP*0.6});continue;}
    out.push({ch:ch,gl:gl,w:gl.adv+track});
  }
  return out;
}
const runWidth=toks=>toks.reduce((a,t)=>a+(t.w||0),0);
/* greedy break on word boundaries at a width given in cap heights */
function breakRun(toks,maxW){
  const lines=[];
  let line=[],w=0,word=[],ww=0;
  const flushWord=()=>{
    if(!word.length)return;
    if(w>0&&w+ww>maxW){lines.push(line);line=[];w=0;}
    for(const t of word)line.push(t);
    w+=ww;word=[];ww=0;
  };
  for(const t of toks){
    if(t.br){flushWord();lines.push(line);line=[];w=0;continue;}
    if(t.sp){flushWord();if(line.length){line.push(t);w+=t.w;}continue;}
    word.push(t);ww+=t.w;
    /* a single word wider than the measure is broken rather than overset */
    if(ww>maxW&&word.length>1){
      flushWord();
      lines.push(line);line=[];w=0;
    }
  }
  flushWord();
  if(line.length)lines.push(line);
  /* a trailing space on a line is not ink and should not be centred */
  return lines.map(l=>{while(l.length&&l[l.length-1].sp)l.pop();return l;})
              .filter((l,i,all)=>l.length||all.length===1);
}
/* FIT THE BLOCK, do not hope. Binary search on the cap height: at each size
   the measure in cap heights is known, so the break is exact rather than
   approximate, and the answer is the largest size whose block fits both ways. */
function fitBlock(toks,boxW,boxH,lead,maxLines){
  /* NOTHING TO SET FITS AT ANY SIZE, so the search would hand back the whole
     box and the readout would quote a cap height the size of the plate */
  if(!toks||!toks.length)return {size:Math.min(boxW,boxH)*0.2,lines:[]};
  let lo=0.0005,hi=Math.min(boxH,boxW),best=null;
  for(let it=0;it<26;it++){
    const mid=(lo+hi)*0.5;
    const lines=breakRun(toks,boxW/mid);
    const n=Math.max(1,lines.length);
    const wide=lines.reduce((a,l)=>Math.max(a,runWidth(l)),0);
    const fits=(wide*mid<=boxW+1e-6)&&(n*lead*mid<=boxH+1e-6)&&(!maxLines||n<=maxLines);
    if(fits){best={size:mid,lines:lines};lo=mid;}else hi=mid;
  }
  if(!best){
    const lines=breakRun(toks,Math.max(1,boxW/0.02));
    best={size:0.02,lines:lines};
  }
  return best;
}
/* one line of glyphs, with whatever the script does between and across them */
function drawLine(g,line,A,x,y,size,o){
  o=o||{};
  const H=A.H,mirror=!!o.mirror;
  const seq=(o.rtl||mirror)?line.slice().reverse():line;
  const baseY=(H.build==="lobe")?0.88:1.0;
  let px=x,wordStart=null,wordEnd=null;
  const closeWord=()=>{
    if(wordStart===null)return;
    if(H.join==="base"||H.join==="head"){
      const yy=y+((H.join==="head"?0:baseY)-1)*size;
      g.lineCap="butt";g.lineJoin="round";
      g.lineWidth=H.wt*size*(H.join==="head"?1.0:0.9);
      g.beginPath();g.moveTo(wordStart,yy);g.lineTo(wordEnd,yy);g.stroke();
    }
    wordStart=wordEnd=null;
  };
  for(const t of seq){
    if(t.sp){
      closeWord();
      if(H.sep==="dot"){
        g.beginPath();
        g.arc(px+t.w*size*0.5,y-size*0.45,Math.max(0.4,H.wt*size*0.85),0,TAU);
        g.fill();
      }else if(H.sep==="rule"){
        g.lineCap="butt";g.lineWidth=H.wt*size*0.8;
        g.beginPath();
        g.moveTo(px+t.w*size*0.5,y-size*1.02);
        g.lineTo(px+t.w*size*0.5,y+size*0.08);
        g.stroke();
      }
      px+=t.w*size;
      continue;
    }
    if(wordStart===null)wordStart=px;
    drawGlyphAt(g,t.gl,H,px,y,size,{mask:o.mask,mirror:mirror});
    px+=t.w*size;
    wordEnd=px;
  }
  closeWord();
  return px-x;
}

/* ============================ Latin, for the captions ============================
   The key sheet has to print the letter each glyph stands for, and the stroke
   library is the right object for it twice over: a single-stroke gothic is what
   a specification sheet is captioned in, and drawing its own letters is what
   keeps this whole mode on a worker thread. `y` is the CAP TOP, because that is
   the origin the stroke alphabet is drawn from. */
function latin(g,text,x,y,cap,o){
  o=o||{};
  if(!window.ForgeStroke)return 0;
  const GL=ForgeStroke.GLY,ADV=ForgeStroke.ADV,CAP=ForgeStroke.CAP;
  const s=String(text==null?"":text).toUpperCase();
  const u=cap/CAP,track=num(o.track,0);
  const w=ForgeStroke.width(s,track)*u;
  let x0=x;
  if(o.align==="center")x0=x-w*0.5;
  else if(o.align==="right")x0=x-w;
  g.lineWidth=Math.max(0.35,cap*num(o.weight,0.145));
  g.lineCap="round";g.lineJoin="round";
  for(let i=0;i<s.length;i++){
    const gl=GL[s[i]];
    if(!gl)continue;
    const ox=x0+i*(ADV+track)*u;
    for(const pl of gl){
      g.beginPath();
      g.moveTo(ox+pl[0][0]*u,y+pl[0][1]*u);
      for(let k=1;k<pl.length;k++)g.lineTo(ox+pl[k][0]*u,y+pl[k][1]*u);
      g.stroke();
    }
  }
  return w;
}
const latinWidth=(text,cap,track)=>window.ForgeStroke
  ? ForgeStroke.width(String(text||"").toUpperCase(),track||0)*cap/ForgeStroke.CAP : 0;

/* ============================ geometry ============================ */
function rrect(g,x,y,w,h,r){
  r=Math.max(0,Math.min(r,Math.min(w,h)*0.5));
  g.beginPath();
  g.moveTo(x+r,y);
  g.lineTo(x+w-r,y);if(r)g.arcTo(x+w,y,x+w,y+r,r);
  g.lineTo(x+w,y+h-r);if(r)g.arcTo(x+w,y+h,x+w-r,y+h,r);
  g.lineTo(x+r,y+h);if(r)g.arcTo(x,y+h,x,y+h-r,r);
  g.lineTo(x,y+r);if(r)g.arcTo(x,y,x+r,y,r);
  g.closePath();
}

/* ============================ what size it is ============================
   The atlas and the seamless field are TEXTURES and are square powers of two.
   The chart and the plate are OBJECTS with a size in millimetres, so their
   height follows their width at the aspect asked for — and is rounded to a
   multiple of four, because a texture whose height is odd is a texture some
   tool somewhere will pad. */
function sizeOf(P,prevW){
  const piece=str(P.piece,"chart");
  const S=prevW||((P.size|0)||1024);
  if(piece==="atlas"||piece==="field")
    return {piece:piece,TW:S,TH:S,Wmm:0,Hmm:0,mmPerPx:0,dpi:0};
  const Wmm=clamp(num(P.Wmm,360),10,2400),Hmm=clamp(num(P.Hmm,240),10,2400);
  const TH=Math.max(16,Math.round(S*Hmm/Wmm/4)*4);
  return {piece:piece,TW:S,TH:TH,Wmm:Wmm,Hmm:Hmm,
          mmPerPx:Wmm/S,dpi:S/(Wmm/25.4)};
}
/* how many rows of writing a seamless tile holds — a whole number, so the tile
   wraps in the long axis without a half line at the join */
const fieldRows=P=>clamp(Math.round(num(P.rows,6)),1,40);

/* FIT THE ALPHABET — not this glyph — into a box, and give back the scale and
   the baseline every cell then shares. `y` comes back as the BASELINE, which is
   what drawGlyphAt wants. */
function emFit(A,bw,bh){
  const em=A.em;
  const size=Math.min(bw/em.maxAdv,bh/em.h);
  return {size:size,rise:(1-em.top)*size,blockH:em.h*size};
}

/* ============================ the key sheet ============================
   This is the piece everything else depends on. An atlas with no key is a
   texture of shapes; a plate with no key is decoration. So the chart is laid
   out as a specification sheet: a grid of cells, each glyph over the Latin
   character it stands for, the sections in the order somebody would look them
   up, and the inscription set once in each alphabet at the bottom so the whole
   thing can be checked against itself.

   The sections are drawn at ONE cell size across the sheet. Fitting each
   section to its own count gives three different cell sizes and reads as three
   unrelated tables. */
function chartLayout(P,G,A){
  const TW=G.TW,TH=G.TH;
  const m=Math.round(Math.min(TW,TH)*0.045);
  const title=Math.round(TH*0.085);
  const foot=Math.round(TH*0.035);
  const spec=str(P.text,"").trim()?Math.round(TH*0.17):0;
  const gap=Math.round(TH*0.022);
  const caps=bool(P.captions,true);
  /* HOW MANY COLUMNS IS NOT A GUESS. Three sections of 26, 10 and 11 signs
     laid out at one cell size give a different number of rows for every column
     count, and the one that fits the sheet best is not the one nearest square:
     nine columns wastes two thirds of a row twice over, thirteen wastes none.
     So every count is tried and the one that draws the glyphs biggest wins. */
  let best=null;
  for(let cols=6;cols<=18;cols++){
    const secs=[{label:"letters",chars:LETTERS},{label:"figures",chars:DIGITS},
                {label:"points", chars:PUNCT}];
    let rows=0;
    for(const sc of secs){sc.rows=Math.ceil(sc.chars.length/cols);rows+=sc.rows;}
    const gridH=TH-m*2-title-foot-spec-(secs.length-1)*gap;
    if(gridH<20)continue;
    const cellH=gridH/rows,cellW=(TW-m*2)/cols;
    const fit=emFit(A,cellW*0.80,cellH*(caps?0.66:0.84));
    if(!best||fit.size>best.fit.size)
      best={cols:cols,secs:secs,rows:rows,cellH:cellH,cellW:cellW,fit:fit};
  }
  if(!best){
    const secs=[{label:"letters",chars:LETTERS,rows:3},{label:"figures",chars:DIGITS,rows:1},
                {label:"points",chars:PUNCT,rows:1}];
    best={cols:10,secs:secs,rows:5,cellH:Math.max(4,(TH-m*2)/5),cellW:(TW-m*2)/10,
          fit:emFit(A,1,1)};
  }
  return {m:m,cols:best.cols,secs:best.secs,title:title,foot:foot,spec:spec,
          gap:gap,cellW:best.cellW,cellH:best.cellH,fit:best.fit,caps:caps,
          gridTop:m+title};
}
function paintChart(g,P,G,A,mask){
  const Lo=chartLayout(P,G,A),TW=G.TW,TH=G.TH;
  const rule=bool(P.cellRule,true);
  const caps=Lo.caps;
  /* ---- the heading ---- */
  {
    const cap=Lo.title*0.38,sub=cap*0.46,top=Lo.m;
    latin(g,"GLYPH KEY",Lo.m,top,cap,{weight:0.16,track:1.2});
    latin(g,A.H.S.label,Lo.m,top+cap*1.25,sub,{weight:0.16,track:0.6});
    latin(g,(A.reform?"REFORMED LATIN":"INVENTED")+"  SEED "+(P.seed|0),
          TW-Lo.m,top,sub,{align:"right",weight:0.16,track:0.6});
    latin(g,A.order.length+" SIGNS  "+(A.mono?"MONOSPACED":"PROPORTIONAL"),
          TW-Lo.m,top+sub*1.5,sub,{align:"right",weight:0.16,track:0.6});
    const ry=top+cap*1.25+sub*1.6;
    g.lineWidth=Math.max(0.6,TH*0.0022);g.lineCap="butt";
    g.beginPath();g.moveTo(Lo.m,ry);g.lineTo(TW-Lo.m,ry);g.stroke();
  }
  /* ---- the cells ---- */
  let y=Lo.gridTop;
  for(const sec of Lo.secs){
    for(let r=0;r<sec.rows;r++){
      const from=r*Lo.cols,n=Math.min(Lo.cols,sec.chars.length-from);
      /* a part row is CENTRED, because a specification sheet with ten cells in
         one row and six hanging off the left of the next reads as damaged */
      const x0=Lo.m+(TW-Lo.m*2-n*Lo.cellW)*0.5;
      for(let c=0;c<n;c++){
        const ch=sec.chars[from+c],gl=A.G[ch];
        if(!gl)continue;
        const cx=x0+c*Lo.cellW,cy=y+r*Lo.cellH;
        if(rule){
          g.lineWidth=Math.max(0.4,TH*0.0012);g.lineCap="butt";g.lineJoin="miter";
          g.strokeRect(cx,cy,Lo.cellW,Lo.cellH);
        }
        /* one scale and one baseline for the whole sheet, so the cells can be
           compared with each other — which is the only thing a key sheet is
           for. A full point has to come out smaller than an M here. */
        const F=Lo.fit;
        const glyphH=Lo.cellH*(caps?0.66:0.84);
        const bx=cx+(Lo.cellW-gl.adv*F.size)*0.5;
        const by=cy+(glyphH-F.blockH)*0.5+F.rise;
        drawGlyphAt(g,gl,A.H,bx,by,F.size,{mask:mask});
        if(caps){
          const ccap=Lo.cellH*0.17;
          latin(g,ch,cx+Lo.cellW*0.5,cy+Lo.cellH-ccap*1.35,ccap,
                {align:"center",weight:0.17});
        }
      }
    }
    y+=sec.rows*Lo.cellH+Lo.gap;
  }
  /* ---- the specimen: the same words in both alphabets ---- */
  if(Lo.spec){
    const top=TH-Lo.m-Lo.foot-Lo.spec;
    const toks=tokensOf(P.text,A,num(P.track,0.04));
    const fit=fitBlock(toks,TW-Lo.m*2,Lo.spec*0.56,1.45,2);
    let yy=top+fit.size*1.05;
    for(const line of fit.lines){
      const w=runWidth(line)*fit.size;
      drawLine(g,line,A,Lo.m+(TW-Lo.m*2-w)*0.5,yy,fit.size,
               {mask:mask,rtl:A.H.dir==="rtl"});
      yy+=fit.size*1.45;
    }
    const lcap=Math.min(Lo.spec*0.17,TH*0.026);
    latin(g,String(P.text).toUpperCase(),TW*0.5,top+Lo.spec*0.72,lcap,
          {align:"center",weight:0.16,track:0.5});
  }
  /* ---- the footer: what the numbers do, which is not guessable ---- */
  const fcap=Lo.foot*0.44;
  latin(g,"FIGURES: "+(A.ruleNum?NUMNOTE[A.H.num].toUpperCase():"REFORMED LATIN NUMERALS"),
        Lo.m,TH-Lo.m-fcap,Math.min(fcap,TH*0.019),{weight:0.16,track:0.4});
}

/* ============================ the atlas ============================
   Sixteen by sixteen cells, the glyph for code point c in cell (c mod 16,
   c div 16). That is the one layout an engine can work out for itself from
   nothing but the texture's width, which is the point of it — and it is why
   there is no caption, no rule and no margin anywhere on this piece.

   LOWER CASE IS THE SAME GLYPH AS UPPER. The script has no case: there is one
   sign per sound, and an atlas that left a-z empty would break every string
   that was not shouted. */
function atlasCell(code){return {cx:code&15,cy:code>>4};}
function paintAtlas(g,P,G,A,mask){
  const S=G.TW,cell=S/16,pad=clamp(num(P.cellPad,0.10),0,0.3);
  const inH=cell*(1-pad*2);
  const F=emFit(A,cell*(1-pad*2),inH);
  for(let code=33;code<127;code++){
    const raw=String.fromCharCode(code);
    const ch=raw.toUpperCase();
    const gl=A.G[ch];
    if(!gl)continue;
    const c=atlasCell(code);
    const x0=c.cx*cell,y0=c.cy*cell;
    /* ONE SCALE AND ONE BASELINE ACROSS EVERY CELL. An atlas whose cells each
       fitted their own glyph would set text that jumps about, and the advances
       in glyphs.json would mean nothing. */
    drawGlyphAt(g,gl,A.H,x0+(cell-gl.adv*F.size)*0.5,
                y0+cell*pad+(inH-F.blockH)*0.5+F.rise,F.size,{mask:mask});
  }
}

/* ============================ the plate ============================ */
function paintPlate(g,P,G,A,mask){
  const TW=G.TW,TH=G.TH;
  const u=TW/Math.max(1,G.Wmm);                  /* px per mm */
  const inset=clamp(num(P.marginMm,14),0,200)*u;
  const border=bool(P.border,true);
  const translit=bool(P.translit,false);
  let x0=inset,y0=inset,x1=TW-inset,y1=TH-inset;
  if(border){
    const bw=Math.max(1,clamp(num(P.borderMm,2.5),0.2,30)*u);
    g.lineWidth=bw;g.lineJoin="miter";g.lineCap="butt";
    g.strokeRect(x0+bw*0.5,y0+bw*0.5,x1-x0-bw,y1-y0-bw);
    x0+=bw*3;y0+=bw*3;x1-=bw*3;y1-=bw*3;
  }
  const footer=translit?Math.max(8,(y1-y0)*0.14):0;
  const H=A.H;
  const toks=tokensOf(P.text,A,num(P.track,0.04));
  if(H.dir==="ttb"){
    /* columns, right to left, which is what a vertical script does */
    const colW=(x1-x0),cells=toks.filter(t=>!t.br);
    const n=Math.max(1,cells.length);
    const cols=clamp(Math.round(num(P.cols,Math.ceil(n/10))),1,24);
    const per=Math.ceil(n/cols);
    const size=Math.min((y1-y0-footer)/(per*1.25),colW/(cols*1.35));
    for(let c=0;c<cols;c++){
      const cx=x1-(c+0.5)*(colW/cols);
      for(let i=0;i<per;i++){
        const t=cells[c*per+i];
        if(!t||t.sp)continue;
        drawGlyphAt(g,t.gl,H,cx-t.gl.adv*size*0.5,y0+(i+1)*size*1.25,size,{mask:mask});
      }
    }
  }else{
    const lead=clamp(num(P.lead,1.5),1.05,3);
    const fit=fitBlock(toks,x1-x0,y1-y0-footer,lead,clamp(Math.round(num(P.maxLines,6)),1,24));
    const blockH=fit.lines.length*lead*fit.size;
    let yy=y0+(y1-y0-footer-blockH)*0.5+fit.size;
    const bous=H.dir==="bous";
    for(let i=0;i<fit.lines.length;i++){
      const line=fit.lines[i],w=runWidth(line)*fit.size;
      const al=str(P.align,"center");
      const lx=al==="left"?x0:al==="right"?(x1-w):(x0+(x1-x0-w)*0.5);
      drawLine(g,line,A,lx,yy,fit.size,
               {mask:mask,rtl:H.dir==="rtl",mirror:bous&&(i%2===1)});
      yy+=lead*fit.size;
    }
  }
  if(translit){
    const cap=Math.min(footer*0.42,TH*0.03);
    latin(g,String(P.text).toUpperCase(),(x0+x1)*0.5,y1-footer*0.5-cap*0.5,cap,
          {align:"center",weight:0.16,track:0.6});
  }
}

/* ============================ the seamless field ============================
   A wall of writing. The tile wraps because each line holds a WHOLE NUMBER of
   glyphs and is then scaled by a per-cent or two to fill the width exactly —
   which keeps proportional spacing, where setting the whole field on one
   advance would not. Vertically the rows are a whole number by construction.

   Nothing on this piece says anything: the characters are drawn from the
   alphabet at random, with word gaps at the rate English has them, because a
   wall somebody has to be able to read is a plate, not a wall. */
function paintField(g,P,G,A,mask){
  const S=G.TW,rows=fieldRows(P),pitch=S/rows;
  const H=A.H,track=num(P.track,0.04);
  const cap=pitch*clamp(num(P.capFrac,0.60),0.2,0.92);
  const pool=(str(P.fieldFrom,"alphabet")==="text"&&str(P.text,"").trim())
    ?String(P.text).toUpperCase().replace(/[^A-Z0-9.,:;!?\-'()\/ ]/g,"").split("")
    :null;
  for(let r=0;r<rows;r++){
    const rng=rngFor((P.seed|0)+r*7919,"field:"+r);
    const toks=[];
    let wsum=0,guard=0;
    /* fill a bit past the measure, then drop back to the last token that still
       fits inside it — the scale that follows is then a nudge rather than a
       squeeze */
    const want=S/Math.max(1e-6,cap);
    let k=0;
    while(wsum<want&&guard++<4000){
      let ch;
      if(pool)ch=pool[(r*7+k)%pool.length];
      else{
        const n=rng();
        ch=(n<0.14)?" "
          :(n<0.20)?DIGITS[Math.floor(rng()*10)]
          :(n<0.23)?PUNCT[Math.floor(rng()*PUNCT.length)]
          :LETTERS[Math.floor(rng()*26)];
      }
      k++;
      if(ch===" "){toks.push({sp:true,w:WORDGAP});wsum+=WORDGAP;continue;}
      const gl=A.G[ch];
      if(!gl)continue;
      toks.push({ch:ch,gl:gl,w:gl.adv+track});
      wsum+=gl.adv+track;
    }
    while(toks.length>1&&toks[toks.length-1].sp){
      wsum-=toks[toks.length-1].w;toks.pop();
    }
    if(!toks.length)continue;
    const size=S/Math.max(1e-6,wsum);
    const y=(r+clamp(num(P.capFrac,0.60),0.2,0.92)*0.5+0.42)*pitch;
    /* drawn three times: the tile, and once either side, so a glyph that
       straddles the seam is the SAME glyph on both edges rather than two
       halves of different ones */
    for(const off of [-S,0,S])
      drawLine(g,toks,A,off,y,size,{mask:mask,rtl:H.dir==="rtl"});
  }
}

const PAINTERS={chart:paintChart,atlas:paintAtlas,plate:paintPlate,field:paintField};

/* THE ARTWORK IS COVERAGE, NOT COLOUR — one geometry, drawn twice, white both
   times. What colour a mark comes out is a property of the PROCESS and of what
   is under the face, so it is decided per texel in the build where the
   substrate already is, not baked into a raster here. The two passes differ in
   one thing only: the relief pass fills a wedge with a gradient, because a
   stylus goes into clay at the head and feathers out at the tail, and that
   belongs in the height and not in the albedo. */
function paintArt(cv,P,G,A,relief){
  const g=cv.getContext("2d");
  g.clearRect(0,0,cv.width,cv.height);
  if(relief){g.fillStyle="#000";g.fillRect(0,0,cv.width,cv.height);}
  g.fillStyle="#fff";
  g.strokeStyle="#fff";
  g.lineCap="round";g.lineJoin="round";
  (PAINTERS[G.piece]||paintChart)(g,P,G,A,relief);
  return g;
}
/* the blank: what the thing is cut to. The atlas has no blank — its alpha IS
   its ink, which is what a font texture wants — and the seamless field has no
   blank either, because a wall does not end. */
function paintSil(cv,P,G){
  const g=cv.getContext("2d");
  g.clearRect(0,0,cv.width,cv.height);
  if(G.piece==="field"){g.fillStyle="#fff";g.fillRect(0,0,cv.width,cv.height);return;}
  if(G.piece==="atlas")return;
  const u=G.TW/Math.max(1,G.Wmm);
  const r=clamp(num(P.cornerMm,4),0,200)*u;
  g.fillStyle="#fff";
  rrect(g,0,0,G.TW,G.TH,r);
  g.fill();
  const holes=clamp(Math.round(num(P.holes,0)),0,8);
  if(holes>0){
    const d=clamp(num(P.holeMm,6),1,60)*u,inset=clamp(num(P.holeInMm,12),2,200)*u;
    g.globalCompositeOperation="destination-out";
    g.fillStyle="#000";
    const pts=[];
    if(holes<=2){pts.push([inset,G.TH*0.5],[G.TW-inset,G.TH*0.5]);}
    else{pts.push([inset,inset],[G.TW-inset,inset],
                  [inset,G.TH-inset],[G.TW-inset,G.TH-inset]);}
    for(let i=0;i<Math.min(holes,pts.length);i++){
      g.beginPath();g.arc(pts[i][0],pts[i][1],d*0.5,0,TAU);g.fill();
    }
    g.globalCompositeOperation="source-over";
  }
}

/* ============================ the build ============================ */
const GRAIN={speck:0,bed:1,roll:2,tooth:3,smooth:4};
/* does this process leave anywhere for weather to collect */
const inkIsLow=MKp=>MKp.depth!==0;
/* a stretched, directional noise field — mill roll marks, chisel dressing */
function streak(u,v,ang,px,py,seed){
  const c=Math.cos(ang),s=Math.sin(ang);
  return fbm2(u*c-v*s,u*s+v*c,px,py,3,seed);
}
function build(P,io){
  const TW=io.W,TH=io.H,N=TW*TH;
  const G=sizeOf(P);
  /* THE BUFFERS ARE THE SIZE THE RUNTIME ASKED FOR. Recomputing the height
     from the width lands a texel or two off its own earlier answer once a
     capped size has been rounded to a multiple of four, and the artwork would
     then be drawn at a scale the buffers are not. */
  G.TW=TW;G.TH=TH;
  const A=alphabetOf(P),H=A.H;
  const seed=P.seed|0;
  const mat=matOf(P),MKp=markOf(P);
  const piece=G.piece;
  const wrap=piece==="field";

  /* HOW BIG THE THING REALLY IS, in millimetres across the texture. The chart
     and the plate say so themselves. A seamless field is however much wall one
     tile covers. An atlas is not an object at all and has no answer — so it is
     given a notional sheet width, purely so that the relief of a process
     quoted in millimetres means something on it, and the readme says so. */
  const Wmm=G.Wmm>0?G.Wmm
    :wrap?clamp(num(P.tileM,2),0.05,64)*1000
    :200;
  const mmPerPx=Wmm/TW,pxPerMm=TW/Wmm;
  const MM=1/Wmm;                            /* mm -> tile-width units */

  /* ---- rasterise ---- */
  const mk=()=>{const c=document.createElement("canvas");c.width=TW;c.height=TH;return c;};
  const cvC=mk(),cvR=mk(),cvS=mk();
  paintArt(cvC,P,G,A,false);
  paintArt(cvR,P,G,A,true);
  paintSil(cvS,P,G);
  let cd=cvC.getContext("2d",{willReadFrequently:true}).getImageData(0,0,TW,TH).data;
  let rd=cvR.getContext("2d",{willReadFrequently:true}).getImageData(0,0,TW,TH).data;
  let sd=cvS.getContext("2d",{willReadFrequently:true}).getImageData(0,0,TW,TH).data;
  const COV=new Float32Array(N);             /* ink coverage, 0..1 */
  const REL=new Float32Array(N);             /* the same, tapered where pressed */
  const SIL=new Float32Array(N);             /* the blank */
  for(let i=0;i<N;i++){
    const a=cd[i*4+3]/255;
    COV[i]=a;
    REL[i]=rd[i*4]/255;
    SIL[i]=(piece==="atlas")?a:sd[i*4+3]/255;
  }
  /* Three RGBA rasters at 4096 are two hundred megabytes nothing reads again.
     Let them go before the per-texel pass allocates its own. */
  cd=rd=sd=null;
  cvC.width=cvC.height=1;cvR.width=cvR.height=1;cvS.width=cvS.height=1;
  io.progress(0.18);

  const Ab=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N);
  const MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N);
  const ALP=new Uint8ClampedArray(N);
  /* ONE BYTE PER TEXEL. EMI is a single-channel buffer in this runtime — only
     A and NRM are three — and writing RGB into it does not come out wrong in
     an obvious way: it comes out as the glyphs smeared three times as wide and
     wrapped, which reads as a halo of soft discs offset from the thing that
     glows and is easy to blame on the preview. */
  const EMI=new Uint8ClampedArray(N);
  const NRM=new Uint8ClampedArray(N*3);
  const HGT=new Float32Array(N);
  let hMin=0,hMax=1;

  /* ---- the numbers ---- */
  const thick=num(P.thickMm,0)>0?num(P.thickMm,0):mat.thick;
  const md=clamp(num(P.markDepth,1),0,4);
  const bevPx=Math.max(1,Math.round(clamp(num(P.bevelMm,0.6),0,20)*pxPerMm));
  const blur=wrap?(f,r)=>blurWrap(f,TW,r):(f,r)=>blurClamp(f,TW,TH,r);
  const edge=blur(SIL,bevPx);
  /* A SOFT MARK IS A BLURRED MARK, and the lip of a punched one is what the
     blur has that the mark has not — material pushed out to the rim. Both come
     off one pass, which is why they are worked out together. */
  const softPx=Math.max(1,Math.round((0.12+MKp.soft*0.9)*Math.max(1,pxPerMm*0.9)));
  const relS=blur(REL,softPx);
  const rim=blur(SIL,Math.max(2,Math.round(Math.min(10,Wmm*0.05)*pxPerMm)));
  io.progress(0.30);

  const subC=hex2rgb((P.subAuto===false)?str(P.cSub,mat.sub):mat.sub);
  const coreC=hex2rgb(mat.core);
  const ownC=hex2rgb(str(MKp.emit?P.cGlow:P.cInk,MKp.emit?"#7fe3ff":"#101214"));
  const inlayC=hex2rgb(str(P.cInlay,"#b89a4e"));
  const inkC=MKp.ink==="core"?coreC:MKp.ink==="face"?subC
            :(str(P.marking,"incise")==="inlay"?inlayC:ownC);
  const gndC=MKp.ground==="core"?coreC:subC;
  const glowC=hex2rgb(str(P.cGlow,"#7fe3ff"));
  const emit=MKp.emit?clamp(num(P.emitAmt,0.8),0,1):0;
  /* an inlay is a different METAL, not a different colour of the same stone */
  const inkMet=str(P.marking,"incise")==="inlay"?clamp(num(P.inlayMet,0.85),0,1)
              :(MKp.ink==="own"?0.02:mat.met);
  const glossInk=clamp(mat.gloss+MKp.inkGloss,0.02,1);
  const grainK=GRAIN[mat.grain]!==undefined?GRAIN[mat.grain]:0;
  const chip=clamp(num(P.chip,0.25),0,1);
  const grime=clamp(num(P.grime,0.3),0,1);
  const patina=clamp(num(P.patina,0.3),0,1)*mat.patina;
  const abrade=clamp(num(P.abrade,0.2),0,1);
  const fade=clamp(num(P.fade,0.1),0,1);
  const aoStr=clamp(num(P.aoStr,0.8),0,1);
  const patC=hex2rgb(str(P.cPatina,"#6f8f6a"));
  const grainAmt=clamp(num(P.grainAmt,1),0,2);

  /* WHICH NOISE FIELDS ARE ACTUALLY READ. Every one of these is three or four
     octaves of lattice noise per texel, and a build that evaluates all of them
     whatever the sliders say spends most of its time on fields that are then
     multiplied by zero. The flags are hoisted so the branch is predicted once
     rather than guessed at per texel. */
  const wantCoarse=(abrade>0&&MKp.depth>0)||(fade>0&&MKp.ink==="own")||patina>0;
  const wantChip=chip>0&&MKp.depth<0;
  const wantDirt=grime>0||(inkIsLow(MKp)&&MKp.dirt>0);
  const band=Math.max(4,Math.round(49152/TW));
  let y=0;

  function pass1(){
    const end=Math.min(TH,y+band);
    for(;y<end;y++){
      const v=(y+0.5)/TH;
      for(let x=0;x<TW;x++){
        const u=(x+0.5)/TW,i=y*TW+x;
        const sil=SIL[i];
        const e=edge[i];
        const bev=smoothstep(0.28,0.92,e);
        const near=1-smoothstep(0.30,0.98,rim[i]);

        /* ---- the fields that weather it ---- */
        const coarse=wantCoarse?fbm(u,v,5,4,seed+11):0.5;
        const fine=fbm2(u,v,70,70,3,seed+29);
        const dirtN=wantDirt?fbm(u,v,4,4,seed+53):0;
        const chipN=wantChip?fbm2(u,v,40,40,3,seed+71):0;

        /* ---- the mark, after what has happened to it ---- */
        let cov=COV[i];
        let rel=lerp(REL[i],relS[i],MKp.soft);
        /* ABRASION TAKES THE PROUD MARKS FIRST and leaves a recessed one
           alone, which is exactly why anything meant to last was cut IN */
        if(abrade>0&&MKp.depth>0){
          const rub=clamp((coarse-0.42)*2.3,0,1)*(0.4+near*1.2)*abrade;
          cov*=1-rub*0.85;rel*=1-rub*0.85;
        }
        /* chipping eats the arris of the blank and of a cut mark */
        if(wantChip){
          const bite=clamp((chipN-0.52)*2.6,0,1)*chip;
          cov*=1-bite*0.35*near;
        }

        /* ---- the substrate ---- */
        let sr=gndC[0],sg=gndC[1],sb=gndC[2];
        let rough=mat.rough,met=mat.met;
        let tone=0;
        if(grainK===0){                                  /* igneous speckle */
          tone=(fine-0.5)*0.30+(fbm2(u,v,18,18,2,seed+97)-0.5)*0.16;
        }else if(grainK===1){                            /* sedimentary beds */
          tone=(fbm2(u,v,3,26,3,seed+101)-0.5)*0.34;
        }else if(grainK===2){                            /* rolled or brushed */
          tone=(streak(u,v,num(P.grainAng,0)*DEG,3,420,seed+131)-0.5)*0.26;
          rough=clamp(rough+tone*0.5,0.04,1);
        }else if(grainK===3){                            /* sheet fibre */
          tone=(fbm2(u,v,120,96,3,seed+149)-0.5)*0.22;
        }else{
          tone=(fine-0.5)*0.05;
        }
        tone*=grainAmt;
        sr*=1+tone;sg*=1+tone;sb*=1+tone;

        /* ---- put the mark on it ---- */
        let ir=inkC[0],ig=inkC[1],ib=inkC[2];
        if(fade>0&&MKp.ink==="own"){
          /* pigment goes, toward the thing under it rather than toward grey */
          const f=fade*(0.5+0.5*clamp(coarse*1.5-0.3,0,1));
          ir=lerp(ir,sr,f);ig=lerp(ig,sg,f);ib=lerp(ib,sb,f);
        }
        let r=lerp(sr,ir,cov),g0=lerp(sg,ig,cov),b=lerp(sb,ib,cov);
        rough=lerp(rough,clamp(1-glossInk,0.03,1),cov*(MKp.ink==="own"?1:0.45));
        met=lerp(met,inkMet,cov*(MKp.ink==="own"?0.95:0.3));

        /* ---- relief ---- */
        let hmm=thick*bev;
        if(MKp.depth!==0)hmm+=MKp.depth*md*rel*bev;
        if(MKp.lip>0){
          const lip=clamp(relS[i]-REL[i],0,1);
          hmm+=lip*MKp.lip*md*Math.abs(MKp.depth)*1.6*bev;
        }

        /* ---- what gathers in the low places ---- */
        const inLow=(MKp.depth<0)?rel:(MKp.depth>0?clamp(1-rel,0,1)*0.55:0);
        const soil=clamp(dirtN*1.2-0.3,0,1)*grime+inLow*MKp.dirt*(0.18+grime*0.85);
        if(soil>0){
          const dc=0.44+0.2*fine;
          r=lerp(r,r*dc+13,soil*0.85);g0=lerp(g0,g0*dc+12,soil*0.85);
          b=lerp(b,b*dc+10,soil*0.80);
          rough=clamp(lerp(rough,0.92,soil*0.8),0.03,1);
          met*=1-soil*0.65;
        }
        /* PATINA IS NOT DIRT. It is the metal itself turned into something
           else, so it kills the specular and the metalness where it sits —
           which is why a patinated bronze reads as bronze and a dirty one
           reads as bronze with mud on it. */
        if(patina>0){
          const pn=clamp(fbm(u,v,7,4,seed+173)*1.35-0.35,0,1);
          const pw=clamp(pn*(0.35+inLow*1.2+near*0.5),0,1)*patina;
          if(pw>0){
            r=lerp(r,patC[0],pw*0.85);g0=lerp(g0,patC[1],pw*0.85);b=lerp(b,patC[2],pw*0.85);
            rough=clamp(lerp(rough,0.88,pw*0.9),0.03,1);
            met*=1-pw*0.9;
          }
        }

        /* ---- emissive ---- */
        if(emit>0){
          const k=cov*emit;
          EMI[i]=k*255;
          /* lit type is not a dark surface that happens to glow: it reads
             bright in the albedo too, or an unlit target shows it black */
          r=lerp(r,glowC[0],k*0.55);g0=lerp(g0,glowC[1],k*0.55);b=lerp(b,glowC[2],k*0.55);
          rough=lerp(rough,0.35,k);met*=1-k;
        }

        Ab[i*3]=r;Ab[i*3+1]=g0;Ab[i*3+2]=b;
        RGH[i]=clamp(rough,0.03,1)*255;
        MET[i]=clamp(met,0,1)*255;
        HGT[i]=hmm*MM;
        /* A HOLE WITH SOMETHING OVER IT IS NOT A HOLE: on the atlas the alpha
           IS the ink, everywhere else it is the blank, and a mark that
           overhangs the blank is still there. */
        ALP[i]=clamp(piece==="atlas"?cov:Math.max(sil,cov*sil),0,1)*255;
        AOc[i]=255;
      }
    }
    if(y<TH){io.progress(0.30+y/TH*0.45);setTimeout(pass1,0);}
    else{io.progress(0.78);setTimeout(pass2,0);}
  }

  function pass2(){
    hMin=Infinity;hMax=-Infinity;
    for(let i=0;i<N;i++){const h=HGT[i];if(h<hMin)hMin=h;if(h>hMax)hMax=h;}
    if(!(hMax-hMin>1e-9))hMax=hMin+1e-9;
    const b1=blur(HGT,Math.max(1,Math.round(TW*0.004)));
    const span=Math.max(1e-6,hMax-hMin);
    for(let i=0;i<N;i++)
      AOc[i]=clamp(1-clamp((b1[i]-HGT[i])/span*3.2,0,1)*aoStr,0,1)*255;
    io.progress(0.9);

    const gy=P.flipG?-1:1;
    const nStr=clamp(num(P.normalStr,1),0.05,4)*0.5;
    for(let yy=0;yy<TH;yy++){
      const yp=(wrap?((yy+1)%TH):Math.min(TH-1,yy+1))*TW;
      const ym=(wrap?((yy-1+TH)%TH):Math.max(0,yy-1))*TW;
      const y0=yy*TW;
      for(let xx=0;xx<TW;xx++){
        const xp=wrap?((xx+1)%TW):Math.min(TW-1,xx+1);
        const xm=wrap?((xx-1+TW)%TW):Math.max(0,xx-1);
        const dhdu=(HGT[y0+xp]-HGT[y0+xm])*0.5*TW*nStr;
        const dhdv=(HGT[yp+xx]-HGT[ym+xx])*0.5*TW*nStr;
        let nx=-dhdu,ny=-dhdv*gy;
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;
        const i=(y0+xx)*3;
        NRM[i]=(nx*0.5+0.5)*255;NRM[i+1]=(ny*0.5+0.5)*255;NRM[i+2]=(inv*0.5+0.5)*255;
      }
    }
    io.progress(1);
    io.done({A:Ab,NRM:NRM,RGH:RGH,MET:MET,AO:AOc,HGT:HGT,hMin:hMin,hMax:hMax,
             ALP:ALP,EMI:EMI,
             /* what the build actually made, for the readme — a plain object,
                which is the one non-buffer thing that crosses a worker */
             census:{glyphs:A.order.length,strokes:A.strokes,worst:A.worst,
                     worstPair:A.worstPair,forcedSolo:A.forcedSolo,
                     shareN:A.shareN,thin:A.thin,Wmm:Wmm}});
  }

  io.progress(0.04);
  setTimeout(pass1,0);
}

/* ============================ reporting ============================
   WHAT CAP HEIGHT THE GLYPHS ACTUALLY LAND AT, which is the number every
   warning in this mode is about. It differs per piece, and for a plate it is
   whatever the fitter settled on, so it is asked rather than assumed. */
function capPxOf(P,G,A){
  if(G.piece==="atlas"){
    const cell=G.TW/16,pad=clamp(num(P.cellPad,0.10),0,0.3);
    return emFit(A,cell*(1-pad*2),cell*(1-pad*2)).size;
  }
  if(G.piece==="field")
    return (G.TW/fieldRows(P))*clamp(num(P.capFrac,0.60),0.2,0.92);
  if(G.piece==="chart")return chartLayout(P,G,A).fit.size;
  const u=G.TW/Math.max(1,G.Wmm);
  let x0=clamp(num(P.marginMm,14),0,200)*u,y0=x0;
  let x1=G.TW-x0,y1=G.TH-y0;
  if(bool(P.border,true)){
    const bw=Math.max(1,clamp(num(P.borderMm,2.5),0.2,30)*u);
    x0+=bw*3;y0+=bw*3;x1-=bw*3;y1-=bw*3;
  }
  const foot=bool(P.translit,false)?Math.max(8,(y1-y0)*0.14):0;
  if(A.H.dir==="ttb"){
    const n=Math.max(1,tokensOf(P.text,A,0).filter(t=>!t.br).length);
    const cols=clamp(Math.round(num(P.cols,Math.ceil(n/10))),1,24);
    return Math.min((y1-y0-foot)/(Math.ceil(n/cols)*1.25),(x1-x0)/(cols*1.35));
  }
  const fit=fitBlock(tokensOf(P.text,A,num(P.track,0.04)),x1-x0,y1-y0-foot,
                     clamp(num(P.lead,1.5),1.05,3),
                     clamp(Math.round(num(P.maxLines,6)),1,24));
  return fit.size;
}
const PIECEN={chart:"key sheet",atlas:"font atlas",plate:"inscription",field:"field of writing"};

/* ============================ the exported alphabet ============================
   An atlas on its own is a picture of a font. What makes it a font is the
   metrics beside it — which cell holds which code point, how wide each glyph
   actually is — and what makes it a SOURCE is the outlines. So the archive
   carries both, and neither is re-derived from the picture.

   Coordinates are the mode's own: x rightwards from the glyph origin, y DOWN
   from 0 at the cap line to 1 at the baseline, marks between -0.4 and 1.4.
   One number — the cap height — scales the lot. */
function glyphsJSON(P,G,A){
  const H=A.H,r4=n=>Math.round(n*1e4)/1e4;
  const st=s=>s.map(x=>{
    if(x.k==="A")return {k:"arc",c:[r4(x.c[0]),r4(x.c[1])],r:r4(x.r),
                         a0:r4(x.a0),a1:r4(x.a1)};
    if(x.k==="D")return {k:"dot",c:[r4(x.c[0]),r4(x.c[1])],r:r4(x.r)};
    if(x.k==="W")return {k:"wedge",p:x.p.map(q=>[r4(q[0]),r4(q[1])]),w:r4(x.w)};
    return {k:"line",p:x.p.map(q=>[r4(q[0]),r4(q[1])]),
            bow:r4(x.bow||0),closed:!!x.cl};
  });
  const out={
    format:"texture-forge/glyph-1",
    script:{id:H.key,label:H.S.label,construction:H.build,
            origin:A.reform?"reformed-latin":"invented",
            drift:A.reform?r4(A.drift):null,seed:P.seed|0},
    hand:{capHeight:1,strokeWeight:r4(H.wt),contrast:r4(H.con),
          penAngle:r4(H.pen/DEG),slant:r4(H.slant/DEG),curve:r4(H.curve),
          terminal:H.term,joint:H.joint,joining:H.join,
          direction:H.dir,wordSeparator:H.sep,
          monospaced:!!A.mono,advance:A.mono?r4(A.mono):null,
          /* THE MEASURED EM, not a nominal one. This is the box every cell of
             the atlas was laid out on — one scale and one baseline across the
             whole set — so an engine reading the atlas has to divide by this
             and not by a round number, or its text sits at the wrong height. */
          emBox:{top:r4(A.em.top),baseline:1,bottom:r4(A.em.bot),
                 height:r4(A.em.h),widestAdvance:r4(A.em.maxAdv)}},
    numerals:{rule:A.ruleNum?H.num:"reformed-latin",note:A.ruleNum?NUMNOTE[H.num]:null},
    families:FAMILIES.map((F,i)=>({key:F.key,label:F.label,chars:F.chars,
      sharesSkeleton:i<A.shareN})),
    atlas:{grid:16,cellOrder:"codePoint & 15 across, codePoint >> 4 down",
           lowercaseAliasesUppercase:true,
           fit:"scale = min(cellWidth / hand.emBox.widestAdvance, "+
               "cellHeight / hand.emBox.height) after the cell margin; the "+
               "baseline sits (1 - emBox.top) * scale below the glyph area's top"},
    wordGap:WORDGAP,tracking:r4(num(P.track,0.04)),
    glyphs:{}
  };
  for(const ch of A.order){
    const gl=A.G[ch],code=ch.charCodeAt(0),c=atlasCell(code);
    out.glyphs[ch]={
      codePoint:code,atlasCell:[c.cx,c.cy],
      advance:r4(gl.adv),originOffset:r4(gl.ox),segments:gl.n,
      ink:gl.ink.map(r4),
      family:gl.fam||null,familyIndex:(gl.fi===undefined?null:gl.fi),
      mark:gl.mark?{shape:gl.mark.kind,slot:gl.mark.slot}:null,
      ownForm:!!gl.solo,
      strokes:st(gl.s)
    };
  }
  return JSON.stringify(out,null,1);
}
function glyphsSVG(P,G,A){
  const H=A.H,cols=13,CW=120,CH=210,pad=18;
  const n=A.order.length,rows=Math.ceil(n/cols);
  const W=cols*CW+pad*2,HH=rows*CH+pad*2;
  const f=n=>(Math.round(n*100)/100);
  const o=['<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+HH+'" '+
      'viewBox="0 0 '+W+' '+HH+'">',
    '<title>'+H.S.label+' — seed '+(P.seed|0)+'</title>',
    '<desc>One group per glyph, id "glyph-&lt;char&gt;". Stroked centre lines: '+
      'outline them before building a font. Cap height '+CH*0.52+' units, '+
      'baseline at the group origin.</desc>',
    '<rect width="'+W+'" height="'+HH+'" fill="#ffffff"/>',
    '<g fill="none" stroke="#111111" stroke-width="'+f(H.wt*CH*0.52)+'" '+
      'stroke-linecap="'+(H.term==="butt"&&H.con<0.02?"butt":"round")+'" '+
      'stroke-linejoin="round">'];
  const cap=CH*0.52;
  for(let i=0;i<n;i++){
    const ch=A.order[i],gl=A.G[ch];
    const cx=pad+(i%cols)*CW,cy=pad+Math.floor(i/cols)*CH;
    /* the group origin is the BASELINE at the left of the advance, which is
       the origin a font tool expects */
    const ox=cx+(CW-gl.adv*cap)*0.5+gl.ox*cap,oy=cy+CH*0.70;
    o.push('<g id="glyph-'+(ch==="&"?"amp":ch==="<"?"lt":ch===">"?"gt":
                            ch==="'"?"apos":ch)+'" '+
           'transform="translate('+f(ox)+' '+f(oy)+')" '+
           'data-char="'+(ch==="&"?"&amp;":ch==="<"?"&lt;":ch===">"?"&gt;":
                          ch==="'"?"&apos;":ch)+'" '+
           'data-advance="'+f(gl.adv*cap)+'">');
    for(const st of gl.s){
      if(st.k==="D"){
        o.push('<circle cx="'+f(st.c[0]*cap)+'" cy="'+f((st.c[1]-1)*cap)+
               '" r="'+f(st.r*cap)+'" fill="#111111" stroke="none"/>');
      }else if(st.k==="W"){
        const a=st.p[0],b=st.p[1];
        let dx=b[0]-a[0],dy=b[1]-a[1];
        const len=Math.hypot(dx,dy)||1,nx=-dy/len*st.w*0.5,ny=dx/len*st.w*0.5;
        o.push('<path d="M'+f((a[0]+nx)*cap)+','+f((a[1]+ny-1)*cap)+
               ' L'+f(b[0]*cap)+','+f((b[1]-1)*cap)+
               ' L'+f((a[0]-nx)*cap)+','+f((a[1]-ny-1)*cap)+
               ' Z" fill="#111111" stroke="none"/>');
      }else if(st.k==="A"){
        const full=Math.abs(st.a1-st.a0)>=TAU-1e-6;
        if(full){
          o.push('<circle cx="'+f(st.c[0]*cap)+'" cy="'+f((st.c[1]-1)*cap)+
                 '" r="'+f(st.r*cap)+'"/>');
        }else{
          const p0=[st.c[0]+Math.cos(st.a0)*st.r,st.c[1]+Math.sin(st.a0)*st.r];
          const p1=[st.c[0]+Math.cos(st.a1)*st.r,st.c[1]+Math.sin(st.a1)*st.r];
          const large=Math.abs(st.a1-st.a0)>Math.PI?1:0,sweep=st.a1>st.a0?1:0;
          o.push('<path d="M'+f(p0[0]*cap)+','+f((p0[1]-1)*cap)+
                 ' A'+f(st.r*cap)+','+f(st.r*cap)+' 0 '+large+' '+sweep+' '+
                 f(p1[0]*cap)+','+f((p1[1]-1)*cap)+'"/>');
        }
      }else{
        let d="M"+f(st.p[0][0]*cap)+","+f((st.p[0][1]-1)*cap);
        for(let k=1;k<st.p.length;k++){
          const a=st.p[k-1],b=st.p[k];
          if(st.bow){
            const mx=(a[0]+b[0])*0.5,my=(a[1]+b[1])*0.5;
            const ddx=b[0]-a[0],ddy=b[1]-a[1];
            d+=" Q"+f((mx-ddy*st.bow)*cap)+","+f((my+ddx*st.bow-1)*cap)+
               " "+f(b[0]*cap)+","+f((b[1]-1)*cap);
          }else d+=" L"+f(b[0]*cap)+","+f((b[1]-1)*cap);
        }
        if(st.cl)d+=" Z";
        o.push('<path d="'+d+'"/>');
      }
    }
    o.push('</g>');
  }
  o.push('</g>','</svg>');
  return o.join("\n");
}

/* ============================ the mode ============================ */
const DEFTEXT="THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG 1234567890";

Forge.register({
  id:"glyph",
  label:"Glyph",
  group:"Signage",
  threadable:true,                  /* it draws both alphabets itself */
  blurb:"A constructed writing system keyed to English — key sheet, font atlas, inscription or a wall of it",
  title:'Constructed <em>Glyph</em>',
  tagline:"An alphabet per seed · one glyph per Latin character · key sheet · font atlas · SVG and JSON",
  actionLabel:"Cut the glyphs",
  busyLabel:"Cutting…",
  previewSize:384,
  seamless:P=>str(P.piece,"chart")==="field",
  backdrops:P=>str(P.piece,"chart")!=="field",
  preview:{gain:2.6,amb:1.12,specK:0.58,skyLo:[0.16,0.18,0.21],skyHi:[0.34,0.38,0.44]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
    {key:"ao",label:"AO"},{key:"emissive",label:"Emissive"},
    {key:"height",label:"Height"},{key:"orm",label:"ORM packed"},
    {key:"opacity",label:"Opacity"}
  ],

  presets:[
    {id:"stone",label:"Cut in granite",set:{piece:"plate",script:"rune",origin:"alien",
      material:"granite",marking:"incise",Wmm:600,Hmm:300,markDepth:1.2,chip:0.45,
      grime:0.5,abrade:0.1,patina:0.2,bevelMm:1.2,cornerMm:0,border:false,lead:1.6}},
    {id:"key",label:"The key sheet",set:{piece:"chart",script:"lapid",origin:"alien",
      material:"vellum",marking:"print",Wmm:420,Hmm:297,cInk:"#1a1c20",captions:true,
      cellRule:true,chip:0.05,grime:0.08,patina:0,abrade:0.05,cornerMm:2}},
    {id:"atlas",label:"Font atlas",set:{piece:"atlas",script:"circuit",origin:"alien",
      material:"polymer",marking:"print",cInk:"#f4f6f8",cellPad:0.12,chip:0,grime:0,
      patina:0,abrade:0,fade:0}},
    {id:"bronze",label:"Bronze dedication",set:{piece:"plate",script:"lapid",origin:"reform",
      drift:0.3,material:"bronze",marking:"relief",Wmm:500,Hmm:320,patina:0.85,grime:0.5,
      abrade:0.3,chip:0.1,holes:4,border:true,borderMm:4,translit:true}},
    {id:"term",label:"Terminal display",set:{piece:"plate",script:"matrix",origin:"alien",
      material:"panel",marking:"lume",Wmm:320,Hmm:180,cGlow:"#86ffd2",emitAmt:0.9,
      border:false,cornerMm:8,chip:0,grime:0.1,patina:0,abrade:0,align:"left",lead:1.7}},
    {id:"tablet",label:"Clay tablet",set:{piece:"plate",script:"wedge",origin:"alien",
      material:"sand",marking:"punch",Wmm:200,Hmm:260,markDepth:1.4,chip:0.6,grime:0.6,
      abrade:0.15,cornerMm:14,border:false,lead:1.35,maxLines:10}},
    {id:"xeno",label:"Xenoglyph warning",set:{piece:"plate",script:"xeno",origin:"alien",
      material:"steel",marking:"etch",Wmm:300,Hmm:300,grime:0.3,patina:0.1,abrade:0.2,
      border:true,borderMm:3,cornerMm:10,holes:4,famAmt:1}},
    {id:"wall",label:"Wall of writing",set:{piece:"field",script:"seal",origin:"alien",
      material:"conc",marking:"incise",tileM:3,rows:7,capFrac:0.62,chip:0.4,grime:0.55,
      /* a three-metre wall carries letters a quarter of a metre tall, and a
         chisel cut in one of those is centimetres deep, not the two
         millimetres that is right on a plaque you can hold */
      patina:0.3,abrade:0.1,markDepth:5}},
    {id:"reform",label:"Reformed English",set:{piece:"chart",script:"lapid",origin:"reform",
      drift:0.35,material:"alu",marking:"etch",Wmm:420,Hmm:297,famAmt:0.9,
      cInk:"#e8ebee",chip:0.05,grime:0.15,patina:0.05,abrade:0.05}},
    {id:"hand",label:"Cursive on vellum",set:{piece:"plate",script:"flow",origin:"alien",
      material:"vellum",marking:"print",Wmm:260,Hmm:340,cInk:"#2b2114",lead:1.8,
      maxLines:9,chip:0.1,grime:0.2,fade:0.3,patina:0.15,border:false,cornerMm:1}}
  ],
  /* THE INSCRIPTION IS THE USER'S, not the preset's. Clicking through ten
     looks to find one should not retype the words ten times — and the default
     is a pangram, which is the one sentence that exercises the whole alphabet
     on every piece at once. */
  presetKeep:["text"],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"piece",type:"select",label:"Make",value:"chart",options:[
        ["chart","Key sheet — every glyph with its Latin equivalent"],
        ["atlas","Font atlas — 16 x 16 cells by code point"],
        ["plate","Inscription on a surface"],
        ["field","Seamless field of writing"]]},
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,
       options:Forge.sizes("plain")},
      {id:"Wmm",label:"Width",unit:"mm",min:20,max:2400,step:1,value:420,need:"sheet"},
      {id:"Hmm",label:"Height",unit:"mm",min:20,max:2400,step:1,value:297,need:"sheet"},
      {id:"tileM",label:"Tile covers",unit:"m",min:0.25,max:16,step:0.25,value:3,need:"tile"},
      {id:"rows",label:"Lines per tile",min:1,max:24,step:1,value:7,need:"tile"},
      {id:"seed",type:"seed",value:1963},
      {type:"checks",items:[
        {id:"pairCut",label:"Pack the matching key sheet (or atlas) too",value:true}]},
      {type:"readout"},
      {type:"note",html:"The <b>key sheet</b> is what makes the rest mean anything — "+
        "it is the only piece that says which glyph stands for which letter. The archive "+
        "also carries <b>glyphs.json</b> (metrics and outlines) and <b>glyphs.svg</b> "+
        "(one named group per glyph), so the atlas can be used as a real font rather than "+
        "as a picture of one."}
    ]},
    {title:"The script",open:true,rows:[
      {id:"script",type:"select",label:"Writing system",value:"rune",
       options:SCRIPT_KEYS.map(k=>[k,SCRIPTS[k].label])},
      {id:"origin",type:"select",label:"Where it came from",value:"alien",options:[
        ["alien","Invented — owes Latin nothing"],
        ["reform","Reformed — Latin, later"]]},
      {id:"drift",label:"Drift from Latin",min:0,max:1,step:0.01,value:0.5,need:"reform"},
      {id:"famAmt",label:"Related letters share a form",min:0,max:1,step:0.01,value:0.7},
      {id:"complex",label:"Strokes per glyph",min:0,max:1,step:0.01,value:0.5},
      {type:"checks",items:[
        {id:"ruleNum",label:"Digits follow the script's numeral rule",value:true}]},
      {type:"readout",id:"alpha"}
    ]},
    {title:"The hand",rows:[
      {type:"checks",items:[{id:"handAuto",label:"Take the hand from the script",value:true}]},
      {id:"wt",label:"Stroke weight",min:0.03,max:0.30,step:0.005,value:0.115,need:"hand"},
      {id:"con",label:"Pen contrast",min:0,max:1,step:0.01,value:0,need:"hand"},
      {id:"pen",label:"Pen angle",unit:"deg",min:-60,max:60,step:1,value:30,need:"hand"},
      {id:"slant",label:"Slant",unit:"deg",min:-20,max:20,step:0.5,value:0,need:"hand"},
      {id:"curve",label:"Curvature",min:0,max:1,step:0.01,value:0,need:"hand"},
      {id:"aw",label:"Advance width",unit:"cap",min:0.35,max:1.2,step:0.01,value:0.6,need:"hand"},
      {id:"term",type:"select",label:"Terminals",value:"butt",need:"hand",options:[
        ["butt","Square cut"],["round","Rounded"],["serif","Seriffed"],
        ["flag","Flagged"],["dot","Terminal pads"],["barb","Barbed"]]},
      {id:"dir",type:"select",label:"Direction",value:"auto",options:[
        ["auto","The script's own"],["ltr","Left to right"],["rtl","Right to left"],
        ["ttb","Top to bottom, columns right to left"],
        ["bous","Boustrophedon — alternate lines turn back"]]},
      {id:"join",type:"select",label:"Joining",value:"auto",options:[
        ["auto","The script's own"],["none","Letters stand apart"],
        ["base","Joined along the baseline"],["head","Under a headline bar"]]},
      {id:"sep",type:"select",label:"Between words",value:"auto",options:[
        ["auto","The script's own"],["gap","A gap"],["dot","An interpunct"],
        ["rule","A vertical rule"]]},
      {type:"note",html:"<b>Pen contrast</b> is a broad nib: a stroke across it is "+
        "the full weight and one along it is a hairline. It is the single thing that "+
        "makes a script look written rather than drawn — and the readout will tell you "+
        "when the hairline has gone under a texel."}
    ]},
    {title:"The words",open:true,need:["words"],rows:[
      {id:"text",type:"text",label:"Inscription",value:DEFTEXT,
       placeholder:"anything in English",maxlength:220},
      {id:"track",label:"Tracking",unit:"cap",min:-0.05,max:0.4,step:0.01,value:0.04},
      {id:"lead",label:"Line spacing",unit:"cap",min:1.05,max:3,step:0.05,value:1.5,need:"plate"},
      {id:"maxLines",label:"Lines at most",min:1,max:24,step:1,value:6,need:"plate"},
      {id:"align",type:"select",label:"Alignment",value:"center",need:"plate",options:[
        ["center","Centred"],["left","Left"],["right","Right"]]},
      {id:"cols",label:"Columns",min:1,max:24,step:1,value:3,need:"ttb"},
      {id:"capFrac",label:"Cap height of the line",min:0.2,max:0.92,step:0.01,value:0.6,need:"tile"},
      {id:"fieldFrom",type:"select",label:"The field says",value:"alphabet",need:"tile",options:[
        ["alphabet","Nothing — characters at random"],
        ["text","The inscription, over and over"]]},
      {type:"checks",items:[
        {id:"captions",label:"Latin equivalent under each glyph",value:true,need:"chart"},
        {id:"cellRule",label:"Rule the cells",value:true,need:"chart"},
        {id:"translit",label:"Transliteration along the bottom",value:false,need:"plate"}]},
      {id:"cellPad",label:"Cell margin",min:0,max:0.3,step:0.01,value:0.1,need:"atlas"},
      {type:"readout",id:"type"}
    ]},
    {title:"The surface",rows:[
      {id:"material",type:"select",label:"Substrate",value:"granite",
       options:MAT_KEYS.map(k=>[k,MATS[k].name])},
      {id:"marking",type:"select",label:"Process",value:"incise",
       options:MARK_KEYS.map(k=>[k,MARKS[k].name])},
      {id:"markDepth",label:"Process depth",min:0,max:8,step:0.05,value:1},
      {id:"thickMm",label:"Thickness (0 follows the substrate)",unit:"mm",
       min:0,max:120,step:0.5,value:0},
      {id:"bevelMm",label:"Edge bevel",unit:"mm",min:0,max:20,step:0.1,value:0.6,need:"sheet"},
      {id:"cornerMm",label:"Corner radius",unit:"mm",min:0,max:120,step:1,value:4,need:"sheet"},
      {id:"marginMm",label:"Margin",unit:"mm",min:0,max:200,step:1,value:14,need:"plate"},
      {id:"borderMm",label:"Border rule",unit:"mm",min:0.2,max:30,step:0.1,value:2.5,need:"plate"},
      {id:"holes",label:"Fixing holes",min:0,max:4,step:2,value:0,need:"sheet"},
      {id:"holeMm",label:"Hole diameter",unit:"mm",min:1,max:60,step:0.5,value:8,need:"sheet"},
      {id:"holeInMm",label:"Hole inset",unit:"mm",min:2,max:200,step:1,value:16,need:"sheet"},
      {id:"grainAmt",label:"Surface grain",min:0,max:2,step:0.05,value:1},
      {id:"grainAng",label:"Grain direction",unit:"deg",min:0,max:180,step:1,value:0},
      {type:"checks",items:[
        {id:"border",label:"Border rule round the inscription",value:true,need:"plate"},
        {id:"subAuto",label:"Substrate colour follows the material",value:true}]},
      {type:"colors",label:"Substrate · ink · inlay · glow",items:[
        {id:"cSub",value:"#555a5e"},{id:"cInk",value:"#101214"},
        {id:"cInlay",value:"#b89a4e"},{id:"cGlow",value:"#7fe3ff"}]},
      {id:"inlayMet",label:"Inlay metalness",min:0,max:1,step:0.01,value:0.85,need:"inlay"},
      {id:"emitAmt",label:"Glow",min:0,max:1,step:0.01,value:0.8,need:"lume"},
      {type:"note",html:"<b>Carved in relief</b> is the one process that is not the "+
        "others inverted: it does not cut the letter, it cuts the <i>ground</i> away and "+
        "leaves the letter standing on the original face — so the letter is the face and "+
        "the ground is fresh material, the opposite way round from an incised one."}
    ]},
    {title:"Weathering",rows:[
      {id:"chip",label:"Chipped arris",min:0,max:1,step:0.01,value:0.25},
      {id:"grime",label:"Grime",min:0,max:1,step:0.01,value:0.3},
      {id:"patina",label:"Patina",min:0,max:1,step:0.01,value:0.3},
      {id:"abrade",label:"Abrasion",min:0,max:1,step:0.01,value:0.2},
      {id:"fade",label:"Ink fade",min:0,max:1,step:0.01,value:0.1},
      {type:"colors",label:"Patina",items:[{id:"cPatina",value:"#6f8f6a"}]},
      {type:"note",html:"Abrasion takes the <b>proud</b> marks first and leaves a "+
        "recessed one alone, which is exactly why anything meant to last was cut in. "+
        "Patina is not grime: it is the material itself turned into something else, so "+
        "it takes the metalness with it."}
    ]},
    {title:"Maps",rows:[
      {id:"normalStr",label:"Normal strength",min:0.05,max:4,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:0.8},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  needs:function(P){
    const piece=str(P.piece,"chart"),out=[piece];
    if(piece==="chart"||piece==="plate")out.push("sheet");
    if(piece!=="atlas")out.push("words");
    if(piece==="field")out.push("tile");
    if(str(P.origin,"alien")==="reform")out.push("reform");
    if(!bool(P.handAuto,true))out.push("hand");
    const mk=str(P.marking,"incise");
    if(mk==="inlay")out.push("inlay");
    if(mk==="lume")out.push("lume");
    if(piece==="plate"){
      const S=scriptOf(P),d=str(P.dir,"auto")==="auto"?S.dir:str(P.dir,S.dir);
      if(d==="ttb")out.push("ttb");
    }
    return out;
  },

  readout:function(P){
    const G=sizeOf(P),A=alphabetOf(P);
    const cap=capPxOf(P,G,A);
    const thin=A.thin*cap,mark=A.markSize*cap;
    const bits=[PIECEN[G.piece]+" · "+G.TW+" × "+G.TH+" px"];
    if(G.Wmm>0)bits.push(G.Wmm.toFixed(0)+" × "+G.Hmm.toFixed(0)+" mm at "+
      Math.round(G.dpi)+" dpi");
    if(G.piece==="field")bits.push(clamp(num(P.tileM,3),0.25,16).toFixed(2)+" m across · "+
      fieldRows(P)+" lines");
    if(G.piece==="atlas")bits.push("cell "+(G.TW/16).toFixed(0)+" px");
    bits.push("cap height "+cap.toFixed(1)+" px");
    /* WARN WHEN THE RESOLUTION CANNOT HOLD IT rather than showing mush. Two
       numbers matter and they are not the same number: the thinnest stroke the
       hand draws, and the mark that tells one family member from another. */
    const warn=[];
    if(thin<1.2)warn.push("the thinnest stroke is "+thin.toFixed(2)+
      " px — under a texel, so it will break up");
    else if(thin<2)warn.push("thinnest stroke "+thin.toFixed(2)+" px");
    if(A.shareN>0&&mark<2)warn.push("the family marks are "+mark.toFixed(2)+
      " px — too small to tell relatives apart");
    return bits.join(" · ")+(warn.length?'<br><b style="color:#d88">'+
      warn.join(" · ")+"</b>":"");
  },
  readouts:{
    alpha:function(P){
      const A=alphabetOf(P);
      const shared=FAMILIES.slice(0,A.shareN);
      const out=[A.order.length+" signs · "+A.strokes+" segments · "+
        (A.mono?"monospaced":"proportional")];
      out.push(A.shareN?(A.shareN+" of "+FAMILIES.length+" families share a skeleton: "+
        shared.map(F=>F.chars.split("").join("·")).join(", ")):
        "every letter its own form");
      if(A.forcedSolo)out.push(A.forcedSolo+" member"+(A.forcedSolo>1?"s":"")+
        " left the family to stay distinct");
      out.push("digits: "+(A.ruleNum?NUMNOTE[A.H.num]:"reformed Latin numerals"));
      out.push("closest pair "+A.worstPair+" at "+(A.worst*100).toFixed(1)+
        "% of the confusability limit");
      return out.join("<br>");
    },
    type:function(P){
      const G=sizeOf(P),A=alphabetOf(P);
      if(G.piece==="atlas")
        return "code point c in cell (c mod 16, c div 16) · a-z draw the same glyph as A-Z · "+
               "33 to 126 filled where the alphabet has a sign";
      if(G.piece==="field")
        return "each line holds a whole number of glyphs and is scaled to the tile width, "+
               "so the seam falls between glyphs rather than through one";
      const toks=tokensOf(P.text,A,num(P.track,0.04));
      const n=toks.filter(t=>!t.sp&&!t.br).length;
      const miss=[];
      for(const ch of String(P.text||"").toUpperCase())
        if(ch!==" "&&ch!=="\n"&&!A.G[ch]&&miss.indexOf(ch)<0)miss.push(ch);
      const cap=capPxOf(P,G,A);
      return n+" glyphs set at "+cap.toFixed(1)+" px cap"+
        (G.Wmm>0?" ("+(cap*G.mmPerPx).toFixed(1)+" mm)":"")+
        (miss.length?' · <b style="color:#d88">no sign for '+miss.join(" ")+
          " — set as a gap</b>":"");
    }
  },
  sizeTag:function(P){
    const G=sizeOf(P);
    return G.Wmm>0?(G.Wmm.toFixed(0)+"×"+G.Hmm.toFixed(0)+" mm")
      :G.piece==="field"?(clamp(num(P.tileM,3),0.25,16).toFixed(2)+" m tile")
      :"atlas";
  },
  tileTag:function(P){
    const A=alphabetOf(P);
    return A.H.S.label+" · "+(A.reform?"reformed":"invented")+" · "+A.order.length+" signs";
  },

  /* AN ATLAS AND ITS KEY ARE ONE DELIVERABLE. Nobody wants the texture without
     the sheet that says what is on it, or the sheet without the texture, and
     forging one, exporting, switching the piece and exporting again is four
     steps to get two files that describe the same alphabet. */
  variants:function(P){
    if(!bool(P.pairCut,true))return [];
    const piece=str(P.piece,"chart");
    if(piece==="atlas")return [{id:"chart",label:"the key sheet",set:{piece:"chart"}}];
    if(piece==="chart")return [{id:"atlas",label:"the font atlas",set:{piece:"atlas"}}];
    return [{id:"chart",label:"the key sheet",set:{piece:"chart"}}];
  },
  variantRoot:function(P){
    const piece=str(P.piece,"chart");
    return {id:piece,label:PIECEN[piece]};
  },

  size:function(P,preview){
    const G=sizeOf(P,preview?384:0);
    return {w:G.TW,h:G.TH};
  },
  build:build,

  /* THE GLOW IS THE COLOUR SOMEBODY CHOSE. The runtime's default emissive
     writer puts a fixed warm ramp over the intensity, which is right for a
     mode whose glow is a filament and wrong for one whose glow is whatever
     the panel was wired with — so the colour is applied here. The unlit bake
     reads this rather than the default ramp, so a cyan panel bakes cyan; the
     cost is that this channel falls back to the CPU path, since the GPU
     packer cannot know what a mode's own writer does. */
  writers:function(B,P){
    const c=hex2rgb(str(P.cGlow,"#7fe3ff"));
    const r=c[0]/255,g=c[1]/255,b=c[2]/255;
    return {emissive:function(i,o,k){
      const e=B.EMI[i];
      o[k]=e*r;o[k+1]=e*g;o[k+2]=e*b;
      return 255;
    }};
  },

  /* metres, always. An atlas is not an object and says so by declaring
     nothing — the runtime then gives it a one-metre square and the model
     readme admits it guessed, which is the honest answer. */
  plan:function(P){
    const G=sizeOf(P);
    if(G.piece==="atlas")return null;
    if(G.piece==="field"){
      const t=clamp(num(P.tileM,3),0.25,16);
      return {w:t,h:t,tile:t};
    }
    return {w:G.Wmm/1000,h:G.Hmm/1000,cutout:true};
  },

  fileBase:function(P,W){
    return "glyph_"+str(P.script,"rune")+"_"+str(P.piece,"chart")+"_"+(P.seed|0)+"_"+W;
  },

  /* THE ALPHABET TRAVELS WITH THE PICTURE. An atlas without its metrics is a
     texture of shapes, so the archive carries the cell map, the advances and
     the outlines as data, generated from the same alphabetOf() the build drew
     from rather than from a second idea of it. */
  extras:function(P,info){
    const G=sizeOf(P,info&&info.W?info.W:0);
    if(info&&info.W){G.TW=info.W;G.TH=info.H;}
    const A=alphabetOf(P);
    return [{name:"glyphs.json",text:glyphsJSON(P,G,A)},
            {name:"glyphs.svg", text:glyphsSVG(P,G,A)}];
  },

  readme:function(P,info){
    const G=sizeOf(P,info.W);
    G.TW=info.W;G.TH=info.H;
    const A=alphabetOf(P),H=A.H;
    const mat=matOf(P),MKp=markOf(P);
    const cen=info.census||{};
    const cap=capPxOf(P,G,A);
    const Wmm=cen.Wmm||(G.Wmm>0?G.Wmm:200);
    const relief=(info.hMax-info.hMin)*Wmm;
    const out=["Texture Forge · glyph — "+H.S.label,
      "",
      "Seed "+(P.seed|0)+"   Texture "+info.W+" x "+info.H+" px   Piece: "+PIECEN[G.piece],
      ""];
    out.push("THE SCRIPT",
      H.S.note,
      "",
      "Construction: "+H.build+".  Origin: "+(A.reform
        ?("a reform of Latin, drifted "+Math.round(A.drift*100)+" per cent — the glyphs "+
          "start from the single-stroke Latin skeleton and lose strokes, snap onto this "+
          "script's lattice, take its idiom, and turn over")
        :"invented; it owes Latin nothing but the sound each sign stands for")+".",
      "Hand: stroke weight "+H.wt.toFixed(3)+" cap heights, contrast "+H.con.toFixed(2)+
        " at a pen angle of "+Math.round(H.pen/DEG)+" degrees, slant "+
        (H.slant/DEG).toFixed(1)+" degrees, "+H.term+" terminals.",
      (A.mono?("Monospaced on an advance of "+A.mono.toFixed(3)+" cap heights.")
             :"Proportional: each glyph is as wide as its own ink plus a side bearing."),
      "Set "+({ltr:"left to right",rtl:"right to left",ttb:"in columns, top to bottom, "+
        "columns running right to left",bous:"boustrophedon — every second line turns "+
        "back and its glyphs are mirrored"}[H.dir]||H.dir)+
        ", words separated by "+({gap:"a gap",dot:"an interpunct",
          rule:"a vertical rule"}[H.sep]||H.sep)+
        (H.join==="none"?"."
         :H.join==="base"?", letters joined along the baseline within a word."
         :", a headline bar running across each whole word."),
      "");
    out.push("ONE SIGN PER LATIN CHARACTER",
      A.order.length+" signs: the 26 letters, the 10 digits and "+PUNCT.length+
        " points ("+PUNCT.split("").join(" ")+").",
      "The script has no case — lower case draws the same glyph as upper.",
      "");
    if(A.shareN>0){
      out.push("FAMILIES",
        "Related sounds share a skeleton and differ by a mark, and the member you write",
        "most often is the one with nothing added — which is how every writing system",
        "that was reformed on purpose has done it. "+A.shareN+" of "+FAMILIES.length+
          " families share here:");
      for(let i=0;i<A.shareN;i++){
        const F=FAMILIES[i];
        const parts=F.chars.split("").map((ch,k)=>{
          const gl=A.G[ch];
          if(k===0)return ch+" (bare)";
          if(gl&&gl.solo)return ch+" (own form — no mark kept it distinct)";
          return ch+(gl&&gl.mark?" ("+gl.mark.kind+" "+gl.mark.slot+")":"");
        });
        out.push("  "+F.label+": "+parts.join(", "));
      }
      out.push("");
    }else out.push("FAMILIES","Switched off: every letter has its own form.","");
    out.push("FIGURES",
      A.ruleNum?("The digits are a rule, not a set of shapes — "+NUMNOTE[H.num]+".")
               :"The digits are reformed Latin numerals.",
      "Zero is a different kind of sign in every case, because a mark meaning none was",
      "invented separately everywhere it was invented at all.",
      "");
    out.push("NO TWO SIGNS ARE THE SAME SIGN",
      "Every candidate glyph was rasterised and compared against every sign already in",
      "the alphabet, and against its mirror and its half turn as well. The closest pair",
      "in this alphabet is "+(cen.worstPair||A.worstPair)+", at "+
        ((cen.worst||A.worst)*100).toFixed(1)+" per cent of the limit.",
      (A.forcedSolo?(A.forcedSolo+" family member(s) could not be made distinct by any mark "+
        "and took their own form instead."):"Every family member stayed in its family."),
      "");
    if(G.piece==="atlas"){
      out.push("THE ATLAS",
        "16 x 16 cells of "+(info.W/16).toFixed(0)+" px. The glyph for code point c is in",
        "cell (c mod 16) across, (c div 16) down, measured from the top left — so 'A' (65)",
        "is column 1, row 4. Code points 33 to 126 are filled wherever the alphabet has a",
        "sign for them; the rest are empty, and space (32) is empty by definition.",
        "Lower case aliases upper case.",
        "",
        "The ink is the OPACITY channel: alpha is coverage, so use opacity.png (or the",
        "alpha of a composited RGBA) as the glyph mask and ignore the relief channels",
        "unless you want the atlas itself to look carved.",
        "glyphs.json carries the per-glyph advance, which is what makes the atlas",
        "proportional rather than a grid of equal boxes. Multiply it by your cap height.",
        "",
        "An atlas is not an object, so it has no real size. The relief below was computed",
        "against a notional "+Wmm.toFixed(0)+" mm sheet purely so the millimetres mean",
        "something; model.gltf is a guessed one-metre square and the model readme says so.",
        "");
    }else if(G.piece==="field"){
      out.push("THE FIELD",
        "Seamless in both axes at "+clamp(num(P.tileM,3),0.25,16).toFixed(2)+
          " m across, "+fieldRows(P)+" lines per tile.",
        "Each line holds a whole number of glyphs and is then scaled by a per cent or two",
        "to fill the tile width exactly, so the seam falls between two glyphs rather than",
        "through the middle of one — and proportional spacing survives, which setting the",
        "whole field on one advance would not.",
        (str(P.fieldFrom,"alphabet")==="text"
          ?"The field repeats the inscription."
          :"The field says nothing: characters are drawn at random, with word gaps at "+
           "about the rate English has them."),
        "");
    }else{
      out.push("THE "+(G.piece==="chart"?"KEY SHEET":"INSCRIPTION"),
        G.Wmm.toFixed(1)+" x "+G.Hmm.toFixed(1)+" mm — "+Math.round(G.dpi)+
          " dpi, one texel is "+G.mmPerPx.toFixed(4)+" mm.",
        "Scale your plane to that and every dimension on it is the dimension it was drawn",
        "at. The alpha channel is the blank: outside the cut line, and inside any fixing",
        "hole, it is transparent.",
        "Cap height "+cap.toFixed(1)+" px = "+(cap*G.mmPerPx).toFixed(2)+" mm.",
        "");
      if(G.piece==="chart")out.push(
        "This is the key. Every glyph is printed over the Latin character it stands for,",
        "the figures and points follow the letters, and the inscription is set once in",
        "each alphabet at the bottom so the sheet can be checked against itself.","");
      else out.push("The inscription reads: "+JSON.stringify(String(P.text||"")),"");
    }
    out.push("THE SURFACE",
      "Substrate: "+mat.name+", "+(num(P.thickMm,0)>0?num(P.thickMm,0):mat.thick).toFixed(2)+
        " mm thick.",
      "Process: "+MKp.name+(MKp.depth!==0
        ?(", leaving the marks "+Math.abs(MKp.depth*clamp(num(P.markDepth,1),0,4)).toFixed(2)+
          " mm "+(MKp.depth<0?"into":"proud of")+" the face")
        :", level with the face")+".",
      "The mark takes the colour of "+({core:"what the tool found under the face",
        face:"the face itself",own:"the material the process brought with it"}[MKp.ink])+
        ", and the ground is "+({core:"fresh material, because relief carving cuts the "+
          "ground away rather than the letter",face:"the face"}[MKp.ground])+".",
      "Total relief in this build: "+relief.toFixed(3)+" mm.",
      "");
    out.push("FILES",
      "basecolor.png  sRGB albedo.",
      "normal.png     Tangent space, "+info.normalNote+".",
      "roughness.png  Linear grey.",
      "metallic.png   Linear grey.",
      "ao.png         Linear grey ambient occlusion.",
      "emissive.png   "+(MKp.emit?"The lit marks.":"Black — nothing here glows."),
      "height.png     Linear grey, 0-1 spanning "+(info.hMax-info.hMin).toFixed(5)+
        " in texture-width units ("+relief.toFixed(3)+" mm).",
      "height16.png   The same field at 16 bits — use this one.",
      "orm.png        R = AO, G = roughness, B = metallic.",
      "opacity.png    "+(G.piece==="atlas"?"The ink itself — this is the glyph mask."
        :G.piece==="field"?"Flat white: a field of writing has no cut line."
        :"The blank: the cut line and any fixing holes."),
      "glyphs.json    The alphabet as data: the hand, the families, the numeral rule, and",
      "               per glyph the code point, atlas cell, advance, ink box, which family",
      "               it is in, what mark it wears and its strokes.",
      "glyphs.svg     The same outlines as vectors, one named group per glyph, baseline at",
      "               the group origin. Centre lines, so outline the strokes before",
      "               building a font from them.");
    return out.join("\n");
  }
});

/* what the tests reach for */
window.ForgeGlyph={
  SCRIPTS:SCRIPTS,SCRIPT_KEYS:SCRIPT_KEYS,MATS:MATS,MARKS:MARKS,FAMILIES:FAMILIES,
  LETTERS:LETTERS,DIGITS:DIGITS,PUNCT:PUNCT,FREQ:FREQ,NUMNOTE:NUMNOTE,
  handOf:handOf,alphabetOf:alphabetOf,sigOf:sigOf,diffOf:diffOf,tooClose:tooClose,
  MIN_DIFF:MIN_DIFF,MIN_FLIP:MIN_FLIP,DIG_DIFF:DIG_DIFF,
  BUILDERS:BUILDERS,inkOf:inkOf,numeralOf:numeralOf,reformOf:reformOf,
  sizeOf:sizeOf,capPxOf:capPxOf,atlasCell:atlasCell,fieldRows:fieldRows,
  tokensOf:tokensOf,breakRun:breakRun,fitBlock:fitBlock,runWidth:runWidth,
  glyphsJSON:glyphsJSON,glyphsSVG:glyphsSVG,chartLayout:chartLayout
};

})();
