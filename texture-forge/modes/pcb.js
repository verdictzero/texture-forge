/* =====================================================================
   MODE: pcb — printed circuit board
   =====================================================================
   A populated circuit board, built the way a board is actually built:
   a LAMINATE, etched COPPER on top of it, a SOLDER MASK over the copper
   with openings only where something has to be soldered, a SILKSCREEN
   legend printed over the mask, a surface FINISH in the openings, and
   components sitting on that with a solder fillet at every lead.

   That stack is the whole mode, and it is why the maps come out looking
   like a board rather than like a green plane with squiggles on it:

     · mask over copper is not the same colour as mask over laminate.
       The mask is a thin translucent film; over a trace it reads lighter
       and warmer, over bare laminate darker and greener. Every real
       photograph of a green board shows the tracks THROUGH the mask, and
       a mode that paints the mask flat loses all of it.
     · the glass cloth shows through. FR-4 is woven E-glass in epoxy, and
       the weave of the style it was pressed from (7628, 2116, 1080 — the
       table below is real yarn pitches) reads as a faint crosshatch in
       the height and the colour. It is the single detail that says
       "laminate" rather than "plastic".
     · a pad is a HOLE IN THE MASK, not a shape on top of it. So the pad
       sits in a well, the finish in it is a different material from
       everything around it, and the solder standing in that well is
       proud of the mask rather than level with it.
     · silkscreen is clipped off mask openings. Ink on a pad is a
       solderability defect and every fab clips it, so the legend here is
       masked by the openings the way a real gerber set is.

   WHAT MAKES IT READ AS A DESIGNED BOARD, not as noise:

     regions      A board is not a uniform scatter. There is a core IC
                  with a ring of decoupling capacitors two millimetres
                  off its body, a memory bank that is N IDENTICAL parts
                  at ONE pitch on ONE line, a power corner with the bulk
                  capacitors and the inductor, a crystal within a few
                  millimetres of the part it clocks, and connectors on
                  the edge facing out. Placement here does all of that
                  explicitly; the scatter is only what fills the gaps.
     bundles      Signals leave a big package as a BUNDLE — n traces at
                  one pitch, turning together, at 45 degrees, never at an
                  acute angle. One trace wandering on its own is a board
                  nobody laid out.
     fan-out      Every pad that is not on a bundle gets a stub to a via,
                  because that is what the field around a fine-pitch part
                  looks like from above, and it is most of the texture.
     the pour     Copper you do not use is left as a plane, pulled back
                  from the board edge, with the clearance etched around
                  every trace and pad and a stitching via every few
                  millimetres. The clearance is drawn the way a fab draws
                  it — the plane, then the anti-pads punched out of it,
                  then the tracks put back.

   DESIGN RULES ARE THE UNITS. Trace width and clearance are in mils
   because that is what a fab quotes; 8/8 is cheap, 6/6 is standard,
   4/4 wants a better process, 3/3 is advanced. Copper weight is in
   ounces per square foot and the table converts it to microns properly
   (1 oz = 1.37 mil = 34.8 um). Land patterns are IPC-7351 nominal, drill
   sizes are what you would order, and the readout says in texels what
   every one of those numbers came out as — because a 0.15 mm trace on a
   100 mm board at 1024 px is one and a half texels and you should be
   told rather than shown mush.

   THREE PIECES from one generator: a whole board (cut-out, alpha is the
   outline), a production panel (boards in a frame on breakaway tabs,
   with tooling holes and fiducials), and a seamless field of board
   interior for greebling something large.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      hashi=Forge.hashi,fbm=Forge.fbm,fbm2=Forge.fbm2,vnoise2=Forge.vnoise2,
      hex2rgb=Forge.hex2rgb,blurClamp=Forge.blurClamp,blurWrap=Forge.blurWrap,
      mulberry32=Forge.mulberry32;

const num=(v,d)=>{const n=+v;return isFinite(n)?n:d;};
const str=(v,d)=>(v===undefined||v===null||v==="")?d:String(v);
const bool=(v,d)=>(v===undefined||v===null)?d:!!v;
const MIL=0.0254;                     /* one thousandth of an inch, in mm */

/* ============================ the laminate ============================

   `weave` is the yarn pitch of the glass cloth style the panel was
   pressed from, in millimetres, warp and fill. Those are real: style
   7628 runs 44 warp and 32 fill ends per inch, which is 0.577 and 0.794
   mm; 2116 is 60 x 58, and 1080 is 60 x 47. A thin board is pressed from
   thin cloth, so the weave you can see is finer on a thin board — which
   is why this is a property of the laminate rather than a slider.

   `er` is the dielectric constant. It does nothing to the picture; it is
   there because it is the number somebody choosing between these would
   actually be choosing on, and the readme quotes it. */
const LAM={
  fr4  :{id:"fr4",  label:"FR-4 glass-epoxy",      col:"#c4ac6b",thick:1.60,weave:[0.577,0.794],er:4.50,rgh:0.62,trans:0.10},
  fr4tg:{id:"fr4tg",label:"FR-4 high-Tg (170 C)",  col:"#b9a464",thick:1.60,weave:[0.577,0.794],er:4.40,rgh:0.60,trans:0.10},
  fr4th:{id:"fr4th",label:"FR-4, 0.8 mm thin",     col:"#c9b479",thick:0.80,weave:[0.423,0.538],er:4.50,rgh:0.62,trans:0.16},
  cem1 :{id:"cem1", label:"CEM-1 paper-epoxy",     col:"#d6c69c",thick:1.55,weave:null,          er:4.70,rgh:0.72,trans:0.04},
  poly :{id:"poly", label:"Polyimide flex",         col:"#9c6516",thick:0.13,weave:null,          er:3.40,rgh:0.35,trans:0.42},
  ims  :{id:"ims",  label:"Aluminium-backed IMS",   col:"#cfd2d4",thick:1.00,weave:null,          er:4.00,rgh:0.48,trans:0.00},
  alum :{id:"alum", label:"Alumina ceramic",        col:"#e6e3da",thick:0.635,weave:null,         er:9.80,rgh:0.55,trans:0.02},
  ptfe :{id:"ptfe", label:"PTFE / RF laminate",     col:"#a9713f",thick:0.762,weave:[0.62,0.83],  er:3.48,rgh:0.50,trans:0.08}
};
const LAM_KEYS=["fr4","fr4tg","fr4th","cem1","poly","ims","alum","ptfe"];

/* ============================ solder mask ============================
   Liquid photoimageable mask. `a` is what it does to what is under it —
   it is a translucent film, so the base colour here is what it multiplies
   the copper and the laminate by, not a colour it replaces them with.
   `gl` is gloss: 0 is a matte mask, 1 the glossy green everybody knows. */
const MASKC={
  green :{id:"green", label:"Green (LPI, gloss)",  col:"#1c7a45",gl:0.92},
  greenm:{id:"greenm",label:"Green, matte",        col:"#1f6b41",gl:0.18},
  blue  :{id:"blue",  label:"Blue",                col:"#17458f",gl:0.88},
  red   :{id:"red",   label:"Red",                 col:"#96241d",gl:0.86},
  black :{id:"black", label:"Black (gloss)",       col:"#15171b",gl:0.90},
  blackm:{id:"blackm",label:"Black, matte",        col:"#131417",gl:0.10},
  white :{id:"white", label:"White",               col:"#e8e8e3",gl:0.80},
  purple:{id:"purple",label:"Purple",              col:"#4a2b79",gl:0.86},
  yellow:{id:"yellow",label:"Yellow",              col:"#cba714",gl:0.84},
  none  :{id:"none",  label:"None — bare laminate",col:"#ffffff",gl:0.30}
};
const MASK_KEYS=["green","greenm","blue","red","black","blackm","white","purple","yellow","none"];

/* ============================ surface finish ============================
   What is in the mask openings. `dome` is how much the finish crowns the
   pad: HASL is molten solder levelled by an air knife and it comes out
   domed and uneven, ENIG is a chemical plating a fraction of a micron
   thick and it comes out flat, which is exactly why fine-pitch parts and
   any part with a thermal pad want ENIG. `um` is the plating thickness.  */
const FIN={
  hasl :{id:"hasl", label:"HASL (tin-lead)",       col:"#b4b8bd",rgh:0.30,met:1,dome:1.00,um:12,note:"hot-air levelled solder, domed and uneven"},
  haslf:{id:"haslf",label:"HASL, lead-free (SAC)", col:"#bcbfc2",rgh:0.36,met:1,dome:1.15,um:14,note:"lead-free HASL, coarser and more domed"},
  enig :{id:"enig", label:"ENIG (gold over nickel)",col:"#c6a052",rgh:0.22,met:1,dome:0.06,um:0.1,note:"0.1 um gold over 5 um nickel, flat"},
  isag :{id:"isag", label:"Immersion silver",      col:"#cbced1",rgh:0.24,met:1,dome:0.05,um:0.3,note:"immersion silver, flat"},
  itin :{id:"itin", label:"Immersion tin",         col:"#c2c6ca",rgh:0.32,met:1,dome:0.05,um:1.0,note:"immersion tin, flat"},
  osp  :{id:"osp",  label:"OSP (bare copper)",     col:"#b1682f",rgh:0.44,met:1,dome:0.02,um:0.0,note:"organic coating over bare copper"},
  hgold:{id:"hgold",label:"Hard gold (fingers)",   col:"#cfa93b",rgh:0.14,met:1,dome:0.08,um:0.8,note:"electroplated hard gold, 30 uin"}
};
const FIN_KEYS=["hasl","haslf","enig","isag","itin","osp","hgold"];

/* copper weight, ounces per square foot -> microns. 1 oz/ft2 of copper is
   1.37 mil, which is 34.8 um; every other row is a multiple of it. */
const CU_OZ=[[0.5,17.4],[1,34.8],[2,69.6],[3,104.4],[4,139.2]];
const ozUm=oz=>{let b=CU_OZ[1];for(const r of CU_OZ)if(Math.abs(r[0]-oz)<Math.abs(b[0]-oz))b=r;return b[1];};

/* ============================ board formats ============================
   Real outlines, in millimetres, long side first. `fing` says which edge
   carries an edge connector, `mh` the mounting-hole pattern.  */
const FORMATS={
  custom :{label:"Custom",                    w:100,  h:80,    r:1.6,fing:"none"},
  euro   :{label:"Eurocard 3U (DIN 41494)",   w:160,  h:100,   r:1.6,fing:"none"},
  euro6  :{label:"Eurocard 6U",               w:233.35,h:160,  r:1.6,fing:"none"},
  pc104  :{label:"PC/104",                    w:96,   h:90,    r:1.0,fing:"none"},
  unoish :{label:"Single-board controller",   w:68.6, h:53.3,  r:3.2,fing:"none"},
  sbc    :{label:"Single-board computer",     w:85,   h:56,    r:3.0,fing:"none"},
  itx    :{label:"Mini-ITX motherboard",      w:170,  h:170,   r:2.0,fing:"none"},
  dimm   :{label:"DIMM module",               w:133.35,h:31.75,r:1.0,fing:"bottom"},
  sodimm :{label:"SO-DIMM module",            w:67.6, h:31.75, r:1.0,fing:"bottom"},
  m2     :{label:"M.2 2280 card",             w:80,   h:22,    r:0.6,fing:"left"},
  pcie   :{label:"PCIe half-height card",     w:167.65,h:68.9, r:1.6,fing:"bottom"},
  cred   :{label:"Credit-card module",        w:85.6, h:54,    r:3.18,fing:"none"},
  hat    :{label:"Stacking add-on board",     w:65,   h:56.5,  r:3.5,fing:"none"},
  stamp  :{label:"Castellated module",        w:24,   h:18,    r:0.5,fing:"none",cast:true},
  coin   :{label:"Coin-cell round board",     w:30,   h:30,    r:15,  fing:"none",round:true},
  strip  :{label:"LED strip segment",         w:100,  h:10,    r:0.5,fing:"none"}
};
const FORMAT_KEYS=Object.keys(FORMATS);

/* ============================ drills ============================
   Finished hole sizes you would actually order, in mm. A via is the
   drill; the pad around it is the drill plus twice the annular ring, and
   0.15 mm of ring on a 0.3 mm drill is the standard cheap via. */
const VIA={drill:0.30,ring:0.15};
const MH={m2:2.2,m25:2.7,m3:3.2,m4:4.3};

/* ============================ land patterns ============================

   IPC-7351B, density level B (the nominal one — level A is for wave
   solder and hand assembly, level C for high-density reflow). For the
   chip passives the land is given outright because the table is short
   and the numbers matter; for everything with leads the land is DERIVED
   from the lead geometry the way the standard derives it — the pad is
   the lead plus a toe fillet, a heel fillet and a side fillet, and the
   pad span is the lead span. `fillet` below is [toe, heel, side] in mm.

   Body sizes are EIA / JEDEC and are exact: an 0603 really is 1.60 by
   0.80 by 0.45 mm, and drawing it 1.5 by 0.9 would be drawing a part
   that does not exist. */
const FILLET={gull:[0.35,0.35,0.03],fine:[0.15,0.25,0.01],sot:[0.35,0.35,0.03]};

const CHIP={
  "0402":{body:[1.00,0.50,0.35],pad:[0.55,0.60],gap:0.50,eia:"0402 (1005 metric)"},
  "0603":{body:[1.60,0.80,0.45],pad:[0.80,0.90],gap:0.70,eia:"0603 (1608 metric)"},
  "0805":{body:[2.00,1.25,0.60],pad:[1.00,1.35],gap:0.90,eia:"0805 (2012 metric)"},
  "1206":{body:[3.20,1.60,0.70],pad:[1.10,1.75],gap:1.60,eia:"1206 (3216 metric)"},
  "1210":{body:[3.20,2.50,1.25],pad:[1.10,2.65],gap:1.60,eia:"1210 (3225 metric)"},
  "2512":{body:[6.30,3.20,0.60],pad:[1.30,3.35],gap:4.20,eia:"2512 (6332 metric)"}
};
const CHIP_KEYS=["0402","0603","0805","1206","1210","2512"];

/* Tantalum case codes are EIA-535BAAC: A is 3.2 x 1.6, B 3.5 x 2.8,
   C 6.0 x 3.2, D 7.3 x 4.3. */
const TANT={
  A:{body:[3.20,1.60,1.60],pad:[1.20,1.20],gap:0.80},
  B:{body:[3.50,2.80,1.90],pad:[1.30,2.20],gap:0.90},
  C:{body:[6.00,3.20,2.50],pad:[2.20,2.20],gap:1.60},
  D:{body:[7.30,4.30,2.80],pad:[2.40,2.40],gap:2.40}
};

/* ============================ the parts ============================

   `kind` picks the draw routine, `des` the reference designator prefix
   (IEEE 315 / ASME Y14.44: R resistor, C capacitor, L inductor, D diode,
   Q transistor, U integrated circuit, Y crystal or oscillator, J jack,
   SW switch, TP test point, FB ferrite bead, F fuse, K relay, MH
   mounting hole, FID fiducial), `fam` which region wants it, and `min`
   the footprint width in TEXELS below which the part is dropped rather
   than drawn as a smudge — measured on the body, not on the courtyard.

   `th` marks a through-hole part, which drills the board rather than
   sitting on it. */
const PART=[
  /* --- chip passives: the bulk of any board --- */
  {id:"r",     label:"Chip resistor",        kind:"chip", des:"R", fam:"pass", min:5,  sub:"res"},
  {id:"c",     label:"Chip capacitor (MLCC)",kind:"chip", des:"C", fam:"pass", min:5,  sub:"mlcc"},
  {id:"fb",    label:"Ferrite bead",         kind:"chip", des:"FB",fam:"pass", min:6,  sub:"fer"},
  {id:"rarr",  label:"Resistor array",       kind:"rarr", des:"RN",fam:"pass", min:10},
  {id:"melf",  label:"MELF resistor",        kind:"melf", des:"R", fam:"pass", min:7},
  {id:"sod",   label:"SMD diode (SOD-123)",  kind:"sod",  des:"D", fam:"pass", min:6},
  {id:"tant",  label:"Tantalum capacitor",   kind:"tant", des:"C", fam:"pwr",  min:8},
  /* --- actives --- */
  {id:"sot23", label:"SOT-23 transistor",    kind:"sot",  des:"Q", fam:"act",  min:8,  np:3,  pitch:0.95,body:[2.90,1.30,1.10],span:2.40,lead:[0.45,0.45]},
  {id:"sot235",label:"SOT-23-5 regulator",   kind:"sot",  des:"U", fam:"act",  min:9,  np:5,  pitch:0.95,body:[2.90,1.60,1.10],span:2.80,lead:[0.45,0.40]},
  {id:"dpak",  label:"DPAK regulator",       kind:"dpak", des:"U", fam:"pwr",  min:11},
  {id:"soic8", label:"SOIC-8",               kind:"gull", des:"U", fam:"ic",   min:12, np:8,  pitch:1.27,body:[4.90,3.90,1.75],span:6.00,lead:[1.05,0.45]},
  {id:"soic16",label:"SOIC-16 (wide)",       kind:"gull", des:"U", fam:"ic",   min:16, np:16, pitch:1.27,body:[10.30,7.50,2.35],span:10.30,lead:[1.05,0.45]},
  {id:"tssop", label:"TSSOP-20",             kind:"gull", des:"U", fam:"ic",   min:16, np:20, pitch:0.65,body:[6.50,4.40,1.10],span:6.40,lead:[0.75,0.30],fine:true},
  {id:"msop",  label:"MSOP-10",              kind:"gull", des:"U", fam:"ic",   min:13, np:10, pitch:0.50,body:[3.00,3.00,1.10],span:4.90,lead:[0.60,0.25],fine:true},
  {id:"qfp",   label:"LQFP quad flat pack",  kind:"qfp",  des:"U", fam:"core", min:26, np:64, pitch:0.50,body:[10.00,10.00,1.40],span:12.00,lead:[0.75,0.27],fine:true},
  {id:"qfpb",  label:"LQFP-100, 14 mm",      kind:"qfp",  des:"U", fam:"core", min:34, np:100,pitch:0.50,body:[14.00,14.00,1.40],span:16.00,lead:[0.75,0.27],fine:true},
  {id:"qfn",   label:"QFN with thermal pad", kind:"qfn",  des:"U", fam:"core", min:18, np:32, pitch:0.50,body:[5.00,5.00,0.90],pad:[0.75,0.28],tp:3.60},
  {id:"bga",   label:"BGA",                  kind:"bga",  des:"U", fam:"core", min:34, nx:12, ny:12,pitch:0.80,body:[10.00,10.00,1.35],ball:0.45},
  {id:"dip",   label:"DIP-16 (through hole)",kind:"dip",  des:"U", fam:"ic",   min:16, np:16, pitch:2.54,rows:7.62,body:[19.90,6.35,4.20],th:true},
  /* --- power --- */
  {id:"elyt",  label:"Electrolytic can",     kind:"elyt", des:"C", fam:"pwr",  min:12},
  {id:"ind",   label:"Shielded power inductor",kind:"ind",des:"L", fam:"pwr",  min:10},
  {id:"to220", label:"TO-220, upright",      kind:"to220",des:"Q", fam:"pwr",  min:12, th:true},
  {id:"fuse",  label:"Fuse, 1206",           kind:"chip", des:"F", fam:"pwr",  min:7,  sub:"fuse"},
  /* --- timing --- */
  {id:"xtal",  label:"SMD crystal (3225)",   kind:"xtal", des:"Y", fam:"clk",  min:10},
  {id:"hc49",  label:"HC-49 crystal can",    kind:"hc49", des:"Y", fam:"clk",  min:11, th:true},
  {id:"osc",   label:"Oscillator (7050)",    kind:"osc",  des:"Y", fam:"clk",  min:11},
  /* --- optical --- */
  {id:"led",   label:"LED, PLCC-2",          kind:"led",  des:"D", fam:"opt",  min:9},
  {id:"ledc",  label:"LED, 0603 chip",       kind:"ledc", des:"D", fam:"opt",  min:6},
  /* --- connectors and interface --- */
  {id:"hdr1",  label:"Pin header, 1 x N",    kind:"hdr",  des:"J", fam:"conn", min:10, rows:1, th:true},
  {id:"hdr2",  label:"Pin header, 2 x N",    kind:"hdr",  des:"J", fam:"conn", min:12, rows:2, th:true},
  {id:"usbc",  label:"USB-C receptacle",     kind:"conn", des:"J", fam:"conn", min:14, body:[8.94,7.30,3.16],cav:[8.34,1.10],shell:"metal",edge:true},
  {id:"usba",  label:"USB-A receptacle",     kind:"conn", des:"J", fam:"conn", min:16, body:[14.50,13.70,6.50],cav:[12.00,5.00],shell:"metal",edge:true,th:true},
  {id:"rj45",  label:"RJ45 jack",            kind:"conn", des:"J", fam:"conn", min:20, body:[15.80,21.00,13.50],cav:[12.00,10.00],shell:"black",edge:true,th:true},
  {id:"jst",   label:"JST-PH wire-to-board", kind:"conn", des:"J", fam:"conn", min:12, body:[10.00,4.50,5.80],cav:[8.60,2.00],shell:"white"},
  {id:"dcj",   label:"DC barrel jack",       kind:"conn", des:"J", fam:"conn", min:14, body:[9.00,14.00,11.00],cav:[6.50,6.50],shell:"black",edge:true,th:true},
  {id:"usd",   label:"microSD socket",       kind:"conn", des:"J", fam:"conn", min:16, body:[14.00,14.50,1.90],cav:[11.50,1.20],shell:"metal",edge:true},
  {id:"sma",   label:"SMA edge jack",        kind:"conn", des:"J", fam:"rf",   min:12, body:[6.35,9.00,6.35],cav:[4.20,4.20],shell:"metal",edge:true},
  {id:"term",  label:"Screw terminal",       kind:"conn", des:"J", fam:"conn", min:14, body:[10.16,9.50,10.00],cav:[8.00,3.00],shell:"green",edge:true,th:true},
  /* --- switches --- */
  {id:"sw",    label:"Tactile switch, 6 mm", kind:"sw",   des:"SW",fam:"misc", min:11},
  {id:"dipsw", label:"DIP switch, 4-way",    kind:"dipsw",des:"SW",fam:"misc", min:14},
  {id:"pot",   label:"Trimmer potentiometer",kind:"pot",  des:"RV",fam:"misc", min:10},
  /* --- the rest --- */
  {id:"shield",label:"RF shield can",        kind:"shield",des:"U",fam:"rf",   min:22},
  {id:"tp",    label:"Test point",           kind:"tp",   des:"TP",fam:"misc", min:4},
  {id:"relay", label:"Signal relay",         kind:"relay",des:"K", fam:"misc", min:16, th:true}
];
const PART_BY={};
for(let i=0;i<PART.length;i++)PART_BY[PART[i].id]=PART[i];

/* ============================ the legend font ============================
   SINGLE-STROKE GOTHIC, out of modes/lib/stroke.js. The legend is screened or
   inkjetted in one pass at a line width the fab specifies (0.15 mm is the
   usual floor), so every character IS a constant-width stroke with round ends
   and a filled typeface set at 1 mm would be the wrong object. It also keeps
   this mode on a worker thread, which a registered face would not. The
   alphabet is shared with the glyph mode, whose key sheet has to print the
   Latin letter each invented glyph stands for. Five units wide by seven tall,
   y down, cap height the whole seven, advance 5.4 and ink 4.2 inside it. */
const GLY=ForgeStroke.GLY, GLY_ADV=ForgeStroke.ADV, GLY_CAP=ForgeStroke.CAP,
      glyWidth=ForgeStroke.width;

/* ============================ geometry helpers ============================ */

function rrectPath(g,x,y,w,h,r){
  r=Math.max(0,Math.min(r,Math.min(w,h)*0.5));
  g.beginPath();
  g.moveTo(x+r,y);
  g.lineTo(x+w-r,y);   if(r)g.arcTo(x+w,y,x+w,y+r,r);
  g.lineTo(x+w,y+h-r); if(r)g.arcTo(x+w,y+h,x+w-r,y+h,r);
  g.lineTo(x+r,y+h);   if(r)g.arcTo(x,y+h,x,y+h-r,r);
  g.lineTo(x,y+r);     if(r)g.arcTo(x,y,x+r,y,r);
  g.closePath();
}
function polyPath(g,pts,close){
  g.beginPath();g.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++)g.lineTo(pts[i][0],pts[i][1]);
  if(close)g.closePath();
}
function circPath(g,x,y,r){g.beginPath();g.arc(x,y,Math.max(1e-4,r),0,Math.PI*2);g.closePath();}

