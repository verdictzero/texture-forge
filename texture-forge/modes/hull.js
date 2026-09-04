/* =====================================================================
   MODE: hull — starship aztec plating
   =====================================================================
   The quilted hull skin of screen starships: a field of plates that are
   very nearly the same colour and very nearly coplanar, and that read
   almost entirely as a difference in SHEEN. Turn the light and the quilt
   appears; look at the albedo alone and it is close to a flat pale grey.
   That is the whole trick, and it is why the roughness map here carries
   more of the design than the base colour does.

   So the defaults are deliberately restrained. Plate relief is a
   millimetre or two, albedo variation is a few per cent, and the
   contrast lives in "Sheen contrast", which drives roughness. Push the
   albedo variation up and it stops looking like a starship and starts
   looking like a patchwork quilt, which is exactly the failure mode of
   most hand-painted attempts at this.

   Over the plate quilt sits a coarser grid of structural bays with a
   heavier scribe line, then access hatches with corner fasteners, trim
   panels in an accent colour, and rows of windows that light up.

   The carving comes from modes/lib/quilt.js, shared with the greeble
   mode. Tiles seamlessly in both axes.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      hashi=Forge.hashi,fbm=Forge.fbm,hex2rgb=Forge.hex2rgb,boxBlurWrap=Forge.blurWrap;

let P={};

/* Every length control is in real units; the generator works in tile-width
   units, where 1 is the whole tile. One place to convert, so nothing drifts. */
function scales(){
  const T=Math.max(0.5,+P.tileM||12);
  return {T:T,m:1/T,mm:0.001/T};
}

/* ============================ the generator ============================ */

