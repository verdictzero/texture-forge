/* =====================================================================
   TEXTURE FORGE — the 3D stage
   =====================================================================
   The wizard walks you through four faces of one building. Until now it
   showed you those faces the way every other mode is shown: one flat
   rectangle at a time, head on. Which is the right way to look at a
   TEXTURE and the wrong way to look at a BUILDING — the whole question a
   wizard exists to answer is whether the side belongs to the front, and
   you cannot see that in two pictures viewed ten seconds apart.

   So this draws the building. Orbit it, and the four walls and the roof
   are there together, at true scale, with whatever has been forged so far
   mapped onto them and whatever has not shown as bare massing.

   IT IS THE EXPORT'S OWN GEOMETRY. The scene comes out of
   ForgeModel.buildingScene — the same call, with the same plans, that
   writes model.gltf when the wizard packs the archive. That is the point:
   this is not a second idea of what the building is that can drift from
   the first. If the roof plane floats above the parapet here, it floats
   in Blender too, and you can see it before you export rather than after.

   WHAT IT ADDS over the exported scene is only what you cannot ship in a
   glTF: a ground to stand on, a sky to stand against, a frame around the
   face the current step is drawing, and the hit test that lets you click
   a wall to go and work on it.

   WebGL 1, like the flat preview — same reasons, same reach. No WebGL and
   the wizard simply does not offer the tab.
   ===================================================================== */
"use strict";

(function(){

/* ============================ small matrix maths ============================
   Column-major, glTF's convention and WebGL's, so a matrix goes to
   uniformMatrix4fv untransposed. */

function mul(a,b){
  const o=new Float32Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++){
    let s=0;
    for(let k=0;k<4;k++)s+=a[k*4+r]*b[c*4+k];
    o[c*4+r]=s;
  }
  return o;
}
function perspective(fovy,aspect,near,far){
  const f=1/Math.tan(fovy/2),nf=1/(near-far);
  const o=new Float32Array(16);
  o[0]=f/aspect;o[5]=f;o[10]=(far+near)*nf;o[11]=-1;o[14]=2*far*near*nf;
  return o;
}
function norm(v){
  const l=Math.hypot(v[0],v[1],v[2])||1;
  return [v[0]/l,v[1]/l,v[2]/l];
}
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];

function lookAt(eye,at,up){
  const z=norm(sub(eye,at)),x=norm(cross(up,z)),y=cross(z,x);
  const o=new Float32Array(16);
  o[0]=x[0];o[1]=y[0];o[2]=z[0];
  o[4]=x[1];o[5]=y[1];o[6]=z[1];
  o[8]=x[2];o[9]=y[2];o[10]=z[2];
  o[12]=-dot(x,eye);o[13]=-dot(y,eye);o[14]=-dot(z,eye);o[15]=1;
  return o;
}

/* ============================ the shaders ============================ */

const VS=[
"attribute vec3 aP;attribute vec3 aN;attribute vec2 aT;attribute vec4 aTan;",
"uniform mat4 uMVP;",
"varying vec3 vP;varying vec3 vN;varying vec2 vUv;varying vec4 vTan;",
"void main(){",
"  vP=aP;vN=aN;vUv=aT;vTan=aTan;",
"  gl_Position=uMVP*vec4(aP,1.0);",
"}"].join("\n");

/* uMode: 0 a forged face, 1 a face nobody has forged yet, 2 the ground.
   One program rather than three because the lighting has to be IDENTICAL
   across them — a ground lit by a different sun than the wall standing on it
   reads as a compositing error, and that is exactly the class of mistake this
   view exists to catch. */
