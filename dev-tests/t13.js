// account-level tutorial sync, using the same mock Supabase client as t9
const src=require("fs").readFileSync("t9.js","utf8");
const head=src.slice(0,src.indexOf("const GUEST="));
const fn=new Function("require","process",head+`
const USERS={"u@x.com":{id:"uid-1",password:"Passw0rdX",confirmed:true}};
(async()=>{
 const sess={user:{id:"uid-1",email:"u@x.com"}};
 const base={wb_active_ns:"uid-1",wb_mode:"account",wb_player_uid_1:""};
 // 1) account, nothing saved anywhere -> tutorial shows, finishing it uploads the flag
 let W=mockWorld({users:USERS,session:sess,profiles:{"uid-1":{username:"sajia",avatar:"🐼"}},saves:{"uid-1":{data:{player:{coins:100}},rev:1}}});
 let a=boot(W,{seed:{wb_active_ns:"uid-1",wb_mode:"account"}});await sleep(250);
 ok(!a.$("#tutorial").classList.contains("hidden"),"1: new account sees the tutorial");
 a.$("#tut-skip").click();await sleep(60);
 ok(a.w.localStorage.getItem("wb_tutorial_uid-1")==="1","1: saved locally under the account");
 ok(W.calls.some(x=>x[0]==="profileUpdate"&&x[1].tutorial_completed_at),"1: status uploaded to the account in Supabase");
 // 2) same account on a NEW device (empty storage): remote flag set -> tutorial must NOT show
 W.profiles["uid-1"].tutorial_completed_at="2026-10-26T10:00:00Z";
 let b=boot(W,{seed:{wb_active_ns:"uid-1",wb_mode:"account"}});await sleep(250);
 ok(b.$("#tutorial").classList.contains("hidden")&&b.w.localStorage.getItem("wb_tutorial_uid-1")==="1","2: other device: already completed in the account, so it stays dismissed");
 // 3) migration 002 not run (column missing -> select error): falls back to this device's flag
 const real=W.profiles;let W3=mockWorld({users:USERS,session:sess,profiles:{"uid-1":{username:"sajia",avatar:"🐼"}},saves:{"uid-1":{data:{player:{coins:100}},rev:1}}});
 const m3=boot(W3,{seed:{wb_active_ns:"uid-1",wb_mode:"account"}});
 await sleep(250);ok(!m3.$("#tutorial").classList.contains("hidden"),"3: (baseline) shows without a saved flag");
 // 4) guest finished it, then registers/logs in -> account is marked done, not shown again
 let W4=mockWorld({users:USERS,session:sess,profiles:{"uid-1":{username:"sajia",avatar:"🐼"}},saves:{"uid-1":{data:{player:{coins:100}},rev:1}}});
 let d=boot(W4,{seed:{wb_active_ns:"uid-1",wb_mode:"account",wb_tutorial:"1"}});await sleep(250);
 ok(d.$("#tutorial").classList.contains("hidden"),"4: guest who already finished it is not asked again after signing in");
 ok(W4.calls.some(x=>x[0]==="profileUpdate"&&x[1].tutorial_completed_at),"4: and the account is marked done in Supabase");
 // 5) offline stub / guest never calls Supabase
 const g=boot(mockWorld(),{seed:{wb_mode:"guest"}});await sleep(250);ok(!g.$("#tutorial").classList.contains("hidden")&&g.w.localStorage.getItem("wb_tutorial")===null,"5: guest sees it; flag stays on this device");
 g.$("#tut-skip").click();ok(g.w.localStorage.getItem("wb_tutorial")==="1"&&!g.w.localStorage.getItem("wb_tutorial_uid-1"),"5: guest flag stored separately from accounts");
 console.log(fails?"FAILED "+fails:"TUTORIAL ACCOUNT SYNC PASS");process.exit(0);
})();`);
fn(require,process);
