/* =====================================================================
   TEXTURE FORGE — the channel compositor, on the GPU
   =====================================================================

   WHAT THIS IS AND IS NOT. The generators are sixteen hand-written
   per-texel loops in JavaScript and this does not touch any of them; a
   GLSL port of the lot is a different piece of work. What it replaces is
   the one heavy thing every mode does identically at the end: turning
   the finished buffers into images.

   makeMap() ran a JS loop over every texel of every channel, writing
   four bytes at a time into an ImageData. A 4096-square house has ten
   channels, so that is a hundred and sixty-odd million iterations to
   produce one export — plus another pass for the chip strip, and
   another for each preview upload, several times a second while you
   drag a slider. It is mode-agnostic, it is embarrassingly parallel,
   and it is exactly what a fragment shader is for.

   NO INTERLEAVING. The buffers already have the shapes WebGL2 wants:
   A and NRM are tightly packed RGB8, RGH/MET/AO/ALP/EMI are R8, HGT is
   R32F. Every one uploads straight from the typed array it was built
   in, so there is no CPU pass to prepare the CPU pass we are removing.
   The upload happens once per build and every channel reads it.

   THE RESULT IS A 2D CANVAS. It renders on the GPU and is then blitted
   into a 2D canvas, because the rest of the app — the chips, the
   palette quantiser, the parity harness — expects to be able to ask for
   a 2d context. That blit is a GPU-side copy and costs nothing next to
   the loop it replaces.

   WHAT STAYS ON THE CPU:
     · a channel a mode writes itself — material id, markings, an infill
       mask, an emissive with its own colour ramp. Those are arbitrary
       JS, and the runtime cannot know what they do.
     · a palettised base colour. The quantiser wants the pixels back,
       and reading them back would give away what was gained. Only the
       base colour is ever palettised, so the other eight channels take
       the fast path regardless.
     · anything at all if there is no WebGL2, or the context is lost.
       Every entry point returns null and the caller falls back.
   ===================================================================== */
"use strict";

