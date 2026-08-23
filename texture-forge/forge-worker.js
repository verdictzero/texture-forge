/* =====================================================================
   TEXTURE FORGE — the generator, on a worker thread
   =====================================================================

   A generator is a per-texel loop over a few typed arrays. It has no
   business on the thread that is also trying to keep a slider moving,
   and until now it was on it: a 4096-square build froze the tab for
   several seconds, took the progress bar with it, and made dragging a
   control feel broken exactly when the mode was doing the most work.

   This file is the same generators with no document under them.

   THREE SHIMS, and that is the whole of it:

     window     the mode files write window.HouseShell, window.RoofGen,
                window.ForgeMicro. On a worker the global is `self`, so
                one alias makes every one of those land where the other
                files look for it.

     document   four modes rasterise shapes through a 2D canvas —
                cracks, scratches, decals, vines. OffscreenCanvas is the
                same API without a page, so document.createElement gives
                one back and asks no further questions. Anything else it
                is asked for throws, loudly, rather than returning a
                half-object that fails somewhere less obvious.

     the files  are not hard-coded. The page passes the list from its own
                <script> tags, so there is exactly one place that says
                which modes exist and it is index.html.

   WHAT DOES NOT COME HERE. Anything that would render DIFFERENTLY off
   the main thread — the graffiti faces and the diner's neon sign are
   drawn with fonts that are registered against the document and are not
   available to a worker, so a build using either would come back subtly
   wrong rather than merely late. Modes opt in with `threadable`, which
   may be a function of the parameters, and those two say no when the
   lettering is switched on. The runtime falls back to the main thread
   for them, and for everything, if this file cannot be reached at all —
   which is what happens on file://, where a worker has no origin.
   ===================================================================== */
"use strict";

self.window=self;

self.document={
  createElement:function(tag){
    if(String(tag).toLowerCase()!=="canvas")
      throw new Error("Texture Forge worker: there is no document here, and "+
                      "something asked for <"+tag+">");
    if(typeof OffscreenCanvas!=="function")
      throw new Error("Texture Forge worker: no OffscreenCanvas");
    return new OffscreenCanvas(1,1);
  }
};

let booted=false;

self.onmessage=function(ev){
  const m=ev.data||{};

  if(m.cmd==="load"){
    try{
      importScripts.apply(self,m.files);
      if(!self.Forge||!self.Forge.modes.length)
        throw new Error("nothing registered — check the file list");
      booted=true;
      self.postMessage({boot:true,modes:self.Forge.modes.map(x=>x.id)});
    }catch(e){
      self.postMessage({boot:false,error:String((e&&e.message)||e)});
    }
    return;
  }

  if(m.cmd!=="build")return;
  if(!booted){self.postMessage({id:m.id,ok:false,error:"the worker never loaded"});return;}
  const mode=self.Forge.byId[m.mode];
  if(!mode){self.postMessage({id:m.id,ok:false,error:"unknown mode "+m.mode});return;}

  /* Progress is thinned to about forty steps. A generator reports it once a
     band, which at 4096 is hundreds of times, and every one of those is a
     structured clone and a task on the very thread we are trying to keep free. */
  let sent=-1;
  let done=false;
  try{
    mode.build(m.P,{
      W:m.W,H:m.H,preview:!!m.preview,
      progress:function(t){
        const step=Math.round(t*40);
        if(step===sent)return;
        sent=step;
        self.postMessage({id:m.id,progress:t});
      },
      done:function(B){
        if(done)return;                       // a generator calling done twice
        done=true;
        const out={},move=[];
        for(const k in B){
          const v=B[k];
          if(v&&v.buffer instanceof ArrayBuffer){
            out[k]=v;
            /* two views over one buffer would be transferred twice, and the
               second one is an error rather than a no-op */
            if(move.indexOf(v.buffer)<0)move.push(v.buffer);
          }else if(typeof v!=="function"&&typeof v!=="object"){
            out[k]=v;
          }
        }
        self.postMessage({id:m.id,ok:true,B:out},move);
      }
    });
  }catch(e){
    if(!done)self.postMessage({id:m.id,ok:false,
      error:String((e&&e.stack)||(e&&e.message)||e)});
  }
};
