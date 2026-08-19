/* =====================================================================
   TEXTURE FORGE — shared runtime
   =====================================================================

   Everything in this file is mode-agnostic. A mode (street, plating,
   house, …) is a plain object handed to Forge.register(); the runtime
   owns the chrome around it:

     · the mode tab bar and the control panel, built from a declarative
       control schema, with parameters read back into a plain object
     · presets, seed rolling, the debounced preview/full rebuild queue
     · the GGX lit preview and the flat channel views
     · channel chips, PNG export, 16-bit height, the store-only zip

   See ADDING-A-MODE.md and modes/_template.js for the mode contract.
   ===================================================================== */
"use strict";

(function(){

/* ============================ maths ============================
   Shared by the generators. The value-noise pair wraps on an integer
   lattice, so anything built from it tiles exactly. */

const clamp=(x,a,b)=>x<a?a:(x>b?b:x);
const lerp=(a,b,t)=>a+(b-a)*t;
const smoothstep=(e0,e1,x)=>{const t=clamp((x-e0)/(e1-e0||1e-9),0,1);return t*t*(3-2*t);};
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function hashi(x,y,s){
  let h=Math.imul(x|0,0x27d4eb2d)^Math.imul(y|0,0x165667b1)^Math.imul(s|0,0x9e3779b1);
  h^=h>>>15;h=Math.imul(h,0x85ebca6b);h^=h>>>13;h=Math.imul(h,0xc2b2ae35);h^=h>>>16;
  return (h>>>0)/4294967296;
}
/* value noise on an integer lattice that wraps at `period` -> perfectly tileable */
function vnoise(x,y,period,seed){
  const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;
  const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const x0=((xi%period)+period)%period,x1=(x0+1)%period;
  const y0=((yi%period)+period)%period,y1=(y0+1)%period;
  const a=hashi(x0,y0,seed),b=hashi(x1,y0,seed),c=hashi(x0,y1,seed),d=hashi(x1,y1,seed);
  return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}
function fbm(u,v,period,oct,seed){
  let amp=1,sum=0,norm=0,p=period;
  for(let i=0;i<oct;i++){sum+=amp*vnoise(u*p,v*p,p,seed+i*7919);norm+=amp;amp*=0.5;p*=2;}
  return sum/norm;
}
/* anisotropic variant: independent integer periods per axis, so stretched
   features (rolled sheet grain, brushing) still wrap in both directions */
function vnoise2(x,y,px,py,seed){
  const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;
  const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const x0=((xi%px)+px)%px,x1=(x0+1)%px;
  const y0=((yi%py)+py)%py,y1=(y0+1)%py;
  const a=hashi(x0,y0,seed),b=hashi(x1,y0,seed),c=hashi(x0,y1,seed),d=hashi(x1,y1,seed);
  return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}
function fbm2(u,v,px,py,oct,seed){
  let amp=1,sum=0,norm=0,a=px,b=py;
  for(let i=0;i<oct;i++){sum+=amp*vnoise2(u*a,v*b,a,b,seed+i*7919);norm+=amp;amp*=0.5;a*=2;b*=2;}
  return sum/norm;
}
const wrapDist=(a,b)=>{const d=Math.abs(a-b);return d<0.5?d:1-d;};
function hex2rgb(h){return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];}

/* separable box blur, wrapping (seamless modes) and clamped (single pieces) */
function blurWrap(src,n,r){
  const tmp=new Float32Array(n*n),out=new Float32Array(n*n);
  const w=r*2+1;
  for(let y=0;y<n;y++){
    const o=y*n;let sum=0;
    for(let k=-r;k<=r;k++)sum+=src[o+((k%n)+n)%n];
    for(let x=0;x<n;x++){
      tmp[o+x]=sum/w;
      sum-=src[o+((x-r)%n+n)%n];sum+=src[o+((x+r+1)%n+n)%n];
    }
  }
  for(let x=0;x<n;x++){
    let sum=0;
    for(let k=-r;k<=r;k++)sum+=tmp[(((k%n)+n)%n)*n+x];
    for(let y=0;y<n;y++){
      out[y*n+x]=sum/w;
      sum-=tmp[(((y-r)%n+n)%n)*n+x];sum+=tmp[(((y+r+1)%n+n)%n)*n+x];
    }
  }
  return out;
}
function blurClamp(src,w,h,r){
  const tmp=new Float32Array(w*h),out=new Float32Array(w*h);
  const n=r*2+1;
  for(let y=0;y<h;y++){
    const o=y*w;let sum=0;
    for(let k=-r;k<=r;k++)sum+=src[o+clamp(k,0,w-1)];
    for(let x=0;x<w;x++){
      tmp[o+x]=sum/n;
      sum-=src[o+clamp(x-r,0,w-1)];sum+=src[o+clamp(x+r+1,0,w-1)];
    }
  }
  for(let x=0;x<w;x++){
    let sum=0;
    for(let k=-r;k<=r;k++)sum+=tmp[clamp(k,0,h-1)*w+x];
    for(let y=0;y<h;y++){
      out[y*w+x]=sum/n;
      sum-=tmp[clamp(y-r,0,h-1)*w+x];sum+=tmp[clamp(y+r+1,0,h-1)*w+x];
    }
  }
  return out;
}

/* ============================ registry ============================ */

const MODES=[],BY_ID={};
const Forge={
  clamp:clamp,lerp:lerp,smoothstep:smoothstep,mulberry32:mulberry32,hashi:hashi,
  vnoise:vnoise,fbm:fbm,vnoise2:vnoise2,fbm2:fbm2,wrapDist:wrapDist,hex2rgb:hex2rgb,
  blurWrap:blurWrap,blurClamp:blurClamp,
  modes:MODES,
  register:function(mode){
    if(BY_ID[mode.id]){console.warn("Texture Forge: duplicate mode id "+mode.id);return;}
    BY_ID[mode.id]=mode;MODES.push(mode);
  }
};
window.Forge=Forge;

/* ============================ small DOM helpers ============================ */

const el=id=>document.getElementById(id);
function make(tag,cls,text){
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(text!=null)n.textContent=text;
  return n;
}
const decimals=step=>{const s=String(step);const i=s.indexOf(".");return i<0?0:s.length-i-1;};

/* ============================ per-mode state ============================ */

/* One of these per registered mode. Buffers live here so switching tabs
   shows the last build back instantly instead of regenerating it. */
const STATE={};
let active=null;                       // the live state object
let view="lit",tileN=1,bg="dark",light=[0.35,0.45];
const RETAIN_TEXELS=1024*1024;         // bigger than this is dropped on tab-out

function stateFor(mode){
  return STATE[mode.id]||(STATE[mode.id]={
    mode:mode,P:{},panel:null,params:null,
    B:null,built:false,flags:null,
    busy:false,pending:null,preview:false,qTimer:null,zipUrl:null
  });
}
const pid=(st,id)=>st.mode.id+"--"+id;
const node=(st,id)=>el(pid(st,id));

/* A mode flag may be a plain value or a function of the parameters, so one
   mode can switch between a tiling surface and a single cut-out piece per
   build (the envelope mode does: walls are cut-outs, roofs tile). Resolved
   once per build and read back from the build, never from the live form —
   the preview belongs to the texture that is actually on screen. */
function flag(m,name,P){const v=m[name];return typeof v==="function"?!!v(P):!!v;}
function flagsOf(st){
  return st.flags||(st.flags={
    seamless:flag(st.mode,"seamless",st.P),
    backdrops:flag(st.mode,"backdrops",st.P)
  });
}
function syncChrome(st){
  const f=flagsOf(st);
  el("tiles").hidden=!f.seamless;
  el("bgs").hidden=!f.backdrops;
  el("h16").hidden=st.mode.height16===false;
}

/* ============================ panel construction ============================
   A mode declares `controls`; the runtime turns that into markup, collects
   the parameter descriptors and wires the change handlers. Element ids are
   prefixed with the mode id so several panels can coexist in the document. */

function buildPanel(st){
  const m=st.mode,params=[];
  const form=make("form","panel");
  form.id="panel-"+m.id;
  form.dataset.mode=m.id;
  form.setAttribute("onsubmit","return false");

  const head=make("div","panel-head");
  const h1=make("h1");h1.innerHTML=m.title||m.label;
  head.appendChild(h1);
  if(m.tagline)head.appendChild(make("p",null,m.tagline));
  form.appendChild(head);

  if(m.presets&&m.presets.length){
    const pr=make("div","presets");
    for(const p of m.presets){
      const b=make("button","preset",p.label);
      b.type="button";b.dataset.preset=p.id;
      pr.appendChild(b);
    }
    pr.addEventListener("click",e=>{
      const b=e.target.closest("[data-preset]");
      if(b)applyPreset(st,b.dataset.preset);
    });
    form.appendChild(pr);
  }

  for(const group of m.controls||[]){
    const d=make("details","group");
    if(group.open)d.open=true;
    if(group.id)d.id=pid(st,group.id);
    if(group.need)d.setAttribute("data-need-any",[].concat(group.need).join(" "));
    d.appendChild(make("summary",null,group.title));
    const body=make("div","group-body");
    for(const row of group.rows||[])body.appendChild(buildRow(st,row,params));
    d.appendChild(body);
    form.appendChild(d);
  }

  const actions=make("div","actions");
  const forge=make("button","forge",m.actionLabel||"Forge texture");
  forge.type="button";forge.id=pid(st,"forge");
  forge.addEventListener("click",()=>{readParams(st);run(st,false);});
  actions.appendChild(forge);
  const note=make("p","autonote",autonote(st));
  note.id=pid(st,"autonote");
  actions.appendChild(note);
  form.appendChild(actions);

  st.params=params;
  return form;
}

function buildRow(st,row,params){
  const kind=row.type||"range";
  const wrap=make("div",kind==="readout"||kind==="note"?"":"row");
  if(row.need)wrap.setAttribute("data-need",row.need);

  if(kind==="readout"){
    const r=make("div","readout","—");
    r.id=pid(st,row.id||"readout");
    if(row.need)r.setAttribute("data-need",row.need);
    return r;
  }
  if(kind==="note"){
    const r=make("div","readout");
    r.innerHTML=row.html||row.text||"";
    if(row.need)r.setAttribute("data-need",row.need);
    return r;
  }

  if(kind==="range"){
    const lab=make("label");
    lab.htmlFor=pid(st,row.id);
    lab.innerHTML=row.label+' <span class="val" id="'+pid(st,row.id)+'-val"></span>'+(row.unit?" "+row.unit:"");
    const inp=make("input");
    inp.type="range";inp.id=pid(st,row.id);
    inp.min=row.min;inp.max=row.max;inp.step=row.step;inp.value=row.value;
    wrap.appendChild(lab);wrap.appendChild(inp);
    params.push({id:row.id,kind:"range",dp:decimals(row.step)});
    return wrap;
  }

  if(kind==="select"){
    const lab=make("label",null,row.label);
    lab.htmlFor=pid(st,row.id);
    if(row.showValue)lab.innerHTML=row.label+' <span class="val" id="'+pid(st,row.id)+'-val"></span>';
    const sel=make("select");
    sel.id=pid(st,row.id);
    let numeric=true;
    for(const o of row.options){
      const opt=make("option",null,o[1]);
      opt.value=o[0];
      if(String(o[0])===String(row.value))opt.selected=true;
      if(isNaN(+o[0]))numeric=false;
      sel.appendChild(opt);
    }
    wrap.appendChild(lab);wrap.appendChild(sel);
    params.push({id:row.id,kind:"select",numeric:numeric});
    return wrap;
  }

  if(kind==="seed"){
    const lab=make("label",null,row.label||"Seed");
    lab.htmlFor=pid(st,row.id);
    const line=make("div","seedrow");
    const inp=make("input");
    inp.type="number";inp.id=pid(st,row.id);inp.min="0";inp.step="1";inp.value=row.value;
    const roll=make("button","mini","Roll");
    roll.type="button";
    roll.addEventListener("click",()=>{
      inp.value=Math.floor(Math.random()*99999);
      readParams(st);queue(st,false);
    });
    line.appendChild(inp);line.appendChild(roll);
    wrap.appendChild(lab);wrap.appendChild(line);
    params.push({id:row.id,kind:"number"});
    return wrap;
  }

  if(kind==="colors"){
    if(row.label)wrap.appendChild(make("label",null,row.label));
    const sw=make("div","swatches");
    for(const c of row.items){
      const cell=make("div","swatch");
      const inp=make("input");
      inp.type="color";inp.id=pid(st,c.id);inp.value=c.value;
      if(c.title)inp.title=c.title;
      cell.appendChild(inp);sw.appendChild(cell);
      params.push({id:c.id,kind:"color"});
    }
    wrap.appendChild(sw);
    return wrap;
  }

  if(kind==="checks"){
    const box=make("div","checks");
    for(const c of row.items){
      const lab=make("label","check");
      const inp=make("input");
      inp.type="checkbox";inp.id=pid(st,c.id);inp.checked=!!c.value;
      lab.appendChild(inp);lab.appendChild(document.createTextNode(" "+c.label));
      box.appendChild(lab);
      params.push({id:c.id,kind:"check"});
    }
    wrap.appendChild(box);
    return wrap;
  }

  throw new Error("Texture Forge: unknown control type "+kind);
}

function wireInputs(st){
  for(const d of st.params){
    const n=node(st,d.id);
    if(d.kind==="range"){
      /* dragging previews, releasing rebuilds at full size */
      n.addEventListener("input",()=>{readParams(st);queue(st,true);});
      n.addEventListener("change",()=>{readParams(st);queue(st,false);});
    }else{
      n.addEventListener("change",()=>{readParams(st);queue(st,false);});
    }
  }
}

/* ============================ parameters ============================ */

function readParams(st){
  const P=st.P;
  for(const d of st.params){
    const n=node(st,d.id);
    if(!n)continue;
    if(d.kind==="check")P[d.id]=n.checked;
    else if(d.kind==="color")P[d.id]=n.value;
    else if(d.kind==="select")P[d.id]=d.numeric?+n.value:n.value;
    else P[d.id]=+n.value;
    const v=el(pid(st,d.id)+"-val");
    if(v)v.textContent=(d.kind==="range")?(+n.value).toFixed(d.dp):n.value;
  }
  if(st.mode.derive)st.mode.derive(P,{
    set:(id,value)=>{
      const n=node(st,id);
      if(!n)return;
      if(n.type==="checkbox")n.checked=value;else n.value=value;
      P[id]=value;
      const v=el(pid(st,id)+"-val");
      if(v)v.textContent=value;
    }
  });
  syncUI(st);
  const note=el(pid(st,"autonote"));
  if(note)note.textContent=autonote(st);
  return P;
}

function applyPreset(st,id){
  const preset=(st.mode.presets||[]).find(p=>p.id===id);
  if(!preset)return;
  for(const k in preset.set){
    const n=node(st,k);
    if(!n)continue;
    if(n.type==="checkbox")n.checked=preset.set[k];else n.value=preset.set[k];
  }
  readParams(st);
  queue(st,false);
}

/* row and group visibility, the scale readout and the tiling tag */
function syncUI(st){
  const m=st.mode,P=st.P;
  const need=m.needs?m.needs(P):[];
  const panel=st.panel;
  if(panel){
    for(const n of panel.querySelectorAll("[data-need]"))
      n.hidden=need.indexOf(n.getAttribute("data-need"))<0;
    for(const n of panel.querySelectorAll("[data-need-any]"))
      n.hidden=!n.getAttribute("data-need-any").split(" ").some(k=>need.indexOf(k)>=0);
    const ro=el(pid(st,"readout"));
    if(ro&&m.readout)ro.innerHTML=m.readout(P);
  }
  if(st===active)el("tiletag").textContent=m.tileTag?m.tileTag(P):"";
}

/* the action label reads as a phrase mid-sentence */
const verb=m=>(m.actionLabel||"forge").toLowerCase();

function autonote(st){
  const m=st.mode,P=st.P,size=P.size|0;
  if(m.autonote)return m.autonote(P);
  if(!m.previewSize)return size>1024?"Press "+verb(m)+" to rebuild at "+size+" px":"Auto-rebuilds up to 1024 px";
  return size>1024
    ?"Dragging previews at "+m.previewSize+" px · press "+verb(m)+" for "+size
    :"Dragging shows a "+m.previewSize+" px preview · release rebuilds at "+size;
}

/* ============================ channel writers ============================
   Resolved once per build rather than string-compared per texel. A mode can
   add its own through mode.writers(B,P) — markings, material id, and so on. */

function makeWriters(st){
  const B=st.B,P=st.P;
  const A=B.A,NRM=B.NRM,RGH=B.RGH,MET=B.MET,AO=B.AO,HGT=B.HGT,ALP=B.ALP,EMI=B.EMI;
  const inv=1/((B.hMax-B.hMin)||1),lo=B.hMin;
  const w={
    basecolor:(i,o,k)=>{o[k]=A[i*3];o[k+1]=A[i*3+1];o[k+2]=A[i*3+2];return ALP?ALP[i]:255;},
    normal:(i,o,k)=>{o[k]=NRM[i*3];o[k+1]=NRM[i*3+1];o[k+2]=NRM[i*3+2];return 255;},
    roughness:(i,o,k)=>{o[k]=o[k+1]=o[k+2]=RGH[i];return 255;},
    metallic:(i,o,k)=>{o[k]=o[k+1]=o[k+2]=MET[i];return 255;},
    ao:(i,o,k)=>{o[k]=o[k+1]=o[k+2]=AO[i];return 255;},
    height:(i,o,k)=>{o[k]=o[k+1]=o[k+2]=Math.round((HGT[i]-lo)*inv*255);return 255;},
    orm:(i,o,k)=>{o[k]=AO[i];o[k+1]=RGH[i];o[k+2]=MET[i];return 255;}
  };
  if(ALP)w.opacity=(i,o,k)=>{o[k]=o[k+1]=o[k+2]=ALP[i];return 255;};
  if(EMI)w.emissive=(i,o,k)=>{const e=EMI[i];o[k]=e;o[k+1]=Math.round(e*0.86);o[k+2]=Math.round(e*0.6);return 255;};
  if(st.mode.writers)Object.assign(w,st.mode.writers(B,P));
  st.writers=w;
}

/* one channel rendered to a canvas, optionally downscaled by nearest neighbour */
function makeMap(st,key,maxW){
  const B=st.B,TW=B.W,TH=B.H;
  let w=TW,h=TH;
  if(maxW&&maxW<TW){const k=maxW/TW;w=Math.max(1,Math.round(TW*k));h=Math.max(1,Math.round(TH*k));}
  const cv=document.createElement("canvas");cv.width=w;cv.height=h;
  const ctx=cv.getContext("2d");
  const img=ctx.createImageData(w,h),o=img.data;
  const write=st.writers[key];
  if(!write)throw new Error("Texture Forge: no writer for channel "+key);
  const kx=TW/w,ky=TH/h;
  for(let y=0;y<h;y++){
    const sy=Math.min(TH-1,Math.floor((y+0.5)*ky));
    for(let x=0;x<w;x++){
      const sx=Math.min(TW-1,Math.floor((x+0.5)*kx));
      const k=(y*w+x)*4;
      o[k+3]=write(sy*TW+sx,o,k);
    }
  }
  ctx.putImageData(img,0,0);
  return cv;
}

/* ============================ lit preview ============================
   One GGX shader for every mode. Tiling modes repeat the UV and composite
   over nothing; cut-out modes (a facade) blend against the chosen backdrop
   with the base-colour alpha and add an emissive pass. */

const VS=[
"attribute vec2 p;varying vec2 vUv;uniform float uRep;uniform float uFlip;",
"void main(){vec2 t=(p*0.5+0.5)*uRep;if(uFlip>0.5)t.y=uRep-t.y;vUv=t;gl_Position=vec4(p,0.0,1.0);}"
].join("\n");
const FS=[
"precision highp float;varying vec2 vUv;",
"uniform sampler2D uB,uN,uO,uE;uniform vec3 uL,uSkyLo,uSkyHi;",
"uniform float uGain,uAmb,uSpecK;uniform int uBg;",
"float D_GGX(float NoH,float a){float a2=a*a;float d=NoH*NoH*(a2-1.0)+1.0;return a2/(3.14159265*d*d);}",
"float V_S(float NoV,float NoL,float a){float a2=a*a;float gv=NoL*sqrt(NoV*NoV*(1.0-a2)+a2);float gl2=NoV*sqrt(NoL*NoL*(1.0-a2)+a2);return 0.5/max(gv+gl2,1e-4);}",
"void main(){",
"  vec4 bs=texture2D(uB,vUv);",
"  vec3 base=pow(bs.rgb,vec3(2.2));",
"  vec3 orm=texture2D(uO,vUv).rgb;",
"  vec3 N=normalize(texture2D(uN,vUv).rgb*2.0-1.0);",
"  float ao=orm.r, rough=clamp(orm.g,0.05,1.0), metal=orm.b;",
"  vec3 V=vec3(0.0,0.0,1.0);vec3 L=normalize(uL);vec3 H=normalize(L+V);",
"  float NoL=max(dot(N,L),0.0),NoV=max(dot(N,V),1e-4),NoH=max(dot(N,H),0.0),VoH=max(dot(V,H),0.0);",
"  vec3 F0=mix(vec3(0.04),base,metal);",
"  vec3 F=F0+(1.0-F0)*pow(1.0-VoH,5.0);",
"  float a=rough*rough;",
"  vec3 spec=F*D_GGX(NoH,a)*V_S(NoV,NoL,a);",
"  vec3 diff=(1.0-F)*(1.0-metal)*base/3.14159265;",
"  vec3 col=(diff+spec)*NoL*uGain;",
"  vec3 sky=mix(uSkyLo,uSkyHi,N.z*0.5+0.5);",
"  col+=base*(1.0-metal)*sky*ao*uAmb;",
"  col+=F0*sky*ao*(uSpecK/(rough+uSpecK));",
"  col+=texture2D(uE,vUv).rgb*1.6;",
"  col=col/(col+vec3(1.0));",
"  col=pow(col,vec3(1.0/2.2));",
"  vec3 back=vec3(0.08,0.08,0.09);",
"  if(uBg==1)back=mix(vec3(0.42,0.56,0.72),vec3(0.72,0.80,0.88),vUv.y);",
"  if(uBg==2){vec2 c=floor(vUv*vec2(34.0,34.0));float m=mod(c.x+c.y,2.0);back=mix(vec3(0.22),vec3(0.32),m);}",
"  gl_FragColor=vec4(mix(back,col,bs.a),1.0);",
"}"].join("\n");

let glc=null,flat=null,fctx=null,gl=null,prog=null,tex={},uloc={},blackTex=null,noGL=false;
let canRepeat=false;                   // whether the live textures can tile in the preview

function initGL(){
  gl=glc.getContext("webgl",{antialias:true})||glc.getContext("experimental-webgl");
  if(!gl)return false;
  const mk=(t,src)=>{const s=gl.createShader(t);gl.shaderSource(s,src);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.warn(gl.getShaderInfoLog(s));return null;}return s;};
  const vs=mk(gl.VERTEX_SHADER,VS),fs=mk(gl.FRAGMENT_SHADER,FS);
  if(!vs||!fs)return false;
  prog=gl.createProgram();gl.attachShader(prog,vs);gl.attachShader(prog,fs);gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){console.warn(gl.getProgramInfoLog(prog));return false;}
  gl.useProgram(prog);
  const buf=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const loc=gl.getAttribLocation(prog,"p");
  gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  for(const k of["uB","uN","uO","uE"])tex[k]=gl.createTexture();
  for(const k of["uB","uN","uO","uE","uL","uRep","uFlip","uGain","uAmb","uSpecK","uSkyLo","uSkyHi","uBg"])
    uloc[k]=gl.getUniformLocation(prog,k);
  gl.uniform1i(uloc.uB,0);gl.uniform1i(uloc.uN,1);gl.uniform1i(uloc.uO,2);gl.uniform1i(uloc.uE,3);
  /* stand-in for modes with no emissive channel */
  blackTex=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,blackTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  return true;
}
const isPOT=n=>n>0&&(n&(n-1))===0;
function upload(unit,texture,canvas,seamless){
  gl.activeTexture(gl.TEXTURE0+unit);
  gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
  /* WebGL1 will not repeat or mipmap a non-power-of-two texture — it renders
     black instead. A tiling mode previewing at, say, 200 px would hit that,
     so fall back rather than showing nothing. */
  const rep=seamless&&isPOT(canvas.width)&&isPOT(canvas.height);
  const wrap=rep?gl.REPEAT:gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,wrap);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,wrap);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,rep?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  if(rep)gl.generateMipmap(gl.TEXTURE_2D);
  return rep;
}
function fitCanvas(c){
  const st=el("stage");
  const aw=Math.max(80,st.clientWidth-32),ah=Math.max(80,st.clientHeight-32);
  const ar=(active&&active.B)?active.B.W/active.B.H:1;
  let w=aw,h=w/ar;
  if(h>ah){h=ah;w=h*ar;}
  c.style.width=w+"px";c.style.height=h+"px";
  const dpr=Math.min(devicePixelRatio||1,2);
  const pw=Math.round(w*dpr),ph=Math.round(h*dpr);
  if(c.width!==pw||c.height!==ph){c.width=pw;c.height=ph;}
}
function refreshGL(){
  if(!gl||!active||!active.B)return;
  const seamless=flagsOf(active).seamless;
  const PS=Math.min(active.B.W,2048);
  canRepeat=upload(0,tex.uB,makeMap(active,"basecolor",PS),seamless);
  upload(1,tex.uN,makeMap(active,"normal",PS),seamless);
  upload(2,tex.uO,makeMap(active,"orm",PS),seamless);
  if(active.writers.emissive)upload(3,tex.uE,makeMap(active,"emissive",PS),seamless);
  else{gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,blackTex);}
  drawGL();
}
function drawGL(){
  if(!gl||!active)return;
  const m=active.mode,pv=m.preview||{};
  fitCanvas(glc);
  gl.viewport(0,0,glc.width,glc.height);
  gl.uniform1f(uloc.uRep,(flagsOf(active).seamless&&canRepeat)?tileN:1);
  gl.uniform1f(uloc.uFlip,m.flipPreviewY?1:0);
  gl.uniform3f(uloc.uL,light[0],light[1],0.72);
  gl.uniform1f(uloc.uGain,pv.gain||3.0);
  gl.uniform1f(uloc.uAmb,pv.amb||1.1);
  gl.uniform1f(uloc.uSpecK,pv.specK||0.55);
  const lo=pv.skyLo||[0.16,0.19,0.23],hi=pv.skyHi||[0.34,0.38,0.44];
  gl.uniform3f(uloc.uSkyLo,lo[0],lo[1],lo[2]);
  gl.uniform3f(uloc.uSkyHi,hi[0],hi[1],hi[2]);
  gl.uniform1i(uloc.uBg,bg==="sky"?1:(bg==="check"?2:0));
  gl.drawArrays(gl.TRIANGLES,0,6);
}
function drawFlat(){
  if(!active||!active.B)return;
  const seamless=flagsOf(active).seamless;
  const src=makeMap(active,view,Math.min(active.B.W,seamless?1024:1400));
  fitCanvas(flat);
  fctx.fillStyle=bg==="sky"?"#7f97b0":(bg==="check"?"#2b2b2b":"#141414");
  fctx.fillRect(0,0,flat.width,flat.height);
  fctx.imageSmoothingEnabled=true;
  if(seamless){
    const cell=flat.width/tileN,rows=flat.height/ (flat.width/tileN);
    for(let ty=0;ty<Math.ceil(rows);ty++)
      for(let tx=0;tx<tileN;tx++)fctx.drawImage(src,tx*cell,ty*cell,cell,cell);
  }else{
    fctx.drawImage(src,0,0,flat.width,flat.height);
  }
}
function renderView(){
  const lit=(view==="lit");
  glc.classList.toggle("on",lit);
  flat.classList.toggle("on",!lit);
  el("hint").style.display=lit?"block":"none";
  if(lit)refreshGL();else drawFlat();
}

