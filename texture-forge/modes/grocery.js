/* =====================================================================
   MODE: grocery — supermarket fixtures, stocked
   =====================================================================
   The shelving of a shop, seen the way you see it: standing in the aisle,
   square on to a run of it. Dimensioned in real millimetres — a 1219 mm
   (48") gondola bay, a 560 mm base deck, a 66 mm can — and cut out on
   alpha, so it drops onto a plane at true scale and the sky, or the aisle
   behind it, shows past the ends.

   SEVEN FIXTURES, because a grocery store is not one thing. Dry goods on
   gondola shelving, the produce rack, the meat multideck, the deli
   service counter, the frozen reach-in doors, a promotional end cap and
   a checkout lane. They share a generator and differ in their layout,
   which is roughly how they differ in a real shop.

   ---------------------------------------------------------------------
   ONE SHAPE FOR EVERY PRODUCT

   A can, a cereal box, a bottle of squash, a bag of crisps, a milk
   carton, a tub of yoghurt and a tray of mince are all the same drawing
   problem: a silhouette that changes width as it goes up, wrapped on a
   cross-section that decides how the light falls across it. So each one
   is two small functions —

     prof(v)   half width at height fraction v, so a bottle has a
               shoulder and a neck and a bag has a crimped top
     sect(t)   how far the surface stands proud at t across, -1 to 1, so
               a can is a circle, a carton is flat with an arris and a
               bag is a soft pillow

   — and everything else about them (the shelf shadow, the film sheen,
   the label, the setback, the facings) is written once and applies to
   all of them. Adding a product is adding two lines.

   ---------------------------------------------------------------------
   TWO HEIGHT FIELDS, and this is deliberate

   A shelf is nearly all relief: product stands 300 mm proud of a fixture
   1200 mm wide. Take the normal map straight off that and it is a page
   of black cliffs — every silhouette edge saturates and the labels, the
   can rims and the crimps that actually read at a distance are lost
   under them.

   So HGT carries the TRUE depth, in face-width units, and is what the
   height map and the 16-bit height export are made of. The normals come
   off a second field: the same surface detail at full strength, plus the
   standing depth scaled by the "Relief" control. Set Relief to 1 and the
   two are the same field.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      mulberry32=Forge.mulberry32,fbm=Forge.fbm,hex2rgb=Forge.hex2rgb;

/* ============================ materials ============================
   A material id per texel, exported as the Mat ID channel — which is what
   lets somebody mask every can, or every price rail, in a comp. */
const M={VOID:0,BACK:1,STEEL:2,SHELF:3,RAIL:4,CARD:5,CAN:6,BOTTLE:7,FILM:8,
         PRODUCE:9,MEAT:10,GLASS:11,STEEL_BRIGHT:12,DECK:13,SIGN:14,LAMP:15,
         RUBBER:16,CRATE:17,ICE:18};
const IDCOL=[[0,0,0],[38,42,48],[150,156,164],[196,200,205],[232,232,236],
             [214,132,60],[176,180,190],[120,190,220],[236,226,180],
             [96,178,86],[196,86,96],[130,206,214],[228,232,240],[86,90,96],
             [240,214,80],[255,246,200],[54,54,58],[168,132,86],[210,236,246]];

/* ============================ colour ============================ */

function hsv(h,s,v){
  h=(h%1+1)%1;
  const i=Math.floor(h*6),f=h*6-i;
  const p=v*(1-s),q=v*(1-f*s),t=v*(1-(1-f)*s);
  let r,g,b;
  switch(i%6){
    case 0:r=v;g=t;b=p;break;   case 1:r=q;g=v;b=p;break;
    case 2:r=p;g=v;b=t;break;   case 3:r=p;g=q;b=v;break;
    case 4:r=t;g=p;b=v;break;   default:r=v;g=p;b=q;
  }
  return [r*255,g*255,b*255];
}

/* PACKAGING IS LOUD. A shelf of muted colours reads as a stockroom — brown
   boxes in rows — and not as a shop. So a facing takes a hue off a wheel
   weighted to the colours print likes, a strong version of it for the body, a
   near-complement for the band, and a near-white for the label patch, which is
   what nearly every package on a shelf actually is. */
const HUES=[0.00,0.02,0.05,0.09,0.13,0.16,0.30,0.36,0.45,0.53,0.58,0.63,0.70,0.78,0.88,0.95];
/* meat, cheese, olives, salad — the colours a chiller deck is, and nothing a
   packaging wheel would ever hand you */
const FOOD=[0.99,0.01,0.02,0.04,0.96,0.07,0.11,0.17];
function foodBrand(rng){
  const h=FOOD[(rng()*FOOD.length)|0]+(rng()-0.5)*0.02;
  const s=0.28+rng()*0.44,v=0.52+rng()*0.36;
  return {h:h,body:hsv(h,s,v),band:hsv(h,s*0.55,Math.min(1,v*1.10)),
          pale:[234,234,229],dark:hsv(h,s,v*0.48)};
}
function brand(rng,punch){
  const h=HUES[(rng()*HUES.length)|0]+(rng()-0.5)*0.035;
  const s=clamp((0.50+rng()*0.45)*punch,0.05,1);
  const v=0.58+rng()*0.36;
  return {
    h:h,
    body:hsv(h,s,v),
    band:hsv(h+0.38+rng()*0.22,clamp(s*0.95,0.05,1),clamp(v*(rng()<0.4?0.55:1.1),0.08,1)),
    pale:hsv(h,0.05+rng()*0.09,0.93+rng()*0.06),
    dark:hsv(h,Math.min(1,s*1.15),v*0.30)
  };
}

/* ============================ product shapes ============================
   prof(v): half width at height fraction v (0 at the base, 1 at the top).
   sect(t): how proud the surface is across the item, t in -1..1, 1 at the
            front of it and 0 where the silhouette ends. */
/* the corner of a carton is not a rounding, it is an ARRIS — flat to within a
   few millimetres of the edge and then gone. A section that eases off over a
   tenth of the width gives a row of boxes no edges at all and they read as
   stickers; this holds the face flat and turns it hard at 4% from the side. */
const arris=t=>{const a=Math.abs(t);return a>0.998?0:smoothstep(1.0,0.955,a)*0.34+0.66;};
const round=t=>Math.sqrt(Math.max(0,1-t*t));
const soft =t=>Math.pow(Math.max(0,1-t*t),0.34);

const SHAPE={
  /* a carton: cereal, pasta, crackers, soap powder */
  box:{mat:M.CARD,rough:[0.60,0.84],metal:0,depth:0.34,
       prof:v=>1-smoothstep(0.985,1,v)*0.06,sect:arris},
  /* A CAN IS A PRINTED LABEL ON STEEL, and paper is not a metal. Only the
     rolled rim at each end is bare, which is why a shelf of tins reads as
     colour with two bright lines round it rather than as a row of mirrors. */
  can:{mat:M.CAN,rough:[0.34,0.52],metal:0.10,depth:1.0,rim:0.045,
       prof:v=>(v<0.045||v>0.955)?0.93:1,sect:round},
  /* a bottle: shoulder, neck, cap */
  bottle:{mat:M.BOTTLE,rough:[0.10,0.24],metal:0,depth:1.0,
          prof:function(v){
            if(v<0.60)return 1;
            if(v<0.76)return lerp(1,0.30,smoothstep(0.60,0.76,v));
            if(v<0.92)return 0.30;
            return 0.40;                       // the cap, a shade wider than the neck
          },sect:round},
  /* a jar: squat, wide lid */
  jar:{mat:M.BOTTLE,rough:[0.12,0.26],metal:0,depth:1.0,
       prof:v=>v<0.80?1:(v<0.86?0.90:1.02),sect:round},
  /* a bag: crisps, salad, frozen peas — soft, slumped, crimped at the top */
  bag:{mat:M.FILM,rough:[0.14,0.30],metal:0,depth:0.72,
       prof:function(v){
         if(v>0.93)return 0.34;                // the crimp
         return 0.80+0.20*Math.sin(Math.PI*Math.pow(clamp(v/0.93,0,1),0.85));
       },sect:soft},
  /* a gable-top carton: milk, juice */
  carton:{mat:M.CARD,rough:[0.40,0.58],metal:0,depth:0.62,
          prof:function(v){
            if(v<0.74)return 1;
            if(v<0.96)return lerp(1,0.16,smoothstep(0.74,0.96,v));
            return 0.10;
          },sect:arris},
  /* a tub: yoghurt, ice cream, margarine — a frustum with a lid lip */
  tub:{mat:M.FILM,rough:[0.26,0.42],metal:0,depth:1.0,
       prof:function(v){
         if(v>0.90)return 1.04;                // the lid stands past the wall
         return lerp(0.80,1,smoothstep(0,0.90,v));
       },sect:round},
  /* AN OVERWRAPPED TRAY, seen off a RAKED deck — which is why it is drawn
     taller than it is thick. A chiller deck tips toward the aisle, so what you
     see of a tray of mince is mostly its top: the meat under the film, with a
     band of the white tray under it. */
  tray:{mat:M.MEAT,rough:[0.08,0.20],metal:0,depth:0.34,tray:0.30,
        prof:v=>v<0.10?0.94:1,sect:t=>smoothstep(1,0.86,Math.abs(t))*0.42+0.58}
};

/* ============================ geometry ============================ */

const PIECES=[["gondola","Gondola aisle — dry goods"],
              ["produce","Produce rack — the wet wall"],
              ["meat","Meat & chiller multideck"],
              ["deli","Deli service counter"],
              ["freezer","Frozen reach-in doors"],
              ["endcap","End cap — stacked promotion"],
              ["checkout","Checkout lane"]];

