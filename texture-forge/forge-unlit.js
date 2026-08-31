/* =====================================================================
   TEXTURE FORGE — the unlit bake
   =====================================================================

   WHAT THIS IS FOR. A PBR set is a description of a material: it says
   how the surface answers light, and it needs a renderer holding a
   light to mean anything. A lot of work does not have one. A retro or
   stylised renderer, a sprite sheet, a low-end target, an engine set to
   unlit/emissive, a texture that has to look right in a viewport with
   no lighting rig at all — all of them want the answer already worked
   out and painted into the colour.

   So this takes the maps every mode already produces and freezes one
   lighting solution into a single RGB image: base colour, normal,
   roughness, metallic, AO and emissive in, one picture out.

   IT IS THE SAME SHADING MODEL AS THE LIT PREVIEW — GGX specular,
   Smith visibility, Schlick Fresnel, a hemisphere ambient, Reinhard and
   gamma — because a bake that did not match the preview would be a
   second opinion rather than a render, and you would have no way to
   judge it before exporting.

   WHAT IT DOES NOT SHARE is the preview's light. The preview light is a
   thing you drag to inspect a surface; it moves constantly and it has
   no numbers on it. A bake is an artefact you ship, so it gets its own
   direction in degrees, its own exposure, its own sky, and its own
   palette — set once, written down in the readme, and identical the
   next time you open the app.

   ONE LIGHT, NOT A RIG. There is a key, a two-colour hemisphere for
   sky and ground bounce, AO and emissive. There is no shadow pass and
   there cannot be: shadows need geometry, and a texture does not know
   what it is going to be wrapped around. The height field's own
   occlusion is already in the AO map, which is why AO gets its own
   amount here — on an unlit target it is doing the work that ambient
   occlusion, contact shadow and every other cheap darkening trick would
   otherwise be doing at runtime, and it usually wants pushing.

   THE FLOOR ON AMBIENT. It is tempting to bake with a strong key and
   little ambient, because it looks punchy on screen. Don't: every texel
   facing away from the key goes to near black and STAYS there, and on
   an unlit target there is no fill light coming later to open it up.
   The defaults deliberately carry more ambient than the preview does.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,hex2rgb=Forge.hex2rgb;

const KEY="texture-forge-bake";

/* Defaults are a three-quarter key from the upper left — the direction almost
   every hand-painted texture in the world is lit from, and the one a viewer
   reads as "lit" rather than as "something is wrong with this". */
const DEFAULTS={
  az:315,          // degrees, 0 = +X (right), rising anticlockwise
  el:42,           // degrees above the surface
  gain:2.7,        // key exposure
  amb:1.30,        // hemisphere amount — see THE FLOOR ON AMBIENT above
  cSky:"#7d93b0",  // what the surface sees looking up
  cGnd:"#3d372f",  // and looking down: warm bounce off whatever it stands on
  ao:1.00,         // how hard the AO map bakes in
  spec:1.00,       // specular amount; 0 gives a matte, poster-like bake
  emi:1.60,        // emissive gain
  contrast:1.00,
  sat:1.00,
  palId:"none",    // the bake's OWN palette, independent of the palette bar
  palDither:"bayer4",
  palStrength:1
};

const state={};
for(const k in DEFAULTS)state[k]=DEFAULTS[k];

const listeners=[];
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}}
function restore(){
  let raw=null;
  try{raw=localStorage.getItem(KEY);}catch(e){return;}
  if(!raw)return;
  try{
    const o=JSON.parse(raw);
    if(o)for(const k in DEFAULTS)if(o[k]!==undefined)state[k]=o[k];
  }catch(e){}
}
function on(fn){listeners.push(fn);}
function set(k,v){
  if(state[k]===v)return false;
  state[k]=v;save();
  for(const fn of listeners)fn(k,v);
  return true;
}
function reset(){
  for(const k in DEFAULTS)state[k]=DEFAULTS[k];
  save();
  for(const fn of listeners)fn(null,null);
}

/* The palette profile, in the shape Palette.quantise wants. */
function profile(){
  return {id:state.palId,dither:state.palDither,strength:+state.palStrength};
}
function palettised(){
  return !!(window.Palette&&Palette.profileActive(profile()));
}

/* Anything that changes a baked pixel, as one string. The runtime hangs its
   cached bake off this, so dragging a bake slider re-derives without going
   anywhere near the generator that produced the buffers. */