const FS=[
"precision highp float;",
"varying vec3 vP;varying vec3 vN;varying vec2 vUv;varying vec4 vTan;",
"uniform sampler2D uB,uN,uO,uE;",
"uniform vec3 uSun,uSunCol,uSkyLo,uSkyHi,uAccent;",
"uniform vec3 uEye;",
"uniform vec2 uFoot;",
"uniform vec4 uUv;",   // this mesh's UV rectangle: min.xy, span.xy                       // building half-extents, for the contact shade
"uniform float uCut,uMark,uHover,uGain,uAmb,uFade;",
"uniform int uMode;",
"float D_GGX(float NoH,float a){float a2=a*a;float d=NoH*NoH*(a2-1.0)+1.0;return a2/(3.14159265*d*d);}",
"float V_S(float NoV,float NoL,float a){float a2=a*a;",
"  float gv=NoL*sqrt(NoV*NoV*(1.0-a2)+a2);float gl2=NoV*sqrt(NoL*NoL*(1.0-a2)+a2);",
"  return 0.5/max(gv+gl2,1e-4);}",
"void main(){",
"  vec3 base;float rough;float metal;float ao;vec3 emis=vec3(0.0);",
"  vec3 N=normalize(vN);",
"  float alpha=1.0;",
"  if(uMode==0){",
"    vec4 bs=texture2D(uB,vUv);",
"    alpha=bs.a;",
"    if(uCut>0.5&&alpha<0.5)discard;",
"    base=pow(bs.rgb,vec3(2.2));",
"    vec3 orm=texture2D(uO,vUv).rgb;",
"    ao=orm.r;rough=clamp(orm.g,0.05,1.0);metal=orm.b;",
"    emis=texture2D(uE,vUv).rgb;",
/*   the tangent frame is built from the face's own UVs, so a normal map made
     for a wall lights the same way here as it does in the flat preview */
"    vec3 T=normalize(vTan.xyz-N*dot(N,vTan.xyz));",
"    vec3 B=cross(N,T)*vTan.w;",
"    vec3 n=texture2D(uN,vUv).rgb*2.0-1.0;",
"    N=normalize(T*n.x+B*n.y+N*n.z);",
"  }else if(uMode==1){",
/*   MASSING, not a material. A flat grey box would be indistinguishable from a
     face forged in grey, so an unforged face is drawn as drafting paper: pale,
     matte, with a diagonal rule across it that no generator would ever make. */
"    vec2 q=(vUv-uUv.xy)/uUv.zw;",
"    float s=q.x*24.0+q.y*24.0;",
"    float hatch=step(0.72,fract(s));",
"    base=mix(vec3(0.128,0.140,0.152),vec3(0.168,0.182,0.196),hatch);",
"    rough=0.92;metal=0.0;ao=1.0;",
"  }else{",
/*   the ground. A grid at one metre, and a soft darkening under the footprint
     standing in for the contact shadow this renderer does not cast. */
"    vec2 g=abs(fract(vP.xz)-0.5);",
"    float line=1.0-smoothstep(0.0,0.035,min(g.x,g.y));",
"    float far=clamp(1.0-length(vP.xz)/uFade,0.0,1.0);",
"    base=mix(vec3(0.026,0.028,0.031),vec3(0.086,0.092,0.101),line*far);",
"    vec2 d=abs(vP.xz)-uFoot;",
"    float out2=length(max(d,vec2(0.0)))+min(max(d.x,d.y),0.0);",
"    base*=mix(0.30,1.0,clamp(out2/2.2,0.0,1.0));",
/*   HAZE, so the ground meets the sky instead of stopping at a line. However
     far the plane is taken it has an edge somewhere, and at a camera eight
     metres up that edge sits a degree below the true horizon and reads as a
     seam — which fading it into the sky's own low colour removes rather than
     hides. */
"    base=mix(base,uSkyLo*0.62,smoothstep(0.0,uFade*7.0,length(vP.xz)));",
"    rough=0.96;metal=0.0;ao=1.0;",
"  }",
"  vec3 V=normalize(uEye-vP);",
"  if(!gl_FrontFacing)N=-N;",
"  vec3 L=normalize(uSun);vec3 H=normalize(L+V);",
"  float NoL=max(dot(N,L),0.0),NoV=max(dot(N,V),1e-4);",
"  float NoH=max(dot(N,H),0.0),VoH=max(dot(V,H),0.0);",
"  vec3 F0=mix(vec3(0.04),base,metal);",
"  vec3 F=F0+(1.0-F0)*pow(1.0-VoH,5.0);",
"  float a=rough*rough;",
"  vec3 spec=F*D_GGX(NoH,a)*V_S(NoV,NoL,a);",
"  vec3 diff=(1.0-F)*(1.0-metal)*base/3.14159265;",
"  vec3 col=(diff+spec)*NoL*uSunCol*uGain;",
"  vec3 sky=mix(uSkyLo,uSkyHi,N.y*0.5+0.5);",
"  col+=base*(1.0-metal)*sky*ao*uAmb;",
"  col+=F0*sky*ao*(0.55/(rough+0.55));",
"  col+=emis*1.6;",
"  col*=mix(1.0,1.22,uHover);",
/* THE FRAME AROUND THE FACE THIS STEP IS DRAWING. Drawn in UV space rather
   than screen space so it lies ON the wall and goes round the corner with it,
   which is what tells you the side you are editing is that one and not the
   one behind it. Normalised by the mesh's own UV rectangle, because a roof's
   UVs run to twenty repeats and a frame at v=1 would be a stripe across the
   third course of shingle. */
"  if(uMark>0.5){",
"    vec2 q=(vUv-uUv.xy)/uUv.zw;",
"    vec2 e=min(q,1.0-q);",
"    float b=1.0-smoothstep(0.006,0.013,min(e.x,e.y));",
"    col=mix(col,uAccent,b*0.9);",
"  }",
"  col=col/(col+vec3(1.0));",
"  gl_FragColor=vec4(pow(col,vec3(1.0/2.2)),1.0);",
"}"].join("\n");