/* CHAMFER EVERY CORNER. A router that turns square is a router nobody uses:
   an inside corner at 90 degrees holds etchant and an outside one is an acid
   trap, so the whole industry turns at 45 and has since the tape-up era. This
   replaces each interior vertex with the two points a `c`-long cut across it
   would leave, which is the same operation a layout tool calls "45 degree
   corner" — and it is bounded by half the shorter of the two legs, so a tight
   dogleg degrades to a plain mitre instead of turning inside out. */
function chamfer(pts,c){
  if(pts.length<3||c<=0)return pts;
  const out=[pts[0]];
  for(let i=1;i<pts.length-1;i++){
    const a=pts[i-1],b=pts[i],d=pts[i+1];
    const l1=Math.hypot(b[0]-a[0],b[1]-a[1]),l2=Math.hypot(d[0]-b[0],d[1]-b[1]);
    const k=Math.min(c,l1*0.5,l2*0.5);
    if(k<1e-4){out.push(b);continue;}
    out.push([b[0]+(a[0]-b[0])/l1*k,b[1]+(a[1]-b[1])/l1*k]);
    out.push([b[0]+(d[0]-b[0])/l2*k,b[1]+(d[1]-b[1])/l2*k]);
  }
  out.push(pts[pts.length-1]);
  return out;
}

/* Offset a polyline sideways by d, vertex by vertex along the bisector — which
   is what keeps a BUNDLE parallel round a corner. Offsetting each segment
   independently and joining the ends would make the members' corners land at
   different places and the bundle would fan out and back in at every turn. */
function offsetPoly(pts,d){
  if(Math.abs(d)<1e-9)return pts.slice();
  const n=pts.length,nrm=[],out=[];
  for(let i=0;i<n-1;i++){
    const dx=pts[i+1][0]-pts[i][0],dy=pts[i+1][1]-pts[i][1],l=Math.hypot(dx,dy)||1;
    nrm.push([-dy/l,dx/l]);
  }
  for(let i=0;i<n;i++){
    const a=nrm[Math.max(0,i-1)],b=nrm[Math.min(nrm.length-1,i)];
    const sx=a[0]+b[0],sy=a[1]+b[1],l=Math.hypot(sx,sy);
    /* The bisector direction is (a+b)/|a+b| and it has to travel d/cos(t/2),
       where cos(t/2) is |a+b|/2 — so the whole offset is (a+b)*2d/|a+b|^2.
       At a doubling-back vertex |a+b| goes to zero and there is no bisector;
       take the outgoing normal and let the chamfer tidy it. */
    let ox,oy;
    if(l<1e-6){ox=b[0]*d;oy=b[1]*d;}
    else{const k=2*d/(l*l);ox=sx*k;oy=sy*k;}
    out.push([pts[i][0]+ox,pts[i][1]+oy]);
  }
  return out;
}

/* a Manhattan route from A leaving along `da` to B, doglegged so the escape
   from each end is honoured before the turn */
function manhattan(ax,ay,da,bx,by,db,esc){
  const p=[[ax,ay]];
  const a2=[ax+da[0]*esc,ay+da[1]*esc];
  const b2=[bx+db[0]*esc,by+db[1]*esc];
  p.push(a2);
  if(Math.abs(da[0])>0.5){                     /* left the pad horizontally */
    if(Math.abs(db[0])>0.5){const mx=(a2[0]+b2[0])*0.5;p.push([mx,a2[1]],[mx,b2[1]]);}
    else p.push([b2[0],a2[1]]);
  }else{
    if(Math.abs(db[1])>0.5){const my=(a2[1]+b2[1])*0.5;p.push([a2[0],my],[b2[0],my]);}
    else p.push([a2[0],b2[1]]);
  }
  p.push(b2,[bx,by]);
  /* drop any zero-length step so the chamfer does not see a degenerate corner */
  const out=[p[0]];
  for(let i=1;i<p.length;i++)
    if(Math.hypot(p[i][0]-out[out.length-1][0],p[i][1]-out[out.length-1][1])>1e-4)out.push(p[i]);
  return out;
}

/* ============================ claimed ground ============================

   One grid of what is already taken, in board millimetres. Placement asks it
   whether a courtyard is free; routing asks it whether a swath is. It is the
   same idea as the loom's claims and it exists for the same reason: two things
   at the same height that overlap come out as one lump, and on a board that
   lump is a short. */
function Claims(Wmm,Hmm,cell){
  this.cell=cell;
  this.nx=Math.max(1,Math.ceil(Wmm/cell));
  this.ny=Math.max(1,Math.ceil(Hmm/cell));
  this.g=new Uint8Array(this.nx*this.ny);
}
Claims.prototype.free=function(x0,y0,x1,y1,mask){
  const c=this.cell;
  const i0=Math.max(0,Math.floor(x0/c)),i1=Math.min(this.nx-1,Math.floor(x1/c));
  const j0=Math.max(0,Math.floor(y0/c)),j1=Math.min(this.ny-1,Math.floor(y1/c));
  if(x0<0||y0<0||x1>this.nx*c||y1>this.ny*c)return false;
  const m=mask===undefined?255:mask;
  for(let j=j0;j<=j1;j++){const r=j*this.nx;
    for(let i=i0;i<=i1;i++)if(this.g[r+i]&m)return false;}
  return true;
};
Claims.prototype.mark=function(x0,y0,x1,y1,bit){
  const c=this.cell,b=bit===undefined?1:bit;
  const i0=Math.max(0,Math.floor(x0/c)),i1=Math.min(this.nx-1,Math.floor(x1/c));
  const j0=Math.max(0,Math.floor(y0/c)),j1=Math.min(this.ny-1,Math.floor(y1/c));
  for(let j=j0;j<=j1;j++){const r=j*this.nx;
    for(let i=i0;i<=i1;i++)this.g[r+i]|=b;}
};
/* A DRY RUN NEEDS SOMEWHERE TO PUT ITS MARKS. A bundle is tested whole and
   committed whole, and its own members have to see each other while it is
   being tested — two members of one bundle crossing each other is as much a
   short as two bundles crossing. So the attempt marks as it goes on a copy of
   the grid, and puts the copy back if the attempt comes to nothing. */
Claims.prototype.save=function(){return this.g.slice();};
Claims.prototype.load=function(g){this.g.set(g);};
Claims.prototype.markLine=function(pts,rad,bit){
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i],b=pts[i+1];
    const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/this.cell));
    for(let s=0;s<=n;s++){
      const t=s/n,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;
      this.mark(x-rad,y-rad,x+rad,y+rad,bit);
    }
  }
};
Claims.prototype.freeLine=function(pts,rad,mask){
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i],b=pts[i+1];
    const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/this.cell));
    for(let s=0;s<=n;s++){
      const t=s/n,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;
      if(!this.free(x-rad,y-rad,x+rad,y+rad,mask))return false;
    }
  }
  return true;
};

/* ============================ the board blank ============================ */
function boardOf(P,forceW){
  const piece=str(P.piece,"board");
  const fmt=FORMATS[str(P.format,"unoish")]||FORMATS.unoish;
  let bw,bh,r;
  if(str(P.format,"unoish")==="custom"){bw=clamp(num(P.bwMm,100),6,400);bh=clamp(num(P.bhMm,80),6,400);r=clamp(num(P.cornerMm,1.6),0,20);}
  else{bw=fmt.w;bh=fmt.h;r=fmt.round?Math.min(fmt.w,fmt.h)*0.5:fmt.r;}
  if(bh>bw){const t=bw;bw=bh;bh=t;}            /* long side across the texture */

  let Wmm,Hmm,nx=1,ny=1,rail=0,gap=0;
  if(piece==="field"){Wmm=Hmm=clamp(num(P.fieldMm,60),12,400);}
  else if(piece==="panel"){
    nx=clamp(P.panX|0,1,6);ny=clamp(P.panY|0,1,6);
    rail=clamp(num(P.railMm,10),3,30);
    /* A V-SCORED PANEL HAS NO GAP. The boards are contiguous and the groove
       between them is the only thing there — routing a channel AND scoring it
       would be two ways of separating the same two boards. */
    gap=(str(P.brk,"tab")==="vscore")?0:clamp(num(P.routeMm,2.4),1,8);
    Wmm=nx*bw+(nx-1)*gap+rail*2;
    Hmm=ny*bh+(ny-1)*gap+rail*2;
  }else{Wmm=bw;Hmm=bh;}

  const lam=LAM[str(P.lam,"fr4")]||LAM.fr4;
  const maxTex=4096;
  let TW=clamp(forceW||(P.size|0)||1024,32,maxTex);
  let TH;
  if(piece==="field"){TH=TW;}
  else{
    TH=Math.max(16,Math.round(TW*Hmm/Wmm/4)*4);
    if(TH>maxTex){TH=maxTex;TW=Math.max(32,Math.round(TH*Wmm/Hmm/4)*4);}
  }
  const pxPerMm=TW/Wmm;
  return {piece:piece,fmt:fmt,fmtId:str(P.format,"unoish"),lam:lam,
    Wmm:Wmm,Hmm:Hmm,bw:bw,bh:bh,r:r,nx:nx,ny:ny,rail:rail,gap:gap,
    TW:TW,TH:TH,pxPerMm:pxPerMm,mmPerPx:1/pxPerMm,
    thick:num(P.thickMm,0)>0?num(P.thickMm,0):lam.thick,
    fing:(piece==="board"&&bool(P.fingers,true))?str(fmt.fing,"none"):"none",
    cast:!!fmt.cast&&piece==="board"};
}

/* where each board sits inside the piece: one entry for a single board, nx*ny
   for a panel, and for a field the whole tile with no outline at all */
function cellsOf(G){
  const out=[];
  if(G.piece==="field"){out.push({x:0,y:0,w:G.Wmm,h:G.Hmm,r:0,edge:false});return out;}
  if(G.piece==="panel"){
    for(let j=0;j<G.ny;j++)for(let i=0;i<G.nx;i++)
      out.push({x:G.rail+i*(G.bw+G.gap),y:G.rail+j*(G.bh+G.gap),w:G.bw,h:G.bh,r:G.r,edge:true});
    return out;
  }
  out.push({x:0,y:0,w:G.Wmm,h:G.Hmm,r:G.r,edge:true});
  return out;
}

/* ============================ footprints ============================

   Local coordinates, body centred on the origin, the part's long axis along
   x, y downwards. `pads` is the copper; `court` is the IPC COURTYARD — the
   footprint plus the excess the standard asks for around it (0.25 mm at
   density level B), which is the rectangle placement tests for a clash. A
   part whose pads clear but whose courtyard does not is a part the assembler
   cannot get a nozzle onto.

   `pins` is what the router may attach to: a pad plus the direction a trace
   should leave it, which is always away from the body. Escaping a pad towards
   the part it belongs to is the one thing no router does.  */
const COURT=0.25;

/* IPC-7351's construction for a leaded part, both rows at once. `span` is the
   datasheet lead span (toe to toe), `bw` the body across the leads, so the
   exposed lead length is (span-bw)/2 and the pad runs from the heel fillet
   inboard of the body edge to the toe fillet outboard of the toe. */
function leadRow(span,bw,leadW,f){
  const outer=span*0.5+f[0], inner=bw*0.5-f[1];
  const len=Math.max(0.18,outer-inner);
  return {len:len,rad:(outer+inner)*0.5,wid:Math.max(0.12,leadW+f[2]*2)};
}

function footprint(inst){
  const p=inst.p,k=p.kind;
  const pads=[],pins=[];
  let bw=0,bh=0,ht=0,cw=0,chh=0;
  const push=(x,y,w,h,extra)=>{
    const d={x:x,y:y,w:w,h:h,shape:"rect",pin:pads.length+1};
    if(extra)for(const kk in extra)d[kk]=extra[kk];
    pads.push(d);return d;
  };
  /* WHICH WAY IS OUT. For a pad in a row it is perpendicular to the row and
     the caller says so, because guessing it from the pad's position gets the
     ends of a long row wrong — on a wide connector the outermost pad is
     further out along the row than it is across it, and a trace escaping
     along the row runs straight into its neighbour. Only a grid — a ball
     array, a header, a can with two feet — has to be guessed at. */
  const outward=(pad)=>{
    if(pad.d)return pad.d;
    const ax=Math.abs(pad.x),ay=Math.abs(pad.y);
    return ax>=ay?[Math.sign(pad.x)||1,0]:[0,Math.sign(pad.y)||1];
  };

  if(k==="chip"){
    const C=CHIP[inst.cs]||CHIP["0603"];
    bw=C.body[0];bh=C.body[1];ht=C.body[2];
    const px=C.gap*0.5+C.pad[0]*0.5;
    push(-px,0,C.pad[0],C.pad[1]);push(px,0,C.pad[0],C.pad[1]);
    cw=C.gap+C.pad[0]*2;chh=Math.max(bh,C.pad[1]);
  }else if(k==="melf"){
    bw=3.60;bh=1.40;ht=1.40;
    push(-1.75,0,1.20,1.60);push(1.75,0,1.20,1.60);
    cw=4.70;chh=1.70;
  }else if(k==="sod"){
    bw=2.70;bh=1.60;ht=1.10;
    push(-1.20,0,1.20,1.20);push(1.20,0,1.20,1.20);
    cw=3.60;chh=1.60;
  }else if(k==="tant"){
    const C=TANT[inst.tc]||TANT.B;
    bw=C.body[0];bh=C.body[1];ht=C.body[2];
    const px=C.gap*0.5+C.pad[0]*0.5;
    push(-px,0,C.pad[0],C.pad[1]);push(px,0,C.pad[0],C.pad[1]);
    cw=C.gap+C.pad[0]*2;chh=Math.max(bh,C.pad[1]);
  }else if(k==="rarr"){
    bw=3.20;bh=1.60;ht=0.55;
    for(let i=0;i<4;i++){const x=(i-1.5)*0.80;
      push(x,-0.75,0.50,0.70);push(x,0.75,0.50,0.70);}
    cw=3.40;chh=2.10;
  }else if(k==="dpak"){
    /* SOT-223: three leads on one side at 2.30 mm and the collector tab on
       the other, which is also the heatsink — so the tab pad is the reason
       the part exists and is drawn at its real 3.8 by 2.0 mm */
    bw=6.50;bh=3.50;ht=1.60;
    push(0,-2.40,3.80,2.00,{d:[0,-1],tab:true});
    for(let i=0;i<3;i++)push((i-1)*2.30,2.40,1.20,1.90,{d:[0,1]});
    cw=7.20;chh=6.80;
  }else if(k==="sot"||k==="gull"){
    const f=p.fine?FILLET.fine:(k==="sot"?FILLET.sot:FILLET.gull);
    const R=leadRow(p.span,p.body[1],p.lead[1],f);
    bw=p.body[0];bh=p.body[1];ht=p.body[2];
    if(k==="sot"){
      /* SOT-23 is three leads: two on one side at the pitch, one centred on
         the other. The five-lead version is three and two. */
      const nA=(p.np===5)?3:2,nB=p.np-nA;
      for(let i=0;i<nA;i++)push((i-(nA-1)*0.5)*p.pitch,-R.rad,R.wid,R.len,{d:[0,-1]});
      for(let i=0;i<nB;i++)push((i-(nB-1)*0.5)*p.pitch,R.rad,R.wid,R.len,{d:[0,1]});
      cw=Math.max(bw,(nA-1)*p.pitch+R.wid);chh=R.rad*2+R.len;
    }else{
      const per=p.np>>1;
      for(let i=0;i<per;i++)push((i-(per-1)*0.5)*p.pitch,-R.rad,R.wid,R.len,{d:[0,-1]});
      for(let i=per-1;i>=0;i--)push((i-(per-1)*0.5)*p.pitch,R.rad,R.wid,R.len,{d:[0,1]});
      cw=Math.max(bw,(per-1)*p.pitch+R.wid);chh=R.rad*2+R.len;
    }
  }else if(k==="qfp"){
    const f=FILLET.fine,R=leadRow(p.span,p.body[1],p.lead[1],f);
    bw=p.body[0];bh=p.body[1];ht=p.body[2];
    const per=Math.max(2,p.np>>2);
    for(let i=0;i<per;i++)push(-R.rad,(i-(per-1)*0.5)*p.pitch,R.len,R.wid,{d:[-1,0]});
    for(let i=0;i<per;i++)push((i-(per-1)*0.5)*p.pitch,R.rad,R.wid,R.len,{d:[0,1]});
    for(let i=per-1;i>=0;i--)push(R.rad,(i-(per-1)*0.5)*p.pitch,R.len,R.wid,{d:[1,0]});
    for(let i=per-1;i>=0;i--)push((i-(per-1)*0.5)*p.pitch,-R.rad,R.wid,R.len,{d:[0,-1]});
    cw=chh=R.rad*2+R.len;
  }else if(k==="qfn"){
    bw=p.body[0];bh=p.body[1];ht=p.body[2];
    const per=Math.max(2,p.np>>2),L=p.pad[0],W=p.pad[1],rad=bw*0.5-L*0.5+0.10;
    for(let i=0;i<per;i++)push(-rad,(i-(per-1)*0.5)*p.pitch,L,W,{d:[-1,0]});
    for(let i=0;i<per;i++)push((i-(per-1)*0.5)*p.pitch,rad,W,L,{d:[0,1]});
    for(let i=per-1;i>=0;i--)push(rad,(i-(per-1)*0.5)*p.pitch,L,W,{d:[1,0]});
    for(let i=per-1;i>=0;i--)push((i-(per-1)*0.5)*p.pitch,-rad,W,L,{d:[0,-1]});
    if(p.tp)push(0,0,p.tp,p.tp,{thermal:true});
    cw=chh=bw+0.4;
  }else if(k==="bga"){
    bw=p.body[0];bh=p.body[1];ht=p.body[2];
    const d=p.ball*0.8;
    for(let j=0;j<p.ny;j++)for(let i=0;i<p.nx;i++)
      push((i-(p.nx-1)*0.5)*p.pitch,(j-(p.ny-1)*0.5)*p.pitch,d,d,{shape:"round",ball:true});
    cw=chh=bw;
  }else if(k==="dip"){
    bw=p.body[0];bh=p.body[1];ht=p.body[2];
    const per=p.np>>1,drill=0.90,pd=1.60;
    for(let i=0;i<per;i++)push((i-(per-1)*0.5)*p.pitch,-p.rows*0.5,pd,pd,
      {shape:i===0?"rect":"round",drill:drill,th:true,d:[0,-1]});
    for(let i=per-1;i>=0;i--)push((i-(per-1)*0.5)*p.pitch,p.rows*0.5,pd,pd,
      {shape:"round",drill:drill,th:true,d:[0,1]});
    cw=Math.max(bw,(per-1)*p.pitch+pd);chh=p.rows+pd;
  }else if(k==="hdr"){
    const cols=inst.cols||6,rows=p.rows,pitch=2.54,drill=1.02,pd=1.70;
    bw=cols*pitch;bh=rows*pitch;ht=8.50;
    for(let j=0;j<rows;j++)for(let i=0;i<cols;i++)
      push((i-(cols-1)*0.5)*pitch,(j-(rows-1)*0.5)*pitch,pd,pd,
        {shape:(i===0&&j===0)?"rect":"round",drill:drill,th:true});
    cw=bw;chh=bh;
  }else if(k==="elyt"){
    const d=inst.dia||6.3;
    bw=bh=d;ht=inst.can||(d<7?5.4:10.5);
    const px=d*0.36,pw=d*0.30,ph=d*0.24;
    push(-px,0,pw,ph);push(px,0,pw,ph);
    cw=d+1.0;chh=d+0.4;
  }else if(k==="ind"){
    const s=inst.dia||6.0;
    bw=bh=s;ht=inst.can||(s<5?1.8:(s<7?3.0:(s<9?4.5:8.0)));
    push(-s*0.33,0,s*0.30,s*0.56);push(s*0.33,0,s*0.30,s*0.56);
    cw=s+0.6;chh=s+0.3;
  }else if(k==="xtal"){
    bw=3.20;bh=2.50;ht=0.80;
    const xs=[-1.05,1.05],ys=[-0.80,0.80];
    for(const y of ys)for(const x of xs)push(x,y,1.10,1.00);
    cw=3.60;chh=2.80;
  }else if(k==="hc49"){
    bw=11.05;bh=4.65;ht=4.20;
    push(-2.44,1.60,1.70,1.70,{shape:"round",drill:0.80,th:true});
    push(2.44,1.60,1.70,1.70,{shape:"round",drill:0.80,th:true});
    cw=bw+0.6;chh=bh+2.4;
  }else if(k==="osc"){
    bw=7.00;bh=5.00;ht=1.50;
    const xs=[-2.05,2.05],ys=[-1.50,1.50];
    for(const y of ys)for(const x of xs)push(x,y,1.90,1.90);
    cw=7.40;chh=5.40;
  }else if(k==="led"){
    bw=3.50;bh=2.80;ht=1.90;
    push(-1.60,0,1.20,2.00);push(1.60,0,1.20,2.00);
    cw=4.60;chh=3.00;
  }else if(k==="ledc"){
    const C=CHIP["0603"];
    bw=C.body[0];bh=C.body[1];ht=0.55;
    const px=C.gap*0.5+C.pad[0]*0.5;
    push(-px,0,C.pad[0],C.pad[1]);push(px,0,C.pad[0],C.pad[1]);
    cw=C.gap+C.pad[0]*2;chh=C.pad[1];
  }else if(k==="to220"){
    bw=10.00;bh=4.60;ht=15.00;
    for(let i=0;i<3;i++)push((i-1)*2.54,1.30,1.80,1.80,
      {shape:i===0?"rect":"round",drill:1.00,th:true});
    cw=bw+0.8;chh=bh+2.6;
  }else if(k==="conn"){
    bw=p.body[0];bh=p.body[1];ht=p.body[2];
    const n=inst.np||Math.max(2,Math.round(bw/1.6));
    const pitch=Math.min(2.54,(bw-1.2)/Math.max(1,n-1));
    const th=!!p.th,drill=0.90,pd=th?1.60:0.60;
    const row=bh*0.5-(th?1.20:0.35);
    for(let i=0;i<n;i++)push((i-(n-1)*0.5)*pitch,row,th?pd:pitch*0.55,th?pd:1.20,
      th?{shape:i===0?"rect":"round",drill:drill,th:true,d:[0,-1]}:{d:[0,-1]});
    /* the shell is soldered down too: two big posts, which is why a connector
       survives being pulled on */
    push(-bw*0.5-0.6,row-1.2,1.60,2.40,{post:true,drill:th?1.40:0});
    push(bw*0.5+0.6,row-1.2,1.60,2.40,{post:true,drill:th?1.40:0});
    cw=bw+3.0;chh=bh+1.0;
  }else if(k==="shield"){
    const w=inst.sw||14,h=inst.sh||12;
    bw=w;bh=h;ht=inst.can||2.60;
    /* a ground fence: pads every 1.6 mm round the perimeter */
    const step=1.6;
    const nx=Math.max(2,Math.round(w/step)),ny=Math.max(2,Math.round(h/step));
    for(let i=0;i<nx;i++){const x=(i-(nx-1)*0.5)*(w/nx);
      push(x,-h*0.5,0.9,1.0,{fence:true});push(x,h*0.5,0.9,1.0,{fence:true});}
    for(let j=1;j<ny-1;j++){const y=(j-(ny-1)*0.5)*(h/ny);
      push(-w*0.5,y,1.0,0.9,{fence:true});push(w*0.5,y,1.0,0.9,{fence:true});}
    cw=w+1.2;chh=h+1.2;
  }else if(k==="sw"){
    bw=bh=6.00;ht=4.30;
    for(const x of [-3.50,3.50])for(const y of [-2.25,2.25])push(x,y,1.60,1.10);
    cw=8.40;chh=6.40;
  }else if(k==="dipsw"){
    const n=inst.np||4;
    bw=n*2.54+1.7;bh=6.70;ht=5.00;
    for(let i=0;i<n;i++){const x=(i-(n-1)*0.5)*2.54;
      push(x,-3.60,1.00,1.80,{d:[0,-1]});push(x,3.60,1.00,1.80,{d:[0,1]});}
    cw=bw+0.6;chh=9.40;
  }else if(k==="pot"){
    bw=bh=3.00;ht=1.60;
    push(-1.55,-0.95,1.00,0.90);push(-1.55,0.95,1.00,0.90);push(1.55,0,1.00,0.90);
    cw=4.60;chh=3.40;
  }else if(k==="tp"){
    bw=bh=1.50;ht=0;
    push(0,0,1.50,1.50,{shape:"round",test:true});
    cw=chh=2.20;
  }else if(k==="relay"){
    bw=20.00;bh=10.00;ht=10.00;
    for(let i=0;i<3;i++)push((i-1)*5.00,-3.80,1.80,1.80,{shape:"round",drill:1.00,th:true});
    for(let i=0;i<2;i++)push((i-0.5)*5.00,3.80,1.80,1.80,{shape:"round",drill:1.00,th:true});
    cw=bw+0.8;chh=bh+1.6;
  }else{                                   /* nothing known: a bare rectangle */
    bw=bh=3;ht=1;cw=chh=3.5;
  }

  for(const pd of pads)if(!pd.thermal&&!pd.fence&&!pd.post)
    pins.push({x:pd.x,y:pd.y,d:outward(pd),pin:pd.pin});

  return {pads:pads,pins:pins,bw:bw,bh:bh,ht:ht,
          cw:Math.max(cw,bw)+COURT*2,ch:Math.max(chh,bh)+COURT*2};
}

