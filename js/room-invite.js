// Invite Friends: the host of a WAITING lobby (Friend Zone or Team Zone) picks friends and sends them a live invitation.
// This file only DRAWS what the server returns and sends the host's taps. Every decision (is this the host, is there still
// a free seat, is this a friend, duplicates, expiry, seating the friend) is made by Supabase
// (supabase/migrations/012_room_invites.sql: ri_friends / ri_send / ri_cancel / ri_respond).
//  - Sending goes through the same notification system as friend requests; the friend sees it instantly (Friends banner + Alerts).
//  - Accepting happens in js/friends.js, which seats the friend in the same room (no code) via ri_respond.
//  - Live updates: js/friends.js fires "wb:social" whenever its realtime tick brings new data; this panel reloads on it.
(() => {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const say = (t, k, ms) => { if (typeof toast === "function") toast(t, k || "", ms); };
  const call = (fn, args) => { const fb = window.FriendBattle && FriendBattle.api; return fb && fb.call ? fb.call(fn, args || {}, false) : Promise.resolve({ ok: false, reason: "no_server" }); };

  const ERR = {
    full: "The room is full now, so no more invitations can be sent.",
    started: "The battle has already started.",
    closed: "This room is no longer open.",
    expired: "This invitation has expired.",
    cancelled: "The host withdrew this invitation.",
    not_pending: "This invitation was already answered.",
    not_friends: "You're not friends with this player any more.",
    in_room: "That friend is already in this room.",
    already_invited: "You already invited that friend.",
    declined: "That friend already declined this room's invitation.",
    friend_busy: "That friend is in another battle right now.",
    busy: "You're already in another battle. Finish or leave it first.",
    throttled: "Slow down a little, then try again.",
    forbidden: "Only the host of the room can invite friends.",
    not_found: "That room or invitation no longer exists.",
    bad_id: "Couldn't verify your player identity. Reload the app and try again.",
    no_server: "Inviting friends needs the online server, which isn't connected in this version.",
    not_setup: "Inviting friends isn't set up on the server yet (run 012_room_invites.sql in Supabase).",
    network: "Can't reach the server. Check your connection and try again.",
    error: "Something went wrong. Please try again."
  };
  const errText = (r) => ERR[(r && r.reason) || "error"] || ERR.error;

  const CSS = `
.ri-inv{display:block;width:100%}
.ri-open{position:relative;width:100%;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;padding:12px 14px;text-align:left;border-radius:18px;color:var(--text);
  background:linear-gradient(150deg,color-mix(in srgb,#4ADE80 16%,var(--panel)),var(--panel));border:1.5px solid color-mix(in srgb,#4ADE80 55%,var(--line));
  box-shadow:0 0 0 1px color-mix(in srgb,#4ADE80 10%,transparent),0 6px 22px color-mix(in srgb,#4ADE80 14%,transparent);transition:transform .15s,box-shadow .2s,border-color .2s;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.ri-open:hover{border-color:#4ADE80;box-shadow:0 0 0 1px color-mix(in srgb,#4ADE80 25%,transparent),0 8px 28px color-mix(in srgb,#4ADE80 24%,transparent)}
.ri-open:active{transform:scale(.985)}
.ri-open:focus-visible,.ri-btn:focus-visible,.ri-x:focus-visible,.ri-link:focus-visible{outline:3px solid #4ADE80;outline-offset:2px}
.ri-open .ri-ic{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;font-size:1.4rem;background:color-mix(in srgb,#4ADE80 20%,var(--panel-2));border:1px solid color-mix(in srgb,#4ADE80 45%,var(--line))}
.ri-open .ri-t{display:grid;gap:1px;min-width:0}.ri-open .ri-t b{font-size:1rem}.ri-open .ri-t small{color:var(--muted);font-size:.8rem;line-height:1.3}
.ri-open .ri-chev{font-size:1.5rem;color:#4ADE80;font-weight:900;line-height:1}

.ri-modal{position:fixed;inset:0;z-index:70;display:flex;align-items:flex-end;justify-content:center;background:rgba(6,8,18,.72);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:ri-fade .18s ease}
.ri-sheet{width:min(100%,520px);max-height:min(86vh,720px);display:flex;flex-direction:column;border-radius:24px 24px 0 0;padding:16px 14px calc(14px + env(safe-area-inset-bottom,0px));
  background:linear-gradient(180deg,color-mix(in srgb,#8b5cf6 10%,var(--panel)),var(--panel) 38%);border:1px solid color-mix(in srgb,#4ADE80 28%,var(--line));border-bottom:0;
  box-shadow:0 -10px 40px rgba(0,0,0,.45),0 0 0 1px color-mix(in srgb,#4ADE80 8%,transparent);animation:ri-up .26s cubic-bezier(.2,.9,.3,1)}
.ri-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:2px 2px 10px}
.ri-head h2{margin:0;font-size:1.25rem}.ri-sub{margin:2px 0 0;color:var(--muted);font-size:.86rem}
.ri-x{flex:none;width:38px;height:38px;border-radius:12px;background:var(--panel-2);border:1px solid var(--line);color:var(--muted);font-size:1rem}
.ri-body{overflow:auto;overscroll-behavior:contain;display:grid;gap:8px;padding:2px 2px 4px;-webkit-overflow-scrolling:touch}
.ri-warn{padding:10px 12px;border-radius:14px;font-size:.86rem;font-weight:700;text-align:center;background:color-mix(in srgb,#FACC15 14%,var(--panel-2));border:1px solid color-mix(in srgb,#FACC15 45%,var(--line))}
.ri-sec{margin:6px 2px 0;font-size:.72rem;font-weight:900;letter-spacing:1.4px;text-transform:uppercase;color:var(--muted)}
.ri-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.ri-card{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;padding:10px 12px;border-radius:18px;
  background:color-mix(in srgb,var(--panel-2) 62%,transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid color-mix(in srgb,#ffffff 9%,var(--line));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06);transition:border-color .2s,box-shadow .2s}
.ri-card.on{border-color:color-mix(in srgb,#4ADE80 38%,var(--line));box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 0 18px color-mix(in srgb,#4ADE80 10%,transparent)}
.ri-av{position:relative;display:grid;place-items:center;width:46px;height:46px;border-radius:50%;font-size:1.5rem;background:var(--panel);border:2px solid color-mix(in srgb,#8b5cf6 40%,var(--line))}
.ri-card.on .ri-av{border-color:#4ADE80}
.ri-av i{position:absolute;right:-1px;bottom:-1px;width:13px;height:13px;border-radius:50%;background:#6b7280;border:2px solid var(--panel)}
.ri-card.on .ri-av i{background:#4ADE80;box-shadow:0 0 8px #4ADE80}
.ri-info{display:grid;gap:1px;min-width:0}.ri-info b{font-size:.98rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ri-info small{color:var(--muted);font-size:.78rem}.ri-info small .st{font-weight:800}.ri-card.on .ri-info small .st{color:#4ADE80}
.ri-act{display:grid;justify-items:end;gap:2px}
.ri-btn{padding:8px 16px;border-radius:999px;font-size:.84rem;font-weight:900;letter-spacing:.3px;color:#052e16;background:#4ADE80;box-shadow:0 3px 0 color-mix(in srgb,#4ADE80 45%,#000);touch-action:manipulation;transition:transform .1s,box-shadow .1s}
.ri-btn:active:not(:disabled){transform:translateY(2px);box-shadow:0 1px 0 color-mix(in srgb,#4ADE80 45%,#000)}
.ri-btn:disabled{opacity:.5;box-shadow:none;cursor:default}
.ri-pill{display:inline-flex;align-items:center;gap:4px;padding:5px 11px;border-radius:999px;font-size:.72rem;font-weight:800;letter-spacing:.6px;text-transform:uppercase;white-space:nowrap;color:var(--text);background:var(--panel);border:1px solid var(--line)}
.ri-pill.ok{color:#4ADE80;border-color:color-mix(in srgb,#4ADE80 50%,var(--line));background:color-mix(in srgb,#4ADE80 12%,var(--panel))}
.ri-pill.no{color:#F87171;border-color:color-mix(in srgb,#F87171 45%,var(--line))}
.ri-link{font-size:.72rem;font-weight:800;color:var(--muted);text-decoration:underline;padding:2px 4px}
.ri-empty{display:grid;justify-items:center;gap:6px;padding:26px 12px;text-align:center;border-radius:18px;border:1px dashed var(--line);background:color-mix(in srgb,var(--panel-2) 50%,transparent)}
.ri-empty .ic{font-size:2rem;line-height:1}.ri-empty b{font-size:1.02rem}.ri-empty p{margin:0;max-width:32ch;color:var(--muted);font-size:.86rem;line-height:1.4}
.ri-sk{display:grid;gap:8px}.ri-sk i{height:66px;border-radius:18px;background:linear-gradient(90deg,var(--panel-2),color-mix(in srgb,var(--panel-2) 60%,var(--line)),var(--panel-2));background-size:200% 100%;animation:ri-sh 1.2s linear infinite}
@keyframes ri-fade{from{opacity:0}to{opacity:1}}@keyframes ri-up{from{transform:translateY(28px);opacity:.6}to{transform:none;opacity:1}}@keyframes ri-sh{to{background-position:-200% 0}}
@media (min-width:640px){.ri-modal{align-items:center}.ri-sheet{border-radius:24px;border-bottom:1px solid color-mix(in srgb,#4ADE80 28%,var(--line));padding-bottom:16px}}
html[data-motion=reduced] .ri-modal,html[data-motion=reduced] .ri-sheet,html[data-motion=reduced] .ri-sk i{animation:none}
`;
  if (!document.getElementById("ri-css")) { const st = document.createElement("style"); st.id = "ri-css"; st.textContent = CSS; document.head.append(st); }

  // ---------- the button the lobbies show ----------
  function section(mode, roomId) {
    if (!roomId) return "";
    return `<div class="ri-inv"><button class="ri-open" type="button" data-ri="open" data-mode="${esc(mode)}" data-room="${esc(roomId)}"><span class="ri-ic" aria-hidden="true">&#128101;</span><span class="ri-t"><b>Invite Friends</b><small>Send a direct invite. They join with one tap, no code needed.</small></span><span class="ri-chev" aria-hidden="true">&rsaquo;</span></button></div>`;
  }

  // ---------- the panel ----------
  let P = null;                 // { mode, room, data, err, loading, sending:Set, last }
  let pollT = 0, kickT = 0, prevFocus = null;

  function open(mode, room) {
    if (P || !mode || !room) return;
    prevFocus = document.activeElement;
    P = { mode, room, data: null, err: "", loading: true, sending: new Set(), canceling: new Set() };
    const el = document.createElement("div");
    el.id = "ri-modal"; el.className = "ri-modal"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "ri-title");
    el.innerHTML = `<div class="ri-sheet"><div class="ri-head"><div><h2 id="ri-title">Invite Friends</h2><p class="ri-sub" id="ri-sub"></p></div><button class="ri-x" type="button" data-ri="close" aria-label="Close">&#10005;</button></div><div class="ri-body" id="ri-body" aria-live="polite"></div></div>`;
    document.body.append(el);
    if (typeof lockModal === "function") lockModal(true);
    draw();
    load();
    pollT = setInterval(() => { if (!document.hidden) load(); }, 6000);
    const x = $("#ri-modal .ri-x"); if (x) x.focus({ preventScroll: true });
  }
  function close() {
    if (!P) return;
    clearInterval(pollT); clearTimeout(kickT); pollT = kickT = 0; P = null;
    const el = $("#ri-modal"); if (el) el.remove();
    if (typeof lockModal === "function") lockModal(false);
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) { try { prevFocus.focus({ preventScroll: true }); } catch {} }
    prevFocus = null;
  }

  async function load() {
    if (!P) return;
    const mine = P, r = await call("ri_friends", { p_mode: mine.mode, p_room: mine.room });
    if (P !== mine) return;
    mine.loading = false;
    if (r.ok) { mine.data = r; mine.err = ""; if (!r.open) mine.closed = true; }
    else if (r.reason === "forbidden" || r.reason === "not_found") { say(errText(r), "error", 3600); close(); return; }
    else mine.err = errText(r);
    draw();
  }
  const kick = () => { if (!P) return; clearTimeout(kickT); kickT = setTimeout(load, 200); };

  function stateBox(f) {
    const key = "s:" + f.fid;
    if (P.sending.has(key)) return `<button class="ri-btn" type="button" disabled>Sending&hellip;</button>`;
    switch (f.state) {
      case "invited": return `<span class="ri-pill ok">&#10003; Invited</span><button class="ri-link" type="button" data-ri="cancel" data-iid="${esc(f.iid)}"${P.canceling.has(f.iid) ? " disabled" : ""}>Cancel</button>`;
      case "declined": return `<span class="ri-pill no">Declined</span>`;
      case "in_room": return `<span class="ri-pill ok">In room</span>`;
      case "busy": return `<span class="ri-pill">In a battle</span>`;
      default: return `<button class="ri-btn" type="button" data-ri="send" data-fid="${esc(f.fid)}"${P.data && P.data.open ? "" : " disabled"}>Invite</button>`;
    }
  }
  function card(f) {
    const sub = f.state === "invited" ? `Pending reply` : f.online ? "Online" : "Offline";
    return `<li class="ri-card${f.online ? " on" : ""}"><span class="ri-av" aria-hidden="true">${Avatars.inner(f.avatar)}<i></i></span>
      <div class="ri-info"><b>${esc(f.name)}</b><small>Level ${Number(f.level) || 1} &middot; <span class="st">${sub}</span>${f.state === "invited" && f.online ? " &middot; Online" : ""}</small></div>
      <div class="ri-act">${stateBox(f)}</div></li>`;
  }
  function draw() {
    if (!P) return;
    const body = $("#ri-body"), sub = $("#ri-sub"); if (!body) return;
    const d = P.data;
    if (sub) {
      if (!d) sub.textContent = P.mode === "team" ? "Invite friends to your Team Zone room" : "Invite a friend to your battle";
      else if (P.mode === "team") { const left = Math.max(0, d.cap - d.count); sub.textContent = `${d.count} of ${d.cap} players joined \u00b7 ${left} ${left === 1 ? "spot" : "spots"} left`; }
      else sub.textContent = d.count >= 2 ? "Your friend joined. The room is full." : "Waiting for 1 more player";
    }
    let html = "";
    if (P.loading && !d) html = `<div class="ri-sk" aria-busy="true" aria-label="Loading friends"><i></i><i></i><i></i></div>`;
    else if (!d) html = `<div class="ri-empty"><span class="ic" aria-hidden="true">&#9888;&#65039;</span><b>Couldn't load your friends</b><p>${esc(P.err || ERR.error)}</p><button class="ri-btn" type="button" data-ri="retry">Try again</button></div>`;
    else {
      const fl = d.friends || [];
      if (!d.open) html += `<div class="ri-warn" role="status">${P.mode === "team" ? "The room is full, so invitations are closed." : "The room is full, so invitations are closed."}</div>`;
      else if (P.err) html += `<div class="ri-warn" role="status">${esc(P.err)}</div>`;
      if (!fl.length) html += `<div class="ri-empty"><span class="ic" aria-hidden="true">&#129309;</span><b>No friends yet</b><p>Add friends after a battle with the <b>+ Add Friend</b> button, or from the Friends page. You can still share the room code.</p></div>`;
      else {
        const on = fl.filter((f) => f.online), off = fl.filter((f) => !f.online);
        if (on.length) html += `<p class="ri-sec">Online &middot; ${on.length}</p><ul class="ri-list">${on.map(card).join("")}</ul>`;
        if (off.length) html += `<p class="ri-sec">Offline &middot; ${off.length}</p><ul class="ri-list">${off.map(card).join("")}</ul>`;
      }
    }
    const keep = body.scrollTop; body.innerHTML = html; body.scrollTop = keep;
  }

  async function send(fid) {
    if (!P || !P.data || !P.data.open) return;
    const mine = P, key = "s:" + fid; if (mine.sending.has(key)) return;
    mine.sending.add(key); draw();
    const r = await call("ri_send", { p_mode: mine.mode, p_room: mine.room, p_friendship: fid });
    mine.sending.delete(key);
    if (P !== mine) return;
    if (r.ok) { const f = (mine.data.friends || []).find((x) => x.fid === fid); if (f) { f.state = "invited"; f.iid = r.invite_id; } say("Invitation sent!", "success", 2200); }
    else { mine.err = errText(r); if (["full", "started", "closed"].includes(r.reason) && mine.data) mine.data.open = false; say(errText(r), "error", 3400); }
    draw(); load();
  }
  async function cancel(iid) {
    if (!P || P.canceling.has(iid)) return;
    const mine = P; mine.canceling.add(iid); draw();
    const r = await call("ri_cancel", { p_invite: iid });
    mine.canceling.delete(iid);
    if (P !== mine) return;
    if (!r.ok && r.reason !== "not_pending") say(errText(r), "error", 3200); else if (r.ok) say("Invitation withdrawn");
    draw(); load();
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ri]"); if (!b || b.disabled) { if (P && e.target.id === "ri-modal") close(); return; }
    const a = b.dataset.ri;
    if (a === "open") open(b.dataset.mode, b.dataset.room);
    else if (a === "close") close();
    else if (a === "send") send(b.dataset.fid);
    else if (a === "cancel") cancel(b.dataset.iid);
    else if (a === "retry") { P.loading = true; P.err = ""; draw(); load(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && P) { e.stopPropagation(); close(); } });
  document.addEventListener("wb:social", kick);          // friends.js: a live update arrived (someone accepted, declined, came online...)

  // The lobbies call this every time they draw: the panel closes itself as soon as the room can't take invitations any more.
  function sync(mode, room, eligible) {
    if (!P) return;
    if (P.mode !== mode || P.room !== room) { if (mode === P.mode) close(); return; }
    if (!eligible) { say(mode === "team" ? "The room is full or closed, so invitations are off." : "Your friend joined. Invitations are off.", "", 3000); close(); }
    else kick();
  }

  window.RoomInvite = { section, open, close, sync, errText, isOpen: () => !!P };
})();