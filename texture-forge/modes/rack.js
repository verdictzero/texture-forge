/* =====================================================================
   MODE: rack — a populated equipment rack, 1980s futurism
   =====================================================================

   A cabinet of machinery seen from the front, with cables run between the
   things in it. None of the hardware is anything that was ever made: the
   devices here are invented, and what makes them read as EQUIPMENT rather
   than as greebles is that they are built out of the controls a machine of
   that period was actually operated with.

   THE RACK IS REAL AND THE KIT IS NOT. The frame is EIA-310 — a 482.6 mm
   panel, 44.45 mm to the U, mounting holes at 15.875, 15.875 and 12.7 mm
   up each U with their centres 465.1 mm apart. Those are a standard
   rather than anybody's design, and they are what makes a rack look like a
   rack: every panel joins its neighbour on a 44.45 mm pitch, every screw
   lands on a hole that exists, and nothing is anywhere by eye. Everything
   bolted INTO that frame is made up here from scratch.

   WHAT SAYS 1980s, and it is not the colour. It is that the machine is
   operated by HAND, through things you can feel:

     lamps        Filament jewels in a bezel, by the dozen, in rows that
                  mean something — a row per channel, a block per bus.
                  Not a status LED: a lamp you could change.
     switches     Toggles with bat handles, rockers, legend-cap buttons,
                  rotary selectors with a pointer knob and an engraved
                  scale. A panel with twenty of them is a panel somebody
                  stood in front of.
     meters       Moving-coil, round or edgewise, with an arc scale and a
                  needle that sits where the needle sits.
     readouts     Seven-segment numerals behind a smoked window, and bar
                  graphs made of discrete segments rather than a gradient.
     transports   The one silhouette that dates a machine instantly: two
                  reels behind a window, tape between them.
     ventilation  Punched louvres and hole fields, because this kit ran
                  hot and was cooled by moving air through the front.

   ONE MAKER BUILT ALL OF IT. The strongest thing in the picture is not
   any single device, it is that they match: one bezel colour, one corner
   radius, one handle, one place the nameplate goes, one family of lamp
   colours. That is drawn once per seed and applied to everything, the
   same way the glyph mode draws one hand and writes the whole alphabet
   with it. A rack of devices that each chose their own styling reads as a
   junk shop, which is the usual failure of this subject.

   AND IT IS LAID OUT THE WAY A RACK IS ACTUALLY BUILT, which is the
   lesson from the circuit board: placement first, in the order an
   engineer would do it, and the rest filled in after. Power at the
   bottom, where the supply comes in and the weight belongs. The console
   at standing height, because somebody has to use it. Transports in the
   middle where they can be reached. Patch and line panels at the top.
   Vent panels above whatever runs hot. Blanks in the gaps, because an
   open U in a cooled cabinet is a short circuit in the airflow.

   CABLES GO WHERE CABLES GO. A lead leaves a port, turns down the side
   channel, runs vertically with its neighbours, and comes back out at
   the port it is going to — with a service loop, because nobody pulls a
   cable tight. They are drawn OVER the faces, since that is where they
   are: in front. A rack whose cabling is tidy was photographed on the
   day it was commissioned and never again.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      fbm2=Forge.fbm2,hashi=Forge.hashi,hex2rgb=Forge.hex2rgb,
      blurClamp=Forge.blurClamp,mulberry32=Forge.mulberry32;

const num=(v,d)=>{const n=+v;return isFinite(n)?n:d;};
const str=(v,d)=>(v===undefined||v===null||v==="")?d:String(v);
const bool=(v,d)=>(v===undefined||v===null)?d:!!v;
const TAU=Math.PI*2,DEG=Math.PI/180;
const pick=(rng,a)=>a[Math.min(a.length-1,Math.floor(rng()*a.length))];
/* AN INTEGER SEED, and it matters more than it looks. The shared hash returns
   a float in [0,1) and mulberry32 opens by taking `|0` of whatever it is
   handed — so every float seed in that range collapses to zero and every seed
   produces the SAME STREAM. A rack seeded that way is the same rack at every
   seed, which reads as variety right up until two of them are put side by
   side. Every other mode in the file set hands mulberry32 an integer; this one
   makes the integer explicitly. */
const hseed=(a,b,s)=>(hashi(a,b,s)*4294967296)|0;
function shuffled(rng,arr){
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));const t=a[i];a[i]=a[j];a[j]=t;}
  return a;
}

/* ============================ the frame ============================
   EIA-310, in millimetres. A panel is 482.6 wide and a whole number of
   44.45 mm units tall, less a hair so two of them do not foul; the holes
   up each rail go 15.875, 15.875, 12.7 and repeat, which is the pattern
   that makes a rack screw land somewhere a rack screw can land. */
const U=44.45, PANEL_W=482.6, HOLE_DX=465.1, GAP=0.8;
/* where the three holes of one U sit, measured up from the bottom of it */
const HOLE_Y=[6.35,22.225,38.1];

/* ============================ the finishes ============================
   What the period painted things. `yellow` is how far the plastic has gone
   on its own — the pale putty finishes of that decade went amber under UV
   and nothing else did, which is most of what makes an old machine look old
   rather than merely dirty. */
const FINISH={
  putty :{name:"putty enamel",      c:"#bdb4a2",met:0.02,rgh:0.56,yellow:1.00},
  bone  :{name:"bone white",        c:"#cfc9bb",met:0.02,rgh:0.52,yellow:0.85},
  slate :{name:"slate grey enamel", c:"#6e7276",met:0.03,rgh:0.58,yellow:0.15},
  char  :{name:"charcoal crinkle",  c:"#34363a",met:0.04,rgh:0.78,yellow:0.05},
  olive :{name:"olive drab",        c:"#6d6b52",met:0.03,rgh:0.62,yellow:0.20},
  brush :{name:"brushed aluminium", c:"#9fa3a7",met:0.88,rgh:0.34,yellow:0.00},
  anod  :{name:"black anodised",    c:"#2a2c30",met:0.80,rgh:0.42,yellow:0.00}
};
const FIN_KEYS=Object.keys(FINISH);

/* Lamp colours. Filament jewels, so the lens is a saturated transparent cap
   over a warm source — which is why the lit colour is never the lens colour
   and the unlit one is darker and duller than people draw it. */
const LAMP={
  red  :{off:"#5a2420",on:[255,96,70],  name:"red"},
  amber:{off:"#604218",on:[255,172,56], name:"amber"},
  green:{off:"#1f4a2c",on:[112,255,150],name:"green"},
  white:{off:"#5c5a52",on:[255,244,214],name:"clear"},
  blue :{off:"#1e3356",on:[120,186,255],name:"blue"}
};
const LAMP_KEYS=Object.keys(LAMP);

/* The phosphors a screen of that period actually had. */
const PHOS={
  p1 :{on:[120,255,160],name:"green P1"},
  p3 :{on:[255,186,80], name:"amber P3"},
  p4 :{on:[226,232,240],name:"white P4"}
};

/* ============================ the devices ============================
   Archetypes, not products. `u` is the range of heights one may be built
   at, `want` is where in the cabinet it belongs — which is what makes the
   fill read as a designed installation rather than a shuffled deck — and
   `heat` says whether the thing above it ought to be a vent panel.

     want  0 floor, 1 low, 2 hand height, 3 high, 4 anywhere */
const DEV=[
  {id:"power", name:"power distribution",u:[2,3],want:0,heat:0.5,w:1.0},
  {id:"supply",name:"regulator bay",     u:[3,5],want:0,heat:1.0,w:0.8},
  {id:"logic", name:"logic bay",         u:[3,6],want:1,heat:0.8,w:1.0},
  {id:"store", name:"tape transport",    u:[6,9],want:2,heat:0.4,w:0.9},
  {id:"disc",  name:"disc pack drive",   u:[4,6],want:1,heat:0.6,w:0.7},
  {id:"cart",  name:"cartridge loader",  u:[2,3],want:2,heat:0.2,w:0.6},
  {id:"conso", name:"operator console",  u:[4,7],want:2,heat:0.3,w:0.9},
  {id:"instr", name:"instrument panel",  u:[2,4],want:2,heat:0.1,w:0.9},
  {id:"term",  name:"display terminal",  u:[5,8],want:2,heat:0.4,w:0.6},
  {id:"patch", name:"patch field",       u:[1,3],want:3,heat:0.0,w:0.9},
  {id:"line",  name:"line interface",    u:[1,2],want:3,heat:0.2,w:0.8},
  {id:"timing",name:"timing standard",   u:[1,2],want:3,heat:0.1,w:0.5}
];
const DEV_BY={};for(const d of DEV)DEV_BY[d.id]=d;

/* ============================ one maker ============================
   Everything in the cabinet was built by the same people, and that is the
   single strongest thing in the picture. One bezel colour, one corner
   radius, one handle, one place the nameplate goes, one family of lamp
   colours — drawn once per seed and applied to every device. A rack whose
   devices each chose their own styling reads as a junk shop. */
function houseOf(P){
  const seed=P.seed|0,rng=mulberry32(hseed(7,13,seed));
  const face=str(P.finish,"putty");
  const F=FINISH[face]||FINISH.putty;
  const trimKey=bool(P.trimAuto,true)
    ?(F.met>0.5?"char":pick(rng,["char","anod","slate"]))
    :str(P.trim,"char");
  /* THREE LAMP COLOURS, NOT FIVE. A panel that uses every jewel in the
     catalogue reads as a toy; two states and an alarm is what a real one
     has, and the third is nearly always red. */
  const pool=shuffled(rng,["amber","green","white","blue"]).slice(0,2);
  return {
    F:F,fin:face,
    trim:FINISH[trimKey]||FINISH.char,trimKey:trimKey,
    r:pick(rng,[0,0,1.5,3]),                    /* corner radius, mm */
    handle:pick(rng,["bar","bar","cup","none"]),
    legendAt:pick(rng,["tl","tl","bc"]),        /* nameplate position */
    lamps:["red"].concat(pool),
    phos:str(P.phos,"auto")==="auto"?pick(rng,["p1","p1","p3","p4"]):str(P.phos,"p1"),
    knobR:pick(rng,[7,8,9]),
    screwR:1.9,
    ears:pick(rng,[true,true,false]),           /* a visible ear strip each side */
    div:pick(rng,[true,true,false]),            /* engraved division lines */
    seed:seed
  };
}

/* ============================ the three planes ============================
   A face is drawn into three canvases at once: what colour it is, what it is
   made of and how high it stands, and what of it is lit. Issuing each path
   three times is the cost of not writing a rasteriser, and at a few thousand
   elements it is nothing.

     A   albedo, straight
     P   R = height, G = metalness, B = gloss. Antialiasing blends all three
         the same way it blends colour, which is right: they are continuous
         properties of the surface, not identifiers.
     E   what is emitting, in its own colour */
const HLO=-10,HHI=30;                            /* the height window, mm */
const hv=mm=>clamp((mm-HLO)/(HHI-HLO),0,1)*255;
const packP=(mm,met,gl)=>"rgb("+Math.round(hv(mm))+","+
  Math.round(clamp(met,0,1)*255)+","+Math.round(clamp(gl,0,1)*255)+")";

function painter(cvA,cvP,cvE,kx,ky,H){
  const a=cvA.getContext("2d",{willReadFrequently:true}),
        p=cvP.getContext("2d",{willReadFrequently:true}),
        e=cvE.getContext("2d",{willReadFrequently:true});
  /* SCALED SEPARATELY IN X AND Y, by a hair. The runtime hands the build the
     buffer size it rounded to, which is a texel or two off this artwork's own
     aspect, and drawing at one average scale would leave a sliver of nothing
     down one edge. A sub-texel anisotropy nobody can see is the cheaper of
     the two errors. */
  for(const g of [a,p,e]){g.save();g.scale(kx,ky);g.lineJoin="round";g.lineCap="round";}
  return {a:a,p:p,e:e,k:Math.min(kx,ky),H:H,
    done:function(){for(const g of [a,p,e])g.restore();}};
}
/* fill one path into every plane it belongs in. `o` is {c,h,met,gl,emi}. */
function fill(D,path,o){
  D.a.fillStyle=o.c;path(D.a);D.a.fill();
  D.p.fillStyle=packP(num(o.h,0),num(o.met,0.02),num(o.gl,0.4));path(D.p);D.p.fill();
  if(o.emi){D.e.fillStyle=o.emi;path(D.e);D.e.fill();}
}
function stroke(D,path,w,o){
  D.a.strokeStyle=o.c;D.a.lineWidth=w;path(D.a);D.a.stroke();
  D.p.strokeStyle=packP(num(o.h,0),num(o.met,0.02),num(o.gl,0.4));
  D.p.lineWidth=w;path(D.p);D.p.stroke();
  if(o.emi){D.e.strokeStyle=o.emi;D.e.lineWidth=w;path(D.e);D.e.stroke();}
}
const rrectP=(x,y,w,h,r)=>g=>{
  const rr=Math.max(0,Math.min(r,Math.min(w,h)*0.5));
  g.beginPath();
  g.moveTo(x+rr,y);g.lineTo(x+w-rr,y);if(rr)g.arcTo(x+w,y,x+w,y+rr,rr);
  g.lineTo(x+w,y+h-rr);if(rr)g.arcTo(x+w,y+h,x+w-rr,y+h,rr);
  g.lineTo(x+rr,y+h);if(rr)g.arcTo(x,y+h,x,y+h-rr,rr);
  g.lineTo(x,y+rr);if(rr)g.arcTo(x,y,x+rr,y,rr);
  g.closePath();
};
const circP=(x,y,r)=>g=>{g.beginPath();g.arc(x,y,Math.max(0.01,r),0,TAU);g.closePath();};
const lineP=(x0,y0,x1,y1)=>g=>{g.beginPath();g.moveTo(x0,y0);g.lineTo(x1,y1);};
const rgb=c=>"rgb("+Math.round(c[0])+","+Math.round(c[1])+","+Math.round(c[2])+")";
const shade=(hexc,f)=>{const c=hex2rgb(hexc);return rgb([c[0]*f,c[1]*f,c[2]*f]);};

/* HOW MUCH OF IT IS POWERED UP. A dead rack is a different picture from a
   live one and it is not the live one with the lamps turned down: the jewels
   go to their unlit colour, the displays go blank, the meters fall back and
   the switches are off. That is one number, and every control reads it,
   because a face that decided its own states would have half of them lit in a
   cabinet somebody had pulled the breaker on.

   It is module state set once at the top of a compose and read-only for the
   rest of it, which is the shape of a drawing context rather than of a
   setting — the alternative is threading it through forty call sites that
   have nothing else to say about it. */
let LITF=1;
const lit=(rng,p)=>rng()<p*LITF;
const dark=()=>LITF<=0.02;

/* ============================ the controls ============================
   What a machine of this period was operated through. Every one of them is
   drawn from paths at a real size in millimetres: a toggle bat is 4 mm
   across because that is what a toggle bat is, and the panel it is on is
   482.6 mm, so they come out in the proportion they come out in. */

/* a filament jewel in a bezel: a chrome ring, a coloured lens, and a
   highlight that is on the lens rather than on the ring */
function lamp(D,x,y,r,key,lit){
  const L=LAMP[key]||LAMP.red;
  fill(D,circP(x,y,r*1.32),{c:"#2b2d31",h:-0.5,met:0.5,gl:0.35});
  fill(D,circP(x,y,r*1.16),{c:"#8e9298",h:0.9,met:0.9,gl:0.72});
  fill(D,circP(x,y,r),{c:lit?rgb([L.on[0]*0.72,L.on[1]*0.72,L.on[2]*0.72]):L.off,
    h:1.4,met:0.05,gl:0.92,emi:lit?rgb(L.on):null});
  /* the glass is domed, so the catch light is up and to the left and small */
  fill(D,circP(x-r*0.3,y-r*0.3,r*0.26),{c:"#ffffff",h:1.5,met:0.02,gl:0.98,
    emi:lit?rgb([255,255,245]):null});
}
/* a toggle with a bat handle. The bezel is a hex nut, which is how a toggle
   is actually fixed through a panel. */
