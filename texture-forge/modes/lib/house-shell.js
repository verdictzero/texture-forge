/* =====================================================================
   HOUSE SHELL — the shared American-house facade generator
   =====================================================================

   One generator, three faces. The house mode registers the front; the
   envelope mode registers the side and the back. They share this file so
   that the same seed and settings give the same house from every side:
   the same siding coursing, the same trim, the same weathering, the same
   broken panes.

   Faces:
     front  the street elevation — the door bay, full trim
     side   the depth of the house; a gable end when the front is eave-on,
            an eave wall when the front is gable-on. Chimney, meter, vents.
     back   like the front but plainer: back door, kitchen window, service
            clutter, more weathering.

   Everything is in feet. The face decides the width (facade width for
   front and back, house depth for the side), which way the roof reads,
   and what furniture hangs on the wall; everything below that — cladding,
   openings, glass, weathering, abandonment — is common.

   Loaded before the modes that use it; it publishes window.HouseShell.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,mulberry32=Forge.mulberry32,
      hashi=Forge.hashi,hex2rgb=Forge.hex2rgb,boxBlur=Forge.blurClamp;

/* the live parameter set and the face being drawn; every entry point below
   refreshes them first because geometry() and the stencils read them directly */
let P={},GEO=null,FACE="front";
const GEO_BY={};
const use=(params,face)=>{P=params;if(face)FACE=face;};
const isFront=()=>FACE==="front",isSide=()=>FACE==="side",isBack=()=>FACE==="back";

/* value noise; the facade does not tile, so a large fixed lattice is fine */
function vnoise(x,y,seed){
  const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;
  const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const a=hashi(xi,yi,seed),b=hashi(xi+1,yi,seed),c=hashi(xi,yi+1,seed),d=hashi(xi+1,yi+1,seed);
  return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}
function fbm(x,y,oct,seed){
  let amp=1,sum=0,norm=0;
  for(let i=0;i<oct;i++){sum+=amp*vnoise(x,y,seed+i*7919);norm+=amp;amp*=0.5;x*=2;y*=2;}
  return sum/norm;
}
let W_f1=0,W_f2=0,W_cx=0,W_cy=0,W_dx=0,W_dy=0;
function worley(x,y,seed,jit){
  const xi=Math.floor(x),yi=Math.floor(y);
  let d1=1e9,d2=1e9,bx=0,by=0,ex=0,ey=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const cx=xi+dx,cy=yi+dy;
    const fx=cx+0.5+(hashi(cx,cy,seed)-0.5)*jit;
    const fy=cy+0.5+(hashi(cx,cy,seed+7717)-0.5)*jit;
    const ax=x-fx,ay=y-fy,d=ax*ax+ay*ay;
    if(d<d1){d2=d1;d1=d;bx=cx;by=cy;ex=ax;ey=ay;}
    else if(d<d2)d2=d;
  }
  W_f1=Math.sqrt(d1);W_f2=Math.sqrt(d2);W_cx=bx;W_cy=by;W_dx=ex;W_dy=ey;
}
const IN=1/12;                                   // one inch, in feet

/* The six cans anybody actually has: oxide red, flat black, off-white, a blue,
   a yellow, and primer grey. Hoisted because it is read per texel wherever the
   graffiti stencil covers, and a fresh nested literal there is pure garbage. */
const GPAL=[[188,44,52],[30,32,38],[228,224,214],[46,86,168],[196,168,52],[150,150,158]];
/* feet to the nearest boundary of a grid of period L — the basis for every
   seam, joint, strap and form line on the building */
const edgeDist=(v,L)=>{const f=v/L-Math.floor(v/L);return (f<0.5?f:1-f)*L;};

/* ============================ geometry ============================ */
/* The side elevation is the other axis of the same roof: an eave-front house
   presents a gable end from the side, a gable-front house presents an eave
   wall, and a flat roof is flat from everywhere. That one substitution is
   what makes a side elevation read as the same building. */
function faceRoof(){
  if(!isSide())return P.roof;
  return P.roof==="flat"?"flat":(P.roof==="gable"?"eave":"gable");
}
function faceWidth(){
  return isSide()?(P.depthFt||P.facadeW*1.35):P.facadeW;
}
function geometry(){
  const FW=faceWidth(),roof=faceRoof();
  const wallTop=P.foundH+P.storeys*P.storeyH;
  const eaveBand=(roof==="flat")?1.4:(roof==="gable"?0.30:P.fasciaD*IN);
  const gableH=(roof==="gable")?(FW/2)*(P.pitch/12):0;
  const roofTop=wallTop+eaveBand+gableH;
  /* a chimney is part of the silhouette, so it sets the height of the image */
  let chimX=0,chimW=0,chimTop=0;
  if(!isFront()&&P.chimney&&P.chimney!=="none"){
    chimW=2.6;
    chimX=(P.chimney==="gable")?FW*0.5:(isLeft()?FW*0.83:FW*0.17);
    chimTop=roofTop+(P.chimney==="gable"?2.4:1.7);
  }
  const FH=Math.max(roofTop,chimTop);
  const TW=P.size|0;
  const TH=Math.max(8,Math.round(TW*FH/FW/4)*4);
  return {FW:FW,FH:FH,wallTop:wallTop,eaveBand:eaveBand,gableH:gableH,TW:TW,TH:TH,
          roof:roof,roofTop:roofTop,chimX:chimX,chimW:chimW,chimTop:chimTop};
}

/* Meters, vent stacks, hose bibs, a back light, a chimney — the things that
   only ever hang on the faces nobody photographs. Laid out in feet like
   everything else so they land at the same size as the trim around them. */
/* Everything hung on a plain wall has to miss the openings, the chimney and
   the other fittings — a vent stack routed straight through two windows is
   the giveaway that nothing was checked. So each fitting names where it would
   LIKE to be, and then takes the nearest position across the wall that is
   actually clear. A fitting that finds nowhere clear is simply not fitted,
   which is also what happens on a real building. */
function buildFurniture(g,ops){
  const F=[];
  if(isFront())return F;
  const grade=P.foundH;
  const chim=g.chimW>0
    ? {kind:"chimney",x0:g.chimX-g.chimW/2,x1:g.chimX+g.chimW/2,
       y0:P.chimney==="gable"?g.roofTop-1.2:0,y1:g.chimTop,
       wide:P.chimney==="gable"?0:0.7}
    : null;
  if(chim)F.push(chim);

  const clear=(x0,y0,x1,y1,pad)=>{
    if(x0<0.5||x1>g.FW-0.5)return false;
    for(const o of ops)
      if(x1+pad>o.x0&&x0-pad<o.x1&&y1+pad>o.y0&&y0-pad<o.y1)return false;
    for(const f of F)
      if(x1+pad>f.x0&&x0-pad<f.x1&&y1+pad>f.y0&&y0-pad<f.y1)return false;
    return true;
  };
  /* positions across the wall, nearest to the preferred one first */
  const candidates=(pref,w)=>{
    const out=[],n=28,lo=0.6+w*0.5,hi=g.FW-0.6-w*0.5;
    if(hi<=lo)return [g.FW*0.5];
    for(let i=0;i<=n;i++)out.push(lo+(hi-lo)*i/n);
    return out.sort((a,b)=>Math.abs(a-pref)-Math.abs(b-pref));
  };
  const fit=(kind,prefX,y,w,h,pad,extra)=>{
    for(const x of candidates(prefX,w)){
      if(clear(x-w/2,y,x+w/2,y+h,pad==null?0.35:pad)){
        const f={kind:kind,x0:x-w/2,x1:x+w/2,y0:y,y1:y+h};
        if(extra)for(const k in extra)f[k]=extra[k];
        F.push(f);
        return f;
      }
    }
    return null;
  };
  /* the side you would walk down: services stay on the same real wall when
     the layout mirrors for the other end of the house */
  const side=x=>isLeft()?g.FW-x:x;

  if(P.meter)fit("meter",side(g.FW*(isSide()?0.16:0.13)),grade+3.3,1.05,1.35,0.45);
  if(P.ventStack){
    /* A soil stack is a full-height vertical run, so it needs a clear COLUMN
       of wall — and merely legal is not enough: a pipe half an inch off a
       window casing looks like a mistake. Take the roomiest column instead of
       the first one that fits, with a mild pull toward where it belongs. */
    const top=Math.max(grade+2.4,g.wallTop-0.15),y0=grade+1.1,w=0.34,h=top-y0;
    const pref=side(g.FW*(isSide()?0.72:0.66));
    let best=null,bestScore=-1e9;
    for(const x of candidates(pref,w)){
      if(!clear(x-w/2,y0,x+w/2,y0+h,0.5))continue;
      let room=1e9;
      for(const o of ops){
        if(o.y1<y0||o.y0>y0+h)continue;                  // only what the run passes
        room=Math.min(room,Math.max(o.x0-(x+w/2),(x-w/2)-o.x1));
      }
      const sc=Math.min(room,3.5)-Math.abs(x-pref)*0.10;
      if(sc>bestScore){bestScore=sc;best=x;}
    }
    if(best!=null)F.push({kind:"stack",x0:best-w/2,x1:best+w/2,y0:y0,y1:y0+h});
  }
  if(P.hoseBib)fit("bib",side(g.FW*(isSide()?0.31:0.8)),grade+1.5,0.5,0.5,0.3);

  if(isBack()){
    if(P.dryerVent)fit("dryer",side(g.FW*0.33),grade+2.1,0.8,0.62,0.35);
    if(P.backLight){
      /* a wall lantern belongs beside its door, not on a free patch of wall:
         anchor it to the door and skip it if there is no room */
      const door=ops.filter(o=>o.type==="door")[0];
      if(door){
        const yl=door.y0+5.5;
        const gapR=g.FW-0.6-door.x1,gapL=door.x0-0.6;
        const x=(gapR>=gapL?door.x1+0.85:door.x0-0.85);
        if(clear(x-0.42,yl,x+0.42,yl+1.1,0.15))
          F.push({kind:"light",x0:x-0.42,x1:x+0.42,y0:yl,y1:yl+1.1});
      }
    }
  }
  return F;
}
/* Each face draws from its own RNG stream, so the back is not a copy of the
   front with the door moved. The front keeps salt 0 — its stream, and every
   pixel that follows from it, is unchanged. */
const isLeft=()=>isSide()&&P.sideEnd==="left";
/* Unwrapped clockwise from the front-left corner, the right side reads
   front-to-back and the left side back-to-front. Mirroring the layout alone
   would make the two ends twins, so they draw from different streams too. */
const faceSalt=()=>isSide()?(isLeft()?1019:1013):(isBack()?2027:0);

/* nobody frames a window into a chimney breast, and a meter box behind one
   would simply be invisible — both get moved out of its way */
function clearOfChimney(g,x0,x1){
  if(!(g.chimW>0))return true;
  const a=g.chimX-g.chimW*0.5-0.4,b=g.chimX+g.chimW*0.5+0.4;
  return x1<a||x0>b;
}

/* the left end is the same wall seen from the other side of the house */
function mirror(list,FW){
  for(const o of list){const x0=o.x0;o.x0=FW-o.x1;o.x1=FW-x0;}
  return list;
}

/* the openings, laid out bay by bay, storey by storey */
/* A window is a frame with SASHES in it, and which sashes it has is most of
   what makes one window different from another. Every opening in this mode used
   to be the same two-sash double-hung, which is why a facade came out as six
   identical tall slabs: a real house does not glaze every hole the same way.

   Worked out here rather than in the texel loop, so the loop is a walk over at
   most three boxes. u and v are fractions of the glazed area; `back` is how far
   that sash sits behind the one in front of it, which is the whole reason a
   double-hung reads as two sashes and a slider reads as two panels. */
function sashesFor(style,lc,lr){
  const a=sashBoxes(style,lc,lr);
  /* the pane hashes want an integer per sash; derive it once here rather than
     from the sash's fractions on every pane texel */
  for(let i=0;i<a.length;i++){
    const s=a[i];
    s.s1=((s.u0*97+s.v0*211)|0)*911;
    s.s2=(s.u0*13)|0;
    s.s3=((s.v0*29)|0)*50;
  }
  return a;
}

function sashBoxes(style,lc,lr){
  switch(style){
    case "pic":                                    // fixed centre light, operable flankers
      return [{u0:0,u1:0.21,v0:0,v1:1,back:1,lc:1,lr:2},
              {u0:0.21,u1:0.79,v0:0,v1:1,back:0,lc:1,lr:1},
              {u0:0.79,u1:1,v0:0,v1:1,back:1,lc:1,lr:2}];
    case "case":                                   // a pair of side-hung leaves
      return [{u0:0,u1:0.5,v0:0,v1:1,back:0,lc:lc,lr:lr+1},
              {u0:0.5,u1:1,v0:0,v1:1,back:0,lc:lc,lr:lr+1}];
    case "slide":                                  // one panel passes behind the other
      return [{u0:0,u1:0.52,v0:0,v1:1,back:0,lc:1,lr:1},
              {u0:0.48,u1:1,v0:0,v1:1,back:1,lc:1,lr:1}];
    case "awn":                                    // one short light, top-hung
      return [{u0:0,u1:1,v0:0,v1:1,back:0,lc:Math.max(1,lc),lr:1}];
    case "dh1":                                    // double-hung, unmuntined
      return [{u0:0,u1:1,v0:0,v1:0.5,back:0,lc:1,lr:1},
              {u0:0,u1:1,v0:0.5,v1:1,back:1,lc:1,lr:1}];
    default:                                       // double-hung
      return [{u0:0,u1:1,v0:0,v1:0.5,back:0,lc:lc,lr:lr},
              {u0:0,u1:1,v0:0.5,v1:1,back:1,lc:lc,lr:lr}];
  }
}

