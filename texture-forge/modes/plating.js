/* =====================================================================
   MODE: plating — seamless riveted aircraft skin
   =====================================================================
   Staggered panel bays with lap-joint steps, rivets, three-layer chipping
   from paint through zinc-chromate primer to bare aluminium, scratches,
   streaks and seam grime. Tiles seamlessly in both axes.

   Was panel-forge.html. Exported files keep the panel_ prefix. The generator
   is the standalone tool's, with one deliberate departure: rivet heads are now
   sieved against each other as they are laid, so a panel corner cannot stack a
   stringer rivet on a butt rivet, and a field patch either borrows a section of
   an existing seam line or sits clear of every one of them. Seeds from before
   that change give the same panels and the same wear, but not the same rivets.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,mulberry32=Forge.mulberry32,
      hashi=Forge.hashi,vnoise=Forge.vnoise,fbm=Forge.fbm,vnoise2=Forge.vnoise2,fbm2=Forge.fbm2,
      wrapDist=Forge.wrapDist,hex2rgb=Forge.hex2rgb,boxBlurWrap=Forge.blurWrap;

/* the live parameter set, refreshed by build() before anything reads it */
let P={};

function buildLayout(){
  const rng=mulberry32((P.seed|0)*2654435761+11);
  const N=Math.max(1,P.rows|0);
  const bounds=[0];
  for(let i=1;i<N;i++)bounds.push(clamp(i/N+(rng()-0.5)*(P.jitter*0.7/N),0.01,0.99));
  bounds.sort((a,b)=>a-b);
  const rows=[];
  for(let i=0;i<N;i++){
    const y0=bounds[i],y1=(i+1<N)?bounds[i+1]:1;
    const cols=P.colsMin+Math.floor(rng()*(P.colsMax-P.colsMin+1));
    const phase=rng(),seams=[];
    for(let j=0;j<cols;j++){
      let x=j/cols+phase+(rng()-0.5)*(P.jitter*0.7/cols);
      x-=Math.floor(x);seams.push(x);
    }
    seams.sort((a,b)=>a-b);
    rows.push({y0:y0,y1:y1,seams:seams,idx:i,rng:rng()});
  }
  return {bounds:bounds,rows:rows,N:N};
}

