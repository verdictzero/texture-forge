/* =====================================================================
   MODE: greeble — machined surface clutter
   =====================================================================
   A base plate covered in a field of extruded blocks: the fine mechanical
   detail that makes a hull, a machine bay or a reactor face read as built
   rather than moulded. Blocks sit at a small number of quantised heights,
   separated by a gap that shows the plate underneath, with chamfered
   edges — three things that together are the difference between greebling
   and lumpy noise.

   Each block may then take one piece of sub-detail — a louvred vent, a
   round port, a recessed pocket, a stacked cap — plus corner bolts and an
   indicator lamp. Conduit runs lie on the plate and pass behind anything
   taller, which is what stops the pipes reading as decals.

   Nearly all of the character is in HEIGHT here, the exact opposite of the
   hull mode next door: this one wants displacement or at least a strong
   normal, and the colour map is mostly just dirt.

   The carving comes from modes/lib/quilt.js, shared with the hull mode.
   Tiles seamlessly in both axes.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,
      hashi=Forge.hashi,fbm=Forge.fbm,wrapDist=Forge.wrapDist,
      hex2rgb=Forge.hex2rgb,boxBlurWrap=Forge.blurWrap;

let P={};

/* distance to the nearest multiple of p — used along a pipe run for its clamps */
function edgeDist(t,p){const f=t/p;return Math.abs(f-Math.round(f))*p;}

/* ============================ the generator ============================ */