(function(){

const VS=`#version 300 es
in vec2 p;
void main(){gl_Position=vec4(p,0.0,1.0);}`;

/* One program with a channel switch rather than nine programs: the branch is
   uniform across the draw, so every lane takes the same path and it costs
   nothing on any hardware made this century. */
const FS=`#version 300 es
precision highp float;precision highp sampler2D;
uniform sampler2D uA,uN,uR,uM,uO,uP,uE,uH;
uniform vec2 uSrc,uDst;
uniform int uCh;
uniform int uHasP,uHasE;
uniform float uHLo,uHInv;
uniform vec3 uEmiC;
out vec4 o;

/* the same texel the CPU path picks: floor((x+0.5)*srcW/dstW), and the row
   flipped because an ImageData starts at the top and a framebuffer does not */
ivec2 src(){
  vec2 k=uSrc/uDst;
  float sx=floor(gl_FragCoord.x*k.x);
  float sy=floor((uDst.y-gl_FragCoord.y)*k.y);
  return ivec2(min(sx,uSrc.x-1.0),min(sy,uSrc.y-1.0));
}
/* written back as a byte either way, so it is rounded here rather than left
   to the blend and rounding rules to agree with Math.round */
float q(float v){return floor(clamp(v,0.0,1.0)*255.0+0.5)/255.0;}
vec3 q3(vec3 v){return vec3(q(v.r),q(v.g),q(v.b));}

void main(){
  ivec2 s=src();
  float a=(uHasP==1)?texelFetch(uP,s,0).r:1.0;
  if(uCh==0)      o=vec4(q3(texelFetch(uA,s,0).rgb),q(a));
  else if(uCh==1) o=vec4(q3(texelFetch(uN,s,0).rgb),1.0);
  else if(uCh==2) o=vec4(vec3(q(texelFetch(uR,s,0).r)),1.0);
  else if(uCh==3) o=vec4(vec3(q(texelFetch(uM,s,0).r)),1.0);
  else if(uCh==4) o=vec4(vec3(q(texelFetch(uO,s,0).r)),1.0);
  else if(uCh==5) o=vec4(vec3(q((texelFetch(uH,s,0).r-uHLo)*uHInv)),1.0);
  else if(uCh==6) o=vec4(q(texelFetch(uO,s,0).r),q(texelFetch(uR,s,0).r),
                         q(texelFetch(uM,s,0).r),1.0);
  else if(uCh==7) o=vec4(vec3(q(a)),1.0);
  else            o=vec4(q3(((uHasE==1)?texelFetch(uE,s,0).r:0.0)*uEmiC),1.0);
}`;

const CH={basecolor:0,normal:1,roughness:2,metallic:3,ao:4,height:5,orm:6,opacity:7,emissive:8};

let gl=null,prog=null,U={},vao=null,cv=null,ready=null;
let tex={},bound=null,boundW=0,boundH=0;
let renderer="unknown",software=false,forced=null;

/* A SOFTWARE WEBGL IMPLEMENTATION IS NOT A GPU. SwiftShader and llvmpipe are
   the same CPU running a rasteriser instead of running the loop below, and
   they lose to it by a wide margin — the texture upload alone is a memcpy of
   the whole build. Named renderers are ruled out here so the calibration in
   the runtime never has to pay to discover it. */
const SOFT=/swiftshader|llvmpipe|software|basic render|softpipe|mesa offscreen/i;

function compile(type,src){
  const s=gl.createShader(type);
  gl.shaderSource(s,src);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){
    console.warn("Texture Forge GPU: "+gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}

function init(){
  if(ready!==null)return ready;
  ready=false;
  try{
    cv=document.createElement("canvas");cv.width=cv.height=1;
    gl=cv.getContext("webgl2",{antialias:false,depth:false,stencil:false,
                               premultipliedAlpha:false,preserveDrawingBuffer:true});
    if(!gl)return ready;
    const vs=compile(gl.VERTEX_SHADER,VS),fs=compile(gl.FRAGMENT_SHADER,FS);
    if(!vs||!fs)return ready;
    prog=gl.createProgram();
    gl.attachShader(prog,vs);gl.attachShader(prog,fs);
    gl.bindAttribLocation(prog,0,"p");
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){
      console.warn("Texture Forge GPU: "+gl.getProgramInfoLog(prog));
      return ready;
    }
    gl.useProgram(prog);
    for(const n of ["uA","uN","uR","uM","uO","uP","uE","uH","uSrc","uDst","uCh",
                    "uHasP","uHasE","uHLo","uHInv","uEmiC"])
      U[n]=gl.getUniformLocation(prog,n);
    /* the samplers are bound to fixed units once and never move */
    const units={uA:0,uN:1,uR:2,uM:3,uO:4,uP:5,uE:6,uH:7};
    for(const n in units)gl.uniform1i(U[n],units[n]);
    vao=gl.createVertexArray();
    gl.bindVertexArray(vao);
    const b=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,b);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);
    const dbg=gl.getExtension("WEBGL_debug_renderer_info");
    renderer=String((dbg&&gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))||
                    gl.getParameter(gl.RENDERER)||"unknown");
    software=SOFT.test(renderer);
    ready=true;
    cv.addEventListener("webglcontextlost",e=>{e.preventDefault();ready=false;bound=null;});
  }catch(e){ready=false;}
  return ready;
}

function makeTex(unit,w,h,internal,format,type,data){
  let t=tex[unit];
  if(!t){t=tex[unit]=gl.createTexture();}
  gl.activeTexture(gl.TEXTURE0+unit);
  gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,format,type,data);
  return t;
}
/* a 1x1 stand-in, so a shader that never reads a missing buffer still has
   something bound to the unit it names */
function stubTex(unit){
  makeTex(unit,1,1,gl.R8,gl.RED,gl.UNSIGNED_BYTE,new Uint8Array(1));
}

