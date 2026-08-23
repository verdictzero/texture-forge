/* =====================================================================
   MODES: sheet · plate · slab — three panels off one generator
   =====================================================================
   One file, three registrations, the same way the house family shares
   lib/house-shell.js. What they have in common is that they are all a
   PANEL: a piece of material with a real thickness, real edges and real
   fixings, rather than a pattern printed on nothing.

     sheet   rusted metal sheet, seamless. Flat, corrugated or box
             profile, painted or bare, with the paint failing where the
             rust comes through and fasteners down every purlin line.
     plate   one riveted metal plate, cut out. A bevelled edge, rivets
             at a snapped pitch round the perimeter, a pressed swage,
             and the chipping that collects round every fastener.
     slab    one precast concrete panel, cut out. Chamfered arrises,
             form-tie holes, lifting sockets, blowholes, and the
             staining that runs from all three.

   The two cut-out pieces carry an alpha silhouette so they drop onto
   geometry and read as one component. The sheet tiles.

   Counts are snapped rather than set, throughout — a corrugation pitch
   that does not divide the tile walks the profile across the wrap, and
   a rivet pitch that does not divide the plate leaves an odd gap in one
   corner. The readout says what it landed on.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      hashi=Forge.hashi,fbm=Forge.fbm,fbm2=Forge.fbm2,
      hex2rgb=Forge.hex2rgb,blurWrap=Forge.blurWrap,blurClamp=Forge.blurClamp;

const CUT={plate:1,slab:1};                    // which kinds are one cut-out piece

/* ============================ dimensions ============================ */
function geom(P,kind){
  const cut=!!CUT[kind];
  const Wm=Math.max(0.05,(cut?(+P.panWmm||1200):(+P.tileMm||2400))*0.001);
  const Hm=cut?Math.max(0.05,(+P.panHmm||800)*0.001):Wm;
  const asked=P.size|0;
  const thOf=t=>Math.max(8,Math.round(t*Hm/Wm/4)*4);
  const MAXTEX=32e6;
  let TW=asked;
  if(cut&&TW*thOf(TW)>MAXTEX)TW=Math.max(64,Math.round(TW*Math.sqrt(MAXTEX/(TW*thOf(TW)))/4)*4);
  return {cut:cut,Wm:Wm,Hm:Hm,TW:TW,TH:cut?thOf(TW):TW,asked:asked,capped:TW<asked};
}

/* What the chosen kind snaps to. Everything counted here divides its span
   exactly, which is what lets the sheet wrap and stops the plate finishing
   with three quarters of a rivet in one corner. */
function layout(P,g,kind){
  const L={};
  if(kind==="sheet"){
    L.prof=P.profile||"flat";
    if(L.prof!=="flat"){
      L.nR=Math.max(1,Math.round(g.Wm/Math.max(0.02,(+P.ribMm||150)*0.001)));
      L.rp=g.Wm/L.nR;
      L.ribH=(+P.ribHmm||28)*0.001;
    }
    L.nP=Math.max(1,Math.round(g.Hm/Math.max(0.15,(+P.purlinM||1.4))));
    L.pp=g.Hm/L.nP;                            // the purlin lines, where the screws are
    L.nSeam=P.seams|0;
  }else if(kind==="plate"){
    L.bevel=clamp((+P.bevelMm||9)*0.001,0.0005,Math.min(g.Wm,g.Hm)*0.12);
    L.inset=clamp((+P.rivetInMm||26)*0.001,L.bevel,Math.min(g.Wm,g.Hm)*0.3);
    const p=Math.max(0.006,(+P.rivetMm||46)*0.001);
    /* the perimeter run: rivets on all four sides, and the count on each side
       snapped so the corner rivets land exactly on the corners */
    L.nX=Math.max(1,Math.round((g.Wm-L.inset*2)/p));L.spX=(g.Wm-L.inset*2)/L.nX;
    L.nY=Math.max(1,Math.round((g.Hm-L.inset*2)/p));L.spY=(g.Hm-L.inset*2)/L.nY;
    L.rows=clamp(P.rivRows|0,0,6);L.cols=clamp(P.rivCols|0,0,6);
  }else{
    L.cham=clamp((+P.chamMm||20)*0.001,0.0005,Math.min(g.Wm,g.Hm)*0.10);
    L.form=P.form||"smooth";
    if(L.form==="board"){
      L.nB=Math.max(1,Math.round(g.Hm/Math.max(0.04,(+P.boardMm||150)*0.001)));
      L.bh=g.Hm/L.nB;
    }else if(L.form==="rib"){
      L.nB=Math.max(1,Math.round(g.Wm/Math.max(0.02,(+P.boardMm||150)*0.001)));
      L.bh=g.Wm/L.nB;
    }
    L.tieX=clamp(P.tieX|0,0,8);L.tieY=clamp(P.tieY|0,0,8);
  }
  return L;
}

/* ============================ the generator ============================ */

