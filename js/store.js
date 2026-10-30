// Player store: coins, XP, hint credits, reward history. Saved in localStorage (local demo).
// NOTE: for online battles, rewards must be granted by the server, never by this file.
// ONE price table: the Shop price and the in-game price of every item come from here, so they always match.
const PRICES = { reveal: 25, remove: 25, word: 10, skip: 30 };
const HINTS = {
  reveal: { cost: PRICES.reveal, icon: "🔍", name: "Reveal Letter", verb: "reveal a letter", desc: "Shows one correct letter in its correct position." },
  remove: { cost: PRICES.remove, icon: "🚫", name: "Remove Wrong Letters", verb: "remove wrong letters", desc: "Disables keys for letters that are not in the word." },
  word: { cost: PRICES.word, icon: "💡", name: "Hint", verb: "get a hint", desc: "A clue about the secret word: its meaning, a related word, a category or a fun fact.", free: 5 }
};
const SKIP = { free: 3, cost: PRICES.skip }; // skips: 3 free, then coins. A skip costs as much as a solo win pays (30), so skipping can never make coins.
const FREE_COINS = { amount: 25, places: ["game", "shop"] }; // free coins: once a day from the game screen AND once a day from the shop (separate limits)
// SHOP CATALOGUE: to sell something new, add one entry here (and, for a new kind, one line in buyItem() in app.js).
//   kind "hint": buying adds one use of HINTS[type] | kind "skip": adds one skip | kind "free": the daily free-coins box
const SHOP_ITEMS = [
  { id: "free", kind: "free", name: "Free Coins" },
  { id: "reveal", kind: "hint", type: "reveal", name: HINTS.reveal.name, price: PRICES.reveal, icon: "reveal", tile: "t-reveal" },
  { id: "remove", kind: "hint", type: "remove", name: HINTS.remove.name, price: PRICES.remove, icon: "remove", tile: "t-remove" },
  { id: "skip", kind: "skip", name: "Skip", price: PRICES.skip, icon: "skip", tile: "t-skip" },
  { id: "word", kind: "hint", type: "word", name: HINTS.word.name, price: PRICES.word, icon: "bulb", tile: "t-word" }
];
const REWARDS = { practice: { coins: 30, xp: 30 }, daily: { coins: 50, xp: 60 } }; // coins per win: 30 solo, 50 daily (each game id pays once)

