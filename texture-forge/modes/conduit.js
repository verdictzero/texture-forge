/* =====================================================================
   MODE: conduit — the loom behind an access panel
   =====================================================================
   Undo a row of quarter-turn fasteners, lift the panel off an engine
   nacelle or an equipment bay, and what is behind it is not a thing. It
   is STRATA, and the strata are the whole subject:

     the backplane   a machined casting or a ribbed skin with lightening
                     holes, in shadow, mostly hidden
     the deep runs   the fat items that went in first and will come out
                     last — lagged bleed-air pipe, flexible duct,
                     coolant lines
     the harnesses   groups of small conduits laid parallel and routed
                     together, held at a fixed pitch by clamps
     the near work   the things that were meant to be reached: junction
                     blocks, connectors on brackets, a bonding strap

   A GROUP, NOT A PIPE. Every route here carries a BUNDLE — n conduits
   at a fixed pitch, riding one path. Conduit k sits at offset
   (k−(n−1)/2)·pitch along the path normal, so the whole ribbon snakes
   as one, and on a bend the inner conduits take a tighter radius than
   the outer ones. That difference is most of what tells a loom from
   some pipes that happen to be near each other.

   ROUTED BY TURN RATE, NOT BY WAYPOINTS. A path is integrated: a
   heading, plus a smoothly varying turn, with the turn CLAMPED so the
   curvature never exceeds one over the minimum bend radius. That is a
   real constraint — conduit has a minimum bend radius, and a loom that
   violates it looks wrong before you can say why — and it buys the
   rasteriser below its correctness for free: perpendicular distance to
   the local tangent is only the true distance to the centreline while
   the bend is gentle relative to the bundle's own width, which is
   exactly what the clamp guarantees.

   STAMPED, NOT EVALUATED. Distance from a texel to forty snaking
   polylines is hundreds of tests a texel. So the routes are painted
   instead, once, walking each path and stepping out along its normal:
   the cost is the area actually covered, and a Z-TEST against the
   height field does the layering. Where two bundles cross, the higher
   one wins by arithmetic rather than by draw order, which is why a run
   can pass over one neighbour and under the next.

   Four things come out of that stamp and the shading pass reads them:
   which bundle owns the texel, how far ACROSS its conduit it sits, how
   far ALONG the route it is, and whether a fitting is on it. Across
   gives the cylinder; along gives the corrugation rings, the braid, the
   couplings and the ident bands; the fitting byte gives the clamps and
   the ties that hold the bundle together. All four live in ONE 32-bit
   word a texel, which is not tidiness: they are written together at an
   index that walks a line across the tile rather than along a row, so
   four separate buffers meant four cache misses a sample where one word
   means one, and the pass cost three times what it does now.

   Two pieces off the one generator. TILE is a seamless field — an
   endless equipment bay, a hull interior. BAY is one framed opening
   with a lip and a cut-out silhouette, which is the literal answer to
   "what you see when you open a panel": you drop it onto a hull and the
   hull shows through around it.

   CAPPED AT 2048. The mode carries an extra word a texel for the stamp,
   and its subject is a panel a few hundred millimetres across — 2048 is
   already better than three texels to the millimetre.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      hashi=Forge.hashi,fbm2=Forge.fbm2,mulberry32=Forge.mulberry32,
      hex2rgb=Forge.hex2rgb,blurWrap=Forge.blurWrap,blurClamp=Forge.blurClamp;

let P={};

const isBay=p=>(p.piece||"tile")==="bay";

/* ============================ what a conduit is made of ============================
   Colour, roughness and metallicity travel together — there is no such thing as
   a shiny black rubber hose or a matte bare-steel braid — so a bundle picks one
   of these rather than three sliders. */
const MAT=[
  {id:"rubber", c:[27,27,29],   rg:0.74,met:0.03,name:"black rubber"},
  {id:"pvc",    c:[100,105,110],rg:0.63,met:0.04,name:"grey PVC"},
  {id:"braid",  c:[139,143,149],rg:0.40,met:0.88,name:"braided stainless"},
  {id:"alu",    c:[156,160,166],rg:0.33,met:0.93,name:"aluminium"},
  {id:"ptfe",   c:[209,208,200],rg:0.52,met:0.02,name:"white PTFE"},
  {id:"loom",   c:[46,47,50],   rg:0.68,met:0.05,name:"black split loom"},
  {id:"lag",    c:[164,156,140],rg:0.82,met:0.02,name:"glass-cloth lagging"},
  {id:"copper", c:[171,104,63], rg:0.31,met:0.95,name:"copper"}
];
const MATBY={};for(let i=0;i<MAT.length;i++)MATBY[MAT[i].id]=i;

/* Ident sleeving. Real looms are colour-coded and it is the one thing that
   stops a bay reading as forty greys. */
const IDENT=[[168,46,44],[46,86,160],[196,164,52],[62,132,72],[176,176,180],[150,88,166]];

/* The six ways a conduit is finished, and what each one does to the surface it
   is stamped onto.

     det  how much of the conduit's own radius the detail is allowed to move.
          A corrugation is a real fold; a braid is a shallow weave.
     hs   how TALL it stands relative to how wide it is. Everything round is 1
          and comes out a half-cylinder. A flat ribbon is not round: it is wide
          and THIN, and giving it the same height as its half-width — which is
          what a single radius does — turns it into a pale slab lying across
          the bay rather than a cable. */
const KIND=[
  {id:"tube",  name:"rigid tube",       det:0.00, hs:1.00,mats:["alu","pvc","copper"]},
  {id:"corr",  name:"corrugated flex",  det:0.075,hs:1.00,mats:["pvc","loom","alu"]},
  {id:"braid", name:"braided hose",     det:0.055,hs:1.00,mats:["braid","rubber"]},
  {id:"spiral",name:"spiral wrap",      det:0.10, hs:1.00,mats:["loom","rubber","pvc"]},
  {id:"ribbon",name:"flat ribbon",      det:0.05, hs:0.26,mats:["rubber","loom"]},
  {id:"lagged",name:"lagged pipe",      det:0.04, hs:1.00,mats:["lag","ptfe"]}
];

/* ============================ dimensions ============================
   Everything in this file is in METRES. A wiring bundle is 8–30 mm, a hydraulic
   line 8–16, a bleed duct 40–100, and an access panel 300–1200 across — so the
   numbers stay small and the AO radii below are feature sizes rather than
   pixel counts. */
function geom(p){
  const bay=isBay(p);
  const S=Math.max(64,p.size|0);
  const Wm=Math.max(0.08,(bay?(+p.bayWmm||520):(+p.tileMm||620))/1000);
  const Hm=bay?Math.max(0.08,(+p.bayHmm||380)/1000):Wm;
  const TW=S,TH=bay?Math.max(64,Math.round(S*Hm/Wm)):S;
  return {bay:bay,Wm:Wm,Hm:Hm,TW:TW,TH:TH,pxM:TW/Wm,mpp:Wm/TW};
}

/* distance to the nearest multiple of p — the spacing of everything that
   repeats along a route */
function edgeDist(t,p){const f=t/p;return Math.abs(f-Math.round(f))*p;}

/* Smooth noise along ONE axis. The shared fbm is a two-dimensional field in
   unit tile space that wraps at an integer period, which is exactly right for
   a surface and no use at all for a route: a route is parameterised by arc
   length in metres, it is not periodic, and it does not have a second axis.

   It does not need to wrap, either. The tile is a torus and the route's
   POSITION wraps on it; the heading is just continuous, so a run that leaves
   one edge arrives at the other still turning the way it was. */
function n1(t,seed){
  const i=Math.floor(t),f=t-i,u=f*f*(3-2*f);
  const a=hashi(i,0,seed),b=hashi(i+1,0,seed);
  return a+(b-a)*u;
}
function fbm1(t,oct,seed){
  let amp=1,sum=0,norm=0,p=1;
  for(let k=0;k<oct;k++){sum+=amp*n1(t*p,seed+k*7919);norm+=amp;amp*=0.5;p*=2;}
  return sum/norm;
}