function build(params,io){
  P=params;
  const S=io.W,seed=P.seed|0,N=S*S;
  const T=Math.max(0.1,+P.tileM||2);
  const M=1/T,MM=0.001/T;                          // metres and millimetres, in tile units

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

  const rowsN=Math.max(1,P.rows|0);
  const GQ=Quilt.build({rows:rowsN,colsMin:P.colsMin|0,colsMax:P.colsMax|0,
                        split:P.subdiv,depth:P.subdepth|0,
                        minW:6*px,minH:6*px,seed:seed});
  const rec=Quilt.record();

  /* conduit: runs sit on the grid lines, so they wrap. Only the nearest line
     can ever be within a pipe radius, which keeps this O(1) per texel. */
  const pipeCols=Math.max(2,P.colsMin|0);
  const pipeR=Math.min(P.pipeD*MM*0.5,0.42/rowsN,0.42/pipeCols);
  const pipeOn=P.pipes>0&&pipeR>px;
  const pipeSeat=blockH*0.32;                      // on standoffs, not lying on the plate
  const pipeH=[],pipeV=[];
  for(let i=0;i<rowsN;i++)pipeH.push(hashi(i,3,seed+601)<P.pipes*0.45);
  for(let i=0;i<pipeCols;i++)pipeV.push(hashi(i,5,seed+607)<P.pipes*0.35);
  /* the clamp pitch has to divide the tile exactly or the last collar before
     the edge is cut in half and the run does not wrap */
  const clampPitch=1/Math.max(1,Math.round(1/Math.max(pipeR*7,px*8)));

  const band=Math.max(4,Math.round(65536/S));
  let y=0;

  function pass1(){
    const end=Math.min(S,y+band);
    for(;y<end;y++){
      const v=(y+0.5)/S;
      for(let x=0;x<S;x++){
        const u=(x+0.5)/S,i=y*S+x;

        Quilt.locate(GQ,u,v,rec);
        const w=rec.w,hh=rec.h,short=w<hh?w:hh;

        /* ---------------- the block itself ---------------- */
        /* levels are quantised: a continuous height per block reads as a
           crumpled sheet, a handful of discrete heights reads as machined */
        const lvl=Math.floor(Quilt.rand(GQ,rec,131)*levels)/(levels-1);
        const sunk=Quilt.rand(GQ,rec,197)<P.sunk;
        const top=sunk?-blockH*lvl*0.55:blockH*lvl;
        const plate=smoothstep(gapH,gapH+bev,rec.dEdge);   // 0 in the gap, 1 on the block
        let h=top*plate;
        let onTop=plate;                                   // what the surface treatment follows

        /* ---------------- one piece of sub-detail per block ---------------- */
        let lampM=0,boreM=0,ventM=0,metalBias=0;
        if(plate>0.02&&short>gapH*6){
          const inset=Math.max(short*0.20,bev*1.5);
          const inner=smoothstep(inset,inset+bev,rec.dEdge);
          if(Quilt.rand(GQ,rec,263)<P.vents){
            /* louvres run across the block's short axis, and are dropped
               entirely rather than aliased when the slots close up */
            const along=(w>=hh)?rec.lv:rec.lu,span=(w>=hh)?hh:w;
            const n=Math.max(2,Math.round(span/slotPitch));
            if(span/n*S>=3){
              const f=along*n,ff=f-Math.floor(f);
              const slot=1-smoothstep(0.26,0.33,Math.abs(ff-0.5));
              ventM=inner*slot;
              h-=ventM*ventD;
            }
          }else if(Quilt.rand(GQ,rec,269)<P.ports){
            const dx=(rec.lu-0.5)*w,dy=(rec.lv-0.5)*hh;
            const dr=Math.sqrt(dx*dx+dy*dy),R=short*0.32;
            if(R>bev*2.5){
              const collar=smoothstep(R,R-bev,dr);
              boreM=smoothstep(R*0.62,R*0.62-bev,dr);
              h+=collar*collarH*plate-boreM*(collarH+boreD);
              metalBias+=collar*0.2;
            }
          }else if(Quilt.rand(GQ,rec,271)<P.pockets){
            h-=inner*pocketD;
            boreM=Math.max(boreM,inner*0.55);
          }else if(Quilt.rand(GQ,rec,277)<P.caps){
            h+=inner*capH;
            onTop=Math.max(onTop,inner);
          }

          /* bolts and lamp are independent of the feature above */
          if(Quilt.rand(GQ,rec,283)<P.bolts&&short>boltR*7){
            const bi=boltR*2.1;
            const ddu=rec.du-bi,ddv=rec.dv-bi;             // all four corners at once
            const dd=Math.sqrt(ddu*ddu+ddv*ddv);
            const bolt=1-smoothstep(boltR*0.7,boltR,dd);
            h+=bolt*boltH*plate;
            metalBias+=bolt*0.35;
          }
          if(Quilt.rand(GQ,rec,293)<P.lamps&&short>lampR*8){
            const lx=Quilt.rand(GQ,rec,311)<0.5?0.22:0.78;
            const ly=Quilt.rand(GQ,rec,313)<0.5?0.22:0.78;
            const dxl=(rec.lu-lx)*w,dyl=(rec.lv-ly)*hh;
            const drl=Math.sqrt(dxl*dxl+dyl*dyl);
            lampM=(1-smoothstep(lampR*0.62,lampR*0.78,drl))*plate;
            const bez=(1-smoothstep(lampR*1.2,lampR*1.4,drl))*plate;
            h-=bez*boltH*0.32;                             // the bezel is let into the block
            h+=lampM*boltH*0.45;                           // and the lens domes back out of it
          }
        }

        /* ---------------- conduit lying on the plate ---------------- */
        let pipe=0;
        if(pipeOn){
          const iy=Math.round(v*rowsN)%rowsN;
          if(pipeH[iy]){
            const d=wrapDist(v,iy/rowsN);
            if(d<pipeR){
              const dome=Math.sqrt(1-(d/pipeR)*(d/pipeR))*pipeR;
              let ph=pipeSeat+dome;
              const cl=1-smoothstep(clampPitch*0.10,clampPitch*0.16,edgeDist(u,clampPitch));
              ph+=cl*pipeR*0.16;
              if(ph>h){h=ph;pipe=1-smoothstep(pipeR*0.86,pipeR,d);}
            }
          }
          const ix=Math.round(u*pipeCols)%pipeCols;
          if(pipeV[ix]){
            const d=wrapDist(u,ix/pipeCols);
            if(d<pipeR){
              const dome=Math.sqrt(1-(d/pipeR)*(d/pipeR))*pipeR;
              let ph=pipeSeat+dome;
              const cl=1-smoothstep(clampPitch*0.10,clampPitch*0.16,edgeDist(v,clampPitch));
              ph+=cl*pipeR*0.16;
              if(ph>h){h=ph;pipe=1-smoothstep(pipeR*0.86,pipeR,d);}
            }
          }
        }

        /* rolled plate grain, everywhere and tiny */
        h+=(fbm(u,v,90,3,seed+29)-0.5)*blockH*0.035;
        HGT[i]=h;

        /* ---------------- colour ---------------- */
        const shade=0.80+Quilt.rand(GQ,rec,151)*0.40;
        let r=metal[0]*shade,g=metal[1]*shade,b=metal[2]*shade;
        if(Quilt.rand(GQ,rec,163)<P.accent*0.5&&plate>0.02){
          const k=0.78*plate;
          r=lerp(r,accent[0],k);g=lerp(g,accent[1],k);b=lerp(b,accent[2],k);
        }
        /* the plate between the blocks, and anything cut into a block top */
        const recess=clamp((1-plate)*0.9+boreM*0.7+ventM*0.85,0,1);
        r=lerp(r,dark[0],recess*0.8);g=lerp(g,dark[1],recess*0.8);b=lerp(b,dark[2],recess*0.8);
        if(pipe>0){
          const pk=pipe*0.9,ps=0.88+Quilt.rand(GQ,rec,181)*0.3;
          r=lerp(r,metal[0]*ps*1.06,pk);g=lerp(g,metal[1]*ps*1.06,pk);b=lerp(b,metal[2]*ps*1.04,pk);
        }

        /* grime settles in everything that is not a top face */
        const gn=fbm(u,v,5,4,seed+53);
        const dirt=clamp((recess*0.75+(1-onTop)*0.35)*(0.45+gn*0.9),0,1)*P.grime;
        r=lerp(r,r*0.42+7,dirt);g=lerp(g,g*0.43+7,dirt);b=lerp(b,b*0.42+6,dirt);

        /* scuffing works the other way: it lands on what stands proud */
        const sc=clamp(fbm(u,v,34,3,seed+71)*1.4-0.55,0,1)*P.scratch*onTop;
        r=lerp(r,metal[0]*1.25+18,sc*0.6);g=lerp(g,metal[1]*1.25+18,sc*0.6);b=lerp(b,metal[2]*1.25+18,sc*0.6);

        let rough=P.rough+(Quilt.rand(GQ,rec,173)-0.5)*0.26;
        rough+=dirt*0.30-sc*0.24-metalBias*0.12;
        let met=P.metalness*(1-dirt*0.55);

        if(lampM>0.004){
          r=lerp(r,lampC[0],lampM);g=lerp(g,lampC[1],lampM);b=lerp(b,lampC[2],lampM);
          rough=lerp(rough,0.10,lampM);
          met=lerp(met,0.1,lampM);
          EMI[i]=clamp(lampM,0,1)*255;
        }else EMI[i]=0;

        A[i*3]=r;A[i*3+1]=g;A[i*3+2]=b;
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
  blurb:"Machined surface clutter — blocks, vents, ports, conduit",
  title:'Greeble <em>Field</em>',
  tagline:"Machined clutter · quantised levels · conduit · seamless",
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
      gap:4,bevel:1.5,levels:4,blockH:16,sunk:.22,
      vents:.28,ports:.2,pockets:.3,caps:.3,bolts:.45,boltD:7,lamps:.1,
      pipes:.3,pipeD:14,accent:.06,grime:.4,scratch:.35,
      rough:.46,metalness:.9,
      cMetal:"#8d9297",cDark:"#33373b",cAccent:"#9a7c33",cLamp:"#ff7a3c"}},
    {id:"machinebay",label:"Machine bay — coarse",set:{
      tileM:3.2,rows:6,colsMin:3,colsMax:6,subdiv:.5,subdepth:2,
      gap:9,bevel:3,levels:5,blockH:52,sunk:.18,
      vents:.42,ports:.3,pockets:.25,caps:.35,bolts:.55,boltD:14,lamps:.16,
      pipes:.75,pipeD:44,accent:.1,grime:.62,scratch:.4,
      rough:.55,metalness:.85,
      cMetal:"#7f858a",cDark:"#2b2e31",cAccent:"#b08a1e",cLamp:"#ffb02e"}},
    {id:"reactor",label:"Reactor face — lit",set:{
      tileM:2.4,rows:8,colsMin:4,colsMax:8,subdiv:.6,subdepth:2,
      gap:6,bevel:2,levels:6,blockH:38,sunk:.35,
      vents:.3,ports:.5,pockets:.3,caps:.2,bolts:.4,boltD:10,lamps:.55,
      pipes:.45,pipeD:26,accent:.08,grime:.3,scratch:.2,
      rough:.38,metalness:.92,
      cMetal:"#6f767d",cDark:"#202428",cAccent:"#7a4a2a",cLamp:"#49d8ff"}},
    {id:"servicepanel",label:"Service panel — shallow",set:{
      tileM:1.6,rows:5,colsMin:2,colsMax:4,subdiv:.35,subdepth:1,
      gap:5,bevel:2,levels:3,blockH:11,sunk:.15,
      vents:.5,ports:.15,pockets:.4,caps:.1,bolts:.7,boltD:9,lamps:.05,
      pipes:.12,pipeD:16,accent:.1,grime:.5,scratch:.5,
      rough:.6,metalness:.75,
      cMetal:"#96999b",cDark:"#3a3d40",cAccent:"#8c8f93",cLamp:"#66ff9c"}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:[
        [512,"512 × 512"],[1024,"1024 × 1024"],[2048,"2048 × 2048"],[4096,"4096 × 4096 — slow, heavy"]]},
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
      {id:"gap",label:"Gap between blocks",unit:"mm",min:1,max:40,step:0.5,value:6},
      {id:"bevel",label:"Edge bevel",unit:"mm",min:0.5,max:20,step:0.5,value:2}
    ]},
    {title:"Sub-detail",open:true,rows:[
      {id:"vents",label:"Louvred vents",min:0,max:1,step:0.01,value:0.3},
      {id:"ports",label:"Round ports",min:0,max:1,step:0.01,value:0.25},
      {id:"pockets",label:"Recessed pockets",min:0,max:1,step:0.01,value:0.3},
      {id:"caps",label:"Stacked caps",min:0,max:1,step:0.01,value:0.3},
      {id:"bolts",label:"Corner bolts",min:0,max:1,step:0.01,value:0.45},
      {id:"boltD",label:"Bolt diameter",unit:"mm",min:2,max:40,step:0.5,value:9},
      {id:"lamps",label:"Indicator lamps",min:0,max:1,step:0.01,value:0.2},
      {type:"note",html:"A block takes at most <b>one</b> of vent, port, pocket or cap, tested in "+
        "that order, so raising the first thins the ones after it. Bolts and lamps are "+
        "independent, and every one of them is skipped on a block too small to hold it."}
    ]},
    {title:"Conduit",rows:[
      {id:"pipes",label:"Conduit runs",min:0,max:1,step:0.01,value:0.35},
      {id:"pipeD",label:"Conduit diameter",unit:"mm",min:3,max:120,step:1,value:24}
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
    const smallPx=Math.min(narrowCm,shortCm)/100*pxPerM;
    if(smallPx<10)m+="<br><b>smallest block "+smallPx.toFixed(1)+" px</b> — drop the sub-division "+
                     "depth or raise the resolution; the sub-detail needs room";
    const gapPx=P.gap/1000*pxPerM;
    if(gapPx<1.5)m+="<br>gap "+gapPx.toFixed(2)+" px — held at half a texel, so the blocks will merge";
    const boltPx=P.boltD/1000*pxPerM;
    if(P.bolts>0&&boltPx<3)m+="<br>bolts "+boltPx.toFixed(1)+" px — too small to read";
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

  size:function(P){const S=P.size|0;return {w:S,h:S};},
  build:build,

  fileBase:function(P,W){return "greeble_"+(P.seed|0)+"_"+W;},

  readme:function(P,info){
    const T=Math.max(0.1,+P.tileM||2);
    const mm=(info.hMax-info.hMin)*T*1000;
    return ["Texture Forge · greeble — machined surface clutter",
      "",
      "Seed "+(P.seed|0)+"   Resolution "+info.W+"x"+info.H+"   Seamless in both axes",
      "Tile covers "+T+" m, so one texel is "+(T/info.W*1000).toFixed(2)+" mm.",
      "",
      "This one is a height map with a colour map attached, not the other way round.",
      "Blocks stand up to "+(+P.blockH).toFixed(0)+" mm proud of the plate, which is far more relief than a",
      "normal map alone can carry convincingly at a grazing angle: displace it, or at",
      "least use parallax occlusion, if the surface is ever seen from the side.",
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
