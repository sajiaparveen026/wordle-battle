// Wordle Battle audio: ONE central place for all background music and sound effects.
//   * Sounds are small MP3 files in /audio (original sounds made for this app, see audio/CREDITS.md). They are decoded once and played through
//     the Web Audio API, so they start instantly and never block the game.
//   * Settings: settings.mute (Sound Effects OFF), settings.sfxVol, settings.music (Background Music ON), settings.musicVol. Changes apply at once.
//   * Music: Home, Solo / Daily and Battle tracks, chosen automatically from what is on screen, cross-faded, looped without a gap.
//   * Browsers only allow sound after a tap: everything is unlocked on the first tap / key press. Music and effects stop when the app is in the background.
//   * Other files only call WBAudio.play("name") (through the sfx object in app.js); nothing else creates sounds.
(() => {
  "use strict";
  const BASE = "audio/";
  const SFX = {
    tap: {"cool": 60, "jit": 0.04},
    toggle_on: {"cool": 80},
    toggle_off: {"cool": 80},
    menu_open: {"cool": 120},
    menu_close: {"cool": 120},
    whoosh: {"cool": 250},
    popup_open: {"cool": 120},
    popup_close: {"cool": 120},
    notify: {"cool": 400},
    confirm: {"cool": 250},
    error: {"cool": 250},
    key: {"cool": 30, "jit": 0.06},
    key_del: {"cool": 30, "jit": 0.06},
    submit: {},
    flip: {"cool": 35},
    correct: {},
    present: {},
    absent: {},
    invalid: {"cool": 200},
    win: {"group": "fan", "big": 1},
    lose: {"group": "fan"},
    tick: {"cool": 120, "jit": 0.02},
    tick_urgent: {"cool": 120},
    time_up: {},
    daily_win: {"group": "fan", "big": 1},
    reward: {},
    coin: {"cool": 50, "jit": 0.03},
    coin_collect: {},
    buy: {},
    claim: {"group": "fan", "big": 1},
    reward_fly: {},
    clue_buy: {},
    clue_reveal: {},
    achievement: {"group": "fan", "big": 1},
    levelup: {"group": "fan", "big": 1},
    ai_start: {},
    ai_move: {"cool": 120},
    ai_solved: {},
    join: {},
    ready: {},
    battle_start: {"group": "fan", "big": 1},
    cd_tick: {"cool": 300},
    cd_go: {},
    opp_solved: {},
    round_end: {},
    victory: {"group": "fan", "big": 1},
    defeat: {"group": "fan", "big": 1},
    draw: {"group": "fan", "big": 1},
    results: {},
    series_start: {"group": "fan", "big": 1},
    round_start: {},
    round_win: {},
    round_draw: {},
    cd5_tick: {"cool": 300},
    cd5_last: {"cool": 300},
    series_win: {"group": "fan", "big": 1},
    series_reward: {"group": "fan", "big": 1},
    wheel_tick: {"cool": 22, "jit": 0.05},
    wheel_spin: {},
    wheel_slow: {},
    wheel_stop: {},
    wheel_win: {"group": "fan", "big": 1}
  };
  const MUSIC = {
    home: { len: 49.2308 },
    solo: { len: 60.0000 },
    battle: { len: 48.0000 }
  };
  const FIRST = ["tap", "key", "key_del", "flip", "correct", "present", "absent", "submit", "invalid", "win", "lose", "coin", "popup_open", "popup_close", "toggle_on", "toggle_off", "confirm", "error", "notify", "whoosh", "menu_open", "menu_close"];
  const cfg = () => { try { return settings || {}; } catch { return {}; } };             // settings is a global of app.js (not yet defined while this file loads)
  const musicOn = () => cfg().music !== false;
  const sfxOn = () => !cfg().mute;
  const vol = (v, d) => { v = typeof v === "number" && v >= 0 && v <= 1 ? v : d; return v * v; };   // a perceptual curve: the middle of the slider is a comfortable level

  let ctx = null, master = null, sfxBus = null, musBus = null, duck = null, unlocked = false, hidden = false;
  const buffers = new Map(), loading = new Map(), failed = new Map(), last = new Map(), voices = new Set(), groups = new Map();

  function getCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    try { ctx = new AC({ latencyHint: "interactive" }); } catch { try { ctx = new AC(); } catch { return null; } }
    master = ctx.createGain(); master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    duck = ctx.createGain(); duck.connect(master);
    musBus = ctx.createGain(); musBus.connect(duck);
    applyVolumes(true);
    ctx.onstatechange = () => { if (ctx.state === "running" && !hidden) { unlocked = true; decide(); } };
    return ctx;
  }
  function applyVolumes(now) {
    if (!ctx) return; const t = ctx.currentTime, k = now ? 0 : 0.04;
    sfxBus.gain.setTargetAtTime(sfxOn() ? vol(cfg().sfxVol, 0.8) : 0, t, k || 0.001);
    musBus.gain.setTargetAtTime(musicOn() ? vol(cfg().musicVol, 0.5) * 0.9 : 0, t, k || 0.001);
  }

  // ---------- loading ----------
  function decode(ab) { return new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); }); }
  function fetchBuf(path) {
    return fetch(path, { cache: "force-cache" }).then((r) => { if (!r.ok) throw new Error(path + " " + r.status); return r.arrayBuffer(); }).then(decode);
  }
  function load(name) {
    if (buffers.has(name)) return Promise.resolve(buffers.get(name));
    if (loading.has(name)) return loading.get(name);
    if (!getCtx() || (failed.get(name) || 0) > 2) return Promise.resolve(null);
    const p = fetchBuf(BASE + "sfx/" + name + ".mp3").then((b) => { buffers.set(name, b); loading.delete(name); return b; }).catch(() => { loading.delete(name); failed.set(name, (failed.get(name) || 0) + 1); return null; });
    loading.set(name, p); return p;
  }
  function preload() {
    const rest = Object.keys(SFX).filter((n) => !FIRST.includes(n)), queue = [...FIRST, ...rest];
    let i = 0; const worker = () => (i < queue.length ? load(queue[i++]).then(worker) : null);
    for (let k = 0; k < 4; k++) worker();
  }

  // ---------- sound effects ----------
  function stopVoice(v, fade) { try { const t = ctx.currentTime; v.g.gain.cancelScheduledValues(t); v.g.gain.setTargetAtTime(0, t, fade || 0.02); v.s.stop(t + (fade || 0.02) * 6); } catch {} }
  function stopAllSfx() { voices.forEach((v) => stopVoice(v, 0.015)); voices.clear(); groups.clear(); }
  function play(name, o) {
    o = o || {};
    if (!sfxOn()) return false; const def = SFX[name]; if (!def || !getCtx()) return false;
    const b = buffers.get(name); if (!b) { load(name); return false; }
    if (ctx.state !== "running") { if (unlocked && !hidden) ctx.resume(); return false; }
    const now = performance.now(), cool = o.cool != null ? o.cool : (def.cool != null ? def.cool : 45);
    if (now - (last.get(name) || 0) < cool) return false; last.set(name, now);              // no duplicate sounds from rapid taps or repeated renders
    if (voices.size > 18) { const oldest = voices.values().next().value; stopVoice(oldest, 0.01); voices.delete(oldest); }
    if (def.group) { const prev = groups.get(def.group); if (prev) { stopVoice(prev, 0.12); voices.delete(prev); } }   // only one celebration at a time
    const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b;
    let rate = o.rate || 1; if (def.jit) rate *= 1 + (Math.random() - 0.5) * 2 * def.jit; s.playbackRate.value = rate;
    g.gain.value = o.gain != null ? o.gain : 1; s.connect(g); g.connect(sfxBus);
    const v = { s, g }; voices.add(v); if (def.group) groups.set(def.group, v);
    s.onended = () => { voices.delete(v); if (groups.get(def.group) === v) groups.delete(def.group); try { g.disconnect(); } catch {} };
    s.start(ctx.currentTime + (o.delay || 0));
    if (def.big && musicOn()) duckMusic(Math.min(b.duration, 3.4) * 0.8);
    return true;
  }
  let duckTimer = 0;
  function duckMusic(sec) {                                                                     // celebrations sit on top of the music: it dips, then comes back
    if (!ctx || !duck) return; const t = ctx.currentTime; duck.gain.cancelScheduledValues(t); duck.gain.setTargetAtTime(0.3, t, 0.08);
    clearTimeout(duckTimer); duckTimer = setTimeout(() => { try { duck.gain.setTargetAtTime(1, ctx.currentTime, 0.45); } catch {} }, sec * 1000);
  }

  // ---------- background music ----------
  const M = { name: "", voice: null, token: 0 };
  const wanted = () => musicOn() && unlocked && !hidden && ctx && ctx.state === "running";
  function loadMusic(name) {
    const key = "music:" + name; if (buffers.has(key)) return Promise.resolve(buffers.get(key)); if (loading.has(key)) return loading.get(key);
    if (!getCtx() || (failed.get(key) || 0) > 2) return Promise.resolve(null);
    const p = fetchBuf(BASE + "music/" + name + ".mp3").then((b) => { buffers.set(key, b); loading.delete(key); return b; }).catch(() => { loading.delete(key); failed.set(key, (failed.get(key) || 0) + 1); return null; });
    loading.set(key, p); return p;
  }
  function endVoice(v, sec) {
    if (!v) return; try { const t = ctx.currentTime; v.g.gain.cancelScheduledValues(t); v.g.gain.setValueAtTime(v.g.gain.value, t); v.g.gain.linearRampToValueAtTime(0, t + sec); v.s.stop(t + sec + 0.05); } catch {}
    v.s.onended = () => { try { v.g.disconnect(); } catch {} };
  }
  function startVoice(name, buf) {
    const info = MUSIC[name]; let ls = 0, le = buf.duration;
    if (buf.duration - info.len > 0.012) { ls = 0.0251; le = ls + info.len; }                // a decoder that keeps the MP3 encoder delay: loop only the real music
    else le = Math.min(buf.duration, info.len);
    const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; s.loop = true; s.loopStart = ls; s.loopEnd = le;           // a sample-exact loop: no gap, the beat never slips
    const t = ctx.currentTime; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 1.6);
    s.connect(g); g.connect(musBus); s.start(t, ls); return { s, g, name };
  }
  function musicSet(name) {                                                                  // "" = silence
    const want = name && wanted() ? name : "";
    if (M.name === want) return;
    const tok = ++M.token, old = M.voice; M.voice = null; M.name = want;
    if (old) endVoice(old, musicOn() ? 1.4 : 0.25);                                          // the old track fades out while the new one fades in
    if (!want) return;
    loadMusic(want).then((buf) => { if (tok !== M.token || !buf || !wanted()) { if (tok === M.token) M.name = ""; return; } M.voice = startVoice(want, buf); });
  }
  function track() {                                                                          // which music suits what is on screen
    let scr = ""; try { scr = screen; } catch {}
    const battle = (window.BattleGame && BattleGame.isOn && BattleGame.isOn()) || (window.TeamGame && TeamGame.isOn && TeamGame.isOn()) || !!document.getElementById("az-att");
    if (scr === "game" && battle) return "battle";
    if (battle && scr !== "dashboard") return "battle";
    if (scr === "game") return "solo";
    return "home";
  }
  function decide() {
    if (!ctx || hidden) return;                                                              // in the background nothing changes: the music is paused in place and carries on when you come back
    applyVolumes();
    if (!wanted()) { if (M.voice) musicSet(""); return; }
    musicSet(track());
  }
  function prefetchMusic() { ["home", "solo", "battle"].forEach((n, i) => setTimeout(() => loadMusic(n), 2500 + i * 4000)); }

  // ---------- unlock (browsers only allow sound after a tap), background handling ----------
  function unlock() {
    const c = getCtx(); if (!c) return;
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}      // iPhone: play even with the silent switch on
    if (c.state !== "running") { const p = c.resume(); if (p && p.then) p.then(onRun, () => {}); } else onRun();
    try { const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch {}
  }
  function onRun() { if (ctx && ctx.state === "running") { unlocked = true; decide(); } }
  ["pointerdown", "touchstart", "touchend", "mousedown", "keydown", "click"].forEach((ev) => document.addEventListener(ev, () => { if (!ctx || ctx.state !== "running") unlock(); else if (!unlocked) onRun(); }, { capture: true, passive: true }));
  document.addEventListener("visibilitychange", () => {
    hidden = document.hidden; if (!ctx) return;
    if (hidden) { musBus.gain.setTargetAtTime(0, ctx.currentTime, 0.08); setTimeout(() => { if (document.hidden && ctx.state === "running") ctx.suspend().catch(() => {}); }, 400); }
    else { const p = ctx.resume(); (p && p.then ? p : Promise.resolve()).then(() => { applyVolumes(); decide(); }).catch(() => {}); }
  });
  window.addEventListener("pagehide", () => { try { if (ctx && ctx.state === "running") ctx.suspend(); } catch {} });

  // ---------- settings changed (called by app.js applySettings): applies immediately ----------
  function refresh() {
    if (!ctx) { if (musicOn() || sfxOn()) getCtx(); }
    if (!sfxOn()) stopAllSfx();                                                              // Sound Effects OFF: every effect stops now
    applyVolumes(); decide();                                                                // Background Music OFF: the music fades out and stops
  }

  // ---------- automatic sounds for things every screen shares ----------
  const quiet = () => !unlocked || performance.now() < 1800;
  document.addEventListener("click", (e) => {                                                // button taps
    if (quiet()) return; const t = e.target.closest && e.target.closest("button, [role=button], a[href], .card, .sp-card, [data-nav], summary"); if (!t || t.disabled) return;
    if (t.closest("[data-nosound], .sw, [data-sw-row], #keyboard, .key, .az-key, .bt-key, .tzg-key") || t.classList.contains("sw")) return;   // keys and switches have their own sounds
    play("tap");
  }, { capture: true, passive: true });
  const seenOpen = new Map();
  setInterval(() => {                                                                         // popups opening and closing (the shared dialogs)
    if (quiet()) return;
    ["dialog", "modal", "clue", "tutorial"].forEach((id) => {
      const el = document.getElementById(id); if (!el) return; const open = !el.classList.contains("hidden");
      if (seenOpen.has(id) && seenOpen.get(id) !== open) play(open ? "popup_open" : "popup_close");
      seenOpen.set(id, open);
    });
  }, 120);
  const SKIP_POP = /^(sr-pop|sr-fin|wh-win|iv-|bt-res|tzg-res|az-res)/, SKIP_CLS = /(^|\s)(sr-ov|iv-ov|ach-)/;
  const isPopup = (n) => n.nodeType === 1 && n.matches && n.matches("[role=dialog]") && !SKIP_POP.test(n.id || "") && !SKIP_CLS.test(typeof n.className === "string" ? n.className : "");
  const startBody = () => {                                                                   // popups that other screens add to / remove from the page
    try { new MutationObserver((muts) => { if (quiet()) return; for (const m of muts) { m.addedNodes.forEach((n) => { if (isPopup(n)) play("popup_open"); }); m.removedNodes.forEach((n) => { if (isPopup(n)) play("popup_close"); }); } }).observe(document.body, { childList: true }); } catch {}
  };
  if (document.body) startBody(); else document.addEventListener("DOMContentLoaded", startBody);

  // countdown digits ("3, 2, 1, GO"), the battle clock (last 10 seconds, time up) and the Series 5-second gap: read from the screen, once per change
  let lastCd = null, lastClock = null, lastSr = null, cdSeen = false;
  setInterval(() => {
    if (!unlocked) return;
    const cd = document.querySelector("#bt-cd b, #tzg-cd b, #az-cd b"), srn = document.getElementById("sr-n"), pop = document.getElementById("sr-pop");
    if (cd && !pop) { const n = parseInt(cd.textContent, 10); if (n !== lastCd && n >= 1 && n <= 5) { lastCd = n; cdSeen = true; play("cd_tick"); } }
    else if (!cd && cdSeen) { cdSeen = false; lastCd = null; if (!pop) { play("cd_go"); play("battle_start", { delay: 0.05 }); } }
    if (srn) { const n = parseInt(srn.textContent, 10); if (n !== lastSr && n >= 1) { lastSr = n; play(n === 1 ? "cd5_last" : "cd5_tick"); } } else lastSr = null;
    const tm = document.querySelector("#bt-tm b, #tzg-tm b");
    if (tm && !cd) {
      const m = /^(\d+):(\d\d)$/.exec((tm.textContent || "").trim());
      if (m) { const s = (+m[1]) * 60 + (+m[2]); if (lastClock !== null && s !== lastClock && lastClock === s + 1) { if (s > 0 && s <= 10) play(s <= 5 ? "tick_urgent" : "tick"); else if (s === 0) play("time_up"); } lastClock = s; }   // only a real countdown makes sounds (a round that ends early just jumps to 0:00)
    } else if (!tm) lastClock = null;
  }, 200);

  // ---------- rooms (Friend Zone / Team Zone): someone joins, I get ready, an opponent solves, the round ends ----------
  const R = { id: "", status: "", n: 0, ready: false, solved: new Set(), seen: false };
  function roomState(kind, st) {
    try {
      const r = st && st.room; if (!r) return; const players = st.players || [], me = players.find((p) => p.is_me);
      if (R.id !== r.id) { Object.assign(R, { id: r.id, status: "", n: 0, ready: false, solved: new Set(), seen: false }); }
      const st1 = r.status, n = players.length, lobby = st1 === "waiting" || st1 === "lobby";
      if (lobby) {
        if (!R.seen) play("join"); else if (n > R.n) play("join");
        const rd = !!(me && (me.ready || me.is_ready)); if (R.seen && rd && !R.ready) play("ready"); R.ready = rd;
      }
      if (st1 === "playing") players.forEach((p) => { const ps = p.status || p.player_status; if (!p.is_me && ps === "solved" && !R.solved.has(p.id || p.seat || p.username)) { R.solved.add(p.id || p.seat || p.username); if (!(me && (me.status || me.player_status) === "solved")) play("opp_solved"); } });
      if (R.status === "playing" && st1 === "finished" && !(window.Series && Series.inSeries && Series.inSeries(st))) play("round_end");
      R.status = st1; R.n = n; R.seen = true;
    } catch {}
  }
  let lastScreen = "";
  function screenChanged(name) {                                                              // a different screen opened
    if (quiet() || name === lastScreen) { lastScreen = name; return; } lastScreen = name; play("whoosh"); setTimeout(decide, 50);
  }

  // ---------- level-up, wherever a reward is paid (store.js) ----------
  function watchRewards() {
    try {
      const P = window.Player || (typeof Player !== "undefined" ? Player : null); if (!P || P.__audioWrapped) return; P.__audioWrapped = true;
      ["reward", "rewardBattle", "rewardAI", "rewardSeries"].forEach((fn) => { if (typeof P[fn] !== "function") return; const orig = P[fn]; P[fn] = function () { const r = orig.apply(this, arguments); if (r && r.levelUp) setTimeout(() => play("levelup"), 900); return r; }; });
    } catch {}
  }

  const api = { play, refresh, decide, roomState, screen: screenChanged, load, stopAll: stopAllSfx, duck: duckMusic, unlock,
    isUnlocked: () => unlocked, musicName: () => (M.voice ? M.voice.name : ""), has: (n) => !!SFX[n], _debug: () => ({ ctx, buffers, voices, M }) };
  window.WBAudio = api;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  function boot() { getCtx(); setTimeout(preload, 600); prefetchMusic(); setInterval(decide, 500); setTimeout(watchRewards, 800); }
})();