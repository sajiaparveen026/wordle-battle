const {JSDOM}=require("jsdom");const fs=require("fs");const root="/home/claude/wordle-battle/";
const base=fs.readFileSync(root+"index.html","utf8").replace(/<script src="([^"]+)"><\/script>/g,(m,s)=>`<script>${fs.readFileSync(root+s,"utf8")}</script>`);
const dom=new JSDOM(base,{runScripts:"dangerously",pretendToBeVisual:true,url:"http://localhost/",beforeParse(w){const st=w.setTimeout.bind(w);w.setTimeout=(f,t=0,...a)=>st(f,t/25,...a);w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};w.localStorage.setItem("wb_mode","guest");}});
const w=dom.window,d=w.document,$=s=>d.querySelector(s);let fails=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails++;};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const vis=id=>!$("#"+id).classList.contains("hidden");
(async()=>{await sleep(300);
 const exp=new Date().toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"});
 ok($("#d-date").textContent==="📅 "+exp,"daily card shows today's date: "+$("#d-date").textContent);
 ok($("#d-daily-btn").textContent==="Play Now","daily button says Play Now");
 ok(w.eval("today()")===new Date().toLocaleDateString("en-CA"),"today() is the local date");
 for(const [nav,sec] of [["leaderboard","leaderboard"],["shop","shop"],["settings","settings"]]){w.show("dashboard");$(`[data-nav=${nav}]`).click();$(`#${sec} [data-back]`).click();ok(vis("dashboard"),"Back from "+sec+" -> dashboard");}
 w.show("dashboard");$("[data-go=battle]").click();$("#battle [data-back]").click();ok(vis("dashboard"),"Back from battle -> dashboard");
 w.openGame("practice",true);$(".coins").click();ok(vis("shop"),"shop from game");$("#shop [data-back]").click();ok(vis("dashboard"),"Back from shop (opened in game) -> dashboard");
 w.openGame("practice");ok(vis("game")&&w.eval("guesses.length")===0,"game still resumable");$("#g-back").click();ok(vis("dashboard"),"Back from game -> dashboard");
 console.log(fails?"FAILED "+fails:"ALL PASS");process.exit(0);})();
