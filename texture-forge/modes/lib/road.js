/* =====================================================================
   ROAD — a cross-section, extruded, and allowed to fall apart
   =====================================================================
   A road asset is a PROFILE swept along a PATH. The profile is the whole
   cross-section in metres — crown, lanes, gutter, kerb face, footway,
   verge, ditch, embankment slope — drawn as a polyline whose nodes can be
   corners or rounded, with each segment saying what it is made of. The
   path is a length with an optional bend and rise. Everything below is
   pure geometry: no DOM, no textures, nothing but numbers in and
   triangles out, so it can be tested on its own and drawn by anything.

   THE ROAD CAN CRUMBLE TO NOTHING at either end. That is the difference
   between a road asset and a road-shaped block: a section that ends in a
   clean cut wants another section butted against it, and a section that
   ends in broken slabs, bare base and rubble can end in a field. The
   decay is a per-slab draw against a front that advances over the decay
   length — edges first, the crown last — with the survivors dropping and
   tilting as the front reaches them and the dead ones leaving lumps.

   AND IT IS SOLID. Every slab of surface has a base under it and a wall
   down every edge that has nothing beside it — the ends, the outside of
   the verge, and every ragged edge the decay opens up. So the mesh is
   closed wherever the eye can reach, and a broken end shows the thickness
   of the road rather than a sheet of nothing.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,hashi=Forge.hashi;

/* ============================ what a segment is made of ============================
   Four kinds, three textures: bare ground is the verge's texture worn darker,
   because the underside of a road and the raw earth of a cutting are the same
   thing seen from two sides. `tex` names the step in the structure's kit. */
const KINDS={
  road:  {label:"Road surface",tex:"surface",colour:"#41454b"},
  kerb:  {label:"Kerb / paving",tex:"kerb",colour:"#b9b4a9"},
  verge: {label:"Verge",tex:"verge",colour:"#6e7a4b"},
  ground:{label:"Bare ground",tex:"verge",colour:"#7a6a55",tint:[0.60,0.54,0.46]}
};
const KIND_ORDER=["road","kerb","verge","ground"];

/* ============================ the profile ============================
   A node is {x,y,k,s}: x across the road (metres, negative to the left),
   y up, k the kind of the segment LEAVING it to the right, s whether the
   corner at it is rounded. The last node's kind is nobody's. */
function node(x,y,k,s){return {x:x,y:y,k:k||"road",s:!!s};}

/* A PROFILE IS DRAWN AS ITS RIGHT HALF and mirrored, because nearly every road
   is symmetric and the ones that are not are edited from a symmetric start.
   The mirrored segment between -x[i+1] and -x[i] is the same stuff as the one
   between x[i] and x[i+1], which is why the kinds shift by one on the left. */
function mirror(half){
  const out=[];
  for(let i=half.length-1;i>=1;i--)out.push(node(-half[i].x,half[i].y,half[i-1].k,half[i].s));
  for(let i=0;i<half.length;i++)out.push(node(half[i].x,half[i].y,half[i].k,half[i].s));
  return out;
}