const Player = (() => {
  const KEY = wbKey("player");
  const fresh = () => ({
    username: "Player" + Math.floor(1000 + Math.random() * 9000), avatar: "🦊",
    coins: 100, xp: 0, wins: 0, losses: 0,
    hints: { reveal: { free: 2, credits: 0 }, remove: { free: 2, credits: 0 }, word: { free: HINTS.word.free, credits: 0 } },
    skips: { free: SKIP.free, credits: 0 },
    rewarded: [], recent: [],
    joinedAt: new Date().toISOString(), history: [], // history = the last 50 finished games (shown on the Profile)
    // Achievements (js/achievements.js): lifetime counters + the unlock record { id: ISO date }, each achievement is stored once and never removed
    earned: 0, noHintWins: 0, sessionsPlayed: 0, lastSession: "", lastGameAt: 0, battles: { played: 0, won: 0 }, ach: {}
  });
  let p;
  let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY)); } catch {}
  try { p = Object.assign(fresh(), saved || {}); } catch { p = fresh(); }
  if (!p.skips || typeof p.skips.free !== "number") p.skips = { free: SKIP.free, credits: 0 }; // older saves get the default 3 free skips
  if (typeof p.skips.credits !== "number" || p.skips.credits < 0) p.skips.credits = 0;            // skips bought in the shop
  if (!p.hints || typeof p.hints !== "object") p.hints = fresh().hints;
  if (!p.hints.word || typeof p.hints.word.free !== "number") p.hints.word = { free: HINTS.word.free, credits: 0 }; // older saves get the 5 free word hints
  if (!Array.isArray(p.history)) p.history = [];
  if (typeof p.joinedAt !== "string" || isNaN(Date.parse(p.joinedAt))) p.joinedAt = new Date().toISOString(); // older saves: "playing since" starts from this version
  const save = (quiet) => { localStorage.setItem(KEY, JSON.stringify(p)); if (quiet !== true) window.dispatchEvent(new Event("wb:save")); }; // quiet=true: no cloud sync
  // Migration: older saves had no win distribution/streak. Seed them from what we already know.
  if (!Array.isArray(p.dist) || p.dist.length !== 6) {
    let old = null; try { old = JSON.parse(localStorage.getItem(wbKey("stats"))); } catch {}
    p.dist = old && Array.isArray(old.dist) && old.dist.length === 6 ? [...old.dist] : [0, 0, 0, 0, 0, 0];
    let s = 0; for (let i = p.recent.length - 1; i >= 0 && p.recent[i] === "W"; i--) s++;
    p.streak = s; p.bestStreak = s;
    const idx = p.dist.findIndex((n) => n > 0); p.bestGuesses = idx >= 0 ? idx + 1 : null;
  }
  // Achievement counters (older saves get safe values; "earned" is estimated once from the wins they already have: 50 per Daily win, 30 per other win)
  const cnt = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  if (saved && typeof saved.earned !== "number") { const dw = p.rewarded.filter((x) => typeof x === "string" && x.startsWith("W:daily-")).length; p.earned = dw * REWARDS.daily.coins + Math.max(0, p.wins - dw) * REWARDS.practice.coins; }
  p.earned = cnt(p.earned); p.noHintWins = cnt(p.noHintWins); p.sessionsPlayed = cnt(p.sessionsPlayed); p.lastGameAt = cnt(p.lastGameAt); p.lastSession = typeof p.lastSession === "string" ? p.lastSession.slice(0, 40) : "";
  if (!p.battles || typeof p.battles !== "object") p.battles = { played: 0, won: 0 };
  p.battles = { played: cnt(p.battles.played), won: Math.min(cnt(p.battles.won), cnt(p.battles.played)) };
  if (!p.ach || typeof p.ach !== "object" || Array.isArray(p.ach)) p.ach = {};
  // A "session" = one app visit. A game finished in a new visit (or 30+ minutes after the last game) counts as a new session.
  const sid = () => { try { let s = sessionStorage.getItem("wb_sid"); if (!s) { s = Math.random().toString(36).slice(2); sessionStorage.setItem("wb_sid", s); } return s; } catch { return "x"; } };
  function countSession() { const now = Date.now(), s = sid(); if (p.lastSession !== s || now - p.lastGameAt > 30 * 60 * 1000) p.sessionsPlayed++; p.lastSession = s; p.lastGameAt = now; }
  save();
  const need = (lv) => 100 + (lv - 1) * 50;

  return {
    get data() { return p; },
    save,
    levelInfo() { let lv = 1, xp = p.xp; while (xp >= need(lv)) { xp -= need(lv); lv++; } return { level: lv, xp, need: need(lv) }; },
    spend(n) { if (!Number.isInteger(n) || n <= 0 || p.coins < n) return false; p.coins -= n; save(); return true; }, // whole, positive amounts only; never goes below zero
    // Returns the hint source used ("free" or "credit"), or null if none left.
    consumeHint(type) {
      const h = p.hints[type];
      if (h.free > 0) { h.free--; save(); return "free"; }
      if (h.credits > 0) { h.credits--; save(); return "credit"; }
      return null;
    },
    addCoins(n) { if (!Number.isInteger(n) || n <= 0 || n > 1000) return false; p.coins += n; p.earned += n; save(); return true; }, // used by the daily free-coins claim
    consumeSkip() { if (p.skips.free > 0) { p.skips.free--; save(); return true; } if (p.skips.credits > 0) { p.skips.credits--; save(); return true; } return false; }, // free skips first, then bought ones
    addSkipCredit() { p.skips.credits++; save(); },
    addHintCredit(type) { p.hints[type].credits++; save(); },
    // Remember a finished game for the Profile (once per game id). The answer word is never stored.
    logGame(id, kind, won, tries) {
      if (!id || p.history.some((h) => h.id === id)) return;
      p.history.push({ id: String(id).slice(0, 60), mode: kind === "daily" ? "daily" : "practice", won: !!won, tries: Math.min(6, Math.max(1, tries | 0)), at: new Date().toISOString() });
      p.history = p.history.slice(-50); save();
    },
    // Each game id can be rewarded or counted only once.
    reward(gameId, kind, tries, hintsUsed) {
      if (p.rewarded.includes("W:" + gameId) || p.rewarded.includes("L:" + gameId)) return null;
      const r = REWARDS[kind], before = this.levelInfo().level;
      p.coins += r.coins; p.earned += r.coins; p.xp += r.xp; p.wins++; if (!hintsUsed) p.noHintWins++; countSession();
      if (tries >= 1 && tries <= 6) { p.dist[tries - 1]++; p.bestGuesses = p.bestGuesses ? Math.min(p.bestGuesses, tries) : tries; }
      p.streak++; p.bestStreak = Math.max(p.bestStreak, p.streak);
      p.rewarded.push("W:" + gameId); p.recent = [...p.recent, "W"].slice(-5);
      p.rewarded = p.rewarded.slice(-300); save();
      return { ...r, levelUp: this.levelInfo().level > before };
    },
    // For the future online mode: call once per finished online battle (never from the client for real rewards, see the note at the top).
    recordBattle(won) { p.battles.played++; if (won) p.battles.won++; save(); },
    recordLoss(gameId) {
      if (p.rewarded.includes("W:" + gameId) || p.rewarded.includes("L:" + gameId)) return;
      p.losses++; p.streak = 0; countSession(); p.rewarded.push("L:" + gameId); p.recent = [...p.recent, "L"].slice(-5); save();
    }
  };
})();