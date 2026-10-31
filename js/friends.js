// Friends: friend list, friend requests, battle invitations and in-app notifications.
// This file only DRAWS what the server returns and sends the player's taps. Every decision (who may ask whom, duplicates,
// accepting, expiry, creating the private room) is made by Supabase (supabase/migrations/007_friends.sql).
//  - registered player: calls the fr_* functions signed in
//  - guest: uses the same device identity as the leaderboard and Friend Battle (key "wbid_lb_guest": a random id + secret)
//  - live updates: Supabase Realtime broadcast "tick" on channel social:<my id> (no data in it), plus a check-in every 30 s.
//    The same check-in rhythm (every 25 s) tells the server this player is online.
// Friend requests and battle invitations are two separate things everywhere: separate tables, tabs, buttons and notifications.
(() => {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const POLL_MS = 30000, PING_MS = 25000;
  const CSS = `
#toast{z-index:80}
header.top.bt-head{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px}
.bt-head .bt-l{display:flex;align-items:center;gap:8px;min-width:0}
.bt-head #fb-title{text-align:center;white-space:nowrap}
.bt-head .coins{justify-self:end;height:44px}
.fr-open{position:relative}
.fr-open.has{border-color:var(--red1);color:var(--text);box-shadow:0 0 14px color-mix(in srgb,var(--red1) 40%,transparent)}
.fr-badge{position:absolute;top:-6px;right:-6px;min-width:19px;height:19px;padding:0 5px;border-radius:999px;display:grid;place-items:center;font-size:.68rem;font-weight:900;line-height:1;color:#fff;background:var(--red1);border:2px solid var(--bg);animation:fr-pulse 2s ease-in-out infinite}
.fr-ttl{display:grid;justify-items:center;gap:1px;min-width:0}.fr-ttl b{font-size:1.05rem}.fr-ttl small{font-size:.72rem;font-weight:700;color:var(--muted);letter-spacing:.3px}
.frx,.fr-sec,.fr-list,.fr-body{grid-template-columns:minmax(0,1fr)}
.fr-body{display:grid;gap:14px}
.frx{display:grid;gap:14px;width:100%;padding-bottom:84px;align-content:start}
.fr-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:4px;border-radius:15px;background:var(--panel);border:1px solid var(--line)}
.fr-tab{position:relative;display:flex;align-items:center;justify-content:center;gap:5px;padding:9px 2px;border-radius:11px;border:0;background:none;color:var(--muted);font:inherit;font-size:.8rem;font-weight:800;cursor:pointer;transition:background .18s,color .18s}
.fr-tab:hover{color:var(--text)}
.fr-tab.on{background:var(--gold);color:var(--on-color);box-shadow:0 2px 10px color-mix(in srgb,var(--gold) 35%,transparent)}
.fr-n{display:inline-grid;place-items:center;min-width:17px;height:17px;padding:0 5px;border-radius:999px;font-size:.66rem;font-weight:900;font-style:normal;background:var(--panel-2);color:var(--text);border:1px solid var(--line)}
.fr-n.hot{background:var(--red1);color:#fff;border-color:transparent}
.fr-tab.on .fr-n{background:color-mix(in srgb,var(--on-color) 18%,transparent);color:var(--on-color);border-color:transparent}
.fr-tab.on .fr-n.hot{background:var(--red1);color:#fff}
.fr-sec{display:grid;gap:8px}
.fr-sec h3{margin:2px 2px 0;display:flex;align-items:center;gap:8px;font-size:.78rem;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted)}
.fr-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.fr-card{--c:#8b8b92;position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;padding:12px 14px;border-radius:18px;overflow:visible;
  background:linear-gradient(160deg,color-mix(in srgb,var(--c) 11%,var(--panel)),var(--panel) 72%);border:1px solid color-mix(in srgb,var(--c) 38%,var(--line));
  box-shadow:0 6px 18px rgba(0,0,0,.2);animation:fr-in .38s ease both;animation-delay:calc(min(var(--i,0),10) * 40ms);transition:border-color .2s,box-shadow .2s,transform .2s}
.fr-card.on{--c:#4ADE80;box-shadow:0 6px 18px rgba(0,0,0,.2),0 0 20px color-mix(in srgb,#4ADE80 14%,transparent)}
.fr-card.req{--c:#38BDF8}.fr-card.inv{--c:#FACC15}.fr-card.sent{--c:#7C8CFF}
.fr-card:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--c) 70%,var(--line))}
.fr-card.out{animation:fr-out .3s ease both;pointer-events:none}
.fr-av{position:relative;display:grid;place-items:center;width:54px;height:54px;border-radius:50%;font-size:1.85rem;background:var(--panel-2);border:2px solid color-mix(in srgb,var(--c) 60%,var(--line))}
.fr-card.on .fr-av{box-shadow:0 0 14px color-mix(in srgb,#4ADE80 40%,transparent)}
.fr-dotst{position:absolute;right:-1px;bottom:-1px;width:14px;height:14px;border-radius:50%;background:#8b8b92;border:3px solid var(--panel)}
.fr-dotst.on{background:#4ADE80;box-shadow:0 0 9px #4ADE80;animation:fr-glow 2s ease-in-out infinite}
.fr-info{display:grid;gap:2px;min-width:0}
.fr-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.98rem}
.fr-status{display:inline-flex;align-items:center;gap:6px;font-size:.74rem;font-weight:800;color:var(--muted)}
.fr-status i{width:7px;height:7px;border-radius:50%;background:#8b8b92}
.fr-status.on{color:#4ADE80}[data-theme=light] .fr-status.on{color:#177a3c}.fr-status.on i{background:#4ADE80;box-shadow:0 0 7px #4ADE80}
.fr-meta{font-size:.76rem;color:var(--muted);font-variant-numeric:tabular-nums}
.fr-act{display:flex;align-items:center;gap:8px}
.fr-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 12px;border-radius:12px;border:1px solid var(--line);background:var(--panel-2);color:var(--text);font:inherit;font-size:.8rem;font-weight:800;line-height:1.1;cursor:pointer;white-space:nowrap;transition:transform .12s,filter .15s,border-color .15s}
.fr-btn:hover:not([disabled]){border-color:var(--gold);transform:translateY(-1px)}.fr-btn:active:not([disabled]){transform:scale(.96)}
.fr-btn[disabled]{opacity:.55;cursor:not-allowed}
.fr-btn.go{background:var(--gold);color:var(--on-color);border-color:transparent}
.fr-btn.ok{background:#4ADE80;color:#0a2a14;border-color:transparent}
.fr-btn.no{background:transparent}
.fr-btn.sm{padding:8px 10px}
.fr-more{position:relative}
.fr-dots{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;border:1px solid var(--line);background:var(--panel-2);color:var(--text);font-size:1.2rem;line-height:1;cursor:pointer}
.fr-dots:hover{border-color:var(--gold)}
.fr-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:5;min-width:170px;padding:6px;border-radius:14px;background:var(--panel);border:1px solid var(--line);box-shadow:0 14px 30px rgba(0,0,0,.4);animation:fr-in .18s ease both}
.fr-menu button{display:flex;align-items:center;gap:8px;width:100%;padding:10px 12px;border-radius:10px;border:0;background:none;color:var(--danger);font:inherit;font-size:.86rem;font-weight:800;text-align:left;cursor:pointer}
.fr-menu button:hover{background:color-mix(in srgb,var(--danger) 14%,transparent)}
.fr-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;font-size:.68rem;font-weight:800;letter-spacing:.6px;text-transform:uppercase;background:color-mix(in srgb,var(--c,var(--gold)) 20%,var(--panel-2));border:1px solid color-mix(in srgb,var(--c,var(--gold)) 55%,var(--line));color:var(--text)}
.fr-chip.pend{--c:#7C8CFF;animation:fr-pulse 2.2s ease-in-out infinite}
.fr-exp{font-variant-numeric:tabular-nums}
.fr-empty{display:grid;gap:8px;justify-items:center;padding:34px 18px;text-align:center;border-radius:22px;background:linear-gradient(170deg,color-mix(in srgb,var(--gold) 9%,var(--panel)),var(--panel) 70%);border:1px dashed color-mix(in srgb,var(--gold) 40%,var(--line));animation:fr-in .4s ease both}
.fr-empty .ic{display:grid;place-items:center;width:78px;height:78px;border-radius:50%;font-size:2.4rem;background:var(--panel-2);border:2px solid color-mix(in srgb,var(--gold) 55%,var(--line));box-shadow:0 0 26px color-mix(in srgb,var(--gold) 22%,transparent)}
.fr-empty h3{margin:6px 0 0;font-size:1.25rem;text-transform:none;letter-spacing:0}.fr-empty p{margin:0;color:var(--muted);font-size:.9rem;line-height:1.45;max-width:34ch}
.fr-empty .primary{flex:none;margin-top:8px;min-width:170px}
.fr-empty.small{padding:20px 14px;border-style:solid}.fr-empty.small .ic{width:52px;height:52px;font-size:1.5rem}.fr-empty.small h3{font-size:1rem}
.fr-note{padding:11px 13px;border-radius:14px;font-size:.8rem;line-height:1.45;color:var(--muted);background:color-mix(in srgb,#7C8CFF 12%,var(--panel));border:1px solid color-mix(in srgb,#7C8CFF 40%,var(--line))}
.fr-note b{color:var(--text)}.fr-note button{margin-top:6px;padding:0;border:0;background:none;color:var(--gold);font:inherit;font-weight:800;text-decoration:underline;cursor:pointer}
[data-theme=light] .fr-note button{color:color-mix(in srgb,var(--gold) 90%,#000)}
.fr-warn{padding:8px 12px;border-radius:12px;text-align:center;font-size:.78rem;font-weight:700;background:color-mix(in srgb,#FBBF24 18%,var(--panel));border:1px solid #FBBF24}
.fr-sk{display:grid;gap:10px}.fr-sk i{display:block;height:78px;border-radius:18px;background:linear-gradient(90deg,var(--panel),var(--panel-2),var(--panel));background-size:200% 100%;border:1px solid var(--line);animation:fr-sh 1.3s linear infinite}
.fr-al{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.fr-ar{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:10px 12px;border-radius:15px;background:var(--panel);border:1px solid var(--line);animation:fr-in .3s ease both;cursor:default}
.fr-ar.un{border-color:color-mix(in srgb,var(--gold) 60%,var(--line));background:linear-gradient(160deg,color-mix(in srgb,var(--gold) 9%,var(--panel)),var(--panel))}
.fr-ar.go{cursor:pointer}
.fr-ar .ic{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;font-size:1.2rem;background:var(--panel-2);border:1px solid var(--line)}
.fr-ar p{margin:0;font-size:.86rem;line-height:1.35}.fr-ar small{color:var(--muted);font-size:.72rem}
.fr-ar i.u{width:9px;height:9px;border-radius:50%;background:var(--red1);box-shadow:0 0 8px var(--red1)}
.fr-sheet-bg{position:fixed;inset:0;z-index:9;display:grid;align-items:end;justify-items:center;padding:0;background:rgba(0,0,0,.62);backdrop-filter:blur(4px);animation:fr-fade .2s ease both}
.fr-sheet{display:grid;gap:12px;width:min(100%,460px);padding:20px 16px calc(18px + env(safe-area-inset-bottom));border-radius:24px 24px 0 0;background:var(--panel);border:1px solid var(--line);box-shadow:0 -10px 40px rgba(0,0,0,.45);animation:fr-up .3s cubic-bezier(.2,.9,.3,1.05) both}
@media (min-width:640px){.fr-sheet-bg{align-items:center;padding:16px}.fr-sheet{border-radius:24px}}
.fr-sheet h3{margin:0;font-size:1.15rem;text-align:center}.fr-sheet p{margin:0;text-align:center;color:var(--muted);font-size:.86rem}
.fr-diffs{display:grid;gap:8px}
.fr-d{--c:#FACC15;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;padding:11px 14px;border-radius:16px;text-align:left;color:var(--text);font:inherit;cursor:pointer;background:var(--panel-2);border:2px solid var(--line);transition:border-color .15s,box-shadow .15s,transform .12s}
.fr-d.easy{--c:#4ADE80}.fr-d.hard{--c:#F87171}
.fr-d:hover{border-color:color-mix(in srgb,var(--c) 70%,var(--line))}
.fr-d.on{border-color:var(--c);background:linear-gradient(160deg,color-mix(in srgb,var(--c) 18%,var(--panel-2)),var(--panel-2));box-shadow:0 0 18px color-mix(in srgb,var(--c) 30%,transparent)}
.fr-d .i{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;font-size:1.4rem;background:color-mix(in srgb,var(--c) 22%,var(--panel));border:1px solid color-mix(in srgb,var(--c) 50%,var(--line))}
.fr-d b{display:block;font-size:1rem}.fr-d small{color:var(--muted);font-size:.76rem}.fr-d .t{font-weight:900;font-variant-numeric:tabular-nums;font-size:.95rem}
.fr-row{display:flex;gap:10px}.fr-row .primary{flex:1 1 0;padding:12px}
#fr-banner{position:fixed;top:calc(8px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:8;display:grid;gap:8px;width:min(500px,calc(100% - 16px))}
.fr-bn{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:10px 12px;border-radius:18px;background:linear-gradient(160deg,color-mix(in srgb,var(--gold) 16%,var(--panel)),var(--panel));border:1px solid var(--gold);box-shadow:0 12px 30px rgba(0,0,0,.45),0 0 22px color-mix(in srgb,var(--gold) 25%,transparent);animation:fr-drop .4s cubic-bezier(.2,.9,.3,1.1) both}
.fr-bn .fr-av{width:44px;height:44px;font-size:1.5rem}
.fr-bn p{margin:0;font-size:.84rem;line-height:1.3}.fr-bn p b{font-size:.92rem}.fr-bn small{display:block;color:var(--muted);font-size:.72rem;margin-top:1px}
.fr-bn .fr-act{flex-direction:column;align-items:stretch;gap:6px}
.fr-bn .fr-btn{padding:7px 12px}
.fr-nmrow{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;max-width:100%;min-width:0}
.fr-add{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;border:1px solid color-mix(in srgb,var(--gold) 60%,var(--line));background:color-mix(in srgb,var(--gold) 16%,var(--panel));color:var(--text);font:inherit;font-size:.72rem;font-weight:800;line-height:1.2;cursor:pointer;white-space:nowrap;transition:transform .12s,background .2s}
.fr-add:hover:not([disabled]){background:color-mix(in srgb,var(--gold) 30%,var(--panel));transform:translateY(-1px)}
.fr-add[disabled]{cursor:default;opacity:.9}
.fr-add.sent{border-color:color-mix(in srgb,#7C8CFF 60%,var(--line));background:color-mix(in srgb,#7C8CFF 18%,var(--panel))}
.fr-add.friends{border-color:color-mix(in srgb,#4ADE80 60%,var(--line));background:color-mix(in srgb,#4ADE80 18%,var(--panel))}
.fr-flash{display:block;width:100%;margin-top:2px;text-align:center;font-size:.7rem;font-weight:800;color:#4ADE80;animation:fr-in .3s ease both}
[data-theme=light] .fr-flash{color:#177a3c}.fr-flash.err{color:var(--danger)}
@media (max-width:440px){.fr-card{grid-template-columns:auto minmax(0,1fr)}.fr-card .fr-act{grid-column:1/-1;justify-content:flex-end}.fr-card .fr-act>.fr-btn:first-child{flex:1}.fr-bn{grid-template-columns:auto minmax(0,1fr)}.fr-bn .fr-act{grid-column:1/-1;flex-direction:row}.fr-bn .fr-act .fr-btn{flex:1}}
@media (max-width:360px){.fr-tab{font-size:.72rem}.fr-btn{padding:8px 9px;font-size:.76rem}}
@media (min-width:700px){
#friends{width:100%;max-width:720px;margin-left:auto;margin-right:auto}
.frx{gap:18px}
.fr-tab{padding:12px 6px;font-size:.9rem}
.fr-list{gap:14px}
.fr-card{gap:18px;padding:20px 24px;border-radius:22px}
.fr-av{width:72px;height:72px;font-size:2.4rem}
.fr-dotst{width:18px;height:18px}
.fr-nm{font-size:1.2rem}.fr-status{font-size:.82rem}.fr-meta{font-size:.86rem}
.fr-btn{padding:12px 18px;font-size:.9rem;border-radius:14px}
.fr-dots{width:46px;height:46px;font-size:1.4rem}
.fr-empty{padding:48px 24px}.fr-note{padding:14px 18px;font-size:.88rem}
}
@keyframes fr-in{from{opacity:0;transform:translateY(10px)}}
@keyframes fr-out{to{opacity:0;transform:translateX(26px) scale(.96)}}
@keyframes fr-pulse{50%{opacity:.6}}
@keyframes fr-glow{50%{box-shadow:0 0 3px #4ADE80}}
@keyframes fr-sh{to{background-position:-200% 0}}
@keyframes fr-fade{from{opacity:0}}
@keyframes fr-up{from{opacity:0;transform:translateY(40px)}}
@keyframes fr-drop{from{opacity:0;transform:translateY(-24px)}}
html[data-motion=reduced] .frx *,html[data-motion=reduced] #fr-banner *,html[data-motion=reduced] .fr-sheet-bg,html[data-motion=reduced] .fr-sheet,html[data-motion=reduced] .fr-badge,html[data-motion=reduced] .fr-add,html[data-motion=reduced] .fr-flash{animation:none!important;transition:none!important}
`;
  if (!document.getElementById("fr-css")) { const st = document.createElement("style"); st.id = "fr-css"; st.textContent = CSS; document.head.append(st); }

  // ---------- helpers ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => (Number(v) || 0).toLocaleString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const client = () => (window.Auth && Auth.client && Auth.client()) || null;
  const isAcct = () => !!(window.Auth && Auth.isAccount && Auth.isAccount());
  const curScreen = () => (typeof screen === "string" ? screen : "");
  const visible = () => curScreen() === "friends";
  const quick = () => typeof reduced === "function" && reduced();
  const say = (t, k, ms) => { if (typeof toast === "function") toast(t, k || "", ms); };
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const DIFF = { easy: { icon: "🌿", name: "Easy", min: 12, line: "Plenty of time to think" }, medium: { icon: "🔥", name: "Medium", min: 8, line: "A balanced battle" }, hard: { icon: "⚡", name: "Hard", min: 5, line: "Fast and fierce" } };
  const ERR = {
    not_found: "That is no longer available.", not_pending: "That was already answered.", throttled: "Slow down a little, then try again.",
    friend_limit: "Your friends list is full (200 friends).", too_many_pending: "You have too many pending requests. Cancel a few first.",
    not_friends: "You're not friends with this player.", already_invited: "You already invited this friend. Wait for their answer, or cancel it first.",
    busy: "You're already in a battle room. Finish or leave it first.", sender_busy: "They're in another battle right now. Try again in a moment.",
    sender_away: "They aren't online anymore, so the invitation was closed.", expired: "That invitation has expired.",
    not_finished: "You can add a friend once the battle is over.", forbidden: "That isn't available.", self: "That's you!", no_opponent: "There's no opponent to add.",
    no_server: "Friends need the online server, which isn't connected in this version.", not_setup: "Friends isn't set up on the server yet (the 007 database script hasn't been run).",
    network: "Can't reach the server. Check your connection and try again.", merged: "This guest profile moved into an account. Log in to see your friends.",
    bad_id: "Couldn't verify your player identity. Reload the app and try again.", try_again: "Couldn't create the battle room. Please try again.", error: "Something went wrong. Please try again."
  };
  const errText = (r) => ERR[(r && r.reason) || "error"] || ERR.error;

  // ---------- who am I (same guest identity as the leaderboard and Friend Battle) ----------
  const ID_KEY = "wbid_lb_guest", ADOPT_KEY = "wbid_fr_adopt";
  const rnd = (n) => { const a = new Uint8Array(n); (window.crypto || window.msCrypto).getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, "0")).join(""); };
  const uuid = () => { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); const h = rnd(16); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(12, 15)}-a${h.slice(15, 18)}-${h.slice(18, 30)}`; };
  function readGuest() { try { const g = JSON.parse(localStorage.getItem(ID_KEY)); if (g && typeof g.pid === "string" && typeof g.secret === "string" && g.secret.length >= 24) return g; } catch {} return null; }
  function guestId() {
    let g = readGuest(); if (g) return g;
    g = { pid: uuid(), secret: rnd(24), sent: false, merged: false };
    try { localStorage.setItem(ID_KEY, JSON.stringify(g)); } catch {}
    return g;
  }
  // "account" | "guest" | "merged" (a guest id that already moved into an account) | "off" (no server) | "none" (not signed in yet)
  function mode() {
    if (!client()) return "off";
    if (isAcct()) return "account";
    if (window.Auth && Auth.isGuest && Auth.isGuest()) { const g = readGuest(); return g && g.merged ? "merged" : "guest"; }
    return "none";
  }
  const live = () => { const m = mode(); return m === "account" || m === "guest"; };
  const idArgs = () => { if (isAcct()) return { p_pid: null, p_secret: null }; const g = guestId(); return { p_pid: g.pid, p_secret: g.secret }; };
  async function call(fn, args) {
    const c = client(); if (!c) return { ok: false, reason: "no_server" };
    try {
      const { data, error } = await c.rpc(fn, { ...args, ...idArgs() });
      if (error) { const m = String(error.message || ""); return { ok: false, reason: (error.code === "PGRST202" || /could not find the function|schema cache/i.test(m)) ? "not_setup" : "error", message: m }; }
      return data && typeof data === "object" ? data : { ok: false, reason: "error" };
    } catch { return { ok: false, reason: "network" }; }
  }

  // ---------- state ----------
  let D = null, st = "idle", tab = "friends", myId = "", chan = null, chanFor = "", curKey = "none", netBad = false;
  let loading = false, again = false, kickT = 0, pollT = 0, pingT = 0, gotAt = 0, seen = null, freshStart = false, lastSig = "", menuFor = "", sheet = null, readT = 0, bannerSig = "";
  const busy = new Set(), leaving = new Set(), dismissed = new Set(), expiredPoked = new Set();
  let joinOffer = null;   // { room, until }: a battle room made from my invitation that I could not enter automatically
  const srvNow = () => (D && D.server_now_ms ? D.server_now_ms + (Date.now() - gotAt) : Date.now());
  const ago = (iso) => { const s = Math.max(0, (srvNow() - Date.parse(iso)) / 1000); return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + "m ago" : s < 86400 ? Math.floor(s / 3600) + "h ago" : Math.floor(s / 86400) + "d ago"; };
  const pendingCount = () => (D ? (D.incoming || []).length + (D.inv_in || []).length : 0);

  // ---------- loading the overview ----------
  async function refresh(silent) {
    if (!live()) return;
    if (loading) { again = true; return; }
    loading = true;
    if (!silent && !D) { st = "loading"; paint(true); }
    const r = await call("fr_overview", {});
    loading = false;
    if (!live()) return;
    if (r.ok) { st = "ready"; netBad = false; D = r; gotAt = Date.now(); onData(); }
    else if (r.reason === "not_setup") st = "setup";
    else if (r.reason === "merged") st = "merged";
    else if (!D) st = "error";
    else netBad = true;                                            // keep showing the last data, say so quietly
    badge(); paint(); renderBanner();
    if (again) { again = false; setTimeout(() => refresh(true), 250); }
  }
  function onData() {
    if (D.me && D.me !== myId) { myId = D.me; loadSeen(); subscribe(); }
    handleNotifs(); markReadSoon();
  }
  const seenKey = () => "wbid_fr_seen_" + myId;
  function loadSeen() { try { const raw = localStorage.getItem(seenKey()); freshStart = raw === null; seen = new Set(JSON.parse(raw || "[]")); } catch { seen = new Set(); freshStart = true; } }
  function saveSeen() { try { localStorage.setItem(seenKey(), JSON.stringify([...seen].slice(-150))); } catch {} }

  // Each notification is announced once: the server never creates the same one twice, and this device remembers which it already showed.
  function handleNotifs() {
    if (!D || !seen) return;
    const fresh = (D.notifs || []).filter((n) => !seen.has(n.nid));
    if (freshStart) { freshStart = false; fresh.forEach((n) => seen.add(n.nid)); saveSeen(); return; }   // first load on this device: don't announce old history
    if (!fresh.length) return;
    fresh.forEach((n) => seen.add(n.nid)); saveSeen();
    const recent = fresh.filter((n) => !n.is_read && srvNow() - Date.parse(n.created_at) < 10 * 60 * 1000).reverse();
    recent.slice(0, 3).forEach(announce);
    if (recent.length > 3) say(`+${recent.length - 3} more notifications`, "", 3000);
  }
  function announce(n) {
    const nm = n.name || "A player";
    if (n.type === "friend_request") say(`👋 ${nm} sent you a friend request`, "success", 3800);
    else if (n.type === "friend_accepted") say(`🎉 ${nm} accepted your friend request!`, "success", 3800);
    else if (n.type === "battle_invite") say(`⚔️ ${nm} invited you to a battle`, "success", 3800);
    else if (n.type === "invite_accepted") { say(`⚔️ ${nm} accepted your battle invitation!`, "success", 3800); if (n.room_id && srvNow() - Date.parse(n.created_at) < 120000) enterRoom(n.room_id, nm); }
    else if (n.type === "invite_declined") say(`${nm} declined your battle invitation.`, "", 3800);
  }

  // ---------- realtime + heartbeat ----------
  function subscribe() {
    const c = client(); if (!c || !c.channel || !myId) return;
    if (chan && chanFor === myId) return;
    unsubscribe();
    try { chan = c.channel("social:" + myId).on("broadcast", { event: "tick" }, () => kick()).subscribe(); chanFor = myId; } catch { chan = null; }
  }
  function unsubscribe() { if (chan) { try { const c = client(); if (c) c.removeChannel(chan); } catch {} } chan = null; chanFor = ""; }
  const kick = () => { clearTimeout(kickT); kickT = setTimeout(() => refresh(true), 150); };
  async function ping() {
    if (document.hidden || !live()) return;
    const P = (typeof Player !== "undefined" && Player.data) || {};
    await call("fr_ping", { p_username: P.username || null, p_avatar: P.avatar || null });
  }
  function startLoops() {
    stopLoops(); ping(); refresh(false);
    pingT = setInterval(ping, PING_MS);
    pollT = setInterval(() => { if (!document.hidden) refresh(true); }, POLL_MS);
    if (isAcct() && localStorage.getItem(ADOPT_KEY)) adoptGuest();
  }
  function stopLoops() { clearInterval(pingT); clearInterval(pollT); clearTimeout(kickT); clearTimeout(readT); pingT = pollT = kickT = readT = 0; }
  function watch() {                                                 // the signed-in player changed (login, logout, guest): start over cleanly
    const m = mode(), key = m === "account" ? "a:" + (window.WB_NS || "") : m;
    if (key === curKey) return;
    curKey = key; stopLoops(); unsubscribe();
    D = null; myId = ""; seen = null; netBad = false; lastSig = ""; menuFor = ""; sheet = null; joinOffer = null; dismissed.clear(); expiredPoked.clear(); leaving.clear(); busy.clear();
    closeSheet();
    if (m === "account" || m === "guest") startLoops();
    else st = m === "merged" ? "merged" : m === "off" ? "off" : "idle";
    badge(); renderBanner(); paint(true);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && live()) { ping(); refresh(true); } });
  addEventListener("online", () => { if (live()) { ping(); refresh(true); } });

  // ---------- the Friends button on the Battle screen ----------
  function badge() {
    const n = pendingCount();
    $$("[data-fr-badge]").forEach((b) => { b.textContent = n > 9 ? "9+" : String(n); b.classList.toggle("hidden", !n); });
    const btn = $("#fr-open"); if (btn) { btn.classList.toggle("has", n > 0); btn.setAttribute("aria-label", n ? `Friends, ${n} pending` : "Friends"); }
  }
  function syncBtn() {                                               // not while sitting in a battle room: leaving the screen would close the room
    const b = $("#fr-open"); if (!b) return;
    const s = window.FriendBattle && FriendBattle.state && FriendBattle.state();
    b.classList.toggle("hidden", !!(s && s.room && ["waiting", "lobby", "playing"].includes(s.room.status)));
  }
  { const r = $("#fb-root"); if (r && window.MutationObserver) new MutationObserver(syncBtn).observe(r, { childList: true }); }

  // ---------- drawing the Friends page ----------
  const dis = (k) => (busy.has(k) ? " disabled" : "");
  const av = (p, cls) => `<span class="fr-av" aria-hidden="true">${esc(p.avatar)}${cls ? `<i class="fr-dotst ${cls}"></i>` : ""}</span>`;
  const cnt = (n, hot) => (n ? `<i class="fr-n${hot ? " hot" : ""}">${n > 99 ? "99+" : n}</i>` : "");
  function msgBox(ic, title, text, btn) { return `<div class="fr-empty small" role="status"><span class="ic" aria-hidden="true">${ic}</span><h3>${title}</h3><p>${text}</p>${btn || ""}</div>`; }
  function friendCard(f, i) {
    const inv = (D.inv_out || []).find((x) => x.fid === f.fid);
    return `<li class="fr-card${f.online ? " on" : ""}" style="--i:${i}" data-fid="${esc(f.fid)}">
      ${av(f, f.online ? "on" : "off")}
      <div class="fr-info"><b class="fr-nm">${esc(f.name)}</b><span class="fr-status ${f.online ? "on" : "off"}"><i></i>${f.online ? "Online" : "Offline"}</span><span class="fr-meta">Level ${num(f.level)} · ${num(f.xp)} XP</span></div>
      <div class="fr-act">
        ${inv ? `<button class="fr-btn no" type="button" data-fr="cancel-invite" data-id="${esc(inv.iid)}"${dis("ci:" + inv.iid)}>Invited · Cancel</button>`
              : `<button class="fr-btn go" type="button" data-fr="invite" data-fid="${esc(f.fid)}" data-name="${esc(f.name)}">⚔️ Invite to Battle</button>`}
        <div class="fr-more"><button class="fr-dots" type="button" data-fr="menu" data-fid="${esc(f.fid)}" aria-haspopup="menu" aria-expanded="${menuFor === f.fid}" aria-label="More options for ${esc(f.name)}">⋯</button>
          ${menuFor === f.fid ? `<div class="fr-menu" role="menu"><button type="button" role="menuitem" data-fr="remove" data-fid="${esc(f.fid)}" data-name="${esc(f.name)}"${dis("rm:" + f.fid)}>🗑️ Remove Friend</button></div>` : ""}</div>
      </div></li>`;
  }
  function vFriends() {
    const fl = [...(D.friends || [])].sort((a, b) => (b.online - a.online) || String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()));
    const guestNote = mode() === "guest" ? `<div class="fr-note">👤 <b>You're playing as a guest.</b> Your friends are saved on this device only, so they're lost if you clear your browser data or switch device. Create an account and your friends move with you.<br><button type="button" data-go="signup">Create account</button></div>` : "";
    if (!fl.length) return guestNote + `<div class="fr-empty"><span class="ic" aria-hidden="true">🤝</span><h3>No Friends Yet!</h3><p>Play battles, meet new players, and add them to your friends list.</p><button class="primary" type="button" data-go="battle">⚔️ Find a Battle</button></div>`;
    return guestNote + `<ul class="fr-list grid2">${fl.map(friendCard).join("")}</ul>`;
  }
  function reqCard(r, i, out) {
    const k = "rq:" + r.rid;
    return `<li class="fr-card ${out ? "sent" : "req"}${leaving.has(r.rid) ? " out" : ""}" style="--i:${i}">
      ${av(r)}<div class="fr-info"><b class="fr-nm">${esc(r.name)}</b><span class="fr-meta">Level ${num(r.level)}</span>${out ? `<span><span class="fr-chip pend">⏳ Pending</span></span>` : ""}</div>
      <div class="fr-act">${out
        ? `<button class="fr-btn no" type="button" data-fr="cancel-req" data-id="${esc(r.rid)}"${dis(k)}>Cancel</button>`
        : `<button class="fr-btn ok" type="button" data-fr="accept-req" data-id="${esc(r.rid)}"${dis(k)}>✓ Accept</button><button class="fr-btn no" type="button" data-fr="decline-req" data-id="${esc(r.rid)}"${dis(k)}>Decline</button>`}</div></li>`;
  }
  function vRequests() {
    const inc = D.incoming || [], out = D.outgoing || [];
    return `<section class="fr-sec"><h3>Received ${cnt(inc.length, true)}</h3>${inc.length ? `<ul class="fr-list grid2">${inc.map((r, i) => reqCard(r, i, false)).join("")}</ul>`
        : msgBox("📭", "No friend requests", "After a battle, tap <b>＋ Add Friend</b> next to your opponent's name.")}</section>
      <section class="fr-sec"><h3>Sent ${cnt(out.length)}</h3>${out.length ? `<ul class="fr-list grid2">${out.map((r, i) => reqCard(r, i, true)).join("")}</ul>`
        : msgBox("📤", "Nothing waiting", "Requests you send stay here until they're answered.")}</section>`;
  }
  function invCard(v, i) {
    const d = DIFF[v.difficulty] || DIFF.medium, k = "iv:" + v.iid;
    return `<li class="fr-card inv${leaving.has(v.iid) ? " out" : ""}" style="--i:${i}">
      ${av(v)}<div class="fr-info"><b class="fr-nm">${esc(v.name)}</b><span class="fr-meta">Level ${num(v.level)}</span><span><span class="fr-chip">${d.icon} ${d.name} · ${d.min} min</span> <span class="fr-meta fr-exp" data-until="${gotAt + Number(v.expires_in_ms)}"></span></span></div>
      <div class="fr-act"><button class="fr-btn go" type="button" data-fr="accept-inv" data-id="${esc(v.iid)}" data-name="${esc(v.name)}"${dis(k)}>⚔️ Accept</button><button class="fr-btn no" type="button" data-fr="decline-inv" data-id="${esc(v.iid)}"${dis(k)}>Decline</button></div></li>`;
  }
  function invOutCard(v, i) {
    const d = DIFF[v.difficulty] || DIFF.medium;
    return `<li class="fr-card sent" style="--i:${i}">
      ${av(v)}<div class="fr-info"><b class="fr-nm">${esc(v.name)}</b><span><span class="fr-chip pend">⏳ Waiting</span> <span class="fr-chip">${d.icon} ${d.name}</span></span><span class="fr-meta">Expires in <span class="fr-exp" data-until="${gotAt + Number(v.expires_in_ms)}"></span></span></div>
      <div class="fr-act"><button class="fr-btn no" type="button" data-fr="cancel-invite" data-id="${esc(v.iid)}"${dis("ci:" + v.iid)}>Cancel</button></div></li>`;
  }
  function vInvites() {
    const inn = D.inv_in || [], out = D.inv_out || [];
    return `<section class="fr-sec"><h3>Battle invitations ${cnt(inn.length, true)}</h3>${inn.length ? `<ul class="fr-list grid2">${inn.map(invCard).join("")}</ul>`
        : msgBox("⚔️", "No battle invitations", "When a friend invites you, it shows up here. Accepting never changes your friends list.")}</section>
      <section class="fr-sec"><h3>Invitations you sent ${cnt(out.length)}</h3>${out.length ? `<ul class="fr-list grid2">${out.map(invOutCard).join("")}</ul>`
        : msgBox("📨", "None sent", "Tap <b>Invite to Battle</b> on a friend to challenge them. No room code needed.")}</section>`;
  }
  const NOTE = {
    friend_request: (n) => ["👋", `<b>${esc(n.name)}</b> sent you a friend request`, "requests"],
    friend_accepted: (n) => ["🎉", `<b>${esc(n.name)}</b> accepted your friend request`, "friends"],
    battle_invite: (n) => ["⚔️", `<b>${esc(n.name)}</b> invited you to a ${esc((DIFF[n.difficulty] || DIFF.medium).name)} battle${n.inv_status && n.inv_status !== "pending" ? ` · ${n.inv_status === "accepted" ? "you accepted" : n.inv_status === "declined" ? "you declined" : n.inv_status === "expired" ? "expired" : "withdrawn"}` : ""}`, "invites"],
    invite_accepted: (n) => ["✅", `<b>${esc(n.name)}</b> accepted your battle invitation`, ""],
    invite_declined: (n) => ["🚫", `<b>${esc(n.name)}</b> declined your battle invitation`, ""]
  };
  function vAlerts() {
    const list = (D.notifs || []).filter((n) => NOTE[n.type]);
    if (!list.length) return msgBox("🔔", "All quiet", "Friend requests, accepted requests and battle invitations will be listed here.");
    return `<ul class="fr-al">${list.map((n) => { const [ic, html, go] = NOTE[n.type](n); return `<li class="fr-ar${n.is_read ? "" : " un"}${go ? " go" : ""}" ${go ? `data-fr="goto" data-tab="${go}" role="button" tabindex="0"` : ""}><span class="ic" aria-hidden="true">${ic}</span><div><p>${html}</p><small>${ago(n.created_at)}</small></div>${n.is_read ? "" : '<i class="u" aria-label="Unread"></i>'}</li>`; }).join("")}</ul>`;
  }
  function body() {
    if (st === "off") return msgBox("🌐", "Friends need the online server", "This copy of the app isn't connected to the online server, so friends aren't available yet.");
    if (st === "setup") return msgBox("🛠️", "Friends isn't set up yet", "The server part hasn't been installed. Run <b>007_friends.sql</b> in Supabase (see supabase/SETUP.md), then reopen this page.");
    if (st === "merged") return msgBox("🔑", "Your friends moved", "This guest profile became an account, and its friends went with it. Log in to see them.", `<button class="primary" type="button" data-go="login">Log in</button>`);
    if (st === "idle" || (st === "loading" && !D)) return `<div class="fr-sk" aria-busy="true" aria-label="Loading friends"><i></i><i></i><i></i></div>`;
    if (st === "error" && !D) return msgBox("📡", "Couldn't load your friends", "Check your connection and try again. Nothing was lost.", `<button class="primary" type="button" data-fr="retry">Try again</button>`);
    const warn = netBad ? `<div class="fr-warn" role="status">Couldn't refresh just now. Showing the last update.</div>` : "";
    return warn + (tab === "requests" ? vRequests() : tab === "invites" ? vInvites() : tab === "alerts" ? vAlerts() : vFriends());
  }
  function tabs() {
    const f = D ? (D.friends || []).length : 0, rq = D ? (D.incoming || []).length : 0, iv = D ? (D.inv_in || []).length : 0, un = D ? Number(D.unread) || 0 : 0;
    const t = (id, label, c) => `<button class="fr-tab${tab === id ? " on" : ""}" type="button" role="tab" aria-selected="${tab === id}" data-fr="tab" data-tab="${id}">${label}${c}</button>`;
    return `<div class="fr-tabs" role="tablist" aria-label="Friends sections">${t("friends", "Friends", cnt(f))}${t("requests", "Requests", cnt(rq, true))}${t("invites", "Invites", cnt(iv, true))}${t("alerts", "Alerts", cnt(un, true))}</div>`;
  }
  function paint(force) {
    const root = $("#fr-root"); if (!root || !visible()) return;
    const n = D ? (D.friends || []).length : 0, c = $("#fr-count");
    if (c) c.textContent = D ? `${n} ${n === 1 ? "friend" : "friends"}` : "";
    const sig = JSON.stringify([st, tab, netBad, menuFor, [...busy], [...leaving], D && [D.friends, D.incoming, D.outgoing, D.inv_in, D.inv_out, D.notifs, D.unread]]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    const y = window.scrollY, keep = root.querySelector(".fr-menu") ? 0 : 1;
    root.innerHTML = tabs() + `<div class="fr-body" role="tabpanel">${body()}</div>`;
    tickClock(); if (keep) window.scrollTo(0, y);
  }

  // ---------- the live countdowns (1 s) ----------
  function tickClock() {
    const now = Date.now();
    $$("[data-until]").forEach((e) => { const left = Number(e.dataset.until) - now; e.textContent = left > 0 ? mmss(left) : "Expired"; if (left <= 0 && !expiredPoked.has(e.dataset.until)) { expiredPoked.add(e.dataset.until); refresh(true); } });
  }
  setInterval(() => { tickClock(); renderBanner(); if (visible() && D) paint(); }, 1000);

  // ---------- invitation banner (shown on any screen except the game boards) ----------
  function bannerItems() {
    const s = curScreen(); if (!D || !live() || ["welcome", "signup", "login", "forgot", "reset", "verify", "game", "friends"].includes(s) || !s) return [];
    if (window.BattleGame && BattleGame.isOn && BattleGame.isOn()) return [];
    const fb = window.FriendBattle && FriendBattle.state && FriendBattle.state(); if (fb && fb.room && ["waiting", "lobby", "playing"].includes(fb.room.status)) return [];
    const items = (D.inv_in || []).filter((v) => !dismissed.has(v.iid) && gotAt + Number(v.expires_in_ms) > Date.now()).map((v) => ({ kind: "inv", v }));
    if (joinOffer && joinOffer.until > Date.now()) items.unshift({ kind: "join", v: joinOffer });
    return items.slice(0, 2);
  }
  function renderBanner() {
    const items = bannerItems(), sig = JSON.stringify(items.map((x) => [x.kind, x.v.iid || x.v.room, busy.has("iv:" + x.v.iid)])); let el = $("#fr-banner");
    if (!items.length) { if (el) el.remove(); bannerSig = ""; return; }
    if (el && sig === bannerSig) return;
    bannerSig = sig;
    if (!el) { el = document.createElement("div"); el.id = "fr-banner"; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Battle invitations"); document.body.append(el); }
    el.innerHTML = items.map((x) => {
      if (x.kind === "join") return `<div class="fr-bn"><span class="fr-av" aria-hidden="true">⚔️</span><p><b>${esc(x.v.name)}</b> accepted your invitation!<small>Your battle room is ready.</small></p><div class="fr-act"><button class="fr-btn go" type="button" data-frb="join" data-room="${esc(x.v.room)}">Join Battle</button></div></div>`;
      const v = x.v, d = DIFF[v.difficulty] || DIFF.medium, k = "iv:" + v.iid;
      return `<div class="fr-bn"><span class="fr-av" aria-hidden="true">${esc(v.avatar)}</span><p><b>${esc(v.name)}</b> invites you to a battle<small>${d.icon} ${d.name} · ${d.min} min · <span class="fr-exp" data-until="${gotAt + Number(v.expires_in_ms)}"></span></small></p><div class="fr-act"><button class="fr-btn go" type="button" data-frb="accept" data-id="${esc(v.iid)}" data-name="${esc(v.name)}"${dis(k)}>Accept</button><button class="fr-btn no" type="button" data-frb="decline" data-id="${esc(v.iid)}"${dis(k)}>Decline</button></div></div>`;
    }).join("");
    tickClock();
  }

  // ---------- actions ----------
  async function act(key, fn) {
    if (busy.has(key)) return;
    busy.add(key); paint(true); renderBanner();
    try { await fn(); } finally { busy.delete(key); paint(true); renderBanner(); }
  }
  async function leave(id) {                                        // smooth exit, then take the fresh list from the server
    leaving.add(id); paint(true);
    await sleep(quick() ? 0 : 300);
    leaving.delete(id); await refresh(true);
  }
  const respondRequest = (rid, accept) => act("rq:" + rid, async () => {
    const r = await call("fr_respond_request", { p_request: rid, p_accept: accept });
    if (r.ok) { say(accept ? "Friend added! 🎉" : "Request declined", accept ? "success" : ""); await leave(rid); }
    else { say(errText(r), "error", 3200); await refresh(true); }
  });
  const cancelRequest = (rid) => act("rq:" + rid, async () => {
    const r = await call("fr_cancel_request", { p_request: rid });
    if (r.ok) { say("Request cancelled"); await leave(rid); } else { say(errText(r), "error", 3200); await refresh(true); }
  });
  const removeFriend = async (fid, name) => {
    if (busy.has("rm:" + fid)) return;
    menuFor = ""; paint(true);
    if (!(await confirmBox("Remove friend?", `${name} will be removed from your friends list. You can add each other again after a battle.`, "Remove"))) return;
    return act("rm:" + fid, async () => {
      const r = await call("fr_remove_friend", { p_friendship: fid });
      if (r.ok) { say(`${name} removed`); await leave(fid); } else { say(errText(r), "error", 3200); await refresh(true); }
    });
  };
  const cancelInvite = (iid) => act("ci:" + iid, async () => {
    const r = await call("fr_cancel_invite", { p_invite: iid });
    say(r.ok ? "Invitation cancelled" : errText(r), r.ok ? "" : "error", 3000); await refresh(true);
  });
  const respondInvite = (iid, accept, name) => act("iv:" + iid, async () => {
    const r = await call("fr_respond_invite", { p_invite: iid, p_accept: accept });
    if (r.ok && accept && r.state) {
      dismissed.add(iid); const fb = window.FriendBattle;
      if (fb && fb.api && typeof show === "function") { fb.api.enter(r.state); show("battle"); say("Battle room ready! Press Ready when you're set.", "success", 3200); }
    } else if (r.ok) { say("Invitation declined"); await leave(iid); }
    else { dismissed.add(iid); say(r.reason === "sender_away" || r.reason === "sender_busy" ? `${name || "They"}: ${errText(r)}` : errText(r), "error", 3600); await refresh(true); }
  });

  // The sender walks into the room their friend's acceptance just created.
  async function enterRoom(roomId, name) {
    const fb = window.FriendBattle; if (!fb || !fb.api || typeof show !== "function") return;
    const free = !fb.state() && !(window.BattleGame && BattleGame.isOn && BattleGame.isOn());
    if (free && curScreen() !== "game") {
      const r = await fb.api.call("bt_sync", { p_room: roomId });
      if (r && r.ok && r.state && ["waiting", "lobby", "playing"].includes(r.state.room.status) && !fb.state()) { fb.api.enter(r.state); show("battle"); return; }
    }
    joinOffer = { room: roomId, name: name || "Your friend", until: Date.now() + 70000 }; renderBanner();
  }
  async function joinOfferNow(room) {
    joinOffer = null; renderBanner();
    const fb = window.FriendBattle; if (!fb || !fb.api || fb.state()) return;
    const r = await fb.api.call("bt_sync", { p_room: room });
    if (r && r.ok && r.state && ["waiting", "lobby", "playing"].includes(r.state.room.status)) { fb.api.enter(r.state); show("battle"); } else say("That battle room is no longer available.", "error", 3200);
  }

  // Invite to Battle: pick a difficulty, then send.
  function openSheet(fid, name) { sheet = { fid, name, diff: "", sending: false }; drawSheet(); }
  function closeSheet() { sheet = null; const e = $("#fr-sheet"); if (e) e.remove(); }
  function drawSheet() {
    let bg = $("#fr-sheet");
    if (!sheet) { if (bg) bg.remove(); return; }
    if (!bg) { bg = document.createElement("div"); bg.id = "fr-sheet"; bg.className = "fr-sheet-bg"; document.body.append(bg); bg.addEventListener("click", sheetClick); }
    bg.innerHTML = `<div class="fr-sheet" role="dialog" aria-modal="true" aria-labelledby="fr-sh-t"><h3 id="fr-sh-t">Invite ${esc(sheet.name)} to battle</h3><p>Pick a difficulty. Your friend gets the invitation right away. No room code needed.</p>
      <div class="fr-diffs" role="radiogroup" aria-label="Difficulty">${Object.entries(DIFF).map(([k, d]) => `<button type="button" class="fr-d ${k}${sheet.diff === k ? " on" : ""}" role="radio" aria-checked="${sheet.diff === k}" data-frs="pick" data-diff="${k}"><span class="i" aria-hidden="true">${d.icon}</span><span><b>${d.name}</b><small>${d.line}</small></span><span class="t">${d.min} min</span></button>`).join("")}</div>
      <div class="fr-row"><button class="primary alt" type="button" data-frs="cancel">Cancel</button><button class="primary" type="button" data-frs="send"${sheet.diff && !sheet.sending ? "" : " disabled"}>${sheet.sending ? "Sending…" : "Send Invitation"}</button></div></div>`;
    const f = bg.querySelector(sheet.diff ? '[data-frs="send"]' : ".fr-d"); if (f && !bg.dataset.focused) { bg.dataset.focused = "1"; f.focus({ preventScroll: true }); }
  }
  async function sheetClick(e) {
    if (e.target.id === "fr-sheet") return closeSheet();
    const b = e.target.closest("[data-frs]"); if (!b || !sheet || b.disabled) return;
    const a = b.dataset.frs;
    if (a === "cancel") closeSheet();
    else if (a === "pick") { sheet.diff = b.dataset.diff; drawSheet(); }
    else if (a === "send" && sheet.diff && !sheet.sending) {
      sheet.sending = true; drawSheet();
      const { fid, name, diff } = sheet;
      const r = await call("fr_invite", { p_friendship: fid, p_difficulty: diff });
      if (r.ok) { say(`Invitation sent to ${name}!`, "success", 3000); closeSheet(); await refresh(true); }
      else { say(errText(r), "error", 3600); if (r.reason === "already_invited") { closeSheet(); refresh(true); } else if (sheet) { sheet.sending = false; drawSheet(); } }
    }
  }

  // Notifications become "read" once the player has actually looked at the Alerts tab.
  function markReadSoon() {
    clearTimeout(readT);
    if (!visible() || tab !== "alerts" || !D || !(Number(D.unread) > 0)) return;
    readT = setTimeout(async () => {
      if (!visible() || tab !== "alerts") return;
      const r = await call("fr_mark_read", { p_ids: null });
      if (r.ok && D) { (D.notifs || []).forEach((n) => (n.is_read = true)); D.unread = 0; paint(true); }
    }, 1500);
  }

  // ---------- wiring ----------
  const rootEl = $("#fr-root");
  function onClick(e) {
    const b = e.target.closest("[data-fr]"); if (!b || b.disabled) return;
    const a = b.dataset.fr, id = b.dataset.id;
    if (a === "tab") { tab = b.dataset.tab; menuFor = ""; paint(true); markReadSoon(); }
    else if (a === "goto") { tab = b.dataset.tab; menuFor = ""; paint(true); }
    else if (a === "retry") refresh(false);
    else if (a === "menu") { menuFor = menuFor === b.dataset.fid ? "" : b.dataset.fid; paint(true); }
    else if (a === "invite") { menuFor = ""; paint(true); openSheet(b.dataset.fid, b.dataset.name); }
    else if (a === "remove") removeFriend(b.dataset.fid, b.dataset.name);
    else if (a === "accept-req") respondRequest(id, true);
    else if (a === "decline-req") respondRequest(id, false);
    else if (a === "cancel-req") cancelRequest(id);
    else if (a === "cancel-invite") cancelInvite(id);
    else if (a === "accept-inv") respondInvite(id, true, b.dataset.name);
    else if (a === "decline-inv") respondInvite(id, false);
  }
  if (rootEl) { rootEl.addEventListener("click", onClick); rootEl.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches('[data-fr="goto"]')) { e.preventDefault(); onClick(e); } }); }
  document.addEventListener("click", (e) => {
    const bn = e.target.closest("[data-frb]");
    if (bn && !bn.disabled) {
      const a = bn.dataset.frb;
      if (a === "accept") respondInvite(bn.dataset.id, true, bn.dataset.name);
      else if (a === "decline") { dismissed.add(bn.dataset.id); renderBanner(); respondInvite(bn.dataset.id, false); }
      else if (a === "join") joinOfferNow(bn.dataset.room);
      return;
    }
    if (menuFor && !e.target.closest(".fr-more")) { menuFor = ""; paint(true); }
  });
  document.addEventListener("keydown", (e) => { if (e.key !== "Escape") return; if (sheet) closeSheet(); else if (menuFor) { menuFor = ""; paint(true); } });
  document.addEventListener("click", (e) => {                       // Back on the Friends page returns to the Battle screen (every other Back goes to the dashboard)
    if (!visible() || !e.target.closest("#friends [data-back]")) return;
    e.stopPropagation(); e.preventDefault(); if (typeof show === "function") show("battle");
  }, true);

  // ---------- "+ Add Friend" beside the opponent's name on the battle result ----------
  async function decorateResult(card, roomId) {
    try {
      if (!card || !roomId || !live()) return;
      const oc = card.querySelector(".bt-fc[data-opp]"), nm = oc && oc.querySelector("b"); if (!nm) return;
      const row = document.createElement("div"); row.className = "fr-nmrow"; nm.replaceWith(row); row.append(nm);
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "fr-add"; row.append(btn);
      const flash = document.createElement("span"); flash.className = "fr-flash"; flash.setAttribute("role", "status"); flash.setAttribute("aria-live", "polite"); row.append(flash);
      let rel = "load", ft = 0;
      const say2 = (t, bad) => { flash.textContent = t; flash.classList.toggle("err", !!bad); clearTimeout(ft); ft = setTimeout(() => { flash.textContent = ""; }, 3500); };
      const draw = () => {
        const L = { load: ["…", true, ""], none: ["＋ Add Friend", false, ""], incoming: ["＋ Add Friend", false, ""], busy: ["Sending…", true, ""], sent: ["✓ Request Sent", true, "sent"], friends: ["👥 Friends", true, "friends"] }[rel] || ["＋ Add Friend", false, ""];
        btn.textContent = L[0]; btn.disabled = L[1]; btn.className = "fr-add " + L[2];
        btn.setAttribute("aria-label", rel === "sent" ? "Friend request sent" : rel === "friends" ? "You are friends" : "Add " + (nm.textContent || "opponent") + " as a friend");
      };
      draw();
      const r = await call("fr_relation", { p_room: roomId });
      if (!r.ok) { if (r.reason === "network" || r.reason === "error") { rel = "none"; draw(); } else row.replaceWith(nm); return; }
      rel = r.status === "self" ? "load" : r.status; if (r.status === "self") { row.replaceWith(nm); return; }
      draw();
      btn.onclick = async () => {
        if (rel !== "none" && rel !== "incoming") return;
        const prev = rel; rel = "busy"; draw();
        const s = await call("fr_send_request", { p_room: roomId });
        if (s.ok) {
          rel = s.status === "friends" ? "friends" : "sent";
          const t = s.status === "friends" ? (s.auto ? "You're now friends! 🎉" : "You're already friends") : "Friend Request Sent!";
          say(t, "success", 3000); say2(t); refresh(true);
        } else { rel = prev; say(errText(s), "error", 3400); say2(errText(s), true); }
        draw();
      };
    } catch {}
  }

  // ---------- a guest became an account: their friends and pending requests move over ----------
  async function adoptGuest() {
    const c = client(); if (!c || !isAcct()) return;
    const g = readGuest(); if (!g) return;
    try {
      const r = await c.rpc("fr_adopt_guest", { p_guest: g.pid, p_secret: g.secret });
      if (r.error) { if (r.error.code !== "PGRST202") localStorage.setItem(ADOPT_KEY, "1"); return; }   // offline: try again next time (a missing 007 script is not retried)
      localStorage.removeItem(ADOPT_KEY); refresh(true);
    } catch { localStorage.setItem(ADOPT_KEY, "1"); }
  }

  function screenChanged(name) {
    if (name === "friends") { menuFor = ""; if (live()) refresh(false); else { st = mode() === "merged" ? "merged" : mode() === "off" ? "off" : "idle"; } paint(true); markReadSoon(); }
    else { closeSheet(); menuFor = ""; clearTimeout(readT); }
    syncBtn(); renderBanner();
  }

  setTimeout(watch, 1200); setInterval(watch, 2000); syncBtn(); badge();
  window.Friends = { screenChanged, refresh: () => refresh(true), decorateResult, adoptGuest, pending: pendingCount };
})();