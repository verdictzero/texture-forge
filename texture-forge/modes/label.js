/* =====================================================================
   MODE: label — industrial warning labels, signs, placards and data plates
   =====================================================================
   A label is not a texture pattern. It is a MANUFACTURED OBJECT of a known
   size, carrying artwork laid out to a published standard, applied to a
   substrate by a named process, and then worn by the place it was bolted
   to. This mode draws that object: the artwork as real vector geometry and
   real text, the substrate as a material with thickness and an edge, the
   process as relief, and the years as wear.

   WHAT IT KNOWS ABOUT

     ANSI Z535.4    signal-word panel — the word, its colour pairing and the
                    safety-alert triangle — over a message panel.
     ISO 3864-1 /
       ISO 7010     the four sign geometries: yellow warning triangle, red
                    prohibition annulus with its 45 degree bar, blue
                    mandatory disc, green safe-condition square.
     UN GHS / CLP   the red square-on-point pictogram frame, signal word and
                    hazard statement block.
     NFPA 704       the four-diamond fire diamond, blue/red/yellow/white,
                    with the 0-4 ratings and the special-hazard notations.
     NFPA 70E       the arc flash label and the fields it has to carry.
     49 CFR 172     the hazmat placard: square on point, inner line, class
                    number in the bottom corner, UN number.
     ASME A13.1     pipe marking — the six colour pairings and the table of
                    band length and letter height BY PIPE DIAMETER, which is
                    the part everybody gets wrong.
     Code 39        a barcode that scans, rather than stripes that look like
                    one: nine elements a character, three of them wide, and
                    ten narrow modules of quiet ground each side.

   The proportions here are drawn from the published geometry of these
   signs and they are close enough to read as the real thing at any size
   the mode can output. They are NOT a certified reproduction: if one of
   these is going onto a real machine, check it against the standard you
   are held to. The readme says so too.

   WHY THE SYMBOLS ARE VECTORS AND UNICODE BOTH

   Every hazard symbol in the catalogue is drawn from paths — arcs, angles
   and fills worked out from the shape's own proportions — because a
   trefoil made of three 60 degree sectors at r/2 IS the trefoil, and one
   made from whatever glyph a font happens to carry is a picture of
   somebody's idea of it. Vectors also scale to a 4096 px plate without
   going soft.

   But a catalogue is a closed list, and the whole point of this mode is
   that it is not closed. So every pictogram cell will equally take TEXT:
   type a Unicode character and that is what gets drawn, at pictogram size,
   from the browser's own fonts. Radiation, biohazard, high voltage and a
   dozen more have real code points, and so does every symbol anybody adds
   after this file was written. The cost is that the glyph is the browser's
   rather than ours, and a font without it gives you a box — the readout
   says which cells are on a glyph rather than a path.

   THE UNIT IS THE MILLIMETRE, throughout, because a label is ordered in
   millimetres and printed at a dpi. The readout quotes both, and the
   exported plane is the real size, so a 100 x 50 mm label lands in Blender
   as a 100 x 50 mm label.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      fbm=Forge.fbm,fbm2=Forge.fbm2,hex2rgb=Forge.hex2rgb,blurClamp=Forge.blurClamp;

const TAU=Math.PI*2,DEG=Math.PI/180,SQ3=Math.sqrt(3);
const num=(v,d)=>{const n=+v;return isFinite(n)?n:d;};
const str=(v,d)=>{const s=(v==null?"":String(v));return s.length?s:(d||"");};

/* ============================ the safety colours ============================
   ANSI Z535.1 names its colours by Munsell chips, not by hex, and every
   printer has its own conversion. These are the sRGB values the standard's
   own colour guides land on closely enough that a red label reads as safety
   red beside a real one rather than as a web red. They are defaults: every
   one of them is a colour control. */
const SIGNAL={
  danger :{word:"DANGER",  bg:"#c8102e",fg:"#ffffff",alert:true,  blurb:"death or serious injury WILL occur"},
  warning:{word:"WARNING", bg:"#f68b1f",fg:"#000000",alert:true,  blurb:"death or serious injury COULD occur"},
  caution:{word:"CAUTION", bg:"#f6be00",fg:"#000000",alert:true,  blurb:"minor or moderate injury"},
  notice :{word:"NOTICE",  bg:"#00539b",fg:"#ffffff",alert:false, blurb:"a practice not related to injury"},
  safety :{word:"SAFETY",  bg:"#007a33",fg:"#ffffff",alert:false, blurb:"safety instructions"},
  /* no signal word is still a HEADER — a plate's maker name, a legend's
     title — so its pair is a plain one rather than a black bar */
  none   :{word:"",        bg:"#ffffff",fg:"#111111",alert:false, blurb:"no signal word"}
};
const SIGNAL_KEYS=["danger","warning","caution","notice","safety","none"];

/* ISO 3864-1 sign colours. The yellow of a warning triangle is not the
   yellow of a CAUTION bar — the ISO chip is greener and darker. */
const ISOC={yellow:"#f9a800",red:"#c8102e",blue:"#005387",green:"#00843d",black:"#1b1b1b",white:"#ffffff"};

/* ASME A13.1 legend colour pairings, by what is in the pipe. */
const PIPEC={
  flam  :{label:"Flammable",           bg:"#f6be00",fg:"#111111"},
  comb  :{label:"Combustible",         bg:"#6b4423",fg:"#ffffff"},
  toxic :{label:"Toxic / corrosive",   bg:"#f07f13",fg:"#111111"},
  quench:{label:"Fire quenching",      bg:"#c8102e",fg:"#ffffff"},
  water :{label:"Potable water",       bg:"#00843d",fg:"#ffffff"},
  air   :{label:"Compressed air",      bg:"#00539b",fg:"#ffffff"},
  other :{label:"Other — user defined",bg:"#6a3c8c",fg:"#ffffff"}
};

/* ASME A13.1 Table 1: the band and the letters are set BY THE PIPE, not by
   taste. Outside diameter INCLUDING any covering, in mm; the length of the
   colour field and the letter height follow. This is the table that makes a
   pipe marker right or wrong, so it is in here rather than in a comment. */
const A13=[
  {odMax: 32,band:203,cap:12.7,note:'19-32 mm OD (3/4-1 1/4 in)'},
  {odMax: 51,band:203,cap:19.1,note:'38-51 mm OD (1 1/2-2 in)'},
  {odMax:152,band:305,cap:31.8,note:'64-152 mm OD (2 1/2-6 in)'},
  {odMax:254,band:610,cap:63.5,note:'203-254 mm OD (8-10 in)'},
  {odMax:1e6,band:813,cap:88.9,note:'over 254 mm OD (over 10 in)'}
];
function a13Of(odMm){for(const r of A13)if(odMm<=r.odMax)return r;return A13[A13.length-1];}

/* The nominal bores people actually say out loud, with the OD that goes with
   them, so "DN100" picks the right row of the table instead of the user
   having to look up 114.3. */
const DN=[
  ["15",21.3],["20",26.9],["25",33.7],["32",42.4],["40",48.3],["50",60.3],
  ["65",76.1],["80",88.9],["100",114.3],["125",139.7],["150",168.3],
  ["200",219.1],["250",273.0],["300",323.9],["400",406.4],["500",508.0]
];

/* 49 CFR 172.519: a placard is 273 mm on a side, square on point, with a
   solid line 12.7 mm wide set in 12.7 mm from the edge. Those are the two
   numbers that make a placard look like a placard. */
const PLACARD={side:273,line:12.7,inset:12.7};

/* ============================ substrates ============================
   met/rough are the material under the artwork. `core` is what an engraving
   tool finds when it cuts through the face — the whole point of two-ply
   phenolic, and the reason engraved marks on it are LIGHT and RECESSED at
   the same time. `bead` is retroreflective glass beading. */
const MATS={
  vinyl  :{name:"printed vinyl, laminated",  sub:"#f4f3ef",met:0.02,rough:0.22,core:"#f4f3ef",
           lam:true, flex:true, thick:0.25,bead:0,gloss:0.82},
  poly   :{name:"polycarbonate overlay",     sub:"#ececea",met:0.03,rough:0.14,core:"#ececea",
           lam:true, flex:true, thick:0.5, bead:0,gloss:0.92},
  alu    :{name:"anodised aluminium",        sub:"#b6babd",met:0.86,rough:0.34,core:"#d7dadc",
           lam:false,flex:false,thick:1.0, bead:0,gloss:0.5},
  etch   :{name:"photo-etched stainless",    sub:"#b0b4b7",met:0.92,rough:0.28,core:"#74787c",
           lam:false,flex:false,thick:0.8, bead:0,gloss:0.6},
  brass  :{name:"engraved brass",            sub:"#c2a04c",met:0.90,rough:0.26,core:"#8d7231",
           lam:false,flex:false,thick:1.2, bead:0,gloss:0.62},
  phenol :{name:"engraved phenolic, two-ply",sub:"#17181a",met:0.02,rough:0.40,core:"#f2f1ec",
           lam:false,flex:false,thick:1.6, bead:0,gloss:0.55},
  steel  :{name:"stamped steel plate",       sub:"#8e9296",met:0.88,rough:0.44,core:"#9aa0a4",
           lam:false,flex:false,thick:1.5, bead:0,gloss:0.35},
  reflect:{name:"retroreflective sheeting",  sub:"#e9e9e6",met:0.04,rough:0.30,core:"#e9e9e6",
           lam:true, flex:true, thick:0.4, bead:1,gloss:0.5},
  glow   :{name:"photoluminescent sheet",    sub:"#d8ecd2",met:0.02,rough:0.42,core:"#d8ecd2",
           lam:true, flex:true, thick:0.5, bead:0,gloss:0.4},
  paper  :{name:"card tag, laminate-free",   sub:"#efe9d9",met:0.00,rough:0.82,core:"#efe9d9",
           lam:false,flex:true, thick:0.6, bead:0,gloss:0.12}
};
const MAT_KEYS=Object.keys(MATS);
const matOf=P=>MATS[P.material]||MATS.vinyl;

/* How the artwork got onto the substrate. This is a relief question and a
   colour question at once, and the two are not independent: laser-marking
   anodised aluminium changes the colour of the oxide and leaves the surface
   dead flat, while engraving the same plate cuts a groove and finds bare
   metal at the bottom of it. */
const MARKS={
  print  :{name:"screen / digital print",  depth: 0.00,inkGloss: 0.30,fromCore:false,dirt:0.0},
  engrave:{name:"engraved and paint-filled",depth:-0.35,inkGloss:-0.10,fromCore:false,dirt:1.0},
  cut    :{name:"engraved to the core",    depth:-0.30,inkGloss:-0.05,fromCore:true, dirt:1.0},
  etch   :{name:"photo-etched, bare",      depth:-0.08,inkGloss:-0.25,fromCore:true, dirt:0.7},
  /* the one everybody's data plate actually is: etched, then the recess
     filled with black. Recessed AND legible, which bare etching is not. */
  etchfill:{name:"photo-etched, colour-filled",depth:-0.07,inkGloss:-0.15,fromCore:false,dirt:0.8},
  emboss :{name:"embossed / stamped proud", depth: 0.30,inkGloss: 0.05,fromCore:true, dirt:0.2},
  laser  :{name:"laser-marked",            depth: 0.00,inkGloss:-0.18,fromCore:false,dirt:0.0}
};
const markOf=P=>MARKS[P.marking]||MARKS.print;

/* ============================ Code 39, for real ============================
   A barcode drawn as plausible-looking stripes is a lie that costs nothing
   to avoid: Code 39 is nine elements per character, five bars and four
   spaces, exactly three of the nine wide, and it needs no checksum. So the
   barcode on a data plate here SCANS, and the readme says what it holds.

   The table is the standard's own bit patterns: 1 = wide element, 0 =
   narrow, reading bar, space, bar, space, ... from the left. */
const C39={
  "0":"000110100","1":"100100001","2":"001100001","3":"101100000","4":"000110001",
  "5":"100110000","6":"001110000","7":"000100101","8":"100100100","9":"001100100",
  "A":"100001001","B":"001001001","C":"101001000","D":"000011001","E":"100011000",
  "F":"001011000","G":"000001101","H":"100001100","I":"001001100","J":"000011100",
  "K":"100000011","L":"001000011","M":"101000010","N":"000010011","O":"100010010",
  "P":"001010010","Q":"000000111","R":"100000110","S":"001000110","T":"000010110",
  "U":"110000001","V":"011000001","W":"111000000","X":"010010001","Y":"110010000",
  "Z":"011010000","-":"010000101",".":"110000100"," ":"011000100","$":"010101000",
  "/":"010100010","+":"010001010","%":"000101010","*":"010010100"
};
/* -> array of {w:widthInModules, bar:bool}; narrow = 1 module, wide = `ratio`.
   Anything the symbology cannot carry is dropped rather than fudged, because a
   barcode with a made-up character in it is worse than a shorter one. */
function code39(text,ratio){
  const r=Math.max(2,Math.min(3,ratio||2.5));
  const up=String(text||"").toUpperCase().replace(/[^0-9A-Z\-. $\/+%]/g,"");
  /* nothing left to carry is no barcode at all, not a start and a stop with
     nothing between them — which would scan as an empty string and read as a
     working label that holds no data */
  if(!up.length)return {els:[],text:"",modules:0};
  const chars=("*"+up+"*").split("");
  const out=[];
  for(let c=0;c<chars.length;c++){
    const pat=C39[chars[c]];
    if(!pat)continue;
    for(let i=0;i<9;i++)out.push({w:pat[i]==="1"?r:1,bar:(i%2)===0});
    if(c<chars.length-1)out.push({w:1,bar:false});     // inter-character gap
  }
  return {els:out,text:up,modules:out.reduce((a,e)=>a+e.w,0)};
}

/* ============================ the symbol catalogue ============================
   Every one of these draws into a box running -1..1 on both axes with the
   caller's fill and stroke already set, its own lineWidth in those same units.
   Nothing here knows what colour it is or how big it will be: a symbol is a
   SHAPE, and the frame around it decides whether it is black on yellow, white
   on blue or red on white.

   The geometry is the symbol's own wherever the symbol has one. The radiation
   trefoil really is three 60 degree blades between 1.5 and 5 times the radius
   of the centre disc, with 60 degrees of clear air between them, and drawing
   it that way costs the same as drawing three vague petals. */

function poly(g,pts,close){
  g.beginPath();
  for(let i=0;i<pts.length;i+=2){ if(i)g.lineTo(pts[i],pts[i+1]); else g.moveTo(pts[i],pts[i+1]); }
  if(close!==false)g.closePath();
}
/* an annulus: outer arc one way, inner arc the other, filled nonzero */
function ring(g,cx,cy,r0,r1){
  g.beginPath();
  g.arc(cx,cy,r1,0,TAU,false);
  g.arc(cx,cy,r0,TAU,0,true);
  g.fill();
}
function sector(g,cx,cy,r0,r1,a0,a1){
  g.beginPath();
  g.arc(cx,cy,r1,a0,a1,false);
  g.arc(cx,cy,r0,a1,a0,true);
  g.closePath();g.fill();
}
/* a tapered bar — the exclamation mark's stroke, a blade, a cylinder wall */
function taper(g,x,yTop,yBot,wTop,wBot){
  poly(g,[x-wTop,yTop, x+wTop,yTop, x+wBot,yBot, x-wBot,yBot]);
  g.fill();
}
function dot(g,x,y,r){g.beginPath();g.arc(x,y,r,0,TAU);g.fill();}
function bar(g,x0,y0,x1,y1,w){
  const dx=x1-x0,dy=y1-y0,L=Math.hypot(dx,dy)||1,nx=-dy/L*w*0.5,ny=dx/L*w*0.5;
  poly(g,[x0+nx,y0+ny, x1+nx,y1+ny, x1-nx,y1-ny, x0-nx,y0-ny]);
  g.fill();
}
/* heat / sound / field: n arcs marching away from a source */
function waves(g,cx,cy,r0,dr,n,a0,a1,w){
  g.lineWidth=w;
  for(let i=0;i<n;i++){g.beginPath();g.arc(cx,cy,r0+dr*i,a0,a1);g.stroke();}
}
/* the standing figure used by half the ISO signs: head, shoulders, legs */
function figure(g,cx,cy,s,arms){
  dot(g,cx,cy-0.80*s,0.20*s);
  poly(g,[cx-0.22*s,cy-0.52*s, cx+0.22*s,cy-0.52*s, cx+0.26*s,cy+0.10*s,
          cx+0.06*s,cy+0.10*s, cx+0.06*s,cy+0.92*s, cx-0.10*s,cy+0.92*s,
          cx-0.10*s,cy+0.18*s, cx-0.30*s,cy+0.92*s, cx-0.46*s,cy+0.86*s,
          cx-0.26*s,cy+0.10*s]);
  g.fill();
  if(arms){bar(g,cx-0.20*s,cy-0.42*s,cx-0.62*s,cy-0.10*s,0.16*s);
           bar(g,cx+0.20*s,cy-0.42*s,cx+0.62*s,cy-0.10*s,0.16*s);}
}

