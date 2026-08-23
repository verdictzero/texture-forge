/* =====================================================================
   SHARED: micro detail — the last pass over a finished elevation
   =====================================================================
   Four things that every composed surface in this app wants and that
   none of them can express while it is drawing one texel at a time,
   because all four are about a texel's RELATIONSHIP to its neighbours:

     ledge dust   dust, soot and pigeon mess settle on anything that
                  faces up. A sill top, a belt course, a coping, the top
                  of a door canopy, the flat of a louvre blade — they are
                  all the same feature, and the generator does not know
                  it drew one. The height field does: a texel is on a
                  ledge when it stands proud of the wall just ABOVE it.

     curvature    an arris that has been knocked about catches the light,
                  and a crack holds dirt. Both come straight off the
                  Laplacian of the height field — positive where the
                  surface is locally convex, negative where it is
                  concave — and neither can be seen from inside a
                  per-texel loop.

     grain        the fine tooth under everything, in ROUGHNESS ONLY. It
                  costs nothing in the normal map and it is most of what
                  stops a large flat area reading as a rendered plane.

     speck        the dark flecks in any real material: grit in mortar,
                  aggregate under paint, a century of small dirt.

   THE NOISE FLOOR. Every field here is held so its finest octave stays
   several texels wide. fbm doubles its lattice per octave, so a base
   period of 300 over three octaves lands its finest cells at about one
   texel of a 1024 map — and a value-noise cell that small does not read
   as grain, it reads as square blocks.

   ORIENTATION. These modes are elevations with flipPreviewY set: image
   row 0 is the TOP of the wall, so "up the wall" is y−1. A mode drawn
   the other way up passes up:+1.
   ===================================================================== */
"use strict";

(function(){
const clamp=Forge.clamp,lerp=Forge.lerp,smoothstep=Forge.smoothstep,fbm2=Forge.fbm2;

/* The mean height of the `win` texels directly above each one, as a single
   sliding window down each column — O(1) a texel rather than O(win), which at
   4096² and a 30 mm window is the difference between a pass and a hang. */
function meanAbove(HGT,W,H,win,up,wrap){
  const out=new Float32Array(W*H);
  const dir=up<0?1:-1;                        // which way to walk the rows
  const first=up<0?0:H-1;                     // starting at the top of the wall
  for(let x=0;x<W;x++){
    let sum=0,cnt=0;
    if(wrap){
      /* a tiling panel has no top, so the window comes round from the bottom */
      for(let k=win;k>=1;k--)sum+=HGT[((((first-dir*k)%H)+H)%H)*W+x];
      cnt=win;
    }
    for(let n=0;n<H;n++){
      const y=first+dir*n;
      out[y*W+x]=cnt?sum/cnt:HGT[y*W+x];
      sum+=HGT[y*W+x];cnt++;
      if(cnt>win){
        const dy=y-dir*win;
        if(wrap)sum-=HGT[((((dy)%H)+H)%H)*W+x];
        else if(dy>=0&&dy<H)sum-=HGT[dy*W+x];
        cnt--;
      }
    }
  }
  return out;
}

/* B: {A,RGH,HGT,ALP,W,H}.  o: seed, mpp (metres per texel), and the amounts. */
function apply(B,o){
  const W=B.W,H=B.H,A=B.A,RGH=B.RGH,HGT=B.HGT,ALP=B.ALP,N=W*H;
  const dust=clamp(+o.dust||0,0,1),grain=clamp(+o.grain||0,0,1),
        speck=clamp(+o.speck||0,0,1),curve=clamp(+o.curve||0,0,1);
  if(!(dust||grain||speck||curve))return;
  const seed=(o.seed|0)+7717;
  const up=(o.up<0||o.up===undefined)?-1:1;
  const wrap=!!o.wrap;
  const dc=o.dustC||[168,162,150];
  const mpp=o.mpp>0?o.mpp:0.002;
  const alive=i=>!ALP||ALP[i];

  /* ---- ledge dust ---- */
  let ledge=null;
  if(dust>0){
    const win=clamp(Math.round((o.ledgeM||0.035)/mpp),2,Math.max(2,H>>3));
    const above=meanAbove(HGT,W,H,win,up,wrap);
    const stepU=Math.max(1e-7,(o.stepU!==undefined?o.stepU:0.0006));
    ledge=new Float32Array(N);
    for(let i=0;i<N;i++)ledge[i]=smoothstep(stepU*0.15,stepU,HGT[i]-above[i]);
  }

  for(let y=0;y<H;y++){
    const v=(y+0.5)/H;
    const ym=wrap?((y-1+H)%H):Math.max(0,y-1);
    const yp=wrap?((y+1)%H):Math.min(H-1,y+1);
    for(let x=0;x<W;x++){
      const i=y*W+x;
      if(!alive(i))continue;
      const u=(x+0.5)/W;
      const xm=wrap?((x-1+W)%W):Math.max(0,x-1);
      const xp=wrap?((x+1)%W):Math.min(W-1,x+1);
      let r=A[i*3],g=A[i*3+1],b=A[i*3+2],rg=RGH[i]/255;

      /* ---- curvature: convex catches the light, concave holds the dirt ---- */
      if(curve>0){
        const lap=4*HGT[i]-HGT[y*W+xm]-HGT[y*W+xp]-HGT[ym*W+x]-HGT[yp*W+x];
        const k=clamp(lap/Math.max(1e-7,(o.curveU||0.0009)),-1,1)*curve;
        if(k>0){
          r=lerp(r,r*1.22+16,k*0.55);g=lerp(g,g*1.22+15,k*0.55);b=lerp(b,b*1.20+14,k*0.55);
          rg=clamp(rg-k*0.05,0.03,1);
        }else if(k<0){
          const d=-k;
          r=lerp(r,r*0.66,d*0.55);g=lerp(g,g*0.66,d*0.55);b=lerp(b,b*0.65,d*0.55);
          rg=clamp(rg+d*0.06,0.03,1);
        }
      }

      /* ---- grain: roughness only ---- */
      if(grain>0){
        const n=fbm2(u,v,72,72,3,seed+31);
        rg=clamp(rg+(n-0.5)*0.22*grain,0.03,1);
      }

      /* ---- speck: the flecks in any real material ---- */
      if(speck>0){
        const n=fbm2(u,v,110,110,2,seed+37);
        const s=clamp((n-0.74)*7,0,1)*speck;
        if(s>0){
          r=lerp(r,r*0.52,s*0.8);g=lerp(g,g*0.52,s*0.8);b=lerp(b,b*0.51,s*0.8);
          rg=clamp(rg+s*0.07,0.03,1);
        }
        const l=clamp((0.26-n)*7,0,1)*speck;     // and the pale ones
        if(l>0){
          r=lerp(r,r*1.26+20,l*0.5);g=lerp(g,g*1.26+19,l*0.5);b=lerp(b,b*1.24+18,l*0.5);
        }
      }

      /* ---- ledge dust: patchy, and only where something faces up ---- */
      if(ledge){
        const patch=clamp(fbm2(u,v,26,34,3,seed+41)*1.5-0.30,0,1);
        const d=ledge[i]*patch*dust;
        if(d>0.002){
          r=lerp(r,dc[0],d*0.62);g=lerp(g,dc[1],d*0.62);b=lerp(b,dc[2],d*0.60);
          rg=clamp(rg+d*0.30,0.03,1);
        }
      }

      A[i*3]=r;A[i*3+1]=g;A[i*3+2]=b;
      RGH[i]=clamp(rg,0.03,1)*255;
    }
  }
}

window.ForgeMicro={apply:apply,meanAbove:meanAbove};

})();
