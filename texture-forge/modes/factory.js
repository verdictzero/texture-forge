/* =====================================================================
   MODE: factory — 1940s brick factory and warehouse wall
   =====================================================================
   A whole wall panel rather than a material: a grid of steel industrial
   sash windows set into brick, three storeys by four bays by default, and
   it tiles in both axes so the panel repeats into a whole building.

   The window is the point of the mode. A factory sash of this period is a
   grid of small panes in thin steel bars, split across the middle by a
   heavier transom into an upper and a lower half, each half carrying its
   own pane grid. Pane counts are not a slider: you give a target pane
   size and the mode snaps the count so a whole number fits each half,
   which is what real steel sash did and what keeps the bars square.

   Everything else follows the same rule. Brick courses and brick lengths
   are snapped so a whole number fits the tile — that is what makes it
   seamless — and the readout tells you what it actually built, in
   millimetres, rather than quietly stretching the bond.

   Because it tiles vertically there is no plinth and no parapet: a belt
   course at every floor line is the detail that can repeat honestly.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      hashi=Forge.hashi,fbm=Forge.fbm,fbm2=Forge.fbm2,
      hex2rgb=Forge.hex2rgb,boxBlurWrap=Forge.blurWrap;

let P={};

/* Everything below is in metres; heights come out in tile-width units.
   Takes the parameters rather than reading the latched copy, because the
   readout calls it between builds. */
function layout(P){
  const T=Math.max(2,+P.tileW||14);
  const rows=Math.max(1,P.rows|0),cols=Math.max(1,P.cols|0);
  const H=T/rows,W=T/cols;                        // one storey, one bay
  const belt=Math.min(P.beltMm*0.001,H*0.2);
  const pier=clamp(P.pierMm*0.001,0.1,W*0.8);
  const sill=clamp(P.sillMm*0.001,0.1,H-belt-0.4);
  const lint=clamp(P.lintelMm*0.001,0.05,H*0.25);
  /* the opening takes what is left of the storey once the floor band, the
     spandrel below the sill and the lintel have had their share */
  const open=Math.max(0.3,Math.min(P.openMm*0.001,H-belt-sill-lint-0.12));
  const ow=W-pier;
  const trans=clamp(P.transom,0.15,0.85);
  const botH=open*trans,topH=open-botH;
  const pane=Math.max(0.08,P.paneMm*0.001);
  return {T:T,rows:rows,cols:cols,H:H,W:W,belt:belt,pier:pier,sill:sill,
          lint:lint,open:open,ow:ow,botH:botH,topH:topH,
          paneC:Math.max(1,Math.round(ow/pane)),
          paneB:Math.max(1,Math.round(botH/pane)),
          paneT:Math.max(1,Math.round(topH/pane))};
}

/* ============================ the generator ============================ */