function toggle(D,x,y,s,up){
  fill(D,circP(x,y,s*0.95),{c:"#7e828a",h:1.2,met:0.88,gl:0.6});
  const g=g2=>{g2.beginPath();
    for(let i=0;i<6;i++){const a2=i/6*TAU+0.26;
      const px=x+Math.cos(a2)*s*0.8,py=y+Math.sin(a2)*s*0.8;
      if(i)g2.lineTo(px,py);else g2.moveTo(px,py);}
    g2.closePath();};
  fill(D,g,{c:"#9aa0a8",h:2.0,met:0.92,gl:0.66});
  const dy=up?-1:1;
  stroke(D,lineP(x,y,x,y+dy*s*1.9),s*0.72,{c:"#1f2124",h:6,met:0.3,gl:0.5});
  fill(D,circP(x,y+dy*s*1.9,s*0.42),{c:"#34373c",h:7,met:0.3,gl:0.55});
}
/* a rocker in a rectangular bezel: half of it stands proud, half is sunk */
function rocker(D,x,y,w,h,on,key){
  fill(D,rrectP(x,y,w,h,0.6),{c:"#25272b",h:-1.2,met:0.3,gl:0.4});
  const L=LAMP[key||"red"];
  fill(D,rrectP(x+0.5,y+0.5,w-1,h*0.5-0.5,0.4),
    {c:on?L.off:"#4a4d52",h:on?-0.4:1.6,met:0.05,gl:0.6,
     emi:on?rgb([L.on[0]*0.5,L.on[1]*0.5,L.on[2]*0.5]):null});
  fill(D,rrectP(x+0.5,y+h*0.5,w-1,h*0.5-0.5,0.4),
    {c:"#3c3f44",h:on?1.6:-0.4,met:0.05,gl:0.6});
}
/* a rotary selector: a skirted knob with a pointer, over an engraved arc of
   detents. The pointer is where the pointer is — detented, not continuous. */
function knob(D,x,y,r,n,sel){
  const a0=-220*DEG,a1=40*DEG;
  stroke(D,g=>{g.beginPath();g.arc(x,y,r*1.5,a0,a1);},0.7,
    {c:"#2e3034",h:-0.4,met:0.1,gl:0.3});
  for(let i=0;i<n;i++){
    const a2=lerp(a0,a1,n<2?0:i/(n-1));
    stroke(D,lineP(x+Math.cos(a2)*r*1.32,y+Math.sin(a2)*r*1.32,
                   x+Math.cos(a2)*r*1.62,y+Math.sin(a2)*r*1.62),0.6,
      {c:"#2e3034",h:-0.4,met:0.1,gl:0.3});
  }
  fill(D,circP(x,y,r*1.06),{c:"#1d1f22",h:1.0,met:0.1,gl:0.3});
  fill(D,circP(x,y,r),{c:"#3a3d42",h:9,met:0.12,gl:0.42});
  /* a knurled skirt reads as grip at any size that can hold it */
  for(let i=0;i<18;i++){
    const a2=i/18*TAU;
    stroke(D,lineP(x+Math.cos(a2)*r*0.78,y+Math.sin(a2)*r*0.78,
                   x+Math.cos(a2)*r*0.99,y+Math.sin(a2)*r*0.99),r*0.11,
      {c:"#2b2e32",h:9.2,met:0.12,gl:0.4});
  }
  fill(D,circP(x,y,r*0.62),{c:"#4a4e54",h:11,met:0.12,gl:0.46});
  const sa=lerp(a0,a1,n<2?0:clamp(sel,0,n-1)/(n-1));
  stroke(D,lineP(x,y,x+Math.cos(sa)*r*0.88,y+Math.sin(sa)*r*0.88),r*0.2,
    {c:"#e8e4d8",h:11.4,met:0.05,gl:0.5});
}
/* a legend-cap push button: a square cap in a bezel, lit from behind */
function button(D,x,y,w,h,key,lit){
  const L=LAMP[key]||LAMP.white;
  fill(D,rrectP(x,y,w,h,0.8),{c:"#212428",h:-1.0,met:0.4,gl:0.4});
  fill(D,rrectP(x+0.7,y+0.7,w-1.4,h-1.4,0.6),
    {c:lit?rgb([L.on[0]*0.62,L.on[1]*0.62,L.on[2]*0.62]):L.off,
     h:2.6,met:0.03,gl:0.7,emi:lit?rgb([L.on[0]*0.88,L.on[1]*0.88,L.on[2]*0.88]):null});
}
/* a moving-coil meter: an arc scale, ticks, and a needle that sits somewhere
   in particular. The glass is a flat window standing proud of the bezel. */
function meterR(D,x,y,r,val,H){
  if(dark())val=0.015;                        /* a dead meter is at its stop */
  fill(D,rrectP(x-r*1.15,y-r*1.1,r*2.3,r*2.0,1.2),{c:shade(H.trim.c,1.0),h:1.2,
    met:H.trim.met,gl:1-H.trim.rgh});
  fill(D,circP(x,y+r*0.16,r*0.95),{c:"#d9d6cc",h:0.4,met:0.02,gl:0.3});
  const a0=-150*DEG,a1=-30*DEG,cy=y+r*0.42;
  stroke(D,g=>{g.beginPath();g.arc(x,cy,r*0.70,a0,a1);},r*0.05,
    {c:"#2a2a28",h:0.5,met:0.02,gl:0.3});
  for(let i=0;i<=10;i++){
    const a2=lerp(a0,a1,i/10),lg=(i%5===0)?0.16:0.09;
    stroke(D,lineP(x+Math.cos(a2)*r*0.70,cy+Math.sin(a2)*r*0.70,
                   x+Math.cos(a2)*r*(0.70+lg),cy+Math.sin(a2)*r*(0.70+lg)),
      r*(i%5===0?0.055:0.035),{c:"#2a2a28",h:0.5,met:0.02,gl:0.3});
  }
  /* a red band at the top of the scale, which every meter of this kind had */
  stroke(D,g=>{g.beginPath();g.arc(x,cy,r*0.78,lerp(a0,a1,0.78),a1);},r*0.07,
    {c:"#b3302a",h:0.5,met:0.02,gl:0.3});
  const na=lerp(a0,a1,clamp(val,0,1));
  stroke(D,lineP(x,cy,x+Math.cos(na)*r*0.80,cy+Math.sin(na)*r*0.80),r*0.055,
    {c:"#17181a",h:1.0,met:0.02,gl:0.35});
  fill(D,circP(x,cy,r*0.10),{c:"#17181a",h:1.2,met:0.1,gl:0.4});
  fill(D,circP(x,y+r*0.16,r*0.95),{c:"rgba(228,238,246,0.10)",h:2.2,met:0.0,gl:0.97});
}
/* an edgewise meter: a narrow window with a scale along it */
function meterE(D,x,y,w,h,val,H){
  if(dark())val=0.015;
  fill(D,rrectP(x,y,w,h,0.8),{c:shade(H.trim.c,1.0),h:1.0,met:H.trim.met,gl:1-H.trim.rgh});
  fill(D,rrectP(x+1,y+1,w-2,h-2,0.5),{c:"#cfccc2",h:0.3,met:0.02,gl:0.3});
  for(let i=0;i<=8;i++){
    const px=lerp(x+2.5,x+w-2.5,i/8);
    stroke(D,lineP(px,y+h-2,px,y+h-2-(i%4===0?h*0.46:h*0.26)),0.45,
      {c:"#2a2a28",h:0.4,met:0.02,gl:0.3});
  }
  const nx=lerp(x+2.5,x+w-2.5,clamp(val,0,1));
  stroke(D,lineP(nx,y+1.6,nx,y+h-1.6),0.9,{c:"#c0352c",h:0.9,met:0.02,gl:0.35});
  fill(D,rrectP(x+1,y+1,w-2,h-2,0.5),{c:"rgba(228,238,246,0.09)",h:1.8,met:0,gl:0.96});
}
/* a bar graph of DISCRETE segments. A smooth gradient is a later idea. */
function bars(D,x,y,w,h,n,lv,key){
  const L=LAMP[key]||LAMP.green;
  fill(D,rrectP(x-0.8,y-0.8,w+1.6,h+1.6,0.5),{c:"#1b1d20",h:-0.8,met:0.3,gl:0.45});
  const sh=h/n;
  for(let i=0;i<n;i++){
    const on=!dark()&&(n-i)<=Math.round(lv*n);
    const top=(n-1-i)<Math.round(n*0.22);          /* the red end */
    const C=top?LAMP.red:L;
    fill(D,rrectP(x,y+i*sh+sh*0.16,w,sh*0.68,0.3),
      {c:on?rgb([C.on[0]*0.6,C.on[1]*0.6,C.on[2]*0.6]):shade(C.off,0.55),
       h:0.2,met:0.03,gl:0.6,
       emi:on?rgb([C.on[0]*0.9,C.on[1]*0.9,C.on[2]*0.9]):null});
  }
}
/* seven-segment numerals behind a smoked window */
const SEG=[0x3f,0x06,0x5b,0x4f,0x66,0x6d,0x7d,0x07,0x7f,0x6f];
function seg7(D,x,y,h,digits,key,rng){
  const L=LAMP[key]||LAMP.red;
  const dw=h*0.56,gap=h*0.20,w=digits*dw+(digits-1)*gap;
  fill(D,rrectP(x-2.2,y-2.2,w+4.4,h+4.4,0.8),{c:"#141518",h:-1.4,met:0.2,gl:0.6});
  for(let d=0;d<digits;d++){
    const ox=x+d*(dw+gap),v=dark()?0:SEG[Math.floor(rng()*10)];
    const t=h*0.115;
    const segs=[[ox+t,y,dw-2*t,t],[ox+dw-t,y+t,t,h*0.5-1.5*t],
                [ox+dw-t,y+h*0.5+0.5*t,t,h*0.5-1.5*t],[ox+t,y+h-t,dw-2*t,t],
                [ox,y+h*0.5+0.5*t,t,h*0.5-1.5*t],[ox,y+t,t,h*0.5-1.5*t],
                [ox+t,y+h*0.5-0.5*t,dw-2*t,t]];
    for(let s=0;s<7;s++){
      const on=(v>>s)&1;
      fill(D,rrectP(segs[s][0],segs[s][1],segs[s][2],segs[s][3],t*0.4),
        {c:on?rgb([L.on[0]*0.55,L.on[1]*0.55,L.on[2]*0.55]):"#241f1e",
         h:-1.0,met:0.02,gl:0.5,emi:on?rgb(L.on):null});
    }
  }
  /* the smoked filter over all of it */
  fill(D,rrectP(x-2.2,y-2.2,w+4.4,h+4.4,0.8),{c:"rgba(24,16,14,0.34)",h:-0.6,met:0,gl:0.9});
}

/* a screen in a bezel. The glass is CURVED, which is the whole tell: the
   phosphor is brightest in the middle and the corners fall away, and the
   scan lines are a real raster rather than a texture laid over it. */
function crt(D,x,y,w,h,phos,rng,H){
  const P2=PHOS[phos]||PHOS.p1;
  fill(D,rrectP(x,y,w,h,2.5),{c:shade(H.trim.c,0.92),h:1.6,met:H.trim.met,gl:1-H.trim.rgh});
  const ix=x+w*0.085,iy=y+h*0.095,iw=w*0.83,ih=h*0.81;
  fill(D,rrectP(ix,iy,iw,ih,Math.min(iw,ih)*0.16),{c:"#0a0c0d",h:-3.2,met:0.04,gl:0.93});
  /* the raster: lines of text that are lines rather than words, because a
     terminal seen across a room is exactly that */
  /* A TERMINAL OF THAT PERIOD HAD TWENTY-FOUR LINES. Dividing the glass by a
     fixed millimetre pitch gives seventy on a big screen, and seventy lines of
     text on a CRT is a later machine — the raster is a property of the
     standard, not of how tall the tube is. */
  const lines=dark()?0:clamp(Math.round(ih/9),6,30);
  for(let i=0;i<lines;i++){
    const ly=iy+ih*0.07+i*(ih*0.86/lines);
    if(rng()<0.18)continue;
    const n=1+Math.floor(rng()*3);
    let lx=ix+iw*0.07;
    for(let s=0;s<n;s++){
      const sw=iw*(0.10+rng()*0.34);
      if(lx+sw>ix+iw*0.93)break;
      const k=0.55+rng()*0.45;
      fill(D,rrectP(lx,ly,sw,ih*0.86/lines*0.46,0.2),
        {c:rgb([P2.on[0]*0.30*k,P2.on[1]*0.30*k,P2.on[2]*0.30*k]),h:-3.1,met:0.02,gl:0.9,
         emi:rgb([P2.on[0]*0.80*k,P2.on[1]*0.80*k,P2.on[2]*0.80*k])});
      lx+=sw+iw*0.045;
    }
  }
  /* the glass over it: a dark wash plus the one broad reflection that says
     the surface is convex */
  fill(D,rrectP(ix,iy,iw,ih,Math.min(iw,ih)*0.16),
    {c:"rgba(14,18,20,0.30)",h:-2.4,met:0.02,gl:0.98});
  fill(D,g=>{g.beginPath();
    g.ellipse(ix+iw*0.34,iy+ih*0.26,iw*0.30,ih*0.17,-0.35,0,TAU);g.closePath();},
    {c:"rgba(214,228,238,0.10)",h:-2.3,met:0.02,gl:0.99});
}
/* two reels behind a window with tape between them. The one silhouette that
   dates a machine on sight, so it is drawn properly: a hub, spokes, the pack
   of tape wound on it at whatever radius it is at, and the span of tape
   running across from one to the other. */
function reel(D,x,y,w,h,rng,H){
  fill(D,rrectP(x,y,w,h,2),{c:shade(H.trim.c,0.86),h:0.8,met:H.trim.met,gl:1-H.trim.rgh});
  const ix=x+2.5,iy=y+2.5,iw=w-5,ih=h-5;
  fill(D,rrectP(ix,iy,iw,ih,1.4),{c:"#16181b",h:-6,met:0.05,gl:0.9});
  const r=Math.min(iw*0.235,ih*0.42);
  const cy=iy+ih*0.5,cxs=[ix+iw*0.265,ix+iw*0.735];
  const packs=[0.52+rng()*0.40,0.92-rng()*0.40];
  for(let s=0;s<2;s++){
    const cx=cxs[s],pr=r*packs[s];
    fill(D,circP(cx,cy,r),{c:"#2a2d31",h:-5.2,met:0.3,gl:0.5});
    /* the tape pack: brown oxide, and its edge is where the tape has got to */
    fill(D,circP(cx,cy,pr),{c:"#4a3524",h:-4.6,met:0.03,gl:0.42});
    fill(D,circP(cx,cy,r*0.34),{c:"#b9bcc0",h:-4.0,met:0.82,gl:0.6});
    for(let i=0;i<3;i++){
      const a2=i/3*TAU+s*0.4;
      stroke(D,lineP(cx+Math.cos(a2)*r*0.34,cy+Math.sin(a2)*r*0.34,
                     cx+Math.cos(a2)*r*0.92,cy+Math.sin(a2)*r*0.92),r*0.17,
        {c:"#8d9195",h:-4.2,met:0.78,gl:0.55});
    }
    fill(D,circP(cx,cy,r*0.13),{c:"#5d6165",h:-3.8,met:0.85,gl:0.62});
  }
  /* the span, and the guide rollers it goes round */
  const ty=cy+Math.min(r*0.9,ih*0.34);
  stroke(D,lineP(cxs[0],ty,cxs[1],ty),0.9,{c:"#3a2a1c",h:-4.2,met:0.02,gl:0.4});
  for(const gx of [ix+iw*0.5]){
    fill(D,circP(gx,ty+1.6,r*0.16),{c:"#9aa0a6",h:-3.9,met:0.85,gl:0.6});
  }
  fill(D,rrectP(ix,iy,iw,ih,1.4),{c:"rgba(200,220,236,0.07)",h:-3.0,met:0,gl:0.97});
}
/* a cartridge slot: a dark letterbox with a lip under it */
function slot(D,x,y,w,h){
  fill(D,rrectP(x,y,w,h,0.6),{c:"#17191c",h:-5,met:0.1,gl:0.5});
  fill(D,rrectP(x,y+h,w,1.1,0.4),{c:"#9a9ea4",h:1.4,met:0.7,gl:0.6});
}
/* a patch jack: a bush, a hole, and the dark of the barrel behind it */
function jack(D,x,y,r){
  fill(D,circP(x,y,r*1.5),{c:"#8e9298",h:0.8,met:0.9,gl:0.66});
  fill(D,circP(x,y,r),{c:"#121315",h:-3,met:0.2,gl:0.5});
}
/* punched ventilation. Louvres are pressed and have a lip that catches the
   light at the top of each slot; a hole field is drilled and does not. */
