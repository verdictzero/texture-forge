/* =====================================================================
   LIBRARY: town — where the streets go and what stands on them
   =====================================================================

   Everything here is arithmetic in metres and nothing here draws. It
   answers one question — given a seed and a handful of numbers, where
   are the streets, where are the blocks between them, and what building
   is standing on which piece of ground facing which way — and hands back
   a plain object. forge-model.js turns that into triangles; forge-core
   puts the textures on them. Split that way because the layout is the
   part worth testing on its own, and a headless test cannot make a
   WebGL context.

   THE ONE NUMBER THAT IS NOT FREE. A street corridor is exactly as wide
   as the street texture says it is. That texture is a square tile
   covering `tileM` metres, laid with u along the direction of travel and
   v across the whole cross-section — lanes, shoulders, kerbs, footways,
   all of it. So the corridor IS tileM, and a town that picked its own
   road width would be stretching the kerbs to reach it. The caller
   passes the number the street step settled on and the grid is built
   around it.

   WHAT A LOT IS. Not a parcel with a deed. It is a piece of block
   frontage wide enough for one building, with the block boundary in
   front of it and the middle of the block behind. A lot knows which
   street it faces, so it knows which way its front wall points; that is
   the whole of the orientation problem and it is why the buildings all
   face the road rather than all facing north.

   WHAT IT DOES NOT DO. No curves, no cul-de-sacs, no diagonals, no
   topography. A grid town with jittered block sizes, which is most of
   the Midwest and all of the part of it anybody builds a texture set
   for. The seams are all in one place if that ever needs to change:
   `corridors()` decides where the streets are and everything downstream
   reads that.
   ===================================================================== */
"use strict";