function signature(){
  let s="";
  for(const k in DEFAULTS)s+=k+":"+state[k]+";";
  return s;
}

/* ============================ the transfer curves ============================
   Both directions are tabulated, because the per-texel path runs Math.pow six
   times otherwise and a 4096-square map is sixteen million texels.

   The decode is a plain 256-entry table — the input is a byte, so the table is
   exact rather than approximate.

   The encode cannot be, because its input is a float. Indexing it by v would
   put the whole of the shadow region in the first bucket or two, where the
   sRGB curve is at its steepest and a linear interpolation across a bucket is
   worth more than a code value. So the table is indexed by sqrt(v): near black
   the buckets are (1/4095)² wide, and near white — where the curve is nearly
   straight — they are widest. The interpolation error is under a tenth of a
   code value across the whole range. */
const DEC=new Float32Array(256);
for(let i=0;i<256;i++)DEC[i]=Math.pow(i/255,2.2);

const ENCN=4096;
const ENC=new Float32Array(ENCN+1);
for(let i=0;i<=ENCN;i++){
  const t=i/ENCN;
  ENC[i]=Math.pow(t*t,1/2.2)*255;
}
function enc(v){
  if(v<=0)return 0;
  if(v>=1)return 255;
  const t=Math.sqrt(v)*ENCN;
  const i=t|0;
  const f=t-i;
  return ENC[i]+(ENC[i+1]-ENC[i])*f;
}

/* ============================ the shading ============================ */

/* Everything that is constant across a build, worked out once. */
function params(){
  const az=state.az*Math.PI/180,el=state.el*Math.PI/180;
  const ce=Math.cos(el);
  const L=[ce*Math.cos(az),ce*Math.sin(az),Math.sin(el)];
  const sky=hex2rgb(state.cSky),gnd=hex2rgb(state.cGnd);
  return {
    Lx:L[0],Ly:L[1],Lz:L[2],
    gain:+state.gain,amb:+state.amb,aoK:clamp(+state.ao,0,2),
    specK:clamp(+state.spec,0,2),emiK:+state.emi,
    contrast:+state.contrast,sat:+state.sat,
    skyR:DEC[sky[0]],skyG:DEC[sky[1]],skyB:DEC[sky[2]],
    gndR:DEC[gnd[0]],gndG:DEC[gnd[1]],gndB:DEC[gnd[2]]
  };
}

/* A writer in the shape makeWriters wants: (i,out,k) -> alpha.

   `emiRGB` is how the MODE draws its emissive, not how this file assumes one
   looks. A heatsink glowing orange and a sign glowing green are the same byte
   in EMI and different pixels on screen, and the bake would be lying about
   both if it picked its own colour. Where a mode has no emissive at all it is
   null and the term drops out. */
