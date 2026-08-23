/* =====================================================================
   TEXTURE FORGE — display faces
   =====================================================================

   Some things a texture needs are LETTERS, and letters want a typeface: a
   tag sprayed on a derelict wall is the obvious one. Drawing them as
   random curly strokes, which is what the house mode did, gives you a
   smear that reads as a stain rather than as writing.

   WHY THE FONTS ARE NOT SHIPPED WITH THE APP

   The repository carries six graffiti faces in fonts/, one directory per
   family, and that directory is deliberately NOT part of the published
   site — .github/workflows/static.yml uploads texture-forge/ and nothing
   above it, and it has to stay that way because the app FETCHES that
   directory at runtime from one level up — copying it in beside index.html
   would publish all six.

   None of the six is ours to publish. fonts/README.txt quotes what each one
   actually ships with and is the authority; in short, two are personal-use
   or demo cuts, one is donationware whose commercial use needs the author's
   agreement, and three came with no licence FILE — which is terms unknown,
   not terms granted. So the app never bundles a face; it gets one of three
   ways:

     loaded in     the reliable one. "Load…" beside the picker takes a
                   .ttf/.otf/.woff and registers it straight from its
                   bytes. Nothing is fetched, nothing is published, and it
                   works on the hosted copy exactly as it does locally.
     found locally opened from the repository root, the six in fonts/ are
                   one directory up and load on their own — over http
                   always, and over file:// in browsers that let a page
                   read a directory above its own — Chromium did in the
                   build these checks run in; Firefox and Safari confine a
                   file:// page to its own directory and are expected to
                   refuse, which nothing here can test. On the hosted
                   copy index.html is the site root, so ../fonts/ points
                   at the account's user-pages root — a different site,
                   which does not exist, so all six 404. Whatever the
                   reason, the failure is quiet and the picker is left
                   offering Load… and the fallback.
     not at all    the mode falls back to what it did before.

   A face registered here is available to every mode, so the next one that
   wants lettering does not have to solve this again.
   ===================================================================== */
"use strict";

(function(){

/* The six in the repository's fonts/ directory, by the path they sit at
   relative to index.html. Names as their own readmes give them. */
const LOCAL=[
  {id:"anothertag",    label:"A Another Tag",        url:"../fonts/a_another_tag/aAnotherTag.ttf"},
  {id:"drippingmarker",label:"A Dripping Marker",    url:"../fonts/a_dripping_marker/adrip1.ttf"},
  {id:"docallisme",    label:"Docallisme On Street", url:"../fonts/docallisme_on_street/docallismeonstreet.otf"},
  {id:"graffitiyouth", label:"Graffiti Youth",       url:"../fonts/graffiti_youth/GraffitiYouth-Regular.otf"},
  {id:"spew",          label:"Spew",                 url:"../fonts/spew/Spew.ttf"},
  {id:"streetwars",    label:"Street Wars Demo",     url:"../fonts/street_wars/Street Wars Demo.ttf"}
];

const faces=[];                                  // {id,label,css,from}
const listeners=[];
let scanned=false;

const cssName=id=>"ForgeFace_"+id;
function on(fn){listeners.push(fn);}
function fire(){for(const fn of listeners)fn();}
function list(){return faces.slice();}
function get(id){for(const f of faces)if(f.id===id)return f;return null;}
function css(id){const f=get(id);return f?f.css:null;}

function add(id,label,face,from){
  if(get(id))return id;
  try{document.fonts.add(face);}catch(e){return null;}
  faces.push({id:id,label:label,css:cssName(id),from:from});
  fire();
  return id;
}

/* Registered from bytes, so no fetch and no origin to be refused by. This is
   the path that always works — including on the hosted copy, where the
   repository's own fonts/ directory does not exist. */
function loadFile(file){
  return new Promise((resolve,reject)=>{
    const name=(file.name||"face").replace(/\.[^.]+$/,"");
    const fr=new FileReader();
    fr.onload=()=>{
      const id="user_"+name.replace(/[^A-Za-z0-9]+/g,"")+"_"+faces.length;
      let face;
      try{face=new FontFace(cssName(id),fr.result);}
      catch(e){reject("That file is not a font this browser can read");return;}
      face.load().then(()=>{
        const got=add(id,name,face,"dropped");
        got?resolve(got):reject("That face could not be registered");
      },()=>reject("That file is not a font this browser can read"));
    };
    fr.onerror=()=>reject("That file could not be read");
    fr.readAsArrayBuffer(file);
  });
}

/* Best effort, once. Every failure here is expected, and silent in the app —
   though not in devtools: on the hosted copy all six 404 and the browser logs
   them, which looks alarming and is not. Some browsers also refuse to read a
   file outside the page's own directory from a file:// page. */
function scan(){
  if(scanned)return Promise.resolve(0);
  scanned=true;
  return Promise.all(LOCAL.map(f=>{
    let face;
    try{face=new FontFace(cssName(f.id),'url("'+encodeURI(f.url)+'")');}
    catch(e){return null;}
    return face.load().then(()=>add(f.id,f.label,face,"local"),()=>null);
  })).then(rs=>{
    const n=rs.filter(Boolean).length;
    if(n)fire();
    return n;
  });
}

window.ForgeFonts={
  LOCAL:LOCAL,
  list:list,get:get,css:css,on:on,
  loadFile:loadFile,scan:scan,
  /* the id a mode should actually draw with: what it asked for if that is
     registered, otherwise the first face there is, otherwise nothing */
  resolve:function(want){
    if(want==="none")return null;                  // asked for the fallback on purpose
    if(want&&want!=="auto"){const f=get(want);if(f)return f;}
    return faces[0]||null;                         // "auto", or a face that has gone away
  },
  count:function(){return faces.length;}
};

})();
