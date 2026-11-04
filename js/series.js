// Series Mode (Stages 1-2: entry button, Create / Join Series, lobby labels, rounds, between-round popup, final results) for Friend Zone and Team Zone.
// This file only DRAWS screens and sends taps. Every decision (valid settings, room code, capacity, expiry, already started,
// who may join, the round winner, the next word, the overall winner) is made by Supabase: supabase/migrations/014_series_mode.sql and
// 015_series_rounds.sql (series_create / series_join / series_info / series_sync).
// The lobby itself is the existing Friend Zone / Team Zone waiting room; this file adds the Series label chips to it.
(() => {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DIFF = { easy: { icon: "🌿", name: "Easy", min: 12 }, medium: { icon: "🔥", name: "Medium", min: 8 }, hard: { icon: "⚡", name: "Hard", min: 5 } };
  const ROUNDS = [3, 5, 10];
  const ERR = {
    invalid_code: "Room codes have 6 letters and numbers.", not_found: "No series room has that code. Check it and try again.",
    not_series: "That code is for a normal room. Use Enter a Room instead.", expired: "That series room has expired. Ask the host for a new code.",
    cancelled: "The host cancelled that series room.", full: "That series room is full.", started: "That series has already started, so you can't join it now.",
    finished: "That series is already over.", busy: "You're already in another battle. Finish or leave it first.",
    busy_friend: "You're in a Friend Zone battle right now. Finish or leave it first.", already_in_room: "You're already in a room. Finish or leave it first.",
    throttled: "Slow down a little, then try again.", bad_id: "Couldn't verify your player identity. Reload the app and try again.",
    bad_rounds: "Pick 3, 5 or 10 rounds.", bad_difficulty: "Pick a difficulty.", bad_size: "Pick 3, 4 or 5 players.",
    no_server: "Series Mode needs the online server, which isn't connected in this version.",
    not_setup: "Series Mode isn't set up on the server yet (run 014_series_mode.sql in Supabase).",
    network: "Can't reach the server. Check your connection and try again.", try_again: "Couldn't make a room just now. Please try again.", error: "Something went wrong. Please try again."
  };
  const errText = (r) => ERR[(r && r.reason) || "error"] || ERR.error;

  const CSS = `
.sr-entry{display:inline-flex;align-items:center;gap:10px;justify-self:center;max-width:100%;padding:7px 14px 7px 8px;border-radius:999px;cursor:pointer;color:var(--text);font:inherit;text-align:left;
  background:linear-gradient(135deg,color-mix(in srgb,var(--gold) 20%,var(--panel)),var(--panel));border:1.5px solid color-mix(in srgb,var(--gold) 60%,var(--line));
  box-shadow:0 0 0 1px color-mix(in srgb,var(--gold) 10%,transparent),0 4px 16px color-mix(in srgb,var(--gold) 16%,transparent);transition:transform .15s,box-shadow .2s,border-color .2s;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.sr-entry:hover{border-color:var(--gold);box-shadow:0 0 0 1px color-mix(in srgb,var(--gold) 30%,transparent),0 6px 22px color-mix(in srgb,var(--gold) 28%,transparent)}
.sr-entry:active{transform:scale(.97)}.sr-entry:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.sr-entry .ic{display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:50%;font-size:1rem;background:color-mix(in srgb,var(--gold) 24%,var(--panel-2));border:1px solid color-mix(in srgb,var(--gold) 50%,var(--line))}
.sr-entry .t{display:grid;gap:0;min-width:0}.sr-entry b{font-size:.84rem;letter-spacing:.4px}.sr-entry small{color:var(--muted);font-size:.68rem;font-weight:700}
.sr-entry .ch{color:var(--gold);font-weight:900;font-size:1.2rem;line-height:1}
.sr-entry-wrap{display:grid;justify-items:center;margin:2px 0 4px}
.sr-wrap{display:grid;gap:14px}
.sr-note{margin:0;padding:10px 12px;border-radius:14px;font-size:.84rem;font-weight:700;text-align:center;color:var(--muted);background:var(--panel-2);border:1px solid var(--line)}
.sr-note b{color:var(--text)}
.sr-chip{--c:var(--gold)}
@media (max-width:360px){.sr-entry small{display:none}}
html[data-motion=reduced] .sr-entry{transition:none!important}
`;
  if (!document.getElementById("sr-css")) { const st = document.createElement("style"); st.id = "sr-css"; st.textContent = CSS; document.head.append(st); }

  // ---------- state (one set per zone) ----------
  const Z = {
    friend: { cfg: { diff: "medium", rounds: 3, size: 2 }, code: "", busy: false, err: "" },
    team:   { cfg: { diff: "medium", rounds: 3, size: 4 }, code: "", busy: false, err: "" }
  };
  const info = new Map();           // room id -> series settings, or null for a normal room
  const asked = new Map();          // room id -> time of the last lookup (retry slowly when the network fails)

  // ---------- plumbing to the two zones ----------
  const call = (fn, args, withName) => { const fb = window.FriendBattle && FriendBattle.api; return fb && fb.call ? fb.call(fn, args || {}, !!withName) : Promise.resolve({ ok: false, reason: "no_server" }); };
  const zone = (ctx) => (ctx === "friend" ? window.FriendBattle && FriendBattle.api : window.TeamZone && TeamZone.api);
  const redraw = (ctx) => { const a = zone(ctx); if (!a) return; if (ctx === "friend") a.render && a.render(true); else a.repaint && a.repaint(); };
  const go = (ctx, v) => { const a = zone(ctx); if (a && a.setView) a.setView(v); };
  const isSeries = (v) => v === "series" || v === "sercfg" || v === "serjoin";

  // ---------- pieces other files call ----------
  function button(ctx) {
    return `<div class="sr-entry-wrap"><button class="sr-entry" type="button" data-sr="open" aria-label="Series Mode"><span class="ic" aria-hidden="true">🏆</span><span class="t"><b>Series Mode</b><small>Play 3, 5 or 10 rounds</small></span><span class="ch" aria-hidden="true">›</span></button></div>`;
  }
  function chips(ctx, room) {
    if (!room || !room.id) return "";
    if (info.has(room.id)) {
      const s = info.get(room.id); if (!s) return "";
      return ctx === "friend"
        ? `<span class="fb-chip sr-chip">🏆 Series Mode · ${s.total_rounds} rounds</span>`
        : `<span class="tz-chip sr-chip">🏆 Series Mode · ${s.total_rounds} rounds</span>`;
    }
    const last = asked.get(room.id) || 0;                      // not known yet (refresh, or an invitation): ask once, then redraw
    if (Date.now() - last > 8000) {
      asked.set(room.id, Date.now());
      call("series_info", { p_mode: ctx, p_room: room.id }).then((r) => { if (r && r.ok) { info.set(room.id, r.series || null); redraw(ctx); } });
    }
    return "";
  }
  function page(ctx, v) {
    const z = Z[ctx], hero = ctx === "friend" ? "fb-hero" : "tz-hero";
    if (v === "series") {
      return { title: "Series Mode", html: `<div class="sr-wrap"><div class="${hero}"><h2>Series Mode</h2><p>Several rounds, one winner. The player with the most round wins takes the series.</p></div>
        <div class="fb-cards two">
          <button class="fb-card create" type="button" data-sr="create"><span class="fb-ico" aria-hidden="true">➕</span><h3>Create Series</h3><p>Pick the difficulty and rounds, then invite players.</p><span class="fb-go">Create →</span></button>
          <button class="fb-card join" type="button" data-sr="join"><span class="fb-ico" aria-hidden="true">🔑</span><h3>Join Series</h3><p>Have a series code? Enter it to join.</p><span class="fb-go">Join →</span></button>
        </div></div>` };
    }
    if (v === "sercfg") {
      const d = DIFF[z.cfg.diff];
      const diff = Object.entries(DIFF).map(([k, x]) => `<button class="tz-opt diff ${k}${z.cfg.diff === k ? " on" : ""}" type="button" role="radio" aria-checked="${z.cfg.diff === k}" data-sr="diff" data-k="${k}"><span class="di" aria-hidden="true">${x.icon}</span><b>${x.name}</b><small>${x.min} min / round</small></button>`).join("");
      const rounds = ROUNDS.map((n) => `<button class="tz-opt${z.cfg.rounds === n ? " on" : ""}" type="button" role="radio" aria-checked="${z.cfg.rounds === n}" data-sr="rounds" data-n="${n}"><b>${n}</b><small>rounds</small></button>`).join("");
      const size = ctx === "team" ? `<section class="tz-sec"><h3>Maximum players</h3><div class="tz-opts" role="radiogroup" aria-label="Maximum players">${[3, 4, 5].map((n) => `<button class="tz-opt${z.cfg.size === n ? " on" : ""}" type="button" role="radio" aria-checked="${z.cfg.size === n}" data-sr="size" data-n="${n}"><b>${n}</b><small>players</small></button>`).join("")}</div></section>` : "";
      return { title: "Create Series", html: `<div class="sr-wrap"><div class="${hero}"><h2>Create Series</h2><p>${ctx === "friend" ? "You and one friend" : "You and your team"} play every round with the same difficulty.</p></div>
        <section class="tz-sec"><h3>Difficulty</h3><div class="tz-opts" role="radiogroup" aria-label="Difficulty">${diff}</div></section>
        <section class="tz-sec"><h3>Number of rounds</h3><div class="tz-opts" role="radiogroup" aria-label="Number of rounds">${rounds}</div></section>
        ${size}
        <p class="sr-note"><b>${z.cfg.rounds} rounds</b> · ${d.icon} <b>${d.name}</b> · ${d.min} min per round</p>
        ${z.err ? `<p class="tz-err" role="alert">${esc(z.err)}</p>` : ""}
        <div class="tz-row"><button class="tz-go alt" type="button" data-sr="back" data-v="${v}">Back</button><button class="tz-go" type="button" data-sr="create-go"${z.busy ? " disabled" : ""}>${z.busy ? "Creating…" : "Create Series"}</button></div></div>` };
    }
    // serjoin
    return { title: "Join Series", html: `<div class="sr-wrap"><div class="${hero}"><h2>Join Series</h2><p>Type the 6-character code from the host.</p></div>
      <section class="tz-sec"><input class="tz-input" id="sr-code" maxlength="8" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="ABC123" value="${esc(z.code)}" aria-label="Series room code"></section>
      ${z.err ? `<p class="tz-err" role="alert">${esc(z.err)}</p>` : ""}
      <div class="tz-row"><button class="tz-go alt" type="button" data-sr="back" data-v="${v}">Back</button><button class="tz-go" type="button" data-sr="join-go" id="sr-join-go"${z.busy || z.code.length !== 6 ? " disabled" : ""}>${z.busy ? "Joining…" : "Enter"}</button></div></div>` };
  }
  // Back inside Series screens: config / join -> Series home -> the zone's own home
  function back(ctx, v) {
    Z[ctx].err = "";
    go(ctx, v === "series" ? (ctx === "friend" ? "friend" : "home") : "series");
  }

  // ---------- actions ----------
  async function create(ctx) {
    const z = Z[ctx]; if (z.busy) return;
    z.busy = true; z.err = ""; redraw(ctx);
    const r = await call("series_create", { p_mode: ctx, p_difficulty: z.cfg.diff, p_rounds: z.cfg.rounds, p_max: ctx === "team" ? z.cfg.size : null }, true);
    z.busy = false;
    if (r.ok && r.state) { info.set(r.state.room.id, r.series || null); z.err = ""; enter(ctx, r.state); return; }
    z.err = errText(r); redraw(ctx);
  }
  async function join(ctx) {
    const z = Z[ctx]; if (z.busy || z.code.length !== 6) return;
    z.busy = true; z.err = ""; redraw(ctx);
    const r = await call("series_join", { p_mode: ctx, p_code: z.code }, true);
    z.busy = false;
    if (r.ok && r.state) { info.set(r.state.room.id, r.series || null); z.err = ""; z.code = ""; enter(ctx, r.state); return; }
    z.err = errText(r); redraw(ctx);
    const i = $("#sr-code"); if (i) { i.value = z.code; i.focus({ preventScroll: true }); }
  }
  function enter(ctx, state) {                                   // hand the room to the existing waiting lobby
    const a = zone(ctx); if (!a) return;
    if (ctx === "friend") a.enter(state); else a.apply(state, true);
  }

  // ---------- taps and typing (one listener per zone root) ----------
  function wire(rootId, ctx) {
    const el = document.getElementById(rootId); if (!el) return;
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sr]"); if (!b || b.disabled) return;
      const z = Z[ctx], a = b.dataset.sr;
      if (a === "open") { z.err = ""; go(ctx, "series"); }
      else if (a === "create") { z.err = ""; go(ctx, "sercfg"); }
      else if (a === "join") { z.err = ""; z.code = ""; go(ctx, "serjoin"); }
      else if (a === "back") back(ctx, b.dataset.v);
      else if (a === "diff") { z.cfg.diff = b.dataset.k; redraw(ctx); }
      else if (a === "rounds") { z.cfg.rounds = Number(b.dataset.n); redraw(ctx); }
      else if (a === "size") { z.cfg.size = Number(b.dataset.n); redraw(ctx); }
      else if (a === "create-go") create(ctx);
      else if (a === "join-go") join(ctx);
    });
    el.addEventListener("input", (e) => {
      if (e.target.id !== "sr-code") return;
      const z = Z[ctx];
      z.code = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); e.target.value = z.code;
      if (z.err) { z.err = ""; const p = el.querySelector(".tz-err"); if (p) p.remove(); }
      const g = $("#sr-join-go"); if (g) g.disabled = z.busy || z.code.length !== 6;
    });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "sr-code") { e.preventDefault(); join(ctx); } });
  }
  const boot = () => { wire("fb-root", "friend"); wire("tz-root", "team"); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();


  // ====================================================================== Stage 2: rounds, popup, results
  const mmss = (ms) => { const t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
  const av = (a) => (typeof Avatars !== "undefined" && Avatars.inner ? Avatars.inner(a) : esc(a || "🦊"));
  const CSS2 = `
.sr-sub{display:block;margin-top:2px;font-size:.62rem;font-weight:800;letter-spacing:1px;color:var(--muted);-webkit-text-fill-color:var(--muted);text-transform:uppercase}
.sr-ov{position:fixed;inset:0;z-index:95;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;
  padding:calc(16px + env(safe-area-inset-top,0px)) 14px calc(16px + env(safe-area-inset-bottom,0px));background:rgba(6,8,18,.82);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);animation:sr-fade .2s ease}
.sr-ov .sr-card{margin:auto;width:min(100%,440px);display:grid;gap:12px;justify-items:center;text-align:center;padding:20px 16px;border-radius:26px;color:var(--text);
  background:linear-gradient(170deg,color-mix(in srgb,var(--gold) 12%,var(--panel)),var(--panel) 45%);border:1.5px solid color-mix(in srgb,var(--gold) 55%,var(--line));
  box-shadow:0 20px 60px rgba(0,0,0,.5),0 0 0 1px color-mix(in srgb,var(--gold) 12%,transparent);animation:sr-pop .3s cubic-bezier(.2,.9,.3,1)}
.sr-tag{font-size:.78rem;font-weight:900;letter-spacing:2.2px;color:var(--gold)}
.sr-word{display:flex;gap:6px;justify-content:center;flex-wrap:nowrap}
.sr-word i{display:grid;place-items:center;width:clamp(38px,12vw,52px);aspect-ratio:1;border-radius:10px;font-style:normal;font-weight:900;font-size:clamp(1.3rem,6vw,1.8rem);color:#0b1a05;background:linear-gradient(180deg,#9BF55C,#5ED823);box-shadow:0 3px 0 #2B8512}
.sr-mean{margin:0;font-size:.92rem;line-height:1.45;color:var(--muted)}.sr-mean b{color:var(--text)}
.sr-win{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:18px;background:var(--panel-2);border:1px solid var(--line);max-width:100%}
.sr-win .a{display:grid;place-items:center;flex:none;width:44px;height:44px;border-radius:50%;font-size:1.5rem;overflow:hidden;background:var(--panel);border:2px solid var(--gold)}
.sr-win .n{display:grid;text-align:left;min-width:0}.sr-win small{font-size:.66rem;font-weight:800;letter-spacing:1.4px;color:var(--muted);text-transform:uppercase}
.sr-win b{font-size:1.05rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-win.draw{justify-content:center;font-weight:900;letter-spacing:1.5px}
.sr-cd{display:grid;gap:2px;justify-items:center}.sr-cd small{font-size:.74rem;font-weight:800;letter-spacing:1.2px;color:var(--muted);text-transform:uppercase}
.sr-cd b{font-size:2.6rem;line-height:1;font-variant-numeric:tabular-nums;color:var(--gold)}
.sr-btn{padding:11px 22px;border:0;border-radius:14px;cursor:pointer;font:inherit;font-weight:900;font-size:.95rem;color:#0b3a05;background:linear-gradient(180deg,#9BF55C,#5ED823);box-shadow:0 4px 0 #2B8512;touch-action:manipulation}
.sr-btn:active{transform:translateY(3px);box-shadow:0 1px 0 #2B8512}.sr-btn.alt{color:var(--text);background:var(--panel-2);box-shadow:0 4px 0 var(--line)}
.sr-fin .sr-card{gap:14px}
.sr-crown{font-size:2.6rem;line-height:1;filter:drop-shadow(0 0 14px color-mix(in srgb,var(--gold) 70%,transparent));animation:sr-float 2.4s ease-in-out infinite}
.sr-hd{margin:0;font-size:.8rem;font-weight:900;letter-spacing:2.4px;color:var(--gold)}
.sr-big{display:grid;place-items:center;width:84px;height:84px;border-radius:50%;font-size:2.8rem;overflow:hidden;background:var(--panel-2);border:3px solid var(--gold);box-shadow:0 0 28px color-mix(in srgb,var(--gold) 45%,transparent)}
.sr-nm{margin:0;font-size:1.35rem;font-weight:900;overflow-wrap:anywhere}.sr-sm{margin:0;color:var(--muted);font-size:.88rem;font-weight:700}
.sr-list{width:100%;display:grid;gap:6px;margin:0;padding:0;list-style:none;text-align:left}
.sr-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;border-radius:12px;font-size:.86rem;background:var(--panel-2);border:1px solid var(--line)}
.sr-list li span:first-child{color:var(--muted);font-weight:800;white-space:nowrap}.sr-list li b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.sr-sec{width:100%;margin:2px 0 -4px;text-align:left;font-size:.72rem;font-weight:900;letter-spacing:1.6px;color:var(--muted);text-transform:uppercase}
.sr-pl li .l{display:flex;align-items:center;gap:8px;min-width:0}.sr-pl li .l i{display:grid;place-items:center;flex:none;width:30px;height:30px;border-radius:50%;font-style:normal;overflow:hidden;background:var(--panel);border:1px solid var(--line)}
.sr-pl li .w{font-weight:900;color:var(--gold);white-space:nowrap}.sr-pl li.top{border-color:color-mix(in srgb,var(--gold) 60%,var(--line))}
@keyframes sr-fade{from{opacity:0}}@keyframes sr-pop{from{opacity:0;transform:translateY(14px) scale(.97)}}@keyframes sr-float{50%{transform:translateY(-4px)}}
html[data-motion=reduced] .sr-ov,html[data-motion=reduced] .sr-ov *{animation:none!important}
`;
  if (!document.getElementById("sr-css2")) { const st = document.createElement("style"); st.id = "sr-css2"; st.textContent = CSS2; document.head.append(st); }

  const D = { off: 0, data: null, busy: false, ack: new Set(), view: "", switching: false, lookup: new Map() };
  const srvNow = () => Date.now() + D.off;
  const stateOf = (ctx) => (ctx === "friend" ? window.FriendBattle && FriendBattle.state && FriendBattle.state() : window.TeamZone && TeamZone.state && TeamZone.state());
  const curCtx = () => { for (const c of ["friend", "team"]) { const st = stateOf(c); if (st && st.room) return c; } return ""; };

  // Used by battle-game.js / team-game.js: a series round must NOT show the normal battle result card or pay the normal reward.
  function owns(ctx, st) {
    if (!st || !st.room) return false;
    const id = st.room.id;
    if (info.has(id)) return !!info.get(id);
    ensureInfo(ctx, st.room);                                 // not known yet (refresh): hold the result back until the server says
    return true;
  }
  function ensureInfo(ctx, room) {
    const last = asked.get(room.id) || 0;
    if (Date.now() - last < 4000) return;
    asked.set(room.id, Date.now());
    call("series_info", { p_mode: ctx, p_room: room.id }).then((r) => {
      if (!r || !r.ok) return;
      info.set(room.id, r.series || null);
      if (!r.series) { const g = ctx === "friend" ? window.BattleGame : window.TeamGame; if (g && g.isOn && g.isOn()) g.update(); }   // a normal battle after all: let its own result show
    });
  }

  function paintHeader(ctx, r) {
    const h = document.querySelector(ctx === "friend" ? "#bt-top .bt-h" : "#tzg-top .tzg-h"); if (!h) return;
    const s = r.series, d = DIFF[s.difficulty] || DIFF.medium, key = s.current_round + ":" + s.total_rounds + ":" + s.difficulty;
    if (h.dataset.sr === key) return; h.dataset.sr = key;
    h.innerHTML = `ROUND ${s.current_round}<small class="sr-sub">${d.icon} ${d.name} · ${d.min} min · ${s.current_round} of ${s.total_rounds}</small>`;
  }

  async function switchRoom(ctx, id, sinfo) {
    if (D.switching) return; D.switching = true;
    try {
      info.set(id, sinfo);
      const r = await call(ctx === "friend" ? "bt_sync" : "tz_sync", { p_room: id });
      if (!r || !r.ok || !r.state) return;
      if (ctx === "friend") { if (window.BattleGame && BattleGame.isOn()) BattleGame.exit(false); FriendBattle.api.enter(r.state); }
      else TeamZone.api.apply(r.state, true);
    } finally { D.switching = false; }
  }

  async function tick() {
    if (D.busy) return;
    const ctx = curCtx(); if (!ctx) { hidePop(); return; }
    const st = stateOf(ctx), room = st.room;
    if (!["playing", "finished"].includes(room.status)) return;       // still in the lobby: nothing to run yet
    if (!info.has(room.id)) { ensureInfo(ctx, room); return; }
    const si = info.get(room.id); if (!si) return;                    // a normal battle
    D.busy = true;
    const t0 = Date.now(), r = await call("series_sync", { p_series: si.id });
    D.busy = false;
    if (!r || !r.ok) { if (r && r.reason === "forbidden") { D.data = null; hidePop(); } return; }
    if (r.lobby) return;
    D.off = r.server_now_ms - (t0 + Date.now()) / 2; D.data = r;
    if (r.room_id && r.room_id !== room.id) switchRoom(ctx, r.room_id, r.series);
    else info.set(room.id, r.series);
    paintHeader(ctx, r);
    paintOverlay(ctx);
  }
  setInterval(tick, 1000);

  // ---------- the between-round popup and the final screen ----------
  const popEl = () => document.getElementById("sr-pop"), finEl = () => document.getElementById("sr-fin");
  function hidePop() { const e = popEl(); if (e) e.remove(); const f = finEl(); if (f) f.remove(); D.view = ""; lock(false); }
  function lock(on) { try { document.body.classList.toggle("modal-open", !!on); } catch {} }
  function wordTiles(w) { return `<div class="sr-word" aria-label="${esc(w)}">${String(w || "").toUpperCase().split("").map((c) => `<i aria-hidden="true">${esc(c)}</i>`).join("")}</div>`; }

  function paintOverlay(ctx) {
    const r = D.data; if (!r) return;
    const lr = r.last_round, sid = r.series.id, over = r.overall;
    if (D.view === "final" && over) { drawFinal(ctx, r); return; }
    const counting = lr && lr.next_at_ms && srvNow() < lr.next_at_ms;
    const ending = lr && over && !D.ack.has(sid);
    if (counting || ending) drawPop(ctx, r); else if (popEl()) { popEl().remove(); lock(false); }
  }
  let popKey = "";
  function drawPop(ctx, r) {
    const lr = r.last_round, last = !lr.next_at_ms, key = lr.round_no + ":" + last;
    let el = popEl();
    if (!el || popKey !== key) {
      if (el) el.remove(); popKey = key;
      el = document.createElement("div"); el.id = "sr-pop"; el.className = "sr-ov"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", `Round ${lr.round_no} completed`);
      const win = lr.result === "win"
        ? `<div class="sr-win"><span class="a" aria-hidden="true">${av(lr.winner_avatar)}</span><span class="n"><small>Round Winner</small><b>${esc(lr.winner_name || "Player")}</b></span></div>`
        : `<div class="sr-win draw">🤝 ROUND DRAW</div>`;
      const meaning = lr.meaning ? `<p class="sr-mean"><b>Meaning:</b> ${esc(lr.meaning)}</p>` : "";
      const foot = last
        ? `<button class="sr-btn" type="button" id="sr-results">Go to Results</button>`
        : `<div class="sr-cd" role="timer" aria-live="off"><small>Next round starting in</small><b id="sr-n">5</b></div>`;
      el.innerHTML = `<div class="sr-card"><div class="sr-tag">ROUND ${lr.round_no} COMPLETED</div><p class="sr-sm" style="margin:-6px 0 0">Correct Word</p>${wordTiles(lr.word)}${meaning}${win}${foot}</div>`;
      document.body.append(el); lock(true);
      const b = el.querySelector("#sr-results"); if (b) { b.addEventListener("click", () => { D.ack.add(r.series.id); D.view = "final"; el.remove(); popKey = ""; drawFinal(ctx, D.data); }); b.focus({ preventScroll: true }); }
    }
    tickPop();
  }
  function tickPop() {
    const n = document.getElementById("sr-n"), r = D.data; if (!n || !r || !r.last_round || !r.last_round.next_at_ms) return;
    const left = r.last_round.next_at_ms - srvNow(); n.textContent = String(Math.max(0, Math.ceil(left / 1000)));
    if (left <= 0) { const e = popEl(); if (e) { e.remove(); lock(false); popKey = ""; } }
  }
  setInterval(tickPop, 200);

  function drawFinal(ctx, r) {
    const old = finEl(), pe = popEl(); if (pe) pe.remove();
    const players = r.players || [], rounds = r.rounds || [], o = r.overall || {}, top = Math.max(0, ...players.map((p) => p.wins));
    const sig = JSON.stringify([players, rounds, o]);
    if (old && old.dataset.sig === sig) return; if (old) old.remove();
    const winner = o.result === "win" ? players.find((p) => p.seat === o.winner_seat) : null;
    const tied = players.filter((p) => p.wins === top);
    const head = winner
      ? `<div class="sr-crown" aria-hidden="true">👑</div><p class="sr-hd">OVERALL SERIES WINNER</p><div class="sr-big" aria-hidden="true">${av(winner.avatar)}</div><p class="sr-nm">${esc(winner.username)}</p><p class="sr-sm">${winner.wins} ${winner.wins === 1 ? "round" : "rounds"} won</p>`
      : `<div class="sr-crown" aria-hidden="true">🤝</div><p class="sr-hd">OVERALL DRAW</p><p class="sr-nm">${top > 0 ? tied.map((p) => esc(p.username)).join(" & ") : "Nobody won a round"}</p><p class="sr-sm">${top > 0 ? `Level on ${top} ${top === 1 ? "round" : "rounds"} each` : "Every round was a draw"}</p>`;
    const rl = rounds.map((x) => `<li><span>Round ${x.round_no}</span><b>${x.result === "win" ? esc(x.winner_name || "Player") : "Round Draw"}</b></li>`).join("");
    const pl = players.map((p) => `<li class="${p.wins === top && top > 0 ? "top" : ""}"><span class="l"><i aria-hidden="true">${av(p.avatar)}</i><b>${esc(p.username)}${p.is_me ? " (you)" : ""}</b></span><span class="w">${p.wins}</span></li>`).join("");
    const el = document.createElement("div"); el.id = "sr-fin"; el.className = "sr-ov sr-fin"; el.dataset.sig = sig; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Series results");
    const note = o.end_reason === "players_left" ? `<p class="sr-sm">The series ended early because players left.</p>` : "";
    el.innerHTML = `<div class="sr-card">${head}${note}
      <p class="sr-sec">Round by round</p><ul class="sr-list">${rl}</ul>
      <p class="sr-sec">Rounds won</p><ul class="sr-list sr-pl">${pl}</ul>
      <button class="sr-btn alt" type="button" id="sr-leave">Back to ${ctx === "friend" ? "Battle" : "Team Zone"}</button></div>`;
    document.body.append(el); lock(true); D.view = "final";
    el.querySelector("#sr-leave").addEventListener("click", () => leaveSeries(ctx));
  }
  function leaveSeries(ctx) {
    hidePop(); D.data = null; popKey = "";
    if (ctx === "friend") { if (window.BattleGame && BattleGame.isOn()) BattleGame.exit(true); else { FriendBattle.api.end(); if (typeof show === "function") show("battle"); } }
    else { if (window.TeamGame && TeamGame.isOn()) TeamGame.exit(); TeamZone.api.finish(); }
  }

  window.Series = { is: isSeries, page, button, chips, back, owns, info: (id) => info.get(id) || null };
})();