const PRESETS=[
  {id:"two_lane",label:"Two lanes, kerbed",blurb:"Crowned carriageway, gutter, kerb, footway, verge",
   half:[node(0,0.075,"road",true),node(3.65,0,"kerb"),node(3.65,0.125,"kerb"),node(3.80,0.125,"kerb"),
         node(5.60,0.155,"verge"),node(6.60,0.05,"ground"),node(7.20,-0.15,"ground")]},
  {id:"country",label:"Country lane, ditched",blurb:"No kerb — a soft verge falling into a ditch",
   half:[node(0,0.06,"road",true),node(2.75,0,"verge"),node(3.60,-0.02,"verge"),node(4.20,-0.45,"verge",true),
         node(4.80,-0.45,"verge"),node(5.60,0.10,"ground"),node(6.30,0.10,"ground")]},
  {id:"dual",label:"Dual carriageway",blurb:"Two lanes each way about a paved median",
   half:[node(0,0.15,"kerb"),node(1.20,0.15,"kerb"),node(1.20,0,"road"),node(8.50,-0.18,"verge"),
         node(11.50,-0.26,"ground"),node(13.50,-1.20,"ground"),node(14.50,-1.20,"ground")]},
  {id:"highway",label:"Highway, hard shoulders",blurb:"Wide and flat, the shoulders part of the surface",
   half:[node(0,0.10,"road",true),node(10.30,-0.12,"verge"),node(12.80,-0.20,"ground"),
         node(15.00,-1.60,"ground"),node(16.00,-1.60,"ground")]},
  {id:"embank",label:"Embankment",blurb:"The road carried on a bank with 1:2 slopes",
   half:[node(0,0.08,"road",true),node(3.65,0,"verge"),node(4.50,-0.05,"ground"),
         node(8.50,-2.00,"ground"),node(10.00,-2.00,"ground")]},
  {id:"cutting",label:"Cutting",blurb:"The road cut into rising ground, a drain each side",
   half:[node(0,0.08,"road",true),node(3.65,0,"verge"),node(4.20,-0.30,"verge",true),node(4.80,-0.30,"ground"),
         node(5.20,0,"ground"),node(8.20,2.40,"ground"),node(9.50,2.40,"ground")]},
  {id:"track",label:"Dirt track",blurb:"Two ruts in bare ground, no surface at all",
   half:[node(0,0.05,"ground",true),node(1.00,-0.06,"ground",true),node(1.50,0,"verge"),
         node(2.40,-0.08,"ground"),node(3.50,0.30,"ground"),node(4.00,0.30,"ground")]},
  {id:"causeway",label:"Causeway",blurb:"Raised on retaining walls, kerbed both sides",
   half:[node(0,0.06,"road",true),node(3.65,0,"kerb"),node(3.65,0.15,"kerb"),node(4.15,0.15,"kerb"),
         node(4.15,-1.80,"ground"),node(5.50,-1.80,"ground")]},
  {id:"single",label:"Single track",blurb:"One lane wide, verges either side",
   half:[node(0,0.05,"road",true),node(1.75,0,"verge"),node(3.20,-0.10,"ground"),node(4.00,-0.10,"ground")]},
  {id:"boulevard",label:"Boulevard",blurb:"A planted median, kerbed lanes, wide paved footways",
   half:[node(0,0.15,"verge"),node(2.00,0.15,"kerb"),node(2.00,0,"road"),node(9.30,-0.12,"kerb"),
         node(9.30,0.02,"kerb"),node(9.45,0.02,"kerb"),node(12.50,0.06,"kerb"),node(13.00,0.06,"ground"),
         node(13.60,-0.10,"ground")]}
];
function preset(id){
  const p=PRESETS.find(x=>x.id===id)||PRESETS[0];
  return mirror(p.half);
}
function copyNodes(nodes){return nodes.map(n=>node(n.x,n.y,n.k,n.s));}

/* THE PROFILE, RESAMPLED. A rounded node is replaced by a quadratic curve
   between points a third of the way along each of its segments, so a crown is
   a crown and a ditch bottom is a bowl rather than a crease, and the points
   the curve is made of are marked soft so the shading averages across them
   while a kerb's arris stays an arris. Each point carries the kind of the
   segment leaving it and its arc-length across, which is what the textures are
   laid by. */
