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
   several million times a build. */
function routes(g,p){
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

  const out=[];
  /* Layer 0 is deepest. Its conduits are the fat ones — the things that went in
     first — and each layer above is finer and sits proud of the one below, so
     the strata read as an order of assembly rather than as a random pile. */
  for(let Ly=0;Ly<layers;Ly++){
    const t=layers>1?Ly/(layers-1):1;
    const gMax=lerp((+p.gaugeMaxMm||46)/1000,(+p.gaugeMinMm||9)/1000,t);
    const gMin=lerp((+p.gaugeMinMm||9)/1000*1.6,(+p.gaugeMinMm||9)/1000,t);
    /* the axis height of this layer: deepest sits on the backplane, the top
       layer just under the panel line, with room for the fattest conduit */
    const z0=lerp(gMax,cav-gMax*1.15,layers>1?t:0.55);

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
      const half=(n-1)*0.5*pitch+r;

      /* THE BEND CLAMP. Three bundle half-widths is about the tightest a loom
         is dressed to, and it is also comfortably inside the "gentle next to
         its own width" the stamp needs. */
      const minR=Math.max(half*3.0,r*6);
      const mat=MATBY[pick(K.mats)];
      nextQ();

      /* INTERPOLATE THE DEVIATION, NOT THE ANGLE. Blending a uniform heading
         towards an axis angle looks right and is not: at half strength it is
         half of a number that runs to 2π, so every route comes out inside the
         first three radians and the whole loom lies one way. Pick the
         deviation FROM the axis instead and scale that, and the two ends mean
         what they say — free at nought, dressed to the axis at one. */
      const base=(rng()<0.5?0:Math.PI*0.5)+(rng()<0.5?0:Math.PI);
      const head0=base+(rng()*2-1)*Math.PI*(1-axis)+rr(-0.28,0.28)*axis;

      /* HOW MUCH IS TOO MUCH. Long enough to cross the tile and come back,
         and no longer: past that every layer is buried by the one over it,
         the backplane never shows, and the strata — which are the subject —
         stop reading at all. */
      const len=Math.max(g.Wm,g.Hm)*rr(0.7,1.8);
      const seed=(rng()*1e9)|0;
      const w=wander*rr(0.5,1.35);
      const clampM=rr(0.19,0.45);

      const walk=integrate(g,{
        x:qx*g.Wm,y:qy*g.Hm,head:head0,len:len,minR:minR,half:half,
        wander:w,seed:seed,stepM:stepM,rng:mulberry32(seed^0x5bf03635)
      });
      if(walk.nPts<8)continue;

      out.push({
        layer:Ly,kind:k,n:n,r:r,pitch:pitch,half:half,mat:mat,z0:z0,seed:seed,
        pts:walk.pts,nPts:walk.nPts,len:walk.nPts*stepM,
        tail:Math.min(0.05,len*0.22),
        ident:(rng()<clamp(+p.identAmt,0,1)*0.75)?IDENT[Math.floor(rng()*IDENTN)|0]:null,
        /* WHOLE-LENGTH SLEEVING, not just bands. Some runs are colour-coded end
           to end, and without a few of them a bay of forty conduits is forty
           greys however carefully each one is shaded. */
        sleeve:(k!==5&&rng()<clamp(+p.identAmt,0,1)*0.22)
          ?IDENT[Math.floor(rng()*IDENTN)|0]:null,
        tint:rr(0.86,1.14),
        /* HOW OFTEN A LOOM IS ACTUALLY CLAMPED DOWN. A P-clamp every 200 to
           450 mm is what the trade does. Every 50 to 130, which is the instinct
           because it fills the picture, chops each bundle into a chain of short
           capsules and every run in the bay reads as a segmented worm. */
        fit:clampAmt>0?{
          style:1,pitch:clampM,
          half:Math.min(0.008,r*0.7),proud:r*0.34,
          tie:(tieAmt>0)?{pitch:clampM*0.34,
                          half:Math.max(0.0008,Math.min(0.0022,r*0.14)),
                          proud:r*0.13}:null
        }:null
      });
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
   afterwards would read the wrap as a jump a whole tile wide. */
function integrate(g,o){
  const stepM=o.stepM,maxTurn=stepM/o.minR,rng=o.rng;
  const bay=g.bay;
  const cap=Math.min(200000,Math.round(o.len/stepM));
  const pts=new Float64Array(cap*4);
  let x=o.x,y=o.y,head=o.head,n=0,s=0;
  let corner=0,cornerDir=1;
  for(let i=0;i<cap;i++){
    if(corner>0){
      head+=maxTurn*cornerDir;corner--;
    }else{
      head+=clamp((L.fbm1(s*3.1,3,o.seed)-0.5)*2*o.wander,-1,1)*maxTurn;
      if(rng()<stepM*0.55){
        corner=Math.round((Math.PI*0.5/maxTurn)*(0.55+rng()*0.75));
        cornerDir=rng()<0.5?-1:1;
      }
    }
    const tx=Math.cos(head),ty=Math.sin(head);
    x+=tx*stepM;y+=ty*stepM;s+=stepM;
    if(bay){
      /* off the edge of the aperture is off the end of the route: it has gone
         somewhere else in the airframe, which is what a grommet means */
      if(x<-o.half||y<-o.half||x>g.Wm+o.half||y>g.Hm+o.half)break;
    }else{
      if(x<0)x+=g.Wm;else if(x>=g.Wm)x-=g.Wm;
      if(y<0)y+=g.Hm;else if(y>=g.Hm)y-=g.Hm;
    }
    const q=n*4;
    pts[q]=x;pts[q+1]=y;pts[q+2]=tx;pts[q+3]=ty;
    n++;
  }
  return {pts:pts,nPts:n};
}

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
      piece:"tile",tileMm:620,cavityMm:95,layers:4,bundles:3,groupMax:5,
      gaugeMinMm:9,gaugeMaxMm:46,wander:.55,axis:.45,
      wTube:.7,wCorr:1,wBraid:.8,wSpiral:.5,wRibbon:.15,wLagged:.6,
      clampAmt:1,tieAmt:.7,identAmt:.5,lamps:.15,
      ribMm:78,ribWMm:16,ribHMm:7,holeMm:34,
      oil:.45,dust:.3,heat:.4,scuff:.35,aoStr:1,
      mCurve:.5,mGrain:.4,mDust:.35,
      cPlate:"#4c5054",cDeep:"#0b0c0d",cLamp:"#49ff9c"}},

    {id:"harness",label:"Wiring harness",set:{
      piece:"tile",tileMm:380,cavityMm:70,layers:4,bundles:4,groupMax:7,
      gaugeMinMm:6,gaugeMaxMm:22,wander:.7,axis:.3,
      wTube:.15,wCorr:.5,wBraid:.4,wSpiral:1,wRibbon:.5,wLagged:0,
      clampAmt:1,tieAmt:1,identAmt:.9,lamps:.05,
      ribMm:60,ribWMm:12,ribHMm:5,holeMm:24,
      oil:.15,dust:.35,heat:.05,scuff:.25,aoStr:1,
      mCurve:.5,mGrain:.45,mDust:.4,
      cPlate:"#565a5e",cDeep:"#0c0d0f",cLamp:"#ffb648"}},

    {id:"hydraulic",label:"Hydraulic run",set:{
      piece:"tile",tileMm:540,cavityMm:85,layers:3,bundles:2,groupMax:4,
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
      piece:"tile",tileMm:900,cavityMm:120,layers:5,bundles:5,groupMax:6,
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
      {type:"note",html:"A <b>bundle</b> is a group: several conduits laid parallel at a fixed "+
        "pitch and routed as one, so on a bend the inner ones take a tighter radius than the "+
        "outer ones. Layer 1 is deepest and carries the fattest items."}
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
  plan:function(p){const g=geom(p);return {w:g.Wm,h:g.Hm,cutout:g.bay};},

  tileTag:function(p){return isBay(p)?"":"Tiles ↔ and ↕";},

  readout:function(p){
    const g=geom(p);
    const bundles=clamp(p.layers|0,1,6)*clamp(p.bundles|0,1,10);
    const px=(g.pxM/1000).toFixed(3);
    return "<b>"+Math.round(g.Wm*1000)+" × "+Math.round(g.Hm*1000)+" mm</b> · "+
      g.TW+" × "+g.TH+" px<br>"+
      "<b>"+(g.mpp*1000).toFixed(2)+" mm per texel</b> · "+Math.round(g.pxM)+" px/m<br>"+
      bundles+" bundles over "+clamp(p.layers|0,1,6)+" layers, "+
      "up to "+clamp(p.groupMax|0,1,8)+" conduits each<br>"+
      "cavity "+Math.round((+p.cavityMm||95))+" mm · gauges "+
      Math.round(+p.gaugeMinMm||9)+"–"+Math.round(+p.gaugeMaxMm||46)+" mm";
  },

  readme:function(p,info){
    const g=geom(p);
    const bay=isBay(p);
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
    ].filter(x=>x!==null).join("\n");
  }
});

})();