/* wrap the claims grid for the seamless field, where a part may straddle the
   tile edge and the pour and every trace on it certainly do */
Claims.prototype.setWrap=function(w){this.wrapped=!!w;return this;};
(function(){
  const free=Claims.prototype.free,mark=Claims.prototype.mark;
  Claims.prototype.free=function(x0,y0,x1,y1,m){
    if(!this.wrapped)return free.call(this,x0,y0,x1,y1,m);
    const c=this.cell,W=this.nx*c,H=this.ny*c,msk=m===undefined?255:m;
    const i0=Math.floor(x0/c),i1=Math.floor(x1/c),j0=Math.floor(y0/c),j1=Math.floor(y1/c);
    for(let j=j0;j<=j1;j++){const r=((j%this.ny)+this.ny)%this.ny*this.nx;
      for(let i=i0;i<=i1;i++)if(this.g[r+(((i%this.nx)+this.nx)%this.nx)]&msk)return false;}
    return true;
  };
  Claims.prototype.mark=function(x0,y0,x1,y1,bit){
    if(!this.wrapped)return mark.call(this,x0,y0,x1,y1,bit);
    const c=this.cell,b=bit===undefined?1:bit;
    const i0=Math.floor(x0/c),i1=Math.floor(x1/c),j0=Math.floor(y0/c),j1=Math.floor(y1/c);
    for(let j=j0;j<=j1;j++){const r=((j%this.ny)+this.ny)%this.ny*this.nx;
      for(let i=i0;i<=i1;i++)this.g[r+(((i%this.nx)+this.nx)%this.nx)]|=b;}
  };
})();

/* ============================ placement ============================

   THE ORDER HERE IS THE DESIGN. A layout engineer does not scatter and then
   tidy: the connectors are on the edge because that is where the cable is,
   the power section is next to its connector because that is where the
   current comes in, the core part is in the middle because everything has to
   reach it, its decoupling capacitors are as close to its pins as the
   assembly rules allow because that is the whole point of them, the crystal
   is next to the part it clocks because a clock trace is an antenna, and the
   memory is a ROW at one pitch because it is one bus. Everything after that
   is fill, and fill is the only part of it that is random.  */

/* WEIGHTS ARE PER FAMILY, ENABLES ARE PER PART. Forty-four sliders would be
   a control panel nobody reads; ten family weights say how much of the board
   is passives, power, interface or radio, and the catalogue's checkboxes say
   which parts are allowed to answer. A part is offered only if its family has
   weight AND it is ticked. */
const FAMW={pass:"wpass",act:"wact",ic:"wic",core:"wcore",pwr:"wpwr",
            clk:"wclk",opt:"wopt",conn:"wconn",rf:"wrf",misc:"wmisc"};
function famW(P,f){return clamp(num(P[FAMW[f]||"wmisc"],1),0,2);}
function wOf(P,id){
  const p=PART_BY[id];
  if(!p)return 0;
  if(P["en"+id]===false)return 0;
  return famW(P,p.fam);
}

const QROT=(x,y,r)=>r===0?[x,y]:r===1?[-y,x]:r===2?[-x,-y]:[y,-x];

function place(inst,x,y,rot){
  const fp=footprint(inst);
  inst.fp=fp;inst.x=x;inst.y=y;inst.rot=rot|0;
  const odd=(inst.rot&1)===1;
  inst.bw=odd?fp.bh:fp.bw;inst.bh=odd?fp.bw:fp.bh;
  inst.cw=odd?fp.ch:fp.cw;inst.ch=odd?fp.cw:fp.ch;
  inst.ht=fp.ht;
  inst.court=[x-inst.cw*0.5,y-inst.ch*0.5,x+inst.cw*0.5,y+inst.ch*0.5];
  inst.pads=fp.pads.map(function(pd){
    const q=QROT(pd.x,pd.y,inst.rot);
    const o={x:x+q[0],y:y+q[1],w:odd?pd.h:pd.w,h:odd?pd.w:pd.h,shape:pd.shape,pin:pd.pin};
    if(pd.drill)o.drill=pd.drill;
    if(pd.th)o.th=true;
    if(pd.thermal)o.thermal=true;
    if(pd.fence)o.fence=true;
    if(pd.post)o.post=true;
    if(pd.test)o.test=true;
    if(pd.ball)o.ball=true;
    if(pd.tab)o.tab=true;
    if(pd.d)o.dloc=pd.d;
    return o;
  });
  inst.pins=fp.pins.map(function(pn){
    const q=QROT(pn.x,pn.y,inst.rot),d=QROT(pn.d[0],pn.d[1],inst.rot);
    return {x:x+q[0],y:y+q[1],d:[Math.round(d[0]),Math.round(d[1])],pin:pn.pin,used:false};
  });
  return inst;
}

/* a value that could be printed beside the part */
const E12=[10,12,15,18,22,27,33,39,47,56,68,82];
function valueOf(inst,rnd){
  const k=inst.p.kind,sub=inst.p.sub,m=E12[(rnd()*12)|0];
  if(sub==="res"){
    const dec=(rnd()*5)|0;
    if(dec===0)return m+"R";
    if(dec===1)return (m/10|0)+"K"+(m%10);
    if(dec===2)return m+"K";
    if(dec===3)return (m/10|0)+"K"+(m%10);
    return m+"0K";
  }
  if(sub==="mlcc"){const d=(rnd()*4)|0;return d===0?(m+"P"):d===1?(m+"N"):d===2?"100N":(((rnd()*4|0)+1)+"U");}
  if(sub==="fer")return "600R";
  if(k==="tant"||k==="elyt")return (inst.dia>7?"470U":"100U")+"/16V";
  if(k==="ind")return (inst.dia>6?"10U":"2U2");
  if(k==="xtal"||k==="hc49"||k==="osc")return ["8M000","12M000","16M000","24M576","25M000","32K768"][(rnd()*6)|0];
  if(sub==="fuse")return "2A";
  return "";
}

/* the fill grid: parts land on a half-millimetre grid because a layout tool's
   grid is what keeps a board looking laid out rather than sprinkled */
const snap=(v,g)=>Math.round(v/g)*g;

function layoutBoard(P,G,bw,bh,wrap,seed){
  const rnd=mulberry32(seed>>>0);
  const dens=clamp(num(P.dens,0.6),0,1);
  const side=str(P.side,"top");
  const backK=side==="bottom"?0.45:1;          /* the solder side carries less */
  /* THE CLAIMS GRID IS AS FINE AS THE DESIGN RULE. At a fixed 0.4 mm cell an
     8/8 mil rule quantises to one cell, and two bundles could then pass each
     other through a single cell's worth of slack and come out touching — a
     short you can see. Size the cell off the rule instead. */
  const trW=clamp(num(P.traceMil,8),1,80)*MIL;
  const trC=clamp(num(P.clearMil,8),1,80)*MIL;
  const cl=new Claims(bw,bh,clamp((trW+trC)*0.6,0.12,0.4)).setWrap(wrap);
  const parts=[],holes=[],fids=[],routes=[],vias=[],slk=[],drops={};
  const mmPerPx=G.mmPerPx;
  const edge=wrap?0:clamp(num(P.pullMm,0.8),0.2,6);
  const W=(id)=>wOf(P,id);
  const fam=(f)=>famW(P,f);

  /* ---- anything the resolution cannot hold is dropped, not smudged ---- */
  const keep=(inst)=>{
    const wpx=Math.min(inst.bw,inst.bh)/mmPerPx;
    if(wpx<inst.p.min*0.25){drops[inst.p.id]=(drops[inst.p.id]||0)+1;return false;}
    return true;
  };

  /* ---- 0. the keepout: a margin all round, so nothing sits on the cut ---- */
  if(!wrap){
    cl.mark(-1,-1,bw+1,edge+0.8,2);
    cl.mark(-1,bh-edge-0.8,bw+1,bh+1,2);
    cl.mark(-1,-1,edge+0.8,bh+1,2);
    cl.mark(bw-edge-0.8,-1,bw+1,bh+1,2);
  }

  /* ---- 1. mounting holes: corners, M3 at 3.5 mm in, with a ring of keepout
         wide enough for a washer and a screwdriver ---- */
  const mhD=MH[str(P.mount,"m3")]||MH.m3;
  if(!wrap&&str(P.mount,"m3")!=="none"&&bw>22&&bh>22){
    const inx=Math.max(3.5,mhD*1.6),ring=mhD*0.5+2.2;
    for(const sx of [0,1])for(const sy of [0,1]){
      const x=sx?bw-inx:inx,y=sy?bh-inx:inx;
      holes.push({x:x,y:y,d:mhD,kind:"mount",ring:ring});
      cl.mark(x-ring,y-ring,x+ring,y+ring,2);
    }
  }

  /* ---- 1b. fiducials: three, so the placer can find rotation as well as
         position, and never in a rotationally symmetric arrangement. They go in
         BEFORE the parts, because a fiducial a capacitor is sitting on is a
         fiducial the camera cannot see. ---- */
  if(!wrap&&bool(P.fid,true)&&bw>20&&bh>16){
    const i2=Math.max(2.5,edge+1.8);
    fids.push({x:i2,y:i2},{x:bw-i2,y:i2},{x:i2,y:bh-i2});
    for(const f of fids)cl.mark(f.x-1.6,f.y-1.6,f.x+1.6,f.y+1.6,2);
  }

  /* ---- 1c. THE LEGEND BLOCK IS A KEEPOUT. A board's name, revision and
         compliance marks go in the corner, and on a real board that corner is
         reserved before anything is placed — otherwise the text ends up
         printed across a connector, which is what it did here until it was. */
  let legBox=null;
  if(!wrap&&str(P.legend,"des")!=="none"&&bw>26&&bh>18){
    const cap=clamp(num(P.textMm,1),0.4,6);
    const lines=1+(str(P.rev,"")?1:0)+(bool(P.pbfree,true)?1:0);
    const lwid=Math.min(bw*0.42,Math.max(14,cap*13));
    let x0=edge+1;
    for(const hh of holes)if(hh.y>bh*0.55&&hh.x<bw*0.45)x0=Math.max(x0,hh.x+hh.ring+0.6);
    legBox={x0:x0,y0:bh-edge-0.8-cap*1.6*lines,x1:Math.min(bw-edge-1,x0+lwid),
            y1:bh-edge-0.6,cap:cap};
    cl.mark(legBox.x0-0.4,legBox.y0-0.4,legBox.x1+0.4,legBox.y1+0.4,2);
  }

  /* ---- 2. edge connectors: along the bottom edge, opening outward ---- */
  const wConn=fam("conn")*backK;
  let cx=Math.max(edge+2,bw*0.06,legBox?legBox.x1+1.5:0);
  if(wConn>0&&!wrap&&bh>14){
    const want=clamp(Math.round(1+dens*3),1,4);
    const pool=["usbc","rj45","dcj","jst","usd","term","usba","sma"].filter(id=>W(id)>0);
    for(let n=0;n<want&&pool.length;n++){
      const id=pool[(rnd()*pool.length)|0],p=PART_BY[id];
      const inst=place({p:p,np:0},0,0,0);
      const hw=inst.bw*0.5,hh=inst.bh*0.5;
      const x=snap(cx+hw,0.5),y=snap(bh-hh-edge-0.4,0.5);
      if(x+hw>bw-edge-1)break;
      if(!keep(inst))continue;
      place(inst,x,y,0);
      if(cl.free(inst.court[0],inst.court[1],inst.court[2],inst.court[3],3)){
        cl.mark(inst.court[0],inst.court[1],inst.court[2],inst.court[3],1);
        parts.push(inst);
        cx=x+hw+1.6+rnd()*3;
      }else cx=x+hw+1.2;
    }
  }

  /* ---- 3. the power section: in from the left, above the connector row ---- */
  const wPwr=fam("pwr")*backK;
  if(wPwr>0&&bw>24&&bh>18){
    let px=Math.max(edge+3,bw*0.08),py=bh*0.62;
    const dia=bh>34?8:6.3;
    const nCan=clamp(Math.round(1+dens*2),1,3);
    for(let i=0;i<nCan&&W("elyt")>0;i++){
      const inst=place({p:PART_BY.elyt,dia:dia},0,0,0);
      const x=snap(px+inst.bw*0.5,0.5),y=snap(py,0.5);
      place(inst,x,y,0);
      if(keep(inst)&&cl.free(inst.court[0],inst.court[1],inst.court[2],inst.court[3],3)){
        cl.mark(inst.court[0],inst.court[1],inst.court[2],inst.court[3],1);
        parts.push(inst);px=x+inst.bw*0.5+1.2;
      }else break;
    }
    if(W("ind")>0){
      const s=bh>34?7:4;
      const inst=place({p:PART_BY.ind,dia:s},0,0,0);
      const x=snap(px+inst.bw*0.5+0.6,0.5),y=snap(py,0.5);
      place(inst,x,y,0);
      if(keep(inst)&&cl.free(inst.court[0],inst.court[1],inst.court[2],inst.court[3],3)){
        cl.mark(inst.court[0],inst.court[1],inst.court[2],inst.court[3],1);parts.push(inst);
        px=x+inst.bw*0.5+1.0;
      }
    }
    if(W("dpak")>0){
      const inst=place({p:PART_BY.dpak},0,0,0);
      const x=snap(px+inst.bw*0.5+0.8,0.5),y=snap(py-inst.bh*0.2,0.5);
      place(inst,x,y,0);
      if(keep(inst)&&cl.free(inst.court[0],inst.court[1],inst.court[2],inst.court[3],3)){
        cl.mark(inst.court[0],inst.court[1],inst.court[2],inst.court[3],1);parts.push(inst);}
    }
  }

  /* ---- 4. the core part, and its ring of decoupling ---- */
  let core=null;
  const corePool=["bga","qfpb","qfp","qfn"].filter(id=>W(id)>0);
  for(const id of corePool){
    const p=PART_BY[id];
    const inst=place({p:p},0,0,0);
    if(!(inst.bw+3<bw*0.62&&inst.bh+3<bh*0.72))continue;
    if(inst.bw/mmPerPx<p.min)continue;
    const x=snap(bw*(0.40+rnd()*0.12),0.5),y=snap(bh*(0.36+rnd()*0.10),0.5);
    place(inst,x,y,0);
    if(cl.free(inst.court[0],inst.court[1],inst.court[2],inst.court[3],3)){
      cl.mark(inst.court[0],inst.court[1],inst.court[2],inst.court[3],1);
      parts.push(inst);core=inst;break;
    }
  }
  if(!core){                                   /* a small board still has a brain */
    for(const id of ["tssop","soic8","msop","sot235"]){
      if(W(id)<=0)continue;
      const p=PART_BY[id],inst=place({p:p},0,0,0);
      if(inst.bw+2>bw*0.7)continue;
      const x=snap(bw*0.45,0.5),y=snap(bh*0.42,0.5);
      place(inst,x,y,0);
      if(keep(inst)&&cl.free(inst.court[0],inst.court[1],inst.court[2],inst.court[3],3)){
        cl.mark(inst.court[0],inst.court[1],inst.court[2],inst.court[3],1);
        parts.push(inst);core=inst;break;
      }
    }
  }
  if(core&&W("c")>0){
    /* DECOUPLING GOES AS CLOSE AS THE ASSEMBLY RULES ALLOW, perpendicular to
       the package edge, which is what a decoupled part looks like from above */
    const cs=(mmPerPx<0.08)?"0402":"0603";
    const n=clamp(Math.round(4+dens*10),2,16);
    for(let i=0;i<n;i++){
      const e=i%4,t=(Math.floor(i/4)+0.5)/Math.ceil(n/4);
      /* THE ROTATED EXTENT, not the datasheet one. A capacitor stood on end
         beside the package is 1.6 mm deep, not 0.8 — offsetting by the wrong
         axis put every one of them inside the package's courtyard, and the
         whole decoupling ring was then rejected without a word. Place it
         first, ask it how big it is, then decide where it goes. */
      const rot=(e===0||e===2)?1:0;
      const inst=place({p:PART_BY.c,cs:cs},0,0,rot);
      if(!keep(inst))break;
      let x,y;
      if(e===0){x=core.x+(t-0.5)*core.bw;y=core.y-core.ch*0.5-inst.ch*0.5-0.2;}
      else if(e===1){x=core.x+core.cw*0.5+inst.cw*0.5+0.2;y=core.y+(t-0.5)*core.bh;}
      else if(e===2){x=core.x+(t-0.5)*core.bw;y=core.y+core.ch*0.5+inst.ch*0.5+0.2;}
      else{x=core.x-core.cw*0.5-inst.cw*0.5-0.2;y=core.y+(t-0.5)*core.bh;}
      place(inst,snap(x,0.25),snap(y,0.25),rot);
      if(cl.free(inst.court[0],inst.court[1],inst.court[2],inst.court[3],3)){
        cl.mark(inst.court[0],inst.court[1],inst.court[2],inst.court[3],1);
        inst.decap=true;parts.push(inst);
      }
    }
  }

  /* ---- 5. the clock, next to what it clocks ---- */
  if(core&&fam("clk")>0){
    const id=["xtal","osc","hc49"].filter(k=>W(k)>0)[0];
    if(id){
      const inst=place({p:PART_BY[id]},0,0,0);
      if(keep(inst)){
        const dirs=[[1,0],[0,1],[-1,0],[0,-1]];
        for(const d of dirs){
          const x=snap(core.x+d[0]*(core.cw*0.5+inst.bw*0.5+1.8),0.5);
          const y=snap(core.y+d[1]*(core.ch*0.5+inst.bh*0.5+1.8),0.5);
          place(inst,x,y,0);
          if(cl.free(inst.court[0],inst.court[1],inst.court[2],inst.court[3],3)){
            cl.mark(inst.court[0],inst.court[1],inst.court[2],inst.court[3],1);
            parts.push(inst);
            /* the two load capacitors, which is how you know it is a crystal */
            for(const s of [-1,1]){
              const c=place({p:PART_BY.c,cs:"0402"},0,0,0);
              const cxx=snap(x+(d[1]?s*(inst.bw*0.5+1.0):0),0.25);
              const cyy=snap(y+(d[0]?s*(inst.bh*0.5+1.0):(s*(inst.bh*0.5+1.0))),0.25);
              place(c,cxx,cyy,d[0]?1:0);
              if(keep(c)&&cl.free(c.court[0],c.court[1],c.court[2],c.court[3],3)){
                cl.mark(c.court[0],c.court[1],c.court[2],c.court[3],1);parts.push(c);}
            }
            break;
          }
        }
      }
    }
  }

  /* ---- 6. the memory bank: N identical parts, one pitch, one line ---- */
  let bank=[];
  if((bool(P.bank,true)?fam("ic"):0)>0&&core){
    const id=["soic16","tssop","bga","soic8"].filter(k=>W(k)>0)[0];
    if(id){
      const proto=place({p:PART_BY[id]},0,0,0);
      if(keep(proto)){
        const rot=(bw>bh*1.4)?0:1;
        /* THE PITCH IS THE ROTATED EXTENT. A row runs along one axis and the
           part's extent along THAT axis is its courtyard width either way,
           because an odd quarter turn swaps the two — pitching a column of
           SOIC-16s at their 7.5 mm body width overlapped every one of them by
           1.2 mm, and they came out as a single black block with leads down
           both sides. */
        const pitch=proto.fp.cw+1.6;
        const top=clamp(Math.floor((Math.min(bw,bh)*0.7)/pitch),1,6);
        const horiz=(rot===0);
        /* ALL OF THEM OR FEWER OF THEM. A bank with the third slot rejected is
           a bank at two different pitches, which is not a bus — so the whole
           row is tested before any of it is committed, and the count comes
           down until a whole row fits. */
        /* AND FURTHER OUT UNTIL IT CLEARS. The decoupling ring is standing
           on the ground immediately outside the core's courtyard, so a fixed
           three-millimetre standoff puts the bank straight through it. Step
           the standoff out rather than giving up: a bus a few millimetres
           longer is a bus, and no bank at all is not. */
        for(let n=top;n>=1&&!bank.length;n--)
        for(let off=2.0;off<=14&&!bank.length;off+=2.0){
          const snapB=cl.save();
          const want=[];
          for(let i=0;i<n;i++){
            const inst=place({p:PART_BY[id]},0,0,0);
            let x,y;
            if(horiz){x=snap(core.x+(i-(n-1)*0.5)*pitch,0.5);
                      y=snap(core.y+core.ch*0.5+proto.fp.ch*0.5+off,0.5);}
            else{x=snap(core.x+core.cw*0.5+proto.fp.ch*0.5+off,0.5);
                 y=snap(core.y+(i-(n-1)*0.5)*pitch,0.5);}
            place(inst,x,y,horiz?0:1);
            if(!cl.free(inst.court[0],inst.court[1],inst.court[2],inst.court[3],3)){want.length=0;break;}
            /* and mark as it goes, on a copy, so the members of the row see
               EACH OTHER while the row is being tested — a group tested
               against an empty grid can overlap itself */
            cl.mark(inst.court[0],inst.court[1],inst.court[2],inst.court[3],1);
            want.push(inst);
          }
          if(want.length!==n){cl.load(snapB);continue;}
          for(const inst of want){inst.bank=true;parts.push(inst);bank.push(inst);}
        }
      }
    }
  }

  /* ---- 7. the shielded corner ---- */
  if(W("shield")>0&&bw>34&&bh>28&&!wrap){
    const sw=clamp(Math.round(bw*0.16),8,22),sh=clamp(Math.round(bh*0.22),8,20);
    const inst=place({p:PART_BY.shield,sw:sw,sh:sh},0,0,0);
    const x=snap(bw-edge-2.5-inst.bw*0.5,0.5),y=snap(edge+2.5+inst.bh*0.5,0.5);
    place(inst,x,y,0);
    if(keep(inst)&&cl.free(inst.court[0],inst.court[1],inst.court[2],inst.court[3],3)){
      cl.mark(inst.court[0],inst.court[1],inst.court[2],inst.court[3],1);parts.push(inst);}
  }

  return {cl:cl,parts:parts,holes:holes,fids:fids,routes:routes,vias:vias,slk:slk,
          core:core,bank:bank,drops:drops,bw:bw,bh:bh,edge:edge,rnd:rnd,legBox:legBox,
          keep:keep,dens:dens,backK:backK,W:W,fam:fam,wrap:wrap,P:P,G:G};
}

/* ============================ the fill ============================

   SEPARATE FROM PLACEMENT ON PURPOSE, and this is the one ordering decision
   in the mode that changes how the picture reads. The structured blocks go
   down, then the BUNDLES are routed between them while there is still clear
   ground to route through, and only then is the rest of the board filled —
   so the passives flow round the tracks the way they do on a board somebody
   laid out, instead of the tracks failing to find a way through a board
   already sprinkled with capacitors.

   Doing it the other way round cost three of every four bundles.  */