function resample(nodes){
  const pts=[];
  const n=nodes.length;
  const push=(x,y,k,soft)=>{pts.push({x:x,y:y,k:k,soft:!!soft,a:0});};
  for(let i=0;i<n;i++){
    const c=nodes[i];
    if(c.s&&i>0&&i<n-1){
      const p=nodes[i-1],q=nodes[i+1];
      const f=0.35;
      const ax=lerp(c.x,p.x,f),ay=lerp(c.y,p.y,f);
      const bx=lerp(c.x,q.x,f),by=lerp(c.y,q.y,f);
      const N=7;
      for(let t=0;t<=N;t++){
        const u=t/N;
        const x=(1-u)*(1-u)*ax+2*(1-u)*u*c.x+u*u*bx;
        const y=(1-u)*(1-u)*ay+2*(1-u)*u*c.y+u*u*by;
        push(x,y,u<0.5?p.k:c.k,true);
      }
    }else push(c.x,c.y,c.k,false);
  }
  /* NO SLAB WIDER THAN A SLAB. A seven-metre carriageway drawn as one segment
     is one seven-metre quad, which tessellates a bend badly and, when the
     decay reaches it, tips over as one seven-metre piece — which is not what
     crumbling looks like. So long segments are cut into pieces of about a
     metre; the road's texture is laid by the RUN and not the point, so the
     cut costs it nothing. */
  const MAX=1.25,fine=[];
  for(let i=0;i<pts.length;i++){
    fine.push(pts[i]);
    if(i===pts.length-1)break;
    const q=pts[i+1],len=Math.hypot(q.x-pts[i].x,q.y-pts[i].y);
    const n=Math.ceil(len/MAX);
    for(let t=1;t<n;t++){
      const u=t/n;
      fine.push({x:lerp(pts[i].x,q.x,u),y:lerp(pts[i].y,q.y,u),k:pts[i].k,soft:true,a:0});
    }
  }
  pts.length=0;for(const p of fine)pts.push(p);
  /* the arc-length across, and the runs of one kind, so a road surface can
     span its texture across the whole carriageway rather than per point */
  let a=0;
  for(let i=0;i<pts.length;i++){
    if(i>0)a+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);
    pts[i].a=a;
  }
  const runs=[];
  for(let i=0;i<pts.length-1;i++){
    const k=pts[i].k;
    const cur=runs.length?runs[runs.length-1]:null;
    if(cur&&cur.k===k&&cur.end===i)cur.end=i+1;
    else runs.push({k:k,start:i,end:i+1});
  }
  for(const r of runs){r.a0=pts[r.start].a;r.a1=pts[r.end].a;}
  for(let i=0;i<pts.length-1;i++)pts[i].run=runs.find(r=>i>=r.start&&i<r.end);
  return {pts:pts,runs:runs,width:a};
}

/* the extents of a profile: what the designer frames and the readout says */
function extents(nodes){
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  for(const n of nodes){
    if(n.x<x0)x0=n.x;if(n.x>x1)x1=n.x;
    if(n.y<y0)y0=n.y;if(n.y>y1)y1=n.y;
  }
  if(!(x0<x1)){x0=-1;x1=1;}
  if(!(y0<=y1)){y0=-0.5;y1=0.5;}
  let road=0;
  for(let i=0;i<nodes.length-1;i++)if(nodes[i].k==="road")road+=Math.abs(nodes[i+1].x-nodes[i].x);
  return {x0:x0,x1:x1,y0:y0,y1:y1,w:x1-x0,h:y1-y0,road:road};
}

/* ============================ the path ============================
   Straight along +z from the origin, or an arc turning `bend` degrees over
   the length, climbing `rise` metres. The frame at a station is the tangent
   and the right-hand normal; a profile point at (x,y) sits at
   pos + right*x + up*y. */
function pathOf(R){
  const L=Math.max(1,+R.length||60);
  const th=(+R.bend||0)*Math.PI/180;
  const kap=Math.abs(th)>1e-6?th/L:0;
  const rise=+R.rise||0;
  return {
    L:L,kap:kap,rise:rise,
    at:function(s){
      const y=rise*s/L;
      if(!kap)return {p:[0,y,s],t:[0,0,1],r:[1,0,0]};
      const a=kap*s,Rr=1/kap;
      /* turning left (positive) bends the road toward -x */
      return {p:[-Rr*(1-Math.cos(a)),y,Rr*Math.sin(a)],
              t:[-Math.sin(a),0,Math.cos(a)],
              r:[Math.cos(a),0,Math.sin(a)]};
    }
  };
}

/* ============================ noise ============================
   Value noise on a plain integer lattice — nothing here tiles, so the periodic
   one in forge-math is the wrong tool. */
function vn(x,y,seed){
  const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;
  const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const a=hashi(xi,yi,seed),b=hashi(xi+1,yi,seed),c=hashi(xi,yi+1,seed),d=hashi(xi+1,yi+1,seed);
  return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}
function fb(x,y,seed){
  return (vn(x,y,seed)*0.6+vn(x*2.1,y*2.1,seed+77)*0.28+vn(x*4.3,y*4.3,seed+151)*0.12);
}

/* ============================ the decay front ============================
   How far gone the road is at station s: nothing in the sound middle, rising
   to everything over the decay length at each end. Shaped so the last few
   metres are the ones that fall apart fastest, which is what a road eroded
   from its end looks like — long sound, then quickly rubble. */