const SYM=[
  {id:"none",label:"— nothing —",draw:function(){}},

  /* ---- the two that are themselves a standard ---- */
  {id:"alert",label:"Exclamation — safety alert",draw:function(g){
    taper(g,0,-0.78,0.30,0.155,0.105);
    dot(g,0,0.62,0.155);
  }},
  {id:"bolt",label:"High voltage — lightning bolt",draw:function(g){
    /* IEC 60417-5036: the arrowhead is on the bolt, and the bolt kinks once */
    poly(g,[0.34,-0.95, -0.42,0.06, -0.02,0.06, -0.30,0.95, 0.52,-0.16, 0.10,-0.16]);
    g.fill();
  }},
  {id:"trefoil",label:"Radiation — trefoil (ISO 361)",draw:function(g){
    const R=0.20;                                  /* the centre disc */
    dot(g,0,0,R);
    for(let i=0;i<3;i++){
      const a=-Math.PI/2+i*TAU/3;
      sector(g,0,0,R*1.5,R*5,a-30*DEG,a+30*DEG);
    }
  }},
  {id:"biohazard",label:"Biohazard (ISO 7010 W009)",draw:function(g){
    /* three interlocking rings around a centre, the arms reaching in */
    const d=0.56,ro=0.50,ri=0.27;
    dot(g,0,0,0.20);
    for(let i=0;i<3;i++){
      const a=-Math.PI/2+i*TAU/3,cx=Math.cos(a)*d,cy=Math.sin(a)*d;
      ring(g,cx,cy,ri,ro);
      /* the arm from each ring back toward the centre */
      g.beginPath();
      g.arc(cx,cy,(ri+ro)*0.5,a+Math.PI-0.95,a+Math.PI+0.95);
      g.lineWidth=ro-ri;g.stroke();
      bar(g,cx*0.62,cy*0.62,0,0,ro-ri);
    }
    /* the three open crescents that make it unmistakable */
    g.lineWidth=0.085;
    for(let i=0;i<3;i++){
      const a=Math.PI/2+i*TAU/3;
      g.beginPath();g.arc(Math.cos(a)*0.30,Math.sin(a)*0.30,0.30,a-1.25,a+1.25);g.stroke();
    }
  }},

  /* ---- fire, heat and cold ---- */
  {id:"flame",label:"Flammable — flame",draw:function(g){
    /* a tapered tip leaning over a bulbous base, with a SHALLOW notch down to
       the left lick. Cut the notch deep and the whole thing reads as a
       lightning bolt instead — which is the last thing a flame should read as
       on a label that may also carry one. */
    g.beginPath();
    g.moveTo(0.10,-0.95);
    g.bezierCurveTo(0.45,-0.55,0.58,-0.15,0.55,0.20);   /* the right lobe */
    g.bezierCurveTo(0.52,0.62,0.20,0.92,0.00,0.92);     /* round the base */
    g.bezierCurveTo(-0.35,0.92,-0.58,0.62,-0.52,0.22);
    g.bezierCurveTo(-0.46,-0.06,-0.24,-0.08,-0.16,-0.34);/* up into the left lick */
    g.bezierCurveTo(-0.10,-0.12,0.00,-0.10,0.04,-0.30); /* the shallow valley */
    g.bezierCurveTo(0.07,-0.55,0.08,-0.78,0.10,-0.95);  /* and back up the tip */
    g.closePath();g.fill();
  }},
  {id:"oxidizer",label:"Oxidiser — flame over a circle",draw:function(g){
    g.save();g.translate(0,-0.34);g.scale(0.66,0.62);
    SYM_BY.flame.draw(g);
    g.restore();
    ring(g,0,0.56,0.26,0.40);
    bar(g,-0.62,0.56,0.62,0.56,0.10);
  }},
  {id:"hot",label:"Hot surface (ISO 7010 W017)",draw:function(g){
    bar(g,-0.92,0.84,0.92,0.84,0.20);                       /* the surface */
    /* heat rises in WAVY LINES. Concentric arcs from a point are what a
       transmitter does; over a hot plate they read as a rainbow. */
    g.lineWidth=0.11;g.lineCap="round";
    for(let i=-1;i<=1;i++){
      const x=i*0.46;
      g.beginPath();g.moveTo(x,0.70);
      g.bezierCurveTo(x+0.16,0.46,x-0.16,0.34,x,0.10);
      g.stroke();
    }
    /* and the hand coming down onto it, fingers first */
    g.beginPath();g.moveTo(-0.42,-0.92);
    g.lineTo(0.42,-0.92);g.lineTo(0.42,-0.30);g.lineTo(-0.42,-0.30);
    g.closePath();g.fill();
    for(let i=-1;i<=1;i++)bar(g,i*0.26,-0.30,i*0.26,-0.02,0.15);
  }},
  {id:"cryo",label:"Cryogenic — low temperature",draw:function(g){
    g.lineWidth=0.14;
    for(let i=0;i<3;i++){
      const a=i*TAU/6+Math.PI/2;
      g.beginPath();g.moveTo(-Math.cos(a)*0.92,-Math.sin(a)*0.92);
      g.lineTo(Math.cos(a)*0.92,Math.sin(a)*0.92);g.stroke();
      for(const s of [-1,1])for(const t of [0.42,0.74]){
        const px=Math.cos(a)*t*s,py=Math.sin(a)*t*s;
        g.beginPath();g.moveTo(px,py);
        g.lineTo(px+Math.cos(a+s*2.1)*0.24,py+Math.sin(a+s*2.1)*0.24);g.stroke();
      }
    }
  }},
  {id:"explosive",label:"Explosive — bursting bomb",draw:function(g){
    dot(g,-0.06,0.28,0.42);
    for(let i=0;i<9;i++){
      const a=-Math.PI*0.95+i*0.30;
      bar(g,-0.06+Math.cos(a)*0.34,0.28+Math.sin(a)*0.34,
            -0.06+Math.cos(a)*(0.72+((i%3)*0.13)),0.28+Math.sin(a)*(0.72+((i%3)*0.13)),0.12);
    }
    bar(g,0.18,-0.02,0.62,-0.62,0.13);                      /* the fuse */
    dot(g,0.68,-0.70,0.14);
  }},

  /* ---- chemistry ---- */
  {id:"skull",label:"Acute toxicity — skull and crossbones",draw:function(g){
    bar(g,-0.82,0.86,0.82,0.36,0.17);                       /* the bones, crossed */
    bar(g,-0.82,0.36,0.82,0.86,0.17);
    for(const s of [-1,1]){dot(g,s*0.82,0.34,0.13);dot(g,s*0.82,0.88,0.13);}
    /* the cranium: a dome over a jaw, with the two sockets and the nose cut */
    g.beginPath();
    g.arc(0,-0.24,0.62,Math.PI,0,false);
    g.lineTo(0.48,0.16);g.lineTo(0.30,0.16);g.lineTo(0.30,0.30);
    g.lineTo(-0.30,0.30);g.lineTo(-0.30,0.16);g.lineTo(-0.48,0.16);
    g.closePath();g.fill();
    g.save();g.globalCompositeOperation="destination-out";
    g.fillStyle="#000";
    for(const s of [-1,1])dot(g,s*0.26,-0.26,0.19);
    poly(g,[0,-0.02, 0.13,0.16, -0.13,0.16]);g.fill();
    g.restore();
  }},
  {id:"corrosive",label:"Corrosive — acid on a hand and a plate",draw:function(g){
    /* two test tubes tipped over, what comes out of them, and what it does to
       the two things underneath. Drawn BOLD: at pictogram size a thin outline
       of this reads as two smudges. */
    for(const s of [-1,1]){
      g.save();g.translate(s*0.50,-0.62);g.rotate(s*0.62);
      poly(g,[-0.19,-0.30, 0.19,-0.30, 0.13,0.26, -0.13,0.26]);g.fill();
      g.restore();
      /* the stream, then a drop under it */
      bar(g,s*0.34,-0.30,s*0.30,0.10,0.09);
      dot(g,s*0.29,0.22,0.075);
    }
    /* the plate on the left, with a bite eaten out of it */
    bar(g,-0.92,0.66,-0.10,0.66,0.17);
    poly(g,[-0.62,0.58, -0.46,0.30, -0.30,0.58]);g.fill();
    bar(g,-0.86,0.86,-0.16,0.86,0.10);
    /* the hand on the right, with one eaten too */
    poly(g,[0.14,0.92, 0.14,0.62, 0.26,0.46, 0.40,0.62, 0.42,0.42,
            0.56,0.50, 0.60,0.66, 0.90,0.72, 0.90,0.92]);
    g.fill();
    poly(g,[0.40,0.66, 0.52,0.42, 0.62,0.70]);g.fill();
  }},
  {id:"health",label:"Health hazard — starburst on a torso",draw:function(g){
    poly(g,[-0.54,0.94, -0.54,0.06, -0.30,-0.44, 0.30,-0.44, 0.54,0.06, 0.54,0.94]);
    g.fill();
    dot(g,0,-0.68,0.22);
    g.save();g.globalCompositeOperation="destination-out";g.fillStyle="#000";
    g.beginPath();
    for(let i=0;i<16;i++){
      const a=i*TAU/16-Math.PI/2,r=(i%2)?0.16:0.40;
      const x=Math.cos(a)*r,y=0.26+Math.sin(a)*r;
      i?g.lineTo(x,y):g.moveTo(x,y);
    }
    g.closePath();g.fill();g.restore();
  }},
  {id:"gas",label:"Gas under pressure — cylinder",draw:function(g){
    g.beginPath();
    g.moveTo(-0.34,0.92);g.lineTo(-0.34,-0.34);
    g.quadraticCurveTo(-0.34,-0.66,-0.10,-0.70);
    g.lineTo(-0.10,-0.92);g.lineTo(0.10,-0.92);g.lineTo(0.10,-0.70);
    g.quadraticCurveTo(0.34,-0.66,0.34,-0.34);
    g.lineTo(0.34,0.92);g.closePath();g.fill();
    bar(g,-0.20,-0.80,0.20,-0.80,0.16);
    bar(g,-0.62,0.92,0.62,0.92,0.14);
  }},
  {id:"enviro",label:"Environment — dead fish and tree",draw:function(g){
    /* the tree, bare */
    bar(g,-0.52,0.92,-0.52,0.10,0.14);
    bar(g,-0.52,0.40,-0.86,0.06,0.10);
    bar(g,-0.52,0.30,-0.18,-0.04,0.10);
    bar(g,-0.52,0.10,-0.52,-0.22,0.10);
    /* the fish, belly up */
    g.beginPath();
    g.moveTo(0.86,-0.34);
    g.quadraticCurveTo(0.44,-0.78,0.06,-0.40);
    g.quadraticCurveTo(0.44,-0.02,0.86,-0.34);
    g.closePath();g.fill();
    poly(g,[0.86,-0.34, 1.02,-0.54, 1.02,-0.14]);g.fill();
    g.save();g.globalCompositeOperation="destination-out";g.fillStyle="#000";
    g.lineWidth=0.07;g.strokeStyle="#000";
    g.beginPath();g.moveTo(0.16,-0.48);g.lineTo(0.32,-0.32);g.stroke();
    g.beginPath();g.moveTo(0.32,-0.48);g.lineTo(0.16,-0.32);g.stroke();
    g.restore();
    bar(g,-0.06,0.92,1.02,0.92,0.13);
  }},

  /* ---- energy and machinery ---- */
  {id:"laser",label:"Laser radiation (ANSI Z136)",draw:function(g){
    dot(g,-0.62,0,0.16);
    for(let i=0;i<7;i++){
      const a=(i-3)*0.20;
      bar(g,-0.48,0,-0.48+Math.cos(a)*1.42,Math.sin(a)*1.42,0.085);
    }
  }},
  {id:"rf",label:"Non-ionising radiation — RF",draw:function(g){
    dot(g,0,0.76,0.17);
    bar(g,0,0.76,0,0.20,0.12);
    waves(g,0,0.76,0.40,0.26,3,Math.PI*1.16,Math.PI*1.84,0.12);
  }},
  {id:"magnet",label:"Strong magnetic field",draw:function(g){
    g.lineWidth=0.30;
    g.beginPath();g.arc(0,0.18,0.52,Math.PI,0,false);g.stroke();
    bar(g,-0.52,0.18,-0.52,0.78,0.30);
    bar(g,0.52,0.18,0.52,0.78,0.30);
    g.lineWidth=0.09;
    for(const r of [0.80,1.02]){g.beginPath();g.arc(0,0.18,r,Math.PI*1.08,Math.PI*1.92);g.stroke();}
  }},
  {id:"battery",label:"Battery / stored energy",draw:function(g){
    poly(g,[-0.86,-0.42, 0.86,-0.42, 0.86,0.52, -0.86,0.52]);g.fill();
    g.save();g.globalCompositeOperation="destination-out";g.fillStyle="#000";
    poly(g,[-0.74,-0.30, 0.74,-0.30, 0.74,0.40, -0.74,0.40]);g.fill();g.restore();
    bar(g,-0.46,-0.30,-0.46,0.40,0.20);
    bar(g,0.10,-0.30,0.10,0.40,0.20);
    poly(g,[-0.62,-0.42, -0.30,-0.42, -0.30,-0.62, -0.62,-0.62]);g.fill();
    poly(g,[0.30,-0.42, 0.62,-0.42, 0.62,-0.62, 0.30,-0.62]);g.fill();
  }},
  {id:"crush",label:"Crushing of hands (W024)",draw:function(g){
    bar(g,-0.86,-0.72,0.86,-0.72,0.24);                     /* the platen coming down */
    bar(g,-0.86,0.84,0.86,0.84,0.24);                       /* the bed */
    for(let i=0;i<3;i++)bar(g,-0.52+i*0.52,-0.50,-0.52+i*0.52,-0.10,0.12);
    /* the hand between them */
    poly(g,[-0.22,0.70, -0.22,0.16, -0.06,0.02, 0.10,0.16, 0.14,-0.02,
            0.30,0.06, 0.34,0.24, 0.64,0.34, 0.64,0.70]);
    g.fill();
  }},
  {id:"pinch",label:"Pinch point — rollers (W025)",draw:function(g){
    ring(g,-0.40,-0.30,0.16,0.38);
    ring(g,0.40,-0.30,0.16,0.38);
    bar(g,-0.40,0.10,0.40,0.10,0.14);
    poly(g,[-0.16,0.92, -0.16,0.40, 0.00,0.26, 0.16,0.40, 0.20,0.22,
            0.36,0.30, 0.40,0.48, 0.66,0.56, 0.66,0.92]);
    g.fill();
  }},
  {id:"entangle",label:"Entanglement — rotating parts (W026)",draw:function(g){
    ring(g,-0.36,-0.16,0.12,0.34);
    ring(g,0.46,0.16,0.09,0.24);
    bar(g,-0.36,-0.50,0.46,-0.08,0.09);                     /* the belt */
    bar(g,-0.36,0.18,0.46,0.40,0.09);
    poly(g,[-0.10,0.92, -0.10,0.42, 0.06,0.30, 0.22,0.44, 0.26,0.26,
            0.42,0.34, 0.46,0.52, 0.72,0.60, 0.72,0.92]);
    g.fill();
  }},
  {id:"blade",label:"Sharp element — blade (W022)",draw:function(g){
    poly(g,[-0.86,0.30, 0.34,-0.72, 0.52,-0.50, -0.70,0.52]);g.fill();
    poly(g,[0.34,-0.72, 0.86,-0.88, 0.52,-0.50]);g.fill();
    bar(g,-0.86,0.34,-0.62,0.58,0.26);
  }},
  {id:"suspended",label:"Suspended load (W015)",draw:function(g){
    bar(g,-0.86,-0.86,0.50,-0.86,0.14);                     /* the jib */
    bar(g,0.06,-0.86,0.06,-0.16,0.09);                      /* the fall */
    poly(g,[-0.34,-0.16, 0.46,-0.16, 0.30,0.26, -0.18,0.26]);g.fill();
    bar(g,-0.86,0.92,0.86,0.92,0.14);
    poly(g,[-0.40,0.86, -0.06,0.40, 0.28,0.86]);g.fill();
  }},
  {id:"autostart",label:"Starts automatically",draw:function(g){
    g.lineWidth=0.20;
    g.beginPath();g.arc(0,0.02,0.56,-0.5,Math.PI*1.35);g.stroke();
    poly(g,[0.46,-0.52, 0.94,-0.30, 0.50,0.06]);g.fill();
    dot(g,0,0.02,0.18);
  }},
  {id:"pressure",label:"Pressurised vessel",draw:function(g){
    g.beginPath();g.arc(0,0.22,0.56,0,TAU);g.fill();
    bar(g,0,-0.34,0,-0.74,0.18);
    bar(g,-0.34,-0.74,0.34,-0.74,0.14);
    g.lineWidth=0.10;
    for(let i=0;i<3;i++){const a=-Math.PI/2+(i-1)*0.5;
      g.beginPath();g.moveTo(Math.cos(a)*0.90,-0.74+Math.sin(a)*0.30);
      g.lineTo(Math.cos(a)*1.20,-0.74+Math.sin(a)*0.55);g.stroke();}
  }},
  {id:"forklift",label:"Industrial vehicles (W014)",draw:function(g){
    poly(g,[-0.70,0.44, -0.70,-0.22, -0.30,-0.22, -0.18,-0.62, 0.18,-0.62,
            0.18,0.44]);g.fill();
    ring(g,-0.46,0.62,0.10,0.28);
    ring(g,0.28,0.66,0.07,0.22);
    bar(g,0.34,-0.72,0.34,0.56,0.11);                       /* the mast */
    bar(g,0.34,0.56,0.92,0.56,0.11);                        /* the forks */
    bar(g,0.62,0.10,0.62,0.50,0.09);
  }},
  {id:"slip",label:"Slippery surface (W011)",draw:function(g){
    bar(g,-0.92,0.86,0.92,0.86,0.15);
    /* a figure going over backwards, which is what the sign actually shows */
    dot(g,-0.10,-0.72,0.18);
    bar(g,-0.06,-0.52,0.30,0.16,0.26);
    bar(g,0.30,0.16,0.80,0.44,0.15);
    bar(g,0.24,0.20,-0.30,0.62,0.15);
    bar(g,-0.30,0.62,-0.84,0.56,0.13);
    g.lineWidth=0.10;
    g.beginPath();g.moveTo(-0.62,0.74);g.lineTo(-0.30,0.74);g.stroke();
  }},
  {id:"fall",label:"Drop / fall from height (W008)",draw:function(g){
    bar(g,-0.92,0.04,-0.10,0.04,0.15);                      /* the edge */
    bar(g,-0.10,0.04,-0.10,0.92,0.15);
    dot(g,0.30,-0.62,0.18);
    bar(g,0.34,-0.44,0.52,0.14,0.24);
    bar(g,0.52,0.14,0.92,0.42,0.14);
    bar(g,0.46,0.18,0.20,0.66,0.14);
    bar(g,0.28,-0.28,-0.14,-0.54,0.13);
  }},

  /* ---- what you have to wear, and what you must not do ---- */
  {id:"eye",label:"Eye protection (M004)",draw:function(g){
    g.beginPath();
    g.moveTo(-0.92,-0.18);
    g.quadraticCurveTo(0,-0.58,0.92,-0.18);
    g.quadraticCurveTo(0.96,0.40,0.34,0.40);
    g.quadraticCurveTo(0.06,0.40,0,0.12);
    g.quadraticCurveTo(-0.06,0.40,-0.34,0.40);
    g.quadraticCurveTo(-0.96,0.40,-0.92,-0.18);
    g.closePath();g.fill();
    bar(g,-0.90,-0.22,-1.02,-0.52,0.12);
    bar(g,0.90,-0.22,1.02,-0.52,0.12);
  }},
  {id:"helmet",label:"Head protection (M014)",draw:function(g){
    g.beginPath();g.arc(0,0.14,0.62,Math.PI,0,false);g.closePath();g.fill();
    bar(g,-0.86,0.20,0.86,0.20,0.20);
    bar(g,0,-0.48,0,-0.72,0.14);
    dot(g,0,-0.78,0.12);
  }},
  {id:"glove",label:"Hand protection (M009)",draw:function(g){
    poly(g,[-0.46,0.92, -0.46,0.06, -0.60,-0.20, -0.44,-0.34, -0.26,-0.10,
            -0.26,-0.72, -0.08,-0.84, 0.08,-0.72, 0.08,-0.20,
            0.24,-0.64, 0.42,-0.54, 0.34,-0.10,
            0.52,-0.40, 0.68,-0.26, 0.50,0.22, 0.50,0.92]);
    g.fill();
  }},
  {id:"boot",label:"Foot protection (M008)",draw:function(g){
    poly(g,[-0.62,0.66, -0.62,-0.62, -0.20,-0.62, -0.14,0.06, 0.62,0.30, 0.78,0.66]);
    g.fill();
    bar(g,-0.78,0.80,0.86,0.80,0.24);
  }},
  {id:"mask",label:"Respiratory protection (M017)",draw:function(g){
    g.beginPath();g.arc(0,-0.06,0.66,0,TAU);g.fill();
    g.save();g.globalCompositeOperation="destination-out";g.fillStyle="#000";
    g.beginPath();g.arc(0,-0.20,0.34,0,TAU);g.fill();g.restore();
    bar(g,-0.86,-0.34,-0.62,-0.40,0.16);
    bar(g,0.86,-0.34,0.62,-0.40,0.16);
    g.beginPath();g.arc(0,0.52,0.30,0,TAU);g.fill();
  }},
  {id:"ear",label:"Hearing protection (M003)",draw:function(g){
    dot(g,0,0.06,0.40);
    g.lineWidth=0.22;
    g.beginPath();g.arc(0,0.06,0.66,Math.PI*0.9,Math.PI*2.1);g.stroke();
    bar(g,-0.66,0.06,-0.66,0.56,0.24);
    bar(g,0.66,0.06,0.66,0.56,0.24);
  }},
  {id:"nosmoke",label:"No smoking (P002)",draw:function(g){
    bar(g,-0.78,0.10,0.42,0.10,0.24);
    bar(g,0.52,0.10,0.66,0.10,0.18);
    g.lineWidth=0.10;
    g.beginPath();g.moveTo(-0.52,-0.12);
    g.bezierCurveTo(-0.34,-0.36,-0.62,-0.50,-0.44,-0.78);g.stroke();
    g.beginPath();g.moveTo(-0.14,-0.12);
    g.bezierCurveTo(0.04,-0.36,-0.24,-0.50,-0.06,-0.78);g.stroke();
  }},
  {id:"nohand",label:"Do not touch (P010)",draw:function(g){
    poly(g,[-0.40,0.86, -0.40,0.00, -0.54,-0.26, -0.38,-0.40, -0.20,-0.16,
            -0.20,-0.80, -0.02,-0.92, 0.14,-0.80, 0.14,-0.26,
            0.30,-0.70, 0.48,-0.60, 0.40,-0.16, 0.56,0.28, 0.56,0.86]);
    g.fill();
  }},
  {id:"noentry",label:"No access (P004)",draw:function(g){
    figure(g,0,-0.04,0.86,false);
    bar(g,-0.86,0.90,0.86,0.90,0.16);
  }},

  /* ---- the green ones ---- */
  {id:"exit",label:"Emergency exit (E001)",draw:function(g){
    figure(g,-0.16,-0.06,0.78,false);
    bar(g,0.52,-0.78,0.52,0.90,0.16);                       /* the door jamb */
    bar(g,0.30,0.06,0.86,0.06,0.16);                        /* the arrow */
    poly(g,[0.60,-0.20, 1.00,0.06, 0.60,0.32]);g.fill();
  }},
  {id:"firstaid",label:"First aid (E003)",draw:function(g){
    bar(g,-0.70,0,0.70,0,0.44);
    bar(g,0,-0.70,0,0.70,0.44);
  }},
  {id:"extinguisher",label:"Fire extinguisher (F001)",draw:function(g){
    poly(g,[-0.28,0.92, -0.28,-0.30, -0.10,-0.44, 0.22,-0.44, 0.40,-0.30, 0.40,0.92]);
    g.fill();
    bar(g,0.06,-0.44,0.06,-0.78,0.14);
    bar(g,0.06,-0.78,-0.52,-0.62,0.12);
    poly(g,[-0.52,-0.62, -0.92,-0.40, -0.62,-0.34]);g.fill();
    bar(g,-0.28,0.24,0.40,0.24,0.20);
  }},
  {id:"estop",label:"Emergency stop",draw:function(g){
    ring(g,0,0,0.58,0.82);
    dot(g,0,0,0.40);
  }}
];
const SYM_BY={};for(const s of SYM)SYM_BY[s.id]=s;

/* ============================ stock sizes ============================
   Labels are ordered off a list, not invented, so the list is here. Picking
   one writes the two dimensions and drops the select back to Custom, which
   means you can start from a real size and then pull it about. */
const STOCK=[
  ["custom","Custom — set below"],
  ["25x25","25 × 25 mm — small plant tag"],
  ["50x25","50 × 25 mm — asset label"],
  ["75x50","75 × 50 mm — data plate"],
  ["100x50","100 × 50 mm — ANSI landscape"],
  ["100x100","100 × 100 mm — GHS / square"],
  ["150x75","150 × 75 mm"],
  ["150x150","150 × 150 mm — ISO sign"],
  ["200x100","200 × 100 mm"],
  ["210x148","210 × 148 mm — A5"],
  ["250x250","250 × 250 mm — NFPA 704"],
  ["273x273","273 × 273 mm — hazmat placard"],
  ["300x200","300 × 200 mm"],
  ["300x300","300 × 300 mm — ISO sign, large"],
  ["89x127","89 × 127 mm — ANSI 3.5 × 5 in"],
  ["127x178","127 × 178 mm — ANSI 5 × 7 in"],
  ["178x254","178 × 254 mm — ANSI 7 × 10 in"],
  ["80x150","80 × 150 mm — lockout tag"]
];
const STOCK_MM={};
for(const s of STOCK)if(s[0]!=="custom"){
  const p=s[0].split("x");STOCK_MM[s[0]]=[+p[0],+p[1]];
}

