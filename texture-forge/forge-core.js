/* =====================================================================
   TEXTURE FORGE — shared runtime
   =====================================================================

   Everything in this file is mode-agnostic. A mode (street, plating,
   house, …) is a plain object handed to Forge.register(); the runtime
   owns the chrome around it:

     · the mode tab bar and the control panel, built from a declarative
       control schema, with parameters read back into a plain object
     · presets, seed rolling, the debounced preview/full rebuild queue
     · the GGX lit preview and the flat channel views
     · channel chips, PNG export, 16-bit height, the store-only zip

   See ADDING-A-MODE.md and modes/_template.js for the mode contract.
   ===================================================================== */
"use strict";

(function(){

/* ============================ the shared prelude ============================
   The maths, the resolution ladder and the registry live in forge-math.js,
   because forge-worker.js needs every one of them and cannot load this file:
   there is no document on a worker thread. window.Forge is created there and
   extended here. */

const Forge=window.Forge;
if(!Forge){
  document.title="Texture Forge — forge-math.js is missing";
  throw new Error("Texture Forge: forge-math.js must load before forge-core.js");
}
const MODES=Forge.modes,BY_ID=Forge.byId;
const clamp=Forge.clamp;

/* ============================ small DOM helpers ============================ */

const el=id=>document.getElementById(id);
function make(tag,cls,text){
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(text!=null)n.textContent=text;
  return n;
}
const decimals=step=>{const s=String(step);const i=s.indexOf(".");return i<0?0:s.length-i-1;};

/* ============================ per-mode state ============================ */

/* One of these per registered mode. Buffers live here so switching tabs
   shows the last build back instantly instead of regenerating it. */
const STATE={};
let active=null;                       // the live state object
let view="lit",tileN=1,bg="dark",light=[0.35,0.45];
/* not a channel: the wizard's 3D building, which exists only while a wizard
   is walking and is drawn by forge-stage.js rather than by either canvas here */
const BUILD_VIEW="building";
const RETAIN_TEXELS=1024*1024;         // bigger than this is dropped on tab-out

function stateFor(mode){
  return STATE[mode.id]||(STATE[mode.id]={
    mode:mode,P:{},panel:null,params:null,
    B:null,built:false,flags:null,
    busy:false,pending:null,preview:false,qTimer:null,zipUrl:null
  });
}
const pid=(st,id)=>st.mode.id+"--"+id;
const node=(st,id)=>el(pid(st,id));

/* A control's value readout is an <input> for a range and a <span> for
   everything else, and it is never overwritten while somebody is typing in it —
   reformatting "1" to "1.00" under the caret makes the field unusable. */
function showVal(v,text){
  if(!v||v===document.activeElement)return;
  if(v.tagName==="INPUT")v.value=text;else v.textContent=text;
}

/* A mode flag may be a plain value or a function of the parameters, so one
   mode can switch between a tiling surface and a single cut-out piece per
   build (the envelope mode does: walls are cut-outs, roofs tile). Resolved
   once per build and read back from the build, never from the live form —
   the preview belongs to the texture that is actually on screen. */
function flag(m,name,P){const v=m[name];return typeof v==="function"?!!v(P):!!v;}
function flagsOf(st){
  return st.flags||(st.flags={
    seamless:flag(st.mode,"seamless",st.P),
    backdrops:flag(st.mode,"backdrops",st.P)
  });
}
function syncChrome(st){
  const f=flagsOf(st);
  el("tiles").hidden=!f.seamless;
  el("bgs").hidden=!f.backdrops;
  el("h16").hidden=st.mode.height16===false;
}

/* ============================ panel construction ============================
   A mode declares `controls`; the runtime turns that into markup, collects
   the parameter descriptors and wires the change handlers. Element ids are
   prefixed with the mode id so several panels can coexist in the document. */

function buildPanel(st){
  const m=st.mode,params=[];
  const form=make("form","panel");
  form.id="panel-"+m.id;
  form.dataset.mode=m.id;
  form.setAttribute("onsubmit","return false");

  const head=make("div","panel-head");
  const h1=make("h1");h1.innerHTML=m.title||m.label;
  head.appendChild(h1);
  if(m.tagline)head.appendChild(make("p",null,m.tagline));
  form.appendChild(head);

  /* FIND A CONTROL BY NAME. A big mode carries forty of them behind eight
     collapsed groups, and knowing the word — "rivet", "soot", "pitch" — is
     faster than remembering which group somebody filed it under. */
  const find=make("div","findrow");
  const fi=make("input");
  fi.type="search";fi.id=pid(st,"find");fi.placeholder="Find a control…";
  fi.setAttribute("aria-label","Find a control in this panel");
  fi.autocomplete="off";
  const fc=make("button","mini clearfind","Clear");
  fc.type="button";
  fi.addEventListener("input",()=>filterPanel(st,fi.value));
  fc.addEventListener("click",()=>{fi.value="";filterPanel(st,"");fi.focus();});
  find.appendChild(fi);find.appendChild(fc);
  form.appendChild(find);

  if(m.presets&&m.presets.length){
    const pr=make("div","presets");
    for(const p of m.presets){
      const b=make("button","preset",p.label);
      b.type="button";b.dataset.preset=p.id;
      pr.appendChild(b);
    }
    pr.addEventListener("click",e=>{
      const b=e.target.closest("[data-preset]");
      if(b)applyPreset(st,b.dataset.preset);
    });
    form.appendChild(pr);
  }

  for(const group of m.controls||[]){
    const d=make("details","group");
    if(group.open)d.open=true;
    if(group.id)d.id=pid(st,group.id);
    if(group.need)d.setAttribute("data-need-any",[].concat(group.need).join(" "));
    d.appendChild(make("summary",null,group.title));
    const body=make("div","group-body");
    for(const row of group.rows||[])body.appendChild(buildRow(st,row,params));
    d.appendChild(body);
    form.appendChild(d);
  }

  const actions=make("div","actions");
  const forge=make("button","forge",m.actionLabel||"Forge texture");
  forge.type="button";forge.id=pid(st,"forge");
  forge.addEventListener("click",()=>{
    readParams(st);run(st,false);
    /* on a phone the controls pane is covering the thing you just asked for */
    if(matchMedia("(max-width:900px)").matches&&document.body.dataset.pane==="controls")
      setPane("preview");
  });
  actions.appendChild(forge);
  const note=make("p","autonote",autonote(st));
  note.id=pid(st,"autonote");
  actions.appendChild(note);
  form.appendChild(actions);

  st.params=params;
  return form;
}

function buildRow(st,row,params){
  const kind=row.type||"range";
  const wrap=make("div",kind==="readout"||kind==="note"?"":"row");
  if(row.need)wrap.setAttribute("data-need",[].concat(row.need).join(" "));

  if(kind==="readout"){
    const r=make("div","readout","—");
    r.id=pid(st,row.id||"readout");
    if(row.need)r.setAttribute("data-need",[].concat(row.need).join(" "));
    return r;
  }
  if(kind==="note"){
    const r=make("div","readout");
    r.innerHTML=row.html||row.text||"";
    if(row.need)r.setAttribute("data-need",[].concat(row.need).join(" "));
    return r;
  }

  if(kind==="range"){
    /* THE NUMBER IS AN INPUT, not a label. Every one of these is a real
       dimension — a brick length, a bay width, a slat pitch — and somebody may
       have the number on a drawing in front of them. Dragging to 4.35 when you
       want 4.40 is the single most irritating thing about a slider, and the
       readouts have always quoted values a slider cannot land on exactly.

       The name keeps its own <label for>; the box is a sibling rather than a
       child of it, because a labelable control nested inside a label for a
       DIFFERENT control is exactly the kind of thing browsers disagree on. */
    const line=make("div","labrow");
    const lab=make("label");
    lab.htmlFor=pid(st,row.id);
    lab.innerHTML=row.label;
    const box=make("div","valbox");
    const val=make("input");
    val.type="number";val.className="val";val.id=pid(st,row.id)+"-val";
    val.min=row.min;val.max=row.max;val.step=row.step;
    val.setAttribute("aria-label",String(row.label).replace(/<[^>]*>/g,"")+" value");
    box.appendChild(val);
    if(row.unit)box.appendChild(make("span","unit",row.unit));
    line.appendChild(lab);line.appendChild(box);
    const inp=make("input");
    inp.type="range";inp.id=pid(st,row.id);
    inp.min=row.min;inp.max=row.max;inp.step=row.step;inp.value=row.value;
    wrap.appendChild(line);wrap.appendChild(inp);
    params.push({id:row.id,kind:"range",dp:decimals(row.step),def:row.value,
                 min:+row.min,max:+row.max,step:+row.step});
    return wrap;
  }

  if(kind==="select"){
    const lab=make("label",null,row.label);
    lab.htmlFor=pid(st,row.id);
    if(row.showValue)lab.innerHTML=row.label+' <span class="val" id="'+pid(st,row.id)+'-val"></span>';
    const sel=make("select");
    sel.id=pid(st,row.id);
    let numeric=true;
    for(const o of row.options){
      const opt=make("option",null,o[1]);
      opt.value=o[0];
      if(String(o[0])===String(row.value))opt.selected=true;
      if(isNaN(+o[0]))numeric=false;
      sel.appendChild(opt);
    }
    wrap.appendChild(lab);wrap.appendChild(sel);
    params.push({id:row.id,kind:"select",numeric:numeric,def:row.value});
    return wrap;
  }

  if(kind==="text"){
    const lab=make("label",null,row.label);
    lab.htmlFor=pid(st,row.id);
    const inp=make("input");
    inp.type="text";inp.id=pid(st,row.id);inp.value=row.value==null?"":row.value;
    if(row.placeholder)inp.placeholder=row.placeholder;
    if(row.maxlength)inp.maxLength=row.maxlength;
    wrap.appendChild(lab);wrap.appendChild(inp);
    params.push({id:row.id,kind:"text",def:row.value===undefined?"":row.value});
    return wrap;
  }

  /* A typeface is an asset the app deliberately does not ship — see the note at
     the top of forge-fonts.js — so the picker has to be able to take one from
     the user as well as list whatever was found. */
  if(kind==="font"){
    const lab=make("label",null,row.label||"Typeface");
    lab.htmlFor=pid(st,row.id);
    const line=make("div","seedrow");
    const sel=make("select");
    sel.id=pid(st,row.id);
    const file=make("input");
    file.type="file";file.hidden=true;
    file.accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff";
    const btn=make("button","mini","Load…");
    btn.type="button";
    const fill=()=>{
      const keep=sel.value;
      sel.innerHTML="";
      const have=(window.ForgeFonts?ForgeFonts.list():[]).length;
      if(row.autoLabel!==false){
        /* "Any face loaded" selected with nothing loaded reads as a claim that
           there is one. On the hosted copy there never is — say so, and fix
           itself the moment somebody loads one, since this reruns on every
           ForgeFonts change. */
        const auto=make("option",null,have?(row.autoLabel||"Any face loaded")
                                          :(row.emptyLabel||"No face loaded — scrawl"));
        auto.value="auto";sel.appendChild(auto);
      }
      const none=make("option",null,row.noneLabel||"None");
      none.value="none";sel.appendChild(none);
      for(const f of (window.ForgeFonts?ForgeFonts.list():[])){
        const o=make("option",null,f.label+(f.from==="dropped"?" · loaded":""));
        o.value=f.id;sel.appendChild(o);
      }
      sel.value=keep&&[...sel.options].some(o=>o.value===keep)?keep:(row.value||"none");
    };
    btn.addEventListener("click",()=>file.click());
    file.addEventListener("change",e=>{
      const f=e.target.files&&e.target.files[0];
      e.target.value="";
      if(!f||!window.ForgeFonts)return;
      ForgeFonts.loadFile(f).then(id=>{
        fill();sel.value=id;
        readParams(st);queue(st,false);
        setStatus(f.name+" loaded");
      },msg=>setStatus(String(msg)));
    });
    line.appendChild(sel);line.appendChild(btn);
    wrap.appendChild(lab);wrap.appendChild(line);
    if(window.ForgeFonts)ForgeFonts.on(fill);
    fill();
    params.push({id:row.id,kind:"select",numeric:false,def:row.value});
    return wrap;
  }

  if(kind==="seed"){
    const lab=make("label",null,row.label||"Seed");
    lab.htmlFor=pid(st,row.id);
    const line=make("div","seedrow");
    const inp=make("input");
    inp.type="number";inp.id=pid(st,row.id);inp.min="0";inp.step="1";inp.value=row.value;
    const roll=make("button","mini","Roll");
    roll.type="button";
    roll.addEventListener("click",()=>{
      inp.value=Math.floor(Math.random()*99999);
      readParams(st);queue(st,false);
    });
    line.appendChild(inp);line.appendChild(roll);
    wrap.appendChild(lab);wrap.appendChild(line);
    params.push({id:row.id,kind:"number",def:row.value});
    return wrap;
  }

  if(kind==="colors"){
    if(row.label)wrap.appendChild(make("label",null,row.label));
    const sw=make("div","swatches");
    for(const c of row.items){
      const cell=make("div","swatch");
      const inp=make("input");
      inp.type="color";inp.id=pid(st,c.id);inp.value=c.value;
      if(c.title)inp.title=c.title;
      cell.appendChild(inp);sw.appendChild(cell);
      params.push({id:c.id,kind:"color",def:c.value});
    }
    wrap.appendChild(sw);
    return wrap;
  }

  if(kind==="checks"){
    const box=make("div","checks");
    for(const c of row.items){
      const lab=make("label","check");
      const inp=make("input");
      inp.type="checkbox";inp.id=pid(st,c.id);inp.checked=!!c.value;
      lab.appendChild(inp);lab.appendChild(document.createTextNode(" "+c.label));
      box.appendChild(lab);
      params.push({id:c.id,kind:"check",def:!!c.value});
    }
    wrap.appendChild(box);
    return wrap;
  }

  throw new Error("Texture Forge: unknown control type "+kind);
}

function wireInputs(st){
  for(const d of st.params){
    const n=node(st,d.id);
    if(d.kind==="range"){
      /* dragging previews, releasing rebuilds at full size */
      n.addEventListener("input",()=>{readParams(st);queue(st,true);});
      n.addEventListener("change",()=>{readParams(st);queue(st,false);});
      /* And the same value, typed. It is held to the control's range and
         SNAPPED TO ITS STEP, exactly as dragging is — the range input stays
         the single source of truth for a parameter, and a second one that
         disagreed with it by a fraction would be worse than the rounding.
         The box is rewritten with what it landed on when you leave it, so
         what you see is always what the generator got. */
      const box=el(pid(st,d.id)+"-val");
      if(box){
        const take=full=>{
          const v=parseFloat(box.value);
          if(!isFinite(v))return;
          n.value=String(clamp(v,d.min,d.max));
          readParams(st);queue(st,!full);
        };
        box.addEventListener("input",()=>take(false));
        box.addEventListener("change",()=>{take(true);box.value=(+n.value).toFixed(d.dp);});
        box.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();box.blur();}});
        box.addEventListener("focus",()=>box.select());
      }
    }else if(d.kind==="text"){
      /* typing a word rebuilds on the pause, not on every keystroke */
      n.addEventListener("input",()=>{readParams(st);queue(st,true);});
      n.addEventListener("change",()=>{readParams(st);queue(st,false);});
    }else{
      n.addEventListener("change",()=>{readParams(st);queue(st,false);});
    }
  }
}

/* ============================ parameters ============================ */

