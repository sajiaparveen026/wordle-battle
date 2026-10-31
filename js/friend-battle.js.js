// Friend Battle (online 1v1 private rooms). This screen only shows what the server returns: the room, the players, who is ready.
// Every decision (codes, joining, readiness, the word, the clock, the winner) is made by Supabase (supabase/migrations/006_*.sql).
//  - registered player: calls the bt_* functions signed in; name + avatar come from the account on the server
//  - guest: uses the same device identity as the leaderboard (key "wbid_lb_guest": a random id + secret)
//  - live updates: Supabase Realtime broadcast "tick" on channel battle:<room id>, plus a check-in every few seconds that also
//    tells the server this player is still connected (so a closed tab is noticed)
// Step 2 of the build: landing, Friend Zone, create / join, waiting room, lobby + ready. The battle screen itself comes next.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const POLL_MS = 4000;
  const CSS = `
.fb{display:grid;gap:14px;width:100%;max-width:560px;margin:0 auto;padding-bottom:84px}
.fb-view{display:grid;gap:14px}
.fb-view.fresh>*{animation:fb-in .4s ease both}
.fb-view.fresh>*:nth-child(2){animation-delay:.07s}.fb-view.fresh>*:nth-child(3){animation-delay:.14s}.fb-view.fresh>*:nth-child(4){animation-delay:.21s}
.fb-hero{display:grid;gap:4px;text-align:center;padding:4px 0 2px}
.fb-hero h2{margin:0;font-size:1.35rem;letter-spacing:.2px}
.fb-hero p{margin:0;color:var(--muted);font-size:.9rem}
.fb-cards{display:grid;gap:14px;grid-template-columns:1fr}
@media (min-width:640px){.fb-cards.two{grid-template-columns:1fr 1fr}}
.fb-card{--c:#FACC15;position:relative;display:grid;gap:8px;justify-items:start;text-align:left;width:100%;padding:18px;border-radius:20px;color:var(--text);cursor:pointer;
  background:linear-gradient(160deg,color-mix(in srgb,var(--c) 15%,var(--panel)),var(--panel) 72%);border:1px solid color-mix(in srgb,var(--c) 42%,var(--line));
  box-shadow:0 8px 22px rgba(0,0,0,.25),0 0 22px color-mix(in srgb,var(--c) 16%,transparent);transition:transform .18s,box-shadow .18s,border-color .18s;overflow:hidden}
.fb-card::after{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 35%,color-mix(in srgb,var(--c) 14%,transparent) 50%,transparent 65%);transform:translateX(-120%);transition:transform .7s}
.fb-card:not([disabled]):hover,.fb-card:not([disabled]):focus-visible{transform:translateY(-3px);box-shadow:0 12px 28px rgba(0,0,0,.3),0 0 28px color-mix(in srgb,var(--c) 32%,transparent);border-color:var(--c)}
.fb-card:not([disabled]):hover::after{transform:translateX(120%)}
.fb-card:not([disabled]):active{transform:translateY(0) scale(.985)}
.fb-card[disabled]{cursor:not-allowed;filter:saturate(.55);opacity:.82}
.fb-card.ai{--c:#7C8CFF}.fb-card.create{--c:#4ADE80}.fb-card.join{--c:#38BDF8}
.fb-ico{display:grid;place-items:center;width:52px;height:52px;border-radius:16px;font-size:1.7rem;background:color-mix(in srgb,var(--c) 22%,var(--panel-2));border:1px solid color-mix(in srgb,var(--c) 50%,var(--line));box-shadow:0 0 16px color-mix(in srgb,var(--c) 30%,transparent)}
.fb-card h3{margin:2px 0 0;font-size:1.12rem}
.fb-card p{margin:0;color:var(--muted);font-size:.86rem;line-height:1.4}
.fb-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:.7rem;font-weight:800;letter-spacing:.8px;text-transform:uppercase;background:color-mix(in srgb,var(--c,var(--gold)) 20%,var(--panel-2));border:1px solid color-mix(in srgb,var(--c,var(--gold)) 55%,var(--line));color:var(--text)}
.fb-chip.soon{animation:fb-pulse 2.2s ease-in-out infinite}
.fb-go{margin-top:2px;font-size:.82rem;font-weight:800;color:var(--c)}
[data-theme=light] .fb-go{color:color-mix(in srgb,var(--c) 60%,#000)}
.fb-diff{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px}
.fb-diff .fb-ico{width:46px;height:46px;font-size:1.5rem}
.fb-diff h3{margin:0}.fb-diff .t{font-size:1.15rem;font-weight:900;font-variant-numeric:tabular-nums}.fb-diff .t small{display:block;font-size:.66rem;font-weight:800;color:var(--muted);letter-spacing:.7px;text-transform:uppercase}
.fb-card.easy{--c:#4ADE80}.fb-card.medium{--c:#FACC15}.fb-card.hard{--c:#F87171}
.fb-card.loading{pointer-events:none;opacity:.7}
.fb-code{display:flex;justify-content:center;gap:7px;margin:2px 0}
.fb-tile{display:grid;place-items:center;width:44px;height:56px;border-radius:11px;font-size:1.75rem;font-weight:900;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;background:var(--panel-2);border:2px solid var(--gold);color:var(--text);box-shadow:0 0 14px color-mix(in srgb,var(--gold) 28%,transparent);animation:fb-flip .5s ease both}
.fb-tile:nth-child(2){animation-delay:.06s}.fb-tile:nth-child(3){animation-delay:.12s}.fb-tile:nth-child(4){animation-delay:.18s}.fb-tile:nth-child(5){animation-delay:.24s}.fb-tile:nth-child(6){animation-delay:.3s}
.fb-box{display:grid;gap:12px;padding:16px;border-radius:20px;background:var(--panel);border:1px solid var(--line);text-align:center}
.fb-box .lbl{margin:0;font-size:.72rem;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:var(--muted)}
.fb-row{display:flex;gap:10px;flex-wrap:wrap}.fb-row>button{flex:1 1 140px}
.fb-row .primary{padding:12px 14px}
.fb-meta{display:flex;justify-content:center;gap:8px;flex-wrap:wrap}
.fb-players{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:stretch;gap:10px}
.fb-vs{align-self:center;font-weight:900;font-size:.8rem;letter-spacing:2px;color:var(--muted)}
.fb-pc{display:grid;gap:5px;justify-items:center;align-content:start;min-width:0;padding:14px 8px;border-radius:18px;text-align:center;background:var(--panel);border:1px solid var(--line);transition:border-color .25s,box-shadow .25s}
.fb-pc.ready{border-color:#4ADE80;box-shadow:0 0 18px rgba(74,222,128,.28)}
.fb-pc.empty{border-style:dashed;background:transparent}
.fb-av{display:grid;place-items:center;width:62px;height:62px;border-radius:50%;font-size:2.1rem;background:var(--panel-2);border:2px solid var(--line)}
.fb-pc.ready .fb-av{border-color:#4ADE80}
.fb-pc.empty .fb-av{font-size:1.7rem;color:var(--muted);animation:fb-pulse 1.8s ease-in-out infinite}
.fb-pc b{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.95rem}
.fb-pc small{color:var(--muted);font-size:.74rem}
.fb-you{display:inline-block;margin-left:5px;padding:1px 6px;border-radius:999px;font-size:.6rem;font-weight:900;letter-spacing:.7px;background:var(--gold);color:var(--on-color);vertical-align:1px}
.fb-st{display:inline-flex;align-items:center;gap:6px;font-size:.74rem;font-weight:700;color:var(--muted)}
.fb-st i{width:8px;height:8px;border-radius:50%;background:#4ADE80;box-shadow:0 0 8px #4ADE80}
.fb-st.reconnecting i{background:#FBBF24;box-shadow:0 0 8px #FBBF24;animation:fb-pulse 1s infinite}
.fb-st.disconnected i,.fb-st.left i{background:#8b8b92;box-shadow:none}
.fb-rd{font-size:.76rem;font-weight:800;color:var(--muted)}.fb-pc.ready .fb-rd{color:#4ADE80}
.fb-wait{display:flex;align-items:center;justify-content:center;gap:10px;color:var(--muted);font-size:.92rem}
.fb-dots{display:inline-flex;gap:5px}.fb-dots i{width:8px;height:8px;border-radius:50%;background:var(--gold);animation:fb-bounce 1.2s infinite ease-in-out}
.fb-dots i:nth-child(2){animation-delay:.15s}.fb-dots i:nth-child(3){animation-delay:.3s}
.fb-input{width:100%;padding:14px 10px;border-radius:14px;text-align:center;font-size:1.9rem;font-weight:900;letter-spacing:.38em;text-indent:.38em;text-transform:uppercase;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:var(--text);background:var(--panel-2);border:2px solid var(--field-line,var(--line))}
.fb-input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px color-mix(in srgb,var(--gold) 25%,transparent)}
.fb-input::placeholder{color:var(--muted);opacity:.5;letter-spacing:.2em}
.fb-err{min-height:1.3em;margin:0;font-size:.86rem;font-weight:600;color:var(--danger,#e5484d);text-align:center}
.fb-err .primary{margin-top:8px}
.fb-count{display:grid;gap:6px;justify-items:center;padding:26px 10px}
.fb-count .n{font-size:5.5rem;line-height:1;font-weight:900;color:var(--gold);animation:fb-pop .9s ease both;font-variant-numeric:tabular-nums}
.fb-banner{padding:8px 12px;border-radius:12px;text-align:center;font-size:.8rem;font-weight:700;background:color-mix(in srgb,#FBBF24 18%,var(--panel));border:1px solid #FBBF24}
.fb-spin{display:inline-block;width:16px;height:16px;border-radius:50%;border:2px solid var(--line);border-top-color:var(--gold);animation:fb-rot .8s linear infinite;vertical-align:-3px}
.fb-note{margin:0;text-align:center;color:var(--muted);font-size:.8rem}
@keyframes fb-in{from{opacity:0;transform:translateY(12px)}}
@keyframes fb-flip{from{opacity:0;transform:rotateX(90deg)}}
@keyframes fb-pulse{50%{opacity:.55}}
@keyframes fb-bounce{0%,80%,100%{transform:translateY(0);opacity:.5}40%{transform:translateY(-7px);opacity:1}}
@keyframes fb-pop{from{opacity:0;transform:scale(.4)}60%{transform:scale(1.12)}}
@keyframes fb-rot{to{transform:rotate(360deg)}}
@media (max-width:380px){.fb-tile{width:38px;height:50px;font-size:1.5rem}.fb-code{gap:5px}.fb-av{width:52px;height:52px;font-size:1.8rem}.fb-input{font-size:1.6rem}}
html[data-motion=reduced] .fb *{animation:none!important;transition:none!important}
`;
  if (!document.getElementById("fb-css")) { const st = document.createElement("style"); st.id = "fb-css"; st.textContent = CSS; document.head.append(st); }

  // ---------- helpers ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const client = () => (window.Auth && Auth.client && Auth.client()) || null;
  const isAcct = () => !!(window.Auth && Auth.isAccount && Auth.isAccount());
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const DIFF = {
    easy:   { icon: "🌿", name: "Easy",   min: 12, line: "Plenty of time to think" },
    medium: { icon: "🔥", name: "Medium", min: 8,  line: "A balanced battle" },
    hard:   { icon: "⚡", name: "Hard",   min: 5,  line: "Fast and fierce" }
  };
  const ERR = {
    invalid_code: "Room codes have 6 letters and numbers.",
    not_found: "No room with that code. Check it and try again.",
    expired: "That room has expired. Ask your friend for a new code.",
    cancelled: "That room was cancelled by the host.",
    full: "That room already has two players.",
    started: "That battle has already started.",
    finished: "That battle is already over.",
    busy: "You're already in another battle.",
    throttled: "Slow down a little, then try again.",
    bad_id: "Couldn't verify your player identity. Reload the app and try again.",
    no_server: "Friend battles need the online server, which isn't connected in this version.",
    not_setup: "Friend Battle isn't set up on the server yet (the 006 database scripts haven't been run).",
    network: "Can't reach the server. Check your connection and try again.",
    try_again: "Couldn't make a room just now. Please try again.",
    error: "Something went wrong. Please try again."
  };

  // ---------- who am I (same guest identity as the leaderboard) ----------
  const ID_KEY = "wbid_lb_guest";
  const rnd = (n) => { const a = new Uint8Array(n); (window.crypto || window.msCrypto).getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, "0")).join(""); };
  const uuid = () => { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); const h = rnd(16); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(12, 15)}-a${h.slice(15, 18)}-${h.slice(18, 30)}`; };
  function guestId() {
    let g = null; try { g = JSON.parse(localStorage.getItem(ID_KEY)); } catch {}
    if (g && typeof g.pid === "string" && typeof g.secret === "string" && g.secret.length >= 24) return g;
    g = { pid: uuid(), secret: rnd(24), sent: false, merged: false };
    try { localStorage.setItem(ID_KEY, JSON.stringify(g)); } catch {}
    return g;
  }
  const idArgs = () => { if (isAcct()) return { p_pid: null, p_secret: null }; const g = guestId(); return { p_pid: g.pid, p_secret: g.secret }; };
  // Player is a global of store.js (not a property of window), so it is looked up by bare name
  const nameArgs = () => { const P = (typeof Player !== "undefined" && Player.data) || {}; return { p_username: P.username || null, p_avatar: P.avatar || "🦊" }; };

  // ---------- server calls ----------
  let offset = 0;                                   // server clock minus this device's clock (ms)
  const srvNow = () => Date.now() + offset;
  async function call(fn, args, withName) {
    const c = client(); if (!c) return { ok: false, reason: "no_server" };
    const t0 = Date.now();
    try {
      const { data, error } = await c.rpc(fn, { ...args, ...idArgs(), ...(withName ? nameArgs() : {}) });
      if (error) {
        const m = String(error.message || "");
        return { ok: false, reason: (error.code === "PGRST202" || /could not find the function|schema cache/i.test(m)) ? "not_setup" : "error", message: m };
      }
      if (!data) return { ok: false, reason: "error" };
      if (data.state && data.state.server_now_ms) offset = data.state.server_now_ms - (t0 + Date.now()) / 2;
      return data;
    } catch { return { ok: false, reason: "network" }; }
  }

  // ---------- state ----------
  let view = "landing";            // landing | friend | create | join | room
  let S = null;                    // the latest server view of my room: { room, players, me, ... }
  let err = "", errRoom = "", loadingDiff = "", joining = false, netBad = false, lastKey = "", lastSig = "";
  let pollT = 0, clockT = 0, chan = null, syncing = false, again = false, kickT = 0, active = false;
  const root = () => $("#fb-root");
  const title = (t) => { const el = $("#fb-title"); if (el) el.textContent = t; };
  const status = () => (S && S.room && S.room.status) || "";
  const myPlayer = () => (S && S.players || []).find((p) => p.is_me) || null;
  const oppPlayer = () => (S && S.players || []).find((p) => !p.is_me) || null;

  // ---------- views ----------
  function pcard(p, extra) {
    if (!p) return `<div class="fb-pc empty"><div class="fb-av" aria-hidden="true">?</div><b>Waiting…</b><small>for a friend</small></div>`;
    const conn = p.connection || "connected";
    const cl = conn === "connected" ? "Online" : conn === "reconnecting" ? "Reconnecting…" : conn === "left" ? "Left" : "Offline";
    return `<div class="fb-pc${p.ready ? " ready" : ""}"><div class="fb-av" aria-hidden="true">${esc(p.avatar)}</div>
      <b>${esc(p.username)}${p.is_me ? '<span class="fb-you">YOU</span>' : ""}</b>
      <small>${p.seat === 1 ? "Host" : "Guest"}</small>
      <span class="fb-st ${esc(conn)}"><i></i>${cl}</span>
      ${extra === "ready" ? `<span class="fb-rd">${p.ready ? "✓ Ready" : "Not ready"}</span>` : ""}</div>`;
  }
  function codeTiles(code) { return `<div class="fb-code" role="img" aria-label="Room code ${esc(code.split("").join(" "))}">${code.split("").map((ch) => `<span class="fb-tile" aria-hidden="true">${esc(ch)}</span>`).join("")}</div>`; }
  function diffChips(r) { const d = DIFF[r.difficulty] || DIFF.medium; return `<div class="fb-meta"><span class="fb-chip" style="--c:var(--gold)">${d.icon} ${d.name} · ${d.min} min</span><span class="fb-chip" id="fb-exp" style="--c:#38BDF8"></span></div>`; }

  function vLanding() {
    return `<div class="fb-hero"><h2>Choose your arena</h2><p>Pick how you want to battle.</p></div>
    <div class="fb-cards two">
      <button class="fb-card ai" type="button" disabled aria-disabled="true"><span class="fb-ico" aria-hidden="true">🤖</span><h3>AI Zone</h3><p>Face a smart computer opponent.</p><span class="fb-chip soon">Coming Soon</span></button>
      <button class="fb-card" type="button" data-fb="friend"><span class="fb-ico" aria-hidden="true">👥</span><h3>Friend Zone</h3><p>Create a private room or join a friend's battle.</p><span class="fb-go">Enter →</span></button>
    </div>`;
  }
  function vFriend() {
    return `<div class="fb-hero"><h2>Friend Zone</h2><p>Battle a friend in a private room.</p></div>
    <div class="fb-cards two">
      <button class="fb-card create" type="button" data-fb="create"><span class="fb-ico" aria-hidden="true">➕</span><h3>Create a Room</h3><p>Pick a difficulty and get a code to share.</p><span class="fb-go">Create →</span></button>
      <button class="fb-card join" type="button" data-fb="join"><span class="fb-ico" aria-hidden="true">🔑</span><h3>Enter a Room</h3><p>Have a code? Jump into your friend's battle.</p><span class="fb-go">Join →</span></button>
    </div>
    <p class="fb-err" role="alert" id="fb-err">${esc(err)}</p>`;
  }
  function vCreate() {
    return `<div class="fb-hero"><h2>Pick a difficulty</h2><p>Same word for both players. First to solve it wins.</p></div>
    <div class="fb-cards">${Object.entries(DIFF).map(([k, d]) => `
      <button class="fb-card fb-diff ${k}${loadingDiff === k ? " loading" : ""}" type="button" data-fb="pick" data-diff="${k}"${loadingDiff ? " disabled" : ""}>
        <span class="fb-ico" aria-hidden="true">${d.icon}</span><div><h3>${d.name}</h3><p>${d.line}</p></div>
        <span class="t">${loadingDiff === k ? '<span class="fb-spin" aria-label="Creating room"></span>' : d.min + "<small>minutes</small>"}</span></button>`).join("")}</div>
    <p class="fb-err" role="alert" id="fb-err">${esc(err)}${errRoom ? `<br><button class="primary alt" type="button" data-fb="resume" data-room="${esc(errRoom)}">Return to my room</button>` : ""}</p>`;
  }
  function vJoin() {
    return `<div class="fb-hero"><h2>Enter a Room</h2><p>Type the 6-character code from your friend.</p></div>
    <div class="fb-box"><input id="fb-code" class="fb-input" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" maxlength="7" placeholder="CODE" aria-label="Room code" aria-describedby="fb-err">
      <p class="fb-err" role="alert" id="fb-err">${esc(err)}${errRoom ? `<br><button class="primary alt" type="button" data-fb="resume" data-room="${esc(errRoom)}">Return to my room</button>` : ""}</p>
      <button class="primary" type="button" data-fb="joingo" id="fb-join" disabled>${joining ? '<span class="fb-spin"></span> Joining…' : "Join Room"}</button></div>`;
  }
  const banner = () => (netBad ? `<div class="fb-banner" role="status">Connection lost. Reconnecting…</div>` : "");
  function vRoom() {
    const r = S.room, me = myPlayer(), opp = oppPlayer(), st = r.status;
    if (st === "waiting") {
      return `${banner()}<div class="fb-box"><p class="lbl">Room code</p>${codeTiles(r.code)}${diffChips(r)}
        <div class="fb-row"><button class="primary" type="button" data-fb="copy">📋 Copy Code</button><button class="primary alt" type="button" data-fb="share">📤 Share Invitation</button></div></div>
      <div class="fb-players">${pcard(me)}<span class="fb-vs">VS</span>${pcard(null)}</div>
      <div class="fb-wait" role="status" aria-live="polite"><span class="fb-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>Waiting for another player to join the battle...</span></div>
      <button class="primary alt" type="button" data-fb="leave">Cancel Room</button>`;
    }
    if (st === "lobby") {
      const meReady = !!(me && me.ready), oppReady = !!(opp && opp.ready);
      const hint = meReady ? (oppReady ? "Starting…" : `Waiting for ${esc(opp ? opp.username : "your opponent")} to get ready…`) : "Press Ready when you're set.";
      return `${banner()}<div class="fb-box"><p class="lbl">Battle lobby</p>${diffChips(r)}<div class="fb-meta"><span class="fb-chip" style="--c:#8b8b92">Room ${esc(r.code)}</span></div></div>
      <div class="fb-players">${pcard(me, "ready")}<span class="fb-vs">VS</span>${pcard(opp, "ready")}</div>
      <p class="fb-wait" role="status" aria-live="polite">${hint}</p>
      <div class="fb-row"><button class="primary${meReady ? " alt" : ""}" type="button" data-fb="ready">${meReady ? "Not Ready" : "✔ I'm Ready"}</button><button class="primary alt" type="button" data-fb="leave">Leave Room</button></div>`;
    }
    if (st === "playing") {
      const left = r.started_at_ms - srvNow();
      return `${banner()}<div class="fb-players">${pcard(me)}<span class="fb-vs">VS</span>${pcard(opp)}</div>
      <div class="fb-box fb-count" role="status" aria-live="polite"><p class="lbl" id="fb-cl">${left > 0 ? "Battle starts in" : "Battle started"}</p><div class="n" id="fb-cn">${left > 0 ? Math.ceil(left / 1000) : "⚔️"}</div>
        <p class="fb-note" id="fb-cnote">${left > 0 ? "Get ready!" : "The battle screen arrives in the next update. Leave to end this test room."}</p></div>
      <button class="primary alt" type="button" data-fb="leave">Leave Battle</button>`;
    }
    const msg = st === "cancelled" ? "The host cancelled this room." : st === "expired" ? "This room expired." : "This battle is over.";
    return `<div class="fb-box"><p class="lbl">Room closed</p><p>${msg}</p><button class="primary" type="button" data-fb="done">Back to Battle</button></div>`;
  }

  function render(force) {
    const el = root(); if (!el || !active) return;
    let html, t;
    if (view === "room" && S) { html = vRoom(); t = status() === "lobby" ? "Battle Lobby" : status() === "playing" ? "Battle" : "Waiting Room"; }
    else if (view === "friend") { html = vFriend(); t = "Friend Zone"; }
    else if (view === "create") { html = vCreate(); t = "Create Room"; }
    else if (view === "join") { html = vJoin(); t = "Join Room"; }
    else { html = vLanding(); t = "Battle Online"; view = "landing"; }
    title(t);
    const key = view + ":" + (S ? status() : "");
    const fresh = key !== lastKey; lastKey = key;
    const keepInput = view === "join" && el.querySelector("#fb-code") ? el.querySelector("#fb-code").value : null;
    el.innerHTML = `<div class="fb-view${fresh || force ? " fresh" : ""}">${html}</div>`;
    if (view === "join") { const inp = el.querySelector("#fb-code"); if (inp) { if (keepInput) inp.value = keepInput; updJoinBtn(); if (fresh) inp.focus({ preventScroll: true }); } }
    clock();
  }
  const sigOf = () => !S ? "" : JSON.stringify([S.room.status, S.room.version, S.players.map((p) => [p.id, p.ready, p.connection, p.username])]);
  function updJoinBtn() { const i = $("#fb-code"), b = $("#fb-join"); if (i && b) b.disabled = joining || i.value.length !== 6; }

  // ---------- small timers that touch the page in place (no re-render) ----------
  function clock() {
    if (!active || !S) return;
    const exp = $("#fb-exp"); if (exp) { const left = S.room.expires_at_ms - srvNow(); exp.textContent = left > 0 ? "Room open " + mmss(left) : "Expiring…"; }
    if (status() === "playing") {
      const left = S.room.started_at_ms - srvNow(), n = $("#fb-cn"), l = $("#fb-cl"), note = $("#fb-cnote");
      if (n) { if (left > 0) { const v = String(Math.ceil(left / 1000)); if (n.textContent !== v) { n.textContent = v; n.style.animation = "none"; void n.offsetWidth; n.style.animation = ""; } } else if (n.textContent !== "⚔️") { n.textContent = "⚔️"; if (l) l.textContent = "Battle started"; if (note) note.textContent = "The battle screen arrives in the next update. Leave to end this test room."; } }
    }
  }

  // ---------- live updates ----------
  function watch(id) {
    unwatch(); const c = client(); if (!c || !c.channel) return;
    try { chan = c.channel("battle:" + id).on("broadcast", { event: "tick" }, () => kick()).subscribe(); } catch { chan = null; }
  }
  function unwatch() { if (chan) { try { const c = client(); if (c) c.removeChannel(chan); } catch {} chan = null; } }
  const kick = () => { clearTimeout(kickT); kickT = setTimeout(sync, 120); };
  function startLoops() { stopLoops(); pollT = setInterval(sync, POLL_MS); clockT = setInterval(clock, 500); }
  function stopLoops() { clearInterval(pollT); clearInterval(clockT); clearTimeout(kickT); pollT = clockT = kickT = 0; }
  async function sync() {
    if (!S || (!active && status() !== "playing")) return;     // keep checking in during a battle even if the player browses elsewhere
    if (syncing) { again = true; return; }
    syncing = true; const id = S.room.id;
    try {
      const r = await call("bt_sync", { p_room: id });
      if (!S || S.room.id !== id) return;
      if (r.ok) { if (netBad) { netBad = false; netBanner(false); } setState(r.state); }
      else if (r.reason === "forbidden") { toast("That room is no longer available.", "error"); if (window.BattleGame && BattleGame.isOn()) BattleGame.exit(false); drop(); }
      else if (!netBad) { netBad = true; if (window.BattleGame && BattleGame.isOn()) netBanner(true); else render(); }
    } finally { syncing = false; if (again) { again = false; sync(); } }
  }
  function setState(st) {
    const prev = S; S = st;
    const was = prev && prev.players ? prev.players.length : 0;
    if (prev && prev.room.id === st.room.id && was === 1 && st.players.length === 2) { const o = oppPlayer(); if (o) toast(`${o.username} joined the room`, "success"); }
    if (prev && prev.room.id === st.room.id && was === 2 && st.players.length === 1 && st.room.status === "waiting") toast("Your opponent left the room.", "");
    if (window.BattleGame && (st.room.status === "playing" || st.room.status === "finished")) { view = "room"; lastSig = sigOf(); BattleGame.update(st); return; }   // the battle screen takes over
    const sig = sigOf(); if (sig === lastSig && !netBad) { clock(); return; }
    lastSig = sig; view = "room"; render();
  }
  function netBanner(show) {
    let b = document.getElementById("bt-net");
    if (!show) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement("div"); b.id = "bt-net"; b.className = "bt-banner"; b.setAttribute("role", "status"); b.textContent = "Connection lost. Reconnecting…"; document.body.append(b); }
  }
  function enter(st) { S = null; lastSig = ""; netBad = false; setState(st); watch(st.room.id); startLoops(); }
  function end() { unwatch(); stopLoops(); S = null; lastSig = ""; lastKey = ""; netBad = false; netBanner(false); view = "landing"; }
  function drop() { unwatch(); stopLoops(); S = null; lastSig = ""; netBad = false; view = "landing"; render(); }

  // ---------- actions ----------
  const setErr = (reason, room) => { err = ERR[reason] || ERR.error; errRoom = room || ""; };
  async function createRoom(diff) {
    if (loadingDiff) return;
    loadingDiff = diff; err = ""; errRoom = ""; render();
    const r = await call("bt_create_room", { p_difficulty: diff }, true);
    loadingDiff = "";
    if (r.ok) { err = ""; enter(r.state); return; }
    if (r.reason === "already_in_room") { toast("Returning to your room", ""); return resume(r.room_id); }
    setErr(r.reason); render();
  }
  async function joinRoom() {
    const i = $("#fb-code"); if (!i || joining) return;
    const code = i.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (code.length !== 6) { err = ERR.invalid_code; errRoom = ""; render(); return; }
    joining = true; err = ""; errRoom = ""; const keep = code; render(); { const n = $("#fb-code"); if (n) n.value = keep; updJoinBtn(); }
    const r = await call("bt_join_room", { p_code: code }, true);
    joining = false;
    if (r.ok) { err = ""; enter(r.state); toast("Joined the room!", "success"); return; }
    setErr(r.reason, r.reason === "busy" ? r.room_id : ""); render(); { const n = $("#fb-code"); if (n) { n.value = keep; updJoinBtn(); n.focus({ preventScroll: true }); } }
  }
  async function resume(id) {
    const r = await call("bt_sync", { p_room: id });
    if (r.ok && ["waiting", "lobby", "playing"].includes(r.state.room.status)) { enter(r.state); return true; }
    err = ""; errRoom = ""; render(); return false;
  }
  async function toggleReady() {
    const me = myPlayer(); if (!me || !S) return;
    const r = await call("bt_ready", { p_room: S.room.id, p_ready: !me.ready });
    if (r.state) setState(r.state);
    if (!r.ok) { if (r.reason === "network" || r.reason === "error") toast("Couldn't update. Try again.", "error"); else sync(); }
  }
  async function leaveRoom(silent) {
    if (!S) return;
    const id = S.room.id, st = status(), host = (myPlayer() || {}).seat === 1;
    if (st === "playing" && !silent && !(await confirmBox("Leave the battle?", "Leaving counts as a forfeit and your opponent wins.", "Leave"))) return;
    const wasWaiting = st === "waiting";
    unwatch(); stopLoops(); S = null; lastSig = ""; netBad = false;
    if (!silent) { view = "landing"; render(); toast(wasWaiting || host ? "Room closed." : "You left the room.", ""); }
    await call("bt_leave", { p_room: id });
  }
  async function copyCode() { if (!S) return; toast((await copyText(S.room.code)) ? "Room code copied" : "Couldn't copy. Select the code and copy it.", "success"); }
  async function share() {
    if (!S) return;
    const code = S.room.code, d = DIFF[S.room.difficulty] || DIFF.medium, url = location.origin + location.pathname;
    const text = `Join my Wordle Battle! Room code: ${code} (${d.name}, ${d.min} min). Open ${url} → Play → Friend Zone → Enter a Room.`;
    if (navigator.share) { try { await navigator.share({ title: "Wordle Battle invitation", text }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    toast((await copyText(text)) ? "Invitation copied. Paste it in a chat." : "Couldn't copy the invitation.", "success");
  }
  function back() {
    err = ""; errRoom = "";
    if (view === "room") return leaveRoom();
    view = view === "create" || view === "join" ? "friend" : "landing"; render();
  }

  // ---------- wiring ----------
  document.addEventListener("click", (e) => {                                  // header Back steps back inside Battle first
    if (!active || !e.target.closest("#battle [data-back]")) return;
    if (view !== "landing") { e.stopPropagation(); e.preventDefault(); back(); }
  }, true);
  const rootEl = root();
  if (rootEl) {
    rootEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fb]"); if (!b || b.disabled) return;
      const a = b.dataset.fb;
      if (a === "friend") { view = "friend"; err = ""; render(); }
      else if (a === "create") { view = "create"; err = ""; errRoom = ""; render(); }
      else if (a === "join") { view = "join"; err = ""; errRoom = ""; render(); }
      else if (a === "pick") createRoom(b.dataset.diff);
      else if (a === "joingo") joinRoom();
      else if (a === "resume") resume(b.dataset.room);
      else if (a === "copy") copyCode();
      else if (a === "share") share();
      else if (a === "ready") toggleReady();
      else if (a === "leave") leaveRoom();
      else if (a === "done") { drop(); view = "friend"; render(); }
    });
    rootEl.addEventListener("input", (e) => {
      if (e.target.id !== "fb-code") return;
      e.target.value = e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
      if (err) { err = ""; errRoom = ""; const p = $("#fb-err"); if (p) p.textContent = ""; }
      updJoinBtn();
    });
    rootEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "fb-code" && !e.target.closest("button")) { e.preventDefault(); const b = $("#fb-join"); if (b && !b.disabled) joinRoom(); } });
  }
  addEventListener("online", () => { if (active && S) sync(); });
  document.addEventListener("visibilitychange", () => { if (active && S && document.visibilityState === "visible") sync(); });
  addEventListener("pagehide", () => { if (S && (status() === "waiting" || status() === "lobby")) { try { call("bt_leave", { p_room: S.room.id }); } catch {} } });

  // ---------- called by app.js when the Battle screen opens / closes ----------
  async function open() {
    active = true; err = ""; errRoom = ""; lastKey = "";
    if (S && status() === "playing" && window.BattleGame) { startLoops(); BattleGame.update(S); sync(); return; }
    if (S && ["waiting", "lobby", "playing"].includes(status())) { view = "room"; render(true); startLoops(); sync(); return; }
    view = "landing"; render(true);
    if (!client()) return;
    const g = await call("bt_get_active", {});                                  // refreshed or came back: go straight to my room
    if (!active || S) return;
    if (g.ok && g.active && g.active.room_id) resume(g.active.room_id);
  }
  function close() {
    active = false;
    if (!S) return;
    if (status() === "waiting" || status() === "lobby") leaveRoom(true);        // walking away from an unstarted room frees it
    else if (status() !== "playing") stopLoops();
  }
  function screenChanged(name) {
    if (name === "battle") open();
    else if (name === "game" && window.BattleGame && BattleGame.isOn()) return;   // the battle screen itself
    else close();
  }
  window.FriendBattle = { open, close, screenChanged, state: () => S, api: { call, srvNow, apply: setState, sync, end } };
})();