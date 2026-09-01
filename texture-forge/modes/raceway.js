/* =====================================================================
   MODE: raceway — conduit dressed to a lattice, braced at intervals
   =====================================================================
   The other way a bundle of conduit gets from one end of a machine to
   the other. Not hand-dressed and following the shape of what it passes
   — that is the loom next door — but INSTALLED: everything runs along
   one of two axes, every direction change is a right angle, and every
   right angle is a radiused bend rather than a mitre, because conduit
   does not fold.

   THREE THINGS MAKE IT READ AS INSTALLED WORK RATHER THAN AS PIPES:

     the lattice   runs start on a grid and their legs are whole
                   multiples of it, so parallel runs line up with each
                   other instead of merely being parallel. That
                   alignment is most of what says somebody set this out
                   before building it.
     the fillet    a corner is a quarter-circle of a stated radius, and
                   the radius is a real number in millimetres you can
                   put on a drawing. A bundle taking it keeps its pitch,
                   so the inner conduits ride a tighter arc than the
                   outer ones and the whole group fans slightly through
                   the turn — which is exactly what a real one does, and
                   what a mitre can never look like.
     the brace     groups are held at intervals by a spacer comb rather
                   than strapped down: a bracket that stands BETWEEN the
                   conduits and posts up at each edge of the group. It
                   holds them apart at their spacing, and it does not
                   hide any of them, which a strap does.

   THE BEND RADIUS IS NOT A STYLE SETTING. Below about the bundle's own
   half-width plus a couple of conduit radii, the innermost conduit's
   arc turns inside out — its centre passes the centre of the turn — and
   the group crosses over itself in the corner. So the radius asked for
   is a floor-and-take-whichever-is-larger, and the readout says what it
   actually used.

   JUNCTIONS. A run can branch. A child starts at a point on its parent
   CARRYING THE PARENT'S HEADING, then immediately takes a fillet, so it
   leaves as a smooth tee rather than as a butt joint: its conduits come
   out of the group parallel to the rest and peel away through the bend.
   It takes some of the parent's conduits with it and sits a hair proud,
   so where the two overlap the branch cleanly rides over.

   Everything after the routing — materials, cross-sections, backplane,
   framed bay, shading, occlusion — is modes/lib/loom.js, shared with
   the conduit mode. Read that file for the stamp and for the
   parameter-name contract this one is written against.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,mulberry32=Forge.mulberry32;
const L=window.ForgeLoom;
const KIND=L.KIND,MATBY=L.MATBY,IDENT=L.IDENT,IDENTN=IDENT.length;
const isBay=L.isBay,geom=L.geom;
const HALFPI=Math.PI*0.5;

/* the bend radius the geometry will actually stand, whatever was asked for */
const bendFloor=(half,r)=>half+r*2.2;

/* ============================ the walk ============================
   Axis-aligned legs joined by quarter-circle fillets, emitted as the polyline
   the library stamps.

   The arc is INTEGRATED rather than constructed: a fixed turn of stepM/bendR a
   step, for as many steps as make a right angle. That gives a circle of the
   right radius to within a step, and — more usefully — it is the same loop as
   the straight, so there is one path through this function and no seam where a
   segment meets an arc.

   The heading is SNAPPED back to a multiple of a right angle at the end of
   every fillet. The turn per step does not divide π/2 exactly, so without the
   snap each corner leaves a fraction of a degree behind it, and forty corners
   later the lattice is visibly askew — which is the one thing this mode cannot
   afford, since being square is the entire subject. */
function walk(g,o){
  const stepM=o.stepM,bay=g.bay;
  const turn=stepM/o.bendR;
  const nArc=Math.max(1,Math.round(HALFPI/turn));
  const arcTurn=HALFPI/nArc;                    // so a corner is exactly square
  const rng=o.rng;
  const cap=Math.min(200000,Math.round(o.len/stepM));
  const pts=new Float64Array(cap*4);

  /* WHAT A RACEWAY DOES INSTEAD OF SWERVING. A loom dodges by leaning on the
     heading; this one cannot, because every leg is on an axis and a lean would
     cost it the only thing it is for. So it turns EARLY instead: the ground a
     full fillet ahead is the thing it watches, and when that is taken the
     corner it was going to make somewhere further along happens here, towards
     whichever side is open. Sighting one fillet ahead is not a margin picked
     to be safe — it is the distance the run needs in order to have turned by
     the time it arrives, so a shorter sight line would see the obstruction
     only once it was already committed to hitting it.

     Mid-fillet there is nothing to be done: the arc is a fixed number of steps
     and abandoning it half way leaves the heading off-axis for good. A run
     boxed in there ends, and its tail dives under whatever boxed it in. */
  const C=o.claims||null;
  const rad=o.rad||o.half;
  const sight=o.bendR+o.half+(C?C.cell:0);
  const trail=C?C.trail(rad,Math.max(2,Math.ceil((sight+rad*2.2)/stepM))):null;
  const skip=o.skip|0;
  const openAt=(hx,hy,d)=>C.clearAt(x+hx*d,y+hy*d,-hy,hx,o.half);

  let x=o.x,y=o.y,head=o.head,n=0;
  let why="len";
  let arc=o.firstCorner?nArc:0;
  let dir=o.firstDir||(rng()<0.5?-1:1);
  let leg=arc?0:o.legSteps();

  for(let i=0;i<cap;i++){
    const hx=Math.cos(head),hy=Math.sin(head);
    /* WHERE THE RUN IS STANDING, tested whatever it is in the middle of.
       Sighting a fillet ahead is what lets a straight leg turn out of trouble,
       but it is a RING rather than a swept volume: it asks about one distance
       only, and during a fillet — seventy-odd steps of it — nothing asks at
       all, so a corner drives straight through whatever it meets. Asking
       instead whether the run's own width is clear where it actually is cannot
       be fooled by either. A run that finds itself on top of another has no
       move left, mid-corner least of all, so it ends there and its tail dives
       under what it met, which is what the picture wants anyway. */
    if(C&&i>=skip&&!C.clearAt(x,y,-hy,hx,o.half*0.92)){why="blocked";break;}
    if(arc>0){
      head+=arcTurn*dir;
      arc--;
      if(arc===0){
        head=Math.round(head/HALFPI)*HALFPI;
        leg=o.legSteps();
      }
    }else{
      let forced=false;
      if(C&&i>=skip&&!openAt(hx,hy,sight)){
        /* -hy,hx is a left turn from the heading; hy,-hx a right one */
        const okL=openAt(-hy,hx,sight),okR=openAt(hy,-hx,sight);
        if(!okL&&!okR){why="blocked";break;}
        dir=okL?-1:1;forced=true;
      }
      if(forced){
        arc=nArc;head+=arcTurn*dir;arc--;leg=0;
      }else if(leg>0){
        leg--;
      }else{
        /* a corner of its own choosing still has to go somewhere: if the side
           the generator asked for is taken and the other is not, take the
           other, and if both are, stay on the leg and let the sight line above
           deal with what is in front */
        let d=rng()<0.5?-1:1;
        if(C&&i>=skip){
          const okD=openAt(d<0?-hy:hy,d<0?hx:-hx,sight);
          if(!okD){
            const okO=openAt(d<0?hy:-hy,d<0?-hx:hx,sight);
            if(okO)d=-d;else{leg=Math.max(1,Math.round(o.bendR/stepM));}
          }
        }
        if(leg===0){arc=nArc;dir=d;head+=arcTurn*dir;arc--;}
        else leg--;
      }
    }
    const tx=Math.cos(head),ty=Math.sin(head);
    x+=tx*stepM;y+=ty*stepM;
    if(bay){
      if(x<-o.half||y<-o.half||x>g.Wm+o.half||y>g.Hm+o.half){why="out";break;}
    }else{
      if(x<0)x+=g.Wm;else if(x>=g.Wm)x-=g.Wm;
      if(y<0)y+=g.Hm;else if(y>=g.Hm)y-=g.Hm;
    }
    const q=n*4;
    pts[q]=x;pts[q+1]=y;pts[q+2]=tx;pts[q+3]=ty;
    n++;
    if(trail)trail.push(x,y,-ty,tx);
  }
  if(trail)trail.flush();
  return {pts:pts,nPts:n,why:why};
}