function readParams(st){
  const P=st.P;
  for(const d of st.params){
    const n=node(st,d.id);
    if(!n)continue;
    if(d.kind==="check")P[d.id]=n.checked;
    else if(d.kind==="text")P[d.id]=n.value;
    else if(d.kind==="color")P[d.id]=n.value;
    else if(d.kind==="select")P[d.id]=d.numeric?+n.value:n.value;
    else P[d.id]=+n.value;
    showVal(el(pid(st,d.id)+"-val"),(d.kind==="range")?(+n.value).toFixed(d.dp):n.value);
  }
  if(st.mode.derive)st.mode.derive(P,{
    set:(id,value)=>{
      const n=node(st,id);
      if(!n)return;
      if(n.type==="checkbox")n.checked=value;else n.value=value;
      P[id]=value;
      showVal(el(pid(st,id)+"-val"),value);
    }
  });
  syncUI(st);
  const note=el(pid(st,"autonote"));
  if(note)note.textContent=autonote(st);
  return P;
}

/* Things a preset must not touch: they belong to the export, or to which face
   you happen to be looking at, not to the building being described. */
const PRESET_KEEP={size:1,face:1,seed:1};

/* A preset is a description of a whole building, not a patch on whatever was
   last on screen. Several of them switch a feature off — the rowhouse has no
   gutter, the parapet no band board — and nothing ever switched it back, so it
   stayed off for the rest of the session on every preset clicked after it, and
   presets that omit a value inherited it from the one before. Reset to the
   declared defaults first and the button means what it says. */
function applyPreset(st,id){
  const preset=(st.mode.presets||[]).find(p=>p.id===id);
  if(!preset)return;
  for(const d of st.params){
    if(PRESET_KEEP[d.id]||d.def===undefined)continue;
    const n=node(st,d.id);
    if(!n)continue;
    if(n.type==="checkbox")n.checked=!!d.def;else n.value=d.def;
  }
  for(const k in preset.set){
    const n=node(st,k);
    if(!n)continue;
    if(n.type==="checkbox")n.checked=preset.set[k];else n.value=preset.set[k];
  }
  readParams(st);
  queue(st,false);
}

/* row and group visibility, the scale readout and the tiling tag */
function syncUI(st){
  const m=st.mode,P=st.P;
  const need=m.needs?m.needs(P):[];
  const panel=st.panel;
  if(panel){
    /* a row may name several flags, the same way a group does — stringifying
       the array and asking for an exact match hid "Bays across" on both of the
       two faces it names */
    for(const n of panel.querySelectorAll("[data-need]"))
      n.hidden=!n.getAttribute("data-need").split(" ").some(k=>need.indexOf(k)>=0);
    for(const n of panel.querySelectorAll("[data-need-any]"))
      n.hidden=!n.getAttribute("data-need-any").split(" ").some(k=>need.indexOf(k)>=0);
    const ro=el(pid(st,"readout"));
    if(ro&&m.readout)ro.innerHTML=m.readout(P);
  }
  if(st===active)el("tiletag").textContent=m.tileTag?m.tileTag(P):"";
}

/* the action label reads as a phrase mid-sentence */
const verb=m=>(m.actionLabel||"forge").toLowerCase();

function autonote(st){
  const m=st.mode,P=st.P,size=P.size|0;
  if(m.autonote)return m.autonote(P);
  if(!m.previewSize)return size>1024?"Press "+verb(m)+" to rebuild at "+size+" px":"Auto-rebuilds up to 1024 px";
  return size>1024
    ?"Dragging previews at "+m.previewSize+" px · press "+verb(m)+" for "+size
    :"Dragging shows a "+m.previewSize+" px preview · release rebuilds at "+size;
}

/* ============================ channel writers ============================
   Resolved once per build rather than string-compared per texel. A mode can
   add its own through mode.writers(B,P) — markings, material id, and so on. */

function makeWriters(st){
  const B=st.B,P=st.P;
  const A=B.A,NRM=B.NRM,RGH=B.RGH,MET=B.MET,AO=B.AO,HGT=B.HGT,ALP=B.ALP,EMI=B.EMI;
  const inv=1/((B.hMax-B.hMin)||1),lo=B.hMin;
  const w={
    basecolor:(i,o,k)=>{o[k]=A[i*3];o[k+1]=A[i*3+1];o[k+2]=A[i*3+2];return ALP?ALP[i]:255;},
    normal:(i,o,k)=>{o[k]=NRM[i*3];o[k+1]=NRM[i*3+1];o[k+2]=NRM[i*3+2];return 255;},
    roughness:(i,o,k)=>{o[k]=o[k+1]=o[k+2]=RGH[i];return 255;},
    metallic:(i,o,k)=>{o[k]=o[k+1]=o[k+2]=MET[i];return 255;},
    ao:(i,o,k)=>{o[k]=o[k+1]=o[k+2]=AO[i];return 255;},
    height:(i,o,k)=>{o[k]=o[k+1]=o[k+2]=Math.round((HGT[i]-lo)*inv*255);return 255;},
    orm:(i,o,k)=>{o[k]=AO[i];o[k+1]=RGH[i];o[k+2]=MET[i];return 255;}
  };
  if(ALP)w.opacity=(i,o,k)=>{o[k]=o[k+1]=o[k+2]=ALP[i];return 255;};
  if(EMI)w.emissive=(i,o,k)=>{const e=EMI[i];o[k]=e;o[k+1]=Math.round(e*0.86);o[k+2]=Math.round(e*0.6);return 255;};
  /* Kept rather than merged and forgotten: a channel a MODE writes is
     arbitrary JavaScript, and the GPU packer below has to know to leave it
     alone. */
  st.custom=st.mode.writers?st.mode.writers(B,P):null;
  if(st.custom)Object.assign(w,st.custom);
  st.writers=w;
  freshenBake(st);
}

/* THE BAKE'S WRITER IS THE ONE THAT GOES STALE. Every other writer is a
   function of the build, which does not change until the next one; this one is
   also a function of the bake bar, which changes while you drag a slider —
   including on modes that are built but not on screen.

   So it is rebuilt whenever the settings it closed over no longer match, rather
   than reading the settings per texel (sixteen million property lookups a
   channel) or being refreshed by whoever happened to change something (which
   is every call site that could ever set a bake value, forever).

   It is built AFTER the mode's own writers because it reads the emissive
   channel as the mode finally defined it — a mode with its own emissive ramp
   gets baked in its own colours rather than in this file's guess at them. */
function freshenBake(st){
  if(!window.ForgeUnlit||!st.writers||!st.B)return;
  const sig=ForgeUnlit.signature();
  if(st.bakeSig===sig&&st.writers.unlit)return;
  st.writers.unlit=ForgeUnlit.writer(st.B,st.writers.emissive||null);
  st.bakeSig=sig;
}

/* one channel rendered to a canvas, optionally downscaled by nearest neighbour */
function makeMap(st,key,maxW){
  const B=st.B,TW=B.W,TH=B.H;
  if(key==="unlit")freshenBake(st);
  let w=TW,h=TH;
  if(maxW&&maxW<TW){const k=maxW/TW;w=Math.max(1,Math.round(TW*k));h=Math.max(1,Math.round(TH*k));}

  /* THE FAST PATH. Packing a channel is the one heavy thing every mode does
     identically, it is per-texel and independent, and it happens ten times an
     export plus once a chip plus several times a second while a slider is
     moving. See forge-gpu.js. Three things send it back to the loop below:
     a channel the MODE writes itself (arbitrary JS), a palettised base colour
     (the quantiser wants the pixels back, and reading them back would give
     away what was gained), and no usable WebGL2. */
  let palettised=!!(window.Palette&&Palette.affects(key)&&Palette.active());
  /* the bake goes back to the loop for the same reason the base colour does —
     the quantiser wants the pixels back — and also whenever the mode owns the
     emissive ramp the bake is reading, which the shader cannot know about */
  if(key==="unlit"){
    if(window.ForgeUnlit&&ForgeUnlit.palettised())palettised=true;
    if(st.custom&&("emissive" in st.custom))palettised=true;
  }
  const owned=!!(st.custom&&(key in st.custom));
  if(window.ForgeGPU&&!palettised&&!owned&&ForgeGPU.handles(key)&&ForgeGPU.available()){
    const v=gpuVerdict();
    if(v===true){
      const fast=ForgeGPU.channel(B,key,w,h);
      if(fast)return fast;
    }else if(v===null&&w*h>=(1<<19)){
      return raceThePaths(st,key,w,h);
    }
  }
  return cpuMap(st,key,w,h);
}

/* ---------------------------------------------------------------------------
   WHICH PATH IS FASTER IS A PROPERTY OF THE MACHINE, not of this code.

   A discrete GPU walks it; an integrated one on a laptop that is also running
   the generator may not; a software rasteriser loses badly and is ruled out by
   name before we get here. So rather than guessing, the two are raced once, at
   a real export size, on the machine actually running them — and the answer is
   kept against that machine's renderer string, so it is paid once rather than
   once a session.

   The GPU is given a warm-up first. Its texture upload is per BUILD and is
   amortised over ten channels and a chip strip; timing it cold would charge
   the whole of it to one channel and lose a race it should win.
   --------------------------------------------------------------------------- */
let gpuPick=null;
const GPUKEY="texture-forge-gpupack";
function gpuVerdict(){
  if(gpuPick!==null)return gpuPick;
  try{
    const raw=localStorage.getItem(GPUKEY);
    if(raw){
      const o=JSON.parse(raw);
      if(o&&o.r===ForgeGPU.renderer())return (gpuPick=!!o.win);
    }
  }catch(e){}
  return null;
}
function sayPacking(){
  const ti=el("trayinfo");
  if(!ti)return;
  ti.textContent=(gpuPick===true)?"channels packed on the GPU"
    :(gpuPick===false)?"channels packed on the CPU — faster here"
    :(window.ForgeGPU&&ForgeGPU.available())?"channels: GPU or CPU, decided on the first big export"
    :(window.ForgeGPU&&ForgeGPU.software())?"channels packed on the CPU — WebGL2 here is software"
    :"channels packed on the CPU — no WebGL2";
  ti.title=window.ForgeGPU?("WebGL2 renderer: "+ForgeGPU.renderer()):"no WebGL2";
}
function raceThePaths(st,key,w,h){
  const B=st.B;
  ForgeGPU.channel(B,key,w,h);                        // warm the upload
  const t0=performance.now();
  const fast=ForgeGPU.channel(B,key,w,h);
  const tg=performance.now()-t0;
  const t1=performance.now();
  const slow=cpuMap(st,key,w,h);
  const tc=performance.now()-t1;
  if(!fast){gpuPick=false;sayPacking();return slow;}
  /* it has to be clearly better, not merely not worse: the CPU path is the one
     with no context to lose and no driver to fall over */
  gpuPick=tg<tc*0.85;
  try{localStorage.setItem(GPUKEY,JSON.stringify({r:ForgeGPU.renderer(),win:gpuPick}));}catch(e){}
  sayPacking();
  return gpuPick?fast:slow;
}

function cpuMap(st,key,w,h){
  const B=st.B,TW=B.W,TH=B.H;
  const cv=document.createElement("canvas");cv.width=w;cv.height=h;
  const ctx=cv.getContext("2d");
  const img=ctx.createImageData(w,h),o=img.data;
  const write=st.writers[key];
  if(!write)throw new Error("Texture Forge: no writer for channel "+key);
  const kx=TW/w,ky=TH/h;
  for(let y=0;y<h;y++){
    const sy=Math.min(TH-1,Math.floor((y+0.5)*ky));
    for(let x=0;x<w;x++){
      const sx=Math.min(TW-1,Math.floor((x+0.5)*kx));
      const k=(y*w+x)*4;
      o[k+3]=write(sy*TW+sx,o,k);
    }
  }
  /* The palette snaps here and only here: chips, the preview upload, a single
     channel download and every zip entry all come through makeMap, so what is
     on screen is exactly what lands in the file. Data channels are left alone —
     see the note at the top of forge-palette.js. */
  if(window.Palette&&Palette.affects(key))Palette.quantise(o,w,h);
  /* the bake carries its own palette, so a full-colour albedo and a sixteen-
     level pre-lit map can come out of the same build */
  else if(key==="unlit"&&window.Palette&&window.ForgeUnlit&&ForgeUnlit.palettised())
    Palette.quantise(o,w,h,ForgeUnlit.profile());
  ctx.putImageData(img,0,0);
  return cv;
}

/* ============================ lit preview ============================
   One GGX shader for every mode. Tiling modes repeat the UV and composite
   over nothing; cut-out modes (a facade) blend against the chosen backdrop
   with the base-colour alpha and add an emissive pass. */

const VS=[
"attribute vec2 p;varying vec2 vUv;uniform float uRep;uniform float uFlip;",
"void main(){vec2 t=(p*0.5+0.5)*uRep;if(uFlip>0.5)t.y=uRep-t.y;vUv=t;gl_Position=vec4(p,0.0,1.0);}"
].join("\n");
const FS=[
"precision highp float;varying vec2 vUv;",
"uniform sampler2D uB,uN,uO,uE;uniform vec3 uL,uSkyLo,uSkyHi;",
"uniform float uGain,uAmb,uSpecK;uniform int uBg;",
"float D_GGX(float NoH,float a){float a2=a*a;float d=NoH*NoH*(a2-1.0)+1.0;return a2/(3.14159265*d*d);}",
"float V_S(float NoV,float NoL,float a){float a2=a*a;float gv=NoL*sqrt(NoV*NoV*(1.0-a2)+a2);float gl2=NoV*sqrt(NoL*NoL*(1.0-a2)+a2);return 0.5/max(gv+gl2,1e-4);}",
"void main(){",
"  vec4 bs=texture2D(uB,vUv);",
"  vec3 base=pow(bs.rgb,vec3(2.2));",
"  vec3 orm=texture2D(uO,vUv).rgb;",
"  vec3 N=normalize(texture2D(uN,vUv).rgb*2.0-1.0);",
"  float ao=orm.r, rough=clamp(orm.g,0.05,1.0), metal=orm.b;",
"  vec3 V=vec3(0.0,0.0,1.0);vec3 L=normalize(uL);vec3 H=normalize(L+V);",
"  float NoL=max(dot(N,L),0.0),NoV=max(dot(N,V),1e-4),NoH=max(dot(N,H),0.0),VoH=max(dot(V,H),0.0);",
"  vec3 F0=mix(vec3(0.04),base,metal);",
"  vec3 F=F0+(1.0-F0)*pow(1.0-VoH,5.0);",
"  float a=rough*rough;",
"  vec3 spec=F*D_GGX(NoH,a)*V_S(NoV,NoL,a);",
"  vec3 diff=(1.0-F)*(1.0-metal)*base/3.14159265;",
"  vec3 col=(diff+spec)*NoL*uGain;",
"  vec3 sky=mix(uSkyLo,uSkyHi,N.z*0.5+0.5);",
"  col+=base*(1.0-metal)*sky*ao*uAmb;",
"  col+=F0*sky*ao*(uSpecK/(rough+uSpecK));",
"  col+=texture2D(uE,vUv).rgb*1.6;",
"  col=col/(col+vec3(1.0));",
"  col=pow(col,vec3(1.0/2.2));",
"  vec3 back=vec3(0.08,0.08,0.09);",
"  if(uBg==1)back=mix(vec3(0.42,0.56,0.72),vec3(0.72,0.80,0.88),vUv.y);",
"  if(uBg==2){vec2 c=floor(vUv*vec2(34.0,34.0));float m=mod(c.x+c.y,2.0);back=mix(vec3(0.22),vec3(0.32),m);}",
"  gl_FragColor=vec4(mix(back,col,bs.a),1.0);",
"}"].join("\n");

let glc=null,flat=null,fctx=null,gl=null,prog=null,tex={},uloc={},blackTex=null,noGL=false;
let solid=null,stageOK=false;          // the wizard's 3D building; see forge-stage.js
let canRepeat=false;                   // whether the live textures can tile in the preview

