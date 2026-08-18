/* =====================================================================
   ROOF — seamless roofing surfaces, dimensioned in real inches
   =====================================================================

   A library, not a mode. It publishes window.RoofGen; modes/envelope.js
   registers it as one face beside the side and back house elevations, so
   the same seed gives the same building from the walls up.

   Everything is in INCHES, because roofing is sold in inches: a 5 5/8"
   exposure, a 12" tab, a 2.67" corrugation pitch, a 16" pan. Working in
   the trade unit is what makes a 6 ft tile and a 24 ft tile the same roof
   at two distances rather than one roof and one blur.

   THE TILING RULE. The tile is square and covers rfTileIn inches each
   way. Every periodic thing in it — courses, tabs, pans, corrugations,
   panel laps, fastener rows — has its count SNAPPED to a whole number of
   repeats per tile (the way street.js snaps its dash cycles), and the
   real dimension is then derived back from the snapped count. So the
   exposure you get is rarely exactly the exposure you asked for, and the
   readout says so. Course stagger snaps too: a half-bond pattern forces
   an even course count, a third-bond a multiple of three, or the last
   course would land next to the first with the same offset and print a
   line across the wrap.

   Ids all start with "rf" and need-keys all start with "rf": these rows
   are merged into a panel that already carries the house shell's ids
   (size, seed, clad, fade, peel, streak, mildew, rust, grunge, aband,
   normalStr, aoStr, flipG …). size/seed/normalStr/aoStr/flipG come from
   the integrator and are read, never declared, here.

   NO READOUT ROW is declared on purpose. {type:"readout"} carries the
   fixed DOM id "readout" and the runtime fills exactly one of them, so a
   second one would collide with the shell's. envelope.js should keep its
   single readout row and route readout(P) here when the roof face is up.
   Groups carry ids (gRoof, gRoofWear, gRoofCol) so envelope.js can stamp
   its own face `need` onto them.

   PITCH FORESHORTENING is deliberately absent. This texture is the roof
   plane's own surface, unrolled; a plane is not foreshortened by its own
   slope, the camera does that when the plane is tilted into the scene. A
   squash along v would also make the tile cover fewer inches down-slope
   than across, which breaks the one-number scale contract and the whole-
   course snap with it. Set the mesh pitch instead; the readme repeats it.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      hashi=Forge.hashi,vnoise=Forge.vnoise,fbm=Forge.fbm,fbm2=Forge.fbm2,
      hex2rgb=Forge.hex2rgb,blurWrap=Forge.blurWrap;

const md=(a,n)=>((a%n)+n)%n;
const hexOr=(s,d)=>hex2rgb(/^#[0-9a-fA-F]{6}$/.test(s||"")?s:d);

/* Worley on a lattice that wraps at N — gravel ballast and tar patches are
   the only cell fields here, so it stays local rather than going in Forge. */
let W_f1=0,W_f2=0,W_cx=0,W_cy=0;
function worley(x,y,N,seed,jit){
  const xi=Math.floor(x),yi=Math.floor(y);
  let d1=1e9,d2=1e9,bx=0,by=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const cx=xi+dx,cy=yi+dy,wx=md(cx,N),wy=md(cy,N);
    const fx=cx+0.5+(hashi(wx,wy,seed)-0.5)*jit;
    const fy=cy+0.5+(hashi(wx,wy,seed+7717)-0.5)*jit;
    const ax=x-fx,ay=y-fy,d=ax*ax+ay*ay;
    if(d<d1){d2=d1;d1=d;bx=wx;by=wy;}else if(d<d2)d2=d;
  }
  W_f1=Math.sqrt(d1);W_f2=Math.sqrt(d2);W_cx=bx;W_cy=by;
}

/* ============================ material table ============================ */

const TYPES={
  tab3  :{label:"Three-tab asphalt",   coursed:1,pieces:1,asphalt:1},
  arch  :{label:"Architectural asphalt",coursed:1,pieces:1,asphalt:1},
  shake :{label:"Wood shake",          coursed:1,pieces:1,wood:1},
  slate :{label:"Slate",               coursed:1,pieces:1},
  barrel:{label:"Clay barrel tile",    coursed:1},
  seam  :{label:"Standing-seam metal", metal:1,panel:1},
  corr  :{label:"Corrugated metal",    metal:1,panel:1},
  rolled:{label:"Rolled / gravel ballast",panel:1}
};
const NEEDS={
  tab3  :["rfCourse","rfPiece","rfTab3","rfShingle","rfCurl","rfMiss","rfNailed"],
  arch  :["rfCourse","rfPiece","rfArch","rfShingle","rfCurl","rfMiss","rfNailed"],
  shake :["rfCourse","rfPiece","rfShake","rfCurl","rfMiss","rfNailed"],
  slate :["rfCourse","rfPiece","rfSlate","rfMiss","rfNailed"],
  barrel:["rfCourse","rfBarrel"],
  seam  :["rfSeam","rfMetal","rfPanel","rfLapPitch"],
  corr  :["rfCorr","rfMetal","rfPanel","rfLapPitch","rfNailed"],
  rolled:["rfRolled","rfLapPitch","rfNailed"]
};

/* ============================ snapped layout ============================
   One place derives every count, so the readout, the build and the readme
   cannot drift apart about how big a course actually is. */
function layout(P,S){
  const TI=clamp(+P.rfTileIn||96,6,1024);
  const L={TI:TI,S:S,IPX:TI/S,PXI:S/TI,type:P.rfType||"tab3"};
  const T=TYPES[L.type]||TYPES.tab3;

  /* course stagger has to divide the course count or the wrap shows a
     repeated joint line, so the bond period is folded into the snap */
  const per=(L.type==="barrel")?1:(P.rfAlign==="half"?2:(P.rfAlign==="third"?3:1));
  const eReq=clamp(+P.rfExposure||5.625,0.5,TI);
  L.nC=Math.max(per,Math.round(TI/eReq/per)*per);
  L.E=TI/L.nC;L.eReq=eReq;L.bond=per;

  const wReq=(L.type==="barrel")?clamp(+P.rfBarrelW||10.5,1,TI):clamp(+P.rfTabW||12,0.5,TI);
  L.nT=Math.max(1,Math.round(TI/wReq));L.TW=TI/L.nT;L.wReq=wReq;

  /* sheets must contain a whole number of pans / corrugations, so the fine
     pitch is snapped to the sheet and the sheet to the tile, in that order */
  const shReq=clamp(+P.rfPanW||16,1,TI);
  L.nS=Math.max(1,Math.round(TI/shReq));L.SW=TI/L.nS;L.shReq=shReq;
  if(L.type==="corr"){
    const cReq=clamp(+P.rfCorrPitch||2.67,0.25,TI);
    let nR=Math.max(1,Math.round(TI/cReq));
    L.nR=Math.max(L.nS,Math.round(nR/L.nS)*L.nS);   // whole corrugations per sheet
    L.CP=TI/L.nR;L.cReq=cReq;L.perSheet=L.nR/L.nS;
  }
  const lReq=clamp(+P.rfLapIn||96,4,TI*4);
  L.nL=Math.max(1,Math.round(TI/lReq));L.LP=TI/L.nL;L.lReq=lReq;
  L.nF=Math.max(1,Math.round(TI/24));L.FP=TI/L.nF;          // 24 in purlin/nail rows
  L.nN=Math.max(1,Math.round(TI/12));L.NP=TI/L.nN;          // 12 in nail spacing
  L.ribW=(L.type==="seam")?({snap:0.75,mech:0.45,batten:1.40}[P.rfRibProfile]||0.75):0;
  return L;
}

/* ============================ the generator ============================ */

