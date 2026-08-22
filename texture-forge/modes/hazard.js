/* =====================================================================
   MODE: hazard — seamless caution striping and industrial floor marking
   =====================================================================
   Painted safety marking on a real floor, dimensioned in millimetres:
   diagonal hazard stripes, chevrons, zebra edging, chequer, keep-clear
   crosshatch and solid zones, laid on concrete, diamond plate, steel or
   asphalt, then worn the way marking actually wears — traffic polishing
   the tops, chips to the substrate, tyre scuffs, rust bleeding out of the
   chips, oil, dirt in the low spots.

   THE TILING PROBLEM, which is the whole reason this mode is interesting:
   a diagonal stripe at an arbitrary angle does not tile. With phase
   φ = (X·cosθ + Y·sinθ)/p, writing it in tile coordinates gives
   φ = a·u + b·v with a = T·cosθ/p and b = T·sinθ/p, and the field repeats
   on the tile if and only if a and b are BOTH INTEGERS. So the mode
   snaps: it rounds (a,b) to integers and reports the angle and pitch it
   actually built, or holds the angle exactly by picking a pitch off that
   direction's ladder, or holds both and moves the tile size instead.
   45° on a 2 m tile cannot be 200 mm — it can be 202.03 mm, and the
   readout says so rather than shipping a seam.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,mulberry32=Forge.mulberry32,
      hashi=Forge.hashi,vnoise=Forge.vnoise,fbm=Forge.fbm,vnoise2=Forge.vnoise2,fbm2=Forge.fbm2,
      hex2rgb=Forge.hex2rgb,blurWrap=Forge.blurWrap;

const TAU=Math.PI*2,DEG=Math.PI/180;
const sat=x=>x<0?0:(x>1?1:x);
const frac=x=>x-Math.floor(x);
/* distance to the nearest edge of a 1-periodic square wave, in period units */
const tri=x=>{const f=frac(x);return f<0.5?f:1-f;};

/* ============================ tileable worley ============================
   Cells live on an integer lattice of period N, so the pattern wraps. Used
   for paint chips and for the pores in a troweled slab. */
let W_f1=0,W_f2=0,W_cx=0,W_cy=0;
function worley(x,y,N,seed,jit){
  const xi=Math.floor(x),yi=Math.floor(y);
  let d1=1e9,d2=1e9,bx=0,by=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const cx=xi+dx,cy=yi+dy;
    const wx=((cx%N)+N)%N,wy=((cy%N)+N)%N;
    const fx=cx+0.5+(hashi(wx,wy,seed)-0.5)*jit;
    const fy=cy+0.5+(hashi(wx,wy,seed+7717)-0.5)*jit;
    const ax=x-fx,ay=y-fy,d=ax*ax+ay*ay;
    if(d<d1){d2=d1;d1=d;bx=wx;by=wy;}else if(d<d2)d2=d;
  }
  W_f1=Math.sqrt(d1);W_f2=Math.sqrt(d2);W_cx=bx;W_cy=by;
}

/* ============================ the tiling maths ============================ */

/* Directions whose tangent is a ratio of small integers: these are the only
   angles a stripe field can hold EXACTLY on a square tile. The Pythagorean
   ones (4:3, 12:5, 15:8, 24:7, 21:20) are the sweet spot — exact angle and a
   round-number pitch ladder at the same time. */
const RATIOS=[[1,0],[12,1],[8,1],[6,1],[5,1],[4,1],[24,7],[3,1],[5,2],[12,5],[2,1],
  [15,8],[7,4],[5,3],[3,2],[4,3],[5,4],[6,5],[21,20],[1,1],[20,21],[5,6],[4,5],[3,4],
  [2,3],[3,5],[4,7],[1,2],[5,12],[2,5],[1,3],[7,24],[1,4],[1,5],[1,6],[1,8],[1,12],[0,1]];

function nearestRatio(theta){
  let best=RATIOS[0],bd=1e9;
  for(const r of RATIOS){
    const d=Math.abs(Math.atan2(r[1],r[0])-theta);
    if(d<bd){bd=d;best=r;}
  }
  return best;
}

/* Resolve the requested angle and pitch into an exactly-tiling (a,b) pair.
   Returns what was actually built so the readout can own up to it. */
function frequency(P,T){
  const pReq=Math.max(0.002,(+P.pitchMm||100)/1000);
  const thReq=(+P.angleDeg||0)*DEG*(P.flip?-1:1);
  const mode=P.snapMode||"angle";
  let a,b;
  if(mode==="off"){
    a=T*Math.cos(thReq)/pReq;b=T*Math.sin(thReq)/pReq;
  }else if(mode==="pitch"||mode==="tile"){
    const r=nearestRatio(Math.abs(thReq));
    const s=thReq<0?-1:1;
    const q=Math.hypot(r[0],r[1]);
    const k=Math.max(1,Math.round(T/(pReq*q)));
    a=k*r[0];b=s*k*r[1];
  }else{
    a=Math.round(T*Math.cos(thReq)/pReq);
    b=Math.round(T*Math.sin(thReq)/pReq);
    if(a===0&&b===0)b=1;
  }
  const q=Math.hypot(a,b)||1;
  return {a:a,b:b,p:T/q,theta:Math.atan2(b,a),
    exact:mode!=="off"&&Math.abs(a-Math.round(a))<1e-9&&Math.abs(b-Math.round(b))<1e-9,
    mode:mode,pReq:pReq,thReq:thReq};
}

/* the tile size that would hold BOTH the requested angle and pitch exactly */
function tileForExact(P){
  const r=nearestRatio(Math.abs((+P.angleDeg||0)*DEG));
  const q=Math.hypot(r[0],r[1]);
  const p=Math.max(0.002,(+P.pitchMm||100)/1000);
  const k=Math.max(1,Math.round((+P.tileM||2)/(p*q)));
  return k*p*q;
}

/* ============================ palettes ============================ */

const STANDARDS={
  osha_yb:  {label:"Safety yellow · black",     a:"#ffcd00",b:"#1b1b1b",note:"OSHA caution — physical hazard"},
  ansi_rw:  {label:"Safety red · white",        a:"#c8102e",b:"#edebe4",note:"Danger, fire equipment, no-go"},
  bw:       {label:"Black · white",             a:"#1b1b1b",b:"#edebe4",note:"Housekeeping — keep clear"},
  green_w:  {label:"Safety green · white",      a:"#00843d",b:"#edebe4",note:"Safety, first aid"},
  blue_w:   {label:"Safety blue · white",       a:"#005eb8",b:"#edebe4",note:"Mandatory — PPE required"},
  orange_w: {label:"Safety orange · white",     a:"#ff6a13",b:"#edebe4",note:"Machine hazard, guard removed"},
  mag_y:    {label:"Radiation magenta · yellow",a:"#a50050",b:"#ffcd00",note:"Ionising radiation"},
  constr_ow:{label:"Construction orange · white",a:"#f26522",b:"#edebe4",note:"Work zone, temporary hazard"},
  avi_ow:   {label:"International orange · white",a:"#ff4f00",b:"#f3f3ef",note:"ICAO obstruction chequer"},
  hwy_wy:   {label:"Traffic white · yellow",    a:"#efede6",b:"#f2b92b",note:"Highway thermoplastic"},
  custom:   {label:"Custom",                    a:null,b:null,note:"your own two colours"}
};