/* ============================ the routes ============================
   A route is INTEGRATED rather than plotted. Start somewhere with a heading,
   then step, turning by an amount that varies smoothly and is clamped to the
   minimum bend radius. Two things fall out of that:

     · it snakes rather than zig-zags, because the turn is continuous
     · the rasteriser is allowed to treat perpendicular-to-the-tangent as
       distance-to-the-centreline, because the clamp keeps the bend gentle
       next to the bundle's own half-width

   Occasionally a route takes a CORNER: it spends a stretch turning at the
   maximum rate in one direction, which is what a loom does when it reaches the
   end of a bay and has to go somewhere else. Without those it is all lazy
   meander and reads as spaghetti rather than as installed work. */
function routes(g,p){
  const rng=mulberry32((p.seed|0)*2246822519+1013);
  const pick=a=>a[Math.floor(rng()*a.length)|0];
  const rr=(a,b)=>a+rng()*(b-a);

  const layers=clamp(p.layers|0,1,6);
  const perLayer=clamp(p.bundles|0,1,10);
  const cav=Math.max(0.01,(+p.cavityMm||95)/1000);
  const wander=clamp(+p.wander,0,1);
  const axis=clamp(+p.axis,0,1);            // 0 = every heading, 1 = strictly along one

  /* the six kind weights, normalised; a mode with every weight at zero would
     otherwise pick nothing and draw an empty bay */
  const wt=[+p.wTube||0,+p.wCorr||0,+p.wBraid||0,+p.wSpiral||0,+p.wRibbon||0,+p.wLagged||0];
  let tot=0;for(const w of wt)tot+=w;
  if(tot<=0){wt[0]=1;tot=1;}
  const kindOf=()=>{
    let r=rng()*tot;
    for(let i=0;i<6;i++){r-=wt[i];if(r<=0)return i;}
    return 0;
  };

  /* Start points off a low-discrepancy sequence rather than straight out of
     the generator: twelve uniform random points on a bay leave a third of it
     empty and put three on top of each other, every time. */
  let qx=rng(),qy=rng();
  const nextQ=()=>{qx=(qx+0.7548776662)%1;qy=(qy+0.5698402910)%1;};

  const out=[];
  /* Layer 0 is deepest. Its conduits are the fat ones — the things that went in
     first — and each layer above is finer and sits proud of the one below, so
     the strata read as an order of assembly rather than as a random pile. */
  for(let L=0;L<layers;L++){
    const t=layers>1?L/(layers-1):1;
    const gMax=lerp((+p.gaugeMaxMm||46)/1000,(+p.gaugeMinMm||9)/1000,t);
    const gMin=lerp((+p.gaugeMinMm||9)/1000*1.6,(+p.gaugeMinMm||9)/1000,t);
    /* the axis height of this layer: deepest sits on the backplane, the top
       layer just under the panel line, with room for the fattest conduit */
    const z0=lerp(gMax,cav-gMax*1.15,layers>1?t:0.55);

    for(let b=0;b<perLayer;b++){
      const k=kindOf();
      const K=KIND[k];
      /* a ribbon is one flat thing, never a group of them; a lagged duct is
         fat and travels alone or in pairs */
      const nMax=(k===4)?1:(k===5)?2:clamp(p.groupMax|0,1,8);
      const n=1+Math.floor(rng()*nMax);
      const r=rr(gMin,gMax)*0.5*((k===5)?1.7:1);
      /* pitch: touching, to a little over a diameter apart. Below 2r they would
         intersect, which on a Z-test reads as one fat lumpy conduit. */
      const pitch=r*2*rr(1.04,1.55);
      const half=(n-1)*0.5*pitch+r;

      /* THE BEND CLAMP. Three bundle half-widths is about the tightest a loom
         is dressed to, and it is also comfortably inside the "gentle next to
         its own width" the stamp needs. */
      const minR=Math.max(half*3.0,r*6);
      const mat=MATBY[pick(K.mats)];
      nextQ();

      /* INTERPOLATE THE DEVIATION, NOT THE ANGLE. Blending a uniform heading
         towards an axis angle looks right and is not: at half strength it is
         half of a number that runs to 2π, so every route comes out inside the
         first three radians and the whole loom lies one way. Pick the
         deviation FROM the axis instead and scale that, and the two ends mean
         what they say — free at nought, dressed to the axis at one. */
      const base=(rng()<0.5?0:Math.PI*0.5)+(rng()<0.5?0:Math.PI);
      const head0=base+(rng()*2-1)*Math.PI*(1-axis)+rr(-0.28,0.28)*axis;

      out.push({
        layer:L,kind:k,n:n,r:r,pitch:pitch,half:half,mat:mat,z0:z0,minR:minR,
        head:head0,
        x:qx*g.Wm,y:qy*g.Hm,
        /* HOW MUCH IS TOO MUCH. Long enough to cross the tile and come back,
           and no longer: past that every layer is buried by the one over it,
           the backplane never shows, and the strata — which are the subject —
           stop reading at all. */
        len:Math.max(g.Wm,g.Hm)*rr(0.7,1.8),
        wander:wander*rr(0.5,1.35),
        seed:(rng()*1e9)|0,
        ident:(rng()<clamp(+p.identAmt,0,1)*0.75)?IDENT[Math.floor(rng()*IDENT.length)|0]:null,
        /* WHOLE-LENGTH SLEEVING, not just bands. Some runs are colour-coded end
           to end, and without a few of them a bay of forty conduits is forty
           greys however carefully each one is shaded. */
        sleeve:(k!==5&&rng()<clamp(+p.identAmt,0,1)*0.22)
          ?IDENT[Math.floor(rng()*IDENT.length)|0]:null,
        /* HOW OFTEN A LOOM IS ACTUALLY CLAMPED DOWN. A P-clamp every 200 to
           450 mm is what the trade does. Every 50 to 130, which is the instinct
           because it fills the picture, chops each bundle into a chain of short
           capsules and every run in the bay reads as a segmented worm. */
        clampM:rr(0.19,0.45),
        tint:rr(0.86,1.14)
      });
    }
  }
  /* deepest first: the Z-test does the real work, but painting in this order
     means a tie between two bundles at exactly the same height goes to the
     nearer one, which is what an eye expects */
  out.sort((a,b)=>a.layer-b.layer);
  return out;
}

/* ============================ the backplane ============================
   Whatever the loom is bolted to. Ribs one way, lightening holes between them,
   rivets down the rib lines — the three things that make a structural skin read
   as structure and not as a floor. The holes go THROUGH: their floor is well
   below the plane and nearly black, which is most of what gives the bay depth
   before a single conduit is drawn. */
