/* =====================================================================
   MODE: house — American house front elevation
   =====================================================================
   A composed facade rather than a tiling texture, dimensioned in feet.
   Output is non-square at uniform texel density and carries an alpha
   channel, so a gable front gives a real cut-out silhouette.

   Was elevation-forge.html. The generator lives in lib/house-shell.js and
   is shared with the envelope mode, so the side and back of the house are
   the same house: same siding, same trim, same weathering, same seed.
   ===================================================================== */
"use strict";

(function(){
const Shell=window.HouseShell;

/* ============================ mode definition ============================ */
Forge.register({
  id:"house",
  label:"House",
  blurb:"American house front elevation",
  title:'Front <em>Elevation</em>',
  tagline:"American house facade · PBR · PNG",
  actionLabel:"Build elevation",
  busyLabel:"Building…",
  seamless:false,
  backdrops:true,
  flipPreviewY:true,
  previewSize:200,
  chipSource:120,                    // a facade chip does not need 176 px of source
  preview:{gain:3.0,amb:1.2,specK:0.5,skyLo:[0.20,0.22,0.26],skyHi:[0.42,0.47,0.55]},

  channels:[
    {key:"basecolor",label:"Base + α"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Rough"},{key:"metallic",label:"Metal"},
    {key:"ao",label:"AO"},{key:"height",label:"Height"},{key:"orm",label:"ORM"},
    {key:"id",label:"Mat ID"},{key:"emissive",label:"Emissive"},{key:"opacity",label:"Opacity"}
  ],

  /* the presets describe the house, not the face: the envelope mode offers
     the same names so the front, the side and the back agree */
  presets:Shell.PRESETS,

  controls:[
    {title:"Building",open:true,rows:[
      {id:"size",type:"select",label:"Texture width",value:1024,showValue:true,options:[
        [512,"512"],[1024,"1024"],[2048,"2048"],[4096,"4096 — slow, heavy"]]},
      {type:"readout"},
      {id:"facadeW",label:"Facade width",unit:"ft",min:12,max:60,step:0.5,value:26},
      {id:"storeys",label:"Storeys",min:1,max:3,step:1,value:2},
      {id:"storeyH",label:"Storey height",unit:"ft",min:7,max:13,step:0.25,value:9},
      {id:"foundH",label:"Foundation",unit:"ft",min:0,max:5,step:0.1,value:1.8},
      {id:"roof",type:"select",label:"Roof facing the street",value:"eave",options:[
        ["eave","Eave front — soffit and gutter"],["gable","Gable front — triangle"],["flat","Flat / parapet"]]},
      {id:"pitch",label:"Roof pitch",unit:":12",min:2,max:14,step:0.5,value:6},
      {id:"seed",type:"seed",value:1912}
    ]},
  ].concat(Shell.controls(["cladding","openings","glass","trim","weathering","abandonment","maps"])),

  needs:function(P){
    const need=["front"];              // the door-bay rows the other faces do not have
    if(Shell.LAPPY[P.clad])need.push("lap");
    if(P.clad==="batten")need.push("batten");
    if(Shell.MASONRY[P.clad])need.push("masonry");
    if(P.aband>0)need.push("ab");
    return need;
  },

  readout:function(P){
    const g=Shell.geometry(P,"front");
    const pxPerFt=(P.size|0)/P.facadeW;
    let m="<b>"+g.FW.toFixed(1)+" × "+g.FH.toFixed(1)+" ft</b> · "+(P.size|0)+" × "+g.TH+" px<br>"+
      Math.round(pxPerFt)+" px/ft · "+(12/pxPerFt).toFixed(2)+" in per texel";
    if(pxPerFt<28)m+=' <span class="warn">— muntins and joints will be soft</span>';
    m+="<br>eaves at <b>"+g.wallTop.toFixed(1)+" ft</b>"+(g.gableH>0?", ridge at "+g.FH.toFixed(1)+" ft":"");
    return m;
  },

  /* non-square at uniform texel density; the drag preview keeps the aspect */
  size:function(P,preview){return Shell.size(P,"front",preview);},
  build:function(P,io){return Shell.build(P,io,"front");},

  writers:function(B){
    const ID=B.ID,IDCOL=Shell.IDCOL;
    return {id:function(i,o,k){
      const c=IDCOL[ID[i]]||IDCOL[0];
      o[k]=c[0];o[k+1]=c[1];o[k+2]=c[2];
      return 255;
    }};
  },

  fileBase:function(P,W,H){return "house_"+(P.seed|0)+"_"+W+"x"+H;},

  readme:function(P,info){
    const g=Shell.lastGeo("front")||Shell.geometry(P,"front");
    return ["Texture Forge · house — American house front elevation",
      "",
      "Seed "+(P.seed|0)+"   Texture "+info.W+" x "+info.H+" px",
      "Facade "+g.FW.toFixed(2)+" ft wide x "+g.FH.toFixed(2)+" ft tall  ("+(info.W/g.FW).toFixed(1)+" px per foot)",
      "Scale your plane to that footprint and the trim, siding and openings sit at true size.",
      "",
      "This is a single elevation, not a tiling texture. It has an alpha channel: the sky",
      "above the roofline is transparent, so map it onto a plane and it cuts out cleanly.",
      "",
      "basecolor.png  sRGB albedo, alpha = facade silhouette. Import as sRGB.",
      "normal.png     Tangent space, "+info.normalNote+". Non-colour.",
      "roughness.png  Linear grey.",
      "metallic.png   Linear grey. Hardware (gutter, downspout, knob, fasteners) plus the",
      "               glass, which is set metallic on purpose: on an opaque facade plane a",
      "               metallic pane picks up the environment and reads as glass, where a",
      "               physically-correct dielectric pane just looks like flat dark paint.",
      "               Doing real transparent glass instead? Set glass metallicity to 0 and",
      "               isolate the panes with the blue channel of id.png.",
      "ao.png         Linear grey; window reveals and the soffit carry most of it.",
      "height.png     8-bit displacement spanning "+((info.hMax-info.hMin)*12).toFixed(2)+" in of relief",
      "               ("+(info.hMin*12).toFixed(2)+" in to "+(info.hMax*12).toFixed(2)+" in). Deep window reveals eat most of the",
      "               range, so prefer height16.png for displacement.",
      "height16.png   The same field at 16 bits.",
      "orm.png        R = AO, G = roughness, B = metallic.",
      "emissive.png   Warm glow in lit window panes; black elsewhere.",
      "opacity.png    The silhouette on its own.",
      "id.png         Flat material ID colours:",
      "               cladding tan · trim white · glass blue · metal silver · masonry grey",
      "               bare wood brown · roof dark · board-up orange · door red-brown",
      "",
      "Normal strength baked at "+P.normalStr.toFixed(2)+"x."].join("\n");
  }
});

})();
