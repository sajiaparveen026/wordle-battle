// Wordle Battle — solo game + dashboard, coins and hints. Data lives in localStorage (demo mode).
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const ROWS = 6, COLS = 5;
const KEYS = ["qwertyuiop", "asdfghjkl", "zxcvbnm-"]; // - = Backspace. No on-screen Enter: guesses are sent with the Submit button
const AVATARS = ["🦊", "🐼", "🐯", "🦉", "🐙", "🚀"];

// ---------- Storage ----------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(wbKey(k))) ?? d; } catch { return d; } };
const save = (k, v, quiet) => { localStorage.setItem(wbKey(k), JSON.stringify(v)); if (k === "stats" && !quiet) window.dispatchEvent(new Event("wb:save")); };
const AUTH_SCREENS = ["welcome", "signup", "login", "forgot", "reset", "verify"];
let settings = load("settings", { theme: "dark", mute: false });
if (settings.reduceMotion === undefined) settings.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const reduced = () => !!settings.reduceMotion;
let stats = load("stats", { played: 0, wins: 0, streak: 0, best: 0, dist: [0, 0, 0, 0, 0, 0], lastDaily: "" });

// ---------- Game state ----------
let mode = "practice", answer = "", gameId = "", guesses = [], current = "", status = "playing", busy = false;
const newHint = () => ({ reveals: {}, disabled: [], clues: [] }); // clues = indexes of the word-hint clues already shown in this game
const loadHint = (h) => { const o = Object.assign(newHint(), h || {}); if (!Array.isArray(o.clues)) o.clues = []; return o; };
let hintState = newHint();
// Dates use the player's LOCAL day, so the daily resets at their own midnight.
const isoLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => isoLocal();
const dailyWord = () => ANSWERS[Math.floor(new Date(today()).getTime() / 864e5) % ANSWERS.length];
const randomWord = () => ANSWERS[Math.floor(Math.random() * ANSWERS.length)];

// ---------- Scoring (handles repeated letters) ----------
function evaluate(guess, secret) {
  const res = Array(COLS).fill("absent"), left = {};
  for (let i = 0; i < COLS; i++) {
    if (guess[i] === secret[i]) res[i] = "correct";
    else left[secret[i]] = (left[secret[i]] || 0) + 1;
  }
  for (let i = 0; i < COLS; i++) {
    if (res[i] === "correct") continue;
    if (left[guess[i]] > 0) { res[i] = "present"; left[guess[i]]--; }
  }
  return res;
}

// ---------- Sound ----------
let audio;
function beep(freq, dur = 0.08, type = "sine") {
  if (settings.mute) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = 0.06;
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + dur);
  } catch {}
}
const sfx = {
  key: () => beep(520, 0.04), bad: () => beep(150, 0.18, "square"), coin: () => { beep(880, 0.07); setTimeout(() => beep(1320, 0.1), 70); },
  flip: (i) => beep(400 + i * 60, 0.07),
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.15), i * 110)),
  lose: () => [300, 240, 180].forEach((f, i) => setTimeout(() => beep(f, 0.2, "triangle"), i * 150))
};

// ---------- Small UI helpers ----------
function toast(text, kind = "", ms = 2200) {
  const el = document.createElement("div"); el.className = "msg " + kind; el.textContent = text;
  $("#toast").prepend(el); setTimeout(() => el.remove(), ms);
}
// Shows a dialog; resolves with the index of the clicked button.
// extra (optional) = { icon: "bulb", rows: [[label, value], ...] } adds an icon and a cost/balance table (used before spending coins).
function dialog(title, msg, buttons, extra) {
  return new Promise((resolve) => {
    $("#dlg-title").textContent = title; $("#dlg-msg").textContent = msg;
    const ex = $("#dlg-extra"); ex.innerHTML = ""; ex.classList.toggle("hidden", !extra);
    if (extra) {
      if (extra.icon) { const i = document.createElement("div"); i.className = "buy-ico mini-tile t-" + (extra.icon === "bulb" ? "word" : extra.icon); i.setAttribute("aria-hidden", "true"); i.innerHTML = `<svg viewBox="0 0 32 32" focusable="false"><use href="#i-${extra.icon}"/></svg>`; ex.append(i); }
      (extra.rows || []).forEach(([k, v, cls]) => { const r = document.createElement("div"); r.className = "buy-row" + (cls ? " " + cls : ""); const a = document.createElement("span"), b = document.createElement("b"); a.textContent = k; b.textContent = v; r.append(a, b); ex.append(r); });
    }
    const box = $("#dlg-actions"); box.innerHTML = ""; let done = false;
    buttons.forEach((label, i) => {
      const b = document.createElement("button");
      b.className = "primary" + (i === 0 && buttons.length > 1 ? " alt" : ""); b.textContent = label;
      b.onclick = () => { if (done) return; done = true; $("#dialog").classList.add("hidden"); resolve(i); }; // answers once: a double tap can't confirm twice
      box.append(b);
    });
    $("#dialog").classList.remove("hidden");
  });
}
const confirmBox = async (title, msg, ok = "Yes") => (await dialog(title, msg, ["Cancel", ok])) === 1;
// Purchase popup: shows the cost, the current balance and what is left afterwards. Resolves true only if the player confirms.
async function confirmSpend(title, msg, cost, icon) {
  const bal = Player.data.coins;
  return (await dialog(title, msg, ["Cancel", `Spend ${cost} 🪙`], { icon, rows: [["Cost", `${cost} 🪙`], ["Your coins", `${bal} 🪙`], ["Left after", `${Math.max(0, bal - cost)} 🪙`, "after"]] })) === 1;
}
let spendLock = false; // one coin purchase in progress at a time (hint, skip or shop): no duplicate charges
const flash = (b) => { if (!b || reduced()) return; b.classList.remove("used"); void b.offsetWidth; b.classList.add("used"); setTimeout(() => b.classList.remove("used"), 700); };
function confetti() {
  if (reduced()) return;
  const colors = ["#FACC15", "#FAFAF5", "#F2C230", "#8A7A3A"];
  for (let i = 0; i < 50; i++) {
    const c = document.createElement("i"); c.className = "confetti";
    c.style.left = Math.random() * 100 + "vw"; c.style.background = colors[i % 4];
    c.style.animationDuration = 1.8 + Math.random() * 1.6 + "s"; c.style.animationDelay = Math.random() * 0.5 + "s";
    document.body.append(c); setTimeout(() => c.remove(), 4200);
  }
}