/* ============================ the formats ============================
   `stack` formats flow a column of bands. `block` formats draw one assembly
   whose geometry is the standard's rather than ours, and may carry a
   supplementary text panel under it — which ISO 3864-1 explicitly allows and
   which is how most real signs are made. */
const FORMATS={
  ansi   :{label:"ANSI Z535.4 safety label",   kind:"stack",shape:"round"},
  arc    :{label:"Arc flash label (NFPA 70E)", kind:"stack",shape:"round"},
  plate  :{label:"Equipment data plate",       kind:"stack",shape:"round"},
  tag    :{label:"Lockout / tagout tag",       kind:"stack",shape:"tag"},
  free   :{label:"Free composition",           kind:"stack",shape:"round"},
  iso    :{label:"ISO 7010 / 3864 sign",       kind:"block",shape:"iso"},
  ghs    :{label:"GHS / CLP chemical label",   kind:"block",shape:"round"},
  nfpa   :{label:"NFPA 704 fire diamond",      kind:"block",shape:"diamond"},
  placard:{label:"Hazmat placard (49 CFR)",    kind:"block",shape:"diamond"},
  pipe   :{label:"ASME A13.1 pipe marker",     kind:"block",shape:"rect"}
};
const FORMAT_KEYS=["ansi","iso","ghs","nfpa","arc","placard","pipe","plate","tag","free"];
const fmtOf=P=>FORMATS[P.format]?P.format:"ansi";

/* ISO 3864-1 sign categories: the shape, the colours and the job are one
   choice, because in the standard they are. */
const ISOCAT={
  warn   :{label:"Warning — yellow triangle",       shape:"triangle",bg:ISOC.yellow,fg:ISOC.black,band:ISOC.black,slash:false},
  prohibit:{label:"Prohibition — red circle and bar",shape:"circle", bg:ISOC.white, fg:ISOC.black,band:ISOC.red,  slash:true},
  mandate:{label:"Mandatory — blue disc",           shape:"disc",   bg:ISOC.blue,  fg:ISOC.white,band:ISOC.blue, slash:false},
  safe   :{label:"Safe condition — green square",   shape:"square", bg:ISOC.green, fg:ISOC.white,band:ISOC.green,slash:false},
  fire   :{label:"Fire equipment — red square",     shape:"square", bg:ISOC.red,   fg:ISOC.white,band:ISOC.red,  slash:false}
};

/* ============================ size ============================
   One pure function of the parameters, shared by size(), the readout, plan()
   and the build, so all four agree about how big the thing is. */
function sizeOf(P,forceW){
  const fmt=fmtOf(P);
  let Wmm=Math.max(6,num(P.Wmm,100)),Hmm=Math.max(6,num(P.Hmm,50));

  /* three formats are dimensioned by the standard rather than by the user */
  if(fmt==="placard"){Wmm=Hmm=Math.max(60,num(P.placardMm,PLACARD.side));}
  if(fmt==="pipe"){
    const od=Math.max(8,num(P.pipeOd,114.3));
    const T=a13Of(od);
    Wmm=T.band;                                   /* along the pipe */
    Hmm=(P.pipeWrap==="full")?od*Math.PI:Math.max(25,T.cap*2.4);
  }

  const asked=(forceW|0)||(P.size|0)||1024;
  let TW=asked,TH=Math.max(8,Math.round(TW*Hmm/Wmm/4)*4);
  /* A tall label at 4096 px wide is a 4096 x 12000 texture nobody can hold.
     Cap the LONG axis and give up width for it, then say so in the readout —
     the alternative is an allocation that takes the tab with it. */
  let capped=false;
  if(TH>4096){
    capped=true;TH=4096;TW=Math.max(8,Math.round(4096*Wmm/Hmm/4)*4);
  }
  return {fmt:fmt,Wmm:Wmm,Hmm:Hmm,TW:TW,TH:TH,capped:capped,asked:asked,
          mmPerPx:Wmm/TW,pxPerMm:TW/Wmm,dpi:TW/(Wmm/25.4)};
}

/* The three outlines an ISO sign comes in. A green or red square sign is
   really a RECTANGLE of whatever aspect the sign is, which is why an exit sign
   is twice as wide as it is tall — so it maps to the rectangle here rather
   than to a square that would sit marooned in the middle of the blank. */
function isoShape(cat){
  return (cat.shape==="triangle")?"triangle":(cat.shape==="square"?"rect":"circle");
}

/* the outline the label is cut to */
function shapeOf(P,G){
  let s=str(P.shape,"auto");
  if(s==="auto"){
    s=FORMATS[G.fmt].shape;
    if(s==="iso"){
      s=isoShape(ISOCAT[P.isoCat]||ISOCAT.warn);
      /* a sign with a text panel under it is a rectangle with a sign on it */
      if(P.bMsg)s="round";
    }
  }
  return s;
}

/* ============================ text ============================
   Canvas will not fit text for you, so this does: wrap on words, honour an
   explicit break, and shrink until the block fits the box it was given. It
   returns the size it landed on so the caller can report it — cap height in
   millimetres is a real specification on a real label, and on a pipe marker
   it is THE specification. */
function splitPara(t){
  return String(t==null?"":t).split(/\s*[|\n]\s*/);
}
function measure(g,s,track,px){
  let w=g.measureText(s).width;
  if(track)w+=track*px*Math.max(0,s.length-1);
  return w;
}
function wrapAt(g,words,maxW,track,px){
  const lines=[];
  let cur="";
  for(const w of words){
    const trial=cur?cur+" "+w:w;
    if(cur&&measure(g,trial,track,px)>maxW){lines.push(cur);cur=w;}
    else cur=trial;
  }
  if(cur)lines.push(cur);
  return lines;
}
/* font is a function of px so the caller can pick weight and family */
function fitText(g,text,fontFor,maxW,maxH,maxLines,track,lead){
  const paras=splitPara(text).filter(s=>s.length);
  if(!paras.length)return {px:0,lines:[],lead:0};
  const LEAD=lead||1.16;
  let px=Math.max(1,maxH/Math.max(1,Math.min(maxLines,paras.length))/LEAD);
  let lines=[],guard=0;
  for(;;){
    g.font=fontFor(px);
    lines=[];
    for(const p of paras){
      const ls=wrapAt(g,p.split(/\s+/),maxW,track,px);
      for(const l of ls)lines.push(l);
    }
    const tall=lines.length*px*LEAD;
    let wide=0;
    for(const l of lines)wide=Math.max(wide,measure(g,l,track,px));
    if((lines.length<=maxLines&&tall<=maxH&&wide<=maxW)||px<=1.2||guard++>80)break;
    px*=0.94;
  }
  return {px:px,lines:lines,lead:LEAD};
}
/* Draw with letter tracking. ctx.letterSpacing exists in some browsers and
   not others, and the whole point of a warning label is that the letters are
   spaced the way somebody specified — so it is done by hand, per glyph, off
   the measured advance. */
function drawLine(g,s,x,y,align,track,px){
  if(!track){
    g.textAlign=align;g.fillText(s,x,y);return;
  }
  const w=measure(g,s,track,px);
  let cx=(align==="center")?x-w/2:(align==="right")?x-w:x;
  g.textAlign="left";
  for(const ch of s){
    g.fillText(ch,cx,y);
    cx+=g.measureText(ch).width+track*px;
  }
}
function drawBlock(g,fit,x,y,w,align,track){
  if(!fit.px)return 0;
  const lh=fit.px*fit.lead;
  g.textBaseline="middle";
  for(let i=0;i<fit.lines.length;i++){
    const cy=y+lh*(i+0.5);
    const cx=(align==="center")?x+w/2:(align==="right")?x+w:x;
    drawLine(g,fit.lines[i],cx,cy,align,track,fit.px);
  }
  return fit.lines.length*lh;
}

/* ============================ layout ============================
   Everything from here to the end of paint() works in MILLIMETRES. The
   canvas is scaled by px/mm once, at the top of the artwork pass, and then
   every number in the layout is the number an engineer would write on the
   drawing: a 3 mm cap height is 3 mm, a 0.5 mm keyline is 0.5 mm.

   Arithmetic only — layout() is called by the readout on every keystroke. */

/* the usable rectangle inside a shape: a diamond's is half its diagonals, a
   circle's is its inscribed square, and putting text outside either is how
   you get a label with the first word cut off the corner */
function innerBox(shape,W,H,m){
  let x=m,y=m,w=W-2*m,h=H-2*m;
  if(shape==="diamond"){x=W*0.25+m*0.5;y=H*0.25+m*0.5;w=W*0.5-m;h=H*0.5-m;}
  else if(shape==="circle"){const k=1/Math.SQRT2;x=W*(1-k)/2+m;y=H*(1-k)/2+m;w=W*k-2*m;h=H*k-2*m;}
  else if(shape==="triangle"){/* the biggest rectangle in an apex-up triangle
       sits on the base and reaches half way up */
    x=W*0.25+m;y=H*0.5;w=W*0.5-2*m;h=H*0.5-m;}
  else if(shape==="octagon"){const k=0.86;x=W*(1-k)/2+m;y=H*(1-k)/2+m;w=W*k-2*m;h=H*k-2*m;}
  else if(shape==="tag"){y=H*0.14+m;h=H*0.86-2*m;}   /* the grommet end is not for text */
  return {x:x,y:y,w:Math.max(1,w),h:Math.max(1,h)};
}

/* how many table rows the format is going to want, which is what decides how
   much of the label the table gets */
function tableRows(P,fmt){
  const rows=[];
  const push=(k,v)=>{if(str(v,"").length||str(k,"").length)rows.push([str(k,""),str(v,"")]);};
  if(fmt==="arc"){
    /* NFPA 70E 130.5(H): the label has to carry the nominal voltage, and
       either the incident energy at a stated working distance or the PPE
       category — plus the two boundaries. These are those fields. */
    push("Nominal voltage",P.afVolt);
    push("Arc flash boundary",P.afBound);
    push("Incident energy",P.afEnergy);
    push("Working distance",P.afDist);
    push("PPE category",P.afPpe);
    push("Limited / restricted",P.afShock);
    push("Equipment",P.afEquip);
  }else{
    for(let i=1;i<=6;i++){
      const t=str(P["row"+i],"");
      if(!t.length)continue;
      const bar=t.indexOf("|");
      if(bar<0)rows.push(["",t]);
      else rows.push([t.slice(0,bar).trim(),t.slice(bar+1).trim()]);
    }
  }
  return rows;
}

/* the pictogram cells: what each one is and where it came from */
function pictoCells(P){
  const out=[];
  /* Switching the cells off has to empty this list rather than just hide the
     band: a placard and an ISO sign take their symbol from cell one, and a
     cell left loaded from the last preset would quietly put a lightning bolt
     on a flammable liquid placard. */
  if(!P.bPicto)return out;
  const n=clamp(P.nPicto|0,0,4);
  for(let i=1;i<=n;i++){
    const id=str(P["sym"+i],"none");
    const gl=str(P["gly"+i],"");
    if(id==="glyph")out.push({glyph:true,text:gl||"?",id:"glyph"});
    else if(id!=="none"&&SYM_BY[id])out.push({glyph:false,id:id,sym:SYM_BY[id]});
    else if(id==="none")out.push({glyph:false,id:"none",sym:SYM_BY.none});
  }
  return out;
}

/* A fixing hole is a hole in the ARTWORK as much as in the material, and
   nothing may be laid out under one — which is why every data plate has its
   printing pulled in past the corner holes. Each hole pushes the nearest edge
   of the content box past itself. */
function clearHoles(box,holes,clear){
  let x0=box.x,y0=box.y,x1=box.x+box.w,y1=box.y+box.h;
  const cx=(x0+x1)*0.5,cy=(y0+y1)*0.5;
  for(const h of holes){
    const r=h[2]*0.5+clear;
    if(h[0]-r<x0+box.w*0.34&&h[0]<cx)x0=Math.max(x0,h[0]+r);
    else if(h[0]+r>x1-box.w*0.34&&h[0]>cx)x1=Math.min(x1,h[0]-r);
    if(h[1]-r<y0+box.h*0.34&&h[1]<cy)y0=Math.max(y0,h[1]+r);
    else if(h[1]+r>y1-box.h*0.34&&h[1]>cy)y1=Math.min(y1,h[1]-r);
  }
  return {x:x0,y:y0,w:Math.max(1,x1-x0),h:Math.max(1,y1-y0)};
}
/* The shape a block format's own sign is: when the label has been cut to that
   same shape, the sign IS the label and gets the whole blank. Inscribing it in
   the shape's inner box instead — which is what a text band needs — draws a
   fire diamond a quarter of the size of the placard it is printed on. */
function signShapeOf(P,fmt){
  if(fmt==="nfpa"||fmt==="placard"||fmt==="ghs")return "diamond";
  if(fmt==="iso")return isoShape(ISOCAT[P.isoCat]||ISOCAT.warn);
  return "rect";
}

function layout(P,G){
  G=G||sizeOf(P);
  const fmt=G.fmt,W=G.Wmm,H=G.Hmm;
  const shape=shapeOf(P,G);
  const margin=clamp(num(P.marginMm,3),0,Math.min(W,H)*0.3);
  const border=clamp(num(P.borderMm,0.6),0,6);
  const holes=holesOf(P,G);
  const clear=Math.max(0.6,Math.min(W,H)*0.01);
  let box=clearHoles(innerBox(shape,W,H,margin+border),holes,clear);
  const L={fmt:fmt,shape:shape,W:W,H:H,margin:margin,border:border,box:box,
           corner:clamp(num(P.cornerMm,3),0,Math.min(W,H)*0.5),
           cells:pictoCells(P),rows:tableRows(P,fmt),bands:{},block:null,holes:holes};

  if(FORMATS[fmt].kind==="block"){
    /* the sign's own ground, before the text panel is taken out of it */
    if(shape===signShapeOf(P,fmt))
      box=clearHoles({x:margin+border,y:margin+border,
                      w:Math.max(1,W-2*(margin+border)),h:Math.max(1,H-2*(margin+border))},
                     holes,clear);
    L.box=box;
    /* a block format owns its own geometry; all layout decides is how much of
       the label is sign and how much is the text panel under it */
    const wantMsg=!!P.bMsg&&(fmt!=="nfpa");
    const wantFoot=!!P.bFoot;
    const footH=wantFoot?Math.min(box.h*0.22,Math.max(2.4,num(P.footMm,4))):0;
    let msgH=0;
    if(wantMsg){
      const auto=(fmt==="ghs")?box.h*0.62:box.h*0.34;
      msgH=Math.min(box.h*0.8,num(P.msgMm,0)>0?num(P.msgMm,0):auto);
    }
    const blockH=Math.max(4,box.h-msgH-footH);
    if(fmt==="ghs"&&wantMsg&&P.ghsSide){
      /* the pictogram beside the wording rather than over it, which is how a
         drum label with room for eight hazard statements is really set */
      const bw=Math.min(box.w*0.46,box.h);
      L.block={x:box.x,y:box.y,w:bw,h:box.h-footH};
      L.bands.msg={x:box.x+bw+margin*0.6,y:box.y,w:box.w-bw-margin*0.6,h:box.h-footH};
    }else{
      L.block={x:box.x,y:box.y,w:box.w,h:blockH};
      if(wantMsg)L.bands.msg={x:box.x,y:box.y+blockH,w:box.w,h:msgH};
    }
    if(wantFoot)L.bands.foot={x:box.x,y:box.y+box.h-footH,w:box.w,h:footH};
    return L;
  }

  /* ---- the stack ---- */
  const on={hdr:!!P.bHeader,pic:!!P.bPicto&&L.cells.length>0,msg:!!P.bMsg,
            tbl:!!P.bTable&&L.rows.length>0,bar:!!P.bBar&&str(P.barData,"").length>0,
            foot:!!P.bFoot&&str(P.footText,"").length>0};
  const pos=str(P.pictoPos,"row");
  const gap=Math.max(0.4,num(P.gapMm,1.6));

  /* natural heights, before anything is asked to give way */
  const autoHdr=(fmt==="plate")?box.h*0.20:(fmt==="tag"?box.h*0.22:box.h*0.26);
  let hHdr=on.hdr?(num(P.hdrMm,0)>0?num(P.hdrMm,0):autoHdr):0;
  /* A pictogram band's automatic height depends on whether there is anything
     else to say. Half the label is right for a sign that is only a symbol and
     wrong for one carrying a message — at half, the fixed bands on a crowded
     label add up to more than the height and the message is the one squeezed
     out, which is precisely backwards. */
  let hPic=(on.pic&&pos==="row")
    ?(num(P.pictoMm,0)>0?num(P.pictoMm,0)
      :Math.min(box.h*(on.msg?0.32:0.52),box.w/Math.max(1,L.cells.length)))
    :0;
  const rowMm=num(P.rowMm,0)>0?num(P.rowMm,0):Math.min(7,box.h*0.13);
  let hTbl=on.tbl?rowMm*L.rows.length:0;
  let hBar=on.bar?(num(P.barMm,0)>0?num(P.barMm,0):box.h*0.18):0;
  let hFoot=on.foot?Math.max(2,num(P.footMm,4)):0;

  const nGap=(on.hdr?1:0)+(hPic>0?1:0)+(on.msg?1:0)+(on.tbl?1:0)+(on.bar?1:0)+(on.foot?1:0);
  const gaps=gap*Math.max(0,nGap-1);
  let fixed=hHdr+hPic+hTbl+hBar+hFoot;
  let avail=box.h-gaps;
  let hMsg=0;

  if(fixed>avail&&fixed>0){
    /* no room: everything gives way in proportion rather than the last band
       falling off the bottom edge */
    const k=avail/fixed;
    hHdr*=k;hPic*=k;hTbl*=k;hBar*=k;hFoot*=k;fixed=avail;
  }else if(on.msg){
    hMsg=avail-fixed;
  }else if(hTbl>0){
    /* a data plate with no message block: the rows take the slack, which is
       what a real plate does — it does not leave the bottom third blank */
    hTbl=Math.min(hTbl*2.2,hTbl+(avail-fixed));
  }else if(hHdr>0){
    hHdr=Math.min(hHdr*2.4,hHdr+(avail-fixed));
  }

  let y=box.y;
  const put=(k,h)=>{if(h<=0)return;L.bands[k]={x:box.x,y:y,w:box.w,h:h};y+=h+gap;};
  put("hdr",hHdr);
  put("pic",hPic);
  if(hMsg>0.5){
    /* the pictogram may stand beside the message instead of over it */
    if(on.pic&&(pos==="left"||pos==="right")){
      const pw=Math.min(box.w*0.42,Math.max(hMsg,box.w*0.14));
      const mx=(pos==="left")?box.x+pw+gap:box.x;
      L.bands.pic={x:(pos==="left")?box.x:box.x+box.w-pw,y:y,w:pw,h:hMsg};
      L.bands.msg={x:mx,y:y,w:box.w-pw-gap,h:hMsg};
    }else{
      L.bands.msg={x:box.x,y:y,w:box.w,h:hMsg};
    }
    y+=hMsg+gap;
  }
  put("tbl",hTbl);
  put("bar",hBar);
  put("foot",hFoot);
  /* a pictogram asked for inside the header rides in the header band */
  if(on.pic&&pos==="header"&&L.bands.hdr)L.bands.picIn=L.bands.hdr;
  return L;
}

/* ============================ the outline ============================
   One path routine for every shape the label can be cut to, used twice: once
   to rasterise the silhouette that becomes the alpha channel, and once to
   stroke the keyline just inside it. Two uses of one path is the only way the
   printed border and the cut edge stay parallel. */
