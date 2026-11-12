// Shareable battle invitation links for Friend Zone and Team Zone.
//   SHARE:  the lobby's Share button opens a sheet with WhatsApp, Copy Link and (where the phone supports it) the native Share menu.
//           The link is  <this site's address>/join-battle/<token>  and is built from the address the app is running on (never a placeholder).
//   OPEN:   a link opens the app (or the web version), the token is kept safely until the player is signed in / has chosen guest,
//           then the invitation screen shows who invited them and lets them Join or Decline. No room code typing.
// Every decision (is the token real, expired, full, started, cancelled; who may join) is made by Supabase: 019_invite_links.sql.
// Joining goes through the same join functions as a room code, so capacity, "already in a battle" and race conditions behave the same.
(() => {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DIFF = { easy: { icon: "🌿", name: "Easy", min: 12 }, medium: { icon: "🔥", name: "Medium", min: 8 }, hard: { icon: "⚡", name: "Hard", min: 5 } };
  const MODE = { friend: "Friend Zone", team: "Team Zone" };
  const av = (a) => (typeof Avatars !== "undefined" && Avatars.inner ? Avatars.inner(a) : esc(a || "🦊"));
  const call = (fn, args, withName) => { const fb = window.FriendBattle && FriendBattle.api; return fb && fb.call ? fb.call(fn, args || {}, !!withName) : Promise.resolve({ ok: false, reason: "no_server" }); };

  // ---------- the link ----------
  const siteOrigin = () => (window.CONFIG && typeof CONFIG.SITE_URL === "string" && /^https:\/\/[^\s/]+$/i.test(CONFIG.SITE_URL.replace(/\/+$/, "")) ? CONFIG.SITE_URL.replace(/\/+$/, "") : location.origin);
  const buildLink = (token) => siteOrigin() + "/join-battle/" + token;
  const buildMessage = (mode, link, code) =>
    `You're invited to a Wordle Battle!\nJoin me in ${MODE[mode] || "Friend Zone"} and let's play!\nTap this link to join:\n${link}\nOr enter this room code manually: ${code}`;

  // ---------- keeping the invitation until we can use it ----------
  const PKEY = "wb_pending_invite";
  const clean = (t) => String(t || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  const readP = () => { try { const o = JSON.parse(localStorage.getItem(PKEY) || "null"); if (o && typeof o.t === "string" && o.t && Date.now() - o.at < 864e5) return o; } catch {} return null; };
  const writeP = (t) => { try { localStorage.setItem(PKEY, JSON.stringify({ t, at: Date.now() })); } catch {} };
  const clearP = () => { try { localStorage.removeItem(PKEY); } catch {} };
  function tokenFromUrl(href) {
    try {
      const u = new URL(href, location.href), q = u.searchParams.get("join"); if (q) return clean(q);
      const m = u.pathname.match(/\/join-battle\/([^/?#]+)/); return m ? clean(decodeURIComponent(m[1])) : "";
    } catch { return ""; }
  }
  function capture(href, stripAddress) {
    const t = tokenFromUrl(href); if (!t) return false;
    writeP(t);
    if (stripAddress) { try { const u = new URL(location.href); u.searchParams.delete("join"); if (/\/join-battle\//.test(u.pathname)) u.pathname = "/"; history.replaceState(history.state, "", u.pathname + u.search + u.hash); } catch {} }
    return true;
  }
  capture(location.href, true);                                          // a link was just opened in this page
  if ("launchQueue" in window && window.launchQueue && launchQueue.setConsumer) launchQueue.setConsumer((p) => { if (p && p.targetURL) capture(p.targetURL, false); });   // the installed app was already running

  // ---------- small UI helpers ----------
  const CSS = `
.iv-ov{position:fixed;inset:0;z-index:96;display:flex;align-items:flex-end;justify-content:center;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;
  padding:calc(12px + env(safe-area-inset-top,0px)) 12px calc(12px + env(safe-area-inset-bottom,0px));background:rgba(6,8,18,.78);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);animation:iv-fade .2s ease}
@media (min-width:600px){.iv-ov{align-items:center}}
.iv-card{position:relative;width:min(100%,430px);display:grid;gap:14px;justify-items:center;text-align:center;padding:22px 18px;border-radius:26px;color:var(--text);margin:auto 0;
  background:linear-gradient(170deg,color-mix(in srgb,var(--gold) 12%,var(--panel)),var(--panel) 45%);border:1.5px solid color-mix(in srgb,var(--gold) 55%,var(--line));
  box-shadow:0 20px 60px rgba(0,0,0,.5);animation:iv-pop .28s cubic-bezier(.2,.9,.3,1)}
@media (min-width:600px){.iv-card{margin:auto}}
.iv-tag{margin:0;font-size:.76rem;font-weight:900;letter-spacing:2.2px;color:var(--gold)}
.iv-card h3{margin:0;font-size:1.3rem}.iv-sub{margin:0;color:var(--muted);font-size:.88rem;font-weight:700;line-height:1.45}
.iv-x{position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:50%;border:1px solid var(--line);background:var(--panel-2);color:var(--text);font-size:1rem;cursor:pointer;display:grid;place-items:center}
.iv-host{display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:20px;background:var(--panel-2);border:1px solid var(--line);max-width:100%}
.iv-av{display:grid;place-items:center;flex:none;width:52px;height:52px;border-radius:50%;font-size:1.7rem;overflow:hidden;background:var(--panel);border:2px solid var(--gold)}
.iv-hn{display:grid;text-align:left;min-width:0}.iv-hn small{font-size:.66rem;font-weight:800;letter-spacing:1.4px;color:var(--muted);text-transform:uppercase}.iv-hn b{font-size:1.1rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iv-chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}.iv-chips span{padding:5px 11px;border-radius:999px;font-size:.78rem;font-weight:800;background:var(--panel-2);border:1px solid var(--line)}
.iv-slots{display:grid;gap:6px;justify-items:center}.iv-dots{display:flex;gap:7px}.iv-dots i{width:16px;height:16px;border-radius:50%;border:2px solid var(--line);background:transparent}
.iv-dots i.on{background:var(--gold);border-color:var(--gold)}.iv-slots small{font-size:.8rem;font-weight:800;color:var(--muted)}
.iv-ic{font-size:2.6rem;line-height:1}
.iv-btns{display:grid;gap:9px;width:100%}
.iv-btn{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;padding:12px 16px;border:0;border-radius:15px;cursor:pointer;font:inherit;font-weight:900;font-size:.98rem;color:#0b3a05;
  background:linear-gradient(180deg,#9BF55C,#5ED823);box-shadow:0 4px 0 #2B8512;touch-action:manipulation;text-decoration:none}
.iv-btn:active{transform:translateY(3px);box-shadow:0 1px 0 #2B8512}.iv-btn:focus-visible{outline:3px solid var(--gold);outline-offset:2px}.iv-btn:disabled{opacity:.6;cursor:default}
.iv-btn.alt{color:var(--text);background:var(--panel-2);box-shadow:0 4px 0 var(--line)}.iv-btn.wa{color:#fff;background:linear-gradient(180deg,#34D96B,#1FAF50);box-shadow:0 4px 0 #14793A}
.iv-btn svg{width:20px;height:20px;flex:none}
.iv-link{display:grid;gap:6px;width:100%;text-align:left}.iv-link small{font-size:.68rem;font-weight:900;letter-spacing:1.4px;color:var(--muted);text-transform:uppercase}
.iv-link input{width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--panel-2);color:var(--text);font:inherit;font-size:.82rem;text-overflow:ellipsis}
.iv-code{display:inline-flex;gap:8px;align-items:center;padding:6px 12px;border-radius:12px;background:var(--panel-2);border:1px solid var(--line);font-weight:800;font-size:.82rem;color:var(--muted)}.iv-code b{color:var(--text);letter-spacing:2px;font-size:1rem}
.iv-spin{width:30px;height:30px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--gold);animation:iv-rot .8s linear infinite}
.iv-toast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:97;max-width:90vw;padding:10px 16px;border-radius:14px;font-weight:800;font-size:.9rem;color:var(--text);background:var(--panel);border:1px solid color-mix(in srgb,var(--gold) 50%,var(--line));box-shadow:0 8px 24px rgba(0,0,0,.4);animation:iv-fade .2s}
@keyframes iv-fade{from{opacity:0}}@keyframes iv-pop{from{opacity:0;transform:translateY(14px) scale(.97)}}@keyframes iv-rot{to{transform:rotate(360deg)}}
html[data-motion=reduced] .iv-ov,html[data-motion=reduced] .iv-card,html[data-motion=reduced] .iv-spin,html[data-motion=reduced] .iv-toast{animation:none!important}
`;
  if (!document.getElementById("iv-css")) { const st = document.createElement("style"); st.id = "iv-css"; st.textContent = CSS; document.head.append(st); }
  let ov = null, onClose = null;
  function toast(t) { const e = document.createElement("div"); e.className = "iv-toast"; e.setAttribute("role", "status"); e.textContent = t; document.body.append(e); setTimeout(() => e.remove(), 2600); }
  function close() { if (ov) { ov.remove(); ov = null; } try { document.body.classList.remove("modal-open"); } catch {} const f = onClose; onClose = null; if (f) f(); }
  function open(html, opts) {
    if (ov) { ov.remove(); ov = null; }
    ov = document.createElement("div"); ov.className = "iv-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", (opts && opts.label) || "Battle invitation");
    ov.innerHTML = `<div class="iv-card">${html}</div>`;
    if (opts && opts.dismissable) { ov.addEventListener("click", (e) => { if (e.target === ov) close(); }); }
    document.body.append(ov); try { document.body.classList.add("modal-open"); } catch {}
    const f = ov.querySelector("[data-iv]:not([disabled])"); if (f) f.focus({ preventScroll: true });
    return ov;
  }
  async function copyText(t) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(t); return true; } } catch {}
    try { const a = document.createElement("textarea"); a.value = t; a.setAttribute("readonly", ""); a.style.cssText = "position:fixed;opacity:0;top:0;left:0"; document.body.append(a); a.select(); a.setSelectionRange(0, t.length); const ok = document.execCommand("copy"); a.remove(); return ok; } catch { return false; }
  }
  const WA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.200Zm4.500-6.100c-.2-.1-1.500-.7-1.700-.8s-.4-.1-.6.100-.6.8-.8 1-.3.2-.6.1a6.700 6.700 0 0 1-3.300-2.900c-.2-.4.300-.4.700-1.200.1-.2 0-.3 0-.5l-.8-1.900c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.200c0 1.300.9 2.500 1 2.700s1.800 2.800 4.400 3.900c1.600.7 2.200.7 3 .6.500-.1 1.500-.6 1.700-1.200s.2-1.100.2-1.200-.2-.2-.5-.3Z"/></svg>';
  const SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.600 13.500 6.800 4M15.400 6.500l-6.800 4"/></svg>';
  const COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.500"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';

  // ---------- SHARE (host) ----------
  async function share(ctx) {
    const st = ctx === "friend" ? window.FriendBattle && FriendBattle.state && FriendBattle.state() : window.TeamZone && TeamZone.state && TeamZone.state();
    const room = st && st.room; if (!room) return;
    const d = DIFF[room.difficulty] || DIFF.medium;
    open(`<button class="iv-x" type="button" data-iv="x" aria-label="Close">✕</button><div class="iv-spin" aria-hidden="true"></div><p class="iv-sub">Creating your invitation link…</p>`, { dismissable: true, label: "Invite friends" });
    bind(); const r = await call("inv_link", { p_mode: ctx, p_room: room.id });
    if (!ov) return;
    if (!r || !r.ok || !r.token) {
      const msg = r && r.reason === "closed" ? "This room is no longer open for invitations." : "Couldn't create the invitation link. You can still share the room code.";
      open(`<button class="iv-x" type="button" data-iv="x" aria-label="Close">✕</button><div class="iv-ic" aria-hidden="true">⚠️</div><h3>Link unavailable</h3><p class="iv-sub">${esc(msg)}</p>
        <div class="iv-code">Room code <b>${esc(room.code)}</b></div><div class="iv-btns"><button class="iv-btn" type="button" data-iv="copycode">${COPY} Copy Room Code</button></div>`, { dismissable: true, label: "Invite friends" });
      bind(); ov.dataset.code = room.code; return;
    }
    const link = buildLink(r.token), code = r.code || room.code, text = buildMessage(ctx, link, code), canShare = typeof navigator.share === "function";
    open(`<button class="iv-x" type="button" data-iv="x" aria-label="Close">✕</button>
      <p class="iv-tag">INVITE FRIENDS</p><h3>Share your battle</h3>
      <div class="iv-chips"><span>${ctx === "team" ? "👥" : "⚔️"} ${MODE[ctx]}</span><span>${d.icon} ${d.name} · ${d.min} min</span></div>
      <div class="iv-btns">
        <button class="iv-btn wa" type="button" data-iv="wa">${WA} Share on WhatsApp</button>
        <button class="iv-btn alt" type="button" data-iv="copy">${COPY} Copy Link</button>
        ${canShare ? `<button class="iv-btn alt" type="button" data-iv="native">${SHARE} Share…</button>` : ""}
      </div>
      <div class="iv-link"><small>Invitation link</small><input type="text" readonly value="${esc(link)}" aria-label="Invitation link" data-iv="sel"></div>
      <div class="iv-code" title="Backup if the link doesn't open">Room code <b>${esc(code)}</b></div>`, { dismissable: true, label: "Invite friends" });
    ov.dataset.link = link; ov.dataset.text = text; ov.dataset.code = code; bind();
  }
  function bind() {
    if (!ov) return; const el = ov;
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-iv]"); if (!b || !el.isConnected) return; const a = b.dataset.iv;
      if (a === "x") close();
      else if (a === "sel") b.select();
      else if (a === "wa") { const w = window.open("https://wa.me/?text=" + encodeURIComponent(el.dataset.text || ""), "_blank", "noopener"); if (!w) location.href = "https://wa.me/?text=" + encodeURIComponent(el.dataset.text || ""); }
      else if (a === "copy") toast((await copyText(el.dataset.link || "")) ? "Link copied" : "Couldn't copy. Select the link and copy it.");
      else if (a === "copycode") toast((await copyText(el.dataset.code || "")) ? "Room code copied" : "Couldn't copy the code.");
      else if (a === "native") { try { await navigator.share({ title: "Wordle Battle invitation", text: el.dataset.text || "" }); } catch (err) { if (!err || err.name !== "AbortError") toast("Couldn't open the share menu. Use Copy Link."); } }
    });
  }

  // ---------- OPEN (invited player) ----------
  const WHY = {
    invalid:   ["🔗", "This invitation link isn't valid", "It may have been copied incorrectly. Ask your friend to send it again."],
    expired:   ["⏰", "This invitation has expired", "Ask your friend to create a new room and send a new link."],
    full:      ["🚪", "This room is full", "All the spots in this battle are taken."],
    started:   ["🏁", "This battle has already started", "You can't join a battle that is already in progress."],
    finished:  ["🏁", "This battle is already over", "Ask your friend to start a new one."],
    cancelled: ["🚫", "This invitation is no longer available", "The host cancelled the room."],
    busy:      ["⚔️", "You're already in a battle", "Finish or leave your current battle, then open the link again."],
    busy_friend: ["⚔️", "You're in a Friend Zone battle", "Finish or leave it first, then open the link again."],
    no_server: ["📡", "Online battles need the server", "This version of the app isn't connected to one."],
    network:   ["📡", "Can't reach the server", "Check your connection and try again."]
  };
  const retryable = new Set(["busy", "busy_friend", "network", "throttled", "try_again", "error", "bad_id"]);
  function problem(reason, mode, token) {
    const w = WHY[reason] || ["⚠️", "Couldn't open this invitation", "Something went wrong. Please try again."];
    const again = retryable.has(reason) || !WHY[reason];
    if (!again) clearP();                                                  // a dead invitation is not kept
    open(`<div class="iv-ic" aria-hidden="true">${w[0]}</div><h3>${esc(w[1])}</h3><p class="iv-sub">${esc(w[2])}</p>
      <div class="iv-btns">${again ? `<button class="iv-btn" type="button" data-iv="retry">Try again</button>` : ""}<button class="iv-btn${again ? " alt" : ""}" type="button" data-iv="zone">Back to Battle Zone</button></div>`);
    ov.addEventListener("click", (e) => { const b = e.target.closest("[data-iv]"); if (!b) return;
      if (b.dataset.iv === "retry") showInvite(token); else if (b.dataset.iv === "zone") toZone(mode); });
  }
  function toZone(mode) {
    clearP(); close();
    if (typeof show !== "function") return;
    if (mode === "team") show("team"); else { show("battle"); try { FriendBattle.api.setView("friend"); } catch {} }
  }
  function enterLobby(r) {
    if (window.Series && Series.remember) Series.remember(r.state.room.id, r.series);
    if (r.mode === "friend") { FriendBattle.api.enter(r.state); if (typeof show === "function") show("battle"); }
    else { TeamZone.api.apply(r.state, true); if (typeof show === "function") show("team"); }
  }
  async function showInvite(token) {
    open(`<div class="iv-spin" aria-hidden="true"></div><p class="iv-sub">Opening your invitation…</p>`);
    try { if (window.Auth && Auth.whenReady) await Auth.whenReady(); } catch {}
    const r = await call("inv_preview", { p_token: token });
    if (!ov) return;
    if (!r || (!r.ok && !r.reason)) return problem("network", "", token);
    if (!r.ok) return problem(r.reason, r.mode, token);
    const d = DIFF[r.difficulty] || DIFF.medium, mode = r.mode, h = r.host || {}, taken = r.players | 0, max = r.max_players | 0, left = r.slots_left | 0;
    const dots = Array.from({ length: max }, (_, i) => `<i class="${i < taken ? "on" : ""}"></i>`).join("");
    open(`<p class="iv-tag">${r.member ? "YOUR BATTLE ROOM" : "YOU'RE INVITED"}</p><h3>${r.member ? "You're already in this room" : "Join the battle?"}</h3>
      <div class="iv-host"><span class="iv-av" aria-hidden="true">${av(h.avatar)}</span><span class="iv-hn"><small>Host</small><b>${esc(h.username || "A friend")}</b></span></div>
      <div class="iv-chips"><span>${mode === "team" ? "👥" : "⚔️"} ${MODE[mode]}</span><span>${d.icon} ${d.name} · ${d.min} min</span>${r.series ? `<span>🏆 Series · ${r.series.total_rounds} rounds</span>` : ""}</div>
      <div class="iv-slots" aria-label="${taken} of ${max} players"><div class="iv-dots" aria-hidden="true">${dots}</div><small>${taken} of ${max} players · ${left} ${left === 1 ? "slot" : "slots"} open</small></div>
      <div class="iv-btns"><button class="iv-btn" type="button" data-iv="join">${r.member ? "Open Lobby" : "Join Battle"}</button><button class="iv-btn alt" type="button" data-iv="decline">${r.member ? "Close" : "Decline"}</button></div>`, { label: "Battle invitation" });
    const el = ov;
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-iv]"); if (!b || b.disabled) return;
      if (b.dataset.iv === "decline") { clearP(); close(); if (!r.member) toast("Invitation declined"); }
      else if (b.dataset.iv === "join") {
        el.querySelectorAll("[data-iv]").forEach((x) => (x.disabled = true)); b.textContent = "Joining…";
        const j = await call("inv_join", { p_token: token }, true);
        if (j && j.ok && j.state) { clearP(); close(); enterLobby(j); return; }
        problem((j && j.reason) || "error", (j && j.mode) || mode, token);
      }
    });
  }

  // ---------- wait for the right moment (splash gone, signed in or guest, not mid-game), then show the invitation once ----------
  let showing = false;
  function ready() {
    const sp = $("#splash"); if (sp && !sp.classList.contains("out")) return false;
    if (typeof screen === "undefined" || typeof AUTH_SCREENS === "undefined") return false;
    if (AUTH_SCREENS.includes(screen) || screen === "game") return false;
    const tu = $("#tutorial"); if (tu && !tu.classList.contains("hidden")) return false;
    if ($("#modal:not(.hidden)") || $("#dialog:not(.hidden)") || $(".sr-ov") || document.body.classList.contains("sp-lock")) return false;
    return true;
  }
  function run() {
    if (showing || ov) return; const p = readP(); if (!p || !ready()) return;
    showing = true; onClose = () => { showing = false; };
    showInvite(p.t).catch(() => { problem("error", "", p.t); });
  }
  setInterval(run, 800); setTimeout(run, 300);

  window.InviteLink = { share, link: buildLink, message: buildMessage, pending: () => (readP() || {}).t || "", _tokenFromUrl: tokenFromUrl };
})();