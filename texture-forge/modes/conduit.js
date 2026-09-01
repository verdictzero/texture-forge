/* =====================================================================
   MODE: conduit — the loom behind an access panel
   =====================================================================
   Undo a row of quarter-turn fasteners, lift the panel off an engine
   nacelle or an equipment bay, and what is behind it is not a thing. It
   is STRATA, and the strata are the whole subject:

     the backplane   a machined casting or a ribbed skin with lightening
                     holes, in shadow, mostly hidden
     the deep runs   the fat items that went in first and will come out
                     last — lagged bleed-air pipe, flexible duct,
                     coolant lines
     the harnesses   groups of small conduits laid parallel and routed
                     together, held at a fixed pitch by clamps
     the near work   the things that were meant to be reached: junction
                     blocks, connectors on brackets, a bonding strap

   A GROUP, NOT A PIPE. Every route here carries a BUNDLE — n conduits
   at a fixed pitch, riding one path. Conduit k sits at offset
   (k−(n−1)/2)·pitch along the path normal, so the whole ribbon snakes
   as one, and on a bend the inner conduits take a tighter radius than
   the outer ones. That difference is most of what tells a loom from
   some pipes that happen to be near each other.

   ROUTED BY TURN RATE, NOT BY WAYPOINTS — and that is the whole of what
   this file contributes. A path is integrated: a heading, plus a
   smoothly varying turn, with the turn CLAMPED so the curvature never
   exceeds one over the minimum bend radius. That is a real constraint —
   conduit has a minimum bend radius, and a loom that violates it looks
   wrong before you can say why — and it buys the rasteriser its
   correctness for free: perpendicular distance to the local tangent is
   only the true distance to the centreline while the bend is gentle
   relative to the bundle's own width, which is exactly what the clamp
   guarantees.

   Occasionally a route takes a CORNER: it spends a stretch turning at
   the maximum rate one way, which is what a loom does when it reaches
   the end of a bay and has to go somewhere else. Without those it is
   all lazy meander and reads as spaghetti rather than as installed work.

   Everything after the routing — the materials, the cross-sections, the
   backplane, the framed bay, the shading and the occlusion — is in
   modes/lib/loom.js, shared with the raceway next door, which puts the
   same bundles down a lattice of filleted right angles instead. Read
   that file for the stamp and for the parameter-name contract this one
   is written against.

   Two pieces off the one generator. TILE is a seamless field — an
   endless equipment bay, a hull interior. BAY is one framed opening
   with a lip and a cut-out silhouette, which is the literal answer to
   "what you see when you open a panel": you drop it onto a hull and the
   hull shows through around it.

   CAPPED AT 2048. The stamp carries an extra word a texel, and the
   subject is a panel a few hundred millimetres across — 2048 is already
   better than three texels to the millimetre.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,mulberry32=Forge.mulberry32;
const L=window.ForgeLoom;
const KIND=L.KIND,MATBY=L.MATBY,IDENT=L.IDENT,IDENTN=IDENT.length;
const isBay=L.isBay,geom=L.geom;

/* ============================ the routes ============================
   Integrate a heading; hand the library the polyline that comes out.

   The turn is a smooth noise, clamped to the minimum bend radius, with an
   occasional stretch spent turning at the limit — which is the corner. The
   position is wrapped into the tile as it goes rather than at the texel index
   later, because the tangent is carried alongside it and so the wrap costs
   nothing; doing it the other way means a modulo on a non-integer double,
   several million times a build.

   IT HAPPENS IN TWO PASSES. What every bundle IS comes first, for all layers,
   because where a layer sits depends on the tallest thing standing on the
   layer below it and that is not known until the gauges have been drawn.
   Where each bundle GOES comes second, a layer at a time, with a claims grid
   cleared between layers so no two runs in one layer walk through each other.

   Pass one is also what the readout reports, which is why it is its own
   function: the same generator stream either way, so the strata it quotes are
   the strata the build makes. */
