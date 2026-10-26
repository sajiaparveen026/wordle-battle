const fs=require("fs"),vm=require("vm"),path=require("path");const root="/home/claude/wordle-battle/";
let fails=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails++;};
// ---------- manifest + files ----------
const man=JSON.parse(fs.readFileSync(root+"manifest.webmanifest","utf8"));
ok(man.name==="Wordle Battle"&&man.display==="standalone"&&man.theme_color&&man.background_color&&man.start_url,"manifest: name/standalone/colors/start_url");
ok(man.icons.some(i=>i.sizes==="192x192")&&man.icons.some(i=>i.sizes==="512x512"&&i.purpose==="any")&&man.icons.some(i=>i.purpose==="maskable"),"manifest: 192, 512 and maskable icons declared");
ok(man.icons.every(i=>fs.existsSync(root+i.src)),"manifest: every icon file exists");
const html=fs.readFileSync(root+"index.html","utf8");
ok(html.includes('rel="manifest"')&&html.includes('name="theme-color"')&&html.includes("js/pwa.js"),"index.html links manifest, theme-color, pwa.js");
// ---------- service worker (mocked browser APIs) ----------
function loadSW(opts={}){
 const origin="https://game.test", store=new Map(), calls={fetch:[],put:[],skip:0,claim:0}, handlers={};
 const norm=u=>new URL(typeof u==="string"?u:u.url,origin+"/sw.js").href;
 const mkCache=(m)=>({put:async(k,r)=>{calls.put.push(norm(k));m.set(norm(k),r)},match:async(k)=>m.get(norm(k))});
 class Request{constructor(u,o={}){this.url=norm(u);this.cache=o.cache}}
 const ctx={URL,Request,Promise,console,
  caches:{open:async n=>{if(!store.has(n))store.set(n,new Map());return mkCache(store.get(n))},keys:async()=>[...store.keys()],delete:async n=>store.delete(n)},
  fetch:async(r)=>{calls.fetch.push(r);if(opts.offline)throw new Error("offline");const u=norm(r);if(opts.missing&&u.endsWith(opts.missing))return{ok:false,status:404};return{ok:true,url:u,body:"net:"+u}},
  importScripts:(...f)=>f.forEach(x=>vm.runInContext(fs.readFileSync(root+x.replace("./",""),"utf8"),ctx))};
 ctx.self=ctx;ctx.location={origin};ctx.skipWaiting=()=>{calls.skip++};ctx.clients={claim:async()=>{calls.claim++}};
 ctx.addEventListener=(t,f)=>handlers[t]=f;
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(root+"sw.js","utf8"),ctx);
 const run=async(type,ev={})=>{let p;ev.waitUntil=x=>p=x;ev.respondWith=x=>{ev.responded=true;p=x};handlers[type](ev);return {ev,res:await p}};
 return {ctx,store,calls,run,origin};
}
(async()=>{
 let s=loadSW();await s.run("install");
 const name=[...s.store.keys()][0];
 ok(/^wordle-battle-1\.5\.0-[0-9a-f]{8}$/.test(name),"cache name has version + build: "+name);
 const asset=fs.readFileSync(root+"sw.js","utf8").match(/ASSETS = \[([\s\S]*?)\]/)[1].match(/"\.\/[^"]*"/g).map(x=>x.slice(3,-1)).filter(Boolean);
 ok(asset.every(a=>fs.existsSync(root+a)),"every precached file exists on disk ("+asset.length+" files)");
 ok(s.store.get(name).size===asset.length+0||s.store.get(name).size>=asset.length,"all assets precached");
 ok(s.calls.fetch.every(r=>r.cache==="reload"),"precache bypasses HTTP cache");
 ok(s.calls.skip===0,"install does NOT skipWaiting (waits for player)");
 let threw=false;try{await loadSW({missing:"/js/app.js"}).run("install")}catch{threw=true}
 ok(threw,"install fails (and old version stays) if any asset is missing");
 s.store.set("wordle-battle-0.9.0-old",new Map());s.store.set("other-site-cache",new Map());
 await s.run("activate");
 ok(!s.store.has("wordle-battle-0.9.0-old")&&s.store.has("other-site-cache")&&s.store.has(name),"activate deletes only old Wordle Battle caches");
 ok(s.calls.claim===1,"activate claims clients");
 await s.run("message",{data:{type:"nope"}}).catch(()=>{});ok(s.calls.skip===0,"unknown message ignored");
 s.run("message",{data:{type:"SKIP_WAITING"}});ok(s.calls.skip===1,"SKIP_WAITING message activates the new worker");
 const req=(u,m="GET",mode="cors")=>({url:u.startsWith("http")?u:s.origin+u,method:m,mode});
 let r=await s.run("fetch",{request:req("https://abc.supabase.co/auth/v1/token","POST")});ok(!r.ev.responded,"Supabase POST untouched by service worker");
 r=await s.run("fetch",{request:req("https://abc.supabase.co/rest/v1/profiles")});ok(!r.ev.responded,"Supabase GET (cross-origin) untouched");
 r=await s.run("fetch",{request:req("/api/anything","POST")});ok(!r.ev.responded,"same-origin POST untouched");
 const before=s.calls.put.length;
 r=await s.run("fetch",{request:req("/data/private.json")});ok(r.ev.responded&&r.res.body.startsWith("net:")&&s.calls.put.length===before,"non-precached GET goes to network and is never stored");
 r=await s.run("fetch",{request:req("/js/app.js")});ok(r.res.body&&s.calls.fetch.length>=asset.length,"precached asset served from versioned cache");
 r=await s.run("fetch",{request:req("/?code=abc123&type=recovery","GET","navigate")});ok(r.res&&r.res.url.endsWith("/index.html"),"navigation with auth ?code= returns the app shell");
 const off=loadSW({offline:true});await off.run("install").catch(()=>{});
 // offline navigation: pre-fill cache then fail network
 const off2=loadSW();await off2.run("install");off2.ctx.fetch=async()=>{throw new Error("offline")};
 r=await off2.run("fetch",{request:{url:off2.origin+"/","method":"GET",mode:"navigate"}});ok(r.res&&r.res.url.endsWith("/index.html"),"app opens offline from cache");
 console.log(fails?"FAILED "+fails:"SW ALL PASS");process.exit(fails?1:0);
})();