function louvre(D,x,y,w,h,n){
  const sh=h/n;
  for(let i=0;i<n;i++){
    const sy=y+i*sh+sh*0.22;
    fill(D,rrectP(x,sy,w,sh*0.48,sh*0.2),{c:"#15171a",h:-6,met:0.1,gl:0.4});
    fill(D,rrectP(x,sy-0.55,w,0.7,0.3),{c:"#cdd1d6",h:1.4,met:0.6,gl:0.6});
  }
}
function perf(D,x,y,w,h,pitch,r){
  const nx=Math.max(1,Math.floor(w/pitch)),ny=Math.max(1,Math.floor(h/pitch));
  const ox=x+(w-(nx-1)*pitch)*0.5,oy=y+(h-(ny-1)*pitch)*0.5;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    /* staggered, because a drilled field on a square grid reads as a screen
       door and one on a triangular pitch reads as a machine */
    const sx=ox+i*pitch+((j&1)?pitch*0.5:0);
    if(sx>x+w-r)continue;
    fill(D,circP(sx,oy+j*pitch*0.87,r),{c:"#14161a",h:-5,met:0.1,gl:0.4});
  }
}
/* a grab handle. Everything in a rack has them because everything in a rack
   weighs forty kilos and has to come out. */
function handle(D,x,y,w,h,kind,H){
  if(kind==="none")return;
  if(kind==="cup"){
    fill(D,rrectP(x,y,w,h,1.2),{c:shade(H.F.c,0.74),h:-4,met:H.F.met,gl:1-H.F.rgh});
    fill(D,rrectP(x+1.2,y+1.2,w-2.4,h*0.42,0.8),{c:shade(H.F.c,1.08),h:-1.2,
      met:H.F.met,gl:1-H.F.rgh});
    return;
  }
  const r=Math.min(h*0.5,3.2);
  fill(D,rrectP(x,y+h*0.5-r,w,r*2,r),{c:shade(H.trim.c,1.12),h:14,
    met:Math.max(H.trim.met,0.5),gl:0.62});
  fill(D,rrectP(x+1,y+h*0.5-r*0.5,w-2,r*0.7,r*0.35),{c:shade(H.trim.c,1.45),h:15,
    met:Math.max(H.trim.met,0.5),gl:0.7});
  for(const sx of [x+2.2,x+w-2.2])
    fill(D,circP(sx,y+h*0.5,r*0.95),{c:shade(H.trim.c,0.9),h:4,met:0.7,gl:0.5});
}
/* a rack screw in a hole that exists */
function screw(D,x,y,r){
  fill(D,circP(x,y,r*1.5),{c:"#0f1012",h:-1.6,met:0.2,gl:0.4});
  fill(D,circP(x,y,r),{c:"#b4b8bd",h:1.8,met:0.92,gl:0.66});
  stroke(D,lineP(x-r*0.62,y,x+r*0.62,y),r*0.3,{c:"#5c6064",h:1.1,met:0.9,gl:0.6});
}
/* ENGRAVED LETTERING, from the stroke library, which is what keeps this mode
   on a worker thread — a typeface registered against the document is invisible
   to one. The legends are function words rather than names: a panel of that
   period said what the control did and nothing else. */
function legend(D,text,x,y,cap,o){
  /* y is the TOP of the cap, not the baseline: the stroke box runs y down
     from 0 to its cap height, so a caller placing text in a box wants to
     give the top of it and be done. */
  o=o||{};
  if(!window.ForgeStroke)return 0;
  const GL=ForgeStroke.GLY,ADV=ForgeStroke.ADV,CAP=ForgeStroke.CAP;
  const s=String(text==null?"":text).toUpperCase();
  const u=cap/CAP,track=num(o.track,0.9);
  const w=ForgeStroke.width(s,track)*u;
  let x0=x;
  if(o.align==="center")x0=x-w*0.5;else if(o.align==="right")x0=x-w;
  const lw=Math.max(0.18,cap*0.15);
  const col=o.c||"#1d1f22";
  for(let i=0;i<s.length;i++){
    const gl=GL[s[i]];
    if(!gl)continue;
    const ox=x0+i*(ADV+track)*u;
    for(const pl of gl){
      stroke(D,g=>{g.beginPath();g.moveTo(ox+pl[0][0]*u,y+pl[0][1]*u);
        for(let k2=1;k2<pl.length;k2++)g.lineTo(ox+pl[k2][0]*u,y+pl[k2][1]*u);},
        lw,{c:col,h:num(o.h,-0.35),met:0.04,gl:0.35,emi:o.emi||null});
    }
  }
  return w;
}
const legendW=(t,cap,track)=>window.ForgeStroke
  ? ForgeStroke.width(String(t||"").toUpperCase(),num(track,0.9))*cap/ForgeStroke.CAP : 0;
/* an engraved division line between sections of a panel */
function divide(D,x0,y0,x1,y1){
  stroke(D,lineP(x0,y0,x1,y1),0.55,{c:"#00000033",h:-0.7,met:0.04,gl:0.3});
}

/* the words a panel of this period carried. Function, never a name. */
const WORDS=["main","aux","bus a","bus b","ready","fault","run","halt","seq",
  "xfer","load","sync","mode","gain","level","drive","hold","reset","test",
  "ch a","ch b","ch c","sel","addr","data","clk","int","ext","lock","alarm",
  "power","line","remote","local","write","read","rew","fwd","start","stop",
  "track","unit","phase","trim","range","supply","limit","bias","monitor"];
const TITLES=["control unit","sequencer","processor bay","line driver",
  "mass store","transport","regulator","distribution","interface",
  "timing unit","display unit","logic frame","buffer store","channel unit"];

/* ============================ connectors ============================
   What a lead plugs into, and the reason a cable has anywhere to start. The
   period had two shells and essentially only two: a round multiway with a
   knurled coupling ring for anything that mattered, and a rectangular one
   with a jack screw each side for anything that did not. Both are drawn
   from the back forward — bulkhead, shell, insert, pins — because that is
   the order the light sees them in.

   A port is drawn AND REMEMBERED. The composer returns the list, and the
   router works from it: a cable that starts anywhere but at a connector is
   the thing that makes a drawn rack look drawn. */
function shellR(D,x,y,r){
  fill(D,circP(x,y,r*1.30),{c:"#3f4348",h:0.5,met:0.65,gl:0.42});
  for(let i=0;i<22;i++){                        /* the coupling ring knurl */
    const a2=i/22*TAU;
    stroke(D,lineP(x+Math.cos(a2)*r*1.00,y+Math.sin(a2)*r*1.00,
                   x+Math.cos(a2)*r*1.26,y+Math.sin(a2)*r*1.26),r*0.11,
      {c:"#33373b",h:0.7,met:0.72,gl:0.38});
  }
  fill(D,circP(x,y,r*0.97),{c:"#4e5257",h:1.5,met:0.68,gl:0.5});
  fill(D,circP(x,y,r*0.74),{c:"#121416",h:-1.4,met:0.12,gl:0.6});
  const np=r>2.0?7:3;                           /* pins, if any can be seen */
  for(let i=0;i<np;i++){
    const a2=i/np*TAU+0.4,rr=np>3?r*0.42:r*0.3;
    fill(D,circP(x+Math.cos(a2)*rr,y+Math.sin(a2)*rr,r*0.13),
      {c:"#b9a06a",h:-1.0,met:0.9,gl:0.6});
  }
}
function shellD(D,x,y,w,h){
  fill(D,rrectP(x,y,w,h,0.8),{c:"#43474c",h:0.6,met:0.66,gl:0.44});
  fill(D,rrectP(x+1.5,y+h*0.22,w-3,h*0.56,0.5),{c:"#111315",h:-1.3,met:0.12,gl:0.6});
  for(const sx of [x+0.9,x+w-0.9])
    fill(D,circP(sx,y+h*0.5,0.75),{c:"#a8acb1",h:1.2,met:0.9,gl:0.62});
  const n=Math.max(3,Math.floor((w-4)/1.5));
  for(let i=0;i<n;i++)
    fill(D,circP(lerp(x+2.4,x+w-2.4,n<2?0.5:i/(n-1)),y+h*0.5,0.34),
      {c:"#b9a06a",h:-1.1,met:0.9,gl:0.6});
}
/* add one port to a device's list. `s` is the side the lead leaves from. */
const port=(ps,x,y,s,k)=>{ps.push({x:x,y:y,s:s,k:k||"sig"});};

/* ============================ the panel itself ============================
   A plate, the ears it is bolted through, the screws in the holes those ears
   have, a handle if the maker fits one, and a nameplate where the maker puts
   nameplates. Drawn once for every device, which is most of what makes a
   cabinet of invented machines look like a cabinet of ONE maker's machines. */

/* where the screws go on a panel `uh` units tall, measured down from its top.
   The EIA pattern is symmetric about the middle of a U, so the outer pair
   always land 6.35 mm in from each end however tall the panel is — which is
   the whole reason the pattern is 15.875, 15.875, 12.7 and not thirds. */
function screwYs(uh){
  const h=uh*U-GAP,out=[6.35-GAP*0.5,h-(6.35-GAP*0.5)];
  if(uh>=4)for(let k=2;k<uh;k+=2)out.push(h-((k-1)*U+22.225-GAP*0.5));
  return out;
}
/* the plate, and the box left inside it for the device to use */
function plate(D,x,y,w,uh,H,o){
  o=o||{};
  const h=uh*U-GAP;
  const F=o.F||H.F;
  fill(D,rrectP(x,y,w,h,H.r),{c:F.c,h:0,met:F.met,gl:1-F.rgh});
  /* the two edges that say the plate is a plate: a lit chamfer along the top
     and a dark one along the bottom. Light comes from above in every renderer
     anybody will put this in. */
  stroke(D,lineP(x+H.r,y+0.45,x+w-H.r,y+0.45),0.9,
    {c:shade(F.c,1.16),h:0.5,met:F.met,gl:1-F.rgh});
  stroke(D,lineP(x+H.r,y+h-0.45,x+w-H.r,y+h-0.45),0.9,
    {c:shade(F.c,0.74),h:-0.5,met:F.met,gl:1-F.rgh});
  /* the ears. A mounting flange is a separate pressing and shows a seam. */
  const ear=H.ears?20:13.5;
  if(H.ears){
    for(const ex of [x,x+w-ear]){
      fill(D,rrectP(ex,y,ear,h,H.r),{c:shade(F.c,0.95),h:-0.35,met:F.met,gl:1-F.rgh});
      stroke(D,lineP(ex===x?x+ear:x+w-ear,y+1,ex===x?x+ear:x+w-ear,y+h-1),0.5,
        {c:shade(F.c,0.78),h:-0.7,met:F.met,gl:1-F.rgh});
    }
  }
  for(const sy of screwYs(uh)){
    if(sy<1||sy>h-1)continue;
    screw(D,x+(w-HOLE_DX)*0.5,y+sy,H.screwR);
    screw(D,x+w-(w-HOLE_DX)*0.5,y+sy,H.screwR);
  }
  return {x:x+ear+2.5,y:y+3.0,w:w-2*(ear+2.5),h:h-6.0,h0:h};
}
/* the nameplate, in the one place this maker puts it, and the room it takes */
function nameplate(D,x,y,w,h,H,text){
  const cap=Math.min(4.4,h*0.42);
  if(H.legendAt==="tl"){
    legend(D,text,x,y+0.7,cap,{align:"left"});
    return {top:cap+2.2,bot:0};
  }
  legend(D,text,x+w*0.5,y+h-cap-0.7,cap,{align:"center"});
  return {top:0,bot:cap+2.2};
}
/* a blank. An open U in a cooled cabinet is a short circuit in the airflow,
   so the gaps in a real installation are filled, and a rack whose gaps are
   holes reads as a rack somebody stripped for parts. */
function blankFace(D,x,y,w,uh,H,rng){
  const b=plate(D,x,y,w,uh,H,{});
  if(uh>=2&&rng()<0.5)
    louvre(D,b.x+b.w*0.18,b.y+b.h*0.3,b.w*0.64,b.h*0.4,Math.max(2,Math.round(uh*1.6)));
  return [];
}
/* a vent panel, which goes above whatever runs hot */
function ventFace(D,x,y,w,uh,H,rng){
  const b=plate(D,x,y,w,uh,H,{});
  if(rng()<0.5)
    louvre(D,b.x,b.y+1,b.w,b.h-2,Math.max(2,Math.round(uh*3.2)));
  else
    perf(D,b.x,b.y+1,b.w,b.h-2,5.2,1.7);
  if(uh>=2&&H.div)divide(D,b.x,b.y+b.h*0.5,b.x+b.w,b.y+b.h*0.5);
  return [];
}

/* ============================ the devices, drawn ============================
   One composer per archetype. Each is handed the plate it owns and lays its
   controls out inside the box the plate leaves, in millimetres, and each
   returns the PORTS it offers so that the router has somewhere to run to.

   They are written as layouts rather than as scatters. A regulator bay has a
   meter per rail and a knob under each meter because that is what a regulator
   bay is for; a logic bay is a wall of lamps in groups of four because that
   is how you read a word off one at a glance. Randomness picks the counts and
   the states and never the arrangement — a face whose controls landed where
   the dice said reads as decoration, and decoration is exactly the thing this
   mode is trying not to be. */

const SIDE_OF=(x,x0,w)=>((x-x0)<w*0.5?"l":"r");

/* a legend centred under something, which is where a legend goes */
function sublabel(D,text,cx,yTop,cap){
  legend(D,text,cx,yTop,cap||2.2,{align:"center"});
}

/* --- power distribution: where the cabinet is fed and what it is fed by --- */
function facePower(D,x,y,w,uh,H,rng,title){
  const b=plate(D,x,y,w,uh,H,{}),ps=[];
  const m=nameplate(D,b.x,b.y,b.w,b.h,H,title);
  const cy=b.y+m.top,ch=b.h-m.top-m.bot;
  /* the master switch, under a guard, on the left where the feed comes in */
  const gx=b.x+3,gy=cy+ch*0.5,gh=Math.min(ch*0.68,30);
  fill(D,rrectP(gx-1.5,gy-gh*0.5,16,gh,1.2),{c:shade(H.trim.c,1.05),h:3.5,
    met:Math.max(H.trim.met,0.4),gl:0.5});
  fill(D,rrectP(gx+0.3,gy-gh*0.35,12.4,gh*0.7,0.8),{c:"#1a1c1f",h:-1.2,met:0.3,gl:0.4});
  toggle(D,gx+6.5,gy,2.6,lit(rng,0.75));
  /* the phase lamps and what each phase is doing, in a column because there
     are three phases and they are read down the panel */
  const lx=gx+24;
  const mh=Math.min(13,ch*0.24);
  for(let i=0;i<3;i++){
    const ly=cy+mh*0.5+i*(ch-mh)*0.5;
    lamp(D,lx,ly,2.3,H.lamps[i%H.lamps.length],lit(rng,0.72));
    legend(D,["bus a","bus b","bus c"][i],lx+5,ly-2.2,2.2,{align:"left"});
    meterE(D,lx+28,ly-mh*0.5,58,mh,0.46+rng()*0.34,H);
  }
  /* and the outlets it delivers through. A distribution panel is mostly
     sockets, and they are on a pitch because they were drilled on a jig. */
  const ox0=lx+94,n=Math.max(4,Math.floor((b.x+b.w-6-ox0)/11));
  const pr=4.4,rows2=uh>=3?2:1,per=Math.ceil(n/rows2);
  for(let i=0;i<n;i++){
    const r2=Math.floor(i/per),c2=i%per;
    const sx=ox0+pr*1.4+c2*pr*2.5;
    const sy=cy+ch*(rows2>1?(0.28+r2*0.4):0.42);
    if(sx>b.x+b.w-pr*1.6)continue;
    shellR(D,sx,sy,pr);
    port(ps,sx,sy,SIDE_OF(sx,x,w),"pwr");
    sublabel(D,String(i+1),sx,sy+pr*1.9,1.9);
  }
  if(uh>=3)seg7(D,ox0+6,cy+ch-Math.min(11,ch*0.22)-3,Math.min(11,ch*0.22),3,
    H.lamps[0],rng);
  legend(D,"line",gx-1,gy+gh*0.5+1.2,2.2,{align:"left"});
  if(H.div)divide(D,lx+90,cy+1,lx+90,cy+ch-1);
  return ps;
}