function build(params,io){
  P=params;
  const S=io.W,seed=P.seed|0,N=S*S;
  const K=scales();

  const A=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N);
  const MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N);
  const EMI=new Uint8ClampedArray(N);
  const NRM=new Uint8ClampedArray(N*3);
  const HGT=new Float32Array(N);
  let hMin=0,hMax=1;

  const hull=hex2rgb(P.cHull),tint=hex2rgb(P.cTint),accent=hex2rgb(P.cAccent);
  const winLit=hex2rgb(P.cWin);
  const glass=hex2rgb(P.cGlass||"#39424e");   // the unlit pane's own colour

  const px=1/S,aa=px*0.7;                          // one texel, and an edge softener
  const plateH=P.plateH*K.mm;
  const bayH=P.plateH*K.mm*2.2;
  const scribeW=Math.max(P.scribeW*K.mm*0.5,aa);   // half-widths, never thinner than a texel
  const scribeD=P.scribeD*K.mm;
  const bayW=Math.max(P.scribeW*K.mm*1.1,aa);
  const bayD=P.scribeD*K.mm*1.8;
  const fastR=Math.max(P.scribeW*K.mm*1.6,aa*1.6);   // fasteners follow the line weight
  const fastH=P.plateH*K.mm*1.4;

  /* the plate quilt, and a coarse grid of structural bays over it */
  const PQ=Quilt.build({rows:P.rows|0,colsMin:P.colsMin|0,colsMax:P.colsMax|0,
                        split:P.subdiv,depth:P.subdepth|0,
                        minW:4*px,minH:4*px,seed:seed});
  const BQ=Quilt.build({rows:Math.max(1,P.bays|0),colsMin:1,colsMax:3,
                        split:0.45,depth:1,minW:16*px,minH:16*px,seed:seed+4242});
  const rec=Quilt.record(),brec=Quilt.record();

  /* ============================ windows ============================

     A CAPSULE, NOT A RECTANGLE. Nothing that holds pressure has square
     corners: a corner is where the hoop stress goes to find something to
     tear, so every port cut in a real hull — a ship's light, an airliner's
     window, a submarine's viewport — is a slot with radiused ends or a plain
     circle. A rectangle painted on the plating reads as a decal, and it read
     as one here.

     ONE SHAPE, TWO WAYS ROUND. The pane is a stadium: a straight section with
     a semicircle on each end. `winShape` only decides which axis the straight
     section runs along — up the hull or across it — so the two orientations
     are the same drawing and not two drawings that have to be kept in step.

     AND A CIRCLE IS THE SAME CAPSULE WITH NO STRAIGHT SECTION. That is why
     the round ones can be scattered through a row of slots and still belong
     to it: they are the same radius, the same reveal, the same glass. Not a
     second shape — the same shape with its length taken out.

     IT HAS TO FIT ITS OWN CELL. A pane longer than the pitch it is laid on
     runs into its neighbour and a row of windows becomes one lit stripe, so
     both axes are clamped to the cell and the readout says when they were. */
  const winBands=P.winRows|0;
  const winCols=Math.max(1,Math.round(K.T/Math.max(0.2,+P.winPitch)));
  const winVert=(P.winShape||"vcap")!=="hcap";
  /* the cell one pane lives in: across it, and along it */
  const cellU=1/winCols,cellV=1/Math.max(1,winBands);
  const cellA=winVert?cellU:cellV,cellB=winVert?cellV:cellU;
  const askR=P.winW*K.m*0.5,askL=P.winH*K.m*0.5;
  const winR=Math.min(askR,cellA*0.42);              // the pane's radius
  /* never shorter than it is wide: below that a capsule IS a circle, and
     letting the length go under the radius turns the ends inside out */
  const winL=Math.min(Math.max(askL,winR),cellB*0.45);
  const winStraight=Math.max(0,winL-winR);
  const winD=Math.max(P.scribeD*K.mm*2.5,P.plateH*K.mm*3);
  const frameW=Math.max(P.scribeW*K.mm*1.6,aa*1.5)*Math.max(0.2,+P.winFrame||1);

  /* A ROOM IS SEVERAL WINDOWS. On the six-foot Enterprise-D the panes of one
     compartment were meant to be all lit or all dark together, and the two
     rows on deck nine famously are not — which is exactly what a per-pane coin
     flip looks like. So the draw is on the ROOM a pane belongs to.

     The run length has to DIVIDE the count across the tile or the room
     straddling the seam is half lit, so the asked-for length is walked down to
     the nearest divisor rather than used as given. */
  let roomN=1;
  const askRoom=clamp(P.winRoom|0,1,winCols);
  for(let k=askRoom;k>=1;k--)if(winCols%k===0){roomN=k;break;}

  /* how far in from the seal the grime reaches. A pane is cleaned from the
     middle outward and never at the edge, on a starship as on a bus. */
  const grimeW=Math.max(aa*1.2,winR*clamp(+P.winGrimeW,0,1));

  const band=Math.max(4,Math.round(65536/S));
  let y=0;

  function pass1(){
    const end=Math.min(S,y+band);
    for(;y<end;y++){
      const v=(y+0.5)/S;
      for(let x=0;x<S;x++){
        const u=(x+0.5)/S,i=y*S+x;

        Quilt.locate(PQ,u,v,rec);
        Quilt.locate(BQ,u,v,brec);

        /* four independent draws per plate. Keeping sheen, tint, kind and
           gloss on separate hashes matters: share one and every glossy
           plate is also the darkest one, and the eye reads that as a
           printed pattern instead of a manufacturing tolerance. */
        const rSheen=rec.rnd;
        const rTint=Quilt.rand(PQ,rec,101);
        const rKind=Quilt.rand(PQ,rec,211);
        const rHot=Quilt.rand(PQ,rec,409);

        /* ---------------- height: almost nothing, on purpose ---------------- */
        let h=(rSheen-0.5)*2*plateH+(brec.rnd-0.5)*2*bayH;
        const gs=1-smoothstep(0,scribeW,rec.dEdge);       // plate scribe line
        const gb=1-smoothstep(0,bayW,brec.dEdge);         // structural bay line
        h-=gs*scribeD+gb*bayD;

        /* ---------------- access hatch ---------------- */
        let ring=0,fast=0;
        const isHatch=rKind<P.hatch*0.4;
        if(isHatch){
          const inset=Math.max(Math.min(rec.w,rec.h)*0.16,fastR*1.8);
          ring=1-smoothstep(0,scribeW,Math.abs(rec.dEdge-inset));
          h-=ring*scribeD*0.8;
          const ddu=rec.du-inset,ddv=rec.dv-inset;       // hits all four corners at once
          const dd=Math.sqrt(ddu*ddu+ddv*ddv);
          fast=1-smoothstep(fastR*0.7,fastR,dd);
          h+=fast*fastH;
        }

        /* ---------------- windows ---------------- */
        let win=0,frame=0,lit=0,grime=0,paneBright=1;
        if(winBands>0){
          const vb=v*winBands,bi=Math.floor(vb);
          const uc=u*winCols,ui=Math.floor(uc);
          const dU=Math.abs((uc-ui)-0.5)/winCols;        // uv distance from the pane centre
          const dV=Math.abs((vb-bi)-0.5)/winBands;
          /* across the pane and along it, which way round the shape is laid */
          const dA=winVert?dU:dV,dB=winVert?dV:dU;
          /* THE ROUND ONES ARE THE SAME CAPSULE with its straight section
             taken out, so a circle among the slots is the same radius, the
             same reveal and the same glass rather than a second shape that
             happens to be near them */
          const straight=(hashi(ui,bi,seed+3313)<P.winRound)?0:winStraight;
          const dEnd=Math.max(dB-straight,0);
          const d=Math.sqrt(dA*dA+dEnd*dEnd)-winR;
          win=1-smoothstep(0,aa*1.6,d);
          /* the reveal around the pane: without it a window is a rectangle
             painted on the hull rather than something set into it */
          frame=clamp((1-smoothstep(0,aa*1.6,d-frameW))-win,0,1);
          if(win>0.004||frame>0.004){
            lit=hashi(Math.floor(ui/roomN),bi,seed+7717)<P.winLit?1:0;
            /* GRIME AT THE SEAL, which is where it always is: the middle of a
               pane gets wiped and the last centimetre against the frame does
               not. It is what stops an unlit window reading as a decal of a
               dark rectangle — the roughness climbs into the corner and the
               specular dies there, so the glass has an edge in every channel
               and not only in the one nobody turned on. */
            const inward=-d;
            grime=clamp((1-smoothstep(0,grimeW,inward))*P.winGrime*
                        (1+(hashi(ui,bi,seed+911)-0.5)*2*P.winVary),0,1);
            /* and no two rooms have the same lamp in them */
            paneBright=1+(hashi(ui,bi,seed+1213)-0.5)*P.winVary*0.8;
            h-=win*winD-frame*(P.plateH*K.mm*0.5);
          }
        }

        HGT[i]=h;

        /* ---------------- colour ---------------- */
        let r=lerp(hull[0],tint[0],rTint*P.tintVar),
            g=lerp(hull[1],tint[1],rTint*P.tintVar),
            b=lerp(hull[2],tint[2],rTint*P.tintVar);
        const vmul=1+(rSheen-0.5)*P.albedoVar*0.30;      // a few per cent, not a patchwork
        r*=vmul;g*=vmul;b*=vmul;
        if(rKind>1-P.accent*0.5){                        // trim panel
          r=lerp(r,accent[0],0.88);g=lerp(g,accent[1],0.88);b=lerp(b,accent[2],0.88);
        }
        /* a very low-frequency wash so a big hull is not perfectly uniform */
        const wash=1+(fbm(u,v,3,3,seed+83)-0.5)*0.055;
        r*=wash;g*=wash;b*=wash;

        /* scribe lines and hatch rings are shadow, not paint */
        const line=clamp(gs*0.22+gb*0.34+ring*0.20,0,0.7);
        r*=1-line;g*=1-line;b*=1-line;
        if(fast>0){r=lerp(r,r*1.10+16,fast);g=lerp(g,g*1.10+16,fast);b=lerp(b,b*1.10+15,fast);}

        /* carbon scoring: soot around the leading edges of the plates */
        const sc=clamp(fbm(u,v,6,4,seed+53)*1.30-0.46,0,1)*P.scuff;
        if(sc>0){const k=sc*0.72;r=lerp(r,r*0.34+6,k);g=lerp(g,g*0.34+6,k);b=lerp(b,b*0.35+7,k);}

        /* ---------------- surface response ---------------- */
        let rough=P.rough+(rSheen-0.5)*P.aztec*0.55;
        if(rHot>1-P.hotspot*0.28)rough*=0.42;             // the few plates that flash
        rough+=(fbm(u,v,72,3,seed+71)-0.5)*0.05;
        rough+=line*0.16+sc*0.34;
        let met=P.metalness;

        if(frame>0.004){                                 // brushed reveal around the pane
          r=lerp(r,r*1.10+13,frame);g=lerp(g,g*1.10+13,frame);b=lerp(b,b*1.10+13,frame);
          rough=lerp(rough,0.30,frame*0.8);
        }
        if(win>0.004){
          /* AN UNLIT PANE IS DARK TINTED GLASS, NOT A HOLE — and it has to be
             a whole material rather than one dark colour, because half the
             windows on a hull are unlit at any moment and a black rectangle is
             what a decal looks like. The model kits for the six-foot
             Enterprise-D supply clear, white and DARK-TINTED plastic for
             exactly this reason: the dark ones are glass you can see the sky
             in, not holes cut in the saucer.

             So the pane is described entirely in the channels that work
             whether anything is switched on behind it: a low roughness, a high
             metallic — the deliberate specular cheat the house mode uses too —
             and a glass colour of its own. Turn the emissive off completely
             and the windows are still windows. */
          const litC=lit?paneBright:0;
          const dk=1-clamp(+P.winDark,0,1);
          const gr=lit?winLit[0]*0.42*litC:glass[0]*dk;
          const gg=lit?winLit[1]*0.42*litC:glass[1]*dk;
          const gb=lit?winLit[2]*0.42*litC:glass[2]*dk;
          r=lerp(r,gr,win);g=lerp(g,gg,win);b=lerp(b,gb,win);
          let wRough=clamp(+P.winRough,0.02,1),wMet=clamp(+P.winMetal,0,1);
          /* the grime is ON the glass, so it takes the glass's own answer and
             spoils it: rougher, far less specular, and dirtier in colour */
          if(grime>0.002){
            wRough=clamp(wRough+grime*0.62,0.02,1);
            wMet*=1-grime*0.86;
            const k=grime*0.85;
            r=lerp(r,r*0.52+15,k);g=lerp(g,g*0.52+14,k);b=lerp(b,b*0.54+13,k);
          }
          rough=lerp(rough,wRough,win);
          met=lerp(met,wMet,win);
          /* a lit room does not reach its own window frame either */
          EMI[i]=lit?clamp(win*P.winGlow*paneBright*(1-grime*0.8),0,1)*255:0;
        }else EMI[i]=0;

        A[i*3]=r;A[i*3+1]=g;A[i*3+2]=b;
        RGH[i]=clamp(rough,0.03,1)*255;
        MET[i]=clamp(met,0,1)*255;
        AOc[i]=255;                                      // seeded, refined in pass 2
      }
    }
    if(y<S){io.progress(y/S*0.7);setTimeout(pass1,0);}
    else{io.progress(0.75);setTimeout(pass2,0);}
  }

  function pass2(){
    /* AO against two wrapped blurs of the height field. The relief here is
       sub-millimetre, so the comparison is normalised by the scribe depth
       rather than by an absolute scale, or the map comes out blank. */
    const r1=Math.max(1,Math.round(S*0.003)),r2=Math.max(2,Math.round(S*0.014));
    const b1=boxBlurWrap(HGT,S,r1),b2=boxBlurWrap(HGT,S,r2);
    const aoScale=1/Math.max(1e-7,scribeD*0.8);
    for(let i=0;i<N;i++){
      const c1=clamp((b1[i]-HGT[i])*aoScale*2.0,0,1);
      const c2=clamp((b2[i]-HGT[i])*aoScale*1.3,0,1);
      AOc[i]=clamp(1-clamp(c1*0.6+c2*0.7,0,1)*P.aoStr,0,1)*255;
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
  id:"hull",
  label:"Hull",
  group:"Sci-fi",
  threadable:true,
  blurb:"Starship aztec plating — sheen, not colour",
  title:'Aztec <em>Hull</em>',
  tagline:"Starship plating · pearlescent quilt · windows · seamless",
  actionLabel:"Plate hull",
  busyLabel:"Plating…",
  seamless:true,
  previewSize:256,
  /* a pale hull blows out under the default gain, and the whole point is
     the specular, so the direct term is pulled down and the sky pushed up */
  preview:{gain:2.3,amb:1.25,specK:0.62,skyLo:[0.17,0.20,0.25],skyHi:[0.38,0.42,0.50]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
    {key:"ao",label:"AO"},{key:"emissive",label:"Emissive"},
    {key:"height",label:"Height"},{key:"orm",label:"ORM packed"}
  ],

  presets:[
    {id:"refit",label:"Refit — fine and cold",set:{
      tileM:10,rows:22,colsMin:5,colsMax:11,subdiv:.62,subdepth:2,bays:4,
      aztec:.62,albedoVar:.16,tintVar:.42,hotspot:.22,accent:.10,
      plateH:1.2,scribeW:18,scribeD:4,hatch:.14,
      winRows:2,winPitch:2.2,winShape:"vcap",winW:.7,winH:1.6,winRound:.22,winFrame:1,
      winLit:.5,winRoom:2,winGlow:.75,winDark:.5,winRough:.05,winMetal:.9,
      winGrime:.34,winGrimeW:.34,winVary:.34,
      scuff:.08,rough:.38,metalness:.18,
      cHull:"#c4c8c8",cTint:"#b3c2cc",cAccent:"#8d979d",cWin:"#ffd9a0",cGlass:"#333c47"}},
    {id:"tvera",label:"TV era — broad and warm",set:{
      tileM:16,rows:12,colsMin:3,colsMax:7,subdiv:.48,subdepth:2,bays:3,
      aztec:.42,albedoVar:.22,tintVar:.28,hotspot:.14,accent:.14,
      plateH:2.5,scribeW:38,scribeD:7,hatch:.2,
      winRows:3,winPitch:2.6,winShape:"hcap",winW:.85,winH:2,winRound:.30,winFrame:1.3,
      winLit:.62,winRoom:3,winGlow:.9,winDark:.34,winRough:.09,winMetal:.8,
      winGrime:.5,winGrimeW:.45,winVary:.45,
      scuff:.05,rough:.46,metalness:.12,
      cHull:"#cdc9bd",cTint:"#c6bfae",cAccent:"#9a958a",cWin:"#ffcf8a",cGlass:"#43443f"}},
    {id:"nacelle",label:"Nacelle skin — no windows",set:{
      tileM:6,rows:30,colsMin:6,colsMax:14,subdiv:.7,subdepth:3,bays:5,
      aztec:.8,albedoVar:.12,tintVar:.55,hotspot:.35,accent:.06,
      plateH:.8,scribeW:10,scribeD:2.5,hatch:.08,
      winRows:0,winPitch:2.2,winShape:"vcap",winW:.7,winH:1.6,winRound:.25,winFrame:1,
      winLit:.5,winRoom:2,winGlow:.8,winDark:.42,winRough:.07,winMetal:.85,
      winGrime:.45,winGrimeW:.4,winVary:.4,
      scuff:.04,rough:.3,metalness:.3,
      cHull:"#c9ced2",cTint:"#aebfd0",cAccent:"#8794a0",cWin:"#ffd9a0",cGlass:"#39424e"}},
    {id:"scored",label:"Battle-scored",set:{
      tileM:14,rows:16,colsMin:4,colsMax:9,subdiv:.55,subdepth:2,bays:3,
      aztec:.5,albedoVar:.3,tintVar:.3,hotspot:.08,accent:.16,
      plateH:3.5,scribeW:32,scribeD:9,hatch:.28,
      winRows:2,winPitch:2.4,winShape:"vcap",winW:.8,winH:1.5,winRound:.38,winFrame:1.1,
      winLit:.22,winRoom:2,winGlow:.55,winDark:.62,winRough:.16,winMetal:.62,
      winGrime:.85,winGrimeW:.6,winVary:.7,
      scuff:.75,rough:.62,metalness:.2,
      cHull:"#a9aaa4",cTint:"#9aa0a3",cAccent:"#71736f",cWin:"#ffc27a",cGlass:"#2e3138"}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:Forge.sizes("square")},
      {id:"tileM",label:"Tile covers",unit:"m",min:2,max:64,step:0.5,value:12},
      {type:"readout"},
      {id:"seed",type:"seed",value:1701}
    ]},
    {title:"Plate quilt",open:true,rows:[
      {id:"rows",label:"Plate rows",min:4,max:48,step:1,value:16},
      {id:"colsMin",label:"Plates per row (min)",min:1,max:20,step:1,value:4},
      {id:"colsMax",label:"Plates per row (max)",min:1,max:20,step:1,value:9},
      {id:"subdiv",label:"Sub-division",min:0,max:1,step:0.01,value:0.55},
      {id:"subdepth",label:"Sub-division depth",min:0,max:4,step:1,value:2},
      {id:"bays",label:"Structural bays",min:1,max:10,step:1,value:3},
      {id:"scribeW",label:"Scribe line",unit:"mm",min:0,max:150,step:1,value:25},
      {id:"scribeD",label:"Scribe depth",unit:"mm",min:0,max:30,step:0.5,value:5},
      {id:"plateH",label:"Plate relief",unit:"mm",min:0,max:20,step:0.1,value:1.5}
    ]},
    {title:"Aztec sheen",open:true,rows:[
      {id:"aztec",label:"Sheen contrast",min:0,max:1,step:0.01,value:0.55},
      {id:"albedoVar",label:"Albedo variation",min:0,max:1,step:0.01,value:0.18},
      {id:"tintVar",label:"Pearl tint drift",min:0,max:1,step:0.01,value:0.35},
      {id:"hotspot",label:"Bright plates",min:0,max:1,step:0.01,value:0.2},
      {id:"accent",label:"Trim panels",min:0,max:1,step:0.01,value:0.12},
      {type:"note",html:"The quilt is meant to live in the <b>roughness</b> map. Sheen contrast is "+
        "the real control; albedo variation is there for the few per cent of colour difference "+
        "between plates and goes patchwork above about 0.3."}
    ]},
    {title:"Hatches & windows",rows:[
      {id:"hatch",label:"Access hatches",min:0,max:1,step:0.01,value:0.15},
      {id:"winRows",label:"Window bands",min:0,max:8,step:1,value:2},
      {id:"winPitch",label:"Window pitch",unit:"m",min:0.5,max:8,step:0.1,value:2.2},
      {id:"winShape",type:"select",label:"Pane",value:"vcap",options:[
        ["vcap","Vertical capsules"],["hcap","Horizontal capsules"]]},
      {id:"winW",label:"Pane across",unit:"m",min:0.2,max:3,step:0.05,value:0.75},
      {id:"winH",label:"Pane along",unit:"m",min:0.2,max:4,step:0.05,value:1.7},
      {id:"winRound",label:"Round ones",min:0,max:1,step:0.01,value:0.28},
      {id:"winFrame",label:"Reveal width",min:0.2,max:4,step:0.05,value:1},
      {type:"note",html:"A pane is a <b>capsule</b> — a straight section with a semicircle "+
        "on each end — and the shape only decides which way the straight section runs. "+
        "<b>Across</b> is the width of it either way, and <b>along</b> is its length; a pane "+
        "shorter than it is wide is a circle. <b>Round ones</b> scatters plain circles through "+
        "the rows: the same capsule with the straight section taken out, so they are the same "+
        "radius and the same glass as the slots beside them. Both axes are clamped to the "+
        "window pitch — a pane longer than its own cell runs into its neighbour and a row "+
        "becomes one lit stripe."}
    ]},
    {title:"Glass",open:true,need:"win",rows:[
      {id:"winLit",label:"Lit fraction",min:0,max:1,step:0.01,value:0.55},
      {id:"winRoom",label:"Panes per room",min:1,max:8,step:1,value:2},
      {id:"winGlow",label:"Glow strength",min:0,max:1,step:0.01,value:0.8},
      {id:"winDark",label:"Unlit depth",min:0,max:1,step:0.01,value:0.42},
      {id:"winRough",label:"Glass roughness",min:0.02,max:0.7,step:0.01,value:0.07},
      {id:"winMetal",label:"Glass specular",min:0,max:1,step:0.01,value:0.85},
      {id:"winGrime",label:"Edge grime",min:0,max:1,step:0.01,value:0.45},
      {id:"winGrimeW",label:"Grime reach",min:0,max:1,step:0.01,value:0.40},
      {id:"winVary",label:"Pane to pane",min:0,max:1,step:0.01,value:0.40},
      {type:"note",html:"<b>An unlit pane is dark tinted glass, not a hole.</b> Half the "+
        "windows on a hull are dark at any moment, and a black rectangle is what a decal "+
        "looks like — so the pane is described in the channels that work with nothing "+
        "switched on behind it: <b>glass roughness</b>, <b>glass specular</b> and its own "+
        "colour. Turn the glow to zero and the windows are still windows.<br>"+
        "<b>Edge grime</b> is where dirt actually is: the middle of a pane gets wiped and "+
        "the last centimetre against the frame does not. It roughens the glass, kills the "+
        "specular and dirties the colour, so the pane has an edge in every channel.<br>"+
        "<b>Panes per room</b> lights them in runs rather than one at a time. On the "+
        "six-foot Enterprise-D the windows of one compartment were meant to be all lit or "+
        "all dark together; the two rows on deck nine famously are not, and that is exactly "+
        "what a per-pane coin flip looks like."}
    ]},
    {title:"Colour & finish",rows:[
      {type:"colors",label:"Hull · pearl · trim · lit · glass",items:[
        {id:"cHull",value:"#c6c9c6"},{id:"cTint",value:"#b6c3cc"},
        {id:"cAccent",value:"#8e969b"},{id:"cWin",value:"#ffd9a0"},
        {id:"cGlass",value:"#39424e"}]},
      {id:"scuff",label:"Carbon scoring",min:0,max:1,step:0.01,value:0.1},
      {id:"rough",label:"Base roughness",min:0.05,max:1,step:0.01,value:0.42},
      {id:"metalness",label:"Metalness",min:0,max:1,step:0.01,value:0.15}
    ]},
    {title:"Maps",rows:[
      {id:"normalStr",label:"Normal strength",min:0.1,max:3,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:0.7},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  /* a maximum below the minimum would silently produce one column per row */
  derive:function(P,ui){
    if(P.colsMax<P.colsMin)ui.set("colsMax",P.colsMin);
  },

  readout:function(P){
    const T=Math.max(0.5,+P.tileM||12),S=P.size|0,pxPerM=S/T;
    const sub=Math.pow(2,P.subdepth|0);
    const wideCm=T/Math.max(1,P.colsMin|0)*100,tallCm=T/Math.max(1,P.rows|0)*100;
    const narrowCm=wideCm/Math.max(1,P.colsMax|0)*Math.max(1,P.colsMin|0)/sub;
    const shortCm=tallCm/sub;
    let m="<b>"+Math.round(pxPerM)+" px/m</b> · "+(1000/pxPerM).toFixed(1)+" mm per texel";
    m+="<br>plates <b>"+shortCm.toFixed(0)+"–"+tallCm.toFixed(0)+" cm</b> tall · <b>"+
       narrowCm.toFixed(0)+"–"+wideCm.toFixed(0)+" cm</b> wide";
    const smallPx=Math.min(narrowCm,shortCm)/100*pxPerM;
    if(smallPx<6)m+="<br><b>smallest plate "+smallPx.toFixed(1)+" px</b> — drop the sub-division "+
                    "depth or raise the resolution, or the quilt turns to noise";
    const linePx=P.scribeW/1000*pxPerM;
    if(P.scribeW>0&&linePx<1)m+="<br>scribe line "+linePx.toFixed(2)+" px — held at one texel";
    if(P.winRows>0){
      /* THE PANE THAT WILL ACTUALLY BE CUT, not the one that was asked for. Both
         axes are clamped to the cell the pane lives in, and a readout that
         reported the request would be describing a window nobody can see. */
      const T=+P.tileM||12;
      const nU=Math.max(1,Math.round(T/Math.max(0.2,+P.winPitch)));
      const vert=(P.winShape||"vcap")!=="hcap";
      const cellA=(vert?T/nU:T/P.winRows),cellB=(vert?T/P.winRows:T/nU);
      const across=Math.min(+P.winW,cellA*0.84);
      const along=Math.min(Math.max(+P.winH,across),cellB*0.90);
      const cut=(across<+P.winW-1e-6)||(along<+P.winH-1e-6);
      m+="<br>panes <b>"+across.toFixed(2)+" × "+along.toFixed(2)+" m</b> "+
         (vert?"upright":"lying")+" capsules, "+Math.round(P.winRound*100)+"% of them round";
      /* THE ROOM LENGTH ACTUALLY USED. A room has to divide the count across
         the tile or the one straddling the seam comes out half lit, so an
         asked-for run is walked down to the nearest divisor — and a readout
         that reported the request would be describing a building nobody
         lives in. */
      let rn=1;
      for(let k=Math.max(1,Math.min(P.winRoom|0,nU));k>=1;k--)if(nU%k===0){rn=k;break;}
      m+="<br>"+nU+" across the tile, lit in rooms of <b>"+rn+"</b>";
      if(rn!==(P.winRoom|0))m+=" — "+(P.winRoom|0)+" does not divide "+nU+
                               ", and a room across the seam would be half lit";
      if(cut)m+="<br><b>cut down to fit the window pitch</b> — widen the pitch or "+
                "drop a band to get the pane you asked for";
      const wPx=across*pxPerM;
      if(wPx<4)m+="<br>window panes "+wPx.toFixed(1)+" px across — too small to read";
    }
    return m;
  },

  tileTag:function(){return "tiles ↔ and ↕";},
  sizeTag:function(P){return (+P.tileM||12)+" m";},

  /* the built-in emissive writer is a fixed warm glow; hull windows take
     their colour from the panel so a cold-lit ship is possible */
  writers:function(B,P){
    const c=hex2rgb(P.cWin),E=B.EMI;
    return {emissive:function(i,o,k){
      const e=E[i]/255;
      o[k]=c[0]*e;o[k+1]=c[1]*e;o[k+2]=c[2]*e;return 255;
    }};
  },

  /* the glass only exists where there are windows, and eleven controls for a
     nacelle skin with none is eleven controls in the way */
  needs:function(P){return (P.winRows|0)>0?["win"]:[];},

  /* a tiling material: one tile of it, at the size the mode says it covers */
  plan:function(P){const t=Math.max(0.05,+P.tileM||12);return {w:t,h:t,tile:t,cutout:false};},

  size:function(P){const S=P.size|0;return {w:S,h:S};},
  build:build,

  fileBase:function(P,W){return "hull_"+(P.seed|0)+"_"+W;},

  readme:function(P,info){
    const T=Math.max(0.5,+P.tileM||12);
    const mm=(info.hMax-info.hMin)*T*1000;
    /* the same walk-down the generator does, so the readme quotes the room
       length that was actually used and not the one that was asked for */
    const wCols=Math.max(1,Math.round(T/Math.max(0.2,+P.winPitch)));
    let wRoom=1;
    for(let k=Math.min(Math.max(1,P.winRoom|0),wCols);k>=1;k--)if(wCols%k===0){wRoom=k;break;}
    return ["Texture Forge · hull — starship aztec plating",
      "",
      "Seed "+(P.seed|0)+"   Resolution "+info.W+"x"+info.H+"   Seamless in both axes",
      "Tile covers "+T+" m, so one texel is "+(T/info.W*1000).toFixed(2)+" mm.",
      "",
      "The quilt is a specular effect. Almost all of it is in roughness.png; the",
      "base colour is close to flat by design, and a hull lit by a broad soft",
      "source will show almost nothing until you put a hard light on it.",
      "",
      "basecolor.png  sRGB albedo. Import as sRGB / colour data.",
      "normal.png     Tangent space, "+info.normalNote+". Non-colour.",
      "roughness.png  Linear grey. This is where the aztec pattern lives.",
      "metallic.png   Linear grey. The hull sits at "+(+P.metalness).toFixed(2)+" and the panes at "+(+P.winMetal).toFixed(2)+",",
      "               the same cheat the house mode uses — on an opaque hull a metallic",
      "               pane picks up the environment and reads as glass. Doing real",
      "               transparent glass? Set the panes from emissive and pull metallic",
      "               back to the hull value.",
      "ao.png         Linear grey ambient occlusion, from the scribe lines and bay steps.",
      "emissive.png   Lit window panes in the window colour; black elsewhere.",
      "height.png     Linear grey spanning "+mm.toFixed(2)+" mm of real relief",
      "               (0-1 maps to "+(info.hMax-info.hMin).toFixed(6)+" in tile-width units).",
      "height16.png   The same field at 16 bits. Worth using: the window recesses and",
      "               the bay steps take most of the range, so at 8 bits the plate",
      "               quilt itself is left with only a few dozen levels.",
      "orm.png        R = AO, G = roughness, B = metallic.",
      ""].concat(P.winRows>0?[
      "The panes are CAPSULES — a straight section with a semicircle on each end —",
      "laid "+(((P.winShape||"vcap")!=="hcap")?"upright":"on their side")+", with "+
        Math.round(P.winRound*100)+"% of them round. A circle here is the same capsule",
      "with its straight section taken out, so the round ones share the radius, the",
      "reveal and the glass of the slots beside them rather than being a second shape.",
      "Nothing that holds pressure has square corners, which is the whole reason.",
      "",
      "AN UNLIT PANE IS DESCRIBED ENTIRELY BY THE PBR CHANNELS, not by the emissive.",
      "It is dark tinted glass rather than a black hole: base colour "+Math.round((1-Math.min(1,Math.max(0,+P.winDark)))*100)+"% of the",
      "glass colour, roughness "+(+P.winRough).toFixed(2)+" against a hull at "+(+P.rough).toFixed(2)+", metallic "+(+P.winMetal).toFixed(2)+". So an",
      "unlit window still catches a highlight and still reads as a window with the",
      "emissive map switched off entirely.",
      "",
      "The GLASS IS DIRTIEST AT ITS SEAL. Grime rides the last "+Math.round((+P.winGrimeW)*100)+"% of the pane in from",
      "the frame, roughening it and killing the specular where the gasket sits, which",
      "is where a real port is dirty and where a flat pane gives itself away.",
      "",
      "Windows light by ROOM, not by pane: "+wRoom+" panes to a room, so a lit compartment",
      "is a run of windows rather than a coin flip per pane.",
      ""]:[]).concat([
      "Normal strength was baked at "+(+P.normalStr).toFixed(2)+"x."]).join("\n");
  }
});

})();
