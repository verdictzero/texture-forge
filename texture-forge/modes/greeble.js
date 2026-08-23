/* =====================================================================
   MODE: greeble — machined surface clutter
   =====================================================================
   A base plate covered in a field of extruded blocks: the fine mechanical
   detail that makes a hull, a machine bay or a reactor face read as built
   rather than moulded. Blocks sit at a small number of quantised heights,
   separated by a gap that shows the plate underneath, with chamfered
   edges — three things that together are the difference between greebling
   and lumpy noise.

   THREE THINGS STACK HERE, and the stacking is the point:

     tiers     a block can carry a smaller plate on top of it, and that
               plate another one again, each clipped so it sits wholly on
               its host. Three tiers is the difference between a panel and
               a machine.
     shapes    each top face takes at most one shape, drawn from eleven —
               louvred vent, round port, recessed pocket, stacked cap,
               heat-sink fins, hex boss, perforated grille, stepped pad,
               bolted hatch, drum and wedge — chosen by weight rather than
               by a chain, so no shape starves the ones after it.
     conduit   routed, not ruled. A walker starts on a coarse lattice, runs
               a random number of cells, turns ninety degrees and goes
               again; several walkers share the lattice, so runs meet at
               real tees and crosses, bend through elbows, carry couplings
               and clamps, and finish on a capped stub.

   Corner bolts and an indicator lamp are independent of the shape, and
   every one of them is skipped on a face too small to hold it. Conduit
   passes over the low blocks and behind the tall ones, which is what stops
   the pipes reading as decals.

   Nearly all of the character is in HEIGHT here, the exact opposite of the
   hull mode next door: this one wants displacement or at least a strong
   normal, and the colour map is mostly just dirt.

   The carving comes from modes/lib/quilt.js, shared with the hull mode.
   Tiles seamlessly in both axes.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      hashi=Forge.hashi,fbm=Forge.fbm,mulberry32=Forge.mulberry32,
      hex2rgb=Forge.hex2rgb,boxBlurWrap=Forge.blurWrap;

let P={};

/* How much finer each tier is than the base quilt. These are CUMULATIVE, not
   per-step: tier 2 must be finer than tier 1 by enough that its plate is a
   plate on a plate rather than a plate the same size as the one under it, which
   the host's own inset would then clip away to nothing. */
const TIERK=[1,1.9,3.4,5.8];

/* distance to the nearest multiple of p — used along a pipe run for its clamps */
function edgeDist(t,p){const f=t/p;return Math.abs(f-Math.round(f))*p;}

/* ============================ the conduit network ============================
   Conduit is ROUTED rather than ruled. A walker starts at a node of an Ng x Ng
   lattice, lays a random number of cells in one direction, turns ninety degrees
   and goes again, until its length is spent; several walkers share the lattice,
   so where two runs meet at a node the meeting is a real tee or cross. The
   lattice is on the torus, so every route wraps with it.

   Only the EDGES are stored, one byte each, which is what keeps the lookup O(1)
   per texel: the nearest horizontal run can only be on the nearest lattice ROW
   and the nearest vertical run on the nearest COLUMN, provided no pipe is
   fatter than half the lattice spacing. That is enforced where the radii are
   chosen, and the fittings — which are fatter — are looked up against the four
   corners of the cell the texel sits in instead. */
function buildPipes(o){
  const N=o.n,rng=mulberry32((o.seed|0)*2654435761+31);
  const HE=new Uint8Array(N*N),VE=new Uint8Array(N*N);   // route id + 1; 0 = bare
  const deg=new Uint8Array(N*N),nodeG=new Uint8Array(N*N);
  nodeG.fill(255);                                       // gauge 0 is the FATTEST pipe
  const gauge=[];
  const DX=[1,0,-1,0],DY=[0,1,0,-1];
  const wrap=k=>((k%N)+N)%N;
  for(let r=0;r<o.routes&&r<250;r++){
    const id=r+1,g=Math.floor(rng()*o.gauges);
    gauge.push(g);
    let i=Math.floor(rng()*N),j=Math.floor(rng()*N),d=Math.floor(rng()*4);
    let budget=Math.max(3,Math.round(N*(0.8+rng()*1.7)));
    let stuck=0;
    while(budget>0&&stuck<8){
      let run=1+Math.floor(rng()*o.maxRun),moved=0;
      while(run>0&&budget>0){
        const dx=DX[d],dy=DY[d];
        let ei;
        if(dy===0){ei=j*N+(dx>0?i:wrap(i-1));if(HE[ei])break;HE[ei]=id;}
        else      {ei=(dy>0?j:wrap(j-1))*N+i;if(VE[ei])break;VE[ei]=id;}
        let k=j*N+i;
        if(deg[k]<255)deg[k]++;if(g<nodeG[k])nodeG[k]=g;
        i=wrap(i+dx);j=wrap(j+dy);
        k=j*N+i;
        if(deg[k]<255)deg[k]++;if(g<nodeG[k])nodeG[k]=g;
        run--;budget--;moved++;
      }
      stuck=moved?0:stuck+1;
      d=(d+(rng()<0.5?1:3))&3;                             // ninety degrees, either way
    }
  }
  /* a fitting is sized off the fattest run reaching its node; bare nodes are
     never looked at, but leaving 255 in them would index off the radius table */
  for(let k=0;k<N*N;k++)if(nodeG[k]===255)nodeG[k]=0;
  return {n:N,HE:HE,VE:VE,deg:deg,nodeG:nodeG,gauge:gauge};
}

/* ============================ the generator ============================ */

