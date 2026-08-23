/* =====================================================================
   MODE: fence — seamless, alpha cut-out fencing
   =====================================================================
   Timber board and picket, split rail, chain link, welded mesh panel,
   ornamental iron and palisade, corrugated hoarding — all dimensioned in
   real INCHES, because fencing is sold in inches: a 5.5 in board, a 3.5 in
   post, a 2 in mesh, a 0.148 in 9-gauge wire, a 3 in corrugation.

   THE ASPECT PROBLEM, which is what makes this mode interesting.
   A fence run is long and short. The tile has to hold a whole number of
   bays across, so its width is set by the bay; its height is set by the
   fence. Those two numbers have no reason to match, and WebGL1 — and
   every engine's mipmapper — will not repeat a texture whose axes are not
   powers of two. So the tile height is k x tile width with k a POWER OF
   TWO, chosen as the smallest one that clears the fence plus a hard 4 in
   of ground and 4 in of air, and the leftover is spent 40/60 on ground
   and sky at UNCHANGED DENSITY. Nothing is stretched: a circle stays a
   circle, and the chain-link weave stays at 45 degrees, which is the
   whole reason the diamond maths below works.

   THE OTHER HALF OF seamless:true is that the tile must wrap in V too,
   and a card with opaque soil along its bottom edge cannot. So the
   ground is a BAND OF CLUTTER THAT FADES TO ZERO ALPHA before the edge,
   never a ground plane: both the top and the bottom rows of the tile are
   empty air by construction, and every transparent texel carries the
   same background constants. That also composites onto terrain far
   better than a hard line of dirt.

   THE SEAM falls on a post CENTRELINE. The post is drawn once, half in
   the last texels of the tile and half in the first, and every per-piece
   random is hashed on the piece index MODULO the count per tile, so
   piece j and piece j+n are the same piece one tile over.

   ALPHA IS COVERAGE, never a threshold — strip() below is the exact area
   of a feature inside a texel. A 9-gauge wire is 1.3 texels wide at 1024,
   so it is drawn as a haze of the correct density rather than an aliased
   line, and the readme tells you not to alpha-test it.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      hashi=Forge.hashi,vnoise=Forge.vnoise,fbm=Forge.fbm,
      vnoise2=Forge.vnoise2,fbm2=Forge.fbm2,hex2rgb=Forge.hex2rgb;

const R2=Math.SQRT2,TAU=Math.PI*2;
const md=(a,n)=>((a%n)+n)%n;
const sat=x=>x<0?0:(x>1?1:x);
const frac=x=>x-Math.floor(x);
function hexOr(s,d){return hex2rgb(/^#[0-9a-fA-F]{6}$/.test(s||"")?s:d);}

/* ---- the two coverage primitives everything in this mode is built from ----
   strip(): the exact area of a strip of half-width r, at signed distance d,
   inside a texel of width ipx. Two regimes fall out of one expression —
   wide feature, a one-texel geometric ramp; thin feature, a haze of exactly
   2r/ipx everywhere it passes. The second is what keeps a mip chain honest.
   slab(): the same thing for a bounded interval, used for every vertical
   extent (a board's top and bottom, the fabric's selvage).  */
function strip(d,r,ipx){
  const lo=Math.max(d-ipx*0.5,-r),hi=Math.min(d+ipx*0.5,r);
  return hi>lo?(hi-lo)/ipx:0;
}
function slab(t,lo,hi,ipx){
  const a=Math.max(t-ipx*0.5,lo),b=Math.min(t+ipx*0.5,hi);
  return b>a?(b-a)/ipx:0;
}
/* coverage of a disc of radius R at distance d — one texel of edge */
function disc(d,R,ipx){return sat((R-d)/ipx+0.5);}

/* wrapping worley on an integer lattice of period N, hazard.js's */
let W_f1=0,W_f2=0,W_cx=0,W_cy=0;
function worley(x,y,NX,NY,seed,jit){
  const xi=Math.floor(x),yi=Math.floor(y);
  let d1=1e9,d2=1e9,bx=0,by=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const cx=xi+dx,cy=yi+dy;
    const wx=md(cx,NX),wy=md(cy,NY);
    const fx=cx+0.5+(hashi(wx,wy,seed)-0.5)*jit;
    const fy=cy+0.5+(hashi(wx,wy,seed+7717)-0.5)*jit;
    const ax=x-fx,ay=y-fy,d=ax*ax+ay*ay;
    if(d<d1){d2=d1;d1=d;bx=wx;by=wy;}else if(d<d2)d2=d;
  }
  W_f1=Math.sqrt(d1);W_f2=Math.sqrt(d2);W_cx=bx;W_cy=by;
}

/* separable box blur that wraps in x and clamps in y — the tile repeats
   along the run, and its top and bottom rows are empty air, so clamping
   there costs nothing and avoids a false slope across the kill band */
function blurWH(src,w,h,r){
  const tmp=new Float32Array(w*h),out=new Float32Array(w*h),n=r*2+1;
  for(let y=0;y<h;y++){
    const o=y*w;let sum=0;
    for(let k=-r;k<=r;k++)sum+=src[o+md(k,w)];
    for(let x=0;x<w;x++){
      tmp[o+x]=sum/n;
      sum-=src[o+md(x-r,w)];sum+=src[o+md(x+r+1,w)];
    }
  }
  for(let x=0;x<w;x++){
    let sum=0;
    for(let k=-r;k<=r;k++)sum+=tmp[clamp(k,0,h-1)*w+x];
    for(let y=0;y<h;y++){
      out[y*w+x]=sum/n;
      sum-=tmp[clamp(y-r,0,h-1)*w+x];sum+=tmp[clamp(y+r+1,0,h-1)*w+x];
    }
  }
  return out;
}

/* ============================ trade tables ============================ */

/* Face width and depth in inches, always the ACTUAL size — a 4x4 is 3.5,
   a "1 5/8 in" line post is 1.660 OD, because that is what turns up. */
const POSTS={
  t44 :{label:"4×4 timber (3.5 in)",       w:3.5,  d:3.5,  wood:1,ease:0.125},
  t66 :{label:"6×6 timber (5.5 in)",       w:5.5,  d:5.5,  wood:1,ease:0.1875},
  t46 :{label:"4×6 timber (3.5 × 5.5)",    w:3.5,  d:5.5,  wood:1,ease:0.125},
  rnd4:{label:"4 in round timber",         w:4,    d:4,    wood:1,round:1},
  p138:{label:"1⅝ in line pipe (1.660)",   w:1.660,d:1.660,round:1,steel:1},
  p178:{label:"1⅞ in line pipe (1.900)",   w:1.900,d:1.900,round:1,steel:1},
  p238:{label:"2⅜ in terminal (2.375)",    w:2.375,d:2.375,round:1,steel:1,term:1},
  p278:{label:"2⅞ in terminal (2.875)",    w:2.875,d:2.875,round:1,steel:1,term:1},
  p400:{label:"4 in gate post",            w:4.000,d:4.000,round:1,steel:1,term:1},
  sq2 :{label:"2 in square tube",          w:2,    d:2,    steel:1},
  sq25:{label:"2½ in square tube",         w:2.5,  d:2.5,  steel:1},
  hsec:{label:"Steel H-section (4 × 1¾)",  w:4.0,  d:1.75, steel:1,hsec:1},
  conc:{label:"Concrete morticed (4 × 4)", w:4.0,  d:4.0,  conc:1}
};
const POSTW={};for(const k in POSTS)POSTW[k]=POSTS[k].w;

/* cap rise above the post top, in inches: m*postW + c */
const CAPS={
  none   :{m:0,   c:0,    label:"None"},
  flatcut:{m:0,   c:0,    label:"Flat cut"},
  bevel  :{m:0,   c:0.47, label:"Bevel cut"},
  pyramid:{m:0.5, c:0,    label:"Pyramid cut"},
  plate  :{m:0,   c:1.0,  label:"Applied plate"},
  ball   :{m:0,   c:3.5,  label:"Ball finial"},
  gothic :{m:0,   c:4.0,  label:"Gothic finial"},
  dome   :{m:0.5, c:0,    label:"Pressed dome"},
  loop   :{m:0.5, c:0.25, label:"Loop / eye top"},
  spear  :{m:0,   c:5.0,  label:"Spear"}
};

/* corrugation profiles: pitch and depth in inches, and the wave shape */
const CORPROF={
  sin3 :{p:3,   d:0.875,s:"sin", label:"Corrugated — 3 in × 7/8"},
  sin27:{p:2.67,d:0.5,  s:"sin", label:"Corrugated — 2.67 in × 1/2"},
  mini :{p:1.25,d:0.25, s:"sin", label:"Mini-corrugate — 1¼ in"},
  box  :{p:7.87,d:1.26, s:"box", label:"Box profile — 7.87 in rib"},
  trap :{p:4.7, d:1.1,  s:"trap",label:"Trapezoidal cladding"}
};

/* wire gauges, so the readout can name the fabric the user actually built */
const GAUGES=[[0.192,"6 ga"],[0.177,"7 ga"],[0.162,"8 ga"],[0.148,"9 ga"],
              [0.135,"10 ga"],[0.120,"11 ga"],[0.113,"11.5 ga"],[0.0985,"12.5 ga"]];
function gaugeName(w){
  let best=GAUGES[0],bd=1e9;
  for(const q of GAUGES){const d=Math.abs(q[0]-w);if(d<bd){bd=d;best=q;}}
  return best[1];
}

/* How the coating behaves. Metallic is honest: galvanised and bare steel are
   metal, powder coat / paint / vinyl are dielectric films over it, and rust
   is iron oxide — a dielectric, the same correction hazard.js makes. */
const COAT={
  hdg  :{label:"Hot-dip galvanised",  met:1,rough:0.42,id:5,spangle:1},
  ezg  :{label:"Electro-galvanised",  met:1,rough:0.34,id:5,spangle:0},
  pc   :{label:"Powder coated",       met:0,rough:0.38,id:6,spangle:0},
  pvc  :{label:"Vinyl coated",        met:0,rough:0.58,id:6,spangle:0},
  paint:{label:"Painted",             met:0,rough:0.46,id:6,spangle:0},
  bare :{label:"Bare steel",          met:1,rough:0.55,id:5,spangle:0}
};

const TYPELABEL={board:"board privacy",picket:"picket",rail:"split rail",
  chain:"chain link",mesh:"welded wire site panel",iron:"iron / palisade",
  corr:"corrugated hoarding"};

/* Flat material ids. Thirteen entries, far apart in hue so a nearest-colour
   lookup on the exported PNG is unambiguous. Written BEFORE the dirt pass,
   so a filthy post still reads as timber and not as ground. */
const IDCOL=[
  [  0,  0,  0],   //  0  background / air
  [178,150, 96],   //  1  timber post
  [140,116, 74],   //  2  timber rail
  [206,178,120],   //  3  board / picket / pale
  [236,236,228],   //  4  paint film
  [186,190,196],   //  5  galvanised steel — posts, frame, sheet
  [ 64, 72, 80],   //  6  powder-coated / painted steel
  [120,200,240],   //  7  chain-link fabric
  [255,196, 64],   //  8  hardware — ties, bands, caps, fixings, couplers
  [176, 80, 32],   //  9  rust
  [ 72,120, 56],   // 10  moss / algae / lichen / vines
  [110, 96, 78],   // 11  ground clutter, splash soil
  [180, 60,200]    // 12  plastic — slats, vinyl, rubber feet
];

/* fly-poster stock: the colours a cheap two-run screen print comes in */
const PAPER=[[228,224,214],[224,64,52],[240,196,42],[52,96,176],[236,236,230],
             [232,128,32],[64,160,88],[220,210,190]];

const KS=[0.25,0.5,1,2,4];

/* ============================ the tile ============================
   One pure function of the parameters, shared by size(), derive(),
   readout(), readme() and build(). Every periodic count is snapped here and
   the real dimension derived back from the snapped count, so there is
   exactly one place that decides what actually gets built. */
function geo(P){
  const type=P.type||"board";
  const bayIn=clamp(+P.bayFt||8,2,40)*12;
  const bays=Math.max(1,(P.baysPerTile|0)||1);
  const tileWin=bayIn*bays;
  const pk=POSTS[P.postType]||POSTS.t44;
  const postW=clamp(+P.postW||pk.w,0.5,12);
  const postD=(pk.round||pk.hsec)?postW*(pk.d/pk.w):postW*(pk.d/pk.w);
  const capk=CAPS[P.postCap]||CAPS.none;
  const capRise=capk.m*postW+capk.c;
  const proud=clamp(+P.postProud||0,0,24);
  const fenceH=clamp(+P.fenceH||72,12,240);
  const botGap=clamp(+P.botGapIn||0,0,36);
  const subs=clamp(P.subBays|0,0,2);

  const g={type:type,bayIn:bayIn,bays:bays,tileWin:tileWin,
    post:pk,postW:postW,postD:postD,postRound:!!pk.round,postWood:!!pk.wood,
    capRise:capRise,capKind:P.postCap||"none",proud:proud,
    fenceH:fenceH,botGap:botGap,subs:subs,
    nPosts:bays*(1+subs),postPitch:tileWin/(bays*(1+subs)),
    postTop:fenceH+proud,railY:[]};
  let topMost=fenceH;

  if(type==="board"||type==="picket"){
    const bw=clamp(+P.boardW||5.5,0.75,24);
    const lay=(type==="picket")?"spaced":(P.layout||"butted");
    const ov=clamp(+P.overlapIn||1,0.125,8);
    const two=(lay==="bob"||lay==="shadow");
    /* the board width is a milled size and is held; the gap absorbs the snap,
       because the gap is the only number a fitter actually chooses */
    const pitchReq=two?Math.max(0.5,2*(bw-ov)):bw+clamp(+P.gapIn||0,0,24);
    const n=Math.max(1,Math.round(tileWin/pitchReq));
    g.nBoards=n;g.pitch=tileWin/n;g.pitchReq=pitchReq;g.boardW=bw;g.twoCourse=two;
    g.gapBuilt=Math.max(0,g.pitch-bw);
    g.overlapBuilt=Math.max(0,bw-g.pitch*0.5);
    g.layout=lay;
    g.boardT=clamp(+P.boardT||0.75,0.125,3);
    g.railsN=clamp(P.railsN|0,1,4)||2;
    g.railW=clamp(+P.railW||3.5,1,12);
    g.railT=clamp(+P.railT||1.5,0.375,4);
    g.topCut=P.topCut||"flat";
    g.topCutIn=clamp(+P.topCutIn||0,0,12);
    g.boardTop=fenceH;
    /* top rail 10 in below the board tops, bottom rail 10 in above grade —
       the real spacing, spread evenly when there are three or four */
    const hi=Math.max(botGap+g.railW,fenceH-10),lo=Math.min(hi,botGap+10);
    for(let i=0;i<g.railsN;i++)
      g.railY.push(g.railsN===1?(lo+hi)*0.5:lerp(lo,hi,i/(g.railsN-1)));
    if(g.topCut==="point"||g.topCut==="gothic")topMost=fenceH+g.topCutIn;
  }else if(type==="rail"){
    g.railKind=P.railKind||"split";
    g.srRails=clamp(P.srRails|0,1,5)||3;
    g.srThick=clamp(+P.srThick||3.5,0.5,10);
    g.srDepth=clamp(+P.srDepth||5,1,16);
    g.srMort=clamp(+P.srMortIn||4,0.5,16);
    g.srTaper=clamp(+P.srTaper||0,0,1);
    g.mortOverlap=postW*0.9;                 // each rail runs 0.45*postW into the post
    const top=fenceH-g.srDepth*0.5,bot=Math.max(botGap+g.srDepth*0.5,10);
    for(let i=0;i<g.srRails;i++)
      g.railY.push(g.srRails===1?top:lerp(bot,top,i/(g.srRails-1)));
  }else if(type==="chain"){
    const wire=clamp(+P.gauge||0.148,0.04,0.4);
    const meshReq=clamp(+P.meshIn||2,0.25,8);
    /* Perpendicular centre-to-centre pitch of one wire family is mesh + wire;
       the two families run at 45 deg, so the diamond's period ALONG THE RUN is
       that times root two. A diagonal lattice that does not close on the tile
       edge prints a seam no amount of blending hides, so the count is snapped
       and the mesh derived back from it. */
    const Dreq=(meshReq+wire)*R2;
    const perBay=(P.meshFit==="bay");
    const span=perBay?bayIn:tileWin;
    const n=Math.max(1,Math.round(span/Dreq));
    g.wire=wire;g.D=span/n;g.nx=perBay?n*bays:n;g.meshReq=meshReq;
    g.meshBuilt=Math.max(0.02,g.D/R2-wire);
    const n2=Math.max(1,Math.round(2*tileWin/Dreq));
    g.meshBuilt2=Math.max(0.02,(2*tileWin/n2)/R2-wire);
    g.open=Math.pow(g.meshBuilt/(g.meshBuilt+wire),2);
    /* The two wire families only cross at heights that are whole multiples of
       half a diamond, so BOTH selvages have to land on that lattice or the
       knuckles have nothing to join. Snap the bottom of the fabric to it and
       take a whole number of half-rows up. */
    const halfD=g.D*0.5;
    g.fabBot=Math.max(halfD,Math.round(Math.max(0.5,botGap||2)/halfD)*halfD);
    const nv=Math.max(2,Math.round(Math.max(4,fenceH-g.fabBot)/halfD));
    g.nv=nv;g.fabricH=nv*halfD;g.fabTop=g.fabBot+g.fabricH;
    g.postTop=g.fabTop+Math.max(proud,1);
    g.topRail=!!P.topRail;g.topRailD=1.660;
    g.tensWire=!!P.tensWire;g.tensBar=!!P.tensBar&&!!pk.term;
    const at=P.armType||"none";
    g.armType=at;g.armLen=clamp(+P.armLenIn||12,3,36);
    g.armRise=(at==="none")?0:((at==="avert")?g.armLen:g.armLen*0.70711);
    g.strandGap=clamp(+P.strandGap||4,1.5,12);
    g.armStrands=(at==="none")?0:3;
    g.selvTopRise=(P.selvTop==="barb")?wire*1.2:wire*0.9;
    topMost=Math.max(g.fabTop+g.selvTopRise,
                     g.topRail?g.fabTop-1+g.topRailD*0.5:0,
                     g.postTop+g.armRise);
  }else if(type==="mesh"){
    const mw=clamp(+P.mpWIn||137.8,24,300),mh=clamp(+P.mpHIn||78.7,24,200);
    const tube=clamp(+P.mpTube||1.575,0.4,4);
    const inW=Math.max(1,bayIn-2*tube),inH=Math.max(1,mh-2*tube);
    const nAx=Math.max(1,Math.round(inW/clamp(+P.mpApW||3.94,0.4,40)));
    const nAy=Math.max(1,Math.round(inH/clamp(+P.mpApH||11.81,0.4,60)));
    g.mpW=mw;g.mpH=mh;g.mpTube=tube;g.mpWire=clamp(+P.mpWire||0.138,0.03,0.6);
    g.nAx=nAx;g.nAy=nAy;g.apW=inW/nAx;g.apH=inH/nAy;
    g.apWreq=clamp(+P.mpApW||3.94,0.4,40);g.apHreq=clamp(+P.mpApH||11.81,0.4,60);
    g.panelBot=(P.mpFeet===false)?clamp(fenceH-mh,0,36):3.6;   // it stands in its feet
    g.postTop=g.panelBot+mh;
    g.mpRound=!!P.mpRound;g.mpFeet=!!P.mpFeet;
    topMost=g.postTop;
  }else if(type==="iron"){
    g.ironStyle=P.ironStyle||"tube";
    const pal=g.ironStyle!=="tube";
    const bw=clamp(+P.pkBarW||(pal?2.75:0.75),0.2,6);
    const gapReq=clamp(+P.pkGap||(pal?3.15:3.9375),0.2,16);
    const n=Math.max(1,Math.round(tileWin/(bw+gapReq)));
    g.nPk=n;g.pkPitch=tileWin/n;g.pkBarW=bw;g.pkGapReq=gapReq;
    g.pkGapBuilt=Math.max(0,g.pkPitch-bw);
    g.pkT=clamp(+P.pkT||(pal?0.7:0.75),0.06,3);
    g.pkRails=clamp(P.pkRails|0,1,3)||2;
    g.irRailW=clamp(+P.irRailW||1,0.5,4);
    g.pkTop=P.pkTop||"spear";
    g.pkTopIn=clamp(+P.pkTopIn||4.5,0,12);
    g.puppy=clamp(+P.puppy||0,0,1);
    g.railTop=fenceH-(g.pkTop==="flat"?0:g.pkTopIn);
    const lo=Math.max(botGap+g.irRailW,6),hi=Math.max(lo,g.railTop-g.irRailW*0.5);
    for(let i=0;i<g.pkRails;i++)
      g.railY.push(g.pkRails===1?(lo+hi)*0.5:lerp(lo,hi,i/(g.pkRails-1)));
    g.postTop=Math.max(fenceH,g.railTop)+proud;
  }else{                                        // corr
    const pr=CORPROF[P.corProfile];
    const p=clamp(+P.corPitch||(pr?pr.p:3),0.4,16);
    const nC=Math.max(1,Math.round(tileWin/p));
    g.nCorr=nC;g.corPitch=tileWin/nC;g.corPitchReq=p;
    g.corShape=pr?pr.s:"sin";
    g.corDepth=clamp(+P.corDepth||0.875,0.03,4);
    const cvr=clamp(+P.corCover||32,8,120);
    const nS=Math.max(1,Math.round(tileWin/cvr));
    g.nSheets=nS;g.corCover=tileWin/nS;g.corCoverReq=cvr;
    g.sheetBot=Math.max(botGap,1);g.sheetTop=fenceH;
    g.postTop=Math.max(1,fenceH-2);
    /* horizontal rails behind, at 24 in centres */
    const nR=Math.max(2,Math.round((fenceH-g.sheetBot)/24)+1);
    for(let i=0;i<nR;i++)g.railY.push(lerp(g.sheetBot+6,fenceH-6,nR===1?0.5:i/(nR-1)));
    topMost=fenceH;
  }

  topMost=Math.max(topMost,g.postTop+capRise);
  g.topMost=topMost;
  g.Vhard=topMost+8;                            // 4 in of ground, 4 in of air — the floor
  const forced=(P.aspectMode&&P.aspectMode!=="auto")?+P.aspectMode:0;
  let k=forced>0?forced:4;
  if(!forced)for(let i=0;i<KS.length;i++){if(KS[i]*tileWin>=g.Vhard){k=KS[i];break;}}
  const tileHin=k*tileWin,slack=Math.max(0.01,tileHin-topMost);
  const below=(slack<=8)?Math.max(0,slack*0.4):clamp(0.40*slack,4,15);
  g.k=k;g.auto=!forced;g.tileHin=tileHin;g.below=below;g.air=slack-below;
  g.vGround=1-below/tileHin;
  g.vTop=1-(below+topMost)/tileHin;
  g.skyFrac=g.vTop;                             // row 0 is the top of the image
  return g;
}
const aspectK=P=>geo(P).k;
const sizeCap=k=>(k>=4)?1024:((k>=2)?2048:4096);

