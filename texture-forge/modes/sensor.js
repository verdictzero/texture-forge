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
     the deck    the runs are UNDER the plate, not over it. Nothing is
                 wired up if the cables are missing, but a cable dressed
                 across the face of an array is not an installation
                 either — it is a cable somebody would trip over. So the
                 plate is PANELLED, the gaps between panels are real gaps
                 you can see down through, a share of the panels are
                 removed altogether, and what shows underneath is a dense
                 sub-deck of conduit, waveguide and cable in crossed
                 layers. Nothing at all stands proud of the plate that is
                 not a device bolted to it.

   TWELVE DEVICES, and each is a real thing rather than a shape:

     aesa      an AESA array face — a TRIANGULAR lattice of radiating
               elements at half-wavelength spacing behind a chamfered
               frame, which is the one detail that separates an active
               array from a perforated sheet. Some get a composite cover.
     dish      a parabolic comms dish: a real paraboloid bowl, a rim, a
               feed boss on struts, a sub-reflector at the focus
     satcom    a flat SATCOM panel — concentric rings of elements
     camera    an electro-optical cluster: several MULTI-ELEMENT lenses
               of different diameters — bezel, retaining ring with
               wrench slots, a convex coated front element, the element
               groups behind it, baffle rings down the barrel and a
               bladed iris — and a rectangular sensor window beside them
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

/* ============================ the deck below ============================

   WHAT IS UNDER THE PLATE, seen through the gaps in it. This is the one thing
   the mode used to get backwards: the runs were laid ON the plate, at a
   standoff, passing over the arrays and behind the domes. That is a cable
   dressed across the face of a radar, which is not an installation — it is a
   cable somebody would trip over. Real equipment plates are the LID: the
   plumbing is beneath them, and you only see it where the lid is opened.

   So there are no runs on the top surface at all, and instead:

     panel gaps      every bay is a removable panel, and the gap between
                     panels is a real gap cut through the panel's thickness.
                     Stretches of it are open all the way to the deck, and
                     which stretches is hashed on the coordinate the gap RUNS
                     ALONG — so both sides of a seam agree, and a slot is not
                     open on one side and shut on the other.
     removed panels  a share of bays have no panel at all: the rebate it
                     seated on, its anchor points, and the deck wide open.

   The deck itself is CROSSED LAYERS, which is what makes it read as deep
   rather than as a texture at the bottom of a hole: the lowest layer runs one
   way, the next runs across it a conduit's width higher, and the third across
   that again. Every layer is on its own fine lattice, so the nearest run is
   one rounding per layer and the whole thing costs three lookups however
   dense it looks. */
