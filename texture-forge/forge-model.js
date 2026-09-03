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
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
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

/* ============================ paint ============================

   A MULTIPLIER ON THE BASE COLOUR, which is what repainting a house is, and
   the last thing left saying "this is all one texture" once the massing has
   stopped saying it. It is not a decal and it is not a second texture: the
   same image, one material per colour, which glTF carries as baseColorFactor
   and OBJ as Kd — so the town arrives in Blender painted rather than arriving
   grey with a note about it.

   Multiplicative, so the trim, the windows and the weathering all move with
   the wall the way they would under a coat of paint, and gentle, because a
   house tinted hard is a house somebody photographed through glass. */
const TINTS=[
  [1.00,1.00,1.00],  [1.07,1.00,0.90],  [0.86,0.91,0.99],  [0.93,1.00,0.91],
  [1.06,0.93,0.85],  [0.84,0.80,0.79],  [1.10,1.08,1.03],  [0.77,0.83,0.89],
  [1.02,0.90,0.88],  [0.90,0.95,0.90]
];
/* the roof moves less and separately: a street of different houses under one
   colour of shingle is a street, a street of different shingle is a fairground */
const ROOF_TINTS=[[1.00,1.00,1.00],[0.92,0.90,0.90],[1.05,1.01,0.96],[0.86,0.88,0.93]];
function tintOf(table,n){return table[((n|0)%table.length+table.length)%table.length];}

/* "6 factorys" is the sort of thing that makes a person distrust the number
   next to it. One rule, because these are all type names in this app's own
   vocabulary rather than English at large. */
function plural(word,n){
  if(n===1)return word;
  return /[^aeiou]y$/.test(word)?word.slice(0,-1)+"ies":word+"s";
}

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

/* ---------------------------------------------------------------------------
   A WHOLE TOWN

   The same building, four walls and a roof off three textures, standing a few
   hundred times over on ground a street grid worked out — plus the streets
   themselves. modes/lib/town.js decides where everything goes and this puts
   triangles on it; neither knows anything about the other beyond the plain
   object between them.

   ONE MESH PER MATERIAL, not one per building. A town is two hundred houses
   sharing four textures, and two hundred meshes of twenty vertices each is
   two hundred draw calls, two hundred buffer uploads and a stage that drops
   to single figures. Every instance of a face appends into the one mesh that
   face's texture owns, which is also what makes the export a handful of
   objects a person can select in Blender rather than a list they scroll.

   THE 16-BIT CEILING IS REAL. glTF and the stage both index with unsigned
   shorts, so a mesh is closed off and a fresh one started before it can pass
   65535 vertices. At twenty vertices a building that is three thousand
   buildings to a mesh, which no town here reaches, but a town that did would
   otherwise wrap its indices round to zero and draw a knot.

   THE KIT is what the wizard forged: for each type, the same {plan, material}
   objects buildingScene takes, and for the streets a run and a junction. A
   type the kit has no entry for is simply not built — a town with the works
   switched off is a town with no works in it, not a town with a hole.
   --------------------------------------------------------------------------- */

/* rotation about Y, the only rotation a town needs: everything meets the road
   square and the road is on the grid */
function spin(a){const c=Math.cos(a),s=Math.sin(a);return function(x,y,z){
  return [x*c+z*s,y,-x*s+z*c];};}

