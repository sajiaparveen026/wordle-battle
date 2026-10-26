const chromium=require("@sparticuz/chromium").default||require("@sparticuz/chromium");const pup=require("puppeteer-core");
const VIEWS=[["se-320x568",320,568,2],["android-360x640",360,640,2],["android-360x740",360,740,2],["iphone-390x844",390,844,3],["pixel-412x915",412,915,2.6],["tablet-768x1024",768,1024,2],["laptop-1280x720",1280,720,1],["desktop-1920x1080",1920,1080,1],["landscape-740x360",740,360,2]];
(async()=>{const exe=await chromium.executablePath();const b=await pup.launch({executablePath:exe,args:[...chromium.args,"--no-sandbox"],headless:"shell"});let bad=0;
for(const [name,w,h,dpr] of VIEWS){
 const p=await b.newPage();await p.setViewport({width:w,height:h,deviceScaleFactor:dpr,isMobile:w<700,hasTouch:w<700});
 await p.evaluateOnNewDocument(()=>{localStorage.setItem("wb_mode","guest");localStorage.setItem("wb_tutorial","1");});
 await p.goto("http://localhost:8765/",{waitUntil:"networkidle0"});await new Promise(r=>setTimeout(r,2100));
 await p.evaluate(()=>openGame("practice",true));await new Promise(r=>setTimeout(r,500));
 const m=await p.evaluate(()=>{const r=(s)=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return{l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height}};
  const tiles=[...document.querySelectorAll("#board .tile")].map(t=>t.getBoundingClientRect());const t0=tiles[0];
  return{vw:innerWidth,vh:innerHeight,docW:document.documentElement.scrollWidth,docH:document.documentElement.scrollHeight,gameScroll:document.querySelector("#game").scrollHeight-document.querySelector("#game").clientHeight,
   top:r(".gtop"),back:r("#g-back"),win:r(".winscore"),info:r("#g-info"),coins:r("#game .coins"),board:r("#board"),kb:r("#keyboard"),msg:r("#submit-msg"),ctl:r(".controls"),h1:r("[data-hint=reveal]"),h2:r("[data-hint=remove]"),submit:r("#btn-submit"),skip:r("#btn-skip"),
   tile:{w:t0.width,h:t0.height},lastTileBottom:Math.max(...tiles.map(t=>t.bottom)),keys:[...document.querySelectorAll("#keyboard .key")].map(k=>{const b=k.getBoundingClientRect();return{w:b.width,h:b.height,r:b.right,l:b.left}}),
   enterKey:!!document.querySelector("[data-key=enter]"),streakInGame:!!document.querySelector("#game .streak"),attemptsVisible:getComputedStyle(document.querySelector("#attempts")).position!=="absolute"};});
 const errs=[];const chk=(c,msg)=>{if(!c){errs.push(msg)}};
 chk(m.docW<=m.vw+1,"horizontal overflow "+m.docW+">"+m.vw);chk(m.docH<=m.vh+1,"page taller than screen "+m.docH+">"+m.vh);chk(m.gameScroll<=1,"game content clipped by "+m.gameScroll);
 chk(m.top.b<=m.board.t+1,"top bar overlaps board");const land=w>h&&h<=520;if(land){chk(m.board.r<=m.kb.l+1,"board overlaps keyboard (side by side)");chk(m.kb.b<=m.msg.t+1&&m.msg.b<=m.ctl.t+1,"right column overlaps");}else{chk(m.board.b<=m.kb.t+1,"board overlaps keyboard "+m.board.b+" vs "+m.kb.t);chk(m.kb.b<=m.msg.t+1,"keyboard overlaps message");chk(m.msg.b<=m.ctl.t+1,"message overlaps controls");}
 chk(m.ctl.b<=m.vh+1,"controls below screen "+m.ctl.b+">"+m.vh);chk(m.board.l>=-0.5&&m.board.r<=m.vw+0.5,"board outside screen");
 chk(Math.abs(m.tile.w-m.tile.h)<1.5,"tiles not square "+m.tile.w.toFixed(1)+"x"+m.tile.h.toFixed(1));
 chk(m.h2.r<=m.submit.l+0.5&&m.submit.r<=m.skip.l+0.5,"controls overlap each other");chk(!land?Math.abs((m.submit.l+m.submit.r)/2-m.vw/2)<2:true,"submit not centred");chk(m.skip.r<=m.vw+0.5&&m.h1.l>=-0.5,"controls outside screen");
 chk(m.keys.every(k=>k.l>=-0.5&&k.r<=m.vw+0.5&&k.w>=24&&k.h>=36),"keys too small or off-screen (min "+Math.min(...m.keys.map(k=>k.w)).toFixed(0)+"x"+Math.min(...m.keys.map(k=>k.h)).toFixed(0)+")");
 chk(m.back.w>=40&&m.info.w>=40&&m.submit.h>=44&&m.skip.h>=44,"tap targets too small");chk(m.back.r<=m.win.l+0.5&&m.info.r<=m.coins.l+0.5&&m.win.r<=m.info.l+0.5,"top bar items overlap");
 chk(!m.enterKey,"Enter key still on keyboard");chk(!m.streakInGame,"streak still in game");chk(!m.attemptsVisible,"attempts counter visible");
 const cx=(m.submit.l+m.submit.r)/2,off=Math.abs(cx-m.vw/2);
 console.log(`${errs.length?"FAIL":"PASS"} ${name}: board ${m.board.w.toFixed(0)}x${m.board.h.toFixed(0)}, tile ${m.tile.w.toFixed(0)}px, key ${m.keys[0].w.toFixed(0)}x${m.keys[0].h.toFixed(0)}, submit ${m.submit.w.toFixed(0)}px (${off.toFixed(0)}px off-centre), free space under controls ${(m.vh-m.ctl.b).toFixed(0)}px`+(errs.length?"\n   - "+errs.join("\n   - "):""));if(errs.length)bad++;
 await p.screenshot({path:`/tmp/shots/${name}.png`});await p.close();}
await b.close();console.log(bad?"LAYOUT FAILURES: "+bad:"LAYOUT ALL PASS");})();