/* ============================ export ============================ */

function buildChips(){
  const st=active,wrap=el("chips");
  wrap.innerHTML="";
  const ar=st.B.H/st.B.W;
  for(const ch of st.mode.channels){
    const d=make("div","chip");
    const c=makeMap(st,ch.key,st.mode.chipSource||176);
    c.style.width="88px";c.style.height=Math.round(88*ar)+"px";
    const b=make("button",null,ch.label);
    b.type="button";b.title="Download "+ch.label+" PNG";
    b.addEventListener("click",()=>downloadOne(ch.key));
    d.appendChild(c);d.appendChild(b);wrap.appendChild(d);
  }
}
function fileBase(st){
  const B=st.B;
  return st.mode.fileBase?st.mode.fileBase(st.P,B.W,B.H):(st.mode.id+"_"+(st.P.seed|0)+"_"+B.W+"x"+B.H);
}
const fileName=(st,key)=>fileBase(st)+"_"+key+".png";

function saveBlob(blob,name){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=name;a.style.display="none";
  document.body.appendChild(a);a.click();a.remove();
  return url;
}
/* exports refuse to run off a drag preview — it would silently be the wrong size */
function exportGuard(){
  const st=active;
  if(!st||!st.B){setStatus("Build something first");return false;}
  /* compared against the size the controls ask for now, so changing the
     resolution and exporting without rebuilding is caught too */
  /* both axes: a mode whose output changes shape (a facade face, a roof) can
     otherwise pass a width-only check and export the previous shape's pixels */
  const want=st.mode.size(st.P,false);
  if(st.B.W<want.w||st.B.H!==want.h){
    setStatus("That is a "+st.B.W+"×"+st.B.H+" build — press "+verb(st.mode)+
      " for "+want.w+"×"+want.h+" first");
    return false;
  }
  return true;
}
function downloadOne(key){
  if(!exportGuard())return;
  const st=active;
  setStatus("Encoding "+key+"…");
  const cv=makeMap(st,key);
  if(!cv.toBlob){setStatus("This browser can't encode canvas PNGs");return;}
  cv.toBlob(b=>{
    if(!b){setStatus("PNG encode failed on "+key);return;}
    const url=saveBlob(b,fileName(st,key));
    setTimeout(()=>URL.revokeObjectURL(url),20000);
    setStatus(sizeTag(st));
  },"image/png");
}

