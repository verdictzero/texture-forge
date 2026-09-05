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
  const cellU=1/winCols,cellV=1/Math.max(1,winBands);   // the cell a pane lives in

  /* WIDTH IS ACROSS THE HULL AND HEIGHT IS UP IT, WHICHEVER WAY THE PANE LIES.
     They used to be "across" and "along" — across the pane's own straight
     section and along it — so on a lying capsule they were the two texture
     axes SWAPPED, and making a window taller meant reaching for the control
     labelled width. Which is a fine way to describe a shape and a hopeless way
     to size one.

     So the two numbers are the two texture axes, full stop, and the SHAPE
     falls out of them: taller than it is wide is an upright capsule, wider
     than tall is a lying one, and equal is a circle. There is nothing left for
     an orientation control to decide, so its job now is only to OVERRIDE —
     force upright, or force lying, and the numbers get swapped to suit. */
  let wU=Math.min(P.winW*K.m,cellU*0.90);            // full width, held to the cell
  let wV=Math.min(P.winH*K.m,cellV*0.90);            // full height, same
  const lay=P.winShape||"auto";
  if((lay==="vcap"&&wV<wU)||(lay==="hcap"&&wU<wV)){const t=wU;wU=wV;wV=t;}
  wU=Math.min(wU,cellU*0.90);wV=Math.min(wV,cellV*0.90);   // a swap can overrun
  /* one shape for all three cases: a rounded box whose radius is half its
     short side, which is a capsule when the sides differ and a circle when
     they do not — so a round one among the slots is the same drawing */
  const winR=Math.min(wU,wV)*0.5;
  const strU=Math.max(0,(wU-wV)*0.5),strV=Math.max(0,(wV-wU)*0.5);
  const winD=Math.max(P.scribeD*K.mm*2.5,P.plateH*K.mm*3);

  /* THE SURROUND IS A FORGING, NOT A SCRIBE LINE. A window in a pressure hull
     is a machined penetration with a frame welded into it, and that frame is
     THICK — on the six-foot Enterprise-D the window strips are a moulded part
     standing proud of the plating, not a line drawn on it. It was a line here:
     a hair over the scribe width, which is the one weight on the hull that says
     "engraved" rather than "fitted".

     So it is sized off the PANE — a fraction of the pane's own radius, which
     keeps a big port's frame heavy and a small one's fine without a second
     control — and then held to the room left in the cell, since a collar that
     overruns its cell welds itself to its neighbour's. */
  const lipRoom=Math.min(cellU*0.48-wU*0.5,cellV*0.48-wV*0.5);
  const lipW=Math.max(aa*1.5,Math.min(winR*clamp(+P.winFrame,0.05,1),
                                      Math.max(aa*1.5,lipRoom)));
  const lipH=Math.max(0,+P.winLipH)*K.mm;              // how proud it stands

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

        /* ---------------- windows, BEFORE the plating ----------------

           THE PLATING STOPS AT A WINDOW. It did not: the pane was carved out
           of the finished quilt, so the plate scribe lines, the bay lines and
           the hatch rings all carried on straight across the glass and came
           out in the normal map as mullions dividing every port into panels.
           That is not what a window looks like from outside — the plating is
           cut away for the penetration and the frame is welded into the hole,
           so the whole assembly sits on a flat machined pad and no seam of the
           quilt reaches it.

           Which is why this runs first: it produces `pad`, the footprint of
           the assembly out to the far edge of its collar, and everything the
           quilt would have carved is multiplied by 1-pad. */
        let win=0,lip=0,pad=0,padSoft=0,lit=0,grime=0,paneBright=1;
        if(winBands>0){
          const vb=v*winBands,bi=Math.floor(vb);
          const uc=u*winCols,ui=Math.floor(uc);
          const dU=Math.abs((uc-ui)-0.5)/winCols;        // uv distance from the pane centre
          const dV=Math.abs((vb-bi)-0.5)/winBands;
          /* THE ROUND ONES ARE THE SAME SHAPE with its straight section taken
             out, so a circle among the slots is the same radius, the same
             reveal and the same glass rather than a second shape that happens
             to be near them */
          const rnd=hashi(ui,bi,seed+3313)<P.winRound;
          const eU=Math.max(dU-(rnd?0:strU),0),eV=Math.max(dV-(rnd?0:strV),0);
          const d=Math.sqrt(eU*eU+eV*eV)-winR;
          win=1-smoothstep(0,aa*1.6,d);
          /* the assembly's whole footprint, and the collar as the ring of it
             that is not glass */
          pad=1-smoothstep(0,aa*1.6,d-lipW);
          lip=clamp(pad-win,0,1);
          /* the pad's own LEVEL reaches further out than its carving does. A
             scribe line is cut and stops dead at the frame; the plate step it
             sits on cannot, or the machined face is a second raised ring a
             couple of texels wide all round the collar. So the seams end at
             the collar and the level fairs back into the plating outside it. */
          padSoft=1-smoothstep(0,Math.max(aa*1.6,lipW*0.9),d-lipW);
          if(pad>0.004){
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
          }
        }

        /* ---------------- height: almost nothing, on purpose ---------------- */
        /* the pad is machined flat, so the plate's own step in the surface goes
           with the scribe lines — a window straddling a seam would otherwise sit
           half on each plate with nothing but a colour change to explain it */
        const keep=1-pad,keepJ=1-padSoft;
        let h=((rSheen-0.5)*2*plateH+(brec.rnd-0.5)*2*bayH)*keepJ;
        const gs=(1-smoothstep(0,scribeW,rec.dEdge))*keep;   // plate scribe line
        const gb=(1-smoothstep(0,bayW,brec.dEdge))*keep;     // structural bay line
        h-=gs*scribeD+gb*bayD;

        /* ---------------- access hatch ---------------- */
        let ring=0,fast=0;
        const isHatch=rKind<P.hatch*0.4;
        if(isHatch){
          const inset=Math.max(Math.min(rec.w,rec.h)*0.16,fastR*1.8);
          ring=(1-smoothstep(0,scribeW,Math.abs(rec.dEdge-inset)))*keep;
          h-=ring*scribeD*0.8;
          const ddu=rec.du-inset,ddv=rec.dv-inset;       // hits all four corners at once
          const dd=Math.sqrt(ddu*ddu+ddv*ddv);
          fast=(1-smoothstep(fastR*0.7,fastR,dd))*keep;
          h+=fast*fastH;
        }

        /* the collar stands PROUD of the plating and the glass is set deep
           inside it, so the reveal is a real wall of relief and the normal map
           has something to shade rather than a scratch */
        if(pad>0.004)h+=lip*lipH-win*winD;

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

        /* and the pad is one machined face: without this a window straddling
           a plate seam has a different shade down each half of its frame, with
           the scribe line that used to explain it now gone */
        if(pad>0.004){
          const pr=hull[0]*wash,pg=hull[1]*wash,pb=hull[2]*wash;
          r=lerp(r,pr,pad);g=lerp(g,pg,pad);b=lerp(b,pb,pad);
        }

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

        if(lip>0.004){                                   // the brushed collar
          r=lerp(r,r*1.10+13,lip);g=lerp(g,g*1.10+13,lip);b=lerp(b,b*1.10+13,lip);
          rough=lerp(rough,0.30,lip*0.8);
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
      winRows:2,winPitch:2.2,winShape:"auto",winW:.7,winH:1.6,winRound:.22,winFrame:.32,winLipH:11,
      winLit:.5,winRoom:2,winGlow:.75,winDark:.5,winRough:.05,winMetal:.9,
      winGrime:.34,winGrimeW:.34,winVary:.34,
      scuff:.08,rough:.38,metalness:.18,
      cHull:"#c4c8c8",cTint:"#b3c2cc",cAccent:"#8d979d",cWin:"#ffd9a0",cGlass:"#333c47"}},
    {id:"tvera",label:"TV era — broad and warm",set:{
      tileM:16,rows:12,colsMin:3,colsMax:7,subdiv:.48,subdepth:2,bays:3,
      aztec:.42,albedoVar:.22,tintVar:.28,hotspot:.14,accent:.14,
      plateH:2.5,scribeW:38,scribeD:7,hatch:.2,
      winRows:3,winPitch:2.6,winShape:"auto",winW:2,winH:.85,winRound:.30,winFrame:.42,winLipH:20,
      winLit:.62,winRoom:3,winGlow:.9,winDark:.34,winRough:.09,winMetal:.8,
      winGrime:.5,winGrimeW:.45,winVary:.45,
      scuff:.05,rough:.46,metalness:.12,
      cHull:"#cdc9bd",cTint:"#c6bfae",cAccent:"#9a958a",cWin:"#ffcf8a",cGlass:"#43443f"}},
    {id:"nacelle",label:"Nacelle skin — no windows",set:{
      tileM:6,rows:30,colsMin:6,colsMax:14,subdiv:.7,subdepth:3,bays:5,
      aztec:.8,albedoVar:.12,tintVar:.55,hotspot:.35,accent:.06,
      plateH:.8,scribeW:10,scribeD:2.5,hatch:.08,
      winRows:0,winPitch:2.2,winShape:"auto",winW:.7,winH:1.6,winRound:.25,winFrame:.35,winLipH:14,
      winLit:.5,winRoom:2,winGlow:.8,winDark:.42,winRough:.07,winMetal:.85,
      winGrime:.45,winGrimeW:.4,winVary:.4,
      scuff:.04,rough:.3,metalness:.3,
      cHull:"#c9ced2",cTint:"#aebfd0",cAccent:"#8794a0",cWin:"#ffd9a0",cGlass:"#39424e"}},
    /* ===================== the rest of the library =====================
       Sixteen more, and they are not four sliders apart from each other: the
       TILE is the first thing each one sets, because a preset that forgets it
       is a picture rather than a piece of hull — a shuttle door and a station
       module want the same plate SIZE in metres and nothing else the same.
       Between them they cover the three window habits (bands of slots, single
       tall glass, scattered circles), the three finishes (cold specular, warm
       matte, scoured) and the plain plating a run needs between them. */
    {id:"saucer",label:"Saucer dorsal — broad and pale",set:{
      tileM:18,rows:14,colsMin:4,colsMax:9,subdiv:.55,subdepth:2,bays:3,
      aztec:.55,albedoVar:.14,tintVar:.5,hotspot:.2,accent:.09,
      plateH:2,scribeW:30,scribeD:6,hatch:.16,
      winRows:2,winPitch:3,winShape:"auto",winW:.9,winH:2.2,winRound:.2,winFrame:.34,winLipH:16,
      winLit:.55,winRoom:3,winGlow:.8,winDark:.44,winRough:.06,winMetal:.88,
      winGrime:.38,winGrimeW:.38,winVary:.38,
      scuff:.06,rough:.4,metalness:.16,
      cHull:"#ccd0cf",cTint:"#bcc8d2",cAccent:"#95a0a6",cWin:"#ffd9a0",cGlass:"#353e49"}},
    {id:"promenade",label:"Promenade — one band of tall glass",set:{
      tileM:14,rows:10,colsMin:3,colsMax:6,subdiv:.4,subdepth:1,bays:2,
      aztec:.4,albedoVar:.14,tintVar:.34,hotspot:.16,accent:.12,
      plateH:2.2,scribeW:34,scribeD:6,hatch:.1,
      winRows:1,winPitch:2.8,winShape:"auto",winW:1.6,winH:4.5,winRound:.1,winFrame:.3,winLipH:22,
      winLit:.8,winRoom:2,winGlow:.95,winDark:.3,winRough:.05,winMetal:.9,
      winGrime:.3,winGrimeW:.3,winVary:.3,
      scuff:.04,rough:.42,metalness:.14,
      cHull:"#c8ccc9",cTint:"#bbc6cc",cAccent:"#8f9aa0",cWin:"#ffe0b0",cGlass:"#2f3742"}},
    {id:"obsdeck",label:"Observation deck — full-height panes",set:{
      tileM:12,rows:8,colsMin:2,colsMax:5,subdiv:.35,subdepth:1,bays:2,
      aztec:.36,albedoVar:.12,tintVar:.3,hotspot:.14,accent:.08,
      plateH:2,scribeW:32,scribeD:6,hatch:.06,
      winRows:1,winPitch:2.2,winShape:"auto",winW:1.4,winH:6,winRound:0,winFrame:.28,winLipH:24,
      winLit:.9,winRoom:1,winGlow:1,winDark:.26,winRough:.04,winMetal:.92,
      winGrime:.26,winGrimeW:.28,winVary:.24,
      scuff:.03,rough:.38,metalness:.15,
      cHull:"#cbcec8",cTint:"#bec7c9",cAccent:"#909a9c",cWin:"#ffdfae",cGlass:"#2b333d"}},
    {id:"deck9",label:"Deck nine — twin bands, rooms of four",set:{
      tileM:16,rows:16,colsMin:4,colsMax:10,subdiv:.6,subdepth:2,bays:4,
      aztec:.6,albedoVar:.15,tintVar:.45,hotspot:.24,accent:.1,
      plateH:1.6,scribeW:24,scribeD:5,hatch:.12,
      winRows:2,winPitch:2,winShape:"auto",winW:.75,winH:2.6,winRound:.12,winFrame:.36,winLipH:15,
      winLit:.6,winRoom:4,winGlow:.85,winDark:.4,winRough:.06,winMetal:.88,
      winGrime:.4,winGrimeW:.4,winVary:.42,
      scuff:.07,rough:.4,metalness:.17,
      cHull:"#c7cbc9",cTint:"#b8c4cd",cAccent:"#8e989e",cWin:"#ffd79b",cGlass:"#333c46"}},
    {id:"shuttle",label:"Shuttlepod — small tile, one port",set:{
      tileM:3,rows:9,colsMin:2,colsMax:5,subdiv:.35,subdepth:1,bays:2,
      aztec:.5,albedoVar:.18,tintVar:.3,hotspot:.2,accent:.16,
      plateH:1,scribeW:12,scribeD:3,hatch:.3,
      winRows:1,winPitch:1.5,winShape:"auto",winW:.62,winH:.62,winRound:1,winFrame:.42,winLipH:10,
      winLit:.5,winRoom:1,winGlow:.8,winDark:.46,winRough:.06,winMetal:.86,
      winGrime:.5,winGrimeW:.45,winVary:.4,
      scuff:.14,rough:.44,metalness:.2,
      cHull:"#c2c6c4",cTint:"#b2bec6",cAccent:"#8b9499",cWin:"#ffd9a0",cGlass:"#333b45"}},
    {id:"runabout",label:"Runabout flank — fine and short",set:{
      tileM:5,rows:16,colsMin:4,colsMax:9,subdiv:.6,subdepth:2,bays:3,
      aztec:.66,albedoVar:.14,tintVar:.4,hotspot:.26,accent:.12,
      plateH:.9,scribeW:11,scribeD:3,hatch:.2,
      winRows:1,winPitch:1.2,winShape:"auto",winW:.42,winH:.9,winRound:.3,winFrame:.38,winLipH:9,
      winLit:.5,winRoom:2,winGlow:.8,winDark:.44,winRough:.06,winMetal:.88,
      winGrime:.42,winGrimeW:.4,winVary:.4,
      scuff:.1,rough:.36,metalness:.2,
      cHull:"#c5c9c8",cTint:"#b4c1cb",cAccent:"#8c969c",cWin:"#ffd9a0",cGlass:"#343d47"}},
    {id:"station",label:"Station module — huge tile, round ports",set:{
      tileM:32,rows:10,colsMin:2,colsMax:6,subdiv:.45,subdepth:2,bays:2,
      aztec:.34,albedoVar:.2,tintVar:.26,hotspot:.1,accent:.18,
      plateH:5,scribeW:70,scribeD:14,hatch:.24,
      winRows:3,winPitch:4.5,winShape:"auto",winW:1.6,winH:1.6,winRound:1,winFrame:.4,winLipH:34,
      winLit:.45,winRoom:2,winGlow:.75,winDark:.5,winRough:.08,winMetal:.82,
      winGrime:.55,winGrimeW:.5,winVary:.5,
      scuff:.2,rough:.52,metalness:.14,
      cHull:"#bfbdb4",cTint:"#b6b6ab",cAccent:"#8d8c84",cWin:"#ffcf8a",cGlass:"#383a3a"}},
    {id:"sensorband",label:"Sensor band — dense unlit circles",set:{
      tileM:8,rows:20,colsMin:5,colsMax:12,subdiv:.68,subdepth:2,bays:4,
      aztec:.7,albedoVar:.12,tintVar:.5,hotspot:.3,accent:.08,
      plateH:1.1,scribeW:14,scribeD:3.5,hatch:.1,
      winRows:2,winPitch:.9,winShape:"auto",winW:.4,winH:.4,winRound:1,winFrame:.5,winLipH:8,
      winLit:0,winRoom:1,winGlow:0,winDark:.72,winRough:.05,winMetal:.94,
      winGrime:.3,winGrimeW:.5,winVary:.3,
      scuff:.05,rough:.34,metalness:.24,
      cHull:"#c3c8cb",cTint:"#aebecd",cAccent:"#87939c",cWin:"#ffd9a0",cGlass:"#232a33"}},
    {id:"carrier",label:"Carrier flank — long lying strips",set:{
      tileM:20,rows:12,colsMin:3,colsMax:7,subdiv:.5,subdepth:2,bays:3,
      aztec:.46,albedoVar:.2,tintVar:.3,hotspot:.14,accent:.14,
      plateH:3,scribeW:44,scribeD:9,hatch:.18,
      winRows:3,winPitch:5,winShape:"auto",winW:4,winH:.8,winRound:.08,winFrame:.4,winLipH:20,
      winLit:.5,winRoom:2,winGlow:.8,winDark:.46,winRough:.08,winMetal:.84,
      winGrime:.5,winGrimeW:.45,winVary:.45,
      scuff:.12,rough:.5,metalness:.16,
      cHull:"#c0c2bd",cTint:"#b3bcc0",cAccent:"#8a9093",cWin:"#ffd196",cGlass:"#343940"}},
    {id:"hangar",label:"Hangar door — deep scribe, no glass",set:{
      tileM:24,rows:6,colsMin:2,colsMax:4,subdiv:.3,subdepth:1,bays:2,
      aztec:.4,albedoVar:.24,tintVar:.22,hotspot:.1,accent:.22,
      plateH:6,scribeW:90,scribeD:20,hatch:.3,
      winRows:0,winPitch:2.2,winShape:"auto",winW:.75,winH:1.7,winRound:.28,winFrame:.35,winLipH:14,
      winLit:.5,winRoom:2,winGlow:.8,winDark:.42,winRough:.07,winMetal:.85,
      winGrime:.45,winGrimeW:.4,winVary:.4,
      scuff:.16,rough:.56,metalness:.18,
      cHull:"#b9bcb8",cTint:"#adb6ba",cAccent:"#83898b",cWin:"#ffd9a0",cGlass:"#39424e"}},
    {id:"cargo",label:"Cargo hull — big hatches, no glass",set:{
      tileM:16,rows:9,colsMin:2,colsMax:5,subdiv:.42,subdepth:1,bays:3,
      aztec:.38,albedoVar:.26,tintVar:.24,hotspot:.08,accent:.2,
      plateH:4,scribeW:52,scribeD:12,hatch:.65,
      winRows:0,winPitch:2.2,winShape:"auto",winW:.75,winH:1.7,winRound:.28,winFrame:.35,winLipH:14,
      winLit:.5,winRoom:2,winGlow:.8,winDark:.42,winRough:.07,winMetal:.85,
      winGrime:.45,winGrimeW:.4,winVary:.4,
      scuff:.28,rough:.6,metalness:.15,
      cHull:"#b6b5ae",cTint:"#adaea6",cAccent:"#84847e",cWin:"#ffd9a0",cGlass:"#39424e"}},
    {id:"drydock",label:"Drydock spar — industrial and scuffed",set:{
      tileM:20,rows:7,colsMin:2,colsMax:4,subdiv:.3,subdepth:1,bays:2,
      aztec:.3,albedoVar:.34,tintVar:.18,hotspot:.05,accent:.26,
      plateH:5,scribeW:80,scribeD:18,hatch:.4,
      winRows:0,winPitch:2.2,winShape:"auto",winW:.75,winH:1.7,winRound:.28,winFrame:.35,winLipH:14,
      winLit:.5,winRoom:2,winGlow:.8,winDark:.42,winRough:.07,winMetal:.85,
      winGrime:.45,winGrimeW:.4,winVary:.4,
      scuff:.62,rough:.7,metalness:.22,
      cHull:"#9fa19a",cTint:"#97a09f",cAccent:"#6e716c",cWin:"#ffd9a0",cGlass:"#39424e"}},
    {id:"derelict",label:"Derelict — every pane dark",set:{
      tileM:14,rows:15,colsMin:4,colsMax:9,subdiv:.55,subdepth:2,bays:3,
      aztec:.44,albedoVar:.32,tintVar:.26,hotspot:.05,accent:.14,
      plateH:3,scribeW:30,scribeD:8,hatch:.24,
      winRows:2,winPitch:2.4,winShape:"auto",winW:.8,winH:2,winRound:.32,winFrame:.46,winLipH:22,
      winLit:0,winRoom:2,winGlow:0,winDark:.82,winRough:.3,winMetal:.4,
      winGrime:1,winGrimeW:.8,winVary:.85,
      scuff:.85,rough:.72,metalness:.16,
      cHull:"#8f918a",cTint:"#87908f",cAccent:"#63665f",cWin:"#ffc27a",cGlass:"#20242a"}},
    {id:"ablative",label:"Ablative armour — matte ceramic",set:{
      tileM:12,rows:11,colsMin:3,colsMax:6,subdiv:.4,subdepth:1,bays:3,
      aztec:.22,albedoVar:.3,tintVar:.16,hotspot:.02,accent:.1,
      plateH:4.5,scribeW:46,scribeD:11,hatch:.06,
      winRows:0,winPitch:2.2,winShape:"auto",winW:.75,winH:1.7,winRound:.28,winFrame:.35,winLipH:14,
      winLit:.5,winRoom:2,winGlow:.8,winDark:.42,winRough:.07,winMetal:.85,
      winGrime:.45,winGrimeW:.4,winVary:.4,
      scuff:.22,rough:.88,metalness:.03,
      cHull:"#b3aca1",cTint:"#a9a599",cAccent:"#7e7970",cWin:"#ffd9a0",cGlass:"#39424e"}},
    {id:"latehull",label:"Late hull — darker and tighter",set:{
      tileM:12,rows:26,colsMin:6,colsMax:13,subdiv:.7,subdepth:3,bays:5,
      aztec:.74,albedoVar:.1,tintVar:.6,hotspot:.3,accent:.06,
      plateH:.9,scribeW:12,scribeD:3,hatch:.1,
      winRows:2,winPitch:1.8,winShape:"auto",winW:.55,winH:1.4,winRound:.18,winFrame:.3,winLipH:10,
      winLit:.45,winRoom:3,winGlow:.7,winDark:.56,winRough:.05,winMetal:.9,
      winGrime:.32,winGrimeW:.36,winVary:.3,
      scuff:.06,rough:.5,metalness:.26,
      cHull:"#a7adaf",cTint:"#98a7b4",cAccent:"#767e84",cWin:"#ffd39a",cGlass:"#2a313a"}},
    {id:"tug",label:"Workbee tug — tiny tile, heavy relief",set:{
      tileM:2.5,rows:7,colsMin:2,colsMax:4,subdiv:.3,subdepth:1,bays:2,
      aztec:.5,albedoVar:.3,tintVar:.2,hotspot:.12,accent:.3,
      plateH:1.6,scribeW:16,scribeD:5,hatch:.4,
      winRows:1,winPitch:1.1,winShape:"auto",winW:.5,winH:.5,winRound:1,winFrame:.55,winLipH:12,
      winLit:.4,winRoom:1,winGlow:.7,winDark:.5,winRough:.1,winMetal:.78,
      winGrime:.7,winGrimeW:.55,winVary:.6,
      scuff:.4,rough:.62,metalness:.2,
      cHull:"#c4b98f",cTint:"#b5ae8c",cAccent:"#8b8262",cWin:"#ffcf8a",cGlass:"#33353a"}},
    {id:"scored",label:"Battle-scored",set:{
      tileM:14,rows:16,colsMin:4,colsMax:9,subdiv:.55,subdepth:2,bays:3,
      aztec:.5,albedoVar:.3,tintVar:.3,hotspot:.08,accent:.16,
      plateH:3.5,scribeW:32,scribeD:9,hatch:.28,
      winRows:2,winPitch:2.4,winShape:"auto",winW:.8,winH:1.5,winRound:.38,winFrame:.5,winLipH:26,
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
      {id:"winW",label:"Pane width",unit:"m",min:0.2,max:8,step:0.05,value:0.75},
      {id:"winH",label:"Pane height",unit:"m",min:0.2,max:12,step:0.05,value:1.7},
      {id:"winShape",type:"select",label:"Lie",value:"auto",options:[
        ["auto","However the numbers fall"],["vcap","Force upright"],
        ["hcap","Force lying"]]},
      {id:"winRound",label:"Round ones",min:0,max:1,step:0.01,value:0.28},
      {id:"winFrame",label:"Surround width",min:0.05,max:1,step:0.01,value:0.35},
      {id:"winLipH",label:"Surround relief",unit:"mm",min:0,max:60,step:1,value:14},
      {type:"checks",items:[{id:"winBlank",
        label:"Export the blank plating alongside",value:true}]},
      {type:"note",html:"<b>Width is across the hull and height is up it</b>, whichever "+
        "way the pane lies, and the shape falls out of the two: taller than wide is an "+
        "upright capsule, wider than tall is a lying one, and equal is a circle. So "+
        "<b>height</b> is the control for how tall a window is, always — it used to be "+
        "<i>along</i>, meaning along the pane's own straight section, which on a lying "+
        "capsule is the horizontal one. <b>Lie</b> only overrides, swapping the two numbers "+
        "to force a row upright or flat. <b>Round ones</b> scatters plain circles through the "+
        "rows: the same shape with the straight section taken out, so they are the same "+
        "radius and the same glass as the slots beside them.<br>"+
        "Both axes are held to their own cell — a pane bigger than its cell runs into its "+
        "neighbour and a row becomes one lit stripe. Height is capped by the <b>band</b> "+
        "spacing, so a tall window wants fewer bands; the readout says the size actually cut "+
        "and which of the two capped it.<br>"+
        "<b>The surround is a forging, not a scribe line.</b> A window in a pressure hull is "+
        "a machined penetration with a frame welded into it, so it is thick and it stands "+
        "<b>proud</b> of the plating. Width is a fraction of the pane's own radius — a big "+
        "port keeps a heavy frame and a small one a fine one — held to whatever room is left "+
        "in the cell. And the plating <b>stops</b> at it: the quilt's scribe lines, bay lines "+
        "and hatch rings are all cut away under the assembly, which sits on one flat machined "+
        "pad. They used to run straight across the glass and come out of the normal map as "+
        "mullions dividing every port into panels."}
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

  /* THE PANEL AND THE BLANK PLATING ARE ONE JOB. A hull run needs the plating
     with windows in it AND the plain plating to put between the window bands,
     off the same seed and the same quilt — and forging one, exporting, dropping
     the bands to zero, forging again and exporting again is four steps to get
     two files that differ by one parameter, every time the seed moves.

     So the archive carries both cuts. This is the whole declaration; the export
     does the rest — full-size forge, own folder, own readme, own geometry, and
     the panel put back exactly as it was. */
  variants:function(P){
    return ((P.winRows|0)>0&&P.winBlank!==false)
      ?[{id:"blank",label:"blank plating",set:{winRows:0}}]:[];
  },

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
      const cellA=T/nU,cellB=T/Math.max(1,P.winRows|0);
      let across=Math.min(+P.winW,cellA*0.90),along=Math.min(+P.winH,cellB*0.90);
      const lay=P.winShape||"auto";
      if((lay==="vcap"&&along<across)||(lay==="hcap"&&across<along)){
        const t=across;across=along;along=t;
      }
      across=Math.min(across,cellA*0.90);along=Math.min(along,cellB*0.90);
      const cutW=across<Math.min(+P.winW,+P.winH)-1e-6||across<+P.winW-1e-6&&lay==="auto";
      const cutH=along<+P.winH-1e-6&&lay==="auto";
      m+="<br>panes <b>"+across.toFixed(2)+" wide × "+along.toFixed(2)+" m tall</b> — "+
         (Math.abs(across-along)<1e-6?"circles":(along>across?"upright":"lying")+" capsules")+
         ", "+Math.round(P.winRound*100)+"% of them round";
      /* THE SURROUND THAT WILL ACTUALLY BE CAST. It is a fraction of the pane
         radius but it has to fit the room left in the cell, so a wide frame on
         a tight pitch is held back and the readout says by how much. */
      const askLip=across*0.5*Math.max(0.05,Math.min(1,+P.winFrame));
      const room=Math.min(cellA*0.48-across*0.5,cellB*0.48-along*0.5);
      const lipM=Math.min(askLip,Math.max(0,room));
      m+="<br>surround <b>"+(lipM*100).toFixed(1)+" cm</b> wide standing <b>"+
         (+P.winLipH).toFixed(0)+" mm</b> proud";
      if(lipM<askLip-1e-6)m+=" — held back from "+(askLip*100).toFixed(1)+
                             " cm by the room left in the cell";
      const lipPx=lipM*pxPerM;
      if(lipPx<2)m+="<br>surround "+lipPx.toFixed(1)+" px — too fine to read as a frame";
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
      if(cutH)m+="<br><b>height cut to "+along.toFixed(2)+" m by the band spacing</b> — "+
                 (P.winRows|0)+" bands over "+T+" m leaves "+cellB.toFixed(2)+
                 " m a band, so drop a band for a taller window";
      if(cutW)m+="<br><b>width cut to "+across.toFixed(2)+" m by the window pitch</b> — "+
                 "widen the pitch for a broader window";
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
    /* and the surround that was actually cast, held to the room in the cell */
    const cA=T/wCols,cB=T/Math.max(1,P.winRows|0);
    let acr=Math.min(+P.winW,cA*0.90),alg=Math.min(+P.winH,cB*0.90);
    const lay=P.winShape||"auto";
    if((lay==="vcap"&&alg<acr)||(lay==="hcap"&&acr<alg)){const t=acr;acr=alg;alg=t;}
    acr=Math.min(acr,cA*0.90);alg=Math.min(alg,cB*0.90);
    const lipM=Math.min(Math.min(acr,alg)*0.5*Math.max(0.05,Math.min(1,+P.winFrame)),
                        Math.max(0,Math.min(cA*0.48-acr*0.5,cB*0.48-alg*0.5)));
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
      acr.toFixed(2)+" m wide by "+alg.toFixed(2)+" m tall, so they lie "+
        (Math.abs(acr-alg)<1e-6?"round":(alg>acr?"upright":"on their side"))+
        ", with "+Math.round(P.winRound*100)+"% of them round. A circle is the same shape",
      "with its straight section taken out, so the round ones share the radius, the",
      "reveal and the glass of the slots beside them rather than being a second shape.",
      "Nothing that holds pressure has square corners, which is the whole reason.",
      "",
      "The SURROUND is a forging and not a scribe line: "+(lipM*100).toFixed(1)+" cm of collar",
      "standing "+(+P.winLipH).toFixed(0)+" mm proud of the plating, with the glass set deep inside it.",
      "The plating STOPS at it — the plate seams, the bay lines and the hatch rings are",
      "all cut away under the assembly, which sits on one flat machined pad. So the",
      "normal map has no quilt seam crossing any pane, and height16.png is worth using:",
      "the collar and the reveal take most of the range between them.",
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