function backplane(HGT,g,p,N){
  const TW=g.TW,TH=g.TH,mpp=g.mpp,bay=g.bay;
  /* the shared noise wants unit tile coordinates and an INTEGER lattice period,
     which is what makes it wrap; periods are held so the finest octave stays
     several texels wide at a working size, or it reads as square blocks rather
     than as grain */
  const py=q=>Math.max(1,Math.round(q*g.Hm/g.Wm));
  let ribM=Math.max(0.02,(+p.ribMm||78)/1000);
  /* SNAP THE LATTICE TO THE TILE. A rib pitch that does not divide the tile
     leaves a sliver at the wrap, and a sliver on a seamless map is the first
     thing the eye finds. The readout says what it landed on. A bay has no wrap
     to close, so it keeps the pitch it was given. */
  let ribX=ribM;
  if(!bay){
    ribM=g.Hm/Math.max(1,Math.round(g.Hm/ribM));
    ribX=g.Wm/Math.max(1,Math.round(g.Wm/ribX));
  }
  const ribW=Math.max(0.004,(+p.ribWMm||16)/1000);
  const ribH=Math.max(0,(+p.ribHMm||7)/1000);
  const holeR=Math.max(0,(+p.holeMm||0)/2000);
  const holeOn=holeR>0.002;
  const flange=Math.max(0.0015,holeR*0.16);
  const seed=(p.seed|0)+404;
  /* the hole floor is not a surface, it is the absence of one */
  const deep=-Math.max(0.012,(+p.cavityMm||95)/1000*0.30);
  const aa=mpp*1.1;

  for(let y=0;y<TH;y++){
    const wy=y*mpp;
    for(let x=0;x<TW;x++){
      const i=y*TW+x,wx=x*mpp;
      let h=0;
      /* ribs run across the short way, the way a stringer does */
      const dr=edgeDist(wy,ribM);
      h+=ribH*(1-smoothstep(ribW*0.5-aa,ribW*0.5+aa,dr));
      if(holeOn){
        /* one hole per rib bay, on the same lattice, so they sit BETWEEN the
           ribs rather than being cut through them */
        const cx=(Math.floor(wx/ribX)+0.5)*ribX;
        const cy=(Math.floor(wy/ribM)+0.5)*ribM;
        const dx=wx-cx,dy=wy-cy;
        const d=Math.sqrt(dx*dx+dy*dy);
        if(d<holeR+flange*2.2){
          /* a flanged lightening hole: the metal is turned up around the rim,
             which is why it is stiffer than the hole it replaced */
          const lip=(1-smoothstep(holeR,holeR+flange*2.0,d))*
                    smoothstep(holeR-flange*1.4,holeR-flange*0.1,d);
          h+=ribH*0.9*lip;
          h=lerp(h,deep,1-smoothstep(holeR-flange*1.6,holeR-flange*1.0,d));
        }
      }
      /* rivets down the rib centres */
      if(ribH>0){
        const rv=bay?Math.max(0.006,ribM*0.10)
                   :g.Wm/Math.max(1,Math.round(g.Wm/Math.max(0.006,ribM*0.10)));
        const cy2=(Math.round(wy/ribM))*ribM;
        if(Math.abs(wy-cy2)<ribW*0.30){
          const dx2=edgeDist(wx,rv);
          const dd=Math.sqrt(dx2*dx2+(wy-cy2)*(wy-cy2));
          const rr2=rv*0.20;
          if(dd<rr2)h+=rr2*0.55*Math.sqrt(Math.max(0,1-(dd/rr2)*(dd/rr2)));
        }
      }
      /* the skin is not flat: rolled sheet keeps a shallow oil-can waviness,
         and the last octave is held several texels wide on purpose */
      h+=(fbm2(x/TW,y/TH,8,py(8),3,seed+3)-0.5)*0.0016;
      HGT[i]=h;
    }
  }
}

/* ============================ the stamp ============================
   Walk each route; at every step along it, step OUT along its normal and paint.
   The cost is the area actually covered rather than a bounding box, and a
   Z-TEST against the height field does the layering: where two bundles cross,
   the higher one wins by arithmetic rather than by draw order, which is why a
   run can pass over one neighbour and under the next.

   Everything a later pass needs about a texel is recorded here, because none of
   it can be recovered afterwards: which bundle it belongs to, where it sits
   across its conduit (the cylinder), how far along the route it is (rings,
   couplings, ident bands) and whether a fitting is sitting on it.

   THE CROSS-SECTION IS A FUNCTION OF THE PERPENDICULAR INDEX ALONE. That is the
   whole performance argument for this file. Nothing about how far across a
   conduit a sample sits changes as the route travels — not the height of the
   cylinder there, not the angle round it, not the byte written to ACR — so all
   of it is tabulated ONCE per route and the inner loop reads it. Written the
   obvious way, with a sqrt and an asin per sample, this pass was ninety-three
   per cent of the build and took five seconds at 512.

   The helix is the one that looks like it cannot be tabulated, since it winds
   on both the angle round the tube and the distance along it. It can: expand
   sin(A+B) into sinA·cosB + cosA·sinB, tabulate the B halves against the index
   and compute the A halves once a step.
   =========================================================================== */