function populate(P,G,L){
  const rnd=L.rnd,cl=L.cl,parts=L.parts,bw=L.bw,bh=L.bh,wrap=L.wrap;
  const dens=L.dens,backK=L.backK,W=L.W,keep=L.keep,edge=L.edge;
  const mmPerPx=G.mmPerPx;
  /* ---- 8. headers, switches and the rest of the named parts ---- */
  const scatter=[];
  const addScatter=(id,n)=>{for(let i=0;i<n;i++)scatter.push(id);};
  if(W("hdr1")>0)addScatter("hdr1",Math.round(1+dens*2));
  if(W("hdr2")>0)addScatter("hdr2",Math.round(dens*2));
  if(W("sw")>0)addScatter("sw",Math.round(dens*3));
  if(W("dipsw")>0&&dens>0.5)addScatter("dipsw",1);
  if(W("pot")>0)addScatter("pot",Math.round(dens*2));
  if(W("to220")>0)addScatter("to220",Math.round(dens*2));
  if(W("dip")>0)addScatter("dip",Math.round(dens*2));
  if(W("relay")>0&&dens>0.6)addScatter("relay",1);
  if(W("led")>0)addScatter("led",Math.round(1+dens*4));
  if(W("ledc")>0)addScatter("ledc",Math.round(dens*4));
  if(W("tant")>0)addScatter("tant",Math.round(1+dens*4));
  if(W("rarr")>0)addScatter("rarr",Math.round(dens*3));
  if(W("melf")>0)addScatter("melf",Math.round(dens*3));
  if(W("sot23")>0)addScatter("sot23",Math.round(1+dens*6));
  if(W("sod")>0)addScatter("sod",Math.round(1+dens*5));
  if(W("soic8")>0)addScatter("soic8",Math.round(dens*3));
  if(W("tssop")>0)addScatter("tssop",Math.round(dens*2));
  if(W("msop")>0)addScatter("msop",Math.round(dens*2));
  if(W("xtal")>0&&dens>0.4)addScatter("xtal",1);
  if(W("fuse")>0)addScatter("fuse",Math.round(dens*2));
  if(W("tp")>0)addScatter("tp",Math.round(2+dens*10));

  const tries=60;
  for(const id of scatter){
    const p=PART_BY[id];
    if(!p)continue;
    const cs=CHIP_KEYS[clamp(Math.round(num(P.chipSz,1)),0,5)];
    for(let t=0;t<tries;t++){
      const inst=place({p:p,cs:cs,tc:["A","B","C","D"][(rnd()*4)|0],
        dia:[4,6,7][(rnd()*3)|0],cols:2+((rnd()*8)|0),np:4},0,0,0);
      if(!keep(inst))break;
      const rot=p.edge?0:((rnd()*4)|0);
      const inst2=place(inst,0,0,rot);
      const hw=inst2.cw*0.5,hh=inst2.ch*0.5;
      const x=snap(hw+rnd()*(bw-hw*2),0.5),y=snap(hh+rnd()*(bh-hh*2),0.5);
      place(inst2,x,y,rot);
      if(cl.free(inst2.court[0],inst2.court[1],inst2.court[2],inst2.court[3],7)){
        cl.mark(inst2.court[0],inst2.court[1],inst2.court[2],inst2.court[3],1);
        parts.push(inst2);break;
      }
    }
  }

  /* ---- 9. the passive fill: what actually makes a board look busy ---- */
  /* WEIGHTED, NOT UNIFORM. A board is mostly capacitors, then resistors, and
     ferrite beads are a handful — offering the three equally gives fifty
     ferrite beads and a readout nobody believes. */
  const clus=[];
  for(const q of parts)if(q.p.fam==="core"||q.p.fam==="ic"||q.p.fam==="pwr"||q.p.fam==="conn")
    clus.push([q.x,q.y]);
  const nExtra=clamp(Math.round(2+dens*5),2,8);
  for(let i=0;i<nExtra;i++)clus.push([edge+2+rnd()*(bw-edge*2-4),edge+2+rnd()*(bh-edge*2-4)]);

  const fillPool=[];
  if(W("c")>0)for(let i=0;i<5;i++)fillPool.push("c");
  if(W("r")>0)for(let i=0;i<3;i++)fillPool.push("r");
  if(W("fb")>0)fillPool.push("fb");
  if(fillPool.length){
    const area=bw*bh;
    const want=Math.round(area*0.012*dens*backK*(1+num(P.fill,0.5)*2));
    const csIdx=clamp(Math.round(num(P.chipSz,1)),0,5);
    for(let i=0;i<want;i++){
      const id=fillPool[(rnd()*fillPool.length)|0];
      const cs=CHIP_KEYS[clamp(csIdx+((rnd()<0.25)?1:0),0,5)];
      const inst=place({p:PART_BY[id],cs:cs},0,0,0);
      if(!keep(inst))break;
      let placed=false;
      /* CLUSTERED. Scattering the fill uniformly is the one thing that reads
         as noise rather than as a layout: a real board has groups of passives
         belonging to one thing and clear channels between them, so each part
         is offered a place near one of a handful of centres first and only
         falls back to anywhere at all. */
      const cen=clus[(rnd()*clus.length)|0];
      for(let t=0;t<24&&!placed;t++){
        const rot=(rnd()<0.5)?0:1;
        place(inst,0,0,rot);
        const hw=inst.cw*0.5,hh=inst.ch*0.5;
        const near=t<16&&cen;
        const sp=Math.min(bw,bh)*0.16;
        let x=near?(cen[0]+(rnd()+rnd()-1)*sp):(hw+rnd()*(bw-hw*2));
        let y=near?(cen[1]+(rnd()+rnd()-1)*sp):(hh+rnd()*(bh-hh*2));
        if(wrap){x=((x%bw)+bw)%bw;y=((y%bh)+bh)%bh;}
        else{x=clamp(x,hw,bw-hw);y=clamp(y,hh,bh-hh);}
        x=snap(x,0.25);y=snap(y,0.25);
        place(inst,x,y,rot);
        /* 7, not 3: the bundles are already down, and a pad on top of a track
           is a short. This is also what gives the fill its channels. */
        if(cl.free(inst.court[0],inst.court[1],inst.court[2],inst.court[3],7)){
          cl.mark(inst.court[0],inst.court[1],inst.court[2],inst.court[3],1);
          parts.push(inst);placed=true;
        }
      }
    }
  }

  /* ---- 10. designators, numbered along the board the way a board is read ---- */
  const seq={};
  parts.slice().sort((a,b)=>(a.y-b.y)||(a.x-b.x)).forEach(function(inst){
    const d=inst.p.des;
    seq[d]=(seq[d]||0)+1;
    inst.des=d+seq[d];
    inst.val=valueOf(inst,rnd);
  });

  return L;
}

/* HOW MANY LAYERS THERE ARE CHANGES WHAT IS ON THIS ONE. On a two-layer board
   a signal has nowhere to go but along this face, so what you see is tracks.
   On a six-layer board it goes DOWN: the inner signal layers carry it, so what
   you see is a field of fan-out vias dropping through a plane, and the planes
   need tying together more often.

   Those two are measurable and they are what this returns. It deliberately
   does NOT scale the bundle count, which was the first thing tried: how many
   bundles get laid is set by how much clear lane there is, not by the budget,
   so scaling the budget moved nothing and would have been a control that lies
   about what it does. */
function layerMix(P){
  const ly=clamp(P.layers|0||2,2,8);
  return ly<=2?{fan:0.72,stitch:1.35,ly:ly}
        :ly<=4?{fan:1.00,stitch:1.00,ly:ly}
              :{fan:1.20,stitch:0.74,ly:ly};
}

/* ============================ routing ============================

   Not an autorouter — an autorouter's output is not what a good board looks
   like anyway. What a good board looks like from above is a handful of
   BUNDLES between the parts that talk to each other, a FAN-OUT field of short
   stubs and vias around everything fine-pitch, fat traces where the current
   is, and a plane holding the rest. Those four things, in that order, are
   what this builds.  */

function routeBuses(P,G,L){
  const rnd=L.rnd,cl=L.cl;
  const w=clamp(num(P.traceMil,8),1,80)*MIL;             /* trace width, mm */
  const cw=clamp(num(P.clearMil,8),1,80)*MIL;            /* clearance, mm */
  const cham=clamp(num(P.chamMm,0.6),0,4);
  const style=str(P.rstyle,"45");
  const vd=VIA.drill,vp=VIA.drill+VIA.ring*2;
  const routes=L.routes,vias=L.vias;
  const bw=L.bw,bh=L.bh;
  const ROUTE=4;                                         /* the claims bit */

  const shape=(pts)=>style==="90"?pts:chamfer(pts,style==="arc"?cham*1.6:cham);

  /* THE OUTERMOST ROW ON ONE SIDE, in order along that side. Taking every pin
     that happens to face this way is wrong for a ball grid: two thirds of a
     12 x 12 array face "right" by that test, the middle of them sit under the
     package, and a bundle starting there starts inside the part it is leaving.
     One row is what a bundle can actually escape from. */
  function sidePins(inst,dir){
    const ax=dir[0]!==0,sg=ax?dir[0]:dir[1];
    let cand=inst.pins.filter(pn=>pn.d[0]===dir[0]&&pn.d[1]===dir[1]&&!pn.used);
    if(cand.length<2)return cand;
    let best=-1e9;
    for(const pn of cand){const v=(ax?pn.x:pn.y)*sg;if(v>best)best=v;}
    cand=cand.filter(pn=>((ax?pn.x:pn.y)*sg)>best-0.35);
    cand.sort((a,b)=>ax?(a.y-b.y):(a.x-b.x));
    return cand;
  }
  /* how far a trace has to travel to be clear of the part it is leaving */
  function escapeOf(inst,dir,pin){
    const ax=dir[0]!==0;
    const edge=ax?(inst.x+dir[0]*inst.cw*0.5):(inst.y+dir[1]*inst.ch*0.5);
    const at=ax?pin.x:pin.y;
    return Math.abs(edge-at)+0.8;
  }
  function pitchOf(run){
    if(run.length<2)return 0.8;
    return Math.hypot(run[1].x-run[0].x,run[1].y-run[0].y);
  }

  /* ---- 1. bundles ---- */
  function bundle(src,srcDir,dst,dstDir,k,net){
    const run=sidePins(src,srcDir);
    if(run.length<2)return 0;
    const lo=L.edge+0.9,hiX=bw-L.edge-0.9,hiY=bh-L.edge-0.9;
    const cx2=(v)=>L.wrap?v:clamp(v,lo,hiX),cy2=(v)=>L.wrap?v:clamp(v,lo,hiY);
    /* NARROW IT UNTIL IT FITS, rather than dropping it. Eight traces abreast
       want six millimetres of clear lane and often there is not one; four do,
       and four traces going the right way is a bus. So the whole bundle is
       TESTED before any of it is committed — a bundle half laid is worse than
       none, because the half that failed leaves its pins looking connected. */
    const top=Math.min(k,run.length,dst.pts.length);
    for(let n=top;n>=2;n=(n>4?(n>>1):(n-1))){
      const start=Math.max(0,Math.floor((run.length-n)*0.5));
      const mem=run.slice(start,start+n);
      const pitch=Math.max(w+cw,pitchOf(mem));
      const esc=Math.max(1.2,pitch*2.5);
      const mid={x:(mem[0].x+mem[n-1].x)*0.5,y:(mem[0].y+mem[n-1].y)*0.5};
      const dm=dst.mid,dd=dstDir;
      const sEsc=escapeOf(src,srcDir,mem[0]);
      const dEsc=dst.pins?escapeOf(dst.owner||src,dd,dst.pts[0]):0.8;
      const centre=manhattan(cx2(mid.x+srcDir[0]*sEsc),cy2(mid.y+srcDir[1]*sEsc),srcDir,
                             cx2(dm.x+dd[0]*dEsc),cy2(dm.y+dd[1]*dEsc),dd,esc);
      let dsel=dst.pts.slice(Math.max(0,Math.floor((dst.pts.length-n)*0.5)));
      /* WHICH END OF THE FAR ROW EACH MEMBER GOES TO. Member i is offset
         d_i along the normal of the path's LAST segment, so if the far row
         runs the other way along that normal the members all cross each
         other — and on one layer a crossing is a short. Read the direction
         off the geometry and reverse the row if it disagrees. */
      if(dsel.length>1&&centre.length>1){
        const q0=centre[centre.length-2],q1=centre[centre.length-1];
        const lx=q1[0]-q0[0],ly=q1[1]-q0[1],ll=Math.hypot(lx,ly)||1;
        const nlx=-ly/ll,nly=lx/ll;
        const rx=dsel[dsel.length-1].x-dsel[0].x,ry=dsel[dsel.length-1].y-dsel[0].y;
        if(nlx*rx+nly*ry<0)dsel=dsel.slice().reverse();
      }
      const snap2=cl.save();
      const paths=[];
      let ok=0;
      for(let i=0;i<n;i++){
        const d=(i-(n-1)*0.5)*pitch;
        const off=offsetPoly(centre,d);
        const end=dsel[i]||dsel[dsel.length-1];
        const pts=shape([[mem[i].x,mem[i].y]].concat(off,[[end.x,end.y]]));
        if(!cl.freeLine(pts,w*0.5+cw,ROUTE|2))continue;
        cl.markLine(pts,w*0.5+cw*0.5,ROUTE);
        paths.push({pts:pts,i:i,end:end});ok++;
      }
      if(ok<Math.max(2,Math.ceil(n*0.6))){cl.load(snap2);continue;}
      for(const q of paths){
        mem[q.i].used=true;
        if(dst.pins&&q.end&&q.end.used!==undefined)q.end.used=true;
        routes.push({pts:q.pts,w:w,net:net||"sig"});
      }
      return ok;
    }
    return 0;
  }
  /* WHICH FACE OF A PART LOOKS AT THE OTHER ONE. Taking the sign of the
     vector between their centres is not the same question: two parts a
     column apart are mostly displaced along the column, so the vector says
     "up" when the row of pins that can actually reach is on the side. Ask
     each part which of its own faces both points that way and has a row to
     offer, and take the fullest. */
  function facing(tgt,fx,fy){
    const vx=fx-tgt.x,vy=fy-tgt.y;
    let best=null,bs=1;
    for(const d of [[1,0],[-1,0],[0,1],[0,-1]]){
      if(d[0]*vx+d[1]*vy<=0)continue;
      const k=sidePins(tgt,d).length;
      if(k>bs){bs=k;best=d;}
    }
    return best;
  }

  /* a destination: either a facing row of pins on another part, or a point on
     the board edge, which is what a bundle heading off-board looks like */
  function pinTarget(inst,dir,n){
    const run=sidePins(inst,dir);
    if(run.length<2)return null;
    const k=Math.min(n,run.length);
    const st=Math.max(0,Math.floor((run.length-k)*0.5));
    const sel=run.slice(st,st+k);
    return {pts:sel,pins:sel,owner:inst,
            mid:{x:(sel[0].x+sel[k-1].x)*0.5,y:(sel[0].y+sel[k-1].y)*0.5}};
  }
  function edgeTarget(x,y,dir,n,pitch){
    const pts=[],px=dir[0]?0:pitch,py=dir[0]?pitch:0;
    for(let i=0;i<n;i++)pts.push({x:x+(i-(n-1)*0.5)*px,y:y+(i-(n-1)*0.5)*py});
    return {pts:pts,pins:null,mid:{x:x,y:y}};
  }

  const busN=clamp(P.busN|0,0,10);
  const wide=clamp(Math.round(num(P.busW,6)),2,24);
  if(L.core&&busN>0){
    const dirs=[[0,1],[1,0],[0,-1],[-1,0]];
    let laid=0;
    /* the memory bank first: that is the one bundle a board always has */
    for(let b=0;b<L.bank.length&&laid<busN;b++){
      const tgt=L.bank[b];
      const sd=facing(L.core,tgt.x,tgt.y),td=facing(tgt,L.core.x,L.core.y);
      if(!sd||!td)continue;
      const t=pinTarget(tgt,td,wide);
      if(t&&bundle(L.core,sd,t,td,Math.min(wide,t.pts.length),"bus"))laid++;
    }
    /* then whatever else is big enough to be worth a bundle */
    const others=L.parts.filter(q=>q!==L.core&&!q.bank&&q.pins.length>=4&&
      (q.p.fam==="conn"||q.p.fam==="ic"||q.p.fam==="core"));
    for(let i=0;i<others.length&&laid<busN;i++){
      const tgt=others[(i*7+3)%others.length];
      const sd=facing(L.core,tgt.x,tgt.y),td=facing(tgt,L.core.x,L.core.y);
      if(!sd||!td)continue;
      const t=pinTarget(tgt,td,Math.max(3,wide>>1));
      if(t&&bundle(L.core,sd,t,td,Math.min(wide,t.pts.length),"bus"))laid++;
    }
    /* and one heading off the board, because something always does */
    if(laid<busN){
      const d=dirs[(rnd()*4)|0];
      const n=Math.max(3,wide>>1),pitch=Math.max(w+cw,0.4);
      /* it ends at the pour pullback, which is as close to the cut as any
         copper is allowed to get */
      const m=L.edge+1.0;
      const ex=d[0]?(d[0]>0?bw-m:m):clamp(L.core.x,m+3,bw-m-3);
      const ey=d[1]?(d[1]>0?bh-m:m):clamp(L.core.y,m+3,bh-m-3);
      const sd=facing(L.core,ex,ey);
      if(sd)bundle(L.core,sd,edgeTarget(ex,ey,sd,n,pitch),[-sd[0],-sd[1]],n,"bus");
    }
  }

  /* ---- 2. the differential pair: two traces coupled, and it reads as a pair
         only if they stay coupled round the corner ---- */
  const nDiff=clamp(P.diffN|0,0,6);
  if(L.core&&nDiff>0){
    const gap=Math.max(cw,w*0.9);
    for(let i=0;i<nDiff;i++){
      const d=[[0,1],[1,0],[0,-1],[-1,0]][(i+1)&3];
      const run=sidePins(L.core,d);
      if(run.length<2)continue;
      const a=run[(rnd()*Math.max(1,run.length-1))|0];
      const esc=1.4;
      const tx=clamp(a.x+d[0]*(6+rnd()*14)+(d[0]?0:(rnd()-0.5)*16),L.edge+1,bw-L.edge-1);
      const ty=clamp(a.y+d[1]*(6+rnd()*14)+(d[1]?0:(rnd()-0.5)*16),L.edge+1,bh-L.edge-1);
      const centre=manhattan(a.x+d[0]*esc,a.y+d[1]*esc,d,tx,ty,[-d[0],-d[1]],esc);
      const snap3=cl.save();
      let ok=true;
      const pair=[];
      for(const s of [-0.5,0.5]){
        const pts=shape(offsetPoly(centre,s*(w+gap)));
        if(!cl.freeLine(pts,w*0.5+cw,ROUTE|2)){ok=false;break;}
        cl.markLine(pts,w*0.5+cw*0.5,ROUTE);
        pair.push(pts);
      }
      if(!ok){cl.load(snap3);continue;}
      for(const pts of pair)routes.push({pts:pts,w:w,net:"diff"});
      vias.push({x:tx,y:ty,drill:vd,pad:vp,gnd:false});
      a.used=true;
    }
  }

  /* ---- 3. length matching: the meander. A bus whose members have to arrive
         together gets the difference walked off in a serpentine, and the tooth
         pitch is bounded below by the clearance because that is what bounds it
         on a real board. ---- */
  const serp=clamp(num(P.serp,0.25),0,1);
  if(serp>0){
    const cand=routes.filter(r=>r.net==="bus");
    const n=Math.round(cand.length*serp*0.5);
    for(let i=0;i<n;i++){
      const r=cand[(i*5+2)%Math.max(1,cand.length)];
      if(!r||r.done)continue;
      /* find its longest straight run */
      let bi=-1,bl=0;
      for(let k=0;k<r.pts.length-1;k++){
        const l=Math.hypot(r.pts[k+1][0]-r.pts[k][0],r.pts[k+1][1]-r.pts[k][1]);
        if(l>bl){bl=l;bi=k;}
      }
      if(bi<0||bl<4)continue;
      const a=r.pts[bi],b=r.pts[bi+1];
      const dx=(b[0]-a[0])/bl,dy=(b[1]-a[1])/bl,nx=-dy,ny=dx;
      const amp=Math.max(w*2.5,(w+cw)*2.5)*(0.7+rnd()*0.8);
      const teeth=clamp(Math.floor(bl/(amp*1.1)),2,14);
      const seg=bl/teeth;
      const ins=[];
      for(let t=0;t<teeth;t++){
        const s0=seg*t,s1=seg*(t+0.5),s2=seg*(t+1);
        const sgn=(t&1)?-1:1;
        ins.push([a[0]+dx*s0,a[1]+dy*s0]);
        ins.push([a[0]+dx*s0+nx*amp*sgn,a[1]+dy*s0+ny*amp*sgn]);
        ins.push([a[0]+dx*s1+nx*amp*sgn,a[1]+dy*s1+ny*amp*sgn]);
        ins.push([a[0]+dx*s1,a[1]+dy*s1]);
      }
      const pts=shape(r.pts.slice(0,bi+1).concat(ins,r.pts.slice(bi+1)));
      if(!cl.freeLine(ins,w*0.5+cw,ROUTE|2|1))continue;
      cl.markLine(ins,w*0.5+cw*0.5,ROUTE);
      r.pts=pts;r.done=true;r.serp=true;
    }
  }

  L.w=w;L.cwm=cw;
  return L;
}

/* everything that can only be done once the board is full: the short nets
   between neighbours, the fan-out nobody bundled, the fat power copper, the
   thermal arrays and the stitching. */