// ---------- Screens ----------
let screen = "dashboard", prevScreen = "dashboard";
// Sign-in screens get browser-history entries (#signup, #login, ...) so Back / Forward / refresh stay on the right form.
const HIST_SCREENS = ["welcome", "signup", "login", "forgot"];
let histReady = false;
function syncHistory(name) {
  try {
    const url = ["signup", "login", "forgot"].includes(name) ? "#" + name : location.pathname + location.search, cur = history.state && history.state.screen;
    if (!histReady) { history.replaceState({ screen: name }, "", url); histReady = true; }
    else if (HIST_SCREENS.includes(name) && cur !== name) history.pushState({ screen: name }, "", url);
    else if (!HIST_SCREENS.includes(name) && location.hash) history.replaceState({ screen: name }, "", url);
  } catch {}
}
function show(name, fromHistory) {
  if (!fromHistory) syncHistory(name);
  if (name !== screen) prevScreen = screen;
  screen = name;
  $$(".screen").forEach((s) => s.classList.toggle("hidden", s.id !== name));
  const el = $("#" + name); el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter");
  $("#bottomnav").classList.toggle("hidden", name === "game" || AUTH_SCREENS.includes(name));
  const navMap = { game: "play", battle: "play" };
  $$("#bottomnav [data-nav]").forEach((b) => b.classList.toggle("on", b.dataset.nav === (navMap[name] || name)));
  if (name === "leaderboard") renderLeaderboard();
  if (name === "dashboard") renderDashboard();
  if (name === "dashboard" && window.Tutorial) Tutorial.maybeAutoShow();
  if (window.Auth) Auth.renderAccount();
  if (name === "signup" && window.Auth && Auth.restoreSignupDraft) Auth.restoreSignupDraft(); // typed email / username come back (never passwords)
  if (name === "shop") renderShop();
  if (name === "settings") renderSettings();
  window.scrollTo(0, 0);
}
function go(target) {
  if (target === "practice" || target === "daily") return openGame(target);
  show(target);
}
function refreshCoins() {
  $$(".win-val").forEach((e) => (e.textContent = Player.data.wins));
  $$(".coin-val").forEach((e) => (e.textContent = Player.data.coins));
  $$(".streak-val").forEach((e) => (e.textContent = stats.streak));
}

// ---------- Dashboard ----------
function renderDashboard() {
  const p = Player.data, lv = Player.levelInfo();
  $("#d-avatar").textContent = p.avatar; $("#d-name").textContent = p.username;
  $("#d-level").textContent = `Level ${lv.level} · ${lv.xp}/${lv.need} XP`;
  $("#d-badge").textContent = lv.level; animateXp("#d-xp", (lv.xp / lv.need) * 100);
  const done = !!dailyRecord();
  $("#d-rewards").innerHTML = `<span>🪙 +${REWARDS.daily.coins} coins</span><span>⚡ +${REWARDS.daily.xp} XP</span><span>🔥 Streak ${stats.streak}</span>`;
  $("#d-daily-btn").textContent = done ? "View today's result" : "Play Now";
  $("#d-date").textContent = "📅 " + new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  $("#d-daily-note").textContent = done ? "✔ Completed today" : "Not played yet";
  refreshCoins();
}

// ---------- Settings ----------
function animateXp(sel, pct) { // bar fills from 0 each time it is shown
  const e = $(sel); e.style.width = "0%";
  requestAnimationFrame(() => requestAnimationFrame(() => (e.style.width = pct + "%")));
}
function renderLeaderboard() {
  const p = Player.data, lv = Player.levelInfo();
  $("#lb-list").innerHTML = `<li class="me"><span class="rank">1</span><span class="av">${p.avatar}</span><b>${p.username}</b><em>Lv ${lv.level} · ${p.xp} XP</em></li>`;
}
function renderSettings() {
  if (window.PWA) PWA.renderAbout();
  const pp = Player.data, pl = Player.levelInfo();
  $("#p-avatar").textContent = pp.avatar; $("#p-name").textContent = pp.username; $("#p-badge").textContent = pl.level;
  $("#p-level").textContent = `Level ${pl.level} · ${pl.xp}/${pl.need} XP`; animateXp("#p-xp", (pl.xp / pl.need) * 100);
  $("#p-streak").textContent = `🔥 ${stats.streak}`;
  $("#p-streak-note").textContent = stats.lastDaily === today() ? "Today's daily is done" : "Play today's daily to keep it going";
  $("#p-record").textContent = `${pp.wins}W · ${pp.losses}L`;
  $("#p-recent").innerHTML = pp.recent.length ? pp.recent.map((r) => `<span class="${r}">${r}</span>`).join("") : "<small>No games yet</small>";
  $("#p-stats").textContent = `${pp.wins} wins · ${pp.losses} losses · ${pp.coins} coins`;
  $("#s-name").value = Player.data.username;
  $("#s-avatars").innerHTML = AVATARS.map((a) => `<button class="${a === Player.data.avatar ? "on" : ""}" data-av="${a}">${a}</button>`).join("");
  $("#s-theme").textContent = settings.theme === "dark" ? "🌙 Dark theme" : "☀️ Light theme";
  $("#s-sound").textContent = settings.mute ? "🔇 Sound off" : "🔊 Sound on";
  $("#s-motion").textContent = reduced() ? "🐢 Reduced motion: on" : "✨ Reduced motion: off";
}
function applySettings() { document.documentElement.dataset.theme = settings.theme; document.documentElement.dataset.motion = reduced() ? "reduced" : "full"; save("settings", settings); }

