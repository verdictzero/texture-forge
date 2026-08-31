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

  let x=o.x,y=o.y,head=o.head,n=0;
  let arc=o.firstCorner?nArc:0;
  let dir=o.firstDir||(rng()<0.5?-1:1);
  let leg=arc?0:o.legSteps();

  for(let i=0;i<cap;i++){
    if(arc>0){
      head+=arcTurn*dir;
      arc--;
      if(arc===0){
        head=Math.round(head/HALFPI)*HALFPI;
        leg=o.legSteps();
      }
    }else if(leg>0){
      leg--;
    }else{
      arc=nArc;dir=rng()<0.5?-1:1;
      head+=arcTurn*dir;arc--;
    }
    const tx=Math.cos(head),ty=Math.sin(head);
    x+=tx*stepM;y+=ty*stepM;
    if(bay){
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

/* ============================ the routes ============================ */
function routes(g,p){
  const rng=mulberry32((p.seed|0)*2654435761+7717);
  const pick=a=>a[Math.floor(rng()*a.length)|0];
  const rr=(a,b)=>a+rng()*(b-a);
  const stepM=L.stepM(g);

  const layers=clamp(p.layers|0,1,6);
  const perLayer=clamp(p.bundles|0,1,10);
  const cav=Math.max(0.01,(+p.cavityMm||95)/1000);
  const braceAmt=clamp(+p.braceAmt,0,1);
  const braceM=Math.max(0.02,(+p.braceMm||120)/1000);
  const branchAmt=clamp(+p.branches,0,1);
  const askedBend=Math.max(0.004,(+p.bendMm||45)/1000);

  /* THE LATTICE, SNAPPED TO THE TILE. A grid that does not divide the tile
     leaves the runs on one side of the wrap out of step with the runs on the
     other, and on a seamless map that is the first thing the eye finds. A bay
     has no wrap to close and keeps the grid it was given. */
  let grid=Math.max(0.01,(+p.gridMm||62)/1000);
  if(!g.bay)grid=g.Wm/Math.max(1,Math.round(g.Wm/grid));

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
  /* snapped to the lattice, so two runs a tile apart are on the same lines */
  const snap=(t,span)=>Math.round(t*span/grid)*grid;

  const out=[];

  /* one bundle, given where it starts and how it leaves */
  function make(Ly,z0,gMin,gMax,start){
    const k=kindOf(),K=KIND[k];
    const nMax=(k===4)?1:(k===5)?2:clamp(p.groupMax|0,1,8);
    const n=start&&start.n?start.n:1+Math.floor(rng()*nMax);
    const r=(start&&start.r)||rr(gMin,gMax)*0.5*((k===5)?1.7:1);
    const pitch=(start&&start.pitch)||r*2*rr(1.10,1.60);
    const half=(n-1)*0.5*pitch+r;
    const bendR=Math.max(askedBend,bendFloor(half,r));
    const legMin=Math.max(2,Math.round(grid/stepM));
    const seed=(rng()*1e9)|0;
    const len=Math.max(g.Wm,g.Hm)*rr(0.8,2.0);
    const wrng=mulberry32(seed^0x2545f491);

    const w=walk(g,{
      x:start?start.x:snap(qx,g.Wm),
      y:start?start.y:snap(qy,g.Hm),
      head:start?start.head:(rng()<0.5?0:HALFPI)+(rng()<0.5?0:Math.PI),
      firstCorner:!!(start&&start.corner),
      firstDir:start?start.dir:0,
      len:len,bendR:bendR,half:half,stepM:stepM,rng:wrng,
      /* legs are whole multiples of the lattice, which is what makes two
         parallel runs line up rather than merely run parallel */
      legSteps:()=>legMin*(1+Math.floor(wrng()*4))
    });
    if(w.nPts<12)return null;

    const R={
      layer:Ly,kind:k,n:n,r:r,pitch:pitch,half:half,
      mat:(start&&start.mat!==undefined)?start.mat:MATBY[pick(K.mats)],
      z0:z0,seed:seed,
      pts:w.pts,nPts:w.nPts,len:w.nPts*stepM,
      tail:Math.min(0.05,len*0.20),
      ident:(rng()<clamp(+p.identAmt,0,1)*0.75)?IDENT[Math.floor(rng()*IDENTN)|0]:null,
      sleeve:(k!==5&&rng()<clamp(+p.identAmt,0,1)*0.22)
        ?IDENT[Math.floor(rng()*IDENTN)|0]:null,
      tint:rr(0.86,1.14),
      /* THE BRACING. Intermittent by definition — a comb every so often, not a
         rail the whole way — and its half-length is what makes it read as a
         bracket a few millimetres thick rather than as a length of channel. */
      fit:braceAmt>0?{
        style:2,pitch:braceM,
        half:Math.max(0.0035,Math.min(0.011,r*0.75)),
        proud:r*0.26,tie:null
      }:null,
      bendR:bendR
    };
    out.push(R);
    return R;
  }

  for(let Ly=0;Ly<layers;Ly++){
    const t=layers>1?Ly/(layers-1):1;
    const gMax=lerp((+p.gaugeMaxMm||40)/1000,(+p.gaugeMinMm||8)/1000,t);
    const gMin=lerp((+p.gaugeMinMm||8)/1000*1.6,(+p.gaugeMinMm||8)/1000,t);
    const z0=lerp(gMax,cav-gMax*1.15,layers>1?t:0.55);

    for(let b=0;b<perLayer;b++){
      nextQ();
      const R=make(Ly,z0,gMin,gMax,null);
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
        make(Ly,z0+R.r*0.15,gMin,gMax,{
          x:R.pts[q]+off*-ty, y:R.pts[q+1]+off*tx,
          head:Math.atan2(ty,tx),
          corner:true,dir:side,
          n:kn,r:R.r,pitch:R.pitch,mat:R.mat
        });
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
  plan:function(p){const g=geom(p);return {w:g.Wm,h:g.Hm,cutout:g.bay};},

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
    let grid=Math.max(0.01,(+p.gridMm||62)/1000);
    if(!g.bay)grid=g.Wm/Math.max(1,Math.round(g.Wm/grid));
    return "<b>"+Math.round(g.Wm*1000)+" × "+Math.round(g.Hm*1000)+" mm</b> · "+
      g.TW+" × "+g.TH+" px<br>"+
      "<b>"+(g.mpp*1000).toFixed(2)+" mm per texel</b> · lattice snapped to "+
      Math.round(grid*1000)+" mm<br>"+
      runs+" runs over "+clamp(p.layers|0,1,6)+" layers, up to "+nMax+" conduits each<br>"+
      "bends <b>"+asked+" mm</b>"+(floorMm>asked
        ?(", opened to "+floorMm+" on the widest group — under that its inner "+
          "conduit turns inside out in the corner")
        :"")+
      " · braced every "+Math.round(+p.braceMm||120)+" mm";
  },

  readme:function(p,info){
    const g=geom(p);
    const bay=isBay(p);
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
    ].filter(x=>x!==null).join("\n");
  }
});

})();
