/* =====================================================================
   TEXTURE FORGE — the shared prelude
   =====================================================================
   The maths every generator is built from, the resolution ladder, and
   the registry a mode registers itself into. Nothing in here touches
   the DOM, which is the entire point: forge-core.js loads it to run the
   app, and forge-worker.js loads it to run the same generators on a
   worker thread, where there is no document to touch.

   window.Forge is CREATED here and EXTENDED by forge-core.js. Load
   order matters: this file, then the runtime, then the modes.
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

/* ============================ resolution ladder ============================
   Every mode offers the same ladder, so one list changes them all. `style` only
   picks the wording: a square tiling map reads "512 × 512", a mode whose height
   follows its own content reads "512", and one dimensioned by its width reads
   "512 px wide". `max` caps a mode that cannot usefully go higher.

   The small end of the ladder is there for pixel art. Below about 256 px most
   modes are DROPPING detail rather than shrinking it — every mode's readout
   already says which features it had to let go — and the palette, dither and
   nearest-neighbour controls in the preview bar are what that end is for. */
const SIZE_LADDER=[64,128,256,512,1024,2048,4096];
const HEAVY=" — slow, heavy";

/* ============================ registry ============================ */

const MODES=[],BY_ID={};
const Forge={
  clamp:clamp,lerp:lerp,smoothstep:smoothstep,mulberry32:mulberry32,hashi:hashi,
  vnoise:vnoise,fbm:fbm,vnoise2:vnoise2,fbm2:fbm2,wrapDist:wrapDist,hex2rgb:hex2rgb,
  blurWrap:blurWrap,blurClamp:blurClamp,
  sizes:function(style,max){
    return SIZE_LADDER.filter(function(n){return !max||n<=max;}).map(function(n){
      const h=(n>=4096)?HEAVY:"";
      return [n, style==="wide"?(n+" px wide"+h)
               : style==="plain"?(n+h)
               : (n+" × "+n+h)];
    });
  },
  modes:MODES,
  byId:BY_ID,
  register:function(mode){
    if(BY_ID[mode.id]){console.warn("Texture Forge: duplicate mode id "+mode.id);return;}
    BY_ID[mode.id]=mode;MODES.push(mode);
  }
};

/* Structures register at load time the same way modes do, so the registry has
   to exist before any mode file runs — which means here rather than in the
   runtime, where the wizard that walks them lives. */
const STRUCTURES=[],STRUCT_BY={};
Forge.registerStructure=function(s){
  if(STRUCT_BY[s.id]){console.warn("Texture Forge: duplicate structure id "+s.id);return;}
  STRUCT_BY[s.id]=s;STRUCTURES.push(s);
};
Forge.structures=STRUCTURES;
Forge.structById=STRUCT_BY;

/* `self` on a worker, `window` in a page: the same object either way once the
   worker has aliased it, so this one line serves both. */
window.Forge=Forge;

})();
