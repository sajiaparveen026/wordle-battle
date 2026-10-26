const {JSDOM}=require("jsdom");const fs=require("fs");const root="/home/claude/wordle-battle/";
const dom=new JSDOM("<body></body>",{runScripts:"outside-only",url:"http://localhost/",pretendToBeVisual:true});const w=dom.window;
w.eval(fs.readFileSync(root+"js/vendor/supabase.js","utf8"));
const c=w.supabase.createClient("https://abc.supabase.co","sb_publishable_test",{auth:{flowType:"pkce",persistSession:true,autoRefreshToken:false,detectSessionInUrl:false}});
const need=["signUp","signInWithPassword","signOut","resend","resetPasswordForEmail","updateUser","signInWithOAuth","getSession","onAuthStateChange"];
console.log("real supabase-js client methods present:",need.every(m=>typeof c.auth[m]==="function"),"| from/rpc:",typeof c.from,typeof c.rpc);
process.exit(0);