/* how tall the fixture stands and how much of it is canopy, per piece */
function geom(P){
  const piece=P.piece||"gondola";
  const bayW=Math.max(600,+P.bayW||1219);
  const bays=Math.max(1,Math.min(8,P.bays|0||3));
  const FW=bays*bayW;
  const fixH=Math.max(900,+P.fixH||2134);
  /* the multideck and the deli carry a canopy above the top deck; the checkout
     carries its lane pole. Both are part of the silhouette. */
  const canopy=(piece==="meat")?Math.max(0,+P.canopyMm||420)
              :(piece==="deli")?Math.max(0,+P.canopyMm||420)
              :(piece==="checkout")?760:0;
  const FH=fixH+canopy;

  /* Uniform texel density, the height following the fixture's real
     proportions. Capped the way the elevations are: past this the channel
     buffers alone run to hundreds of megabytes, so the WIDTH comes down and
     the density stays even. */
  const thOf=t=>Math.max(8,Math.round(t*FH/FW/4)*4);
  const MAXTEX=32e6;
  const asked=P.size|0;
  let TW=asked;
  if(TW*thOf(TW)>MAXTEX)TW=Math.max(64,Math.round(TW*Math.sqrt(MAXTEX/(TW*thOf(TW)))/4)*4);

  const kick=Math.max(0,+P.kickMm||100);
  const deck=Math.max(kick+40,+P.deckMm||430);   // the base deck's top surface
  const shelves=Math.max(0,Math.min(8,P.shelves|0));
  const deckD=Math.max(200,+P.deckD||560);
  const shelfD=Math.max(150,+P.shelfD||400);

  return {piece:piece,bays:bays,bayW:bayW,FW:FW,FH:FH,fixH:fixH,canopy:canopy,
          kick:kick,deck:deck,shelves:shelves,deckD:deckD,shelfD:shelfD,
          TW:TW,TH:thOf(TW),asked:asked,capped:TW<asked};
}

/* the shelf surfaces, floor upward, with the depth and the headroom each one
   actually has — the top shelf's headroom is whatever is left to the top rail */
function decks(g,deckY){
  const base=deckY===undefined?g.deck:deckY;
  const out=[{y:base,d:g.deckD,base:true}];
  if(g.shelves>0){
    const top=g.fixH-120;
    const room=Math.max(0,top-base);
    const pitch=room/(g.shelves+0.55);
    for(let k=1;k<=g.shelves;k++)out.push({y:base+pitch*k,d:g.shelfD,base:false});
  }
  for(let k=0;k<out.length;k++)
    out[k].room=(k+1<out.length?out[k+1].y:g.fixH)-out[k].y;
  return out;
}

/* ============================ the painter ============================
   Everything in this mode is drawn back to front into the buffers. The one
   primitive is a rectangle in MILLIMETRES, walked in texels, with the callback
   told where inside it each texel lies. Nothing else in here has to think
   about the mm-to-texel conversion, and there is exactly one place that has to
   be right about which way up the image is. */
function painter(g,B){
  const TW=g.TW,TH=g.TH,FW=g.FW,FH=g.FH;
  const mmX=FW/TW,mmY=FH/TH;
  const A=B.A,RGH=B.RGH,MET=B.MET,AOc=B.AO,ALP=B.ALP,HGT=B.HGT,NH=B.NH,
        EMC=B.EMC,MAT=B.MAT;

  /* image row 0 is the TOP of the fixture, so height above the floor counts
     down the image */
  const rowOf=ymm=>(FH-ymm)/mmY;
  const colOf=xmm=>xmm/mmX;

  const P={
    TW:TW,TH:TH,mmX:mmX,mmY:mmY,
    /* MILLIMETRES TO HEIGHT. Every height in this mode is in face-width units,
       the same as every other elevation in the app, so a length in mm has to
       come through here on its way into the field. One term that did not — the
       section bulge — outweighed the rest by the width of the fixture in
       millimetres, which made the height map meaningless and left the Relief
       control scaling a term nothing could see. */
    mm:1/FW,
    /* the smallest thing worth drawing: below a texel and a half a feature is
       noise rather than detail, and every dimension here is clamped to it */
    fine:Math.max(mmX,mmY)*1.5,

    /* x0..x1, y0..y1 in mm with y up. fn(i,u,v) with u across and v up. */
    rect:function(x0,y0,x1,y1,fn){
      if(x1<=x0||y1<=y0)return;
      const c0=Math.max(0,Math.floor(colOf(x0))),c1=Math.min(TW,Math.ceil(colOf(x1)));
      const r0=Math.max(0,Math.floor(rowOf(y1))),r1=Math.min(TH,Math.ceil(rowOf(y0)));
      const iw=1/(x1-x0),ih=1/(y1-y0);
      for(let r=r0;r<r1;r++){
        const ymm=FH-(r+0.5)*mmY,v=(ymm-y0)*ih;
        if(v<0||v>=1)continue;
        const rowi=r*TW;
        for(let c=c0;c<c1;c++){
          const xmm=(c+0.5)*mmX,u=(xmm-x0)*iw;
          if(u<0||u>=1)continue;
          fn(rowi+c,u,v,xmm,ymm);
        }
      }
    },

    /* one texel of one material. Alpha is set by the act of painting: whatever
       nobody paints is the aisle behind the fixture, and stays cut out. */
    put:function(i,col,rough,metal,h,mat,ao){
      A[i*3]=col[0];A[i*3+1]=col[1];A[i*3+2]=col[2];
      RGH[i]=rough*255;MET[i]=metal*255;
      HGT[i]=h;NH[i]=h;
      MAT[i]=mat;ALP[i]=255;
      AOc[i]=(ao===undefined?1:ao)*255;
      EMC[i*3]=EMC[i*3+1]=EMC[i*3+2]=0;
    },
    /* the same, with the two height fields told apart — see the header */
    put2:function(i,col,rough,metal,hTrue,hNorm,mat,ao){
      A[i*3]=col[0];A[i*3+1]=col[1];A[i*3+2]=col[2];
      RGH[i]=rough*255;MET[i]=metal*255;
      HGT[i]=hTrue;NH[i]=hNorm;
      MAT[i]=mat;ALP[i]=255;
      AOc[i]=(ao===undefined?1:ao)*255;
      EMC[i*3]=EMC[i*3+1]=EMC[i*3+2]=0;
    },
    /* GLASS DOES NOT REPLACE WHAT IS BEHIND IT. Whatever was painted first
       shows through: this tints it, lays the sheen over it and moves the
       surface out to the pane — which is why you can still read a pan of
       olives, or a bag of peas, through the door in front of it. */
    glaze:function(i,col,t,rough,hTrue,hNorm){
      A[i*3]=lerp(A[i*3],col[0],t);
      A[i*3+1]=lerp(A[i*3+1],col[1],t);
      A[i*3+2]=lerp(A[i*3+2],col[2],t);
      RGH[i]=clamp(rough,0,1)*255;
      MET[i]=Math.min(MET[i],40);
      HGT[i]=hTrue;NH[i]=hNorm;
      MAT[i]=M.GLASS;
      AOc[i]=Math.max(AOc[i],196);
      ALP[i]=255;
    },
    glow:function(i,col,amt){
      EMC[i*3]=col[0]*amt;EMC[i*3+1]=col[1]*amt;EMC[i*3+2]=col[2]*amt;
    },
    /* a flat slab of one material, the workhorse behind every fixture part */
    slab:function(x0,y0,x1,y1,col,rough,metal,h,mat,ao){
      P.rect(x0,y0,x1,y1,i=>P.put(i,col,rough,metal,h,mat,ao));
    }
  };
  return P;
}

const tint=(c,k)=>[c[0]*k,c[1]*k,c[2]*k];
const mixc=(a,b,t)=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];

/* ============================ one product ============================ */

/* x0..x1 across in mm, standing on `yb` with height `h`, its front face `z`
   millimetres proud of the fixture back. `rel` is how much of that standing
   depth reaches the normal map — see the header. */
function item(P,S,x0,x1,yb,h,z,rel,col,rng,o){
  o=o||{};
  const cx=(x0+x1)*0.5,hw=(x1-x0)*0.5;
  if(hw<=0||h<=0)return;
  const depth=Math.min(hw,(x1-x0)*0.5)*S.depth*P.mm;   // how far the section bulges
  const roughLo=S.rough[0],roughHi=S.rough[1];
  const metal=S.metal||0;
  const mat=S.mat;
  const shelfAbove=o.shelfAbove||0;
  const gloss=o.gloss===undefined?1:o.gloss;
  const labelLo=0.24+rng()*0.10,labelHi=labelLo+0.24+rng()*0.20;
  const stripe=rng()<0.30, capCol=o.capCol||col.dark;
  const bandV=0.50+(rng()-0.5)*0.24;
  const bar=rng()<0.7;
  const wear=o.wear||0;

  P.rect(cx-hw*1.06,yb,cx+hw*1.06,yb+h,function(i,u,v,xmm,ymm){
    const pv=S.prof(v);
    const halfNow=hw*pv;
    const t=(xmm-cx)/Math.max(1e-6,halfNow);
    if(t<-1||t>1)return;
    const d=S.sect(t);
    if(d<=0.001)return;

    /* the surface, in face-width units: the fixture back, plus how far this
       product stands out, plus how far this column of it bulges toward you */
    const front=z+depth*d;
    const hTrue=front;
    const hNorm=z*rel+depth*d;

    /* ---- the label. Nearly every package on a shelf is a coloured ground, a
       band across it and a pale patch with printing on it, and at the size a
       shelf is ever seen that is all of it that reads. ---- */
    let c=col.body;
    const printed=S.tray===undefined;
    const inBand=printed&&Math.abs(v-bandV)<0.085;
    if(stripe&&printed){
      if(Math.abs(t)<0.34)c=col.band;
    }else if(inBand)c=col.band;
    if(printed&&v>labelLo&&v<labelHi&&Math.abs(t)<0.66)c=col.pale;
    if(printed&&bar&&v>0.09&&v<0.155&&t>0.10&&t<0.56)
      c=(Math.floor((xmm/P.fine)%2)?col.dark:col.pale);
    if(S===SHAPE.bottle&&v>0.90)c=capCol;
    if(S===SHAPE.jar&&v>0.80)c=capCol;
    if(S===SHAPE.tub&&v>0.90)c=mixc(col.pale,col.body,0.25);
    const onRim=(S.rim!==undefined)&&(v<S.rim||v>1-S.rim);
    if(onRim)c=[186,190,197];
    if(S.tray!==undefined){
      /* the tray itself below, and the film catching the case light above */
      if(v<S.tray)c=[228,229,225];
      else if(v>0.88)c=mixc(c,[255,255,255],0.30);
      else c=col.body;
    }

    /* ---- shading that is a property of the OBJECT rather than of the light:
       the sides of a round thing turn away, and the deeper a thing sits under
       the shelf above it the less of the room it can see ---- */
    let ao=0.22+0.78*Math.pow(d,0.42);
    if(shelfAbove>0){
      const gap=Math.max(0,shelfAbove-ymm);
      ao*=lerp(0.42,1,smoothstep(0,Math.max(1,h*0.55),gap));
    }
    ao*=lerp(0.72,1,smoothstep(0,h*0.16,ymm-yb));      // the foot of it is in shade
    ao=clamp(ao,0.06,1);

    let rough=lerp(roughHi,roughLo,Math.pow(d,0.7))*(1-gloss*0.25);
    if(wear>0)rough=clamp(rough+wear*0.25*fbm(u*4,v*4,7,2,o.seed|0),0.05,1);
    P.put2(i,tint(c,0.80+0.24*d),clamp(rough,0.04,1),
           (onRim?0.86:metal)*Math.pow(d,0.4),hTrue,hNorm,mat,ao);
  });
}

