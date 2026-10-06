/* =====================================================================
   LIB: truetype — a minimal TrueType font writer
   =====================================================================

   Takes closed polygon outlines and gives back the bytes of a .ttf.

   WHY A FONT FILE AT ALL. A texture of letter shapes is a picture of a
   font. What makes it a font is that you can type in it: install the file
   and the alphabet is available in every text field, every design tool and
   every 3D package on the machine, at any size, with the kerning and the
   metrics the designer meant. Nothing a PNG can carry gets near that.

   WHY TRUETYPE AND NOT CFF. ".otf" in ordinary speech means "a font
   file", and both flavours of OpenType install and render identically
   everywhere — the difference is only whether the outlines inside are
   quadratic (TrueType, `glyf`) or cubic (CFF, Type 2 charstrings). The
   shapes here are polygons, which quadratic curves hold exactly as
   straight segments and cubic charstrings would only wrap in more
   machinery. So this writes `glyf`, and the file is named .ttf because
   that is what it honestly is.

   THE ONE TRICK WORTH KNOWING. Outlines that overlap are FINE. TrueType
   fills with the nonzero winding rule, so a letter can be handed over as
   a pile of overlapping rectangles, discs and triangles — one per stroke
   segment, one per joint — and the rasteriser unions them for free, as
   long as every piece winds the SAME WAY. That is what makes it possible
   to turn stroked centre lines into a font without implementing polygon
   boolean operations: stamp the stroke, let the fill rule do the union.
   Contours are reversed here where their signed area says they came in
   the wrong way round, so a caller cannot get that wrong.

   THE COST OF THAT TRICK IS HOLES. Every contour handed in is turned to
   face the same way, which is what makes the union work and what makes it
   impossible to punch a counter out of a shape: an inner contour wound the
   other way would be straightened out and filled in. Nothing built from
   stroked centre lines needs one — the middle of a stroked rectangle is
   unfilled because no stamp covers it, not because a hole was cut — but a
   caller with real counters wants a different writer.

   WHAT IT DOES NOT DO: hinting, kerning, composite glyphs, curves (every
   point is on-curve), or any of the layout tables. A `cmap`, a `glyf` and
   the handful of headers that make a file loadable is the whole of it.
   ===================================================================== */
"use strict";

