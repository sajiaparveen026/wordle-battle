// Wordle Battle — solo game + dashboard, coins and hints. Data lives in localStorage (demo mode).
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const ROWS = 6, COLS = 5;
const KEYS = ["qwertyuiop", "asdfghjkl", "+zxcvbnm-"]; // + = Enter, - = Backspace
const AVATARS = ["🦊", "🐼", "🐯", "🦉", "🐙", "🚀"];

// ---------- Storage ----------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem("wb_" + k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem("wb_" + k, JSON.stringify(v));
let settings = load("settings", { theme: "dark", mute: false });
if (settings.reduceMotion === undefined) settings.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const reduced = () => !!settings.reduceMotion;
let stats = load("stats", { played: 0, wins: 0, streak: 0, best: 0, dist: [0, 0, 0, 0, 0, 0], lastDaily: "" });

// ---------- Game state ----------
let mode = "practice", answer = "", gameId = "", guesses = [], current = "", status = "playing", busy = false;
let hintState = { reveals: {}, disabled: [] };
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
function dialog(title, msg, buttons) {
  return new Promise((resolve) => {
    $("#dlg-title").textContent = title; $("#dlg-msg").textContent = msg;
    const box = $("#dlg-actions"); box.innerHTML = "";
    buttons.forEach((label, i) => {
      const b = document.createElement("button");
      b.className = "primary" + (i === 0 && buttons.length > 1 ? " alt" : ""); b.textContent = label;
      b.onclick = () => { $("#dialog").classList.add("hidden"); resolve(i); };
      box.append(b);
    });
    $("#dialog").classList.remove("hidden");
  });
}
const confirmBox = async (title, msg, ok = "Yes") => (await dialog(title, msg, ["Cancel", ok])) === 1;
function confetti() {
  if (reduced()) return;
  const colors = ["#39ff88", "#a65bff", "#f2c230", "#ffffff"];
  for (let i = 0; i < 50; i++) {
    const c = document.createElement("i"); c.className = "confetti";
    c.style.left = Math.random() * 100 + "vw"; c.style.background = colors[i % 4];
    c.style.animationDuration = 1.8 + Math.random() * 1.6 + "s"; c.style.animationDelay = Math.random() * 0.5 + "s";
    document.body.append(c); setTimeout(() => c.remove(), 4200);
  }
}

// ---------- Screens ----------
let screen = "dashboard", prevScreen = "dashboard";
function show(name) {
  if (name !== screen) prevScreen = screen;
  screen = name;
  $$(".screen").forEach((s) => s.classList.toggle("hidden", s.id !== name));
  const el = $("#" + name); el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter");
  $("#bottomnav").classList.toggle("hidden", name === "game");
  const navMap = { game: "play", battle: "play" };
  $$("#bottomnav [data-nav]").forEach((b) => b.classList.toggle("on", b.dataset.nav === (navMap[name] || name)));
  if (name === "leaderboard") renderLeaderboard();
  if (name === "dashboard") renderDashboard();
  if (name === "shop") renderShop();
  if (name === "settings") renderSettings();
  window.scrollTo(0, 0);
}
function go(target) {
  if (target === "practice" || target === "daily") return openGame(target);
  show(target);
}
function refreshCoins() {
  $$(".coin-val").forEach((e) => (e.textContent = Player.data.coins));
  $$(".streak-val").forEach((e) => (e.textContent = stats.streak));
}