/* ============================ a run of facings ============================
   A shelf is not a random scatter of products. One line gets a BLOCK of
   facings — three tins of the same soup side by side — and the block next to
   it is a different line. That is what a planogram is, and it is most of what
   makes a shelf read as stocked rather than as noise. */
const MIXES={
  dry:[["box",0.34],["can",0.26],["bottle",0.14],["bag",0.12],["jar",0.09],["carton",0.05]],
  chill:[["tray",0.34],["tub",0.20],["carton",0.16],["bottle",0.14],["bag",0.10],["jar",0.06]],
  frozen:[["bag",0.42],["box",0.30],["tub",0.20],["tray",0.08]],
  drinks:[["bottle",0.48],["can",0.34],["carton",0.12],["jar",0.06]],
  impulse:[["box",0.42],["bag",0.34],["can",0.14],["bottle",0.10]],
  meat:[["tray",0.72],["tub",0.16],["bag",0.12]]
};
function pick(mix,rng){
  let r=rng(),acc=0;
  for(const [k,w] of mix){acc+=w;if(r<acc)return k;}
  return mix[0][0];
}

/* Nominal front width and height in mm for each kind — the sizes real
   packaging comes in, which is why a shelf of them has the right rhythm. */
const SIZES={
  box:[[60,300],[190,300]],  can:[[66,74],[100,122]],
  bottle:[[62,90],[210,320]],jar:[[70,95],[95,150]],
  bag:[[150,260],[190,330]], carton:[[70,95],[190,250]],
  tub:[[85,150],[75,130]],   tray:[[150,250],[95,150]]
};

function stock(P,g,x0,x1,shelf,next,spec,rng){
  const mix=MIXES[spec.mix]||MIXES.dry;
  /* what will actually fit: the gap to the shelf above, less the fascia and
     ticket strip that hang off its front edge */
  const room=Math.max(40,(next||g.fixH)-shelf.y-(next?58:10));
  const shelfAbove=next||0;
  const rel=spec.rel;
  let x=x0+rng()*18;
  let guard=0;
  while(x<x1-30&&guard++<400){
    /* A HOLE IN THE RUN — a line that has sold out, which every shop has by
       Sunday evening. How often one happens and how wide it is IS what "how
       well stocked" means; leave it at a couple of per cent and the control is
       a label on a slider that does nothing. */
    const bare=1-spec.fill;
    if(rng()<bare*0.62){x+=60+rng()*(120+bare*560);continue;}
    const kind=pick(mix,rng);
    const S=SHAPE[kind],sz=SIZES[kind];
    let w=lerp(sz[0][0],sz[0][1],rng());
    let h=lerp(sz[1][0],sz[1][1],rng());
    /* it has to fit under the shelf above it, and a shopper's hand has to fit
       above that — a line too tall for the bay is simply not stocked here */
    const cap=room*0.90-8;
    if(h>cap){
      if(cap<50){x+=w;continue;}
      h=cap;
      if(kind==="bottle"||kind==="carton")w*=clamp(h/lerp(sz[1][0],sz[1][1],0.5),0.6,1);
    }
    /* and a line that is selling has more facings left than one that is not */
    const facings=1+Math.floor(rng()*rng()*(1.6+3.4*spec.fill));
    const total=facings*w;
    if(x+total>x1){
      /* the last block is trimmed to what is left rather than overhanging */
      const room2=x1-x;
      if(room2<w*0.9)break;
    }
    const col=(kind==="tray")?foodBrand(rng):brand(rng,spec.punch);
    const capCol=rng()<0.5?col.dark:hsv(rng(),0.5,0.9);
    /* how far back on the shelf this block sits. A faced-up shop has
       everything at the front edge; a tired one has it pushed back. */
    const setback=spec.tidy>=1?0:(1-spec.tidy)*rng()*Math.min(140,shelf.d*0.4);
    const z=(shelf.d-setback)/g.FW;
    const seed=(rng()*1e6)|0;
    for(let f=0;f<facings&&x+w<=x1;f++){
      const jx=(1-spec.tidy)*(rng()-0.5)*4;
      item(P,S,x+jx,x+w+jx,shelf.y,h*(1+(rng()-0.5)*0.02*(1-spec.tidy)),z,rel,col,rng,
           {shelfAbove:shelfAbove,capCol:capCol,seed:seed,wear:spec.wear,
            gloss:kind==="bag"||kind==="tray"?1:0.6});
      x+=w;
    }
    x+=1+rng()*7;
  }
}

/* ============================ fixture parts ============================ */

const STEEL=[152,157,165],STEEL_D=[104,109,117],WHITE=[228,229,231],
      BLACK=[40,42,46],CHROME=[196,201,209];

/* a shelf: the deck, its front lip, and the price rail clipped onto that. The
   lip and the rail are the only part of a shelf anybody ever sees, so they get
   the detail and the deck behind gets none. */
function shelfBoard(P,g,x0,x1,y,depth,col,rng,o){
  o=o||{};
  const zf=depth/g.FW;
  const lip=Math.max(P.fine*2,o.lip||34);
  const railH=Math.max(0,o.rail===undefined?26:o.rail);
  /* THE FASCIA HANGS BELOW THE SHELF LINE, because product stands ON a shelf.
     Drawn above it, the shelf front and its ticket strip are painted over the
     stock — which swallows a 50 mm tray of mince whole and leaves a chiller
     deck looking like nobody has filled it. */
  P.rect(x0,y-lip,x1,y,function(i,u,v){
    const edge=smoothstep(0,0.24,v)*smoothstep(1,0.78,v);
    P.put(i,tint(col,0.80+0.28*edge),0.42,0.22,zf,M.SHELF,0.62+0.30*edge);
  });
  /* the underside, and the shade it throws down into the bay below */
  P.slab(x0,y-lip-railH-Math.max(P.fine,9),x1,y-lip-railH,
         tint(col,0.42),0.74,0.08,zf*0.96,M.SHELF,0.26);
  if(railH>P.fine){
    /* the shelf-edge strip: a white channel with printed labels in it, one per
       facing block. Real ones are illegible past a metre and read as a row of
       pale tickets with a dark bar in each, which is what this draws. */
    P.rect(x0,y-lip-railH,x1,y-lip,function(i,u,v,xmm){
      const cell=Math.floor(xmm/Math.max(60,g.bayW/14));
      const f=(xmm/Math.max(60,g.bayW/14))%1;
      const gapx=f<0.05||f>0.95;
      const price=(v>0.18&&v<0.62&&f>0.10&&f<0.44);
      const bars=(v>0.66&&v<0.86&&f>0.10&&f<0.62)&&(Math.floor(xmm/P.fine)%2===0);
      let c=gapx?[176,178,182]:WHITE;
      if(price)c=[60,62,68];
      if(bars)c=[70,72,78];
      if(((cell*2654435761)>>>0)%11===0)c=[228,64,52];        // a promotion ticket
      P.put(i,c,0.52,0,zf*1.004,M.RAIL,0.86+0.14*smoothstep(0,0.4,v));
    });
  }
}

/* the base deck is a BOX, not a shelf: solid from the toe kick up to its own
   surface, because that is what the shelving stands on and it is a quarter of
   everything you can see of the run */
function deckBody(P,g,x0,x1,col){
  const zf=g.deckD/g.FW;
  P.rect(x0,g.kick,x1,g.deck,function(i,u,v,xmm){
    const panel=((xmm/g.bayW)%1);
    const seam=panel<0.010||panel>0.990;
    const scuffed=1-smoothstep(0,0.30,v)*0.22;      // trolleys hit the bottom of it
    P.put(i,tint(col,(seam?0.60:1)*scuffed*(0.92+0.10*fbm(u*6,v*3,9,2,5))),
          0.52,0.18,zf*0.985,M.STEEL,seam?0.46:0.72*scuffed+0.24);
  });
}

/* the slotted back panel every gondola has, seen wherever the stock does not
   cover it */
function backPanel(P,g,x0,x1,y0,y1,col,rng){
  const slot=Math.max(P.fine*3,76.2);
  P.rect(x0,y0,x1,y1,function(i,u,v,xmm,ymm){
    const line=((ymm/slot)%1)<0.16?1:0;
    const grime=fbm(u*3,v*2,5,3,7)*0.20;
    P.put(i,tint(col,(line?0.62:1)*(1-grime)),0.74,0.14,0,M.BACK,line?0.44:0.80);
  });
}