function build(params,io,kind){
  const P=params;
  const g=geom(P,kind),CUTP=g.cut;
  const SW=io.W,SH=io.H,N=SW*SH;
  const L=layout(P,g,kind);
  const T=g.Wm,M=1/T,MM=0.001/T;
  const mpp=T/SW,aa=mpp*0.7;
  const seed=P.seed|0;

  const A=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N);
  const MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N);
  const NRM=new Uint8ClampedArray(N*3);
  const HGT=new Float32Array(N);
  const ALP=new Uint8ClampedArray(N);
  if(!CUTP)ALP.fill(255);
  let hMin=0,hMax=1;

  const steelC=hex2rgb(P.cSteel||"#a8acb0");
  const paintC=hex2rgb(P.cPaint||"#4a6b74");
  const primC=hex2rgb(P.cPrimer||"#8a4b2c");
  const rustC=hex2rgb(P.cRust||"#7d4322");
  const concC=hex2rgb(P.cConc||"#a8a49c");
  const aggC=hex2rgb(P.cAgg||"#6f6a62");

  let Mr=0,Mg=0,Mb=0,Mh=0,Mrg=0.6,Mmet=0;

  /* -------------------------------------------------------------------------
     STEEL, PAINT AND THE RUST THAT GETS BETWEEN THEM

     Rust on a painted panel is not a stain, it is a sequence: the steel goes
     first, it swells as it does, the swelling lifts the paint, the paint
     flakes off and takes the primer with it, and the bare patch rusts faster
     than the rest. So the paint is not a layer over rust, it is a layer the
     rust has HOLES in — and the holes have a ring of exposed primer round
     them and a lifted lip of paint at the edge. That sequence, in that order,
     is nearly all of what makes a rusty panel read as rusty rather than as a
     brown texture.
     ------------------------------------------------------------------------- */
  function steel(u,v,shade){
    /* the rolled grain of hot-rolled plate, long in the rolling direction */
    const roll=fbm2(u,v,72,10,3,seed+11);
    const t=shade*(0.94+roll*0.14);
    Mr=steelC[0]*t;Mg=steelC[1]*t;Mb=steelC[2]*t;
    Mrg=clamp(0.44+(roll-0.5)*0.12,0.05,1);Mmet=0.92;Mh=0;
  }

  const RUST=clamp(+P.rust||0,0,1);
  const PAINT=clamp(+P.paint||0,0,1);
  function corrode(u,v,wet,key){
    /* three scales of bloom, because rust arrives as patches inside patches */
    const big=fbm(u,v,4,4,seed+17);
    const mid=fbm2(u,v,17,17,3,seed+19);
    const fine=fbm2(u,v,58,58,3,seed+23);
    let r=clamp((big*0.55+mid*0.32+fine*0.13)*1.9-0.72+wet*0.45,0,1);
    r=clamp(r*(0.35+RUST*1.5),0,1)*RUST;
    if(r<=0.002)return 0;

    /* scale: rust does not stay flush, it lifts off in plates */
    const scale=clamp(fine*1.6-0.55,0,1)*r;
    Mh+=scale*(+P.scaleMm||1.6)*MM;
    /* and where it has lifted furthest it has fallen off, leaving a pit */
    const pit=clamp(fbm2(u,v,110,110,2,seed+29)*1.7-1.05,0,1)*r;
    Mh-=pit*(+P.pitMm||1.1)*MM;

    const tone=0.78+fine*0.5;
    const rr=rustC[0]*tone,rg2=rustC[1]*tone,rb=rustC[2]*tone;
    Mr=lerp(Mr,rr,r);Mg=lerp(Mg,rg2,r);Mb=lerp(Mb,rb,r);
    Mrg=lerp(Mrg,clamp(0.90+scale*0.08,0,1),r);
    Mmet=lerp(Mmet,0.06,r*0.9);
    return r;
  }
  function paintOver(u,v,r,wet){
    if(PAINT<=0)return;
    /* the paint film survives where the rust has not reached, and its edge is
       a hard broken line rather than a fade — that hard edge is the tell */
    const chip=fbm2(u,v,40,40,3,seed+31);
    const hold=clamp((1-r*2.4)+(chip-0.5)*0.55-wet*0.3,0,1);
    /* HOW MUCH PAINT IS LEFT is a question about AREA, not about opacity. Used
       as a multiplier it made a half-painted panel uniformly half-painted —
       every texel part steel, so every texel half metallic, and a surface at
       0.5 metallic under one small sky is nearly black. It moves the threshold
       instead: at 1 the film survives everywhere the rust has not eaten, at 0
       there is none of it left anywhere, and in between it is present or it is
       not. */
    const th=lerp(1.14,0.06,PAINT);
    const film=smoothstep(th,th+0.14,hold);
    if(film<=0.004)return;
    const prim=smoothstep(th-0.16,th+0.02,hold);   // primer reaches further than the top coat
    Mr=lerp(Mr,primC[0]*0.95,clamp(prim-film,0,1));
    Mg=lerp(Mg,primC[1]*0.95,clamp(prim-film,0,1));
    Mb=lerp(Mb,primC[2]*0.95,clamp(prim-film,0,1));
    const t=0.94+fbm2(u,v,26,26,2,seed+37)*0.14;
    Mr=lerp(Mr,paintC[0]*t,film);Mg=lerp(Mg,paintC[1]*t,film);Mb=lerp(Mb,paintC[2]*t,film);
    Mrg=lerp(Mrg,clamp((+P.gloss!==undefined?1-(+P.gloss):0.45),0.05,1),film);
    Mmet=lerp(Mmet,0.03,film);
    /* the film has a thickness, and its broken edge stands proud of the steel */
    Mh+=film*0.35*MM;
    const edge=smoothstep(0.34,0.40,hold)*(1-smoothstep(0.40,0.48,hold))*PAINT;
    Mh+=edge*0.9*MM;
    Mr=lerp(Mr,Mr*1.18+10,edge*0.5);Mg=lerp(Mg,Mg*1.18+10,edge*0.5);Mb=lerp(Mb,Mb*1.16+9,edge*0.5);
  }

  /* ---------------------------------------------------------------------------
     SHEET — the rusted metal panel, seamless
     --------------------------------------------------------------------------- */
  function sheet(wx,wy,u,v){
    let profH=0,crown=1;
    if(L.prof==="corr"){
      const f=wx/L.rp-Math.floor(wx/L.rp);
      profH=(Math.cos(f*Math.PI*2)*-0.5+0.5)*L.ribH;      // valley at the pitch line
      crown=smoothstep(0.35,0.95,(profH/L.ribH));
    }else if(L.prof==="box"){
      const f=wx/L.rp-Math.floor(wx/L.rp);
      /* a trapezoid: flat valley, ramp, flat crown, ramp */
      const w=clamp(+P.ribTop||0.42,0.1,0.8),ramp=(1-w)*0.5*0.55;
      const up=smoothstep(ramp*0.5,ramp*0.5+ramp,f)*(1-smoothstep(1-ramp*1.5,1-ramp*0.5,f));
      profH=up*L.ribH;
      crown=up;
    }
    steel(u,v,0.92+crown*0.16);
    Mh=profH*M;
    /* water sits in the valleys and runs down the sheet, so the rust starts
       there and streaks below anything that sheds */
    const valley=1-crown;
    const streak=clamp(fbm2(u,v,26,4,3,seed+41)*1.5-0.42,0,1);
    const wet=clamp(valley*0.55+streak*0.5,0,1);
    const r=corrode(u,v,wet,0);
    paintOver(u,v,r,wet);

    /* the fixings: one screw per crown per purlin line */
    if(P.screws){
      const py=(Math.floor(wy/L.pp)+0.5)*L.pp;
      const px=L.prof==="flat"
        ?(Math.floor(wx/Math.max(0.15,(+P.screwMm||300)*0.001))+0.5)*Math.max(0.15,(+P.screwMm||300)*0.001)
        :(Math.floor(wx/L.rp)+((L.prof==="corr")?0.5:0.5))*L.rp;
      const dx=wx-px,dy=wy-py,d=Math.sqrt(dx*dx+dy*dy);
      const hr=Math.max(aa*2.2,(+P.screwDMm||9)*0.0005);
      if(d<hr*2.1){
        const wash=1-smoothstep(hr*1.75,hr*2.1,d);
        const hd=1-smoothstep(hr*0.9,hr*1.05,d);
        steel(u,v,1.0+hd*0.12);
        Mh=profH*M+lerp(0.3,1.9,hd)*MM*wash;
        /* the neoprene washer squashed under it, and the rust weeping from it */
        if(hd<0.5&&wash>0.5){Mr*=0.55;Mg*=0.55;Mb*=0.56;Mrg=0.9;Mmet=0.1;}
        const weep=clamp(fbm2(u,v,60,14,2,seed+43),0,1)*RUST;
        Mr=lerp(Mr,rustC[0],weep*0.5);Mg=lerp(Mg,rustC[1],weep*0.5);Mb=lerp(Mb,rustC[2],weep*0.45);
      }
    }
    /* welded or lapped seams across the sheet */
    if(L.nSeam>0){
      const sp=g.Hm/L.nSeam;
      const k=Math.round(wy/sp);
      const dy=Math.abs(wy-k*sp);
      const bw=Math.max(aa*2,(+P.seamMm||18)*0.001);
      if(dy<bw){
        const t=dy/bw;
        /* a weld bead is a row of overlapping ripples, not a smooth sausage */
        const rip=Math.abs(Math.sin(wx/Math.max(0.004,(+P.seamMm||18)*0.0008)));
        steel(u,v,1.06-t*0.2);
        Mh+=Math.cos(t*Math.PI*0.5)*(bw*0.55*M)*(0.75+rip*0.35);
        Mrg=clamp(Mrg+0.16,0,1);
        const r2=corrode(u,v,0.55,0);
        paintOver(u,v,r2,0.55);
      }
    }
  }

  /* ---------------------------------------------------------------------------
     PLATE — one riveted metal panel, cut out
     --------------------------------------------------------------------------- */
  function plate(wx,wy,u,v){
    const dE=Math.min(Math.min(wx,g.Wm-wx),Math.min(wy,g.Hm-wy));
    steel(u,v,1.0);
    /* the plate has a thickness, and the bevel round it is the only place you
       ever see it — without one the piece reads as a decal */
    const bev=clamp(dE/L.bevel,0,1);
    Mh=lerp(-(+P.thickMm||4)*MM*0.75,0,smoothstep(0,1,bev));
    if(bev<1){
      const k=1-bev;
      Mr*=1-k*0.34;Mg*=1-k*0.34;Mb*=1-k*0.33;
      Mrg=clamp(Mrg+k*0.10,0,1);
    }
    /* the lap: one edge steps up over the plate beside it */
    if(P.lap!=="none"){
      const lw=clamp((+P.lapMm||70)*0.001,0.002,Math.min(g.Wm,g.Hm)*0.4);
      const d=(P.lap==="left")?wx:(P.lap==="top")?(g.Hm-wy):(P.lap==="right")?(g.Wm-wx):wy;
      if(d<lw){
        const t=smoothstep(lw-Math.max(aa*2,lw*0.06),lw,d);
        Mh+=(1-t)*(+P.thickMm||4)*MM;
        Mr*=1-(1-t)*0.06;Mg*=1-(1-t)*0.06;Mb*=1-(1-t)*0.06;
      }
    }
    /* the swage: a pressed stiffening bead run round inside the rivet line */
    if(P.swage){
      const sw=clamp((+P.swageMm||18)*0.001,0.001,0.2);
      const si=L.inset+clamp((+P.swageInMm||60)*0.001,0.004,Math.min(g.Wm,g.Hm)*0.35);
      const d=Math.abs(dE-si);
      if(d<sw){
        const t=d/sw;
        const bump=Math.cos(t*Math.PI*0.5);
        Mh+=bump*(+P.swageHmm||3)*MM;
        Mr=lerp(Mr,Mr*1.10+6,bump*0.4);Mg=lerp(Mg,Mg*1.10+6,bump*0.4);Mb=lerp(Mb,Mb*1.09+6,bump*0.4);
      }
    }

    /* ---- the rivets ---- */
    let onRivet=0,rivD=1e9,rivX=0,rivY=0;
    const rr=Math.max(aa*1.6,(+P.rivetDmm||11)*0.0005);
    const type=P.rivetType||"dome";
    const tryRivet=(px,py)=>{
      const dx=wx-px,dy=wy-py,d=Math.sqrt(dx*dx+dy*dy);
      if(d<rivD){rivD=d;rivX=dx;rivY=dy;}
    };
    /* the perimeter run */
    for(let k=0;k<=L.nX;k++){
      const px=L.inset+k*L.spX;
      if(Math.abs(wx-px)<rr*2.2){tryRivet(px,L.inset);tryRivet(px,g.Hm-L.inset);}
    }
    for(let k=0;k<=L.nY;k++){
      const py=L.inset+k*L.spY;
      if(Math.abs(wy-py)<rr*2.2){tryRivet(L.inset,py);tryRivet(g.Wm-L.inset,py);}
    }
    /* and the interior lines that divide a big plate up */
    for(let c=1;c<=L.cols;c++){
      const px=g.Wm*c/(L.cols+1);
      if(Math.abs(wx-px)<rr*2.2)
        for(let k=0;k<=L.nY;k++)tryRivet(px,L.inset+k*L.spY);
    }
    for(let c=1;c<=L.rows;c++){
      const py=g.Hm*c/(L.rows+1);
      if(Math.abs(wy-py)<rr*2.2)
        for(let k=0;k<=L.nX;k++)tryRivet(L.inset+k*L.spX,py);
    }
    if(rivD<rr*1.45){
      /* A hex bolt is not a circle. Measured from the head's centre, the
         boundary of a hexagon of inradius R sits at R/cos(θ mod 60° − 30°),
         so dividing the distance by that same cosine turns the round profile
         below into a hexagonal one without any extra branching. */
      let t=clamp(rivD/rr,0,1);
      if(type==="hex"){
        const s60=Math.PI/3;
        const a=Math.atan2(rivY,rivX);
        t=clamp(rivD*Math.cos(((a%s60)+s60)%s60-s60*0.5)/(rr*0.866),0,1.4);
      }
      onRivet=1-smoothstep(0.94,1.06,t);
      const base=Mh;
      steel(u,v,1.06);
      if(type==="dome")Mh=base+Math.sqrt(Math.max(0,1-t*t))*rr*0.62*M*onRivet;
      else if(type==="csk")Mh=base-lerp(rr*0.30*M,0,smoothstep(0,1,t))*onRivet;
      else if(type==="hex")Mh=base+rr*0.50*M*onRivet;
      else Mh=base+rr*0.18*M*onRivet;
      /* the ring of bruised, bare metal the gun left round every head */
      const halo=1-smoothstep(rr*1.0,rr*1.45,rivD);
      Mr=lerp(Mr,Mr*1.06+8,halo*0.4);Mg=lerp(Mg,Mg*1.06+8,halo*0.4);Mb=lerp(Mb,Mb*1.05+7,halo*0.4);
      Mrg=clamp(Mrg-onRivet*0.08,0.05,1);
    }

    /* rust and paint over the lot, but the fasteners and the arris go first,
       because that is where water sits and where a knock takes the film off */
    const wet=clamp((1-smoothstep(0,L.bevel*3,dE))*0.6
                   +(rivD<rr*2.4?(1-rivD/(rr*2.4))*0.55:0),0,1);
    const r=corrode(u,v,wet,0);
    paintOver(u,v,r,wet+onRivet*0.4);
  }

  /* ---------------------------------------------------------------------------
     SLAB — one precast concrete panel, cut out
     --------------------------------------------------------------------------- */
  function concrete(u,v,shade){
    /* the paste, and the aggregate showing through it */
    const paste=fbm2(u,v,30,30,4,seed+53);
    const t=shade*(0.90+paste*0.20);
    Mr=concC[0]*t;Mg=concC[1]*t;Mb=concC[2]*t;
    Mrg=clamp(0.88+(paste-0.5)*0.10,0.05,1);Mmet=0;
  }
  function slab(wx,wy,u,v){
    const dE=Math.min(Math.min(wx,g.Wm-wx),Math.min(wy,g.Hm-wy));
    concrete(u,v,1.0);
    /* the chamfered arris: cast panels are never left with a sharp corner,
       because a sharp corner in concrete does not survive being lifted */
    const ch=clamp(dE/L.cham,0,1);
    Mh=lerp(-L.cham*0.75*M,0,smoothstep(0,1,ch));
    if(ch<1){
      const k=1-ch;
      Mr*=1-k*0.20;Mg*=1-k*0.20;Mb*=1-k*0.19;
      /* and the arris is the first thing to chip */
      const nick=clamp(fbm2(u,v,90,90,3,seed+59)*1.8-0.9,0,1)*k*(+P.spall||0);
      if(nick>0){
        Mh-=nick*(+P.spallMm||9)*MM;
        Mr=lerp(Mr,Mr*1.16+18,nick*0.7);Mg=lerp(Mg,Mg*1.14+16,nick*0.7);Mb=lerp(Mb,Mb*1.12+14,nick*0.7);
      }
    }

    /* the form finish */
    if(L.form==="board"){
      /* sawn boards leave their own grain, their thickness and the step
         between one board and the next */
      const k=Math.floor(wy/L.bh),f=wy/L.bh-k;
      const grain=fbm2(u,v,10,150,3,seed+61+k*13);
      const tone=0.95+hashi(k,3,seed+67)*0.10;
      Mr*=tone*(0.96+grain*0.09);Mg*=tone*(0.96+grain*0.09);Mb*=tone*(0.96+grain*0.09);
      Mh+=(grain-0.5)*1.1*MM+((hashi(k,7,seed+71)-0.5)*0.9)*MM;
      const joint=1-smoothstep(0,Math.max(aa*1.6,L.bh*0.02),Math.min(f,1-f)*L.bh);
      Mh-=joint*2.2*MM;
      Mr*=1-joint*0.20;Mg*=1-joint*0.20;Mb*=1-joint*0.19;
    }else if(L.form==="rib"){
      const f=wx/L.bh-Math.floor(wx/L.bh);
      const prof=Math.sin(clamp(f,0,1)*Math.PI);
      Mh+=prof*(+P.ribDmm||16)*MM;
      Mr*=0.94+prof*0.14;Mg*=0.94+prof*0.14;Mb*=0.94+prof*0.13;
      const gap=1-smoothstep(0,Math.max(aa*1.6,L.bh*0.03),Math.min(f,1-f)*L.bh);
      Mr*=1-gap*0.26;Mg*=1-gap*0.26;Mb*=1-gap*0.25;
    }else if(L.form==="agg"){
      /* exposed aggregate: the paste washed off the face, stones standing out */
      const cell=fbm2(u,v,44,44,2,seed+73);
      const st=clamp(cell*2.2-0.95,0,1);
      if(st>0){
        Mh+=st*(+P.aggMm||4)*MM;
        const tone=0.8+fbm2(u,v,140,140,2,seed+79)*0.5;
        Mr=lerp(Mr,aggC[0]*tone,st*0.9);Mg=lerp(Mg,aggC[1]*tone,st*0.9);Mb=lerp(Mb,aggC[2]*tone,st*0.9);
        Mrg=lerp(Mrg,0.62,st*0.7);
      }
    }

    /* BLOWHOLES. Air trapped against the formwork leaves little round craters
       all over a cast face. They are the single detail that says "this was
       poured" rather than "this was modelled", and they are small enough that
       they only ever show up in the height and the AO. */
    const bh=clamp(+P.voids||0,0,1);
    if(bh>0){
      const sp=Math.max(0.008,(+P.voidMm||26)*0.001);
      const ci=Math.floor(wx/sp),cj=Math.floor(wy/sp);
      for(let dy2=-1;dy2<=0;dy2++)for(let dx2=-1;dx2<=0;dx2++){
        const i2=ci+dx2,j2=cj+dy2;
        const hx=hashi(i2*7,j2*13,seed+83),hy=hashi(i2*11,j2*17,seed+89);
        const hs=hashi(i2*19,j2*23,seed+97);
        if(hs>1-bh*0.55){
          const px=(i2+hx*0.9+0.05)*sp,py=(j2+hy*0.9+0.05)*sp;
          const r2=sp*(0.10+hs*0.22)*bh;
          const d=Math.sqrt((wx-px)*(wx-px)+(wy-py)*(wy-py));
          if(d<r2){
            const k=Math.sqrt(1-(d/r2)*(d/r2));
            Mh-=k*r2*0.9*M;
            Mr*=1-k*0.22;Mg*=1-k*0.22;Mb*=1-k*0.21;
            Mrg=clamp(Mrg+k*0.06,0,1);
          }
        }
      }
    }

    /* FORM TIES. The formwork is held apart by ties through the pour, and
       every one leaves a cone-shaped recess, later filled with mortar that
       never quite matches — and stained below, because it never quite seals. */
    let tieWet=0;
    if(L.tieX>0&&L.tieY>0){
      const sx=g.Wm/(L.tieX+1),sy=g.Hm/(L.tieY+1);
      const i2=clamp(Math.round(wx/sx),1,L.tieX),j2=clamp(Math.round(wy/sy),1,L.tieY);
      const px=i2*sx,py=j2*sy;
      const d=Math.sqrt((wx-px)*(wx-px)+(wy-py)*(wy-py));
      const r2=Math.max(aa*2,(+P.tieDmm||30)*0.0005);
      if(d<r2*1.2){
        const t=clamp(d/r2,0,1);
        const filled=hashi(i2,j2,seed+101)>0.35;
        Mh-=lerp(r2*0.55,0,smoothstep(0,1,t))*M*(filled?0.35:1);
        const tone=filled?1.10:0.72;
        Mr*=tone;Mg*=tone;Mb*=tone;
        Mrg=clamp(Mrg+(filled?0.03:0.06),0,1);
      }
      /* the streak below it */
      if(wy<py&&Math.abs(wx-px)<r2*2.4){
        const run=Math.exp(-(py-wy)/Math.max(0.02,(+P.stainM||0.55)));
        tieWet=run*(1-Math.abs(wx-px)/(r2*2.4));
      }
    }

    /* the lifting sockets, near the top, where the crane hooked on */
    if(P.lifts){
      const ly=g.Hm*0.86;
      for(let s=0;s<2;s++){
        const lx=g.Wm*(s?0.75:0.25);
        const d=Math.sqrt((wx-lx)*(wx-lx)+(wy-ly)*(wy-ly));
        const r2=Math.max(aa*2.5,(+P.liftDmm||70)*0.0005);
        if(d<r2){
          const t=d/r2;
          Mh-=lerp(r2*0.9,0,smoothstep(0.55,1,t))*M;
          Mr*=0.66+t*0.24;Mg*=0.66+t*0.24;Mb*=0.66+t*0.24;
          if(t<0.42){                              // the galvanised ferrule in it
            Mr=142;Mg=146;Mb=150;Mrg=0.55;Mmet=0.75;
          }
        }
      }
    }

    /* cracks, and the rebar behind the ones that have opened up */
    const CR=clamp(+P.crack||0,0,1);
    if(CR>0){
      const n=fbm(u,v,5,4,seed+103);
      const ridge=1-Math.abs(n-0.5)*2;
      const cr=smoothstep(0.955-CR*0.06,0.998,ridge)*CR;
      if(cr>0){
        Mh-=cr*2.6*MM;
        Mr*=1-cr*0.45;Mg*=1-cr*0.45;Mb*=1-cr*0.43;
        Mrg=clamp(Mrg+cr*0.06,0,1);
        /* a crack this size on a precast panel is a corroding bar underneath,
           and the rust comes out of it before the concrete comes off */
        const stain=clamp(cr*1.6+fbm2(u,v,50,12,2,seed+107)*0.5-0.25,0,1)*CR;
        Mr=lerp(Mr,150,stain*0.45);Mg=lerp(Mg,96,stain*0.45);Mb=lerp(Mb,60,stain*0.4);
      }
    }

    /* what runs down the face: dirt from the top edge, efflorescence out of
       the pour, and whatever the ties are weeping */
    const top=1-smoothstep(0,Math.max(0.03,(+P.stainM||0.55)),g.Hm-wy);
    const col=fbm2(u,v,30,5,3,seed+109);
    const dirt=clamp((top*1.3+tieWet*1.2)*(col*1.5-0.3),0,1)*(+P.stain||0);
    Mr=lerp(Mr,Mr*0.60+8,dirt*0.8);Mg=lerp(Mg,Mg*0.60+8,dirt*0.8);Mb=lerp(Mb,Mb*0.58+8,dirt*0.8);
    Mrg=lerp(Mrg,0.95,dirt*0.5);
    const eff=clamp(fbm(u,v,9,4,seed+113)*1.6-0.78,0,1)*(+P.effl||0);
    Mr=lerp(Mr,224,eff*0.7);Mg=lerp(Mg,221,eff*0.7);Mb=lerp(Mb,212,eff*0.65);
    Mrg=lerp(Mrg,0.97,eff);
    /* and the green that grows at the bottom of anything that stays damp */
    const moss=clamp((1-smoothstep(0,Math.max(0.02,(+P.mossM||0.3)),wy))
                     *(fbm2(u,v,24,24,3,seed+127)*1.6-0.45),0,1)*(+P.moss||0);
    Mr=lerp(Mr,62,moss*0.75);Mg=lerp(Mg,78,moss*0.75);Mb=lerp(Mb,48,moss*0.7);
    Mrg=lerp(Mrg,0.97,moss);
  }

  /* ============================ the loops ============================ */
  const rad=CUTP?clamp((+P.cornerMm||0)*0.001,0,Math.min(g.Wm,g.Hm)*0.45):0;
  const band=Math.max(4,Math.round(65536/SW));
  let y=0;

  function pass1(){
    const end=Math.min(SH,y+band);
    for(;y<end;y++){
      const v=(y+0.5)/SH,wy=(1-v)*g.Hm;
      for(let x=0;x<SW;x++){
        const u=(x+0.5)/SW,wx=u*g.Wm,i=y*SW+x;
        if(CUTP){
          /* Signed distance to the silhouette, NEGATIVE inside. It started at
             zero, which is not "well inside" — it is exactly the edge, and
             with a corner radius of zero nothing ever moved it, so the
             smoothstep below evaluated at the middle of its own antialiasing
             band and handed every texel on the panel an alpha of 0.32. A
             square panel came out a third transparent and rendered as a dim
             ghost of itself over the backdrop. */
          let out=-1;
          if(rad>0){
            const qx=Math.max(rad-Math.min(wx,g.Wm-wx),0),qy=Math.max(rad-Math.min(wy,g.Hm-wy),0);
            out=Math.sqrt(qx*qx+qy*qy)-rad;
          }
          const a=1-smoothstep(-aa,aa*0.6,out);
          ALP[i]=clamp(a,0,1)*255;
          if(a<0.02){
            HGT[i]=0;RGH[i]=200;AOc[i]=255;MET[i]=0;A[i*3]=A[i*3+1]=A[i*3+2]=0;
            continue;
          }
        }
        Mh=0;
        if(kind==="sheet")sheet(wx,wy,u,v);
        else if(kind==="plate")plate(wx,wy,u,v);
        else slab(wx,wy,u,v);

        HGT[i]=Mh;
        A[i*3]=Mr;A[i*3+1]=Mg;A[i*3+2]=Mb;
        RGH[i]=clamp(Mrg,0.03,1)*255;
        MET[i]=clamp(Mmet,0,1)*255;
        AOc[i]=255;
      }
    }
    if(y<SH){io.progress(y/SH*0.72);setTimeout(pass1,0);}
    else{io.progress(0.76);setTimeout(pass2,0);}
  }

  function pass2(){
    const pxPerM=SW/T;
    const rCap=Math.max(4,Math.min(SW,SH)>>2);
    const rOf=m=>clamp(Math.round(pxPerM*m),1,rCap);
    const feat=(kind==="sheet")?(L.prof==="flat"?0.05:L.rp*0.5)
              :(kind==="plate")?Math.max(0.02,L.bevel*3)
              :Math.max(0.02,L.cham*2.5);
    /* WHAT COUNTS AS FULLY OCCLUDED. Scaled against a fraction of the relief,
       the largest feature on the panel saturates the term: a corrugation
       trough or a rib valley came back at AO 0.15, which is a hole rather
       than a groove. The reference is the whole span of relief, and then some
       — a valley in the profile shades, it does not go black. The profile's
       own shading is the normal map's job. */
    const span=Math.max(1e-6,(hRange()||0.004));
    const sc=1/Math.max(1e-7,span*1.1);
    const blur=CUTP?((src,r)=>blurClamp(src,SW,SH,r)):((src,r)=>blurWrap(src,SW,r));
    let acc=new Float32Array(N);acc.fill(1);
    const fold=(r,gain,w)=>{
      let bb=blur(HGT,r);
      for(let i=0;i<N;i++){
        if(!ALP[i])continue;
        acc[i]*=(1-clamp((bb[i]-HGT[i])*sc*gain,0,1)*w);
      }
      bb=null;
    };
    fold(rOf(feat*0.25),1.5,0.45);
    fold(rOf(feat),1.0,0.60);
    fold(rOf(feat*3.2),0.7,0.55);
    for(let i=0;i<N;i++){
      if(!ALP[i]){AOc[i]=255;continue;}
      AOc[i]=clamp(1-Math.min(1-acc[i],0.80)*(+P.aoStr),0,1)*255;
    }
    acc=null;
    io.progress(0.9);

    hMin=Infinity;hMax=-Infinity;
    for(let i=0;i<N;i++){if(!ALP[i])continue;const h=HGT[i];if(h<hMin)hMin=h;if(h>hMax)hMax=h;}
    if(!isFinite(hMin)){hMin=0;hMax=1;}
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;

    const gy=P.flipG?-1:1;
    const wrapX=CUTP?(x=>x<0?0:(x>=SW?SW-1:x)):(x=>(x+SW)%SW);
    const wrapY=CUTP?(yy=>yy<0?0:(yy>=SH?SH-1:yy)):(yy=>(yy+SH)%SH);
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
    io.done({A:A,RGH:RGH,MET:MET,AO:AOc,NRM:NRM,HGT:HGT,ALP:ALP,hMin:hMin,hMax:hMax});
  }

  /* the height span the AO scales against, sampled rather than measured — pass2
     needs it before it has walked the field, and a coarse sample is enough */
  function hRange(){
    let lo=Infinity,hi=-Infinity;
    const step=Math.max(1,Math.floor(N/40000));
    for(let i=0;i<N;i+=step){if(!ALP[i])continue;const h=HGT[i];if(h<lo)lo=h;if(h>hi)hi=h;}
    return isFinite(lo)?Math.max(hi-lo,1e-5):0.004;
  }

  io.progress(0.02);
  setTimeout(pass1,0);
}