function build(params,io){
  P=params;
  const S=io.W,seed=P.seed|0,N=S*S;
  const T=Math.max(0.1,+P.tileM||2);
  const MM=0.001/T;                                // millimetres, in tile units

  const A=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N);
  const MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N);
  const EMI=new Uint8ClampedArray(N);
  const NRM=new Uint8ClampedArray(N*3);
  const HGT=new Float32Array(N);
  let hMin=0,hMax=1;

  const metal=hex2rgb(P.cMetal),dark=hex2rgb(P.cDark),
        accent=hex2rgb(P.cAccent),lampC=hex2rgb(P.cLamp);

  const px=1/S,aa=px*0.7;
  const gapH=Math.max(P.gap*MM*0.5,px*0.5);        // half the gap between blocks
  const bev=Math.max(P.bevel*MM,aa);               // chamfer, never under a texel
  const blockH=P.blockH*MM;
  const levels=Math.max(2,P.levels|0);
  const capH=blockH*0.34,pocketD=blockH*0.30,ventD=blockH*0.26;
  const collarH=blockH*0.16,boreD=blockH*0.45;
  const boltR=Math.max(P.boltD*MM*0.5,aa*1.2),boltH=P.boltD*MM*0.42;
  const lampR=Math.max(P.boltD*MM*0.8,aa*1.6);
  const slotPitch=Math.max(P.gap*MM*3.4,px*3);

  /* ---- the block field, and the plates stacked on top of it ---- */
  const rowsN=Math.max(1,P.rows|0);
  const tiers=clamp(P.tiers|0,1,4);
  const TQ=[Quilt.build({rows:rowsN,colsMin:P.colsMin|0,colsMax:P.colsMax|0,
                         split:P.subdiv,depth:P.subdepth|0,
                         minW:6*px,minH:6*px,seed:seed})];
  for(let t=1;t<tiers;t++){
    const k=TIERK[t];
    TQ.push(Quilt.build({rows:Math.max(2,Math.round(rowsN*k)),
                         colsMin:Math.max(1,Math.round((P.colsMin|0)*k)),
                         colsMax:Math.max(1,Math.round((P.colsMax|0)*k)),
                         split:P.subdiv*0.55,depth:Math.max(0,(P.subdepth|0)-1),
                         minW:5*px,minH:5*px,seed:seed+7717*t}));
  }
  const REC=[Quilt.record(),Quilt.record(),Quilt.record(),Quilt.record()];

  /* ---- shape weights: one cumulative table, built once ---- */
  const SW=[P.vents,P.ports,P.pockets,P.caps,P.fins,P.hexb,P.grille,P.steps,P.hatch,P.drum,P.wedge];
  let swTot=0;
  for(let i=0;i<SW.length;i++){swTot+=Math.max(0,SW[i]);SW[i]=swTot;}

  /* ---- conduit ---- */
  const Ng=clamp(P.pipeGrid|0,2,64);
  const rCap=0.38/Ng;                              // half the lattice pitch, less a margin
  const R0=Math.min(P.pipeD*MM*0.5,rCap);
  const nGauge=clamp(P.pipeGauge|0,1,3);
  const RAD=[R0,R0*0.68,R0*0.45];
  const pipeOn=P.pipes>0&&R0>px;
  const pipeSeat=blockH*clamp(+P.pipeRise,0,2);    // on standoffs, not lying on the plate
  const PN=pipeOn?buildPipes({n:Ng,seed:seed+601,gauges:nGauge,
                              routes:Math.max(1,Math.round(P.pipes*Ng*0.75)),
                              maxRun:Math.max(1,P.pipeRun|0)}):null;
  /* the clamp pitch has to divide the tile exactly or the last collar before
     the edge is cut in half and the run does not wrap */
  const clampPitch=1/(Ng*2);
  const fitCap=0.85/Ng;                            // a fitting may not out-reach the cell check

  const band=Math.max(4,Math.round(65536/S));
  let y=0;

  function pass1(){
    const end=Math.min(S,y+band);
    for(;y<end;y++){
      const v=(y+0.5)/S;
      for(let x=0;x<S;x++){
        const u=(x+0.5)/S,i=y*S+x;

        /* ---------------- tier 0: the block itself ---------------- */
        Quilt.locate(TQ[0],u,v,REC[0]);
        const r0=REC[0];

        /* a block may have one corner clipped at forty-five degrees. That is a
           silhouette change, so it goes into the edge distance itself and every
           gap, bevel and inset downstream follows it for free. */
        let dE0=r0.dEdge;
        if(P.cutCorner>0&&Quilt.rand(TQ[0],r0,331)<P.cutCorner){
          const cq=Quilt.rand(TQ[0],r0,337)*4|0;
          const cx=((cq&1)?1-r0.lu:r0.lu)*r0.w,cy=((cq&2)?1-r0.lv:r0.lv)*r0.h;
          const cut=(r0.w<r0.h?r0.w:r0.h)*(0.20+Quilt.rand(TQ[0],r0,341)*0.28);
          const dc=(cx+cy-cut)*0.70710678;
          if(dc<dE0)dE0=dc;
        }

        /* levels are quantised: a continuous height per block reads as a
           crumpled sheet, a handful of discrete heights reads as machined */
        const lvl=Math.floor(Quilt.rand(TQ[0],r0,131)*levels)/(levels-1);
        const sunk=Quilt.rand(TQ[0],r0,197)<P.sunk;
        const plate=smoothstep(gapH,gapH+bev,dE0);   // 0 in the gap, 1 on the block
        let h=(sunk?-blockH*lvl*0.55:blockH*lvl)*plate;
        let onTop=plate;

        /* ---------------- tiers: plates stacked on the block ----------------
           A sub-plate is clipped by its host's own inner mask, so it can never
           overhang the thing it is standing on, and each tier is a fraction of
           the height of the one below it. The topmost plate present is the one
           that carries the shape, the bolts and the lamp. */
        let fq=TQ[0],fr=r0,fp=plate,fdE=dE0,fw=r0.w,fh=r0.h;
        let step=blockH,subGap=0;
        for(let t=1;t<tiers;t++){
          const Q=TQ[t];
          Quilt.locate(Q,u,v,REC[t]);
          const rt=REC[t];
          if(Quilt.rand(Q,rt,401)>=P.tierDens)break;
          const hostShort=fw<fh?fw:fh;
          const seat=Math.max(hostShort*0.13,bev*1.4);
          const room=smoothstep(seat,seat+bev,fdE);
          const pm=smoothstep(gapH,gapH+bev,rt.dEdge)*room;
          if(pm<=0.02){subGap=Math.max(subGap,room);break;}
          step*=P.tierFall;
          const lv2=Math.floor(Quilt.rand(Q,rt,409)*levels)/(levels-1);
          /* a tier can go DOWN as readily as up — a bay machined into the block
             is as much a layer as a plate bolted onto it, and it gives the
             shapes somewhere to sit below the face around them */
          const bay=Quilt.rand(Q,rt,413)<P.sunk*0.8;
          h+=pm*step*(0.30+lv2*0.70)*(bay?-0.55:1);
          fq=Q;fr=rt;fp=pm;fdE=rt.dEdge;fw=rt.w;fh=rt.h;
          if(bay)subGap=Math.max(subGap,pm*0.5);else onTop=Math.max(onTop,pm);
        }

        const fshort=fw<fh?fw:fh,flong=fw<fh?fh:fw;

        /* ---------------- one shape per top face ----------------
           The sliders are WEIGHTS, not a chain: a shape at zero never appears,
           and doubling one makes it twice as likely against the rest. Whether
           a face gets a shape at all is the density slider's business. */
        let lampM=0,boreM=0,cutM=0,metalBias=0,rimM=0;
        if(fp>0.02&&fshort>gapH*6&&swTot>0&&Quilt.rand(fq,fr,263)<P.featDens){
          const inset=Math.max(fshort*0.20,bev*1.5);
          const inner=smoothstep(inset,inset+bev,fdE);
          const pick=Quilt.rand(fq,fr,269)*swTot;
          let sh=0;while(sh<SW.length-1&&pick>SW[sh])sh++;
          const along=(fw>=fh)?fr.lv:fr.lu;              // across the short axis
          const cu=(fr.lu-0.5)*fw,cv=(fr.lv-0.5)*fh;

          if(sh===0){                                    /* louvred vent */
            /* louvres are dropped entirely rather than aliased when the slots
               close up; a grey mush of half-texel slots is worse than none */
            const n=Math.max(2,Math.round(fshort/slotPitch));
            if(fshort/n*S>=3){
              const ff=along*n-Math.floor(along*n);
              cutM=inner*(1-smoothstep(0.26,0.33,Math.abs(ff-0.5)));
              h-=cutM*ventD;
            }
          }else if(sh===1){                              /* round port */
            const dr=Math.sqrt(cu*cu+cv*cv),R=fshort*0.32;
            if(R>bev*2.5){
              const collar=smoothstep(R,R-bev,dr);
              boreM=smoothstep(R*0.62,R*0.62-bev,dr);
              h+=collar*collarH*fp-boreM*(collarH+boreD);
              metalBias+=collar*0.2;
            }
          }else if(sh===2){                              /* recessed pocket */
            h-=inner*pocketD;
            boreM=Math.max(boreM,inner*0.55);
          }else if(sh===3){                              /* stacked cap */
            h+=inner*capH;
            onTop=Math.max(onTop,inner);
          }else if(sh===4){                              /* heat-sink fins */
            const n=Math.max(2,Math.round(fshort/(slotPitch*1.15)));
            if(fshort/n*S>=3.5){
              const ff=along*n-Math.floor(along*n);
              const rib=1-smoothstep(0.22,0.30,Math.abs(ff-0.5));
              h+=inner*(capH*0.22+rib*capH*0.95);
              onTop=Math.max(onTop,inner*rib);
              metalBias+=inner*rib*0.25;
            }
          }else if(sh===5){                              /* hex boss */
            const R=fshort*0.34;
            if(R>bev*3){
              /* flat-top hexagon: the half-plane distance in three directions */
              const ax=Math.abs(cu),ay=Math.abs(cv);
              const hexd=Math.max(ax*0.8660254+ay*0.5,ay);
              const boss=smoothstep(R,R-bev,hexd);
              h+=boss*capH*1.15;
              const dish=smoothstep(R*0.46,R*0.46-bev,Math.sqrt(cu*cu+cv*cv));
              h-=dish*capH*0.30;
              boreM=Math.max(boreM,dish*0.6);
              onTop=Math.max(onTop,boss-dish);
              metalBias+=boss*0.4;
            }
          }else if(sh===6){                              /* perforated grille */
            const nx=Math.max(2,Math.round(fw/slotPitch)),ny=Math.max(2,Math.round(fh/slotPitch));
            if(fw/nx*S>=3.5&&fh/ny*S>=3.5){
              const fx=fr.lu*nx-Math.floor(fr.lu*nx),fy=fr.lv*ny-Math.floor(fr.lv*ny);
              const hole=(1-smoothstep(0.22,0.31,Math.abs(fx-0.5)))*
                         (1-smoothstep(0.22,0.31,Math.abs(fy-0.5)));
              cutM=inner*hole;
              h-=cutM*ventD*1.15;
            }
          }else if(sh===7){                              /* stepped pad */
            const n=2+(Quilt.rand(fq,fr,419)*3|0);
            const rise=capH*0.75/n,tread=Math.max((fshort*0.5-inset)/n,bev*1.6);
            for(let k=0;k<n;k++){
              const e=inset+tread*k;
              h+=smoothstep(e,e+bev,fdE)*rise;
            }
            onTop=Math.max(onTop,inner);
            metalBias+=inner*0.2;
          }else if(sh===8){                              /* bolted hatch */
            const dr=Math.sqrt(cu*cu+cv*cv),R=fshort*0.38;
            if(R>bev*4&&R>boltR*4){
              const disc=smoothstep(R,R-bev,dr);
              h+=disc*capH*0.85;
              /* the sealing groove just inside the rim */
              rimM=smoothstep(R*0.90,R*0.84,dr)*(1-smoothstep(R*0.84,R*0.76,dr));
              h-=rimM*capH*0.30;
              if(dr<R*1.02&&dr>R*0.42){
                const nb=6+(Quilt.rand(fq,fr,421)*3|0)*2;   // 6, 8 or 10
                const a=Math.atan2(cv,cu)*nb/6.2831853;
                const fa=(a-Math.floor(a)-0.5)*6.2831853/nb;
                const br=R*0.70;
                const bx=fa*br,by=dr-br;
                const bolt=1-smoothstep(boltR*0.7,boltR,Math.sqrt(bx*bx+by*by));
                h+=bolt*boltH*disc;
                metalBias+=bolt*0.4;
              }
              onTop=Math.max(onTop,disc);
            }
          }else if(sh===9){                              /* drum lying on the face */
            const acr=(fw>=fh)?cv:cu,alo=(fw>=fh)?cu:cv;
            const R=Math.min(fshort*0.34,flong*0.30);
            if(R>bev*3){
              const half=Math.max(flong*0.5-inset-R,0);
              const t=Math.max(0,Math.abs(alo)-half);
              const dr=Math.sqrt(acr*acr+t*t);
              if(dr<R){
                /* the barrel is as wide as the face allows but only as TALL as
                   the block budget allows, or a wide face grows a beach ball */
                const Rz=Math.min(R,capH*1.9);
                const dome=Math.sqrt(1-(dr/R)*(dr/R))*Rz;
                h+=dome*0.95+capH*0.10;
                /* a strap either side of the barrel's centre */
                const bandm=1-smoothstep(R*0.10,R*0.17,Math.abs(Math.abs(alo)-half*0.62));
                h+=bandm*Rz*0.14;
                onTop=Math.max(onTop,1-smoothstep(R*0.55,R*0.85,dr));
                metalBias+=0.25;
              }
            }
          }else{                                         /* wedge */
            const dirw=Quilt.rand(fq,fr,423)<0.5;
            const t=dirw?fr.lu:fr.lv;
            const ramp=Quilt.rand(fq,fr,427)<0.5?t:1-t;
            h+=inner*capH*(0.18+1.05*smoothstep(0.12,0.88,ramp));
            onTop=Math.max(onTop,inner);
          }
        }

        /* bolts and lamp are independent of the shape above */
        if(fp>0.02&&fshort>gapH*6){
          if(Quilt.rand(fq,fr,283)<P.bolts&&fshort>boltR*7){
            const bi=boltR*2.1;
            const ddu=fr.du-bi,ddv=fr.dv-bi;             // all four corners at once
            const dd=Math.sqrt(ddu*ddu+ddv*ddv);
            const bolt=1-smoothstep(boltR*0.7,boltR,dd);
            h+=bolt*boltH*fp;
            metalBias+=bolt*0.35;
          }
          if(Quilt.rand(fq,fr,293)<P.lamps&&fshort>lampR*8){
            const lx=Quilt.rand(fq,fr,311)<0.5?0.22:0.78;
            const ly=Quilt.rand(fq,fr,313)<0.5?0.22:0.78;
            const dxl=(fr.lu-lx)*fw,dyl=(fr.lv-ly)*fh;
            const drl=Math.sqrt(dxl*dxl+dyl*dyl);
            lampM=(1-smoothstep(lampR*0.62,lampR*0.78,drl))*fp;
            const bez=(1-smoothstep(lampR*1.2,lampR*1.4,drl))*fp;
            h-=bez*boltH*0.32;                           // the bezel is let into the face
            h+=lampM*boltH*0.45;                         // and the lens domes back out of it
          }
        }

        /* ---------------- routed conduit ---------------- */
        let pipe=0,fit=0,gsel=0;
        if(pipeOn){
          let top=-1e30,mask=0;

          /* horizontal runs live on the nearest lattice row; the run in this
             cell if there is one, otherwise the rounded cap of a run that ends
             at either node of it */
          const jr=Math.round(v*Ng),jw=((jr%Ng)+Ng)%Ng,dv=Math.abs(v-jr/Ng);
          const ic=Math.floor(u*Ng),icw=((ic%Ng)+Ng)%Ng;
          let d=1e9,g=0;
          const eH=PN.HE[jw*Ng+icw];
          if(eH){d=dv;g=PN.gauge[eH-1];}
          else{
            const eL=PN.HE[jw*Ng+((icw+Ng-1)%Ng)];
            if(eL){const du=u-ic/Ng,dd=Math.sqrt(du*du+dv*dv);if(dd<d){d=dd;g=PN.gauge[eL-1];}}
            const eR=PN.HE[jw*Ng+((icw+1)%Ng)];
            if(eR){const du=(ic+1)/Ng-u,dd=Math.sqrt(du*du+dv*dv);if(dd<d){d=dd;g=PN.gauge[eR-1];}}
          }
          if(d<RAD[g]){
            const R=RAD[g];
            let ph=pipeSeat+Math.sqrt(1-(d/R)*(d/R))*R;
            ph+=(1-smoothstep(clampPitch*0.09,clampPitch*0.15,edgeDist(u,clampPitch)))*R*0.15*P.pipeFit;
            if(ph>top){top=ph;mask=1-smoothstep(R*0.86,R,d);gsel=g;}
          }

          /* vertical runs, the same way down the nearest lattice column */
          const ir=Math.round(u*Ng),iw=((ir%Ng)+Ng)%Ng,du2=Math.abs(u-ir/Ng);
          const jc=Math.floor(v*Ng),jcw=((jc%Ng)+Ng)%Ng;
          d=1e9;g=0;
          const eV=PN.VE[jcw*Ng+iw];
          if(eV){d=du2;g=PN.gauge[eV-1];}
          else{
            const eD=PN.VE[((jcw+Ng-1)%Ng)*Ng+iw];
            if(eD){const dvv=v-jc/Ng,dd=Math.sqrt(du2*du2+dvv*dvv);if(dd<d){d=dd;g=PN.gauge[eD-1];}}
            const eU=PN.VE[((jcw+1)%Ng)*Ng+iw];
            if(eU){const dvv=(jc+1)/Ng-v,dd=Math.sqrt(du2*du2+dvv*dvv);if(dd<d){d=dd;g=PN.gauge[eU-1];}}
          }
          if(d<RAD[g]){
            const R=RAD[g];
            let ph=pipeSeat+Math.sqrt(1-(d/R)*(d/R))*R;
            ph+=(1-smoothstep(clampPitch*0.09,clampPitch*0.15,edgeDist(v,clampPitch)))*R*0.15*P.pipeFit;
            if(ph>top){top=ph;mask=1-smoothstep(R*0.86,R,d);gsel=g;}
          }

          /* fittings sit ON a node and are fatter than the pipe, so they are
             looked up against all four corners of the cell rather than against
             the nearest node alone */
          for(let c=0;c<4;c++){
            const ni=ic+(c&1),nj=jc+(c>>1);
            const k=(((nj%Ng)+Ng)%Ng)*Ng+(((ni%Ng)+Ng)%Ng);
            const dg=PN.deg[k];
            if(!dg)continue;
            /* a tee or a cross always gets a body; an elbow or a coupling gets
               one only sometimes, or every joint on the run reads as machined
               out of one billet */
            if(dg<3&&hashi(ni,nj,seed+809)>=P.pipeFit*0.32)continue;
            const R=RAD[PN.nodeG[k]];
            const Rf=Math.min(R*(dg>=3?1.44:(dg===1?1.30:1.22)),fitCap);
            const ddx=u-ni/Ng,ddy=v-nj/Ng,dr=Math.sqrt(ddx*ddx+ddy*ddy);
            if(dr>=Rf)continue;
            const face=1-smoothstep(Rf-bev,Rf,dr);
            const ph=pipeSeat+R*(dg===1?0.95:1.06)*face;
            if(ph>top){top=ph;mask=face;gsel=PN.nodeG[k];}
            if(face>fit)fit=face;
          }

          if(top>h){h=top;pipe=mask;}
          else fit=0;
        }

        /* rolled plate grain, everywhere and tiny */
        h+=(fbm(u,v,90,3,seed+29)-0.5)*blockH*0.035;
        HGT[i]=h;

        /* ---------------- colour ---------------- */
        const shade=0.80+Quilt.rand(fq,fr,151)*0.40;
        let r=metal[0]*shade,g2=metal[1]*shade,b=metal[2]*shade;
        if(Quilt.rand(fq,fr,163)<P.accent*0.5&&fp>0.02){
          const k=0.78*fp;
          r=lerp(r,accent[0],k);g2=lerp(g2,accent[1],k);b=lerp(b,accent[2],k);
        }
        /* the plate between the blocks, and anything cut into a face */
        const recess=clamp((1-plate)*0.9+subGap*0.30+boreM*0.7+cutM*0.85+rimM*0.6,0,1);
        r=lerp(r,dark[0],recess*0.8);g2=lerp(g2,dark[1],recess*0.8);b=lerp(b,dark[2],recess*0.8);
        if(pipe>0){
          const pk=pipe*0.9,ps=0.88+hashi(gsel,7,seed+821)*0.3;
          r=lerp(r,metal[0]*ps*1.06,pk);g2=lerp(g2,metal[1]*ps*1.06,pk);b=lerp(b,metal[2]*ps*1.04,pk);
        }
        if(fit>0){                                       // fittings are a duller casting
          const fk=fit*0.55;
          r=lerp(r,metal[0]*0.80,fk);g2=lerp(g2,metal[1]*0.80,fk);b=lerp(b,metal[2]*0.82,fk);
        }

        /* grime settles in everything that is not a top face */
        const gn=fbm(u,v,5,4,seed+53);
        const dirt=clamp((recess*0.75+(1-onTop)*0.35)*(0.45+gn*0.9),0,1)*P.grime;
        r=lerp(r,r*0.42+7,dirt);g2=lerp(g2,g2*0.43+7,dirt);b=lerp(b,b*0.42+6,dirt);

        /* scuffing works the other way: it lands on what stands proud */
        const sc=clamp(fbm(u,v,34,3,seed+71)*1.4-0.55,0,1)*P.scratch*onTop;
        r=lerp(r,metal[0]*1.25+18,sc*0.6);g2=lerp(g2,metal[1]*1.25+18,sc*0.6);b=lerp(b,metal[2]*1.25+18,sc*0.6);

        let rough=P.rough+(Quilt.rand(fq,fr,173)-0.5)*0.26;
        rough+=dirt*0.30-sc*0.24-metalBias*0.12+fit*0.10;
        let met=P.metalness*(1-dirt*0.55);

        if(lampM>0.004){
          r=lerp(r,lampC[0],lampM);g2=lerp(g2,lampC[1],lampM);b=lerp(b,lampC[2],lampM);
          rough=lerp(rough,0.10,lampM);
          met=lerp(met,0.1,lampM);
          EMI[i]=clamp(lampM,0,1)*255;
        }else EMI[i]=0;

        A[i*3]=r;A[i*3+1]=g2;A[i*3+2]=b;
        RGH[i]=clamp(rough,0.04,1)*255;
        MET[i]=clamp(met,0,1)*255;
        AOc[i]=255;                                       // seeded, refined in pass 2
      }
    }
    if(y<S){io.progress(y/S*0.7);setTimeout(pass1,0);}
    else{io.progress(0.75);setTimeout(pass2,0);}
  }

  function pass2(){
    /* the gaps between blocks are the whole reason this mode has an AO map,
       so the tight radius is weighted at least as hard as the broad one */
    const r1=Math.max(1,Math.round(S*0.004)),r2=Math.max(3,Math.round(S*0.02));
    const b1=boxBlurWrap(HGT,S,r1),b2=boxBlurWrap(HGT,S,r2);
    const aoScale=1/Math.max(1e-7,blockH*0.5);
    for(let i=0;i<N;i++){
      const c1=clamp((b1[i]-HGT[i])*aoScale*1.6,0,1);
      const c2=clamp((b2[i]-HGT[i])*aoScale*1.1,0,1);
      AOc[i]=clamp(1-clamp(c1*0.75+c2*0.6,0,1)*P.aoStr,0,1)*255;
    }
    io.progress(0.9);

    hMin=Infinity;hMax=-Infinity;
    for(let i=0;i<N;i++){const h=HGT[i];if(h<hMin)hMin=h;if(h>hMax)hMax=h;}
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;

    const gy=P.flipG?-1:1;
    for(let yy=0;yy<S;yy++){
      const yp=((yy+1)%S)*S,ym=((yy-1+S)%S)*S,y0=yy*S;
      for(let xx=0;xx<S;xx++){
        const xp=(xx+1)%S,xm=(xx-1+S)%S;
        const dhdu=(HGT[y0+xp]-HGT[y0+xm])*0.5*S*P.normalStr;
        const dhdv=(HGT[yp+xx]-HGT[ym+xx])*0.5*S*P.normalStr;
        let nx=-dhdu,ny=-dhdv*gy;
        const inv=1/Math.sqrt(nx*nx+ny*ny+1);
        nx*=inv;ny*=inv;
        const j=(y0+xx)*3;
        NRM[j]=(nx*0.5+0.5)*255;NRM[j+1]=(ny*0.5+0.5)*255;NRM[j+2]=(inv*0.5+0.5)*255;
      }
    }
    io.progress(1);
    io.done({A:A,RGH:RGH,MET:MET,AO:AOc,NRM:NRM,HGT:HGT,EMI:EMI,hMin:hMin,hMax:hMax});
  }

  io.progress(0.02);
  setTimeout(pass1,0);
}

