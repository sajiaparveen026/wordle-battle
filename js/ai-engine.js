// AI Zone: the opponent's brain. Runs entirely in the browser, no API, no key, no network.
// The engine NEVER receives the secret word. It only gets the list of its own earlier guesses and the Wordle feedback each one got
// (the same feedback the player sees), so every strategy has to work the word out from that.
//
//   history = [{ word: "crane", code: "bybgg" }, ...]      code letters: g = correct place, y = in the word, b = not in the word
//
//   Easy   : common-looking words, only sometimes uses the green letters, never uses yellow / grey information, often just random.
//   Medium : rules words out with the feedback it remembers (it forgets about 4 pieces in 10), then picks a sensible word; 3 guesses in 10 are careless.
//   Hard   : keeps the list of words that are still possible and picks the guess that splits that list up the best
//            (information gain). About every second guess it settles for a good-but-not-best word, so it can be beaten.
(function () {
  "use strict";
  const A = "a".charCodeAt(0);
  const cnt = new Int8Array(26);

  // Wordle feedback as one number (base 3, first letter = lowest digit): 0 = not in the word, 1 = in the word, 2 = right place.
  // Repeated letters follow the same two passes as evaluate() in app.js: greens first, then yellows from what is left over.
  function fbCode(guess, secret) {
    cnt.fill(0);
    let code = 0, pow = 1;
    const res = [0, 0, 0, 0, 0];
    for (let i = 0; i < 5; i++) {
      const g = guess.charCodeAt(i), s = secret.charCodeAt(i);
      if (g === s) res[i] = 2; else cnt[s - A]++;
    }
    for (let i = 0; i < 5; i++) {
      if (res[i] === 2) continue;
      const k = guess.charCodeAt(i) - A;
      if (cnt[k] > 0) { res[i] = 1; cnt[k]--; }
    }
    for (let i = 0; i < 5; i++) { code += res[i] * pow; pow *= 3; }
    return code;
  }
  const codeOfString = (s) => { let c = 0, p = 1; for (let i = 0; i < 5; i++) { c += (s[i] === "g" ? 2 : s[i] === "y" ? 1 : 0) * p; p *= 3; } return c; };
  const stringOfCode = (c) => { let s = ""; for (let i = 0; i < 5; i++) { const d = c % 3; s += d === 2 ? "g" : d === 1 ? "y" : "b"; c = (c - d) / 3; } return s; };

  let ANS = [], VAL = [], VALSET = null, freq = null, posFreq = null, ready = false;
  function init(opts) {
    opts = opts || {};
    const ans = opts.answers || (typeof ANSWERS !== "undefined" ? ANSWERS : []);
    const val = opts.valid || (typeof VALID !== "undefined" ? VALID : new Set(ans));
    ANS = [...new Set(ans)].filter((w) => /^[a-z]{5}$/.test(w));
    VALSET = val instanceof Set ? val : new Set(val);
    ANS.forEach((w) => VALSET.add(w));                       // every possible answer is also an accepted guess
    VAL = [...VALSET].filter((w) => /^[a-z]{5}$/.test(w));
    // how common each letter is (and in which place) among the possible answers: used to judge how "useful" a word is
    freq = new Float64Array(26); posFreq = Array.from({ length: 5 }, () => new Float64Array(26));
    ANS.forEach((w) => { const seen = new Set(); for (let i = 0; i < 5; i++) { const k = w.charCodeAt(i) - A; posFreq[i][k]++; if (!seen.has(k)) { seen.add(k); freq[k]++; } } });
    ready = true;
  }
  const usefulness = (w) => { let s = 0; const seen = new Set(); for (let i = 0; i < 5; i++) { const k = w.charCodeAt(i) - A; s += posFreq[i][k] * 0.35; if (!seen.has(k)) { seen.add(k); s += freq[k]; } } return s; };

  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
  const norm = (history) => (history || []).map((h) => ({ word: h.word, code: typeof h.code === "number" ? h.code : codeOfString(h.code) }));
  const consistent = (w, hist) => { for (let i = 0; i < hist.length; i++) if (fbCode(hist[i].word, w) !== hist[i].code) return false; return true; };
  let vocab = null;                                              // the words THIS opponent knows (set per match, see createPlayer)
  const possible = (hist) => {                                  // every word the secret could still be, given ALL feedback so far
    let c = (vocab || ANS).filter((w) => consistent(w, hist));
    if (!c.length) c = VAL.filter((w) => consistent(w, hist)); // (only if the secret were not on the answer list)
    return c;
  };
  const greensOf = (hist) => { const g = [null, null, null, null, null]; hist.forEach((h) => { let c = h.code; for (let i = 0; i < 5; i++) { const d = c % 3; c = (c - d) / 3; if (d === 2) g[i] = h.word[i]; } }); return g; };
  const matchesGreens = (w, g) => { for (let i = 0; i < 5; i++) if (g[i] && w[i] !== g[i]) return false; return true; };

  // ---- Easy ----
  function easy(hist, rng, used) {
    const useGreens = hist.length > 0 && rng() < 0.6;           // 4 turns in 10 it does not even use the green letters
    const green = useGreens ? greensOf(hist) : [null, null, null, null, null];
    const fromCommon = rng() < 0.75;                             // otherwise any accepted word, including odd ones
    const pool = fromCommon ? ANS : VAL;
    let list = pool.filter((w) => !used.has(w) && matchesGreens(w, green));
    if (!list.length) list = VAL.filter((w) => !used.has(w));
    return pick(list, rng);
  }

  // ---- Medium ----
  // Uses the feedback, but like a casual player it forgets some of it: each earlier guess is only remembered 6 times in 10.
  function medium(hist, rng, used) {
    if (hist.length && rng() < 0.3) {                           // a careless guess: only remembers the green letters
      const g = greensOf(hist), list = VAL.filter((w) => !used.has(w) && matchesGreens(w, g));
      if (list.length) return pick(list, rng);
    }
    const mem = hist.filter(() => rng() < 0.6);
    let cands = possible(mem).filter((w) => !used.has(w));
    if (!cands.length) cands = possible(hist).filter((w) => !used.has(w));
    if (!cands.length) return pick(VAL.filter((w) => !used.has(w)), rng);
    const scored = cands.map((w) => [w, usefulness(w)]).sort((a, b) => b[1] - a[1]);
    const top = scored.slice(0, Math.max(3, Math.ceil(scored.length * 0.5)));   // a reasonable word, not the sharpest one
    return pick(top, rng)[0];
  }

  // ---- Hard ----
  function entropyPick(cands, rng, hist, used) {
    const sample = cands.length > 420 ? shuffle(cands.slice(), rng).slice(0, 420) : cands;
    const candSet = new Set(cands);
    let guesses = cands.slice();
    if (cands.length > 2) {                                      // a word that is not a possible answer can still be the best way to narrow things down
      const extra = VAL.filter((w) => !candSet.has(w) && !used.has(w)).map((w) => [w, letterGain(w, cands)]).sort((a, b) => b[1] - a[1]).slice(0, 110).map((x) => x[0]);
      guesses = guesses.concat(extra);
    }
    if (guesses.length > 560) guesses = shuffle(guesses, rng).slice(0, 560);
    const n = sample.length, buckets = new Int32Array(243), out = [];
    for (const g of guesses) {
      if (used.has(g)) continue;
      buckets.fill(0);
      for (let i = 0; i < n; i++) buckets[fbCode(g, sample[i])]++;
      let h = 0;
      for (let b = 0; b < 243; b++) { const c = buckets[b]; if (c) { const p = c / n; h -= p * Math.log2(p); } }
      if (candSet.has(g)) h += 1 / cands.length * 1.5;           // a possible answer might simply be right
      out.push([g, h + rng() * 1e-6]);
    }
    out.sort((a, b) => b[1] - a[1]);
    return out;
  }
  function letterGain(w, cands) { const seen = new Set(); let s = 0; for (let i = 0; i < 5; i++) { const k = w.charCodeAt(i) - A; if (seen.has(k)) continue; seen.add(k); let c = 0; for (let j = 0; j < cands.length; j++) if (cands[j].indexOf(w[i]) >= 0) c++; s += Math.min(c, cands.length - c); } return s; }
  function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function hard(hist, rng, used) {
    const cands = possible(hist).filter((w) => !used.has(w));
    if (!cands.length) return pick(VAL.filter((w) => !used.has(w)), rng);
    if (cands.length <= 2) return pick(cands, rng);
    const ranked = entropyPick(cands, rng, hist, used);
    if (!ranked.length) return pick(cands, rng);
    if (!hist.length) return pick(ranked.slice(0, 5), rng)[0];  // varied opener, all of them strong
    const top = rng() < 0.5 ? pick(ranked.slice(0, 30), rng) : ranked[0];   // not a perfect machine: every second guess it settles for one of the 30 best words
    return top[0];
  }

  // Each opponent knows most, but not all, of the common words (Medium 80 %, Hard 65 %), so now and then the secret is a word it did not
  // think of and it has to fall back to the wide dictionary. That is what keeps Hard strong but beatable.
  const KNOWS = { easy: 1, medium: 0.8, hard: 0.65 };
  function createPlayer(level, rng) {
    if (!ready) init();
    rng = rng || Math.random;
    const v = ANS.filter(() => rng() < (KNOWS[level] || 1));
    const mine = v.length > 50 ? v : ANS;
    return { level, next(history) { vocab = mine; try { return guessFor(level, history, rng); } finally { vocab = null; } } };
  }
  function guessFor(level, history, rng) {
    const hist = norm(history), used = new Set(hist.map((h) => h.word));
    let w = level === "easy" ? easy(hist, rng, used) : level === "hard" ? hard(hist, rng, used) : medium(hist, rng, used);
    if (!w || used.has(w) || !VALSET.has(w)) { const rest = VAL.filter((x) => !used.has(x)); w = pick(rest, rng); }   // never invalid, never a repeat
    return w;
  }
  const nextGuess = (level, history, rng) => { if (!ready) init(); return guessFor(level, history, rng || Math.random); };

  const api = { init, createPlayer, nextGuess, fbCode, codeOfString, stringOfCode, possible: (h) => { if (!ready) init(); return possible(norm(h)); } };
  if (typeof window !== "undefined") window.AIEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();