function build(params,io){
  /* the runtime hands the LIVE parameter object and keeps mutating it while a
     chunked build is in flight, so nothing below may read `params` again */
  const Q=Object.assign({},params);
  const S=io.W,seed=Q.seed|0;
  const L=layout(Q,S);
  const TY=Q.rfType||"tab3",M=TYPES[TY]||TYPES.tab3;
  const TI=L.TI,IPX=L.IPX,PXI=L.PXI,nC=L.nC,E=L.E,nT=L.nT,TW=L.TW;
  const NST=Q.normalStr==null?1:+Q.normalStr, AOS=Q.aoStr==null?0.85:+Q.aoStr;

  /* a feature narrower than this cannot survive resampling, so it is faded
     out or widened rather than left to sparkle */
  const aaI=IPX*1.1;                                  // antialias width, inches
  const vis=inches=>smoothstep(1.1,2.4,inches*PXI);   // 0 = drop the grade

  const A=new Uint8ClampedArray(S*S*3);
  const RGH=new Uint8ClampedArray(S*S);
  const MET=new Uint8ClampedArray(S*S);
  const AOc=new Uint8ClampedArray(S*S);
  const NRM=new Uint8ClampedArray(S*S*3);
  const HGT=new Float32Array(S*S);

  const C1=hexOr(Q.rfCol1,"#5b5b56"),C2=hexOr(Q.rfCol2,"#3c3d3a"),CF=hexOr(Q.rfCol3,"#2b2825");
  const TONE=clamp(+Q.rfTone||0,0,1),REL=clamp(+Q.rfRelief||1,0.1,3);
  const RB=clamp(+Q.rfRough||0.85,0.03,1);
  const T0=clamp(+Q.rfThick||0.19,0.02,3);            // butt thickness, inches
  const ALIGN=Q.rfAlign||"half",EDGE=Q.rfEdge||"sawn";
  const VAR=clamp(+Q.rfTabVar||0,0,1);
  const w=(k)=>clamp(+Q[k]||0,0,1);
  const GRAN=w("rfGranule"),ALGAE=w("rfAlgae"),MOSS=w("rfMoss"),BLEACH=w("rfBleach"),
        CURL=w("rfCurl"),MISS=w("rfMissing"),PATCH=w("rfPatch"),NAIL=w("rfNail"),
        RUST=w("rfRust"),CHALK=w("rfChalk"),DIRT=w("rfDirt"),
        SLIP=(Q.rfType==="slate")?w("rfSlip"):0,
        OIL=w("rfOilCan"),FAST=w("rfFast"),GRAV=w("rfGravel"),LAMIN=w("rfLamin"),
        SPLIT=w("rfShakeSplit");

  /* ---------- broad weathering fields, precomputed small ----------
     Algae runs, moss patches, bleaching and the patch regions are all low
     frequency. Evaluating four fbms per texel at 4096² costs more than the
     roofing does, so they are baked once at DW and sampled bilinearly with
     wrap — the same trick street.js uses for its crack canvas. */
  const DW=Math.min(S,256);
  const WM=new Float32Array(DW*DW*4);
  (function(){
    const pA=Math.max(4,Math.round(TI/2.4)),pV=Math.max(2,Math.round(TI/34));
    const pM=Math.max(4,Math.round(TI/9)),pS=Math.max(3,Math.round(TI/30)),
          pP=Math.max(3,Math.round(TI/18));
    for(let y=0;y<DW;y++){
      const v=(y+0.5)/DW;
      for(let x=0;x<DW;x++){
        const u=(x+0.5)/DW,k=(y*DW+x)*4;
        /* streaks are fine across the slope and long down it, which is the
           whole reason fbm2 takes a period per axis */
        WM[k]  =ALGAE>0?fbm2(u,v,pA,pV,2,seed+2201):0;
        WM[k+1]=MOSS>0?fbm(u,v,pM,3,seed+2207):0;
        WM[k+2]=fbm(u,v,pS,3,seed+2213);
        WM[k+3]=PATCH>0?fbm(u,v,pP,3,seed+2221):0;
      }
    }
  })();
  function wm(u,v,ch){
    const x=u*DW-0.5,y=v*DW-0.5;
    const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
    const X0=md(x0,DW),X1=(X0+1)%DW,Y0=md(y0,DW),Y1=(Y0+1)%DW;
    const a=WM[(Y0*DW+X0)*4+ch],b=WM[(Y0*DW+X1)*4+ch];
    const c=WM[(Y1*DW+X0)*4+ch],d=WM[(Y1*DW+X1)*4+ch];
    return a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy;
  }

  /* ---------- course and piece layout ----------
     Course offsets and piece boundaries are hashed on the index MODULO the
     snapped count, so piece j and piece j+nT are the same piece one tile
     over. That is the whole of the seam guarantee in the u axis. */
  const AL=(TY==="barrel"||ALIGN==="straight")?0:(ALIGN==="half"?1:(ALIGN==="third"?2:3));
  function courseOff(k){
    if(AL===0)return 0;
    const kk=md(k,nC);
    if(AL===1)return (kk%2)*TW*0.5;
    if(AL===2)return (kk%3)*TW/3;
    return hashi(kk,777,seed+3301)*TW;
  }
  const JIT=TW*0.42*VAR*(TY==="shake"?1:(TY==="arch"?0.8:(TY==="slate"&&EDGE==="rag"?0.6:0.35)));
  const bnd=(j,k)=>j*TW+(hashi(md(j,nT),md(k,nC),seed+5501)-0.5)*JIT;

  let PJ=0,PD=0,PF=0,PWD=0;                          // piece index, edge dist, across, width
  function pieceAt(X,k){
    const o=courseOff(k);
    /* an untrimmed grid is the common case and does not need the neighbour
       scan, which is two hashes and five divisions per texel */
    if(JIT===0){
      const b=(X-o)/TW,j0=Math.floor(b),fr=b-j0;
      PJ=j0;PWD=TW;PF=fr;PD=(fr<0.5?fr:1-fr)*TW;return;
    }
    const b=(X-o)/TW,j0=Math.floor(b);
    let lo=-1e30,hi=1e30,jl=j0;
    for(let j=j0-2;j<=j0+2;j++){
      const bx=o+bnd(j,k);
      if(bx<=X){if(bx>lo){lo=bx;jl=j;}}
      else if(bx<hi)hi=bx;
    }
    PJ=jl;PWD=hi-lo;PF=(X-lo)/PWD;PD=Math.min(X-lo,hi-X);
  }

  /* how far a piece's own butt hangs off the nominal course line, in course
     fractions: split shakes are never trimmed, rag slates are never square,
     and a slipped slate has simply slid down the roof */
  const BJ=(TY==="shake"?0.26:(TY==="slate"?(EDGE==="rag"?0.14:0.03):(TY==="arch"?0.09:0)))*(0.35+VAR);
  function buttOf(j,k){
    let b=BJ>0?(hashi(md(j,nT),md(k,nC),seed+6301)-0.5)*2*BJ:0;
    if(SLIP>0&&hashi(md(j,nT),md(k,nC),seed+6607)<SLIP*0.10)
      b+=0.16+0.24*hashi(md(j,nT),md(k,nC),seed+6611);
    return clamp(b,-0.42,0.42);
  }
  /* per-piece thickness spread; a hand-split shake varies by half again */
  const TSP=(TY==="shake"?0.95:(TY==="slate"?0.22:(TY==="arch"?0.30:0.06)))*VAR;
  const thickOf=(j,k)=>T0*(1+(hashi(md(j,nT),md(k,nC),seed+6101)-0.5)*2*TSP);

  /* one lapped layer, unrolled. Each course rides one thickness over the one
     below and comes back level at its own head, so the profile is a sawtooth
     exactly one thickness deep with the step at the butt line — that step is
     what reads as a roof at a glance, so it is built in real inches. */
  const saw=(d,s)=>d+(1-s);

  /* ---------- per-type constants, resolved once ---------- */
  const KW=clamp(+Q.rfKeyway||0.25,0.02,4);            // three-tab keyway
  const KWH=Math.max(KW*0.5,aaI*0.6),KWD=vis(KW*1.4);  // widened, then faded by LOD
  const GAP=TY==="shake"?clamp(+Q.rfGap||0.25,0,2):0;
  const GAPH=Math.max(GAP*0.5,GAP>0?aaI*0.6:0);
  const BW=L.TW,WC=0.23;                               // barrel: pitch, cover half-width
  const BR=clamp(+Q.rfBarrelR||2.2,0.2,8);             // barrel rise
  const PW=L.SW,RH=clamp(+Q.rfRibH||1.5,0.1,6)*vis(L.ribW*2),RW=L.ribW;
  const PROF=Q.rfRibProfile||"snap";
  const CP=L.CP||1,CD=clamp(+Q.rfCorrDepth||0.5,0.02,4)*vis(CP*0.55);
  const TS=0.032;                                      // sheet metal thickness
  const RT=0.09;                                       // rolled roofing, two plies
  const GMM=clamp(+Q.rfGravelMm||10,2,40),GIN=GMM/25.4;
  const NG=Math.max(4,Math.round(TI/(GIN*1.55))),GVIS=vis(GIN*1.1);
  const FELT=[CF[0],CF[1],CF[2]];
  const METK=M.metal?clamp(Q.rfMetallic==null?0.9:+Q.rfMetallic,0,1):1;
  const RELIEF=M.coursed?(TY==="barrel"?BR:T0*1.6):(TY==="seam"?RH:(TY==="corr"?CD:RT+GIN*GRAV));

  /* noise periods and LOD gates are pure functions of the tile, so they are
     resolved once here rather than a few million times in the inner loop */
  const P_LAMU=Math.max(4,Math.round(TI/3)),P_LAMV=Math.max(2,Math.round(TI/9)),
        P_GRAIN=Math.max(4,Math.round(TI/0.16)),P_GRAINV=Math.max(3,Math.round(TI/9)),
        P_OILU=Math.max(4,Math.round(TI/9)),P_OILV=Math.max(2,Math.round(TI/30)),
        P_MOTU=Math.max(4,Math.round(TI/2.5)),P_MOTV=Math.max(3,Math.round(TI/14)),
        P_FELU=Math.max(4,Math.round(TI/1.6)),P_FELV=Math.max(4,Math.round(TI/2.2)),
        P_CLU=Math.max(4,Math.round(TI/1.1)),P_CLV=Math.max(4,Math.round(TI/1.6)),
        P_SPK=Math.max(8,Math.round(TI/0.055)),
        P_ALGU=Math.max(6,Math.round(TI/1.3)),P_ALGV=Math.max(3,Math.round(TI/16)),
        P_MOSS=Math.max(6,Math.round(TI/0.30)),
        P_PAT=Math.max(6,Math.round(TI/2.2)),
        P_RSTU=Math.max(6,Math.round(TI/1.8)),P_RSTV=Math.max(2,Math.round(TI/40)),
        P_ROLL=Math.max(1,Math.round(TI/34));
  const V_GRAIN=vis(0.16),V_SPK=vis(0.055),V_MOSS=vis(0.30),V_SCALE=vis(0.2),
        V_BEAD=vis(1.2),V_GAP=GAP>0?vis(GAP*1.4):0,V_HEAD=vis(0.32),V_WASH=vis(1.1);
  const LAPW=Math.min(6,L.LP*0.28),LAPR=Math.min(1.2,LAPW*0.5);
  const lapBand=dl=>smoothstep(-LAPW-LAPR,-LAPW+LAPR*0.25,dl)*(1-smoothstep(-aaI,aaI,dl));
  const PATAA=Math.max(0.02,aaI/TI*8+0.02);
  const LAPD=Math.max(0.5,aaI*2),LAPD2=Math.max(0.6,aaI*2),LAPD3=Math.max(0.9,aaI*2);
  const SHELD=Math.max(0.35,aaI*1.5),BUTD=Math.max(0.6,aaI*2),JOIND=Math.max(aaI*1.2,0.02),
        SIDED=Math.max(aaI*1.2,0.03),FELD=Math.max(aaI*1.5,0.10);

  const band=Math.max(2,Math.round(32768/S));
  let y=0;

  function pass1(){
    const end=Math.min(S,y+band);
    for(;y<end;y++){
      const v=(y+0.5)/S,t=v*TI;
      /* The butt lines depend on v alone, so the course frame is hoisted. The
         half-course phase shift puts the tile edge in the MIDDLE of a course
         rather than on a butt line: with only one course or one panel in the
         tile the single joint would otherwise land exactly on the wrap and be
         the one discontinuity with no interior twin. */
      const m0=t/E+0.5,mi=Math.round(m0),d0=m0-mi,kUp=mi-1;
      const tl=t/L.LP+0.5,mli=Math.round(tl),dl=(tl-mli)*L.LP;   // panel end lap
      const aaC=Math.min(0.35,Math.max(aaI/E,1e-4));

      for(let x=0;x<S;x++){
        const u=(x+0.5)/S,i=y*S+x,X=u*TI;
        let h=0,cr=C1[0],cg=C1[1],cb=C1[2],rough=RB,met=0,aoB=1;
        let f=0,shel=0,expo=1,edge=0,felt=0,prot=0,k=0,pj=0,tint=1,Tloc=T0;

        if(M.coursed){
          /* --- which side of the butt line, and whose butt is it --- */
          let d=d0;
          if(BJ>0||SLIP>0){pieceAt(X,kUp);d-=buttOf(PJ,kUp);}
          const s=smoothstep(-aaC,aaC,d);
          k=d<0?kUp:kUp+1;
          f=d<0?1+d:d;                                 // 0 at the head lap, 1 at the butt
          shel=1-smoothstep(0,SHELD,f*E);   // under the butt above
          expo=f;

          if(TY==="barrel"){
            /* pan and cover: the cover is a half-round sitting on the raised
               edges of the pan, and the near-vertical wall where they meet is
               the deep shadow that makes mission tile read at any distance */
            const q=u*L.nT,p=q-Math.floor(q),dp=p<0.5?p:p-1;
            const tt=0.5;                              // tile body thickness
            /* a mission cover is tapered: wide at its butt, narrow where it
               tucks under the tile above. That taper is the scallop you read
               a tiled roof by from the ground. */
            const wc=WC*(0.84+0.20*f);
            if(Math.abs(dp)<wc){
              const c=Math.sqrt(Math.max(0,1-(dp/wc)*(dp/wc)));
              h=tt+BR*0.32+BR*c;
              rough=RB*0.94;
              aoB*=lerp(0.5,1,c);                      // the flanks stay dark
              pj=Math.round(q);edge=1-c;
            }else{
              const sp=(Math.abs(dp)-wc)/(0.5-wc);
              h=tt+BR*0.32*(1-sp)*(1-sp);
              rough=RB;
              aoB*=lerp(0.38,1,smoothstep(0,0.26,sp)); // shadow channel beside the cover
              pj=Math.floor(q)+9871;
            }
            h+=saw(d,s)*BR*0.30;                       // head lap step, course to course
            aoB*=lerp(0.28,1,smoothstep(0,Math.max(1.4,aaI*2),f*E));
          }else{
            pieceAt(X,k);pj=md(PJ,nT);
            const T=thickOf(PJ,k);Tloc=T;
            /* the body lies flat and the lift is concentrated at the butt,
               where the piece is unsupported and rides the whole stack */
            const sw=saw(d,s);
            h=T*(0.28+0.72*sw*sw*sw);
            aoB*=lerp(0.42,1,1-shel);                  // the shadow line under the butt

            /* --- keyways, gaps and piece edges --- */
            if(TY==="tab3"&&KWD>0){
              const key=(1-smoothstep(KWH-aaI*0.5,KWH+aaI*0.5,PD))*KWD;
              if(key>0){h-=T*0.92*key;aoB*=lerp(1,0.34,key);edge=Math.max(edge,key);
                        rough=lerp(rough,0.95,key*0.5);}
            }else if(GAP>0){
              const gp=(1-smoothstep(GAPH-aaI*0.5,GAPH+aaI*0.5,PD))*V_GAP;
              if(gp>0){h-=T*1.05*gp;aoB*=lerp(1,0.28,gp);edge=Math.max(edge,gp);}
            }else{
              /* even a butted joint is a dark hairline once it is a texel wide */
              const je=1-smoothstep(0,JOIND,PD);
              aoB*=lerp(1,0.6,je);edge=Math.max(edge,je*0.7);
            }

            /* --- architectural laminate: a second layer glued over the butt
                   half, its top edge ragged and different on every tab --- */
            if(TY==="arch"&&LAMIN>0){
              const fl=0.30+0.34*hashi(pj,md(k,nC),seed+4111)
                      +(fbm2(u,v,P_LAMU,P_LAMV,2,seed+4117)-0.5)*0.10;
              const lam=smoothstep(fl-aaC*1.5,fl+aaC*1.5,f);
              h+=T*0.60*lam*LAMIN;
              const dropped=(1-lam)*smoothstep(fl-0.16,fl,f);
              aoB*=lerp(1,0.52,dropped*LAMIN);         // the dropped shadow band
              rough=lerp(rough,rough*1.04,lam);
            }

            /* --- shake: split faces run with the grain, and a shake cups
                   across its width because the sap side dries faster --- */
            if(TY==="shake"){
              if(SPLIT>0){
                const gr=P_GRAIN,gv=V_GRAIN;
                if(gv>0){
                  const sp=fbm2(u,v,gr,P_GRAINV,2,seed+4201+pj*13)-0.5;
                  h+=sp*T*0.55*SPLIT*gv;
                  rough=lerp(rough,0.96,SPLIT*0.4);
                  tint*=1+sp*0.5*SPLIT;
                }
              }
              const across=(PF-0.5)*2;
              h+=T*0.5*across*across*clamp(CURL+0.25,0,1)*f;
            }
          }
          /* piece-to-piece tone: slate does it hardest, a strip shingle least */
          const kk=md(k,nC);
          const tv=(hashi(pj*131+kk,kk*17+7,seed+8101)-0.5)*2*TONE
                   *(TY==="slate"?1:(TY==="shake"?0.8:0.45));
          const mix=clamp(0.5+tv,0,1);
          cr=lerp(C1[0],C2[0],mix);cg=lerp(C1[1],C2[1],mix);cb=lerp(C1[2],C2[2],mix);
          if(TY==="barrel")tint*=0.94+0.12*hashi(pj*131+kk,kk*17+3,seed+8123);
          cr*=tint;cg*=tint;cb*=tint;
        }

        else if(TY==="seam"){
          /* ribs stand at every pan boundary; the pan between them is stiff
             at the ribs and loose in the middle, which is where oil-canning
             lives — never at the seam itself */
          const q=u*L.nS,p=q-Math.floor(q),dR=Math.min(p,1-p)*PW;
          met=1;rough=RB;
          /* coil stock never matches batch to batch, so panels differ slightly */
          const pv=clamp(0.5+(hashi(md(Math.floor(q),L.nS),0,seed+8201)-0.5)*2*TONE*0.5,0,1);
          cr=lerp(C1[0],C2[0],pv);cg=lerp(C1[1],C2[1],pv);cb=lerp(C1[2],C2[2],pv);
          if(dR<RW){
            if(PROF==="snap"){
              h=RH*0.5*(1+Math.cos(Math.PI*clamp(dR/RW,0,1)));
            }else if(PROF==="mech"){
              /* double lock: vertical sides, a flat top and the fold line */
              h=RH*(1-smoothstep(RW-aaI,RW+aaI,dR));
              h-=RH*0.16*(1-smoothstep(RW*0.30-aaI,RW*0.30+aaI,Math.abs(dR-RW*0.42)));
            }else{
              h=RH*(1-smoothstep(RW-aaI,RW+aaI,dR))
                 *(0.86+0.14*Math.cos(Math.PI*clamp(dR/RW,0,1)));
            }
            const cl=1-smoothstep(RW*0.5,RW,dR);
            rough=lerp(rough,rough*0.86,cl);           // the fold is burnished
            aoB*=lerp(0.5,1,smoothstep(0,RW*0.9,dR));
            edge=1-smoothstep(RW*0.6,RW*1.05,dR);
          }else{
            aoB*=lerp(0.62,1,smoothstep(RW,RW+PW*0.10,dR));
            if(OIL>0){
              const oc=(fbm2(u,v,P_OILU,P_OILV,3,seed+4301)-0.5);
              h+=oc*0.085*OIL*smoothstep(RW,PW*0.30,dR);
            }
          }
          h+=TS*lapBand(dl);
          const lp=1-smoothstep(0,LAPD,Math.abs(dl));
          aoB*=lerp(1,0.55,lp);edge=Math.max(edge,lp*0.8);
          shel=lp;expo=1-lp*0.5;
          pj=Math.floor(q)|0;k=mli;
        }
        else if(TY==="corr"){
          /* a true sinusoid, snapped to a whole number of corrugations per
             sheet and whole sheets per tile, so both laps land on a crest */
          const ang=u*L.nR*Math.PI*2;
          h=CD*0.5*(1-Math.cos(ang));
          met=1;rough=RB;
          const pv=clamp(0.5+(hashi(md(Math.floor(u*L.nS),L.nS),0,seed+8207)-0.5)*2*TONE*0.5,0,1);
          cr=lerp(C1[0],C2[0],pv);cg=lerp(C1[1],C2[1],pv);cb=lerp(C1[2],C2[2],pv);
          const crest=0.5+0.5*Math.cos(ang);           // 1 on the crest, 0 in the valley
          aoB*=lerp(0.58,1,crest);
          /* side lap: the upper sheet rides one thickness over one whole
             corrugation of the lower one */
          const q=u*L.nS,p=q-Math.floor(q),dS=Math.min(p,1-p)*L.SW;
          const sl=1-smoothstep(CP*0.5,CP*1.0,dS);
          h+=TS*sl;
          const se=1-smoothstep(0,SIDED,Math.abs(dS-CP*0.5));
          aoB*=lerp(1,0.55,se);edge=Math.max(edge,se);
          h+=TS*lapBand(dl);
          const lp=1-smoothstep(0,LAPD2,Math.abs(dl));
          aoB*=lerp(1,0.6,lp);shel=Math.max(lp,1-crest);expo=crest;
          /* fasteners: through the crest, on the purlin lines */
          if(FAST>0){
            const nx=Math.round(u*L.nR),nyr=Math.round(v*L.nF);
            const fx=(nx/L.nR-u)*TI,fy=(nyr/L.nF-v)*TI;
            const on=(md(nx,2)===0)?1:0;
            if(on&&FAST>0.02){
              const dF=Math.sqrt(fx*fx+fy*fy);
              const wsh=0.55,wv=V_WASH;
              const dome=(1-smoothstep(wsh*0.55,wsh,dF))*wv*FAST;
              if(dome>0){
                h+=0.14*dome;met=lerp(met,1,dome);
                rough=lerp(rough,0.55,dome);
                const dk=lerp(1,0.82,dome);cr*=dk;cg*=dk;cb*=dk;
                aoB*=lerp(1,0.8,(1-smoothstep(wsh,wsh*1.5,dF))*wv);
              }
            }
          }
          pj=Math.floor(q)|0;k=mli;
        }
        else if(TY==="rolled"){
          /* wide sheets run across the slope and lap; the seam is torched, so
             it sits proud and glossy where the bitumen ran */
          h=RT*0.5+RT*0.5*lapBand(dl);          // one ply, two through the lap
          const lp=1-smoothstep(0,LAPD3,Math.abs(dl));
          const bead=(1-smoothstep(0.3,0.75,Math.abs(dl)))*V_BEAD;
          h+=0.05*bead;
          rough=lerp(RB,0.30,bead*0.8);                // the torched bead is shiny
          aoB*=lerp(1,0.72,lp*(1-bead));
          shel=lp;expo=1-lp*0.4;edge=bead;
          const mo=fbm2(u,v,P_MOTU,P_MOTV,3,seed+4401);
          const mk=0.86+0.28*mo;cr=C1[0]*mk;cg=C1[1]*mk;cb=C1[2]*mk;
          h+=(mo-0.5)*0.02;
          /* ballast: loose stone spread over the cap sheet, dropped whole
             once a stone is under a couple of texels rather than left to boil */
          if(GRAV>0&&GVIS>0){
            worley(u*NG,v*NG,NG,seed+4411,0.95);
            const id=hashi(W_cx,W_cy,seed+4417);
            if(id<GRAV*0.92){
              const rad=0.26+0.20*hashi(W_cx,W_cy,seed+4423);
              const aa=Math.max(NG*IPX/TI,0)/Math.max(rad,1e-6);
              const gm=(1-smoothstep(rad*0.72,rad*1.0+aa,W_f1))*GVIS;
              if(gm>0){
                const cap=Math.sqrt(Math.max(0,1-Math.min(W_f1/rad,1)*Math.min(W_f1/rad,1)));
                h+=GIN*0.55*gm*(0.35+0.65*cap);
                const tn=0.55+0.55*hashi(W_cx,W_cy,seed+4431);
                cr=lerp(cr,168*tn,gm);cg=lerp(cg,160*tn,gm);cb=lerp(cb,146*tn,gm);
                rough=lerp(rough,0.96,gm);
                expo=lerp(expo,1,gm);shel=shel*(1-gm*0.6);
              }
            }
          }
          pj=0;k=mli;
        }

        /* ================= weathering =================
           A clean roof is useless. Each pass below names the channels it
           moves, because a stain that only touches base colour reads as a
           decal and a stain that only touches height reads as a dent. */

        /* --- missing pieces: the tab is gone. One hash picks the tab, a
               tighter slice of the same hash strips it all the way to the
               felt. Moves A, HGT, RGH, AO — and kills the weathering above,
               because what is exposed was never up there. --- */
        if(MISS>0&&M.pieces&&nT>0){
          const mh=hashi(pj,md(k,nC),seed+9001);
          if(mh<MISS*0.24){
            const deep=mh<MISS*0.075?1:0;
            h-=Tloc*0.95;                                 // the whole piece, not its edge
            if(deep){
              felt=1;
              const fg=fbm2(u,v,P_FELU,P_FELV,3,seed+9007);
              cr=FELT[0]*(0.82+0.36*fg);cg=FELT[1]*(0.82+0.36*fg);cb=FELT[2]*(0.82+0.36*fg);
              h-=Tloc*0.35;rough=0.96;
              /* the felt is rolled across the slope; its own laps still show */
              const nR2=P_ROLL,pr=v*nR2-Math.floor(v*nR2);
              const rl=1-smoothstep(0,FELD,Math.min(pr,1-pr)*(TI/nR2));
              h+=0.03*rl;
            }else{
              prot=1;                                   // covered, so barely weathered
              const bright=1.16;cr*=bright;cg*=bright;cb*=bright;
              rough=lerp(rough,rough*0.95,0.5);
            }
            aoB*=deep?0.55:0.72;
            expo*=0.25;shel=Math.max(shel,0.5);
          }
        }

        /* --- granule loss: the mineral surfacing wears off the exposed half
               of every tab first. Moves A (down to the asphalt), RGH (the
               bare bitumen is glossier), HGT (the granule bed is ~0.03 in). --- */
        if(GRAN>0&&M.asphalt&&!felt){
          const cl=fbm2(u,v,P_CLU,P_CLV,3,seed+9101);
          const bias=0.30+0.70*expo;                    // butts bald first
          const loss=clamp(smoothstep(0.62-GRAN*0.42,0.92-GRAN*0.30,cl*bias+GRAN*0.20),0,1)*GRAN*(1-prot*0.8);
          if(loss>0){
            h-=0.030*loss;
            cr=lerp(cr,cr*0.42+16,loss);cg=lerp(cg,cg*0.42+14,loss);cb=lerp(cb,cb*0.44+14,loss);
            rough=lerp(rough,0.52,loss*0.85);
          }
          /* the granules themselves, dropped whole below two texels rather
             than left to alias into a grey mush */
          const gv=V_SPK;
          if(gv>0){
            const sp=vnoise(u*P_SPK,v*P_SPK,P_SPK,seed+9111)-0.5;
            const amp=(1-loss)*gv;
            cr+=sp*30*amp;cg+=sp*29*amp;cb+=sp*27*amp;
            h+=sp*0.012*amp;
            rough=lerp(rough,0.93,amp*0.4);
          }
        }

        /* --- sun bleaching: south-facing roofs chalk out. Broad, low
               frequency, strongest where nothing shades it. Moves A, RGH. --- */
        if(BLEACH>0&&!felt){
          const sun=wm(u,v,2);
          const bl=clamp((sun*0.75+0.25)*BLEACH*(0.35+0.65*expo)*(1-prot*0.9),0,0.9);
          cr=lerp(cr,Math.min(255,cr*0.78+74),bl*0.6);
          cg=lerp(cg,Math.min(255,cg*0.79+74),bl*0.6);
          cb=lerp(cb,Math.min(255,cb*0.80+72),bl*0.55);
          rough=lerp(rough,0.94,bl*0.45);
        }

        /* --- algae: gloeocapsa runs DOWN-slope in long dark streaks that
               start under a shaded lap and never cross one. Moves A, RGH. --- */
        if(ALGAE>0&&!felt){
          const run=wm(u,v,0);
          const fine=fbm2(u,v,P_ALGU,P_ALGV,2,seed+9201);
          const st=clamp(smoothstep(0.50-ALGAE*0.24,0.80-ALGAE*0.16,run*0.78+fine*0.30),0,1)
                   *ALGAE*(1-prot*0.7);
          if(st>0){
            const w2=st*0.85;
            cr=lerp(cr,cr*0.42+10,w2);cg=lerp(cg,cg*0.46+16,w2);cb=lerp(cb,cb*0.44+15,w2);
            rough=lerp(rough,0.95,st*0.6);
          }
        }

        /* --- moss and lichen: they need the water that sits in the lap, so
               they grow in the shadow under a butt and in the keyways, not
               out on the exposed face. Moves A, HGT, RGH, AO. --- */
        if(MOSS>0&&!felt){
          const damp=clamp(shel*0.85+edge*0.55+(1-expo)*0.35,0,1);
          const patch=wm(u,v,1);
          const mo=clamp(smoothstep(0.55-MOSS*0.30,0.82-MOSS*0.22,patch*(0.45+0.85*damp)),0,1)*MOSS;
          if(mo>0){
            const fz=V_MOSS*fbm2(u,v,P_MOSS,P_MOSS,2,seed+9301);
            h+=(0.075+0.05*fz)*mo;
            cr=lerp(cr,58+22*fz,mo);cg=lerp(cg,74+26*fz,mo);cb=lerp(cb,38+16*fz,mo);
            rough=lerp(rough,0.99,mo);
            met=lerp(met,0,mo);                          // nothing metallic grows
            aoB*=lerp(1,0.82,mo);
          }
        }

        /* --- dirt in the laps: the grit that washes down and stops at the
               first thing in its way. Moves A, RGH, AO. --- */
        if(DIRT>0){
          const g=wm(u,v,2);
          const dv=clamp((shel*0.8+edge*0.7+(1-expo)*0.30+g*0.35-0.15)*DIRT,0,0.9);
          const warm=0.94+g*0.14;
          cr=cr*lerp(1,0.52*warm,dv)+dv*6;
          cg=cg*lerp(1,0.53,dv)+dv*6;
          cb=cb*lerp(1,0.50/warm,dv)+dv*5;
          rough=lerp(rough,0.95,dv*0.7);
          aoB*=lerp(1,0.9,dv);
        }

        /* --- cupping and curl: the butt corners of an old asphalt or wood
               course lift clear of the deck. Pure geometry, so it moves HGT
               (and through it NRM and AO) and nothing else. --- */
        if(CURL>0&&M.pieces&&TY!=="slate"&&!felt){
          const corner=Math.abs(PF-0.5)*2;
          const lift=CURL*Tloc*2.6*Math.pow(clamp(f,0,1),2.4)*(0.35+0.65*corner*corner);
          h+=lift;
          aoB*=lerp(1,0.86,clamp(lift/(Tloc*2),0,1));
        }

        /* --- nail pops: a nail backs out and tents the course above it,
               just up-slope of its butt. Moves HGT, A, MET, RGH. --- */
        if(NAIL>0&&M.pieces){
          const nx=Math.round(u*L.nN),ny=md(k,nC);
          const jx=(hashi(md(nx,L.nN),ny,seed+9401)-0.5)*L.NP*0.30;
          const px=md((nx/L.nN)*TI+jx,TI);
          const py=md((md(k,nC)+0.38)*E,TI);             // just up-slope of the butt,
                                                        // in the same shifted frame
          let dx=Math.abs(X-px);if(dx>TI*0.5)dx=TI-dx;
          let dy=Math.abs(t-py);if(dy>TI*0.5)dy=TI-dy;
          const dN=Math.sqrt(dx*dx+dy*dy);
          if(hashi(md(nx,L.nN),ny,seed+9407)<NAIL*0.22){
            const rad=1.1,head=0.16,nv=V_HEAD;
            const tent=(1-smoothstep(rad*0.25,rad,dN))*NAIL;
            h+=0.14*tent;
            const hd=(1-smoothstep(head*0.7,head,dN))*nv;
            if(hd>0){
              met=lerp(met,1,hd);rough=lerp(rough,0.45,hd);
              cr=lerp(cr,150,hd);cg=lerp(cg,146,hd);cb=lerp(cb,142,hd);
              h+=0.05*hd;
            }
            const ring=(1-smoothstep(head,head*3.4,dN))*(1-hd)*nv*NAIL;
            cr=lerp(cr,116,ring*0.6);cg=lerp(cg,64,ring*0.6);cb=lerp(cb,34,ring*0.6);
            rough=lerp(rough,0.96,ring*0.5);
          }
        }

        /* --- tar patches: roofing cement troweled over whatever leaked.
               Sits proud, dries matte-black, never has a straight edge.
               Moves A, HGT, RGH, MET (down, it buries fasteners). --- */
        if(PATCH>0){
          const reg=wm(u,v,3);
          const fine=fbm2(u,v,P_PAT,P_PAT,3,seed+9501);
          const bias=reg*0.72+fine*0.34+edge*0.16+felt*0.25;
          const thr=1.02-PATCH*0.40;
          const pa=smoothstep(thr,thr+PATAA,bias);
          if(pa>0){
            h+=0.055*pa;
            cr=lerp(cr,30,pa);cg=lerp(cg,28,pa);cb=lerp(cb,27,pa);
            rough=lerp(rough,0.42,pa);
            met=lerp(met,0,pa);
            aoB*=lerp(1,0.93,pa);
          }
        }

        /* --- rust bleed: metal roofs rust at the fasteners and the cut
               edges, then bleed down-slope. Moves A, RGH, MET (down — rust
               is an oxide, not a conductor), HGT (the scale lifts). --- */
        if(RUST>0&&M.metal){
          const src=clamp(edge*0.8+shel*0.55,0,1);
          const run=fbm2(u,v,P_RSTU,P_RSTV,3,seed+9601);
          const ru=clamp(smoothstep(0.56-RUST*0.28,0.86-RUST*0.20,run*(0.35+0.9*src)+RUST*0.10),0,1)*RUST;
          if(ru>0){
            cr=lerp(cr,126,ru);cg=lerp(cg,63,ru);cb=lerp(cb,33,ru);
            rough=lerp(rough,0.95,ru);
            met=lerp(met,0.05,ru*0.9);
            h+=0.012*ru*V_SCALE;
          }
        }

        /* --- chalking: the resin binder in the paint breaks down and the
               pigment powders. Lightens, flattens, kills the sheen.
               Moves A, RGH, MET (down). --- */
        if(CHALK>0&&M.metal){
          const ch=clamp(wm(u,v,2)*CHALK*(0.4+0.6*expo),0,0.9);
          cr=lerp(cr,Math.min(255,cr*0.72+82),ch*0.7);
          cg=lerp(cg,Math.min(255,cg*0.72+82),ch*0.7);
          cb=lerp(cb,Math.min(255,cb*0.73+80),ch*0.7);
          rough=lerp(rough,0.9,ch*0.8);
          met=lerp(met,met*0.35,ch*0.8);
        }

        HGT[i]=h*REL;
        A[i*3]=cr;A[i*3+1]=cg;A[i*3+2]=cb;
        RGH[i]=clamp(rough,0.03,1)*255;
        MET[i]=clamp(met*METK,0,1)*255;
        AOc[i]=clamp(aoB,0,1)*255;
      }
    }
    if(y<S){io.progress(y/S*0.68);setTimeout(pass1,0);}
    else{io.progress(0.72);setTimeout(pass2,0);}
  }

  function pass2(){
    /* AO from the height field against two wrapped blurs: the tight one
       finds the butt line and the keyway, the wide one finds the dish of a
       cupped course and the trough of a corrugation */
    const r1=clamp(Math.round(0.16*PXI),1,12),r2=clamp(Math.round(1.3*PXI),3,64);
    const b1=blurWrap(HGT,S,r1),b2=blurWrap(HGT,S,r2);
    const sc=1/Math.max(1e-6,RELIEF*REL*0.85);
    for(let i=0;i<S*S;i++){
      const c1=clamp((b1[i]-HGT[i])*sc*2.1,0,1);
      const c2=clamp((b2[i]-HGT[i])*sc*1.5,0,1);
      const occ=clamp(c1*0.6+c2*0.8,0,1)*AOS;
      AOc[i]=clamp((AOc[i]/255)*(1-occ),0,1)*255;
    }
    io.progress(0.86);

    let hMin=Infinity,hMax=-Infinity;
    for(let i=0;i<S*S;i++){const hh=HGT[i];if(hh<hMin)hMin=hh;if(hh>hMax)hMax=hh;}
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;

    /* heights are inches, so the slope is a real slope: an eighth-inch butt
       over a tenth-inch texel is a genuinely near-vertical face and the
       normal map says so */
    const gy=Q.flipG?-1:1,inPerTexel=TI/S;
    for(let yy=0;yy<S;yy++){
      const yp=((yy+1)%S)*S,ym=((yy-1+S)%S)*S,y0=yy*S;
      for(let xx=0;xx<S;xx++){
        const xp=(xx+1)%S,xm=(xx-1+S)%S;
        const sx=(HGT[y0+xp]-HGT[y0+xm])/(2*inPerTexel)*NST;
        const sy=(HGT[yp+xx]-HGT[ym+xx])/(2*inPerTexel)*NST;
        let nx=-sx,ny=-sy*gy;
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;
        const j=(y0+xx)*3;
        NRM[j]=(nx*0.5+0.5)*255;NRM[j+1]=(ny*0.5+0.5)*255;NRM[j+2]=(inv*0.5+0.5)*255;
      }
    }
    io.progress(1);
    io.done({A:A,RGH:RGH,MET:MET,AO:AOc,NRM:NRM,HGT:HGT,hMin:hMin,hMax:hMax});
  }

  io.progress(0.02);
  setTimeout(pass1,0);
}

