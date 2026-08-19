/* =====================================================================
   QUILT — a wrapping recursive subdivision of the unit torus
   =====================================================================

   Both the hull mode (starship aztec plating) and the greeble mode want
   the same underlying thing: the tile carved into rectangles of several
   sizes, machined rather than noisy, and seamless. They render it
   completely differently — one as a sheen pattern a hair deep, the other
   as extruded blocks — so only the carving lives here.

   Why not a plain BSP? A BSP over the unit square puts a straight cut all
   the way along u=0, and that cut is the tile edge: every rectangle stops
   dead at the seam and the repeat is instantly visible. So the carving is
   built the other way round, from a grid that wraps by construction:

     rows      equal horizontal bands, 1/rows tall, so every row boundary
               lands on a multiple of 1/rows and v wraps for free
     columns   each row is cut into `cols` equal columns offset by a
               per-row phase; boundaries at (j+phase)/cols wrap in u, and
               the differing phase per row gives the running-bond stagger
     splits    a cell may then split recursively, but only ever inside
               itself, so no split can reach a tile edge

   The sizes that come out are 1/rows, 1/2rows, 1/4rows tall by 1/cols,
   1/2cols, 1/3cols wide — a small set of related sizes, which is what
   makes the result read as panelling rather than as noise.

   Loaded before the modes that use it; it publishes window.Quilt.

     const Q=Quilt.build({rows:16,colsMin:4,colsMax:8,split:0.55,depth:2,
                          minW:3/S,minH:3/S,seed:1701});
     const rec=Quilt.record();
     Quilt.locate(Q,u,v,rec);        // fills rec, allocates nothing

   locate() runs once per texel, so it takes a record to fill rather than
   returning a fresh object: at 4096 square that is 16.7 million objects
   the garbage collector never has to see.
   ===================================================================== */
"use strict";

(function(){
const hashi=Forge.hashi,mulberry32=Forge.mulberry32;

function build(o){
  const rows=Math.max(1,o.rows|0);
  const cMin=Math.max(1,o.colsMin|0),cMax=Math.max(cMin,o.colsMax|0);
  const seed=o.seed|0;
  const rng=mulberry32(seed*2654435761+7919);
  const R=[];
  for(let i=0;i<rows;i++)R.push({cols:cMin+Math.floor(rng()*(cMax-cMin+1)),phase:rng()});
  /* Row boundaries land on multiples of 1/rows, and so does the tile edge —
     which puts a straight, continuous row line along v=0 in every build. That
     tiles perfectly and still reads as a repeat, because the eye picks up one
     unbroken line ruled across the wrap. So the whole carving is shifted to sit
     the tile edge inside a row instead of on one. Any shift is still seamless
     (locate() is a function on the torus, and translation on a torus is too);
     0.4131 is chosen to stay clear of the half and third split points a row
     subdivides at, which is where the next boundary down could be hiding.
     Columns need no such shift: they already carry a random phase per row. */
  const ov=0.4131/rows;
  return {rows:rows,R:R,seed:seed,ov:ov,
          depth:Math.max(0,o.depth|0),
          split:o.split==null?0.5:o.split,
          minW:o.minW||0.002,minH:o.minH||0.002};
}

/* A record is a bag of numbers reused across the whole build. x0/y0 are in the
   quilt's own shifted space and are informational; everything a caller actually
   needs — w, h, lu, lv, du, dv, dEdge — is relative to the cell. */
function record(){
  return {x0:0,y0:0,w:1,h:1,lu:0,lv:0,du:0,dv:0,dEdge:0,depth:0,row:0,key:0,rnd:0};
}

/* Any number of independent randoms per cell, stable across builds and
   independent of how deep the cell happens to sit. */
function rand(Q,rec,k){return hashi(rec.key,k|0,Q.seed);}

function locate(Q,u,v,out){
  u-=Math.floor(u);v+=Q.ov;v-=Math.floor(v);
  const rows=Q.rows;
  let ri=Math.floor(v*rows);if(ri>=rows)ri=rows-1;
  const row=Q.R[ri],cols=row.cols;

  /* column index may come out negative when the phase pushes the first
     boundary past u=0; that is the cell straddling the tile edge, and it
     has to hash to the same identity as its other half, hence the mod */
  const s=u*cols-row.phase;
  const ci=Math.floor(s);
  let lu=s-ci,lv=v*rows-ri;
  let x0=(ci+row.phase)/cols,w=1/cols;
  let y0=ri/rows,h=1/rows;
  let key=(Math.imul(ri,73856093)^Math.imul(((ci%cols)+cols)%cols,19349663))|0;

  let d=0;
  while(d<Q.depth){
    if(hashi(key,d*7+1,Q.seed)>=Q.split)break;
    /* always cut the longer side: cells stay roughly square instead of
       degenerating into slivers a few subdivisions down */
    const f=hashi(key,d*7+2,Q.seed);
    const frac=(f<0.62)?0.5:(f<0.81?1/3:2/3);      // halves mostly, thirds sometimes
    if(w>=h){
      if(w*frac<Q.minW||w*(1-frac)<Q.minW)break;
      if(lu<frac){w*=frac;lu/=frac;key=(key*4+1)|0;}
      else{x0+=w*frac;w*=(1-frac);lu=(lu-frac)/(1-frac);key=(key*4+2)|0;}
    }else{
      if(h*frac<Q.minH||h*(1-frac)<Q.minH)break;
      if(lv<frac){h*=frac;lv/=frac;key=(key*4+3)|0;}
      else{y0+=h*frac;h*=(1-frac);lv=(lv-frac)/(1-frac);key=(key*4+4)|0;}
    }
    d++;
  }

  out.x0=x0;out.y0=y0;out.w=w;out.h=h;out.lu=lu;out.lv=lv;
  out.depth=d;out.row=ri;out.key=key;out.rnd=hashi(key,911,Q.seed);
  /* distance to the cell's own edges, in uv — the value every caller wants,
     for seams, gaps, bevels, insets and corner fasteners alike */
  out.du=(lu<0.5?lu:1-lu)*w;
  out.dv=(lv<0.5?lv:1-lv)*h;
  out.dEdge=out.du<out.dv?out.du:out.dv;
  return out;
}

window.Quilt={build:build,record:record,locate:locate,rand:rand};

})();
