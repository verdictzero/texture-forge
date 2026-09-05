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
  junction:{label:"Junction",tex:"junction",colour:"#4c5058",hide:true},
  kerb:  {label:"Kerb / paving",tex:"kerb",colour:"#b9b4a9"},
  verge: {label:"Verge",tex:"verge",colour:"#6e7a4b"},
  ground:{label:"Bare ground",tex:"verge",colour:"#7a6a55",tint:[0.60,0.54,0.46]}
};
const KIND_ORDER=["road","junction","kerb","verge","ground"];

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
  const A1=area2(a,b,c),A2=area2(a,c,d);
  if(A1+A2<1e-14)return false;
  const base=m.pos.length/3;
  m.pos.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2],d[0],d[1],d[2]);
  m.nrm.push(na[0],na[1],na[2],nb[0],nb[1],nb[2],nc[0],nc[1],nc[2],nd[0],nd[1],nd[2]);
  m.uv.push(ta[0],ta[1],tb[0],tb[1],tc[0],tc[1],td[0],td[1]);
  /* and a quad whose two triangles are a triangle and a line — the tip of a
     wedge — keeps only the triangle */
  if(A1>=1e-14)m.idx.push(base,base+1,base+2);
  if(A2>=1e-14)m.idx.push(base,base+2,base+3);
  return true;
}
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const nrm=v=>{const l=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/l,v[1]/l,v[2]/l];};
const add=(a,b,k)=>[a[0]+b[0]*(k===undefined?1:k),a[1]+b[1]*(k===undefined?1:k),a[2]+b[2]*(k===undefined?1:k)];
/* the flat normal of a quad, from its own corners */
function flatN(a,b,c){return nrm(cross(sub(b,a),sub(c,a)));}

/* ============================ the sweeper ============================
   One machine that sweeps A profile along SOME stations, writing into shared
   parts — because a road network is many sweeps of one profile: every link
   between junctions, and every kerbed corner where two arms of a junction
   meet, which is the profile's outer part swept round a curve. The sweeper
   holds the profile, the seed, the decay parameters and the parts; each call
   to sweep() brings its own stations and, if it wants, its own profile per
   station.

   R: {res,wobble,rough,edge,drop,debris,thick,solid,seed,nodes,decayB,kerbR}
   tiles: {surface,kerb,kerbH,verge,junction} — the real size of each texture */