const SUBSTRATE={
  conc: {label:"Concrete",        col:"#b3afa6",rough:0.62,met:0,amp:0.00018},
  plate:{label:"Steel diamond plate",col:"#8e9296",rough:0.42,met:1,amp:0.0022},
  steel:{label:"Steel plate",     col:"#7c8084",rough:0.38,met:1,amp:0.00006},
  asph: {label:"Asphalt",         col:"#2b2b2c",rough:0.86,met:0,amp:0.0018}
};

/* film thickness in metres, and how the carrier fails */
const CARRIER={
  paint:{label:"Paint",             film:0.00010,rough:0.55,chipEase:1.0},
  epoxy:{label:"Epoxy floor coat",  film:0.00035,rough:0.30,chipEase:0.7},
  thermo:{label:"Thermoplastic",    film:0.00220,rough:0.62,chipEase:0.5},
  tape: {label:"Applied tape",      film:0.00018,rough:0.36,chipEase:1.4},
  grit: {label:"Anti-slip grit",    film:0.00090,rough:0.95,chipEase:0.8}
};

/* flat material ids, mirroring the house mode's table idea */
const IDCOL=[[128,128,128],[255,224,0],[32,32,32],[0,160,255],[176,0,255],[192,192,192],
             [176,64,16],[16,16,16],[0,96,80],[255,128,0],[255,255,255]];

let P={},lastStd=null;

/* ============================ the generator ============================ */

