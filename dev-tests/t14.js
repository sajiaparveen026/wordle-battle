const {JSDOM}=require("jsdom");const fs=require("fs");const root="/home/claude/wordle-battle/";
let fails=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails++};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const base=fs.readFileSync(root+"index.html","utf8");
function boot(seed={}){const errs=[];
 const html=base.replace(/<script src="([^"]+)"><\/script>/g,(m,s)=>s==="js/vendor/supabase.js"?"":`<script>${s==="js/config.js"?'window.CONFIG={SUPABASE_URL:"",SUPABASE_ANON_KEY:""};window.DEMO_MODE=true;':fs.readFileSync(root+s,"utf8")}</script>`);
 const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"http://localhost/",beforeParse(w){const t=w.setTimeout.bind(w);w.setTimeout=(f,ms=0,...a)=>t(f,ms/20,...a);w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};w.addEventListener("error",e=>errs.push(e.message));
  w.localStorage.setItem("wb_mode","guest");w.localStorage.setItem("wb_tutorial","1");for(const [k,v] of Object.entries(seed))w.localStorage.setItem(k,typeof v==="string"?v:JSON.stringify(v));}});
 const w=dom.window,d=w.document,$=s=>d.querySelector(s);
 return{w,d,$,errs,pop:()=>!$("#daily-done").classList.contains("hidden"),gameShown:()=>!$("#game").classList.contains("hidden"),
  async guess(x){for(const c of x)w.press(c);w.press("enter");await sleep(300)}};}
