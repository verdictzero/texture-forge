/* =====================================================================
   MODE: street — asphalt and street layout
   =====================================================================
   Everything is dimensioned in real metres, so zooming out adds detail
   rather than magnifying it. Surface, distress, markings, kerb and
   footway. The asphalt always tiles both ways; only the markings decide
   whether a piece repeats.

   Was street-forge.html; the generator below is unchanged, so seeds and
   exports match the standalone tool.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,mulberry32=Forge.mulberry32,
      hashi=Forge.hashi,vnoise=Forge.vnoise,fbm=Forge.fbm,vnoise2=Forge.vnoise2,fbm2=Forge.fbm2,
      hex2rgb=Forge.hex2rgb,boxBlurWrap=Forge.blurWrap;

/* the live parameter set, refreshed by build() before anything reads it */
let P={};

/* which pieces tile in which direction. the asphalt itself always tiles both
   ways; it is the markings that make a piece terminal. */
const PIECE_TILING={
  none:"both",cross:"u",edge:"u",centre:"u",lane:"u",parking:"u",
  stop:"none",crosswalk:"none",arrow_s:"none",arrow_l:"none",arrow_r:"none",inter:"none"
};
const PIECE_NEEDS={
  none:[],cross:["road"],edge:["road"],centre:["road"],lane:["road"],
  stop:["road"],crosswalk:["road","cw"],arrow_s:["road"],arrow_l:["road"],arrow_r:["road"],
  inter:["road","cw","int"],parking:["road","park"]
};

let W_f1=0,W_f2=0,W_cx=0,W_cy=0,W_dx=0,W_dy=0;
function worley(x,y,N,seed,jit){
  const xi=Math.floor(x),yi=Math.floor(y);
  let d1=1e9,d2=1e9,bx=0,by=0,ex=0,ey=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const cx=xi+dx,cy=yi+dy;
    const wx=((cx%N)+N)%N,wy=((cy%N)+N)%N;
    const fx=cx+0.5+(hashi(wx,wy,seed)-0.5)*jit;
    const fy=cy+0.5+(hashi(wx,wy,seed+7717)-0.5)*jit;
    const ax=x-fx,ay=y-fy,d=ax*ax+ay*ay;
    if(d<d1){d2=d1;d1=d;bx=wx;by=wy;ex=ax;ey=ay;}
    else if(d<d2)d2=d;
  }
  W_f1=Math.sqrt(d1);W_f2=Math.sqrt(d2);W_cx=bx;W_cy=by;W_dx=ex;W_dy=ey;
}
const ROT=(function(){const t=new Float32Array(128);
  for(let i=0;i<64;i++){const a=i/64*Math.PI*0.5;t[i*2]=Math.cos(a);t[i*2+1]=Math.sin(a);}
  return t;})();

/* ============================ drawn detail layers ============================ */
/* R = long cracks, G = patch fill, B = patch seam */
function buildDetail(D){
  const rng=mulberry32((P.seed|0)*7717+29);
  const c=document.createElement("canvas");c.width=c.height=D;
  const g=c.getContext("2d",{willReadFrequently:true});
  g.fillStyle="#000";g.fillRect(0,0,D,D);
  const nine=(fn)=>{for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){g.save();g.translate(ox*D,oy*D);fn();g.restore();}};
  const np=P.patches|0;
  for(let i=0;i<np;i++){
    const cx=rng()*D,cy=rng()*D;
    const rx=D*(0.07+rng()*0.16),ry=D*(0.06+rng()*0.15);
    const nv=11+Math.floor(rng()*8),pts=[];
    for(let k=0;k<nv;k++){
      const a=k/nv*Math.PI*2,jr=0.62+rng()*0.72;
      pts.push([cx+Math.cos(a)*rx*jr,cy+Math.sin(a)*ry*jr]);
    }
    nine(()=>{
      g.beginPath();g.moveTo(pts[0][0],pts[0][1]);
      for(let k=1;k<pts.length;k++)g.lineTo(pts[k][0],pts[k][1]);
      g.closePath();
      g.fillStyle="rgba(0,255,0,1)";g.fill();
      g.strokeStyle="rgba(0,0,255,0.95)";g.lineWidth=Math.max(1.5,D*0.006);g.lineJoin="round";g.stroke();
    });
  }
  const nc=Math.round(P.longCrack*14);
  g.lineCap="round";
  const walk=(x,y,ang,len,w,depth)=>{
    const steps=Math.max(3,Math.round(len/(D*0.02)));
    let px=x,py=y,a=ang;
    for(let s=0;s<steps;s++){
      a+=(rng()-0.5)*0.30;
      const nx=px+Math.cos(a)*len/steps,ny=py+Math.sin(a)*len/steps;
      const alpha=0.55+rng()*0.45;
      nine(()=>{
        g.strokeStyle="rgba(255,0,0,"+alpha.toFixed(3)+")";
        g.lineWidth=w*(0.6+rng()*0.5)*(1-s/steps*0.55);
        g.beginPath();g.moveTo(px,py);g.lineTo(nx,ny);g.stroke();
      });
      if(depth>0&&rng()<0.06)walk(nx,ny,a+(rng()<0.5?1:-1)*(0.5+rng()*0.6),len*0.4,w*0.55,depth-1);
      px=nx;py=ny;
    }
  };
  for(let i=0;i<nc;i++)
    walk(rng()*D,rng()*D,rng()*Math.PI*2,D*(0.15+rng()*0.5),Math.max(1,D/1024*(1.2+rng()*3)),2);
  return g.getImageData(0,0,D,D).data;
}

/* ---------- markings stencil, drawn entirely in metres ----------
   R = paint coverage, G = 255 where the paint is yellow.
   The road runs along +u (left to right), so longitudinal lines sit at
   constant v and repeat forever; transverse work sits at constant u.        */
