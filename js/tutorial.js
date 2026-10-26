// "How to Play" tutorial: animated step-by-step popup.
// Shown automatically on the dashboard until it is finished or skipped, and can be reopened any time.
// Status is saved on this device (per guest/account) and, for signed-in players, in Supabase (see auth.js).
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const root = $("#tutorial"); if (!root) return;
  const slides = $$("#tutorial .slide"), N = slides.length, dotsBox = $("#tut-dots");
  let idx = 0, timers = [], touchX = null, checked = false;
  const reduced = () => document.documentElement.dataset.motion === "reduced";
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const stopAnim = () => { timers.forEach(clearTimeout); timers = []; };
  const flagKey = () => wbKey("tutorial");
  const isDone = () => localStorage.getItem(flagKey()) === "1";
  const markDone = () => { localStorage.setItem(flagKey(), "1"); if (window.Auth && Auth.setTutorialDone) Auth.setTutorialDone(); };
  const isOpen = () => !root.classList.contains("hidden");

  // ----- example tiles (same look as the real board) -----
  $$("[data-row]").forEach((r) => { for (let i = 0; i < 5; i++) { const t = document.createElement("div"); t.className = "tile"; r.append(t); } });
  const row = (id) => $("#" + id), tilesOf = (r) => [...r.children];
  const clear = (r) => { r.classList.remove("win"); tilesOf(r).forEach((t) => { t.textContent = ""; t.className = "tile"; }); };
  const setWord = (r, w) => tilesOf(r).forEach((t, i) => { t.textContent = w[i] || ""; t.classList.toggle("filled", !!w[i]); });
  const paint = (r, states) => states.forEach((s, i) => { if (s) { const t = tilesOf(r)[i]; t.classList.remove("filled"); t.classList.add(s); } });
  const type = (r, w, at, step = 130) => { [...w].forEach((c, i) => later(() => { const t = tilesOf(r)[i]; t.textContent = c; t.classList.add("filled"); }, at + i * step)); return at + w.length * step; };
  const flip = (r, states, at, step = 260) => { states.forEach((s, i) => { if (s) later(() => { const t = tilesOf(r)[i]; t.classList.add("flip"); later(() => { t.classList.remove("filled"); t.classList.add(s); }, 270); }, at + i * step); }); return at + states.length * step + 400; };
  const C = "correct", P = "present", A = "absent";

  // ----- what each slide shows (final = instant version used for reduced motion) -----
  const EX = [["ex1", "WEARY", [C]], ["ex2", "PILLS", [null, P]], ["ex3", "VAGUE", [null, null, null, A]]];
  const G1 = [A, C, C, A, P], G2 = [C, C, C, C, C];
  const cap = (t) => { $("#tut-cap").textContent = t; };
  const CAP0 = "Guess 1: TRAIN. R and A are green, N is yellow.", CAP1 = "Guess 2: CRANE. Every letter is green. You win!";
  const reset = (i) => {
    if (i === 0) { clear(row("g1a")); clear(row("g1b")); clear(row("g1c")); }
    if (i === 1) EX.forEach(([id, w]) => { clear(row(id)); setWord(row(id), w); });
    if (i === 2) { clear(row("g3a")); clear(row("g3b")); cap(""); }
  };
  const final = (i) => {
    if (i === 0) setWord(row("g1a"), "HELLO");
    if (i === 1) EX.forEach(([id, w, st]) => { setWord(row(id), w); paint(row(id), st); });
    if (i === 2) { setWord(row("g3a"), "TRAIN"); paint(row("g3a"), G1); setWord(row("g3b"), "CRANE"); paint(row("g3b"), G2); row("g3b").classList.add("win"); cap(CAP1); }
  };
  const animate = (i) => {
    if (i === 0) type(row("g1a"), "HELLO", 500);
    if (i === 1) EX.forEach(([id, , st], k) => flip(row(id), st, 500 + k * 1100));
    if (i === 2) {
      let t = type(row("g3a"), "TRAIN", 400); later(() => cap(CAP0), t);
      t = flip(row("g3a"), G1, t + 100); t = type(row("g3b"), "CRANE", t + 500);
      t = flip(row("g3b"), G2, t + 100); later(() => { row("g3b").classList.add("win"); cap(CAP1); }, t);
    }
  };
  function play(i) { stopAnim(); reset(i); if (i > 2) return; reduced() ? final(i) : animate(i); }

  $("#tut-h1").textContent = `2 free, then ${HINTS.reveal.cost} 🪙`; $("#tut-h2").textContent = `2 free, then ${HINTS.remove.cost} 🪙`; // real prices from the game

  // ----- navigation -----
  dotsBox.innerHTML = slides.map((_, i) => `<button type="button" aria-label="Go to step ${i + 1}" data-dot="${i}"><i></i></button>`).join("");
  function go(n, dir = 1) {
    idx = Math.max(0, Math.min(N - 1, n)); root.classList.toggle("back", dir < 0);
    slides.forEach((s, j) => { s.classList.toggle("on", j === idx); s.setAttribute("aria-hidden", j === idx ? "false" : "true"); });
    $("#tut-step").textContent = `Step ${idx + 1} of ${N}`;
    $$("#tut-dots button").forEach((b, j) => { b.classList.toggle("on", j === idx); b.setAttribute("aria-current", j === idx ? "step" : "false"); });
    $("#tut-prev").disabled = idx === 0;
    $("#tut-next").classList.toggle("hidden", idx === N - 1); $("#tut-go").classList.toggle("hidden", idx !== N - 1);
    $("#tut-skip").classList.toggle("hidden", idx === N - 1);
    play(idx);
  }
  function open() {
    root.classList.remove("hidden"); document.body.classList.add("modal-open"); go(0);
    (reduced() ? $("#tut-next") : $("#tut-next")).focus();
  }
  function close() { stopAnim(); root.classList.add("hidden"); document.body.classList.remove("modal-open"); }
  const finish = () => { markDone(); close(); };
  $("#tut-next").onclick = () => go(idx + 1, 1);
  $("#tut-prev").onclick = () => go(idx - 1, -1);
  $("#tut-skip").onclick = finish;
  $("#tut-go").onclick = () => { finish(); if (typeof openGame === "function") openGame("practice"); };
  dotsBox.addEventListener("click", (e) => { const b = e.target.closest("[data-dot]"); if (b) go(+b.dataset.dot, +b.dataset.dot >= idx ? 1 : -1); });
  document.addEventListener("click", (e) => { if (e.target.closest("[data-howto]")) open(); });
  document.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "ArrowRight") go(idx + 1, 1); else if (e.key === "ArrowLeft") go(idx - 1, -1); else if (e.key === "Escape") finish();
  });
  const body = $(".tut-body");
  body.addEventListener("touchstart", (e) => { touchX = e.changedTouches[0].clientX; }, { passive: true });
  body.addEventListener("touchend", (e) => { if (touchX === null) return; const dx = e.changedTouches[0].clientX - touchX; touchX = null; if (Math.abs(dx) > 50) go(idx + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1); }, { passive: true });

  // ----- automatic first-time display -----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function maybeAutoShow() { // called each time the dashboard is shown; acts once per page load
    if (checked) return; checked = true;
    if (window.Auth && Auth.whenReady) { try { await Auth.whenReady(); } catch {} } // learn the account's saved status first
    if (isDone() || isOpen()) return;
    for (let n = 0; n < 120 && !$("#dialog").classList.contains("hidden"); n++) await sleep(500); // let any confirm dialog finish first
    if (screen !== "dashboard") { checked = false; return; }  // player already moved on: try again next time they reach the dashboard
    open();
  }
  // ----- compact "How to Play" popup opened from the game screen (info icon) -----
  const info = $("#info");
  const IX = [["ix1", "WEARY", [C]], ["ix2", "PILLS", [null, P]], ["ix3", "VAGUE", [null, null, null, A]]];
  const infoOpen = () => !info.classList.contains("hidden");
  function openInfo() {
    info.classList.remove("hidden"); document.body.classList.add("modal-open"); stopAnim();
    IX.forEach(([id, w, st], k) => { clear(row(id)); setWord(row(id), w); if (reduced()) paint(row(id), st); else flip(row(id), st, 500 + k * 1000); });
    $("#info-ok").focus();
  }
  function closeInfo() { stopAnim(); info.classList.add("hidden"); document.body.classList.remove("modal-open"); }
  $("#info-close").onclick = closeInfo; $("#info-ok").onclick = closeInfo;
  info.querySelector("[data-howto]").addEventListener("click", closeInfo); // the document-level handler then opens the full tutorial
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && infoOpen()) closeInfo(); });
  window.Tutorial = { open, openInfo, maybeAutoShow, isDone };
})();