function routeRest(P,G,L){
  const rnd=L.rnd,cl=L.cl;
  const w=L.w,cw=L.cwm;
  const cham=clamp(num(P.chamMm,0.6),0,4);
  const style=str(P.rstyle,"45");
  const vd=VIA.drill,vp=VIA.drill+VIA.ring*2;
  const routes=L.routes,vias=L.vias;
  const bw=L.bw,bh=L.bh;
  const ROUTE=4;
  const tent=bool(P.tent,true);
  const shape=(pts)=>style==="90"?pts:chamfer(pts,style==="arc"?cham*1.6:cham);

  /* ---- 4b. LOCAL NETS. Bundles and fan-out between them cover the parts
         that talk to a processor, and leave the rest of the board looking
         unwired — but most of the copper on a real board is short two-pin
         nets between neighbours: a capacitor to the pin it decouples, a
         resistor to the gate it pulls, a diode to the rail. So pins that
         nobody has claimed are paired with the nearest unclaimed pin on
         ANOTHER part and routed, nearest first, which is also the order a
         person would do it in. ---- */
  const netA=clamp(num(P.nets,0.6),0,1);
  if(netA>0){
    const free=[];
    for(let pi=0;pi<L.parts.length;pi++){
      const inst=L.parts[pi];
      if(inst.p.kind==="shield")continue;
      for(const pn of inst.pins)if(!pn.used)free.push({p:pn,owner:pi});
    }
    /* a coarse bucket grid, so finding a neighbour is not n-squared */
    const cell=Math.max(2.5,Math.min(bw,bh)*0.08);
    const gx=Math.max(1,Math.ceil(bw/cell)),gy=Math.max(1,Math.ceil(bh/cell));
    const buck=new Array(gx*gy);
    for(const f of free){
      const i=clamp(Math.floor(f.p.x/cell),0,gx-1),j=clamp(Math.floor(f.p.y/cell),0,gy-1);
      (buck[j*gx+i]||(buck[j*gx+i]=[])).push(f);
    }
    const reach=Math.min(Math.max(bw,bh)*0.30,18);
    const want=Math.round(free.length*netA*0.45);
    let made=0;
    for(const f of free){
      if(made>=want)break;
      if(f.p.used)continue;
      const ci=clamp(Math.floor(f.p.x/cell),0,gx-1),cj=clamp(Math.floor(f.p.y/cell),0,gy-1);
      let best=null,bd=1e9;
      for(let j=Math.max(0,cj-1);j<=Math.min(gy-1,cj+1);j++)
        for(let i=Math.max(0,ci-1);i<=Math.min(gx-1,ci+1);i++){
          const b=buck[j*gx+i];
          if(!b)continue;
          for(const q of b){
            if(q.p.used||q.owner===f.owner)continue;
            const d=Math.hypot(q.p.x-f.p.x,q.p.y-f.p.y);
            if(d<bd&&d<reach&&d>0.4){bd=d;best=q;}
          }
        }
      if(!best)continue;
      const a=f.p,z=best.p;
      const esc=Math.max(0.35,Math.min(1.1,bd*0.25));
      const pts=shape(manhattan(a.x+a.d[0]*esc,a.y+a.d[1]*esc,a.d,
                                z.x+z.d[0]*esc,z.y+z.d[1]*esc,z.d,esc));
      const full=[[a.x,a.y]].concat(pts,[[z.x,z.y]]);
      /* ROUTE|2, not 2. Testing only the keepout let a short net cross a
         bundle that was already down — and on one copper layer that is a
         short, not a crossing. The interior of the path is also tested
         against the parts, while the two end segments are not, because they
         start and finish inside their own pads' courtyards by definition. */
      if(!cl.freeLine(full,w*0.5+cw,ROUTE|2))continue;
      if(pts.length>3&&!cl.freeLine(pts.slice(1,pts.length-1),w*0.5+cw,ROUTE|2|1))continue;
      cl.markLine(full,w*0.5+cw*0.5,ROUTE);
      routes.push({pts:full,w:w,net:"net"});
      a.used=z.used=true;made++;
    }
    L.nets=made;
  }

  /* ---- 4. fan-out: a stub and a via off every pin nobody bundled. On a
         fine-pitch part this is most of the copper you can see, and it is why
         the ground around a processor looks like a field of dots. ---- */
  const LY=layerMix(P);
  const fanA=clamp(num(P.fan,0.85)*LY.fan,0,1);
  for(const inst of L.parts){
    if(inst.p.kind==="tp")continue;
    const fine=inst.p.fine||inst.p.kind==="bga";
    for(const pn of inst.pins){
      if(pn.used)continue;
      if(rnd()>fanA*(fine?1:0.8))continue;
      const len=fine?(0.45+rnd()*0.55):(0.6+rnd()*1.4);
      const ex=pn.x+pn.d[0]*len,ey=pn.y+pn.d[1]*len;
      const pts=[[pn.x,pn.y],[ex,ey]];
      if(!cl.freeLine(pts,w*0.5+cw*0.8,ROUTE|2))continue;
      const room=cl.free(ex-vp*0.5-cw,ey-vp*0.5-cw,ex+vp*0.5+cw,ey+vp*0.5+cw,ROUTE|2|1);
      cl.markLine(pts,w*0.5+cw*0.5,ROUTE);
      routes.push({pts:pts,w:w,net:"fan"});
      if(room&&rnd()<0.8){
        vias.push({x:ex,y:ey,drill:vd,pad:vp,tent:tent});
        cl.mark(ex-vp*0.5,ey-vp*0.5,ex+vp*0.5,ey+vp*0.5,ROUTE);
      }
      pn.used=true;
    }
  }

  /* ---- 5. fat copper where the current is ---- */
  const pw=w*clamp(num(P.pwrMul,3),1,10);
  const pwrParts=L.parts.filter(q=>q.p.fam==="pwr"||q.p.kind==="ind"||q.p.kind==="elyt");
  for(let i=0;i<pwrParts.length-1;i++){
    const a=pwrParts[i],b=pwrParts[i+1];
    const pa=a.pins[a.pins.length-1],pb=b.pins[0];
    if(!pa||!pb)continue;
    const pts=shape(manhattan(pa.x+pa.d[0]*0.8,pa.y+pa.d[1]*0.8,pa.d,
                              pb.x+pb.d[0]*0.8,pb.y+pb.d[1]*0.8,pb.d,1.4));
    const full=[[pa.x,pa.y]].concat(pts,[[pb.x,pb.y]]);
    if(!cl.freeLine(full,pw*0.5+cw,ROUTE|2))continue;
    cl.markLine(full,pw*0.5+cw*0.5,ROUTE);
    routes.push({pts:full,w:pw,net:"pwr"});
    pa.used=pb.used=true;
  }

  /* ---- 6. thermal vias: an array under every thermal pad, because that is
         the only way heat leaves a leadless package ---- */
  if(bool(P.thermV,true))for(const inst of L.parts){
    for(const pd of inst.pads){
      if(!pd.thermal)continue;
      const s=Math.min(pd.w,pd.h),pitch=Math.max(vp+0.25,s/3.2);
      const n=Math.max(2,Math.floor(s/pitch));
      for(let j=0;j<n;j++)for(let i=0;i<n;i++)
        vias.push({x:pd.x+(i-(n-1)*0.5)*pitch,y:pd.y+(j-(n-1)*0.5)*pitch,
                   drill:vd,pad:vd+0.12,tent:false,thermal:true});
    }
    if(inst.p.kind==="dpak"||inst.p.kind==="to220"){
      for(let j=0;j<2;j++)for(let i=0;i<3;i++)
        vias.push({x:inst.x+(i-1)*1.2,y:inst.y+(j-0.5)*1.2,drill:vd,pad:vp,tent:false,thermal:true});
    }
  }

  /* ---- 7. stitching: the plane is only a plane if it is tied together ---- */
  const st=num(P.stitchMm,0)*LY.stitch;
  if(st>0.8&&str(P.pour,"gnd")!=="none"){
    const m=L.edge+vp*0.5+cw;
    for(let y=m;y<bh-m;y+=st)for(let x=m;x<bw-m;x+=st){
      const jx=x+(hashi(x*7,y*13,G.seedN)-0.5)*st*0.35;
      const jy=y+(hashi(x*11,y*5,G.seedN+7)-0.5)*st*0.35;
      if(!cl.free(jx-vp*0.5-cw,jy-vp*0.5-cw,jx+vp*0.5+cw,jy+vp*0.5+cw,7))continue;
      vias.push({x:jx,y:jy,drill:vd,pad:vp,tent:tent,gnd:true});
      cl.mark(jx-vp*0.5,jy-vp*0.5,jx+vp*0.5,jy+vp*0.5,ROUTE);
    }
  }
  L.pw=pw;
  return L;
}

/* one call, in the order a board is actually designed */
function route(P,G,L){
  routeBuses(P,G,L);
  populate(P,G,L);
  routeRest(P,G,L);
  return L;
}

/* ============================ what parts are made of ============================
   Index into this is what the component pass writes into its green channel, so
   the composite can ask "what is this texel made of" once rather than
   re-deriving it. Roughness and metallic are the honest ones: a moulded body
   is a dielectric and reads 0, a solder fillet and a gold pin read 1.  */
const MAT=[null,
  {col:"#17181b",rgh:0.42,met:0,   n:"epoxy moulding"},      /*  1 IC body */
  {col:"#2a2320",rgh:0.38,met:0,   n:"resistor element"},    /*  2 thick-film resistor */
  {col:"#b9a488",rgh:0.55,met:0,   n:"ceramic dielectric"},  /*  3 MLCC body */
  {col:"#b6bbc0",rgh:0.26,met:1,   n:"solder"},              /*  4 solder, leads, fillets */
  {col:"#c6a252",rgh:0.20,met:1,   n:"gold plating"},        /*  5 gold pins and fingers */
  {col:"#b9bdc1",rgh:0.22,met:1,   n:"aluminium"},           /*  6 can tops, crystal lids */
  {col:"#23252a",rgh:0.62,met:0,   n:"ferrite"},             /*  7 inductor core */
  {col:"#c4761a",rgh:0.45,met:0,   n:"tantalum moulding"},   /*  8 tantalum */
  {col:"#e3e1da",rgh:0.48,met:0,   n:"white nylon"},         /*  9 connector insert */
  {col:"#15161a",rgh:0.50,met:0,   n:"black nylon"},         /* 10 shells and headers */
  {col:"#efeee8",rgh:0.10,met:0,   n:"LED lens"},            /* 11 lens */
  {col:"#c9ced3",rgh:0.24,met:1,   n:"nickel-plated steel"}, /* 12 shells, shield cans */
  {col:"#1d5c34",rgh:0.52,met:0,   n:"terminal block"},      /* 13 screw terminals */
  {col:"#8d9095",rgh:0.55,met:0,   n:"laser marking"},       /* 14 part marking */
  {col:"#b1682f",rgh:0.42,met:1,   n:"bare copper"},         /* 15 exposed copper */
  {col:"#0d0e10",rgh:0.30,met:0,   n:"dark glass"},          /* 16 windows */
  {col:"#f6f4ec",rgh:0.09,met:0,   n:"LED lens, lit"},       /* 17 lens, emitting */
  {col:"#8e2a24",rgh:0.30,met:0,   n:"enamelled wire"}       /* 18 a bodge wire */
];
const MAT_LIT=17;

/* ============================ records ============================
   One record type per primitive, so the same shape can be drawn as copper AND
   grown by the clearance to punch its own anti-pad out of the plane. Drawing
   the anti-pads from a second, separately built list is how a fab gets a
   plane with a hole in the wrong place.  */
function recR(x,y,w,h,rr){return {t:"r",x:x,y:y,w:w,h:h,rr:rr||0,
  bb:[x-w*0.5,y-h*0.5,x+w*0.5,y+h*0.5]};}
function recC(x,y,r){return {t:"c",x:x,y:y,r:r,bb:[x-r,y-r,x+r,y+r]};}
function recS(pts,lw){
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const p of pts){if(p[0]<x0)x0=p[0];if(p[0]>x1)x1=p[0];if(p[1]<y0)y0=p[1];if(p[1]>y1)y1=p[1];}
  return {t:"s",pts:pts,lw:lw,bb:[x0-lw,y0-lw,x1+lw,y1+lw]};
}
function recP(pts){
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const p of pts){if(p[0]<x0)x0=p[0];if(p[0]>x1)x1=p[0];if(p[1]<y0)y0=p[1];if(p[1]>y1)y1=p[1];}
  return {t:"p",pts:pts,bb:[x0,y0,x1,y1]};
}
function recG(s,x,y,cap,lw,al,rot){
  const w=glyWidth(s,0)*cap/GLY_CAP;
  const x0=al==="c"?-w*0.5:al==="r"?-w:0;
  const r=Math.abs(rot||0)>0.01?Math.max(w,cap)+lw:0;
  return {t:"g",s:s,x:x,y:y,cap:cap,lw:lw,al:al||"c",rot:rot||0,
    bb:r?[x-r,y-r,x+r,y+r]:[x+x0-lw,y-cap-lw,x+x0+w+lw,y+lw*2]};
}
function recRel(x,y,ro,ri,sp){return {t:"rl",x:x,y:y,ro:ro,ri:ri,sp:sp,
  bb:[x-ro,y-ro,x+ro,y+ro]};}

function drawRec(g,rc,grow){
  const gr=grow||0;
  if(rc.t==="r"){rrectPath(g,rc.x-rc.w*0.5-gr,rc.y-rc.h*0.5-gr,rc.w+gr*2,rc.h+gr*2,
      (rc.rr?rc.rr+gr:(gr>0?gr:0)));g.fill();}
  else if(rc.t==="c"){circPath(g,rc.x,rc.y,rc.r+gr);g.fill();}
  else if(rc.t==="s"){g.lineWidth=Math.max(1e-4,rc.lw+gr*2);g.lineCap="round";g.lineJoin="round";
    polyPath(g,rc.pts,false);g.stroke();}
  else if(rc.t==="p"){polyPath(g,rc.pts,true);g.fill();
    if(gr>0){g.lineWidth=gr*2;g.lineJoin="round";g.stroke();}}
  else if(rc.t==="g"){glyStroke(g,rc.s,rc.x,rc.y,rc.cap,rc.rot||0,rc.al||"c",rc.lw);}
  else if(rc.t==="rl"){
    /* THERMAL RELIEF. A through-hole pad tied to a plane is not flooded — it
       is joined by four spokes, because a flooded pad wicks the heat out of
       the iron and the joint never wets. So the copper here is the pad, a
       ring at the clearance, and the spokes across the gap. */
    circPath(g,rc.x,rc.y,rc.ro+gr);g.fill();
  }
}
/* the spokes, drawn back into the plane after the anti-pad has taken the ring
   out of it */
function drawSpokes(g,rc){
  g.lineWidth=rc.sp;g.lineCap="butt";
  g.beginPath();
  for(let k=0;k<4;k++){
    const a=k*Math.PI*0.5+Math.PI*0.25;
    g.moveTo(rc.x+Math.cos(a)*rc.ri*0.6,rc.y+Math.sin(a)*rc.ri*0.6);
    g.lineTo(rc.x+Math.cos(a)*rc.ro*1.35,rc.y+Math.sin(a)*rc.ro*1.35);
  }
  g.stroke();
}

/* ============================ silkscreen ============================ */
function glyStroke(g,s,x,y,cap,rot,align,lw){
  const u=cap/GLY_CAP;                        /* glyph units -> mm */
  const w=glyWidth(s,0)*u;
  g.save();
  g.translate(x,y);
  if(rot)g.rotate(rot);
  const x0=align==="c"?-w*0.5:align==="r"?-w:0;
  g.lineWidth=lw;g.lineCap="round";g.lineJoin="round";
  g.beginPath();
  for(let i=0;i<s.length;i++){
    const ch=s.charAt(i).toUpperCase(),gl=GLY[ch];
    const ox=x0+i*GLY_ADV*u;
    if(!gl)continue;
    for(const stroke of gl){
      g.moveTo(ox+stroke[0][0]*u,-cap+stroke[0][1]*u);
      for(let k=1;k<stroke.length;k++)g.lineTo(ox+stroke[k][0]*u,-cap+stroke[k][1]*u);
    }
  }
  g.stroke();
  g.restore();
}

function silk(P,G,L){
  const out=[];
  /* A SEPARATE GRID OF WHERE THE PARTS ARE, so a designator can be offered
     somewhere it will still be readable. Silk over copper is normal and silk
     over a mask opening is a defect the fab clips; silk over the BODY of the
     part it names is neither, it is just illegible once the part is fitted. */
  const sg=new Claims(L.bw,L.bh,0.5).setWrap(!!L.wrap);
  for(const q of L.parts)sg.mark(q.x-q.bw*0.5,q.y-q.bh*0.5,q.x+q.bw*0.5,q.y+q.bh*0.5,1);
  const lw=Math.max(0.08,num(P.slkMil,6)*MIL);
  const cap=clamp(num(P.textMm,1.0),0.4,6);
  const legend=str(P.legend,"des");
  const outl=bool(P.slkOut,true);
  const textPx=cap/G.mmPerPx;
  const okText=legend!=="none"&&textPx>=3.2;
  const drops={};

  for(const inst of L.parts){
    const k=inst.p.kind;
    /* the outline: the body, not the courtyard, because that is what the
       assembler lines the part up against */
    /* A fab does not outline a two-terminal chip part: the silk would print
       into the pads and the polarity mark is the only thing worth having. So
       an outline goes on anything with three or more terminals, or on a body
       big enough to need lining up. */
    if(outl&&k!=="tp"&&(inst.pins.length>2||Math.max(inst.bw,inst.bh)>=2.6)){
      const ow=inst.bw+lw*1.5,oh=inst.bh+lw*1.5;
      if(k==="qfp"||k==="qfn"||k==="bga"||k==="gull"||k==="dip"){
        /* a corner-marked outline, which is what a fine-pitch part gets so the
           silk does not print into the pads */
        const hx=ow*0.5,hy=oh*0.5,c=Math.min(hx,hy)*0.42;
        for(const sx of [-1,1])for(const sy of [-1,1])
          out.push(recS([[inst.x+sx*hx,inst.y+sy*(hy-c)],[inst.x+sx*hx,inst.y+sy*hy],
                         [inst.x+sx*(hx-c),inst.y+sy*hy]],lw));
      }else out.push(recS([[inst.x-ow*0.5,inst.y-oh*0.5],[inst.x+ow*0.5,inst.y-oh*0.5],
        [inst.x+ow*0.5,inst.y+oh*0.5],[inst.x-ow*0.5,inst.y+oh*0.5],[inst.x-ow*0.5,inst.y-oh*0.5]],lw));
    }
    /* pin one, marked outside the body where it can still be read with the
       part fitted */
    const p1=inst.pads[0];
    if(p1&&(inst.pins.length>2||k==="dip"||k==="hdr")){
      const dx=Math.sign(p1.x-inst.x)||1,dy=Math.sign(p1.y-inst.y)||1;
      const px=inst.x+dx*(inst.bw*0.5+lw*2.2),py=inst.y+dy*(inst.bh*0.5+lw*2.2);
      out.push(recC(px,py,lw*0.95));
    }
    /* polarity: a bar at the plus end of anything polarised, a cathode band on
       a diode. Getting this on the wrong end is the classic board error, so it
       is drawn from the footprint rather than from a guess. */
    if(k==="tant"||k==="elyt"){
      const s=(inst.rot===2||inst.rot===3)?-1:1;
      const a=inst.rot&1;
      const bx=inst.x+(a?0:s*inst.bw*0.36),by=inst.y+(a?s*inst.bh*0.36:0);
      out.push(recS(a?[[bx-inst.bw*0.30,by],[bx+inst.bw*0.30,by]]
                     :[[bx,by-inst.bh*0.30],[bx,by+inst.bh*0.30]],lw*1.6));
      out.push(recS(a?[[bx-inst.bw*0.12,by-inst.bh*0.14],[bx+inst.bw*0.12,by-inst.bh*0.14]]
                     :[[bx-inst.bw*0.14,by-inst.bh*0.12],[bx-inst.bw*0.14,by+inst.bh*0.12]],lw));
    }
    if(k==="sod"||k==="led"||k==="ledc"){
      const a=inst.rot&1,s=(inst.rot===2||inst.rot===3)?-1:1;
      const bx=inst.x+(a?0:s*inst.bw*0.62),by=inst.y+(a?s*inst.bh*0.62:0);
      out.push(recS(a?[[bx-inst.bw*0.5,by],[bx+inst.bw*0.5,by]]
                     :[[bx,by-inst.bh*0.5],[bx,by+inst.bh*0.5]],lw));
    }
    /* the designator: offered above, below, then to each side, and dropped
       if every one of them is under another part */
    if(okText){
      const tw=glyWidth(inst.des,0)*cap/GLY_CAP;
      const cands=[[inst.x,inst.y-inst.ch*0.5-cap*0.25,"c"],
                   [inst.x,inst.y+inst.ch*0.5+cap*1.05,"c"],
                   [inst.x+inst.cw*0.5+0.3,inst.y+cap*0.4,"l"],
                   [inst.x-inst.cw*0.5-0.3,inst.y+cap*0.4,"r"]];
      let put=null;
      for(const c of cands){
        const x0=c[2]==="c"?c[0]-tw*0.5:c[2]==="r"?c[0]-tw:c[0];
        if(!L.wrap&&(x0<L.edge||x0+tw>L.bw-L.edge||c[1]-cap<L.edge||c[1]>L.bh-L.edge))continue;
        if(!sg.free(x0,c[1]-cap,x0+tw,c[1],1)){continue;}
        put=c;break;
      }
      if(put){
        const x0=put[2]==="c"?put[0]-tw*0.5:put[2]==="r"?put[0]-tw:put[0];
        sg.mark(x0,put[1]-cap,x0+tw,put[1],1);
        out.push(recG(inst.des,put[0],put[1],cap,lw,put[2],0));
        if(legend==="both"&&inst.val&&textPx>=4.5){
          const vy=put[1]+(put===cands[0]?-cap*1.25:cap*1.25);
          const vw=glyWidth(inst.val,0)*cap*0.9/GLY_CAP;
          const vx0=put[2]==="c"?put[0]-vw*0.5:put[2]==="r"?put[0]-vw:put[0];
          if(sg.free(vx0,vy-cap,vx0+vw,vy,1)){
            sg.mark(vx0,vy-cap,vx0+vw,vy,1);
            out.push(recG(inst.val,put[0],vy,cap*0.9,lw,put[2],0));
          }
        }
      }else drops.hidden=(drops.hidden||0)+1;
    }
  }

  /* board-level legend, down in the corner where a board's own name goes */
  if(okText&&!L.wrap){
    const name=str(P.boardName,"").toUpperCase().slice(0,28);
    const rev=str(P.rev,"").toUpperCase().slice(0,10);
    /* clear of the corner mounting hole, whose keepout is the one place on a
       board where nothing may be printed */
    const bx=L.legBox?L.legBox.x0:(L.edge+1.2);
    const by=L.legBox?L.legBox.y1:(L.bh-L.edge-1.2);
    const lines=[];
    if(name)lines.push(name);
    if(rev)lines.push("REV "+rev);
    if(bool(P.pbfree,true))lines.push("RoHS  Pb-FREE");
    for(let i=0;i<lines.length;i++)
      out.push(recG(lines[i],bx,by-(lines.length-1-i)*cap*1.6,cap,lw,"l",0));
    /* the ESD triangle: generic, and the one mark worth drawing rather than
       spelling, because it is drawn on every board that has a CMOS input */
    if(bool(P.esd,true)){
      const s=cap*2.0,ex=L.bw-L.edge-1.2-s*0.5,ey=L.bh-L.edge-1.0-s*0.1;
      out.push(recS([[ex-s*0.5,ey],[ex+s*0.5,ey],[ex,ey-s*0.86],[ex-s*0.5,ey]],lw));
      out.push(recS([[ex-s*0.26,ey-s*0.12],[ex+s*0.22,ey-s*0.52]],lw));
    }
  }
  L.slkDrops=drops;
  return out;
}

/* ============================ the parts, drawn ============================

   Each entry is {h, m, rc}: how far above the laminate the top of that shape
   sits in millimetres, what it is made of, and the shape. They are emitted low
   first, so a lead drawn before its body comes out under it — which is the
   only ordering that works when the raster has no depth test.

   Heights are real package heights and they are what makes the height map
   useless as an 8-bit image on its own: a 10 mm electrolytic can is two
   hundred times the 35 um of copper beside it. That is a fact about boards,
   not a bug, and it is why this mode's readme points at height16.png.  */