/* ===================== A RACEWAY THAT DOES NOT END =====================
   The same idea as the loom's endless run and a different construction,
   because a raceway is not a curve, it is a CIRCUIT: a cyclic list of
   axis-aligned moves whose displacement is a whole number of tiles across and
   exactly nothing down. Walk it and you come back to where you started, on the
   heading you started on, having crossed the tile — so there is nothing to
   terminate.

   IT IS BUILT GEOMETRICALLY RATHER THAN INTEGRATED. The open walk turns by a
   fixed amount per step and snaps its heading square at the end of each
   fillet, which is a hundredth of a millimetre out per corner and does not
   matter when the run has ends. A loop has to arrive back on its own start
   exactly or the wrap shows a step, so here the vertices are computed, the
   quarter circles are drawn as quarter circles, and the closure is a property
   of the arithmetic rather than of the tolerance.

   EVERY LEG HAS TO BE LONGER THAN TWO FILLETS or consecutive corners eat each
   other and the run crosses itself. That is the whole constraint on how many
   excursions a circuit can have, and on a small tile with a wide group the
   answer is often none — which is not a failure, it is a straight run across
   the tile, and a straight run across a torus is as endless as anything. */
function closedLoop(g,o){
  const R=o.bendR,grid=o.grid,rng=o.rng;
  const prim=o.primary?1:0;
  const Wp=prim?g.Hm:g.Wm, Ws=prim?g.Wm:g.Hm;
  const need=2*R+grid*0.5;              // the shortest a leg may be
  const span=o.m*Wp;

  /* how many excursions fit: each one costs two primary legs and two
     secondary ones, and every one of them has to clear two fillets */
  let k=0;
  if(span>=2.4*need&&Ws>=2.2*need)k=1;
  if(span>=4.6*need&&Ws>=2.2*need&&rng()<0.5)k=2;

  const moves=[];
  const snap=v=>Math.max(1,Math.round(v/grid))*grid;
  if(k===0){
    moves.push({ax:prim,d:1,len:span});
  }else{
    /* the primary is cut into 2k pieces, each at least a leg long */
    const pieces=new Array(2*k).fill(0);
    let left=span;
    for(let i=0;i<2*k;i++){
      const remaining=2*k-1-i;
      const most=left-remaining*need;
      const v=snap(need+rng()*Math.max(0,most-need));
      pieces[i]=Math.min(v,left-remaining*need);
      left-=pieces[i];
    }
    pieces[2*k-1]+=left;                // the rounding goes on the last piece
    for(let i=0;i<k;i++){
      const e=snap(need+rng()*Math.max(0,Ws*0.34-need));
      const dir=rng()<0.5?1:-1;
      moves.push({ax:prim,d:1,len:pieces[i*2]});
      moves.push({ax:1-prim,d:dir,len:e});
      moves.push({ax:prim,d:1,len:pieces[i*2+1]});
      moves.push({ax:1-prim,d:-dir,len:e});
    }
  }
  for(let i=0;i<moves.length;i++)if(moves[i].len<=2*R+1e-9)return null;

  /* the vertices, then the fillets between them */
  const n=moves.length;
  const DX=[],DY=[],VX=[],VY=[];
  let x=o.x0,y=o.y0;
  for(let i=0;i<n;i++){
    const m=moves[i];
    const dx=m.ax===0?m.d:0, dy=m.ax===1?m.d:0;
    DX.push(dx);DY.push(dy);
    x+=dx*m.len;y+=dy*m.len;
    VX.push(x);VY.push(y);              // the vertex at the END of move i
  }

  const pts=[];
  const push=(px,py,tx,ty)=>{pts.push(px,py,tx,ty);};
  const HALF=Math.PI*0.5;

  if(n===1){
    const steps=Math.max(16,Math.round(moves[0].len/o.stepM));
    const ds=moves[0].len/steps;
    for(let i=0;i<steps;i++)
      push(o.x0+DX[0]*ds*i,o.y0+DY[0]*ds*i,DX[0],DY[0]);
  }else{
    /* B is where the previous fillet let go, A where the next one takes hold.
       THE FIRST B IS THE LAST ARC'S END, and the last vertex is the start again
       — a whole number of tiles further along, which is the same point on the
       torus and emphatically not the same number. Taking the unwrapped vertex
       here runs the opening straight backwards across the entire tile. */
    let bx=o.x0+DX[0]*R, by=o.y0+DY[0]*R;
    for(let i=0;i<n;i++){
      const ax2=VX[i]-DX[i]*R, ay2=VY[i]-DY[i]*R;
      const segx=ax2-bx, segy=ay2-by;
      const segL=Math.sqrt(segx*segx+segy*segy);
      const sN=Math.max(1,Math.round(segL/o.stepM));
      for(let q=0;q<sN;q++)
        push(bx+segx*q/sN,by+segy*q/sN,DX[i],DY[i]);
      /* the quarter circle onto the next leg */
      const j=(i+1)%n;
      const ox=ax2+DX[j]*R, oy=ay2+DY[j]*R;
      const a0=Math.atan2(ay2-oy,ax2-ox);
      const cross=DX[i]*DY[j]-DY[i]*DX[j];
      const turn=cross>0?HALF:-HALF;
      const aN=Math.max(2,Math.round(Math.abs(turn)*R/o.stepM));
      for(let q=0;q<aN;q++){
        const a=a0+turn*q/aN;
        const px=ox+Math.cos(a)*R, py=oy+Math.sin(a)*R;
        const tx=-Math.sin(a)*Math.sign(turn), ty=Math.cos(a)*Math.sign(turn);
        push(px,py,tx,ty);
      }
      bx=ox+Math.cos(a0+turn)*R;by=oy+Math.sin(a0+turn)*R;
    }
  }

  const cnt=pts.length/4;
  if(cnt<24)return null;
  const out=new Float64Array(cnt*4);
  for(let i=0;i<cnt;i++){
    let px=pts[i*4],py=pts[i*4+1];
    px=px%g.Wm;if(px<0)px+=g.Wm;
    py=py%g.Hm;if(py<0)py+=g.Hm;
    out[i*4]=px;out[i*4+1]=py;out[i*4+2]=pts[i*4+2];out[i*4+3]=pts[i*4+3];
  }
  return {pts:out,nPts:cnt,len:cnt*o.stepM};
}