/* the sky is a full-screen gradient with a horizon in it, so a building has
   something to be a silhouette against */
const SKY_VS="attribute vec2 p;varying vec2 v;void main(){v=p*0.5+0.5;gl_Position=vec4(p,0.0,1.0);}";
const SKY_FS=[
"precision mediump float;varying vec2 v;uniform vec3 uLo,uHi;uniform float uHz;",
"void main(){",
"  float t=smoothstep(0.0,1.0,clamp((v.y-uHz)/max(0.15,1.0-uHz),0.0,1.0));",
"  vec3 c=mix(uLo,uHi,t);",
/* the glow sits ON the horizon, which moves up the screen as the camera comes
   down — a fixed band reads as a stripe painted across the sky */
"  c+=vec3(0.026,0.023,0.017)*(1.0-smoothstep(0.0,0.22,abs(v.y-uHz)));",
"  gl_FragColor=vec4(c,1.0);",
"}"].join("\n");

/* ============================ state ============================ */

let cv=null,gl=null,ok=false;
let prog=null,U={},A={},sky=null,SU={},skyBuf=null;
let scene=null;                       // {meshes:[…], mats:[…]}  prepared for drawing
let faces={};                         // step id -> {tex:{b,n,o,e}, cutout, ready}
let white=null,flatN=null,black=null;
let markId=null,hoverId=null;
/* A STREET VIEW, not a drone shot. These modes draw elevations — what a
   building looks like from the pavement — and a flat roof sits at the eaves
   with the parapet standing past it, so a steep opening angle looks down into
   the box. Seventeen degrees down is where a photograph of a building is
   taken from. */
let cam={az:-0.62,el:0.17,dist:26,target:[0,3,0],fov:0.72};
let sun={az:1.02,el:0.62};
let bounds={w:10,d:8,h:6};
let onPick=null,onHover=null;
let raf=0;
let accent=[0.902,0.702,0.165];

const SKY_LO=[0.150,0.168,0.196],SKY_HI=[0.360,0.404,0.470];

/* ============================ setup ============================ */

function shader(type,src){
  const s=gl.createShader(type);
  gl.shaderSource(s,src);gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){
    console.warn("ForgeStage: "+gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}
function program(vsrc,fsrc){
  const vs=shader(gl.VERTEX_SHADER,vsrc),fs=shader(gl.FRAGMENT_SHADER,fsrc);
  if(!vs||!fs)return null;
  const p=gl.createProgram();
  gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)){
    console.warn("ForgeStage: "+gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}
function solidTex(r,g,b,a){
  const t=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,t);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,
                new Uint8Array([r,g,b,a]));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  return t;
}

function attach(canvas){
  if(ok&&cv===canvas)return true;
  cv=canvas;
  gl=cv.getContext("webgl",{antialias:true,alpha:false,depth:true})
    ||cv.getContext("experimental-webgl",{antialias:true,alpha:false,depth:true});
  if(!gl)return (ok=false);
  prog=program(VS,FS);
  sky=program(SKY_VS,SKY_FS);
  if(!prog||!sky)return (ok=false);

  for(const k of ["aP","aN","aT","aTan"])A[k]=gl.getAttribLocation(prog,k);
  for(const k of ["uMVP","uB","uN","uO","uE","uSun","uSunCol","uSkyLo","uSkyHi",
                  "uAccent","uEye","uFoot","uUv","uCut","uMark","uHover","uGain","uAmb",
                  "uFade","uMode"])
    U[k]=gl.getUniformLocation(prog,k);
  for(const k of ["uLo","uHi","uHz"])SU[k]=gl.getUniformLocation(sky,k);

  skyBuf=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,skyBuf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);

  white=solidTex(255,255,255,255);
  flatN=solidTex(128,128,255,255);
  black=solidTex(0,0,0,255);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  return (ok=true);
}

/* ============================ preparing a scene ============================
   ForgeModel hands over plain arrays of positions, normals, UVs and indices —
   everything a glTF needs and nothing more. Two things have to be worked out
   here that a glTF does not carry: a tangent frame per vertex, because these
   walls have normal maps on them and a normal map is meaningless without one,
   and a ground plane, because a building floating in a void does not read as
   standing up. */