function buildOpenings(g){
  const rng=mulberry32((P.seed|0)*2654435761+7+faceSalt());
  const ops=[];
  const lc=Math.max(1,P.liteC|0),lr=Math.max(1,P.liteR|0);
  const win=(cx,floor,w,h,sill,style)=>{
    const y0=floor+sill;
    const o={type:"window",x0:cx-w/2,x1:cx+w/2,y0:y0,y1:y0+h,
      lit:P.litWin&&rng()<0.55,rng:rng(),tilt:(rng()-0.5)*0.06};
    o.style=style||"dh";
    o.sash=sashesFor(o.style,lc,lr);
    o.boarded=rng()<P.boardUp*P.aband;
    o.brokeSeed=(rng()*1e6)|0;
    o.partial=rng()<0.35;
    return o;
  };
  /* "mixed" is the arrangement most American houses actually have: something
     wide in the living room and ordinary double-hungs upstairs. */
  const styleAt=s=>(P.winStyle==="mixed")?(s===0?"pic":"dh"):(P.winStyle||"dh");
  /* a picture window is not a double-hung stretched — it is a WIDER, SHORTER
     hole with a lower sill, and getting that proportion right is the difference
     between a living-room window and a shop front */
  const placeWin=(cx,floor,style,span,k)=>{
    const kk=k||1;                                 // a gable end carries less glass
    if(style==="pic"){
      const w=Math.min(span*0.84,P.winW*2.25)*kk;
      return win(cx,floor,w,P.winH*0.86,Math.max(1.3,P.sillH*0.72),"pic");
    }
    if(style==="slide"){
      const w=Math.min(span*0.72,P.winW*1.5)*kk;
      return win(cx,floor,w,P.winH*0.80,P.sillH+P.winH*0.10,"slide");
    }
    return win(cx,floor,P.winW*kk,P.winH,P.sillH,style);
  };

  if(isSide()){
    /* A gable end carries far fewer openings than the street front: one or two
       per storey, a tall stair window where the flight turns, and a small high
       window where the bathroom is. */
    const bays=Math.max(1,P.sideBays|0);
    const margin=Math.max(1.2,g.FW*0.10);
    const span=(g.FW-2*margin)/bays;
    /* A blank bay is blank all the way up — that is a stair, a chimney breast
       or a utility run behind it. Scattering the blanks per floor instead just
       reads as holes punched at random. */
    const blankBay=[];
    for(let bi=0;bi<bays;bi++)blankBay.push(rng()<P.sideBlank);
    for(let s=0;s<P.storeys;s++){
      const floor=P.foundH+s*P.storeyH;
      for(let bi=0;bi<bays;bi++){
        const cx=margin+span*(bi+0.5);
        if(blankBay[bi]){continue;}
        if(s>0&&rng()<0.35){                             // bathroom: small, high, obscured
          const w=Math.max(1.4,P.winW*0.55),h=Math.max(1.6,P.winH*0.45);
          const o=win(cx,floor,w,h,P.sillH+P.winH-h+0.35,"awn");
          o.obscured=true;
          ops.push(o);
          continue;
        }
        /* through placeWin, so that a slider on the side is the same wide,
           short hole it is on the front — one house from every angle */
        ops.push(placeWin(cx,floor,
          P.winStyle==="pic"||P.winStyle==="mixed"?"dh":(P.winStyle||"dh"),span,0.9));
      }
    }
    if(P.storeys>1&&P.stairWin){
      /* A stair window lights the half-landing, so it sits BETWEEN two floors
         and, on a bayed wall, between two bays — dropping it at a random x
         put it through whatever was already there. */
      const w=Math.max(1.6,P.winW*0.7),h=P.storeyH*0.85;
      const y0=P.foundH+P.storeyH-h*0.45;
      const gaps=[];
      for(let bi=0;bi<bays-1;bi++)gaps.push(margin+span*(bi+1));   // between bays
      gaps.push(margin*0.5,g.FW-margin*0.5);                        // the end margins
      const free=x=>{
        if(x-w/2<0.6||x+w/2>g.FW-0.6)return false;
        for(const o of ops)
          if(x+w/2+0.5>o.x0&&x-w/2-0.5<o.x1&&y0+h+0.4>o.y0&&y0-0.4<o.y1)return false;
        return true;
      };
      const x=gaps.filter(free)[0];
      if(x!=null)ops.push(win(x,y0,w,h,0,"dh"));       // a stair light is always a tall pair
    }
    if(P.sideDoor){                                       // service door onto the side path
      const cx=margin+span*0.5;
      ops.push({type:"door",x0:cx-P.doorW*0.45,x1:cx+P.doorW*0.45,
        y0:P.foundH,y1:P.foundH+6.7,hood:false,transomH:0,rng:rng(),back:true});
    }
    return (isLeft()?mirror(ops,g.FW):ops).filter(function(o){
      return clearOfChimney(g,o.x0,o.x1);
    });
  }

  const bays=Math.max(1,P.bays|0);
  const margin=Math.max(1.2,g.FW*0.06);
  const span=(g.FW-2*margin)/bays;

  if(isBack()){
    /* The back is the working face: a plain door onto the yard or a wide
       slider, the kitchen window beside it, and less of everything else. */
    const doorIdx=clamp((P.backDoorBay|0)-1,0,bays-1);
    const kitchenIdx=(doorIdx+1)%bays;
    for(let s=0;s<P.storeys;s++){
      const floor=P.foundH+s*P.storeyH;
      for(let bi=0;bi<bays;bi++){
        const cx=margin+span*(bi+0.5);
        if(s===0&&bi===doorIdx){
          if(P.backDoor==="slider"){
            const w=Math.min(span*0.92,Math.max(5,P.doorW*2));
            const o=win(cx,floor,w,6.7,0.0,"slide");   // it is a slider: say so
            o.y1=floor+6.7;
            ops.push(o);
          }else if(P.backDoor==="door"){
            ops.push({type:"door",x0:cx-P.doorW/2,x1:cx+P.doorW/2,y0:floor,y1:floor+6.7,
              hood:P.backHood,transomH:0,rng:rng(),back:true});
          }
          continue;
        }
        if(s===0&&bi===kitchenIdx){                       // wide window over the sink
          ops.push(win(cx,floor,Math.min(span*0.8,P.winW*1.45),P.winH*0.78,P.sillH+0.55,
                       P.winStyle==="dh"?"dh1":styleAt(s)));
          continue;
        }
        if(rng()<0.12){continue;}                         // the odd blank bay
        ops.push(placeWin(cx,floor,styleAt(s)==="pic"?"dh":styleAt(s),span));
      }
    }
    return ops;
  }

  const doorIdx=clamp((P.doorBay|0)-1,0,bays-1);
  for(let s=0;s<P.storeys;s++){
    const floor=P.foundH+s*P.storeyH;
    for(let bi=0;bi<bays;bi++){
      const cx=margin+span*(bi+0.5);
      if(s===0&&bi===doorIdx){
        const th=P.transom?0.95:0;
        const w=P.doorW,h=6.7+th;
        ops.push({type:"door",x0:cx-w/2,x1:cx+w/2,y0:floor,y1:floor+h,
          hood:P.doorHood,transomH:th,rng:rng()});
        continue;
      }
      ops.push(placeWin(cx,floor,styleAt(s),span));
    }
  }
  return ops;
}

/* ============================ drawn stencils ============================ */
/* R = graffiti coverage, G = graffiti hue pick, B = vines/weeds */
function buildStencil(g,SW,SH){
  const c=document.createElement("canvas");c.width=SW;c.height=SH;
  const q=c.getContext("2d",{willReadFrequently:true});
  q.fillStyle="#000";q.fillRect(0,0,SW,SH);
  const rng=mulberry32((P.seed|0)*40503+13+faceSalt());
  const fx=SW/g.FW,fy=SH/g.FH;                     // px per foot
  const Y=(ft)=>SH-ft*fy;                          // world feet -> canvas y

  if(P.graffiti*P.aband>0){
    /* Graffiti is WRITING. Drawn as random curly strokes — which is what this
       did — it comes out as a coloured smear that reads as a stain, and the
       eye knows instantly that nobody wrote it. So: real letters in a real
       graffiti face, at a size and a height a person could actually reach,
       leaning the way an arm leans, with the paint running off the bottom of
       the glyphs where the can was held too long.

       The face comes from ForgeFonts, which never bundles one (see the note at
       the top of forge-fonts.js — three of the six in this repository are
       personal-use cuts and three came with no licence at all). If none is
       registered we fall back to the old scrawl, which is at least honest
       about being a scrawl. */
    const face=window.ForgeFonts?ForgeFonts.resolve(P.graffFont):null;
    const n=Math.round(1+P.graffiti*P.aband*4);
    const words=String(P.graffText||"").split(/[,\n]/).map(w=>w.trim()).filter(Boolean);
    q.lineCap="round";q.lineJoin="round";
    q.textBaseline="alphabetic";

    if(face&&words.length){
      for(let i=0;i<n;i++){
        const word=words[Math.floor(rng()*words.length)%words.length];
        /* Reachable: a tag goes on at arm's length from whatever the writer was
           standing on, so between about a foot and eight feet up. Anything
           higher wanted a ladder, and nobody brings a ladder. */
        const capFt=Math.min(8.2,g.FH*0.55);
        const cy=1.0+rng()*Math.max(0.6,capFt-1.0);
        const size=(0.9+rng()*1.5)*fy;               // roughly 11 in to 2 ft of cap height
        const tilt=(rng()-0.5)*0.30;                 // an arm swings, it does not rule
        q.font=size+'px "'+face.css+'", sans-serif';
        const wpx=q.measureText(word).width;
        const cx=rng()*Math.max(1,g.FW*fx-wpx*0.6)+wpx*0.1;
        const hue=Math.floor(rng()*250);
        q.save();
        q.translate(cx,Y(cy));
        q.rotate(tilt);
        /* R is coverage and G picks the colour downstream, so the fill has to
           carry both rather than being the paint colour itself */
        const alpha=(0.72+rng()*0.28).toFixed(2);
        q.fillStyle="rgba(255,"+hue+",0,"+alpha+")";
        /* a fat outline under the fill is what a spray can actually leaves */
        q.lineWidth=size*0.055;
        q.strokeStyle="rgba(255,"+hue+",0,"+alpha+")";
        q.strokeText(word,0,0);
        q.fillText(word,0,0);
        /* runs off the bottom of the letters */
        const drips=1+Math.floor(rng()*3);
        for(let d=0;d<drips;d++){
          const dx=rng()*wpx;
          q.lineWidth=size*(0.035+rng()*0.05);
          q.beginPath();
          q.moveTo(dx,size*0.06);
          q.lineTo(dx+(rng()-0.5)*size*0.06,size*(0.2+rng()*0.75));
          q.stroke();
        }
        q.restore();
      }
    }else{
      for(let i=0;i<n+1;i++){
        const cx=rng()*g.FW,cy=0.9+rng()*Math.min(7,g.FH*0.35);
        const sc=(0.7+rng()*1.9)*fx;
        const hue=rng();
        const strokes=2+Math.floor(rng()*4);
        for(let s2=0;s2<strokes;s2++){
          const w=(0.12+rng()*0.22)*sc;
          q.lineWidth=w;
          q.strokeStyle="rgba(255,"+Math.round(hue*255)+",0,"+(0.55+rng()*0.45).toFixed(2)+")";
          q.beginPath();
          const px=cx*fx+(rng()-0.5)*sc,py=Y(cy)+(rng()-0.5)*sc*0.6;
          const a0=rng()*Math.PI*2,len=(0.6+rng()*1.6)*sc,curl=(rng()-0.5)*4;
          for(let t=0;t<=18;t++){
            const u=t/18;
            const a=a0+curl*u;
            const X=px+Math.cos(a)*len*u+Math.sin(u*6.0)*sc*0.18;
            const Yy=py+Math.sin(a)*len*u*0.6+Math.cos(u*4.0)*sc*0.14;
            if(t===0)q.moveTo(X,Yy);else q.lineTo(X,Yy);
          }
          q.stroke();
          if(rng()<0.5){
            q.lineWidth=w*0.22;
            q.beginPath();
            const dx=px+(rng()-0.5)*len,dy=py+(rng()-0.3)*len*0.4;
            q.moveTo(dx,dy);q.lineTo(dx,dy+(0.3+rng()*1.2)*sc);q.stroke();
          }
        }
      }
    }
  }
  if(P.vines*P.aband>0){
    /* A vine is a PLANT: it is rooted in the ground, it climbs, it branches,
       and its leaves cluster on the stem rather than floating beside it. Drawn
       as a scatter of green lobes — which is what this did — it reads as
       lichen, or as somebody flicking a brush at the wall.

       So each one starts at grade, works upward with a bias it keeps (a vine
       that has found a downpipe follows it), throws side branches, and carries
       leaves thickest where the stem is oldest. They also stop: a vine that has
       had four seasons is not the same height as one that has had one. */
    const n=Math.round(2+P.vines*P.aband*7);
    q.lineCap="round";q.lineJoin="round";
    const leaf=(px,py,lr)=>{
      /* B is the vine's own coverage; G belongs to the graffiti hue and a leaf
         drawn over a tag must not tint it */
      q.fillStyle="rgba(0,0,255,"+(0.55+rng()*0.45).toFixed(2)+")";
      q.beginPath();
      const lobes=5,rot=rng()*Math.PI*2;
      for(let t=0;t<=lobes*5;t++){
        const a2=t/(lobes*5)*Math.PI*2;
        const rr=lr*(0.58+0.42*Math.abs(Math.cos(a2*lobes*0.5)));
        const X=px+Math.cos(a2+rot)*rr,Y2=py+Math.sin(a2+rot)*rr*1.08;
        if(t===0)q.moveTo(X,Y2);else q.lineTo(X,Y2);
      }
      q.closePath();q.fill();
    };
    const grow=(x0,y0,climb,thick,depth)=>{
      const segs=Math.max(10,Math.round(climb/(0.22*fy)));
      let x=x0,y=y0,ang=-Math.PI/2+(rng()-0.5)*0.4;
      const lean=(rng()-0.5)*0.16;                   // the bias it keeps as it goes
      const pts=[[x,y]];
      for(let s2=0;s2<segs;s2++){
        ang+=lean*0.1+(rng()-0.5)*0.34;
        if(ang>-0.42)ang=-0.42;if(ang<-Math.PI+0.42)ang=-Math.PI+0.42;
        x+=Math.cos(ang)*climb/segs;y+=Math.sin(ang)*climb/segs;
        pts.push([x,y]);
      }
      /* the stem tapers: thick and woody at the root, whippy at the tip */
      for(let k=1;k<pts.length;k++){
        const t=k/pts.length;
        q.strokeStyle="rgba(0,0,255,0.95)";
        q.lineWidth=Math.max(1,thick*(1-t*0.72));
        q.beginPath();q.moveTo(pts[k-1][0],pts[k-1][1]);q.lineTo(pts[k][0],pts[k][1]);q.stroke();
      }
      /* leaves, thickest on the older wood low down */
      for(let k=1;k<pts.length;k++){
        const t=k/pts.length;
        const cnt=1+Math.floor(rng()*3.4*(1.25-t*0.5));
        for(let c=0;c<cnt;c++){
          const lr=(0.075+rng()*0.115)*fx*(1.15-t*0.45);
          const px=pts[k][0]+(rng()-0.5)*lr*3.4,py=pts[k][1]+(rng()-0.5)*lr*3.0;
          leaf(px,py,lr);
        }
      }
      /* and it branches, once or twice, from about a third of the way up */
      if(depth>0){
        const brs=1+Math.floor(rng()*2);
        for(let bch=0;bch<brs;bch++){
          const k=Math.floor(pts.length*(0.28+rng()*0.5));
          grow(pts[k][0],pts[k][1],climb*(0.35+rng()*0.35),thick*0.6,depth-1);
        }
      }
    };
    for(let i=0;i<n;i++){
      /* rooted at grade, and a vine only gets as far as its seasons allowed */
      const x=rng()*g.FW*fx;
      const climb=(2.5+rng()*rng()*Math.min(20,g.FH*0.9))*fy;
      grow(x,SH-rng()*0.5*fy,climb,Math.max(1.4,0.075*fx*(0.8+rng()*0.8)),1);
    }
  }
  return q.getImageData(0,0,SW,SH).data;
}

/* ============================ the generator ============================ */

/* material scratch, written by the cladding routines */
let Mh=0,Mr=0,Mg=0,Mb=0,Mrg=0.8,Mid=1,Mmet=0,Mwood=0,Mcourse=0,Mboard=0,Mbu=0.5,Mbv=0.5;
let Gr=0,Gg=0,Gb=0,Grough=0.08,Gmet=0,Gemis=0;