const iso=(off=0)=>{const d=new Date();d.setDate(d.getDate()+off);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
(async()=>{
 // 1) not completed: Play works exactly as before
 let a=boot();await sleep(300);
 ok(a.$("#d-daily-btn").textContent==="Play Now","1: button says Play Now before playing");
 a.$("#d-daily-btn").click();ok(a.gameShown()&&!a.pop(),"1: not completed -> gameplay screen opens, no popup");
 // play and win in 3
 const dw=a.w.eval("dailyWord()"),wrong=a.w.eval("ANSWERS").filter(x=>x!==dw);
 await a.guess(wrong[0]);await a.guess(wrong[1]);await a.guess(dw);await sleep(300);
 ok(a.w.eval("status")==="won","1: daily won in 3 guesses");
 const coins=a.w.eval("Player.data.coins"),xp=a.w.eval("Player.data.xp");
 a.$("#modal-close").click();a.w.show("dashboard");
 ok(a.$("#d-daily-btn").textContent==="View today's result","1: dashboard button now shows the result action");
 // 2) completed: popup instead of gameplay
 a.$("#d-daily-btn").click();
 ok(a.pop()&&!a.gameShown()&&a.$("#dashboard").classList.contains("hidden")===false,"2: Play on a completed daily opens the result popup, not the game");
 ok(a.$("#dd-status").textContent==="✓ Solved"&&a.$("#dd-word").textContent==="The word was "+dw.toUpperCase(),"2: win status + word shown");
 ok(a.$("#dd-date").textContent.length>5,"2: today's date shown ("+a.$("#dd-date").textContent+")");
 ok(a.$("#dd-attempts").textContent==="3/6"&&a.$("#dd-score").textContent==="400","2: attempts 3/6, score 400");
 ok(a.$("#dd-coins").textContent==="+50"&&a.$("#dd-xp").textContent==="+60","2: coins +50, XP +60 (what this game earned)");
 ok(a.$("#daily-done").textContent.includes("Challenge completed! See you tomorrow for a brand-new word!"),"2: friendly message present");
 const st=[...a.d.querySelectorAll("#dd-stats div")].map(x=>x.querySelector("b").textContent+" "+x.querySelector("small").textContent);
 ok(st.join("|")==="1 Daily streak|1 Best streak|1 Played|100% Win rate","2: daily stats: "+st.join("|"));
 ok(a.d.querySelectorAll("#dd-grid .row").length===3&&a.d.querySelectorAll("#dd-grid .tile.correct").length>=5,"2: grid replays the 3 guesses with colours");
 ok(/^Next word in \d\d:\d\d:\d\d$/.test(a.$("#dd-next").textContent),"2: countdown to tomorrow: "+a.$("#dd-next").textContent);
 ok(a.d.body.classList.contains("modal-open")&&a.d.activeElement===a.$("#dd-ok")&&a.$("#dd-ok").textContent==="Okay!","2: Okay! button focused, page locked");
 // 3) no replay / no duplicate rewards
 ok(a.w.eval("Player.data.coins")===coins&&a.w.eval("Player.data.xp")===xp,"3: opening the popup grants nothing");
 ok(a.w.eval('Player.reward("daily-"+today(),"daily",3)')===null&&a.w.eval("Player.data.coins")===coins,"3: same daily cannot be rewarded twice");
 a.$("#dd-ok").click();ok(!a.pop()&&!a.d.body.classList.contains("modal-open"),"3: Okay! closes the popup");
 a.w.eval('openGame("daily")');ok(a.pop()&&!a.gameShown(),"3: any route into the daily (openGame) shows the result again, never the board");
 a.d.dispatchEvent(new a.w.KeyboardEvent("keydown",{key:"Escape"}));ok(!a.pop(),"3: Escape also closes");
 ok(a.w.eval("guesses.length")===3&&a.w.eval("stats.played")===1,"3: nothing changed in saved daily progress");
 ok(a.errs.length===0,"3: no JS errors "+a.errs.join());
 // 4) loss
 let b=boot();await sleep(300);b.$("#d-daily-btn").click();const bw=b.w.eval("dailyWord()"),bl=b.w.eval("ANSWERS").filter(x=>x!==bw);
 for(let i=0;i<6;i++)await b.guess(bl[i]);await sleep(300);ok(b.w.eval("status")==="lost","4: daily lost");
 b.$("#modal-close").click();b.w.show("dashboard");b.$("#d-daily-btn").click();
 ok(b.pop()&&b.$("#dd-status").textContent.startsWith("✗")&&b.$("#dd-coins").textContent==="+0"&&b.$("#dd-xp").textContent==="+0"&&b.$("#dd-score").textContent==="0"&&b.$("#dd-attempts").textContent==="6/6","4: loss popup: not solved, 6/6, score 0, no rewards");
 ok(b.$("#dd-word").textContent.includes(bw.toUpperCase())&&b.$("#daily-done").textContent.includes("See you tomorrow"),"4: word revealed + same friendly message");
 // 5) second device: stats + reward record synced, but no saved guesses
 const pl={username:"P",avatar:"🦊",coins:150,xp:60,wins:1,losses:0,hints:{reveal:{free:2,credits:0},remove:{free:2,credits:0}},rewarded:["W:daily-"+iso()],recent:["W"],dist:[0,0,1,0,0,0],streak:1,bestStreak:1,bestGuesses:3};
 let c=boot({wb_player:pl,wb_stats:{played:1,wins:1,streak:1,best:1,dist:[0,0,1,0,0,0],lastDaily:iso()}});await sleep(300);
 ok(c.$("#d-daily-btn").textContent==="View today's result","5: completion detected from synced data");
 c.$("#d-daily-btn").click();ok(c.pop()&&!c.gameShown()&&c.$("#dd-status").textContent==="✓ Solved"&&c.$("#dd-attempts").textContent==="—"&&c.$("#dd-grid").style.display==="none","5: popup works without saved guesses (no grid, attempts unknown)");
 ok(c.$("#dd-coins").textContent==="+50","5: reward shown from the once-only reward record");
 // 6) yesterday's result does not block today
 let e=boot({wb_game_daily:{date:iso(-1),id:"daily-"+iso(-1),answer:"crane",guesses:["crane"],status:"won"},wb_stats:{played:1,wins:1,streak:1,best:1,dist:[1,0,0,0,0,0],lastDaily:iso(-1)}});await sleep(300);
 ok(e.$("#d-daily-btn").textContent==="Play Now","6: completed YESTERDAY -> today shows Play Now");
 e.$("#d-daily-btn").click();ok(e.gameShown()&&!e.pop()&&e.w.eval("guesses.length")===0,"6: new day -> fresh daily game opens");
 // 7) in-progress today resumes
 let f=boot({wb_game_daily:{date:iso(),id:"daily-"+iso(),answer:"crane",guesses:["about","above"],status:"playing"}});await sleep(300);
 f.$("#d-daily-btn").click();ok(f.gameShown()&&!f.pop()&&f.w.eval("guesses.length")===2,"7: unfinished daily resumes in the game as before");
 console.log(fails?"FAILED "+fails:"DAILY POPUP ALL PASS");process.exit(0);
})();