// ---------- Shop ----------  (the items come from SHOP_ITEMS in store.js)
function shopCard(it) {
  if (it.kind === "free") return `<article class="gcard free-box"><span class="mini-tile t-gift" aria-hidden="true"><i>🎁</i></span><h3>${it.name}</h3><p class="price">+${FREE_COINS.amount} 🪙</p><button class="primary" type="button" data-free-shop>Claim</button><small class="shop-next" data-free-next></small></article>`;
  return `<article class="gcard"><span class="mini-tile ${it.tile}" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false"><use href="#i-${it.icon}"/></svg></span><h3>${it.name}</h3><p class="price">${it.price} 🪙</p><button class="primary" type="button" data-buy="${it.id}">Buy</button></article>`;
}
function renderShop() {
  $("#shop-cards").innerHTML = SHOP_ITEMS.map(shopCard).join("");
  refreshCoins(); if (window.FreeCoins) window.FreeCoins.syncShop();
}
async function needCoins(cost) {
  const missing = cost - Player.data.coins;
  const pick = await dialog("Not enough coins", `You need ${missing} more coin${missing === 1 ? "" : "s"}. Win games to earn coins: ${REWARDS.practice.coins} for a solo win, ${REWARDS.daily.coins} for the daily challenge.`, ["Dashboard", "Earn coins"]);
  if (pick === 0) show("dashboard"); else openGame("practice", true);
}
async function buyItem(id) {                              // one purchase at a time; the price is checked again at the moment of payment
  if (spendLock) return; spendLock = true;
  try {
    const it = SHOP_ITEMS.find((i) => i.id === id); if (!it || it.kind === "free") return;
    if (Player.data.coins < it.price) return needCoins(it.price);
    if (!(await confirmSpend("Buy", `Buy 1 "${it.name}" for ${it.price} coins?`, it.price, it.icon))) return;
    if (!Player.spend(it.price)) return toast("Not enough coins", "error");
    if (it.kind === "hint") Player.addHintCredit(it.type); else if (it.kind === "skip") Player.addSkipCredit();
    sfx.coin(); toast(`Bought: ${it.name}`, "success"); renderShop(); updateHintButtons();   // updateHintButtons also refreshes every coin counter
  } finally { spendLock = false; }
}

// ---------- Board & keyboard ----------
function buildBoard() {
  const b = $("#board"); b.innerHTML = "";
  for (let r = 0; r < ROWS; r++) {
    const row = document.createElement("div"); row.className = "row";
    for (let c = 0; c < COLS; c++) { const t = document.createElement("div"); t.className = "tile"; t.style.setProperty("--i", c); row.append(t); }
    b.append(row);
  }
}
function buildKeyboard() {
  const kb = $("#keyboard"); kb.innerHTML = "";
  KEYS.forEach((line) => {
    const row = document.createElement("div"); row.className = "krow";
    [...line].forEach((k) => {
      const btn = document.createElement("button");
      btn.className = "key" + (k === "+" || k === "-" ? " wide" : "");
      btn.dataset.key = k === "+" ? "enter" : k === "-" ? "back" : k;
      btn.textContent = k === "+" ? "ENTER" : k === "-" ? "⌫" : k;
      if (k === "+") btn.setAttribute("aria-label", "Enter"); if (k === "-") btn.setAttribute("aria-label", "Backspace");
      btn.onclick = () => { press(btn.dataset.key); btn.blur(); }; // blur: a focused key must not re-fire on physical Enter
      row.append(btn);
    });
    kb.append(row);
  });
}
const rowEl = (i) => $("#board").children[i];
function paintRow(i, word) {
  [...rowEl(i).children].forEach((t, c) => { t.textContent = word[c] || ""; t.classList.toggle("filled", !!word[c]); });
  markActive();
}
function colorKeys() {
  const rank = { absent: 1, present: 2, correct: 3 }, best = {};
  guesses.forEach((g) => evaluate(g, answer).forEach((s, i) => { if ((rank[s] || 0) > (rank[best[g[i]]] || 0)) best[g[i]] = s; }));
  $$(".key").forEach((k) => {
    k.classList.remove("correct", "present", "absent");
    if (best[k.dataset.key]) k.classList.add(best[k.dataset.key]);
    k.classList.toggle("disabled", hintState.disabled.includes(k.dataset.key));
    if (k.dataset.key.length === 1) k.setAttribute("aria-label", k.dataset.key + (best[k.dataset.key] ? ", " + { correct: "correct position", present: "in the word, wrong position", absent: "not in the word" }[best[k.dataset.key]] : ""));
  });
}
function renderHintTiles() { // faint letters show revealed hints in every unused row
  for (let r = 0; r < ROWS; r++) [...rowEl(r).children].forEach((t, c) => {
    const letter = hintState.reveals[c];
    if (letter && r >= guesses.length) t.dataset.hint = letter; else delete t.dataset.hint;
  });
}
function reveal(i, word, animate, done) {
  const res = evaluate(word, answer);
  [...rowEl(i).children].forEach((t, c) => {
    const apply = () => { t.classList.add(res[c]); t.setAttribute("aria-label", `${word[c]}, ${{ correct: "correct position", present: "in the word, wrong position", absent: "not in the word" }[res[c]]}`); };
    if (!animate) { t.textContent = word[c]; apply(); return; }
    setTimeout(() => { t.classList.add("flip"); sfx.flip(c); setTimeout(apply, 275); }, c * 280);
  });
  if (animate) setTimeout(done, COLS * 280 + 300); else done && done();
}
function markActive() { // highlights the row the player is typing in
  for (let r = 0; r < ROWS; r++) rowEl(r).classList.toggle("active", status === "playing" && !busy && r === guesses.length);
  $("#btn-submit").disabled = status !== "playing" || busy; // no double submits, none after the game ends
  $$(".tile.cursor").forEach((t) => t.classList.remove("cursor")); // gold cursor on the tile being typed
  if (status === "playing" && !busy && guesses.length < ROWS && current.length < COLS) rowEl(guesses.length).children[current.length].classList.add("cursor");
}
function updateAttempts() {
  const left = ROWS - guesses.length;
  $("#attempts").textContent = status === "playing" ? `${left} ${left === 1 ? "attempt" : "attempts"} left`
    : status === "won" ? `Solved in ${guesses.length}/${ROWS}` : `The word was ${answer.toUpperCase()}`;
  markActive();
}