(function(){

/* ---- a growable big-endian byte writer ---- */
function Buf(){this.a=[];}
Buf.prototype.u8 =function(v){this.a.push(v&0xff);return this;};
Buf.prototype.u16=function(v){this.a.push((v>>8)&0xff,v&0xff);return this;};
Buf.prototype.i16=function(v){return this.u16(v<0?v+0x10000:v);};
Buf.prototype.u32=function(v){v=v>>>0;this.a.push((v>>>24)&0xff,(v>>>16)&0xff,(v>>>8)&0xff,v&0xff);return this;};
Buf.prototype.tag=function(s){for(let i=0;i<4;i++)this.a.push(s.charCodeAt(i)&0xff);return this;};
Buf.prototype.raw=function(b){for(let i=0;i<b.length;i++)this.a.push(b[i]&0xff);return this;};
Buf.prototype.str=function(s){for(let i=0;i<s.length;i++)this.a.push(s.charCodeAt(i)&0xff);return this;};
/* UTF-16BE, which is what every name record in a Windows platform table is */
Buf.prototype.utf16=function(s){for(let i=0;i<s.length;i++)this.u16(s.charCodeAt(i));return this;};
Buf.prototype.pad4=function(){while(this.a.length&3)this.a.push(0);return this;};
Buf.prototype.out=function(){return Uint8Array.from(this.a);};

/* A table's checksum is the sum of its big-endian uint32s, with the tail
   zero-padded — and the sum is taken MOD 2^32, which in JS means keeping it
   unsigned at every step rather than letting it go negative through |0. */
function checksum(b){
  let s=0;
  for(let i=0;i<b.length;i+=4)
    s=(s+(((b[i]||0)<<24|(b[i+1]||0)<<16|(b[i+2]||0)<<8|(b[i+3]||0))>>>0))>>>0;
  return s>>>0;
}
const round=Math.round;
const clampI16=v=>Math.max(-32768,Math.min(32767,round(v)));

/* the area of a closed polygon, signed: positive one way round, negative the
   other. Which sign means "clockwise" depends on which way y points, so the
   caller says, and everything is made to agree. */
function signedArea(p){
  let a=0;
  for(let i=0,n=p.length;i<n;i++){
    const q=p[i],r=p[(i+1)%n];
    a+=q[0]*r[1]-r[0]*q[1];
  }
  return a*0.5;
}

/* ---- the tables ---- */

function tHead(S,bbox,longLoca){
  const b=new Buf();
  b.u32(0x00010000);          /* version */
  b.u32(0x00010000);          /* fontRevision 1.0 */
  b.u32(0);                   /* checkSumAdjustment — patched once the file exists */
  b.u32(0x5F0F3CF5);          /* magic */
  b.u16(0x0003);              /* baseline at y=0, left sidebearing at x=0 */
  b.u16(S.unitsPerEm);
  /* A FIXED DATE, not the clock. Two builds of the same alphabet have to come
     out byte for byte or there is nothing to compare in a test, and nobody
     reading a generated font cares what minute it was generated in. */
  b.u32(0).u32(S.date);       /* created  */
  b.u32(0).u32(S.date);       /* modified */
  b.i16(bbox[0]).i16(bbox[1]).i16(bbox[2]).i16(bbox[3]);
  b.u16(0);                   /* macStyle */
  b.u16(8);                   /* lowestRecPPEM */
  b.i16(2);                   /* fontDirectionHint */
  b.i16(longLoca?1:0);
  b.i16(0);                   /* glyphDataFormat */
  return b.out();
}
function tHhea(S,m,nGlyphs){
  const b=new Buf();
  b.u32(0x00010000);
  b.i16(S.ascender).i16(S.descender).i16(S.lineGap);
  b.u16(m.maxAdv);
  b.i16(m.minLsb).i16(m.minRsb).i16(m.maxExtent);
  b.i16(1).i16(0).i16(0);     /* caret slope 1:0, no offset */
  b.i16(0).i16(0).i16(0).i16(0);
  b.i16(0);                   /* metricDataFormat */
  b.u16(nGlyphs);             /* every glyph carries its own advance */
  return b.out();
}
function tMaxp(n,maxPts,maxCon){
  const b=new Buf();
  b.u32(0x00010000);
  b.u16(n).u16(maxPts).u16(maxCon);
  b.u16(0).u16(0);            /* no composites */
  b.u16(2);                   /* maxZones */
  b.u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);
  return b.out();
}
function tHmtx(glyphs){
  const b=new Buf();
  for(const g of glyphs){b.u16(Math.max(0,round(g.advance)));b.i16(clampI16(g.lsb));}
  return b.out();
}
/* cmap format 4. The segments are found rather than enumerated: a run of
   consecutive code points whose glyph ids are also consecutive is ONE segment
   with a delta and nothing else, which is why mapping a-z onto the same
   glyphs as A-Z costs one extra segment rather than a glyph id array. */
function tCmap(pairs){
  const ps=pairs.slice().sort((x,y)=>x[0]-y[0]).filter(p=>p[0]<=0xffff);
  const segs=[];
  for(const p of ps){
    const last=segs[segs.length-1];
    if(last&&p[0]===last.end+1&&(p[1]-p[0])===last.delta){last.end=p[0];continue;}
    segs.push({start:p[0],end:p[0],delta:p[1]-p[0]});
  }
  segs.push({start:0xffff,end:0xffff,delta:1});
  const n=segs.length;
  const sub=new Buf();
  let pow=1;while(pow*2<=n)pow*=2;
  sub.u16(4).u16(16+n*8).u16(0);
  sub.u16(n*2).u16(pow*2).u16(Math.round(Math.log(pow)/Math.LN2)).u16(n*2-pow*2);
  for(const s of segs)sub.u16(s.end);
  sub.u16(0);
  for(const s of segs)sub.u16(s.start);
  /* idDelta is ADDED MOD 65536 to get the glyph id, so the unsigned 16-bit
     representation is the whole of it and there is no sign to get wrong */
  for(const s of segs)sub.u16(((s.delta%65536)+65536)%65536);
  for(let i=0;i<n;i++)sub.u16(0);
  const body=sub.out();
  const b=new Buf();
  b.u16(0).u16(2);                       /* two encodings, one subtable */
  b.u16(0).u16(3).u32(4+2*8);            /* Unicode BMP */
  b.u16(3).u16(1).u32(4+2*8);            /* Windows BMP */
  b.raw(body);
  return b.out();
}
/* A GLYPH IS ITS POINTS AND NOTHING ELSE here: no instructions, every point
   on-curve, and the coordinates written as plain 16-bit deltas rather than
   through the short/same-as-previous flags. The file is a little larger and
   there is one way for it to be wrong instead of six. */
function glyphBytes(g){
  if(!g.contours.length)return new Uint8Array(0);
  const pts=[];
  const ends=[];
  for(const c of g.contours){
    for(const p of c)pts.push(p);
    ends.push(pts.length-1);
  }
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const p of pts){
    if(p[0]<x0)x0=p[0];if(p[0]>x1)x1=p[0];
    if(p[1]<y0)y0=p[1];if(p[1]>y1)y1=p[1];
  }
  const b=new Buf();
  b.i16(g.contours.length);
  b.i16(clampI16(x0)).i16(clampI16(y0)).i16(clampI16(x1)).i16(clampI16(y1));
  for(const e of ends)b.u16(e);
  b.u16(0);                               /* no instructions */
  for(let i=0;i<pts.length;i++)b.u8(0x01);/* on-curve, long deltas */
  let px=0;
  for(const p of pts){b.i16(clampI16(p[0]-px));px=round(p[0]);}
  let py=0;
  for(const p of pts){b.i16(clampI16(p[1]-py));py=round(p[1]);}
  b.pad4();
  return b.out();
}
function tName(S){
  const recs=[[1,S.family],[2,S.style],[3,S.uid],[4,S.full],[5,S.version],
              [6,S.psName],[8,S.maker],[13,S.licence]]
              .filter(r=>String(r[1]||"").length);
  const b=new Buf();
  b.u16(0).u16(recs.length).u16(6+recs.length*12);
  let off=0;
  const strs=[];
  for(const r of recs){
    const s=new Buf().utf16(String(r[1]||"")).out();
    strs.push(s);
    b.u16(3).u16(1).u16(0x0409).u16(r[0]).u16(s.length).u16(off);
    off+=s.length;
  }
  for(const s of strs)b.raw(s);
  return b.out();
}
function tPost(){
  const b=new Buf();
  b.u32(0x00030000);          /* version 3.0: no glyph names in the file */
  b.u32(0);                   /* italicAngle */
  b.i16(-100).i16(50);        /* underline position and thickness */
  b.u32(0);                   /* isFixedPitch */
  b.u32(0).u32(0).u32(0).u32(0);
  return b.out();
}
function tOs2(S,m,firstChar,lastChar){
  const b=new Buf();
  b.u16(4);                   /* version 4 */
  b.i16(m.avgAdv);
  b.u16(400).u16(5).u16(0);   /* regular, medium, installable */
  const e=S.unitsPerEm;
  b.i16(round(e*0.65)).i16(round(e*0.7)).i16(0).i16(round(e*0.14));
  b.i16(round(e*0.65)).i16(round(e*0.7)).i16(0).i16(round(e*0.48));
  b.i16(round(e*0.05)).i16(round(e*0.26));
  b.i16(0);                   /* sFamilyClass: no classification */
  for(let i=0;i<10;i++)b.u8(0);
  b.u32(1).u32(0).u32(0).u32(0);   /* Basic Latin */
  b.str("FRGE");
  b.u16(0x0040);              /* REGULAR */
  b.u16(firstChar).u16(lastChar);
  b.i16(S.ascender).i16(S.descender).i16(S.lineGap);
  b.u16(Math.max(0,S.ascender)).u16(Math.max(0,-S.descender));
  b.u32(1).u32(0);            /* Latin 1 code page */
  b.i16(S.xHeight).i16(S.capHeight);
  b.u16(0).u16(32).u16(1);
  return b.out();
}