/* ============================ the published shape ============================ */

const CONTROLS=[
  {title:"Roofing",id:"gRoof",open:true,rows:[
    {id:"rfType",type:"select",label:"Material",value:"tab3",options:[
      ["tab3","Three-tab asphalt shingle"],["arch","Architectural / dimensional"],
      ["shake","Wood shake"],["slate","Slate"],["barrel","Clay barrel tile (mission)"],
      ["seam","Standing-seam metal"],["corr","Corrugated metal"],
      ["rolled","Rolled / flat with gravel"]]},
    {id:"rfTileIn",label:"Tile covers",unit:"in",min:12,max:288,step:6,value:96},
    {type:"note",html:"Everything is laid out in <b>real inches</b> and the counts are snapped so a "+
      "whole number of courses and tabs fits the tile — the exposure you get is the one in the "+
      "readout, not always the one you asked for. There is deliberately <b>no pitch control</b>: "+
      "this is the roof plane's own surface, and a plane is not foreshortened by its own slope. "+
      "Pitch the mesh instead."},
    {id:"rfExposure",need:"rfCourse",label:"Exposure to weather",unit:"in",min:1,max:24,step:0.125,value:5.625},
    {id:"rfAlign",need:"rfCourse",type:"select",label:"Course offset",value:"half",options:[
      ["half","Half bond — joints at mid-tab"],["third","Third bond"],
      ["straight","Straight — joints aligned"],["random","Random per course"]]},
    {id:"rfThick",need:"rfCourse",label:"Butt thickness",unit:"in",min:0.03,max:1.5,step:0.01,value:0.19},
    {id:"rfTabW",need:"rfPiece",label:"Tab / piece width",unit:"in",min:2,max:36,step:0.25,value:12},
    {id:"rfTabVar",need:"rfPiece",label:"Width & thickness spread",min:0,max:1,step:0.01,value:0.3},
    {id:"rfKeyway",need:"rfTab3",label:"Keyway width",unit:"in",min:0.06,max:1.5,step:0.02,value:0.25},
    {id:"rfLamin",need:"rfArch",label:"Laminate layer",min:0,max:1,step:0.01,value:0.8},
    {id:"rfShakeSplit",need:"rfShake",label:"Split face",min:0,max:1,step:0.01,value:0.7},
    {id:"rfGap",need:"rfShake",label:"Gap between shakes",unit:"in",min:0,max:1,step:0.02,value:0.25},
    {id:"rfEdge",need:"rfSlate",type:"select",label:"Slate edge",value:"sawn",options:[
      ["sawn","Sawn — square and true"],["rag","Rag — split and uneven"]]},
    {id:"rfSlip",need:"rfSlate",label:"Slipped slates",min:0,max:1,step:0.01,value:0.2},
    {id:"rfBarrelW",need:"rfBarrel",label:"Cover pitch",unit:"in",min:5,max:20,step:0.25,value:10.5},
    {id:"rfBarrelR",need:"rfBarrel",label:"Barrel rise",unit:"in",min:0.5,max:6,step:0.1,value:2.2},
    {id:"rfPanW",need:"rfPanel",label:"Pan / sheet cover",unit:"in",min:4,max:48,step:0.5,value:16},
    {id:"rfRibProfile",need:"rfSeam",type:"select",label:"Rib profile",value:"snap",options:[
      ["snap","Snap-lock — rounded"],["mech","Double-lock — square"],["batten","Batten cap"]]},
    {id:"rfRibH",need:"rfSeam",label:"Rib height",unit:"in",min:0.25,max:3,step:0.05,value:1.5},
    {id:"rfCorrPitch",need:"rfCorr",label:"Corrugation pitch",unit:"in",min:0.75,max:8,step:0.05,value:2.67},
    {id:"rfCorrDepth",need:"rfCorr",label:"Corrugation depth",unit:"in",min:0.05,max:2,step:0.01,value:0.5},
    {id:"rfFast",need:"rfCorr",label:"Fastener washers",min:0,max:1,step:0.01,value:0.6},
    {id:"rfOilCan",need:"rfMetal",label:"Oil canning",min:0,max:1,step:0.01,value:0.4},
    {id:"rfLapIn",need:"rfLapPitch",label:"Panel length / sheet run",unit:"in",min:12,max:240,step:6,value:96},
    {id:"rfGravel",need:"rfRolled",label:"Gravel ballast",min:0,max:1,step:0.01,value:0.6},
    {id:"rfGravelMm",need:"rfRolled",label:"Gravel size",unit:"mm",min:3,max:30,step:1,value:10}
  ]},
  {title:"Roof weathering",id:"gRoofWear",open:true,rows:[
    {id:"rfGranule",need:"rfShingle",label:"Granule loss",min:0,max:1,step:0.01,value:0.35},
    {id:"rfAlgae",label:"Algae streaking",min:0,max:1,step:0.01,value:0.4},
    {id:"rfMoss",label:"Moss & lichen",min:0,max:1,step:0.01,value:0.3},
    {id:"rfBleach",label:"Sun bleaching",min:0,max:1,step:0.01,value:0.35},
    {id:"rfCurl",need:"rfCurl",label:"Cupping & curl",min:0,max:1,step:0.01,value:0.3},
    {id:"rfMissing",need:"rfMiss",label:"Missing tabs",min:0,max:1,step:0.01,value:0.15},
    {id:"rfPatch",label:"Tar patches",min:0,max:1,step:0.01,value:0.2},
    {id:"rfNail",need:"rfNailed",label:"Nail pops",min:0,max:1,step:0.01,value:0.25},
    {id:"rfRust",need:"rfMetal",label:"Rust bleed",min:0,max:1,step:0.01,value:0.35},
    {id:"rfChalk",need:"rfMetal",label:"Chalking",min:0,max:1,step:0.01,value:0.35},
    {id:"rfDirt",label:"Dirt in the laps",min:0,max:1,step:0.01,value:0.45}
  ]},
  {title:"Roof colour & relief",id:"gRoofCol",rows:[
    {type:"colors",label:"Roofing · second tone · felt below",items:[
      {id:"rfCol1",value:"#5b5b56"},{id:"rfCol2",value:"#3c3d3a"},{id:"rfCol3",value:"#2b2825"}]},
    {id:"rfTone",label:"Piece-to-piece tone",min:0,max:1,step:0.01,value:0.4},
    {id:"rfRough",label:"Base roughness",min:0.05,max:1,step:0.01,value:0.85},
    {id:"rfMetallic",need:"rfMetal",label:"Metallicity",min:0,max:1,step:0.01,value:0.9},
    {id:"rfRelief",label:"Relief depth",min:0.1,max:3,step:0.05,value:1}
  ]}
];

