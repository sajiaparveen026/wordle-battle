const {JSDOM}=require("jsdom");const fs=require("fs");const root="/home/claude/wordle-battle/";
let fails=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails++};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const base=fs.readFileSync(root+"index.html","utf8");
function boot(seed={}){const errs=[];
 const html=base.replace(/<script src="([^"]+)"><\/script>/g,(m,s)=>s==="js/vendor/supabase.js"?"":`<script>${s==="js/config.js"?'window.CONFIG={SUPABASE_URL:"",SUPABASE_ANON_KEY:""};window.DEMO_MODE=true;':fs.readFileSync(root+s,"utf8")}</script>`);
 const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"http://localhost/",beforeParse(w){const t=w.setTimeout.bind(w);w.setTimeout=(f,ms=0,...a)=>t(f,ms/20,...a);w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};w.addEventListener("error",e=>errs.push(e.message));
  w.localStorage.setItem("wb_mode","guest");w.localStorage.setItem("wb_tutorial","1");for(const [k,v] of Object.entries(seed))w.localStorage.setItem(k,typeof v==="string"?v:JSON.stringify(v));}});
 const w=dom.window,d=w.document,$=s=>d.querySelector(s);
 const api={w,d,$,errs,P:()=>w.eval("Player.data"),ev:(x)=>w.eval(x),type:(x)=>{for(const c of x)w.press(c)},async guess(x){api.type(x);$("#btn-submit").click();await sleep(300)},
  dlgOpen:()=>!$("#dialog").classList.contains("hidden"),dlg:(i)=>{const b=d.querySelectorAll("#dlg-actions button");b[i<0?b.length-1:i].click()},msg:()=>$("#submit-msg").textContent,
  skipLabel:()=>$("#btn-skip small").textContent,tiles:(r)=>[...$("#board").children[r].children]};return api;}
