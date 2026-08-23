/* =====================================================================
   MODE: ruins — seamless ruin-stone plating with etched circuitry
   =====================================================================
   Rectilinear and L-shaped plates on a wrapping grid, seam gaps, junction
   bores wherever three or more plates meet, and one of eight routing
   patterns etched into every plate face. Tiles seamlessly in both axes.

   Ported from plating_fabricator.html. The drawing and the derivation maths
   are the tool's, unchanged, so a seed and a settings set produce the same
   surface here as there: two canvas passes over one geometry RNG stream
   (flat colour, then greyscale height) that register texel for texel, with
   normal, AO, roughness and the pre-lit bake all derived per texel from the
   height field.

   What changed is the plumbing. The passes are time-sliced so a 2048 build
   cannot freeze the tab, the byte packers are the runtime's, and the tool's
   interactive Blinn-Phong view became an exported `prelit` channel — the
   runtime owns the draggable light, but nothing in it can bake a texture for
   an unlit shader, so that one is worth keeping.

   Everything geometric is quoted at a 512 px reference and multiplied by
   scale = res/512, which is why the layout, the routing grid and every path
   are identical at 512, 1024 and 2048 — only the sampling of them changes.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,mulberry32=Forge.mulberry32;
const clamp01=v=>clamp(v,0,1);
/* the lattice fraction is always in [0,1), so the tool's own smooth() is
   exactly the shared kernel */
const smooth=t=>smoothstep(0,1,t);
function clampByte(v){ v=Math.round(v); return v<0?0:(v>255?255:v); }
/* the lifted drawing code wants {r,g,b}; the runtime hands out [r,g,b] */
function hexToRgb(hex){ const c=Forge.hex2rgb(hex); return {r:c[0],g:c[1],b:c[2]}; }
function shuffle(arr, rand){
  for (let i=arr.length-1;i>0;i--){
    const j = Math.floor(rand()*(i+1));
    const t = arr[i]; arr[i]=arr[j]; arr[j]=t;
  }
  return arr;
}
/* No willReadFrequently: the two render targets take thousands of stroke,
   fill and clip calls and exactly one readback each, so an accelerated
   canvas is the right trade — and one readback per canvas is also what keeps
   Chrome from warning about repeated getImageData. The stone base is written
   once by putImageData and never read back at all; its ImageData is kept
   instead, which is the roughness pass's luminance term. */
function newCanvas(res){
  const c = document.createElement('canvas');
  c.width = res; c.height = res;
  return c;
}

// ---------- seamless periodic noise ----------
function makePeriodicNoise(rand, gridSize, res){
  const lat = [];
  for (let y=0;y<gridSize;y++){
    const row = [];
    for (let x=0;x<gridSize;x++) row.push(rand());
    lat.push(row);
  }
  return function(px,py){
    const gx=(px/res)*gridSize, gy=(py/res)*gridSize;
    const x0=Math.floor(gx), y0=Math.floor(gy);
    const xa=((x0%gridSize)+gridSize)%gridSize, ya=((y0%gridSize)+gridSize)%gridSize;
    const xb=(xa+1)%gridSize, yb=(ya+1)%gridSize;
    const sx=smooth(gx-x0), sy=smooth(gy-y0);
    return lerp(lerp(lat[ya][xa],lat[ya][xb],sx), lerp(lat[yb][xa],lat[yb][xb],sx), sy);
  };
}

/* the tool's accent pair drove its own CSS and is dropped: setting
   --accent on documentElement would repaint the whole Forge shell */
const THEMES = {
  ashen:     { dark:'#6b7073', light:'#dde0dc', plate:'#c6cbc7', plateAlt:'#b2b7b4' },
  verdigris: { dark:'#6a5638', light:'#d8c49a', plate:'#c9b48c', plateAlt:'#b5a077' },
  gunmetal:  { dark:'#4a5257', light:'#c4ced3', plate:'#b3bdc2', plateAlt:'#9fa9ae' },
  obsidian:  { dark:'#4a3a2c', light:'#c2a888', plate:'#b39a7c', plateAlt:'#9e8669' }
};

/* ============================ stone base ============================
   makeBaseCanvas (359-379) with the row loop exposed so it can be banded.
   A flat stone colour field — pure material variation, no directional
   shading — used three ways: the colour underlay, a 10 % micro-relief layer
   inside each plate in the height pass, and the luminance term in
   roughness. It draws one rand() per texel, so the fine dither reshuffles
   between resolutions even though the structure does not. */
function makeBase(res, theme, rand, weather){
  const c = newCanvas(res), ctx = c.getContext('2d');
  const nA = makePeriodicNoise(rand,5,res), nB = makePeriodicNoise(rand,11,res);
  const img = ctx.createImageData(res,res), d = img.data;
  const dark = hexToRgb(theme.dark), light = hexToRgb(theme.light);
  const contrast = 1 + (1-weather)*0.6;
  return {
    canvas:c, data:d,
    rows:function(y0,y1){
      for (let y=y0;y<y1;y++){
        for (let x=0;x<res;x++){
          let n = nA(x,y)*0.6 + nB(x,y)*0.4;
          n = Math.pow(clamp01(n), contrast);
          const v = clamp01(n + (rand()-0.5)*0.14*(0.4+weather));
          const i = (y*res+x)*4;
          d[i]   = clampByte(lerp(dark.r, light.r, v));
          d[i+1] = clampByte(lerp(dark.g, light.g, v));
          d[i+2] = clampByte(lerp(dark.b, light.b, v));
          d[i+3] = 255;
        }
      }
    },
    commit:function(){ ctx.putImageData(img,0,0); }
  };
}

// ---------- plate boundaries ----------
function makeBoundaries(total, avg, rand){
  const steps=[]; let sum=0, guard=0;
  while (sum<total && guard<80){ steps.push(avg*(0.55+rand()*0.9)); sum+=steps[steps.length-1]; guard++; }
  if (!steps.length) steps.push(total);
  const k = total/sum, bounds=[0]; let acc=0;
  for (let i=0;i<steps.length-1;i++){ acc+=steps[i]*k; bounds.push(acc); }
  bounds.push(total);
  return bounds;
}

// ---------- polygon geometry ----------
function rectPts(x0,y0,x1,y1){ return [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]; }

function lPts(b, omit){
  const {x0,xm,x1,y0,ym,y1}=b;
  if (omit==='tl') return [{x:xm,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1},{x:x0,y:ym},{x:xm,y:ym}];
  if (omit==='tr') return [{x:x0,y:y0},{x:xm,y:y0},{x:xm,y:ym},{x:x1,y:ym},{x:x1,y:y1},{x:x0,y:y1}];
  if (omit==='bl') return [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:xm,y:y1},{x:xm,y:ym},{x:x0,y:ym}];
  return [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:ym},{x:xm,y:ym},{x:xm,y:y1},{x:x0,y:y1}];
}

function insetRectilinear(pts, g){
  const n=pts.length, edges=[];
  for (let i=0;i<n;i++){
    const a=pts[i], b=pts[(i+1)%n];
    const dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy)||1;
    edges.push({ ox:-(dy/len)*g, oy:(dx/len)*g, vertical:Math.abs(dx)<1e-6 });
  }
  const out=[];
  for (let i=0;i<n;i++){
    const prev=edges[(i-1+n)%n], cur=edges[i];
    if (cur.vertical) out.push({x:pts[i].x+cur.ox, y:pts[i].y+prev.oy});
    else              out.push({x:pts[i].x+prev.ox, y:pts[i].y+cur.oy});
  }
  return out;
}

function signedArea(pts){
  let a=0;
  for (let i=0,j=pts.length-1;i<pts.length;j=i++) a += pts[j].x*pts[i].y - pts[i].x*pts[j].y;
  return a/2;
}