function build(params,io){
  const Q=Object.assign({},params);        // the runtime mutates the live object
  P=Q;
  const S=io.W,N=S*S,seed=Q.seed|0;
  const T=+Q.tileM||2, mpx=T/S;            // metres per texel
  const F=frequency(Q,T);
  const SUB=SUBSTRATE[Q.sub]||SUBSTRATE.conc;
  const CAR=CARRIER[Q.carrier]||CARRIER.paint;
  const std=STANDARDS[Q.std]||STANDARDS.custom;
  const cA=hex2rgb(Q.swap?Q.cB:Q.cA),cB=hex2rgb(Q.swap?Q.cA:Q.cB);
  const subCol=hex2rgb(Q.cSub||SUB.col);

  const A=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N);
  const MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N);
  const NRM=new Uint8ClampedArray(N*3);
  const HGT=new Float32Array(N);
  const PK=new Uint8ClampedArray(N);       // paint coverage, for the decal channel
  const PS=new Uint8ClampedArray(N);       // which of the two colours
  const ID=new Uint8ClampedArray(N);
  let hMin=0,hMax=1;

  /* ---- pattern geometry, all snapped so the tile closes ---- */
  const duty=clamp(+Q.duty||0.5,0.05,0.95);
  const wPhase=Math.hypot(F.a,F.b)/S;                  // phase units per texel
  const chevPsi=clamp(+Q.chevDeg||45,5,85)*DEG;
  const chevC=Math.max(1,Q.chevCells|0);
  const chevB=Math.max(1,Math.round(T*Math.cos(chevPsi)/Math.max(0.002,(+Q.pitchMm||100)/1000)));
  const chevA=chevB*Math.tan(chevPsi)/(2*chevC);
  const barM=Math.max(0.02,(+Q.barMm||450)/1000),gapM=Math.max(0.02,(+Q.gapMm||450)/1000);
  const nZeb=Math.max(1,Math.round(T/(barM+gapM)));
  const zebDuty=clamp(barM/(barM+gapM),0.05,0.95);
  const sqM=Math.max(0.02,(+Q.squareMm||300)/1000);
  let nSq=Math.max(2,Math.round(T/sqM));
  if(nSq&1)nSq+=(Math.abs(T/(nSq+1)-sqM)<Math.abs(T/(nSq-1)-sqM))?1:-1;   // must be even to alternate across the wrap
  nSq=Math.max(2,nSq);

  /* ---- substrate constants ---- */
  const jointM=clamp(+Q.jointM||4,0.5,12);
  const nJoint=Math.round(T/jointM);            // 0 when the slab is bigger than the tile
  const jointW=0.005,jointD=0.006;                     // 5 mm wide, 6 mm modelled depth
  const broomP=0.003,broomD=0.0004;                    // 3 mm pitch, 0.4 mm deep
  const nBroom=Math.max(4,Math.round(T/broomP));
  const useBroom=(S/nBroom)>=2.2;
  const NPore=Math.max(4,Math.round(T/0.012));
  const usePore=(S/NPore)>=2.2;
  const lugM=clamp(+Q.lugMm||45,10,120)/1000;          // diamond plate lug length
  const nLug=Math.max(2,Math.round(T/(lugM*1.55)));
  const lugH=0.0022;
  const aggM=clamp(+Q.aggMm||12,4,32)/1000;
  const NAgg=Math.max(4,Math.round(T/aggM));
  const useAgg=(S/NAgg)>=2.2;

  /* ---- wear constants ---- */
  const wear=clamp(+Q.wear||0,0,1),chipAmt=clamp(+Q.chip||0,0,1);
  const NChip=Math.max(4,Math.round(T/clamp((+Q.chipMm||18)/1000,0.004,0.2)));
  const trackM=clamp(+Q.trackM||1.1,0.4,3);
  const gh=clamp(+Q.ghost||0,0,1);
  const ghF=gh>0?frequency({pitchMm:(+Q.pitchMm||100)*1.35,angleDeg:(+Q.ghostDeg||18),
                            snapMode:"angle",flip:false},T):null;
  const glow=Q.std==="photo_g";

  const rng=mulberry32(seed*2654435761+17);
  const skids=[];
  for(let i=0,n=Math.round(clamp(+Q.skid||0,0,1)*5);i<n;i++)
    skids.push({x:rng(),y:rng(),ang:(rng()-0.5)*1.4,len:0.12+rng()*0.5,w:(0.15+rng()*0.1)/T,arc:(rng()-0.5)*1.2});

  /* the paint film in metres, and how much of it survives as relief */
  const film=CAR.film*clamp(+Q.filmScale||1,0.2,3);

  /* ---- per-texel helpers ---- */
  const wrapD=(a,b)=>{const d=Math.abs(a-b);return d<0.5?d:1-d;};

  /* coverage of the A colour for the chosen pattern, antialiased against the
     texel size: every family below returns 1 inside an A band, 0 inside a B
     band, and a soft edge exactly one texel wide in between */
  function patternAt(u,v){
    const pat=Q.pattern||"stripe";
    if(pat==="none")return 0;
    if(pat==="solid")return 1;
    if(pat==="check"){
      const sq=(x)=>{
        const f=frac(x*nSq)-0.5;
        return smoothstep(-0.6*nSq/S,0.6*nSq/S,0.25-Math.abs(Math.abs(f)-0.25));
      };
      const su=sq(u),sv=sq(v);
      return su*(1-sv)+(1-su)*sv;
    }
    if(pat==="zebra"){
      const ph=nZeb*u;
      const f=frac(ph),e=Math.min(f,1-f);
      const d=(f<zebDuty)?Math.min(f,zebDuty-f):-Math.min(f-zebDuty,1-f);
      return smoothstep(-0.7*nZeb/S,0.7*nZeb/S,d);
    }
    if(pat==="chev"){
      const ph=chevA*(2*tri(chevC*v))+chevB*u;
      const w=Math.hypot(2*chevA*chevC,chevB)/S;
      const f=frac(ph);
      const d=(f<duty)?Math.min(f,duty-f):-Math.min(f-duty,1-f);
      return smoothstep(-0.7*w,0.7*w,d);
    }
    if(pat==="cross"){
      const one=(a,b)=>{
        const f=frac(a*u+b*v);
        const w=Math.hypot(a,b)/S;
        const d=(f<duty)?Math.min(f,duty-f):-Math.min(f-duty,1-f);
        return smoothstep(-0.7*w,0.7*w,d);
      };
      const s1=one(F.a,F.b),s2=one(-F.b,F.a);          // the perpendicular family
      return Math.max(s1,s2);
    }
    const f=frac(F.a*u+F.b*v);
    const d=(f<duty)?Math.min(f,duty-f):-Math.min(f-duty,1-f);
    return smoothstep(-0.7*wPhase,0.7*wPhase,d);
  }

  /* the substrate: colour, height in metres, roughness, metalness */
  let Sh=0,Sr=0,Sg=0,Sb=0,Srg=0.6,Smet=0,Sid=0,Sjoint=0;
  function substrate(u,v){
    let r=subCol[0],g=subCol[1],b=subCol[2],h=0,rg=SUB.rough,met=SUB.met;
    Sjoint=0;
    const mott=fbm(u,v,7,4,seed+11);
    if(Q.sub==="conc"){
      const fin=Q.finish||"trowel";
      const tone=0.86+mott*0.28;
      r*=tone;g*=tone;b*=tone;
      h+=(fbm2(u,v,23,23,3,seed+29)-0.5)*0.0004;
      if(fin==="broom"&&useBroom){
        const swirl=(fbm(u,v,3,2,seed+37)-0.5)*0.06;
        const s=frac((v+swirl)*nBroom);
        const w=1-Math.abs(2*s-1);
        h-=broomD*w;
        rg=0.88-0.06*w;
      }else if(fin==="polish"){
        rg=0.18+mott*0.14;
        h+=(fbm2(u,v,61,61,2,seed+41)-0.5)*0.00006;
      }else if(fin==="sealed"){
        rg=0.28+mott*0.10;
      }else{
        rg=0.50+mott*0.14;
      }
      if(fin!=="polish"){
        /* Sand in the paste. A slab is never a flat grey: the fines catch the
           light at a couple of millimetres, which is the scale that tells the
           eye it is concrete rather than card. */
        const NS=Math.max(8,Math.round(T/0.0022));
        if((S/NS)>=2){
          const sand=fbm2(u,v,NS,NS,2,seed+43);
          h+=(sand-0.5)*0.00022;
          const sk=(sand-0.5)*0.16;
          r*=1+sk;g*=1+sk;b*=1+sk*0.95;
          rg+=(sand-0.5)*0.12;
        }
        if(usePore){                                    // air voids and popouts
          worley(u*NPore,v*NPore,NPore,seed+53,0.95);
          const hasPore=hashi(W_cx,W_cy,seed+57)<0.55;
          if(hasPore){
            const rad=0.10+0.16*hashi(W_cx,W_cy,seed+61);
            const pore=1-smoothstep(rad*0.55,rad,W_f1);
            h-=pore*(0.00012+0.0004*hashi(W_cx,W_cy,seed+63));
            rg=lerp(rg,0.86,pore);
            const dk=1-pore*0.22;
            r*=dk;g*=dk;b*=dk;
          }
        }
      }
      if(fin==="trowel"||fin==="sealed"){
        const sw=fbm(u*1.7,v*1.7,5,3,seed+59);          // burnished trowel arcs
        const arc=smoothstep(0.52,0.86,sw);
        rg-=0.16*arc;
        const bl=1+arc*0.05;
        r*=bl;g*=bl;b*=bl;
      }
      {                                                  // hairline crazing
        const cz=clamp(+Q.craze||0,0,1);
        if(cz>0){
          const NC=Math.max(4,Math.round(T/0.09));
          worley(u*NC,v*NC,NC,seed+73,0.95);
          const line=1-smoothstep(0.006,0.02+mpx*2/(T/NC),W_f2-W_f1);
          const cr=line*cz*smoothstep(0.35,0.7,fbm(u,v,4,2,seed+79));
          if(cr>0){
            h-=cr*0.00025;
            const dk=1-cr*0.28;
            r*=dk;g*=dk;b*=dk;
            rg=lerp(rg,0.9,cr*0.6);
          }
        }
      }
      /* saw-cut control joints, snapped to a whole number per tile */
      const dj=nJoint>0?Math.min(tri(u*nJoint),tri(v*nJoint))/nJoint*T:1e9;
      const inJ=nJoint>0?1-smoothstep(jointW*0.5,jointW*0.5+mpx*1.2,dj):0;
      if(inJ>0){
        h-=jointD*inJ;
        r*=lerp(1,0.62,inJ);g*=lerp(1,0.62,inJ);b*=lerp(1,0.60,inJ);
        rg=lerp(rg,0.92,inJ);
        Sjoint=inJ;
      }
    }else if(Q.sub==="plate"){
      /* Diamond plate: lugs on a staggered lattice, every other row turned the
         other way. Integer lug counts per axis, so it wraps. */
      const cu=u*nLug,cv=v*nLug;
      const row=Math.floor(cv),col=Math.floor(cu+(row&1?0.5:0));
      const su=frac(cu+(row&1?0.5:0))-0.5,sv=frac(cv)-0.5;
      const ang=((row+col)&1)?-0.72:0.72;                // ±41°, alternating both ways
      const ca=Math.cos(ang),sa=Math.sin(ang);
      const lx=(su*ca-sv*sa),ly=(su*sa+sv*ca);
      const half=lugM*0.5/(T/nLug),halfW=half*0.30;
      const d=Math.max(Math.abs(lx)/Math.max(1e-6,half),Math.abs(ly)/Math.max(1e-6,halfW));
      const lug=1-smoothstep(0.72,1.0,d);
      h+=lugH*lug*(0.55+0.45*Math.sqrt(Math.max(0,1-d*d)));
      const tone=0.9+0.2*mott+0.10*lug;
      r*=tone;g*=tone;b*=tone;
      rg=lerp(0.46,0.34,lug);
      h+=(fbm2(u,v,37,37,2,seed+67)-0.5)*0.00004;
    }else if(Q.sub==="steel"){
      const tone=0.9+mott*0.22;
      r*=tone;g*=tone;b*=tone;
      h+=(fbm2(u,v,53,53,3,seed+71)-0.5)*0.00006;       // orange peel
      rg=0.34+mott*0.18;
      if(Q.weld){                                        // a seam every tile, so it tiles
        const dw=tri(v)*T;
        const sw=1-smoothstep(0.004,0.010,dw);
        if(sw>0){
          const bead=Math.abs(frac(u*Math.max(6,Math.round(T/0.02)))-0.5)*2;
          h+=0.0012*sw*(0.6+0.4*bead);
          rg=lerp(rg,0.62,sw);
          r*=lerp(1,0.88,sw);g*=lerp(1,0.88,sw);b*=lerp(1,0.86,sw);
        }
      }
    }else{                                               // asphalt
      const tone=0.85+mott*0.3;
      r*=tone;g*=tone;b*=tone;
      if(useAgg){
        worley(u*NAgg,v*NAgg,NAgg,seed+83,0.85);
        const stone=1-smoothstep(0.24,0.42,W_f1);
        const sh=hashi(W_cx,W_cy,seed+89);
        h+=stone*aggM*0.28*(0.5+sh*0.7);
        const sc=lerp(0.9,2.0,sh)*stone;
        r+=sc*38;g+=sc*36;b+=sc*33;
        rg=lerp(0.88,0.6,stone);
      }
    }
    Sh=h;Sr=r;Sg=g;Sb=b;Srg=rg;Smet=met;
  }

  const band=Math.max(4,Math.round(32768/S));
  let y=0;

  function pass1(){
    const end=Math.min(S,y+band);
    for(;y<end;y++){
      const v=(y+0.5)/S;
      for(let x=0;x<S;x++){
        const u=(x+0.5)/S,i=y*S+x;

        substrate(u,v);
        let r=Sr,g=Sg,b=Sb,h=Sh,rg=Srg,met=Smet,id=0;

        /* ---- 1. the previous marking, ground off and painted over ---- */
        if(gh>0){
          const gf=frac(ghF.a*u+ghF.b*v);
          const gw=Math.hypot(ghF.a,ghF.b)/S;
          const gd=(gf<0.5)?Math.min(gf,0.5-gf):-Math.min(gf-0.5,1-gf);
          const gcov=smoothstep(-0.7*gw,0.7*gw,gd)*gh*
                     smoothstep(0.35,0.75,fbm(u,v,3,3,seed+101));
          if(gcov>0.01){
            const gc=hex2rgb(Q.cGhost||"#8d8a80");
            r=lerp(r,gc[0],gcov*0.55);g=lerp(g,gc[1],gcov*0.55);b=lerp(b,gc[2],gcov*0.55);
            rg=lerp(rg,0.80,gcov*0.6);
            h+=gcov*0.00004;                       // the ridge the grinder left
          }
        }

        /* ---- 2. the marking itself ---- */
        let cov=patternAt(u,v);
        const split=cov;                           // 1 = colour A, 0 = colour B
        let paint=1;                               // how much film is present at all
        if(Q.pattern==="none"){paint=0;}
        else if(Q.pattern==="zebra"||Q.pattern==="chev"||Q.pattern==="cross"||Q.pattern==="solid"){
          /* these families paint only their A bands and leave the floor bare
             between; stripes and chequer paint both colours */
          paint=(Q.pattern==="solid")?1:cov;
        }
        /* edge softness: overspray fringe and stencil bleed */
        const bleed=clamp(+Q.bleed||0,0,1);
        if(bleed>0&&paint<1){
          const halo=smoothstep(0,1,cov)*bleed*0.35;
          paint=Math.max(paint,halo*smoothstep(0.3,0.9,fbm(u,v,29,2,seed+107)));
        }

        /* ---- 3. traffic: wheel tracks polish and thin the paint ---- */
        let traffic=0;
        if(wear>0){
          const tv=trackM/T;
          const t1=wrapD(v,0.5-tv*0.5),t2=wrapD(v,0.5+tv*0.5);
          const w1=Math.exp(-Math.pow(t1/(0.10*tv+0.02),2));
          const w2=Math.exp(-Math.pow(t2/(0.10*tv+0.02),2));
          traffic=clamp((Math.max(w1,w2)*0.75+0.45*fbm(u,v,4,3,seed+113))*wear*1.25,0,1);
          rg=lerp(rg,rg*0.55,traffic*0.7);          // polished
          h-=traffic*0.00002;
        }

        /* ---- 4. chipping and flaking through to the substrate ----
           Paint fails a flake at a time, not a texel at a time: a whole Worley
           cell either lets go or it does not. Thresholding a noise field here
           instead gives salt-and-pepper speckle, which is the single most
           common way procedural chipping looks wrong. */
        let chip=0,chipRim=0;
        if(chipAmt>0&&paint>0.01){
          const wq=0.22;                                      // ragged the cell walls
          worley(u*NChip+(fbm(u,v,17,2,seed+191)-0.5)*wq,
                 v*NChip+(fbm(u,v,17,2,seed+193)-0.5)*wq,NChip,seed+127,0.95);
          const edge=1-smoothstep(0,0.12,Math.abs(cov-0.5));   // band edges go first
          const patch=fbm(u,v,5,3,seed+131);                   // chipping comes in areas
          const bias=clamp(0.22+edge*0.45+traffic*0.75+(patch-0.5)*1.1,0,1.6);
          const cell=hashi(W_cx,W_cy,seed+211);
          if(cell<clamp(chipAmt*CAR.chipEase*bias,0,1)){
            /* the flake fills its cell out to the cell boundary, so neighbouring
               failures merge into one ragged patch the way real paint lets go */
            const wall=W_f2-W_f1;                              // 0 on the boundary
            chip=smoothstep(0.02,0.12,wall);
            chipRim=smoothstep(0.14,0.03,wall)*(1-chip);       // the lifted lip
          }
        }

        /* ---- 5. scratches and grinding marks ---- */
        let scr=0;
        const scrAmt=clamp(+Q.scratch||0,0,1);
        if(scrAmt>0){
          const a2=fbm2(u*1.0,v*1.0,7,180,2,seed+137);
          const s2=smoothstep(0.72,0.98,a2)*scrAmt;
          scr=s2;
          h-=s2*0.00012;
          rg=lerp(rg,0.72,s2*0.5);
        }

        /* the paint that is actually left */
        const alive=clamp(paint*(1-chip)*(1-traffic*0.35)*(1-scr*0.4),0,1);

        /* colour of the film, aged */
        const bleach=clamp(+Q.bleach||0,0,1);
        const cc=[lerp(cB[0],cA[0],split),lerp(cB[1],cA[1],split),lerp(cB[2],cA[2],split)];
        if(bleach>0){
          const lum=(cc[0]*0.3+cc[1]*0.59+cc[2]*0.11);
          /* red pigment fades fastest, yellow slowest */
          const k=bleach*(0.55+0.45*(cc[0]>cc[2]?1.4:0.8))*0.5;
          cc[0]=lerp(cc[0],lerp(lum,subCol[0],0.35),k);
          cc[1]=lerp(cc[1],lerp(lum,subCol[1],0.35),k);
          cc[2]=lerp(cc[2],lerp(lum,subCol[2],0.35),k);
        }
        if(chipRim>0){                              // paint curls up before it goes
          h+=chipRim*film*0.6;
          rg=lerp(rg,clamp(rg+0.15,0,1),chipRim*0.6);
        }
        if(alive>0.004){
          r=lerp(r,cc[0],alive);g=lerp(g,cc[1],alive);b=lerp(b,cc[2],alive);
          rg=lerp(rg,CAR.rough*(1-traffic*0.35),alive);
          h+=film*alive;
          met=lerp(met,0,alive);                    // paint is a dielectric
          id=split>0.5?1:2;
          if(Q.carrier==="tape")id=3;
          if(Q.carrier==="grit"){
            id=4;
            const gsz=Math.max(4,Math.round(T/0.0012));
            if((S/gsz)>=2){
              const gr=hashi(Math.floor(u*gsz),Math.floor(v*gsz),seed+139);
              h+=alive*gr*0.0004;
              rg=lerp(rg,0.97,alive*0.8);
            }
          }
        }
        /* the decal channel records the paint before the dirt goes on */
        PK[i]=alive*255;PS[i]=split*255;

        /* bare metal where the film has gone from a metal substrate */
        if(SUB.met>0&&alive<0.5){
          const bare=(1-alive);
          met=lerp(met,1,bare);
          if(chip>0.4&&alive<0.2)id=5;
        }

        /* ---- 6. rust bleeding out of the chips ---- */
        const rustAmt=clamp(+Q.rust||0,0,1);
        if(rustAmt>0&&SUB.met>0){
          /* rust starts at the cut edge of the film and creeps in, so the rim
             of a flake goes first and the middle stays bare metal longer */
          const src=clamp(chip*0.5+chipRim*1.3+scr*0.55,0,1);
          const run=smoothstep(0.35,0.9,fbm(u,v*0.6,9,3,seed+149));
          const rust=clamp(src*0.8+src*run*1.4,0,1)*rustAmt;
          if(rust>0.01){
            r=lerp(r,132,rust*0.85);g=lerp(g,62,rust*0.85);b=lerp(b,30,rust*0.85);
            rg=lerp(rg,0.95,rust);
            met=lerp(met,0,rust*0.9);
            h+=rust*0.00005;
            if(rust>0.35)id=6;
          }
        }

        /* ---- 7. rubber: scuffs and skid marks ---- */
        const skidAmt=clamp(+Q.skid||0,0,1);
        if(skidAmt>0){
          let sk=0;
          for(let s=0;s<skids.length;s++){
            const K=skids[s];
            const du=wrapD(u,K.x),dv=wrapD(v,K.y);
            const cs=Math.cos(K.ang),sn=Math.sin(K.ang);
            const lx=(u-K.x)*cs+(v-K.y)*sn,ly=-(u-K.x)*sn+(v-K.y)*cs;
            const bend=K.arc*lx*lx;
            const along=1-smoothstep(K.len*0.6,K.len,Math.abs(lx));
            const across=1-smoothstep(K.w*0.35,K.w*0.6,Math.abs(ly-bend));
            sk=Math.max(sk,along*across);
          }
          sk*=skidAmt*(0.55+0.45*fbm(u,v,31,2,seed+151));
          if(sk>0.01){
            r*=lerp(1,0.34,sk);g*=lerp(1,0.34,sk);b*=lerp(1,0.36,sk);
            rg=lerp(rg,0.42,sk*0.8);
            h+=sk*0.00001;                          // rubber adds, it does not cut
            if(sk>0.4)id=7;
          }
        }

        /* ---- 8. oil and coolant ---- */
        const oilAmt=clamp(+Q.oil||0,0,1);
        if(oilAmt>0){
          const o=smoothstep(0.62,0.86,fbm(u,v,5,4,seed+157))*oilAmt*(0.4+traffic);
          if(o>0.01){
            r*=lerp(1,0.42,o);g*=lerp(1,0.40,o);b*=lerp(1,0.38,o);
            rg=lerp(rg,0.26,o);
            if(o>0.35)id=8;
          }
        }

        /* ---- 9. efflorescence, concrete only, blooming at the joints ---- */
        const efAmt=clamp(+Q.effl||0,0,1);
        if(efAmt>0&&Q.sub==="conc"){
          const e=smoothstep(0.55,0.9,fbm(u,v,6,3,seed+163))*efAmt*(0.35+Sjoint*1.2);
          if(e>0.01){
            r=lerp(r,215,e*0.7);g=lerp(g,210,e*0.7);b=lerp(b,198,e*0.7);
            rg=lerp(rg,0.96,e);
            if(e>0.4)id=10;
          }
        }

        /* ---- 10. general grime, before the cavity dirt in pass 2 ---- */
        const dirt=clamp(+Q.dirt||0,0,1);
        if(dirt>0){
          const gA=fbm(u,v,3,3,seed+167),gB=fbm(u,v,13,3,seed+173);
          const filth=clamp((gA*0.6+gB*0.4-0.38)*2.2,0,1)*dirt;
          r=lerp(r,r*0.55,filth);g=lerp(g,g*0.55,filth);b=lerp(b,b*0.52,filth);
          rg=lerp(rg,clamp(rg+0.16,0,1),filth);
        }

        /* wet floor: fills the low spots and drops the roughness */
        const wet=clamp(+Q.wet||0,0,1);
        if(wet>0){
          rg=lerp(rg,0.06,wet*0.85);
          r*=lerp(1,0.82,wet);g*=lerp(1,0.83,wet);b*=lerp(1,0.86,wet);
        }

        A[i*3]=r;A[i*3+1]=g;A[i*3+2]=b;
        RGH[i]=clamp(rg,0.03,1)*255;
        MET[i]=clamp(met,0,1)*255;
        AOc[i]=255;
        HGT[i]=h;
        ID[i]=id;
      }
    }
    if(y<S){io.progress(y/S*0.72);setTimeout(pass1,0);}
    else{io.progress(0.75);setTimeout(pass2,0);}
  }

  function pass2(){
    /* cavity dirt and AO both come from the finished height field */
    const r1=clamp(Math.round(S*0.004),1,10),r2=clamp(Math.round(S*0.02),3,48);
    const b1=blurWrap(HGT,S,r1),b2=blurWrap(HGT,S,r2);
    const amp=Math.max(1e-6,SUB.amp+film);
    const aoStr=clamp(+Q.aoStr==null?0.8:+Q.aoStr,0,1);
    const dirt=clamp(+Q.dirt||0,0,1);
    for(let i=0;i<S*S;i++){
      const c1=clamp((b1[i]-HGT[i])/amp*0.9,0,1);
      const c2=clamp((b2[i]-HGT[i])/amp*0.5,0,1);
      const occ=clamp(c1*0.65+c2*0.75,0,1)*aoStr;
      AOc[i]=clamp(1-occ,0,1)*255;
      if(dirt>0&&c1>0.02){                          // grime settles where it is low
        const k=clamp(c1*1.2,0,1)*dirt*0.7;
        A[i*3]=lerp(A[i*3],74,k);
        A[i*3+1]=lerp(A[i*3+1],68,k);
        A[i*3+2]=lerp(A[i*3+2],60,k);
        RGH[i]=lerp(RGH[i],242,k);
      }
    }
    io.progress(0.88);

    hMin=Infinity;hMax=-Infinity;
    for(let i=0;i<S*S;i++){const h=HGT[i];if(h<hMin)hMin=h;if(h>hMax)hMax=h;}
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;

    /* heights are metres, so the slopes are real slopes */
    const gy=Q.flipG?-1:1,nst=+Q.normalStr||1;
    for(let yy=0;yy<S;yy++){
      const yp=((yy+1)%S)*S,ym=((yy-1+S)%S)*S,y0=yy*S;
      for(let xx=0;xx<S;xx++){
        const xp=(xx+1)%S,xm=(xx-1+S)%S;
        const sx=(HGT[y0+xp]-HGT[y0+xm])/(2*mpx)*nst;
        const sy=(HGT[yp+xx]-HGT[ym+xx])/(2*mpx)*nst;
        let nx=-sx,ny=-sy*gy;
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;
        const j=(y0+xx)*3;
        NRM[j]=(nx*0.5+0.5)*255;NRM[j+1]=(ny*0.5+0.5)*255;NRM[j+2]=(inv*0.5+0.5)*255;
      }
    }
    io.progress(1);
    io.done({A:A,RGH:RGH,MET:MET,AO:AOc,NRM:NRM,HGT:HGT,PK:PK,PS:PS,ID:ID,
             hMin:hMin,hMax:hMax});
  }

  io.progress(0.02);
  setTimeout(pass1,0);
}