function makeSweeper(R,tiles){
  const T=Object.assign({surface:7.3,kerb:0.915,kerbH:0.15,verge:3,junction:14},tiles||{});
  const nodes=R.nodes&&R.nodes.length>=2?R.nodes:preset("two_lane");
  const prof=resample(nodes);
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
  for(const p of prof.pts){if(p.y<yMin)yMin=p.y;if(Math.abs(p.x)>xMax)xMax=Math.abs(p.x);}
  const halfW=Math.max(0.5,xMax);
  const baseY=yMin-thick;
  const parts={};
  const census={slabs:0,gone:0,walls:0,base:0,debris:0,fans:0,byKind:{},stations:[],lumps:[]};
  const sweeps=[];
  const wobAt=s=>wob?(vn(s/6,0.5,seed+31)-0.5)*2*wob:0;

  /* st: [{s,p,t,r,d,base}]; ptsOf(i): the profile at station i, every station
     the same length; opts: {name,wallStart,wallEnd,wallInner,wallOuter,tag} */
  function sweep(st,ptsOf,opts){
    opts=opts||{};
    const nS=st.length-1;
    if(nS<1)return null;
    const nP=ptsOf(0).length;
    if(nP<2)return null;
    const P=ptsOf;
    const at=(i,j)=>{const S=st[i],p=P(i)[j];return [S.p[0]+S.r[0]*p.x,S.p[1]+p.y,S.p[2]+S.r[2]*p.x];};
    /* the profile's own 2D normals at station i, rotated into its frame: soft
       points average their two segments, corners keep the segment's own */
    const nCache={};
    const nOf=i=>{
      if(nCache[i])return nCache[i];
      const pts=P(i),sn=[],pn=[];
      for(let j=0;j<nP-1;j++){
        const dx=pts[j+1].x-pts[j].x,dy=pts[j+1].y-pts[j].y,l=Math.hypot(dx,dy)||1;
        sn.push([-dy/l,dx/l]);
      }
      for(let j=0;j<nP;j++){
        const a=sn[Math.max(0,j-1)],b=sn[Math.min(nP-2,j)];
        if(pts[j].soft||j===0||j===nP-1){const x=a[0]+b[0],y=a[1]+b[1],l=Math.hypot(x,y)||1;pn.push([x/l,y/l]);}
        else pn.push(null);
      }
      return (nCache[i]={sn:sn,pn:pn});
    };
    const nAt=(i,j,side)=>{
      const S=st[i],c=nOf(i);
      const n2=c.pn[j]||c.sn[clamp(side<0?j-1:j,0,nP-2)];
      return nrm([S.r[0]*n2[0],n2[1],S.r[2]*n2[0]]);
    };

    /* ---- which slabs survive ---- */
    const alive=new Uint8Array(nS*(nP-1));
    const gone=new Float32Array(nS*(nP-1));
    const cellA=1.6,cellX=1.1;
    const tagS=(opts.tag||0)*997;
    for(let i=0;i<nS;i++)for(let j=0;j<nP-1;j++){
      const t=Math.max(st[i].d,st[i+1].d);
      const pts=P(i);
      const xc=(pts[j].x+pts[j+1].x)*0.5,sc=(st[i].s+st[i+1].s)*0.5;
      const n=fb(sc/cellA+tagS,pts[j].a/cellX,seed);
      const k=clamp(0.5+(n-0.5)*rough*1.7-edge*(Math.abs(xc)/halfW)*0.42,0.02,0.98);
      const q=i*(nP-1)+j;
      alive[q]=t<k?1:0;
      gone[q]=t>0?clamp(t/k,0,1):0;
    }
    /* off the end of the grid is "alive" — no wall — where the sweep joins
       something else: a junction fan, or the corner beside it */
    const isAlive=(i,j)=>{
      if(j<0)return opts.wallInner===false?1:0;
      if(j>=nP-1)return opts.wallOuter===false?1:0;
      if(i<0)return opts.wallStart===false?1:0;
      if(i>=nS)return opts.wallEnd===false?1:0;
      return alive[i*(nP-1)+j];
    };

    /* ---- the slabs, displaced where the front has reached them ---- */
    const corner=(i,j,w)=>{
      const c=[at(i,j),at(i,j+1),at(i+1,j+1),at(i+1,j)];
      if(w<=0.001)return c;
      const h1=hashi(i+tagS,j,seed+401),h2=hashi(i+tagS,j,seed+409),h3=hashi(i+tagS,j,seed+419);
      const cx=[(c[0][0]+c[2][0])/2,(c[0][1]+c[2][1])/2,(c[0][2]+c[2][2])/2];
      /* THE CHUNKS LOSE HEIGHT AS THEY GO. The sink the bar asks for is one
         part of the drop; the other is the road's own thickness, so that by
         the time the front reaches a slab it is lying on the base as a flake
         and the shattered end runs down to nothing rather than stopping at
         full height with a cliff. */
      const drop=dropM*Math.pow(w,1.5)*(0.5+0.5*h1)+thick*w*w*0.9;
      /* the tilt is an angle, but what the eye reads is how far a corner
         lifts, and a corner lifting more than the road is thick is a slab
         standing on end — so the angle is held to what the slab's size allows */
      const hx=Math.hypot(c[1][0]-c[0][0],c[1][2]-c[0][2])*0.5||0.1;
      const hz=Math.hypot(c[3][0]-c[0][0],c[3][2]-c[0][2])*0.5||0.1;
      const lim=thick*0.8;
      const roll=clamp((h2-0.5)*0.55*w,-lim/hx,lim/hx),pitch=clamp((h3-0.5)*0.45*w,-lim/hz,lim/hz),sh=1-w*0.14;
      const S=st[i];
      const out=c.map(p=>{
        let d=sub(p,cx);
        const al=d[0]*S.t[0]+d[2]*S.t[2],ac=d[0]*S.r[0]+d[2]*S.r[2];
        const up=d[1]+ac*roll+al*pitch;
        d=[(S.t[0]*al+S.r[0]*ac)*sh,up,(S.t[2]*al+S.r[2]*ac)*sh];
        return [cx[0]+d[0],cx[1]+d[1],cx[2]+d[2]];
      });
      /* a slab sinks as far as the base and no further, and it sinks as ONE
         piece: clamp a corner on its own and the slab is no longer flat, and
         a quad that is not flat has one triangle wound against the other */
      let low=Infinity;
      for(const p of out)if(p[1]<low)low=p[1];
      const fall=Math.min(drop,low-(S.base+0.015));
      for(const p of out)p[1]-=fall;
      return out;
    };
    const uvOf=(i,j,kind,run)=>{
      /* u ALONG the road and v across, which is the way the street texture is
         drawn. The road surface spans its texture across the whole run of
         carriageway; everything else tiles at its own real size. */
      const s0=st[i].s,s1=st[i+1].s,p=P(i)[j],q=P(i)[j+1];
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
    const slabTop={};
    const stations=[];
    for(let i=0;i<nS;i++){
      let aliveHere=0;
      const pts=P(i);
      for(let j=0;j<nP-1;j++){
        const q=i*(nP-1)+j;
        if(!alive[q])continue;
        aliveHere++;
        const kind=pts[j].k,run=pts[j].run;
        const w=gone[q];
        const c=corner(i,j,w);
        slabTop[q]=c;
        const m=part(parts,kind);
        const uv=uvOf(i,j,kind,run);
        let n0,n1,n2,n3;
        if(w>0.001){const n=flatN(c[0],c[3],c[1]);n0=n1=n2=n3=n;}
        else{n0=nAt(i,j,+1);n1=nAt(i,j+1,-1);n2=nAt(i+1,j+1,-1);n3=nAt(i+1,j,+1);}
        quad(m,c[0],c[3],c[2],c[1],n0,n3,n2,n1,uv[0],uv[3],uv[2],uv[1]);
        census.slabs++;
        census.byKind[kind]=(census.byKind[kind]||0)+1;
      }
      stations.push({s:st[i].s,t:st[i].d,alive:aliveHere,of:nP-1});
    }
    census.gone+=nS*(nP-1)-stations.reduce((a,x)=>a+x.alive,0);

    /* ---- walls down every open edge, and the base under every slab ---- */
    const wallUV=(a,b,top,bot)=>{
      const len=Math.hypot(b[0]-a[0],b[2]-a[2]);
      const h=Math.max(0.01,top-bot);
      return [[0,0],[len/T.verge,0],[len/T.verge,h/T.verge],[0,h/T.verge]];
    };
    const wall=(a,b,baseA,baseB)=>{
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
      if(!isAlive(i-1,j))wall(c[1],c[0],bA,bA);
      if(!isAlive(i+1,j))wall(c[3],c[2],bB,bB);
      if(!isAlive(i,j-1))wall(c[0],c[3],bA,bB);
      if(!isAlive(i,j+1))wall(c[2],c[1],bB,bA);
      if(solid){
        const pts=P(i);
        const m=part(parts,"ground");
        const A=[c[0][0],bA,c[0][2]],B=[c[1][0],bA,c[1][2]],C=[c[2][0],bB,c[2][2]],D=[c[3][0],bB,c[3][2]];
        const n=[0,-1,0];
        const uv=[[st[i].s/T.verge,pts[j].a/T.verge],[st[i].s/T.verge,pts[j+1].a/T.verge],
                  [st[i+1].s/T.verge,pts[j+1].a/T.verge],[st[i+1].s/T.verge,pts[j].a/T.verge]];
        if(quad(m,A,B,C,D,n,n,n,n,uv[0],uv[1],uv[2],uv[3]))census.base++;
      }
    }

    /* ---- rubble where the front has just passed ----
       Two kinds of it. The slab that died leaves a lump of what it was made
       of, and on top of that the ground is strewn with BROKEN ASPHALT AND
       CONCRETE that belongs to no slab in particular — because a shattered
       road is not only its own pieces in place, it is pieces flung about,
       and some of the kerb ends up on the carriageway. Both get LOWER toward
       the end: a lump near the sound road is a slab on its side, a lump at
       the far end is a flake, and past the last station a few are flung on
       into the field. */
    const chunk=(kind,px,pz,py,hw,hd,h,yaw,lean,ragged,h1,h2)=>{
      const cs=Math.cos(yaw),sn=Math.sin(yaw);
      const Pt=(u,v,dy)=>[px+cs*u-sn*v,py+dy+u*lean,pz+sn*u+cs*v];
      /* an irregular outline: each corner pulled in by its own draw, so no
         two pieces are the same rectangle */
      const cw=[1-ragged*h1*0.5,1-ragged*h2*0.5,1-ragged*(1-h1)*0.5,1-ragged*(1-h2)*0.5];
      const top=[Pt(-hw*cw[0],-hd*cw[0],h/2),Pt(hw*cw[1],-hd*cw[1],h/2),Pt(hw*cw[2],hd*cw[2],h/2),Pt(-hw*cw[3],hd*cw[3],h/2)];
      const bot=[Pt(-hw*cw[0],-hd*cw[0],-h/2),Pt(hw*cw[1],-hd*cw[1],-h/2),Pt(hw*cw[2],hd*cw[2],-h/2),Pt(-hw*cw[3],hd*cw[3],-h/2)];
      const mt=part(parts,kind),mg=part(parts,"ground");
      const nT=flatN(top[0],top[3],top[1]);
      /* a piece wears the middle of its own texture, not the corner of it */
      const tw=kind==="road"?T.surface:(kind==="kerb"?T.kerb:T.verge);
      const uv=[[0.4,0.4],[0.4+hw*2/tw,0.4],[0.4+hw*2/tw,0.4+hd*2/tw],[0.4,0.4+hd*2/tw]];
      if(!quad(mt,top[0],top[3],top[2],top[1],nT,nT,nT,nT,uv[0],uv[3],uv[2],uv[1]))return false;
      for(let e=0;e<4;e++){
        const a=top[e],b=top[(e+1)%4],A=bot[e],B=bot[(e+1)%4];
        const n=flatN(b,a,A);
        quad(mg,b,a,A,B,n,n,n,n,uv[0],uv[1],[uv[1][0],h/T.verge],[0,h/T.verge]);
      }
      census.debris++;
      census.lumps.push({t:chunkT,h:h,k:kind});
      return true;
    };
    let chunkT=0;
    if(debris>0){
      const lastAlong=st[nS];
      for(let i=0;i<nS;i++)for(let j=0;j<nP-1;j++){
        const q=i*(nP-1)+j;
        const t=Math.max(st[i].d,st[i+1].d);
        if(t<=0)continue;
        const pts=P(i);
        const c=[at(i,j),at(i,j+1),at(i+1,j+1),at(i+1,j)];
        const cx=[(c[0][0]+c[2][0])/2,0,(c[0][2]+c[2][2])/2];
        const S=st[i];
        const low=1-t*0.78;                          // how much height is left out here
        chunkT=t;
        /* the slab's own lump, where it died */
        if(!alive[q]&&t<=0.96&&hashi(i+tagS,j,seed+601)<=debris*0.65*(1-t*0.5)){
          const kind=pts[j].k;
          const sz=0.25+hashi(i+tagS,j,seed+607)*0.3;
          const yaw=hashi(i+tagS,j,seed+613)*Math.PI,lean=(hashi(i+tagS,j,seed+617)-0.5)*0.5*low;
          const scat=(hashi(i+tagS,j,seed+619)-0.5)*1.2;
          const h=Math.max(0.02,thick*(0.35+hashi(i+tagS,j,seed+623)*0.4)*low);
          const cy=S.base+h*0.5+hashi(i+tagS,j,seed+627)*0.04;
          const cw=(c[1][0]-c[0][0])*sz,cd=(c[3][2]-c[0][2])*sz;
          const hw=Math.max(0.1,Math.hypot(cw,cd)*0.5),hd=hw*(0.6+hashi(i+tagS,j,seed+631)*0.6);
          chunk(kind,cx[0]+S.r[0]*scat,cx[2]+S.r[2]*scat,cy,hw,hd,h,yaw,lean,0.6,
                hashi(i+tagS,j,seed+641),hashi(i+tagS,j,seed+643));
        }
        /* and the strewn pieces: asphalt and concrete, anyone's, anywhere in
           the zone, more of them where the road is half gone, all of them
           low, and a few past the end */
        const strew=debris*0.55*Math.sin(Math.PI*Math.min(1,t*1.1));
        const draw=hashi(i+tagS,j,seed+701);
        if(draw<strew){
          const kind=hashi(i+tagS,j,seed+703)<0.62?"road":"kerb";
          const h=Math.max(0.02,thick*(0.15+hashi(i+tagS,j,seed+707)*0.35)*low);
          const size=0.12+hashi(i+tagS,j,seed+709)*0.45*(0.5+0.5*low);
          const sx=(hashi(i+tagS,j,seed+711)-0.5)*2.4,sz2=(hashi(i+tagS,j,seed+713)-0.5)*1.2;
          const px=cx[0]+S.r[0]*sx+S.t[0]*sz2,pz=cx[2]+S.r[2]*sx+S.t[2]*sz2;
          chunk(kind,px,pz,S.base+h*0.5+hashi(i+tagS,j,seed+717)*0.03,size,size*(0.5+hashi(i+tagS,j,seed+719)*0.8),h,
                hashi(i+tagS,j,seed+721)*Math.PI,(hashi(i+tagS,j,seed+723)-0.5)*0.35*low,0.9,
                hashi(i+tagS,j,seed+727),hashi(i+tagS,j,seed+729));
        }
        /* flung past the end: only from the last few stations, out along the
           tangent, lower still */
        if(i>=nS-3&&t>0.85&&lastAlong.d>=0.99&&hashi(i+tagS,j,seed+801)<debris*0.35){
          const kind=hashi(i+tagS,j,seed+803)<0.6?"road":"kerb";
          const out=0.5+hashi(i+tagS,j,seed+805)*6;
          const side=(hashi(i+tagS,j,seed+807)-0.5)*2;
          const h=Math.max(0.02,thick*(0.1+hashi(i+tagS,j,seed+809)*0.25)*(1-Math.min(0.85,out/8)));
          const size=0.1+hashi(i+tagS,j,seed+811)*0.3;
          const px=cx[0]+lastAlong.t[0]*out+S.r[0]*side,pz=cx[2]+lastAlong.t[2]*out+S.r[2]*side;
          chunk(kind,px,pz,lastAlong.base+h*0.5,size,size*(0.6+hashi(i+tagS,j,seed+813)*0.6),h,
                hashi(i+tagS,j,seed+815)*Math.PI,0,0.9,hashi(i+tagS,j,seed+817),hashi(i+tagS,j,seed+819));
        }
      }
    }
    const sw={name:opts.name||"sweep",st:st,alive:alive,nS:nS,nP:nP,pts:ptsOf(0),ptsOf:ptsOf,
              stations:stations,at:at,wallStart:opts.wallStart!==false,wallEnd:opts.wallEnd!==false,
              wallInner:opts.wallInner!==false,wallOuter:opts.wallOuter!==false};
    sweeps.push(sw);
    for(const x of stations)census.stations.push(x);
    return sw;
  }

  /* A FAN: the flat patch in the middle of a junction, triangulated from its
     centre to a loop of points that are exactly the ends of the arms and the
     inner edges of the corners, so nothing has to be stitched. Its texture is
     the junction tile centred on the node and turned to the first arm. */
  function tri(m,a,b,c,n,ta,tb,tc){
    if(area2(a,b,c)<1e-14)return false;
    const base=m.pos.length/3;
    m.pos.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);
    m.nrm.push(n[0],n[1],n[2],n[0],n[1],n[2],n[0],n[1],n[2]);
    m.uv.push(ta[0],ta[1],tb[0],tb[1],tc[0],tc[1]);
    m.idx.push(base,base+1,base+2);
    return true;
  }
  function fan(centre,loop,kind,rot,baseYAt){
    if(loop.length<3)return;
    const m=part(parts,kind);
    const cs=Math.cos(-rot),sn=Math.sin(-rot);
    const uv=p=>{
      const dx=p[0]-centre[0],dz=p[2]-centre[2];
      return [(dx*cs-dz*sn)/T.junction+0.5,(dx*sn+dz*cs)/T.junction+0.5];
    };
    const up=[0,1,0];
    let n=0;
    for(let k=0;k<loop.length;k++){
      const a=loop[k],b=loop[(k+1)%loop.length];
      /* wound to face the sky, whichever way the loop was walked */
      const nn=cross(sub(a,centre),sub(b,centre));
      if(nn[1]>=0){if(tri(m,centre,a,b,up,uv(centre),uv(a),uv(b)))n++;}
      else{if(tri(m,centre,b,a,up,uv(centre),uv(b),uv(a)))n++;}
    }
    census.fans++;
    if(solid&&baseYAt!==undefined){
      const mg=part(parts,"ground"),dn=[0,-1,0];
      const C=[centre[0],baseYAt,centre[2]];
      for(let k=0;k<loop.length;k++){
        const a=loop[k],b=loop[(k+1)%loop.length];
        const A=[a[0],baseYAt,a[2]],B=[b[0],baseYAt,b[2]];
        const nn=cross(sub(A,C),sub(B,C));
        if(nn[1]<=0)tri(mg,C,A,B,dn,uv(C),uv(A),uv(B));
        else tri(mg,C,B,A,dn,uv(C),uv(B),uv(A));
      }
    }
    return n;
  }

  function finish(){
    let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(const k in parts)for(const m of parts[k])
      for(let i=0;i<m.pos.length;i+=3)for(let c=0;c<3;c++){
        if(m.pos[i+c]<lo[c])lo[c]=m.pos[i+c];
        if(m.pos[i+c]>hi[c])hi[c]=m.pos[i+c];
      }
    if(!(lo[0]<hi[0])){lo=[-1,-1,0];hi=[1,1,1];}
    return {
      parts:parts,census:census,sweeps:sweeps,
      profile:prof,
      bounds:{lo:lo,hi:hi,w:hi[0]-lo[0],h:hi[1]-lo[1],d:hi[2]-lo[2]},
      baseY:baseY,thick:thick,tiles:T,halfW:halfW
    };
  }
  return {sweep:sweep,fan:fan,finish:finish,prof:prof,baseY:baseY,thick:thick,halfW:halfW,
          wobAt:wobAt,T:T,seed:seed};
}