function tangents(m){
  const n=m.pos.length/3;
  const T=new Float32Array(n*3),B=new Float32Array(n*3),out=new Float32Array(n*4);
  for(let i=0;i<m.idx.length;i+=3){
    const i0=m.idx[i],i1=m.idx[i+1],i2=m.idx[i+2];
    const p0=i0*3,p1=i1*3,p2=i2*3,t0=i0*2,t1=i1*2,t2=i2*2;
    const e1=[m.pos[p1]-m.pos[p0],m.pos[p1+1]-m.pos[p0+1],m.pos[p1+2]-m.pos[p0+2]];
    const e2=[m.pos[p2]-m.pos[p0],m.pos[p2+1]-m.pos[p0+1],m.pos[p2+2]-m.pos[p0+2]];
    /* ForgeModel writes glTF UVs, whose v runs DOWN the image. A normal map's
       green channel points UP it, so the frame is built on s = -v and the
       shader's +y lands where the map means it to. */
    const du1=m.uv[t1]-m.uv[t0],ds1=-(m.uv[t1+1]-m.uv[t0+1]);
    const du2=m.uv[t2]-m.uv[t0],ds2=-(m.uv[t2+1]-m.uv[t0+1]);
    const det=du1*ds2-du2*ds1;
    if(!isFinite(det)||Math.abs(det)<1e-12)continue;
    const r=1/det;
    const tx=(e1[0]*ds2-e2[0]*ds1)*r,ty=(e1[1]*ds2-e2[1]*ds1)*r,tz=(e1[2]*ds2-e2[2]*ds1)*r;
    const bx=(e2[0]*du1-e1[0]*du2)*r,by=(e2[1]*du1-e1[1]*du2)*r,bz=(e2[2]*du1-e1[2]*du2)*r;
    for(const j of [i0,i1,i2]){
      T[j*3]+=tx;T[j*3+1]+=ty;T[j*3+2]+=tz;
      B[j*3]+=bx;B[j*3+1]+=by;B[j*3+2]+=bz;
    }
  }
  for(let j=0;j<n;j++){
    const nx=m.nrm[j*3],ny=m.nrm[j*3+1],nz=m.nrm[j*3+2];
    let tx=T[j*3],ty=T[j*3+1],tz=T[j*3+2];
    /* a degenerate accumulation would put a NaN through the whole vertex, so it
       falls back to any axis not parallel to the normal */
    if(!(Math.hypot(tx,ty,tz)>1e-9)){
      const alt=Math.abs(nx)<0.9?[1,0,0]:[0,1,0];
      const c=cross([nx,ny,nz],alt);
      tx=c[0];ty=c[1];tz=c[2];
    }
    const d=tx*nx+ty*ny+tz*nz;
    tx-=nx*d;ty-=ny*d;tz-=nz*d;
    const l=Math.hypot(tx,ty,tz)||1;
    tx/=l;ty/=l;tz/=l;
    const c=cross([nx,ny,nz],[tx,ty,tz]);
    const w=(c[0]*B[j*3]+c[1]*B[j*3+1]+c[2]*B[j*3+2])<0?-1:1;
    out[j*4]=tx;out[j*4+1]=ty;out[j*4+2]=tz;out[j*4+3]=w;
  }
  return out;
}

function upload(target,arr,ctor){
  const b=gl.createBuffer();
  gl.bindBuffer(target,b);
  gl.bufferData(target,new ctor(arr),gl.STATIC_DRAW);
  return b;
}

function prepMesh(m,mats){
  const mat=mats[m.mat]||{name:"surface"};
  let u0=1e9,v0=1e9,u1=-1e9,v1=-1e9;
  for(let i=0;i<m.uv.length;i+=2){
    if(m.uv[i]<u0)u0=m.uv[i];
    if(m.uv[i]>u1)u1=m.uv[i];
    if(m.uv[i+1]<v0)v0=m.uv[i+1];
    if(m.uv[i+1]>v1)v1=m.uv[i+1];
  }
  return {
    uv0:[u0,v0],uvSpan:[Math.max(1e-6,u1-u0),Math.max(1e-6,v1-v0)],
    name:m.name,
    face:mat.name,                             // the step id: the material IS the face
    pos:m.pos,uv:m.uv,idx:m.idx,               // kept for the hit test
    bP:upload(gl.ARRAY_BUFFER,m.pos,Float32Array),
    bN:upload(gl.ARRAY_BUFFER,m.nrm,Float32Array),
    bT:upload(gl.ARRAY_BUFFER,m.uv,Float32Array),
    bTan:upload(gl.ARRAY_BUFFER,tangents(m),Float32Array),
    bI:upload(gl.ELEMENT_ARRAY_BUFFER,m.idx,Uint16Array),
    count:m.idx.length
  };
}