function build(params,io){
  use(params);
  /* A build runs in bands across setTimeout, and the module-level P/FACE are
     rebound by anything that asks the shell a question in the meantime — the
     other mode's readout fires on every keystroke in its panel. Latch them
     here and re-assert at the top of each band; nothing else can run inside
     one band, so that is exactly enough. */
  const face=FACE,par=params;
  let hMin=0,hMax=1;
  const g=geometry();
  const TW=io.W,TH=io.H;
  GEO=g;GEO_BY[face]=g;
  const seed=P.seed|0;
  const FW=g.FW,FH=g.FH;
  const ftPerPx=FW/TW;
  const ops=buildOpenings(g);
  /* Every opening carries its own sash layout; this is only the floor under a
     malformed one, and it is a build-scope constant so that the per-texel read
     of it can never become a per-texel allocation. */
  const DEFSASH=sashesFor("dh",P.liteC|0,P.liteR|0);
  const FURN=buildFurniture(g,ops);
  const SW=Math.min(TW,1024),SH=Math.max(8,Math.round(SW*FH/FW));
  const sten=buildStencil(g,SW,SH);

  const N=TW*TH;
  const A=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N);
  const MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N);
  const NRM=new Uint8ClampedArray(N*3);
  const HGT=new Float32Array(N);
  const IDm=new Uint8ClampedArray(N);
  const EMI=new Uint8ClampedArray(N);
  const ALP=new Uint8ClampedArray(N);

  const wall=hex2rgb(P.cWall),trim=hex2rgb(P.cTrim),under=hex2rgb(P.cUnder);
  const doorC=hex2rgb(P.cDoor),shutC=hex2rgb(P.cShut),roofC=hex2rgb(P.cRoof);
  const gutC=hex2rgb(P.cGutter);
  const REL=P.cladRelief,IRR=P.cladIrreg;
  const expo=P.exposure*IN,mortar=P.mortarW*IN,cH=P.courseH*IN,uL=P.unitLen*IN;
  const casing=P.casingW*IN,cornerW=P.cornerW*IN,friezeH=P.friezeH*IN;
  const waterT=P.waterT*IN;
  const AB=P.aband;

  const sample=(u,v,ch)=>{                          // stencil read, clamped
    const x=clamp(u*SW-0.5,0,SW-1.001),y=clamp(v*SH-0.5,0,SH-1.001);
    const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
    const x1=Math.min(SW-1,x0+1),y1=Math.min(SH-1,y0+1);
    const a=sten[(y0*SW+x0)*4+ch],b=sten[(y0*SW+x1)*4+ch];
    const c=sten[(y1*SW+x0)*4+ch],d=sten[(y1*SW+x1)*4+ch];
    return (a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy)/255;
  };

  /* ---------- cladding ---------- */
  /* The strip of wall each course butt overhangs. On a real clapboard wall this
     is the strongest thing on the elevation — it is what makes siding read as
     siding from across the street — and until now it lived only in the height
     map, so a flat-lit render or a base-colour export lost it entirely.

     It belongs in the albedo as well, and honestly: that strip never sees sun,
     so it never bleaches, and dirt washing down the wall stops under the lip
     and stays there. It is a genuine material difference, not baked lighting,
     which is why it does not fight the AO map that also carries it. */
  const LAPSH=clamp(+P.lapShade,0,1);
  function lapShade(f,r,gg,b){
    if(LAPSH<=0)return 0;
    const k=smoothstep(0.52,1.0,f)*LAPSH*0.52;
    return k;
  }

  function cladding(x,y){
    Mid=1;Mmet=0;Mwood=1;Mrg=0.72;Mcourse=0;Mboard=0;Mbu=0.5;Mbv=0.5;
    let r=wall[0],gg=wall[1],b=wall[2],h=0;
    if(P.clad==="clapboard"||P.clad==="vinyl"){
      const vin=P.clad==="vinyl";
      const E=vin?expo*0.5:expo;
      const c=Math.floor(y/E),f=y/E-c;
      const T=(vin?0.035:0.055)*REL;
      h=T*(1-f*f*0.85);                               // proud at the butt, receding up
      h+=Math.sin(f*Math.PI)*0.012*REL*(vin?0.4:1)*IRR;   // cupping
      const L=vin?12:P.boardLen;
      const off=hashi(c,7,seed)*L;
      const bi=Math.floor((x+off)/L);
      const jd=Math.abs(((x+off)/L-bi-0.5))*L;         // ft from board centre
      const jg=1-smoothstep(L*0.5-0.02,L*0.5,jd);
      h-=jg*0.02*REL;
      const bh=hashi(bi,c,seed+11);
      h+=(bh-0.5)*0.010*REL*IRR;
      Mcourse=c;Mboard=bi;Mbu=(x+off)/L-bi;Mbv=f;
      const grain=fbm(x*26,y*3.5,3,seed+31);
      h+=(grain-0.5)*0.006*REL*(vin?0.15:1);
      const tone=1+(bh-0.5)*0.06*IRR+(grain-0.5)*0.05;
      r*=tone;gg*=tone;b*=tone;
      const k=lapShade(f)*(vin?0.72:1);                // vinyl laps shallower
      if(k>0){r*=1-k;gg*=1-k*0.99;b*=1-k*0.96;}        // the shade is a touch cool
      Mrg=(vin?0.55:0.68)+k*0.22;
      if(vin)Mwood=0;
    }else if(P.clad==="batten"){
      const sp=P.battenSpace*IN;
      const bi=Math.floor(x/sp),f=x/sp-bi;
      const bw=2.5*IN;
      const dB=Math.min(f,1-f)*sp;
      const bat=1-smoothstep(bw*0.5-ftPerPx,bw*0.5,dB);
      h=bat*0.06*REL;
      const grain=fbm(x*3.5,y*26,3,seed+31);
      h+=(grain-0.5)*0.008*REL;
      const bh=hashi(bi,3,seed+11);
      /* A vertical board has no course above it — it runs the whole wall, so it
         is one board with one history, and its cut ends are the top and the
         bottom. Giving it a course every 8 ft put a dead-straight line across
         the elevation in the peel and the missing-siding mask, which is the
         very artefact the lapped branch goes out of its way to avoid. Across
         the face, 0 is at a batten (where the water gets in) and 1 is the
         middle of the board. */
      Mcourse=0;Mboard=bi;Mbu=clamp(y/Math.max(FH,1),0,1);Mbv=Math.min(f,1-f)*2;
      const tone=1+(bh-0.5)*0.07*IRR+(grain-0.5)*0.06;
      r*=tone;gg*=tone;b*=tone;
      /* a batten shades the board either side of it rather than below it */
      const k=(1-smoothstep(bw*0.5,bw*0.5+0.055,dB))*(1-bat)*LAPSH*0.46;
      if(k>0){r*=1-k;gg*=1-k*0.99;b*=1-k*0.96;}
      Mrg=0.70+k*0.20;
    }else if(P.clad==="shingle"){
      const E=expo;
      const c=Math.floor(y/E),f=y/E-c;
      const off=hashi(c,3,seed)*3;
      const w=Math.max(0.35,expo*1.15);
      const si=Math.floor((x+off)/w);
      let dg=1e9,sid=si;
      for(let k=-1;k<=1;k++){
        const idx=si+k;
        const gp=(idx+(hashi(idx,c,seed+5)-0.5)*0.7)*w-off;
        const d=x-gp;
        if(Math.abs(d)<Math.abs(dg)){dg=d;sid=(d>=0)?idx:idx-1;}
      }
      const sh=hashi(sid,c,seed+17);
      Mcourse=c;Mboard=sid;Mbu=clamp(0.5+dg/Math.max(0.05,w),0,1);Mbv=f;
      h=0.05*REL*(1-f*f*0.7)+(sh-0.5)*0.02*REL*IRR;
      h-=(1-smoothstep(0,0.018,Math.abs(dg)))*0.035*REL;
      const grain=fbm(x*30,y*6,3,seed+31);
      h+=(grain-0.5)*0.008*REL;
      const tone=1+(sh-0.5)*0.16*IRR+(grain-0.5)*0.08;
      r*=tone;gg*=tone;b*=tone;
      const k=lapShade(f)*1.08;                        // a shingle butt is thicker still
      if(k>0){r*=1-k;gg*=1-k*0.99;b*=1-k*0.96;}
      Mrg=0.80+k*0.16;
    }else if(P.clad==="brick"){
      const row=Math.floor(y/cH);
      const off=(row&1)?uL*0.5:0;
      const col=Math.floor((x+off)/uL);
      const fx2=(x+off)/uL-col,fy2=y/cH-row;
      const dj=Math.min(Math.min(fx2,1-fx2)*uL,Math.min(fy2,1-fy2)*cH);
      const face=smoothstep(mortar*0.5-ftPerPx,mortar*0.5+ftPerPx*0.5,dj);
      const bh=hashi(col,row,seed+23);
      h=-0.035*REL*(1-face);
      h+=face*(bh-0.5)*0.012*REL*IRR;
      h+=(fbm(x*80,y*80,2,seed+29)-0.5)*0.006*REL;
      const bt=0.80+bh*0.42;
      r=lerp(178,120,1-bt*0.6)*bt*0.9;gg=lerp(96,70,1-bt)*bt;b=lerp(78,60,1-bt)*bt;
      r=lerp(r,wall[0],0.25);gg=lerp(gg,wall[1],0.25);b=lerp(b,wall[2],0.25);
      const mo=1-face;
      r=lerp(r,196,mo);gg=lerp(gg,190,mo);b=lerp(b,178,mo);
      Mrg=lerp(0.78,0.92,mo);Mid=5;Mwood=0;
    }else if(P.clad==="stone"){
      const sc=1/Math.max(0.35,uL*1.6);
      worley(x*sc,y*sc*1.5,seed+37,0.95);
      const edge=W_f2-W_f1;
      const face=smoothstep(0.03,0.10,edge);
      h=-0.05*REL*(1-face);
      const sh=hashi(W_cx,W_cy,seed+41);
      h+=face*(sh-0.5)*0.05*REL*IRR;
      h+=(fbm(x*40,y*40,3,seed+43)-0.5)*0.012*REL;
      const t=0.62+sh*0.6;
      r=lerp(150,110,sh)*t;gg=lerp(142,104,sh)*t;b=lerp(130,96,sh)*t;
      const mo=1-face;
      r=lerp(r,186,mo);gg=lerp(gg,180,mo);b=lerp(b,168,mo);
      Mrg=lerp(0.85,0.93,mo);Mid=5;Mwood=0;
    }else{                                            // stucco
      const n1=fbm(x*36,y*36,4,seed+47);
      const n2=fbm(x*130,y*130,3,seed+53);
      h=(n1-0.5)*0.022*REL+(n2-0.5)*0.006*REL;
      worley(x*3.2,y*3.2,seed+59,0.95);
      const crack=1-smoothstep(0,0.05,W_f2-W_f1);
      const creg=smoothstep(0.45,0.75,fbm(x*0.35,y*0.35,3,seed+61));
      h-=crack*creg*0.012*REL;
      const t=0.94+n1*0.14;
      r*=t;gg*=t;b*=t;
      r=lerp(r,r*0.55,crack*creg);gg=lerp(gg,gg*0.55,crack*creg);b=lerp(b,b*0.55,crack*creg);
      Mrg=0.88;Mwood=0;
    }
    Mh=h;Mr=r;Mg=gg;Mb=b;
  }

  /* ---------- foundation ---------- */
  function foundation(x,y){
    Mid=5;Mmet=0;Mwood=0;
    let r=150,gg=147,b=140,h=-0.02,rg=0.9;
    if(P.found==="cmu"){
      const bh2=7.625*IN,bl=15.625*IN,mj=0.375*IN;
      const row=Math.floor(y/(bh2+mj)),col=Math.floor(x/(bl+mj));
      const fx2=x/(bl+mj)-col,fy2=y/(bh2+mj)-row;
      const dj=Math.min(Math.min(fx2,1-fx2)*bl,Math.min(fy2,1-fy2)*bh2);
      const face=smoothstep(mj*0.4-ftPerPx,mj*0.4+ftPerPx,dj);
      h=-0.02-0.03*(1-face)*REL;
      const t=0.92+hashi(col,row,seed+67)*0.16;
      r*=t;gg*=t;b*=t;
      r=lerp(r,168,1-face);gg=lerp(gg,166,1-face);b=lerp(b,158,1-face);
    }else if(P.found==="brick"){
      const row=Math.floor(y/cH),off=(row&1)?uL*0.5:0,col=Math.floor((x+off)/uL);
      const fx2=(x+off)/uL-col,fy2=y/cH-row;
      const dj=Math.min(Math.min(fx2,1-fx2)*uL,Math.min(fy2,1-fy2)*cH);
      const face=smoothstep(mortar*0.5-ftPerPx,mortar*0.5+ftPerPx,dj);
      const bh3=hashi(col,row,seed+71);
      h=-0.02-0.035*(1-face)*REL;
      r=126+bh3*46;gg=74+bh3*26;b=62+bh3*22;
      r=lerp(r,190,1-face);gg=lerp(gg,184,1-face);b=lerp(b,172,1-face);
    }else if(P.found==="stone"){
      worley(x*1.9,y*2.6,seed+73,0.95);
      const face=smoothstep(0.04,0.12,W_f2-W_f1);
      const sh=hashi(W_cx,W_cy,seed+79);
      h=-0.02-0.06*(1-face)*REL+face*(sh-0.5)*0.05*REL;
      const t=0.6+sh*0.55;
      r=140*t;gg=134*t;b=124*t;
      r=lerp(r,180,1-face);gg=lerp(gg,174,1-face);b=lerp(b,164,1-face);
    }else{
      const n=fbm(x*22,y*22,4,seed+83);
      h=-0.02+(n-0.5)*0.012*REL;
      const t=0.9+n*0.2;
      r*=t;gg*=t;b*=t;
      const form=1-smoothstep(0,0.02,edgeDist(y,4));
      h-=form*0.004;
    }
    Mh=h;Mr=r;Mg=gg;Mb=b;Mrg=rg;
  }

  /* ---------- glass ----------
     pv runs 0 at the bottom of the lite to 1 at the top; a vertical pane
     reflects sky up top and ground below, so it brightens upward. Grime is a
     dielectric film: it dulls the mirror and takes the metallicity with it. */
  function glass(pu,pv,edgeD,nx,ny,paneSeed,lit){
    /* Glass from outside is a dark room with a bright sky reflected on it, and
       the two do not meet in the middle: the reflection is strong at the top of
       the pane where the sky is and dies away down it. Ramping the two linearly
       gave every pane the same mid grey, which is why the windows read as flat
       slabs cut in the wall rather than as glass. */
    const sky=pv*pv*pv;
    let r=lerp(14,104,sky),g2=lerp(18,116,sky),b=lerp(26,136,sky);
    const refl=fbm(nx*3.2,ny*1.4,2,paneSeed)*(0.35+sky);
    r+=refl*30;g2+=refl*32;b+=refl*34;
    Gemis=0;
    if(lit){r=lerp(r,236,0.74);g2=lerp(g2,208,0.74);b=lerp(b,150,0.74);Gemis=0.85;}
    let rough=P.glassRough,met=P.glassMetal;
    const amt=P.glassGrime*(1+P.aband*1.2);
    if(amt>0){
      const dust=(1-smoothstep(0,0.24,pv))*0.75            // settles on the bottom rail
                +(1-smoothstep(0,0.10,edgeD))*0.55;        // and creeps in from the edges
      const film=fbm(nx*7,ny*7,3,paneSeed+13);
      const runs=fbm(nx*26,ny*1.7,3,paneSeed+17);          // rain runs, stretched vertically
      const gA=clamp(clamp((dust*0.5+film*0.55+runs*0.42-0.34)*1.8,0,1)*amt,0,0.95);
      rough=lerp(rough,0.68,gA);
      met=met*(1-gA*0.88);
      const haze=gA*0.62;
      r=lerp(r,r*0.60+98,haze);g2=lerp(g2,g2*0.60+96,haze);b=lerp(b,b*0.60+92,haze);
      Gemis*=(1-gA*0.5);
    }
    Gr=r;Gg=g2;Gb=b;Grough=rough;Gmet=met;
  }

  /* ---------- boarding over an opening ----------
     Nobody screws a neat sheet over a window. Boarding goes up in a hurry, out
     of whatever was in the van: planks laid across the opening, not quite level
     because nobody reached for a level, with daylight between them where the
     lengths did not match, and nails driven where the board crosses something
     solid to nail into. Then somebody prises one off to get in, and the ones
     nearest the ground go first.

     Returns false where there is no plank, so the caller falls through and
     draws what is behind — which, in a boarded house, is the dark of the room. */
  /* The lean, the plank count and the panel centre are fixed for a given
     opening, and an opening's texels arrive in runs, so a one-entry memo takes
     the hash, both trig calls and the division off the per-texel path. */
  let Bsd=NaN,Bw=-1,Bhg=-1,Bca=1,Bsa=0,Bcx=0,Bcy=0,Bn=2,Bph=1;
  function boardPanel(lx,ly,w,hgt,sd){
    Mid=8;Mmet=0;Mwood=1;
    if(sd!==Bsd||w!==Bw||hgt!==Bhg){
      Bsd=sd;Bw=w;Bhg=hgt;
      /* the whole set leans: one nail goes in first and the rest follow it */
      const ang=(hashi(sd,1,seed+301)-0.5)*0.13;
      Bca=Math.cos(ang);Bsa=Math.sin(ang);
      Bcx=w*0.5;Bcy=hgt*0.5;
      const pw=(P.boardMat==="planks")?0.72:0.98;    // salvaged stock is narrower
      Bn=Math.max(2,Math.round(hgt/pw));
      Bph=hgt/Bn;
    }
    const ux=(lx-Bcx)*Bca+(ly-Bcy)*Bsa+Bcx;
    const uy=-(lx-Bcx)*Bsa+(ly-Bcy)*Bca+Bcy;
    const n=Bn,ph=Bph;
    const pi=Math.floor(uy/ph);
    if(pi<0||pi>=n)return false;
    const f=uy/ph-pi;
    /* the gap between two planks is never zero: they were cut long ago, for
       something else */
    const gap=0.055+hashi(pi,3,sd+7)*0.05;
    if(f<gap*0.5||f>1-gap*0.5)return false;
    /* prised off, the low ones first, because that is where a person is */
    const pry=hashi(pi,11,sd+13);
    const reach=1-smoothstep(0,hgt*0.75,uy);
    if(pry<(0.10+0.34*reach)*P.aband*(1-P.boardUp*0.55))return false;
    /* and one plank in a set is usually just short */
    const runIn=hashi(pi,17,sd+19)*0.30;
    if(hashi(pi,23,sd+29)<0.22&&ux<w*runIn)return false;

    let r=150,gg=126,b=92,h=0.09,rg=0.86;
    if(P.boardMat==="osb"){
      /* chipped strand: flakes lying flat, furring up at a cut edge once it has
         had a winter of rain on it */
      worley(ux*26,uy*26,sd+3,0.95);
      const fl=smoothstep(0.05,0.32,W_f2-W_f1);
      const ch=hashi(W_cx,W_cy,sd+5);
      const t=0.72+ch*0.55;
      r=168*t;gg=134*t;b=88*t;
      h+=(0.5-fl)*0.008;
      r=lerp(r,r*0.7,1-fl);gg=lerp(gg,gg*0.7,1-fl);b=lerp(b,b*0.7,1-fl);
      rg=0.9;
    }else if(P.boardMat==="ply"){
      const grain=fbm(ux*90,uy*7,4,sd+7);
      const t=0.85+grain*0.3;
      r=176*t;gg=142*t;b=98*t;
      h+=(grain-0.5)*0.006;
      const de=1-smoothstep(0,0.06,Math.min(f,1-f)*ph);   // ply delaminates at the edge first
      h-=de*0.014;r*=1-de*0.22;gg*=1-de*0.22;b*=1-de*0.20;
      rg=0.82;
    }else{
      const t=0.66+hashi(pi,1,sd+11)*0.52;           // every plank off a different pile
      r=150*t;gg=124*t;b=94*t;
      const grain=fbm(ux*70,uy*9,3,sd+13);
      h+=(grain-0.5)*0.010;
      const gt=0.92+grain*0.18;
      r*=gt;gg*=gt;b*=gt;
      rg=0.88;
    }
    /* a plank is a board with two arrises, so it rounds off top and bottom */
    const bev=smoothstep(0,0.035,Math.min(f,1-f)*ph);
    h-=(1-bev)*0.02;
    const shade=1-(1-bev)*0.30;
    r*=shade;gg*=shade;b*=shade;
    /* nails where the plank crosses something worth nailing into — the jambs —
       rather than scattered across the middle where there is only glass */
    const endD=Math.min(ux,w-ux);
    if(endD<0.42){
      const ny=(0.30+hashi(pi,31,sd+37)*0.40)*ph;
      const nx=0.14+hashi(pi,41,sd+43)*0.16;
      const dnx=endD-nx,dny=f*ph-ny;
      const dn=Math.sqrt(dnx*dnx+dny*dny);
      const sm=1-smoothstep(0.020,0.032,dn);
      if(sm>0){
        h-=sm*0.012;
        r=lerp(r,86,sm);gg=lerp(gg,80,sm);b=lerp(b,76,sm);
        Mmet=lerp(0,0.85,sm);rg=lerp(rg,0.5,sm);
      }
      /* uy climbs, so the stain wants dny below the nail — water goes down */
      const run=(dny<0)?Math.exp(dny/0.10)*(1-smoothstep(0.02,0.05,Math.abs(dnx)))*P.rust:0;
      if(run>0){r=lerp(r,124,run*0.7);gg=lerp(gg,72,run*0.7);b=lerp(b,46,run*0.7);}
    }
    Mh=h;Mr=r;Mg=gg;Mb=b;Mrg=rg;
    return true;
  }

  const band=Math.max(2,Math.round(16384/TW));
  let yy=0;

  function pass1(){
    use(par,face);
    const end=Math.min(TH,yy+band);
    for(;yy<end;yy++){
      const wy=(1-(yy+0.5)/TH)*FH;                   // feet above grade
      const rowOps=[];
      for(const o of ops)if(wy>o.y0-1.6&&wy<o.y1+1.4)rowOps.push(o);
      const sillAbove=[];
      if(P.streak>0)for(const o of ops)if(o.type==="window"&&o.y0>wy)sillAbove.push(o);
      // which storey band are we in
      const storey=clamp(Math.floor((wy-P.foundH)/P.storeyH),0,P.storeys-1);
      const floorY=P.foundH+storey*P.storeyH;

      for(let xx=0;xx<TW;xx++){
        const wx=(xx+0.5)/TW*FW,i=yy*TW+xx;

        /* ---- silhouette ---- */
        let alpha=1;
        if(g.gableH>0){
          const top=g.wallTop+g.eaveBand;
          if(wy>top){
            const t=(wy-top)/g.gableH;
            const half=(FW/2)*(1-t);
            const d=Math.abs(wx-FW/2)-half;
            alpha=1-smoothstep(0,ftPerPx*1.4,d);
          }
        }else if(wy>g.wallTop+g.eaveBand){alpha=0;}
        if(g.chimW>0&&wy<g.chimTop&&
           wx>g.chimX-g.chimW*0.5&&wx<g.chimX+g.chimW*0.5)alpha=1;
        if(alpha<=0.004){
          ALP[i]=0;HGT[i]=0;RGH[i]=200;AOc[i]=255;A[i*3]=A[i*3+1]=A[i*3+2]=0;
          continue;
        }

        let r,gg,b,h,rg,id,met=0,emis=0,wood=0;

        /* ---- base surface by band ---- */
        const inFound=wy<P.foundH;
        if(inFound){foundation(wx,wy);}
        else if(wy>g.wallTop&&g.roof==="eave"){
          /* Fascia only, deliberately. A soffit is the underside of the eave
             overhang: it faces straight down, and these maps only ever land on
             a side or a top face of some 3D geometry, so nothing ever looks at
             it. The overhang belongs to the roof in the engine. What belongs on
             the wall plane is the board the gutter is nailed to, and the gutter
             hanging off it — and then the wall stops. */
          const d=wy-g.wallTop,t=d/Math.max(0.01,g.eaveBand);
          Mh=0.16-(1-t)*0.03;                          // the bottom edge falls away
          const sh=0.90+t*0.12;                        // and sits in the gutter's shade
          Mr=trim[0]*sh;Mg=trim[1]*sh;Mb=trim[2]*sh;Mrg=0.52;Mid=2;Mwood=1;
          /* fascia comes in lengths and is butted, same as any other trim run */
          const bj=1-smoothstep(0,0.022,edgeDist(wx,12));
          if(bj>0){Mh-=bj*0.02;Mr*=1-bj*0.20;Mg*=1-bj*0.20;Mb*=1-bj*0.20;}
        }else if(wy>g.wallTop&&g.roof==="flat"){
          const d=wy-g.wallTop;                        // parapet cap
          Mh=(d<g.eaveBand-0.35)?0.06:0.20;
          const sh=(d<g.eaveBand-0.35)?0.92:1.0;
          Mr=trim[0]*sh;Mg=trim[1]*sh;Mb=trim[2]*sh;Mrg=0.6;Mid=2;Mwood=1;
        }else{cladding(wx,wy);}
        r=Mr;gg=Mg;b=Mb;h=Mh;rg=Mrg;id=Mid;wood=Mwood;

        /* ---- gable field above the eave line ---- */
        if(g.gableH>0&&wy>g.wallTop+g.eaveBand){
          cladding(wx,wy);
          r=Mr;gg=Mg;b=Mb;h=Mh;rg=Mrg;id=Mid;wood=Mwood;
          const top=g.wallTop+g.eaveBand;
          const t=(wy-top)/g.gableH;
          const half=(FW/2)*(1-t);
          const d=half-Math.abs(wx-FW/2);
          const rake=1-smoothstep(0.5,0.62,d);        // rake board along the slope
          if(rake>0){r=lerp(r,trim[0],rake);gg=lerp(gg,trim[1],rake);b=lerp(b,trim[2],rake);
            h=lerp(h,0.11,rake);rg=lerp(rg,0.55,rake);id=2;}
          if(P.gableVent){
            const vy=top+g.gableH*0.42;
            const vw=Math.min(2.0,FW*0.09),vh=vw*0.78;
            const dx=Math.abs(wx-FW/2),dy=Math.abs(wy-vy);
            if(dx<vw&&dy<vh){
              const fr=Math.min(0.16,vw*0.18);
              if(dx>vw-fr||dy>vh-fr){                 // surround
                r=trim[0];gg=trim[1];b=trim[2];h=0.13;rg=0.55;id=2;wood=1;
              }else{                                  // louvre blades in shadow
                const lp=Math.max(0.06,vh*0.16);
                const f=(wy/lp)-Math.floor(wy/lp);
                const sh=0.30+f*0.62;
                r=30+34*sh;gg=29+32*sh;b=28*sh+26;
                h=-0.18+f*0.07;rg=0.82;id=2;wood=1;
              }
            }
          }
        }

        /* ---- horizontal trim bands ---- */
        if(!inFound&&waterT>0&&wy>=P.foundH&&wy<P.foundH+waterT){
          const t=(wy-P.foundH)/waterT;
          r=trim[0];gg=trim[1];b=trim[2];rg=0.55;id=2;wood=1;
          h=0.09-t*0.02;
        }
        if(P.bandBoard&&P.storeys>1){
          for(let s=1;s<P.storeys;s++){
            const by=P.foundH+s*P.storeyH;
            if(wy>by-0.32&&wy<by+0.12){
              r=trim[0];gg=trim[1];b=trim[2];rg=0.55;id=2;wood=1;
              h=0.08;
            }
          }
        }
        if(friezeH>0&&wy<g.wallTop&&wy>g.wallTop-friezeH){
          r=trim[0];gg=trim[1];b=trim[2];rg=0.55;id=2;wood=1;h=0.07;
        }
        /* corner boards */
        if(cornerW>0){
          const dc=Math.min(wx,FW-wx);
          if(dc<cornerW&&wy<g.wallTop){
            const e=1-smoothstep(cornerW-ftPerPx,cornerW,dc);
            r=lerp(r,trim[0],e);gg=lerp(gg,trim[1],e);b=lerp(b,trim[2],e);
            h=lerp(h,0.085,e);rg=lerp(rg,0.55,e);if(e>0.5){id=2;wood=1;}
          }
        }
        /* gutter and downspout */
        if(P.gutter&&g.roof==="eave"){
          /* a 5 in K-style gutter, but never taller than the board it hangs on */
          const gTop=g.wallTop+g.eaveBand,gH=Math.min(0.42,g.eaveBand),gBot=gTop-gH;
          if(wy>gBot&&wy<=gTop){
            const t=(wy-gBot)/gH;                       // 0 at the bottom lip, 1 at the bead
            /* K-style ogee: bead, hollow face, step, lower face, rolled underside */
            let hh3,sh3;
            if(t>0.88){hh3=0.36;sh3=1.06;}              // top bead catches the light
            else if(t>0.62){hh3=0.30;sh3=0.90;}         // hollow of the ogee
            else if(t>0.46){hh3=0.35;sh3=1.02;}         // the step back out
            else if(t>0.18){hh3=0.32;sh3=0.84;}         // lower face
            else{hh3=0.32-(0.18-t)*0.55;sh3=0.58;}      // rolls under, in shadow
            h=hh3;
            r=gutC[0]*sh3;gg=gutC[1]*sh3;b=gutC[2]*sh3;
            rg=0.38;met=0.55;id=4;wood=0;
            /* lengths join every 10 ft */
            const sm=1-smoothstep(0,0.022,edgeDist(wx,10));
            if(sm>0){h+=sm*0.012;r*=1-sm*0.18;gg*=1-sm*0.18;b*=1-sm*0.18;}
            /* hangers every 2.5 ft, visible through the trough */
            const hg=1-smoothstep(0,0.035,edgeDist(wx,2.5));
            if(hg>0&&t>0.66&&t<0.90){
              const hm=hg*smoothstep(0.66,0.72,t)*(1-smoothstep(0.84,0.90,t));
              r*=1-hm*0.45;gg*=1-hm*0.45;b*=1-hm*0.45;h-=hm*0.02;
            }
            /* grime collects in the trough and streaks the face */
            const dirt=fbm(wx*3.2,wy*9,3,seed+153);
            const grimeG=clamp((dirt-0.42)*1.8,0,1)*(0.35+P.grunge*0.65)*(1-smoothstep(0.2,0.7,t));
            r=lerp(r,r*0.55+10,grimeG);gg=lerp(gg,gg*0.55+9,grimeG);b=lerp(b,b*0.54+8,grimeG);
            rg=lerp(rg,0.9,grimeG*0.8);met=lerp(met,0.1,grimeG*0.8);
          }
          /* downspout: from under the gutter all the way to grade */
          const dsx=FW-0.95,dsHalf=0.145;
          const dsTop=gBot+0.06;
          if(wy<dsTop){
            const outlet=(wy>dsTop-0.5)?1:0;            // the elbow at the top is wider
            const half=dsHalf*(outlet?1.22:1);
            const du=(wx-dsx)/half;
            if(du>-1&&du<1){
              const round=1-du*du;
              h=0.22+round*0.07;
              const sh4=0.72+round*0.36;
              r=gutC[0]*sh4;gg=gutC[1]*sh4;b=gutC[2]*sh4;
              rg=0.40;met=0.55;id=4;wood=0;
              /* straps every 4 ft and a seam every 10 */
              const st2=1-smoothstep(0,0.05,edgeDist(wy,4));
              if(st2>0){h+=st2*0.03;r*=1-st2*0.22;gg*=1-st2*0.22;b*=1-st2*0.22;}
              const sm2=1-smoothstep(0,0.02,edgeDist(wy,10));
              if(sm2>0){r*=1-sm2*0.15;gg*=1-sm2*0.15;b*=1-sm2*0.15;}
              /* rust and dirt, worst at the bottom where it stays wet */
              const rustD=clamp(smoothstep(3.0,0,wy)*0.7+fbm(wy*4,wx*4,3,seed+157)*0.5-0.25,0,1)
                          *(0.3+P.rust*0.7);
              r=lerp(r,124,rustD*0.55);gg=lerp(gg,78,rustD*0.55);b=lerp(b,50,rustD*0.55);
              rg=lerp(rg,0.92,rustD*0.6);met=lerp(met,0.15,rustD*0.6);
            }
          }
        }

        /* ---- openings ---- */
        let inOpening=0;
        for(let k=0;k<rowOps.length;k++){
          const o=rowOps[k];
          const cw=casing;
          if(wx<o.x0-cw-0.85||wx>o.x1+cw+0.85)continue;
          const w=o.x1-o.x0,hh=o.y1-o.y0;
          let lx=wx-o.x0,ly=wy-o.y0;

          if(o.type==="door"){
            /* steps */
            if(P.steps&&wy<P.foundH&&wx>o.x0-0.5&&wx<o.x1+0.5){
              const n=Math.max(1,Math.round(P.foundH/0.6));
              const si=Math.floor(wy/(P.foundH/n));
              const f=wy/(P.foundH/n)-si;
              const t=0.86+hashi(si,5,seed+91)*0.2;
              r=150*t;gg=146*t;b=138*t;rg=0.9;id=5;wood=0;
              h=0.55-si*0.14-f*0.02;
              inOpening=1;
            }
            /* hood */
            if(o.hood){
              const hy=o.y1+0.55;
              if(wy>o.y1+0.1&&wy<hy+0.35&&wx>o.x0-0.9&&wx<o.x1+0.9){
                r=trim[0];gg=trim[1];b=trim[2];rg=0.5;id=2;wood=1;
                h=0.45-(wy-o.y1-0.1)*0.25;
                inOpening=1;
              }
            }
          }
          if(wx<o.x0-cw||wx>o.x1+cw||wy<o.y0-cw-(o.type==="door"?0:0.30)||wy>o.y1+cw)continue;

          /* casing band */
          const inX=wx>o.x0&&wx<o.x1,inY=wy>o.y0&&wy<o.y1;
          if(!(inX&&inY)){
            /* sill and apron under a window */
            if(o.type==="window"&&wy<o.y0){
              const d=o.y0-wy;
              if(d<0.20){h=0.20-d*0.35;r=trim[0]*0.98;gg=trim[1]*0.98;b=trim[2]*0.98;}
              else{h=0.10;r=trim[0]*0.92;gg=trim[1]*0.92;b=trim[2]*0.92;}
              rg=0.5;id=2;wood=1;inOpening=1;continue;
            }
            const e=1-smoothstep(cw-ftPerPx,cw,Math.min(
              Math.min(wx-(o.x0-cw),(o.x1+cw)-wx),Math.min(wy-(o.y0-cw),(o.y1+cw)-wy)));
            r=lerp(r,trim[0],1);gg=lerp(gg,trim[1],1);b=lerp(b,trim[2],1);
            h=0.10;rg=0.5;id=2;wood=1;inOpening=1;
            continue;
          }

          inOpening=1;
          const sd=(seed+((o.x0*13+o.y0*7)|0)*17)|0;

          /* boarded over */
          if(o.boarded){
            const cover=o.partial?0.72:1.0;
            if(ly<hh*cover){
              if(boardPanel(lx,ly,w,hh*cover,sd)){
                r=Mr;gg=Mg;b=Mb;h=Mh;rg=Mrg;id=Mid;met=Mmet;wood=1;
                continue;
              }
              /* through a gap between planks you see the dark of the room, not
                 the window that used to be in it */
              const dk=0.9+fbm(lx*9,ly*9,2,sd+51)*0.7;
              r=17*dk;gg=16*dk;b=16*dk;h=-0.46;rg=0.94;id=3;met=0;wood=0;
              continue;
            }
          }

          /* the opening proper */
          if(o.type==="door"){
            const jam=0.10;
            const th=o.transomH||0;
            if(lx<jam||lx>w-jam||ly>hh-jam){
              h=-0.06;r=trim[0]*0.9;gg=trim[1]*0.9;b=trim[2]*0.9;rg=0.55;id=2;wood=1;continue;
            }
            if(th>0&&ly>hh-th){                          // fanlight over the door
              const ty=ly-(hh-th);
              if(ty<0.14){                               // the rail it sits on
                h=-0.02;r=trim[0]*0.94;gg=trim[1]*0.94;b=trim[2]*0.94;rg=0.52;id=2;wood=1;continue;
              }
              const tw=w-2*jam,thh=th-0.14-jam;
              const pu=(lx-jam)/tw,pv=clamp((ty-0.14)/Math.max(0.05,thh),0,1);
              const edgeD=Math.min(Math.min(pu,1-pu),Math.min(pv,1-pv));
              glass(pu,pv,edgeD,lx,ly,(sd+733)|0,false);
              r=Gr;gg=Gg;b=Gb;rg=Grough;met=Gmet;emis=Gemis;
              h=-0.28;id=3;wood=0;continue;
            }
            const dhh=hh-th;
            const dx=lx-jam,dy=ly-jam,dw=w-2*jam,dh=dhh-2*jam;
            h=-0.22;r=doorC[0];gg=doorC[1];b=doorC[2];rg=0.45;id=9;wood=1;
            const grain=fbm(dx*70,dy*7,3,sd+19);
            r*=0.94+grain*0.12;gg*=0.94+grain*0.12;b*=0.94+grain*0.12;
            if(P.doorStyle!=="flush"){
              const half=P.doorStyle==="half";
              const rowsN=P.doorStyle==="p4"?2:3;
              const stile=0.34,rail=0.32;
              let inPanel=0,pd=0;
              if(half){
                if(dy>dh*0.52+rail*0.5){
                  const px0=stile,px1=dw-stile,py0=dh*0.52+rail*0.5,py1=dh-rail;
                  if(dx>px0&&dx<px1&&dy>py0&&dy<py1){
                    inPanel=2;pd=Math.min(Math.min(dx-px0,px1-dx),Math.min(dy-py0,py1-dy));
                  }
                }else{
                  const px0=stile,px1=dw-stile,py0=rail,py1=dh*0.52-rail*0.5;
                  if(dx>px0&&dx<px1&&dy>py0&&dy<py1){
                    inPanel=1;pd=Math.min(Math.min(dx-px0,px1-dx),Math.min(dy-py0,py1-dy));
                  }
                }
              }else{
                const cols=2,ph=(dh-rail*(rowsN+1))/rowsN,pw=(dw-stile*(cols+1))/cols;
                const ci=Math.floor((dx-stile)/(pw+stile)),ri=Math.floor((dy-rail)/(ph+rail));
                if(ci>=0&&ci<cols&&ri>=0&&ri<rowsN){
                  const px0=stile+ci*(pw+stile),py0=rail+ri*(ph+rail);
                  const ix=dx-px0,iy=dy-py0;
                  if(ix>0&&ix<pw&&iy>0&&iy<ph){inPanel=1;pd=Math.min(Math.min(ix,pw-ix),Math.min(iy,ph-iy));}
                }
              }
              if(inPanel===1){
                const bev=smoothstep(0,0.09,pd);
                h=-0.22-0.028*bev;
                const sh3=lerp(0.78,1.0,bev);
                r*=sh3;gg*=sh3;b*=sh3;
              }else if(inPanel===2){                 // glazed upper panel
                const px0=stile,px1=dw-stile,py0=dh*0.52+rail*0.5,py1=dh-rail;
                const pu=clamp((dx-px0)/Math.max(0.05,px1-px0),0,1);
                const pv=clamp((dy-py0)/Math.max(0.05,py1-py0),0,1);
                const edgeD=Math.min(Math.min(pu,1-pu),Math.min(pv,1-pv));
                glass(pu,pv,edgeD,dx,dy,(sd+331)|0,false);
                r=Gr;gg=Gg;b=Gb;rg=Grough;met=Gmet;emis=Gemis;
                h=-0.30;id=3;wood=0;
              }
            }
            /* knob */
            const kx=dx-(dw-0.30),ky=dy-dh*0.45;
            const kd=Math.sqrt(kx*kx+ky*ky*1.1025);
            if(kd<0.075){
              const km=1-smoothstep(0.055,0.075,kd);
              h=lerp(h,-0.10,km);
              r=lerp(r,186,km);gg=lerp(gg,158,km);b=lerp(b,92,km);
              rg=lerp(rg,0.22,km);met=lerp(met,0.9,km);if(km>0.5)id=4;
            }
            continue;
          }

          /* window */
          /* The jamb is the RETURN into the opening — a surface facing sideways
             into a hole, which sees almost no sky. Drawing it at 88% of the
             casing made the whole window one flat pale rectangle with a black
             middle; at 58% the opening reads as a hole with a frame in it,
             which is what a window is. */
          const jam=0.075;
          if(lx<jam||lx>w-jam||ly<jam*0.6||ly>hh-jam){
            h=-0.16;r=trim[0]*0.58;gg=trim[1]*0.58;b=trim[2]*0.60;rg=0.62;id=2;wood=1;continue;
          }
          const gx=lx-jam,gy2=ly-jam*0.6,gw=w-2*jam,gh=hh-jam-jam*0.6;
          /* which sash we are in. At most three, so the walk is cheaper than the
             branch it replaced, and the front one wins where two overlap —
             which is exactly how a slider's panels pass one another. */
          const SS=o.sash||DEFSASH;
          const su=clamp(gx/gw,0,1),sv=clamp(gy2/gh,0,1);
          let S=SS[SS.length-1];
          for(let q=0;q<SS.length;q++){
            const c=SS[q];
            if(su>=c.u0&&su<=c.u1&&sv>=c.v0&&sv<=c.v1){S=c;break;}
          }
          const sw=(S.u1-S.u0)*gw,shh=(S.v1-S.v0)*gh;
          const sx2=gx-S.u0*gw,sy2=gy2-S.v0*gh;
          const dz=S.back*0.12;                       // a sash behind sits 1.4 in back
          const st=0.14;                              // stile / rail width
          if(sx2<st||sx2>sw-st||sy2<st*0.8||sy2>shh-st*0.8){
            /* the sash face is painted trim and catches the light, but it sits
               back behind the jamb — and the one behind sits back again, which
               is what stops a pair of sashes reading as one grid */
            h=-(0.30+dz);
            const t=S.back?0.80:0.90;
            r=trim[0]*t;gg=trim[1]*t;b=trim[2]*t;rg=0.5;id=2;wood=1;continue;
          }
          /* glass and muntins */
          const px=sx2-st,py=sy2-st*0.8,pw=sw-2*st,ph=shh-1.6*st;
          const cols=Math.max(1,S.lc|0),rows=Math.max(1,S.lr|0);
          const cwid=pw/cols,chei=ph/rows;
          const ci=clamp(Math.floor(px/cwid),0,cols-1),ri=clamp(Math.floor(py/chei),0,rows-1);
          const mx=px-ci*cwid,my=py-ri*chei;
          const mw=0.055;
          const isMuntin=(ci>0&&mx<mw)||(ci<cols-1&&cwid-mx<mw)||(ri>0&&my<mw)||(ri<rows-1&&chei-my<mw);
          if(isMuntin){
            h=-(0.34+dz);
            const t=S.back?0.76:0.86;
            r=trim[0]*t;gg=trim[1]*t;b=trim[2]*t;rg=0.5;id=2;wood=1;continue;
          }
          /* the pane itself, set back behind its own muntins */
          h=-(0.40+dz);
          id=3;wood=0;
          const paneSeed=(o.brokeSeed+ci*31+ri*7+S.s1)|0;
          const brokeP=(hashi(ci+S.s2,ri+S.s3,o.brokeSeed)<P.broken*AB);
          const pu=mx/cwid,pv=my/chei;
          const edgeD=Math.min(Math.min(pu,1-pu),Math.min(pv,1-pv));
          glass(pu,pv,edgeD,gx,gy2,paneSeed,o.lit&&!brokeP);
          let gr=Gr,gg2=Gg,gb=Gb;
          rg=Grough;met=Gmet;emis=Gemis;
          if(o.obscured){                             // a bathroom light is not clear glass
            const ob=fbm(gx*34,gy2*34,3,paneSeed+21);
            gr=lerp(gr,150+ob*40,0.72);gg2=lerp(gg2,156+ob*40,0.72);gb=lerp(gb,152+ob*38,0.72);
            rg=lerp(rg,0.42,0.7);met=met*0.35;
          }
          if(brokeP){
            /* shards left at the edge, a hole in the middle: the void is not
               glass at all, so it loses the reflection and the metallicity */
            const jag=fbm(px*22,py*22,3,paneSeed+5)*0.16;
            const keep=smoothstep(0.10+jag,0.02+jag,edgeD);
            gr=lerp(10,gr,keep);gg2=lerp(11,gg2,keep);gb=lerp(13,gb,keep);
            rg=lerp(0.92,rg,keep);
            met=met*keep;
            h-=(1-keep)*0.05;
            if(keep>0.5&&keep<0.75){gr+=60;gg2+=64;gb+=70;}
            emis=0;
          }else{
            const ck=1-smoothstep(0,0.012,Math.abs(fbm(px*9,py*9,2,paneSeed+9)-0.5)-0.20);
            if(ck>0&&P.broken*AB>0.15){
              gr=lerp(gr,190,ck*0.5);gg2=lerp(gg2,196,ck*0.5);gb=lerp(gb,206,ck*0.5);
              rg=lerp(rg,0.55,ck*0.6);met=met*(1-ck*0.5);
            }
          }
          r=gr;gg=gg2;b=gb;
          continue;
        }

        /* ---- shutters ---- */
        if(P.shutter!=="none"&&!inOpening){
          for(let k=0;k<rowOps.length;k++){
            const o=rowOps[k];
            if(o.type!=="window")continue;
            const sw=(o.x1-o.x0)*0.5,gap=casing+0.03;
            const l0=o.x0-gap-sw,l1=o.x0-gap,r0=o.x1+gap,r1=o.x1+gap+sw;
            const inL=wx>l0&&wx<l1,inR=wx>r0&&wx<r1;
            if((inL||inR)&&wy>o.y0-0.02&&wy<o.y1+0.02){
              const lx2=inL?wx-l0:wx-r0,ly2=wy-o.y0,hh2=o.y1-o.y0;
              r=shutC[0];gg=shutC[1];b=shutC[2];rg=0.55;id=2;wood=1;h=0.13;
              const fr=0.10;
              if(lx2>fr&&lx2<sw-fr&&ly2>fr&&ly2<hh2-fr){
                if(P.shutter==="louver"){
                  const lp=0.085;
                  const f=(ly2/lp)-Math.floor(ly2/lp);
                  h=0.11-f*0.03;
                  const sh5=0.72+f*0.5;
                  r*=sh5;gg*=sh5;b*=sh5;
                }else{
                  const pd2=Math.min(Math.min(lx2-fr,sw-fr-lx2),Math.min(ly2-fr,hh2-fr-ly2));
                  const bev=smoothstep(0,0.07,pd2);
                  h=0.13-0.03*bev;
                  const sh5=lerp(0.8,1,bev);
                  r*=sh5;gg*=sh5;b*=sh5;
                }
              }
              inOpening=1;
              break;
            }
          }
        }

        /* ---- service furniture: only the working faces carry it ---- */
        if(!isFront()&&!inOpening&&alpha>0.5){
          for(let fi=0;fi<FURN.length;fi++){
            const f=FURN[fi];
            if(wx<f.x0||wx>f.x1||wy<f.y0||wy>f.y1)continue;
            const lx=wx-f.x0,ly=wy-f.y0,fw=f.x1-f.x0,fh=f.y1-f.y0;

            if(f.kind==="meter"){                      // grey box on a plywood board
              const bd=0.12;
              if(lx<bd||lx>fw-bd||ly<bd||ly>fh-bd){
                r=118;gg=112;b=102;h=0.10;rg=0.86;id=6;wood=1;
              }else{
                const dial=1-smoothstep(0.10,0.16,
                  Math.hypot(lx-fw*0.5,ly-fh*0.62));
                r=lerp(150,206,dial);gg=lerp(152,208,dial);b=lerp(150,200,dial);
                h=0.20+dial*0.05;rg=lerp(0.42,0.14,dial);id=4;met=lerp(0.7,0.1,dial);wood=0;
              }
            }else if(f.kind==="stack"){                // cast or ABS vent stack
              const d=Math.abs(lx-fw*0.5)/(fw*0.5);
              const round=Math.sqrt(Math.max(0,1-d*d));
              r=52+18*round;gg=50+17*round;b=49+16*round;
              h=0.16*round+0.04;rg=0.62;id=7;met=0.1;wood=0;
              if(ly>fh-0.35){r*=0.8;gg*=0.8;b*=0.8;}   // the collar at the eave
            }else if(f.kind==="dryer"){
              /* hood above, dark louvre slot below it — ly runs upward, so the
                 slot is the BOTTOM of the box, and the hood needs to be darker
                 than the siding or it vanishes into it */
              const dx6=Math.abs(lx-fw*0.5)/(fw*0.5),t6=ly/fh;
              if(dx6<0.92){
                if(t6<0.30){                           // the louvre in shadow
                  r=24;gg=23;b=22;h=-0.02;rg=0.92;id=2;met=0;wood=0;
                }else{
                  const dome=Math.sqrt(Math.max(0,1-dx6*dx6))*(0.4+0.6*(t6-0.3));
                  const sh6=0.55+0.45*dome;
                  r=168*sh6;gg=166*sh6;b=160*sh6;
                  h=0.06+0.16*dome;rg=0.44;id=2;met=0.2;wood=0;
                  if(t6<0.42){r*=0.6;gg*=0.6;b*=0.6;}  // the lip's own shadow
                }
              }
            }else if(f.kind==="bib"){
              /* escutcheon with a spout dropping out of it, in weathered brass
                 — a pale disc on pale siding is invisible from any distance */
              const cxb=fw*0.5,cyb=fh*0.66;
              const d=Math.hypot(lx-cxb,(ly-cyb)*1.15);
              const spout=(Math.abs(lx-cxb)<fw*0.16&&ly<cyb&&ly>fh*0.05);
              if(d<fh*0.42||spout){
                const round=spout?(1-Math.abs(lx-cxb)/(fw*0.16)):(1-d/(fh*0.42));
                const sh7=0.42+0.58*Math.sqrt(Math.max(0,round));
                r=142*sh7;gg=112*sh7;b=62*sh7;
                h=0.06+0.13*round;rg=0.30;id=4;met=0.85;wood=0;
              }
            }else if(f.kind==="light"){
              /* a wall lantern reads by its silhouette: a back plate, a glass
                 body that tapers, and a cap — a radial blob reads as a hole */
              const t8=ly/fh,dx8=Math.abs(lx-fw*0.5)/(fw*0.5);
              const taper=0.34+0.62*(1-Math.abs(t8-0.45)*1.5);
              if(t8>0.86){                             // back plate at the top
                if(dx8<0.5){r=34;gg=32;b=30;h=0.08;rg=0.5;met=0.5;id=4;wood=0;}
              }else if(t8>0.70){                       // cap
                if(dx8<0.78){r=40;gg=38;b=35;h=0.20;rg=0.45;met=0.55;id=4;wood=0;}
              }else if(t8>0.14&&dx8<taper){            // glass body
                const c=0.72+0.28*(1-dx8/Math.max(0.05,taper));
                r=206*c;gg=196*c;b=158*c;rg=0.12;met=0.3;id=3;h=0.17;wood=0;
                if(P.litWin){emis=0.92;r=255;gg=228;b=172;}
              }else if(t8<=0.14&&dx8<0.34){            // finial under the glass
                r=36;gg=34;b=32;h=0.12;rg=0.45;met=0.55;id=4;wood=0;
              }
            }else if(f.kind==="chimney"){              // brick stack running past the eave
              const bw=0.66,bh=0.24,mj=0.03;           // brick, course, joint (feet)
              /* an exterior stack is fatter at the base and steps in at a
                 shoulder just below the roofline; skip the texel entirely
                 outside that profile so the siding shows through */
              const sh0=g.roofTop-1.6,sh1=g.roofTop-0.5;
              const wide=f.wide||0;
              const half=fw*0.5+wide*0.5*(1-smoothstep(sh0,sh1,wy));
              if(Math.abs(wx-(f.x0+fw*0.5))>half)break;
              const cxr=Math.abs(lx-fw*0.5)/(fw*0.5);
              const row=Math.floor(ly/bh),off=(row&1)?bw*0.5:0;
              const jx=edgeDist(lx+off,bw),jy=edgeDist(ly,bh);
              const joint=1-smoothstep(mj*0.5,mj*1.4,Math.min(jx,jy));
              const bk=hashi(Math.floor((lx+off)/bw),row,seed+771);
              r=lerp(126,158,bk);gg=lerp(66,86,bk);b=lerp(54,66,bk);
              h=0.30-cxr*0.06;rg=0.88;id=5;wood=0;met=0;
              if(joint>0.4){r=lerp(r,158,0.8);gg=lerp(gg,152,0.8);b=lerp(b,142,0.8);h-=0.03;}
              if(ly>fh-0.55){                          // cap and flue
                r=150;gg=146;b=138;h=0.34;rg=0.8;
                if(Math.abs(lx-fw*0.5)<fw*0.18&&ly>fh-0.30){r=28;gg=26;b=25;h=0.20;}
              }
              inOpening=1;                             // masonry, not siding: no lap shading
            }
            break;
          }
        }

        /* ================= weathering ================= */
        const isPaint=(id===1&&wood>0)||id===2||id===9;
        const needAge=(P.fade>0&&isPaint)||P.mildew>0||P.rot>0||(P.peel>0&&isPaint);
        const nAge=needAge?fbm(wx*1.1,wy*1.1,3,seed+101):0.5;
        const nFine=(P.splash>0)?fbm(wx*9,wy*9,3,seed+103):0.5;

        if(P.fade>0&&isPaint){
          const up=smoothstep(0,g.wallTop,wy);
          const f=P.fade*(0.35+up*0.65)*(0.4+nAge*0.9);
          r=lerp(r,r*0.82+52,f*0.55);gg=lerp(gg,gg*0.82+52,f*0.55);b=lerp(b,b*0.82+50,f*0.55);
          rg=lerp(rg,0.92,f*0.7);
        }
        if(P.peel>0&&isPaint&&wood>0){
          /* Paint fails a BOARD at a time.

             A board is one piece of wood with one history: milled from one log,
             hung on one day, given one coat. When the film lets go it lets go
             from that board's own butt and its own ends inwards, and the board
             beside it can still be sound. Driving the failure from isotropic
             noise instead — which is what this did — puts camouflage blotches
             across the elevation, and the give-away is that they run straight
             over the course lines as if the siding underneath were not there.

             So the field is mostly the BOARD's own luck, pushed up wherever
             water gets at it: the butt it sheds onto, the cut ends, and the
             bottom few feet that take the splash. The fine noise is only there
             to keep the boundary off a clean rectangle. */
          const onBoard=(id===1&&P.clad!=="stucco");
          const wet=smoothstep(3.2,0,wy)*0.5;
          const nEdge=fbm(wx*17,wy*17,2,seed+109);
          let fieldP;
          if(onBoard){
            const bAge=hashi(Mboard,Mcourse*31+5,seed+105);
            const endIn=1-smoothstep(0,0.16,Math.min(Mbu,1-Mbu));   // in from the cut ends
            const buttUp=1-smoothstep(0,0.34,Mbv);                  // up from the wet butt
            fieldP=bAge*0.62+endIn*0.20+buttUp*0.24+nEdge*0.16+nAge*0.08+wet*0.8;
          }else{
            /* joinery peels at its own edges instead: panel bevels and board ends */
            const jointEdge=(id===9||id===2)
              ?smoothstep(0.55,0.85,fbm(wx*5.5,wy*5.5,2,seed+111))*0.34:0;
            fieldP=fbm(wx*3.1,wy*3.1,3,seed+105)*0.62+nAge*0.42+nEdge*0.18+jointEdge+wet;
          }
          /* the field now centres near 0.5 with most of its spread coming from
             the board's own draw, so the threshold is set to take roughly a
             sixth of the boards at a quarter turn and about half at full */
          const t1=1.00-P.peel*0.50,t2=1.14-P.peel*0.58*P.bare;
          const toUnder=smoothstep(t1,t1+0.018,fieldP);
          const toBare=smoothstep(t2,t2+0.018,fieldP)*P.bare;
          const lip=smoothstep(t1-0.030,t1,fieldP)*(1-toUnder);   // paint curls at the break
          if(lip>0){h+=lip*0.005;r=lerp(r,r*1.08+10,lip*0.5);gg=lerp(gg,gg*1.08+10,lip*0.5);b=lerp(b,b*1.08+10,lip*0.5);}
          if(toUnder>0){
            r=lerp(r,under[0],toUnder);gg=lerp(gg,under[1],toUnder);b=lerp(b,under[2],toUnder);
            rg=lerp(rg,0.88,toUnder);
            h-=toUnder*0.004;
          }
          if(toBare>0){
            const wg=fbm(wx*60,wy*7,4,seed+107);
            const bw2=118+wg*54,bg=100+wg*46,bb=82+wg*38;
            r=lerp(r,bw2,toBare);gg=lerp(gg,bg,toBare);b=lerp(b,bb,toBare);
            rg=lerp(rg,0.95,toBare);
            h-=toBare*0.006;
            id=(id===2)?6:id;
          }
        }
        if(P.rust>0&&wood>0&&(P.clad==="clapboard"||P.clad==="shingle")&&id===1){
          const nsp=1.33;                              // nails every 16 in
          const nx=Math.round(wx/nsp)*nsp;
          const ny=Math.floor(wy/expo)*expo+expo*0.22;
          const dnx=wx-nx,dny=wy-ny,dn=Math.sqrt(dnx*dnx+dny*dny);
          const nm=1-smoothstep(0.012,0.026,dn);
          const run=(wy<ny)?Math.exp(-(ny-wy)/0.5)*(1-smoothstep(0.03,0.09,Math.abs(wx-nx))):0;
          const rustA=clamp(nm*0.9+run*0.55,0,1)*P.rust;
          if(rustA>0){
            r=lerp(r,132,rustA);gg=lerp(gg,74,rustA);b=lerp(b,44,rustA);
            rg=lerp(rg,0.94,rustA);
            h-=nm*0.006;
          }
        }
        /* drip streaks below sills, bands and the gutter */
        if(P.streak>0){
          let src=-1;
          for(let k=0;k<sillAbove.length;k++){
            const o=sillAbove[k];
            if(wx>o.x0-casing&&wx<o.x1+casing&&o.y0>src)src=o.y0;
          }
          const gutY=g.wallTop+g.eaveBand-Math.min(0.42,g.eaveBand);   // the gutter's bottom lip
          if(P.gutter&&gutY>wy&&gutY>src&&hashi(Math.floor(wx*3),1,seed+109)<0.35)src=gutY;
          if(src>0){
            const d=src-wy;
            const col=fbm(wx*7.5,src*0.5,3,seed+113);
            const run=Math.exp(-d/(1.2+col*3.4))*smoothstep(0,0.15,d);
            const s=clamp(run*(col*1.5-0.25),0,1)*P.streak;
            if(s>0){
              r=lerp(r,r*0.62+6,s);gg=lerp(gg,gg*0.63+6,s);b=lerp(b,b*0.60+5,s);
              rg=lerp(rg,0.94,s*0.6);
            }
          }
        }
        if(P.splash>0&&wy<2.4){
          const sp=smoothstep(2.4,0.1,wy)*P.splash*(0.5+nFine*0.8);
          r=lerp(r,r*0.60+16,sp*0.8);gg=lerp(gg,gg*0.60+14,sp*0.8);b=lerp(b,b*0.58+11,sp*0.8);
          rg=lerp(rg,0.95,sp*0.6);
        }
        if(P.mildew>0&&isPaint){
          const shade=smoothstep(g.wallTop-2.2,g.wallTop,wy)*0.7+smoothstep(1.8,0,wy)*0.5;
          const m=clamp(shade*smoothstep(0.45,0.78,nAge),0,1)*P.mildew;
          r=lerp(r,52,m*0.7);gg=lerp(gg,58,m*0.7);b=lerp(b,44,m*0.7);
          rg=lerp(rg,0.97,m*0.6);
        }
        if(P.rot>0&&wood>0&&wy<1.6){
          const rt=smoothstep(1.6,0.05,wy)*P.rot*smoothstep(0.4,0.75,nAge);
          if(rt>0){
            const fib=fbm(wx*46,wy*11,3,seed+117);
            r=lerp(r,58+fib*32,rt);gg=lerp(gg,48+fib*26,rt);b=lerp(b,38+fib*20,rt);
            rg=lerp(rg,0.98,rt);
            h-=rt*0.02*(0.4+fib);
          }
        }
        /* siding fails a board at a time, so pick whole boards and tear their ends */
        if(AB>0&&P.missing>0&&id===1){
          let ms=0;
          if(wood>0&&(P.clad!=="stucco")){
            const flagged=hashi(Mboard,Mcourse*7+3,seed+121)<P.missing*AB*0.55;
            if(flagged){
              const frag=fbm(wx*2.2,wy*5.5,3,seed+122);
              ms=smoothstep(0.40,0.52,frag);            // ragged remains of the board
            }
          }else{
            ms=smoothstep(0.80-P.missing*AB*0.2,0.88-P.missing*AB*0.2,fbm(wx*1.1,wy*1.1,4,seed+121));
          }
          if(ms>0){
            const felt=fbm(wx*30,wy*30,3,seed+123);
            const lap=1-smoothstep(0,0.03,edgeDist(wy,1.5));
            let fr=42+felt*24,fg2=39+felt*21,fb=37+felt*19;
            const stud=1-smoothstep(0.05,0.09,Math.abs(((wx/1.333)-Math.floor(wx/1.333))-0.5)*1.333);
            fr*=1-stud*0.30;fg2*=1-stud*0.30;fb*=1-stud*0.30;   // studs read through the felt
            fr*=1-lap*0.2;fg2*=1-lap*0.2;fb*=1-lap*0.2;
            r=lerp(r,fr,ms);gg=lerp(gg,fg2,ms);b=lerp(b,fb,ms);
            rg=lerp(rg,0.96,ms);
            h=lerp(h,-0.07,ms);
            if(ms>0.5){id=6;wood=0;}
          }
        }
        /* graffiti and vines */
        if(AB>0){
          const su=wx/FW,sv=1-wy/FH;
          const gA=(P.graffiti>0)?sample(su,sv,0):0;
          const gcov=gA*P.graffiti*AB;
          if(gcov>0.02){
            /* the stencil composites the tag over black, so R and G both come
               back multiplied by the same alpha — R is the coverage we want,
               but G has to be divided back out or the anti-aliased rim of every
               letter walks down the palette and haloes the tag in another
               colour entirely */
            const hue=clamp(sample(su,sv,1)/Math.max(gA,1e-3),0,0.999);
            const pc=GPAL[Math.min(GPAL.length-1,Math.floor(hue*GPAL.length))];
            const pr=pc[0],pg=pc[1],pb=pc[2];
            const cov=clamp(gcov*1.9,0,1);
            r=lerp(r,pr,cov);gg=lerp(gg,pg,cov);b=lerp(b,pb,cov);
            rg=lerp(rg,0.7,cov*0.6);
          }
          const vcov=(P.vines>0)?sample(su,sv,2)*P.vines*AB:0;
          if(vcov>0.02){
            const cov=clamp(vcov*2.2,0,1);
            const vn=fbm(wx*30,wy*30,3,seed+127);
            r=lerp(r,44+vn*40,cov);gg=lerp(gg,62+vn*52,cov);b=lerp(b,34+vn*28,cov);
            rg=lerp(rg,0.92,cov);
            h=lerp(h,h+0.05,cov);
          }
        }
        if(P.grunge>0){
          const gA=fbm(wx*0.55,wy*0.55,3,seed+131);
          const gB=fbm(wx*4.5,wy*4.5,3,seed+133);
          let filth=clamp((gA*0.6+gB*0.4-0.40)*2.2,0,1)*P.grunge*(0.65+(1-smoothstep(0,6,wy))*0.6);
          filth=clamp(filth,0,0.85);
          r=r*lerp(1,0.52,filth)+filth*6;
          gg=gg*lerp(1,0.53,filth)+filth*6;
          b=b*lerp(1,0.50,filth)+filth*5;
          rg=lerp(rg,0.95,filth*0.6);
        }

        HGT[i]=h;
        A[i*3]=r;A[i*3+1]=gg;A[i*3+2]=b;
        RGH[i]=clamp(rg,0.03,1)*255;
        MET[i]=clamp(met,0,1)*255;
        IDm[i]=id;
        EMI[i]=clamp(emis,0,1)*255;
        ALP[i]=clamp(alpha,0,1)*255;
        AOc[i]=255;
      }
    }
    if(yy<TH){io.progress(yy/TH*0.62);setTimeout(pass1,0);}
    else{io.progress(0.68);setTimeout(pass2,0);}
  }

  function pass2(){
    use(par,face);
    const pxPerFt=TW/FW;
    /* THREE radii, each matched to a real feature, because one radius can only
       ever see one size of thing — and the old pair could see neither of the
       two that matter.

       A blur radius says "how far away do I look for something taller than me".
       The old first radius was 0.7 in: at 37 px/ft that is two texels, so under
       a clapboard butt the blur was almost the butt itself and the difference
       came out at a couple of per cent. The old second was 6 in, which inside a
       three-foot window is all window — so a four-inch-deep opening went dark
       in a thin line at its edge and nowhere else. The height map had the
       relief in it the whole time; the AO pass was throwing it away.

       So: half a siding course, which is what makes the lap read; a hand's
       width, which is what makes a casing, a sill or a batten read; and most of
       a window, which is what makes a recessed opening go dark across its whole
       face the way a real one does. */
    /* These radii are feature sizes in feet, so their ceilings have to be in
       feet too. A fixed pixel cap made the shading a function of the resolution
       slider — and resolution is deliberately per face, so a front at 2048 and
       a side at 4096 came out shaded differently on the same house. What is
       left is a sanity bound against a pathological aspect, and it is generous
       because the blur is O(1) per texel in its radius. */
    const rCap=Math.max(8,Math.min(TW,TH)>>2);
    const r1=clamp(Math.round(pxPerFt*Math.max(expo,0.12)*0.55),2,rCap);
    const r2=clamp(Math.round(pxPerFt*0.34),3,rCap);   // 4 in — casing, sill, batten
    const r3=clamp(Math.round(pxPerFt*1.35),8,rCap);   // 16 in — the opening as a whole
    const sc=1/0.28;                                   // a 3-4 in recess reads as full occlusion
    const N=TW*TH;
    /* The broad term is the one that says "you are inside a hole"; the tight
       ones say "you are against something". Screening rather than adding them
       keeps a texel that is both from going past black — and because screening
       is a product, each radius can be folded in and thrown away before the
       next one is taken. Holding all three blurs live costs 12 bytes a texel on
       an image whose height is the facade's real aspect, not TW; folding costs
       4, and the accumulator is released before the normal pass runs. */
    let acc=new Float32Array(N);acc.fill(1);
    const fold=(rad,gain,w)=>{
      let b=boxBlur(HGT,TW,TH,rad);
      for(let i=0;i<N;i++){
        if(!ALP[i])continue;
        const c=clamp((b[i]-HGT[i])*sc*gain,0,1);
        acc[i]*=(1-c*w);
      }
      b=null;
    };
    fold(r1,2.6,0.55);fold(r2,1.9,0.70);fold(r3,1.15,0.80);
    for(let i=0;i<N;i++){
      if(!ALP[i]){AOc[i]=255;continue;}
      AOc[i]=clamp(1-(1-acc[i])*P.aoStr,0,1)*255;
    }
    acc=null;
    io.progress(0.85);
    hMin=Infinity;hMax=-Infinity;
    for(let i=0;i<TW*TH;i++){if(!ALP[i])continue;const h=HGT[i];if(h<hMin)hMin=h;if(h>hMax)hMax=h;}
    if(!isFinite(hMin)){hMin=0;hMax=1;}
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;
    const gy=P.flipG?-1:1;
    const ftPerTexel=FW/TW;
    for(let y=0;y<TH;y++){
      const yp=Math.min(TH-1,y+1)*TW,ym=Math.max(0,y-1)*TW,y0=y*TW;
      for(let x=0;x<TW;x++){
        const xp=Math.min(TW-1,x+1),xm=Math.max(0,x-1);
        const sx=(HGT[y0+xp]-HGT[y0+xm])/(2*ftPerTexel)*P.normalStr;
        const sy=(HGT[yp+x]-HGT[ym+x])/(2*ftPerTexel)*P.normalStr;
        let nx=-sx,ny=-sy*gy;
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;
        const i=(y0+x)*3;
        NRM[i]=(nx*0.5+0.5)*255;NRM[i+1]=(ny*0.5+0.5)*255;NRM[i+2]=(inv*0.5+0.5)*255;
      }
    }
    io.progress(1);
    io.done({A:A,RGH:RGH,MET:MET,AO:AOc,NRM:NRM,HGT:HGT,ALP:ALP,EMI:EMI,ID:IDm,hMin:hMin,hMax:hMax});
  }
  io.progress(0.02);setTimeout(pass1,0);
}