/* ============================ the routes ============================ */
/* PASS ONE. What every primary run is, and where the strata land, with nothing
   walked yet — the same split as the loom's, and for the same reason: a layer's
   floor is the layer below it plus the tallest thing standing on it, and that
   cannot be known until the gauges have been drawn. Branches are not in here;
   a branch never carries more than its parent, so it never raises the stratum
   it is on and the air gap absorbs the fraction of a radius it rides proud. */
function runSpec(g,p){
  const rng=mulberry32((p.seed|0)*2654435761+7717);
  const pick=a=>a[Math.floor(rng()*a.length)|0];
  const rr=(a,b)=>a+rng()*(b-a);

  const layers=clamp(p.layers|0,1,6);
  const perLayer=clamp(p.bundles|0,1,10);
  const cav=Math.max(0.01,(+p.cavityMm||95)/1000);
  const braceAmt=clamp(+p.braceAmt,0,1);

  const wt=[+p.wTube||0,+p.wCorr||0,+p.wBraid||0,+p.wSpiral||0,+p.wRibbon||0,+p.wLagged||0];
  let tot=0;for(const w of wt)tot+=w;
  if(tot<=0){wt[0]=1;tot=1;}
  const kindOf=()=>{
    let r=rng()*tot;
    for(let i=0;i<6;i++){r-=wt[i];if(r<=0)return i;}
    return 0;
  };

  let qx=rng(),qy=rng();
  const nextQ=()=>{qx=(qx+0.7548776662)%1;qy=(qy+0.5698402910)%1;};

  const spec=[];
  for(let Ly=0;Ly<layers;Ly++){
    const t=layers>1?Ly/(layers-1):1;
    const gMax=lerp((+p.gaugeMaxMm||40)/1000,(+p.gaugeMinMm||8)/1000,t);
    const gMin=lerp((+p.gaugeMinMm||8)/1000*1.6,(+p.gaugeMinMm||8)/1000,t);
    for(let b=0;b<perLayer;b++){
      const k=kindOf(),K=KIND[k];
      const nMax=(k===4)?1:(k===5)?2:clamp(p.groupMax|0,1,8);
      const n=1+Math.floor(rng()*nMax);
      const r=rr(gMin,gMax)*0.5*((k===5)?1.7:1);
      const pitch=r*2*rr(1.10,1.60);
      spec.push({
        layer:Ly,kind:k,n:n,r:r,pitch:pitch,half:(n-1)*0.5*pitch+r,
        mat:MATBY[pick(K.mats)],
        head0:(rng()<0.5?0:HALFPI)+(rng()<0.5?0:Math.PI),
        len:Math.max(g.Wm,g.Hm)*rr(0.8,2.0),
        seed:(rng()*1e9)|0,
        ident:(rng()<clamp(+p.identAmt,0,1)*0.75)?IDENT[Math.floor(rng()*IDENTN)|0]:null,
        sleeve:(k!==5&&rng()<clamp(+p.identAmt,0,1)*0.22)
          ?IDENT[Math.floor(rng()*IDENTN)|0]:null,
        tint:rr(0.86,1.14),
        /* a brace is a post BESIDE the conduits rather than a strap over them,
           so it stands higher than the crown does — one and a half radii above
           the axis, plus what it is proud by */
        fitK:braceAmt>0?1.81:0
      });
    }
  }
  /* a fifth of the crown as air, which is also what carries a branch riding
     fifteen hundredths of a radius over the run it left */
  const ST=L.strata(spec,layers,cav,Math.max(0.0015,cav*0.02),0.20);
  if(ST.scale<1)for(let i=0;i<spec.length;i++){
    const B=spec[i];B.r*=ST.scale;B.pitch*=ST.scale;B.half*=ST.scale;
  }
  return {spec:spec,ST:ST,rng:rng,kindOf:kindOf,rr:rr,
          nextQ:nextQ,at:()=>[qx,qy]};
}