// ---------- Hints in a game ----------
const ICONS = { reveal: "reveal", remove: "remove", word: "bulb", skip: "skip" }; // artwork symbols in the index.html sprite
// Top-right badge = uses left without paying coins; the small caption under the icon says what the next use costs.
function setCount(b, n) {
  const c = b.querySelector(".cnt"); if (!c) return;
  const changed = c.textContent !== String(n) && c.textContent !== "";
  c.textContent = n; c.classList.toggle("zero", n === 0);
  if (changed && !reduced()) { c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump"); }
}
function updateHintButtons() {
  $$(".hint").forEach((b) => {
    const t = b.dataset.hint, n = Player.data.hints[t], left = n.free + n.credits;
    b.querySelector("small").textContent = left > 0 ? "" : `🪙 ${HINTS[t].cost}`; setCount(b, left); // price pill shows only when no free uses are left
    const say = left > 0 ? `${left} free use${left === 1 ? "" : "s"} left` : `costs ${HINTS[t].cost} coins`;
    b.setAttribute("aria-label", `${HINTS[t].name}, ${say}`); b.title = `${HINTS[t].name} (${say})`;
    b.classList.toggle("paid", left <= 0);
    b.disabled = status !== "playing";
  });
  updateSkipButton(); refreshCoins();
}
function planReveal() {
  const solved = new Set();
  guesses.forEach((g) => [...g].forEach((ch, i) => { if (ch === answer[i]) solved.add(i); }));
  const open = [0, 1, 2, 3, 4].filter((i) => !solved.has(i) && !(i in hintState.reveals));
  if (!open.length) return null;
  const pos = open[Math.floor(Math.random() * open.length)];
  return { pos, letter: answer[pos] };
}
function planRemove() {
  const guessed = new Set(guesses.join(""));
  const pool = [..."abcdefghijklmnopqrstuvwxyz"].filter((l) => !answer.includes(l) && !guessed.has(l) && !hintState.disabled.includes(l));
  if (!pool.length) return null;
  return pool.sort(() => Math.random() - 0.5).slice(0, 5);
}
// ---------- Skip word ----------
function submitMsg(text) { // inline message next to the Submit button
  const el = $("#submit-msg"); clearTimeout(submitMsg.t); el.textContent = text ? "⚠ " + text : "";
  if (text) submitMsg.t = setTimeout(() => (el.textContent = ""), 3000);
}
const skipsLeft = () => Player.data.skips.free + (Player.data.skips.credits || 0);
function updateSkipButton() {
  const b = $("#btn-skip"), s = skipsLeft(), off = mode === "daily" || status !== "playing";
  const label = s > 0 ? "" : `🪙 ${SKIP.cost}`, say = s > 0 ? `${s} free skip${s === 1 ? "" : "s"} left` : `costs ${SKIP.cost} coins`;
  b.querySelector("small").textContent = label; setCount(b, s); b.setAttribute("aria-label", `Skip word, ${say}`); b.title = `Skip word (${say})`;
  b.classList.toggle("paid", s <= 0); b.classList.toggle("off", off); b.setAttribute("aria-disabled", off ? "true" : "false");
}
async function skipWord() {
  if (spendLock || busy) return;                      // one purchase at a time: no duplicate charges
  if (mode === "daily") return submitMsg("Skip isn't available in the Daily Challenge");
  if (status !== "playing") return;
  spendLock = true;
  try {
    const free = skipsLeft() > 0, gid = gameId;
    if (free) {
      if (!(await confirmBox("Skip this word?", `You have ${skipsLeft()} skip${skipsLeft() === 1 ? "" : "s"} left. This word is replaced with a new one. No reward, no penalty.`, "Skip"))) return;
    } else {
      if (Player.data.coins < SKIP.cost) return needCoins(SKIP.cost);
      if (!(await confirmSpend("Skip this word", `Use ${SKIP.cost} coins to skip this word?`, SKIP.cost, ICONS.skip))) return;
    }
    if (status !== "playing" || gameId !== gid || mode !== "practice") return; // the game changed while the dialog was open
    if (free) { if (!Player.consumeSkip()) return; } else if (!Player.spend(SKIP.cost)) return;
    startGame(true); sfx.coin();
    const left = skipsLeft(); toast(free ? `Word skipped. ${left} skip${left === 1 ? "" : "s"} left.` : `Word skipped for ${SKIP.cost} coins.`, "success");
  } finally { spendLock = false; }
}
$("#btn-skip").onclick = skipWord;
$("#btn-submit").onclick = () => { if (screen === "game" && status === "playing" && !busy) submit(); };
$("#g-info").onclick = () => Tutorial.openInfo();

async function useHint(type) {
  if (status !== "playing" || busy || spendLock) return;
  if (type === "word") return useWordHint();
  spendLock = true;
  try {
    const plan = type === "reveal" ? planReveal() : planRemove();
    if (!plan) return toast("No useful hint available. No coins spent.", "error");
    const h = Player.data.hints[type], cost = HINTS[type].cost, gid = gameId;
    if (h.free <= 0 && h.credits <= 0) {
      if (Player.data.coins < cost) return needCoins(cost);
      if (!(await confirmSpend("Use a hint", `Use ${cost} coins to ${HINTS[type].verb}?`, cost, ICONS[type]))) return;
      if (status !== "playing" || gameId !== gid) return; // game may have changed while the dialog was open
      if (!Player.spend(cost)) return toast("Not enough coins", "error");
    } else Player.consumeHint(type);
    if (type === "reveal") { hintState.reveals[plan.pos] = plan.letter; toast(`Letter ${plan.pos + 1} is ${plan.letter.toUpperCase()}`, "success"); }
    else { hintState.disabled.push(...plan); toast(`${plan.length} wrong letters removed`, "success"); }
    sfx.coin(); flash($(`[data-hint=${type}]`)); renderHintTiles(); colorKeys(); updateHintButtons(); saveProgress();
  } finally { spendLock = false; }
}

// ---------- Word Hint (lightbulb): one clue about the secret word, never the word itself ----------
const CLUE_LABELS = { meaning: ["📖", "Meaning"], related: ["🔗", "Related words"], category: ["🏷️", "Category"], usage: ["💬", "In context"], fact: ["✨", "Fun fact"] };
function clueDeck() { // three clues per word (js/clues.js); a safe fallback keeps the game working if a word has no entry
  const d = window.CLUES && window.CLUES[answer];
  if (Array.isArray(d) && d.length) return d;
  const v = [...answer].filter((c) => "aeiou".includes(c)).length;
  return [["fact", `It has ${v} vowel${v === 1 ? "" : "s"} and ${new Set(answer).size} different letters.`]];
}
function planClue() { // a random clue that has not been shown yet in this game, or null when all were used
  const left = clueDeck().map((_, i) => i).filter((i) => !hintState.clues.includes(i));
  return left.length ? left[Math.floor(Math.random() * left.length)] : null;
}
async function useWordHint() {
  spendLock = true;
  try {
    const gid = gameId, h = Player.data.hints.word, cost = HINTS.word.cost;
    if (planClue() === null) { showClue(false); return; }                 // every clue already seen: reopen them, no charge
    if (h.free <= 0 && h.credits <= 0) {
      if (Player.data.coins < cost) return needCoins(cost);
      if (!(await confirmSpend("Use a word hint", `Use ${cost} coins to get a clue about the word?`, cost, ICONS.word))) return;
      if (status !== "playing" || gameId !== gid) return;
    }
    const idx = planClue(); if (idx === null) { showClue(false); return; } // re-picked after the dialog; nothing left means nothing charged
    if (h.free > 0 || h.credits > 0) Player.consumeHint("word"); else if (!Player.spend(cost)) return toast("Not enough coins", "error");
    hintState.clues.push(idx); saveProgress();                              // the clue is saved together with the payment
    sfx.coin(); flash($("[data-hint=word]")); updateHintButtons(); showClue(true);
  } finally { spendLock = false; }
}
function clueRow(c) { const [e, l] = CLUE_LABELS[c[0]] || CLUE_LABELS.fact; return `<div class="clue-kind"><span aria-hidden="true">${e}</span>${l}</div><p class="clue-text"></p>`; }
function showClue(isNew) {
  const deck = clueDeck(), seen = hintState.clues.filter((i) => deck[i]);
  if (!seen.length) return;
  const last = seen[seen.length - 1], total = deck.length;
  $("#clue-count").textContent = isNew ? `Clue ${seen.length} of ${total}` : `All ${total} clues revealed. No more to give for this word.`;
  const main = $("#clue-main"); main.innerHTML = clueRow(deck[last]); main.querySelector(".clue-text").textContent = deck[last][1];
  main.classList.remove("in"); void main.offsetWidth; main.classList.add("in");
  const prev = $("#clue-prev"); prev.innerHTML = "";
  seen.slice(0, -1).reverse().forEach((i) => { const d = document.createElement("div"); d.className = "clue-old"; d.innerHTML = clueRow(deck[i]); d.querySelector(".clue-text").textContent = deck[i][1]; prev.append(d); });
  prev.classList.toggle("hidden", seen.length < 2);
  $("#clue").classList.remove("hidden"); lockModal(true); $("#clue-close").focus();
}
function closeClue() { $("#clue").classList.add("hidden"); lockModal(false); const b = $("[data-hint=word]"); if (b && !b.disabled) b.focus({ preventScroll: true }); }
$("#clue-close").onclick = closeClue; $("#clue-x").onclick = closeClue;
$("#clue").addEventListener("click", (e) => { if (e.target.id === "clue") closeClue(); });

// ---------- Game flow ----------
function saveProgress() { save("game_" + mode, { date: today(), id: gameId, answer, guesses, status, hintState }); }

function openGame(m, forceNew = false) {
  if (m === "daily") { const done = dailyRecord(); if (done) return showDailyDone(done); } // already completed today: show the result, never replay
  mode = m; show("game"); startGame(forceNew);
}

// ---------- Daily Challenge: already completed today ----------
// Completion comes from the saved daily game (for today's local date), the once-only reward records, and the synced daily stats,
// so it also works on a second device where the guesses themselves were not saved.
function dailyRecord() {
  const t = today(), saved = load("game_daily", null), ids = Player.data.rewarded;
  const rec = saved && saved.date === t && saved.status !== "playing" ? saved : null;
  const wonId = ids.includes("W:daily-" + t), lostId = ids.includes("L:daily-" + t);
  if (!rec && !wonId && !lostId && stats.lastDaily !== t) return null; // not completed: Play works as usual
  const won = rec ? rec.status === "won" : wonId ? true : lostId ? false : null;
  const guessList = rec ? rec.guesses : null;
  const reward = rec && rec.reward ? rec.reward : won ? REWARDS.daily : { coins: 0, xp: 0 };
  return { won, guesses: guessList, answer: rec ? rec.answer : dailyWord(), reward, score: won ? (guessList ? (ROWS - guessList.length + 1) * 100 : null) : 0 };
}
let ddTimer = null;
function closeDailyDone() { clearInterval(ddTimer); $("#daily-done").classList.add("hidden"); lockModal(false); if (screen === "dashboard") renderDashboard(); }
function showDailyDone(r) {
  const m = $("#daily-done"); m.classList.toggle("win", r.won === true); m.classList.toggle("loss", r.won === false);
  $("#dd-emoji").textContent = r.won === false ? "💪" : "🏆";
  $("#dd-date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  $("#dd-status").textContent = r.won === true ? "✓ Solved" : r.won === false ? "✗ Not solved this time" : "Completed";
  const grid = $("#dd-grid"); grid.innerHTML = "";
  const row = document.createElement("div"); row.className = "row"; // only the final row (the answer), not every guess
  [...r.answer].forEach((ch, i) => { const t = document.createElement("div"); t.className = "tile " + (r.won ? "correct" : "absent"); t.textContent = ch; t.style.setProperty("--i", i); row.append(t); });
  grid.append(row); grid.style.display = "";
  $("#dd-word").textContent = `The word was ${r.answer.toUpperCase()}`;
  const dm = meaningOf(r.answer); $("#dd-meaning").textContent = dm; $("#dd-meaning").style.display = dm ? "" : "none";
  $("#dd-attempts").textContent = r.guesses ? (r.won ? `${r.guesses.length}/${ROWS}` : `${ROWS}/${ROWS}`) : "—";
  $("#dd-score").textContent = r.score === null ? "—" : r.score;
  $("#dd-coins").textContent = "+" + r.reward.coins; $("#dd-xp").textContent = "+" + r.reward.xp;
  const rate = stats.played ? Math.round((stats.wins / stats.played) * 100) + "%" : "—";
  $("#dd-stats").innerHTML = [[stats.streak, "Daily streak"], [stats.best, "Best streak"], [stats.played, "Played"], [rate, "Win rate"]].map(([v, l]) => `<div><b>${v}</b><small>${l}</small></div>`).join("");
  const tick = () => {
    const n = new Date(), ms = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1) - n;
    if (ms <= 0) { clearInterval(ddTimer); $("#dd-next").textContent = "A new word is ready!"; return; }
    const p = (x) => String(Math.floor(x)).padStart(2, "0");
    $("#dd-next").textContent = `Next word in ${p(ms / 36e5)}:${p((ms % 36e5) / 6e4)}:${p((ms % 6e4) / 1e3)}`;
  };
  clearInterval(ddTimer); tick(); ddTimer = setInterval(tick, 1000);
  m.classList.remove("hidden"); lockModal(true); $("#dd-ok").focus();
}
function startGame(newPractice = false) {
  buildBoard(); current = ""; busy = false;
  const saved = load("game_" + mode, null);
  if (mode === "daily") {
    answer = dailyWord(); gameId = "daily-" + today();
    if (saved && saved.date === today()) { guesses = saved.guesses; status = saved.status; hintState = loadHint(saved.hintState); }
    else { guesses = []; status = "playing"; hintState = newHint(); }
  } else if (!newPractice && saved && saved.status === "playing" && saved.guesses.length < ROWS) {
    ({ answer, id: gameId, guesses } = saved); status = "playing"; hintState = loadHint(saved.hintState);
    gameId = gameId || "p-" + Date.now();
  } else { answer = randomWord(); gameId = "p-" + Date.now() + Math.random().toString(36).slice(2, 6); guesses = []; status = "playing"; hintState = newHint(); }
  $("#g-title").textContent = mode === "daily" ? "Daily Challenge" : "Solo Practice";
  guesses.forEach((g, i) => reveal(i, g, false));
  colorKeys(); renderHintTiles(); updateAttempts(); updateHintButtons(); saveProgress();
  if (status !== "playing") setTimeout(showResult, 300);
}

function press(k) {
  if (screen !== "game" || status !== "playing" || busy) return;
  if (k === "enter") return submit();
  if (k === "back") { current = current.slice(0, -1); sfx.key(); submitMsg(""); }
  else if (/^[a-z]$/.test(k) && current.length < COLS && !hintState.disabled.includes(k)) { current += k; sfx.key(); submitMsg(""); }
  paintRow(guesses.length, current);
}

function submit() {
  const row = guesses.length;
  const bad = (msg) => { submitMsg(msg); sfx.bad(); rowEl(row).classList.add("shake", "invalid"); setTimeout(() => rowEl(row).classList.remove("shake", "invalid"), 450); };
  if (current.length < COLS) return bad("Not enough letters");
  if (!VALID.has(current)) return bad("Not a word!");
  if (guesses.includes(current)) return bad("Already guessed");
  submitMsg("");
  const word = current; current = ""; busy = true; guesses.push(word); markActive();
  reveal(row, word, true, () => {
    busy = false;
    if (word === answer) { status = "won"; rowEl(row).classList.add("win"); sfx.win(); }
    else if (guesses.length === ROWS) { status = "lost"; sfx.lose(); }
    colorKeys(); renderHintTiles(); updateAttempts(); updateHintButtons(); saveProgress();
    if (status !== "playing") { finishGame(); setTimeout(showResult, 900); }
  });
}

let lastReward = null;
function finishGame() { // each game id can only pay out once (see Player.reward)
  lastReward = null;
  if (status === "won") { lastReward = Player.reward(gameId, mode, guesses.length); }
  else Player.recordLoss(gameId);
  if (mode === "daily") { const g = load("game_daily", null); if (g && g.date === today()) { g.reward = lastReward ? { coins: lastReward.coins, xp: lastReward.xp } : { coins: 0, xp: 0 }; save("game_daily", g); } } // remember what this game earned
  if (mode === "daily" && stats.lastDaily !== today()) {
    const y = new Date(); y.setDate(y.getDate() - 1); const yesterday = isoLocal(y);
    stats.played++;
    if (status === "won") { stats.wins++; stats.streak = stats.lastDaily === yesterday ? stats.streak + 1 : 1; stats.best = Math.max(stats.best, stats.streak); stats.dist[guesses.length - 1]++; }
    else stats.streak = 0;
    stats.lastDaily = today(); save("stats", stats);
  }
  refreshCoins();
}

// ---------- Results & stats modal ----------
function lockModal(open) { document.body.classList.toggle("modal-open", open); }
function closeModal() { $("#modal").classList.add("hidden"); lockModal(false); }
function countUp(el, to, prefix) { // short count-up so rewards are easy to notice
  if (reduced() || to === 0) { el.textContent = prefix + to; return; }
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / 800); el.textContent = prefix + Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function meaningOf(w) { // first clue of each word is its short meaning (js/clues.js)
  const c = window.CLUES && window.CLUES[w], m = c && c[0] && c[0][0] === "meaning" ? c[0][1] : "";
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : "";
}
function showResult() {
  const won = status === "won", r = lastReward, n = guesses.length;
  const m = $("#modal"); m.classList.toggle("win", won); m.classList.toggle("loss", !won);
  $("#r-emoji").textContent = won ? "🏆" : "💪";
  $("#modal-title").textContent = won ? "You got it!" : "Nice try!";
  $("#modal-msg").textContent = won ? `Solved in ${n} ${n === 1 ? "guess" : "guesses"}` : "The word was";
  $("#r-word").innerHTML = [...answer].map((c, i) => `<span style="--i:${i}">${c}</span>`).join("");
  const mean = meaningOf(answer); $("#r-meaning").textContent = mean; $("#r-meaning").style.display = mean ? "" : "none"; // short meaning under the word
  $("#r-rewards").style.display = won && r ? "" : "none";
  $("#r-note").textContent = won ? (r ? (r.levelUp ? "⬆ Level up!" : "") : "Reward for this game was already collected.") : "No reward this time. Try again to earn coins and XP.";
  if (won && r) {
    const lv = Player.levelInfo();
    countUp($("#r-coins"), r.coins, "+"); countUp($("#r-xpv"), r.xp, "+");
    $("#r-balance").textContent = `Balance: ${Player.data.coins} 🪙`; // the real balance after this win was added
    $("#r-level").textContent = `Level ${lv.level} · ${lv.xp}/${lv.need} XP`; animateXp("#r-xp", (lv.xp / lv.need) * 100);
    confetti(); setTimeout(sfx.coin, 400);
  }
  renderStats(won ? n : 0);
  $("#r-daily").textContent = stats.played ? `Daily challenges completed: ${stats.played} · Daily streak: ${stats.streak}` : "";
  $("#btn-again").textContent = mode === "daily" ? "Play solo" : won ? "Play again" : "Try again";
  m.classList.remove("hidden"); lockModal(true); $("#btn-again").focus();
}
function renderStats(hi) { // lifetime stats for every game (solo + daily)
  const p = Player.data, played = p.wins + p.losses;
  const rate = played ? Math.round((p.wins / played) * 100) + "%" : "—";
  $("#stats-grid").innerHTML = [[played, "Played"], [rate, "Win rate"], [p.streak, "Win streak"], [p.bestGuesses ? p.bestGuesses + "/6" : "—", "Best win"]]
    .map(([v, l]) => `<div><b>${v}</b><small>${l}</small></div>`).join("");
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch {}
  try { const a = document.createElement("textarea"); a.value = t; a.style.cssText = "position:fixed;opacity:0"; document.body.append(a); a.select(); const ok = document.execCommand("copy"); a.remove(); return ok; } catch { return false; }
}
function shareText() {
  const icon = { correct: "🟩", present: "🟨", absent: "⬛" };
  return `Wordle Battle ${mode === "daily" ? today() : "practice"} ${status === "won" ? guesses.length : "X"}/${ROWS}\n` + guesses.map((g) => evaluate(g, answer).map((s) => icon[s]).join("")).join("\n");
}

// ---------- Events ----------
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-go],[data-buy],[data-back],[data-av],[data-hint]");
  if (!t) return;
  if (t.dataset.go) go(t.dataset.go);
  else if (t.dataset.buy) buyItem(t.dataset.buy);
  else if (t.dataset.back !== undefined) show("dashboard"); // every Back button returns to the dashboard
  else if (t.dataset.av) { Player.data.avatar = t.dataset.av; Player.save(); if (window.Auth && Auth.isAccount()) Auth.setAvatar(t.dataset.av); renderSettings(); }
  else if (t.dataset.hint) useHint(t.dataset.hint);
});
$("#go-settings").onclick = () => show("settings");
$$("#bottomnav [data-nav]").forEach((b) => (b.onclick = () => (b.dataset.nav === "play" ? openGame("practice") : show(b.dataset.nav))));
$("#g-back").onclick = async () => {
  if (status === "playing" && guesses.length > 0 && !(await confirmBox("Leave this game?", "Your progress is saved, so you can continue later.", "Leave"))) return;
  show("dashboard");
};
$("#s-name").onchange = (e) => {
  if (window.Auth && Auth.isAccount()) return Auth.setUsername(e.target.value.trim());
  Player.data.username = e.target.value.trim().slice(0, 16) || Player.data.username; Player.save(); toast("Username saved", "success");
};
$("#s-theme").onclick = () => { settings.theme = settings.theme === "dark" ? "light" : "dark"; applySettings(); renderSettings(); };
$("#s-motion").onclick = () => { settings.reduceMotion = !settings.reduceMotion; applySettings(); renderSettings(); };
$("#s-sound").onclick = () => { settings.mute = !settings.mute; applySettings(); renderSettings(); };
$("#s-reset").onclick = async () => {
  if (await confirmBox("Reset everything?", "This deletes your coins, hints, stats and streaks. It can't be undone.", "Reset")) {
    Object.keys(localStorage).filter((k) => k.startsWith("wb_")).forEach((k) => localStorage.removeItem(k)); location.reload();
  }
};
$("#modal-close").onclick = closeModal;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#clue").classList.contains("hidden")) closeClue(); if (e.key === "Escape" && !$("#modal").classList.contains("hidden")) closeModal(); if (e.key === "Escape" && !$("#daily-done").classList.contains("hidden")) closeDailyDone(); });
$("#dd-ok").onclick = closeDailyDone;
$("#btn-home").onclick = () => { closeModal(); show("dashboard"); };
$("#btn-shop").onclick = () => { closeModal(); go("shop"); };
$("#btn-again").onclick = () => { closeModal(); openGame("practice", true); };
$("#btn-share").onclick = async () => ((await copyText(shareText())) ? toast("Result copied to clipboard", "success") : toast("Couldn't copy result", "error"));
document.addEventListener("keydown", (e) => {
  if (e.target.closest && e.target.closest("input,textarea,select")) return; // typing in a form: leave Enter/letters alone
  if (e.ctrlKey || e.metaKey || e.altKey || !$("#modal").classList.contains("hidden") || !$("#dialog").classList.contains("hidden") || !$("#tutorial").classList.contains("hidden") || !$("#daily-done").classList.contains("hidden") || !$("#info").classList.contains("hidden") || !$("#clue").classList.contains("hidden") || !$("#free").classList.contains("hidden")) return;
  const k = e.key.toLowerCase();
  if (k === "enter") { e.preventDefault(); if (e.repeat) return; } // stops a focused button from also firing
  if (k === "enter") press("enter"); else if (k === "backspace") press("back"); else if (/^[a-z]$/.test(k)) press(k);
});

// Browser Back / Forward between sign-in screens (never lands on the dashboard unless that is where the player was)
addEventListener("popstate", (e) => {
  const name = (e.state && e.state.screen) || location.hash.replace(/^#/, "");
  if (!name || !document.getElementById(name) || !document.getElementById(name).classList.contains("screen") || name === "game") return;
  if (HIST_SCREENS.includes(name) && window.Auth && Auth.isAccount && Auth.isAccount()) return show("dashboard", true); // signed in: no sign-in screens
  show(name, true);
});

// ---------- Start ----------
applySettings(); buildKeyboard(); buildBoard(); refreshCoins();
window.WBApp = { show, applyStats: (o) => { Object.assign(stats, o); save("stats", stats, true); }, getStats: () => stats, refresh: () => { refreshCoins(); if (screen === "dashboard") renderDashboard(); } };
const splashMs = sessionStorage.getItem("wb_fast") ? 250 : 1600; sessionStorage.removeItem("wb_fast"); // shorter splash right after sign-in/out
setTimeout(async () => { $("#splash").classList.add("out"); if (window.Auth) await Auth.route(); else show("dashboard"); }, splashMs);
if (window.DEMO_MODE) console.info("Wordle Battle: local demo mode. Online battles need Supabase.");