function partRecs(inst,P,cuT){
  const out=[],k=inst.p.kind,ht=inst.ht;
  const add=(h,m,rc)=>out.push({h:h,m:m,rc:rc});
  const odd=(inst.rot&1)===1;
  const bw=inst.bw,bh=inst.bh;
  const solder=cuT+0.07;
  const lit=bool(P.ledOn,true);
  const rr=Math.min(bw,bh)*0.10;

  /* every soldered lead stands in a fillet, and the fillet is proud of the
     mask rather than level with it */
  for(const pd of inst.pads){
    if(pd.thermal)continue;
    const sh=pd.shape==="round"?recC(pd.x,pd.y,Math.max(pd.w,pd.h)*0.5)
                               :recR(pd.x,pd.y,pd.w*1.04,pd.h*1.04,Math.min(pd.w,pd.h)*0.2);
    add(solder,4,sh);
  }

  if(k==="chip"){
    const sub=inst.p.sub;
    const m=sub==="res"?2:sub==="mlcc"?3:sub==="fer"?7:sub==="fuse"?9:3;
    const tl=(odd?bh:bw)*0.22;
    add(ht,m,recR(inst.x,inst.y,bw,bh,rr));
    if(odd){add(ht*0.98,4,recR(inst.x,inst.y-bh*0.5+tl*0.5,bw,tl,0));
            add(ht*0.98,4,recR(inst.x,inst.y+bh*0.5-tl*0.5,bw,tl,0));}
    else{add(ht*0.98,4,recR(inst.x-bw*0.5+tl*0.5,inst.y,tl,bh,0));
         add(ht*0.98,4,recR(inst.x+bw*0.5-tl*0.5,inst.y,tl,bh,0));}
    /* the printed value, which is on every resistor over 0603 and is the
       detail that stops a chip resistor reading as a black rectangle */
    if(sub==="res"&&inst.val&&Math.min(bw,bh)>1.0)
      add(ht*1.001,14,recG(inst.val.slice(0,4),inst.x,inst.y+Math.min(bw,bh)*0.21,
        Math.min(bw,bh)*0.42,Math.min(bw,bh)*0.085,"c",odd?-Math.PI*0.5:0));
  }else if(k==="melf"){
    add(ht,3,recR(inst.x,inst.y,bw,bh,bh*0.45));
    const tl=(odd?bh:bw)*0.16;
    if(odd){add(ht*0.96,4,recR(inst.x,inst.y-bh*0.5+tl*0.5,bw,tl,0));
            add(ht*0.96,4,recR(inst.x,inst.y+bh*0.5-tl*0.5,bw,tl,0));}
    else{add(ht*0.96,4,recR(inst.x-bw*0.5+tl*0.5,inst.y,tl,bh,0));
         add(ht*0.96,4,recR(inst.x+bw*0.5-tl*0.5,inst.y,tl,bh,0));}
  }else if(k==="sod"){
    add(ht,1,recR(inst.x,inst.y,bw,bh,rr));
    const s=(inst.rot===2||inst.rot===3)?-1:1,tl=(odd?bh:bw)*0.20;
    if(odd)add(ht*1.01,14,recR(inst.x,inst.y+s*(bh*0.5-tl*0.7),bw*0.9,tl*0.5,0));
    else   add(ht*1.01,14,recR(inst.x+s*(bw*0.5-tl*0.7),inst.y,tl*0.5,bh*0.9,0));
  }else if(k==="tant"){
    add(ht,8,recR(inst.x,inst.y,bw,bh,rr*0.8));
    const s=(inst.rot===2||inst.rot===3)?-1:1,tl=(odd?bh:bw)*0.22;
    if(odd)add(ht*1.01,9,recR(inst.x,inst.y-s*(bh*0.5-tl*0.5),bw*0.96,tl,0));
    else   add(ht*1.01,9,recR(inst.x-s*(bw*0.5-tl*0.5),inst.y,tl,bh*0.96,0));
  }else if(k==="rarr"){
    add(ht,1,recR(inst.x,inst.y,bw,bh,rr));
  }else if(k==="sot"||k==="gull"||k==="qfp"||k==="qfn"||k==="bga"){
    const bx=inst.p.body[0],by=inst.p.body[1];
    const w0=odd?by:bx,h0=odd?bx:by;
    add(ht,1,recR(inst.x,inst.y,w0,h0,Math.min(w0,h0)*0.06));
    /* pin one: a moulded dimple, which is what is actually on the part */
    const p1=inst.pads[0];
    if(p1&&(k!=="sot")){
      const dx=Math.sign(p1.x-inst.x)||-1,dy=Math.sign(p1.y-inst.y)||-1;
      add(ht*0.995,14,recC(inst.x+dx*(w0*0.5-Math.min(w0,h0)*0.14),
                           inst.y+dy*(h0*0.5-Math.min(w0,h0)*0.14),Math.min(w0,h0)*0.055));
    }
    /* the laser mark. Real part markings are a line of code over a line of
       date code, and at anything under about six texels of cap height they are
       a grey smudge, so they are dropped rather than drawn. */
    const cap=Math.min(w0,h0)*0.16;
    if(cap>0.35&&inst.des){
      add(ht*1.002,14,recG(inst.des,inst.x,inst.y+cap*0.5,cap,cap*0.16,"c",0));
      if(h0>cap*4)add(ht*1.002,14,recG("2"+((((inst.x*7+inst.y*13)|0)%52)+10),inst.x,
        inst.y+cap*2.4,cap*0.8,cap*0.14,"c",0));
    }
  }else if(k==="dip"){
    const bx=inst.p.body[0],by=inst.p.body[1],w0=odd?by:bx,h0=odd?bx:by;
    add(ht,1,recR(inst.x,inst.y,w0,h0,0.25));
    /* THE NOTCH IS ON THE END PIN ONE IS ON, whichever way the part is turned.
       Taking the x-sign of pin 1 and using it as a y-offset is a coin flip on
       a rotated part, and a notch on the wrong end of a DIP is the same class
       of error as a polarity bar on the wrong end of a capacitor. */
    const p1=inst.pads[0];
    const vx=p1.x-inst.x,vy=p1.y-inst.y;
    const nx=(Math.abs(vx)>=Math.abs(vy))?(Math.sign(vx)||-1):0;
    const ny=nx?0:(Math.sign(vy)||-1);
    add(ht*0.98,10,recC(inst.x+nx*w0*0.5,inst.y+ny*h0*0.5,Math.min(w0,h0)*0.18));
  }else if(k==="hdr"){
    const plast=2.5;
    add(plast,10,recR(inst.x,inst.y,bw,bh,0.2));
    for(const pd of inst.pads)add(ht,5,recR(pd.x,pd.y,0.64,0.64,0));
  }else if(k==="elyt"){
    const d=Math.min(bw,bh);
    add(ht*0.92,10,recC(inst.x,inst.y,d*0.5));
    add(ht,6,recC(inst.x,inst.y,d*0.44));
    /* the vent score: three lines meeting at the centre, so the can splits
       rather than bursting */
    const a0=(inst.rot*Math.PI*0.5);
    for(let i=0;i<3;i++){
      const a=a0+i*Math.PI*2/3;
      add(ht*1.005,10,recS([[inst.x,inst.y],
        [inst.x+Math.cos(a)*d*0.40,inst.y+Math.sin(a)*d*0.40]],d*0.055));
    }
    /* and the negative stripe down the sleeve */
    const s=(inst.rot===2||inst.rot===3)?-1:1;
    const sx=inst.x+(odd?0:s*d*0.46),sy=inst.y+(odd?s*d*0.46:0);
    add(ht*0.93,9,recR(sx,sy,odd?d*0.5:d*0.10,odd?d*0.10:d*0.5,0));
  }else if(k==="ind"){
    const s=Math.min(bw,bh);
    add(ht,7,recR(inst.x,inst.y,bw,bh,s*0.16));
    add(ht*1.004,7,recC(inst.x,inst.y,s*0.30));
  }else if(k==="xtal"){
    add(ht*0.55,9,recR(inst.x,inst.y,bw,bh,0.12));
    add(ht,6,recR(inst.x,inst.y,bw*0.80,bh*0.72,0.10));
  }else if(k==="hc49"){
    add(ht,6,recR(inst.x,inst.y,bw,bh,bh*0.42));
    add(ht*1.004,6,recS(odd?[[inst.x,inst.y-bw*0.42],[inst.x,inst.y+bw*0.42]]
                            :[[inst.x-bw*0.42,inst.y],[inst.x+bw*0.42,inst.y]],bh*0.05));
  }else if(k==="osc"){
    add(ht*0.5,9,recR(inst.x,inst.y,bw,bh,0.15));
    add(ht,6,recR(inst.x,inst.y,bw*0.84,bh*0.78,0.12));
    const p1=inst.pads[0],dx=Math.sign(p1.x-inst.x)||-1,dy=Math.sign(p1.y-inst.y)||-1;
    add(ht*1.01,14,recC(inst.x+dx*bw*0.30,inst.y+dy*bh*0.28,Math.min(bw,bh)*0.07));
  }else if(k==="led"){
    add(ht*0.6,9,recR(inst.x,inst.y,bw,bh,0.12));
    add(ht,lit?MAT_LIT:11,recC(inst.x,inst.y,Math.min(bw,bh)*0.36));
  }else if(k==="ledc"){
    add(ht,lit?MAT_LIT:11,recR(inst.x,inst.y,bw*0.78,bh*0.86,rr));
  }else if(k==="to220"){
    add(ht,1,recR(inst.x,inst.y,bw,bh,0.1));
    const s=odd?bw:bh;
    add(ht*1.01,6,odd?recR(inst.x-bw*0.5+s*0.22,inst.y,s*0.44,bh,0)
                     :recR(inst.x,inst.y-bh*0.5+s*0.22,bw,s*0.44,0));
  }else if(k==="dpak"){
    add(ht,1,recR(inst.x,inst.y,bw,bh,0.12));
    const a=(inst.rot&1)===1,sg2=(inst.rot===2||inst.rot===3)?-1:1;
    /* the tab shows above the moulding, because it is a sheet of copper the
       die is soldered to and the plastic is moulded round it */
    add(ht*1.02,6,a?recR(inst.x-sg2*bw*0.34,inst.y,bw*0.32,bh*0.9,0)
                   :recR(inst.x,inst.y-sg2*bh*0.34,bw*0.9,bh*0.32,0));
  }else if(k==="conn"){
    const shell=inst.p.shell,m=shell==="metal"?12:shell==="white"?9:shell==="green"?13:10;
    add(ht,m,recR(inst.x,inst.y,bw,bh,Math.min(bw,bh)*0.10));
    /* THE CAVITY FACES WHERE THE PART FACES. A connector's opening is on one
       named side of the moulding — the front is +y in local coordinates —
       so the quarter turn has to be applied to it like everything else. With
       the direction hard-coded, an edge connector came out right (it is never
       turned) and a rotated wire-to-board one came out with its opening on
       the back. It is the darkest thing on the picture because it is a hole
       into a shell. */
    const cv=inst.p.cav,a=odd;
    const cw2=a?cv[1]:cv[0],ch2=a?cv[0]:cv[1];
    const fr=QROT(0,1,inst.rot);
    const cx3=inst.x+fr[0]*(bw*0.5-ch2*0.6),cy3=inst.y+fr[1]*(bh*0.5-ch2*0.6);
    add(ht*0.35,16,recR(cx3,cy3,a?ch2:cw2,a?cw2:ch2,0.1));
    add(ht*0.45,5,recR(cx3,cy3,a?ch2*0.3:cw2*0.82,a?cw2*0.82:ch2*0.3,0));
  }else if(k==="shield"){
    add(ht,12,recR(inst.x,inst.y,bw,bh,Math.min(bw,bh)*0.06));
    add(ht*1.002,12,recC(inst.x,inst.y,Math.min(bw,bh)*0.10));
  }else if(k==="sw"){
    add(ht*0.55,10,recR(inst.x,inst.y,bw,bh,0.2));
    add(ht*0.8,6,recR(inst.x,inst.y,bw*0.92,bh*0.92,0.2));
    add(ht,10,recC(inst.x,inst.y,Math.min(bw,bh)*0.29));
  }else if(k==="dipsw"){
    add(ht*0.8,9,recR(inst.x,inst.y,bw,bh,0.15));
    const n=inst.np||4;
    for(let i=0;i<n;i++){
      const t=(i-(n-1)*0.5)*2.54;
      const q=QROT(t,-0.6,inst.rot);
      add(ht,2,recR(inst.x+q[0],inst.y+q[1],odd?1.6:1.1,odd?1.1:1.6,0));
    }
  }else if(k==="pot"){
    add(ht*0.7,9,recR(inst.x,inst.y,bw,bh,0.1));
    add(ht,6,recC(inst.x,inst.y,Math.min(bw,bh)*0.32));
    add(ht*1.01,2,recR(inst.x,inst.y,Math.min(bw,bh)*0.5,Math.min(bw,bh)*0.09,0));
  }else if(k==="relay"){
    add(ht,9,recR(inst.x,inst.y,bw,bh,0.2));
  }
  return out;
}

/* ============================ assembly ============================
   Everything the four raster passes will draw, in BOARD-LOCAL millimetres,
   built once. A panel is the same board six times, so the lists are built once
   and the passes are handed six offsets — which is also exactly what a panel
   is, and why the boards on it are identical.  */
function assemble(P,G,L){
  const cuT=ozUm(num(P.cuOz,1))/1000;
  const w=L.w,cw=L.cwm;
  const exp=clamp(num(P.maskExp,0.05),0,0.4);        /* mask expansion per side */
  const pull=L.edge;
  const A={pour:[],anti:[],cu:[],spokes:[],open:[],brd:[],bcut:[],brd2:[],hole:[],
           prt:[],slk:[],vsc:[],htMax:0.06,htRaw:0};
  const pourOn=str(P.pour,"gnd")!=="none";

  /* the plane, pulled back from the cut */
  if(pourOn){
    if(G.piece==="field")A.pour.push(recR(L.bw*0.5,L.bh*0.5,L.bw+4,L.bh+4,0));
    else A.pour.push(recR(L.bw*0.5,L.bh*0.5,L.bw-pull*2,L.bh-pull*2,Math.max(0,G.r-pull)));
    /* a split plane: a slot of no copper across it, which is what separates an
       analogue island from the digital ground */
    if(str(P.pour,"gnd")==="split"){
      const y=L.bh*0.72,gapw=Math.max(cw*3,0.8);
      A.anti.push(recR(L.bw*0.55,y,L.bw*0.8,gapw,0));
    }
  }

  const addCu=(rc,gold)=>{if(gold)rc.gold=true;A.cu.push(rc);};
  const addPadOpen=(rc,gold)=>{const o=Object.assign({},rc);if(gold)o.gold=true;A.open.push(o);};

  /* pads */
  for(const inst of L.parts){
    for(const pd of inst.pads){
      const rc=pd.shape==="round"?recC(pd.x,pd.y,Math.max(pd.w,pd.h)*0.5)
                                 :recR(pd.x,pd.y,pd.w,pd.h,pd.thermal?0.1:Math.min(pd.w,pd.h)*0.18);
      addCu(rc,false);
      A.anti.push(rc);
      const op=pd.shape==="round"?recC(pd.x,pd.y,Math.max(pd.w,pd.h)*0.5+exp)
                                 :recR(pd.x,pd.y,pd.w+exp*2,pd.h+exp*2,Math.min(pd.w,pd.h)*0.18+exp);
      A.open.push(op);
      if(pd.drill){
        A.hole.push(recC(pd.x,pd.y,pd.drill*0.5));
        /* a through-hole pad tied to the plane gets a relief rather than a
           flood, and which pads those are is decided here so it is stable */
        if(pourOn&&((pd.pin+inst.pads.length)%5===0))
          A.spokes.push(recRel(pd.x,pd.y,Math.max(pd.w,pd.h)*0.5,pd.drill*0.5,Math.max(w,cw*1.2)));
      }
    }
  }
  /* traces */
  for(const r of L.routes){const rc=recS(r.pts,r.w);addCu(rc,false);A.anti.push(rc);}
  /* vias: a stitching via is part of the plane, so it gets no anti-pad — which
     is the whole reason it is there */
  for(const v of L.vias){
    const rc=recC(v.x,v.y,v.pad*0.5);
    addCu(rc,false);
    if(!v.gnd)A.anti.push(rc);
    /* TENTING IS WHAT DECIDES WHETHER THERE IS A HOLE TO SEE. The barrel is
       drilled either way, but a tented via has mask over the top of it, so
       from above it is a green bump with a dimple in it and not a hole. Punch
       the blank only for the ones you could drop a wire down. */
    if(!v.tent){A.hole.push(recC(v.x,v.y,v.drill*0.5));
                A.open.push(recC(v.x,v.y,v.pad*0.5+exp));}
  }
  /* edge connector fingers: hard gold, on the edge, with the lead-in chamfer
     that stops the first contact shaving the last one */
  if(G.fing!=="none"&&G.piece==="board"){
    const pitch=1.27,fw=0.90,flen=Math.min(9.0,L.bh*0.28);
    const along=(G.fing==="bottom")?L.bw:L.bh;
    const n=Math.max(4,Math.floor((along-14)/pitch));
    for(let i=0;i<n;i++){
      const t=(along-(n-1)*pitch)*0.5+i*pitch;
      const rc=(G.fing==="bottom")?recR(t,L.bh-flen*0.5,fw,flen,0)
                                  :recR(flen*0.5,t,flen,fw,0);
      addCu(rc,true);A.anti.push(rc);addPadOpen(rc,true);
    }
    L.fingers=n;
  }

  /* the board itself */
  const cells=cellsOf(G);
  if(G.piece==="field"){A.brd.push(recR(L.bw*0.5,L.bh*0.5,L.bw+6,L.bh+6,0));}
  else A.brd.push(recR(L.bw*0.5,L.bh*0.5,L.bw,L.bh,G.r));
  for(const h of L.holes)A.hole.push(recC(h.x,h.y,h.d*0.5));
  /* fiducials: a copper dot in a mask opening twice its size, which is what a
     placement camera is looking for */
  for(const f of L.fids){
    addCu(recC(f.x,f.y,0.5),false);A.anti.push(recC(f.x,f.y,0.5));
    A.open.push(recC(f.x,f.y,1.0));
  }
  /* castellations: half a plated hole on the edge, which is how a module
     solders to a motherboard without a connector */
  if(G.cast){
    const pitch=1.27,n=Math.floor((L.bw-4)/pitch);
    for(let i=0;i<n;i++){
      const x=(L.bw-(n-1)*pitch)*0.5+i*pitch;
      for(const y of [0,L.bh]){
        addCu(recC(x,y,0.5),false);A.anti.push(recC(x,y,0.62));
        A.open.push(recC(x,y,0.62));A.hole.push(recC(x,y,0.3));
      }
    }
  }

  A.slk=silk(P,G,L);

  /* components — unless this is the bare fab board, which has every pad, every
     opening and the whole legend on it and nothing soldered to it yet */
  const clip=num(P.htClip,0);
  if(bool(P.pop,true))for(const inst of L.parts){
    const recs=partRecs(inst,P,cuT);
    for(const r of recs){
      let h=r.h;
      if(clip>0&&h>clip){h=clip;r.clipped=true;}
      if(h>A.htMax)A.htMax=h;
      if(r.h>A.htRaw)A.htRaw=r.h;
      A.prt.push({h:h,m:r.m,rc:r.rc});
    }
  }
  /* a bodge wire, because a board that has been fixed has one */
  const nb=bool(P.pop,true)?clamp(P.bodge|0,0,4):0;
  for(let i=0;i<nb;i++){
    const a=L.parts[(i*13+5)%Math.max(1,L.parts.length)];
    const b=L.parts[(i*29+17)%Math.max(1,L.parts.length)];
    if(!a||!b||a===b)continue;
    const mx=(a.x+b.x)*0.5+(hashi(i*37,11,G.seedN)-0.5)*8;
    const my=(a.y+b.y)*0.5+(hashi(i*53,29,G.seedN)-0.5)*8;
    const pts=[[a.x,a.y],[mx,my],[b.x,b.y]];
    A.prt.push({h:Math.max(a.ht,b.ht)*0.9+0.2,m:18,rc:recS(chamfer(pts,2.0),0.30)});
  }

  A.cuT=cuT;
  return A;
}

/* the piece-level furniture a panel has and a board does not */
function panelParts(P,G,L){
  const A={brd:[],bcut:[],brd2:[],hole:[],cu:[],open:[],slk:[],vsc:[]};
  if(G.piece!=="panel")return A;
  const rail=G.rail,gap=G.gap,vs=str(P.brk,"tab")==="vscore";
  A.brd.push(recR(G.Wmm*0.5,G.Hmm*0.5,G.Wmm,G.Hmm,1.5));
  if(!vs){
    /* route the boards free, leaving tabs at the middle of every edge */
    const cells=cellsOf(G);
    for(const c of cells){
      const gx=gap*0.5+0.0;
      A.bcut.push(recR(c.x+c.w*0.5,c.y-gap*0.5,c.w+gap,gap,0));
      A.bcut.push(recR(c.x+c.w*0.5,c.y+c.h+gap*0.5,c.w+gap,gap,0));
      A.bcut.push(recR(c.x-gap*0.5,c.y+c.h*0.5,gap,c.h+gap,0));
      A.bcut.push(recR(c.x+c.w+gap*0.5,c.y+c.h*0.5,gap,c.h+gap,0));
    }
    const tabW=Math.min(5,G.bw*0.2);
    for(const c of cells){
      for(const t of [[c.x+c.w*0.5,c.y-gap*0.5,tabW,gap+0.2],
                      [c.x+c.w*0.5,c.y+c.h+gap*0.5,tabW,gap+0.2],
                      [c.x-gap*0.5,c.y+c.h*0.5,gap+0.2,tabW],
                      [c.x+c.w+gap*0.5,c.y+c.h*0.5,gap+0.2,tabW]]){
        A.brd2.push(recR(t[0],t[1],t[2],t[3],0));
        /* MOUSE BITES: a row of small drills across the tab, so it snaps on a
           line instead of tearing the laminate */
        const n=5,hor=t[2]>t[3];
        for(let i=0;i<n;i++){
          const s=(i-(n-1)*0.5)*(Math.min(t[2],t[3])>0?(hor?t[2]:t[3])/n:1);
          A.hole.push(recC(hor?t[0]+s:t[0],hor?t[1]:t[1]+s,0.25));
        }
      }
    }
  }else{
    for(let i=1;i<G.nx;i++)A.vsc.push({x:rail+i*G.bw,y:null});
    for(let j=1;j<G.ny;j++)A.vsc.push({x:null,y:rail+j*G.bh});
    /* and the rail is scored off too, or the boards could not be broken out
       of it */
    A.vsc.push({x:rail,y:null},{x:G.Wmm-rail,y:null},
               {y:rail,x:null},{y:G.Hmm-rail,x:null});
  }
  /* tooling holes and panel fiducials live in the rail, never in a board */
  const ti=Math.min(rail*0.5,4);
  for(const sx of [0,1])for(const sy of [0,1]){
    const x=sx?G.Wmm-ti:ti,y=sy?G.Hmm-ti:ti;
    A.hole.push(recC(x,y,1.6));
  }
  for(const f of [[rail*0.5,G.Hmm*0.5],[G.Wmm-rail*0.5,G.Hmm*0.5]]){
    A.cu.push(recC(f[0],f[1],0.5));A.open.push(recC(f[0],f[1],1.0));
  }
  return A;
}

/* ============================ rasterising ============================

   Four passes over one canvas, and each pass carries more than one plane out
   of it, because a 4096 raster is sixty-seven megabytes and reading five of
   them would cost more than the whole build.

     A  copper      alpha is the copper, blue marks the hard-gold fingers
     B  mask+silk   red is the mask openings, green the legend — drawn with
                    `lighter` so the two do not overwrite each other
     C  the blank   alpha is board, holes punched out of it
     D  components  red is height, green is the material, alpha is coverage

   Pass A is the one that has to be in the fab's own order: flood the plane,
   punch the anti-pads out of it at the clearance, put the tracks back, and
   only then draw the thermal spokes across the rings.  */
function offsetsOf(G){
  if(G.piece==="field"){
    const o=[];
    for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)o.push([i*G.Wmm,j*G.Hmm]);
    return o;
  }
  if(G.piece==="panel")return cellsOf(G).map(c=>[c.x,c.y]);
  return [[0,0]];
}
function paintList(g,list,offs,G,grow){
  const W=G.Wmm,H=G.Hmm;
  for(const off of offs){
    g.save();g.translate(off[0],off[1]);
    for(const rc of list){
      const bb=rc.bb;
      if(bb&&(bb[0]+off[0]>W||bb[2]+off[0]<0||bb[1]+off[1]>H||bb[3]+off[1]<0))continue;
      drawRec(g,rc,grow);
    }
    g.restore();
  }
}

function ctxFor(cv,G){
  const g=cv.getContext("2d",{willReadFrequently:true});
  g.setTransform(G.pxPerMm,0,0,G.pxPerMm,0,G.oy*G.pxPerMm);
  g.lineCap="round";g.lineJoin="round";
  return g;
}
function clearAll(g,G){
  g.save();g.setTransform(1,0,0,1,0,0);
  g.clearRect(0,0,G.TW,G.TH);
  g.restore();
}
function chan(g,G,off){
  const d=g.getImageData(0,0,G.TW,G.TH).data;
  const N=G.TW*G.TH,out=new Uint8Array(N);
  for(let i=0;i<N;i++)out[i]=d[i*4+off];
  return out;
}
function chan2(g,G,o1,o2){
  const d=g.getImageData(0,0,G.TW,G.TH).data;
  const N=G.TW*G.TH,a=new Uint8Array(N),b=new Uint8Array(N);
  for(let i=0;i<N;i++){a[i]=d[i*4+o1];b[i]=d[i*4+o2];}
  return [a,b];
}
function chan3(g,G,o1,o2,o3){
  const d=g.getImageData(0,0,G.TW,G.TH).data;
  const N=G.TW*G.TH,a=new Uint8Array(N),b=new Uint8Array(N),c=new Uint8Array(N);
  for(let i=0;i<N;i++){a[i]=d[i*4+o1];b[i]=d[i*4+o2];c[i]=d[i*4+o3];}
  return [a,b,c];
}

/* ============================ the generator ============================ */
let P={};