function groundMesh(){
  const R=4000;
  /* wound anticlockwise seen from ABOVE, which is the only side of a ground
     plane anybody looks at — the other way round and the back-face cull eats
     it and the building floats in the sky */
  const m={name:"ground",mat:-1,
    pos:[-R,0,-R, R,0,-R, R,0,R, -R,0,R],
    nrm:[0,1,0, 0,1,0, 0,1,0, 0,1,0],
    uv:[0,0, 1,0, 1,1, 0,1],
    idx:[0,2,1,0,3,2]};
  const g=prepMesh(m,[]);
  g.ground=true;g.face=null;
  return g;
}

function dropScene(){
  if(!scene)return;
  for(const m of scene.meshes)
    for(const k of ["bP","bN","bT","bTan","bI"])if(m[k])gl.deleteBuffer(m[k]);
  scene=null;
}

/* S is exactly what ForgeModel.buildingScene returned. */
function setScene(S){
  if(!ok||!S)return;
  dropScene();
  const meshes=S.meshes.map(m=>prepMesh(m,S.materials));
  meshes.push(groundMesh());
  scene={meshes:meshes,mats:S.materials};

  /* the camera is aimed at the building, not at the origin: a bungalow and a
     four-storey works want different eye heights and the middle of the box is
     the honest answer for both */
  let lo=[1e9,1e9,1e9],hi=[-1e9,-1e9,-1e9];
  for(const m of S.meshes)
    for(let i=0;i<m.pos.length;i+=3)
      for(let k=0;k<3;k++){
        if(m.pos[i+k]<lo[k])lo[k]=m.pos[i+k];
        if(m.pos[i+k]>hi[k])hi[k]=m.pos[i+k];
      }
  if(lo[0]>hi[0]){lo=[-5,0,-4];hi=[5,6,4];}
  bounds={w:hi[0]-lo[0],d:hi[2]-lo[2],h:hi[1]-lo[1]};
  cam.target=[(lo[0]+hi[0])/2,(lo[1]+hi[1])/2,(lo[2]+hi[2])/2];
  const r=Math.max(1,0.5*Math.hypot(bounds.w,bounds.h,bounds.d));
  /* THE BUILDING KEEPS THE SIZE IT HAD ON SCREEN as its dimensions change. A
     storey added to a house should look like a storey added to a house, not
     like the camera lurching backwards — so the distance follows the radius
     rather than being refitted. */
  if(cam.r&&cam.dist)cam.dist*=r/cam.r;
  else cam.dist=null;                          // never framed: the next draw does it
  cam.r=r;
  cam.near=Math.max(0.05,r*0.01);
  cam.far=r*40+120;
}

/* HOW FAR BACK TO STAND. A bounding sphere is the easy answer and the wrong
   one: a works forty metres deep and twelve high has a sphere half as wide
   again as anything you can see of it from the street, and fitting that sphere
   puts the elevation in the middle of a great deal of sky.

   So this fits the FACE YOU ARE LOOKING AT. The box's extents are resolved
   along the current view — how wide it reads, how tall it reads, and how much
   of it lies between its middle and the camera — and the distance is the one
   that puts the near face at 78% of the frame. Both fields are checked,
   because the bay is a wide letterbox once the panel and the bars have taken
   their cut, and the vertical answer alone runs a long building off the
   sides. */
function fitFor(aspect){
  const ca=Math.abs(Math.cos(cam.az)),sa=Math.abs(Math.sin(cam.az));
  const wide=bounds.w*ca+bounds.d*sa;          // how wide it reads from here
  const deep=bounds.w*sa+bounds.d*ca;          // how much of it is end-on
  const ce=Math.abs(Math.cos(cam.el)),se=Math.abs(Math.sin(cam.el));
  const tall=bounds.h*ce+deep*se;              // a plan view of a shed is deep, not tall
  const th=Math.tan(cam.fov/2);
  const need=Math.max(tall/2/th,wide/2/(th*Math.max(0.2,aspect)))/0.78;
  return Math.max((cam.near||0.1)*4,need+deep/2);
}

function frame(){cam.dist=null;}

/* ============================ face textures ============================
   A face arrives as the canvases the rest of the app already makes — the same
   makeMap() that fills the channel chips. Two things happen to them here.

   THEY ARE FORCED TO A POWER OF TWO. WebGL 1 will not mipmap or repeat a
   texture that is not, and both matter: the roof's UVs run to twenty repeats
   across a plane, and a wall seen from across the street is minified hard
   enough to sparkle without mip levels. The image is stretched to get there
   rather than padded, which costs nothing — UVs run 0..1 over the whole face,
   so the aspect is carried by the quad and not by the pixels. */