function buildRivets(L){
  const rng=mulberry32((P.seed|0)*40503+97);
  const out=[];
  if(P.rivStyle==="none")return out;
  const R=P.rivSize*P.rivSpace*0.5;                 // head radius in UV
  const off=P.seamW*0.004*0.55+R*1.35;              // offset from the seam centreline
  const styleOf=()=>P.rivStyle==="mixed"?(rng()<0.5?1:0):(P.rivStyle==="dome"?1:0);
  const wob=P.rivWobble;

  /* Heads are sieved as they go down: one that would land on a head already
     placed is dropped instead of stacked on top of it. Only rivets from
     DIFFERENT runs are tested against each other — the pitch inside a run is
     deliberate, and a run whose heads are a whole pitch across would otherwise
     cull every second rivet of its own. Both sides of one seam count as a
     single run for the same reason. What the sieve is really there for is the
     panel CORNER, where a stringer row crosses a butt row and the two lines
     pile a head straight onto a head.
     Buckets are at least three head radii across, so the three-by-three
     neighbourhood always holds everything within touching distance. */
  const SG=clamp(Math.floor(1/Math.max(R*3,1/256)),4,256);
  const sieve=new Array(SG*SG);
  let run=0;
  function push(x,y,s){
    x-=Math.floor(x);y-=Math.floor(y);
    const r=R*(1+(rng()-0.5)*0.25*(1+wob)),hh=1+(rng()-0.5)*0.4*wob;
    const gx=clamp(Math.floor(x*SG),0,SG-1),gy=clamp(Math.floor(y*SG),0,SG-1);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const list=sieve[((gy+dy+SG)%SG)*SG+((gx+dx+SG)%SG)];
      if(!list)continue;
      for(let i=0;i<list.length;i++){
        const o=list[i];
        if(o.run===run)continue;
        const ax=wrapDist(x,o.x),ay=wrapDist(y,o.y),sep=(r+o.r)*1.03;
        if(ax*ax+ay*ay<sep*sep)return false;         // the two heads would touch
      }
    }
    const riv={x:x,y:y,r:r,s:s,h:hh,run:run};
    const k=gy*SG+gx;
    (sieve[k]||(sieve[k]=[])).push(riv);
    out.push(riv);
    return true;
  }

  /* Rivets tracking the horizontal (stringer) seams. Each line's pitch and
     phase are kept: a field patch that laps this seam borrows a section of the
     line itself rather than laying a second one a fraction of a pitch away. */
  const stringer=[];
  for(let i=0;i<L.N;i++){
    const y=L.bounds[i];
    const n=Math.max(6,Math.round(1/P.rivSpace));
    const phase=rng();
    const sides=P.rivDouble?[-1,1]:[rng()<0.5?-1:1];
    stringer.push({n:n,phase:phase,below:sides.indexOf(1)>=0,above:sides.indexOf(-1)>=0});
    run++;
    for(const sgn of sides){
      const st=styleOf();
      for(let k=0;k<n;k++){
        const t=(k+phase)/n;
        push(t+(rng()-0.5)*wob*0.4/n,y+sgn*off+(rng()-0.5)*wob*R*0.6,st);
      }
    }
  }
  // rivets tracking the vertical (butt-joint) seams, contained within their row
  for(const row of L.rows){
    const h=row.y1-row.y0;
    row.butt=[];
    for(const sx of row.seams){
      const n=Math.max(2,Math.round(h/P.rivSpace));
      const sides=P.rivDouble?[-1,1]:[rng()<0.5?-1:1];
      row.butt.push({n:n,right:sides.indexOf(1)>=0,left:sides.indexOf(-1)>=0});
      run++;
      for(const sgn of sides){
        const st=styleOf();
        for(let k=0;k<n;k++){
          const t=row.y0+(k+0.5)*h/n;
          push(sx+sgn*off+(rng()-0.5)*wob*R*0.6,t+(rng()-0.5)*wob*0.4*h/n,st);
        }
      }
    }
  }

  /* Field rivets: doubler and inspection patches inside a panel. A patch
     either LAPS a seam — and then the seam's own rivet line IS the patch's
     edge row, borrowed at that line's pitch and phase, with nothing new laid
     beside it — or it sits as an island in the middle of the panel with the
     best part of a pitch of bare skin between it and every seam line. The one
     thing a patch must not do is put a row a fraction of a pitch off an
     existing one, which is what blind placement did every time a patch
     happened to wander across a seam. */
  if(P.rivField){
    const pitch=P.rivSpace;
    const clear=off+pitch*0.9;                       // an island keeps this far off a seam
    const patches=Math.round(2+rng()*4);
    for(let p=0;p<patches;p++){
      const ri=Math.floor(rng()*L.N),row=L.rows[ri];
      const ns=row.seams.length;
      const cj=Math.floor(rng()*ns);
      const x0=row.seams[cj],x1=(cj+1<ns)?row.seams[cj+1]:row.seams[0]+1;
      const pw=x1-x0,ph=row.y1-row.y0;
      const bot=stringer[ri],top=stringer[(ri+1)%L.N];
      const lft=row.butt[cj],rgt=row.butt[(cj+1)%ns];

      /* which of the four panel edges actually carries a line to borrow */
      const anchors=[];
      if(bot.below)anchors.push(0);
      if(top.above)anchors.push(1);
      if(lft.right)anchors.push(2);
      if(rgt.left)anchors.push(3);

      const A=[],B=[];
      let share=0;                                   // 1 = B[0] borrowed, 2 = A[0] borrowed
      if(anchors.length&&rng()<0.55){
        const side=anchors[Math.floor(rng()*anchors.length)];
        if(side<2){
          /* lapping a stringer: the patch's columns land on that line's own
             rivets, so the shared edge is those rivets and not a copy of them */
          const ln=side===0?bot:top,dir=side===0?1:-1;
          const yb=side===0?row.y0+off:row.y1-off;
          const kA=Math.ceil((x0+off)*ln.n-ln.phase),kB=Math.floor((x1-off)*ln.n-ln.phase);
          const avail=kB-kA+1,deep=Math.floor((ph-off-clear)/pitch)+1;
          if(avail>=3&&deep>=2){
            const nx=Math.min(avail,3+Math.floor(rng()*5));
            const k0=kA+Math.floor(rng()*(avail-nx+1));
            const ny=Math.min(deep,2+Math.floor(rng()*3));
            for(let a=0;a<nx;a++)A.push((k0+a+ln.phase)/ln.n);
            for(let b=0;b<ny;b++)B.push(yb+dir*b*pitch);
            share=1;
          }
        }else{
          const ln=side===2?lft:rgt,dir=side===2?1:-1;
          const xb=side===2?x0+off:x1-off,step=ph/ln.n;
          const kA=Math.max(0,Math.ceil(off/step-0.5)),kB=Math.min(ln.n-1,Math.floor((ph-off)/step-0.5));
          const avail=kB-kA+1,deep=Math.floor((pw-off-clear)/pitch)+1;
          if(avail>=3&&deep>=2){
            const ny=Math.min(avail,3+Math.floor(rng()*5));
            const k0=kA+Math.floor(rng()*(avail-ny+1));
            const nx=Math.min(deep,2+Math.floor(rng()*3));
            for(let a=0;a<nx;a++)A.push(xb+dir*a*pitch);
            for(let b=0;b<ny;b++)B.push(row.y0+(k0+b+0.5)*step);
            share=2;
          }
        }
      }
      if(!share){                                    // an island, clear of every seam
        const availW=pw-2*clear,availH=ph-2*clear;
        const maxNx=Math.floor(availW/pitch)+1,maxNy=Math.floor(availH/pitch)+1;
        if(maxNx<3||maxNy<3)continue;                // this panel cannot hold one
        const nx=Math.min(maxNx,3+Math.floor(rng()*5)),ny=Math.min(maxNy,3+Math.floor(rng()*5));
        const ox=x0+clear+rng()*(availW-(nx-1)*pitch);
        const oy=row.y0+clear+rng()*(availH-(ny-1)*pitch);
        for(let a=0;a<nx;a++)A.push(ox+a*pitch);
        for(let b=0;b<ny;b++)B.push(oy+b*pitch);
      }

      const st=styleOf();run++;
      for(let a=0;a<A.length;a++)for(let b=0;b<B.length;b++){
        if(a>0&&a<A.length-1&&b>0&&b<B.length-1)continue;   // the perimeter only
        if(share===1&&b===0)continue;                       // that row is already down
        if(share===2&&a===0)continue;
        push(A[a],B[b],st);
      }
    }
  }
  return out;
}

