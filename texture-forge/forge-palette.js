/* =====================================================================
   TEXTURE FORGE — palette, dither and filtering
   =====================================================================

   Three things that only matter once you are working small, and that all
   belong together because they are one decision: I want this texture to
   read as pixel art rather than as a photograph.

     palette   the base colour is snapped to a fixed set of colours
     dither    how the error left over from that snap is spread around
     nearest   the preview and the chips stop smoothing between texels

   The palette is applied in ONE place — the runtime's makeMap(), which
   every chip, every preview upload, every PNG download and every zip
   entry already goes through — so what you see on screen is exactly what
   lands in the file. There is no separate "export palettised" step to
   forget to tick.

   ONLY THE BASE COLOUR IS TOUCHED. Normal, roughness, metallic, AO,
   height and ORM are data, not pictures: a normal map snapped to sixteen
   colours is a broken normal map, and a dithered height field is a field
   of noise. If you want those quantised, do it downstream where you can
   see what it costs.

   Palettes come from anywhere:

     built in   a couple of generated ramps, so the feature works with
                nothing loaded
     a file     .hex / .txt (one hex per line), .gpl (GIMP), .pal (JASC),
                or any text with hex colours in it — .css and .json
                included, since a token file is just hexes with punctuation
     an image   a swatch sheet. Every distinct colour covering more than a
                token area becomes an entry, in the sheet's own reading
                order, so a ramp sheet stays in ramp order.

   Loaded palettes persist in localStorage, so the one you work in is
   still there tomorrow.
   ===================================================================== */
"use strict";

