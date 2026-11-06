// Series Mode (create / join, lobby, rounds, between-round popup, final results, rewards, Play Again, Series Stats & History) for Friend Zone and Team Zone.
// This file only DRAWS screens and sends taps. Every decision (valid settings, room code, capacity, expiry, already started,
// who may join, the round winner, the next word, the overall winner) is made by Supabase: supabase/migrations/014_series_mode.sql and
// 015_series_rounds.sql, 016_series_rewards.sql and 017_series_hardening.sql and 018_series_stats.sql (series_create / series_join / series_info / series_sync / series_claim / series_again).
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
  const isSeries = (v) => v === "series" || v === "sercfg" || v === "serjoin" || v === "serstats";

  // ---------- pieces other files call ----------
  function button(ctx) {
    return `<div class="sr-entry-wrap"><button class="sr-entry" type="button" data-sr="open" aria-label="Series Mode"><span class="ic" aria-hidden="true">🏆</span><span class="t"><b>Series Mode</b></span><span class="ch" aria-hidden="true">›</span></button></div>`;
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
    if (v === "serstats") return statsPage(ctx);
    if (v === "series") {
      return { title: "Friend Zone", html: `<div class="sr-wrap"><div class="ss-top">${statsButton()}</div><div class="${hero}"><h2>Series Mode</h2><p>Several rounds, one winner. The player with the most round wins takes the series.</p></div>
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
      return { title: "Friend Zone", html: `<div class="sr-wrap"><div class="${hero}"><h2>Create Series</h2><p>${ctx === "friend" ? "You and one friend" : "You and your team"} play every round with the same difficulty.</p></div>
        <section class="tz-sec"><h3>Difficulty</h3><div class="tz-opts" role="radiogroup" aria-label="Difficulty">${diff}</div></section>
        <section class="tz-sec"><h3>Number of rounds</h3><div class="tz-opts" role="radiogroup" aria-label="Number of rounds">${rounds}</div></section>
        ${size}
        <p class="sr-note"><b>${z.cfg.rounds} rounds</b> · ${d.icon} <b>${d.name}</b> · ${d.min} min per round</p>
        ${z.err ? `<p class="tz-err" role="alert">${esc(z.err)}</p>` : ""}
        <div class="tz-row"><button class="tz-go alt" type="button" data-sr="back" data-v="${v}">Back</button><button class="tz-go" type="button" data-sr="create-go"${z.busy ? " disabled" : ""}>${z.busy ? "Creating…" : "Create Series"}</button></div></div>` };
    }
    // serjoin
    return { title: "Friend Zone", html: `<div class="sr-wrap"><div class="${hero}"><h2>Join Series</h2><p>Type the 6-character code from the host.</p></div>
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
      else if (a === "stats") { SS.filter = "all"; SS.loading = true; SS.err = ""; go(ctx, "serstats"); loadHistory(ctx); }
      else if (a === "sfilter") { SS.filter = b.dataset.f; redraw(ctx); }
      else if (a === "sretry") { SS.loading = true; SS.err = ""; redraw(ctx); loadHistory(ctx); }
      else if (a === "scard") openDetail(ctx, b.dataset.id);
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
.sr-rw{width:100%;display:grid;gap:6px;justify-items:center}.sr-rw:empty{display:none}
.sr-rw .t{font-size:.7rem;font-weight:900;letter-spacing:1.6px;color:var(--muted);text-transform:uppercase}
.sr-chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.sr-chip2{display:inline-flex;align-items:baseline;gap:6px;padding:7px 12px;border-radius:14px;background:var(--panel-2);border:1px solid color-mix(in srgb,var(--gold) 45%,var(--line));font-weight:900}
.sr-chip2 b{font-size:1.15rem;font-variant-numeric:tabular-nums}.sr-chip2 small{color:var(--muted);font-weight:800;font-size:.72rem}
.sr-chip2.sr-xp{border-color:color-mix(in srgb,#8B5CF6 55%,var(--line))}.sr-bal{font-size:.78rem;color:var(--muted);font-weight:700}
.sr-tot{width:100%;display:grid;gap:8px;padding:12px;border-radius:18px;background:var(--panel-2);border:1px solid var(--line)}
.sr-tot .r{display:flex;justify-content:space-between;gap:10px;font-size:.84rem;color:var(--muted);font-weight:700}.sr-tot .r b{color:var(--text)}
.sr-tot .r.all{padding-top:8px;border-top:1px dashed var(--line);font-size:.95rem}.sr-tot .r.all b{color:var(--gold)}
.sr-nav{width:100%;display:flex;justify-content:center;gap:18px;margin-top:2px}
.sr-ni{display:grid;justify-items:center;gap:6px;min-width:64px;padding:0;border:0;background:none;cursor:pointer;color:var(--text);font:inherit;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.sr-ni .ic{display:grid;place-items:center;width:56px;height:56px;border-radius:19px;color:var(--gold);transition:transform .15s,box-shadow .2s,border-color .2s;
  background:linear-gradient(160deg,color-mix(in srgb,var(--gold) 16%,var(--panel-2)),var(--panel-2));border:1.5px solid color-mix(in srgb,var(--gold) 45%,var(--line));box-shadow:0 3px 0 var(--line)}
.sr-ni svg{width:27px;height:27px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.sr-ni small{font-size:.68rem;font-weight:800;letter-spacing:.8px;color:var(--muted);text-transform:uppercase}
.sr-ni:hover .ic{transform:translateY(-3px);border-color:var(--gold);box-shadow:0 6px 0 var(--line),0 8px 22px color-mix(in srgb,var(--gold) 28%,transparent)}
.sr-ni:active .ic{transform:translateY(1px);box-shadow:0 1px 0 var(--line)}.sr-ni:focus-visible .ic{outline:3px solid var(--gold);outline-offset:2px}
.sr-btn:disabled{opacity:.55;cursor:default}.sr-wait{margin:0;font-size:.82rem;font-weight:700;color:var(--muted)}.sr-err{margin:0;font-size:.82rem;font-weight:800;color:#F87171}
html[data-motion=reduced] .sr-ni .ic{transition:none!important}
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
    const ctx = curCtx();
    if (!ctx) {
      if (D.view === "final" && D.data && D.ctx) { await refreshFinal(); return; }     // the final screen was restored after a refresh: keep it up to date (Play Again)
      hidePop(); return;
    }
    D.ctx = ctx;
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
    if (r.pending_rewards > 0) claimNow(r.series.id, true);
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
      el.innerHTML = `<div class="sr-card"><div class="sr-tag">ROUND ${lr.round_no} COMPLETED</div><p class="sr-sm" style="margin:-6px 0 0">Correct Word</p>${wordTiles(lr.word)}${meaning}${win}<div class="sr-rw" id="sr-rw"></div>${foot}</div>`;
      document.body.append(el); lock(true);
      const b = el.querySelector("#sr-results"); if (b) { b.addEventListener("click", () => { D.ack.add(r.series.id); D.view = "final"; el.remove(); popKey = ""; drawFinal(ctx, D.data); }); b.focus({ preventScroll: true }); }
    }
    tickPop(); paintRw();
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
    const sig = JSON.stringify([players, rounds, o, r.rewards, r.again, r.is_host, D.againMsg || ""]);
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
      ${rewardSummary(r)}
      ${againBlock(r)}
      <div class="sr-nav" role="group" aria-label="Where to next">
        <button class="sr-ni" type="button" data-nav="dashboard" aria-label="Home"><span class="ic">${ICON.home}</span><small>Home</small></button>
        <button class="sr-ni" type="button" data-nav="shop" aria-label="Shop"><span class="ic">${ICON.shop}</span><small>Shop</small></button>
        <button class="sr-ni" type="button" data-nav="zone" aria-label="${ctx === "friend" ? "Friend Zone" : "Team Zone"}"><span class="ic">${ICON.zone}</span><small>${ctx === "friend" ? "Friend Zone" : "Team Zone"}</small></button>
      </div></div>`;
    document.body.append(el); lock(true); D.view = "final";
    el.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => exitTo(ctx, b.dataset.nav)));
    const pa = el.querySelector("#sr-again"); if (pa) pa.addEventListener("click", () => playAgain(ctx));
    if (!D.confettiFor || D.confettiFor !== r.series.id) { D.confettiFor = r.series.id; if (winner && winner.is_me) fx("confetti"); }
  }
  const ICON = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M5.5 9.8V19.5h13V9.8"/><path d="M10 19.5v-5h4v5"/></svg>',
    shop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.2 8.5h13.6l-1 11.2H6.2L5.2 8.5Z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/></svg>',
    zone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 6v5.6c0 4.4 3.1 7.7 7.5 9.4 4.4-1.7 7.5-5 7.5-9.4V6L12 3Z"/><path d="M12.8 8.2 9.8 12.6h4.4l-3 4.2"/></svg>'
  };
  // ---------- rewards ----------
  const fx = (n, ...a) => { try { if (typeof window[n] === "function") return window[n](...a); } catch {} };
  const sum = (rows) => rows.reduce((t, x) => ({ coins: t.coins + (x.coins | 0), xp: t.xp + (x.xp | 0) }), { coins: 0, xp: 0 });
  const myRows = (kind) => ((D.data && D.data.rewards) || []).filter((x) => x.kind === kind);
  // the round-win reward shown inside the between-round popup (credited the moment the round ended)
  function paintRw() {
    const box = document.getElementById("sr-rw"), r = D.data; if (!box || !r || !r.last_round) return;
    const row = myRows("round").find((x) => x.round_no === r.last_round.round_no);
    if (!row) { box.innerHTML = ""; return; }
    const key = r.series.id + ":" + row.round_no + ":" + row.coins; if (box.dataset.k === key) return; box.dataset.k = key;
    box.innerHTML = `<span class="t">Round win reward</span><div class="sr-chips"><span class="sr-chip2"><b id="sr-rc">+${row.coins}</b><small>🪙 Coins</small></span><span class="sr-chip2 sr-xp"><b>+${row.xp}</b><small>⚡ XP</small></span></div>`;
    fx("countUp", document.getElementById("sr-rc"), row.coins, "+");
  }
  function rewardSummary(r) {
    const rows = [...myRows("round"), ...myRows("overall")]; if (!rows.length) return "";
    const t = sum(rows);
    return `<div class="sr-tot" role="group" aria-label="Your rewards"><p class="sr-sec" style="margin:0">Your rewards</p>
      <div class="r all"><span>Total</span><b>+${t.coins} 🪙 · +${t.xp} XP</b></div></div>`;
  }
  // collect what the server says is now due. The server hands each reward out once; Player.rewardSeries also refuses a repeated key.
  async function claimNow(sid, animate) {
    if (D.claiming) return; D.claiming = true;
    try {
      const r = await call("series_claim", sid ? { p_series: sid } : {});
      if (!r || !r.ok || !(r.granted || []).length) return;
      let coins = 0, xp = 0, overall = false, up = false;
      for (const g of r.granted) {
        const k = g.series_id + ":" + g.kind + ":" + g.round_no;
        const res = typeof Player !== "undefined" && Player && typeof Player.rewardSeries === "function" ? Player.rewardSeries(k, g.coins, g.xp) : null;
        if (res) { coins += res.coins; xp += res.xp; if (g.kind === "overall") overall = true; if (res.levelUp) up = true; }
      }
      if (!coins && !xp) return;
      fx("refreshCoins");
      if (animate) {
        const src = document.getElementById("sr-rc") || document.querySelector("#sr-fin .sr-tot b");
        if (src) fx("coinsToBalance", src, coins);
        if (overall) fx("confetti");
        try { if (typeof sfx !== "undefined" && sfx.coin) sfx.coin(); } catch {}
      } else toast(`+${coins} 🪙  +${xp} XP from Series Mode${up ? " · Level up!" : ""}`);
    } finally { D.claiming = false; }
  }
  function toast(t) {
    const e = document.createElement("div"); e.className = "sr-ov"; e.style.cssText = "inset:auto 0 calc(20px + env(safe-area-inset-bottom,0px)) 0;background:none;backdrop-filter:none;-webkit-backdrop-filter:none;pointer-events:none;align-items:flex-end;overflow:visible;padding:0 14px";
    e.innerHTML = `<div class="sr-card" style="padding:10px 16px;width:auto;max-width:92%;font-weight:800;font-size:.9rem">${esc(t)}</div>`; document.body.append(e); setTimeout(() => e.remove(), 3500);
  }
  // ---------- after a refresh: bring the final result screen back (and anything unpaid) ----------
  const SEEN = "wb_series_seen";
  const seenList = () => { try { return JSON.parse(localStorage.getItem(SEEN) || "[]"); } catch { return []; } };
  function markSeen() {
    const id = D.data && D.data.series && D.data.series.id; if (!id) return;
    try { const a = seenList().filter((x) => x !== id); a.push(id); localStorage.setItem(SEEN, JSON.stringify(a.slice(-20))); } catch {}
  }
  async function refreshFinal() {
    if (Date.now() - (D.lastFinal || 0) < 2000 || D.busy) return; D.lastFinal = Date.now(); D.busy = true;
    const r = await call("series_sync", { p_series: D.data.series.id }); D.busy = false;
    if (!r) return;
    if (!r.ok) { if (r.reason === "forbidden") hidePop(); return; }
    if (r.lobby || !r.overall || D.view !== "final") return;
    D.data = r; drawFinal(D.ctx, r); if (r.pending_rewards > 0) claimNow(r.series.id, true);
  }
  setTimeout(async () => {
    if (curCtx() || D.data) return;
    const rc = await call("series_recent"); if (!rc || !rc.ok || !rc.series_id || seenList().includes(rc.series_id) || curCtx() || D.data) return;
    const v = await call("series_sync", { p_series: rc.series_id }); if (!v || !v.ok || v.lobby || !v.overall || curCtx() || D.data) return;
    D.ctx = rc.mode; D.data = v; D.view = "final"; drawFinal(rc.mode, v); if (v.pending_rewards > 0) claimNow(rc.series_id, true);
  }, 3500);
  setTimeout(() => claimNow(null, false), 6000);               // anything still unpaid from an earlier series (app closed before the final screen)

  // ---------- Play Again and leaving ----------
  function againBlock(r) {
    const msg = D.againMsg ? `<p class="sr-err" role="alert">${esc(D.againMsg)}</p>` : "";
    if (r.again) return `${msg}<button class="sr-btn" type="button" id="sr-again">${r.is_host ? "Open New Series Lobby" : "Join New Series"}</button>`;
    if (r.is_host) return `${msg}<button class="sr-btn" type="button" id="sr-again">🔁 Play Again</button>`;
    return `${msg}<button class="sr-btn" type="button" disabled>🔁 Play Again</button><p class="sr-wait">Waiting for the host to start a new series…</p>`;
  }
  function gotoLobby(ctx, state, sinfo) {
    markSeen(); info.set(state.room.id, sinfo || null); hidePop(); D.data = null; popKey = ""; D.againMsg = "";
    if (ctx === "friend") { if (window.BattleGame && BattleGame.isOn()) BattleGame.exit(false); FriendBattle.api.enter(state); if (typeof show === "function") show("battle"); }
    else { if (window.TeamGame && TeamGame.isOn()) TeamGame.exit(); TeamZone.api.apply(state, true); if (typeof show === "function") show("team"); }
  }
  async function playAgain(ctx) {
    const r = D.data, b = document.getElementById("sr-again"); if (!r || D.againBusy) return;
    D.againBusy = true; if (b) { b.disabled = true; b.textContent = "Opening…"; }
    let res;
    if (r.again && !r.is_host) res = await call("series_join", { p_mode: ctx, p_code: r.again.code }, true);
    else res = await call("series_again", { p_series: r.series.id }, true);
    D.againBusy = false;
    if (res && res.ok && !res.state && res.room_id) {                 // the host's new lobby already exists: step back into it
      const q = await call(ctx === "friend" ? "bt_sync" : "tz_sync", { p_room: res.room_id }); if (q && q.ok && q.state) res = { ok: true, state: q.state, series: res.series };
    }
    if (res && res.ok && res.state) { gotoLobby(ctx, res.state, res.series); return; }
    D.againMsg = res && res.reason === "not_host" ? "Only the host can start a new series." : errText(res || {});
    D.view = "final"; const f = finEl(); if (f) f.remove(); drawFinal(ctx, D.data);
  }
  function exitTo(ctx, dest) {
    markSeen(); hidePop(); D.data = null; popKey = ""; D.againMsg = "";
    if (ctx === "friend") {
      if (window.BattleGame && BattleGame.isOn()) BattleGame.exit(false);
      try { FriendBattle.api.end(); } catch {}
      if (typeof show === "function") show(dest === "zone" ? "battle" : dest);
      if (dest === "zone") FriendBattle.api.setView("friend");
    } else {
      if (window.TeamGame && TeamGame.isOn()) TeamGame.exit();
      try { TeamZone.api.finish(); } catch {}
      if (dest !== "zone" && typeof show === "function") show(dest);
    }
  }


  const CSS3 = `
.ss-top{display:flex;justify-content:flex-end;margin-bottom:-6px}
.ss-btn{display:inline-grid;grid-auto-flow:column;align-items:center;gap:8px;padding:5px 12px 5px 6px;border-radius:999px;cursor:pointer;font:inherit;color:var(--text);touch-action:manipulation;-webkit-tap-highlight-color:transparent;
  background:linear-gradient(135deg,color-mix(in srgb,var(--gold) 18%,var(--panel)),var(--panel));border:1.5px solid color-mix(in srgb,var(--gold) 55%,var(--line));animation:ss-glow 3.2s ease-in-out infinite;transition:transform .15s,border-color .2s}
.ss-btn:hover{border-color:var(--gold)}.ss-btn:active{transform:scale(.96)}.ss-btn:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.ss-btn .ic{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:color-mix(in srgb,var(--gold) 22%,var(--panel-2));border:1px solid color-mix(in srgb,var(--gold) 50%,var(--line));color:var(--gold)}
.ss-btn svg{width:21px;height:21px;overflow:visible}.ss-btn small{font-size:.7rem;font-weight:900;letter-spacing:.9px;text-transform:uppercase;white-space:nowrap}
.ss-bar{transform-box:fill-box;transform-origin:50% 100%;animation:ss-rise 2.4s ease-in-out infinite}.ss-bar:nth-child(2){animation-delay:.25s}.ss-bar:nth-child(3){animation-delay:.5s}
.ss-star{transform-box:fill-box;transform-origin:center;animation:ss-twinkle 2.4s ease-in-out infinite}
.ss{display:grid;gap:14px}
.ss-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px}
.ss-stat{display:grid;gap:2px;justify-items:start;padding:10px 12px;border-radius:16px;background:linear-gradient(160deg,color-mix(in srgb,var(--gold) 9%,var(--panel)),var(--panel));border:1px solid var(--line);min-width:0}
.ss-stat .ic{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;color:var(--gold);background:var(--panel-2);border:1px solid var(--line);margin-bottom:4px}
.ss-stat svg{width:17px;height:17px}.ss-stat b{font-size:1.3rem;line-height:1.1;font-variant-numeric:tabular-nums}.ss-stat small{font-size:.66rem;font-weight:800;letter-spacing:.7px;color:var(--muted);text-transform:uppercase}
.ss-stat.won .ic{color:#4ADE80}.ss-stat.lost .ic{color:#F87171}.ss-stat.draw .ic{color:#94A3B8}
.ss-filters{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px;scrollbar-width:none;-webkit-overflow-scrolling:touch}.ss-filters::-webkit-scrollbar{display:none}
.ss-chip{flex:none;padding:8px 14px;border-radius:999px;cursor:pointer;font:inherit;font-weight:800;font-size:.8rem;color:var(--muted);background:var(--panel);border:1.5px solid var(--line);touch-action:manipulation}
.ss-chip.on{color:#0b1a05;background:linear-gradient(180deg,#9BF55C,#5ED823);border-color:transparent}.ss-chip:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.ss-list{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))}
.ss-card{display:grid;gap:10px;text-align:left;width:100%;padding:14px;border-radius:20px;cursor:pointer;font:inherit;color:var(--text);position:relative;overflow:hidden;
  background:linear-gradient(165deg,color-mix(in srgb,var(--gold) 8%,var(--panel)),var(--panel) 60%);border:1.5px solid var(--line);transition:transform .15s,border-color .2s,box-shadow .2s;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.ss-card::before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:var(--line)}
.ss-card.won::before{background:#4ADE80}.ss-card.lost::before{background:#F87171}.ss-card.draw::before{background:#94A3B8}
.ss-card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--gold) 55%,var(--line));box-shadow:0 8px 24px rgba(0,0,0,.3)}.ss-card:active{transform:scale(.99)}.ss-card:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.ss-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.ss-mode{display:inline-flex;align-items:center;gap:6px;font-size:.74rem;font-weight:900;letter-spacing:1px;text-transform:uppercase;color:var(--muted)}
.ss-res{padding:4px 11px;border-radius:999px;font-size:.72rem;font-weight:900;letter-spacing:1.2px;text-transform:uppercase}
.ss-res.won{color:#0b2a14;background:#4ADE80}.ss-res.lost{color:#3a0a0a;background:#F87171}.ss-res.draw{color:#0f172a;background:#94A3B8}
.ss-ic{display:inline-flex;align-items:center;gap:6px;font-size:.82rem;font-weight:700;color:var(--muted)}.ss-ic svg{width:15px;height:15px;flex:none;color:var(--gold)}
.ss-who{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.ss-who .l{font-size:.7rem;font-weight:800;letter-spacing:.8px;color:var(--muted);text-transform:uppercase;margin-right:2px}
.ss-pl{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:3px 10px 3px 4px;border-radius:999px;background:var(--panel-2);border:1px solid var(--line);font-size:.8rem;font-weight:800}
.ss-pl i{display:grid;place-items:center;flex:none;width:22px;height:22px;border-radius:50%;font-style:normal;font-size:.8rem;overflow:hidden;background:var(--panel);border:1px solid var(--line)}
.ss-pl span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.ss-meta{display:flex;flex-wrap:wrap;gap:6px}.ss-tag{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;font-size:.74rem;font-weight:800;background:var(--panel-2);border:1px solid var(--line)}
.ss-win{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:14px;background:color-mix(in srgb,var(--gold) 10%,var(--panel-2));border:1px solid color-mix(in srgb,var(--gold) 40%,var(--line));font-size:.84rem;font-weight:800;min-width:0}
.ss-win svg{width:18px;height:18px;flex:none;color:var(--gold)}.ss-win .ss-pl{background:transparent;border:0;padding:0}
.ss-foot{display:flex;flex-wrap:wrap;gap:6px 14px;padding-top:8px;border-top:1px dashed var(--line);font-size:.82rem;font-weight:800}.ss-foot b{color:var(--gold)}
.ss-empty{display:grid;gap:8px;justify-items:center;text-align:center;padding:34px 16px;color:var(--muted);border-radius:20px;border:1.5px dashed var(--line)}
.ss-empty .big{font-size:2.4rem}.ss-empty b{color:var(--text);font-size:1.05rem}.ss-empty p{margin:0;font-size:.88rem}
.ss-load{display:grid;gap:10px}.ss-sk{height:120px;border-radius:20px;background:linear-gradient(100deg,var(--panel) 30%,var(--panel-2) 50%,var(--panel) 70%);background-size:200% 100%;animation:ss-shim 1.3s linear infinite}
.sr-det .sr-card{width:min(100%,560px);justify-items:stretch;text-align:left;gap:14px}
.sr-det h3{margin:0;font-size:1.15rem}.sr-det .sec{margin:4px 0 -6px;font-size:.72rem;font-weight:900;letter-spacing:1.6px;color:var(--gold);text-transform:uppercase}
.sr-det .kv{display:grid;gap:6px;margin:0;padding:0;list-style:none}.sr-det .kv li{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:8px 12px;border-radius:12px;background:var(--panel-2);border:1px solid var(--line);font-size:.86rem}
.sr-det .kv li>span:first-child{color:var(--muted);font-weight:800;white-space:nowrap}.sr-det .kv li>b,.sr-det .kv li>span:last-child{text-align:right;min-width:0}
.sr-det .rd{display:grid;gap:8px;padding:12px;border-radius:16px;background:var(--panel-2);border:1px solid var(--line)}
.sr-det .rd .h{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:.78rem;font-weight:900;letter-spacing:1.3px;color:var(--muted);text-transform:uppercase}
.sr-det .rd .w{display:flex;gap:4px}.sr-det .rd .w i{display:grid;place-items:center;width:30px;height:30px;border-radius:7px;font-style:normal;font-weight:900;font-size:.95rem;color:#0b1a05;background:linear-gradient(180deg,#9BF55C,#5ED823)}
.sr-det .rd p{margin:0;font-size:.84rem;color:var(--muted);line-height:1.4}.sr-det .rd p b{color:var(--text)}
.sr-det .pr{display:flex;flex-wrap:wrap;gap:6px}.sr-det .pr span{display:inline-flex;gap:6px;align-items:center;padding:3px 9px;border-radius:999px;font-size:.74rem;font-weight:800;background:var(--panel);border:1px solid var(--line)}
.sr-det .pr span.ok{border-color:#4ADE80;color:#4ADE80}.sr-det .pr span.no{color:var(--muted)}
.sr-det .fin{display:grid;gap:6px;justify-items:center;text-align:center;padding:14px;border-radius:18px;background:linear-gradient(165deg,color-mix(in srgb,var(--gold) 14%,var(--panel-2)),var(--panel-2));border:1.5px solid color-mix(in srgb,var(--gold) 50%,var(--line))}
.sr-det .fin .cr{font-size:2rem;filter:drop-shadow(0 0 12px color-mix(in srgb,var(--gold) 60%,transparent))}
@keyframes ss-glow{50%{box-shadow:0 0 0 3px color-mix(in srgb,var(--gold) 14%,transparent),0 4px 18px color-mix(in srgb,var(--gold) 28%,transparent)}}
@keyframes ss-rise{50%{transform:scaleY(.72)}}@keyframes ss-twinkle{50%{transform:scale(1.25) rotate(12deg);opacity:.75}}@keyframes ss-shim{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.ss-btn,.ss-bar,.ss-star,.ss-sk{animation:none!important}.ss-card{transition:none!important}}
html[data-motion=reduced] .ss-btn,html[data-motion=reduced] .ss-bar,html[data-motion=reduced] .ss-star,html[data-motion=reduced] .ss-sk{animation:none!important}
`;
if (!document.getElementById("sr-css3")) { const st = document.createElement("style"); st.id = "sr-css3"; st.textContent = CSS3; document.head.append(st); }

  // ====================================================================== Series Stats & History
  // Everything shown here comes from the server (018_series_stats.sql: series_history / series_detail), which reads the real completed series.
  // Only completed series are listed, and a word is only returned for a finished series.
  const SS = { filter: "all", loading: false, err: "", items: [], stats: null };
  const SVG = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    cal:    SVG('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    users:  SVG('<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3.3 3-5 6-5s5.400 1.700 6 5"/><path d="M16 5.700a3 3 0 0 1 0 5.600M18.500 14.800c1.500.700 2.300 2.200 2.500 4.200"/>'),
    flag:   SVG('<path d="M5.500 21V4"/><path d="M5.500 5h11l-2 3.500 2 3.500h-11"/>'),
    trophy: SVG('<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H4.500v1.500A3.500 3.500 0 0 0 8 11M16 6h3.500v1.500A3.500 3.500 0 0 1 16 11"/><path d="M12 13v4M8.500 20.500h7M9.500 17h5"/>'),
    coin:   SVG('<circle cx="12" cy="12" r="8.500"/><circle cx="12" cy="12" r="4.800"/>'),
    bolt:   SVG('<path d="M13 3 5.500 13.500H11L10 21l7.500-10.500H12L13 3Z"/>'),
    crown:  SVG('<path d="M4 18.500 3 8l5 4 4-7 4 7 5-4-1 10.500H4Z"/>'),
    x:      SVG('<circle cx="12" cy="12" r="8.500"/><path d="M9 9l6 6M15 9l-6 6"/>'),
    eq:     SVG('<circle cx="12" cy="12" r="8.500"/><path d="M8.500 10h7M8.500 14h7"/>'),
    chart:  SVG('<path d="M4 20h16"/><rect x="5.500" y="12" width="3.200" height="8" rx="1"/><rect x="10.400" y="7.500" width="3.200" height="12.500" rx="1"/><rect x="15.300" y="10" width="3.200" height="10" rx="1"/>')
  };
  function statsButton() {
    return `<button class="ss-btn" type="button" data-sr="stats" aria-label="Series Stats"><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true">
      <g fill="currentColor"><rect class="ss-bar" x="4" y="13" width="4" height="8" rx="1.300"/><rect class="ss-bar" x="10" y="8.500" width="4" height="12.500" rx="1.300"/><rect class="ss-bar" x="16" y="11" width="4" height="10" rx="1.300"/></g>
      <path class="ss-star" d="M12 1.200l1.100 2.300 2.500.3-1.800 1.700.5 2.500L12 6.800 9.700 8l.5-2.500-1.800-1.700 2.500-.3L12 1.200Z" fill="currentColor"/></svg></span><small>Series Stats</small></button>`;
  }
  const fmtDate = (t) => { try { return new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
  const MODE = { friend: "Friend Zone", team: "Team Zone" };
  const RES = { won: "Won", lost: "Lost", draw: "Draw" };
  const pill = (p) => `<span class="ss-pl"><i aria-hidden="true">${av(p.avatar)}</i><span>${esc(p.username)}</span></span>`;

  // a guest who made an account keeps their history: move their series seats over once (safe to repeat)
  let adoptP = null;
  function adoptSeriesGuest() {
    if (adoptP) return adoptP;
    adoptP = (async () => {
      try {
        if (!(window.Auth && Auth.isAccount && Auth.isAccount()) || !Auth.client || !Auth.client()) return;
        const g = JSON.parse(localStorage.getItem("wbid_lb_guest") || "null");
        if (!g || typeof g.pid !== "string" || typeof g.secret !== "string" || g.secret.length < 24) return;
        await Auth.client().rpc("series_adopt_guest", { p_pid: g.pid, p_secret: g.secret });
      } catch {}
    })();
    return adoptP;
  }
  async function loadHistory(ctx) {
    await adoptSeriesGuest();
    const r = await call("series_history", { p_limit: 200 });
    SS.loading = false;
    if (r && r.ok) { SS.items = r.items || []; SS.stats = r.stats || null; SS.err = ""; }
    else SS.err = r && r.reason === "no_server" ? ERR.no_server : (r && r.reason === "bad_id" ? ERR.bad_id : "Couldn't load your series history. Check your connection and try again.");
    redraw(ctx);
  }
  function statsPage(ctx) {
    const hero = ctx === "friend" ? "fb-hero" : "tz-hero", st = SS.stats || {};
    const card = (cls, ic, n, label) => `<div class="ss-stat ${cls}"><span class="ic">${ic}</span><b>${Number(n || 0).toLocaleString()}</b><small>${label}</small></div>`;
    const cards = SS.loading && !SS.stats ? "" : `<div class="ss-stats" role="group" aria-label="Overall statistics">
      ${card("", IC.chart, st.played, "Series played")}${card("won", IC.trophy, st.won, "Series won")}${card("lost", IC.x, st.lost, "Series lost")}${card("draw", IC.eq, st.drawn, "Series drawn")}
      ${card("", IC.flag, st.rounds_won, "Rounds won")}</div>`;
    const F = [["all", "All"], ["friend", "Friend Zone"], ["team", "Team Zone"], ["won", "Won"], ["lost", "Lost"], ["draw", "Draw"]];
    const chips = `<div class="ss-filters" role="group" aria-label="Filter history">${F.map(([k, l]) => `<button class="ss-chip${SS.filter === k ? " on" : ""}" type="button" data-sr="sfilter" data-f="${k}" aria-pressed="${SS.filter === k}">${l}</button>`).join("")}</div>`;
    let list;
    if (SS.loading) list = `<div class="ss-load" aria-busy="true"><div class="ss-sk"></div><div class="ss-sk"></div></div>`;
    else if (SS.err) list = `<div class="ss-empty"><span class="big">⚠️</span><b>${esc(SS.err)}</b><button class="tz-go" type="button" data-sr="sretry">Try again</button></div>`;
    else {
      const f = SS.filter, items = SS.items.filter((x) => f === "all" || x.mode === f || x.my_result === f);
      if (!SS.items.length) list = `<div class="ss-empty"><span class="big">🏆</span><b>No series yet</b><p>Finish a Series Mode match and it will show up here.</p></div>`;
      else if (!items.length) list = `<div class="ss-empty"><span class="big">🔎</span><b>Nothing here</b><p>No series match this filter.</p></div>`;
      else list = `<div class="ss-list">${items.map(histCard).join("")}</div>${st.played > SS.items.length ? `<p class="sr-sm" style="text-align:center">Showing your latest ${SS.items.length} series.</p>` : ""}`;
    }
    return { title: "Friend Zone", html: `<div class="sr-wrap ss"><div class="${hero}"><h2>My Series History</h2><p>Every series you have finished, newest first.</p></div>${cards}${chips}${list}
      <div class="tz-row"><button class="tz-go alt" type="button" data-sr="back" data-v="serstats">Back to Series Mode</button></div></div>` };
  }
  function histCard(x) {
    const others = (x.players || []).filter((p) => p.seat !== x.my_seat), win = x.overall_result === "win" ? (x.players || []).find((p) => p.seat === x.winner_seat) : null;
    const d = DIFF[x.difficulty] || DIFF.medium;
    return `<button class="ss-card ${x.my_result}" type="button" data-sr="scard" data-id="${esc(x.series_id)}" aria-label="${esc(MODE[x.mode])} series, ${esc(RES[x.my_result])}, ${esc(fmtDate(x.completed_at))}">
      <div class="ss-row"><span class="ss-mode">${x.mode === "friend" ? IC.users : IC.users} ${esc(MODE[x.mode] || "")}</span><span class="ss-res ${x.my_result}">${esc(RES[x.my_result])}</span></div>
      <div class="ss-ic">${IC.cal}<span>${esc(fmtDate(x.completed_at))}</span></div>
      <div class="ss-who"><span class="l">Played with</span>${others.length ? others.map(pill).join("") : '<span class="ss-ic">—</span>'}</div>
      <div class="ss-meta"><span class="ss-tag">${d.icon} ${d.name}</span><span class="ss-tag">${IC.flag.replace("<svg", '<svg width="13" height="13"')} ${x.total_rounds} rounds</span></div>
      <div class="ss-win">${IC.trophy}${win ? `<span>Overall winner</span>${pill(win)}` : `<span>Overall draw · no winner</span>`}</div>
      <div class="ss-foot"><span class="ss-ic">${IC.flag}My round wins: <b>${x.my_wins}</b></span><span class="ss-ic">${IC.coin}<b>+${x.coins}</b></span><span class="ss-ic">${IC.bolt}<b>+${x.xp} XP</b></span></div></button>`;
  }

  // ---------- the detail popup ----------
  function closeDetail() { const e = document.getElementById("sr-det"); if (e) e.remove(); lock(!!(popEl() || finEl())); }
  async function openDetail(ctx, id) {
    closeDetail();
    const el = document.createElement("div"); el.id = "sr-det"; el.className = "sr-ov sr-det"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Series details");
    el.innerHTML = `<div class="sr-card"><div class="ss-load" aria-busy="true"><div class="ss-sk"></div><div class="ss-sk"></div></div></div>`;
    el.addEventListener("click", (e) => { if (e.target === el) closeDetail(); });
    document.body.append(el); lock(true);
    const r = await call("series_detail", { p_series: id });
    if (!document.getElementById("sr-det")) return;
    if (!r || !r.ok) { el.firstChild.innerHTML = `<div class="ss-empty"><span class="big">⚠️</span><b>Couldn't open this series.</b></div><button class="sr-btn alt" type="button" id="sd-close">Back</button>`; el.querySelector("#sd-close").addEventListener("click", closeDetail); return; }
    el.firstChild.innerHTML = detailHtml(r);
    el.querySelector("#sd-close").addEventListener("click", closeDetail); el.querySelector("#sd-close").focus({ preventScroll: true });
  }
  function detailHtml(r) {
    const s = r.series, me = r.me, ps = r.players || [], byseat = {}; ps.forEach((p) => { byseat[p.seat] = p; });
    const d = DIFF[s.difficulty] || DIFF.medium, win = s.overall_result === "win" ? byseat[s.winner_seat] : null, top = Math.max(0, ...ps.map((p) => p.wins));
    const rounds = (r.rounds || []).map((x) => {
      const det = (x.details || []).map((q) => { const p = byseat[q.seat]; if (!p) return "";
        const ok = q.status === "solved", t = ok ? `✓ solved in ${q.attempts}` : q.status === "failed" ? `✗ out of attempts (${q.attempts})` : `✗ not solved (${q.attempts} ${q.attempts === 1 ? "attempt" : "attempts"})`;
        return `<span class="${ok ? "ok" : "no"}">${esc(p.username)}${p.is_me ? " (you)" : ""}: ${t}</span>`; }).join("");
      return `<div class="rd"><div class="h"><span>Round ${x.round_no}</span><span>${x.result === "win" ? "Won" : "Draw"}</span></div>
        <div class="w" aria-label="${esc(x.word)}">${String(x.word || "").toUpperCase().split("").map((c) => `<i aria-hidden="true">${esc(c)}</i>`).join("")}</div>
        ${x.meaning ? `<p><b>Meaning:</b> ${esc(x.meaning)}</p>` : ""}
        <p><b>Round winner:</b> ${x.result === "win" ? esc(x.winner_name || "Player") : "Round draw · no winner"}</p>${det ? `<div class="pr">${det}</div>` : ""}</div>`;
    }).join("");
    const fin = win
      ? `<span class="cr" aria-hidden="true">👑</span><p class="sr-hd" style="margin:0">OVERALL SERIES WINNER</p><div class="sr-big" aria-hidden="true">${av(win.avatar)}</div><p class="sr-nm">${esc(win.username)}${win.is_me ? " (you)" : ""}</p><p class="sr-sm">${win.wins} ${win.wins === 1 ? "round" : "rounds"} won</p>`
      : `<span class="cr" aria-hidden="true">🤝</span><p class="sr-hd" style="margin:0">OVERALL DRAW</p><p class="sr-sm">${top > 0 ? "Level on " + top + (top === 1 ? " round" : " rounds") : "Every round was a draw"}</p>`;
    return `<h3>Series Details</h3>
      <ul class="kv"><li><span>Date &amp; time</span><b>${esc(fmtDate(s.completed_at))}</b></li><li><span>Game mode</span><b>${esc(MODE[s.mode] || "")}</b></li>
        <li><span>Difficulty</span><b>${d.icon} ${d.name} · ${d.min} min</b></li><li><span>Total rounds</span><b>${s.total_rounds}</b></li>
        <li><span>Participants</span><span class="pr" style="justify-content:flex-end">${ps.map(pill).join("")}</span></li></ul>
      <p class="sec">Round by round</p>${rounds}
      <p class="sec">Final results</p><div class="fin">${fin}</div>
      <ul class="kv sr-pl">${ps.map((p) => `<li${p.wins === top && top > 0 ? ' style="border-color:var(--gold)"' : ""}><span style="display:flex;align-items:center;gap:8px;min-width:0;color:var(--text)">${pill(p)}${p.is_me ? " (you)" : ""}</span><b>${p.wins} ${p.wins === 1 ? "round" : "rounds"}</b></li>`).join("")}</ul>
      <ul class="kv"><li><span>My result</span><span class="ss-res ${me.result}">${esc(RES[me.result])}</span></li><li><span>Coins earned</span><b>+${me.coins} 🪙</b></li><li><span>XP earned</span><b>+${me.xp} XP</b></li></ul>
      <button class="sr-btn alt" type="button" id="sd-close">Back to history</button>`;
  }

  window.Series = { is: isSeries, page, button, chips, back, owns, info: (id) => info.get(id) || null };
})();