/* ============================ shared controls ============================
   The cladding, openings, glass, trim, weathering, abandonment and map
   groups describe the same house whichever face you are drawing, so they
   live here and both modes compose them. Rows that only make sense on the
   street front carry need:"front", which only the front mode reports. */

const CONTROLS={
  cladding:function(){return {title:"Cladding",open:true,rows:[
      {id:"clad",type:"select",label:"Material",value:"clapboard",options:[
        ["clapboard","Clapboard / lap siding"],["vinyl","Vinyl siding"],["batten","Board and batten"],
        ["shingle","Wood shingle"],["brick","Brick"],["stucco","Stucco"],["stone","Stone veneer"]]},
      {id:"exposure",need:"lap",label:"Exposure",unit:"in",min:2,max:12,step:0.25,value:5},
      {id:"boardLen",need:"lap",label:"Board length",unit:"ft",min:4,max:16,step:0.5,value:12},
      {id:"battenSpace",need:"batten",label:"Batten spacing",unit:"in",min:8,max:32,step:1,value:16},
      {id:"courseH",need:"masonry",label:"Course height",unit:"in",min:1.5,max:8,step:0.05,value:2.67},
      {id:"unitLen",need:"masonry",label:"Unit length",unit:"in",min:4,max:24,step:0.25,value:8},
      {id:"mortarW",need:"masonry",label:"Mortar joint",unit:"in",min:0.12,max:1.2,step:0.02,value:0.38},
      {id:"cladRelief",label:"Relief depth",min:0,max:2.5,step:0.05,value:1},
      {id:"lapShade",label:"Course shadow line",min:0,max:1,step:0.01,value:0.6},
      {id:"cladIrreg",label:"Irregularity",min:0,max:1,step:0.01,value:0.45},
      {type:"colors",label:"Wall · trim · undercoat",items:[
        {id:"cWall",value:"#b9bcae"},{id:"cTrim",value:"#efece1"},{id:"cUnder",value:"#8f7f63"}]}
    ]};},
  openings:function(){return {title:"Openings",open:true,rows:[
      {id:"bays",need:["front","back"],label:"Bays across",min:1,max:7,step:1,value:3},
      {id:"winW",label:"Window width",unit:"ft",min:1.5,max:8,step:0.1,value:3},
      {id:"winH",label:"Window height",unit:"ft",min:2,max:8,step:0.1,value:4.8},
      {id:"sillH",label:"Sill above floor",unit:"ft",min:0.5,max:5,step:0.1,value:2.6},
      {id:"winStyle",type:"select",label:"Window type",value:"dh",options:[
        ["dh","Double-hung"],["dh1","Double-hung, no muntins"],
        ["case","Casement pair"],["slide","Horizontal slider"],
        ["pic","Picture window with flankers"],
        ["mixed","Picture below, double-hung above"]]},
      {id:"liteC",label:"Lites across",min:1,max:6,step:1,value:2},
      {id:"liteR",label:"Lites down (per sash)",min:1,max:6,step:1,value:1},
      {id:"casingW",label:"Casing width",unit:"in",min:1,max:10,step:0.25,value:3.5},
      {id:"shutter",type:"select",label:"Shutters",value:"none",options:[
        ["none","None"],["louver","Louvered"],["panel","Panelled"]]},
      {id:"doorBay",need:"front",label:"Door in bay",min:1,max:7,step:1,value:2},
      {id:"doorW",label:"Door width",unit:"ft",min:2.2,max:6,step:0.1,value:3},
      {id:"doorStyle",type:"select",label:"Door style",value:"p6",options:[
        ["p6","Six panel"],["p4","Four panel"],["half","Half light"],["flush","Flush"]]},
      {type:"colors",label:"Door · shutter · roof",items:[
        {id:"cDoor",value:"#5c3a2e"},{id:"cShut",value:"#2f4438"},{id:"cRoof",value:"#4a4642"}]},
      {type:"checks",need:"front",items:[
        {id:"transom",label:"Transom over door",value:false},
        {id:"doorHood",label:"Hood over door",value:true}]},
      {type:"checks",items:[
        {id:"steps",label:"Steps at the door",value:true},
        {id:"litWin",label:"Lights on inside",value:false}]}
    ]};},
  glass:function(){return {title:"Glass",open:true,rows:[
      {id:"glassRough",label:"Roughness",min:0.01,max:0.6,step:0.01,value:0.06},
      {id:"glassMetal",label:"Metallicity",min:0,max:1,step:0.01,value:0.85},
      {id:"glassGrime",label:"Grime & film",min:0,max:1,step:0.01,value:0.35},
      {type:"note",html:"Glass is a dielectric, so metallicity is a <b>deliberate cheat</b>: on an opaque "+
        "facade plane a metallic pane picks up the environment and reads like glass, "+
        "where metallic&nbsp;0 just looks like flat dark paint. If your engine does real "+
        "transparent glass, set this to 0 and drive it from the material ID map instead. "+
        "Grime is dirt, so it raises roughness and pulls metallicity back down."}
    ]};},
  trim:function(){return {title:"Trim & roofline",rows:[
      {id:"cornerW",label:"Corner boards",unit:"in",min:0,max:12,step:0.25,value:4},
      {id:"friezeH",label:"Frieze board",unit:"in",min:0,max:20,step:0.5,value:7},
      {id:"waterT",label:"Water table",unit:"in",min:0,max:14,step:0.5,value:5},
      {id:"fasciaD",label:"Fascia depth",unit:"in",min:6,max:16,step:0.5,value:8},
      {id:"found",type:"select",label:"Foundation material",value:"poured",options:[
        ["poured","Poured concrete"],["cmu","Concrete block"],["brick","Brick"],["stone","Stone"]]},
      {type:"colors",label:"Gutter colour",items:[{id:"cGutter",value:"#e8e5da"}]},
      {type:"checks",items:[
        {id:"gutter",label:"Gutter and downspout",value:true},
        {id:"bandBoard",label:"Band board between storeys",value:true},
        {id:"gableVent",label:"Gable vent",value:true}]},
      {type:"note",html:"There is no soffit control because there is no soffit. A soffit is the "+
        "<b>underside</b> of the eave overhang, and every map here is meant to be applied to 3D "+
        "geometry that is only ever seen from the side or from above &mdash; nothing looks up. "+
        "The overhang is roof geometry in your engine; the wall plane carries the fascia, the "+
        "gutter hanging off it, and stops. Fascia depth therefore sets the whole eave band, so "+
        "it also sets how much of the board shows below the gutter."}
    ]};},
  weathering:function(){return {title:"Weathering",open:true,rows:[
      {id:"fade",label:"Sun fade & chalking",min:0,max:1,step:0.01,value:0.4},
      {id:"peel",label:"Peeling paint",min:0,max:1,step:0.01,value:0.3},
      {id:"bare",label:"Bare wood showing",min:0,max:1,step:0.01,value:0.35},
      {id:"streak",label:"Drip streaks",min:0,max:1,step:0.01,value:0.45},
      {id:"splash",label:"Splash-back at grade",min:0,max:1,step:0.01,value:0.45},
      {id:"mildew",label:"Mildew in the shade",min:0,max:1,step:0.01,value:0.35},
      {id:"rust",label:"Nail rust",min:0,max:1,step:0.01,value:0.35},
      {id:"rot",label:"Rot at the base",min:0,max:1,step:0.01,value:0.25},
      {id:"grunge",label:"Overall grunge",min:0,max:1,step:0.01,value:0.4}
    ]};},
  abandonment:function(){return {title:"Abandonment",open:true,rows:[
      {id:"aband",label:"Derelict",min:0,max:1,step:0.01,value:0},
      {id:"boardUp",need:"ab",label:"Windows boarded",min:0,max:1,step:0.01,value:0.6},
      {id:"boardMat",need:"ab",type:"select",label:"Board material",value:"osb",options:[
        ["osb","OSB"],["ply","Plywood"],["planks","Salvaged planks"]]},
      {id:"broken",need:"ab",label:"Broken glass",min:0,max:1,step:0.01,value:0.55},
      {id:"graffiti",need:"ab",label:"Graffiti",min:0,max:1,step:0.01,value:0.4},
      {id:"graffFont",need:"ab",type:"font",label:"Graffiti face",value:"auto",
       noneLabel:"Scrawl — no typeface",autoLabel:"Any face loaded"},
      {id:"graffText",need:"ab",type:"text",label:"Tags",value:"KRSN, VOID, 92, OBEY, RIP",
       placeholder:"comma separated",maxlength:120},
      {type:"note",need:"ab",html:"Graffiti is <b>writing</b>, so it is drawn with a typeface rather "+
        "than as curly strokes. The app ships no font: three of the six graffiti faces in this "+
        "repository's <code>fonts/</code> are personal-use cuts and three came with no licence at "+
        "all, so publishing them would be redistributing them. <b>Load…</b> takes one straight from "+
        "its bytes — nothing is fetched and nothing is published. Served over http from the "+
        "repository root the six are found on their own; opened as a file they cannot be, and the "+
        "mode falls back to a scrawl."},
      {id:"vines",need:"ab",label:"Vines and weeds",min:0,max:1,step:0.01,value:0.4},
      {id:"missing",need:"ab",label:"Missing siding",min:0,max:1,step:0.01,value:0.3}
    ]};},
  maps:function(){return {title:"Maps",rows:[
      {id:"normalStr",label:"Normal strength",min:0.1,max:3,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:1},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX)",value:false}]}
    ]};},
};