(function(){

const clamp=(x,a,b)=>x<a?a:(x>b?b:x);

/* ============================ built-in palettes ============================
   Deliberately few and deliberately generated. A palette is somebody's work,
   and shipping a named one means shipping their name with it; these are just
   ramps, so there is nothing to attribute and nothing to get wrong. Load your
   own — that is what the rest of this file is for. */
function greyRamp(n){
  const out=[];
  for(let i=0;i<n;i++){const v=Math.round(i*255/(n-1));out.push([v,v,v]);}
  return out;
}
function rgb332(){
  /* the classic 8-bit hardware palette: three bits of red, three of green,
     two of blue, each stretched back over the full range */
  const out=[];
  for(let r=0;r<8;r++)for(let g=0;g<8;g++)for(let b=0;b<4;b++)
    out.push([Math.round(r*255/7),Math.round(g*255/7),Math.round(b*255/3)]);
  return out;
}
const BUILTIN=[
  {id:"none",  label:"None — full colour", colors:null},
  {id:"grey8", label:"Grey 8",             colors:greyRamp(8)},
  {id:"grey16",label:"Grey 16",            colors:greyRamp(16)},
  {id:"grey32",label:"Grey 32",            colors:greyRamp(32)},
  {id:"rgb332",label:"RGB 3-3-2 · 256",    colors:rgb332()}
];

const DITHERS=[
  ["none","No dither — hard snap"],
  ["bayer2","Ordered 2×2 — coarse"],
  ["bayer4","Ordered 4×4"],
  ["bayer8","Ordered 8×8 — fine"],
  ["fs","Floyd–Steinberg — error diffusion"]
];

/* ============================ state ============================ */

const KEY="texture-forge-palette";
const state={id:"none",dither:"bayer4",strength:1,nearest:true};
let loaded=[];                                   // palettes the user brought in
const listeners=[];

function save(){
  try{
    localStorage.setItem(KEY,JSON.stringify({
      state:state,
      loaded:loaded.map(p=>({id:p.id,label:p.label,
        colors:p.colors.map(c=>(c[0]<<16|c[1]<<8|c[2]))}))
    }));
  }catch(e){}                                    // a full or blocked store is not an error worth stopping for
}
function restore(){
  let raw=null;
  try{raw=localStorage.getItem(KEY);}catch(e){return;}
  if(!raw)return;
  try{
    const o=JSON.parse(raw);
    if(o&&o.state)for(const k in state)if(o.state[k]!==undefined)state[k]=o.state[k];
    if(o&&o.loaded)loaded=o.loaded.map(p=>({id:p.id,label:p.label,
      colors:p.colors.map(v=>[(v>>16)&255,(v>>8)&255,v&255])}));
  }catch(e){loaded=[];}
}

function list(){return BUILTIN.concat(loaded);}
function get(id){
  for(const p of list())if(p.id===id)return p;
  return BUILTIN[0];
}
function colors(){const p=get(state.id);return p&&p.colors&&p.colors.length?p.colors:null;}
function on(fn){listeners.push(fn);}
function fire(){for(const fn of listeners)fn();}
function set(k,v){
  if(state[k]===v)return false;
  state[k]=v;save();fire();
  return true;
}

/* ============================ the quantiser ============================ */

/* Nearest palette entry, cached on RGB555 so a 4096² map does at most 32768
   real searches however many colours the palette holds. The distance is
   weighted the way the eye weights error — green carries most of the
   luminance, blue almost none — because an unweighted RGB distance picks
   visibly wrong entries out of any palette with a lot of blues in it. */
function makeFinder(cols){
  const cache=new Int16Array(32768).fill(-1);
  const n=cols.length;
  const R=new Float64Array(n),G=new Float64Array(n),B=new Float64Array(n);
  for(let i=0;i<n;i++){R[i]=cols[i][0];G[i]=cols[i][1];B[i]=cols[i][2];}
  return function(r,g,b){
    const key=((r>>3)<<10)|((g>>3)<<5)|(b>>3);
    const hit=cache[key];
    if(hit>=0)return hit;
    let best=0,bd=Infinity;
    for(let i=0;i<n;i++){
      const dr=r-R[i],dg=g-G[i],db=b-B[i];
      const d=dr*dr*0.30+dg*dg*0.59+db*db*0.11;
      if(d<bd){bd=d;best=i;}
    }
    cache[key]=best;
    return best;
  };
}

/* How far apart the palette's colours typically sit. Dither amplitude has to
   be a fraction of the step it is trying to hide: too little and the ordered
   pattern does nothing, too much and the texture turns to static. The median
   nearest-neighbour distance is the honest measure of it for an arbitrary
   palette, where "levels" means nothing. */
function stepOf(cols){
  const n=cols.length;
  if(n<2)return 32;
  const d=new Float64Array(n);
  for(let i=0;i<n;i++){
    let best=Infinity;
    for(let j=0;j<n;j++){
      if(i===j)continue;
      const dr=cols[i][0]-cols[j][0],dg=cols[i][1]-cols[j][1],db=cols[i][2]-cols[j][2];
      const v=dr*dr+dg*dg+db*db;
      if(v<best)best=v;
    }
    d[i]=Math.sqrt(best);
  }
  const a=Array.prototype.slice.call(d).sort((x,y)=>x-y);
  return a[a.length>>1]||32;
}

/* recursive Bayer matrix, 2ⁿ square, values 0 .. n²-1 */
function bayer(n){
  let m=[[0]];
  while(m.length<n){
    const k=m.length,o=[];
    for(let y=0;y<k*2;y++)o.push(new Array(k*2));
    for(let y=0;y<k;y++)for(let x=0;x<k;x++){
      const v=m[y][x]*4;
      o[y][x]=v;o[y][x+k]=v+2;o[y+k][x]=v+3;o[y+k][x+k]=v+1;
    }
    m=o;
  }
  return m;
}
const BAYER={2:bayer(2),4:bayer(4),8:bayer(8)};

/* Compiled once per palette rather than per map: a mode being dragged rebuilds
   its preview many times a second and the O(n²) step measurement is not free. */
let CACHE={id:null,find:null,cols:null,step:0};
function compiled(){
  const cols=colors();
  if(!cols)return null;
  if(CACHE.id!==state.id||CACHE.cols!==cols)
    CACHE={id:state.id,cols:cols,find:makeFinder(cols),step:stepOf(cols)};
  return CACHE;
}

const SKIP=8;                                    // alpha at or under this is not a pixel

/* Quantise an RGBA buffer in place. Alpha is never touched and never dithered
   into: on a cut-out face the colour under a transparent texel is whatever the
   generator happened to leave there, and diffusing that into the visible edge
   would fringe the silhouette. */
function quantise(data,w,h){
  const C=compiled();
  if(!C)return false;
  const find=C.find,cols=C.cols;
  const amt=C.step*clamp(+state.strength||0,0,2);

  if(state.dither==="fs"&&amt>0){
    /* Floyd–Steinberg, serpentine so the error does not comb in one direction.
       The working buffer is float: rounding the error at every step is what
       makes a naive implementation band. */
    const buf=new Float32Array(w*h*3);
    for(let i=0,k=0;i<w*h;i++,k+=3){
      buf[k]=data[i*4];buf[k+1]=data[i*4+1];buf[k+2]=data[i*4+2];
    }
    const k16=amt/ (C.step||1) / 16;             // strength scales the diffused share
    for(let y=0;y<h;y++){
      const rev=(y&1)===1;
      for(let n=0;n<w;n++){
        const x=rev?w-1-n:n;
        const i=y*w+x,k=i*3;
        if(data[i*4+3]<=SKIP)continue;
        const r=clamp(buf[k],0,255),g=clamp(buf[k+1],0,255),b=clamp(buf[k+2],0,255);
        const p=cols[find(Math.round(r),Math.round(g),Math.round(b))];
        data[i*4]=p[0];data[i*4+1]=p[1];data[i*4+2]=p[2];
        const er=(r-p[0])*k16,eg=(g-p[1])*k16,eb=(b-p[2])*k16;
        const dx=rev?-1:1;
        const push=(xx,yy,f)=>{
          if(xx<0||xx>=w||yy>=h)return;
          const j=yy*w+xx;
          if(data[j*4+3]<=SKIP)return;
          const m=j*3;
          buf[m]+=er*f;buf[m+1]+=eg*f;buf[m+2]+=eb*f;
        };
        push(x+dx,y,7);push(x-dx,y+1,3);push(x,y+1,5);push(x+dx,y+1,1);
      }
    }
    return true;
  }

  const n=state.dither==="bayer2"?2:state.dither==="bayer8"?8:state.dither==="bayer4"?4:0;
  const M=n?BAYER[n]:null;
  const norm=n?1/(n*n):0;
  for(let y=0;y<h;y++){
    const row=M?M[y&(n-1)]:null;
    for(let x=0;x<w;x++){
      const i=y*w+x;
      if(data[i*4+3]<=SKIP)continue;
      let r=data[i*4],g=data[i*4+1],b=data[i*4+2];
      if(row&&amt>0){
        const t=((row[x&(n-1)]+0.5)*norm-0.5)*amt;
        r=clamp(r+t,0,255);g=clamp(g+t,0,255);b=clamp(b+t,0,255);
      }
      const p=cols[find(r|0,g|0,b|0)];
      data[i*4]=p[0];data[i*4+1]=p[1];data[i*4+2]=p[2];
    }
  }
  return true;
}

/* ============================ reading palettes in ============================ */

const HEX=/#?\b([0-9a-fA-F]{6})\b/g;

/* .gpl and .pal are decimal triples with a header; everything else is treated
   as "text with hex colours in it", which covers .hex, .txt, .css and .json
   without needing to know which one it was. */
function parse(text){
  const out=[],seen={};
  const push=(r,g,b)=>{
    const k=(r<<16|g<<8|b);
    if(seen[k])return;
    seen[k]=1;out.push([r,g,b]);
  };
  if(/GIMP Palette|JASC-PAL/i.test(text)){
    for(const line of text.split(/\r?\n/)){
      const t=line.trim();
      if(!t||t.charAt(0)==="#"||/^[A-Za-z-]/.test(t))continue;
      const m=t.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/);
      if(m)push(+m[1]&255,+m[2]&255,+m[3]&255);
    }
    if(out.length)return out;
  }
  let m;
  HEX.lastIndex=0;
  while((m=HEX.exec(text))){
    const v=parseInt(m[1],16);
    push((v>>16)&255,(v>>8)&255,v&255);
  }
  return out;
}

/* A swatch sheet. Every distinct colour covering more than a token area is an
   entry, in the sheet's own reading order — so a sheet laid out as ramps comes
   back as ramps rather than as a bag of colours sorted by something arbitrary.
   The area floor is what throws away anti-aliased edges, JPEG mush and the
   one-pixel grid lines between swatches, none of which are palette colours. */
function fromImageData(data,w,h,maxColors){
  const total=w*h;
  const floor=Math.max(12,Math.floor(total*0.0004));
  const count={},order=[];
  for(let i=0;i<total;i++){
    if(data[i*4+3]<128)continue;
    const k=(data[i*4]<<16)|(data[i*4+1]<<8)|data[i*4+2];
    if(count[k]===undefined){count[k]=0;order.push(k);}
    count[k]++;
  }
  const keep=order.filter(k=>count[k]>=floor);
  /* a photograph has thousands of near-unique colours and no swatch clears the
     floor; say so rather than handing back a palette of three greys */
  const use=keep.length?keep:order.slice().sort((a,b)=>count[b]-count[a]);
  const cap=maxColors||1024;
  return use.slice(0,cap).map(k=>[(k>>16)&255,(k>>8)&255,k&255]);
}

let nextId=1;
function add(label,cols){
  if(!cols||!cols.length)return null;
  const id="user"+(Date.now().toString(36))+(nextId++);
  loaded.push({id:id,label:label+" · "+cols.length,colors:cols});
  save();fire();
  return id;
}
function remove(id){
  const i=loaded.findIndex(p=>p.id===id);
  if(i<0)return false;
  loaded.splice(i,1);
  if(state.id===id)state.id="none";
  save();fire();
  return true;
}

/* Reads whatever was dropped and registers it. Resolves with the new palette
   id, or rejects with a message worth showing the user. */
function loadFile(file){
  return new Promise((resolve,reject)=>{
    const name=(file.name||"palette").replace(/\.[^.]+$/,"");
    if(/^image\//.test(file.type)||/\.(png|gif|bmp|webp|jpe?g)$/i.test(file.name||"")){
      const url=URL.createObjectURL(file);
      const img=new Image();
      img.onload=()=>{
        const c=document.createElement("canvas");
        c.width=img.naturalWidth;c.height=img.naturalHeight;
        const g=c.getContext("2d",{willReadFrequently:true});
        g.drawImage(img,0,0);
        let cols;
        try{cols=fromImageData(g.getImageData(0,0,c.width,c.height).data,c.width,c.height);}
        catch(e){URL.revokeObjectURL(url);reject("That image could not be read");return;}
        URL.revokeObjectURL(url);
        if(!cols.length){reject("No swatches found in that image");return;}
        resolve(add(name,cols));
      };
      img.onerror=()=>{URL.revokeObjectURL(url);reject("That image could not be decoded");};
      img.src=url;
      return;
    }
    const fr=new FileReader();
    fr.onload=()=>{
      const cols=parse(String(fr.result||""));
      if(!cols.length){reject("No colours found in "+(file.name||"that file"));return;}
      resolve(add(name,cols));
    };
    fr.onerror=()=>reject("That file could not be read");
    fr.readAsText(file);
  });
}

restore();

window.Palette={
  DITHERS:DITHERS,
  state:state,
  list:list,get:get,colors:colors,
  set:set,on:on,
  quantise:quantise,
  parse:parse,fromImageData:fromImageData,
  add:add,remove:remove,loadFile:loadFile,
  /* the channels a palette may touch: pictures, not data */
  affects:function(key){return key==="basecolor";},
  active:function(){return !!colors();},
  describe:function(){
    const p=get(state.id);
    if(!p.colors)return null;
    const d=DITHERS.find(x=>x[0]===state.dither);
    return p.label+" ("+p.colors.length+" colours), "+
      (state.dither==="none"?"no dither":(d?d[1].split(" — ")[0]:state.dither)+
      " at "+(+state.strength).toFixed(2));
  }
};

})();
