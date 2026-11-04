// Team Zone battle screen. It reuses the solo game screen (#game): same board, keyboard, tile colours, hint buttons and timer style.
// Nothing here decides anything. Every guess and hint goes to the server (tz_guess / tz_hint), which checks the word, colours it,
// keeps the clock, and ends the battle. This file only draws what comes back. The secret word is only sent after the battle.
// While a team battle is on, the solo game's keyboard and click handlers are switched off (capture-phase listeners below).
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const ROWS = 6, COLS = 5;
  const KIND = { g: "correct", y: "present", x: "absent" };
  const HINT = { reveal: "Reveal a Letter", remove: "Remove Letters", word: "Use Clue" };
  const CSS = `
#game.team #btn-skip{display:none}
#game.team .hint .cnt{display:none}
#game.team .controls{grid-template-columns:var(--side) minmax(0,1fr) var(--side)}
#game.team .hint[data-state=used]{opacity:.5;filter:grayscale(.7)}
#game.team .hint .badge{font-size:.62rem;font-weight:800;letter-spacing:.4px}
#game.team #board{width:min(100%,340px,max(170px,calc((100dvh - 540px)*5/6)))}
#game.team .winscore{visibility:hidden}
.tzg-top{display:grid;gap:6px;flex:none;padding:2px 0 4px}
.tzg-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.tzg-h{margin:0;text-align:left;font-size:.95rem;font-weight:900;letter-spacing:3px;background:linear-gradient(90deg,var(--gold),var(--red1,#E0264F),var(--gold));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.tzg-bar{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px}
.tzg-strip{display:flex;gap:6px;width:100%;overflow-x:auto;scroll-snap-type:x proximity;padding:2px 2px 4px;scrollbar-width:none}
.tzg-strip::-webkit-scrollbar{display:none}
.tzg-pc{flex:1 0 118px;max-width:150px;scroll-snap-align:start;display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px;align-items:center;padding:5px 7px 5px 5px;border-radius:12px;background:var(--panel);border:1px solid var(--line);transition:border-color .3s,box-shadow .3s}
.tzg-pc.me{border-color:color-mix(in srgb,var(--gold) 60%,var(--line))}
.tzg-pc.solved{border-color:#4ADE80;box-shadow:0 0 14px color-mix(in srgb,#4ADE80 35%,transparent)}
.tzg-pc.out{opacity:.62}
.tzg-av{position:relative;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;font-size:1.1rem;background:var(--panel-2);border:2px solid var(--line)}
.tzg-av i{position:absolute;right:-2px;bottom:-2px;width:10px;height:10px;border-radius:50%;background:#8b8b92;border:2px solid var(--panel)}
.tzg-av i.connected{background:#4ADE80}.tzg-av i.reconnecting{background:#FBBF24}.tzg-av i.disconnected,.tzg-av i.left{background:#F87171}
.tzg-pc b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.74rem}
.tzg-pc small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.64rem;color:var(--muted)}
.tzg-pc small.on{color:#4ADE80}.tzg-pc small.re{color:#FBBF24}.tzg-pc small.off{color:#F87171}
.tzg-dots{display:flex;gap:2px;margin-top:2px}
.tzg-dots i{width:6px;height:6px;border-radius:50%;background:var(--panel-2);border:1px solid var(--line)}
.tzg-dots i.used{background:var(--gold);border-color:var(--gold)}
.tzg-dots i.bad{background:#F87171;border-color:#F87171}
.tzg-tm{display:grid;justify-items:center;min-width:58px;font-variant-numeric:tabular-nums}
.tzg-tm b{font-size:1.2rem;line-height:1;letter-spacing:.5px}.tzg-tm small{font-size:.58rem;font-weight:800;letter-spacing:1.5px;color:var(--muted)}
.tzg-tm.low b{color:#F87171;animation:tzg-blink 1s steps(2) infinite}
.tzg-note{margin:0;min-height:1.1em;text-align:center;font-size:.76rem;font-weight:700;color:var(--muted)}
.tzg-note.warn{color:#FBBF24}
.tzg-clue{margin:0;text-align:center;font-size:.76rem;color:var(--muted);padding:0 6px}.tzg-clue b{color:var(--gold)}
.tzg-cd{position:absolute;inset:0;z-index:5;display:grid;place-items:center;align-content:center;gap:4px;border-radius:12px;background:color-mix(in srgb,var(--bg,#000) 78%,transparent);backdrop-filter:blur(3px)}
.tzg-cd b{font-size:5rem;line-height:1;color:var(--gold);animation:tzg-pop .9s ease both}.tzg-cd span{font-size:.8rem;font-weight:800;letter-spacing:2px;color:var(--muted)}
.tzg-res{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.66);backdrop-filter:blur(5px);animation:tzg-fade .3s ease both;overflow:auto}
.tzg-card{display:grid;gap:12px;width:min(100%,420px);margin:auto;padding:22px 18px;border-radius:24px;text-align:center;background:linear-gradient(170deg,color-mix(in srgb,var(--c) 18%,var(--panel)),var(--panel) 65%);border:1px solid color-mix(in srgb,var(--c) 55%,var(--line));box-shadow:0 0 40px color-mix(in srgb,var(--c) 30%,transparent);animation:tzg-pop .5s cubic-bezier(.2,1.2,.3,1) both}
.tzg-card.win{--c:#FACC15}.tzg-card.loss{--c:#F87171}.tzg-card.draw{--c:#7C8CFF}
.tzg-card h2{margin:0;font-size:1.6rem;font-weight:900;letter-spacing:2px;color:var(--c)}
.tzg-card p{margin:0;color:var(--muted);font-size:.9rem;line-height:1.45}
.tzg-rank{list-style:none;margin:0;padding:0;display:grid;gap:8px;text-align:left}
.tzg-rc{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 12px;border-radius:16px;background:var(--panel-2);border:1px solid var(--line);font-size:.9rem;position:relative;overflow:hidden}
.tzg-rc.me{box-shadow:0 0 0 1px color-mix(in srgb,var(--gold) 45%,transparent)}
.tzg-rc.gold{background:linear-gradient(120deg,color-mix(in srgb,#FACC15 22%,var(--panel-2)),var(--panel-2) 70%);border-color:#FACC15;box-shadow:0 0 20px color-mix(in srgb,#FACC15 30%,transparent)}
.tzg-rc.silver{background:linear-gradient(120deg,color-mix(in srgb,#CBD5E1 18%,var(--panel-2)),var(--panel-2) 70%);border-color:#CBD5E1}
.tzg-rc.bronze{background:linear-gradient(120deg,color-mix(in srgb,#F59E0B 16%,var(--panel-2)),var(--panel-2) 70%);border-color:#B7791F}
.tzg-pos{display:grid;justify-items:center;min-width:46px;font-variant-numeric:tabular-nums}
.tzg-pos i{font-style:normal;font-size:1.05rem;line-height:1}
.tzg-pos b{font-size:.78rem;font-weight:900;letter-spacing:.5px}
.tzg-av{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;font-size:1.3rem;background:var(--panel);border:1px solid var(--line)}
.tzg-who{display:grid;gap:2px;min-width:0}
.tzg-who b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.92rem}
.tzg-who small{color:var(--muted);font-size:.72rem;font-variant-numeric:tabular-nums}
.tzg-earn{display:grid;justify-items:end;gap:3px}
.tzg-coin,.tzg-xp{font-size:.74rem;font-weight:900;font-variant-numeric:tabular-nums;white-space:nowrap}
.tzg-coin{color:var(--gold)}.tzg-xp{color:#7DD3FC}
.tzg-add{margin-top:2px;padding:5px 9px;border-radius:999px;border:1px solid color-mix(in srgb,var(--gold) 60%,var(--line));background:color-mix(in srgb,var(--gold) 16%,var(--panel));color:var(--text);font:inherit;font-size:.7rem;font-weight:800;cursor:pointer;white-space:nowrap}
.tzg-add:disabled{opacity:.6;cursor:default}
.tzg-fr{margin-top:2px;font-size:.7rem;font-weight:800;color:var(--muted);white-space:nowrap}.tzg-fr.ok{color:#4ADE80}
.tzg-rmbox{display:grid;gap:8px;justify-items:stretch;text-align:center}
.tzg-rmbox .tzg-row{display:flex;gap:8px}.tzg-rmbox .tzg-row>*{flex:1}
.tzg-go{padding:11px 14px;border-radius:14px;border:0;font:inherit;font-weight:900;cursor:pointer;color:#0b3a05;background:linear-gradient(180deg,#9BF55C,#5ED823);box-shadow:0 4px 0 #2B8512}
.tzg-go.alt{color:var(--text);background:var(--panel-2);box-shadow:0 3px 0 var(--line)}
.tzg-go:disabled{opacity:.6;cursor:default}
.tzg-ask{margin:0;font-size:.88rem;font-weight:700}
@media (max-width:380px){.tzg-rc{grid-template-columns:auto minmax(0,1fr);}.tzg-rc .tzg-earn{grid-column:2;justify-items:start;grid-auto-flow:column;gap:8px;align-items:center}.tzg-rc .tzg-pos{grid-row:span 2}}
.tzg-ans{font-size:.88rem;color:var(--muted)}.tzg-ans b{color:var(--text);letter-spacing:3px;font-size:1rem}
.tzg-hostnote{font-size:.78rem}.tzg-hostnote b{letter-spacing:0;font-size:inherit;color:var(--text)}
.tzg-res.rm-open{padding-bottom:min(66vh,380px)}
.tzg-rm{position:fixed;z-index:65;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);width:min(calc(100vw - 24px),360px);max-height:min(62vh,440px);overflow:auto;box-sizing:border-box;display:grid;gap:9px;padding:14px;border-radius:18px;background:linear-gradient(170deg,color-mix(in srgb,var(--gold) 14%,var(--panel)),var(--panel) 70%);border:1px solid color-mix(in srgb,var(--gold) 55%,var(--line));box-shadow:0 12px 32px rgba(0,0,0,.5),0 0 22px color-mix(in srgb,var(--gold) 20%,transparent);animation:tzg-rmin .3s cubic-bezier(.2,.9,.3,1.2) both}
.tzg-rm-h{display:flex;align-items:center;justify-content:space-between;gap:10px}.tzg-rm-h b{font-size:.98rem;color:var(--gold);letter-spacing:.3px;line-height:1.2}
.tzg-rm-n{padding:3px 10px;border-radius:999px;background:var(--panel-2);border:1px solid var(--line);font-size:.74rem;font-weight:800;white-space:nowrap}
.tzg-rm-p{margin:0;font-size:.84rem;line-height:1.4;color:var(--text)}
.tzg-rm-bar{height:5px;border-radius:5px;background:var(--panel-2);overflow:hidden}.tzg-rm-bar i{display:block;height:100%;width:100%;background:linear-gradient(90deg,var(--gold-dim),var(--gold));transition:width .25s linear}
.tzg-rm-l{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.tzg-rm-l li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 8px;border-radius:12px;background:var(--panel-2);border:1px solid var(--line);font-size:.84rem}
.tzg-rm-l li b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;color:var(--text)}
.tzg-rms{font-size:.74rem;font-weight:800;white-space:nowrap;color:var(--muted)}
.tzg-rm-l li.accepted{border-color:color-mix(in srgb,#22a45d 55%,var(--line))}.tzg-rm-l li.accepted .tzg-rms{color:#22a45d}
.tzg-rm-l li.declined{border-color:color-mix(in srgb,#e5484d 55%,var(--line))}.tzg-rm-l li.declined .tzg-rms{color:#e5484d}
.tzg-rm .tzg-av{width:28px;height:28px;font-size:1.05rem}
.tzg-rm-s{margin:0;text-align:center;color:var(--muted);font-size:.78rem}
.tzg-rm .tzg-row{display:flex;gap:8px}.tzg-rm .tzg-row>*{flex:1}
.tzg-rm .tzg-go{padding:10px 12px;font-size:.88rem}
@keyframes tzg-rmin{from{opacity:0;transform:translate(-50%,16px)}}
@media (max-width:360px){.tzg-rm{padding:12px}.tzg-rm-l li{font-size:.8rem}}
@keyframes tzg-blink{50%{opacity:.45}}
@keyframes tzg-pop{from{opacity:0;transform:scale(.6)}60%{transform:scale(1.05)}}
@keyframes tzg-fade{from{opacity:0}}
html[data-motion=reduced] .tzg-rm,html[data-motion=reduced] .tzg-cd b,html[data-motion=reduced] .tzg-card,html[data-motion=reduced] .tzg-tm.low b{animation:none!important}
`;
  if (!document.getElementById("tzg-css")) { const st = document.createElement("style"); st.id = "tzg-css"; st.textContent = CSS; document.head.append(st); }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = () => window.TeamZone && TeamZone.api;
  const snd = (n, ...a) => { try { if (typeof sfx !== "undefined" && sfx[n]) sfx[n](...a); } catch {} };
  const quick = () => typeof reduced === "function" && reduced();
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
  const ordinal = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n + "th");

  let on = false, S = null, rendered = 0, cur = "", busy = false, hintBusy = false, resultShown = false, tmr = 0, lastCd = -1, leaving = false, flipping = false;
  const me = () => (S && S.players.find((p) => p.is_me)) || null;
  const room = () => S && S.room;
  const guesses = () => (S && S.me && S.me.guesses) || [];
  const rowEl = (i) => $("#board").children[i];
  const playing = () => !!S && room().status === "playing";
  const now = () => (api() ? api().srvNow() : Date.now());
  const started = () => playing() && now() >= room().started_at_ms;
  const myActive = () => !!me() && me().status === "active" && me().connection !== "left";
  const canType = () => on && screen === "game" && playing() && started() && myActive() && !busy && !flipping && !resultShown && rendered < ROWS && !document.body.classList.contains("modal-open");

  // ---------- drawing ----------
  function buildUi() {
    const g = $("#game"); g.classList.add("team");
    if (!$("#tzg-top")) {
      const top = document.createElement("div"); top.id = "tzg-top"; top.className = "tzg-top";
      top.innerHTML = `<div class="tzg-head"><h2 class="tzg-h">IT'S BATTLE TIME!</h2><div class="tzg-tm" id="tzg-tm" role="timer" aria-label="Time left"><b>--:--</b><small>LEFT</small></div></div><div class="tzg-strip" id="tzg-strip" role="list" aria-label="Players"></div><p class="tzg-note" id="tzg-note" role="status" aria-live="polite"></p>`;
      g.insertBefore(top, $("#g-title"));
      const clue = document.createElement("p"); clue.id = "tzg-clue"; clue.className = "tzg-clue hidden"; g.insertBefore(clue, $("#keyboard"));
    }
    $("#g-title").textContent = "Team Battle";
  }
  function drawTile(t, ch, kind) {
    t.textContent = ch; t.classList.remove("filled", "flip", "correct", "present", "absent"); if (kind) t.classList.add(kind);
    if (kind) t.setAttribute("aria-label", `${ch}, ${{ correct: "correct position", present: "in the word, wrong position", absent: "not in the word" }[kind]}`); else t.removeAttribute("aria-label");
  }
  function drawGuess(i, g) { [...rowEl(i).children].forEach((t, c) => drawTile(t, g.word[c], KIND[g.pattern[c]])); }
  function flipRow(i, g, done) {
    const tiles = [...rowEl(i).children];
    if (quick()) { drawGuess(i, g); return done(); }
    flipping = true;
    tiles.forEach((t, c) => setTimeout(() => { t.classList.add("flip"); snd("flip", c); setTimeout(() => { drawTile(t, g.word[c], KIND[g.pattern[c]]); t.classList.add("flip"); }, 275); }, c * 280));
    setTimeout(() => { flipping = false; done(); }, COLS * 280 + 300);
  }
  function paintTyping() {
    $$(".tile.cursor").forEach((t) => t.classList.remove("cursor"));
    for (let r = 0; r < ROWS; r++) rowEl(r).classList.toggle("active", r === rendered && playing() && !busy);
    if (rendered >= ROWS) return;
    [...rowEl(rendered).children].forEach((t, c) => { t.textContent = cur[c] || ""; t.classList.toggle("filled", !!cur[c]); });
    if (canType() && cur.length < COLS) rowEl(rendered).children[cur.length].classList.add("cursor");
    $("#btn-submit").disabled = !canType();
  }
  function syncBoard() {                                  // draw any server guesses not on screen yet (refresh / reconnect)
    if (flipping) return;
    const gs = guesses();
    if (rendered > gs.length) { makeBoard(); rendered = 0; }
    while (rendered < gs.length) { drawGuess(rendered, gs[rendered]); rendered++; }
    paintTyping();
  }
  function makeBoard() { if (typeof window.buildBoard === "function") window.buildBoard(); }
  function drawKeys() {
    const rank = { absent: 1, present: 2, correct: 3 }, best = {}, gone = ((S.me.hints_used || []).includes("remove") && S.me.hint_data.remove && S.me.hint_data.remove.letters) || [];
    guesses().forEach((g) => [...g.word].forEach((ch, i) => { const k = KIND[g.pattern[i]]; if ((rank[k] || 0) > (rank[best[ch]] || 0)) best[ch] = k; }));
    $$("#keyboard .key").forEach((k) => {
      const ch = k.dataset.key; k.classList.remove("correct", "present", "absent");
      if (best[ch]) k.classList.add(best[ch]);
      k.classList.toggle("disabled", gone.includes(ch));
    });
  }
  function drawHints() {
    const used = S.me.hints_used || [];
    ["reveal", "remove", "word"].forEach((t) => {
      const b = $(`[data-hint="${t}"]`); if (!b) return;
      const u = used.includes(t);
      b.disabled = u || !(playing() && started() && myActive()) || resultShown;
      b.dataset.state = u ? "used" : "";
      const bd = b.querySelector(".badge"); if (bd) bd.textContent = u ? "Used" : "";
      b.setAttribute("aria-label", `${HINT[t]}${u ? ", used" : ", one use per player"}`); b.title = `${HINT[t]}${u ? " (used)" : ""}`;
    });
    const rv = S.me.hint_data && S.me.hint_data.reveal;
    for (let r = 0; r < ROWS; r++) [...rowEl(r).children].forEach((t, c) => { if (rv && c === rv.pos && r >= rendered) t.dataset.hint = rv.letter; else delete t.dataset.hint; });
    const w = S.me.hint_data && S.me.hint_data.word, c = $("#tzg-clue");
    if (c) { if (w) { c.innerHTML = `<b>💡 Clue:</b> `; c.append(document.createTextNode(w.text)); c.classList.remove("hidden"); } else c.classList.add("hidden"); }
  }
  function drawStrip() {
    const el = $("#tzg-strip"); if (!el || !S) return;
    el.innerHTML = S.players.map((p) => {
      const st = p.connection === "left" ? ["Left", "off"] : p.status === "solved" ? ["Solved it! 🎉", "on"]
               : p.status === "failed" ? ["Out of attempts", "off"]
               : p.connection === "reconnecting" ? ["Reconnecting…", "re"]
               : p.connection === "disconnected" ? ["Disconnected", "off"]
               : [`Playing`, "on"];
      const used = p.attempts_used || 0, dots = [...Array(6)].map((_, i) => `<i class="${i < used ? (p.status === "failed" ? "bad" : "used") : ""}"></i>`).join("");
      const cls = ["tzg-pc", p.is_me ? "me" : "", p.status === "solved" ? "solved" : "", p.status === "failed" || p.connection === "left" ? "out" : ""].join(" ");
      return `<div class="${cls}" role="listitem" aria-label="${esc(p.username)}, ${esc(st[0])}, ${used} of 6 attempts">
        <span class="tzg-av" aria-hidden="true">${Avatars.inner(p.avatar)}<i class="${esc(p.connection)}"></i></span>
        <div style="min-width:0"><b>${esc(p.username)}${p.is_me ? " (you)" : ""}</b><small class="${st[1]}">${esc(st[0])}</small><div class="tzg-dots" aria-hidden="true">${dots}</div></div></div>`;
    }).join("");
  }
  function drawNote() {
    const n = $("#tzg-note"); if (!n || !S) return;
    const m = me(), others = S.players.filter((p) => !p.is_me);
    let t = "", warn = false;
    if (m && m.status === "failed") t = "You're out of attempts. Others are still playing.";
    else if (others.some((p) => p.connection === "reconnecting")) { t = "A player lost connection. They can rejoin."; warn = true; }
    n.textContent = t; n.classList.toggle("warn", warn);
  }
  function drawTimer() {
    if (!S) return; const r = room(), t = now(), el = $("#tzg-tm"); if (!el) return;
    const left = r.status === "playing" ? (t < r.started_at_ms ? r.duration_seconds * 1000 : r.ends_at_ms - t) : 0;
    el.querySelector("b").textContent = r.status === "playing" || r.status === "finished" ? mmss(left) : "--:--";
    el.classList.toggle("low", r.status === "playing" && t >= r.started_at_ms && left <= 30000);
    const wrap = $(".board-wrap"); let cd = $("#tzg-cd");
    if (r.status === "playing" && t < r.started_at_ms) {
      const n = Math.ceil((r.started_at_ms - t) / 1000);
      if (!cd && wrap) { cd = document.createElement("div"); cd.id = "tzg-cd"; cd.className = "tzg-cd"; cd.setAttribute("role", "status"); wrap.append(cd); }
      if (cd && n !== lastCd) { lastCd = n; cd.innerHTML = `<b>${n}</b><span>GET READY</span>`; }
    } else if (cd) { cd.remove(); lastCd = -1; paintTyping(); }
    if (r.status === "playing" && t >= r.ends_at_ms && Date.now() - (drawTimer.last || 0) > 1000) { drawTimer.last = Date.now(); api() && api().sync(); }
  }
  drawTimer.last = 0;

  // ---------- input ----------
  function press(k) {
    if (!canType()) return;
    const gone = (S.me.hint_data && S.me.hint_data.remove && S.me.hint_data.remove.letters) || [];
    if (k === "enter") return submit();
    if (k === "back") { cur = cur.slice(0, -1); submitMsg(""); snd("key"); }
    else if (/^[a-z]$/.test(k) && cur.length < COLS && !gone.includes(k)) { cur += k; submitMsg(""); snd("key"); }
    paintTyping();
  }
  function submitMsg(msg) { const n = $("#tzg-note"); if (n && msg) { n.textContent = msg; n.classList.add("warn"); } else if (n && !msg) { n.classList.remove("warn"); drawNote(); } }
  function bad(msg) { submitMsg(msg); snd("bad"); const el = rowEl(rendered); if (!el) return; el.classList.add("shake", "invalid"); setTimeout(() => el.classList.remove("shake", "invalid"), 450); }
  async function submit() {
    if (!canType()) return;
    if (cur.length < COLS) return bad("Not enough letters");
    if (typeof VALID !== "undefined" && !VALID.has(cur)) return bad("Not a word!");
    if (guesses().some((g) => g.word === cur)) return bad("Already guessed");
    const word = cur, row = rendered; busy = true; submitMsg(""); paintTyping();
    const r = await api().call("tz_guess", { p_room: room().id, p_guess: word });
    busy = false;
    if (r.ok) {
      cur = ""; rendered = row + 1;
      flipRow(row, { word, pattern: r.pattern }, () => { api().apply(r.state); if (room() && room().status === "finished") renderResult(); else paintTyping(); });
      return;
    }
    if (r.state) api().apply(r.state);
    const why = { not_a_word: "Not a word!", bad_length: "Not enough letters", already_guessed: "Already guessed", out: "You're out of attempts.", not_started: "Get ready…", not_playing: "The battle has ended." }[r.reason] || "Couldn't send that. Try again.";
    bad(why); paintTyping();
  }
  async function useHint(type) {
    if (hintBusy || !playing() || !started() || !myActive() || resultShown) return;
    hintBusy = true;
    const r = await api().call("tz_hint", { p_room: room().id, p_type: type });
    hintBusy = false;
    if (r.state) api().apply(r.state);
    if (!r.ok) return submitMsg({ already_used: "Already used.", nothing_to_reveal: "Nothing left to reveal.", nothing_to_remove: "Nothing to remove.", no_clue: "No clue for this word.", not_playing: "Hints are closed now." }[r.reason] || "Couldn't use that hint.");
    snd("coin");
    submitMsg("");
    update(S);
  }

  // ---------- result: ranked list, rewards, Add Friend, rematch ----------
  let resRoom = "", claimedFor = "", friendOverride = {}, rmHop = "", curRoom = "", lastResHtml = "";
  const medal = (n) => (n === 1 ? { cls: "gold", ic: "👑" } : n === 2 ? { cls: "silver", ic: "🥈" } : n === 3 ? { cls: "bronze", ic: "🥉" } : { cls: "", ic: "" });
  const RM_ERR = { busy: "Someone is already in another battle.", no_request: "That rematch request is no longer open.", host_left: "The host left, so there's no rematch.",
                   no_opponents: "Nobody is left to play again with.", left: "You left this battle.", already_started: "The rematch has already started.", forbidden: "You're no longer in this battle.",
                   not_host: "Only the host can start a rematch.", host_cannot_respond: "You're the host, so you're already ready.", not_finished: "The battle isn't over yet.", try_again: "Couldn't start the rematch. Try again.", not_found: "That player isn't in this battle.", self: "That's you!", friend_limit: "Your friends list is full.", throttled: "Slow down a little, then try again.", error: "Something went wrong. Try again." };
  const FR_TXT = { friends: "Friends", sent: "Request sent", incoming: "Accept request", accepted: "Friends" };

  // Collect my reward once per battle. Player.rewardBattle writes each room only once, so a refresh can never pay twice.
  function claimOnce() {
    const rid = room().id; if (claimedFor === rid) return; claimedFor = rid;
    api().call("tz_claim_reward", { p_room: rid }).then((r) => {
      if (!r || !r.ok) { claimedFor = ""; return; }
      if (r.granted && r.outcome && typeof Player !== "undefined" && Player && typeof Player.rewardBattle === "function") {
        const m = me(), meta = { type: "team", place: Number(r.place) || null, size: S && S.players ? S.players.length : null, tries: m ? m.attempts_used : null, status: m ? m.status : "",
          ms: m && m.status === "solved" ? m.completion_ms : null, hints: S && S.me && Array.isArray(S.me.hints_used) ? S.me.hints_used.length : null };   // tells the Profile and the achievements this was a TEAM battle
        Player.rewardBattle(rid, r.outcome, Number(r.coins) || 0, Number(r.xp) || 0, meta);
        if (typeof refreshCoins === "function") refreshCoins();
        if (typeof toast === "function" && (Number(r.coins) || Number(r.xp))) toast(`+${r.coins} coins · +${r.xp} XP`, "success", 3000);
      }
      renderResult();
    });
  }
  function friendBtn(p) {
    const st = friendOverride[p.id] || p.friend_state;
    if (!st || st === "self") return "";
    if (st === "friends" || st === "accepted") return `<span class="tzg-fr ok">✓ Friends</span>`;
    if (st === "sent") return `<span class="tzg-fr">Request sent</span>`;
    if (st === "incoming") return `<button class="tzg-add" type="button" data-tzg="friend" data-id="${esc(p.id)}" aria-label="Accept ${esc(p.username)}'s friend request">${FR_TXT.incoming}</button>`;
    return `<button class="tzg-add" type="button" data-tzg="friend" data-id="${esc(p.id)}" aria-label="Add ${esc(p.username)} as a friend">＋ Add Friend</button>`;
  }
  // ---------- rematch: only the host asks; everyone else answers in a small popup; the host sees a live list ----------
  // The server decides everything (tz_rematch_request is host-only there too). This only draws the request that comes back.
  const RM_WIN = 30000, RM_TXT = { accepted: "✓ Accepted & Ready", declined: "✕ Declined", waiting: "⏳ Waiting..." };
  let rmBusy = false, rmDismissed = "", rmExpAt = 0, rmExpFor = "", rmSig = "", rmAutoT = 0;
  const hostOf = () => S.players.find((p) => p.is_host);
  function rematchBlock() {
    const rm = S.rematch || {}, me = S.players.find((p) => p.is_me), host = hostOf();
    const others = S.players.filter((p) => !p.is_me && p.connection !== "left");
    if (!me || me.connection === "left") return "";
    if (rm.state === "started") return `<p class="tzg-ans">Rematch starting… same team, new word.</p>`;
    if (!(S.me && S.me.is_host)) {                                                   // everyone else: no button, and it is clear why
      if (!host || host.connection === "left") return `<p class="tzg-ans">The host left, so there's no rematch.</p>`;
      return `<p class="tzg-ans tzg-hostnote">Only the host (<b>${esc(host.username)}</b>) can start a rematch.</p>`;
    }
    if (others.length === 0) return `<p class="tzg-ans">Nobody is left to play again with.</p>`;
    if (rm.state === "open") return `<p class="tzg-ans">Rematch request sent. Waiting for your team…</p>`;
    return `<button class="tzg-go" type="button" data-tzg="rm-ask"${rmBusy ? " disabled" : ""}>⚔️ Rematch</button><p class="tzg-ans tzg-hostnote">You're the host, so only you can start a rematch.</p>`;
  }
  function rmRows(rm) {
    return S.players.filter((p) => p.connection !== "left").map((p) => {
      const st = p.rematch || (p.is_host ? "accepted" : "waiting");
      const txt = p.is_host && st === "accepted" ? "✓ Host · Ready" : rm.state !== "open" && st === "waiting" ? "⏳ No response" : RM_TXT[st];
      return `<li class="${st}"><span class="tzg-av" aria-hidden="true">${Avatars.inner(p.avatar)}</span><b>${esc(p.username)}${p.is_me ? " (you)" : ""}</b><span class="tzg-rms">${txt}</span></li>`;
    }).join("");
  }
  const nameList = (l) => l.map((p) => `<b>${esc(p.username)}</b>`).join(", ").replace(/, ([^,]*)$/, " and $1");
  function clearRematchUi() {
    const p = $("#tzg-rm"); if (p) p.remove(); const r = $("#tzg-res"); if (r) r.classList.remove("rm-open");
    clearTimeout(rmAutoT); rmAutoT = 0; rmSig = ""; rmDismissed = ""; rmExpFor = "";
  }
  function renderRematch() {
    const rm = (S && S.rematch) || {}, me = S && S.players && S.players.find((p) => p.is_me), isHost = !!(S && S.me && S.me.is_host);
    const key = rm.id ? rm.id + ":" + rm.state : "";
    let kind = "";
    if (S && room() && room().status === "finished" && me && me.connection !== "left" && rm.id) {
      if (rm.state === "open") kind = isHost || rm.voted === true ? "wait" : "invite";
      else if (["declined", "expired", "cancelled", "busy"].includes(rm.state) && rmDismissed !== key) kind = "end";
    }
    let pop = $("#tzg-rm");
    const res = $("#tzg-res"); if (res) res.classList.toggle("rm-open", !!kind);
    if (!kind) { if (pop) pop.remove(); rmSig = ""; return; }
    if (rm.state === "open") { rmExpAt = Date.now() + (Number(rm.expires_in_ms) || 0); rmExpFor = rmExpFor === rm.id + "x" ? rmExpFor : ""; }
    const sig = JSON.stringify([kind, key, isHost, rm.votes, rm.needed, S.players.map((p) => [p.id, p.rematch, p.connection])]);
    if (pop && sig === rmSig) return;                                                // nothing changed: leave it alone, so a tap is never lost mid-redraw
    rmSig = sig;
    if (!pop) { pop = document.createElement("div"); pop.id = "tzg-rm"; pop.className = "tzg-rm"; document.body.append(pop); }
    const bar = `<div class="tzg-rm-bar" aria-hidden="true"><i></i></div>`;
    const timer = (pre) => `<p class="tzg-rm-s"><span class="tzg-rm-t" data-p="${esc(pre)}"></span></p>`;
    const host = hostOf();
    if (kind === "invite") {
      pop.setAttribute("role", "alertdialog"); pop.setAttribute("aria-label", "Rematch request");
      pop.innerHTML = `<div class="tzg-rm-h"><b>Your team wants a rematch!</b></div>
        <p class="tzg-rm-p">${esc(host ? host.username : "The host")} started a rematch with the same team and a new word.</p>${bar}${timer("")}
        <div class="tzg-row"><button class="tzg-go" type="button" data-tzg="rm-yes"${rmBusy ? " disabled" : ""}>Accept</button><button class="tzg-go alt" type="button" data-tzg="rm-no"${rmBusy ? " disabled" : ""}>Decline</button></div>`;
    } else if (kind === "wait") {
      pop.setAttribute("role", "status"); pop.setAttribute("aria-label", "Rematch status");
      pop.innerHTML = `<div class="tzg-rm-h"><b>Waiting for Players</b><span class="tzg-rm-n">${Number(rm.votes) || 0}/${Number(rm.needed) || 0} Players Ready</span></div>${bar}
        <ul class="tzg-rm-l">${rmRows(rm)}</ul>${timer(isHost ? "Starts when everyone accepts" : "You're ready. Waiting for the others")}
        ${isHost ? `<button class="tzg-go alt" type="button" data-tzg="rm-cancel"${rmBusy ? " disabled" : ""}>Cancel rematch</button>` : ""}`;
    } else {
      const declined = S.players.filter((p) => p.rematch === "declined"), silent = S.players.filter((p) => p.rematch === "waiting" && !p.is_host && p.connection !== "left");
      const title = { declined: "Rematch declined", expired: "Rematch expired", cancelled: "Rematch cancelled", busy: "Can't start the rematch" }[rm.state];
      const msg = rm.state === "declined" ? (declined.length ? `${nameList(declined)} declined the rematch.` : "A player declined the rematch.")
                : rm.state === "expired" ? (silent.length ? `No response from ${nameList(silent)}.` : "The request ran out of time.")
                : rm.state === "cancelled" ? "The host cancelled the request." : "Someone is already in another battle.";
      pop.setAttribute("role", "alertdialog"); pop.setAttribute("aria-label", title);
      pop.innerHTML = `<div class="tzg-rm-h"><b>${title}</b></div><p class="tzg-rm-p">${msg}</p>
        ${isHost ? `<ul class="tzg-rm-l">${rmRows(rm)}</ul><div class="tzg-row"><button class="tzg-go" type="button" data-tzg="rm-ask"${rmBusy ? " disabled" : ""}>Send new request</button><button class="tzg-go alt" type="button" data-tzg="rm-close">Close</button></div>`
                  : `<div class="tzg-row"><button class="tzg-go alt" type="button" data-tzg="rm-close">Close</button></div>`}`;
      clearTimeout(rmAutoT);
      if (!isHost) rmAutoT = setTimeout(() => { rmDismissed = key; renderRematch(); }, 7000);   // the others return to the result screen by themselves
    }
    tickRematch();
  }
  function tickRematch() {                                                          // called every 250 ms: the countdown text and bar
    const rm = S && S.rematch; if (!rm || rm.state !== "open") return;
    const left = Math.max(0, rmExpAt - Date.now()), t = $("#tzg-rm .tzg-rm-t"), bar = $("#tzg-rm .tzg-rm-bar i");
    if (t) t.textContent = (t.dataset.p ? t.dataset.p + " · " : "") + Math.ceil(left / 1000) + "s left";
    if (bar) bar.style.width = Math.min(100, left / RM_WIN * 100) + "%";
    if (left <= 0 && rmExpFor !== rm.id + "x") { rmExpFor = rm.id + "x"; setTimeout(() => { if (api() && api().sync) api().sync(); }, 600); }   // ask the server: it marks the request expired and tells everyone
  }
  function renderResult() {
    if (!S || !room() || room().status !== "finished") return;
    if (window.Series && Series.owns("team", S)) return;       // a Series round: Series Mode shows its own round popup and pays its own rewards
    const rid = room().id; resultShown = true;
    if (resRoom !== rid) { resRoom = rid; friendOverride = {}; }
    let el = $("#tzg-res");
    if (!el) {
      el = document.createElement("div"); el.id = "tzg-res"; el.className = "tzg-res"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
      document.body.append(el); lockModal(true);
    }
    const placed = S.players.slice().sort((a, b) => (a.finish_place || 99) - (b.finish_place || 99) || a.seat - b.seat);
    const me = placed.find((p) => p.is_me);
    const won = me && me.finish_place === 1;
    const title = won ? "You solved it!" : me && me.finish_place ? `You finished ${ordinal(me.finish_place)}` : "Battle over";
    const solver = placed.find((p) => p.finish_place === 1);
    const reason = room().end_reason === "solved" ? (solver && solver.is_me ? "You got it first, so the battle ended." : `${solver ? esc(solver.username) : "A player"} solved it first, so the battle ended.`)
                 : room().end_reason === "timeout" ? "Time ran out." : "Nobody could solve it.";
    const answer = S.answer ? (typeof wordMeaningHtml === "function" ? wordMeaningHtml(S.answer) : `<p class="tzg-ans">The word was <b>${esc(S.answer.toUpperCase())}</b></p>`) : "";
    const rows = placed.map((p) => {
      const m = medal(p.finish_place);
      const sub = p.status === "solved" ? `Solved in ${(p.completion_ms / 1000).toFixed(1)}s`
                : p.status === "failed" || p.connection === "left" ? `Out after ${p.attempts_used}/6`
                : `${p.best_exact || 0} right place · ${p.best_present || 0} wrong place`;
      const coins = p.reward ? p.reward.coins : 0, xp = p.reward ? p.reward.xp : 0;
      return `<li class="tzg-rc ${m.cls}${p.is_me ? " me" : ""}">
        <span class="tzg-pos" aria-label="${esc(ordinal(p.finish_place || 0))} place">${m.ic ? `<i aria-hidden="true">${m.ic}</i>` : ""}<b>${p.finish_place ? ordinal(p.finish_place) : "–"}</b></span>
        <span class="tzg-av" aria-hidden="true">${Avatars.inner(p.avatar)}</span>
        <span class="tzg-who"><b>${esc(p.username)}${p.is_me ? " (you)" : ""}</b><small>${esc(sub)}</small></span>
        <span class="tzg-earn"><span class="tzg-coin">+${coins} 🪙</span><span class="tzg-xp">+${xp} XP</span>${p.is_me ? "" : friendBtn(p)}</span></li>`;
    }).join("");
    const rm = S.rematch || {};
    const html = `<div class="tzg-card ${won ? "win" : me && me.finish_place ? "loss" : "draw"}"><h2>${esc(title)}</h2><p>${esc(reason)}</p>${answer}
      <ul class="tzg-rank">${rows}</ul><div class="tzg-rmbox">${rematchBlock()}</div>
      <button class="primary" type="button" id="tzg-done">Back to Team Zone</button></div>`;
    if (html !== lastResHtml || el.dataset.room !== rid) {                 // redraw only when something changed, so a tap is never lost mid-redraw
      lastResHtml = html; el.dataset.room = rid; el.innerHTML = html;
      $("#tzg-done").addEventListener("click", finishAndLeave);
    }
    claimOnce();
    renderRematch();
    // a rematch was started by the others: move everyone into the new battle
    if (rm.state === "started" && rm.new_room_id && rmHop !== rm.new_room_id) {
      rmHop = rm.new_room_id;
      api().call("tz_sync", { p_room: rm.new_room_id }).then((r) => { if (r && r.ok) api().apply(r.state); else rmHop = ""; });
    }
  }
  function finishAndLeave() {
    const r = $("#tzg-res"); if (r) r.remove(); lockModal(false);
    exit(); if (api()) api().finish();
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest && e.target.closest("#tzg-res [data-tzg],#tzg-rm [data-tzg]"); if (!b || b.disabled || !room()) return;
    e.preventDefault();
    const a = b.dataset.tzg, rid = room().id;
    const fail = (r) => { if (typeof toast === "function") toast(RM_ERR[r.reason] || RM_ERR.error, "error", 3200); };
    if (a === "friend") {
      b.disabled = true;
      const r = await api().call("tz_add_friend", { p_room: rid, p_target: b.dataset.id });
      if (r.ok) { friendOverride[b.dataset.id] = r.status; if (typeof toast === "function") toast(r.status === "friends" ? "You're now friends! 🎉" : "Friend request sent!", "success", 2600); renderResult(); }
      else { b.disabled = false; fail(r); }
      return;
    }
    if (a === "rm-close") { const k = S && S.rematch && S.rematch.id ? S.rematch.id + ":" + S.rematch.state : ""; rmDismissed = k; renderRematch(); return; }
    if (a === "rm-ask" || a === "rm-yes" || a === "rm-no" || a === "rm-cancel") {
      if (rmBusy) return;                                                             // a double tap sends one request, not two
      rmBusy = true; b.disabled = true;
      let r;
      try {
        r = a === "rm-ask" ? await api().call("tz_rematch_request", { p_room: rid })
          : a === "rm-cancel" ? await api().call("tz_rematch_cancel", { p_room: rid })
          : await api().call("tz_rematch_respond", { p_room: rid, p_accept: a === "rm-yes" });
      } finally { rmBusy = false; }
      if (r && r.state) api().apply(r.state);
      if (r && !r.ok && r.reason !== "left" && r.reason !== "no_request") fail(r);
      if (r && !r.ok && r.reason === "no_request" && typeof toast === "function") toast(RM_ERR.no_request, "", 2600);
      renderResult();
      return;
    }
  });

  // ---------- lifecycle ----------
  function update(st) {
    if (leaving) return; if (st) S = st; if (!S) return;
    const s = room().status;
    if (s !== "playing" && s !== "finished") return;
    if (on && curRoom && room().id !== curRoom) resetForNewRoom();
    if (!on) enter();
    drawStrip(); drawNote(); drawKeys(); drawHints(); drawTimer();
    if (!busy && !flipping) syncBoard();
    if (s === "finished" && !busy && !flipping) renderResult();
  }
  function resetForNewRoom() {                          // a rematch started: same screen, fresh board
    clearRematchUi(); lastResHtml = "";
    const r = $("#tzg-res"); if (r) r.remove(); lockModal(false);
    cur = ""; rendered = 0; busy = false; flipping = false; resultShown = false; lastCd = -1;
    makeBoard(); curRoom = room().id;
  }
  function enter() {
    curRoom = room() ? room().id : "";
    on = true; resultShown = false; cur = ""; rendered = 0; busy = false; flipping = false; lastCd = -1; leaving = false;
    buildUi(); makeBoard(); show("game");
    clearInterval(tmr); tmr = setInterval(() => { if (!S) return; drawTimer(); drawStrip(); drawNote(); tickRematch(); }, 250);
  }
  function exit() {
    clearRematchUi(); lastResHtml = "";
    clearInterval(tmr); tmr = 0; on = false; leaving = true;
    const r = $("#tzg-res"); if (r) r.remove(); lockModal(false);
    curRoom = ""; const cd = $("#tzg-cd"); if (cd) cd.remove();
    const g = $("#game"); if (g) g.classList.remove("team");
    ["tzg-top", "tzg-clue"].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
    $$(".hint").forEach((b) => { delete b.dataset.state; b.title = ""; const bd = b.querySelector(".badge"); if (bd) bd.textContent = ""; });
    $$("#keyboard .key").forEach((k) => k.classList.remove("correct", "present", "absent", "disabled"));
    S = null; rendered = 0; cur = ""; busy = false; resultShown = false;
    leaving = false;
  }
  async function leavePrompt() {
    if (resultShown) return finishAndLeave();
    if (!playing()) return finishAndLeave();
    if (!(typeof confirmBox === "function" && await confirmBox("Leave the battle?", "Leaving counts as a forfeit. Your score stays on the board and the others keep playing.", "Leave"))) return;
    const id = room() && room().id;
    exit();
    if (api()) await api().leave(id);
  }

  // ---------- take over the solo handlers while a team battle is on ----------
  document.addEventListener("click", (e) => {
    if (!on || screen !== "game") return;
    const t = e.target;
    const key = t.closest && t.closest("#keyboard .key");
    if (key) { e.stopPropagation(); e.preventDefault(); press(key.dataset.key); key.blur(); return; }
    if (t.closest("#btn-submit")) { e.stopPropagation(); e.preventDefault(); submit(); return; }
    const h = t.closest(".hint[data-hint]"); if (h) { e.stopPropagation(); e.preventDefault(); useHint(h.dataset.hint); return; }
    if (t.closest("#g-back")) { e.stopPropagation(); e.preventDefault(); leavePrompt(); return; }
    if (t.closest("#btn-skip")) { e.stopPropagation(); e.preventDefault(); return; }
    if (t.closest("#game [data-go],#game [data-free-coins]")) { e.stopPropagation(); e.preventDefault(); if (typeof toast === "function") toast("Finish your battle first.", ""); }
  }, true);
  window.addEventListener("keydown", (e) => {
    if (!on || screen !== "game") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "escape") return;
    if (e.target.closest && e.target.closest("input,textarea,select")) return;
    e.stopImmediatePropagation();
    if (k === "enter") { e.preventDefault(); if (!e.repeat) press("enter"); } else if (k === "backspace") press("back"); else if (/^[a-z]$/.test(k)) press(k);
  }, true);
  window.addEventListener("beforeunload", (e) => { if (on && playing() && !resultShown) { e.preventDefault(); e.returnValue = ""; } });

  window.TeamGame = { update, exit, isOn: () => on };
})();