function initGL(){
  gl=glc.getContext("webgl",{antialias:true})||glc.getContext("experimental-webgl");
  if(!gl)return false;
  const mk=(t,src)=>{const s=gl.createShader(t);gl.shaderSource(s,src);gl.compileShader(s);
    if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.warn(gl.getShaderInfoLog(s));return null;}return s;};
  const vs=mk(gl.VERTEX_SHADER,VS),fs=mk(gl.FRAGMENT_SHADER,FS);
  if(!vs||!fs)return false;
  prog=gl.createProgram();gl.attachShader(prog,vs);gl.attachShader(prog,fs);gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){console.warn(gl.getProgramInfoLog(prog));return false;}
  gl.useProgram(prog);
  const buf=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const loc=gl.getAttribLocation(prog,"p");
  gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  for(const k of["uB","uN","uO","uE"])tex[k]=gl.createTexture();
  for(const k of["uB","uN","uO","uE","uL","uRep","uFlip","uGain","uAmb","uSpecK","uSkyLo","uSkyHi","uBg"])
    uloc[k]=gl.getUniformLocation(prog,k);
  gl.uniform1i(uloc.uB,0);gl.uniform1i(uloc.uN,1);gl.uniform1i(uloc.uO,2);gl.uniform1i(uloc.uE,3);
  /* stand-in for modes with no emissive channel */
  blackTex=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,blackTex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  return true;
}
const isPOT=n=>n>0&&(n&(n-1))===0;
function upload(unit,texture,canvas,seamless){
  gl.activeTexture(gl.TEXTURE0+unit);
  gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
  /* WebGL1 will not repeat or mipmap a non-power-of-two texture — it renders
     black instead. A tiling mode previewing at, say, 200 px would hit that,
     so fall back rather than showing nothing. */
  const rep=seamless&&isPOT(canvas.width)&&isPOT(canvas.height);
  const wrap=rep?gl.REPEAT:gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,wrap);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,wrap);
  /* Nearest keeps the texels square under magnification, which is the whole
     point of working at 64 px. Minification still goes through mipmaps when the
     tile repeats — an unfiltered 4×4 repeat shimmers into noise — but through
     the nearest level of them, so it stays blocky rather than turning soft. */
  const near=!!(window.Palette&&Palette.state.nearest);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,
    rep?(near?gl.NEAREST_MIPMAP_NEAREST:gl.LINEAR_MIPMAP_LINEAR):(near?gl.NEAREST:gl.LINEAR));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,near?gl.NEAREST:gl.LINEAR);
  if(rep)gl.generateMipmap(gl.TEXTURE_2D);
  return rep;
}
function fitCanvas(c){
  const st=el("stage");
  const aw=Math.max(80,st.clientWidth-32),ah=Math.max(80,st.clientHeight-32);
  const ar=(active&&active.B)?active.B.W/active.B.H:1;
  let w=aw,h=w/ar;
  if(h>ah){h=ah;w=h*ar;}
  c.style.width=w+"px";c.style.height=h+"px";
  const dpr=Math.min(devicePixelRatio||1,2);
  const pw=Math.round(w*dpr),ph=Math.round(h*dpr);
  if(c.width!==pw||c.height!==ph){c.width=pw;c.height=ph;}
}
function refreshGL(){
  if(!gl||!active||!active.B)return;
  const seamless=flagsOf(active).seamless;
  const PS=Math.min(active.B.W,2048);
  canRepeat=upload(0,tex.uB,makeMap(active,"basecolor",PS),seamless);
  upload(1,tex.uN,makeMap(active,"normal",PS),seamless);
  upload(2,tex.uO,makeMap(active,"orm",PS),seamless);
  if(active.writers.emissive)upload(3,tex.uE,makeMap(active,"emissive",PS),seamless);
  else{gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,blackTex);}
  drawGL();
}
function drawGL(){
  if(!gl||!active)return;
  const m=active.mode,pv=m.preview||{};
  fitCanvas(glc);
  gl.viewport(0,0,glc.width,glc.height);
  gl.uniform1f(uloc.uRep,(flagsOf(active).seamless&&canRepeat)?tileN:1);
  gl.uniform1f(uloc.uFlip,m.flipPreviewY?1:0);
  gl.uniform3f(uloc.uL,light[0],light[1],0.72);
  gl.uniform1f(uloc.uGain,pv.gain||3.0);
  gl.uniform1f(uloc.uAmb,pv.amb||1.1);
  gl.uniform1f(uloc.uSpecK,pv.specK||0.55);
  const lo=pv.skyLo||[0.16,0.19,0.23],hi=pv.skyHi||[0.34,0.38,0.44];
  gl.uniform3f(uloc.uSkyLo,lo[0],lo[1],lo[2]);
  gl.uniform3f(uloc.uSkyHi,hi[0],hi[1],hi[2]);
  gl.uniform1i(uloc.uBg,bg==="sky"?1:(bg==="check"?2:0));
  gl.drawArrays(gl.TRIANGLES,0,6);
}
function drawFlat(){
  if(!active||!active.B)return;
  const seamless=flagsOf(active).seamless;
  const src=makeMap(active,view,Math.min(active.B.W,seamless?1024:1400));
  fitCanvas(flat);
  fctx.fillStyle=bg==="sky"?"#7f97b0":(bg==="check"?"#2b2b2b":"#141414");
  fctx.fillRect(0,0,flat.width,flat.height);
  fctx.imageSmoothingEnabled=!(window.Palette&&Palette.state.nearest);
  if(seamless){
    /* repeat at the texture's own aspect: a tile that is not square (a fence
       bay, say) would otherwise be squashed into square cells here and read
       as a different texture from the lit view */
    const cw=flat.width/tileN,ch=cw*(active.B.H/active.B.W);
    for(let ty=0;ty*ch<flat.height;ty++)
      for(let tx=0;tx<tileN;tx++)fctx.drawImage(src,tx*cw,ty*ch,cw,ch);
  }else{
    fctx.drawImage(src,0,0,flat.width,flat.height);
  }
}
function renderView(){
  const lit=(view==="lit"),box=(view===BUILD_VIEW);
  glc.classList.toggle("on",lit);
  flat.classList.toggle("on",!lit&&!box);
  if(solid)solid.classList.toggle("on",box);
  el("hint").textContent=box
    ? "Drag to orbit · wheel to zoom · shift-drag the sun · click a face to work on it"
    : "Drag the preview to move the light";
  el("hint").style.display=(lit||box)?"block":"none";
  /* tiling and backdrops are questions about a flat texture. The building has
     a sky of its own and repeats nothing but its roof. */
  const f=active?flagsOf(active):null;
  el("tiles").hidden=box||!f||!f.seamless;
  el("bgs").hidden=box||!f||!f.backdrops;
  const tag=el("stagetag");
  if(tag)tag.hidden=!box;
  el("tiletag").hidden=box;             // "tiles up and across" is about a plane, not a building
  /* the bake's dozen controls belong to one channel, so they appear with it
     and are out of the way the rest of the time */
  const bb=el("bakebar");
  if(bb)bb.hidden=(view!=="unlit");
  townBarSync();
  if(box)stageSync();
  else if(lit)refreshGL();
  else drawFlat();
}

/* every place that has to put the preview back on screen — a pane change, the
   grip, a resize — without each of them having to know what the views are */
function repaint(){
  if(view===BUILD_VIEW){if(stageOK)ForgeStage.draw();}
  else if(view==="lit")drawGL();
  else drawFlat();
}

/* ============================ export ============================ */

function buildChips(){
  const st=active,wrap=el("chips");
  wrap.innerHTML="";
  const ar=st.B.H/st.B.W;
  for(const ch of st.mode.channels){
    const d=make("div","chip");
    const c=makeMap(st,ch.key,st.mode.chipSource||176);
    c.style.width="88px";c.style.height=Math.round(88*ar)+"px";
    const b=make("button",null,ch.label);
    b.type="button";b.title="Download "+ch.label+" PNG";
    b.addEventListener("click",()=>downloadOne(ch.key));
    d.appendChild(c);d.appendChild(b);wrap.appendChild(d);
  }
}
function fileBase(st){
  const B=st.B;
  return st.mode.fileBase?st.mode.fileBase(st.P,B.W,B.H):(st.mode.id+"_"+(st.P.seed|0)+"_"+B.W+"x"+B.H);
}
const fileName=(st,key)=>fileBase(st)+"_"+key+".png";

function saveBlob(blob,name){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=name;a.style.display="none";
  document.body.appendChild(a);a.click();a.remove();
  return url;
}
/* exports refuse to run off a drag preview — it would silently be the wrong size */
function exportGuard(){
  const st=active;
  if(!st||!st.B){setStatus("Build something first");return false;}
  /* compared against the size the controls ask for now, so changing the
     resolution and exporting without rebuilding is caught too */
  /* both axes: a mode whose output changes shape (a facade face, a roof) can
     otherwise pass a width-only check and export the previous shape's pixels */
  const want=st.mode.size(st.P,false);
  if(st.B.W<want.w||st.B.H!==want.h){
    setStatus("That is a "+st.B.W+"×"+st.B.H+" build — press "+verb(st.mode)+
      " for "+want.w+"×"+want.h+" first");
    return false;
  }
  return true;
}
function downloadOne(key){
  if(!exportGuard())return;
  const st=active;
  setStatus("Encoding "+key+"…");
  const cv=makeMap(st,key);
  if(!cv.toBlob){setStatus("This browser can't encode canvas PNGs");return;}
  cv.toBlob(b=>{
    if(!b){setStatus("PNG encode failed on "+key);return;}
    const url=saveBlob(b,fileName(st,key));
    setTimeout(()=>URL.revokeObjectURL(url),20000);
    setStatus(sizeTag(st));
  },"image/png");
}

/* minimal store-only ZIP writer (PNGs are already compressed) */
let CRCT=null;
function crc32(buf){
  if(!CRCT){CRCT=new Uint32Array(256);
    for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);CRCT[n]=c>>>0;}}
  let c=0xFFFFFFFF;
  for(let i=0;i<buf.length;i++)c=CRCT[(c^buf[i])&0xFF]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0;
}
function makeZip(files){
  const enc=new TextEncoder(),parts=[],central=[];let off=0;
  const d=new Date();
  const dt=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1);
  const dd=((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
  for(const f of files){
    const nb=enc.encode(f.name),crc=crc32(f.data),len=f.data.length;
    const lh=new Uint8Array(30+nb.length),lv=new DataView(lh.buffer);
    lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0,true);lv.setUint16(8,0,true);
    lv.setUint16(10,dt,true);lv.setUint16(12,dd,true);lv.setUint32(14,crc,true);
    lv.setUint32(18,len,true);lv.setUint32(22,len,true);
    lv.setUint16(26,nb.length,true);lv.setUint16(28,0,true);lh.set(nb,30);
    parts.push(lh,f.data);
    const ch=new Uint8Array(46+nb.length),cv=new DataView(ch.buffer);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);
    cv.setUint16(8,0,true);cv.setUint16(10,0,true);cv.setUint16(12,dt,true);cv.setUint16(14,dd,true);
    cv.setUint32(16,crc,true);cv.setUint32(20,len,true);cv.setUint32(24,len,true);
    cv.setUint16(28,nb.length,true);cv.setUint16(30,0,true);cv.setUint16(32,0,true);
    cv.setUint16(34,0,true);cv.setUint16(36,0,true);cv.setUint32(38,0,true);cv.setUint32(42,off,true);
    ch.set(nb,46);central.push(ch);
    off+=lh.length+len;
  }
  let cdSize=0;for(const c of central)cdSize+=c.length;
  const eo=new Uint8Array(22),ev=new DataView(eo.buffer);
  ev.setUint32(0,0x06054b50,true);ev.setUint16(4,0,true);ev.setUint16(6,0,true);
  ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);
  ev.setUint32(12,cdSize,true);ev.setUint32(16,off,true);ev.setUint16(20,0,true);
  return new Blob(parts.concat(central,[eo]),{type:"application/zip"});
}

/* A kerb step or a window reveal is ten times the surface's own relief, so an
   8-bit height map quantises the flat parts into a couple of dozen levels.
   This writes a real 16-bit greyscale PNG, deflating through CompressionStream. */
/* Takes the state rather than reading the active one: the wizard packs faces
   whose mode is NOT on screen, and reading `active` there wrote the wrong
   building's height into three of the four folders. */
async function png16Height(st){
  if(typeof CompressionStream==="undefined")return null;
  const B=(st||active).B,w=B.W,h=B.H,HGT=B.HGT;
  const raw=new Uint8Array((w*2+1)*h);
  const inv=65535/((B.hMax-B.hMin)||1),lo=B.hMin;
  let p=0;
  for(let yy=0;yy<h;yy++){
    raw[p++]=0;                                   // filter: none
    for(let xx=0;xx<w;xx++){
      let sv=Math.round((HGT[yy*w+xx]-lo)*inv);
      if(sv<0)sv=0;else if(sv>65535)sv=65535;
      raw[p++]=sv>>>8;raw[p++]=sv&255;            // PNG samples are big-endian
    }
  }
  const cs=new CompressionStream("deflate");
  const wr=cs.writable.getWriter();wr.write(raw);wr.close();
  const z=new Uint8Array(await new Response(cs.readable).arrayBuffer());
  const chunk=(type,data)=>{
    const out=new Uint8Array(12+data.length),n=data.length;
    out[0]=(n>>>24)&255;out[1]=(n>>>16)&255;out[2]=(n>>>8)&255;out[3]=n&255;
    for(let i=0;i<4;i++)out[4+i]=type.charCodeAt(i);
    out.set(data,8);
    const c=crc32(out.subarray(4,8+n));
    out[8+n]=(c>>>24)&255;out[9+n]=(c>>>16)&255;out[10+n]=(c>>>8)&255;out[11+n]=c&255;
    return out;
  };
  const ih=new Uint8Array(13);
  ih[0]=(w>>>24)&255;ih[1]=(w>>>16)&255;ih[2]=(w>>>8)&255;ih[3]=w&255;
  ih[4]=(h>>>24)&255;ih[5]=(h>>>16)&255;ih[6]=(h>>>8)&255;ih[7]=h&255;
  ih[8]=16;ih[9]=0;                                // 16-bit greyscale
  const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),
    chunk("IHDR",ih),chunk("IDAT",z),chunk("IEND",new Uint8Array(0))];
  let len=0;for(const q of parts)len+=q.length;
  const out=new Uint8Array(len);let o=0;
  for(const q of parts){out.set(q,o);o+=q.length;}
  return out;
}
async function downloadH16(){
  if(!exportGuard())return;
  const st=active;
  setStatus("Encoding 16-bit height…");
  const png=await png16Height();
  if(!png){setStatus("16-bit needs CompressionStream — not in this browser");return;}
  const url=saveBlob(new Blob([png],{type:"image/png"}),fileName(st,"height16"));
  setTimeout(()=>URL.revokeObjectURL(url),20000);
  setStatus(sizeTag(st)+" · 16-bit height saved");
}
async function downloadZip(){
  if(!exportGuard())return;
  const st=active,btn=el("zipall"),save=el("zipsave");
  btn.disabled=true;save.hidden=true;
  try{
    const files=[];let n=0;
    for(const ch of st.mode.channels){
      setStatus("Packing "+ch.label+"…");
      setBar(++n/(st.mode.channels.length+1));
      await new Promise(r=>setTimeout(r,0));            // let the status repaint
      const blob=await new Promise((res,rej)=>{
        const cv=makeMap(st,ch.key);
        if(!cv.toBlob){rej(new Error("this browser can't encode canvas PNGs"));return;}
        cv.toBlob(b=>b?res(b):rej(new Error("PNG encode failed on "+ch.key)),"image/png");
      });
      files.push({name:fileName(st,ch.key),data:new Uint8Array(await blob.arrayBuffer())});
    }
    if(st.mode.height16!==false){
      const h16=await png16Height(st);
      if(h16)files.push({name:fileName(st,"height16"),data:h16});
    }
    files.push({name:fileBase(st)+"_readme.txt",
      data:new TextEncoder().encode(readmeText(st))});
    /* GEOMETRY. Every mode already knows how big the thing it drew really is —
       it prints it in the readout — so the zip carries a plane at that size
       with these maps already wired to it, rather than a paragraph telling you
       what to scale a plane to. See forge-model.js. */
    if(window.ForgeModel){
      const plan=ForgeModel.planOf(st.mode,st.P);
      const maps={};
      for(const ch of st.mode.channels)maps[ch.key]=fileName(st,ch.key);
      for(const f of ForgeModel.filesForFace(st.mode.id,plan,maps,plan.cutout&&!!maps.opacity))
        files.push(f);
    }
    const zip=makeZip(files),name=fileBase(st)+".zip";
    if(st.zipUrl)URL.revokeObjectURL(st.zipUrl);
    st.zipUrl=saveBlob(zip,name);
    save.href=st.zipUrl;save.download=name;
    save.textContent="Save "+name+" ("+(zip.size/1048576).toFixed(1)+" MB)";
    save.hidden=false;
    setBar(0);
    setStatus(files.length+" files packed · click save if nothing downloaded");
  }catch(err){
    setBar(0);setStatus("Zip failed — "+((err&&err.message)||err));console.error(err);
  }finally{btn.disabled=false;}
}
function readmeText(st){
  const B=st.B;
  let txt=st.mode.readme(st.P,{
    W:B.W,H:B.H,hMin:B.hMin,hMax:B.hMax,
    /* whatever the build recorded about itself, for a mode whose readme wants
       to say what came out rather than only what was asked for */
    census:B.census||null,
    normalNote:st.P.flipG?"DirectX (green down)":"OpenGL (green up)"
  });
  /* a palettised basecolor that does not say so is a file somebody re-exports
     six months later wondering why the colours will not match */
  const pal=window.Palette&&Palette.describe();
  if(pal)txt+="\n\nPALETTE\nbasecolor.png was snapped to "+pal+".\n"+
    "Every other channel is untouched full-range data — normal, roughness,\n"+
    "metallic, AO, height and ORM are never quantised.";
  /* the bake is the one channel you cannot re-derive from the others without
     knowing the numbers, so they go in the file next to it */
  if(window.ForgeUnlit)txt+="\n\nUNLIT BAKE\n"+
    "unlit.png is the whole material with one lighting solution already in it:\n"+
    "base colour, normal, roughness, metallic, AO and emissive resolved through\n"+
    "the same GGX model the lit preview uses. Use it as an unlit / emissive\n"+
    "base colour on a target with no lighting, and ignore the other maps.\n"+
    "It is not a replacement for basecolor.png — feeding a baked map back into\n"+
    "a lit shader lights it twice.\n"+
    "Settings: "+ForgeUnlit.describe()+".";
  return txt;
}

