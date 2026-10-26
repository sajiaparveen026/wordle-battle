const chromium=require("@sparticuz/chromium").default||require("@sparticuz/chromium");const pup=require("puppeteer-core");const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const AUDIT=()=>{
 const parse=(c)=>{const m=c.match(/rgba?\(([^)]+)\)/);if(!m)return[0,0,0,0];const p=m[1].split(/[ ,\/]+/).map(Number);return[p[0],p[1],p[2],p.length>3?p[3]:1]};
 const blend=(f,b)=>{const a=f[3];return[f[0]*a+b[0]*(1-a),f[1]*a+b[1]*(1-a),f[2]*a+b[2]*(1-a),1]};
 const lum=(c)=>{const v=c.slice(0,3).map(x=>{x/=255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)});return .2126*v[0]+.7152*v[1]+.0722*v[2]};
 const bgOf=(el)=>{const chain=[];for(let e=el;e;e=e.parentElement){const c=parse(getComputedStyle(e).backgroundColor);chain.push(c);if(c[3]===1)break}
   let base=[26,26,27,1];if(getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()){base=parse("rgb("+hex(getComputedStyle(document.documentElement).getPropertyValue("--bg").trim())+")")}
   let col=base;for(let i=chain.length-1;i>=0;i--)col=blend(chain[i],col);return col};
 const hex=(h)=>{h=h.replace("#","");if(h.length===3)h=[...h].map(x=>x+x).join("");return [0,2,4].map(i=>parseInt(h.substr(i,2),16)).join(",")};
 const out=[];const seen=new Set();
 for(const el of document.querySelectorAll("body *")){
  if(["SCRIPT","STYLE","svg","path","circle"].includes(el.tagName))continue;
  const own=[...el.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim()).map(n=>n.textContent.trim()).join(" ");if(!own)continue;
  const r=el.getBoundingClientRect();if(r.width<2||r.height<2)continue;const cs=getComputedStyle(el);if(cs.visibility==="hidden"||cs.display==="none"||+cs.opacity===0)continue;
  let hidden=false;for(let e=el;e;e=e.parentElement){const s=getComputedStyle(e);if(s.display==="none"||s.visibility==="hidden"){hidden=true;break}}if(hidden)continue;
  if(cs.position==="absolute"&&cs.clip&&cs.clip!=="auto")continue;
  let op=1;for(let e=el;e;e=e.parentElement)op*=+getComputedStyle(e).opacity;if(op<0.05)continue;
  const fg=blend(parse(cs.color),bgOf(el));const bg=bgOf(el);const l1=lum(fg),l2=lum(bg);const ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
  const size=parseFloat(cs.fontSize),bold=parseInt(cs.fontWeight)>=700,large=size>=24||(size>=18.66&&bold);
  const need=large?3:4.5;
  const key=(el.id?"#"+el.id:el.tagName.toLowerCase()+"."+[...el.classList].join("."))+"|"+own.slice(0,24);
  if(ratio<need*(op<1?1:1)&&!seen.has(key)){seen.add(key);out.push(`${ratio.toFixed(1)}:1 (need ${need}) ${key} fg=${cs.color} on ${bg.slice(0,3).map(Math.round)}`)}
 }return out};
(async()=>{const b=await pup.launch({executablePath:await chromium.executablePath(),args:[...chromium.args,"--no-sandbox"],headless:"shell"});let total=0;
for(const theme of ["dark","light"]){
 const p=await b.newPage();await p.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
 await p.evaluateOnNewDocument(()=>{localStorage.setItem("wb_mode","guest");localStorage.setItem("wb_tutorial","1")});
 await p.goto("http://localhost:8765/",{waitUntil:"networkidle0"});await sleep(2100);
 await p.evaluate((t)=>{document.documentElement.dataset.theme=t},theme);
 const screens=["welcome","signup","login","forgot","reset","verify","dashboard","shop","battle","leaderboard","settings"];
 const results={};
 for(const s of screens){await p.evaluate((s)=>{WBApp.show(s)},s);await sleep(450);
  if(s==="signup")await p.evaluate(()=>{const m=document.querySelector("#su-msg");m.textContent="Password needs: a number.";m.className="authmsg error"});
  if(s==="login")await p.evaluate(()=>{const m=document.querySelector("#li-notice");m.textContent="Password updated. Please log in.";m.className="authmsg ok";document.querySelector("#li-msg").textContent="Incorrect email or password.";document.querySelector("#li-msg").className="authmsg error"});
  if(s==="dashboard")await p.evaluate(()=>{document.querySelector("#update-bar").classList.remove("hidden");document.querySelector("#offline-bar").classList.remove("hidden");document.querySelector(".installbar").classList.remove("hidden")});
  results[s]=await p.evaluate(AUDIT);if(s==="dashboard")await p.evaluate(()=>{document.querySelector("#update-bar").classList.add("hidden");document.querySelector("#offline-bar").classList.add("hidden")});}
 // game with colours + hints state
 await p.evaluate(()=>{openGame("practice",true);answer="crane"});await sleep(400);
 for(const w of ["trail","crape"]){await p.evaluate((w)=>{for(const c of w)press(c);press("enter")},w);await sleep(1900)}
 await p.evaluate(()=>{for(const c of "zzzzz")press(c);press("enter")});await sleep(200);results.game=await p.evaluate(AUDIT);
 await p.evaluate(()=>{toast("Letter 3 is A","success");toast("Not enough coins","error")});results.toasts=await p.evaluate(AUDIT);
 await p.evaluate(()=>{Tutorial.openInfo()});await sleep(1500);results.info=await p.evaluate(AUDIT);await p.evaluate(()=>document.querySelector("#info-ok").click());
 await p.evaluate(()=>{Tutorial.open()});await sleep(300);results["tutorial1"]=await p.evaluate(AUDIT);for(let i=1;i<5;i++){await p.evaluate(()=>document.querySelector("#tut-next").click());await sleep(2600);results["tutorial"+(i+1)]=await p.evaluate(AUDIT)}await p.evaluate(()=>document.querySelector("#tut-skip")?.click()||document.querySelector("#tut-go").click());await sleep(200);
 await p.evaluate(()=>{WBApp.show("dashboard");dialog("Use a hint","Use 50 coins to reveal a letter?",["Cancel","Use"])});results.dialog=await p.evaluate(AUDIT);await p.evaluate(()=>document.querySelector("#dlg-actions button").click());
 await p.evaluate(()=>{showDailyDone({won:true,guesses:["trail","crape","crane"],answer:"crane",reward:{coins:50,xp:60},score:400})});await sleep(600);results.dailyDone=await p.evaluate(AUDIT);await p.evaluate(()=>document.querySelector("#dd-ok").click());
 await p.evaluate(()=>{openGame("practice",true);answer="crane"});await sleep(300);await p.evaluate(()=>{for(const c of "crane")press(c);press("enter")});await sleep(2700);results.resultModal=await p.evaluate(AUDIT);
 for(const [k,v] of Object.entries(results)){if(v.length){console.log(`[${theme}] ${k}:`);v.forEach(x=>console.log("   "+x));total+=v.length}}
 await p.close();}
console.log(total?"CONTRAST ISSUES: "+total:"CONTRAST AUDIT CLEAN (both themes, all screens/popups)");await b.close();})();