const potUp=n=>{let p=1;while(p<n)p*=2;return p;};
function toPOT(canvas,cap){
  const w=Math.min(cap,potUp(canvas.width)),h=Math.min(cap,potUp(canvas.height));
  if(canvas.width===w&&canvas.height===h)return canvas;
  const c=document.createElement("canvas");
  c.width=w;c.height=h;
  const x=c.getContext("2d");
  x.imageSmoothingEnabled=true;
  x.drawImage(canvas,0,0,w,h);
  return c;
}
function texFrom(canvas,cap){
  const src=toPOT(canvas,cap||1024);
  const t=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}
function dropFace(id){
  const f=faces[id];
  if(!f)return;
  for(const k in f.tex)if(f.tex[k])gl.deleteTexture(f.tex[k]);
  delete faces[id];
}

/* maps: {basecolor, normal, orm, emissive?} — canvases, any size. */
function setFace(id,maps,cutout){
  if(!ok||!id||!maps||!maps.basecolor)return;
  dropFace(id);
  faces[id]={
    cutout:!!cutout,
    tex:{
      b:texFrom(maps.basecolor),
      n:maps.normal?texFrom(maps.normal):null,
      o:maps.orm?texFrom(maps.orm):null,
      e:maps.emissive?texFrom(maps.emissive):null
    }
  };
}
function clearFaces(){for(const id in faces)dropFace(id);}
const hasFace=id=>!!faces[id];

/* ============================ drawing ============================ */

function eye(){
  const ce=Math.cos(cam.el),d=cam.dist;
  return [cam.target[0]+d*ce*Math.sin(cam.az),
          cam.target[1]+d*Math.sin(cam.el),
          cam.target[2]+d*ce*Math.cos(cam.az)];
}

function fit(){
  const host=cv.parentNode;
  const aw=Math.max(80,host.clientWidth-32),ah=Math.max(80,host.clientHeight-32);
  cv.style.width=aw+"px";cv.style.height=ah+"px";
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const pw=Math.max(1,Math.round(aw*dpr)),ph=Math.max(1,Math.round(ah*dpr));
  if(cv.width!==pw||cv.height!==ph){cv.width=pw;cv.height=ph;}
}

function draw(){
  if(!ok||!scene)return;
  fit();
  gl.viewport(0,0,cv.width,cv.height);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(sky);
  gl.bindBuffer(gl.ARRAY_BUFFER,skyBuf);
  const sp=gl.getAttribLocation(sky,"p");
  gl.enableVertexAttribArray(sp);
  gl.vertexAttribPointer(sp,2,gl.FLOAT,false,0,0);
  gl.uniform3f(SU.uLo,SKY_LO[0],SKY_LO[1],SKY_LO[2]);
  gl.uniform3f(SU.uHi,SKY_HI[0],SKY_HI[1],SKY_HI[2]);
  /* where a horizontal ray lands on this frame, in 0..1 up the canvas */
  gl.uniform1f(SU.uHz,Math.max(-0.2,Math.min(1.2,
    0.5+Math.tan(cam.el)/(2*Math.tan(cam.fov/2)))));
  gl.drawArrays(gl.TRIANGLES,0,3);
  gl.disableVertexAttribArray(sp);
  gl.enable(gl.DEPTH_TEST);
  gl.clear(gl.DEPTH_BUFFER_BIT);

  const aspect=cv.width/cv.height;
  cam.fit=fitFor(aspect);
  if(!(cam.dist>0))cam.dist=cam.fit;
  /* clamped against the BUILDING, not against the framing: the framing moves
     as you orbit and a clamp that moved with it would shove the camera about */
  const rr=cam.r||5;
  cam.dist=Math.max(rr*0.35,Math.min(rr*14,cam.dist));
  const E=eye();
  const P=perspective(cam.fov,aspect,cam.near||0.1,cam.far||500);
  const V=lookAt(E,cam.target,[0,1,0]);
  const MVP=mul(P,V);

  const ce=Math.cos(sun.el);
  const L=[ce*Math.sin(sun.az),Math.sin(sun.el),ce*Math.cos(sun.az)];

  gl.useProgram(prog);
  gl.uniformMatrix4fv(U.uMVP,false,MVP);
  gl.uniform3f(U.uEye,E[0],E[1],E[2]);
  gl.uniform3f(U.uSun,L[0],L[1],L[2]);
  gl.uniform3f(U.uSunCol,1.0,0.955,0.885);
  gl.uniform3f(U.uSkyLo,0.150,0.170,0.205);
  gl.uniform3f(U.uSkyHi,0.400,0.450,0.520);
  gl.uniform3f(U.uAccent,accent[0],accent[1],accent[2]);
  gl.uniform2f(U.uFoot,bounds.w/2,bounds.d/2);
  gl.uniform1f(U.uFade,Math.max(24,(cam.r||8)*7));
  gl.uniform1f(U.uGain,2.55);
  gl.uniform1f(U.uAmb,1.05);
  gl.uniform1i(U.uB,0);gl.uniform1i(U.uN,1);gl.uniform1i(U.uO,2);gl.uniform1i(U.uE,3);

  for(const m of scene.meshes){
    const f=m.ground?null:faces[m.face];
    gl.uniform1i(U.uMode,m.ground?2:(f?0:1));
    gl.uniform1f(U.uCut,(f&&f.cutout)?1:0);
    gl.uniform1f(U.uMark,(!m.ground&&markId&&m.face===markId)?1:0);
    gl.uniform1f(U.uHover,(!m.ground&&hoverId&&m.face===hoverId)?1:0);
    gl.uniform4f(U.uUv,m.uv0?m.uv0[0]:0,m.uv0?m.uv0[1]:0,
                       m.uvSpan?m.uvSpan[0]:1,m.uvSpan?m.uvSpan[1]:1);
    const bind=(unit,t,fallback)=>{
      gl.activeTexture(gl.TEXTURE0+unit);
      gl.bindTexture(gl.TEXTURE_2D,t||fallback);
    };
    bind(0,f&&f.tex.b,white);
    bind(1,f&&f.tex.n,flatN);
    bind(2,f&&f.tex.o,white);
    bind(3,f&&f.tex.e,black);

    const at=(loc,buf,n)=>{
      if(loc<0)return;
      gl.bindBuffer(gl.ARRAY_BUFFER,buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc,n,gl.FLOAT,false,0,0);
    };
    at(A.aP,m.bP,3);at(A.aN,m.bN,3);at(A.aT,m.bT,2);at(A.aTan,m.bTan,4);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,m.bI);
    /* a cut-out wall is a plane with a hole in it — cull it and the inside of
       the far wall vanishes through the hole */
    if(f&&f.cutout)gl.disable(gl.CULL_FACE);else gl.enable(gl.CULL_FACE);
    gl.drawElements(gl.TRIANGLES,m.count,gl.UNSIGNED_SHORT,0);
  }
  gl.enable(gl.CULL_FACE);
}
function invalidate(){
  if(raf)return;
  raf=requestAnimationFrame(()=>{raf=0;draw();});
}