/* ============================ mode definition ============================ */

const stdOptions=Object.keys(STANDARDS).map(k=>[k,STANDARDS[k].label]);

Forge.register({
  id:"hazard",
  label:"Hazard",
  blurb:"Seamless caution striping and floor marking, worn in",
  title:'Hazard <em>Marking</em>',
  tagline:"Striping · chevrons · chequer · worn floor · seamless",
  actionLabel:"Paint marking",
  busyLabel:"Painting…",
  seamless:true,
  previewSize:256,
  preview:{gain:3.1,amb:1.12,specK:0.55,skyLo:[0.14,0.16,0.20],skyHi:[0.32,0.36,0.44]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
    {key:"ao",label:"AO"},{key:"height",label:"Height"},{key:"orm",label:"ORM packed"},
    {key:"paint",label:"Paint α"},{key:"id",label:"Mat ID"}
  ],

  presets:[
    {id:"loading",label:"Loading bay",set:{tileM:2,pattern:"stripe",angleDeg:45,pitchMm:200,duty:0.5,
      snapMode:"angle",std:"osha_yb",sub:"conc",finish:"trowel",carrier:"paint",
      wear:0.45,chip:0.3,scratch:0.3,skid:0.4,dirt:0.45,oil:0.25,rust:0,effl:0.15,bleach:0.3,ghost:0}},
    {id:"aisle",label:"Forklift aisle",set:{tileM:3,pattern:"zebra",barMm:450,gapMm:450,std:"bw",
      sub:"conc",finish:"polish",carrier:"epoxy",wear:0.7,chip:0.35,scratch:0.45,skid:0.7,
      dirt:0.5,oil:0.35,bleach:0.35,trackM:1.2,ghost:0.25,ghostDeg:22}},
    {id:"firedoor",label:"Fire door keep-clear",set:{tileM:2,pattern:"cross",angleDeg:36.87,pitchMm:250,
      duty:0.25,snapMode:"pitch",std:"ansi_rw",sub:"conc",finish:"sealed",carrier:"paint",
      wear:0.25,chip:0.2,scratch:0.2,skid:0.2,dirt:0.35,bleach:0.25}},
    {id:"guard",label:"Machine guard",set:{tileM:0.6,pattern:"stripe",angleDeg:45,pitchMm:50,duty:0.5,
      snapMode:"angle",std:"orange_w",sub:"steel",carrier:"paint",weld:true,
      wear:0.2,chip:0.35,scratch:0.5,rust:0.45,dirt:0.3,skid:0,bleach:0.2}},
    {id:"radiation",label:"Radiation store",set:{tileM:1.5,pattern:"stripe",angleDeg:45,pitchMm:150,
      duty:0.5,snapMode:"angle",std:"mag_y",sub:"conc",finish:"sealed",carrier:"epoxy",
      wear:0.15,chip:0.1,scratch:0.15,dirt:0.2,skid:0.05,bleach:0.1}},
    {id:"dock",label:"Weathered dock plate",set:{tileM:1.2,pattern:"stripe",angleDeg:45,pitchMm:100,
      duty:0.5,snapMode:"angle",std:"osha_yb",sub:"plate",lugMm:45,carrier:"paint",
      wear:0.8,chip:0.75,scratch:0.6,skid:0.5,rust:0.6,dirt:0.6,oil:0.3,bleach:0.6}},
    {id:"fresh",label:"Fresh repaint",set:{tileM:2,pattern:"stripe",angleDeg:45,pitchMm:200,duty:0.5,
      snapMode:"angle",std:"osha_yb",sub:"conc",finish:"trowel",carrier:"thermo",
      wear:0.05,chip:0.03,scratch:0.05,skid:0.05,dirt:0.1,oil:0,bleach:0,ghost:0.45,ghostDeg:30}},
    {id:"helipad",label:"Chequer pad",set:{tileM:6,pattern:"check",squareMm:1500,std:"avi_ow",
      sub:"asph",aggMm:12,carrier:"paint",wear:0.35,chip:0.25,scratch:0.2,skid:0.3,
      dirt:0.4,bleach:0.45}}
  ],

  controls:[
    {title:"Scale & output",open:true,rows:[
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:Forge.sizes("square")},
      {id:"tileM",label:"Tile covers",unit:"m",min:0.4,max:8,step:0.1,value:2},
      {type:"readout"},
      {id:"seed",type:"seed",value:1974}
    ]},
    {title:"Pattern",open:true,rows:[
      {id:"pattern",type:"select",label:"Pattern",value:"stripe",options:[
        ["stripe","Diagonal hazard stripes"],["none","Bare floor — no marking"],["chev","Chevrons"],["zebra","Zebra edge bars"],
        ["check","Chequer"],["cross","Keep-clear crosshatch"],["solid","Solid zone"]]},
      {id:"angleDeg",need:"lin",label:"Stripe angle",unit:"°",min:0,max:90,step:0.5,value:45},
      {id:"pitchMm",need:"lin",label:"Stripe pitch",unit:"mm",min:20,max:1200,step:5,value:200},
      {id:"duty",need:"lin",label:"Duty",min:0.1,max:0.9,step:0.01,value:0.5},
      {id:"snapMode",need:"lin",type:"select",label:"Tiling snap",value:"angle",options:[
        ["angle","Snap both — closest exact tiling"],
        ["pitch","Hold the angle — quantise the pitch"],
        ["tile","Hold both — move the tile size"],
        ["off","Off — one-off piece, edges will not match"]]},
      {id:"chevDeg",need:"chev",label:"Chevron limb angle",unit:"°",min:15,max:75,step:1,value:45},
      {id:"chevCells",need:"chev",label:"Chevrons across",min:1,max:6,step:1,value:2},
      {id:"barMm",need:"zebra",label:"Bar width",unit:"mm",min:50,max:1200,step:10,value:450},
      {id:"gapMm",need:"zebra",label:"Gap",unit:"mm",min:50,max:1200,step:10,value:450},
      {id:"squareMm",need:"check",label:"Square",unit:"mm",min:50,max:3000,step:10,value:300},
      {type:"checks",need:"lin",items:[{id:"flip",label:"Mirror the slope",value:false}]}
    ]},
    {title:"Colour standard",open:true,rows:[
      {id:"std",type:"select",label:"Standard",value:"osha_yb",options:stdOptions},
      {type:"colors",label:"Colour A · B · substrate",items:[
        {id:"cA",value:"#ffcd00"},{id:"cB",value:"#1b1b1b"},{id:"cSub",value:"#b3afa6"}]},
      {id:"bleach",label:"UV bleaching",min:0,max:1,step:0.01,value:0.3},
      {type:"checks",items:[{id:"swap",label:"Swap the two colours",value:false}]}
    ]},
    {title:"Carrier",rows:[
      {id:"carrier",type:"select",label:"Laid as",value:"paint",options:[
        ["paint","Paint"],["epoxy","Epoxy floor coat"],["thermo","Thermoplastic"],
        ["tape","Applied tape"],["grit","Anti-slip grit"]]},
      {id:"filmScale",label:"Film thickness",min:0.2,max:3,step:0.05,value:1},
      {id:"bleed",label:"Overspray & bleed",min:0,max:1,step:0.01,value:0.2}
    ]},
    {title:"Substrate",open:true,rows:[
      {id:"sub",type:"select",label:"Floor",value:"conc",options:[
        ["conc","Concrete"],["plate","Steel diamond plate"],["steel","Steel plate"],["asph","Asphalt"]]},
      {id:"finish",need:"conc",type:"select",label:"Finish",value:"trowel",options:[
        ["trowel","Troweled"],["broom","Broom"],["polish","Polished"],["sealed","Sealed"]]},
      {id:"jointM",need:"conc",label:"Saw-cut joints every",unit:"m",min:0.5,max:12,step:0.5,value:4},
      {id:"craze",need:"conc",label:"Crazing",min:0,max:1,step:0.01,value:0.25},
      {id:"lugMm",need:"plate",label:"Lug length",unit:"mm",min:10,max:120,step:1,value:45},
      {id:"aggMm",need:"asph",label:"Top stone",unit:"mm",min:4,max:32,step:1,value:12},
      {type:"checks",need:"steel",items:[{id:"weld",label:"Weld seam",value:false}]}
    ]},
    {title:"Wear & traffic",open:true,rows:[
      {id:"wear",label:"Traffic wear",min:0,max:1,step:0.01,value:0.4},
      {id:"trackM",label:"Wheel track",unit:"m",min:0.4,max:3,step:0.05,value:1.1},
      {id:"chip",label:"Chipping to substrate",min:0,max:1,step:0.01,value:0.3},
      {id:"chipMm",label:"Chip size",unit:"mm",min:4,max:120,step:1,value:18},
      {id:"scratch",label:"Scratches",min:0,max:1,step:0.01,value:0.3},
      {id:"skid",label:"Tyre scuffs & skids",min:0,max:1,step:0.01,value:0.35}
    ]},
    {title:"Contamination",rows:[
      {id:"dirt",label:"Dirt",min:0,max:1,step:0.01,value:0.4},
      {id:"oil",label:"Oil & coolant",min:0,max:1,step:0.01,value:0.2},
      {id:"rust",label:"Rust bleed",min:0,max:1,step:0.01,value:0.2},
      {id:"effl",label:"Efflorescence",min:0,max:1,step:0.01,value:0.15},
      {id:"wet",label:"Wetness",min:0,max:1,step:0.01,value:0}
    ]},
    {title:"Repaint ghosting",rows:[
      {id:"ghost",label:"Old marking showing",min:0,max:1,step:0.01,value:0},
      {id:"ghostDeg",label:"Its angle",unit:"°",min:0,max:90,step:1,value:18},
      {type:"colors",label:"Ghost colour",items:[{id:"cGhost",value:"#8d8a80"}]}
    ]},
    {title:"Maps",rows:[
      {id:"normalStr",label:"Normal strength",min:0.1,max:3,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:0.8},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  needs:function(P){
    const n=[P.sub||"conc"];
    const pat=P.pattern||"stripe";
    if(pat!=="none")n.push("marked");
    if(pat==="stripe"||pat==="cross")n.push("lin");
    if(pat==="chev"){n.push("chev");n.push("lin");}
    if(pat==="zebra")n.push("zebra");
    if(pat==="check")n.push("check");
    return n;
  },

  /* Picking a standard writes its two colours; touching a swatch drops back to
     custom. Only ever writes on a real change, so it cannot fight the user. */
  derive:function(P,ui){
    const s=STANDARDS[P.std];
    if(P.std!==lastStd){
      lastStd=P.std;
      if(s&&s.a){ui.set("cA",s.a);ui.set("cB",s.b);}
    }else if(s&&s.a&&P.std!=="custom"&&
             (P.cA.toLowerCase()!==s.a.toLowerCase()||P.cB.toLowerCase()!==s.b.toLowerCase())){
      lastStd="custom";ui.set("std","custom");
    }
  },

  readout:function(P){
    const T=+P.tileM||2,S=P.size|0;
    const pxPerM=S/T;
    let m="<b>"+Math.round(pxPerM)+" px/m</b> · "+(1000/pxPerM).toFixed(1)+" mm per texel";
    const pat=P.pattern||"stripe";
    if(pat==="stripe"||pat==="cross"||pat==="chev"){
      const F=frequency(P,T);
      const pmm=F.p*1000,deg=F.theta/DEG;
      if(pat==="chev"){
        m+="<br>chevron limb <b>"+(+P.chevDeg).toFixed(0)+"°</b> held exactly · pitch snapped to <b>"+
           (T*Math.cos((+P.chevDeg)*DEG)/Math.max(1,Math.round(T*Math.cos((+P.chevDeg)*DEG)/(F.pReq)))*1000).toFixed(1)+" mm</b>";
      }else if(F.mode==="off"){
        m+="<br><b>"+(+P.pitchMm).toFixed(0)+" mm at "+(+P.angleDeg).toFixed(1)+"°</b>"+
           ' <span class="warn">— snap off: the edges will not match</span>';
      }else if(F.mode==="tile"){
        const Tex=tileForExact(P);
        m+="<br><b>"+(+P.pitchMm).toFixed(0)+" mm at "+(+P.angleDeg).toFixed(2)+"°</b> exactly"+
           "<br>needs a tile of <b>"+Tex.toFixed(3)+" m</b>"+
           (Math.abs(Tex-T)>0.005?' <span class="warn">— set Tile covers to that</span>':" ✓");
      }else{
        m+="<br>built at <b>"+pmm.toFixed(1)+" mm at "+deg.toFixed(2)+"°</b>"+
           " (asked "+(+P.pitchMm).toFixed(0)+" mm at "+(+P.angleDeg).toFixed(1)+"°)"+
           "<br>repeats <b>"+Math.abs(F.a)+"×"+Math.abs(F.b)+"</b> across the tile — exact";
        const err=Math.abs(pmm-(+P.pitchMm))/Math.max(1,+P.pitchMm);
        if(err>0.06)m+='<br><span class="warn">'+(err*100).toFixed(0)+
          "% off the asked pitch — a bigger tile snaps closer</span>";
      }
      const px=F.p*pxPerM;
      m+="<br>band <b>"+(px*(+P.duty||0.5)).toFixed(1)+" px</b>";
      if(px*Math.min(+P.duty||0.5,1-(+P.duty||0.5))<2)
        m+=' <span class="warn">— sub-pixel band, raise resolution or pitch</span>';
    }else if(pat==="zebra"){
      const barM=(+P.barMm||450)/1000,gapM=(+P.gapMm||450)/1000;
      const n=Math.max(1,Math.round(T/(barM+gapM)));
      m+="<br><b>"+n+"</b> bars across the tile at <b>"+(T/n*1000).toFixed(0)+" mm</b> pitch (asked "+
         ((barM+gapM)*1000).toFixed(0)+")";
    }else if(pat==="check"){
      const sq=(+P.squareMm||300)/1000;
      let n=Math.max(2,Math.round(T/sq));
      if(n&1)n+=(Math.abs(T/(n+1)-sq)<Math.abs(T/(n-1)-sq))?1:-1;
      n=Math.max(2,n);
      m+="<br><b>"+n+"×"+n+"</b> squares of <b>"+(T/n*1000).toFixed(0)+" mm</b>"+
         " — count forced even so the colours alternate across the wrap";
    }
    const s=STANDARDS[P.std];
    if(s&&s.note)m+="<br>"+s.note;
    return m;
  },

  tileTag:function(P){
    const pat=P.pattern||"stripe";
    const lin=(pat==="stripe"||pat==="cross");
    return (lin&&(P.snapMode==="off"))?"single piece — edges do not match":"tiles ↔ and ↕";
  },

  size:function(P,preview){
    const S=preview?Math.min(P.size|0,256):(P.size|0);
    return {w:S,h:S};
  },
  build:build,

  writers:function(B,P){
    const cA=hex2rgb(P.swap?P.cB:P.cA),cB=hex2rgb(P.swap?P.cA:P.cB);
    const PK=B.PK,PS=B.PS,ID=B.ID;
    return {
      paint:function(i,o,k){
        const s=PS[i]/255;
        o[k]=lerp(cB[0],cA[0],s);o[k+1]=lerp(cB[1],cA[1],s);o[k+2]=lerp(cB[2],cA[2],s);
        return PK[i];
      },
      id:function(i,o,k){
        const c=IDCOL[ID[i]]||IDCOL[0];
        o[k]=c[0];o[k+1]=c[1];o[k+2]=c[2];
        return 255;
      }
    };
  },

  sizeTag:function(P){return (+P.tileM).toFixed(1)+" m · "+(P.pattern||"stripe");},
  fileBase:function(P,W){return "hazard_"+(P.pattern||"stripe")+"_"+(P.seed|0)+"_"+W;},

  readme:function(P,info){
    const T=+P.tileM||2;
    const F=frequency(P,T);
    const lin=(P.pattern==="stripe"||P.pattern==="cross"||P.pattern==="chev");
    const s=STANDARDS[P.std]||{};
    return ["Texture Forge · hazard — caution striping and floor marking",
      "",
      "Pattern: "+(P.pattern||"stripe")+"   Seed: "+(P.seed|0)+"   Resolution: "+info.W+"x"+info.H,
      "Tile covers "+T.toFixed(3)+" m x "+T.toFixed(3)+" m  ("+(info.W/T).toFixed(1)+" px per metre)",
      s.label?("Colours: "+s.label+(s.note?" — "+s.note:"")):"",
      "",
      lin?("Built at "+(F.p*1000).toFixed(2)+" mm pitch on "+(F.theta/DEG).toFixed(3)+" degrees, "+
        "repeating "+Math.abs(F.a)+" x "+Math.abs(F.b)+" times across the tile."):"",
      lin&&P.snapMode!=="off"
        ? ("A diagonal stripe field only tiles when its frequency components are whole\n"+
           "numbers of repeats per tile edge, so the angle and pitch were snapped to the\n"+
           "nearest pair that does. If you need an exact angle AND an exact pitch, set the\n"+
           "snap to 'hold both' and use the tile size it asks for.")
        : (lin?"Snap was off: this piece does NOT tile — use it as a one-off.":""),
      "",
      "Scale the plane to the metre figure above and the striping comes out at the",
      "real width it was designed at; marking widths are set in millimetres.",
      "",
      "basecolor.png  sRGB albedo. Import as sRGB / colour data.",
      "normal.png     Tangent-space normal, "+info.normalNote+". Non-colour / linear.",
      "roughness.png  Linear grey.",
      "metallic.png   Real content on the steel substrates only: paint, tape, grit, rust",
      "               and concrete are all dielectric and read 0.",
      "ao.png         Linear grey ambient occlusion.",
      "height.png     Linear grey displacement, 0-1 spanning "+((info.hMax-info.hMin)*1000).toFixed(2)+
        " mm of real relief.",
      "height16.png   The same field at 16 bits — the paint film is a tenth of a",
      "               millimetre on top of millimetre-scale floor, so 8 bits is coarse.",
      "orm.png        Packed: R = AO, G = roughness, B = metallic.",
      "paint.png      The marking on its own: paint colour with coverage in alpha, after",
      "               wear and chipping but before dirt, rust and rubber — drop it over",
      "               your own floor as a decal.",
      "id.png         Flat material ids: substrate grey, paint A yellow, paint B black,",
      "               tape blue, grit violet, bare metal silver, rust orange-brown,",
      "               rubber black, oil teal, efflorescence white.",
      "",
      "Normal strength was baked at "+(+P.normalStr).toFixed(2)+"x."].join("\n");
  }
});

})();
