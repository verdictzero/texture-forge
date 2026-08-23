/* =====================================================================
   MODE: envelope — the rest of the house
   =====================================================================
   The house mode draws the street front. This one draws the walls either
   side of it: the side elevation and the back.

   Side and back come out of the same generator as the front
   (lib/house-shell.js), so the same seed and settings give one coherent
   building — the same siding coursing, the same trim, the same peeling
   paint, the same broken panes. What changes with the face is the width
   (the side is the depth of the house), which way the roof reads (an
   eave-front house is a gable end from the side), where the openings go,
   and what service clutter hangs on the wall.

   The roof over both is its own mode — it is a tiling material rather than
   a cut-out piece, and it belongs beside the house rather than inside it.
   ===================================================================== */
"use strict";

(function(){
const Shell=window.HouseShell;
const wall=P=>P.face==="side"?"side":"back";

const FACES=[["side","Side elevation"],["back","Back elevation"]];

const wallGroups=Shell.controls(["cladding","openings","glass","trim","weathering","abandonment","micro","maps"])
  .map(function(g){
    const c={};for(const k in g)c[k]=g[k];
    c.need=["side","back"];
    return c;
  });

Forge.register({
  id:"envelope",
  label:"Envelope",
  group:"Buildings",
  /* The graffiti is drawn with a face registered against the DOCUMENT, and a
     worker cannot see one — it would silently fall back to the scrawl and hand
     back a different wall from the one the main thread draws. So this goes off
     thread only when there is no lettering on it. */
  threadable:function(P){return !((+P.graffiti||0)>0);},
  blurb:"Side and back elevations — the faces of the house nobody photographs",
  title:'Building <em>Envelope</em>',
  tagline:"Side & back elevations · keyed to the house mode",
  actionLabel:"Build face",
  busyLabel:"Building…",

  seamless:false,                    // one face of a house, not a repeating panel
  backdrops:true,
  flipPreviewY:true,
  previewSize:Shell.PREVIEW_W,
  chipSource:150,

  preview:{gain:3.0,amb:1.2,specK:0.5,skyLo:[0.20,0.22,0.26],skyHi:[0.42,0.47,0.55]},

  channels:[
    {key:"basecolor",label:"Base + α"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Rough"},{key:"metallic",label:"Metal"},
    {key:"ao",label:"AO"},{key:"height",label:"Height"},{key:"orm",label:"ORM"},
    {key:"id",label:"Mat ID"},{key:"emissive",label:"Emissive"},{key:"opacity",label:"Opacity"}
  ],

  presets:Shell.PRESETS,

  controls:[
    {title:"Output",open:true,rows:[
      {id:"size",type:"select",label:"Texture width",value:1024,showValue:true,options:Forge.sizes("plain")},
      {id:"face",type:"select",label:"Face",value:"side",options:FACES},
      {type:"readout"},
      {id:"seed",type:"seed",value:1912},
      {type:"checks",items:[{id:"linkHouse",label:"Coordinate with the house modes",value:false}]}
    ]},
    {title:"Building",open:true,need:["side","back"],rows:[
      {id:"facadeW",label:"Facade width",unit:"ft",min:12,max:60,step:0.5,value:26},
      {id:"depthFt",label:"House depth",unit:"ft",min:12,max:70,step:0.5,value:34},
      {id:"storeys",label:"Storeys",min:1,max:3,step:1,value:2},
      {id:"storeyH",label:"Storey height",unit:"ft",min:7,max:13,step:0.25,value:9},
      {id:"foundH",label:"Foundation",unit:"ft",min:0,max:5,step:0.1,value:1.8},
      {id:"roof",type:"select",label:"Roof facing the street",value:"eave",options:[
        ["eave","Eave front — fascia and gutter"],["gable","Gable front — triangle"],["flat","Flat / parapet"]]},
      {id:"pitch",label:"Roof pitch",unit:":12",min:2,max:14,step:0.5,value:6},
      {type:"note",html:"Set these to match the <b>house</b> mode and the faces line up: "+
        "the side is the depth of the same building, and an eave front gives a gable end from the side."}
    ]},
    {title:"Side wall",open:true,need:"side",rows:[
      {id:"sideEnd",type:"select",label:"Which end",value:"right",options:[
        ["right","Right — front corner at the left edge"],
        ["left","Left — back corner at the left edge"]]},
      {id:"sideBays",label:"Bays along the side",min:1,max:6,step:1,value:3},
      {id:"sideBlank",label:"Blank bays",min:0,max:0.8,step:0.05,value:0.2},
      {type:"checks",items:[
        {id:"stairWin",label:"Stair landing window",value:true},
        {id:"sideDoor",label:"Service door",value:false}]}
    ]},
    {title:"Back wall",open:true,need:"back",rows:[
      {id:"backDoor",type:"select",label:"Back opening",value:"door",options:[
        ["door","Back door"],["slider","Sliding patio door"],["none","None — blank bay"]]},
      {id:"backDoorBay",label:"Back door in bay",min:1,max:7,step:1,value:1},
      {type:"checks",items:[
        {id:"backHood",label:"Hood over the back door",value:false},
        {id:"backLight",label:"Light beside the door",value:true},
        {id:"dryerVent",label:"Dryer vent",value:true}]}
    ]},
    {title:"Service & furniture",need:["side","back"],rows:[
      {id:"chimney",type:"select",label:"Chimney",value:"none",options:[
        ["none","None"],["wall","On the wall"],["gable","Through the ridge"]]},
      {type:"checks",items:[
        {id:"meter",label:"Meter and service board",value:true},
        {id:"ventStack",label:"Vent stack",value:true},
        {id:"hoseBib",label:"Hose bib",value:true}]},
      {type:"note",html:"The plain faces are where the building's services land. "+
        "Nothing here appears on the front."}
    ]}
  ].concat(wallGroups),

  needs:function(P){
    const need=[P.face];
    if(Shell.LAPPY[P.clad])need.push("lap");
    if(P.clad==="batten")need.push("batten");
    if(Shell.MASONRY[P.clad])need.push("masonry");
    if(P.aband>0)need.push("ab");
    return need;
  },

  derive:function(P){Shell.coordinate("envelope",P);},

  readout:function(P){
    const g=Shell.geometry(P,wall(P));
    const pxPerFt=g.TW/g.FW;
    let m="<b>"+g.FW.toFixed(1)+" × "+g.FH.toFixed(1)+" ft</b> · "+g.TW+" × "+g.TH+" px<br>"+
      Math.round(pxPerFt)+" px/ft · "+(12/pxPerFt).toFixed(2)+" in per texel";
    if(pxPerFt<28)m+=' <span class="warn">— muntins and joints will be soft</span>';
    /* the height follows the facade, not the slider, so a tall narrow face can
       ask for more texels than a browser will hand out */
    if(g.capped)m+='<br><span class="warn">capped from '+g.asked+' px — this face is '
      +(g.FH/g.FW).toFixed(1)+'× taller than it is wide, and the full size would not fit in memory</span>';
    m+="<br>"+(P.face==="side"
      ? (g.gableH>0?"gable end, ridge at <b>"+g.FH.toFixed(1)+" ft</b>":"eave wall, eaves at <b>"+g.wallTop.toFixed(1)+" ft</b>")
      : "eaves at <b>"+g.wallTop.toFixed(1)+" ft</b>");
    if(g.chimW>0)m+=" · chimney to "+g.chimTop.toFixed(1)+" ft";
    return m;
  },

  tileTag:function(){return "single piece — one face of a house";},

  plan:function(P){
    const face=P.face||"side",g=Shell.geometry(P,face),FT=0.3048;
    return {w:g.FW*FT,h:g.FH*FT,cutout:true,eaves:g.wallTop*FT};
  },

  size:function(P,preview){return Shell.size(P,wall(P),preview);},
  build:function(P,io){return Shell.build(P,io,wall(P));},

  writers:function(B){
    const ID=B.ID,IDCOL=Shell.IDCOL;
    return {id:function(i,o,k){
      const c=IDCOL[ID[i]]||IDCOL[0];
      o[k]=c[0];o[k+1]=c[1];o[k+2]=c[2];
      return 255;
    }};
  },

  sizeTag:function(P){return P.face;},
  fileBase:function(P,W,H){return "house_"+P.face+"_"+(P.seed|0)+"_"+W+"x"+H;},

  readme:function(P,info){
    const g=Shell.lastGeo(wall(P))||Shell.geometry(P,wall(P));
    const side=P.face==="side";
    return ["Texture Forge · envelope — "+(side?"side":"back")+" elevation",
      "",
      "Seed "+(P.seed|0)+"   Texture "+info.W+" x "+info.H+" px",
      "Face "+g.FW.toFixed(2)+" ft wide x "+g.FH.toFixed(2)+" ft tall  ("+(info.W/g.FW).toFixed(1)+" px per foot)",
      side?"The side is the depth of the house, so its width is the depth setting, not the facade width.":"",
      "",
      "Built from the same generator and the same seed as the house mode, so with",
      "matching settings this face belongs to that house: the siding courses line up,",
      "the trim is the same stock and the weathering carries over.",
      "",
      "Alpha is the silhouette"+(g.chimW>0?", chimney included":"")+", so it cuts out cleanly on a plane.",
      "",
      "basecolor.png  sRGB albedo, alpha = silhouette. Import as sRGB.",
      "normal.png     Tangent space, "+info.normalNote+". Non-colour.",
      "roughness.png  Linear grey.",
      "metallic.png   Linear grey — hardware, flashing, the glass cheat (see the house readme).",
      "ao.png         Linear grey.",
      "height.png     8-bit displacement spanning "+((info.hMax-info.hMin)*12).toFixed(2)+" in of relief.",
      "height16.png   The same field at 16 bits — prefer it for displacement.",
      "orm.png        R = AO, G = roughness, B = metallic.",
      "emissive.png   Lit panes and the back light.",
      "opacity.png    The silhouette on its own.",
      "id.png         Flat material ID colours, same table as the house mode.",
      "",
      "Normal strength baked at "+P.normalStr.toFixed(2)+"x."].join("\n");
  }
});

})();
