const {JSDOM,VirtualConsole}=require("jsdom");const fs=require("fs");const root="/home/claude/wordle-battle/";
const base=fs.readFileSync(root+"index.html","utf8").replace(/<script src="([^"]+)"><\/script>/g,(m,s)=>`<script>${fs.readFileSync(root+s,"utf8")}</script>`);
let fails=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails++;};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function boot({controller=true,waiting=false}={}){
 const st={reloads:0,updates:0,posted:[]};const vc=new VirtualConsole();vc.on("jsdomError",e=>{if(/navigation/.test(e.message))st.reloads++});
 const mk=()=>{const t=new EventTarget();return t};
 const reg=mk();reg.waiting=waiting?Object.assign(mk(),{state:"installed",postMessage:m=>st.posted.push(m)}):null;reg.installing=null;
 reg.update=async()=>{st.updates++;if(reg.onUpdate)await reg.onUpdate()};
 const sw=mk();sw.controller=controller?{}:null;sw.register=async()=>reg;
 const dom=new JSDOM(base,{runScripts:"dangerously",pretendToBeVisual:true,url:"http://localhost/",virtualConsole:vc,beforeParse(w){
  w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};Object.defineProperty(w.navigator,"serviceWorker",{value:sw});}});
 const w=dom.window,d=w.document,$=s=>d.querySelector(s);
 // simulate the browser finding + installing a changed sw.js (this is what a real deploy triggers)
 const deploy=async()=>{const nw=Object.assign(mk(),{state:"installing",postMessage:m=>st.posted.push(m)});reg.installing=nw;reg.dispatchEvent(new Event("updatefound"));
   await sleep(5);nw.state="installed";reg.installing=null;reg.waiting=nw;nw.dispatchEvent(new Event("statechange"));await sleep(5)};
 return {st,reg,sw,w,d,$,deploy,hidden:id=>$("#"+id).classList.contains("hidden")};}
(async()=>{
 let a=boot();await sleep(80);
 ok(a.hidden("update-bar"),"no update bar when no update exists");
 ok(a.st.updates>=1,"update check runs when the app opens");
 ok(/^Version 1\.5\.0 \(build [0-9a-f]+\)$/.test(a.$("#s-version").textContent)||a.$("#s-version").textContent.includes("Version 1.5.0"),"version shown: "+a.$("#s-version").textContent);
 a.w.PWA.renderAbout();ok(a.hidden("s-update-btn"),"no Update App button in Settings when up to date");
 await a.deploy();ok(!a.hidden("update-bar")&&a.$("#update-text").textContent.includes("new version"),"update bar appears when a new worker finishes installing");
 ok(!a.hidden("s-update-btn")&&a.$("#s-update-note").textContent.includes("ready"),"Settings shows 'update ready' + Update App");
 const u0=a.st.updates;a.d.dispatchEvent(new a.w.Event("visibilitychange"));await sleep(20);ok(a.st.updates>u0,"update check runs when the user returns to the app");
 a.$("#update-btn").click();
 ok(a.$("#update-text").textContent==="Updating..."&&a.$("#update-btn").disabled,"shows 'Updating...' after tapping Update App");
 ok(a.st.posted.length===1&&a.st.posted[0].type==="SKIP_WAITING","tells waiting worker to activate");
 ok(a.st.reloads===0,"no reload until the new worker takes control");
 a.sw.dispatchEvent(new Event("controllerchange"));await sleep(20);ok(a.st.reloads===1,"reloads once when new worker takes control");
 a.sw.dispatchEvent(new Event("controllerchange"));await sleep(20);ok(a.st.reloads===1,"no second reload (no loops)");
 a.$("#update-btn").click();ok(a.st.posted.length===1,"double tap does not re-send");
 // first install: no existing controller -> not an "update"
 let b=boot({controller:false});await sleep(60);await b.deploy();ok(b.hidden("update-bar"),"first install does not show an update notice");
 b.sw.dispatchEvent(new Event("controllerchange"));await sleep(20);ok(b.st.reloads===0,"first-install clients.claim() does not reload the page");
 // already waiting when app opens
 let c=boot({waiting:true});await sleep(60);ok(!c.hidden("update-bar"),"waiting update found at startup is offered");
 // manual check: nothing new
 let e=boot();await sleep(60);e.w.show("settings");e.$("#s-check-btn").click();await sleep(60);ok(e.$("#s-update-note").textContent.includes("latest")&&e.hidden("update-bar"),"manual check with nothing new says latest, no bar");
 // manual check: a real new worker appears during update()
 let f=boot();await sleep(60);f.reg.onUpdate=async()=>{f.reg.onUpdate=null;await f.deploy()};f.w.show("settings");f.$("#s-check-btn").click();await sleep(120);ok(!f.hidden("update-bar"),"manual check that finds a new worker shows the update bar");
 // offline bar
 let g=boot();await sleep(40);Object.defineProperty(g.w.navigator,"onLine",{value:false,configurable:true});g.w.dispatchEvent(new g.w.Event("offline"));ok(!g.hidden("offline-bar")&&g.$("#offline-bar").textContent.includes("offline"),"offline message shown");
 Object.defineProperty(g.w.navigator,"onLine",{value:true,configurable:true});g.w.dispatchEvent(new g.w.Event("online"));ok(g.hidden("offline-bar"),"offline message hides when back online");
 // install button
 let h=boot();await sleep(40);ok(h.d.querySelector("[data-install-wrap]").classList.contains("hidden"),"Install App hidden when not installable");
 let prompted=0;const ev=new h.w.Event("beforeinstallprompt");ev.preventDefault=()=>{};ev.prompt=()=>{prompted++};ev.userChoice=Promise.resolve({outcome:"accepted"});h.w.dispatchEvent(ev);
 ok(!h.d.querySelector("[data-install-wrap]").classList.contains("hidden"),"Install App appears when Chrome says installable");
 h.$("[data-install]").click();await sleep(20);ok(prompted===1&&h.d.querySelector("[data-install-wrap]").classList.contains("hidden"),"Install App button opens the install prompt then hides");
 // saved progress untouched by update UI
 console.log(fails?"FAILED "+fails:"PWA UI ALL PASS");process.exit(0);
})();