/* The house half of each preset — everything about the building rather than
   the face you happen to be looking at. Both modes offer the same names, so
   setting "colonial" on the front and on the side gives one house. */
const PRESETS=[
    {id:"colonial",label:"Colonial",set:{glassRough:0.06,glassMetal:0.85,glassGrime:0.30,facadeW:28,storeys:2,storeyH:9,foundH:1.8,roof:"eave",clad:"clapboard",exposure:5,lapShade:0.6,
      bays:3,winStyle:"dh",winW:3,winH:4.8,sillH:2.6,liteC:2,liteR:3,shutter:"louver",doorBay:2,doorStyle:"p6",
      cWall:"#c8cabc",cTrim:"#f4f1e6",cDoor:"#5c3a2e",cShut:"#2f4438",cornerW:4,friezeH:7,waterT:5,
      fade:0.35,peel:0.2,bare:0.3,streak:0.4,splash:0.4,mildew:0.3,rust:0.3,rot:0.15,grunge:0.35,aband:0}},

    {id:"capecod",label:"Cape Cod",set:{glassRough:0.06,glassMetal:0.85,glassGrime:0.24,facadeW:26,storeys:2,storeyH:8,foundH:1.4,roof:"gable",pitch:10,clad:"clapboard",exposure:5,lapShade:0.62,
      bays:3,winStyle:"dh",winW:2.8,winH:4.2,sillH:2.6,liteC:2,liteR:3,shutter:"louver",doorBay:2,doorStyle:"p6",
      cWall:"#e6e4dc",cTrim:"#ffffff",cDoor:"#8a2f2a",cShut:"#22333f",cornerW:4,friezeH:6,waterT:4,
      fade:0.28,peel:0.12,bare:0.2,streak:0.3,splash:0.35,mildew:0.28,rust:0.2,rot:0.1,grunge:0.3,aband:0}},

    {id:"farmhouse",label:"White farmhouse",set:{glassRough:0.07,glassMetal:0.85,glassGrime:0.34,facadeW:30,storeys:2,storeyH:9.5,foundH:2,roof:"gable",pitch:9,clad:"clapboard",exposure:6,lapShade:0.68,
      bays:3,winStyle:"dh",winW:3,winH:5.4,sillH:2.5,liteC:1,liteR:2,shutter:"none",doorBay:2,doorStyle:"half",
      cWall:"#efeee7",cTrim:"#ffffff",cDoor:"#25402f",cornerW:5,friezeH:8,waterT:5,
      fade:0.42,peel:0.3,bare:0.35,streak:0.5,splash:0.5,mildew:0.35,rust:0.35,rot:0.25,grunge:0.4,aband:0}},

    {id:"bungalow",label:"Bungalow",set:{glassRough:0.07,glassMetal:0.85,glassGrime:0.40,facadeW:30,storeys:1,storeyH:10,foundH:2.2,roof:"gable",pitch:5,clad:"shingle",exposure:6,lapShade:0.66,
      bays:3,winStyle:"dh",winW:3.2,winH:4.4,sillH:2.8,liteC:3,liteR:1,shutter:"none",doorBay:2,doorStyle:"half",
      cWall:"#9a8f74",cTrim:"#e8e2d0",cDoor:"#4a3b2a",cRoof:"#43403c",cornerW:5,friezeH:9,waterT:6,
      fade:0.45,peel:0.35,bare:0.4,streak:0.45,splash:0.5,mildew:0.4,rust:0.35,rot:0.25,grunge:0.45,aband:0}},

    {id:"craftsman",label:"Craftsman",set:{glassRough:0.06,glassMetal:0.85,glassGrime:0.34,facadeW:30,storeys:2,storeyH:9,foundH:2.4,roof:"gable",pitch:5,clad:"shingle",exposure:7,lapShade:0.7,
      bays:3,winStyle:"dh",winW:3,winH:4.6,sillH:2.7,liteC:3,liteR:1,shutter:"none",doorBay:2,doorStyle:"half",
      cWall:"#7d7a5e",cTrim:"#e2ddc8",cDoor:"#4a3524",cRoof:"#3e3a35",cornerW:6,friezeH:11,waterT:7,fasciaD:12,found:"stone",
      fade:0.4,peel:0.28,bare:0.35,streak:0.45,splash:0.45,mildew:0.4,rust:0.3,rot:0.2,grunge:0.4,aband:0}},

    {id:"queenanne",label:"Queen Anne",set:{glassRough:0.05,glassMetal:0.88,glassGrime:0.36,facadeW:26,storeys:3,storeyH:10,foundH:2.6,roof:"gable",pitch:11,clad:"clapboard",exposure:4,lapShade:0.72,
      bays:3,winStyle:"dh1",winW:2.8,winH:6,sillH:2.4,liteC:1,liteR:1,shutter:"none",doorBay:2,doorStyle:"half",
      cWall:"#6d5a6b",cTrim:"#e8dcc0",cDoor:"#40241f",cShut:"#3a2a30",cornerW:6,friezeH:12,waterT:7,found:"stone",
      fade:0.4,peel:0.32,bare:0.3,streak:0.55,splash:0.45,mildew:0.42,rust:0.3,rot:0.2,grunge:0.45,aband:0}},

    {id:"ranch",label:"Mid-century ranch",set:{glassRough:0.04,glassMetal:0.9,glassGrime:0.2,facadeW:44,storeys:1,storeyH:8.5,foundH:1.2,roof:"eave",pitch:4,clad:"clapboard",exposure:8,lapShade:0.5,
      bays:4,winStyle:"mixed",winW:3.4,winH:4,sillH:3,liteC:1,liteR:1,shutter:"none",doorBay:2,doorStyle:"flush",
      cWall:"#c2bda8",cTrim:"#f2efe6",cDoor:"#2f5d54",cornerW:3,friezeH:6,waterT:3,fasciaD:11,
      fade:0.3,peel:0.1,bare:0.12,streak:0.3,splash:0.35,mildew:0.28,rust:0.15,rot:0.08,grunge:0.32,aband:0}},

    {id:"vinyl",label:"Vinyl tract",set:{glassRough:0.04,glassMetal:0.9,glassGrime:0.18,facadeW:32,storeys:2,storeyH:8.5,foundH:1.4,roof:"eave",clad:"vinyl",exposure:8,lapShade:0.42,
      bays:4,winStyle:"slide",winW:2.8,winH:4.4,sillH:2.8,liteC:1,liteR:1,shutter:"panel",doorBay:2,doorStyle:"p6",
      cWall:"#d6d3c4",cTrim:"#ffffff",cDoor:"#7a3b32",cShut:"#3a3f4a",cornerW:3,friezeH:5,waterT:3,
      fade:0.25,peel:0.05,bare:0.05,streak:0.3,splash:0.35,mildew:0.3,rust:0.05,rot:0.05,grunge:0.3,aband:0}},

    {id:"shotgun",label:"Shotgun house",set:{glassRough:0.08,glassMetal:0.85,glassGrime:0.44,facadeW:16,storeys:1,storeyH:10,foundH:2.8,roof:"gable",pitch:8,clad:"clapboard",exposure:5,lapShade:0.66,
      bays:2,winStyle:"dh1",winW:2.8,winH:5.6,sillH:2.2,liteC:1,liteR:1,shutter:"none",doorBay:1,doorStyle:"half",
      cWall:"#b8c4bd",cTrim:"#f0ece0",cDoor:"#7a4a2c",cornerW:4,friezeH:8,waterT:5,found:"brick",
      fade:0.55,peel:0.45,bare:0.45,streak:0.6,splash:0.55,mildew:0.5,rust:0.4,rot:0.35,grunge:0.55,aband:0}},

    {id:"rowhouse",label:"Brick rowhouse",set:{glassRough:0.05,glassMetal:0.9,glassGrime:0.45,bandBoard:false,gutter:false,facadeW:20,storeys:3,storeyH:9.5,foundH:2.4,roof:"flat",clad:"brick",courseH:2.67,unitLen:8,lapShade:0.5,
      mortarW:0.38,bays:2,winStyle:"dh1",winW:3.2,winH:5.4,sillH:2.4,liteC:1,liteR:1,shutter:"none",doorBay:1,doorStyle:"half",
      cWall:"#8d5a44",cTrim:"#e6e2d8",cDoor:"#3d4f3a",found:"stone",cornerW:0,friezeH:10,waterT:4,
      fade:0.3,peel:0.15,bare:0.2,streak:0.55,splash:0.5,mildew:0.4,rust:0.2,rot:0.1,grunge:0.5,aband:0}},

    {id:"stucco",label:"Stucco & parapet",set:{glassRough:0.05,glassMetal:0.88,glassGrime:0.3,facadeW:28,storeys:2,storeyH:9.5,foundH:1.2,roof:"flat",clad:"stucco",lapShade:0.3,gutter:false,
      bays:3,winStyle:"case",winW:2.6,winH:4.4,sillH:2.8,liteC:1,liteR:2,shutter:"none",doorBay:2,doorStyle:"p4",
      cWall:"#d8c6a8",cTrim:"#e8dcc4",cDoor:"#4a3a58",cornerW:0,friezeH:0,waterT:0,found:"poured",
      fade:0.5,peel:0.1,bare:0.05,streak:0.5,splash:0.5,mildew:0.3,rust:0.15,rot:0.05,grunge:0.45,aband:0}},

    {id:"abandoned",label:"Abandoned",set:{glassRough:0.10,glassMetal:0.8,glassGrime:0.8,facadeW:28,storeys:2,storeyH:9,foundH:1.8,roof:"eave",clad:"clapboard",exposure:5,lapShade:0.7,
      bays:3,winStyle:"dh",winW:3,winH:4.8,sillH:2.6,liteC:2,liteR:3,shutter:"louver",doorBay:2,doorStyle:"p4",
      cWall:"#a8a893",cTrim:"#ddd8c8",cDoor:"#4a3226",cShut:"#3a4438",cUnder:"#8f7f63",
      fade:0.7,peel:0.75,bare:0.65,streak:0.75,splash:0.7,mildew:0.7,rust:0.6,rot:0.6,grunge:0.7,
      aband:0.8,boardUp:0.7,boardMat:"osb",broken:0.6,graffiti:0.45,vines:0.5,missing:0.35}},

    /* Three derelicts that are derelict in DIFFERENT ways, because "abandoned"
       is not one look. What separates them is which failure came first: nobody
       came back, or the weather got in, or the city came and closed it up. */
    {id:"longempty",label:"Long empty",set:{glassRough:0.12,glassMetal:0.78,glassGrime:0.9,facadeW:26,storeys:2,storeyH:9,foundH:2,roof:"gable",pitch:9,clad:"clapboard",exposure:6,lapShade:0.75,
      bays:3,winStyle:"dh",winW:3,winH:5,sillH:2.5,liteC:1,liteR:2,shutter:"none",doorBay:2,doorStyle:"p4",
      cWall:"#9a9c8a",cTrim:"#cfc9b6",cDoor:"#3e3226",cUnder:"#8a7a5e",
      fade:0.85,peel:0.8,bare:0.75,streak:0.7,splash:0.65,mildew:0.75,rust:0.55,rot:0.55,grunge:0.6,
      aband:0.75,boardUp:0.15,boardMat:"planks",broken:0.45,graffiti:0.08,vines:0.85,missing:0.3}},

    {id:"condemned",label:"Condemned & boarded",set:{glassRough:0.10,glassMetal:0.8,glassGrime:0.85,facadeW:22,storeys:2,storeyH:9.5,foundH:2.2,roof:"flat",clad:"clapboard",exposure:5,lapShade:0.7,
      bays:3,winStyle:"dh1",winW:3,winH:5.2,sillH:2.4,liteC:1,liteR:1,shutter:"none",doorBay:2,doorStyle:"flush",
      cWall:"#8e9184",cTrim:"#c8c2b0",cDoor:"#3a3630",cUnder:"#7e7050",
      fade:0.7,peel:0.6,bare:0.5,streak:0.8,splash:0.7,mildew:0.6,rust:0.7,rot:0.4,grunge:0.75,
      aband:0.9,boardUp:0.95,boardMat:"ply",broken:0.35,graffiti:0.75,vines:0.25,missing:0.2}},

    {id:"burned",label:"Derelict shell",set:{glassRough:0.14,glassMetal:0.75,glassGrime:1.0,facadeW:26,storeys:2,storeyH:9,foundH:2,roof:"flat",clad:"clapboard",exposure:5,lapShade:0.8,
      bays:3,winStyle:"dh1",winW:3,winH:4.8,sillH:2.6,liteC:1,liteR:1,shutter:"none",doorBay:2,doorStyle:"flush",
      cWall:"#6b6559",cTrim:"#9a958a",cDoor:"#33291f",cUnder:"#5a4a38",
      fade:0.9,peel:0.9,bare:0.85,streak:0.85,splash:0.8,mildew:0.8,rust:0.8,rot:0.85,grunge:0.9,
      aband:1,boardUp:0.35,boardMat:"planks",broken:0.95,graffiti:0.7,vines:0.8,missing:0.7}}
];