function buildRivetGrid(rivets){
  let maxR=0.004;
  for(const r of rivets)maxR=Math.max(maxR,r.r);
  const G=clamp(Math.floor(1/(maxR*2.6)),4,192);
  const cells=new Array(G*G);
  for(let i=0;i<G*G;i++)cells[i]=null;
  for(const r of rivets){
    const cx=clamp(Math.floor(r.x*G),0,G-1),cy=clamp(Math.floor(r.y*G),0,G-1);
    const k=cy*G+cx;
    if(!cells[k])cells[k]=[];
    cells[k].push(r);
  }
  return {G:G,cells:cells,maxR:maxR};
}

/* ============================ scratch / streak detail layers ============================ */
function buildDetail(D){
  const rng=mulberry32((P.seed|0)*7717+3);
  const c=document.createElement("canvas");c.width=c.height=D;
  const g=c.getContext("2d",{willReadFrequently:true});
  g.fillStyle="#000";g.fillRect(0,0,D,D);

  // scratches: drawn nine times offset so every stroke wraps across the tile edge
  const nS=Math.round(P.scratch*260);
  g.lineCap="round";
  for(let i=0;i<nS;i++){
    const x=rng()*D,y=rng()*D;
    const ang=(rng()<0.7?(rng()-0.5)*0.5:(rng()-0.5)*Math.PI);
    const len=D*(0.01+rng()*0.16*(0.4+P.scratch));
    const w=Math.max(0.6,D/1024*(0.5+rng()*1.6));
    const a=0.18+rng()*0.6;
    g.strokeStyle="rgba(255,0,0,"+a.toFixed(3)+")";
    g.lineWidth=w;
    for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++){
      g.beginPath();
      g.moveTo(x+ox*D,y+oy*D);
      g.lineTo(x+ox*D+Math.cos(ang)*len,y+oy*D+Math.sin(ang)*len);
      g.stroke();
    }
  }

  // streaks: dirt running down from fasteners and seams, into the green channel
  const nT=Math.round(P.streak*90);
  for(let i=0;i<nT;i++){
    const x=rng()*D,y=rng()*D;
    const w=D*(0.002+rng()*0.014);
    const h=D*(0.03+rng()*0.34)*(0.4+P.streak);
    const a=(0.10+rng()*0.5)*P.streak;
    for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
      const gr=g.createLinearGradient(0,y+oy*D,0,y+oy*D+h);
      gr.addColorStop(0,"rgba(0,255,0,"+a.toFixed(3)+")");
      gr.addColorStop(0.15,"rgba(0,255,0,"+(a*0.8).toFixed(3)+")");
      gr.addColorStop(1,"rgba(0,255,0,0)");
      g.fillStyle=gr;
      g.fillRect(x+ox*D-w/2,y+oy*D,w,h);
    }
  }
  return g.getImageData(0,0,D,D).data;
}