/* ============================ shared control blocks ============================ */

const mapRows={title:"Maps",rows:[
  {id:"normalStr",label:"Normal strength",min:0.1,max:3,step:0.05,value:1},
  {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:1},
  {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
]};
const CHANNELS=[
  {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
  {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
  {key:"ao",label:"AO"},{key:"height",label:"Height"},{key:"orm",label:"ORM packed"},
  {key:"opacity",label:"Opacity"}
];
const corrosionRows=[
  {id:"rust",label:"Rust",min:0,max:1,step:0.01,value:0.5},
  {id:"scaleMm",label:"Scale lift",unit:"mm",min:0,max:8,step:0.1,value:1.6},
  {id:"pitMm",label:"Pitting depth",unit:"mm",min:0,max:8,step:0.1,value:1.1},
  {id:"paint",label:"Paint still on it",min:0,max:1,step:0.01,value:0.55},
  {id:"gloss",label:"Paint gloss",min:0,max:1,step:0.01,value:0.45},
  {type:"colors",label:"Steel · paint · primer · rust",items:[
    {id:"cSteel",value:"#a8acb0"},{id:"cPaint",value:"#4a6b74"},
    {id:"cPrimer",value:"#8a4b2c"},{id:"cRust",value:"#7d4322"}]}
];

function sizeRowsCut(defW,defH){
  return [
    {id:"size",type:"select",label:"Texture width",value:1024,showValue:true,options:Forge.sizes("plain")},
    {id:"panWmm",label:"Panel width",unit:"mm",min:80,max:6000,step:10,value:defW},
    {id:"panHmm",label:"Panel height",unit:"mm",min:80,max:6000,step:10,value:defH},
    {id:"cornerMm",label:"Corner radius",unit:"mm",min:0,max:900,step:5,value:0},
    {type:"readout"},
    {id:"seed",type:"seed",value:3140}
  ];
}

function readoutFor(kind){
  return function(P){
    const g=geom(P,kind),L=layout(P,g,kind);
    const pxPerM=g.TW/g.Wm;
    let m="<b>"+(g.Wm*1000).toFixed(0)+" × "+(g.Hm*1000).toFixed(0)+" mm</b> · "+
          g.TW+" × "+g.TH+" px<br><b>"+(1000/pxPerM).toFixed(2)+" mm per texel</b>";
    if(g.capped)m+='<br><span class="warn">capped from '+g.asked+
      ' px — this panel is '+(g.Hm/g.Wm).toFixed(1)+'× its own width and the full size '+
      'would not fit in memory</span>';
    if(kind==="sheet"){
      if(L.prof!=="flat")m+="<br><b>"+L.nR+" ribs</b> snapped to "+(L.rp*1000).toFixed(0)+
        " mm pitch, "+(+P.ribHmm||28)+" mm deep";
      else m+="<br>flat sheet";
      m+="<br>purlin lines every <b>"+L.pp.toFixed(2)+" m</b> ("+L.nP+" across the tile)";
      if(L.nSeam>0)m+="<br>"+L.nSeam+" welded "+(L.nSeam===1?"seam":"seams");
    }else if(kind==="plate"){
      m+="<br>rivets: <b>"+(L.nX+1)+" across × "+(L.nY+1)+" down</b> the perimeter at "+
         (L.spX*1000).toFixed(0)+" / "+(L.spY*1000).toFixed(0)+" mm";
      if(L.rows||L.cols)m+=", plus "+L.rows+" interior rows and "+L.cols+" columns";
      const rp=Math.max(1,(+P.rivetDmm||11))*0.001*pxPerM;
      if(rp<3)m+='<br><span class="warn">a rivet head is '+rp.toFixed(1)+
        ' px — raise the resolution or it will read as a dot of noise</span>';
    }else{
      m+="<br>"+(L.form==="board"?L.nB+" boards of "+(L.bh*1000).toFixed(0)+" mm"
        :L.form==="rib"?L.nB+" ribs of "+(L.bh*1000).toFixed(0)+" mm"
        :L.form==="agg"?"exposed aggregate":"smooth form finish");
      m+="<br>"+(L.tieX*L.tieY)+" form ties"+(P.lifts?", two lifting sockets":"");
      const cp=(+P.chamMm||20)*0.001*pxPerM;
      if(cp<2)m+='<br><span class="warn">the chamfer is '+cp.toFixed(1)+
        ' px — the arris will not read</span>';
    }
    return m;
  };
}

/* ============================ SHEET ============================ */
Forge.register({
  id:"sheet",
  label:"Sheet",
  group:"Panels",
  blurb:"Rusted metal sheet — flat, corrugated or box profile, seamless",
  title:'Rusted <em>Sheet</em>',
  tagline:"Steel sheet · paint failing over rust · fixings · seamless",
  actionLabel:"Roll the sheet",
  busyLabel:"Rolling…",
  seamless:true,
  previewSize:256,
  flipPreviewY:true,
  preview:{gain:3.0,amb:1.10,specK:0.55,skyLo:[0.16,0.19,0.23],skyHi:[0.34,0.38,0.44]},
  channels:CHANNELS,

  presets:[
    {id:"barn",label:"Corrugated barn",set:{
      profile:"corr",tileMm:2400,ribMm:150,ribHmm:28,purlinM:1.4,screws:true,screwDMm:9,
      seams:0,rust:.55,scaleMm:1.6,pitMm:1.1,paint:.15,gloss:.6,
      cSteel:"#a8acb0",cPaint:"#6b7a6a",cPrimer:"#8a4b2c",cRust:"#7d4322"}},
    {id:"box",label:"Box profile — painted",set:{
      profile:"box",tileMm:2400,ribMm:333,ribHmm:34,ribTop:.42,purlinM:1.8,screws:true,screwDMm:10,
      seams:0,rust:.18,scaleMm:1.0,pitMm:0.6,paint:.9,gloss:.35,
      cSteel:"#a8acb0",cPaint:"#3f5f6b",cPrimer:"#8a4b2c",cRust:"#7d4322"}},
    {id:"tank",label:"Welded tank plate",set:{
      profile:"flat",tileMm:3000,purlinM:3,screws:false,seams:3,seamMm:22,
      rust:.7,scaleMm:2.4,pitMm:1.8,paint:.35,gloss:.3,
      cSteel:"#a0a4a8",cPaint:"#5a5f52",cPrimer:"#8a4b2c",cRust:"#7a4020"}},
    {id:"derelict",label:"Derelict shed",set:{
      profile:"corr",tileMm:2000,ribMm:130,ribHmm:24,purlinM:1.2,screws:true,screwDMm:9,
      seams:0,rust:.95,scaleMm:3.2,pitMm:2.6,paint:.06,gloss:.7,
      cSteel:"#9ba0a4",cPaint:"#7a6f52",cPrimer:"#8a4b2c",cRust:"#6f3a1c"}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:Forge.sizes("square")},
      {id:"tileMm",label:"Tile covers",unit:"mm",min:300,max:8000,step:50,value:2400},
      {type:"readout"},
      {id:"seed",type:"seed",value:3140}
    ]},
    {title:"Profile",open:true,rows:[
      {id:"profile",type:"select",label:"Section",value:"corr",options:[
        ["flat","Flat sheet"],["corr","Corrugated"],["box","Box / trapezoidal"]]},
      {id:"ribMm",need:"prof",label:"Rib pitch",unit:"mm",min:30,max:900,step:5,value:150},
      {id:"ribHmm",need:"prof",label:"Rib depth",unit:"mm",min:3,max:120,step:1,value:28},
      {id:"ribTop",need:"box",label:"Crown width",min:0.1,max:0.8,step:0.01,value:0.42},
      {id:"seams",label:"Welded seams",min:0,max:6,step:1,value:0},
      {id:"seamMm",need:"seam",label:"Weld bead",unit:"mm",min:4,max:80,step:1,value:18}
    ]},
    {title:"Fixings",open:true,rows:[
      {type:"checks",items:[{id:"screws",label:"Fixings on every purlin line",value:true}]},
      {id:"purlinM",need:"screw",label:"Purlin spacing",unit:"m",min:0.3,max:6,step:0.05,value:1.4},
      {id:"screwDMm",need:"screw",label:"Washer diameter",unit:"mm",min:4,max:40,step:1,value:9},
      {id:"screwMm",need:"screwflat",label:"Fixing spacing across",unit:"mm",min:80,max:1200,step:10,value:300},
      {type:"note",need:"screw",html:"A profiled sheet is fixed through the <b>crown</b>, one screw "+
        "per rib per purlin, with a bonded washer under the head. That grid is most of what "+
        "makes a metal roof read as a metal roof rather than as ribbed plastic."}
    ]},
    {title:"Corrosion",open:true,rows:corrosionRows},
    mapRows
  ],

  needs:function(P){
    const n=[];
    if((P.profile||"corr")!=="flat")n.push("prof");
    if(P.profile==="box")n.push("box");
    if((P.seams|0)>0)n.push("seam");
    if(P.screws){n.push("screw");if((P.profile||"corr")==="flat")n.push("screwflat");}
    return n;
  },
  readout:readoutFor("sheet"),
  tileTag:function(){return "tiles ↔ and ↕";},
  sizeTag:function(P){return (P.profile||"corr")+" · "+(+P.tileMm||2400)+" mm";},
  size:function(P){const g=geom(P,"sheet");return {w:g.TW,h:g.TH};},
  build:function(P,io){return build(P,io,"sheet");},
  plan:function(P){const g=geom(P,"sheet");return {w:g.Wm,h:g.Hm,cutout:false};},
  fileBase:function(P,W){return "sheet_"+(P.profile||"corr")+"_"+(P.seed|0)+"_"+W;},
  readme:function(P,info){
    const g=geom(P,"sheet"),L=layout(P,g,"sheet");
    return ["Texture Forge · sheet — rusted metal sheet",
      "",
      "Seed "+(P.seed|0)+"   Resolution "+info.W+"x"+info.H+"   Seamless in both axes",
      "Tile covers "+(g.Wm*1000).toFixed(0)+" mm square — one texel is "+
        (g.Wm/info.W*1000).toFixed(2)+" mm.",
      "",
      L.prof==="flat"?"Flat sheet."
        :(L.nR+" ribs at "+(L.rp*1000).toFixed(0)+" mm pitch, "+(+P.ribHmm||28)+" mm deep."),
      "",
      "The paint is modelled as a film with HOLES in it rather than as a layer over rust:",
      "the steel corrodes first, the swelling lifts the film, the film breaks away and takes",
      "the primer with it. That is why the paint edges are hard and stand a little proud.",
      "",
      "basecolor.png  sRGB albedo. Import as sRGB.",
      "normal.png     Tangent space, "+info.normalNote+". Non-colour.",
      "roughness.png  Linear grey.",
      "metallic.png   Linear grey — bare steel reads near 1, rust and paint near 0.",
      "ao.png         Linear grey.",
      "height.png     8-bit, spanning "+((info.hMax-info.hMin)*g.Wm*1000).toFixed(1)+" mm of relief.",
      "height16.png   The same at 16 bits — use this one if the profile is displaced.",
      "orm.png        R = AO, G = roughness, B = metallic.",
      "opacity.png    Flat white; the sheet has no silhouette.",
      "",
      "Normal strength baked at "+(+P.normalStr).toFixed(2)+"x."].join("\n");
  }
});

/* ============================ PLATE ============================ */
Forge.register({
  id:"plate",
  label:"Plate",
  group:"Panels",
  blurb:"One riveted metal panel, cut out — bevelled edge, snapped rivet run",
  title:'Riveted <em>Plate</em>',
  tagline:"One panel · bevelled edge · rivets · swage · alpha silhouette",
  actionLabel:"Set the rivets",
  busyLabel:"Riveting…",
  seamless:false,
  backdrops:true,
  flipPreviewY:true,
  previewSize:224,
  preview:{gain:3.0,amb:1.10,specK:0.5,skyLo:[0.16,0.19,0.23],skyHi:[0.34,0.38,0.44]},
  channels:CHANNELS,

  presets:[
    {id:"hull",label:"Hull plate",set:{
      panWmm:1200,panHmm:800,cornerMm:0,thickMm:5,bevelMm:9,
      rivetMm:46,rivetInMm:26,rivetDmm:11,rivetType:"dome",rivRows:0,rivCols:0,
      swage:false,lap:"left",lapMm:70,
      rust:.35,scaleMm:1.4,pitMm:0.9,paint:.7,gloss:.4,
      cSteel:"#a8acb0",cPaint:"#4a6b74",cPrimer:"#8a4b2c",cRust:"#7d4322"}},
    {id:"access",label:"Access panel",set:{
      panWmm:600,panHmm:420,cornerMm:40,thickMm:3,bevelMm:5,
      rivetMm:70,rivetInMm:22,rivetDmm:9,rivetType:"csk",rivRows:0,rivCols:0,
      swage:true,swageMm:16,swageInMm:44,swageHmm:2.5,lap:"none",
      rust:.12,scaleMm:0.6,pitMm:0.4,paint:.92,gloss:.3,
      cSteel:"#b2b7bb",cPaint:"#6b7076",cPrimer:"#8a4b2c",cRust:"#7d4322"}},
    {id:"bulk",label:"Bulkhead — bolted",set:{
      panWmm:2000,panHmm:1400,cornerMm:0,thickMm:8,bevelMm:14,
      rivetMm:110,rivetInMm:50,rivetDmm:22,rivetType:"hex",rivRows:1,rivCols:1,
      swage:true,swageMm:26,swageInMm:90,swageHmm:5,lap:"none",
      rust:.5,scaleMm:2.2,pitMm:1.6,paint:.45,gloss:.35,
      cSteel:"#a0a4a8",cPaint:"#54604f",cPrimer:"#8a4b2c",cRust:"#7a4020"}},
    {id:"wreck",label:"Wreck plate",set:{
      panWmm:1500,panHmm:900,cornerMm:0,thickMm:6,bevelMm:11,
      rivetMm:52,rivetInMm:30,rivetDmm:13,rivetType:"dome",rivRows:0,rivCols:1,
      swage:false,lap:"bottom",lapMm:90,
      rust:.95,scaleMm:3.4,pitMm:3,paint:.05,gloss:.6,
      cSteel:"#989da1",cPaint:"#5a5a4e",cPrimer:"#8a4b2c",cRust:"#6d3818"}}
  ],

  controls:[
    {title:"Output",open:true,rows:sizeRowsCut(1200,800)},
    {title:"The plate",open:true,rows:[
      {id:"thickMm",label:"Plate thickness",unit:"mm",min:0.5,max:40,step:0.5,value:5},
      {id:"bevelMm",label:"Edge bevel",unit:"mm",min:0.5,max:80,step:0.5,value:9},
      {id:"lap",type:"select",label:"Laps over its neighbour",value:"none",options:[
        ["none","No lap — butted"],["left","On the left edge"],["right","On the right edge"],
        ["top","At the top"],["bottom","At the bottom"]]},
      {id:"lapMm",need:"lap",label:"Lap width",unit:"mm",min:5,max:400,step:5,value:70},
      {type:"checks",items:[{id:"swage",label:"Pressed stiffening swage",value:false}]},
      {id:"swageInMm",need:"swage",label:"Swage set in from the edge",unit:"mm",min:5,max:600,step:5,value:60},
      {id:"swageMm",need:"swage",label:"Swage width",unit:"mm",min:2,max:120,step:1,value:18},
      {id:"swageHmm",need:"swage",label:"Swage height",unit:"mm",min:0.5,max:20,step:0.5,value:3}
    ]},
    {title:"Rivets",open:true,rows:[
      {id:"rivetType",type:"select",label:"Head",value:"dome",options:[
        ["dome","Domed / snap head"],["csk","Countersunk — flush"],
        ["button","Low button"],["hex","Hex bolt"]]},
      {id:"rivetMm",label:"Target pitch",unit:"mm",min:6,max:600,step:2,value:46},
      {id:"rivetDmm",label:"Head diameter",unit:"mm",min:1,max:80,step:0.5,value:11},
      {id:"rivetInMm",label:"Set in from the edge",unit:"mm",min:2,max:400,step:1,value:26},
      {id:"rivRows",label:"Interior rows",min:0,max:6,step:1,value:0},
      {id:"rivCols",label:"Interior columns",min:0,max:6,step:1,value:0},
      {type:"note",html:"The pitch is a <b>target</b>, not a setting: it is divided into each side "+
        "and rounded, so a rivet lands exactly on each corner and the run is even. The readout "+
        "says what it landed on."}
    ]},
    {title:"Corrosion",open:true,rows:corrosionRows},
    mapRows
  ],

  needs:function(P){
    const n=[];
    if(P.swage)n.push("swage");
    if((P.lap||"none")!=="none")n.push("lap");
    return n;
  },
  readout:readoutFor("plate"),
  sizeTag:function(P){return (+P.panWmm||1200)+"×"+(+P.panHmm||800)+" mm";},
  size:function(P){const g=geom(P,"plate");return {w:g.TW,h:g.TH};},
  build:function(P,io){return build(P,io,"plate");},
  plan:function(P){const g=geom(P,"plate");return {w:g.Wm,h:g.Hm,cutout:true};},
  fileBase:function(P,W,H){return "plate_"+(P.seed|0)+"_"+W+"x"+H;},
  readme:function(P,info){
    const g=geom(P,"plate"),L=layout(P,g,"plate");
    return ["Texture Forge · plate — one riveted metal panel",
      "",
      "Seed "+(P.seed|0)+"   Texture "+info.W+" x "+info.H+" px",
      "Panel "+(g.Wm*1000).toFixed(0)+" x "+(g.Hm*1000).toFixed(0)+" mm — one texel is "+
        (g.Wm/info.W*1000).toFixed(2)+" mm.",
      "Scale your plane to that footprint and the rivets sit at true size.",
      "",
      "This is ONE PANEL, not a tiling texture. It has an alpha channel: outside the plate is",
      "transparent, so it drops onto a hull or a wall and cuts out cleanly. The bevel round the",
      "edge is the only place the plate's thickness ever shows, which is why it is there.",
      "",
      "Rivets: "+(L.nX+1)+" across x "+(L.nY+1)+" down the perimeter at "+
        (L.spX*1000).toFixed(1)+" / "+(L.spY*1000).toFixed(1)+" mm, "+(+P.rivetDmm||11)+" mm heads.",
      "",
      "basecolor.png  sRGB albedo, alpha = the silhouette. Import as sRGB.",
      "normal.png     Tangent space, "+info.normalNote+". Non-colour.",
      "roughness.png  Linear grey.",
      "metallic.png   Linear grey.",
      "ao.png         Linear grey; the bevel and the rivet halos carry it.",
      "height.png     8-bit, spanning "+((info.hMax-info.hMin)*g.Wm*1000).toFixed(2)+" mm of relief.",
      "height16.png   The same at 16 bits.",
      "orm.png        R = AO, G = roughness, B = metallic.",
      "opacity.png    The silhouette on its own.",
      "",
      "Normal strength baked at "+(+P.normalStr).toFixed(2)+"x."].join("\n");
  }
});

/* ============================ SLAB ============================ */
Forge.register({
  id:"slab",
  label:"Slab",
  group:"Panels",
  blurb:"One precast concrete panel, cut out — ties, blowholes, staining",
  title:'Concrete <em>Slab</em>',
  tagline:"Precast panel · chamfered arris · form ties · blowholes · alpha",
  actionLabel:"Cast the panel",
  busyLabel:"Casting…",
  seamless:false,
  backdrops:true,
  flipPreviewY:true,
  previewSize:224,
  preview:{gain:3.0,amb:1.18,specK:0.5,skyLo:[0.19,0.21,0.25],skyHi:[0.40,0.44,0.51]},
  channels:CHANNELS,

  presets:[
    {id:"precast",label:"Precast cladding",set:{
      panWmm:2400,panHmm:1200,cornerMm:0,chamMm:20,form:"smooth",
      tieX:3,tieY:2,tieDmm:30,lifts:true,liftDmm:70,
      voids:.5,voidMm:26,crack:.1,spall:.15,spallMm:8,
      stain:.35,stainM:.55,effl:.2,moss:.1,mossM:.3,
      cConc:"#a8a49c",cAgg:"#6f6a62"}},
    {id:"board",label:"Board-marked",set:{
      panWmm:2000,panHmm:2600,cornerMm:0,chamMm:16,form:"board",boardMm:150,
      tieX:2,tieY:3,tieDmm:26,lifts:false,
      voids:.35,voidMm:30,crack:.08,spall:.1,spallMm:6,
      stain:.3,stainM:.6,effl:.25,moss:.15,mossM:.35,
      cConc:"#9d9a92",cAgg:"#6f6a62"}},
    {id:"agg",label:"Exposed aggregate",set:{
      panWmm:1800,panHmm:1800,cornerMm:0,chamMm:24,form:"agg",aggMm:4,
      tieX:2,tieY:2,tieDmm:30,lifts:true,liftDmm:70,
      voids:.2,voidMm:24,crack:.06,spall:.12,spallMm:7,
      stain:.3,stainM:.5,effl:.15,moss:.12,mossM:.3,
      cConc:"#b0aca2",cAgg:"#5f5a52"}},
    {id:"brutal",label:"Ribbed — weathered",set:{
      panWmm:1600,panHmm:3000,cornerMm:0,chamMm:18,form:"rib",boardMm:110,ribDmm:16,
      tieX:0,tieY:0,lifts:false,
      voids:.3,voidMm:26,crack:.3,spall:.4,spallMm:14,
      stain:.7,stainM:.9,effl:.5,moss:.45,mossM:.6,
      cConc:"#8e8a82",cAgg:"#66615a"}},
    {id:"ruined",label:"Ruined panel",set:{
      panWmm:2400,panHmm:1200,cornerMm:0,chamMm:20,form:"smooth",
      tieX:3,tieY:2,tieDmm:30,lifts:true,liftDmm:70,
      voids:.7,voidMm:22,crack:.85,spall:.9,spallMm:22,
      stain:.85,stainM:.8,effl:.7,moss:.6,mossM:.5,
      cConc:"#96938b",cAgg:"#6a655d"}}
  ],

  controls:[
    {title:"Output",open:true,rows:sizeRowsCut(2400,1200)},
    {title:"The panel",open:true,rows:[
      {id:"chamMm",label:"Arris chamfer",unit:"mm",min:0.5,max:120,step:1,value:20},
      {id:"form",type:"select",label:"Form finish",value:"smooth",options:[
        ["smooth","Smooth — steel or ply form"],["board","Board-marked timber"],
        ["rib","Ribbed / profiled form"],["agg","Exposed aggregate"]]},
      {id:"boardMm",need:"boardy",label:"Board / rib width",unit:"mm",min:20,max:600,step:5,value:150},
      {id:"ribDmm",need:"rib",label:"Rib depth",unit:"mm",min:2,max:80,step:1,value:16},
      {id:"aggMm",need:"agg",label:"Aggregate relief",unit:"mm",min:0.5,max:20,step:0.5,value:4},
      {id:"voids",label:"Blowholes",min:0,max:1,step:0.01,value:0.5},
      {id:"voidMm",need:"void",label:"Blowhole spacing",unit:"mm",min:5,max:120,step:1,value:26},
      {type:"note",html:"Air trapped against the formwork leaves little round craters all over a "+
        "cast face. They are the one detail that says <b>poured</b> rather than <b>modelled</b>, "+
        "and they live almost entirely in the height and the AO."}
    ]},
    {title:"Cast-in fittings",open:true,rows:[
      {id:"tieX",label:"Form ties across",min:0,max:8,step:1,value:3},
      {id:"tieY",label:"Form ties down",min:0,max:8,step:1,value:2},
      {id:"tieDmm",need:"tie",label:"Tie hole diameter",unit:"mm",min:6,max:120,step:2,value:30},
      {type:"checks",items:[{id:"lifts",label:"Lifting sockets near the top",value:true}]},
      {id:"liftDmm",need:"lift",label:"Socket diameter",unit:"mm",min:15,max:200,step:5,value:70}
    ]},
    {title:"Age",open:true,rows:[
      {id:"crack",label:"Cracking",min:0,max:1,step:0.01,value:0.1},
      {id:"spall",label:"Spalling at the arris",min:0,max:1,step:0.01,value:0.15},
      {id:"spallMm",label:"Spall depth",unit:"mm",min:1,max:60,step:1,value:8},
      {id:"stain",label:"Dirt washing down",min:0,max:1,step:0.01,value:0.35},
      {id:"stainM",label:"How far it runs",unit:"m",min:0.05,max:3,step:0.05,value:0.55},
      {id:"effl",label:"Efflorescence",min:0,max:1,step:0.01,value:0.2},
      {id:"moss",label:"Moss at the bottom",min:0,max:1,step:0.01,value:0.1},
      {id:"mossM",need:"moss",label:"Moss rises",unit:"m",min:0.02,max:2,step:0.02,value:0.3},
      {type:"colors",label:"Concrete · aggregate",items:[
        {id:"cConc",value:"#a8a49c"},{id:"cAgg",value:"#6f6a62"}]}
    ]},
    mapRows
  ],

  needs:function(P){
    const n=[],f=P.form||"smooth";
    if(f==="board"||f==="rib")n.push("boardy");
    if(f==="rib")n.push("rib");
    if(f==="agg")n.push("agg");
    if((+P.voids||0)>0)n.push("void");
    if((P.tieX|0)>0&&(P.tieY|0)>0)n.push("tie");
    if(P.lifts)n.push("lift");
    if((+P.moss||0)>0)n.push("moss");
    return n;
  },
  readout:readoutFor("slab"),
  sizeTag:function(P){return (+P.panWmm||2400)+"×"+(+P.panHmm||1200)+" mm";},
  size:function(P){const g=geom(P,"slab");return {w:g.TW,h:g.TH};},
  build:function(P,io){return build(P,io,"slab");},
  plan:function(P){const g=geom(P,"slab");return {w:g.Wm,h:g.Hm,cutout:true};},
  fileBase:function(P,W,H){return "slab_"+(P.seed|0)+"_"+W+"x"+H;},
  readme:function(P,info){
    const g=geom(P,"slab"),L=layout(P,g,"slab");
    return ["Texture Forge · slab — one precast concrete panel",
      "",
      "Seed "+(P.seed|0)+"   Texture "+info.W+" x "+info.H+" px",
      "Panel "+(g.Wm*1000).toFixed(0)+" x "+(g.Hm*1000).toFixed(0)+" mm — one texel is "+
        (g.Wm/info.W*1000).toFixed(2)+" mm.",
      "",
      "This is ONE PANEL, not a tiling texture. It has an alpha channel: outside the panel is",
      "transparent. The chamfer round the edge is not decoration — a sharp arris in concrete",
      "does not survive being lifted, so a precast panel never has one.",
      "",
      "Finish: "+(L.form==="board"?L.nB+" board marks of "+(L.bh*1000).toFixed(0)+" mm"
        :L.form==="rib"?L.nB+" ribs of "+(L.bh*1000).toFixed(0)+" mm"
        :L.form==="agg"?"exposed aggregate":"smooth form finish")+".",
      (L.tieX*L.tieY)+" form-tie holes"+(P.lifts?", two lifting sockets":"")+".",
      "",
      "basecolor.png  sRGB albedo, alpha = the silhouette. Import as sRGB.",
      "normal.png     Tangent space, "+info.normalNote+". Non-colour.",
      "roughness.png  Linear grey.",
      "metallic.png   Flat black except the galvanised ferrules in the lifting sockets.",
      "ao.png         Linear grey; the blowholes and the ties carry most of it.",
      "height.png     8-bit, spanning "+((info.hMax-info.hMin)*g.Wm*1000).toFixed(1)+" mm of relief.",
      "height16.png   The same at 16 bits. Prefer it for displacement — the tie recesses eat",
      "               the range and leave the blowholes almost nothing at 8 bits.",
      "orm.png        R = AO, G = roughness, B = metallic.",
      "opacity.png    The silhouette on its own.",
      "",
      "Normal strength baked at "+(+P.normalStr).toFixed(2)+"x."].join("\n");
  }
});

})();