function deckOf(o){
  return {
    /* the height and kind of the topmost thing in the deck under (u,v).
       Returns kind 0 for the deck floor, else 1..3 for which layer. */
    at:function(u,v,out){
      let top=o.floorY,kind=0,ri=0,li=0,alng=0;
      for(let L=0;L<o.layers;L++){
        const axis=L&1;
        const p=o.pitch*(1+L*0.42);
        const t=(axis?u:v)/p;
        const ln=Math.round(t);
        const key=((ln%9973)+9973)%9973;
        if(hashi(key,L*13+3,o.seed)>=o.fill)continue;
        const rr=p*(0.22+hashi(key,L*13+5,o.seed)*0.20);
        const d=Math.abs(t-ln)*p;
        if(d>=rr)continue;
        /* each layer clears the one below by a full conduit, so the upper one
           passes over rather than merging with it */
        const y=o.floorY+o.pitch*(0.55+L*0.95)+Math.sqrt(rr*rr-d*d);
        if(y>top){top=y;kind=L+1;ri=key;li=L;alng=(axis?v:u);}
      }
      out.y=top;out.kind=kind;out.line=ri;out.layer=li;out.along=alng;
      return out;
    }
  };
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

  /* ---- the deck below, and how much of it shows ---- */
  const panelT=Math.max(P.panelT*MM,px*1.2);       // the panel's own thickness
  const deckD=Math.max(P.deckD*MM,panelT*1.6);     // how far down the deck sits
  const deckPitch=Math.max(P.deckPitch*MM,px*2.6); // conduit pitch under there
  const deckLayers=clamp(P.deckLayers|0,1,3);
  const DK=deckOf({pitch:deckPitch,layers:deckLayers,fill:clamp(+P.deckFill,0,1),
                   floorY:-deckD,seed:seed+8081});
  const dOut={y:0,kind:0,line:0,layer:0,along:0};
  const gapSeg=Math.max(2,Math.round(1/Math.max(px*20,0.02)));   // stretches along a gap
  const cable=hex2rgb(P.cCable);

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

        /* THE GAP BETWEEN PANELS IS A REAL GAP, cut through the panel's own
           thickness rather than scribed into it — and stretches of it are open
           all the way down to the deck. Which stretches is hashed on the
           coordinate the gap RUNS ALONG, so the two bays either side of a seam
           reach the same answer and a slot is never open on one side and shut
           on the other. */
        const inGut=1-smoothstep(gut,gut+bev,rec.dEdge);
        const gapVert=rec.du<rec.dv;                   // the near edge is a vertical one
        const gapAlong=gapVert?v:u;
        const gapSee=inGut>0.5&&
          hashi(Math.floor(gapAlong*gapSeg),gapVert?1:2,seed+9091)<P.gapSee;
        h-=inGut*panelT;

        /* ---------------- which device, if any ----------------
           The face is what is left of the bay once the gutter and the frame
           have taken their cut off every side, and the face is what the
           device has to live on — so it is what the fit is judged against. */
        const fw=Math.max(P.frame*MM,bev*1.6);
        const facePx=(short-2*(gut+fw))*S;
        const bandI=bandOf(long/short);
        const tab=TAB[bandI];
        /* A PANEL REMOVED comes first, because it is a decision about the
           panel and a device is a decision about what is bolted to one. */
        const gone=Quilt.rand(BQ,rec,211)<P.openFrac&&facePx>=6;
        let dev=-1;
        if(!gone&&tab.tot>0&&facePx>=4&&Quilt.rand(BQ,rec,103)<P.devDens){
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
               camera; three unequal ones are a targeting turret.

               A HOUSING FIRST. The cluster is a BOX with apertures in it, and
               the apertures are a small part of its face, so the lenses alone
               left most of a bay bare and read as lenses printed on a plate. */
            const padQ=Math.max(Math.abs(cu)/(faceW*0.5),Math.abs(cv)/(faceH*0.5));
            const pad=(1-smoothstep(0.92,0.98,padQ))*inFace;
            h+=pad*R0*0.16;
            met=lerp(met,0.93,pad*0.5);
            const nL=2+((rnd(131)*3)|0);
            /* the lens row spans the housing rather than huddling in the
               middle of it: the first and last are half a step from the ends */
            const span=fLong*0.80;
            const step=span/nL;
            let best=1e9,bR=0,bK=0,bdx=0,bdy=0;
            for(let k=0;k<nL;k++){
              const c=(k+0.5)*step-span*0.5;
              const rk=Math.min(step*0.42,fShort*0.34)*(0.66+hashi(rec.key,k*7+53,seed)*0.34);
              const dx=alo-c,dy=acr;
              const d=Math.sqrt(dx*dx+dy*dy)-rk;
              if(d<best){best=d;bR=rk;bK=k;bdx=dx;bdy=dy;}
            }
            /* A LENS IS AN ASSEMBLY, NOT A DARK CIRCLE, and every ring of it
               is a part somebody machined:

                 bezel     the outer ring of the barrel, raised, radially
                           knurled where a hand would grip it
                 retainer  the ring that holds the front element in, with the
                           wrench slots it is turned by
                 element   a CONVEX front glass — the curvature is what puts a
                           ring highlight on it instead of a flat sheen, and a
                           flat sheen is what made this read as a hole before
                 groups    the element groups behind it, seen as concentric
                           steps each with its own coating tint. Multi-coating
                           is why real lenses flash magenta and green, and it
                           is the single strongest cue that a dark circle is a
                           lens rather than a socket.
                 baffles   the fine rings turned into the inside of the barrel
                           to kill flare, between the glass and the iris
                 iris      a POLYGON, not a circle, because it is made of
                           blades — the one detail no amount of shading
                           substitutes for.

               It needs room: below about nine texels of radius none of this
               survives the resolution, so the whole assembly drops back to a
               plain bore rather than turning into grey mush. */
            const lensPx=bR*S;
            if(bR>bev*2.4&&lensPx>=9){
              const d=best+bR;                        // distance from the lens axis
              const R=bR;
              const rBez=R,rRet=R*0.88,rGls=R*0.78,rBar=R*0.50;
              const nElem=clamp(P.lensElem|0,1,6);
              const nB=clamp(P.lensBlades|0,4,10);
              const coat=clamp(+P.lensCoat,0,1);
              const ang=Math.atan2(bdy,bdx);

              /* the barrel, standing proud of the housing */
              const barrel=(1-smoothstep(rBez,rBez+bev,d))*pad;
              h+=barrel*R0*0.11;
              met=lerp(met,0.94,barrel*0.85);
              rough=lerp(rough,0.36,barrel*0.7);
              r=lerp(r,r*1.06+8,barrel*0.5);g=lerp(g,g*1.06+8,barrel*0.5);b=lerp(b,b*1.05+8,barrel*0.5);

              /* the bezel's knurl: fine radial flutes, dropped when they would
                 alias into a grey band rather than read as knurling */
              const bez=barrel*smoothstep(rRet-bev,rRet,d);
              const nK=Math.max(10,Math.round(6.2831853*R/Math.max(bev*2.4,px*2.6)));
              if(bez>0.004&&6.2831853*R/nK*S>=2.4){
                const ka=ang*nK/6.2831853;
                const kf=ka-Math.floor(ka);
                const knurl=bez*(1-smoothstep(0.28,0.42,Math.abs(kf-0.5)));
                h-=knurl*bev*0.5;
                rough=lerp(rough,0.5,knurl*0.5);
              }

              /* the retaining ring, set a little below the bezel, with the
                 slots a lens wrench engages */
              const ret=barrel*(1-smoothstep(rRet,rRet+bev,d))*smoothstep(rGls-bev,rGls,d);
              h-=ret*R0*0.020;
              met=lerp(met,0.95,ret*0.8);rough=lerp(rough,0.3,ret*0.7);
              if(ret>0.004){
                const sa=ang*nB/6.2831853;
                const sf=sa-Math.floor(sa);
                const slot=ret*(1-smoothstep(0.06,0.13,Math.abs(sf-0.5)));
                h-=slot*R0*0.030;
                r=lerp(r,dark[0],slot*0.7);g=lerp(g,dark[1],slot*0.7);b=lerp(b,dark[2],slot*0.7);
              }

              /* the front element: convex, so the highlight is a ring */
              const gls=1-smoothstep(rGls,rGls+bev,d);
              if(gls>0.004){
                const t=clamp(d/rGls,0,1);
                const dome=Math.sqrt(Math.max(0,1-t*t));
                h-=gls*R0*0.10;                       // set back into the barrel
                h+=gls*R0*0.055*dome;                 // and bulging out of it
                r=lerp(r,glass[0],gls*0.95);g=lerp(g,glass[1],gls*0.95);b=lerp(b,glass[2],gls*0.95);
                rough=lerp(rough,0.04,gls*0.94);met=lerp(met,0.9,gls*0.92);
                /* THE ELEMENT GROUPS, as concentric steps with their own
                   coatings. The band index is what the coating cycles on, so
                   successive groups flash different colours the way a
                   multi-coated stack does. */
                const bi=Math.min(nElem-1,Math.floor(t*nElem));
                const bf=t*nElem-bi;
                const c3=bi%3;
                const cr=c3===0?1.35:(c3===1?0.72:1.18);
                const cg=c3===0?0.70:(c3===1?1.30:1.06);
                const cb=c3===0?1.30:(c3===1?0.86:0.66);
                const kk=gls*coat*0.85;
                r=lerp(r,clamp(r*cr+10,0,255),kk);
                g=lerp(g,clamp(g*cg+10,0,255),kk);
                b=lerp(b,clamp(b*cb+10,0,255),kk);
                /* each group's own edge, seen as a fine dark line, and a step
                   down as the stack recedes */
                const edge=gls*(1-smoothstep(0.06,0.14,Math.min(bf,1-bf)));
                h-=edge*R0*0.012;
                r*=1-edge*0.45;g*=1-edge*0.45;b*=1-edge*0.45;
                h-=gls*R0*0.010*bi;                   // the stack recedes inward
              }

              /* the baffle rings turned into the barrel behind the glass */
              const bar=(1-smoothstep(rBar,rBar+bev,d))*gls;
              if(bar>0.004){
                const nBaf=Math.max(2,Math.round(rBar/Math.max(bev*2.2,px*2.4)));
                const bp=rBar/nBaf;
                if(bp*S>=2.4){
                  const fb2=d/bp-Math.floor(d/bp);
                  const baf=bar*(1-smoothstep(0.24,0.36,Math.abs(fb2-0.5)));
                  h-=baf*R0*0.014;
                  r=lerp(r,dark[0]*0.7,baf*0.6);g=lerp(g,dark[1]*0.7,baf*0.6);b=lerp(b,dark[2]*0.7,baf*0.6);
                  rough=lerp(rough,0.9,baf*0.6);met=lerp(met,0.1,baf*0.6);
                }
              }

              /* THE IRIS IS A POLYGON, because it is made of blades. The
                 regular-polygon distance is the largest projection of the
                 radius onto a blade normal, which is one cosine once the angle
                 is folded into a single blade's sector. */
              const segA=6.2831853/nB;
              const fa=ang-Math.round(ang/segA)*segA;
              const dP=d*Math.cos(fa);
              const ap=rBar*0.62;
              const iris=(1-smoothstep(ap,ap+bev,dP))*gls;
              h-=iris*R0*0.055;
              r=lerp(r,dark[0]*0.28,iris*0.95);g=lerp(g,dark[1]*0.28,iris*0.95);b=lerp(b,dark[2]*0.3,iris*0.95);
              /* THE PUPIL IS A LIGHT TRAP, so it goes all the way matte and all
                 the way dielectric rather than most of the way: it is the one
                 place on the whole plate that should reflect nothing at all,
                 and at four fifths of the way there it still read as dull
                 metal — 49 of 255 on the metallic map, which is a dark socket
                 rather than the inside of a barrel. */
              rough=lerp(rough,0.97,iris*0.95);met=lerp(met,0.015,iris*0.96);
              /* the blades themselves, and the joint where each laps the next */
              const blades=clamp(bar-iris,0,1);
              if(blades>0.004){
                met=lerp(met,0.85,blades*0.6);rough=lerp(rough,0.3,blades*0.6);
                r=lerp(r,r*1.10+6,blades*0.5);g=lerp(g,g*1.10+6,blades*0.5);b=lerp(b,b*1.08+6,blades*0.5);
                const ja=ang-(Math.round(ang/segA-0.5)+0.5)*segA;
                const joint=blades*(1-smoothstep(0,Math.max(bev*0.8,px*0.9),Math.abs(ja)*d));
                h-=joint*R0*0.008;
                r*=1-joint*0.35;g*=1-joint*0.35;b*=1-joint*0.35;
              }
            }else if(bR>bev*2.4){
              /* too small for the assembly: a plain bore with dark glass in it,
                 which is the honest answer at four texels across */
              const bore=1-smoothstep(0,bev,best);
              h-=bore*pad*R0*0.22;
              const gl=1-smoothstep(0,bev,best+bR*0.18);
              r=lerp(r,glass[0],gl*0.94);g=lerp(g,glass[1],gl*0.94);b=lerp(b,glass[2],gl*0.94);
              rough=lerp(rough,0.06,gl*0.92);met=lerp(met,0.85,gl*0.9);
            }

            /* AND A RECTANGULAR SENSOR WINDOW, off to one side of the lens
               row rather than at the end of it — where it sat before it ran
               off the edge of its own housing and read as a hole punched
               through the plate. It gets a rebate of its own, because a
               window in a box has a frame and a void does not. */
            const wOff=fShort*0.26;
            const wHalfA=Math.min(span*0.22,fShort*0.26),wHalfC=fShort*0.12;
            const wq=Math.max((Math.abs(alo)-wHalfA)/Math.max(bev,1e-6),
                              (Math.abs(acr-wOff)-wHalfC)/Math.max(bev,1e-6));
            const rebate=(1-smoothstep(1.9,2.6,wq))*pad;
            const win=(1-smoothstep(0,1,wq))*pad;
            if(wHalfC>bev*2&&rebate>0.004){
              h-=clamp(rebate-win,0,1)*R0*0.05;
              h-=win*R0*0.12;
              /* A SLIGHT CROWN, which is what stops flat glass reading as a
                 hole: the lenses beside it are convex and catch a ring
                 highlight, and this had nothing to bend the light across it at
                 all. Armoured windows are laminated with a shallow crown
                 anyway, so a couple of per cent of the relief is both the fix
                 and the truth. */
              const wu=clamp((Math.abs(alo))/Math.max(wHalfA,1e-6),0,1);
              const wv=clamp((Math.abs(acr-wOff))/Math.max(wHalfC,1e-6),0,1);
              h+=win*R0*0.014*Math.sqrt(Math.max(0,1-wu*wu*0.85-wv*wv*0.85));
              r=lerp(r,glass[0]*1.1,win*0.92);g=lerp(g,glass[1]*1.1,win*0.92);b=lerp(b,glass[2]*1.1,win*0.92);
              rough=lerp(rough,0.09,win*0.9);met=lerp(met,0.8,win*0.85);
              /* the rebate is MACHINED METAL, not shadow: a dark lip round a
                 dark window is one dark shape, and the frame is what says
                 the window is set into something */
              const lip=clamp(rebate-win,0,1);
              r=lerp(r,r*1.12+16,lip*0.75);g=lerp(g,g*1.12+16,lip*0.75);b=lerp(b,b*1.10+15,lip*0.75);
              rough=lerp(rough,0.34,lip*0.7);met=lerp(met,0.94,lip*0.7);
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
               knurled shells, and the dark pin faces behind them */
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

        /* ---------------- the deck, where the plate is open ----------------
           An opening is a hole, so everything in it is BELOW the plate: the
           rebate the panel seated on, then the deck. Nothing here is allowed
           to come up through the surface, which is the whole difference
           between plumbing under a lid and cable dressed over a radar. */
        let openN=0;
        if(gone){
          /* the rebate: the seating the panel bolted down onto, one panel
             thickness below the surface and a frame's width wide */
          const lip=smoothstep(gut,gut+bev,rec.dEdge);
          const seat=clamp(smoothstep(gut+fw*0.75,gut+fw*0.75+bev,rec.dEdge),0,1);
          h-=lip*panelT;
          openN=seat;
          if(seat>0.004){
            /* and an anchor point at each corner of the seating, which is what
               a captive fastener leaves behind when its panel is gone */
            const inset=gut+fw*0.38;
            const au=Math.abs(Math.abs(rec.lu-0.5)*bw-(bw*0.5-inset));
            const av=Math.abs(Math.abs(rec.lv-0.5)*bh-(bh*0.5-inset));
            const ad=Math.sqrt(au*au+av*av);
            const anch=(1-smoothstep(boltR*0.9,boltR*1.3,ad))*clamp(lip-seat,0,1);
            h+=anch*panelT*0.35;
            met=lerp(met,0.95,anch*0.8);
          }
        }else if(gapSee){
          openN=inGut;                              // a stretch of open gap
        }
        if(openN>0.004){
          DK.at(u,v,dOut);
          const dh=dOut.y;
          /* the deck is only seen THROUGH the opening, so it can never write a
             height above the plate: whatever it reports is clamped to the lip
             of the hole it is seen through */
          const dy=Math.min(dh,-panelT*1.05);
          h=lerp(h,dy,openN);
          let dr,dg,db,drg,dmt;
          if(dOut.kind===0){
            /* the floor of the deck: dark, dusty, and nothing you can make out */
            dr=dark[0]*0.55;dg=dark[1]*0.55;db=dark[2]*0.58;drg=0.94;dmt=0.05;
          }else{
            /* conduit, or a cable bundle. Which one is a per-LINE draw, so a
               run is one thing for its whole length rather than changing
               material every few texels. */
            const isCable=hashi(dOut.line,dOut.layer*29+7,seed+9137)<P.deckCable;
            if(isCable){
              const tint=0.72+hashi(dOut.line,dOut.layer*29+11,seed+9137)*0.5;
              dr=cable[0]*tint;dg=cable[1]*tint;db=cable[2]*tint;
              drg=0.72;dmt=0.06;
            }else{
              const tint=0.5+hashi(dOut.line,dOut.layer*29+13,seed+9137)*0.28;
              dr=plate[0]*tint;dg=plate[1]*tint;db=plate[2]*tint;
              drg=clamp(+P.rough*1.1,0.1,1);dmt=0.9;
            }
            /* a tie or a clamp every so often along the run */
            const tiePitch=deckPitch*(3.2+hashi(dOut.line,dOut.layer*29+17,seed+9137)*3);
            const tie=(1-smoothstep(tiePitch*0.08,tiePitch*0.14,
                                    edgeDist(dOut.along,tiePitch)))*P.deckTie;
            if(tie>0.01){
              dr=dr*0.72+10;dg=dg*0.72+10;db=db*0.7+9;
              drg=clamp(drg*0.8,0.08,1);dmt=lerp(dmt,0.92,0.6);
            }
            /* the deeper a run sits, the less light reaches it */
            const shade=1-clamp((-dh)/Math.max(deckD,1e-6),0,1)*0.45;
            dr*=shade;dg*=shade;db*=shade;
          }
          r=lerp(r,dr,openN);g=lerp(g,dg,openN);b=lerp(b,db,openN);
          rough=lerp(rough,drg,openN);met=lerp(met,dmt,openN);
          emi*=1-openN;                              // no lamp shines inside a hole
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
  blurb:"Sensor and antenna cluster — AESA faces, dishes, lenses, a deck below",
  title:'Sensor <em>Cluster</em>',
  tagline:"AESA · dishes · multi-element lenses · antennas · open panels · seamless",
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
      openFrac:.14,gapSee:.4,panelT:7,deckD:80,deckPitch:28,deckLayers:3,deckFill:.82,deckCable:.4,deckTie:.85,
      lensElem:4,lensBlades:7,lensCoat:.55,cCable:"#6b5a44",
      grime:.45,scratch:.3,rough:.5,metalness:.88,
      cPlate:"#8b9096",cDark:"#2b2f33",cRadome:"#c9c6bd",cGlass:"#1b2026",cLamp:"#ff9a3c"}},
    {id:"nose",label:"Aircraft nose array",set:{
      tileM:1.6,rows:4,colsMin:1,colsMax:3,subdiv:.35,subdepth:1,
      gutter:8,frame:14,bevel:1.5,relief:45,
      devDens:.95,radome:.55,
      wAesa:2.2,wDish:.1,wSat:.2,wCam:.6,wBlade:.3,wWhip:.1,wDome:.2,
      wHorn:.2,wGrille:.55,wConn:.5,wWarn:.5,wLaser:.4,
      bolts:.75,boltD:8,lamps:.08,glow:.7,
      openFrac:.08,gapSee:.22,panelT:4,deckD:40,deckPitch:16,deckLayers:3,deckFill:.85,deckCable:.5,deckTie:.9,
      lensElem:5,lensBlades:8,lensCoat:.7,cCable:"#5f5344",
      grime:.3,scratch:.35,rough:.44,metalness:.9,
      cPlate:"#9aa0a6",cDark:"#2f3337",cRadome:"#d5d2c9",cGlass:"#161b21",cLamp:"#49d8ff"}},
    {id:"satbus",label:"Satellite bus",set:{
      tileM:2.4,rows:4,colsMin:2,colsMax:4,subdiv:.45,subdepth:2,
      gutter:10,frame:16,bevel:2,relief:75,
      devDens:.85,radome:.15,
      wAesa:.5,wDish:1.4,wSat:1.0,wCam:.5,wBlade:.2,wWhip:.5,wDome:.6,
      wHorn:.9,wGrille:.2,wConn:.6,wWarn:.15,wLaser:.2,
      bolts:.5,boltD:10,lamps:.25,glow:.9,
      openFrac:.18,gapSee:.3,panelT:5,deckD:60,deckPitch:20,deckLayers:3,deckFill:.88,deckCable:.55,deckTie:.8,
      lensElem:4,lensBlades:6,lensCoat:.6,cCable:"#7a6446",
      grime:.12,scratch:.15,rough:.4,metalness:.92,
      cPlate:"#7f858c",cDark:"#22262a",cRadome:"#e2ded2",cGlass:"#12171d",cLamp:"#ffd06a"}},
    {id:"turret",label:"EO turret cluster",set:{
      tileM:1.2,rows:3,colsMin:1,colsMax:3,subdiv:.4,subdepth:1,
      gutter:7,frame:12,bevel:1.5,relief:38,
      devDens:1,radome:.2,
      wAesa:.25,wDish:.1,wSat:.1,wCam:2.4,wBlade:.15,wWhip:.1,wDome:.35,
      wHorn:.1,wGrille:.3,wConn:.5,wWarn:.6,wLaser:1.1,
      bolts:.7,boltD:7,lamps:.3,glow:1,
      openFrac:.06,gapSee:.18,panelT:3,deckD:30,deckPitch:12,deckLayers:2,deckFill:.8,deckCable:.45,deckTie:.85,
      lensElem:5,lensBlades:9,lensCoat:.85,cCable:"#5a4d3c",
      grime:.4,scratch:.4,rough:.48,metalness:.86,
      cPlate:"#6e747a",cDark:"#232629",cRadome:"#bdb9b0",cGlass:"#141a20",cLamp:"#ff5a3c"}},
    {id:"ground",label:"Ground station",set:{
      tileM:6,rows:3,colsMin:1,colsMax:3,subdiv:.3,subdepth:1,
      gutter:26,frame:40,bevel:5,relief:220,
      devDens:.75,radome:.25,
      wAesa:.5,wDish:1.6,wSat:.7,wCam:.2,wBlade:.5,wWhip:.7,wDome:.8,
      wHorn:.5,wGrille:.4,wConn:.5,wWarn:.1,wLaser:.05,
      bolts:.55,boltD:22,lamps:.15,glow:.8,
      openFrac:.2,gapSee:.45,panelT:16,deckD:220,deckPitch:70,deckLayers:3,deckFill:.75,deckCable:.35,deckTie:.8,
      lensElem:3,lensBlades:6,lensCoat:.4,cCable:"#6e5c42",
      grime:.6,scratch:.25,rough:.58,metalness:.8,
      cPlate:"#96999a",cDark:"#31353a",cRadome:"#cfccc4",cGlass:"#1a1f25",cLamp:"#ff9a3c"}},
    {id:"derelict",label:"Derelict — stripped",set:{
      tileM:3.2,rows:5,colsMin:2,colsMax:5,subdiv:.55,subdepth:2,
      gutter:14,frame:20,bevel:3,relief:80,
      devDens:.45,radome:.1,
      wAesa:.6,wDish:.3,wSat:.2,wCam:.2,wBlade:.4,wWhip:.4,wDome:.2,
      wHorn:.3,wGrille:.5,wConn:1.0,wWarn:.2,wLaser:.1,
      bolts:.7,boltD:12,lamps:0,glow:0,
      openFrac:.5,gapSee:.75,panelT:7,deckD:90,deckPitch:26,deckLayers:3,deckFill:.7,deckCable:.5,deckTie:.35,
      lensElem:3,lensBlades:6,lensCoat:.25,cCable:"#5e5140",
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
        "deck below shows through."}
    ]},
    {title:"Devices",open:true,rows:[
      {id:"devDens",label:"Bays with a device",min:0,max:1,step:0.01,value:0.85}
    ].concat(WEIGHTS.map(w=>({id:w.id,label:w.label,min:0,max:2.5,step:0.05,value:w.value})))
     .concat([
      {id:"radome",label:"Arrays under a cover",min:0,max:1,step:0.01,value:0.3},
      {id:"lensElem",label:"Lens element groups",min:1,max:6,step:1,value:4},
      {id:"lensBlades",label:"Iris blades",min:4,max:10,step:1,value:7},
      {id:"lensCoat",label:"Lens coating",min:0,max:1,step:0.01,value:0.55},
      {type:"note",html:"These twelve are <b>weights</b>, not a chain: one at zero never "+
        "appears, and doubling one makes it twice as likely against the rest. A device is also "+
        "chosen by <b>fit</b> — a dish wants square ground and a blade antenna a long strip, so "+
        "each is only offered a bay of the shape it needs, and a bay too small for anything is "+
        "left as plain plate rather than filled with mush."},
      {type:"note",html:"<b>Arrays under a cover</b> is how many AESA faces get a composite "+
        "radome over them: the element lattice goes to a ghost and the face turns dielectric, "+
        "which is what a covered array looks like from outside."},
      {type:"note",html:"<b>A lens is an assembly.</b> Bezel, knurl, a retaining ring with the "+
        "wrench slots it is turned by, a <b>convex</b> front element — the curvature is what "+
        "puts a ring highlight on it rather than a flat sheen — the element groups behind it "+
        "each with their own coating tint, baffle rings down the barrel, and an iris that is a "+
        "<b>polygon</b> because it is made of blades. Multi-coating is why real lenses flash "+
        "magenta and green, and it is the strongest cue that a dark circle is a lens rather "+
        "than a socket. Below nine texels of radius none of it survives, so the assembly drops "+
        "back to a plain bore instead of turning to mush."}
     ])},
    {title:"Fasteners & lamps",rows:[
      {id:"bolts",label:"Frame bolts",min:0,max:1,step:0.01,value:0.6},
      {id:"boltD",label:"Bolt diameter",unit:"mm",min:2,max:50,step:0.5,value:12},
      {id:"lamps",label:"Status lamps",min:0,max:1,step:0.01,value:0.18},
      {id:"glow",label:"Emissive strength",min:0,max:1,step:0.01,value:0.85},
      {type:"note",html:"Skipped on any frame too narrow to hold them."}
    ]},
    {title:"Panels & the deck below",open:true,rows:[
      {id:"openFrac",label:"Panels removed",min:0,max:1,step:0.01,value:0.14},
      {id:"gapSee",label:"Gaps open to the deck",min:0,max:1,step:0.01,value:0.35},
      {id:"panelT",label:"Panel thickness",unit:"mm",min:1,max:60,step:0.5,value:6},
      {id:"deckD",label:"Deck depth",unit:"mm",min:5,max:400,step:5,value:70},
      {id:"deckPitch",label:"Conduit pitch",unit:"mm",min:4,max:200,step:2,value:26},
      {id:"deckLayers",label:"Crossed layers",min:1,max:3,step:1,value:3},
      {id:"deckFill",label:"How packed",min:0,max:1,step:0.01,value:0.8},
      {id:"deckCable",label:"Cable, not conduit",min:0,max:1,step:0.01,value:0.4},
      {id:"deckTie",label:"Ties & clamps",min:0,max:1,step:0.01,value:0.8},
      {type:"note",html:"<b>Nothing runs over the top of this plate.</b> A cable dressed "+
        "across the face of an array is not an installation — it is a cable somebody would "+
        "trip over. The plate is the <b>lid</b>: the plumbing is underneath, and you see it "+
        "where the lid is opened."},
      {type:"note",html:"Every bay is a removable <b>panel</b>, and the gap between panels is "+
        "a real gap cut through the panel's thickness. <b>Gaps open to the deck</b> is how much "+
        "of that gap's length opens all the way down rather than bottoming out — which "+
        "stretches is hashed on the coordinate the gap runs along, so both sides of a seam "+
        "agree and a slot is never open on one side and shut on the other. <b>Panels "+
        "removed</b> takes the panel away altogether and leaves the rebate it seated on, its "+
        "anchor points, and the deck wide open."},
      {type:"note",html:"The deck is <b>crossed layers</b>: the lowest runs one way, the next "+
        "across it a conduit higher, the third across that again — which is what makes it read "+
        "as deep rather than as a texture at the bottom of a hole. Every layer is on its own "+
        "lattice, so however packed it looks it costs one lookup a layer."}
    ]},
    {title:"Finish",rows:[
      {type:"colors",label:"Plate · recess · composite · glass · lamp · cable",items:[
        {id:"cPlate",value:"#8b9096"},{id:"cDark",value:"#2b2f33"},
        {id:"cRadome",value:"#c9c6bd"},{id:"cGlass",value:"#1b2026"},
        {id:"cLamp",value:"#ff9a3c"},{id:"cCable",value:"#6b5a44"}]},
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
    if(linePx<1.2)m+="<br>panel gap "+linePx.toFixed(1)+" px — held at a texel";
    /* THE LENS ASSEMBLY NEEDS ROOM, and the answer to "why are my lenses plain
       bores" is arithmetic. The biggest lens a camera bay can hold is a little
       over a third of the face's short side. */
    if((+P.wCam||0)>0){
      const lensPx=facePx*0.34*0.5;
      m+="<br>largest lens <b>"+Math.max(0,lensPx).toFixed(0)+" px</b> radius — "+
         (lensPx>=9?"the full element stack":"a plain bore, under the 9 px the stack needs");
    }
    const deckPx=P.deckPitch/1000*pxPerM;
    if(P.openFrac>0||P.gapSee>0){
      m+="<br>deck conduit every <b>"+deckPx.toFixed(0)+" px</b>"+
         (deckPx<3?" — too fine to read; widen the pitch":"");
    }
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
      "A mounting plate carved into BAYS, each a removable panel holding one device",
      "inside its own frame. NOTHING RUNS OVER THE TOP: the plate is the lid, and the",
      "plumbing is a dense sub-deck of conduit and cable in crossed layers underneath,",
      "seen through the gaps between panels and through the ones that have been removed.",
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
      "               No lamp shines inside an opening, so the deck is always black here.",
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
  pickTables:pickTables,deckOf:deckOf
};

})();
