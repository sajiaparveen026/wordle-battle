const {JSDOM}=require("jsdom");const fs=require("fs");const root="/home/claude/wordle-battle/";
let fails=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails++};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const base=fs.readFileSync(root+"index.html","utf8");
function boot({seed={},reduce=false,scale=true}={}){const errs=[];
 const html=base.replace(/<script src="([^"]+)"><\/script>/g,(m,s)=>s==="js/vendor/supabase.js"?"":`<script>${s==="js/config.js"?'window.CONFIG={SUPABASE_URL:"",SUPABASE_ANON_KEY:""};window.DEMO_MODE=true;':fs.readFileSync(root+s,"utf8")}</script>`);
 const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"http://localhost/",beforeParse(w){const t=w.setTimeout.bind(w);if(scale)w.setTimeout=(f,ms=0,...a)=>t(f,ms/20,...a);w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};w.addEventListener("error",e=>errs.push(e.message));
  w.localStorage.setItem("wb_mode","guest");for(const [k,v] of Object.entries(seed))w.localStorage.setItem(k,v);if(reduce)w.localStorage.setItem("wb_settings",JSON.stringify({theme:"dark",mute:false,reduceMotion:true}));}});
 const w=dom.window,d=w.document,$=s=>d.querySelector(s);return{w,d,$,errs,open:()=>!$("#tutorial").classList.contains("hidden"),slide:()=>[...d.querySelectorAll("#tutorial .slide")].findIndex(s=>s.classList.contains("on"))};}
(async()=>{
 // first-time guest
 let a=boot();await sleep(300);
 ok(a.open()&&a.slide()===0,"A: tutorial opens automatically on the dashboard for a first-time user");
 ok(a.$("#tut-step").textContent==="Step 1 of 5"&&a.$("#tut-prev").disabled&&!a.$("#tut-next").classList.contains("hidden")&&a.$("#tut-go").classList.contains("hidden"),"A: step 1: Previous disabled, Next shown, Let's Play hidden");
 ok(a.d.body.classList.contains("modal-open")&&a.d.activeElement===a.$("#tut-next"),"A: background locked, focus on Next");
 await sleep(400);const g1=[...a.$("#g1a").children].map(t=>t.textContent).join("");ok(g1==="HELLO","A: slide 1 animation types HELLO ("+g1+")");
 a.$("#tut-next").click();ok(a.slide()===1&&a.$("#tut-step").textContent==="Step 2 of 5"&&!a.$("#tut-prev").disabled,"A: Next -> step 2");
 await sleep(1800);const c1=a.$("#ex1").children[0].classList,c2=a.$("#ex2").children[1].classList,c3=a.$("#ex3").children[3].classList;
 ok(c1.contains("correct")&&c2.contains("present")&&c3.contains("absent"),"A: colour examples animate to green, yellow, grey");
 ok(a.$("#tutorial").textContent.includes("Green")&&a.$("#tutorial").textContent.includes("Yellow")&&a.$("#tutorial").textContent.includes("Grey"),"A: colours are also explained in words");
 a.$("#tut-prev").click();ok(a.slide()===0&&a.$("#tutorial").classList.contains("back"),"A: Previous -> step 1");
 a.$("#tut-next").click();a.$("#tut-next").click();await sleep(2600);
 const r0=[...a.$("#g3a").children].map(t=>t.className.split(" ").filter(x=>["correct","present","absent"].includes(x))[0]);
 ok(r0.join()==="absent,correct,correct,absent,present","A: demo game scores TRAIN vs CRANE correctly: "+r0);
 await sleep(2600);ok([...a.$("#g3b").children].every(t=>t.classList.contains("correct"))&&a.$("#g3b").classList.contains("win")&&a.$("#tut-cap").textContent.includes("You win"),"A: demo finishes with all-green win");
 a.d.dispatchEvent(new a.w.KeyboardEvent("keydown",{key:"ArrowRight"}));ok(a.slide()===3&&a.$("#tut-h1").textContent.includes("50")&&a.$("#tut-h2").textContent.includes("40"),"A: arrow key -> hints slide with real prices 50 / 40");
 a.$('[data-dot="4"]').click();ok(a.slide()===4&&!a.$("#tut-go").classList.contains("hidden")&&a.$("#tut-next").classList.contains("hidden")&&a.$("#tut-skip").classList.contains("hidden"),"A: dot -> last slide shows Let's Play!, hides Next/Skip");
 ok(a.w.localStorage.getItem("wb_tutorial")===null,"A: not marked done before finishing");
 a.$("#tut-go").click();await sleep(30);
 ok(!a.open()&&a.w.localStorage.getItem("wb_tutorial")==="1"&&!a.$("#game").classList.contains("hidden"),"A: Let's Play! saves status, closes, starts a game");
 ok(!a.d.body.classList.contains("modal-open"),"A: background unlocked");
 ok(a.errs.length===0,"A: no JS errors "+a.errs.join());
 // stays dismissed
 let b=boot({seed:{wb_tutorial:"1"}});await sleep(300);ok(!b.open(),"B: does not reopen once completed");
 // reopen from dashboard + profile
 b.$("#dashboard [data-howto]").click();ok(b.open()&&b.slide()===0,"B: dashboard How to Play button reopens it");
 b.$("#tut-skip").click();ok(!b.open(),"B: Skip closes it");
 b.w.show("settings");b.$("#settings [data-howto]").click();ok(b.open(),"B: Profile How to Play button reopens it");
 b.d.dispatchEvent(new b.w.KeyboardEvent("keydown",{key:"Escape"}));ok(!b.open(),"B: Escape closes");
 // skip = done
 let c=boot();await sleep(300);c.$("#tut-skip").click();ok(c.w.localStorage.getItem("wb_tutorial")==="1"&&!c.open(),"C: Skip tutorial marks it done");
 // reduced motion: instant final states
 let r=boot({reduce:true,scale:false});await sleep(2200);r.$("#tut-next").click();
 ok(r.$("#ex1").children[0].classList.contains("correct")&&r.$("#ex3").children[3].classList.contains("absent"),"D: reduced motion shows finished examples immediately");
 // swipe
 let s=boot();await sleep(300);const body=s.$(".tut-body");const ev=(t,x)=>{const e=new s.w.Event(t,{bubbles:true});e.changedTouches=[{clientX:x}];body.dispatchEvent(e)};ev("touchstart",300);ev("touchend",100);ok(s.slide()===1,"E: swipe left -> next");ev("touchstart",100);ev("touchend",300);ok(s.slide()===0,"E: swipe right -> previous");
 // not shown on welcome screen for new visitors
 const w=new JSDOM(base.replace(/<script src="([^"]+)"><\/script>/g,(m,x)=>x==="js/vendor/supabase.js"?"":`<script>${x==="js/config.js"?'window.CONFIG={SUPABASE_URL:"",SUPABASE_ANON_KEY:""};':fs.readFileSync(root+x,"utf8")}</script>`),{runScripts:"dangerously",pretendToBeVisual:true,url:"http://localhost/",beforeParse(x){const t=x.setTimeout.bind(x);x.setTimeout=(f,ms=0,...a)=>t(f,ms/20,...a);x.matchMedia=()=>({matches:false});x.scrollTo=()=>{};}}).window;
 await sleep(300);ok(!w.document.querySelector("#welcome").classList.contains("hidden")&&w.document.querySelector("#tutorial").classList.contains("hidden"),"F: not shown over the Welcome/login screens");
 console.log(fails?"FAILED "+fails:"TUTORIAL ALL PASS");process.exit(0);
})();
