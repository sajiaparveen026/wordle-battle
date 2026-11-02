// Team Zone: 3, 4 or 5 players in one private room. Stage 1 = landing, create, join by code, lobby, ready, host cancel.
// The page only draws what the server returns (supabase/migrations/009_team_zone.sql) and sends taps.
// It reuses Friend Zone's caller identity and call wrapper (FriendBattle.api), so guests and accounts behave the same.
(() => {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const POLL_MS = 3000;
  const DIFF = { easy: { icon: "🌿", name: "Easy", min: 12 }, medium: { icon: "🔥", name: "Medium", min: 8 }, hard: { icon: "⚡", name: "Hard", min: 5 } };
  const CSS = `
.tz{width:100%;display:grid;gap:14px;padding-bottom:90px;align-content:start;justify-items:stretch}
.tz-hero{text-align:center;display:grid;gap:4px;padding:6px 0 2px}
.tz-hero h2{margin:0;font-size:1.35rem;letter-spacing:.3px}
.tz-hero p{margin:0;color:var(--muted);font-size:.9rem;line-height:1.4}
.tz-cards{display:grid;gap:12px;grid-template-columns:1fr}
@media (min-width:640px){.tz-cards{grid-template-columns:1fr 1fr}}
.tz-card{position:relative;display:grid;gap:6px;justify-items:start;text-align:left;padding:18px;border-radius:20px;cursor:pointer;color:var(--text);font:inherit;
  background:linear-gradient(150deg,color-mix(in srgb,var(--c,#22D3EE) 20%,var(--panel)),var(--panel) 70%);border:1px solid color-mix(in srgb,var(--c,#22D3EE) 45%,var(--line));
  box-shadow:0 8px 22px rgba(0,0,0,.3),0 0 20px color-mix(in srgb,var(--c,#22D3EE) 18%,transparent);transition:transform .18s,box-shadow .2s}
.tz-card:hover{transform:translateY(-2px)}
.tz-card .ic{display:grid;place-items:center;width:52px;height:52px;border-radius:16px;font-size:1.7rem;background:color-mix(in srgb,var(--c,#22D3EE) 25%,var(--panel-2));border:1px solid color-mix(in srgb,var(--c,#22D3EE) 55%,var(--line))}
.tz-card h3{margin:4px 0 0;font-size:1.05rem}.tz-card p{margin:0;color:var(--muted);font-size:.84rem;line-height:1.35}
.tz-card .go{font-weight:900;color:var(--gold);font-size:.85rem}
.tz-card.wide{grid-column:1/-1}
.fb-cards.two .fb-card.wide{grid-column:1/-1}
.tz-sec{display:grid;gap:10px;padding:16px;border-radius:20px;background:var(--panel);border:1px solid var(--line)}
.tz-sec h3{margin:0;font-size:.78rem;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted)}
.tz-opts{display:grid;gap:8px;grid-template-columns:repeat(3,minmax(0,1fr))}
.tz-opt{display:grid;justify-items:center;gap:2px;padding:12px 6px;border-radius:16px;cursor:pointer;color:var(--text);font:inherit;background:var(--panel-2);border:2px solid var(--line);transition:border-color .15s,box-shadow .15s,transform .12s}
.tz-opt b{font-size:1.15rem;font-variant-numeric:tabular-nums}.tz-opt small{color:var(--muted);font-size:.72rem;font-weight:700}
.tz-opt.on{border-color:var(--gold);background:linear-gradient(160deg,color-mix(in srgb,var(--gold) 18%,var(--panel-2)),var(--panel-2));box-shadow:0 0 16px color-mix(in srgb,var(--gold) 30%,transparent)}
.tz-opt:active{transform:scale(.96)}
.tz-opt.diff.easy{--c:#4ADE80}.tz-opt.diff.medium{--c:#FB923C}.tz-opt.diff.hard{--c:#F87171}
.tz-opt.diff.on{border-color:var(--c)}
.tz-opt.diff .di{font-size:1.3rem}
.tz-input{width:100%;padding:14px;border-radius:14px;border:1px solid var(--line);background:var(--panel-2);color:var(--text);font:inherit;font-size:1.3rem;font-weight:900;letter-spacing:6px;text-align:center;text-transform:uppercase}
.tz-input:focus{outline:2px solid var(--gold);outline-offset:2px}
.tz-row{display:flex;gap:10px;flex-wrap:wrap}
.tz-row>*{flex:1 1 0;min-width:0}
.tz-err{margin:0;padding:10px 12px;border-radius:12px;font-size:.86rem;font-weight:700;text-align:center;color:var(--danger);background:color-mix(in srgb,var(--danger) 14%,var(--panel));border:1px solid color-mix(in srgb,var(--danger) 45%,transparent)}
.tz-codebox{display:grid;gap:10px;justify-items:center;padding:18px;border-radius:22px;text-align:center;background:linear-gradient(160deg,color-mix(in srgb,#22D3EE 14%,var(--panel)),var(--panel) 70%);border:1px solid color-mix(in srgb,#22D3EE 40%,var(--line));box-shadow:0 0 24px color-mix(in srgb,#22D3EE 14%,transparent)}
.tz-codebox small{color:var(--muted);font-size:.74rem;font-weight:800;letter-spacing:1.6px;text-transform:uppercase}
.tz-code{font-size:2.1rem;font-weight:900;letter-spacing:8px;font-variant-numeric:tabular-nums;padding-left:8px;text-shadow:0 0 18px color-mix(in srgb,#22D3EE 45%,transparent)}
.tz-meta{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.tz-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:999px;font-size:.76rem;font-weight:800;background:var(--panel-2);border:1px solid var(--line)}
.tz-count{font-size:1rem;font-weight:900;font-variant-numeric:tabular-nums}
.tz-status{text-align:center;color:var(--muted);font-size:.9rem;min-height:1.3em}
.tz-slots{display:grid;gap:10px;grid-template-columns:1fr}
@media (min-width:640px){.tz-slots{grid-template-columns:1fr 1fr}}
.tz-pl{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;padding:12px 14px;border-radius:18px;--c:#8b8b92;
  background:linear-gradient(160deg,color-mix(in srgb,var(--c) 12%,var(--panel)),var(--panel) 72%);border:1px solid color-mix(in srgb,var(--c) 40%,var(--line));animation:tz-in .35s ease both}
.tz-pl.ready{--c:#4ADE80}.tz-pl.me{box-shadow:0 0 0 1px color-mix(in srgb,var(--gold) 55%,transparent)}
.tz-pl.dc{--c:#F87171}
.tz-av{position:relative;display:grid;place-items:center;width:50px;height:50px;border-radius:50%;font-size:1.7rem;background:var(--panel-2);border:2px solid color-mix(in srgb,var(--c) 60%,var(--line))}
.tz-dot{position:absolute;right:-2px;bottom:-2px;width:14px;height:14px;border-radius:50%;background:#8b8b92;border:3px solid var(--panel)}
.tz-dot.connected{background:#4ADE80}.tz-dot.reconnecting{background:#FBBF24}.tz-dot.disconnected{background:#F87171}
.tz-info{display:grid;gap:3px;min-width:0}
.tz-nm{display:flex;align-items:center;gap:6px;min-width:0;font-weight:900;font-size:1rem}
.tz-nm span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tz-tag{flex:none;padding:2px 7px;border-radius:999px;font-size:.62rem;font-weight:900;letter-spacing:.8px;color:#2a1d00;background:linear-gradient(180deg,#FFE58A,#F5B90B)}
.tz-tag.you{color:var(--text);background:var(--panel-2);border:1px solid var(--line)}
.tz-st{font-size:.74rem;font-weight:800;color:var(--muted)}
.tz-pl.ready .tz-st{color:#4ADE80}
[data-theme=light] .tz-pl.ready .tz-st{color:#177a3c}
.tz-pl.dc .tz-st{color:#F87171}
.tz-empty{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:12px;padding:12px 14px;border-radius:18px;border:2px dashed var(--line);color:var(--muted);animation:tz-in .35s ease both}
.tz-empty .ph{display:grid;place-items:center;width:50px;height:50px;border-radius:50%;font-size:1.4rem;background:var(--panel-2);border:1px dashed var(--line);opacity:.8}
.tz-empty b{display:block;font-size:.92rem;color:var(--text)}.tz-empty small{font-size:.76rem}
.tz-sk{display:grid;gap:10px}.tz-sk i{display:block;height:80px;border-radius:18px;background:linear-gradient(90deg,var(--panel),var(--panel-2),var(--panel));background-size:200% 100%;border:1px solid var(--line);animation:tz-sh 1.3s linear infinite}
.tz-go{position:relative;width:100%;padding:16px;border:0;border-radius:18px;cursor:pointer;font:inherit;font-size:1.05rem;font-weight:900;color:#0b3a05;letter-spacing:.5px;background:linear-gradient(180deg,#9BF55C,#5ED823);box-shadow:0 6px 0 #2B8512,0 14px 24px rgba(70,210,25,.25),inset 0 2px 0 rgba(255,255,255,.55);transition:transform .1s,filter .2s}
.tz-go:active:not([disabled]){transform:translateY(4px);box-shadow:0 2px 0 #2B8512}
.tz-go[disabled]{opacity:.55;cursor:not-allowed}
.tz-go{white-space:nowrap}
.tz-codebox .tz-go{padding:12px 8px;font-size:.92rem}
.tz-go.alt{color:var(--text);background:var(--panel-2);box-shadow:0 4px 0 var(--line),inset 0 1px 0 rgba(255,255,255,.08)}
.tz-go.alt:active:not([disabled]){box-shadow:0 1px 0 var(--line)}
.tz-go.warn{color:#fff;background:linear-gradient(180deg,#F87171,#DC2626);box-shadow:0 6px 0 #991B1B}
.tz-msg{display:grid;gap:10px;justify-items:center;padding:26px 18px;text-align:center;border-radius:22px;background:var(--panel);border:1px dashed var(--line);color:var(--muted);font-size:.9rem;line-height:1.45}
.tz-msg .ic{font-size:2.4rem}.tz-msg h3{margin:0;color:var(--text);font-size:1.1rem}
.tz-flash{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:30;max-width:92%}
@media (min-width:700px){.tz{max-width:720px;margin:0 auto;gap:18px}.tz-code{font-size:2.6rem}.tz-pl{padding:16px 18px}.tz-av{width:60px;height:60px;font-size:2rem}}
@media (max-width:360px){.tz-opts{gap:6px}.tz-opt b{font-size:1rem}}
@keyframes tz-in{from{opacity:0;transform:translateY(8px)}}
@keyframes tz-sh{to{background-position:-200% 0}}
html[data-motion=reduced] .tz *,html[data-motion=reduced] .tz{animation:none!important;transition:none!important}
`;
  if (!document.getElementById("tz-css")) { const st = document.createElement("style"); st.id = "tz-css"; st.textContent = CSS; document.head.append(st); }

  // ---------- helpers ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const curScreen = () => (typeof screen === "string" ? screen : "");
  const say = (t, k, ms) => { if (typeof toast === "function") toast(t, k || "", ms); };
  const client = () => (window.Auth && Auth.client && Auth.client()) || null;
  const ERR = {
    not_found: "No room has that code. Check it and try again.", invalid_code: "Room codes are 6 letters and numbers.",
    full: "That room is full.", started: "That battle has already started.", finished: "That battle has already finished.",
    expired: "That room has expired. Ask the host for a new one.", cancelled: "The host cancelled that room.",
    busy: "You're already in another battle. Finish or leave it first.", busy_friend: "You're in a Friend Zone battle right now. Finish or leave it first.",
    already_in_room: "You're already in a Team Zone room.", throttled: "Slow down a little, then try again.",
    bad_size: "Pick 3, 4 or 5 players.", bad_difficulty: "Pick a difficulty.", bad_id: "Couldn't verify your player identity. Reload the app and try again.",
    forbidden: "You're no longer in this room.", not_in_lobby: "The battle has started. You can't leave the room now.",
    no_server: "Team Zone needs the online server, which isn't connected in this version.",
    not_setup: "Team Zone isn't set up on the server yet (run the 009_team_zone.sql script in Supabase).",
    network: "Can't reach the server. Check your connection and try again.", try_again: "Couldn't create the room. Please try again.", error: "Something went wrong. Please try again."
  };
  const errText = (r) => ERR[(r && r.reason) || "error"] || ERR.error;
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  // Friend Zone owns the caller identity and the server call wrapper; Team Zone uses the same ones.
  function call(fn, args, withName) {
    const fb = window.FriendBattle && FriendBattle.api;
    if (!fb || !fb.call) return Promise.resolve({ ok: false, reason: "no_server" });
    return fb.call(fn, args || {}, !!withName);
  }

  // ---------- state ----------
  let view = "home", err = "", S = null, roomId = "", busy = false, createSize = 4, createDiff = "medium", joinCode = "", pollT = 0, kickT = 0, chan = null, chanFor = "", lastSig = "", netBad = false;
  const srvNow = () => (S && S.server_now_ms ? S.server_now_ms + (Date.now() - gotAt) : Date.now());
  let gotAt = 0;

  // ---------- drawing ----------
  function root() { return $("#tz-root"); }
  function paint(force) {
    const el = root(); if (!el || curScreen() !== "team") return;
    const sig = JSON.stringify([view, err, busy, createSize, createDiff, joinCode, S && S.room, S && S.players, S && S.me, netBad]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    el.innerHTML = view === "create" ? vCreate() : view === "join" ? vJoin() : S && S.room ? vRoom() : vHome();
    tickClock();
    if (window.RoomInvite) RoomInvite.sync("team", S && S.room ? S.room.id : "", !!(S && S.room && S.room.status === "waiting" && S.me && S.me.is_host && (S.players || []).length < S.room.max_players));   // Invite Friends: only the host, only while there is a free seat
  }
  function vHome() {
    return `<div class="tz-hero"><h2 class="sr-only">Team Zone</h2><p>Compete with friends. One secret word. Only one winner!</p></div>
      <div class="fb-cards two">
        <button class="fb-card create" type="button" data-tz="create"><span class="fb-ico" aria-hidden="true">➕</span><h3>Create a Team Room</h3><p>Pick the group size and difficulty, then share the code.</p><span class="fb-go">Create →</span></button>
        <button class="fb-card join" type="button" data-tz="join"><span class="fb-ico" aria-hidden="true">🔑</span><h3>Enter a Room Code</h3><p>Have a code from a friend? Jump into their team.</p><span class="fb-go">Join →</span></button>
      </div>
      ${err ? `<p class="tz-err" role="alert">${esc(err)}</p>` : ""}`;
  }
  function vCreate() {
    const size = [3, 4, 5].map((n) => `<button class="tz-opt${createSize === n ? " on" : ""}" type="button" role="radio" aria-checked="${createSize === n}" data-tz="size" data-n="${n}"><b>${n}</b><small>players</small></button>`).join("");
    const diff = Object.entries(DIFF).map(([k, d]) => `<button class="tz-opt diff ${k}${createDiff === k ? " on" : ""}" type="button" role="radio" aria-checked="${createDiff === k}" data-tz="diff" data-k="${k}"><span class="di" aria-hidden="true">${d.icon}</span><b>${d.name}</b><small>${d.min} min</small></button>`).join("");
    return `<div class="tz-hero"><h2>Create a Team Room</h2><p>You'll get a code to share. The battle starts when everyone is in and ready.</p></div>
      <section class="tz-sec"><h3>Maximum players</h3><div class="tz-opts" role="radiogroup" aria-label="Maximum players">${size}</div></section>
      <section class="tz-sec"><h3>Difficulty</h3><div class="tz-opts" role="radiogroup" aria-label="Difficulty">${diff}</div></section>
      ${err ? `<p class="tz-err" role="alert">${esc(err)}</p>` : ""}
      <div class="tz-row"><button class="tz-go alt" type="button" data-tz="back">Back</button><button class="tz-go" type="button" data-tz="create-go"${busy ? " disabled" : ""}>${busy ? "Creating…" : "Create Room"}</button></div>`;
  }
  function vJoin() {
    return `<div class="tz-hero"><h2>Enter a Room Code</h2><p>Type the 6-character code your host shared.</p></div>
      <section class="tz-sec"><input class="tz-input" id="tz-code" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" value="${esc(joinCode)}" aria-label="Room code"></section>
      ${err ? `<p class="tz-err" role="alert">${esc(err)}</p>` : ""}
      <div class="tz-row"><button class="tz-go alt" type="button" data-tz="back">Back</button><button class="tz-go" type="button" data-tz="join-go" id="tz-join-go"${busy || joinCode.replace(/[^A-Za-z0-9]/g, "").length !== 6 ? " disabled" : ""}>${busy ? "Joining…" : "Join Room"}</button></div>`;
  }
  function playerCard(p) {
    const cls = ["tz-pl", p.ready ? "ready" : "", p.is_me ? "me" : "", p.connection === "disconnected" ? "dc" : ""].join(" ");
    const st = p.connection === "disconnected" ? "Disconnected" : p.connection === "reconnecting" ? "Reconnecting…" : p.ready ? "Ready" : "Not ready";
    return `<div class="${cls}" style="--i:${p.seat}">
      <span class="tz-av" aria-hidden="true">${esc(p.avatar)}<i class="tz-dot ${esc(p.connection)}"></i></span>
      <div class="tz-info"><span class="tz-nm"><span>${esc(p.username)}</span>${p.is_host ? '<i class="tz-tag">HOST</i>' : ""}${p.is_me ? '<i class="tz-tag you">YOU</i>' : ""}</span><span class="tz-st">${st}</span></div>
      <span aria-hidden="true">${p.ready ? "✅" : "⏳"}</span></div>`;
  }
  function vRoom() {
    const r = S.room, players = S.players || [], me = S.me || {}, d = DIFF[r.difficulty] || DIFF.medium;
    if (r.status === "playing") return vStarting();
    if (r.status !== "waiting") return vClosed(r.status);
    const slots = [];
    for (let i = 1; i <= r.max_players; i++) {
      const p = players.find((x) => x.seat === i);
      slots.push(p ? playerCard(p) : `<div class="tz-empty"><span class="ph" aria-hidden="true">＋</span><div><b>Open slot</b><small>Waiting for a player</small></div></div>`);
    }
    const full = players.length >= r.max_players, allReady = full && players.every((p) => p.ready && p.connection !== "disconnected");
    const mine = players.find((p) => p.is_me);
    const status = !full ? `Waiting for players… ${players.length}/${r.max_players} joined` : allReady ? "Everyone's ready. Starting…" : "Everyone's in. Press Ready when you're set.";
    const readyBtn = mine ? `<button class="tz-go${mine.ready ? " alt" : ""}" type="button" data-tz="ready" data-on="${mine.ready ? "0" : "1"}"${busy ? " disabled" : ""}>${mine.ready ? "Not Ready" : "✔ I'm Ready"}</button>` : "";
    const exit = me.is_host ? `<button class="tz-go warn" type="button" data-tz="leave" data-host="1"${busy ? " disabled" : ""}>Cancel Room</button>` : `<button class="tz-go alt" type="button" data-tz="leave"${busy ? " disabled" : ""}>Leave Room</button>`;
    return `<div class="tz-hero"><h2>Team Zone Lobby</h2><p>Share the code. Everyone in the room plays the same secret word.</p></div>
      <div class="tz-codebox"><small>Room code</small><span class="tz-code" aria-label="Room code ${esc(r.code.split("").join(" "))}">${esc(r.code)}</span>
        <div class="tz-meta"><span class="tz-chip">${d.icon} ${d.name} · ${d.min} min</span><span class="tz-chip">👥 Up to ${r.max_players}</span></div>
        <div class="tz-row" style="width:100%"><button class="tz-go alt" type="button" data-tz="copy">📋 Copy Code</button><button class="tz-go alt" type="button" data-tz="share">📤 Share</button></div></div>
      ${me.is_host && !full && window.RoomInvite ? RoomInvite.section("team", r.id) : ""}
      <div class="tz-count" aria-live="polite">${players.length} / ${r.max_players} players</div>
      <div class="tz-slots">${slots.join("")}</div>
      <p class="tz-status" role="status">${status}</p>
      ${err ? `<p class="tz-err" role="alert">${esc(err)}</p>` : ""}
      ${netBad ? `<p class="tz-status">Connection hiccup. Reconnecting…</p>` : ""}
      <div class="tz-row">${readyBtn}${exit}</div>`;
  }
  function vStarting() {
    const r = S.room, left = Number(r.started_at_ms) - srvNow();
    return `<div class="tz-msg"><span class="ic" aria-hidden="true">⚔️</span><h3>IT'S BATTLE TIME</h3><p>The battle starts in <b id="tz-cd">${mmss(Math.max(0, left))}</b>.</p><p>Get ready, your team battle is about to begin.</p></div>`;
  }
  function vClosed(status) {
    const msg = status === "cancelled" ? "The host cancelled this room." : status === "expired" ? "This room expired before everyone joined." : status === "finished" ? "This battle has finished." : "This room is no longer available.";
    return `<div class="tz-msg"><span class="ic" aria-hidden="true">🚪</span><h3>Room closed</h3><p>${esc(msg)}</p><button class="tz-go" type="button" data-tz="done">Back to Team Zone</button></div>`;
  }
  function tickClock() { const c = $("#tz-cd"); if (c && S && S.room) c.textContent = mmss(Math.max(0, Number(S.room.started_at_ms) - srvNow())); }
  setInterval(() => { tickClock(); if (S && S.room && S.room.status === "playing" && srvNow() > Number(S.room.ends_at_ms)) sync(); }, 1000);

  // ---------- server state ----------
  const dropped = new Set();                       // rooms I have left: a late reply for them must not bring me back
  function apply(state, fresh) {
    if (!state || !state.room) return;
    if (fresh) dropped.delete(state.room.id); else if (dropped.has(state.room.id)) return;   // a deliberate create / join clears the mark
    S = state; gotAt = Date.now(); netBad = false; err = ""; view = "room";
    if (state.room.id !== roomId) { roomId = state.room.id; watch(roomId); }
    if (!["waiting", "playing", "finished"].includes(state.room.status)) { clearInterval(pollT); pollT = 0; }   // cancelled / expired: stop; a finished battle keeps polling so rematch requests show
    if (window.TeamGame && ["playing", "finished"].includes(state.room.status) && state.room.started_at_ms) { TeamGame.update(state); return; }
    paint(true);
  }
  async function sync() {
    if (!roomId) return;
    const r = await call("tz_sync", { p_room: roomId });
    if (r.ok) return apply(r.state);
    if (r.reason === "network" || r.reason === "error") { netBad = true; paint(true); return; }
    leaveLocal(r.reason === "forbidden" ? "You're no longer in this room." : errText(r));
  }
  function leaveLocal(message) {
    if (roomId) dropped.add(roomId);
    unwatch(); clearInterval(pollT); pollT = 0; roomId = ""; S = null; view = "home"; err = message || ""; busy = false;
    if (window.TeamGame && TeamGame.isOn()) TeamGame.exit();
    paint(true);
  }

  function watch(id) {
    unwatch();
    const c = client(); clearInterval(pollT);
    if (c && c.channel) { try { chan = c.channel("team:" + id).on("broadcast", { event: "tick" }, () => { clearTimeout(kickT); kickT = setTimeout(sync, 150); }).subscribe(); chanFor = id; } catch { chan = null; } }
    pollT = setInterval(() => { if (!document.hidden) sync(); }, POLL_MS);
  }
  function unwatch() { const c = client(); if (chan && c) { try { c.removeChannel(chan); } catch {} } chan = null; chanFor = ""; }

  // ---------- actions ----------
  async function run(fn) {
    if (busy) return; busy = true; err = ""; paint(true);
    try { await fn(); } finally { busy = false; paint(true); }
  }
  const createRoom = () => run(async () => {
    const r = await call("tz_create", { p_difficulty: createDiff, p_max: createSize }, true);
    if (r.ok) { view = "room"; apply(r.state, true); return; }
    if (r.reason === "already_in_room" && r.room_id) { const s = await call("tz_sync", { p_room: r.room_id }); if (s.ok) { view = "room"; return apply(s.state); } }
    err = errText(r); view = "create";
  });
  const joinRoom = () => run(async () => {
    const code = joinCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const r = await call("tz_join", { p_code: code }, true);
    if (r.ok) { view = "room"; joinCode = ""; apply(r.state, true); return; }
    err = errText(r); view = "join";
  });
  const setReady = (on) => run(async () => {
    const r = await call("tz_ready", { p_room: roomId, p_ready: on });
    if (r.state) apply(r.state); else { err = errText(r); }
  });
  const leaveRoom = async () => {
    if (busy) return;
    const host = S && S.me && S.me.is_host;
    if (host) {
      const ok = typeof confirmBox === "function" ? await confirmBox("Cancel this room?", "Everyone in the room will be sent out and the code will stop working.", "Cancel Room") : true;
      if (!ok) return;
    }
    run(async () => {
      const r = await call("tz_leave", { p_room: roomId });
      if (r.ok) { say(host ? "Room cancelled" : "You left the room"); leaveLocal(""); } else { err = errText(r); await sync(); }
    });
  };
  function copyCode() {
    const code = S && S.room ? S.room.code : ""; if (!code) return;
    const done = () => say("Room code copied!", "success", 2400);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, () => say("Code: " + code, "", 4000));
    else say("Code: " + code, "", 4000);
  }
  async function shareCode() {
    const code = S && S.room ? S.room.code : ""; if (!code) return;
    const text = `Join my Team Zone room in Wordle Battle with code ${code}`;
    if (navigator.share) { try { await navigator.share({ title: "Wordle Battle Team Zone", text }); return; } catch { return; } }
    copyCode();
  }

  // ---------- taps and typing ----------
  function onClick(e) {
    const b = e.target.closest("[data-tz]"); if (!b || b.disabled) return;
    const a = b.dataset.tz;
    if (a === "create") { view = "create"; err = ""; paint(true); }
    else if (a === "join") { view = "join"; err = ""; paint(true); }
    else if (a === "back" || a === "done") { view = "home"; err = ""; if (a === "done") leaveLocal(""); paint(true); }
    else if (a === "size") { createSize = Number(b.dataset.n); paint(true); }
    else if (a === "diff") { createDiff = b.dataset.k; paint(true); }
    else if (a === "create-go") createRoom();
    else if (a === "join-go") joinRoom();
    else if (a === "ready") setReady(b.dataset.on === "1");
    else if (a === "leave") leaveRoom();
    else if (a === "copy") copyCode();
    else if (a === "share") shareCode();
  }
  function onInput(e) {
    if (e.target && e.target.id === "tz-code") {
      joinCode = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      e.target.value = joinCode;
      const go = $("#tz-join-go"); if (go) go.disabled = busy || joinCode.length !== 6;
    }
  }
  function onKey(e) { if (e.key === "Enter" && e.target && e.target.id === "tz-code" && joinCode.length === 6) { e.preventDefault(); joinRoom(); } }

  // ---------- screen lifecycle ----------
  let wired = false;
  function wire() {
    if (wired) return; wired = true;
    const el = root(); if (!el) return;
    el.addEventListener("click", onClick); el.addEventListener("input", onInput); el.addEventListener("keydown", onKey);
    // Back on Team Zone returns to the Battle hub, like Friend Zone (every other Back goes to the dashboard)
    document.addEventListener("click", (e) => {
      if (curScreen() !== "team" || !e.target.closest("#team [data-back]")) return;
      e.stopPropagation(); e.preventDefault(); if (view !== "home" && !S) { view = "home"; paint(true); return; }
      if (typeof show === "function") show("battle");
    }, true);
  }

  async function open() {
    wire();
    paint(true);                                               // draw the landing screen straight away, so the page is never blank while the server answers
    if (S) return;
    const slow = new Promise((res) => setTimeout(() => res({ ok: false, reason: "network" }), 6000));
    const g = await Promise.race([call("tz_get_active", {}), slow]);   // a stalled server can no longer hold the screen empty                  // resume a room I am still in, or a finished one whose reward I have not collected
    const id = g.ok ? (g.active && g.active.room_id) || g.unclaimed_room_id : "";
    if (id) { const s = await call("tz_sync", { p_room: id }); if (s.ok) return apply(s.state); }
    paint(true);
  }

  function screenChanged(name) {
    if (name === "team") { open(); return; }
  }

  // After a refresh or a reopened app: jump back into a battle in progress, or a finished one whose reward is not collected yet.
  async function autoReturn(n) {
    if (typeof screen !== "undefined" && screen !== "dashboard") { if (n < 4) setTimeout(() => autoReturn(n + 1), 1500); return; }
    if (!client()) { if (n < 4) setTimeout(() => autoReturn(n + 1), 1500); return; }   // connection not ready yet: try again shortly
    if (S) return;
    const g = await call("tz_get_active", {});
    if (!g.ok || S || (!(g.active && g.active.room_id) && !g.unclaimed_room_id)) return;
    if (typeof screen !== "undefined" && screen !== "dashboard") return;
    if (typeof show === "function") show("team");                    // open() resumes the room or the result
  }
  setTimeout(() => autoReturn(0), 3200);

  // Wire up once the screen exists (index.html has #team with #tz-root).
  function boot() { if (root()) { wire(); paint(true); } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  // Used by the battle screen (js/team-game.js)
  const api = {
    call: (fn, args) => call(fn, args, false),
    srvNow: () => (S && S.server_now_ms ? S.server_now_ms + (Date.now() - gotAt) : Date.now()),
    apply, sync,
    async leave(id) {                             // send the leave first, so "my room" can no longer find it
      if (id) dropped.add(id);
      unwatch(); clearInterval(pollT); pollT = 0;
      const r = await call("tz_leave", { p_room: id }, false);
      roomId = ""; S = null; view = "home"; err = ""; busy = false; paint(true);
      if (typeof show === "function") show("team");
      return r;
    },
    finish() { if (roomId) dropped.add(roomId); unwatch(); clearInterval(pollT); pollT = 0; roomId = ""; S = null; view = "home"; err = ""; busy = false; paint(true); if (typeof show === "function") show("team"); }
  };
  window.TeamZone = { screenChanged, open, state: () => S, api };
})();