// ---------- Dashboard ----------
function renderDashboard() {
  const p = Player.data, lv = Player.levelInfo();
  $("#d-avatar").textContent = p.avatar; $("#d-name").textContent = p.username;
  $("#d-level").textContent = `Level ${lv.level} · ${lv.xp}/${lv.need} XP`;
  $("#d-badge").textContent = lv.level; animateXp("#d-xp", (lv.xp / lv.need) * 100);
  const done = stats.lastDaily === today();
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

// ---------- Hint shop ----------
function renderShop() {
  $("#shop-cards").innerHTML = Object.entries(HINTS).map(([t, h]) => {
    const n = Player.data.hints[t];
    return `<article class="gcard"><div class="ico">${h.icon}</div><div><h3>${h.name}</h3><p>${h.desc}</p><p><b>${h.cost} 🪙 per use</b> · You have ${n.free + n.credits}</p></div><button class="primary" data-buy="${t}">Buy</button></article>`;
  }).join("");
  refreshCoins();
}
async function needCoins(cost) {
  const missing = cost - Player.data.coins;
  const pick = await dialog("Not enough coins", `You need ${missing} more coin${missing === 1 ? "" : "s"}. Win games to earn coins: 20 for a solo win, 50 for the daily challenge.`, ["Dashboard", "Earn coins"]);
  if (pick === 0) show("dashboard"); else openGame("practice", true);
}
async function buyHint(type) {
  const h = HINTS[type];
  if (Player.data.coins < h.cost) return needCoins(h.cost);
  if (!(await confirmBox("Buy hint", `Buy 1 "${h.name}" for ${h.cost} coins?`, "Buy"))) return;
  if (!Player.spend(h.cost)) return;
  Player.addHintCredit(type); sfx.coin();
  toast(`Bought: ${h.name}`, "success"); renderShop(); updateHintButtons();
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
}
function colorKeys() {
  const rank = { absent: 1, present: 2, correct: 3 }, best = {};
  guesses.forEach((g) => evaluate(g, answer).forEach((s, i) => { if ((rank[s] || 0) > (rank[best[g[i]]] || 0)) best[g[i]] = s; }));
  $$(".key").forEach((k) => {
    k.classList.remove("correct", "present", "absent");
    if (best[k.dataset.key]) k.classList.add(best[k.dataset.key]);
    k.classList.toggle("disabled", hintState.disabled.includes(k.dataset.key));
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
    const apply = () => t.classList.add(res[c]);
    if (!animate) { t.textContent = word[c]; apply(); return; }
    setTimeout(() => { t.classList.add("flip"); sfx.flip(c); setTimeout(apply, 275); }, c * 280);
  });
  if (animate) setTimeout(done, COLS * 280 + 300); else done && done();
}
function markActive() { // highlights the row the player is typing in
  for (let r = 0; r < ROWS; r++) rowEl(r).classList.toggle("active", status === "playing" && !busy && r === guesses.length);
}
function updateAttempts() {
  const left = ROWS - guesses.length;
  $("#attempts").textContent = status === "playing" ? `${left} ${left === 1 ? "attempt" : "attempts"} left`
    : status === "won" ? `Solved in ${guesses.length}/${ROWS}` : `The word was ${answer.toUpperCase()}`;
  markActive();
}

// ---------- Hints in a game ----------
function updateHintButtons() {
  $$(".hint").forEach((b) => {
    const t = b.dataset.hint, n = Player.data.hints[t];
    b.querySelector("small").textContent = n.free > 0 ? `${n.free} free left` : n.credits > 0 ? `${n.credits} owned` : `${HINTS[t].cost} 🪙`;
    b.classList.toggle("paid", n.free <= 0 && n.credits <= 0);
    b.disabled = status !== "playing";
  });
  refreshCoins();
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
async function useHint(type) {
  if (status !== "playing" || busy) return;
  const plan = type === "reveal" ? planReveal() : planRemove();
  if (!plan) return toast("No useful hint available. No coins spent.", "error");
  const h = Player.data.hints[type], cost = HINTS[type].cost;
  if (h.free <= 0 && h.credits <= 0) {
    if (Player.data.coins < cost) return needCoins(cost);
    if (!(await confirmBox("Use a hint", `Use ${cost} coins to ${HINTS[type].verb}?`, "Use"))) return;
    if (status !== "playing") return; // game may have ended while the dialog was open
    if (!Player.spend(cost)) return;
  } else Player.consumeHint(type);
  if (type === "reveal") { hintState.reveals[plan.pos] = plan.letter; toast(`Letter ${plan.pos + 1} is ${plan.letter.toUpperCase()}`, "success"); }
  else { hintState.disabled.push(...plan); toast(`${plan.length} wrong letters removed`, "success"); }
  sfx.coin(); renderHintTiles(); colorKeys(); updateHintButtons(); saveProgress();
}

// ---------- Game flow ----------
function saveProgress() { save("game_" + mode, { date: today(), id: gameId, answer, guesses, status, hintState }); }

function openGame(m, forceNew = false) {
  mode = m; show("game"); startGame(forceNew);
}
function startGame(newPractice = false) {
  buildBoard(); current = ""; busy = false;
  const saved = load("game_" + mode, null);
  if (mode === "daily") {
    answer = dailyWord(); gameId = "daily-" + today();
    if (saved && saved.date === today()) { guesses = saved.guesses; status = saved.status; hintState = saved.hintState || { reveals: {}, disabled: [] }; }
    else { guesses = []; status = "playing"; hintState = { reveals: {}, disabled: [] }; }
  } else if (!newPractice && saved && saved.status === "playing" && saved.guesses.length < ROWS) {
    ({ answer, id: gameId, guesses } = saved); status = "playing"; hintState = saved.hintState || { reveals: {}, disabled: [] };
    gameId = gameId || "p-" + Date.now();
  } else { answer = randomWord(); gameId = "p-" + Date.now() + Math.random().toString(36).slice(2, 6); guesses = []; status = "playing"; hintState = { reveals: {}, disabled: [] }; }
  $("#g-title").textContent = mode === "daily" ? "Daily Challenge" : "Solo Practice";
  guesses.forEach((g, i) => reveal(i, g, false));
  colorKeys(); renderHintTiles(); updateAttempts(); updateHintButtons(); saveProgress();
  if (status !== "playing") setTimeout(showResult, 300);
}

function press(k) {
  if (screen !== "game" || status !== "playing" || busy) return;
  if (k === "enter") return submit();
  if (k === "back") { current = current.slice(0, -1); sfx.key(); }
  else if (/^[a-z]$/.test(k) && current.length < COLS && !hintState.disabled.includes(k)) { current += k; sfx.key(); }
  paintRow(guesses.length, current);
}

function submit() {
  const row = guesses.length;
  const bad = (msg) => { toast(msg, "error"); sfx.bad(); rowEl(row).classList.add("shake", "invalid"); setTimeout(() => rowEl(row).classList.remove("shake", "invalid"), 450); };
  if (current.length < COLS) return bad("Not enough letters");
  if (!VALID.has(current)) return bad("Not in word list");
  if (guesses.includes(current)) return bad("Already guessed");
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
function showResult() {
  const won = status === "won", r = lastReward, n = guesses.length;
  const m = $("#modal"); m.classList.toggle("win", won); m.classList.toggle("loss", !won);
  $("#r-emoji").textContent = won ? "🏆" : "💪";
  $("#modal-title").textContent = won ? "You got it!" : "Nice try!";
  $("#modal-msg").textContent = won ? `Solved in ${n} ${n === 1 ? "guess" : "guesses"}` : "The word was";
  $("#r-word").innerHTML = [...answer].map((c, i) => `<span style="--i:${i}">${c}</span>`).join("");
  $("#r-rewards").style.display = won && r ? "" : "none";
  $("#r-note").textContent = won ? (r ? (r.levelUp ? "⬆ Level up!" : "") : "Reward for this game was already collected.") : "No reward this time. Try again to earn coins and XP.";
  if (won && r) {
    const lv = Player.levelInfo();
    countUp($("#r-coins"), r.coins, "+"); countUp($("#r-xpv"), r.xp, "+");
    $("#r-level").textContent = `Level ${lv.level} · ${lv.xp}/${lv.need} XP`; animateXp("#r-xp", (lv.xp / lv.need) * 100);
    confetti(); setTimeout(sfx.coin, 400);
  }
  renderStats(won ? n : 0);
  $("#r-daily").textContent = stats.played ? `Daily challenges completed: ${stats.played} · Daily streak: ${stats.streak}` : "";
  $("#btn-again").textContent = mode === "daily" ? "Play solo" : won ? "Play again" : "Try again";
  m.classList.remove("hidden"); lockModal(true); $("#btn-again").focus();
}
function renderStats(hi) { // lifetime stats for every game (solo + daily)
  const p = Player.data, played = p.wins + p.losses, total = p.dist.reduce((a, b) => a + b, 0);
  const rate = played ? Math.round((p.wins / played) * 100) + "%" : "—";
  $("#stats-grid").innerHTML = [[played, "Played"], [rate, "Win rate"], [p.streak, "Win streak"], [p.bestGuesses ? p.bestGuesses + "/6" : "—", "Best win"]]
    .map(([v, l]) => `<div><b>${v}</b><small>${l}</small></div>`).join("");
  const max = Math.max(1, ...p.dist);
  $("#dist").innerHTML = total ? "<h4 class=\"dh\">Guess distribution</h4>" + p.dist.map((n, i) =>
    `<div class="dist${i + 1 === hi ? " cur" : ""}"><span>${i + 1}</span><div class="bar${n ? "" : " zero"}" style="width:${n ? Math.max(12, (n / max) * 100) : 8}%">${n}</div></div>`).join("")
    : "<small class=\"note-line\">Win a game to start your guess distribution.</small>";
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
  else if (t.dataset.buy) buyHint(t.dataset.buy);
  else if (t.dataset.back !== undefined) show("dashboard"); // every Back button returns to the dashboard
  else if (t.dataset.av) { Player.data.avatar = t.dataset.av; Player.save(); renderSettings(); }
  else if (t.dataset.hint) useHint(t.dataset.hint);
});
$("#go-settings").onclick = () => show("settings");
$$("#bottomnav [data-nav]").forEach((b) => (b.onclick = () => (b.dataset.nav === "play" ? openGame("practice") : show(b.dataset.nav))));
$("#g-back").onclick = async () => {
  if (status === "playing" && guesses.length > 0 && !(await confirmBox("Leave this game?", "Your progress is saved, so you can continue later.", "Leave"))) return;
  show("dashboard");
};
$("#s-name").onchange = (e) => { Player.data.username = e.target.value.trim().slice(0, 16) || Player.data.username; Player.save(); toast("Username saved", "success"); };
$("#s-theme").onclick = () => { settings.theme = settings.theme === "dark" ? "light" : "dark"; applySettings(); renderSettings(); };
$("#s-motion").onclick = () => { settings.reduceMotion = !settings.reduceMotion; applySettings(); renderSettings(); };
$("#s-sound").onclick = () => { settings.mute = !settings.mute; applySettings(); renderSettings(); };
$("#s-reset").onclick = async () => {
  if (await confirmBox("Reset everything?", "This deletes your coins, hints, stats and streaks. It can't be undone.", "Reset")) {
    Object.keys(localStorage).filter((k) => k.startsWith("wb_")).forEach((k) => localStorage.removeItem(k)); location.reload();
  }
};
$("#modal-close").onclick = closeModal;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").classList.contains("hidden")) closeModal(); });
$("#btn-home").onclick = () => { closeModal(); show("dashboard"); };
$("#btn-again").onclick = () => { closeModal(); openGame("practice", true); };
$("#btn-share").onclick = async () => ((await copyText(shareText())) ? toast("Result copied to clipboard", "success") : toast("Couldn't copy result", "error"));
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || !$("#modal").classList.contains("hidden") || !$("#dialog").classList.contains("hidden")) return;
  const k = e.key.toLowerCase();
  if (k === "enter") { e.preventDefault(); if (e.repeat) return; } // stops a focused button from also firing
  if (k === "enter") press("enter"); else if (k === "backspace") press("back"); else if (/^[a-z]$/.test(k)) press(k);
});

// ---------- Start ----------
applySettings(); buildKeyboard(); buildBoard(); refreshCoins();
setTimeout(() => { $("#splash").classList.add("out"); show("dashboard"); }, 1600);
if (window.DEMO_MODE) console.info("Wordle Battle: local demo mode. Online battles need Supabase.");
