/* =====================================================================
   TEXTURE FORGE — geometry out
   =====================================================================

   Every mode in this app already knows how big the thing it drew really
   is: the house is dimensioned in feet, the factory in metres, the vent
   in millimetres, and each of them prints that in its readout. This file
   is what turns that number into geometry, so a texture set leaves as
   something you can drop into Blender at true scale rather than as nine
   PNGs and a paragraph telling you what to scale a plane to.

   TWO FORMATS, and they are not redundant:

     .gltf   glTF 2.0, and the format this app is a natural fit for.
             glTF's metallic-roughness texture is packed G = roughness,
             B = metallic, and its occlusion texture reads R — which is
             EXACTLY what orm.png already is. One image, three channels,
             wired straight in with no shader graph surgery. Cut-out
             faces come through as alphaMode MASK off the base colour's
             own alpha. Blender imports it with the whole material live.

     .obj    the universal fallback, with a .mtl beside it. OBJ cannot
             address a channel of an image, so the .mtl points at the
             SEPARATE roughness.png and metallic.png instead of the
             packed one. Same maps, addressed the only way OBJ can.

   AXES. Both files are written Y-up, which is glTF's own convention and
   the default Blender's OBJ importer expects ("Y up, -Z forward"), so
   the two land in the same orientation and a wall arrives standing up.
   Blender converts to its Z-up world on import; nothing here has to
   know about that.

   UNITS ARE METRES, always, whatever the mode works in. A mode that
   thinks in feet or inches converts in its own plan().

   THE PLAN CONTRACT. A mode may declare plan(P) returning:

     w, h      the real size of the face or tile, in metres
     cutout    true if the base colour's alpha is a silhouette
     eaves     where the walls stop and the roof starts (defaults to h)
     tile      for a tiling material, the repeat size in metres, so a
               roof plane can be given UVs that repeat at true size
     roof      only the FIRST face of a structure needs this:
               {kind:"flat"|"gable", pitch: rise per 12, ridge:"x"|"z"}

   A mode with no plan() still exports — it gets a one-metre square and
   the readme says so, rather than the geometry quietly lying about the
   scale.
   ===================================================================== */
"use strict";