/* ============================ the generator ============================ */

function build(params,io){
  const Q=Object.assign({},params);          // the runtime mutates the live object
  const g=geo(Q);
  const W=io.W,H=io.H,N=W*H,seed=(Q.seed|0)||1;
  const type=g.type;
  const tileWin=g.tileWin,tileHin=g.tileHin;
  const IPX=tileWin/W;                        // inches per texel, both axes
  const PXI=1/IPX;
  const aa=clamp(+Q.aaWide||1,0.4,3);
  const ipx=IPX*aa;                           // the alpha edge width
  const belowIn=g.below,airIn=g.air,topMost=g.topMost;

  const A=new Uint8ClampedArray(N*3);
  const NRM=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N);
  const MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N);
  const ALP=new Uint8ClampedArray(N);
  const IDm=new Uint8ClampedArray(N);
  const MSK=new Uint8ClampedArray(N);
  const HGT=new Float32Array(N);
  const NAX=new Uint8ClampedArray(N);         // analytic slope, x
  const NAY=new Uint8ClampedArray(N);         // analytic slope, row
  const NAW=new Uint8ClampedArray(N);         // how far to trust it
  let hMin=0,hMax=1;

  /* ---- palette ---- */
  const cWood=hexOr(Q.cWood,"#a57f52"),cRail=hexOr(Q.cRail,"#8e6c46"),
        cGrey=hexOr(Q.cGrey,"#8c8a83"),cPaint=hexOr(Q.cPaint,"#f2f0e8"),
        cCoat=hexOr(Q.cCoat,"#b9bdc2"),cSlat=hexOr(Q.cSlat,"#4a6b3c"),
        cRust=hexOr(Q.cRust,"#83411f"),cGround=hexOr(Q.cGround,"#6b5c46"),
        cMoss=hexOr(Q.cMoss,"#4d6b3a");
  const CT=COAT[Q.coating]||COAT.hdg;

  /* ---- weathering amounts ---- */
  const wGrey=clamp(+Q.grey||0,0,1),wRaise=clamp(+Q.grainRaise||0,0,1),
        wCup=clamp(+Q.cup||0,0,1),wSplit=clamp(+Q.splits||0,0,1),
        wKnot=clamp(+Q.knots||0,0,1),wNail=clamp(+Q.nailStain||0,0,1),
        wPaint=clamp(+Q.paint||0,0,1),wPeel=clamp(+Q.peel||0,0,1),
        wMiss=clamp(+Q.missing||0,0,1),wBroke=clamp(+Q.broken||0,0,1),
        sagIn=clamp(+Q.sagIn||0,0,6);
  const mSpan=clamp(+Q.spangle||0,0,1)*(CT.spangle||0),
        mWhite=clamp(+Q.whiteRust||0,0,1),mRed=clamp(+Q.redRust||0,0,1),
        mChalk=clamp(+Q.chalk||0,0,1),mDent=clamp(+Q.metalDent||0,0,1);
  const gClut=clamp(+Q.clutter||0,0,1),gKind=Q.clutterKind||"grass",
        gSplash=clamp(+Q.splashIn||0,0,36),gMoss=clamp(+Q.moss||0,0,1),
        gVine=clamp(+Q.vines||0,0,1),gDirt=clamp(+Q.dirt||0,0,1);
  const zs=(Q.face==="rail")?-1:1;

  /* ---- LOD: one number decides how every thin element is drawn ---- */
  const grade=w=>w>=3?3:(w>=2?2:(w>=1?1:0));   // full / analytic / fade / haze

  /* ---- noise periods, all integers so every field wraps along the run ---- */
  const NgX=Math.max(4,Math.round(tileWin/0.30));    // timber grain, across
  const NgY=Math.max(2,Math.round(tileHin/26));      // timber grain, along
  const NfX=Math.max(4,Math.round(tileWin/1.6));     // general blotch
  const NfY=Math.max(2,Math.round(tileHin/1.6));
  const NmX=Math.max(3,Math.round(tileWin/9));       // moss / damp patches
  const NmY=Math.max(2,Math.round(tileHin/9));

  /* ============ the texel accumulator ============
     Elements are composited premultiplied, each either in front of or behind
     everything already laid down, so the draw order inside a type does not
     have to be sorted and flipping the fence round (face = rail side) simply
     negates z and reverses the compositing for free. */
  let pr=0,pg=0,pb=0,prg=0,pmt=0,pz=0,ea=0,ezf=-1e9,eid=0,emsk=0;
  let nax=0,nay=0,naw=0;
  function reset(){pr=pg=pb=prg=pmt=pz=ea=0;ezf=-1e9;eid=0;emsk=0;nax=nay=naw=0;}
  let lastW=0;
  function put(cov,cr,cg,cb,rg,mt,zl,idv,inf){
    if(cov<=0.0015){lastW=0;return 0;}
    if(cov>1)cov=1;
    const z=zl*zs;
    if(z>=ezf){
      const k=1-cov;
      pr=pr*k+cr*cov;pg=pg*k+cg*cov;pb=pb*k+cb*cov;
      prg=prg*k+rg*cov;pmt=pmt*k+mt*cov;pz=pz*k+z*cov;
      ea=ea*k+cov;ezf=z;
      if(cov>0.5){eid=idv;emsk=inf;}
      nax*=k;nay*=k;naw*=k;
      lastW=cov;
    }else{
      const w=cov*(1-ea);
      if(w<=0.0015){lastW=0;return 0;}
      pr+=cr*w;pg+=cg*w;pb+=cb*w;prg+=rg*w;pmt+=mt*w;pz+=z*w;
      if(w>0.5&&ea<0.5){eid=idv;emsk=inf;}
      ea+=w;
      lastW=w;
    }
    return lastW;
  }
  /* an analytic surface slope for the element just drawn: a central
     difference over one texel cannot resolve a two-texel round wire */
  function putN(gx,grow,trust){
    const w=lastW*trust;
    if(w<=0.004)return;
    nax+=clamp(gx,-4,4)*w;nay+=clamp(grow,-4,4)*w;naw+=w;
  }

  /* ============ timber ============
     Output goes into these; the caller decides where to put it.
     ac = inches across the piece from its centre, al = inches along it. */
  let tR=0,tG=0,tB=0,tRg=0.8,tZ=0,tId=3,tKill=0,tPaintOn=0;
  function timber(u,v,ac,al,halfW,hp,ex,salt,railish,alN,alPeriod){
    const s=seed+salt*7919;
    let r=(railish?cRail[0]:cWood[0]),gg=(railish?cRail[1]:cWood[1]),b=(railish?cRail[2]:cWood[2]);
    const tone=0.89+0.20*hp;
    r*=tone;gg*=tone;b*=tone;
    let rg=0.78,z=0,kill=0;

    /* 1-2. mill state and grain raise: the latewood bands stand proud of the
       earlywood the first time the board gets wet, and everything after this
       follows the raised grain */
    const gr=fbm2(u,v,NgX,NgY,3,s+11);
    const late=smoothstep(0.52,0.78,gr);
    const dk=1-0.14*late-0.05*(gr-0.5);
    r*=dk;gg*=dk;b*=dk*0.99;
    z+=wRaise*0.011*late;
    rg=0.74+0.16*late+0.06*wRaise;
    if(Q.sawn){                                   // rough-sawn: kerf ripples
      const kerf=Math.abs(frac(al*1.7+hp*3)-0.5)*2;
      z+=0.006*kerf;rg+=0.06;
    }

    /* 3. UV greying, warm -> tan -> silver, driven by exposure */
    const k=clamp(wGrey*ex*(0.70+0.50*hp)*1.9,0,2.0);
    if(k>0.001){
      const t1=Math.min(1,k);
      r=lerp(r,r*0.86+34,t1*0.55);gg=lerp(gg,gg*0.88+30,t1*0.55);b=lerp(b,b*0.92+26,t1*0.55);
      const t2=Math.max(0,k-1);
      r=lerp(r,cGrey[0],t2);gg=lerp(gg,cGrey[1],t2);b=lerp(b,cGrey[2],t2);
      rg=lerp(rg,0.93,Math.min(1,k));
    }

    /* 4. cupping: the exposed face dries faster and a flat-sawn board cups
       away from the heart — a smooth arc across the width, nothing along it */
    if(wCup>0&&halfW>0.4){
      const t=clamp(ac/halfW,-1,1);
      z-=wCup*(0.03+0.07*hp)*(1-t*t);
    }

    /* 5. splits and checks: along the grain, opening from the ends and from
       the fixings, and the wood inside them never greyed */
    if(wSplit>0){
      const sp=fbm2(u,v,NgX,Math.max(2,(NgY*3)|0),2,s+23);
      const endBias=0.55+0.45*smoothstep(0.35,0.02,Math.min(alN,1-alN));
      const cut=smoothstep(0.90-0.30*wSplit*endBias,0.995,sp);
      if(cut>0.002){
        z-=cut*(0.02+0.13*wSplit);
        const inner=cut*0.85;
        r=lerp(r,cWood[0]*0.62,inner);gg=lerp(gg,cWood[1]*0.55,inner);b=lerp(b,cWood[2]*0.5,inner);
        rg=lerp(rg,0.95,cut);
        if(wSplit>0.85&&cut>0.93)kill=Math.max(kill,smoothstep(0.93,0.99,cut));
      }
    }

    /* 6. knots: present from the start — the WEATHERING is that they are
       denser, shrink differently, stand proud, bleed resin, or fall out and
       leave a hole. A board carries a knot every foot or two, not every
       inch, so the lattice is coarse and only a fifth of its cells fire. */
    if(wKnot>0&&halfW>0.5){
      const ks=5.5;
      const NKx=Math.max(1,Math.round(halfW*2/ks));
      const NKy=Math.max(2,Math.round((alPeriod||tileHin)/ks));
      worley((ac+halfW)/ks,al/ks,NKx,NKy,s+31,0.85);
      const hk=hashi(W_cx,W_cy,s+37);
      if(hk<wKnot*0.22){
        const rad=(0.055+0.075*hashi(W_cx,W_cy,s+41))*(1+0.35*(gr-0.5));
        const core=1-smoothstep(rad*0.78,rad*1.02,W_f1);
        const ring=(1-smoothstep(rad*1.05,rad*1.45,W_f1))*(1-core);
        if(core+ring>0.004){
          const dark=core*0.62+ring*0.55;
          r=lerp(r,cWood[0]*0.42,dark);gg=lerp(gg,cWood[1]*0.36,dark);b=lerp(b,cWood[2]*0.33,dark);
          z+=core*0.012-ring*0.006;
          rg=lerp(rg,0.5,core*0.7);
          if(hashi(W_cx,W_cy,s+43)<wKnot*0.12)kill=Math.max(kill,core);
        }
      }
    }
    tR=r;tG=gg;tB=b;tRg=rg;tZ=z;tKill=kill;tId=railish?2:3;tPaintOn=0;
  }

  /* paint over timber: a film that fails a whole flake at a time, starting at
     the edges, over the knots and over the fixings — hazard.js's Worley model,
     because thresholding a noise field gives salt-and-pepper speckle */
  const NpX=Math.max(4,Math.round(tileWin/1.7)),NpY=Math.max(4,Math.round(tileHin/1.7));
  function paintOver(u,v,edge,ex,salt){
    if(wPaint<=0.002)return;
    const s=seed+salt*104729;
    let alive=wPaint;
    if(wPeel>0){
      worley(u*NpX+(fbm2(u,v,17,17,2,s+51)-0.5)*0.3,
             v*NpY+(fbm2(u,v,17,17,2,s+53)-0.5)*0.3,NpX,NpY,s+57,0.95);
      const bias=clamp(0.06+edge*1.0+ex*0.25+
        (fbm2(u,v,3,3,2,s+59)-0.5)*2.4+(fbm2(u,v,9,9,2,s+63)-0.5)*0.9,0,2.0);
      if(hashi(W_cx,W_cy,s+61)<clamp(wPeel*bias,0,1)){
        const wall=W_f2-W_f1;
        const flake=smoothstep(0.02,0.13,wall);
        alive*=1-flake;
        if(flake<0.6){                             // the lifted rim curls first
          tZ+=(1-flake)*0.006;
          tRg=lerp(tRg,0.42,(1-flake)*0.4);
        }
      }
    }
    if(alive>0.004){
      const chalk=clamp(mChalk*ex,0,1);
      const pr2=lerp(cPaint[0],cPaint[0]*0.8+56,chalk*0.5);
      const pg2=lerp(cPaint[1],cPaint[1]*0.8+56,chalk*0.5);
      const pb2=lerp(cPaint[2],cPaint[2]*0.8+56,chalk*0.5);
      tR=lerp(tR,pr2,alive);tG=lerp(tG,pg2,alive);tB=lerp(tB,pb2,alive);
      tRg=lerp(tRg,lerp(0.32,0.86,chalk),alive);
      tZ+=alive*0.010;
      tId=4;tPaintOn=alive;
    }
  }

  /* ============ steel ============
     Galvanising spangle first, then white rust where water sits, then red rust
     ONLY where the coating is gone — cut ends, welds, abraded contacts and
     penetrations — because zinc protects sacrificially. */
  let sR=0,sG=0,sB=0,sRg=0.45,sMt=1,sId=5,sZ=0;
  const NspX=Math.max(3,Math.round(tileWin/0.7)),NspY=Math.max(3,Math.round(tileHin/0.7));
  const spOK=((tileWin/NspX)/IPX)>=3;      // a grain under 3 texels is noise
  function steel(u,v,ex,cut,wet,salt){
    const s=seed+salt*15485863;
    let r=cCoat[0],gg=cCoat[1],b=cCoat[2],rg=CT.rough,mt=CT.met,z=0,id=CT.id;
    const mott=fbm2(u,v,NfX,NfY,3,s+71);
    const tn=0.92+0.16*mott;
    r*=tn;gg*=tn;b*=tn;

    /* 1. spangle: the zinc freezes in flat crystal grains, each at its own
       orientation — and the part everyone forgets is that the grain TILTS,
       which is what actually makes a spangle read rather than a blotch */
    if(mSpan>0&&spOK){
      worley(u*NspX,v*NspY,NspX,NspY,s+73,0.95);
      const h1=hashi(W_cx,W_cy,s+79),h2=hashi(W_cx,W_cy,s+83);
      const t=1+(h1-0.5)*0.13*mSpan;
      r*=t;gg*=t;b*=t;
      rg=lerp(rg,0.25+0.24*h2,mSpan*0.8);
      z+=(h1-0.5)*0.004*mSpan;              // the tilt is what makes it read
    }

    /* 2. white rust — wet-storage stain: bulky zinc oxide where water sits */
    if(mWhite>0){
      const wr=clamp(mWhite*(0.35+wet*1.5)*smoothstep(0.4,0.85,fbm2(u,v,NmX,NmY,3,s+89)),0,1);
      if(wr>0.006){
        r=lerp(r,214,wr*0.8);gg=lerp(gg,213,wr*0.8);b=lerp(b,208,wr*0.78);
        rg=lerp(rg,0.92,wr);
        mt=lerp(mt,0,wr*0.95);                    // an oxide is not a metal
        z+=wr*0.012;
        if(wr>0.5)id=5;
      }
    }

    /* 3. red rust, only where the coating has gone */
    if(mRed>0&&cut>0.002){
      const bleed=smoothstep(0.30,0.9,fbm2(u,v,NfX,Math.max(2,(NfY*0.5)|0),3,s+97));
      const rust=clamp(cut*mRed*(0.75+bleed*1.2),0,1);
      if(rust>0.006){
        r=lerp(r,cRust[0],rust*0.92);gg=lerp(gg,cRust[1],rust*0.92);b=lerp(b,cRust[2],rust*0.92);
        rg=lerp(rg,0.95,rust);
        mt=lerp(mt,0.08,rust);                    // iron oxide is a dielectric
        z+=rust*0.02-rust*rust*0.03;
        if(rust>0.35)id=9;
      }
    }

    /* 4. chalking: the powder coat's binder goes and the pigment sits loose */
    if(mChalk>0&&(Q.coating==="pc"||Q.coating==="paint"||Q.coating==="pvc")){
      const ch=mChalk*ex*(0.4+0.6*mott);
      r=lerp(r,r*0.72+96,ch*0.45);gg=lerp(gg,gg*0.72+96,ch*0.45);b=lerp(b,b*0.72+94,ch*0.45);
      rg=lerp(rg,0.88,ch*0.7);
    }
    sR=r;sG=gg;sB=b;sRg=rg;sMt=mt;sZ=z;sId=id;
  }

  /* ============ the post lattice ============
     Posts sit on a uniform lattice ANCHORED AT THE TILE ORIGIN, and the tile
     edge is a post centreline. dx is continuous through the wrap with no
     special case, so there is exactly one post j = 0: its left half is drawn
     in the last texels of the tile and its right half in the first. Every
     per-post random is hashed on j MODULO the count per tile, so post j and
     post j+n are the same post one tile over. */
  const nPosts=g.nPosts,postPitch=g.postPitch,subs1=g.subs+1;
  const leanMax=Math.tan(clamp(+Q.postLean||0,0,1)*1.5*Math.PI/180);
  const toneAmt=clamp(+Q.postTone||0,0,1);
  const capk=CAPS[g.capKind]||CAPS.none,capKind=g.capKind;
  const capOver=clamp(+Q.capOverIn||0,0,2);
  const postEase=g.post.ease||0.1;
  const postSteel=!!g.post.steel,postConc=!!g.post.conc,postHsec=!!g.post.hsec;

  /* cap silhouette: half-width and front z at dy inches above the post top */
  let cHW=0,cZ=0;
  function capAt(dy,half,pd){
    cHW=0;cZ=pd*0.5;
    const rise=g.capRise;
    if(rise<=0||dy<0||dy>rise)return;
    const t=dy/rise;
    if(capKind==="bevel"||capKind==="pyramid"){
      cHW=half*(1-t)+half*0.06;cZ=pd*0.5*(1-t*0.85);
    }else if(capKind==="plate"){
      cHW=(dy<0.14)?half*0.9:half+capOver;cZ=pd*0.5+((dy<0.14)?0:capOver);
    }else if(capKind==="ball"){
      if(dy<1.0){cHW=(dy<0.14)?half*0.9:half+capOver;cZ=pd*0.5+((dy<0.14)?0:capOver);}
      else{const R=1.25,c=dy-(1.0+R);cHW=Math.sqrt(Math.max(0,R*R-c*c));cZ=cHW;}
    }else if(capKind==="gothic"){
      if(dy<1.0){cHW=(dy<0.14)?half*0.9:half+capOver;cZ=pd*0.5+((dy<0.14)?0:capOver);}
      else{
        const q=(dy-1.0)/Math.max(0.01,rise-1.0);
        const s=q<0.42?(1-0.35*(q/0.42)*(q/0.42)):(0.65*Math.pow((1-q)/0.58,1.4));
        cHW=half*0.82*s;cZ=Math.max(0.2,cHW);
      }
    }else if(capKind==="dome"){
      const R=half+0.09;cHW=R*Math.sqrt(Math.max(0,1-t*t));cZ=cHW;
    }else if(capKind==="loop"){
      const R=half+0.09;
      cHW=R*Math.sqrt(Math.max(0,1-t*t))*(1-0.45*smoothstep(0.25,0.75,t));
      cZ=Math.max(0.15,cHW);
    }else if(capKind==="spear"){
      const q=t;
      cHW=(q<0.18)?half*1.05:half*0.62*(1-(q-0.18)/0.82);
      cZ=Math.max(0.12,cHW*0.9);
    }else{cHW=0;}
  }

  /* the post, its cap, and — on a terminal pipe — the bands that hold the
     fabric. Returns the wrapped post index so callers can key off it. */
  let postJ=0,postDX=0,postHalf=0,postMajor=true;
  function drawPost(x,y,u,v,ex,idOverride){
    const s=x/postPitch,jr=Math.round(s),j=md(jr,nPosts);
    const hp=hashi(j,11,seed+911);
    const lean=(hashi(j,3,seed+913)-0.5)*2*leanMax;
    const dx=(s-jr)*postPitch-lean*Math.max(0,y);
    const major=(j%subs1)===0;
    const k=(major||!g.subs)?1:0.74;
    const pw=g.postW*k,pd=g.postD*k,half=pw*0.5;
    postJ=j;postDX=dx;postHalf=half;postMajor=major;
    const top=g.postTop+(hashi(j,17,seed+917)-0.5)*0.8*toneAmt;
    const ad=Math.abs(dx);
    if(ad>half+g.capRise+capOver+ipx)return;

    let cov=0,zf=pd*0.5,gx=0,round=g.postRound;
    if(y<=top){
      if(round){
        cov=disc(ad,half,ipx);
        const t=Math.min(ad,half*0.999);
        zf=Math.sqrt(Math.max(0,half*half-t*t));
        gx=(zf>0.02)?(-t*(dx<0?-1:1)/zf):0;
      }else if(postHsec){
        /* two flange bands proud, the web recessed — a real 1.75 in step and
           the best normal map of any post in this mode */
        const fl=0.31*(pw/4);
        if(ad>half-fl){cov=strip(ad,half,ipx);zf=pd*0.5;}
        else{cov=strip(ad,half-fl,ipx);zf=-pd*0.35;}
      }else{
        cov=strip(ad,half,ipx);
        const inset=half-ad;
        if(inset<postEase&&inset>=0){
          const t=inset;
          zf=pd*0.5-postEase+Math.sqrt(Math.max(0,postEase*postEase-(postEase-t)*(postEase-t)));
          gx=-(postEase-t)/Math.max(0.03,Math.sqrt(Math.max(1e-4,postEase*postEase-(postEase-t)*(postEase-t))))*(dx<0?-1:1);
        }
      }
      cov*=slab(y,-belowIn-2,top,ipx);
    }
    if(cov>0.0015){
      const wet=smoothstep(gSplash*1.1,0,y)*0.8;
      if(g.postWood){
        timber(u,v,dx,y,half,hp,ex,j*3+1,false,clamp(y/Math.max(1,top),0,1));
        paintOver(u,v,1-smoothstep(0,0.5,half-ad),ex,j*3+1);
        const tn=1+(hp-0.5)*0.22*toneAmt;
        put(cov,tR*tn,tG*tn,tB*tn,tRg,0,zf+tZ,tPaintOn>0.3?4:1,0);
      }else if(postConc){
        const mott=fbm2(u,v,NfX,NfY,3,seed+131+j);
        const agg=smoothstep(0.62,0.8,fbm2(u,v,NgX,NgX,2,seed+137+j));
        const t=0.86+0.26*mott+0.14*agg;
        put(cov,178*t,175*t,166*t,0.78-0.1*agg,0,zf,1,0);
      }else{
        const cut=(1-smoothstep(0,1.2,y-(-belowIn)))*0.5+smoothstep(top-1.2,top,y)*0.7;
        steel(u,v,ex,cut*0.5,wet,j*3+1);
        put(cov,sR,sG,sB,sRg,sMt,zf+sZ,sId,0);
      }
      if(round&&cov>0.02)putN(gx,0,1-smoothstep(6,11,pw*PXI));
    }

    /* the cap */
    if(g.capRise>0&&capKind!=="none"&&capKind!=="flatcut"&&y>top-0.2){
      const dy=y-top;
      capAt(dy,half,pd);
      if(cHW>0.001){
        const cc=strip(ad,cHW,ipx)*slab(y,top,top+g.capRise,ipx);
        if(cc>0.0015){
          if(g.postWood){
            timber(u,v,dx,y,cHW,hashi(j,23,seed+919),Math.min(1,ex*1.25),j*3+2,false,0.5);
            paintOver(u,v,0.55,ex,j*3+2);
            put(cc,tR*1.03,tG*1.03,tB*1.02,Math.min(1,tRg+0.05),0,cZ+tZ,tPaintOn>0.3?4:1,0);
          }else{
            steel(u,v,Math.min(1,ex*1.3),0.25,0.5,j*3+2);
            put(cc,sR,sG,sB,sRg,sMt,cZ,8,0);
          }
          if(cHW<half*1.4)putN((cZ>0.05)?-(ad/Math.max(0.05,cZ))*(dx<0?-1:1):0,0,
                               0.7*(1-smoothstep(6,11,cHW*2*PXI)));
        }
      }
    }
  }

  /* ============ the ground ============
     Never a ground PLANE: a band of clutter that fades to nothing well before
     the bottom edge of the tile, so the tile wraps in V and the card sits IN
     terrain instead of on a hard line of dirt. */
  const clutTop=(gKind==="grass"?2+13*gClut:(gKind==="snow"?1.5+7*gClut:1+4*gClut));
  /* the ground and anything growing on it belongs just in front of the frame,
     not far in front of it — put it further out and it owns hMax and leaves
     the fence itself a handful of levels of the 8-bit height map */
  const zGnd=g.postD*0.5+0.45,zVine=g.postD*0.5+0.8;
  const nBl=Math.max(8,Math.round(tileWin/0.40));
  const bladeP=tileWin/nBl;
  const NgrX=Math.max(3,Math.round(tileWin/7));
  function drawGround(x,y,u,v){
    if(gClut<=0.004||y>clutTop+1.5)return;
    const uu=u;
    /* the soil / gravel / slab surface, with an undulating top edge */
    const gt=(gKind==="conc"?0.6:0.15)+
             (fbm2(uu,0.25,NgrX,1,3,seed+211)-0.5)*(gKind==="conc"?0.5:2.2)*(0.4+gClut)+
             (fbm2(uu,0.75,NgrX*6,1,2,seed+215)-0.5)*0.7*(gKind==="conc"?0.2:1);
    /* loose material heaped at the base, DISSOLVING downward into nothing —
       never a ground plane, or the card reads as a cut-out sitting on terrain
       instead of one standing in it (and the tile stops wrapping in V) */
    const deep=Math.min(belowIn*0.8,1.5+5*gClut);
    let base=slab(y,gt-deep-1,gt,ipx);
    if(base>0.0015){
      const tt=clamp((y-(gt-deep))/Math.max(0.4,deep),0,1);
      const rag=fbm2(uu,v,NgrX*4,Math.max(2,Math.round(tileHin/2.5)),3,seed+213);
      base*=smoothstep(0,0.32,tt*1.3-(1-rag)*0.9);
    }
    if(base>0.0015){
      let r=cGround[0],gg=cGround[1],b=cGround[2],rg=0.93,z=0,id=11;
      const mott=fbm2(uu,v,NfX*2,NfY*2,3,seed+223);
      if(gKind==="gravel"){
        const NG=Math.max(4,Math.round(tileWin/1.1));
        worley(uu*NG,(v)*NG*g.k,NG,Math.max(4,Math.round(NG*g.k)),seed+227,0.95);
        const st=1-smoothstep(0.24,0.42,W_f1);
        const sh=hashi(W_cx,W_cy,seed+229);
        const t=0.75+0.75*sh+0.35*st;
        r*=t;gg*=t;b*=t*0.98;rg=0.86;z+=st*0.9;
      }else if(gKind==="conc"){
        const t=0.95+0.3*mott;r=170*t;gg=167*t;b=158*t;rg=0.66;z=0.9;
      }else if(gKind==="snow"){
        const t=0.92+0.14*mott;r=232*t;gg=236*t;b=242*t;rg=0.72;z=1.2;
      }else{
        const t=0.78+0.44*mott;r*=t;gg*=t;b*=t;
      }
      put(base,r,gg,b,rg,0,zGnd+z*0.35,id,0);
    }
    /* blades and tufts: thin, so they come out as a haze of the right density
       at every resolution below 4096, which is exactly what grass should do */
    if(gKind!=="conc"&&clutTop>1.2&&y>-belowIn){
      const grn=[cMoss[0],cMoss[1],cMoss[2]];
      const clumpH=clamp(0.30+1.05*fbm2(uu,0.5,Math.max(2,Math.round(tileWin/13)),1,3,seed+235),0.1,1.3);
      for(let o=-1;o<=1;o++){
        const jb=Math.round(x/bladeP)+o,jw=md(jb,nBl);
        /* a lawn is dense; weeds through gravel or bare soil are not */
        if(hashi(jw,21,seed+243)>(gKind==="grass"?0.22+0.78*gClut:0.06+0.30*gClut))continue;
        const h0=hashi(jw,5,seed+233),h1=hashi(jw,9,seed+239),h2=hashi(jw,13,seed+241);
        const bh=clutTop*(0.18+0.82*h0*h0)*clumpH;
        if(y>bh)continue;
        const t=clamp(y/Math.max(0.4,bh),0,1);
        const bx=(jb+ (h2-0.5)*0.7)*bladeP+(h1-0.5)*2.4*bh*t*t;
        const hw=(gKind==="snow"?0.10:0.075)*(1-t*0.85)*(0.6+0.8*h1);
        const cv=strip(Math.abs(x-bx),hw,ipx)*slab(y,-belowIn,bh,ipx);
        if(cv>0.0015){
          const sh=0.55+0.75*h1-0.25*t;
          let r,gg2,b;
          const dry=hashi(jw,27,seed+245);       // some of it is dead, some is not
          if(gKind==="snow"){r=238;gg2=240;b=244;}
          else{
            const mix=(gKind==="dirt"||gKind==="gravel")?0.45:0;
            const dd=lerp(0,0.62,dry*dry);
            r=lerp(lerp(grn[0],cGround[0],mix),176,dd)*sh;
            gg2=lerp(lerp(grn[1],cGround[1],mix),158,dd)*sh*1.04;
            b=lerp(lerp(grn[2],cGround[2],mix),102,dd)*sh*0.92;
          }
          put(cv,r,gg2,b,0.88,0,zGnd+0.35+h2*0.5,gKind==="grass"?10:11,0);
        }
      }
    }
  }

  /* ============ vines ============
     A few stems wandering up the run, wrapping because the wander is a
     wrapping noise field and the stems are hashed on an index modulo count. */
  const nVine=gVine>0?Math.max(1,Math.round(g.bays*(0.6+2.4*gVine))):0;
  function drawVines(x,y,u,v){
    if(nVine<=0||y<-belowIn)return;
    for(let s2=0;s2<nVine;s2++){
      const h0=hashi(s2,31,seed+251),h1=hashi(s2,37,seed+257),h2=hashi(s2,41,seed+263);
      const top=topMost*(0.35+0.6*h0)*(0.4+0.8*gVine);
      if(y>top)continue;
      const wob=(fbm2(u,v,3,Math.max(2,Math.round(tileHin/18)),3,seed+269+s2*17)-0.5);
      const cx=(h1*tileWin+wob*22+y*(h2-0.5)*0.35);
      const dxv=x-cx-tileWin*Math.round((x-cx)/tileWin);
      const thick=0.16*(1-0.6*y/Math.max(1,top))*(0.7+0.6*h2);
      const cv=strip(Math.abs(dxv),thick,ipx);
      if(cv>0.0015)put(cv,cMoss[0]*0.72,cMoss[1]*0.62,cMoss[2]*0.5,0.9,0,zVine,10,0);
      /* leaves */
      if(Math.abs(dxv)<3.2){
        const NL=Math.max(4,Math.round(tileHin/3.5));
        worley((dxv+4)/1.6,y/1.6,6,NL,seed+271+s2*13,0.9);
        const lf=1-smoothstep(0.34,0.5,W_f1);
        if(lf>0.004&&hashi(W_cx,W_cy,seed+277)<0.55+0.4*gVine){
          const sh=0.7+0.6*hashi(W_cx,W_cy,seed+281);
          put(lf*smoothstep(3.2,1.4,Math.abs(dxv)),cMoss[0]*sh,cMoss[1]*sh*1.06,cMoss[2]*sh*0.8,
              0.85,0,zVine+0.3,10,0);
        }
      }
    }
  }

  /* ============ sag ============
     The rails bow between posts and everything hung on them follows, so the
     top line of a fence is a parabola. Exactly zero at every post, including
     the shared one on the tile edge, so it is wrap-safe by construction —
     and it is the cheapest single thing here that stops a fence looking CG. */
  const bayH=[];
  for(let bI=0;bI<g.bays;bI++)bayH.push(0.6+0.8*hashi(bI,7,seed+347));
  function sagDrop(x,amt){
    if(amt<=0)return 0;
    const t=frac(x/g.bayIn);
    return amt*bayH[md(Math.floor(x/g.bayIn),g.bays)]*4*t*(1-t);
  }

  /* ============ board and picket ============ */
  const boardVar=clamp(+Q.boardVar||0,0,1);
  const bob=(g.layout==="bob"),shadowbox=(g.layout==="shadow");
  const railT=g.railT||1.5,railW=g.railW||3.5,boardT=g.boardT||0.75;
  const railZ0=shadowbox?-railT*0.5:g.postD*0.5;
  const railZ1=railZ0+railT;
  const frontZ=(bob?railZ1+boardT:railZ1)+boardT;
  const backZ=shadowbox?railZ0:railZ1+boardT;
  const backZ0=shadowbox?railZ0-boardT:railZ1;
  const gapPx=g.gapBuilt*PXI;

  function ogee(r){
    return r<0.55?(1-0.35*(r/0.55)*(r/0.55)):(0.65*Math.pow(Math.max(0,(1-r)/0.45),1.35));
  }

  function drawRailsH(x,y,u,v,ex,zBack,zFront,depth,thick,ids){
    const drop=sagDrop(x,sagIn);
    const s=x/postPitch,jr=Math.round(s),j=md(jr,nPosts);
    const dxp=(s-jr)*postPitch;
    const major=(j%subs1)===0;
    for(let i=0;i<g.railY.length;i++){
      const ry=g.railY[i]-drop;
      let cv=slab(y,ry-depth*0.5,ry+depth*0.5,ipx);
      if(cv<=0.0015)continue;
      /* rails butt on a major post centreline with a 1/8 in gap, and the two
         ends land at slightly different z — a real and very cheap tell */
      let zoff=0;
      if(major&&subs1>1||major){
        cv*=1-strip(Math.abs(dxp),0.0625,ipx)*0.9;
        zoff=(dxp<0?-0.03:0.03);
      }
      if(cv<=0.0015)continue;
      const hr=hashi(i*97+md(Math.floor(x/g.bayIn),g.bays),13,seed+353);
      timber(u,v,y-ry,x,depth*0.5,hr,ex*0.72,600+i,true,frac(x/g.bayIn),tileWin);
      paintOver(u,v,1-smoothstep(0,0.35,depth*0.5-Math.abs(y-ry)),ex*0.7,600+i);
      put(cv,tR,tG,tB,tRg,0,zFront+zoff+tZ,tPaintOn>0.3?4:ids,0);
    }
  }

  function drawBoardCourse(x,y,u,v,ex,layer){
    const pitch=g.pitch;
    const off=(layer===0)?pitch*0.5:0;
    const sb=(x-off)/pitch,jb=Math.round(sb),ib=md(jb,g.nBoards);
    const salt=ib+(layer?0:g.nBoards*3);
    const hb=hashi(ib,layer?7:29,seed+331);
    const hm=hashi(ib,3,seed+337),hbk=hashi(ib,5,seed+341);
    if(hm<wMiss*0.55)return;                       // the board is simply gone
    const halfW=g.boardW*0.5*(1+(hb-0.5)*0.09*boardVar);
    const dbx=(sb-jb)*pitch;
    const ad=Math.abs(dbx);
    if(ad>halfW+ipx)return;
    const drop=sagDrop(x,sagIn);
    const ys=y+drop;
    const botY=g.botGap;
    let topY=g.boardTop+(hb-0.5)*0.35*boardVar;
    const rr=clamp(ad/Math.max(0.2,halfW),0,1);
    if(g.topCut==="dogear"){
      const over=Math.max(0,ad-(halfW-g.topCutIn));
      topY-=over;
    }else if(g.topCut==="point"){topY+=g.topCutIn*(1-rr);}
    else if(g.topCut==="gothic"){topY+=g.topCutIn*ogee(rr);}
    let broke=0;
    if(hbk<wBroke*0.6){                            // snapped at a rail line
      const rl=g.railY[Math.min(g.railY.length-1,1+((ib*3)%Math.max(1,g.railY.length-1)))];
      const rag=(fbm2(u,0.3,Math.max(4,Math.round(tileWin/0.5)),1,2,seed+359)-0.5)*2.4;
      topY=Math.min(topY,rl+2.5+rag);broke=1;
    }
    if(ys>topY+ipx||ys<botY-ipx)return;
    const cov=strip(ad,halfW,ipx)*slab(ys,botY,topY,ipx);
    if(cov<=0.0015)return;
    const ex2=clamp(ex*(0.8+0.4*hb),0,1);
    /* the film shelters what is under it, so the wood in a flake scar is less
       grey than the wood beside it — that falls out of the causal order for
       free rather than having to be special-cased */
    timber(u,v,dbx,ys,halfW,hb,ex2*(1-0.55*wPaint),salt,false,
           clamp((ys-botY)/Math.max(1,topY-botY),0,1),tileHin);
    /* nail stain: a blue-black tannate halo at the head, then a red-brown
       streak running down from it */
    if(wNail>0){
      for(let i=0;i<g.railY.length;i++){
        const ny=g.railY[i]-drop,dyn=ys-ny;
        const dn=Math.hypot(dbx-halfW*0.55,dyn);
        const dn2=Math.hypot(dbx+halfW*0.55,dyn);
        const near=Math.min(dn,dn2);
        const head=(1-smoothstep(0.06,0.11,near));          // the set head itself
        const halo=(1-smoothstep(0.10,0.42,near))*wNail;    // the tannate ring
        if(halo>0.004||head>0.004){
          tR=lerp(tR,38,halo*0.55);tG=lerp(tG,40,halo*0.55);tB=lerp(tB,44,halo*0.52);
          tR=lerp(tR,96,head*0.7);tG=lerp(tG,94,head*0.7);tB=lerp(tB,92,head*0.7);
          tZ-=head*0.02;
        }
        const hh=halo;
        if(dyn<0&&dyn>-11){
          const wdt=0.42+(-dyn)*0.06;
          const st=(1-smoothstep(wdt*0.5,wdt,Math.min(Math.abs(dbx-halfW*0.55),Math.abs(dbx+halfW*0.55))))*
                   smoothstep(-11,-1.5,dyn)*wNail*0.8*
                   (0.4+0.6*fbm2(u,v,NfX*2,NfY*4,2,seed+367));
          if(st>0.004){
            tR=lerp(tR,cRust[0]*1.05,st*0.6);tG=lerp(tG,cRust[1]*0.95,st*0.6);
            tB=lerp(tB,cRust[2]*0.9,st*0.6);
            tRg=Math.min(1,tRg+st*0.06);
          }
        }
      }
    }
    if(broke&&ys>topY-0.7){                        // fresh end grain at the break
      const fr=smoothstep(topY-0.7,topY,ys);
      tR=lerp(tR,cWood[0]*1.15,fr*0.8);tG=lerp(tG,cWood[1]*1.12,fr*0.8);tB=lerp(tB,cWood[2]*1.05,fr*0.8);
      tRg=lerp(tRg,0.96,fr);
    }
    paintOver(u,v,Math.max(1-smoothstep(0,0.6,halfW-ad),smoothstep(topY-1.2,topY,ys)),ex2,salt);
    const tn=1+(hb-0.5)*0.16*boardVar;
    const kill=tKill;
    const z=(layer?frontZ:backZ);
    put(cov*(1-kill),tR*tn,tG*tn,tB*tn,tRg,0,z+tZ,tPaintOn>0.3?4:3,255);
  }

  /* ============ split rail and ranch rail ============ */
  function drawSplitRails(x,y,u,v,ex){
    const ranch=(g.railKind==="ranch");
    const th=g.srThick,dp=g.srDepth;
    const zc=ranch?(g.postD*0.5+th*0.5):0;
    const s=x/postPitch,jr=Math.round(s),j=md(jr,nPosts);
    const dxp=(s-jr)*postPitch;
    const drop=sagDrop(x,sagIn*1.6);
    for(let i=0;i<g.railY.length;i++){
      const hr=hashi(i*131+md(Math.floor(x/g.bayIn),g.bays),19,seed+373);
      const tw=(hr-0.5)*0.06;                       // each rail has its own twist
      const t=frac(x/g.bayIn);
      /* tapered towards the ends, which is what a split rail actually is */
      const taper=1-g.srTaper*0.30*Math.pow(Math.abs(2*t-1),2.4);
      const ry=g.railY[i]-drop*(0.4+0.6*hr)+tw*(x-Math.floor(x/g.bayIn)*g.bayIn-g.bayIn*0.5)*0.02;
      /* a split rail is riven, not milled: its two long edges wander, so no
         two rails in a run are the same shape and none of them are parallel */
      const rough=g.srTaper*(fbm2(u,0.2+i*0.17,Math.max(3,Math.round(tileWin/9)),1,3,
                                  seed+381+i*29)-0.5)*dp*0.34;
      const half=Math.max(0.3,dp*0.5*taper*(0.82+0.36*hr)+rough);
      let cv=slab(y,ry-half,ry+half,ipx);
      if(cv<=0.0015)continue;
      const dy2=(y-ry)/Math.max(0.05,half);
      /* a riven rail is a flattened polygon, not a dome — a dome is flat at
         its crown and reads as a planed plank, which is the one thing a
         split rail is not */
      const zf=zc+th*0.5*(1-0.62*Math.pow(Math.abs(dy2),1.3));
      timber(u,v,y-ry,x,half,hr,ex*0.9,700+i,true,t,tileWin);
      paintOver(u,v,1-smoothstep(0,0.4,half-Math.abs(y-ry)),ex*0.85,700+i);
      /* the split face flakes along the grain rather than checking evenly */
      if(g.srTaper>0.2){
        const fl=smoothstep(0.72,0.95,fbm2(u,v,Math.max(4,Math.round(tileWin/0.8)),NfY*3,2,seed+379));
        tRg=Math.min(1,tRg+fl*0.06);
        const d2=1-fl*0.1*g.srTaper;
        tR*=d2;tG*=d2;tB*=d2;
      }
      put(cv,tR,tG,tB,tRg,0,zf+tZ,tPaintOn>0.3?4:2,255);
      /* the through-mortise: a black slot where the rail enters the post */
      if(!ranch&&Math.abs(dxp)<postHalf+0.4){
        const mo=slab(y,ry-g.srMort*0.5,ry+g.srMort*0.5,ipx)*
                 strip(Math.abs(dxp),postHalf+0.3,ipx);
        if(mo>0.0015)put(mo*0.85,26,22,18,0.97,0,zc+th*0.55,2,0);
      }
    }
  }

  /* ============ chain link ============
     "2 inch mesh" is the CLEAR distance between adjacent parallel wires, so
     the centre-to-centre perpendicular pitch is mesh + wire and the diamond's
     period along both axes is that times root two. Two phases do all the
     work: tA is constant along the +45 wires, tB along the -45 ones, and the
     signed remainder times the perpendicular pitch is a true distance in
     inches to the nearest wire axis. */
  const D=g.D||3,halfD=D*0.5,Mc=D/R2,wire=g.wire||0.148,rw=wire*0.5;
  const mph=clamp((Q.meshPhase==null?0.5:+Q.meshPhase),0,1);
  const theta=TAU*mph;
  const fabZc=g.postD*0.5+rw+0.02;
  const wpx=wire*PXI,apPx=(g.meshBuilt||1)*PXI;
  const flatScreen=apPx<3;
  const fabSag=clamp(+Q.fabSag||0,0,8)*(g.topRail?1:3);
  const bendIn=clamp(+Q.fabPush||0,0,1)*1.6;
  const bpx=Math.max(2,Math.round(tileWin/24)),bpy=Math.max(2,Math.round(bpx*g.k));
  const tieAmt=clamp(+Q.ties||0,0,1);
  const slatAmt=clamp(+Q.slats||0,0,1),slatGone=clamp(+Q.slatGone||0,0,1);
  const mRow0=Math.round(g.fabBot/halfD),mRow1=mRow0+(g.nv||2);
  const nTieTop=Math.max(1,Math.round(tileWin/24));
  const wireTrust=1-smoothstep(6,11,wpx);

  function wireShade(u,v,ex,cut,wet,salt){
    steel(u,v,ex,cut,wet,salt);
  }

  /* one selvage: a bead of knuckles every diamond, or a twisted barb */
  function selvage(x,y,u,v,ex,ySel,mRow,up,kindStr,wet){
    const off=(mRow*0.5-mph)*D;
    const sK=(x-off)/D,jk=Math.round(sK),xk=jk*D+off;
    const dxk=x-xk,dyk=(y-ySel)*(up?1:-1);
    if(dyk<-rw-ipx||dyk>2.4*wire+ipx)return;
    const zk=fabZc+rw*Math.cos(TAU*xk/D+theta);
    wireShade(u,v,ex,0.85,wet,4200+jk);
    if(kindStr==="barb"){
      const L=1.25*wire;
      for(let sg=-1;sg<=1;sg+=2){
        const tt=clamp(dyk/L,0,1);
        const cx=sg*0.364*dyk;                       // +-20 degrees
        const rr=rw*(1-0.7*tt);
        const cv=strip(Math.abs(dxk-cx),rr,ipx)*slab(dyk,0,L,ipx);
        if(cv>0.0015)put(cv,sR*1.04,sG*1.04,sB*1.04,sRg,sMt,zk+rw,7,255);
      }
    }else{
      const rk=0.9*wire;
      const dk=Math.abs(Math.hypot(dxk,dyk)-rk);
      const cv=strip(dk,rw,ipx)*sat((dyk+ipx*0.5)/ipx);
      if(cv>0.0015){
        put(cv,sR*1.05,sG*1.05,sB*1.04,Math.max(0.1,sRg-0.05),sMt,zk+rw*1.3,7,255);
        putN(0,0,0.3*wireTrust);
      }
    }
  }

  function drawChain(x,y,u,v,ex){
    const wetLo=smoothstep(gSplash*1.2,0,y)*0.9;
    const s=x/postPitch,jr=Math.round(s),j=md(jr,nPosts);
    const dxp=(s-jr)*postPitch;
    const major=(j%subs1)===0;

    /* --- the top rail, coaxial with the posts so the fabric passes in front,
       one continuous specular highlight running the whole width --- */
    if(g.topRail){
      const ty=g.fabTop-1-sagDrop(x,fabSag*0.22);
      const R=g.topRailD*0.5,dyr=y-ty;
      if(Math.abs(dyr)<R+ipx){
        const cv=disc(Math.abs(dyr),R,ipx);
        if(cv>0.0015){
          const zf=Math.sqrt(Math.max(0.0004,R*R-dyr*dyr));
          /* a sleeve joint every 21 ft, hashed on the bay */
          const sl=1-strip(Math.abs(frac(x/252)-0.5)*252,0.5,ipx)*0.25;
          wireShade(u,v,Math.min(1,ex*1.2),0.12+0.5*smoothstep(0.55,0.95,dyr/R),0.35,4300);
          put(cv,sR*sl,sG*sl,sB*sl,sRg,sMt,zf,5,0);
          putN(0,dyr/zf,1-smoothstep(8,16,g.topRailD*PXI));
        }
      }
    }
    /* --- bottom tension wire --- */
    if(g.tensWire){
      const ty=g.fabBot+0.5,R=0.0885,dyr=y-ty+sagDrop(x,fabSag*0.5);
      if(Math.abs(dyr)<R+ipx){
        const cv=disc(Math.abs(dyr),R,ipx);
        if(cv>0.0015){
          const zf=Math.sqrt(Math.max(1e-4,R*R-dyr*dyr));
          wireShade(u,v,ex,0.5,wetLo,4310);
          put(cv,sR,sG,sB,sRg,sMt,fabZc-rw+zf,5,0);
        }
      }
    }

    /* --- the fabric --- */
    let fx=x,fy=y,dzw=0;
    if(bendIn>0){
      fx+=(fbm2(u,v,bpx,bpy,3,seed+31)-0.5)*2*bendIn;
      fy+=(fbm2(u,v,bpx,bpy,3,seed+37)-0.5)*2*bendIn;
      dzw=(fbm2(u,v,bpx,bpy,2,seed+41)-0.5)*3*bendIn;
    }
    fy+=sagDrop(x,fabSag);
    const vc=slab(fy,g.fabBot,g.fabTop,ipx);
    if(vc>0.0015){
      const cut=clamp(smoothstep(g.fabBot+2.5,g.fabBot,fy)*0.75+
                      smoothstep(g.fabTop-2.5,g.fabTop,fy)*0.6+
                      (Math.abs(dxp)<1.4?0.45:0),0,1);
      /* privacy slats, threaded down the channels, behind the wire */
      if(slatAmt>0.01){
        const sp=halfD,sw=sp*(0.30+0.62*slatAmt);
        const ss=fx/sp,js=Math.round(ss),is2=md(js,Math.max(1,Math.round(tileWin/sp)));
        const hsl=hashi(is2,3,seed+383);
        if(hsl>slatGone*0.8){
          const dsx=(ss-js)*sp;
          const top=g.fabTop-0.5-(hashi(is2,9,seed+389)<slatGone*0.5?
                     (2+18*hashi(is2,11,seed+391)):0);
          const cv=strip(Math.abs(dsx),sw*0.5,ipx)*slab(fy,g.fabBot+0.5,top,ipx);
          if(cv>0.0015){
            const fade=clamp(mChalk*ex*0.8,0,1);
            const t2=0.85+0.3*hashi(is2,17,seed+397);
            put(cv,lerp(cSlat[0],186,fade)*t2,lerp(cSlat[1],188,fade)*t2,
                   lerp(cSlat[2],180,fade)*t2,lerp(0.55,0.9,fade),0,fabZc-rw-0.02+dzw,12,255);
          }
        }
      }
      if(flatScreen){
        /* the aperture is under three texels: a lattice here would only
           alias, so the fabric collapses to a flat screen at the correct
           blockage — the honest answer, and it mips properly */
        wireShade(u,v,ex,cut,wetLo,4000);
        put(vc*(1-g.open),sR,sG,sB,sRg,sMt,fabZc+dzw,7,255);
      }else{
        const tA=(fx-fy)/D+mph,a=Math.round(tA),dA=(tA-a)*Mc;
        const tB=(fx+fy)/D+mph,b=Math.round(tB),dB=(tB-b)*Mc;
        const ang=TAU*fx/D+theta,ca=Math.cos(ang),sa=Math.sin(ang);
        const dzc=(TAU/D)*rw*sa/R2;                 // dz/ds along a family A wire
        const adA=Math.abs(dA),adB=Math.abs(dB);
        if(adA<rw+ipx){
          const cv=strip(adA,rw,ipx)*vc;
          if(cv>0.0015){
            const sA=clamp(dA/rw,-1,1);
            const bul=rw*Math.sqrt(Math.max(0,1-sA*sA));
            wireShade(u,v,ex,cut,wetLo,4000+md(a,997));
            put(cv,sR,sG,sB,sRg,sMt,fabZc+rw*ca+bul+dzw,7,255);
            const dz=-dzc;
            const Nx=(sA-dz)/R2,Ny=(-sA-dz)/R2;
            const Nz=Math.sqrt(Math.max(0.02,1-sA*sA-dz*dz));
            putN(-Nx/Nz,Ny/Nz,wireTrust);
          }
        }
        if(adB<rw+ipx){
          const cv=strip(adB,rw,ipx)*vc;
          if(cv>0.0015){
            const sB2=clamp(dB/rw,-1,1);
            const bul=rw*Math.sqrt(Math.max(0,1-sB2*sB2));
            wireShade(u,v,ex,cut,wetLo,4100+md(b,997));
            put(cv,sR,sG,sB,sRg,sMt,fabZc-rw*ca+bul+dzw,7,255);
            const dz=dzc;
            const Nx=(sB2-dz)/R2,Ny=(sB2+dz)/R2;
            const Nz=Math.sqrt(Math.max(0.02,1-sB2*sB2-dz*dz));
            putN(-Nx/Nz,Ny/Nz,wireTrust);
          }
        }
        /* the selvages: one knuckle per diamond, and they are the single
           detail that separates chain link from a diamond-pattern texture */
        if(wpx>=1.1){
          selvage(fx,fy,u,v,ex,g.fabBot,mRow0,false,Q.selvBot||"knuckle",wetLo);
          selvage(fx,fy,u,v,ex,g.fabTop,mRow1,true,Q.selvTop||"knuckle",0.3);
        }
      }
    }

    /* --- tension bands and bar at a terminal post --- */
    if(g.tensBar&&major){
      const nB=Math.max(2,Math.round(g.fabricH/12));
      const stp=g.fabricH/nB;
      const sy=(y-g.fabBot-stp*0.5)/stp,jt=Math.round(sy);
      if(jt>=0&&jt<nB&&Math.abs(dxp)<postHalf+0.3){
        const cv=strip(Math.abs(dxp),postHalf+0.105,ipx)*
                 slab(y,g.fabBot+stp*(jt+0.5)-0.4375,g.fabBot+stp*(jt+0.5)+0.4375,ipx);
        if(cv>0.0015){
          wireShade(u,v,ex,0.55,wetLo*0.6,4400+jt);
          put(cv,sR*1.02,sG*1.02,sB,sRg,sMt,g.postD*0.5+0.105,8,0);
        }
      }
      const bd=Math.abs(dxp-postHalf*0.75);
      const cvb=strip(bd,0.375,ipx)*slab(y,g.fabBot,g.fabTop,ipx);
      if(cvb>0.0015){
        wireShade(u,v,ex,0.5,wetLo*0.6,4500);
        put(cvb,sR,sG,sB,sRg,sMt,fabZc+0.19,8,255);
      }
    }

    /* --- tie wires: tiny, and the first thing missing from a bad chain link */
    if(tieAmt>0.02&&wpx>=1.0){
      if(Math.abs(dxp)<1.5){
        const nT=Math.max(1,Math.round((g.fabTop-g.fabBot)/12));
        const stp=(g.fabTop-g.fabBot)/nT;
        const sy=(y-g.fabBot-stp*0.5)/stp,jt=Math.round(sy);
        if(jt>=0&&jt<nT&&hashi(j*29+jt,7,seed+401)<tieAmt){
          const ty=g.fabBot+stp*(jt+0.5);
          const cv=strip(Math.abs(y-ty),rw*0.9,ipx)*strip(Math.abs(dxp),postHalf+0.55,ipx);
          if(cv>0.0015){
            wireShade(u,v,ex,0.3,wetLo*0.5,4600+jt);
            put(cv,sR*1.1,sG*1.1,sB*1.08,Math.max(0.1,sRg-0.1),sMt,fabZc+rw*1.6,8,0);
          }
        }
      }
      if(g.topRail){
        const ty=g.fabTop-1-sagDrop(x,fabSag*0.22);
        const stp=tileWin/nTieTop;
        const sx2=x/stp,jt=Math.round(sx2),it=md(jt,nTieTop);
        if(hashi(it,11,seed+403)<tieAmt){
          const cv=strip(Math.abs((sx2-jt)*stp),rw*0.9,ipx)*
                   strip(Math.abs(y-ty),g.topRailD*0.62,ipx);
          if(cv>0.0015){
            wireShade(u,v,Math.min(1,ex*1.2),0.3,0.3,4700+it);
            put(cv,sR*1.1,sG*1.1,sB*1.08,Math.max(0.1,sRg-0.1),sMt,g.topRailD*0.5+rw,8,0);
          }
        }
      }
    }

    /* --- barbed extension arms --- */
    if(g.armType!=="none"&&g.armRise>0&&y>g.postTop-0.5){
      const dy=y-g.postTop;
      const vert=(g.armType==="avert");
      const arms=(g.armType==="av")?[-1,1]:[vert?0:1];
      for(let ai=0;ai<arms.length;ai++){
        const dir=arms[ai];
        const ax=dir*dy*0.45;      // it leans out of the plane, not along the run
        const cv=strip(Math.abs(dxp-ax),0.42,ipx)*slab(dy,0,g.armRise,ipx);
        if(cv>0.0015){
          wireShade(u,v,1,0.35,0.2,4800+ai);
          put(cv,sR,sG,sB,sRg,sMt,g.postD*0.5,8,0);
        }
      }
      for(let si=1;si<=g.armStrands;si++){
        const sy2=g.postTop+si*g.strandGap*(vert?1:0.7071);
        const dyr=y-sy2;
        if(Math.abs(dyr)>0.09+ipx)continue;
        /* double-strand barbed wire: two twisted 12.5 ga wires */
        const tw=Math.sin(TAU*x/1.6)*0.045;
        const cv=strip(Math.abs(dyr-tw),0.05,ipx)+strip(Math.abs(dyr+tw),0.05,ipx);
        const bx=frac(x/5);
        const barb=(1-smoothstep(0.02,0.06,Math.min(bx,1-bx)))*
                   strip(Math.abs(dyr),0.22,ipx);
        const tot=Math.min(1,cv+barb);
        if(tot>0.0015){
          wireShade(u,v,1,0.55,0.15,4900+si);
          put(tot,sR,sG,sB,sRg,sMt,g.postD*0.5+0.4*si,8,0);
        }
      }
    }
  }

  /* ============ welded wire site panel ============
     The wires are WELDED, so a crossing is not a weave: one lies fully in
     front of the other, in contact, and every weld nugget burns the zinc off
     and becomes a rust dot — which is the type's signature. */
  const mpR=(g.mpTube||1.575)*0.5,mwR=(g.mpWire||0.138)*0.5;
  const mpLean=clamp(+Q.mpLean||0,0,1),mpCoup=clamp(+Q.mpCoupler||0,0,1);
  const mpRc=8;
  function drawMesh(x,y,u,v,ex){
    const cell=Math.floor(x/g.bayIn),ip=md(cell,g.bays);
    const cx=(cell+0.5)*g.bayIn;
    const hl=hashi(ip,7,seed+431),hz=hashi(ip,11,seed+433);
    const lean=(hl-0.5)*2*mpLean*0.035;
    const dxc=x-cx-lean*Math.max(0,y);
    const zoff=(hz-0.5)*mpLean*1.2;
    const bot=g.panelBot,top=g.panelBot+g.mpH,cy=(top+bot)*0.5;
    const hx=g.bayIn*0.5-mpR,hy=(top-bot)*0.5-mpR;
    const wetLo=smoothstep(gSplash*1.2,0,y)*0.9;

    /* the feet: one block under each joint, so adjacent panels share it */
    if(g.mpFeet&&y<5.6){
      const bs=x/g.bayIn,jb=Math.round(bs),dxb=(bs-jb)*g.bayIn;
      const cv=strip(Math.abs(dxb),11.8,ipx)*slab(y,-belowIn,5.1,ipx);
      if(cv>0.0015){
        const mott=fbm2(u,v,NfX,NfY,3,seed+437);
        const t=0.82+0.3*mott;
        put(cv,52*t,50*t,50*t,0.92,0,g.postD*0.5+2.6,12,0);
      }
    }
    /* the mesh, inside the frame */
    if(g.nAx>1||g.nAy>1){
      const inX=hx-mpR,inY=hy-mpR;
      if(Math.abs(dxc)<inX+ipx&&y>cy-inY-ipx&&y<cy+inY+ipx){
        const sv=dxc/g.apW+g.nAx*0.5,jv=Math.round(sv);
        const sh=(y-(cy-inY))/g.apH,jh=Math.round(sh);
        const weld=(Math.abs((sv-jv)*g.apW)<0.45&&Math.abs((sh-jh)*g.apH)<0.45)?1:0;
        if(jh>=1&&jh<=g.nAy-1){
          const cv=strip(Math.abs((sh-jh)*g.apH),mwR,ipx);
          if(cv>0.0015){
            steel(u,v,ex,weld*0.85,wetLo,5000+jh);
            put(cv,sR,sG,sB,sRg,sMt,zoff-mwR,5,255);
            putN(0,clamp((sh-jh)*g.apH/mwR,-1,1)*1.4,1-smoothstep(6,11,mwR*2*PXI));
          }
        }
        if(jv>=1&&jv<=g.nAx-1){
          const cv=strip(Math.abs((sv-jv)*g.apW),mwR,ipx);
          if(cv>0.0015){
            steel(u,v,ex,weld*0.85,wetLo,5100+jv);
            put(cv,sR,sG,sB,sRg,sMt,zoff+mwR,5,255);
            putN(-clamp((sv-jv)*g.apW/mwR,-1,1)*1.4,0,1-smoothstep(6,11,mwR*2*PXI));
          }
        }
      }
    }
    /* the frame: an unbroken specular rectangle, rounded at the corners */
    {
      const rc=(g.mpRound&&y>cy)?mpRc:0;
      const qx=Math.abs(dxc)-(hx-rc);
      const qy=Math.abs(y-cy)-(hy-rc);
      const mx=Math.max(qx,0),my=Math.max(qy,0);
      const dR=Math.hypot(mx,my)+Math.min(Math.max(qx,qy),0)-rc;
      const ad=Math.abs(dR);
      if(ad<mpR+ipx){
        const cv=disc(ad,mpR,ipx);
        if(cv>0.0015){
          const t=Math.min(ad,mpR*0.999);
          const zf=Math.sqrt(Math.max(1e-4,mpR*mpR-t*t));
          steel(u,v,ex,smoothstep(bot+2,bot,y)*0.7,wetLo,5200);
          put(cv,sR,sG,sB,sRg,sMt,zoff+zf,5,0);
          const nrm=(dR<0?-1:1)*t/zf;
          const ux=(qx>0||qy>0)?(mx/Math.max(1e-4,Math.hypot(mx,my))):((qx>qy)?1:0);
          const uy=(qx>0||qy>0)?(my/Math.max(1e-4,Math.hypot(mx,my))):((qx>qy)?0:1);
          putN(-nrm*ux*(dxc<0?-1:1),nrm*uy*((y-cy)<0?-1:1),1-smoothstep(8,16,mpR*2*PXI));
        }
      }
    }
    /* couplers at the joints, one bolt each */
    if(mpCoup>0.02){
      const bs=x/g.bayIn,jb=Math.round(bs),dxb=(bs-jb)*g.bayIn;
      if(Math.abs(dxb)<2.6){
        for(let ci=0;ci<2;ci++){
          const cyy=ci?top-4:bot+4;
          const cv=strip(Math.abs(dxb),2.1,ipx)*slab(y,cyy-1,cyy+1,ipx);
          if(cv>0.0015&&hashi(md(jb,g.bays)*7+ci,5,seed+439)<mpCoup){
            steel(u,v,ex,0.4,wetLo*0.6,5300+ci);
            put(cv,sR*0.94,sG*0.94,sB*0.94,Math.min(1,sRg+0.06),sMt,zoff+mpR+0.2,8,0);
          }
        }
      }
    }
  }

  /* ============ iron and palisade ============ */
  const pkPitch=g.pkPitch||4.7,pkHalf=(g.pkBarW||0.75)*0.5,pkT=g.pkT||0.75;
  const irRailW=g.irRailW||1;
  const puppy=clamp(+Q.puppy||0,0,1);
  function pkProfile(ac){
    /* a SQUARE section with a small radius is the whole visual difference
       from chain link's round wire; the palisade's W-fold is four bands */
    const t=clamp(Math.abs(ac)/Math.max(0.02,pkHalf),0,1);
    if(g.ironStyle==="palD")return pkT*Math.sqrt(Math.max(0,1-t*t));
    if(g.ironStyle==="palW"){
      const w=Math.cos(TAU*ac/Math.max(0.05,pkHalf));
      return pkT*(0.5+0.5*w)*0.85+pkT*0.1;
    }
    const r=0.06/Math.max(0.02,pkHalf);
    return pkT*(t<1-r?1:Math.sqrt(Math.max(0,1-Math.pow((t-(1-r))/r,2))));
  }
  function drawIron(x,y,u,v,ex){
    const wetLo=smoothstep(gSplash*1.2,0,y)*0.9;
    const drop=sagDrop(x,sagIn*0.4);
    /* rails, passing BEHIND the pickets with a visible z gap */
    for(let i=0;i<g.railY.length;i++){
      const ry=g.railY[i]-drop;
      const cv=slab(y,ry-irRailW*0.5,ry+irRailW*0.5,ipx);
      if(cv<=0.0015)continue;
      /* the rail rusts where the pales bolt through it and where water sits
         along its bottom leg, not uniformly over the whole section */
      const bolt=1-strip(Math.abs(frac(x/pkPitch)-0.5)*pkPitch,0.45,ipx);
      steel(u,v,ex*0.8,clamp(smoothstep(ry+irRailW*0.5,ry-irRailW*0.1,y)*0.22+
            (1-bolt)*0.35+smoothstep(14,2,y)*0.4,0,1),wetLo*0.7,5400+i);
      put(cv,sR*0.96,sG*0.96,sB*0.96,sRg,sMt,irRailW*0.5,CT.id,0);
    }
    /* the pickets */
    for(let pass=0;pass<2;pass++){
      const pitch=pass?pkPitch:pkPitch;
      const off=pass?pkPitch*0.5:0;
      if(pass&&puppy<=0.01)break;
      const sp=(x-off)/pitch,jp=Math.round(sp),ip=md(jp,g.nPk);
      const dpx=(sp-jp)*pitch;
      const ad=Math.abs(dpx);
      if(ad>pkHalf+g.pkTopIn*0.4+ipx)continue;
      const hp=hashi(ip+(pass?g.nPk:0),13,seed+443);
      const topR=g.railTop-drop;
      let bot=g.botGap,top=topR;
      if(pass){top=Math.min(topR,g.railY[0]+g.irRailW*0.5);}
      let cov=strip(ad,pkHalf,ipx)*slab(y,bot,top,ipx);
      let z=pkProfile(dpx)+irRailW*0.5;
      /* the top: flush, or projecting above the rail carrying a spear */
      if(!pass&&g.pkTop!=="flat"&&g.pkTopIn>0&&y>top-0.2){
        const dy=y-top,R=g.pkTopIn;
        let hw=0;
        if(g.pkTop==="spear")hw=(dy<R*0.16)?pkHalf*1.5:pkHalf*1.1*(1-(dy-R*0.16)/(R*0.84));
        else if(g.pkTop==="ball"){const c=dy-R*0.5;hw=Math.sqrt(Math.max(0,(R*0.5)*(R*0.5)-c*c));}
        else if(g.pkTop==="round")hw=pkHalf*Math.sqrt(Math.max(0,1-Math.pow(dy/R,2)));
        else if(g.pkTop==="triple"){
          const k3=Math.abs(frac((dpx+pkHalf)/(pkHalf*0.667))-0.5)*2;
          hw=(dy<R*(0.35+0.65*k3))?pkHalf:0;
        }
        if(hw>0.002)cov=Math.max(cov,strip(ad,hw,ipx)*slab(dy,0,R,ipx));
      }
      if(cov<=0.0015)continue;
      /* water sits inside a hollow picket and eats it from the base up */
      const cut=smoothstep(bot+7,bot,y)*0.9+smoothstep(top-0.6,top,y)*0.5;
      steel(u,v,ex*(0.85+0.3*hp),cut,wetLo,5500+ip+(pass?977:0));
      put(cov,sR,sG,sB,sRg,sMt,z,CT.id,255);
      if(g.ironStyle!=="tube")
        putN(-(pkProfile(dpx+0.03)-pkProfile(dpx-0.03))/0.06,0,
             0.6*(1-smoothstep(6,12,pkHalf*2*PXI)));
    }
  }

  /* ============ corrugated hoarding ============ */
  const corAmp=(g.corDepth||0.875)*0.5,corP=g.corPitch||3;
  const corPx=corP*PXI,useCorr=corPx>=2.2;
  const corFade=useCorr?1:smoothstep(1.2,2.2,corPx);
  const corFix=clamp(+Q.corFix||0,0,1),corDent=clamp(+Q.corDent||0,0,1),
        corOil=clamp(+Q.corOil||0,0,1),corPost=clamp(+Q.corPost||0,0,1),
        corPoster=clamp(+Q.corPoster||0,0,1);
  const sheetZ=g.postD*0.5+1.5+corAmp;
  function corWave(t){
    const f=frac(t);
    if(g.corShape==="box"){
      const rib=0.21;
      return (f<rib)?1:((f<rib+0.06)?1-2*(f-rib)/0.06:((f<1-0.06)?-1:-1+2*(f-(1-0.06))/0.06));
    }
    if(g.corShape==="trap"){
      const a=0.28,b=0.16;
      if(f<a)return 1;
      if(f<a+b)return 1-2*(f-a)/b;
      if(f<1-b)return -1;
      return -1+2*(f-(1-b))/b;
    }
    return Math.cos(TAU*f);
  }
  function drawCorr(x,y,u,v,ex){
    const wetLo=smoothstep(gSplash*1.2,0,y)*0.9;
    /* the frame behind: almost invisible, and it must still exist — the
       fixings land on it, the sheet dents between it, and its feet show */
    if(corPost>0.02){
      for(let i=0;i<g.railY.length;i++){
        const ry=g.railY[i];
        const cv=slab(y,ry-1.75,ry+1.75,ipx);
        if(cv<=0.0015)continue;
        const hr=hashi(i*61,17,seed+449);
        timber(u,v,y-ry,x,1.75,hr,ex*0.35,800+i,true,frac(x/g.bayIn),tileWin);
        put(cv,tR*0.75,tG*0.75,tB*0.72,Math.min(1,tRg+0.05),0,g.postD*0.5+0.75,2,0);
      }
    }
    const t=x/corP;
    const w=corWave(t)*corFade;
    let z=sheetZ+corAmp*w;
    const dw=(corWave(t+0.004)-corWave(t-0.004))*corFade/(0.008*corP);
    let gx=corAmp*dw;
    /* oil canning: low-frequency waviness of the flat pan, visible only in
       the specular, and reused straight from the roof generator's idea */
    if(corOil>0)z+=(fbm2(u,v,Math.max(2,Math.round(tileWin/22)),
                          Math.max(2,Math.round(tileHin/22)),2,seed+451)-0.5)*0.06*corOil;
    /* dents: the sheet gives BETWEEN the rails, the profile flattens locally
       and the paint cracks on the crease ring */
    let crease=0;
    if(corDent>0){
      const ND=Math.max(2,Math.round(tileWin/26));
      worley(u*ND,v*ND*g.k,ND,Math.max(2,Math.round(ND*g.k)),seed+457,0.95);
      if(hashi(W_cx,W_cy,seed+461)<corDent*0.45){
        const rad=0.26+0.2*hashi(W_cx,W_cy,seed+463);
        const dent=1-smoothstep(rad*0.5,rad,W_f1);
        crease=(1-smoothstep(rad*1.05,rad*1.35,W_f1))*(1-dent)*0.45;
        z=sheetZ+corAmp*w*(1-0.7*dent)-dent*(0.2+0.4*corDent);
        gx*=1-0.7*dent;
      }
    }
    const cov=slab(y,g.sheetBot,g.sheetTop,ipx);
    if(cov>0.0015){
      /* red rust bleeds out of the CUT bottom edge and along the laps */
      const lap=Math.abs(frac(x/g.corCover)-0.5)*g.corCover;
      const lapLine=1-smoothstep(0.12,0.45,lap);
      const cut=clamp(smoothstep(g.sheetBot+7,g.sheetBot,y)*0.95+
                      lapLine*0.5+crease*0.5,0,1);
      steel(u,v,ex,cut,wetLo,5600);
      let r=sR,gg=sG,b=sB,rg=sRg,mt=sMt,id=sId;
      if(lapLine>0.02){const d2=1-lapLine*0.12;r*=d2;gg*=d2;b*=d2;z-=lapLine*0.03;}
      /* fixings: hex head with an EPDM washer, every third crest on a rail */
      if(corFix>0.02){
        const crest=Math.abs(frac(t)-0.0)<0.5?frac(t):frac(t)-1;
        const nearCrest=Math.abs(crest)<0.22;
        const third=md(Math.round(t),3)===0;
        if(nearCrest&&third){
          for(let i=0;i<g.railY.length;i++){
            const d2=Math.hypot(crest*corP,y-g.railY[i]);
            const fx2=(1-smoothstep(0.24,0.34,d2))*(hashi(md(Math.round(t),97)*11+i,3,seed+467)<corFix?1:0);
            if(fx2>0.01){
              r=lerp(r,72,fx2*0.85);gg=lerp(gg,76,fx2*0.85);b=lerp(b,80,fx2*0.85);
              rg=lerp(rg,0.45,fx2);mt=lerp(mt,1,fx2*0.6);z+=fx2*0.1;id=8;
            }
          }
        }
      }
      /* posters: a flat decal with torn edges. NO height — a poster is four
         thousandths of an inch thick and giving it relief makes a toy */
      if(corPoster>0.02){
        /* a fly-poster is a RECTANGLE of paper pasted flat, and its torn
           remains and paste ghost are rectangles too — a soft round blob
           reads as a paint splodge, which is the wrong thing entirely */
        const cw=26,ch=34;
        const cxi=Math.floor(x/cw),cyi=Math.floor((y-g.sheetBot)/ch);
        const nCx=Math.max(1,Math.round(tileWin/cw));
        for(let oy=0;oy<=1;oy++)for(let ox=-1;ox<=0;ox++){
          const ci=md(cxi+ox,nCx),cj=cyi+oy;
          const h1=hashi(ci,cj*7+1,seed+469);
          if(h1>=corPoster*0.6)continue;
          const h2=hashi(ci,cj*7+2,seed+471),h3=hashi(ci,cj*7+3,seed+473);
          const h4=hashi(ci,cj*7+4,seed+477);
          const pw2=(9+7*h2),ph2=(12+10*h3);
          const px2=(cxi+ox+0.5+(h2-0.5)*0.5)*cw,py2=g.sheetBot+(cj+0.5+(h3-0.5)*0.5)*ch;
          if(py2+ph2<g.sheetBot+4||py2-ph2>g.sheetTop-3)continue;
          const dxp2=x-px2,dyp2=y-py2;
          if(Math.abs(dxp2)>pw2+1.5||Math.abs(dyp2)>ph2+1.5)continue;
          const tear=(fbm2(u,v,NfX*3,NfY*3,2,seed+479+ci)-0.5)*1.6;
          const inside=Math.min(pw2-Math.abs(dxp2),ph2-Math.abs(dyp2))+tear;
          const po=smoothstep(0,0.35,inside);
          const ghost=smoothstep(-1.4,-0.2,inside)*(1-po);
          const gone=smoothstep(0.5,0.62,fbm2(u,v,Math.max(4,Math.round(tileWin/5)),
                     Math.max(4,Math.round(tileHin/5)),2,seed+487+ci)+(h4-0.75)*0.5);
          if(po>0.01){
            const keep=po*(1-gone);
            /* paper, one image block and a few lines of type: at any distance
               that reads as a poster, where a field of coloured noise reads as
               someone threw a tin at the hoarding */
            const pal=PAPER[Math.floor(hashi(ci,cj,seed+491)*PAPER.length)%PAPER.length];
            const lx=clamp((dxp2/pw2+1)*0.5,0,1),ly=clamp((1-dyp2/ph2)*0.5,0,1);
            const dark=hashi(ci,cj,seed+493)<0.5;
            const ic=dark?[26,24,26]:[240,238,232];
            let ink=0;
            if(ly>0.10&&ly<0.58&&lx>0.08&&lx<0.92)ink=0.9;         // the image block
            else if(ly>=0.62&&ly<0.95){
              const line=frac((ly-0.62)*6.5);
              const wdt=0.30+0.52*hashi(ci,cj*13+Math.floor((ly-0.62)*6.5),seed+499);
              if(line<0.42&&lx>0.10&&lx<0.10+wdt)ink=1;             // lines of type
            }
            const rr2=lerp(pal[0],ic[0],ink),gg3=lerp(pal[1],ic[1],ink),bb2=lerp(pal[2],ic[2],ink);
            r=lerp(r,rr2,keep*0.94);gg=lerp(gg,gg3,keep*0.94);b=lerp(b,bb2,keep*0.94);
            rg=lerp(rg,0.72,keep);mt=lerp(mt,0,keep);
            if(keep>0.4)id=4;
          }
          const paste=Math.max(ghost,po*gone*0.7);
          if(paste>0.01){
            r=lerp(r,206,paste*0.5);gg=lerp(gg,202,paste*0.5);b=lerp(b,194,paste*0.5);
            rg=lerp(rg,0.88,paste*0.6);
          }
        }
      }
      put(cov,r,gg,b,rg,mt,z,id,255);
      putN(gx,0,useCorr?0.45:0);
    }
  }

  /* ============ the vertical window ============
     One texel inside each edge the alpha is forced to exactly zero, so rows 0
     and H-1 are bit-identical background and the tile wraps in V by
     construction rather than by luck. Everything between fades over an inch. */
  const kill=1.0;
  /* The guaranteed-empty band is a FRACTION of the tile, not a texel or two:
     every downsample of this texture — the app's own chips, a mip level, the
     seam check — samples the last row a little short of the true edge, and a
     band only one texel deep is missed by all of them. Two per cent of the
     tile height survives any of them, and there is always room for it because
     the aspect rule reserves at least four inches at each end. */
  const pad=clamp(tileHin*0.02,IPX*2,Math.max(IPX*2,Math.min(belowIn,airIn)*0.6));
  const yLo=-belowIn+pad,yHi=topMost+airIn-pad;
  const winV=y=>smoothstep(yLo,yLo+kill,y)*smoothstep(yHi,yHi-kill,y);

  let bgR=0,bgG=0,bgB=0,bgN=0;
  const band=Math.max(2,Math.round(48000/W));
  let yy=0;

  function pass1(){
    const end=Math.min(H,yy+band);
    for(;yy<end;yy++){
      const v=(yy+0.5)/H;
      const y=tileHin*(1-v)-belowIn;
      const wv=winV(y);
      for(let xx=0;xx<W;xx++){
        const u=(xx+0.5)/W,x=u*tileWin,i=yy*W+xx;
        reset();
        const ex=clamp(0.42+0.58*smoothstep(0,topMost*0.62,y),0,1);

        if(type==="board"||type==="picket"){
          drawPost(x,y,u,v,ex);
          drawRailsH(x,y,u,v,ex,railZ0,railZ1,railW,railT,2);
          if(g.twoCourse)drawBoardCourse(x,y,u,v,ex,0);
          drawBoardCourse(x,y,u,v,ex,1);
        }else if(type==="rail"){
          drawPost(x,y,u,v,ex);
          drawSplitRails(x,y,u,v,ex);
        }else if(type==="chain"){
          drawPost(x,y,u,v,ex);
          drawChain(x,y,u,v,ex);
        }else if(type==="mesh"){
          drawMesh(x,y,u,v,ex);
        }else if(type==="iron"){
          drawPost(x,y,u,v,ex);
          drawIron(x,y,u,v,ex);
        }else{
          drawPost(x,y,u,v,ex);
          drawCorr(x,y,u,v,ex);
        }
        drawVines(x,y,u,v);
        drawGround(x,y,u,v);

        let a=Math.min(1,ea);
        let r=0,gg=0,b=0,rg=0.92,mt=0,z=0;
        if(a>1e-4){r=pr/a;gg=pg/a;b=pb/a;rg=prg/a;mt=pmt/a;z=pz/a;}

        if(a>0.002){
          /* splash-back: rain throws soil at the bottom of everything, dense
             in the first few inches and gone by sixteen */
          if(gSplash>0.5&&gClut>0.04&&y<gSplash&&y>-belowIn){
            const sp=smoothstep(gSplash,0,y);
            const dots=smoothstep(0.48,0.82,fbm2(u,v,NfX*3,NfY*3,3,seed+491));
            const k2=clamp(sp*sp*dots*gClut*1.1,0,0.85);
            r=lerp(r,cGround[0]*0.85,k2);gg=lerp(gg,cGround[1]*0.85,k2);b=lerp(b,cGround[2]*0.8,k2);
            rg=lerp(rg,0.95,k2);mt=lerp(mt,0,k2*0.8);
            if(k2>0.45)eid=11;
          }
          /* moss and algae: a damp band low down and in the shaded laps */
          if(gMoss>0.01){
            const damp=smoothstep(topMost*0.55,0,y)*0.75+0.25;
            const m=clamp(gMoss*damp*smoothstep(0.52,0.86,fbm2(u,v,NmX,NmY,3,seed+493)),0,0.9);
            if(m>0.006){
              r=lerp(r,cMoss[0]*0.85,m*0.8);gg=lerp(gg,cMoss[1]*0.9,m*0.8);b=lerp(b,cMoss[2]*0.8,m*0.8);
              rg=lerp(rg,0.96,m);mt=lerp(mt,0,m*0.9);z+=m*0.012;
              if(m>0.45)eid=10;
            }
          }
        }

        const alpha=a*wv;
        ALP[i]=alpha*255;
        A[i*3]=r;A[i*3+1]=gg;A[i*3+2]=b;
        RGH[i]=clamp(rg,0.03,1)*255;
        MET[i]=clamp(mt,0,1)*255;
        HGT[i]=z;
        IDm[i]=alpha>0.004?eid:0;
        MSK[i]=alpha>0.004?emsk:0;
        AOc[i]=255;
        const nw=Math.min(1,naw);
        if(nw>0.012&&naw>1e-5){
          NAX[i]=128+clamp(nax/naw,-4,4)*31;
          NAY[i]=128+clamp(nay/naw,-4,4)*31;
          NAW[i]=nw*255;
        }else{NAX[i]=128;NAY[i]=128;NAW[i]=0;}
        if(alpha>0.02){bgR+=r*alpha;bgG+=gg*alpha;bgB+=b*alpha;bgN+=alpha;}
      }
    }
    if(yy<H){io.progress(yy/H*0.66);setTimeout(pass1,0);}
    else{io.progress(0.70);setTimeout(pass2,0);}
  }

  function pass2(){
    hMin=Infinity;hMax=-Infinity;
    for(let i=0;i<N;i++){if(!ALP[i])continue;const h=HGT[i];if(h<hMin)hMin=h;if(h>hMax)hMax=h;}
    if(!isFinite(hMin)){hMin=0;hMax=1;}
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;
    /* air sits BELOW everything for the occlusion pass, so a silhouette edge
       against nothing reads as no occlusion at all rather than a dark rim */
    const air=hMin-0.35;
    for(let i=0;i<N;i++)if(!ALP[i])HGT[i]=air;

    const r1=clamp(Math.round(0.40*PXI),1,10),r2=clamp(Math.round(3.0*PXI),3,56);
    const aoStr=clamp(Q.aoStr==null?0.8:+Q.aoStr,0,1);
    {
      const b1=blurWH(HGT,W,H,r1);
      for(let i=0;i<N;i++)AOc[i]=clamp((b1[i]-HGT[i])*1.9,0,1)*255;
    }
    io.progress(0.80);
    {
      const b2=blurWH(HGT,W,H,r2);
      for(let i=0;i<N;i++){
        if(!ALP[i]){AOc[i]=255;continue;}
        const c1=AOc[i]/255,c2=clamp((b2[i]-HGT[i])*0.55,0,1);
        const occ=clamp(c1*0.55+c2*0.8,0,1)*aoStr;
        AOc[i]=clamp(1-occ,0,1)*255;
        /* dirt settles wherever the surface is low — the last stage, after
           everything else, exactly as the hazard mode does it */
        if(gDirt>0&&c1>0.02){
          const k2=clamp(c1*1.25,0,1)*gDirt*0.62;
          A[i*3]=lerp(A[i*3],74,k2);A[i*3+1]=lerp(A[i*3+1],68,k2);A[i*3+2]=lerp(A[i*3+2],60,k2);
          RGH[i]=lerp(RGH[i],242,k2);
        }
      }
    }
    io.progress(0.88);

    /* normals: a central difference at the true inch scale, with air
       neighbours replaced by the centre so a cut-out edge is not a cliff,
       blended into the analytic element normal wherever one was written */
    const gy=Q.flipG?-1:1,nst=+Q.normalStr||1;
    for(let y2=0;y2<H;y2++){
      const y0=y2*W,yp=Math.min(H-1,y2+1)*W,ym=Math.max(0,y2-1)*W;
      for(let x2=0;x2<W;x2++){
        const i=y0+x2,j=i*3;
        if(!ALP[i]){NRM[j]=128;NRM[j+1]=128;NRM[j+2]=255;continue;}
        const xp=(x2+1)%W,xm=(x2-1+W)%W;
        const hc=HGT[i];
        const hxp=ALP[y0+xp]?HGT[y0+xp]:hc,hxm=ALP[y0+xm]?HGT[y0+xm]:hc;
        const hyp=ALP[yp+x2]?HGT[yp+x2]:hc,hym=ALP[ym+x2]?HGT[ym+x2]:hc;
        let sx=(hxp-hxm)/(2*IPX),sy=(hyp-hym)/(2*IPX);
        const w=NAW[i]/255;
        if(w>0.004){
          sx=lerp(sx,(NAX[i]-128)/31,w);
          sy=lerp(sy,(NAY[i]-128)/31,w);
        }
        sx*=nst;sy*=nst;
        let nx=-sx,ny=-sy*gy;
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;
        NRM[j]=(nx*0.5+0.5)*255;NRM[j+1]=(ny*0.5+0.5)*255;NRM[j+2]=(inv*0.5+0.5)*255;
      }
    }

    /* every transparent texel gets the SAME constants, and the albedo it gets
       is the fence's own mean colour — so mipmapping drags the fabric's grey
       into every wire edge instead of dragging black in */
    const fR=bgN>0?bgR/bgN:128,fG=bgN>0?bgG/bgN:128,fB=bgN>0?bgB/bgN:128;
    for(let i=0;i<N;i++){
      if(ALP[i])continue;
      A[i*3]=fR;A[i*3+1]=fG;A[i*3+2]=fB;
      RGH[i]=235;MET[i]=0;AOc[i]=255;HGT[i]=hMin;IDm[i]=0;MSK[i]=0;
    }
    io.progress(1);
    io.done({A:A,NRM:NRM,RGH:RGH,MET:MET,AO:AOc,HGT:HGT,ALP:ALP,ID:IDm,MSK:MSK,
             hMin:hMin,hMax:hMax});
  }

  io.progress(0.02);
  setTimeout(pass1,0);
}