function decayAt(R,L,s){
  const dA=Math.max(0,+R.decayA||0),dB=Math.max(0,+R.decayB||0);
  let t=0;
  if(dA>0)t=Math.max(t,clamp(1-s/dA,0,1));
  if(dB>0)t=Math.max(t,clamp(1-(L-s)/dB,0,1));
  return Math.pow(t,0.85);
}

/* ============================ the mesh ============================
   Parts by kind, each a list of meshes that roll over before a 16-bit index
   runs out. Every slab is four vertices of its own — that is what lets a slab
   drop and tilt on its own when the decay reaches it — and its shading comes
   from the profile's own normals so a crown still reads as a curve. */
function part(parts,kind){
  const list=parts[kind]||(parts[kind]=[]);
  let m=list[list.length-1];
  if(!m||m.pos.length/3>65000-8){
    m={name:kind+(list.length?"_"+list.length:""),kind:kind,pos:[],nrm:[],uv:[],idx:[]};
    list.push(m);
  }
  return m;
}
function area2(a,b,c){
  const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;
  return x*x+y*y+z*z;
}
function quad(m,a,b,c,d,na,nb,nc,nd,ta,tb,tc,td){
  /* A ZERO-AREA QUAD IS NOT GEOMETRY. The base under a vertical kerb face and
     the end wall on top of it are both slivers of nothing, and a sliver of
     nothing with a normal is a triangle wound against it. */
  if(area2(a,b,c)+area2(a,c,d)<1e-14)return false;
  const base=m.pos.length/3;
  m.pos.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2],d[0],d[1],d[2]);
  m.nrm.push(na[0],na[1],na[2],nb[0],nb[1],nb[2],nc[0],nc[1],nc[2],nd[0],nd[1],nd[2]);
  m.uv.push(ta[0],ta[1],tb[0],tb[1],tc[0],tc[1],td[0],td[1]);
  m.idx.push(base,base+1,base+2,base,base+2,base+3);
  return true;
}
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const nrm=v=>{const l=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/l,v[1]/l,v[2]/l];};
const add=(a,b,k)=>[a[0]+b[0]*(k===undefined?1:k),a[1]+b[1]*(k===undefined?1:k),a[2]+b[2]*(k===undefined?1:k)];
/* the flat normal of a quad, from its own corners */
function flatN(a,b,c){return nrm(cross(sub(b,a),sub(c,a)));}

/* R: {length,res,bend,rise,wobble,decayA,decayB,rough,edge,drop,debris,
       thick,solid,seed,nodes}
   tiles: {surface,kerb,verge} — the real size of each texture, for the UVs */