/* ============================ assembly ============================ */
function build(spec){
  const S={
    unitsPerEm:spec.unitsPerEm||1000,
    ascender:round(spec.ascender||800),
    descender:round(spec.descender||-200),
    lineGap:round(spec.lineGap||0),
    capHeight:round(spec.capHeight||700),
    xHeight:round(spec.xHeight||500),
    date:spec.date||3786825600,          /* 2024-01-01, fixed on purpose */
    family:spec.family||"Forge",
    style:spec.style||"Regular",
    version:spec.version||"Version 1.000",
    psName:spec.psName||"Forge-Regular",
    maker:spec.maker||"Texture Forge",
    licence:spec.licence||"",
    uid:spec.uid||((spec.family||"Forge")+" "+(spec.style||"Regular"))
  };
  S.full=spec.full||(S.family+" "+S.style);

  /* every contour wound the same way, so the nonzero rule unions the pile.
     In a y-up space a CLOCKWISE outer contour has negative signed area. */
  const glyphs=spec.glyphs.map(g=>{
    const cs=(g.contours||[]).map(c=>{
      const p=c.map(q=>[round(q[0]),round(q[1])]);
      return signedArea(p)>0?p.slice().reverse():p;
    }).filter(c=>c.length>=3);
    return {name:g.name,advance:g.advance||0,contours:cs,lsb:0};
  });

  const parts=glyphs.map(glyphBytes);
  let maxPts=0,maxCon=0;
  let bx0=Infinity,by0=Infinity,bx1=-Infinity,by1=-Infinity;
  let maxAdv=0,minLsb=Infinity,minRsb=Infinity,maxExtent=-Infinity,sumAdv=0;
  glyphs.forEach(g=>{
    let n=0;
    for(const c of g.contours)n+=c.length;
    maxPts=Math.max(maxPts,n);
    maxCon=Math.max(maxCon,g.contours.length);
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const c of g.contours)for(const p of c){
      if(p[0]<x0)x0=p[0];if(p[0]>x1)x1=p[0];
      if(p[1]<y0)y0=p[1];if(p[1]>y1)y1=p[1];
    }
    if(isFinite(x0)){
      g.lsb=x0;
      bx0=Math.min(bx0,x0);by0=Math.min(by0,y0);
      bx1=Math.max(bx1,x1);by1=Math.max(by1,y1);
      minLsb=Math.min(minLsb,x0);
      minRsb=Math.min(minRsb,g.advance-x1);
      maxExtent=Math.max(maxExtent,x1);
    }
    maxAdv=Math.max(maxAdv,g.advance);
    sumAdv+=g.advance;
  });
  if(!isFinite(bx0)){bx0=by0=0;bx1=by1=0;}
  if(!isFinite(minLsb))minLsb=0;
  if(!isFinite(minRsb))minRsb=0;
  if(!isFinite(maxExtent))maxExtent=0;
  const m={maxAdv:round(maxAdv),minLsb:clampI16(minLsb),minRsb:clampI16(minRsb),
           maxExtent:clampI16(maxExtent),avgAdv:clampI16(sumAdv/Math.max(1,glyphs.length))};

  /* glyf and loca. Long loca throughout: the short form stores HALF the offset
     and only works while the table fits in 128 KB, and finding that out from a
     font that loads everywhere except one machine is not worth the bytes. */
  const gl=new Buf();
  const loca=[0];
  for(const p of parts){gl.raw(p);loca.push(gl.a.length);}
  const glyf=gl.out();
  const lb=new Buf();
  for(const o of loca)lb.u32(o);
  const locaB=lb.out();

  const cps=(spec.cmap||[]).filter(p=>p[0]>=0&&p[0]<=0xffff);
  let first=0xffff,last=0;
  for(const p of cps){first=Math.min(first,p[0]);last=Math.max(last,p[0]);}
  if(!cps.length){first=0;last=0;}

  const tables=[
    ["OS/2",tOs2(S,m,first,last)],
    ["cmap",tCmap(cps)],
    ["glyf",glyf],
    ["head",tHead(S,[bx0,by0,bx1,by1],true)],
    ["hhea",tHhea(S,m,glyphs.length)],
    ["hmtx",tHmtx(glyphs)],
    ["loca",locaB],
    ["maxp",tMaxp(glyphs.length,maxPts,maxCon)],
    ["name",tName(S)],
    ["post",tPost()]
  ].sort((a,b)=>a[0]<b[0]?-1:1);

  const n=tables.length;
  let pow=1;while(pow*2<=n)pow*=2;
  const head=new Buf();
  head.u32(0x00010000).u16(n).u16(pow*16)
      .u16(Math.round(Math.log(pow)/Math.LN2)).u16(n*16-pow*16);
  let off=12+n*16;
  const dir=new Buf();
  const body=[];
  for(const [tag,data] of tables){
    dir.tag(tag).u32(checksum(data)).u32(off).u32(data.length);
    body.push(data);
    off+=(data.length+3)&~3;
  }
  const file=new Buf();
  file.raw(head.out()).raw(dir.out());
  for(const d of body){file.raw(d);while(file.a.length&3)file.a.push(0);}
  const bytes=file.out();

  /* the one field that can only be filled in once the whole file exists */
  const headOff=12+tables.findIndex(t=>t[0]==="head")*16;
  const headAt=(bytes[headOff+8]<<24|bytes[headOff+9]<<16|
                bytes[headOff+10]<<8|bytes[headOff+11])>>>0;
  const adj=(0xB1B0AFBA-checksum(bytes))>>>0;
  bytes[headAt+8]=(adj>>>24)&0xff;bytes[headAt+9]=(adj>>>16)&0xff;
  bytes[headAt+10]=(adj>>>8)&0xff;bytes[headAt+11]=adj&0xff;
  return bytes;
}

window.ForgeTTF={build:build,signedArea:signedArea,checksum:checksum};

})();
