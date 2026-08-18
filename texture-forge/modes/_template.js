/* =====================================================================
   MODE TEMPLATE — a small, complete, working mode
   =====================================================================

   Copy this file, rename it, change the id, and add a <script> tag for it
   in index.html. It is deliberately short: a tileable plaster wall with
   settlement cracks. Everything the runtime asks of a mode is here, so
   read it top to bottom before writing a big one.

   To try it, uncomment its <script> tag in index.html.

   The contract, in one paragraph: you declare `controls` (the runtime
   builds the panel and reads the parameters back into a plain object),
   `channels` (the chips, tabs and export list), and `size()` (how many
   texels to fill). Your `build()` fills typed arrays and hands them back
   through io.done(). The runtime owns the preview, the export and the zip.
   Full reference: ADDING-A-MODE.md.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      hashi=Forge.hashi,fbm=Forge.fbm,hex2rgb=Forge.hex2rgb,boxBlurWrap=Forge.blurWrap;

let P={};

/* ============================ the generator ============================ */

function build(params,io){
  P=params;
  const S=io.W,seed=P.seed|0;
  const N=S*S;

  const A=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N);
  const MET=new Uint8ClampedArray(N);
  const AOc=new Uint8ClampedArray(N);
  const NRM=new Uint8ClampedArray(N*3);
  const HGT=new Float32Array(N);
  let hMin=0,hMax=1;

  const base=hex2rgb(P.cWall);
  const grainAmt=P.grain*0.012;
  const crackAmt=P.cracks;

  /* Work in bands with a setTimeout between them: a synchronous loop over a
     4096² tile would freeze the tab and lose the progress bar. */
  const band=Math.max(8,Math.round(65536/S));
  let y=0;

  function pass1(){
    const end=Math.min(S,y+band);
    for(;y<end;y++){
      const v=(y+0.5)/S;
      for(let x=0;x<S;x++){
        const u=(x+0.5)/S,i=y*S+x;

        /* height: trowel swirl plus fine grain, both on wrapping lattices */
        const swirl=fbm(u,v,6,4,seed+11)-0.5;
        const fine=fbm(u,v,64,3,seed+29)-0.5;
        let h=swirl*0.010*P.trowel+fine*grainAmt;

        /* cracks: a ridged band of low-frequency noise, so they meander */
        const n=fbm(u,v,5,4,seed+53);
        const ridge=1-Math.abs(n-0.5)*2;                    // 1 along the ridge line
        const crack=smoothstep(0.94-crackAmt*0.10,0.995,ridge)*crackAmt;
        h-=crack*0.012;

        HGT[i]=h;

        const mott=1+(fbm(u,v,12,3,seed+83)-0.5)*0.16;
        const dirt=clamp(fbm(u,v,3,3,seed+97)*1.3-0.35,0,1)*P.grime;
        let r=base[0]*mott,g=base[1]*mott,b=base[2]*mott;
        r=lerp(r,r*0.55,dirt);g=lerp(g,g*0.56,dirt);b=lerp(b,b*0.52,dirt);
        r=lerp(r,r*0.45,crack);g=lerp(g,g*0.45,crack);b=lerp(b,b*0.45,crack);
        A[i*3]=r;A[i*3+1]=g;A[i*3+2]=b;

        RGH[i]=clamp(P.rough+(fine*0.4)+dirt*0.15,0.05,1)*255;
        MET[i]=0;                                            // plaster is dielectric
        AOc[i]=255;                                          // seeded, refined in pass 2
      }
    }
    if(y<S){io.progress(y/S*0.7);setTimeout(pass1,0);}
    else{io.progress(0.75);setTimeout(pass2,0);}
  }

  function pass2(){
    /* AO by comparing each texel against a wrapped blur of the height field */
    const b1=boxBlurWrap(HGT,S,Math.max(1,Math.round(S*0.004)));
    for(let i=0;i<N;i++)
      AOc[i]=clamp(1-clamp((b1[i]-HGT[i])*160,0,1)*P.aoStr,0,1)*255;
    io.progress(0.9);

    hMin=Infinity;hMax=-Infinity;
    for(let i=0;i<N;i++){const h=HGT[i];if(h<hMin)hMin=h;if(h>hMax)hMax=h;}
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;

    /* normals from height, wrapped so the tile edges match */
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
        const i=(y0+xx)*3;
        NRM[i]=(nx*0.5+0.5)*255;NRM[i+1]=(ny*0.5+0.5)*255;NRM[i+2]=(inv*0.5+0.5)*255;
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
  id:"template",                      // unique; also the deep link (#template)
  label:"Template",                   // the mode tab
  blurb:"Worked example — plaster wall",
  title:'Plaster <em>Template</em>',  // panel headline, innerHTML
  tagline:"Worked example mode · PBR · PNG",
  actionLabel:"Forge plaster",
  busyLabel:"Forging…",
  seamless:true,                      // tiles: repeat in the preview, tile buttons on
  preview:{gain:3.0,amb:1.1,specK:0.55,skyLo:[0.16,0.19,0.23],skyHi:[0.34,0.38,0.44]},

  channels:[
    {key:"basecolor",label:"Base colour"},{key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},{key:"metallic",label:"Metallic",tab:false},
    {key:"ao",label:"AO"},{key:"height",label:"Height"},{key:"orm",label:"ORM packed"}
  ],

  presets:[
    {id:"fresh",label:"Fresh render",set:{trowel:0.5,grain:0.35,cracks:0.1,grime:0.15,rough:0.75,cWall:"#cfc7b8"}},
    {id:"old",label:"Old and grubby",set:{trowel:0.8,grain:0.6,cracks:0.7,grime:0.7,rough:0.88,cWall:"#a9a08f"}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:[
        [512,"512 × 512"],[1024,"1024 × 1024"],[2048,"2048 × 2048"],[4096,"4096 × 4096 — slow, heavy"]]},
      {id:"seed",type:"seed",value:2024}
    ]},
    {title:"Surface",open:true,rows:[
      {id:"trowel",label:"Trowel swirl",min:0,max:1,step:0.01,value:0.5},
      {id:"grain",label:"Grain",min:0,max:1,step:0.01,value:0.35},
      {id:"cracks",label:"Settlement cracks",min:0,max:1,step:0.01,value:0.35},
      {id:"grime",label:"Grime",min:0,max:1,step:0.01,value:0.3},
      {id:"rough",label:"Roughness",min:0.05,max:1,step:0.01,value:0.8},
      {type:"colors",label:"Plaster colour",items:[{id:"cWall",value:"#cfc7b8"}]}
    ]},
    {title:"Maps",rows:[
      {id:"normalStr",label:"Normal strength",min:0.1,max:3,step:0.05,value:1},
      {id:"aoStr",label:"Ambient occlusion",min:0,max:1,step:0.01,value:0.8},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]}
  ],

  size:function(P){const S=P.size|0;return {w:S,h:S};},
  build:build,

  fileBase:function(P,W){return "plaster_"+(P.seed|0)+"_"+W;},

  readme:function(P,info){
    return ["Texture Forge · template — plaster wall",
      "",
      "Seed "+(P.seed|0)+"   Resolution "+info.W+"x"+info.H+"   Seamless in both axes",
      "",
      "basecolor.png  sRGB albedo.",
      "normal.png     Tangent space, "+info.normalNote+".",
      "roughness.png  Linear grey.",
      "metallic.png   Flat black — plaster is a dielectric.",
      "ao.png         Linear grey ambient occlusion.",
      "height.png     Linear grey, 0-1 spanning "+(info.hMax-info.hMin).toFixed(5)+" in tile-width units.",
      "orm.png        R = AO, G = roughness, B = metallic."].join("\n");
  }
});

})();
