// Player store: coins, XP, clue credits, reward history. Saved in localStorage (local demo).
// NOTE: online battle rewards are decided and paid (once) by the server; this file only records them (see rewardBattle).
// ONE price table: the Shop price and the in-game price of every item come from here, so they always match.
const PRICES = { reveal: 25, remove: 25, word: 10, skip: 30 };
const HINTS = {
  reveal: { cost: PRICES.reveal, icon: "🔍", name: "Reveal Letter", verb: "reveal a letter", desc: "Shows one correct letter in its correct position." },
  remove: { cost: PRICES.remove, icon: "🚫", name: "Remove Wrong Letters", verb: "remove wrong letters", desc: "Disables keys for letters that are not in the word." },
  word: { cost: PRICES.word, icon: "💡", name: "Clue", verb: "buy a clue", desc: "Up to 3 clues per word: its meaning, a related word, a category or a fun fact.", free: 5 }
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
const REWARDS_AI = { easy: { win: [10, 15], draw: [5, 8], loss: [0, 5] }, medium: { win: [20, 30], draw: [10, 15], loss: [0, 8] }, hard: { win: [30, 50], draw: [15, 25], loss: [0, 10] } }; // AI Zone [coins, xp] per outcome; a Hard win pays the same as an online battle win
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
    earned: 0, noHintWins: 0, sessionsPlayed: 0, lastSession: "", lastGameAt: 0, battles: { played: 0, won: 0 }, ach: {},
    // Battle profile stats (separate from Solo): bstats = completed Friend + Team battles, bhist = the last 50 of them (Recent Plays > Battle)
    bstats: null, bhist: [],
    // AI Zone (js/ai-zone.js): ai = completed matches vs the computer, ahist = the last 50 of them. Kept apart from Solo, Friend Battle and Team Battle.
    ai: null, ahist: [],
    // More achievement counters (js/achievements.js): fb / tb = completed Friend / Team battles (tb.won = finished first), fast = wins within 2 min / 60 s / 45 s,
    // noPower = wins that used no hint and no skip, friendsMax = most friends you have had at once. skipGame = the game id that came from a Skip (not synced).
    fb: null, tb: null, fast: null, noPower: 0, friendsMax: 0, skipGame: ""
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
  // Battle stats (Profile > Battle). Older saves are seeded ONCE from the lifetime battle counters (losses = played - won, draws were never counted separately).
  const seedB = () => ({ played: p.battles.played, won: p.battles.won, lost: Math.max(0, p.battles.played - p.battles.won), draw: 0, streak: 0, best: 0 });
  const cleanB = (b) => { const o = { played: cnt(b.played), won: cnt(b.won), lost: cnt(b.lost), draw: cnt(b.draw), streak: cnt(b.streak), best: cnt(b.best) }; o.best = Math.max(o.best, o.streak); return o; };
  p.bstats = p.bstats && typeof p.bstats === "object" ? cleanB(p.bstats) : seedB();
  if (!Array.isArray(p.bhist)) p.bhist = [];
  p.ai = p.ai && typeof p.ai === "object" ? cleanB(p.ai) : { played: 0, won: 0, lost: 0, draw: 0, streak: 0, best: 0 };
  if (!Array.isArray(p.ahist)) p.ahist = [];
  // Friend / Team battle counters. Older saves are seeded once from the battle history they still have (last 50): only entries that are clearly
  // a Friend battle (has an opponent) or a Team battle (typed "team") are counted, so nothing is ever over-counted.
  const cleanC = (o) => { const pl = cnt(o.played); return { played: pl, won: Math.min(cnt(o.won), pl) }; };
  const seedC = (test) => { const h = p.bhist.filter((x) => x && test(x)); return { played: h.length, won: h.filter((x) => x.result === "win").length }; };
  p.fb = p.fb && typeof p.fb === "object" ? cleanC(p.fb) : seedC((x) => x.type === "friend" && x.opp);
  p.tb = p.tb && typeof p.tb === "object" ? cleanC(p.tb) : seedC((x) => x.type === "team");
  p.fast = p.fast && typeof p.fast === "object" ? { s120: cnt(p.fast.s120), s60: cnt(p.fast.s60), s45: cnt(p.fast.s45) } : { s120: 0, s60: 0, s45: 0 };
  p.noPower = cnt(p.noPower); p.friendsMax = cnt(p.friendsMax); p.skipGame = typeof p.skipGame === "string" ? p.skipGame.slice(0, 60) : "";
  const fastWin = (ms) => { if (!Number.isFinite(ms) || ms < 1000) return; if (ms <= 120000) p.fast.s120++; if (ms <= 60000) p.fast.s60++; if (ms <= 45000) p.fast.s45++; };   // under 1 s is not a real time
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
    // Spin Wheel (js/wheel.js): takes the paid-spin cost and adds the prize in ONE save, once per spin request id (a retry or refresh can never pay twice).
    // prize = { kind: "coins" | "hint" | "skip", amount, hint }. Returns { coins } (coins won) or null when it was already applied / cannot be applied.
    applySpin(reqId, cost, prize) {
      const key = "S:" + reqId;
      if (!reqId || !prize || p.rewarded.includes(key) || !Number.isInteger(cost) || cost < 0 || p.coins < cost) return null;
      const n = Math.min(1000, Math.max(1, Number(prize.amount) | 0)); let coins = 0;
      if (prize.kind === "coins") coins = n;
      else if (prize.kind === "hint" && p.hints[prize.hint]) p.hints[prize.hint].credits += Math.min(n, 5);
      else if (prize.kind === "skip") p.skips.credits += Math.min(n, 5);
      else return null;
      p.coins = p.coins - cost + coins; p.earned += coins;
      p.rewarded.push(key); p.rewarded = p.rewarded.slice(-300); save();
      return { coins };
    },
    // Remember a finished game for the Profile (once per game id). The answer word is never stored.
    logGame(id, kind, won, tries) {
      if (!id || p.history.some((h) => h.id === id)) return;
      p.history.push({ id: String(id).slice(0, 60), mode: kind === "daily" ? "daily" : "practice", won: !!won, tries: Math.min(6, Math.max(1, tries | 0)), at: new Date().toISOString() });
      p.history = p.history.slice(-50); save();
    },
    // Each game id can be rewarded or counted only once.
    reward(gameId, kind, tries, hintsUsed, extra) {   // extra (optional): { ms: play time of this game, power: true if a hint or a skip was used }
      if (p.rewarded.includes("W:" + gameId) || p.rewarded.includes("L:" + gameId)) return null;
      const r = REWARDS[kind], before = this.levelInfo().level;
      p.coins += r.coins; p.earned += r.coins; p.xp += r.xp; p.wins++; if (!hintsUsed) p.noHintWins++; countSession();
      if (tries >= 1 && tries <= 6) { p.dist[tries - 1]++; p.bestGuesses = p.bestGuesses ? Math.min(p.bestGuesses, tries) : tries; }
      p.streak++; p.bestStreak = Math.max(p.bestStreak, p.streak);
      if (extra && typeof extra === "object") { fastWin(extra.ms); if (extra.power === false) p.noPower++; }
      p.rewarded.push("W:" + gameId); p.recent = [...p.recent, "W"].slice(-5);
      p.rewarded = p.rewarded.slice(-300); save();
      return { ...r, levelUp: this.levelInfo().level > before };
    },
    // Online battle reward. The server decides the amounts and pays each battle once (bt_claim_reward); this only writes them to the local save,
    // once per battle room id, so a refresh, a second tab or a retry can never add them twice. Leaving a battle (forfeit) earns nothing.
    // meta (optional, only for the Profile): { type: "friend" | "team", tries, status, ms, opp: { name, avatar }, place, size }. No word or answer is ever passed in.
    rewardBattle(roomId, outcome, coins, xp, meta) {
      const key = "B:" + roomId;
      if (!roomId || p.rewarded.includes(key) || !["win", "loss", "draw"].includes(outcome)) return null;
      coins = Math.min(1000, Math.max(0, Number(coins) | 0)); xp = Math.min(1000, Math.max(0, Number(xp) | 0));
      const before = this.levelInfo().level;
      p.coins += coins; p.earned += coins; p.xp += xp;
      p.battles.played++; if (outcome === "win") { p.battles.won++; p.wins++; } else if (outcome === "loss") p.losses++;
      const b = p.bstats; b.played++;                                       // Profile > Battle: completed battles only (forfeits never reach here); a draw is neither a win nor a loss
      if (outcome === "win") { b.won++; b.streak++; b.best = Math.max(b.best, b.streak); } else if (outcome === "loss") { b.lost++; b.streak = 0; } else b.draw++;
      const m = meta && typeof meta === "object" ? meta : {}, ok = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
      p.bhist.push({ id: String(roomId).slice(0, 60), type: m.type === "team" ? "team" : "friend", result: outcome, tries: ok(m.tries, 0, 6), status: ["solved", "failed"].includes(m.status) ? m.status : "", ms: Number.isFinite(m.ms) && m.ms >= 0 ? Math.round(m.ms) : null,
        opp: m.opp && typeof m.opp.name === "string" ? { name: m.opp.name.slice(0, 16), avatar: String(m.opp.avatar || "").slice(0, 8) } : null, place: ok(m.place, 1, 5), size: ok(m.size, 2, 5), coins, xp, at: new Date().toISOString() });
      p.bhist = p.bhist.slice(-50);
      const side = m.type === "team" ? p.tb : p.fb; side.played++; if (outcome === "win") side.won++;      // Friend and Team battles are counted apart (tb.won = finished first)
      if (outcome === "win" && m.status === "solved") { fastWin(m.ms); if (m.hints === 0) p.noPower++; }      // a battle win only counts for speed / no-power-up when you really solved the word
      countSession(); p.rewarded.push(key); p.rewarded = p.rewarded.slice(-300); save();
      return { coins, xp, outcome, levelUp: this.levelInfo().level > before };
    },
    // AI Zone reward + record. Paid and counted ONCE per match id (a refresh, a second tab or a retry can never pay twice). Only coins / XP / the AI counters change:
    // wins, losses and the battle counters are NOT touched, so Solo, Friend Battle, Team Battle and the leaderboard never see these matches. No word is stored.
    rewardAI(matchId, level, outcome, meta) {
      const key = "A:" + matchId;
      if (!matchId || p.rewarded.includes(key) || !REWARDS_AI[level] || !["win", "loss", "draw"].includes(outcome)) return null;
      const [coins, xp] = REWARDS_AI[level][outcome], before = this.levelInfo().level, m = meta && typeof meta === "object" ? meta : {}, ok = (v) => (Number.isInteger(v) && v >= 0 && v <= 6 ? v : 0);
      p.coins += coins; p.earned += coins; p.xp += xp;
      const a = p.ai; a.played++;
      if (outcome === "win") { a.won++; a.streak++; a.best = Math.max(a.best, a.streak); } else if (outcome === "loss") { a.lost++; a.streak = 0; } else a.draw++;
      p.ahist.push({ id: String(matchId).slice(0, 60), level, result: outcome, tries: ok(m.tries), aiTries: ok(m.aiTries), status: m.status === "solved" ? "solved" : "failed", ms: Number.isFinite(m.ms) && m.ms >= 0 ? Math.round(m.ms) : null, coins, xp, at: new Date().toISOString() });
      p.ahist = p.ahist.slice(-50);
      countSession(); p.rewarded.push(key); p.rewarded = p.rewarded.slice(-300); save();
      return { coins, xp, outcome, levelUp: this.levelInfo().level > before };
    },
    // Solo numbers for the Profile: battle wins/losses are also added to wins/losses (achievements use those), so they are taken out here to keep Solo and Battle separate.
    soloCounts() { const w = Math.max(0, p.wins - p.bstats.won), l = Math.max(0, p.losses - p.bstats.lost); return { won: w, played: w + l }; },
    // Skip bookkeeping + friend count for the achievements. markSkip: the word that replaced a skipped one is not a "no power-up" win.
    markSkip(gameId) { p.skipGame = String(gameId || "").slice(0, 60); save(true); },
    noteFriends(n) { n = cnt(n); if (n > p.friendsMax) { p.friendsMax = n; save(); } return p.friendsMax; },
    recordBattle(won) { p.battles.played++; if (won) p.battles.won++; save(); },
    recordLoss(gameId) {
      if (p.rewarded.includes("W:" + gameId) || p.rewarded.includes("L:" + gameId)) return;
      p.losses++; p.streak = 0; countSession(); p.rewarded.push("L:" + gameId); p.recent = [...p.recent, "L"].slice(-5); save();
    }
  };
})();