/* ============================ exports ============================ */

const LAPPY={clapboard:1,vinyl:1,shingle:1};
const MASONRY={brick:1,stone:1};
const PREVIEW_W=200;

/* flat material ID colours */
const IDCOL=[[0,0,0],[178,150,96],[236,236,228],[70,120,168],[186,186,196],
             [150,120,100],[140,104,64],[90,86,82],[196,140,70],[120,70,50]];

/* non-square at uniform texel density; the drag preview keeps the aspect */
function sizeOf(params,face,preview){
  use(params,face);
  const g=geometry();
  if(!preview)return {w:g.TW,h:g.TH};
  const fullW=params.size|0,k=Math.min(1,PREVIEW_W/fullW);
  return {w:Math.max(64,Math.round(fullW*k/4)*4),h:Math.max(64,Math.round(g.TH*k/4)*4)};
}

/* ============================ coordination ============================
   The front, the side, the back and the roof are four textures of ONE
   building, and dialling the same twenty settings into four panels by hand
   is how they end up not matching. With the link on, any parameter two of
   those panels both declare is mirrored across them the moment it changes.

   Resolution is deliberately left out: how many texels you want of a given
   face is a property of the export, not of the house. */
const FAMILY=["house","envelope","roof"];
const NEVER={size:1};
const XCACHE={},LINKED={};

