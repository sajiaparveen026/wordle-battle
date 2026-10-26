const {JSDOM}=require("jsdom");const fs=require("fs");const root="/home/claude/wordle-battle/";
const base=fs.readFileSync(root+"index.html","utf8").replace(/<script src="([^"]+)"><\/script>/g,(m,s)=>`<script>${fs.readFileSync(root+s,"utf8")}</script>`);
const w=new JSDOM(base,{runScripts:"dangerously",pretendToBeVisual:true,url:"http://localhost/",beforeParse(w){w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};}}).window;
setTimeout(()=>{w.openGame("practice",true);w.eval('answer="crane"; status="won"; guesses=["crane"]; lastReward=Player.reward(gameId,"practice",1); showResult()');
 console.log("confetti pieces right after win:",w.document.querySelectorAll(".confetti").length);process.exit(0)},2000);