/* ============================ one straight-or-arced road ============================
   The single path the bar's length, bend and rise describe. Kept as the
   primitive under the network below, and as the thing the engine tests build. */
function build(R,tiles){
  const W=makeSweeper(R,tiles);
  const path=pathOf(R);
  const L=path.L;
  const res=clamp(+R.res||0.5,0.1,5);
  const nS=Math.max(1,Math.ceil(L/res));
  const st=[];
  for(let i=0;i<=nS;i++){
    const s=Math.min(L,i*res);
    const f=path.at(s);
    st.push({s:s,p:[f.p[0],f.p[1]+W.wobAt(s),f.p[2]],t:f.t,r:f.r,d:decayAt(R,L,s),base:f.p[1]+W.baseY});
  }
  const sw=W.sweep(st,()=>W.prof.pts,{name:"road",wallStart:true,wallEnd:true});
  const G=W.finish();
  G.path=path;G.stations=st;G.L=L;G.res=res;G.nS=nS;G.nP=W.prof.pts.length;
  G.alive=sw?sw.alive:new Uint8Array(0);
  return G;
}

/* ============================ the network ============================
   ROUTES THROUGH NODES. A route is an ordered list of nodes and the road
   follows a centripetal Catmull-Rom spline through them, so a route with
   three nodes is a curve and one with two is a line. A node two routes share
   — or one route passes through and another ends on — is a JUNCTION: every
   route is cut there into links, each link is trimmed back from the node by
   what the angle to its neighbours needs, the carriageway in the middle is
   one flat fan wearing the junction tile, and the outer part of the profile
   is swept round a curve from each arm's edge to the next arm's, which is
   what a kerbed corner is. Free ends — nodes on one route only, at its end —
   are where the road can crumble. */