/* ============================ the hit test ============================
   A ray against a dozen triangles in JavaScript, rather than an id pass into a
   framebuffer. It is exact, it costs nothing at this scale, and it works on
   hover as cheaply as on click — which is what lets a wall light up under the
   cursor before you commit to clicking it. */

function rayAt(px,py){
  const r=cv.getBoundingClientRect();
  const x=((px-r.left)/r.width)*2-1;
  const y=1-((py-r.top)/r.height)*2;
  const E=eye();
  const fwd=norm(sub(cam.target,E));
  const right=norm(cross(fwd,[0,1,0]));
  const up=cross(right,fwd);
  const th=Math.tan(cam.fov/2),aspect=cv.width/cv.height;
  const d=norm([fwd[0]+right[0]*x*th*aspect+up[0]*y*th,
                fwd[1]+right[1]*x*th*aspect+up[1]*y*th,
                fwd[2]+right[2]*x*th*aspect+up[2]*y*th]);
  return {o:E,d:d};
}
function triHit(R,a,b,c){
  const e1=sub(b,a),e2=sub(c,a);
  const h=cross(R.d,e2),det=dot(e1,h);
  if(Math.abs(det)<1e-9)return -1;             // parallel; a hit here is not a click
  const inv=1/det,s=sub(R.o,a);
  const u=dot(s,h)*inv;
  if(u<0||u>1)return -1;
  const q=cross(s,e1);
  const v=dot(R.d,q)*inv;
  if(v<0||u+v>1)return -1;
  const t=dot(e2,q)*inv;
  return t>1e-4?t:-1;
}
function pick(px,py){
  if(!ok||!scene)return null;
  const R=rayAt(px,py);
  let best=Infinity,hit=null;
  for(const m of scene.meshes){
    if(m.ground||!m.face)continue;
    const p=m.pos;
    for(let i=0;i<m.idx.length;i+=3){
      const a=m.idx[i]*3,b=m.idx[i+1]*3,c=m.idx[i+2]*3;
      const t=triHit(R,[p[a],p[a+1],p[a+2]],[p[b],p[b+1],p[b+2]],[p[c],p[c+1],p[c+2]]);
      if(t>0&&t<best){best=t;hit=m.face;}
    }
  }
  return hit;
}