function rr(g,x,y,w,h,r){
  r=Math.max(0,Math.min(r,Math.min(w,h)*0.5));
  g.beginPath();
  g.moveTo(x+r,y);
  g.arcTo(x+w,y,x+w,y+h,r);
  g.arcTo(x+w,y+h,x,y+h,r);
  g.arcTo(x,y+h,x,y,r);
  g.arcTo(x,y,x+w,y,r);
  g.closePath();
}
function shapePath(g,shape,x,y,w,h,r){
  if(shape==="round"){rr(g,x,y,w,h,r);return;}
  if(shape==="circle"){g.beginPath();g.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,TAU);return;}
  if(shape==="diamond"){
    /* rounded on point: a rhombus whose corners are radiused takes ink the way
       a real die-cut diamond does, and a sharp point is the first thing to lift */
    const cx=x+w/2,cy=y+h/2;
    const pts=[[cx,y],[x+w,cy],[cx,y+h],[x,cy]];
    roundPoly(g,pts,r*0.9);return;
  }
  if(shape==="triangle"){
    const pts=[[x+w/2,y],[x+w,y+h],[x,y+h]];
    roundPoly(g,pts,r*0.9);return;
  }
  if(shape==="octagon"){
    const k=0.2929*Math.min(w,h);
    roundPoly(g,[[x+k,y],[x+w-k,y],[x+w,y+k],[x+w,y+h-k],
                 [x+w-k,y+h],[x+k,y+h],[x,y+h-k],[x,y+k]],r*0.5);return;
  }
  if(shape==="tag"){
    /* a hang tag: the two corners at the grommet end taken off, which is what
       stops a tag tearing off the wire */
    const c=Math.min(w,h)*0.16;
    roundPoly(g,[[x+c,y],[x+w-c,y],[x+w,y+c],[x+w,y+h-r*0.2],
                 [x+w,y+h],[x,y+h],[x,y+c]],Math.min(r,c*0.7));return;
  }
  g.beginPath();g.rect(x,y,w,h);
}
/* a polygon with radiused corners, which every one of the shapes above wants */
function roundPoly(g,pts,r){
  const n=pts.length;
  g.beginPath();
  if(r<=0.001){
    for(let i=0;i<n;i++)i?g.lineTo(pts[i][0],pts[i][1]):g.moveTo(pts[0][0],pts[0][1]);
    g.closePath();return;
  }
  for(let i=0;i<n;i++){
    const p0=pts[(i-1+n)%n],p1=pts[i],p2=pts[(i+1)%n];
    const a=Math.hypot(p1[0]-p0[0],p1[1]-p0[1]),b=Math.hypot(p2[0]-p1[0],p2[1]-p1[1]);
    const ra=Math.min(r,a*0.48,b*0.48);
    const sx=p1[0]+(p0[0]-p1[0])/a*ra,sy=p1[1]+(p0[1]-p1[1])/a*ra;
    if(i===0)g.moveTo(sx,sy);else g.lineTo(sx,sy);
    g.arcTo(p1[0],p1[1],p2[0],p2[1],ra);
  }
  g.closePath();
}

/* where the fixing holes are, in mm, so the silhouette and the readme agree */
function holesOf(P,G){
  const kind=str(P.holes,"none");
  if(kind==="none")return [];
  const d=clamp(num(P.holeMm,4),0.5,Math.min(G.Wmm,G.Hmm)*0.4);
  const inm=clamp(num(P.holeInMm,6),d*0.6,Math.min(G.Wmm,G.Hmm)*0.45);
  const W=G.Wmm,H=G.Hmm,out=[];
  if(kind==="h2"){out.push([inm,H/2,d],[W-inm,H/2,d]);}
  else if(kind==="h2v"){out.push([W/2,inm,d],[W/2,H-inm,d]);}
  else if(kind==="h4"){out.push([inm,inm,d],[W-inm,inm,d],[inm,H-inm,d],[W-inm,H-inm,d]);}
  else if(kind==="grommet"){out.push([W/2,inm,d]);}
  return out;
}

/* ============================ type ============================
   No face is bundled — see forge-fonts.js — so a label falls back to whatever
   the browser has under a generic family, and the stacks below name the faces
   a real label is set in first. A loaded face beats all of it. */
const STACKS={
  grot  :'"Helvetica Neue",Helvetica,Arial,"Liberation Sans",sans-serif',
  cond  :'"Arial Narrow","Liberation Sans Narrow","Helvetica Neue Condensed",Impact,sans-serif',
  din   :'"DIN Alternate","DIN Condensed","Roboto Condensed",Verdana,sans-serif',
  humane:'"Segoe UI",Roboto,"Noto Sans","DejaVu Sans",sans-serif',
  mono  :'"DejaVu Sans Mono",Menlo,Consolas,"Courier New",monospace',
  serif :'Georgia,"Times New Roman",Times,serif'
};
function stackOf(P){
  const base=STACKS[P.typeface]||STACKS.grot;
  const face=window.ForgeFonts?ForgeFonts.resolve(P.faceId):null;
  return face?('"'+face.css+'",'+base):base;
}
/* Symbols come from the same place as the words when the cell is a glyph, and
   a symbol font is the more likely to have the code point. */
const SYMSTACK='"Apple Symbols","Segoe UI Symbol","Noto Sans Symbols2","Noto Sans Symbols",'+
               '"DejaVu Sans","Symbola",sans-serif';

/* cap height is what a standard specifies; em is what canvas takes. 0.72 is
   close for every grotesque a label is ever set in. */
const CAP=0.72;
const fontFor=(stack,weight)=>px=>weight+" "+px+"px "+stack;

/* ============================ how it was applied ============================ */
function styleOf(P){
  const M=markOf(P),mat=matOf(P);
  return {mark:M,mat:mat,
          fields:P.fieldInk!==false,
          markCol:M.fromCore?mat.core:null,
          depth:M.depth*clamp(num(P.markDepth,1),0,4)};
}

/* ============================ the artwork ============================
   Drawn twice from one routine: once in colour for the base map, and once as
   a white-on-black MASK of the marks alone, which is what becomes relief on
   an engraved, etched or embossed plate. Two passes of one routine rather
   than two routines is the only way the paint and the groove stay aligned. */
function painter(g,P,G,mask){
  const ST=styleOf(P);
  return {
    g:g,mask:mask,st:ST,stack:stackOf(P),
    /* a FIELD is a solid area of colour: the signal bar, the yellow of a
       triangle, the red of a placard. It is never relief — you print a field,
       you do not engrave one. */
    field:function(c){
      if(mask||!ST.fields)return false;
      g.fillStyle=c;g.strokeStyle=c;return true;
    },
    /* a MARK is a letter, a rule, a symbol: the thing the process actually
       applies. On a cut or etched plate it takes the colour of whatever is
       under the face, because that is what the tool exposes. */
    mark:function(c){
      g.fillStyle=mask?"#fff":(ST.markCol||c);
      g.strokeStyle=g.fillStyle;return true;
    },
    /* a counter knocked OUT of a mark — the exclamation inside the alert
       triangle. In colour it is painted in the field colour; in the mask, and
       on a plate with no printed field, it is removed rather than painted,
       or the groove would have no bottom. */
    knock:function(c){
      if(mask||!ST.fields){g.globalCompositeOperation="destination-out";g.fillStyle="#000";}
      else {g.fillStyle=c;}
      g.strokeStyle=g.fillStyle;
    },
    knockEnd:function(){g.globalCompositeOperation="source-over";}
  };
}

/* one line or block of type, fitted to a box and told what it landed on */
function typeset(A,text,x,y,w,h,o){
  o=o||{};
  const g=A.g;
  const stack=o.stack||A.stack;
  const ff=fontFor(stack,o.weight||"700");
  const t=o.caps?String(text==null?"":text).toUpperCase():text;
  const fit=fitText(g,t,ff,w,h,o.lines||3,o.track||0,o.lead);
  if(!fit.px)return fit;
  A.mark(o.col||"#000000");
  g.font=ff(fit.px);
  const used=fit.lines.length*fit.px*fit.lead;
  const oy=(o.valign==="top")?0:(o.valign==="bottom"?(h-used):(h-used)*0.5);
  drawBlock(g,fit,x,y+oy,w,o.align||"center",o.track||0);
  fit.capMm=fit.px*CAP;
  return fit;
}

/* a symbol, vector or glyph, centred on (cx,cy) inside a box of half-size R */
function drawSymbol(A,cell,cx,cy,R,col){
  const g=A.g;
  if(!cell||cell.id==="none")return;
  A.mark(col);
  if(cell.glyph){
    /* the glyph is measured and then fitted, because a browser's idea of how
       much of the em a symbol fills varies wildly between one code point and
       the next — an emoji fills it, a dingbat rattles around inside it */
    let px=R*2;
    g.textAlign="center";g.textBaseline="alphabetic";
    g.font="400 "+px+"px "+SYMSTACK;
    const m=g.measureText(cell.text);
    const asc=m.actualBoundingBoxAscent,des=m.actualBoundingBoxDescent,
          lf=m.actualBoundingBoxLeft,rt=m.actualBoundingBoxRight;
    if(isFinite(asc)&&isFinite(des)&&(asc+des)>0.001&&isFinite(lf)&&isFinite(rt)){
      const gw=Math.abs(lf)+Math.abs(rt),gh=asc+des;
      const k=Math.min((R*2)/Math.max(gw,1e-6),(R*2)/Math.max(gh,1e-6));
      px*=k;
      g.font="400 "+px+"px "+SYMSTACK;
      const m2=g.measureText(cell.text);
      const cy2=cy+(m2.actualBoundingBoxAscent-m2.actualBoundingBoxDescent)*0.5;
      const cx2=cx-(m2.actualBoundingBoxRight-Math.abs(m2.actualBoundingBoxLeft))*0.5;
      g.fillText(cell.text,cx2,cy2);
    }else{
      g.textBaseline="middle";g.fillText(cell.text,cx,cy);
    }
    return;
  }
  g.save();
  g.translate(cx,cy);g.scale(R,R);
  g.lineJoin="round";g.lineCap="round";g.lineWidth=0.12;
  cell.sym.draw(g,1);
  g.restore();
}

/* ---- the ISO geometries, which every frame in the app shares ---- */
/* an apex-up triangle fitted to a box, with the ISO band inside its edge */
function isoTriangle(A,P,cx,cy,side,bandFrac,bg,band){
  const g=A.g;
  const h=side*SQ3/2;
  const r=side*0.085;
  const top=cy-h*0.5,bot=cy+h*0.5;
  if(A.field(band)||A.mask){
    A.mask?A.mark(band):0;
    roundPoly(g,[[cx,top],[cx+side/2,bot],[cx-side/2,bot]],r);
    g.fill();
  }
  const k=1-bandFrac*2.6;                 /* the inner triangle, same centroid */
  if(A.field(bg)){
    roundPoly(g,[[cx,cy+(top-cy)*k],[cx+side*k/2,cy+(bot-cy)*k],[cx-side*k/2,cy+(bot-cy)*k]],r*k);
    g.fill();
  }else if(A.mask){
    /* no field to put the band on, so the band is the mark: take the middle
       back out and what is left is an outline of the right width */
    g.globalCompositeOperation="destination-out";g.fillStyle="#000";
    roundPoly(g,[[cx,cy+(top-cy)*k],[cx+side*k/2,cy+(bot-cy)*k],[cx-side*k/2,cy+(bot-cy)*k]],r*k);
    g.fill();
    g.globalCompositeOperation="source-over";
  }
  /* the symbol sits on the centroid of the inner triangle, not on the middle
     of its bounding box — which is a third of the way up and is the single
     most visible thing about a triangle sign drawn wrong */
  return {cx:cx,cy:cy+h*(1/6),R:side*0.20};
}
function isoCircle(A,P,cx,cy,d,cat){
  const g=A.g;
  const R=d*0.5;
  if(cat.slash){
    if(A.field("#ffffff")){g.beginPath();g.arc(cx,cy,R,0,TAU);g.fill();}
    if(A.field(cat.band)||A.mask){
      A.mask?A.mark(cat.band):0;
      g.beginPath();g.arc(cx,cy,R,0,TAU,false);g.arc(cx,cy,R*0.8,TAU,0,true);g.fill();
    }
  }else if(A.field(cat.bg)||A.mask){
    A.mask?A.mark(cat.bg):0;
    g.beginPath();g.arc(cx,cy,R,0,TAU);g.fill();
  }
  return {cx:cx,cy:cy,R:R*(cat.slash?0.58:0.62)};
}
/* the bar goes ON TOP of the symbol — that is the whole point of it */
function isoBar(A,cat,cx,cy,d){
  if(!cat.slash)return;
  const g=A.g,R=d*0.5;
  A.mask?A.mark(cat.band):(A.field(cat.band)||A.mark(cat.band));
  g.save();g.translate(cx,cy);g.rotate(-45*DEG);
  g.fillRect(-R*0.8,-R*0.1,R*1.6,R*0.2);
  g.restore();
}
/* the GHS frame: a square on point with a red border of a twelfth of its side */
function ghsDiamond(A,P,cx,cy,diag,border){
  const g=A.g;
  const b=border||diag*0.062;
  const pts=d=>[[cx,cy-d],[cx+d,cy],[cx,cy+d],[cx-d,cy]];
  const red=str(P.cGhs,"")||"#c8102e";
  if(A.field(red)||A.mask){
    A.mask?A.mark(red):0;
    roundPoly(g,pts(diag*0.5),diag*0.04);g.fill();
  }
  const inD=diag*0.5-b*Math.SQRT2;
  if(A.field(str(P.cPanel,"")||"#ffffff")){roundPoly(g,pts(inD),diag*0.02);g.fill();}
  else if(A.mask){
    g.globalCompositeOperation="destination-out";g.fillStyle="#000";
    roundPoly(g,pts(inD),diag*0.02);g.fill();
    g.globalCompositeOperation="source-over";
  }
  return {cx:cx,cy:cy,R:inD*0.56};
}

/* black or white, whichever can be read on that colour. Used for placard
   numerals, NFPA ratings and any signal word whose panel has been recoloured
   — a legibility rule is better than a colour control nobody remembers. */
function inkOn(hex){
  const c=hex2rgb(hex||"#ffffff");
  const l=(0.2126*c[0]+0.7152*c[1]+0.0722*c[2])/255;
  return l>0.52?"#111111":"#ffffff";
}

/* 49 CFR 172 subpart F: the class placards, their colours and what goes on
   them. Stripes are class 4.1 and class 9, and they are vertical. */
const DOTC={
  "1"  :{label:"Explosive",                top:"#e87722",bot:"#e87722",sym:"explosive",num:"1"},
  "2.1":{label:"Flammable gas",            top:"#c8102e",bot:"#c8102e",sym:"flame",    num:"2"},
  "2.2":{label:"Non-flammable gas",        top:"#00843d",bot:"#00843d",sym:"gas",      num:"2"},
  "2.3":{label:"Toxic gas",                top:"#ffffff",bot:"#ffffff",sym:"skull",    num:"2"},
  "3"  :{label:"Flammable liquid",         top:"#c8102e",bot:"#c8102e",sym:"flame",    num:"3"},
  "4.1":{label:"Flammable solid",          top:"#ffffff",bot:"#ffffff",sym:"flame",    num:"4",stripes:"#c8102e"},
  "4.2":{label:"Spontaneously combustible",top:"#ffffff",bot:"#c8102e",sym:"flame",    num:"4"},
  "4.3":{label:"Dangerous when wet",       top:"#00539b",bot:"#00539b",sym:"flame",    num:"4"},
  "5.1":{label:"Oxidiser",                 top:"#f6be00",bot:"#f6be00",sym:"oxidizer", num:"5.1"},
  "5.2":{label:"Organic peroxide",         top:"#c8102e",bot:"#f6be00",sym:"flame",    num:"5.2"},
  "6.1":{label:"Toxic",                    top:"#ffffff",bot:"#ffffff",sym:"skull",    num:"6"},
  "7"  :{label:"Radioactive",              top:"#f6be00",bot:"#ffffff",sym:"trefoil",  num:"7"},
  "8"  :{label:"Corrosive",                top:"#ffffff",bot:"#111111",sym:"corrosive",num:"8"},
  "9"  :{label:"Miscellaneous",            top:"#ffffff",bot:"#ffffff",sym:"none",     num:"9",stripes:"#111111"}
};

/* the ANSI safety alert symbol: a triangle in the word's own colour with the
   exclamation taken back out of it */
function alertMark(A,cx,cy,side,fg,bg){
  const g=A.g,h=side*SQ3/2;
  A.mark(fg);
  roundPoly(g,[[cx,cy-h*0.5],[cx+side*0.5,cy+h*0.5],[cx-side*0.5,cy+h*0.5]],side*0.11);
  g.fill();
  A.knock(bg);
  g.save();
  g.translate(cx,cy+h*0.15);g.scale(side*0.26,side*0.26);
  SYM_BY.alert.draw(g);
  g.restore();
  A.knockEnd();
}

/* ---- a pictogram cell: a frame from the standards, and a symbol in it ---- */
function paintCell(A,P,kind,cx,cy,w,h,cell){
  const g=A.g;
  const s=Math.min(w,h);
  if(kind==="triangle"){
    const side=Math.min(w,h*2/SQ3);
    const t=isoTriangle(A,P,cx,cy,side,0.085,ISOC.yellow,ISOC.black);
    drawSymbol(A,cell,t.cx,t.cy,t.R,ISOC.black);
  }else if(kind==="bar"){
    const c=isoCircle(A,P,cx,cy,s,ISOCAT.prohibit);
    drawSymbol(A,cell,c.cx,c.cy,c.R,ISOC.black);
    isoBar(A,ISOCAT.prohibit,cx,cy,s);
  }else if(kind==="disc"){
    const c=isoCircle(A,P,cx,cy,s,ISOCAT.mandate);
    drawSymbol(A,cell,c.cx,c.cy,c.R,ISOC.white);
  }else if(kind==="square"||kind==="fire"){
    const col=(kind==="fire")?ISOC.red:ISOC.green;
    if(A.field(col)||A.mask){A.mask?A.mark(col):0;rr(g,cx-s/2,cy-s/2,s,s,s*0.06);g.fill();}
    drawSymbol(A,cell,cx,cy,s*0.36,ISOC.white);
  }else if(kind==="diamond"){
    const d=ghsDiamond(A,P,cx,cy,s);
    drawSymbol(A,cell,d.cx,d.cy,d.R,ISOC.black);
  }else if(kind==="box"){
    const col=str(P.cSym,"")||"#111111";
    if(A.field(col)||A.mask){A.mask?A.mark(col):0;rr(g,cx-w/2,cy-h/2,w,h,Math.min(w,h)*0.14);g.fill();}
    drawSymbol(A,cell,cx,cy,s*0.36,inkOn(col));
  }else{
    drawSymbol(A,cell,cx,cy,s*0.46,str(P.cSym,"")||"#111111");
  }
}
function paintCells(A,P,L,b){
  if(!b||!L.cells.length)return;
  const n=L.cells.length;
  const kind=str(P.pFrame,"none");
  const cw=b.w/n;
  for(let i=0;i<n;i++)
    paintCell(A,P,kind,b.x+cw*(i+0.5),b.y+b.h*0.5,cw*0.94,b.h,L.cells[i]);
}

/* ---- the bands of a stacked label ---- */
function paintHeader(A,P,L,G){
  const b=L.bands.hdr;if(!b)return;
  const g=A.g;
  const S=SIGNAL[P.signal]||SIGNAL.danger;
  const bg=str(P.cSignal,"")||S.bg;
  const fg=str(P.cSignalFg,"")||(P.cSignal?inkOn(P.cSignal):S.fg);
  if(A.field(bg))g.fillRect(b.x,b.y,b.w,b.h);
  const pad=Math.min(b.h*0.14,b.w*0.04);
  let x=b.x+pad,w=b.w-pad*2;
  if(P.alertSym&&S.alert){
    const side=Math.min(b.h*0.80,b.w*0.3);
    alertMark(A,x+side*0.5,b.y+b.h*0.5,side,fg,bg);
    x+=side+pad;w-=side+pad;
  }
  /* the pictogram may ride in the header, at the other end from the alert */
  if(L.bands.picIn){
    const pw=Math.min(b.h*0.92*L.cells.length,w*0.32);
    paintCells(A,P,L,{x:b.x+b.w-pad-pw,y:b.y+b.h*0.04,w:pw,h:b.h*0.92});
    w-=pw+pad;
  }
  const word=str(P.signalText,"")||S.word;
  if(word&&w>0.5)
    typeset(A,word,x,b.y+b.h*0.08,w,b.h*0.84,
      {col:fg,weight:"800",caps:true,lines:1,align:str(P.hdrAlign,"left"),
       track:num(P.trackHdr,0.04)});
}
function paintMsg(A,P,L,b){
  if(!b)return;
  const head=str(P.msgHead,""),body=str(P.msgBody,"");
  const col=str(P.cText,"")||"#111111";
  const align=str(P.msgAlign,"center");
  const pad=Math.min(b.h*0.05,1.5);
  let y=b.y+pad,h=b.h-pad*2;
  if(head.length&&body.length){
    const hh=h*clamp(num(P.headFrac,0.42),0.15,0.8);
    typeset(A,head,b.x,y,b.w,hh,{col:col,weight:"800",caps:!!P.msgCaps,align:align,
                                 lines:2,track:num(P.trackMsg,0.01)});
    typeset(A,body,b.x,y+hh,b.w,h-hh,{col:col,weight:"400",align:align,
                                      lines:6,track:num(P.trackMsg,0.01),lead:1.22});
  }else if(head.length){
    typeset(A,head,b.x,y,b.w,h,{col:col,weight:"800",caps:!!P.msgCaps,align:align,
                                lines:3,track:num(P.trackMsg,0.01)});
  }else if(body.length){
    typeset(A,body,b.x,y,b.w,h,{col:col,weight:"400",align:align,lines:8,
                                track:num(P.trackMsg,0.01),lead:1.22});
  }
}
function paintTable(A,P,L,b){
  if(!b||!L.rows.length)return;
  const g=A.g,n=L.rows.length,rh=b.h/n;
  const col=str(P.cText,"")||"#111111";
  const split=clamp(num(P.tblSplit,0.42),0.12,0.88);
  const lw=Math.max(0.12,rh*0.035);
  if(P.tblRules!==false){
    A.mark(str(P.cBorder,"")||col);
    for(let i=0;i<=n;i++)g.fillRect(b.x,b.y+rh*i-lw*0.5,b.w,lw);
    g.fillRect(b.x-lw*0.5,b.y,lw,b.h);
    g.fillRect(b.x+b.w-lw*0.5,b.y,lw,b.h);
    if(P.tblSpine!==false)g.fillRect(b.x+b.w*split-lw*0.5,b.y,lw,b.h);
  }
  const pad=rh*0.16;
  for(let i=0;i<n;i++){
    const y=b.y+rh*i+pad*0.6,h=rh-pad*1.2;
    const k=L.rows[i][0],v=L.rows[i][1];
    if(k.length)typeset(A,k,b.x+pad,y,b.w*split-pad*2,h,
      {col:col,weight:"400",caps:!!P.tblCaps,align:"left",lines:1,track:0.02});
    if(v.length)typeset(A,v,b.x+b.w*split+pad,y,b.w*(1-split)-pad*2,h,
      {col:col,weight:"700",align:"left",lines:1,stack:P.tblMono?STACKS.mono:undefined});
  }
}
function paintBar(A,P,L,b){
  if(!b)return null;
  const g=A.g;
  const code=code39(str(P.barData,""),num(P.barRatio,2.5));
  if(!code.els.length)return null;
  const col=str(P.cText,"")||"#111111";
  const hr=P.barText!==false;
  const th=hr?b.h*0.26:0;
  const bh=b.h-th;
  /* ten narrow modules of clear ground each side, which the symbology
     requires and which is the usual reason a printed barcode will not read */
  const mod=b.w/(code.modules+20);
  A.mark(col);
  let x=b.x+mod*10;
  for(const e of code.els){
    if(e.bar)g.fillRect(x,b.y,mod*e.w,bh);
    x+=mod*e.w;
  }
  if(hr)typeset(A,code.text,b.x,b.y+bh+th*0.08,b.w,th*0.9,
    {col:col,weight:"400",align:"center",lines:1,stack:STACKS.mono,track:0.12});
  return {mod:mod,modules:code.modules,text:code.text};
}
function paintFoot(A,P,L,b){
  if(!b)return;
  const t=str(P.footText,"");
  if(!t.length)return;
  typeset(A,t,b.x,b.y,b.w,b.h,{col:str(P.cText,"")||"#111111",weight:"400",
    align:str(P.footAlign,"left"),lines:2,lead:1.2});
}