function stamp(BUF,ROUTES,g,p){
  const TW=g.TW,TH=g.TH,pxM=g.pxM,mpp=g.mpp,bay=g.bay;
  const HGT=BUF.HGT,TAG=BUF.TAG;
  const tieAmt=clamp(+p.tieAmt,0,1);
  const clampAmt=clamp(+p.clampAmt,0,1);
  const corrM=Math.max(0.004,(+p.corrMm||11)/1000);
  const TAU=Math.PI*2;

  for(let ri=0;ri<ROUTES.length&&ri<250;ri++){
    const R=ROUTES[ri];
    const rng=mulberry32(R.seed);
    /* Four fifths of a texel along, one across. The perpendicular span is a
       solid line of texels, so consecutive spans less than a texel apart cannot
       leave a hole between them however diagonal the run is — and halving the
       step, which is the instinct, only pays to write every texel twice. */
    const stepM=mpp*0.8;
    const oStep=mpp;
    const maxTurn=stepM/R.minR;                // the bend clamp, per step
    const K=KIND[R.kind];
    const det=K.det,kind=R.kind;

    /* ---- the cross-section, tabulated ---- */
    const oN=Math.max(1,Math.ceil(R.r/oStep));
    const M=oN*2+1;
    const oT=new Float64Array(M);              // offset from the centreline, metres
    const pT=new Float64Array(M);              // the profile, 0..1
    const aT=new Int8Array(M);                 // what ACR gets
    const sB=new Float64Array(M),cB=new Float64Array(M);  // the helix's B halves
    const rT=new Float64Array(M);              // whatever else the finish needs
    const twist=(kind===2)?1.9:1.25;
    /* conductors in a ribbon are at 1.27 mm centres, and at any resolution
       where that is under about three texels they are not detail, they are
       aliasing — so the pitch is held to whichever is coarser */
    const ribN=clamp(Math.round(2*R.r/Math.max(0.00127,mpp*3)),2,40);
    const hs=K.hs;
    for(let k=-oN;k<=oN;k++){
      const idx=k+oN,o=k*oStep,un=o/R.r,u=Math.abs(un);
      oT[idx]=o;
      aT[idx]=Math.round(clamp(un,-1,1)*127);
      pT[idx]=(u>1)?-1
        :(kind===4)?(1-smoothstep(0.72,1,u))*hs
        :Math.sqrt(Math.max(0,1-u*u))*hs;
      if(kind===2||kind===3){
        const B=Math.asin(clamp(un,-1,1))*twist*TAU;
        sB[idx]=Math.sin(B);cB[idx]=Math.cos(B);
      }
      if(kind===4)rT[idx]=Math.sin(un*Math.PI*ribN);
      /* The lagging's cloth is a ridge round the pipe times a wrinkle along it;
         separating the two is what lets both halves be hoisted, and a cloth
         wrap does not need a two-dimensional noise to read as one.

         IT HAS TO BE SMOOTH ACROSS THE WIDTH. A per-sample random here is
         white noise a texel wide running the whole length of the pipe, which
         does not read as cloth at all — it reads as speckle, and a pale pipe
         covered in speckle reads as a slab of something else entirely. */
      if(kind===5)rT[idx]=(n1(k*0.14,R.seed)-0.5)*1.7;
    }
    /* And the clamp band's. It spans the WHOLE bundle rather than one conduit
       — that is the entire reason a group of conduits stays a group — but it is
       a STRAP OVER them, not a slab across them: it rides up over each conduit
       and dips between, which is what a cushion clamp does and what stops a
       clamp reading as a block somebody dropped on the loom. So the profile is
       the distance to the NEAREST conduit centre, not to the bundle's. */
    const bandC=R.half+Math.min(0.006,R.r*0.5),bandT=R.half+R.r*0.10;
    const bN=Math.max(1,Math.ceil(bandC/oStep));
    const bM=bN*2+1;
    const bO=new Float64Array(bM),bP=new Float64Array(bM),bA=new Int8Array(bM);
    const half1=(R.n-1)*0.5;
    for(let k=-bN;k<=bN;k++){
      const idx=k+bN,o=k*oStep;
      bO[idx]=o;bA[idx]=Math.round(clamp(o/bandC,-1,1)*127);
      const c=clamp(Math.round(o/R.pitch+half1),0,R.n-1);
      const dc=Math.abs(o-(c-half1)*R.pitch),un=Math.min(1,dc/R.r);
      bP[idx]=0.34+0.66*Math.sqrt(Math.max(0,1-un*un));
    }

    /* hoisted out of two nested loops: these are plain-object property loads,
       and the inner one runs a few million times a build */
    const Rr=R.r,Rz0=R.z0,Rn=R.n,Rpitch=R.pitch,Rhalf=R.half,RclampM=R.clampM,
          Rwander=R.wander,Rseed=R.seed;
    const detR=Rr*det,collarD=Rr*0.11,helixA=1/(Rr*4.2);
    let x=R.x,y=R.y,head=R.head,s=0;
    let corner=0,cornerDir=1;
    const steps=Math.min(200000,Math.round(R.len/stepM));
    /* A ROUTE HAS TO GO SOMEWHERE. Left to stop where its length runs out, a
       run ends in a flat disc in the middle of the bay, which reads as a pipe
       somebody sawed through. So the last few centimetres at each end sink
       below whatever is around them — through a hole in the structure, behind
       the layer underneath, out of the tile — and a collar marks where it
       goes, the way a bulkhead grommet does. */
    const tailM=Math.min(0.05,R.len*0.22);
    const sinkD=Rr*2.6+Rz0;
    /* a cushion clamp is narrow — a band a finger wide, not a third of the run */
    const clampHalf=Math.min(0.008,R.r*0.7);
    const tiePitch=R.clampM*0.34;
    const tieHalf=Math.max(0.0008,Math.min(0.0022,R.r*0.14));

    for(let st=0;st<steps;st++){
      if(corner>0){
        head+=maxTurn*cornerDir;corner--;
      }else{
        head+=clamp((fbm1(s*3.1,3,Rseed)-0.5)*2*Rwander,-1,1)*maxTurn;
        if(rng()<stepM*0.55){
          corner=Math.round((Math.PI*0.5/maxTurn)*(0.55+rng()*0.75));
          cornerDir=rng()<0.5?-1:1;
        }
      }
      const tx=Math.cos(head),ty=Math.sin(head);
      const nxp=-ty*pxM,nyp=tx*pxM;            // the normal, already in texels per metre
      x+=tx*stepM;y+=ty*stepM;s+=stepM;

      if(bay){
        if(x<-Rhalf||y<-Rhalf||x>g.Wm+Rhalf||y>g.Hm+Rhalf)break;
      }else{
        /* KEEP THE ROUTE INSIDE THE TILE. It is on a torus either way, but
           wrapping the position here rather than the texel index below means
           the index is within one tile of range and two compares wrap it —
           where a modulo on a non-integer double is a call to fmod, several
           million times a build. */
        if(x<0)x+=g.Wm;else if(x>=g.Wm)x-=g.Wm;
        if(y<0)y+=g.Hm;else if(y>=g.Hm)y-=g.Hm;
      }

      let sink=0;
      if(s<tailM)sink=1-s/tailM;
      else if(s>R.len-tailM)sink=1-(R.len-s)/tailM;
      const zNow=Rz0-sink*sink*sinkD;

      const px=x*pxM,py=y*pxM;
      /* fourteen bits of it, so the whole tag fits one word: 16.3 m of run,
         which is further than any route in a bay a metre across */
      const sMM=s<0?0:(s>16.3?16383:(s*1000)|0);

      const dClamp=edgeDist(s,RclampM);
      const onClamp=clampAmt>0&&dClamp<clampHalf;
      const onTie=tieAmt>0&&R.n>1&&!onClamp&&edgeDist(s,tiePitch)<tieHalf;

      if(onClamp||onTie){
        const band=onClamp?bandC:bandT;
        const proud=onClamp?Rr*0.34:Rr*0.13;
        const fade=onClamp?(1-smoothstep(clampHalf*0.45,clampHalf,dClamp)):1;
        const base=zNow+Rr,lift=proud*fade;
        const fit=onClamp?1:2;
        for(let k=0;k<bM;k++){
          const o=bO[k];
          if(o<-band||o>band)continue;
          let gx=Math.round(px+o*nxp)|0,gy=Math.round(py+o*nyp)|0;
          if(bay){if(gx<0||gx>=TW||gy<0||gy>=TH)continue;}
          else{
            while(gx<0)gx+=TW;while(gx>=TW)gx-=TW;
            while(gy<0)gy+=TH;while(gy>=TH)gy-=TH;
          }
          const i=(gy*TW+gx)|0;
          const h=base*bP[k]+lift;
          if(h<=HGT[i])continue;
          HGT[i]=h;TAG[i]=(ri<<24)|(fit<<22)|((bA[k]+128)<<14)|sMM;
        }
        if(onClamp)continue;                   // a clamp hides the conduit under it
      }

      /* ---- the along-the-route half of every finish, once per step ---- */
      let dStep=0,sA=0,cA=0,collar=0;
      if(det>0){
        if(kind===1)dStep=Math.sin(s/corrM*TAU);
        else if(kind===2||kind===3){
          const A=s*helixA*TAU;
          sA=Math.sin(A);cA=Math.cos(A);
        }
        else if(kind===4)dStep=1;
        else if(kind===5)dStep=(edgeDist(s,0.085)<0.006)?1.1:0;
      }
      if(kind===0&&edgeDist(s,0.19)<Rr*0.55)collar=collarD;
      /* the grommet the run disappears into */
      if(sink===0&&(s<tailM*1.5||s>R.len-tailM*1.5))collar=Rr*0.16;

      for(let c=0;c<Rn;c++){
        const off=(c-(Rn-1)*0.5)*Rpitch;
        const cpx=px+off*nxp,cpy=py+off*nyp;
        for(let k=0;k<M;k++){
          const prof=pT[k];
          if(prof<0)continue;
          const o=oT[k];
          let gx=Math.round(cpx+o*nxp)|0,gy=Math.round(cpy+o*nyp)|0;
          if(bay){if(gx<0||gx>=TW||gy<0||gy>=TH)continue;}
          else{
            while(gx<0)gx+=TW;while(gx>=TW)gx-=TW;
            while(gy<0)gy+=TH;while(gy>=TH)gy-=TH;
          }
          const i=(gy*TW+gx)|0;

          /* THE FINISH GOES INTO THE HEIGHT, not into the colour. Corrugation
             rings, a braid weave and a spiral wrap are geometry — they have to
             be here, before the normal map is differenced out of this field,
             or they are decals. */
          let h=zNow+Rr*prof+collar*prof;
          if(det>0&&prof>0.02){
            let d;
            if(kind===2){
              /* the weave is two helices crossing, one wound each way */
              d=Math.max(sA*cB[k]+cA*sB[k],sA*cB[k]-cA*sB[k]);
            }else if(kind===3){
              d=sA*cB[k]+cA*sB[k];
            }else if(kind===4){
              d=rT[k];
            }else if(kind===5){
              d=rT[k]+dStep;
            }else d=dStep;
            h+=detR*prof*d;
          }

          if(h<=HGT[i])continue;
          HGT[i]=h;TAG[i]=(ri<<24)|((aT[k]+128)<<14)|sMM;
        }
      }
    }
  }
}

/* ============================ the bay frame ============================
   The opening this is all seen through: a lip standing proud of the skin, a
   radiused corner, fasteners round it, and nothing at all outside. */
