const {JSDOM}=require("jsdom");const fs=require("fs");const root="/home/claude/wordle-battle/";
let html=fs.readFileSync(root+"index.html","utf8").replace(/<script src="([^"]+)"><\/script>/g,(m,s)=>`<script>${fs.readFileSync(root+s,"utf8")}</script>`);
const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"http://localhost/"});
const w=dom.window,d=w.document,$=s=>d.querySelector(s);let fails=0;
const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails++;};
w.matchMedia=()=>({matches:true});
const click=s=>$(s).click();const vis=id=>!$("#"+id).classList.contains("hidden");
setTimeout(async()=>{
 ok(vis("dashboard"),"dashboard after splash");
 ok($("#d-rewards").textContent.includes("+50"),"daily rewards shown");
 ok($(".coins .coin-val").textContent==="100","coins 100");
 for(const [n,s] of [["leaderboard","leaderboard"],["shop","shop"],["settings","settings"],["dashboard","dashboard"]]){click(`[data-nav=${n}]`);ok(vis(s)&&$(`[data-nav=${n}]`).classList.contains("on"),"nav "+n);}
 ok(vis("dashboard"),"home");
 click("[data-nav=play]");ok(vis("game")&&$("#bottomnav").classList.contains("hidden"),"play opens game, nav hidden");
 const b=[...d.querySelectorAll(".hint small")].map(x=>x.textContent);ok(b[0]==="2 free left"&&b[1]==="2 free left","hint badges "+b);
 click("[data-hint=reveal]");await new Promise(r=>setTimeout(r,50));
 ok($("#toast").textContent.includes("Letter"),"reveal works");ok($(".hint small").textContent==="1 free left","free decremented");
 click("[data-hint=remove]");ok(d.querySelectorAll(".key.disabled").length>0,"remove disables keys");
 click(".coins");ok(vis("shop"),"coin pill opens shop");
 click("[data-back]");ok(vis("game"),"back from shop returns to game");
 click("#g-back");ok(vis("dashboard"),"back to dashboard");
 click("[data-go=daily]");ok(vis("game")&&$("#g-title").textContent==="Daily Challenge","daily opens");
 click("#g-back");click("[data-go=battle]");ok(vis("battle"),"battle screen");
 click("[data-go=dashboard]");click("#go-settings");ok(vis("settings")&&$("#p-name").textContent.length>0,"profile card");
 console.log(fails?"FAILED "+fails:"ALL PASS");process.exit(0);
},2200);
w.addEventListener("error",e=>{console.log("JS ERROR",e.message);});