(async()=>{
 let a=boot();await sleep(300);a.w.openGame("practice",true);await sleep(50);a.ev('answer="crane"');
 // ---- layout / top bar ----
 ok(a.$("#g-back").textContent.trim()===""&&a.$("#g-back").getAttribute("aria-label")==="Back","top-left back is an icon only (no 'Back' text)");
 ok(a.$(".winscore .win-val").textContent==="0"&&a.$("#game .coins .coin-val").textContent==="100","win score + coin balance in the top bar");
 ok(!a.$("#game .streak")&&a.$("#attempts").classList.contains("sr-only")&&!/attempt/i.test([...a.d.querySelectorAll("#game *")].filter(e=>!e.closest(".sr-only")&&e.children.length===0).map(e=>e.textContent).join(" ")),"no streak and no visible attempts-left counter in the game");
 ok(!a.$("[data-key=enter]")&&[...a.d.querySelectorAll("#keyboard .krow")].map(r=>r.children.length).join()==="10,9,8","keyboard has no Enter key (rows 10/9/8)");
 ok(a.$("#btn-submit").textContent.includes("Submit")&&a.$("#btn-skip")&&a.d.querySelectorAll(".controls .hint").length===2,"Submit, two hint icons and Skip are in the bottom controls");
 // ---- submit validation ----
 a.type("ab");a.$("#btn-submit").click();ok(a.msg().includes("Not enough letters")&&a.ev("guesses.length")===0&&a.tiles(0)[0].textContent==="a","incomplete guess: inline error, letters kept");
 a.type("c");a.ev('press("back");press("back");press("back")');a.type("zzzzz");a.$("#btn-submit").click();
 ok(a.msg()==="⚠ Not a word!","invalid word shows inline 'Not a word!'");
 ok(a.tiles(0).map(t=>t.textContent).join("")==="zzzzz"&&a.ev("current")==="zzzzz","invalid word stays on the grid so it can be corrected");
 ok(a.ev("guesses.length")===0&&a.tiles(0).every(t=>!/correct|present|absent/.test(t.className)),"invalid word uses no attempt and reveals no colours");
 a.ev('press("back")');ok(a.msg()==="","message clears when the player edits");
 a.ev('press("z")');a.$("#btn-submit").click();ok(a.msg().includes("Not a word")&&a.ev("guesses.length")===0,"still invalid after retry");
 for(let i=0;i<5;i++)a.ev('press("back")');
 // valid guess + busy guard
 a.type("trail");a.$("#btn-submit").click();a.$("#btn-submit").click();a.$("#btn-submit").click();ok(a.$("#btn-submit").disabled,"Submit disabled while tiles flip");await sleep(300);
 ok(a.ev("guesses.length")===1&&!a.$("#btn-submit").disabled,"rapid triple click submits once");
 const row=a.tiles(0).map(t=>t.className);ok(row[1].includes("correct")&&row[0].includes("absent"),"valid guess scored (R green, T grey)");
 a.type("trail");a.$("#btn-submit").click();ok(a.msg().includes("Already guessed")&&a.ev("guesses.length")===1,"duplicate guess blocked inline");
 for(let i=0;i<5;i++)a.ev('press("back")');
 // physical Enter still works as a shortcut
 a.type("crape");a.ev('press("enter")');await sleep(300);ok(a.ev("guesses.length")===2,"physical Enter key still submits (desktop shortcut)");
 // ---- win score ----
 const w0=a.P().wins;a.type("crane");a.$("#btn-submit").click();await sleep(400);
 ok(a.ev("status")==="won"&&a.P().wins===w0+1&&a.$(".winscore .win-val").textContent===String(w0+1),"win score goes up by exactly 1 after a win");
 ok(a.$("#btn-submit").disabled&&a.$("#btn-skip").classList.contains("off"),"after the game ends: Submit disabled, Skip off");
 a.$("#btn-submit").click();ok(a.ev("guesses.length")===3,"no extra guess after the game ends");
 a.$("#modal-close").click();
 // ---- hints keep working ----
 a.w.openGame("practice",true);await sleep(50);a.ev('answer="crane"');
 ok([...a.d.querySelectorAll(".hint small")].map(x=>x.textContent).join()==="2 free,2 free","hint icons show free uses");
 a.$("[data-hint=reveal]").click();await sleep(60);ok(a.$("[data-hint=reveal] small").textContent==="1 free"&&Object.keys(a.ev("hintState.reveals")).length===1,"reveal hint still works and counts down");
 a.P().hints.remove.free=0;a.P().hints.remove.credits=0;a.w.updateHintButtons();ok(a.$("[data-hint=remove] small").textContent==="40 🪙","price shown once free uses are gone");
 const c0=a.P().coins;a.$("[data-hint=remove]").click();await sleep(60);ok(a.dlgOpen()&&a.$("#dlg-msg").textContent.includes("40 coins"),"coin hint asks for confirmation");a.dlg(0);await sleep(30);ok(a.P().coins===c0,"cancel charges nothing");
 // ---- skips ----
 ok(a.skipLabel()==="3 free","skip shows 3 free by default");
 const gid0=a.ev("gameId");a.$("#btn-skip").click();await sleep(30);ok(a.dlgOpen()&&a.$("#dlg-title").textContent==="Skip this word?","skip asks for confirmation");
 a.dlg(0);await sleep(30);ok(a.P().skips.free===3&&a.ev("gameId")===gid0,"cancelling a skip changes nothing");
 const wins=a.P().wins,losses=a.P().losses,rew=a.P().rewarded.length,coinsB=a.P().coins;
 a.$("#btn-skip").click();await sleep(30);a.dlg(-1);await sleep(50);
 ok(a.P().skips.free===2&&a.skipLabel()==="2 free"&&a.ev("gameId")!==gid0&&a.ev("guesses.length")===0&&a.ev("status")==="playing","free skip: 2 left, brand-new word and game");
 ok(a.P().wins===wins&&a.P().losses===losses&&a.P().rewarded.length===rew&&a.P().coins===coinsB,"skipping gives no win, loss, reward or charge");
 a.$("#btn-skip").click();a.$("#btn-skip").click();a.$("#btn-skip").click();await sleep(30);ok(a.d.querySelectorAll("#dlg-actions button").length===2,"rapid taps open one dialog only");a.dlg(-1);await sleep(50);
 ok(a.P().skips.free===1,"rapid taps cost one skip, not three");
 a.$("#btn-skip").click();await sleep(30);a.dlg(-1);await sleep(50);ok(a.P().skips.free===0&&a.skipLabel()==="30 🪙","free skips used up -> coin price shown");
 const cc=a.P().coins;a.$("#btn-skip").click();await sleep(30);ok(a.dlgOpen()&&a.$("#dlg-msg").textContent.includes("30 coins"),"paid skip asks 'Use 30 coins'");a.dlg(0);await sleep(30);ok(a.P().coins===cc,"cancel: no charge");
 a.$("#btn-skip").click();await sleep(30);a.dlg(-1);await sleep(50);ok(a.P().coins===cc-30&&a.P().skips.free===0,"confirmed paid skip charges exactly 30 coins");
 a.$("#btn-skip").click();a.$("#btn-skip").click();await sleep(30);a.dlg(-1);await sleep(50);ok(a.P().coins===cc-60,"double tap on a paid skip charges once");
 a.P().coins=10;a.$("#btn-skip").click();await sleep(30);ok(a.$("#dlg-title").textContent==="Not enough coins","not enough coins: explains instead of charging");a.dlg(0);await sleep(30);a.w.openGame("practice");await sleep(50);
 ok(a.P().coins===10,"no charge when short on coins");
 // persistence
 const keep={wb_player:a.w.localStorage.getItem("wb_player")};
 let b=boot(keep);await sleep(300);b.w.openGame("practice",true);ok(b.P().skips.free===0&&b.skipLabel()==="30 🪙","skip count survives a reload");
 const old=JSON.parse(keep.wb_player);delete old.skips;let c=boot({wb_player:old});await sleep(300);c.w.openGame("practice",true);ok(c.skipLabel()==="3 free","older saves without skips get the 3 free default");
 // daily: skip not allowed
 let d1=boot();await sleep(300);d1.w.openGame("daily");await sleep(50);d1.$("#btn-skip").click();await sleep(30);
 ok(!d1.dlgOpen()&&d1.msg().includes("Daily Challenge")&&d1.P().skips.free===3&&d1.$("#btn-skip").classList.contains("off"),"Daily Challenge: skip unavailable, nothing charged");
 // ---- info popup ----
 let e=boot();await sleep(300);e.w.openGame("practice",true);await sleep(50);e.type("cra");
 e.$("#g-info").click();ok(!e.$("#info").classList.contains("hidden")&&e.d.body.classList.contains("modal-open")&&e.d.activeElement===e.$("#info-ok"),"info icon opens How to Play, focus on Got it!");
 await sleep(2000);ok(e.$("#ix1").children[0].classList.contains("correct")&&e.$("#ix2").children[1].classList.contains("present")&&e.$("#ix3").children[3].classList.contains("absent"),"info popup animates green / yellow / grey examples");
 e.d.dispatchEvent(new e.w.KeyboardEvent("keydown",{key:"x"}));ok(e.ev("current")==="cra","typing is paused while the popup is open");
 e.$("#info-close").click();ok(e.$("#info").classList.contains("hidden")&&e.ev("current")==="cra"&&!e.d.body.classList.contains("modal-open"),"close button works; game untouched");
 e.$("#g-info").click();e.$("#info-ok").click();ok(e.$("#info").classList.contains("hidden"),"Got it! closes");
 e.$("#g-info").click();e.d.dispatchEvent(new e.w.KeyboardEvent("keydown",{key:"Escape"}));ok(e.$("#info").classList.contains("hidden"),"Escape closes");
 ok(a.errs.length+e.errs.length===0,"no JS errors "+a.errs.concat(e.errs).join());
 console.log(fails?"FAILED "+fails:"GAME SCREEN ALL PASS");process.exit(0);
})();