function routes(g,p){
  const stepM=L.stepM(g);
  const layers=clamp(p.layers|0,1,6);
  const braceAmt=clamp(+p.braceAmt,0,1);
  const braceM=Math.max(0.02,(+p.braceMm||120)/1000);
  const branchAmt=clamp(+p.branches,0,1);
  const askedBend=Math.max(0.004,(+p.bendMm||45)/1000);

  const S=runSpec(g,p);
  const spec=S.spec,ST=S.ST,rng=S.rng,rr=S.rr,kindOf=S.kindOf;

  /* THE LATTICE, SNAPPED TO THE TILE. A grid that does not divide the tile
     leaves the runs on one side of the wrap out of step with the runs on the
     other, and on a seamless map that is the first thing the eye finds. A bay
     has no wrap to close and keeps the grid it was given. */
  let grid=Math.max(0.01,(+p.gridMm||62)/1000);
  if(!g.bay)grid=g.Wm/Math.max(1,Math.round(g.Wm/grid));
  /* snapped to the lattice, so two runs a tile apart are on the same lines */
  const snap=(t,span)=>Math.round(t*span/grid)*grid;

  let hMin=1e9;
  for(let i=0;i<spec.length;i++)if(spec[i].half<hMin)hMin=spec[i].half;
  const C=L.claims(g,Math.max(g.mpp*3,hMin*0.85));

  const out=[],BOXES=[];
  /* a second grid holding nothing but enclosures, never cleared between
     layers: a run may pass over a box, two boxes may not share ground */
  const CB=L.claims(g,Math.max(g.mpp*3,hMin*0.85));
  const endless=g.bay?0:clamp(+p.endless,0,1);
  const rngW=mulberry32((p.seed|0)*69621+13);
  const legMin=Math.max(2,Math.round(grid/stepM));

  /* every point of a candidate circuit before one of them is marked: a loop
     cannot back out half way and has to be all or nothing */
  const loopFits=(w,half)=>{
    for(let k=0;k<w.nPts;k++){
      const q=k*4;
      if(!C.clearAt(w.pts[q],w.pts[q+1],-w.pts[q+3],w.pts[q+2],half))return false;
    }
    return true;
  };
  const markAll=(w,rad)=>{
    for(let k=0;k<w.nPts;k++){
      const q=k*4;
      C.span(w.pts[q],w.pts[q+1],-w.pts[q+3],w.pts[q+2],rad);
    }
  };

  /* A BOX HAS TO HAVE ROOM TO EXIST — the same rule as the loom's, and the
     same answer: shorten the run until one fits rather than let it stop at
     nothing, and fall back to a bulkhead grommet only when it cannot. */
  const place=(RT,end,bendR)=>{
    /* HOW SQUARE IS SQUARE ENOUGH, AND WHAT IT IS WORTH PAYING FOR IT.
       The box takes the nearest quarter turn to the run, so the run has to
       arrive near it or the gland sits crooked on the conduit it grips. A
       place further back along the run may be squarer — but every point
       traded for one is a point off the run, and a run cut past a couple of
       its own box lengths stops being a run at all and is dropped. Hunting
       the whole length for the squarest spot cost a third of the bundles in
       the bay, which is a worse picture than a box at eight degrees.

       The trim is worked out without cutting anything — boxOf answers what the
       box WOULD be that many points shorter — so the hunt is BOUNDED: take the
       first clear spot if it is already near-square, otherwise look for a
       better one within a tenth of the run and take the best of those. Whatever is left over is bent out by
       squaring the tail below, which costs no length at all. */
    const maxCut=RT.nPts-28;
    const near=Math.min(maxCut,Math.max(8,Math.round(RT.nPts*0.10)));
    const far=Math.min(maxCut,Math.max(16,Math.round(RT.nPts*0.28)));
    let best=null;
    for(let cut=0;cut<=maxCut;cut+=2){
      const bx=L.boxOf(RT,end,cut);
      if(!bx)continue;
      if(!CB.rectClear(bx.x,bx.y,bx.tx,bx.ty,bx.hl,bx.hw))continue;
      if(!best||bx.skew<best.skew)best=bx;
      /* square enough that squaring the tail will finish it off */
      if(best.skew<0.12)break;
      /* otherwise stop at a tenth of the run — unless nothing found so far
         is even close, in which case a short run with no room to bend its
         own tail is worth a bit more hunting */
      if(cut>=near&&best.skew<0.30)break;
      if(cut>=far)break;
    }
    if(best){
      const cut=best.trim;
      if(cut>0){
        if(end)RT.nPts-=cut;
        else{RT.pts=RT.pts.subarray(cut*4);RT.nPts-=cut;}
        RT.len=RT.nPts*stepM;
      }
      /* and bring the last stretch onto the box's own axis, so the conduit
         goes into the gland straight. That moves the tip, so the box is
         worked out again from where the run actually ends up — and it is
         THAT rectangle which gets marked and painted. */
      L.squareInto(RT,end,bendR,g);
      const fin=L.boxOf(RT,end)||best;
      CB.rect(fin.x,fin.y,fin.tx,fin.ty,fin.hl,fin.hw);
      C.rect(fin.x,fin.y,fin.tx,fin.ty,fin.hl,fin.hw);
      if(end)RT.boxB=fin;else RT.boxA=fin;
      BOXES.push(fin);
      return true;
    }
    return false;
  };

  /* one bundle, given what it is and where it starts */
  function lay(B,z0,start,skip){
    const bendR=Math.max(askedBend,bendFloor(B.half,B.r));
    const seed=start?((rng()*1e9)|0):B.seed;
    const wrng=mulberry32(seed^0x2545f491);
    const len=start?Math.max(g.Wm,g.Hm)*rr(0.8,2.0):B.len;
    const rad=B.half+Math.max(C.cell*0.6,B.r*0.6);
    let w=null,closed=false;

    /* ---- a circuit first, where one is wanted and one will fit ---- */
    if(!start&&B.wantLoop){
      for(let a=0;a<10&&!w;a++){
        const cand=closedLoop(g,{
          grid:grid,bendR:bendR,stepM:stepM,
          primary:(a+(B.seed&1))&1,m:1,
          x0:B.x,y0:B.y,rng:mulberry32((B.seed^0x85ebca6b)+a*7919)
        });
        if(cand&&loopFits(cand,B.half)){w=cand;closed=true;}
      }
    }
    if(!w)w=walk(g,{
      x:start?start.x:B.x, y:start?start.y:B.y,
      head:start?start.head:B.head0,
      firstCorner:!!(start&&start.corner),
      firstDir:start?start.dir:0,
      len:len,bendR:bendR,half:B.half,stepM:stepM,rng:wrng,
      claims:C,rad:rad,skip:skip|0,
      /* legs are whole multiples of the lattice, which is what makes two
         parallel runs line up rather than merely run parallel */
      legSteps:()=>legMin*(1+Math.floor(wrng()*4))
    });
    if(w.nPts<12)return null;
    if(closed)markAll(w,rad);

    /* WHERE IT IS ALLOWED TO STOP. A circuit has no ends. A branch comes out
       of its parent, which is a breakout rather than a termination and needs
       nothing drawn. Everything else ends in a box, or leaves the aperture
       through the frame. */
    const capA=closed?"none":(start?"none":"box");
    const capB=closed?"none":(w.why==="out"?"gland":"box");
    const dive=Math.min(0.05,w.nPts*stepM*0.20);
    const R={
      layer:B.layer,kind:B.kind,n:B.n,r:B.r,pitch:B.pitch,half:B.half,
      mat:B.mat,z0:z0,seed:seed,
      pts:w.pts,nPts:w.nPts,len:w.nPts*stepM,
      closed:closed,capA:capA,capB:capB,
      /* the length it GOT: a run stopped early by something in its way is
         short, and a dive sized off what it asked for can be longer than the
         run, which sinks the whole thing */
      tailA:capA==="gland"?dive:0,
      tailB:capB==="gland"?dive:0,
      ident:B.ident,sleeve:B.sleeve,tint:B.tint,
      /* THE BRACING. Intermittent by definition — a comb every so often, not a
         rail the whole way — and its half-length is what makes it read as a
         bracket a few millimetres thick rather than as a length of channel. */
      fit:braceAmt>0?{
        style:2,pitch:braceM,
        half:Math.max(0.0035,Math.min(0.011,B.r*0.75)),
        proud:B.r*0.26,tie:null
      }:null,
      bendR:bendR
    };
    if(!closed){
      for(let e=0;e<2;e++){
        if((e?R.capB:R.capA)!=="box")continue;
        if(place(R,e,bendR))continue;
        if(e){R.capB="gland";R.tailB=Math.min(0.05,R.len*0.20);}
        else {R.capA="gland";R.tailA=Math.min(0.05,R.len*0.20);}
      }
      if(R.nPts*stepM<Math.max(0.05,R.half*4))return null;
    }
    out.push(R);
    return R;
  }

  for(let Ly=0;Ly<layers;Ly++){
    C.clear();
    /* a junction box is bolted to the plate and is in the way of every layer
       it stands taller than, not only its own */
    for(let k=0;k<BOXES.length;k++){
      const bx=BOXES[k];
      if(bx.top>ST.z[Ly])C.rect(bx.x,bx.y,bx.tx,bx.ty,bx.hl,bx.hw);
    }
    /* the deeper the layer the more likely its runs pass through rather than
       stop: the bottom of a tray carries the trunks and the top carries what
       goes to equipment */
    for(let i=0;i<spec.length;i++)if(spec[i].layer===Ly)
      spec[i].wantLoop=rngW()<endless*(layers>1?1-0.5*(Ly/(layers-1)):1);
    /* CIRCUITS GO DOWN FIRST. A closed circuit is rigid and either fits where
       it is drawn or is not a circuit at all; an open run corners its way out
       of trouble. Laying the open ones first fills the tray with obstacles no
       circuit can get past. */
    const order=[];
    for(let i=0;i<spec.length;i++)if(spec[i].layer===Ly)order.push(i);
    order.sort((a,b)=>(spec[b].wantLoop?1:0)-(spec[a].wantLoop?1:0));
    for(let oi=0;oi<order.length;oi++){
      const i=order[oi];
      const B=spec[i];
      const rad=B.half+Math.max(C.cell*0.6,B.r*0.6);

      /* a start on the lattice that is not already somebody else's */
      let ok=false;
      for(let a=0;a<28&&!ok;a++){
        S.nextQ();
        const q=S.at();
        B.x=snap(q[0],g.Wm);B.y=snap(q[1],g.Hm);
        ok=C.clearAt(B.x,B.y,1,0,rad)&&C.clearAt(B.x,B.y,0,1,rad);
      }
      if(!ok)continue;

      const R=lay(B,ST.z[Ly],null,0);
      if(!R)continue;

      /* ---- and what comes off it ----
         The child takes the parent's heading at the point it leaves, so its
         conduits emerge parallel to the ones it is leaving behind and turn out
         of the group through the fillet. Started square instead, it would be a
         pipe butted against another pipe. */
      if(R.n<2)continue;
      const kids=(rng()<branchAmt)?(1+((rng()<branchAmt*0.45)?1:0)):0;
      for(let c=0;c<kids;c++){
        const at=Math.floor(R.nPts*rr(0.18,0.78));
        const q=at*4;
        const tx=R.pts[q+2],ty=R.pts[q+3];
        const side=rng()<0.5?-1:1;
        const kn=1+Math.floor(rng()*(R.n-1));
        const kHalf=(kn-1)*0.5*R.pitch+R.r;
        /* offset to the side it peels off towards, so it takes the conduits
           on that edge of the group rather than cutting out of the middle */
        const off=side*Math.max(0,R.half-kHalf);
        const kK=kindOf();
        /* A BRANCH LEAVES FROM INSIDE ITS PARENT, which is ground the parent
           has already claimed, so the first stretch of it is exempt from the
           test — a junction is not a collision. It is clear of the parent once
           it has travelled the two half-widths between their centrelines. */
        const kB={layer:Ly,kind:kK,n:kn,r:R.r,pitch:R.pitch,half:kHalf,
                  mat:R.mat,head0:Math.atan2(ty,tx),
                  ident:(rng()<clamp(+p.identAmt,0,1)*0.75)
                    ?IDENT[Math.floor(rng()*IDENTN)|0]:null,
                  sleeve:null,tint:rr(0.86,1.14)};
        lay(kB,ST.z[Ly]+R.r*0.15,{
          x:R.pts[q]+off*-ty, y:R.pts[q+1]+off*tx,
          head:Math.atan2(ty,tx),corner:true,dir:side
        },Math.ceil((R.half+kHalf+C.cell)/stepM));
      }
    }
  }
  out.sort((a,b)=>a.layer-b.layer);
  return out;
}

