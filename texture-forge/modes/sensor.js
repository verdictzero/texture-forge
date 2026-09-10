/* =====================================================================
   MODE: sensor — sensor and antenna cluster
   =====================================================================
   The face of a warship's mast, an aircraft's cheek, a satellite bus, a
   ground station: a mounting plate carrying a CLUSTER of apertures that
   all do different jobs. Greeble next door is machined clutter that means
   nothing in particular; this one is clutter that means something, and
   the difference is entirely in whether each piece looks like equipment
   somebody specified.

   THREE THINGS MAKE IT READ AS EQUIPMENT RATHER THAN AS BUMPS:

     bays        the plate is carved into bays and a bay holds ONE device,
                 wholly, inside its own frame. Equipment comes in boxes
                 that bolt to a plate; it does not overlap its neighbour
                 and it does not straddle a seam.
     the fit     a device is chosen by weight AND by whether the bay is
                 the shape it needs. A parabolic dish wants square ground
                 and a blade antenna wants a long strip, so offering
                 either the other's bay is offering a lie — and squashing
                 one to fit is worse. See ASPECT BUCKETS below.
     the harness the runs BETWEEN the devices, which is what a real
                 installation is mostly made of: rectangular waveguide
                 with flanged joints, coax in bundles, at a standoff off
                 the plate, passing behind whatever is taller than they
                 are. Nothing is wired up if the cables are missing.

   TWELVE DEVICES, and each is a real thing rather than a shape:

     aesa      an AESA array face — a TRIANGULAR lattice of radiating
               elements at half-wavelength spacing behind a chamfered
               frame, which is the one detail that separates an active
               array from a perforated sheet. Some get a composite cover.
     dish      a parabolic comms dish: a real paraboloid bowl, a rim, a
               feed boss on struts, a sub-reflector at the focus
     satcom    a flat SATCOM panel — concentric rings of elements
     camera    an electro-optical cluster: several lens bores of
               different diameters, each with a hood and dark glass, and
               a rectangular sensor window beside them
     blade     a blade antenna, tapered along a long thin bay, on a boot
     whip      a whip mast base: a collar and a tapered stub
     dome      a radome: a truncated composite dome on a base flange
     horn      a waveguide horn, flaring out of its flange
     grille    the array's liquid-cooling heat exchanger, louvred
     conn      a bulkhead connector plate with a cable clamp
     warn      a radar-warning receiver: a small faceted aperture
     laser     a designator or rangefinder: a deep bore and a lens

   MATERIALS DO THE OTHER HALF OF THE WORK. The plate is metal; a radome,
   a dome and a dish face are COMPOSITE — dielectric, so metallic goes to
   nothing and roughness up — and a lens is dark glass, smooth and
   specular, which is the same cheat the hull's windows use. Get those
   three wrong and every device is the same grey lump whatever shape it is.

   The bay carving comes from modes/lib/quilt.js, shared with the hull and
   greeble modes. Tiles seamlessly in both axes.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      hashi=Forge.hashi,fbm=Forge.fbm,hex2rgb=Forge.hex2rgb,boxBlurWrap=Forge.blurWrap;

let P={};

/* ============================ the devices ============================

   `fit` is the range of LONG/SHORT the device will accept, so a dish asks
   for something square and a blade for a strip.

   `min` IS MEASURED ON THE FACE, NOT ON THE BAY, and that distinction is
   the difference between the guard working and the guard lying: the frame
   takes a fixed width off every side, so on a small bay most of what the
   bay measures is frame and the face left for the device is a fraction of
   it. Below `min` texels across that face the detail turns to grey mush,
   and a bay of plain plate is the better answer.

   `key` is the id of the weight control that drives it. */
const DEV=[
  {id:"aesa",  key:"wAesa",  label:"AESA array face",  fit:[1,2.4],   min:14},
  {id:"dish",  key:"wDish",  label:"Comms dish",       fit:[1,1.35],  min:16},
  {id:"satcom",key:"wSat",   label:"SATCOM panel",     fit:[1,1.35],  min:15},
  {id:"camera",key:"wCam",   label:"Camera cluster",   fit:[1.25,3],  min:14},
  {id:"blade", key:"wBlade", label:"Blade antenna",    fit:[2.2,12],  min:6},
  {id:"whip",  key:"wWhip",  label:"Whip mast base",   fit:[1,1.6],   min:8},
  {id:"dome",  key:"wDome",  label:"Radome dome",      fit:[1,1.45],  min:10},
  {id:"horn",  key:"wHorn",  label:"Waveguide horn",   fit:[1,1.9],   min:10},
  {id:"grille",key:"wGrille",label:"Cooling grille",   fit:[1,3.5],   min:8},
  {id:"conn",  key:"wConn",  label:"Connector plate",  fit:[1,3.5],   min:9},
  {id:"warn",  key:"wWarn",  label:"Warning receiver", fit:[1,1.8],   min:5},
  {id:"laser", key:"wLaser", label:"Designator",       fit:[1,2.2],   min:7}
];
const DEV_BY={};
for(let i=0;i<DEV.length;i++)DEV_BY[DEV[i].id]=i;

/* ASPECT BUCKETS. Choosing by weight and by fit together needs a cumulative
   table that only holds the devices this bay can take, and building one per
   texel is twelve additions sixteen million times over for an answer that
   only ever takes four values. So the tables are built once, one per band of
   long/short, and a texel does two compares to find its band.

   The bands are the fit ranges' own boundaries, near enough: square, a bit
   oblong, oblong, and a strip. */
const BANDS=[1.0,1.3,1.9,2.6];
function pickTables(P){
  const out=[];
  for(let b=0;b<BANDS.length;b++){
    /* the middle of the band, or well past its start for the open-ended one */
    const a=(b<BANDS.length-1)?(BANDS[b]+BANDS[b+1])*0.5:BANDS[b]*1.6;
    const cum=[],idx=[];
    let tot=0;
    for(let i=0;i<DEV.length;i++){
      const d=DEV[i];
      if(a<d.fit[0]-1e-9||a>d.fit[1]+1e-9)continue;
      const w=Math.max(0,+P[d.key]||0);
      if(w<=0)continue;
      tot+=w;cum.push(tot);idx.push(i);
    }
    out.push({cum:cum,idx:idx,tot:tot});
  }
  return out;
}
const bandOf=a=>a<BANDS[1]?0:(a<BANDS[2]?1:(a<BANDS[3]?2:3));

/* ============================ the harness ============================

   Straight runs on a coarse lattice, one pass of both axes. Straight rather
   than walked — greeble's walker is the right answer for pipework threaded
   through a machine, and the wrong one here: waveguide is rigid, it is cut to
   length and bolted between flanges, and on a mast it goes straight up and
   straight along. So a run is a whole lattice line, which also means the
   nearest one can be found in O(1) per texel off the nearest line in u and
   the nearest in v, with no grid to store beyond one byte a line.

   NO RUN IS FATTER THAN HALF THE LATTICE PITCH, enforced where the radius is
   chosen: two runs on neighbouring lines would otherwise merge into a slab
   and the lookup — which only ever considers the nearest line — would be
   wrong about which one a texel belongs to. */
function harness(o){
  const n=Math.max(2,o.n|0);
  const U=new Uint8Array(n),V=new Uint8Array(n);   // 0 bare, else kind+1
  const gU=new Uint8Array(n),gV=new Uint8Array(n); // gauge
  const lU=new Uint8Array(n),lV=new Uint8Array(n); // layer: which rides over
  for(let k=0;k<n;k++){
    for(let ax=0;ax<2;ax++){
      const A=ax?V:U,G=ax?gV:gU,L=ax?lV:lU;
      if(hashi(k,ax*31+7,o.seed)>=o.dens)continue;
      /* waveguide, coax bundle, or a single fat feeder — the mix is what
         stops a harness reading as one repeated extrusion */
      const r=hashi(k,ax*31+11,o.seed);
      A[k]=(r<o.wgShare?1:(r<o.wgShare+(1-o.wgShare)*0.62?2:3));
      G[k]=Math.floor(hashi(k,ax*31+13,o.seed)*o.gauges);
      L[k]=hashi(k,ax*31+17,o.seed)<0.5?0:1;
    }
  }
  return {n:n,U:U,V:V,gU:gU,gV:gV,lU:lU,lV:lV};
}