function sharedWith(fromId,toId,P){
  const key=fromId+">"+toId;
  if(XCACHE[key])return XCACHE[key];
  const to=Forge.state(toId);
  if(!to||!to.params)return null;                 // that mode is not loaded yet
  const has={};
  for(const d of to.params)has[d.id]=1;
  const ids=[];
  for(const id in P)if(has[id]&&!NEVER[id])ids.push(id);
  XCACHE[key]=ids;
  return ids;
}

/* Called from each family mode's derive(). Mirrors on the way out AND on the
   edit that switches the link off, so the off state propagates too — otherwise
   the other panels would sit there still believing they were linked. */
function coordinate(fromId,P){
  const on=!!P.linkHouse,was=LINKED[fromId];
  LINKED[fromId]=on;
  if(!on&&!was)return;
  for(const to of FAMILY){
    if(to===fromId)continue;
    const ids=sharedWith(fromId,to,P);
    if(!ids)continue;
    for(const id of ids)Forge.setParam(to,id,P[id]);
    /* the target now holds the link state too, so it must not later fire its
       own "the link just went off" mirror and leak one more edit across */
    LINKED[to]=on;
  }
}

/* The wizard's reading of the same idea the "coordinate" tick serves: walk the
   four faces in the order you would actually decide them, each opening with
   what the ones before it settled on. Front first because it is where the
   building gets its width, its storeys and its roof; the roof last because it
   only needs the pitch and the weathering by then. */