/* --- regulator bay: a meter per rail, a knob under each, and a lot of air --- */
function faceSupply(D,x,y,w,uh,H,rng,title){
  const b=plate(D,x,y,w,uh,H,{}),ps=[];
  const m=nameplate(D,b.x,b.y,b.w,b.h,H,title);
  const cy=b.y+m.top,ch=b.h-m.top-m.bot;
  const rails=uh>=5?3:2;
  /* the left two thirds are instrumentation, the right third is cooling,
     because a linear supply is a heater with a voltmeter on it */
  const iw=b.w*0.66,mr=Math.min(iw/(rails*2.5),ch*0.30);
  for(let i=0;i<rails;i++){
    const cx=b.x+iw*((i+0.5)/rails);
    meterR(D,cx,cy+mr*1.1,mr,0.38+rng()*0.44,H);
    knob(D,cx,cy+ch-H.knobR*1.9,H.knobR*0.82,pick(rng,[3,5,6]),Math.floor(rng()*5));
    sublabel(D,pick(rng,["main","aux","bias","supply","drive"]),cx,cy+ch-2.6,2.1);
    lamp(D,cx+mr*1.0,cy+ch*0.55,1.9,H.lamps[i%H.lamps.length],lit(rng,0.8));
  }
  louvre(D,b.x+iw+6,cy+2,b.w-iw-9,ch-4,Math.max(3,Math.round(uh*2.6)));
  if(H.div)divide(D,b.x+iw+2.5,cy+1,b.x+iw+2.5,cy+ch-1);
  for(let i=0;i<2;i++){
    const sx=b.x+b.w-4.5,sy=cy+ch*(0.26+i*0.3);
    shellR(D,sx,sy,3.4);port(ps,sx,sy,"r","pwr");
  }
  handle(D,b.x+1,cy+ch*0.5-3.5,12,7,H.handle,H);
  handle(D,b.x+b.w-13,cy+ch*0.5-3.5,12,7,H.handle,H);
  return ps;
}

/* --- logic bay: the lamp wall. A word at a glance, in groups of four --- */
function faceLogic(D,x,y,w,uh,H,rng,title){
  const b=plate(D,x,y,w,uh,H,{}),ps=[];
  const m=nameplate(D,b.x,b.y,b.w,b.h,H,title);
  const cy=b.y+m.top+3.4,ch=b.h-m.top-m.bot-3.4;
  const lab=28;                             /* room at the left for row names */
  const gx0=b.x+lab,gw=b.w-lab-2;
  /* THE COLUMN COUNT COMES OFF THE PITCH, not the other way round. A lamp is
     a lamp-sized object — about a centimetre, because that is what a jewel in
     a bezel is — so the wall is as many of them as fit at that size, in groups
     of four. Sixteen columns shrunk to fit a 480 mm panel reads as a grid of
     dots in the middle of nothing, which is the usual way this gets drawn. */
  const groups=4,want=pick(rng,[11,13,16]);
  const cols=Math.max(8,Math.floor(gw/want/groups)*groups);
  const pitch=gw/cols,lr=Math.min(pitch*0.30,3.4);
  const rows=clamp(Math.floor((ch-5)/(pitch*0.98)),1,6);
  const x0=gx0+pitch*0.5;
  /* the column numbers, every fourth, which is the only way a wall of
     identical lamps is readable at all */
  for(let c=0;c<cols;c+=groups)
    sublabel(D,String(c),x0+c*pitch,cy-3.2,1.9);
  const yr=Math.min(pitch*1.08,(ch-3)/Math.max(1,rows));
  for(let r=0;r<rows;r++){
    const ly=cy+2+r*yr+yr*0.5;
    const word=Math.floor(rng()*(1<<16));        /* a register, more or less */
    /* A ROW IS A CARD, and a card is either powered or it is not. The bits of
       the word decide which lamps in a live row are on; whether the row is
       live at all is the installation's business, so a cabinet somebody pulled
       the breaker on shows no word rather than a word in the dark. */
    const live=lit(rng,1);
    for(let c=0;c<cols;c++)
      lamp(D,x0+c*pitch,ly,lr,H.lamps[r%H.lamps.length],live&&((word>>(c%16))&1)===1);
    legend(D,pick(rng,WORDS),b.x+1,ly-1.1,2.2,{align:"left"});
  }
  /* the group rules, down the gaps rather than through the lamps */
  if(H.div)for(let c=groups;c<cols;c+=groups)
    divide(D,x0+(c-0.5)*pitch,cy,x0+(c-0.5)*pitch,cy+2+rows*yr);
  /* and the switches that set what the wall is showing */
  const sw=Math.min(10,Math.floor(cols/2)),sy=cy+2+rows*yr+5.0;
  if(sy<b.y+b.h-4)for(let i=0;i<sw;i++)
    toggle(D,x0+i*pitch*2,sy,2.0,lit(rng,0.5));
  /* a bus connector each side: a logic bay talks to its neighbours */
  for(const sd of ["l","r"]){
    const sx=sd==="l"?b.x+1:b.x+b.w-11;
    shellD(D,sx,b.y+b.h-8.5,10,7);
    port(ps,sx+5,b.y+b.h-5,sd,"sig");
  }
  return ps;
}

/* --- tape transport: the silhouette that dates a machine on sight --- */
function faceStore(D,x,y,w,uh,H,rng,title){
  const b=plate(D,x,y,w,uh,H,{}),ps=[];
  const m=nameplate(D,b.x,b.y,b.w,b.h,H,title);
  const cy=b.y+m.top,ch=b.h-m.top-m.bot;
  const wh=ch*(uh>=8?0.60:0.66);
  reel(D,b.x+2,cy,b.w-4,wh,rng,H);
  const sy=cy+wh+3.5,sh=ch-wh-5;
  /* the transport controls, in transport order, because the order is the
     thing: you cannot put rewind to the right of forward */
  const names=["rew","fwd","start","stop","write"];
  const bw=Math.min(17,(b.w*0.52)/names.length),bh=Math.min(10,sh*0.62);
  for(let i=0;i<names.length;i++){
    const bx=b.x+3+i*(bw+2.4);
    button(D,bx,sy,bw,bh,i===3?"red":H.lamps[(i+1)%H.lamps.length],lit(rng,0.45));
    sublabel(D,names[i],bx+bw*0.5,sy+bh+0.8,2.0);
  }
  /* the footage counter, which is the one readout a transport must have */
  seg7(D,b.x+b.w-58,sy+1,Math.min(10,sh*0.5),4,H.lamps[0],rng);
  const lx=b.x+b.w-76;
  for(let i=0;i<2;i++)lamp(D,lx,sy+3+i*7,2.0,H.lamps[i%H.lamps.length],lit(rng,0.6));
  handle(D,b.x+1,cy+wh*0.5-3.5,11,7,H.handle,H);
  handle(D,b.x+b.w-12,cy+wh*0.5-3.5,11,7,H.handle,H);
  for(let i=0;i<2;i++){
    const sx=i?b.x+b.w-4.5:b.x+4.5,sy2=cy+ch-5;
    shellR(D,sx,sy2,3.2);port(ps,sx,sy2,i?"r":"l","sig");
  }
  return ps;
}

/* --- disc pack drive: a round door, because the pack inside it is round --- */
function faceDisc(D,x,y,w,uh,H,rng,title){
  const b=plate(D,x,y,w,uh,H,{}),ps=[];
  const m=nameplate(D,b.x,b.y,b.w,b.h,H,title);
  const cy=b.y+m.top,ch=b.h-m.top-m.bot;
  const dr=Math.min(ch*0.47,b.w*0.26),dcx=b.x+dr+4,dcy=cy+ch*0.5;
  /* the lid: a thick ring, a smoked window, and a latch you lift */
  fill(D,circP(dcx,dcy,dr),{c:shade(H.F.c,0.92),h:2.2,met:H.F.met,gl:1-H.F.rgh});
  fill(D,circP(dcx,dcy,dr*0.88),{c:shade(H.F.c,1.04),h:3.4,met:H.F.met,gl:1-H.F.rgh});
  fill(D,circP(dcx,dcy,dr*0.70),{c:"#1b1d20",h:1.0,met:0.08,gl:0.9});
  fill(D,circP(dcx,dcy,dr*0.70),{c:"rgba(206,222,236,0.12)",h:3.8,met:0,gl:0.98});
  /* the pack is in there, and what you see of it is the edge of the platters */
  fill(D,circP(dcx,dcy,dr*0.52),{c:"#54575c",h:0.2,met:0.6,gl:0.45});
  fill(D,circP(dcx,dcy,dr*0.16),{c:"#9ba0a6",h:0.6,met:0.85,gl:0.6});
  stroke(D,g=>{g.beginPath();g.arc(dcx,dcy,dr*0.93,-2.5,-0.7);},2.2,
    {c:shade(H.trim.c,1.2),h:5.0,met:Math.max(H.trim.met,0.5),gl:0.6});
  const rx=dcx+dr+6,rw=b.x+b.w-rx-2;
  for(let i=0;i<4;i++){
    const ly=cy+4+i*(ch-8)/3.6;
    lamp(D,rx+2.4,ly,2.1,i===3?"red":H.lamps[i%H.lamps.length],lit(rng,0.55));
    legend(D,pick(rng,["ready","fault","select","write","on line","seek"]),
      rx+7,ly-1.0,2.1,{align:"left"});
  }
  seg7(D,rx+rw*0.62,cy+3,Math.min(11,ch*0.26),1,H.lamps[0],rng);
  button(D,rx+rw*0.58,cy+ch*0.58,Math.min(22,rw*0.4),9,H.lamps[1%H.lamps.length],lit(rng,0.5));
  sublabel(D,"start",rx+rw*0.58+Math.min(22,rw*0.4)*0.5,cy+ch*0.58+10,2.0);
  if(rw>40)louvre(D,rx+rw*0.55,cy+ch-9,rw*0.42,7,2);
  if(H.div)divide(D,rx-3,cy+1,rx-3,cy+ch-1);
  for(let i=0;i<2;i++){
    const sx=b.x+b.w-4.5,sy2=cy+ch*(0.3+i*0.34);
    shellR(D,sx,sy2,3.0);port(ps,sx,sy2,"r","sig");
  }
  return ps;
}

/* --- cartridge loader: slots, and a lamp per slot --- */
function faceCart(D,x,y,w,uh,H,rng,title){
  const b=plate(D,x,y,w,uh,H,{}),ps=[];
  const m=nameplate(D,b.x,b.y,b.w,b.h,H,title);
  const cy=b.y+m.top,ch=b.h-m.top-m.bot;
  const n=pick(rng,[3,4,4,5]);
  const sw=(b.w-12)/n-4,sh=Math.min(ch*0.46,11);
  for(let i=0;i<n;i++){
    const sx=b.x+4+i*(sw+4);
    slot(D,sx,cy+ch*0.5-sh*0.5,sw,sh);
    lamp(D,sx+sw*0.5,cy+2.4,1.9,H.lamps[i%H.lamps.length],lit(rng,0.5));
    sublabel(D,String(i+1),sx+sw*0.5,cy+ch-3.0,2.0);
  }
  const sx=b.x+b.w-5,sy=cy+ch*0.5;
  shellR(D,sx,sy,3.0);port(ps,sx,sy,"r","sig");
  return ps;
}

/* --- operator console: the face somebody actually stood in front of --- */
function faceConso(D,x,y,w,uh,H,rng,title){
  const b=plate(D,x,y,w,uh,H,{}),ps=[];
  const m=nameplate(D,b.x,b.y,b.w,b.h,H,title);
  const cy=b.y+m.top,ch=b.h-m.top-m.bot;
  /* a block of legend caps, in rows, each captioned. The caption is why a
     console is a console and not a lamp wall: every key says what it does. */
  const cols=pick(rng,[6,8,8]),rows=clamp(Math.floor((ch-16)/13),1,4);
  const bw=Math.min((b.w*0.66)/cols-2.6,20),bh=Math.min(9.5,(ch-6)/rows-4);
  const x0=b.x+3;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const bx=x0+c*(bw+2.6),by=cy+2+r*(bh+4.2);
    button(D,bx,by,bw,bh,H.lamps[(r+c)%H.lamps.length],lit(rng,0.4));
    sublabel(D,pick(rng,WORDS),bx+bw*0.5,by+bh+0.7,1.9);
  }
  const rx=x0+cols*(bw+2.6)+4,rw=b.x+b.w-rx-2;
  if(rw>34){
    if(uh>=5)crt(D,rx,cy+1,rw,Math.min(rw*0.78,ch*0.56),H.phos,rng,H);
    else seg7(D,rx+3,cy+3,Math.min(11,ch*0.3),5,H.lamps[0],rng);
    for(let i=0;i<2;i++)
      knob(D,rx+H.knobR*1.9+i*H.knobR*3.6,cy+ch-H.knobR*1.8,H.knobR*0.8,
        pick(rng,[4,6,8]),Math.floor(rng()*6));
  }
  /* and the switches along the bottom, which is where switches go on a
     console because that is where your hands rest */
  const ty=cy+ch-4.5;
  for(let i=0;i<cols&&x0+i*(bw+2.6)+bw*0.5<rx-4;i++)
    toggle(D,x0+i*(bw+2.6)+bw*0.5,ty,2.0,lit(rng,0.5));
  if(H.div)divide(D,rx-2,cy+1,rx-2,cy+ch-1);
  const sx=b.x+b.w-4.5,sy=cy+ch-4.5;
  shellD(D,sx-10,sy-3.5,10,7);port(ps,sx-5,sy,"r","sig");
  return ps;
}

/* --- instrument panel: meters in a row, and nothing else needed --- */
function faceInstr(D,x,y,w,uh,H,rng,title){
  const b=plate(D,x,y,w,uh,H,{}),ps=[];
  const m=nameplate(D,b.x,b.y,b.w,b.h,H,title);
  const cy=b.y+m.top,ch=b.h-m.top-m.bot;
  const n=pick(rng,[2,3,3,4]);
  const mr=Math.min((b.w-16)/(n*2.5),ch*(uh>=3?0.40:0.46));
  for(let i=0;i<n;i++){
    const cx=b.x+6+(b.w-12)*((i+0.5)/n);
    meterR(D,cx,cy+mr*1.15,mr,0.3+rng()*0.55,H);
    sublabel(D,pick(rng,WORDS),cx,cy+mr*2.3+0.6,2.1);
    if(uh>=3)knob(D,cx,cy+ch-H.knobR*1.5,H.knobR*0.78,pick(rng,[3,5,7]),
      Math.floor(rng()*5));
    else lamp(D,cx,cy+ch-3.2,1.9,H.lamps[i%H.lamps.length],lit(rng,0.6));
  }
  if(uh>=3){
    bars(D,b.x+2.5,cy+2,5,ch*0.5,8,rng(),H.lamps[1%H.lamps.length]);
    bars(D,b.x+b.w-7.5,cy+2,5,ch*0.5,8,rng(),H.lamps[1%H.lamps.length]);
  }
  for(let i=0;i<2;i++){
    const sx=i?b.x+b.w-4.5:b.x+4.5,sy=cy+ch-4.0;
    shellR(D,sx,sy,2.8);port(ps,sx,sy,i?"r":"l","sig");
  }
  return ps;
}

/* --- display terminal: a screen, and the two knobs it needs --- */
function faceTerm(D,x,y,w,uh,H,rng,title){
  const b=plate(D,x,y,w,uh,H,{}),ps=[];
  const m=nameplate(D,b.x,b.y,b.w,b.h,H,title);
  const cy=b.y+m.top,ch=b.h-m.top-m.bot;
  const sw=Math.min(b.w*0.76,ch*1.34);
  crt(D,b.x+2,cy+1,sw,ch-2,H.phos,rng,H);
  const rx=b.x+2+sw+4,rw=b.x+b.w-rx-2;
  if(rw>16){
    for(let i=0;i<2;i++){
      knob(D,rx+rw*0.5,cy+ch*(0.18+i*0.26),Math.min(H.knobR,rw*0.4),
        pick(rng,[0,0,0]),0);
      sublabel(D,i?"focus":"bright",rx+rw*0.5,cy+ch*(0.18+i*0.26)+Math.min(H.knobR,rw*0.4)*1.7,1.9);
    }
    for(let i=0;i<2;i++)
      lamp(D,rx+rw*0.5,cy+ch*(0.68+i*0.1),2.0,H.lamps[i%H.lamps.length],lit(rng,0.7));
    toggle(D,rx+rw*0.5,cy+ch-5,2.1,lit(rng,0.8));
  }
  const sx=b.x+b.w-4.5,sy=cy+ch-4.0;
  shellR(D,sx,sy,3.0);port(ps,sx,sy,"r","sig");
  return ps;
}

