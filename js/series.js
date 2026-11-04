// Series Mode (Stage 1: entry button, Create Series, Join Series, lobby labels) for Friend Zone and Team Zone.
// This file only DRAWS screens and sends taps. Every decision (valid settings, room code, capacity, expiry, already started,
// who may join) is made by Supabase: supabase/migrations/014_series_mode.sql (series_create / series_join / series_info).
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
  const call = (fn, args) => { const fb = window.FriendBattle && FriendBattle.api; return fb && fb.call ? fb.call(fn, args || {}, true) : Promise.resolve({ ok: false, reason: "no_server" }); };
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
    const r = await call("series_create", { p_mode: ctx, p_difficulty: z.cfg.diff, p_rounds: z.cfg.rounds, p_max: ctx === "team" ? z.cfg.size : null });
    z.busy = false;
    if (r.ok && r.state) { info.set(r.state.room.id, r.series || null); z.err = ""; enter(ctx, r.state); return; }
    z.err = errText(r); redraw(ctx);
  }
  async function join(ctx) {
    const z = Z[ctx]; if (z.busy || z.code.length !== 6) return;
    z.busy = true; z.err = ""; redraw(ctx);
    const r = await call("series_join", { p_mode: ctx, p_code: z.code });
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

  window.Series = { is: isSeries, page, button, chips, back, info: (id) => info.get(id) || null };
})();