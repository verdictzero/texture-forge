/* =====================================================================
   TEXTURE FORGE — the programmatic API
   =====================================================================
   Everything the app does, callable. `window.ForgeAPI` is the front door
   for a script rather than a person: a console one-liner, the test
   harness, or tools/forge.mjs driving a headless browser to forge a
   texture set straight into another project's assets folder.

   THE SAME PANEL, THE SAME BUILD, THE SAME PACKER. Nothing in here
   generates anything. Every call writes the mode's own controls, runs the
   runtime's own build and packs with the runtime's own packer — so a
   texture forged from a script is byte-identical to one forged by hand,
   and a mode added tomorrow is in the API the moment it is in index.html.
   That is why this file leans on Forge.internals rather than talking to
   the generators: a second path to the pixels is a second path to drift.

   TWO PROPERTIES A SCRIPT NEEDS AND A PERSON DOES NOT:

   - REPRODUCIBILITY. A person leaves a panel where they left it and that
     is a feature. A caller asking for the same spec twice — in the same
     session, after twenty other builds, in a fresh browser — must get the
     same texture. So every forge() resets the mode to its declared
     defaults first, then lays the preset on, then the caller's values.
     The spec is the whole description; nothing survives from last time
     unless you ask for it with `keep`.
   - WHAT ACTUALLY LANDED. A slider clamps, a step snaps, and derive()
     rewrites parameters behind both. A person sees that happen. A caller
     gets it back: every forge() reports the parameters the generator was
     really handed, and names anything that moved.

   BYTES COME BACK ONE FILE AT A TIME. A 4096² channel set is tens of
   megabytes and a page-to-driver hop is JSON, so pack() puts the files in
   a slot here and hands back a manifest; the caller pulls each one by
   index. Holding the lot as one base64 string would cost a third again in
   overhead and all of it at once.
   ===================================================================== */
"use strict";