/* minimal store-only ZIP writer (PNGs are already compressed) */
let CRCT=null;
function crc32(buf){
  if(!CRCT){CRCT=new Uint32Array(256);
    for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);CRCT[n]=c>>>0;}}
  let c=0xFFFFFFFF;
  for(let i=0;i<buf.length;i++)c=CRCT[(c^buf[i])&0xFF]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0;
}
function makeZip(files){
  const enc=new TextEncoder(),parts=[],central=[];let off=0;
  const d=new Date();
  const dt=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1);
  const dd=((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
  for(const f of files){
    const nb=enc.encode(f.name),crc=crc32(f.data),len=f.data.length;
    const lh=new Uint8Array(30+nb.length),lv=new DataView(lh.buffer);
    lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0,true);lv.setUint16(8,0,true);
    lv.setUint16(10,dt,true);lv.setUint16(12,dd,true);lv.setUint32(14,crc,true);
    lv.setUint32(18,len,true);lv.setUint32(22,len,true);
    lv.setUint16(26,nb.length,true);lv.setUint16(28,0,true);lh.set(nb,30);
    parts.push(lh,f.data);
    const ch=new Uint8Array(46+nb.length),cv=new DataView(ch.buffer);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);
    cv.setUint16(8,0,true);cv.setUint16(10,0,true);cv.setUint16(12,dt,true);cv.setUint16(14,dd,true);
    cv.setUint32(16,crc,true);cv.setUint32(20,len,true);cv.setUint32(24,len,true);
    cv.setUint16(28,nb.length,true);cv.setUint16(30,0,true);cv.setUint16(32,0,true);
    cv.setUint16(34,0,true);cv.setUint16(36,0,true);cv.setUint32(38,0,true);cv.setUint32(42,off,true);
    ch.set(nb,46);central.push(ch);
    off+=lh.length+len;
  }
  let cdSize=0;for(const c of central)cdSize+=c.length;
  const eo=new Uint8Array(22),ev=new DataView(eo.buffer);
  ev.setUint32(0,0x06054b50,true);ev.setUint16(4,0,true);ev.setUint16(6,0,true);
  ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);
  ev.setUint32(12,cdSize,true);ev.setUint32(16,off,true);ev.setUint16(20,0,true);
  return new Blob(parts.concat(central,[eo]),{type:"application/zip"});
}