/* ============================ the generator ============================ */

function build(params,io){
  P=params;
  const S=io.W,seed=P.seed|0,N=S*S;
  const T=Math.max(0.05,+P.tileM||2);
  const MM=0.001/T;                                // millimetres, in tile units

  const A=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N);
  const MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N);
  const EMI=new Uint8ClampedArray(N);
  const NRM=new Uint8ClampedArray(N*3);
  const HGT=new Float32Array(N);
  let hMin=0,hMax=1;

  const plate=hex2rgb(P.cPlate),dark=hex2rgb(P.cDark),glass=hex2rgb(P.cGlass),
        lampC=hex2rgb(P.cLamp);
  /* the composite: a radome, a dome shell, a dish face and a blade are all
     glass-reinforced plastic, which is a DIELECTRIC — the one material
     decision that keeps them from reading as more painted metal */
  const compo=hex2rgb(P.cRadome);

  const px=1/S,aa=px*0.7;
  const gut=Math.max(P.gutter*MM*0.5,px*0.6);      // half the gap between bays
  const bev=Math.max(P.bevel*MM,aa);
  const R0=P.relief*MM;                            // the tallest thing on the plate
  const frameH=R0*0.16;                            // a bay's own frame, proud of the plate
  const boltR=Math.max(P.boltD*MM*0.5,aa*1.2),boltH=P.boltD*MM*0.4;
  const lampR=Math.max(P.boltD*MM*0.75,aa*1.5);

  /* ---- the bays ---- */
  const BQ=Quilt.build({rows:Math.max(1,P.rows|0),colsMin:P.colsMin|0,colsMax:P.colsMax|0,
                        split:P.subdiv,depth:P.subdepth|0,
                        minW:8*px,minH:8*px,seed:seed});
  const rec=Quilt.record();
  const TAB=pickTables(P);

  /* ---- the harness ---- */
  const Ng=clamp(P.runGrid|0,2,40);
  const rCap=0.40/Ng;
  const runR=Math.min(P.runD*MM*0.5,rCap);
  const nGauge=clamp(P.runGauge|0,1,3);
  const HN=harness({n:Ng,seed:seed+4241,dens:clamp(+P.runDens,0,1),
                    gauges:nGauge,wgShare:clamp(+P.runWg,0,1)});
  const runRise=R0*0.10*Math.max(0,+P.runRise);    // standoff off the plate
  const flangePitch=Math.max(P.runFlange*MM,px*6);
  const gaugeR=g=>runR*(g===0?1:(g===1?0.66:0.44));

  const band=Math.max(4,Math.round(65536/S));
  let y=0;

  function pass1(){
    const end=Math.min(S,y+band);
    for(;y<end;y++){
      const v=(y+0.5)/S;
      for(let x=0;x<S;x++){
        const u=(x+0.5)/S,i=y*S+x;

        Quilt.locate(BQ,u,v,rec);
        const bw=rec.w,bh=rec.h;
        const short=Math.min(bw,bh),long=Math.max(bw,bh);

        /* ---------------- the plate, and the gutter between bays ---------------- */
        let h=0;
        let r=plate[0],g=plate[1],b=plate[2];
        let rough=+P.rough,met=+P.metalness,emi=0;
        /* a faint per-bay tone: rolled plate is not one colour across a mast */
        const tone=1+(Quilt.rand(BQ,rec,101)-0.5)*0.05;
        r*=tone;g*=tone;b*=tone;

        const inGut=1-smoothstep(gut,gut+bev,rec.dEdge);
        h-=inGut*frameH*0.55;

        /* ---------------- which device, if any ----------------
           The face is what is left of the bay once the gutter and the frame
           have taken their cut off every side, and the face is what the
           device has to live on — so it is what the fit is judged against. */
        const fw=Math.max(P.frame*MM,bev*1.6);
        const facePx=(short-2*(gut+fw))*S;
        const bandI=bandOf(long/short);
        const tab=TAB[bandI];
        let dev=-1;
        if(tab.tot>0&&facePx>=4&&Quilt.rand(BQ,rec,103)<P.devDens){
          const pick=Quilt.rand(BQ,rec,107)*tab.tot;
          let k=0;while(k<tab.cum.length-1&&pick>tab.cum[k])k++;
          const cand=tab.idx[k];
          if(facePx>=DEV[cand].min)dev=cand;
        }

        /* the frame: every device sits inside one, and the frame is what makes
           it a box bolted to a plate rather than a shape printed on one */
        let onFrame=0,inFace=0;
        if(dev>=0){
          onFrame=smoothstep(gut,gut+bev,rec.dEdge);
          inFace=smoothstep(gut+fw,gut+fw+bev,rec.dEdge);
          h+=onFrame*frameH;
        }

        if(dev>=0&&inFace>0.002){
          /* local coordinates inside the FACE, in tile units, centred */
          const cu=(rec.lu-0.5)*bw,cv=(rec.lv-0.5)*bh;
          const faceW=Math.max(bw-2*(gut+fw),4*px),faceH=Math.max(bh-2*(gut+fw),4*px);
          const fShort=Math.min(faceW,faceH),fLong=Math.max(faceW,faceH);
          /* along the long axis and across the short one, whichever way the
             bay happens to lie — so a blade and a grille are written once */
          const alo=(bw>=bh)?cu:cv,acr=(bw>=bh)?cv:cu;
          const rDev=Math.sqrt(cu*cu+cv*cv);
          const id=DEV[dev].id;
          const rnd=k=>Quilt.rand(BQ,rec,k);

          if(id==="aesa"){
            /* AN AESA FACE IS A TRIANGULAR LATTICE. Elements sit at half a
               wavelength, staggered row to row, which is what a real active
               array is and what tells it apart from a perforated plate. The
               pitch is a whole division of the face so no element is cut in
               half at the frame. */
            const faceD=R0*0.10;
            h-=inFace*faceD;
            const covered=rnd(109)<P.radome;
            const want=Math.max(fShort*0.085,px*3.2);
            const ny=Math.max(2,Math.round(faceH/want)),nx=Math.max(2,Math.round(faceW/(want*1.1547)));
            const pyy=faceH/ny,pxx=faceW/nx;
            if(pyy*S>=3&&pxx*S>=3){
              const ly=(rec.lv*bh-(gut+fw))/pyy,lx=(rec.lu*bw-(gut+fw))/pxx;
              let dmin=1e9;
              for(let dj=-1;dj<=1;dj++){
                const jr=Math.floor(ly)+dj;
                const off=(((jr%2)+2)%2)?0.5:0;
                const xr=lx-off,ir=Math.round(xr);
                const dx=(xr-ir)*pxx,dy=(ly-(jr+0.5))*pyy;
                const d2=dx*dx+dy*dy;
                if(d2<dmin)dmin=d2;
              }
              const eR=Math.min(pxx,pyy)*0.34;
              const el=(1-smoothstep(eR-bev*0.7,eR,Math.sqrt(dmin)))*inFace;
              if(covered){
                /* under a composite cover the lattice is a ghost, not a relief */
                h+=el*faceD*0.05;
                r=lerp(r,compo[0],inFace*0.93);g=lerp(g,compo[1],inFace*0.93);b=lerp(b,compo[2],inFace*0.93);
                rough=lerp(rough,0.62,inFace*0.9);met=lerp(met,0.04,inFace*0.95);
                r=lerp(r,r*0.97,el*0.5);g=lerp(g,g*0.97,el*0.5);b=lerp(b,b*0.97,el*0.5);
              }else{
                h+=el*faceD*0.5;
                const bk=inFace*(1-el);
                r=lerp(r,dark[0],bk*0.72);g=lerp(g,dark[1],bk*0.72);b=lerp(b,dark[2],bk*0.72);
                rough=lerp(rough,0.34,el*0.8);met=lerp(met,0.96,el*0.8);
                rough=lerp(rough,0.78,bk*0.5);
              }
            }
          }else if(id==="dish"){
            /* A PARABOLOID, not a cone: the depth goes as the square of the
               radius, which is the only profile that reads as a dish when the
               light moves across it. */
            const R=fShort*0.46;
            if(R>bev*4){
              const rim=smoothstep(R+bev,R,rDev);
              const t=clamp(rDev/R,0,1);
              const bowl=rim*(1-smoothstep(R*0.93,R,rDev));
              h+=rim*frameH*0.5;
              h-=bowl*R0*0.55*(1-t*t);
              /* the composite bowl face */
              r=lerp(r,compo[0],bowl*0.9);g=lerp(g,compo[1],bowl*0.9);b=lerp(b,compo[2],bowl*0.9);
              rough=lerp(rough,0.55,bowl*0.85);met=lerp(met,0.05,bowl*0.9);
              /* the feed on its struts, and the sub-reflector at the focus */
              const nS=(rnd(113)<0.5)?3:4;
              const ang=Math.atan2(cv,cu);
              const spoke=Math.abs(Math.sin((ang+rnd(127)*6.283)*nS*0.5));
              const strut=(1-smoothstep(0.03,0.10,spoke))*(1-smoothstep(R*0.92,R,rDev))*
                          smoothstep(R*0.22,R*0.30,rDev);
              h+=strut*R0*0.30;
              met=lerp(met,0.9,strut*0.8);rough=lerp(rough,0.4,strut*0.7);
              r=lerp(r,plate[0]*1.02,strut*0.85);g=lerp(g,plate[1]*1.02,strut*0.85);b=lerp(b,plate[2]*1.02,strut*0.85);
              const feed=1-smoothstep(R*0.20,R*0.20+bev,rDev);
              h+=feed*R0*0.46;
              met=lerp(met,0.95,feed*0.9);rough=lerp(rough,0.3,feed*0.85);
              const throat=1-smoothstep(R*0.09,R*0.09+bev,rDev);
              h-=throat*R0*0.12;
              r=lerp(r,dark[0],throat*0.8);g=lerp(g,dark[1],throat*0.8);b=lerp(b,dark[2],throat*0.8);
            }
          }else if(id==="satcom"){
            /* concentric rings of elements on a flat panel — the other way a
               phased array is laid out, and the one that reads as circular */
            /* ELEMENTS IN RINGS, NOT RINGS. Continuous grooves came out as a
               vinyl record — decorative, and nothing like an array. A ring of
               DISCRETE patches is what a circular phased array is, so each
               ring is divided into as many elements as fit round it at the
               ring spacing, which keeps the patches roughly square whatever
               radius they sit at. */
            const R=fShort*0.46;
            if(R>bev*5){
              const disc=smoothstep(R+bev,R,rDev);
              h-=disc*R0*0.03;
              h+=disc*frameH*0.4;
              const rings=Math.max(2,Math.round(R/Math.max(fShort*0.09,px*4)));
              const rp=R/rings;
              if(rp*S>=4){
                r=lerp(r,dark[0],disc*0.55);g=lerp(g,dark[1],disc*0.55);b=lerp(b,dark[2],disc*0.55);
                rough=lerp(rough,0.78,disc*0.5);
                const k=Math.round(rDev/rp);
                const rr2=k*rp;
                if(k>=1&&rr2<R*0.97){
                  const nk=Math.max(6,Math.round(6.2831853*rr2/rp));
                  const a=Math.atan2(cv,cu)*nk/6.2831853;
                  const dTan=(a-Math.round(a))*6.2831853*rr2/nk;
                  const dRad=rDev-rr2;
                  const eR=rp*0.32;
                  const el=disc*(1-smoothstep(eR-bev*0.7,eR,Math.sqrt(dTan*dTan+dRad*dRad)));
                  h+=el*R0*0.05;
                  met=lerp(met,0.95,el*0.9);rough=lerp(rough,0.32,el*0.85);
                  r=lerp(r,plate[0]*1.03,el*0.85);g=lerp(g,plate[1]*1.03,el*0.85);
                  b=lerp(b,plate[2]*1.03,el*0.85);
                }
              }
              /* the feed hub in the middle, and the rim round the whole face */
              const hub=1-smoothstep(rp*0.5,rp*0.5+bev,rDev);
              h+=hub*R0*0.11;met=lerp(met,0.92,hub*0.85);
              r=lerp(r,plate[0],hub*0.8);g=lerp(g,plate[1],hub*0.8);b=lerp(b,plate[2],hub*0.8);
              const rim=disc*smoothstep(R-bev*2.2,R-bev*0.8,rDev);
              h+=rim*frameH*0.5;
              met=lerp(met,0.92,rim*0.7);
              r=lerp(r,plate[0]*1.04,rim*0.8);g=lerp(g,plate[1]*1.04,rim*0.8);b=lerp(b,plate[2]*1.04,rim*0.8);
            }
          }else if(id==="camera"){
            /* AN ELECTRO-OPTICAL CLUSTER IS SEVERAL APERTURES OF DIFFERENT
               SIZES, because they are different instruments — a wide field, a
               narrow field, a laser channel. One lens repeated is a stereo
               camera; three unequal ones are a targeting turret. */
            /* A HOUSING FIRST. An electro-optical cluster is a BOX with
               apertures in it, and the apertures are a small part of its face
               — so the lenses alone left most of a bay bare, which read as
               lenses printed on a plate. The pad is what they are cut into. */
            const padQ=Math.max(Math.abs(cu)/(faceW*0.5),Math.abs(cv)/(faceH*0.5));
            const pad=(1-smoothstep(0.92,0.98,padQ))*inFace;
            h+=pad*R0*0.16;
            met=lerp(met,0.93,pad*0.5);
            const nL=2+((rnd(131)*3)|0);
            /* the lens row spans the housing rather than huddling in the
               middle of it: the first and last are half a step from the ends */
            const span=fLong*0.80;
            const step=span/nL;
            let best=1e9,bR=0,bK=0;
            for(let k=0;k<nL;k++){
              const c=(k+0.5)*step-span*0.5;
              const rk=Math.min(step*0.42,fShort*0.34)*(0.66+hashi(rec.key,k*7+53,seed)*0.34);
              const dx=alo-c,dy=acr;
              const d=Math.sqrt(dx*dx+dy*dy)-rk;
              if(d<best){best=d;bR=rk;bK=k;}
            }
            if(bR>bev*2.4){
              const hood=1-smoothstep(0,bev,best-bR*0.26);
              h+=hood*pad*R0*0.10;
              met=lerp(met,0.92,hood*0.7);
              const bore=1-smoothstep(0,bev,best);
              h-=bore*R0*0.30;
              /* THE GLASS IS THE SAME CHEAT THE HULL'S WINDOWS USE: dark, very
                 smooth, and metallic on an opaque surface, so it picks up the
                 environment and reads as a lens rather than as a hole. */
              const gl=1-smoothstep(0,bev,best+bR*0.13);
              r=lerp(r,glass[0],gl*0.94);g=lerp(g,glass[1],gl*0.94);b=lerp(b,glass[2],gl*0.94);
              rough=lerp(rough,0.06,gl*0.92);met=lerp(met,0.85,gl*0.9);
              /* the iris ring between the hood and the glass */
              const iris=clamp(bore-gl,0,1);
              r=lerp(r,dark[0],iris*0.8);g=lerp(g,dark[1],iris*0.8);b=lerp(b,dark[2],iris*0.8);
              rough=lerp(rough,0.85,iris*0.7);met=lerp(met,0.1,iris*0.6);
              /* AND A RECTANGULAR SENSOR WINDOW, off to one side of the lens
                 row rather than at the end of it — where it sat before it ran
                 off the edge of its own housing and read as a hole punched
                 through the plate. It gets a rebate of its own, because a
                 window in a box has a frame and a void does not. */
              /* well inside the housing: at a tenth of the face from its edge
                 the window read as touching it, which is a window that has run
                 out of box to sit in */
              const wOff=fShort*0.26;
              const wHalfA=Math.min(span*0.22,fShort*0.26),wHalfC=fShort*0.12;
              const wq=Math.max((Math.abs(alo)-wHalfA)/Math.max(bev,1e-6),
                                (Math.abs(acr-wOff)-wHalfC)/Math.max(bev,1e-6));
              const rebate=(1-smoothstep(1.9,2.6,wq))*pad;
              const win=(1-smoothstep(0,1,wq))*pad;
              if(wHalfC>bev*2&&rebate>0.004){
                h-=clamp(rebate-win,0,1)*R0*0.05;
                h-=win*R0*0.12;
                r=lerp(r,glass[0]*1.1,win*0.92);g=lerp(g,glass[1]*1.1,win*0.92);b=lerp(b,glass[2]*1.1,win*0.92);
                rough=lerp(rough,0.09,win*0.9);met=lerp(met,0.8,win*0.85);
                /* the rebate is MACHINED METAL, not shadow: a dark lip round a
                   dark window is one dark shape, and the frame is what says
                   the window is set into something */
                const lip=clamp(rebate-win,0,1);
                r=lerp(r,r*1.12+16,lip*0.75);g=lerp(g,g*1.12+16,lip*0.75);b=lerp(b,b*1.10+15,lip*0.75);
                rough=lerp(rough,0.34,lip*0.7);met=lerp(met,0.94,lip*0.7);
              }
            }
          }else if(id==="blade"){
            /* a blade antenna: a fin tapered along the bay, on a boot */
            const halfL=fLong*0.42,halfW=Math.min(fShort*0.20,R0*0.10);
            const t=clamp(Math.abs(alo)/Math.max(halfL,1e-6),0,1);
            const prof=Math.sqrt(Math.max(0,1-t*t*t));       // fat root, fine tip
            const blade=(1-smoothstep(0,bev,Math.abs(acr)-halfW*prof))*
                        (1-smoothstep(halfL,halfL+bev,Math.abs(alo)))*inFace;
            const boot=(1-smoothstep(0,bev*1.4,Math.abs(acr)-halfW*1.9))*
                       (1-smoothstep(halfL*0.9,halfL*0.9+bev,Math.abs(alo)))*inFace;
            h+=boot*R0*0.08+blade*R0*0.62*prof;
            met=lerp(met,0.5,blade*0.6);
            rough=lerp(rough,0.5,blade*0.7);
            r=lerp(r,compo[0]*0.82,blade*0.6);g=lerp(g,compo[1]*0.82,blade*0.6);b=lerp(b,compo[2]*0.82,blade*0.6);
            r=lerp(r,dark[0]*1.25,boot*(1-blade)*0.7);g=lerp(g,dark[1]*1.25,boot*(1-blade)*0.7);
            b=lerp(b,dark[2]*1.25,boot*(1-blade)*0.7);
            rough=lerp(rough,0.9,boot*(1-blade)*0.8);met=lerp(met,0.05,boot*(1-blade)*0.8);
          }else if(id==="whip"){
            const R=fShort*0.30;
            if(R>bev*3){
              const collar=1-smoothstep(R,R+bev,rDev);
              h+=collar*R0*0.14;
              met=lerp(met,0.92,collar*0.8);
              const stub=1-smoothstep(R*0.34,R*0.34+bev,rDev);
              h+=stub*R0*0.55;
              rough=lerp(rough,0.35,stub*0.8);
              const boot=clamp(collar-stub,0,1);
              r=lerp(r,dark[0]*1.2,boot*0.6);g=lerp(g,dark[1]*1.2,boot*0.6);b=lerp(b,dark[2]*1.2,boot*0.6);
              rough=lerp(rough,0.9,boot*0.7);met=lerp(met,0.06,boot*0.7);
            }
          }else if(id==="dome"){
            /* a truncated composite dome on a base flange. Truncated because a
               full hemisphere in a height map has a silhouette the normal map
               cannot sell; a dome with a flat crown reads at any angle. */
            const R=fShort*0.44;
            if(R>bev*4){
              const flange=1-smoothstep(R,R+bev,rDev);
              h+=flange*frameH*0.7;
              met=lerp(met,0.9,flange*0.7);
              const Rd=R*0.86;
              const in2=clamp(1-(rDev/Rd)*(rDev/Rd),0,1);
              const shell=1-smoothstep(Rd-bev,Rd,rDev);
              h+=shell*R0*0.72*Math.pow(in2,0.62);
              r=lerp(r,compo[0],shell*0.95);g=lerp(g,compo[1],shell*0.95);b=lerp(b,compo[2],shell*0.95);
              rough=lerp(rough,0.6,shell*0.9);met=lerp(met,0.03,shell*0.95);
              /* the moulding seam round the equator */
              const seam=1-smoothstep(0,bev*1.2,Math.abs(rDev-Rd*0.80));
              h-=seam*shell*R0*0.02;
              r=lerp(r,r*0.9,seam*shell*0.6);g=lerp(g,g*0.9,seam*shell*0.6);b=lerp(b,b*0.9,seam*shell*0.6);
            }
          }else if(id==="horn"){
            /* a pyramidal horn: a rectangular mouth flaring out of a flange,
               so the walls slope in toward the throat */
            const mw=fLong*0.40,mh=fShort*0.38;
            const q=Math.max(Math.abs(alo)/mw,Math.abs(acr)/mh);
            const mouth=1-smoothstep(1,1+bev/Math.max(mh,1e-6),q);
            h+=mouth*R0*0.34;
            /* the bore of it, sloping down to the throat */
            const inner=clamp(1-q/0.88,0,1);
            h-=mouth*R0*0.40*Math.pow(inner,0.8);
            met=lerp(met,0.94,mouth*0.85);
            rough=lerp(rough,0.3,mouth*0.7);
            const thr=1-smoothstep(0.20,0.30,q);
            r=lerp(r,dark[0],thr*0.85);g=lerp(g,dark[1],thr*0.85);b=lerp(b,dark[2],thr*0.85);
            rough=lerp(rough,0.7,thr*0.6);
          }else if(id==="grille"){
            /* the array's heat exchanger. Slots must divide the face or they
               stop short of the frame; below three texels a slot they are
               dropped entirely, because a grey mush of half-texel slots is
               worse than a plain plate. */
            const nsl=Math.max(2,Math.round(fShort/Math.max(fShort*0.10,px*3.2)));
            const pitch=fShort/nsl;
            h-=inFace*R0*0.05;
            if(pitch*S>=3){
              const acs=(bw>=bh)?(rec.lv*bh-(gut+fw)):(rec.lu*bw-(gut+fw));
              const f=acs/pitch-Math.floor(acs/pitch);
              const slot=inFace*(1-smoothstep(0.24,0.33,Math.abs(f-0.5)));
              h-=slot*R0*0.16;
              r=lerp(r,dark[0],slot*0.8);g=lerp(g,dark[1],slot*0.8);b=lerp(b,dark[2],slot*0.8);
              rough=lerp(rough,0.8,slot*0.6);
            }
          }else if(id==="conn"){
            /* a bulkhead connector plate: a row of circular connectors with
               knurled shells, and a clamp where the harness enters */
            const nC=2+((rnd(137)*3)|0);
            const step=fLong/(nC+0.5);
            const cR=Math.min(step*0.34,fShort*0.30);
            h+=inFace*frameH*0.3;
            if(cR>bev*2.2){
              let best=1e9,bi=0;
              for(let k=0;k<nC;k++){
                const c=(k+0.75)*step-fLong*0.5;
                const dx=alo-c,dy=acr;
                const d=Math.sqrt(dx*dx+dy*dy);
                if(d<best){best=d;bi=k;}
              }
              const shell=1-smoothstep(cR,cR+bev,best);
              h+=shell*R0*0.13;
              met=lerp(met,0.95,shell*0.85);rough=lerp(rough,0.38,shell*0.7);
              /* knurling: a ring of fine flutes round the shell */
              const nk=14;
              const ka=Math.atan2(acr,alo-((bi+0.75)*step-fLong*0.5))*nk/6.2831853;
              const kf=ka-Math.floor(ka);
              const knurl=shell*smoothstep(cR*0.62,cR*0.84,best)*(1-smoothstep(0.3,0.42,Math.abs(kf-0.5)));
              h+=knurl*R0*0.012;
              const pin=1-smoothstep(cR*0.52,cR*0.52+bev,best);
              h-=pin*R0*0.06;
              r=lerp(r,dark[0],pin*0.85);g=lerp(g,dark[1],pin*0.85);b=lerp(b,dark[2],pin*0.85);
              rough=lerp(rough,0.75,pin*0.6);met=lerp(met,0.2,pin*0.5);
            }
          }else if(id==="warn"){
            /* a radar-warning receiver: a small faceted aperture, chamfered
               back into the plate on four sides */
            const q=Math.max(Math.abs(cu)/(faceW*0.42),Math.abs(cv)/(faceH*0.42));
            const ap=1-smoothstep(1,1+bev/Math.max(faceH*0.42,1e-6),q);
            h+=ap*frameH*0.55;
            const inn=clamp(1-q/0.9,0,1);
            h-=ap*R0*0.13*inn;
            const eye=1-smoothstep(0.42,0.5,q);
            r=lerp(r,dark[0]*0.8,eye*0.9);g=lerp(g,dark[1]*0.8,eye*0.9);b=lerp(b,dark[2]*0.8,eye*0.9);
            rough=lerp(rough,0.25,eye*0.8);met=lerp(met,0.7,eye*0.7);
            met=lerp(met,0.9,clamp(ap-eye,0,1)*0.7);
          }else if(id==="laser"){
            /* a designator: one deep bore with a lens, and a smaller ranging
               aperture beside it */
            /* TWO APERTURES THAT DO NOT TOUCH. The designator's own bore and
               the ranging channel beside it were placed off one offset and
               sized off the short axis alone, so on anything near square they
               overlapped into one lopsided blob. The radius is now held by
               BOTH axes and the two centres are set from it, which is the only
               way a gap between them is guaranteed rather than hoped for. */
            const R=Math.min(fShort*0.34,fLong*0.22);
            if(R>bev*3){
              const cMain=-fLong*0.16,cRng=fLong*0.24;
              const d1=Math.sqrt((alo-cMain)*(alo-cMain)+acr*acr);
              const d2=Math.sqrt((alo-cRng)*(alo-cRng)+acr*acr);
              const r2=R*0.45;
              const ring=1-smoothstep(R,R+bev,d1);
              h+=ring*R0*0.10;met=lerp(met,0.93,ring*0.8);
              const bore=1-smoothstep(R*0.78,R*0.78+bev,d1);
              h-=bore*R0*0.26;
              const lens=1-smoothstep(R*0.62,R*0.62+bev,d1);
              r=lerp(r,glass[0]*0.85,lens*0.92);g=lerp(g,glass[1]*1.05,lens*0.92);b=lerp(b,glass[2]*0.9,lens*0.92);
              rough=lerp(rough,0.05,lens*0.9);met=lerp(met,0.9,lens*0.9);
              emi=Math.max(emi,lens*P.lamps*0.30);
              const s2=1-smoothstep(r2,r2+bev,d2);
              h-=s2*R0*0.16;
              r=lerp(r,dark[0],s2*0.85);g=lerp(g,dark[1],s2*0.85);b=lerp(b,dark[2],s2*0.85);
              rough=lerp(rough,0.3,s2*0.7);met=lerp(met,0.6,s2*0.6);
            }
          }

        }

        /* ---------------- bolts and a lamp, on the FRAME ----------------
           Not inside the face block above: on the frame ring inFace is zero by
           construction — that is what makes it the frame — so a bolt guarded by
           inFace is a bolt that never draws anywhere it belongs. Which is
           exactly what happened, and what an empty emissive map reported. */
        if(dev>=0){
          const rnd=k=>Quilt.rand(BQ,rec,k);
          const ring=clamp(onFrame-inFace,0,1);
          if(ring>0.05&&P.bolts>0&&fw>boltR*1.8&&rnd(139)<P.bolts){
            const inset=gut+fw*0.5;
            const bu=Math.abs(Math.abs(rec.lu-0.5)*bw-(bw*0.5-inset));
            const bvv=Math.abs(Math.abs(rec.lv-0.5)*bh-(bh*0.5-inset));
            const bd=Math.sqrt(bu*bu+bvv*bvv);
            const bolt=(1-smoothstep(boltR*0.7,boltR,bd))*ring;
            h+=bolt*boltH;
            met=lerp(met,0.95,bolt*0.8);rough=lerp(rough,0.35,bolt*0.7);
            r=lerp(r,r*1.10+14,bolt*0.7);g=lerp(g,g*1.10+14,bolt*0.7);b=lerp(b,b*1.10+13,bolt*0.7);
          }
          if(ring>0.05&&P.lamps>0&&fw>lampR*1.6&&rnd(149)<P.lamps){
            /* one lamp, in the corner the bay's own draw picks */
            const sx=(rnd(151)<0.5?-1:1),sy=(rnd(157)<0.5?-1:1);
            const inset=gut+fw*0.5;
            const lu2=(rec.lu-0.5)*bw-sx*(bw*0.5-inset);
            const lv2=(rec.lv-0.5)*bh-sy*(bh*0.5-inset);
            const ld=Math.sqrt(lu2*lu2+lv2*lv2);
            const lamp=(1-smoothstep(lampR*0.6,lampR,ld))*ring;
            if(lamp>0.004){
              h+=lamp*boltH*0.5;
              r=lerp(r,lampC[0],lamp*0.9);g=lerp(g,lampC[1],lamp*0.9);b=lerp(b,lampC[2],lamp*0.9);
              rough=lerp(rough,0.1,lamp*0.9);met=lerp(met,0.2,lamp*0.8);
              emi=Math.max(emi,lamp*0.95);
            }
          }
        }

        /* ---------------- the harness ----------------
           The nearest lattice line in each axis, and whichever run is taller
           where two cross. Runs sit at a standoff off the PLATE, so anything
           taller than they are — a dome, a dish rim, a blade — stands in front
           of them and they pass behind it, which is what a cable does. */
        let runH=-1e9,runKind=0,runT=0,runFl=0;
        for(let ax=0;ax<2;ax++){
          const A2=ax?HN.V:HN.U;
          const t=(ax?v:u)*Ng;
          const li=Math.round(t);
          const k=((li%Ng)+Ng)%Ng;
          if(!A2[k])continue;
          const off=(t-li)/Ng;                      // SIGNED offset across the run
          const dcr=Math.abs(off);
          const kind=A2[k];
          const gg=(ax?HN.gV:HN.gU)[k]%nGauge;
          const rr=gaugeR(gg);
          const alng=(ax?u:v);                      // distance along it
          let prof=-1e9,fl=0;
          if(kind===1){
            /* rectangular waveguide: a flat top with vertical walls, and a
               bolted flange every so often. The flange is what says waveguide
               rather than duct — it is how the stuff is joined. */
            const hw=rr*1.15,hh=rr*0.72;
            if(dcr<hw){
              prof=runRise+hh;
              const fp=edgeDist(alng,flangePitch);
              fl=(1-smoothstep(flangePitch*0.06,flangePitch*0.10,fp))*P.runFit;
              prof+=fl*hh*0.28;
            }
          }else if(kind===2){
            /* a bundle: two or three round conduits side by side, with a clamp
               at intervals holding them together */
            const nb=2+(gg%2);
            const cr=rr*0.5;                        // each conduit of the bundle
            const pitch=cr*2.1;
            const spread=(nb-1)*pitch*0.5;
            let bd=1e9;
            for(let q2=0;q2<nb;q2++){
              const dd=Math.abs(off-(-spread+q2*pitch));
              if(dd<bd)bd=dd;
            }
            if(bd<cr){
              prof=runRise+Math.sqrt(Math.max(0,cr*cr-bd*bd));
              const fp=edgeDist(alng,flangePitch*1.6);
              fl=(1-smoothstep(flangePitch*0.10,flangePitch*0.16,fp))*P.runFit;
              prof+=fl*cr*0.34;
            }
          }else if(kind===3){
            /* a single fat feeder, on saddle clamps */
            if(dcr<rr){
              prof=runRise+Math.sqrt(Math.max(0,rr*rr-dcr*dcr));
              const fp=edgeDist(alng,flangePitch*2.2);
              fl=(1-smoothstep(flangePitch*0.14,flangePitch*0.22,fp))*P.runFit;
              prof+=fl*rr*0.22;
            }
          }
          if(prof>runH){runH=prof;runKind=kind;runT=1;runFl=fl;}
        }
        if(runT&&runH>h){
          h=runH;
          const shade=runKind===1?1.0:(runKind===2?0.92:0.96);
          r=plate[0]*shade*1.04;g=plate[1]*shade*1.04;b=plate[2]*shade*1.04;
          met=0.95;rough=clamp(+P.rough*0.8,0.05,1);
          if(runFl>0.01){
            r=r*1.06+8;g=g*1.06+8;b=b*1.05+8;
            rough=clamp(rough*0.85,0.04,1);
          }
        }

        HGT[i]=h;

        /* ---------------- weathering ---------------- */
        const dirt=clamp(fbm(u,v,4,4,seed+61)*1.35-0.42,0,1)*P.grime;
        if(dirt>0){
          const k=dirt*0.7;
          r=lerp(r,r*0.55+8,k);g=lerp(g,g*0.56+8,k);b=lerp(b,b*0.54+7,k);
          rough=lerp(rough,0.86,dirt*0.55);met=lerp(met,met*0.7,dirt*0.5);
        }
        const scr=clamp(fbm(u,v,110,2,seed+79)*1.9-0.95,0,1)*P.scratch;
        if(scr>0){
          r=lerp(r,r*1.20+16,scr*0.5);g=lerp(g,g*1.20+16,scr*0.5);b=lerp(b,b*1.18+15,scr*0.5);
          rough=lerp(rough,0.24,scr*0.5);
        }

        A[i*3]=r;A[i*3+1]=g;A[i*3+2]=b;
        RGH[i]=clamp(rough,0.04,1)*255;
        MET[i]=clamp(met,0,1)*255;
        EMI[i]=clamp(emi*P.glow,0,1)*255;
        AOc[i]=255;                                  // seeded, refined in pass 2
      }
    }
    if(y<S){io.progress(y/S*0.7);setTimeout(pass1,0);}
    else{io.progress(0.75);setTimeout(pass2,0);}
  }

  function pass2(){
    /* the gutters between bays and the bores of the lenses are what this mode
       has an AO map for, so the tight radius carries at least as much of it */
    const r1=Math.max(1,Math.round(S*0.004)),r2=Math.max(3,Math.round(S*0.02));
    const b1=boxBlurWrap(HGT,S,r1),b2=boxBlurWrap(HGT,S,r2);
    const aoScale=1/Math.max(1e-7,R0*0.35);
    for(let i=0;i<N;i++){
      const c1=clamp((b1[i]-HGT[i])*aoScale*1.7,0,1);
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

/* distance to the nearest multiple of p — used along a run for its flanges */
function edgeDist(t,p){const f=t/p;return Math.abs(f-Math.round(f))*p;}

/* ============================ mode definition ============================ */

const WEIGHTS=[
  {id:"wAesa",  label:"AESA array face",  value:0.9},
  {id:"wDish",  label:"Comms dish",       value:0.55},
  {id:"wSat",   label:"SATCOM panel",     value:0.35},
  {id:"wCam",   label:"Camera cluster",   value:0.55},
  {id:"wBlade", label:"Blade antenna",    value:0.7},
  {id:"wWhip",  label:"Whip mast base",   value:0.3},
  {id:"wDome",  label:"Radome dome",      value:0.5},
  {id:"wHorn",  label:"Waveguide horn",   value:0.35},
  {id:"wGrille",label:"Cooling grille",   value:0.4},
  {id:"wConn",  label:"Connector plate",  value:0.45},
  {id:"wWarn",  label:"Warning receiver", value:0.4},
  {id:"wLaser", label:"Designator",       value:0.3}
];

Forge.register({
  id:"sensor",
  label:"Sensor",
  group:"Sci-fi",
  threadable:true,
  blurb:"Sensor and antenna cluster — AESA faces, dishes, cameras, waveguide",
  title:'Sensor <em>Cluster</em>',
  tagline:"AESA · dishes · cameras · antennas · waveguide harness · seamless",
  actionLabel:"Fit the sensors",
  busyLabel:"Fitting…",
  seamless:true,
  previewSize:256,
  preview:{gain:2.9,amb:1.08,specK:0.58,skyLo:[0.14,0.16,0.21],skyHi:[0.32,0.36,0.44]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
    {key:"ao",label:"AO"},{key:"emissive",label:"Emissive"},
    {key:"height",label:"Height"},{key:"orm",label:"ORM packed"}
  ],

  presets:[
    {id:"mast",label:"Warship mast face",set:{
      tileM:3.2,rows:5,colsMin:2,colsMax:4,subdiv:.5,subdepth:2,
      gutter:14,frame:22,bevel:2.5,relief:90,
      devDens:.9,radome:.3,
      wAesa:1.2,wDish:.5,wSat:.35,wCam:.4,wBlade:.7,wWhip:.35,wDome:.5,
      wHorn:.4,wGrille:.5,wConn:.5,wWarn:.45,wLaser:.25,
      bolts:.6,boltD:12,lamps:.18,glow:.85,
      runDens:.5,runGrid:9,runD:44,runRise:.8,runWg:.55,runGauge:3,runFlange:180,runFit:.85,
      grime:.45,scratch:.3,rough:.5,metalness:.88,
      cPlate:"#8b9096",cDark:"#2b2f33",cRadome:"#c9c6bd",cGlass:"#1b2026",cLamp:"#ff9a3c"}},
    {id:"nose",label:"Aircraft nose array",set:{
      tileM:1.6,rows:4,colsMin:1,colsMax:3,subdiv:.35,subdepth:1,
      gutter:8,frame:14,bevel:1.5,relief:45,
      devDens:.95,radome:.55,
      wAesa:2.2,wDish:.1,wSat:.2,wCam:.6,wBlade:.3,wWhip:.1,wDome:.2,
      wHorn:.2,wGrille:.55,wConn:.5,wWarn:.5,wLaser:.4,
      bolts:.75,boltD:8,lamps:.08,glow:.7,
      runDens:.35,runGrid:11,runD:26,runRise:.6,runWg:.7,runGauge:2,runFlange:120,runFit:.9,
      grime:.3,scratch:.35,rough:.44,metalness:.9,
      cPlate:"#9aa0a6",cDark:"#2f3337",cRadome:"#d5d2c9",cGlass:"#161b21",cLamp:"#49d8ff"}},
    {id:"satbus",label:"Satellite bus",set:{
      tileM:2.4,rows:4,colsMin:2,colsMax:4,subdiv:.45,subdepth:2,
      gutter:10,frame:16,bevel:2,relief:75,
      devDens:.85,radome:.15,
      wAesa:.5,wDish:1.4,wSat:1.0,wCam:.5,wBlade:.2,wWhip:.5,wDome:.6,
      wHorn:.9,wGrille:.2,wConn:.6,wWarn:.15,wLaser:.2,
      bolts:.5,boltD:10,lamps:.25,glow:.9,
      runDens:.45,runGrid:8,runD:34,runRise:.9,runWg:.35,runGauge:3,runFlange:140,runFit:.8,
      grime:.12,scratch:.15,rough:.4,metalness:.92,
      cPlate:"#7f858c",cDark:"#22262a",cRadome:"#e2ded2",cGlass:"#12171d",cLamp:"#ffd06a"}},
    {id:"turret",label:"EO turret cluster",set:{
      tileM:1.2,rows:3,colsMin:1,colsMax:3,subdiv:.4,subdepth:1,
      gutter:7,frame:12,bevel:1.5,relief:38,
      devDens:1,radome:.2,
      wAesa:.25,wDish:.1,wSat:.1,wCam:2.4,wBlade:.15,wWhip:.1,wDome:.35,
      wHorn:.1,wGrille:.3,wConn:.5,wWarn:.6,wLaser:1.1,
      bolts:.7,boltD:7,lamps:.3,glow:1,
      runDens:.3,runGrid:12,runD:20,runRise:.5,runWg:.3,runGauge:2,runFlange:90,runFit:.85,
      grime:.4,scratch:.4,rough:.48,metalness:.86,
      cPlate:"#6e747a",cDark:"#232629",cRadome:"#bdb9b0",cGlass:"#141a20",cLamp:"#ff5a3c"}},
    {id:"ground",label:"Ground station",set:{
      tileM:6,rows:3,colsMin:1,colsMax:3,subdiv:.3,subdepth:1,
      gutter:26,frame:40,bevel:5,relief:220,
      devDens:.75,radome:.25,
      wAesa:.5,wDish:1.6,wSat:.7,wCam:.2,wBlade:.5,wWhip:.7,wDome:.8,
      wHorn:.5,wGrille:.4,wConn:.5,wWarn:.1,wLaser:.05,
      bolts:.55,boltD:22,lamps:.15,glow:.8,
      runDens:.55,runGrid:7,runD:90,runRise:.9,runWg:.6,runGauge:3,runFlange:400,runFit:.85,
      grime:.6,scratch:.25,rough:.58,metalness:.8,
      cPlate:"#96999a",cDark:"#31353a",cRadome:"#cfccc4",cGlass:"#1a1f25",cLamp:"#ff9a3c"}},
    {id:"derelict",label:"Derelict — stripped",set:{
      tileM:3.2,rows:5,colsMin:2,colsMax:5,subdiv:.55,subdepth:2,
      gutter:14,frame:20,bevel:3,relief:80,
      devDens:.45,radome:.1,
      wAesa:.6,wDish:.3,wSat:.2,wCam:.2,wBlade:.4,wWhip:.4,wDome:.2,
      wHorn:.3,wGrille:.5,wConn:1.0,wWarn:.2,wLaser:.1,
      bolts:.7,boltD:12,lamps:0,glow:0,
      runDens:.6,runGrid:9,runD:40,runRise:.7,runWg:.4,runGauge:3,runFlange:170,runFit:.5,
      grime:.9,scratch:.65,rough:.72,metalness:.62,
      cPlate:"#797a74",cDark:"#26282a",cRadome:"#a8a49a",cGlass:"#191d22",cLamp:"#ff9a3c"}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:Forge.sizes("square")},
      {id:"tileM",label:"Tile covers",unit:"m",min:0.3,max:24,step:0.1,value:3.2},
      {type:"readout"},
      {id:"seed",type:"seed",value:5150}
    ]},
    {title:"Bays",open:true,rows:[
      {id:"rows",label:"Bay rows",min:1,max:14,step:1,value:5},
      {id:"colsMin",label:"Columns min",min:1,max:10,step:1,value:2},
      {id:"colsMax",label:"Columns max",min:1,max:12,step:1,value:4},
      {id:"subdiv",label:"Sub-division",min:0,max:1,step:0.01,value:0.5},
      {id:"subdepth",label:"Sub-division depth",min:0,max:3,step:1,value:2},
      {id:"gutter",label:"Gap between bays",unit:"mm",min:2,max:80,step:1,value:14},
      {id:"frame",label:"Frame width",unit:"mm",min:2,max:120,step:1,value:22},
      {id:"bevel",label:"Edge bevel",unit:"mm",min:0.5,max:20,step:0.5,value:2.5},
      {id:"relief",label:"Tallest device",unit:"mm",min:5,max:400,step:5,value:90},
      {type:"note",html:"A bay holds <b>one</b> device, wholly, inside its own frame — "+
        "equipment comes in boxes that bolt to a plate. The gap between bays is where the "+
        "harness runs."}
    ]},
    {title:"Devices",open:true,rows:[
      {id:"devDens",label:"Bays with a device",min:0,max:1,step:0.01,value:0.85}
    ].concat(WEIGHTS.map(w=>({id:w.id,label:w.label,min:0,max:2.5,step:0.05,value:w.value})))
     .concat([
      {id:"radome",label:"Arrays under a cover",min:0,max:1,step:0.01,value:0.3},
      {type:"note",html:"These twelve are <b>weights</b>, not a chain: one at zero never "+
        "appears, and doubling one makes it twice as likely against the rest. A device is also "+
        "chosen by <b>fit</b> — a dish wants square ground and a blade antenna a long strip, so "+
        "each is only offered a bay of the shape it needs, and a bay too small for anything is "+
        "left as plain plate rather than filled with mush."},
      {type:"note",html:"<b>Arrays under a cover</b> is how many AESA faces get a composite "+
        "radome over them: the element lattice goes to a ghost and the face turns dielectric, "+
        "which is what a covered array looks like from outside."}
     ])},
    {title:"Fasteners & lamps",rows:[
      {id:"bolts",label:"Frame bolts",min:0,max:1,step:0.01,value:0.6},
      {id:"boltD",label:"Bolt diameter",unit:"mm",min:2,max:50,step:0.5,value:12},
      {id:"lamps",label:"Status lamps",min:0,max:1,step:0.01,value:0.18},
      {id:"glow",label:"Emissive strength",min:0,max:1,step:0.01,value:0.85},
      {type:"note",html:"Skipped on any frame too narrow to hold them."}
    ]},
    {title:"Waveguide harness",open:true,rows:[
      {id:"runDens",label:"Run density",min:0,max:1,step:0.01,value:0.5},
      {id:"runGrid",label:"Run lattice",unit:"cells",min:2,max:32,step:1,value:9},
      {id:"runD",label:"Largest run",unit:"mm",min:4,max:250,step:1,value:44},
      {id:"runRise",label:"Standoff height",min:0,max:2,step:0.05,value:0.8},
      {id:"runWg",label:"Rectangular waveguide",min:0,max:1,step:0.01,value:0.55},
      {id:"runGauge",label:"Sizes in use",min:1,max:3,step:1,value:3},
      {id:"runFlange",label:"Flange pitch",unit:"mm",min:20,max:900,step:10,value:180},
      {id:"runFit",label:"Flanges & clamps",min:0,max:1,step:0.01,value:0.85},
      {type:"note",html:"Runs are <b>straight</b>, and deliberately: waveguide is rigid, cut "+
        "to length and bolted between flanges, so on a mast it goes straight up and straight "+
        "along. <b>Rectangular waveguide</b> is what share of them are that rather than coax; "+
        "the rest come out as bundles of two or three, or as a single fat feeder."},
      {type:"note",html:"A run sits at a standoff off the plate and passes <b>behind</b> "+
        "anything taller than it is, which is what a cable does — so a dome, a dish rim or a "+
        "blade stands in front of the harness rather than being sliced by it."}
    ]},
    {title:"Finish",rows:[
      {type:"colors",label:"Plate · recess · composite · glass · lamp",items:[
        {id:"cPlate",value:"#8b9096"},{id:"cDark",value:"#2b2f33"},
        {id:"cRadome",value:"#c9c6bd"},{id:"cGlass",value:"#1b2026"},
        {id:"cLamp",value:"#ff9a3c"}]},
      {id:"grime",label:"Grime",min:0,max:1,step:0.01,value:0.45},
      {id:"scratch",label:"Scuffing",min:0,max:1,step:0.01,value:0.3},
      {id:"rough",label:"Base roughness",min:0.05,max:1,step:0.01,value:0.5},
      {id:"metalness",label:"Metalness",min:0,max:1,step:0.01,value:0.88},
      {type:"note",html:"A radome, a dome and a dish face are <b>composite</b> — dielectric, "+
        "so metallic goes to nothing and roughness up — and a lens is dark glass, smooth and "+
        "specular. Those three carry as much of the read as the shapes do."}
    ]},
    {title:"Maps",rows:[
      {id:"normalStr",label:"Normal strength",min:0.1,max:3,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:0.8},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  /* a maximum below the minimum would silently produce one column per row */
  derive:function(P,ui){
    if((P.colsMax|0)<(P.colsMin|0))ui.set("colsMax",P.colsMin|0);
  },

  plan:function(P){const t=Math.max(0.05,+P.tileM||3.2);return {w:t,h:t,tile:t,cutout:false};},

  size:function(P,preview){
    const S=preview?Math.min(P.size|0,256):(P.size|0);
    return {w:S,h:S};
  },
  build:build,

  fileBase:function(P,W){return "sensor_"+(P.seed|0)+"_"+W;},

  readout:function(P){
    const T=Math.max(0.05,+P.tileM||3.2),S=P.size|0,pxPerM=S/T;
    let m="<b>"+Math.round(pxPerM)+" px/m</b> · "+(1000/pxPerM).toFixed(1)+" mm per texel";
    const rows=Math.max(1,P.rows|0),cols=Math.max(1,P.colsMin|0);
    const bh=T/rows*100,bw=T/cols*100;
    const sub=Math.pow(2,P.subdepth|0);
    m+="<br>bays <b>"+(bh/sub).toFixed(0)+"–"+bh.toFixed(0)+" cm</b> tall · <b>"+
       (bw/Math.max(1,P.colsMax|0)*Math.max(1,P.colsMin|0)/sub).toFixed(0)+"–"+bw.toFixed(0)+" cm</b> wide";
    /* WHAT WILL ACTUALLY BE FITTED. A device needs a stated number of texels
       across its short side before it is worth drawing, so the answer to "why
       is half my plate bare" is arithmetic and belongs here rather than in
       the reader's head. */
    const smallPx=Math.min(bh/sub,bw/Math.max(1,P.colsMax|0)*Math.max(1,P.colsMin|0)/sub)/100*pxPerM;
    /* the FACE left inside the smallest bay, which is what a device is judged
       against — the frame and the gutter come off every side first */
    const cut=(P.gutter*0.5+Math.max(P.frame,P.bevel*1.6))/1000*pxPerM*2;
    const facePx=smallPx-cut;
    const fits=DEV.filter(d=>facePx>=d.min&&(+P[d.key]||0)>0);
    m+="<br>smallest bay <b>"+smallPx.toFixed(0)+" px</b>, its face <b>"+
       Math.max(0,facePx).toFixed(0)+" px</b> · "+fits.length+" of "+DEV.length+" devices fit it";
    if(!fits.length)m+="<br><b>nothing fits the smallest bay</b> — narrow the frame, drop the "+
                       "sub-division depth, use fewer rows, or raise the resolution";
    const linePx=P.gutter/1000*pxPerM;
    if(linePx<1.2)m+="<br>gap between bays "+linePx.toFixed(1)+" px — held at a texel";
    const runPx=P.runD/1000*pxPerM;
    if(P.runDens>0&&runPx<3)m+="<br>largest run "+runPx.toFixed(1)+" px across — too fine to read";
    const cap=0.80/Math.max(2,P.runGrid|0)*T*1000;
    if(P.runD>cap)m+="<br>runs held to <b>"+cap.toFixed(0)+" mm</b> by the lattice — "+
                     "two on neighbouring lines would merge";
    return m;
  },

  readme:function(P,info){
    const T=Math.max(0.05,+P.tileM||3.2);
    const mm=(info.hMax-info.hMin)*T*1000;
    const on=DEV.filter(d=>(+P[d.key]||0)>0);
    return ["Texture Forge · sensor — sensor and antenna cluster",
      "",
      "Seed "+(P.seed|0)+"   Resolution "+info.W+"x"+info.H+"   Seamless in both axes",
      "Tile covers "+T+" m, so one texel is "+(T/info.W*1000).toFixed(2)+" mm.",
      "",
      "A mounting plate carved into BAYS, each holding one device inside its own",
      "frame, with a waveguide and coax harness running in the gaps between them.",
      "",
      "In the mix at these settings ("+on.length+" of "+DEV.length+" devices):",
      "  "+on.map(d=>d.label).join(", ")+".",
      "",
      "A device is chosen by weight AND by fit: a dish wants square ground and a",
      "blade antenna a long strip, so each is only offered a bay of the shape it",
      "needs. A bay too small for anything in the mix is left as plain plate.",
      "",
      "basecolor.png  sRGB albedo. Import as sRGB / colour data.",
      "normal.png     Tangent space, "+info.normalNote+". Non-colour.",
      "roughness.png  Linear grey.",
      "metallic.png   Linear grey. The plate sits at "+(+P.metalness).toFixed(2)+"; a radome, a dome",
      "               and a dish face go to nearly nothing because composite is a",
      "               DIELECTRIC, and a lens goes high and smooth — the same cheat",
      "               the hull mode's windows use, so it picks up the environment",
      "               and reads as glass on an opaque surface.",
      "ao.png         Linear grey ambient occlusion, from the gutters and the bores.",
      "emissive.png   Status lamps and the designator's own aperture; black elsewhere.",
      "height.png     Linear grey spanning "+mm.toFixed(1)+" mm of real relief",
      "               (0-1 maps to "+(info.hMax-info.hMin).toFixed(6)+" in tile-width units).",
      "height16.png   The same field at 16 bits. Worth using: a dome and a dish take",
      "               most of the range, so at 8 bits the element lattice of an array",
      "               is left with only a few levels.",
      "orm.png        R = AO, G = roughness, B = metallic.",
      "",
      "NEARLY ALL THE CHARACTER IS IN HEIGHT, like the greeble mode and unlike the",
      "hull: displace this if you can, and use a strong normal if you cannot.",
      "",
      "Normal strength was baked at "+(+P.normalStr).toFixed(2)+"x."].join("\n");
  }
});

/* exposed for the feature test, which asks what the placement decided rather
   than inferring it from pixels */
window.ForgeSensor={
  DEV:DEV,DEV_BY:DEV_BY,BANDS:BANDS,bandOf:bandOf,
  pickTables:pickTables,harness:harness
};

})();