/* ============================ pointer handling ============================
   Drag orbits, wheel dollies, shift-drag (or a second finger's worth of
   travel with the modifier held) walks the sun round. A press that never
   really moved is a click, and a click on a wall is a request to go and work
   on that wall — which is the whole reason the faces are pickable. */

function wire(){
  let down=false,lx=0,ly=0,moved=0,sunDrag=false,id=0;
  cv.addEventListener("pointerdown",e=>{
    down=true;moved=0;lx=e.clientX;ly=e.clientY;id=e.pointerId;
    sunDrag=e.shiftKey||e.button===2;
    cv.setPointerCapture(id);
    e.preventDefault();
  });
  cv.addEventListener("pointermove",e=>{
    if(!down){
      const h=pick(e.clientX,e.clientY);
      if(h!==hoverId){
        hoverId=h;
        cv.style.cursor=h?"pointer":"grab";
        if(onHover)onHover(h);
        invalidate();
      }
      return;
    }
    const dx=e.clientX-lx,dy=e.clientY-ly;
    lx=e.clientX;ly=e.clientY;
    moved+=Math.abs(dx)+Math.abs(dy);
    if(sunDrag){
      sun.az-=dx*0.008;
      sun.el=Math.max(0.10,Math.min(1.45,sun.el+dy*0.006));
    }else{
      cam.az-=dx*0.008;
      /* not past the zenith and not below the ground: from underneath, a
         building is a set of backfaces and a grid, and nobody meant to go there */
      cam.el=Math.max(-0.05,Math.min(1.40,cam.el+dy*0.006));
    }
    invalidate();
  });
  const up=e=>{
    if(!down)return;
    down=false;
    try{cv.releasePointerCapture(id);}catch(err){}
    if(moved<5&&!sunDrag){
      const h=pick(e.clientX,e.clientY);
      if(h&&onPick)onPick(h);
    }
  };
  cv.addEventListener("pointerup",up);
  cv.addEventListener("pointerleave",()=>{
    if(hoverId!==null){hoverId=null;if(onHover)onHover(null);invalidate();}
  });
  cv.addEventListener("pointercancel",()=>{down=false;});
  cv.addEventListener("contextmenu",e=>e.preventDefault());
  cv.addEventListener("wheel",e=>{
    e.preventDefault();
    const k=Math.exp(e.deltaY*0.0012);
    const r=cam.r||5;
    cam.dist=Math.max(r*0.35,Math.min(r*14,(cam.dist||cam.fit||20)*k));
    invalidate();
  },{passive:false});
  cv.style.cursor="grab";
}

/* ============================ what the app calls ============================ */

window.ForgeStage={
  attach:function(canvas){
    const was=ok;
    const good=attach(canvas);
    if(good&&!was)wire();
    return good;
  },
  available:()=>ok,
  setScene:setScene,
  setFace:setFace,
  hasFace:hasFace,
  clearFaces:clearFaces,
  dropFace:dropFace,
  mark:function(id){if(markId!==id){markId=id;invalidate();}},
  /* "#e6b32a" or "rgb(...)" — whatever the chrome is wearing for this mode */
  accent:function(css){
    const m=String(css||"").trim();
    let c=null;
    if(/^#[0-9a-f]{6}$/i.test(m))
      c=[parseInt(m.substr(1,2),16),parseInt(m.substr(3,2),16),parseInt(m.substr(5,2),16)];
    else{
      const n=m.match(/[\d.]+/g);
      if(n&&n.length>=3)c=[+n[0],+n[1],+n[2]];
    }
    if(!c)return;
    /* the shader works in linear light and tone-maps on the way out, so the
       swatch has to be linearised or the frame comes out washed */
    accent=c.map(v=>Math.pow(Math.max(0,Math.min(1,v/255)),2.2));
    invalidate();
  },
  frame:function(){frame();invalidate();},
  draw:draw,
  invalidate:invalidate,
  pick:pick,
  bounds:()=>({w:bounds.w,d:bounds.d,h:bounds.h}),
  camera:()=>({az:cam.az,el:cam.el,dist:cam.dist}),
  hovered:()=>hoverId,
  /* what the stage is actually holding — for the feature test, which has to be
     able to ask rather than infer it from pixels */
  debug:()=>({
    scene:!!scene,
    faces:Object.keys(faces).sort(),
    meshes:scene?scene.meshes.map(m=>({name:m.name,face:m.face,tris:m.count/3})):[],
    mark:markId,bounds:{w:bounds.w,d:bounds.d,h:bounds.h}
  }),
  onPick:function(fn){onPick=fn;},
  onHover:function(fn){onHover=fn;},
  reset:function(){
    clearFaces();dropScene();
    markId=hoverId=null;
    cam.az=-0.62;cam.el=0.17;cam.dist=null;cam.r=0;
  }
};

})();