function build(params,io){
  P=params;
  const S=io.W,seed=P.seed|0,N=S*S;
  const L=layout(P),T=L.T;
  const M=1/T,MM=0.001/T;                          // metres, millimetres
  const mpp=T/S,aa=mpp*0.7;                        // metres per texel

  const A=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N);
  const MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N);
  const EMI=new Uint8ClampedArray(N);
  const NRM=new Uint8ClampedArray(N*3);
  const HGT=new Float32Array(N);
  let hMin=0,hMax=1;

  const brickC=hex2rgb(P.cBrick),mortC=hex2rgb(P.cMortar),stoneC=hex2rgb(P.cStone),
        sashC=hex2rgb(P.cSash),glassC=hex2rgb(P.cGlass);

  /* Courses and brick lengths snapped so a whole number fits the tile —
     without this the bond walks and the tile edge shows a half brick. */
  const nCourse=Math.max(1,Math.round(T/Math.max(0.02,(P.brickH+P.jointMm)*0.001)));
  const cH=T/nCourse;                                        // course height, metres
  const nBrick=Math.max(1,Math.round(T/Math.max(0.05,(P.brickL+P.jointMm)*0.001)));
  const bL=T/nBrick;
  const joint=Math.min(P.jointMm*0.001,cH*0.4,bL*0.25);
  const jointD=P.jointDmm*MM;
  const headerEvery=Math.max(2,P.headerEvery|0);

  const revealD=P.revealMm*MM;
  const muntin=Math.max(P.muntinMm*0.001,aa*1.2);
  const transB=Math.max(P.transomMm*0.001,muntin*1.4);   // the rail, not just a fat bar
  const frame=Math.max(P.frameMm*0.001,muntin*1.6);
  const sillT=Math.min(P.sillTMm*0.001,L.sill*0.6);
  const sillOut=P.sillOutMm*MM;
  const proud=P.pierMmProud*MM;

  /* material scratchpad, same shape as the other elevation modes */
  let Mr=0,Mg=0,Mb=0,Mh=0,Mrg=0.9,Mmet=0,Memi=0;

  /* The wall repeats every storey, so the tile edge can sit anywhere in that
     cycle. Left at zero it lands exactly on a floor line, which rules the belt
     course along the wrap: seamless, but one unbroken line across the repeat is
     the thing the eye picks up. Dropped into the middle of the brick spandrel
     instead, the wrap falls in plain brickwork and the belt course lands whole
     inside the tile. Any offset stays seamless because the tile is a whole
     number of storeys tall — but the storey index has to wrap with it, or the
     panes above and below the seam draw from different hashes. */
  const vOff=L.belt+L.sill*0.55;

  function brick(wx,wy,u,v){
    let extraRg=0;
    const row=Math.floor(wy/cH);
    /* bond: which way this course is laid, and how far it is shifted */
    let unit=bL,off=0,header=false;
    if(P.bond==="common"&&((row%headerEvery)===0)){unit=bL*0.5;header=true;off=bL*0.25;}
    else if(P.bond==="running")off=(row&1)?bL*0.5:0;
    else if(P.bond==="english"){
      if(row&1){unit=bL*0.5;header=true;off=bL*0.25;}else off=0;
    }else if(P.bond==="stack")off=0;
    const col=Math.floor((wx+off)/unit);
    const fx=(wx+off)/unit-col,fy=wy/cH-row;
    const dj=Math.min(Math.min(fx,1-fx)*unit,Math.min(fy,1-fy)*cH);
    const face=smoothstep(joint*0.5-aa,joint*0.5+aa*0.5,dj);

    const bh=hashi(col*3+(header?1:0),row,seed+23);
    const bh2=hashi(col*17,row*7+3,seed+29);
    /* flashed headers came out of the kiln darker and they are the reason a
       common-bond wall reads as banded rather than flat */
    const flash=(header&&bh2<0.45)?1:(bh2<0.10?0.6:0);
    let t=0.80+bh*0.42;
    let r=brickC[0]*t,g=brickC[1]*t,b=brickC[2]*t;
    if(flash>0){r=lerp(r,r*0.52+8,flash);g=lerp(g,g*0.55+10,flash);b=lerp(b,b*0.70+22,flash);}
    let h=face*((bh-0.5)*P.brickIrreg*3*MM);
    h-=(1-face)*jointD;
    h+=(fbm2(u,v,48,72,2,seed+31)-0.5)*P.brickIrreg*1.6*MM;

    /* spalled faces: the fired skin gone, the soft pink core showing */
    const sp=hashi(col*29,row*13,seed+37);
    if(sp<P.spall*0.30){
      const bite=fbm2(u,v,96,96,3,seed+41);
      const m=smoothstep(0.42,0.62,bite)*face;
      if(m>0){
        h-=m*P.spallMm*MM;
        r=lerp(r,r*0.72+96,m*0.85);g=lerp(g,g*0.66+70,m*0.85);b=lerp(b,b*0.66+62,m*0.85);
        extraRg=Math.max(extraRg,m*0.14);           // a broken face is never the glossy one
      }
    }
    /* mortar, and the patches of it that have gone */
    const mo=1-face;
    if(mo>0){
      const gone=clamp(fbm(u,v,9,3,seed+43)*1.5-0.55,0,1)*P.pointing;
      h-=mo*gone*P.jointDmm*1.6*MM;
      const mt=0.88+hashi(col,row*5,seed+47)*0.2;
      r=lerp(r,mortC[0]*mt*(1-gone*0.45),mo);
      g=lerp(g,mortC[1]*mt*(1-gone*0.45),mo);
      b=lerp(b,mortC[2]*mt*(1-gone*0.45),mo);
    }
    Mr=r;Mg=g;Mb=b;Mh=h;Mrg=clamp(lerp(0.80,0.94,mo)+extraRg,0,1);Mmet=0;
  }

  function stone(u,v,shade){
    const n=fbm2(u,v,96,96,3,seed+53);
    const t=(0.90+n*0.22)*shade;
    Mr=stoneC[0]*t;Mg=stoneC[1]*t;Mb=stoneC[2]*t;Mrg=0.86;Mmet=0;
  }

  const band=Math.max(4,Math.round(65536/S));
  let y=0;

  function pass1(){
    const end=Math.min(S,y+band);
    for(;y<end;y++){
      const v=(y+0.5)/S,wy=(1-v)*T+vOff;            // metres up the wall
      const sRaw=Math.floor(wy/L.H),ly=wy-sRaw*L.H;
      const si=((sRaw%L.rows)+L.rows)%L.rows;
      for(let x=0;x<S;x++){
        const u=(x+0.5)/S,wx=u*T,i=y*S+x;
        const bi=Math.floor(wx/L.W),lx=wx-bi*L.W;
        Memi=0;

        /* ---------------- brick field ---------------- */
        brick(wx,wy,u,v);
        let r=Mr,g=Mg,b=Mb,h=Mh,rg=Mrg,met=Mmet;

        /* pilaster: the pier between bays stands a little proud */
        if(proud>0){
          const e=Math.max(smoothstep(-aa,aa,L.pier*0.5-lx),
                           smoothstep(-aa,aa,lx-(L.W-L.pier*0.5)));
          h+=proud*clamp(e,0,1);
        }

        /* ---------------- belt course at the floor line ---------------- */
        let onBelt=0;
        if(L.belt>0&&ly<L.belt){
          onBelt=1-smoothstep(L.belt-aa,L.belt,ly);
          stone(u,v,0.98);
          const drip=1-smoothstep(0,aa*1.5,ly);       // the underside edge catches dirt
          r=lerp(r,Mr,onBelt);g=lerp(g,Mg,onBelt);b=lerp(b,Mb,onBelt);
          rg=lerp(rg,Mrg,onBelt);
          h=lerp(h,sillOut*0.55+(fbm(u,v,120,2,seed+59)-0.5)*0.4*MM,onBelt);
          r*=1-drip*0.28;g*=1-drip*0.28;b*=1-drip*0.28;
        }

        /* ---------------- the opening ---------------- */
        const ox0=L.pier*0.5,ox1=L.W-L.pier*0.5;
        const oy0=L.belt+L.sill,oy1=oy0+L.open;
        const inX=lx>ox0&&lx<ox1,inY=ly>oy0&&ly<oy1;

        /* sill below and lintel above, both running past the reveal */
        if(!onBelt){
          const sx=lx>ox0-sillOut*T*0.5-0.06&&lx<ox1+sillOut*T*0.5+0.06;
          if(sx&&ly>oy0-sillT&&ly<=oy0){
            stone(u,v,1.0);
            const t=(oy0-ly)/Math.max(1e-4,sillT);
            r=Mr;g=Mg;b=Mb;rg=Mrg;met=0;
            h=sillOut*(1-t*0.35);                     // weathers back to the wall
            const wash=1-smoothstep(0,0.35,t);        // the wash on top stays wet and dirty
            r*=1-wash*0.16;g*=1-wash*0.16;b*=1-wash*0.15;
          }else if(sx&&ly>=oy1&&ly<oy1+L.lint){
            if(P.lintel==="steel"){                   // a painted angle, rusting at the ends
              const t=(ly-oy1)/L.lint;
              r=lerp(sashC[0],sashC[0]*1.25+18,t);
              g=lerp(sashC[1],sashC[1]*1.25+18,t);
              b=lerp(sashC[2],sashC[2]*1.2+16,t);
              rg=0.62;met=0.35;h=revealD*0.30;
              const rust=clamp(fbm2(u,v,40,64,3,seed+61)*1.4-0.5,0,1)*P.rust;
              r=lerp(r,132,rust*0.8);g=lerp(g,74,rust*0.8);b=lerp(b,44,rust*0.8);
              rg=lerp(rg,0.95,rust);met=lerp(met,0.1,rust);
            }else if(P.lintel==="stone"){
              stone(u,v,1.02);r=Mr;g=Mg;b=Mb;rg=Mrg;met=0;h=sillOut*0.5;
            }else{                                    // soldier course: bricks on end
              const sc=Math.floor((lx-ox0)/Math.max(0.02,cH*0.85));
              const f=(lx-ox0)/Math.max(0.02,cH*0.85)-sc;
              const dj=Math.min(Math.min(f,1-f)*cH*0.85,
                                Math.min((ly-oy1)/L.lint,1-(ly-oy1)/L.lint)*L.lint);
              const face=smoothstep(joint*0.5-aa,joint*0.5+aa*0.5,dj);
              const bh=hashi(sc*11,si*7,seed+67),t2=0.82+bh*0.4;
              r=brickC[0]*t2;g=brickC[1]*t2;b=brickC[2]*t2;
              const mo=1-face;
              r=lerp(r,mortC[0],mo);g=lerp(g,mortC[1],mo);b=lerp(b,mortC[2],mo);
              rg=lerp(0.82,0.93,mo);met=0;h=face*0.4*MM-mo*jointD;
            }
          }
        }

        /* ---------------- the sash ---------------- */
        if(inX&&inY&&!onBelt){
          const px=lx-ox0,py=ly-oy0;                  // metres inside the opening
          h=-revealD;
          /* outer frame */
          const dFrame=Math.min(Math.min(px,L.ow-px),Math.min(py,L.open-py));
          const onFrame=1-smoothstep(frame-aa,frame,dFrame);
          /* which half, and the transom between them */
          const inBot=py<L.botH;
          const onTrans=1-smoothstep(transB*0.5-aa,transB*0.5,Math.abs(py-L.botH));
          /* the pane grid of this half */
          const hy0=inBot?0:L.botH,hh=inBot?L.botH:L.topH;
          const nR=inBot?L.paneB:L.paneT;
          const pw=L.ow/L.paneC,ph2=hh/nR;
          const cx=Math.floor(px/pw),cy=Math.floor((py-hy0)/ph2);
          const fxp=px/pw-cx,fyp=(py-hy0)/ph2-cy;
          const dBar=Math.min(Math.min(fxp,1-fxp)*pw,Math.min(fyp,1-fyp)*ph2);
          const onBar=1-smoothstep(muntin*0.5-aa,muntin*0.5,dBar);
          /* the hopper: the row of panes against the transom is the operable
             one on a sash of this kind, and it carries its own heavier rail */
          let onVent=0,inVent=false;
          if(P.hopper&&L.paneB>1){
            const vy0=L.botH-L.botH/L.paneB;
            onVent=1-smoothstep(transB*0.36-aa,transB*0.36,Math.abs(py-vy0));
            inVent=inBot&&py>vy0;
          }
          const steel=clamp(Math.max(Math.max(onFrame,onVent),Math.max(onTrans,onBar)),0,1);

          if(steel>0.02){
            const t=0.92+hashi(cx,cy,seed+71)*0.18;
            r=sashC[0]*t;g=sashC[1]*t;b=sashC[2]*t;
            rg=0.55;met=0.45;
            h=-revealD+(onFrame>0.5?revealD*0.75:revealD*0.45)*steel;
            const rust=clamp(fbm2(u,v,72,72,3,seed+73)*1.5-0.62,0,1)*P.rust;
            r=lerp(r,128,rust*0.85);g=lerp(g,72,rust*0.85);b=lerp(b,42,rust*0.85);
            rg=lerp(rg,0.95,rust);met=lerp(met,0.1,rust);
          }else{
            /* ---- one pane ---- */
            const key=((bi*131+si*17)|0),half=inBot?0:1;
            const p1=hashi(cx*7919+key,cy*104729+half*3,seed+79);
            const p2=hashi(cx*13+key*5,cy*29+half*11,seed+83);
            const gone=p1<P.broken*0.55;
            const white=!gone&&p2<P.white;
            const lit=!gone&&!white&&!inVent&&hashi(cx*3+key,cy*5+half,seed+89)<P.winLit;
            h=-revealD-0.004*M;
            if(gone){                                 // no glass: the dark of the room
              r=14;g=15;b=16;rg=0.96;met=0;
              /* the last shards still in the rebate */
              const sh=1-smoothstep(0,pw*0.16,dBar);
              const jag=fbm2(u,v,160,160,2,seed+97);
              if(sh>0&&jag>0.55){r=88;g=96;b=100;rg=0.2;met=0.6;}
            }else if(white){                          // painted out, the wartime habit
              const wn=fbm2(u,v,96,96,3,seed+101);
              const t2=0.80+wn*0.35;
              r=214*t2;g=212*t2;b=202*t2;rg=0.88;met=0;
              const streak=clamp(fbm2(u,v,72,10,2,seed+103)*1.3-0.4,0,1);
              r*=1-streak*0.16;g*=1-streak*0.16;b*=1-streak*0.15;
            }else{
              const grime=clamp(0.30+fbm2(u,v,56,72,3,seed+107)*0.9
                                -smoothstep(0,ph2,fyp*ph2)*0.25,0,1)*P.filth;
              r=glassC[0];g=glassC[1];b=glassC[2];
              /* the sky lands on the upper panes, so they read lighter */
              const skyk=0.35+0.5*(py/Math.max(0.01,L.open));
              r=lerp(r,r*1.5+34,skyk*0.5);g=lerp(g,g*1.5+38,skyk*0.5);b=lerp(b,b*1.5+46,skyk*0.5);
              r=lerp(r,96,grime*0.7);g=lerp(g,94,grime*0.7);b=lerp(b,88,grime*0.7);
              rg=lerp(0.10,0.55,grime);
              met=0.85;                               // the deliberate glass cheat
              if(inVent){                             // tipped in, so it shows the room
                r*=0.55;g*=0.56;b*=0.58;h-=0.006*M;
              }
              if(lit){
                /* the glow belongs in the emissive map. Blowing the albedo out
                   as well gives a pane that reads as white paint in daylight. */
                r=lerp(r,232,0.34);g=lerp(g,204,0.34);b=lerp(b,150,0.30);
                rg=0.28;met=0.45;Memi=clamp(P.winGlow,0,1)*255;
              }
            }
          }
        }

        /* ---------------- weathering over the lot ---------------- */
        /* soot runs from every horizontal that sheds water: the sill of this
           storey and the belt course above it */
        if(P.soot>0){
          /* two sources shed water down this wall: the underside of this
             storey's sill, and the floor line above it */
          const col=fbm2(u,v,64,7,3,seed+109);
          let sootA=0;
          const d1=(L.belt+L.sill-sillT)-ly,d2=L.H-ly;
          if(d1>0)sootA=clamp(Math.exp(-d1/(0.35+col*1.9))*smoothstep(0,0.04,d1)*(col*1.7-0.35),0,1);
          if(d2>0)sootA=Math.max(sootA,clamp(Math.exp(-d2/(0.35+col*1.9))*smoothstep(0,0.04,d2)*(col*1.7-0.35),0,1));
          sootA*=P.soot;
          if(sootA>0){r=lerp(r,r*0.42+5,sootA);g=lerp(g,g*0.42+5,sootA);b=lerp(b,b*0.41+5,sootA);
            rg=lerp(rg,0.95,sootA*0.7);}
        }
        if(P.effl>0){
          const e=clamp(fbm(u,v,11,4,seed+113)*1.55-0.72,0,1)*P.effl;
          r=lerp(r,214,e*0.7);g=lerp(g,210,e*0.7);b=lerp(b,200,e*0.65);
          rg=lerp(rg,0.96,e);
        }
        if(P.grime>0){
          const gr=clamp(fbm(u,v,6,3,seed+127)*1.25-0.32,0,1)*P.grime;
          r=lerp(r,r*0.62+6,gr*0.75);g=lerp(g,g*0.62+6,gr*0.75);b=lerp(b,b*0.60+6,gr*0.75);
        }

        HGT[i]=h;
        A[i*3]=r;A[i*3+1]=g;A[i*3+2]=b;
        RGH[i]=clamp(rg,0.05,1)*255;
        MET[i]=clamp(met,0,1)*255;
        EMI[i]=Memi;
        AOc[i]=255;
      }
    }
    if(y<S){io.progress(y/S*0.7);setTimeout(pass1,0);}
    else{io.progress(0.75);setTimeout(pass2,0);}
  }

  function pass2(){
    const r1=Math.max(1,Math.round(S*0.004)),r2=Math.max(3,Math.round(S*0.02));
    const b1=boxBlurWrap(HGT,S,r1),b2=boxBlurWrap(HGT,S,r2);
    const aoScale=1/Math.max(1e-7,revealD*0.45);
    for(let i=0;i<N;i++){
      const c1=clamp((b1[i]-HGT[i])*aoScale*1.5,0,1);
      const c2=clamp((b2[i]-HGT[i])*aoScale*1.0,0,1);
      AOc[i]=clamp(1-clamp(c1*0.7*0.9+c2*0.75,0,1)*P.aoStr,0,1)*255;
    }
    io.progress(0.9);

    hMin=Infinity;hMax=-Infinity;
    for(let i=0;i<N;i++){const h=HGT[i];if(h<hMin)hMin=h;if(h>hMax)hMax=h;}
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;

    const gy=P.flipG?-1:1;
    for(let yy=0;yy<S;yy++){
      const yp=((yy+1)%S)*S,ym=((yy-1+S)%S)*S,y0=yy*S;
      for(let xx=0;xx<S;xx++){
        const xp=(xx+1)%S,xm=(xx-1+S)%S;
        const dhdu=(HGT[y0+xp]-HGT[y0+xm])*0.5*S*P.normalStr;
        const dhdv=(HGT[yp+xx]-HGT[ym+xx])*0.5*S*P.normalStr;
        let nx=-dhdu,ny=-dhdv*gy;
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;
        const j=(y0+xx)*3;
        NRM[j]=(nx*0.5+0.5)*255;NRM[j+1]=(ny*0.5+0.5)*255;NRM[j+2]=(inv*0.5+0.5)*255;
      }
    }
    io.progress(1);
    io.done({A:A,RGH:RGH,MET:MET,AO:AOc,NRM:NRM,HGT:HGT,EMI:EMI,hMin:hMin,hMax:hMax});
  }

  io.progress(0.02);
  setTimeout(pass1,0);
}