/* --- patch field: the one panel that EXISTS to have cables in it --- */
function facePatch(D,x,y,w,uh,H,rng,title){
  /* the one panel this maker finishes in the trim colour, because a field of
     holes in a pale panel is a field of nothing */
  const b=plate(D,x,y,w,uh,H,{F:H.trim}),ps=[];
  const m=nameplate(D,b.x,b.y,b.w,b.h,H,title);
  const num=uh>=2?2.0:0;                      /* room for the hole numbers */
  const top=b.y+m.top+num,avail=b.h-m.top-m.bot-num;
  const cols=pick(rng,[24,28,32]),rows=clamp(Math.round(uh*2)-(uh>1?1:0),1,6);
  const pitch=(b.w-6)/cols,jr=Math.min(pitch*0.3,1.8);
  const x0=b.x+3+pitch*0.5;
  const yr=avail/rows;
  if(num)for(let c=0;c<cols;c+=4)
    legend(D,String(c+1),x0+c*pitch,top-num+0.2,1.8,{align:"center",c:"#cfcabb"});
  for(let r=0;r<rows;r++){
    const jy=top+r*yr+yr*0.5;
    for(let c=0;c<cols;c++){
      const jx=x0+c*pitch;
      jack(D,jx,jy,jr);
      /* one hole in five is offered to the router. A patch field with a lead
         in every hole is a patch field nobody can get at, and the cords this
         panel hangs across its own face come out of the same list. */
      if((c+r*2)%5===0)port(ps,jx,jy,SIDE_OF(jx,x,w),"sig");
    }
    if(H.div&&r<rows-1)divide(D,b.x+2,top+(r+1)*yr,b.x+b.w-2,top+(r+1)*yr);
  }
  return ps;
}

/* --- line interface: a shell per circuit, with a lamp to say it is up --- */
function faceLine(D,x,y,w,uh,H,rng,title){
  const b=plate(D,x,y,w,uh,H,{}),ps=[];
  const m=nameplate(D,b.x,b.y,b.w,b.h,H,title);
  const cy0=b.y+m.top,ch=b.h-m.top-m.bot;
  const n=pick(rng,[6,8,8,10,12]);
  const pitch=(b.w-10)/n,sr=Math.min(pitch*0.30,4.6,ch*0.30);
  const x0=b.x+5+pitch*0.5;
  const cy=cy0+ch*0.56;
  for(let i=0;i<n;i++){
    const sx=x0+i*pitch;
    lamp(D,sx,cy0+ch*0.17,Math.min(1.9,sr*0.5),
      H.lamps[i%H.lamps.length],lit(rng,0.62));
    shellR(D,sx,cy,sr);
    if(i%2===0)port(ps,sx,cy,SIDE_OF(sx,x,w),"sig");
    if(ch>18)sublabel(D,String(i+1),sx,cy0+ch-2.4,1.9);
  }
  return ps;
}

/* --- timing standard: a number, and the knob that sets it --- */
function faceTiming(D,x,y,w,uh,H,rng,title){
  const b=plate(D,x,y,w,uh,H,{}),ps=[];
  const m=nameplate(D,b.x,b.y,b.w,b.h,H,title);
  const cy=b.y+m.top,ch=b.h-m.top-m.bot;
  seg7(D,b.x+b.w*0.30,cy+1,Math.min(13,ch*0.62),6,H.lamps[0],rng);
  for(let i=0;i<2;i++)
    lamp(D,b.x+8+i*7,cy+ch*0.5,2.0,H.lamps[i%H.lamps.length],lit(rng,0.8));
  knob(D,b.x+b.w-18,cy+ch*0.5,Math.min(H.knobR*0.8,ch*0.4),pick(rng,[4,6]),
    Math.floor(rng()*4));
  bars(D,b.x+b.w-34,cy+2,4.5,ch-5,6,rng(),H.lamps[1%H.lamps.length]);
  for(let i=0;i<2;i++){
    const sx=b.x+b.w-5,sy=cy+ch*(0.3+i*0.42);
    shellR(D,sx,sy,2.6);port(ps,sx,sy,"r","sig");
  }
  return ps;
}

const FACE={power:facePower,supply:faceSupply,logic:faceLogic,store:faceStore,
  disc:faceDisc,cart:faceCart,conso:faceConso,instr:faceInstr,term:faceTerm,
  patch:facePatch,line:faceLine,timing:faceTiming};

/* ============================ filling the cabinet ============================
   A rack is not a shuffled deck, and the single quickest way to make one look
   wrong is to stack its devices in a random order. Weight belongs at the
   bottom, where the supply comes in and where the thing will not tip over.
   The console goes at standing height, because somebody has to use it.
   Transports go where they can be reached. Patch and line panels go at the
   top, where the cables come in from overhead. A vent panel goes above
   whatever runs hot, and the gaps are blanked, because an open U in a cooled
   cabinet is a short circuit in the airflow.

   So this fills ZONE BY ZONE, bottom first, exactly the way the circuit board
   places its parts: the thing with the strongest reason to be somewhere goes
   there first, and whatever is left over takes what is left over. */

/* the band of the cabinet each `want` belongs in, as a fraction of its
   height measured from the FLOOR */
const ZONE=[[0.00,0.22],[0.10,0.50],[0.38,0.80],[0.68,1.00],[0.00,1.00]];
/* and how many of one archetype a sane installation has in one cabinet */
const CAP_OF={power:1,supply:2,conso:1,term:2,disc:3,store:3};

/* WHAT SORT OF INSTALLATION IT IS. The same twelve archetypes in different
   proportions, which is how two machine rooms of the period differed: one was
   mostly logic and tape, the next was mostly somebody's desk, the third was
   a wall of patch and line. Multipliers on the archetype weights rather than
   a separate device list, so nothing can be reached by one mix and not the
   others — the rack simply leans. */
const MIX={
  balanced:{},
  compute :{logic:3.5,store:2.8,disc:2.4,supply:1.6,
            conso:0.35,instr:0.3,term:0.4,patch:0.4,line:0.4,timing:0.5},
  control :{conso:3.2,instr:3.0,term:2.6,timing:1.8,
            logic:0.5,store:0.35,disc:0.3,patch:0.5,line:0.6},
  comms   :{patch:4.5,line:4.0,timing:3.0,
            logic:0.35,store:0.15,disc:0.15,supply:0.6,conso:0.3,instr:0.5,
            term:0.4,cart:0.4}
};
const MIX_KEYS=Object.keys(MIX);
const mixOf=P=>MIX[str(P.mix,"balanced")]||MIX.balanced;
/* OUT OF ZONE, BUT NOT OUT OF THE QUESTION. A device may be placed one band
   away from where it belongs, at a fifth of its weight — which is what lets a
   mix lean the whole cabinet rather than only the one band its favourites live
   in. Patch fields are a zone-3 thing, so without this a comms room and a
   machine room would differ in nothing but the four units at the top. */
const OUT_OF_ZONE=0.22;
/* AND IT IS NOT SYMMETRIC. A heavy thing settles LOWER than it wants readily —
   everybody has a spare transport on the floor — and climbs only reluctantly,
   the more so the bigger it is: nobody puts forty kilos of tape deck above
   head height, and a rack that did would be the one thing in the picture an
   engineer would point at. */
function zoneK(d,z){
  if(z===undefined||d.want===z||d.want===4)return 1;
  const dz=d.want-z;
  return dz>0?OUT_OF_ZONE*2.2:OUT_OF_ZONE/(1+0.35*(d.u[1]-1));
}
function weighted(rng,list,mx,z){
  const wof=d=>d.w*(mx&&mx[d.id]!==undefined?mx[d.id]:1)*zoneK(d,z);
  let t=0;for(const d of list)t+=wof(d);
  if(t<=0)return list[Math.floor(rng()*list.length)];
  let r=rng()*t;
  for(const d of list){r-=wof(d);if(r<=0)return d;}
  return list[list.length-1];
}
/* the lowest free run of `uh` units inside [lo,hi), or -1. `up` biases to the
   floor, which is what the bottom zone wants and the others do not. */
function findRun(slot,lo,hi,uh,rng,up){
  const runs=[];
  for(let u=lo;u+uh<=hi;u++){
    let ok=true;
    for(let k=0;k<uh;k++)if(slot[u+k]){ok=false;break;}
    if(ok)runs.push(u);
  }
  if(!runs.length)return -1;
  if(up)return runs[0];
  return runs[Math.floor(rng()*runs.length)];
}

function layout(P){
  const rng=mulberry32(hseed(31,17,P.seed|0));
  const bays=clamp(P.bays|0,1,4);
  const rU=clamp(P.rackU|0,8,45);
  const want=clamp(num(P.fill,0.86),0.2,1);
  const vents=clamp(num(P.vents,0.7),0,1);
  const mx=mixOf(P);
  const items=[];                                /* every panel in the place */
  const caps=[];                                 /* and what each bay is called */
  for(let bb=0;bb<bays;bb++){
    const slot=new Array(rU).fill(null);
    const got={};
    const put=(u0,uh,rec)=>{
      for(let k=0;k<uh;k++)slot[u0+k]=rec;
      rec.bay=bb;rec.u0=u0;rec.uh=uh;items.push(rec);
    };
    for(const z of [0,1,2,3]){
      const lo=Math.floor(ZONE[z][0]*rU),hi=Math.max(lo+1,Math.ceil(ZONE[z][1]*rU));
      const band=hi-lo;
      let guard=120,miss=0;
      while(guard-->0){
        let used=0;for(let u=lo;u<hi;u++)if(slot[u])used++;
        if(used>=band*want)break;
        const pool=DEV.filter(d=>(Math.abs(d.want-z)<=1||d.want===4)&&
          (got[d.id]||0)<(CAP_OF[d.id]===undefined?3:CAP_OF[d.id]));
        if(!pool.length)break;
        const d=weighted(rng,pool,mx,z);
        /* ask for the height the dice want and take the TALLEST that still
           fits, coming down a unit at a time to the shortest this device is
           built at. A device that will not fit is this device's problem and
           not the band's: the next pick gets a go rather than the whole zone
           giving up, which is what left half a cabinet blank whenever the
           weights happened to favour something six units tall. */
        const tall=d.u[0]+Math.floor(rng()*(d.u[1]-d.u[0]+1));
        let u0=-1,use=0;
        for(let t=tall;t>=d.u[0];t--){
          const at=findRun(slot,lo,hi,t,rng,z===0);
          if(at>=0){u0=at;use=t;break;}
        }
        if(u0<0){if(++miss>14)break;continue;}
        miss=0;
        put(u0,use,{kind:"dev",id:d.id,heat:d.heat,
          title:rng()<0.45?d.name+" "+(1+Math.floor(rng()*9)):d.name,
          seed:hseed(bb*41+u0*7+3,19,P.seed|0)});
        got[d.id]=(got[d.id]||0)+1;
      }
    }
    /* a vent panel above whatever runs hot — which is a rule about airflow,
       so it is applied after placement rather than hoped for during it */
    for(const it of items.slice()){
      if(it.bay!==bb||it.kind!=="dev")continue;
      const above=it.u0+it.uh;
      if(above>=rU||slot[above])continue;
      if(rng()>it.heat*vents)continue;
      put(above,1,{kind:"vent",id:"vent",title:"",
        seed:hseed(bb*53+above*11+5,23,P.seed|0)});
    }
    /* and the gaps are blanked, in whatever run lengths the gaps are */
    for(let u=0;u<rU;u++){
      if(slot[u])continue;
      let n=0;while(u+n<rU&&!slot[u+n])n++;
      while(n>0){
        const h=Math.min(n,pick(rng,[1,1,2,2,3]));
        put(u,h,{kind:"blank",id:"blank",title:"",
          seed:hseed(bb*67+u*13+7,29,P.seed|0)});
        u+=h;n-=h;
      }
      u--;
    }
    caps.push(pick(rng,TITLES)+(bays>1?" "+String.fromCharCode(65+bb):""));
  }
  return {bays:bays,rU:rU,items:items,caps:caps};
}

/* ============================ the cabinet shell ============================
   A frame, a side member each side with room in it for cables to run down,
   a cap with a nameplate and a fan grille, and a plinth, because a cabinet
   with no plinth is floating. */
const SIDE=30, PLINTH=96, CAP=48;
const CABW=PANEL_W+2*SIDE;
/* AIR ROUND THE CABINET, because the piece is a cut-out and a cut-out whose
   silhouette is its own bounding box is not one. The margin is what the cap's
   lip overhangs into, what the plinth steps back from, and what the leads that
   leave the installation run through on their way off the edge. */
const MARGIN=28;

function cabinet(D,x,y,rU,H,rng,capText){
  const h=rU*U,bot=y+h;
  /* the side members, which are structure rather than panel and are finished
     dark whatever the panels are — that is how a cabinet of that period was
     built, and it is what makes the stack of panels read as being IN
     something rather than merely stacked. */
  const SF=H.trim;
  for(const sx of [x,x+CABW-SIDE]){
    fill(D,rrectP(sx,y-CAP,SIDE,h+CAP+PLINTH,0),
      {c:shade(SF.c,0.9),h:-1.0,met:SF.met,gl:1-SF.rgh});
    stroke(D,lineP(sx+SIDE*(sx===x?0.82:0.18),y-CAP+2,
                   sx+SIDE*(sx===x?0.82:0.18),bot+PLINTH-2),1.1,
      {c:shade(SF.c,1.18),h:-0.4,met:SF.met,gl:1-SF.rgh});
  }
  /* the cap: a lip, a nameplate, and a fan tray, because this lot ran hot */
  fill(D,rrectP(x,y-CAP,CABW,CAP,0),{c:shade(SF.c,0.96),h:-0.6,met:SF.met,gl:1-SF.rgh});
  /* the capping plate overhangs, which is how a cabinet of that period was
     finished and is most of what stops the silhouette being a rectangle */
  fill(D,rrectP(x-5,y-CAP-4,CABW+10,9.5,0.8),
    {c:shade(SF.c,1.22),h:2.2,met:SF.met,gl:1-SF.rgh});
  perf(D,x+SIDE+8,y-CAP+10,120,CAP-18,5.4,1.8);
  legend(D,capText,x+CABW*0.5,y-CAP+13,6.2,{align:"center",track:1.4,c:"#e6e2d6",h:0.4});
  /* the plinth: a kick plate STEPPED BACK from the body, so the cabinet reads
     as standing on something rather than as a box reaching the floor */
  const pin=8;
  fill(D,rrectP(x+pin,bot,CABW-2*pin,PLINTH,0),
    {c:shade(SF.c,0.80),h:-2.2,met:SF.met,gl:1-SF.rgh});
  fill(D,rrectP(x+SIDE,bot+6,CABW-2*SIDE,PLINTH-14,0),
    {c:shade(SF.c,0.62),h:-6.0,met:SF.met,gl:1-SF.rgh});
  louvre(D,x+SIDE+14,bot+12,CABW-2*SIDE-28,PLINTH-26,3);
  /* and the feet it stands on */
  for(const fx of [x+SIDE*0.8,x+CABW-SIDE*0.8])
    fill(D,rrectP(fx-7,bot+PLINTH-3,14,9,1.5),
      {c:"#1a1c1f",h:-1.4,met:0.4,gl:0.35});
}

/* ============================ cables ============================
   They are drawn LAST and they are drawn OVER the faces, because that is
   where they are: in front of the machine, not behind it. A lead leaves its
   connector, sags, turns into the side member, runs down it with its
   neighbours under a tie, and comes back out at the port it is going to.

   Nobody pulls a cable tight. The sag at each end is the whole difference
   between a cable and a wiring diagram. */
const JACKET=[
  {c:"#14161a",hi:1.50,name:"black"},
  {c:"#3a3e44",hi:1.34,name:"grey"},
  {c:"#4a3f2a",hi:1.36,name:"tan"},
  {c:"#5b2420",hi:1.40,name:"red"},
  {c:"#1f3352",hi:1.46,name:"blue"},
  {c:"#2c4432",hi:1.42,name:"green"},
  {c:"#55565a",hi:1.30,name:"silver braid"}
];
/* a polyline with its corners rounded. A cable does not turn a corner in
   zero radius, and the radius it does turn in is a property of the cable. */
const roundP=(pts,r)=>g=>{
  g.beginPath();
  if(pts.length<2)return;
  g.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length-1;i++){
    const p0=pts[i-1],p1=pts[i],p2=pts[i+1];
    const d1=Math.max(1e-6,Math.hypot(p1.x-p0.x,p1.y-p0.y));
    const d2=Math.max(1e-6,Math.hypot(p2.x-p1.x,p2.y-p1.y));
    const r1=Math.min(r,d1*0.48),r2=Math.min(r,d2*0.48);
    g.lineTo(p1.x+(p0.x-p1.x)/d1*r1,p1.y+(p0.y-p1.y)/d1*r1);
    g.quadraticCurveTo(p1.x,p1.y,p1.x+(p2.x-p1.x)/d2*r2,p1.y+(p2.y-p1.y)/d2*r2);
  }
  g.lineTo(pts[pts.length-1].x,pts[pts.length-1].y);
};
/* THE CABLE IS ROUND, and the only place that can be said is the height
   channel. Three passes of narrowing width at rising height make a stepped
   dome, and the blur the normals are taken through turns the steps into the
   section of a cable. The albedo darkens at the edges for the same reason. */