function frame(BUF,g,p,N){
  const TW=g.TW,TH=g.TH,mpp=g.mpp;
  const HGT=BUF.HGT,ALP=BUF.ALP,TAG=BUF.TAG;
  const fw=Math.max(0.004,(+p.frameMm||26)/1000);
  const cav=Math.max(0.01,(+p.cavityMm||95)/1000);
  const rad=Math.max(0,(+p.cornerMm||18)/1000);
  const fast=!!p.fasteners;
  const aa=mpp*1.1;
  const W=g.Wm,H=g.Hm;

  for(let y=0;y<TH;y++){
    const wy=y*mpp;
    for(let x=0;x<TW;x++){
      const i=y*TW+x,wx=x*mpp;
      /* signed distance to the rounded rectangle of the whole piece; negative
         inside. THE SEED VALUE IS −1, NOT 0: at zero, a piece with no corner
         radius sits in the middle of the anti-aliasing band and every texel of
         it comes out part-transparent. */
      let out=-1;
      const qx=Math.abs(wx-W*0.5)-(W*0.5-rad),qy=Math.abs(wy-H*0.5)-(H*0.5-rad);
      if(rad>0){
        const mx=Math.max(qx,0),my=Math.max(qy,0);
        out=Math.sqrt(mx*mx+my*my)+Math.min(Math.max(qx,qy),0)-rad;
      }else{
        out=Math.max(qx,qy)-rad;
      }
      const a=1-smoothstep(-aa,aa,out);
      ALP[i]=clamp(a,0,1)*255;
      if(a<=0.004){HGT[i]=0;TAG[i]=255<<24;continue;}

      /* inside the frame's inner edge is the cavity, untouched */
      const inner=out+fw;
      if(inner<0)continue;

      /* the frame proper: proud of everything, and its inner face falls away
         into the bay */
      const lip=smoothstep(-fw*0.30,0,inner);
      let h=cav*(0.86+0.14*lip)+fw*0.10*lip;
      if(fast){
        /* quarter-turn fasteners at a spacing that always lands one near each
           corner, because a fastener pattern that misses the corners is the
           first thing that reads as wrong */
        const per=Math.max(0.045,fw*3.4);
        const t=(Math.abs(wx-W*0.5)>Math.abs(wy-H*0.5))?wy:wx;
        const d=edgeDist(t,per),rr2=fw*0.30;
        const mid=Math.abs(inner-fw*0.5);
        const dd=Math.sqrt(d*d+mid*mid);
        if(dd<rr2)h-=rr2*0.42*Math.sqrt(Math.max(0,1-(dd/rr2)*(dd/rr2)));
      }
      if(h>HGT[i]){HGT[i]=h;TAG[i]=254<<24;}
    }
  }
}

