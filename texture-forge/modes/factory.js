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
      hex2rgb=Forge.hex2rgb,boxBlurWrap=Forge.blurWrap,boxBlurClamp=Forge.blurClamp;

let P={};

/* ---------------------------------------------------------------------------
   TWO PIECES OFF ONE GENERATOR

   "Wall" is what this mode has always been: a seamless panel of factory
   elevation that tiles in both directions, sized by how much wall one tile
   covers. Everything below it is a whole BUILDING instead — a cut-out
   elevation with grade at the bottom, a roofline at the top and alpha
   outside the silhouette, the way the house and diner modes work.

   The brickwork, the openings and the weathering are the same code either
   way. What changes is where the coordinates come from: the panel wraps its
   storey and bay grid so the tile repeats, and the elevation does not wrap at
   all, so it can have a ground floor with vehicle doors in it and a top floor
   under a parapet. FACE is which side of that building we are drawing.
   --------------------------------------------------------------------------- */
const isWall=p=>(p.piece||"wall")==="wall";
const faceOf=p=>(p.piece||"wall");

/* The elevation's real dimensions, all in metres. The readout calls this
   between builds, so it takes the parameters rather than the latched copy. */
function geom(P){
  const face=faceOf(P);
  const bayW=Math.max(1.2,+P.bayW||4.2);
  const storeyH=Math.max(2.2,+P.storeyH||4.4);
  const storeys=Math.max(1,P.storeys|0);
  const plinth=Math.max(0,+P.plinthM||0.9);
  /* the side elevation is as long as the building is deep, in whole bays */
  const bays=(face==="side")
    ? Math.max(1,Math.round(Math.max(bayW,+P.depthM||24)/bayW))
    : Math.max(1,P.bays|0);
  const FW=bays*bayW;
  const wallTop=plinth+storeys*storeyH;
  const roof=P.roofStyle||"parapet";
  /* how far the roof reaches above the top floor */
  const para=(roof==="none")?0:Math.max(0,+P.parapetM||1.1);
  const toothH=(roof==="sawtooth")?Math.max(0.6,+P.toothM||2.2):0;
  const monH=(roof==="monitor")?Math.max(0.5,+P.monitorM||1.8):0;
  const roofTop=wallTop+para+toothH+monH;
  const FH=Math.max(1,roofTop);

  /* Height follows the building's real proportions, not the resolution
     slider, so a long side elevation is a wide short image and a tall narrow
     front is a tall one. Capped the same way the house is: past this the
     channel buffers alone are half a gigabyte, so the WIDTH comes down and
     texel density stays uniform. */
  const thOf=t=>Math.max(8,Math.round(t*FH/FW/4)*4);
  const MAXTEX=32e6;
  const asked=P.size|0;
  let TW=asked;
  if(TW*thOf(TW)>MAXTEX)TW=Math.max(64,Math.round(TW*Math.sqrt(MAXTEX/(TW*thOf(TW)))/4)*4);
  return {face:face,bays:bays,bayW:bayW,storeyH:storeyH,storeys:storeys,
          plinth:plinth,FW:FW,FH:FH,wallTop:wallTop,roof:roof,para:para,
          toothH:toothH,monH:monH,roofTop:roofTop,
          TW:TW,TH:thOf(TW),asked:asked,capped:TW<asked};
}

/* The skyline, in metres above grade, at a point across the face. Above this
   there is no building, so the elevation goes transparent. */
function roofLine(g,wx){
  if(g.roof==="sawtooth"&&g.face!=="side"){
    /* teeth run across the width: a steep glazed north light, a shallow back */
    const per=Math.max(1.5,g.bayW);
    const f=wx/per-Math.floor(wx/per);
    return g.wallTop+g.para*0.35+g.toothH*(f<0.62?(f/0.62):(1-(f-0.62)/0.38));
  }
  if(g.roof==="monitor"){
    /* a raised clerestory down the middle third of the roof */
    const c=Math.abs(wx-g.FW*0.5)/(g.FW*0.5);
    return g.wallTop+g.para+(c<0.42?g.monH:0);
  }
  return g.wallTop+g.para;
}

/* Everything below is in metres; heights come out in tile-width units.
   Takes the parameters rather than reading the latched copy, because the
   readout calls it between builds. */