function townScene(name,L,kit,opts){
  const sel=(opts&&opts.select!==undefined&&opts.select!==null)?opts.select:-1;
  const S=scene(name);
  const matIdx={},meshBy={};
  /* THE MATERIAL A FACE'S TEXTURE BELONGS TO, once per colour it is painted.
     One image, several materials: the name carries the paint so the batching
     splits on it, and `face` carries the step id so the 3D view still knows
     which forged texture to bind. A tint of one is the texture as forged and
     keeps the plain name, so a town with the paint turned off is exactly the
     town it was before there was any. */
  const use=(f,tint)=>{
    if(!f||!f.material)return -1;
    const t=tint||[1,1,1];
    const flat=(t[0]===1&&t[1]===1&&t[2]===1);
    const n=f.material.name+(flat?"":"#"+t.join("_"));
    if(matIdx[n]!==undefined)return matIdx[n];
    const m={name:n,face:f.material.face||f.material.name,
             maps:f.material.maps,cutout:f.material.cutout};
    if(!flat)m.tint=t;
    S.materials.push(m);
    return (matIdx[n]=S.materials.length-1);
  };
  /* THE MESH CURRENTLY TAKING THAT MATERIAL'S TRIANGLES, rolled over before it
     can outgrow a 16-bit index — and every triangle tagged with the lot it
     belongs to, because a town of a hundred houses off one texture is one mesh
     and "which house did I just click" cannot be answered by the material.

     A SELECTED BUILDING GETS ITS OWN MESH. It is the only way to light one
     instance and not all hundred of them: the highlight is a uniform, and a
     uniform is per draw call. Splitting one building out of the batch costs a
     draw call for as long as it is selected and nothing at all after. */
  const into=(mi,label,tag,own)=>{
    if(own){
      const m=mesh(label+"_selected",mi);
      m.sel=true;m.tag=[];
      S.meshes.push(m);
      return m;
    }
    const cur=meshBy[mi];
    if(cur&&cur.pos.length/3<65000)return cur;
    const m=mesh(label+(cur?"_"+(S.meshes.length):""),mi);
    m.tag=[];
    S.meshes.push(m);
    return (meshBy[mi]=m);
  };
  /* one entry per TRIANGLE, and quad() lays down two of them */
  const tagQuads=(m,tag,n)=>{for(let i=0;i<(n||1)*2;i++)m.tag.push(tag);};

  /* --- the ground the streets are laid on ------------------------------- */
  const B=L.bounds;

  /* --- the streets ------------------------------------------------------
     A run is one quad with v across the whole cross-section and u repeating
     along it, because that is how the street texture is drawn: a square tile
     covering its own corridor width, laid in the direction of travel. A
     junction is one tile square, unrepeated. Both sit a whisker above zero so
     the ground plane underneath them does not fight for the same depth. */
  const road=kit.street&&kit.street.run,junc=kit.street&&kit.street.inter;
  const Y=0.02;
  if(road){
    const mi=use(road,null),tile=Math.max(0.5,road.plan.tile||road.plan.w||L.roadM);
    for(const st of L.streets){
      const m=into(mi,"street");
      const h=st.w/2;
      tagQuads(m,-1);
      /* wound clockwise seen from above, which is what faces the sky, and
         laid u ALONG the road and v across it, because that is the way the
         street texture is drawn — one square tile spanning the whole
         cross-section, repeating in the direction of travel */
      if(st.axis==="z"){
        const len=st.z1-st.z0;
        if(len<=0.05)continue;
        const u=len/tile;
        quad(m,[st.x-h,Y,st.z1],[st.x+h,Y,st.z1],[st.x+h,Y,st.z0],[st.x-h,Y,st.z0],
             [0,1,0],[[u,0],[u,1],[0,1],[0,0]]);
      }else{
        const len=st.x1-st.x0;
        if(len<=0.05)continue;
        const u=len/tile;
        quad(m,[st.x0,Y,st.z-h],[st.x0,Y,st.z+h],[st.x1,Y,st.z+h],[st.x1,Y,st.z-h],
             [0,1,0],[[0,0],[0,1],[u,1],[u,0]]);
      }
    }
  }
  if(junc){
    const mi=use(junc,null);
    for(const nd of L.nodes){
      const m=into(mi,"junction"),h=nd.w/2;
      tagQuads(m,-1);
      quad(m,[nd.x-h,Y+0.001,nd.z+h],[nd.x+h,Y+0.001,nd.z+h],
             [nd.x+h,Y+0.001,nd.z-h],[nd.x-h,Y+0.001,nd.z-h],
           [0,1,0],[[1,0],[1,1],[0,1],[0,0]]);
    }
  }

  /* --- the buildings ----------------------------------------------------

     ONE TEXTURE IS NOT ONE BUILDING, and a town of two hundred off the same
     four faces was two hundred identical boxes in rows. Everything the layout
     decided per instance — mirrored or not, which way the ridge runs, how tall,
     how deep, how far back, and what is stuck on the side of it — is read here
     and costs no texture at all.

     A WING WEARS A WINDOW OF THE PARENT'S OWN ELEVATION. A garage is not a
     small house: it is a wall four metres high with a door in it. Squashing a
     whole two-storey elevation onto it makes a doll's house, so it samples the
     BOTTOM four metres of the same image at the SAME texel scale — real wall
     at a real size — and the alpha up in the sky never comes into it. */
  let built=0;
  for(const lot of L.lots){
    const K=kit[lot.type];
    if(!K||!K.front)continue;
    const front=K.front,side=K.side||K.front,back=K.back||K.front,roof=K.roof;
    const sc=lot.scale||1;
    const st=lot.style||{};
    const hMul=st.hMul>0?st.hMul:1;
    /* the whole face, in metres, as the parent building wears it — every UV
       window below is a fraction of these */
    const FW=front.plan.w*sc,FH=front.plan.h*sc*hMul;
    const SW=(side?side.plan.w:front.plan.w*0.6)*sc,SH=side?side.plan.h*sc*hMul:FH;
    const BH=back.plan.h*sc*hMul;
    const eaves=front.plan.eaves*sc*hMul;
    const parts=(lot.env&&lot.env.parts)||[{kind:"main",x:0,z:0,w:FW,d:SW,h:1}];
    /* px/pz is where design mode slid it along its own frontage; the formula
       for that lives in the layout library with the leash it is clamped to, so
       the picture and the export cannot end up with two ideas of it */
    const R=spin(lot.rot||0);
    const ox=(lot.px===undefined?lot.x:lot.px),oz=(lot.pz===undefined?lot.z:lot.pz);
    const at=(x,y,z)=>{const p=R(x,y,z);return [p[0]+ox,p[1],p[2]+oz];};
    const nAt=(x,y,z)=>R(x,y,z);
    const own=(lot.i===sel);
    const flip=!!st.mirror;
    /* a landmark is the building everybody knows, so it wears the colour it
       was forged in */
    const paint=lot.landmark?[1,1,1]:tintOf(TINTS,st.tint);
    const rpaint=lot.landmark?[1,1,1]:tintOf(ROOF_TINTS,(st.tint*7)>>2);
    const mFront=use(front,paint),mBack=use(back,paint),
          mSide=side?use(side,paint):-1,mRoof=roof?use(roof,rpaint):-1;
    /* u across a face, mirrored or not: the same elevation seen the other way
       round, which is half the houses on any street */
    const U=(a,b)=>flip?[b,a]:[a,b];

    for(const p of parts){
      const main=(p.kind==="main");
      const W=p.w,D=p.d,px=p.x,pz=p.z;
      const H=main?FH:eaves*(p.h||0.5);
      const top=main?eaves:H;             // where this part's roof sits
      /* the window this part takes out of each face */
      const uw=main?1:Math.min(1,W/Math.max(0.01,FW));
      const u0=main?0:clamp(0.5+px/Math.max(0.01,FW)-uw/2,0,1-uw);
      const vw=main?0:1-Math.min(1,H/Math.max(0.01,FH));
      const sw=main?1:Math.min(1,D/Math.max(0.01,SW));
      const s0=main?0:clamp(0.5-pz/Math.max(0.01,SW)-sw/2,0,1-sw);
      const svw=main?0:1-Math.min(1,H/Math.max(0.01,SH));
      const wallH=main?FH:H,backH=main?BH:H,sideH=main?SH:H;

      const mF=into(mFront,"front",0,own);
      const fu=U(u0,u0+uw);
      quad(mF,at(px-W/2,0,pz+D/2),at(px+W/2,0,pz+D/2),
              at(px+W/2,wallH,pz+D/2),at(px-W/2,wallH,pz+D/2),
           nAt(0,0,1),[[fu[0],1],[fu[1],1],[fu[1],vw],[fu[0],vw]]);
      tagQuads(mF,lot.i);

      const mB=into(mBack,"back",0,own);
      const bu=U(u0,u0+uw);
      quad(mB,at(px+W/2,0,pz-D/2),at(px-W/2,0,pz-D/2),
              at(px-W/2,backH,pz-D/2),at(px+W/2,backH,pz-D/2),
           nAt(0,0,-1),[[bu[0],1],[bu[1],1],[bu[1],vw],[bu[0],vw]]);
      tagQuads(mB,lot.i);

      if(side){
        const mi=mSide;
        const mR=into(mi,"side",0,own);
        quad(mR,at(px+W/2,0,pz+D/2),at(px+W/2,0,pz-D/2),
                at(px+W/2,sideH,pz-D/2),at(px+W/2,sideH,pz+D/2),
             nAt(1,0,0),[[s0,1],[s0+sw,1],[s0+sw,svw],[s0,svw]]);
        tagQuads(mR,lot.i);
        const mL=into(mi,"side",0,own);
        quad(mL,at(px-W/2,0,pz-D/2),at(px-W/2,0,pz+D/2),
                at(px-W/2,sideH,pz+D/2),at(px-W/2,sideH,pz-D/2),
             nAt(-1,0,0),[[s0,1],[s0+sw,1],[s0+sw,svw],[s0,svw]]);
        tagQuads(mL,lot.i);
      }

      if(roof){
        const tile=(roof.plan.tile||roof.plan.w||2);
        const m=into(mRoof,"roof",0,own);
        /* WHICH WAY THE RIDGE RUNS is most of what an aerial view of a town is,
           and it is free — the roof is a tiling material either way. The flat
           ones are flat because the layout said so, not because the texture
           could not do better. */
        const wantGable=main
          ?(((front.plan.roof&&front.plan.roof.kind)||"flat")==="gable"&&!st.flat)
          :(p.kind==="ell"&&!p.flat);
        if(wantGable){
          const ridgeX=main?((st.ridge||(front.plan.roof&&front.plan.roof.ridge)||"x")==="x")
                           :(W>=D);
          const span=(ridgeX?D:W)/2;
          const pitch=Math.max(0.5,(main?(st.pitch||(front.plan.roof&&front.plan.roof.pitch)||6):6))/12;
          /* the ridge comes off the gable face's own silhouette where there is
             one, or the pitch where there is not, exactly as one building does
             — a plane that lands short of the triangle it closes is a slot of
             daylight */
          const gf=ridgeX?side:front;
          const gh=(main&&gf)?gf.plan.h*sc*hMul:0;
          const tp=Math.max(top+0.01,gh>top?gh:top+span*pitch);
          const rise=tp-top,slope=Math.sqrt(span*span+rise*rise);
          const nz=span/slope,ny=rise/slope;
          if(ridgeX){
            quad(m,at(px-W/2,top,pz+D/2),at(px+W/2,top,pz+D/2),at(px+W/2,tp,pz),at(px-W/2,tp,pz),
                 nAt(0,nz,ny),[[0,slope/tile],[W/tile,slope/tile],[W/tile,0],[0,0]]);
            quad(m,at(px+W/2,top,pz-D/2),at(px-W/2,top,pz-D/2),at(px-W/2,tp,pz),at(px+W/2,tp,pz),
                 nAt(0,nz,-ny),[[0,slope/tile],[W/tile,slope/tile],[W/tile,0],[0,0]]);
          }else{
            quad(m,at(px+W/2,top,pz+D/2),at(px+W/2,top,pz-D/2),at(px,tp,pz-D/2),at(px,tp,pz+D/2),
                 nAt(ny,nz,0),[[0,slope/tile],[D/tile,slope/tile],[D/tile,0],[0,0]]);
            quad(m,at(px-W/2,top,pz-D/2),at(px-W/2,top,pz+D/2),at(px,tp,pz+D/2),at(px,tp,pz-D/2),
                 nAt(-ny,nz,0),[[0,slope/tile],[D/tile,slope/tile],[D/tile,0],[0,0]]);
          }
          tagQuads(m,lot.i,2);
        }else{
          quad(m,at(px-W/2,top,pz+D/2),at(px+W/2,top,pz+D/2),
                 at(px+W/2,top,pz-D/2),at(px-W/2,top,pz-D/2),
               [0,1,0],[[0,D/tile],[W/tile,D/tile],[W/tile,0],[0,0]]);
          tagQuads(m,lot.i);
        }
      }
    }
    built++;
  }

  const by={};
  for(const lot of L.lots)by[lot.type]=(by[lot.type]|0)+1;
  const kinds=Object.keys(by).map(k=>by[k]+" "+plural(k,by[k])).join(", ");
  S.notes.push("Town: "+built+" buildings — "+(kinds||"none")+" — on "+L.blocks.length+
               " blocks, over "+(B.w/1).toFixed(0)+" x "+(B.d).toFixed(0)+" m.");
  S.notes.push("Streets: "+L.streets.length+" runs and "+L.nodes.length+
               " junctions, corridors "+L.roadM.toFixed(1)+" m wide — which is the street "+
               "texture's own tile, so the kerbs land where the kerbs are drawn.");
  S.notes.push("Every instance of a face shares one material and one mesh. There is no "+
               "ground plane in this file: the town sits on y = 0 and the streets a "+
               "centimetre above it, so drop it on whatever ground you already have.");
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
    /* THE PAINT TRAVELS. One image worn in several colours is several
       materials with one texture between them, and baseColorFactor is exactly
       the multiplier that means — so the town arrives in Blender painted
       rather than arriving grey with a note about it. */
    if(mt.tint)out.pbrMetallicRoughness.baseColorFactor=[mt.tint[0],mt.tint[1],mt.tint[2],1];
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
           "# .gltf uses. Same data, addressed the only way this format can.",
           "# Where one image is worn in several colours, Kd carries the paint and",
           "# map_Kd is the same file on every one of them.",""];
  for(const m of S.materials){
    const maps=m.maps||{};
    L.push("newmtl "+m.name);
    L.push("Ka 1.000 1.000 1.000");
    L.push("Kd "+(m.tint?m.tint.map(v=>v.toFixed(3)).join(" "):"1.000 1.000 1.000"));
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
  plural:plural,
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
  },

  townScene:townScene,

  /* Files for a whole town: every building the layout placed, standing on the
     streets that placed them. */
  filesForTown:function(name,L,kit,plans){
    return pack(townScene(name,L,kit),plans);
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
