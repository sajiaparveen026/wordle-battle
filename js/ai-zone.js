// AI Zone: play a Wordle battle against the computer. Everything runs in the browser (see js/ai-engine.js), no API and no key.
// It reuses the Wordle game screen (#game): the same board, keyboard, tile colours, word list and feedback function (evaluate in app.js).
// The secret word lives only in this file's match object; the AI is handed nothing but its own guesses and their feedback.
(function () {
  "use strict";
  const LEVELS = {
    easy: { name: "Easy", tag: "Beginner", bot: "BOLT", think: 20, line: "A friendly opponent for beginners. It takes its time and often guesses at random." },
    medium: { name: "Medium", tag: "Challenger", bot: "NOVA", think: 12, line: "A smarter rival that learns from the clues. A balanced challenge." },
    hard: { name: "Hard", tag: "Master", bot: "TITAN", think: 7, line: "A strategic mastermind that narrows the word down fast. Beatable, but only just." }
  };
  const TURN_CAP_MS = 1500;                 // one timer tick can never count more than this (a sleeping laptop cannot "skip" the AI's thinking)
  const K = { g: "correct", y: "present", x: "absent" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const snd = (n, ...a) => { try { if (typeof sfx !== "undefined" && sfx[n]) sfx[n](...a); } catch {} };
  const gfx = (n, ...a) => { try { if (typeof window[n] === "function") return window[n](...a); } catch {} };
  const quick = () => typeof reduced === "function" && reduced();
  const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(wbKey(k))); } catch { return null; } }, set(k, v) { try { localStorage.setItem(wbKey(k), JSON.stringify(v)); } catch {} }, del(k) { try { localStorage.removeItem(wbKey(k)); } catch {} } };

  // ---------- robot avatars (silver, gold and charcoal only; the gradients live in the hidden sprite in index.html) ----------
  function robot(level, px) {
    const ink = 'stroke="#141415" stroke-opacity=".75" stroke-width="1.6" stroke-linejoin="round"';
    const eyes = {
      easy: '<circle cx="25" cy="32" r="4.4" fill="url(#azGld)"/><circle cx="39" cy="32" r="4.4" fill="url(#azGld)"/><circle cx="26.3" cy="30.7" r="1.2" fill="#fff" opacity=".85"/><circle cx="40.3" cy="30.7" r="1.2" fill="#fff" opacity=".85"/><path d="M25 39.5q7 5 14 0" fill="none" stroke="url(#azGld)" stroke-width="2.4" stroke-linecap="round"/>',
      medium: '<rect x="18" y="27" width="28" height="9" rx="4.5" fill="#0d0d0e"/><rect x="21" y="29.5" width="22" height="4" rx="2" fill="url(#azGld)"/><path d="M24 41h16M26 44.4h12" stroke="url(#azGld)" stroke-width="1.8" stroke-linecap="round"/>',
      hard: '<path d="M18 29l9 3.4-1.4 4.4-9-2z" fill="url(#azGld)"/><path d="M46 29l-9 3.4 1.4 4.4 9-2z" fill="url(#azGld)"/><path d="M25 43h14l-2 4.2H27z" fill="url(#azGld)"/>'
    }[level];
    const head = {
      easy: `<line x1="32" y1="14" x2="32" y2="7" stroke="url(#azSil)" stroke-width="2.4" stroke-linecap="round"/><circle cx="32" cy="6" r="3.2" fill="url(#azGld)" ${ink}/><rect x="5.5" y="26" width="5" height="13" rx="2.2" fill="url(#azGld)" ${ink}/><rect x="53.5" y="26" width="5" height="13" rx="2.2" fill="url(#azGld)" ${ink}/><rect x="10" y="14" width="44" height="38" rx="17" fill="url(#azSil)" ${ink}/><rect x="15" y="21" width="34" height="26" rx="11" fill="url(#azDrk)"/>`,
      medium: `<line x1="32" y1="13" x2="32" y2="6" stroke="url(#azSil)" stroke-width="2.4" stroke-linecap="round"/><circle cx="32" cy="5.5" r="3.4" fill="none" stroke="url(#azGld)" stroke-width="2.2"/><rect x="4.5" y="24" width="6" height="16" rx="2" fill="url(#azSil)" ${ink}/><rect x="53.5" y="24" width="6" height="16" rx="2" fill="url(#azSil)" ${ink}/><rect x="9" y="13" width="46" height="40" rx="9" fill="url(#azSil)" ${ink}/><rect x="14" y="20" width="36" height="28" rx="6" fill="url(#azDrk)"/><rect x="9" y="13" width="46" height="5" rx="2.5" fill="url(#azGld)" opacity=".95"/>`,
      hard: `<path d="M24 13l8-10 8 10z" fill="url(#azGld)" ${ink}/><path d="M13 20l7-7h24l7 7 4 15-9 17H18L9 35z" fill="url(#azDrk)" stroke="url(#azSil)" stroke-width="2.4" stroke-linejoin="round"/><path d="M14.5 21l5.5-5.5h24l5.5 5.5" fill="none" stroke="url(#azGld)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 46l4 6M44 46l-4 6" stroke="url(#azSil)" stroke-width="2.2" stroke-linecap="round"/>`
    }[level];
    return `<svg class="az-bot" viewBox="0 0 64 60" width="${px}" height="${Math.round(px * 60 / 64)}" aria-hidden="true" focusable="false">${head}${eyes}</svg>`;
  }

  // ---------- state ----------
  let on = false, M = null, ai = null, cur = "", rendered = 0, busy = false, aiBusy = false, aiTurn = 0, tickId = 0, lastT = 0, lastSave = 0, stHtml = "", entering = false, enterTok = 0;
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const clearLater = () => { timers.forEach(clearTimeout); timers.clear(); };
  const rowEl = (i) => $("#board").children[i];
  const lv = () => LEVELS[M.level];
  const modalOpen = () => document.body.classList.contains("modal-open");
  const canType = () => on && !!M && screen === "game" && M.phase === "play" && M.pStatus === "active" && !busy && !modalOpen() && rendered < ROWS;
  const toCode = (res) => res.map((r) => (r === "correct" ? "g" : r === "present" ? "y" : "x")).join("");

  // ---------- the AI Zone screen ----------
  function savedMatch() {
    const m = store.get("ai_match");
    if (!m || m.phase !== "play" || !LEVELS[m.level] || typeof m.secret !== "string" || m.secret.length !== COLS || !Array.isArray(m.pGuesses) || !Array.isArray(m.aGuesses)) return null;
    return m;
  }
  function renderHome() {
    const root = $("#az-root"); if (!root) return;
    const rec = savedMatch(), a = Player.data.ai, lock = !!rec || entering;
    const card = (k) => { const L = LEVELS[k]; return `<article class="az-lv ${k}" data-az="enter" data-level="${k}" aria-label="${L.name}, ${L.tag}. Your opponent is ${L.bot}. ${esc(L.line)} Thinks for ${L.think} seconds per guess.">
      <span class="az-plate">${robot(k, 66)}</span>
      <div class="az-lvt"><h3>${L.bot} <small>${L.tag}</small></h3><p>${esc(L.line)}</p><span class="az-pills"><span class="az-pill">⏱ Thinks ${L.think}s per guess</span></span></div>
      <button class="az-go" type="button" data-az="enter" data-level="${k}"${lock ? " disabled" : ""}${rec ? ' title="Finish or forfeit your current match first"' : ""} aria-label="Enter ${L.name} match against ${L.bot}">Enter →</button></article>`; };
    root.innerHTML = `<div class="fb-hero"><h2 class="sr-only">AI Zone</h2><p>Same secret word, 6 attempts each. First to solve it wins.</p></div>
      ${rec ? `<div class="az-resume" role="group" aria-label="Unfinished match"><span class="az-plate sm">${robot(rec.level, 38)}</span><div><b>Match in progress</b><small>${LEVELS[rec.level].name} · ${rec.pGuesses.length}/6 guesses</small></div><button class="primary" type="button" data-az="resume">Resume</button><button class="az-x" type="button" data-az="drop" aria-label="Forfeit the unfinished match">Forfeit</button></div>` : ""}
      <div class="az-cards" role="group" aria-label="Choose a difficulty and press Enter">${["easy", "medium", "hard"].map(card).join("")}</div>`;
  }
  // One click on Enter starts the match: no Select step, no Start Match button, no confirmation. The button shows a small loading state while the match is set up,
  // every Enter is locked at once, and one flag (entering) + one token (enterTok) make sure a double-click, a second tap or leaving the screen can never create two matches.
  function enter(level, btn) {
    if (entering || on || !LEVELS[level] || savedMatch()) return;
    entering = true; const tok = ++enterTok;
    $$("#az-root .az-go").forEach((b) => { b.disabled = true; if (b === btn) { b.classList.add("loading"); b.setAttribute("aria-busy", "true"); b.innerHTML = '<span class="az-spin" aria-hidden="true"></span>Entering…'; } });
    later(() => {
      if (tok !== enterTok) return;                                                           // the screen changed meanwhile (screenChanged already reset the flag)
      entering = false;
      if (screen !== "aizone") return;
      startMatch(level);
    }, quick() ? 0 : 450);
  }

  // ---------- the match screen ----------
  function buildHud() {
    const g = $("#game"); g.classList.add("ai");
    if ($("#az-top")) return;
    const top = document.createElement("div"); top.id = "az-top"; top.className = "az-top";
    top.innerHTML = `<div class="az-panel" id="az-panel">
      <span class="az-plate sm" id="az-av"></span>
      <div class="az-id"><b id="az-name"></b><span class="az-chip" id="az-chip"></span><button class="az-tg" id="az-tg" type="button" aria-expanded="false" aria-controls="az-mini" aria-label="Show all of the AI's guesses"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6"/></svg></button></div>
      <div class="az-att" id="az-att"></div>
      <div class="az-st" id="az-st" role="status" aria-live="polite"></div>
      <div class="az-last" id="az-last" aria-label="Latest AI guess"></div>
      <button class="az-vis" id="az-vis" type="button" aria-controls="az-mini"><span class="az-vis-ic" aria-hidden="true"><svg class="on" viewBox="0 0 24 24" focusable="false"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><svg class="off" viewBox="0 0 24 24" focusable="false"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19C5.6 19 2 12 2 12a18.5 18.5 0 0 1 5.1-5.9"/><path d="M9.9 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="M2 2l20 20"/></svg></span><span class="az-vis-tx"></span></button></div>
      <div class="az-mini" id="az-mini" aria-label="AI board"></div><p class="az-veil" id="az-veil"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19C5.6 19 2 12 2 12a18.5 18.5 0 0 1 5.1-5.9"/><path d="M9.9 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="M2 2l20 20"/></svg><span>AI guesses are hidden</span></p><p class="az-note" id="az-note" role="status"></p><p class="az-clue hidden" id="az-clue"></p>`;
    g.insertBefore(top, $("#g-title"));
    $("#az-av").innerHTML = robot(M.level, 40); $("#az-name").textContent = lv().bot; $("#az-chip").innerHTML = `${lv().name}<span class="az-tagline"> · ${lv().tag}</span>`;
    $("#g-title").textContent = "AI Zone";
  }
  const miniRows = () => Array.from({ length: ROWS }, (_, r) => { const g = M.aGuesses[r]; return `<div class="az-mr">${Array.from({ length: COLS }, (_, c) => `<i class="az-t${g ? " " + K[g.code[c]] : ""}" data-r="${r}" data-c="${c}">${g ? esc(g.word[c]) : ""}</i>`).join("")}</div>`; }).join("");
  function drawMini() { const m = $("#az-mini"); if (m) m.innerHTML = miniRows(); drawLast(); }
  // Show / Hide AI Guesses (desktop only: the CSS only reveals the button and applies the hiding inside the desktop media query, so on phones and tablets this
  // flag is harmless and the guesses are drawn exactly as before). It only flips a class: the AI keeps guessing, the tiles keep being drawn behind the scenes.
  function drawVis() {
    const top = $("#az-top"), b = $("#az-vis"); if (!top || !M) return; const h = M.hideAi === true;
    top.classList.toggle("az-hide", h);
    if (b) { b.classList.toggle("is-hidden", h); const t = b.querySelector(".az-vis-tx"); if (t) t.textContent = h ? "Show AI Guesses" : "Hide AI Guesses"; }
  }
  function toggleVis() { if (!M) return; M.hideAi = M.hideAi !== true; drawVis(); persist(); }
  // The top-centre of the game screen shows "BATTLE WITH <AI NAME>" instead of the score while an AI match is on. It re-uses the score's own element (same spot),
  // so the score logic in app.js keeps running untouched underneath; the CSS (#game.ai only) just swaps which one is visible. begin() redraws it for every match.
  function drawTitle() {
    const ws = $("#game .winscore"); if (!ws || !M) return;
    let t = $("#az-bt"); if (!t) { t = document.createElement("span"); t.id = "az-bt"; t.className = "az-bt"; ws.append(t); }
    t.innerHTML = '<span class="az-bt-w">Battle with</span><span class="az-bt-n"></span>'; t.querySelector(".az-bt-n").textContent = lv().bot;
    ws.setAttribute("aria-label", "Battle with " + lv().bot); ws.removeAttribute("title");
  }
  function drawLast(hideRow) {
    const e = $("#az-last"); if (!e) return; const g = M.aGuesses[M.aGuesses.length - 1];
    e.innerHTML = Array.from({ length: COLS }, (_, c) => `<i class="az-t${g && hideRow !== M.aGuesses.length - 1 ? " " + K[g.code[c]] : ""}">${g && hideRow !== M.aGuesses.length - 1 ? esc(g.word[c]) : ""}</i>`).join("");
  }
  function drawAtt() { const e = $("#az-att"); if (!e) return; const n = M.aGuesses.length; e.innerHTML = `<b>${n}/${ROWS}</b><small>${ROWS - n} left</small>`; }
  function drawStatus() {
    const e = $("#az-st"); if (!e || !M) return;
    let h;
    if (M.phase === "ready") h = `<span class="az-state">Getting ready…</span>`;
    else if (M.aStatus === "solved") h = `<span class="az-state ok">Solved it!</span>`;
    else if (M.phase === "done") h = `<span class="az-state">Match over</span>`;
    else if (M.aStatus === "failed") h = `<span class="az-state">Out of attempts</span>`;
    else if (aiBusy) h = `<span class="az-state">Guessing…</span>`;
    else { const left = Math.max(0, Math.ceil(M.thinkLeft / 1000)), pct = Math.max(0, Math.min(100, 100 - (M.thinkLeft / (lv().think * 1000)) * 100));
      h = `<span class="az-state think">Thinking<span class="az-dots" aria-hidden="true"><i></i><i></i><i></i></span></span><b class="az-cd" aria-label="${left} seconds left">${left}s</b><span class="az-bar" aria-hidden="true"><i style="width:${pct.toFixed(1)}%"></i></span>`; }
    if (h !== stHtml) { stHtml = h; e.innerHTML = h; }
  }
  function notice(t) { const m = $("#submit-msg"); if (m && t != null) m.textContent = t; }

  // ---------- the player's power-ups: Reveal a Letter, Remove Wrong Letters, Use Clue ----------
  // Exactly the Friend Zone / Team Zone model (same buttons, same "Used" look): all three are always there, each can be used ONCE per match, using one never
  // touches the other two, and only the one that was used greys out. As in those battles they cost nothing, and they never touch the Solo free uses, Solo coin
  // prices or Solo's clue purchases, so the old Solo hint integration is gone from this file. The state is this match's own (M.pu).
  // The AI is never handed any of it: ai.next() only ever receives its own guesses and their feedback, and there is no code path that lets it use a power-up.
  const PU = { reveal: "Reveal a Letter", remove: "Remove Wrong Letters", word: "Use Clue" };
  const emptyPu = () => ({ reveal: null, remove: null, word: null });
  const clueDeckOf = (word) => { const d = window.CLUES && window.CLUES[word]; if (Array.isArray(d) && d.length) return d; const v = [...word].filter((c) => "aeiou".includes(c)).length; return [["fact", `It has ${v} vowel${v === 1 ? "" : "s"} and ${new Set(word).size} different letters.`]]; };
  const cleanPu = (h, secret) => {                                                           // a saved match is checked before it is trusted
    h = h && typeof h === "object" ? h : {}; const out = emptyPu();
    const r = h.reveal; if (r && Number.isInteger(r.pos) && r.pos >= 0 && r.pos < COLS && typeof r.letter === "string" && r.letter === secret[r.pos]) out.reveal = { pos: r.pos, letter: r.letter };
    const m = h.remove; if (m && Array.isArray(m.letters)) { const l = m.letters.filter((x, i, a) => typeof x === "string" && /^[a-z]$/.test(x) && !secret.includes(x) && a.indexOf(x) === i).slice(0, 5); if (l.length) out.remove = { letters: l }; }
    const w = h.word; if (w && Number.isInteger(w.i) && w.i >= 0 && w.i < clueDeckOf(secret).length) out.word = { i: w.i };
    return out;
  };
  const goneKeys = () => (M && M.pu && M.pu.remove ? M.pu.remove.letters : []);
  const canHint = () => on && !!M && screen === "game" && M.phase === "play" && M.pStatus === "active" && !busy && rendered < ROWS && !modalOpen();
  function planReveal() {
    const solved = new Set(); M.pGuesses.forEach((g) => [...g.word].forEach((ch, i) => { if (ch === M.secret[i]) solved.add(i); }));
    const open = [0, 1, 2, 3, 4].filter((i) => !solved.has(i));
    if (!open.length) return null;
    const pos = open[Math.floor(Math.random() * open.length)]; return { pos, letter: M.secret[pos] };
  }
  function planRemove() {
    const guessed = new Set(M.pGuesses.map((g) => g.word).join(""));
    const pool = [...("abcdefghijklmnopqrstuvwxyz")].filter((l) => !M.secret.includes(l) && !guessed.has(l));
    return pool.length ? pool.sort(() => Math.random() - 0.5).slice(0, 5) : null;
  }
  function drawHints() {                                                                    // Friend Zone look: the used one is greyed and disabled, the others stay ready
    $$(".hint").forEach((b) => {
      const t = b.dataset.hint; if (!PU[t]) return;
      const u = !!(M && M.pu && M.pu[t]);
      b.disabled = u || !canHint(); b.dataset.state = u ? "used" : ""; b.classList.remove("paid");
      const bd = b.querySelector(".badge"); if (bd) bd.textContent = u ? "Used" : ""; setCount(b, 0);
      b.setAttribute("aria-label", `${PU[t]}${u ? ", used" : ", one use per match"}`); b.title = `${PU[t]}${u ? " (used)" : ""}`;
    });
    const c = $("#az-clue"); if (!c) return;
    if (M && M.pu && M.pu.word) { const e = clueDeckOf(M.secret)[M.pu.word.i]; c.innerHTML = "<b>💡 Clue:</b> "; c.append(document.createTextNode(e[1])); c.classList.remove("hidden"); } else c.classList.add("hidden");
  }
  function paintHintTiles() {                                                               // the revealed letter shows faintly in its column of every unused row
    if (!M) return; const rv = M.pu && M.pu.reveal;
    for (let r = 0; r < ROWS; r++) [...rowEl(r).children].forEach((t, c) => { if (rv && c === rv.pos && r >= rendered) t.dataset.hint = rv.letter; else delete t.dataset.hint; });
  }
  function showClue() {                                                                     // the same clue pop-up Friend Zone uses, with nothing to buy
    const e = clueDeckOf(M.secret)[M.pu.word.i], main = $("#clue-main"); if (!main) return;
    main.innerHTML = clueRow(e); main.querySelector(".clue-text").textContent = e[1];
    $("#clue-count").textContent = "Your one clue for this match"; $("#clue-prev").classList.add("hidden");
    ["#clue-empty", "#clue-buy", "#clue-full"].forEach((q) => { const x = $(q); if (x) x.classList.add("hidden"); });
    main.classList.remove("hidden"); $("#clue-count").classList.remove("hidden");
    $("#clue").classList.remove("hidden"); lockModal(true); $("#clue-x").focus();
  }
  function useHint(type) {                                                                  // synchronous, so a double tap can never use one twice
    if (!PU[type] || !canHint() || M.pu[type]) return;
    if (type === "reveal") {
      const p = planReveal(); if (!p) return toast("You already know every letter's place!", "");        // nothing is used up when there was nothing to give
      M.pu.reveal = p; toast(`Letter ${p.pos + 1} is ${p.letter.toUpperCase()}`, "success");
    } else if (type === "remove") {
      const l = planRemove(); if (!l) return toast("There are no more letters to remove.", "");
      M.pu.remove = { letters: l }; toast(`${l.length} wrong letters removed`, "success");
    } else M.pu.word = { i: Math.floor(Math.random() * clueDeckOf(M.secret).length) };
    snd("coin"); try { flash($(`[data-hint=${type}]`)); } catch {}
    paintHintTiles(); drawKeys(); drawHints(); persist();
    if (type === "word") showClue();
  }

  // ---------- the player's side (same board, keyboard and feedback as every other game) ----------
  function drawTile(t, ch, kind) {
    t.textContent = ch; t.classList.remove("filled", "flip", "correct", "present", "absent"); if (kind) t.classList.add(kind);
    if (kind) t.setAttribute("aria-label", `${ch}, ${{ correct: "correct position", present: "in the word, wrong position", absent: "not in the word" }[kind]}`); else t.removeAttribute("aria-label");
  }
  const drawGuess = (i, g) => [...rowEl(i).children].forEach((t, c) => drawTile(t, g.word[c], K[g.pattern[c]]));
  function flipRow(i, g, done) {
    if (quick()) { drawGuess(i, g); return done(); }
    [...rowEl(i).children].forEach((t, c) => later(() => { t.classList.add("flip"); snd("flip", c); later(() => { drawTile(t, g.word[c], K[g.pattern[c]]); t.classList.add("flip"); }, 275); }, c * 280));
    later(done, COLS * 280 + 300);
  }
  function paintTyping() {
    $$(".tile.cursor").forEach((t) => t.classList.remove("cursor"));
    for (let r = 0; r < ROWS; r++) rowEl(r).classList.toggle("active", r === rendered && canType());
    if (rendered >= ROWS) return;
    [...rowEl(rendered).children].forEach((t, c) => { t.textContent = cur[c] || ""; t.classList.toggle("filled", !!cur[c]); });
    if (canType() && cur.length < COLS) rowEl(rendered).children[cur.length].classList.add("cursor");
    $("#btn-submit").disabled = !canType();
    paintHintTiles(); drawHints();
  }
  function drawKeys() {
    const rank = { absent: 1, present: 2, correct: 3 }, best = {};
    M.pGuesses.forEach((g) => [...g.word].forEach((ch, i) => { const k = K[g.pattern[i]]; if ((rank[k] || 0) > (rank[best[ch]] || 0)) best[ch] = k; }));
    $$("#keyboard .key").forEach((k) => { k.classList.remove("correct", "present", "absent", "disabled"); if (best[k.dataset.key]) k.classList.add(best[k.dataset.key]); k.classList.toggle("disabled", goneKeys().includes(k.dataset.key)); });
  }
  function press(k) {
    if (!canType()) return;
    if (k === "enter") return submit();
    if (k === "back") { cur = cur.slice(0, -1); notice(""); snd("key"); }
    else if (/^[a-z]$/.test(k) && cur.length < COLS && !goneKeys().includes(k)) { cur += k; notice(""); snd("key"); }
    paintTyping();
  }
  function bad(msg) { notice(msg); snd("bad"); const el = rowEl(rendered); if (!el) return; el.classList.add("shake", "invalid"); setTimeout(() => el.classList.remove("shake", "invalid"), 450); }
  function submit() {
    if (busy || !canType()) return;
    if (cur.length < COLS) return bad("Not enough letters");
    if (typeof VALID !== "undefined" && !VALID.has(cur)) return bad("Not a word!");         // the AI is held to the same rule: it can only pick accepted words
    if (M.pGuesses.some((g) => g.word === cur)) return bad("Already guessed");
    const word = cur, row = rendered, pattern = toCode(evaluate(word, M.secret));
    busy = true; cur = ""; rendered = row + 1; notice("");
    M.pGuesses.push({ word, pattern });
    const solved = pattern === "ggggg", out = !solved && M.pGuesses.length >= ROWS;
    if (solved) M.pStatus = "solved"; else if (out) M.pStatus = "failed";
    const delay = quick() ? 0 : COLS * 280 + 300;
    if (solved) finish("win", delay + 150);                                                  // decided right now: the AI's clock is stopped immediately
    else if (out && M.aStatus === "failed") finish("draw", delay + 150);
    else persist();
    flipRow(row, { word, pattern }, () => { busy = false; drawKeys(); paintHintTiles(); if (solved) rowEl(row).classList.add("win"); paintTyping(); if (out && M.phase === "play") { notice(""); } drawNote(); });
    paintTyping();
  }
  function drawNote() {
    const e = $("#az-note"); if (!e || !M) return; let t = "";
    if (M.phase === "play" && M.pStatus === "failed") t = `You're out of attempts. ${lv().bot} is still playing.`;
    else if (M.phase === "play" && M.aStatus === "failed") t = `${lv().bot} is out of attempts. Solve it to win!`;
    e.textContent = t;
  }

  // ---------- the AI's side: one guess per thinking period, nothing is decided before the countdown ends ----------
  function startTick() { stopTick(); lastT = performance.now(); tickId = setInterval(tick, 200); }
  function stopTick() { if (tickId) clearInterval(tickId); tickId = 0; }
  function tick() {
    if (!on || !M || M.phase !== "play") return;
    const now = performance.now(), dt = Math.min(Math.max(0, now - lastT), TURN_CAP_MS); lastT = now;
    const paused = document.hidden || modalOpen() || screen !== "game";                      // an open popup, another tab or another screen pauses everything
    if (!paused) {
      M.activeMs += dt;
      if (M.aStatus === "active" && !aiBusy) { M.thinkLeft -= dt; if (M.thinkLeft <= 0) aiMove(); }
    }
    drawStatus();
    if (now - lastSave > 1500) { lastSave = now; persist(); }
  }
  function aiMove() {
    if (aiBusy || !M || M.phase !== "play" || M.aStatus !== "active" || M.aGuesses.length >= ROWS) return;    // one guess per countdown, never two
    aiBusy = true; const turn = ++aiTurn;
    let word = ai.next(M.aGuesses.map((h) => ({ word: h.word, code: h.code })));                   // the engine sees its own guesses and their feedback only
    if (typeof VALID !== "undefined" && (!VALID.has(word) || M.aGuesses.some((h) => h.word === word))) word = [...ANSWERS].find((w) => !M.aGuesses.some((h) => h.word === w)) || ANSWERS[0];
    const code = toCode(evaluate(word, M.secret));
    M.aGuesses.push({ word, code });
    const row = M.aGuesses.length - 1, solved = code === "ggggg", out = !solved && M.aGuesses.length >= ROWS;
    if (solved) M.aStatus = "solved"; else if (out) M.aStatus = "failed";
    drawAtt(); drawStatus();
    const delay = quick() ? 0 : COLS * 220 + 300;
    if (solved) finish("loss", delay + 200);                                                  // the AI got it first: match over now, no more guesses from either side
    else if (out && M.pStatus === "failed") finish("draw", delay + 200);
    else persist();
    revealAi(row, () => {
      if (turn !== aiTurn || !M) return;
      aiBusy = false;
      if (M.phase === "play" && M.aStatus === "active") M.thinkLeft = lv().think * 1000;      // start thinking about the next guess
      drawNote(); drawStatus(); persist();
    });
  }
  function revealAi(row, done) {
    const g = M.aGuesses[row];
    drawLast(row);                                                                           // the "latest guess" row stays blank until the tiles flip
    const tiles = $$(`#az-mini .az-t[data-r="${row}"]`), last = $$("#az-last .az-t");
    const paint = (c) => { [tiles[c], last[c]].forEach((t) => { if (!t) return; t.textContent = g.word[c]; t.className = "az-t " + K[g.code[c]] + " flip"; }); };
    if (quick()) { for (let c = 0; c < COLS; c++) paint(c); return done(); }
    for (let c = 0; c < COLS; c++) later(() => { snd("flip", c); paint(c); }, c * 220);
    later(done, COLS * 220 + 200);
  }

  // ---------- starting, resuming, saving, leaving ----------
  function persist() {
    if (!M || M.phase !== "play") return;
    store.set("ai_match", { id: M.id, level: M.level, secret: M.secret, startedAt: M.startedAt, phase: "play", pGuesses: M.pGuesses, aGuesses: M.aGuesses, pStatus: M.pStatus, aStatus: M.aStatus, thinkLeft: Math.max(0, Math.round(M.thinkLeft)), activeMs: Math.round(M.activeMs), pu: M.pu, hideAi: M.hideAi === true });
  }
  function begin(m, fresh) {
    cleanup(false);
    M = m; M.hideAi = M.hideAi === true; ai = AIEngine.createPlayer(M.level); on = true; cur = ""; busy = false; aiBusy = false; stHtml = ""; rendered = 0;
    buildHud(); drawTitle(); buildBoard(); $$("#keyboard .key").forEach((k) => k.classList.remove("correct", "present", "absent", "disabled"));
    M.pGuesses.forEach((g, i) => { drawGuess(i, g); rendered++; });
    drawMini(); drawVis(); drawAtt(); drawKeys(); drawNote(); notice(""); show("game");
    paintTyping(); drawStatus();
    if (fresh) {
      M.phase = "ready"; drawStatus(); paintTyping();
      const wrap = $(".board-wrap"), cd = document.createElement("div"); cd.id = "az-cd"; cd.className = "bt-cd"; cd.setAttribute("role", "status"); wrap.append(cd);
      const step = (n) => { if (!M || M.id !== m.id) return; if (n === 0) { cd.remove(); M.phase = "play"; M.startedAt = new Date().toISOString(); M.thinkLeft = lv().think * 1000; persist(); startTick(); paintTyping(); drawStatus(); return; } cd.innerHTML = `<b>${n}</b><span>GET READY</span>`; snd("key"); later(() => step(n - 1), quick() ? 400 : 900); };
      step(3);
    } else { M.phase = "play"; persist(); startTick(); paintTyping(); }
  }
  function startMatch(level) {
    if (!LEVELS[level] || savedMatch() || (on && M && M.phase !== "done")) return;
    const id = "ai-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    begin({ id, level, secret: randomWord(), startedAt: new Date().toISOString(), phase: "ready", pGuesses: [], aGuesses: [], pStatus: "active", aStatus: "active", thinkLeft: LEVELS[level].think * 1000, activeMs: 0, pu: emptyPu() }, true);
  }
  function resumeMatch() { const m = savedMatch(); if (!m) return; m.pStatus = m.pStatus === "solved" || m.pStatus === "failed" ? m.pStatus : "active"; m.aStatus = m.aStatus === "solved" || m.aStatus === "failed" ? m.aStatus : "active"; m.thinkLeft = Math.max(1000, Math.min(LEVELS[m.level].think * 1000, Number(m.thinkLeft) || LEVELS[m.level].think * 1000)); m.activeMs = Math.max(0, Number(m.activeMs) || 0); m.pu = cleanPu(m.pu, m.secret); begin(m, false); }
  function cleanup(toZone) {
    stopTick(); clearLater(); aiTurn++; aiBusy = false; busy = false;
    const r = $("#az-res"); if (r) r.remove(); const cd = $("#az-cd"); if (cd) cd.remove(); lockModal(false);
    const g = $("#game"); if (g) g.classList.remove("ai");
    const bt = document.getElementById("az-bt"); if (bt) bt.remove(); const ws = $("#game .winscore"); if (ws) { ws.setAttribute("aria-label", "Wins"); ws.setAttribute("title", "Total wins"); }   // the score goes back to normal for every other mode
    ["az-top", "az-clue"].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); });
    $$("#keyboard .key").forEach((k) => k.classList.remove("correct", "present", "absent", "disabled"));
    $$("#board .tile").forEach((t) => delete t.dataset.hint);
    $$(".hint").forEach((b) => { delete b.dataset.state; b.title = ""; const bd = b.querySelector(".badge"); if (bd) bd.textContent = ""; });
    const n = $("#submit-msg"); if (n) n.textContent = "";
    M = null; ai = null; on = false; cur = ""; rendered = 0;
    if (toZone) show("aizone");
  }
  async function leavePrompt() {
    if (!M) return cleanup(true);
    if (M.phase === "done") return cleanup(true);
    if (!(await confirmBox("Leave the match?", "Leaving counts as a forfeit. You earn nothing and the match is not saved.", "Leave"))) return;
    store.del("ai_match"); cleanup(true);
  }

  // ---------- the end ----------
  function finish(outcome, delay) {
    if (!M || M.phase === "done") return;                                                    // one result per match, even if two things end it in the same moment
    M.phase = "done"; stopTick(); aiTurn++;                                                  // the thinking clock is cancelled right here
    store.del("ai_match");
    const reward = Player.rewardAI(M.id, M.level, outcome, { tries: M.pGuesses.length, aiTries: M.aGuesses.length, status: M.pStatus, ms: M.activeMs });
    const snap = { M: JSON.parse(JSON.stringify(M)), outcome, reward };
    paintTyping(); drawStatus();
    later(() => showResult(snap), Math.max(0, delay | 0));
  }
  function miniBoard(guesses, key) { return `<div class="az-mb">${Array.from({ length: ROWS }, (_, r) => { const g = guesses[r]; return `<div class="az-mr">${Array.from({ length: COLS }, (_, c) => `<i class="az-t${g ? " " + K[g[key][c]] : ""}">${g ? esc(g.word[c]) : ""}</i>`).join("")}</div>`; }).join("")}</div>`; }
  function showResult(s) {
    if (!on || !s || $("#az-res")) return;
    const { M: m, outcome, reward } = s, L = LEVELS[m.level], res = outcome, bot = L.bot;
    const head = { win: "VICTORY!", loss: "DEFEAT", draw: "DRAW" }[res];
    const msg = res === "win" ? `You cracked it in ${m.pGuesses.length} ${m.pGuesses.length === 1 ? "guess" : "guesses"}${m.aStatus === "failed" ? `, and ${esc(bot)} ran out of attempts` : ""}.`
      : res === "loss" ? `${esc(bot)} solved it in ${m.aGuesses.length} ${m.aGuesses.length === 1 ? "guess" : "guesses"}. Take your revenge!` : "Neither of you cracked the word this time.";
    // Player and AI cards share one structure (avatar, name, attempts, label) so the two columns always line up. The avatar goes through Avatars.inner(), because the
    // saved avatar can be an illustrated "@code" (for example "@knight") that must be drawn as an image, never printed as text.
    const you = esc(Player.data.username), pav = typeof Avatars !== "undefined" && Avatars.inner ? Avatars.inner(Player.data.avatar) : (String(Player.data.avatar || "").charAt(0) === "@" ? "🦊" : esc(Player.data.avatar));
    const me = `<div class="bt-fc${res === "win" ? " w" : ""}"><span class="bt-av" aria-hidden="true">${pav}</span><b class="az-nm" title="${you}">${you}</b><small>${m.pGuesses.length}/${ROWS} attempts</small>${res === "win" ? '<span class="tag">WINNER</span>' : '<span class="tag az-ai">YOU</span>'}</div>`;
    const bt = `<div class="bt-fc${res === "loss" ? " w" : ""}"><span class="bt-av az-plate sm" aria-hidden="true">${robot(m.level, 44)}</span><b class="az-nm" title="${esc(bot)}">${esc(bot)}</b><small>${L.name} · ${m.aGuesses.length}/${ROWS} attempts</small>${res === "loss" ? '<span class="tag">WINNER</span>' : '<span class="tag az-ai">AI</span>'}</div>`;
    const deck = clueDeckOf(m.secret), mc = deck.find((c) => c[0] === "meaning") || deck[0], meaning = mc ? mc[1] : "";   // the word's meaning (display only)
    const el = document.createElement("div"); el.id = "az-res"; el.className = "bt-res az-res"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "az-rt");
    el.innerHTML = `<div class="bt-card az-card ${res}"><h2 id="az-rt">${head}</h2>
      <div class="bt-fight">${me}<span class="bt-vs2">VS</span>${bt}</div><p>${msg}</p>
      <p class="bt-ans">The word was <b>${esc(m.secret.toUpperCase())}</b> · Match time <b>${mmss(m.activeMs)}</b></p>
      ${meaning ? `<p class="az-mean"><small>Meaning</small>${esc(meaning)}</p>` : ""}
      <div class="bt-rw" id="az-rw"></div>
      <div class="r-actions"><button class="again-link" type="button" data-az="again" id="az-again">Play again</button><div class="r-icons"><button class="r-icon" type="button" data-az="home" aria-label="Home" title="Home"><svg class="ri" aria-hidden="true" focusable="false"><use href="#r-home"/></svg><small>Home</small></button><button class="r-icon" type="button" data-az="profile" aria-label="Profile" title="Profile"><svg class="ri" aria-hidden="true" focusable="false"><use href="#r-profile"/></svg><small>Profile</small></button><button class="r-icon ai" type="button" data-az="zone" aria-label="AI Zone" title="AI Zone"><svg class="ri" aria-hidden="true" focusable="false"><use href="#r-robot"/></svg><small>AI Zone</small></button></div></div></div>`;
    document.body.append(el); lockModal(true); $("#az-again").focus();
    if (res === "win") { snd("win"); gfx("confetti"); } else if (res === "loss") snd("lose");
    drawReward(reward, res, m.id);
  }
  let fxFor = "";   // the match whose reward coins already flew (one animation per paid win)
  function drawReward(rw, res, matchId) {
    const box = $("#az-rw"); if (!box) return;
    if (!rw) { box.innerHTML = '<p class="bt-note2">Reward already collected.</p>'; return; }
    const lvl = Player.levelInfo();
    box.innerHTML = `<div class="rewardbox"><div class="rchips"><div class="chip"><b id="az-rc">+${rw.coins}</b><small>🪙 Coins</small></div><div class="chip xpc"><b id="az-rx">+${rw.xp}</b><small>⚡ XP</small></div></div>
      <small id="az-rb" class="r-balance">Balance: ${Player.data.coins} 🪙</small><div class="xp"><i id="az-xp" style="width:${Math.round(lvl.xp / lvl.need * 100)}%"></i></div><small>Level ${lvl.level} · ${lvl.xp}/${lvl.need} XP</small>${rw.levelUp ? '<p class="bt-note2">⬆ Level up!</p>' : ""}</div>`;
    // A win that was just paid (rw is only set when rewardAI credited it now) flies the coins into the top balance, like Solo / Daily; the balance shows the old number until they land.
    // Losses, draws and "already collected" results never animate, and one match animates once (fxFor), so reopening or re-drawing the result never replays it.
    if (res === "win" && rw.coins > 0 && matchId && fxFor !== matchId) {
      fxFor = matchId; const old = Math.max(0, Player.data.coins - rw.coins);
      $$(".coin-val").forEach((v) => (v.textContent = old)); const rb = $("#az-rb"); if (rb) rb.textContent = `Balance: ${old} 🪙`;
      setTimeout(() => { if (!$("#az-rc")) return gfx("refreshCoins"); gfx("coinsToBalance", $("#az-rc"), rw.coins, { onTick: (v) => { const b = $("#az-rb"); if (b) b.textContent = `Balance: ${v} 🪙`; } }); }, quick() ? 0 : 1050);
    } else gfx("refreshCoins");
    if (rw.coins) gfx("countUp", $("#az-rc"), rw.coins, "+"); if (rw.xp) gfx("countUp", $("#az-rx"), rw.xp, "+");
    gfx("animateXp", "#az-xp", Math.round(lvl.xp / lvl.need * 100));
    if (rw.coins) snd("coin");
  }

  // ---------- AI Battle Stats ----------
  // Read-only. Everything comes from what Player.rewardAI already saved: Player.data.ai (lifetime totals) and Player.data.ahist (one entry per finished match, written once per match id).
  // Forfeited and unfinished matches are never saved there, and no secret word is stored, so none can appear on this page. Nothing here writes data or changes rewards.
  let statsOpen = false, statsAll = false;
  const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const pctTxt = (w, n) => (n ? Math.round((w / n) * 100) + "%" : "\u2014");
  const fmtWhen = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) + " \u00b7 " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
  function statsData() {
    const d = Player.data, seen = new Set(), hist = [];
    (Array.isArray(d.ahist) ? d.ahist : []).forEach((r) => {                                 // valid, finished and unique (by match id) records only
      if (!r || typeof r.id !== "string" || seen.has(r.id) || !LEVELS[r.level] || !["win", "loss", "draw"].includes(r.result)) return;
      seen.add(r.id); hist.push(r);
    });
    hist.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const count = (l) => ({ played: l.length, won: l.filter((r) => r.result === "win").length, lost: l.filter((r) => r.result === "loss").length, draw: l.filter((r) => r.result === "draw").length });
    const byLevel = {}; Object.keys(LEVELS).forEach((k) => { byLevel[k] = count(hist.filter((r) => r.level === k)); });
    const a = d.ai || {}, h = count(hist), partial = num(a.played) > hist.length;           // partial: more matches were played than the last-50 list keeps
    const total = partial ? { played: num(a.played), won: num(a.won), lost: num(a.lost), draw: num(a.draw) } : h;
    let run = 0, best = 0; hist.forEach((r) => { if (r.result === "win") { run++; best = Math.max(best, run); } else if (r.result === "loss") run = 0; });
    return { hist, byLevel, total, partial, cur: partial ? num(a.streak) : run, best: Math.max(best, partial ? num(a.best) : 0) };
  }
  function donut(t) {
    const C = 2 * Math.PI * 48, den = Math.max(t.played, t.won + t.lost + t.draw); let off = 0;
    const seg = (n, cls) => { if (!n || !den) return ""; const len = C * n / den; const s = `<circle class="azs-seg ${cls}" cx="60" cy="60" r="48" style="stroke-dasharray:${len.toFixed(2)} ${(C - len).toFixed(2)};stroke-dashoffset:${(-off).toFixed(2)}"/>`; off += len; return s; };
    return `<svg class="azs-ring" viewBox="0 0 120 120" aria-hidden="true" focusable="false"><circle class="azs-track" cx="60" cy="60" r="48"/>${seg(t.won, "w")}${seg(t.lost, "l")}${seg(t.draw, "d")}</svg>`;
  }
  function renderStats() {
    const box = $("#az-stats"); if (!box) return;
    const S = statsData(), t = S.total, rate = pctTxt(t.won, t.played), newest = S.hist.slice().reverse(), list = statsAll ? newest : newest.slice(0, 10);
    const tile = (v, l, c) => `<div class="azs-tile${c ? " " + c : ""}"><b>${v}</b><small>${l}</small></div>`;
    const lv = (k) => {
      const L = LEVELS[k], c = S.byLevel[k], mini = (v, l) => `<div><b>${v}</b><small>${l}</small></div>`;
      return `<article class="azs-lv ${k}" aria-label="${L.name} difficulty statistics"><header><span class="az-plate sm" aria-hidden="true">${robot(k, 34)}</span><h4>${L.name}<small>${esc(L.bot)}</small></h4><b class="azs-rate" title="Win rate">${pctTxt(c.won, c.played)}</b></header>
        <div class="azs-bar" role="img" aria-label="${c.won} wins, ${c.lost} losses, ${c.draw} draws"><i class="w" style="flex-grow:${c.won}"></i><i class="l" style="flex-grow:${c.lost}"></i><i class="d" style="flex-grow:${c.draw}"></i></div>
        <div class="azs-mini">${mini(c.played, "Played")}${mini(c.won, "Wins")}${mini(c.lost, "Losses")}${mini(pctTxt(c.won, c.played), "Win rate")}</div></article>`;
    };
    const row = (r) => {
      const L = LEVELS[r.level], res = r.result, lbl = { win: "WIN", loss: "LOSS", draw: "DRAW" }[res];
      return `<li class="azs-row ${res}"><span class="az-plate sm" aria-hidden="true">${robot(r.level, 30)}</span><div class="azs-who"><b>${esc(L.bot)}</b><small>${L.name}</small></div><span class="azs-res ${res}">${lbl}</span>
        <div class="azs-meta"><span>\uD83C\uDFAF ${num(r.tries)}/${ROWS} guesses</span><span>\u23F1 ${r.ms == null ? "\u2014" : mmss(r.ms)}</span><span class="azs-rw">\uD83E\uDE99 +${num(r.coins)} \u00b7 \u26A1 +${num(r.xp)} XP</span></div><time datetime="${esc(r.at)}">${esc(fmtWhen(r.at))}</time></li>`;
    };
    box.innerHTML = `<section class="azs-card" aria-labelledby="azs-h1"><h3 id="azs-h1">Overall Statistics</h3>
        <div class="azs-ov"><div class="azs-donut">${donut(t)}<div class="azs-dc"><b>${rate}</b><small>Win rate</small></div></div>
          <ul class="azs-leg"><li class="w"><i></i>Wins<b>${t.won}</b></li><li class="l"><i></i>Losses<b>${t.lost}</b></li><li class="d"><i></i>Draws<b>${t.draw}</b></li></ul></div>
        <div class="azs-tiles">${tile(t.played, "Battles Played")}${tile(t.won, "Battles Won", "w")}${tile(t.lost, "Battles Lost")}${tile(rate, "Win Rate", "w")}${tile(S.cur, "Current Win Streak")}${tile(S.best, "Best Win Streak")}</div>
        <p class="azs-note">Win rate = wins \u00f7 battles played. Forfeited matches are not counted.${S.partial ? " Difficulty stats and history cover your latest 50 battles." : ""}</p></section>
      <section class="azs-card" aria-labelledby="azs-h2"><h3 id="azs-h2">Difficulty Statistics</h3><div class="azs-lvs">${Object.keys(LEVELS).map(lv).join("")}</div></section>
      <section class="azs-card" aria-labelledby="azs-h3"><h3 id="azs-h3">Battle Performance</h3>
        ${list.length ? `<ul class="azs-hist">${list.map(row).join("")}</ul>` : `<p class="azs-empty">${t.played ? "No battle details are saved yet." : "No completed AI battles yet."} Finish a match against BOLT, NOVA or TITAN and it will show up here.</p>`}
        ${newest.length > 10 ? `<button class="azs-more" type="button" data-az="statsmore" aria-expanded="${statsAll}">${statsAll ? "Show less" : "Show all " + newest.length + " battles"}</button>` : ""}</section>
      <button class="primary alt azs-back" type="button" data-az="statsback">\u2190 Back to AI Zone</button>`;
  }
  function setStatsView(open) {
    statsOpen = open; const root = $("#az-root"), box = $("#az-stats"), t = $("#az-title"), b = $("#az-stbtn");
    if (root) root.classList.toggle("hidden", open); if (box) box.classList.toggle("hidden", !open);
    if (t) t.textContent = open ? "AI Battle Stats" : "AI Zone"; if (b) { b.setAttribute("aria-expanded", String(open)); b.classList.toggle("on", open); }
  }
  function openStats() { if (statsOpen) return; statsAll = false; renderStats(); setStatsView(true); try { window.scrollTo(0, 0); $("#az-stats").focus({ preventScroll: true }); } catch {} }
  function closeStats(refocus) { if (!statsOpen) return; setStatsView(false); renderHome(); try { window.scrollTo(0, 0); if (refocus) $("#az-stbtn").focus({ preventScroll: true }); } catch {} }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("[data-az]");
    if (a && ($("#aizone") && !$("#aizone").classList.contains("hidden") || a.closest("#az-res"))) {
      const act = a.dataset.az;
      if (act === "enter") { e.preventDefault(); const go = a.classList.contains("az-lv") ? a.querySelector(".az-go") : a; if (go && !go.disabled) enter(a.dataset.level, go); }   // the whole card works like its Enter button (and respects it being locked)
      else if (act === "resume") resumeMatch();
      else if (act === "drop") { store.del("ai_match"); renderHome(); toast("Match forfeited", ""); }
      else if (act === "again") { const lvl = M ? M.level : null; cleanup(false); if (LEVELS[lvl]) startMatch(lvl); }
      else if (act === "home") { cleanup(false); show("dashboard"); }
      else if (act === "profile") { cleanup(false); show("profile"); }
      else if (act === "zone") cleanup(true);
      else if (act === "stats") openStats();
      else if (act === "statsback") closeStats(true);
      else if (act === "statsmore") { statsAll = !statsAll; renderStats(); const m = $("#az-stats .azs-more"); if (m) m.focus({ preventScroll: true }); }
      return;
    }
    if (e.target.closest && e.target.closest("#az-back")) { if (statsOpen) closeStats(true); else show("battle"); return; }
    if (e.target.closest && e.target.closest("#az-vis")) { toggleVis(); return; }
    const tg = e.target.closest && e.target.closest("#az-tg");
    if (tg) { const o = $("#az-top").classList.toggle("open"); tg.setAttribute("aria-expanded", String(o)); return; }
  });
  document.addEventListener("click", (e) => {                                                // take over the Solo handlers while a match is on
    if (!on || screen !== "game" || !M) return;
    const t = e.target;
    const key = t.closest && t.closest("#keyboard .key");
    if (key) { e.stopPropagation(); e.preventDefault(); press(key.dataset.key); key.blur(); return; }
    if (t.closest("#btn-submit")) { e.stopPropagation(); e.preventDefault(); submit(); return; }
    const hb = t.closest("[data-hint]"); if (hb) { e.stopPropagation(); e.preventDefault(); useHint(hb.dataset.hint); return; }   // the player's own power-ups
    if (t.closest("#btn-skip")) { e.stopPropagation(); e.preventDefault(); return; }                                              // Skip is not part of battles (hidden, as in Friend Zone)
    if (t.closest("#g-back")) { e.stopPropagation(); e.preventDefault(); leavePrompt(); return; }
    if (t.closest("#game [data-go],#game [data-free-coins]")) { e.stopPropagation(); e.preventDefault(); toast("Finish your match first.", ""); }
  }, true);
  window.addEventListener("keydown", (e) => {
    if (!on || screen !== "game" || !M) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "escape") return;
    if (e.target.closest && e.target.closest("input,textarea,select")) return;
    e.stopImmediatePropagation();
    if (k === "enter") { e.preventDefault(); if (!e.repeat) press("enter"); } else if (k === "backspace") press("back"); else if (/^[a-z]$/.test(k)) press(k);
  }, true);
  document.addEventListener("visibilitychange", () => { if (on && M && M.phase === "play") { persist(); lastT = performance.now(); } });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && statsOpen && screen === "aizone" && !modalOpen()) closeStats(true); });
  window.addEventListener("pagehide", () => { if (on && M && M.phase === "play") persist(); });

  window.AIZone = {
    screenChanged(name) { enterTok++; entering = false; if (statsOpen) setStatsView(false); if (name === "aizone") renderHome(); },
    isOn: () => on, levels: LEVELS, robot
  };
})();