/* the upright: a slotted steel post between bays, with its punched slots */
function upright(P,g,x,w,y0,y1){
  P.rect(x-w*0.5,y0,x+w*0.5,y1,function(i,u,v,xmm,ymm){
    const round2=smoothstep(0,0.16,u)*smoothstep(1,0.84,u);
    const slot=(((ymm/25.4)%1)<0.30)&&u>0.32&&u<0.68;
    P.put(i,tint(slot?STEEL_D:STEEL,0.74+0.34*round2),0.40,0.55,
          g.shelfD/g.FW*1.02,M.STEEL,slot?0.34:0.62+0.34*round2);
  });
}

/* LETTERING NOBODY CAN READ, at the only size anybody sees it. Real type wants
   a face registered against the document, which a worker thread cannot see, and
   the whole mode is off the main thread because of what that buys. A run of
   blocks on a varying pitch, with a space every few of them, reads as a sign
   from the three metres a department fascia is ever read from — which is more
   than a row of even bars does. */
function letters(xmm,span,fine,seed){
  const pitch=Math.max(fine*2.2,span*0.028);
  const k=Math.floor(xmm/pitch);
  const h=(((k+1)*2654435761)^((seed|0)*40503))>>>0;
  if((h%19)<3)return false;                       // the space between two words
  return ((xmm/pitch)%1)<(0.40+((h>>9)%42)/100);
}

function toeKick(P,g,x0,x1,h,col){
  P.slab(x0,0,x1,h,tint(col,0.55),0.56,0.30,g.deckD/g.FW*0.9,M.STEEL,0.42);
  P.rect(x0,h-Math.max(P.fine,10),x1,h,i=>P.put(i,tint(col,0.95),0.38,0.4,
                                                g.deckD/g.FW*0.93,M.STEEL,0.9));
}

/* ============================ the seven fixtures ============================ */

function spec(P0,mixName){
  return {mix:mixName,fill:clamp(+P0.fill,0,1),
          tidy:clamp(+P0.tidy,0,1),punch:clamp(+P0.punch,0.1,1.4),
          wear:clamp(+P0.wear,0,1),rel:clamp(+P0.relief,0,1)};
}

function layGondola(P,g,p,rng){
  const sp=spec(p,p.aisleMix||"dry");
  const D=decks(g);
  backPanel(P,g,0,g.FW,g.kick,g.fixH,[86,90,98],rng);
  deckBody(P,g,0,g.FW,STEEL);
  for(let k=0;k<D.length;k++)
    stock(P,g,4,g.FW-4,D[k],k+1<D.length?D[k+1].y:g.fixH,sp,rng);
  /* the fixture is drawn AFTER the stock, because a shelf stands in front of
     what is on the shelf below it and a price rail stands in front of both */
  for(let k=0;k<D.length;k++)
    shelfBoard(P,g,0,g.FW,D[k].y,D[k].d,WHITE,rng,{lip:D[k].base?40:34});
  toeKick(P,g,0,g.FW,g.kick,STEEL);
  const uw=Math.max(P.fine*2,+p.postMm||62);
  for(let b=0;b<=g.bays;b++)upright(P,g,b*g.bayW,uw,g.kick,g.fixH);
  /* the top rail and, on a shop that has one, the header sign above it */
  P.slab(0,g.fixH-46,g.FW,g.fixH,tint(STEEL,1.05),0.36,0.5,g.shelfD/g.FW*1.03,M.STEEL,0.9);
}

function layProduce(P,g,p,rng){
  const sp=spec(p,"dry");
  const tiers=Math.max(2,Math.min(5,p.tiers|0||3));
  /* what the rack keeps for itself above the top tier: the mister rail and the
     chalkboard headers. Everything under that is stock, right up to the top —
     spread the tiers over a fraction of the height instead and the rack ends
     halfway up a wall of empty back panel. */
  const head=Math.max(200,g.fixH*0.11);
  const room=Math.max(200,g.fixH-head-g.deck);
  const pitch=room/tiers;
  backPanel(P,g,0,g.FW,g.kick,g.fixH,[62,86,66],rng);
  /* a raked stack: each tier is shallower and further back than the one under
     it, which is what makes a produce rack readable from the aisle */
  for(let k=0;k<tiers;k++){
    const y=g.deck+pitch*k;
    const d=lerp(g.deckD,g.deckD*0.42,tiers>1?k/(tiers-1):0);
    const h=(k===tiers-1)?(g.fixH-head*0.62-y):pitch*0.94;
    crates(P,g,4,g.FW-4,y,clamp(h,120,380),d,sp,rng);
    /* the tier board itself, raked toward you */
    P.slab(0,y-30,g.FW,y+14,tint([196,198,200],0.86),0.56,0.12,d/g.FW,M.SHELF,0.6);
  }
  deckBody(P,g,0,g.FW,[74,116,78]);
  toeKick(P,g,0,g.FW,g.kick,[70,110,74]);
  /* the mister pipe over the top, and the chalkboard headers */
  const pipeY=g.fixH-head*0.62;
  P.rect(0,pipeY-14,g.FW,pipeY+14,function(i,u,v,xmm){
    const b=1-Math.abs(v-0.5)*2;
    const nozzle=((xmm/300)%1)<0.06;
    P.put(i,tint(nozzle?[150,155,162]:CHROME,0.55+0.6*b),0.22,0.8,
          g.shelfD/g.FW*1.1+b*0.004,M.STEEL_BRIGHT,0.5+0.5*b);
  });
  for(let b=0;b<g.bays;b++){
    const x=b*g.bayW+g.bayW*0.12,w=g.bayW*0.76;
    P.rect(x,g.fixH-56,x+w,g.fixH-8,function(i,u,v,xmm,ymm){
      const board=u>0.03&&u<0.97&&v>0.10&&v<0.90;
      const chalk=board&&v>0.30&&v<0.64&&u>0.10&&u<0.70
                  &&letters(xmm,w,P.fine,b*11+3);
      P.put(i,chalk?[236,236,230]:(board?[34,40,36]:[122,86,52]),0.72,0,
            g.shelfD/g.FW*1.12,M.SIGN,board?0.7:0.85);
    });
  }
}

/* A HEAP, which is what a crate of apples and a pan of olives both are: a pile
   of one thing, drawn as overlapping ellipsoids so the light breaks over every
   one of them and you can count them. A noise field over the same rectangle
   gives you a coloured panel with texture on it, which is not the same picture
   at all. */
function heap(P,g,x0,x1,yb,h,z,body,rng,rmin,rmax,mat,rel,fill){
  const w=Math.max(1,x1-x0);
  const n=Math.max(5,Math.round(w*h/(rmin*rmax*2.4)*(0.45+fill)));
  for(let k=0;k<n;k++){
    const r=lerp(rmin,rmax,rng()*rng()+0.15);
    const rr=r*(0.80+rng()*0.34);
    const px=x0+r*0.55+rng()*Math.max(1,w-r*1.1);
    const py=yb+rr*0.50+rng()*Math.max(1,h-rr*1.0);
    const cv=0.84+rng()*0.30;
    P.rect(px-r,py-rr,px+r,py+rr,function(i,u,v,xmm,ymm){
      const dx=(xmm-px)/r,dy=(ymm-py)/rr;
      const q=1-dx*dx-dy*dy;
      if(q<=0)return;
      const b=Math.sqrt(q);
      P.put2(i,tint(body,(0.60+0.54*b)*cv),lerp(0.66,0.22,b),0,
             z+r*b/g.FW,z*rel+r*b/g.FW,mat,clamp(0.24+0.76*b,0.07,1));
    });
  }
}

/* the crates a produce rack is actually stocked from, with a heap of one
   vegetable in each */
function crates(P,g,x0,x1,y,h,d,sp,rng){
  const z=d/g.FW;
  let x=x0;
  const HUE=[0.28,0.32,0.36,0.12,0.09,0.02,0.15,0.78,0.05,0.42];
  let guard=0;
  while(x<x1-120&&guard++<80){
    const w=lerp(280,g.bayW*0.52,rng());
    if(x+w>x1)break;
    const hue=HUE[(rng()*HUE.length)|0]+(rng()-0.5)*0.03;
    const sat=0.42+rng()*0.5,val=0.45+rng()*0.42;
    const body=hsv(hue,sat,val);
    /* the crate: a shallow slotted tray, black or green or waxed card */
    const crateH=Math.min(h*0.42,92);
    const cc=rng()<0.5?[42,46,48]:[54,102,58];
    P.rect(x,y,x+w,y+crateH,function(i,u,v,xmm){
      const slot=((xmm/34)%1)<0.22&&v>0.25&&v<0.80;
      P.put(i,tint(cc,slot?0.62:1),0.62,0.05,z,M.CRATE,slot?0.4:0.74);
    });
    heap(P,g,x+8,x+w-8,y+crateH*0.70,Math.max(30,h-crateH*0.70),z,body,rng,
         24,58,M.PRODUCE,sp.rel,sp.fill);
    x+=w+8+rng()*20;
  }
}

