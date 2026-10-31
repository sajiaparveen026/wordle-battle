// Wordle Battle — solo game + dashboard, coins and clues. Data lives in localStorage (demo mode).
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
// Reduce Motion is ONLY what the player chose in Settings. The phone's own animation setting (Android battery saver / "remove animations")
// must not switch off the coin-fly effect, so it is no longer copied in. Older saves that copied it automatically (no motionUser flag) are cleared once.
if (!settings.motionUser) settings.reduceMotion = false;
if (settings.theme !== "light") settings.theme = "dark";   // only two themes exist
if (typeof settings.vibrate !== "boolean") settings.vibrate = true;   // Settings > Game Preferences
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
const longDate = (d = new Date()) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });   // 29 October 2026
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
// ---------- Vibration (Settings > Game Preferences). Not every device supports it (e.g. iPhone), so it is always optional. ----------
const canVibrate = () => typeof navigator.vibrate === "function";
function vibe(pattern) { if (!settings.vibrate || !canVibrate()) return; try { navigator.vibrate(pattern); } catch {} }
const sfx = {
  key: () => beep(520, 0.04), bad: () => { beep(150, 0.18, "square"); vibe(60); }, coin: () => { beep(880, 0.07); setTimeout(() => beep(1320, 0.1), 70); vibe(25); },
  flip: (i) => beep(400 + i * 60, 0.07),
  win: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.15), i * 110)); vibe([70, 50, 70, 50, 150]); },
  lose: () => { [300, 240, 180].forEach((f, i) => setTimeout(() => beep(f, 0.2, "triangle"), i * 150)); vibe(220); }
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
  if (window.FriendBattle) FriendBattle.screenChanged(name);   // js/friend-battle.js + js/battle-game.js: Friend Zone rooms and battles
  if (name === "dashboard") renderDashboard();
  if (name === "dashboard" && window.Tutorial) Tutorial.maybeAutoShow();
  if (window.Auth) Auth.renderAccount();
  if (name === "signup" && window.Auth && Auth.restoreSignupDraft) Auth.restoreSignupDraft(); // typed email / username come back (never passwords)
  if (name === "shop") renderShop();
  if (name === "profile") renderProfile();
  window.scrollTo(0, 0);
}
function openSettings() { if (window.Settings) window.Settings.open(); }
function go(target) {
  if (target === "settings") return openSettings();
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

// ---------- Small renderers ----------
function animateXp(sel, pct) { // bar fills from 0 each time it is shown
  const e = $(sel); e.style.width = "0%";
  requestAnimationFrame(() => requestAnimationFrame(() => (e.style.width = pct + "%")));
}
function renderLeaderboard() { if (window.Leaderboard) Leaderboard.render(); }   // js/leaderboard.js: real players from Supabase (guests and accounts)

// ---------- Profile (separate from Settings) ----------
const fmtDate = (iso, long) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString([], long ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", year: "numeric" }); };
let showAllGames = false;
function renderProfile() {
  const p = Player.data, lv = Player.levelInfo(), meta = (window.Auth && Auth.profileMeta && Auth.profileMeta()) || {};
  $("#pf-avatar").textContent = p.avatar; $("#pf-name").textContent = p.username; $("#pf-badge").textContent = lv.level;
  $("#pf-level").textContent = `Level ${lv.level}`;
  $("#pf-xptext").textContent = `${lv.xp.toLocaleString()} / ${lv.need.toLocaleString()} XP`; animateXp("#pf-xp", (lv.xp / lv.need) * 100);
  const joined = fmtDate(meta.joined || p.joinedAt);
  $("#pf-meta").textContent = [joined ? `${meta.id ? "Joined" : "Playing since"} ${joined}` : "", meta.id ? `ID: ${meta.id}` : ""].filter(Boolean).join(" · ");
  const played = p.wins + p.losses;                               // real numbers from this player's save
  $("#pf-played").textContent = played; $("#pf-won").textContent = p.wins;
  $("#pf-rate").textContent = played ? Math.round((p.wins / played) * 100) + "%" : "—"; $("#pf-wstreak").textContent = p.streak;
  const day = (n) => `${n} day${n === 1 ? "" : "s"}`;              // daily challenge numbers come from the daily stats
  $("#pf-dstreak").textContent = `🔥 ${day(stats.streak)}`;
  $("#pf-dbest").textContent = `Best streak: ${day(stats.best)}`; $("#pf-ddone").textContent = `Completed: ${stats.played}`;
  renderRecentGames();
  if (window.Achievements) Achievements.render();   // achievements carousel + counter
}
function renderRecentGames() {
  const all = [...Player.data.history].reverse(), list = showAllGames ? all : all.slice(0, 5), ul = $("#pf-games");   // newest first; only finished games are listed, so no answer is ever shown
  ul.innerHTML = "";
  if (!all.length) { const li = document.createElement("li"); li.className = "pf-none"; li.textContent = "No games yet. Finish a game and it will show up here."; ul.append(li); }
  list.forEach((g) => {
    const li = document.createElement("li"); li.className = "pf-game";
    const mode = document.createElement("span"); mode.className = "pf-mode " + g.mode; mode.textContent = g.mode === "daily" ? "Daily" : "Solo";
    const res = document.createElement("b"); res.className = g.won ? "win" : "loss"; res.textContent = g.won ? "WIN" : "LOSS";
    const att = document.createElement("span"); att.className = "pf-att"; att.textContent = `${g.tries} attempt${g.tries === 1 ? "" : "s"}`;
    const dt = document.createElement("time"); dt.dateTime = g.at; dt.textContent = fmtDate(g.at, true);
    li.append(mode, res, att, dt); ul.append(li);
  });
  const v = $("#pf-viewall"); v.classList.toggle("hidden", all.length <= 5); v.textContent = showAllGames ? "Show less" : "View All"; v.setAttribute("aria-expanded", String(showAllGames));
}
function renderEdit() {
  $("#s-name").value = Player.data.username;
  $("#s-avatars").innerHTML = AVATARS.map((a) => `<button class="${a === Player.data.avatar ? "on" : ""}" data-av="${a}">${a}</button>`).join("");
}
function openEdit() { renderEdit(); $("#edit-profile").classList.remove("hidden"); lockModal(true); $("#s-name").focus(); }
function closeEdit() { if ($("#edit-profile").classList.contains("hidden")) return; $("#edit-profile").classList.add("hidden"); lockModal(false); renderProfile(); renderDashboard(); }
const THEME_COLOR = { dark: "#1A1A1B", light: "#F5F4EE" };   // browser / phone status bar colour (matches --bg)
function applySettings() {
  document.documentElement.dataset.theme = settings.theme; document.documentElement.dataset.motion = reduced() ? "reduced" : "full";
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = THEME_COLOR[settings.theme] || THEME_COLOR.dark;
  save("settings", settings);
}
// "Reset all progress" (guest devices only). Settings > Privacy & Security > Delete Account uses it for guests, after its own confirmation.
async function resetAllProgress(alreadyConfirmed) {
  if (alreadyConfirmed || await confirmBox("Reset everything?", "This deletes your coins, clues, stats and streaks. It can't be undone.", "Reset")) {
    Object.keys(localStorage).filter((k) => k.startsWith("wb_") && k !== "wb_settings").forEach((k) => localStorage.removeItem(k)); location.reload();   // keeps your theme / sound choices
  }
}

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
// Purchase / claim feedback: glow on the card, coins flying between the balance and the card, a floating label.
// dir "spend": coins leave the balance and land on the card | dir "gain": coins fly from the card up to the balance. Skipped for reduced motion.
function shopFx(card, label, dir, amount) {
  const bal = document.querySelector("#shop .coins");
  if (dir !== "gain" && bal) { bal.classList.remove("bump"); void bal.offsetWidth; bal.classList.add("bump"); setTimeout(() => bal.classList.remove("bump"), 650); }   // gains bump when the coins land (coinsToBalance)
  if (!card || reduced()) return;
  card.classList.remove("buy-ok"); void card.offsetWidth; card.classList.add("buy-ok"); setTimeout(() => card.classList.remove("buy-ok"), 1100);
  const a = card.getBoundingClientRect(), t = bal ? bal.getBoundingClientRect() : { left: a.left, top: a.top - 200, width: 0, height: 0 };
  const cardPt = { x: a.left + a.width / 2, y: a.top + a.height * 0.62 }, balPt = { x: t.left + t.width / 2, y: t.top + t.height / 2 };
  const [from, to] = dir === "spend" ? [balPt, cardPt] : [cardPt, balPt];
  if (dir === "gain" && amount > 0) {                                  // same effect as wins and the game-screen claim: coins fly into the total, then the number counts up
    const pop2 = document.createElement("span"); pop2.className = "shop-pop"; pop2.textContent = label; pop2.style.left = cardPt.x + "px"; pop2.style.top = cardPt.y + "px";
    document.body.append(pop2); setTimeout(() => pop2.remove(), 1300);
    return coinsToBalance(card, amount);
  }
  const pop = document.createElement("span"); pop.className = "shop-pop"; pop.textContent = label; pop.style.left = cardPt.x + "px"; pop.style.top = cardPt.y + "px";
  document.body.append(pop); setTimeout(() => pop.remove(), 1300);
  for (let i = 0; i < 6; i++) {
    const c = document.createElement("span"); c.className = "shop-coin"; c.textContent = "🪙"; c.style.left = from.x + "px"; c.style.top = from.y + "px"; document.body.append(c);
    const dx = to.x - from.x, dy = to.y - from.y, sp = (i - 2.5) * 12;
    const an = c.animate([{ transform: "translate(-50%,-50%) scale(.6)", opacity: 0 }, { transform: `translate(calc(-50% + ${sp}px),calc(-50% - 26px)) scale(1.1)`, opacity: 1, offset: 0.25 }, { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.55)`, opacity: 0.95 }], { duration: 720 + i * 70, delay: i * 55, easing: "cubic-bezier(.4,0,.2,1)", fill: "both" });
    an.onfinish = () => c.remove(); setTimeout(() => c.remove(), 2000);
  }
}
// Coins fly from `src` (an element) into the visible coin balance, then the number counts up to the real balance.
// Used by Free Coins (game screen) and by win rewards. The balance itself is always updated first by the caller (Player.addCoins / Player.reward);
// this only changes what is DRAWN, so it can never pay twice. Works with viewport coordinates, so it is the same on desktop and mobile.
function visibleCoins() { return $$(".coins").find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest(".hidden"); }) || null; }
function coinsToBalance(src, amount, opts = {}) {
  const to = visibleCoins(), vals = $$(".coin-val"), real = () => Player.data.coins, before = Math.max(0, real() - amount);
  const finish = () => { refreshCoins(); if (opts.onTick) opts.onTick(real()); if (to) { to.classList.remove("bump"); void to.offsetWidth; to.classList.add("bump"); setTimeout(() => to.classList.remove("bump"), 650); } };
  if (!src || !to || reduced() || !src.getBoundingClientRect) return finish();
  const a = src.getBoundingClientRect(), t = to.getBoundingClientRect();
  if (!a.width || !t.width) return finish();
  const from = { x: a.left + a.width / 2, y: a.top + a.height / 2 }, dest = { x: t.left + t.width / 2, y: t.top + t.height / 2 };
  vals.forEach((v) => (v.textContent = before)); if (opts.onTick) opts.onTick(before);       // the balance shows the old number until the coins land
  const n = 8; let landed = 0, done = false;
  const land = () => {
    if (done) return; done = true; const to2 = real(), t0 = performance.now();
    const step = (now) => { const k = Math.min(1, (now - t0) / 450), v = Math.round(before + (to2 - before) * (1 - Math.pow(1 - k, 3))); vals.forEach((e) => (e.textContent = v)); if (opts.onTick) opts.onTick(v); if (k < 1) requestAnimationFrame(step); else finish(); };
    requestAnimationFrame(step);
  };
  for (let i = 0; i < n; i++) {
    const c = document.createElement("span"); c.className = "shop-coin"; c.textContent = "🪙"; c.style.left = from.x + "px"; c.style.top = from.y + "px"; document.body.append(c);
    const dx = dest.x - from.x, dy = dest.y - from.y, sx = (i - (n - 1) / 2) * 12, sy = -18 - (i % 3) * 8;
    const an = c.animate([{ transform: "translate(-50%,-50%) scale(.5)", opacity: 0 }, { transform: `translate(calc(-50% + ${sx}px),calc(-50% + ${sy}px)) scale(1.1)`, opacity: 1, offset: 0.22 }, { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.55)`, opacity: 0.95 }], { duration: 760 + i * 60, delay: i * 55, easing: "cubic-bezier(.45,0,.2,1)", fill: "both" });
    an.onfinish = () => { c.remove(); if (++landed === n) land(); }; setTimeout(() => { c.remove(); land(); }, 2600);   // safety net: the balance always ends correct
  }
}
async function buyItem(id) {                              // one purchase at a time; the price is checked again at the moment of payment
  if (spendLock) return; spendLock = true; let cool = 0;
  const btn = document.querySelector(`#shop-cards [data-buy="${id}"]`), all = $$("#shop-cards [data-buy]");
  all.forEach((b) => (b.disabled = true));                // every Buy button is locked while this purchase runs: repeated taps can't buy twice
  try {
    const it = SHOP_ITEMS.find((i) => i.id === id); if (!it || it.kind === "free") return;
    if (Player.data.coins < it.price) return needCoins(it.price);
    if (!(await confirmSpend("Buy", `Buy 1 "${it.name}" for ${it.price} coins?`, it.price, it.icon))) return;
    if (!Player.spend(it.price)) return toast("Not enough coins", "error");
    if (it.kind === "hint") Player.addHintCredit(it.type); else if (it.kind === "skip") Player.addSkipCredit();
    sfx.coin(); toast(`Bought: ${it.name}`, "success"); updateHintButtons();   // updateHintButtons also refreshes every coin counter
    cool = reduced() ? 400 : 1000;                         // keep the buttons locked while the success effect plays
    if (btn) { btn.textContent = "✓ Bought"; btn.classList.add("ok"); setTimeout(() => { btn.textContent = "Buy"; btn.classList.remove("ok"); }, cool); }
    shopFx(btn && btn.closest(".gcard"), `-${it.price} 🪙`, "spend");
  } finally { setTimeout(() => { spendLock = false; all.forEach((b) => (b.disabled = false)); }, cool); }
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

// ---------- Clues in a game ----------
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
  if (status !== "playing" || busy) return;
  if (type === "word") return openClues();   // the lightbulb never pays by itself: it opens the popup (buying happens inside it)
  if (spendLock) return;
  spendLock = true;
  try {
    const plan = type === "reveal" ? planReveal() : planRemove();
    if (!plan) return toast("No useful clue available. No coins spent.", "error");
    const h = Player.data.hints[type], cost = HINTS[type].cost, gid = gameId;
    if (h.free <= 0 && h.credits <= 0) {
      if (Player.data.coins < cost) return needCoins(cost);
      if (!(await confirmSpend("Use a clue", `Use ${cost} coins to ${HINTS[type].verb}?`, cost, ICONS[type]))) return;
      if (status !== "playing" || gameId !== gid) return; // game may have changed while the dialog was open
      if (!Player.spend(cost)) return toast("Not enough coins", "error");
    } else Player.consumeHint(type);
    if (type === "reveal") { hintState.reveals[plan.pos] = plan.letter; toast(`Letter ${plan.pos + 1} is ${plan.letter.toUpperCase()}`, "success"); }
    else { hintState.disabled.push(...plan); toast(`${plan.length} wrong letters removed`, "success"); }
    sfx.coin(); flash($(`[data-hint=${type}]`)); renderHintTiles(); colorKeys(); updateHintButtons(); saveProgress();
  } finally { spendLock = false; }
}

// ---------- Clues (lightbulb): up to 3 clues per word, never the word itself ----------
// Four things, kept apart on purpose:
//   available = clueDeck()      every clue that exists for this word (js/clues.js)
//   owned     = ownedClues()    the clues this player already bought for this word (saved in hintState.clues, in the order bought)
//   displayed = drawClue()      the popup always shows ALL owned clues, newest on top
//   capacity  = cluesLeft()     how many more may still be bought (max 3 per word)
// Clicking the lightbulb only OPENS the popup. Paying happens only from the Buy buttons inside it, so an owned clue is never asked for twice.
// hintState lives inside the saved game (game_practice / game_daily, stored per player by wbKey), so it survives a refresh, belongs to this word
// only (startGame resets it for a new word) and is never shared with another player or guest.
const CLUE_LABELS = { meaning: ["📖", "Meaning"], related: ["🔗", "Related words"], category: ["🏷️", "Category"], usage: ["💬", "In context"], fact: ["✨", "Fun fact"] };
const MAX_CLUES = 3;
function clueDeck() { // three clues per word (js/clues.js); a safe fallback keeps the game working if a word has no entry
  const d = window.CLUES && window.CLUES[answer];
  if (Array.isArray(d) && d.length) return d;
  const v = [...answer].filter((c) => "aeiou".includes(c)).length;
  return [["fact", `It has ${v} vowel${v === 1 ? "" : "s"} and ${new Set(answer).size} different letters.`]];
}
const clueCap = () => Math.min(MAX_CLUES, clueDeck().length);
function ownedClues() { // purchased clue indexes: valid, no duplicates, in the order they were bought
  const deck = clueDeck();
  return hintState.clues.filter((i, p, arr) => Number.isInteger(i) && deck[i] && arr.indexOf(i) === p).slice(0, MAX_CLUES);
}
const cluesLeft = () => Math.max(0, clueCap() - ownedClues().length);
function planClue() { // a random clue that is not owned yet, or null when all of them are
  if (cluesLeft() <= 0) return null;
  const own = ownedClues(), left = clueDeck().map((_, i) => i).filter((i) => !own.includes(i));
  return left.length ? left[Math.floor(Math.random() * left.length)] : null;
}
const clueIsFree = () => { const h = Player.data.hints.word; return h.free > 0 || h.credits > 0; };   // free uses are used before coins
const cluePrice = () => (clueIsFree() ? "Free" : `${HINTS.word.cost} 🪙`);
function clueRow(c, n) { const [e, l] = CLUE_LABELS[c[0]] || CLUE_LABELS.fact; return `<div class="clue-kind"><span aria-hidden="true">${e}</span>${n ? `Clue ${n} · ` : ""}${l}</div><p class="clue-text"></p>`; }
function drawClue(isNew) { // fills the popup from what the player owns. Owned clues are always shown first.
  const deck = clueDeck(), own = ownedClues(), total = clueCap(), left = cluesLeft(), has = own.length > 0;
  const on = (sel, v) => $(sel).classList.toggle("hidden", !v);
  on("#clue-empty", !has); on("#clue-count", has); on("#clue-main", has); on("#clue-prev", own.length > 1);
  on("#clue-buy", has && left > 0); on("#clue-full", has && left === 0);
  if (!has) { $("#clue-price").textContent = cluePrice(); return; }
  $("#clue-count").textContent = `${own.length} of ${total} clues unlocked`;
  const last = own[own.length - 1], main = $("#clue-main");
  main.innerHTML = clueRow(deck[last], own.length); main.querySelector(".clue-text").textContent = deck[last][1];
  if (isNew) { main.classList.remove("in"); void main.offsetWidth; main.classList.add("in"); }
  const prev = $("#clue-prev"); prev.innerHTML = "";
  own.slice(0, -1).reverse().forEach((i, k) => { const d = document.createElement("div"); d.className = "clue-old"; d.innerHTML = clueRow(deck[i], own.length - 1 - k); d.querySelector(".clue-text").textContent = deck[i][1]; prev.append(d); });
  $("#clue-buy").textContent = `Buy Another Clue · ${cluePrice()}`;
}
function openClues() {
  if (status !== "playing") return;
  const auto = ownedClues().length === 0 && cluesLeft() > 0 && clueIsFree();   // free uses left and no clue yet: reveal the first clue straight away, no buy screen
  if (auto) buyClue();                                                           // the free path has no dialog, so this finishes at once
  drawClue(auto);
  $("#clue").classList.remove("hidden"); lockModal(true); $("#clue-x").focus();
}
const clueBusy = (on) => { $("#clue-first").disabled = on; $("#clue-buy").disabled = on; };
async function buyClue() { // the ONLY place a clue is paid for: Buy Clue (none owned yet) and Buy Another Clue (some owned) both come here
  if (spendLock || status !== "playing" || busy) return;   // one purchase at a time: repeated taps can't buy or charge twice
  if (cluesLeft() <= 0) return drawClue(false);             // all 3 owned: nothing to buy, just show them
  spendLock = true; clueBusy(true);
  try {
    const gid = gameId, cost = HINTS.word.cost;
    if (!clueIsFree()) {
      if (Player.data.coins < cost) { closeClue(); await needCoins(cost); return; }
      if (!(await confirmSpend("Buy a clue", `Use ${cost} coins to buy the next clue for this word?`, cost, ICONS.word))) return;
      if (status !== "playing" || gameId !== gid) return;   // the game changed while the dialog was open
    }
    const idx = planClue(); if (idx === null) return drawClue(false);   // re-picked after the dialog; nothing left means nothing charged
    if (clueIsFree()) Player.consumeHint("word"); else if (!Player.spend(cost)) return toast("Not enough coins", "error");   // coins leave only now, once the clue is certain
    hintState.clues.push(idx); saveProgress();               // the clue is saved together with the payment
    sfx.coin(); flash($("[data-hint=word]")); updateHintButtons(); drawClue(true);   // updateHintButtons also refreshes every coin counter
  } finally { spendLock = false; clueBusy(false); }
}
$("#clue-first").onclick = buyClue; $("#clue-buy").onclick = buyClue;
function closeClue() { $("#clue").classList.add("hidden"); lockModal(false); const b = $("[data-hint=word]"); if (b && !b.disabled) b.focus({ preventScroll: true }); }
$("#clue-x").onclick = closeClue;
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
  $("#dd-date").textContent = longDate();
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
  const ws = $("#game .winscore"); ws.classList.toggle("is-date", mode === "daily"); $("#g-date").textContent = longDate();   // Daily: today's date takes the place of the score
  ws.setAttribute("aria-label", mode === "daily" ? "Today's date" : "Wins"); ws.title = mode === "daily" ? "Today's Daily Challenge" : "Total wins";
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

let lastReward = null, rewardFxFor = null;
function finishGame() { // each game id can only pay out once (see Player.reward)
  lastReward = null;
  const usedHint = Object.keys(hintState.reveals).length > 0 || hintState.disabled.length > 0 || hintState.clues.length > 0;   // any Reveal / Remove / Word hint in this game (Skip is not a hint)
  if (status === "won") { lastReward = Player.reward(gameId, mode, guesses.length, usedHint); }
  else Player.recordLoss(gameId);
  Player.logGame(gameId, mode, status === "won", guesses.length);   // shown under Recent Games on the Profile (once per game)
  if (mode === "daily") { const g = load("game_daily", null); if (g && g.date === today()) { g.reward = lastReward ? { coins: lastReward.coins, xp: lastReward.xp } : { coins: 0, xp: 0 }; save("game_daily", g); } } // remember what this game earned
  if (mode === "daily" && stats.lastDaily !== today()) {
    const y = new Date(); y.setDate(y.getDate() - 1); const yesterday = isoLocal(y);
    stats.played++;
    if (status === "won") { stats.wins++; stats.streak = stats.lastDaily === yesterday ? stats.streak + 1 : 1; stats.best = Math.max(stats.best, stats.streak); stats.dist[guesses.length - 1]++; }
    else stats.streak = 0;
    stats.lastDaily = today(); save("stats", stats);
  }
  refreshCoins();
  if (window.Achievements) Achievements.check({ announce: true });   // unlock anything this game just earned (each only once)
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
  $("#r-dailyhead").classList.toggle("hidden", mode !== "daily"); $("#r-dailydate").textContent = longDate();   // Daily: "Daily Challenge Completed" + the date
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
    if (rewardFxFor !== gameId && r.coins > 0) {                       // animate each win once; reopening the same result never replays or re-pays
      rewardFxFor = gameId; const bal = Player.data.coins;
      setTimeout(() => coinsToBalance($("#r-coins"), r.coins, { onTick: (v) => ($("#r-balance").textContent = `Balance: ${v} 🪙`) }), reduced() ? 0 : 1050);
      const old = Math.max(0, bal - r.coins);                         // until the coins land, both balances show the number from before this win
      $("#r-balance").textContent = `Balance: ${old} 🪙`; $$(".coin-val").forEach((v) => (v.textContent = old));
    }
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
  else if (t.dataset.av) { Player.data.avatar = t.dataset.av; Player.save(); if (window.Auth && Auth.isAccount()) Auth.setAvatar(t.dataset.av); renderEdit(); renderProfile(); }
  else if (t.dataset.hint) useHint(t.dataset.hint);
});
$("#go-settings").onclick = openSettings;
$("#pf-settings").onclick = openSettings;
$("#pf-edit").onclick = openEdit; $("#ep-done").onclick = closeEdit; $("#ep-x").onclick = closeEdit;
$("#edit-profile").addEventListener("click", (e) => { if (e.target.id === "edit-profile") closeEdit(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeEdit(); });
$("#pf-viewall").onclick = () => { showAllGames = !showAllGames; renderRecentGames(); };
$$("#bottomnav [data-nav]").forEach((b) => (b.onclick = () => (b.dataset.nav === "play" ? openGame("practice") : show(b.dataset.nav))));
$("#g-back").onclick = async () => {
  if (status === "playing" && guesses.length > 0 && !(await confirmBox("Leave this game?", "Your progress is saved, so you can continue later.", "Leave"))) return;
  show("dashboard");
};
$("#s-name").onchange = (e) => {
  if (window.Auth && Auth.isAccount()) return Auth.setUsername(e.target.value.trim());
  Player.data.username = e.target.value.trim().slice(0, 16) || Player.data.username; Player.save(); toast("Username saved", "success"); renderProfile();
};
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#clue").classList.contains("hidden") && $("#dialog").classList.contains("hidden")) closeClue(); if (e.key === "Escape" && !$("#modal").classList.contains("hidden")) closeModal(); if (e.key === "Escape" && !$("#daily-done").classList.contains("hidden")) closeDailyDone(); });
$("#dd-ok").onclick = closeDailyDone;
$("#btn-home").onclick = () => { closeModal(); show("dashboard"); };
$("#btn-shop").onclick = () => { closeModal(); go("shop"); };
$("#btn-again").onclick = () => { closeModal(); openGame("practice", true); };
$("#btn-share").onclick = async () => ((await copyText(shareText())) ? toast("Result copied to clipboard", "success") : toast("Couldn't copy result", "error"));
document.addEventListener("keydown", (e) => {
  if (e.target.closest && e.target.closest("input,textarea,select")) return; // typing in a form: leave Enter/letters alone
  if (e.ctrlKey || e.metaKey || e.altKey || document.body.classList.contains("sp-lock") || !$("#modal").classList.contains("hidden") || !$("#dialog").classList.contains("hidden") || !$("#tutorial").classList.contains("hidden") || !$("#daily-done").classList.contains("hidden") || !$("#info").classList.contains("hidden") || !$("#clue").classList.contains("hidden") || !$("#free").classList.contains("hidden")) return;
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
window.WBApp = { show, applySettings, resetAll: resetAllProgress, applyStats: (o) => { Object.assign(stats, o); save("stats", stats, true); }, getStats: () => stats, refresh: () => { refreshCoins(); if (window.Achievements) Achievements.check({ announce: false });   // after a cloud sync: quietly unlock what the loaded save already earned
    if (screen === "dashboard") renderDashboard(); if (screen === "profile") renderProfile(); } };
const splashMs = sessionStorage.getItem("wb_fast") ? 250 : 1600; sessionStorage.removeItem("wb_fast"); // shorter splash right after sign-in/out
setTimeout(async () => { $("#splash").classList.add("out"); if (window.Auth) await Auth.route(); else show("dashboard"); }, splashMs);
if (window.DEMO_MODE) console.info("Wordle Battle: local demo mode. Online battles need Supabase.");