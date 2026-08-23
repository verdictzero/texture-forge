/* =====================================================================
   MODE: roof — seamless roofing material
   =====================================================================
   Three-tab and architectural asphalt shingle, wood shake, slate, clay
   barrel tile, standing-seam and corrugated metal, rolled roofing with
   gravel ballast. Everything is dimensioned in real inches and the
   course, tab, pan and corrugation counts are snapped so a whole number
   fits the tile — which is what lets it repeat without a seam.

   The generator lives in lib/roof.js. It is a library rather than a mode
   so the house family can share it: set the same seed here and in the
   house and envelope modes and the roof belongs to that building.
   ===================================================================== */
"use strict";

(function(){
const Roof=window.RoofGen;
const Shell=window.HouseShell;

const presets=Object.keys(Roof.presets).map(function(k){
  const set=Roof.presets[k];
  return {id:k,label:set.label||k,set:set.set||set};
});

Forge.register({
  id:"roof",
  label:"Roof",
  group:"Buildings",
  threadable:true,
  blurb:"Seamless roofing: shingle, shake, slate, tile, metal, rolled",
  title:'Roof <em>Covering</em>',
  tagline:"Shingle · shake · slate · tile · metal · seamless · real inches",
  actionLabel:"Lay roofing",
  busyLabel:"Laying…",

  seamless:true,
  previewSize:256,
  preview:{gain:3.0,amb:1.12,specK:0.55,skyLo:[0.16,0.19,0.23],skyHi:[0.34,0.38,0.44]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic"},
    {key:"ao",label:"AO"},{key:"height",label:"Height"},{key:"orm",label:"ORM packed"}
  ],

  presets:presets,

  controls:[
    {title:"Output",open:true,rows:[
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:Forge.sizes("square")},
      {type:"readout"},
      {id:"seed",type:"seed",value:1912},
      {type:"checks",items:[{id:"linkHouse",label:"Coordinate with the house modes",value:false}]}
    ]}
  ].concat(Roof.controls).concat([
    {title:"Maps",rows:[
      {id:"normalStr",label:"Normal strength",min:0.1,max:3,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:1},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ]),

  needs:function(P){return Roof.needs(P);},
  derive:function(P){if(Shell)Shell.coordinate("roof",P);},
  readout:function(P){return Roof.readout(P);},
  tileTag:function(){return "tiles ↔ and ↕";},

  /* a tiling material: the plane is one tile, and `tile` is what lets a roof
     plane in a whole-building export repeat it at true size instead of
     stretching one copy over the lot. Inches in, metres out. */
  plan:function(P){
    const t=Math.max(0.05,(+P.rfTileIn||96)*0.0254);
    return {w:t,h:t,tile:t,cutout:false};
  },

  size:function(P,preview){return Roof.size(P,preview);},
  build:function(P,io){return Roof.build(P,io);},

  sizeTag:function(P){return (((+P.rfTileIn||96)/12).toFixed(1))+" ft";},
  fileBase:function(P,W){return "roof_"+(P.rfType||"tab3")+"_"+(P.seed|0)+"_"+W;},
  readme:function(P,info){return Roof.readme(P,info);}
});

})();