function layMeat(P,g,p,rng){
  const sp=spec(p,p.chillMix||"chill");
  const decksN=Math.max(2,Math.min(6,p.deckN|0||4));
  const caseTop=g.fixH;
  /* the bottom deck of a multideck is a couple of hundred millimetres off the
     floor, not up at gondola deck height — the case is a well, and taking the
     deck slider for it leaves a third of a metre of black under the stock */
  const wellY=Math.max(g.kick+140,g.deck*0.55);
  /* the case surround: black, because every multideck in every shop is */
  P.slab(0,0,g.FW,g.FH,[26,28,31],0.62,0.10,0.004,M.STEEL,0.55);
  /* the back of a chiller is a plain cold panel, not slatwall: it is a sealed
     box, and there is nothing to hang anything off */
  P.rect(20,wellY,g.FW-20,caseTop,function(i,u,v){
    P.put(i,mixc([44,48,54],[74,80,88],smoothstep(0,1,v)),0.66,0.12,0,M.BACK,
          lerp(0.44,0.82,v));
  });
  const dpitch=(caseTop-wellY-90)/decksN;
  for(let k=0;k<decksN;k++){
    const y=wellY+dpitch*k;
    const nx=y+dpitch;
    const d=lerp(g.deckD,g.shelfD*0.8,k/Math.max(1,decksN-1));
    /* a chiller deck is RAKED, so what is on it is angled toward you: the
       trays are drawn short and the deck under them shows */
    stock(P,g,26,g.FW-26,{y:y,d:d},nx,
          Object.assign({},sp,{mix:k===0?"chill":sp.mix}),rng);
    shelfBoard(P,g,20,g.FW-20,y,d,[212,214,218],rng,{lip:30,rail:22});
  }
  /* the canopy with its light strip — the thing that makes a chiller read as
     cold, and the only light in a shop you can see the source of */
  if(g.canopy>0){
    /* a canopy is not a slab of black: the upper two thirds is the fascia the
       department is named on, and the soffit under it holds the light */
    const split=caseTop+g.canopy*0.34;
    const fas=hsv(clamp(+p.fasciaHue,0,1),0.62,0.72);
    P.rect(0,split,g.FW,g.FH,function(i,u,v,xmm){
      const edge=v<0.06||v>0.94;
      const bf=(xmm/g.bayW)%1;
      const word=(!edge)&&v>0.28&&v<0.70&&bf>0.13&&bf<0.87
                 &&letters(xmm,g.bayW,P.fine,7);
      P.put(i,edge?[24,26,29]:(word?[240,242,244]:fas),0.52,0.05,
            g.shelfD/g.FW*1.08,M.SIGN,edge?0.5:0.92);
    });
    P.slab(0,caseTop,g.FW,split,[22,24,27],0.5,0.12,g.shelfD/g.FW*1.06,M.STEEL,0.55);
    const ly=caseTop-14;
    P.rect(14,ly-52,g.FW-14,ly,function(i,u,v){
      const b=smoothstep(0,0.3,v)*smoothstep(1,0.72,v);
      P.put(i,mixc([210,224,236],[255,255,255],b),0.30,0,g.shelfD/g.FW*1.02,M.LAMP,1);
      P.glow(i,[196,222,255],0.55+0.45*b);
    });
  }
  /* the air-curtain grille along the bottom of the well */
  P.rect(20,wellY-96,g.FW-20,wellY-30,function(i,u,v,xmm){
    const bar=((xmm/22)%1)<0.45;
    P.put(i,tint([70,74,80],bar?1:0.5),0.54,0.35,g.deckD/g.FW*0.96,M.STEEL,bar?0.6:0.24);
  });
  toeKick(P,g,0,g.FW,g.kick,[34,36,40]);
}

function layDeli(P,g,p,rng){
  const sp=spec(p,"chill");
  /* a service counter is 900 mm to the deck, whatever the fixture height says
     — the rest of it is case. Taking a fraction of the height instead gives a
     two-metre counter with a letterbox of glass over it. */
  const counterY=Math.min(g.fixH*0.55,950);
  const glassTop=g.fixH-g.canopy;
  /* the stainless base: a plinth, a body and a bumper rail */
  P.rect(0,g.kick,g.FW,counterY,function(i,u,v,xmm){
    const brush=fbm(xmm/40,v*3,120,2,11);
    const panel=((xmm/g.bayW)%1);
    const seam=panel<0.012||panel>0.988;
    P.put(i,tint(CHROME,(seam?0.62:1)*(0.86+0.22*brush)),0.20+brush*0.10,0.90,
          g.deckD/g.FW,M.STEEL_BRIGHT,seam?0.5:0.86);
  });
  toeKick(P,g,0,g.FW,g.kick,[92,96,102]);
  /* the deck behind the glass, raked, with the pans on it */
  const deckY=counterY+40;
  /* the bumper rail along the top of the base, which every service counter has
     and which is the only thing stopping it reading as a blank grey panel */
  P.rect(0,counterY-90,g.FW,counterY-30,function(i,u,v){
    const b=smoothstep(0,0.28,v)*smoothstep(1,0.72,v);
    P.put(i,tint(CHROME,0.62+0.62*b),0.16,0.94,g.deckD/g.FW*1.06,M.STEEL_BRIGHT,
          0.42+0.58*b);
  });
  /* THE INSIDE OF THE CASE, before anything is stood in it. A service case is
     lit and lined in stainless; leave it unpainted and everything the glass
     does not cover reads as a hole cut in the counter. */
  P.rect(0,deckY,g.FW,g.fixH-g.canopy,function(i,u,v){
    P.put(i,mixc([96,102,110],[176,186,196],smoothstep(0,1,v)),0.34,0.55,
          0.002,M.STEEL_BRIGHT,lerp(0.30,0.80,v));
  });
  P.slab(0,counterY,g.FW,deckY,tint(CHROME,1.1),0.16,0.92,g.deckD/g.FW*1.02,
         M.STEEL_BRIGHT,0.95);
  pans(P,g,30,g.FW-30,deckY,Math.max(140,(glassTop-deckY)*0.84),g.deckD*0.8,sp,rng);
  /* the glass over it: a tilted front, with a hard specular streak down it and
     a mullion at every bay */
  const zg=g.deckD/g.FW*1.05;
  P.rect(0,deckY,g.FW,glassTop,function(i,u,v,xmm){
    const f=(xmm/g.bayW)%1;
    if(f<0.016||f>0.984){
      P.put(i,tint(CHROME,0.9),0.18,0.9,zg*1.01,M.STEEL_BRIGHT,0.8);
      return;
    }
    /* the sheen down a service case: one hard streak where the room light is
       and a softer one off the aisle, both running with the pane rather than
       with what is behind it */
    const streak=smoothstep(0.050,0,Math.abs(f-0.24))*0.30
                +smoothstep(0.028,0,Math.abs(f-0.58))*0.17;
    P.glaze(i,[198,222,232],clamp(0.06+0.12*(1-v)+streak,0,0.52),0.06,zg,zg*sp.rel);
  });
  /* the menu board over the counter, lit */
  if(g.canopy>0){
    const y0=glassTop;
    P.slab(0,y0,g.FW,g.FH,[38,40,44],0.6,0.1,g.shelfD/g.FW,M.SIGN,0.6);
    for(let b=0;b<g.bays;b++){
      const x=b*g.bayW+g.bayW*0.06,w=g.bayW*0.88;
      const col=hsv(0.06+b*0.11,0.55,0.92);
      const top=g.FH-26;
      const lead=Math.max(P.fine*3,46);
      P.rect(x,y0+26,x+w,top,function(i,u,v,xmm,ymm){
        const band=v>0.78;
        let c=[24,26,30],lit=0;
        if(band){c=col;lit=0.34;}
        else{
          /* a line of type: an item running most of the way across and a price
             set hard right, on a leading of its own. Nothing here is lettered —
             a menu board is read as rhythm at any distance you would see one */
          const n=Math.floor((top-ymm)/lead);
          const f=((top-ymm)/lead)%1;
          if(f<0.34){
            const len=lerp(0.30,0.70,fbm(n*0.37,0.5,6,2,9));
            if(u>0.07&&u<0.07+len&&letters(xmm-x,w,P.fine,n+5)){
              c=[238,238,234];lit=0.42;
            }
            else if(u>0.80&&u<0.93){c=[250,226,150];lit=0.5;}
          }
        }
        P.put(i,c,0.55,0,g.shelfD/g.FW*1.02,M.SIGN,0.9);
        P.glow(i,band?col:[255,238,206],lit);
      });
    }
  }
}

/* the gastronorm pans a deli deck is actually stocked from */
function pans(P,g,x0,x1,y,h,d,sp,rng){
  const z=d/g.FW;
  let x=x0,guard=0;
  while(x<x1-120&&guard++<60){
    const w=lerp(200,330,rng());
    if(x+w>x1)break;
    const food=foodBrand(rng).body;
    P.rect(x,y,x+w,y+h,function(i,u,v,xmm,ymm){
      const wall=u<0.04||u>0.96;
      if(wall){P.put(i,tint(CHROME,0.92),0.16,0.92,z,M.STEEL_BRIGHT,0.8);return;}
      /* the empty pan under the heap: dark, so the gaps in it read */
      P.put(i,[46,44,42],0.44,0.05,z,M.MEAT,0.28);
    });
    heap(P,g,x+14,x+w-14,y+h*0.10,h*0.86,z,food,rng,
         14,34,M.MEAT,sp.rel,0.9);
    x+=w+10+rng()*18;
  }
}