function build(R,tiles){
  const T=Object.assign({surface:7.3,kerb:0.915,kerbH:0.15,verge:3},tiles||{});
  const nodes=R.nodes&&R.nodes.length>=2?R.nodes:preset("two_lane");
  const prof=resample(nodes);
  const pts=prof.pts,nP=pts.length;
  const path=pathOf(R);
  const L=path.L;
  const res=clamp(+R.res||0.5,0.1,5);
  const nS=Math.max(1,Math.ceil(L/res));
  const seed=(R.seed|0)||7;
  const thick=Math.max(0.05,+R.thick||0.35);
  const num=(v,d)=>(v===undefined||v===null||v===""||isNaN(+v))?d:+v;
  const rough=clamp(num(R.rough,0.6),0,1);
  const edge=clamp(num(R.edge,0.6),0,1);
  const dropM=Math.max(0,num(R.drop,0.6));
  const debris=clamp(num(R.debris,0.5),0,1);
  const wob=Math.max(0,+R.wobble||0);
  const solid=R.solid!==false;
  let yMin=Infinity,xMax=0;
  for(const p of pts){if(p.y<yMin)yMin=p.y;if(Math.abs(p.x)>xMax)xMax=Math.abs(p.x);}
  const halfW=Math.max(0.5,xMax);
  const baseY=yMin-thick;

  /* ---- the stations: frame, decay, wobble ---- */
  const st=[];
  for(let i=0;i<=nS;i++){
    const s=Math.min(L,i*res);
    const f=path.at(s);
    const w=wob?(vn(s/6,0.5,seed+31)-0.5)*2*wob:0;
    st.push({s:s,p:[f.p[0],f.p[1]+w,f.p[2]],t:f.t,r:f.r,d:decayAt(R,L,s),base:f.p[1]+baseY});
  }
  /* a profile point in the world at station i */
  const at=(i,j,dy)=>{
    const S=st[i],p=pts[j];
    return [S.p[0]+S.r[0]*p.x,S.p[1]+p.y+(dy||0),S.p[2]+S.r[2]*p.x];
  };
  /* the profile's own 2D normal at point j, rotated into the station's frame.
     Soft points average their two segments; corners keep the segment's own. */
  const segN=[];
  for(let j=0;j<nP-1;j++){
    const dx=pts[j+1].x-pts[j].x,dy=pts[j+1].y-pts[j].y,l=Math.hypot(dx,dy)||1;
    segN.push([-dy/l,dx/l]);                   // left-hand normal of a left-to-right segment is UP
  }
  const ptN=[];
  for(let j=0;j<nP;j++){
    const a=segN[Math.max(0,j-1)],b=segN[Math.min(nP-2,j)];
    if(pts[j].soft||j===0||j===nP-1){const x=a[0]+b[0],y=a[1]+b[1],l=Math.hypot(x,y)||1;ptN.push([x/l,y/l]);}
    else ptN.push(null);                       // a corner: each side keeps its own
  }
  const nAt=(i,j,side)=>{
    const S=st[i];
    const n2=ptN[j]||segN[clamp(side<0?j-1:j,0,nP-2)];
    return nrm([S.r[0]*n2[0],n2[1],S.r[2]*n2[0]]);
  };

  /* ---- which slabs survive ---- */
  const alive=new Uint8Array(nS*(nP-1));
  const gone=new Float32Array(nS*(nP-1));     // how close to the front, for the survivors
  const cellA=1.6,cellX=1.1;
  for(let i=0;i<nS;i++)for(let j=0;j<nP-1;j++){
    const t=Math.max(st[i].d,st[i+1].d);
    const xc=(pts[j].x+pts[j+1].x)*0.5,sc=(st[i].s+st[i+1].s)*0.5;
    const n=fb(sc/cellA,pts[j].a/cellX,seed);
    const k=clamp(0.5+(n-0.5)*rough*1.7-edge*(Math.abs(xc)/halfW)*0.42,0.02,0.98);
    const q=i*(nP-1)+j;
    alive[q]=t<k?1:0;
    gone[q]=t>0?clamp(t/k,0,1):0;
  }
  const isAlive=(i,j)=>(i>=0&&i<nS&&j>=0&&j<nP-1)?alive[i*(nP-1)+j]:0;

  /* ---- the slabs, displaced where the front has reached them ---- */
  const parts={};
  const census={slabs:0,gone:0,walls:0,base:0,debris:0,byKind:{},stations:[]};
  const corner=(i,j,q,w)=>{
    /* the four corners of slab (i,j), dropped, tilted and shrunk by w */
    const c=[at(i,j),at(i,j+1),at(i+1,j+1),at(i+1,j)];
    if(w<=0.001)return c;
    const h1=hashi(i,j,seed+401),h2=hashi(i,j,seed+409),h3=hashi(i,j,seed+419);
    const cx=[(c[0][0]+c[2][0])/2,(c[0][1]+c[2][1])/2,(c[0][2]+c[2][2])/2];
    const drop=dropM*Math.pow(w,1.5)*(0.5+0.5*h1);
    /* the tilt is an angle, but what the eye reads is how far a corner
       lifts, and a corner lifting more than the road is thick is a slab
       standing on end — so the angle is held to what the slab's own size
       allows */
    const hx=Math.hypot(c[1][0]-c[0][0],c[1][2]-c[0][2])*0.5||0.1;
    const hz=Math.hypot(c[3][0]-c[0][0],c[3][2]-c[0][2])*0.5||0.1;
    const lim=thick*0.8;
    const roll=clamp((h2-0.5)*0.55*w,-lim/hx,lim/hx),pitch=clamp((h3-0.5)*0.45*w,-lim/hz,lim/hz),sh=1-w*0.14;
    const S=st[i];
    const out=c.map(p=>{
      let d=sub(p,cx);
      /* along and across the road, so the tilt is a slab tipping into the
         hole beside it rather than a random spin */
      const al=d[0]*S.t[0]+d[2]*S.t[2],ac=d[0]*S.r[0]+d[2]*S.r[2];
      const up=d[1]+ac*roll+al*pitch;
      d=[(S.t[0]*al+S.r[0]*ac)*sh,up,(S.t[2]*al+S.r[2]*ac)*sh];
      return [cx[0]+d[0],cx[1]+d[1],cx[2]+d[2]];
    });
    /* a slab sinks as far as the base and no further, and it sinks as ONE
       piece: clamp a corner on its own and the slab is no longer flat, and a
       quad that is not flat has one triangle wound against the other's normal.
       One that went under the base would carry its walls with it, upside down. */
    let low=Infinity;
    for(const p of out)if(p[1]<low)low=p[1];
    const fall=Math.min(drop,low-(S.base+0.015));   // negative lifts one the tilt sank
    for(const p of out)p[1]-=fall;
    return out;
  };
  const uvOf=(i,j,kind,run)=>{
    /* u ALONG the road and v across, which is the way the street texture is
       drawn — one tile spanning the whole cross-section, repeating in the
       direction of travel. The road surface spans its texture across the
       whole carriageway run; everything else tiles at its own real size. */
    const s0=st[i].s,s1=st[i+1].s,p=pts[j],q=pts[j+1];
    if(kind==="road"&&run){
      const w=Math.max(1e-6,run.a1-run.a0);
      const v0=(p.a-run.a0)/w,v1=(q.a-run.a0)/w;
      return [[s0/T.surface,v0],[s0/T.surface,v1],[s1/T.surface,v1],[s1/T.surface,v0]];
    }
    if(kind==="kerb"){
      const w=T.kerb,h=Math.max(0.05,T.kerbH);
      const v0=(p.a-(run?run.a0:0))/h,v1=(q.a-(run?run.a0:0))/h;
      return [[s0/w,v0],[s0/w,v1],[s1/w,v1],[s1/w,v0]];
    }
    const w=T.verge;
    return [[s0/w,p.a/w],[s0/w,q.a/w],[s1/w,q.a/w],[s1/w,p.a/w]];
  };
  const slabTop={};                          // the displaced corners, for the walls
  for(let i=0;i<nS;i++){
    let aliveHere=0;
    for(let j=0;j<nP-1;j++){
      const q=i*(nP-1)+j;
      if(!alive[q])continue;
      aliveHere++;
      const kind=pts[j].k,run=pts[j].run;
      const w=gone[q];
      const c=corner(i,j,q,w);
      slabTop[q]=c;
      const m=part(parts,kind);
      const uv=uvOf(i,j,kind,run);
      let n0,n1,n2,n3;
      if(w>0.001){const n=flatN(c[0],c[3],c[1]);n0=n1=n2=n3=n;}
      else{n0=nAt(i,j,+1);n1=nAt(i,j+1,-1);n2=nAt(i+1,j+1,-1);n3=nAt(i+1,j,+1);}
      /* wound so the face is up: (i,j) (i,j+1) (i+1,j+1) (i+1,j) seen from
         above runs across then along, which with +x right and +z forward is
         clockwise from above — and clockwise from above is anticlockwise
         from where the sky is, which is what faces it */
      quad(m,c[0],c[3],c[2],c[1],n0,n3,n2,n1,uv[0],uv[3],uv[2],uv[1]);
      census.slabs++;
      census.byKind[kind]=(census.byKind[kind]||0)+1;
    }
    census.stations.push({s:st[i].s,t:st[i].d,alive:aliveHere,of:nP-1});
  }
  census.gone=nS*(nP-1)-census.slabs;

  /* ---- walls down every open edge, and the base under every slab ---- */
  const wallUV=(a,b,top,bot)=>{
    const len=Math.hypot(b[0]-a[0],b[2]-a[2]);
    const h=Math.max(0.01,top-bot);
    return [[0,0],[len/T.verge,0],[len/T.verge,h/T.verge],[0,h/T.verge]];
  };
  const wall=(a,b,baseA,baseB)=>{
    /* a and b are the top edge left to right as seen from OUTSIDE; the wall
       faces away from the slab */
    const m=part(parts,"ground");
    const A=[a[0],baseA,a[2]],B=[b[0],baseB,b[2]];
    const n=flatN(a,b,A);
    const uv=wallUV(a,b,Math.max(a[1],b[1]),Math.min(baseA,baseB));
    if(quad(m,a,b,B,A,n,n,n,n,uv[0],uv[1],uv[2],uv[3]))census.walls++;
  };
  for(let i=0;i<nS;i++)for(let j=0;j<nP-1;j++){
    const q=i*(nP-1)+j;
    if(!alive[q])continue;
    const c=slabTop[q];
    const bA=st[i].base,bB=st[i+1].base;
    /* c[0]=(i,j) c[1]=(i,j+1) c[2]=(i+1,j+1) c[3]=(i+1,j); walls are given
       their top edge left-to-right as seen from outside the slab */
    if(!isAlive(i-1,j))wall(c[1],c[0],bA,bA);          // the start edge, seen from behind
    if(!isAlive(i+1,j))wall(c[3],c[2],bB,bB);          // the end edge, seen from ahead
    if(!isAlive(i,j-1))wall(c[0],c[3],bA,bB);          // the left edge, seen from the left
    if(!isAlive(i,j+1))wall(c[2],c[1],bB,bA);          // the right edge, seen from the right
    if(solid){
      const m=part(parts,"ground");
      const A=[c[0][0],bA,c[0][2]],B=[c[1][0],bA,c[1][2]],C=[c[2][0],bB,c[2][2]],D=[c[3][0],bB,c[3][2]];
      const n=[0,-1,0];
      const uv=[[st[i].s/T.verge,pts[j].a/T.verge],[st[i].s/T.verge,pts[j+1].a/T.verge],
                [st[i+1].s/T.verge,pts[j+1].a/T.verge],[st[i+1].s/T.verge,pts[j].a/T.verge]];
      if(quad(m,A,B,C,D,n,n,n,n,uv[0],uv[1],uv[2],uv[3]))census.base++;
    }
  }

  /* ---- rubble where the front has just passed ---- */
  if(debris>0&&dropM>=0){
    for(let i=0;i<nS;i++)for(let j=0;j<nP-1;j++){
      const q=i*(nP-1)+j;
      if(alive[q])continue;
      const t=Math.max(st[i].d,st[i+1].d);
      if(t>0.92||t<=0)continue;                // the far tail is bare ground, not rubble
      if(hashi(i,j,seed+601)>debris*0.65*(1-t*0.5))continue;
      const kind=pts[j].k;
      const c=[at(i,j),at(i,j+1),at(i+1,j+1),at(i+1,j)];
      const cx=[(c[0][0]+c[2][0])/2,0,(c[0][2]+c[2][2])/2];
      const S=st[i];
      const sz=0.25+hashi(i,j,seed+607)*0.3;
      const yaw=hashi(i,j,seed+613)*Math.PI,lean=(hashi(i,j,seed+617)-0.5)*0.5;
      const scat=(hashi(i,j,seed+619)-0.5)*1.2;
      const h=thick*(0.35+hashi(i,j,seed+623)*0.4);
      const cy=S.base+h*0.5+hashi(i,j,seed+627)*0.05;
      const px=cx[0]+S.r[0]*scat,pz=cx[2]+S.r[2]*scat;
      const cs=Math.cos(yaw),sn=Math.sin(yaw);
      const cw=(c[1][0]-c[0][0])*sz,cd=(c[3][2]-c[0][2])*sz;
      const hw=Math.max(0.12,Math.hypot(cw,cd)*0.5),hd=hw*(0.6+hashi(i,j,seed+631)*0.6);
      const P=(u,v,dy)=>[px+cs*u-sn*v,cy+dy+u*lean,pz+sn*u+cs*v];
      const top=[P(-hw,-hd,h/2),P(hw,-hd,h/2),P(hw,hd,h/2),P(-hw,hd,h/2)];
      const bot=[P(-hw,-hd,-h/2),P(hw,-hd,-h/2),P(hw,hd,-h/2),P(-hw,hd,-h/2)];
      const mt=part(parts,kind),mg=part(parts,"ground");
      const nT=flatN(top[0],top[3],top[1]);
      const uv=[[0,0],[hw*2/T.verge,0],[hw*2/T.verge,hd*2/T.verge],[0,hd*2/T.verge]];
      quad(mt,top[0],top[3],top[2],top[1],nT,nT,nT,nT,uv[0],uv[3],uv[2],uv[1]);
      for(let e=0;e<4;e++){
        const a=top[e],b=top[(e+1)%4],A=bot[e],B=bot[(e+1)%4];
        const n=flatN(b,a,A);
        quad(mg,b,a,A,B,n,n,n,n,uv[0],uv[1],[uv[1][0],h/T.verge],[0,h/T.verge]);
      }
      census.debris++;
    }
  }

  /* ---- bounds, for the stage and the readme ---- */
  let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(const k in parts)for(const m of parts[k])
    for(let i=0;i<m.pos.length;i+=3)for(let c=0;c<3;c++){
      if(m.pos[i+c]<lo[c])lo[c]=m.pos[i+c];
      if(m.pos[i+c]>hi[c])hi[c]=m.pos[i+c];
    }
  if(!(lo[0]<hi[0])){lo=[-1,-1,0];hi=[1,1,L];}
  return {
    parts:parts,census:census,
    profile:prof,path:path,stations:st,
    bounds:{lo:lo,hi:hi,w:hi[0]-lo[0],h:hi[1]-lo[1],d:hi[2]-lo[2]},
    L:L,res:res,nS:nS,nP:nP,baseY:baseY,thick:thick,
    alive:alive,tiles:T
  };
}

