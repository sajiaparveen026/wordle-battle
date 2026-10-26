const {JSDOM}=require("jsdom");const fs=require("fs");const root="/home/claude/wordle-battle/";
const base=fs.readFileSync(root+"index.html","utf8").replace(/<script src="([^"]+)"><\/script>/g,(m,s)=>`<script>${fs.readFileSync(root+s,"utf8")}</script>`);
let fails=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function boot(seed={}){const dom=new JSDOM(base,{runScripts:"dangerously",pretendToBeVisual:true,url:"http://localhost/",beforeParse(w){
 const st=w.setTimeout.bind(w);w.setTimeout=(f,t=0,...a)=>st(f,t/25,...a);w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};
 for(const [k,v] of Object.entries(seed))w.localStorage.setItem(k,JSON.stringify(v));}});
 const w=dom.window,d=w.document,$=s=>d.querySelector(s);
 return {w,d,$,P:()=>w.eval("Player"),type:c=>{for(const x of c)w.press(x)},
  async guess(word){for(const x of word)w.press(x);w.press("enter");await sleep(250);},
  modal:()=>!$("#modal").classList.contains("hidden")};}
(async()=>{
 // ---- A: first game win ----
 let g=boot();await sleep(300);
 g.w.openGame("practice",true);g.w.eval('answer="crane"');
 const coins0=g.P().data.coins;
 await g.guess("about");await g.guess("above");await g.guess("crane");await sleep(300);
 ok(g.modal()&&g.$("#modal-title").textContent==="You got it!","win title");
 ok(g.$("#r-word").textContent.toLowerCase()==="crane","correct word shown");
 ok(g.$("#modal-msg").textContent==="Solved in 3 guesses","guess count shown");
 await sleep(1000);
 ok(g.$("#r-coins").textContent==="+20"&&g.$("#r-xpv").textContent==="+30","reward values animate to +20 / +30");
 ok(g.P().data.coins===coins0+20&&g.P().data.xp===30,"coins/xp added once");
 const cells=[...g.d.querySelectorAll("#stats-grid div")].map(x=>x.querySelector("b").textContent);
 ok(cells.join()==="1,100%,1,3/6","first-game stats: "+cells.join("|"));
 ok(g.d.querySelectorAll("#dist .dist").length===6&&g.d.querySelector("#dist .dist.cur .bar").textContent==="1"&&g.d.querySelectorAll("#dist .dist")[2].classList.contains("cur"),"distribution bar for 3 guesses");
 ok(g.d.querySelectorAll(".confetti").length>0,"confetti on win");
 ok(g.d.body.classList.contains("modal-open"),"background scroll locked");
 ok(g.$("#btn-again").textContent==="Play again","primary button: Play again");
 ok(g.P().reward(g.w.eval("gameId"),"practice",3)===null&&g.P().data.coins===coins0+20,"duplicate reward blocked");
 // share
 let copied="";Object.defineProperty(g.w.navigator,"clipboard",{value:{writeText:async t=>{copied=t;}},configurable:true});
 g.$("#btn-share").click();await sleep(50);
 ok(copied.startsWith("Wordle Battle")&&copied.includes("🟩")&&g.$("#toast").textContent.includes("copied"),"share copies result");
 // close + escape
 g.$("#modal-close").click();ok(!g.modal()&&!g.d.body.classList.contains("modal-open"),"close button");
 g.w.eval("showResult()");ok(g.modal(),"reopen");
 g.d.dispatchEvent(new g.w.KeyboardEvent("keydown",{key:"Escape"}));ok(!g.modal(),"Escape closes");
 g.w.eval("showResult()");
 // ---- B: loss after win ----
 g.$("#btn-again").click();await sleep(60);
 ok(!g.modal()&&g.w.eval("guesses.length")===0,"Play again starts fresh game");
 g.w.eval('answer="crane"');const c1=g.P().data.coins,x1=g.P().data.xp;
 for(const x of ["about","above","actor","adult","agree","alarm"])await g.guess(x);
 await sleep(300);
 ok(g.modal()&&g.$("#modal-title").textContent==="Nice try!","loss title");
 ok(g.$("#r-word").textContent.toLowerCase()==="crane","loss reveals word");
 ok(g.$("#r-rewards").style.display==="none"&&g.P().data.coins===c1&&g.P().data.xp===x1,"no rewards after loss");
 const c2=[...g.d.querySelectorAll("#stats-grid div")].map(x=>x.querySelector("b").textContent);
 ok(c2.join()==="2,50%,0,3/6","loss stats: "+c2.join("|"));
 ok(g.$("#btn-again").textContent==="Try again","loss button: Try again");
 g.$("#btn-home").click();ok(!g.modal()&&!g.$("#dashboard").classList.contains("hidden"),"Dashboard button");
 // ---- C: daily ----
 g.w.openGame("daily");g.w.eval("answer=dailyWord()");await sleep(50);
 const dw=g.w.eval("answer");await g.guess(dw);await sleep(300);
 ok(g.modal()&&g.$("#r-daily").textContent.includes("Daily challenges completed: 1")&&g.$("#btn-again").textContent==="Play solo","daily result + daily line");
 ok(g.P().data.coins===c1+50,"daily reward +50");
 // ---- D: migration of older save ----
 g=boot({wb_player:{username:"Old",avatar:"🐼",coins:340,xp:120,wins:3,losses:1,recent:["L","W","W","W"],hints:{reveal:{free:1,credits:2},remove:{free:0,credits:0}},rewarded:["W:a"]},wb_stats:{played:1,wins:1,streak:1,best:1,dist:[0,1,0,0,0,0],lastDaily:"2026-01-01"}});await sleep(300);
 const o=g.P().data;
 ok(o.coins===340&&o.xp===120&&o.hints.reveal.credits===2&&o.username==="Old","existing coins/xp/hints/name preserved");
 ok(o.dist.join()==="0,1,0,0,0,0"&&o.streak===3&&o.bestGuesses===2,"stats migrated: streak "+o.streak+" best "+o.bestGuesses);
 // ---- E: reduced motion ----
 g=boot({wb_settings:{theme:"dark",mute:false,reduceMotion:true}});await sleep(300);
 ok(g.d.documentElement.dataset.motion==="reduced","reduced-motion applied");
 g.w.openGame("practice",true);g.w.eval('answer="crane"');await g.guess("crane");await sleep(300);
 ok(g.modal()&&g.d.querySelectorAll(".confetti").length===0&&g.$("#r-coins").textContent==="+20","no confetti and instant rewards when reduced");
 g.$("#modal-close").click();g.w.show("settings");g.$("#s-motion").click();
 ok(g.d.documentElement.dataset.motion==="full","settings toggle turns motion back on");
 // ---- F: brand-new stats view with zero games ----
 g=boot();await sleep(300);g.w.eval("renderStats(0)");
 ok(g.$("#stats-grid").textContent.includes("—")&&g.$("#dist").textContent.includes("Win a game"),"zero-game state shows dashes, not fake zeros");
 console.log(fails?"FAILED "+fails:"ALL PASS");process.exit(0);
})();