/* ---- the block formats: geometry that belongs to a standard ---- */
function paintIso(A,P,L){
  const b=L.block,cat=ISOCAT[P.isoCat]||ISOCAT.warn;
  const cell=L.cells[0]||null;
  const cx=b.x+b.w*0.5,cy=b.y+b.h*0.5;
  if(cat.shape==="triangle"){
    const side=Math.min(b.w,b.h*2/SQ3);
    const t=isoTriangle(A,P,cx,cy,side,0.085,cat.bg,cat.band);
    drawSymbol(A,cell,t.cx,t.cy,t.R,cat.fg);
  }else if(cat.shape==="circle"||cat.shape==="disc"){
    const d=Math.min(b.w,b.h);
    const c=isoCircle(A,P,cx,cy,d,cat);
    drawSymbol(A,cell,c.cx,c.cy,c.R,cat.fg);
    isoBar(A,cat,cx,cy,d);
  }else{
    const g=A.g,s=Math.min(b.w,b.h);
    if(A.field(cat.bg)||A.mask){A.mask?A.mark(cat.bg):0;rr(g,b.x,b.y,b.w,b.h,s*0.05);g.fill();}
    drawSymbol(A,cell,cx,cy,s*0.30,cat.fg);
  }
}
function paintGhs(A,P,L){
  const b=L.block;
  const d=Math.min(b.w,b.h);
  const c=ghsDiamond(A,P,b.x+b.w*0.5,b.y+b.h*0.5,d);
  drawSymbol(A,L.cells[0]||null,c.cx,c.cy,c.R,"#111111");
}
/* NFPA 704: four quadrant diamonds, blue-red-yellow-white, reading
   health / flammability / instability / special, anticlockwise from the left */
function paintNfpa(A,P,L){
  const g=A.g,b=L.block;
  const D=Math.min(b.w,b.h);
  const cx=b.x+b.w*0.5,cy=b.y+b.h*0.5;
  const q=D*0.25;                                  /* each quadrant's half-diagonal */
  const gap=Math.max(D*0.012,0.25);
  const quads=[
    {dx:-q,dy:0,col:str(P.cNfpaH,"")||"#0058a8",val:String(clamp(P.nHealth|0,0,4))},
    {dx:0,dy:-q,col:str(P.cNfpaF,"")||"#c8102e",val:String(clamp(P.nFire|0,0,4))},
    {dx:q,dy:0, col:str(P.cNfpaR,"")||"#f6be00",val:String(clamp(P.nReact|0,0,4))},
    {dx:0,dy:q, col:str(P.cNfpaS,"")||"#ffffff",val:""}
  ];
  /* the black ground between the four, which is what makes it read as one
     diamond rather than as four kites */
  if(A.field(str(P.cBorder,"")||"#111111")||A.mask){
    A.mask?A.mark("#111111"):0;
    roundPoly(g,[[cx,cy-D*0.5],[cx+D*0.5,cy],[cx,cy+D*0.5],[cx-D*0.5,cy]],D*0.02);
    g.fill();
  }
  for(const Q of quads){
    const r=q-gap;
    const qx=cx+Q.dx,qy=cy+Q.dy;
    if(A.field(Q.col)||A.mask){
      A.mask?A.mark(Q.col):0;
      roundPoly(g,[[qx,qy-r],[qx+r,qy],[qx,qy+r],[qx-r,qy]],r*0.04);g.fill();
    }
    if(Q.val.length)
      typeset(A,Q.val,qx-r*0.8,qy-r*0.52,r*1.6,r*1.04,
        {col:inkOn(Q.col),weight:"700",align:"center",lines:1});
  }
  /* the special-hazard notation, which is a symbol rather than a number */
  const sp=str(P.nSpecial,"none");
  const S=quads[3],sx=cx,sy=cy+q,r=q-gap;
  if(sp!=="none"){
    const txt=(sp==="w")?"W":(sp==="ox"?"OX":(sp==="sa"?"SA":"COR"));
    const fit=typeset(A,txt,sx-r*0.86,sy-r*0.46,r*1.72,r*0.92,
      {col:inkOn(S.col),weight:"700",align:"center",lines:1});
    if(sp==="w"&&fit.px){                          /* W-with-a-bar: reacts with water */
      A.mark(inkOn(S.col));
      g.fillRect(sx-fit.px*0.44,sy-fit.px*0.02,fit.px*0.88,Math.max(0.2,fit.px*0.08));
    }
  }
}
/* 49 CFR 172.519 — 273 mm on a side, a 12.7 mm line set 12.7 mm in, the
   symbol in the top half and the class number in the bottom corner. All of it
   scales off the diagonal, so a 100 mm placard is a real placard made small. */
function paintPlacard(A,P,L){
  const g=A.g,b=L.block;
  const C=DOTC[P.dotClass]||DOTC["3"];
  const D=Math.min(b.w,b.h);
  const cx=b.x+b.w*0.5,cy=b.y+b.h*0.5;
  const k=D/PLACARD.side;
  const line=PLACARD.line*k,inset=PLACARD.inset*k;
  const pts=d=>[[cx,cy-d],[cx+d,cy],[cx,cy+d],[cx-d,cy]];
  /* the two halves */
  if(A.field(C.top)||A.mask){
    A.mask?A.mark(C.top):0;
    roundPoly(g,pts(D*0.5),D*0.02);g.fill();
  }
  if(C.bot!==C.top&&A.field(C.bot)){
    g.save();roundPoly(g,pts(D*0.5),D*0.02);g.clip();
    g.fillRect(cx-D,cy,D*2,D);g.restore();
  }
  if(C.stripes&&A.field(C.stripes)){
    g.save();roundPoly(g,pts(D*0.5),D*0.02);g.clip();
    const n=7,w=D/(n*2);
    /* class 9 stripes are the top half only; class 4.1 runs the full height */
    const y0=(P.dotClass==="9")?cy-D:cy-D,y1=(P.dotClass==="9")?cy:cy+D;
    for(let i=-n;i<=n;i++)g.fillRect(cx+i*w*2-w*0.5,y0,w,y1-y0);
    g.restore();
  }
  /* the inner line */
  const fg=inkOn(C.top);
  A.mask?A.mark(fg):(A.field(fg)||A.mark(fg));
  g.lineWidth=line;g.lineJoin="miter";
  roundPoly(g,pts(D*0.5-inset-line*0.5),D*0.01);g.stroke();
  g.lineJoin="round";
  const cell=L.cells[0]||(C.sym!=="none"?{glyph:false,id:C.sym,sym:SYM_BY[C.sym]}:null);
  drawSymbol(A,cell,cx,cy-D*0.23,D*0.155,fg);
  const bf=inkOn(C.bot);
  /* A UN number panel and the written name are ALTERNATIVES, not a stack: the
     panel goes where the name would have gone, so drawing both put one on top
     of the other. */
  const un=str(P.unNumber,"");
  if(un.length){
    const pw=D*0.58,ph=D*0.125;
    if(A.field("#ffffff"))g.fillRect(cx-pw*0.5,cy-ph*0.5,pw,ph);
    A.mark("#111111");
    g.lineWidth=Math.max(0.2,ph*0.08);
    g.strokeRect(cx-pw*0.5,cy-ph*0.5,pw,ph);
    typeset(A,un,cx-pw*0.46,cy-ph*0.42,pw*0.92,ph*0.84,
      {col:"#111111",weight:"700",align:"center",lines:1});
  }else{
    typeset(A,str(P.dotText,""),cx-D*0.32,cy-D*0.02,D*0.64,D*0.11,
      {col:bf,weight:"700",caps:true,align:"center",lines:1,track:0.02});
  }
  /* the class number in the bottom corner */
  typeset(A,C.num,cx-D*0.19,cy+D*0.16,D*0.38,D*0.17,
    {col:bf,weight:"700",align:"center",lines:1});
}
/* ASME A13.1: the legend on its colour field, with the flow arrow beside it.
   The cap height is NOT a taste question — it comes out of the table by pipe
   diameter, and this draws it at exactly that. */
function paintPipe(A,P,L,G){
  const g=A.g,b=L.block;
  const C=PIPEC[P.pipeClass]||PIPEC.flam;
  const bg=str(P.cField,"")||C.bg;
  const fg=inkOn(bg);
  const T=a13Of(Math.max(8,num(P.pipeOd,114.3)));
  if(A.field(bg))g.fillRect(0,0,G.Wmm,G.Hmm);
  const dir=str(P.pipeDir,"right");
  const sub=str(P.pipeSub,"");
  const legend=str(P.pipeLegend,"")||"LEGEND";

  /* A FULL WRAP REPEATS. The band is the whole circumference — a third of a
     metre on a DN100 line — and a legend printed once on that is only legible
     from the one side you happened to stick it. Real wrap-around markers
     print it two or three times round, and so does this: often enough that
     one is always facing you, spaced by the letter height rather than by a
     guess. */
  const reps=(P.pipeWrap==="full")?clamp(Math.round(b.h/(Math.max(T.cap,1)*5.2)),1,4):1;
  const rowH=b.h/reps;
  const cap=Math.min(T.cap,rowH*(sub.length?0.42:0.56));
  const aw=(dir==="none")?0:Math.min(b.w*0.22,Math.max(cap*1.3,rowH*0.5));
  const legX=b.x+((dir==="left"||dir==="both")?aw:0);
  const legW=b.w-((dir==="none")?0:(dir==="both"?aw*2:aw));

  for(let r=0;r<reps;r++){
    const midY=b.y+rowH*(r+0.5);
    A.mark(fg);
    g.textBaseline="middle";
    g.font="700 "+(cap/CAP)+"px "+A.stack;
    const tw=measure(g,legend,num(P.trackMsg,0.02),cap/CAP);
    const px=cap/CAP*Math.min(1,legW*0.92/Math.max(tw,1e-6));
    g.font="700 "+px+"px "+A.stack;
    drawLine(g,legend,legX+legW*0.5,midY-(sub.length?cap*0.68:0),
             "center",num(P.trackMsg,0.02),px);
    if(sub.length){
      const spx=px*0.46;
      g.font="400 "+spx+"px "+A.stack;
      drawLine(g,sub,legX+legW*0.5,midY+cap*0.72,"center",0.02,spx);
    }
    /* the flow arrow: chevrons sized to the letters, filling the row, and
       kept a stroke width clear of the edge so the round cap is not clipped */
    if(aw>0){
      const chH=Math.min(rowH*0.92,Math.max(cap*1.4,aw*1.2));
      const n=Math.max(1,Math.round(rowH*0.94/chH));
      const h1=rowH/n,w=Math.max(0.4,Math.min(aw*0.30,h1*0.20));
      const draw=(tip,dx)=>{
        for(let i=0;i<n;i++){
          const y0=b.y+rowH*r+h1*i;
          g.beginPath();
          g.moveTo(tip-dx*aw*0.62,y0+h1*0.18);
          g.lineTo(tip,y0+h1*0.5);
          g.lineTo(tip-dx*aw*0.62,y0+h1*0.82);
          g.lineWidth=w;g.lineJoin="round";g.lineCap="round";
          g.stroke();
        }
      };
      A.mark(fg);
      if(dir==="right"||dir==="both")draw(b.x+b.w-w*0.8,1);
      if(dir==="left"||dir==="both")draw(b.x+w*0.8,-1);
    }
  }
  L.pipeReps=reps;L.pipeCap=cap;
}

/* ============================ the artwork pass ============================ */
function paint(cv,P,G,mask){
  const L=layout(P,G);
  const g=cv.getContext("2d",{willReadFrequently:true});
  g.setTransform(1,0,0,1,0,0);
  g.clearRect(0,0,cv.width,cv.height);
  if(mask){g.fillStyle="#000";g.fillRect(0,0,cv.width,cv.height);}
  g.save();
  g.scale(G.TW/G.Wmm,G.TH/G.Hmm);
  g.lineJoin="round";g.lineCap="round";g.textBaseline="middle";
  const A=painter(g,P,G,mask);
  A.stack=stackOf(P);
  /* everything is clipped to the outline, so artwork can be laid out without
     every band having to know what shape the label was cut to */
  shapePath(g,L.shape,0,0,G.Wmm,G.Hmm,L.corner);
  g.clip();
  /* the printed ground */
  if(P.panelOn!==false&&A.field(str(P.cPanel,"")||"#ffffff")){
    shapePath(g,L.shape,0,0,G.Wmm,G.Hmm,L.corner);g.fill();
  }
  if(FORMATS[L.fmt].kind==="block"){
    if(L.fmt==="iso")paintIso(A,P,L);
    else if(L.fmt==="ghs")paintGhs(A,P,L);
    else if(L.fmt==="nfpa")paintNfpa(A,P,L);
    else if(L.fmt==="placard")paintPlacard(A,P,L);
    else if(L.fmt==="pipe")paintPipe(A,P,L,G);
    paintMsg(A,P,L,L.bands.msg);
    paintFoot(A,P,L,L.bands.foot);
  }else{
    paintHeader(A,P,L,G);
    paintCells(A,P,L,L.bands.pic);
    paintMsg(A,P,L,L.bands.msg);
    paintTable(A,P,L,L.bands.tbl);
    L.barInfo=paintBar(A,P,L,L.bands.bar);
    paintFoot(A,P,L,L.bands.foot);
  }
  /* the keyline last, so nothing has been drawn over it */
  if(L.border>0.005){
    A.mark(str(P.cBorder,"")||"#111111");
    g.lineWidth=L.border;
    const m=L.margin+L.border*0.5;
    shapePath(g,L.shape,m,m,G.Wmm-2*m,G.Hmm-2*m,Math.max(0,L.corner-m));
    g.stroke();
  }
  g.restore();
  return L;
}

/* the silhouette: the outline and the holes, which become the alpha channel
   and — blurred — the distance field every edge effect is worked out from */
function paintSil(cv,P,G){
  const L=layout(P,G);
  const g=cv.getContext("2d",{willReadFrequently:true});
  g.setTransform(1,0,0,1,0,0);
  g.clearRect(0,0,cv.width,cv.height);
  g.save();
  g.scale(G.TW/G.Wmm,G.TH/G.Hmm);
  g.fillStyle="#ffffff";
  shapePath(g,L.shape,0,0,G.Wmm,G.Hmm,L.corner);
  g.fill();
  g.globalCompositeOperation="destination-out";
  for(const h of holesOf(P,G)){
    g.beginPath();g.arc(h[0],h[1],h[2]*0.5,0,TAU);g.fill();
  }
  g.globalCompositeOperation="source-over";
  g.restore();
  return L;
}

/* ============================ the object ============================
   The artwork is now three rasters. Everything from here turns them into a
   THING: a sheet of material of a known thickness with an edge, a process
   that left the marks proud or sunk, and whatever the last ten years on the
   side of a pump did to it.

   The distance field every edge effect is worked out from is the silhouette
   blurred by the bevel width. That is cheaper than a real distance transform
   and it does the same job here, because everything that happens at the edge
   of a label — the bevel, the lifted corner, the abraded rim — happens within
   a millimetre or two of it. */

/* streaks: noise stretched along a direction, which is what a scratch is */
function streak(u,v,ang,lo,hi,seed){
  const c=Math.cos(ang),s=Math.sin(ang);
  return fbm2(u*c-v*s,u*s+v*c,lo,hi,3,seed);
}