Forge.registerStructure({
  id:"house",
  label:"House",
  blurb:"Front, side, back and roof of one building",
  steps:[
    {id:"front",label:"Front",mode:"house",set:{},
     note:"Start with the street front. Everything you set here — the width and depth, the "+
          "storeys, the roof, the cladding, the trim, the weathering, the seed — is what the "+
          "other three faces open with."},
    {id:"side",label:"Side",mode:"envelope",set:{face:"side"},
     note:"The side is the DEPTH of the same building, and the depth is the one dimension the "+
          "front never showed — so it is yours to set here, and the back will take it from you. "+
          "Everything else arrived already: the width, the storeys, the cladding, the trim, the "+
          "weathering. An eave front presents a gable end here and a gable front presents an "+
          "eave wall; the mode makes that substitution for you."},
    {id:"back",label:"Back",mode:"envelope",set:{face:"back"},
     note:"The back is the same wall stock as the side and inherits it. What is new is the "+
          "service clutter that only ever lands on the face nobody photographs — the meter, "+
          "the vent stack, the dryer vent, the hose bib."},
    {id:"roof",label:"Roof",mode:"roof",set:{},
     note:"Last, because by now it only needs the pitch, the weathering and the seed. This one "+
          "is a tiling material rather than a cut-out face, so its resolution is about texel "+
          "density over the roof plane rather than about the size of a wall."}
  ]
});

window.HouseShell={
  coordinate:coordinate,
  IN:IN,edgeDist:edgeDist,CONTROLS:CONTROLS,PRESETS:PRESETS,
  controls:function(names){return names.map(function(n){return CONTROLS[n]();});},
  LAPPY:LAPPY,MASONRY:MASONRY,IDCOL:IDCOL,PREVIEW_W:PREVIEW_W,
  geometry:function(params,face){use(params,face);return geometry();},
  lastGeo:function(face){return (face&&GEO_BY[face])||GEO;},
  size:sizeOf,
  build:function(params,io,face){use(params,face);return build(params,io);}
};

})();