(function(){

const Forge=window.Forge;
if(!Forge||!Forge.internals){
  console.warn("Texture Forge: forge-api.js loaded without the runtime — check the script order in index.html");
  return;
}
const I=Forge.internals;

/* ============================ small helpers ============================ */

const b64=bytes=>{
  /* chunked: String.fromCharCode.apply blows the argument limit somewhere
     around a hundred thousand and a 4096² PNG is far past it */
  let s="";
  for(let i=0;i<bytes.length;i+=0x8000)
    s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
  return btoa(s);
};
const utf8=bytes=>new TextDecoder().decode(bytes);
const plain=o=>JSON.parse(JSON.stringify(o));

function stateOf(id){
  const st=I.STATE[id];
  if(!st)throw new Error("no such mode: "+id+" — try ForgeAPI.catalog()");
  if(!st.params)throw new Error("mode "+id+" has no panel yet; call ForgeAPI.ready() first");
  return st;
}
const flag=(m,name,P)=>typeof m[name]==="function"?!!m[name](P):!!m[name];

/* ============================ the catalogue ============================
   What a caller can ask for, in a shape it can act on without reading a
   three-thousand-line mode file: every control's id, type, range and
   default, every preset, every channel, and the real-world size the mode
   thinks it is drawing. */

function rowsOf(mode,st,group){
  const out=[];
  const byId={};
  for(const d of st.params)byId[d.id]=d;
  const take=(row,item)=>{
    const id=(item||row).id;
    const d=byId[id];
    if(!d)return;                                  /* a readout or a note */
    const o={id:id,kind:d.kind,label:(item&&item.label)||row.label||id,
             group:group,default:d.def};
    if(d.kind==="range"){o.min=d.min;o.max=d.max;o.step=d.step;if(row.unit)o.unit=row.unit;}
    if(d.kind==="select")o.options=(row.options||[]).map(x=>({value:d.numeric?+x[0]:String(x[0]),label:x[1]}));
    if(row.type==="font")o.options="whatever ForgeFonts has registered, plus auto and none";
    if(row.need)o.need=[].concat(row.need);
    out.push(o);
  };
  for(const row of (group.rows||[])){
    if(row.type==="colors"||row.type==="checks"){for(const it of (row.items||[]))take(row,it);}
    else take(row,null);
  }
  return out;
}

function describe(id){
  const st=stateOf(id),m=st.mode;
  const controls=[];
  for(const g of (m.controls||[]))
    for(const r of rowsOf(m,st,g))controls.push(Object.assign(r,{group:g.title||""}));
  const P=defaults(id);
  return {
    id:m.id,label:m.label,blurb:m.blurb||"",tagline:m.tagline||"",
    seamless:flag(m,"seamless",P),backdrops:flag(m,"backdrops",P),
    threadable:!!m.threadable,height16:m.height16!==false,
    channels:m.channels.map(c=>({key:c.key,label:c.label})),
    controls:controls,
    presets:(m.presets||[]).map(p=>({id:p.id,label:p.label,set:plain(p.set||{})})),
    variants:!!m.variants,
    plan:planOf(m,P),
    defaults:P
  };
}

function planOf(m,P){
  if(!window.ForgeModel)return null;
  try{
    const p=ForgeModel.planOf(m,P);
    return {w:p.w,h:p.h,cutout:!!p.cutout,tile:p.tile||null,eaves:p.eaves,units:"metres"};
  }catch(e){return null;}
}

function catalog(){
  return {
    version:1,
    modes:Forge.modes.map(m=>{
      const st=I.STATE[m.id];
      const P=(st&&st.P)||{};
      return {id:m.id,label:m.label,blurb:m.blurb||"",
              seamless:flag(m,"seamless",P),
              channels:m.channels.map(c=>c.key)};
    }),
    structures:Forge.structures.map(s=>({
      id:s.id,label:s.label,blurb:s.blurb||"",
      steps:s.steps.map(x=>({id:x.id,mode:x.mode,label:x.label,set:plain(x.set||{})}))
    }))
  };
}

/* ============================ parameters ============================ */

/* Back to what the CONTROLS declare, not to what a preset or the last call
   left behind. This is the whole of the reproducibility promise: two calls
   with the same spec start from the same place. */
function reset(st){
  for(const d of st.params){
    if(d.def===undefined)continue;
    const n=I.node(st,d.id);
    if(!n)continue;
    if(n.type==="checkbox")n.checked=!!d.def;else n.value=d.def;
  }
  I.readParams(st);
}

function applyPreset(st,id){
  if(!id)return;
  const p=(st.mode.presets||[]).find(x=>x.id===id);
  if(!p)throw new Error("mode "+st.mode.id+" has no preset "+id+
    " — it has "+((st.mode.presets||[]).map(x=>x.id).join(", ")||"none"));
  /* the runtime's own applier, so a preset means here exactly what it means
     on the button — including the ids it deliberately holds back */
  I.applyPreset(st,id);
}

/* Write values through the FORM, because that is what runs derive() and the
   row visibility with them. Returns what was refused and what moved. */
function apply(st,values){
  const unknown=[],asked={};
  const byId={};
  for(const d of st.params)byId[d.id]=d;
  for(const k in values){
    const d=byId[k],n=d&&I.node(st,k);
    if(!n){unknown.push(k);continue;}
    const v=values[k];
    if(d.kind==="select"){
      const have=[].map.call(n.options,o=>o.value);
      if(have.indexOf(String(v))<0)
        throw new Error(st.mode.id+"."+k+": no such option "+JSON.stringify(v)+
          " — expected one of "+have.join(", "));
    }
    if(d.kind==="check")n.checked=!!v;else n.value=v;
    asked[k]=v;
  }
  I.readParams(st);
  /* what the control actually took: a range clamps to its ends and snaps to
     its step, and derive() may have rewritten the lot afterwards */
  const moved=[];
  for(const k in asked){
    const got=st.P[k];
    const want=byId[k].kind==="check"?!!asked[k]
      :byId[k].kind==="range"||byId[k].kind==="number"?+asked[k]
      :byId[k].kind==="select"&&byId[k].numeric?+asked[k]:String(asked[k]);
    if(got!==want)moved.push({id:k,asked:asked[k],got:got});
  }
  return {unknown:unknown,moved:moved};
}

function defaults(id){
  const st=stateOf(id);
  const P={};
  for(const d of st.params)if(d.def!==undefined)P[d.id]=d.def;
  return P;
}

/* ============================ forging ============================ */

/* spec: {mode, preset, set:{…}, size, seed, preview, keep, activate}
   Everything but `mode` is optional. `size` and `seed` are spelled out
   because every mode has them and a caller should not have to know they
   live in `set`. */
async function forge(spec){
  if(typeof spec==="string")spec={mode:spec};
  const st=stateOf(spec.mode);
  if(!spec.keep)reset(st);
  if(spec.preset)applyPreset(st,spec.preset);
  const set=Object.assign({},spec.set||{});
  if(spec.size!==undefined)set.size=spec.size;
  if(spec.seed!==undefined)set.seed=spec.seed;
  const took=apply(st,set);
  /* a mode that is on screen shows what was just forged; one that is not
     still forges, which is what makes a batch of forty cheap */
  if(spec.activate)I.activate(st.mode.id);
  const t0=performance.now();
  await I.runAsync(st,!!spec.preview);
  if(!st.B)throw new Error(st.mode.id+" did not build");
  return info(st,Math.round(performance.now()-t0),took);
}

function info(st,ms,took){
  const B=st.B,m=st.mode,P=st.P;
  const out={
    mode:m.id,w:B.W,h:B.H,ms:ms,
    fileBase:I.fileBase(st),
    seamless:flag(m,"seamless",P),cutout:flag(m,"backdrops",P),
    height:{min:B.hMin,max:B.hMax},
    channels:m.channels.map(c=>c.key),
    plan:planOf(m,P),
    params:plain(P)
  };
  if(m.readout){try{out.readout=strip(m.readout(P));}catch(e){}}
  if(m.sizeTag){try{out.sizeTag=strip(String(m.sizeTag(P)||""));}catch(e){}}
  if(took){
    if(took.unknown.length)out.unknown=took.unknown;
    if(took.moved.length)out.adjusted=took.moved;
  }
  return out;
}
/* A readout is HTML with <br> between its lines and <b> inside them. Dropping
   every tag runs the lines together into one long word-salad, so the breaks
   become separators and only the inline emphasis is thrown away. */
const strip=h=>String(h)
  .replace(/<br\s*\/?>|<\/(div|p|li)>/gi," · ")
  .replace(/<[^>]*>/g,"")
  .replace(/\s+/g," ").replace(/(\s*·\s*)+/g," · ").replace(/^\s*·\s*|\s*·\s*$/g,"").trim();

/* ============================ packing ============================
   The archive the download button makes, minus the download: every
   channel as a PNG, the 16-bit height, the readme and the glTF/OBJ/MTL
   the mode's plan() describes — plus any variants the mode declares, in
   the folders it wants them in. Held in a slot; the caller pulls the
   bytes one file at a time. */

let SLOT=[];

/* WHICH FILE IS WHICH CHANNEL. A folder of nine PNGs named after the build is
   not self-describing, and a caller wiring up a material should not be parsing
   file names to find the normal map. The names are `<base>_<channel>.png` by
   construction, so read the suffix back against the keys that actually exist
   and hand over a map per folder. */
function chanKeys(){
  const seen={height16:1};
  for(const m of Forge.modes)for(const c of m.channels)seen[c.key]=1;
  return seen;
}
function mapsOf(files){
  const known=chanKeys(),out={};
  for(const f of files){
    const cut=f.name.lastIndexOf("/");
    const dir=cut<0?"":f.name.slice(0,cut),base=f.name.slice(cut+1);
    const m=/^(.*)_([a-z0-9]+)\.png$/.exec(base);
    if(m&&known[m[2]])(out[dir]||(out[dir]={}))[m[2]]=f.name;
    else if(base==="model.gltf")(out[dir]||(out[dir]={})).model=f.name;
  }
  return out;
}

async function collect(st,opts){
  const files=[];
  const cuts=(opts&&opts.variants===false)?[]:I.variantsOf(st);
  const rootCut=cuts.length?I.rootCutOf(st):null;
  const root=cuts.length?I.fileBase(st)+(rootCut?"_"+rootCut.id:"")+"/":"";
  await I.packBuild(st,files,root,"");
  for(const cut of cuts){
    const was={};
    for(const k in cut.set){was[k]=st.P[k];st.P[k]=cut.set[k];}
    try{
      await I.runAsync(st,false);
      await I.packBuild(st,files,I.fileBase(st)+"_"+cut.id+"/","");
    }finally{
      for(const k in was)st.P[k]=was[k];
      await I.runAsync(st,false);                  /* and the panel is back */
    }
  }
  return {files:files,cuts:cuts.map(c=>({id:c.id,label:c.label,set:plain(c.set)}))};
}

function manifest(got,extra){
  SLOT=got.files;
  return Object.assign({
    files:got.files.map((f,i)=>({index:i,name:f.name,bytes:f.data.length,
                                text:/\.(txt|obj|mtl|gltf)$/.test(f.name)})),
    maps:mapsOf(got.files)
  },extra||{});
}

async function pack(spec){
  const out=await forge(spec);
  const st=stateOf(out.mode);
  const got=await collect(st,spec);
  return manifest(got,Object.assign(out,{variants:got.cuts}));
}

/* ============================ structures ============================
   A house is four textures, and the wizard is what makes them one
   building rather than four exports somebody has to line up afterwards.
   Driving it is the same walk a person does: enter each step, set what
   that step decides, and let the steps after it inherit.

   `steps` is keyed by STEP id, not by mode id — a diner's front and side
   are the same mode and want different values. */
async function structure(spec){
  if(typeof spec==="string")spec={structure:spec};
  const id=spec.structure||spec.id;
  const s=Forge.structById[id];
  if(!s)throw new Error("no such structure: "+id+" — try ForgeAPI.catalog()");
  const per=spec.steps||{};
  for(const k in per)if(!s.steps.some(x=>x.id===k))
    throw new Error("structure "+id+" has no step "+k+
      " — it has "+s.steps.map(x=>x.id).join(", "));
  I.wiz.start(id);
  if(!I.wiz.live())throw new Error("could not start "+id+" — is every step's mode loaded?");
  try{
    const steps=I.wiz.steps();
    const took={};
    for(let k=0;k<steps.length;k++){
      I.wiz.enter(k);
      const st=I.STATE[steps[k].mode];
      const want=Object.assign({},per[steps[k].id]||{});
      /* A PRESET INSIDE A STEP IS THE BUTTON, WITH THE BUTTON'S CONSEQUENCE:
         it resets that panel to its declared defaults before applying, which
         throws away what this step inherited from the ones before it — and
         what it settles is then what the steps after it inherit. That is what
         clicking a preset mid-wizard does in the app, so it is what this does;
         it is only worth knowing before you put one on step three. */
      const preset=want.preset;delete want.preset;
      if(preset)applyPreset(st,preset);
      const set=want;
      /* One resolution and one seed for the whole building, unless a step says
         otherwise — the usual thing to want and a tedious thing to spell out
         four times. The seed is re-asserted at EVERY step rather than left to
         inheritance from the first: a structure whose steps are not one thing
         (the town's house, diner, works and road) starts a fresh pool at each
         group, and one set only at step 0 would reach the house and nothing
         after it. Re-asserting a value that was going to be inherited anyway
         costs nothing. */
      const has=id=>st.params.some(d=>d.id===id);
      if(spec.size!==undefined&&set.size===undefined&&has("size"))set.size=spec.size;
      if(spec.seed!==undefined&&set.seed===undefined&&has("seed"))set.seed=spec.seed;
      const r=apply(st,set);
      if(r.unknown.length||r.moved.length)took[steps[k].id]=r;
      I.wiz.record();                              /* so the next step inherits it */
    }
    const got=await I.wiz.collect();
    const out=manifest({files:got.files},{structure:id,label:s.label,name:got.name});
    /* a face folder IS its step id, which is what wizCollect names them */
    out.faces=steps.map(x=>({id:x.id,mode:x.mode,maps:out.maps[x.id]||{}}));
    for(const k in took){
      if(took[k].unknown.length)(out.unknown||(out.unknown={}))[k]=took[k].unknown;
      if(took[k].moved.length)(out.adjusted||(out.adjusted={}))[k]=took[k].moved;
    }
    return out;
  }finally{I.wiz.exit();}
}

/* ============================ getting bytes out ============================ */

function file(i){
  const f=SLOT[i];
  if(!f)throw new Error("no packed file at index "+i+" — pack() first");
  return b64(f.data);
}
function text(i){
  const f=SLOT[i];
  if(!f)throw new Error("no packed file at index "+i+" — pack() first");
  return utf8(f.data);
}
function zip(){
  if(!SLOT.length)throw new Error("nothing packed — pack() first");
  return new Promise(res=>{
    const fr=new FileReader();
    fr.onload=()=>res(String(fr.result).split(",")[1]);
    fr.readAsDataURL(I.makeZip(SLOT));
  });
}

/* One channel of the last build, without packing anything — for a caller
   that wants a look rather than an export. `maxW` renders it small. */
function png(modeId,key,maxW){
  const st=stateOf(modeId);
  if(!st.B)throw new Error(modeId+" has not been forged");
  if(!st.mode.channels.some(c=>c.key===key))
    throw new Error(modeId+" has no channel "+key+" — it has "+
      st.mode.channels.map(c=>c.key).join(", "));
  const cv=I.makeMap(st,key,maxW);
  return cv.toDataURL("image/png").split(",")[1];
}

/* ============================ the global look ============================
   Palette and the unlit bake are properties of how a texture is LOOKED at
   rather than of any one mode — but both reach the exported PNGs, so a
   caller has to be able to set them, and every forge() reports them. */

function palette(patch){
  if(!window.Palette)return null;
  if(patch)for(const k in patch)Palette.set(k,patch[k]);
  return {state:plain(Palette.state),describe:Palette.describe()||null,
          available:Palette.list?Palette.list().map(p=>({id:p.id,label:p.label})):[]};
}
function bake(patch){
  if(!window.ForgeUnlit)return null;
  if(patch)for(const k in patch)ForgeUnlit.set(k,patch[k]);
  return {state:plain(ForgeUnlit.state),describe:ForgeUnlit.describe()};
}

/* ============================ readiness ============================
   boot() runs on DOMContentLoaded and builds every panel; a driver that
   evaluates too early would find no params to write. */
function ready(){
  return new Promise((res,rej)=>{
    let n=0;
    const tick=()=>{
      const m=Forge.modes[0];
      if(m&&I.STATE[m.id]&&I.STATE[m.id].params)return res(true);
      if(++n>200)return rej(new Error("Texture Forge did not boot"));
      setTimeout(tick,25);
    };
    tick();
  });
}

window.ForgeAPI={
  version:1,
  ready:ready,
  catalog:catalog,describe:describe,defaults:defaults,
  forge:forge,pack:pack,structure:structure,
  file:file,text:text,zip:zip,png:png,
  palette:palette,bake:bake,
  /* the live state, for a caller that wants to poke about rather than drive */
  params:id=>plain(stateOf(id).P),
  reset:id=>{reset(stateOf(id));return plain(stateOf(id).P);},
  set:(id,values)=>{const st=stateOf(id);const r=apply(st,values);return {params:plain(st.P),unknown:r.unknown,adjusted:r.moved};}
};

})();