/* control id -> value; envelope.js wraps these into the runtime's
   {id,label,set} preset records */
const PRESETS={
  "three-tab":{rfType:"tab3",rfTileIn:96,rfExposure:5.625,rfTabW:12,rfAlign:"half",rfThick:0.19,
    rfKeyway:0.25,rfTabVar:0.12,rfGranule:0.3,rfAlgae:0.35,rfMoss:0.15,rfBleach:0.35,rfCurl:0.2,
    rfMissing:0.05,rfPatch:0.12,rfNail:0.2,rfDirt:0.4,rfTone:0.35,rfRough:0.88,rfRelief:1,
    rfCol1:"#5b5b56",rfCol2:"#3c3d3a",rfCol3:"#2b2825"},
  "architectural":{rfType:"arch",rfTileIn:96,rfExposure:5.625,rfTabW:9,rfAlign:"random",rfThick:0.28,
    rfLamin:0.85,rfTabVar:0.6,rfGranule:0.2,rfAlgae:0.25,rfMoss:0.12,rfBleach:0.25,rfCurl:0.12,
    rfMissing:0.02,rfPatch:0.06,rfNail:0.12,rfDirt:0.35,rfTone:0.55,rfRough:0.88,rfRelief:1,
    rfCol1:"#4c4a48",rfCol2:"#2e2d2c",rfCol3:"#2b2825"},
  "algae-belt":{rfType:"tab3",rfTileIn:120,rfExposure:5.625,rfTabW:12,rfAlign:"half",rfThick:0.19,
    rfKeyway:0.25,rfTabVar:0.15,rfGranule:0.7,rfAlgae:0.95,rfMoss:0.5,rfBleach:0.5,rfCurl:0.55,
    rfMissing:0.2,rfPatch:0.35,rfNail:0.45,rfDirt:0.7,rfTone:0.5,rfRough:0.9,rfRelief:1.1,
    rfCol1:"#6a6760",rfCol2:"#3f3e3a",rfCol3:"#2a2724"},
  "storm-worn":{rfType:"arch",rfTileIn:96,rfExposure:5.625,rfTabW:9,rfAlign:"random",rfThick:0.28,
    rfLamin:0.8,rfTabVar:0.7,rfGranule:0.9,rfAlgae:0.6,rfMoss:0.45,rfBleach:0.7,rfCurl:0.85,
    rfMissing:0.75,rfPatch:0.7,rfNail:0.7,rfDirt:0.8,rfTone:0.7,rfRough:0.92,rfRelief:1.2,
    rfCol1:"#575450",rfCol2:"#343330",rfCol3:"#2a2724"},
  "cedar-shake":{rfType:"shake",rfTileIn:96,rfExposure:7.5,rfTabW:8,rfAlign:"random",rfThick:0.55,
    rfTabVar:0.8,rfShakeSplit:0.75,rfGap:0.3,rfAlgae:0.3,rfMoss:0.6,rfBleach:0.7,rfCurl:0.5,
    rfMissing:0.12,rfPatch:0.05,rfNail:0.2,rfDirt:0.5,rfTone:0.6,rfRough:0.94,rfRelief:1,
    rfCol1:"#8a7a63",rfCol2:"#5a4f42",rfCol3:"#2b2825"},
  "welsh-slate":{rfType:"slate",rfTileIn:120,rfExposure:5,rfTabW:12,rfAlign:"half",rfThick:0.28,
    rfTabVar:0.2,rfEdge:"sawn",rfSlip:0.15,rfAlgae:0.25,rfMoss:0.45,rfBleach:0.15,rfMissing:0.08,
    rfPatch:0.05,rfNail:0.1,rfDirt:0.5,rfTone:0.75,rfRough:0.62,rfRelief:1,
    rfCol1:"#4a5058",rfCol2:"#2c3138",rfCol3:"#2b2825"},
  "mission-tile":{rfType:"barrel",rfTileIn:120,rfExposure:12,rfBarrelW:10.5,rfBarrelR:2.4,
    rfAlgae:0.2,rfMoss:0.5,rfBleach:0.5,rfPatch:0.05,rfDirt:0.5,rfTone:0.6,rfRough:0.78,rfRelief:1,
    rfCol1:"#a4593a",rfCol2:"#7a4630",rfCol3:"#2b2825"},
  "standing-seam":{rfType:"seam",rfTileIn:120,rfPanW:16,rfRibProfile:"snap",rfRibH:1.5,rfLapIn:120,
    rfOilCan:0.5,rfAlgae:0.12,rfMoss:0.1,rfBleach:0.2,rfPatch:0.03,rfRust:0.15,rfChalk:0.3,
    rfDirt:0.3,rfTone:0.2,rfRough:0.32,rfMetallic:0.9,rfRelief:1,
    rfCol1:"#6f7a74",rfCol2:"#5a635e",rfCol3:"#2b2825"},
  "corrugated-barn":{rfType:"corr",rfTileIn:120,rfCorrPitch:2.67,rfCorrDepth:0.5,rfPanW:26,
    rfLapIn:96,rfFast:0.7,rfOilCan:0.35,rfAlgae:0.2,rfMoss:0.3,rfBleach:0.4,rfPatch:0.1,
    rfRust:0.8,rfChalk:0.6,rfDirt:0.55,rfTone:0.35,rfRough:0.7,rfMetallic:0.75,rfRelief:1,
    rfCol1:"#8d8579",rfCol2:"#5f5a51",rfCol3:"#2b2825"},
  "gravel-ballast":{rfType:"rolled",rfTileIn:96,rfLapIn:34,rfGravel:0.7,rfGravelMm:10,
    rfAlgae:0.15,rfMoss:0.25,rfBleach:0.3,rfPatch:0.45,rfNail:0.1,rfDirt:0.5,rfTone:0.3,
    rfRough:0.9,rfRelief:1,rfCol1:"#4a4642",rfCol2:"#332f2c",rfCol3:"#2b2825"}
};