/* ============================ mode definition ============================ */

Forge.register({
  id:"greeble",
  label:"Greeble",
  blurb:"Machined surface clutter — stacked plates, eleven shapes, routed conduit",
  title:'Greeble <em>Field</em>',
  tagline:"Machined clutter · stacked tiers · routed conduit · seamless",
  actionLabel:"Cut greebles",
  busyLabel:"Cutting…",
  seamless:true,
  previewSize:256,
  preview:{gain:3.0,amb:1.05,specK:0.55,skyLo:[0.14,0.16,0.20],skyHi:[0.31,0.35,0.42]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
    {key:"ao",label:"AO"},{key:"emissive",label:"Emissive"},
    {key:"height",label:"Height"},{key:"orm",label:"ORM packed"}
  ],

  presets:[
    {id:"hullgreeble",label:"Hull greeble — fine",set:{
      tileM:1.2,rows:9,colsMin:5,colsMax:11,subdiv:.65,subdepth:2,
      gap:4,bevel:1.5,levels:4,blockH:16,sunk:.22,cutCorner:.18,
      tiers:2,tierDens:.5,tierFall:.5,
      featDens:.72,vents:.3,ports:.22,pockets:.3,caps:.3,fins:.22,hexb:.2,
      grille:.18,steps:.2,hatch:.16,drum:.12,wedge:.12,
      bolts:.45,boltD:7,lamps:.1,
      pipes:.4,pipeD:16,pipeRise:.7,pipeGrid:10,pipeRun:4,pipeGauge:3,pipeFit:.7,
      accent:.06,grime:.4,scratch:.35,rough:.46,metalness:.9,
      cMetal:"#8d9297",cDark:"#33373b",cAccent:"#9a7c33",cLamp:"#ff7a3c"}},
    {id:"machinebay",label:"Machine bay — coarse",set:{
      tileM:3.2,rows:6,colsMin:3,colsMax:6,subdiv:.5,subdepth:2,
      gap:9,bevel:3,levels:5,blockH:52,sunk:.18,cutCorner:.22,
      tiers:3,tierDens:.55,tierFall:.5,
      featDens:.8,vents:.4,ports:.3,pockets:.25,caps:.3,fins:.3,hexb:.25,
      grille:.25,steps:.25,hatch:.3,drum:.28,wedge:.15,
      bolts:.55,boltD:14,lamps:.16,
      pipes:.85,pipeD:48,pipeRise:.55,pipeGrid:7,pipeRun:3,pipeGauge:3,pipeFit:.85,
      accent:.1,grime:.62,scratch:.4,rough:.55,metalness:.85,
      cMetal:"#7f858a",cDark:"#2b2e31",cAccent:"#b08a1e",cLamp:"#ffb02e"}},
    {id:"reactor",label:"Reactor face — lit",set:{
      tileM:2.4,rows:8,colsMin:4,colsMax:8,subdiv:.6,subdepth:2,
      gap:6,bevel:2,levels:6,blockH:38,sunk:.35,cutCorner:.15,
      tiers:3,tierDens:.6,tierFall:.55,
      featDens:.85,vents:.28,ports:.45,pockets:.28,caps:.2,fins:.35,hexb:.3,
      grille:.3,steps:.2,hatch:.35,drum:.2,wedge:.1,
      bolts:.4,boltD:10,lamps:.55,
      pipes:.6,pipeD:30,pipeRise:.6,pipeGrid:9,pipeRun:2,pipeGauge:3,pipeFit:.9,
      accent:.08,grime:.3,scratch:.2,rough:.38,metalness:.92,
      cMetal:"#6f767d",cDark:"#202428",cAccent:"#7a4a2a",cLamp:"#49d8ff"}},
    {id:"servicepanel",label:"Service panel — shallow",set:{
      tileM:1.6,rows:5,colsMin:2,colsMax:4,subdiv:.35,subdepth:1,
      gap:5,bevel:2,levels:3,blockH:11,sunk:.15,cutCorner:.1,
      tiers:2,tierDens:.4,tierFall:.55,
      featDens:.7,vents:.5,ports:.15,pockets:.4,caps:.1,fins:.15,hexb:.15,
      grille:.3,steps:.15,hatch:.2,drum:.08,wedge:.08,
      bolts:.7,boltD:9,lamps:.05,
      pipes:.2,pipeD:18,pipeRise:.75,pipeGrid:12,pipeRun:5,pipeGauge:2,pipeFit:.5,
      accent:.1,grime:.5,scratch:.5,rough:.6,metalness:.75,
      cMetal:"#96999b",cDark:"#3a3d40",cAccent:"#8c8f93",cLamp:"#66ff9c"}},
    {id:"pipeworks",label:"Pipe works — conduit heavy",set:{
      tileM:2.8,rows:5,colsMin:2,colsMax:5,subdiv:.4,subdepth:1,
      gap:7,bevel:2.5,levels:3,blockH:22,sunk:.3,cutCorner:.2,
      tiers:2,tierDens:.35,tierFall:.5,
      featDens:.55,vents:.25,ports:.35,pockets:.3,caps:.15,fins:.15,hexb:.2,
      grille:.15,steps:.1,hatch:.25,drum:.3,wedge:.1,
      bolts:.35,boltD:11,lamps:.12,
      pipes:1,pipeD:60,pipeRise:.85,pipeGrid:6,pipeRun:2,pipeGauge:3,pipeFit:1,
      accent:.07,grime:.55,scratch:.3,rough:.5,metalness:.88,
      cMetal:"#828a90",cDark:"#2a2e32",cAccent:"#9c6f2a",cLamp:"#ff9d3c"}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:Forge.sizes("square")},
      {id:"tileM",label:"Tile covers",unit:"m",min:0.2,max:16,step:0.1,value:2},
      {type:"readout"},
      {id:"seed",type:"seed",value:2151}
    ]},
    {title:"Block field",open:true,rows:[
      {id:"rows",label:"Block rows",min:2,max:24,step:1,value:7},
      {id:"colsMin",label:"Blocks per row (min)",min:1,max:16,step:1,value:3},
      {id:"colsMax",label:"Blocks per row (max)",min:1,max:16,step:1,value:7},
      {id:"subdiv",label:"Sub-division",min:0,max:1,step:0.01,value:0.55},
      {id:"subdepth",label:"Sub-division depth",min:0,max:4,step:1,value:2},
      {id:"levels",label:"Height levels",min:2,max:8,step:1,value:4},
      {id:"blockH",label:"Tallest block",unit:"mm",min:2,max:150,step:1,value:30},
      {id:"sunk",label:"Recessed blocks",min:0,max:1,step:0.01,value:0.2},
      {id:"cutCorner",label:"Clipped corners",min:0,max:1,step:0.01,value:0.18},
      {id:"gap",label:"Gap between blocks",unit:"mm",min:1,max:40,step:0.5,value:6},
      {id:"bevel",label:"Edge bevel",unit:"mm",min:0.5,max:20,step:0.5,value:2}
    ]},
    {title:"Stacked tiers",open:true,rows:[
      {id:"tiers",label:"Plate tiers",min:1,max:4,step:1,value:2},
      {id:"tierDens",label:"Tier coverage",min:0,max:1,step:0.01,value:0.5},
      {id:"tierFall",label:"Tier height falloff",min:0.2,max:0.9,step:0.01,value:0.5},
      {type:"note",html:"A block can carry a smaller plate, and that plate another one again. "+
        "Each is clipped so it sits wholly on its host, so a sub-plate never overhangs, and "+
        "each is a fraction of the height of the one below. A tier can go <b>down</b> instead "+
        "of up — a bay machined into the block — as often as <i>Recessed blocks</i> says. "+
        "The <b>topmost</b> plate is the one that takes the shape, the bolts and the lamp."}
    ]},
    {title:"Face shapes",open:true,rows:[
      {id:"featDens",label:"Faces carrying a shape",min:0,max:1,step:0.01,value:0.75},
      {id:"vents",label:"Louvred vent",min:0,max:1,step:0.01,value:0.3},
      {id:"ports",label:"Round port",min:0,max:1,step:0.01,value:0.25},
      {id:"pockets",label:"Recessed pocket",min:0,max:1,step:0.01,value:0.3},
      {id:"caps",label:"Stacked cap",min:0,max:1,step:0.01,value:0.3},
      {id:"fins",label:"Heat-sink fins",min:0,max:1,step:0.01,value:0.25},
      {id:"hexb",label:"Hex boss",min:0,max:1,step:0.01,value:0.22},
      {id:"grille",label:"Perforated grille",min:0,max:1,step:0.01,value:0.22},
      {id:"steps",label:"Stepped pad",min:0,max:1,step:0.01,value:0.2},
      {id:"hatch",label:"Bolted hatch",min:0,max:1,step:0.01,value:0.22},
      {id:"drum",label:"Drum",min:0,max:1,step:0.01,value:0.18},
      {id:"wedge",label:"Wedge",min:0,max:1,step:0.01,value:0.12},
      {type:"note",html:"A face takes at most <b>one</b> shape. These eleven are <b>weights</b>, "+
        "not a chain: a shape at zero never appears, and doubling one makes it twice as likely "+
        "against the rest. How many faces get a shape at all is the first slider's job."}
    ]},
    {title:"Fasteners & lamps",rows:[
      {id:"bolts",label:"Corner bolts",min:0,max:1,step:0.01,value:0.45},
      {id:"boltD",label:"Bolt diameter",unit:"mm",min:2,max:40,step:0.5,value:9},
      {id:"lamps",label:"Indicator lamps",min:0,max:1,step:0.01,value:0.2},
      {type:"note",html:"Independent of the shape, and skipped on any face too small to hold them."}
    ]},
    {title:"Conduit",open:true,rows:[
      {id:"pipes",label:"Conduit density",min:0,max:1,step:0.01,value:0.45},
      {id:"pipeGrid",label:"Route grid",unit:"cells",min:2,max:32,step:1,value:9},
      {id:"pipeRun",label:"Cells before a turn",min:1,max:10,step:1,value:3},
      {id:"pipeD",label:"Largest conduit",unit:"mm",min:3,max:200,step:1,value:30},
      {id:"pipeRise",label:"Standoff height",min:0,max:1.6,step:0.02,value:0.6},
      {id:"pipeGauge",label:"Diameters in use",min:1,max:3,step:1,value:3},
      {id:"pipeFit",label:"Couplings & clamps",min:0,max:1,step:0.01,value:0.75},
      {type:"note",html:"Runs are <b>routed</b>: a walker lays a random number of cells, turns "+
        "ninety degrees and goes again. Where two runs meet at a node you get a real tee or "+
        "cross with a cast body; a run that stops gets a capped stub. Conduit passes over the "+
        "low blocks and behind the tall ones."}
    ]},
    {title:"Colour & wear",rows:[
      {type:"colors",label:"Metal · recess · accent · lamp",items:[
        {id:"cMetal",value:"#8a8f94"},{id:"cDark",value:"#31353a"},
        {id:"cAccent",value:"#a3801f"},{id:"cLamp",value:"#ff8a34"}]},
      {id:"accent",label:"Painted blocks",min:0,max:1,step:0.01,value:0.1},
      {id:"grime",label:"Grime in the gaps",min:0,max:1,step:0.01,value:0.45},
      {id:"scratch",label:"Scuffed top faces",min:0,max:1,step:0.01,value:0.35},
      {id:"rough",label:"Base roughness",min:0.05,max:1,step:0.01,value:0.5},
      {id:"metalness",label:"Metalness",min:0,max:1,step:0.01,value:0.88}
    ]},
    {title:"Maps",rows:[
      {id:"normalStr",label:"Normal strength",min:0.1,max:3,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:0.85},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  derive:function(P,ui){
    if(P.colsMax<P.colsMin)ui.set("colsMax",P.colsMin);
  },

  readout:function(P){
    const T=Math.max(0.1,+P.tileM||2),S=P.size|0,pxPerM=S/T;
    const sub=Math.pow(2,P.subdepth|0);
    const tallCm=T/Math.max(1,P.rows|0)*100,shortCm=tallCm/sub;
    const wideCm=T/Math.max(1,P.colsMin|0)*100;
    const narrowCm=T/Math.max(1,P.colsMax|0)*100/sub;
    let m="<b>"+Math.round(pxPerM)+" px/m</b> · "+(1000/pxPerM).toFixed(2)+" mm per texel";
    m+="<br>blocks <b>"+shortCm.toFixed(1)+"–"+tallCm.toFixed(1)+" cm</b> × <b>"+
       narrowCm.toFixed(1)+"–"+wideCm.toFixed(1)+" cm</b> · up to <b>"+(+P.blockH).toFixed(0)+" mm</b> proud";
    const tiers=clamp(P.tiers|0,1,4);
    if(tiers>1){
      let tot=+P.blockH,step=+P.blockH;
      for(let t=1;t<tiers;t++){step*=P.tierFall;tot+=step;}
      m+="<br>"+tiers+" tiers stack to <b>"+tot.toFixed(0)+" mm</b> where they all land";
      /* the top tier is its own quilt, one sub-division shallower than the base
         one — not the base quilt cut down again, so it does not compound */
      const k=TIERK[tiers-1],tsub=Math.pow(2,Math.max(0,(P.subdepth|0)-1));
      const tRows=Math.max(2,Math.round(Math.max(1,P.rows|0)*k))*tsub;
      const tCols=Math.max(1,Math.round(Math.max(1,P.colsMax|0)*k))*tsub;
      const finePx=Math.min(T/tRows,T/tCols)*pxPerM;
      if(finePx<6)m+="<br><b>top tier about "+finePx.toFixed(1)+" px</b> — drop a tier or raise the resolution";
    }
    const smallPx=Math.min(narrowCm,shortCm)/100*pxPerM;
    if(smallPx<10)m+="<br><b>smallest block "+smallPx.toFixed(1)+" px</b> — drop the sub-division "+
                     "depth or raise the resolution; the shapes need room";
    const gapPx=P.gap/1000*pxPerM;
    if(gapPx<1.5)m+="<br>gap "+gapPx.toFixed(2)+" px — held at half a texel, so the blocks will merge";
    const boltPx=P.boltD/1000*pxPerM;
    if(P.bolts>0&&boltPx<3)m+="<br>bolts "+boltPx.toFixed(1)+" px — too small to read";
    if(P.pipes>0){
      const Ng=clamp(P.pipeGrid|0,2,64);
      const capMm=0.76/Ng*T*1000;                       // the lattice caps the diameter
      const dMm=Math.min(+P.pipeD,capMm);
      m+="<br>conduit cell <b>"+(T/Ng*100).toFixed(0)+" cm</b> · largest run <b>"+dMm.toFixed(0)+" mm</b>";
      if(dMm<+P.pipeD-0.5)m+=" — capped by the route grid";
      const pipePx=dMm/1000*pxPerM;
      if(pipePx<2.5)m+="<br><b>conduit "+pipePx.toFixed(1)+" px</b> — it will not read; widen it or coarsen the grid";
    }
    return m;
  },

  tileTag:function(){return "tiles ↔ and ↕";},
  sizeTag:function(P){return (+P.tileM||2)+" m";},

  writers:function(B,P){
    const c=hex2rgb(P.cLamp),E=B.EMI;
    return {emissive:function(i,o,k){
      const e=E[i]/255;
      o[k]=c[0]*e;o[k+1]=c[1]*e;o[k+2]=c[2]*e;return 255;
    }};
  },

  /* a tiling material: one tile of it, at the size the mode says it covers */
  plan:function(P){const t=Math.max(0.05,+P.tileM||2);return {w:t,h:t,tile:t,cutout:false};},

  size:function(P){const S=P.size|0;return {w:S,h:S};},
  build:build,

  fileBase:function(P,W){return "greeble_"+(P.seed|0)+"_"+W;},

  readme:function(P,info){
    const T=Math.max(0.1,+P.tileM||2);
    const mm=(info.hMax-info.hMin)*T*1000;
    const Ng=clamp(P.pipeGrid|0,2,64);
    const tiers=clamp(P.tiers|0,1,4);
    return ["Texture Forge · greeble — machined surface clutter",
      "",
      "Seed "+(P.seed|0)+"   Resolution "+info.W+"x"+info.H+"   Seamless in both axes",
      "Tile covers "+T+" m, so one texel is "+(T/info.W*1000).toFixed(2)+" mm.",
      "",
      "This one is a height map with a colour map attached, not the other way round.",
      "Blocks stand up to "+(+P.blockH).toFixed(0)+" mm proud of the plate before the tiers stack on",
      "top of them, which is far more relief than a normal map alone can carry",
      "convincingly at a grazing angle: displace it, or at least use parallax",
      "occlusion, if the surface is ever seen from the side.",
      "",
      tiers+" plate tier(s); conduit routed on a "+Ng+"x"+Ng+" lattice, turning ninety",
      "degrees at most every "+(P.pipeRun|0)+" cell(s), in "+clamp(P.pipeGauge|0,1,3)+" diameter(s).",
      "",
      "basecolor.png  sRGB albedo. Import as sRGB / colour data.",
      "normal.png     Tangent space, "+info.normalNote+". Non-colour.",
      "roughness.png  Linear grey.",
      "metallic.png   Linear grey. Bare metal at "+(+P.metalness).toFixed(2)+", pulled down where grime sits.",
      "ao.png         Linear grey. The gaps between blocks carry most of it.",
      "emissive.png   Indicator lamps in the lamp colour; black elsewhere.",
      "height.png     Linear grey spanning "+mm.toFixed(1)+" mm of real relief",
      "               (0-1 maps to "+(info.hMax-info.hMin).toFixed(6)+" in tile-width units).",
      "height16.png   The same field at 16 bits. Use this for displacement — the block",
      "               levels are quantised, and 8 bits puts visible terracing on them.",
      "orm.png        R = AO, G = roughness, B = metallic.",
      "",
      "Normal strength was baked at "+(+P.normalStr).toFixed(2)+"x."].join("\n");
  }
});

})();