function layFreezer(P,g,p,rng){
  const sp=spec(p,"frozen");
  const doorW=g.bayW;
  const frostAmt=clamp(+p.frost,0,1);
  const zgl=g.shelfD/g.FW*1.08;
  /* a reach-in door's bottom shelf is a couple of hundred millimetres off the
     floor — the base under it is a sealed panel, not a gondola's 430 mm deck */
  const baseY=Math.min(g.deck,Math.max(g.kick+90,260));
  const D=decks(g,baseY);
  /* the product first, then the glass over it: what you see in a freezer is
     stock through fog, and drawing it the other way round gives you fog */
  backPanel(P,g,0,g.FW,g.kick,g.fixH,[70,84,92],rng);
  P.rect(0,g.kick,g.FW,baseY,function(i,u,v,xmm){
    const panel=(xmm/doorW)%1;
    const seam=panel<0.012||panel>0.988;
    P.put(i,tint([96,104,112],(seam?0.6:1)*(1-smoothstep(0,0.34,v)*0.18)),
          0.54,0.20,g.deckD/g.FW*0.98,M.STEEL,seam?0.46:0.70);
  });
  for(let k=0;k<D.length;k++)
    stock(P,g,10,g.FW-10,D[k],k+1<D.length?D[k+1].y:g.fixH-90,sp,rng);
  for(let k=0;k<D.length;k++)
    shelfBoard(P,g,0,g.FW,D[k].y,D[k].d,[214,218,222],rng,{lip:26,rail:0});

  /* the door: an aluminium frame, a handle, and glass with the cold on it */
  const frame=Math.max(P.fine*2,+p.frameMm||64);
  P.rect(0,g.kick,g.FW,g.fixH,function(i,u,v,xmm,ymm){
    const f=(xmm%doorW)/doorW;
    const inFrame=(xmm%doorW)<frame||(xmm%doorW)>doorW-frame
                  ||ymm<g.kick+frame||ymm>g.fixH-frame;
    if(inFrame){
      P.put(i,tint(CHROME,0.86+0.2*Math.abs(0.5-((ymm/frame)%1))),0.26,0.85,
            g.shelfD/g.FW*1.10,M.STEEL_BRIGHT,0.78);
      return;
    }
    /* GLASS OVER STOCK. The frost is heaviest at the edges of the pane, where
       the seal is coldest and the cabinet is losing least — and a hard diagonal
       reflection runs across the whole of it. Between them they are what makes
       a freezer door read as glazed rather than as standing open. */
    const ex=Math.min(f,1-f);
    const yr=(ymm-g.kick)/Math.max(1,g.fixH-g.kick);
    const ey=Math.min(yr,1-yr);
    const frost=clamp(0.10+0.85*Math.pow(1-smoothstep(0,0.16,ex),2)
                          +0.55*Math.pow(1-smoothstep(0,0.12,ey),2),0,1)*frostAmt;
    const refl=smoothstep(0.20,0,Math.abs((((xmm*0.75+ymm)/(doorW*1.7))%1)-0.32))*0.5;
    P.glaze(i,[214,232,240],clamp(frost*0.85+refl*0.55+0.06,0,0.94),
            0.05+frost*0.50,zgl,zgl*sp.rel);
  });

  /* the LED in every mullion, and the handles */
  for(let b=0;b<=g.bays;b++){
    const x=b*doorW;
    P.rect(x-frame*0.28,g.kick+frame,x+frame*0.28,g.fixH-frame,function(i,u,v){
      const b2=smoothstep(0,0.24,u)*smoothstep(1,0.76,u);
      P.put(i,mixc([200,222,240],[255,255,255],b2),0.24,0,g.shelfD/g.FW*1.12,M.LAMP,1);
      P.glow(i,[186,216,255],0.4+0.6*b2);
    });
  }
  for(let b=0;b<g.bays;b++){
    const x=b*doorW+frame*1.35;
    P.rect(x,g.fixH*0.34,x+Math.max(P.fine*2,34),g.fixH*0.72,function(i,u,v){
      const b2=smoothstep(0,0.3,u)*smoothstep(1,0.7,u);
      P.put(i,tint(CHROME,0.66+0.5*b2),0.18,0.9,g.shelfD/g.FW*1.16+b2*0.006,
            M.STEEL_BRIGHT,0.4+0.6*b2);
    });
  }
  toeKick(P,g,0,g.FW,g.kick,[44,48,54]);
}

function layEndcap(P,g,p,rng){
  const sp=spec(p,p.aisleMix||"dry");
  const steps=Math.max(2,Math.min(5,p.tiers|0||3));
  backPanel(P,g,0,g.FW,g.kick,g.fixH,[86,90,98],rng);
  /* A PROMOTION IS STACKED, not shelved: cases of one line, opened and
     stepped back, with a header over it. So each tier is one brand rather
     than a mix, which is the whole visual point of an end cap. */
  const headY=g.fixH-Math.min(300,g.fixH*0.16);
  const room=Math.max(200,headY-40-g.deck);
  const tpitch=room/steps;
  for(let k=0;k<steps;k++){
    const y=g.deck+tpitch*k;
    const ny=y+tpitch;
    const d=lerp(g.deckD,g.deckD*0.5,k/Math.max(1,steps-1));
    const col=brand(rng,sp.punch);
    const kind=["box","can","bottle","bag"][(rng()*4)|0];
    const S=SHAPE[kind],sz=SIZES[kind];
    const w=lerp(sz[0][0],sz[0][1],0.5);
    const h=Math.min(lerp(sz[1][0],sz[1][1],0.72),(ny-y)*0.88);
    const inset=(g.FW-Math.floor((g.FW-40)/w)*w)*0.5;
    for(let x=inset;x+w<=g.FW-inset*0.5;x+=w)
      item(P,S,x,x+w,y,h,d/g.FW,sp.rel,col,rng,{shelfAbove:ny,seed:k*31,wear:sp.wear});
    /* the case the tier stands in, its front cut away as they always are */
    P.rect(0,y-Math.min(120,(ny-y)*0.4),g.FW,y,function(i,u,v,xmm){
      const rip=v>0.55?fbm(xmm/50,0.3,7,2,k+3)*0.5:0;
      P.put(i,tint(mixc([176,140,96],col.body,0.35),0.72+rip),0.80,0,d/g.FW*0.98,
            M.CRATE,0.5+rip);
    });
  }
  toeKick(P,g,0,g.FW,g.kick,STEEL);
  /* the header board */
  const hy=headY;
  const hc=brand(rng,1.2);
  P.rect(0,hy,g.FW,g.fixH,function(i,u,v,xmm,ymm){
    const border=u<0.012||u>0.988||v<0.06||v>0.94;
    const word=(!border)&&v>0.28&&v<0.70&&u>0.09&&u<0.90
      &&letters(xmm,g.FW,P.fine,23);
    P.put(i,border?tint(hc.dark,0.8):(word?hc.pale:hc.body),0.58,0,
          g.shelfD/g.FW*1.06,M.SIGN,border?0.6:0.92);
  });
}

function layCheckout(P,g,p,rng){
  const sp=spec(p,"impulse");
  const beltY=g.fixH*0.42;
  /* the lane body: a laminate counter with a rubber belt let into it, panelled
     per bay and with a nosing along the top — without which it is one grey
     rectangle taking a quarter of the picture */
  P.rect(0,g.kick,g.FW,beltY,function(i,u,v,xmm){
    const panel=(xmm/g.bayW)%1;
    const seam=panel<0.008||panel>0.992;
    const speck=fbm(xmm/70,v*4,110,3,19);
    P.put(i,tint([196,198,202],(seam?0.62:1)*(0.90+0.16*speck)),0.44,0.05,
          g.deckD/g.FW*0.9,M.STEEL,seam?0.5:0.78);
  });
  P.rect(0,beltY-40,g.FW,beltY,function(i,u,v){
    const b=smoothstep(0,0.3,v)*smoothstep(1,0.72,v);
    P.put(i,tint([214,216,220],0.72+0.44*b),0.32,0.15,g.deckD/g.FW*0.96,M.STEEL,
          0.52+0.48*b);
  });
  toeKick(P,g,0,g.FW,g.kick,[56,60,66]);
  P.rect(g.FW*0.10,beltY,g.FW*0.78,beltY+70,function(i,u,v,xmm){
    const rib=((xmm/16)%1)<0.5;
    P.put(i,tint([38,40,44],rib?1:0.82),0.86,0,g.deckD/g.FW,M.RUBBER,rib?0.68:0.5);
  });
  /* the divider bars lying on it */
  for(let k=0;k<3;k++){
    const x=g.FW*(0.16+k*0.19)+rng()*40;
    P.rect(x,beltY+72,x+Math.max(P.fine*2,26),beltY+72+Math.min(180,g.FW*0.10),
      function(i,u,v){
        const b=smoothstep(0,0.3,u)*smoothstep(1,0.7,u);
        P.put(i,tint([210,58,52],0.62+0.5*b),0.44,0,g.deckD/g.FW*1.02+b*0.003,
              M.RUBBER,0.5+0.5*b);
      });
  }
  /* THE RACK NEEDS A BACK. An impulse unit is a panel standing on the end of
     the lane; without one the sweets hang in mid-air over a cut-out hole, which
     is what the alpha channel faithfully gave us. */
  const rackY=[beltY+180,beltY+420,beltY+660];
  const rackTop=rackY[rackY.length-1]+250;
  for(const seg of [[0,g.FW*0.32],[g.FW*0.68,g.FW]]){
    P.rect(seg[0],beltY,seg[1],Math.min(g.fixH,rackTop),function(i,u,v,xmm){
      const slot=((xmm/76.2)%1)<0.14;
      P.put(i,tint([104,110,118],slot?0.72:1),0.66,0.16,0,M.BACK,slot?0.5:0.8);
    });
  }
  for(let k=0;k<rackY.length;k++){
    if(rackY[k]+120>g.fixH)break;
    stock(P,g,g.FW*0.02,g.FW*0.30,{y:rackY[k],d:180},rackY[k]+230,
          Object.assign({},sp,{tidy:Math.min(1,sp.tidy+0.15)}),rng);
    shelfBoard(P,g,0,g.FW*0.32,rackY[k],180,WHITE,rng,{lip:22,rail:18});
    stock(P,g,g.FW*0.70,g.FW*0.98,{y:rackY[k],d:180},rackY[k]+230,
          Object.assign({},sp,{tidy:Math.min(1,sp.tidy+0.15)}),rng);
    shelfBoard(P,g,g.FW*0.68,g.FW,rackY[k],180,WHITE,rng,{lip:22,rail:18});
  }
  /* the till tower and the lane number over it, lit */
  const tx=g.FW*0.80;
  P.slab(tx,beltY,Math.min(g.FW,tx+g.FW*0.16),g.fixH*0.80,[46,48,54],0.5,0.2,
         g.deckD/g.FW*1.05,M.STEEL,0.7);
  P.rect(tx+g.FW*0.02,g.fixH*0.56,Math.min(g.FW,tx+g.FW*0.14),g.fixH*0.76,
    function(i,u,v){
      P.put(i,[128,196,220],0.14,0,g.deckD/g.FW*1.08,M.SIGN,1);
      P.glow(i,[120,190,230],0.5);
    });
  const poleX=tx+g.FW*0.07;
  const signH=Math.min(240,g.canopy*0.42);
  P.rect(poleX-14,g.fixH*0.80,poleX+14,g.FH-signH,function(i,u,v){
    P.put(i,tint(STEEL,0.7+0.5*smoothstep(0,0.4,u)*smoothstep(1,0.6,u)),0.4,0.6,
          g.deckD/g.FW,M.STEEL,0.6);
  });
  const lampC=(p.laneOpen===false)?[228,58,48]:[86,214,110];
  P.rect(poleX-110,g.FH-signH,poleX+110,g.FH-20,function(i,u,v){
    const box=u>0.06&&u<0.94&&v>0.06&&v<0.94;
    const digit=box&&v>0.22&&v<0.80&&Math.abs(u-0.5)<0.22;
    P.put(i,box?(digit?[255,255,255]:lampC):[40,42,46],0.30,0,g.deckD/g.FW*1.02,
          box?M.LAMP:M.STEEL,1);
    if(box)P.glow(i,digit?[255,255,255]:lampC,digit?0.9:0.75);
  });
}