function build(params,io){
  P=params;
  const TW=io.W,TH=io.H,N=TW*TH;
  const G=boardOf(P,TW);
  G.TW=TW;G.TH=TH;
  G.pxPerMm=TW/G.Wmm;G.mmPerPx=G.Wmm/TW;
  /* the buffers are the size the runtime asked for, and rounding the height to
     a multiple of four leaves a texel or two spare — so the blank is CENTRED in
     it rather than the transform being stretched to fill it, because stretching
     would mean the board is not the size it says it is */
  G.oy=(TH/G.pxPerMm-G.Hmm)*0.5;
  G.seedN=(P.seed|0)>>>0;
  G.wrapField=(G.piece==="field");
  const wrap=G.wrapField;

  const L=layoutBoard(P,G,wrap?G.Wmm:G.bw,wrap?G.Hmm:G.bh,wrap,G.seedN);
  L.wrap=wrap;
  route(P,G,L);
  const A=assemble(P,G,L);
  const PN=panelParts(P,G,L);
  const offs=offsetsOf(G);
  const one=[[0,0]];
  LAST={key:statKey(P,G),parts:L.parts.length,routes:L.routes.length,vias:L.vias.length,
        fingers:L.fingers||0,drops:L.drops,htMax:A.htRaw||0,
        hidden:(L.slkDrops&&L.slkDrops.hidden)||0};
  const cuT=A.cuT;
  const htMax=Math.max(0.25,A.htMax);
  io.progress(0.06);

  const cv=document.createElement("canvas");cv.width=TW;cv.height=TH;
  const g=ctxFor(cv,G);

  /* ---- pass A: copper ---- */
  g.fillStyle=g.strokeStyle="#ff0000";
  paintList(g,A.pour,offs,G,0);
  if(PN.cu.length){g.fillStyle=g.strokeStyle="#ff0000";paintList(g,PN.cu,one,G,0);}
  g.globalCompositeOperation="destination-out";
  paintList(g,A.anti,offs,G,L.cwm);
  paintList(g,A.spokes,offs,G,L.cwm);
  g.globalCompositeOperation="source-over";
  const plain=A.cu.filter(r=>!r.gold),gld=A.cu.filter(r=>r.gold);
  g.fillStyle=g.strokeStyle="#ff0000";
  paintList(g,plain,offs,G,0);
  for(const off of offs){g.save();g.translate(off[0],off[1]);
    for(const rc of A.spokes)drawSpokes(g,rc);g.restore();}
  g.fillStyle=g.strokeStyle="#ff00ff";
  paintList(g,gld,offs,G,0);
  const cuPair=chan2(g,G,3,2);
  const CUA=cuPair[0],GOLD=cuPair[1];
  io.progress(0.2);

  /* ---- pass B: mask openings and legend ---- */
  clearAll(g,G);
  g.globalCompositeOperation="lighter";
  g.fillStyle=g.strokeStyle="#ff0000";
  paintList(g,A.open,offs,G,0);
  if(PN.open.length)paintList(g,PN.open,one,G,0);
  g.fillStyle=g.strokeStyle="#00ff00";
  paintList(g,A.slk,offs,G,0);
  if(PN.slk.length)paintList(g,PN.slk,one,G,0);
  g.globalCompositeOperation="source-over";
  const mkPair=chan2(g,G,0,1);
  const MOP=mkPair[0],SLK=mkPair[1];
  io.progress(0.32);

  /* ---- pass C: the blank ---- */
  clearAll(g,G);
  g.fillStyle=g.strokeStyle="#ffffff";
  if(G.piece==="panel"){
    paintList(g,PN.brd,one,G,0);
    g.globalCompositeOperation="destination-out";
    paintList(g,PN.bcut,one,G,0);
    g.globalCompositeOperation="source-over";
    paintList(g,PN.brd2,one,G,0);
  }else paintList(g,A.brd,offs,G,0);
  g.globalCompositeOperation="destination-out";
  paintList(g,A.hole,offs,G,0);
  if(PN.hole.length)paintList(g,PN.hole,one,G,0);
  g.globalCompositeOperation="source-over";
  const BRD=chan(g,G,3);
  io.progress(0.42);

  /* ---- pass D: components ---- */
  clearAll(g,G);
  for(const off of offs){
    g.save();g.translate(off[0],off[1]);
    for(const it of A.prt){
      const bb=it.rc.bb;
      if(bb&&(bb[0]+off[0]>G.Wmm||bb[2]+off[0]<0||bb[1]+off[1]>G.Hmm||bb[3]+off[1]<0))continue;
      /* HEIGHT IS STORED AS ITS SQUARE ROOT. A ten-millimetre can beside a
         seventy-micron solder fillet cannot share a linear byte: the fillet
         would land on one of 255 steps and band. The square root spends the
         byte where the detail is and the composite squares it back. */
      const hb=Math.round(Math.sqrt(clamp(it.h/htMax,0,1))*255);
      const c="rgb("+hb+","+it.m+",0)";
      g.fillStyle=c;g.strokeStyle=c;
      drawRec(g,it.rc,0);
    }
    g.restore();
  }
  const pt=chan3(g,G,0,1,3);
  const PH=pt[0],PM=pt[1],PA=pt[2];
  cv.width=cv.height=1;
  io.progress(0.54);

  /* ---- the physical numbers ---- */
  const lam=G.lam,mk=MASKC[str(P.mask,"green")]||MASKC.green;
  const fin=FIN[str(P.finish,"hasl")]||FIN.hasl;
  const maskOn=mk.id!=="none";
  const maskT=clamp(num(P.maskUm,25),4,60)/1000;
  const slkT=clamp(num(P.slkUm,12),2,40)/1000;
  const MM=1/G.Wmm;                         /* millimetres -> tile-width units */
  const lamC=hex2rgb(lam.col),mkC=hex2rgb(mk.col),finC=hex2rgb(fin.col);
  const gldC=hex2rgb(FIN.hgold.col),slkC=hex2rgb(str(P.cSilk,"#e8e8e4"));
  const cuC=hex2rgb(str(P.cCopper,"#b1682f"));
  const maskOp=clamp(num(P.maskOp,0.80),0.2,1);
  const weaveAmt=lam.weave?clamp(num(P.weave,0.7),0,1):0;
  const wpx=lam.weave?lam.weave[0]:1,wpy=lam.weave?lam.weave[1]:1;
  const coat=clamp(num(P.coat,0),0,1);
  const fluxA=clamp(num(P.flux,0.25),0,1);
  const tarn=clamp(num(P.tarnish,0.15),0,1);
  const dust=clamp(num(P.dust,0.12),0,1);
  const scr=clamp(num(P.scratch,0.15),0,1);
  const holeD=Math.min(G.thick,0.45);
  const ledAmt=clamp(num(P.ledAmt,1),0,4);
  const TAU=Math.PI*2;

  const A3=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N);
  const MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N);
  const NRM=new Uint8ClampedArray(N*3);
  const ALP=new Uint8ClampedArray(N);
  const EMI=new Uint8ClampedArray(N);
  const HGT=new Float32Array(N);

  /* how far inside the blank each texel is, for the milled edge — the same
     blur-the-silhouette trick the label mode uses, and for the same reason:
     everything that happens at a cut edge happens within half a millimetre */
  /* THE V-SCORE, AS TWO ONE-DIMENSIONAL DISTANCE FIELDS. Every score line is
     axis-aligned, so the distance from a texel to the nearest one is the
     smaller of a function of x alone and a function of y alone — two arrays a
     few thousand long instead of ten tests on every one of sixteen million
     texels. A score is a 30-degree cut from both faces leaving about a third
     of the thickness, so from above it is a groove a few tenths of a
     millimetre wide with the mask scored off it. */
  const vsW=0.45;
  let vsX=null,vsY=null;
  if(PN.vsc&&PN.vsc.length){
    vsX=new Float32Array(TW);vsY=new Float32Array(TH);
    for(let x=0;x<TW;x++){
      const xm=(x+0.5)*G.mmPerPx;let d=1e9;
      for(const v of PN.vsc)if(v.x!==null&&v.x!==undefined)d=Math.min(d,Math.abs(xm-v.x));
      vsX[x]=d;
    }
    for(let y=0;y<TH;y++){
      const ym=(y+0.5)*G.mmPerPx-G.oy;let d=1e9;
      for(const v of PN.vsc)if(v.y!==null&&v.y!==undefined)d=Math.min(d,Math.abs(ym-v.y));
      vsY[y]=d;
    }
  }

  const brdF=new Float32Array(N);
  for(let i=0;i<N;i++)brdF[i]=BRD[i]/255;
  const edgePx=Math.max(1,Math.round(0.30*G.pxPerMm));
  const edgeF=wrap?brdF:blurClamp(brdF,TW,TH,edgePx);
  io.progress(0.6);

  const band=Math.max(8,Math.round(196608/TW));
  let y=0;
  function pass1(){
    const end=Math.min(TH,y+band);
    for(;y<end;y++){
      const ym=(y+0.5)*G.mmPerPx-G.oy;
      const v=(y+0.5)/TH;
      for(let x=0;x<TW;x++){
        const i=y*TW+x;
        const xm=(x+0.5)*G.mmPerPx,u=(x+0.5)/TW;
        const brd=brdF[i];
        const cu=CUA[i]/255,gold=GOLD[i]/255;
        const mop=MOP[i]/255;
        const pa=PA[i]/255,pm=PM[i];
        const slk=(SLK[i]/255)*(1-mop);
        const ins=wrap?1:clamp(edgeF[i]*1.35-0.12,0,1);     /* 0 at the cut */

        /* ---- the laminate, and the cloth it was pressed from ---- */
        let wv=0;
        if(weaveAmt>0){
          const fu=xm/wpx,fv=ym/wpy;
          const warp=Math.abs(Math.sin(fu*Math.PI)),fill=Math.abs(Math.sin(fv*Math.PI));
          const over=((Math.floor(fu)+Math.floor(fv))&1)===0;
          wv=(over?warp*0.74+fill*0.26:fill*0.74+warp*0.26)-0.5;
        }
        const grain=fbm2(u,v,96,96,3,G.seedN+31)-0.5;
        const lamK=1+wv*0.13*weaveAmt+grain*0.10;
        let r=lamC[0]*lamK,gg=lamC[1]*lamK,b=lamC[2]*lamK;
        let rg=lam.rgh+grain*0.10,met=0;
        let h=0;

        /* ---- the copper foil ---- */
        if(cu>0){
          const t=cu*0.94;
          r=lerp(r,cuC[0],t);gg=lerp(gg,cuC[1],t);b=lerp(b,cuC[2],t);
          h+=cuT*cu;
        }
        /* ---- the mask: a translucent film, thinner over copper, and pulled
               back off the cut so the last fraction of a millimetre is bare
               laminate on every real board ---- */
        const mkv=maskOn?(1-mop)*ins:0;
        if(mkv>0){
          /* thinner over a track than over laminate, so the tracks read
             through it — and slightly warmer, because what is showing through
             is copper */
          const bright=0.76+0.50*cu+wv*0.10*weaveAmt;
          const t=mkv*maskOp;
          r=lerp(r,mkC[0]*bright*(1+cu*0.06),t);gg=lerp(gg,mkC[1]*bright,t);
          b=lerp(b,mkC[2]*bright*(1-cu*0.05),t);
          rg=lerp(rg,clamp(1-mk.gl*0.86,0.06,1),mkv);
          h+=maskT*mkv*(1-cu*0.35);
        }
        /* ---- the openings: the finish, or bare laminate if there is no
               copper under the opening ---- */
        const fv2=mop*cu;
        if(fv2>0){
          const fr=gold>0.5?gldC:finC;
          const fg=gold>0.5?FIN.hgold:fin;
          r=lerp(r,fr[0],fv2);gg=lerp(gg,fr[1],fv2);b=lerp(b,fr[2],fv2);
          rg=lerp(rg,fg.rgh,fv2);met=lerp(met,1,fv2);
          h+=fg.dome*0.030*fv2;
        }
        /* ---- the legend ---- */
        if(slk>0){
          r=lerp(r,slkC[0],slk);gg=lerp(gg,slkC[1],slk);b=lerp(b,slkC[2],slk);
          rg=lerp(rg,0.80,slk);met=lerp(met,0,slk);
          h+=slkT*slk;
        }

        /* ---- wear, all of it before the components, because a component is
               new relative to the board it was soldered to ---- */
        if(tarn>0&&fv2>0.2){
          const t=clamp(fbm2(u,v,20,20,3,G.seedN+53)*1.5-0.35,0,1)*tarn*fv2;
          r=lerp(r,r*0.62,t);gg=lerp(gg,gg*0.58,t);b=lerp(b,b*0.66,t);
          rg=lerp(rg,0.72,t*0.8);
        }
        if(fluxA>0){
          /* flux residue pools around the joints and is glossy and amber */
          const near=clamp((mop*1.4+cu*0.2),0,1);
          const f=clamp(fbm2(u,v,14,14,3,G.seedN+71)*1.7-0.5,0,1)*fluxA*near;
          r=lerp(r,r*1.10+22,f);gg=lerp(gg,gg*1.02+13,f);b=lerp(b,b*0.84,f);
          rg=lerp(rg,0.14,f*0.9);
        }
        if(scr>0){
          const s=fbm2(u*0.25+v*0.97,u*0.97-v*0.25,3,110,3,G.seedN+89);
          const sc=clamp((s-0.62)*7,0,1)*scr*(1-fv2);
          r=lerp(r,r*1.22+18,sc);gg=lerp(gg,gg*1.22+18,sc);b=lerp(b,b*1.22+18,sc);
          rg=lerp(rg,0.42,sc);
        }

        /* ---- the components ---- */
        let emi=0;
        if(pa>0.004){
          const M=MAT[pm]||MAT[1];
          const c=M.rgbc||(M.rgbc=hex2rgb(M.col));
          const jit=1+(hashi(Math.round(xm*3),Math.round(ym*3),G.seedN+7)-0.5)*0.05;
          r=lerp(r,c[0]*jit,pa);gg=lerp(gg,c[1]*jit,pa);b=lerp(b,c[2]*jit,pa);
          rg=lerp(rg,M.rgh,pa);met=lerp(met,M.met,pa);
          const hp=(PH[i]/255);
          h=Math.max(h,hp*hp*htMax*pa+h*(1-pa));
          if(pm===MAT_LIT)emi=pa*ledAmt;
        }
        /* dust settles on everything, including the parts */
        if(dust>0){
          const d=clamp(fbm2(u,v,30,30,4,G.seedN+107)*1.5-0.42,0,1)*dust;
          r=lerp(r,r*0.82+30,d);gg=lerp(gg,gg*0.82+30,d);b=lerp(b,b*0.82+29,d);
          rg=lerp(rg,0.86,d);met=lerp(met,met*0.4,d);
        }
        /* conformal coating goes over the lot and is the last thing that
           happens to a board, so it is the last thing here */
        if(coat>0){
          rg=lerp(rg,0.08,coat*0.85);
          r=lerp(r,r*0.96+4,coat*0.3);gg=lerp(gg,gg*0.99+6,coat*0.3);b=lerp(b,b*0.94,coat*0.3);
        }
        /* the cut edge: bare laminate, rough, and a hair of burr */
        if(!wrap&&ins<1){
          const e=1-ins;
          r=lerp(r,lamC[0]*1.06,e*0.85);gg=lerp(gg,lamC[1]*1.04,e*0.85);b=lerp(b,lamC[2]*0.98,e*0.85);
          rg=lerp(rg,0.80,e);met=lerp(met,0,e);
        }

        if(vsX){
          const sc=1-clamp((Math.min(vsX[x],vsY[y])-vsW*0.35)/(vsW*0.65),0,1);
          if(sc>0.01){
            r=lerp(r,lamC[0]*1.02,sc*0.9);gg=lerp(gg,lamC[1]*1.0,sc*0.9);
            b=lerp(b,lamC[2]*0.96,sc*0.9);
            rg=lerp(rg,0.78,sc);met=lerp(met,0,sc);
            h=lerp(h,-Math.min(G.thick*0.33,0.30),sc);
          }
        }
        if(brd<0.5&&!wrap)h=-holeD*(1-brd);

        HGT[i]=h*MM;
        A3[i*3]=r;A3[i*3+1]=gg;A3[i*3+2]=b;
        RGH[i]=clamp(rg,0.03,1)*255;
        MET[i]=clamp(met,0,1)*255;
        /* A HOLE WITH A COMPONENT OVER IT IS NOT A HOLE YOU CAN SEE THROUGH.
           The drills under a thermal pad, and the overhang of a connector past
           the board edge, are both real — and both read as a bright dot of
           backdrop straight through a black package unless the silhouette is
           the board OR whatever is standing on it. */
        ALP[i]=wrap?255:Math.max(BRD[i],PA[i]);
        EMI[i]=clamp(emi,0,1)*255;
      }
    }
    if(y<TH){io.progress(0.6+y/TH*0.28);setTimeout(pass1,0);}
    else{io.progress(0.9);setTimeout(pass2,0);}
  }

  function pass2(){
    let hMin=Infinity,hMax=-Infinity;
    for(let i=0;i<N;i++){const h=HGT[i];if(h<hMin)hMin=h;if(h>hMax)hMax=h;}
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;

    const rad=Math.max(1,Math.round(TW*0.004));
    const bl=wrap?blurWrap(HGT,TW,rad):blurClamp(HGT,TW,TH,rad);
    const aoStr=clamp(num(P.aoStr,0.85),0,1);
    const sc=1/Math.max(1e-6,(hMax-hMin));
    for(let i=0;i<N;i++)
      AOc[i]=clamp(1-clamp((bl[i]-HGT[i])*sc*3.2,0,1)*aoStr,0,1)*255;
    io.progress(0.95);

    const gy=P.flipG?-1:1;
    const nstr=clamp(num(P.normalStr,1),0.1,4);
    for(let yy=0;yy<TH;yy++){
      const yp=wrap?((yy+1)%TH)*TW:Math.min(TH-1,yy+1)*TW;
      const ym2=wrap?((yy-1+TH)%TH)*TW:Math.max(0,yy-1)*TW;
      const y0=yy*TW;
      for(let xx=0;xx<TW;xx++){
        const xp=wrap?(xx+1)%TW:Math.min(TW-1,xx+1);
        const xm2=wrap?(xx-1+TW)%TW:Math.max(0,xx-1);
        const dhdu=(HGT[y0+xp]-HGT[y0+xm2])*0.5*TW*nstr;
        const dhdv=(HGT[yp+xx]-HGT[ym2+xx])*0.5*TW*nstr;
        let nx=-dhdu,ny=-dhdv*gy;
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;
        const i=(y0+xx)*3;
        NRM[i]=(nx*0.5+0.5)*255;NRM[i+1]=(ny*0.5+0.5)*255;NRM[i+2]=(inv*0.5+0.5)*255;
      }
    }
    io.progress(1);
    io.done({A:A3,NRM:NRM,RGH:RGH,MET:MET,AO:AOc,HGT:HGT,hMin:hMin,hMax:hMax,
             ALP:ALP,EMI:EMI});
  }

  io.progress(0.58);
  setTimeout(pass1,0);
}

/* ============================ mode definition ============================ */

const CAT=[
  ["Passives","r","c","fb","rarr","melf","sod"],
  ["Actives","sot23","sot235","soic8","soic16","tssop","msop","dip"],
  ["Big packages","qfp","qfpb","qfn","bga"],
  ["Power","elyt","tant","ind","dpak","to220","fuse"],
  ["Timing","xtal","hc49","osc"],
  ["Optical","led","ledc"],
  ["Interface","hdr1","hdr2","usbc","usba","rj45","jst","dcj","usd","term","sma"],
  ["Mechanical","sw","dipsw","pot","shield","tp","relay"]
];
const CAT_ROWS=CAT.map(function(grp){
  return {type:"checks",label:grp[0],items:grp.slice(1).map(function(id){
    return {id:"en"+id,label:PART_BY[id].label,value:id!=="relay"&&id!=="usba"&&id!=="dipsw"};
  })};
});