function catmull(P){
  /* centripetal Catmull-Rom through P (3D points), sampled finely; returns
     the polyline with cumulative arc length and where each node landed */
  const n=P.length;
  const out=[],S=[],nodeAt=[];
  if(n===1){out.push(P[0].slice());S.push(0);nodeAt.push(0);return {pts:out,s:S,nodeAt:nodeAt};}
  const dist=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
  const ext=(a,b)=>[a[0]*2-b[0],a[1]*2-b[1],a[2]*2-b[2]];
  /* a closed route — first node repeated at the end — wraps its phantom points
     round, so the spline is as smooth through the start as anywhere else */
  const closed=n>3&&dist(P[0],P[n-1])<1e-9;
  const Q=closed?[P[n-2]].concat(P,[P[1]]):[ext(P[0],P[1])].concat(P,[ext(P[n-1],P[n-2])]);
  let s=0;
  for(let k=0;k<n-1;k++){
    const p0=Q[k],p1=Q[k+1],p2=Q[k+2],p3=Q[k+3];
    const t0=0,t1=t0+Math.pow(Math.max(1e-6,dist(p0,p1)),0.5),
          t2=t1+Math.pow(Math.max(1e-6,dist(p1,p2)),0.5),t3=t2+Math.pow(Math.max(1e-6,dist(p2,p3)),0.5);
    const m=Math.max(8,Math.ceil(dist(p1,p2)/0.25));
    for(let i=(k===0?0:1);i<=m;i++){
      const t=t1+(t2-t1)*i/m;
      const lerp3=(a,b,ta,tb)=>{const w=(tb-ta)>1e-9?(t-ta)/(tb-ta):0;return [a[0]+(b[0]-a[0])*w,a[1]+(b[1]-a[1])*w,a[2]+(b[2]-a[2])*w];};
      const A1=lerp3(p0,p1,t0,t1),A2=lerp3(p1,p2,t1,t2),A3=lerp3(p2,p3,t2,t3);
      const B1=lerp3(A1,A2,t0,t2),B2=lerp3(A2,A3,t1,t3);
      const C=lerp3(B1,B2,t1,t2);
      if(out.length)s+=dist(out[out.length-1],C);
      out.push(C);S.push(s);
      if(i===0&&k===0)nodeAt.push(0);
      if(i===m)nodeAt.push(out.length-1);
    }
  }
  return {pts:out,s:S,nodeAt:nodeAt};
}
/* a point and heading on a sampled polyline at arc length s */
function polyAt(poly,s){
  const S=poly.s,P=poly.pts,n=P.length;
  if(n===1)return {p:P[0].slice(),t:[0,0,1]};
  let lo=0,hi=n-1;
  s=clamp(s,0,S[n-1]);
  while(hi-lo>1){const mid=(lo+hi)>>1;if(S[mid]<=s)lo=mid;else hi=mid;}
  const a=P[lo],b=P[hi],w=(S[hi]-S[lo])>1e-9?(s-S[lo])/(S[hi]-S[lo]):0;
  const p=[a[0]+(b[0]-a[0])*w,a[1]+(b[1]-a[1])*w,a[2]+(b[2]-a[2])*w];
  /* heading from a slightly wider window, so a kink in the sampling does
     not turn into a kink in the road */
  const i0=Math.max(0,lo-1),i1=Math.min(n-1,hi+1);
  let t=[P[i1][0]-P[i0][0],0,P[i1][2]-P[i0][2]];
  const l=Math.hypot(t[0],t[2])||1;t=[t[0]/l,0,t[2]/l];
  return {p:p,t:t};
}
/* stations along poly from s0 to s1, decaying over dA from the start and dB
   from the end where those are more than zero */