/* ============================ the generator ============================ */

function build(params,io){
  P=params;
  const S=io.W;
  let hMin=0,hMax=1;
  const L=buildLayout(),rivets=buildRivets(L),grid=buildRivetGrid(rivets);
  const D=Math.min(S,1024),det=buildDetail(D);
  const seed=P.seed|0;

  const A=new Uint8ClampedArray(S*S*3);
  const RGH=new Uint8ClampedArray(S*S);
  const MET=new Uint8ClampedArray(S*S);
  const AOc=new Uint8ClampedArray(S*S);
  const NRM=new Uint8ClampedArray(S*S*3);
  const HGT=new Float32Array(S*S);

  const paint=hex2rgb(P.cPaint),primer=hex2rgb(P.cPrimer),metal=hex2rgb(P.cMetal);
  const seamW=Math.max(0.0006,P.seamW*0.004);
  const seamD=P.seamD*0.010;
  const rivHmax=P.rivH*0.006;
  const grainAmt=P.grain*0.0016;
  const dentAmt=P.dents*0.0048;
  const lapAmt=P.overlap*0.0035;
  const warpAmt=P.panelWarp*0.0022;
  const G=grid.G,cells=grid.cells;

  const band=Math.max(8,Math.round(65536/S));
  let y=0;

  function rivetAt(u,v){
    const cx=Math.floor(u*G),cy=Math.floor(v*G);
    let best=1e9,br=null;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const gx=((cx+dx)%G+G)%G,gy=((cy+dy)%G+G)%G;
      const list=cells[gy*G+gx];
      if(!list)continue;
      for(let i=0;i<list.length;i++){
        const r=list[i];
        const ddx=wrapDist(u,r.x),ddy=wrapDist(v,r.y);
        const d=Math.sqrt(ddx*ddx+ddy*ddy);
        if(d<best){best=d;br=r;}
      }
    }
    return {d:best,riv:br};
  }

  function pass1(){
    const end=Math.min(S,y+band);
    for(;y<end;y++){
      const v=(y+0.5)/S;
      let ri=0;
      for(let i=L.N-1;i>=0;i--){if(v>=L.rows[i].y0){ri=i;break;}}
      const row=L.rows[ri];
      const dY=Math.min(wrapDist(v,row.y0),wrapDist(v,row.y1));
      const rowSign=row.rng<0.5?-1:1;

      for(let x=0;x<S;x++){
        const u=(x+0.5)/S,i=y*S+x;
        // nearest vertical seam within this row + which panel we're in.
        // a panel is identified by the seam that opens it, so the panel
        // straddling u=0 keeps one identity and the tile edge stays invisible.
        let dX=1,ci=-1;
        for(let j=0;j<row.seams.length;j++){
          const d=wrapDist(u,row.seams[j]);
          if(d<dX)dX=d;
          if(row.seams[j]<=u)ci=j;
        }
        if(ci<0)ci=row.seams.length-1;
        const dSeam=Math.min(dX,dY);
        const panelId=hashi(ri*131+ci,ri*17+7,seed);
        const panelId2=hashi(ci*211+ri,ri*53+3,seed+991);

        /* ---- height ---- */
        let h=(panelId-0.5)*2*warpAmt;
        // lap joint: each sheet rides over its neighbour on one side of the seam.
        // written as a periodic function of v so it survives the tile wrap.
        let lap;
        if(dX<dY){
          lap=(panelId2<0.5?-1:1)*smoothstep(seamW*2.6,seamW*0.8,dX);
        }else{
          lap=rowSign*(smoothstep(seamW*2.6,seamW*0.8,wrapDist(v,row.y0))
                      -smoothstep(seamW*2.6,seamW*0.8,wrapDist(v,row.y1)));
        }
        h+=lap*lapAmt;
        // the seam groove itself
        const t=clamp(dSeam/seamW,0,1);
        h-=seamD*(1-smoothstep(0,1,t));
        // rolled sheet grain (anisotropic) + oil-canning
        h+=(fbm2(u,v,96,24,4,seed+11)-0.5)*grainAmt;
        h+=(fbm(u,v,4,3,seed+29)-0.5)*dentAmt*0.8;
        h+=(fbm(u,v,11,3,seed+31)-0.5)*dentAmt*0.5;

        // rivet head
        const rv=rivetAt(u,v);
        let rivMask=0,rivRim=0;
        if(rv.riv&&rv.d<rv.riv.r*1.9){
          const R=rv.riv.r,d=rv.d,hh=rv.riv.h;
          rivMask=1-smoothstep(R*0.85,R*1.05,d);
          rivRim=smoothstep(R*1.5,R*0.95,d)*(1-smoothstep(R*0.95,R*0.55,d));
          if(rv.riv.s===1){ // universal head: a shallow dome sitting proud
            if(d<R*1.02)h+=rivHmax*hh*Math.sqrt(Math.max(0,1-(d/(R*1.02))*(d/(R*1.02))))*0.95;
          }else{            // countersunk: dished ring, head flush with the skin
            h-=rivHmax*hh*0.5*(smoothstep(R*1.3,R*0.8,d)-smoothstep(R*0.8,R*0.2,d));
            h-=rivHmax*hh*0.12*rivMask;
          }
        }

        // scratches cut into the surface
        const di=((Math.floor(v*D)*D+Math.floor(u*D))*4);
        const sc=det[di]/255,st=det[di+1]/255;
        h-=sc*0.0006*P.scratch;

        HGT[i]=h;

        /* ---- surface response ---- */
        const wear=fbm(u,v,8,4,seed+53);
        const fineWear=fbm(u,v,40,4,seed+71);
        const ragged=fbm(u,v,150,2,seed+59);
        const nearSeam=1-smoothstep(0,seamW*3.2,dSeam);
        const nearRiv=rivRim*0.9+rivMask*0.35;
        // wear concentrates in patches; without this gate every fastener
        // would get an identical halo and the surface reads as printed, not worn
        const wearGate=smoothstep(0.34,0.78,wear*0.7+ragged*0.3);
        const edgeBias=(nearSeam*0.5+nearRiv*0.8)*P.edgeWear*(0.12+wearGate*1.35);
        const chipField=fineWear*0.42+wear*0.34+ragged*0.20+edgeBias*1.05+sc*0.30*P.scratch;
        const thr1=0.99-P.chip*0.42;      // paint -> primer
        const thr2=1.10-P.chip*0.44;      // primer -> bare metal
        const toPrimer=smoothstep(thr1-0.012,thr1+0.012,chipField);
        const toMetal=smoothstep(thr2-0.012,thr2+0.012,chipField);

        // base colour
        const fade=1-P.fade*0.35*(0.4+wear*0.9);
        const mott=1+(fbm(u,v,16,3,seed+83)-0.5)*0.10;
        const panelTint=1+(panelId-0.5)*0.13;
        let r=paint[0]*fade*mott*panelTint,g2=paint[1]*fade*mott*panelTint,b=paint[2]*fade*mott*panelTint;
        const mg=0.9+fineWear*0.25;
        r=lerp(r,primer[0]*mg,toPrimer);g2=lerp(g2,primer[1]*mg,toPrimer);b=lerp(b,primer[2]*mg,toPrimer);
        r=lerp(r,metal[0]*mg,toMetal);g2=lerp(g2,metal[1]*mg,toMetal);b=lerp(b,metal[2]*mg,toMetal);
        // bright scratch cores expose metal
        const scM=clamp(sc*1.4-0.25,0,1)*P.scratch;
        r=lerp(r,metal[0]*1.05,scM*0.8);g2=lerp(g2,metal[1]*1.05,scM*0.8);b=lerp(b,metal[2]*1.05,scM*0.8);
        // grime: streaks + dirt collecting along seams
        const dirt=clamp(st*1.1,0,1)*P.streak+nearSeam*P.grime*0.55;
        const dcol=0.34+fineWear*0.12;
        r=lerp(r,r*dcol,clamp(dirt,0,0.85));g2=lerp(g2,g2*dcol*1.03,clamp(dirt,0,0.85));b=lerp(b,b*dcol*0.93,clamp(dirt,0,0.85));

        A[i*3]=r;A[i*3+1]=g2;A[i*3+2]=b;

        // metallic
        const met=clamp(lerp(P.metalness,1,toMetal)+scM*0.5,0,1);
        MET[i]=met*255;

        // roughness
        let rough=P.rPaint+(fbm2(u,v,48,12,3,seed+97)-0.5)*0.10;
        rough=lerp(rough,P.rMetal,toMetal);
        rough=lerp(rough,P.rPaint*1.15,toPrimer*0.6);
        rough=lerp(rough,clamp(rough+0.28,0,1),clamp(dirt,0,1));      // grime kills the gloss
        rough=lerp(rough,clamp(P.rMetal*0.7,0.04,1),scM*0.7);          // fresh scratches are shiny
        rough=lerp(rough,clamp(rough+0.12,0,1),P.fade*0.5*wear);       // chalked paint
        RGH[i]=clamp(rough,0.02,1)*255;

        AOc[i]=clamp(1-dirt*P.grime*0.35,0,1)*255;                     // seeded, refined in pass 2
      }
    }
    if(y<S){
      io.progress(y/S*0.55);
      setTimeout(pass1,0);
    }else{
      io.progress(0.6);
      setTimeout(pass2,0);
    }
  }

  function pass2(){
    // AO from height: compare each texel against two wrapped box-blurs of the height field
    const r1=Math.max(1,Math.round(S*0.004)),r2=Math.max(3,Math.round(S*0.022));
    const b1=boxBlurWrap(HGT,S,r1),b2=boxBlurWrap(HGT,S,r2);
    const aoScale=1/Math.max(1e-5,seamD*0.75);
    for(let i=0;i<S*S;i++){
      const c1=clamp((b1[i]-HGT[i])*aoScale*2.2,0,1);
      const c2=clamp((b2[i]-HGT[i])*aoScale*1.7,0,1);
      const occ=clamp(c1*0.55+c2*0.85,0,1)*P.aoStr;
      AOc[i]=clamp((AOc[i]/255)*(1-occ),0,1)*255;
    }
    io.progress(0.8);

    // normals from height, wrapped
    hMin=Infinity;hMax=-Infinity;
    for(let i=0;i<S*S;i++){const h=HGT[i];if(h<hMin)hMin=h;if(h>hMax)hMax=h;}
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;
    const gy=P.flipG?-1:1;
    for(let yy=0;yy<S;yy++){
      const yp=((yy+1)%S)*S,ym=((yy-1+S)%S)*S,y0=yy*S;
      for(let xx=0;xx<S;xx++){
        const xp=(xx+1)%S,xm=(xx-1+S)%S;
        const dhdu=(HGT[y0+xp]-HGT[y0+xm])*0.5*S*P.normalStr;
        const dhdv=(HGT[yp+xx]-HGT[ym+xx])*0.5*S*P.normalStr;
        let nx=-dhdu,ny=-dhdv*gy,nz=1;
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;nz*=inv;
        const i=(y0+xx)*3;
        NRM[i]=(nx*0.5+0.5)*255;NRM[i+1]=(ny*0.5+0.5)*255;NRM[i+2]=(nz*0.5+0.5)*255;
      }
    }
    io.progress(1);
    io.done({A:A,RGH:RGH,MET:MET,AO:AOc,NRM:NRM,HGT:HGT,hMin:hMin,hMax:hMax});
  }

  io.progress(0.02);
  setTimeout(pass1,0);
}