Forge.register({
  id:"pcb",
  label:"Circuit board",
  group:"Sci-fi",
  blurb:"Populated printed circuit boards, production panels and seamless board field",
  title:'Printed <em>Circuit Board</em>',
  tagline:"IPC-7351 land patterns · design rules in mils · real stack-up",
  actionLabel:"Fabricate",
  busyLabel:"Fabricating…",
  previewSize:384,
  threadable:true,
  seamless:P=>str(P.piece,"board")==="field",
  backdrops:P=>str(P.piece,"board")!=="field",
  preview:{gain:2.9,amb:1.12,specK:0.58,skyLo:[0.15,0.17,0.21],skyHi:[0.32,0.36,0.44]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
    {key:"ao",label:"AO"},{key:"emissive",label:"Emissive"},
    {key:"height",label:"Height"},{key:"orm",label:"ORM packed"},
    {key:"opacity",label:"Opacity"}
  ],

  presets:[
    {id:"mobo",label:"Motherboard",set:{piece:"board",format:"itx",lam:"fr4",mask:"green",
      finish:"hasl",dens:0.85,fill:0.7,wcore:1.3,wic:1.2,wpass:1.4,wconn:1.1,busN:6,busW:10,
      traceMil:6,clearMil:6,stitchMm:4,legend:"des",boardName:"MAINBOARD",rev:"C"}},
    {id:"ctrl",label:"Controller board",set:{piece:"board",format:"unoish",lam:"fr4",mask:"blue",
      finish:"enig",dens:0.6,fill:0.5,wcore:0.8,wconn:1.4,wmisc:1.2,busN:3,busW:8,traceMil:8,
      clearMil:8,legend:"both",boardName:"IO CONTROLLER",rev:"B"}},
    {id:"dimm",label:"Memory module",set:{piece:"board",format:"dimm",lam:"fr4",mask:"green",
      finish:"enig",fingers:true,dens:0.8,fill:0.3,wcore:0,wic:1.6,wpass:1.0,wconn:0,wclk:0.4,
      busN:5,busW:12,serp:0.7,traceMil:4,clearMil:4,legend:"des",boardName:"DDR MODULE",rev:"A"}},
    {id:"rf",label:"RF front end",set:{piece:"board",format:"custom",bwMm:60,bhMm:40,lam:"ptfe",
      mask:"blackm",finish:"enig",dens:0.55,wrf:1.8,wconn:0.8,wpass:1.2,wcore:0.4,busN:2,diffN:4,
      traceMil:12,clearMil:12,rstyle:"arc",stitchMm:2.2,legend:"des",boardName:"RF FRONT END",rev:"2"}},
    {id:"stamp",label:"Castellated module",set:{piece:"board",format:"stamp",lam:"fr4th",
      mask:"blackm",finish:"enig",dens:0.9,fill:0.8,wcore:0.9,wrf:1.2,wconn:0,traceMil:4,
      clearMil:4,textMm:0.7,legend:"none",boardName:"",rev:""}},
    {id:"strip",label:"LED strip",set:{piece:"board",format:"strip",lam:"ims",mask:"white",
      finish:"enig",dens:0.7,wopt:2,wpass:1.2,wcore:0,wic:0.3,wconn:0.4,busN:1,pwrMul:5,
      traceMil:20,clearMil:12,legend:"none",boardName:"",rev:""}},
    {id:"panel",label:"Production panel",set:{piece:"panel",format:"stamp",panX:4,panY:3,
      railMm:10,routeMm:2.4,brk:"tab",lam:"fr4",mask:"green",finish:"haslf",dens:0.8,pop:false}},
    {id:"field",label:"Board field (seamless)",set:{piece:"field",fieldMm:70,lam:"fr4",
      mask:"green",finish:"hasl",dens:0.95,fill:0.9,wcore:1.2,wic:1.2,wpass:1.5,wconn:0,
      busN:5,stitchMm:3.5,legend:"des",mount:"none",fid:false}},
    {id:"salv",label:"Salvaged and dusty",set:{piece:"board",format:"euro",lam:"fr4",
      mask:"greenm",finish:"osp",dens:0.7,flux:0.7,tarnish:0.8,dust:0.55,scratch:0.5,bodge:2,
      legend:"both",boardName:"SALVAGE",rev:"?"}},
    {id:"bare",label:"Bare fab board",set:{piece:"board",format:"euro",pop:false,flux:0,
      tarnish:0,dust:0,scratch:0.05,finish:"haslf",mask:"green",legend:"both"}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"piece",type:"select",label:"Make",value:"board",options:[
        ["board","One board — cut out"],["panel","Production panel"],
        ["field","Seamless board field"]]},
      {id:"format",type:"select",label:"Outline",value:"unoish",need:"outline",
       options:FORMAT_KEYS.map(k=>[k,FORMATS[k].label])},
      {id:"bwMm",label:"Board width",unit:"mm",min:6,max:400,step:1,value:100,need:"custom"},
      {id:"bhMm",label:"Board height",unit:"mm",min:6,max:400,step:1,value:80,need:"custom"},
      {id:"cornerMm",label:"Corner radius",unit:"mm",min:0,max:20,step:0.2,value:1.6,need:"custom"},
      {id:"fieldMm",label:"Tile covers",unit:"mm",min:12,max:400,step:1,value:70,need:"field"},
      {id:"panX",label:"Boards across",min:1,max:6,step:1,value:4,need:"panel"},
      {id:"panY",label:"Boards down",min:1,max:6,step:1,value:3,need:"panel"},
      {id:"railMm",label:"Rail width",unit:"mm",min:3,max:30,step:0.5,value:10,need:"panel"},
      {id:"routeMm",label:"Route gap",unit:"mm",min:1,max:8,step:0.2,value:2.4,need:"panel"},
      {id:"brk",type:"select",label:"Breakaway",value:"tab",need:"panel",options:[
        ["tab","Routed, tabs and mouse bites"],["vscore","V-scored"]]},
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:Forge.sizes("wide")},
      {id:"seed",type:"seed",value:7351},
      {type:"readout"},
      {type:"note",html:"Everything here is in <b>millimetres and mils</b>, because that is "+
        "what a board is ordered in: 1 mil is 0.0254 mm, and 8/8 (0.203 mm track, 0.203 mm gap) "+
        "is a cheap board while 4/4 wants a better process. The exported plane is the real "+
        "outline, so a 160 × 100 mm Eurocard lands in Blender as a 160 × 100 mm Eurocard."}
    ]},

    {title:"Stack-up",rows:[
      {id:"lam",type:"select",label:"Laminate",value:"fr4",
       options:LAM_KEYS.map(k=>[k,LAM[k].label])},
      {id:"thickMm",label:"Thickness",unit:"mm",min:0,max:4,step:0.05,value:0},
      {id:"layers",type:"select",label:"Layers",value:4,showValue:true,
       options:[[2,"2 — everything on the two faces"],[4,"4 — inner plane pair"],
                [6,"6"],[8,"8"]]},
      {id:"cuOz",type:"select",label:"Copper weight",value:1,
       options:CU_OZ.map(r=>[r[0],r[0]+" oz/ft² — "+r[1].toFixed(1)+" µm"])},
      {id:"mask",type:"select",label:"Solder mask",value:"green",
       options:MASK_KEYS.map(k=>[k,MASKC[k].label])},
      {id:"maskOp",label:"Mask opacity",min:0.2,max:1,step:0.01,value:0.8},
      {id:"maskUm",label:"Mask thickness",unit:"µm",min:4,max:60,step:1,value:25},
      {id:"maskExp",label:"Mask expansion",unit:"mm",min:0,max:0.4,step:0.01,value:0.05},
      {id:"finish",type:"select",label:"Surface finish",value:"hasl",
       options:FIN_KEYS.map(k=>[k,FIN[k].label])},
      {id:"slkUm",label:"Legend thickness",unit:"µm",min:2,max:40,step:1,value:12},
      {type:"colors",label:"Copper · legend",items:[
        {id:"cCopper",value:"#b1682f"},{id:"cSilk",value:"#e8e8e4"}]},
      {type:"note",html:"The mask is a <b>translucent film</b>, so it is thinner over a track "+
        "than over bare laminate and the tracks read through it — which is what a green board "+
        "actually looks like. Turn the opacity down and it reads like a thin coat; turn the "+
        "mask off altogether for a bare etched board."}
    ]},

    {title:"Design rules",rows:[
      {id:"traceMil",label:"Track width",unit:"mil",min:3,max:60,step:0.5,value:8},
      {id:"clearMil",label:"Clearance",unit:"mil",min:3,max:60,step:0.5,value:8},
      {id:"rstyle",type:"select",label:"Corners",value:"45",options:[
        ["45","45° chamfer — the usual"],["90","Square — old tape-up"],["arc","Rounded"]]},
      {id:"chamMm",label:"Chamfer",unit:"mm",min:0,max:4,step:0.05,value:0.6},
      {id:"pour",type:"select",label:"Copper pour",value:"gnd",options:[
        ["gnd","Ground plane"],["split","Ground, split for analogue"],["none","No pour"]]},
      {id:"pullMm",label:"Pour pullback",unit:"mm",min:0.2,max:6,step:0.1,value:0.8},
      {id:"stitchMm",label:"Stitching via pitch",unit:"mm",min:0,max:12,step:0.1,value:4},
      {id:"busN",label:"Bundles",min:0,max:10,step:1,value:5},
      {id:"busW",label:"Traces per bundle",min:2,max:24,step:1,value:8},
      {id:"diffN",label:"Differential pairs",min:0,max:6,step:1,value:2},
      {id:"serp",label:"Length matching",min:0,max:1,step:0.01,value:0.25},
      {id:"fan",label:"Fan-out",min:0,max:1,step:0.01,value:0.85},
      {id:"nets",label:"Local nets",min:0,max:1,step:0.01,value:0.6},
      {id:"pwrMul",label:"Power track ×",min:1,max:10,step:0.5,value:3},
      {type:"checks",items:[
        {id:"tent",label:"Tented vias — mask over them",value:true},
        {id:"thermV",label:"Thermal via arrays under thermal pads",value:true}]}
    ]},

    {title:"Assembly",rows:[
      {type:"checks",items:[{id:"pop",label:"Populated — parts fitted",value:true}]},
      {id:"dens",label:"Density",min:0,max:1,step:0.01,value:0.6},
      {id:"fill",label:"Passive fill",min:0,max:1,step:0.01,value:0.5},
      {id:"side",type:"select",label:"Side",value:"top",options:[
        ["top","Component side"],["bottom","Solder side — sparser"]]},
      {id:"chipSz",label:"Chip size",min:0,max:5,step:1,value:1,showValue:true},
      {id:"mount",type:"select",label:"Mounting holes",value:"m3",need:"outline",options:[
        ["none","None"],["m2","M2 — Ø2.2"],["m25","M2.5 — Ø2.7"],["m3","M3 — Ø3.2"],["m4","M4 — Ø4.3"]]},
      {id:"htClip",label:"Clip part height at",unit:"mm",min:0,max:20,step:0.5,value:4},
      {id:"bodge",label:"Bodge wires",min:0,max:4,step:1,value:0},
      {type:"checks",items:[
        {id:"bank",label:"A memory bank — identical parts in a row",value:true},
        {id:"fingers",label:"Gold edge fingers where the outline has them",value:true},
        {id:"fid",label:"Fiducials",value:true}]},
      {type:"note",html:"<b>Chip size</b> steps 0402 · 0603 · 0805 · 1206 · 1210 · 2512, and "+
        "those are EIA codes, not millimetres — an 0402 is 1.00 × 0.50 mm. Anything whose body "+
        "falls under a couple of texels is <b>dropped rather than smudged</b>, and the readout "+
        "says what went."}
    ]},

    {title:"What is on it",rows:[
      {id:"wpass",label:"Passives",min:0,max:2,step:0.05,value:1},
      {id:"wact",label:"Small actives",min:0,max:2,step:0.05,value:1},
      {id:"wic",label:"Integrated circuits",min:0,max:2,step:0.05,value:1},
      {id:"wcore",label:"Big packages",min:0,max:2,step:0.05,value:1},
      {id:"wpwr",label:"Power",min:0,max:2,step:0.05,value:1},
      {id:"wclk",label:"Timing",min:0,max:2,step:0.05,value:1},
      {id:"wopt",label:"LEDs",min:0,max:2,step:0.05,value:1},
      {id:"wconn",label:"Interface",min:0,max:2,step:0.05,value:1},
      {id:"wrf",label:"Radio",min:0,max:2,step:0.05,value:0.6},
      {id:"wmisc",label:"Switches and test points",min:0,max:2,step:0.05,value:1}
    ]},

    {title:"Catalogue",rows:CAT_ROWS.concat([
      {type:"note",html:"A family's weight says how much of the board it gets; these say which "+
        "parts are allowed to answer. Untick the lot in a family and that family is gone even "+
        "if its weight is up."}])},

    {title:"Legend",rows:[
      {id:"legend",type:"select",label:"Print",value:"des",options:[
        ["des","Reference designators"],["both","Designators and values"],["none","No legend"]]},
      {id:"textMm",label:"Text height",unit:"mm",min:0.4,max:6,step:0.05,value:1},
      {id:"slkMil",label:"Legend line width",unit:"mil",min:2,max:20,step:0.5,value:6},
      {id:"boardName",type:"text",label:"Board name",value:"IO CONTROLLER",placeholder:"anything",maxlength:28},
      {id:"rev",type:"text",label:"Revision",value:"A",placeholder:"A",maxlength:10},
      {type:"checks",items:[
        {id:"slkOut",label:"Part outlines",value:true},
        {id:"pbfree",label:"RoHS / Pb-FREE mark",value:true},
        {id:"esd",label:"ESD triangle",value:true}]},
      {type:"note",html:"The legend is drawn as <b>single-stroke gothic</b> from this file's own "+
        "alphabet rather than from a typeface, because that is what a screened legend is — a "+
        "constant-width stroke at the fab's minimum line width. It also keeps the build on a "+
        "worker thread, which a page-registered font would not."}
    ]},

    {title:"Service life",rows:[
      {id:"flux",label:"Flux residue",min:0,max:1,step:0.01,value:0.25},
      {id:"tarnish",label:"Tarnish on the joints",min:0,max:1,step:0.01,value:0.15},
      {id:"dust",label:"Dust",min:0,max:1,step:0.01,value:0.12},
      {id:"scratch",label:"Handling marks",min:0,max:1,step:0.01,value:0.15},
      {id:"coat",label:"Conformal coating",min:0,max:1,step:0.01,value:0}
    ]},

    {title:"Lit",rows:[
      {type:"checks",items:[{id:"ledOn",label:"LEDs lit",value:true}]},
      {id:"ledAmt",label:"Brightness",min:0,max:4,step:0.05,value:1},
      {type:"colors",label:"LED colour",items:[{id:"cLed",value:"#ff4a2a"}]}
    ]},

    {title:"Maps",rows:[
      {id:"normalStr",label:"Normal strength",min:0.1,max:4,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:0.85},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  needs:function(P){
    const out=[],piece=str(P.piece,"board");
    if(piece==="field")out.push("field");
    else out.push("outline");
    if(piece==="panel")out.push("panel");
    if(piece!=="field"&&str(P.format,"unoish")==="custom")out.push("custom");
    return out;
  },

  derive:function(P,ui){
    if(str(P.piece,"board")==="field"&&str(P.mount,"m3")!=="none")ui.set("mount","none");
    if(num(P.busW,8)>2&&num(P.clearMil,8)+num(P.traceMil,8)<=0)ui.set("traceMil",4);
  },

  /* THE READOUT IS ARITHMETIC, NOT A BUILD. Placing and routing a board is
     thousands of rejection tests and it is not something to do on every nudge
     of a slider, so what is quoted here is what can be worked out from the
     numbers — and that turns out to be the part that matters, because every
     one of these is a design rule measured in texels. The counts come from the
     last build and say so when they are stale. */
  readout:function(P){
    const G=boardOf(P);
    const mmPx=G.mmPerPx,px=1/mmPx;
    const w=clamp(num(P.traceMil,8),1,80)*MIL,cw=clamp(num(P.clearMil,8),1,80)*MIL;
    const fin=FIN[str(P.finish,"hasl")]||FIN.hasl;
    const lam=G.lam;
    let m="<b>"+(G.piece==="field"?"Seamless field":G.piece==="panel"
          ?(G.nx+" × "+G.ny+" panel"):FORMATS[G.fmtId].label)+"</b> · "+
      G.Wmm.toFixed(1)+" × "+G.Hmm.toFixed(1)+" mm at "+G.TW+" × "+G.TH+" px";
    m+="<br>one texel is "+mmPx.toFixed(4)+" mm — "+Math.round(25.4/mmPx)+" dpi";
    if(G.piece==="panel")m+="<br>each board "+G.bw.toFixed(1)+" × "+G.bh.toFixed(1)+
      " mm, "+G.gap.toFixed(1)+" mm route gap, "+G.rail.toFixed(1)+" mm rail";
    const LY=layerMix(P);
    m+="<br>"+lam.label+", "+G.thick.toFixed(2)+" mm, εr "+lam.er.toFixed(2)+
       " · "+ozUm(num(P.cuOz,1)).toFixed(1)+" µm copper · "+LY.ly+" layers · "+fin.label;
    m+="<br>"+(LY.ly<=2
      ?"two layers, so a signal has nowhere to go but along this face: fewer vias"
      :(LY.ly+" layers, so a signal goes DOWN: denser fan-out, stitched every "+
        (num(P.stitchMm,4)*LY.stitch).toFixed(1)+" mm"));
    m+="<br>track <b>"+(w).toFixed(3)+" mm</b> = "+(w*px).toFixed(1)+" texels · clearance "+
       (cw*px).toFixed(1)+" texels · via Ø"+VIA.drill.toFixed(2)+" mm = "+(VIA.drill*px).toFixed(1);
    if(w*px<1.3)m+='<br><span class="warn">a track under about 1.3 texels wide cannot be drawn '+
      "— raise the resolution, widen the track, or use a smaller board</span>";
    else if(w*px<2.2)m+='<br><span class="warn">at under a couple of texels the tracks will '+
      "alias along their length</span>";
    if((VIA.drill+VIA.ring*2)*px<3)m+='<br><span class="warn">the via pads are under three '+
      "texels across, so the annular ring will not read</span>";
    const cs=CHIP[CHIP_KEYS[clamp(Math.round(num(P.chipSz,1)),0,5)]];
    m+="<br>chip fill is <b>"+cs.eia+"</b>, body "+cs.body[0].toFixed(2)+" × "+
       cs.body[1].toFixed(2)+" mm = "+(cs.body[1]*px).toFixed(1)+" texels across";
    if(cs.body[1]*px<2.5)m+='<br><span class="warn">which is too few to read as a component — '+
      "step the chip size up or raise the resolution</span>";
    if(str(P.legend,"des")!=="none"){
      const t=num(P.textMm,1)*px;
      m+="<br>legend text "+num(P.textMm,1).toFixed(2)+" mm cap = "+t.toFixed(1)+" texels, line "+
         (num(P.slkMil,6)*MIL*px).toFixed(1)+" texels";
      if(t<3.2)m+='<br><span class="warn">under about 3.2 texels of cap height the designators '+
        "are dropped rather than printed as mush</span>";
      if(num(P.textMm,1)<0.8)m+='<br><span class="warn">and under 0.8 mm no fab will screen it '+
        "legibly anyway</span>";
    }
    if(num(P.maskExp,0.05)*px<0.8&&(MASKC[str(P.mask,"green")]||MASKC.green).id!=="none")
      m+="<br>mask expansion is under a texel, so the pads will have no visible mask relief";
    if(G.fing!=="none")m+="<br>edge fingers on the "+G.fing+" edge, hard gold";
    if(G.cast)m+="<br>castellated edges — half-holes on both long edges";
    const key=statKey(P,G);
    if(LAST&&LAST.key===key){
      m+="<br><b>"+LAST.parts+"</b> parts · "+LAST.routes+" tracks · "+LAST.vias+" vias"+
         (LAST.fingers?(" · "+LAST.fingers+" fingers"):"");
      const d=Object.keys(LAST.drops||{});
      if(d.length)m+='<br><span class="warn">dropped as too small for this resolution: '+
        d.map(k=>(PART_BY[k]?PART_BY[k].label:k)+" ×"+LAST.drops[k]).join(", ")+"</span>";
      m+="<br>tallest part "+LAST.htMax.toFixed(2)+" mm — "+
         (num(P.htClip,0)>0?("clipped at "+num(P.htClip,0).toFixed(1)+" mm"):"unclipped");
      if(LAST.hidden)m+="<br>"+LAST.hidden+" designator"+(LAST.hidden>1?"s":"")+
        " had nowhere clear to print and went unlabelled";
    }else m+="<br>the part and track counts land here with the build";
    return m;
  },

  tileTag:function(P){return str(P.piece,"board")==="field"
    ?"seamless in both axes":"cut-out · alpha is the outline";},
  sizeTag:function(P){const G=boardOf(P);
    return (G.piece==="field"?"field":G.piece==="panel"?(G.nx+"×"+G.ny+" panel")
      :FORMATS[G.fmtId].label)+" · "+G.Wmm.toFixed(0)+" × "+G.Hmm.toFixed(0)+" mm";},

  /* the glow is the LED's colour, not the runtime's warm default */
  writers:function(B,P){
    const E=B.EMI,c=hex2rgb(str(P.cLed,"#ff4a2a"));
    return {emissive:function(i,o,k){
      const e=E[i]/255;
      o[k]=c[0]*e;o[k+1]=c[1]*e;o[k+2]=c[2]*e;
      return 255;
    }};
  },

  /* A populated board and the bare fab board off the same design are two
     different deliverables and people want both — the bare one to composite
     your own parts onto, or to put on the underside. One switch, one archive. */
  variants:function(P){
    const out=[];
    if(bool(P.pop,true))out.push({id:"bare",label:"bare fab board — nothing fitted",set:{pop:false,
      flux:0,bodge:0}});
    const worn=num(P.flux,0)+num(P.tarnish,0)+num(P.dust,0)+num(P.scratch,0);
    if(worn>0.02)out.push({id:"clean",label:"straight off the line",set:{flux:0,tarnish:0,
      dust:0,scratch:0}});
    return out;
  },

  size:function(P,preview){
    const G=boardOf(P,preview?384:0);
    return {w:G.TW,h:G.TH};
  },
  build:build,

  /* metres, always */
  plan:function(P){
    const G=boardOf(P);
    const o={w:G.Wmm/1000,h:G.Hmm/1000,cutout:G.piece!=="field"};
    if(G.piece==="field")o.tile=G.Wmm/1000;
    return o;
  },

  fileBase:function(P,W){
    const G=boardOf(P);
    return "pcb_"+(G.piece==="field"?"field":G.piece==="panel"?"panel":G.fmtId)+
      "_"+(P.seed|0)+"_"+W;
  },

  readme:function(P,info){
    const G=boardOf(P,info.W);
    const lam=G.lam,mk=MASKC[str(P.mask,"green")]||MASKC.green;
    const fin=FIN[str(P.finish,"hasl")]||FIN.hasl;
    const cuUm=ozUm(num(P.cuOz,1));
    const w=clamp(num(P.traceMil,8),1,80)*MIL,cw=clamp(num(P.clearMil,8),1,80)*MIL;
    const px=1/(G.Wmm/info.W);
    const relief=(info.hMax-info.hMin)*G.Wmm;
    const out=["Texture Forge · pcb — "+
      (G.piece==="field"?"seamless board field":G.piece==="panel"
        ?(G.nx+" x "+G.ny+" production panel"):FORMATS[G.fmtId].label),
      "",
      "Seed "+(P.seed|0)+"   Texture "+info.W+" x "+info.H+" px",
      "The board is "+G.Wmm.toFixed(2)+" x "+G.Hmm.toFixed(2)+" mm — "+
        Math.round(25.4/(G.Wmm/info.W))+" dpi, one texel is "+(G.Wmm/info.W).toFixed(4)+" mm.",
      "Scale your plane to that and every dimension on it is the dimension it was drawn at.",
      ""];
    if(G.piece==="field")
      out.push("This one TILES in both axes: the plane, the tracks and the parts all wrap, so it",
        "is meant for covering something large rather than for being one board.","");
    else out.push("This is ONE "+(G.piece==="panel"?"PANEL":"BOARD")+", not a tiling material.",
      "The alpha channel is the blank: outside the outline, and inside every drilled hole, it",
      "is transparent."+(G.piece==="panel"
        ?" The route gaps between the boards are transparent too, and the breakaway tabs are not."
        :""),"");
    out.push("STACK-UP",
      "  laminate      "+lam.label+", "+G.thick.toFixed(2)+" mm, dielectric constant "+lam.er.toFixed(2)+
        (lam.weave?(", glass cloth at "+lam.weave[0].toFixed(3)+" / "+lam.weave[1].toFixed(3)+
          " mm yarn pitch"):", no visible weave"),
      "  copper        "+num(P.cuOz,1)+" oz/ft2 = "+cuUm.toFixed(1)+" um, "+(P.layers|0||2)+" layers",
      "                "+((P.layers|0||2)<=2
        ?"two layers: a signal has nowhere to go but along this face, so there are fewer vias"
        :"a signal goes down to the inner layers, so this face has a denser fan-out and more stitching"),
      "  solder mask   "+mk.label+(mk.id==="none"?"":
        (", "+num(P.maskUm,25).toFixed(0)+" um, "+num(P.maskExp,0.05).toFixed(2)+
         " mm expansion per side")),
      "  finish        "+fin.label+" — "+fin.note+(fin.um?(", "+fin.um+" um"):""),
      "  legend        "+(str(P.legend,"des")==="none"?"none":
        (num(P.textMm,1).toFixed(2)+" mm cap height at "+num(P.slkMil,6).toFixed(1)+
         " mil line width, single-stroke gothic")),
      "",
      "DESIGN RULES",
      "  track         "+num(P.traceMil,8).toFixed(1)+" mil = "+w.toFixed(3)+" mm ("+
        (w*px).toFixed(1)+" texels)",
      "  clearance     "+num(P.clearMil,8).toFixed(1)+" mil = "+cw.toFixed(3)+" mm ("+
        (cw*px).toFixed(1)+" texels)",
      "  via           "+VIA.drill.toFixed(2)+" mm drill, "+VIA.ring.toFixed(2)+
        " mm annular ring, pad "+(VIA.drill+VIA.ring*2).toFixed(2)+" mm"+
        (bool(P.tent,true)?", tented":", open"),
      "  corners       "+(str(P.rstyle,"45")==="90"?"square":str(P.rstyle,"45")==="arc"?"rounded"
        :("45 degrees, "+num(P.chamMm,0.6).toFixed(2)+" mm chamfer")),
      "  pour          "+(str(P.pour,"gnd")==="none"?"none":
        ("ground plane pulled back "+num(P.pullMm,0.8).toFixed(1)+" mm from the cut"+
         (num(P.stitchMm,0)>0.8?(", stitched every "+num(P.stitchMm,4).toFixed(1)+" mm"):""))),
      "");
    if(LAST&&LAST.key===statKey(P,G))out.push("WHAT IS ON IT",
      "  "+LAST.parts+" parts, "+LAST.routes+" tracks, "+LAST.vias+" vias"+
        (LAST.fingers?(", "+LAST.fingers+" gold edge fingers"):""),
      "  tallest part "+LAST.htMax.toFixed(2)+" mm"+
        (num(P.htClip,0)>0?(", clipped to "+num(P.htClip,0).toFixed(1)+" mm"):""),
      "");
    out.push(
      "basecolor.png  sRGB albedo. Alpha is the blank.",
      "normal.png     Tangent space, "+info.normalNote+". Non-colour.",
      "roughness.png  Linear grey. Gloss mask, matte legend, bright finish, dull laminate.",
      "metallic.png   Linear grey — the mask openings and every metal part are metal, the",
      "               laminate, the mask and the mouldings are not.",
      "ao.png         Linear grey. The relief is mostly component bodies, so it carries them.",
      "emissive.png   "+(bool(P.ledOn,true)?("The LED lenses, in "+str(P.cLed,"#ff4a2a")+
        " at "+num(P.ledAmt,1).toFixed(2)+"x."):"Black — the LEDs are off."),
      "height.png     8-bit displacement spanning "+relief.toFixed(3)+" mm of real relief.",
      "height16.png   USE THIS ONE. A board's relief runs from 35 um of copper to a ten-",
      "               millimetre capacitor can, and eight bits across that range puts the",
      "               copper, the mask and the legend on the same two or three levels.",
      "orm.png        R = AO, G = roughness, B = metallic.",
      "opacity.png    The blank, including every hole.",
      "",
      "ON THE NUMBERS. The land patterns are IPC-7351 density level B: the chip passives",
      "from the published table, everything leaded constructed the way the standard",
      "constructs it — the pad is the lead plus a toe fillet, a heel fillet and a side",
      "fillet, and the pad span is the datasheet lead span. Package bodies are EIA and",
      "JEDEC and are exact. Copper weight converts at 1 oz/ft2 = 34.8 um. Reference",
      "designator prefixes follow IEEE 315. None of that makes this a manufacturable",
      "design — there is no netlist here, the tracks go from somewhere plausible to",
      "somewhere plausible, and nothing in it has been checked against a real DRC.");
    return out.join("\n");
  }
});

/* the counts come out of the build rather than out of a second placement run */
function statKey(P,G){
  return [str(P.piece,"board"),G.fmtId,P.seed|0,G.TW,G.TH,num(P.dens,0.6),num(P.fill,0.5),
    Math.round(num(P.chipSz,1)),str(P.side,"top"),P.busN|0,P.busW|0,num(P.fan,0.7),
    num(P.stitchMm,4),num(P.nets,0.6),P.layers|0,bool(P.pop,true)?1:0].join("|");
}
let LAST=null;

/* what the tests reach for */
window.ForgePCB={
  LAM:LAM,MASKC:MASKC,FIN:FIN,CU_OZ:CU_OZ,ozUm:ozUm,FORMATS:FORMATS,VIA:VIA,MH:MH,
  CHIP:CHIP,CHIP_KEYS:CHIP_KEYS,TANT:TANT,PART:PART,PART_BY:PART_BY,MAT:MAT,MIL:MIL,
  GLY:GLY,GLY_ADV:GLY_ADV,GLY_CAP:GLY_CAP,glyWidth:glyWidth,
  boardOf:boardOf,cellsOf:cellsOf,footprint:footprint,leadRow:leadRow,FILLET:FILLET,
  layoutBoard:layoutBoard,populate:populate,routeBuses:routeBuses,routeRest:routeRest,
  route:route,assemble:assemble,silk:silk,panelParts:panelParts,
  chamfer:chamfer,offsetPoly:offsetPoly,manhattan:manhattan,Claims:Claims,
  wOf:wOf,famW:famW,partRecs:partRecs,offsetsOf:offsetsOf,layerMix:layerMix,
  stats:function(){return LAST;}
};

})();