function stationsOf(poly,s0,s1,res,dA,dB,W){
  const L=Math.max(0.01,s1-s0);
  const nS=Math.max(1,Math.ceil(L/res));
  const st=[];
  for(let i=0;i<=nS;i++){
    const s=i*L/nS;
    const f=polyAt(poly,s0+s);
    let d=0;
    if(dA>0)d=Math.max(d,clamp(1-s/dA,0,1));
    if(dB>0)d=Math.max(d,clamp(1-(L-s)/dB,0,1));
    d=Math.pow(d,0.85);
    const r=[f.t[2],0,-f.t[0]];
    const y=f.p[1]+W.wobAt(s0+s);
    st.push({s:s,p:[f.p[0],y,f.p[2]],t:f.t,r:r,d:d,base:f.p[1]+W.baseY});
  }
  return st;
}

/* the profile's outer part on one side, as offsets outward from the
   carriageway edge — the thing a corner is made of */
function outerPortion(pts,jEdge,dir){
  /* dir +1: the right side (x ascending from pts[jEdge]); -1: the left */
  const out=[];
  const n=pts.length;
  if(dir>0){
    for(let j=jEdge;j<n;j++)out.push({o:pts[j].x-pts[jEdge].x,y:pts[j].y,k:pts[j].k,soft:pts[j].soft});
  }else{
    for(let j=jEdge;j>=0;j--)out.push({o:pts[jEdge].x-pts[j].x,y:pts[j].y,k:j>0?pts[j-1].k:pts[0].k,soft:pts[j].soft});
  }
  if(out.length<2)out.push({o:out[0].o+0.5,y:out[0].y,k:"ground",soft:false});
  let a=0;
  for(let i=0;i<out.length;i++){if(i)a+=Math.hypot(out[i].o-out[i-1].o,out[i].y-out[i-1].y);out[i].a=a;}
  return out;
}
/* the same portion at N points, spaced by arc length, so two can be blended */
function portionAt(por,N){
  const total=por[por.length-1].a;
  const out=[];
  for(let i=0;i<N;i++){
    const a=total*i/(N-1);
    let k=0;while(k<por.length-2&&por[k+1].a<a)k++;
    const p=por[k],q=por[k+1],w=(q.a-p.a)>1e-9?(a-p.a)/(q.a-p.a):0;
    out.push({o:p.o+(q.o-p.o)*w,y:p.y+(q.y-p.y)*w,k:p.k,soft:true,a:a});
  }
  return out;
}

const NET_PRESETS=[
  {id:"straight",label:"Straight",make:()=>({nodes:[{x:0,z:0},{x:0,z:60}],routes:[[0,1]]})},
  {id:"curve",label:"Curve",make:()=>({nodes:[{x:0,z:0},{x:6,z:30},{x:28,z:52}],routes:[[0,1,2]]})},
  {id:"cross",label:"Crossroads",make:()=>({nodes:[{x:0,z:-40},{x:0,z:0},{x:0,z:40},{x:-40,z:0},{x:40,z:0}],
    routes:[[0,1,2],[3,1,4]]})},
  {id:"tee",label:"T-junction",make:()=>({nodes:[{x:-40,z:0},{x:0,z:0},{x:40,z:0},{x:0,z:40}],
    routes:[[0,1,2],[1,3]]})},
  {id:"fork",label:"Fork",make:()=>({nodes:[{x:0,z:-40},{x:0,z:0},{x:-24,z:40},{x:24,z:40}],
    routes:[[0,1,2],[1,3]]})},
  {id:"grid",label:"Grid",make:()=>({nodes:[{x:-40,z:-40},{x:0,z:-40},{x:40,z:-40},{x:-40,z:0},{x:0,z:0},{x:40,z:0},
    {x:-40,z:40},{x:0,z:40},{x:40,z:40}],
    routes:[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8]]})},
  {id:"loop",label:"Loop road",make:()=>({nodes:[{x:0,z:0},{x:30,z:8},{x:36,z:40},{x:6,z:52},{x:-20,z:30}],
    routes:[[0,1,2,3,4,0]]})}
];
function netPreset(id){
  const p=NET_PRESETS.find(x=>x.id===id)||NET_PRESETS[0];
  return p.make();
}

