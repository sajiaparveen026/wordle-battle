// Profile: Solo/Battle stats + Recent Plays categories (jsdom)
const {JSDOM}=require("jsdom");const fs=require("fs");const root=__dirname+"/../";
let fails=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails++};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const base=fs.readFileSync(root+"index.html","utf8");
function boot(seed={}){const errs=[];
 const html=base.replace(/<script src="([^"]+)"><\/script>/g,(m,s)=>s==="js/vendor/supabase.js"?"":`<script>${s==="js/config.js"?'window.CONFIG={SUPABASE_URL:"",SUPABASE_ANON_KEY:""};window.DEMO_MODE=true;':fs.readFileSync(root+s,"utf8").replace(/<\/script>/g,"<\\/script>")}</script>`);
 const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"http://localhost/",beforeParse(w){w.matchMedia=w.matchMedia||(()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}}));w.scrollTo=()=>{};
  w.addEventListener("error",e=>errs.push(e.message));w.localStorage.setItem("wb_mode","guest");w.localStorage.setItem("wb_tutorial","1");for(const [k,v] of Object.entries(seed))w.localStorage.setItem(k,typeof v==="string"?v:JSON.stringify(v));}});
 return{w:dom.window,$:s=>dom.window.document.querySelector(s),$$:s=>[...dom.window.document.querySelectorAll(s)],errs};}
(async()=>{
 const a=boot();await sleep(400);const {w,$,$$}=a;
 const ev=c=>w.eval(c);
 // legacy-style save: 10 wins, 4 losses of which 3 wins + 1 loss were battles
 ev(`Object.assign(Player.data,{wins:10,losses:4,streak:2,battles:{played:4,won:3},bstats:{played:4,won:3,lost:1,draw:0,streak:0,best:0},history:[{id:"a",mode:"practice",won:true,tries:3,at:new Date().toISOString()},{id:"b",mode:"daily",won:true,tries:4,at:new Date().toISOString()},{id:"c",mode:"practice",won:false,tries:6,at:new Date().toISOString()}]});Player.save()`);
 w.show("profile");
 ok($("#pf-modes .on").dataset.pfs==="solo","Solo selected by default");
 ok($("#pf-played").textContent==="10"&&$("#pf-won").textContent==="7","Solo excludes battles (10 played, 7 won) -> "+$("#pf-played").textContent+"/"+$("#pf-won").textContent);
 // battles: win, win, draw, loss, win via rewardBattle (+ duplicate id must not double count)
 ev(`Player.rewardBattle("r1","win",40,40,{type:"friend",tries:3,status:"solved",ms:42100,opp:{name:"zed",avatar:"🦊"}});Player.rewardBattle("r2","win",40,40,{type:"team",tries:4,status:"solved",place:1,size:4});Player.rewardBattle("r2","win",40,40,{type:"team"});Player.rewardBattle("r3","draw",10,10,{type:"friend",tries:6,status:"failed"});`);
 ok(ev("Player.data.bstats.streak")===2&&ev("Player.data.bstats.played")===7,"streak 2 after two wins, duplicate ignored, draw counted as played");
 ev(`Player.rewardBattle("r4","loss",5,5,{type:"team",tries:6,status:"failed",place:3,size:3})`);
 ok(ev("Player.data.bstats.streak")===0,"loss resets streak");
 ev(`Player.rewardBattle("r5","win",40,40,{type:"friend",tries:2,status:"solved",ms:9000,opp:{name:"amy",avatar:"🐼"}})`);
 w.show("profile");
 ok($("#pf-played").textContent==="10"&&$("#pf-won").textContent==="7","Solo unchanged by new battles");
 $('#pf-modes [data-pfs="battle"]').click();
 ok($("#pf-played").textContent==="9"&&$("#pf-won").textContent==="6"&&$("#pf-wstreak").textContent==="1"&&$("#pf-rate").textContent==="67%","Battle: 9 played, 6 won, 67%, streak 1 -> "+["#pf-played","#pf-won","#pf-rate","#pf-wstreak"].map(s=>$(s).textContent));
 ok($("#pf-l-played").textContent==="Battles Played","labels switch");
 $('#pf-modes [data-pfs="solo"]').click();ok($("#pf-played").textContent==="10","Solo restored");
 ok($$("#pf-rfilter [data-pfr]").length===3,"exactly 3 recent filters");
 const rows=f=>{$(`#pf-rfilter [data-pfr="${f}"]`).click();return $$("#pf-games .pf-game")};
 ok(rows("daily").length===1&&rows("solo").length===2,"Daily 1 entry, Solo 2 entries (no daily in solo)");
 const b=rows("battle");ok(b.length===5,"Battle shows 5");
 ok(b[0].textContent.includes("Friend Battle")&&b[0].textContent.includes("amy"),"newest first: friend battle with opponent");
 ok(b[1].textContent.includes("Team Battle")&&b[1].textContent.includes("3rd of 3 players")&&b[1].textContent.includes("LOSS"),"team battle position + participants");
 ok(b[2].textContent.includes("DRAW"),"draw shown");
 ok(!/answer|secret/i.test($("#pf-games").textContent),"no answers exposed");
 ok(a.errs.length===0,"no script errors "+a.errs.join("|"));
 console.log(fails?"FAILED "+fails:"ALL PASS");process.exit(fails?1:0);
})();