const LAY={gondola:layGondola,produce:layProduce,meat:layMeat,deli:layDeli,
           freezer:layFreezer,endcap:layEndcap,checkout:layCheckout};

/* ============================ the build ============================ */

function build(params,io){
  const p=params,g=geom(p);
  const TW=io.W,TH=io.H,N=TW*TH;
  g.TW=TW;g.TH=TH;
  const seed=p.seed|0;
  const rng=mulberry32(seed*2654435761>>>0);

  const B={
    A:new Uint8ClampedArray(N*3),
    RGH:new Uint8ClampedArray(N),
    MET:new Uint8ClampedArray(N),
    AO:new Uint8ClampedArray(N),
    ALP:new Uint8ClampedArray(N),
    EMC:new Uint8ClampedArray(N*3),
    NRM:new Uint8ClampedArray(N*3),
    MAT:new Uint8Array(N),
    HGT:new Float32Array(N),
    NH:new Float32Array(N)
  };
  const P=painter(g,B);

  io.progress(0.04);

  setTimeout(function(){
    (LAY[g.piece]||layGondola)(P,g,p,rng);
    io.progress(0.55);
    setTimeout(finish,0);
  },0);

  function finish(){
    /* ---- the floor, so the fixture stands on something ---- */
    io.progress(0.62);

    /* ---- shelf-gap occlusion. Everything drawn so far knows how far it
       stands out; nothing knows what is standing next to it. One pass down
       each column finds where the surface falls away and darkens the texel
       that fell — which is the shadow one package casts into the gap beside
       the next, and the single thing that stops a shelf reading as a collage
       of stickers. ---- */
    const occ=clamp(+p.occ,0,1);
    if(occ>0){
      const rad=Math.max(2,Math.round(TW*0.010));
      for(let y=0;y<TH;y++){
        const row=y*TW;
        let run=0;
        for(let x=0;x<TW;x++){
          const i=row+x;
          if(!B.ALP[i]){run=0;continue;}
          const h=B.HGT[i];
          /* how far below the highest thing within reach to the left this is */
          const l=B.HGT[row+Math.max(0,x-rad)];
          const r=B.HGT[row+Math.min(TW-1,x+rad)];
          const above=Math.max(l,r)-h;
          if(above>0){
            const k=1-clamp(above*38,0,1)*0.55*occ;
            B.AO[i]*=k;
          }
          run++;
        }
      }
    }
    io.progress(0.72);

    /* ---- height range, off the TRUE field ---- */
    let hMin=Infinity,hMax=-Infinity;
    for(let i=0;i<N;i++){
      if(!B.ALP[i])continue;
      const h=B.HGT[i];
      if(h<hMin)hMin=h;
      if(h>hMax)hMax=h;
    }
    if(!(hMax>hMin)){hMin=0;hMax=1e-6;}

    /* ---- normals, off the NORMAL field ---- */
    const gy=p.flipG?-1:1;
    const str=Math.max(0.02,+p.normalStr||1);
    const NH=B.NH,NRM=B.NRM;
    for(let y=0;y<TH;y++){
      const y0=y*TW,ym=Math.max(0,y-1)*TW,yp=Math.min(TH-1,y+1)*TW;
      for(let x=0;x<TW;x++){
        const xm=Math.max(0,x-1),xp=Math.min(TW-1,x+1);
        const dhdu=(NH[y0+xp]-NH[y0+xm])*0.5*TW*str;
        const dhdv=(NH[yp+x]-NH[ym+x])*0.5*TW*str;
        let nx=-dhdu,ny=dhdv*gy;      // v runs DOWN the image and y runs up it
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;
        const i=(y0+x)*3;
        NRM[i]=(nx*0.5+0.5)*255;NRM[i+1]=(ny*0.5+0.5)*255;NRM[i+2]=(inv*0.5+0.5)*255;
      }
    }
    io.progress(0.88);

    /* ---- the last pass over neighbours: dust on the ledges a shelf is made
       of, grit in the laminate, and the tooth under everything ---- */
    if(window.ForgeMicro)ForgeMicro.apply({A:B.A,RGH:B.RGH,HGT:B.NH,ALP:B.ALP,W:TW,H:TH},{
      seed:seed,mpp:1/TW,wrap:false,up:-1,
      curve:+p.mCurve||0,grain:+p.mGrain||0,speck:(+p.mGrain||0)*0.7,dust:+p.mDust||0,
      ledgeM:60/Math.max(1,g.FW),stepU:14/Math.max(1,g.FW),
      curveU:3/Math.max(1,g.FW),dustC:[186,182,172]});

    /* the AO strength slider, applied last so it is a property of the export
       rather than of every call site above */
    const aoStr=clamp(+p.aoStr,0,1);
    if(aoStr<1)for(let i=0;i<N;i++)B.AO[i]=lerp(255,B.AO[i],aoStr);

    io.progress(1);
    io.done({A:B.A,RGH:B.RGH,MET:B.MET,AO:B.AO,NRM:B.NRM,HGT:B.HGT,ALP:B.ALP,
             EMC:B.EMC,MAT:B.MAT,hMin:hMin,hMax:hMax});
  }
}

/* ============================ mode definition ============================ */

