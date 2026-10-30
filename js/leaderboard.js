// Leaderboard: real players only (registered accounts AND guests), ranked by total XP, then wins.
// Data lives in Supabase (supabase/migrations/005_leaderboard.sql). The app never reads or writes the table directly: it calls
// four small functions that only ever return public fields (username, avatar, level, XP, wins), never emails or ids of accounts.
//  - registered player: lb_submit_account (name + avatar are taken from the account on the server)
//  - guest: a random id + secret is made once and kept on this device (key "wbid_lb_guest"), lb_submit_guest
//  - guest -> account: Leaderboard.mergeGuest() removes the guest entry so the same person is never listed twice
// Without Supabase (local demo mode) only the current player's own real progress is shown.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const LIMIT = 50;
  const CSS = `
.lbx{display:grid;gap:14px;width:100%;padding-bottom:84px}
.lbx-sub{margin:0;text-align:center;color:var(--muted);font-size:.8rem}
.lbx-tagline{margin:6px 0 0;text-align:center;color:var(--muted);font-size:.82rem;font-weight:500;letter-spacing:.4px;opacity:.9}
.lbx-rank{display:flex;align-items:baseline;justify-content:center;gap:10px;margin:6px 0 4px;padding:4px 0;text-align:center;font-family:"SF Pro Display",Inter,"Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif}
.lbx-rank .k{font-size:.78rem;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:var(--muted)}
.lbx-rank .n{font-size:2.6rem;font-weight:900;line-height:1;letter-spacing:-1px;font-variant-numeric:tabular-nums;color:var(--red1);background:linear-gradient(180deg,color-mix(in srgb,var(--red1) 70%,#fff),var(--red1) 55%,var(--red2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 0 12px var(--red-glow))}
.lbx-av{flex:none;display:grid;place-items:center;width:44px;height:44px;border-radius:50%;font-size:1.5rem;background:var(--panel-2);border:1px solid var(--line)}
.lbx-podium{list-style:none;margin:2px 0 0;padding:0;display:flex;align-items:flex-end;justify-content:center;gap:8px}
.lbx-pod{--c1:#ffd24a;--c2:#c8960c;--glow:rgba(250,204,21,.45);position:relative;flex:1 1 0;min-width:0;max-width:158px;display:flex;flex-direction:column;align-items:center;gap:3px;padding:14px 6px 12px;border-radius:18px;text-align:center;
  background:linear-gradient(170deg,color-mix(in srgb,var(--c1) 20%,var(--panel)),var(--panel) 70%);border:1px solid color-mix(in srgb,var(--c1) 60%,var(--line));box-shadow:0 8px 20px rgba(0,0,0,.28),0 0 18px var(--glow);animation:lbx-in .45s cubic-bezier(.2,.9,.3,1.1) both}
.lbx-pod.p1{order:2;padding-top:22px;min-height:206px}
.lbx-pod.p2{order:1;--c1:#d4dbe6;--c2:#8d99a8;--glow:rgba(190,202,220,.35);min-height:178px;animation-delay:.08s}
.lbx-pod.p3{order:3;--c1:#f0b078;--c2:#a8652b;--glow:rgba(217,140,74,.4);min-height:164px;animation-delay:.16s}
.lbx-pod.me{border-color:var(--red1);outline:2px solid var(--red1);outline-offset:2px;background:linear-gradient(170deg,color-mix(in srgb,var(--red1) 22%,var(--panel)),var(--panel) 70%);box-shadow:0 8px 20px rgba(0,0,0,.28),0 0 22px var(--red-glow)}
.lbx-crown{position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:1.7rem;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}
.lbx-medal{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;font-size:.9rem;font-weight:900;color:#2b1a05;background:linear-gradient(135deg,#fff,var(--c1) 40%,var(--c2));box-shadow:0 2px 6px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.6)}
.lbx-pod .lbx-av{width:54px;height:54px;font-size:1.9rem;border:2px solid var(--c1);box-shadow:0 0 14px var(--glow)}
.lbx-pod.p1 .lbx-av{width:64px;height:64px;font-size:2.3rem}
.lbx-pod b,.lbx-row .nm b{display:flex;align-items:center;justify-content:center;gap:5px;max-width:100%;min-width:0}.lbx-row .nm b{justify-content:flex-start}.lbx-pod b{font-size:.86rem;flex-wrap:wrap;row-gap:3px}.lbx-pod .lbx-nm{max-width:100%}.lbx-nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lbx-pod .lbx-tag,.lbx-row .lbx-tag{flex:none;margin:0}
.lbx-pod .lbx-xp{font-size:.92rem;font-weight:900;color:var(--c1)}
[data-theme=light] .lbx-pod .lbx-xp{color:color-mix(in srgb,var(--c2) 85%,#000)}
.lbx-pod small{font-size:.7rem;color:var(--muted);line-height:1.25}
.lbx-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.lbx-row{display:grid;grid-template-columns:34px 40px minmax(0,1fr) auto;align-items:center;gap:10px;padding:9px 12px;border-radius:14px;background:var(--panel);border:1px solid var(--line);animation:lbx-in .35s ease both;animation-delay:calc(min(var(--i,0),12) * 28ms)}
.lbx-row .no{display:grid;place-items:center;height:28px;border-radius:9px;background:var(--panel-2);border:1px solid var(--line);font-size:.82rem;font-weight:800;font-variant-numeric:tabular-nums}
.lbx-row .lbx-av{width:38px;height:38px;font-size:1.3rem}
.lbx-row .nm{min-width:0}.lbx-row .nm b{font-size:.92rem}
.lbx-row .nm>span{display:block;font-size:.76rem;color:var(--muted)}
.lbx-row .lbx-xp{font-size:.95rem;font-weight:900;color:var(--gold);text-align:right;font-variant-numeric:tabular-nums}.lbx-row .lbx-xp small{display:block;font-size:.64rem;font-weight:800;color:var(--muted);letter-spacing:.6px}
.lbx-row.me{border-color:var(--red1);background:linear-gradient(160deg,color-mix(in srgb,var(--red1) 20%,var(--panel)),color-mix(in srgb,var(--red2) 8%,var(--panel)) 75%);box-shadow:0 0 0 1px color-mix(in srgb,var(--red1) 45%,transparent),0 0 20px color-mix(in srgb,var(--red1) 38%,transparent)}
.lbx-row.me .no{background:color-mix(in srgb,var(--red1) 22%,var(--panel-2));border-color:color-mix(in srgb,var(--red1) 60%,var(--line))}
.lbx-row.me .lbx-xp{color:color-mix(in srgb,var(--red1) 55%,var(--text))}
.lbx-row.below{border-color:color-mix(in srgb,var(--gold) 38%,var(--line));background:linear-gradient(160deg,color-mix(in srgb,var(--gold) 7%,var(--panel)),var(--panel));box-shadow:0 0 14px color-mix(in srgb,var(--gold) 12%,transparent)}
.lbx-tag{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;font-size:.62rem;font-weight:900;letter-spacing:.8px;vertical-align:1px;background:linear-gradient(135deg,var(--red1),var(--red2));color:#fff;box-shadow:0 0 8px color-mix(in srgb,var(--red1) 50%,transparent);font-style:normal}
.lbx-gap{text-align:center;color:var(--muted);letter-spacing:4px;line-height:1}
.lbx-msg{display:grid;gap:6px;justify-items:center;padding:22px 16px;text-align:center;border-radius:16px;background:var(--panel);border:1px dashed var(--line)}
.lbx-msg .ic{font-size:2rem}.lbx-msg b{font-size:1rem}.lbx-msg span{color:var(--muted);font-size:.86rem;line-height:1.4;max-width:34ch}
.lbx-msg .primary{flex:none;margin-top:6px;min-width:130px}
.lbx-sk{display:grid;gap:8px}.lbx-sk i{display:block;height:54px;border-radius:14px;background:linear-gradient(90deg,var(--panel),var(--panel-2),var(--panel));background-size:200% 100%;border:1px solid var(--line);animation:lbx-sh 1.3s linear infinite}
.lbx-sk i:first-child{height:78px}
@keyframes lbx-in{from{opacity:0;transform:translateY(10px)}}
@keyframes lbx-sh{to{background-position:-200% 0}}
@media (max-width:360px){.lbx-pod{padding-left:3px;padding-right:3px}.lbx-pod b{font-size:.78rem}.lbx-pod .lbx-av{width:46px;height:46px;font-size:1.6rem}.lbx-pod.p1 .lbx-av{width:54px;height:54px}.lbx-row{grid-template-columns:30px 36px minmax(0,1fr) auto;gap:8px;padding:9px 9px}}
html[data-motion=reduced] .lbx *{animation:none!important}
`;
  if (!document.getElementById("lbx-css")) { const st = document.createElement("style"); st.id = "lbx-css"; st.textContent = CSS; document.head.append(st); }

  // ---------- helpers ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => (Number(v) || 0).toLocaleString();
  const client = () => (window.Auth && Auth.client && Auth.client()) || null;
  const isAcct = () => !!(window.Auth && Auth.isAccount && Auth.isAccount());
  const isGuestMode = () => !isAcct() && !!(window.Auth && Auth.isGuest && Auth.isGuest());
  const visible = () => typeof screen === "string" && screen === "leaderboard";
  const mine = () => { const P = Player.data, lv = Player.levelInfo(); return { username: P.username, avatar: P.avatar || "🦊", level: lv.level, xp: P.xp, wins: P.wins, games: P.wins + P.losses }; };
  const played = (m) => m.games >= 1;   // only a player who has finished a game can be on the board

  // ---------- guest identity (kept on this device; survives "Reset all progress" on purpose, so a reset can remove the old entry) ----------
  const ID_KEY = "wbid_lb_guest";
  const rnd = (n) => { const a = new Uint8Array(n); (window.crypto || window.msCrypto).getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, "0")).join(""); };
  const uuid = () => { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); const h = rnd(16); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(12, 15)}-a${h.slice(15, 18)}-${h.slice(18, 30)}`; };
  const saveGuest = (g) => { try { localStorage.setItem(ID_KEY, JSON.stringify(g)); } catch {} };
  function guestId(create) {
    let g = null; try { g = JSON.parse(localStorage.getItem(ID_KEY)); } catch {}
    if (g && typeof g.pid === "string" && typeof g.secret === "string" && g.secret.length >= 24) return g;
    if (!create) return null;
    g = { pid: uuid(), secret: rnd(24), sent: false, merged: false }; saveGuest(g); return g;
  }

  // ---------- sending my numbers ----------
  let busy = false, again = false, dirty = false, lastSig = "", timer = 0;
  const later = (ms) => { clearTimeout(timer); timer = setTimeout(async () => { const r = await submit(false); if (r && visible()) load(true); }, ms || 2300); };
  async function retire(c, g) { try { const r = await c.rpc("lb_remove_guest", { p_pid: g.pid, p_secret: g.secret }); if (!r.error) { g.sent = false; saveGuest(g); lastSig = ""; } } catch {} }
  async function submit(force) {
    const c = client(); if (!c) return null;
    const m = mine(), acct = isAcct();
    if (!acct && !isGuestMode()) return null;
    let g = null;
    if (!acct) { g = guestId(false); if (g && g.merged) return null; }       // this device's guest progress already moved into an account
    if (!played(m)) { if (g && g.sent) await retire(c, g); return null; }     // nobody who hasn't played is listed (and a reset guest is taken off)
    const sig = [acct ? "a" : "g", m.xp, m.wins, m.games, m.username, m.avatar].join("|");
    if (!force && !dirty && sig === lastSig) return null;
    if (busy) { again = true; return null; }
    busy = true;
    try {
      let res;
      if (acct) res = await c.rpc("lb_submit_account", { p_xp: m.xp, p_wins: m.wins, p_games: m.games });
      else { g = guestId(true); res = await c.rpc("lb_submit_guest", { p_pid: g.pid, p_secret: g.secret, p_username: m.username, p_avatar: m.avatar, p_xp: m.xp, p_wins: m.wins, p_games: m.games }); }
      const r = res && res.data;
      if (!res || res.error || !r) { dirty = true; later(8000); return null; }   // offline / table not created yet: try again later, quietly
      if (r.reason === "throttled") { later(2600); return null; }
      lastSig = sig; dirty = false;
      if (!r.ok) return null;                                                    // numbers refused by the server: do not retry the same ones
      if (!acct) {
        g.sent = true; saveGuest(g);
        if (r.username && r.username !== m.username) {                            // that guest name was taken: the server picked a free one, keep it everywhere
          Player.data.username = r.username; Player.save(true); lastSig = "";
          if (typeof toast === "function") toast(`The name ${m.username} was already on the leaderboard. You are now ${r.username}`, "success", 3600);
          if (window.WBApp && WBApp.refresh) WBApp.refresh();
        }
      }
      return r;
    } catch { dirty = true; later(8000); return null; }
    finally { busy = false; if (again) { again = false; later(300); } }
  }
  // Called by auth.js when a guest moves their progress into a new account: take the guest entry off, then list the account instead.
  async function mergeGuest() {
    const c = client(); if (!c) return;
    const g = guestId(true);
    if (g.sent) { try { const r = await c.rpc("lb_remove_guest", { p_pid: g.pid, p_secret: g.secret }); if (r.error) throw r.error; } catch { g.mergePending = true; saveGuest(g); return; } }
    g.merged = true; g.sent = false; delete g.mergePending; saveGuest(g);
    await submit(true);
  }
  // Called by auth.js whenever an account is ready (login, new device, page reopened).
  function sync() {
    if (!client()) return;
    const g = guestId(false);
    if (isAcct() && g && g.mergePending) return mergeGuest();
    return submit(true);
  }

  // ---------- reading the rankings ----------
  let token = 0, state = { status: "idle", data: null };
  async function load(silent) {
    const my = ++token, c = client();
    if (!c) { state = { status: "local", data: null }; paint(); return; }
    if (!silent || !state.data) { state = { status: "loading", data: state.data }; paint(); }
    try { await submit(false); } catch {}                                          // make sure my newest XP is in before I look
    let res; const g = !isAcct() ? guestId(false) : null;
    try { res = await c.rpc("lb_get", { p_limit: LIMIT, p_pid: g ? g.pid : null }); } catch (e) { res = { error: e }; }
    if (my !== token) return;
    if (!res || res.error || !res.data || !Array.isArray(res.data.top)) state = { status: "error", data: silent ? state.data : null };
    else state = { status: "ready", data: res.data };
    paint();
  }

  // ---------- drawing ----------
  const stat = (p) => `Level ${num(p.level)} · ${num(p.wins)} win${Number(p.wins) === 1 ? "" : "s"}`;
  // Centered "CURRENT RANK: N" line. N is the player's real place from the server (or 1 in local demo mode).
  function rankIndicator(place, label) {
    const n = place ? num(place) : (label || "–");
    return `<div class="lbx-rank" role="status" aria-live="polite" aria-label="Current rank ${place ? esc(num(place)) : esc(label || "unranked")}"><span class="k">Current Rank</span><span class="n" aria-hidden="true">${esc(n)}</span></div>`;
  }
  const pod = (p, i, mePid) => `<li class="lbx-pod p${i + 1}${p.pid === mePid ? " me" : ""}">${i === 0 ? '<span class="lbx-crown" aria-hidden="true">👑</span>' : ""}<span class="lbx-medal" aria-label="Rank ${i + 1}">${i + 1}</span><span class="lbx-av" aria-hidden="true">${esc(p.avatar)}</span><b><span class="lbx-nm">${esc(p.username)}</span>${p.pid === mePid ? '<i class="lbx-tag">YOU</i>' : ""}</b><span class="lbx-xp">${num(p.xp)} XP</span><small>Level ${num(p.level)}<br>${num(p.wins)} win${Number(p.wins) === 1 ? "" : "s"}</small></li>`;
  const row = (p, i, mePid, mePlace) => `<li class="lbx-row${p.pid === mePid ? " me" : (mePlace && Number(p.place) > mePlace ? " below" : "")}" style="--i:${i}"><span class="no">${num(p.place)}</span><span class="lbx-av" aria-hidden="true">${esc(p.avatar)}</span><div class="nm"><b><span class="lbx-nm">${esc(p.username)}</span>${p.pid === mePid ? '<i class="lbx-tag">YOU</i>' : ""}</b><span>${stat(p)}</span></div><div class="lbx-xp">${num(p.xp)}<small>XP</small></div></li>`;
  const msg = (ic, title, text, btn) => `<div class="lbx-msg" role="status"><span class="ic" aria-hidden="true">${ic}</span><b>${title}</b><span>${text}</span>${btn ? '<button type="button" class="primary" data-lb-retry>Try again</button>' : ""}</div>`;

  function paint() {
    const root = $("#lb-root"); if (!root) return;
    const loc = mine(), st = state;
    let html = "";
    if (st.status === "loading" && !st.data) html = `<div class="lbx-sk" aria-busy="true" aria-label="Loading leaderboard"><i></i><i></i><i></i><i></i><i></i></div>`;
    else if (st.status === "local") {
      html = rankIndicator(played(loc) ? 1 : 0, "–") + (played(loc)
        ? `<ol class="lbx-list"><li class="lbx-row me" style="--i:0"><span class="no">1</span><span class="lbx-av" aria-hidden="true">${esc(loc.avatar)}</span><div class="nm"><b><span class="lbx-nm">${esc(loc.username)}</span><i class="lbx-tag">YOU</i></b><span>${stat(loc)}</span></div><div class="lbx-xp">${num(loc.xp)}<small>XP</small></div></li></ol>`
        : "") + msg("🌍", "Only you, for now", "Online rankings aren't switched on in this copy of the app, so only your own progress is shown. Other players will appear here once online play is set up.");
    } else if (st.status === "error" && !st.data) html = rankIndicator(0, "–") + msg("📡", "Couldn't load the leaderboard", "Check your connection and try again. Your progress is safe.", true);
    else {
      const d = st.data, top = d.top || [], me = d.me || null, total = Number(d.total) || top.length, mePid = me ? me.pid : "";
      const myPlace = me ? Number(me.place) : 0;
      html = rankIndicator(myPlace, played(loc) ? "…" : "–");
      if (st.status === "error") html += `<p class="lbx-sub" role="status">Couldn't refresh just now. Showing the last rankings.</p>`;
      if (!top.length) {
        html += (played(loc) ? `<ol class="lbx-list"><li class="lbx-row me" style="--i:0"><span class="no">1</span><span class="lbx-av" aria-hidden="true">${esc(loc.avatar)}</span><div class="nm"><b><span class="lbx-nm">${esc(loc.username)}</span><i class="lbx-tag">YOU</i></b><span>${stat(loc)}</span></div><div class="lbx-xp">${num(loc.xp)}<small>XP</small></div></li></ol>` : "")
          + msg("🏆", played(loc) ? "You're the first one here!" : "No players yet", played(loc) ? "More players will appear as they join and play." : "Finish a game to take the first spot on the leaderboard.");
      } else {
        html += `<ol class="lbx-podium" aria-label="Top three players">${top.slice(0, 3).map((p, i) => pod(p, i, mePid)).join("")}</ol>`;
        if (top.length > 3) html += `<ol class="lbx-list" start="4" aria-label="Rankings">${top.slice(3).map((p, i) => row(p, i, mePid, myPlace)).join("")}</ol>`;
        if (me && me.place > top.length) html += `<div class="lbx-gap" aria-hidden="true">· · ·</div><ol class="lbx-list" start="${me.place}">${row(me, 0, mePid)}</ol>`;
        if (total === 1 && me) html += msg("🌱", "You're the only player so far", "More players will appear here as they join and play.");
        html += `<p class="lbx-tagline">Keep playing. Keep winning. Climb the leaderboard.</p>`;
      }
    }
    root.innerHTML = html;
  }

  // ---------- wiring ----------
  const root = $("#lb-root");
  if (root) root.addEventListener("click", (e) => { if (e.target.closest("[data-lb-retry]")) load(false); });
  const rf = $("#lb-refresh"); if (rf) rf.onclick = () => load(false);
  addEventListener("wb:save", () => later(2300));                    // XP, level, wins: every change to the save is sent a moment later
  addEventListener("online", () => { if (dirty) later(500); if (visible()) load(true); });
  setInterval(() => { if (visible() && !document.hidden && state.status !== "loading") load(true); }, 30000);   // stays fresh while you look at it
  setTimeout(() => { if (isAcct()) sync(); else submit(false); }, 4000);   // existing players join the board without having to open it
  window.Leaderboard = { render: () => load(false), refresh: () => load(true), submit, sync, mergeGuest };
})();