/* A kerb step or a window reveal is ten times the surface's own relief, so an
   8-bit height map quantises the flat parts into a couple of dozen levels.
   This writes a real 16-bit greyscale PNG, deflating through CompressionStream. */
async function png16Height(){
  if(typeof CompressionStream==="undefined")return null;
  const B=active.B,w=B.W,h=B.H,HGT=B.HGT;
  const raw=new Uint8Array((w*2+1)*h);
  const inv=65535/((B.hMax-B.hMin)||1),lo=B.hMin;
  let p=0;
  for(let yy=0;yy<h;yy++){
    raw[p++]=0;                                   // filter: none
    for(let xx=0;xx<w;xx++){
      let sv=Math.round((HGT[yy*w+xx]-lo)*inv);
      if(sv<0)sv=0;else if(sv>65535)sv=65535;
      raw[p++]=sv>>>8;raw[p++]=sv&255;            // PNG samples are big-endian
    }
  }
  const cs=new CompressionStream("deflate");
  const wr=cs.writable.getWriter();wr.write(raw);wr.close();
  const z=new Uint8Array(await new Response(cs.readable).arrayBuffer());
  const chunk=(type,data)=>{
    const out=new Uint8Array(12+data.length),n=data.length;
    out[0]=(n>>>24)&255;out[1]=(n>>>16)&255;out[2]=(n>>>8)&255;out[3]=n&255;
    for(let i=0;i<4;i++)out[4+i]=type.charCodeAt(i);
    out.set(data,8);
    const c=crc32(out.subarray(4,8+n));
    out[8+n]=(c>>>24)&255;out[9+n]=(c>>>16)&255;out[10+n]=(c>>>8)&255;out[11+n]=c&255;
    return out;
  };
  const ih=new Uint8Array(13);
  ih[0]=(w>>>24)&255;ih[1]=(w>>>16)&255;ih[2]=(w>>>8)&255;ih[3]=w&255;
  ih[4]=(h>>>24)&255;ih[5]=(h>>>16)&255;ih[6]=(h>>>8)&255;ih[7]=h&255;
  ih[8]=16;ih[9]=0;                                // 16-bit greyscale
  const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),
    chunk("IHDR",ih),chunk("IDAT",z),chunk("IEND",new Uint8Array(0))];
  let len=0;for(const q of parts)len+=q.length;
  const out=new Uint8Array(len);let o=0;
  for(const q of parts){out.set(q,o);o+=q.length;}
  return out;
}
async function downloadH16(){
  if(!exportGuard())return;
  const st=active;
  setStatus("Encoding 16-bit height…");
  const png=await png16Height();
  if(!png){setStatus("16-bit needs CompressionStream — not in this browser");return;}
  const url=saveBlob(new Blob([png],{type:"image/png"}),fileName(st,"height16"));
  setTimeout(()=>URL.revokeObjectURL(url),20000);
  setStatus(sizeTag(st)+" · 16-bit height saved");
}
async function downloadZip(){
  if(!exportGuard())return;
  const st=active,btn=el("zipall"),save=el("zipsave");
  btn.disabled=true;save.hidden=true;
  try{
    const files=[];let n=0;
    for(const ch of st.mode.channels){
      setStatus("Packing "+ch.label+"…");
      setBar(++n/(st.mode.channels.length+1));
      await new Promise(r=>setTimeout(r,0));            // let the status repaint
      const blob=await new Promise((res,rej)=>{
        const cv=makeMap(st,ch.key);
        if(!cv.toBlob){rej(new Error("this browser can't encode canvas PNGs"));return;}
        cv.toBlob(b=>b?res(b):rej(new Error("PNG encode failed on "+ch.key)),"image/png");
      });
      files.push({name:fileName(st,ch.key),data:new Uint8Array(await blob.arrayBuffer())});
    }
    if(st.mode.height16!==false){
      const h16=await png16Height();
      if(h16)files.push({name:fileName(st,"height16"),data:h16});
    }
    files.push({name:fileBase(st)+"_readme.txt",
      data:new TextEncoder().encode(readmeText(st))});
    const zip=makeZip(files),name=fileBase(st)+".zip";
    if(st.zipUrl)URL.revokeObjectURL(st.zipUrl);
    st.zipUrl=saveBlob(zip,name);
    save.href=st.zipUrl;save.download=name;
    save.textContent="Save "+name+" ("+(zip.size/1048576).toFixed(1)+" MB)";
    save.hidden=false;
    setBar(0);
    setStatus(files.length+" files packed · click save if nothing downloaded");
  }catch(err){
    setBar(0);setStatus("Zip failed — "+((err&&err.message)||err));console.error(err);
  }finally{btn.disabled=false;}
}
function readmeText(st){
  const B=st.B;
  return st.mode.readme(st.P,{
    W:B.W,H:B.H,hMin:B.hMin,hMax:B.hMax,
    normalNote:st.P.flipG?"DirectX (green down)":"OpenGL (green up)"
  });
}