/* Upload one build's buffers. Once per build, however many channels come off
   it — which is the whole point, since the chip strip alone asks for nine. */
function upload(B){
  if(bound===B&&boundW===B.W&&boundH===B.H)return true;
  const w=B.W,h=B.H,n=w*h;
  if(!B.A||B.A.length<n*3||!B.NRM||B.NRM.length<n*3)return false;
  try{
    const u8=a=>(a instanceof Uint8Array)?a:new Uint8Array(a.buffer,a.byteOffset,a.length);
    makeTex(0,w,h,gl.RGB8,gl.RGB,gl.UNSIGNED_BYTE,u8(B.A));
    makeTex(1,w,h,gl.RGB8,gl.RGB,gl.UNSIGNED_BYTE,u8(B.NRM));
    makeTex(2,w,h,gl.R8,gl.RED,gl.UNSIGNED_BYTE,u8(B.RGH));
    makeTex(3,w,h,gl.R8,gl.RED,gl.UNSIGNED_BYTE,u8(B.MET));
    makeTex(4,w,h,gl.R8,gl.RED,gl.UNSIGNED_BYTE,u8(B.AO));
    if(B.ALP)makeTex(5,w,h,gl.R8,gl.RED,gl.UNSIGNED_BYTE,u8(B.ALP));else stubTex(5);
    if(B.EMI)makeTex(6,w,h,gl.R8,gl.RED,gl.UNSIGNED_BYTE,u8(B.EMI));else stubTex(6);
    makeTex(7,w,h,gl.R32F,gl.RED,gl.FLOAT,B.HGT);
    if(gl.getError()!==gl.NO_ERROR){bound=null;return false;}
  }catch(e){bound=null;return false;}
  bound=B;boundW=w;boundH=h;
  return true;
}

/* Render one channel. Returns a 2D canvas, or null to say "do it yourself". */
function channel(B,key,w,h,emiC){
  if(!init())return null;
  if(!(key in CH))return null;
  if(!upload(B))return null;
  try{
    if(cv.width!==w||cv.height!==h){cv.width=w;cv.height=h;}
    gl.viewport(0,0,w,h);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(U.uSrc,B.W,B.H);
    gl.uniform2f(U.uDst,w,h);
    gl.uniform1i(U.uCh,CH[key]);
    gl.uniform1i(U.uHasP,B.ALP?1:0);
    gl.uniform1i(U.uHasE,B.EMI?1:0);
    const span=(B.hMax-B.hMin)||1;
    gl.uniform1f(U.uHLo,B.hMin);
    gl.uniform1f(U.uHInv,1/span);
    const c=emiC||[1,0.86,0.6];
    gl.uniform3f(U.uEmiC,c[0],c[1],c[2]);
    gl.drawArrays(gl.TRIANGLES,0,3);
    if(gl.getError()!==gl.NO_ERROR)return null;
    /* Straight into a fresh 2D canvas: one blit, not two. The caller owns what
       comes back — a chip is held for the rest of the session — so it cannot
       be handed a scratch surface the next call would overwrite. */
    const outCv=document.createElement("canvas");
    outCv.width=w;outCv.height=h;
    outCv.getContext("2d").drawImage(cv,0,0);
    return outCv;
  }catch(e){return null;}
}

window.ForgeGPU={
  /* Whether the fast path is worth offering. Compiling and a software
     rasteriser are two different kinds of no, and the runtime wants to know
     the difference — one is permanent, the other is just this machine. */
  available:function(){
    if(forced!==null)return forced&&init();
    return init()&&!software;
  },
  renderer:function(){init();return renderer;},
  software:function(){init();return software;},
  /* the parity harness needs to run the path this machine would not choose */
  force:function(v){forced=(v===null||v===undefined)?null:!!v;},
  /* the channels it can do without knowing anything about the mode */
  handles:function(key){return key in CH;},
  channel:channel,
  forget:function(){bound=null;}
};

})();