(function(){

const clamp=Forge.clamp,mulberry32=Forge.mulberry32;

/* ============================ the street grid ============================

   Corridor centres along one axis, from a count and a nominal block size.
   The blocks between them jitter; the corridors do not, because a road
   that changes width down its length is a different kind of drawing and
   the texture across it is a fixed cross-section.

   Returns the centre of each corridor and the span of each block, both in
   metres, with the whole run centred on zero — so a town sits on the
   origin whatever size it is and the camera has somewhere obvious to
   look. */
function corridors(n,blockM,roadM,jitter,rng){
  const N=Math.max(1,n|0);
  const spans=[];
  let total=0;
  for(let i=0;i<N;i++){
    /* the jitter is on the block, not on the road: a short block and a
       long block either side of the same street is a town that grew, two
       streets at different widths is a town that cannot decide */
    const k=1+(rng()-0.5)*1.2*clamp(jitter,0,1);
    const s=Math.max(blockM*0.35,blockM*k);
    spans.push(s);total+=s;
  }
  total+=roadM*(N+1);
  const mid=[],lo=[],hi=[];
  let at=-total/2;
  for(let i=0;i<N;i++){
    mid.push(at+roadM/2);                       // the corridor before this block
    lo.push(at+roadM);
    hi.push(at+roadM+spans[i]);
    at+=roadM+spans[i];
  }
  mid.push(at+roadM/2);                         // and the one past the last block
  return {mid:mid,lo:lo,hi:hi,spans:spans,extent:total};
}

/* ============================ lots along one edge ============================

   One edge of one block, divided into frontages. The count comes from the
   building that wants to stand there rather than from a fixed lot width:
   ask for as many as fit at the natural width plus a gap, then share the
   edge out equally between them, so the row lands flush with both corners
   instead of leaving a ragged end.

   INSET IS NOT SYMMETRICAL BETWEEN THE FOUR EDGES, and it cannot be. Two
   buildings meeting at the corner of a block want the same ground. The
   long edges take the corners and the short edges start a building's
   depth in from each end — which is what a real block does, because the
   corner lot fronts the busier street. */
function frontages(len,natural,gap,minW){
  const want=Math.max(natural,minW)+gap;
  const n=Math.max(1,Math.floor(len/want+0.35));
  const each=len/n;
  return {n:n,each:each};
}

/* ============================ zoning ============================

   What stands where. Not a rule — a bias, because a shop on the edge and
   a house on the square both happen and a town where every ring is one
   thing reads as a diagram.

   Distance is measured from the middle of town in BLOCKS rather than
   metres, so the shape of the town holds when the blocks are resized.

   NEITHER OF THE TWO THINGS THAT ARE NOT HOUSES GETS A LOT. A factory is
   twenty-six
   metres across and thirty-four deep; a residential block is fifty-five
   deep, so two rows of them back to back do not fit and one squeezed to
   where it does is a shed. It is also not what a works looks like from
   the road: it stands in its own ground with a yard round it. So the
   edge blocks are zoned industrial outright and take one building each,
   and the perimeter-lot machinery below never sees the type at all. */
function zoneWeights(t,onMain,mix){
  const d=clamp(t,0,1);
  /* THE DINER IS NOT A LOT TYPE, and it stopped being one the moment it was
     looked at. Weighted per lot it came out thirty times a town, every one of
     them shrunk to a house-sized frontage — thirty small diners, which is not
     a town, it is a food court. A town has ONE, it is big, and it is on Main
     Street. So it is placed as a LANDMARK below, over as much frontage as it
     needs, and what is left for the weighted pick is the thing a town is
     actually made of.

     The shape of the bias is kept because it is still doing something: a lot
     on the through road is a wider lot, so a house there is a bigger house. */
  const w={house:onMain?(1.6+0.4*d):(1.5+0.4*d)};
  const m=mix||{};
  for(const k in w)w[k]=Math.max(0,w[k]*(m[k]===undefined?1:m[k]));
  return w;
}

/* ============================ what a building is made of ============================

   ONE TEXTURE IS NOT ONE BUILDING. A town of two hundred houses off one
   elevation was two hundred identical grey boxes in rows, which is the one
   thing a town never looks like — and forging two hundred textures is not the
   answer either. Everything below is variation that costs NO texture at all:

     it is mirrored or it is not          the front elevation flipped
     the roof runs the other way          ridge across or front-to-back, and
                                          a flat one now and then
     it is taller or shorter              a height multiplier, which the
                                          elevation carries without stretching
                                          because the wall is what repeats
     it is deeper or shallower            within the block's own depth budget
     it sits further back                 the setback jittered per lot
     and MOST OF THEM HAVE SOMETHING      a garage beside it, a wing off the
     STUCK ON THE SIDE                    back, a porch across the front

   THE ATTACHED MASSES ARE THE BIG ONE. A garage is not a small house — it is a
   wall four metres high with a door in it — so it wears a WINDOW of the
   parent's own elevation rather than the whole thing squashed: the bottom four
   metres of it, at the same texel scale, which is a real wall at a real size.

   COMPOSED INSIDE THE LOT'S OWN FRONTAGE, which is why this is here and not in
   the renderer. A garage that widened the building after the layout had
   checked its ground would be a garage standing in next door's kitchen; the
   fit is worked out from the composition, so the footprint the overlap test
   sees is the footprint that gets drawn.

   The frame is the building's own: +x across its front as somebody standing
   outside sees it, +z toward the street, origin at the middle of the ENVELOPE
   rather than of the main mass — so the lot can go on treating it as one box.
*/
/* THE GARAGE GOES BEHIND, and it went there after being measured. A lot is
   the house's own width plus a gap — nine metres of buildable frontage for a
   nine-metre house — so a garage BESIDE one never once fitted and every one of
   them was quietly dropped. Behind it there is depth to spare, which is also
   where the garage on a gridded town's alley actually is. */
const STYLE_FIT={none:[1,1],garage:[1,1.42],ell:[1,1.44],porch:[1,1.26]};

function compose(S,sc,st){
  const W=S.w*sc,D=S.d*sc;
  const parts=[{kind:"main",x:0,z:0,w:W,d:D,h:1}];
  const side=st.side>=0?1:-1;
  if(st.wing==="garage"){
    const gw=W*0.50,gd=D*0.40;
    parts.push({kind:"garage",x:side*(W/2-gw/2),z:-D/2-gd/2+D*0.02,
                w:gw,d:gd,h:0.50,flat:true});
  }else if(st.wing==="ell"){
    const ew=W*0.54,ed=D*0.44;
    parts.push({kind:"ell",x:side*(W/2-ew/2),z:-D/2-ed/2+D*0.04,
                w:ew,d:ed,h:0.86});
  }else if(st.wing==="porch"){
    const pw=W*0.68,pd=Math.min(2.8,D*0.26);
    parts.push({kind:"porch",x:side*W*0.06,z:D/2+pd/2,w:pw,d:pd,h:0.42,flat:true});
  }
  /* A STACK IS SILHOUETTE FOR NOTHING. It stands against the side wall, half
     inside the mass it belongs to, so it adds a few centimetres to the
     envelope and a chimney to the skyline. */
  if(st.stack){
    const cw=Math.max(0.7,W*0.11);
    parts.push({kind:"stack",x:-side*(W/2-cw*0.25),z:-D*0.10,
                w:cw,d:cw*1.2,h:1.22,flat:true,thin:true});
  }
  let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
  for(const p of parts){
    if(p.x-p.w/2<x0)x0=p.x-p.w/2;
    if(p.x+p.w/2>x1)x1=p.x+p.w/2;
    if(p.z-p.d/2<z0)z0=p.z-p.d/2;
    if(p.z+p.d/2>z1)z1=p.z+p.d/2;
  }
  const cx=(x0+x1)/2,cz=(z0+z1)/2;
  for(const p of parts){p.x-=cx;p.z-=cz;}
  return {parts:parts,W:x1-x0,D:z1-z0,mainW:W,mainD:D};
}

/* THE STYLE OF ONE BUILDING, off its own draw of the dice — so design mode can
   re-roll one of them without moving anything else — and scaled by `variety`,
   which is a real off switch: at zero every house is the elevation exactly as
   forged, standing square, unpainted, on the same setback as its neighbours,
   which is the town this used to make. */
function styleOf(seed,type,allow,variety){
  const r=mulberry32((seed|0)*2246822519+7);
  const v=clamp(variety===undefined?1:+variety,0,1);
  const roll=r();
  /* a works has nothing stuck on it and a diner is a landmark: both are drawn
     as the one thing their elevation says they are */
  const wing=(!allow||v<=0)?"none"
    :(roll<0.34*v?"garage":roll<0.56*v?"ell":roll<0.70*v?"porch":"none");
  const rr=r(),mir=r(),sd=r(),rg=r(),pt=r(),hm=r(),sb=r(),tn=r();
  return {
    mirror:mir<0.5*v,
    side:sd<0.5?1:-1,
    wing:wing,
    /* WHICH WAY THE RIDGE RUNS is most of what an aerial view of a town is,
       and it is free: the roof is a tiling material either way. A few flat
       ones because a few of them are. */
    ridge:(rg<0.45*v)?"z":"x",
    flat:rr>1-0.10*v,
    pitch:6+(pt-0.5)*5*v,
    /* the elevation is a wall with a roofline on it, so a few per cent of
       height is a skyline rather than a stretch anybody can see */
    hMul:1+(hm-0.5)*0.24*v,
    setbackK:1+(sb-0.5)*0.9*v,
    /* WHICH PAINT. A street where every house is the same colour is the one
       thing left saying "this is one texture" after the massing has stopped
       saying it, and it costs nothing but a multiplier on the base colour —
       which is also what repainting a house is. The renderer owns the palette;
       this is only which one, and zero is the first entry, which is no paint
       at all. */
    tint:(v<=0)?0:Math.floor(tn*97),
    stack:r()<0.38*v
  };
}

/* ============================ landmarks ============================

   ONE BIG DINER, on Main Street, at the size its own texture was drawn at.

   It cannot go on a lot, because a lot is a house's frontage — twelve metres
   of it — and a diner is fourteen wide before it is anything. Shrinking it to
   fit is what produced thirty small ones. So it takes the frontage it needs:
   a run of neighbouring lots on the same edge is lifted out and the diner
   stands on the ground they were sharing, centred on it, at a scale the merged
   frontage and the block's own depth allow — never below its natural size, or
   it would not be worth doing.

   WHICH RUN. The one nearest the middle of town, on a through road, long
   enough to hold the thing. That is what makes it read as the middle of town
   rather than as a building that happens to be larger. */
function landmarks(L,type,want,sizes,P,rng){
  const S=sizes&&sizes[type];
  const n=Math.max(0,want|0);
  if(!S||!n)return;
  const sMax=Math.max(1,+P.scaleMax||1.3);
  const gap=P.gap===undefined?2.5:+P.gap;
  const setback=Math.max(0,+P.setback===undefined?5:+P.setback);

  /* the lots of one block edge, in the order they sit along it */
  const runs={};
  for(const lot of L.lots){
    if(!lot.main||lot.side==="whole")continue;
    const k=lot.block+"/"+lot.side;
    (runs[k]||(runs[k]=[])).push(lot);
  }
  const cand=[];
  for(const k in runs){
    const row=runs[k];
    if(!row.length)continue;
    const alongX=(row[0].ax==="x");
    row.sort((a,b)=>(alongX?a.x-b.x:a.z-b.z));
    const blk=L.blocks[row[0].block];
    /* every window of neighbours wide enough to stand it at full size */
    for(let i=0;i<row.length;i++){
      let span=0;
      for(let j=i;j<row.length;j++){
        span+=row[j].frontage;
        if(span-gap<S.w)continue;              // still narrower than the building
        cand.push({row:row.slice(i,j+1),span:span,
                   /* nearest the middle of town wins, and a shorter run beats
                      a longer one so it does not eat a whole block */
                   cost:Math.hypot(blk.cx,blk.cz)+ (span-S.w-gap)*1.5});
        break;
      }
    }
  }
  cand.sort((a,b)=>a.cost-b.cost);

  const used={},out=[];
  for(const c of cand){
    if(out.length>=n)break;
    let clash=false;
    for(const lot of c.row)if(used[lot.i]){clash=true;break;}
    if(clash)continue;
    const first=c.row[0],alongX=(first.ax==="x");
    let a0=Infinity,a1=-Infinity;
    for(const lot of c.row){
      const at=alongX?lot.x:lot.z;
      if(at-lot.frontage/2<a0)a0=at-lot.frontage/2;
      if(at+lot.frontage/2>a1)a1=at+lot.frontage/2;
      used[lot.i]=1;
    }
    const frontage=a1-a0,at=(a0+a1)/2;
    const sc=clamp(Math.min((frontage-gap)/S.w,first.budget/S.d),1,sMax);
    /* a landmark is drawn as the one thing its elevation says it is: no
       garage, no back wing, and no mirroring — you know what the diner looks
       like and it is the same diner from either end of the street */
    const vseed=(rng()*1e9)|0;
    const style=styleOf(vseed,type,false,0);
    style.mirror=false;style.flat=true;
    const env=compose(S,sc,style);
    const w=env.W,d=env.D,off=setback+d/2;
    out.push({style:style,env:env,vseed:vseed,
              i:first.i,block:first.block,side:first.side,out:first.out,main:true,
              landmark:true,type:type,scale:sc,
              budget:first.budget,gap:gap,sMin:first.sMin,sMax:sMax,
              ax:first.ax,base:first.base,nrm:first.nrm,setback:setback,
              x:alongX?at:(first.base-first.nrm*off),
              z:alongX?(first.base-first.nrm*off):at,
              rot:first.rot,w:w,d:d,frontage:frontage,
              slide:Math.max(0,(frontage-w-gap)/2),along:0,
              variant:vseed});
  }
  if(!out.length)return;
  L.lots=L.lots.filter(x=>!used[x.i]).concat(out);
  L.lots.sort((a,b)=>a.i-b.i);
}

function pickType(w,rng){
  let tot=0;
  for(const k in w)tot+=w[k];
  if(tot<=0)return null;
  let r=rng()*tot;
  for(const k in w){r-=w[k];if(r<=0)return k;}
  return null;
}

/* ============================ the layout ============================

   P:
     seed            the whole town off one number
     cols, rows      blocks across and deep
     blockW, blockD  nominal block size, metres
     roadM           the corridor width — the street texture's own tile
     jitter          0..1, how unequal the blocks are
     setback         metres from the block boundary to the front wall
     gap             metres between neighbours on the same frontage
     density         0..1, what fraction of the lots are built on
     diners          how many landmark diners, default one
     variety         0..1, how far the buildings depart from the elevation
                     as forged — massing, roof, height, setback and paint
     industry        0..1, what fraction of the outer blocks are works
     mix             {house,diner,factory} multipliers, 0 drops a type
     scaleMin/Max    how far a building may be resized to fit its ground

   sizes: {type:{w,d}} — the real width and depth of each type in metres,
   straight off its own plan(). The layout never invents a size; it fits
   the ones it is given, and drops a type it cannot fit rather than
   drawing it at a size its own texture disagrees with.
   =====================================================================*/
function layout(P,sizes){
  const rng=mulberry32((P.seed|0)*2654435761+12345);
  const cols=clamp(P.cols|0||3,1,12),rows=clamp(P.rows|0||3,1,12);
  const roadM=Math.max(3,+P.roadM||14);
  const jitter=clamp(+P.jitter||0,0,1);
  const setback=Math.max(0,+P.setback===undefined?5:+P.setback);
  const gap=Math.max(0,P.gap===undefined?2.5:+P.gap);
  const density=clamp(P.density===undefined?0.85:+P.density,0,1);
  const industry=clamp(P.industry===undefined?0.5:+P.industry,0,1);
  const sMin=Math.max(0.4,+P.scaleMin||0.82),sMax=Math.max(sMin,+P.scaleMax||1.3);
  const variety=clamp(P.variety===undefined?1:+P.variety,0,1);
  const mix=P.mix||{};

  const X=corridors(cols,Math.max(12,+P.blockW||70),roadM,jitter,rng);
  const Z=corridors(rows,Math.max(12,+P.blockD||55),roadM,jitter,rng);

  const half=roadM/2;
  const streets=[],nodes=[],blocks=[];
  let lots=[];
  /* the two through roads, as near the middle as the grid allows */
  const mainI=X.mid.length>>1,mainJ=Z.mid.length>>1;

  /* --- the corridors, as runs between junctions ---------------------------
     A run stops at the near edge of the junction it arrives at rather than
     driving through it: the junction is a different piece of the street
     texture, and two of them laid over each other z-fight for the whole
     square. */
  for(let i=0;i<X.mid.length;i++)
    for(let j=0;j<Z.mid.length-1;j++)
      streets.push({axis:"z",x:X.mid[i],z0:Z.mid[j]+half,z1:Z.mid[j+1]-half,w:roadM,main:i===mainI});
  for(let j=0;j<Z.mid.length;j++)
    for(let i=0;i<X.mid.length-1;i++)
      streets.push({axis:"x",z:Z.mid[j],x0:X.mid[i]+half,x1:X.mid[i+1]-half,w:roadM,main:j===mainJ});
  for(let i=0;i<X.mid.length;i++)
    for(let j=0;j<Z.mid.length;j++)
      nodes.push({x:X.mid[i],z:Z.mid[j],w:roadM,main:(i===mainI||j===mainJ)});

  /* how far out of the middle a block is, 0 at the centre and 1 at the rim,
     on whichever axis is further out */
  const outness=(bx,bz)=>{
    const dx=cols<=1?0:Math.abs(bx-(cols-1)/2)/((cols-1)/2);
    const dz=rows<=1?0:Math.abs(bz-(rows-1)/2)/((rows-1)/2);
    return Math.max(dx,dz);
  };

  /* the deepest thing that will ever stand on a perimeter lot, which is what
     the side rows have to keep clear of at the corners */
  let deepLot=0;
  for(const k in sizes)if(k!=="factory"&&sizes[k]&&sizes[k].d>deepLot)deepLot=sizes[k].d;

  for(let bz=0;bz<rows;bz++)for(let bx=0;bx<cols;bx++){
    const x0=X.lo[bx],x1=X.hi[bx],z0=Z.lo[bz],z1=Z.hi[bz];
    const t=outness(bx,bz);
    const bi=blocks.length;
    const BW=x1-x0,BD=z1-z0;

    /* --- an industrial block: one works in its own ground ---------------- */
    const F=sizes.factory;
    const onMain=(bx===mainI||bx+1===mainI||bz===mainJ||bz+1===mainJ);
    const wantWorks=F&&(mix.factory===undefined||mix.factory>0)&&
                    t>0.99&&!onMain&&rng()<industry;
    if(wantWorks){
      /* it faces the nearest edge of town, which is the road out of it */
      const dx=cols<=1?0:(bx-(cols-1)/2),dz=rows<=1?0:(bz-(rows-1)/2);
      const alongX=Math.abs(dx)*(BD)>=Math.abs(dz)*(BW);
      const rot=alongX?(dx>=0?Math.PI/2:-Math.PI/2):(dz>=0?0:Math.PI);
      const yard=Math.max(setback,6);
      const availW=(alongX?BD:BW)-yard*2,availD=(alongX?BW:BD)-yard*2;
      const sc=clamp(Math.min(availW/F.w,availD/F.d),0,sMax);
      if(sc>=sMin*0.75){
        blocks.push({i:bi,x0:x0,x1:x1,z0:z0,z1:z1,out:t,use:"industrial",
                     cx:(x0+x1)/2,cz:(z0+z1)/2});
        lots.push({i:lots.length,block:bi,side:"whole",out:t,main:false,type:"factory",scale:sc,
                   x:(x0+x1)/2,z:(z0+z1)/2,rot:rot,w:F.w*sc,d:F.d*sc,
                   frontage:alongX?BD:BW,budget:availD,gap:0,sMin:sMin,sMax:sMax,
                   slide:0,along:0,variant:(rng()*1e9)|0});
        continue;
      }
      /* it would not fit even at the yard's expense, so the block stays a
         street of houses rather than becoming a shed */
    }

    blocks.push({i:bi,x0:x0,x1:x1,z0:z0,z1:z1,out:t,
                 use:onMain?"commercial":"residential",
                 cx:(x0+x1)/2,cz:(z0+z1)/2});

    /* THE CORNER BELONGS TO THE LONG EDGES. Two buildings meeting at the
       corner of a block want the same ground; the ones fronting the wider
       street take it and the side rows start clear of them, which is what a
       real block does. Cleared by the deepest thing that could land there,
       so it holds whichever types come up. */
    const corner=Math.min(BD*0.42,setback+deepLot*sMax);

    /* how deep a row may build before it meets the row facing the other way.
       Never the whole half-block: the middle of a block is yards and alleys,
       and two rows backing straight onto each other is a barracks. */
    const depthX=Math.max(4,BD*0.40-setback);
    const depthZ=Math.max(4,BW*0.40-setback);

    const edges=[
      {side:"s",n:1,ax:"x",a0:x0,a1:x1,base:z1,rot:0,        budget:depthX,main:bz+1===mainJ},
      {side:"n",n:-1,ax:"x",a0:x0,a1:x1,base:z0,rot:Math.PI, budget:depthX,main:bz===mainJ},
      {side:"e",n:1,ax:"z",a0:z0+corner,a1:z1-corner,base:x1,rot:Math.PI/2, budget:depthZ,main:bx+1===mainI},
      {side:"w",n:-1,ax:"z",a0:z0+corner,a1:z1-corner,base:x0,rot:-Math.PI/2,budget:depthZ,main:bx===mainI}
    ];
    for(const e of edges){
      const len=e.a1-e.a0;
      if(len<8)continue;
      /* the frontage count is set by the commonest type on this block, so a
         residential street gets house-sized lots and the strip gets shop-sized
         ones, rather than every block being divided the same way */
      const w0=zoneWeights(t,e.main,mix);
      let lead=null,best=-1;
      for(const k in w0)if(w0[k]>best&&sizes[k]){best=w0[k];lead=k;}
      const nat=(lead&&sizes[lead]&&sizes[lead].w)||10;
      const FR=frontages(len,nat,gap,6);
      for(let k=0;k<FR.n;k++){
        const c=e.a0+FR.each*(k+0.5);
        if(rng()>=density)continue;
        const type=pickType(zoneWeights(t,e.main,mix),rng);
        const S=type&&sizes[type];
        if(!S)continue;

        /* THE FIT IS OF THE WHOLE COMPOSITION, not of the main mass. A garage
           worked out after the ground was checked is a garage standing in next
           door's kitchen, so the style is chosen first and the scale is what
           the style will fit in. Uniform, because the front is an elevation
           and squashing one axis of it makes a building nobody built. */
        const vseed=(rng()*1e9)|0;
        let style=styleOf(vseed,type,true,variety);
        const fitAt=st=>{
          const K=STYLE_FIT[st.wing]||STYLE_FIT.none;
          return clamp(Math.min((FR.each-gap)/Math.max(0.01,S.w*K[0]),
                                e.budget/Math.max(0.01,S.d*K[1])),0,sMax);
        };
        let sc=fitAt(style);
        if(sc<sMin&&style.wing!=="none"){
          /* the ground will not take what it wanted, so it loses the wing
             rather than the building — a house at eight tenths is a small
             house, a house that never got laid is a gap */
          style=Object.assign({},style,{wing:"none"});
          sc=fitAt(style);
        }
        if(sc<sMin)continue;                   // it does not belong on this ground
        const env=compose(S,sc,style);
        const w=env.W,d=env.D;
        /* the setback is jittered per lot, kept clear of the kerb and of the
           row behind: a street where every front wall is on one line is a
           terrace, and these are not terraces */
        const room=Math.max(0,e.budget-d);
        const back=Math.max(1.8,Math.min(setback*style.setbackK,room));
        const off=back+d/2;                    // INTO the block, away from the road
        lots.push({
          style:style,env:env,vseed:vseed,variety:variety,
          i:lots.length,block:bi,side:e.side,out:t,main:!!e.main,type:type,scale:sc,
          /* kept so design mode can swap the type on this lot and work out the
             new size exactly the way the layout would have */
          budget:e.budget,gap:gap,sMin:sMin,sMax:sMax,
          /* the edge this lot sits on, so a landmark that swallows several of
             them can work out where the merged frontage puts its front wall
             with the same arithmetic that put theirs */
          ax:e.ax,base:e.base,nrm:e.n,setback:setback,
          x:(e.ax==="x")?c:(e.base-e.n*off),
          z:(e.ax==="x")?(e.base-e.n*off):c,
          rot:e.rot,w:w,d:d,
          frontage:FR.each,
          /* how far it may slide along its own frontage before it touches a
             neighbour — design mode's leash */
          slide:Math.max(0,(FR.each-w-gap)/2),
          along:0,
          /* its own draw of the dice, so design mode can re-roll one building
             without moving the rest of the town */
          variant:vseed
        });
      }
    }
  }

  const L0={streets:streets,nodes:nodes,blocks:blocks,lots:lots};
  /* ONE BY DEFAULT. Ask for none and the town has no diner in it; ask for
     three and it has three, each on its own stretch of a through road. */
  landmarks(L0,"diner",
            (mix.diner===0)?0:(P.diners===undefined?1:Math.max(0,P.diners|0)),
            sizes,P,rng);
  lots=L0.lots;

  return {
    streets:streets,nodes:nodes,blocks:blocks,lots:lots,
    roadM:roadM,setback:setback,
    grid:{cols:cols,rows:rows,x:X,z:Z},
    bounds:{x0:X.mid[0]-half,x1:X.mid[X.mid.length-1]+half,
            z0:Z.mid[0]-half,z1:Z.mid[Z.mid.length-1]+half,
            w:X.extent,d:Z.extent}
  };
}

/* PUT A DIFFERENT BUILDING ON THIS LOT. Design mode's swap, and it has to
   resize exactly the way the layout would have: the frontage and the block's
   own depth both get a say and the smaller wins, uniformly, because the front
   is an elevation and squashing one axis of it makes a building nobody built.
   Returns false and changes nothing where the type will not fit — a works does
   not go on a house lot, and pretending it does is a shed. */
function retype(lot,type,sizes,seed){
  const S=sizes&&sizes[type];
  if(!S)return false;
  const sMin=lot.sMin||0.82,sMax=lot.sMax||1.3,gap=lot.gap===undefined?2.5:lot.gap;
  const vseed=(seed===undefined?lot.vseed:seed)|0;
  /* THE WHOLE COMPOSITION AGAIN, exactly as the layout worked it out — a
     design-mode swap that ignored the garage would put one through the wall
     next door. A landmark keeps its plain shape. */
  let style=styleOf(vseed,type,!lot.landmark,lot.variety===undefined?1:lot.variety);
  const fitAt=st=>{
    const K=STYLE_FIT[st.wing]||STYLE_FIT.none;
    return clamp(Math.min((lot.frontage-gap)/Math.max(0.01,S.w*K[0]),
                          (lot.budget||1e9)/Math.max(0.01,S.d*K[1])),0,sMax);
  };
  let sc=fitAt(style);
  if(sc<sMin&&style.wing!=="none"){style=Object.assign({},style,{wing:"none"});sc=fitAt(style);}
  if(sc<sMin)return false;
  const env=compose(S,sc,style);
  lot.type=type;lot.scale=sc;lot.style=style;lot.env=env;lot.vseed=vseed;
  lot.w=env.W;lot.d=env.D;
  /* the front wall stays where it was: the lot's ground did not move */
  if(lot.base!==undefined&&lot.nrm!==undefined&&lot.ax){
    const room=Math.max(0,(lot.budget||1e9)-lot.d);
    const back=Math.max(1.8,Math.min((lot.setback===undefined?5:lot.setback)*style.setbackK,room));
    const at=lot.base-lot.nrm*(back+lot.d/2);
    if(lot.ax==="x")lot.z=at;else lot.x=at;
  }
  lot.slide=Math.max(0,(lot.frontage-lot.w-gap)/2);
  if(lot.along>lot.slide)lot.along=lot.slide;
  if(lot.along<-lot.slide)lot.along=-lot.slide;
  return true;
}

/* Where a lot's building actually stands, once design mode has had its way
   with it. Kept here rather than in the renderer so the export and the
   picture cannot disagree about it. */
function placeOf(lot){
  const c=Math.cos(lot.rot),s=Math.sin(lot.rot);
  /* +along runs left-to-right across the building's own front */
  const a=clamp(lot.along||0,-lot.slide,lot.slide);
  lot.px=lot.x+c*a;lot.pz=lot.z-s*a;
  return {x:lot.px,z:lot.pz,rot:lot.rot,w:lot.w,d:lot.d,scale:lot.scale};
}
/* every lot's standing position written back onto it, which is what the
   geometry reads */
function settle(L){for(const lot of L.lots)placeOf(lot);return L;}

/* A count of what came out, for the readout and the readme: a town that
   says it has forty houses and shows nine is a town nobody trusts. */
function census(L){
  const c={lots:L.lots.length,blocks:L.blocks.length,
           streets:L.streets.length,junctions:L.nodes.length,by:{}};
  for(const lot of L.lots)c.by[lot.type]=(c.by[lot.type]|0)+1;
  return c;
}

/* ============================ the kit ============================

   A town is not one building, so its wizard is not one building's four faces.
   It is a HOUSE, a DINER, a WORKS and a ROAD, forged once each and then stood
   up two hundred times — which is the only way a town of this size is
   affordable at all: thirteen textures, not eight hundred.

   Each group starts `fresh` — nothing is carried into it — which stops the
   diner opening on the house's clapboard and the road on the diner's chrome. Within a group the
   inheritance is exactly what it has always been: set the front and the side
   and the back follow it.

   `town.kit` names which step's texture goes on which face of which type. The
   layout engine above and the geometry in forge-model.js both read it, so
   there is one list of what a town is made of rather than three. */
Forge.registerStructure({
  id:"town",
  label:"Town",
  blurb:"A street grid, and a house, a diner and a works standing on it",
  town:{
    kit:{
      house:  {front:"house_front",  side:"house_side",  back:"house_back",  roof:"roof_pitch"},
      diner:  {front:"diner_front",  side:"diner_side",  back:"diner_back",  roof:"roof_flat"},
      factory:{front:"factory_front",side:"factory_side",back:"factory_back",roof:"roof_flat"},
      street: {run:"road",inter:"junction"}
    }
  },
  steps:[
    {id:"house_front",label:"House",mode:"house",set:{},fresh:true,
     note:"The house the town is mostly made of. Everything you set here — the width and "+
          "depth, the storeys, the cladding, the roof pitch — is what every house on every "+
          "residential street will be, so this is the one that decides what the place looks "+
          "like from the road."},
    {id:"house_side",label:"· side",mode:"envelope",set:{face:"side"},
     note:"The depth of that house, which is the one dimension the front never showed — and "+
          "the depth the layout sets its lots by."},
    {id:"house_back",label:"· back",mode:"envelope",set:{face:"back"},
     note:"The back of it. In a town you see a lot of these, over fences and down alleys, so "+
          "it is worth more than the five seconds one building's back wall gets."},
    {id:"roof_pitch",label:"· roof",mode:"roof",set:{rfType:"tab3"},
     note:"The pitched roof, and from the air it is most of what a town IS. Tiling material "+
          "rather than a cut-out face, so its resolution is texel density over the roof plane."},

    {id:"diner_front",label:"Diner",mode:"diner",set:{face:"front"},fresh:true,
     note:"What stands on Main Street. The layout puts these on the two through roads and "+
          "houses on everything behind them, so this is the face of the commercial strip."},
    {id:"diner_side",label:"· side",mode:"diner",set:{face:"side"},
     note:"The long run of it, which on a corner lot is what most of the town actually sees."},
    {id:"diner_back",label:"· back",mode:"diner",set:{face:"back"},
     note:"Service side: the bins, the extract, the door nobody uses."},

    {id:"factory_front",label:"Works",mode:"factory",set:{piece:"front"},fresh:true,
     note:"The works on the edge of town. These get a whole block each rather than a lot — a "+
          "building this size does not stand in a row of houses — so it has room around it."},
    {id:"factory_side",label:"· side",mode:"factory",set:{piece:"side"},
     note:"The long flank, and the one you see from the road out of town."},
    {id:"factory_back",label:"· back",mode:"factory",set:{piece:"back"},
     note:"The yard side."},

    {id:"roof_flat",label:"Flat roof",mode:"roof",set:{rfType:"rolled"},fresh:true,
     note:"One flat roof, shared by the diner and the works — rolled felt and gravel rather "+
          "than shingle. Pitched roofs came off the house step; this is everything else."},

    {id:"road",label:"Road",mode:"street",set:{piece:"cross",kerb:"both"},fresh:true,
     note:"THE ROAD DECIDES THE STREET WIDTH. This tile spans a whole cross-section — lanes, "+
          "shoulders, kerbs, footways — so whatever \u201cTile covers\u201d says here is "+
          "exactly how wide every corridor in the town is laid out. Change it and the grid "+
          "moves."},
    {id:"junction",label:"· junction",mode:"street",set:{piece:"inter"},
     note:"The four-way, laid at every crossing. It inherits the road's lanes and kerbs, so "+
          "the corners meet what runs into them."}
  ]
});

window.ForgeTown={
  layout:layout,
  landmarks:landmarks,
  styleOf:styleOf,compose:compose,STYLE_FIT:STYLE_FIT,
  retype:retype,
  placeOf:placeOf,
  settle:settle,
  census:census,
  corridors:corridors,
  zoneWeights:zoneWeights
};

})();