function bundleSpec(g,p){
  const rng=mulberry32((p.seed|0)*2246822519+1013);
  const pick=a=>a[Math.floor(rng()*a.length)|0];
  const rr=(a,b)=>a+rng()*(b-a);
  const stepM=L.stepM(g);

  const layers=clamp(p.layers|0,1,6);
  const perLayer=clamp(p.bundles|0,1,10);
  const cav=Math.max(0.01,(+p.cavityMm||95)/1000);
  const wander=clamp(+p.wander,0,1);
  const axis=clamp(+p.axis,0,1);            // 0 = every heading, 1 = strictly along one
  const clampAmt=clamp(+p.clampAmt,0,1);
  const tieAmt=clamp(+p.tieAmt,0,1);

  /* the six kind weights, normalised; a mode with every weight at zero would
     otherwise pick nothing and draw an empty bay */
  const wt=[+p.wTube||0,+p.wCorr||0,+p.wBraid||0,+p.wSpiral||0,+p.wRibbon||0,+p.wLagged||0];
  let tot=0;for(const w of wt)tot+=w;
  if(tot<=0){wt[0]=1;tot=1;}
  const kindOf=()=>{
    let r=rng()*tot;
    for(let i=0;i<6;i++){r-=wt[i];if(r<=0)return i;}
    return 0;
  };

  /* Start points off a low-discrepancy sequence rather than straight out of
     the generator: twelve uniform random points on a bay leave a third of it
     empty and put three on top of each other, every time. */
  let qx=rng(),qy=rng();
  const nextQ=()=>{qx=(qx+0.7548776662)%1;qy=(qy+0.5698402910)%1;};

  /* ---------------- PASS ONE: what each bundle IS ----------------
     Layer 0 is deepest. Its conduits are the fat ones — the things that went in
     first — and each layer above is finer and sits proud of the one below, so
     the strata read as an order of assembly rather than as a random pile.

     Every draw off the generator happens here, before anything is routed,
     because the stack below needs to know how tall the tallest thing in each
     layer is in order to say where the layer above it starts — and it has to
     be allowed to scale all of them if the answer does not fit the cavity. */
  const spec=[];
  for(let Ly=0;Ly<layers;Ly++){
    const t=layers>1?Ly/(layers-1):1;
    const gMax=lerp((+p.gaugeMaxMm||46)/1000,(+p.gaugeMinMm||9)/1000,t);
    const gMin=lerp((+p.gaugeMinMm||9)/1000*1.6,(+p.gaugeMinMm||9)/1000,t);

    for(let b=0;b<perLayer;b++){
      const k=kindOf();
      const K=KIND[k];
      /* a ribbon is one flat thing, never a group of them; a lagged duct is
         fat and travels alone or in pairs */
      const nMax=(k===4)?1:(k===5)?2:clamp(p.groupMax|0,1,8);
      const n=1+Math.floor(rng()*nMax);
      const r=rr(gMin,gMax)*0.5*((k===5)?1.7:1);
      /* pitch: touching, to a little over a diameter apart. Below 2r they would
         intersect, which on a Z-test reads as one fat lumpy conduit. */
      const pitch=r*2*rr(1.04,1.55);

      /* INTERPOLATE THE DEVIATION, NOT THE ANGLE. Blending a uniform heading
         towards an axis angle looks right and is not: at half strength it is
         half of a number that runs to 2π, so every route comes out inside the
         first three radians and the whole loom lies one way. Pick the
         deviation FROM the axis instead and scale that, and the two ends mean
         what they say — free at nought, dressed to the axis at one. */
      const base=(rng()<0.5?0:Math.PI*0.5)+(rng()<0.5?0:Math.PI);

      spec.push({
        layer:Ly,kind:k,n:n,r:r,pitch:pitch,half:(n-1)*0.5*pitch+r,
        mat:MATBY[pick(K.mats)],
        head0:base+(rng()*2-1)*Math.PI*(1-axis)+rr(-0.28,0.28)*axis,
        /* HOW MUCH IS TOO MUCH. Long enough to cross the tile and come back,
           and no longer: past that every layer is buried by the one over it,
           the backplane never shows, and the strata — which are the subject —
           stop reading at all. */
        len:Math.max(g.Wm,g.Hm)*rr(0.7,1.8),
        seed:(rng()*1e9)|0,
        w:wander*rr(0.5,1.35),
        clampM:rr(0.19,0.45),
        ident:(rng()<clamp(+p.identAmt,0,1)*0.75)?IDENT[Math.floor(rng()*IDENTN)|0]:null,
        /* WHOLE-LENGTH SLEEVING, not just bands. Some runs are colour-coded end
           to end, and without a few of them a bay of forty conduits is forty
           greys however carefully each one is shaded. */
        sleeve:(k!==5&&rng()<clamp(+p.identAmt,0,1)*0.22)
          ?IDENT[Math.floor(rng()*IDENTN)|0]:null,
        tint:rr(0.86,1.14),
        /* a cushion clamp stands a third of a radius proud of the crown, so it
           is that much of the layer's headroom */
        fitK:clampAmt>0?1.34:0
      });
    }
  }

  /* ---------------- THE STACK ---------------- */
  const ST=L.strata(spec,layers,cav,Math.max(0.0015,cav*0.02),0.14);
  if(ST.scale<1)for(let i=0;i<spec.length;i++){
    const B=spec[i];B.r*=ST.scale;B.pitch*=ST.scale;B.half*=ST.scale;
  }
  return {spec:spec,ST:ST,rng:rng,nextQ:nextQ,at:()=>[qx,qy]};
}