/* ============================ mode definition ============================ */

Forge.register({
  id:"factory",
  label:"Factory",
  blurb:"1940s brick factory wall — steel sash windows",
  title:'Factory <em>Wall</em>',
  tagline:"Brick · steel industrial sash · seamless wall panel",
  actionLabel:"Lay wall",
  busyLabel:"Laying…",
  seamless:true,
  previewSize:256,
  flipPreviewY:true,                    // it is a wall: y is up in world terms
  preview:{gain:3.0,amb:1.12,specK:0.55,skyLo:[0.16,0.19,0.23],skyHi:[0.34,0.38,0.44]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
    {key:"ao",label:"AO"},{key:"emissive",label:"Emissive"},
    {key:"height",label:"Height"},{key:"orm",label:"ORM packed"}
  ],

  presets:[
    {id:"works",label:"Red brick works",set:{
      tileW:14,rows:3,cols:4,bond:"common",headerEvery:6,
      brickL:215,brickH:65,jointMm:10,jointDmm:5,brickIrreg:.5,
      pierMm:900,pierMmProud:25,beltMm:340,sillMm:1100,openMm:2600,lintelMm:280,
      lintel:"soldier",sillTMm:160,sillOutMm:45,revealMm:110,
      transom:.5,paneMm:430,muntinMm:26,transomMm:80,frameMm:60,hopper:true,
      broken:.12,white:.08,winLit:.1,winGlow:.7,filth:.55,
      soot:.45,effl:.25,spall:.25,spallMm:8,pointing:.35,rust:.35,grime:.4,
      cBrick:"#8a4030",cMortar:"#a89b86",cStone:"#9a9589",cSash:"#3b423c",cGlass:"#3b464e"}},
    {id:"sooted",label:"Sooted mill",set:{
      tileW:16,rows:3,cols:4,bond:"english",headerEvery:5,
      brickL:225,brickH:70,jointMm:12,jointDmm:7,brickIrreg:.7,
      pierMm:1050,pierMmProud:35,beltMm:400,sillMm:1000,openMm:2800,lintelMm:320,
      lintel:"soldier",sillTMm:180,sillOutMm:55,revealMm:140,
      transom:.5,paneMm:400,muntinMm:28,transomMm:95,frameMm:70,hopper:true,
      broken:.2,white:.05,winLit:.06,winGlow:.6,filth:.85,
      soot:.9,effl:.15,spall:.4,spallMm:11,pointing:.55,rust:.55,grime:.7,
      cBrick:"#6b3428",cMortar:"#8c8375",cStone:"#82807a",cSash:"#2f342f",cGlass:"#333c43"}},
    {id:"whitewash",label:"Whitewashed warehouse",set:{
      tileW:13,rows:3,cols:4,bond:"running",headerEvery:6,
      brickL:200,brickH:60,jointMm:10,jointDmm:4,brickIrreg:.35,
      pierMm:800,pierMmProud:15,beltMm:280,sillMm:1200,openMm:2400,lintelMm:240,
      lintel:"steel",sillTMm:150,sillOutMm:40,revealMm:95,
      transom:.5,paneMm:450,muntinMm:24,transomMm:70,frameMm:55,hopper:false,
      broken:.06,white:.55,winLit:.14,winGlow:.75,filth:.35,
      soot:.2,effl:.4,spall:.12,spallMm:6,pointing:.2,rust:.2,grime:.25,
      cBrick:"#a6866b",cMortar:"#b9b1a1",cStone:"#a8a49a",cSash:"#454b45",cGlass:"#43505a"}},
    {id:"derelict",label:"Derelict plant",set:{
      tileW:15,rows:3,cols:4,bond:"common",headerEvery:7,
      brickL:215,brickH:65,jointMm:11,jointDmm:9,brickIrreg:.85,
      pierMm:950,pierMmProud:30,beltMm:360,sillMm:1050,openMm:2700,lintelMm:300,
      lintel:"steel",sillTMm:170,sillOutMm:50,revealMm:130,
      transom:.5,paneMm:420,muntinMm:26,transomMm:85,frameMm:60,hopper:true,
      broken:.72,white:.1,winLit:0,winGlow:.6,filth:.9,
      soot:.6,effl:.55,spall:.75,spallMm:14,pointing:.85,rust:.85,grime:.75,
      cBrick:"#7a4234",cMortar:"#8a8171",cStone:"#8b8880",cSash:"#3a3a34",cGlass:"#2f383e"}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:[
        [512,"512 × 512"],[1024,"1024 × 1024"],[2048,"2048 × 2048"],[4096,"4096 × 4096 — slow, heavy"]]},
      {id:"tileW",label:"Tile covers",unit:"m",min:4,max:40,step:0.5,value:14},
      {type:"readout"},
      {id:"seed",type:"seed",value:1947}
    ]},
    {title:"Bays & storeys",open:true,rows:[
      {id:"rows",label:"Window rows",min:1,max:8,step:1,value:3},
      {id:"cols",label:"Window bays",min:1,max:10,step:1,value:4},
      {id:"pierMm",label:"Pier between bays",unit:"mm",min:200,max:3000,step:25,value:900},
      {id:"pierMmProud",label:"Pilaster projection",unit:"mm",min:0,max:120,step:5,value:25},
      {id:"beltMm",label:"Belt course at floor line",unit:"mm",min:0,max:900,step:10,value:340},
      {id:"sillMm",label:"Sill height above floor",unit:"mm",min:300,max:2500,step:25,value:1100},
      {id:"openMm",label:"Opening height",unit:"mm",min:600,max:5000,step:50,value:2600},
      {id:"lintelMm",label:"Lintel depth",unit:"mm",min:60,max:800,step:10,value:280},
      {id:"revealMm",label:"Reveal depth",unit:"mm",min:20,max:400,step:5,value:110},
      {type:"note",html:"The tile is square, so a storey is the tile height divided by the rows "+
        "and a bay is the width divided by the bays. The readout gives you both in metres — "+
        "dial <b>tile covers</b> until they are the storey and bay you want."}
    ]},
    {title:"Windows",open:true,rows:[
      {id:"transom",label:"Transom position",min:0.15,max:0.85,step:0.01,value:0.5},
      {id:"paneMm",label:"Target pane size",unit:"mm",min:120,max:1200,step:10,value:430},
      {id:"muntinMm",label:"Glazing bar",unit:"mm",min:8,max:80,step:1,value:26},
      {id:"transomMm",label:"Transom rail",unit:"mm",min:20,max:250,step:5,value:80},
      {id:"frameMm",label:"Sash frame",unit:"mm",min:20,max:200,step:5,value:60},
      {id:"broken",label:"Broken & missing panes",min:0,max:1,step:0.01,value:0.12},
      {id:"white",label:"Painted-out panes",min:0,max:1,step:0.01,value:0.08},
      {id:"filth",label:"Dirt on the glass",min:0,max:1,step:0.01,value:0.55},
      {id:"winLit",label:"Lit from inside",min:0,max:1,step:0.01,value:0.1},
      {id:"winGlow",label:"Glow strength",min:0,max:1,step:0.01,value:0.7},
      {type:"checks",items:[{id:"hopper",label:"Hopper vent against the transom",value:true}]},
      {type:"note",html:"Pane counts are <b>snapped</b>, not set: the target size is divided into "+
        "each half of the opening and rounded, so a whole number of panes fits above and below "+
        "the transom and the bars stay square. The readout says what it landed on."}
    ]},
    {title:"Brick & stonework",rows:[
      {id:"bond",type:"select",label:"Bond",value:"common",options:[
        ["common","Common — header course"],["running","Running stretcher"],
        ["english","English — alternate courses"],["stack","Stack"]]},
      {id:"headerEvery",label:"Header course every",unit:"courses",min:2,max:12,step:1,value:6,need:"common"},
      {id:"brickL",label:"Brick length",unit:"mm",min:150,max:320,step:5,value:215},
      {id:"brickH",label:"Brick height",unit:"mm",min:40,max:120,step:1,value:65},
      {id:"jointMm",label:"Mortar joint",unit:"mm",min:4,max:25,step:0.5,value:10},
      {id:"jointDmm",label:"Joint recess",unit:"mm",min:0,max:20,step:0.5,value:5},
      {id:"brickIrreg",label:"Brick irregularity",min:0,max:1,step:0.01,value:0.5},
      {id:"lintel",type:"select",label:"Lintel",value:"soldier",options:[
        ["soldier","Soldier course"],["steel","Painted steel angle"],["stone","Cast stone"]]},
      {id:"sillTMm",label:"Sill depth",unit:"mm",min:60,max:400,step:10,value:160},
      {id:"sillOutMm",label:"Sill & belt projection",unit:"mm",min:0,max:150,step:5,value:45}
    ]},
    {title:"Age",rows:[
      {id:"soot",label:"Soot streaking",min:0,max:1,step:0.01,value:0.45},
      {id:"spall",label:"Spalled brick faces",min:0,max:1,step:0.01,value:0.25},
      {id:"spallMm",label:"Spall depth",unit:"mm",min:1,max:30,step:0.5,value:8},
      {id:"pointing",label:"Lost pointing",min:0,max:1,step:0.01,value:0.35},
      {id:"effl",label:"Efflorescence",min:0,max:1,step:0.01,value:0.25},
      {id:"rust",label:"Rust from the steel",min:0,max:1,step:0.01,value:0.35},
      {id:"grime",label:"Overall grime",min:0,max:1,step:0.01,value:0.4},
      {type:"colors",label:"Brick · mortar · stone · sash · glass",items:[
        {id:"cBrick",value:"#8a4030"},{id:"cMortar",value:"#a89b86"},
        {id:"cStone",value:"#9a9589"},{id:"cSash",value:"#3b423c"},{id:"cGlass",value:"#3b464e"}]}
    ]},
    {title:"Maps",rows:[
      {id:"normalStr",label:"Normal strength",min:0.1,max:3,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:0.85},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  needs:function(P){return [P.bond];},

  readout:function(P){
    const L=layout(P),S=P.size|0,pxPerM=S/L.T;
    const nC=Math.max(1,Math.round(L.T/Math.max(0.02,(P.brickH+P.jointMm)*0.001)));
    const nB=Math.max(1,Math.round(L.T/Math.max(0.05,(P.brickL+P.jointMm)*0.001)));
    const cH=L.T/nC*1000,bL=L.T/nB*1000;
    let m="<b>"+Math.round(pxPerM)+" px/m</b> · "+(1000/pxPerM).toFixed(1)+" mm per texel";
    m+="<br>storey <b>"+L.H.toFixed(2)+" m</b> · bay <b>"+L.W.toFixed(2)+" m</b> · "+
       "opening <b>"+L.ow.toFixed(2)+" × "+L.open.toFixed(2)+" m</b>";
    m+="<br>sash <b>"+L.paneC+" panes across</b>, "+L.paneB+" below the transom, "+L.paneT+" above";
    const paneW=L.ow/L.paneC*1000,paneB=L.botH/L.paneB*1000,paneT=L.topH/L.paneT*1000;
    m+=" — "+paneW.toFixed(0)+"×"+paneB.toFixed(0)+" and "+paneW.toFixed(0)+"×"+paneT.toFixed(0)+" mm";
    m+="<br>bond snapped to <b>"+cH.toFixed(1)+" mm</b> courses of <b>"+bL.toFixed(0)+" mm</b> "+
       "("+nC+" × "+nB+" per tile)";
    const barPx=P.muntinMm/1000*pxPerM;
    if(barPx<1.2)m+="<br><b>glazing bar "+barPx.toFixed(2)+" px</b> — held at one texel; raise the "+
                    "resolution or the target pane size or the sash turns to mush";
    const jointPx=P.jointMm/1000*pxPerM;
    if(jointPx<1.2)m+="<br>mortar joint "+jointPx.toFixed(2)+" px — the bond will not read";
    if(P.openMm*0.001>L.H-L.belt-L.sill-L.lint-0.12)
      m+="<br>opening clipped to <b>"+L.open.toFixed(2)+" m</b> — the storey cannot hold the rest";
    return m;
  },

  tileTag:function(){return "tiles ↔ and ↕";},
  sizeTag:function(P){return (P.rows|0)+"×"+(P.cols|0)+" · "+(+P.tileW||14)+" m";},

  writers:function(B,P){
    const E=B.EMI;
    return {emissive:function(i,o,k){
      const e=E[i];o[k]=e;o[k+1]=Math.round(e*0.83);o[k+2]=Math.round(e*0.55);return 255;
    }};
  },

  size:function(P){const S=P.size|0;return {w:S,h:S};},
  build:build,

  fileBase:function(P,W){return "factory_"+(P.seed|0)+"_"+W;},

  readme:function(P,info){
    const T=Math.max(2,+P.tileW||14);
    const mm=(info.hMax-info.hMin)*T*1000;
    return ["Texture Forge · factory — 1940s brick factory wall",
      "",
      "Seed "+(P.seed|0)+"   Resolution "+info.W+"x"+info.H+"   Seamless in both axes",
      "Tile covers "+T+" m square: "+(P.rows|0)+" storeys by "+(P.cols|0)+" bays.",
      "One texel is "+(T/info.W*1000).toFixed(1)+" mm.",
      "",
      "This is a wall panel, not a material. It repeats in both axes, so it will",
      "carry a whole elevation — but it has no plinth and no parapet, because",
      "neither of those can repeat honestly. Cap it with your own geometry.",
      "",
      "basecolor.png  sRGB albedo. Import as sRGB / colour data.",
      "normal.png     Tangent space, "+info.normalNote+". Non-colour.",
      "roughness.png  Linear grey.",
      "metallic.png   Linear grey. Brick and stone are flat 0; the sash reads as painted",
      "               steel, and intact panes are set to 0.85 on purpose — the same cheat",
      "               the house mode documents, so an opaque pane picks up the environment",
      "               and reads as glass. Broken and painted-out panes are dielectric.",
      "ao.png         Linear grey. The window reveals carry most of it.",
      "emissive.png   Warm interior light in the lit panes; black elsewhere.",
      "height.png     Linear grey spanning "+mm.toFixed(0)+" mm of real relief",
      "               (0-1 maps to "+(info.hMax-info.hMin).toFixed(6)+" in tile-width units).",
      "height16.png   The same field at 16 bits. Use it for displacement: the reveal",
      "               depth eats the range and leaves the brick almost nothing at 8 bits.",
      "orm.png        R = AO, G = roughness, B = metallic.",
      "",
      "Normal strength was baked at "+(+P.normalStr).toFixed(2)+"x."].join("\n");
  }
});

})();