/* ============================ run loop ============================ */

function setBar(t){el("bar").style.width=(clamp(t,0,1)*100).toFixed(1)+"%";}
function setStatus(s){el("status").textContent=s;}
function sizeTag(st){
  const B=st.B;
  return B.W+"×"+B.H+(st.mode.sizeTag?" · "+st.mode.sizeTag(st.P):"")+" · seed "+(st.P.seed|0);
}

function run(st,preview){
  if(st.busy){st.pending=!!preview;return;}
  const m=st.mode;
  st.busy=true;
  st.preview=!!preview&&!!m.previewSize;
  const btn=el(pid(st,"forge"));
  if(btn)btn.disabled=true;
  if(st===active)setStatus(st.preview?"Previewing…":(m.busyLabel||"Forging…"));
  const t0=performance.now();
  const full=m.size(st.P,false);
  const dim=m.size(st.P,st.preview);
  m.build(st.P,{
    W:dim.w,H:dim.h,preview:st.preview,
    progress:t=>{if(st===active)setBar(t);},
    done:B=>{
      B.W=dim.w;B.H=dim.h;
      st.B=B;st.built=true;st.busy=false;
      st.flags={seamless:flag(m,"seamless",st.P),backdrops:flag(m,"backdrops",st.P)};
      if(btn)btn.disabled=false;
      makeWriters(st);
      if(st===active){
        syncChrome(st);
        setBar(0);
        el("zipsave").hidden=true;                  // any previous archive is stale
        setStatus(st.preview&&B.W<full.w
          ? B.W+" px preview · release for "+full.w
          : sizeTag(st)+" · "+Math.round(performance.now()-t0)+" ms");
        buildChips();renderView();
      }
      if(st.pending!==null){const p=st.pending;st.pending=null;run(st,p);}
    }
  });
}
function queue(st,preview){
  const m=st.mode;
  const usePreview=!!preview&&!!m.previewSize;
  /* heavy sizes are forged on demand only; a mode with a drag preview still
     gets its small preview, a mode without one waits for the button */
  if(!usePreview&&(st.P.size|0)>1024){
    if(st===active)setStatus("Press "+verb(m)+" to rebuild at "+(st.P.size|0)+" px");
    return;
  }
  clearTimeout(st.qTimer);
  st.qTimer=setTimeout(()=>run(st,usePreview),usePreview?90:40);
}

