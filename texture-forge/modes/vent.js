/* =====================================================================
   MODE: vent — louvres, grilles, intakes and heatsinks
   =====================================================================
   Everything that moves air through a surface, and everything that
   throws heat off one. Six things, all built the same way:

     louvre     weather blades in a frame, drip lip out and down, a dark
                throat above each blade and mesh behind it
     grille     bars over a plenum — vertical, horizontal or egg-crate
     honeycomb  hex cell intake matrix, the cells running back into dark
     intake     a mouth with a rolled lip, a throat, vanes and a hub
     fin        extruded plate-fin heatsink seen from above
     pin        pin-fin heatsink, square, round or diamond pins

   Two pieces off the one generator, the way the factory has a panel and
   an elevation. TILE is a seamless field — a plant-room louvre wall, an
   endless heatsink — optionally divided into a grid of framed panels.
   UNIT is one component with an alpha silhouette, a flange and its
   fixing screws, ready to drop onto a hull or a wall.

   The frame is what makes the tiling honest. The field is only ever
   drawn INSIDE a cell, and the cells are bounded by frame on all four
   sides — at the tile edge two half-frames meet across the wrap and
   make exactly the same mullion the interior ones are. So the blade
   pitch, the hex grid and the fin count never have to wrap, and none of
   them has to be fudged to make the tile close.

   The heat is the other half of the mode. Anything with a deep part can
   be lit from inside it: the glow lives in the emissive map, and past a
   point it also drags the albedo of the metal towards orange, because a
   heatsink hot enough to light its own channels is not still grey.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      hashi=Forge.hashi,fbm=Forge.fbm,fbm2=Forge.fbm2,
      hex2rgb=Forge.hex2rgb,blurWrap=Forge.blurWrap,blurClamp=Forge.blurClamp;

let P={};

const isUnit=p=>(p.piece||"tile")==="unit";
const kindOf=p=>p.kind||"louvre";

/* How the surface was finished. Roughness, metallicity and the two grains
   that give a metal away — the drawn line of an extrusion and the crystal
   spangle of hot-dip galvanising — all follow from this one choice, so a
   preset picks a finish and a colour rather than five sliders. */
const FINISH={
  mill  :{rg:0.30,met:0.94,brush:1.00,spangle:0,name:"mill-finish aluminium"},
  anod  :{rg:0.47,met:0.80,brush:0.30,spangle:0,name:"anodised aluminium"},
  galv  :{rg:0.46,met:0.78,brush:0.10,spangle:1,name:"hot-dip galvanised steel"},
  paint :{rg:0.56,met:0.05,brush:0.00,spangle:0,name:"painted steel"},
  steel :{rg:0.40,met:0.92,brush:0.55,spangle:0,name:"bare steel"},
  copper:{rg:0.27,met:0.96,brush:0.75,spangle:0,name:"copper"}
};
const finOf=p=>FINISH[p.finish]||FINISH.mill;

/* ============================ dimensions ============================
   The real size of the thing in metres, and how many texels that gets.
   The readout calls this between builds, so it takes the parameters
   rather than reading the latched copy. */
function geom(P){
  const unit=isUnit(P);
  const Wm=Math.max(0.04,(unit?(+P.unitWmm||600):(+P.tileMm||900))*0.001);
  const Hm=unit?Math.max(0.04,(+P.unitHmm||450)*0.001):Wm;
  const asked=P.size|0;
  const thOf=t=>Math.max(8,Math.round(t*Hm/Wm/4)*4);
  const MAXTEX=32e6;
  let TW=asked;
  if(unit&&TW*thOf(TW)>MAXTEX)TW=Math.max(64,Math.round(TW*Math.sqrt(MAXTEX/(TW*thOf(TW)))/4)*4);
  return {unit:unit,Wm:Wm,Hm:Hm,TW:TW,TH:unit?thOf(TW):TW,asked:asked,capped:TW<asked};
}

/* The cell grid, the frame, and whatever the chosen field snaps to.
   Every count here is SNAPPED to the clear opening rather than set, for
   the same reason the factory snaps its brick courses: a blade pitch
   that does not divide the opening leaves a sliver at one end, and a
   sliver is the thing the eye finds first. */
function layout(P,g){
  const unit=g.unit,kind=kindOf(P);
  const cx=unit?1:clamp(P.panels|0,1,6),cy=cx;
  const cw=g.Wm/cx,ch=g.Hm/cy;
  const frame=clamp((+P.frameMm||45)*0.001,0,Math.min(cw,ch)*0.34);
  const fw=Math.max(0.01,cw-frame*2),fh=Math.max(0.01,ch-frame*2);

  const L={cx:cx,cy:cy,cw:cw,ch:ch,frame:frame,fw:fw,fh:fh,kind:kind};

  if(kind==="louvre"){
    L.nB=Math.max(1,Math.round(fh/Math.max(0.008,(+P.bladeMm||62)*0.001)));
    L.bp=fh/L.nB;
  }else if(kind==="grille"){
    const p=Math.max(0.006,(+P.barMm||38)*0.001);
    L.nX=Math.max(1,Math.round(fw/p));L.px=fw/L.nX;
    L.nY=Math.max(1,Math.round(fh/p));L.py=fh/L.nY;
  }else if(kind==="honeycomb"){
    const w=Math.max(0.004,(+P.hexMm||22)*0.001);
    L.nX=Math.max(1,Math.round(fw/w));L.hw=fw/L.nX;
    L.hh=L.hw*0.8660254;                       // pointy-top rows sit at √3/2 of the width
    /* Alternate rows sit half a cell across, so the pattern only comes back
       to itself after TWO rows. A field with a frame round it never crosses
       the wrap and does not care — but frame 0 on a single panel does, so the
       row count is snapped even and it closes either way. */
    L.nY=Math.max(1,Math.round(fh/L.hh));
    if(!unit&&L.frame<=0&&cy===1)L.nY=Math.max(2,Math.round(L.nY/2)*2);
    L.hh=fh/L.nY;
  }else if(kind==="fin"){
    L.nF=Math.max(2,Math.round(fw/Math.max(0.002,(+P.finMm||9)*0.001)));
    L.fp=fw/L.nF;
    L.finT=clamp((+P.finTmm||2.2)*0.001,L.fp*0.10,L.fp*0.80);
  }else if(kind==="pin"){
    const p=Math.max(0.003,(+P.pinMm||11)*0.001);
    L.nX=Math.max(1,Math.round(fw/p));L.px=fw/L.nX;
    L.nY=Math.max(1,Math.round(fh/p));L.py=fh/L.nY;
    L.pinT=clamp((+P.pinTmm||5)*0.001,Math.min(L.px,L.py)*0.15,Math.min(L.px,L.py)*0.88);
  }else{                                        // intake
    L.mouth=clamp(+P.mouth||0.86,0.3,1);
    L.ax=fw*0.5*L.mouth;L.ay=fh*0.5*L.mouth;
  }
  return L;
}

/* ============================ the generator ============================ */