function routes(g,p){
  const layers=clamp(p.layers|0,1,6);
  const clampAmt=clamp(+p.clampAmt,0,1);
  const tieAmt=clamp(+p.tieAmt,0,1);
  const stepM=L.stepM(g);
  const B1=bundleSpec(g,p);
  const spec=B1.spec,ST=B1.ST,nextQ=B1.nextQ;

  /* ---------------- PASS TWO: where each one GOES ----------------
     A layer at a time, and each layer starts with the ground clear: a run may
     cross anything below it and nothing beside it. */
  let hMin=1e9;
  for(let i=0;i<spec.length;i++)if(spec[i].half<hMin)hMin=spec[i].half;
  const C=L.claims(g,Math.max(g.mpp*3,hMin*0.85));

  const out=[],BOXES=[];
  /* a second grid holding nothing but enclosures, never cleared between
     layers: a run may pass over a box, two boxes may not share ground */
  const CB=L.claims(g,Math.max(g.mpp*3,hMin*0.85));
  const endless=g.bay?0:clamp(+p.endless,0,1);
  const axis=clamp(+p.axis,0,1);
  const rngW=mulberry32((p.seed|0)*40503+17);

  /* every point of a candidate loop, before a single one of them is marked:
     a closed run cannot back out half way and has to be all or nothing */
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

  for(let Ly=0;Ly<layers;Ly++){
    C.clear();
    /* A JUNCTION BOX IS BOLTED TO THE PLATE, so it is in the way of every
       layer it stands taller than, not only the one whose run it terminates.
       The layers are laid deepest first, so re-marking the boxes already
       placed is all it takes for the layer above to route around them. */
    for(let k=0;k<BOXES.length;k++){
      const bx=BOXES[k];
      if(bx.top>ST.z[Ly])C.rect(bx.x,bx.y,bx.tx,bx.ty,bx.hl,bx.hw);
    }
    /* who is to have no ends, decided before anything is laid. The deeper a
       layer is the more likely that is: the bottom of a bay carries the trunks,
       which pass through on their way somewhere else, and what goes to a box is
       the accessible stuff near the panel line — which is also what keeps the
       boxes from being buried under four layers of loom. */
    for(let i=0;i<spec.length;i++)if(spec[i].layer===Ly)
      spec[i].wantLoop=rngW()<endless*(layers>1?1-0.5*(Ly/(layers-1)):1);
    /* CLOSED RUNS GO DOWN FIRST. A loop is rigid — it cannot steer round
       anything, so it either fits where it is drawn or it is not a loop at all
       — while an open run dodges for a living. Laying the open ones first fills
       the bay with obstacles no loop can get past, and most of what was asked
       to be endless ends up terminated instead. */
    const order=[];
    for(let i=0;i<spec.length;i++)if(spec[i].layer===Ly)order.push(i);
    order.sort((a,b)=>(spec[b].wantLoop?1:0)-(spec[a].wantLoop?1:0));
    for(let oi=0;oi<order.length;oi++){
      const i=order[oi];
      const B=spec[i];
      const gapM=Math.max(C.cell*0.6,B.r*0.6);
      const rad=B.half+gapM;
      /* THE BEND CLAMP. Three bundle half-widths is about the tightest a loom
         is dressed to, and it is also comfortably inside the "gentle next to
         its own width" the stamp needs. */
      const minR=Math.max(B.half*3.0,B.r*6);

      let walk=null,closed=false;
      /* ---- first, if it is to have no ends, try to give it none ---- */
      if(B.wantLoop){
        for(let a=0;a<12&&!walk;a++){
          nextQ();
          const q=B1.at();
          const set=(rngW()<0.30+0.62*axis)?WIND_AXIAL:WIND_FREE;
          const wd=set[Math.floor(rngW()*set.length)|0];
          const cand=closedWalk(g,{
            m:wd[0],n:wd[1],x0:q[0]*g.Wm,y0:q[1]*g.Hm,
            minR:minR,stepM:stepM,
            /* later attempts are straighter: a gentle loop fits through a gap
               a wandering one cannot, and by the tenth try a gap is all that
               is left */
            amp:(0.05+B.w*0.24)/(1+a*0.22),
            rng:mulberry32((B.seed^0x9e3779b9)+a*7919)
          });
          if(cand.nPts>=16&&loopFits(cand,B.half)){walk=cand;closed=true;}
        }
      }

      /* ---- otherwise it starts somewhere and ends at a box ---- */
      if(!walk){
        /* somewhere to start that is not already somebody else's. The sequence
           is the same one as before, just consulted until it offers open ground
           rather than taken at its first word. */
        let sx=0,sy=0,ok=false;
        for(let a=0;a<28&&!ok;a++){
          nextQ();
          const q=B1.at();
          sx=q[0]*g.Wm;sy=q[1]*g.Hm;
          ok=C.clearAt(sx,sy,1,0,rad)&&C.clearAt(sx,sy,0,1,rad);
        }
        if(!ok)continue;
        walk=integrate(g,{
          x:sx,y:sy,head:B.head0,len:B.len,minR:minR,half:B.half,
          wander:B.w,seed:B.seed,stepM:stepM,rng:mulberry32(B.seed^0x5bf03635),
          claims:C,rad:rad
        });
      }
      if(walk.nPts<8)continue;
      if(closed)markAll(walk,rad);

      /* WHAT IS STANDING AT EACH END. A closed run has no ends. An open one
         came from a box, and goes to a box unless it left the aperture, in
         which case it went through the frame and the dive is the grommet. */
      const capA=closed?"none":"box";
      const capB=closed?"none":(walk.why==="out"?"gland":"box");
      const dive=Math.min(0.05,walk.nPts*stepM*0.22);

      const RT={
        layer:Ly,kind:B.kind,n:B.n,r:B.r,pitch:B.pitch,half:B.half,mat:B.mat,
        z0:ST.z[Ly],seed:B.seed,
        pts:walk.pts,nPts:walk.nPts,len:walk.nPts*stepM,
        closed:closed,capA:capA,capB:capB,
        /* THE LENGTH IT GOT, not the length it asked for. A run that stopped
           early because something was in the way is short, and a dive sized off
           what it meant to be can be longer than the run itself — which sinks
           the whole thing and leaves a smear where a conduit was. */
        tailA:capA==="gland"?dive:0,
        tailB:capB==="gland"?dive:0,
        ident:B.ident,sleeve:B.sleeve,tint:B.tint,
        /* HOW OFTEN A LOOM IS ACTUALLY CLAMPED DOWN. A P-clamp every 200 to
           450 mm is what the trade does. Every 50 to 130, which is the instinct
           because it fills the picture, chops each bundle into a chain of short
           capsules and every run in the bay reads as a segmented worm. */
        fit:clampAmt>0?{
          style:1,pitch:B.clampM,
          half:Math.min(0.008,B.r*0.7),proud:B.r*0.34,
          tie:(tieAmt>0)?{pitch:B.clampM*0.34,
                          half:Math.max(0.0008,Math.min(0.0022,B.r*0.14)),
                          proud:B.r*0.13}:null
        }:null
      };

      /* ---- and the thing it stops at ----
         A BOX HAS TO HAVE ROOM TO EXIST. Where one will not fit, the run is
         SHORTENED until it does rather than being left to stop at nothing:
         the cable simply does not come as far, which is what would have
         happened on the bench. Only when it cannot be shortened far enough
         does the end fall back to a bulkhead grommet — a real penetration, not
         a fade, and the one honest way for a run to leave without a box. */
      const place=end=>{
        /* HOW SQUARE IS SQUARE ENOUGH, AND WHAT IT IS WORTH PAYING FOR IT.
           The box takes the nearest quarter turn to the run, so the run has to
           arrive near it or the gland sits crooked on the conduit it grips. A
           place further back along the run may be squarer — but every point
           traded for one is a point off the run, and a run cut past a couple of
           its own box lengths stops being a run at all and is dropped. Hunting
           the whole length for the squarest spot cost a third of the bundles in
           the bay, which is a worse picture than a box at eight degrees.

           The trim is worked out without cutting anything — boxOf answers what
           the box WOULD be that many points shorter — so the hunt is BOUNDED:
           take the first clear spot if it is already near-square, otherwise look
           for a better one within a tenth of the run and take the best of those. Whatever is left over is bent out by
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
          L.squareInto(RT,end,minR,g);
          const fin=L.boxOf(RT,end)||best;
          CB.rect(fin.x,fin.y,fin.tx,fin.ty,fin.hl,fin.hw);
          C.rect(fin.x,fin.y,fin.tx,fin.ty,fin.hl,fin.hw);
          if(end)RT.boxB=fin;else RT.boxA=fin;
          BOXES.push(fin);
          return true;
        }
        return false;
      };
      if(!closed){
        for(let e=0;e<2;e++){
          if((e?RT.capB:RT.capA)!=="box")continue;
          if(place(e))continue;
          if(e)  {RT.capB="gland";RT.tailB=Math.min(0.05,RT.len*0.22);}
          else   {RT.capA="gland";RT.tailA=Math.min(0.05,RT.len*0.22);}
        }
        /* a run shorter than a couple of its own boxes is not a run */
        if(RT.nPts*stepM<Math.max(0.05,RT.half*4))continue;
      }
      out.push(RT);
    }
  }
  /* deepest first: the Z-test does the real work, but painting in this order
     means a tie between two bundles at exactly the same height goes to the
     nearer one, which is what an eye expects */
  out.sort((a,b)=>a.layer-b.layer);
  return out;
}