function layout(P,g){
  /* The panel divides a square tile into rows and bays; the elevation already
     knows its storey height and bay width in metres. Everything downstream
     reads H and W without caring which it was, which is what lets one set of
     brickwork and opening code draw both pieces. */
  const wall=isWall(P);
  const T=wall?Math.max(2,+P.tileW||14):g.FW;
  const rows=wall?Math.max(1,P.rows|0):g.storeys;
  const cols=wall?Math.max(1,P.cols|0):g.bays;
  const H=wall?T/rows:g.storeyH,W=wall?T/cols:g.bayW;   // one storey, one bay
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
  const WALL=isWall(P);
  const seed=P.seed|0;
  /* The panel is square and wraps; the elevation is the building's own aspect
     and does not. Everything downstream works off SW/SH and the metre-per-texel
     scale, so the two only differ here. */
  const G=WALL?null:geom(P);
  const SW=io.W,SH=io.H,N=SW*SH;
  const S=SW;                                      // the panel's square side
  const L=layout(P,G),T=L.T;
  const M=1/T,MM=0.001/T;                          // metres, millimetres
  const mpp=T/SW,aa=mpp*0.7;                       // metres per texel

  const A=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N);
  const MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N);
  const EMI=new Uint8ClampedArray(N);
  const NRM=new Uint8ClampedArray(N*3);
  const HGT=new Float32Array(N);
  /* The panel has no silhouette, but the channel list is read once and cannot
     vary per build, so it carries an opaque one rather than the export losing
     a map depending on which piece you asked for. */
  const ALP=new Uint8ClampedArray(N);
  if(WALL)ALP.fill(255);
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

  const CSHADE=clamp(+P.courseShade,0,1);
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
    /* Every brick came out of the kiln its own colour, and "brick irregularity"
       ought to mean that as well as meaning the faces sit at slightly different
       depths — it drove the height alone, which is why a wall of them read as
       one flat tone from any distance. */
    const spread=0.30+clamp(P.brickIrreg,0,1)*0.58;
    let t=(1-spread*0.5)+bh*spread;
    let r=brickC[0]*t,g=brickC[1]*t,b=brickC[2]*t;
    if(flash>0){r=lerp(r,r*0.52+8,flash);g=lerp(g,g*0.55+10,flash);b=lerp(b,b*0.70+22,flash);}
    /* THE COURSE SHADOW. A brick is bedded on mortar and the one above oversails
       it by the width of the joint, so the top of every brick sits in its own
       small shadow and the bottom arris catches the light. It is the horizontal
       that makes brickwork read as courses rather than as a speckled plane —
       the same job the lap shadow does on clapboard. */
    if(CSHADE>0){
      const under=smoothstep(0.70,1.0,fy)*face*CSHADE;
      const arris=(1-smoothstep(0,0.16,fy))*face*CSHADE;
      r*=1-under*0.30;g*=1-under*0.30;b*=1-under*0.29;
      r=lerp(r,r*1.16+9,arris*0.55);g=lerp(g,g*1.16+9,arris*0.55);b=lerp(b,b*1.14+8,arris*0.55);
    }
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

  /* ---------------------------------------------------------------------------
     THE VEHICLE DOOR

     A works is a building lorries reverse into, and the opening they reverse
     into is nothing like a window: it goes to the ground, it is wider than it
     is tall, and what closes it is a machine. Three of them here, and they
     fail differently, which is most of the character:

       roll-up    corrugated steel slats on a barrel above the head, running in
                  a channel each side. Dents where something caught it, rust in
                  the corrugation troughs where the water sits.
       sectional  four or five panels hinged together, each framed like a door,
                  usually with a row of lites in the panel above head height.
       sliding    a pair of braced leaves on a top track, with the diagonal
                  that stops them racking.
     --------------------------------------------------------------------------- */
  function vdoor(dx,dy,w,hgt,sd){
    const kind=P.doorType||"rollup";
    const across=clamp(dx/Math.max(0.01,w),0,1);
    /* the guide channel each side */
    const chan=Math.min(0.12,w*0.05);
    if(dx<chan||dx>w-chan){
      const e=1-smoothstep(0,chan*0.5,Math.min(dx,w-dx));
      Mr=sashC[0]*0.82;Mg=sashC[1]*0.82;Mb=sashC[2]*0.84;
      Mrg=0.62;Mmet=0.55;Mh=-revealD*0.35+e*revealD*0.2;
      const rust0=clamp(fbm2(dx*3,dy*3,26,26,3,sd+7)*1.5-0.55,0,1)*P.rust;
      Mr=lerp(Mr,124,rust0*0.8);Mg=lerp(Mg,70,rust0*0.8);Mb=lerp(Mb,44,rust0*0.8);
      Mrg=lerp(Mrg,0.95,rust0);Mmet=lerp(Mmet,0.12,rust0);
      return true;
    }
    let r,g,b,h,rg,met;
    if(kind==="rollup"){
      /* the slats: a shallow curve, so the light catches every crest */
      /* Held at two and a half texels. A slat pitch finer than the texel grid
         does not read as corrugation, it reads as noise — and the seam between
         two slats is a dark line one texel wide, which is exactly the feature
         that aliases into a stripe pattern if it is not widened to suit. */
      const pitch=Math.max(0.06,aa*2.5,(+P.slatMm||90)*0.001);
      const f=dy/pitch-Math.floor(dy/pitch);
      const curve=Math.sin(f*Math.PI);
      const idx=Math.floor(dy/pitch);
      const tone=0.90+hashi(idx,3,sd+11)*0.08;
      /* galvanised, so it starts well above the dark paint the sash uses */
      r=(sashC[0]*0.55+96)*tone;g=(sashC[1]*0.55+99)*tone;b=(sashC[2]*0.55+99)*tone;
      h=-revealD*0.55+curve*15*MM;              // 15 mm of corrugation, in tile units
      rg=0.48;met=0.7;
      const seam=1-smoothstep(0,Math.max(pitch*0.16,aa*0.9),Math.min(f,1-f)*pitch);
      r*=1-seam*0.30;g*=1-seam*0.30;b*=1-seam*0.29;
      const dent=clamp(fbm2(dx*1.6,dy*1.6,7,9,3,sd+13)*1.7-0.72,0,1);
      h-=dent*12*MM;
      r*=1-dent*0.18;g*=1-dent*0.18;b*=1-dent*0.17;
      const wet=1-smoothstep(0,hgt*0.30,dy);
      const rust=clamp((fbm2(dx*2.4,dy*2.4,18,22,3,sd+17)*1.35-0.5)+(1-curve)*0.35+wet*0.5,0,1)*P.rust;
      r=lerp(r,128,rust*0.78);g=lerp(g,74,rust*0.78);b=lerp(b,46,rust*0.72);
      rg=lerp(rg,0.95,rust);met=lerp(met,0.1,rust);
    }else if(kind==="sectional"){
      const nP=Math.max(3,Math.round(hgt/0.62));
      const ph=hgt/nP;
      const pf=dy/ph-Math.floor(dy/ph);
      const pi=Math.floor(dy/ph);
      const tone=0.94+hashi(pi,5,sd+19)*0.08;
      r=sashC[0]*1.5*tone;g=sashC[1]*1.48*tone;b=sashC[2]*1.45*tone;
      rg=0.58;met=0.35;h=-revealD*0.5;
      const joint2=1-smoothstep(0,0.035,Math.min(pf,1-pf)*ph);
      h-=joint2*14*MM;
      r*=1-joint2*0.38;g*=1-joint2*0.38;b*=1-joint2*0.36;
      const inset=smoothstep(0,0.10,Math.min(across,1-across)*w)*
                  smoothstep(0,0.06,Math.min(pf,1-pf)*ph);
      h+=inset*8*MM;
      const liteRow=(nP>=4)?1:0;
      if(P.doorLites&&pi===nP-1-liteRow){
        const cells=Math.max(2,Math.round(w/0.55));
        const cf=across*cells-Math.floor(across*cells);
        const bar=1-smoothstep(0,0.035,Math.min(cf,1-cf)*(w/cells));
        if(bar<0.5&&pf>0.24&&pf<0.76){
          const gl=clamp(fbm2(dx*3,dy*3,30,30,3,sd+23)*1.2-0.2,0,1)*P.filth;
          r=lerp(glassC[0]*1.15,88,gl*0.7);g=lerp(glassC[1]*1.15,86,gl*0.7);
          b=lerp(glassC[2]*1.2,82,gl*0.7);
          rg=lerp(0.14,0.6,gl);met=0.8;h=-revealD*0.62;
        }
      }
      const wet=1-smoothstep(0,hgt*0.22,dy);
      const rust=clamp(fbm2(dx*2,dy*2,16,20,3,sd+29)*1.3-0.55+wet*0.4,0,1)*P.rust;
      r=lerp(r,126,rust*0.6);g=lerp(g,76,rust*0.6);b=lerp(b,50,rust*0.55);
      rg=lerp(rg,0.94,rust*0.8);
    }else{                                            // sliding leaves
      const leafX=(across<0.5)?dx:(w-dx);
      const halfW=w*0.5;
      r=sashC[0]*1.34;g=sashC[1]*1.32;b=sashC[2]*1.3;
      rg=0.66;met=0.3;h=-revealD*0.5;
      const bw=0.22;
      const bf=dy/bw-Math.floor(dy/bw);
      const seam=1-smoothstep(0,0.02,Math.min(bf,1-bf)*bw);
      h-=seam*10*MM;r*=1-seam*0.3;g*=1-seam*0.3;b*=1-seam*0.28;
      const edge=1-smoothstep(0,0.08,Math.min(Math.min(leafX,dy),hgt-dy));
      const diag=1-smoothstep(0,0.05,Math.abs((dy/hgt)-(leafX/Math.max(0.01,halfW)))*Math.min(hgt,halfW)*0.5);
      const brace=Math.max(edge,diag);
      if(brace>0){h+=brace*20*MM;r=lerp(r,r*1.12+12,brace);g=lerp(g,g*1.12+12,brace);b=lerp(b,b*1.1+10,brace);}
      const meet=1-smoothstep(0,0.05,Math.abs(across-0.5)*w);
      if(meet>0){h-=meet*16*MM;r*=1-meet*0.3;g*=1-meet*0.3;b*=1-meet*0.28;}
      const wet=1-smoothstep(0,hgt*0.25,dy);
      const rust=clamp(fbm2(dx*2,dy*2,15,18,3,sd+31)*1.25-0.55+wet*0.35,0,1)*P.rust;
      r=lerp(r,124,rust*0.55);g=lerp(g,78,rust*0.55);b=lerp(b,54,rust*0.5);
      rg=lerp(rg,0.93,rust*0.8);
    }
    /* everything down here gets kicked, scraped and splashed */
    const kick=1-smoothstep(0,0.45,dy);
    const scuff=clamp(fbm2(dx*4,dy*4,40,12,3,sd+37)*1.4-0.5,0,1)*kick;
    r=lerp(r,r*0.58+14,scuff*0.7);g=lerp(g,g*0.58+13,scuff*0.7);b=lerp(b,b*0.57+12,scuff*0.7);
    const grime=clamp(fbm2(dx*1.2,dy*1.2,9,11,3,sd+41)*1.2-0.42,0,1)*P.grime;
    r=lerp(r,r*0.66+7,grime*0.6);g=lerp(g,g*0.66+7,grime*0.6);b=lerp(b,b*0.64+6,grime*0.6);
    Mr=r;Mg=g;Mb=b;Mh=h;Mrg=clamp(rg,0.05,1);Mmet=clamp(met,0,1);
    return true;
  }

  function stone(u,v,shade){
    const n=fbm2(u,v,96,96,3,seed+53);
    const t=(0.90+n*0.22)*shade;
    Mr=stoneC[0]*t;Mg=stoneC[1]*t;Mb=stoneC[2]*t;Mrg=0.86;Mmet=0;
  }

  /* Which ground-floor bays are vehicle openings. A works has its doors at one
     end or in the middle, not scattered, so this is a run of them from a
     chosen bay — and the side elevation gets its own, because the long side of
     a factory is where the lorries actually go. */
  const doorRun=WALL?0:clamp(P.doorBays|0,0,G.bays);
  const doorFrom=WALL?0:clamp((P.doorFrom|0)-1,0,Math.max(0,G.bays-doorRun));
  const isDoorBay=b=>doorRun>0&&b>=doorFrom&&b<doorFrom+doorRun;

  const band=Math.max(4,Math.round(65536/SW));
  let y=0;

  function pass1(){
    const end=Math.min(SH,y+band);
    for(;y<end;y++){
      /* THE PANEL wraps: wy walks up an endless wall and the storey index is
         taken modulo the rows, so the tile repeats. THE ELEVATION does not:
         wy is height above grade, and running off the top of the building is
         sky rather than the next storey down. */
      const v=(y+0.5)/SH;
      const wy=WALL?((1-v)*T+vOff):((1-v)*G.FH);
      let si,ly,storeyTop=false;
      if(WALL){
        const sRaw=Math.floor(wy/L.H);
        ly=wy-sRaw*L.H;
        si=((sRaw%L.rows)+L.rows)%L.rows;
      }else{
        const above=wy-G.plinth;
        si=Math.floor(above/G.storeyH);
        ly=above-si*G.storeyH;
        storeyTop=(si>=G.storeys);
      }
      for(let x=0;x<SW;x++){
        const u=(x+0.5)/SW,wx=u*T,i=y*SW+x;
        const bi=WALL?Math.floor(wx/L.W):Math.floor(wx/G.bayW);
        const lx=WALL?(wx-bi*L.W):(wx-bi*G.bayW);
        Memi=0;

        if(!WALL){
          ALP[i]=255;
          /* above the skyline there is no building */
          if(wy>roofLine(G,wx)){
            ALP[i]=0;HGT[i]=0;RGH[i]=200;AOc[i]=255;MET[i]=0;EMI[i]=0;
            A[i*3]=0;A[i*3+1]=0;A[i*3+2]=0;
            continue;
          }
        }

        /* ---------------- brick field ---------------- */
        brick(wx,wy,u,v);
        let r=Mr,g=Mg,b=Mb,h=Mh,rg=Mrg,met=Mmet;

        /* pilaster: the pier between bays stands a little proud */
        if(proud>0){
          const e=Math.max(smoothstep(-aa,aa,L.pier*0.5-lx),
                           smoothstep(-aa,aa,lx-(L.W-L.pier*0.5)));
          h+=proud*clamp(e,0,1);
        }

        /* ---------------- what the elevation has that a panel cannot ----------
           A panel is a slice out of the middle of a wall, so it has no bottom
           and no top. A building has both, and they are most of what makes it
           read as a building rather than as wallpaper. */
        let noOpening=false,offWall=false;
        if(!WALL){
          /* the plinth: engineering brick or concrete, wider than the wall,
             taking the splash and the lorry wing mirrors */
          if(wy<G.plinth){
            noOpening=true;offWall=true;
            const t=1-smoothstep(G.plinth-aa*2,G.plinth,wy);
            stone(u,v,0.80);
            const wet=1-smoothstep(0,0.5,wy);          // rises damp, darkest at grade
            r=lerp(r,Mr*0.86,t);g=lerp(g,Mg*0.86,t);b=lerp(b,Mb*0.87,t);
            rg=lerp(rg,0.93,t);
            h=lerp(h,sillOut*0.9,t);
            r*=1-wet*0.30;g*=1-wet*0.30;b*=1-wet*0.28;
            /* and the top of it sheds, so it stays dirty */
            const cap=1-smoothstep(0,0.08,G.plinth-wy);
            r*=1-cap*0.18;g*=1-cap*0.18;b*=1-cap*0.17;
          }
          /* the parapet above the top floor, with its coping */
          else if(wy>G.wallTop){
            noOpening=true;offWall=true;
            const up=wy-G.wallTop;
            const skyH=roofLine(G,wx)-G.wallTop;
            const cope=Math.min(0.16,Math.max(0.06,skyH*0.14));
            if(up>skyH-cope){                          // the coping stone on top
              stone(u,v,1.04);
              r=Mr;g=Mg;b=Mb;rg=Mrg;met=0;
              h=sillOut*1.15;
              const wash=1-smoothstep(0,cope*0.5,skyH-up);
              r*=1-wash*0.20;g*=1-wash*0.20;b*=1-wash*0.19;
            }else if(G.roof==="sawtooth"&&G.face!=="side"){
              /* the glazed north light in the face of each tooth */
              const per=Math.max(1.5,G.bayW);
              const f=wx/per-Math.floor(wx/per);
              if(f<0.62&&up>G.para*0.35+0.12){
                r=glassC[0]*0.9;g=glassC[1]*0.95;b=glassC[2]*1.05;
                rg=0.16;met=0.8;h=-revealD*0.7;
                const bar=1-smoothstep(0,aa*1.6,Math.abs((wx/(per*0.16))-Math.round(wx/(per*0.16)))*per*0.16);
                if(bar>0){r=sashC[0];g=sashC[1];b=sashC[2];rg=0.6;met=0.3;h=-revealD*0.35;}
              }
            }
          }
          /* a storey above the top one is roof, not another floor */
          else if(storeyTop)noOpening=true;
          /* and a bay with a vehicle door in it has no window at grade — it has
             an opening that goes to the ground instead */
          else if(si===0&&isDoorBay(bi)){
            noOpening=true;
            const jam=Math.min(0.35,G.bayW*0.10);
            const dw=G.bayW-jam*2;
            const dh=Math.min(G.storeyH-0.45,Math.max(2.2,(+P.doorH||3.6)));
            const dx=lx-jam,dy=wy-G.plinth;
            const head=dh+Math.min(0.34,G.storeyH*0.09);   // the steel angle over it
            const sd=(seed+bi*7919+131)|0;
            if(dx>=0&&dx<=dw&&dy>=0&&dy<dh){
              /* the dock: a raised concrete apron the lorry backs onto, so the
                 door sits above the ground rather than on it */
              const dockH=Math.max(0,+P.dockM||0);
              if(dy<dockH){
                stone(u,v,0.74);
                r=Mr;g=Mg;b=Mb;rg=0.94;met=0;h=sillOut*1.4;
                const lip=1-smoothstep(0,0.06,dockH-dy);
                r*=1-lip*0.3;g*=1-lip*0.3;b*=1-lip*0.28;
                /* rubber bumpers, one each side of the opening */
                const bx=Math.min(dx,dw-dx);
                if(bx<0.30&&dy>dockH*0.30&&dy<dockH*0.86){
                  const bump=1-smoothstep(0.22,0.30,bx);
                  r=lerp(r,30,bump);g=lerp(g,29,bump);b=lerp(b,29,bump);
                  rg=lerp(rg,0.86,bump);h=lerp(h,sillOut*2.6,bump);
                }
              }else if(vdoor(dx,dy-dockH,dw,dh-dockH,sd)){
                r=Mr;g=Mg;b=Mb;h=Mh;rg=Mrg;met=Mmet;
              }
            }else if(dx>=-0.10&&dx<=dw+0.10&&dy>=dh&&dy<head){
              /* the header: a painted steel angle carrying the brickwork over */
              const t=(dy-dh)/Math.max(1e-4,head-dh);
              r=lerp(sashC[0]*1.1,sashC[0]*1.35+16,t);
              g=lerp(sashC[1]*1.1,sashC[1]*1.35+16,t);
              b=lerp(sashC[2]*1.1,sashC[2]*1.3+14,t);
              rg=0.6;met=0.4;h=revealD*0.35;
              const rust2=clamp(fbm2(u,v,44,60,3,seed+61)*1.4-0.45,0,1)*P.rust;
              r=lerp(r,132,rust2*0.85);g=lerp(g,74,rust2*0.85);b=lerp(b,44,rust2*0.8);
              rg=lerp(rg,0.95,rust2);met=lerp(met,0.1,rust2);
            }
          }
        }

        /* ---------------- belt course at the floor line ---------------- */
        let onBelt=0;
        if(L.belt>0&&ly<L.belt&&!offWall){
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
        if(!onBelt&&!noOpening){
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
        if(inX&&inY&&!onBelt&&!noOpening){
          const px=lx-ox0,py=ly-oy0;                  // metres inside the opening
          h=-revealD;

          /* THE REVEAL RETURN. Brick does not stop at the face of the wall and
             become window: it turns the corner and runs back into the hole,
             and that returning surface faces sideways, so it sees almost none
             of the sky. Without it an opening is a dark rectangle pasted onto
             a flat wall — the wall has no thickness, which is most of why this
             mode read flatter than the house. The head looks straight down and
             is darkest; the sill return catches the sky and is not. */
          const revW=Math.max(aa*1.2,P.revealMm*0.001);
          const dOpen=Math.min(Math.min(px,L.ow-px),Math.min(py,L.open-py));
          if(dOpen<revW){
            const t=clamp(dOpen/revW,0,1);
            brick(wx,wy,u,v);
            const head=py>L.open-revW,sillSide=py<revW;
            const deep=head?0.34:(sillSide?0.66:0.48);
            const dark=lerp(0.94,deep,smoothstep(0,1,t));
            r=Mr*dark;g=Mg*dark;b=Mb*dark;rg=clamp(Mrg+0.04,0,1);met=0;
            h=lerp(0,-revealD,smoothstep(0,1,t));
            /* the arris itself is chipped and picks the light up */
            const arris=1-smoothstep(0,aa*1.6,dOpen);
            r=lerp(r,r*1.28+16,arris*0.6);g=lerp(g,g*1.28+15,arris*0.6);b=lerp(b,b*1.26+14,arris*0.6);
            /* a reveal is sheltered, so it takes the general grime and none of
               the soot that runs down the open face */
            if(P.grime>0){
              const gr2=clamp(fbm(u,v,6,3,seed+127)*1.25-0.32,0,1)*P.grime;
              r=lerp(r,r*0.62+6,gr2*0.55);g=lerp(g,g*0.62+6,gr2*0.55);b=lerp(b,b*0.60+6,gr2*0.55);
            }
            HGT[i]=h;
            A[i*3]=r;A[i*3+1]=g;A[i*3+2]=b;
            RGH[i]=clamp(rg,0.05,1)*255;
            MET[i]=0;EMI[i]=0;AOc[i]=255;
            continue;
          }

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
    if(y<SH){io.progress(y/SH*0.7);setTimeout(pass1,0);}
    else{io.progress(0.75);setTimeout(pass2,0);}
  }

  function pass2(){
    /* Radii are FEATURE SIZES, so they belong in metres. As fractions of the
       image they made the shading a function of the resolution slider, and at
       0.4% and 2% of the width nothing was ever wider than a reveal — so an
       opening never went dark across its whole face, which is most of what
       makes a recessed window read as a hole.

       Screening rather than adding keeps a texel that is against several
       things from going past black, and because screening is a product each
       radius folds into one accumulator and is thrown away before the next is
       taken — 4 bytes a texel rather than one live blur per radius. The cap is
       there because four screened terms saturate: without it the deepest
       reveal clips to near-black, which is not occlusion, it is lost data. */
    const pxPerM=SW/T;
    const rCap=Math.max(6,Math.min(SW,SH)>>2);
    const rOf=m=>clamp(Math.round(pxPerM*m),2,rCap);
    const r1=rOf(Math.max(0.05,revealD*T*0.9));  // the reveal itself
    const r2=rOf(0.22);                          // a sill, a lintel, a pilaster
    const r3=rOf(0.85);                          // the jamb and its return
    const r4=rOf(Math.max(1.4,L.ow*0.75));       // the whole opening
    const sc=1/Math.max(1e-7,revealD*0.55);
    const OCCMAX=0.85;
    const blur=WALL?((src,r)=>boxBlurWrap(src,SW,r))
                   :((src,r)=>boxBlurClamp(src,SW,SH,r));
    let acc=new Float32Array(N);acc.fill(1);
    const fold=(rad,gain,w)=>{
      let bb=blur(HGT,rad);
      for(let i=0;i<N;i++){
        if(!ALP[i])continue;
        const c=clamp((bb[i]-HGT[i])*sc*gain,0,1);
        acc[i]*=(1-c*w);
      }
      bb=null;
    };
    fold(r1,1.60,0.45);fold(r2,1.15,0.60);fold(r3,0.85,0.62);fold(r4,0.60,0.55);
    for(let i=0;i<N;i++){
      if(!ALP[i]){AOc[i]=255;continue;}
      const occ=Math.min(1-acc[i],OCCMAX)*P.aoStr;
      AOc[i]=clamp(1-occ,0,1)*255;
    }
    acc=null;
    io.progress(0.9);

    hMin=Infinity;hMax=-Infinity;
    for(let i=0;i<N;i++){if(!ALP[i])continue;const h=HGT[i];if(h<hMin)hMin=h;if(h>hMax)hMax=h;}
    if(!isFinite(hMin)){hMin=0;hMax=1;}
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;

    const gy=P.flipG?-1:1;
    /* the panel wraps at its edges, the elevation clamps at them */
    const wrapX=WALL?(x=>(x+SW)%SW):(x=>x<0?0:(x>=SW?SW-1:x));
    const wrapY=WALL?(yy=>(yy+SH)%SH):(yy=>yy<0?0:(yy>=SH?SH-1:yy));
    /* one texel is the same distance either way, so the gradient uses the
       metre scale rather than the pixel count — on a non-square elevation
       those are not the same number */
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

/* One works, from three sides. The front and the back are the same building
   width; the side is however deep it is. The doors move, because the bays a
   lorry uses are not the bays the street sees. */
Forge.registerStructure({
  id:"factory",
  label:"Factory",
  blurb:"Front, side and back of one brick works",
  steps:[
    {id:"front",label:"Front",mode:"factory",set:{piece:"front"},
     note:"The front decides the building: the bay width, the storey height, the brickwork, the "+
          "sash and the roofline. The other two faces are the same building seen from elsewhere, "+
          "so they open with all of it and the courses land at the same heights on each."},
    {id:"side",label:"Side",mode:"factory",set:{piece:"side"},
     note:"The long run. Only the DEPTH is its own — everything else arrived from the front, "+
          "which is what makes the belt course carry round the corner instead of stopping at it. "+
          "This is usually where the loading doors are, so the door run is worth setting again."},
    {id:"back",label:"Back",mode:"factory",set:{piece:"back"},
     note:"Service. Same width as the front, and the place to put the rest of the vehicle doors, "+
          "the worst of the soot and the windows nobody has cleaned."}
  ]
});

Forge.register({
  id:"factory",
  label:"Factory",
  blurb:"1940s brick factory wall — steel sash windows",
  title:'Factory <em>Wall</em>',
  tagline:"Brick · steel industrial sash · wall panel or whole elevation",
  actionLabel:"Lay wall",
  busyLabel:"Laying…",
  previewSize:256,
  flipPreviewY:true,                    // it is a wall: y is up in world terms
  preview:{gain:3.0,amb:1.12,specK:0.55,skyLo:[0.16,0.19,0.23],skyHi:[0.34,0.38,0.44]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
    {key:"ao",label:"AO"},{key:"emissive",label:"Emissive"},
    {key:"height",label:"Height"},{key:"orm",label:"ORM packed"},
    {key:"opacity",label:"Opacity"}
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
      cBrick:"#7a4234",cMortar:"#8a8171",cStone:"#8b8880",cSash:"#3a3a34",cGlass:"#2f383e"}},

    /* --- whole buildings, not panels --- */
    {id:"worksFront",label:"Works — street front",set:{
      piece:"front",bays:7,bayW:4.2,storeys:3,storeyH:4.4,plinthM:0.9,
      roofStyle:"parapet",parapetM:1.2,
      doorBays:2,doorFrom:3,doorType:"rollup",doorH:3.8,slatMm:95,dockM:0,doorLites:true,
      bond:"common",headerEvery:6,brickL:215,brickH:65,jointMm:10,jointDmm:5,brickIrreg:.5,
      pierMm:900,pierMmProud:30,beltMm:340,sillMm:1100,openMm:2600,lintelMm:280,
      lintel:"soldier",sillTMm:160,sillOutMm:45,revealMm:130,
      transom:.5,paneMm:430,muntinMm:26,transomMm:80,frameMm:60,hopper:true,
      broken:.1,white:.08,winLit:.12,winGlow:.7,filth:.55,
      soot:.5,effl:.25,spall:.25,spallMm:8,pointing:.35,rust:.4,grime:.4,
      cBrick:"#8a4030",cMortar:"#a89b86",cStone:"#9a9589",cSash:"#3b423c",cGlass:"#3b464e"}},

    {id:"shed",label:"Sawtooth shed",set:{
      piece:"front",bays:8,bayW:4.6,storeys:1,storeyH:6.2,plinthM:1.1,
      roofStyle:"sawtooth",parapetM:0.7,toothM:2.6,
      doorBays:3,doorFrom:3,doorType:"sliding",doorH:4.6,dockM:0,doorLites:false,
      bond:"running",headerEvery:6,brickL:215,brickH:65,jointMm:10,jointDmm:5,brickIrreg:.45,
      pierMm:750,pierMmProud:20,beltMm:0,sillMm:2000,openMm:3000,lintelMm:260,
      lintel:"steel",sillTMm:150,sillOutMm:40,revealMm:120,
      transom:.55,paneMm:400,muntinMm:24,transomMm:75,frameMm:55,hopper:true,
      broken:.12,white:.12,winLit:.08,winGlow:.65,filth:.5,
      soot:.35,effl:.3,spall:.2,spallMm:7,pointing:.3,rust:.45,grime:.4,
      cBrick:"#96604a",cMortar:"#ab9f8c",cStone:"#9c968a",cSash:"#40453f",cGlass:"#3d4a52"}},

    {id:"loading",label:"Loading bay",set:{
      piece:"side",depthM:38,bayW:4.4,storeys:2,storeyH:4.8,plinthM:0.7,
      roofStyle:"parapet",parapetM:1.0,
      doorBays:4,doorFrom:2,doorType:"sectional",doorH:4.0,dockM:1.15,doorLites:true,
      bond:"common",headerEvery:6,brickL:215,brickH:65,jointMm:10,jointDmm:6,brickIrreg:.55,
      pierMm:850,pierMmProud:25,beltMm:300,sillMm:1200,openMm:2400,lintelMm:280,
      lintel:"steel",sillTMm:160,sillOutMm:45,revealMm:120,
      transom:.5,paneMm:430,muntinMm:26,transomMm:80,frameMm:60,hopper:true,
      broken:.14,white:.1,winLit:.1,winGlow:.7,filth:.6,
      soot:.5,effl:.3,spall:.3,spallMm:9,pointing:.4,rust:.6,grime:.55,
      cBrick:"#82443a",cMortar:"#9c9284",cStone:"#918d84",cSash:"#39403a",cGlass:"#39434b"}},

    {id:"plantBack",label:"Derelict plant — back",set:{
      piece:"back",bays:6,bayW:4.2,storeys:3,storeyH:4.4,plinthM:0.9,
      roofStyle:"monitor",parapetM:1.0,monitorM:2.0,
      doorBays:2,doorFrom:1,doorType:"rollup",doorH:3.6,slatMm:90,dockM:0.9,doorLites:false,
      bond:"common",headerEvery:7,brickL:215,brickH:65,jointMm:11,jointDmm:9,brickIrreg:.85,
      pierMm:950,pierMmProud:30,beltMm:360,sillMm:1050,openMm:2700,lintelMm:300,
      lintel:"steel",sillTMm:170,sillOutMm:50,revealMm:135,
      transom:.5,paneMm:420,muntinMm:26,transomMm:85,frameMm:60,hopper:true,
      broken:.75,white:.08,winLit:0,winGlow:.6,filth:.9,
      soot:.7,effl:.55,spall:.75,spallMm:14,pointing:.85,rust:.9,grime:.8,
      cBrick:"#7a4234",cMortar:"#8a8171",cStone:"#8b8880",cSash:"#3a3a34",cGlass:"#2f383e"}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"piece",type:"select",label:"Draw",value:"wall",options:[
        ["wall","Seamless wall panel"],["front","Whole building — front"],
        ["side","Whole building — side"],["back","Whole building — back"]]},
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:Forge.sizes("square")},
      {id:"tileW",need:"wall",label:"Tile covers",unit:"m",min:4,max:40,step:0.5,value:14},
      {type:"readout"},
      {id:"seed",type:"seed",value:1947},
      {type:"note",html:"<b>Wall</b> is a repeating panel of elevation — it tiles in both "+
        "directions and is sized by how much wall one tile covers. The other three are one "+
        "whole building: grade at the bottom, a roofline at the top, alpha outside the "+
        "silhouette, and a ground floor that can have vehicle doors in it."}
    ]},
    {title:"The building",need:"bldg",open:true,rows:[
      {id:"bays",need:["front","back"],label:"Bays across",min:1,max:14,step:1,value:6},
      {id:"depthM",need:"side",label:"Building depth",unit:"m",min:6,max:120,step:1,value:34},
      {id:"bayW",label:"Bay width",unit:"m",min:1.5,max:9,step:0.1,value:4.2},
      {id:"storeys",label:"Storeys",min:1,max:8,step:1,value:3},
      {id:"storeyH",label:"Storey height",unit:"m",min:2.4,max:8,step:0.1,value:4.4},
      {id:"plinthM",label:"Plinth at grade",unit:"m",min:0,max:2.5,step:0.05,value:0.9},
      {id:"roofStyle",type:"select",label:"Roofline",value:"parapet",options:[
        ["parapet","Parapet and coping"],["sawtooth","Sawtooth north lights"],
        ["monitor","Raised monitor"],["none","Cut off at the eaves"]]},
      {id:"parapetM",label:"Parapet height",unit:"m",min:0,max:3,step:0.05,value:1.1,need:"para"},
      {id:"toothM",need:"sawtooth",label:"Tooth height",unit:"m",min:0.6,max:5,step:0.1,value:2.2},
      {id:"monitorM",need:"monitor",label:"Monitor height",unit:"m",min:0.5,max:4,step:0.1,value:1.8}
    ]},
    {title:"Vehicle doors",need:"bldg",open:true,rows:[
      {id:"doorBays",label:"Door bays at grade",min:0,max:8,step:1,value:2},
      {id:"doorFrom",need:"door",label:"First door bay",min:1,max:14,step:1,value:2},
      {id:"doorType",need:"door",type:"select",label:"Door type",value:"rollup",options:[
        ["rollup","Roll-up — corrugated slats"],["sectional","Sectional — hinged panels"],
        ["sliding","Sliding braced leaves"]]},
      {id:"doorH",need:"door",label:"Door height",unit:"m",min:2.2,max:6.5,step:0.1,value:3.6},
      {id:"slatMm",need:"door",label:"Slat pitch",unit:"mm",min:50,max:200,step:5,value:90},
      {id:"dockM",need:"door",label:"Loading dock height",unit:"m",min:0,max:1.6,step:0.05,value:0},
      {type:"checks",need:"door",items:[{id:"doorLites",label:"Row of lites in the door",value:true}]},
      {type:"note",need:"door",html:"A works is a building lorries reverse into. Give the dock a "+
        "height and the opening lifts off the ground onto a concrete apron with rubber bumpers "+
        "either side — which is what a loading bay actually is."}
    ]},
    {title:"Bays & storeys",open:true,rows:[
      {id:"rows",need:"wall",label:"Window rows",min:1,max:8,step:1,value:3},
      {id:"cols",need:"wall",label:"Window bays",min:1,max:10,step:1,value:4},
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
      {id:"courseShade",label:"Course shadow line",min:0,max:1,step:0.01,value:0.55},
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
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:1},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  needs:function(P){
    const n=[P.bond,isWall(P)?"wall":"bldg"];
    if(!isWall(P)){
      n.push(faceOf(P));
      const r=P.roofStyle||"parapet";
      n.push(r);
      if(r!=="none")n.push("para");
      if((P.doorBays|0)>0)n.push("door");
    }
    return n;
  },

  readout:function(P){
    const wall=isWall(P);
    const g=wall?null:geom(P);
    const L=layout(P,g),S=wall?(P.size|0):g.TW,pxPerM=S/L.T;
    const nC=Math.max(1,Math.round(L.T/Math.max(0.02,(P.brickH+P.jointMm)*0.001)));
    const nB=Math.max(1,Math.round(L.T/Math.max(0.05,(P.brickL+P.jointMm)*0.001)));
    const cH=L.T/nC*1000,bL=L.T/nB*1000;
    let m="";
    if(!wall){
      m+="<b>"+g.FW.toFixed(1)+" × "+g.FH.toFixed(1)+" m</b> · "+g.TW+" × "+g.TH+" px · "+
         g.bays+" bays × "+g.storeys+" storeys<br>";
      if(g.capped)m+='<span class="warn">capped from '+g.asked+' px — this face is '+
        (g.FH/g.FW).toFixed(1)+'× its own width and the full size would not fit in memory</span><br>';
    }
    m+="<b>"+Math.round(pxPerM)+" px/m</b> · "+(1000/pxPerM).toFixed(1)+" mm per texel";
    if(!wall)m+="<br>eaves at <b>"+g.wallTop.toFixed(1)+" m</b>"+
      (g.roofTop>g.wallTop?", roof to "+g.roofTop.toFixed(1)+" m":"");
    m+="<br>storey <b>"+L.H.toFixed(2)+" m</b> · bay <b>"+L.W.toFixed(2)+" m</b> · "+
       "opening <b>"+L.ow.toFixed(2)+" × "+L.open.toFixed(2)+" m</b>";
    m+="<br>sash <b>"+L.paneC+" panes across</b>, "+L.paneB+" below the transom, "+L.paneT+" above";
    const paneW=L.ow/L.paneC*1000,paneB=L.botH/L.paneB*1000,paneT=L.topH/L.paneT*1000;
    m+=" — "+paneW.toFixed(0)+"×"+paneB.toFixed(0)+" and "+paneW.toFixed(0)+"×"+paneT.toFixed(0)+" mm";
    m+="<br>bond snapped to <b>"+cH.toFixed(1)+" mm</b> courses of <b>"+bL.toFixed(0)+" mm</b> "+
       "("+nC+" × "+nB+" across the "+(wall?"tile":"face")+")";
    if(!wall){
      const dr=clamp(P.doorBays|0,0,g.bays);
      m+="<br>"+(dr>0
        ? "<b>"+dr+"</b> vehicle "+(dr===1?"door":"doors")+" at grade from bay "+
          clamp(P.doorFrom|0,1,Math.max(1,g.bays-dr+1))
        : "no vehicle doors at grade");
    }
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

  /* square and tiling as a panel; the building's own aspect as an elevation */
  size:function(P){
    if(isWall(P)){const S=P.size|0;return {w:S,h:S};}
    const g=geom(P);return {w:g.TW,h:g.TH};
  },
  seamless:function(P){return isWall(P);},
  backdrops:function(P){return !isWall(P);},
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
