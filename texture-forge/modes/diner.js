/* =====================================================================
   MODE: diner — American chrome-and-neon diner, every face
   =====================================================================
   One prefabricated streamline diner, drawn from the front, the long side
   or the back, off the same body so the three agree: the same bands at the
   same heights, the same enamel, the same neon running round the corner.

   The vocabulary is the real one. From grade up: a glazed tile skirt, a
   band of porcelain enamel panels on chrome battens, the window band in
   plate glass with chrome mullions, another enamel band, and the eyebrow
   — the projecting cornice the neon runs along. Horizontally fluted
   stainless can take any of the solid bands; it is the signature material
   and the one that actually reads as a diner from across the street.

   Neon is emissive, and only emissive. The tube itself is pale glass in
   the base colour whether it is lit or not, exactly as it is in daylight,
   and every bit of the glow is in emissive.png with its own colour per
   band. Turn the emissive map off in your engine and you get a diner at
   noon; turn it on and you get one at midnight. Painting the glow into
   the albedo instead is the usual mistake and it can never be switched off.

   The sign is real tubing too: the word is stroked, not filled, with round
   joins, so it is a bent tube following the letter outline rather than a
   glowing solid.

   This is an elevation with an alpha cut-out, not a tiling material. The
   top corners round over the way a streamline body does.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      hashi=Forge.hashi,fbm=Forge.fbm,fbm2=Forge.fbm2,
      hex2rgb=Forge.hex2rgb,blurClamp=Forge.blurClamp;

const IN=1/12;                                     // inches, in feet

/* ---- geometry, in feet, shared by every face ---- */
function geom(P){
  const face=P.face||"front";
  const FW=Math.max(6,+((face==="side")?P.bodyL:P.bodyW)||30);
  const base=P.baseH,low=P.lowH,win=(face==="back")?P.winH:P.winH,up=P.upH,brow=P.browH;
  const FH=base+low+win+up+brow;
  const TW=P.size|0;
  const TH=Math.max(8,Math.round(TW*FH/FW/4)*4);
  const mull=FW/Math.max(1,Math.round(FW/Math.max(1.2,P.mullSp)));
  const panel=FW/Math.max(1,Math.round(FW/Math.max(1,P.panelW)));
  return {face:face,FW:FW,FH:FH,TW:TW,TH:TH,
          yBase:base,ySill:base+low,yHead:base+low+win,yUp:base+low+win+up,
          base:base,low:low,win:win,up:up,brow:brow,
          mull:mull,panel:panel,
          corner:Math.min(brow*1.3,FW*0.07)};
}

/* ---- the sign: a word stroked as tubing, plus its glow ---- */
function signMask(word,cw,ch,tubePx){
  const c=document.createElement("canvas");c.width=cw;c.height=ch;
  const g=c.getContext("2d",{willReadFrequently:true});
  g.fillStyle="#000";g.fillRect(0,0,cw,ch);
  let px=Math.round(ch*0.86);
  g.textAlign="center";g.textBaseline="middle";
  g.lineJoin="round";g.lineCap="round";
  g.strokeStyle="#f00";
  const fit=()=>{g.font="700 "+px+'px Overpass, Impact, "Arial Narrow", Haettenschweiler, sans-serif';
                 return g.measureText(word).width;};
  /* shrink until the word and its tube fit the plate with a margin */
  let w=fit(),guard=0;
  while(w+tubePx*2>cw*0.9&&px>6&&guard++<40){px=Math.round(px*0.92);w=fit();}
  g.lineWidth=tubePx;
  g.strokeText(word,cw*0.5,ch*0.52);
  const d=g.getImageData(0,0,cw,ch).data;
  const tube=new Float32Array(cw*ch);
  for(let i=0;i<cw*ch;i++)tube[i]=d[i*4]/255;
  /* the glow is the tube blurred; the halo on the backing plate is most of
     what sells neon, and a blur is cheaper and steadier than faking it with
     repeated wide strokes at low alpha */
  const glow=blurClamp(tube,cw,ch,Math.max(2,Math.round(tubePx*1.6)));
  return {w:cw,h:ch,tube:tube,glow:glow};
}

/* ============================ the generator ============================ */