function buildMarkings(DM){
  const c=document.createElement("canvas");c.width=c.height=DM;
  const g=c.getContext("2d",{willReadFrequently:true});
  g.fillStyle="#000";g.fillRect(0,0,DM,DM);
  const piece=P.piece;
  if(piece==="none")return g.getImageData(0,0,DM,DM).data;

  const M=DM/P.tileM;                       // pixels per metre
  const C=DM*0.5;                           // tile centre in px
  const W=(yl)=>yl?"rgba(255,255,0,1)":"rgba(255,0,0,1)";
  const lw=Math.max(1,P.lineW*M);
  const laneEdge=P.lanes*P.laneW*0.5*M;     // edge-line offset from road centre
  const halfRoad=laneEdge+P.shoulderW*M;
  const OUT=DM*2;                           // draw well past the tile so lines wrap

  const rect=(x,y,w,h,yl)=>{if(w<=0||h<=0)return;g.fillStyle=W(yl);g.fillRect(x,y,w,h);};
  const hSeg=(y,x0,x1,w,yl)=>rect(x0,y-w/2,x1-x0,w,yl);
  const vSeg=(x,y0,y1,w,yl)=>rect(x-w/2,y0,w,y1-y0,yl);
  const poly=(pts,yl)=>{
    g.fillStyle=W(yl);g.beginPath();g.moveTo(pts[0][0],pts[0][1]);
    for(let i=1;i<pts.length;i++)g.lineTo(pts[i][0],pts[i][1]);
    g.closePath();g.fill();
  };
  /* dashes must divide the tile exactly or the piece stops tiling, so the
     requested cycle is snapped to the nearest whole number of repeats */
  const snapCycle=()=>{
    const per=Math.max(0.2,P.dashLen+P.dashGap);
    const n=Math.max(1,Math.round(P.tileM/per));
    return {n:n,pp:DM/n,duty:P.dashLen/per};
  };
  const hDash=(y,w,yl,x0,x1)=>{
    const s=snapCycle();
    for(let k=-1;k<=s.n;k++){
      const sx=k*s.pp,ex=sx+s.pp*s.duty;
      hSeg(y,Math.max(x0,sx),Math.min(x1,ex),w,yl);
    }
  };
  const vDash=(x,w,yl,y0,y1)=>{
    const s=snapCycle();
    for(let k=-1;k<=s.n;k++){
      const sy=k*s.pp,ey=sy+s.pp*s.duty;
      vSeg(x,Math.max(y0,sy),Math.min(y1,ey),w,yl);
    }
  };

  /* ---- one road's longitudinal set, clipped to x0..x1 ---- */
  function longitudinal(x0,x1,horizontal){
    const seg=(off,wid,yl,dashed)=>{
      if(horizontal){
        if(dashed)hDash(C+off,wid,yl,x0,x1);else hSeg(C+off,x0,x1,wid,yl);
      }else{
        if(dashed)vDash(C+off,wid,yl,x0,x1);else vSeg(C+off,x0,x1,wid,yl);
      }
    };
    if(P.edgeType!=="none"){
      seg(-laneEdge,lw,P.edgeType==="wy",false);
      seg(laneEdge,lw,false,false);
    }
    const ct=P.centreType;
    if(ct!=="none"){
      const yl=ct.indexOf("_y")>0;
      if(ct==="double_y"){const o=lw*1.6;seg(-o,lw,true,false);seg(o,lw,true,false);}
      else seg(0,lw,yl,ct.indexOf("dash")===0);
    }
    if(P.laneDash){
      const n=P.lanes|0;
      for(let k=1;k<n;k++){
        const off=(k*P.laneW-n*P.laneW*0.5)*M;
        if(Math.abs(off)<lw)continue;             // that boundary is the centre line
        seg(off,lw,false,true);
      }
    }
  }

  /* ---- crosswalk band centred on cx, bars parallel to travel ---- */
  function crosswalk(cx,horizontal,y0,y1){
    const dep=P.cwDepth*M,bw=P.cwBarW*M,gap=P.cwGap*M;
    const a=cx-dep/2,b=cx+dep/2;
    if(P.cwStyle==="transverse"){
      if(horizontal){vSeg(a+bw/2,y0,y1,bw,false);vSeg(b-bw/2,y0,y1,bw,false);}
      else{hSeg(a+bw/2,y0,y1,bw,false);hSeg(b-bw/2,y0,y1,bw,false);}
      return;
    }
    if(P.cwStyle==="ladder"){
      if(horizontal){vSeg(a+bw/2,y0,y1,bw,false);vSeg(b-bw/2,y0,y1,bw,false);}
      else{hSeg(a+bw/2,y0,y1,bw,false);hSeg(b-bw/2,y0,y1,bw,false);}
    }
    const step=bw+gap;
    const n=Math.max(1,Math.floor((y1-y0)/step));
    const pad=((y1-y0)-n*step+gap)/2;
    for(let k=0;k<n;k++){
      const p=y0+pad+k*step;
      if(P.cwStyle==="zebra"){
        const sk=dep*0.35;
        if(horizontal)poly([[a+sk,p],[b,p],[b-sk,p+bw],[a,p+bw]],false);
        else poly([[p,a+sk],[p,b],[p+bw,b-sk],[p+bw,a]],false);
      }else{
        if(horizontal)rect(a,p,dep,bw,false);
        else rect(p,a,bw,dep,false);
      }
    }
  }

  /* ---- turn arrow: a stroked spine plus a filled head ---- */
  function arrow(cx,cy,kind){
    const sw=0.35*M,headL=1.0*M,hw=0.6*M;
    g.strokeStyle=W(false);g.lineWidth=sw;g.lineCap="butt";g.lineJoin="round";
    if(kind==="arrow_s"){
      const x1=cx+1.75*M;
      g.beginPath();g.moveTo(cx-1.75*M,cy);g.lineTo(x1-headL,cy);g.stroke();
      poly([[x1,cy],[x1-headL,cy-hw],[x1-headL,cy+hw]],false);
    }else{
      const s=(kind==="arrow_l")?-1:1;      // left turn heads towards -v
      const R=0.6*M,bx=cx+0.6*M,tipY=cy+s*1.9*M;
      g.beginPath();
      g.moveTo(cx-1.75*M,cy);
      g.lineTo(bx-R,cy);
      for(let i=1;i<=10;i++){               // quarter arc as a polyline
        const t=i/10*Math.PI/2;
        g.lineTo(bx-R+Math.sin(t)*R,cy+s*(1-Math.cos(t))*R);
      }
      g.lineTo(bx,tipY-s*headL);
      g.stroke();
      poly([[bx,tipY],[bx-hw,tipY-s*headL],[bx+hw,tipY-s*headL]],false);
    }
  }

  /* ---------- assemble the requested piece ---------- */
  if(piece==="cross"||piece==="edge"||piece==="centre"||piece==="lane"){
    const save={edgeType:P.edgeType,centreType:P.centreType,laneDash:P.laneDash};
    if(piece==="edge"){P.centreType="none";P.laneDash=false;}
    if(piece==="centre"){P.edgeType="none";P.laneDash=false;}
    if(piece==="lane"){P.edgeType="none";P.centreType="none";P.laneDash=true;}
    longitudinal(-OUT,OUT,true);
    P.edgeType=save.edgeType;P.centreType=save.centreType;P.laneDash=save.laneDash;
  }
  else if(piece==="stop"){
    longitudinal(-OUT,OUT,true);
    vSeg(C,C-halfRoad,C,Math.max(2,0.4*M),false);   // spans the approach half only
  }
  else if(piece==="crosswalk"){
    const dep=P.cwDepth*M*0.5;
    longitudinal(-OUT,C-dep,true);
    longitudinal(C+dep,OUT,true);
    crosswalk(C,true,C-halfRoad,C+halfRoad);
  }
  else if(piece==="arrow_s"||piece==="arrow_l"||piece==="arrow_r"){
    longitudinal(-OUT,OUT,true);
    arrow(C,C-P.laneW*0.5*M,piece);
  }
  else if(piece==="parking"){
    longitudinal(-OUT,OUT,true);
    const sw=P.stallW*M,sl=P.stallL*M;
    const n=Math.max(1,Math.round(P.tileM/P.stallW)),pp=DM/n;
    for(let k=-1;k<=n;k++)for(const s of[-1,1]){
      const x=k*pp;
      vSeg(x,s<0?C-halfRoad:C+halfRoad-sl,s<0?C-halfRoad+sl:C+halfRoad,Math.max(1,lw*0.8),false);
    }
  }
  else if(piece==="inter"){
    const box=halfRoad;                       // the junction square
    const setback=(P.interCross?P.cwDepth*M+0.9*M:0.9*M);
    const stopAt=box+setback;
    // longitudinal lines of both roads, stopping short of the junction
    longitudinal(-OUT,C-stopAt,true);
    longitudinal(C+stopAt,OUT,true);
    longitudinal(-OUT,C-stopAt,false);
    longitudinal(C+stopAt,OUT,false);
    // rounded corners tying the two roads' edge lines together
    const R=P.interRadius*M;
    if(R>0&&P.edgeType!=="none"){
      g.strokeStyle=W(false);g.lineWidth=lw;g.lineCap="butt";
      for(const sx of[-1,1])for(const sy of[-1,1]){
        g.beginPath();
        for(let i=0;i<=14;i++){
          const t=i/14*Math.PI/2;
          const px=C+sx*(laneEdge+R-R*Math.sin(t));
          const py=C+sy*(laneEdge+R-R*Math.cos(t));
          if(i===0)g.moveTo(px,py);else g.lineTo(px,py);
        }
        g.stroke();
      }
    }
    if(P.interCross){
      crosswalk(C-box-P.cwDepth*M*0.5,true,C-box,C+box);
      crosswalk(C+box+P.cwDepth*M*0.5,true,C-box,C+box);
      crosswalk(C-box-P.cwDepth*M*0.5,false,C-box,C+box);
      crosswalk(C+box+P.cwDepth*M*0.5,false,C-box,C+box);
    }
    if(P.interStop){
      const bw=Math.max(2,0.4*M);
      vSeg(C-stopAt+bw/2,C-halfRoad,C,bw,false);
      vSeg(C+stopAt-bw/2,C,C+halfRoad,bw,false);
      hSeg(C-stopAt+bw/2,C,C+halfRoad,bw,false);
      hSeg(C+stopAt-bw/2,C-halfRoad,C,bw,false);
    }
  }
  return g.getImageData(0,0,DM,DM).data;
}

/* ============================ the generator ============================ */