/* ============================ build ============================ */
function build(p,io){
  P=p;
  const g=geom(P);
  const TW=g.TW,TH=g.TH,N=TW*TH,mpp=g.mpp,bay=g.bay;

  const A=new Uint8ClampedArray(N*3),NRM=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N),MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N),EMI=new Uint8ClampedArray(N);
  const HGT=new Float32Array(N);
  const ALP=new Uint8ClampedArray(N);
  if(!bay)ALP.fill(255);

  /* THE STAMP'S RECORD OF WHAT IT DREW, IN ONE WORD A TEXEL.

     Four separate side buffers is the obvious shape and it is the wrong one.
     A stamp sample writes every one of them at the same index, and that index
     walks a line across the tile rather than along a row — so on a map any
     bigger than the cache, four buffers means four misses a sample where one
     packed word means one. The pass costs a third of what it did.

       bits 31..24  which bundle owns it (255 backplane, 254 frame)
       bits 23..22  the fitting on it: 0 none, 1 clamp, 2 tie
       bits 21..14  how far across the conduit, 0..255 around 128
       bits 13..0   how far along the route, in millimetres */
  const TAG=new Int32Array(N);TAG.fill(255<<24);
  const BUF={HGT:HGT,TAG:TAG,ALP:ALP};

  const R=routes(g,P);
  const cav=Math.max(0.01,(+P.cavityMm||95)/1000);
  let hMin=0,hMax=1;

  function pass1(){
    backplane(HGT,g,P,N);
    io.progress(0.16);
    stamp(BUF,R,g,P);
    io.progress(0.44);
    if(bay)frame(BUF,g,P,N);
    io.progress(0.50);
    setTimeout(pass2,0);
  }

  /* ---- colour, roughness, metal ---- */
  function pass2(){
    const cPlate=hex2rgb(P.cPlate||"#4c5054");
    const cDeep=hex2rgb(P.cDeep||"#0b0c0d");
    const cFrame=hex2rgb(P.cFrame||"#7d838a");
    const oil=clamp(+P.oil,0,1),dust=clamp(+P.dust,0,1),
          heat=clamp(+P.heat,0,1),scuff=clamp(+P.scuff,0,1);
    const seed=(P.seed|0)+91;
    const py=q=>Math.max(1,Math.round(q*g.Hm/g.Wm));
    const lamps=clamp(+P.lamps,0,1);
    const cLamp=hex2rgb(P.cLamp||"#49ff9c");

    for(let y=0;y<TH;y++){
      for(let x=0;x<TW;x++){
        const i=y*TW+x,j=i*3,u=x/TW,v=y/TH;
        if(bay&&!ALP[i]){A[j]=A[j+1]=A[j+2]=0;RGH[i]=200;MET[i]=0;AOc[i]=255;continue;}
        const tag=TAG[i],own=(tag>>>24)&255,fit=(tag>>>22)&3;
        let r,gg,b,rg,met=0,emi=0;

        if(own===255){
          /* the backplane. How far BELOW the plane it is says how much of it
             you can see at all, and a lightening hole is a hole. */
          const dark=clamp(-HGT[i]/(cav*0.30),0,1);
          const t=Math.pow(dark,0.7);
          r=lerp(cPlate[0],cDeep[0],t);
          gg=lerp(cPlate[1],cDeep[1],t);
          b=lerp(cPlate[2],cDeep[2],t);
          rg=lerp(0.58,0.86,t);
          met=lerp(0.72,0.04,t);
          const n=fbm2(u,v,48,py(48),3,seed+7);
          r*=0.88+n*0.24;gg*=0.88+n*0.24;b*=0.88+n*0.24;
        }else if(own===254){
          r=cFrame[0];gg=cFrame[1];b=cFrame[2];rg=0.42;met=0.85;
          const n=fbm2(u,v,64,py(64),2,seed+11);
          r*=0.9+n*0.2;gg*=0.9+n*0.2;b*=0.9+n*0.2;
        }else{
          const B=R[own],M=MAT[B.mat],K=KIND[B.kind];
          const acr=(((tag>>>14)&255)-128)/127,alg=(tag&16383)/1000;
          r=M.c[0]*B.tint;gg=M.c[1]*B.tint;b=M.c[2]*B.tint;
          rg=M.rg;met=M.met;
          if(B.sleeve){
            /* SLEEVING TINTS, IT DOES NOT REPLACE. A red-sleeved cable is a
               dark cable that reads red, not a red plastic rod: taking the
               ident colour neat turns a bay into a bag of liquorice allsorts. */
            r=lerp(r,B.sleeve[0]*0.72,0.72)*B.tint;
            gg=lerp(gg,B.sleeve[1]*0.72,0.72)*B.tint;
            b=lerp(b,B.sleeve[2]*0.72,0.72)*B.tint;
            rg=lerp(rg,0.66,0.6);met=met*0.25;
          }

          if(fit===1){
            /* a cushion clamp is a metal band with a rubber liner, and it is
               nearly always a different metal from what it is holding */
            r=lerp(r,150,0.72);gg=lerp(gg,154,0.72);b=lerp(b,160,0.72);
            rg=0.38;met=0.9;
          }else if(fit===2){
            /* a cable tie is nylon: matte, and lighter than what it grips */
            r=lerp(r,86,0.7);gg=lerp(gg,88,0.7);b=lerp(b,92,0.7);
            rg=0.74;met=0.03;
          }else{
            /* IDENT SLEEVING. Short bands of colour at intervals, which is how
               anybody finds one wire in forty a year later. */
            if(B.ident){
              const bandOn=edgeDist(alg,0.22)<0.016?1:0;
              if(bandOn){
                r=lerp(r,B.ident[0],0.88);gg=lerp(gg,B.ident[1],0.88);
                b=lerp(b,B.ident[2],0.88);
                rg=0.62;met=0.04;
              }
            }
            /* the weave and the rings get a little colour of their own on top
               of the geometry they already have */
            if(B.kind===2){
              const w=0.5+0.5*Math.sin(alg/(B.r*4.2)*Math.PI*2);
              const k2=0.86+0.28*w;
              r*=k2;gg*=k2;b*=k2;
            }
            /* the silhouette of a round thing is always dirtier and rougher
               than its crown: it is what everything else rubs against */
            const edge=Math.abs(acr);
            rg=clamp(rg+edge*edge*0.14,0,1);
          }

          /* a lamp on a junction: rare, and only ever on the top layer */
          if(lamps>0&&B.layer>=1&&fit===0){
            const cell=Math.floor(alg/0.31);
            if(hashi(own*7919+cell,3331)/4294967295<lamps*0.22){
              const d=Math.abs(edgeDist(alg,0.31));
              const k2=(1-smoothstep(0,B.r*0.75,d))*(1-smoothstep(0.35,0.9,Math.abs(acr)));
              if(k2>0.02){
                emi=k2;
                r=lerp(r,cLamp[0],k2*0.8);gg=lerp(gg,cLamp[1],k2*0.8);
                b=lerp(b,cLamp[2],k2*0.8);
              }
            }
          }
        }

        /* ---- what has happened to it since ---- */
        if(heat>0&&own<254){
          /* heat tint is an oxide film and it runs blue-straw on steel; it
             lives near the deep runs, which are the hot ones */
          const t=heat*clamp(fbm2(u,v,5,py(5),3,seed+13)*1.5-0.35,0,1);
          r=lerp(r,r*1.18+22,t*0.7);gg=lerp(gg,gg*0.98+6,t*0.7);
          b=lerp(b,b*0.86+30,t*0.7);
          rg=clamp(rg-t*0.10,0.05,1);
        }
        if(oil>0){
          /* oil runs DOWN, and it pools where it stops. The streaks are a
             stretched field so they read as runs rather than as blotches. */
          /* stretched down the map, so it reads as a run rather than a blotch */
          const st=fbm2(u,v,26,Math.max(1,py(5)),3,seed+17);
          const k2=oil*clamp(st*1.7-0.55,0,1);
          r=lerp(r,r*0.42,k2);gg=lerp(gg,gg*0.40,k2);b=lerp(b,b*0.38,k2);
          rg=clamp(rg-k2*0.30,0.05,1);
        }
        if(dust>0){
          /* DUST SETTLES WHERE NOTHING DISTURBS IT, and in a bay that is DOWN:
             the deep corners, the backplane, under the runs. This is not the
             same feature as the ledge dust in the micro pass, which is about
             which way a surface FACES — this is about how far into the cavity
             it is, and having both is what makes a loom look neglected rather
             than merely shaded. */
          const dep=clamp((cav-HGT[i])/cav,0,1);
          const k2=dust*(0.20+0.80*dep*dep)*
                   clamp(fbm2(u,v,20,py(20),3,seed+23)*1.5-0.32,0,1);
          r=lerp(r,150,k2*0.55);gg=lerp(gg,145,k2*0.55);b=lerp(b,133,k2*0.55);
          rg=clamp(rg+k2*0.22,0,1);
          met=met*(1-k2*0.75);
        }
        if(scuff>0&&own!==255){
          const sc=fbm2(u,v,48,py(48),2,seed+19);
          const k2=scuff*clamp(sc*2.0-1.15,0,1);
          r=lerp(r,r*1.35+26,k2);gg=lerp(gg,gg*1.35+26,k2);b=lerp(b,b*1.35+26,k2);
          rg=clamp(rg-k2*0.18,0.05,1);
        }

        A[j]=r;A[j+1]=gg;A[j+2]=b;
        RGH[i]=clamp(rg,0,1)*255;
        MET[i]=clamp(met,0,1)*255;
        EMI[i]=clamp(emi,0,1)*255;
      }
      if((y&63)===0)io.progress(0.50+0.28*(y/TH));
    }
    io.progress(0.78);
    setTimeout(pass3,0);
  }

  /* ---- occlusion, normals, the last pass ---- */
  function pass3(){
    /* AO the way the rest of the app does it: radii are FEATURE SIZES in
       metres, so the shading is not a function of the resolution slider, and
       the terms screen into one accumulator rather than summing — a texel at
       the bottom of a bay is occluded by several things at once and must not go
       past black. */
    const pxPerM=g.pxM;
    const rCap=Math.max(4,Math.min(TW,TH)>>2);
    const rOf=m=>clamp(Math.round(pxPerM*m),1,rCap);
    let gaugeAvg=0;for(const b of R)gaugeAvg+=b.r*2;
    gaugeAvg=R.length?gaugeAvg/R.length:0.02;

    const r1=rOf(Math.max(0.0015,gaugeAvg*0.30));
    const r2=rOf(Math.max(0.006,gaugeAvg*1.15));
    const r3=rOf(Math.max(0.030,cav*0.70));
    const sc=1/Math.max(1e-7,cav*0.55);
    const blur=bay?((src,r)=>blurClamp(src,TW,TH,r)):((src,r)=>blurWrap(src,TW,r));
    let acc=new Float32Array(N);acc.fill(1);
    const fold=(rad,gain,w)=>{
      const bb=blur(HGT,rad);
      for(let i=0;i<N;i++){
        if(bay&&!ALP[i])continue;
        acc[i]*=(1-clamp((bb[i]-HGT[i])*sc*gain,0,1)*w);
      }
    };
    fold(r1,1.60,0.44);fold(r2,1.05,0.60);fold(r3,0.72,0.66);

    /* AND THE ONE THING A BLUR CANNOT SEE. Depth into the bay is not a local
       relationship — a texel four layers down is dark because it is four layers
       down, not because the texel next to it is higher. Without this term the
       strata all read at the same brightness and the whole point is lost. */
    const aoStr=clamp(+P.aoStr,0,1.5);
    for(let i=0;i<N;i++){
      if(bay&&!ALP[i]){AOc[i]=255;continue;}
      const depth=clamp((cav-HGT[i])/cav,0,1);
      const cavity=Math.pow(depth,1.20)*0.74;
      const a=acc[i]*(1-cavity);
      AOc[i]=clamp(1-Math.min(1-a,0.93)*aoStr,0,1)*255;
    }
    acc=null;
    io.progress(0.88);

    /* dust settles on whatever faces up, and in a bay that is the crown of
       every run in the top layer — the same relationship the shared micro pass
       reads, so it does it rather than this file guessing at it */
    if(window.ForgeMicro)ForgeMicro.apply({A:A,RGH:RGH,HGT:HGT,ALP:bay?ALP:null,W:TW,H:TH},{
      seed:P.seed|0,mpp:mpp,wrap:!bay,up:-1,
      curve:+P.mCurve||0,grain:+P.mGrain||0,speck:(+P.mGrain||0)*0.7,dust:+P.mDust||0,
      ledgeM:Math.max(0.004,gaugeAvg*0.5),stepU:Math.max(0.0006,gaugeAvg*0.10),
      curveU:Math.max(0.0004,gaugeAvg*0.06),dustC:[150,146,136]});
    io.progress(0.93);

    hMin=Infinity;hMax=-Infinity;
    for(let i=0;i<N;i++){
      if(bay&&!ALP[i])continue;
      const h=HGT[i];if(h<hMin)hMin=h;if(h>hMax)hMax=h;
    }
    if(!isFinite(hMin)){hMin=0;hMax=1;}
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;

    const gy=P.flipG?-1:1;
    const wx=bay?(x=>x<0?0:(x>=TW?TW-1:x)):(x=>(x+TW)%TW);
    const wyf=bay?(y=>y<0?0:(y>=TH?TH-1:y)):(y=>(y+TH)%TH);
    const perTexel=mpp;
    const ns=+P.normalStr||1;
    for(let y=0;y<TH;y++){
      const yp=wyf(y+1)*TW,ym=wyf(y-1)*TW,y0=y*TW;
      for(let x=0;x<TW;x++){
        const xp=wx(x+1),xm=wx(x-1);
        const dhdu=(HGT[y0+xp]-HGT[y0+xm])/(2*perTexel)*ns;
        const dhdv=(HGT[yp+x]-HGT[ym+x])/(2*perTexel)*ns;
        let nx=-dhdu,ny=-dhdv*gy;
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;
        const j=(y0+x)*3;
        NRM[j]=(nx*0.5+0.5)*255;NRM[j+1]=(ny*0.5+0.5)*255;NRM[j+2]=(inv*0.5+0.5)*255;
      }
    }
    io.progress(1);
    io.done({A:A,RGH:RGH,MET:MET,AO:AOc,NRM:NRM,HGT:HGT,ALP:ALP,EMI:EMI,
             hMin:hMin,hMax:hMax});
  }

  io.progress(0.02);
  setTimeout(pass1,0);
}