/* One route's polyline. Positions are wrapped into the tile as they are laid
   down; the tangent goes alongside them, because differencing the positions
   afterwards would read the wrap as a jump a whole tile wide.

   A ROUTE THAT CANNOT GO STRAIGHT GOES ROUND. The claims grid is consulted a
   lookahead ahead — far enough that a turn at the bend clamp can still get out
   of the way — and while the ground there is taken the whole turn budget for
   the step goes on avoidance instead of on the noise. The side it commits to
   is remembered until it is clear, because deciding afresh every step with two
   sides open makes it shiver down the middle of the gap rather than take it.
   When both sides are shut the run has arrived somewhere it cannot leave, and
   it ends there — which the tail sinks into the layer underneath, so it reads
   as a run disappearing behind another rather than as one stopping dead. */
function integrate(g,o){
  const stepM=o.stepM,maxTurn=stepM/o.minR,rng=o.rng;
  const bay=g.bay;
  const cap=Math.min(200000,Math.round(o.len/stepM));
  const pts=new Float64Array(cap*4);
  const C=o.claims||null;
  const rad=o.rad||o.half;
  const LA=Math.max(o.minR*0.55,o.half*2.5);
  const trail=C?C.trail(rad,Math.max(2,Math.ceil((LA+rad*2.2)/stepM))):null;
  let x=o.x,y=o.y,head=o.head,n=0,s=0;
  let corner=0,cornerDir=1,dodge=0;
  /* WHY IT STOPPED decides what has to be standing there. Out of a bay is a
     bulkhead gland in the frame; anything else is a junction box. */
  let why="len";
  for(let i=0;i<cap;i++){
    let dodged=false;
    if(C){
      const ax=Math.cos(head),ay=Math.sin(head);
      /* WHERE THE BUNDLE IS STANDING, not where it is looking. The lookahead is
         a ring at one distance and says nothing about anything nearer than
         that, so a route whose dodge is not working converges anyway and ends
         up lying on its neighbour. Asking whether its own width is clear right
         now costs one more test and is the only one that cannot be fooled: a
         route that is already too close has nowhere to be, and stops. It is
         deliberately not predictive — a route mid-dodge is often inside the
         ring and about to be out of it, and ending those would cut the loom to
         a third of the run it should have. */
      if(i>=(o.skip|0)&&!C.clearAt(x,y,-ay,ax,o.half*0.92)){why="blocked";break;}
      if(!C.clearAt(x+ax*LA,y+ay*LA,-ay,ax,o.half)){
        const hl=head-0.9,hr=head+0.9;
        const cl=Math.cos(hl),sl=Math.sin(hl),cr=Math.cos(hr),sr=Math.sin(hr);
        const okL=C.clearAt(x+cl*LA,y+sl*LA,-sl,cl,o.half);
        const okR=C.clearAt(x+cr*LA,y+sr*LA,-sr,cr,o.half);
        if(!okL&&!okR){why="blocked";break;}
        if(dodge===0||(dodge<0&&!okL)||(dodge>0&&!okR))dodge=okL?-1:1;
        head+=dodge*maxTurn;corner=0;dodged=true;
      }else dodge=0;
    }
    if(!dodged){
      if(corner>0){
        head+=maxTurn*cornerDir;corner--;
      }else{
        head+=clamp((L.fbm1(s*3.1,3,o.seed)-0.5)*2*o.wander,-1,1)*maxTurn;
        if(rng()<stepM*0.55){
          corner=Math.round((Math.PI*0.5/maxTurn)*(0.55+rng()*0.75));
          cornerDir=rng()<0.5?-1:1;
        }
      }
    }
    const tx=Math.cos(head),ty=Math.sin(head);
    x+=tx*stepM;y+=ty*stepM;s+=stepM;
    if(bay){
      /* off the edge of the aperture is off the end of the route: it has gone
         somewhere else in the airframe, which is what a grommet means */
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

/* ===================== A RUN WITH NO ENDS =====================
   On a seamless tile the honest answer to "where does this cable go" is often
   that it does not go anywhere: it leaves one edge, arrives at the other, and
   comes back to where it started. Such a run has no ends to terminate and no
   junction box to invent, and it is the only kind that is genuinely endless
   rather than merely long.

   IT CANNOT BE INTEGRATED INTO EXISTENCE. Walking a heading and hoping to
   arrive back at the start on the same bearing does not converge, and steering
   it home over the last stretch puts a kink at the join that no amount of
   smoothing hides. So a closed run is CONSTRUCTED closed instead, as a curve
   that is periodic by definition:

     P(t) = t·D  +  Σ  A_k sin(2πkt) + B_k cos(2πkt)          t ∈ [0,1)

   D is a whole number of tiles in each axis — the WINDING — so P(1) and P(0)
   are the same point on the torus however the harmonics fall, and the harmonic
   sum is periodic on its own. Closure is therefore exact and free, and what is
   left to control is only the shape.

   THE BEND CLAMP IS THE ONLY THING THAT CONSTRAINS IT. Curvature is
   |x'y" − y'x"| / |P'|³ and it comes straight off the same derivatives, so the
   harmonics are simply scaled back until the tightest point on the loop is
   inside the minimum bend radius. Amplitudes fall as 1/k^1.6, which is what
   stops a route from being a circle at one end of the wander slider and a
   scribble at the other. */
function closedWalk(g,o){
  const rng=o.rng,K=4;
  const Dx=o.m*g.Wm,Dy=o.n*g.Hm;
  const span=Math.max(g.Wm,g.Hm);
  const Ax=new Float64Array(K),Ay=new Float64Array(K),
        Bx=new Float64Array(K),By=new Float64Array(K);
  for(let k=1;k<=K;k++){
    const a=o.amp*span/Math.pow(k,1.6);
    Ax[k-1]=(rng()*2-1)*a;Ay[k-1]=(rng()*2-1)*a;
    Bx[k-1]=(rng()*2-1)*a;By[k-1]=(rng()*2-1)*a;
  }

  const NT=2048,TAU=Math.PI*2;
  const px=new Float64Array(NT+1),py=new Float64Array(NT+1),
        sp=new Float64Array(NT+1),cum=new Float64Array(NT+1);
  const maxK=1/o.minR;
  let lam=1;

  function sample(){
    let worstK=0,slowest=1e30;
    for(let i=0;i<=NT;i++){
      const t=i/NT;
      let x=Dx*t+o.x0,y=Dy*t+o.y0,dx=Dx,dy=Dy,ddx=0,ddy=0;
      for(let k=1;k<=K;k++){
        const w=TAU*k,c=Math.cos(w*t),s2=Math.sin(w*t);
        const ax=Ax[k-1]*lam,ay=Ay[k-1]*lam,bx=Bx[k-1]*lam,by=By[k-1]*lam;
        x+=ax*s2+bx*c;   y+=ay*s2+by*c;
        dx+=w*(ax*c-bx*s2); dy+=w*(ay*c-by*s2);
        ddx-=w*w*(ax*s2+bx*c); ddy-=w*w*(ay*s2+by*c);
      }
      px[i]=x;py[i]=y;
      const v=Math.sqrt(dx*dx+dy*dy);
      sp[i]=v;
      if(v<slowest)slowest=v;
      if(v>1e-9){
        const kk=Math.abs(dx*ddy-dy*ddx)/(v*v*v);
        if(kk>worstK)worstK=kk;
      }
    }
    return {worstK:worstK,slowest:slowest};
  }

  let q=sample();
  const straight=Math.sqrt(Dx*Dx+Dy*Dy);
  for(let tries=0;tries<16&&(q.worstK>maxK||q.slowest<straight*0.30);tries++){
    lam*=0.72;q=sample();
  }

  /* arc length, then a uniform resample: the loop is emitted with a whole
     number of steps in it, so the spacing closes as exactly as the shape does */
  cum[0]=0;
  for(let i=1;i<=NT;i++)cum[i]=cum[i-1]+(sp[i]+sp[i-1])*0.5/NT;
  const total=cum[NT];
  const n=Math.max(16,Math.round(total/o.stepM));
  const ds=total/n;
  const pts=new Float64Array(n*4);
  let j=0;
  for(let i=0;i<n;i++){
    const target=i*ds;
    while(j<NT-1&&cum[j+1]<target)j++;
    const f=(target-cum[j])/Math.max(1e-12,cum[j+1]-cum[j]);
    let x=px[j]+(px[j+1]-px[j])*f, y=py[j]+(py[j+1]-py[j])*f;
    /* the tangent off the SAMPLED positions either side rather than off the
       wrapped ones: the positions below are folded into the tile and a
       difference across that fold is a whole tile wide */
    const tx=px[j+1]-px[j],ty=py[j+1]-py[j];
    const m=Math.sqrt(tx*tx+ty*ty)||1;
    x=x%g.Wm;if(x<0)x+=g.Wm;
    y=y%g.Hm;if(y<0)y+=g.Hm;
    const w=i*4;
    pts[w]=x;pts[w+1]=y;pts[w+2]=tx/m;pts[w+3]=ty/m;
  }
  return {pts:pts,nPts:n,len:n*o.stepM,trueLen:total};
}

/* the windings a closed run may take round the tile. A run dressed to an axis
   takes a straight one; a free one may go diagonally and come back. */
const WIND_AXIAL=[[1,0],[0,1],[2,0],[0,2],[1,0],[0,1]];
const WIND_FREE=[[1,1],[1,-1],[2,1],[1,2],[2,-1],[-1,2],[1,0],[0,1]];

/* ============================ mode definition ============================ */

Forge.register({
  id:"conduit",
  label:"Conduit",
  group:"Detail",
  threadable:true,
  blurb:"Layered bundles of conduit — what is behind an access panel",
  title:'Conduit <em>Loom</em>',
  tagline:"Bundles · strata · clamps · braid · corrugation · lightening holes",
  actionLabel:"Route the loom",
  busyLabel:"Routing…",
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
    {id:"engine",label:"Engine bay",set:{
      piece:"tile",tileMm:620,cavityMm:95,layers:4,bundles:3,groupMax:5,endless:.8,
      gaugeMinMm:9,gaugeMaxMm:46,wander:.55,axis:.45,
      wTube:.7,wCorr:1,wBraid:.8,wSpiral:.5,wRibbon:.15,wLagged:.6,
      clampAmt:1,tieAmt:.7,identAmt:.5,lamps:.15,
      ribMm:78,ribWMm:16,ribHMm:7,holeMm:34,
      oil:.45,dust:.3,heat:.4,scuff:.35,aoStr:1,
      mCurve:.5,mGrain:.4,mDust:.35,
      cPlate:"#4c5054",cDeep:"#0b0c0d",cLamp:"#49ff9c"}},

    {id:"harness",label:"Wiring harness",set:{
      piece:"tile",tileMm:380,cavityMm:70,layers:4,bundles:4,groupMax:7,endless:.85,
      gaugeMinMm:6,gaugeMaxMm:22,wander:.7,axis:.3,
      wTube:.15,wCorr:.5,wBraid:.4,wSpiral:1,wRibbon:.5,wLagged:0,
      clampAmt:1,tieAmt:1,identAmt:.9,lamps:.05,
      ribMm:60,ribWMm:12,ribHMm:5,holeMm:24,
      oil:.15,dust:.35,heat:.05,scuff:.25,aoStr:1,
      mCurve:.5,mGrain:.45,mDust:.4,
      cPlate:"#565a5e",cDeep:"#0c0d0f",cLamp:"#ffb648"}},

    {id:"hydraulic",label:"Hydraulic run",set:{
      piece:"tile",tileMm:540,cavityMm:85,layers:3,bundles:2,groupMax:4,endless:.7,
      gaugeMinMm:10,gaugeMaxMm:30,wander:.35,axis:.75,
      wTube:1,wCorr:.2,wBraid:1,wSpiral:.1,wRibbon:0,wLagged:.2,
      clampAmt:1,tieAmt:.3,identAmt:.35,lamps:0,
      ribMm:90,ribWMm:18,ribHMm:8,holeMm:40,
      oil:.75,dust:.2,heat:.25,scuff:.4,aoStr:1,
      mCurve:.55,mGrain:.35,mDust:.25,
      cPlate:"#474b4f",cDeep:"#0a0b0c",cLamp:"#49ff9c"}},

    {id:"hatch",label:"Access hatch",set:{
      piece:"bay",bayWmm:520,bayHmm:380,frameMm:26,cornerMm:18,fasteners:true,
      cavityMm:100,layers:4,bundles:3,groupMax:5,
      gaugeMinMm:8,gaugeMaxMm:42,wander:.5,axis:.5,
      wTube:.6,wCorr:1,wBraid:.7,wSpiral:.6,wRibbon:.2,wLagged:.5,
      clampAmt:1,tieAmt:.7,identAmt:.55,lamps:.2,
      ribMm:74,ribWMm:15,ribHMm:7,holeMm:32,
      oil:.4,dust:.35,heat:.3,scuff:.35,aoStr:1,
      mCurve:.5,mGrain:.4,mDust:.35,
      cPlate:"#4c5054",cDeep:"#0b0c0d",cFrame:"#7d838a",cLamp:"#49ff9c"}},

    {id:"reactor",label:"Reactor conduit",set:{
      piece:"bay",bayWmm:760,bayHmm:760,frameMm:34,cornerMm:60,fasteners:true,
      cavityMm:150,layers:5,bundles:4,groupMax:6,
      gaugeMinMm:12,gaugeMaxMm:70,wander:.45,axis:.35,
      wTube:.5,wCorr:1,wBraid:.5,wSpiral:.4,wRibbon:.1,wLagged:1,
      clampAmt:1,tieAmt:.5,identAmt:.4,lamps:.55,
      ribMm:110,ribWMm:22,ribHMm:10,holeMm:48,
      oil:.3,dust:.25,heat:.7,scuff:.3,aoStr:1.1,
      mCurve:.55,mGrain:.4,mDust:.3,
      cPlate:"#3f4348",cDeep:"#08090a",cFrame:"#6d737a",cLamp:"#5fe0ff"}},

    {id:"crawl",label:"Crawlspace",set:{
      piece:"tile",tileMm:900,cavityMm:120,layers:5,bundles:5,groupMax:6,endless:.75,
      gaugeMinMm:8,gaugeMaxMm:64,wander:.8,axis:.2,
      wTube:.5,wCorr:1,wBraid:.4,wSpiral:.7,wRibbon:.3,wLagged:.8,
      clampAmt:.7,tieAmt:.5,identAmt:.3,lamps:.1,
      ribMm:120,ribWMm:20,ribHMm:8,holeMm:0,
      oil:.5,dust:.7,heat:.15,scuff:.3,aoStr:1.05,
      mCurve:.5,mGrain:.5,mDust:.6,
      cPlate:"#3d4145",cDeep:"#090a0b",cLamp:"#ff5a48"}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"piece",type:"select",label:"Draw",value:"tile",options:[
        ["tile","Seamless field"],["bay","One framed bay"]]},
      {id:"size",type:"select",label:"Resolution",value:1024,numeric:true,
       options:Forge.sizes("square",2048)},
      {id:"tileMm",label:"Tile covers",unit:"mm",min:200,max:2000,step:20,value:620,need:"tile"},
      {id:"bayWmm",label:"Bay width",unit:"mm",min:150,max:1600,step:10,value:520,need:"bay"},
      {id:"bayHmm",label:"Bay height",unit:"mm",min:150,max:1600,step:10,value:380,need:"bay"},
      {id:"frameMm",label:"Frame width",unit:"mm",min:6,max:80,step:1,value:26,need:"bay"},
      {id:"cornerMm",label:"Corner radius",unit:"mm",min:0,max:200,step:2,value:18,need:"bay"},
      {type:"checks",need:"bay",items:[
        {id:"fasteners",label:"Fasteners round the frame",value:true}]},
      {type:"readout"},
      {id:"seed",type:"seed",label:"Seed",value:4118},
      {type:"note",html:"<b>Seamless field</b> is an endless equipment bay or hull interior. "+
        "<b>One framed bay</b> is a single access opening with a lip and an alpha silhouette — "+
        "drop it on a hull and the hull shows through around it."}
    ]},

    {title:"The loom",open:true,rows:[
      {id:"cavityMm",label:"Cavity depth",unit:"mm",min:20,max:260,step:5,value:95},
      {id:"layers",label:"Layers",min:1,max:6,step:1,value:4},
      {id:"bundles",label:"Bundles per layer",min:1,max:10,step:1,value:3},
      {id:"groupMax",label:"Conduits per bundle",min:1,max:8,step:1,value:5},
      {id:"gaugeMinMm",label:"Finest gauge",unit:"mm",min:3,max:40,step:1,value:9},
      {id:"gaugeMaxMm",label:"Fattest gauge",unit:"mm",min:8,max:110,step:2,value:46},
      {id:"wander",label:"Wander",min:0,max:1,step:0.05,value:0.55},
      {id:"axis",label:"Runs with the bay",min:0,max:1,step:0.05,value:0.45},
      {id:"endless",label:"Runs with no ends",min:0,max:1,step:0.05,value:0.75,need:"tile"},
      {type:"note",html:"A <b>bundle</b> is a group: several conduits laid parallel at a fixed "+
        "pitch and routed as one, so on a bend the inner ones take a tighter radius than the "+
        "outer ones. Layer 1 is deepest and carries the fattest items."},
      {type:"note",html:"Nothing ends in mid-air. A run either has <b>no ends</b> — it leaves "+
        "one edge of the tile, arrives at the other and comes back to where it started, so it "+
        "is genuinely endless — or it terminates in a <b>junction box</b> bolted to the "+
        "backplane, entered square through a gland. In a framed bay a run may also leave "+
        "through the frame, which is a bulkhead grommet; a seamless tile has nowhere to leave "+
        "to, so this slider is the only choice there is."}
    ]},

    {title:"What is in it",rows:[
      {id:"wTube",label:"Rigid tube",min:0,max:1,step:0.05,value:0.7},
      {id:"wCorr",label:"Corrugated flex",min:0,max:1,step:0.05,value:1},
      {id:"wBraid",label:"Braided hose",min:0,max:1,step:0.05,value:0.8},
      {id:"wSpiral",label:"Spiral wrap",min:0,max:1,step:0.05,value:0.5},
      {id:"wRibbon",label:"Flat ribbon",min:0,max:1,step:0.05,value:0.15},
      {id:"wLagged",label:"Lagged pipe",min:0,max:1,step:0.05,value:0.6},
      {id:"corrMm",label:"Corrugation pitch",unit:"mm",min:4,max:30,step:1,value:14},
      {type:"note",html:"Weights, not counts. Every finish is <b>geometry</b> — the rings, the "+
        "weave and the spiral go into the height field before the normal is differenced out "+
        "of it, so they survive being lit from any direction."}
    ]},

    {title:"Fittings",rows:[
      {id:"clampAmt",label:"Clamps",min:0,max:1,step:0.05,value:1},
      {id:"tieAmt",label:"Cable ties",min:0,max:1,step:0.05,value:0.7},
      {id:"identAmt",label:"Ident bands",min:0,max:1,step:0.05,value:0.5},
      {id:"lamps",label:"Indicator lamps",min:0,max:1,step:0.05,value:0.15},
      {type:"colors",label:"Lamp",items:[{id:"cLamp",value:"#49ff9c"}]}
    ]},

    {title:"Backplane",rows:[
      {id:"ribMm",label:"Rib spacing",unit:"mm",min:30,max:220,step:2,value:78},
      {id:"ribWMm",label:"Rib width",unit:"mm",min:4,max:50,step:1,value:16},
      {id:"ribHMm",label:"Rib height",unit:"mm",min:0,max:24,step:1,value:7},
      {id:"holeMm",label:"Lightening holes",unit:"mm",min:0,max:120,step:2,value:34},
      {type:"colors",label:"Plate · down the holes",items:[
        {id:"cPlate",value:"#4c5054"},{id:"cDeep",value:"#0b0c0d"}]},
      {type:"colors",label:"Frame",need:"bay",items:[{id:"cFrame",value:"#7d838a"}]}
    ]},

    {title:"Wear",rows:[
      {id:"oil",label:"Oil and streaks",min:0,max:1,step:0.05,value:0.45},
      {id:"dust",label:"Dust",min:0,max:1,step:0.05,value:0.3},
      {id:"heat",label:"Heat tint",min:0,max:1,step:0.05,value:0.4},
      {id:"scuff",label:"Scuffing",min:0,max:1,step:0.05,value:0.35}
    ]},

    {title:"Micro detail",rows:[
      {id:"mCurve",label:"Edge wear and crack dirt",min:0,max:1,step:0.05,value:0.5},
      {id:"mGrain",label:"Surface grain",min:0,max:1,step:0.05,value:0.4},
      {id:"mDust",label:"Dust on upward faces",min:0,max:1,step:0.05,value:0.35}
    ]},

    {title:"Maps",rows:[
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1.5,step:0.05,value:1},
      {id:"normalStr",label:"Normal strength",min:0.2,max:3,step:0.1,value:1},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  needs:function(p){return [isBay(p)?"bay":"tile"];},

  seamless:function(p){return !isBay(p);},
  backdrops:function(p){return isBay(p);},

  size:function(p){const g=geom(p);return {w:g.TW,h:g.TH};},
  build:function(p,io){return L.build(p,io,{routes:routes});},
  plan:function(p){
    const g=geom(p),B=bundleSpec(g,p);
    /* the strata, in metres: where each layer's underside sits and how tall
       the tallest thing standing on it is. Reported because it is the one
       number a person setting layers and gauges against a cavity depth needs
       and cannot see — and because a layer that does not clear the one under
       it is a bug that ought to be checkable from outside. */
    return {w:g.Wm,h:g.Hm,cutout:g.bay,
            strata:Array.from(B.ST.z),crowns:Array.from(B.ST.h),
            stackM:B.ST.top,gaugeScale:B.ST.scale};
  },

  tileTag:function(p){return isBay(p)?"":"Tiles ↔ and ↕";},

  readout:function(p){
    const g=geom(p);
    const bundles=clamp(p.layers|0,1,6)*clamp(p.bundles|0,1,10);
    const ST=bundleSpec(g,p).ST;
    /* the strata, since they are the subject and they are worked out from the
       gauges rather than set: what a person needs to know is where each layer
       ended up and whether the cavity had room for the stack it asked for */
    const floors=Array.from(ST.z,z=>Math.round(z*1000)).join(", ");
    const st="<br>strata at <b>"+floors+" mm</b>, "+
      (ST.top*1000).toFixed(0)+" mm deep"+
      (ST.scale<0.995
        ?" — gauges cut to <b>"+Math.round(ST.scale*100)+"%</b> to fit"
        :"");
    return "<b>"+Math.round(g.Wm*1000)+" × "+Math.round(g.Hm*1000)+" mm</b> · "+
      g.TW+" × "+g.TH+" px<br>"+
      "<b>"+(g.mpp*1000).toFixed(2)+" mm per texel</b> · "+Math.round(g.pxM)+" px/m<br>"+
      bundles+" bundles asked for over "+clamp(p.layers|0,1,6)+" layers, "+
      "up to "+clamp(p.groupMax|0,1,8)+" conduits each<br>"+
      "cavity "+Math.round((+p.cavityMm||95))+" mm · gauges "+
      Math.round(+p.gaugeMinMm||9)+"–"+Math.round(+p.gaugeMaxMm||46)+" mm"+st;
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
"bulkhead grommet"+(c.glands===1?"":"s")+". Nothing stops in mid-air.",
c.boxes?("Every box is bolted on a quarter turn to the plate — the plate is ribbed and\n"+
  "drilled square and nobody drills a mounting pattern off-axis to suit a cable —\n"+
  "and the run is brought round to meet it, entering within "+
  c.skewMax.toFixed(1)+"\u00b0 of square\nat the worst of them and "+
  c.skewAvg.toFixed(1)+"\u00b0 on average."):null
].filter(x=>x!==null):[];
    return [
"TEXTURE FORGE — conduit loom",
"",
(bay?"One framed access bay, ":"A seamless field, ")+
  Math.round(g.Wm*1000)+" × "+Math.round(g.Hm*1000)+" mm, at "+info.W+" × "+info.H+" px",
"("+(g.mpp*1000).toFixed(2)+" mm per texel).",
"",
bay?"CUT-OUT. opacity.png is the silhouette of the bay. Use it as the alpha of\nthe base colour, or as an opacity/clip map, and the surface it is dropped\nonto shows through around it."
   :"SEAMLESS. Tiles in both axes. Every route was routed on the torus, so a\nbundle that leaves one edge arrives at the other still on its heading.",
"",
"WHAT IS IN IT",
clamp(p.layers|0,1,6)+" layers, "+clamp(p.bundles|0,1,10)+" bundles each. A bundle is a GROUP:",
"up to "+clamp(p.groupMax|0,1,8)+" conduits laid parallel at a fixed pitch, routed as one,",
"held down by clamps that span the whole group. Gauges run "+
  Math.round(+p.gaugeMinMm||9)+"–"+Math.round(+p.gaugeMaxMm||46)+" mm",
"in a cavity "+Math.round(+p.cavityMm||95)+" mm deep.",
"",
"FILES",
"basecolor.png  sRGB.",
"normal.png     Tangent space, "+info.normalNote+".",
"roughness.png  Linear grey.",
"metallic.png   Linear grey. Braid, tube and the backplane are metal; rubber,",
"               PVC, PTFE, lagging, ties and ident sleeving are not.",
"ao.png         Linear grey. Carries the depth of the bay as well as the",
"               local occlusion — see below.",
"emissive.png   Indicator lamps only. Black where there are none.",
"height.png     Linear grey, remapped over the range below.",
"orm.png        R=AO, G=roughness, B=metallic.",
bay?"opacity.png    The bay silhouette.":null,
"unlit.png      The whole thing with one lighting solution already in it.",
"",
"HEIGHT",
"height.png is normalised over "+info.hMin.toFixed(4)+" … "+info.hMax.toFixed(4)+" m,",
"a range of "+((info.hMax-info.hMin)*1000).toFixed(1)+" mm. Displace by that to get the real depth;",
"height16.png is the same field at 16 bits, which is what you want for this",
"mode — an 8-bit height over a hundred millimetres of cavity quantises the",
"finest conduits into steps.",
"",
"THE AO IS DOING TWO JOBS",
"Local occlusion, the way every mode here does it, AND a depth term: how far",
"into the cavity a texel sits, independent of its neighbours. A blur cannot",
"see that — a conduit four layers down is dark because it is four layers down,",
"not because the texel beside it is higher — and without it the strata all",
"read at one brightness, which is the whole subject gone.",
"",
"Seed "+(p.seed|0)+"."
    ].concat(ends).filter(x=>x!==null).join("\n");
  }
});

})();
