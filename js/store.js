// Player store: coins, XP, hint credits, reward history. Saved in localStorage (local demo).
// NOTE: for online battles, rewards must be granted by the server, never by this file.
const HINTS = {
  reveal: { cost: 50, icon: "🔍", name: "Reveal a Letter", verb: "reveal a letter", desc: "Shows one correct letter in its correct position." },
  remove: { cost: 40, icon: "🚫", name: "Remove Wrong Letters", verb: "remove wrong letters", desc: "Disables keys for letters that are not in the word." },
  word: { cost: 30, icon: "💡", name: "Word Hint", verb: "get a word hint", desc: "A clue about the secret word: its meaning, a related word, a category or a fun fact.", free: 5 }
};
const SKIP = { free: 3, cost: 30 }; // skips: 3 free, then coins. A skip costs as much as a solo win pays (30), so skipping can never make coins.
const REWARDS = { practice: { coins: 30, xp: 30 }, daily: { coins: 50, xp: 60 } }; // coins per win: 30 solo, 50 daily (each game id pays once)

const Player = (() => {
  const KEY = wbKey("player");
  const fresh = () => ({
    username: "Player" + Math.floor(1000 + Math.random() * 9000), avatar: "🦊",
    coins: 100, xp: 0, wins: 0, losses: 0,
    hints: { reveal: { free: 2, credits: 0 }, remove: { free: 2, credits: 0 }, word: { free: HINTS.word.free, credits: 0 } },
    skips: { free: SKIP.free },
    rewarded: [], recent: []
  });
  let p;
  try { p = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY)) || {}); } catch { p = fresh(); }
  if (!p.skips || typeof p.skips.free !== "number") p.skips = { free: SKIP.free }; // older saves get the default 3 free skips
  if (!p.hints || typeof p.hints !== "object") p.hints = fresh().hints;
  if (!p.hints.word || typeof p.hints.word.free !== "number") p.hints.word = { free: HINTS.word.free, credits: 0 }; // older saves get the 5 free word hints
  const save = (quiet) => { localStorage.setItem(KEY, JSON.stringify(p)); if (quiet !== true) window.dispatchEvent(new Event("wb:save")); }; // quiet=true: no cloud sync
  // Migration: older saves had no win distribution/streak. Seed them from what we already know.
  if (!Array.isArray(p.dist) || p.dist.length !== 6) {
    let old = null; try { old = JSON.parse(localStorage.getItem(wbKey("stats"))); } catch {}
    p.dist = old && Array.isArray(old.dist) && old.dist.length === 6 ? [...old.dist] : [0, 0, 0, 0, 0, 0];
    let s = 0; for (let i = p.recent.length - 1; i >= 0 && p.recent[i] === "W"; i--) s++;
    p.streak = s; p.bestStreak = s;
    const idx = p.dist.findIndex((n) => n > 0); p.bestGuesses = idx >= 0 ? idx + 1 : null;
  }
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
    consumeSkip() { if (p.skips.free > 0) { p.skips.free--; save(); return true; } return false; },
    addHintCredit(type) { p.hints[type].credits++; save(); },
    // Each game id can be rewarded or counted only once.
    reward(gameId, kind, tries) {
      if (p.rewarded.includes("W:" + gameId) || p.rewarded.includes("L:" + gameId)) return null;
      const r = REWARDS[kind], before = this.levelInfo().level;
      p.coins += r.coins; p.xp += r.xp; p.wins++;
      if (tries >= 1 && tries <= 6) { p.dist[tries - 1]++; p.bestGuesses = p.bestGuesses ? Math.min(p.bestGuesses, tries) : tries; }
      p.streak++; p.bestStreak = Math.max(p.bestStreak, p.streak);
      p.rewarded.push("W:" + gameId); p.recent = [...p.recent, "W"].slice(-5);
      p.rewarded = p.rewarded.slice(-300); save();
      return { ...r, levelUp: this.levelInfo().level > before };
    },
    recordLoss(gameId) {
      if (p.rewarded.includes("W:" + gameId) || p.rewarded.includes("L:" + gameId)) return;
      p.losses++; p.streak = 0; p.rewarded.push("L:" + gameId); p.recent = [...p.recent, "L"].slice(-5); save();
    }
  };
})();