function build(params,io){
  P=params;
  const g=geom(P),UNIT=g.unit,kind=kindOf(P);
  const SW=io.W,SH=io.H,N=SW*SH;
  const L=layout(P,g);
  const T=g.Wm;                                 // heights are in tile-WIDTH units
  const M=1/T,MM=0.001/T;
  const mpp=T/SW,aa=mpp*0.7;                    // metres per texel
  const seed=P.seed|0;
  const F=finOf(P);

  const A=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N);
  const MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N);
  const EMI=new Uint8ClampedArray(N);
  const NRM=new Uint8ClampedArray(N*3);
  const HGT=new Float32Array(N);
  /* the tile has no silhouette, but the channel list is read once and cannot
     vary per build, so it carries an opaque one rather than the export losing
     a map depending on which piece was asked for */
  const ALP=new Uint8ClampedArray(N);
  if(!UNIT)ALP.fill(255);
  let hMin=0,hMax=1;

  const bodyC=hex2rgb(P.cBody),deepC=hex2rgb(P.cDeep),glowC=hex2rgb(P.cGlow);

  const depth=Math.max(0.002,(+P.depthMm||60)*0.001);      // how far back it goes
  const depthU=depth*M;                                    // …in tile-width units
  const proud=(+P.frameProudMm||8)*MM;
  const rad=UNIT?clamp((+P.radMm||18)*0.001,0,Math.min(g.Wm,g.Hm)*0.35):0;
  const glow=clamp(+P.glowAmt||0,0,1);
  const glowMode=P.glowMode||"behind";
  const heatTint=clamp(+P.heatTint||0,0,1);

  /* material scratchpad, the same shape the other modes use */
  let Mr=0,Mg=0,Mb=0,Mh=0,Mrg=0.5,Mmet=0,Memi=0;

  /* -------------------------------------------------------------------------
     THE METAL ITSELF

     Every kind lands here for its body colour, so the finish reads the same
     across a louvre blade, a fin land and a flange. Three grains, and which
     ones are switched on is the whole difference between a milled billet and
     a galvanised sheet:

       brush     the drawn line of the extrusion or the mill, anisotropic —
                 long in one axis, tight in the other, which is why it uses
                 fbm2 and not fbm
       spangle   hot-dip galvanising freezes into crystal facets a centimetre
                 or two across, each one catching the light its own way
       micro     the fine tooth under everything, in roughness only: it costs
                 nothing in the normal map and it is what stops a large flat
                 land reading as a rendered plane
     ------------------------------------------------------------------------- */
  function metal(u,v,shade,along){
    let t=shade;
    if(F.brush>0){
      /* NOISE FLOOR. fbm doubles its lattice per octave, so a base period of
         220 over three octaves lands its finest cells at about one texel of a
         1024 map — and a value-noise cell that small does not read as grain,
         it reads as square blocks. Everything fine in this mode is held so its
         last octave is four texels or wider. */
      const b=along?fbm2(u,v,64,8,3,seed+11):fbm2(u,v,8,64,3,seed+11);
      t*=1+(b-0.5)*0.13*F.brush;
    }
    if(F.spangle>0){
      /* Facets: hot-dip galvanising freezes into crystals a couple of
         centimetres across, each catching the light its own way. The lattice
         is counted in whole cells across the tile rather than measured in
         metres — floor() of an absolute distance jumps at the wrap and puts a
         seam down a texture whose whole job is not to have one. */
      const gx=((Math.floor(u*SPX+fbm(u,v,7,2,seed+13)*1.6)%SPX)+SPX)%SPX;
      const gy=((Math.floor(v*SPY+fbm(u,v,7,2,seed+17)*1.6)%SPY)+SPY)%SPY;
      t*=0.90+hashi(gx,gy,seed+19)*0.22;
    }
    const micro=fbm2(u,v,64,64,3,seed+23);
    Mr=bodyC[0]*t;Mg=bodyC[1]*t;Mb=bodyC[2]*t;
    Mrg=clamp(F.rg+(micro-0.5)*0.14+(+P.scratch||0)*0.05,0.04,1);
    Mmet=F.met;
  }
  const SPX=Math.max(2,Math.round(g.Wm/0.026)),SPY=Math.max(2,Math.round(g.Hm/0.026));

  /* the dark of the plenum behind, deeper meaning darker */
  function behind(t){                            // t: 0 at the face, 1 at the back
    const k=1-t*0.86;
    Mr=deepC[0]*k;Mg=deepC[1]*k;Mb=deepC[2]*k;
    Mrg=clamp(0.86-t*0.10,0.1,1);Mmet=F.met*0.35;
  }

  /* Insect and bird mesh, seen down the throat. It sits a little way back
     from the face, so it takes the throat's darkness and adds its own grid —
     wires catching what light gets in, holes going through to nothing. */
  const meshP=Math.max(0.0015,(+P.meshMm||6)*0.001);
  function mesh(fx,fy,t){
    if(!P.meshOn)return;
    const wire=Math.max(meshP*0.22,aa*0.9);
    const dx=Math.abs(fx/meshP-Math.round(fx/meshP))*meshP;
    const dy=Math.abs(fy/meshP-Math.round(fy/meshP))*meshP;
    const on=Math.max(1-smoothstep(wire*0.5-aa,wire*0.5+aa,dx),
                      1-smoothstep(wire*0.5-aa,wire*0.5+aa,dy));
    if(on<=0.02)return;
    const lit=(0.34+0.30*(1-t));
    Mr=lerp(Mr,bodyC[0]*lit,on);Mg=lerp(Mg,bodyC[1]*lit,on);Mb=lerp(Mb,bodyC[2]*lit,on);
    Mrg=lerp(Mrg,0.62,on);Mmet=lerp(Mmet,F.met*0.8,on);
    Mh+=on*0.4*MM;
  }

  /* ---------------------------------------------------------------------------
     THE LOUVRE

     One pitch, bottom to top: the blade face, then the throat above it. The
     blade is proud at its bottom edge — that edge is the drip lip, the whole
     point of a weather louvre — and recedes as it rises, so the light rakes
     across it and every blade carries its own gradient. Above the blade's
     inner edge the throat runs back into the dark, and what caps the throat is
     the underside of the next blade's lip, which is the hardest shadow on the
     component.
     --------------------------------------------------------------------------- */
  function louvre(fx,fy,u,v,key){
    const bp=L.bp,idx=Math.floor(fy/bp),f=clamp(fy/bp-idx,0,1);
    const bf=clamp(+P.bladeFrac||0.62,0.30,0.90);
    const lip=(+P.lipMm||6)*MM;
    const tone=0.94+hashi(idx,key,seed+29)*0.10;
    if(f<bf){                                    // ---- the blade face
      const t=f/bf;
      metal(u,v,tone*lerp(1.16,0.60,t*t*0.75+t*0.25),true);
      /* the face is a shallow arc, not a plane: rolled at the lip, flattening
         as it goes back */
      Mh=lerp(lip,-depthU*0.80,smoothstep(0,1,t))+Math.sin(t*Math.PI)*0.9*MM;
      /* the stiffening rib pressed along the middle of every blade */
      if(P.ribs){
        const rd=Math.abs(t-0.55)*bf*bp;
        const on=1-smoothstep(0,Math.max(bp*0.045,aa*1.4),rd);
        Mh+=on*1.6*MM;
        Mr*=1+on*0.10;Mg*=1+on*0.10;Mb*=1+on*0.09;
      }
      /* the arris of the lip is where the paint goes first */
      const arris=1-smoothstep(0,Math.max(aa*2,bp*0.03),f*bp);
      if(arris>0&&(+P.wear||0)>0){
        const w=arris*(+P.wear)*0.9;
        Mr=lerp(Mr,208,w*0.55);Mg=lerp(Mg,212,w*0.55);Mb=lerp(Mb,216,w*0.5);
        Mrg=lerp(Mrg,0.22,w*0.6);Mmet=lerp(Mmet,0.95,w*0.6);
      }
      /* every lip sheds onto the blade below it, and the streak is the reason
         a louvre bank reads as weathered rather than as a stack of extrusions */
      const streak=clamp(fbm2(u,v,10,120,3,seed+31)*1.5-0.42,0,1)
                  *(1-smoothstep(0,bf*0.75,t))*(+P.grime||0);
      Mr=lerp(Mr,Mr*0.60+8,streak*0.8);Mg=lerp(Mg,Mg*0.60+8,streak*0.8);
      Mb=lerp(Mb,Mb*0.59+8,streak*0.8);
      Mrg=lerp(Mrg,0.92,streak*0.6);
      return 0;
    }
    /* ---- the throat
       depth runs from the blade's inner edge back, then the shadow of the next
       lip closes it off */
    const t=(f-bf)/(1-bf);
    Mh=-depthU;
    behind(0.55+t*0.45);
    mesh(fx,fy,0.6+t*0.4);
    /* what caps the throat is the underside of the next blade's lip, and it is
       the hardest shadow on the component */
    const cap=smoothstep(0.25,1,t);
    Mr*=1-cap*0.74;Mg*=1-cap*0.74;Mb*=1-cap*0.72;
    return 0.55+t*0.45;                          // how far back this texel is, for the glow
  }

  /* ---- bars over a plenum: vertical, horizontal, or both ---- */
  function grille(fx,fy,u,v,key){
    const dir=P.barDir||"vert";
    const bt=Math.max(aa*1.4,(+P.barTmm||9)*0.001);
    const round=clamp(+P.barRound||0.7,0,1);
    let on=0,axis=0;
    if(dir!=="horiz"){
      const c=Math.floor(fx/L.px),fr=fx/L.px-c;
      const d=Math.abs(fr-0.5)*L.px;
      const k=1-smoothstep(bt*0.5-aa,bt*0.5+aa*0.4,d);
      if(k>on){on=k;axis=clamp(1-d/(bt*0.5),0,1);}
    }
    if(dir!=="vert"){
      const c=Math.floor(fy/L.py),fr=fy/L.py-c;
      const d=Math.abs(fr-0.5)*L.py;
      const k=1-smoothstep(bt*0.5-aa,bt*0.5+aa*0.4,d);
      if(k>on){on=Math.max(on,k);axis=Math.max(axis,clamp(1-d/(bt*0.5),0,1));}
    }
    if(on>0.02){
      /* the bar's own section: flat-faced at round 0, half-round at 1 */
      const prof=lerp(1,Math.sqrt(Math.max(0,1-(1-axis)*(1-axis))),round);
      metal(u,v,(0.90+prof*0.20)*(0.95+hashi(Math.floor(fx/L.px),Math.floor(fy/L.py),seed+37)*0.08),dir==="vert");
      Mh=lerp(-depthU*0.12,(+P.barHmm||6)*MM,prof)*on+(-depthU)*(1-on);
      if((+P.wear||0)>0&&prof>0.82){
        const w=(prof-0.82)/0.18*(+P.wear)*0.8;
        Mr=lerp(Mr,206,w*0.5);Mg=lerp(Mg,210,w*0.5);Mb=lerp(Mb,214,w*0.45);
        Mrg=lerp(Mrg,0.24,w*0.5);Mmet=lerp(Mmet,0.95,w*0.5);
      }
      return 0;
    }
    Mh=-depthU;
    behind(0.9);
    mesh(fx,fy,0.8);
    return 0.9;
  }

  /* ---------------------------------------------------------------------------
     THE HONEYCOMB

     Hexagons are the Voronoi cells of offset rows of points, so rather than
     working out a hex distance function this finds the two nearest centres and
     takes half their difference: that is exactly the distance to the shared
     wall, it is correct at every vertex, and it hands back a cell id for free.
     --------------------------------------------------------------------------- */
  function hexAt(fx,fy){
    const hw=L.hw,hh=L.hh;
    let d1=1e9,d2=1e9,c1x=0,c1y=0;
    const r0=Math.round(fy/hh);
    for(let dr=-1;dr<=1;dr++){
      const row=r0+dr,cy2=row*hh;
      const off=(row&1)?hw*0.5:0;
      const c0=Math.round((fx-off)/hw);
      for(let dc=-1;dc<=1;dc++){
        const col=c0+dc,cx2=col*hw+off;
        const dx=fx-cx2,dy=fy-cy2,d=Math.sqrt(dx*dx+dy*dy);
        if(d<d1){d2=d1;d1=d;c1x=col;c1y=row;}
        else if(d<d2)d2=d;
      }
    }
    return {edge:(d2-d1)*0.5,col:c1x,row:c1y,r:d1};
  }
  function honeycomb(fx,fy,u,v){
    const wall=Math.max(aa*1.2,(+P.wallMm||1.1)*0.001);
    const H=hexAt(fx,fy);
    const on=1-smoothstep(wall*0.5-aa,wall*0.5+aa*0.5,H.edge);
    /* a cell or two in every matrix has been shut by something hitting it */
    const crush=hashi(H.col*31,H.row*17,seed+41)<(+P.crush||0)*0.35
      ?clamp(hashi(H.col*7,H.row*23,seed+43),0.25,1):0;
    if(on>0.02){
      metal(u,v,(1.02+hashi(H.col,H.row,seed+47)*0.10)*(1-crush*0.35),false);
      Mh=(1-crush*0.9)*1.2*MM-crush*depthU*0.25;
      if((+P.wear||0)>0){
        const w=on*(+P.wear)*0.7;
        Mr=lerp(Mr,204,w*0.4);Mg=lerp(Mg,208,w*0.4);Mb=lerp(Mb,212,w*0.36);
        Mrg=lerp(Mrg,0.26,w*0.45);Mmet=lerp(Mmet,0.95,w*0.45);
      }
      return 0;
    }
    /* down the tube: the further from the wall, the further you see */
    const t=clamp(0.35+H.r/Math.max(1e-4,L.hw*0.5)*0.65,0,1);
    const back=lerp(0.35,1,t)*(1-crush*0.6);
    Mh=-depthU*(1-crush*0.75);
    behind(back);
    if(crush>0){metal(u,v,0.55*(1-crush*0.3),false);Mrg=clamp(Mrg+0.12,0,1);}
    return back;
  }

  /* ---- the mouth: a rolled lip, a throat, vanes across it, a hub ---- */
  function intake(fx,fy,u,v){
    const cx2=L.fw*0.5,cy2=L.fh*0.5;
    const nx=(fx-cx2)/Math.max(1e-4,L.ax),ny=(fy-cy2)/Math.max(1e-4,L.ay);
    const rr=Math.sqrt(nx*nx+ny*ny);
    const lipW=clamp((+P.lipMm||22)*0.001/Math.max(1e-4,Math.min(L.ax,L.ay)),0.02,0.6);
    if(rr>1){                                    // the face plate around the mouth
      metal(u,v,1.0,false);Mh=0;return 0;
    }
    if(rr>1-lipW){                               // the lip, rolled over
      const t=(rr-(1-lipW))/lipW;
      metal(u,v,0.92+Math.sin(t*Math.PI)*0.30,false);
      Mh=Math.sin(t*Math.PI)*(+P.lipMm||22)*0.55*MM;
      return 0;
    }
    const t=1-rr/Math.max(1e-4,1-lipW);          // 0 at the lip, 1 at the middle
    let back=0.30+t*0.70;
    Mh=-depthU*(0.35+t*0.65);
    behind(back);
    /* The duct wall seen down the mouth: rings of stiffening, tightening as
       they recede because they are further away, and darkening with them. */
    const ring=Math.abs(Math.sin((1-t)*(1-t)*46));
    const fall=lerp(1,0.34,t*t);
    Mr*=(0.90+ring*0.20)*fall;Mg*=(0.90+ring*0.20)*fall;Mb*=(0.90+ring*0.19)*fall;
    /* vanes: straight bars across the mouth, or spokes from the hub */
    const nV=P.vanes|0;
    if(nV>0){
      const vt=Math.max(aa*1.5,(+P.vaneTmm||7)*0.001);
      let d;
      if((P.vaneDir||"straight")==="straight"){
        /* nV vanes spread across the mouth means nV+1 gaps, and the outermost
           vane sits a gap in from the lip rather than on it */
        const sp=L.ax*2/(nV+1);
        d=Math.abs((fx-cx2+L.ax)/sp-Math.round((fx-cx2+L.ax)/sp))*sp;
      }else{
        const ang=Math.atan2(ny,nx),sp=Math.PI*2/nV;
        d=Math.abs(ang/sp-Math.round(ang/sp))*sp*Math.max(0.02,rr)*L.ax;
      }
      const on=1-smoothstep(vt*0.5-aa,vt*0.5+aa*0.4,d);
      if(on>0.02){
        const pr=Mr,pg=Mg,pb=Mb,prg=Mrg,pmet=Mmet,ph=Mh;
        metal(u,v,0.96,false);
        Mr=lerp(pr,Mr,on);Mg=lerp(pg,Mg,on);Mb=lerp(pb,Mb,on);
        Mrg=lerp(prg,Mrg,on);Mmet=lerp(pmet,Mmet,on);
        Mh=lerp(ph,-depthU*0.16,on);
        back=lerp(back,0.16,on);
      }
    }
    if(P.hub){                                   // the spinner in the middle
      const hr=clamp(+P.hubR||0.22,0.05,0.7);
      if(rr<hr){
        const t2=rr/hr;
        metal(u,v,1.10-t2*0.25,false);
        Mh=lerp(-depthU*0.05,-depthU*0.42,t2*t2);
        back=0;
      }
    }
    return back;
  }

  /* ---------------------------------------------------------------------------
     THE HEATSINKS

     Seen from directly above, which is the only view a texture can honestly
     give of one: a land at the top of every fin, and a channel between them
     that the light does not reach. The extrusion's die lines run the length of
     the fin — they are the tell that a heatsink was pushed through a die
     rather than machined — and a crosscut is a slot milled straight across the
     fins to break the boundary layer up.
     --------------------------------------------------------------------------- */
  function fins(fx,fy,u,v){
    const c=Math.floor(fx/L.fp),f=fx/L.fp-c;
    /* in METRES from the side of the fin: negative on the fin, positive in the
       channel. It was a fraction of the pitch, which is not the same units as
       the chamfer width or the texel size it gets compared against — so the
       chamfer saturated and every fin came out flat-topped and full height. */
    const d=Math.abs(f-0.5)*L.fp-L.finT*0.5;
    const finH=(+P.finHmm||18)*MM;
    /* the crosscut slots: where one lands, the fin is not there */
    let cut=0;
    const nC=P.cuts|0;
    if(nC>0){
      const cw2=Math.max(aa*2,(+P.cutMm||6)*0.001);
      const sp=L.fh/(nC+1);
      const k=Math.round(fy/sp-0.5);
      if(k>=0&&k<nC){
        const dy=Math.abs(fy-(k+0.5)*sp);
        cut=1-smoothstep(cw2*0.5-aa,cw2*0.5+aa,dy);
      }
    }
    const on=(1-smoothstep(-aa,aa*0.6,d))*(1-cut);
    if(on>0.5){
      /* the land on top of the fin, with the tip chamfer at each side */
      const cham=clamp(-d/Math.max(L.finT*0.30,aa*2),0,1);
      metal(u,v,0.94+cham*0.22,true);
      Mh=finH*(0.72+cham*0.28);
      if((+P.dieLines||0)>0){
        const dl=fbm2(u,v,140,12,2,seed+53);
        Mh+=(dl-0.5)*0.5*MM*(+P.dieLines);
        Mrg=clamp(Mrg+(dl-0.5)*0.10*(+P.dieLines),0.04,1);
      }
      /* the tip is the only part of a fin anything ever touches, and it is
         where the anodising goes first — cham runs 0 at the tip edge to 1 well
         inside, so the wear rides the low end of it */
      const w=(+P.wear||0)*(1-smoothstep(0.10,0.62,cham));
      if(w>0){Mr=lerp(Mr,214,w*0.45);Mg=lerp(Mg,217,w*0.45);Mb=lerp(Mb,220,w*0.4);
        Mrg=lerp(Mrg,0.20,w*0.5);Mmet=lerp(Mmet,0.96,w*0.5);}
      return 0;
    }
    /* the channel floor, or the base the crosscut exposed */
    const t=clamp(d/Math.max(L.fp*0.35,aa*2),0,1);
    const floorH=cut>0.5?finH*0.20:0;
    Mh=floorH;
    metal(u,v,lerp(0.52,0.30,t),true);
    Mr*=0.7;Mg*=0.7;Mb*=0.7;
    Mrg=clamp(Mrg+0.14,0,1);
    return lerp(0.22,1,t);                       // deep in the channel = fully "behind"
  }

  function pins(fx,fy,u,v){
    const ci=Math.floor(fx/L.px),cj=Math.floor(fy/L.py);
    const lx=fx-(ci+0.5)*L.px,ly=fy-(cj+0.5)*L.py;
    const shape=P.pinShape||"square";
    const r=L.pinT*0.5;
    let d;                                        // signed: <0 inside the pin
    if(shape==="round")d=Math.sqrt(lx*lx+ly*ly)-r;
    else if(shape==="diamond")d=(Math.abs(lx)+Math.abs(ly))*0.7071-r*0.7071;
    else d=Math.max(Math.abs(lx),Math.abs(ly))-r;
    const pinH=(+P.pinHmm||14)*MM;
    const on=1-smoothstep(-aa,aa*0.6,d);
    if(on>0.5){
      const cham=clamp(-d/Math.max(r*0.28,aa*2),0,1);
      metal(u,v,(0.92+cham*0.24)*(0.96+hashi(ci,cj,seed+59)*0.08),false);
      Mh=pinH*(0.74+cham*0.26);
      return 0;
    }
    const t=clamp(d/Math.max(Math.min(L.px,L.py)*0.30,aa*2),0,1);
    Mh=0;
    metal(u,v,lerp(0.50,0.28,t),false);
    Mr*=0.7;Mg*=0.7;Mb*=0.7;
    Mrg=clamp(Mrg+0.14,0,1);
    return lerp(0.42,1,t);
  }

  /* ---- the frame, and the screws that hold it on ---- */
  function frameAt(dEdge,lx,ly,u,v){
    metal(u,v,1.04,false);
    Mh=proud;
    /* the chamfer where the frame meets the field */
    const inner=1-smoothstep(0,Math.max(aa*2.5,L.frame*0.22),L.frame-dEdge);
    Mh-=inner*proud*0.55;
    Mr*=1-inner*0.16;Mg*=1-inner*0.16;Mb*=1-inner*0.15;
    /* and the outer arris, which catches everything */
    const outer=1-smoothstep(0,Math.max(aa*2,L.frame*0.12),dEdge);
    Mr=lerp(Mr,Mr*1.16+10,outer*0.6);Mg=lerp(Mg,Mg*1.16+10,outer*0.6);
    Mb=lerp(Mb,Mb*1.14+9,outer*0.6);
    if(P.screws&&UNIT){
      /* one at each corner of the cell, set in from both edges by the same
         amount a fitter would: half the flange */
      const inset=L.frame*0.5;
      const sx=Math.min(Math.abs(lx-inset),Math.abs(L.cw-lx-inset));
      const sy=Math.min(Math.abs(ly-inset),Math.abs(L.ch-ly-inset));
      const d=Math.sqrt(sx*sx+sy*sy);
      const hr=Math.max(aa*2.2,L.frame*0.30);
      if(d<hr*1.35){
        const t=clamp(d/hr,0,1);
        /* countersunk: the head dishes in from a raised washer face */
        metal(u,v,1.12-t*0.30,false);
        Mh=proud+lerp(-1.4,0.4,smoothstep(0,1,t))*MM;
        if(d<hr*1.35&&d>hr){Mh=proud+0.5*MM;}
        /* the slot across it */
        const slot=1-smoothstep(Math.max(aa,hr*0.10),Math.max(aa,hr*0.10)+aa,Math.abs(sx));
        if(d<hr*0.8&&slot>0){Mh-=slot*1.0*MM;Mr*=1-slot*0.35;Mg*=1-slot*0.35;Mb*=1-slot*0.34;}
      }
    }
    return 0;
  }

  const band=Math.max(4,Math.round(65536/SW));
  let y=0;

  function pass1(){
    const end=Math.min(SH,y+band);
    for(;y<end;y++){
      const v=(y+0.5)/SH;
      const wy=(1-v)*g.Hm;                       // metres up from the bottom
      for(let x=0;x<SW;x++){
        const u=(x+0.5)/SW,wx=u*g.Wm,i=y*SW+x;
        Memi=0;

        if(UNIT){
          /* the silhouette: a rounded rectangle, so the corners of the flange
             are radiused the way a pressed or extruded frame's are */
          /* Signed distance to the silhouette, NEGATIVE inside. It started at
             zero, which is not "well inside" — it is exactly the edge, and
             with a corner radius of zero nothing ever moved it, so the
             smoothstep below evaluated at the middle of its own antialiasing
             band and handed every texel on the panel an alpha of 0.32. A
             square panel came out a third transparent and rendered as a dim
             ghost of itself over the backdrop. */
          let out=-1;
          if(rad>0){
            const qx=Math.max(rad-Math.min(wx,g.Wm-wx),0);
            const qy=Math.max(rad-Math.min(wy,g.Hm-wy),0);
            out=Math.sqrt(qx*qx+qy*qy)-rad;
          }
          const a=1-smoothstep(-aa,aa*0.6,out);
          ALP[i]=clamp(a,0,1)*255;
          if(a<0.02){
            HGT[i]=0;RGH[i]=200;AOc[i]=255;MET[i]=0;EMI[i]=0;
            A[i*3]=0;A[i*3+1]=0;A[i*3+2]=0;
            continue;
          }
        }

        const ci=Math.min(L.cx-1,Math.floor(wx/L.cw)),cj=Math.min(L.cy-1,Math.floor(wy/L.ch));
        const lx=wx-ci*L.cw,ly=wy-cj*L.ch;
        const dEdge=Math.min(Math.min(lx,L.cw-lx),Math.min(ly,L.ch-ly));
        const key=(ci*7919+cj*104729)|0;
        let back=0;

        if(L.frame>0&&dEdge<L.frame){
          back=frameAt(dEdge,lx,ly,u,v);
        }else{
          const fx=lx-L.frame,fy=ly-L.frame;
          if(kind==="louvre")back=louvre(fx,fy,u,v,key);
          else if(kind==="grille")back=grille(fx,fy,u,v,key);
          else if(kind==="honeycomb")back=honeycomb(fx,fy,u,v);
          else if(kind==="intake")back=intake(fx,fy,u,v);
          else if(kind==="fin")back=fins(fx,fy,u,v);
          else back=pins(fx,fy,u,v);
        }

        let r=Mr,gg=Mg,b=Mb,h=Mh,rg=Mrg,met=Mmet;

        /* ---------------- the heat ----------------
           "behind" lights the deep parts, which is what a glowing core seen
           through its own grille looks like; "root" lights only the join where
           the metal meets the gap, which is where a running heatsink is
           actually hottest; "body" heats the metal itself and lets the albedo
           follow, because past a few hundred degrees a fin is not grey. */
        if(glow>0){
          let e=0;
          if(glowMode==="behind")e=Math.pow(clamp(back,0,1),3.6);
          else if(glowMode==="root")e=clamp(1-Math.abs(back-0.45)/0.42,0,1);
          else e=(1-clamp(back,0,1));
          e*=glow;
          if(e>0){
            Memi=clamp(e,0,1)*255;
            if(heatTint>0&&glowMode!=="behind"){
              const k=e*heatTint;
              r=lerp(r,glowC[0],k*0.55);gg=lerp(gg,glowC[1],k*0.55);b=lerp(b,glowC[2],k*0.5);
              rg=lerp(rg,0.42,k*0.4);met=lerp(met,met*0.55,k*0.5);
            }
          }
        }

        /* ---------------- age ---------------- */
        if((+P.rust||0)>0){
          /* rust starts at the deep, wet, unpainted places and works outward */
          const n=fbm2(u,v,26,26,3,seed+61);
          const ru=clamp(n*1.5-0.55+back*0.35,0,1)*(+P.rust);
          if(ru>0){
            r=lerp(r,126,ru*0.82);gg=lerp(gg,72,ru*0.82);b=lerp(b,44,ru*0.78);
            rg=lerp(rg,0.95,ru);met=lerp(met,0.08,ru);
            h-=ru*0.5*MM;
          }
        }
        if((+P.dust||0)>0){
          /* dust settles on what faces up, and a louvre blade or a fin land is
             a shelf. It reads off the height gradient later; here it is enough
             to key it to the shallow, forward-facing texels. */
          const du=clamp(fbm2(u,v,44,60,3,seed+67)*1.4-0.35,0,1)*(+P.dust)*(1-back);
          r=lerp(r,168,du*0.42);gg=lerp(gg,163,du*0.42);b=lerp(b,152,du*0.40);
          rg=lerp(rg,0.96,du*0.8);met=lerp(met,met*0.25,du*0.7);
        }
        if((+P.grime||0)>0){
          const gr=clamp(fbm(u,v,7,3,seed+71)*1.3-0.34,0,1)*(+P.grime);
          r=lerp(r,r*0.62+6,gr*0.7);gg=lerp(gg,gg*0.62+6,gr*0.7);b=lerp(b,b*0.60+6,gr*0.7);
          rg=lerp(rg,0.93,gr*0.5);
        }
        if((+P.scratch||0)>0){
          /* micro scratches: roughness and a whisker of height, no colour. They
             are half a texel wide by definition, so anything more reads as a
             pattern rather than as damage. */
          /* Two crossed grains thresholded HIGH: take the max of a pair of
             stretched fields at 0.62 and most of the surface qualifies, which
             is not scratching, it is weaving. Thresholded where only the top
             few per cent survive, each survivor is one stroke. */
          /* The UPPER TAIL of a stretched field, not its ridge. A ridge picks
             out where the noise is near its median, and near the median is
             where most of a field lives — thresholding one at 0.9 scribbles
             over everything. The tail at 0.72 is about three per cent of the
             surface, and because the field is long in one axis each survivor
             comes out as a stroke rather than a blob. */
          const s1=fbm2(u,v,120,9,2,seed+73),s2=fbm2(u,v,9,120,2,seed+79);
          const sc=(Math.max(s1,s2)-0.72);
          if(sc>0){
            /* A scratch is fresh metal, so it is BRIGHTER — but it is also
               torn, so it is not smoother. Driving roughness towards zero
               made every stroke a mirror, and a mirror pointed away from the
               only light in the preview is black: the fins came out covered
               in dark scribble. Held above a floor, and small. */
            const k=clamp(sc*7,0,1)*(+P.scratch);
            rg=clamp(rg-k*0.10,Math.min(0.16,rg),1);
            h+=k*0.18*MM;
            r=lerp(r,r*1.16+14,k*0.45);gg=lerp(gg,gg*1.16+14,k*0.45);b=lerp(b,b*1.15+14,k*0.45);
          }
        }

        HGT[i]=h;
        A[i*3]=r;A[i*3+1]=gg;A[i*3+2]=b;
        RGH[i]=clamp(rg,0.03,1)*255;
        MET[i]=clamp(met,0,1)*255;
        EMI[i]=Memi;
        AOc[i]=255;
      }
    }
    if(y<SH){io.progress(y/SH*0.72);setTimeout(pass1,0);}
    else{io.progress(0.76);setTimeout(pass2,0);}
  }

  function pass2(){
    /* AO the way the factory does it: radii are FEATURE SIZES in metres, so
       the shading does not become a function of the resolution slider, and the
       terms screen into one accumulator rather than summing — a texel down a
       hex cell is against several things at once and must not go past black. */
    const pxPerM=SW/T;
    const rCap=Math.max(4,Math.min(SW,SH)>>2);
    const rOf=m=>clamp(Math.round(pxPerM*m),1,rCap);
    const feat=(L.kind==="fin")?L.fp:(L.kind==="pin")?Math.min(L.px,L.py)
              :(L.kind==="honeycomb")?L.hw:(L.kind==="louvre")?L.bp:Math.max(0.02,L.fw*0.10);
    const r1=rOf(Math.max(0.002,depth*0.35));
    const r2=rOf(feat*0.75);
    const r3=rOf(Math.max(feat*2.4,L.frame*1.2));
    const sc=1/Math.max(1e-7,depthU*0.55);
    const blur=UNIT?((src,r)=>blurClamp(src,SW,SH,r)):((src,r)=>blurWrap(src,SW,r));
    let acc=new Float32Array(N);acc.fill(1);
    const fold=(rad2,gain,w)=>{
      let bb=blur(HGT,rad2);
      for(let i=0;i<N;i++){
        if(!ALP[i])continue;
        acc[i]*=(1-clamp((bb[i]-HGT[i])*sc*gain,0,1)*w);
      }
      bb=null;
    };
    fold(r1,1.55,0.48);fold(r2,1.05,0.62);fold(r3,0.70,0.58);
    for(let i=0;i<N;i++){
      if(!ALP[i]){AOc[i]=255;continue;}
      AOc[i]=clamp(1-Math.min(1-acc[i],0.88)*(+P.aoStr),0,1)*255;
    }
    acc=null;
    io.progress(0.9);

    hMin=Infinity;hMax=-Infinity;
    for(let i=0;i<N;i++){if(!ALP[i])continue;const h=HGT[i];if(h<hMin)hMin=h;if(h>hMax)hMax=h;}
    if(!isFinite(hMin)){hMin=0;hMax=1;}
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;

    const gy=P.flipG?-1:1;
    const wrapX=UNIT?(x=>x<0?0:(x>=SW?SW-1:x)):(x=>(x+SW)%SW);
    const wrapY=UNIT?(yy=>yy<0?0:(yy>=SH?SH-1:yy)):(yy=>(yy+SH)%SH);
    const perTexel=T/SW;
    for(let yy=0;yy<SH;yy++){
      const yp=wrapY(yy+1)*SW,ym=wrapY(yy-1)*SW,y0=yy*SW;
      for(let xx=0;xx<SW;xx++){
        const xp=wrapX(xx+1),xm=wrapX(xx-1);
        const dhdu=(HGT[y0+xp]-HGT[y0+xm])/(2*perTexel)*P.normalStr;
        const dhdv=(HGT[yp+xx]-HGT[ym+xx])/(2*perTexel)*P.normalStr;
        let nx=-dhdu,ny=-dhdv*gy;
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;
        const j=(y0+xx)*3;
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
  id:"vent",
  label:"Vent",
  group:"Detail",
  blurb:"Louvres, grilles, intakes and heatsinks — cold or glowing",
  title:'Vent <em>& Heatsink</em>',
  tagline:"Louvre · grille · honeycomb · intake · fin · pin · emissive heat",
  actionLabel:"Cut the vent",
  busyLabel:"Cutting…",
  previewSize:256,
  flipPreviewY:true,                    // louvres and drip lips care which way is up
  preview:{gain:3.1,amb:1.06,specK:0.5,skyLo:[0.15,0.17,0.21],skyHi:[0.33,0.37,0.44]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
    {key:"ao",label:"AO"},{key:"emissive",label:"Emissive"},
    {key:"height",label:"Height"},{key:"orm",label:"ORM packed"},
    {key:"opacity",label:"Opacity"}
  ],

  presets:[
    {id:"plant",label:"Plant room louvre",set:{
      piece:"tile",kind:"louvre",tileMm:1800,panels:2,finish:"galv",
      frameMm:55,frameProudMm:10,depthMm:150,
      bladeMm:66,bladeFrac:.62,lipMm:7,ribs:true,meshOn:true,meshMm:8,
      glowAmt:0,heatTint:0,wear:.25,dust:.35,rust:.15,grime:.45,scratch:.3,
      cBody:"#9aa0a4",cDeep:"#171a1c",cGlow:"#ff8a2a"}},

    {id:"extract",label:"Extract grille",set:{
      piece:"unit",kind:"grille",unitWmm:600,unitHmm:600,finish:"paint",
      frameMm:38,frameProudMm:7,radMm:14,screws:true,depthMm:90,
      barDir:"vert",barMm:34,barTmm:10,barHmm:7,barRound:.8,meshOn:true,meshMm:5,
      glowAmt:0,wear:.35,dust:.4,rust:.3,grime:.5,scratch:.35,
      cBody:"#6d7478",cDeep:"#141618",cGlow:"#ff8a2a"}},

    {id:"honey",label:"Honeycomb intake",set:{
      piece:"unit",kind:"honeycomb",unitWmm:420,unitHmm:420,finish:"mill",
      frameMm:26,frameProudMm:6,radMm:60,screws:true,depthMm:70,
      hexMm:16,wallMm:0.9,crush:.15,
      glowAmt:0,wear:.4,dust:.2,rust:0,grime:.25,scratch:.45,
      cBody:"#b4b9bd",cDeep:"#101214",cGlow:"#4fd8ff"}},

    {id:"ram",label:"Ram air intake",set:{
      piece:"unit",kind:"intake",unitWmm:900,unitHmm:640,finish:"paint",
      frameMm:44,frameProudMm:5,radMm:90,screws:false,depthMm:260,
      mouth:.9,lipMm:34,vanes:5,vaneDir:"straight",vaneTmm:12,hub:false,
      glowAmt:0,wear:.3,dust:.25,rust:.12,grime:.4,scratch:.3,
      cBody:"#5d6468",cDeep:"#0d0f11",cGlow:"#ff8a2a"}},

    {id:"turbo",label:"Turbine intake",set:{
      piece:"unit",kind:"intake",unitWmm:900,unitHmm:900,finish:"mill",
      frameMm:34,frameProudMm:5,radMm:400,screws:true,depthMm:340,
      mouth:.94,lipMm:40,vanes:11,vaneDir:"radial",vaneTmm:14,hub:true,hubR:.24,
      glowAmt:0,wear:.45,dust:.15,rust:0,grime:.25,scratch:.4,
      cBody:"#aab0b4",cDeep:"#0b0d0f",cGlow:"#4fd8ff"}},

    {id:"alu",label:"Aluminium heatsink",set:{
      piece:"tile",kind:"fin",tileMm:120,panels:1,finish:"mill",
      frameMm:5,frameProudMm:3,depthMm:22,
      finMm:8,finTmm:2.6,finHmm:18,cuts:2,cutMm:5,dieLines:.7,
      glowAmt:0,wear:.35,dust:.3,rust:0,grime:.2,scratch:.32,
      cBody:"#b7bcc0",cDeep:"#121416",cGlow:"#4fd8ff"}},

    {id:"reactor",label:"Reactor heatsink",set:{
      piece:"tile",kind:"fin",tileMm:260,panels:2,finish:"anod",
      frameMm:14,frameProudMm:6,depthMm:34,
      finMm:11,finTmm:4.5,finHmm:28,cuts:3,cutMm:8,dieLines:.5,
      glowAmt:.5,glowMode:"behind",heatTint:.4,
      wear:.2,dust:.1,rust:0,grime:.2,scratch:.35,
      cBody:"#2c2f33",cDeep:"#1a0a04",cGlow:"#ff6a18"}},

    {id:"core",label:"Pin-fin core — hot",set:{
      piece:"unit",kind:"pin",unitWmm:300,unitHmm:220,finish:"copper",
      frameMm:16,frameProudMm:5,radMm:10,screws:true,depthMm:20,
      pinMm:10,pinTmm:5,pinHmm:16,pinShape:"square",
      glowAmt:.7,glowMode:"root",heatTint:.65,
      wear:.3,dust:.05,rust:0,grime:.15,scratch:.4,
      cBody:"#b9714a",cDeep:"#2a0d04",cGlow:"#ff9a30"}},

    {id:"rusted",label:"Rusted extract louvre",set:{
      piece:"unit",kind:"louvre",unitWmm:700,unitHmm:900,finish:"steel",
      frameMm:44,frameProudMm:9,radMm:8,screws:true,depthMm:170,
      bladeMm:72,bladeFrac:.6,lipMm:8,ribs:false,meshOn:true,meshMm:9,
      glowAmt:0,wear:.5,dust:.4,rust:.85,grime:.75,scratch:.4,
      cBody:"#7e8388",cDeep:"#151313",cGlow:"#ff8a2a"}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"piece",type:"select",label:"Draw",value:"tile",options:[
        ["tile","Seamless field"],["unit","One unit, cut out"]]},
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:Forge.sizes("square")},
      {id:"tileMm",need:"tile",label:"Tile covers",unit:"mm",min:60,max:4000,step:10,value:900},
      {id:"panels",need:"tile",label:"Panels across the tile",min:1,max:6,step:1,value:2},
      {id:"unitWmm",need:"unit",label:"Unit width",unit:"mm",min:40,max:3000,step:5,value:600},
      {id:"unitHmm",need:"unit",label:"Unit height",unit:"mm",min:40,max:3000,step:5,value:450},
      {type:"readout"},
      {id:"seed",type:"seed",value:2411},
      {type:"note",html:"<b>Seamless field</b> divides the tile into framed panels and repeats — "+
        "a louvre wall, an endless heatsink. <b>One unit</b> is a single component with an alpha "+
        "silhouette, a flange and its fixings, to drop onto a wall or a hull."}
    ]},
    {title:"The component",open:true,rows:[
      {id:"kind",type:"select",label:"What it is",value:"louvre",options:[
        ["louvre","Weather louvre — blades"],["grille","Grille — bars over a plenum"],
        ["honeycomb","Honeycomb intake matrix"],["intake","Air intake — mouth and vanes"],
        ["fin","Heatsink — extruded plate fins"],["pin","Heatsink — pin fins"]]},
      {id:"frameMm",label:"Frame / flange",unit:"mm",min:0,max:250,step:1,value:45},
      {id:"frameProudMm",label:"Frame projection",unit:"mm",min:0,max:40,step:0.5,value:8},
      {id:"radMm",need:"unit",label:"Corner radius",unit:"mm",min:0,max:600,step:2,value:18},
      {id:"depthMm",label:"Depth behind the face",unit:"mm",min:3,max:500,step:1,value:60},
      {type:"checks",need:"unit",items:[{id:"screws",label:"Fixing screws in the flange",value:true}]}
    ]},
    {title:"Blades",need:"louvre",open:true,rows:[
      {id:"bladeMm",label:"Blade pitch",unit:"mm",min:12,max:250,step:1,value:62},
      {id:"bladeFrac",label:"Blade face / throat",min:0.3,max:0.9,step:0.01,value:0.62},
      {id:"lipMm",label:"Drip lip projection",unit:"mm",min:0,max:40,step:0.5,value:6},
      {type:"checks",items:[{id:"ribs",label:"Stiffening rib along each blade",value:true}]},
      {type:"note",html:"Blade counts are <b>snapped</b> to the clear opening, not set: a pitch "+
        "that does not divide the frame leaves a sliver at one end, and a sliver is the first "+
        "thing the eye finds. The readout says what it landed on."}
    ]},
    {title:"Bars",need:"grille",open:true,rows:[
      {id:"barDir",type:"select",label:"Bars run",value:"vert",options:[
        ["vert","Vertical"],["horiz","Horizontal"],["egg","Egg-crate — both"]]},
      {id:"barMm",label:"Bar pitch",unit:"mm",min:6,max:200,step:1,value:34},
      {id:"barTmm",label:"Bar thickness",unit:"mm",min:1,max:60,step:0.5,value:9},
      {id:"barHmm",label:"Bar projection",unit:"mm",min:0,max:40,step:0.5,value:6},
      {id:"barRound",label:"Bar section — flat to round",min:0,max:1,step:0.01,value:0.7}
    ]},
    {title:"Cells",need:"honeycomb",open:true,rows:[
      {id:"hexMm",label:"Cell width",unit:"mm",min:3,max:120,step:0.5,value:16},
      {id:"wallMm",label:"Cell wall",unit:"mm",min:0.2,max:12,step:0.1,value:0.9},
      {id:"crush",label:"Crushed cells",min:0,max:1,step:0.01,value:0.15}
    ]},
    {title:"The mouth",need:"intake",open:true,rows:[
      {id:"mouth",label:"Mouth fills the frame",min:0.3,max:1,step:0.01,value:0.88},
      {id:"lipMm",label:"Rolled lip",unit:"mm",min:2,max:120,step:1,value:26},
      {id:"vanes",label:"Vanes across it",min:0,max:16,step:1,value:5},
      {id:"vaneDir",type:"select",label:"Vanes run",value:"straight",options:[
        ["straight","Straight across"],["radial","Radial from the middle"]]},
      {id:"vaneTmm",label:"Vane thickness",unit:"mm",min:2,max:60,step:1,value:10},
      {type:"checks",items:[{id:"hub",label:"Hub / spinner in the middle",value:false}]},
      {id:"hubR",need:"hub",label:"Hub radius",min:0.05,max:0.7,step:0.01,value:0.22}
    ]},
    {title:"Fins",need:"fin",open:true,rows:[
      {id:"finMm",label:"Fin pitch",unit:"mm",min:1.5,max:60,step:0.5,value:9},
      {id:"finTmm",label:"Fin thickness",unit:"mm",min:0.4,max:20,step:0.1,value:2.2},
      {id:"finHmm",label:"Fin height",unit:"mm",min:1,max:120,step:0.5,value:18},
      {id:"cuts",label:"Crosscut slots",min:0,max:8,step:1,value:2},
      {id:"cutMm",need:"cut",label:"Slot width",unit:"mm",min:1,max:40,step:0.5,value:6},
      {id:"dieLines",label:"Extrusion die lines",min:0,max:1,step:0.01,value:0.6}
    ]},
    {title:"Pins",need:"pin",open:true,rows:[
      {id:"pinMm",label:"Pin pitch",unit:"mm",min:2,max:60,step:0.5,value:11},
      {id:"pinTmm",label:"Pin size",unit:"mm",min:0.5,max:40,step:0.5,value:5},
      {id:"pinHmm",label:"Pin height",unit:"mm",min:1,max:100,step:0.5,value:14},
      {id:"pinShape",type:"select",label:"Pin section",value:"square",options:[
        ["square","Square"],["round","Round"],["diamond","Diamond"]]}
    ]},
    {title:"Behind the face",open:true,rows:[
      {type:"checks",items:[{id:"meshOn",label:"Insect / bird mesh behind",value:true}]},
      {id:"meshMm",need:"mesh",label:"Mesh pitch",unit:"mm",min:1,max:40,step:0.5,value:6}
    ]},
    {title:"Heat",open:true,rows:[
      {id:"glowAmt",label:"Glow",min:0,max:1,step:0.01,value:0},
      {id:"glowMode",need:"glow",type:"select",label:"Where the heat is",value:"behind",options:[
        ["behind","Behind it — lit from inside"],["root","At the roots — where it is hottest"],
        ["body","The metal itself is hot"]]},
      {id:"heatTint",need:"glow",label:"Albedo follows the heat",min:0,max:1,step:0.01,value:0.4},
      {type:"note",need:"glow",html:"The glow lives in <b>emissive</b>, not in the base colour — "+
        "blow the albedo out instead and you get something that reads as white paint the moment "+
        "the lights come on. Past a point the metal does change colour, which is what "+
        "<b>albedo follows the heat</b> is for."}
    ]},
    {title:"Finish & age",rows:[
      {id:"finish",type:"select",label:"Finish",value:"mill",options:[
        ["mill","Mill-finish aluminium"],["anod","Anodised"],["galv","Hot-dip galvanised"],
        ["paint","Painted steel"],["steel","Bare steel"],["copper","Copper"]]},
      {id:"wear",label:"Bright edges — worn back",min:0,max:1,step:0.01,value:0.3},
      {id:"scratch",label:"Micro scratches",min:0,max:1,step:0.01,value:0.35},
      {id:"dust",label:"Dust on the ledges",min:0,max:1,step:0.01,value:0.3},
      {id:"rust",label:"Rust",min:0,max:1,step:0.01,value:0.15},
      {id:"grime",label:"Overall grime",min:0,max:1,step:0.01,value:0.4},
      {type:"colors",label:"Body · behind · glow",items:[
        {id:"cBody",value:"#9aa0a4"},{id:"cDeep",value:"#171a1c"},{id:"cGlow",value:"#ff8a2a"}]}
    ]},
    {title:"Maps",rows:[
      {id:"normalStr",label:"Normal strength",min:0.1,max:3,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:1},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  needs:function(P){
    const n=[isUnit(P)?"unit":"tile",kindOf(P)];
    if(P.meshOn)n.push("mesh");
    if((+P.glowAmt||0)>0)n.push("glow");
    if((P.cuts|0)>0)n.push("cut");
    if(P.hub)n.push("hub");
    return n;
  },

  readout:function(P){
    const g=geom(P),L=layout(P,g);
    const pxPerM=g.TW/g.Wm,mmPerTexel=1000/pxPerM;
    let m="<b>"+(g.Wm*1000).toFixed(0)+" × "+(g.Hm*1000).toFixed(0)+" mm</b> · "+
          g.TW+" × "+g.TH+" px<br>"+
          Math.round(pxPerM)+" px/m · <b>"+mmPerTexel.toFixed(2)+" mm per texel</b>";
    if(g.capped)m+='<br><span class="warn">capped from '+g.asked+' px — this unit is '+
      (g.Hm/g.Wm).toFixed(1)+'× its own width and the full size would not fit in memory</span>';
    if(!g.unit)m+="<br>"+L.cx+" × "+L.cy+" panels of <b>"+(L.fw*1000).toFixed(0)+" × "+
      (L.fh*1000).toFixed(0)+" mm</b> clear";
    else m+="<br>clear opening <b>"+(L.fw*1000).toFixed(0)+" × "+(L.fh*1000).toFixed(0)+" mm</b>";
    let feat=0,what="";
    if(L.kind==="louvre"){
      m+="<br>bank of <b>"+L.nB+" blades</b> snapped to "+(L.bp*1000).toFixed(1)+" mm pitch";
      feat=L.bp*(1-(+P.bladeFrac||0.62));what="the throat between blades";
    }else if(L.kind==="grille"){
      m+="<br>"+((P.barDir||"vert")==="horiz"?L.nY+" bars":(P.barDir==="egg"?L.nX+" × "+L.nY+" bars":L.nX+" bars"))+
         " at <b>"+(((P.barDir||"vert")==="horiz"?L.py:L.px)*1000).toFixed(1)+" mm</b>";
      feat=(+P.barTmm||9)*0.001;what="a bar";
    }else if(L.kind==="honeycomb"){
      m+="<br><b>"+L.nX+" × "+L.nY+" cells</b> at "+(L.hw*1000).toFixed(1)+" mm across";
      feat=(+P.wallMm||0.9)*0.001;what="a cell wall";
    }else if(L.kind==="fin"){
      m+="<br><b>"+L.nF+" fins</b> snapped to "+(L.fp*1000).toFixed(2)+" mm pitch, "+
         (L.finT*1000).toFixed(2)+" mm thick";
      feat=L.fp-L.finT;what="the channel between fins";
    }else if(L.kind==="pin"){
      m+="<br><b>"+L.nX+" × "+L.nY+" pins</b> at "+(L.px*1000).toFixed(2)+" × "+
         (L.py*1000).toFixed(2)+" mm";
      feat=L.pinT;what="a pin";
    }else{
      m+="<br>mouth <b>"+(L.ax*2000).toFixed(0)+" × "+(L.ay*2000).toFixed(0)+" mm</b>"+
         ((P.vanes|0)>0?", "+(P.vanes|0)+" vanes":", no vanes");
      feat=(+P.vaneTmm||10)*0.001;what="a vane";
    }
    const px=feat*pxPerM;
    if(px<1.4)m+='<br><span class="warn">'+what+" is "+px.toFixed(2)+
      " px — raise the resolution or the pitch, or it will alias into a moiré</span>";
    if(P.meshOn){
      const mp=(+P.meshMm||6)*0.001*pxPerM;
      if(mp<2.2)m+="<br>mesh at "+mp.toFixed(2)+" px — it will read as a haze rather than a grid";
    }
    if((+P.glowAmt||0)>0)m+="<br>glowing "+(P.glowMode==="body"?"metal"
      :(P.glowMode==="root"?"at the roots":"from behind"))+" — see emissive.png";
    return m;
  },

  tileTag:function(P){return isUnit(P)?"":"tiles ↔ and ↕";},
  sizeTag:function(P){return (kindOf(P))+" · "+(isUnit(P)?(+P.unitWmm||600)+" mm":(+P.tileMm||900)+" mm");},

  /* the glow is whatever colour the core is, not the runtime's default warm */
  writers:function(B,P){
    const E=B.EMI,c=hex2rgb(P.cGlow);
    return {emissive:function(i,o,k){
      const e=E[i]/255;
      o[k]=c[0]*e;o[k+1]=c[1]*e;o[k+2]=c[2]*e;return 255;
    }};
  },

  size:function(P){const g=geom(P);return {w:g.TW,h:g.TH};},
  seamless:function(P){return !isUnit(P);},
  backdrops:function(P){return isUnit(P);},
  build:build,

  /* what a quad of this wants to be in Blender, in metres */
  plan:function(P){const g=geom(P);return {w:g.Wm,h:g.Hm,cutout:g.unit};},

  fileBase:function(P,W){return "vent_"+kindOf(P)+"_"+(P.seed|0)+"_"+W;},

  readme:function(P,info){
    const g=geom(P),L=layout(P,g);
    const F=finOf(P);
    const mm=(info.hMax-info.hMin)*g.Wm*1000;
    const out=["Texture Forge · vent — "+kindOf(P)+", "+F.name,
      "",
      "Seed "+(P.seed|0)+"   Texture "+info.W+" x "+info.H+" px",
      "Covers "+(g.Wm*1000).toFixed(0)+" x "+(g.Hm*1000).toFixed(0)+" mm — one texel is "+
        (g.Wm/info.W*1000).toFixed(3)+" mm.",
      "Scale your plane to that and the blade pitch, the mesh and the fixings sit at true size.",
      ""];
    if(g.unit)out.push(
      "This is ONE UNIT, not a tiling material. It carries an alpha channel: outside the",
      "flange is transparent, so it drops onto a wall or a hull and cuts out cleanly.","");
    else out.push(
      "Seamless in both axes. The field is only ever drawn inside a framed panel, and at the",
      "tile edge two half-frames meet across the wrap to make the same mullion the interior",
      "ones are — which is why the blade and fin counts never had to be fudged to close.","");
    out.push(
      "basecolor.png  sRGB albedo"+(g.unit?", alpha = the silhouette":"")+". Import as sRGB.",
      "normal.png     Tangent space, "+info.normalNote+". Non-colour.",
      "roughness.png  Linear grey.",
      "metallic.png   Linear grey — "+F.name+" reads at "+F.met.toFixed(2)+" over the body.",
      "ao.png         Linear grey. The throats and channels carry nearly all of it.",
      "emissive.png   "+((+P.glowAmt||0)>0
        ?"The heat, in "+P.cGlow+". Drive an emission shader with it."
        :"Black — nothing here is lit. Raise Glow and it fills in."),
      "height.png     8-bit displacement spanning "+mm.toFixed(1)+" mm of real relief",
      "               (0-1 maps to "+(info.hMax-info.hMin).toFixed(6)+" in tile-width units).",
      "height16.png   The same field at 16 bits. Use this one for displacement: the depth",
      "               behind the face eats the range and leaves the surface almost nothing",
      "               at 8 bits.",
      "orm.png        R = AO, G = roughness, B = metallic.",
      "");
    if(L.kind==="louvre")out.push("Blades: "+L.nB+" at "+(L.bp*1000).toFixed(1)+" mm pitch.");
    else if(L.kind==="fin")out.push("Fins: "+L.nF+" at "+(L.fp*1000).toFixed(2)+" mm pitch, "+
      (L.finT*1000).toFixed(2)+" mm thick, "+(+P.finHmm||18)+" mm tall.");
    else if(L.kind==="pin")out.push("Pins: "+L.nX+" x "+L.nY+" at "+(L.px*1000).toFixed(2)+" mm.");
    else if(L.kind==="honeycomb")out.push("Cells: "+L.nX+" x "+L.nY+" at "+(L.hw*1000).toFixed(1)+" mm across.");
    out.push("","Normal strength was baked at "+(+P.normalStr).toFixed(2)+"x.");
    return out.join("\n");
  }
});

})();
