const chromium=require("@sparticuz/chromium").default||require("@sparticuz/chromium");const pup=require("puppeteer-core");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const b=await pup.launch({executablePath:await chromium.executablePath(),args:[...chromium.args,"--no-sandbox"],headless:"shell"});
const p=await b.newPage();await p.setViewport({width:390,height:800,deviceScaleFactor:2,isMobile:true,hasTouch:true});
await p.evaluateOnNewDocument(()=>{localStorage.setItem("wb_mode","guest");localStorage.setItem("wb_tutorial","1")});
await p.goto("http://localhost:8765/",{waitUntil:"networkidle0"});await sleep(2100);await p.evaluate(()=>{openGame("practice",true);answer="crane"});await sleep(400);
const key=async(k)=>{await p.evaluate((k)=>document.querySelector(`[data-key=${k}]`).click(),k)};
const word=async(w)=>{for(const c of w)await key(c)};
// 1 valid guesses with feedback
await word("trail");await p.click("#btn-submit");await sleep(1900);await word("crape");await p.click("#btn-submit");await sleep(1900);
// 2 invalid word
await word("zzzzz");await p.click("#btn-submit");await sleep(500);
const msg=await p.evaluate(()=>[document.querySelector("#submit-msg").textContent,document.querySelectorAll("#board .row")[2].children[0].textContent+"…",guesses.length]);console.log("after invalid:",JSON.stringify(msg));
await p.screenshot({path:"/tmp/shots/scene-invalid.png"});
// 3 info popup
await p.evaluate(()=>{for(let i=0;i<5;i++)press("back")});await p.click("#g-info");await sleep(2600);await p.screenshot({path:"/tmp/shots/scene-info.png"});await p.click("#info-ok");
// 4 skip dialog
await p.click("#btn-skip");await sleep(400);await p.screenshot({path:"/tmp/shots/scene-skip.png"});
await b.close();})();