function cable(D,pts,w,J,h){
  const r=w*2.4;
  for(const k of [1.0,0.66,0.34]){
    stroke(D,roundP(pts,r),w*k,
      {c:k>0.9?shade(J.c,0.74):(k>0.5?J.c:shade(J.c,J.hi)),
       h:h+(1-k)*w*0.52,met:0.05,gl:0.52+(1-k)*0.18});
  }
}
/* A CORD HANGS IN A CURVE. Three points and a rounded corner give a V with
   its point filed off, which is what a cable does if you hold it at both ends
   and it is made of steel. Seven points on a parabola, rounded, is a drape. */
function cordPts(a,b,drop){
  const out=[];
  for(let i=0;i<=6;i++){
    const t=i/6;
    out.push({x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t)+4*t*(1-t)*drop});
  }
  return out;
}
/* a tie across a bundle. A rack whose cables are not tied is a rack that was
   wired in a hurry, and they all were, but somebody came back later. */
function tie(D,x,y,w,h){
  fill(D,rrectP(x-w*0.5,y-1.3,w,2.6,0.6),{c:"#cfd2d6",h:h+1.4,met:0.1,gl:0.6});
  fill(D,rrectP(x-w*0.5+0.6,y-0.5,w-1.2,1.0,0.3),{c:"#8b8f94",h:h+1.6,met:0.1,gl:0.55});
}
/* the ferrule near each end, which is how anybody ever found the far end */
function ferrule(D,p,q,h,w){
  const d=Math.max(1e-6,Math.hypot(q.x-p.x,q.y-p.y));
  const t=Math.min(0.5,14/d);
  const cx=lerp(p.x,q.x,t),cy=lerp(p.y,q.y,t);
  const horiz=Math.abs(q.x-p.x)>Math.abs(q.y-p.y);
  const a2=Math.max(3.4,w*1.15),b2=Math.max(5.2,w*1.9);
  fill(D,horiz?rrectP(cx-b2*0.5,cy-a2*0.5,b2,a2,0.6)
              :rrectP(cx-a2*0.5,cy-b2*0.5,a2,b2,0.6),
    {c:"#ddd9cc",h:h+w*0.3,met:0.04,gl:0.5});
}

/* ============================ the routing ============================
   Which port goes to which, and down which side. Two different kinds of
   cabling, because a rack has two:

     patch cords   between two jacks of the SAME field, hanging in a
                   catenary across its own face. The most recognisable
                   cabling there is, and the only cabling that is allowed
                   to cross a panel, because that is what the panel is for.
     trunks        between two devices, out of the port, into the side
                   member, down it with its neighbours, and back out at the
                   far end. Power to power, signal to signal: a mains lead
                   does not go into a data port.

   Lanes are assigned in order, so cables that leave at the same side end up
   beside each other and form a bundle rather than a tangle — and then a tie
   goes across the bundle, which is the thing that says somebody came back
   and made it tidy afterwards. */
const LANE_N=4, LANE_X0=10.0, LANE_DX=5.8;

function wireUp(D,P,geo,ports,rng){
  const amt=clamp(num(P.cables,0.72),0,1);
  const exits=clamp(num(P.exits,0.4),0,1);
  const laneUse=[];                              /* [bay][side][lane] extents */
  const got={cords:0,trunks:0,exits:0};
  const laneX=(bay,side,i)=>geo.ox+bay*CABW+(side==="l"
    ? LANE_X0+i*LANE_DX : CABW-LANE_X0-i*LANE_DX);
  const mark=(bay,side,i,y0,y1)=>{
    const k=bay+"/"+side+"/"+i;
    const e=laneUse[k]||(laneUse[k]={bay:bay,side:side,i:i,lo:1e9,hi:-1e9,n:0});
    e.lo=Math.min(e.lo,Math.min(y0,y1));e.hi=Math.max(e.hi,Math.max(y0,y1));e.n++;
  };
  const sagOf=d=>clamp(Math.abs(d)*0.17,3.5,26);
  /* THE LANE COUNTER IS PER CABINET AND PER SIDE. One counter for the whole
     picture puts every fourth cable of the whole installation in the same
     lane of the same side member, so a busy cabinet gets four stacks of six
     cables lying exactly on top of each other and reads as a grey smear
     instead of a bundle. Each side of each cabinet fills its own lanes. */
  const seen={};
  const nextLane=(bay,side)=>{
    const k=bay+"/"+side;
    return ((seen[k]=(seen[k]||0)+1)-1)%LANE_N;
  };

  /* ---- patch cords ---- */
  for(const it of geo.items){
    if(it.id!=="patch"||!it.ports||it.ports.length<4)continue;
    /* ORDERED, then paired with a neighbour a few holes along. A cord does go
       a long way across a field sometimes, but a field whose every cord is a
       random pair is a field with a hundred leads crossing in the middle, and
       that is not what a patch bay looks like — it looks like a lot of short
       hops and a few long ones. */
    const pool=it.ports.slice().sort((p,q)=>(p.y-q.y)||(p.x-q.x));
    const n=Math.max(1,Math.round(pool.length*0.42*amt));
    for(let i=0;i+1<pool.length&&i<n*2;i+=2){
      const reach=1+Math.floor(Math.pow(rng(),2.2)*Math.min(9,pool.length-i-1));
      const j=Math.min(pool.length-1,i+reach);
      if(j!==i+1){const t=pool[i+1];pool[i+1]=pool[j];pool[j]=t;}
      const a=pool[i],b=pool[i+1];
      a.taken=b.taken=true;
      const d=Math.hypot(b.x-a.x,b.y-a.y);
      const drop=clamp(d*0.34,5,26);
      const J=JACKET[Math.floor(rng()*JACKET.length)];
      cable(D,cordPts(a,b,drop),3.0+rng()*0.9,J,4.6+rng()*0.8);
      got.cords++;
    }
  }

  /* ---- trunks ---- */
  const free=shuffled(rng,ports.filter(p=>!p.taken));
  const target=Math.round(lerp(3,free.length*0.44,amt));
  /* where a cable crossing from one cabinet to the next runs: inside the cap,
     under its lip. Measured from the artwork origin rather than from zero —
     the margin round the piece is above that, and a lead routed through it
     would be hanging in the air outside the installation — and low in the cap
     rather than through the middle of it, because the middle of it is where
     the cabinet's name is. */
  const capY=geo.oy+CAP*0.78;
  for(let n=0;n<target&&free.length;n++){
    const a=free.pop();
    if(!a||a.taken)continue;
    /* THE PARTNER IS CHOSEN, not taken off the top of the pile. A port wants
       one of its own kind, on another device, in this bay or next door, on the
       SAME SIDE of the cabinet — and far enough up or down that the lane has
       somewhere to go. Two ports on the same row routed through a side lane
       produce a shallow V slung right across the faces between them, which is
       the single ugliest thing this router can draw, so the distance is scored
       rather than hoped for. */
    let bi=-1,bs=-1e9;
    for(let i=free.length-1;i>=0;i--){
      const c=free[i];
      if(c.taken||c.k!==a.k||c.item===a.item)continue;
      const db=Math.abs(c.bay-a.bay);
      if(db>1)continue;
      const dy=Math.abs(c.y-a.y);
      let sc=-db*140+(c.s===a.s?90:0)+(dy>40?70:-180)-dy*0.07;
      if(sc>bs){bs=sc;bi=i;}
    }
    const wantExit=rng()<exits*0.45;
    const w=(a.k==="pwr"?6.0:4.0)+rng()*1.6;
    const J=a.k==="pwr"?JACKET[Math.floor(rng()*3)]
                       :JACKET[Math.floor(rng()*JACKET.length)];
    const side=a.s,li=nextLane(a.bay,side);
    /* and a hair of jitter on top, because two cables in the same lane do not
       lie in the same plane — one of them is in front */
    const lx=laneX(a.bay,side,li)+(rng()-0.5)*3.0;
    const hh=4.8+li*1.5+rng()*0.6;
    a.taken=true;
    if(bi<0||wantExit){
      /* it leaves the picture. Half the leads in a real installation go to
         something that is not in the photograph, and a rack whose every
         cable terminates inside the frame is a rack somebody drew. */
      const down=a.k==="pwr"&&rng()<0.7;
      const ey=down?geo.Hmm+12:-12;
      cable(D,[{x:a.x,y:a.y},
               {x:lerp(a.x,lx,0.55),y:a.y+sagOf(lx-a.x)},
               {x:lx,y:a.y},{x:lx,y:ey}],w,J,hh);
      ferrule(D,{x:a.x,y:a.y},{x:lx,y:a.y},hh,w);
      mark(a.bay,side,li,Math.min(a.y,ey),Math.max(a.y,ey));
      got.exits++;continue;
    }
    const b=free[bi];b.taken=true;free.splice(bi,1);
    if(b.bay===a.bay&&Math.abs(b.y-a.y)<34){
      /* NEARLY THE SAME HEIGHT GETS A CORD, whatever the distance. The lane
         route needs vertical travel to be a lane route at all; without it the
         lead goes out to the side member and straight back, which draws as a
         shallow V across every face between the two ports. A long cord looped
         between two panels is what that actually looks like on a rack. */
      const d=Math.hypot(b.x-a.x,b.y-a.y);
      cable(D,cordPts(a,b,clamp(d*0.26,5,30)),w,J,hh);
      got.trunks++;continue;
    }
    const sb=b.bay===a.bay?side:(b.bay>a.bay?"l":"r");
    const lb=b.bay===a.bay?lx:laneX(b.bay,sb,nextLane(b.bay,sb));
    const pts=[{x:a.x,y:a.y},{x:lerp(a.x,lx,0.55),y:a.y+sagOf(lx-a.x)},
               {x:lx,y:a.y}];
    if(b.bay!==a.bay){
      pts.push({x:lx,y:capY},{x:lb,y:capY});
      mark(a.bay,side,li,Math.min(a.y,capY),Math.max(a.y,capY));
      mark(b.bay,sb,li,Math.min(b.y,capY),Math.max(b.y,capY));
    }else{
      mark(a.bay,side,li,a.y,b.y);
    }
    pts.push({x:lb,y:b.y},{x:lerp(b.x,lb,0.55),y:b.y+sagOf(lb-b.x)},
             {x:b.x,y:b.y});
    cable(D,pts,w,J,hh);
    ferrule(D,{x:a.x,y:a.y},{x:lx,y:a.y},hh,w);
    ferrule(D,{x:b.x,y:b.y},{x:lb,y:b.y},hh,w);
    got.trunks++;
  }

  /* ---- and the ties, once the bundles exist to tie ---- */
  for(const k in laneUse){
    const e=laneUse[k];
    if(e.hi-e.lo<60)continue;
    const bw=LANE_DX*Math.min(LANE_N,Math.max(1,e.n))+2.5;
    const cx=laneX(e.bay,e.side,0)+(e.side==="l"?bw*0.32:-bw*0.32);
    const step=lerp(150,88,amt);
    for(let y=e.lo+step*0.5;y<e.hi;y+=step)
      tie(D,cx,y,bw,4.8+LANE_N*1.5);
  }
  return got;
}

/* ============================ the whole picture ============================ */
function compose(cvA,cvP,cvE,P,geo,kx,ky){
  const H=geo.H;
  LITF=clamp(num(P.lit,1),0,1);
  const D=painter(cvA,cvP,cvE,kx,ky,H);
  const ports=[];
  for(let bb=0;bb<geo.bays;bb++){
    const bx=geo.ox+bb*CABW;
    const rng=mulberry32(hseed(bb*97+11,37,P.seed|0));
    if(geo.piece==="rack")cabinet(D,bx,geo.oy+CAP,geo.rU,H,rng,geo.caps[bb]);
  }
  for(const it of geo.items){
    const bx=geo.ox+it.bay*CABW+(geo.piece==="rack"?SIDE:0);
    const py=geo.oy+(geo.piece==="rack"
      ? CAP+(geo.rU-it.u0-it.uh)*U+GAP*0.5
      : 0);
    const rng=mulberry32(it.seed);
    let ps=[];
    if(it.kind==="vent")ps=ventFace(D,bx,py,PANEL_W,it.uh,H,rng);
    else if(it.kind==="blank")ps=blankFace(D,bx,py,PANEL_W,it.uh,H,rng);
    else ps=(FACE[it.id]||blankFace)(D,bx,py,PANEL_W,it.uh,H,rng,it.title);
    for(const p of ps){p.bay=it.bay;p.item=it;}
    it.ports=ps;
    for(const p of ps)ports.push(p);
  }
  const rng=mulberry32(hseed(5,101,P.seed|0));
  /* A LOOSE PANEL HAS NOTHING TO CABLE TO. Its ports are drawn, because a
     device has ports, but a lead out of one would leave the decal and stop in
     mid-air — so the piece decides this rather than the control, and the
     control is simply not shown. Deriving it the other way round sets the
     switch off and leaves it off when the piece changes back. */
  const wires=(bool(P.wires,true)&&geo.piece!=="panel")
    ?wireUp(D,P,geo,ports,rng):{cords:0,trunks:0,exits:0};
  D.done();
  return {ports:ports.length,wires:wires};
}

/* ============================ geometry ============================
   How big the artwork is in millimetres, and therefore how many texels of it
   there are. Everything above is drawn in millimetres and nothing in it knows
   what the resolution is, which is the only way a 482.6 mm panel comes out
   482.6 mm wide at every size on the ladder. */
function geomOf(P,sizeOver){
  const piece=str(P.piece,"rack")==="panel"?"panel":"rack";
  const H=houseOf(P);
  let items,bays,rU,caps,Wmm,Hmm,ox,oy,askU=0,gotU=0,dev=null;
  if(piece==="panel"){
    const rng=mulberry32(hseed(43,61,P.seed|0));
    const id=str(P.dev,"auto");
    const d=(id==="auto"||!DEV_BY[id])?weighted(rng,DEV,mixOf(P)):DEV_BY[id];
    dev=d;
    askU=clamp(P.panelU|0,0,9);
    gotU=askU?clamp(askU,d.u[0],d.u[1])
             :d.u[0]+Math.floor(rng()*(d.u[1]-d.u[0]+1));
    items=[{kind:"dev",id:d.id,heat:d.heat,bay:0,u0:0,uh:gotU,
      title:rng()<0.45?d.name+" "+(1+Math.floor(rng()*9)):d.name,
      seed:hseed(7,19,P.seed|0)}];
    bays=1;rU=gotU;caps=[""];
    /* 2 mm of nothing round a loose panel, so its alpha edge is not sitting
       on the texel boundary where a mip will chew it */
    ox=2;oy=2;Wmm=PANEL_W+4;Hmm=gotU*U-GAP+4;
  }else{
    const L=layout(P);
    items=L.items;bays=L.bays;rU=L.rU;caps=L.caps;
    ox=MARGIN;oy=MARGIN;
    Wmm=bays*CABW+2*MARGIN;Hmm=CAP+rU*U+PLINTH+2*MARGIN+9;
  }
  const S=Math.max(64,(sizeOver|0)||(P.size|0));
  const long=Math.max(Wmm,Hmm);
  let TW=Math.max(32,Math.round(Wmm*S/long)),TH=Math.max(32,Math.round(Hmm*S/long));
  /* A FOUR-BAY CABINET AT 4096 ON THE LONG EDGE IS SIXTEEN MEGATEXELS of
     eight buffers, and the browser will not thank anybody for it. The cap is
     on the AREA rather than on either edge, because what runs out is memory,
     and the readout says when it bit. */
  const MAXN=4096*2304;
  let cut=1;
  if(TW*TH>MAXN){
    cut=Math.sqrt(MAXN/(TW*TH));
    TW=Math.max(32,Math.round(TW*cut));TH=Math.max(32,Math.round(TH*cut));
  }
  return {piece:piece,H:H,items:items,bays:bays,rU:rU,caps:caps,dev:dev,
          Wmm:Wmm,Hmm:Hmm,ox:ox,oy:oy,TW:TW,TH:TH,cut:cut,
          askU:askU,gotU:gotU,mpp:Wmm/TW};
}

/* ============================ the build ============================
   The faces are rasterised once into three canvases, and then every texel is
   read out of them and turned into the maps. Nothing below here knows what it
   is looking at: it knows a height, a metalness, a gloss and a colour, and
   everything else — the age in the paint, the dust on the ledges, the grime
   running down from the vents, the shine worn onto the handles — is a function
   of those. Which is the point: wear that is applied to the PICTURE rather
   than to the objects in it never contradicts the objects in it. */