function build(params,io){
  P=params;
  const S=io.W;
  let hMin=0,hMax=1;
  const seed=P.seed|0;
  const TM=P.tileM;                    // tile edge length in metres
  const D=Math.min(S,1024),det=buildDetail(D);
  const DM=Math.min(S,2048),mk=buildMarkings(DM);

  const A=new Uint8ClampedArray(S*S*3);
  const RGH=new Uint8ClampedArray(S*S);
  const MET=new Uint8ClampedArray(S*S);
  const AOc=new Uint8ClampedArray(S*S);
  const NRM=new Uint8ClampedArray(S*S*3);
  const HGT=new Float32Array(S*S);
  const MK=new Uint8ClampedArray(S*S);
  const MKY=new Uint8ClampedArray(S*S);

  const bit=hex2rgb(P.cBitumen),stA=hex2rgb(P.cStoneA),stB=hex2rgb(P.cStoneB);
  const white=[236,235,230],yellow=[226,176,37];

  /* everything below is in METRES, converted to tile units only at the end */
  const aggM=P.aggMm/1000;
  const N1=Math.max(4,Math.round(TM/aggM));
  const N2=N1*2,N3=N1*4;
  const H1=aggM*0.38*P.protrude,H2=H1*0.5,H3=H1*0.26;
  const NC=Math.max(4,Math.round(TM/P.crackCellM));
  const crackDepth=P.crackD*0.020;
  const potholeDepth=0.055;
  const paintH=0.0025;
  const rutDepth=P.rut*0.022;
  const warpAmt=P.angular*0.006;
  const afg=seed+947;
  /* a grade finer than a couple of texels only adds aliasing, so drop it */
  const useG2=(S/N2)>=2.2, useG3=(S/N3)>=2.2;
  const texCell1=N1/S,texCell2=N2/S,texCell3=N3/S,texCellC=NC/S;

  function sdet(u,v,ch){
    const x=u*D-0.5,y=v*D-0.5;
    const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
    const X0=((x0%D)+D)%D,X1=(X0+1)%D,Y0=((y0%D)+D)%D,Y1=(Y0+1)%D;
    const a=det[(Y0*D+X0)*4+ch],b=det[(Y0*D+X1)*4+ch];
    const c=det[(Y1*D+X0)*4+ch],d=det[(Y1*D+X1)*4+ch];
    return (a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy)/255;
  }
  function smk(u,v,ch){
    const x=u*DM-0.5,y=v*DM-0.5;
    const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
    const X0=((x0%DM)+DM)%DM,X1=(X0+1)%DM,Y0=((y0%DM)+DM)%DM,Y1=(Y0+1)%DM;
    const a=mk[(Y0*DM+X0)*4+ch],b=mk[(Y0*DM+X1)*4+ch];
    const c=mk[(Y1*DM+X0)*4+ch],d=mk[(Y1*DM+X1)*4+ch];
    return (a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy)/255;
  }
  const wrapD=(a,b)=>{const d=Math.abs(a-b);return d<0.5?d:1-d;};

  /* wheel paths sit either side of each lane centre; in tile-v units */
  const wheelOff=[];
  {
    const n=Math.max(1,P.lanes|0);
    for(let k=0;k<n;k++){
      const laneC=(k+0.5)*P.laneW-n*P.laneW*0.5;
      wheelOff.push((laneC-0.85)/TM+0.5,(laneC+0.85)/TM+0.5);
    }
  }
  function wheel(v){
    let m=0;const sg=1.0/TM*0.9;
    for(let i=0;i<wheelOff.length;i++){
      const d=wrapD(v,wheelOff[i]-Math.floor(wheelOff[i]))/sg;
      const e=Math.exp(-d*d);
      if(e>m)m=e;
    }
    return m;
  }
  const jointV=(hashi(11,29,seed+1301));         // paving joint position

  /* ---- kerb, gutter and footway geometry, all in metres ---- */
  const KERB=P.kerb!=="none";
  const gutterW=P.gutterW,panDrop=0.022;
  const faceW=0.05,topEnd=faceW+P.curbTop,walkEnd=topEnd+P.walkW;
  const kerbOff=P.lanes*P.laneW*0.5+P.shoulderW+gutterW;   // centre to kerb line
  const conc0=hex2rgb(P.cConcrete);
  const CURB_PAINT={red:[168,50,42],yellow:[217,165,32],white:[232,230,224]}[P.curbPaint]||null;
  const nSlab=Math.max(1,Math.round(TM/P.slabL));           // snapped so joints tile
  const jointW=0.008,jointD=P.jointDmm/1000;
  const NG=Math.max(4,Math.round(TM/0.005));                // 5 mm exposed sand
  const useGrain=(S/NG)>=2.5;
  const NBu=Math.max(4,Math.round(TM/0.008));               // broom striations
  const useBroom=(S/NBu)>=2.5;

  /* ---- edge decay: the surface eaten in from the tile's own edges ----
     Layered twice over. The NOISE is layered — chunk, block and crumb bands of
     it — and so is the ROAD: the wearing course goes first, the binder course
     under it next, then the granular base, then subgrade, each eaten back a
     little less far than the one above it. That is what gives a real broken
     edge its concentric strata rather than one clean bite. Any combination of
     the four sides can be on; whichever are, that axis stops tiling, and the
     tag under the preview says which ones still do. */
  const DECAY=(P.decT||P.decB||P.decL||P.decR)&&P.decay>0;
  const decReach=Math.max(0.02,P.decReach);
  const decDrive=0.45+P.decay*1.35;
  const decD=P.decDeep/1000;                                // the whole stack, in metres
  const NDa=Math.max(4,Math.round(TM/Math.max(0.05,P.decChunk)));
  const NDb=NDa*3,NDc=NDa*9,NDcr=NDa*15;
  const useDecC=(S/NDc)>=2.2,useDecCr=(S/NDcr)>=2.2;
  const NDs=Math.max(4,Math.round(TM/0.03));                // 30 mm crushed base stone
  const useDecS=(S/NDs)>=2.5;
  const NDr=Math.max(4,Math.round(TM/Math.max(0.06,P.decChunk*0.55)));
  const useDecR=(S/NDr)>=2.2;
  const cBase=hex2rgb(P.cBase),cSub=hex2rgb(P.cSub);

  const band=Math.max(4,Math.round(24576/S));
  let y=0;

  function pass1(){
    const end=Math.min(S,y+band);
    for(;y<end;y++){
      const v=(y+0.5)/S;
      const wp=(P.rut>0||P.polish>0)?wheel(v):0;
      for(let x=0;x<S;x++){
        const u=(x+0.5)/S,i=y*S+x;

        /* ---- distance past the kerb line; negative means still on the road ---- */
        let dK=-1e9,conc=0;
        if(KERB){
          const a=Math.abs(v-0.5)*TM-kerbOff;
          if(P.piece==="inter"){
            // the two corridors cross, so the corner is filleted by the kerb radius
            const bq=Math.abs(u-0.5)*TM-kerbOff;
            const R=Math.max(0.02,P.interRadius);
            dK=(a<R&&bq<R)?(R-Math.sqrt((a-R)*(a-R)+(bq-R)*(bq-R))):Math.min(a,bq);
          }else dK=a;
          dK+=(fbm(u,v,140,2,seed+151)-0.5)*0.014;      // the joint is never dead straight
          conc=smoothstep(-gutterW-0.015,-gutterW+0.015,dK);
          if(conc>0.999)conc=1;else if(conc<0.001)conc=0;
        }

        let h=0,r=0,g2=0,b=0,rough=0.8,aggH=0,crack=0,hole=0,stoneTopG=0,recess=0;
        if(conc<1){

        const wu=u+(fbm(u,v,10,2,seed+5)-0.5)*warpAmt;
        const wv=v+(fbm(u,v,10,2,seed+9)-0.5)*warpAmt;
        const ragN=P.angular>0?fbm(u,v,N1*3,2,afg):0.5;

        /* ---- binder bed (metres) ---- */
        h=(fbm(u,v,80,4,seed+13)-0.5)*0.0008;
        h+=(fbm(u,v,6,3,seed+17)-0.5)*0.004;
        h-=rutDepth*wp;
        r=bit[0];g2=bit[1];b=bit[2];
        rough=P.rBinder;
        let stoneTop=0;

        /* ---- paving joint: the seam between two laid passes ---- */
        if(P.joint>0){
          const jd=wrapD(v,jointV)*TM;                       // metres from the joint
          const jl=1-smoothstep(0,0.02,jd);
          h-=jl*0.003*P.joint;
          const side=(v>jointV)===(wrapD(v,jointV)===Math.abs(v-jointV))?1:0;
          const tint=lerp(1,side?1.05:0.95,P.joint*0.5);
          r*=tint;g2*=tint;b*=tint;
        }

        /* ---- aggregate, coarse to fine, with texel-aware edges ---- */
        for(let gr=0;gr<3;gr++){
          if(gr===1&&!useG2)break;
          if(gr===2&&!useG3)break;
          const N=gr===0?N1:(gr===1?N2:N3);
          const Hs=gr===0?H1:(gr===1?H2:H3);
          const tex=gr===0?texCell1:(gr===1?texCell2:texCell3);
          const cov=P.coverage*(gr===0?1:(gr===1?0.85:0.7));
          worley(wu*N,wv*N,N,seed+101+gr*37,0.9);
          const f1=W_f1,cx=W_cx,cy=W_cy;
          const idB=hashi(cx,cy,seed+307+gr*13);
          if(idB>cov)continue;
          const idA=hashi(cx,cy,seed+201+gr*13);
          const ri=(hashi(cx,cy,seed+911+gr)*64|0)*2;
          const rc=ROT[ri],rs=ROT[ri+1];
          const px=W_dx*rc+W_dy*rs,py=-W_dx*rs+W_dy*rc;
          const px1=px<0?-px:px,py1=py<0?-py:py;
          const oct=Math.max(px1>py1?px1:py1,(px1+py1)*0.7071);
          const dm=f1+(oct-f1)*P.angular;
          const rag=1+(ragN-0.5)*0.5*P.angular;
          const rad=(0.20+idA*0.30*(0.4+P.sizeVar))*rag;
          const d=dm/rad;
          if(d>1.15)continue;
          // widen the edge to at least one texel or the stones alias when zoomed out
          const aa=tex/rad;
          const m=1-smoothstep(1.0-Math.max(0.16,aa*1.3),1.02+aa*0.7,d);
          if(m<=0)continue;
          const cap=Math.sqrt(Math.max(0,1-Math.min(d,1)*Math.min(d,1)));
          const hs=Hs*(0.55+idA*0.75)*(0.35+0.65*cap);
          if(hs*m>aggH)aggH=hs*m;
          h+=hs*m;
          const mixv=hashi(cx,cy,seed+409+gr*13);
          const dark=mixv>P.stoneMix?1:0;
          const tone=0.82+idA*0.36;
          const film=0.30*(1-P.ravel*0.45);
          const sr=lerp(lerp(stA[0],stB[0],dark)*tone,bit[0],film);
          const sg=lerp(lerp(stA[1],stB[1],dark)*tone,bit[1],film);
          const sb=lerp(lerp(stA[2],stB[2],dark)*tone,bit[2],film);
          r=lerp(r,sr,m);g2=lerp(g2,sg,m);b=lerp(b,sb,m);
          rough=lerp(rough,P.rStone*(0.85+idB*0.3),m);
          if(m>stoneTop)stoneTop=m;
        }

        const fineN=P.fines>0?fbm(u,v,220,3,seed+23):0.4;
        const fill=P.fines*(1-stoneTop);
        h+=fill*aggM*0.10*(fineN-0.4);
        const fc=lerp(1,1.18,fill*fineN);
        r*=fc;g2*=fc;b*=fc;
        rough=lerp(rough,0.92,fill*0.35);

        const ravelField=P.ravel>0?smoothstep(0.42,0.78,fbm(u,v,7,3,seed+31))*P.ravel:0;
        h-=ravelField*aggM*0.45*(1-stoneTop*0.6);
        rough=lerp(rough,0.95,ravelField*0.5);
        const rd=lerp(1,0.82,ravelField*0.7);
        r*=rd;g2*=rd;b*=rd;

        if(P.pothole>0){
          const pc=Math.max(2,Math.round(TM/1.6));           // potholes about 1.6 m apart
          worley(u*pc+(fbm(u,v,26,3,seed+41)-0.5)*0.6,v*pc+(fbm(u,v,26,3,seed+43)-0.5)*0.6,pc,seed+503,0.95);
          if(hashi(W_cx,W_cy,seed+601)<P.pothole*0.5){
            const rr=0.16+hashi(W_cx,W_cy,seed+607)*0.2;
            hole=Math.pow(1-smoothstep(rr*0.80,rr*1.0,W_f1),0.65);
            h-=hole*potholeDepth*(0.5+P.pothole*0.8);
            h+=(fbm(u,v,140,3,seed+47)-0.5)*aggM*0.6*hole;
            const hd=lerp(1,0.7,hole);
            r*=hd;g2*=hd;b*=hd;
            rough=lerp(rough,0.95,hole);
          }
        }

        /* ---- cracking ---- */
        const cw=(P.crackWmm/1000)/P.crackCellM;             // width in cell units
        const region=P.alligator>0?smoothstep(0.40,0.68,fbm(u,v,5,2,seed+61)):0;
        crack=0;
        if(region*P.alligator>0.02){
          const rw=region*P.alligator;
          const ew=Math.max(cw,texCellC*1.2);
          worley(u*NC+(fbm(u,v,9,2,seed+53)-0.5)*1.4,v*NC+(fbm(u,v,9,2,seed+59)-0.5)*1.4,NC,seed+701,0.95);
          crack=(1-smoothstep(0,ew,W_f2-W_f1))*rw;
          const NF=Math.max(4,Math.round(NC*2.6));
          worley(u*NF+7.1,v*NF+3.3,NF,seed+709,0.95);
          crack=Math.max(crack,(1-smoothstep(0,Math.max(ew*0.7,NF/S*1.2),W_f2-W_f1))*rw*0.65);
        }
        if(P.longCrack>0)crack=Math.max(crack,sdet(u,v,0)*P.longCrack*1.6);
        crack=clamp(crack,0,1);
        h-=crackDepth*crack;
        const shoulder=clamp(crack*1.8,0,1)-crack;
        h-=crackDepth*0.25*shoulder;
        const ce=lerp(1,0.4,crack)*lerp(1,0.82,shoulder);
        r*=ce;g2*=ce;b*=ce;
        rough=lerp(rough,0.9,crack*0.6);

        // sample the drawn patch through a noise warp, or its edge reads as a polygon
        let pwu=u,pwv=v;
        if(P.patches>0){
          pwu=u+(fbm(u,v,50,2,seed+131)-0.5)*0.022;
          pwv=v+(fbm(u,v,50,2,seed+137)-0.5)*0.022;
        }
        const sealField=P.sealant>0?smoothstep(0.45,0.62,fbm(u,v,4,2,seed+67)):0;
        const seam=(P.sealant>0&&P.patches>0)?sdet(pwu,pwv,2):0;
        const seal=clamp(Math.max(crack*sealField*1.6,seam*1.4)*P.sealant,0,1)*smoothstep(0.12,0.4,Math.max(crack,seam));
        if(seal>0){
          h+=seal*0.004*(1-crack*0.4);
          r=lerp(r,16,seal);g2=lerp(g2,15,seal);b=lerp(b,15,seal);
          rough=lerp(rough,0.22,seal);
        }

        const patch=P.patches>0?sdet(pwu,pwv,1):0;
        if(patch>0.01){
          h+=patch*0.004;
          r=lerp(r,r*0.89,patch);g2=lerp(g2,g2*0.89,patch);b=lerp(b,b*0.92,patch);
          rough=lerp(rough,0.84,patch*0.7);
        }

        if(P.polish>0&&wp>0){
          const pol=P.polish*wp;
          rough=lerp(rough,rough*0.45,pol*stoneTop);
          const pl=lerp(1,1.07,pol*stoneTop);
          r*=pl;g2*=pl;b*=pl;
        }

        const oil=P.oil>0?smoothstep(0.55,0.78,fbm(u,v,6,3,seed+71))*P.oil:0;
        if(oil>0){
          const od=lerp(1,0.42,oil);
          r*=od;g2*=od*0.98;b*=od*0.95;
          rough=lerp(rough,0.42,oil*0.8);
        }

        const dust=P.dust>0?P.dust*smoothstep(0.35,0.7,fbm(u,v,14,3,seed+73))*(1-stoneTop*0.35):0;
        if(dust>0){
          r=lerp(r,r*1.35+34,dust*0.6);g2=lerp(g2,g2*1.34+33,dust*0.6);b=lerp(b,b*1.3+30,dust*0.6);
          rough=lerp(rough,0.95,dust*0.5);
        }

        recess=clamp(crack*0.9+ravelField*0.5+hole*0.6,0,1);
        stoneTopG=stoneTop;
        }   /* end asphalt */

        /* ---------- concrete: gutter pan, kerb and footway ---------- */
        if(conc>0){
          let hC,roughC=0.86;
          const isPan=dK<0,isFace=(dK>=0&&dK<faceW),isTop=(dK>=faceW&&dK<topEnd),isWalk=dK>=topEnd;
          if(isPan)          hC=-panDrop*smoothstep(-gutterW,0,dK);      // pan falls to the kerb
          else if(isFace)    hC=-panDrop+(P.curbH+panDrop)*smoothstep(0,faceW,dK);
          else if(isTop)     hC=P.curbH;
          else               hC=P.curbH-(dK-topEnd)*0.02;                // 2% crossfall
          let verge=0;
          if(P.verge&&dK>walkEnd){
            verge=smoothstep(walkEnd,walkEnd+0.05,dK);
            hC=lerp(hC,P.curbH-0.035-(dK-walkEnd)*0.012,verge);
          }

          const mott=fbm(u,v,18,4,seed+1621);
          let cr=conc0[0],cg=conc0[1],cb=conc0[2];

          /* exposed sand and fine stone, reused later to fill spalled breaks */
          let sandM=0;
          if(useGrain){
            worley(u*NG,v*NG,NG,seed+1601,0.9);
            if(hashi(W_cx,W_cy,seed+1607)>0.55){
              sandM=1-smoothstep(0.20,0.36,W_f1);
              const st=0.88+hashi(W_cx,W_cy,seed+1609)*0.3;
              hC+=sandM*0.0006;
              cr=lerp(cr,cr*st,sandM);cg=lerp(cg,cg*st,sandM);cb=lerp(cb,cb*st,sandM);
            }
          }
          if(isWalk&&useBroom&&P.broom>0){
            const br=fbm2(u,v,NBu,6,2,seed+1613)-0.5;
            hC+=br*0.0009*P.broom;
            roughC+=br*0.10*P.broom;
          }

          let slabId=0,joint=0;
          if(isWalk||isTop){
            const t=u*nSlab-Math.floor(u*nSlab);
            const jd=Math.min(t,1-t)*TM/nSlab;            // metres to the nearest joint
            slabId=Math.floor(u*nSlab);
            const expan=hashi(slabId,3,seed+1663)<0.18;   // occasional expansion joint
            const jw=expan?jointW*2.2:jointW;
            joint=1-smoothstep(0,jw,jd);
            hC-=joint*jointD+(1-smoothstep(0,jw*5,jd))*jointD*0.3;   // tooled dish
            if(expan){cr=lerp(cr,38,joint*0.8);cg=lerp(cg,36,joint*0.8);cb=lerp(cb,34,joint*0.8);}
          }
          if(isWalk){                                     // joint where walk meets kerb
            const lj=1-smoothstep(0,jointW,Math.abs(dK-topEnd));
            hC-=lj*jointD*0.8;joint=Math.max(joint,lj);
          }

          const sh=hashi(slabId,(v>0.5?1:0)*7+(P.piece==="inter"?3:0),seed+1619);
          hC+=(sh-0.5)*0.005*P.slabVar;                   // slabs settle unevenly
          const tone=(0.9+mott*0.2)*(1-P.slabVar*0.09+sh*P.slabVar*0.20);
          cr*=tone;cg*=tone;cb*=tone;

          /* ---- crazing: the fine map-cracking that covers weathered concrete ---- */
          let craze=0;
          if(P.craze>0){
            const NCz=Math.max(4,Math.round(TM/0.16));
            if(S/NCz>=2.0){
              worley(u*NCz,v*NCz,NCz,seed+1721,0.95);
              const czr=smoothstep(0.36,0.72,fbm(u,v,Math.max(4,Math.round(TM/1.4)),3,seed+1723));
              craze=(1-smoothstep(0,Math.max(0.05,NCz/S*1.5),W_f2-W_f1))*czr*P.craze;
              hC-=craze*0.0013;
              const cd=lerp(1,0.68,craze);
              cr*=cd;cg*=cd;cb*=cd;
            }
          }

          /* ---- a slab cracked clean across ---- */
          let scrack=0;
          if(isWalk&&P.slabCrack>0&&hashi(slabId,9,seed+1627)<P.slabCrack*0.8){
            const t=u*nSlab-Math.floor(u*nSlab);
            const wpos=(dK-topEnd)/Math.max(0.1,P.walkW);
            const ang=(hashi(slabId,11,seed+1631)-0.5)*1.2;
            const off=hashi(slabId,13,seed+1637);
            let dl=(t-off)+ang*(wpos-0.5);
            dl+=(fbm(u,v,90,2,seed+1641)-0.5)*0.07;
            scrack=1-smoothstep(0,0.012+0.022*P.slabCrack,Math.abs(dl));
            hC-=scrack*0.005;
            const cd=lerp(1,0.42,scrack);
            cr*=cd;cg*=cd;cb*=cd;
          }

          /* ---- spalling: concrete breaks at its arrises first, so the kerb nose
                 and the slab joints carry most of the damage ---- */
          let spall=0;
          if(P.spall>0){
            const arris=(isFace||isTop)?(1-smoothstep(0,0.045,Math.abs(dK-faceW))):0;
            const backArris=isTop?(1-smoothstep(0,0.03,Math.abs(dK-topEnd))):0;
            const sN=fbm(u,v,Math.max(8,Math.round(TM/0.11)),4,seed+1711);   // ~11 cm chips
            const sR=fbm(u,v,Math.max(4,Math.round(TM/0.7)),3,seed+1713);
            const bias=arris*0.66+backArris*0.42+joint*0.52+scrack*0.5+(isPan?0.10:0);
            const field=sN*0.55+sR*0.48+bias;
            // held high on purpose: even at full strength the damage should stay
            // concentrated on the arrises and joints rather than covering the slab
            const thr=1.10-P.spall*0.46;
            spall=smoothstep(thr,thr+0.035,field);
            const rim=smoothstep(thr-0.038,thr,field)*(1-spall);   // shadowed lip
            if(rim>0){
              cr=lerp(cr,cr*0.55,rim*0.75);cg=lerp(cg,cg*0.55,rim*0.75);cb=lerp(cb,cb*0.56,rim*0.75);
            }
            if(spall>0){
              hC-=spall*(0.003+0.012*P.spall)*(0.45+sN*0.9);
              hC+=sandM*spall*0.0019;                     // the break exposes aggregate
              const br2=0.78+sandM*0.30;
              cr=lerp(cr,cr*br2+9,spall);cg=lerp(cg,cg*br2+8,spall);cb=lerp(cb,cb*br2+7,spall);
              roughC=lerp(roughC,0.97,spall);
            }
          }

          /* ---- popouts: single stones worked out of the surface ---- */
          if(P.popout>0){
            const NP=Math.max(4,Math.round(TM/0.03));
            if(S/NP>=2.5){
              worley(u*NP,v*NP,NP,seed+1731,0.9);
              if(hashi(W_cx,W_cy,seed+1733)<P.popout*0.13){
                const pr2=0.18+hashi(W_cx,W_cy,seed+1737)*0.20;
                const pm=1-smoothstep(pr2*0.65,pr2,W_f1);
                hC-=pm*0.0035;
                const pd=lerp(1,0.64,pm);
                cr*=pd;cg*=pd;cb*=pd;
                roughC=lerp(roughC,0.96,pm);
              }
            }
          }

          // staining: run-off in the pan, splash up the kerb face, dirt in joints
          const dirt=isPan?smoothstep(-gutterW,-gutterW*0.15,dK)*0.42
                    :(isFace?0.32*(1-smoothstep(0,faceW,dK)):0);
          const grime=clamp(dirt+joint*0.45+craze*0.30+spall*0.25
                      +smoothstep(0.55,0.85,fbm(u,v,9,3,seed+1651))*0.30,0,0.85);
          const gd=lerp(1,0.5,grime);
          cr*=gd;cg*=gd;cb*=gd;
          roughC=lerp(roughC,0.94,grime*0.6);
          if(isPan||isTop)roughC=lerp(roughC,0.74,0.4);   // troweled, not broomed

          /* ---- efflorescence: lime bloom leached out of the slab ---- */
          if(P.effl>0){
            const e=smoothstep(0.64,0.92,fbm(u,v,Math.max(4,Math.round(TM/0.9)),4,seed+1741))*P.effl;
            cr=lerp(cr,Math.min(255,cr*1.09+20),e*0.55);
            cg=lerp(cg,Math.min(255,cg*1.09+20),e*0.55);
            cb=lerp(cb,Math.min(255,cb*1.07+18),e*0.55);
            roughC=lerp(roughC,0.97,e*0.4);
          }

          /* ---- moss and algae where the concrete stays damp ---- */
          if(P.moss>0){
            const damp=clamp(joint*0.75+(isPan?0.55:0)+spall*0.35
                       +(isWalk?(1-smoothstep(0,0.18,dK-topEnd))*0.5:0),0,1);
            const mo=damp*smoothstep(0.42,0.78,fbm(u,v,Math.max(4,Math.round(TM/0.5)),3,seed+1751))*P.moss;
            cr=lerp(cr,46,mo);cg=lerp(cg,58,mo);cb=lerp(cb,36,mo);
            roughC=lerp(roughC,0.98,mo);
          }

          if(verge>0){
            cr=lerp(cr,86,verge);cg=lerp(cg,72,verge);cb=lerp(cb,56,verge);
            roughC=lerp(roughC,0.97,verge);
            hC+=(fbm(u,v,160,3,seed+1671)-0.5)*0.006*verge;
          }

          if(CURB_PAINT&&(isFace||isTop)){
            let cp=1-smoothstep(0.55-P.markWear*0.5,0.95-P.markWear*0.5,
              fbm(u,v,Math.max(8,Math.round(20*TM)),3,seed+1681));
            cp=clamp(cp,0,1)*(1-spall*0.85);              // paint goes with the chip
            cr=lerp(cr,CURB_PAINT[0],cp);cg=lerp(cg,CURB_PAINT[1],cp);cb=lerp(cb,CURB_PAINT[2],cp);
            roughC=lerp(roughC,0.6,cp);
          }

          const cRecess=clamp(joint*0.8+spall*0.95+craze*0.5+scrack*0.85,0,1);
          recess=lerp(recess,cRecess,conc);
          h=lerp(h,hC,conc);r=lerp(r,cr,conc);g2=lerp(g2,cg,conc);b=lerp(b,cb,conc);
          rough=lerp(rough,roughC,conc);
          crack*=(1-conc);hole*=(1-conc);
        }

        /* ---- road paint, worn off high stones and scrubbed by the wheel paths ---- */
        let paint=(P.piece==="none"||conc>0.9)?0:smk(u,v,0)*(1-conc);
        if(paint>0.004){
          const wearN=fbm(u,v,Math.max(8,Math.round(20*TM)),3,seed+79);
          paint*=1-smoothstep(0.55-P.markWear*0.5,0.95-P.markWear*0.5,wearN);
          paint*=1-clamp(aggH/(H1+1e-9),0,1)*P.markWear*0.75;
          paint*=1-wp*P.markWear*0.45;
          paint*=1-crack*0.55;
          paint=clamp(paint,0,1);
          const yl=smk(u,v,1);
          const pr=lerp(white[0],yellow[0],yl),pg=lerp(white[1],yellow[1],yl),pb=lerp(white[2],yellow[2],yl);
          h+=paint*paintH*(1-stoneTopG*0.5);
          r=lerp(r,pr,paint);g2=lerp(g2,pg,paint);b=lerp(b,pb,paint);
          rough=lerp(rough,0.58,paint);
          MK[i]=paint*255;MKY[i]=yl*255;
        }

        /* ---- edge decay: strata of the road eaten back from the chosen sides ---- */
        let gone=0;
        if(DECAY){
          let dm=1e9;
          if(P.decT)dm=v*TM;
          if(P.decB&&(1-v)*TM<dm)dm=(1-v)*TM;
          if(P.decL&&u*TM<dm)dm=u*TM;
          if(P.decR&&(1-u)*TM<dm)dm=(1-u)*TM;
          const et=1-dm/decReach;
          if(et>0){
            /* The edge pushes inward against the noise: where it wins, that
               course is gone, and each course under it needs the edge to push
               harder still. The push is LINEAR in the distance travelled, which
               is what spreads the three strata evenly across the reach — raise
               it to a power and they all bunch into the last few centimetres
               and read as one ruled band. */
            const drive=et*decDrive;
            const nA=fbm(u,v,NDa,3,seed+2101);
            const nB=fbm(u,v,NDb,3,seed+2103);
            const nC=useDecC?fbm(u,v,NDc,2,seed+2107):0.5;
            /* two readings of "broken", crossfaded by the chunkiness slider: a
               smooth erosion field, and whole polygonal chunks lifting out
               along the crack network. Bound asphalt does the second — it
               fails in slabs with straight edges — and an unbound shoulder
               does the first, so the slider is really asking what the edge is
               made of. Each chunk's resistance is constant across it, so the
               boundary lands on the chunk border rather than cutting it. */
            worley(u*NDa+(nA-0.5)*0.9,v*NDa+(nB-0.5)*0.9,NDa,seed+2113,0.95);
            const chunk=hashi(W_cx,W_cy,seed+2117);
            let f1=lerp(nA*0.52+nB*0.30+nC*0.18,chunk*0.70+nB*0.19+nC*0.11,P.decRag);
            f1=clamp((f1-0.5)*1.55+0.5,0,1);
            const eW=0.022;
            const g1=smoothstep(f1-eW,f1+eW,drive);
            if(g1>0.002){
              /* The courses under it erode rather than break, so their edges
                 are smoother — but they must not simply PARALLEL the one above
                 or the strata come out as ruled bands. Each takes its own share
                 of a coarse field the top one never saw, so they wander in and
                 out of each other the way a real section does. */
              const nD=fbm(u,v,Math.max(4,Math.round(NDa*0.6)),2,seed+2131);
              const f2=clamp(f1*0.52+nD*0.32+nB*0.16,0,1);
              const f3=clamp(f1*0.34+(1-nD)*0.38+nC*0.28,0,1);
              const g2b=smoothstep(f2-eW,f2+eW,drive-0.34);
              const g3=smoothstep(f3-eW,f3+eW,drive-0.68);
              const rim=smoothstep(f1-eW*3.5,f1-eW,drive)*(1-g1);   // the standing lip
              h-=g1*decD*0.34+g2b*decD*0.34+g3*decD*0.32;
              h-=rim*decD*0.10;                                     // undercut behind it
              if(useDecCr)h+=(fbm(u,v,NDcr,2,seed+2111)-0.5)*aggM*1.5*g1;

              /* binder course first: the same mix without the fines, so coarser
                 and more open than the wearing course that was over it */
              const bt=0.70+nC*0.62;
              let lr=bit[0]*bt+10,lg=bit[1]*bt+10,lb=bit[2]*bt+9;
              if(g2b>0.002){                                        // granular base
                let br=cBase[0],bg=cBase[1],bb=cBase[2];
                if(useDecS){
                  worley(u*NDs,v*NDs,NDs,seed+2161,0.95);
                  const sm=1-smoothstep(0.26,0.40,W_f1);
                  const tone=lerp(0.84,0.80+hashi(W_cx,W_cy,seed+2163)*0.45,sm);
                  br*=tone;bg*=tone;bb*=tone;
                  h+=sm*g2b*aggM*0.30;
                }
                lr=lerp(lr,br,g2b);lg=lerp(lg,bg,g2b);lb=lerp(lb,bb,g2b);
              }
              if(g3>0.002){                                         // subgrade
                const sd=0.80+nC*0.44;
                lr=lerp(lr,cSub[0]*sd,g3);lg=lerp(lg,cSub[1]*sd,g3);lb=lerp(lb,cSub[2]*sd,g3);
              }
              r=lerp(r,lr,g1);g2=lerp(g2,lg,g1);b=lerp(b,lb,g1);
              rough=lerp(rough,0.96,g1*0.9);

              /* chunks of the old surface lying loose in the break */
              if(P.decRubble>0&&useDecR){
                worley(u*NDr+(fbm(u,v,40,2,seed+2141)-0.5)*0.8,
                       v*NDr+(fbm(u,v,40,2,seed+2143)-0.5)*0.8,NDr,seed+2147,0.95);
                if(hashi(W_cx,W_cy,seed+2149)<P.decRubble*0.45){
                  const rr=0.20+hashi(W_cx,W_cy,seed+2153)*0.16;
                  const cm=(1-smoothstep(rr*0.82,rr,W_f1))*g1*(1-g3*0.7);
                  if(cm>0.002){
                    h+=cm*decD*0.22;
                    const ct=0.9+hashi(W_cx,W_cy,seed+2159)*0.5;
                    r=lerp(r,bit[0]*ct+13,cm*0.95);g2=lerp(g2,bit[1]*ct+13,cm*0.95);
                    b=lerp(b,bit[2]*ct+12,cm*0.95);
                    rough=lerp(rough,0.92,cm*0.7);
                  }
                }
              }

              const rd=lerp(1,0.58,rim);
              r*=rd;g2*=rd;b*=rd;
              rough=lerp(rough,0.95,rim*0.6);
              if(MK[i])MK[i]=MK[i]*(1-g1);                          // no decal over a hole
              recess=clamp(recess+g1*0.55+rim*0.40,0,1);
              gone=g1;
            }
          }
        }

        /* ---- grunge: broad filth over every material, heaviest in the recesses ---- */
        if(P.grunge>0){
          const gA=fbm(u,v,5,4,seed+1801);
          const gB=fbm(u,v,26,4,seed+1803);
          const gC=fbm(u,v,110,3,seed+1807);
          let filth=clamp((gA*0.55+gB*0.32+gC*0.22-0.36)*2.4,0,1);
          filth=clamp(filth*(0.72+recess*1.05)*P.grunge,0,0.94);
          const warm=0.92+gB*0.16;                        // grime is never neutral grey
          r=r*lerp(1,0.40*warm,filth)+filth*8;
          g2=g2*lerp(1,0.41,filth)+filth*8;
          b=b*lerp(1,0.38/warm,filth)+filth*7;
          rough=lerp(rough,0.96,filth*0.75);
        }

        let wetA=P.wet;
        if(P.puddles>0){
          const lvl=(fbm(u,v,3,3,seed+83)-0.5)*0.012-0.002;
          const reg=smoothstep(0.44,0.62,fbm(u,v,4,2,seed+89))*P.puddles;
          const pm=(1-smoothstep(lvl-0.004,lvl,h))*reg;
          if(pm>0){h=lerp(h,lvl,pm*0.95);wetA=clamp(wetA+pm,0,1);}
        }
        if(wetA>0){
          const wd=lerp(1,0.42,wetA);
          r*=wd;g2*=wd;b*=wd;
          rough=lerp(rough,0.05,wetA);
        }

        HGT[i]=h;
        A[i*3]=r;A[i*3+1]=g2;A[i*3+2]=b;
        RGH[i]=clamp(rough,0.02,1)*255;
        MET[i]=0;
        AOc[i]=clamp(1-crack*0.35-hole*0.3-gone*0.22,0,1)*255;
      }
    }
    if(y<S){io.progress(y/S*0.6);setTimeout(pass1,0);}
    else{io.progress(0.65);setTimeout(pass2,0);}
  }

  function pass2(){
    const r1=clamp(Math.round(S/N1),1,14),r2=clamp(Math.round(S*0.06/TM),3,64);  // 6 cm
    const b1=boxBlurWrap(HGT,S,r1),b2=boxBlurWrap(HGT,S,r2);
    const aoScale=1/Math.max(1e-6,H1*0.9);
    for(let i=0;i<S*S;i++){
      const c1=clamp((b1[i]-HGT[i])*aoScale*2.0,0,1);
      const c2=clamp((b2[i]-HGT[i])*aoScale*1.5,0,1);
      const occ=clamp(c1*0.6+c2*0.8,0,1)*P.aoStr;
      AOc[i]=clamp((AOc[i]/255)*(1-occ),0,1)*255;
    }
    io.progress(0.82);
    hMin=Infinity;hMax=-Infinity;
    for(let i=0;i<S*S;i++){const hh=HGT[i];if(hh<hMin)hMin=hh;if(hh>hMax)hMax=hh;}
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;
    const gy=P.flipG?-1:1;
    const mPerTexel=TM/S;                    // heights are metres, so slope is real
    for(let yy=0;yy<S;yy++){
      const yp=((yy+1)%S)*S,ym=((yy-1+S)%S)*S,y0=yy*S;
      for(let xx=0;xx<S;xx++){
        const xp=(xx+1)%S,xm=(xx-1+S)%S;
        const sx=(HGT[y0+xp]-HGT[y0+xm])/(2*mPerTexel)*P.normalStr;
        const sy=(HGT[yp+xx]-HGT[ym+xx])/(2*mPerTexel)*P.normalStr;
        let nx=-sx,ny=-sy*gy;
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;
        const i=(y0+xx)*3;
        NRM[i]=(nx*0.5+0.5)*255;NRM[i+1]=(ny*0.5+0.5)*255;NRM[i+2]=(inv*0.5+0.5)*255;
      }
    }
    io.progress(1);
    io.done({A:A,RGH:RGH,MET:MET,AO:AOc,NRM:NRM,HGT:HGT,MK:MK,MKY:MKY,hMin:hMin,hMax:hMax});
  }
  io.progress(0.02);
  setTimeout(pass1,0);
}