/* ============================ mode definition ============================ */

Forge.register({
  id:"conduit",
  label:"Conduit",
  group:"Detail",
  threadable:true,
  blurb:"Layered bundles of conduit — what is behind an access panel",
  title:'Conduit <em>Loom</em>',
  tagline:"Bundles · strata · clamps · braid · corrugation · lightening holes",
  actionLabel:"Route the loom",
  busyLabel:"Routing…",
  previewSize:256,
  preview:{gain:3.0,amb:1.15,specK:0.5,skyLo:[0.13,0.15,0.19],skyHi:[0.30,0.34,0.42]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
    {key:"ao",label:"AO"},{key:"emissive",label:"Emissive"},
    {key:"height",label:"Height"},{key:"orm",label:"ORM packed"},
    {key:"opacity",label:"Opacity"}
  ],

  presets:[
    {id:"engine",label:"Engine bay",set:{
      piece:"tile",tileMm:620,cavityMm:95,layers:4,bundles:3,groupMax:5,
      gaugeMinMm:9,gaugeMaxMm:46,wander:.55,axis:.45,
      wTube:.7,wCorr:1,wBraid:.8,wSpiral:.5,wRibbon:.15,wLagged:.6,
      clampAmt:1,tieAmt:.7,identAmt:.5,lamps:.15,
      ribMm:78,ribWMm:16,ribHMm:7,holeMm:34,
      oil:.45,dust:.3,heat:.4,scuff:.35,aoStr:1,
      mCurve:.5,mGrain:.4,mDust:.35,
      cPlate:"#4c5054",cDeep:"#0b0c0d",cLamp:"#49ff9c"}},

    {id:"harness",label:"Wiring harness",set:{
      piece:"tile",tileMm:380,cavityMm:70,layers:4,bundles:4,groupMax:7,
      gaugeMinMm:6,gaugeMaxMm:22,wander:.7,axis:.3,
      wTube:.15,wCorr:.5,wBraid:.4,wSpiral:1,wRibbon:.5,wLagged:0,
      clampAmt:1,tieAmt:1,identAmt:.9,lamps:.05,
      ribMm:60,ribWMm:12,ribHMm:5,holeMm:24,
      oil:.15,dust:.35,heat:.05,scuff:.25,aoStr:1,
      mCurve:.5,mGrain:.45,mDust:.4,
      cPlate:"#565a5e",cDeep:"#0c0d0f",cLamp:"#ffb648"}},

    {id:"hydraulic",label:"Hydraulic run",set:{
      piece:"tile",tileMm:540,cavityMm:85,layers:3,bundles:2,groupMax:4,
      gaugeMinMm:10,gaugeMaxMm:30,wander:.35,axis:.75,
      wTube:1,wCorr:.2,wBraid:1,wSpiral:.1,wRibbon:0,wLagged:.2,
      clampAmt:1,tieAmt:.3,identAmt:.35,lamps:0,
      ribMm:90,ribWMm:18,ribHMm:8,holeMm:40,
      oil:.75,dust:.2,heat:.25,scuff:.4,aoStr:1,
      mCurve:.55,mGrain:.35,mDust:.25,
      cPlate:"#474b4f",cDeep:"#0a0b0c",cLamp:"#49ff9c"}},

    {id:"hatch",label:"Access hatch",set:{
      piece:"bay",bayWmm:520,bayHmm:380,frameMm:26,cornerMm:18,fasteners:true,
      cavityMm:100,layers:4,bundles:3,groupMax:5,
      gaugeMinMm:8,gaugeMaxMm:42,wander:.5,axis:.5,
      wTube:.6,wCorr:1,wBraid:.7,wSpiral:.6,wRibbon:.2,wLagged:.5,
      clampAmt:1,tieAmt:.7,identAmt:.55,lamps:.2,
      ribMm:74,ribWMm:15,ribHMm:7,holeMm:32,
      oil:.4,dust:.35,heat:.3,scuff:.35,aoStr:1,
      mCurve:.5,mGrain:.4,mDust:.35,
      cPlate:"#4c5054",cDeep:"#0b0c0d",cFrame:"#7d838a",cLamp:"#49ff9c"}},

    {id:"reactor",label:"Reactor conduit",set:{
      piece:"bay",bayWmm:760,bayHmm:760,frameMm:34,cornerMm:60,fasteners:true,
      cavityMm:150,layers:5,bundles:4,groupMax:6,
      gaugeMinMm:12,gaugeMaxMm:70,wander:.45,axis:.35,
      wTube:.5,wCorr:1,wBraid:.5,wSpiral:.4,wRibbon:.1,wLagged:1,
      clampAmt:1,tieAmt:.5,identAmt:.4,lamps:.55,
      ribMm:110,ribWMm:22,ribHMm:10,holeMm:48,
      oil:.3,dust:.25,heat:.7,scuff:.3,aoStr:1.1,
      mCurve:.55,mGrain:.4,mDust:.3,
      cPlate:"#3f4348",cDeep:"#08090a",cFrame:"#6d737a",cLamp:"#5fe0ff"}},

    {id:"crawl",label:"Crawlspace",set:{
      piece:"tile",tileMm:900,cavityMm:120,layers:5,bundles:5,groupMax:6,
      gaugeMinMm:8,gaugeMaxMm:64,wander:.8,axis:.2,
      wTube:.5,wCorr:1,wBraid:.4,wSpiral:.7,wRibbon:.3,wLagged:.8,
      clampAmt:.7,tieAmt:.5,identAmt:.3,lamps:.1,
      ribMm:120,ribWMm:20,ribHMm:8,holeMm:0,
      oil:.5,dust:.7,heat:.15,scuff:.3,aoStr:1.05,
      mCurve:.5,mGrain:.5,mDust:.6,
      cPlate:"#3d4145",cDeep:"#090a0b",cLamp:"#ff5a48"}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"piece",type:"select",label:"Draw",value:"tile",options:[
        ["tile","Seamless field"],["bay","One framed bay"]]},
      {id:"size",type:"select",label:"Resolution",value:1024,numeric:true,
       options:Forge.sizes("square",2048)},
      {id:"tileMm",label:"Tile covers",unit:"mm",min:200,max:2000,step:20,value:620,need:"tile"},
      {id:"bayWmm",label:"Bay width",unit:"mm",min:150,max:1600,step:10,value:520,need:"bay"},
      {id:"bayHmm",label:"Bay height",unit:"mm",min:150,max:1600,step:10,value:380,need:"bay"},
      {id:"frameMm",label:"Frame width",unit:"mm",min:6,max:80,step:1,value:26,need:"bay"},
      {id:"cornerMm",label:"Corner radius",unit:"mm",min:0,max:200,step:2,value:18,need:"bay"},
      {type:"checks",need:"bay",items:[
        {id:"fasteners",label:"Fasteners round the frame",value:true}]},
      {type:"readout"},
      {id:"seed",type:"seed",label:"Seed",value:4118},
      {type:"note",html:"<b>Seamless field</b> is an endless equipment bay or hull interior. "+
        "<b>One framed bay</b> is a single access opening with a lip and an alpha silhouette — "+
        "drop it on a hull and the hull shows through around it."}
    ]},

    {title:"The loom",open:true,rows:[
      {id:"cavityMm",label:"Cavity depth",unit:"mm",min:20,max:260,step:5,value:95},
      {id:"layers",label:"Layers",min:1,max:6,step:1,value:4},
      {id:"bundles",label:"Bundles per layer",min:1,max:10,step:1,value:3},
      {id:"groupMax",label:"Conduits per bundle",min:1,max:8,step:1,value:5},
      {id:"gaugeMinMm",label:"Finest gauge",unit:"mm",min:3,max:40,step:1,value:9},
      {id:"gaugeMaxMm",label:"Fattest gauge",unit:"mm",min:8,max:110,step:2,value:46},
      {id:"wander",label:"Wander",min:0,max:1,step:0.05,value:0.55},
      {id:"axis",label:"Runs with the bay",min:0,max:1,step:0.05,value:0.45},
      {type:"note",html:"A <b>bundle</b> is a group: several conduits laid parallel at a fixed "+
        "pitch and routed as one, so on a bend the inner ones take a tighter radius than the "+
        "outer ones. Layer 1 is deepest and carries the fattest items."}
    ]},

    {title:"What is in it",rows:[
      {id:"wTube",label:"Rigid tube",min:0,max:1,step:0.05,value:0.7},
      {id:"wCorr",label:"Corrugated flex",min:0,max:1,step:0.05,value:1},
      {id:"wBraid",label:"Braided hose",min:0,max:1,step:0.05,value:0.8},
      {id:"wSpiral",label:"Spiral wrap",min:0,max:1,step:0.05,value:0.5},
      {id:"wRibbon",label:"Flat ribbon",min:0,max:1,step:0.05,value:0.15},
      {id:"wLagged",label:"Lagged pipe",min:0,max:1,step:0.05,value:0.6},
      {id:"corrMm",label:"Corrugation pitch",unit:"mm",min:4,max:30,step:1,value:14},
      {type:"note",html:"Weights, not counts. Every finish is <b>geometry</b> — the rings, the "+
        "weave and the spiral go into the height field before the normal is differenced out "+
        "of it, so they survive being lit from any direction."}
    ]},

    {title:"Fittings",rows:[
      {id:"clampAmt",label:"Clamps",min:0,max:1,step:0.05,value:1},
      {id:"tieAmt",label:"Cable ties",min:0,max:1,step:0.05,value:0.7},
      {id:"identAmt",label:"Ident bands",min:0,max:1,step:0.05,value:0.5},
      {id:"lamps",label:"Indicator lamps",min:0,max:1,step:0.05,value:0.15},
      {type:"colors",label:"Lamp",items:[{id:"cLamp",value:"#49ff9c"}]}
    ]},

    {title:"Backplane",rows:[
      {id:"ribMm",label:"Rib spacing",unit:"mm",min:30,max:220,step:2,value:78},
      {id:"ribWMm",label:"Rib width",unit:"mm",min:4,max:50,step:1,value:16},
      {id:"ribHMm",label:"Rib height",unit:"mm",min:0,max:24,step:1,value:7},
      {id:"holeMm",label:"Lightening holes",unit:"mm",min:0,max:120,step:2,value:34},
      {type:"colors",label:"Plate · down the holes",items:[
        {id:"cPlate",value:"#4c5054"},{id:"cDeep",value:"#0b0c0d"}]},
      {type:"colors",label:"Frame",need:"bay",items:[{id:"cFrame",value:"#7d838a"}]}
    ]},

    {title:"Wear",rows:[
      {id:"oil",label:"Oil and streaks",min:0,max:1,step:0.05,value:0.45},
      {id:"dust",label:"Dust",min:0,max:1,step:0.05,value:0.3},
      {id:"heat",label:"Heat tint",min:0,max:1,step:0.05,value:0.4},
      {id:"scuff",label:"Scuffing",min:0,max:1,step:0.05,value:0.35}
    ]},

    {title:"Micro detail",rows:[
      {id:"mCurve",label:"Edge wear and crack dirt",min:0,max:1,step:0.05,value:0.5},
      {id:"mGrain",label:"Surface grain",min:0,max:1,step:0.05,value:0.4},
      {id:"mDust",label:"Dust on upward faces",min:0,max:1,step:0.05,value:0.35}
    ]},

    {title:"Maps",rows:[
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1.5,step:0.05,value:1},
      {id:"normalStr",label:"Normal strength",min:0.2,max:3,step:0.1,value:1},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  needs:function(p){return [isBay(p)?"bay":"tile"];},

  seamless:function(p){return !isBay(p);},
  backdrops:function(p){return isBay(p);},

  size:function(p){const g=geom(p);return {w:g.TW,h:g.TH};},
  build:build,
  plan:function(p){const g=geom(p);return {w:g.Wm,h:g.Hm,cutout:g.bay};},

  tileTag:function(p){return isBay(p)?"":"Tiles ↔ and ↕";},

  readout:function(p){
    const g=geom(p);
    const bundles=clamp(p.layers|0,1,6)*clamp(p.bundles|0,1,10);
    const px=(g.pxM/1000).toFixed(3);
    return "<b>"+Math.round(g.Wm*1000)+" × "+Math.round(g.Hm*1000)+" mm</b> · "+
      g.TW+" × "+g.TH+" px<br>"+
      "<b>"+(g.mpp*1000).toFixed(2)+" mm per texel</b> · "+Math.round(g.pxM)+" px/m<br>"+
      bundles+" bundles over "+clamp(p.layers|0,1,6)+" layers, "+
      "up to "+clamp(p.groupMax|0,1,8)+" conduits each<br>"+
      "cavity "+Math.round((+p.cavityMm||95))+" mm · gauges "+
      Math.round(+p.gaugeMinMm||9)+"–"+Math.round(+p.gaugeMaxMm||46)+" mm";
  },

  readme:function(p,info){
    const g=geom(p);
    const bay=isBay(p);
    return [
"TEXTURE FORGE — conduit loom",
"",
(bay?"One framed access bay, ":"A seamless field, ")+
  Math.round(g.Wm*1000)+" × "+Math.round(g.Hm*1000)+" mm, at "+info.W+" × "+info.H+" px",
"("+(g.mpp*1000).toFixed(2)+" mm per texel).",
"",
bay?"CUT-OUT. opacity.png is the silhouette of the bay. Use it as the alpha of\nthe base colour, or as an opacity/clip map, and the surface it is dropped\nonto shows through around it."
   :"SEAMLESS. Tiles in both axes. Every route was routed on the torus, so a\nbundle that leaves one edge arrives at the other still on its heading.",
"",
"WHAT IS IN IT",
clamp(p.layers|0,1,6)+" layers, "+clamp(p.bundles|0,1,10)+" bundles each. A bundle is a GROUP:",
"up to "+clamp(p.groupMax|0,1,8)+" conduits laid parallel at a fixed pitch, routed as one,",
"held down by clamps that span the whole group. Gauges run "+
  Math.round(+p.gaugeMinMm||9)+"–"+Math.round(+p.gaugeMaxMm||46)+" mm",
"in a cavity "+Math.round(+p.cavityMm||95)+" mm deep.",
"",
"FILES",
"basecolor.png  sRGB.",
"normal.png     Tangent space, "+info.normalNote+".",
"roughness.png  Linear grey.",
"metallic.png   Linear grey. Braid, tube and the backplane are metal; rubber,",
"               PVC, PTFE, lagging, ties and ident sleeving are not.",
"ao.png         Linear grey. Carries the depth of the bay as well as the",
"               local occlusion — see below.",
"emissive.png   Indicator lamps only. Black where there are none.",
"height.png     Linear grey, remapped over the range below.",
"orm.png        R=AO, G=roughness, B=metallic.",
bay?"opacity.png    The bay silhouette.":null,
"unlit.png      The whole thing with one lighting solution already in it.",
"",
"HEIGHT",
"height.png is normalised over "+info.hMin.toFixed(4)+" … "+info.hMax.toFixed(4)+" m,",
"a range of "+((info.hMax-info.hMin)*1000).toFixed(1)+" mm. Displace by that to get the real depth;",
"height16.png is the same field at 16 bits, which is what you want for this",
"mode — an 8-bit height over a hundred millimetres of cavity quantises the",
"finest conduits into steps.",
"",
"THE AO IS DOING TWO JOBS",
"Local occlusion, the way every mode here does it, AND a depth term: how far",
"into the cavity a texel sits, independent of its neighbours. A blur cannot",
"see that — a conduit four layers down is dark because it is four layers down,",
"not because the texel beside it is higher — and without it the strata all",
"read at one brightness, which is the whole subject gone.",
"",
"Seed "+(p.seed|0)+"."
    ].filter(x=>x!==null).join("\n");
  }
});

})();
