/* =====================================================================
   SHARED: the loom — everything two routing models have in common
   =====================================================================
   Bundles of conduit stamped onto a backplane and seen from in front.
   What differs between a hand-dressed loom and a raceway is ONLY where
   the runs go and what holds them down. Everything else — what a conduit
   is made of, how a cross-section is drawn, the backplane behind it, the
   framed bay in front of it, the shading, the occlusion — is the same
   work twice, so it is here once.

   A MODE SUPPLIES ROUTES; THIS FILE DRAWS THEM. A route arrives as a
   polyline already resampled at ForgeLoom.stepM(g), carrying its own
   tangents. How that polyline was arrived at is the mode's business and
   none of this file's: modes/conduit.js integrates a heading with a
   wandering turn, modes/raceway.js walks a lattice and fillets every
   corner, and the stamp below cannot tell them apart.

     R.pts    Float64Array, four numbers a step — x, y (metres, ALREADY
              wrapped into the tile) then the unit tangent tx, ty. The
              tangent is carried rather than differenced because on a
              seamless tile the position wraps, and the difference across
              that wrap is a whole tile wide.
     R.nPts   how many steps of it are real
     R.len    the arc length in metres
     R.fit    what holds the bundle down — see FITTINGS
     R.tail   metres of dive at each end, 0 for none

   and the bundle riding it: kind, mat, n, r, pitch, half, z0, layer,
   tint, ident, sleeve, seed.

   STAMPED, NOT EVALUATED. Distance from a texel to forty snaking
   polylines is hundreds of tests a texel, so the routes are painted
   instead — walking each one and stepping out along its normal — and a
   Z-TEST against the height field does the layering. Where two bundles
   cross the higher one wins by arithmetic rather than by draw order,
   which is why a run can pass over one neighbour and under the next.

   THE CROSS-SECTION IS A FUNCTION OF THE PERPENDICULAR INDEX ALONE, and
   that is the whole performance argument for this file. Nothing about
   how far across a conduit a sample sits changes as the route travels —
   not the height of the cylinder there, not the angle round it, not the
   byte recorded — so all of it is tabulated ONCE a route and the inner
   loop reads it. Written the obvious way, with a sqrt and an asin a
   sample, this pass was ninety-three per cent of the build.

   The helix looks like the one that cannot be tabulated, since it winds
   on both the angle round the tube and the distance along it. It can:
   expand sin(A+B) into sinA·cosB + cosA·sinB, tabulate the B halves
   against the index, and compute the A halves once a step.

   FITTINGS — what stops a group of conduits being several conduits that
   happen to be near each other. Two shapes, and they are different
   objects rather than one with a parameter:

     style 1   a STRAP over the bundle, which is a cushion clamp. It
               rides up over each conduit and dips between, so its
               profile is the distance to the NEAREST conduit centre
               rather than to the bundle's. Drawn as a slab across the
               bundle instead, it reads as a block dropped on the loom.
     style 2   a BRACE between them, which is a spacer comb. It is absent
               over every conduit and present only in the gaps and at the
               bundle edges, where it stands as a post. So it holds the
               group without hiding any of it, which a strap cannot do.

   R.fit = {style, pitch, half, proud, tie:{pitch,half,proud}|null}

   PARAMETER NAMES ARE PART OF THE CONTRACT. This file reads piece, size,
   seed, tileMm, bayWmm, bayHmm, frameMm, cornerMm, fasteners, cavityMm,
   ribMm, ribWMm, ribHMm, holeMm, corrMm, lamps, cLamp, cPlate, cDeep,
   cFrame, oil, dust, heat, scuff, aoStr, normalStr, flipG, mCurve,
   mGrain and mDust off the mode's parameters, so a mode built on it
   declares controls with those ids.
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
   Walk each route's polyline; at every step, step OUT along its normal and
   paint. The cost is the area actually covered rather than a bounding box, and
   the perpendicular span is a solid line of texels — so consecutive spans less
   than a texel apart cannot leave a hole between them however diagonal the run
   is, which is why the routers resample at four fifths of a texel and not at a
   half. Halving it only pays to write every texel twice.

   Everything a later pass needs about a texel is recorded here, because none of
   it can be recovered afterwards: which bundle it belongs to, where it sits
   across its conduit (the cylinder), how far along the route it is (rings,
   couplings, ident bands) and whether a fitting is sitting on it. */