/* ============================ run loop ============================ */

function setBar(t){el("bar").style.width=(clamp(t,0,1)*100).toFixed(1)+"%";}
function setStatus(s){el("status").textContent=s;}
function sizeTag(st){
  const B=st.B;
  return B.W+"×"+B.H+(st.mode.sizeTag?" · "+st.mode.sizeTag(st.P):"")+" · seed "+(st.P.seed|0);
}

/* `then` fires once the build has SETTLED — after any queued rebuild this one
   pulled in behind it, not after the first pass. Polling st.busy instead cannot
   work: a pending rebuild flips it back to true inside the same callback that
   cleared it, so an observer never sees the idle moment. */
/* ============================ the worker pool ============================
   A generator is a per-texel loop over typed arrays with no business on the
   thread that is also trying to keep a slider moving. This hands the loop to a
   worker; forge-worker.js is the other half.

   FALLING BACK IS NOT AN ERROR. On file:// a worker has no origin and cannot
   be constructed at all, and the app is meant to run from a folder — so every
   path here ends in "do it on the main thread instead", quietly. The pool
   switches itself off at the first sign of trouble rather than retrying, since
   whatever stopped it will stop it again.

   A build IS NOT SPLIT ACROSS THREADS. Every generator is a sequential row
   loop and banding one would mean rewriting sixteen of them. What this buys is
   a main thread that stays responsive, and — where it matters most — several
   whole builds at once: the wizard's four faces of a building go out to four
   cores instead of queueing behind each other. */

const THREADS=Math.max(1,Math.min(6,(navigator.hardwareConcurrency||4)-1));
let wpool=[],wqueue=[],wjobs={},wseq=1,wOff=false,wFiles=null,wTried=false;

/* may be a plain value or a function of the parameters, the same way seamless
   and backdrops are: the diner is threadable until you ask it for neon */