function build(P,io){
  const TW=io.W,TH=io.H,N=TW*TH;
  const G=sizeOf(P,TW);
  /* The buffers are the size the RUNTIME asked for. Recomputing the height
     from the width can land a texel or two off its own earlier answer once a
     capped size has been rounded to a multiple of four, and the artwork would
     then be drawn at a scale the buffers are not — so the transform is pinned
     to what is actually being filled. */
  G.TW=TW;G.TH=TH;
  const seed=P.seed|0;
  const ST=styleOf(P),mat=ST.mat,MK_=ST.mark;
  const MM=1/G.Wmm;                       /* millimetres -> tile-width units */
  const pxPerMm=TW/G.Wmm;

  /* ---- rasterise: colour, marks, silhouette ---- */
  const mkCanvas=()=>{const c=document.createElement("canvas");c.width=TW;c.height=TH;return c;};
  const cvA=mkCanvas(),cvM=mkCanvas(),cvS=mkCanvas();
  const L=paint(cvA,P,G,false);
  paint(cvM,P,G,true);
  paintSil(cvS,P,G);
  const art=cvA.getContext("2d",{willReadFrequently:true}).getImageData(0,0,TW,TH).data;
  let mkd=cvM.getContext("2d",{willReadFrequently:true}).getImageData(0,0,TW,TH).data;
  let sld=cvS.getContext("2d",{willReadFrequently:true}).getImageData(0,0,TW,TH).data;
  const MK=new Uint8Array(N);
  const silF=new Float32Array(N);
  for(let i=0;i<N;i++){
    MK[i]=mkd[i*4];
    silF[i]=sld[i*4+3]/255;
  }
  /* One channel of each of those is all that is wanted, and at 4096 px the
     three RGBA rasters and the canvases behind them are a hundred megabytes
     nothing reads again. Let them go before the per-texel pass allocates its
     own. */
  mkd=sld=null;
  cvM.width=cvM.height=1;cvS.width=cvS.height=1;cvA.width=cvA.height=1;
  io.progress(0.16);

  const A=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N);
  const MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N);
  const ALP=new Uint8ClampedArray(N);
  const EMI=new Uint8ClampedArray(N);
  const NRM=new Uint8ClampedArray(N*3);
  const HGT=new Float32Array(N);
  let hMin=0,hMax=1;

  /* ---- the physical numbers ---- */
  const thick=Math.max(0.02,num(P.thickMm,0)>0?num(P.thickMm,0):mat.thick);
  const bevMm=clamp(num(P.bevelMm,0.25),0,4);
  const bevPx=Math.max(1,Math.round(bevMm*pxPerMm));
  const edge=blurClamp(silF,TW,TH,bevPx);          /* 1 inside, 0 outside */
  const rim=blurClamp(silF,TW,TH,Math.max(2,Math.round(Math.min(6,G.Wmm*0.06)*pxPerMm)));
  io.progress(0.24);

  /* The substrate colour FOLLOWS THE MATERIAL by default. A colour control
     always holds a colour, so reading one unconditionally would mean anodised
     aluminium, brass and two-ply phenolic all came out the same off-white —
     the switch is what lets the material speak for itself and still be
     overridden. */
  const subC=hex2rgb((P.subAuto===false)?str(P.cSub,mat.sub):mat.sub);
  const markDepth=ST.depth;
  /* paint sits ON the material; a cut, an etch or a stamp IS the material, so
     only the first two hide what the substrate is made of */
  const paintOver=(P.marking==="print"||P.marking==="engrave");
  const glowAmt=clamp(num(P.glowAmt,0),0,1);
  const wearS=clamp(num(P.scratch,0.3),0,1);
  const wearU=clamp(num(P.scuff,0.25),0,1);
  const wearA=clamp(num(P.abrade,0.15),0,1);
  const grime=clamp(num(P.grime,0.25),0,1);
  const oil=clamp(num(P.oil,0.1),0,1);
  const fade=clamp(num(P.fade,0.15),0,1);
  const yellow=clamp(num(P.yellow,0.1),0,1);
  const peel=clamp(num(P.peel,0),0,1);
  const craze=clamp(num(P.craze,0.1),0,1);
  const scrAng=num(P.scratchAng,0)*DEG;
  const glossInk=clamp(mat.gloss+MK_.inkGloss,0.02,1);
  const aoStr=clamp(num(P.aoStr,0.8),0,1);

  const band=Math.max(4,Math.round(49152/TW));
  let y=0;

  function pass1(){
    const end=Math.min(TH,y+band);
    for(;y<end;y++){
      const v=(y+0.5)/TH;
      for(let x=0;x<TW;x++){
        const u=(x+0.5)/TW,i=y*TW+x;
        const sil=silF[i];
        const e=edge[i];                       /* 0 outside, 1 well inside */
        const bev=smoothstep(0.30,0.92,e);     /* the cut edge rolling over */
        const near=1-smoothstep(0.3,0.98,rim[i]);  /* within a few mm of any edge */

        /* ---- wear fields ---- */
        const scr=streak(u,v,scrAng,7,260,seed+11);
        const scr2=streak(u,v,scrAng+0.7,11,180,seed+29);
        const scuffN=fbm(u,v,5,4,seed+41);
        const dirtN=fbm(u,v,4,4,seed+53);
        const fineN=fbm2(u,v,90,90,3,seed+67);
        const crazeN=fbm(u,v,26,3,seed+83);

        /* a scratch is a narrow, deep line — the top few per cent of a
           stretched field, not the whole of it */
        const sCut=smoothstep(0.80,0.97,scr)*wearS+smoothstep(0.86,0.99,scr2)*wearS*0.6;
        /* abrasion and scuffing gather at the edges, because that is what the
           label was dragged past */
        const rub=clamp((scuffN-0.45)*2.2,0,1)*(0.35+near*1.3);
        const scuff=clamp(rub,0,1)*wearU;
        const gone=clamp((scuffN*0.7+scr*0.5-0.62)*3,0,1)*wearA*(0.4+near*1.5);
        const dirt=clamp(dirtN*1.25-0.32,0,1)*grime;
        const oily=clamp(fbm(u,v,3,3,seed+97)*1.4-0.55,0,1)*oil;
        const crack=smoothstep(0.985-craze*0.05,1.0,1-Math.abs(crazeN-0.5)*2)*craze;

        /* ---- the artwork, after whatever has happened to it ---- */
        const k=i*4;
        let aA=art[k+3]/255;
        const mkv=MK[i]/255;
        /* ink comes off: scratched through first, then rubbed off in patches */
        const lost=clamp(sCut*0.9+gone*1.35,0,1);
        aA*=(1-lost*0.92);

        let ir=art[k],ig=art[k+1],ib=art[k+2];
        /* UV takes the reds first. Fading is a loss of pigment, so it runs
           toward the substrate rather than toward grey — a faded red label on
           white stock goes pink, not brown. */
        if(fade>0){
          const lum=(ir*0.299+ig*0.587+ib*0.114);
          const red=clamp((ir-Math.max(ig,ib))/255,0,1);
          const f=fade*(0.35+red*0.85)*(0.55+0.45*clamp(fbm(u,v,2,2,seed+113)*1.6-0.3,0,1));
          ir=lerp(ir,lerp(lum,subC[0],0.55),f);
          ig=lerp(ig,lerp(lum,subC[1],0.55),f);
          ib=lerp(ib,lerp(lum,subC[2],0.55),f);
        }

        /* ---- the substrate ---- */
        let sr=subC[0],sg=subC[1],sb=subC[2];
        let subRough=mat.rough,subMet=mat.met;
        if(mat.met>0.4){
          /* brushed or rolled metal: grain along the sheet, and the roll marks
             are what a mill finish actually is */
          const grain=(streak(u,v,0,4,520,seed+131)-0.5)*0.34;
          sr*=1+grain;sg*=1+grain;sb*=1+grain;
          subRough=clamp(mat.rough+grain*0.35,0.05,1);
        }else{
          const tone=(fineN-0.5)*(mat===MATS.paper?0.26:0.07);
          sr*=1+tone;sg*=1+tone;sb*=1+tone;
        }
        if(mat.bead>0){
          /* retroreflective sheeting is a bed of glass beads, and up close
             that is exactly what it looks like */
          const bead=fbm2(u,v,Math.max(40,G.Wmm*3),Math.max(40,G.Hmm*3),2,seed+149);
          subRough=clamp(mat.rough-0.18+(bead-0.5)*0.5,0.04,1);
        }

        /* ---- put the artwork on the material ---- */
        let r=lerp(sr,ir,aA),g0=lerp(sg,ig,aA),b=lerp(sb,ib,aA);
        let rough=lerp(subRough,clamp(1-glossInk,0.03,1),aA*(paintOver?1:0.35));
        let met=paintOver?subMet*(1-aA*0.94):subMet;

        /* relief: the process, then the sheet's own edge */
        let hmm=thick*bev;
        if(markDepth!==0)hmm+=markDepth*mkv*bev;
        /* dirt gathers in a groove and nowhere else, which is the single
           thing that makes an engraved plate read as engraved */
        const inGroove=(MK_.depth<0)?mkv:0;
        const soil=clamp(dirt+inGroove*MK_.dirt*(0.25+grime*0.9),0,1);
        if(soil>0){
          const dc=0.42+0.18*fineN;
          r=lerp(r,r*dc+14,soil*0.85);g0=lerp(g0,g0*dc+13,soil*0.85);b=lerp(b,b*dc+11,soil*0.8);
          rough=clamp(lerp(rough,0.93,soil*0.8),0.03,1);
          met*=1-soil*0.7;
        }

        /* scratches cut to the material and shine; scuffs just kill the gloss */
        if(sCut>0){
          const bright=paintOver?1.25:1.1;
          r=lerp(r,clamp(sr*bright,0,255),sCut*0.75);
          g0=lerp(g0,clamp(sg*bright,0,255),sCut*0.75);
          b=lerp(b,clamp(sb*bright,0,255),sCut*0.75);
          rough=clamp(lerp(rough,0.72,sCut*0.8),0.03,1);
          met=lerp(met,subMet,sCut*0.8);
          hmm-=0.012*sCut;
        }
        if(scuff>0){
          rough=clamp(lerp(rough,0.86,scuff*0.75),0.03,1);
          const hz=(r+g0+b)/3;
          r=lerp(r,lerp(r,hz,0.5)*1.04,scuff*0.5);
          g0=lerp(g0,lerp(g0,hz,0.5)*1.04,scuff*0.5);
          b=lerp(b,lerp(b,hz,0.5)*1.04,scuff*0.5);
        }
        if(oily>0){
          r*=1-oily*0.45;g0*=1-oily*0.46;b*=1-oily*0.42;
          rough=clamp(lerp(rough,0.16,oily*0.7),0.03,1);
        }
        /* the laminate yellows, and it yellows over everything equally */
        if(yellow>0&&mat.lam){
          const yk=yellow*(0.6+0.4*fbm(u,v,2,2,seed+167));
          r=lerp(r,r*1.02,yk);g0=lerp(g0,g0*0.96,yk);b=lerp(b,b*0.76,yk);
        }
        /* and then it crazes */
        if(crack>0){
          hmm-=0.02*crack;
          rough=clamp(rough+crack*0.25,0.03,1);
          r*=1-crack*0.25;g0*=1-crack*0.25;b*=1-crack*0.25;
        }

        /* ---- the edge: bevel, lift and the abraded rim ---- */
        const lip=(peel>0)?clamp((fbm(u,v,3,3,seed+181)-0.35)*2.2,0,1)*peel*(1-e):0;
        if(lip>0){
          hmm+=thick*1.6*lip;
          rough=clamp(rough+lip*0.2,0.03,1);
          r*=1-lip*0.18;g0*=1-lip*0.18;b*=1-lip*0.18;
        }
        /* the cut edge itself is raw material, whatever is printed on the face */
        const cut=1-smoothstep(0.02,0.42,e);
        if(cut>0.001){
          const cc=(mat===MATS.phenol)?hex2rgb(mat.core):[sr,sg,sb];
          r=lerp(r,cc[0]*0.86,cut);g0=lerp(g0,cc[1]*0.86,cut);b=lerp(b,cc[2]*0.86,cut);
          rough=clamp(lerp(rough,clamp(subRough+0.18,0,1),cut),0.03,1);
          met=lerp(met,subMet,cut);
        }

        /* ---- emissive ---- */
        let emi=0;
        if(glowAmt>0){
          if(mat===MATS.glow){
            /* the pigment is IN THE SHEET, so what matters is how much light
               the ink over it lets out: a white symbol on a photoluminescent
               exit sign glows nearly as brightly as the bare sheet, and the
               green field over it barely does. Treating any ink at all as
               opaque made the whole sign go dark, which is the one thing a
               glow-in-the-dark sign must not do. */
            const inkL=(ir*0.299+ig*0.587+ib*0.114)/255;
            emi=glowAmt*(1-aA*0.88*(1-inkL))*(1-soil*0.6);
          }
          else if(mat.bead>0)emi=glowAmt*(0.25+aA*0.55)*(1-soil*0.5);
          else emi=glowAmt*aA;                                      /* backlit artwork */
        }

        HGT[i]=hmm*MM;
        A[i*3]=r;A[i*3+1]=g0;A[i*3+2]=b;
        RGH[i]=clamp(rough,0.02,1)*255;
        MET[i]=clamp(met,0,1)*255;
        EMI[i]=clamp(emi,0,1)*255;
        /* the silhouette, minus whatever has peeled or been torn off */
        ALP[i]=clamp(sil*(1-lip*0.25*peel),0,1)*255;
        AOc[i]=255;
      }
    }
    if(y<TH){io.progress(0.24+y/TH*0.5);setTimeout(pass1,0);}
    else{io.progress(0.76);setTimeout(pass2,0);}
  }

  function pass2(){
    /* AO from the height field: a groove has its own shadow, and on an unlit
       target this map is doing all of the work */
    const rAo=Math.max(1,Math.round(Math.min(TW,TH)*0.006));
    const hb=blurClamp(HGT,TW,TH,rAo);
    const hb2=blurClamp(HGT,TW,TH,rAo*4);
    for(let i=0;i<N;i++){
      const d=(hb[i]-HGT[i])*1400+(hb2[i]-HGT[i])*260;
      let ao=1-clamp(d,0,1)*aoStr;
      /* and the label casts one onto its own edge */
      ao*=lerp(1,0.72+0.28*edge[i],aoStr*0.8);
      AOc[i]=clamp(ao,0,1)*255;
    }
    io.progress(0.88);

    hMin=Infinity;hMax=-Infinity;
    for(let i=0;i<N;i++){const h=HGT[i];if(h<hMin)hMin=h;if(h>hMax)hMax=h;}
    if(!isFinite(hMin))hMin=0;
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;

    const gy=P.flipG?-1:1,str_=num(P.normalStr,1);
    for(let yy=0;yy<TH;yy++){
      const yp=Math.min(TH-1,yy+1)*TW,ym=Math.max(0,yy-1)*TW,y0=yy*TW;
      for(let xx=0;xx<TW;xx++){
        const xp=Math.min(TW-1,xx+1),xm=Math.max(0,xx-1);
        const dhdu=(HGT[y0+xp]-HGT[y0+xm])*0.5*TW*str_;
        const dhdv=(HGT[yp+xx]-HGT[ym+xx])*0.5*TW*str_;
        let nx=-dhdu,ny=-dhdv*gy;
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;
        const i=(y0+xx)*3;
        NRM[i]=(nx*0.5+0.5)*255;NRM[i+1]=(ny*0.5+0.5)*255;NRM[i+2]=(inv*0.5+0.5)*255;
      }
    }
    io.progress(1);
    io.done({A:A,NRM:NRM,RGH:RGH,MET:MET,AO:AOc,HGT:HGT,hMin:hMin,hMax:hMax,
             ALP:ALP,EMI:EMI});
  }

  io.progress(0.2);
  setTimeout(pass1,0);
}

/* ============================ mode definition ============================ */
let lastStock="custom",lastSignal="",lastPipe="",lastFormat="";
const same=(a,b)=>String(a||"").toLowerCase()===String(b||"").toLowerCase();

const SYM_OPTIONS=SYM.map(s=>[s.id,s.label]).concat([["glyph","Unicode glyph — typed below"]]);