function buildNet(R,tiles){
  const W=makeSweeper(R,tiles);
  const net=R.net&&R.net.nodes&&R.net.nodes.length>=2&&R.net.routes&&R.net.routes.length?R.net:netPreset("straight");
  const N=net.nodes,routes=net.routes.filter(r=>r&&r.length>=2);
  const res=clamp(+R.res||0.5,0.1,5);
  const pts=W.prof.pts,nP=pts.length;
  const crumbleDefault=Math.max(0,+R.decayB||0);
  /* THE KERB RADIUS IS AT LEAST WHAT THE FOOTWAY NEEDS. The footway and verge
     behind the kerb sweep round the corner on the outside of its curve, and a
     curve tighter than they are deep folds them over themselves — so the
     radius asked for is a minimum, and the depth of the profile outside the
     carriageway sets the rest. A big junction is what a wide verge costs. */
  const outerDepth=(()=>{
    let jl=-1,jr=-1;
    for(let j=0;j<pts.length-1;j++)if(pts[j].k==="road"){if(jl<0)jl=j;jr=j+1;}
    if(jl<0)return 0;
    return Math.max(pts[jl].x-pts[0].x,pts[pts.length-1].x-pts[jr].x,0);
  })();
  const kerbR=Math.max(clamp(+R.kerbR||4,0.5,30),outerDepth*1.45);
  /* the carriageway span of the profile: from the first road run to the last */
  let jL=-1,jR=-1;
  for(let j=0;j<nP-1;j++)if(pts[j].k==="road"){if(jL<0)jL=j;jR=j+1;}
  if(jL<0){jL=0;jR=nP-1;}
  const roadL=pts[jL].x,roadR=pts[jR].x;
  const Rout=Math.max(Math.abs(roadL),Math.abs(roadR),0.5);

  /* ---- who is a junction ---- */
  const ends=new Array(N.length).fill(0),thru=new Array(N.length).fill(0);
  for(const r of routes){
    for(let k=0;k<r.length;k++){
      const closed=r[0]===r[r.length-1]&&r.length>2;
      if(k===0||k===r.length-1){if(closed&&k===r.length-1)continue;if(closed)thru[r[k]]++;else ends[r[k]]++;}
      else thru[r[k]]++;
    }
  }
  const arms=N.map((n,i)=>ends[i]+thru[i]*2);
  const isJ=N.map((n,i)=>arms[i]>=3||(arms[i]===2&&ends[i]===2));
  const isFree=N.map((n,i)=>arms[i]===1);

  /* ---- the routes as splines, cut into links at junctions ---- */
  const links=[];
  for(let ri=0;ri<routes.length;ri++){
    const r=routes[ri];
    const P=r.map(i=>[N[i].x,+N[i].y||0,N[i].z]);
    const poly=catmull(P);
    let k0=0;
    for(let k=1;k<r.length;k++){
      const junction=isJ[r[k]]||k===r.length-1;
      if(!junction)continue;
      const i0=poly.nodeAt[k0],i1=poly.nodeAt[k];
      if(i1>i0){
        const sub={pts:poly.pts.slice(i0,i1+1),s:poly.s.slice(i0,i1+1).map(v=>v-poly.s[i0])};
        links.push({a:r[k0],b:r[k],poly:sub,L:sub.s[sub.s.length-1],route:ri,tA:0,tB:0});
      }
      k0=k;
    }
  }
  /* ---- the arms of each junction, and how far back each is trimmed ---- */
  const junctions=[];
  const dirAt=(link,atA)=>{
    const P=link.poly.pts,n=P.length;
    const a=atA?P[0]:P[n-1],b=atA?P[Math.min(n-1,3)]:P[Math.max(0,n-4)];
    const d=[b[0]-a[0],0,b[2]-a[2]],l=Math.hypot(d[0],d[2])||1;
    return [d[0]/l,0,d[2]/l];
  };
  for(let ni=0;ni<N.length;ni++){
    if(!isJ[ni])continue;
    const A=[];
    for(let li=0;li<links.length;li++){
      const lk=links[li];
      if(lk.a===ni)A.push({link:li,atA:true,out:dirAt(lk,true)});
      if(lk.b===ni)A.push({link:li,atA:false,out:dirAt(lk,false)});
    }
    if(A.length<2)continue;
    for(const a of A)a.ang=Math.atan2(a.out[2],a.out[0]);
    A.sort((p,q)=>p.ang-q.ang);
    /* the trim: where two arms' outer edges would cross, plus the kerb radius */
    for(let k=0;k<A.length;k++){
      const a=A[k];
      let t=Rout*0.6;
      for(const nb of [A[(k+1)%A.length],A[(k+A.length-1)%A.length]]){
        if(nb===a)continue;
        let th=Math.abs(nb.ang-a.ang);
        th=Math.min(th,Math.PI*2-th);
        th=Math.max(th,Math.PI/12);
        t=Math.max(t,Rout/Math.tan(th/2)+kerbR);
      }
      a.trim=Math.min(t,Rout*12);
    }
    /* AND THEN THE CORNERS ARE TRIED. Between two arms at an acute angle
       the curve from one edge to the next is tighter than the formula above
       allows for, so each corner's curve is drawn in advance off the trims as
       they stand, its tightest radius measured, and both arms pushed back
       until the footway fits round it. */
    /* the radius grows with the trim, near enough linearly, so the shortfall
       says how much further back to go — held to a few passes and to six
       carriageway half-widths, because past that the pinch behind the kerb
       is the better answer and a junction the size of a field is not */
    const oMaxNeed=outerDepth*1.1;
    if(oMaxNeed>0)for(let pass=0;pass<3;pass++){
      let pushed=false;
      /* every corner is measured on the trims AS THEY STAND, and each arm
         takes the larger of what its two corners ask — all at once, so a
         symmetric junction is pushed back symmetrically rather than by
         whichever corner happened to be looked at first */
      const need=A.map(()=>1);
      for(let k=0;k<A.length;k++){
        const a=A[k],b=A[(k+1)%A.length];
        if(A.length<2||a===b)continue;
        const la=links[a.link],lb=links[b.link];
        const fa=polyAt(la.poly,a.atA?a.trim:la.L-a.trim),fb=polyAt(lb.poly,b.atA?b.trim:lb.L-b.trim);
        const ra=a.atA?[fa.t[2],0,-fa.t[0]]:[-fa.t[2],0,fa.t[0]];   // this arm's right, looking out
        const rb=b.atA?[fb.t[2],0,-fb.t[0]]:[-fb.t[2],0,fb.t[0]];
        const P0=[fa.p[0]-ra[0]*Rout,0,fa.p[2]-ra[2]*Rout];      // a's left edge
        const P1=[fb.p[0]+rb[0]*Rout,0,fb.p[2]+rb[2]*Rout];      // b's right edge
        const d0=a.out,d1=b.out;
        const den=d0[0]*d1[2]-d0[2]*d1[0];
        if(Math.abs(den)<1e-6)continue;
        const dx=P1[0]-P0[0],dz=P1[2]-P0[2];
        const u=(dx*d1[2]-dz*d1[0])/den,v=(dx*d0[2]-dz*d0[0])/den;
        if(!(u<0&&v<0))continue;
        const X=[P0[0]+d0[0]*u,0,P0[2]+d0[2]*u];
        const ddx=2*(P1[0]-2*X[0]+P0[0]),ddz=2*(P1[2]-2*X[2]+P0[2]);
        let rMin=Infinity;
        for(let q=0;q<=16;q++){
          const w=q/16,m=1-w;
          const d=[2*m*(X[0]-P0[0])+2*w*(P1[0]-X[0]),0,2*m*(X[2]-P0[2])+2*w*(P1[2]-X[2])];
          const sp=Math.hypot(d[0],d[2]);
          const kk=Math.abs(d[0]*ddz-d[2]*ddx)/Math.max(1e-9,sp*sp*sp);
          if(kk>1e-6)rMin=Math.min(rMin,1/kk);
        }
        if(rMin<oMaxNeed){
          const g=Math.min(1.5,Math.max(1.05,oMaxNeed/Math.max(rMin,1e-3)));
          need[k]=Math.max(need[k],g);need[(k+1)%A.length]=Math.max(need[(k+1)%A.length],g);
        }
      }
      for(let k=0;k<A.length;k++){
        const t=Math.min(A[k].trim*need[k],Rout*6);
        if(t>A[k].trim+1e-6)pushed=true;
        A[k].trim=t;
      }
      if(!pushed)break;
    }
    for(const a of A){
      const lk=links[a.link];
      if(a.atA)lk.tA=Math.max(lk.tA,a.trim);else lk.tB=Math.max(lk.tB,a.trim);
    }
    junctions.push({node:ni,arms:A,p:[N[ni].x,+N[ni].y||0,N[ni].z]});
  }
  /* a link too short for its trims keeps a little of itself */
  for(const lk of links){
    const room=lk.L-res;
    if(lk.tA+lk.tB>room){const k=Math.max(0,room)/(lk.tA+lk.tB||1);lk.tA*=k;lk.tB*=k;}
  }

  /* ---- sweep every link ---- */
  const crumbleOf=ni=>{const c=N[ni].crumble;return (c===undefined||c===null||c==="")?crumbleDefault:Math.max(0,+c);};
  for(let li=0;li<links.length;li++){
    const lk=links[li];
    const freeA=isFree[lk.a],freeB=isFree[lk.b];
    const st=stationsOf(lk.poly,lk.tA,lk.L-lk.tB,res,freeA?crumbleOf(lk.a):0,freeB?crumbleOf(lk.b):0,W);
    lk.sw=W.sweep(st,()=>pts,{name:"link"+li,tag:li+1,
      wallStart:!isJ[lk.a],wallEnd:!isJ[lk.b]});
  }

  /* ---- the junctions: corners between arms, and the fan between corners ---- */
  const porL=outerPortion(pts,jL,-1),porR=outerPortion(pts,jR,+1);
  const NPOR=Math.max(porL.length,porR.length,4);
  const PL=portionAt(porL,NPOR),PR=portionAt(porR,NPOR);
  for(const J of junctions){
    const C=J.p;
    /* each arm's end: its station at the junction, and which way is left */
    for(const a of J.arms){
      const sw=links[a.link].sw;
      if(!sw){a.dead=true;continue;}
      const i=a.atA?0:sw.nS;
      const S=sw.st[i];
      a.S=S;
      /* seen from the junction looking out along the arm: for a link leaving
         here its right is the sweep's right; for one arriving it is the left */
      a.right=a.atA?S.r:[-S.r[0],0,-S.r[2]];
      const xL=a.atA?roadL:roadR,xR=a.atA?roadR:roadL;
      a.edgeL=[S.p[0]+S.r[0]*xL,S.p[1],S.p[2]+S.r[2]*xL];
      a.edgeR=[S.p[0]+S.r[0]*xR,S.p[1],S.p[2]+S.r[2]*xR];
      a.yL=pts[a.atA?jL:jR].y;a.yR=pts[a.atA?jR:jL].y;
      /* the road points across the arm, from its right edge to its left */
      const js=[];
      if(a.atA)for(let j=jR;j>=jL;j--)js.push(j);else for(let j=jL;j<=jR;j++)js.push(j);
      a.roadPts=js.map(j=>sw.at(i,j));
      a.porL=a.atA?PL:PR;a.porR=a.atA?PR:PL;
    }
    const live=J.arms.filter(a=>!a.dead);
    if(live.length<2)continue;
    const loop=[];
    for(let k=0;k<live.length;k++){
      const a=live[k],b=live[(k+1)%live.length];
      for(const p of a.roadPts)loop.push(p);
      /* the corner: a curve from this arm's left edge to the next arm's right
         edge, bulging toward where their edge lines cross */
      const P0=a.edgeL,P1=b.edgeR;
      const d0=a.out,d1=b.out;
      const den=d0[0]*d1[2]-d0[2]*d1[0];
      let ctl=null;
      if(Math.abs(den)>1e-6){
        const dx=P1[0]-P0[0],dz=P1[2]-P0[2];
        const u=(dx*d1[2]-dz*d1[0])/den,v=(dx*d0[2]-dz*d0[0])/den;
        if(u<0&&v<0){
          const X=[P0[0]+d0[0]*u,(P0[1]+P1[1])/2,P0[2]+d0[2]*u];
          if(Math.hypot(X[0]-C[0],X[2]-C[2])<Rout*10)ctl=X;
        }
      }
      if(!ctl){
        const mid=[(P0[0]+P1[0])/2,(P0[1]+P1[1])/2,(P0[2]+P1[2])/2];
        ctl=[mid[0]+(C[0]-mid[0])*0.3,mid[1],mid[2]+(C[2]-mid[2])*0.3];
      }
      const bez=u=>{const w=1-u;return [w*w*P0[0]+2*w*u*ctl[0]+u*u*P1[0],w*w*P0[1]+2*w*u*ctl[1]+u*u*P1[1],w*w*P0[2]+2*w*u*ctl[2]+u*u*P1[2]];};
      const dbez=u=>{const w=1-u;return [2*w*(ctl[0]-P0[0])+2*u*(P1[0]-ctl[0]),0,2*w*(ctl[2]-P0[2])+2*u*(P1[2]-ctl[2])];};
      /* THE FOOTWAY CANNOT SWEEP PAST THE CENTRE OF ITS OWN CURVE. The kerb
         line round a corner turns on a radius of a couple of metres and the
         footway and verge behind it are three or four metres deep, so swept
         outward they would cross over themselves and come out inside out. So
         at each station the outer part is held to the radius of curvature
         there: the corner pinches to a wedge behind the kerb, which is what
         the corner of a block is. */
      const ddx=2*(P1[0]-2*ctl[0]+P0[0]),ddz=2*(P1[2]-2*ctl[2]+P0[2]);
      const radiusAt=u=>{
        const d=dbez(u),sp=Math.hypot(d[0],d[2]);
        const k=Math.abs(d[0]*ddz-d[2]*ddx)/Math.max(1e-9,sp*sp*sp);
        return k>1e-6?1/k:Infinity;
      };
      let len=0,prev=P0;
      for(let q=1;q<=16;q++){const p=bez(q/16);len+=Math.hypot(p[0]-prev[0],p[2]-prev[2]);prev=p;}
      const nC=Math.max(3,Math.ceil(len/res));
      /* walked so the sweep's right hand points away from the junction: the
         profile's outer part must land outside, or the corner faces down */
      const t0=nrm(dbez(0)),r0=[t0[2],0,-t0[0]];
      const outward=(r0[0]*(P0[0]-C[0])+r0[2]*(P0[2]-C[2]))>=0;
      const st=[];
      for(let q=0;q<=nC;q++){
        const u=outward?q/nC:1-q/nC;
        const p=bez(u);
        let t=dbez(u);
        if(!outward)t=[-t[0],0,-t[2]];
        t=nrm(t);
        if(!(Math.hypot(t[0],t[2])>0))t=[0,0,1];
        st.push({s:q*len/nC,p:p,t:t,r:[t[2],0,-t[0]],d:0,base:p[1]+W.baseY,u:u,rho:radiusAt(u)*0.92});
      }
      const kinds=a.porL;
      const ptsOf=i=>{
        const u=st[i].u,rho=st[i].rho,arr=[];
        /* scaled as a WHOLE rather than clipped point by point: a clipped
           portion stacks its last points on one spot with their heights
           still apart, which is a vertical sliver twisted against its own
           normal; a scaled one keeps its shape and only gets narrower */
        const oMax=Math.max(1e-6,a.porL[NPOR-1].o+(b.porR[NPOR-1].o-a.porL[NPOR-1].o)*u);
        const f=Math.min(1,rho/oMax);
        for(let m=0;m<NPOR;m++){
          const A=a.porL[m],B=b.porR[m];
          arr.push({x:(A.o+(B.o-A.o)*u)*f,y:A.y+(B.y-A.y)*u,k:kinds[m].k,soft:true,a:(A.a+(B.a-A.a)*u)*f,run:null});
        }
        return arr;
      };
      const csw=W.sweep(st,ptsOf,{name:"corner",tag:100+junctions.indexOf(J)*8+k,
        wallStart:false,wallEnd:false,wallInner:false,wallOuter:true});
      /* the corner's inner edge joins the fan; walked in the loop's direction */
      const inner=[];
      for(let q=0;q<=nC;q++){const S=st[q];inner.push([S.p[0],S.p[1]+a.yL+(b.yR-a.yL)*S.u,S.p[2]]);}
      if(!outward)inner.reverse();
      for(let q=1;q<inner.length-1;q++)loop.push(inner[q]);
      J.corners=(J.corners||0)+1;
    }
    /* the fan: the carriageway across the whole junction, at the crown */
    let ym=0;for(let j=jL;j<=jR;j++)ym+=pts[j].y;ym/=(jR-jL+1);
    const centre=[C[0],C[1]+ym,C[2]];
    W.fan(centre,loop,"junction",live[0].ang,C[1]+W.baseY);
    J.loop=loop.length;
    J.loopPts=loop;
  }

  const G=W.finish();
  G.links=links.map(lk=>({a:lk.a,b:lk.b,L:lk.L,tA:lk.tA,tB:lk.tB,sw:lk.sw,poly:lk.poly}));
  G.junctions=junctions.map(J=>({node:J.node,arms:J.arms.length,corners:J.corners||0,loop:J.loop||0,
                                 trim:J.arms.map(a=>a.trim),loopPts:J.loopPts||[],p:J.p}));
  G.net={nodes:N,routes:routes,isJ:isJ,isFree:isFree,arms:arms};
  G.res=res;G.nP=nP;
  let L=0;for(const lk of links)L+=lk.L;
  G.L=L;
  return G;
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
    kit:{surface:"surface",junction:"junction",kerb:"kerb",verge:"verge"}
  },
  steps:[
    {id:"surface",label:"Surface",mode:"street",set:{piece:"cross",kerb:"none"},fresh:true,
     note:"THE CARRIAGEWAY. This tile is stretched across every run of road surface in the "+
          "profile and repeats along the road at its own length, so its lanes and lines fit "+
          "whatever width you draw — the bar under the 3D view says how far the drawn "+
          "carriageway is from the tile's own width. Kerbs are geometry here, so the tile is "+
          "asked for without them."},
    {id:"junction",label:"· junction",mode:"street",set:{piece:"inter",kerb:"none"},
     note:"THE FOUR-WAY, laid flat across every junction in the plan and turned to its first "+
          "arm. It inherits the surface's lanes and lines, so what runs into it meets what it "+
          "meets. A three-way wears the same tile; the fan is cut to the arms it actually has."},
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
  build:build,buildNet:buildNet,catmull:catmull,polyAt:polyAt,
  NET_PRESETS:NET_PRESETS,netPreset:netPreset
};

})();