/* ============================ mode definition ============================ */

Forge.register({
  id:"raceway",
  label:"Raceway",
  group:"Detail",
  threadable:true,
  blurb:"Conduit on a lattice — filleted right angles and braced groups",
  title:'Conduit <em>Raceway</em>',
  tagline:"Lattice · radiused bends · smooth tees · spacer combs",
  actionLabel:"Run the raceway",
  busyLabel:"Running…",
  previewSize:256,
  preview:{gain:3.0,amb:1.15,specK:0.5,skyLo:[0.13,0.15,0.19],skyHi:[0.30,0.34,0.42]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
    {key:"ao",label:"AO"},{key:"emissive",label:"Emissive"},
    {key:"height",label:"Height"},{key:"orm",label:"ORM packed"},
    {key:"opacity",label:"Opacity"}
  ],

  presets:[
    {id:"tray",label:"Cable tray",set:{
      piece:"tile",tileMm:640,cavityMm:90,layers:3,bundles:4,groupMax:6,
      gaugeMinMm:8,gaugeMaxMm:34,gridMm:62,bendMm:48,branches:.5,
      wTube:.5,wCorr:.6,wBraid:.4,wSpiral:1,wRibbon:.2,wLagged:.2,
      braceAmt:1,braceMm:120,identAmt:.55,lamps:.1,
      ribMm:80,ribWMm:16,ribHMm:7,holeMm:30,
      oil:.25,dust:.35,heat:.1,scuff:.3,aoStr:1,
      mCurve:.5,mGrain:.4,mDust:.35,corrMm:14,
      cPlate:"#4c5054",cDeep:"#0b0c0d",cLamp:"#49ff9c"}},

    {id:"manifold",label:"Cooling manifold",set:{
      piece:"tile",tileMm:520,cavityMm:80,layers:3,bundles:3,groupMax:4,
      gaugeMinMm:10,gaugeMaxMm:30,gridMm:52,bendMm:42,branches:.85,
      wTube:1,wCorr:.2,wBraid:.7,wSpiral:.1,wRibbon:0,wLagged:.2,
      braceAmt:1,braceMm:100,identAmt:.4,lamps:0,
      ribMm:70,ribWMm:14,ribHMm:6,holeMm:26,
      oil:.5,dust:.2,heat:.35,scuff:.4,aoStr:1,
      mCurve:.55,mGrain:.35,mDust:.25,corrMm:12,
      cPlate:"#474b4f",cDeep:"#0a0b0c",cLamp:"#5fe0ff"}},

    {id:"backplane",label:"Server backplane",set:{
      piece:"tile",tileMm:400,cavityMm:60,layers:4,bundles:5,groupMax:8,
      gaugeMinMm:5,gaugeMaxMm:16,gridMm:40,bendMm:26,branches:.7,
      wTube:.1,wCorr:.3,wBraid:.2,wSpiral:1,wRibbon:.6,wLagged:0,
      braceAmt:1,braceMm:80,identAmt:.9,lamps:.35,
      ribMm:50,ribWMm:10,ribHMm:4,holeMm:18,
      oil:.05,dust:.25,heat:.05,scuff:.15,aoStr:1,
      mCurve:.45,mGrain:.45,mDust:.3,corrMm:8,
      cPlate:"#3a3d41",cDeep:"#0a0a0b",cLamp:"#49ff9c"}},

    {id:"bulkhead",label:"Bulkhead run",set:{
      piece:"tile",tileMm:820,cavityMm:110,layers:3,bundles:3,groupMax:5,
      gaugeMinMm:12,gaugeMaxMm:56,gridMm:82,bendMm:70,branches:.35,
      wTube:.7,wCorr:1,wBraid:.3,wSpiral:.4,wRibbon:.1,wLagged:.7,
      braceAmt:1,braceMm:180,identAmt:.35,lamps:.15,
      ribMm:110,ribWMm:22,ribHMm:9,holeMm:44,
      oil:.4,dust:.45,heat:.25,scuff:.35,aoStr:1.05,
      mCurve:.5,mGrain:.4,mDust:.45,corrMm:18,
      cPlate:"#43474b",cDeep:"#090a0b",cLamp:"#ffb648"}},

    {id:"spine",label:"Reactor spine",set:{
      piece:"tile",tileMm:700,cavityMm:140,layers:5,bundles:4,groupMax:6,
      gaugeMinMm:10,gaugeMaxMm:60,gridMm:70,bendMm:60,branches:.6,
      wTube:.5,wCorr:.9,wBraid:.5,wSpiral:.4,wRibbon:.1,wLagged:1,
      braceAmt:1,braceMm:140,identAmt:.4,lamps:.6,
      ribMm:100,ribWMm:20,ribHMm:9,holeMm:40,
      oil:.3,dust:.25,heat:.7,scuff:.3,aoStr:1.1,
      mCurve:.55,mGrain:.4,mDust:.3,corrMm:16,
      cPlate:"#3f4348",cDeep:"#08090a",cLamp:"#5fe0ff"}},

    {id:"panel",label:"Braced access panel",set:{
      piece:"bay",bayWmm:560,bayHmm:400,frameMm:26,cornerMm:16,fasteners:true,
      cavityMm:95,layers:3,bundles:4,groupMax:6,
      gaugeMinMm:8,gaugeMaxMm:36,gridMm:56,bendMm:44,branches:.75,
      wTube:.6,wCorr:.7,wBraid:.5,wSpiral:.8,wRibbon:.2,wLagged:.3,
      braceAmt:1,braceMm:110,identAmt:.6,lamps:.25,
      ribMm:74,ribWMm:15,ribHMm:7,holeMm:28,
      oil:.3,dust:.35,heat:.2,scuff:.3,aoStr:1,
      mCurve:.5,mGrain:.4,mDust:.35,corrMm:13,
      cPlate:"#4c5054",cDeep:"#0b0c0d",cFrame:"#7d838a",cLamp:"#49ff9c"}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"piece",type:"select",label:"Draw",value:"tile",options:[
        ["tile","Seamless field"],["bay","One framed bay"]]},
      {id:"size",type:"select",label:"Resolution",value:1024,numeric:true,
       options:Forge.sizes("square",2048)},
      {id:"tileMm",label:"Tile covers",unit:"mm",min:200,max:2000,step:20,value:640,need:"tile"},
      {id:"bayWmm",label:"Bay width",unit:"mm",min:150,max:1600,step:10,value:560,need:"bay"},
      {id:"bayHmm",label:"Bay height",unit:"mm",min:150,max:1600,step:10,value:400,need:"bay"},
      {id:"frameMm",label:"Frame width",unit:"mm",min:6,max:80,step:1,value:26,need:"bay"},
      {id:"cornerMm",label:"Corner radius",unit:"mm",min:0,max:200,step:2,value:16,need:"bay"},
      {type:"checks",need:"bay",items:[
        {id:"fasteners",label:"Fasteners round the frame",value:true}]},
      {type:"readout"},
      {id:"seed",type:"seed",label:"Seed",value:7204},
      {type:"note",html:"Everything runs along one of two axes and every corner is a "+
        "<b>radiused bend</b>, not a mitre — conduit does not fold. Legs are whole "+
        "multiples of the lattice, which is what makes parallel runs line up rather "+
        "than merely run parallel."}
    ]},

    {title:"The run",open:true,rows:[
      {id:"cavityMm",label:"Cavity depth",unit:"mm",min:20,max:260,step:5,value:90},
      {id:"layers",label:"Layers",min:1,max:6,step:1,value:3},
      {id:"endless",label:"Runs with no ends",min:0,max:1,step:0.05,value:0.7,need:"tile"},
      {id:"bundles",label:"Runs per layer",min:1,max:10,step:1,value:4},
      {id:"groupMax",label:"Conduits per group",min:1,max:8,step:1,value:6},
      {id:"gaugeMinMm",label:"Finest gauge",unit:"mm",min:3,max:40,step:1,value:8},
      {id:"gaugeMaxMm",label:"Fattest gauge",unit:"mm",min:8,max:110,step:2,value:34},
      {id:"gridMm",label:"Lattice",unit:"mm",min:10,max:300,step:2,value:62},
      {id:"bendMm",label:"Bend radius",unit:"mm",min:4,max:200,step:2,value:48},
      {id:"branches",label:"Branches",min:0,max:1,step:.05,value:.5},
      {type:"note",html:"The <b>bend radius</b> is a floor, not a setting: below about the "+
        "group's half-width plus two conduit radii the innermost conduit turns inside out "+
        "in the corner. The readout says what it actually used."}
    ]},

    {title:"Bracing",open:true,rows:[
      {id:"braceAmt",label:"Bracing",min:0,max:1,step:.05,value:1},
      {id:"braceMm",label:"Brace spacing",unit:"mm",min:25,max:400,step:5,value:120},
      {id:"identAmt",label:"Ident bands and sleeving",min:0,max:1,step:.05,value:.55},
      {id:"lamps",label:"Indicator lamps",min:0,max:1,step:.05,value:.1},
      {type:"colors",label:"Lamp",items:[{id:"cLamp",value:"#49ff9c"}]},
      {type:"note",html:"A brace is a <b>spacer comb</b>, not a strap: it stands between "+
        "the conduits and posts up at each edge of the group, so it holds them at their "+
        "spacing without hiding any of them."}
    ]},

    {title:"What is in it",rows:[
      {id:"wTube",label:"Rigid tube",min:0,max:1,step:.05,value:.5},
      {id:"wCorr",label:"Corrugated flex",min:0,max:1,step:.05,value:.6},
      {id:"wBraid",label:"Braided hose",min:0,max:1,step:.05,value:.4},
      {id:"wSpiral",label:"Spiral wrap",min:0,max:1,step:.05,value:1},
      {id:"wRibbon",label:"Flat ribbon",min:0,max:1,step:.05,value:.2},
      {id:"wLagged",label:"Lagged pipe",min:0,max:1,step:.05,value:.2},
      {id:"corrMm",label:"Corrugation pitch",unit:"mm",min:4,max:30,step:1,value:14}
    ]},

    {title:"Backplane",rows:[
      {id:"ribMm",label:"Rib spacing",unit:"mm",min:30,max:220,step:2,value:80},
      {id:"ribWMm",label:"Rib width",unit:"mm",min:4,max:50,step:1,value:16},
      {id:"ribHMm",label:"Rib height",unit:"mm",min:0,max:24,step:1,value:7},
      {id:"holeMm",label:"Lightening holes",unit:"mm",min:0,max:120,step:2,value:30},
      {type:"colors",label:"Plate · down the holes",items:[
        {id:"cPlate",value:"#4c5054"},{id:"cDeep",value:"#0b0c0d"}]},
      {type:"colors",label:"Frame",need:"bay",items:[{id:"cFrame",value:"#7d838a"}]}
    ]},

    {title:"Wear",rows:[
      {id:"oil",label:"Oil and streaks",min:0,max:1,step:.05,value:.25},
      {id:"dust",label:"Dust",min:0,max:1,step:.05,value:.35},
      {id:"heat",label:"Heat tint",min:0,max:1,step:.05,value:.1},
      {id:"scuff",label:"Scuffing",min:0,max:1,step:.05,value:.3}
    ]},

    {title:"Micro detail",rows:[
      {id:"mCurve",label:"Edge wear and crack dirt",min:0,max:1,step:.05,value:.5},
      {id:"mGrain",label:"Surface grain",min:0,max:1,step:.05,value:.4},
      {id:"mDust",label:"Dust on upward faces",min:0,max:1,step:.05,value:.35}
    ]},

    {title:"Maps",rows:[
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1.5,step:.05,value:1},
      {id:"normalStr",label:"Normal strength",min:.2,max:3,step:.1,value:1},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  needs:function(p){return [isBay(p)?"bay":"tile"];},

  seamless:function(p){return !isBay(p);},
  backdrops:function(p){return isBay(p);},

  size:function(p){const g=geom(p);return {w:g.TW,h:g.TH};},
  build:function(p,io){return L.build(p,io,{routes:routes});},
  plan:function(p){
    const g=geom(p),S=runSpec(g,p);
    /* the strata, in metres: where each layer's underside sits and how tall
       the tallest thing standing on it is. Reported because a layer that does
       not clear the one under it is a bug that ought to be checkable from
       outside, and because nobody can see it from the picture alone. */
    return {w:g.Wm,h:g.Hm,cutout:g.bay,
            strata:Array.from(S.ST.z),crowns:Array.from(S.ST.h),
            stackM:S.ST.top,gaugeScale:S.ST.scale};
  },

  tileTag:function(p){return isBay(p)?"":"Tiles ↔ and ↕";},

  readout:function(p){
    const g=geom(p);
    const runs=clamp(p.layers|0,1,6)*clamp(p.bundles|0,1,10);
    /* the widest group this run could produce, and what the bend radius has to
       be for it — the number people actually want back from this control */
    const nMax=clamp(p.groupMax|0,1,8);
    const rMax=(+p.gaugeMaxMm||34)/2000;
    const halfMax=(nMax-1)*0.5*(rMax*2*1.35)+rMax;
    const floorMm=Math.round(bendFloor(halfMax,rMax)*1000);
    const asked=Math.round(+p.bendMm||48);
    const ST=runSpec(g,p).ST;
    const floors=Array.from(ST.z,z=>Math.round(z*1000)).join(", ");
    const st="<br>strata at <b>"+floors+" mm</b>, "+
      (ST.top*1000).toFixed(0)+" mm deep"+
      (ST.scale<0.995
        ?" — gauges cut to <b>"+Math.round(ST.scale*100)+"%</b> to fit"
        :"");
    let grid=Math.max(0.01,(+p.gridMm||62)/1000);
    if(!g.bay)grid=g.Wm/Math.max(1,Math.round(g.Wm/grid));
    return "<b>"+Math.round(g.Wm*1000)+" × "+Math.round(g.Hm*1000)+" mm</b> · "+
      g.TW+" × "+g.TH+" px<br>"+
      "<b>"+(g.mpp*1000).toFixed(2)+" mm per texel</b> · lattice snapped to "+
      Math.round(grid*1000)+" mm<br>"+
      runs+" runs asked for over "+clamp(p.layers|0,1,6)+" layers, up to "+nMax+" conduits each"+st+"<br>"+
      "bends <b>"+asked+" mm</b>"+(floorMm>asked
        ?(", opened to "+floorMm+" on the widest group — under that its inner "+
          "conduit turns inside out in the corner")
        :"")+
      " · braced every "+Math.round(+p.braceMm||120)+" mm";
  },

  readme:function(p,info){
    const g=geom(p);
    const bay=isBay(p);
    /* what the build actually turned out to be, rather than what was asked
       for: whether a run closed and whether its box had room are decided while
       it is being laid, so this is the only place the numbers exist */
    const c=info.census;
    const ends=c?[
"",
"HOW IT TURNED OUT",
c.closed+" of "+c.bundles+" runs have no ends at all — they leave one edge of the",
"tile, arrive at the other and come back to where they started, so there is",
"nothing to terminate. The rest do end, and end at something: "+c.boxes+" junction",
"box"+(c.boxes===1?"":"es")+" bolted to the backplane and entered square through a gland, and "+c.glands,
"bulkhead grommet"+(c.glands===1?"":"s")+". Nothing stops in mid-air."
]:[];
    return [
"TEXTURE FORGE — conduit raceway",
"",
(bay?"One framed access bay, ":"A seamless field, ")+
  Math.round(g.Wm*1000)+" × "+Math.round(g.Hm*1000)+" mm, at "+info.W+" × "+info.H+" px",
"("+(g.mpp*1000).toFixed(2)+" mm per texel).",
"",
bay?"CUT-OUT. opacity.png is the silhouette of the bay. Use it as the alpha of\nthe base colour, or as an opacity/clip map, and the surface it is dropped\nonto shows through around it."
   :"SEAMLESS. Tiles in both axes. The lattice is snapped so a whole number of\ncells fits the tile, which is what keeps the runs on one side of the wrap in\nstep with the runs on the other.",
"",
"WHAT IS IN IT",
clamp(p.layers|0,1,6)+" layers of "+clamp(p.bundles|0,1,10)+" runs, plus whatever branched off them.",
"Everything is axis-aligned and every corner is a quarter-circle of "+
  Math.round(+p.bendMm||48)+" mm",
"or whatever larger radius the widest group needed. Groups are held every "+
  Math.round(+p.braceMm||120)+" mm",
"by a spacer comb: a bracket standing BETWEEN the conduits, posting up at each",
"edge of the group, so it holds them apart without hiding any of them.",
"",
"Gauges run "+Math.round(+p.gaugeMinMm||8)+"–"+Math.round(+p.gaugeMaxMm||34)+
  " mm in a cavity "+Math.round(+p.cavityMm||90)+" mm deep.",
"",
"FILES",
"basecolor.png  sRGB.",
"normal.png     Tangent space, "+info.normalNote+".",
"roughness.png  Linear grey.",
"metallic.png   Linear grey. Braid, tube, brackets and the backplane are metal;",
"               rubber, PVC, PTFE, lagging and ident sleeving are not.",
"ao.png         Linear grey. Carries the depth of the cavity as well as the",
"               local occlusion — see below.",
"emissive.png   Indicator lamps only. Black where there are none.",
"height.png     Linear grey, remapped over the range below.",
"orm.png        R=AO, G=roughness, B=metallic.",
bay?"opacity.png    The bay silhouette.":null,
"unlit.png      The whole thing with one lighting solution already in it.",
"",
"HEIGHT",
"height.png is normalised over "+info.hMin.toFixed(4)+" … "+info.hMax.toFixed(4)+" m,",
"a range of "+((info.hMax-info.hMin)*1000).toFixed(1)+" mm. Displace by that to get the real",
"depth; height16.png is the same field at 16 bits, which is what you want here —",
"an 8-bit height over a hundred millimetres of cavity quantises the finest",
"conduits into steps.",
"",
"THE AO IS DOING TWO JOBS",
"Local occlusion, the way every mode here does it, AND a depth term: how far",
"into the cavity a texel sits, independent of its neighbours. A blur cannot",
"see that — a conduit three layers down is dark because it is three layers",
"down, not because the texel beside it is higher — and without it the strata",
"all read at one brightness.",
"",
"Seed "+(p.seed|0)+"."
    ].concat(ends).filter(x=>x!==null).join("\n");
  }
});

})();