/* ============================ mode definition ============================ */

Forge.register({
  id:"plating",
  label:"Plating",
  group:"Panels",
  threadable:true,
  blurb:"Seamless riveted aircraft skin",
  title:'Panel <em>Forge</em>',
  tagline:"Seamless riveted skin · PBR set · PNG",
  actionLabel:"Forge texture",
  busyLabel:"Forging…",
  seamless:true,
  backdrops:false,
  preview:{gain:3.0,amb:1.1,specK:0.55,skyLo:[0.16,0.19,0.23],skyHi:[0.34,0.38,0.44]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
    {key:"ao",label:"AO"},{key:"height",label:"Height"},{key:"orm",label:"ORM packed"}
  ],

  presets:[
    {id:"warbird",label:"Weathered warbird",set:{rows:4,colsMin:2,colsMax:4,jitter:.35,seamW:.6,seamD:.5,panelWarp:.4,overlap:.5,rivStyle:"dome",rivSpace:.026,rivSize:.45,rivH:.55,rivWobble:.2,rivDouble:false,rivField:true,grain:.4,dents:.5,normalStr:1,aoStr:.8,chip:.4,edgeWear:.6,scratch:.4,streak:.45,grime:.6,fade:.4,rPaint:.6,rMetal:.3,metalness:0,cPaint:"#5f6a63",cPrimer:"#8d9440",cMetal:"#b6b9bd"}},
    {id:"airliner",label:"Clean airliner",set:{rows:3,colsMin:2,colsMax:3,jitter:.15,seamW:.45,seamD:.3,panelWarp:.15,overlap:.2,rivStyle:"flush",rivSpace:.02,rivSize:.35,rivH:.25,rivWobble:.05,rivDouble:true,rivField:false,grain:.2,dents:.25,normalStr:.8,aoStr:.55,chip:.05,edgeWear:.15,scratch:.12,streak:.15,grime:.3,fade:.1,rPaint:.28,rMetal:.22,metalness:0,cPaint:"#e8e9ea",cPrimer:"#8d9440",cMetal:"#c3c6ca"}},
    {id:"bare",label:"Bare aluminium",set:{rows:5,colsMin:2,colsMax:5,jitter:.4,seamW:.55,seamD:.45,panelWarp:.45,overlap:.6,rivStyle:"mixed",rivSpace:.024,rivSize:.42,rivH:.5,rivWobble:.25,rivDouble:false,rivField:true,grain:.6,dents:.5,normalStr:1.1,aoStr:.75,chip:1,edgeWear:.7,scratch:.55,streak:.3,grime:.5,fade:0,rPaint:.35,rMetal:.32,metalness:1,cPaint:"#b9bcc0",cPrimer:"#a9adb1",cMetal:"#b9bcc0"}},
    {id:"hulk",label:"Derelict hulk",set:{rows:6,colsMin:2,colsMax:6,jitter:.6,seamW:.8,seamD:.75,panelWarp:.7,overlap:.75,rivStyle:"dome",rivSpace:.03,rivSize:.5,rivH:.6,rivWobble:.5,rivDouble:true,rivField:true,grain:.7,dents:.85,normalStr:1.5,aoStr:.95,chip:.75,edgeWear:.9,scratch:.7,streak:.8,grime:.9,fade:.7,rPaint:.85,rMetal:.55,metalness:0,cPaint:"#6b6152",cPrimer:"#8a6a33",cMetal:"#9a9186"}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:Forge.sizes("square")},
      {id:"seed",type:"seed",value:1947}
    ]},
    {title:"Panel layout",open:true,rows:[
      {id:"rows",label:"Rows across tile",min:1,max:10,step:1,value:4},
      {id:"colsMin",label:"Panels per row (min)",min:1,max:8,step:1,value:2},
      {id:"colsMax",label:"Panels per row (max)",min:1,max:8,step:1,value:4},
      {id:"jitter",label:"Seam jitter",min:0,max:1,step:0.01,value:0.35},
      {id:"seamW",label:"Seam width",min:0.1,max:3,step:0.05,value:0.5},
      {id:"seamD",label:"Seam depth",min:0,max:1,step:0.01,value:0.5},
      {id:"panelWarp",label:"Panel misalignment",min:0,max:1,step:0.01,value:0.35},
      {id:"overlap",label:"Lap-joint step",min:0,max:1,step:0.01,value:0.45}
    ]},
    {title:"Rivets",open:true,rows:[
      {id:"rivStyle",type:"select",label:"Head type",value:"dome",options:[
        ["dome","Universal / dome"],["flush","Flush countersunk"],["mixed","Mixed"],["none","None"]]},
      {id:"rivSpace",label:"Pitch",min:0.008,max:0.08,step:0.001,value:0.026},
      {id:"rivSize",label:"Head diameter",min:0.15,max:1,step:0.01,value:0.45},
      {id:"rivH",label:"Head height",min:0,max:1,step:0.01,value:0.5},
      {id:"rivWobble",label:"Pitch irregularity",min:0,max:1,step:0.01,value:0.15},
      {type:"checks",items:[
        {id:"rivDouble",label:"Double rivet rows on seams",value:false},
        {id:"rivField",label:"Field rivets inside panels",value:true}]}
    ]},
    {title:"Surface",rows:[
      {id:"grain",label:"Sheet grain",min:0,max:1,step:0.01,value:0.35},
      {id:"dents",label:"Oil-canning / dents",min:0,max:1,step:0.01,value:0.3},
      {id:"normalStr",label:"Normal strength",min:0.1,max:3,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:0.75},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]},
    {title:"Paint & wear",rows:[
      {type:"colors",label:"Paint · primer · metal",items:[
        {id:"cPaint",value:"#5f6a63"},{id:"cPrimer",value:"#8d9440"},{id:"cMetal",value:"#b6b9bd"}]},
      {id:"chip",label:"Chipping",min:0,max:1,step:0.01,value:0.35},
      {id:"edgeWear",label:"Edge & rivet wear",min:0,max:1,step:0.01,value:0.55},
      {id:"scratch",label:"Scratches",min:0,max:1,step:0.01,value:0.35},
      {id:"streak",label:"Streaks & leaks",min:0,max:1,step:0.01,value:0.35},
      {id:"grime",label:"Grime in seams",min:0,max:1,step:0.01,value:0.55},
      {id:"fade",label:"Sun fade",min:0,max:1,step:0.01,value:0.3},
      {id:"rPaint",label:"Paint roughness",min:0.05,max:1,step:0.01,value:0.55},
      {id:"rMetal",label:"Metal roughness",min:0.05,max:1,step:0.01,value:0.3},
      {id:"metalness",label:"Painted metalness",min:0,max:1,step:0.01,value:0}
    ]}
  ],

  /* a maximum below the minimum would silently produce no panels */
  derive:function(P,ui){
    if(P.colsMax<P.colsMin)ui.set("colsMax",P.colsMin);
  },

  size:function(P){const S=P.size|0;return {w:S,h:S};},
  build:build,

  fileBase:function(P,W){return "panel_"+(P.seed|0)+"_"+W;},

  readme:function(P,info){
    const range=(info.hMax-info.hMin).toFixed(5);
    return ["Texture Forge · plating — seamless riveted aircraft skin",
      "",
      "Seed: "+(P.seed|0)+"   Resolution: "+info.W+"x"+info.H+"   Tiling: seamless in both axes",
      "",
      "basecolor.png  sRGB albedo. Import as sRGB / colour data.",
      "normal.png     Tangent-space normal, "+info.normalNote+". Import as non-colour / linear.",
      "roughness.png  Linear grey, 0 = mirror, 1 = fully rough.",
      "metallic.png   Linear grey, 0 = dielectric paint, 1 = bare metal.",
      "ao.png         Linear grey ambient occlusion.",
      "height.png     Linear grey displacement. 0-1 maps to a height range of "+range+
        " in tile-width units, i.e. multiply by "+range+" x (real tile size) for true displacement.",
      "height16.png   The same height field at 16 bits; use it for displacement.",
      "orm.png        Packed: R = AO, G = roughness, B = metallic (glTF/Unreal style).",
      "",
      "Normal strength was baked at "+P.normalStr.toFixed(2)+"x."].join("\n");
  }
});

})();