function build(P,io){
  const g=geom(P),TW=io.W,TH=io.H,N=TW*TH,seed=P.seed|0;
  const FW=g.FW,FH=g.FH,ftPerPx=FW/TW,aa=ftPerPx*0.7;

  const A=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N);
  const MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N);
  const ALP=new Uint8ClampedArray(N);
  const EMC=new Uint8ClampedArray(N*3);            // neon needs a colour, not a level
  const NRM=new Uint8ClampedArray(N*3);
  const HGT=new Float32Array(N);
  let hMin=0,hMax=1;

  const body=hex2rgb(P.cBody),trimC=hex2rgb(P.cTrim),tileC=hex2rgb(P.cTile),
        steelC=hex2rgb(P.cSteel),glassC=hex2rgb(P.cGlass);
  const neon=[hex2rgb(P.cNeon1),hex2rgb(P.cNeon2),hex2rgb(P.cNeon3)];

  const flute=Math.max(P.fluteIn*IN,ftPerPx*2.2);  // below two texels a flute is just noise
  const batten=Math.max(P.battenIn*IN,aa*1.4);
  const mullW=Math.max(P.mullIn*IN,aa*1.6);
  const tubeR=Math.max(P.tubeIn*0.5*IN,aa*1.6);
  const proud=0.055;                               // how far the eyebrow stands out, feet

  /* neon runs: heights in feet, colour index, and whether this face has it */
  const runs=[];
  if(P.neonBands>=1)runs.push({y:g.yUp+g.brow*0.62,c:0});
  if(P.neonBands>=2)runs.push({y:g.yUp+g.brow*0.22,c:1});
  if(P.neonBands>=3)runs.push({y:g.ySill-0.16,c:2});

  /* the sign plate, front face only */
  let sign=null,signX0=0,signY0=0,signW=0,signH=0;
  if(g.face==="front"&&P.sign!=="none"){
    signH=g.brow*0.74;signW=Math.min(FW*0.62,signH*(1.1+P.sign.length*0.62));
    signX0=(FW-signW)*0.5;signY0=g.yUp+(g.brow-signH)*0.5;
    const cw=Math.max(32,Math.round(signW/ftPerPx)),ch=Math.max(12,Math.round(signH/ftPerPx));
    sign=signMask(P.sign,Math.min(cw,2048),Math.min(ch,512),
                  Math.max(2,Math.round(tubeR*2/ftPerPx)));
  }

  /* ---- the entrance, front face only ----
     Everything here is a real door member measured in inches: jamb, stile,
     rail, the deeper bottom rail that takes the kick, the kick plate over it,
     the pull and the threshold. A leaf is a frame with glass in the hole, so
     the leaf edges are worked out once here and the loop only has to ask which
     leaf it is in. */
  const entry=(g.face==="front")?(P.entryType||"single"):"none";
  const hasEntry=entry!=="none";
  const doorW=Math.min(P.doorW,FW*0.92);
  const doorX=(FW-doorW)*clamp(P.doorPos,0.05,0.95);
  const doorTop=Math.min(P.doorH,g.yHead-2.2*IN);
  const jambW=Math.max(P.jambIn*IN,aa*2);
  const stileW=Math.max(P.stileIn*IN,aa*2);
  const railW=stileW;
  const botRail=Math.max(P.kickIn*IN*1.05,stileW*1.6);
  const midRail=stileW*1.3;
  const kickH=Math.max(P.kickIn*IN,aa*2);
  const sillH=Math.max(1.6*IN,aa*2);
  const pullR=Math.max(P.pullIn*0.5*IN,aa*1.4);
  const beadW=Math.max(0.55*IN,aa*1.6);           // the pane's dark edge
  const revealW=Math.max(0.7*IN,aa*2);            // leaf set back behind the jamb
  /* how much light each member takes. One flat chrome for all of them is a
     white rectangle; these are what make it read as parts. */
  const T_JAMB=0.80,T_FRAME=1.0,T_BEAD=0.46,T_KICK=0.76,T_PULL=1.18,T_THR=0.70;
  /* a transom only exists when there is room for its rail, its cap and some
     glass between them; squeezed into three inches it is just a second line */
  const hasTransom=P.transom&&(g.yHead-doorTop)>(railW+jambW+0.28);
  const halfGlass=P.doorGlazing==="half";
  /* lead tells the loop which stile the pull hangs on: a pair meets in the
     middle and takes its pulls there, a single one is handed */
  const leaves=[];
  if(hasEntry){
    const in0=doorX+jambW,in1=doorX+doorW-jambW;
    if(entry==="double"){
      const mid=(in0+in1)*0.5,gap=stileW*0.16;
      leaves.push({x0:in0,x1:mid-gap,lead:1});
      leaves.push({x0:mid+gap,x1:in1,lead:0});
    }else if(entry==="sidelight"){
      const lw=Math.min((in1-in0)*0.52,3.4),c=(in0+in1)*0.5;
      leaves.push({x0:c-lw*0.5,x1:c+lw*0.5,lead:P.doorHand==="left"?0:1});
    }else{
      leaves.push({x0:in0,x1:in1,lead:P.doorHand==="left"?0:1});
    }
  }

  /* ---- material writers into a scratchpad ---- */
  let Mr=0,Mg=0,Mb=0,Mh=0,Mrg=0.4,Mmet=0;
  function enamel(wx,wy,col){
    /* pressed porcelain panels dish very slightly between their battens, and
       that is what gives a diner its soft wobbly reflections. One dish per
       panel — crossing two sines instead puts a pair of specular dots in the
       middle of every panel, which reads as a defect, not as pressed steel. */
    const f=wx/g.panel-Math.floor(wx/g.panel);
    const bow=-Math.sin(f*Math.PI)*P.bowIn*IN;
    const nb=1-smoothstep(batten*0.5-aa,batten*0.5,
              Math.abs(wx/g.panel-Math.round(wx/g.panel))*g.panel);
    Mr=col[0];Mg=col[1];Mb=col[2];Mh=bow;Mrg=0.14;Mmet=0.04;
    if(nb>0){Mr=lerp(Mr,trimC[0],nb);Mg=lerp(Mg,trimC[1],nb);Mb=lerp(Mb,trimC[2],nb);
      Mh=lerp(Mh,0.018,nb);Mrg=lerp(Mrg,0.07,nb);Mmet=lerp(Mmet,1,nb);}
  }
  function stainless(wx,wy,fluted){
    const t=0.92+fbm2(wx*0.5,wy*9,40,90,3,seed+19)*0.18;   // brushed, along the length
    Mr=steelC[0]*t;Mg=steelC[1]*t;Mb=steelC[2]*t;Mrg=0.18;Mmet=1;Mh=0;
    if(fluted){
      const f=wy/flute,ff=f-Math.floor(f);
      const s=Math.sin(ff*Math.PI);
      Mh=s*flute*0.34;
      /* the flute's own shading: the top of each rib takes the light, the
         valley between them stays dark whichever way the light comes from */
      const sh=0.66+s*0.62;
      Mr*=sh;Mg*=sh;Mb*=sh;
      Mrg=0.12+ (1-s)*0.10;
    }
  }
  /* Plate glass and whatever is behind it, shared by the shopfront and by the
     lights in the door — a door pane has to match the window beside it, and it
     did not when the two were written out separately. */
  let Gr=0,Gg=0,Gb=0,Grg=0,Gmet=0,Gh=0;
  function glazing(wx,wy,dim){
    const up=clamp((wy-g.ySill)/Math.max(0.1,g.win),0,1);
    const refl=0.30+up*0.55;
    Gr=lerp(glassC[0],glassC[0]*1.9+40,refl*0.5);
    Gg=lerp(glassC[1],glassC[1]*1.9+44,refl*0.5);
    Gb=lerp(glassC[2],glassC[2]*1.9+52,refl*0.5);
    Grg=0.07;Gmet=0.85;Gh=-0.05;
    if(P.interior>0){
      const bandY=g.ySill+g.win*0.34;
      const cnt=1-smoothstep(0,0.16,Math.abs(wy-bandY));
      const st=1-smoothstep(0.30,0.42,Math.abs(wx/1.9-Math.round(wx/1.9))*1.9);
      const k=clamp((cnt*0.8+st*cnt*0.5),0,1)*P.interior;
      Gr=lerp(Gr,196,k*0.55);Gg=lerp(Gg,168,k*0.55);Gb=lerp(Gb,132,k*0.5);
      const room=clamp((1-up)*0.7,0,1)*P.interior;
      Gr=lerp(Gr,44,room*0.35);Gg=lerp(Gg,40,room*0.35);Gb=lerp(Gb,36,room*0.35);
    }
    /* a pane set back behind a door frame catches a little less sky */
    if(dim>0){Gr*=1-dim*1.6;Gg*=1-dim*1.6;Gb*=1-dim*1.5;}
  }
  function chrome(){
    Mr=Math.min(255,steelC[0]*1.22+20);Mg=Math.min(255,steelC[1]*1.22+20);
    Mb=Math.min(255,steelC[2]*1.22+22);Mrg=0.06;Mmet=1;Mh=0.016;
  }
  function tile(wx,wy){
    const sz=P.tileIn*IN,jw=Math.max(0.18*IN,aa);
    const cx=Math.floor(wx/sz),cy=Math.floor(wy/sz);
    const fx=wx/sz-cx,fy=wy/sz-cy;
    const dj=Math.min(Math.min(fx,1-fx),Math.min(fy,1-fy))*sz;
    const face=smoothstep(jw*0.5-aa,jw*0.5+aa*0.5,dj);
    const t=0.90+hashi(cx,cy,seed+23)*0.20;
    Mr=tileC[0]*t;Mg=tileC[1]*t;Mb=tileC[2]*t;
    Mrg=0.10;Mmet=0.02;Mh=-(1-face)*0.012;
    const mo=1-face;
    Mr=lerp(Mr,196,mo*0.8);Mg=lerp(Mg,192,mo*0.8);Mb=lerp(Mb,184,mo*0.8);
    Mrg=lerp(Mrg,0.85,mo);
  }

  const bandRows=Math.max(2,Math.round(16384/TW));
  let y=0;

  function pass1(){
    const end=Math.min(TH,y+bandRows);
    for(;y<end;y++){
      const wy=(1-(y+0.5)/TH)*FH;
      for(let x=0;x<TW;x++){
        const wx=(x+0.5)/TW*FW,i=y*TW+x;

        /* ---------------- silhouette: streamline corners ---------------- */
        let alpha=1;
        const R=g.corner,dxE=Math.min(wx,FW-wx),dyE=FH-wy;
        if(dxE<R&&dyE<R){
          const dd=Math.hypot(R-dxE,R-dyE);
          alpha=1-smoothstep(R-ftPerPx*1.2,R,dd);
        }
        if(alpha<=0.004){
          ALP[i]=0;HGT[i]=0;RGH[i]=200;AOc[i]=255;
          A[i*3]=A[i*3+1]=A[i*3+2]=0;EMC[i*3]=EMC[i*3+1]=EMC[i*3+2]=0;
          continue;
        }

        let r,gg,b,h,rg,met=0;
        let er=0,eg=0,eb=0;

        /* ---------------- the horizontal bands ---------------- */
        if(wy<g.yBase){
          if(P.baseMat==="tile")tile(wx,wy);else stainless(wx,wy,P.baseMat==="fluted");
        }else if(wy<g.ySill){
          if(P.lowMat==="enamel")enamel(wx,wy,body);else stainless(wx,wy,P.lowMat==="fluted");
        }else if(wy<g.yHead){
          if(P.upMat==="enamel")enamel(wx,wy,body);else stainless(wx,wy,P.upMat==="fluted");
        }else if(wy<g.yUp){
          if(P.upMat==="enamel")enamel(wx,wy,body);else stainless(wx,wy,P.upMat==="fluted");
        }else{
          stainless(wx,wy,P.browMat==="fluted");
          if(P.browMat==="enamel")enamel(wx,wy,trimC);
        }
        r=Mr;gg=Mg;b=Mb;h=Mh;rg=Mrg;met=Mmet;

        /* the eyebrow stands proud of the body, and its underside shades */
        if(wy>=g.yUp){
          h+=proud;
          const und=1-smoothstep(0,0.10,wy-g.yUp);
          r*=1-und*0.30;gg*=1-und*0.30;b*=1-und*0.30;
        }

        /* ---------------- the window band ---------------- */
        /* the entrance bay is cut out of it: the shopfront glazing stops at the
           jamb rather than running behind the door */
        const inBay=hasEntry&&wx>doorX&&wx<doorX+doorW&&wy<g.yHead;
        const hasGlass=(g.face!=="back")&&wy>g.ySill&&wy<g.yHead&&!inBay;
        if(hasGlass){
          const sp=g.mull;
          const dM=Math.abs(wx/sp-Math.round(wx/sp))*sp;
          const onMull=1-smoothstep(mullW*0.5-aa,mullW*0.5,dM);
          const dRail=Math.min(wy-g.ySill,g.yHead-wy);
          const onRail=1-smoothstep(P.railIn*IN-aa,P.railIn*IN,dRail);
          const steel=clamp(Math.max(onMull,onRail),0,1);
          if(steel>0.02){
            chrome();
            r=lerp(r,Mr,steel);gg=lerp(gg,Mg,steel);b=lerp(b,Mb,steel);
            rg=lerp(rg,Mrg,steel);met=lerp(met,1,steel);h=lerp(h,0.02,steel);
          }else{
            /* plate glass. Metallic on purpose, the same cheat the house mode
               documents: on an opaque plane a metallic pane picks up the
               environment and reads as glass. */
            glazing(wx,wy,0);
            r=Gr;gg=Gg;b=Gb;rg=Grg;met=Gmet;h=Gh;
            if(P.boarded>0){                              // shut up for the season
              const bd=hashi(Math.floor(wx/sp),0,seed+29);
              if(bd<P.boarded){
                const pl=Math.abs(wy/0.85-Math.round(wy/0.85))*0.85;
                const pe=1-smoothstep(0.02,0.03,pl);
                const t2=0.72+fbm2(wx*3,wy*3,64,64,3,seed+31)*0.4;
                r=138*t2;gg=118*t2;b=94*t2;rg=0.9;met=0;h=-0.01-pe*0.006;
              }
            }
          }
        }

        /* ---------------- the entrance ----------------
           A door starts at the PAVEMENT, not at the window sill. Drawing it
           inside the glazing band was the whole reason the old one read as a
           rectangle on the window: it began three feet up in the air, had no
           bottom rail, no kick and no threshold, and its head was wherever the
           glass happened to stop. This runs floor to head straight through the
           tile skirt and the enamel band, the way an opening does.

           A leaf is a FRAME — two stiles, a top rail, a deeper bottom rail that
           takes the kick — with glass in the hole, set into a jamb heavier than
           any mullion beside it.

           Every member is the same polished metal, so what tells them apart is
           how much light each one takes and the reveal shadow between them. A
           door drawn in one flat chrome is a white rectangle, which is what the
           old one was; the tones below are what make it read as parts. */
        if(inBay){
          const dJamb=Math.min(wx-doorX,doorX+doorW-wx);
          const jambM=1-smoothstep(jambW-aa,jambW,dJamb);
          /* the leaf hangs BEHIND the jamb, and the shadow in that reveal is
             most of what says so */
          const reveal=(1-smoothstep(aa,revealW,dJamb-jambW))*(1-jambM);
          let bead=0;

          if(wy>=doorTop){                                /* over the head */
            const headM=1-smoothstep(railW-aa,railW,wy-doorTop);
            const capM=1-smoothstep(jambW-aa,jambW,g.yHead-wy);
            if(hasTransom){glazing(wx,wy,0.14);r=Gr;gg=Gg;b=Gb;rg=Grg;met=Gmet;h=Gh;
              bead=Math.max(1-smoothstep(beadW-aa,beadW,wy-doorTop-railW),
                            1-smoothstep(beadW-aa,beadW,g.yHead-wy-jambW));
            }else{stainless(wx,wy,false);r=Mr*0.90;gg=Mg*0.90;b=Mb*0.90;rg=0.20;met=1;h=0.012;}
            chrome();
            const m=Math.max(headM,capM);
            if(m>0.01){r=lerp(r,Mr*T_FRAME,m);gg=lerp(gg,Mg*T_FRAME,m);b=lerp(b,Mb*T_FRAME,m);
              rg=lerp(rg,0.07,m);met=lerp(met,1,m);h=lerp(h,0.030,m);}
          }else{
            let leaf=-1;
            for(let L=0;L<leaves.length;L++)
              if(wx>=leaves[L].x0&&wx<=leaves[L].x1){leaf=L;break;}

            if(leaf<0){
              /* a sidelight, or the reveal where two leaves meet */
              glazing(wx,wy,0.08);r=Gr;gg=Gg;b=Gb;rg=Grg;met=Gmet;h=Gh;
              let closer=0;
              for(let L=0;L<leaves.length;L++){
                const d=Math.min(Math.abs(wx-leaves[L].x0),Math.abs(wx-leaves[L].x1));
                closer=Math.max(closer,1-smoothstep(stileW*0.5-aa,stileW*0.5,d));
              }
              if(closer>0.01){
                chrome();
                r=lerp(r,Mr*T_FRAME,closer);gg=lerp(gg,Mg*T_FRAME,closer);
                b=lerp(b,Mb*T_FRAME,closer);
                rg=lerp(rg,0.07,closer);met=lerp(met,1,closer);h=lerp(h,0.028,closer);
              }
            }else{
              const lf=leaves[leaf];
              const dStile=Math.min(wx-lf.x0,lf.x1-wx);
              const dTop=doorTop-wy,dBot=wy;
              const midY=botRail+(doorTop-railW-botRail)*0.42;
              const solid=halfGlass&&wy<midY;

              /* the hole first, then the frame round it */
              if(solid){stainless(wx,wy,false);r=Mr*0.94;gg=Mg*0.94;b=Mb*0.93;rg=0.24;met=1;h=0.004;}
              else{glazing(wx,wy,0.05);r=Gr;gg=Gg;b=Gb;rg=Grg;met=Gmet;h=Gh;}

              let frameM=1-smoothstep(stileW-aa,stileW,dStile);
              frameM=Math.max(frameM,1-smoothstep(railW-aa,railW,dTop));
              frameM=Math.max(frameM,1-smoothstep(botRail-aa,botRail,dBot));
              if(halfGlass)frameM=Math.max(frameM,
                1-smoothstep(midRail*0.5-aa,midRail*0.5,Math.abs(wy-midY)));

              /* the glazing bead: the thin dark line where the frame catches
                 the edge of the pane. Cheap, and it is what stops the frame and
                 the glass reading as one flat shape. */
              if(!solid){
                bead=Math.max(bead,1-smoothstep(beadW-aa,beadW,dStile-stileW));
                bead=Math.max(bead,1-smoothstep(beadW-aa,beadW,dTop-railW));
                bead=Math.max(bead,1-smoothstep(beadW-aa,beadW,dBot-botRail));
                bead*=(1-frameM);
              }

              if(frameM>0.01){
                chrome();
                r=lerp(r,Mr*T_FRAME,frameM);gg=lerp(gg,Mg*T_FRAME,frameM);
                b=lerp(b,Mb*T_FRAME,frameM);
                rg=lerp(rg,0.07,frameM);met=lerp(met,1,frameM);h=lerp(h,0.028,frameM);
              }

              /* the kick plate: a separate sheet screwed over the bottom rail.
                 Brushed rather than polished, so it sits DULLER than the frame
                 it is fixed to, and scuffed where feet land. */
              const kick=(1-smoothstep(kickH-aa,kickH,dBot))*smoothstep(0,aa*2,dStile);
              if(kick>0.01){
                stainless(wx,wy,false);
                const scuff=clamp(fbm2(wx*7,wy*22,64,96,3,seed+53)*1.5-0.42,0,1);
                const t2=T_KICK*(1.06-scuff*0.30);
                r=lerp(r,Mr*t2,kick);gg=lerp(gg,Mg*t2,kick);b=lerp(b,Mb*t2,kick);
                rg=lerp(rg,0.16+scuff*0.52,kick);met=lerp(met,1,kick);
                h=lerp(h,0.034,kick);
                /* the screwed edge of the plate reads as a line, not a fade */
                const lip=1-smoothstep(aa,aa*3,Math.abs(dBot-kickH));
                if(lip>0){r*=1-lip*0.46;gg*=1-lip*0.46;b*=1-lip*0.44;h-=lip*0.004;}
              }

              /* the pull. Tubular and vertical is the diner one; a push bar is
                 the horizontal crash bar; a loop is the short D-handle. All
                 three are round stock held OFF the leaf on standoffs, so the
                 shadow under the tube is drawn before the tube itself — that
                 shadow is what makes it read in the colour map and not only in
                 the normal. */
              const px=lf.lead?lf.x1-stileW*0.52:lf.x0+stileW*0.52;
              let pd=9,pSpan=-1;
              if(P.doorPull==="push"){
                pd=Math.abs(wy-doorTop*0.44);
                pSpan=Math.min(wx-lf.x0,lf.x1-wx)-stileW*0.30;
              }else{
                const y0=doorTop*(P.doorPull==="loop"?0.40:0.26);
                const y1=doorTop*(P.doorPull==="loop"?0.56:0.72);
                pd=Math.abs(wx-px);
                pSpan=Math.min(wy-y0,y1-wy);
              }
              if(pd<pullR*2.1&&pSpan>-pullR){
                const end=smoothstep(0,pullR*0.7,pSpan);
                const shade=(1-smoothstep(pullR*1.15,pullR*2.05,pd))*end;
                if(shade>0.004){r*=1-shade*0.42;gg*=1-shade*0.42;b*=1-shade*0.40;}
                const t=pd/pullR;
                const round=Math.sqrt(Math.max(0,1-t*t));
                const m=(1-smoothstep(pullR*0.85,pullR,pd))*end;
                if(m>0.004){
                  chrome();
                  const lit=T_PULL*(0.72+round*0.56);
                  r=lerp(r,Math.min(255,Mr*lit),m);gg=lerp(gg,Math.min(255,Mg*lit),m);
                  b=lerp(b,Math.min(255,Mb*lit),m);
                  rg=lerp(rg,0.05,m);met=lerp(met,1,m);
                  const stand=1-smoothstep(pullR*1.2,pullR*2.6,pSpan);
                  h=lerp(h,0.062+round*pullR*1.2+stand*0.014,m);
                }
              }
            }
          }

          if(bead>0.01){                                  /* the pane's dark edge */
            r*=1-bead*(1-T_BEAD);gg*=1-bead*(1-T_BEAD);b*=1-bead*(1-T_BEAD);
            rg=lerp(rg,0.35,bead*0.6);h-=bead*0.006;
          }
          if(reveal>0.01){                                /* the shadow in the reveal */
            r*=1-reveal*0.46;gg*=1-reveal*0.46;b*=1-reveal*0.44;
            h-=reveal*0.010;
          }
          if(jambM>0.01){                                 /* the jamb, proudest of all */
            chrome();
            r=lerp(r,Mr*T_JAMB,jambM);gg=lerp(gg,Mg*T_JAMB,jambM);b=lerp(b,Mb*T_JAMB,jambM);
            rg=lerp(rg,0.11,jambM);met=lerp(met,1,jambM);h=lerp(h,0.052,jambM);
          }
          /* the threshold: the opening reads as a way IN rather than a panel
             because the floor plate catches the light along the bottom of it */
          const thr=1-smoothstep(sillH-aa,sillH,wy);
          if(thr>0.02){
            stainless(wx,wy,false);
            const wear=clamp(fbm2(wx*9,wy*30,96,128,2,seed+59)*1.6-0.5,0,1);
            const t3=T_THR*(1.04-wear*0.34);
            r=lerp(r,Mr*t3,thr);gg=lerp(gg,Mg*t3,thr);b=lerp(b,Mb*t3,thr);
            rg=lerp(rg,0.24+wear*0.5,thr);met=lerp(met,1,thr);h=lerp(h,0.040,thr);
          }
        }

        /* ---------------- back-of-house furniture ---------------- */
        if(g.face==="back"){
          const dx=Math.abs(wx-FW*P.ductPos);
          if(P.duct&&dx<P.ductW*0.5&&wy>g.yBase*0.4){
            const t=dx/(P.ductW*0.5);
            stainless(wx,wy,false);
            const round=Math.sqrt(Math.max(0,1-t*t));
            r=Mr*(0.72+round*0.42);gg=Mg*(0.72+round*0.42);b=Mb*(0.72+round*0.4);
            rg=0.34;met=1;h=0.10+round*0.10;
            const seam=1-smoothstep(0.03,0.05,Math.abs(wy/3-Math.round(wy/3))*3);
            if(seam>0){h+=seam*0.012;r*=1-seam*0.18;gg*=1-seam*0.18;b*=1-seam*0.18;}
            const grease=clamp(fbm2(wx*4,wy*1.2,48,24,3,seed+37)*1.5-0.5,0,1)*P.grime;
            r=lerp(r,52,grease*0.8);gg=lerp(gg,46,grease*0.8);b=lerp(b,40,grease*0.75);
            rg=lerp(rg,0.94,grease);met=lerp(met,0.1,grease);
          }
          /* ---- the service door ----
             A steel slab in a pressed frame: hinge stile with three butts on
             it, a lever on the leading edge, an optional vision lite, and a
             kick plate. A pair gets a meeting stile down the middle and a lever
             on each leaf, which is what a kitchen with a trolley actually has. */
          const bdT=P.backDoorType||"none";
          const bdLeaves=bdT==="double"?2:1;
          const bdW=3.1*bdLeaves,bdH=6.9;
          const sdx=wx-(FW*P.doorPos-bdW*0.5),sdy=wy-g.yBase*0.1;
          if(bdT!=="none"&&sdx>-0.5&&sdx<bdW+0.5&&sdy>-0.5&&sdy<8.2){
            if(sdx>0&&sdx<bdW&&sdy>0&&sdy<bdH){
              const lw=bdW/bdLeaves;
              const li=Math.min(bdLeaves-1,Math.floor(sdx/lw));
              const lx0=li*lw,ux=sdx-lx0;                 // across this leaf
              /* leaf 0 hangs on the left, leaf 1 on the right, so a pair opens
                 outward from the middle */
              const hingeLeft=(li===0);
              const dF=Math.min(Math.min(ux,lw-ux),Math.min(sdy,bdH-sdy));
              const fr=1-smoothstep(0.10,0.13,dF);        // pressed edge of the slab
              const t=0.86+fbm2(wx*6,wy*6,64,64,2,seed+41)*0.28;
              r=steelC[0]*0.62*t;gg=steelC[1]*0.62*t;b=steelC[2]*0.6*t;
              rg=0.55;met=0.7;h=-0.03+fr*0.06;

              if(P.backLite){                             // vision lite, head height
                const gx=ux-lw*0.5,gy=sdy-5.15;
                const gw=Math.min(lw*0.34,0.62),gh=0.82;
                const dg=Math.max(Math.abs(gx)-gw*0.5,Math.abs(gy)-gh*0.5);
                if(dg<0.10){
                  const bez=1-smoothstep(0.02,0.05,dg);
                  if(dg<0){
                    glazing(wx,wy,0.30);
                    r=Gr*0.72;gg=Gg*0.72;b=Gb*0.7;rg=0.10;met=0.8;h=-0.05;
                  }
                  if(bez>0&&dg>=-0.03){                   // the pressed bezel round it
                    chrome();
                    r=lerp(r,Mr*0.8,bez);gg=lerp(gg,Mg*0.8,bez);b=lerp(b,Mb*0.8,bez);
                    rg=lerp(rg,0.3,bez);met=lerp(met,1,bez);h=lerp(h,0.03,bez);
                  }
                }
              }

              const kick=1-smoothstep(1.30,1.34,sdy);     // kick plate, scuffed bright
              if(kick>0){r=lerp(r,r*1.35+18,kick);gg=lerp(gg,gg*1.35+18,kick);
                b=lerp(b,b*1.32+18,kick);rg=lerp(rg,0.30,kick);met=lerp(met,1,kick);
                h+=kick*0.012;}

              /* three butt hinges down the hanging stile */
              const hx=hingeLeft?ux:lw-ux;
              const hStile=1-smoothstep(0.18,0.22,hx);
              h+=hStile*0.006;
              if(hx<0.16){
                for(let k=0;k<3;k++){
                  const hy=Math.abs(sdy-(0.85+k*2.55));
                  if(hy<0.30){
                    const m=(1-smoothstep(0.26,0.30,hy))*(1-smoothstep(0.13,0.16,hx));
                    chrome();
                    r=lerp(r,Mr*0.74,m);gg=lerp(gg,Mg*0.74,m);b=lerp(b,Mb*0.74,m);
                    rg=lerp(rg,0.34,m);met=lerp(met,1,m);h=lerp(h,0.026,m);
                  }
                }
              }

              /* the lever, on the leading edge at handle height */
              const px=hingeLeft?lw-0.34:0.34;
              const dlx=ux-px,dly=sdy-3.05;
              const rose=Math.sqrt(dlx*dlx+dly*dly);
              if(rose<0.42){
                const back=1-smoothstep(0.13,0.16,rose);  // the rose plate
                const armX=hingeLeft?(dlx>-0.02?dlx:9):(dlx<0.02?-dlx:9);
                const arm=(armX<0.34)
                  ?(1-smoothstep(0.036,0.05,Math.abs(dly)))*(1-smoothstep(0.30,0.34,armX)):0;
                const m=Math.max(back,arm);
                if(m>0.01){
                  chrome();
                  r=lerp(r,Mr,m);gg=lerp(gg,Mg,m);b=lerp(b,Mb,m);
                  rg=lerp(rg,0.08,m);met=lerp(met,1,m);
                  h=lerp(h,0.035+arm*0.026,m);
                }
              }

              if(bdLeaves===2){                           // the stile the pair meets on
                const meet=1-smoothstep(0.05,0.08,Math.abs(sdx-bdW*0.5));
                if(meet>0){h-=meet*0.02;r*=1-meet*0.35;gg*=1-meet*0.35;b*=1-meet*0.35;}
              }

              const rust=clamp(fbm2(wx*8,wy*3,64,32,3,seed+43)*1.6-0.7,0,1)*P.grime;
              r=lerp(r,126,rust);gg=lerp(gg,72,rust);b=lerp(b,44,rust);
              rg=lerp(rg,0.95,rust);met=lerp(met,0.1,rust);
            }else{
              const dJ=Math.min(Math.min(sdx+0.5,bdW+0.5-sdx),Math.min(sdy+0.5,bdH+0.5-sdy));
              if(dJ>0&&sdy<bdH+0.5){                      // pressed steel frame round it
                chrome();
                r=Mr*0.72;gg=Mg*0.72;b=Mb*0.72;rg=0.42;met=0.85;h=0.03;
              }
            }
            /* the bulkhead light over every back door, on the same switch as
               the neon so one slider takes the whole building to night */
            const lx=sdx-bdW*0.5,lyy=sdy-(bdH+0.7);
            const dl=Math.sqrt(lx*lx+lyy*lyy*1.7);
            if(dl<0.42){
              const t2=1-smoothstep(0.30,0.40,dl);
              const cage=1-smoothstep(0.02,0.035,Math.abs(lx/0.11-Math.round(lx/0.11))*0.11);
              r=lerp(r,232-cage*150,t2);gg=lerp(gg,224-cage*146,t2);b=lerp(b,196-cage*130,t2);
              rg=lerp(rg,0.3,t2);met=lerp(met,0.2,t2);
              h=lerp(h,proud*0.6+(1-dl/0.42)*0.09,t2);
              const e=t2*(1-cage*0.7)*P.neonOn*1.15+Math.exp(-dl/0.30)*0.30*P.neonOn;
              er+=255*e;eg+=214*e;eb+=150*e;
            }
          }
        }

        /* ---------------- neon ---------------- */
        for(let k=0;k<runs.length&&!(g.face==="back"&&!P.neonBack);k++){
          const run=runs[k],d=Math.abs(wy-run.y);
          if(d>tubeR*7)continue;
          const col=neon[run.c];
          const t=1-smoothstep(tubeR-aa,tubeR,d);
          if(t>0.004){
            /* the tube in daylight: pale phosphor-coated glass, not a colour */
            const dome=Math.sqrt(Math.max(0,1-(d/tubeR)*(d/tubeR)));
            h=lerp(h,proud+0.04+dome*tubeR*0.9,t);
            const pale=0.55+dome*0.4;
            r=lerp(r,lerp(214,col[0],0.30)*pale,t);
            gg=lerp(gg,lerp(212,col[1],0.30)*pale,t);
            b=lerp(b,lerp(208,col[2],0.30)*pale,t);
            rg=lerp(rg,0.08,t);met=lerp(met,0.1,t);
          }
          /* everything else the tube does is emissive: the core, and the halo
             it throws on the backing panel */
          const halo=Math.exp(-d/(tubeR*2.6));
          const e=(t*1.0+halo*0.42)*P.neonOn;
          er+=col[0]*e;eg+=col[1]*e;eb+=col[2]*e;
        }

        /* ---------------- the sign ---------------- */
        if(sign&&wx>signX0-0.4&&wx<signX0+signW+0.4&&wy>signY0-0.4&&wy<signY0+signH+0.4){
          const fx=(wx-signX0)/signW,fy=1-(wy-signY0)/signH;
          if(fx>=0&&fx<1&&fy>=0&&fy<1){
            const sxp=Math.min(sign.w-1,Math.floor(fx*sign.w));
            const syp=Math.min(sign.h-1,Math.floor(fy*sign.h));
            const si=syp*sign.w+sxp;
            const tube=sign.tube[si],halo=sign.glow[si];
            const col=neon[clamp(P.signColour|0,0,2)];
            if(tube>0.02){
              const pale=0.62+tube*0.35;
              r=lerp(r,lerp(216,col[0],0.30)*pale,tube);
              gg=lerp(gg,lerp(214,col[1],0.30)*pale,tube);
              b=lerp(b,lerp(210,col[2],0.30)*pale,tube);
              rg=lerp(rg,0.08,tube);met=lerp(met,0.1,tube);
              h=lerp(h,h+0.05,tube);
            }
            const e=(tube*1.0+halo*1.5)*P.neonOn;
            er+=col[0]*e;eg+=col[1]*e;eb+=col[2]*e;
          }
        }

        /* ---------------- age ---------------- */
        if(P.grime>0){
          const gr=clamp(fbm2(wx*1.1,wy*2.2,24,48,3,seed+47)*1.3-0.42,0,1)*P.grime;
          const low=smoothstep(g.yBase+0.9,0,wy)*0.5+smoothstep(g.yUp+0.2,g.yUp-0.9,wy)*0.35;
          const a2=clamp(gr*0.7+gr*low,0,1);
          r=lerp(r,r*0.58+8,a2);gg=lerp(gg,gg*0.58+8,a2);b=lerp(b,b*0.57+8,a2);
          rg=clamp(rg+a2*0.42,0,1);met*=1-a2*0.5;
        }
        if(P.fade>0){
          const f=P.fade*(0.4+fbm(wx/FW,wy/FH,4,3,seed+53)*0.8);
          r=lerp(r,r*0.80+44,f*0.45);gg=lerp(gg,gg*0.80+44,f*0.45);b=lerp(b,b*0.80+42,f*0.45);
          rg=clamp(rg+f*0.18,0,1);
        }

        ALP[i]=clamp(alpha,0,1)*255;
        A[i*3]=r;A[i*3+1]=gg;A[i*3+2]=b;
        HGT[i]=h;
        RGH[i]=clamp(rg,0.03,1)*255;
        MET[i]=clamp(met,0,1)*255;
        EMC[i*3]=er;EMC[i*3+1]=eg;EMC[i*3+2]=eb;
        AOc[i]=255;
      }
    }
    if(y<TH){io.progress(y/TH*0.7);setTimeout(pass1,0);}
    else{io.progress(0.75);setTimeout(pass2,0);}
  }

  function pass2(){
    const r1=Math.max(1,Math.round(TW*0.004)),r2=Math.max(3,Math.round(TW*0.018));
    const b1=blurClamp(HGT,TW,TH,r1),b2=blurClamp(HGT,TW,TH,r2);
    for(let i=0;i<N;i++){
      if(!ALP[i]){AOc[i]=255;continue;}
      const c1=clamp((b1[i]-HGT[i])*26,0,1);
      const c2=clamp((b2[i]-HGT[i])*17,0,1);
      AOc[i]=clamp(1-clamp(c1*0.7+c2*0.75,0,1)*P.aoStr,0,1)*255;
    }
    io.progress(0.9);

    hMin=Infinity;hMax=-Infinity;
    for(let i=0;i<N;i++){if(!ALP[i])continue;const h=HGT[i];if(h<hMin)hMin=h;if(h>hMax)hMax=h;}
    if(!isFinite(hMin)){hMin=0;hMax=1;}
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;

    const gy=P.flipG?-1:1;
    for(let yy=0;yy<TH;yy++){
      const yp=Math.min(TH-1,yy+1)*TW,ym=Math.max(0,yy-1)*TW,y0=yy*TW;
      for(let xx=0;xx<TW;xx++){
        const xp=Math.min(TW-1,xx+1),xm=Math.max(0,xx-1);
        const dhdu=(HGT[y0+xp]-HGT[y0+xm])*0.5*TW*P.normalStr;
        const dhdv=(HGT[yp+xx]-HGT[ym+xx])*0.5*TW*P.normalStr;
        let nx=-dhdu,ny=-dhdv*gy;
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;
        const j=(y0+xx)*3;
        NRM[j]=(nx*0.5+0.5)*255;NRM[j+1]=(ny*0.5+0.5)*255;NRM[j+2]=(inv*0.5+0.5)*255;
      }
    }
    io.progress(1);
    io.done({A:A,RGH:RGH,MET:MET,AO:AOc,NRM:NRM,HGT:HGT,ALP:ALP,EMC:EMC,
             hMin:hMin,hMax:hMax});
  }

  io.progress(0.02);
  setTimeout(pass1,0);
}