/* the numbers that decide whether this resolution can hold the roofing.
   Every count below is the SNAPPED one, because that is what gets built. */
function readout(P){
  const S=Math.max(64,(P.size|0)||1024),L=layout(P,S),M=TYPES[L.type]||TYPES.tab3;
  const warn=s=>' <span class="warn">'+s+'</span>';
  const px=v=>(v*L.PXI).toFixed(1);
  let m="<b>"+L.TI.toFixed(0)+" in</b> ("+(L.TI/12).toFixed(2)+" ft) square · "+
        L.IPX.toFixed(3)+" in per texel · "+M.label;
  const thin=[];
  if(M.coursed){
    m+="<br><b>"+L.nC+"</b> courses at <b>"+L.E.toFixed(3)+" in</b>";
    if(Math.abs(L.E-L.eReq)>0.005)m+=" (asked "+L.eReq.toFixed(3)+")";
    if(L.bond>1)m+=" · count snapped to a multiple of "+L.bond+" so the "+
      (L.bond===2?"half":"third")+" bond survives the wrap";
    m+=" — "+px(L.E)+" px";
    if(L.E*L.PXI<2)thin.push("course");
    if(L.type==="barrel"){
      m+="<br><b>"+L.nT+"</b> covers at <b>"+L.TW.toFixed(2)+" in</b> — "+px(L.TW)+" px";
      if(L.TW*L.PXI<4)thin.push("barrel");
    }else{
      m+="<br><b>"+L.nT+"</b> tabs at <b>"+L.TW.toFixed(2)+" in</b>";
      if(Math.abs(L.TW-L.wReq)>0.005)m+=" (asked "+L.wReq.toFixed(2)+")";
      m+=" — "+px(L.TW)+" px";
      if(L.TW*L.PXI<2)thin.push("tab");
      if(L.type==="tab3"){
        const kw=clamp(+P.rfKeyway||0.25,0.02,4);
        m+="<br>keyway "+kw.toFixed(2)+" in = <b>"+px(kw)+" px</b>";
        if(kw*L.PXI<2)m+=warn("— widened to a texel and faded out");
      }
      const th=clamp(+P.rfThick||0.19,0.02,3);
      m+="<br>butt step "+th.toFixed(2)+" in = "+px(th)+" px of relief";
    }
  }
  if(L.type==="seam"){
    m+="<br><b>"+L.nS+"</b> pans at <b>"+L.SW.toFixed(2)+" in</b> — "+px(L.SW)+" px<br>"+
       "rib "+L.ribW.toFixed(2)+" in wide = <b>"+px(L.ribW)+" px</b>";
    if(L.ribW*L.PXI<2)m+=warn("— sub-2-texel rib, faded out; raise resolution");
  }
  if(L.type==="corr"){
    m+="<br><b>"+L.nR+"</b> corrugations at <b>"+L.CP.toFixed(2)+" in</b> — "+px(L.CP)+" px"+
       "<br><b>"+L.nS+"</b> sheets of "+L.SW.toFixed(1)+" in ("+L.perSheet+" corrugations each)";
    if(Math.abs(L.CP-L.cReq)>0.005)m+="<br>pitch snapped from "+L.cReq.toFixed(2)+" in so a whole number fits each sheet";
    if(L.CP*L.PXI<2.2)m+=warn("— sub-2-texel corrugation, amplitude faded to flat");
  }
  if(M.panel)m+="<br><b>"+L.nL+"</b> panel runs at <b>"+L.LP.toFixed(1)+" in</b>";
  if(L.type==="rolled"){
    const g=clamp(+P.rfGravelMm||10,2,40)/25.4;
    m+="<br>gravel "+g.toFixed(2)+" in = "+px(g)+" px";
    if(g*L.PXI<2)m+=warn("— sub-2-texel stone, ballast dropped to a mottle");
  }
  if(thin.length)m+=warn("— "+thin.join(" and ")+" under 2 texels: raise the resolution or shrink the tile");
  return m;
}

