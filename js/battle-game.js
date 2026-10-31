// Battle gameplay screen. It borrows the solo game screen (#game): same board, keyboard, colours and clue buttons.
// Nothing here decides anything. Every guess and hint is sent to the server (bt_guess / bt_hint), which checks the word, colours it,
// keeps the clock and picks the winner; this file only draws what comes back. The secret word is never in the page until the battle ends.
// While a battle is on, the solo game's own key / click handlers are switched off (capture-phase listeners below), so nothing leaks between modes.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const ROWS = 6, COLS = 5;
  const KIND = { g: "correct", y: "present", x: "absent" };
  const HINT = { reveal: "Reveal a Letter", remove: "Remove Letters", word: "Use Clue" };
  const CSS = `
#game.battle #btn-skip{display:none}
#game.battle .hint .cnt{display:none}
#game.battle .controls{grid-template-columns:var(--side) minmax(0,1fr) var(--side)}
#game.battle .hint[data-state=used]{opacity:.5;filter:grayscale(.7)}
#game.battle .hint .badge{font-size:.62rem;font-weight:800;letter-spacing:.4px}
#game.battle #board{width:min(100%,340px,max(170px,calc((100dvh - 520px)*5/6)))}
#game.battle .winscore{visibility:hidden}
.bt-top{display:grid;gap:6px;flex:none;padding:2px 0 4px}
.bt-h{margin:0;text-align:center;font-size:1.05rem;font-weight:900;letter-spacing:3px;background:linear-gradient(90deg,var(--gold),var(--red1,#E0264F),var(--gold));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:bt-shine 3s linear infinite;background-size:200% 100%}
.bt-vs{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px}
.bt-p{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:8px;padding:6px 8px;border-radius:14px;background:var(--panel);border:1px solid var(--line);min-width:0}
.bt-p.me{border-color:color-mix(in srgb,var(--gold) 55%,var(--line))}
.bt-p.opp{grid-template-columns:minmax(0,1fr) auto;text-align:right}.bt-p.opp .bt-av{order:2}
.bt-av{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;font-size:1.25rem;background:var(--panel-2);border:2px solid var(--line)}
.bt-p b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.84rem}
.bt-p small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.68rem;color:var(--muted)}
.bt-p small.on{color:#4ADE80}.bt-p small.re{color:#FBBF24}.bt-p small.off{color:#8b8b92}
.bt-tm{display:grid;justify-items:center;min-width:58px;font-variant-numeric:tabular-nums}
.bt-tm b{font-size:1.25rem;line-height:1;letter-spacing:.5px}.bt-tm small{font-size:.6rem;font-weight:800;letter-spacing:1.5px;color:var(--muted)}
.bt-tm.low b{color:var(--danger,#e5484d);animation:bt-blink 1s steps(2) infinite}
.bt-note{margin:0;min-height:1.1em;text-align:center;font-size:.76rem;font-weight:700;color:var(--muted)}
.bt-note.warn{color:#FBBF24}
.bt-clue{margin:0;text-align:center;font-size:.76rem;color:var(--muted);padding:0 6px}.bt-clue b{color:var(--gold)}
.bt-cd{position:absolute;inset:0;z-index:5;display:grid;place-items:center;align-content:center;gap:4px;border-radius:12px;background:color-mix(in srgb,var(--bg,#000) 78%,transparent);backdrop-filter:blur(3px)}
.bt-cd b{font-size:5rem;line-height:1;color:var(--gold);animation:bt-pop .9s ease both}.bt-cd span{font-size:.8rem;font-weight:800;letter-spacing:2px;color:var(--muted)}
.board-wrap{position:relative}
.bt-res{position:fixed;inset:0;z-index:60;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.66);backdrop-filter:blur(5px);animation:bt-fade .3s ease both;overflow:auto}
.bt-card{display:grid;gap:12px;width:min(100%,420px);padding:22px 18px;border-radius:24px;text-align:center;background:linear-gradient(170deg,color-mix(in srgb,var(--c) 18%,var(--panel)),var(--panel) 65%);border:1px solid color-mix(in srgb,var(--c) 55%,var(--line));box-shadow:0 20px 50px rgba(0,0,0,.5),0 0 40px color-mix(in srgb,var(--c) 28%,transparent);animation:bt-pop .55s ease both}
.bt-card.win{--c:#FACC15}.bt-card.loss{--c:#F87171}.bt-card.draw{--c:#7C8CFF}
.bt-card h2{margin:0;font-size:1.7rem;font-weight:900;letter-spacing:2px;color:var(--c)}
.bt-card p{margin:0;color:var(--muted);font-size:.9rem;line-height:1.45}
.bt-fight{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:8px;align-items:stretch}
.bt-fc{display:grid;gap:3px;justify-items:center;align-content:start;padding:12px 6px;border-radius:16px;background:var(--panel-2);border:1px solid var(--line);min-width:0}
.bt-fc.w{border-color:var(--gold);box-shadow:0 0 18px color-mix(in srgb,var(--gold) 35%,transparent)}
.bt-fc .bt-av{width:50px;height:50px;font-size:1.8rem}.bt-fc b{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.92rem}
.bt-fc small{font-size:.72rem;color:var(--muted)}.bt-fc .tag{font-size:.66rem;font-weight:900;letter-spacing:1px;color:var(--gold)}
.bt-vs2{align-self:center;font-weight:900;font-size:.75rem;letter-spacing:2px;color:var(--muted)}
.bt-ans{font-size:.85rem;color:var(--muted)}.bt-ans b{color:var(--text);letter-spacing:3px;font-size:1rem}
.bt-banner{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:70;padding:7px 14px;border-radius:999px;font-size:.78rem;font-weight:800;background:color-mix(in srgb,#FBBF24 20%,var(--panel));border:1px solid #FBBF24}
.bt-res{display:flex}.bt-card{margin:auto}
.bt-rw .rewardbox{display:grid;gap:4px;margin:0;padding:10px;border-radius:16px;background:var(--panel-2);border:1px solid var(--line)}
.bt-rw .rchips{display:flex;justify-content:center;gap:10px}
.bt-rw .xp{margin-top:4px}.bt-rw small{color:var(--muted);font-size:.74rem}
.bt-note2{margin:0;font-size:.82rem;font-weight:700;color:var(--muted)}.bt-note2.warn{color:#FBBF24}
.bt-rm{display:grid;gap:8px}.bt-two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.bt-rm small{color:var(--muted);font-size:.74rem;font-variant-numeric:tabular-nums}
@keyframes bt-shine{to{background-position:200% 0}}
@keyframes bt-blink{50%{opacity:.45}}
@keyframes bt-pop{from{opacity:0;transform:scale(.5)}60%{transform:scale(1.08)}}
@keyframes bt-fade{from{opacity:0}}
html[data-motion=reduced] .bt-h,html[data-motion=reduced] .bt-tm b,html[data-motion=reduced] .bt-cd b,html[data-motion=reduced] .bt-card{animation:none!important}
@media (max-height:640px){.bt-h{font-size:.9rem}.bt-av{width:28px;height:28px;font-size:1.05rem}}
`;
  if (!document.getElementById("bt-css")) { const st = document.createElement("style"); st.id = "bt-css"; st.textContent = CSS; document.head.append(st); }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fb = () => window.FriendBattle && FriendBattle.api;
  const snd = (n, ...a) => { try { if (typeof sfx !== "undefined" && sfx[n]) sfx[n](...a); } catch {} };   // sfx is a global of app.js, not on window
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
  const fmtTime = (ms) => { if (ms == null) return "–"; const s = ms / 1000; return s >= 60 ? Math.floor(s / 60) + ":" + String((s % 60).toFixed(1)).padStart(4, "0") : s.toFixed(1) + "s"; };

  let on = false, S = null, rendered = 0, cur = "", busy = false, hintBusy = false, resultShown = false, tmr = 0, lastTimeoutSync = 0, lastCd = -1, leaving = false;
  const me = () => (S && S.players.find((p) => p.is_me)) || null;
  const opp = () => (S && S.players.find((p) => !p.is_me)) || null;
  const room = () => S && S.room;
  const guesses = () => (S && S.me && S.me.guesses) || [];
  const rowEl = (i) => $("#board").children[i];
  const playing = () => !!S && room().status === "playing";
  const started = () => playing() && fb().srvNow() >= room().started_at_ms;
  const myActive = () => !!me() && me().status === "active";
  const canType = () => on && screen === "game" && playing() && started() && myActive() && !busy && !resultShown && rendered < ROWS && !document.body.classList.contains("modal-open");

  // ---------- drawing ----------
  function buildUi() {
    const g = $("#game"); g.classList.add("battle");
    if (!$("#bt-top")) {
      const top = document.createElement("div"); top.id = "bt-top"; top.className = "bt-top";
      top.innerHTML = `<h2 class="bt-h">IT'S BATTLE TIME!</h2><div class="bt-vs"><div class="bt-p me" id="bt-me"></div><div class="bt-tm" id="bt-tm" role="timer" aria-label="Time left"><b>--:--</b><small>LEFT</small></div><div class="bt-p opp" id="bt-opp"></div></div><p class="bt-note" id="bt-note" role="status" aria-live="polite"></p>`;
      g.insertBefore(top, $("#g-title"));
      const clue = document.createElement("p"); clue.id = "bt-clue"; clue.className = "bt-clue hidden"; g.insertBefore(clue, $("#keyboard"));
    }
    $("#g-title").textContent = "Friend Battle";
  }
  function drawTile(t, ch, kind) {
    t.textContent = ch; t.classList.remove("filled", "flip", "correct", "present", "absent"); if (kind) t.classList.add(kind);
    if (kind) t.setAttribute("aria-label", `${ch}, ${{ correct: "correct position", present: "in the word, wrong position", absent: "not in the word" }[kind]}`); else t.removeAttribute("aria-label");
  }
  function drawGuess(i, g) { [...rowEl(i).children].forEach((t, c) => drawTile(t, g.word[c], KIND[g.pattern[c]])); }
  function flipRow(i, g, done) {
    const tiles = [...rowEl(i).children], quick = typeof reduced === "function" && reduced();
    if (quick) { drawGuess(i, g); return done(); }
    tiles.forEach((t, c) => setTimeout(() => { t.classList.add("flip"); snd("flip", c); setTimeout(() => { drawTile(t, g.word[c], KIND[g.pattern[c]]); t.classList.add("flip"); }, 275); }, c * 280));
    setTimeout(done, COLS * 280 + 300);
  }
  function paintTyping() {
    $$(".tile.cursor").forEach((t) => t.classList.remove("cursor"));
    for (let r = 0; r < ROWS; r++) rowEl(r).classList.toggle("active", r === rendered && playing() && !busy);
    if (rendered >= ROWS) return;
    [...rowEl(rendered).children].forEach((t, c) => { t.textContent = cur[c] || ""; t.classList.toggle("filled", !!cur[c]); });
    if (canType() && cur.length < COLS) rowEl(rendered).children[cur.length].classList.add("cursor");
    $("#btn-submit").disabled = !canType();
  }
  function syncBoard() {                                   // draw any server guesses not on screen yet (after a refresh or reconnect)
    const gs = guesses();
    if (rendered > gs.length) { buildBoard(); rendered = 0; }
    while (rendered < gs.length) { drawGuess(rendered, gs[rendered]); rendered++; }
    drawHintTiles(); paintTyping();
  }
  function drawHintTiles() {
    const rv = S && S.me.hint_data && S.me.hint_data.reveal;
    for (let r = 0; r < ROWS; r++) [...rowEl(r).children].forEach((t, c) => { if (rv && c === rv.pos && r >= rendered) t.dataset.hint = rv.letter; else delete t.dataset.hint; });
  }
  function drawKeys() {
    const rank = { absent: 1, present: 2, correct: 3 }, best = {}, gone = ((S.me.hint_data.remove || {}).letters) || [];
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
      b.querySelector(".badge").textContent = u ? "Used" : "";
      b.setAttribute("aria-label", `${HINT[t]}${u ? ", used" : ", one use per battle"}`); b.title = `${HINT[t]}${u ? " (used)" : ""}`;
    });
    const w = S.me.hint_data && S.me.hint_data.word, c = $("#bt-clue");
    if (w) { c.innerHTML = `<b>💡 Clue:</b> `; c.append(document.createTextNode(w.text)); c.classList.remove("hidden"); } else c.classList.add("hidden");
  }
  function statusLine(p) {
    if (!p) return ["", ""];
    if (p.connection === "reconnecting") return [`Reconnecting… ${Math.ceil(p.reconnect_ms / 1000)}s`, "re"];
    if (p.connection === "disconnected") return ["Disconnected", "off"];
    if (p.connection === "left") return ["Left the battle", "off"];
    const s = p.status === "solved" ? "Solved it!" : p.status === "failed" ? "Out of attempts" : "Playing";
    return [`● Online · ${s}`, "on"];
  }
  function drawBar() {
    const m = me(), o = opp(); if (!m) return;
    const line = (p, you) => { const [txt, cl] = statusLine(p); return `<span class="bt-av" aria-hidden="true">${esc(p.avatar)}</span><div><b>${esc(p.username)}${you ? ' <small style="display:inline;color:var(--gold);font-weight:900">YOU</small>' : ""}</b><small class="${cl}">${esc(txt)}</small><small>${p.attempts_used}/${ROWS} attempts</small></div>`; };
    $("#bt-me").innerHTML = line(m, true);
    $("#bt-opp").innerHTML = o ? line(o, false) : "";
    const note = $("#bt-note"); note.classList.remove("warn"); let t = "";
    if (resultShown) t = "";
    else if (o && o.connection === "reconnecting") { t = `${o.username} lost connection. They have ${Math.ceil(o.reconnect_ms / 1000)}s to come back.`; note.classList.add("warn"); }
    else if (m.status === "failed") t = `You're out of attempts. ${o ? o.username : "Your opponent"} is still playing.`;
    else if (o && o.status === "failed") t = `${o.username} is out of attempts. Solve it to win!`;
    note.textContent = t;
  }
  function drawTimer() {
    if (!S) return; const r = room(), now = fb().srvNow(), el = $("#bt-tm"); if (!el) return;
    const left = r.status === "playing" ? (now < r.started_at_ms ? r.duration_seconds * 1000 : r.ends_at_ms - now) : 0;
    el.querySelector("b").textContent = r.status === "playing" || r.status === "finished" ? mmss(left) : "--:--";
    el.classList.toggle("low", r.status === "playing" && now >= r.started_at_ms && left <= 30000);
    el.setAttribute("aria-label", `Time left ${mmss(left).replace(":", " minutes ")} seconds`);
    // countdown before the start
    const wrap = $(".board-wrap"); let cd = $("#bt-cd");
    if (r.status === "playing" && now < r.started_at_ms) {
      const n = Math.ceil((r.started_at_ms - now) / 1000);
      if (!cd) { cd = document.createElement("div"); cd.id = "bt-cd"; cd.className = "bt-cd"; cd.setAttribute("role", "status"); wrap.append(cd); }
      if (n !== lastCd) { lastCd = n; cd.innerHTML = `<b>${n}</b><span>GET READY</span>`; }
    } else if (cd) { cd.remove(); lastCd = -1; paintTyping(); drawHints(); }
    if (r.status === "playing" && now >= r.ends_at_ms && Date.now() - lastTimeoutSync > 1000) { lastTimeoutSync = Date.now(); fb().sync(); }   // ask the server to close the battle
  }

  // ---------- input ----------
  function press(k) {
    if (!canType()) return;
    const gone = ((S.me.hint_data.remove || {}).letters) || [];
    if (k === "enter") return submit();
    if (k === "back") { cur = cur.slice(0, -1); submitMsg(""); snd("key"); }
    else if (/^[a-z]$/.test(k) && cur.length < COLS && !gone.includes(k)) { cur += k; submitMsg(""); snd("key"); }
    paintTyping();
  }
  function bad(msg) { submitMsg(msg); snd("bad"); const el = rowEl(rendered); if (!el) return; el.classList.add("shake", "invalid"); setTimeout(() => el.classList.remove("shake", "invalid"), 450); }
  async function submit() {
    if (!canType()) return;
    if (cur.length < COLS) return bad("Not enough letters");
    if (typeof VALID !== "undefined" && !VALID.has(cur)) return bad("Not a word!");
    if (guesses().some((g) => g.word === cur)) return bad("Already guessed");
    const word = cur, row = rendered; busy = true; submitMsg(""); paintTyping();
    const r = await fb().call("bt_guess", { p_room: room().id, p_guess: word });
    if (r.ok) {
      cur = ""; rendered = row + 1;                                 // the row is ours now; update() will not redraw it
      const g = { word, pattern: r.pattern };
      fb().apply(r.state);
      flipRow(row, g, () => {
        busy = false;
        if (r.pattern === "ggggg") { rowEl(row).classList.add("win"); snd("win"); }
        update(S); 
      });
      return;
    }
    busy = false;
    if (r.reason === "not_a_word") bad("Not a word!");
    else if (r.reason === "bad_length") bad("Not enough letters");
    else if (r.reason === "not_started") submitMsg("Wait for the countdown");
    else if (r.reason === "out") submitMsg("No attempts left");
    else if (r.reason === "finished" || r.reason === "not_playing") { if (r.state) fb().apply(r.state); else fb().sync(); }
    else { submitMsg("Couldn't send your guess. Try again."); }
    paintTyping();
  }
  async function useHint(type) {
    if (!playing() || !started() || !myActive() || hintBusy || busy || resultShown) return;
    if ((S.me.hints_used || []).includes(type)) return;
    hintBusy = true; $$(".hint").forEach((b) => (b.disabled = true));
    const r = await fb().call("bt_hint", { p_room: room().id, p_type: type });
    hintBusy = false;
    if (r.state) fb().apply(r.state);
    if (r.ok) {
      snd("coin");
      if (type === "reveal") toast(`Letter ${r.data.pos + 1} is ${r.data.letter.toUpperCase()}`, "success");
      else if (type === "remove") toast(`${r.data.letters.length} wrong letters removed`, "success");
      else showClue(r.data);
    } else if (r.reason === "nothing_to_reveal") toast("You already know every letter's place!", "");
    else if (r.reason === "nothing_to_remove") toast("There are no more letters to remove.", "");
    else if (r.reason === "already_used") toast("You already used that clue.", "");
    else if (r.reason === "network" || r.reason === "error") toast("Couldn't use the clue. Try again.", "error");
    if (S) { drawHints(); drawHintTiles(); drawKeys(); }
  }
  function showClue(d) {
    const main = $("#clue-main"); if (!main) return;
    main.innerHTML = typeof clueRow === "function" ? clueRow([d.type, d.text]) : `<p class="clue-text"></p>`;
    main.querySelector(".clue-text").textContent = d.text;
    $("#clue-count").textContent = "Your one clue for this battle"; $("#clue-prev").classList.add("hidden"); ["#clue-empty", "#clue-buy", "#clue-full"].forEach((q) => { const e = $(q); if (e) e.classList.add("hidden"); }); $("#clue-main").classList.remove("hidden"); $("#clue-count").classList.remove("hidden"); /* battle clues are server-given and not for sale */
    $("#clue").classList.remove("hidden"); lockModal(true); $("#clue-x").focus();
  }

  // ---------- result card (the winner/loser screen; rewards and rematch are further down) ----------
  function showResult() {
    if (resultShown || !S) return; resultShown = true; cur = "";
    const r = room(), m = me(), o = opp(), res = m.outcome === "win" ? "win" : m.outcome === "draw" ? "draw" : "loss";
    const win = (S.players.find((p) => p.id === r.winner_player_id)) || null;
    const head = { win: "BATTLE WON!", loss: "BATTLE LOST!", draw: "BATTLE DRAW!" }[res];
    let msg;
    if (res === "win") msg = r.end_reason === "forfeit" ? `${o ? esc(o.username) : "Your opponent"} left the battle. You win!` : `You cracked it in ${m.attempts_used} ${m.attempts_used === 1 ? "guess" : "guesses"} · ${fmtTime(m.completion_ms)}.`;
    else if (res === "loss") msg = r.end_reason === "timeout" ? `Time's up! ${esc(win ? win.username : "Your opponent")} was closer to the word. Challenge them again!` : m.outcome === "forfeit" ? "You left the battle, so your opponent takes the win." : `${esc(win ? win.username : "Your opponent")} solved it first. Great effort. Go again!`;
    else msg = r.end_reason === "failed" ? "Neither of you cracked the word this time." : r.end_reason === "timeout" ? "Time ran out with nothing to separate you." : "The battle ended without a winner.";
    const card = (p) => p ? `<div class="bt-fc${win && win.id === p.id ? " w" : ""}"${p.is_me ? "" : " data-opp"}><span class="bt-av" aria-hidden="true">${esc(p.avatar)}</span><b>${esc(p.username)}${p.is_me ? " (you)" : ""}</b>${win && win.id === p.id ? '<span class="tag">WINNER</span>' : res === "draw" ? '<span class="tag" style="color:var(--muted)">DRAW</span>' : ""}<small>${p.status === "solved" ? `${p.attempts_used} ${p.attempts_used === 1 ? "guess" : "guesses"} · ${fmtTime(p.completion_ms)}` : `${p.attempts_used}/${ROWS} guesses`}</small></div>` : "";
    const el = document.createElement("div"); el.id = "bt-res"; el.className = "bt-res"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "bt-rt");
    el.innerHTML = `<div class="bt-card ${res}"><h2 id="bt-rt">${head}</h2><div class="bt-fight">${card(m)}<span class="bt-vs2">VS</span>${card(o)}</div><p>${msg}</p><p class="bt-ans">The word was <b>${esc((S.answer || "").toUpperCase())}</b></p><div id="bt-rw" class="bt-rw"></div><div id="bt-rm" class="bt-rm"></div><button class="primary alt" type="button" id="bt-back">Back to Battle</button></div>`;
    document.body.append(el); lockModal(true); $("#bt-back").focus();
    if (window.Friends) Friends.decorateResult(el, r.id);   // "+ Add Friend" beside the opponent (js/friends.js)
    $("#bt-back").onclick = () => exit(true);
    if (res === "win") snd("win"); else if (res === "loss") snd("lose");
    drawBar(); drawHints(); paintTyping();
    rwState = "idle"; rwInfo = null; rmSig = ""; rmBusy = false;
    drawReward(); watchRematch(); rwWait = claimReward();            // collect the reward automatically, then offer a rematch
  }

  // ---------- rewards: the server decides and pays once; this only shows it and saves it ----------
  let rwState = "idle", rwInfo = null, rwRoom = "", rwBusyFor = "", rwWait = null, rmSig = "", rmDeadline = 0, rmBusy = false, rmGo = false, rmPoke = 0;
  const gfx = (n, ...a) => { try { if (typeof window[n] === "function") return window[n](...a); } catch {} };   // app.js helpers (confetti, countUp, ...)
  const quick = () => typeof reduced === "function" && reduced();
  const canPay = () => typeof Player !== "undefined" && Player && typeof Player.rewardBattle === "function";
  const paidOutcome = () => { const m = me(); return !!m && (m.outcome === "win" || m.outcome === "loss" || m.outcome === "draw"); };

  // Rooms whose claim was sent but whose answer we never saw (connection dropped, app closed). The server may have paid already, so these are
  // settled once on the next start (recover) and on a retry: Player.rewardBattle writes each room only once, so this can never pay twice here.
  const UNSURE = "wb_bt_unsure";
  const unsureList = () => { try { const a = JSON.parse(localStorage.getItem(UNSURE)); return Array.isArray(a) ? a : []; } catch { return []; } };
  const markUnsure = (id, on) => { try { const a = unsureList().filter((x) => x !== id); if (on) a.push(id); localStorage.setItem(UNSURE, JSON.stringify(a.slice(-20))); } catch {} };
  let recovered = false;
  async function recover() {
    if (recovered || !canPay() || !fb()) return; recovered = true;
    for (const rid of unsureList()) {
      const res = await fb().call("bt_claim_reward", { p_room: rid });
      if (res.ok) { if (Player.rewardBattle(rid, res.outcome, res.coins, res.xp)) gfx("refreshCoins"); markUnsure(rid, false); }
      else if (res.reason === "forbidden" || res.reason === "not_finished") markUnsure(rid, false);
    }
  }

  async function claimReward() {
    const rid = room() && room().id; if (!rid || !paidOutcome() || rwBusyFor === rid) return;
    rwBusyFor = rid; rwRoom = rid; rwState = "busy"; rwInfo = null; drawReward();
    const wasUnsure = unsureList().includes(rid); markUnsure(rid, true);
    const res = await fb().call("bt_claim_reward", { p_room: rid });
    if (rwBusyFor === rid) rwBusyFor = "";
    let applied = null;
    if (res.ok && (res.granted || wasUnsure) && canPay()) applied = Player.rewardBattle(rid, res.outcome, res.coins, res.xp);
    if (res.ok || res.reason === "forbidden" || res.reason === "not_finished") markUnsure(rid, false);   // saved right away, even if the card was closed meanwhile
    if (rwRoom !== rid || !resultShown) { if (applied) gfx("refreshCoins"); return; }
    if (!res.ok) { rwState = "fail"; drawReward(); return; }                                                  // nothing is lost: the server keeps it claimable
    rwInfo = applied || { coins: res.coins | 0, xp: res.xp | 0, levelUp: false };
    rwState = applied ? "done" : "already"; drawReward(true);
  }

  function drawReward(fx) {
    const box = $("#bt-rw"); if (!box) return;
    const m = me(), rw = S && S.me && S.me.reward;
    if (m && m.outcome === "forfeit") { box.innerHTML = '<p class="bt-note2">Leaving a battle earns no coins or XP.</p>'; return; }
    if (!paidOutcome() || !rw) { box.innerHTML = ""; return; }
    const info = rwInfo || rw, coins = info.coins | 0, xp = info.xp | 0, done = rwState === "done", lv = done ? Player.levelInfo() : null;
    const note = rwState === "fail" ? "Couldn't collect your reward right now. It's safe on the server, so try again."
      : rwState === "already" ? "Reward already collected." : done ? (rwInfo.levelUp ? "⬆ Level up!" : "") : "Collecting your reward…";
    box.innerHTML = `<div class="rewardbox"><div class="rchips"><div class="chip"><b id="bt-rc">+${coins}</b><small>🪙 Coins</small></div><div class="chip xpc"><b id="bt-rx">+${xp}</b><small>⚡ XP</small></div></div>`
      + (done ? `<small id="bt-rb" class="r-balance">Balance: ${Player.data.coins} 🪙</small><div class="xp"><i id="bt-xp" style="width:${Math.round(lv.xp / lv.need * 100)}%"></i></div><small>Level ${lv.level} · ${lv.xp}/${lv.need} XP</small>` : "")
      + (note ? `<p class="bt-note2${rwState === "fail" ? " warn" : ""}">${note}</p>` : "")
      + (rwState === "fail" ? '<button class="primary alt" type="button" data-bt="claim">Collect reward</button>' : "") + "</div>";
    if (!(fx && done)) return;
    const old = Math.max(0, Player.data.coins - coins), b = $("#bt-rb");                // until the coins land the balance shows the number from before
    gfx("countUp", $("#bt-rc"), coins, "+"); gfx("countUp", $("#bt-rx"), xp, "+");
    if (b) b.textContent = `Balance: ${old} 🪙`; $$(".coin-val").forEach((v) => (v.textContent = old));
    setTimeout(() => {
      if (!$("#bt-rc")) return gfx("refreshCoins");
      gfx("coinsToBalance", $("#bt-rc"), coins, { onTick: (v) => { const e = $("#bt-rb"); if (e) e.textContent = `Balance: ${v} 🪙`; } });
    }, quick() ? 0 : 900);
    gfx("animateXp", "#bt-xp", Math.round(lv.xp / lv.need * 100));
    if (m.outcome === "win") gfx("confetti");
    snd("coin");
  }

  // ---------- rematch: the server keeps the request (30 seconds) and creates the new battle when both agree ----------
  function drawRematch() {
    const box = $("#bt-rm"); if (!box) return;
    const o = opp(), rm = S && S.rematch, nm = esc(o ? o.username : "Your opponent");
    if (!o || o.connection === "left") { box.innerHTML = `<p class="bt-note2">${nm} left, so there's no rematch.</p>`; return; }
    if (rm && rm.status === "accepted" && rm.new_room_id) { box.innerHTML = '<p class="bt-note2">Rematch accepted! Starting…</p>'; return; }
    if (rm && rm.status === "pending" && rm.requested_by_me) { box.innerHTML = `<button class="primary big" type="button" disabled>Waiting for ${nm}… <span id="bt-rmt"></span></button>`; return; }
    if (rm && rm.status === "pending") {
      box.innerHTML = `<p class="bt-note2"><b>${nm}</b> wants a rematch!</p><div class="bt-two"><button class="primary big" type="button" data-bt="accept"${rmBusy ? " disabled" : ""}>Accept</button><button class="primary alt" type="button" data-bt="decline"${rmBusy ? " disabled" : ""}>Decline</button></div><small id="bt-rmt"></small>`; return;
    }
    const msg = rm && rm.status === "declined" && rm.requested_by_me ? `${nm} declined the rematch.` : rm && rm.status === "expired" ? "The rematch request expired." : "";
    box.innerHTML = (msg ? `<p class="bt-note2">${msg}</p>` : "") + `<button class="primary big" type="button" data-bt="rematch"${rmBusy ? " disabled" : ""}>⚔️ Rematch</button>`;
  }
  function watchRematch() {                                            // called with every new server state while the result card is open
    const rm = S && S.rematch;
    if (rm && rm.status === "pending") rmDeadline = Date.now() + (rm.expires_in_ms | 0);
    if (rm && rm.status === "accepted" && rm.new_room_id) { drawRematch(); goRematch(rm.new_room_id); return; }
    const o = opp(), sig = [rm ? rm.status : "", rm ? rm.requested_by_me : "", o ? o.connection === "left" : "", rmBusy].join("|");
    if (sig !== rmSig) { rmSig = sig; drawRematch(); }
  }
  function tickRematch() {
    if (!resultShown || !S) return;
    const rm = S.rematch; if (!rm || rm.status !== "pending") return;
    const left = Math.max(0, rmDeadline - Date.now()), t = $("#bt-rmt"); if (t) t.textContent = Math.ceil(left / 1000) + "s";
    if (left <= 0 && Date.now() - rmPoke > 2500) { rmPoke = Date.now(); fb().sync(); }   // ask the server to settle the expired request
  }
  async function goRematch(id) {                                       // both agreed: leave this result and drop into the new battle's countdown
    if (rmGo) return; rmGo = true;
    try {
      if (rwWait) await rwWait;                                        // finish collecting this battle's reward first
      const r = await fb().call("bt_sync", { p_room: id });
      if (!r.ok || !r.state) { toast("Couldn't start the rematch. Try again.", "error"); return; }
      exit(false); fb().enter(r.state);
    } finally { rmGo = false; }
  }
  async function afterRematch(r, id) {
    if (!S || room().id !== id) return;
    if (r.new_room_id && (r.accepted || (r.state && r.state.rematch && r.state.rematch.status === "accepted"))) return goRematch(r.new_room_id);
    if (r.state) fb().apply(r.state); else watchRematch();
    if (!r.ok) {
      toast({ opponent_left: "Your opponent left, so there's no rematch.", already_rematched: "A rematch already started.", not_finished: "The battle isn't over yet.", no_request: "That request is no longer open.", network: "Can't reach the server. Try again.", try_again: "Couldn't set up the rematch. Try again." }[r.reason] || "Couldn't start the rematch. Try again.", "error");
      fb().sync();
    }
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest && e.target.closest("#bt-res [data-bt]"); if (!b || b.disabled) return;
    e.preventDefault(); const a = b.dataset.bt, id = room() && room().id; if (!id) return;
    if (a === "claim") { rwWait = claimReward(); return; }
    if (rmBusy) return;
    rmBusy = true; rmSig = ""; watchRematch();
    const r = a === "rematch" ? await fb().call("bt_rematch_request", { p_room: id }) : await fb().call("bt_rematch_respond", { p_room: id, p_accept: a === "accept" });
    rmBusy = false; rmSig = ""; await afterRematch(r, id);
  });

  // ---------- lifecycle ----------
  function update(st) {
    if (leaving) return; if (st) S = st; if (!S) return;
    const st2 = room().status;
    if (st2 !== "playing" && st2 !== "finished") return;
    if (!on) enter();
    drawBar(); drawHints(); drawKeys(); drawTimer();
    if (!busy) syncBoard();
    if (st2 === "finished" && !busy && !hintBusy) { showResult(); if (resultShown) watchRematch(); }
  }
  function enter() {
    on = true; resultShown = false; cur = ""; rendered = 0; busy = false; lastCd = -1; leaving = false;
    buildUi(); buildBoard(); show("game");
    clearInterval(tmr); tmr = setInterval(() => { if (!S) return; drawTimer(); drawBar(); tickRematch(); }, 250);
  }
  function exit(toBattle) {
    clearInterval(tmr); tmr = 0; on = false; leaving = true;
    const r = $("#bt-res"); if (r) r.remove(); lockModal(false);
    const cd = $("#bt-cd"); if (cd) cd.remove();
    const g = $("#game"); if (g) g.classList.remove("battle");
    ["bt-top", "bt-clue"].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
    $$(".hint").forEach((b) => { delete b.dataset.state; b.title = ""; const bd = b.querySelector(".badge"); if (bd) bd.textContent = ""; });
    $$("#keyboard .key").forEach((k) => k.classList.remove("correct", "present", "absent", "disabled"));
    S = null; rendered = 0; cur = ""; busy = false; resultShown = false;
    rwState = "idle"; rwInfo = null; rwRoom = ""; rmSig = ""; rmDeadline = 0; rmBusy = false;
    if (toBattle) { fb().end(); show("battle"); }
    leaving = false;
  }
  async function leavePrompt() {
    if (resultShown) return exit(true);
    if (playing() && !(await confirmBox("Leave the battle?", "Leaving counts as a forfeit and your opponent wins.", "Leave"))) return;
    const id = room() && room().id; fb().end(); exit(false); show("dashboard");
    if (id) fb().call("bt_leave", { p_room: id });
  }

  // ---------- take over the solo handlers while a battle is on ----------
  document.addEventListener("click", (e) => {
    if (!on || screen !== "game") return;
    const t = e.target;
    const key = t.closest && t.closest("#keyboard .key");
    if (key) { e.stopPropagation(); e.preventDefault(); press(key.dataset.key); key.blur(); return; }
    if (t.closest("#btn-submit")) { e.stopPropagation(); e.preventDefault(); submit(); return; }
    const h = t.closest("[data-hint]"); if (h) { e.stopPropagation(); e.preventDefault(); useHint(h.dataset.hint); return; }
    if (t.closest("#g-back")) { e.stopPropagation(); e.preventDefault(); leavePrompt(); return; }
    if (t.closest("#btn-skip")) { e.stopPropagation(); e.preventDefault(); return; }
    if (t.closest("#game [data-go],#game [data-free-coins]")) { e.stopPropagation(); e.preventDefault(); toast("Finish your battle first.", ""); }
  }, true);
  window.addEventListener("keydown", (e) => {
    if (!on || screen !== "game") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "escape") return;                                  // closing the clue still works
    if (e.target.closest && e.target.closest("input,textarea,select")) return;
    e.stopImmediatePropagation();
    if (k === "enter") { e.preventDefault(); if (!e.repeat) press("enter"); } else if (k === "backspace") press("back"); else if (/^[a-z]$/.test(k)) press(k);
  }, true);
  window.addEventListener("beforeunload", (e) => { if (on && playing() && !resultShown) { e.preventDefault(); e.returnValue = ""; } });

  window.BattleGame = { update, exit, recover, isOn: () => on };
})();