/* ============================ mode definition ============================ */

const MATS=[["stainless","Stainless"],["fluted","Fluted stainless"],["enamel","Porcelain enamel"]];

/* Three faces of one prefabricated body, so every step after the first opens
   with the whole body already decided and only the face's own business left:
   the entrance on the front, the length on the side, the service door and the
   exhaust on the back. */
Forge.registerStructure({
  id:"diner",
  label:"Diner",
  blurb:"Front, side and back of one streamline body",
  steps:[
    {id:"front",label:"Front",mode:"diner",set:{face:"front"},
     note:"The front decides the body: the band heights, the materials, the colours, the neon "+
          "and the sign. The side and the back are the same body seen from elsewhere, so they "+
          "open with all of it and the bands land at the same heights on each."},
    {id:"side",label:"Side",mode:"diner",set:{face:"side"},
     note:"The long run. Only the LENGTH is its own — everything else arrived from the front, "+
          "which is what makes the neon carry round the corner instead of stopping at it."},
    {id:"back",label:"Back",mode:"diner",set:{face:"back"},
     note:"Service. The glass goes solid, and what is left to set is the kitchen exhaust duct "+
          "and the service door — single leaf or a pair, with or without a vision lite."}
  ]
});

Forge.register({
  id:"diner",
  label:"Diner",
  blurb:"Chrome-and-neon diner — front, side and back",
  title:'Chrome <em>Diner</em>',
  tagline:"Stainless · porcelain enamel · plate glass · neon on emissive",
  actionLabel:"Build diner",
  busyLabel:"Building…",
  seamless:false,
  backdrops:true,
  flipPreviewY:true,
  previewSize:224,
  chipSource:140,
  preview:{gain:2.9,amb:1.2,specK:0.5,skyLo:[0.20,0.22,0.26],skyHi:[0.42,0.47,0.55]},

  channels:[
    {key:"basecolor",label:"Base + α"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Rough"},{key:"metallic",label:"Metal"},
    {key:"ao",label:"AO"},{key:"emissive",label:"Neon"},
    {key:"height",label:"Height"},{key:"orm",label:"ORM"},{key:"opacity",label:"Opacity"}
  ],

  presets:[
    {id:"classic",label:"Chrome classic",set:{
      bodyW:30,bodyL:52,baseH:1.6,lowH:1.7,winH:4.2,upH:1.3,browH:1.7,
      baseMat:"tile",lowMat:"enamel",upMat:"fluted",browMat:"stainless",
      panelW:4,bowIn:.14,battenIn:2.5,fluteIn:2.6,mullSp:4,mullIn:2.5,railIn:3,tileIn:4,
      doorW:3.4,doorH:7,doorPos:.5,entryType:"single",doorHand:"right",doorGlazing:"full",doorPull:"tube",pullIn:1.5,stileIn:4,jambIn:3,kickIn:10,transom:true,backDoorType:"single",backLite:true,interior:.5,boarded:0,
      neonBands:2,neonOn:1,neonBack:false,tubeIn:1.2,sign:"DINER",signColour:0,
      grime:.2,fade:.15,
      cBody:"#c8202a",cTrim:"#d8dde0",cTile:"#e9e4d6",cSteel:"#b9bfc4",
      cGlass:"#2e3a42",cNeon1:"#ff2d55",cNeon2:"#33d6ff",cNeon3:"#ffd21e"}},
    {id:"turquoise",label:"Turquoise & cream",set:{
      bodyW:28,bodyL:46,baseH:1.5,lowH:1.9,winH:4,upH:1.4,browH:1.6,
      baseMat:"tile",lowMat:"enamel",upMat:"enamel",browMat:"fluted",
      panelW:3.5,bowIn:.12,battenIn:2,fluteIn:2.2,mullSp:3.6,mullIn:2.2,railIn:3,tileIn:4,
      doorW:6.2,doorH:6.9,doorPos:.34,entryType:"double",doorHand:"right",doorGlazing:"full",doorPull:"tube",pullIn:1.75,stileIn:3.5,jambIn:3,kickIn:12,transom:true,backDoorType:"single",backLite:true,interior:.45,boarded:0,
      neonBands:3,neonOn:.9,neonBack:false,tubeIn:1,sign:"EAT",signColour:1,
      grime:.18,fade:.25,
      cBody:"#3fb3ae",cTrim:"#f2ece0",cTile:"#f0ead9",cSteel:"#c2c8cc",
      cGlass:"#31404a",cNeon1:"#ff8ad0",cNeon2:"#7bff9b",cNeon3:"#ffe66b"}},
    {id:"nightshift",label:"Night shift",set:{
      bodyW:32,bodyL:56,baseH:1.7,lowH:1.6,winH:4.4,upH:1.2,browH:1.8,
      baseMat:"fluted",lowMat:"fluted",upMat:"enamel",browMat:"enamel",
      panelW:4.5,bowIn:.16,battenIn:3,fluteIn:3,mullSp:4.4,mullIn:2.8,railIn:3.5,tileIn:4,
      doorW:3.5,doorH:7.1,doorPos:.62,entryType:"sidelight",doorHand:"left",doorGlazing:"full",doorPull:"loop",pullIn:1.25,stileIn:4.5,jambIn:3.5,kickIn:8,transom:true,backDoorType:"double",backLite:false,interior:.85,boarded:0,
      neonBands:3,neonOn:1,neonBack:true,tubeIn:1.4,sign:"OPEN",signColour:2,
      grime:.3,fade:.1,
      cBody:"#1f2a33",cTrim:"#cfd6da",cTile:"#dcd6c6",cSteel:"#aeb5bb",
      cGlass:"#1b242b",cNeon1:"#ff3b1f",cNeon2:"#2fe0ff",cNeon3:"#fff07a"}},
    {id:"closed",label:"Closed up",set:{
      bodyW:29,bodyL:48,baseH:1.6,lowH:1.8,winH:4.1,upH:1.3,browH:1.6,
      baseMat:"tile",lowMat:"enamel",upMat:"fluted",browMat:"stainless",
      panelW:4,bowIn:.14,battenIn:2.5,fluteIn:2.6,mullSp:4,mullIn:2.5,railIn:3,tileIn:4,
      doorW:3.4,doorH:7,doorPos:.5,entryType:"single",doorHand:"right",doorGlazing:"half",doorPull:"push",pullIn:1.5,stileIn:5,jambIn:3,kickIn:14,transom:false,backDoorType:"single",backLite:false,interior:0,boarded:.55,
      neonBands:2,neonOn:0,neonBack:false,tubeIn:1.2,sign:"CAFE",signColour:0,
      grime:.8,fade:.7,
      cBody:"#9a6b62",cTrim:"#b4b0a6",cTile:"#cabfa9",cSteel:"#9aa0a4",
      cGlass:"#28313a",cNeon1:"#ff2d55",cNeon2:"#33d6ff",cNeon3:"#ffd21e"}}
  ],

  controls:[
    {title:"Face & size",open:true,rows:[
      {id:"face",type:"select",label:"Face",value:"front",options:[
        ["front","Front — entrance"],["side","Side — the long run"],["back","Back — service"]]},
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:Forge.sizes("wide")},
      {id:"bodyW",label:"Front & back width",unit:"ft",min:12,max:60,step:0.5,value:30},
      {id:"bodyL",label:"Side length",unit:"ft",min:16,max:120,step:1,value:52},
      {type:"readout"},
      {id:"seed",type:"seed",value:1952},
      {type:"note",html:"The three faces come off one body. Set the same numbers on each and "+
        "they line up: the bands land at the same heights and the neon runs round the corner."}
    ]},
    {title:"Bands",open:true,rows:[
      {id:"baseH",label:"Skirt",unit:"ft",min:0.4,max:4,step:0.1,value:1.6},
      {id:"lowH",label:"Below the glass",unit:"ft",min:0.5,max:5,step:0.1,value:1.7},
      {id:"winH",label:"Window band",unit:"ft",min:1.5,max:8,step:0.1,value:4.2},
      {id:"upH",label:"Above the glass",unit:"ft",min:0.3,max:5,step:0.1,value:1.3},
      {id:"browH",label:"Eyebrow",unit:"ft",min:0.5,max:5,step:0.1,value:1.7},
      {id:"baseMat",type:"select",label:"Skirt material",value:"tile",options:[
        ["tile","Glazed tile"],["stainless","Stainless"],["fluted","Fluted stainless"]]},
      {id:"lowMat",type:"select",label:"Below the glass",value:"enamel",options:MATS},
      {id:"upMat",type:"select",label:"Above the glass",value:"fluted",options:MATS},
      {id:"browMat",type:"select",label:"Eyebrow",value:"stainless",options:MATS}
    ]},
    {title:"Metalwork & glass",rows:[
      {id:"fluteIn",label:"Flute pitch",unit:"in",min:1,max:8,step:0.2,value:2.6},
      {id:"panelW",label:"Enamel panel width",unit:"ft",min:1.5,max:10,step:0.25,value:4},
      {id:"bowIn",label:"Panel dish",unit:"in",min:0,max:0.6,step:0.02,value:0.14},
      {id:"battenIn",label:"Chrome batten",unit:"in",min:0.5,max:8,step:0.25,value:2.5},
      {id:"tileIn",label:"Tile size",unit:"in",min:1,max:12,step:0.5,value:4,need:"tilebase"},
      {id:"mullSp",label:"Mullion spacing",unit:"ft",min:1.5,max:10,step:0.2,value:4},
      {id:"mullIn",label:"Mullion width",unit:"in",min:0.75,max:8,step:0.25,value:2.5},
      {id:"railIn",label:"Head & sill rail",unit:"in",min:1,max:12,step:0.5,value:3},
      {id:"interior",label:"Counter showing through",min:0,max:1,step:0.01,value:0.5},
      {id:"boarded",label:"Boarded windows",min:0,max:1,step:0.01,value:0}
    ]},
    {title:"Doors",open:true,need:["front","back"],rows:[
      {id:"entryType",need:"front",type:"select",label:"Entrance",value:"single",options:[
        ["single","Single leaf"],["double","Double — a pair"],
        ["sidelight","Single with sidelights"],["none","None — glass right across"]]},
      {id:"doorW",label:"Opening width",unit:"ft",min:2.4,max:9,step:0.1,value:3.4,need:"front"},
      {id:"doorH",label:"Head height",unit:"ft",min:5.5,max:9,step:0.1,value:7,need:"front"},
      {id:"doorPos",label:"Position along the face",min:0,max:1,step:0.01,value:0.5},
      {id:"doorHand",need:"front",type:"select",label:"Hand",value:"right",options:[
        ["right","Pull on the right"],["left","Pull on the left"]]},
      {id:"doorGlazing",need:"front",type:"select",label:"Leaf",value:"full",options:[
        ["full","Full glass"],["half","Half glass over a solid panel"]]},
      {id:"doorPull",need:"front",type:"select",label:"Pull",value:"tube",options:[
        ["tube","Tubular — full height"],["loop","D-handle"],["push","Push bar across"]]},
      {id:"pullIn",need:"front",label:"Pull diameter",unit:"in",min:0.75,max:3,step:0.05,value:1.5},
      {id:"stileIn",need:"front",label:"Stile & rail",unit:"in",min:1.5,max:8,step:0.25,value:4},
      {id:"jambIn",need:"front",label:"Jamb",unit:"in",min:1,max:8,step:0.25,value:3},
      {id:"kickIn",need:"front",label:"Kick plate",unit:"in",min:0,max:20,step:0.5,value:10},
      {type:"checks",need:"front",items:[{id:"transom",label:"Transom light over the door",value:true}]},
      {type:"note",need:"front",html:"A leaf is a <b>frame</b> — two stiles, a top rail, a deeper "+
        "bottom rail that takes the kick — with glass in the hole, set into a jamb heavier than any "+
        "mullion beside it. The shopfront glazing stops at that jamb, so the entrance is a way in "+
        "rather than a rectangle drawn on the window."},
      {id:"backDoorType",need:"back",type:"select",label:"Service door",value:"single",options:[
        ["single","Single leaf"],["double","Double — a pair"],["none","None"]]},
      {type:"checks",need:"back",items:[{id:"backLite",label:"Vision lite in the service door",value:true}]}
    ]},
    {title:"Back of house",need:"back",rows:[
      {id:"ductW",label:"Exhaust duct",unit:"ft",min:0.6,max:5,step:0.1,value:2},
      {id:"ductPos",label:"Duct position",min:0,max:1,step:0.01,value:0.78},
      {type:"checks",items:[{id:"duct",label:"Kitchen exhaust duct",value:true}]}
    ]},
    {title:"Neon",open:true,rows:[
      {id:"neonBands",label:"Tube runs",min:0,max:3,step:1,value:2},
      {id:"tubeIn",label:"Tube diameter",unit:"in",min:0.4,max:3,step:0.1,value:1.2},
      {id:"neonOn",label:"Lit",min:0,max:1,step:0.01,value:1},
      {type:"checks",items:[{id:"neonBack",label:"Neon on the back too",value:false}]},
      {id:"sign",type:"select",label:"Sign",value:"DINER",need:"front",options:[
        ["DINER","DINER"],["EAT","EAT"],["CAFE","CAFE"],["GRILL","GRILL"],
        ["OPEN","OPEN"],["BAR","BAR"],["none","No sign"]]},
      {id:"signColour",type:"select",label:"Sign tube",value:0,need:"front",options:[
        [0,"Tube 1"],[1,"Tube 2"],[2,"Tube 3"]]},
      {type:"colors",label:"Tube 1 · 2 · 3",items:[
        {id:"cNeon1",value:"#ff2d55"},{id:"cNeon2",value:"#33d6ff"},{id:"cNeon3",value:"#ffd21e"}]},
      {type:"note",html:"<b>All</b> of the glow is in emissive.png, in the tube colour. The tube "+
        "itself stays pale glass in the base colour whether it is lit or not — which is what it "+
        "looks like in daylight. Turn the emissive map off and you get noon; turn it on and you "+
        "get midnight. <b>Lit</b> scales the emissive only, so it is a dimmer, not a repaint."}
    ]},
    {title:"Colour & age",rows:[
      {type:"colors",label:"Body · trim · tile · steel · glass",items:[
        {id:"cBody",value:"#c8202a"},{id:"cTrim",value:"#d8dde0"},{id:"cTile",value:"#e9e4d6"},
        {id:"cSteel",value:"#b9bfc4"},{id:"cGlass",value:"#2e3a42"}]},
      {id:"grime",label:"Grime",min:0,max:1,step:0.01,value:0.2},
      {id:"fade",label:"Sun fade",min:0,max:1,step:0.01,value:0.15}
    ]},
    {title:"Maps",rows:[
      {id:"normalStr",label:"Normal strength",min:0.1,max:3,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:0.8},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  needs:function(P){
    const n=[P.face||"front"];
    if(P.baseMat==="tile")n.push("tilebase");
    return n;
  },

  readout:function(P){
    const g=geom(P),pxPerFt=(P.size|0)/g.FW;
    let m="<b>"+Math.round(pxPerFt)+" px/ft</b> · "+g.FW.toFixed(1)+" × "+g.FH.toFixed(1)+" ft"+
          " · "+(P.size|0)+" × "+g.TH+" px";
    m+="<br>sill at <b>"+g.ySill.toFixed(2)+" ft</b>, head at <b>"+g.yHead.toFixed(2)+" ft</b>, "+
       "eyebrow from <b>"+g.yUp.toFixed(2)+" ft</b>";
    m+="<br>window band <b>"+Math.round(g.FW/g.mull)+" bays</b> of "+g.mull.toFixed(2)+
       " ft, enamel <b>"+Math.round(g.FW/g.panel)+" panels</b> of "+g.panel.toFixed(2)+" ft";
    m+="<br><span style=\"opacity:.7\">both snapped from "+(+P.mullSp).toFixed(1)+" and "+
       (+P.panelW).toFixed(2)+" ft so a whole number fits the face</span>";
    const flPx=P.fluteIn/12*pxPerFt;
    if(flPx<2.2)m+="<br>flutes "+flPx.toFixed(1)+" px — held at two texels; widen the pitch or "+
                   "raise the resolution";
    const mullPx=P.mullIn/12*pxPerFt;
    if(mullPx<1.5)m+="<br>mullions "+mullPx.toFixed(1)+" px — too thin to read";
    if(P.face==="front"&&P.sign!=="none")
      m+="<br>sign <b>"+P.sign+"</b> in tube "+((P.signColour|0)+1)+", stroked at "+
         (+P.tubeIn).toFixed(1)+" in";
    return m;
  },

  sizeTag:function(P){return (P.face||"front")+" · "+(+P.bodyW||30)+" ft";},

  /* neon is coloured per run, so it needs an RGB emissive rather than the
     runtime's single-channel warm default */
  writers:function(B){
    const E=B.EMC;
    return {emissive:function(i,o,k){
      o[k]=E[i*3];o[k+1]=E[i*3+1];o[k+2]=E[i*3+2];return 255;
    }};
  },

  size:function(P){const g=geom(P);return {w:g.TW,h:g.TH};},
  build:build,

  fileBase:function(P,W){return "diner_"+(P.face||"front")+"_"+(P.seed|0)+"_"+W;},

  readme:function(P,info){
    const g=geom(P);
    return ["Texture Forge · diner — chrome-and-neon diner, "+(P.face||"front")+" elevation",
      "",
      "Seed "+(P.seed|0)+"   Resolution "+info.W+"x"+info.H,
      "Face is "+g.FW.toFixed(1)+" x "+g.FH.toFixed(1)+" ft, so one texel is "+
        (g.FW/info.W*12).toFixed(2)+" in.",
      "",
      "A single elevation, not a tiling texture. It carries an alpha channel: the sky",
      "past the rounded top corners is transparent, so it cuts out cleanly on a plane.",
      "Build the front, the side and the back on the same numbers and the three faces",
      "belong to one diner.",
      "",
      "THE NEON is entirely in emissive.png, in the colour of each tube run. The tube",
      "itself is pale glass in basecolor.png whether it is lit or not, because that is",
      "what neon looks like with the power off and in daylight. Drive emissive from",
      "your material and you can switch the diner from noon to midnight without",
      "touching anything else. The Lit slider scales the emissive alone.",
      "",
      "basecolor.png  sRGB albedo, alpha = the silhouette. Import as sRGB.",
      "normal.png     Tangent space, "+info.normalNote+". Non-colour.",
      "roughness.png  Linear grey. Chrome and enamel both sit very low.",
      "metallic.png   Linear grey. Stainless and chrome are 1; enamel and tile are",
      "               dielectric; plate glass is set to 0.85 on purpose, the same cheat",
      "               the house mode documents, so an opaque pane reads as glass.",
      "ao.png         Linear grey; the window reveal and the eyebrow carry most of it.",
      "emissive.png   The neon, in colour. Black everywhere else.",
      "height.png     Linear grey spanning "+((info.hMax-info.hMin)*12).toFixed(2)+" in of relief.",
      "height16.png   The same field at 16 bits.",
      "orm.png        R = AO, G = roughness, B = metallic.",
      "opacity.png    The silhouette on its own.",
      "",
      "Normal strength was baked at "+(+P.normalStr).toFixed(2)+"x."].join("\n");
  }
});

})();