(function(){

const FT=0.3048;                                   // for the modes that think in feet
const DEFAULT_PLAN={w:1,h:1,cutout:false,guessed:true};

function planOf(mode,P){
  let p=null;
  try{p=mode.plan?mode.plan(P):null;}catch(e){p=null;}
  if(!p||!(p.w>0)||!(p.h>0))return Object.assign({},DEFAULT_PLAN);
  return {
    w:p.w,h:p.h,
    cutout:!!p.cutout,
    eaves:(p.eaves>0?p.eaves:p.h),
    tile:(p.tile>0?p.tile:0),
    roof:p.roof||null,
    guessed:false
  };
}

/* ============================ scene assembly ============================
   A scene is a plain object: a list of materials, each naming the files it
   wants, and a list of meshes, each a soup of triangles pointing at one of
   them. Both writers below consume exactly this and nothing else. */

function scene(name){
  return {name:name,materials:[],meshes:[],notes:[]};
}

/* One quad. Positions are in metres; UVs are in glTF's convention, where v
   runs DOWN — so the top of a wall is v=0, which is the top row of the image.
   The OBJ writer flips them back, because OBJ's v runs up. */
function quad(mesh,a,b,c,d,n,uv){
  const base=mesh.pos.length/3;
  const push=(p,t)=>{
    mesh.pos.push(p[0],p[1],p[2]);
    mesh.nrm.push(n[0],n[1],n[2]);
    mesh.uv.push(t[0],t[1]);
  };
  push(a,uv[0]);push(b,uv[1]);push(c,uv[2]);push(d,uv[3]);
  mesh.idx.push(base,base+1,base+2,base,base+2,base+3);
}
function mesh(name,mat){return {name:name,mat:mat,pos:[],nrm:[],uv:[],idx:[]};}

/* ---------------------------------------------------------------------------
   ONE FACE, ONE PLANE

   The plane stands up, facing the camera, with its foot on the ground plane
   and centred left to right — which is where you want a wall, and near enough
   where you want anything else. A tiling material gets UVs that repeat at its
   own real size, so scaling the plane up in Blender adds tiles rather than
   stretching them.
   --------------------------------------------------------------------------- */
function quadScene(name,plan,material,repeat){
  const S=scene(name);
  S.materials.push(material);
  const m=mesh(material.name||"surface",0);
  const w=plan.w,h=plan.h;
  const ru=(repeat&&repeat[0])||1,rv=(repeat&&repeat[1])||1;
  quad(m,[-w/2,0,0],[w/2,0,0],[w/2,h,0],[-w/2,h,0],[0,0,1],
       [[0,rv],[ru,rv],[ru,0],[0,0]]);
  S.meshes.push(m);
  return S;
}

/* ---------------------------------------------------------------------------
   A WHOLE BUILDING

   Four walls off three textures — the two sides are the same elevation seen
   from opposite ends, which is what the wizard's side face IS — plus a roof.

   Each wall is the full height of its own silhouette rather than the height
   of the building, because a gable or a parapet is part of the texture and
   the alpha is what cuts the sky away. The ROOF, though, sits at the eaves,
   which is why plan() reports that separately: put a roof plane at the top of
   a parapet and it floats above the building it belongs to.
   --------------------------------------------------------------------------- */
function buildingScene(name,faces){
  const S=scene(name);
  const front=faces.front,side=faces.side,back=faces.back||faces.front,roof=faces.roof;
  const W=front.plan.w;
  const D=(side&&side.plan.w)||W*0.6;
  const eaves=front.plan.eaves;

  const matIdx={};
  const addMat=f=>{
    if(!f)return -1;
    if(matIdx[f.material.name]!==undefined)return matIdx[f.material.name];
    S.materials.push(f.material);
    return (matIdx[f.material.name]=S.materials.length-1);
  };
  const mFront=addMat(front),mSide=addMat(side),mBack=addMat(back),mRoof=addMat(roof);

  /* the walls. u runs left-to-right as somebody standing outside that face
     sees it, which is not the same direction in world space for all four */
  const fh=front.plan.h,bh=back.plan.h,sh=(side&&side.plan.h)||fh;
  const mf=mesh("front",mFront);
  quad(mf,[-W/2,0,D/2],[W/2,0,D/2],[W/2,fh,D/2],[-W/2,fh,D/2],[0,0,1],
       [[0,1],[1,1],[1,0],[0,0]]);
  S.meshes.push(mf);

  const mb=mesh("back",mBack);
  quad(mb,[W/2,0,-D/2],[-W/2,0,-D/2],[-W/2,bh,-D/2],[W/2,bh,-D/2],[0,0,-1],
       [[0,1],[1,1],[1,0],[0,0]]);
  S.meshes.push(mb);

  if(side){
    const mr=mesh("side_right",mSide);
    quad(mr,[W/2,0,D/2],[W/2,0,-D/2],[W/2,sh,-D/2],[W/2,sh,D/2],[1,0,0],
         [[0,1],[1,1],[1,0],[0,0]]);
    S.meshes.push(mr);
    const ml=mesh("side_left",mSide);
    quad(ml,[-W/2,0,-D/2],[-W/2,0,D/2],[-W/2,sh,D/2],[-W/2,sh,-D/2],[-1,0,0],
         [[0,1],[1,1],[1,0],[0,0]]);
    S.meshes.push(ml);
  }

  if(roof){
    const tile=roof.plan.tile||roof.plan.w||2;
    const kind=(front.plan.roof&&front.plan.roof.kind)||"flat";
    const mr=mesh("roof",mRoof);
    if(kind==="gable"){
      const pitch=Math.max(0.5,(front.plan.roof.pitch||6))/12;
      const ridgeX=(front.plan.roof.ridge||"x")==="x";
      const span=(ridgeX?D:W)/2;
      /* WHERE THE RIDGE IS. Computing it from the pitch gets within a few
         centimetres, but the face that shows the gable already draws its own
         ridge in its silhouette — and a roof plane that lands a few
         centimetres off the top of the triangle it is supposed to close leaves
         a slot of daylight. So the ridge is taken from that face's own height,
         and the pitch is only the fallback for when the face is missing. */
      const gableFace=ridgeX?side:front;
      const top=Math.max(eaves+0.01,
                         (gableFace&&gableFace.plan.h>eaves)?gableFace.plan.h:eaves+span*pitch);
      const rise=top-eaves;
      const slope=Math.sqrt(span*span+rise*rise);
      const nz=span/slope,ny=rise/slope;           // the slope's own normal
      if(ridgeX){
        /* the ridge runs across the front, so the two planes fall toward
           front and back */
        quad(mr,[-W/2,eaves,D/2],[W/2,eaves,D/2],[W/2,top,0],[-W/2,top,0],
             [0,nz,ny],[[0,slope/tile],[W/tile,slope/tile],[W/tile,0],[0,0]]);
        quad(mr,[W/2,eaves,-D/2],[-W/2,eaves,-D/2],[-W/2,top,0],[W/2,top,0],
             [0,nz,-ny],[[0,slope/tile],[W/tile,slope/tile],[W/tile,0],[0,0]]);
      }else{
        quad(mr,[W/2,eaves,D/2],[W/2,eaves,-D/2],[0,top,-D/2],[0,top,D/2],
             [ny,nz,0],[[0,slope/tile],[D/tile,slope/tile],[D/tile,0],[0,0]]);
        quad(mr,[-W/2,eaves,-D/2],[-W/2,eaves,D/2],[0,top,D/2],[0,top,-D/2],
             [-ny,nz,0],[[0,slope/tile],[D/tile,slope/tile],[D/tile,0],[0,0]]);
      }
      S.notes.push("Roof: a gable, ridge running "+
                   (ridgeX?"across the front":"front to back")+", eaves at "+eaves.toFixed(2)+
                   " m and ridge at "+top.toFixed(2)+" m — taken from the gable face's own "+
                   "silhouette so the plane closes the triangle exactly.");
    }else{
      /* wound anticlockwise seen from ABOVE. It was the other way round, which
         no renderer that shades off the vertex normal complains about and every
         renderer that culls back faces makes a hole out of — the 3D stage,
         which draws this very scene, is where that showed up. */
      quad(mr,[-W/2,eaves,D/2],[W/2,eaves,D/2],[W/2,eaves,-D/2],[-W/2,eaves,-D/2],[0,1,0],
           [[0,D/tile],[W/tile,D/tile],[W/tile,0],[0,0]]);
      S.notes.push("Roof: one flat plane at the eaves, "+eaves.toFixed(2)+" m. It sits BELOW "+
                   "the top of a parapet on purpose — the parapet is part of the wall texture.");
    }
    S.meshes.push(mr);
  }
  S.notes.push("Building: "+W.toFixed(2)+" m wide x "+D.toFixed(2)+" m deep, walls to "+
               eaves.toFixed(2)+" m.");
  return S;
}

/* ============================ glTF 2.0 ============================ */

function b64(bytes){
  let s="";
  const CH=0x8000;                                 // apply() has an argument-count ceiling
  for(let i=0;i<bytes.length;i+=CH)
    s+=String.fromCharCode.apply(null,bytes.subarray(i,Math.min(i+CH,bytes.length)));
  return btoa(s);
}

function gltf(S){
  const bin=[];let off=0;
  const views=[],accessors=[];
  const push=(arr,ctor,target)=>{
    const data=new ctor(arr);
    const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    /* every bufferView has to start on a four-byte boundary, and uint16
       indices are the reason that is not automatic */
    while(off%4)  {bin.push(new Uint8Array([0]));off++;}
    bin.push(bytes);
    const v=views.length;
    views.push({buffer:0,byteOffset:off,byteLength:bytes.length,
                target:target});
    off+=bytes.length;
    return v;
  };
  const minmax=(a,n)=>{
    const lo=new Array(n).fill(Infinity),hi=new Array(n).fill(-Infinity);
    for(let i=0;i<a.length;i+=n)for(let k=0;k<n;k++){
      if(a[i+k]<lo[k])lo[k]=a[i+k];
      if(a[i+k]>hi[k])hi[k]=a[i+k];
    }
    return [lo,hi];
  };

  const meshes=[],nodes=[];
  for(const m of S.meshes){
    const vp=push(m.pos,Float32Array,34962);
    const vn=push(m.nrm,Float32Array,34962);
    const vt=push(m.uv,Float32Array,34962);
    const vi=push(m.idx,Uint16Array,34963);
    const [lo,hi]=minmax(m.pos,3);
    const aP=accessors.length;
    accessors.push({bufferView:vp,componentType:5126,count:m.pos.length/3,type:"VEC3",min:lo,max:hi});
    const aN=accessors.length;
    accessors.push({bufferView:vn,componentType:5126,count:m.nrm.length/3,type:"VEC3"});
    const aT=accessors.length;
    accessors.push({bufferView:vt,componentType:5126,count:m.uv.length/2,type:"VEC2"});
    const aI=accessors.length;
    accessors.push({bufferView:vi,componentType:5123,count:m.idx.length,type:"SCALAR"});
    nodes.push({mesh:meshes.length,name:m.name});
    meshes.push({name:m.name,primitives:[{
      attributes:{POSITION:aP,NORMAL:aN,TEXCOORD_0:aT},
      indices:aI,material:m.mat,mode:4
    }]});
  }

  /* one image per distinct file, however many materials point at it */
  const images=[],imgBy={},textures=[],texBy={};
  const tex=uri=>{
    if(!uri)return undefined;
    if(texBy[uri]!==undefined)return texBy[uri];
    if(imgBy[uri]===undefined){imgBy[uri]=images.length;images.push({uri:uri});}
    textures.push({sampler:0,source:imgBy[uri]});
    return (texBy[uri]=textures.length-1);
  };
  const materials=S.materials.map(function(mt){
    const maps=mt.maps||{};
    const out={name:mt.name,doubleSided:true,pbrMetallicRoughness:{}};
    const bc=tex(maps.basecolor);
    if(bc!==undefined)out.pbrMetallicRoughness.baseColorTexture={index:bc};
    /* THE PACKING LINES UP EXACTLY. glTF reads roughness from G and metallic
       from B of one image, and occlusion from R — orm.png is already that
       image, so the same texture serves both slots and nothing has to be
       repacked or rewired. */
    const orm=tex(maps.orm);
    if(orm!==undefined){
      out.pbrMetallicRoughness.metallicRoughnessTexture={index:orm};
      out.occlusionTexture={index:orm};
    }
    out.pbrMetallicRoughness.metallicFactor=1;
    out.pbrMetallicRoughness.roughnessFactor=1;
    const nm=tex(maps.normal);
    if(nm!==undefined)out.normalTexture={index:nm};
    const em=tex(maps.emissive);
    if(em!==undefined){out.emissiveTexture={index:em};out.emissiveFactor=[1,1,1];}
    if(mt.cutout){out.alphaMode="MASK";out.alphaCutoff=0.5;}
    return out;
  });

  let total=0;
  for(const b of bin)total+=b.length;
  const buf=new Uint8Array(total);
  let p=0;
  for(const b of bin){buf.set(b,p);p+=b.length;}

  const doc={
    asset:{version:"2.0",generator:"Texture Forge"},
    scene:0,
    scenes:[{name:S.name,nodes:nodes.map((n,i)=>i)}],
    nodes:nodes,
    meshes:meshes,
    materials:materials,
    samplers:[{wrapS:10497,wrapT:10497,magFilter:9729,minFilter:9987}],
    images:images,
    textures:textures,
    accessors:accessors,
    bufferViews:views,
    buffers:[{byteLength:total,uri:"data:application/octet-stream;base64,"+b64(buf)}]
  };
  if(!images.length){delete doc.images;delete doc.textures;delete doc.samplers;}
  return JSON.stringify(doc,null,1);
}

/* ============================ Wavefront OBJ ============================ */

function obj(S,mtlName){
  const L=["# Texture Forge — "+S.name,
           "# metres, Y up. Blender's OBJ importer defaults to Y up / -Z forward,",
           "# which is the same frame the .gltf beside this uses.",
           "mtllib "+mtlName,""];
  let vOff=1,tOff=1,nOff=1;
  for(const m of S.meshes){
    L.push("o "+m.name);
    for(let i=0;i<m.pos.length;i+=3)
      L.push("v "+m.pos[i].toFixed(6)+" "+m.pos[i+1].toFixed(6)+" "+m.pos[i+2].toFixed(6));
    /* OBJ's v runs UP the image and glTF's runs down, so it flips here */
    for(let i=0;i<m.uv.length;i+=2)
      L.push("vt "+m.uv[i].toFixed(6)+" "+(1-m.uv[i+1]).toFixed(6));
    for(let i=0;i<m.nrm.length;i+=3)
      L.push("vn "+m.nrm[i].toFixed(6)+" "+m.nrm[i+1].toFixed(6)+" "+m.nrm[i+2].toFixed(6));
    L.push("usemtl "+(S.materials[m.mat]||{name:"surface"}).name);
    L.push("s off");
    for(let i=0;i<m.idx.length;i+=3){
      const f=k=>{const j=m.idx[i+k];return (vOff+j)+"/"+(tOff+j)+"/"+(nOff+j);};
      L.push("f "+f(0)+" "+f(1)+" "+f(2));
    }
    const n=m.pos.length/3;
    vOff+=n;tOff+=n;nOff+=n;
    L.push("");
  }
  return L.join("\n");
}

function mtl(S){
  const L=["# Texture Forge — "+S.name,
           "# OBJ cannot address one channel of an image, so roughness and metallic",
           "# point at their own maps here rather than at the packed orm.png the",
           "# .gltf uses. Same data, addressed the only way this format can.",""];
  for(const m of S.materials){
    const maps=m.maps||{};
    L.push("newmtl "+m.name);
    L.push("Ka 1.000 1.000 1.000");
    L.push("Kd 1.000 1.000 1.000");
    L.push("Ks 0.000 0.000 0.000");
    L.push("d 1.0");
    L.push("illum 2");
    if(maps.basecolor)L.push("map_Kd "+maps.basecolor);
    if(maps.normal){L.push("norm "+maps.normal);L.push("map_Bump -bm 1.0 "+maps.normal);}
    if(maps.roughness)L.push("map_Pr "+maps.roughness);
    if(maps.metallic)L.push("map_Pm "+maps.metallic);
    if(maps.emissive){L.push("Ke 1.000 1.000 1.000");L.push("map_Ke "+maps.emissive);}
    if(m.cutout&&maps.opacity)L.push("map_d "+maps.opacity);
    L.push("");
  }
  return L.join("\n");
}

/* ============================ the readme ============================ */

function readme(S,plans){
  const out=["Texture Forge · geometry",
    "",
    "  model.gltf   glTF 2.0. Blender: File > Import > glTF 2.0. Everything is wired:",
    "               base colour, normal, roughness and metallic out of orm.png, ambient",
    "               occlusion out of the same image's red channel, emission where the",
    "               surface has any, and alpha clipping on the cut-out faces.",
    "  model.obj    the same geometry for anything that does not read glTF, with",
    "  model.mtl    roughness and metallic pointing at their own maps, because OBJ",
    "               cannot address one channel of an image.",
    "",
    "UNITS ARE METRES and the model is already at true scale — do not scale it on",
    "import. Both files are written Y-up, which is glTF's convention and the default",
    "Blender's OBJ importer expects, so the two arrive in the same orientation.",
    ""];
  if(plans&&plans.length){
    out.push("What was measured:");
    for(const p of plans)
      out.push("  "+p.name.padEnd(10," ")+(p.plan.guessed
        ?"no declared real-world size — given a 1 x 1 m plane. Scale it yourself."
        :p.plan.w.toFixed(3)+" x "+p.plan.h.toFixed(3)+" m"+
         (p.plan.tile?"  (tiling, repeat "+p.plan.tile.toFixed(3)+" m)":"")+
         (p.plan.cutout?"  cut-out":"")));
    out.push("");
  }
  for(const n of S.notes)out.push(n);
  if(S.notes.length)out.push("");
  out.push(
    "The textures are referenced by relative path, so keep the model beside the",
    "folders it came out of. Move one and Blender will import the mesh with the",
    "materials created but the images missing.",
    "",
    "A CUT-OUT FACE IS A FLAT PLANE with a silhouette punched in its alpha. That is",
    "deliberate: a gable, a parapet or a sawtooth roofline is drawn into the texture,",
    "so the plane carries it without any geometry. It reads correctly head-on and from",
    "any angle you would photograph a building from, and it is a flat plane if you walk",
    "round the corner. Model the profile yourself if you need that.");
  return out.join("\n");
}

/* ============================ what the app calls ============================ */

window.ForgeModel={
  FT:FT,
  planOf:planOf,
  quadScene:quadScene,
  buildingScene:buildingScene,
  gltf:gltf,obj:obj,mtl:mtl,readme:readme,

  /* Files for one mode's own export: one plane at the size that mode says it
     drew, with its maps beside it in the same folder. */
  filesForFace:function(name,plan,maps,cutout){
    const rep=plan.tile>0?[plan.w/plan.tile,plan.h/plan.tile]:[1,1];
    const S=quadScene(name,plan,{name:name,maps:maps,cutout:cutout},rep);
    return pack(S,[{name:name,plan:plan}]);
  },

  /* Files for a whole structure: the box, the two sides off one elevation, and
     whatever roof the front described. */
  filesForBuilding:function(name,faces,plans){
    const S=buildingScene(name,faces);
    return pack(S,plans);
  }
};

function pack(S,plans){
  const enc=new TextEncoder();
  return [
    {name:"model.gltf",data:enc.encode(gltf(S))},
    {name:"model.obj", data:enc.encode(obj(S,"model.mtl"))},
    {name:"model.mtl", data:enc.encode(mtl(S))},
    {name:"model_readme.txt",data:enc.encode(readme(S,plans))}
  ];
}

})();