/* ============================ mode switching ============================ */

function activate(id){
  const st=STATE[id];
  if(!st||st===active)return;
  if(active){
    active.panel.hidden=true;
    /* keep the last build for a quick flick back, but do not sit on a
       4096² set for every mode the user has opened */
    if(active.B&&active.B.W*active.B.H>RETAIN_TEXELS){
      active.B=null;active.writers=null;active.built=false;active.flags=null;  // writers close over the buffers
    }
  }
  active=st;
  st.panel.hidden=false;
  document.body.dataset.mode=id;
  for(const b of el("modebar-tabs").children)
    b.setAttribute("aria-pressed",String(b.dataset.mode===id));
  try{localStorage.setItem("texture-forge-mode",id);}catch(e){}
  try{history.replaceState(null,"","#"+id);}catch(e){}

  buildViewTabs(st);
  syncChrome(st);
  el("zipsave").hidden=true;
  syncUI(st);

  if(st.built&&st.B){
    buildChips();renderView();
    setStatus(sizeTag(st));
  }else{
    el("chips").innerHTML="";
    run(st,false);
  }
}

/* the channel tabs follow the active mode: markings, material id and the
   rest only exist where a mode declares them */
function buildViewTabs(st){
  const wrap=el("tabs");
  wrap.innerHTML="";
  const list=[{key:"lit",label:"Lit preview"}].concat(st.mode.channels.filter(c=>c.tab!==false));
  if(noGL&&view==="lit")view=st.mode.channels[0].key;
  if(!list.some(c=>c.key===view))view=noGL?st.mode.channels[0].key:"lit";
  for(const c of list){
    const b=make("button","tab",c.key==="lit"&&noGL?"Lit (no WebGL)":c.label);
    b.dataset.view=c.key;
    b.setAttribute("aria-pressed",String(c.key===view));
    if(c.key==="lit"&&noGL)b.disabled=true;
    wrap.appendChild(b);
  }
}