function pointInPoly(pts,x,y){
  let inside=false;
  for (let i=0,j=pts.length-1;i<pts.length;j=i++){
    const xi=pts[i].x, yi=pts[i].y, xj=pts[j].x, yj=pts[j].y;
    if (((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}

function bboxOf(pts){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  pts.forEach(p=>{
    if(p.x<x0)x0=p.x; if(p.x>x1)x1=p.x;
    if(p.y<y0)y0=p.y; if(p.y>y1)y1=p.y;
  });
  return {x:x0,y:y0,w:x1-x0,h:y1-y0};
}

// Edges whose outward normal faces the key light. Only used when baking
// lighting into the colour pass for the legacy pipeline.
function litEdges(pts, sx, sy){
  const n = pts.length, segs = [];
  for (let i=0;i<n;i++){
    const a = pts[i], b = pts[(i+1)%n];
    const dx = b.x-a.x, dy = b.y-a.y;
    const len = Math.hypot(dx,dy) || 1;
    if ((dy/len)*sx + (-dx/len)*sy > 0.3) segs.push([a,b]);
  }
  return segs;
}

function pathFromPts(ctx,pts){
  ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
  for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
}

// ---------- line rendering ----------
// Both passes draw identical geometry; only the paint differs. The albedo
// pass lays down flat material tint with no directional shading — all
// relief is carried by the height pass and read back out as normals.
function etchedStroke(ctx, buildPath, W, scale, P){
  ctx.save();
  ctx.lineCap='round'; ctx.lineJoin='round';
  if (P.mode==='height'){
    // Asymmetry widens the shoulder on one side only, giving a gentle ramp
    // there and a sharp wall opposite. Offsetting each tier by half the
    // extra width keeps the channel floor centred on the path.
    const ex = P.bevelBias * 3.2 * scale;
    if (ex > 0.01){
      ctx.strokeStyle = P.ramp;
      ctx.lineWidth = W + 2.4*scale + ex*2;
      ctx.save(); ctx.translate(P.bx*ex, P.by*ex); buildPath(ctx); ctx.stroke(); ctx.restore();
    }
    ctx.strokeStyle = P.shoulder;
    ctx.lineWidth = W + 2.4*scale;
    ctx.save(); ctx.translate(P.bx*ex*0.5, P.by*ex*0.5); buildPath(ctx); ctx.stroke(); ctx.restore();
    ctx.strokeStyle = P.floor;
    ctx.lineWidth = W;
    buildPath(ctx); ctx.stroke();
  } else if (P.baked){
    // Four passes bake the groove: a bright rim surviving as a flange on
    // both flanks, occlusion on the wall nearest the light, the dark
    // channel floor, and a grazing highlight on the far lip.
    // P.inv is -1 when embossed, which swaps the shaded and lit walls —
    // that swap is the whole visual difference between a cut and a ridge.
    const o = 0.9*scale, iv = P.inv;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = W + 2.6*scale;
    buildPath(ctx); ctx.stroke();

    ctx.strokeStyle = 'rgba(0,0,0,0.42)';
    ctx.lineWidth = W + 1.1*scale;
    ctx.save(); ctx.translate(P.sx*o*0.5*iv, P.sy*o*0.5*iv); buildPath(ctx); ctx.stroke(); ctx.restore();

    ctx.strokeStyle = P.inv<0 ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.9)';
    ctx.lineWidth = W;
    buildPath(ctx); ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = Math.max(0.7, W*0.2);
    ctx.save(); ctx.translate(-P.sx*o*0.7*iv, -P.sy*o*0.7*iv); buildPath(ctx); ctx.stroke(); ctx.restore();
  } else if (P.tint > 0){
    ctx.strokeStyle = 'rgba(0,0,0,'+P.tint.toFixed(3)+')';
    ctx.lineWidth = W;
    buildPath(ctx); ctx.stroke();
  }
  ctx.restore();
}

function collapseCollinear(pts){
  if (pts.length<3) return pts.slice();
  const out=[pts[0]];
  for (let i=1;i<pts.length-1;i++){
    const a=out[out.length-1], b=pts[i], c=pts[i+1];
    if (Math.abs((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x))>1e-6) out.push(b);
  }
  out.push(pts[pts.length-1]);
  return out;
}

function roundedPath(pts, maxR){
  return function(ctx){
    ctx.beginPath();
    if (pts.length===1){ ctx.moveTo(pts[0].x,pts[0].y); ctx.lineTo(pts[0].x,pts[0].y); return; }
    ctx.moveTo(pts[0].x,pts[0].y);
    for (let i=1;i<pts.length-1;i++){
      const a=pts[i-1], b=pts[i], c=pts[i+1];
      const d1=Math.hypot(b.x-a.x,b.y-a.y), d2=Math.hypot(c.x-b.x,c.y-b.y);
      ctx.arcTo(b.x,b.y,c.x,c.y, Math.min(maxR,d1*0.5,d2*0.5));
    }
    const l=pts[pts.length-1]; ctx.lineTo(l.x,l.y);
  };
}

function arcPath(x,y,r,a0,a1){ return function(ctx){ ctx.beginPath(); ctx.arc(x,y,r,a0,a1); }; }

function drawVia(ctx,x,y,r,P){
  ctx.save();
  if (P.mode==='height'){
    ctx.fillStyle = P.shoulder;
    ctx.beginPath(); ctx.arc(x,y,r*1.25,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = P.viaFloor;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  } else if (P.baked){
    const iv=P.inv;
    const grad = ctx.createRadialGradient(x+P.sx*r*0.25*iv, y+P.sy*r*0.25*iv, 0, x, y, r);
    if (iv<0){
      grad.addColorStop(0,'rgba(255,255,255,0.34)');
      grad.addColorStop(1,'rgba(0,0,0,0.5)');
    } else {
      grad.addColorStop(0,'rgba(0,0,0,0.92)');
      grad.addColorStop(1,'rgba(0,0,0,0.64)');
    }
    ctx.beginPath(); ctx.fillStyle=grad; ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.28)';
    ctx.lineWidth=Math.max(0.7,r*0.3);
    const away=Math.atan2(-P.sy*iv,-P.sx*iv);
    ctx.beginPath(); ctx.arc(x,y,r*0.78, away-Math.PI*0.375, away+Math.PI*0.375); ctx.stroke();
  } else if (P.tint>0){
    ctx.fillStyle = 'rgba(0,0,0,'+Math.min(1,P.tint*1.3).toFixed(3)+')';
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

// A bore sits where seam gaps cross. It is drawn at every wrapped offset so
// a bore straddling the tile edge rejoins its other half when tiled.
function boreOffsets(x, y, rim, res){
  const out = [];
  for (let oy=-res; oy<=res; oy+=res){
    for (let ox=-res; ox<=res; ox+=res){
      const bx=x+ox, by=y+oy;
      if (bx < -rim || bx > res+rim || by < -rim || by > res+rim) continue;
      out.push([bx,by]);
    }
  }
  return out;
}

function drawBore(ctx, b, res, P, params){
  const rim = b.r*1.35;
  boreOffsets(b.x, b.y, rim, res).forEach(([bx,by])=>{
    if (P.mode==='height'){
      // Funnel wall: mid grey at the lip falling to black at the floor.
      const g = ctx.createRadialGradient(bx,by,b.r*0.5,bx,by,rim);
      g.addColorStop(0, P.bore);
      g.addColorStop(1, P.boreRim);
      ctx.beginPath(); ctx.fillStyle=g; ctx.arc(bx,by,rim,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.fillStyle=P.bore; ctx.arc(bx,by,b.r*0.5,0,Math.PI*2); ctx.fill();
    } else if (P.baked){
      const grad=ctx.createRadialGradient(bx+P.sx*b.r*0.3, by+P.sy*b.r*0.3, b.r*0.2, bx, by, rim);
      grad.addColorStop(0,'rgba(0,0,0,0.95)');
      grad.addColorStop(0.7,'rgba(0,0,0,0.75)');
      grad.addColorStop(1,'rgba(0,0,0,0.25)');
      ctx.beginPath(); ctx.fillStyle=grad; ctx.arc(bx,by,rim,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,0.3)';
      ctx.lineWidth=Math.max(0.8, b.r*0.16);
      const away=Math.atan2(-P.sy,-P.sx);
      ctx.beginPath(); ctx.arc(bx,by,rim*0.86, away-Math.PI*0.4, away+Math.PI*0.4); ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.fillStyle='rgba(0,0,0,'+Math.min(0.85,0.3+params.grooveTint).toFixed(3)+')';
      ctx.arc(bx,by,rim,0,Math.PI*2); ctx.fill();
      ctx.beginPath();
      ctx.fillStyle='rgba(0,0,0,0.4)';
      ctx.arc(bx,by,b.r*0.55,0,Math.PI*2); ctx.fill();
    }
  });
}

// Shortest separation on a torus, so avoidance works across the tile edge.
function wrapDist2(x1,y1,x2,y2,res){
  let dx=Math.abs(x1-x2), dy=Math.abs(y1-y2);
  dx=Math.min(dx,res-dx); dy=Math.min(dy,res-dy);
  return dx*dx+dy*dy;
}

// ---------- routing grid ----------
function buildGrid(poly, bb, scale, params, bores, res){
  let pitch = params.tracePitch*scale;
  let cols = Math.floor(bb.w/pitch), rows = Math.floor(bb.h/pitch);
  if (cols<3||rows<3){ pitch*=0.6; cols=Math.floor(bb.w/pitch); rows=Math.floor(bb.h/pitch); }
  if (cols<2||rows<2) return null;
  const W = pitch*params.traceWidth;
  const clear = W*0.5 + 2.4*scale;
  const ox = bb.x + (bb.w-(cols-1)*pitch)/2;
  const oy = bb.y + (bb.h-(rows-1)*pitch)/2;
  const occ = Array.from({length:rows},()=>new Array(cols).fill(false));
  let free=0;
  for (let r=0;r<rows;r++){
    for (let c=0;c<cols;c++){
      const x=ox+c*pitch, y=oy+r*pitch;
      let ok = pointInPoly(poly,x,y) &&
        pointInPoly(poly,x-clear,y-clear) && pointInPoly(poly,x+clear,y-clear) &&
        pointInPoly(poly,x-clear,y+clear) && pointInPoly(poly,x+clear,y+clear);
      if (ok && bores){
        for (const b of bores){
          const keep = b.r*1.35 + clear;
          if (wrapDist2(x,y,b.x,b.y,res) < keep*keep){ ok=false; break; }
        }
      }
      if (!ok) occ[r][c]=true; else free++;
    }
  }
  if (free<4) return null;
  return { pitch, W, cols, rows, occ, maxR:pitch*0.85, cx:c=>ox+c*pitch, cy:r=>oy+r*pitch };
}

const DIRS=[[1,0],[0,1],[-1,0],[0,-1]];

// ---------- generators ----------
function genRouted(g, rand, density){
  const paths=[], order=[];
  for (let r=0;r<g.rows;r++) for (let c=0;c<g.cols;c++) order.push([c,r]);
  shuffle(order, rand);
  const skip=(1-density)*0.45;
  for (const [c0,r0] of order){
    if (g.occ[r0][c0]) continue;
    if (rand()<skip) continue;
    const path=[[c0,r0]]; g.occ[r0][c0]=true;
    let dir=Math.floor(rand()*4);
    const maxLen=8+Math.floor(rand()*30);
    for (let s=0;s<maxLen;s++){
      const [pc,pr]=path[path.length-1];
      const ord = rand()<0.74 ? [dir,(dir+1)%4,(dir+3)%4] : [(dir+1)%4,(dir+3)%4,dir];
      let moved=false;
      for (const d of ord){
        const nc=pc+DIRS[d][0], nr=pr+DIRS[d][1];
        if (nc<0||nr<0||nc>=g.cols||nr>=g.rows) continue;
        if (g.occ[nr][nc]) continue;
        g.occ[nr][nc]=true; path.push([nc,nr]); dir=d; moved=true; break;
      }
      if (!moved) break;
    }
    if (path.length>1) paths.push(path);
  }
  return paths;
}

function genSerpentine(g, rand){
  const horiz=rand()<0.5, paths=[]; let cur=[];
  const outer=horiz?g.rows:g.cols, inner=horiz?g.cols:g.rows;
  for (let a=0;a<outer;a++){
    const rev=a%2===1;
    for (let b0=0;b0<inner;b0++){
      const b=rev?inner-1-b0:b0;
      const c=horiz?b:a, r=horiz?a:b;
      if (g.occ[r][c]){ if(cur.length>1) paths.push(cur); cur=[]; continue; }
      g.occ[r][c]=true; cur.push([c,r]);
    }
  }
  if (cur.length>1) paths.push(cur);
  return paths;
}

function genSpiral(g){
  let sc=-1,sr=-1;
  for (let r=0;r<g.rows&&sr<0;r++) for (let c=0;c<g.cols;c++){ if(!g.occ[r][c]){sc=c;sr=r;break;} }
  if (sc<0) return [];
  let c=sc,r=sr,d=0,turns=0;
  const path=[[c,r]]; g.occ[r][c]=true;
  while (turns<4){
    const nc=c+DIRS[d][0], nr=r+DIRS[d][1];
    if (nc>=0&&nr>=0&&nc<g.cols&&nr<g.rows&&!g.occ[nr][nc]){
      c=nc;r=nr;g.occ[r][c]=true;path.push([c,r]);turns=0;
    } else { d=(d+1)%4; turns++; }
  }
  return path.length>1?[path]:[];
}

function genBus(g, rand, density){
  const vertical=rand()<0.5, paths=[];
  const lines=vertical?g.cols:g.rows, span=vertical?g.rows:g.cols;
  for (let i=0;i<lines;i++){
    if (rand()>0.35+density*0.65) continue;
    let best=null, run=null;
    for (let j=0;j<=span;j++){
      const c=vertical?i:j, r=vertical?j:i;
      const blocked = j===span || g.occ[r][c];
      if (blocked){ if(run&&(!best||run.len>best.len)) best=run; run=null; }
      else if (!run) run={start:j,len:1};
      else run.len++;
    }
    if (!best||best.len<3) continue;
    let s=best.start, e=best.start+best.len-1;
    s+=Math.floor(rand()*Math.min(3,Math.floor(best.len/3)));
    e-=Math.floor(rand()*Math.min(3,Math.floor(best.len/3)));
    if (e-s<2) continue;
    const path=[];
    for (let j=s;j<=e;j++){
      const c=vertical?i:j, r=vertical?j:i;
      g.occ[r][c]=true; path.push([c,r]);
    }
    paths.push(path);
  }
  return paths;
}

function genNodes(g, rand, density){
  const pads=[];
  for (let r=1;r<g.rows-1;r++){
    for (let c=1;c<g.cols-1;c++){
      if (g.occ[r][c]) continue;
      if (rand()>0.1+density*0.16) continue;
      let clash=false;
      for (const p of pads){ if (Math.abs(p[0]-c)<2 && Math.abs(p[1]-r)<2){ clash=true; break; } }
      if (clash) continue;
      pads.push([c,r]); g.occ[r][c]=true;
    }
  }
  const paths=[];
  for (let i=0;i<pads.length;i++){
    for (let j=i+1;j<pads.length;j++){
      const [c1,r1]=pads[i], [c2,r2]=pads[j];
      const dist=Math.abs(c1-c2)+Math.abs(r1-r2);
      if (dist<2||dist>7) continue;
      if (rand()>0.4) continue;
      paths.push([[c1,r1],[c2,r1],[c2,r2]]);
      break;
    }
  }
  return { paths, pads };
}

function genLabyrinth(g, rand){
  let sc=-1,sr=-1;
  for (let r=0;r<g.rows&&sr<0;r++) for (let c=0;c<g.cols;c++){ if(!g.occ[r][c]){sc=c;sr=r;break;} }
  if (sc<0) return [];
  const paths=[], stack=[[sc,sr]];
  g.occ[sr][sc]=true;
  let run=[[sc,sr]];
  while (stack.length){
    const [c,r]=stack[stack.length-1];
    const opts=[];
    for (let d=0;d<4;d++){
      const nc=c+DIRS[d][0], nr=r+DIRS[d][1];
      if (nc<0||nr<0||nc>=g.cols||nr>=g.rows) continue;
      if (g.occ[nr][nc]) continue;
      opts.push([nc,nr]);
    }
    if (opts.length){
      const [nc,nr]=opts[Math.floor(rand()*opts.length)];
      g.occ[nr][nc]=true;
      if (run.length && (run[run.length-1][0]!==c||run[run.length-1][1]!==r)){
        if (run.length>1) paths.push(run);
        run=[[c,r]];
      }
      run.push([nc,nr]); stack.push([nc,nr]);
    } else {
      stack.pop();
      if (run.length>1){ paths.push(run); run=[]; }
      if (stack.length) run=[stack[stack.length-1]];
    }
  }
  if (run.length>1) paths.push(run);
  return paths;
}

function drawConcentric(ctx, poly, scale, rand, params, P){
  const pitch=params.tracePitch*scale, W=pitch*params.traceWidth;
  const sign=Math.sign(signedArea(poly));
  let cur=poly;
  for (let i=0;i<40;i++){
    cur = insetRectilinear(cur, i===0 ? pitch*0.85 : pitch);
    const bb=bboxOf(cur);
    if (bb.w<pitch*1.6||bb.h<pitch*1.6) break;
    if (Math.sign(signedArea(cur))!==sign) break;
    if (!cur.every(p=>pointInPoly(poly,p.x,p.y))) break;
    const n=cur.length, s=Math.floor(rand()*n), seq=[];
    for (let k=0;k<=n;k++) seq.push(cur[(s+k)%n]);
    const d0=Math.hypot(seq[1].x-seq[0].x,seq[1].y-seq[0].y)||1;
    const dn=Math.hypot(seq[n].x-seq[n-1].x,seq[n].y-seq[n-1].y)||1;
    const gap=Math.min(pitch*1.4, d0*0.4);
    seq[0]={x:lerp(seq[0].x,seq[1].x,gap/d0), y:lerp(seq[0].y,seq[1].y,gap/d0)};
    seq[n]={x:lerp(seq[n].x,seq[n-1].x,gap/dn), y:lerp(seq[n].y,seq[n-1].y,gap/dn)};
    etchedStroke(ctx, roundedPath(collapseCollinear(seq), pitch*0.9), W, scale, P);
  }
}

function drawRadial(ctx, g, scale, rand, P){
  const cc=Math.floor(g.cols/2), cr=Math.floor(g.rows/2);
  const x=g.cx(cc), y=g.cy(cr);
  const maxR=Math.min(g.cols,g.rows)*g.pitch*0.42;
  if (maxR<g.pitch*1.2) return [];
  const rings=2+Math.floor(rand()*3);
  for (let i=0;i<rings;i++){
    const rr=maxR*(1-i*0.28);
    if (rr<g.W) continue;
    const a0=rand()*Math.PI*2;
    etchedStroke(ctx, arcPath(x,y,rr,a0,a0+Math.PI*(1.05+rand()*0.8)), g.W, scale, P);
  }
  drawVia(ctx,x,y,Math.max(1.8*scale,maxR*0.2),P);
  const bR=Math.ceil(maxR/g.pitch)+1;
  for (let r=Math.max(0,cr-bR);r<Math.min(g.rows,cr+bR+1);r++)
    for (let c=Math.max(0,cc-bR);c<Math.min(g.cols,cc+bR+1);c++) g.occ[r][c]=true;
  const spokes=[];
  for (let d=0;d<4;d++){
    if (rand()<0.2) continue;
    const path=[];
    for (let k=bR;k<Math.max(g.cols,g.rows);k++){
      const c=cc+DIRS[d][0]*k, r=cr+DIRS[d][1]*k;
      if (c<0||r<0||c>=g.cols||r>=g.rows) break;
      if (g.occ[r][c]) break;
      g.occ[r][c]=true; path.push([c,r]);
    }
    if (path.length>1) spokes.push(path);
  }
  return spokes;
}

const PATTERNS=['routed','serpentine','spiral','concentric','bus','radial','nodes','labyrinth'];

function drawCircuitFill(ctx, poly, bb, rand, scale, params, P, bores, res){
  const pattern = params.pattern==='mixed'
    ? PATTERNS[Math.floor(rand()*PATTERNS.length)] : params.pattern;
  if (pattern==='concentric'){ drawConcentric(ctx,poly,scale,rand,params,P); return; }
  const g = buildGrid(poly, bb, scale, params, bores, res);
  if (!g) return;
  let paths=[], pads=[];
  if (pattern==='routed')          paths=genRouted(g,rand,params.fillDensity);
  else if (pattern==='serpentine') paths=genSerpentine(g,rand);
  else if (pattern==='spiral')     paths=genSpiral(g);
  else if (pattern==='bus')        paths=genBus(g,rand,params.fillDensity);
  else if (pattern==='labyrinth')  paths=genLabyrinth(g,rand);
  else if (pattern==='radial')     paths=drawRadial(ctx,g,scale,rand,P);
  else if (pattern==='nodes'){
    const nd=genNodes(g,rand,params.fillDensity);
    paths=nd.paths; pads=nd.pads;
  }
  paths.forEach(cells=>{
    const pts=collapseCollinear(cells.map(([c,r])=>({x:g.cx(c),y:g.cy(r)})));
    etchedStroke(ctx, roundedPath(pts,g.maxR), g.W, scale, P);
    if (rand()<params.viaFreq*0.55) drawVia(ctx,pts[0].x,pts[0].y,g.W*0.85,P);
    if (rand()<params.viaFreq*0.55){
      const e=pts[pts.length-1]; drawVia(ctx,e.x,e.y,g.W*0.85,P);
    }
  });
  pads.forEach(([c,r])=>drawVia(ctx,g.cx(c),g.cy(r),g.W*1.05,P));
  for (let r=0;r<g.rows;r++){
    for (let c=0;c<g.cols;c++){
      if (g.occ[r][c]) continue;
      if (rand()<params.viaFreq*0.06) drawVia(ctx,g.cx(c),g.cy(r),g.W*0.75,P);
    }
  }
}

/* The full-canvas blit below looks like the obvious thing to clip to the
   plate bbox — with the smallest plate scale it is ~170 plates x 4 Mpx at
   2048, nearly all of it thrown away by the clip. Measured, it is not worth
   it: an accelerated canvas already bounds the raster work by the clip, so
   the src-rect form times the same at every size, and it is NOT byte
   identical above 512 — the offset-source path rounds the 10 % height blend
   differently and the height field comes back 1 LSB off. Parity wins. */

// ---------- plates ----------
function drawPlate(ctx, baseCanvas, rawPts, theme, rand, params, scale, P, bores, res){
  const g = params.seamGap*scale*0.5;
  const outline = insetRectilinear(rawPts, g);
  const bb = bboxOf(outline);
  // Both passes must consume the same random draws so geometry registers.
  const jitter = 0.85 + rand()*0.3;
  const useAlt = rand()<0.5;
  if (bb.w < 6*scale || bb.h < 6*scale) return;

  ctx.save();
  pathFromPts(ctx,outline); ctx.closePath(); ctx.clip();
  if (P.mode==='height'){
    ctx.fillStyle = P.top;
    ctx.fillRect(bb.x,bb.y,bb.w,bb.h);
    // A whisper of stone grain as micro-relief.
    ctx.globalAlpha = 0.10;
    ctx.drawImage(baseCanvas,0,0);
    ctx.globalAlpha = 1;
  } else {
    ctx.drawImage(baseCanvas,0,0);
    const rgb = hexToRgb(useAlt ? theme.plateAlt : theme.plate);
    ctx.globalCompositeOperation='multiply';
    ctx.globalAlpha=0.9;
    ctx.fillStyle='rgb('+clampByte(rgb.r*jitter)+','+clampByte(rgb.g*jitter)+','+clampByte(rgb.b*jitter)+')';
    ctx.fillRect(bb.x,bb.y,bb.w,bb.h);
  }
  ctx.restore();

  if (P.baked){
    // Inner shadow just inside the lip so the seam reads as depth.
    ctx.save();
    pathFromPts(ctx,outline); ctx.closePath(); ctx.clip();
    ctx.lineJoin='round';
    ctx.strokeStyle='rgba(0,0,0,0.5)';
    ctx.lineWidth=3*scale;
    pathFromPts(ctx,outline); ctx.closePath(); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.lineWidth=Math.max(1,scale);
    ctx.strokeStyle='rgba(0,0,0,0.6)';
    pathFromPts(ctx,outline); ctx.closePath(); ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,0.12)';
    litEdges(outline,P.sx,P.sy).forEach(([a,b])=>{
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    });
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(outline[0].x, outline[0].y);
  for (let i=1;i<outline.length;i++) ctx.lineTo(outline[i].x, outline[i].y);
  ctx.closePath();
  if (bores && bores.length){
    bores.forEach(b=>{
      const rim = b.r*1.35;
      boreOffsets(b.x,b.y,rim,res).forEach(([bx,by])=>{
        if (bx < bb.x-rim || bx > bb.x+bb.w+rim || by < bb.y-rim || by > bb.y+bb.h+rim) return;
        ctx.moveTo(bx+rim, by);
        ctx.arc(bx,by,rim,0,Math.PI*2);
      });
    });
  }
  ctx.clip('evenodd');
  drawCircuitFill(ctx,outline,bb,rand,scale,params,P,bores,res);
  ctx.restore();
}

/* ============================ layout ============================
   drawPlates (961-1017) split in two: the layout draws are consumed here,
   up front, and the per-plate draws are time-sliced afterwards. The SAME
   rand closure has to thread through both halves and through every plate in
   index order, or the height pass stops registering with the colour pass.

   makeBoundaries closes exactly on `res`, which is what makes the grid wrap
   — and it puts the tile edge in the middle of a seam gap. Worth knowing
   when reading a seam test: the sharpest crease in the normal map is a gap
   floor, and the one on the wrap sits at the worst possible sub-texel phase
   (dead centre between two texels) while interior gaps land wherever they
   land. The field is still exactly periodic; the wrap step just measures a
   level or two above the sharpest interior one instead of below it. */
function planPlates(res, params, rand){
  const scale=res/512;
  const colB=makeBoundaries(res,params.panelSize*scale,rand);
  const rowB=makeBoundaries(res,params.panelSize*scale,rand);
  const nC=colB.length-1, nR=rowB.length-1;
  const taken=Array.from({length:nR},()=>new Array(nC).fill(false));
  const owner=Array.from({length:nR},()=>new Array(nC).fill(-1));
  const shapes=[];
  const QUAD=['tl','tr','bl','br'];
  for (let j=0;j<nR-1;j++){
    for (let i=0;i<nC-1;i++){
      if (rand()>=params.lFrequency*0.4) continue;
      if (taken[j][i]||taken[j][i+1]||taken[j+1][i]||taken[j+1][i+1]) continue;
      const omit=QUAD[Math.floor(rand()*4)];
      taken[j][i]=omit!=='tl'; taken[j][i+1]=omit!=='tr';
      taken[j+1][i]=omit!=='bl'; taken[j+1][i+1]=omit!=='br';
      const id=shapes.length;
      if (omit!=='tl') owner[j][i]=id;
      if (omit!=='tr') owner[j][i+1]=id;
      if (omit!=='bl') owner[j+1][i]=id;
      if (omit!=='br') owner[j+1][i+1]=id;
      shapes.push(lPts({x0:colB[i],xm:colB[i+1],x1:colB[i+2],y0:rowB[j],ym:rowB[j+1],y1:rowB[j+2]},omit));
    }
  }
  for (let j=0;j<nR;j++) for (let i=0;i<nC;i++){
    if (taken[j][i]) continue;
    owner[j][i]=shapes.length;
    shapes.push(rectPts(colB[i],rowB[j],colB[i+1],rowB[j+1]));
  }

  // A grid node only counts as a gap intersection when three or more
  // distinct plates meet there. That test naturally excludes an L-plate's
  // inner corner, where one plate wraps three of the four quadrants and no
  // seam actually crosses.
  const bores=[];
  if (params.boreFreq>0){
    const rad=(params.boreSize + params.seamGap*0.5)*scale;
    const wrapC=i=>((i%nC)+nC)%nC, wrapR=j=>((j%nR)+nR)%nR;
    for (let j=0;j<nR;j++){
      for (let i=0;i<nC;i++){
        const quad=[
          owner[wrapR(j-1)][wrapC(i-1)], owner[wrapR(j-1)][wrapC(i)],
          owner[wrapR(j)][wrapC(i-1)],   owner[wrapR(j)][wrapC(i)]
        ];
        let distinct=0;
        for (let k=0;k<4;k++){ if (quad.indexOf(quad[k])===k) distinct++; }
        if (distinct<3) continue;
        if (rand()>=params.boreFreq) continue;
        bores.push({x:colB[i], y:rowB[j], r:rad});
      }
    }
  }
  return { shapes:shapes, bores:bores };
}

/* Geometry RNG is separate from the stone-texture RNG, so both passes can
   share one base canvas and still replay the identical plate layout. */
function geomSeed(seed){ return (Math.imul(seed>>>0, 2654435761) ^ 0x5bf03635) >>> 0; }

/* renderPass (1023-1054) minus the drawing, so the plates can be sliced.
   `baked` is an argument instead of the tool's params.pipeline==='legacy':
   it reaches nothing but the paint descriptor, and every baked branch below
   changes paint only, never a rand() call, so the pre-lit pass consumes the
   identical stream and registers with the other two texel for texel. */
function passSetup(res, seed, theme, params, baseCanvas, mode, baked){
  const canvas = newCanvas(res), ctx = canvas.getContext('2d');
  const rand = mulberry32(geomSeed(seed));
  // Screen-space direction pointing toward the light, used to place every
  // baked shadow and highlight so the pre-lit texture honours Light Angle.
  const az = params.lightAngle*Math.PI/180;
  const sx = Math.cos(az), sy = -Math.sin(az);
  const emb = params.bevelMode==='embossed';
  const bdir = params.bevelDir*Math.PI/180;
  // Embossed simply reverses the level ordering: the trace becomes the
  // highest surface instead of the lowest, with the plate field dropped to
  // leave headroom. Every derived map follows from height, so inverting
  // here inverts the normal, AO and roughness for free.
  const hp = emb
    ? { mode:'height', top:'#8a8a8a', ramp:'#a8a8a8', shoulder:'#cdcdcd', floor:'#f2f2f2', viaFloor:'#ffffff', bore:'#000000', boreRim:'#5a5a5a' }
    : { mode:'height', top:'#c8c8c8', ramp:'#a2a2a2', shoulder:'#7d7d7d', floor:'#3a3a3a', viaFloor:'#2c2c2c', bore:'#000000', boreRim:'#8a8a8a' };
  hp.bevelBias = params.bevelBias;
  hp.bx = Math.cos(bdir); hp.by = -Math.sin(bdir);
  const P = mode==='height'
    ? hp
    : { mode:'albedo', baked:baked, tint: params.grooveTint, sx:sx, sy:sy, inv: emb ? -1 : 1 };
  if (mode==='height'){
    ctx.fillStyle='#1e1e1e'; ctx.fillRect(0,0,res,res);
    // Plate tops are painted per-plate from P.top below.
  } else {
    ctx.drawImage(baseCanvas,0,0);
    // Pre-lit wants a genuinely dark seam bed; flat-lit only wants the
    // material darkening, since depth is carried by the normal map.
    ctx.fillStyle = baked ? 'rgba(0,0,0,0.74)' : 'rgba(0,0,0,0.45)';
    ctx.fillRect(0,0,res,res);
  }
  return { canvas:canvas, ctx:ctx, rand:rand, P:P };
}

/* ============================ height derivation ============================
   The tool's blurWrap (1065-1092) with its row and column loops exposed.
   Wrapped separable box blur on a sliding running sum, in place on `a` with
   `b` as scratch: rows are independent of one another and so are columns,
   so banding it is bit-identical to the single-shot version. Wrapping is
   what keeps the derived normal and AO seamless.

   NOTE this is not Forge.blurWrap — different signature, and it mutates. */
function blurRadius(radius,res){
  // A window wider than the tile would double-count wrapped samples.
  return Math.max(1, Math.min(Math.round(radius), (res-1)>>1));
}
function blurH(a,b,res,r,y0,y1){
  const norm = 1/(2*r+1);
  for (let y=y0;y<y1;y++){
    const row = y*res;
    let sum = 0;
    for (let k=-r;k<=r;k++) sum += a[row + ((k%res)+res)%res];
    for (let x=0;x<res;x++){
      b[row+x] = sum*norm;
      sum += a[row + ((x+r+1)%res)] - a[row + (((x-r)%res)+res)%res];
    }
  }
}
function blurV(b,a,res,r,x0,x1){
  const norm = 1/(2*r+1);
  for (let x=x0;x<x1;x++){
    let sum = 0;
    for (let k=-r;k<=r;k++) sum += b[(((k%res)+res)%res)*res + x];
    for (let y=0;y<res;y++){
      a[y*res+x] = sum*norm;
      sum += b[((y+r+1)%res)*res + x] - b[((((y-r)%res)+res)%res)*res + x];
    }
  }
}

/* normalCanvas (1140-1163) with the canvas thrown away: the same 3x3 Sobel
   over the wrapped, blurred height, written straight into the stride-3
   buffer. Deliberately NOT the central difference the other modes use —
   normalStrength is calibrated against this kernel with no xS term, and
   swapping kernels would flatten or blow out the relief at every
   resolution. dx is -dh/du and dy is -dh/dv in a y-down image, i.e. OpenGL
   green-up while flipG is false. */
function normalsInto(h, res, strength, flipG, NRM, y0, y1){
  const at = (x,y)=> h[((((y%res)+res)%res))*res + (((x%res)+res)%res)];
  for (let y=y0;y<y1;y++){
    for (let x=0;x<res;x++){
      const tl=at(x-1,y-1), t=at(x,y-1), tr=at(x+1,y-1);
      const l =at(x-1,y),               r=at(x+1,y);
      const bl=at(x-1,y+1), b=at(x,y+1), br=at(x+1,y+1);
      const dx = (tl + 2*l + bl) - (tr + 2*r + br);
      const dy = (tl + 2*t + tr) - (bl + 2*b + br);
      let nx = dx*strength, ny = dy*strength, nz = 1;
      if (flipG) ny = -ny;
      const len = Math.hypot(nx,ny,nz) || 1;
      const i = (y*res+x)*3;
      NRM[i]   = clampByte((nx/len*0.5+0.5)*255);
      NRM[i+1] = clampByte((ny/len*0.5+0.5)*255);
      NRM[i+2] = clampByte((nz/len*0.5+0.5)*255);
    }
  }
}

/* ============================ pre-lit bake ============================
   shadeCanvas (1173-1213) writing into a channel instead of a preview. The
   runtime's GGX view already replaces it as a preview; what the runtime
   cannot do is bake a diffuse texture for an unlit or legacy shader, and
   that is genuinely lost otherwise.

   Roughness -> Blinn-Phong exponent, tabulated once: per pixel it was two
   Math.pow calls, which dominated the cost. */
const SHIN_LUT = new Float32Array(65);
for (let k=0;k<65;k++) SHIN_LUT[k] = Math.pow(2, 1+(1-k/64)*9);

/* The green flip is applied twice on purpose — once when the normal is
   written, once here — so the bake looks the same whichever normal format
   the user exports. */
function shadeSetup(params){
  const az = params.lightAngle*Math.PI/180, el = params.lightHeight*Math.PI/180;
  const ce = Math.cos(el);
  const lx = ce*Math.cos(az), ly = ce*Math.sin(az), lz = Math.sin(el);
  // Half-vector against a head-on viewer at (0,0,1).
  let hx=lx, hy=ly, hz=lz+1;
  const hn = Math.hypot(hx,hy,hz)||1; hx/=hn; hy/=hn; hz/=hn;
  return { lx:lx, ly:ly, lz:lz, hx:hx, hy:hy, hz:hz,
           flip: params.flipG ? -1 : 1, metal:params.metallic,
           amb:params.ambient, spK:params.specular };
}
function prelitInto(A, NRM, rough, ao, L, PRE, i0, i1){
  const lx=L.lx, ly=L.ly, lz=L.lz, hx=L.hx, hy=L.hy, hz=L.hz;
  const flip=L.flip, metal=L.metal, amb=L.amb, spK=L.spK;
  for (let i=i0;i<i1;i++){
    const o=i*3;
    const nx = NRM[o]*0.00784313725-1;
    const ny = (NRM[o+1]*0.00784313725-1)*flip;
    const nz = NRM[o+2]*0.00784313725-1;
    let ndl = nx*lx+ny*ly+nz*lz; if (ndl<0) ndl=0;
    const rg = rough[i];
    let sp = 0;
    if (spK>0 && rg<0.995){
      const ndh = nx*hx+ny*hy+nz*hz;
      if (ndh>0.25) sp = Math.pow(ndh, SHIN_LUT[(rg*64)|0])*(1-rg)*spK;
    }
    const lightAmt = amb*ao[i] + ndl;
    const ar=A[o]*0.00392156862, ag=A[o+1]*0.00392156862, ab=A[o+2]*0.00392156862;
    // Dielectrics take a white highlight; metals tint it by albedo.
    const r=(ar*lightAmt + sp*(1+(ar-1)*metal))*255;
    const g=(ag*lightAmt + sp*(1+(ag-1)*metal))*255;
    const b=(ab*lightAmt + sp*(1+(ab-1)*metal))*255;
    PRE[o]   = r<0?0:(r>255?255:r);
    PRE[o+1] = g<0?0:(g>255?255:g);
    PRE[o+2] = b<0?0:(b>255?255:b);
  }
}

/* ============================ the build ============================
   generateMaps (1218-1256) turned into a chunked build. Order of operations
   is unchanged; only the yields are new. */
function build(params,io){
  /* The runtime keeps writing into the live parameter object while a build
     is in flight, and a 2048 build spans hundreds of ticks. A slider nudged
     between the colour pass and the height pass would change the geometry
     under us and destroy their registration, so work from a snapshot. */
  const Q=Object.assign({},params);
  const res=io.W, N=res*res, scale=res/512, seed=Q.seed|0;
  const theme=THEMES[Q.theme]||THEMES.ashen;
  const painted=Q.prelit==="painted";

  const A=new Uint8ClampedArray(N*3), NRM=new Uint8ClampedArray(N*3), PRE=new Uint8ClampedArray(N*3);
  const RGH=new Uint8ClampedArray(N), MET=new Uint8ClampedArray(N), AO=new Uint8ClampedArray(N);
  let h=null,tmp=null,wide=null,aoF=null,roughF=null;
  let base=null,pass=null,plan=null,rb=null,shade=null;
  let hMin=Infinity,hMax=-Infinity;

  /* One job is one slice of work. The driver runs jobs until its budget is
     spent and then yields, which keeps the tab and the progress bar alive
     without paying a 4 ms timer clamp per band. */
  const jobs=[];
  const push=(fn,p)=>{jobs.push([fn,p]);};
  const band=Math.max(8,Math.round(65536/res));
  function slice(total,step,lo,hi,fn){
    const n=Math.ceil(total/step);
    for(let k=0;k<n;k++){
      const a=k*step,b=Math.min(total,a+step);
      push(function(){fn(a,b);}, lo+(k+1)/n*(hi-lo));
    }
  }
  /* the plate list does not exist until its pass has been set up, so those
     jobs are spliced in front of whatever is still queued */
  function inject(list){ for(let i=list.length-1;i>=0;i--) jobs.unshift(list[i]); }
  function drawJobs(lo,hi){
    const ps=pass, pl=plan, out=[], n=(pl.shapes.length+pl.bores.length)||1;
    pl.shapes.forEach(function(pts,k){
      out.push([function(){ drawPlate(ps.ctx,base.canvas,pts,theme,ps.rand,Q,scale,ps.P,pl.bores,res); },
                lo+(k+1)/n*(hi-lo)]);
    });
    pl.bores.forEach(function(b,k){
      out.push([function(){ drawBore(ps.ctx,b,res,ps.P,Q); },
                lo+(pl.shapes.length+k+1)/n*(hi-lo)]);
    });
    inject(out);
  }
  /* One getImageData per canvas, then the copy in bands. The whole-canvas
     read is one atomic ~75 ms at 2048 and cannot be split without Chrome
     warning about repeated reads on an accelerated canvas — and marking the
     target willReadFrequently would move it to a different rasteriser,
     which is exactly what must not change. Every other tick is under 30 ms. */
  function readInto(dst,stride,lo,hi){
    push(function(){ rb=pass.ctx.getImageData(0,0,res,res).data; }, lo);
    slice(res,band,lo,hi,function(y0,y1){
      for(let i=y0*res;i<y1*res;i++){
        const o=i*stride, q=i*4;
        dst[o]=rb[q]; dst[o+1]=rb[q+1]; dst[o+2]=rb[q+2];
      }
    });
    push(function(){ pass.canvas.width=0; pass=null; rb=null; }, hi);
  }
  const getH=function(){return h;}, getWide=function(){return wide;};
  function queueBlur(get,radius,passes,lo,hi){
    const r=blurRadius(radius,res), span=(hi-lo)/(passes*2);
    for(let p=0;p<passes;p++){
      const p0=lo+p*2*span;
      slice(res,band,p0,p0+span,function(y0,y1){ blurH(get(),tmp,res,r,y0,y1); });
      slice(res,band,p0+span,p0+2*span,function(x0,x1){ blurV(tmp,get(),res,r,x0,x1); });
    }
  }

  /* ---- stone ---- */
  push(function(){ base=makeBase(res,theme,mulberry32(seed>>>0),Q.weathering); },0.02);
  slice(res,band,0.02,0.10,function(y0,y1){ base.rows(y0,y1); });
  push(function(){ base.commit(); },0.11);

  /* ---- flat-lit colour ---- */
  push(function(){
    pass=passSetup(res,seed,theme,Q,base.canvas,'albedo',false);
    plan=planPlates(res,Q,pass.rand);
    drawJobs(0.12,0.38);
  },0.12);
  readInto(A,3,0.39,0.43);

  /* ---- height, over the identical layout ---- */
  push(function(){
    pass=passSetup(res,seed,theme,Q,base.canvas,'height',false);
    plan=planPlates(res,Q,pass.rand);
    drawJobs(0.44,0.60);
  },0.44);
  push(function(){ rb=pass.ctx.getImageData(0,0,res,res).data; h=new Float32Array(N); },0.61);
  slice(res,band,0.61,0.65,function(y0,y1){
    for(let i=y0*res;i<y1*res;i++) h[i]=rb[i*4]/255;
  });
  push(function(){ pass.canvas.width=0; pass=null; rb=null; tmp=new Float32Array(N); },0.65);

  /* the bevel: how far the etched shoulder is smeared before it is read as
     a normal. One scratch buffer serves both blurs. */
  queueBlur(getH,Q.bevel*scale,2,0.65,0.71);

  /* Cheap cavity AO: compare each texel against a wide neighbourhood
     average. Sitting well below its surroundings means occluded, which is
     exactly what happens inside grooves, seams and bores. */
  push(function(){ wide=Float32Array.from(h); },0.72);
  queueBlur(getWide,Math.max(3,7*scale),2,0.72,0.78);

  push(function(){ aoF=new Float32Array(N); roughF=new Float32Array(N); },0.78);
  slice(res,band,0.78,0.83,function(y0,y1){
    const bd=base.data;
    for(let i=y0*res;i<y1*res;i++){
      const hv=h[i];
      if(hv<hMin)hMin=hv; if(hv>hMax)hMax=hv;
      aoF[i] = clamp01(1 - (wide[i]-hv)*Q.aoStrength*3.2);
      // Recessed cuts collect grit, so they read rougher than the polished top.
      const lum = bd[i*4]/255;
      roughF[i] = clamp01(Q.roughBase + (1-hv)*0.28 + (lum-0.55)*0.28);
      AO[i]=aoF[i]*255; RGH[i]=roughF[i]*255;
    }
  });
  push(function(){
    wide=null; tmp=null;                       // 16 MB each at 2048
    if(hMax-hMin<1e-9)hMax=hMin+1e-9;
    MET.fill(clampByte(Q.metallic*255));       // stone is a dielectric; the slider is the user's cheat
  },0.84);

  slice(res,band,0.84,0.90,function(y0,y1){
    normalsInto(h,res,Q.normalStrength*scale,!!Q.flipG,NRM,y0,y1);
  });

  /* ---- the pre-lit channel ---- */
  if(painted){
    /* the tool's legacy pipeline: a third pass over the same layout whose
       colour output is already lit. Only lightAngle reaches it, exactly as
       in the tool — height, ambient and specular are shading terms and this
       one paints its shadows instead of computing them. */
    push(function(){
      pass=passSetup(res,seed,theme,Q,base.canvas,'albedo',true);
      plan=planPlates(res,Q,pass.rand);
      drawJobs(0.90,0.97);
    },0.90);
    readInto(PRE,3,0.97,0.99);
  }else{
    push(function(){ shade=shadeSetup(Q); },0.90);
    slice(res,band,0.90,0.99,function(y0,y1){
      prelitInto(A,NRM,roughF,aoF,shade,PRE,y0*res,y1*res);
    });
  }

  push(function(){
    base.canvas.width=0; base=null;
    io.progress(1);
    io.done({A:A,NRM:NRM,RGH:RGH,MET:MET,AO:AO,HGT:h,hMin:hMin,hMax:hMax,PRE:PRE});
  },1);

  function step(){
    const t0=performance.now();
    let p=0;
    while(jobs.length){
      const j=jobs.shift();
      j[0](); p=j[1];
      if(performance.now()-t0>12)break;
    }
    if(jobs.length){ io.progress(p); setTimeout(step,0); }
  }
  io.progress(0.01);
  setTimeout(step,0);
}

/* ============================ mode definition ============================ */

Forge.register({
  id:"ruins",
  label:"Ruins",
  group:"Sci-fi",
  blurb:"Ruin-stone plating with etched circuit traces",
  title:'Plating <em>Fabricator</em>',
  tagline:"The Plating Fabricator tool · stone plates & etched traces · seamless · PBR + pre-lit",
  actionLabel:"Fabricate plating",
  busyLabel:"Fabricating…",

  seamless:true,
  backdrops:false,
  /* 512 is the tool's own calibration point — scale === 1, so the handful of
     absolute-pixel floors in the stroke and bore paint are exactly the
     constants the author tuned — and it is the smallest size on offer, so a
     512 export previews at full fidelity. Measured: ~220 ms for a 512 build,
     ~290 ms on the densest settings. Dropping to 256 is not worth the loss
     of calibration: it saves ~150 ms of an already-inside-budget number,
     and where a build is genuinely slow (a browser rasterising canvas 2D
     through software GL, ~1 s here) the cost is per draw call, not per
     texel, so halving the size barely moves it. Either way the geometry
     scale is res/512, so a preview at any size shows the same plates, bores
     and routed paths as the export — only the sampling of them changes. */
  /* 512 is what the standalone tool previewed at, but a 512 build here costs
     nearly two seconds — far too slow to drag a slider against. The geometry
     scale is res/512, so 256 draws the identical layout at half the texels and
     the preview stays faithful to what the full build will be. */
  previewSize:256,
  height16:true,
  preview:{gain:3.0,amb:1.15,specK:0.55,skyLo:[0.14,0.16,0.20],skyHi:[0.32,0.36,0.44]},

  channels:[
    {key:"basecolor",label:"Base colour"},
    {key:"normal",label:"Normal"},
    {key:"roughness",label:"Roughness"},
    /* one value across the tile by construction — a file and a chip, no tab */
    {key:"metallic",label:"Metallic",tab:false},
    {key:"ao",label:"AO"},
    {key:"height",label:"Height"},
    {key:"orm",label:"ORM packed"},
    {key:"prelit",label:"Pre-lit"}
  ],

  presets:[
    {id:"ruin",label:"Ashen ruin",set:{theme:"ashen",pattern:"labyrinth",panelSize:130,lFrequency:0.6,
      seamGap:9,weathering:0.75,boreFreq:0.7,boreSize:11,tracePitch:12,traceWidth:0.42,fillDensity:0.7,
      viaFreq:0.45,grooveTint:0.3,bevelMode:"etched",bevel:3,bevelBias:0.35,bevelDir:135,
      normalStrength:2.6,roughBase:0.72,metallic:0,aoStrength:1.4}},
    {id:"relic",label:"Verdigris relic",set:{theme:"verdigris",pattern:"concentric",panelSize:150,
      lFrequency:0.3,seamGap:11,weathering:0.6,boreFreq:0.5,boreSize:13,tracePitch:14,traceWidth:0.5,
      fillDensity:0.6,viaFreq:0.3,grooveTint:0.34,bevelMode:"embossed",bevel:3.5,bevelBias:0.2,
      bevelDir:120,normalStrength:2.4,roughBase:0.62,metallic:0.25,aoStrength:1.2}},
    {id:"deck",label:"Gunmetal bus deck",set:{theme:"gunmetal",pattern:"bus",panelSize:90,lFrequency:0.4,
      seamGap:5,weathering:0.25,boreFreq:0.55,boreSize:7,tracePitch:8,traceWidth:0.34,fillDensity:0.95,
      viaFreq:0.65,grooveTint:0.16,bevelMode:"etched",bevel:1.25,bevelBias:0,bevelDir:135,
      normalStrength:1.8,roughBase:0.4,metallic:0.4,aoStrength:0.9}},
    {id:"core",label:"Obsidian core",set:{theme:"obsidian",pattern:"radial",panelSize:160,lFrequency:0.15,
      seamGap:12,weathering:0.45,boreFreq:0.9,boreSize:16,tracePitch:16,traceWidth:0.55,fillDensity:0.8,
      viaFreq:0.8,grooveTint:0.45,bevelMode:"etched",bevel:4,bevelBias:0.6,bevelDir:60,
      normalStrength:3.2,roughBase:0.66,metallic:0.1,aoStrength:1.8}},
    {id:"weave",label:"Serpentine weave",set:{theme:"ashen",pattern:"serpentine",panelSize:70,
      lFrequency:0.75,seamGap:4,weathering:0.35,boreFreq:0.35,boreSize:5,tracePitch:6.5,traceWidth:0.3,
      fillDensity:1,viaFreq:0.25,grooveTint:0.2,bevelMode:"embossed",bevel:1,bevelBias:0,bevelDir:135,
      normalStrength:1.6,roughBase:0.5,metallic:0,aoStrength:0.8}}
  ],

  controls:[
    {title:"Output",open:true,rows:[
      /* 2048 is the ceiling on purpose: the geometry does not densify with
         resolution, only the sampling of it does, so 4096 buys nothing but
         four 67 MB canvases and an AO blur radius of 56 */
      {id:"size",type:"select",label:"Resolution",value:1024,showValue:true,options:Forge.sizes("square",2048)},
      {id:"seed",type:"seed",value:4713},
      {type:"readout"}
    ]},
    {title:"Plating",open:true,rows:[
      {id:"theme",type:"select",label:"Stone",value:"ashen",options:[
        ["ashen","Ashen ruin stone"],["verdigris","Verdigris bronze"],
        ["gunmetal","Gunmetal cyan"],["obsidian","Obsidian amber"]]},
      {id:"panelSize",label:"Plate scale",unit:"px",min:40,max:180,step:1,value:110},
      {id:"lFrequency",label:"L-shaped plates",min:0,max:1,step:0.05,value:0.5},
      {id:"seamGap",label:"Seam gap",unit:"px",min:0,max:16,step:0.5,value:7},
      {id:"weathering",label:"Stone grain",min:0,max:1,step:0.05,value:0.5},
      {id:"boreFreq",label:"Junction bores",min:0,max:1,step:0.05,value:0.65},
      {id:"boreSize",label:"Bore size",unit:"px",min:2,max:22,step:0.5,value:9}
    ]},
    {title:"Circuitry",open:true,rows:[
      {id:"pattern",type:"select",label:"Circuit pattern",value:"mixed",options:[
        ["mixed","Mixed — random per plate"],["routed","Routed — wandering traces"],
        ["serpentine","Serpentine — dense switchback"],["spiral","Spiral — single inward coil"],
        ["concentric","Concentric — nested contours"],["bus","Bus — parallel ranks"],
        ["radial","Radial — hub and spokes"],["nodes","Nodes — pads and links"],
        ["labyrinth","Labyrinth — branching maze"]]},
      {id:"tracePitch",label:"Trace pitch",unit:"px",min:6,max:22,step:0.5,value:10},
      {id:"traceWidth",label:"Trace width",min:0.15,max:0.6,step:0.01,value:0.4},
      {id:"fillDensity",label:"Fill density",min:0.1,max:1,step:0.05,value:0.85},
      {id:"viaFreq",label:"Via frequency",min:0,max:1,step:0.05,value:0.5},
      {id:"grooveTint",label:"Groove tint",min:0,max:0.6,step:0.02,value:0.22}
    ]},
    {title:"Relief",rows:[
      {id:"bevelMode",type:"select",label:"Bevel profile",value:"etched",options:[
        ["etched","Etched — cut into stone"],["embossed","Embossed — raised ridges"]]},
      {id:"bevel",label:"Bevel softness",unit:"px",min:0.5,max:6,step:0.25,value:2},
      {id:"bevelBias",label:"Bevel asymmetry",min:0,max:1,step:0.05,value:0},
      {id:"bevelDir",label:"Bevel direction",unit:"°",min:0,max:360,step:5,value:135},
      {id:"normalStrength",label:"Normal strength",min:0.2,max:6,step:0.1,value:2.2},
      {type:"checks",items:[{id:"flipG",label:"Flip green (DirectX normals)",value:false}]}
    ]},
    {title:"Material",rows:[
      {id:"roughBase",label:"Roughness base",min:0,max:1,step:0.02,value:0.55},
      {id:"metallic",label:"Metallic",min:0,max:1,step:0.02,value:0},
      {id:"aoStrength",label:"AO strength",min:0,max:3,step:0.1,value:1}
    ]},
    {title:"Pre-lit bake",rows:[
      {id:"prelit",type:"select",label:"Pre-lit bake",value:"shaded",options:[
        ["shaded","Shaded — Blinn-Phong over the maps"],
        ["painted","Painted — hand-baked shadows"]]},
      {id:"lightAngle",label:"Bake light angle",unit:"°",min:0,max:360,step:1,value:135},
      {id:"lightHeight",label:"Bake light height",unit:"°",min:5,max:85,step:1,value:45},
      {id:"ambient",label:"Bake ambient",min:0,max:1,step:0.02,value:0.28},
      {id:"specular",label:"Bake specular",min:0,max:1.5,step:0.05,value:0.5},
      {type:"note",html:"These drive <b>prelit.png</b> only — the lit preview above has its own draggable light. There is no reshade-only path, so moving them rebuilds the whole set. <b>Painted</b> takes only the angle: it paints its shadows instead of computing them."}
    ]}
  ],

  /* The numbers that decide whether this resolution can hold the detail.
     No LOD gate is needed anywhere in the generator: the smallest size on
     offer is 512 and every dimension is multiplied by res/512, so nothing is
     ever finer than the reference the tool was tuned at, and the canvas
     rasterises a sub-texel stroke by coverage — it fades to a stain instead
     of aliasing into dashes. What the user can still do is dial a pitch and
     a width that put the groove under two texels, so say so. */
  readout:function(P){
    const S=P.size|0, k=S/512;
    const grid=Math.max(1,Math.round(512/P.panelSize));
    const pitch=P.tracePitch*k, w=pitch*P.traceWidth;
    let msg="<b>"+Math.round(P.panelSize*k)+" px</b> plates ("+grid+"×"+grid+" across the tile at any resolution)"+
      "<br>trace pitch <b>"+pitch.toFixed(1)+" px</b> · groove <b>"+w.toFixed(1)+" px</b>";
    if(w<2)msg+=' <span class="warn">— under two texels, the etch fades to a stain</span>';
    else if(w<3.5)msg+=" — thin, edges will read soft";
    const gap=P.seamGap*k;
    msg+="<br>seam gap "+gap.toFixed(1)+" px · bores "+((P.boreSize+P.seamGap*0.5)*k*2.7).toFixed(0)+" px across";
    if(P.seamGap>0&&gap<2)msg+=' <span class="warn">— seams below two texels</span>';
    if(P.bevel*k<1.5)msg+="<br>bevel blur clamps to one texel — the relief will read as a hard step";
    return msg;
  },

  tileTag:function(){return "tiles ↔ and ↕";},
  sizeTag:function(P){return P.theme+" · "+P.pattern;},

  size:function(P,preview){
    const S=P.size|0, D=preview?Math.min(S,512):S;
    return {w:D,h:D};
  },
  build:build,

  /* the one channel the runtime has no writer for: a diffuse texture that
     already contains its lighting */
  writers:function(B){
    const PRE=B.PRE;
    return {prelit:function(i,o,k){ o[k]=PRE[i*3];o[k+1]=PRE[i*3+1];o[k+2]=PRE[i*3+2];return 255; }};
  },

  fileBase:function(P,W){ return "ruinplate_"+P.theme+"_"+P.pattern+"_"+(P.seed|0)+"_"+W; },

  readme:function(P,info){
    const range=(info.hMax-info.hMin).toFixed(5);
    return ["Texture Forge · ruins — ruin-stone plating with etched circuitry",
      "(the Plating Fabricator tool, ported)",
      "",
      "Seed: "+(P.seed|0)+"   Resolution: "+info.W+"x"+info.H+"   Tiling: seamless in both axes",
      "Stone: "+P.theme+"   Pattern: "+P.pattern+"   Bevel: "+P.bevelMode,
      "",
      "basecolor.png  sRGB albedo, flat-lit — no baked shading. Import as sRGB / colour data.",
      "normal.png     Tangent-space normal, "+info.normalNote+". Import as non-colour / linear.",
      "roughness.png  Linear grey, 0 = mirror, 1 = fully rough.",
      "metallic.png   Flat "+P.metallic.toFixed(2)+" across the tile. Stone is a dielectric, so 0 is the",
      "               honest value; anything above it is a deliberate cheat.",
      "ao.png         Linear grey cavity occlusion.",
      "height.png     Linear grey, normalised: 0-1 spans a height range of "+range+" of the",
      "               greyscale relief pass, not physical units. The bores occupy the very",
      "               bottom of that range, so prefer height16.png for displacement.",
      "height16.png   The same field at 16 bits.",
      "orm.png        Packed: R = AO, G = roughness, B = metallic (glTF/Unreal style).",
      "prelit.png     A baked diffuse for unlit or legacy shaders, lit from "+Math.round(P.lightAngle)+"° at "+
        Math.round(P.lightHeight)+"° elevation ("+P.prelit+").",
      "               Use it INSTEAD of the PBR set, never alongside it — a renderer that",
      "               lights basecolor.png would light this one twice.",
      "",
      "Plate and trace dimensions are quoted at a 512 px reference and scale with the",
      "output: scale = "+info.W+"/512 = "+(info.W/512).toFixed(2)+"x. The layout, the routing grid and every",
      "path are identical at every resolution — only the sampling of them changes.",
      "Normal strength was baked at "+P.normalStrength.toFixed(2)+"x."].join("\n");
  }
});

})();