function writer(B,emiRGB){
  const A=B.A,NRM=B.NRM,RGH=B.RGH,MET=B.MET,AO=B.AO,ALP=B.ALP;
  const p=params();
  const Lx=p.Lx,Ly=p.Ly,Lz=p.Lz;
  /* the half vector is constant too: V is straight out of the surface for
     every texel of a flat map, so H depends only on the light */
  let Hx=Lx,Hy=Ly,Hz=Lz+1;
  const hl=1/Math.sqrt(Hx*Hx+Hy*Hy+Hz*Hz);
  Hx*=hl;Hy*=hl;Hz*=hl;
  const VoH=clamp(Hz,0,1);
  const fres=Math.pow(1-VoH,5);
  const gain=p.gain,amb=p.amb,aoK=p.aoK,specK=p.specK,emiK=p.emiK;
  const skyR=p.skyR,skyG=p.skyG,skyB=p.skyB,gndR=p.gndR,gndG=p.gndG,gndB=p.gndB;
  const con=p.contrast,sat=p.sat;
  const e3=[0,0,0];

  return function(i,out,k){
    const j=i*3;
    const br=DEC[A[j]],bg=DEC[A[j+1]],bb=DEC[A[j+2]];
    let nx=NRM[j]/127.5-1,ny=NRM[j+1]/127.5-1,nz=NRM[j+2]/127.5-1;
    const nl=1/Math.sqrt(nx*nx+ny*ny+nz*nz||1);
    nx*=nl;ny*=nl;nz*=nl;

    const rough=clamp(RGH[i]/255,0.05,1);
    const metal=MET[i]/255;
    /* aoK past 1 deepens the occlusion rather than darkening flat ground:
       it scales how far AO falls from white, so an unoccluded texel is
       untouched at any amount */
    const ao=clamp(1-(1-AO[i]/255)*aoK,0,1);

    const NoL=nx*Lx+ny*Ly+nz*Lz;
    const NoH=nx*Hx+ny*Hy+nz*Hz;
    const NoV=nz>1e-4?nz:1e-4;

    const f0r=0.04+(br-0.04)*metal,f0g=0.04+(bg-0.04)*metal,f0b=0.04+(bb-0.04)*metal;
    const Fr=f0r+(1-f0r)*fres,Fg=f0g+(1-f0g)*fres,Fb=f0b+(1-f0b)*fres;

    let r=0,g=0,b=0;
    if(NoL>0){
      const a=rough*rough,a2=a*a;
      const nh=NoH>0?NoH:0;
      const d=nh*nh*(a2-1)+1;
      const D=a2/(Math.PI*d*d);
      const gv=NoL*Math.sqrt(NoV*NoV*(1-a2)+a2);
      const gl=NoV*Math.sqrt(NoL*NoL*(1-a2)+a2);
      const V=0.5/Math.max(gv+gl,1e-4);
      const sp=D*V*specK;
      const kd=(1-metal)/Math.PI;
      r=((1-Fr)*kd*br+Fr*sp)*NoL*gain;
      g=((1-Fg)*kd*bg+Fg*sp)*NoL*gain;
      b=((1-Fb)*kd*bb+Fb*sp)*NoL*gain;
    }

    /* hemisphere: what the texel sees is a blend of sky and ground bounce
       chosen by how far it is tipped, which is the cheapest ambient that
       still tells a face pointing up from a face pointing down */
    const t=nz*0.5+0.5;
    const shR=(gndR+(skyR-gndR)*t)*ao,
          shG=(gndG+(skyG-gndG)*t)*ao,
          shB=(gndB+(skyB-gndB)*t)*ao;
    const dm=(1-metal)*amb;
    r+=br*shR*dm;g+=bg*shG*dm;b+=bb*shB*dm;
    const sk=specK*0.55/(rough+0.55);
    r+=f0r*shR*sk;g+=f0g*shG*sk;b+=f0b*shB*sk;

    if(emiRGB){
      emiRGB(i,e3,0);
      r+=DEC[e3[0]]*emiK;g+=DEC[e3[1]]*emiK;b+=DEC[e3[2]]*emiK;
    }

    /* Reinhard, then out to display space, then the grade — saturation and
       contrast are judged by eye on the picture, so they belong after the
       curve and not before it */
    r=enc(r/(r+1));g=enc(g/(g+1));b=enc(b/(b+1));
    if(sat!==1){
      const y=0.2126*r+0.7152*g+0.0722*b;
      r=y+(r-y)*sat;g=y+(g-y)*sat;b=y+(b-y)*sat;
    }
    if(con!==1){
      r=128+(r-128)*con;g=128+(g-128)*con;b=128+(b-128)*con;
    }
    out[k]=r<0?0:r>255?255:r;
    out[k+1]=g<0?0:g>255?255:g;
    out[k+2]=b<0?0:b>255?255:b;
    return ALP?ALP[i]:255;
  };
}

/* the line the readme carries, so a bake can be reproduced from the file */
function describe(){
  const p=window.Palette&&Palette.describeProfile(profile());
  return "key "+Math.round(state.az)+"° az / "+Math.round(state.el)+"° el, "+
    "exposure "+(+state.gain).toFixed(2)+", ambient "+(+state.amb).toFixed(2)+
    " (sky "+state.cSky+" over "+state.cGnd+"), AO ×"+(+state.ao).toFixed(2)+
    ", specular ×"+(+state.spec).toFixed(2)+
    ", contrast "+(+state.contrast).toFixed(2)+", saturation "+(+state.sat).toFixed(2)+
    (p?" · palette: "+p:" · full colour");
}

restore();

window.ForgeUnlit={
  DEFAULTS:DEFAULTS,
  state:state,
  set:set,on:on,reset:reset,
  params:params,writer:writer,
  profile:profile,palettised:palettised,
  signature:signature,describe:describe
};

})();