function build(P,io){
  const TW=io.W,TH=io.H,N=TW*TH;
  const geo=geomOf(P);
  geo.TW=TW;geo.TH=TH;
  const H=geo.H,F=H.F;
  const kx=TW/geo.Wmm,ky=TH/geo.Hmm;
  const MM=1/geo.Wmm;                      /* mm -> tile-width units */
  const mk=()=>{const c=document.createElement("canvas");c.width=TW;c.height=TH;return c;};
  const cvA=mk(),cvP=mk(),cvE=mk();
  const stat=compose(cvA,cvP,cvE,P,geo,kx,ky);
  const ad=cvA.getContext("2d",{willReadFrequently:true}).getImageData(0,0,TW,TH).data;
  const pd=cvP.getContext("2d",{willReadFrequently:true}).getImageData(0,0,TW,TH).data;
  const ed=cvE.getContext("2d",{willReadFrequently:true}).getImageData(0,0,TW,TH).data;

  const Ab=new Uint8Array(N*3),NRM=new Uint8Array(N*3);
  const RGH=new Uint8Array(N),MET=new Uint8Array(N),AOc=new Uint8Array(N);
  /* EMISSIVE IN TWO BUFFERS, which needs saying. The runtime's EMI is ONE
     byte a texel — an intensity that the stock writer tints with a single
     ramp — and that is right for a mode whose glow is all one colour. A rack
     has five: a red jewel, a green one, a clear one, amber phosphor and the
     orange of a seven-segment, all lit at once on the same panel, and a
     single ramp cannot carry that.

     So EMI stays exactly what the runtime expects, down to its length, and
     the colour rides alongside it in ECOL, which the mode's own emissive
     writer reads. Anything that falls back to the stock writer still gets a
     sane monochrome glow rather than a buffer read at the wrong stride —
     which is precisely the failure this replaced. */
  const ALP=new Uint8Array(N),EMI=new Uint8Array(N),ECOL=new Uint8Array(N*3);
  const HGT=new Float32Array(N);
  let hMin=1e9,hMax=-1e9;

  const age=clamp(num(P.age,0.35),0,1);
  const dust=clamp(num(P.dust,0.3),0,1);
  const grime=clamp(num(P.grime,0.25),0,1);
  const scuff=clamp(num(P.scuff,0.35),0,1);
  const aoStr=clamp(num(P.aoStr,1),0,2);
  const nStr=clamp(num(P.nStr,1),0,3);
  const glow=clamp(num(P.glow,1),0,3);
  const dirt=hex2rgb(str(P.cDirt,"#6b6252"));
  const seed=P.seed|0;
  const rSpan=HHI-HLO;
  const pxMm=TW/geo.Wmm;
  const px=t=>Math.max(2,Math.round(t));      /* a feature size in texels */

  io.progress(0.05);

  function pass1(){
    for(let i=0;i<N;i++){
      const a=ad[i*4+3]/255;
      ALP[i]=Math.round(a*255);
      /* OUTSIDE THE CABINET IS THE DATUM, not the bottom of the height window.
         Nothing was drawn there, so the height plane reads as its cleared
         value — which is the lowest height there is — and a decal laid over
         another surface would then carve a trench the shape of its own
         bounding box out of it. Zero is the face of a panel, so zero is the
         one value that disturbs nothing. */
      const hmm=a>0.02?(HLO+(pd[i*4]/255)*rSpan):0;
      HGT[i]=hmm*MM;
      if(a>0.02){if(HGT[i]<hMin)hMin=HGT[i];if(HGT[i]>hMax)hMax=HGT[i];}
      Ab[i*3]=ad[i*4];Ab[i*3+1]=ad[i*4+1];Ab[i*3+2]=ad[i*4+2];
      MET[i]=pd[i*4+1];
      RGH[i]=255-pd[i*4+2];
      const ea=ed[i*4+3]/255;
      const er=clamp(ed[i*4]*ea*glow,0,255),eg=clamp(ed[i*4+1]*ea*glow,0,255),
            eb=clamp(ed[i*4+2]*ea*glow,0,255);
      ECOL[i*3]=er;ECOL[i*3+1]=eg;ECOL[i*3+2]=eb;
      EMI[i]=Math.max(er,eg,eb);
    }
    if(hMin>hMax){hMin=0;hMax=1e-6;}
    io.progress(0.4);setTimeout(pass2,0);
  }

  /* ---- what time did to it ---- */
  function pass2(){
    /* the one blur everything here is a function of: how much of the
       neighbourhood stands above this texel. It is the ambient occlusion, it
       is where dust lodges, and it is where a hand never reaches to clean. */
    const HB=blurClamp(HGT,TW,TH,Math.max(1,Math.round(pxMm*1.6)));
    const scale=geo.Wmm;                    /* mm across the artwork */
    const blotP=px(TW/(scale/120)),streakP=px(TW/(scale/26));
    for(let y=0;y<TH;y++){
      const row=y*TW,v=y/TH;
      for(let x=0;x<TW;x++){
        const i=row+x;
        if(!ALP[i])continue;
        const u=x/TW;
        const occ=clamp((HB[i]-HGT[i])*geo.Wmm/2.4,0,1);
        const met=MET[i]/255;
        let r=Ab[i*3],g=Ab[i*3+1],b=Ab[i*3+2];
        let rg=RGH[i]/255,mt=met;
        const emi=EMI[i];

        /* AGE. The pale plastics of that decade went amber under daylight and
           the dark ones did not, which is most of the difference between an
           old machine and a merely dirty one. It happens to PAINT, so it is
           gated on metalness, and it is uneven, because the light was. */
        if(age>0&&met<0.45&&!emi){
          const bl=fbm2(u,v,blotP,blotP,2,seed+17);
          const k=age*F.yellow*(0.45+0.75*bl)*(1-met/0.45);
          const lum=(r*0.3+g*0.59+b*0.11)/255;
          const amb=clamp(k*0.30*smoothstep(0.22,0.72,lum),0,0.46);
          r=lerp(r,r*1.05+16,amb);g=lerp(g,g*0.99+4,amb);b=lerp(b,b*0.80-10,amb);
        }

        /* DUST settles on what faces up. A ledge is a texel that stands above
           the one BELOW it, which is a thing the height field already knows,
           and it also lodges in anything it cannot be blown out of. */
        if(dust>0){
          const below=HGT[Math.min(TH-1,y+1)*TW+x];
          const ledge=clamp((HGT[i]-below)*geo.Wmm*0.55,0,1);
          const bl=fbm2(u,v,blotP*2,blotP*2,3,seed+29);
          const k=clamp(dust*(0.22+0.92*ledge+0.55*occ)*(0.5+0.8*bl),0,0.8);
          r=lerp(r,dirt[0]*1.35+40,k*0.62);
          g=lerp(g,dirt[1]*1.35+40,k*0.62);
          b=lerp(b,dirt[2]*1.30+36,k*0.62);
          rg=lerp(rg,0.90,k*0.72);mt*=1-k*0.55;
        }

        /* GRIME runs DOWNWARDS, from the vents and from the ledges, because
           it is carried by air and by hands and both have a direction. The
           streaks are a noise field stretched along y, which is cheap and is
           also exactly what a streak is. */
        if(grime>0){
          const st=fbm2(u,v*0.22,streakP,px(streakP*0.22),3,seed+37);
          const run=smoothstep(0.52,0.95,st)*smoothstep(0.02,0.3,v);
          const k=clamp(grime*(0.30*run+0.60*occ*occ),0,0.85);
          r=lerp(r,dirt[0]*0.72,k*0.58);
          g=lerp(g,dirt[1]*0.72,k*0.58);
          b=lerp(b,dirt[2]*0.70,k*0.58);
          rg=lerp(rg,0.86,k*0.5);
        }

        /* SCUFF is the opposite process and goes in the opposite places: on
           what stands proud and gets touched, the paint comes off and the
           metal under it shows. Handles, knob tops, the edges of the ears. */
        if(scuff>0&&met<0.7){
          const stand=smoothstep(0.30,0.80,(HGT[i]-hMin)/Math.max(1e-6,hMax-hMin));
          const gr=fbm2(u,v,px(blotP*5),px(blotP*5),2,seed+53);
          const k=clamp(scuff*stand*(1-occ)*smoothstep(0.42,0.88,gr),0,0.7);
          r=lerp(r,168,k*0.62);g=lerp(g,172,k*0.62);b=lerp(b,176,k*0.62);
          mt=lerp(mt,0.78,k*0.66);rg=lerp(rg,0.34,k*0.5);
        }

        Ab[i*3]=clamp(r,0,255);Ab[i*3+1]=clamp(g,0,255);Ab[i*3+2]=clamp(b,0,255);
        RGH[i]=clamp(rg,0,1)*255;MET[i]=clamp(mt,0,1)*255;
        AOc[i]=clamp(1-occ*0.88*aoStr,0,1)*255;
      }
      if((y&63)===0)io.progress(0.4+0.4*y/TH);
    }
    io.progress(0.82);setTimeout(pass3,0);
  }

  /* ---- and the shape of it ---- */
  function pass3(){
    /* the height is read through a one-texel blur, which is what turns the
       three stepped widths of a cable into the section of a cable and takes
       the stair off every rasterised arc without taking the edge off a plate */
    const HS=blurClamp(HGT,TW,TH,1);
    for(let y=0;y<TH;y++){
      const yp=Math.min(TH-1,y+1)*TW,ym=Math.max(0,y-1)*TW,y0=y*TW;
      for(let x=0;x<TW;x++){
        const i=y0+x;
        if(!ALP[i]){NRM[i*3]=128;NRM[i*3+1]=128;NRM[i*3+2]=255;continue;}
        const xp=Math.min(TW-1,x+1),xm=Math.max(0,x-1);
        const dhdu=(HS[y0+xp]-HS[y0+xm])*0.5*TW*nStr;
        const dhdv=(HS[yp+x]-HS[ym+x])*0.5*TW*nStr;
        let nx=-dhdu,ny=-dhdv;
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;
        NRM[i*3]=(nx*0.5+0.5)*255;NRM[i*3+1]=(ny*0.5+0.5)*255;
        NRM[i*3+2]=(inv*0.5+0.5)*255;
      }
    }
    io.progress(1);
    io.done({A:Ab,NRM:NRM,RGH:RGH,MET:MET,AO:AOc,HGT:HGT,hMin:hMin,hMax:hMax,
             ALP:ALP,EMI:EMI,ECOL:ECOL,census:censusOf()});
  }

  function censusOf(){
    const by={};let U_used=0,devs=0,blanks=0,vents=0;
    for(const it of geo.items){
      if(it.kind==="dev"){by[it.id]=(by[it.id]||0)+1;devs++;U_used+=it.uh;}
      else if(it.kind==="vent"){vents++;}
      else blanks++;
    }
    return {piece:geo.piece,bays:geo.bays,rU:geo.rU,devs:devs,byId:by,
            blanks:blanks,vents:vents,usedU:U_used,
            ports:stat.ports,cords:stat.wires.cords,trunks:stat.wires.trunks,
            exits:stat.wires.exits,
            Wmm:geo.Wmm,Hmm:geo.Hmm,mpp:geo.mpp,cut:geo.cut,
            fin:H.fin,trim:H.trimKey,lamps:H.lamps.slice(),phos:H.phos,
            handle:H.handle,dev:geo.dev?geo.dev.id:"",gotU:geo.gotU};
  }

  setTimeout(pass1,0);
}

/* What the checks reach for. The layout is a placement problem with rules —
   zones, heat, airflow, the EIA hole pattern — and every one of those is a
   thing that can be measured from outside rather than looked at. */
window.ForgeRack={
  U:U,PANEL_W:PANEL_W,HOLE_DX:HOLE_DX,HOLE_Y:HOLE_Y,GAP:GAP,
  SIDE:SIDE,PLINTH:PLINTH,CAP:CAP,CABW:CABW,MARGIN:MARGIN,HLO:HLO,HHI:HHI,
  FINISH:FINISH,LAMP:LAMP,PHOS:PHOS,DEV:DEV,DEV_BY:DEV_BY,
  ZONE:ZONE,CAP_OF:CAP_OF,MIX:MIX,MIX_KEYS:MIX_KEYS,
  WORDS:WORDS,TITLES:TITLES,JACKET:JACKET,
  LANE_N:LANE_N,LANE_X0:LANE_X0,LANE_DX:LANE_DX,
  houseOf:houseOf,layout:layout,geomOf:geomOf,screwYs:screwYs,
  weighted:weighted,mixOf:mixOf,findRun:findRun,zoneK:zoneK,hseed:hseed,
  OUT_OF_ZONE:OUT_OF_ZONE
};

/* ============================ mode definition ============================ */