/* ============================ LOD verdict ============================
   One number decides how every thin element is drawn: how many texels wide
   it is. The readout prints what survived and what was dropped, because a
   fence at 1024 is mostly features under two texels and the mode has to be
   good at that rather than merely warn about it. */
function lod(P,g,W){
  const IPX=g.tileWin/W,PXI=1/IPX;
  const o={IPX:IPX,PXI:PXI,keep:[],drop:[]};
  if(g.type==="chain"){
    o.wpx=g.wire*PXI;o.apPx=g.meshBuilt*PXI;
    if(o.apPx<3)o.drop.push("the diamond itself — flat screen at "+
      Math.round(100*(1-g.open))+"% blockage");
    else o.keep.push("diamond lattice");
    if(o.wpx>=3)o.keep.push("full round wire");
    else if(o.wpx>=2)o.keep.push("analytic wire normal");
    else if(o.wpx>=1)o.keep.push("faded wire relief");
    else o.drop.push("wire round-over — correct-density haze only");
    if(o.wpx>=1.1)o.keep.push("knuckles and ties");else o.drop.push("knuckles, barbs and tie wires");
  }else if(g.type==="mesh"){
    o.wpx=g.mpWire*PXI;
    if(o.wpx>=2)o.keep.push("mesh wire relief");else o.drop.push("mesh wire relief");
    o.keep.push("frame tube");
  }else if(g.type==="board"||g.type==="picket"){
    o.gapPx=g.gapBuilt*PXI;
    if(o.gapPx>=2)o.keep.push("board gap groove and AO");
    else if(g.gapBuilt>0)o.drop.push("board gap groove — alpha only");
    o.keep.push("full board geometry");
  }else if(g.type==="corr"){
    o.corPx=g.corPitch*PXI;
    if(o.corPx>=2.2)o.keep.push("full corrugation");
    else o.drop.push("corrugation amplitude — faded flat");
  }else if(g.type==="iron"){
    o.pkPx=g.pkBarW*PXI;
    if(o.pkPx>=3)o.keep.push("square picket section");
    else o.drop.push("picket section relief");
  }else{
    o.keep.push("full geometry");
  }
  const spanglePx=0.7*PXI;
  if(spanglePx>=3)o.keep.push("galvanising spangle");else o.drop.push("spangle and grain bands");
  return o;
}

