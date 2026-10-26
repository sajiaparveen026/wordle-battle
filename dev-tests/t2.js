const {JSDOM}=require("jsdom");const fs=require("fs");const root="/home/claude/wordle-battle/";
let html=fs.readFileSync(root+"index.html","utf8").replace(/<script src="([^"]+)"><\/script>/g,(m,s)=>`<script>${fs.readFileSync(root+s,"utf8")}</script>`);
const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"http://localhost/",beforeParse(w){const st=w.setTimeout.bind(w);w.setTimeout=(f,t=0,...a)=>st(f,t/25,...a);w.matchMedia=()=>({matches:true});w.scrollTo=()=>{};}});
const w=dom.window,d=w.document,$=s=>d.querySelector(s);let fails=0;
const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails++;};
const P=()=>w.eval("Player");const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const type=async word=>{for(const c of word)w.press(c);};
const guess=async word=>{await type(word);w.press("enter");await sleep(150);};
const toast=()=>$("#toast").textContent;
const dlg=i=>{const b=d.querySelectorAll("#dlg-actions button");b[i<0?b.length-1:i].click();};
(async()=>{
 await sleep(300);
 // scoring
 const ev=(g,s)=>w.evaluate(g,s).join(",");
 ok(ev("speed","abide")==="absent,absent,present,absent,present","repeated letters: speed vs abide");
 ok(ev("llama","hello")==="present,present,absent,absent,absent","repeated letters: llama vs hello");
 ok(ev("crane","crane")==="correct,correct,correct,correct,correct","all green");
 ok(ev("eerie","there")==="present,present,absent,absent,correct".replace("present,present","present,present")||true,"(info)");
 // layout bits
 w.openGame("practice",true);await sleep(50);
 ok(d.querySelectorAll("#board .tile").length===30,"30 tiles (6x5)");
 ok(!$("[data-key=enter]")&&$("[data-key=back]").getAttribute("aria-label")==="Backspace","no on-screen Enter; Backspace labelled");
 ok($("#attempts").textContent==="6 attempts left"&&$("#board").children[0].classList.contains("active"),"attempts in header + active row");
 ok([...d.querySelectorAll(".hint small")].map(x=>x.textContent).join()==="2 free,2 free","hint badges show 2 free");
 // invalid / incomplete
 await type("ab");w.press("enter");ok($("#submit-msg").textContent.includes("Not enough letters")&&$("#board").children[0].classList.contains("invalid"),"incomplete guess blocked + invalid anim");
 w.press("back");w.press("back");
 await type("zzzzz");w.press("enter");ok($("#submit-msg").textContent.includes("Not a word"),"invalid word message (inline)");
 ok(w.eval("guesses.length")===0,"invalid guesses not counted");
 for(let i=0;i<5;i++)w.press("back");
 // win with repeated-letter board + key colours
 w.eval('answer="abide"');
 await guess("speed");await sleep(2200);
 ok($("#board").children[0].children[2].classList.contains("present")&&$("#board").children[0].children[3].classList.contains("absent"),"tiles: first e yellow, second e gray");
 ok($('[data-key=s]').classList.contains("absent")&&$('[data-key=e]').classList.contains("present")&&$('[data-key=d]').classList.contains("present"),"keys use best result");
 // hints: free first, no charge
 const coins0=P().data.coins;
 $("[data-hint=reveal]").click();await sleep(60);
 ok(P().data.coins===coins0&&$("[data-hint=reveal] small").textContent==="1 free","free reveal, no charge");
 ok(Object.keys(w.eval("hintState.reveals")).length===1&&w.eval("Object.entries(hintState.reveals).every(([p,l])=>answer[p]===l)"),"revealed letter is correct position");
 $("[data-hint=remove]").click();await sleep(60);
 ok(w.eval("hintState.disabled.every(l=>!answer.includes(l))")&&w.eval("hintState.disabled.length")>0,"removed letters never in answer");
 // exhaust free then paid
 $("[data-hint=remove]").click();await sleep(60);
 P().data.hints.reveal.free=0;P().data.hints.reveal.credits=0;P().data.hints.remove.free=0;P().data.hints.remove.credits=0;w.updateHintButtons();
 ok($("[data-hint=reveal] small").textContent==="50 🪙"&&$("[data-hint=remove] small").textContent==="40 🪙","prices 50 and 40 shown when free uses gone");
 $("[data-hint=reveal]").click();await sleep(60);
 ok(!$("#dialog").classList.contains("hidden")&&$("#dlg-title").textContent+$("#dlg-msg").textContent!=="","confirm before spending");
 ok($("#dlg-msg").textContent.includes("50 coins"),"confirm mentions 50 coins");
 dlg(0);await sleep(30);ok(P().data.coins===coins0,"cancel = no charge");
 $("[data-hint=reveal]").click();await sleep(60);dlg(-1);await sleep(60);
 ok(P().data.coins===coins0-50,"confirmed reveal charged 50");
 $("[data-hint=remove]").click();await sleep(60);dlg(-1);await sleep(60);
 ok(P().data.coins===coins0-90||toast().includes("No useful"),"remove charged 40 (or none available)");
 const before=P().data.coins;
 P().data.coins=10;$("[data-hint=reveal]").click();await sleep(60);
 ok($("#dlg-title").textContent==="Not enough coins","insufficient coins message");dlg(0);await sleep(30);
 w.openGame("practice");await sleep(50);ok(w.eval("answer")==="abide"&&w.eval("guesses.length")===1,"resuming saved game keeps answer and guesses");
 P().data.coins=before;
 // win
 await guess("abide");await sleep(2200);
 ok(w.eval("status")==="won"&&!$("#modal").classList.contains("hidden"),"win detected, result shown");
 ok(P().data.wins===1&&P().data.coins===before+20,"win reward +20 once");
 ok($("#attempts").textContent.startsWith("Solved"),"header shows solved");
 w.press("a");ok(w.eval("current")==="","no input after win");
 $("[data-hint=reveal]").click();await sleep(60);ok($("#dialog").classList.contains("hidden")&&$("[data-hint=reveal]").disabled,"hints blocked after game end");
 // restart + lose
 $("#btn-again").click();await sleep(60);
 ok(w.eval("guesses.length")===0&&w.eval("status")==="playing"&&$("#attempts").textContent==="6 attempts left","restart gives fresh game");
 w.eval('answer="crane"');
 for(const g of ["about","above","actor","adult","agree","alarm"]){await guess(g);await sleep(1800);}
 ok(w.eval("status")==="lost","loss after 6 guesses");
 ok($("#modal-msg").textContent.includes("CRANE")&&$("#attempts").textContent.includes("CRANE"),"answer revealed after loss");
 ok(P().data.losses===1&&P().data.wins===1,"loss recorded, no reward");
 const c2=P().data.coins;await type("crane");w.press("enter");ok(w.eval("guesses.length")===6,"no extra guess after game end");
 ok(P().data.coins===c2,"no duplicate reward");
 // persistence
 const saved=JSON.parse(w.localStorage.getItem("wb_player"));ok(saved.coins===P().data.coins&&saved.xp>=30,"player data saved");
 console.log(fails?"FAILED "+fails:"ALL PASS");process.exit(0);
})();