Forge.register({
  id:"rack",
  label:"Equipment rack",
  group:"Interiors",
  threadable:true,
  blurb:"A cabinet of invented machinery, cabled the way a rack is cabled",
  title:'Equipment <em>Rack</em>',
  tagline:"EIA-310 frame · one maker · laced cabling",
  actionLabel:"Fill the cabinet",
  busyLabel:"Racking…",
  previewSize:320,
  preview:{gain:2.7,amb:1.1,specK:0.55,skyLo:[0.11,0.12,0.15],skyHi:[0.26,0.29,0.36]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
    {key:"ao",label:"AO"},{key:"emissive",label:"Emissive"},
    {key:"height",label:"Height"},{key:"orm",label:"ORM packed"},
    {key:"opacity",label:"Opacity"}
  ],

  presets:[
    {id:"machine",label:"Machine room — logic and tape",set:{
      piece:"rack",bays:2,rackU:42,mix:"compute",fill:.9,vents:.8,
      finish:"putty",trimAuto:true,phos:"auto",lit:.85,
      wires:true,cables:.7,exits:.4,
      age:.4,dust:.3,grime:.22,scuff:.3,aoStr:1,nStr:1,glow:1,cDirt:"#6b6252"}},

    {id:"console",label:"Operations console — somebody stood here",set:{
      piece:"rack",bays:2,rackU:28,mix:"control",fill:.94,vents:.5,
      finish:"slate",trimAuto:true,phos:"p1",lit:1,
      wires:true,cables:.5,exits:.3,
      age:.2,dust:.2,grime:.15,scuff:.4,aoStr:1,nStr:1,glow:1.15,cDirt:"#6b6252"}},

    {id:"comms",label:"Comms room — a wall of patch",set:{
      piece:"rack",bays:3,rackU:45,mix:"comms",fill:.96,vents:.4,
      finish:"bone",trimAuto:true,phos:"auto",lit:.8,
      wires:true,cables:1,exits:.6,
      age:.55,dust:.3,grime:.3,scuff:.25,aoStr:1.05,nStr:1,glow:1,cDirt:"#6b6252"}},

    {id:"dark",label:"Powered down — nothing lit",set:{
      piece:"rack",bays:1,rackU:36,mix:"balanced",fill:.9,vents:.7,
      finish:"char",trimAuto:true,phos:"auto",lit:0,
      wires:true,cables:.6,exits:.35,
      age:.3,dust:.5,grime:.4,scuff:.3,aoStr:1.1,nStr:1,glow:1,cDirt:"#6b6252"}},

    {id:"derelict",label:"Derelict — stripped and filthy",set:{
      piece:"rack",bays:2,rackU:40,mix:"balanced",fill:.62,vents:.5,
      finish:"olive",trimAuto:true,phos:"auto",lit:0,
      wires:true,cables:.35,exits:.7,
      age:.9,dust:.85,grime:.95,scuff:.2,aoStr:1.2,nStr:1.1,glow:1,
      cDirt:"#5b5243"}},

    {id:"oneface",label:"One panel — a decal of a single device",set:{
      piece:"panel",dev:"auto",panelU:0,
      finish:"brush",trimAuto:true,phos:"auto",lit:1,
      wires:true,cables:.5,exits:.3,
      age:.15,dust:.12,grime:.1,scuff:.3,aoStr:1,nStr:1,glow:1.1,cDirt:"#6b6252"}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"piece",type:"select",label:"Draw",value:"rack",options:[
        ["rack","A cabinet, front elevation"],["panel","One device panel"]]},
      {id:"size",type:"select",label:"Resolution",value:2048,numeric:true,
       options:Forge.sizes("plain",4096)},
      {id:"bays",label:"Cabinets",min:1,max:4,step:1,value:2,need:"rack"},
      {id:"rackU",label:"Cabinet height",unit:"U",min:8,max:45,step:1,value:38,need:"rack"},
      {id:"dev",type:"select",label:"Device",value:"auto",need:"panel",options:
        [["auto","Whatever the seed picks"]].concat(DEV.map(d=>[d.id,
          d.name.charAt(0).toUpperCase()+d.name.slice(1)]))},
      {id:"panelU",type:"select",label:"Panel height",value:0,numeric:true,need:"panel",
       options:[[0,"Natural for the device"],[1,"1 U"],[2,"2 U"],[3,"3 U"],[4,"4 U"],
                [5,"5 U"],[6,"6 U"],[7,"7 U"],[8,"8 U"],[9,"9 U"]]},
      {type:"readout"},
      {id:"seed",type:"seed",label:"Seed",value:4471},
      {type:"note",html:"<b>The frame is real and the kit is not.</b> The rack is "+
        "EIA-310 — a 482.6 mm panel, 44.45 mm to the U, holes 15.875/15.875/12.7 up "+
        "each rail with their centres 465.1 mm apart — so every panel meets its "+
        "neighbour on the pitch and every screw lands on a hole that exists. "+
        "Everything bolted into it is invented here and is not any product that was "+
        "ever made."}
    ]},

    {title:"The installation",open:true,need:"rack",rows:[
      {id:"mix",type:"select",label:"Mostly",value:"balanced",options:[
        ["balanced","A bit of everything"],["compute","Logic, tape and disc"],
        ["control","Consoles and instruments"],["comms","Patch, line and timing"]]},
      {id:"fill",label:"How full",min:.2,max:1,step:.02,value:.88},
      {id:"vents",label:"Vent panels over hot kit",min:0,max:1,step:.05,value:.7},
      {id:"lit",label:"Powered up",min:0,max:1,step:.05,value:.9},
      {type:"note",html:"Filled <b>zone by zone from the floor</b>, in the order an "+
        "engineer would: supply and distribution at the bottom where the weight "+
        "belongs, consoles at standing height, transports where they can be reached, "+
        "patch and line at the top. A vent panel goes above whatever runs hot and the "+
        "gaps are blanked, because an open U in a cooled cabinet is a short circuit "+
        "in the airflow."}
    ]},

    {title:"Cabling",open:true,need:"rack",rows:[
      {type:"checks",items:[{id:"wires",label:"Run the cables",value:true}]},
      {id:"cables",label:"How much of it is patched",min:0,max:1,step:.05,value:.72},
      {id:"exits",label:"Leads that leave the picture",min:0,max:1,step:.05,value:.4},
      {type:"note",html:"A lead leaves its connector, <b>sags</b>, turns into the side "+
        "member, runs down it with its neighbours under a tie, and comes back out at "+
        "the port it is going to. Power goes to power and signal to signal. Patch "+
        "cords hang across their own field, which is the one panel a cable is allowed "+
        "to cross."}
    ]},

    {title:"The maker",rows:[
      {id:"finish",type:"select",label:"Panel finish",value:"putty",
       options:FIN_KEYS.map(k=>[k,FINISH[k].name.charAt(0).toUpperCase()+
         FINISH[k].name.slice(1)])},
      {type:"checks",items:[{id:"trimAuto",label:"Let the maker choose the trim",value:true}]},
      {id:"trim",type:"select",label:"Trim and frame",value:"char",need:"trimman",
       options:FIN_KEYS.map(k=>[k,FINISH[k].name.charAt(0).toUpperCase()+
         FINISH[k].name.slice(1)])},
      {id:"phos",type:"select",label:"Screen phosphor",value:"auto",options:[
        ["auto","Whatever the maker fitted"],["p1","Green P1"],["p3","Amber P3"],
        ["p4","White P4"]]},
      {type:"note",html:"One bezel colour, one corner radius, one handle, one place "+
        "the nameplate goes, <b>three lamp colours and not five</b> — drawn once per "+
        "seed and applied to every device in the place. A cabinet whose devices each "+
        "chose their own styling reads as a junk shop, which is the usual failure of "+
        "this subject."}
    ]},

    {title:"Age and dirt",rows:[
      {id:"age",label:"Yellowing",min:0,max:1,step:.05,value:.35},
      {id:"dust",label:"Dust on the ledges",min:0,max:1,step:.05,value:.3},
      {id:"grime",label:"Grime in the crevices",min:0,max:1,step:.05,value:.25},
      {id:"scuff",label:"Worn where hands go",min:0,max:1,step:.05,value:.35},
      {type:"colors",label:"Dirt",items:[{id:"cDirt",value:"#6b6252"}]},
      {type:"note",html:"Yellowing happens to <b>paint and not to metal</b>, and the "+
        "pale plastics of that decade went amber under daylight while the dark ones "+
        "did not — which is most of the difference between an old machine and a merely "+
        "dirty one. Dust lies on what faces up, grime runs downwards, and scuffing is "+
        "applied last, so a rubbed handle shows through both."}
    ]},

    {title:"Surface",rows:[
      {id:"aoStr",label:"Occlusion",min:0,max:2,step:.05,value:1},
      {id:"nStr",label:"Normal strength",min:0,max:3,step:.05,value:1},
      {id:"glow",label:"Emissive gain",min:0,max:3,step:.05,value:1}
    ]}
  ],

  /* the lamps are not all one colour, and the runtime's emissive is one
     channel, so the mode packs the colour itself and reads it back here */
  writers:function(B){
    return {emissive:function(i,o,k){
      const C=B.ECOL;
      if(!C){const e=B.EMI[i];o[k]=e;o[k+1]=e;o[k+2]=e;return 255;}
      o[k]=C[i*3];o[k+1]=C[i*3+1];o[k+2]=C[i*3+2];
      return 255;
    }};
  },

  needs:function(P){
    const out=[str(P.piece,"rack")==="panel"?"panel":"rack"];
    if(!bool(P.trimAuto,true))out.push("trimman");
    return out;
  },

  /* a cabinet has nothing behind it and a loose panel has nothing round it,
     so both want something to be seen against */
  seamless:function(){return false;},
  backdrops:function(){return true;},

  size:function(P,preview){
    const g=geomOf(P,preview?320:0);
    return {w:g.TW,h:g.TH};
  },
  build:build,

  /* metres, always */
  plan:function(P){
    const g=geomOf(P);
    return {w:g.Wmm/1000,h:g.Hmm/1000,cutout:true};
  },

  variants:function(P){
    const out=[];
    if(bool(P.wires,true)&&str(P.piece,"rack")!=="panel")
      out.push({id:"bare",label:"no cabling — the kit on its own",set:{wires:false}});
    if(num(P.lit,1)>0.02)
      out.push({id:"dark",label:"powered down — nothing lit",set:{lit:0}});
    const worn=num(P.age,0)+num(P.dust,0)+num(P.grime,0)+num(P.scuff,0);
    if(worn>0.04)
      out.push({id:"new",label:"commissioning day — clean",
        set:{age:0,dust:0,grime:0,scuff:0}});
    return out;
  },
  variantRoot:"installed",

  fileBase:function(P,W){
    const g=geomOf(P);
    return "rack_"+(g.piece==="panel"?("panel_"+(g.dev?g.dev.id:"auto")+"_"+g.gotU+"u")
      :(g.bays+"bay_"+g.rU+"u"))+"_"+(P.seed|0)+"_"+W;
  },

  tileTag:function(){return "Cut-out — nothing behind it";},

  readout:function(P){
    const g=geomOf(P);
    const H=g.H;
    const lamps=H.lamps.map(k=>LAMP[k].name).join(", ");
    if(g.piece==="panel"){
      const d=g.dev;
      return "<b>"+Math.round(g.Wmm)+" × "+Math.round(g.Hmm)+" mm</b> · "+
        g.TW+" × "+g.TH+" px<br><b>"+(g.mpp).toFixed(2)+" mm per texel</b><br>"+
        "one "+(d?d.name:"panel")+" at <b>"+g.gotU+" U</b>"+
        (g.askU&&g.askU!==g.gotU
          ?(" — "+g.askU+" U asked for, but this device is built "+d.u[0]+"–"+d.u[1]+" U")
          :"")+
        "<br>"+FINISH[H.fin].name+", "+H.trim.name+" trim · lamps "+lamps;
    }
    /* THE FILL IS A REAL PLACEMENT, so these are counted rather than guessed:
       the zone walk is a few hundred tests and costs nothing on a slider. */
    let devs=0,blanks=0,vents=0,usedU=0;
    for(const it of g.items){
      if(it.kind==="dev"){devs++;usedU+=it.uh;}
      else if(it.kind==="vent")vents++;else blanks++;
    }
    const totU=g.bays*g.rU;
    return "<b>"+Math.round(g.Wmm)+" × "+Math.round(g.Hmm)+" mm</b> · "+
      g.TW+" × "+g.TH+" px"+
      (g.cut<0.995?(" — capped from "+Math.round(P.size|0)+" px on the long edge")
                  :"")+"<br>"+
      "<b>"+(g.mpp).toFixed(2)+" mm per texel</b> · "+g.bays+" × "+g.rU+" U"+
      " = "+totU+" U of frame<br>"+
      "<b>"+devs+" devices</b> over "+usedU+" U ("+Math.round(usedU/totU*100)+
      "% of it), "+vents+" vent panel"+(vents===1?"":"s")+", "+blanks+" blank"+
      (blanks===1?"":"s")+"<br>"+
      FINISH[H.fin].name+", "+H.trim.name+" trim · lamps "+lamps+
      " · "+PHOS[H.phos].name+" screens<br>"+
      (num(P.lit,1)<=0.02?"<b>powered down</b> — jewels at their unlit colour, "+
        "displays blank, meters at the stop"
        :"powered up at <b>"+Math.round(num(P.lit,1)*100)+"%</b>");
  },

  readme:function(P,info){
    const g=geomOf(P);
    const c=info.census||{};
    const H=g.H;
    const names=Object.keys(c.byId||{}).sort().map(k=>
      "  "+String(c.byId[k]).padStart(2)+" × "+DEV_BY[k].name);
    return [
"TEXTURE FORGE — equipment rack",
"",
(g.piece==="panel"
 ?("One device panel, "+Math.round(g.Wmm)+" × "+Math.round(g.Hmm)+" mm")
 :(g.bays+" cabinet"+(g.bays===1?"":"s")+" of "+g.rU+" U, front elevation, "+
   Math.round(g.Wmm)+" × "+Math.round(g.Hmm)+" mm"))+
  ", at "+info.W+" × "+info.H+" px",
"("+(g.Wmm/info.W).toFixed(2)+" mm per texel).",
"",
"CUT-OUT. opacity.png is the silhouette of the cabinet. Use it as the alpha of",
"the base colour, or as an opacity/clip map, and whatever the rack is standing",
"in front of shows through around it. Height is zero and the normal is flat",
"outside the silhouette, so it disturbs nothing it is laid over.",
"",
"THE FRAME IS REAL AND THE KIT IS NOT",
"The rack is EIA-310: a 482.6 mm panel, 44.45 mm to the U, mounting holes at",
"15.875, 15.875 and 12.7 mm up each U with their centres 465.1 mm apart. That",
"is a standard rather than anybody's design, and it is what makes a rack look",
"like a rack — every panel meets its neighbour on the pitch, every screw lands",
"on a hole that exists, and nothing is anywhere by eye.",
"",
"Everything bolted into that frame is invented. The devices here are archetypes",
"— a regulator bay, a tape transport, a patch field — built out of the controls",
"a machine of that period was actually operated through, and they are not, and",
"are not meant to resemble, any product that was ever made or marketed.",
"",
(g.piece==="panel"
 ?("WHAT IT IS\nOne "+(g.dev?g.dev.name:"panel")+" at "+g.gotU+" U"+
   (g.askU&&g.askU!==g.gotU
    ?(" — "+g.askU+" U was asked for, but this device is built "+
      g.dev.u[0]+"–"+g.dev.u[1]+" U, so it came out at "+g.gotU+".")
    :".")+
   "\nIts ports are drawn but nothing is plugged into them, because there is\n"+
   "nothing here to plug it into.")
 :("WHAT IS IN IT\n"+(names.length?names.join("\n"):"  (counted on the next build)")+
   "\nplus "+(c.vents||0)+" vent panel"+((c.vents||0)===1?"":"s")+" and "+
   (c.blanks||0)+" blank"+((c.blanks||0)===1?"":"s")+", filling "+
   (c.usedU||0)+" of "+(g.bays*g.rU)+" U.\n"+
   "\nFilled zone by zone from the floor, in the order an engineer would: supply\n"+
   "and distribution at the bottom where the weight belongs, consoles at standing\n"+
   "height, transports where they can be reached, patch and line at the top. A\n"+
   "vent panel goes above whatever runs hot. The gaps are blanked, because an\n"+
   "open U in a cooled cabinet is a short circuit in the airflow.")),
"",
"ONE MAKER BUILT ALL OF IT",
FINISH[H.fin].name+" panels, "+H.trim.name+" trim and frame, "+
  (H.r?H.r+" mm corner radius":"square corners")+", "+
  (H.handle==="none"?"no handles":H.handle==="cup"?"cup handles":"bar handles")+",",
"nameplate "+(H.legendAt==="tl"?"top left":"bottom centre")+", "+
  (H.ears?"visible mounting ears":"flush panels")+".",
"Lamps are "+H.lamps.map(k=>LAMP[k].name).join(", ")+" — three jewel colours and",
"not five, because two states and an alarm is what a real panel had. Screens are",
PHOS[H.phos].name+".",
"",
(g.piece==="panel"?null:
("THE CABLING\n"+
 (bool(P.wires,true)
  ?((c.trunks||0)+" trunk"+((c.trunks||0)===1?"":"s")+" and "+(c.cords||0)+
    " patch cord"+((c.cords||0)===1?"":"s")+" over "+(c.ports||0)+" ports, of which "+
    (c.exits||0)+" lead"+((c.exits||0)===1?"":"s")+"\nleave the picture entirely.\n"+
    "\nA lead leaves its connector, sags, turns into the side member, runs down it\n"+
    "with its neighbours under a tie, and comes back out at the port it is going\n"+
    "to. Power goes to power and signal to signal. Patch cords hang in a catenary\n"+
    "across their own field, which is the one panel a cable is allowed to cross.\n"+
    "The cables are drawn OVER the faces, because that is where they are.\n"+
    "\nThey are round, and the only place that can be said is the height channel:\n"+
    "three passes of narrowing width at rising height make a dome that the normal\n"+
    "map reads as the section of a cable.")
  :"None. The cabling is switched off, so this is the kit on its own."))),
"",
"AGE AND DIRT",
"Yellowing at "+Math.round(num(P.age,0)*100)+"%, dust at "+
  Math.round(num(P.dust,0)*100)+"%, grime at "+Math.round(num(P.grime,0)*100)+
  "%, wear at "+Math.round(num(P.scuff,0)*100)+"%.",
"Yellowing happens to paint and not to metal, and to pale paint more than dark:",
"the putty and bone finishes of that decade went amber under daylight and the",
"charcoal and olive ones did not. Dust lies on what faces up — which the height",
"field already knows, since a ledge is a texel standing above the one below it.",
"Grime runs downwards. Wear is applied last, on what stands proud and gets",
"touched, so a rubbed handle shows through both.",
"",
(num(P.lit,1)<=0.02
 ?"POWERED DOWN. The jewels are at their unlit colour, the displays are blank,\nthe meters are at their stop and the switches are off. emissive.png is empty."
 :"POWERED UP at "+Math.round(num(P.lit,1)*100)+"%. emissive.png carries the lamps,\nthe legend caps, the seven-segment readouts, the bar graphs and the screens —\nand nothing else, so it can be fed straight to an emissive slot."),
"",
"FILES",
"basecolor.png  sRGB.",
"normal.png     Tangent space, "+info.normalNote+".",
"roughness.png  Linear grey.",
"metallic.png   Linear grey.",
"ao.png         Linear grey.",
"emissive.png   sRGB. Black where nothing is lit.",
"height.png     Linear grey, normalised over the range below.",
"orm.png        R = AO, G = roughness, B = metallic.",
"opacity.png    Linear grey. White is cabinet, black is nothing.",
"unlit.png      sRGB. Everything above, baked under one light.",
"",
"height.png is normalised over "+(info.hMin*g.Wmm).toFixed(2)+" … "+
  (info.hMax*g.Wmm).toFixed(2)+" mm — the deepest thing in the picture to the",
"thing standing furthest proud of a panel face, which is zero. Multiply the",
"map by "+((info.hMax-info.hMin)*g.Wmm).toFixed(2)+" mm and subtract "+
  (-info.hMin*g.Wmm).toFixed(2)+" to get millimetres back.",
"",
"Seed "+(P.seed|0)+"."
].filter(x=>x!==null).join("\n");
  },

  presetKeep:["size","seed"]
});

})();