/* ============================ mode definition ============================ */

const postOptions=Object.keys(POSTS).map(k=>[k,POSTS[k].label]);
const capOptions=Object.keys(CAPS).map(k=>[k,CAPS[k].label]);
const corOptions=Object.keys(CORPROF).map(k=>[k,CORPROF[k].label]);
const coatOptions=Object.keys(COAT).map(k=>[k,COAT[k].label]);

let lastPostType=null,lastProfile=null;

Forge.register({
  id:"fence",
  label:"Fence",
  group:"Buildings",
  blurb:"Board, picket, split rail, chain link, mesh panel, iron, hoarding",
  title:'Fence <em>Run</em>',
  tagline:"Board · picket · rail · chain link · mesh · iron · hoarding · real inches",
  actionLabel:"Build fence",
  busyLabel:"Building…",

  seamless:true,
  backdrops:true,
  flipPreviewY:true,
  previewSize:256,
  chipSource:144,
  preview:{gain:3.05,amb:1.18,specK:0.52,skyLo:[0.19,0.22,0.27],skyHi:[0.44,0.50,0.60]},

  channels:[
    {key:"basecolor",label:"Base + α"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Rough"},{key:"metallic",label:"Metal"},
    {key:"ao",label:"AO"},{key:"height",label:"Height"},{key:"orm",label:"ORM"},
    {key:"opacity",label:"Opacity"},{key:"id",label:"Mat ID"},{key:"infill",label:"Infill α"}
  ],

  presets:[
    {id:"suburban",label:"Suburban privacy",set:{
      type:"board",fenceH:72,bayFt:8,baysPerTile:1,aspectMode:"auto",face:"good",
      postType:"t44",postW:3.5,postCap:"bevel",capOverIn:0.75,postProud:2,subBays:0,
      postLean:0.15,postTone:0.35,
      boardW:5.5,boardT:0.75,layout:"butted",gapIn:0.125,topCut:"dogear",topCutIn:1.5,
      botGapIn:2,railsN:2,railW:3.5,railT:1.5,boardVar:0.3,sawn:false,
      grey:0.35,grainRaise:0.35,cup:0.2,splits:0.2,knots:0.45,nailStain:0.25,
      paint:0,peel:0.3,missing:0.02,broken:0.02,sagIn:0.375,
      moss:0.15,splashIn:8,clutter:0.5,clutterKind:"grass",vines:0,dirt:0.3,
      cWood:"#a9834f",cRail:"#8e6c46",cGrey:"#8c8a83",aaWide:1,normalStr:1,aoStr:0.8}},

    {id:"greyboard",label:"Weathered grey board",set:{
      type:"board",fenceH:72,bayFt:8,baysPerTile:2,aspectMode:"auto",face:"good",
      postType:"t44",postW:3.5,postCap:"flatcut",postProud:3,subBays:0,
      postLean:0.8,postTone:0.6,
      boardW:5.5,boardT:0.625,layout:"butted",gapIn:0.375,topCut:"dogear",topCutIn:1.5,
      botGapIn:3,railsN:2,railW:3.5,railT:1.5,boardVar:0.6,sawn:true,
      grey:0.95,grainRaise:0.8,cup:0.65,splits:0.75,knots:0.7,nailStain:0.7,
      paint:0,peel:0.3,missing:0.28,broken:0.22,sagIn:1.5,
      moss:0.55,splashIn:14,clutter:0.8,clutterKind:"grass",vines:0.2,dirt:0.7,
      cWood:"#8f7350",cRail:"#7d6440",cGrey:"#93918a",aaWide:1}},

    {id:"boardonboard",label:"Board-on-board cedar",set:{
      type:"board",fenceH:72,bayFt:8,baysPerTile:1,aspectMode:"auto",face:"good",
      postType:"t44",postW:3.5,postCap:"pyramid",postProud:3,subBays:0,
      postLean:0.2,postTone:0.4,
      boardW:5.5,boardT:0.625,layout:"bob",overlapIn:1,gapIn:0.125,
      topCut:"flat",topCutIn:1.5,botGapIn:2,railsN:3,railW:3.5,railT:1.5,
      boardVar:0.35,sawn:true,
      grey:0.5,grainRaise:0.6,cup:0.3,splits:0.35,knots:0.6,nailStain:0.3,
      paint:0,peel:0.3,missing:0.02,broken:0.02,sagIn:0.5,
      moss:0.2,splashIn:9,clutter:0.55,clutterKind:"grass",vines:0,dirt:0.35,
      cWood:"#a37a4d",cRail:"#8e6c46",cGrey:"#8c8a83"}},

    {id:"whitepicket",label:"White picket",set:{
      type:"picket",fenceH:42,bayFt:6,baysPerTile:2,aspectMode:"auto",face:"good",
      postType:"t44",postW:3.5,postCap:"ball",postProud:4,subBays:0,
      postLean:0.35,postTone:0.25,
      boardW:3.5,boardT:0.75,gapIn:3.5,topCut:"point",topCutIn:1.75,botGapIn:3,
      railsN:2,railW:3.5,railT:1.5,boardVar:0.2,sawn:false,
      grey:0.15,grainRaise:0.3,cup:0.15,splits:0.2,knots:0.25,nailStain:0.3,
      paint:1,peel:0.32,missing:0.03,broken:0.02,sagIn:0.5,
      moss:0.2,splashIn:9,clutter:0.6,clutterKind:"grass",vines:0,dirt:0.35,
      cPaint:"#f4f2ea",cWood:"#a8895f",cRail:"#9c7b4e",cGrey:"#8c8a83"}},

    {id:"ranchrail",label:"Split rail",set:{
      type:"rail",railKind:"split",fenceH:52,bayFt:9.5,baysPerTile:1,aspectMode:"auto",
      face:"good",postType:"rnd4",postW:4,postCap:"none",postProud:5,subBays:0,
      postLean:0.55,postTone:0.5,
      srRails:3,srThick:3.5,srDepth:5,srMortIn:4,srTaper:0.75,botGapIn:10,
      grey:0.7,grainRaise:0.6,cup:0.25,splits:0.55,knots:0.6,nailStain:0.05,
      paint:0,peel:0.3,missing:0.05,broken:0.05,sagIn:1.25,
      moss:0.45,splashIn:12,clutter:0.85,clutterKind:"grass",vines:0.25,dirt:0.5,
      cWood:"#9c8058",cRail:"#8e6c46",cGrey:"#8d8b84"}},

    {id:"industrial",label:"Industrial chain link",set:{
      type:"chain",fenceH:72,bayFt:10,baysPerTile:2,aspectMode:"auto",face:"good",
      postType:"p178",postW:1.9,postCap:"loop",postProud:1,subBays:0,
      postLean:0.2,postTone:0.3,
      meshIn:2,gauge:0.148,meshFit:"tile",meshPhase:0.5,botGapIn:2,
      selvTop:"knuckle",selvBot:"knuckle",topRail:true,tensWire:false,tensBar:true,ties:0.85,
      armType:"none",armLenIn:12,strandGap:4,slats:0,slatGone:0.2,fabSag:1,fabPush:0.2,
      coating:"hdg",spangle:0.55,whiteRust:0.25,redRust:0.15,chalk:0.1,metalDent:0.2,
      moss:0.1,splashIn:6,clutter:0.45,clutterKind:"gravel",vines:0,dirt:0.35,
      cCoat:"#b9bdc2",cRust:"#83411f",aaWide:1}},

    {id:"barbtop",label:"Chain link, barbed arms",set:{
      type:"chain",fenceH:96,bayFt:10,baysPerTile:2,aspectMode:"auto",face:"good",
      postType:"p238",postW:2.375,postCap:"none",postProud:1,subBays:0,
      postLean:0.3,postTone:0.35,
      meshIn:2,gauge:0.148,meshFit:"tile",meshPhase:0.5,botGapIn:2,
      selvTop:"barb",selvBot:"knuckle",topRail:true,tensWire:true,tensBar:true,ties:0.9,
      armType:"a45",armLenIn:12,strandGap:4,slats:0,slatGone:0.2,fabSag:1.5,fabPush:0.45,
      coating:"hdg",spangle:0.35,whiteRust:0.5,redRust:0.55,chalk:0.25,metalDent:0.45,
      moss:0.15,splashIn:6,clutter:0.5,clutterKind:"dirt",vines:0,dirt:0.55,
      cCoat:"#b0b4b8",cRust:"#83411f",aaWide:1}},

    {id:"slatted",label:"Slatted chain link",set:{
      type:"chain",fenceH:72,bayFt:10,baysPerTile:2,aspectMode:"auto",face:"good",
      postType:"p178",postW:1.9,postCap:"loop",postProud:1,subBays:0,
      postLean:0.25,postTone:0.3,
      meshIn:2,gauge:0.12,meshFit:"tile",meshPhase:0.5,botGapIn:2,
      selvTop:"knuckle",selvBot:"knuckle",topRail:true,tensWire:true,tensBar:false,ties:0.7,
      armType:"none",slats:0.85,slatGone:0.25,fabSag:1.2,fabPush:0.3,
      coating:"pvc",spangle:0,whiteRust:0.15,redRust:0.25,chalk:0.4,metalDent:0.3,
      moss:0.2,splashIn:8,clutter:0.5,clutterKind:"dirt",vines:0,dirt:0.45,
      cCoat:"#3e5a44",cSlat:"#4a6b3c",cRust:"#83411f"}},

    {id:"siteMesh",label:"Temporary site mesh",set:{
      type:"mesh",fenceH:82,bayFt:11.5,baysPerTile:1,aspectMode:"auto",face:"good",
      postType:"p138",postW:1.66,postCap:"none",postProud:0,subBays:0,postLean:0.1,
      mpWIn:137.8,mpHIn:78.7,mpApW:3.94,mpApH:11.81,mpWire:0.138,mpTube:1.575,
      mpFeet:true,mpRound:true,mpCoupler:0.85,mpLean:0.7,
      coating:"hdg",spangle:0.3,whiteRust:0.45,redRust:0.6,chalk:0.2,metalDent:0.5,
      moss:0.1,splashIn:6,clutter:0.55,clutterKind:"dirt",vines:0,dirt:0.6,
      cCoat:"#b9bdc2",cRust:"#83411f",aaWide:1}},

    {id:"palisade",label:"Steel palisade",set:{
      type:"iron",ironStyle:"palW",fenceH:96,bayFt:9,baysPerTile:1,aspectMode:"auto",
      face:"good",postType:"hsec",postW:4,postCap:"none",postProud:2,subBays:0,
      postLean:0.12,postTone:0.25,
      pkBarW:2.75,pkT:0.7,pkGap:3.15,pkTop:"triple",pkTopIn:4,pkRails:2,irRailW:2,
      botGapIn:2,puppy:0,
      coating:"pc",spangle:0,whiteRust:0.1,redRust:0.4,chalk:0.35,metalDent:0.2,
      moss:0.15,splashIn:8,clutter:0.5,clutterKind:"gravel",vines:0,dirt:0.45,
      cCoat:"#3b4d3c",cRust:"#7e3d1c"}},

    {id:"ornamental",label:"Ornamental iron",set:{
      type:"iron",ironStyle:"tube",fenceH:60,bayFt:7,baysPerTile:2,aspectMode:"auto",
      face:"good",postType:"sq2",postW:2,postCap:"pyramid",postProud:3,subBays:0,
      postLean:0.15,postTone:0.2,
      pkBarW:0.75,pkT:0.75,pkGap:3.9375,pkTop:"spear",pkTopIn:4.5,pkRails:2,irRailW:1,
      botGapIn:2,puppy:0.6,
      coating:"pc",spangle:0,whiteRust:0.05,redRust:0.2,chalk:0.2,metalDent:0.1,
      moss:0.12,splashIn:7,clutter:0.55,clutterKind:"grass",vines:0.15,dirt:0.3,
      cCoat:"#22262a",cRust:"#7e3d1c"}},

    {id:"hoarding",label:"Corrugated hoarding",set:{
      type:"corr",fenceH:96,bayFt:8,baysPerTile:1,aspectMode:"auto",face:"good",
      postType:"t44",postW:3.5,postCap:"none",postProud:0,subBays:0,
      postLean:0.15,botGapIn:2,
      corProfile:"sin3",corPitch:3,corDepth:0.875,corCover:32,corFix:0.8,corDent:0.5,
      corOil:0.45,corPost:0.7,corPoster:0.45,
      coating:"paint",spangle:0,whiteRust:0.2,redRust:0.7,chalk:0.5,metalDent:0.5,
      moss:0.2,splashIn:12,clutter:0.6,clutterKind:"dirt",vines:0,dirt:0.65,
      cCoat:"#5c6b63",cRust:"#7e3d1c",cWood:"#8a7148"}}
  ],

  controls:[
    {title:"Fence & output",open:true,rows:[
      {id:"size",type:"select",label:"Texture width",value:1024,showValue:true,options:Forge.sizes("plain")},
      {id:"type",type:"select",label:"Fence",value:"board",options:[
        ["board","Board privacy"],["picket","Picket"],["rail","Split rail / ranch rail"],
        ["chain","Chain link"],["mesh","Welded wire site panel"],
        ["iron","Wrought iron / palisade"],["corr","Corrugated hoarding"]]},
      {id:"fenceH",label:"Fence height",unit:"in",min:24,max:144,step:3,value:72},
      {id:"bayFt",label:"Bay (post spacing)",unit:"ft",min:4,max:12,step:0.5,value:8},
      {id:"baysPerTile",type:"select",label:"Bays per tile",value:1,options:[
        [1,"1 — smallest tile"],[2,"2 — snaps the mesh 2× closer"],[3,"3"],[4,"4"]]},
      {id:"aspectMode",type:"select",label:"Tile aspect",value:"auto",options:[
        ["auto","Auto — smallest power of two that fits"],
        ["1","Force 1:1"],["2","Force 1:2 — tall"],["4","Force 1:4"],
        ["0.5","Force 2:1 — wide"],["0.25","Force 4:1"]]},
      {id:"face",type:"select",label:"Side facing you",value:"good",options:[
        ["good","Good side — boards / fabric in front"],
        ["rail","Rail side — posts and rails in front"]]},
      {type:"readout"},
      {id:"seed",type:"seed",value:1948}
    ]},

    {title:"Posts",open:true,rows:[
      {id:"postType",type:"select",label:"Post",value:"t44",options:postOptions},
      {id:"postW",label:"Post width",unit:"in",min:1.5,max:8,step:0.125,value:3.5},
      {id:"subBays",type:"select",label:"Intermediate posts per bay",value:0,options:[
        [0,"None"],[1,"One — line post at mid-bay"],[2,"Two"]]},
      {id:"postProud",label:"Post stands above the fence",unit:"in",min:0,max:12,step:0.5,value:2},
      {id:"postCap",type:"select",label:"Cap",value:"bevel",options:capOptions},
      {id:"capOverIn",need:"capT",label:"Cap overhang",unit:"in",min:0,max:1.5,step:0.0625,value:0.75},
      {id:"postLean",label:"Out of plumb",min:0,max:1,step:0.01,value:0.25},
      {id:"postTone",label:"Post-to-post tone",min:0,max:1,step:0.01,value:0.35},
      {type:"note",need:"chain",html:"A line post takes a <b>loop cap</b> and the top rail runs "+
        "through it; a terminal post takes a <b>dome</b> and carries the tension bands. Pick the "+
        "2⅜ in or larger post to get bands and a tension bar."}
    ]},

    {title:"Boards & rails",need:["board","picket"],open:true,rows:[
      {id:"boardW",label:"Board / picket width",unit:"in",min:2,max:12,step:0.25,value:5.5},
      {id:"boardT",label:"Thickness",unit:"in",min:0.375,max:2,step:0.0625,value:0.75},
      {id:"layout",need:"board",type:"select",label:"Layout",value:"butted",options:[
        ["butted","Butted — boards touch"],["spaced","Spaced"],
        ["bob","Board-on-board"],["shadow","Shadowbox / good-neighbour"]]},
      {id:"gapIn",label:"Gap between boards",unit:"in",min:0,max:6,step:0.0625,value:0.125},
      {id:"overlapIn",need:"bob",label:"Overlap each side",unit:"in",min:0.25,max:3,step:0.125,value:1},
      {id:"topCut",type:"select",label:"Top cut",value:"dogear",options:[
        ["flat","Flat"],["dogear","Dog-ear"],["point","Pointed"],["gothic","Gothic"]]},
      {id:"topCutIn",label:"Cut depth / point rise",unit:"in",min:0.5,max:6,step:0.125,value:1.5},
      {id:"botGapIn",label:"Boards clear the ground by",unit:"in",min:0,max:12,step:0.5,value:2},
      {id:"railsN",type:"select",label:"Rails",value:2,options:[[2,"2"],[3,"3"],[4,"4"]]},
      {id:"railW",label:"Rail depth",unit:"in",min:2,max:8,step:0.25,value:3.5},
      {id:"railT",label:"Rail thickness",unit:"in",min:0.75,max:3,step:0.125,value:1.5},
      {id:"boardVar",label:"Board width & tone spread",min:0,max:1,step:0.01,value:0.3},
      {type:"checks",items:[{id:"sawn",label:"Rough-sawn (saw kerf, not planed)",value:false}]},
      {type:"note",html:"A butted cedar fence opens <b>1/8 to 1/4 in</b> in its first season. The "+
        "default gap of 0.125 in is that shrinkage — it is where the light comes through, and it is "+
        "the loudest single cue this type has. Build it at 0 and you have drawn a sheet of plywood."}
    ]},

    {title:"Split rail",need:"rail",open:true,rows:[
      {id:"railKind",type:"select",label:"Kind",value:"split",options:[
        ["split","Split rail — mortised through the post"],
        ["ranch","Ranch rail — boards face-nailed"]]},
      {id:"srRails",type:"select",label:"Rails",value:3,options:[[2,"2"],[3,"3"],[4,"4"]]},
      {id:"srThick",label:"Rail thickness",unit:"in",min:1.5,max:6,step:0.25,value:3.5},
      {id:"srDepth",label:"Rail face height",unit:"in",min:3,max:8,step:0.25,value:5},
      {id:"srMortIn",need:"splitk",label:"Mortise height",unit:"in",min:3,max:7,step:0.25,value:4},
      {id:"srTaper",label:"End taper & split face",min:0,max:1,step:0.01,value:0.7}
    ]},

    {title:"Chain-link fabric",need:"chain",open:true,rows:[
      {id:"meshIn",label:"Mesh",unit:"in",min:0.375,max:3,step:0.125,value:2},
      {id:"gauge",type:"select",label:"Wire gauge",value:0.148,showValue:true,options:[
        [0.192,"6 ga — 0.192 in"],[0.148,"9 ga — 0.148 in"],[0.12,"11 ga — 0.120 in"],
        [0.113,"11.5 ga — 0.113 in"],[0.0985,"12.5 ga — 0.0985 in"]]},
      {id:"meshFit",type:"select",label:"Diamond snap",value:"tile",options:[
        ["tile","To the tile — fabric runs past the line posts"],
        ["bay","To the bay — same phase at every post"]]},
      {id:"meshPhase",label:"Diamond registration",min:0,max:1,step:0.01,value:0.5},
      {id:"selvTop",type:"select",label:"Top selvage",value:"knuckle",options:[
        ["knuckle","Knuckled"],["barb","Barbed"]]},
      {id:"selvBot",type:"select",label:"Bottom selvage",value:"knuckle",options:[
        ["knuckle","Knuckled"],["barb","Barbed"]]},
      {type:"checks",items:[
        {id:"topRail",label:"Top rail through the loop caps",value:true},
        {id:"tensWire",label:"Bottom tension wire (7 ga)",value:false},
        {id:"tensBar",label:"Tension bars & bands at the terminal posts",value:true}]},
      {id:"ties",label:"Tie wires",min:0,max:1,step:0.01,value:0.8},
      {id:"armType",type:"select",label:"Extension arm",value:"none",options:[
        ["none","None"],["a45","45° single — 3 strands"],["av","V-arm — 3 + 3"],
        ["avert","Vertical — 3 strands"]]},
      {id:"armLenIn",need:"barb",label:"Arm length",unit:"in",min:6,max:18,step:1,value:12},
      {id:"strandGap",need:"barb",label:"Strand spacing",unit:"in",min:2,max:8,step:0.5,value:4},
      {id:"slats",label:"Privacy slats",min:0,max:1,step:0.01,value:0},
      {id:"slatGone",need:"slats",label:"Slats missing or broken",min:0,max:1,step:0.01,value:0.2},
      {id:"fabSag",label:"Fabric sag",unit:"in",min:0,max:6,step:0.25,value:1},
      {id:"fabPush",label:"Pushed & bent",min:0,max:1,step:0.01,value:0.25}
    ]},

    {title:"Site panel",need:"mesh",open:true,rows:[
      {id:"mpHIn",label:"Panel height",unit:"in",min:40,max:120,step:0.1,value:78.7},
      {id:"mpApW",label:"Aperture across",unit:"in",min:1,max:8,step:0.01,value:3.94},
      {id:"mpApH",label:"Aperture up",unit:"in",min:1,max:16,step:0.01,value:11.81},
      {id:"mpWire",label:"Mesh wire",unit:"in",min:0.08,max:0.32,step:0.002,value:0.138},
      {id:"mpTube",label:"Frame tube OD",unit:"in",min:0.8,max:2.5,step:0.025,value:1.575},
      {type:"checks",items:[
        {id:"mpFeet",label:"Concrete / rubber feet",value:true},
        {id:"mpRound",label:"Round-top frame",value:true}]},
      {id:"mpCoupler",label:"Couplers",min:0,max:1,step:0.01,value:0.8},
      {id:"mpLean",label:"Panel-to-panel lean & offset",min:0,max:1,step:0.01,value:0.5},
      {id:"mpWIn",label:"Nominal panel width",unit:"in",min:60,max:160,step:0.1,value:137.8},
      {type:"note",html:"The panel is one bay wide, so set the <b>bay</b> to the panel width — "+
        "11.5 ft for a 3.5 m Heras panel — and the feet land under the joints."}
    ]},

    {title:"Iron & palisade",need:"iron",open:true,rows:[
      {id:"ironStyle",type:"select",label:"Style",value:"tube",options:[
        ["tube","Ornamental square tube"],["palD","Palisade — D section"],
        ["palW","Palisade — W section"]]},
      {id:"pkBarW",label:"Picket / pale width",unit:"in",min:0.5,max:4,step:0.0625,value:0.75},
      {id:"pkT",label:"Picket depth",unit:"in",min:0.09,max:2,step:0.0156,value:0.75},
      {id:"pkGap",label:"Clear gap",unit:"in",min:1,max:6,step:0.0625,value:3.9375},
      {id:"pkTop",type:"select",label:"Picket top",value:"spear",options:[
        ["flat","Flush with the rail"],["spear","Spear"],["ball","Ball"],
        ["round","Rounded"],["triple","Triple-pointed"]]},
      {id:"pkTopIn",label:"Projection above the rail",unit:"in",min:0,max:8,step:0.25,value:4.5},
      {id:"pkRails",type:"select",label:"Rails",value:2,options:[[2,"2"],[3,"3"]]},
      {id:"irRailW",label:"Rail size",unit:"in",min:0.75,max:3,step:0.125,value:1},
      {id:"puppy",label:"Puppy pickets (bottom 12 in)",min:0,max:1,step:0.01,value:0}
    ]},

    {title:"Corrugated hoarding",need:"corr",open:true,rows:[
      {id:"corProfile",type:"select",label:"Profile",value:"sin3",options:corOptions},
      {id:"corPitch",label:"Pitch",unit:"in",min:0.75,max:10,step:0.01,value:3},
      {id:"corDepth",label:"Depth",unit:"in",min:0.05,max:2,step:0.01,value:0.875},
      {id:"corCover",label:"Sheet cover",unit:"in",min:16,max:48,step:0.5,value:32},
      {id:"corFix",label:"Fixings",min:0,max:1,step:0.01,value:0.7},
      {id:"corDent",label:"Dents",min:0,max:1,step:0.01,value:0.35},
      {id:"corOil",label:"Oil canning",min:0,max:1,step:0.01,value:0.4},
      {id:"corPost",label:"Frame showing at the edges",min:0,max:1,step:0.01,value:0.6},
      {id:"corPoster",label:"Posters & paste ghosts",min:0,max:1,step:0.01,value:0}
    ]},

    {title:"Timber weathering",need:"wood",open:true,rows:[
      {id:"grey",label:"Greying & silvering",min:0,max:1,step:0.01,value:0.45},
      {id:"grainRaise",label:"Grain raise",min:0,max:1,step:0.01,value:0.4},
      {id:"cup",label:"Cupping",min:0,max:1,step:0.01,value:0.3},
      {id:"splits",label:"Splits & checks",min:0,max:1,step:0.01,value:0.3},
      {id:"knots",label:"Knots",min:0,max:1,step:0.01,value:0.45},
      {id:"nailStain",need:"slat_boards",label:"Nail stain & rust streaks",min:0,max:1,step:0.01,value:0.35},
      {id:"paint",label:"Paint",min:0,max:1,step:0.01,value:0},
      {id:"peel",need:"painted",label:"Peeling & flaking",min:0,max:1,step:0.01,value:0.3},
      {id:"missing",need:"slat_boards",label:"Missing boards",min:0,max:1,step:0.01,value:0.08},
      {id:"broken",need:"slat_boards",label:"Broken boards",min:0,max:1,step:0.01,value:0.06},
      {id:"sagIn",label:"Sag at midspan",unit:"in",min:0,max:3,step:0.125,value:0.5}
    ]},

    {title:"Metal weathering",need:"steel",open:true,rows:[
      {id:"coating",type:"select",label:"Coating",value:"hdg",options:coatOptions},
      {id:"spangle",need:"galv",label:"Spangle",min:0,max:1,step:0.01,value:0.5},
      {id:"whiteRust",label:"White rust",min:0,max:1,step:0.01,value:0.3},
      {id:"redRust",label:"Red rust — cut ends, welds, contacts",min:0,max:1,step:0.01,value:0.3},
      {id:"chalk",label:"Chalking & UV fade",min:0,max:1,step:0.01,value:0.3},
      {id:"metalDent",label:"Dents & deformation",min:0,max:1,step:0.01,value:0.25}
    ]},

    {title:"Ground & growth",open:true,rows:[
      {id:"clutter",label:"Ground clutter",min:0,max:1,step:0.01,value:0.5},
      {id:"clutterKind",type:"select",label:"Ground",value:"grass",options:[
        ["grass","Grass & weeds"],["dirt","Bare soil"],["gravel","Gravel"],
        ["conc","Concrete / kerb"],["snow","Snow"]]},
      {id:"splashIn",label:"Splash band height",unit:"in",min:0,max:24,step:1,value:10},
      {id:"moss",label:"Moss, algae & lichen",min:0,max:1,step:0.01,value:0.3},
      {id:"vines",label:"Vines & bindweed",min:0,max:1,step:0.01,value:0},
      {id:"dirt",label:"Dirt in the low spots",min:0,max:1,step:0.01,value:0.4}
    ]},

    {title:"Colour",rows:[
      {type:"colors",label:"Timber · rail · greyed",items:[
        {id:"cWood",value:"#a57f52"},{id:"cRail",value:"#8e6c46"},{id:"cGrey",value:"#8c8a83"}]},
      {type:"colors",label:"Paint · metal coat · slats",items:[
        {id:"cPaint",value:"#f2f0e8"},{id:"cCoat",value:"#b9bdc2"},{id:"cSlat",value:"#4a6b3c"}]},
      {type:"colors",label:"Rust · ground · growth",items:[
        {id:"cRust",value:"#83411f"},{id:"cGround",value:"#6b5c46"},{id:"cMoss",value:"#4d6b3a"}]}
    ]},

    {title:"Maps",rows:[
      {id:"normalStr",label:"Normal strength",min:0.1,max:3,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:0.8},
      {id:"aaWide",label:"Alpha edge width",unit:"texels",min:0.5,max:2,step:0.05,value:1},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]},
      {type:"note",html:"This card is <b>alpha-blended</b>. Alpha-testing a chain link at 0.5 "+
        "deletes the fence at the first mip — a 9 ga wire is only 1.3 texels at 1024. If your "+
        "pipeline is alpha-test only: build at 2048, set this to 1.5, and cut at 0.25."}
    ]}
  ],

  needs:function(P){
    const t=P.type||"board",n=[t];
    if(t==="board"||t==="picket"||(t==="rail"))n.push("wood");
    if(t==="board"||t==="picket")n.push("slat_boards");
    if(t==="board"&&(P.layout==="bob"||P.layout==="shadow"))n.push("bob");
    if(t==="rail"&&P.railKind!=="ranch")n.push("splitk");
    if(t==="chain"||t==="mesh")n.push("galv");
    if(t==="chain"||t==="mesh"||t==="iron"||t==="corr")n.push("steel");
    if(t==="chain"&&(+P.slats||0)>0)n.push("slats");
    if(t==="chain"&&P.armType&&P.armType!=="none")n.push("barb");
    if((+P.paint||0)>0&&(t==="board"||t==="picket"||t==="rail"))n.push("painted");
    const pk=POSTS[P.postType]||POSTS.t44;
    if(pk.wood&&!pk.round)n.push("capT");
    if(pk.round&&pk.steel)n.push("capP");
    if(t==="iron"&&P.ironStyle!=="tube")n.push("palisade");
    return n;
  },

  /* Picking a post writes its nominal width, the corrugation select writes its
     pitch and depth, and the aspect ratio caps the resolution so a 4096 x 8192
     build cannot be asked for. Nothing else is ever written back: the bay, the
     fence height, the mesh and the gap are real dimensions the user set, and
     they are snapped internally and owned up to in the readout instead. */
  derive:function(P,ui){
    if(P.postType!==lastPostType){
      lastPostType=P.postType;
      const pk=POSTS[P.postType];
      if(pk)ui.set("postW",pk.w);
    }
    if(P.corProfile!==lastProfile){
      lastProfile=P.corProfile;
      const c=CORPROF[P.corProfile];
      if(c){ui.set("corPitch",c.p);ui.set("corDepth",c.d);}
    }
    const cap=sizeCap(aspectK(P));
    if((P.size|0)>cap)ui.set("size",cap);
  },

  /* One tile of fence is however many bays it holds, and its height follows
     from the aspect the mode already computes — inches and feet in, metres out.
     It carries alpha, so the model is a cut-out plane. */
  plan:function(P){
    const FT=0.3048,bays=Math.max(1,P.baysPerTile|0);
    const w=Math.max(0.3,(+P.bayFt||8)*bays*FT);
    return {w:w,h:w*aspectK(P),tile:w,cutout:true};
  },

  size:function(P,preview){
    const g=geo(P);
    const w=preview?Math.min(P.size|0,256):Math.min(P.size|0,sizeCap(g.k));
    return {w:w,h:Math.max(32,Math.round(w*g.k))};
  },
  build:build,

  writers:function(B){
    const ID=B.ID,MSK=B.MSK,ALP=B.ALP;
    return {
      id:function(i,o,k){
        const c=IDCOL[ID[i]]||IDCOL[0];
        o[k]=c[0];o[k+1]=c[1];o[k+2]=c[2];
        return 255;                       // an id map with holes in it is unreadable
      },
      infill:function(i,o,k){
        o[k]=o[k+1]=o[k+2]=MSK[i];
        return ALP[i];
      }
    };
  },

  tileTag:function(P){
    return "tiles ↔ along the run — the seam is a post centreline"+
           ((P.baysPerTile|0)>1?" · "+(P.baysPerTile|0)+" bays per tile":"");
  },
  sizeTag:function(P){
    const k=aspectK(P);
    return (+P.bayFt).toFixed(1)+" ft bay · "+((+P.fenceH||72)/12).toFixed(1)+" ft"+
           ((P.baysPerTile|0)>1?" · "+(P.baysPerTile|0)+" bays":"")+
           " · "+(k===1?"1:1":(k>1?"1:"+k:(1/k)+":1"));
  },
  fileBase:function(P,W,H){return "fence_"+(P.type||"board")+"_"+(P.seed|0)+"_"+W+"x"+H;},

  readout:function(P){
    const g=geo(P),W=Math.min(P.size|0,sizeCap(g.k)),H=Math.max(32,Math.round(W*g.k));
    const IPX=g.tileWin/W,PXI=1/IPX;
    const kT=g.k===1?"1:1":(g.k>1?"1:"+g.k:(1/g.k)+":1");
    let m="<b>"+Math.round(12*PXI)+" px/ft</b> · "+IPX.toFixed(3)+" in per texel · "+W+"×"+H;
    m+="<br>tile covers <b>"+(g.tileWin/12).toFixed(2)+" × "+(g.tileHin/12).toFixed(2)+" ft</b> ("+
       g.tileWin.toFixed(1)+" × "+g.tileHin.toFixed(1)+" in) · aspect <b>"+kT+"</b>";
    m+="<br>"+g.bays+" bay"+(g.bays>1?"s":"")+" of "+(+P.bayFt).toFixed(1)+" ft · <b>"+g.nPosts+
       "</b> post"+(g.nPosts>1?"s":"")+" · seam on a post centreline";
    if(g.auto)m+="<br>aspect chosen from "+g.topMost.toFixed(0)+" + 8 = <b>"+g.Vhard.toFixed(0)+
       " in</b> of hard requirement";
    m+="<br>ground line at v = <b>"+g.vGround.toFixed(3)+"</b> · fence top at v = <b>"+
       g.vTop.toFixed(3)+"</b>";
    if(g.skyFrac>0.28)m+='<br><span class="warn">'+Math.round(g.skyFrac*100)+
      "% of the tile is sky — crop the quad's V range to "+g.vTop.toFixed(3)+
      "…1 to remove it, horizontal tiling is unaffected</span>";
    if(g.tileHin-g.topMost<3)m+='<br><span class="warn">the forced aspect is shorter than the '+
      "fence — the top is clipped; use auto</span>";

    if(g.type==="board"||g.type==="picket"){
      m+="<br><b>"+g.nBoards+"</b> "+(g.type==="picket"?"pickets":"boards")+" at <b>"+
         g.pitch.toFixed(3)+" in</b> pitch (asked "+g.pitchReq.toFixed(3)+") — "+
         (g.pitch*PXI).toFixed(1)+" px";
      m+="<br>gap <b>"+g.gapBuilt.toFixed(3)+" in</b> = <b>"+(g.gapBuilt*PXI).toFixed(1)+" px</b>";
      if(g.twoCourse)m+="<br>back course offset "+(g.pitch*0.5).toFixed(2)+" in, overlap "+
         g.overlapBuilt.toFixed(2)+" in each side";
      m+="<br>"+g.railsN+" rails at "+g.railY.map(r=>r.toFixed(0)).join(", ")+" in above grade";
    }else if(g.type==="rail"){
      m+="<br>"+g.srRails+" rails · "+(g.railKind==="ranch"?"face-nailed":"mortise "+
         g.srMort.toFixed(1)+" in")+" · "+(+P.bayFt).toFixed(1)+" ft between posts ("+
         (g.bayIn+g.mortOverlap).toFixed(1)+" in of rail)";
    }else if(g.type==="chain"){
      const wpx=g.wire*PXI,apPx=g.meshBuilt*PXI;
      m+="<br><b>"+g.nx+"</b> diamonds across the tile · mesh built at <b>"+g.meshBuilt.toFixed(3)+
         " in</b> (asked "+g.meshReq.toFixed(3)+")";
      m+="<br>diamond period "+g.D.toFixed(4)+" in = <b>"+(g.D*PXI).toFixed(1)+" px</b> · aperture "+
         apPx.toFixed(1)+" px";
      m+="<br>wire "+g.wire.toFixed(4)+" in ("+gaugeName(g.wire)+") = <b>"+wpx.toFixed(2)+
         " texels</b> — "+(wpx>=3?"full round":(wpx>=2?"analytic normal":(wpx>=1?"faded relief":"haze")));
      m+="<br>fabric "+g.fabricH.toFixed(2)+" in = "+g.nv+
         " half-rows, selvage lands on a knuckle at both ends";
      if(g.bays===1&&Math.abs(g.meshBuilt-g.meshReq)>0.02)
        m+="<br>a second bay per tile would snap the mesh to <b>"+g.meshBuilt2.toFixed(3)+" in</b>";
      if(g.topRail)m+="<br>top rail 1.660 in = "+(1.66*PXI).toFixed(1)+" px";
      if(g.armType!=="none")m+="<br>arms add "+g.armRise.toFixed(1)+" in — tallest element "+
         g.topMost.toFixed(1)+" in";
    }else if(g.type==="mesh"){
      m+="<br>panel "+g.bayIn.toFixed(1)+" × "+g.mpH.toFixed(1)+" in · <b>"+g.nAx+"×"+g.nAy+
         "</b> apertures at "+g.apW.toFixed(2)+" × "+g.apH.toFixed(2)+" in (asked "+
         g.apWreq.toFixed(2)+" × "+g.apHreq.toFixed(2)+")";
      m+="<br>frame "+g.mpTube.toFixed(3)+" in = "+(g.mpTube*PXI).toFixed(1)+" px · wire "+
         g.mpWire.toFixed(3)+" in = "+(g.mpWire*PXI).toFixed(1)+" px";
      if(Math.abs(g.bayIn-g.mpW)>1)
        m+='<br><span class="warn">the bay is '+(g.bayIn/12).toFixed(2)+" ft but the panel is "+
           (g.mpW/12).toFixed(2)+" ft — set the bay to that or the couplers miss the joints</span>";
    }else if(g.type==="iron"){
      m+="<br><b>"+g.nPk+"</b> pickets at <b>"+g.pkPitch.toFixed(3)+" in</b> pitch · clear gap "+
         g.pkGapBuilt.toFixed(3)+" in (asked "+g.pkGapReq.toFixed(3)+")";
      if(g.pkGapBuilt>4.0)m+='<br><span class="warn">clear gap over 4 in — fails the child and '+
         "pool sphere rule</span>";
    }else{
      m+="<br><b>"+g.nCorr+"</b> corrugations at <b>"+g.corPitch.toFixed(3)+" in</b> — "+
         (g.corPitch*PXI).toFixed(1)+" px";
      m+="<br><b>"+g.nSheets+"</b> sheet"+(g.nSheets>1?"s":"")+" of "+g.corCover.toFixed(1)+
         " in · depth "+g.corDepth.toFixed(2)+" in = "+(g.corDepth*PXI).toFixed(1)+" px of relief";
    }

    const L=lod(P,g,W);
    m+="<br>detail: "+(L.keep.join(" · ")||"none");
    if(L.drop.length)m+='<br><span class="warn">dropped under a couple of texels: '+
      L.drop.join(" · ")+"</span>";
    if(g.type==="chain"&&(P.size|0)===4096)
      m+='<br><span class="warn">the app previews 4096 by point-sampling it down to 2048 — '+
         "judge the mesh at 2048; the exported PNG is correct</span>";
    if((P.size|0)>sizeCap(g.k))
      m+='<br><span class="warn">'+kT+" tile — width capped at "+sizeCap(g.k)+
         " to keep the long axis under 4096</span>";
    return m;
  },

  readme:function(P,info){
    const g=geo(P);
    const IPX=g.tileWin/info.W,PXI=1/IPX;
    const kT=g.k===1?"1:1":(g.k>1?"1:"+g.k:(1/g.k)+":1");
    const L=lod(P,g,info.W);
    const range=(info.hMax-info.hMin);
    const out=["Texture Forge · fence — "+(TYPELABEL[g.type]||g.type),
      "",
      "Seed "+(P.seed|0)+"   Resolution "+info.W+" x "+info.H,
      "Tile covers "+(g.tileWin/12).toFixed(2)+" ft x "+(g.tileHin/12).toFixed(2)+" ft  ("+
        g.tileWin.toFixed(1)+" in x "+g.tileHin.toFixed(1)+" in)",
      Math.round(12*PXI)+" px per foot, "+IPX.toFixed(4)+
        " in per texel — the same density on both axes.",
      g.bays+" bay"+(g.bays>1?"s":"")+" of "+(+P.bayFt).toFixed(1)+
        " ft. Tiles seamlessly along the run.",
      "",
      "SCALE",
      "Everything is laid out in real inches, because fencing is sold in inches: a",
      "5.5 in board, a 3.5 in post, a 2 in mesh, a 0.148 in 9-gauge wire, a 3 in",
      "corrugation. Set the material scale from the one number above and this fence",
      "lines up with any other piece from this tool.",
      "",
      "THE TILE IS "+info.W+" x "+info.H,
      "The aspect ratio of a tiling texture has to be a power of two or WebGL and every",
      "engine's mipmapper stop being able to repeat it. So the tile is "+g.tileWin.toFixed(1)+" in wide",
      "by "+g.tileHin.toFixed(1)+" in tall — a ratio of "+kT+" — and the extra height is sky, not",
      "stretched fence. The density is uniform; nothing is squashed.",
      "",
      "  ground line   v = "+g.vGround.toFixed(4),
      "  top of fence  v = "+g.vTop.toFixed(4),
      ""];
    if(g.skyFrac>0.28)out.push(
      Math.round(g.skyFrac*100)+"% of this tile is empty sky. Crop the quad's V range to "+
        g.vTop.toFixed(3)+"..1",
      "to remove it — only U has to wrap for a fence run, so cropping V costs nothing.","");
    out.push(
      "THE SEAM",
      "The tile edge falls on a post CENTRELINE. That post is drawn once, its left half",
      "in the last texels of the tile and its right half in the first, so there is no",
      "doubled post and no halved post when you repeat. Every per-post and per-board",
      "random is hashed on the piece index modulo the count per tile, so piece j and",
      "piece j+n are the same piece one tile over.",
      "",
      "The top and bottom edges of the tile are empty air by construction — the ground",
      "is a band of clutter that fades out before the bottom edge, not an opaque ground",
      "plane. That is what lets it claim to be seamless in both axes, and it composites",
      "onto terrain far better than a hard line of dirt.","");
    if(g.type==="chain")out.push(
      "THE MESH",
      g.nx+" diamonds across the tile. You asked for "+g.meshReq.toFixed(3)+" in mesh; the tile holds",
      "a whole number of diamonds only at "+g.meshBuilt.toFixed(4)+" in, so that is what was built — a",
      "diagonal lattice that does not close on the tile edge prints a seam no amount of",
      "blending hides."+(g.bays===1?(" Two bays per tile would snap it to "+
        g.meshBuilt2.toFixed(4)+" in."):""),
      "The fabric is "+g.fabricH.toFixed(2)+" in tall = "+g.nv+" half-diamond rows, so the selvage",
      "lands on a knuckle at both ends.",
      "",
      "The wire is round, not a flat outline. Each family's centre plane oscillates as",
      "  z = +/- (wire/2) * cos(2*pi*x / "+g.D.toFixed(4)+")",
      "which is one full over-under cycle per diamond width — the real helix's pitch —",
      "so the two families genuinely weave instead of one being painted over the other.",
      "That is carried in the normal map, and the normal map is what sells it.","");
    out.push(
      "ALPHA",
      "This card is alpha-BLENDED. Do not alpha-test it."+
        (g.type==="chain"?(" A "+gaugeName(g.wire)+" wire is "+(g.wire*PXI).toFixed(2)+
          " texels wide"):" Its thinnest features are around a texel"),
      "at this resolution, so peak alpha halves at every mip and a 0.5 cutoff deletes the",
      "fence at the exact distance it is most often seen. If your pipeline is alpha-test",
      "only: rebuild at 2048 or 4096, set the alpha edge width to 1.5, and cut at 0.25.",
      "Alpha-to-coverage is better than either.",
      "",
      "The alpha edge is the exact area of the feature inside each texel, not a",
      "threshold. Below two texels a feature keeps its correct average opacity and loses",
      "its relief rather than aliasing"+(L.drop.length?(" — dropped here: "+L.drop.join("; ")):"")+".",
      "",
      "CHANNELS",
      "basecolor.png  sRGB albedo with the cut-out in alpha. Import as sRGB / colour.",
      "               Fully transparent texels carry the fence's own mean colour, not",
      "               black, so mipmapping does not drag a halo into every edge.",
      "normal.png     Tangent space, "+info.normalNote+". Non-colour / linear. Heights are",
      "               inches, so these are true slopes. Features under six texels get an",
      "               analytic normal — a central difference cannot resolve a two-texel",
      "               round wire.",
      "roughness.png  Linear grey.",
      "metallic.png   Honest: galvanised and bare steel read 1.0; powder coat, paint,",
      "               vinyl, plastic and every piece of timber read 0.0; rust reads 0.08",
      "               because iron oxide is not a metal. Nothing here is faked.",
      "ao.png         Linear grey; 255 wherever alpha is 0.",
      "height.png     Linear grey over "+range.toFixed(3)+" in of real relief. Displace by "+
        (range/12).toFixed(4)+" ft",
      "               / "+(range*25.4).toFixed(1)+" mm for true depth. Zero is the back of the fence.",
      "height16.png   The same field at 16 bits. Use this one — the deepest feature here",
      "               eats most of the 8-bit range and leaves the fine relief nothing.",
      "orm.png        Packed: R = AO, G = roughness, B = metallic.",
      "opacity.png    The cut-out on its own.",
      "id.png         Flat material ids: timber post tan, rail brown, board straw, paint",
      "               white, galvanised silver, coated steel slate, chain-link fabric",
      "               cyan, hardware amber, rust orange-brown, moss green, ground clutter",
      "               olive, plastic magenta. Written before the dirt pass, so a filthy",
      "               post still reads as timber.",
      "infill.png     White where the texel is infill (boards, pickets, fabric, sheet),",
      "               black where it is structure (posts, rails, frame, hardware), masked",
      "               by the silhouette. Drive wind, sag or damage on the fabric without",
      "               touching the frame.",
      "",
      "Normal strength baked at "+(+P.normalStr||1).toFixed(2)+"x. Ambient occlusion at "+
        (P.aoStr==null?0.8:+P.aoStr).toFixed(2)+".");
    return out.join("\n");
  }
});

})();
