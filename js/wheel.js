// Spin Wheel: 1 free spin per day, then WHEEL.cost coins per spin.
//  - signed-in players: the SERVER (supabase/migrations/008_spin_wheel.sql) picks the prize, decides if the spin is the free one of the day,
//    stores every spin once under its request id and remembers the free-spin day, so refresh / logout / another device cannot cheat.
//  - guests: the same rules run on this device (free day + history saved per guest profile). A guest's data only lives on the device,
//    like the rest of their progress, so this cannot be made cheat-proof for guests.
//  - the app adds the prize and takes the paid-spin cost in ONE step, once per request id (Player.applySpin in store.js).
//  - a spin interrupted by a refresh/crash is finished the next time the app opens (the request id is saved before asking the server).
// CONFIGURING PRIZES: signed-in players use the table wheel_prizes in Supabase; guests use WHEEL_PRIZES below. Keep them equal.
(() => {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

  // ---------- configuration ----------
  const WHEEL = { cost: 50, spinMs: 5600, turns: 6, historyShown: 5 };
  // kind "coins" (amount = coins) | "hint" (hint = reveal | remove | word, amount = uses) | "skip" (amount = skips). weight = how likely (relative).
  const WHEEL_PRIZES = [
    { id: "c25", label: "+25 Coins", kind: "coins", amount: 25, weight: 26 },
    { id: "hint_reveal", label: "Reveal Letter", kind: "hint", hint: "reveal", amount: 1, weight: 14 },
    { id: "c50", label: "+50 Coins", kind: "coins", amount: 50, weight: 20 },
    { id: "skip", label: "Skip", kind: "skip", amount: 1, weight: 12 },
    { id: "hint_word", label: "Clue", kind: "hint", hint: "word", amount: 1, weight: 12 },
    { id: "c100", label: "+100 Coins", kind: "coins", amount: 100, weight: 9 },
    { id: "hint_remove", label: "Remove Wrong", kind: "hint", hint: "remove", amount: 1, weight: 6 },
    { id: "c250", label: "JACKPOT +250", kind: "coins", amount: 250, weight: 1 }
  ];
  const PALETTE = ["#EC4899", "#8B5CF6", "#38BDF8", "#FB923C", "#14B8A6", "#84CC16", "#A78BFA", "#FACC15", "#F43F5E", "#22D3EE"];
  const ICONS = { reveal: "🔍", remove: "🚫", word: "💡" };

  const CSS = `
.wh-top{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px}
.wh-top .wh-title{text-align:center;font-size:1.05rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.wh-right{justify-self:end;display:flex;align-items:center;gap:8px;min-width:0}
.wh-top .coins{height:44px}
.wh-chip{display:inline-flex;align-items:center;gap:5px;height:44px;padding:0 10px;border-radius:999px;background:var(--panel);border:1px solid var(--line);font-weight:900;font-variant-numeric:tabular-nums}
.wh-chip.on{border-color:#4ADE80;box-shadow:0 0 14px color-mix(in srgb,#4ADE80 40%,transparent)}
.wh-chip svg{width:24px;height:24px}
.wh{position:relative;display:grid;justify-items:center;gap:14px;padding:6px 0 90px;isolation:isolate}
.wh::before{content:"";position:absolute;z-index:-1;left:50%;top:-10px;width:min(130vw,760px);aspect-ratio:1;transform:translateX(-50%);border-radius:50%;
  background:radial-gradient(circle,color-mix(in srgb,#8B5CF6 26%,transparent) 0,color-mix(in srgb,#EC4899 12%,transparent) 38%,transparent 66%);filter:blur(10px);pointer-events:none}
.wh-stage{position:relative;width:100%;display:grid;justify-items:center;padding-top:34px}
.wh-box{position:relative;width:min(88vw,46vh,470px);min-width:230px;aspect-ratio:1;filter:drop-shadow(0 20px 26px rgba(0,0,0,.5)) drop-shadow(0 0 28px color-mix(in srgb,#F472B6 30%,transparent))}
.wh-box svg.wh-svg{width:100%;height:100%;display:block;overflow:visible}
.wh-bulb{animation:wh-tw 1.1s ease-in-out infinite alternate}.wh-bulb.b{animation-delay:.55s}
.wh-box.spin .wh-bulb{animation-duration:.25s}
.wh-pointer{position:absolute;left:50%;top:-9%;width:15%;transform:translateX(-50%);transform-origin:50% 22%;filter:drop-shadow(0 5px 5px rgba(0,0,0,.45));pointer-events:none;z-index:2}
.wh-pointer svg{display:block;width:100%;height:auto}
.wh-pointer.tick{animation:wh-flick .13s ease-out}
.wh-status{min-height:38px;display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 16px;border-radius:999px;font-weight:800;font-size:.9rem;text-align:center;background:var(--panel);border:1px solid var(--line);max-width:100%}
.wh-status.free{color:#bbf7d0;background:color-mix(in srgb,#22C55E 20%,var(--panel));border-color:#4ADE80;box-shadow:0 0 18px color-mix(in srgb,#4ADE80 35%,transparent)}
[data-theme=light] .wh-status.free{color:#14532d}
.wh-status.warn{border-color:#FBBF24}
.wh-status b{font-variant-numeric:tabular-nums}
.wh-spin{position:relative;width:min(100%,420px);padding:14px 22px 18px;border:0;border-radius:999px;cursor:pointer;color:#fff;font:inherit;font-weight:900;font-size:clamp(1.4rem,6.4vw,2rem);letter-spacing:1.2px;line-height:1.1;white-space:nowrap;
  text-shadow:0 3px 0 rgba(22,100,10,.6),0 0 12px rgba(255,255,255,.25);background:linear-gradient(180deg,#9BF55C 0%,#62DB26 52%,#43B817 100%);
  box-shadow:0 9px 0 #2B8512,0 20px 32px rgba(70,210,25,.34),inset 0 3px 0 rgba(255,255,255,.6),inset 0 -5px 0 rgba(0,0,0,.14);transition:transform .1s,box-shadow .1s,filter .2s}
.wh-spin::after{content:"";position:absolute;left:8%;right:8%;top:5px;height:38%;border-radius:999px;background:linear-gradient(180deg,rgba(255,255,255,.5),rgba(255,255,255,0));pointer-events:none}
.wh-spin.go{animation:wh-glow 2s ease-in-out infinite}
.wh-spin:hover:not([disabled]){filter:brightness(1.07)}
.wh-spin:active:not([disabled]){transform:translateY(6px);box-shadow:0 3px 0 #2B8512,0 8px 16px rgba(70,210,25,.3),inset 0 3px 0 rgba(255,255,255,.5),inset 0 -5px 0 rgba(0,0,0,.14)}
.wh-spin.low{background:linear-gradient(180deg,#a8a8b3,#85858f 55%,#6c6c76);box-shadow:0 9px 0 #4b4b53,0 16px 24px rgba(0,0,0,.35),inset 0 3px 0 rgba(255,255,255,.4);text-shadow:0 3px 0 rgba(0,0,0,.35);animation:none}
.wh-spin[disabled]{cursor:not-allowed;filter:grayscale(.6) brightness(.9);animation:none}
.wh-hist{width:min(100%,420px);display:grid;gap:8px}
.wh-hist h3{margin:0 2px;font-size:.74rem;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted)}
.wh-hist ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.wh-hist li{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;padding:8px 12px;border-radius:13px;background:var(--panel);border:1px solid var(--line);font-size:.86rem;font-weight:700;animation:wh-in .3s ease both}
.wh-hist li .ic{font-size:1.25rem}.wh-hist li small{color:var(--muted);font-weight:800;font-size:.72rem}
.wh-note{margin:0;width:min(100%,420px);text-align:center;color:var(--muted);font-size:.78rem;line-height:1.45}
.wh-msg{width:min(100%,420px);text-align:center;padding:18px;border-radius:18px;background:var(--panel);border:1px dashed var(--line);color:var(--muted);font-size:.9rem;line-height:1.45}
.wh-win{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:20px;background:rgba(5,5,12,.74);backdrop-filter:blur(5px);animation:wh-fade .25s ease both}
.wh-win-card{position:relative;overflow:hidden;width:min(100%,380px);padding:28px 22px 22px;border-radius:28px;text-align:center;background:linear-gradient(170deg,color-mix(in srgb,var(--c,#FACC15) 24%,var(--panel)),var(--panel) 62%);
  border:2px solid var(--c,#FACC15);box-shadow:0 0 50px color-mix(in srgb,var(--c,#FACC15) 45%,transparent),0 24px 50px rgba(0,0,0,.55);animation:wh-pop .5s cubic-bezier(.2,1.2,.3,1) both}
.wh-rays{position:absolute;left:50%;top:78px;width:560px;height:560px;margin:-280px 0 0 -280px;background:repeating-conic-gradient(color-mix(in srgb,var(--c,#FACC15) 26%,transparent) 0 9deg,transparent 9deg 18deg);
  -webkit-mask:radial-gradient(circle,#000 0,transparent 62%);mask:radial-gradient(circle,#000 0,transparent 62%);animation:wh-rot 14s linear infinite;pointer-events:none}
.wh-win-ic{position:relative;display:grid;place-items:center;width:112px;height:112px;margin:0 auto 6px;border-radius:50%;font-size:3.5rem;background:radial-gradient(circle at 35% 30%,color-mix(in srgb,var(--c,#FACC15) 50%,#fff),color-mix(in srgb,var(--c,#FACC15) 80%,#000));
  border:4px solid #fff;box-shadow:0 8px 24px rgba(0,0,0,.4),0 0 30px color-mix(in srgb,var(--c,#FACC15) 60%,transparent);animation:wh-bounce 1.2s ease-in-out infinite}
.wh-win h2{position:relative;margin:8px 0 2px;font-size:.95rem;letter-spacing:3px;text-transform:uppercase;color:var(--muted)}
.wh-win-p{position:relative;margin:0;font-size:2rem;font-weight:900;line-height:1.1;color:var(--text);text-shadow:0 0 20px color-mix(in srgb,var(--c,#FACC15) 55%,transparent)}
.wh-win small{position:relative;display:block;margin:8px 0 16px;color:var(--muted);font-size:.84rem;line-height:1.4}
.wh-win .wh-collect{position:relative;width:100%;padding:14px;border:0;border-radius:16px;cursor:pointer;font:inherit;font-size:1.1rem;font-weight:900;color:#0b3a05;background:linear-gradient(180deg,#9BF55C,#5ED823);box-shadow:0 6px 0 #2B8512,inset 0 2px 0 rgba(255,255,255,.6)}
.wh-win .wh-collect:active{transform:translateY(4px);box-shadow:0 2px 0 #2B8512}
.whcard{--c:#EC4899;position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:14px;width:100%;padding:12px 16px 12px 12px;border-radius:20px;text-align:left;color:var(--text);font:inherit;cursor:pointer;overflow:hidden;
  background:linear-gradient(115deg,color-mix(in srgb,#8B5CF6 26%,var(--panel)),color-mix(in srgb,#EC4899 16%,var(--panel)) 55%,var(--panel));border:1px solid color-mix(in srgb,#F472B6 45%,var(--line));
  box-shadow:0 6px 20px rgba(0,0,0,.3),0 0 22px color-mix(in srgb,#EC4899 22%,transparent);animation:wh-card 3.2s ease-in-out infinite;transition:transform .2s,border-color .2s}
.whcard:hover{transform:translateY(-3px);border-color:var(--gold)}
.whcard::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.14) 50%,transparent 65%);transform:translateX(-120%);animation:wh-shine 4.5s ease-in-out infinite;pointer-events:none}
.whc-ico{display:block;width:62px;height:62px;filter:drop-shadow(0 4px 8px rgba(0,0,0,.45)) drop-shadow(0 0 12px color-mix(in srgb,#F472B6 55%,transparent))}
.whc-ico svg{width:100%;height:100%;display:block;animation:wh-rot 16s linear infinite}
.whc-txt{display:grid;gap:2px;min-width:0}.whc-txt b{font-size:1.1rem}.whc-txt small{color:var(--muted);font-size:.82rem;line-height:1.3}
.whc-tag{padding:6px 12px;border-radius:999px;font-size:.72rem;font-weight:900;letter-spacing:1px;color:#0b3a05;background:linear-gradient(180deg,#9BF55C,#5ED823);box-shadow:0 3px 0 #2B8512;white-space:nowrap}
.whc-tag.used{color:var(--muted);background:var(--panel-2);box-shadow:none;border:1px solid var(--line)}
.whc-tag:not(.used){animation:wh-pulse 1.6s ease-in-out infinite}
@media (max-height:700px){.wh-box{width:min(80vw,44vh,470px)}}
@media (min-width:700px){.wh{gap:18px}}
@keyframes wh-tw{from{opacity:.45;transform:scale(.8)}to{opacity:1;transform:scale(1.12)}}
@keyframes wh-flick{0%{transform:translateX(-50%) rotate(0)}40%{transform:translateX(-50%) rotate(-16deg)}100%{transform:translateX(-50%) rotate(0)}}
@keyframes wh-glow{50%{box-shadow:0 9px 0 #2B8512,0 20px 44px rgba(90,240,40,.6),inset 0 3px 0 rgba(255,255,255,.6),inset 0 -5px 0 rgba(0,0,0,.14)}}
@keyframes wh-in{from{opacity:0;transform:translateY(8px)}}
@keyframes wh-fade{from{opacity:0}}
@keyframes wh-pop{from{opacity:0;transform:scale(.6) translateY(30px)}}
@keyframes wh-rot{to{transform:rotate(360deg)}}
@keyframes wh-bounce{50%{transform:translateY(-8px) scale(1.04)}}
@keyframes wh-card{50%{box-shadow:0 6px 20px rgba(0,0,0,.3),0 0 34px color-mix(in srgb,#EC4899 42%,transparent)}}
@keyframes wh-shine{0%,55%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
@keyframes wh-pulse{50%{transform:scale(1.08)}}
html[data-motion=reduced] .whcard,html[data-motion=reduced] .whcard::after,html[data-motion=reduced] .whc-ico svg,html[data-motion=reduced] .whc-tag,html[data-motion=reduced] .wh-bulb,html[data-motion=reduced] .wh-spin,html[data-motion=reduced] .wh-win *,html[data-motion=reduced] .wh-win{animation:none!important}
`;
  if (!document.getElementById("wh-css")) { const st = document.createElement("style"); st.id = "wh-css"; st.textContent = CSS; document.head.append(st); }

  // ---------- helpers ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };   // the player's local date
  const validDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const nextMidnight = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); };
  const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };
  const quick = () => typeof reduced === "function" && reduced();
  const say = (t, k, ms) => { if (typeof toast === "function") toast(t, k || "", ms); };
  const isAcct = () => !!(window.Auth && Auth.isAccount && Auth.isAccount());
  const curScreen = () => (typeof screen === "string" ? screen : "");
  const mod = (a, n) => ((a % n) + n) % n;
  const uuid = () => { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); const a = new Uint8Array(16); crypto.getRandomValues(a); a[6] = (a[6] & 15) | 64; a[8] = (a[8] & 63) | 128; const h = [...a].map((b) => b.toString(16).padStart(2, "0")).join(""); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
  const rand = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; };
  function shade(hex, amt) { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt)))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; }
  const iconOf = (p) => (p.kind === "coins" ? (p.amount >= 250 ? "💰" : "🪙") : p.kind === "skip" ? "⏭️" : ICONS[p.hint] || "🎁");
  const shortOf = (p) => (p.kind === "coins" ? "+" + p.amount : p.kind === "skip" ? "SKIP" : p.hint === "reveal" ? "REVEAL" : p.hint === "remove" ? "REMOVE" : p.hint === "word" ? "CLUE" : "+" + p.amount);
  const colorOf = (i) => PALETTE[i % PALETTE.length];
  const nameOf = (p) => (p.kind === "coins" ? `${p.amount} coins` : p.kind === "skip" ? `${p.amount} Skip${p.amount > 1 ? "s" : ""}` : `${p.amount} ${p.label}`);

  // ---------- saved state (per player profile, through the app's own load/save) ----------
  const readFree = () => { const r = load("wheel_free", {}); return r && validDay(r.day) ? r.day : ""; };
  const writeFree = (d) => { d = d ? String(d).slice(0, 10) : ""; if (validDay(d) && d > readFree()) save("wheel_free", { day: d }, true); };      // never moves backwards: turning the clock back can't re-open the spin
  const freeAvailable = () => readFree() < todayStr();
  const readHist = () => { const h = load("wheel_hist", []); return Array.isArray(h) ? h.filter((x) => x && typeof x.prize === "string") : []; };
  const pushHist = (e) => { const h = [e, ...readHist()].slice(0, 20); save("wheel_hist", h, true); return h; };

  // ---------- state ----------
  let prizes = WHEEL_PRIZES.map((p) => ({ ...p }));
  let st = "idle";                // idle | loading | ready | offline | setup
  let spinning = false, rot = 0, built = false, lastStatusAt = 0, cfgDone = false, tickT = 0, lastTickSfx = 0, hist = [];
  let serverHist = null;

  async function rpc(fn, args) {
    const c = window.Auth && Auth.client && Auth.client(); if (!c || !isAcct()) return { error: "offline" };
    try {
      const r = await c.rpc(fn, args || {});
      if (r.error) { const m = String(r.error.message || ""); return { error: (r.error.code === "PGRST202" || /could not find the function|schema cache/i.test(m)) ? "setup" : "server" }; }
      return r.data || {};
    } catch { return { error: "offline" }; }
  }
  async function loadStatus(force) {
    if (!isAcct()) { st = "ready"; serverHist = null; hist = readHist(); return; }
    if (!force && st === "ready" && Date.now() - lastStatusAt < 60000) return;
    if (st !== "ready") st = "loading"; ui();
    const s = await rpc("wheel_status");
    if (s.error) { st = s.error === "setup" ? "setup" : "offline"; ui(); cardUpdate(); return; }
    writeFree(s.last_free_day); serverHist = Array.isArray(s.history) ? s.history : []; hist = serverHist.map((h) => ({ prize: h.prize, free: h.free, cost: h.cost, at: h.ts }));
    lastStatusAt = Date.now(); st = "ready";
    if (!cfgDone) {
      const c = await rpc("wheel_config");
      if (Array.isArray(c) && c.length >= 6 && c.length <= 10) { const next = c.map((p) => ({ id: p.id, label: p.label, kind: p.kind, amount: Number(p.amount), hint: p.hint || undefined })); if (JSON.stringify(next.map((p) => p.id)) !== JSON.stringify(prizes.map((p) => p.id)) || JSON.stringify(next) !== JSON.stringify(prizes.map(({ weight, ...r }) => r))) { prizes = next; built = false; } cfgDone = true; }
    }
    ui(); cardUpdate();
  }

  // ---------- drawing the wheel ----------
  const pt = (a, r) => { const t = (a * Math.PI) / 180; return [(200 + r * Math.sin(t)).toFixed(2), (200 - r * Math.cos(t)).toFixed(2)]; };
  function wheelSvg(list, o) {
    o = o || {}; const px = o.pfx || "w", n = list.length, step = 360 / n, mini = !!o.mini;
    let d = `<defs><linearGradient id="${px}rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#e9ebf2"/><stop offset="1" stop-color="#b9bdca"/></linearGradient>
      <linearGradient id="${px}gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF1A8"/><stop offset=".5" stop-color="#F5B90B"/><stop offset="1" stop-color="#B47A06"/></linearGradient>
      <linearGradient id="${px}hub" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F9A8D4"/><stop offset=".55" stop-color="#EC4899"/><stop offset="1" stop-color="#A21CAF"/></linearGradient>
      <linearGradient id="${px}gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>`;
    list.forEach((p, i) => { const c = colorOf(i); d += `<radialGradient id="${px}s${i}" cx="200" cy="200" r="166" gradientUnits="userSpaceOnUse"><stop offset=".14" stop-color="${shade(c, -0.3)}"/><stop offset=".6" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, 0.32)}"/></radialGradient>`; });
    d += `</defs>`;
    if (!mini) { d += `<circle cx="200" cy="200" r="197" fill="url(#${px}gold)"/><circle cx="200" cy="200" r="193" fill="url(#${px}rim)"/><circle cx="200" cy="200" r="171" fill="url(#${px}gold)"/>`; }
    else d += `<circle cx="200" cy="200" r="196" fill="url(#${px}rim)"/><circle cx="200" cy="200" r="172" fill="url(#${px}gold)"/>`;
    let seg = "";
    list.forEach((p, i) => {
      const a0 = i * step, a1 = (i + 1) * step, [x0, y0] = pt(a0, 166), [x1, y1] = pt(a1, 166);
      seg += `<path d="M200 200L${x0} ${y0}A166 166 0 0 1 ${x1} ${y1}Z" fill="url(#${px}s${i})" stroke="#fff" stroke-width="${mini ? 5 : 3.5}" stroke-linejoin="round"/>`;
      if (!mini) {
        const c = a0 + step / 2, coin = p.kind === "coins", t = esc(shortOf(p));
        seg += `<g transform="rotate(${c.toFixed(2)} 200 200)"><text x="200" y="${coin ? 74 : 76}" font-size="${coin ? 38 : 36}" text-anchor="middle" dominant-baseline="central" style="font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif">${iconOf(p)}</text>
          <text x="200" y="${coin ? 110 : 108}" font-size="${coin ? (t.length > 4 ? 19 : 22) : 12}" font-weight="900" text-anchor="middle" dominant-baseline="central" fill="#fff" stroke="rgba(40,10,60,.5)" stroke-width="3.5" paint-order="stroke" style="font-family:system-ui,'Segoe UI',Arial,sans-serif;letter-spacing:.4px">${t}</text></g>`;
      }
    });
    d += `<g id="${px}rot" class="wh-rotg" style="transform-origin:200px 200px;transform:rotate(${rot}deg)">${seg}</g>`;
    d += `<circle cx="200" cy="200" r="166" fill="url(#${px}gloss)" pointer-events="none"/>`;
    if (!mini) {
      for (let i = 0; i < 20; i++) { const [x, y] = pt(i * 18, 182); d += `<circle class="wh-bulb${i % 2 ? " b" : ""}" cx="${x}" cy="${y}" r="4.8" fill="#FFE9A0" stroke="#F5B90B" stroke-width="1.4" style="transform-origin:${x}px ${y}px"/>`; }
      d += `<circle cx="200" cy="200" r="48" fill="url(#${px}gold)"/><circle cx="200" cy="200" r="44" fill="url(#${px}rim)"/><circle cx="200" cy="200" r="35" fill="url(#${px}hub)" stroke="#fff" stroke-width="2.5"/>
        <text x="200" y="201" font-size="40" font-weight="900" text-anchor="middle" dominant-baseline="central" fill="#fff" style="font-family:system-ui,Arial,sans-serif" opacity=".92">W</text>`;
    } else d += `<circle cx="200" cy="200" r="38" fill="url(#${px}rim)"/><circle cx="200" cy="200" r="28" fill="url(#${px}hub)"/>`;
    return `<svg class="wh-svg" viewBox="0 0 400 400" ${mini ? 'aria-hidden="true" focusable="false"' : `role="img" aria-label="Prize wheel: ${esc(list.map((p) => p.label).join(", "))}"`} xmlns="http://www.w3.org/2000/svg">${d}</svg>`;
  }
  const POINTER = `<svg viewBox="0 0 60 82" aria-hidden="true" focusable="false"><defs><linearGradient id="wp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF7A7A"/><stop offset=".55" stop-color="#EF2B3B"/><stop offset="1" stop-color="#B3101F"/></linearGradient></defs>
    <path d="M30 80C30 80 4 48 4 28a26 26 0 1 1 52 0C56 48 30 80 30 80Z" fill="url(#wp)" stroke="#FFE9A0" stroke-width="3"/><circle cx="30" cy="28" r="10" fill="#fff"/><ellipse cx="23" cy="16" rx="8" ry="5" fill="#fff" opacity=".35" transform="rotate(-30 23 16)"/></svg>`;

  function build() {
    const root = $("#wh-root"); if (!root) return;
    root.innerHTML = `<div class="wh-stage"><div class="wh-box" id="wh-box">${wheelSvg(prizes, { pfx: "w" })}<div class="wh-pointer" id="wh-pointer">${POINTER}</div></div></div>
      <div class="wh-status" id="wh-status" role="status" aria-live="polite"></div>
      <button class="wh-spin" id="wh-spin" type="button"><span id="wh-spin-t">SPIN</span></button>
      <p class="wh-note" id="wh-note"></p>
      <div class="wh-hist" id="wh-hist"></div>`;
    built = true; applyRot();
    $("#wh-spin").addEventListener("click", spin);
  }
  const applyRot = () => { const g = $("#wrot"); if (g) g.style.transform = `rotate(${rot}deg)`; };

  // ---------- UI state ----------
  function ui() {
    if (!built || !$("#wh-root")) return;
    const free = freeAvailable(), coins = Player.data.coins, low = !free && coins < WHEEL.cost;
    const btn = $("#wh-spin"), t = $("#wh-spin-t"), s = $("#wh-status");
    if (!btn) return;
    const ok = st === "ready";
    btn.disabled = spinning || !ok; btn.classList.toggle("low", ok && low && !spinning); btn.classList.toggle("go", ok && !low && !spinning);
    t.textContent = spinning ? "SPINNING…" : !ok ? (st === "loading" ? "LOADING…" : "UNAVAILABLE") : free ? "SPIN – FREE" : `SPIN – ${WHEEL.cost} COINS`;
    btn.setAttribute("aria-label", spinning ? "Spinning" : !ok ? "Spin unavailable" : free ? "Spin the wheel, free" : `Spin the wheel for ${WHEEL.cost} coins`);
    const chip = $("#wh-chip"); if (chip) { chip.classList.toggle("on", ok && free); $("#wh-chip-n").textContent = ok && free ? "1" : "0"; }
    s.className = "wh-status";
    if (st === "loading") s.textContent = "Checking your free spin…";
    else if (st === "setup") { s.classList.add("warn"); s.textContent = "Spin Wheel isn't set up on the server yet (run 008_spin_wheel.sql)."; }
    else if (st === "offline") { s.classList.add("warn"); s.textContent = "You need to be online to spin. Check your connection."; }
    else if (free) { s.classList.add("free"); s.textContent = "🎁 Your FREE spin is ready!"; }
    else if (low) { s.classList.add("warn"); s.innerHTML = `Not enough coins · a spin costs <b>${WHEEL.cost}</b> 🪙`; }
    else s.innerHTML = `✅ Free spin used · next free spin in <b id="wh-count">${clock(nextMidnight() - Date.now())}</b>`;
    const note = $("#wh-note"); if (note) note.textContent = isAcct() ? "The prize is picked securely on the server. Your free spin resets every day." : "You're a guest: spins are saved on this device. Create an account to keep them safe across devices.";
    drawHist();
  }
  function drawHist() {
    const el = $("#wh-hist"); if (!el) return;
    const items = hist.slice(0, WHEEL.historyShown).map((h) => { const p = prizes.find((x) => x.id === h.prize) || WHEEL_PRIZES.find((x) => x.id === h.prize); return p ? `<li><span class="ic" aria-hidden="true">${iconOf(p)}</span><span>${esc(p.label)}</span><small>${h.free ? "FREE" : "-" + (h.cost || WHEEL.cost)}</small></li>` : ""; }).join("");
    el.innerHTML = items ? `<h3>Recent spins</h3><ul>${items}</ul>` : "";
  }
  function cardUpdate() {
    const free = freeAvailable(), sub = $("[data-wh-sub]"), tag = $("[data-wh-tag]");
    if (sub) sub.textContent = free ? "Your free spin is ready!" : `Next free spin in ${clock(nextMidnight() - Date.now())}`;
    if (tag) { tag.textContent = free ? "FREE" : `${WHEEL.cost} 🪙`; tag.classList.toggle("used", !free); }
    const ico = $("[data-wh-ico]"); if (ico && !ico.firstChild) ico.innerHTML = wheelSvg(prizes, { pfx: "m", mini: true });
  }
  setInterval(() => {
    const c = $("#wh-count"); if (c) { const left = nextMidnight() - Date.now(); c.textContent = clock(left); }
    if (!spinning && st === "ready" && curScreen() === "wheel" && $("#wh-status") && !$("#wh-status").classList.contains("free") && freeAvailable()) ui();   // midnight passed: the free spin is back
    if (curScreen() === "dashboard") cardUpdate();
  }, 1000);

  // ---------- the spin ----------
  const segAt = (r) => Math.floor(mod(-r, 360) / (360 / prizes.length)) % prizes.length;
  function tickFx() {
    const p = $("#wh-pointer"); if (!p) return;
    p.classList.remove("tick"); void p.offsetWidth; p.classList.add("tick");
    const now = performance.now(); if (now - lastTickSfx > 70 && typeof sfx !== "undefined" && sfx.key) { lastTickSfx = now; sfx.key(); }
  }
  function animateTo(target, dur) {
    return new Promise((res) => {
      const from = rot, t0 = performance.now(); let seg = segAt(from);
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 4);
        rot = from + (target - from) * e; applyRot();
        const s = segAt(rot); if (s !== seg) { seg = s; if (!quick()) tickFx(); }
        if (k < 1) requestAnimationFrame(step); else { rot = target; applyRot(); res(); }
      };
      requestAnimationFrame(step);
    });
  }
  function targetFor(idx) {                                          // lands INSIDE the chosen section (a little off-centre, never on a border)
    const step = 360 / prizes.length, jit = (rand() - 0.5) * step * 0.6, need = mod(-(idx * step + step / 2 + jit), 360);
    return rot + 360 * (quick() ? 1 : WHEEL.turns) + mod(need - mod(rot, 360), 360);
  }
  function pickLocal() {                                             // guests: the same weighted pick, on this device
    const list = WHEEL_PRIZES, total = list.reduce((a, p) => a + p.weight, 0); let r = rand() * total;
    for (const p of list) { r -= p.weight; if (r < 0) return p; } return list[0];
  }
  const asPrize = (p) => ({ id: p.id, label: p.label, kind: p.kind, amount: Number(p.amount) || 1, hint: p.hint || undefined });

  async function spin() {
    if (spinning || st !== "ready") return;
    const free = freeAvailable();
    if (!free && Player.data.coins < WHEEL.cost) { ui(); return typeof needCoins === "function" ? needCoins(WHEEL.cost) : undefined; }
    spinning = true; ui();
    const req = uuid(), day = todayStr(); let prize, isFree, cost, useDay = day;
    if (isAcct()) {
      save("wheel_pending", { req, acct: true, day, t: Date.now() }, true);         // saved BEFORE asking, so a lost answer can be fetched again by this id
      const r = await rpc("spin_wheel", { p_req: req, p_day: day, p_allow_paid: Player.data.coins >= WHEEL.cost });
      if (r.error || !r.ok) {
        spinning = false;
        if (r.error === "setup") { st = "setup"; save("wheel_pending", null, true); }
        else if (r.error) { say("Couldn't reach the server. No coins were taken.", "error", 3400); }   // the saved request id is checked again later (recover)
        else {
          save("wheel_pending", null, true);
          if (r.reason === "free_used") { writeFree(r.last_free_day || day); say("Your free spin was already used today.", "", 3200); }
          else if (r.reason === "bad_day") say("Your device's date looks wrong. Please correct it and try again.", "error", 3800);
          else say(r.reason === "limit" ? "You've reached today's spin limit. Try again tomorrow." : "The wheel isn't available right now.", "error", 3400);
        }
        ui(); cardUpdate(); return;
      }
      prize = asPrize(r.prize); isFree = !!r.free; cost = Number(r.cost) || 0; useDay = r.day || day;
    } else {
      prize = asPrize(pickLocal()); isFree = free; cost = free ? 0 : WHEEL.cost;
      save("wheel_pending", { req, acct: false, day, free: isFree, cost, prize }, true);
    }
    let idx = prizes.findIndex((p) => p.id === prize.id);
    if (idx < 0 && isAcct()) { cfgDone = false; await loadStatus(true); idx = prizes.findIndex((p) => p.id === prize.id); }
    if (idx >= 0) { if (!built) build(); await animateTo(targetFor(idx), quick() ? 700 : WHEEL.spinMs); }
    finish(req, prize, isFree, cost, useDay, false);
  }

  // Takes the cost and adds the prize (once per request id), then shows the result.
  function finish(req, prize, free, cost, day, silent) {
    if (free) writeFree(day);
    const had = (Player.data.rewarded || []).includes("S:" + req);
    const res = had ? null : Player.applySpin(req, cost, prize);
    save("wheel_pending", null, true);
    if (res) { hist = pushHist({ prize: prize.id, free, cost, at: new Date().toISOString() }); }
    spinning = false; lastStatusAt = Date.now();
    ui(); cardUpdate();
    if (!res) { if (!had) say("Not enough coins for that spin. The prize was not added.", "error", 3600); else refreshCoins(); return; }
    const net = res.coins - cost, onScreen = curScreen() === "wheel";
    if (silent || !onScreen) { refreshCoins(); say(`🎡 Spin Wheel: ${nameOf(prize)} added!`, "success", 3600); return; }
    showWin(prize, net, cost);
  }

  function showWin(prize, net, cost) {
    const old = $("#wh-win"); if (old) old.remove();
    const jackpot = prize.kind === "coins" && prize.amount >= 250, c = colorOf(Math.max(0, prizes.findIndex((p) => p.id === prize.id)));
    const el = document.createElement("div"); el.id = "wh-win"; el.className = "wh-win"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "wh-win-t");
    const sub = prize.kind === "coins" ? (cost ? `Spin cost ${cost} coins · net ${net >= 0 ? "+" : ""}${net}` : "Free spin · added to your balance") : `Added to your items. Use it in a game.`;
    el.innerHTML = `<div class="wh-win-card" style="--c:${c}"><div class="wh-rays"></div><div class="wh-win-ic" id="wh-win-ic" aria-hidden="true">${iconOf(prize)}</div><h2 id="wh-win-t">${jackpot ? "JACKPOT!" : "You won"}</h2><p class="wh-win-p">${esc(prize.kind === "coins" ? "+" + prize.amount + " coins" : nameOf(prize))}</p><small>${esc(sub)}</small><button class="wh-collect" id="wh-collect" type="button">Collect</button></div>`;
    document.body.append(el); if (typeof lockModal === "function") lockModal(true);
    if (typeof sfx !== "undefined") { if (jackpot && sfx.win) sfx.win(); else if (sfx.coin) sfx.coin(); }
    if (typeof confetti === "function") { confetti(); if (jackpot) setTimeout(confetti, 500); }
    let closed = false;
    const close = () => {
      if (closed) return; closed = true; const ic = $("#wh-win-ic"); el.remove(); if (typeof lockModal === "function") lockModal(false);
      document.removeEventListener("keydown", onKey);
      if (prize.kind === "coins" && typeof coinsToBalance === "function" && ic !== null) coinsToBalance($("#wh-box") || document.body, net); else refreshCoins();
      const b = $("#wh-spin"); if (b && !b.disabled) b.focus({ preventScroll: true });
    };
    const onKey = (e) => { if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); close(); } };
    document.addEventListener("keydown", onKey);
    $("#wh-collect").addEventListener("click", close); el.addEventListener("click", (e) => { if (e.target === el) close(); });
    $("#wh-collect").focus({ preventScroll: true });
  }

  // A spin that was interrupted (refresh, crash, lost connection) is finished the next time the app opens.
  let recovering = false;
  async function recover() {
    if (recovering || spinning) return; const pend = load("wheel_pending", null); if (!pend || !pend.req) return;
    if (pend.acct && !isAcct()) return;
    recovering = true;
    try {
      if (pend.acct) {
        const r = await rpc("wheel_result", { p_req: pend.req });
        if (r.error) return;                                                         // offline: try again later
        if (!r.ok) { save("wheel_pending", null, true); return; }                    // the server never recorded it: nothing was won, nothing is owed
        finish(pend.req, asPrize(r.prize), !!r.free, Number(r.cost) || 0, r.day || pend.day, true);
      } else if (pend.prize) finish(pend.req, asPrize(pend.prize), !!pend.free, Number(pend.cost) || 0, pend.day, true);
      else save("wheel_pending", null, true);
    } finally { recovering = false; }
  }

  function screenChanged(name) {
    if (name === "wheel") {
      if (!built) build();
      loadStatus(true).then(() => { ui(); }); ui(); recover();
    } else if (name === "dashboard") { cardUpdate(); loadStatus(false); recover(); }
  }
  // first start: show the dashboard card state, finish any interrupted spin
  setTimeout(() => { cardUpdate(); if (isAcct()) loadStatus(false); recover(); }, 1800);
  setInterval(() => { if (curScreen() === "wheel" || curScreen() === "dashboard") recover(); }, 20000);
  window.Wheel = { screenChanged, refreshCard: cardUpdate };
})();