Forge.register({
  id:"grocery",
  label:"Grocery",
  group:"Interiors",
  threadable:true,
  blurb:"Supermarket fixtures, stocked — aisle, produce, chiller, deli, freezer",
  title:'Grocery <em>Fixtures</em>',
  tagline:"Gondola · produce · multideck · deli · freezer · end cap · checkout",
  actionLabel:"Stock the shelves",
  busyLabel:"Stocking…",

  seamless:false,                    // a fixture with two ends, not a material
  backdrops:true,
  flipPreviewY:true,                 // it stands up: y is up in world terms
  previewSize:240,
  chipSource:150,
  preview:{gain:2.9,amb:1.20,specK:0.50,skyLo:[0.20,0.21,0.24],skyHi:[0.44,0.46,0.50]},

  channels:[
    {key:"basecolor",label:"Base + α"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Rough"},{key:"metallic",label:"Metal"},
    {key:"ao",label:"AO"},{key:"emissive",label:"Emissive"},
    {key:"height",label:"Height"},{key:"orm",label:"ORM"},
    {key:"id",label:"Mat ID"},{key:"opacity",label:"Opacity"}
  ],

  presets:[
    {id:"aisle",label:"Dry goods aisle",set:{
      piece:"gondola",bays:3,bayW:1219,fixH:2134,shelves:4,deckMm:430,deckD:560,
      shelfD:400,aisleMix:"dry",fill:0.92,tidy:0.85,punch:1,wear:0.15,occ:0.8}},
    {id:"drinks",label:"Soft drinks",set:{
      piece:"gondola",bays:3,shelves:5,aisleMix:"drinks",fill:0.95,tidy:0.9,punch:1.1}},
    {id:"picked",label:"Picked over",set:{
      piece:"gondola",bays:3,shelves:4,fill:0.42,tidy:0.30,wear:0.55,punch:0.85}},
    {id:"veg",label:"Produce wall",set:{
      piece:"produce",bays:3,tiers:3,fixH:2000,deckMm:520,deckD:700,fill:0.9,punch:0.95}},
    {id:"chill",label:"Meat multideck",set:{
      piece:"meat",bays:3,tiers:3,fixH:2000,canopyMm:420,chillMix:"chill",fill:0.85,tidy:0.9}},
    {id:"counter",label:"Deli counter",set:{
      piece:"deli",bays:3,fixH:1500,canopyMm:520,deckD:700,fill:0.9}},
    {id:"frozen",label:"Frozen doors",set:{
      piece:"freezer",bays:3,fixH:2100,shelves:4,frost:0.55,frameMm:70,fill:0.88}},
    {id:"promo",label:"End cap promotion",set:{
      piece:"endcap",bays:1,bayW:1219,tiers:3,fixH:1900,fill:1,punch:1.25}},
    {id:"lane",label:"Checkout lane",set:{
      piece:"checkout",bays:2,bayW:1400,fixH:1500,fill:0.95,tidy:0.9}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"size",type:"select",label:"Texture width",value:1024,showValue:true,
       options:Forge.sizes("plain")},
      {id:"piece",type:"select",label:"Fixture",value:"gondola",options:PIECES},
      {type:"readout"},
      {id:"seed",type:"seed",value:7311}
    ]},
    {title:"The run",open:true,rows:[
      {id:"bays",label:"Bays",min:1,max:8,step:1,value:3},
      {id:"bayW",label:"Bay width",unit:"mm",min:600,max:2000,step:1,value:1219},
      {id:"fixH",label:"Fixture height",unit:"mm",min:900,max:2600,step:10,value:2134},
      {id:"kickMm",label:"Toe kick",unit:"mm",min:0,max:250,step:5,value:100},
      {id:"deckMm",label:"Base deck height",unit:"mm",min:150,max:900,step:10,value:430},
      {id:"deckD",label:"Base deck depth",unit:"mm",min:200,max:900,step:10,value:560},
      {type:"note",html:"A supermarket gondola is <b>1219 mm</b> (48 in) to a bay and "+
        "<b>2134 mm</b> (7 ft) tall, on a 560 mm base deck with 400 mm shelves over it. "+
        "The defaults are those."}
    ]},
    {title:"Shelves",open:true,need:["shelved"],rows:[
      {id:"shelves",label:"Shelves over the deck",min:0,max:8,step:1,value:4},
      {id:"shelfD",label:"Shelf depth",unit:"mm",min:150,max:700,step:10,value:400},
      {id:"postMm",label:"Upright width",unit:"mm",min:20,max:160,step:2,value:62}
    ]},
    {title:"Tiers",open:true,need:["tiered"],rows:[
      {id:"tiers",label:"Tiers",min:2,max:5,step:1,value:3,
       need:["produce","endcap"]},
      {id:"deckN",label:"Decks in the case",min:2,max:6,step:1,value:4,
       need:["meat"]},
      {id:"canopyMm",label:"Canopy",unit:"mm",min:0,max:900,step:10,value:420,
       need:["canopy"]},
      {id:"fasciaHue",label:"Fascia colour",min:0,max:1,step:0.01,value:0.02,
       need:["meat"]}
    ]},
    {title:"Stock",open:true,rows:[
      {id:"aisleMix",type:"select",label:"What this run sells",value:"dry",
       need:["shelved"],options:[
        ["dry","Dry goods — boxes, tins, jars"],["drinks","Drinks — bottles and cans"],
        ["chill","Chilled — trays, tubs, cartons"],["frozen","Frozen — bags and boxes"],
        ["impulse","Impulse — confectionery and snacks"]]},
      {id:"chillMix",type:"select",label:"What the case holds",value:"chill",
       need:["chilled"],options:[
        ["chill","Chilled — trays, tubs, cartons"],["meat","Meat — trays"],
        ["drinks","Drinks — bottles and cans"]]},
      {id:"fill",label:"How well stocked",min:0.1,max:1,step:0.01,value:0.9},
      {id:"tidy",label:"Faced up",min:0,max:1,step:0.01,value:0.82},
      {id:"punch",label:"Packaging colour",min:0.1,max:1.4,step:0.01,value:1},
      {id:"wear",label:"Handled and scuffed",min:0,max:1,step:0.01,value:0.18},
      {type:"note",html:'"Faced up" is how far forward the stock is pulled and how '+
        'straight it stands. At 1 the shop has just been fronted; at 0 it is Sunday '+
        'evening.'}
    ]},
    {title:"Glazing",open:true,need:["glazed"],rows:[
      {id:"frost",label:"Frost on the glass",min:0,max:1,step:0.01,value:0.5},
      {id:"frameMm",label:"Door frame",unit:"mm",min:30,max:140,step:2,value:64}
    ]},
    {title:"Lane",open:true,need:["lane"],rows:[
      {type:"checks",items:[{id:"laneOpen",label:"Lane light green",value:true}]}
    ]},
    {title:"Micro detail",rows:[
      {id:"occ",label:"Gap occlusion",min:0,max:1,step:0.01,value:0.8},
      {id:"mDust",label:"Ledge dust",min:0,max:1,step:0.01,value:0.35},
      {id:"mCurve",label:"Edge wear",min:0,max:1,step:0.01,value:0.4},
      {id:"mGrain",label:"Surface grain",min:0,max:1,step:0.01,value:0.35}
    ]},
    {title:"Maps",rows:[
      {id:"relief",label:"Relief into the normals",min:0,max:1,step:0.01,value:0.22},
      {id:"normalStr",label:"Normal strength",min:0.1,max:3,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:1},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]},
      {type:"note",html:"The height map always carries the fixture's <b>true</b> depth — "+
        "a 300&nbsp;mm package really is 300&nbsp;mm proud. <b>Relief</b> is how much of "+
        "that standing depth reaches the <i>normal</i> map; the surface detail on the "+
        "packaging is always at full strength. At 1 the two are the same field."}
    ]}
  ],

  needs:function(P){
    const piece=P.piece||"gondola";
    const need=[piece];
    if(piece==="gondola"||piece==="freezer"||piece==="checkout")need.push("shelved");
    if(piece==="produce"||piece==="meat"||piece==="endcap")need.push("tiered");
    if(piece==="meat"||piece==="deli")need.push("canopy","chilled");
    if(piece==="freezer"||piece==="deli")need.push("glazed");
    if(piece==="checkout")need.push("lane");
    return need;
  },

  readout:function(P){
    const g=geom(P);
    const mmPerPx=g.FW/g.TW;
    const D=decks(g);
    let m="<b>"+(g.FW/1000).toFixed(2)+" × "+(g.FH/1000).toFixed(2)+" m</b> · "+
      g.TW+" × "+g.TH+" px<br>"+mmPerPx.toFixed(2)+" mm per texel · "+
      g.bays+" bay"+(g.bays===1?"":"s")+" at "+Math.round(g.bayW)+" mm";
    if(g.piece==="gondola"||g.piece==="freezer")
      m+="<br><b>"+D.length+"</b> deck"+(D.length===1?"":"s")+", pitch "+
         (D.length>1?Math.round(D[1].y-D[0].y):Math.round(g.fixH-g.deck))+" mm";
    if(mmPerPx>4.6)m+=' <span class="warn">— shelf labels and can rims will be mush</span>';
    if(g.capped)m+='<br><span class="warn">capped from '+g.asked+' px — this run is '+
      (g.FH/g.FW).toFixed(2)+'× its width and the full size would not fit in memory</span>';
    return m;
  },

  /* millimetres in, metres out. A fixture, not a building: no roof, and the
     alpha is the silhouette. */
  plan:function(P){
    const g=geom(P);
    return {w:g.FW/1000,h:g.FH/1000,cutout:true};
  },

  size:function(P,preview){
    const g=geom(P);
    if(preview){
      const w=Math.min(g.TW,240);
      return {w:w,h:Math.max(8,Math.round(w*g.FH/g.FW/2)*2)};
    }
    return {w:g.TW,h:g.TH};
  },
  build:build,

  /* the case lighting is coloured per fixture — a chiller is cold, a menu
     board is warm, a lane light is red or green — so it needs an RGB emissive
     rather than the runtime's single warm ramp */
  writers:function(B){
    const E=B.EMC,ID=B.MAT;
    return {
      emissive:function(i,o,k){o[k]=E[i*3];o[k+1]=E[i*3+1];o[k+2]=E[i*3+2];return 255;},
      id:function(i,o,k){
        const c=IDCOL[ID[i]]||IDCOL[0];
        o[k]=c[0];o[k+1]=c[1];o[k+2]=c[2];
        return 255;
      }
    };
  },

  sizeTag:function(P){return (P.piece||"gondola")+" · "+(P.bays|0)+" bay";},
  fileBase:function(P,W,H){return "grocery_"+(P.piece||"gondola")+"_"+(P.seed|0)+"_"+W+"x"+H;},

  readme:function(P,info){
    const g=geom(P);
    const D=decks(g);
    const label=(PIECES.find(x=>x[0]===g.piece)||PIECES[0])[1];
    return ["Texture Forge · grocery — "+label,
      "",
      "Seed "+(P.seed|0)+"   Resolution "+info.W+"x"+info.H,
      "The run is "+(g.FW/1000).toFixed(2)+" x "+(g.FH/1000).toFixed(2)+" m — "+
        g.bays+" bay"+(g.bays===1?"":"s")+" at "+Math.round(g.bayW)+" mm — so one texel is "+
        (g.FW/info.W).toFixed(2)+" mm.",
      (g.piece==="gondola"||g.piece==="freezer")
        ? D.length+" decks, the base at "+Math.round(g.deck)+" mm and "+Math.round(g.deckD)+
          " mm deep, the shelves over it "+Math.round(g.shelfD)+" mm."
        : "",
      "",
      "A FIXTURE, NOT A TILING MATERIAL. It carries an alpha channel: past the ends and",
      "over the top rail there is no fixture, so it cuts out on a plane and the aisle",
      "behind shows through. Stand two of them facing each other and you have an aisle.",
      "",
      "TWO HEIGHT FIELDS, one exported. height.png and the 16-bit height carry the TRUE",
      "depth of the fixture — a package 300 mm proud of the back panel really is 300 mm",
      "proud, in units of the face width. The NORMAL map is built from a second field:",
      "the same surface detail at full strength, plus that standing depth scaled by the",
      "Relief control (this build: "+(+P.relief).toFixed(2)+"). At Relief 1 they are the",
      "same field, and every silhouette edge in the normal map is a vertical cliff —",
      "correct, and usually not what you want on a flat plane.",
      "",
      "basecolor.png  sRGB albedo, alpha = the silhouette. Import as sRGB.",
      "normal.png     Tangent space, "+info.normalNote+".",
      "roughness.png  Linear grey. Film and glass are low, card and steel are high.",
      "metallic.png   Cans and stainless only.",
      "ao.png         Linear grey. Carries the shelf shadow and the gap occlusion, which",
      "               is most of what makes a shelf read as deep rather than as a collage.",
      "emissive.png   Case lighting, menu boards and the lane light. Black elsewhere.",
      "height.png     Linear grey, 0-1 spanning "+((info.hMax-info.hMin)).toFixed(4)+
        " in face-width units.",
      "orm.png        R = AO, G = roughness, B = metallic.",
      "id.png         Material id: steel, shelf, price rail, card, can, bottle, film,",
      "               produce, meat, glass, stainless, floor, sign, lamp, rubber, crate.",
      "opacity.png    The silhouette on its own.",
      "",
      "Everything is dimensioned in real millimetres. A gondola bay is 1219 mm (48 in)",
      "and stands 2134 mm (7 ft); a can is 66 mm across and 122 mm tall; a shelf-edge",
      "rail is 26 mm. Nothing here is lettered — at the size a shelf is seen the",
      "printing on a package is a pale patch with a dark bar in it, which is what this",
      "draws, and it keeps the whole mode off the main thread."].filter(Boolean).join("\n");
  }
});

})();
