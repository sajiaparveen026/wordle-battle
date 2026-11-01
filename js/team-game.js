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
.tzg-rank{list-style:none;margin:0;padding:0;display:grid;gap:6px;text-align:left}
.tzg-rank li{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px 12px;border-radius:14px;background:var(--panel-2);border:1px solid var(--line);font-size:.9rem}
.tzg-rank li.first{border-color:var(--gold)}
.tzg-rank .pl{font-weight:900;font-variant-numeric:tabular-nums;min-width:2.2em}
.tzg-rank .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:800}
.tzg-rank .sc{color:var(--muted);font-size:.78rem;font-variant-numeric:tabular-nums;white-space:nowrap}
.tzg-ans{font-size:.88rem;color:var(--muted)}.tzg-ans b{color:var(--text);letter-spacing:3px;font-size:1rem}
@keyframes tzg-blink{50%{opacity:.45}}
@keyframes tzg-pop{from{opacity:0;transform:scale(.6)}60%{transform:scale(1.05)}}
@keyframes tzg-fade{from{opacity:0}}
html[data-motion=reduced] .tzg-cd b,html[data-motion=reduced] .tzg-card,html[data-motion=reduced] .tzg-tm.low b{animation:none!important}
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
        <span class="tzg-av" aria-hidden="true">${esc(p.avatar)}<i class="${esc(p.connection)}"></i></span>
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
      flipRow(row, { word, pattern: r.pattern }, () => { api().apply(r.state); if (room() && room().status === "finished") showResult(); else paintTyping(); });
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

  // ---------- result ----------
  function showResult() {
    if (resultShown) return; resultShown = true; lockModal(true);
    const r = room(), m = me(), placed = S.players.slice().sort((a, b) => (a.finish_place || 99) - (b.finish_place || 99));
    const mine = m && m.finish_place;
    const outcome = mine === 1 ? "win" : mine ? "loss" : "draw";
    const title = { win: "You solved it!", loss: mine ? `You finished ${ordinal(mine)}` : "Battle over", draw: "Battle over" }[outcome];
    const solver = S.players.find((p) => p.status === "solved");
    const reason = r.end_reason === "solved" ? (solver && solver.is_me ? "You got it first, so the battle ended." : `${solver ? solver.username : "A player"} solved it first, so the battle ended.`) : r.end_reason === "timeout" ? "Time ran out." : "Nobody could solve it.";
    const answer = S.answer ? `<p class="tzg-ans">The word was <b>${esc(S.answer.toUpperCase())}</b></p>` : "";
    const rows = placed.map((p) => {
      const pos = p.finish_place ? ordinal(p.finish_place) : "–";
      const sc = p.status === "solved" ? `Solved in ${(p.completion_ms / 1000).toFixed(1)}s` : `${p.best_exact || 0} right place · ${p.best_present || 0} wrong place`;
      return `<li class="${p.finish_place === 1 ? "first" : ""}"><span class="pl">${pos}</span><span>${esc(p.avatar)}</span><span class="nm">${esc(p.username)}${p.is_me ? " (you)" : ""}</span><span class="sc">${esc(sc)}</span></li>`;
    }).join("");
    const el = document.createElement("div"); el.id = "tzg-res"; el.className = "tzg-res"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    el.innerHTML = `<div class="tzg-card ${outcome}"><h2>${esc(title)}</h2><p>${esc(reason)}</p>${answer}<ul class="tzg-rank">${rows}</ul><button class="primary" type="button" id="tzg-done">Back to Team Zone</button></div>`;
    document.body.append(el);
    if (outcome === "win") { snd("win"); if (typeof confetti === "function") confetti(); }
    $("#tzg-done").addEventListener("click", finishAndLeave);
  }
  function finishAndLeave() {
    const r = $("#tzg-res"); if (r) r.remove(); lockModal(false);
    exit(); if (api()) api().finish();
  }

  // ---------- lifecycle ----------
  function update(st) {
    if (leaving) return; if (st) S = st; if (!S) return;
    const s = room().status;
    if (s !== "playing" && s !== "finished") return;
    if (!on) enter();
    drawStrip(); drawNote(); drawKeys(); drawHints(); drawTimer();
    if (!busy && !flipping) syncBoard();
    if (s === "finished" && !busy && !flipping) showResult();
  }
  function enter() {
    on = true; resultShown = false; cur = ""; rendered = 0; busy = false; flipping = false; lastCd = -1; leaving = false;
    buildUi(); makeBoard(); show("game");
    clearInterval(tmr); tmr = setInterval(() => { if (!S) return; drawTimer(); drawStrip(); drawNote(); }, 250);
  }
  function exit() {
    clearInterval(tmr); tmr = 0; on = false; leaving = true;
    const r = $("#tzg-res"); if (r) r.remove(); lockModal(false);
    const cd = $("#tzg-cd"); if (cd) cd.remove();
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