Forge.register({
  id:"label",
  label:"Label",
  group:"Signage",
  threadable:false,                   /* it is all type, and type is the page's */
  blurb:"Warning labels, safety signs, placards, pipe markers and data plates",
  title:'Industrial <em>Label</em>',
  tagline:"ANSI Z535 · ISO 7010 · GHS · NFPA 704 · 49 CFR · ASME A13.1 · Code 39",
  actionLabel:"Print the label",
  busyLabel:"Printing…",
  previewSize:384,
  backdrops:true,                     /* it is a cut-out, always */
  seamless:false,
  preview:{gain:2.7,amb:1.15,specK:0.6,skyLo:[0.17,0.19,0.22],skyHi:[0.36,0.40,0.46]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
    {key:"ao",label:"AO"},{key:"emissive",label:"Emissive"},
    {key:"height",label:"Height"},{key:"orm",label:"ORM packed"},
    {key:"opacity",label:"Opacity"}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"format",type:"select",label:"Standard",value:"ansi",
       options:FORMAT_KEYS.map(k=>[k,FORMATS[k].label])},
      {id:"stock",type:"select",label:"Stock size",value:"custom",options:STOCK},
      {id:"Wmm",label:"Label width",unit:"mm",min:8,max:1200,step:1,value:100,need:"free-size"},
      {id:"Hmm",label:"Label height",unit:"mm",min:8,max:1200,step:1,value:50,need:"free-size"},
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:Forge.sizes("wide")},
      {id:"seed",type:"seed",value:7010},
      {type:"readout"},
      {type:"note",html:"Everything here is in <b>millimetres</b>, because a label is ordered "+
        "in millimetres and printed at a dpi. The readout quotes both, and the exported plane "+
        "is the real size — so a 100 × 50 mm label lands in Blender as a 100 × 50 mm label."}
    ]},

    {title:"The blank",rows:[
      {id:"shape",type:"select",label:"Cut to",value:"auto",options:[
        ["auto","Whatever the standard wants"],["rect","Rectangle"],["round","Rounded rectangle"],
        ["circle","Circle / ellipse"],["diamond","Diamond — on point"],["triangle","Triangle"],
        ["octagon","Octagon"],["tag","Hang tag"]]},
      {id:"cornerMm",label:"Corner radius",unit:"mm",min:0,max:40,step:0.5,value:3},
      {id:"marginMm",label:"Margin",unit:"mm",min:0,max:40,step:0.5,value:3},
      {id:"borderMm",label:"Keyline",unit:"mm",min:0,max:6,step:0.1,value:0.6},
      {id:"gapMm",label:"Gap between bands",unit:"mm",min:0,max:20,step:0.2,value:1.6,need:"stack"},
      {type:"checks",items:[{id:"panelOn",label:"Printed ground behind everything",value:true}]},
      {id:"holes",type:"select",label:"Fixing",value:"none",options:[
        ["none","None — adhesive"],["h2","Two holes, left and right"],["h2v","Two holes, top and bottom"],
        ["h4","Four corner holes"],["grommet","One grommet, top"]]},
      {id:"holeMm",need:"holes",label:"Hole diameter",unit:"mm",min:1,max:30,step:0.5,value:4},
      {id:"holeInMm",need:"holes",label:"Hole inset from the edge",unit:"mm",min:1,max:60,step:0.5,value:6}
    ]},

    {title:"Signal panel",open:true,need:"stack",rows:[
      {type:"checks",items:[{id:"bHeader",label:"Signal panel across the top",value:true}]},
      {id:"signal",type:"select",label:"Signal word",value:"danger",
       options:SIGNAL_KEYS.map(k=>[k,SIGNAL[k].word||"— none —"])},
      {id:"signalText",type:"text",label:"Word (blank = the standard's)",value:"",
       placeholder:"DANGER",maxlength:28},
      {id:"hdrAlign",type:"select",label:"Word sits",value:"left",options:[
        ["left","Left, beside the alert symbol"],["center","Centred"],["right","Right"]]},
      {id:"hdrMm",label:"Panel height (0 = auto)",unit:"mm",min:0,max:120,step:0.5,value:0},
      {id:"trackHdr",label:"Letter tracking",min:-0.05,max:0.3,step:0.005,value:0.04},
      {type:"checks",items:[{id:"alertSym",label:"ANSI safety alert symbol",value:true}]},
      {type:"note",html:"ANSI Z535.4 pairs the word with its colour and with what it means: "+
        "<b>DANGER</b> is death or serious injury that <i>will</i> happen, <b>WARNING</b> that it "+
        "<i>could</i>, <b>CAUTION</b> minor or moderate injury, <b>NOTICE</b> a practice not "+
        "related to injury at all. Changing the word rewrites the two colours."}
    ]},

    {title:"The sign",open:true,need:"iso",rows:[
      {id:"isoCat",type:"select",label:"Category",value:"warn",
       options:Object.keys(ISOCAT).map(k=>[k,ISOCAT[k].label])},
      {type:"note",html:"ISO 3864-1 ties the shape, the colour and the meaning together: a "+
        "yellow triangle warns, a red annulus with a 45° bar prohibits, a blue disc mandates, "+
        "a green square is a safe condition and a red square is fire equipment. The symbol "+
        "comes from the first pictogram cell below."}
    ]},

    {title:"GHS",need:"ghs",rows:[
      {type:"checks",items:[{id:"ghsSide",label:"Pictogram beside the wording, not over it",value:false}]},
      {type:"note",html:"The frame is a square on point with a red border about a twelfth of "+
        "its side, black symbol on white. Put the signal word in the headline and the H-statements "+
        "in the body below."}
    ]},

    {title:"Fire diamond",open:true,need:"nfpa",rows:[
      {id:"nHealth",label:"Health — blue, left",min:0,max:4,step:1,value:3},
      {id:"nFire",label:"Flammability — red, top",min:0,max:4,step:1,value:2},
      {id:"nReact",label:"Instability — yellow, right",min:0,max:4,step:1,value:1},
      {id:"nSpecial",type:"select",label:"Special — white, bottom",value:"none",options:[
        ["none","— none —"],["w","W — reacts with water"],["ox","OX — oxidiser"],
        ["sa","SA — simple asphyxiant"],["cor","COR — corrosive"]]}
    ]},

    {title:"Placard",open:true,need:"placard",rows:[
      {id:"dotClass",type:"select",label:"Class",value:"3",
       options:Object.keys(DOTC).map(k=>[k,k+" — "+DOTC[k].label])},
      {id:"dotText",type:"text",label:"Word across the middle",value:"",
       placeholder:"FLAMMABLE",maxlength:24},
      {id:"unNumber",type:"text",label:"UN number panel",value:"",placeholder:"UN 1203",maxlength:12},
      {id:"placardMm",label:"Placard across the points",unit:"mm",min:60,max:600,step:1,value:273},
      {type:"note",html:"49 CFR 172.519 sets it at <b>273 mm</b> on a side with a 12.7 mm line "+
        "12.7 mm in from the edge. Both scale with the size, so a small one is a real placard "+
        "made small rather than a different drawing."}
    ]},

    {title:"Pipe marker",open:true,need:"pipe",rows:[
      {id:"pipeClass",type:"select",label:"Contents",value:"flam",
       options:Object.keys(PIPEC).map(k=>[k,PIPEC[k].label])},
      {id:"pipeLegend",type:"text",label:"Legend",value:"NATURAL GAS",placeholder:"what is in it",maxlength:40},
      {id:"pipeSub",type:"text",label:"Second line",value:"",placeholder:"7 bar · 60 °C",maxlength:40},
      {id:"pipeOd",label:"Pipe outside diameter",unit:"mm",min:8,max:1200,step:0.1,value:114.3},
      {id:"pipeDir",type:"select",label:"Flow arrow",value:"right",options:[
        ["right","One way"],["left","The other way"],["both","Both — direction unknown"],["none","None"]]},
      {id:"pipeWrap",type:"select",label:"Height",value:"full",options:[
        ["full","Full wrap — the circumference"],["band","A band, from the table"]]},
      {type:"note",html:"ASME A13.1 sets the length of the colour field and the letter height "+
        "<b>by pipe diameter</b>, and this uses that table rather than guessing — the readout "+
        "says which row you landed in. Letters are drawn at the cap height the table gives."}
    ]},

    {title:"Arc flash",open:true,need:"arc",rows:[
      {id:"afVolt",type:"text",label:"Nominal voltage",value:"480 V AC",maxlength:32},
      {id:"afBound",type:"text",label:"Arc flash boundary",value:"1370 mm",maxlength:32},
      {id:"afEnergy",type:"text",label:"Incident energy",value:"8.4 cal/cm² @ 455 mm",maxlength:36},
      {id:"afDist",type:"text",label:"Working distance",value:"455 mm",maxlength:32},
      {id:"afPpe",type:"text",label:"PPE category",value:"2",maxlength:32},
      {id:"afShock",type:"text",label:"Limited / restricted",value:"1070 mm / 305 mm",maxlength:36},
      {id:"afEquip",type:"text",label:"Equipment",value:"MCC-2 BUS A",maxlength:32},
      {type:"note",html:"NFPA 70E 130.5(H) wants the nominal voltage, the arc flash boundary "+
        "and <i>either</i> the incident energy at a stated working distance <i>or</i> the PPE "+
        "category. Leave a field blank and its row disappears."}
    ]},

    {title:"Pictograms",open:true,rows:[
      {type:"checks",items:[{id:"bPicto",label:"Pictogram cells",value:true}]},
      {id:"nPicto",need:"picto",label:"How many",min:1,max:4,step:1,value:1},
      {id:"pFrame",type:"select",label:"Frame",value:"triangle",need:"spicto",options:[
        ["none","None — the symbol alone"],["triangle","ISO warning triangle"],
        ["bar","ISO prohibition — circle and bar"],["disc","ISO mandatory — blue disc"],
        ["square","ISO safe condition — green square"],["fire","Fire equipment — red square"],
        ["diamond","GHS diamond"],["box","Rounded tile"]]},
      {id:"pictoPos",type:"select",label:"They sit",value:"row",need:"spicto",options:[
        ["row","In a band of their own"],["left","Left of the message"],
        ["right","Right of the message"],["header","In the signal panel"]]},
      {id:"pictoMm",need:"spicto",label:"Band height (0 = auto)",unit:"mm",min:0,max:200,step:1,value:0},
      {id:"sym1",type:"select",need:"picto",label:"Cell 1",value:"bolt",options:SYM_OPTIONS},
      {id:"gly1",type:"text",need:"glyph1",label:"Cell 1 glyph",value:"⚠",maxlength:8},
      {id:"sym2",type:"select",need:"picto",label:"Cell 2",value:"none",options:SYM_OPTIONS},
      {id:"gly2",type:"text",need:"glyph2",label:"Cell 2 glyph",value:"☢",maxlength:8},
      {id:"sym3",type:"select",need:"picto",label:"Cell 3",value:"none",options:SYM_OPTIONS},
      {id:"gly3",type:"text",need:"glyph3",label:"Cell 3 glyph",value:"☣",maxlength:8},
      {id:"sym4",type:"select",need:"picto",label:"Cell 4",value:"none",options:SYM_OPTIONS},
      {id:"gly4",type:"text",need:"glyph4",label:"Cell 4 glyph",value:"⚡",maxlength:8},
      {type:"note",html:"Every symbol in the list is drawn from <b>paths</b>, so it holds up at "+
        "4096 px. Set a cell to <b>Unicode glyph</b> instead and it draws whatever character you "+
        "type — ☢ ☣ ⚠ ⚡ ☠ ⛔ ♨ and anything else your browser has a glyph for. That one comes "+
        "from the browser's own fonts, so a missing code point gives you a box rather than a symbol."}
    ]},

    {title:"Message",open:true,rows:[
      {type:"checks",items:[{id:"bMsg",label:"Message block",value:true}]},
      {id:"msgHead",type:"text",label:"Headline",value:"HAZARDOUS VOLTAGE",maxlength:80},
      {id:"msgBody",type:"text",label:"Body — | starts a new line",value:
        "Contact will cause severe injury or death.|Disconnect and lock out before servicing.",
       maxlength:400},
      {id:"msgAlign",type:"select",label:"Set",value:"center",options:[
        ["left","Ranged left"],["center","Centred"],["right","Ranged right"]]},
      {id:"headFrac",label:"Headline share of the block",min:0.15,max:0.8,step:0.01,value:0.42},
      {id:"msgMm",label:"Block height (0 = auto)",unit:"mm",min:0,max:400,step:1,value:0,need:"block"},
      {id:"trackMsg",label:"Letter tracking",min:-0.05,max:0.3,step:0.005,value:0.01},
      {type:"checks",items:[{id:"msgCaps",label:"Headline in capitals",value:true}]}
    ]},

    {title:"Data rows",rows:[
      {type:"checks",items:[{id:"bTable",label:"Table of rows",value:false}]},
      {id:"row1",type:"text",label:"Row 1 — key | value",value:"MODEL|XR-4200",maxlength:80},
      {id:"row2",type:"text",label:"Row 2",value:"SERIAL|A7-99413-02",maxlength:80},
      {id:"row3",type:"text",label:"Row 3",value:"SUPPLY|400 V 3~ 50 Hz",maxlength:80},
      {id:"row4",type:"text",label:"Row 4",value:"RATED|18.5 kW  34 A",maxlength:80},
      {id:"row5",type:"text",label:"Row 5",value:"IP RATING|IP66",maxlength:80},
      {id:"row6",type:"text",label:"Row 6",value:"MFG|2031-04",maxlength:80},
      {id:"tblSplit",label:"Key column",min:0.12,max:0.88,step:0.01,value:0.42},
      {id:"rowMm",label:"Row height (0 = auto)",unit:"mm",min:0,max:60,step:0.5,value:0},
      {type:"checks",items:[
        {id:"tblRules",label:"Rules around and between the rows",value:true},
        {id:"tblSpine",label:"Rule down the middle",value:true},
        {id:"tblCaps",label:"Keys in capitals",value:true},
        {id:"tblMono",label:"Values in a monospaced face",value:false}]},
      {type:"note",html:"One row per line, <b>key | value</b>. A row with no bar is a single "+
        "span across both columns; an empty row is left out. On an arc flash label these rows "+
        "are ignored and the NFPA 70E fields are used instead."}
    ]},

    {title:"Barcode",rows:[
      {type:"checks",items:[{id:"bBar",label:"Code 39 barcode",value:false}]},
      {id:"barData",type:"text",label:"What it holds",value:"A7-99413-02",maxlength:32},
      {id:"barRatio",label:"Wide / narrow ratio",min:2,max:3,step:0.1,value:2.5},
      {id:"barMm",label:"Height (0 = auto)",unit:"mm",min:0,max:80,step:0.5,value:0},
      {type:"checks",items:[{id:"barText",label:"Human-readable line under it",value:true}]},
      {type:"note",html:"Real Code 39, not stripes that look like a barcode: nine elements per "+
        "character, three of them wide, start and stop, and ten narrow modules of clear ground "+
        "each side. It scans. Characters the symbology cannot carry are dropped rather than "+
        "faked, and the readout says how wide a narrow module came out."}
    ]},

    {title:"Footer",rows:[
      {type:"checks",items:[{id:"bFoot",label:"Small print",value:false}]},
      {id:"footText",type:"text",label:"Text",value:"PN 4471-02 · ANSI Z535.4",maxlength:120},
      {id:"footAlign",type:"select",label:"Set",value:"left",options:[
        ["left","Ranged left"],["center","Centred"],["right","Ranged right"]]},
      {id:"footMm",label:"Height",unit:"mm",min:1,max:40,step:0.5,value:4}
    ]},

    {title:"Type",rows:[
      {id:"typeface",type:"select",label:"Family",value:"grot",options:[
        ["grot","Grotesque — Helvetica / Arial"],["cond","Condensed"],["din","DIN-like"],
        ["humane","Humanist UI"],["mono","Monospaced"],["serif","Serif"]]},
      {id:"faceId",type:"font",label:"Loaded face (beats the family)",value:"none",
       autoLabel:"Any face loaded",emptyLabel:"No face loaded — use the family",
       noneLabel:"None — use the family"},
      {type:"note",html:"No typeface is bundled with this app — see the note at the top of "+
        "forge-fonts.js — so the families above are whatever your browser has under those names. "+
        "<b>Load…</b> registers a real one from its bytes, which is the only way to be sure the "+
        "label is set in the face you meant."}
    ]},

    {title:"Material and process",open:true,rows:[
      {id:"material",type:"select",label:"Substrate",value:"vinyl",
       options:MAT_KEYS.map(k=>[k,MATS[k].name])},
      {id:"marking",type:"select",label:"Applied by",value:"print",
       options:Object.keys(MARKS).map(k=>[k,MARKS[k].name])},
      {id:"markDepth",label:"Relief depth",min:0,max:4,step:0.05,value:1},
      {id:"thickMm",label:"Thickness (0 = the material's own)",unit:"mm",min:0,max:8,step:0.05,value:0},
      {id:"bevelMm",label:"Edge bevel",unit:"mm",min:0,max:4,step:0.05,value:0.25},
      {type:"checks",items:[{id:"fieldInk",label:"Colour fields printed (off = the substrate shows)",value:true}]},
      {type:"note",html:"The process is a relief question and a colour question at once. "+
        "<b>Engraved to the core</b> on two-ply phenolic cuts through the dark face and finds the "+
        "light core, so the letters are pale <i>and</i> sunk. <b>Laser-marked</b> changes the "+
        "colour of an anodised surface and leaves it dead flat. Turning the colour fields off is "+
        "what makes an engraved plate a plate rather than a sticker."}
    ]},

    {title:"Colours",rows:[
      {type:"colors",label:"Ground · text · keyline",items:[
        {id:"cPanel",value:"#ffffff"},{id:"cText",value:"#111111"},
        {id:"cBorder",value:"#111111"}]},
      {type:"checks",items:[{id:"subAuto",label:"Substrate colour from the material",value:true}]},
      {type:"colors",label:"Substrate, when it is not",items:[{id:"cSub",value:"#f4f3ef"}]},
      {type:"colors",label:"Signal panel · its word",items:[
        {id:"cSignal",value:"#c8102e"},{id:"cSignalFg",value:"#ffffff"}]},
      {type:"colors",label:"Symbol · GHS frame · pipe field",items:[
        {id:"cSym",value:"#111111"},{id:"cGhs",value:"#c8102e"},{id:"cField",value:"#f6be00"}]},
      {type:"colors",label:"Fire diamond — health · fire · instability · special",need:"nfpa",items:[
        {id:"cNfpaH",value:"#0058a8"},{id:"cNfpaF",value:"#c8102e"},
        {id:"cNfpaR",value:"#f6be00"},{id:"cNfpaS",value:"#ffffff"}]},
      {type:"colors",label:"Glow",need:"glow",items:[{id:"cGlow",value:"#8bff9e"}]}
    ]},

    {title:"Wear",open:true,rows:[
      {id:"scratch",label:"Scratches",min:0,max:1,step:0.01,value:0.3},
      {id:"scratchAng",label:"Scratches run at",unit:"°",min:-90,max:90,step:1,value:0},
      {id:"scuff",label:"Scuffing",min:0,max:1,step:0.01,value:0.25},
      {id:"abrade",label:"Ink worn off",min:0,max:1,step:0.01,value:0.15},
      {id:"grime",label:"Dirt",min:0,max:1,step:0.01,value:0.25},
      {id:"oil",label:"Oil",min:0,max:1,step:0.01,value:0.1},
      {id:"fade",label:"UV fade",min:0,max:1,step:0.01,value:0.15},
      {id:"yellow",label:"Laminate yellowing",min:0,max:1,step:0.01,value:0.1},
      {id:"peel",label:"Lifting at the edges",min:0,max:1,step:0.01,value:0},
      {id:"craze",label:"Crazing",min:0,max:1,step:0.01,value:0.1},
      {type:"checks",items:[{id:"cleanCut",label:"Also export the clean artwork",value:true}]},
      {type:"note",html:"Dirt gathers in a groove and nowhere else, which is the one thing that "+
        "makes an engraved plate read as engraved. UV takes the reds first, and takes them toward "+
        "the substrate rather than toward grey — a faded red on white stock goes pink, not brown."}
    ]},

    {title:"Maps",rows:[
      {id:"glowAmt",label:"Glow",min:0,max:1,step:0.01,value:0},
      {id:"normalStr",label:"Normal strength",min:0.1,max:4,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:0.8},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  presets:[
    {id:"hv",label:"DANGER — hazardous voltage",set:{
      format:"ansi",shape:"auto",Wmm:100,Hmm:50,material:"vinyl",marking:"print",
      signal:"danger",cSignal:"#c8102e",cSignalFg:"#ffffff",signalText:"",alertSym:true,
      bHeader:true,bPicto:true,bMsg:true,bTable:false,bBar:false,bFoot:true,
      nPicto:1,sym1:"bolt",pFrame:"triangle",pictoPos:"left",
      msgHead:"HAZARDOUS VOLTAGE",
      msgBody:"Contact will cause severe injury or death.|Disconnect and lock out before servicing.",
      footText:"PN 4471-02 · ANSI Z535.4",fieldInk:true,
      scratch:.25,scuff:.2,abrade:.1,grime:.2,oil:.05,fade:.12,yellow:.08,peel:0,craze:.08,glowAmt:0}},

    {id:"pinch",label:"WARNING — moving parts",set:{
      format:"ansi",Wmm:100,Hmm:50,material:"vinyl",marking:"print",
      signal:"warning",cSignal:"#f68b1f",cSignalFg:"#000000",alertSym:true,
      bHeader:true,bPicto:true,bMsg:true,bTable:false,bBar:false,bFoot:false,
      nPicto:2,sym1:"pinch",sym2:"entangle",pFrame:"triangle",pictoPos:"row",
      msgHead:"MOVING PARTS",msgBody:"Keep hands clear. Do not operate with the guard removed.",
      scratch:.3,scuff:.3,abrade:.15,grime:.3,fade:.2,yellow:.15}},

    {id:"hotsurf",label:"CAUTION — hot surface",set:{
      format:"ansi",Wmm:75,Hmm:50,material:"alu",marking:"print",
      signal:"caution",cSignal:"#f6be00",cSignalFg:"#000000",alertSym:true,
      bHeader:true,bPicto:true,bMsg:true,bTable:false,bFoot:false,
      nPicto:1,sym1:"hot",pFrame:"triangle",pictoPos:"left",
      msgHead:"HOT SURFACE",msgBody:"Do not touch. Allow to cool before handling.",
      scratch:.35,scuff:.3,grime:.35,fade:.25}},

    {id:"notice",label:"NOTICE — authorised personnel",set:{
      format:"ansi",Wmm:150,Hmm:75,material:"vinyl",marking:"print",
      signal:"notice",cSignal:"#00539b",cSignalFg:"#ffffff",alertSym:false,
      bHeader:true,bPicto:false,bMsg:true,bTable:false,bFoot:true,
      msgHead:"AUTHORISED PERSONNEL ONLY",
      msgBody:"This equipment is to be operated by trained personnel.|Report faults to the duty engineer.",
      footText:"Plant services · ext 2210",scratch:.15,scuff:.15,grime:.15,fade:.1}},

    {id:"isoWarn",label:"ISO 7010 — laser hazard",set:{
      format:"iso",isoCat:"warn",Wmm:150,Hmm:150,shape:"auto",material:"vinyl",marking:"print",
      bMsg:true,bFoot:false,bPicto:true,nPicto:1,sym1:"laser",
      msgHead:"LASER RADIATION",msgBody:"Class 4 — avoid eye or skin exposure to direct or scattered radiation",
      msgMm:0,marginMm:4,borderMm:0,scratch:.2,scuff:.2,grime:.2,fade:.15}},

    {id:"isoNoSmoke",label:"ISO 7010 — no smoking",set:{
      format:"iso",isoCat:"prohibit",Wmm:200,Hmm:200,material:"vinyl",marking:"print",
      bMsg:false,bFoot:false,bPicto:true,nPicto:1,sym1:"nosmoke",
      marginMm:5,borderMm:0,scratch:.15,grime:.2,fade:.2}},

    {id:"isoEye",label:"ISO 7010 — eye protection",set:{
      format:"iso",isoCat:"mandate",Wmm:200,Hmm:200,material:"vinyl",marking:"print",
      bMsg:true,bPicto:true,nPicto:1,sym1:"eye",
      msgHead:"EYE PROTECTION MUST BE WORN",msgBody:"",
      marginMm:5,borderMm:0,scratch:.15,grime:.2,fade:.15}},

    {id:"isoExit",label:"ISO 7010 — emergency exit, glowing",set:{
      format:"iso",isoCat:"safe",Wmm:300,Hmm:150,material:"glow",marking:"print",
      bMsg:false,bPicto:true,nPicto:1,sym1:"exit",glowAmt:.7,cGlow:"#8bff9e",
      marginMm:4,borderMm:0,scratch:.1,grime:.15,fade:.1}},

    {id:"isoFire",label:"ISO 7010 — fire extinguisher",set:{
      format:"iso",isoCat:"fire",Wmm:200,Hmm:200,material:"reflect",marking:"print",
      bMsg:false,bPicto:true,nPicto:1,sym1:"extinguisher",glowAmt:.25,
      marginMm:4,borderMm:0,scratch:.2,grime:.25,fade:.1}},

    {id:"ghsCorr",label:"GHS — corrosive drum label",set:{
      format:"ghs",Wmm:150,Hmm:150,material:"vinyl",marking:"print",ghsSide:true,
      bMsg:true,bFoot:true,bPicto:true,nPicto:1,sym1:"corrosive",
      msgHead:"DANGER",
      msgBody:"Causes severe skin burns and eye damage.|Wear protective gloves and eye protection.|IF ON SKIN: rinse with water for 15 minutes.",
      footText:"Sodium hydroxide 50% · UN 1824 · Works Chemical Co.",
      marginMm:4,borderMm:0.5,scratch:.2,scuff:.25,grime:.3,fade:.15,yellow:.15}},

    {id:"ghsFlam",label:"GHS — flammable, diamond alone",set:{
      format:"ghs",Wmm:100,Hmm:100,material:"vinyl",marking:"print",ghsSide:false,
      bMsg:false,bFoot:false,bPicto:true,nPicto:1,sym1:"flame",
      marginMm:2,borderMm:0,scratch:.15,grime:.2,fade:.2}},

    {id:"nfpa",label:"NFPA 704 fire diamond",set:{
      format:"nfpa",Wmm:250,Hmm:250,material:"alu",marking:"print",shape:"auto",
      nHealth:3,nFire:4,nReact:1,nSpecial:"ox",
      bMsg:false,bFoot:false,bPicto:false,marginMm:3,borderMm:0,
      scratch:.25,scuff:.2,grime:.3,fade:.2,holes:"none"}},

    {id:"arc",label:"Arc flash (NFPA 70E)",set:{
      format:"arc",Wmm:127,Hmm:178,material:"vinyl",marking:"print",
      signal:"danger",alertSym:true,bHeader:true,bPicto:true,bMsg:true,bTable:true,bFoot:true,
      nPicto:1,sym1:"bolt",pFrame:"triangle",pictoPos:"header",
      msgHead:"ARC FLASH AND SHOCK HAZARD",msgBody:"Appropriate PPE required.",
      headFrac:.55,footText:"Study 2031-02 · rev C",
      tblRules:true,tblSpine:true,tblCaps:false,tblMono:false,tblSplit:.46,
      scratch:.2,scuff:.15,grime:.2,fade:.1}},

    {id:"plate",label:"Data plate — etched stainless",set:{
      format:"plate",Wmm:120,Hmm:80,material:"etch",marking:"etchfill",fieldInk:false,
      signal:"none",signalText:"NORTHGATE MACHINE TOOL",bHeader:true,hdrAlign:"center",
      bPicto:false,bMsg:false,bTable:true,bBar:true,bFoot:true,
      row1:"MODEL|XR-4200",row2:"SERIAL|A7-99413-02",row3:"SUPPLY|400 V 3~ 50 Hz",
      row4:"RATED|18.5 kW  34 A",row5:"IP RATING|IP66",row6:"MFG|2031-04",
      barData:"A7-99413-02",barText:true,tblMono:true,
      footText:"Made in Sheffield",cPanel:"#c9cdd0",cText:"#1b1e20",cBorder:"#1b1e20",
      cSignal:"#c9cdd0",cSignalFg:"#1b1e20",
      holes:"h4",holeMm:3.5,holeInMm:5,cornerMm:3,markDepth:1.4,
      scratch:.4,scuff:.35,grime:.35,oil:.2,fade:0,yellow:0,craze:0}},

    {id:"phenolic",label:"Engraved phenolic legend",set:{
      format:"free",Wmm:80,Hmm:25,material:"phenol",marking:"cut",fieldInk:false,
      signal:"none",bHeader:false,bPicto:false,bMsg:true,bTable:false,bBar:false,bFoot:false,
      msgHead:"MAIN ISOLATOR",msgBody:"",msgCaps:true,msgAlign:"center",trackMsg:.06,
      panelOn:false,borderMm:0,marginMm:2.5,cornerMm:1.5,holes:"h2",holeMm:3,holeInMm:5,
      markDepth:1.2,scratch:.3,scuff:.25,grime:.45,oil:.15,fade:0,yellow:0,craze:0}},

    {id:"brass",label:"Engraved brass plaque",set:{
      format:"free",Wmm:150,Hmm:60,material:"brass",marking:"engrave",fieldInk:false,
      signal:"none",bHeader:false,bPicto:false,bMsg:true,bTable:false,bFoot:true,
      msgHead:"PUMP HOUSE No. 3",msgBody:"",msgAlign:"center",trackMsg:.08,
      footText:"NORTHGATE WATER BOARD · 1963",footAlign:"center",
      panelOn:false,borderMm:0.8,marginMm:4,cornerMm:2,cBorder:"#3a2f12",cText:"#2a2208",
      markDepth:1.5,scratch:.45,scuff:.4,grime:.55,oil:.2,fade:0,yellow:0}},

    {id:"placard3",label:"Placard — class 3 flammable",set:{
      format:"placard",dotClass:"3",dotText:"FLAMMABLE",unNumber:"1203",placardMm:273,
      material:"alu",marking:"print",bMsg:false,bFoot:false,bPicto:false,
      marginMm:2,borderMm:0,scratch:.3,scuff:.3,grime:.4,fade:.25}},

    {id:"placard7",label:"Placard — class 7 radioactive",set:{
      format:"placard",dotClass:"7",dotText:"RADIOACTIVE",unNumber:"",placardMm:273,
      material:"alu",marking:"print",bMsg:false,bFoot:false,bPicto:false,
      marginMm:2,borderMm:0,scratch:.25,scuff:.25,grime:.35,fade:.2}},

    {id:"pipeGas",label:"Pipe marker — natural gas",set:{
      format:"pipe",pipeClass:"flam",pipeLegend:"NATURAL GAS",pipeSub:"7 bar",
      pipeOd:114.3,pipeDir:"right",pipeWrap:"full",material:"vinyl",marking:"print",
      bMsg:false,bFoot:false,bPicto:false,panelOn:false,borderMm:0,marginMm:2,
      scratch:.25,scuff:.25,grime:.35,fade:.3,yellow:.2}},

    {id:"pipeWater",label:"Pipe marker — potable water",set:{
      format:"pipe",pipeClass:"water",pipeLegend:"POTABLE WATER",pipeSub:"",
      pipeOd:60.3,pipeDir:"both",pipeWrap:"full",material:"vinyl",marking:"print",
      bMsg:false,bFoot:false,bPicto:false,panelOn:false,borderMm:0,marginMm:2,
      scratch:.2,grime:.3,fade:.25}},

    {id:"lockout",label:"Lockout / tagout tag",set:{
      format:"tag",shape:"tag",Wmm:80,Hmm:150,material:"paper",marking:"print",
      signal:"danger",signalText:"DO NOT OPERATE",alertSym:false,hdrAlign:"center",
      bHeader:true,bPicto:false,bMsg:true,bTable:true,bBar:false,bFoot:true,
      msgHead:"EQUIPMENT LOCKED OUT",
      msgBody:"This tag and lock may only be removed by the person who fitted them.",
      row1:"NAME|",row2:"DEPT|",row3:"DATE|",row4:"",row5:"",row6:"",
      footText:"Do not remove · see the permit",
      holes:"grommet",holeMm:8,holeInMm:12,cornerMm:4,
      scratch:.3,scuff:.45,grime:.5,fade:.2,yellow:.3,peel:.2,craze:0}},

    {id:"radio",label:"Radiation area — retroreflective",set:{
      format:"ansi",Wmm:200,Hmm:150,material:"reflect",marking:"print",
      signal:"caution",signalText:"CAUTION",cSignal:"#f6be00",cSignalFg:"#000000",alertSym:true,
      bHeader:true,bPicto:true,bMsg:true,bTable:false,bFoot:false,
      nPicto:1,sym1:"trefoil",pFrame:"none",pictoPos:"row",cSym:"#9b0e6b",
      msgHead:"RADIATION AREA",msgBody:"Dosimeter required beyond this point.",
      glowAmt:.35,scratch:.2,scuff:.2,grime:.3,fade:.2}},

    {id:"laserplate",label:"Laser-marked anodised tag",set:{
      format:"free",Wmm:60,Hmm:30,material:"alu",marking:"laser",fieldInk:false,
      signal:"none",bHeader:false,bPicto:false,bMsg:false,bTable:true,bBar:true,bFoot:false,
      row1:"ASSET|NG-44812",row2:"CAL DUE|2032-06",row3:"",row4:"",row5:"",row6:"",
      barData:"NG-44812",barText:true,tblMono:true,tblCaps:true,
      panelOn:false,borderMm:0,marginMm:2,cornerMm:2,cText:"#e8ecef",cBorder:"#e8ecef",
      subAuto:false,cSub:"#3a3f44",holes:"none",
      scratch:.3,scuff:.25,grime:.2,oil:.1,fade:0,yellow:0,craze:0}},

    {id:"glyphs",label:"Unicode glyph cells",set:{
      format:"ansi",Wmm:150,Hmm:60,material:"vinyl",marking:"print",
      signal:"warning",alertSym:true,bHeader:true,bPicto:true,bMsg:true,bFoot:false,
      nPicto:4,sym1:"glyph",gly1:"☢",sym2:"glyph",gly2:"☣",sym3:"glyph",gly3:"⚡",
      sym4:"glyph",gly4:"☠",pFrame:"none",pictoPos:"row",cSym:"#111111",
      msgHead:"MULTIPLE HAZARDS",msgBody:"",
      scratch:.2,grime:.2,fade:.1}},

    {id:"old",label:"Twenty years on a pump",set:{
      format:"ansi",Wmm:100,Hmm:50,material:"vinyl",marking:"print",
      signal:"danger",alertSym:true,bHeader:true,bPicto:true,bMsg:true,bFoot:true,
      nPicto:1,sym1:"bolt",pFrame:"triangle",pictoPos:"left",
      msgHead:"HAZARDOUS VOLTAGE",msgBody:"Disconnect and lock out before servicing.",
      footText:"PN 4471-02",
      scratch:.75,scuff:.8,abrade:.55,grime:.75,oil:.4,fade:.85,yellow:.6,peel:.45,craze:.6}}
  ],

  /* Picking a stock size writes the two dimensions and drops back to Custom,
     so a real size is a starting point rather than a cage. Picking a signal
     word rewrites its colour pair, and a pipe's contents its colour field —
     each only on a real change, so none of them can fight the user. */
  derive:function(P,ui){
    if(P.stock!==lastStock){
      lastStock=P.stock;
      const s=STOCK_MM[P.stock];
      if(s){ui.set("Wmm",s[0]);ui.set("Hmm",s[1]);ui.set("stock","custom");lastStock="custom";}
    }
    /* A pair is rewritten only if it still holds the LAST word's pair — which
       is how a preset gets to set the word and its own colours in the same
       breath without this overwriting them a moment later, and how a colour
       somebody picked by hand survives the next change of word. */
    if(P.signal!==lastSignal){
      const prev=SIGNAL[lastSignal],now=SIGNAL[P.signal];
      const mine=!prev||(same(P.cSignal,prev.bg)&&same(P.cSignalFg,prev.fg));
      lastSignal=P.signal;
      if(now&&mine){ui.set("cSignal",now.bg);ui.set("cSignalFg",now.fg);}
    }
    if(P.pipeClass!==lastPipe){
      const prev=PIPEC[lastPipe],now=PIPEC[P.pipeClass];
      const mine=!prev||same(P.cField,prev.bg);
      lastPipe=P.pipeClass;
      if(now&&mine)ui.set("cField",now.bg);
    }
    /* a format that owns its own geometry should not leave the last format's
       shape on the panel claiming to be in charge */
    if(P.format!==lastFormat){
      lastFormat=P.format;
      if(P.shape!=="auto"&&FORMATS[P.format]&&FORMATS[P.format].kind==="block")ui.set("shape","auto");
    }
    if((P.nPicto|0)<1)ui.set("nPicto",1);
  },

  needs:function(P){
    const fmt=fmtOf(P);
    const n=[fmt,FORMATS[fmt].kind];
    if(fmt!=="placard"&&fmt!=="pipe")n.push("free-size");
    if(str(P.holes,"none")!=="none")n.push("holes");
    if(P.bPicto){
      n.push("picto");
      if(FORMATS[fmt].kind==="stack")n.push("spicto");
      for(let i=1;i<=clamp(P.nPicto|0,0,4);i++)if(P["sym"+i]==="glyph")n.push("glyph"+i);
    }
    const mat=matOf(P);
    if(mat===MATS.glow||mat.bead>0||num(P.glowAmt,0)>0)n.push("glow");
    return n;
  },

  readout:function(P){
    const G=sizeOf(P),L=layout(P,G);
    const d=x=>x.toFixed(x<20?1:0);
    let m="<b>"+d(G.Wmm)+" × "+d(G.Hmm)+" mm</b> · "+G.TW+" × "+G.TH+" px<br>"+
          "<b>"+Math.round(G.dpi)+" dpi</b> · "+G.mmPerPx.toFixed(3)+" mm per texel";
    if(G.capped)m+='<br><span class="warn">capped from '+G.asked+' px wide — at that width this '+
      'shape would be '+Math.round(G.asked*G.Hmm/G.Wmm)+' px tall, which is more memory than a '+
      'browser will give you</span>';
    if(G.dpi<150)m+='<br><span class="warn">under 150 dpi — fine as a texture, too coarse to '+
      'send to a printer</span>';
    else if(G.dpi>=300)m+="<br>print-ready at this size";

    /* the smallest thing on the label, in texels, because that is what decides
       whether it survives the rasteriser */
    const kl=L.border*G.pxPerMm;
    if(L.border>0.005&&kl<1.3)m+='<br><span class="warn">the '+L.border.toFixed(2)+
      " mm keyline is "+kl.toFixed(1)+" texels — raise the resolution or thicken it</span>";

    if(L.fmt==="pipe"){
      const T=a13Of(Math.max(8,num(P.pipeOd,114.3)));
      m+="<br>ASME A13.1 row: <b>"+T.note+"</b> → "+T.band+" mm field, "+
         T.cap.toFixed(1)+" mm caps";
      const capPx=T.cap*G.pxPerMm;
      if(T.cap>L.block.h*0.62)m+='<br><span class="warn">the table\'s '+T.cap.toFixed(1)+
        " mm caps will not fit this band — the legend is being set smaller than the standard "+
        "asks, so either wrap the full circumference or check the diameter</span>";
      else if(capPx<8)m+="<br>caps are "+capPx.toFixed(0)+" px — legible, but not crisp";
      if(P.pipeWrap==="full")m+="<br>full wrap of a "+num(P.pipeOd,114.3).toFixed(1)+
        " mm pipe — circumference "+(num(P.pipeOd,114.3)*Math.PI).toFixed(0)+" mm";
    }
    if(L.fmt==="placard"){
      const C=DOTC[P.dotClass]||DOTC["3"];
      const k=Math.min(L.block.w,L.block.h)/PLACARD.side;
      m+="<br>class <b>"+P.dotClass+" — "+C.label+"</b> · inner line "+
         (PLACARD.line*k).toFixed(1)+" mm, set in "+(PLACARD.inset*k).toFixed(1)+" mm";
    }
    if(L.fmt==="nfpa")
      m+="<br>health <b>"+(P.nHealth|0)+"</b> · fire <b>"+(P.nFire|0)+"</b> · instability <b>"+
         (P.nReact|0)+"</b>"+(P.nSpecial!=="none"?" · "+String(P.nSpecial).toUpperCase():"");
    if(L.fmt==="iso"){
      const cat=ISOCAT[P.isoCat]||ISOCAT.warn;
      m+="<br>"+cat.label.toLowerCase();
    }

    if(P.bBar&&str(P.barData,"").length&&L.bands.bar){
      const code=code39(str(P.barData,""),num(P.barRatio,2.5));
      if(!code.els.length)m+='<br><span class="warn">nothing in that barcode survives Code 39 — '+
        "it carries 0-9, A-Z and - . space $ / + % only</span>";
      else{
        const modMm=L.bands.bar.w/(code.modules+20);
        m+="<br>Code 39 · "+code.text.length+" characters · narrow module "+
           modMm.toFixed(3)+" mm ("+(modMm*G.pxPerMm).toFixed(1)+" px)";
        if(modMm<0.19)m+='<br><span class="warn">a narrow module under 0.19 mm is below what a '+
          "hand scanner will read — shorten the data or make the label wider</span>";
        if(modMm*G.pxPerMm<2)m+='<br><span class="warn">and under two texels wide, so it will '+
          "not even render cleanly</span>";
        if(str(P.barData,"").toUpperCase()!==code.text)
          m+="<br>dropped characters the symbology cannot carry: it reads <b>"+code.text+"</b>";
      }
    }
    if(P.bPicto&&L.cells.length){
      const b=L.bands.pic||L.bands.picIn||L.block;
      if(b){
        const s=Math.min(b.w/L.cells.length,b.h);
        m+="<br>"+L.cells.length+" pictogram"+(L.cells.length>1?"s":"")+" at "+
           s.toFixed(1)+" mm ("+Math.round(s*G.pxPerMm)+" px)";
        if(s*G.pxPerMm<24)m+='<br><span class="warn">a symbol under about 24 texels loses its '+
          "detail — raise the resolution or give it more room</span>";
      }
      const gl=L.cells.filter(c=>c.glyph).length;
      if(gl)m+="<br>"+gl+" cell"+(gl>1?"s are":" is")+" a <b>Unicode glyph</b>, drawn from the "+
        "browser's own fonts — check it is not a box";
    }
    const mat=matOf(P),MKp=markOf(P);
    const thick=num(P.thickMm,0)>0?num(P.thickMm,0):mat.thick;
    m+="<br>"+mat.name+", "+thick.toFixed(2)+" mm · "+MKp.name;
    if(MKp.depth!==0){
      const dmm=Math.abs(MKp.depth*clamp(num(P.markDepth,1),0,4));
      m+=" at "+dmm.toFixed(2)+" mm "+(MKp.depth<0?"deep":"proud");
      if(dmm*G.pxPerMm<1.5)m+=" — under 1.5 texels of relief, so the normal map will be faint";
    }
    if(str(P.holes,"none")!=="none")m+="<br>"+holesOf(P,G).length+" × Ø"+
      num(P.holeMm,4).toFixed(1)+" mm holes, "+num(P.holeInMm,6).toFixed(1)+" mm in";
    return m;
  },

  tileTag:function(){return "cut-out · alpha is the blank";},
  sizeTag:function(P){const G=sizeOf(P);return FORMATS[G.fmt].label+" · "+
    G.Wmm.toFixed(0)+" × "+G.Hmm.toFixed(0)+" mm";},

  /* the glow is the colour of the sheet, not the runtime's warm default */
  writers:function(B,P){
    const E=B.EMI,A=B.A,mat=matOf(P),c=hex2rgb(str(P.cGlow,"")||"#8bff9e");
    const own=(mat===MATS.glow);
    return {emissive:function(i,o,k){
      const e=E[i]/255;
      if(own){o[k]=c[0]*e;o[k+1]=c[1]*e;o[k+2]=c[2]*e;}
      else{o[k]=A[i*3]*e;o[k+1]=A[i*3+1]*e;o[k+2]=A[i*3+2]*e;}
      return 255;
    }};
  },

  /* A printed label and a worn one are two different deliverables and people
     want both: the clean artwork to send to a printer or to lay on a clean
     asset, the worn one for the thing that has been in service. One switch,
     one archive. */
  variants:function(P){
    const worn=num(P.scratch,0)+num(P.scuff,0)+num(P.abrade,0)+num(P.grime,0)+
               num(P.oil,0)+num(P.fade,0)+num(P.yellow,0)+num(P.peel,0)+num(P.craze,0);
    return (worn>0.01&&P.cleanCut!==false)
      ?[{id:"clean",label:"as printed — no wear",set:{scratch:0,scuff:0,abrade:0,grime:0,
          oil:0,fade:0,yellow:0,peel:0,craze:0}}]:[];
  },

  size:function(P,preview){
    const G=sizeOf(P,preview?384:0);
    return {w:G.TW,h:G.TH};
  },
  build:build,

  /* metres, always — a label is the one thing in the app somebody will
     measure against a real one */
  plan:function(P){
    const G=sizeOf(P);
    return {w:G.Wmm/1000,h:G.Hmm/1000,cutout:true};
  },

  fileBase:function(P,W){return "label_"+fmtOf(P)+"_"+(P.seed|0)+"_"+W;},

  readme:function(P,info){
    const G=sizeOf(P,info.W),L=layout(P,G);
    const mat=matOf(P),MKp=markOf(P);
    const thick=num(P.thickMm,0)>0?num(P.thickMm,0):mat.thick;
    const relief=(info.hMax-info.hMin)*G.Wmm;
    const out=["Texture Forge · label — "+FORMATS[G.fmt].label,
      "",
      "Seed "+(P.seed|0)+"   Texture "+info.W+" x "+info.H+" px",
      "The label is "+G.Wmm.toFixed(1)+" x "+G.Hmm.toFixed(1)+" mm — "+Math.round(G.dpi)+
        " dpi, one texel is "+G.mmPerPx.toFixed(4)+" mm.",
      "Scale your plane to that and every dimension on it is the dimension it was drawn at.",
      "",
      "This is ONE LABEL, not a tiling material. The alpha channel is the blank: outside the",
      "cut line, and inside any fixing hole, it is transparent.",
      ""];
    if(G.fmt==="pipe"){
      const T=a13Of(Math.max(8,num(P.pipeOd,114.3)));
      out.push("ASME A13.1, "+T.note+": colour field "+T.band+" mm along the pipe, letters at "+
        T.cap.toFixed(1)+" mm cap height. Contents class: "+(PIPEC[P.pipeClass]||PIPEC.flam).label+".",
        (P.pipeWrap==="full")
          ?("Height is the full circumference of a "+num(P.pipeOd,114.3).toFixed(1)+
            " mm pipe, so it wraps once with no overlap.")
          :"Height is a band rather than a full wrap.","");
    }
    if(G.fmt==="placard"){
      const C=DOTC[P.dotClass]||DOTC["3"];
      const k=Math.min(L.block.w,L.block.h)/PLACARD.side;
      out.push("49 CFR 172 class "+P.dotClass+" ("+C.label+"). The inner line is "+
        (PLACARD.line*k).toFixed(2)+" mm wide and set "+(PLACARD.inset*k).toFixed(2)+" mm in,",
        "which is 172.519's 12.7 mm and 12.7 mm scaled from the 273 mm reference.","");
    }
    if(G.fmt==="nfpa")out.push("NFPA 704: health "+(P.nHealth|0)+", flammability "+(P.nFire|0)+
      ", instability "+(P.nReact|0)+
      (P.nSpecial!=="none"?", special "+String(P.nSpecial).toUpperCase():", no special notation")+".","");
    if(G.fmt==="iso")out.push("ISO 3864-1 / ISO 7010 geometry: "+
      (ISOCAT[P.isoCat]||ISOCAT.warn).label.toLowerCase()+".","");
    if(P.bBar&&str(P.barData,"").length){
      const code=code39(str(P.barData,""),num(P.barRatio,2.5));
      if(code.els.length&&L.bands.bar){
        const modMm=L.bands.bar.w/(code.modules+20);
        out.push("The barcode is real Code 39 reading *"+code.text+"* — start and stop included,",
          "narrow module "+modMm.toFixed(3)+" mm, wide/narrow "+num(P.barRatio,2.5).toFixed(1)+
          ":1, ten narrow modules of quiet zone each side.","");
      }
    }
    const gl=L.cells.filter(c=>c.glyph);
    if(gl.length)out.push("Pictogram cells drawn as Unicode glyphs from the browser's fonts: "+
      gl.map(c=>c.text).join(" ")+". Everything else is drawn from paths.","");
    out.push(
      "Substrate: "+mat.name+", "+thick.toFixed(2)+" mm thick.",
      "Applied by: "+MKp.name+(MKp.depth!==0
        ?", leaving the marks "+Math.abs(MKp.depth*clamp(num(P.markDepth,1),0,4)).toFixed(2)+
          " mm "+(MKp.depth<0?"below":"above")+" the face."
        :", flush with the face."),
      "",
      "basecolor.png  sRGB albedo. Alpha is the blank.",
      "normal.png     Tangent space, "+info.normalNote+". Non-colour.",
      "roughness.png  Linear grey. Ink, substrate and every scratch read differently.",
      "metallic.png   Linear grey — "+mat.name+" sits at "+mat.met.toFixed(2)+
        (P.marking==="print"||P.marking==="engrave"
          ?", and printed ink over it is a dielectric, so it goes to black under the artwork."
          :", and the marks are the material itself, so it does not."),
      "ao.png         Linear grey. The grooves and the cut edge carry it.",
      "emissive.png   "+(num(P.glowAmt,0)>0
        ?("Glowing at "+num(P.glowAmt,0).toFixed(2)+
          (mat===MATS.glow?" — photoluminescent, so it glows where it is NOT printed."
                          :" — driven by the artwork."))
        :"Black — nothing here is lit. Raise Glow and it fills in."),
      "height.png     8-bit displacement spanning "+relief.toFixed(3)+" mm of real relief",
      "               (0-1 maps to "+(info.hMax-info.hMin).toFixed(6)+" in label-width units).",
      "height16.png   The same field at 16 bits — use this one, because the sheet's own",
      "               thickness eats most of the range and leaves the engraving very little.",
      "orm.png        R = AO, G = roughness, B = metallic.",
      "opacity.png    The blank, including the fixing holes.",
      "",
      "ON THE STANDARDS. The geometry and colour pairings here follow the published",
      "proportions of these signs closely enough to read as the real thing, and the",
      "tables that are numbers rather than drawings — ASME A13.1's band and cap heights,",
      "49 CFR's 273 mm and 12.7 mm, Code 39's element patterns — are the tables. It is",
      "still NOT a certified reproduction. If one of these is going onto real plant,",
      "check it against the standard you are held to before you print it.");
    return out.join("\n");
  }
});

/* what the tests reach for */
window.ForgeLabel={
  SYM:SYM,SYM_BY:SYM_BY,SIGNAL:SIGNAL,ISOCAT:ISOCAT,PIPEC:PIPEC,DOTC:DOTC,
  MATS:MATS,MARKS:MARKS,FORMATS:FORMATS,STOCK_MM:STOCK_MM,A13:A13,DN:DN,PLACARD:PLACARD,
  a13Of:a13Of,code39:code39,sizeOf:sizeOf,layout:layout,shapeOf:shapeOf,holesOf:holesOf,
  innerBox:innerBox,inkOn:inkOn,styleOf:styleOf,fitText:fitText,splitPara:splitPara,
  tableRows:tableRows,pictoCells:pictoCells,CAP:CAP
};

})();