/* ============================ mode definition ============================ */

Forge.register({
  id:"street",
  label:"Street",
  blurb:"Asphalt, markings, kerb and footway",
  title:'Surface <em>Course</em>',
  tagline:"Asphalt & street layout · PBR · PNG",
  actionLabel:"Lay surface",
  busyLabel:"Laying…",
  seamless:true,
  backdrops:false,
  previewSize:256,
  preview:{gain:3.2,amb:1.15,specK:0.55,skyLo:[0.13,0.15,0.19],skyHi:[0.30,0.34,0.42]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},
    /* flat black by design — asphalt, water and road paint are all dielectric,
       so it gets a chip and a file but no preview tab of its own */
    {key:"metallic",label:"Metallic",tab:false},
    {key:"ao",label:"AO"},{key:"height",label:"Height"},
    {key:"orm",label:"ORM packed"},{key:"markings",label:"Markings α"}
  ],

  presets:[
    {id:"closeup",label:"Close-up 1 m",set:{grunge:0.4,tileM:1,aggMm:12,size:1024,piece:"none",coverage:0.62,protrude:0.6,angular:0.5,fines:0.5,
      alligator:0.3,crackCellM:0.25,crackWmm:12,crackD:0.5,longCrack:0.35,sealant:0.25,ravel:0.3,pothole:0.1,
      patches:1,joint:0,rut:0,polish:0,oil:0.2,dust:0.3,wet:0,puddles:0}},
    {id:"highway",label:"Highway 12 m",set:{grunge:0.4,tileM:12,aggMm:12,size:2048,piece:"cross",lanes:2,laneW:3.65,shoulderW:1.2,lineW:0.12,
      centreType:"double_y",edgeType:"w",laneDash:true,dashLen:3,dashGap:9,
      coverage:0.6,protrude:0.5,angular:0.5,fines:0.5,alligator:0.2,crackCellM:0.4,crackWmm:12,crackD:0.45,
      longCrack:0.4,sealant:0.4,ravel:0.3,pothole:0.05,patches:2,joint:0.5,
      rut:0.4,polish:0.55,markWear:0.4,oil:0.25,dust:0.4,wet:0,puddles:0}},
    {id:"backroad",label:"Backroad",set:{grunge:0.75,tileM:6,aggMm:16,size:2048,piece:"centre",lanes:2,laneW:3.2,shoulderW:0.4,lineW:0.1,
      centreType:"dash_y",edgeType:"none",coverage:0.85,protrude:0.8,angular:0.7,fines:0.25,
      alligator:0.75,crackCellM:0.35,crackWmm:26,crackD:0.85,longCrack:0.7,sealant:0.5,ravel:0.75,
      pothole:0.45,patches:4,joint:0.2,rut:0.5,polish:0.15,markWear:0.8,oil:0.2,dust:0.6,wet:0,puddles:0}},
    {id:"wet",label:"Wet night",set:{grunge:0.3,tileM:4,aggMm:12,size:1024,piece:"edge",lanes:2,laneW:3.5,shoulderW:1,lineW:0.12,edgeType:"w",
      coverage:0.65,protrude:0.5,alligator:0.2,crackCellM:0.3,crackWmm:12,longCrack:0.3,sealant:0.3,
      ravel:0.25,pothole:0.08,patches:1,joint:0.2,rut:0.35,polish:0.4,oil:0.45,dust:0.05,wet:0.75,puddles:0.7}},
    {id:"kerbside",label:"Kerbside street",set:{tileM:14,aggMm:12,size:2048,piece:"cross",lanes:2,laneW:3.5,shoulderW:0.2,lineW:0.1,
      centreType:"double_y",edgeType:"w",laneDash:false,
      kerb:"both",gutterW:0.45,curbH:0.15,curbTop:0.15,walkW:1.6,slabL:1.5,jointDmm:6,slabVar:0.4,
      broom:0.5,curbPaint:"none",verge:true,
      spall:0.4,craze:0.4,slabCrack:0.4,popout:0.35,effl:0.3,moss:0.25,grunge:0.45,
      coverage:0.6,protrude:0.5,alligator:0.25,crackCellM:0.35,crackWmm:12,crackD:0.5,longCrack:0.35,
      sealant:0.3,ravel:0.25,pothole:0.05,patches:2,joint:0.3,rut:0.25,polish:0.35,markWear:0.35,
      oil:0.3,dust:0.35,wet:0,puddles:0}},
    {id:"wrecked",label:"Kerbside — wrecked",set:{tileM:14,aggMm:14,size:2048,piece:"cross",lanes:2,laneW:3.5,shoulderW:0.2,lineW:0.1,
      centreType:"double_y",edgeType:"w",laneDash:false,
      kerb:"both",gutterW:0.45,curbH:0.15,curbTop:0.15,walkW:1.6,slabL:1.5,jointDmm:9,slabVar:0.8,
      broom:0.35,curbPaint:"none",verge:true,
      spall:0.9,craze:0.85,slabCrack:0.9,popout:0.8,effl:0.55,moss:0.55,grunge:0.85,
      coverage:0.75,protrude:0.65,angular:0.6,fines:0.35,
      alligator:0.6,crackCellM:0.3,crackWmm:20,crackD:0.75,longCrack:0.7,sealant:0.5,ravel:0.6,
      pothole:0.3,patches:4,joint:0.4,rut:0.45,polish:0.3,markWear:0.8,oil:0.45,dust:0.5,wet:0,puddles:0}},
    {id:"broken",label:"Broken edge",set:{grunge:0.7,tileM:8,aggMm:14,size:2048,piece:"centre",lanes:2,laneW:3.2,shoulderW:0.3,lineW:0.1,
      centreType:"dash_y",edgeType:"none",coverage:0.8,protrude:0.7,angular:0.65,fines:0.3,
      alligator:0.65,crackCellM:0.3,crackWmm:24,crackD:0.8,longCrack:0.65,sealant:0.35,ravel:0.7,
      pothole:0.35,patches:3,joint:0.2,rut:0.45,polish:0.15,markWear:0.75,oil:0.2,dust:0.55,wet:0,puddles:0,
      kerb:"none",decT:true,decB:true,decL:false,decR:false,
      decay:0.7,decReach:2.2,decChunk:0.4,decRag:0.7,decDeep:110,decRubble:0.6,
      cBase:"#9a938a",cSub:"#6c5a45"}},
    {id:"junction",label:"Intersection",set:{grunge:0.4,tileM:20,aggMm:12,size:2048,piece:"inter",lanes:2,laneW:3.65,shoulderW:0.6,lineW:0.15,
      centreType:"double_y",edgeType:"w",laneDash:true,interRadius:6,interStop:true,interCross:true,
      cwStyle:"continental",cwDepth:3,cwBarW:0.5,cwGap:0.6,
      coverage:0.6,protrude:0.45,alligator:0.15,crackCellM:0.5,crackWmm:12,crackD:0.4,longCrack:0.3,
      sealant:0.3,ravel:0.2,pothole:0.03,patches:2,joint:0.4,rut:0.2,polish:0.35,markWear:0.35,
      oil:0.35,dust:0.3,wet:0,puddles:0}}
  ],

  controls:[
    {title:"Scale & output",open:true,rows:[
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:Forge.sizes("square")},
      {id:"tileM",label:"Tile covers",unit:"m",min:0.5,max:24,step:0.5,value:2},
      {type:"readout"},
      {id:"seed",type:"seed",value:1963}
    ]},
    {title:"Street layout",open:true,rows:[
      {id:"piece",type:"select",label:"Piece",value:"none",options:[
        ["none","Plain surface — no markings"],["cross","Full cross-section"],["edge","Edge lines only"],
        ["centre","Centre line only"],["lane","Lane divider only"],["stop","Stop bar"],
        ["crosswalk","Crosswalk"],["arrow_s","Arrow — straight"],["arrow_l","Arrow — left"],
        ["arrow_r","Arrow — right"],["inter","4-way intersection"],["parking","Parking bays"]]},
      {id:"lanes",need:"road",label:"Lanes across",min:1,max:8,step:1,value:2},
      {id:"laneW",need:"road",label:"Lane width",unit:"m",min:2.4,max:4.6,step:0.05,value:3.65},
      {id:"shoulderW",need:"road",label:"Shoulder",unit:"m",min:0,max:3.5,step:0.05,value:1},
      {id:"lineW",need:"road",label:"Line width",unit:"m",min:0.05,max:0.4,step:0.01,value:0.12},
      {id:"centreType",need:"road",type:"select",label:"Centre line",value:"solid_y",options:[
        ["none","None"],["solid_y","Solid yellow"],["double_y","Double yellow"],["dash_y","Dashed yellow"],
        ["solid_w","Solid white"],["dash_w","Dashed white"]]},
      {id:"edgeType",need:"road",type:"select",label:"Edge lines",value:"w",options:[
        ["none","None"],["w","White both sides"],["wy","Yellow left, white right"]]},
      {id:"dashLen",need:"road",label:"Dash length",unit:"m",min:0.5,max:12,step:0.25,value:3},
      {id:"dashGap",need:"road",label:"Dash gap",unit:"m",min:0.5,max:20,step:0.25,value:9},
      {type:"checks",need:"road",items:[{id:"laneDash",label:"Dashed lane dividers",value:true}]}
    ]},
    {title:"Crossings & junction",id:"gCross",open:true,need:["cw","int","park"],rows:[
      {id:"cwStyle",need:"cw",type:"select",label:"Crosswalk style",value:"continental",options:[
        ["continental","Continental bars"],["ladder","Ladder"],["zebra","Zebra (angled)"],
        ["transverse","Two transverse lines"]]},
      {id:"cwDepth",need:"cw",label:"Crossing depth",unit:"m",min:1,max:8,step:0.25,value:3},
      {id:"cwBarW",need:"cw",label:"Bar width",unit:"m",min:0.15,max:1.2,step:0.05,value:0.5},
      {id:"cwGap",need:"cw",label:"Bar gap",unit:"m",min:0.15,max:2,step:0.05,value:0.6},
      {id:"interRadius",need:"int",label:"Corner radius",unit:"m",min:0,max:15,step:0.5,value:6},
      {type:"checks",need:"int",items:[
        {id:"interStop",label:"Stop bars on each approach",value:true},
        {id:"interCross",label:"Crosswalks on each leg",value:true}]},
      {id:"stallW",need:"park",label:"Stall width",unit:"m",min:2,max:4,step:0.05,value:2.6},
      {id:"stallL",need:"park",label:"Stall depth",unit:"m",min:3,max:7,step:0.1,value:5}
    ]},
    {title:"Kerb & footway",open:true,rows:[
      {id:"kerb",type:"select",label:"Kerb line",value:"none",options:[
        ["none","None — open shoulder"],["both","Both sides"]]},
      {id:"gutterW",need:"kerb",label:"Gutter pan",unit:"m",min:0,max:1.2,step:0.05,value:0.45},
      {id:"curbH",need:"kerb",label:"Kerb height",unit:"m",min:0,max:0.35,step:0.005,value:0.15},
      {id:"curbTop",need:"kerb",label:"Kerb top width",unit:"m",min:0.05,max:0.5,step:0.01,value:0.15},
      {id:"walkW",need:"kerb",label:"Footway width",unit:"m",min:0.5,max:5,step:0.1,value:1.5},
      {id:"slabL",need:"kerb",label:"Slab length",unit:"m",min:0.5,max:4,step:0.1,value:1.5},
      {id:"jointDmm",need:"kerb",label:"Joint depth",unit:"mm",min:0,max:20,step:1,value:6},
      {id:"slabVar",need:"kerb",label:"Slab settlement",min:0,max:1,step:0.01,value:0.4},
      {id:"broom",need:"kerb",label:"Broom finish",min:0,max:1,step:0.01,value:0.5},
      {id:"spall",need:"kerb",label:"Chipping & spalling",min:0,max:1,step:0.01,value:0.45},
      {id:"craze",need:"kerb",label:"Crazing",min:0,max:1,step:0.01,value:0.45},
      {id:"slabCrack",need:"kerb",label:"Cracked slabs",min:0,max:1,step:0.01,value:0.45},
      {id:"popout",need:"kerb",label:"Popouts & pitting",min:0,max:1,step:0.01,value:0.4},
      {id:"effl",need:"kerb",label:"Efflorescence",min:0,max:1,step:0.01,value:0.3},
      {id:"moss",need:"kerb",label:"Moss & algae",min:0,max:1,step:0.01,value:0.25},
      {id:"curbPaint",need:"kerb",type:"select",label:"Kerb paint",value:"none",options:[
        ["none","None"],["red","Red — no stopping"],["yellow","Yellow — no parking"],["white","White"]]},
      {type:"colors",need:"kerb",label:"Concrete colour",items:[{id:"cConcrete",value:"#b3afa6"}]},
      {type:"checks",need:"kerb",items:[{id:"verge",label:"Dirt verge behind the footway",value:false}]}
    ]},
    {title:"Aggregate",rows:[
      {id:"aggMm",label:"Top stone size",unit:"mm",min:4,max:32,step:1,value:12},
      {id:"coverage",label:"Exposure",min:0,max:1,step:0.01,value:0.62},
      {id:"protrude",label:"Protrusion",min:0,max:1,step:0.01,value:0.55},
      {id:"sizeVar",label:"Size spread",min:0,max:1,step:0.01,value:0.55},
      {id:"angular",label:"Angularity",min:0,max:1,step:0.01,value:0.5},
      {id:"fines",label:"Fines & sand",min:0,max:1,step:0.01,value:0.5}
    ]},
    {title:"Distress",rows:[
      {id:"alligator",label:"Alligator cracking",min:0,max:1,step:0.01,value:0.35},
      {id:"crackCellM",label:"Crack cell",unit:"m",min:0.05,max:1.5,step:0.01,value:0.3},
      {id:"crackWmm",label:"Crack width",unit:"mm",min:2,max:60,step:1,value:14},
      {id:"crackD",label:"Crack depth",min:0,max:1,step:0.01,value:0.55},
      {id:"longCrack",label:"Long cracks",min:0,max:1,step:0.01,value:0.4},
      {id:"sealant",label:"Crack sealant",min:0,max:1,step:0.01,value:0.3},
      {id:"ravel",label:"Ravelling",min:0,max:1,step:0.01,value:0.35},
      {id:"pothole",label:"Potholes",min:0,max:1,step:0.01,value:0.15},
      {id:"patches",label:"Patches",min:0,max:8,step:1,value:2},
      {id:"joint",label:"Paving joint",min:0,max:1,step:0.01,value:0.35}
    ]},
    {title:"Edge decay",rows:[
      {type:"checks",items:[
        {id:"decT",label:"Eat in from the top edge",value:false},
        {id:"decB",label:"Eat in from the bottom edge",value:false},
        {id:"decL",label:"Eat in from the left edge",value:false},
        {id:"decR",label:"Eat in from the right edge",value:false}]},
      {id:"decay",label:"Break-up",min:0,max:1,step:0.01,value:0.55},
      {id:"decReach",label:"Reach in from the edge",unit:"m",min:0.1,max:12,step:0.1,value:1.5},
      {id:"decChunk",label:"Chunk size",unit:"m",min:0.05,max:2,step:0.01,value:0.35},
      {id:"decRag",label:"Chunkiness",min:0,max:1,step:0.01,value:0.6},
      {id:"decDeep",label:"Depth to subgrade",unit:"mm",min:10,max:300,step:5,value:90},
      {id:"decRubble",label:"Loose rubble",min:0,max:1,step:0.01,value:0.45},
      {type:"colors",label:"Granular base · subgrade",items:[
        {id:"cBase",value:"#9a938a"},{id:"cSub",value:"#6c5a45"}]},
      {type:"note",html:"Layered twice: the noise runs from chunk down to crumb, and so does the "+
        "road — wearing course, binder course, granular base, subgrade, each eaten back a little "+
        "less far than the one above, so the break shows its strata. <b>Chunkiness</b> decides "+
        "whether the surfacing lifts out in slabs with straight edges, which is what bound "+
        "asphalt does, or crumbles away, which is what an unbound shoulder does. Any combination "+
        "of sides works, kerb and footway included. Turning a side on <b>stops that axis "+
        "tiling</b>; the tag under the preview says which axes still repeat."}
    ]},
    {title:"Traffic & weather",rows:[
      {id:"rut",label:"Wheel rutting",min:0,max:1,step:0.01,value:0.25},
      {id:"polish",label:"Wheel-path polish",min:0,max:1,step:0.01,value:0.3},
      {id:"grunge",label:"Overall grunge",min:0,max:1,step:0.01,value:0.45},
      {id:"markWear",label:"Paint wear",min:0,max:1,step:0.01,value:0.35},
      {id:"oil",label:"Oil staining",min:0,max:1,step:0.01,value:0.25},
      {id:"dust",label:"Dust & bleaching",min:0,max:1,step:0.01,value:0.35},
      {id:"wet",label:"Wetness",min:0,max:1,step:0.01,value:0},
      {id:"puddles",label:"Standing water",min:0,max:1,step:0.01,value:0}
    ]},
    {title:"Colour & maps",rows:[
      {type:"colors",label:"Bitumen · light stone · dark stone",items:[
        {id:"cBitumen",value:"#2b2b2c"},{id:"cStoneA",value:"#857f76"},{id:"cStoneB",value:"#4a4845"}]},
      {id:"stoneMix",label:"Light / dark stone mix",min:0,max:1,step:0.01,value:0.38},
      {id:"rBinder",label:"Bitumen roughness",min:0.05,max:1,step:0.01,value:0.8},
      {id:"rStone",label:"Stone roughness",min:0.05,max:1,step:0.01,value:0.62},
      {id:"normalStr",label:"Normal strength",min:0.1,max:3,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:0.8},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  needs:function(P){
    const need=(PIECE_NEEDS[P.piece]||[]).slice();
    if(P.kerb!=="none")need.push("kerb");
    return need;
  },

  /* a decayed side is a torn edge, so that axis stops repeating whatever the
     piece would otherwise have done */
  tileTag:function(P){
    const t=PIECE_TILING[P.piece]||"both";
    let uT=(t==="both"||t==="u"),vT=(t==="both");
    if(P.decay>0){
      if(P.decL||P.decR)uT=false;
      if(P.decT||P.decB)vT=false;
    }
    return (uT&&vT)?"tiles ↔ and ↕"
      :(uT?"tiles ↔ along the road"
      :(vT?"tiles ↕ only":"single piece — butts against neighbours"));
  },

  /* the numbers that decide whether this resolution can hold the detail */
  readout:function(P){
    const S0=P.size|0,agg=P.aggMm/1000;
    const pxPerM=S0/P.tileM, aggPx=agg*pxPerM, mmPerPx=1000*P.tileM/S0;
    let msg="<b>"+Math.round(pxPerM)+" px/m</b> · "+mmPerPx.toFixed(1)+" mm per texel<br>"+
      "top stone <b>"+aggPx.toFixed(1)+" px</b>";
    if(aggPx<2.0)msg+=' <span class="warn">— sub-pixel, raise resolution or stone size</span>';
    else if(aggPx<4)msg+=" — fine grain, coarse grade only";
    const road=(P.lanes*P.laneW+2*P.shoulderW);
    if((PIECE_NEEDS[P.piece]||[]).includes("road")){
      msg+="<br>road <b>"+road.toFixed(2)+" m</b> wide in a "+P.tileM.toFixed(1)+" m tile";
      if(road>P.tileM)msg+=' <span class="warn">— wider than the tile</span>';
    }
    const sides=[P.decT&&"top",P.decB&&"bottom",P.decL&&"left",P.decR&&"right"].filter(Boolean);
    if(P.decay>0&&sides.length){
      msg+="<br>decayed "+sides.join(", ")+" · <b>"+(+P.decReach).toFixed(1)+" m</b> in, "+
        (+P.decDeep).toFixed(0)+" mm down to subgrade";
      const chunkPx=P.decChunk*pxPerM;
      if(chunkPx<6)msg+=' <span class="warn">— chunks '+chunkPx.toFixed(1)+' px, too small to read</span>';
      if(P.decReach>P.tileM*0.5)msg+=' <span class="warn">— reach is over half the tile; the sides meet in the middle</span>';
    }
    if(P.kerb!=="none"){
      const corridor=road+2*(P.gutterW+0.05+P.curbTop+P.walkW);
      msg+="<br>kerb to kerb "+(road+2*P.gutterW).toFixed(2)+" m · with footways <b>"+corridor.toFixed(2)+" m</b>";
      if(corridor>P.tileM)msg+=' <span class="warn">— footways run off the tile</span>';
      const rise=Math.max(0.013,P.curbH+0.02);
      msg+="<br>kerb step gives 8-bit height only <b>"+Math.round(255*0.013/rise)+"</b> levels of road — use the 16-bit export";
    }
    return msg;
  },

  /* a tiling material: one tile of it, at the size the mode says it covers */
  plan:function(P){const t=Math.max(0.05,+P.tileM||2);return {w:t,h:t,tile:t,cutout:false};},

  size:function(P,preview){
    const S=preview?Math.min(P.size|0,256):(P.size|0);
    return {w:S,h:S};
  },
  build:build,

  /* the markings decal: paint colour with coverage in alpha */
  writers:function(B){
    const MK=B.MK,MKY=B.MKY;
    return {markings:function(i,o,k){
      const yl=MKY[i]/255;
      o[k]=lerp(236,226,yl);o[k+1]=lerp(235,176,yl);o[k+2]=lerp(230,37,yl);
      return MK[i];
    }};
  },

  sizeTag:function(P){return P.tileM+" m";},
  fileBase:function(P,W){return "street_"+P.piece+"_"+(P.seed|0)+"_"+W;},

  readme:function(P,info){
    const t=PIECE_TILING[P.piece]||"both";
    const tile=t==="both"?"Tiles seamlessly in both axes."
      :(t==="u"?"Tiles seamlessly along the road (horizontal). Vertically it is a road cross-section, so it butts against its neighbours rather than repeating."
               :"A single piece. The asphalt matches at every edge, but the markings do not repeat — butt it against plain or line pieces.");
    const tileMetres=P.tileM;
    return ["Texture Forge · street — asphalt & street layout",
      "",
      "Piece: "+P.piece+"   Seed: "+(P.seed|0)+"   Resolution: "+info.W+"x"+info.H,
      "Tile covers "+tileMetres+" m x "+tileMetres+" m  ("+(info.W/tileMetres).toFixed(1)+" px per metre)",
      tile,
      (P.kerb!=="none"
        ? "\nKerb line "+(P.lanes*P.laneW*0.5+P.shoulderW+P.gutterW).toFixed(2)+" m from the road centre: "+
          P.gutterW.toFixed(2)+" m gutter pan, "+P.curbH.toFixed(3)+" m kerb, "+P.walkW.toFixed(2)+" m footway.\n"+
          "The kerb face is baked as a steep ramp about 50 mm wide. That reads fine from\n"+
          "above, but a vertical face cannot be represented in a heightmap, so for close\n"+
          "work model the kerb as geometry and use these maps as its surface material.\n"
        : ""),
      "",
      (P.decay>0&&(P.decT||P.decB||P.decL||P.decR)
        ? "\nEdge decay is on for the "+[P.decT&&"top",P.decB&&"bottom",P.decL&&"left",P.decR&&"right"]
            .filter(Boolean).join(", ")+" edge(s): "+(+P.decReach).toFixed(1)+" m in, down through the\n"+
          "binder course and the granular base to subgrade at "+(+P.decDeep).toFixed(0)+" mm. A decayed edge is a\n"+
          "TORN edge, so that axis no longer repeats — butt it against terrain, not against\n"+
          "another tile.\n"
        : ""),
      "",
      "Scale everything in your engine from that metre figure and pieces from this",
      "tool will line up with each other: lane widths, dash cycles and crossing",
      "depths are all laid out in real metres.",
      "",
      "basecolor.png  sRGB albedo. Import as sRGB / colour data.",
      "normal.png     Tangent-space normal, "+info.normalNote+". Non-colour / linear.",
      "roughness.png  Linear grey, 0 = mirror, 1 = fully rough.",
      "metallic.png   Flat black by design: asphalt, water and road paint are all dielectric.",
      "ao.png         Linear grey ambient occlusion.",
      "height.png     Linear grey displacement, 0-1 spanning "+((info.hMax-info.hMin)*1000).toFixed(1)+" mm of real relief",
      "               (min "+(info.hMin*1000).toFixed(1)+" mm, max "+(info.hMax*1000).toFixed(1)+" mm). Set your displacement",
      "               amount to "+(info.hMax-info.hMin).toFixed(4)+" m to get true-to-life depth.",
      "orm.png        Packed: R = AO, G = roughness, B = metallic (glTF/Unreal style).",
      "height16.png   The same height field at 16 bits. With a kerb in the tile the 8-bit",
      "               version gives the road surface only about "+Math.round(255*0.013/Math.max(0.013,info.hMax-info.hMin))+" levels, so use this",
      "               one for displacement and keep the 8-bit for previews.",
      "markings.png   Paint colour with coverage in the alpha channel — use as a decal",
      "               over your own asphalt if you would rather not bake the lines in.",
      "",
      "Normal strength was baked at "+P.normalStr.toFixed(2)+"x."].join("\n");
  }
});

})();