function stamp(BUF,ROUTES,g,p){
  const TW=g.TW,TH=g.TH,pxM=g.pxM,mpp=g.mpp,bay=g.bay;
  const HGT=BUF.HGT,TAG=BUF.TAG;
  const corrM=Math.max(0.004,(+p.corrMm||11)/1000);
  const TAU=Math.PI*2;
  const stepM=mpp*0.8;

  for(let ri=0;ri<ROUTES.length&&ri<250;ri++){
    const R=ROUTES[ri];
    const PTS=R.pts,nPts=R.nPts;
    if(!PTS||nPts<2)continue;
    const oStep=mpp;
    const K=KIND[R.kind];
    const det=K.det,kind=R.kind;

    /* ---- the cross-section, tabulated ---- */
    const oN=Math.max(1,Math.ceil(R.r/oStep));
    const M=oN*2+1;
    const oT=new Float64Array(M);              // offset from the centreline, metres
    const pT=new Float64Array(M);              // the profile, 0..1
    const aT=new Int8Array(M);                 // what the across byte gets
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

    /* ---- and the fitting's, whichever shape it is ---- */
    const F=R.fit||null;
    const style=F?F.style|0:0;
    const bandC=R.half+(style===2?Math.max(0.004,R.r*0.55):Math.min(0.006,R.r*0.5));
    const bandT=R.half+R.r*0.10;
    const bN=Math.max(1,Math.ceil(bandC/oStep));
    const bM=bN*2+1;
    const bO=new Float64Array(bM),bP=new Float64Array(bM),bA=new Int8Array(bM);
    const half1=(R.n-1)*0.5;
    for(let k=-bN;k<=bN;k++){
      const idx=k+bN,o=k*oStep;
      bO[idx]=o;bA[idx]=Math.round(clamp(o/bandC,-1,1)*127);
      const c=clamp(Math.round(o/R.pitch+half1),0,R.n-1);
      const dc=Math.abs(o-(c-half1)*R.pitch);
      if(style===2){
        /* THE BRACE IS THE HOLES IN IT. A comb that covered the conduits would
           be a strap; what makes it read as bracing rather than as a lid is
           that it is only ever there where a conduit is not — in the gaps, and
           outside the group as a post at each end.

           WHERE THE GAP STARTS IS THE WHOLE OF WHETHER YOU CAN SEE IT. Waiting
           until the conduit's own surface has ended, at dc = r, leaves a tooth
           as wide as whatever the pitch has over two radii — a tenth of a
           radius at a normal spacing — and the bracing vanishes. It starts at
           six tenths instead, where the cylinder has dropped to three quarters
           of its crown, and the tooth comes out about a radius wide. */
        if(Math.abs(o)>R.half)bP[idx]=1.55;
        else if(dc>R.r*0.60)
          bP[idx]=0.75+0.40*smoothstep(R.r*0.60,Math.min(R.r*1.30,R.pitch*0.5),dc);
        else bP[idx]=-1;
      }else{
        const un=Math.min(1,dc/R.r);
        bP[idx]=0.34+0.66*Math.sqrt(Math.max(0,1-un*un));
      }
    }

    /* hoisted out of two nested loops: these are plain-object property loads,
       and the inner one runs a few million times a build */
    const Rr=R.r,Rz0=R.z0,Rn=R.n,Rpitch=R.pitch,Rhalf=R.half,Rseed=R.seed;
    const detR=Rr*det,collarD=Rr*0.11,helixA=1/(Rr*4.2);
    const fitPitch=F?F.pitch:0,fitHalf=F?F.half:0,fitProud=F?F.proud:0;
    const T=F&&F.tie?F.tie:null;
    const tiePitch=T?T.pitch:0,tieHalf=T?T.half:0,tieProud=T?T.proud:0;
    /* A ROUTE HAS TO GO SOMEWHERE. Left to stop where its length runs out, a
       run ends in a flat disc in the middle of the bay, which reads as a pipe
       somebody sawed through. So the last few centimetres at each end sink
       below whatever is around them — through a hole in the structure, behind
       the layer underneath, out of the tile — and a collar marks where it
       goes, the way a bulkhead grommet does. */
    const tailM=R.tail||0;
    const sinkD=Rr*2.6+Rz0;
    const len=R.len;

    for(let st=0;st<nPts;st++){
      const q=st*4;
      const px=PTS[q]*pxM,py=PTS[q+1]*pxM;
      const tx=PTS[q+2],ty=PTS[q+3];
      const nxp=-ty*pxM,nyp=tx*pxM;            // the normal, already in texels per metre
      const s=st*stepM;

      let sink=0;
      if(tailM>0){
        if(s<tailM)sink=1-s/tailM;
        else if(s>len-tailM)sink=1-(len-s)/tailM;
      }
      const zNow=Rz0-sink*sink*sinkD;

      /* fourteen bits of it, so the whole tag fits one word: 16.3 m of run,
         which is further than any route in a bay a metre across */
      const sMM=s<0?0:(s>16.3?16383:(s*1000)|0);

      let onFit=false,onTie=false,dFit=0;
      if(style){
        dFit=edgeDist(s,fitPitch);
        onFit=dFit<fitHalf;
      }
      if(T&&!onFit&&Rn>1)onTie=edgeDist(s,tiePitch)<tieHalf;

      if(onFit||onTie){
        const band=onFit?bandC:bandT;
        const proud=onFit?fitProud:tieProud;
        const fade=onFit?(1-smoothstep(fitHalf*0.45,fitHalf,dFit)):1;
        const base=zNow+Rr,lift=proud*fade;
        /* a brace is a bracket rather than a cushion clamp, and the shading
           pass tells them apart by this */
        const tag=onFit?(style===2?3:1):2;
        for(let k=0;k<bM;k++){
          const o=bO[k];
          if(o<-band||o>band)continue;
          const bp=onFit?bP[k]:(0.34+0.66*Math.sqrt(Math.max(0,1-Math.min(1,Math.abs(o)/band)**2)));
          if(bp<0)continue;
          let gx=Math.round(px+o*nxp)|0,gy=Math.round(py+o*nyp)|0;
          if(bay){if(gx<0||gx>=TW||gy<0||gy>=TH)continue;}
          else{
            while(gx<0)gx+=TW;while(gx>=TW)gx-=TW;
            while(gy<0)gy+=TH;while(gy>=TH)gy-=TH;
          }
          const i=(gy*TW+gx)|0;
          /* A STRAP'S PROFILE IS A FRACTION OF THE WHOLE STANDING HEIGHT, since
             it is wrapped round the bundle and the bundle is where it is. A
             BRACE'S IS A MULTIPLE OF THE CONDUIT RADIUS ABOVE THE AXIS, because
             it is a bracket standing beside them: scale it off the standing
             height instead and the comb teeth sink further below the conduits
             the higher up the cavity the layer sits, which is backwards. */
          const h=((style===2&&onFit)?(zNow+Rr*bp):(base*bp))+lift;
          if(h<=HGT[i])continue;
          HGT[i]=h;TAG[i]=(ri<<24)|(tag<<22)|((bA[k]+128)<<14)|sMM;
        }
        /* a strap hides the conduit under it; a brace is the gaps between them
           and must not */
        if(onFit&&style===1)continue;
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
      if(tailM>0&&sink===0&&(s<tailM*1.5||s>len-tailM*1.5))collar=Rr*0.16;

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
function build(p,io,spec){
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
       bits 23..22  the fitting on it: 0 none, 1 clamp, 2 tie, 3 brace
       bits 21..14  how far across the conduit, 0..255 around 128
       bits 13..0   how far along the route, in millimetres */
  const TAG=new Int32Array(N);TAG.fill(255<<24);
  const BUF={HGT:HGT,TAG:TAG,ALP:ALP};

  const R=spec.routes(g,P);
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
          }else if(fit===3){
            /* a brace is a bracket rather than a clamp: fabricated, painted,
               and duller than anything it is holding apart */
            r=lerp(r,104,0.86);gg=lerp(gg,108,0.86);b=lerp(b,112,0.86);
            rg=0.58;met=0.55;
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

window.ForgeLoom={
  MAT:MAT,MATBY:MATBY,KIND:KIND,IDENT:IDENT,
  isBay:isBay,geom:geom,edgeDist:edgeDist,n1:n1,fbm1:fbm1,
  /* the spacing every router must resample its polyline at */
  stepM:function(g){return g.mpp*0.8;},
  build:build
};

})();