function threadable(m,P){
  const t=m.threadable;
  return typeof t==="function"?!!t(P):!!t;
}
/* one place says which modes exist, and it is index.html */
function workerFiles(){
  if(wFiles)return wFiles;
  wFiles=[].slice.call(document.querySelectorAll("script[src]"))
    .map(function(x){return x.src;})
    .filter(function(u){return /forge-math\.js($|\?)/.test(u)||/\/modes\//.test(u);});
  return wFiles;
}
function poolDown(why){
  if(wOff)return;
  wOff=true;
  for(const r of wpool){try{r.w.terminate();}catch(e){}}
  wpool=[];
  const ids=wqueue.splice(0);
  for(const id of ids){const j=wjobs[id];delete wjobs[id];if(j)j.rej(new Error(why||"pool down"));}
  for(const id in wjobs){const j=wjobs[id];delete wjobs[id];j.rej(new Error(why||"pool down"));}
}
function spawnWorker(){
  let w;
  try{w=new Worker("forge-worker.js");}
  catch(e){poolDown("workers are not available here");return null;}
  const rec={w:w,ready:false,job:0};
  w.onerror=function(){poolDown("the worker failed to load");};
  w.onmessage=function(ev){
    const m=ev.data||{};
    if(m.boot!==undefined){
      if(!m.boot){poolDown(m.error||"the worker would not boot");return;}
      rec.ready=true;pumpPool();
      return;
    }
    const j=wjobs[m.id];
    if(!j)return;
    if(m.progress!==undefined){if(j.onProgress)j.onProgress(m.progress);return;}
    delete wjobs[m.id];rec.job=0;
    if(m.ok)j.res(m.B);else j.rej(new Error(m.error||"the worker gave up"));
    pumpPool();
  };
  wpool.push(rec);
  w.postMessage({cmd:"load",files:workerFiles()});
  return rec;
}
function pumpPool(){
  while(wqueue.length&&!wOff){
    let free=null;
    for(const r of wpool)if(r.ready&&!r.job){free=r;break;}
    if(!free){
      if(wpool.length<THREADS)spawnWorker();
      break;                                   // whether one is warming up or all are busy
    }
    const id=wqueue.shift();
    const j=wjobs[id];
    if(!j)continue;
    free.job=id;
    free.w.postMessage(j.msg);
  }
}
function poolBuild(modeId,P,W,H,preview,onProgress){
  return new Promise(function(res,rej){
    if(wOff)return rej(new Error("pool off"));
    wTried=true;
    const id=wseq++;
    wjobs[id]={res:res,rej:rej,onProgress:onProgress,
               msg:{cmd:"build",id:id,mode:modeId,P:P,W:W,H:H,preview:!!preview}};
    wqueue.push(id);
    pumpPool();
  });
}
/* structured clone wants plain data, and a parameter object is exactly that */
const plainP=P=>JSON.parse(JSON.stringify(P));

Forge.pool=function(){
  return {threads:THREADS,live:wpool.length,ready:wpool.filter(r=>r.ready).length,
          off:wOff,tried:wTried};
};

function run(st,preview,then){
  if(then)(st.after||(st.after=[])).push(then);
  if(st.busy){st.pending=!!preview;return;}
  const m=st.mode;
  st.busy=true;
  st.preview=!!preview&&!!m.previewSize;
  const btn=el(pid(st,"forge"));
  if(btn)btn.disabled=true;
  if(st===active)setStatus(st.preview?"Previewing…":(m.busyLabel||"Forging…"));
  const t0=performance.now();
  const full=m.size(st.P,false);
  const dim=m.size(st.P,st.preview);
  const io={
    W:dim.w,H:dim.h,preview:st.preview,
    progress:t=>{if(st===active)setBar(t);},
    done:B=>{
      B.W=dim.w;B.H=dim.h;
      st.B=B;st.built=true;st.busy=false;
      st.flags={seamless:flag(m,"seamless",st.P),backdrops:flag(m,"backdrops",st.P)};
      if(btn)btn.disabled=false;
      makeWriters(st);
      /* a face the wizard is standing on has just been forged, so the building
         gets it — before the repaint below, which is what draws it */
      if(wiz){
        const step=wizSteps()[wiz.i];
        if(step&&step.mode===m.id){wizMade(step.id,st);wizTicks();}
      }
      if(st===active){
        syncChrome(st);
        setBar(0);
        el("zipsave").hidden=true;                  // any previous archive is stale
        setStatus(st.preview&&B.W<full.w
          ? B.W+" px preview · release for "+full.w
          : sizeTag(st)+" · "+Math.round(performance.now()-t0)+" ms");
        buildChips();renderView();
      }
      if(st.pending!==null){const p=st.pending;st.pending=null;run(st,p);}
      else{const waiting=st.after;st.after=null;if(waiting)for(const f of waiting)f();}
    }
  };
  /* off the main thread where the mode says it is safe to; on it, quietly, in
     every case where it is not or where the pool cannot be had */
  if(!wOff&&threadable(m,st.P)){
    poolBuild(m.id,plainP(st.P),dim.w,dim.h,st.preview,io.progress)
      .then(io.done,()=>{try{m.build(st.P,io);}catch(e){
        st.busy=false;if(btn)btn.disabled=false;
        setStatus("Build failed — "+((e&&e.message)||e));console.error(e);}});
  }else{
    m.build(st.P,io);
  }
}
function queue(st,preview){
  const m=st.mode;
  const usePreview=!!preview&&!!m.previewSize;
  /* heavy sizes are forged on demand only; a mode with a drag preview still
     gets its small preview, a mode without one waits for the button */
  if(!usePreview&&(st.P.size|0)>1024){
    if(st===active)setStatus("Press "+verb(m)+" to rebuild at "+(st.P.size|0)+" px");
    return;
  }
  clearTimeout(st.qTimer);
  st.qTimer=setTimeout(()=>run(st,usePreview),usePreview?90:40);
}

/* ============================ structures ============================
   A house is four textures and a diner is three, and the way they stop being
   one building is that you dial twenty settings into the first panel and then
   dial nineteen of them into the next. The "coordinate" tick in the house
   family mirrors settings between panels once you know to look for it; this is
   the other half of the same idea, for the case where you do not yet know what
   the building IS.

   A structure is a list of steps, each naming a mode and whatever that step
   pins down (which face it is). Walking the list, every step OPENS with the
   values the steps before it settled on — every parameter its mode declares
   that an earlier one also declared — so the side elevation already knows the
   depth, the cladding, the trim and the weathering by the time you see it, and
   the roof already knows the seed. Those inherited rows are marked, and the
   moment you change one it stops being inherited and becomes what the steps
   after it inherit instead.

   Resolution is never carried: how many texels you want of a given face is a
   property of the export, not of the building. Nor is the face itself, which is
   the one thing the step pins. */

const STRUCTURES=Forge.structures,STRUCT_BY=Forge.structById;

/* Never carried between wizard steps: `size`, because how many texels a face
   needs is a property of the export rather than of the building, and `face` /
   `piece`, because naming which side of the thing this step draws is the one
   job a step exists to do. */
const WIZ_NEVER={size:1,face:1,piece:1};
let wiz=null;                                    // {s, i, snap, vals, reached}

function wizSteps(){return wiz?wiz.s.steps:[];}

/* WHERE ONE THING ENDS AND THE NEXT BEGINS. A structure used to be one
   building, and one building's faces should all inherit from its front: change
   the cladding on the front and the side follows, which is the whole point.

   A TOWN IS NOT ONE BUILDING. Its steps are a house, then a diner, then a
   works, then the road — and a diner that opened on the house's clapboard and
   the house's storey height would be a house with a neon sign on it. So a step
   may declare itself `fresh`: nothing is carried into it, it opens on whatever
   its own mode is holding, and it starts a new pool for the steps after it.
   Within a group nothing changes; between groups nothing carries. */
function wizGroupStart(i){
  const steps=wizSteps();
  for(let k=Math.min(i,steps.length-1);k>=0;k--)if(steps[k].fresh)return k;
  return 0;
}

/* What the steps of THIS group settled on before step i. Built from per-step
   snapshots rather than from a running total, because a running total cannot
   be walked backwards: stepping back from the diner to the house roof used to
   hand the roof the diner's numbers. */
function wizPool(i){
  const out={};
  if(!wiz)return out;
  for(let k=wizGroupStart(i);k<i;k++){
    const sn=wiz.snap[k];
    if(sn)for(const id in sn)out[id]=sn[id];
  }
  return out;
}

/* the live values of whichever step is on screen, which is what a snapshot is
   taken of */
function wizLive(){
  const out={};
  if(!wiz)return out;
  const st=STATE[wiz.s.steps[wiz.i].mode];
  if(st&&st.params){
    readParams(st);
    for(const d of st.params){
      if(WIZ_NEVER[d.id])continue;
      out[d.id]=st.P[d.id];
    }
  }
  return out;
}

/* everything this step's group has settled on, ready for the next one to take
   what it recognises */
function wizRecord(){
  if(!wiz)return;
  wiz.snap[wiz.i]=wizLive();
  wiz.vals=wizPool(wiz.i);
}

/* Everything the group settled on, PLUS whatever the step on screen has moved
   since. Snapshots are only written on the way OUT of a step, which is soon
   enough for the step after it to inherit and far too late for a building that
   has to change shape while the slider is still moving. */
function wizVals(){
  const out=wizPool(wiz?wiz.i:0),live=wizLive();
  for(const k in live)out[k]=live[k];
  return out;
}

/* What a step would OPEN with, worked out without opening it: the values
   settled so far, overlaid with the one thing this step pins for itself. It
   reads no DOM and writes none — which is what lets the massing of all four
   faces follow one slider, including the three faces that are not on screen. */
function wizProjected(step,vals){
  const st=STATE[step.mode];
  if(!st||!st.params)return null;
  const P=plainP(st.P);
  for(const d of st.params){
    if(WIZ_NEVER[d.id])continue;
    if(d.id in vals)P[d.id]=vals[d.id];
  }
  for(const k in (step.set||{}))P[k]=step.set[k];
  return P;
}

/* The fingerprint of a face: everything it would be forged from if you forged
   it now. A built face whose fingerprint has moved on was forged from
   something else — usually because a later step changed a value it had
   inherited. Resolution is deliberately out of it; a face rebuilt at 2048 is
   the same face. */
function wizSig(step,vals){
  return wizSigOf(wizProjected(step,vals||wizVals()));
}
function wizSigOf(P){
  if(!P)return "";
  const Q=plainP(P);
  delete Q.size;
  return JSON.stringify(Q);
}

/* mark the rows this step did not choose for itself, so it is obvious which
   numbers arrived from the face before and which ones you set */
function wizMark(modeId,carried){
  const st=STATE[modeId];
  if(!st||!st.params)return;
  for(const d of st.params){
    const n=node(st,d.id);
    if(!n)continue;
    const row=n.closest(".row");
    if(!row)continue;
    const on=!!carried[d.id];
    row.classList.toggle("carried",on);
    if(on)row.title="Carried over from an earlier face — change it and the faces after this one take yours instead";
    else row.removeAttribute("title");
  }
}

/* ---------------------------------------------------------------------------
   THE BUILDING

   Two things feed the 3D view and they arrive at different rates. The SHAPE is
   pure arithmetic off the parameters — every mode's plan() already reports the
   real size of the face it would draw, in metres, because that is what writes
   the glTF — so the box can follow a slider at whatever rate the slider moves,
   with nothing forged at all. The SURFACES arrive one at a time, as each step
   is actually built.

   That split is the whole design: you get the massing of the building you are
   describing from the first step, and it fills in as you walk.
   --------------------------------------------------------------------------- */

const STAGE_TEX=512;                   // per-face capture: POT, mip-able, cheap
let stageSig="";                       // the massing last handed to the stage

function stageAccent(){
  if(!stageOK)return;
  try{
    const c=getComputedStyle(document.body).getPropertyValue("--accent");
    if(c)ForgeStage.accent(c);
  }catch(e){}
}

/* The same call, with the same plans, that writes model.gltf when the wizard
   packs the archive. Not a second idea of what the building is. */

/* every step's plan, worked out without visiting it. The step on screen
   contributes what it is showing right now; every other step contributes what
   its own group settled on, which is what keeps a town's diner off the house's
   numbers. */
function stagePlans(){
  const steps=wizSteps(),by={};
  for(let k=0;k<steps.length;k++){
    const step=steps[k],st=STATE[step.mode];
    if(!st)continue;
    const P=wizProjected(step,(k===wiz.i)?wizVals():wizPool(k));
    if(!P)continue;
    const plan=ForgeModel.planOf(st.mode,P);
    by[step.id]={plan:plan,material:{name:step.id,maps:{},cutout:plan.cutout}};
  }
  return by;
}

/* ---------------------------------------------------------------------------
   THE TOWN

   Same idea as one building's massing and the same plans behind it, only the
   thing being assembled is a street grid with a few hundred buildings on it.
   The layout is pure arithmetic off the plans — how wide a house is, how deep,
   how wide the road tile covers — so the town reorganises itself while a
   slider is still moving, with nothing forged at all, exactly as one
   building's box does.
   --------------------------------------------------------------------------- */
const TOWN={seed:1963,cols:5,rows:4,blockW:70,blockD:55,jitter:0.35,
            setback:5,gap:2.5,density:0.85,industry:0.6,
            mix:{house:1,diner:1,factory:1}};
let townL=null;                        // the layout the stage is showing

/* the kit, as {type:{front,side,back,roof}} of plan-and-material objects, plus
   the real footprint of each type for the layout to fit its lots to */
function townKit(by){
  const K=wiz&&wiz.s.town&&wiz.s.town.kit;
  if(!K)return null;
  const kit={},sizes={};
  for(const type in K){
    const m=K[type];
    if(type==="street"){
      const run=by[m.run],inter=by[m.inter];
      if(run)kit.street={run:run,inter:inter||run};
      continue;
    }
    const front=by[m.front];
    if(!front)continue;
    const side=by[m.side]||front,back=by[m.back]||front,roof=by[m.roof]||null;
    if(TOWN.mix[type]===0)continue;              // switched off, so not in the kit
    kit[type]={front:front,side:side,back:back,roof:roof};
    sizes[type]={w:front.plan.w,d:side.plan.w};
  }
  return {kit:kit,sizes:sizes};
}

function townLayout(by){
  const K=townKit(by);
  if(!K||!K.kit.house&&!K.kit.diner&&!K.kit.factory)return null;
  /* THE ROAD'S OWN TILE IS THE CORRIDOR WIDTH. The street texture spans a
     whole cross-section — lanes, shoulders, kerbs, footways — so a town that
     picked its own road width would be stretching the kerbs to reach it. */
  const road=K.kit.street&&K.kit.street.run;
  const roadM=(road&&(road.plan.tile||road.plan.w))||14;
  const P={};
  for(const k in TOWN)P[k]=TOWN[k];
  P.roadM=roadM;
  const L=ForgeTown.layout(P,K.sizes);
  L.kit=K.kit;L.sizes=K.sizes;
  townApplyEdits(L);
  ForgeTown.settle(L);
  return L;
}

/* ---------------------------------------------------------------------------
   DESIGN MODE

   The generator's answer is a starting point, not a verdict. Click a building
   and it lights up on its own; then swap what it is, turn it, slide it along
   its frontage or take it away, and the town keeps the rest of itself exactly
   where it was.

   EDITS ARE KEPT BY LOT, NOT BAKED IN. Regenerating from the same numbers
   lands the same lots in the same order, so an edit survives a rebuild of the
   scene, a re-forged texture and a change of camera. It does not survive a
   change to the GRID — different block sizes are different lots and there is
   nothing honest to map an edit onto — so those clear the edits and say so.
   --------------------------------------------------------------------------- */
let townEdits={},townSel=-1;

function townApplyEdits(L){
  const drop=[];
  for(const lot of L.lots){
    const e=townEdits[lot.i];
    if(!e)continue;
    if(e.gone){drop.push(lot.i);continue;}
    if(e.type&&e.type!==lot.type)ForgeTown.retype(lot,e.type,L.sizes);
    if(e.rot!==undefined)lot.rot=e.rot;
    if(e.along!==undefined)lot.along=e.along;
    if(e.variant!==undefined)lot.variant=e.variant;
  }
  if(drop.length){
    const gone={};
    for(const i of drop)gone[i]=1;
    /* the index a lot answers to is the index it was BORN with, because that is
       what an edit is filed under — so removing one must not renumber the rest */
    L.lots=L.lots.filter(x=>!gone[x.i]);
  }
}

/* the scene, with whatever is selected split out so it can be lit on its own */
function townDraw(){
  if(!wiz||!wiz.s.town||!townL||!stageOK)return;
  ForgeStage.setScene(ForgeModel.townScene(wiz.s.id,townL,townL.kit,{select:townSel}));
}
function townLotAt(i){
  if(!townL)return null;
  for(const lot of townL.lots)if(lot.i===i)return lot;
  return null;
}
/* a change to the town's own numbers: the grid moves, so the edits cannot
   follow and the scene is built from scratch */
function townRegrid(){
  townEdits={};townSel=-1;
  stageSig="";townL=null;
  stageSync();townBarSync();
}
/* a change to ONE building: the grid is untouched, so only the scene is */
function townEdit(fn){
  const lot=townLotAt(townSel);
  if(!lot)return;
  const e=townEdits[lot.i]||(townEdits[lot.i]={});
  fn(lot,e);
  townApplyEdits(townL);
  ForgeTown.settle(townL);
  townDraw();
  ForgeStage.draw();
  townBarSync();
}

function stageScene(){
  if(!wiz||!stageOK||!window.ForgeModel)return;
  const by=stagePlans();
  const steps=wizSteps();

  if(wiz.s.town&&window.ForgeTown){
    const sig=JSON.stringify([TOWN,steps.map(x=>by[x.id]&&by[x.id].plan)]);
    if(sig===stageSig)return;
    stageSig=sig;
    try{
      const L=townLayout(by);
      const first=!townL;
      townL=L;
      if(L){
        if(townSel>=0&&!townLotAt(townSel))townSel=-1;
        townDraw();
        /* a town is looked DOWN at. At the street-view pitch a building is
           right and four hundred metres of grid is edge-on slots between
           roofs, so the first sight of it is from the air; after that the
           pitch is whatever the last drag left. */
        if(first&&ForgeStage.look)ForgeStage.look(-0.62,0.62);
      }
    }catch(e){console.warn("ForgeStage: "+(e&&e.message||e));}
    return;
  }

  const order=steps.map(x=>x.id);
  const at=i=>(order[i]&&order[i]!=="roof")?by[order[i]]:null;
  const front=by.front||at(0);
  if(!front)return;
  /* rebuilding the buffers costs little, but doing it on every repaint of a
     building nobody has resized costs it for nothing */
  const sig=JSON.stringify(order.map(id=>by[id]&&by[id].plan));
  if(sig===stageSig)return;
  stageSig=sig;
  try{
    ForgeStage.setScene(ForgeModel.buildingScene(wiz.s.id,{
      front:front,side:by.side||at(1),back:by.back||at(2),roof:by.roof||null}));
  }catch(e){console.warn("ForgeStage: "+(e&&e.message||e));}
}

/* ---------------------------------------------------------------------------
   THE TOWN BAR

   A street grid is not a texture, so its numbers do not belong in a mode's
   panel — they belong next to the picture of the town, where you can see what
   they do. Built in script because it is the same row whatever is loaded, and
   shown only in the 3D view of a structure that declares itself a town.
   --------------------------------------------------------------------------- */
const TOWN_ROWS=[
  {id:"cols",   label:"Across", min:1,max:10,step:1,grid:true},
  {id:"rows",   label:"Deep",   min:1,max:10,step:1,grid:true},
  {id:"blockW", label:"Block",  min:24,max:160,step:2,unit:"m",grid:true},
  {id:"blockD", label:"Depth",  min:24,max:160,step:2,unit:"m",grid:true},
  {id:"jitter", label:"Ragged", min:0,max:1,step:0.05,grid:true},
  {id:"density",label:"Built",  min:0,max:1,step:0.05,grid:true},
  {id:"industry",label:"Works", min:0,max:1,step:0.05,grid:true}
];
let townBarBuilt=false;

function townBar(){
  const bar=el("townbar");
  if(!bar||townBarBuilt)return;
  townBarBuilt=true;
  bar.appendChild(make("span","pallab","Town"));

  const seed=document.createElement("label");
  seed.innerHTML='<span>Seed</span>';
  const sn=document.createElement("input");
  sn.type="number";sn.id="town-seed";sn.step="1";sn.value=TOWN.seed;
  sn.addEventListener("change",()=>{TOWN.seed=sn.value|0;townRegrid();});
  seed.appendChild(sn);
  bar.appendChild(seed);

  const roll=make("button","tab","Re-roll");
  roll.type="button";
  roll.title="A different town off the same numbers";
  roll.addEventListener("click",()=>{
    TOWN.seed=(Math.random()*1e6)|0;
    const n=el("town-seed");if(n)n.value=TOWN.seed;
    townRegrid();
  });
  bar.appendChild(roll);

  for(const r of TOWN_ROWS){
    const lab=document.createElement("label");
    lab.title=r.label;
    lab.innerHTML="<span>"+r.label+"</span>";
    const inp=document.createElement("input");
    inp.type="range";inp.id="town-"+r.id;
    inp.min=r.min;inp.max=r.max;inp.step=r.step;inp.value=TOWN[r.id];
    const out=make("span","","");
    out.id="town-"+r.id+"-val";
    const show=()=>{out.textContent=(r.step<1?(+inp.value).toFixed(2):inp.value)+(r.unit||"");};
    show();
    inp.addEventListener("input",()=>{
      TOWN[r.id]=+inp.value;show();
      townRegrid();
    });
    lab.appendChild(inp);lab.appendChild(out);
    bar.appendChild(lab);
  }

  /* what is selected, and the four things you can do to it */
  const note=make("span","selnote","Click a building to work on it");
  note.id="town-sel";
  bar.appendChild(note);
  const act=(label,title,fn)=>{
    const b=make("button","tab",label);
    b.type="button";b.title=title;b.dataset.townact="1";
    b.addEventListener("click",fn);
    bar.appendChild(b);
    return b;
  };
  act("Type","Put a different kind of building on this lot",()=>{
    const lot=townLotAt(townSel);
    if(!lot||!townL)return;
    const kinds=Object.keys(townL.sizes||{});
    if(!kinds.length)return;
    const at=kinds.indexOf(lot.type);
    /* the next kind that will actually FIT this ground, because a works does
       not go on a house lot and offering it anyway is a lie */
    for(let k=1;k<=kinds.length;k++){
      const want=kinds[(at+k)%kinds.length];
      if(want===lot.type)continue;
      const trial=Object.assign({},lot);
      if(ForgeTown.retype(trial,want,townL.sizes)){
        townEdit((l,e)=>{e.type=want;});
        return;
      }
    }
    setStatus("Nothing else fits on that lot");
  });
  act("Turn","A quarter turn on the spot",()=>
    townEdit((l,e)=>{e.rot=(l.rot||0)+Math.PI/2;}));
  act("Shift","Slide it along its own frontage",()=>
    townEdit((l,e)=>{
      const step=Math.max(0.5,l.slide*0.5);
      let a=(l.along||0)+step;
      if(a>l.slide+0.001)a=-l.slide;
      e.along=a;
    }));
  act("Re-roll","A different draw of the dice for this one building",()=>
    townEdit((l,e)=>{e.variant=(Math.random()*1e9)|0;}));
  act("Clear","Take this building away and leave the lot empty",()=>{
    const lot=townLotAt(townSel);
    if(!lot)return;
    townEdits[lot.i]=Object.assign(townEdits[lot.i]||{},{gone:true});
    townSel=-1;
    townApplyEdits(townL);ForgeTown.settle(townL);
    townDraw();ForgeStage.draw();townBarSync();
  });
  act("Put back","Undo every edit and take the generator's answer",()=>{
    townEdits={};townSel=-1;
    stageSig="";stageSync();townBarSync();
  });
}

function townBarSync(){
  const bar=el("townbar");
  if(!bar)return;
  const on=!!(wiz&&wiz.s.town&&view===BUILD_VIEW&&stageOK);
  bar.hidden=!on;
  if(!on)return;
  townBar();
  for(const r of TOWN_ROWS){
    const n=el("town-"+r.id);
    if(n&&+n.value!==TOWN[r.id]){
      n.value=TOWN[r.id];
      const o=el("town-"+r.id+"-val");
      if(o)o.textContent=(r.step<1?(+n.value).toFixed(2):n.value)+(r.unit||"");
    }
  }
  const lot=townLotAt(townSel),note=el("town-sel");
  if(note)note.textContent=lot
    ?("Selected: "+lot.type+(lot.main?" on Main Street":"")+
      " · "+lot.w.toFixed(1)+" × "+lot.d.toFixed(1)+" m"+
      (townEdits[lot.i]?" · edited":""))
    :(Object.keys(townEdits).length
        ?Object.keys(townEdits).length+" buildings edited · click one to work on it"
        :"Click a building to work on it");
  for(const b of bar.querySelectorAll("[data-townact]"))b.disabled=!lot;
}

function stageSync(){
  if(!wiz||!stageOK)return;
  stageScene();
  townBarSync();
  stageAccent();
  const step=wizSteps()[wiz.i];
  ForgeStage.mark(step?step.id:null);
  const tag=el("stagetag");
  if(tag&&!ForgeStage.hovered())tag.textContent=stageLabel();
  ForgeStage.draw();
}
/* what the corner of the stage says when the cursor is not on a wall: the
   building, and how many of its faces are actually there yet */
function stageLabel(){
  if(!wiz)return "";
  const steps=wizSteps();
  let n=0;
  for(const x of steps)if(wiz.made[x.id])n++;
  const made=n+" of "+steps.length+" textures forged"+
             (n<steps.length?" · the rest is massing":"");
  if(wiz.s.town&&townL){
    const c=ForgeTown.census(townL);
    const kinds=Object.keys(c.by).sort().map(k=>c.by[k]+" "+k+(c.by[k]===1?"":"s")).join(" · ");
    return wiz.s.label+" · "+c.lots+" buildings on "+c.blocks+" blocks"+
           (kinds?" · "+kinds:"")+" · "+made;
  }
  return wiz.s.label+" · "+made;
}

/* A face, as it stands, onto the building. These are the same canvases
   makeMap() hands the channel chips and the archive — at 512 px, which is
   everything a wall a few hundred pixels across can show, and small enough
   that five faces' worth of base colour, normal, ORM and emissive is not the
   reason a laptop's fan comes on. */
function wizMade(id,st){
  if(!wiz||!st||!st.B)return;
  /* the fingerprint comes off the params this build actually used, not off the
     panel — during a build-everything pass the panel is showing a different
     face from the one being packed */
  wiz.made[id]={sig:wizSigOf(st.P)};
  if(!stageOK)return;
  const maps={basecolor:makeMap(st,"basecolor",STAGE_TEX),
              normal:makeMap(st,"normal",STAGE_TEX),
              orm:makeMap(st,"orm",STAGE_TEX)};
  if(st.writers&&st.writers.emissive)maps.emissive=makeMap(st,"emissive",STAGE_TEX);
  let cut=false;
  try{cut=!!ForgeModel.planOf(st.mode,st.P).cutout;}catch(e){}
  ForgeStage.setFace(id,maps,cut);
}

/* the rail says which faces exist and which of them have been overtaken */
function wizTicks(){
  if(!wiz)return;
  const rail=el("wiz-steps"),steps=wizSteps();
  for(let k=0;k<steps.length&&k<rail.children.length;k++){
    const made=wiz.made[steps[k].id],b=rail.children[k];
    if(!made){b.removeAttribute("data-made");continue;}
    /* EACH STEP AGAINST ITS OWN GROUP. A town's diner does not go stale
       because the house moved; measured against one pool for the whole
       structure, every step after the first came out marked for rebuild the
       moment anything anywhere changed. */
    const vals=(k===wiz.i)?wizVals():wizPool(k);
    b.dataset.made=(made.sig===wizSig(steps[k],vals))?"yes":"stale";
  }
}

function wizEnter(i){
  const steps=wizSteps();
  /* the step being left leaves its numbers behind whether or not the caller
     remembered to record them — wizSeeAll walks every step without stopping */
  if(steps[wiz.i])wiz.snap[wiz.i]=wizLive();
  wiz.i=clamp(i,0,steps.length-1);
  if(wiz.i>wiz.reached)wiz.reached=wiz.i;
  const step=steps[wiz.i];
  const pool=wizPool(wiz.i);
  wiz.vals=pool;
  activate(step.mode);
  const st=STATE[step.mode];
  const carried={};
  if(st&&st.params){
    for(const d of st.params){
      if(WIZ_NEVER[d.id])continue;
      if(!(d.id in pool))continue;
      Forge.setParam(step.mode,d.id,pool[d.id]);
      carried[d.id]=1;
    }
    /* what the STEP pins beats anything carried: this is the side elevation
       whatever the front thought the face was */
    for(const k in (step.set||{})){
      Forge.setParam(step.mode,k,step.set[k]);
      delete carried[k];
    }
    readParams(st);
  }
  wizMark(step.mode,carried);
  /* activate() short-circuits when the step before this one used the same mode
     — three faces of a diner are one panel — so the tabs are rebuilt here
     rather than relying on it having happened */
  buildViewTabs(STATE[step.mode]||st);
  wizSync();
  if(view===BUILD_VIEW)stageSync();
  queue(st,false);
}

function wizGo(i){
  if(!wiz)return;
  wizRecord();
  wizEnter(i);
}

function wizSync(){
  const bar=el("wizbar");
  if(!wiz){bar.hidden=true;document.body.dataset.wizard="off";return;}
  bar.hidden=false;
  document.body.dataset.wizard="on";
  const steps=wizSteps();
  el("wiz-name").textContent=wiz.s.label;
  const rail=el("wiz-steps");
  rail.innerHTML="";
  for(let k=0;k<steps.length;k++){
    const b=make("button","tab",(k+1)+". "+steps[k].label);
    b.type="button";b.dataset.step=k;
    b.setAttribute("aria-pressed",String(k===wiz.i));
    if(k>wiz.reached+1)b.disabled=true;          // one step ahead is as far as you can jump
    rail.appendChild(b);
  }
  wizTicks();
  el("wiz-note").innerHTML=steps[wiz.i].note||"";
  el("wiz-back").disabled=wiz.i===0;
  el("wiz-next").disabled=wiz.i>=steps.length-1;
}

function wizStart(id){
  const s=STRUCT_BY[id];
  if(!s)return;
  /* every step's mode has to be loaded, or the walk would stop halfway */
  for(const st of s.steps)if(!STATE[st.mode]){setStatus("The "+st.mode+" mode is not loaded");return;}
  wiz={s:s,i:0,snap:{},vals:{},reached:0,made:{}};
  townL=null;
  stageSig="";
  /* the building is what a wizard is FOR, so it opens on it */
  if(stageOK){ForgeStage.reset();view=BUILD_VIEW;}
  wizEnter(0);
  if(stageOK)ForgeStage.frame();
}
function wizExit(){
  const steps=wizSteps();
  for(const st of steps)wizMark(st.mode,{});
  wiz=null;
  townL=null;townEdits={};townSel=-1;
  stageSig="";
  if(stageOK)ForgeStage.reset();
  if(view===BUILD_VIEW)view="lit";     // buildViewTabs corrects this where there is no WebGL
  wizSync();
  if(active){buildViewTabs(active);renderView();}
}

/* Build every face at full size and pack the lot into one archive, each face in
   its own folder with its own readme. This is the thing a wizard is actually
   for: the building leaves as one object rather than as four exports you have
   to remember to line up. */
function runAsync(st,preview){
  return new Promise(res=>{
    clearTimeout(st.qTimer);            // the step's own queued rebuild would only duplicate this
    run(st,!!preview,res);
  });
}
async function wizBuildAll(){
  if(!wiz)return;
  const btn=el("wiz-all"),save=el("zipsave");
  btn.disabled=true;save.hidden=true;
  const steps=wizSteps(),start=wiz.i;
  try{
    wizRecord();
    const files=[],faceBy={},planList=[];

    /* ---------------------------------------------------------------------
       FOUR FACES, FOUR CORES.

       This is the one place in the app where several whole builds are wanted
       at once, and they are completely independent of each other — so rather
       than queueing them, walk the steps to SETTLE the parameters (which
       builds nothing), snapshot each face's numbers, and hand the lot to the
       pool together. On a four-core machine a building comes out in about the
       time the slowest face takes rather than the sum of all four.

       Two faces of a factory are the same MODE and therefore the same state
       object, which is why the snapshots are taken up front and written back
       one at a time as each is packed: there is only ever one live P per mode
       and it has to be the right face's while its readme is written.

       If any face's mode will not go off thread — the graffiti and the neon
       are drawn with fonts a worker cannot see — the whole run falls back to
       the sequential path rather than half of it going one way. */
    const shots=[];
    for(let k=0;k<steps.length;k++){
      wizEnter(k);
      const st=STATE[steps[k].mode];
      clearTimeout(st.qTimer);                   // the step's own queued rebuild
      const dim=st.mode.size(st.P,false);
      shots.push({step:steps[k],st:st,P:plainP(st.P),W:dim.w,H:dim.h});
    }
    let built=null;
    if(!wOff&&shots.every(x=>threadable(x.st.mode,x.P))){
      const n=Math.min(THREADS,shots.length);
      setStatus("Building "+shots.length+" faces across "+n+" thread"+(n===1?"":"s")+"…");
      let done=0;
      try{
        built=await Promise.all(shots.map(x=>
          poolBuild(x.st.mode.id,x.P,x.W,x.H,false,null)
            .then(B=>{setBar(++done/(shots.length*2));return B;})));
      }catch(e){built=null;}                     // one fell over: do the lot the old way
    }

    for(let k=0;k<steps.length;k++){
      const shot=shots[k],step=shot.step,st=shot.st;
      setStatus((built?"Packing ":"Building ")+step.label+"…");
      Object.assign(st.P,shot.P);                // this face's numbers, for its readme
      if(built){
        const B=built[k];B.W=shot.W;B.H=shot.H;
        st.B=B;st.built=true;st.busy=false;
        st.flags={seamless:flag(st.mode,"seamless",st.P),backdrops:flag(st.mode,"backdrops",st.P)};
        makeWriters(st);
      }else{
        wizEnter(k);
        await runAsync(st);
      }
      if(!st.B)throw new Error(step.label+" did not build");
      /* the sequential fallback went through run(), which captures on its own;
         the threaded path never touched it, so the building is fed here */
      if(built)wizMade(step.id,st);
      for(const ch of st.mode.channels){
        setBar((built?0.5:0)+(k+(st.mode.channels.indexOf(ch)+1)/(st.mode.channels.length+1))
               /steps.length*(built?0.5:1));
        await new Promise(r=>setTimeout(r,0));
        const blob=await new Promise((res,rej)=>{
          const cv=makeMap(st,ch.key);
          if(!cv.toBlob){rej(new Error("this browser can't encode canvas PNGs"));return;}
          cv.toBlob(b=>b?res(b):rej(new Error("PNG encode failed on "+ch.key)),"image/png");
        });
        files.push({name:step.id+"/"+fileName(st,ch.key),
                    data:new Uint8Array(await blob.arrayBuffer())});
      }
      if(st.mode.height16!==false){
        const h16=await png16Height(st);
        if(h16)files.push({name:step.id+"/"+fileName(st,"height16"),data:h16});
      }
      files.push({name:step.id+"/"+fileBase(st)+"_readme.txt",
                  data:new TextEncoder().encode(readmeText(st))});
      if(window.ForgeModel){
        const maps={};
        for(const ch of st.mode.channels)maps[ch.key]=step.id+"/"+fileName(st,ch.key);
        const plan=ForgeModel.planOf(st.mode,st.P);
        faceBy[step.id]={plan:plan,
          material:{name:step.id,maps:maps,cutout:plan.cutout&&!!maps.opacity}};
        planList.push({name:step.id,plan:plan});
      }
    }
    /* THE BUILDING, not four planes. The wizard already knows which face is
       which and every one of them just reported its real size, so the box
       assembles itself: the front and back at their own widths, the side
       elevation used twice because that is what the two sides of a building
       are, and whatever roof the front described sitting at the eaves. */
    /* THE TOWN, not thirteen planes. Same idea one step out: the kit that was
       just forged at full size goes onto the layout the 3D view is showing —
       the same layout, edits and all, so what leaves is what you were looking
       at rather than a fresh roll of the dice. */
    if(window.ForgeModel&&wiz.s.town&&window.ForgeTown){
      const L=townLayout(faceBy);
      if(L){
        const model=ForgeModel.filesForTown(wiz.s.id+"_"+(TOWN.seed|0),L,L.kit,planList);
        for(const f of model)files.push(f);
      }
    }else if(window.ForgeModel&&faceBy.front){
      const order=steps.map(x=>x.id);
      const at=i=>(order[i]&&order[i]!=="roof")?faceBy[order[i]]:null;
      const model=ForgeModel.filesForBuilding(wiz.s.id+"_"+(wiz.vals.seed|0),{
        front:faceBy.front||at(0),
        side :faceBy.side ||at(1),
        back :faceBy.back ||at(2),
        roof :faceBy.roof ||null
      },planList);
      for(const f of model)files.push(f);
    }
    files.push({name:"readme.txt",data:new TextEncoder().encode(wizReadme())});
    const zip=makeZip(files),
          name=wiz.s.id+"_"+((wiz.s.town?TOWN.seed:wiz.vals.seed)|0)+"_all.zip";
    /* back to the step we were on FIRST, and let it finish rebuilding: both
       activate() and the end of a build clear the save link as stale, so a link
       put up before that lands is taken straight back down again */
    wizEnter(start);
    await runAsync(STATE[steps[start].mode]);
    if(wiz.zipUrl)URL.revokeObjectURL(wiz.zipUrl);
    wiz.zipUrl=saveBlob(zip,name);
    save.href=wiz.zipUrl;save.download=name;
    save.textContent="Save "+name+" ("+(zip.size/1048576).toFixed(1)+" MB)";
    save.hidden=false;
    setBar(0);
    setStatus(steps.length+" faces packed · click save if nothing downloaded");
  }catch(err){
    setBar(0);
    if(wiz)wizEnter(start);
    setStatus("Could not pack the structure: "+(err&&err.message||err));
  }finally{
    btn.disabled=false;
  }
}
/* FORGE EVERY FACE, and nothing else — no channels, no PNG encoding, no zip.
   "Build & zip every face" is the export; this is the look. It walks the steps
   at preview resolution so the whole building is standing there in a couple of
   seconds, which is the question somebody actually has three steps in: does
   the side belong to the front? */
async function wizSeeAll(){
  if(!wiz)return;
  const btn=el("wiz-see"),steps=wizSteps(),start=wiz.i;
  btn.disabled=true;
  try{
    wizRecord();
    wiz.reached=steps.length-1;        // every face is about to exist; none is out of reach
    for(let k=0;k<steps.length;k++){
      setStatus("Forging "+steps[k].label+"…");
      setBar((k+0.5)/steps.length);
      wizEnter(k);
      await runAsync(STATE[steps[k].mode],true);
    }
    /* back to the step we came from, and let its own rebuild LAND before the
       status is set: wizEnter queues one, and a message written before that
       finishes is wiped by it a tenth of a second later */
    wizEnter(start);
    await runAsync(STATE[steps[start].mode],true);
    setBar(0);
    setStatus(steps.length+" faces forged · orbit the building");
  }catch(err){
    setBar(0);
    if(wiz)wizEnter(start);
    setStatus("Could not forge every face: "+(err&&err.message||err));
  }finally{
    btn.disabled=false;
  }
}

function wizReadme(){
  const steps=wizSteps();
  const out=["Texture Forge · "+wiz.s.label,"",
    wiz.s.blurb||"","",
    "One folder per face, each with its own maps and its own readme:",""];
  for(const st of steps)out.push("  "+st.id+"/   "+st.label+"  ("+st.mode+" mode)");
  if(wiz.s.town&&townL&&window.ForgeTown){
    const c=ForgeTown.census(townL);
    const kinds=Object.keys(c.by).sort().map(k=>c.by[k]+" "+k+(c.by[k]===1?"":"s")).join(", ");
    const edits=Object.keys(townEdits).length;
    out.push("",
      "THIS IS A TOWN, so these thirteen are a KIT rather than one building's",
      "faces. model.gltf stands them up "+c.lots+" times: "+kinds+", on "+c.blocks,
      "blocks between "+c.streets+" street runs and "+c.junctions+" junctions, over",
      Math.round(townL.bounds.w)+" x "+Math.round(townL.bounds.d)+" m. Seed "+(TOWN.seed|0)+"."+
      (edits?"  "+edits+" building"+(edits===1?" was":"s were")+" edited by hand.":""),
      "",
      "Every instance of a face shares one material and one mesh, which is what",
      "makes a town of this size affordable: thirteen textures, not eight hundred.",
      "In Blender that arrives as a handful of objects you can select rather than",
      "as several hundred you cannot.","",
      "There is no ground plane in the file. The town sits on y = 0 with the",
      "streets a centimetre above it, so drop it onto whatever ground you have.","");
  }
  out.push("",
    wiz.s.town
      ?"Each GROUP of faces above was built off shared settings and belongs to one"
      :"These faces were built in one pass off shared settings, so they belong to",
    wiz.s.town
      ?"building — the house's four, the diner's three, the works's three. Between"
      :"one building: the same seed, the same materials, the same weathering. Keep",
    wiz.s.town
      ?"groups nothing is shared, which is why the diner is not a house with a sign."
      :"them together and they line up; rebuild one on its own with different",
    wiz.s.town?"":"settings and it stops matching the others.","",
    "Resolution is deliberately per-face — how many texels a face needs is a",
    "property of the export, not of the building.",
    "",
    wiz.s.town
      ?"model.gltf, model.obj and model.mtl are the town itself, at true scale in"
      :"model.gltf, model.obj and model.mtl are the building itself: a box at true",
    wiz.s.town
      ?"metres. Import the glTF into Blender and the materials arrive wired."
      :"scale in metres with these faces mapped onto it and a roof on top. Import the",
    wiz.s.town
      ?"model_readme.txt has the dimensions and the caveats."
      :"glTF into Blender and the materials arrive wired. model_readme.txt has the",
    wiz.s.town?"":"dimensions and the caveats.");
  return out.join("\n");
}

function initWizard(){
  const host=el("structs");
  if(!STRUCTURES.length){host.hidden=true;}
  else{
    host.appendChild(make("span","structlab","Whole structure"));
    for(const s of STRUCTURES){
      const b=make("button","structbtn",s.label);
      b.type="button";b.dataset.struct=s.id;
      if(s.blurb)b.title=s.blurb;
      host.appendChild(b);
    }
    host.addEventListener("click",e=>{
      const b=e.target.closest("[data-struct]");
      if(b)wizStart(b.dataset.struct);
    });
  }
  el("wiz-steps").addEventListener("click",e=>{
    const b=e.target.closest("[data-step]");
    if(b&&!b.disabled)wizGo(+b.dataset.step);
  });
  el("wiz-back").addEventListener("click",()=>wizGo(wiz.i-1));
  el("wiz-next").addEventListener("click",()=>wizGo(wiz.i+1));
  el("wiz-see").addEventListener("click",wizSeeAll);
  el("wiz-all").addEventListener("click",wizBuildAll);
  el("wiz-exit").addEventListener("click",wizExit);
  /* an inherited value stops being inherited the moment you touch it */
  let nudge=0;
  el("app").addEventListener("input",e=>{
    const row=e.target.closest&&e.target.closest(".row.carried");
    if(row){row.classList.remove("carried");row.removeAttribute("title");}
    /* the building's SHAPE is arithmetic, not a build — so it follows the
       slider now rather than waiting for whatever the slider caused to forge */
    if(!wiz)return;
    clearTimeout(nudge);
    nudge=setTimeout(()=>{
      wizTicks();
      if(view===BUILD_VIEW)stageSync();
    },70);
  },true);
  wizSync();
}

/* ============================ the palette bar ============================
   Palette, dither and filtering are properties of how you are LOOKING at a
   texture, not of any one mode, so they live above the preview rather than in
   twelve panels. Changing any of them re-renders what is already built — none
   of it touches the generators, so nothing has to be forged again. */

function palRepaint(){
  if(active&&active.built&&active.B){buildChips();renderView();}
}
function palSwatch(){
  const box=el("pal-swatch"),cols=Palette.colors();
  box.innerHTML="";
  box.hidden=!cols;
  if(!cols)return;
  /* a 500-colour palette in a 260 px strip is one pixel a swatch and reads as
     mud, so past a couple of hundred it shows an even sample of the ramp */
  const cap=200,step=cols.length>cap?cols.length/cap:1;
  for(let i=0;i<cols.length;i+=step){
    const c=cols[Math.floor(i)],n=make("i");
    n.style.background="rgb("+c[0]+","+c[1]+","+c[2]+")";
    box.appendChild(n);
  }
  box.title=cols.length+" colours";
}
function palSync(){
  const sel=el("pal-set");
  sel.innerHTML="";
  for(const p of Palette.list()){
    const o=make("option",null,p.label);
    o.value=p.id;
    sel.appendChild(o);
  }
  sel.value=Palette.state.id;
  el("pal-dither").value=Palette.state.dither;
  el("pal-strength").value=Palette.state.strength;
  const on=Palette.active();
  el("pal-dither").disabled=!on;
  el("pal-strength").disabled=!on||Palette.state.dither==="none";
  el("pal-forget").hidden=!/^user/.test(Palette.state.id);
  el("pal-near").setAttribute("aria-pressed",String(!!Palette.state.nearest));
  document.body.dataset.nearest=Palette.state.nearest?"on":"off";
  palSwatch();
}
function palLoad(file){
  if(!file)return;
  setStatus("Reading "+(file.name||"palette")+"…");
  Palette.loadFile(file).then(id=>{
    if(id)Palette.set("id",id);
    setStatus((Palette.get(Palette.state.id).label)+" loaded");
  },msg=>setStatus(String(msg)));
}
function initPalette(){
  const dith=el("pal-dither");
  for(const [v,label] of Palette.DITHERS){
    const o=make("option",null,label);o.value=v;dith.appendChild(o);
  }
  el("pal-set").addEventListener("change",e=>Palette.set("id",e.target.value));
  dith.addEventListener("change",e=>Palette.set("dither",e.target.value));
  el("pal-strength").addEventListener("input",e=>Palette.set("strength",+e.target.value));
  el("pal-near").addEventListener("click",()=>Palette.set("nearest",!Palette.state.nearest));
  el("pal-forget").addEventListener("click",()=>Palette.remove(Palette.state.id));
  el("pal-load").addEventListener("click",()=>el("pal-file").click());
  el("pal-file").addEventListener("change",e=>{
    palLoad(e.target.files&&e.target.files[0]);
    e.target.value="";                                  // so the same file can be loaded twice
  });

  /* drag a swatch sheet or a .hex straight onto the bar */
  const bar=el("palbar");
  const stop=e=>{e.preventDefault();e.stopPropagation();};
  bar.addEventListener("dragenter",e=>{stop(e);bar.classList.add("drop");});
  bar.addEventListener("dragover",e=>{stop(e);e.dataTransfer.dropEffect="copy";});
  bar.addEventListener("dragleave",e=>{stop(e);bar.classList.remove("drop");});
  bar.addEventListener("drop",e=>{
    stop(e);bar.classList.remove("drop");
    const dt=e.dataTransfer;
    if(dt.files&&dt.files.length)palLoad(dt.files[0]);
    else{
      /* a run of hexes pasted or dragged as plain text is a palette too */
      const txt=dt.getData("text");
      const cols=txt?Palette.parse(txt):[];
      if(cols.length){const id=Palette.add("Dropped",cols);if(id)Palette.set("id",id);}
      else setStatus("Nothing palette-shaped in that");
    }
  });

  Palette.on(()=>{palSync();palRepaint();});
  palSync();
}

/* ============================ the bake bar ============================
   The unlit bake's own controls. Same argument as the palette bar above — none
   of this touches a generator, so changing any of it re-derives the channel
   from buffers that are already built and nothing is forged again.

   It is a SEPARATE bar from the palette one, and the palette control in it is a
   second, independent profile, because "quantise the albedo" and "quantise the
   pre-lit map" are different decisions: a full-colour albedo feeding a
   sixteen-level bake is a thing somebody wants, and one shared setting cannot
   say it. */

const BAKEROWS=[
  {g:"Key",rows:[
    {k:"az",lab:"Az",min:0,max:360,step:5,unit:"°"},
    {k:"el",lab:"El",min:0,max:90,step:1,unit:"°"},
    {k:"gain",lab:"Exp",min:0,max:6,step:0.05}]},
  {g:"Ambient",rows:[
    {k:"amb",lab:"Amt",min:0,max:3,step:0.05},
    {k:"cSky",lab:"Sky",type:"color"},
    {k:"cGnd",lab:"Gnd",type:"color"}]},
  {g:"Surface",rows:[
    {k:"ao",lab:"AO",min:0,max:2,step:0.05},
    {k:"spec",lab:"Spec",min:0,max:2,step:0.05}]},
  {g:"Grade",rows:[
    {k:"contrast",lab:"Con",min:0,max:2,step:0.05},
    {k:"sat",lab:"Sat",min:0,max:2,step:0.05}]}
];

function bakeRepaint(){
  bakeSync();
  if(active&&active.built&&active.B){buildChips();renderView();}
}
function bakeSync(){
  const bar=el("bakebar");
  if(!bar)return;
  for(const n of bar.querySelectorAll("[data-bake]")){
    const k=n.dataset.bake;
    if(n.type==="color"){if(n.value!==ForgeUnlit.state[k])n.value=ForgeUnlit.state[k];}
    else if(n.tagName==="SELECT"){n.value=ForgeUnlit.state[k];}
    else n.value=ForgeUnlit.state[k];
  }
  for(const n of bar.querySelectorAll("[data-bakeval]")){
    const k=n.dataset.bakeval,r=BAKEROWS.reduce((a,g)=>a||g.rows.find(x=>x.k===k),null);
    const v=+ForgeUnlit.state[k];
    n.textContent=r&&r.unit?Math.round(v)+r.unit:v.toFixed(2);
  }
  const on=Palette.profileActive(ForgeUnlit.profile());
  el("bake-dither").disabled=!on;
  el("bake-strength").disabled=!on||ForgeUnlit.state.palDither==="none";
}
function initBake(){
  const bar=el("bakebar");
  if(!bar||!window.ForgeUnlit)return;
  const add=(parent,tag,cls,txt)=>{const n=make(tag,cls,txt);parent.appendChild(n);return n;};
  let first=true;
  for(const grp of BAKEROWS){
    if(!first)add(bar,"div","bakesep");
    first=false;
    const g=add(bar,"div","bakeset");
    add(g,"span",null,grp.g);
    for(const r of grp.rows){
      const lab=make("label","bakegrp");
      lab.title=r.lab;
      lab.appendChild(make("span",null,r.lab));
      const inp=make("input");
      inp.dataset.bake=r.k;
      if(r.type==="color"){inp.type="color";}
      else{
        inp.type="range";inp.min=r.min;inp.max=r.max;inp.step=r.step;
        const em=make("em");em.dataset.bakeval=r.k;
        lab.appendChild(inp);lab.appendChild(em);
        g.appendChild(lab);
        continue;
      }
      lab.appendChild(inp);
      g.appendChild(lab);
    }
  }
  add(bar,"div","bakesep");
  const pg=add(bar,"div","bakeset");
  add(pg,"span",null,"Retro");
  const sel=make("select");sel.id="bake-pal";sel.dataset.bake="palId";
  sel.title="Quantise the bake — independent of the palette bar above";
  for(const p of Palette.list()){
    const o=make("option",null,p.label);o.value=p.id;sel.appendChild(o);
  }
  pg.appendChild(sel);
  const dith=make("select");dith.id="bake-dither";dith.dataset.bake="palDither";
  for(const [v,label] of Palette.DITHERS){
    const o=make("option",null,label);o.value=v;dith.appendChild(o);
  }
  pg.appendChild(dith);
  const sl=make("label","palrange");sl.title="Dither amount";
  const si=make("input");si.id="bake-strength";si.dataset.bake="palStrength";
  si.type="range";si.min=0;si.max=1.6;si.step=0.05;
  sl.appendChild(si);pg.appendChild(sl);

  add(bar,"div","bakesep");
  const rst=make("button","tab","Reset bake");
  rst.type="button";
  rst.addEventListener("click",()=>ForgeUnlit.reset());
  bar.appendChild(rst);

  /* one listener for the lot: the target names the key it sets */
  bar.addEventListener("input",e=>{
    const n=e.target;
    if(!n.dataset||!n.dataset.bake)return;
    const k=n.dataset.bake;
    ForgeUnlit.set(k,(n.type==="color"||n.tagName==="SELECT")?n.value:+n.value);
  });
  bar.addEventListener("change",e=>{
    const n=e.target;
    if(n.dataset&&n.dataset.bake&&n.tagName==="SELECT")
      ForgeUnlit.set(n.dataset.bake,n.value);
  });

  ForgeUnlit.on(()=>bakeRepaint());
  /* a palette loaded from a file has to appear in BOTH pickers */
  Palette.on(()=>{
    const keep=ForgeUnlit.state.palId;
    sel.innerHTML="";
    for(const p of Palette.list()){
      const o=make("option",null,p.label);o.value=p.id;sel.appendChild(o);
    }
    sel.value=keep;
    bakeSync();
  });
  bakeSync();
}

/* ============================ mode switching ============================ */

function activate(id){
  const st=STATE[id];
  if(!st||st===active)return;
  if(active){
    active.panel.hidden=true;
    /* keep the last build for a quick flick back, but do not sit on a
       4096² set for every mode the user has opened */
    if(active.B&&active.B.W*active.B.H>RETAIN_TEXELS){
      active.B=null;active.writers=null;active.built=false;active.flags=null;  // writers close over the buffers
    }
  }
  active=st;
  st.panel.hidden=false;
  document.body.dataset.mode=id;
  for(const b of el("modebar-tabs").children)
    b.setAttribute("aria-pressed",String(b.dataset.mode===id));
  try{localStorage.setItem("texture-forge-mode",id);}catch(e){}
  try{history.replaceState(null,"","#"+id);}catch(e){}

  if(browserReady)markBrowser();
  buildViewTabs(st);
  syncChrome(st);
  el("zipsave").hidden=true;
  syncUI(st);

  if(st.built&&st.B){
    buildChips();renderView();
    setStatus(sizeTag(st));
  }else{
    el("chips").innerHTML="";
    run(st,false);
  }
}

/* the channel tabs follow the active mode: markings, material id and the
   rest only exist where a mode declares them */
function buildViewTabs(st){
  const wrap=el("tabs");
  wrap.innerHTML="";
  /* THE BUILDING COMES FIRST, and only in the wizard. Outside one there is no
     building to draw — a wall mode on its own is a wall — and a tab that is
     empty four times out of five is worse than no tab. */
  const list=[];
  if(wiz&&stageOK)list.push({key:BUILD_VIEW,label:"3D building"});
  list.push({key:"lit",label:"Lit preview"});
  for(const c of st.mode.channels)if(c.tab!==false)list.push(c);
  if(noGL&&view==="lit")view=st.mode.channels[0].key;
  if(!list.some(c=>c.key===view))view=noGL?st.mode.channels[0].key:"lit";
  for(const c of list){
    const b=make("button","tab",c.key==="lit"&&noGL?"Lit (no WebGL)":c.label);
    b.dataset.view=c.key;
    b.setAttribute("aria-pressed",String(c.key===view));
    if(c.key==="lit"&&noGL)b.disabled=true;
    wrap.appendChild(b);
  }
}

/* ============================ chrome ============================
   The frame around the modes: which one you are on, how much room the panel
   gets, and — on a phone — which of the three panes is on screen. None of it
   touches a generator. */

function filterPanel(st,q){
  const panel=st.panel;
  if(!panel)return;
  const needle=String(q||"").trim().toLowerCase();
  panel.dataset.finding=needle?"on":"off";
  for(const g of panel.querySelectorAll(".group")){
    let any=false;
    for(const r of g.querySelectorAll(".row")){
      const hit=!needle||r.textContent.toLowerCase().indexOf(needle)>=0;
      r.classList.toggle("nomatch",!hit);
      /* a row this mode has hidden for other reasons is not a hit */
      if(hit&&!r.hidden)any=true;
    }
    g.classList.toggle("nomatch",!!needle&&!any);
    if(needle&&any)g.open=true;
  }
}

/* ---- the mode browser ----
   Sixteen modes is well past the point where a strip of tabs is a way of
   FINDING one. This is the same list grouped, described and searchable, and on
   a phone it is the only mode picker there is. */
/* Groups run in the order somebody would actually go looking, not in whichever
   order the <script> tags happen to load. Anything a mode invents that is not
   on this list falls in at the end. */
const GROUP_ORDER=["Ground","Buildings","Interiors","Panels","Sci-fi","Detail"];
function buildBrowser(){
  const host=el("modegrid");
  host.innerHTML="";
  const order=[],by={};
  for(const m of MODES){
    const g=m.group||"Other";
    if(!by[g]){by[g]=[];order.push(g);}
    by[g].push(m);
  }
  order.sort((a,b)=>{
    const ia=GROUP_ORDER.indexOf(a),ib=GROUP_ORDER.indexOf(b);
    return (ia<0?99:ia)-(ib<0?99:ib);
  });
  for(const g of order){
    const sec=make("div","modegroup");
    sec.appendChild(make("h3",null,g));
    const box=make("div","modegrid");
    for(const m of by[g]){
      const b=make("button","modecard");
      b.type="button";b.dataset.mode=m.id;
      /* searched as one string, so "neon" finds the diner through its tagline
         and "hex" finds the vent through its blurb */
      b.dataset.hay=(m.id+" "+m.label+" "+(m.blurb||"")+" "+(m.tagline||"")+" "+g).toLowerCase();
      b.appendChild(make("b",null,m.label));
      b.appendChild(make("span",null,m.blurb||""));
      box.appendChild(b);
    }
    sec.appendChild(box);
    host.appendChild(sec);
  }
  const none=make("div","nohits",
    "Nothing matches that. Try a material — brick, rust, neon, concrete, hex, shingle.");
  none.id="modenone";none.hidden=true;
  host.appendChild(none);
}
function filterBrowser(q){
  const needle=String(q||"").trim().toLowerCase();
  let hits=0;
  /* the structure buttons live in here on a phone. They are not modes, they
     hold no cards, and searching for "brick" should not leave them sitting
     above an empty list — so they are shown only when nothing is typed. */
  const sh=el("structhost");
  if(sh)sh.hidden=!!needle||!onPhone();
  for(const sec of el("modegrid").querySelectorAll(".modegroup")){
    if(sec.id==="structhost")continue;
    let any=false;
    for(const c of sec.querySelectorAll(".modecard")){
      const hit=!needle||c.dataset.hay.indexOf(needle)>=0;
      c.hidden=!hit;
      if(hit){any=true;hits++;}
    }
    sec.hidden=!any;
  }
  el("modenone").hidden=hits>0;
  el("modefoot").textContent=needle
    ?(hits+" of "+MODES.length+" modes · Enter takes the first")
    :(MODES.length+" modes · type to narrow · Esc to close");
}
function markBrowser(){
  for(const c of el("modegrid").querySelectorAll(".modecard"))
    c.setAttribute("aria-current",String(active&&c.dataset.mode===active.mode.id));
}
function openBrowser(){
  const sheet=el("modesheet");
  buildBrowserOnce();
  sheet.hidden=false;
  markBrowser();
  const q=el("modesearch");
  q.value="";filterBrowser("");
  /* not on a phone: the keyboard springing up covers the list it is filtering */
  if(!matchMedia("(pointer:coarse)").matches)q.focus();
}
function closeBrowser(){el("modesheet").hidden=true;}
let browserReady=false;
function buildBrowserOnce(){if(!browserReady){buildBrowser();browserReady=true;}}

/* ---- panes, the panel and the grip ---- */
function setPane(p){
  document.body.dataset.pane=p;
  for(const b of el("tabbar").children)
    b.setAttribute("aria-pressed",String(b.dataset.pane===p));
  try{localStorage.setItem("texture-forge-pane",p);}catch(e){}
  /* the canvas was display:none while another pane was up, so it has no size
     until the browser has laid it out again */
  if(p!=="controls")requestAnimationFrame(()=>{repaint();});
}
const onPhone=()=>matchMedia("(max-width:900px)").matches;

function setPanel(on){
  document.body.dataset.panel=on?"on":"off";
  el("panelbtn").setAttribute("aria-pressed",String(on));
  try{localStorage.setItem("texture-forge-panel",on?"on":"off");}catch(e){}
  requestAnimationFrame(()=>{repaint();});
}

/* WHERE THE STRUCTURE BUTTONS LIVE. On a wide screen they belong in the top
   bar beside the modes. On a phone the top bar has no room for three more
   buttons, and the mode browser is already the place you go to choose what to
   make — so they move into it. The element itself moves, listeners and all,
   rather than being rebuilt. */
function placeStructs(){
  const s=el("structs");
  if(!s||s.hidden)return;
  if(onPhone()){
    let host=el("structhost");
    if(!host){
      host=make("div","modegroup");host.id="structhost";
      host.appendChild(make("h3",null,"Whole structure — every face of one building"));
      el("modegrid").insertBefore(host,el("modegrid").firstChild);
    }
    if(s.parentNode!==host)host.appendChild(s);
    if(!el("modesheet").hidden)filterBrowser(el("modesearch").value);
  }else{
    const host=el("structhost");
    if(host)host.hidden=true;
    if(s.parentNode!==el("topbar"))el("topbar").insertBefore(s,el("hintline"));
  }
}

function initChrome(){
  buildBrowserOnce();
  el("browse").addEventListener("click",openBrowser);
  el("modeclose").addEventListener("click",closeBrowser);
  el("modesheet").addEventListener("click",e=>{if(e.target===el("modesheet"))closeBrowser();});
  el("modesearch").addEventListener("input",e=>filterBrowser(e.target.value));
  el("modesearch").addEventListener("keydown",e=>{
    if(e.key!=="Enter")return;
    const first=el("modegrid").querySelector(".modecard:not([hidden])");
    if(first){activate(first.dataset.mode);closeBrowser();}
  });
  el("modegrid").addEventListener("click",e=>{
    const b=e.target.closest("[data-mode]");
    if(b){activate(b.dataset.mode);closeBrowser();}
  });

  el("tabbar").addEventListener("click",e=>{
    const b=e.target.closest("[data-pane]");
    if(b)setPane(b.dataset.pane);
  });
  el("panelbtn").addEventListener("click",()=>{
    if(onPhone())setPane(document.body.dataset.pane==="controls"?"preview":"controls");
    else setPanel(document.body.dataset.panel!=="on");
  });

  /* the drag handle. The width lives in a custom property so the panel, the
     bay and the shadow all follow it without any of them being measured. */
  const grip=el("grip");
  let dragging=false;
  grip.addEventListener("pointerdown",e=>{
    dragging=true;grip.setPointerCapture(e.pointerId);e.preventDefault();
  });
  grip.addEventListener("pointermove",e=>{
    if(!dragging)return;
    const w=clamp(e.clientX,260,Math.min(680,innerWidth-320));
    document.documentElement.style.setProperty("--panel-w",Math.round(w)+"px");
  });
  const stop=()=>{
    if(!dragging)return;
    dragging=false;
    try{localStorage.setItem("texture-forge-panelw",
      getComputedStyle(document.documentElement).getPropertyValue("--panel-w").trim());}catch(e){}
    repaint();
  };
  grip.addEventListener("pointerup",stop);
  grip.addEventListener("pointercancel",stop);
  grip.addEventListener("dblclick",()=>{
    document.documentElement.style.removeProperty("--panel-w");
    try{localStorage.removeItem("texture-forge-panelw");}catch(e){}
  });

  /* ---- keys. None of them fire while you are typing in a field, which is
     what makes single letters safe to use at all. ---- */
  addEventListener("keydown",e=>{
    if(e.key==="Escape"&&!el("modesheet").hidden){closeBrowser();return;}
    const t=e.target;
    const typing=t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.tagName==="SELECT"||t.isContentEditable);
    if((e.key==="k"||e.key==="K")&&(e.metaKey||e.ctrlKey)){e.preventDefault();openBrowser();return;}
    if(typing||e.metaKey||e.ctrlKey||e.altKey)return;
    if(e.key==="k"||e.key==="K"){e.preventDefault();openBrowser();}
    else if(e.key==="p"||e.key==="P"){e.preventDefault();el("panelbtn").click();}
    else if(e.key==="b"||e.key==="B"||e.key==="Enter"){
      e.preventDefault();
      const f=active&&node(active,"forge");
      if(f&&!f.disabled)f.click();
    }
    else if(e.key==="/"){
      e.preventDefault();
      if(onPhone())setPane("controls");
      else setPanel(true);
      const f=active&&node(active,"find");
      if(f)f.focus();
    }
    else if(e.key==="["||e.key==="]"){
      const list=[...el("tabs").children].filter(b=>!b.disabled);
      const i=list.findIndex(b=>b.getAttribute("aria-pressed")==="true");
      const j=clamp(i+(e.key==="]"?1:-1),0,list.length-1);
      if(list[j])list[j].click();
    }
  });

  try{
    const w=localStorage.getItem("texture-forge-panelw");
    if(w)document.documentElement.style.setProperty("--panel-w",w);
  }catch(e){}
  let pane="preview",panel="on";
  try{
    pane=localStorage.getItem("texture-forge-pane")||"preview";
    panel=localStorage.getItem("texture-forge-panel")||"on";
  }catch(e){}
  setPane(["controls","preview","export"].indexOf(pane)>=0?pane:"preview");
  setPanel(panel!=="off");
  placeStructs();
  const mq=matchMedia("(max-width:900px)");
  (mq.addEventListener?mq.addEventListener.bind(mq,"change"):mq.addListener.bind(mq))(()=>{
    placeStructs();
    repaint();
  });
}

/* ============================ boot ============================ */

function boot(){
  glc=el("gl");flat=el("flat");fctx=flat.getContext("2d");

  if(!MODES.length){
    el("status").textContent="No modes loaded";
    el("stage").insertAdjacentHTML("beforeend",
      '<div class="fatal">No modes registered. Check that the <code>modes/*.js</code> '+
      'files sit next to this page and are listed in index.html.</div>');
    return;
  }

  const tabs=el("modebar-tabs");
  for(const m of MODES){
    const st=stateFor(m);
    st.panel=buildPanel(st);
    st.panel.hidden=true;
    el("app").insertBefore(st.panel,el("grip"));
    wireInputs(st);            // needs the panel in the document to find its ids
    readParams(st);
    const b=make("button","modetab",m.label);
    b.type="button";b.dataset.mode=m.id;
    if(m.blurb)b.title=m.blurb;
    b.setAttribute("aria-pressed","false");
    tabs.appendChild(b);
  }
  tabs.addEventListener("click",e=>{
    const b=e.target.closest("[data-mode]");
    if(b)activate(b.dataset.mode);
  });

  initChrome();
  initPalette();
  initBake();
  initWizard();
  /* best effort and silent: see the note at the top of forge-fonts.js */
  if(window.ForgeFonts)ForgeFonts.scan().catch(()=>{});
  noGL=!initGL();

  el("tabs").addEventListener("click",e=>{
    const b=e.target.closest("[data-view]");
    if(!b||b.disabled)return;
    view=b.dataset.view;
    for(const t of el("tabs").children)t.setAttribute("aria-pressed",String(t===b));
    renderView();
  });
  el("tiles").addEventListener("click",e=>{
    const b=e.target.closest("[data-tile]");if(!b)return;
    tileN=+b.dataset.tile;
    for(const t of el("tiles").children)t.setAttribute("aria-pressed",String(t===b));
    renderView();
  });
  el("bgs").addEventListener("click",e=>{
    const b=e.target.closest("[data-bg]");if(!b)return;
    bg=b.dataset.bg;
    for(const t of el("bgs").children)t.setAttribute("aria-pressed",String(t===b));
    renderView();
  });
  /* THE 3D STAGE. It needs its own WebGL context and ForgeModel to describe a
     building for it; without either the wizard simply never offers the tab and
     everything else works exactly as it did. */
  solid=el("solid");
  stageOK=!!(solid&&window.ForgeStage&&window.ForgeModel&&ForgeStage.attach(solid));
  if(stageOK){
    ForgeStage.onPick((id,tag)=>{
      if(!wiz)return;
      /* IN A TOWN A CLICK IS A SELECTION, not a change of step. There are a
         hundred houses wearing the house texture and jumping to the house step
         because one of them was clicked would be answering a question nobody
         asked; the step rail is right there for that. A click on the road,
         which carries no lot, clears the selection. */
      if(wiz.s.town&&townL){
        const want=(typeof tag==="number"&&tag>=0)?tag:-1;
        if(want!==townSel){
          townSel=want;
          townDraw();ForgeStage.draw();
        }
        townBarSync();
        return;
      }
      const steps=wizSteps();
      for(let k=0;k<steps.length;k++)if(steps[k].id===id){
        /* the same reach the rail enforces: a face two steps ahead has not
           inherited anything yet and would open on stale numbers */
        if(k>wiz.reached+1)setStatus("Work through "+steps[wiz.reached].label+" first");
        else wizGo(k);
        return;
      }
    });
    ForgeStage.onHover((id,lotTag)=>{
      const tag=el("stagetag");
      if(!tag||!wiz)return;
      const steps=wizSteps();
      if(wiz.s.town&&townL){
        const lot=(typeof lotTag==="number"&&lotTag>=0)?townLotAt(lotTag):null;
        tag.textContent=lot
          ?(lot.i===townSel?"Selected — the bar below is working on this one"
                           :"Click to work on this "+lot.type+
                            (lot.main?" on Main Street":""))
          :stageLabel();
        return;
      }
      let step=null;
      for(const x of steps)if(x.id===id)step=x;
      tag.textContent=step
        ?(step.id===steps[wiz.i].id?"This is the "+step.label.toLowerCase()+" — the face you are on"
                                   :"Click to work on the "+step.label.toLowerCase())
        :stageLabel();
    });
  }

  sayPacking();
  el("zipall").addEventListener("click",downloadZip);
  el("h16").addEventListener("click",downloadH16);

  let dragging=false;
  const setLightFrom=e=>{
    const r=glc.getBoundingClientRect();
    light=[clamp(((e.clientX-r.left)/r.width)*2-1,-1,1),clamp(1-((e.clientY-r.top)/r.height)*2,-1,1)];
    drawGL();
  };
  glc.addEventListener("pointerdown",e=>{dragging=true;glc.setPointerCapture(e.pointerId);setLightFrom(e);});
  glc.addEventListener("pointermove",e=>{if(dragging)setLightFrom(e);});
  glc.addEventListener("pointerup",()=>{dragging=false;});
  glc.addEventListener("pointercancel",()=>{dragging=false;});
  addEventListener("resize",()=>{repaint();});
  addEventListener("hashchange",()=>{
    const id=(location.hash||"").replace(/^#/,"");
    if(BY_ID[id])activate(id);
  });

  let want=(location.hash||"").replace(/^#/,"");
  if(!BY_ID[want]){try{want=localStorage.getItem("texture-forge-mode");}catch(e){want=null;}}
  activate(BY_ID[want]?want:MODES[0].id);
}

/* Write a parameter into ANOTHER mode's panel. This is the one facility a mode
   has for coordinating with a sibling — the house family uses it to keep the
   front, the side, the back and the roof describing one building. It writes
   the form and the parameter object directly and marks that mode's last build
   stale, but deliberately does NOT run the other mode's derive, so two modes
   can mirror each other without ping-ponging. Returns false when the target
   mode is not loaded, does not have that control, or already holds the value. */
Forge.setParam=function(modeId,id,value){
  const st=STATE[modeId];
  if(!st||!st.params)return false;
  let d=null;
  for(const x of st.params)if(x.id===id){d=x;break;}
  const n=d&&node(st,id);
  if(!n)return false;
  const v=(d.kind==="check")?!!value
    :(d.kind==="text")?String(value)
    :(d.kind==="color")?String(value)
    :(d.kind==="select")?(d.numeric?+value:String(value))
    :+value;
  if(st.P[id]===v)return false;
  if(d.kind==="check")n.checked=v;else n.value=v;
  st.P[id]=v;
  showVal(el(pid(st,id)+"-val"),(d.kind==="range")?(+n.value).toFixed(d.dp):n.value);
  st.built=false;                       // its last build no longer matches its parameters
  return true;
};

/* exposed for modes and for the headless parity harness */
Forge.makeMap=(key,maxW)=>makeMap(active,key,maxW);
Forge.active=()=>active;
Forge.activate=activate;
Forge.state=id=>STATE[id];

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);
else boot();

})();
