const fs=require("fs");const root="/home/claude/wordle-battle/";const css=fs.readFileSync(root+"css/style.css","utf8");
let fails=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails++;};
const tok=(block)=>Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map(m=>[m[1],m[2].length===4?"#"+[...m[2].slice(1)].map(c=>c+c).join(""):m[2]]));
const dark=tok(css.match(/:root\{[\s\S]*?\n\}/)[0]),light=tok(css.match(/\[data-theme=light\]\{[\s\S]*?\n\}/)[0]);
const lum=h=>{const c=[1,3,5].map(i=>parseInt(h.substr(i,2),16)/255).map(v=>v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4));return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const cr=(a,b)=>{const[x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05)};
ok(dark.bg==="#1A1A1B"&&dark.panel==="#29292B"&&dark.gold==="#FACC15"&&dark["gold-dim"]==="#51482D"&&dark.text==="#FAFAF5","exact brand colours defined as tokens");
const pairs=(t,n,L)=>[["text on bg",t.text,t.bg],["text on panel",t.text,t.panel],["muted text on panel",t.muted,t.panel],["muted/placeholder on input",t.muted,t["panel-2"]],["button text on gold",t["on-color"],t.gold],["gold text on panel",t.gold,t.panel],["gold text on bg",t.gold,t.bg],["error text on panel",t.danger,t.panel],["error button text",t["on-danger"],t.danger],["text on gold-dim",t.text,t["gold-dim"]&&n==="dark"?t["gold-dim"]:t.panel],["correct tile text",t["on-fb"],t.correct],["misplaced tile text",t["on-fb"],t.present],["absent tile text",t["on-absent"],t.absent]];
for(const [n,t] of [["dark",dark],["light",light]])for(const [m,f,b] of pairs(t,n)){const r=cr(f,b);ok(r>=4.5,`${n}: ${m} contrast ${r.toFixed(1)}:1`);}
const ui=[["gold border vs bg",dark.gold,dark.bg],["input/tile border vs panel",dark.line,dark.panel]];
for(const [m,f,b] of ui){const r=cr(f,b);console.log(`INFO ${m}: ${r.toFixed(1)}:1`);}
const old=["#0b0a14","#16142a","#eef0ff","#8d8ab0","#a65bff","#0a1024","#121a38","#19224a","#2a3566","#8f9bc4","#35325a","#1d1b34","#3a3855","#7b2fe0","#f3f1fb","#2b4cff","#39ff88"];
const files=["css/style.css","index.html","manifest.webmanifest","icons/favicon.svg","js/app.js","js/auth.js","js/pwa.js","terms.html","privacy.html"];
const hits=[];for(const f of files){const t=fs.readFileSync(root+f,"utf8").toLowerCase();for(const o of old){if(t.includes(o)){hits.push(f+" "+o)}}}
console.log("old-palette hits (only the unchanged feedback green should remain):",hits.join(" | ")||"none");
ok(hits.every(h=>h.endsWith("#39ff88")&&h.startsWith("css/style.css")),"no old purple/navy colours left anywhere");
ok(!/var\(--(green|yellow|gray|purple)\)/.test(css),"no references to removed tokens");
const outside=css.replace(/:root\{[\s\S]*?\n\}/,"").replace(/\[data-theme=light\]\{[\s\S]*?\n\}/,"");
const hex=[...new Set((outside.match(/#[0-9a-fA-F]{3,6}\b/g)||[]).map(x=>x.toLowerCase()))];console.log("hard-coded hexes outside tokens:",hex.join(", "));
ok(hex.every(h=>["#fff","#1a1a1b","#4285f4","#000"].includes(h)),"only Google-button colours hard-coded outside the token block");
const js=fs.readFileSync(root+"js/app.js","utf8");ok(/FACC15/.test(js),"confetti uses gold palette");
console.log(fails?"FAILED "+fails:"THEME CHECKS PASS");