/* ============================ boot ============================ */

function boot(){
  glc=el("gl");flat=el("flat");fctx=flat.getContext("2d");

  if(!MODES.length){
    el("status").textContent="No modes loaded";
    el("stage").insertAdjacentHTML("beforeend",
      '<div class="fatal">No modes registered. Check that the <code>modes/*.js</code> '+
      'files sit next to this page and are listed in index.html.</div>');
    return;
  }

  const tabs=el("modebar-tabs");
  for(const m of MODES){
    const st=stateFor(m);
    st.panel=buildPanel(st);
    st.panel.hidden=true;
    el("app").insertBefore(st.panel,el("bay"));
    wireInputs(st);            // needs the panel in the document to find its ids
    readParams(st);
    const b=make("button","modetab",m.label);
    b.type="button";b.dataset.mode=m.id;
    if(m.blurb)b.title=m.blurb;
    b.setAttribute("aria-pressed","false");
    tabs.appendChild(b);
  }
  tabs.addEventListener("click",e=>{
    const b=e.target.closest("[data-mode]");
    if(b)activate(b.dataset.mode);
  });

  noGL=!initGL();

  el("tabs").addEventListener("click",e=>{
    const b=e.target.closest("[data-view]");
    if(!b||b.disabled)return;
    view=b.dataset.view;
    for(const t of el("tabs").children)t.setAttribute("aria-pressed",String(t===b));
    renderView();
  });
  el("tiles").addEventListener("click",e=>{
    const b=e.target.closest("[data-tile]");if(!b)return;
    tileN=+b.dataset.tile;
    for(const t of el("tiles").children)t.setAttribute("aria-pressed",String(t===b));
    renderView();
  });
  el("bgs").addEventListener("click",e=>{
    const b=e.target.closest("[data-bg]");if(!b)return;
    bg=b.dataset.bg;
    for(const t of el("bgs").children)t.setAttribute("aria-pressed",String(t===b));
    renderView();
  });
  el("zipall").addEventListener("click",downloadZip);
  el("h16").addEventListener("click",downloadH16);

  let dragging=false;
  const setLightFrom=e=>{
    const r=glc.getBoundingClientRect();
    light=[clamp(((e.clientX-r.left)/r.width)*2-1,-1,1),clamp(1-((e.clientY-r.top)/r.height)*2,-1,1)];
    drawGL();
  };
  glc.addEventListener("pointerdown",e=>{dragging=true;glc.setPointerCapture(e.pointerId);setLightFrom(e);});
  glc.addEventListener("pointermove",e=>{if(dragging)setLightFrom(e);});
  glc.addEventListener("pointerup",()=>{dragging=false;});
  glc.addEventListener("pointercancel",()=>{dragging=false;});
  addEventListener("resize",()=>{if(view==="lit")drawGL();else drawFlat();});
  addEventListener("hashchange",()=>{
    const id=(location.hash||"").replace(/^#/,"");
    if(BY_ID[id])activate(id);
  });

  let want=(location.hash||"").replace(/^#/,"");
  if(!BY_ID[want]){try{want=localStorage.getItem("texture-forge-mode");}catch(e){want=null;}}
  activate(BY_ID[want]?want:MODES[0].id);
}

/* Write a parameter into ANOTHER mode's panel. This is the one facility a mode
   has for coordinating with a sibling — the house family uses it to keep the
   front, the side, the back and the roof describing one building. It writes
   the form and the parameter object directly and marks that mode's last build
   stale, but deliberately does NOT run the other mode's derive, so two modes
   can mirror each other without ping-ponging. Returns false when the target
   mode is not loaded, does not have that control, or already holds the value. */
Forge.setParam=function(modeId,id,value){
  const st=STATE[modeId];
  if(!st||!st.params)return false;
  let d=null;
  for(const x of st.params)if(x.id===id){d=x;break;}
  const n=d&&node(st,id);
  if(!n)return false;
  const v=(d.kind==="check")?!!value
    :(d.kind==="color")?String(value)
    :(d.kind==="select")?(d.numeric?+value:String(value))
    :+value;
  if(st.P[id]===v)return false;
  if(d.kind==="check")n.checked=v;else n.value=v;
  st.P[id]=v;
  const span=el(pid(st,id)+"-val");
  if(span)span.textContent=(d.kind==="range")?(+n.value).toFixed(d.dp):n.value;
  st.built=false;                       // its last build no longer matches its parameters
  return true;
};

/* exposed for modes and for the headless parity harness */
Forge.makeMap=(key,maxW)=>makeMap(active,key,maxW);
Forge.active=()=>active;
Forge.activate=activate;
Forge.state=id=>STATE[id];

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);
else boot();

})();