window.RoofGen={
  controls:CONTROLS,
  presets:PRESETS,

  /* rf-prefixed so nothing collides with the shell's lap/batten/masonry/ab.
     envelope.js should concat these onto its own face keys. */
  needs:function(P){return (NEEDS[P.rfType]||NEEDS.tab3).slice();},

  readout:readout,

  /* square and a power of two: the runtime mipmaps a seamless build */
  size:function(P,preview){
    const S=Math.max(64,(P.size|0)||1024);
    const n=preview?Math.min(S,256):S;
    return {w:n,h:n};
  },

  build:build,

  readme:function(P,info){
    const L=layout(P,info.W||Math.max(64,(P.size|0)||1024));
    const M=TYPES[L.type]||TYPES.tab3;
    const rel=info.hMax-info.hMin;
    const lines=["Texture Forge · roof — "+M.label,
      "",
      "Seed "+(P.seed|0)+"   Resolution "+info.W+" x "+info.H,
      "Tile covers "+L.TI.toFixed(1)+" in x "+L.TI.toFixed(1)+" in  ("+(L.TI/12).toFixed(2)+" ft square, "+
        (info.W/L.TI).toFixed(1)+" px per inch)",
      "Tiles seamlessly in both axes.",
      "",
      "SCALE",
      "Set the material scale from that one number and this roof lines up with",
      "any other piece from this tool: exposures, tab widths, pan widths and",
      "corrugation pitches are all real inches."];
    if(M.coursed){
      lines.push("",L.nC+" courses per tile at "+L.E.toFixed(3)+" in exposure"+
        (Math.abs(L.E-L.eReq)>0.005?"  (asked for "+L.eReq.toFixed(3)+")":""));
      if(L.bond>1)lines.push("The course count is snapped to a multiple of "+L.bond+" so the "+
        (L.bond===2?"half":"third")+" bond repeats across the tile edge instead of");
      if(L.bond>1)lines.push("putting two identically-offset courses side by side at the wrap.");
      lines.push((L.type==="barrel"?L.nT+" covers":L.nT+" tabs")+" per tile at "+L.TW.toFixed(2)+" in.");
    }
    if(L.type==="seam")lines.push("",L.nS+" pans of "+L.SW.toFixed(2)+" in with a "+
      (P.rfRibProfile||"snap")+" rib "+(+P.rfRibH||1.5).toFixed(2)+" in high.");
    if(L.type==="corr")lines.push("",L.nR+" corrugations of "+L.CP.toFixed(2)+" in, "+
      L.perSheet+" to a sheet, "+L.nS+" sheets across.");
    if(M.panel)lines.push(L.nL+" panel runs of "+L.LP.toFixed(1)+" in down-slope.");
    lines.push("",
      "PITCH",
      "There is no pitch or foreshortening control, on purpose. This texture is",
      "the roof plane's own surface unrolled; a plane is not foreshortened by its",
      "own slope — the camera does that when you tilt the plane into the scene.",
      "Squashing the v axis would also make the tile cover fewer inches down-slope",
      "than across and break the whole-course snap that makes it tile. Build the",
      "roof at its real pitch and map this on flat.",
      "",
      "SEAMS",
      "Every periodic count is snapped to a whole number of repeats per tile and",
      "every hash is taken modulo that count, so piece j and piece j+n are the",
      "same piece one tile over. The tile edge in v falls on a butt line, which is",
      "the same discontinuity that appears at every other course.",
      "",
      "CHANNELS",
      "basecolor.png  sRGB albedo. Import as sRGB / colour data.",
      "normal.png     Tangent space, "+info.normalNote+". Non-colour / linear.",
      "roughness.png  Linear grey, 0 = mirror, 1 = fully rough.",
      "metallic.png   "+(M.metal
        ?"Real metal: the sheet is metallic, and rust, chalking, moss and tar"
        :"Flat black by design — asphalt, wood, slate, clay and bitumen are all")
      );
    lines.push(M.metal
      ?"               patches pull it back down where they cover the coating."
      :"               dielectric. Exposed nail heads are the only metal in it.");
    lines.push(
      "ao.png         Linear grey; the shadow under each butt and in the laps.",
      "height.png     Linear grey displacement over "+rel.toFixed(3)+" in of real relief",
      "               (min "+info.hMin.toFixed(3)+" in, max "+info.hMax.toFixed(3)+" in). Set the displacement",
      "               amount to "+(rel/12).toFixed(5)+" ft / "+(rel*25.4).toFixed(1)+" mm for true depth.",
      "height16.png   The same field at 16 bits — use it for displacement. The butt",
      "               step is only "+(clamp(+P.rfThick||0.19,0.02,3)/Math.max(rel,1e-6)*255).toFixed(0)+
        " levels of the 8-bit map, and that step is what",
      "               makes a roof read, so do not displace from the 8-bit one.",
      "orm.png        Packed: R = AO, G = roughness, B = metallic.",
      "",
      "Heights are inches, so the normal map carries true slopes.",
      "Normal strength baked at "+(P.normalStr==null?1:+P.normalStr).toFixed(2)+"x.");
    return lines.join("\n");
  }
};

})();