/* ============================ the structure ============================
   Three textures make a road: the surface, the kerb and the verge. The kerb
   and the verge are both cast concrete on purpose — a kerb IS a precast unit
   with a chamfered arris, and exposed aggregate at three metres to the panel
   reads as gravel and earth. Bare ground is the verge worn darker. */
Forge.registerStructure({
  id:"road",
  label:"Road",
  blurb:"A cross-section you draw, swept into a road that can crumble away at either end",
  road:{
    kit:{surface:"surface",kerb:"kerb",verge:"verge"}
  },
  steps:[
    {id:"surface",label:"Surface",mode:"street",set:{piece:"cross",kerb:"none"},fresh:true,
     note:"THE CARRIAGEWAY. This tile is stretched across every run of road surface in the "+
          "profile and repeats along the road at its own length, so its lanes and lines fit "+
          "whatever width you draw — the bar under the 3D view says how far the drawn "+
          "carriageway is from the tile's own width. Kerbs are geometry here, so the tile is "+
          "asked for without them."},
    {id:"kerb",label:"Kerb & paving",mode:"slab",
     set:{panWmm:915,panHmm:150,form:"smooth",tieX:0,tieY:0,lifts:false,chamMm:12,stain:0.2},fresh:true,
     note:"ONE PRECAST UNIT. A kerb is a cast concrete block with a chamfered arris, which is "+
          "exactly what this mode makes, so one panel is one kerb unit: 915 mm long, laid end "+
          "to end along the road. The footways are the same concrete tiled at the same size."},
    {id:"verge",label:"Verge & ground",mode:"slab",
     set:{panWmm:3000,panHmm:3000,form:"agg",tieX:0,tieY:0,lifts:false,chamMm:1,stain:0,
          effl:0,moss:0.25,voids:0.2,cConc:"#7d7256",cAgg:"#8a8578"},fresh:true,
     note:"THE GROUND. Exposed aggregate at three metres to the panel reads as gravel and "+
          "earth, and the same texture worn darker is the bare ground under the road — the "+
          "base you see at a broken end, the retaining wall of a causeway, the slope of a "+
          "cutting. Tint it green for a verge or brown for a track."}
  ]
});

window.ForgeRoad={
  KINDS:KINDS,KIND_ORDER:KIND_ORDER,
  PRESETS:PRESETS,preset:preset,mirror:mirror,node:node,copyNodes:copyNodes,
  resample:resample,extents:extents,
  pathOf:pathOf,decayAt:decayAt,
  build:build
};

})();
