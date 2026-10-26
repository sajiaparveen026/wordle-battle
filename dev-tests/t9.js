const {JSDOM,VirtualConsole}=require("jsdom");const fs=require("fs");const root="/home/claude/wordle-battle/";
let fails=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails++;};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const CFG_ON='window.CONFIG={SUPABASE_URL:"https://x.supabase.co",SUPABASE_ANON_KEY:"anon-key"};window.DEMO_MODE=false;';
function mockWorld(o={}){return Object.assign({users:{},session:null,profiles:{},saves:{},google:false,calls:[],net:false,confirmations:true},o);}
function makeMock(W){
 const ls=[];const fire=(e,s)=>ls.forEach(cb=>cb(e,s));W.fire=fire;
 const err=(o)=>({data:{},error:o});
 const auth={
  async signUp(a){W.calls.push(["signUp",a]);if(W.signupError)return err(W.signupError);
   if(W.confirmations===false){const id="uid-"+a.email;W.users[a.email]={id,password:a.password,confirmed:true};W.profiles[id]={username:a.options.data.username,avatar:"🦊"};W.session={user:{id,email:a.email}};return{data:{user:W.session.user,session:W.session},error:null};}
   const ex=W.users[a.email];if(!ex){const id="uid-"+a.email;W.users[a.email]={id,password:a.password,confirmed:false};W.profiles[id]={username:a.options.data.username,avatar:"🦊"};}
   return{data:{user:{identities:ex?[]:[{}]},session:null},error:null};},
  async signInWithPassword({email,password}){W.calls.push(["signIn",email]);if(W.net)return err({name:"AuthRetryableFetchError",message:"fetch failed"});
   const u=W.users[email];if(!u||u.password!==password)return err({status:400,code:"invalid_credentials",message:"Invalid login credentials"});
   if(!u.confirmed)return err({status:400,code:"email_not_confirmed",message:"Email not confirmed"});
   W.session={user:{id:u.id,email}};return{data:{session:W.session},error:null};},
  async getSession(){return{data:{session:W.session}}},
  onAuthStateChange(cb){ls.push(cb);return{data:{subscription:{unsubscribe(){}}}}},
  async resend(a){W.calls.push(["resend",a]);return{error:W.resendError||null}},
  async resetPasswordForEmail(email,o){W.calls.push(["reset",email,o]);return{error:null}},
  async updateUser(a){W.calls.push(["updateUser",!!a.password]);return{error:W.updateError||null}},
  async signOut(o){W.calls.push(["signOut",o&&o.scope]);W.session=null;return{error:null}},
  async signInWithOAuth(a){W.calls.push(["oauth",a.provider,a.options.redirectTo]);return{error:null}}
 };
 const from=(table)=>{const q={table,f:{},op:"select",ret:false};
  const run=()=>{const res=(data,error=null)=>({data,error});
   if(table==="profiles"){const id=q.f.id;if(q.op==="select")return res(W.profiles[id]?{...W.profiles[id]}:null);
    if(q.op==="update"){const taken=Object.entries(W.profiles).some(([k,p])=>k!==id&&q.payload.username&&p.username.toLowerCase()===q.payload.username.toLowerCase());if(taken)return res(null,{code:"23505"});Object.assign(W.profiles[id],q.payload);W.calls.push(["profileUpdate",q.payload]);return res(null);}}
   if(table==="solo_saves"){const id=q.f.user_id,row=W.saves[id];
    if(q.op==="select")return res(row?{data:row.data,rev:row.rev}:null);
    if(q.op==="insert"){if(row)return res(null,{code:"23505"});W.saves[q.payload.user_id]={data:q.payload.data,rev:1};W.calls.push(["saveInsert",q.payload]);return res({rev:1});}
    if(q.op==="update"){if(!row||(q.f.rev!==undefined&&row.rev!==q.f.rev)){W.calls.push(["saveConflict"]);return res([]);}row.data=q.payload.data;row.rev++;W.calls.push(["saveUpdate",q.f.rev]);return res([{rev:row.rev}]);}}
   return res(null);};
  const api={select(){q.ret=true;return api},insert(p){q.op="insert";q.payload=p;return api},update(p){q.op="update";q.payload=p;return api},eq(c,v){q.f[c]=v;return api},
   async maybeSingle(){const r=run();return r},then(res,rej){const r=run();if(q.op==="update"&&q.table==="solo_saves")return Promise.resolve(r).then(res,rej);return Promise.resolve(r).then(res,rej)}};
  return api;};
 return{auth,from,async rpc(name,a){W.calls.push(["rpc",name]);if(name==="username_available")return{data:!Object.values(W.profiles).some(p=>p.username.toLowerCase()===a.p_username.toLowerCase()),error:null};return{data:null,error:null}}};
}
function boot(W,{seed={},sess={},cfg=true,url="http://localhost/",google}={}){
 const st={reloads:0};const vc=new VirtualConsole();vc.on("jsdomError",e=>{if(/navigation/.test(e.message))st.reloads++});
 let html=fs.readFileSync(root+"index.html","utf8").replace(/<script src="([^"]+)"><\/script>/g,(m,s)=>{
  if(s==="js/vendor/supabase.js")return"<script>window.supabase={createClient:()=>window.__mock}</script>";
  if(s==="js/config.js")return`<script>${cfg?CFG_ON:'window.CONFIG={SUPABASE_URL:"",SUPABASE_ANON_KEY:""};window.DEMO_MODE=true;'}</script>`;
  return`<script>${fs.readFileSync(root+s,"utf8")}</script>`;});
 const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url,virtualConsole:vc,beforeParse(w){
  const t=w.setTimeout.bind(w);w.setTimeout=(f,ms=0,...a)=>t(f,ms/25,...a);w.matchMedia=()=>({matches:false});w.scrollTo=()=>{};
  w.fetch=async()=>({json:async()=>({external:{google:google??W.google}})});
  for(const [k,v] of Object.entries(seed))w.localStorage.setItem(k,v);for(const [k,v] of Object.entries(sess))w.sessionStorage.setItem(k,v);
  w.__mock=makeMock(W);}});
 const w=dom.window,d=w.document,$=s=>d.querySelector(s);
 return{w,d,$,st,vis:id=>!$("#"+id).classList.contains("hidden"),
  carry(){const s={},e={};for(let i=0;i<w.localStorage.length;i++){const k=w.localStorage.key(i);s[k]=w.localStorage.getItem(k)}for(let i=0;i<w.sessionStorage.length;i++){const k=w.sessionStorage.key(i);e[k]=w.sessionStorage.getItem(k)}return{seed:s,sess:e}},
  type(id,v){$("#"+id).value=v},submit(f){$("#"+f).dispatchEvent(new w.Event("submit",{cancelable:true,bubbles:true}))},
  dlg(i){const b=d.querySelectorAll("#dlg-actions button");b[i<0?b.length-1:i].click()}};
}
const same=(a,b)=>{const x=JSON.parse(a),y=JSON.parse(b);delete x.skips;delete y.skips;return JSON.stringify(x)===JSON.stringify(y)};
const GUEST={wb_player:JSON.stringify({username:"GuestG",avatar:"🐼",coins:250,xp:70,wins:2,losses:1,hints:{reveal:{free:1,credits:0},remove:{free:2,credits:0}},rewarded:["W:a","W:b","L:c"],recent:["W","L","W"],dist:[0,1,1,0,0,0],streak:1,bestStreak:2,bestGuesses:2}),wb_stats:JSON.stringify({played:1,wins:1,streak:1,best:1,dist:[0,1,0,0,0,0],lastDaily:"2026-10-24"}),wb_game_practice:JSON.stringify({status:"won"})};
(async()=>{
 // ===== A. not configured =====
 let W=mockWorld(),a=boot(W,{cfg:false});await sleep(150);
 ok(a.vis("welcome")&&a.$("#welcome-setup")&&!a.$("#welcome-setup").classList.contains("hidden"),"A: unconfigured -> welcome with setup note");
 ok(a.$("[data-go=signup]").classList.contains("hidden")&&a.$("[data-go=login]").classList.contains("hidden")&&a.$("[data-google]").classList.contains("hidden"),"A: no fake Create/Login/Google buttons when not configured");
 a.$("#btn-guest").click();ok(a.vis("dashboard")&&a.$("#d-acct").textContent==="Guest","A: Play as Guest -> dashboard labelled Guest");
 ok(a.w.localStorage.getItem("wb_mode")==="guest","A: guest flag saved");
 // ===== B. legacy player =====
 W=mockWorld();let b=boot(W,{seed:GUEST});await sleep(150);
 ok(b.vis("dashboard")&&b.$("#d-name").textContent==="GuestG"&&b.$(".coin-val").textContent==="250","B: existing player skips welcome, progress intact (coins 250)");
 b.w.show("settings");ok(b.$("#acct").textContent.includes("Create account")&&!b.$("#s-reset").classList.contains("hidden"),"B: profile offers Create account; guest keeps reset");
 // ===== C. new visitor, configured =====
 W=mockWorld({google:false});let c=boot(W);await sleep(150);
 ok(c.vis("welcome")&&!c.$("[data-go=signup]").classList.contains("hidden"),"C: configured -> welcome with Create/Login");
 ok(c.$("[data-google]").classList.contains("hidden"),"C: Google hidden when provider not enabled");
 W=mockWorld({google:true});let c2=boot(W);await sleep(150);ok(!c2.$("[data-google]").classList.contains("hidden"),"C: Google shown only when Supabase reports it enabled");
 c2.$("[data-google]").click();await sleep(30);ok(W.calls.some(x=>x[0]==="oauth"&&x[1]==="google"&&x[2]==="http://localhost/"),"C: Google uses signInWithOAuth with allow-listed redirect");
 // ===== D. signup =====
 W=mockWorld({profiles:{taken:{username:"TakenName",avatar:"🦊"}}});let d1=boot(W);await sleep(150);d1.w.show("signup");
 const t=(e,u,p,p2)=>{d1.type("su-email",e);d1.type("su-user",u);d1.type("su-pass",p);d1.type("su-pass2",p2);d1.$("#su-terms").checked=true;d1.submit("signup-form")};
 t("bad","Sam_1","Passw0rdX","Passw0rdX");ok(d1.$("#su-msg").textContent.includes("valid email"),"D: malformed email rejected");
 t("a@b.com","x!","Passw0rdX","Passw0rdX");ok(d1.$("#su-msg").textContent.includes("Username"),"D: bad username rejected");
 t("a@b.com","Sam_1","short","short");ok(d1.$("#su-msg").textContent.includes("Password needs"),"D: weak password rejected");
 d1.type("su-email","a@b.com");d1.type("su-user","Sam_1");d1.type("su-pass","Passw0rdX");d1.type("su-pass2","Passw0rdX");d1.$("#su-terms").checked=false;d1.submit("signup-form");ok(d1.$("#su-msg").textContent.includes("Terms")&&!W.calls.some(x=>x[0]==="signUp"),"D: Terms checkbox required");
 t("a@b.com","Sam_1","Passw0rdX","Passw0rdY");ok(d1.$("#su-msg").textContent.includes("don't match"),"D: mismatch rejected");
 ok(!W.calls.some(x=>x[0]==="signUp"),"D: nothing sent to Supabase for invalid input");
 d1.$("#su-pass").value="abc";d1.$("#su-pass").dispatchEvent(new d1.w.Event("input"));const w1=d1.$("#su-meter").style.width;d1.$("#su-pass").value="Str0ng!Passw0rd";d1.$("#su-pass").dispatchEvent(new d1.w.Event("input"));ok(parseInt(d1.$("#su-meter").style.width)>parseInt(w1),"D: strength meter grows");
 d1.$("[data-eye=su-pass]").click();ok(d1.$("#su-pass").type==="text","D: show password toggle");
 t("a@b.com","takenname","Passw0rdX","Passw0rdX");await sleep(30);ok(d1.$("#su-msg").textContent.includes("taken")&&!W.calls.some(x=>x[0]==="signUp"),"D: duplicate username (case-insensitive) blocked");
 t("a@b.com","Sam_1","Passw0rdX","Passw0rdX");await sleep(50);
 const su=W.calls.find(x=>x[0]==="signUp");ok(su&&su[1].options.data.username==="Sam_1"&&su[1].options.emailRedirectTo==="http://localhost/","D: signUp sends username + redirect");
 ok(d1.vis("verify")&&d1.$("#vf-email").textContent==="a@b.com"&&d1.$("#vf-resend").disabled,"D: verification screen, resend rate-limited");
 const stored=JSON.stringify([...Array(d1.w.localStorage.length)].map((_,i)=>d1.w.localStorage.getItem(d1.w.localStorage.key(i))));ok(!stored.includes("Passw0rdX"),"D: password never written to storage");
 let d2=boot(W);await sleep(150);d2.w.show("signup");d2.type("su-email","a@b.com");d2.type("su-user","Other_2");d2.type("su-pass","Passw0rdX");d2.type("su-pass2","Passw0rdX");d2.$("#su-terms").checked=true;d2.submit("signup-form");await sleep(50);
 ok(d2.vis("verify"),"D: signing up with an EXISTING email shows the same verify screen (no account enumeration)");
 d2.$("#vf-resend").disabled=false;d2.$("#vf-resend").click();await sleep(30);ok(W.calls.some(x=>x[0]==="resend")&&d2.$("#vf-msg").textContent.includes("If that address"),"D: resend works with generic message");
 // ===== E. login =====
 W=mockWorld({users:{"u@x.com":{id:"uid-1",password:"Passw0rdX",confirmed:true},"nc@x.com":{id:"uid-2",password:"Passw0rdX",confirmed:false}},profiles:{"uid-1":{username:"sajia",avatar:"🐼"}}});
 let e=boot(W,{seed:GUEST});await sleep(150);e.w.show("login");
 const li=(m,p)=>{e.type("li-email",m);e.type("li-pass",p);e.submit("login-form")};
 li("u@x.com","wrong");await sleep(30);const m1=e.$("#li-msg").textContent;li("nobody@x.com","wrong");await sleep(30);ok(m1==="Incorrect email or password."&&e.$("#li-msg").textContent===m1,"E: wrong password and unknown email give the SAME message");
 li("nc@x.com","Passw0rdX");await sleep(30);ok(e.$("#li-msg").textContent.includes("verify your email"),"E: unverified email message");
 W.net=true;li("u@x.com","Passw0rdX");await sleep(30);ok(e.$("#li-msg").textContent.includes("Can't reach the server"),"E: network failure message");W.net=false;
 li("","");ok(e.$("#li-msg").textContent.includes("Enter your email"),"E: empty input blocked");
 li("u@x.com","Passw0rdX");await sleep(60);
 ok(e.w.localStorage.getItem("wb_active_ns")==="uid-1"&&e.st.reloads===1,"E: successful login switches to account storage and reloads once");
 ok(same(e.w.localStorage.getItem("wb_player"),GUEST.wb_player),"E: guest data untouched");
 // ===== F. after reload: first account login, guest migration =====
 let f=boot(W,{...e.carry()});await sleep(200);
 ok(f.vis("dashboard")&&f.$("#d-name").textContent==="sajia"&&f.$("#d-acct").classList.contains("hidden"),"F: dashboard shows account username, no Guest badge");
 ok(f.$("#dialog").classList.contains("hidden")===false&&f.$("#dlg-title").textContent.includes("guest progress"),"F: asks before moving guest progress");
 f.dlg(-1);await sleep(100);
 const ins=W.calls.find(x=>x[0]==="saveInsert");ok(ins&&ins[1].data.player.coins===250&&ins[1].data.player.rewarded.includes("W:a"),"F: guest progress uploaded once (incl. reward ids -> no duplicate rewards)");
 ok(f.w.localStorage.getItem("wb_guest_migrated")==="1"&&f.$(".coin-val").textContent==="250","F: migration flagged; coins 250 shown");
 ok(f.w.localStorage.getItem("wb_player_uid-1")&&same(f.w.localStorage.getItem("wb_player"),GUEST.wb_player),"F: account stored under its own key; guest key unchanged");
 f.w.show("settings");ok(f.$("#s-reset").classList.contains("hidden")&&f.$("#acct").textContent.includes("u@x.com")&&f.$("#btn-logout"),"F: profile shows email + Log out, no wipe button");
 // push on change
 f.w.eval("Player.data.coins=300;Player.save()");await sleep(120);ok(W.calls.some(x=>x[0]==="saveUpdate"&&x[1]===1)&&W.saves["uid-1"].data.player.coins===300,"F: changes sync to Supabase (rev check)");
 ok(JSON.stringify(W.saves["uid-1"].data.player.skips)==='{"free":3}',"F: skip count is part of the synced save");
 // conflict: other device saved first
 W.saves["uid-1"].rev=7;W.saves["uid-1"].data.player.coins=999;f.w.eval("Player.data.coins=310;Player.save()");await sleep(150);
 ok(f.w.eval("Player.data.coins")===999,"F: stale write rejected, newer cloud copy wins");
 // second device / new session: remote exists, no prompt
 const f2=boot(W,{...f.carry()});await sleep(200);ok(f2.$("#dialog").classList.contains("hidden")&&f2.$(".coin-val").textContent==="999","F: later login loads cloud progress, no migration prompt");
 // username change
 f2.w.show("settings");f2.type("s-name","Bad Name!");f2.$("#s-name").dispatchEvent(new f2.w.Event("change"));await sleep(30);ok(!W.calls.some(x=>x[0]==="profileUpdate"),"F: invalid username not sent");
 W.profiles["uid-9"]={username:"Rival",avatar:"🦊"};f2.type("s-name","rival");f2.$("#s-name").dispatchEvent(new f2.w.Event("change"));await sleep(40);ok(f2.$("#toast").textContent.includes("taken"),"F: taken username rejected by database constraint");
 f2.type("s-name","NewName");f2.$("#s-name").dispatchEvent(new f2.w.Event("change"));await sleep(40);ok(W.profiles["uid-1"].username==="NewName","F: username updated");
 // ===== G. logout =====
 f2.$("#btn-logout").click();await sleep(10);f2.dlg(-1);await sleep(80);
 ok(W.calls.some(x=>x[0]==="signOut")&&!f2.w.localStorage.getItem("wb_active_ns")&&f2.w.localStorage.getItem("wb_mode")==="none","G: logout signs out and leaves account mode");
 const g=boot(W,{...f2.carry()});await sleep(150);ok(g.vis("welcome")&&g.$("#welcome-notice").textContent.includes("logged out")&&same(g.w.localStorage.getItem("wb_player"),GUEST.wb_player),"G: back at welcome; guest data intact");
 g.$("#btn-guest").click();ok(g.$("#d-name").textContent==="GuestG"&&g.$(".coin-val").textContent==="250","G: guest progress restored after logout");
 // ===== H. expired session =====
 W.session=null;const h=boot(W,{seed:{...GUEST,wb_active_ns:"uid-1",wb_mode:"account"}});await sleep(150);ok(h.st.reloads===1&&h.w.sessionStorage.getItem("wb_notice").includes("expired"),"H: account data but no session -> clean exit with 'session expired' notice");
 // ===== I. password recovery =====
 W=mockWorld({users:{"u@x.com":{id:"uid-1",password:"Passw0rdX",confirmed:true}}});let i=boot(W);await sleep(150);i.w.show("forgot");
 i.type("fp-email","u@x.com");i.submit("forgot-form");await sleep(30);const r1=i.$("#fp-msg").textContent;
 const i2=boot(W);await sleep(150);i2.w.show("forgot");i2.type("fp-email","ghost@x.com");i2.submit("forgot-form");await sleep(30);
 ok(r1.includes("If an account exists")&&i2.$("#fp-msg").textContent===r1,"I: reset message identical for known and unknown emails");
 ok(W.calls.some(x=>x[0]==="reset"&&x[2].redirectTo==="http://localhost/"),"I: reset email uses allow-listed redirect");
 W.session={user:{id:"uid-1",email:"u@x.com"}};const rc=boot(W);rc.w.eval("1");W.fire("PASSWORD_RECOVERY",W.session);await sleep(150);
 ok(rc.vis("reset"),"I: recovery link opens the reset-password screen (not the dashboard)");
 rc.type("rp-pass","Newpassw0rd");rc.type("rp-pass2","Different1");rc.submit("reset-form");ok(rc.$("#rp-msg").textContent.includes("don't match")&&!W.calls.some(x=>x[0]==="updateUser"),"I: mismatch blocked");
 rc.type("rp-pass2","Newpassw0rd");rc.submit("reset-form");await sleep(60);
 ok(W.calls.some(x=>x[0]==="updateUser"&&x[1])&&W.calls.some(x=>x[0]==="signOut"&&x[1]==="local")&&rc.vis("login")&&rc.$("#li-notice").textContent.includes("Password updated"),"I: password updated, signed out, back to login with success message");
 ok(rc.w.localStorage.getItem("wb_active_ns")===null&&rc.st.reloads===0,"I: no account switch/reload during recovery");
 // ===== J. bad email link =====
 const j=boot(mockWorld(),{url:"http://localhost/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired"});await sleep(150);
 ok(j.vis("welcome")&&j.$("#welcome-notice").textContent.includes("expired")&&!j.w.location.hash,"J: expired email link shows a clear message and cleans the URL");
 // ===== K. signed-in guest-gating for online play =====
 const k=boot(mockWorld(),{seed:GUEST});await sleep(150);k.w.show("battle");ok(k.$("#battle-title").textContent.includes("need an account"),"K: Battle Online asks guests to sign in");
 console.log(fails?"FAILED "+fails:"AUTH ALL PASS");process.exit(0);
})();
