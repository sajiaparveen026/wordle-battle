// Achievements: 25 badges (Bronze, Silver, Gold) shown as a carousel on the Profile.
// Every condition is read from real game data (Player.data + the daily `stats`). An unlock is written ONCE to Player.data.ach { id: ISO date }
// and never removed, so it can't repeat. New unlocks are celebrated with a full-screen card (queued one by one, see "Celebration card" below). That record lives in the same save as coins/XP, so it follows guest progress, a signed-in account
// (cloud save), and the "move guest progress" step. Online-battle achievements read Player.data.battles, which stays 0 until online play exists.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  // The carousel brings its own styles, so it looks and scrolls the same no matter which copy of css/style.css is loaded or cached.
  // (Colours still come from the theme variables defined in css/style.css, so Dark / Light keep working.)
  const CSS = `
/* ===== Achievements (Profile carousel + detail popup): metallic Bronze / Silver / Gold medals ===== */
.ach-count{flex:none;padding:4px 12px;border-radius:999px;background:var(--panel-2);border:1px solid var(--line);font-size:.78rem;font-weight:800;color:var(--gold);white-space:nowrap}
.ach-wrap{position:relative;margin:12px -14px -4px}
.ach-track{list-style:none;margin:0;padding:6px 14px 14px;display:flex;gap:12px;overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity;scroll-behavior:smooth;scroll-padding:0 14px;scrollbar-width:none;outline:none;cursor:grab}
.ach-track::-webkit-scrollbar{display:none}
.ach-track.dragging{cursor:grabbing;scroll-behavior:auto;scroll-snap-type:none;user-select:none}
.ach-track:focus-visible{box-shadow:inset 0 0 0 2px var(--gold-dim);border-radius:14px}
.ach-item{flex:none;width:148px;scroll-snap-align:start}   /* ~2.2 cards fit on a phone, so part of the next card always peeks in */
.ach-card{--c1:#f0b078;--c2:#a8652b;--glow:rgba(217,140,74,.45);position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;width:100%;height:100%;min-height:262px;padding:14px 10px 12px;border-radius:18px;text-align:center;color:var(--text);font:inherit;
  background:linear-gradient(165deg,color-mix(in srgb,var(--c1) 14%,var(--panel)),var(--panel) 62%);border:1px solid color-mix(in srgb,var(--c1) 55%,var(--line));
  box-shadow:0 6px 18px rgba(0,0,0,.28),0 0 16px var(--glow);transition:transform .18s,box-shadow .25s,border-color .25s}
.ach-card.tier-silver{--c1:#d4dbe6;--c2:#8d99a8;--glow:rgba(190,202,220,.4)}
.ach-card.tier-gold{--c1:#ffd24a;--c2:#c8960c;--glow:rgba(250,204,21,.5)}
.ach-card:hover{transform:translateY(-3px);box-shadow:0 10px 24px rgba(0,0,0,.34),0 0 24px var(--glow)}
.ach-card:active{transform:scale(.98)}
.ach-card.is-off{background:var(--panel);border-color:var(--line);box-shadow:none}
.ach-card.is-off:hover{box-shadow:0 4px 12px rgba(0,0,0,.2);border-color:var(--gold-dim)}
.ach-card.is-off .ach-name,.ach-card.is-off .ach-desc{opacity:.7}
.ach-tier{font-size:.64rem;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:var(--c1);margin-top:2px}
.ach-card.is-off .ach-tier{color:var(--muted)}
.ach-name{font-size:.92rem;line-height:1.15}
.ach-desc{font-size:.74rem;line-height:1.3;color:var(--muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-height:3.9em}
.ach-state{margin-top:auto;display:inline-flex;align-items:center;gap:5px;font-size:.74rem;font-weight:800;color:var(--muted)}
.ach-state svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ach-state.on{color:var(--win)}
.ach-prog{margin-top:auto;width:100%;display:grid;gap:4px}
.ach-prog small{font-size:.72rem;font-weight:800;color:var(--muted);font-variant-numeric:tabular-nums}
.ach-bar{display:block;height:7px;border-radius:99px;background:var(--panel-2);border:1px solid var(--line);overflow:hidden}
.ach-bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--gold-dim),var(--gold));transition:width .5s ease}
.ach-prog.tall .ach-bar{height:10px}.ach-prog.tall small{font-size:.8rem}

/* the medal: metal rim + face + glyph + gloss, with a slow shine sweep once unlocked */
.ach-medal{position:relative;display:grid;place-items:center;width:84px;height:84px;border-radius:50%;overflow:hidden;filter:drop-shadow(0 4px 6px rgba(0,0,0,.45))}
.ach-medal svg:first-child{width:100%;height:100%;display:block}
.ach-medal.tier-bronze{color:#ffe6c9}.ach-medal.tier-silver{color:#ffffff}.ach-medal.tier-gold{color:#fff8d6}
.ach-glyph{stroke:currentColor;filter:drop-shadow(0 1px 1px rgba(0,0,0,.55))}
.ach-medal::after{content:"";position:absolute;inset:-20% -60%;pointer-events:none;background:linear-gradient(105deg,transparent 42%,rgba(255,255,255,.55) 50%,transparent 58%);transform:translateX(-80%);animation:achshine 4.5s ease-in-out infinite}
.ach-card:nth-child(3n) .ach-medal::after{animation-delay:1.1s}.ach-item:nth-child(3n+2) .ach-medal::after{animation-delay:2.2s}.ach-item:nth-child(3n) .ach-medal::after{animation-delay:3.1s}
@keyframes achshine{0%,55%{transform:translateX(-80%)}100%{transform:translateX(80%)}}
.ach-medal.is-locked{filter:grayscale(1) brightness(.62) contrast(.9) drop-shadow(0 2px 3px rgba(0,0,0,.3))}
.ach-medal.is-locked::after{display:none}
.ach-lock{position:absolute;right:2px;bottom:2px;width:30px;height:30px;padding:6px;border-radius:50%;background:var(--panel);border:1.5px solid var(--line);color:var(--text);fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;filter:none;box-shadow:0 2px 6px rgba(0,0,0,.5)}
.ach-medal.is-locked .ach-lock{filter:none}

/* desktop arrows (hidden on touch screens, where you just swipe) */
.ach-nav{display:none;position:absolute;top:42%;z-index:2;width:36px;height:36px;border-radius:50%;place-items:center;background:var(--panel);border:1px solid var(--gold-dim);color:var(--gold);box-shadow:0 4px 14px rgba(0,0,0,.4);transition:opacity .2s,transform .12s}
.ach-nav svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.ach-nav.prev{left:6px}.ach-nav.prev svg{transform:scaleX(-1)}.ach-nav.next{right:6px}
.ach-nav:hover:not(:disabled){transform:scale(1.08)}.ach-nav:disabled{opacity:0;pointer-events:none}
@media (hover:hover) and (pointer:fine){.ach-nav{display:grid}}

/* detail popup */
#ach-modal .card.ach-detail{max-width:360px;text-align:center;padding:26px 20px 20px;animation:popin .4s cubic-bezier(.2,.9,.3,1.15);border-color:var(--gold-dim)}
#ach-modal.tier-bronze .card{box-shadow:0 0 36px rgba(217,140,74,.35),var(--card-shadow,0 20px 50px rgba(0,0,0,.5))}
#ach-modal.tier-silver .card{box-shadow:0 0 36px rgba(190,202,220,.3),var(--card-shadow,0 20px 50px rgba(0,0,0,.5))}
#ach-modal.tier-gold .card{box-shadow:0 0 40px rgba(250,204,21,.38),var(--card-shadow,0 20px 50px rgba(0,0,0,.5))}
.ach-d-badge{display:grid;place-items:center;margin:2px 0 10px}
.ach-d-badge .ach-medal{width:132px;height:132px}.ach-d-badge .ach-lock{width:40px;height:40px;padding:9px;right:4px;bottom:4px}
#ach-modal .ach-tier{display:inline-block;padding:3px 12px;border-radius:999px;border:1px solid currentColor;margin:0 0 6px;font-size:.7rem}
#ach-modal.tier-bronze .ach-tier{color:#e09a5a}#ach-modal.tier-silver .ach-tier{color:#c8d0dc}#ach-modal.tier-gold .ach-tier{color:#ffcf3a}
[data-theme=light] #ach-modal.tier-bronze .ach-tier{color:#9a5a22}[data-theme=light] #ach-modal.tier-silver .ach-tier{color:#5f6b7a}[data-theme=light] #ach-modal.tier-gold .ach-tier{color:#8a6300}
[data-theme=light] .ach-card .ach-tier{color:color-mix(in srgb,var(--c2) 85%,#000)}
#ach-modal h2{margin:4px 0 6px;font-size:1.5rem}
.ach-d-desc{margin:0 0 12px;color:var(--text);font-size:.95rem;line-height:1.4}
.ach-d-req{display:grid;gap:2px;margin:0 0 12px;padding:10px 12px;border-radius:14px;background:var(--panel-2);border:1px solid var(--line)}
.ach-d-req small{color:var(--muted);font-size:.7rem;font-weight:800;letter-spacing:1px;text-transform:uppercase}.ach-d-req b{font-size:.92rem}
#ach-d-prog{margin:0 0 10px}#ach-d-prog:empty{display:none}
.ach-d-state{margin:0 0 14px;font-weight:800;color:var(--muted)}.ach-d-state.on{color:var(--win)}
@media (max-width:380px){.ach-item{width:140px}}
html[data-motion=reduced] .ach-medal::after{animation:none!important;display:none}
@media (prefers-reduced-motion:reduce){.ach-medal::after{animation:none!important;display:none}}
`;
  if (!document.getElementById("ach-css")) { const st = document.createElement("style"); st.id = "ach-css"; st.textContent = CSS; document.head.append(st); }
  const lvl = () => Player.levelInfo().level;
  const games = (p) => p.wins + p.losses;
  const dailyBest = () => (typeof stats === "object" && stats ? stats.best || 0 : 0);        // best Daily Challenge streak (days)
  const dailyDone = (p) => Math.max(typeof stats === "object" && stats ? stats.played || 0 : 0, p.history.filter((h) => h.mode === "daily").length);

  // id, name, description, tier, requirement text, value(p) and target (target 1 = a one-off goal, no progress bar)
  const LIST = [
    ["first-victory", "First Victory", "Win your first game.", "bronze", "Win 1 game.", (p) => p.wins, 1],
    ["word-explorer", "Word Explorer", "Play 5 games across different game sessions.", "bronze", "Play 5 games in separate sessions.", (p) => p.sessionsPlayed, 5],
    ["getting-serious", "Getting Serious", "Play 10 games.", "bronze", "Complete 10 games.", games, 10],
    ["coin-collector", "Coin Collector", "Earn 100 coins in total.", "bronze", "Earn 100 coins cumulatively.", (p) => p.earned, 100],
    ["on-fire", "On Fire", "Win 3 games in a row.", "bronze", "Achieve a 3-game consecutive win streak.", (p) => p.bestStreak, 3],
    ["daily-starter", "Daily Starter", "Complete your first Daily Challenge.", "bronze", "Complete 1 Daily Challenge.", dailyDone, 1],
    ["no-help-needed", "No Help Needed", "Win a game without using any clues.", "bronze", "Win 1 game without using a clue.", (p) => p.noHintWins, 1],
    ["rising-star", "Rising Star", "Reach Level 5.", "bronze", "Reach Level 5.", lvl, 5],

    ["unstoppable", "Unstoppable", "Win 5 games in a row.", "silver", "Achieve a 5-game consecutive win streak.", (p) => p.bestStreak, 5],
    ["word-wizard", "Word Wizard", "Win 10 games.", "silver", "Win 10 games cumulatively.", (p) => p.wins, 10],
    ["week-warrior", "Week Warrior", "Complete Daily Challenges 7 days in a row.", "silver", "Maintain a 7-day Daily Challenge streak.", dailyBest, 7],
    ["first-clash", "First Clash", "Finish your first online battle.", "silver", "Complete 1 online battle.", (p) => p.battles.played, 1],
    ["treasure-hunter", "Treasure Hunter", "Earn 1,000 coins in total.", "silver", "Earn 1,000 coins cumulatively.", (p) => p.earned, 1000],
    ["sharp-mind", "Sharp Mind", "Win a game in 3 guesses or fewer.", "silver", "Win 1 game in a maximum of 3 guesses.", (p) => (p.bestGuesses && p.bestGuesses <= 3 ? 1 : 0), 1],
    ["word-expert", "Word Expert", "Win 50 games.", "silver", "Win 50 games cumulatively.", (p) => p.wins, 50],
    ["elite-player", "Elite Player", "Reach Level 25.", "silver", "Reach Level 25.", lvl, 25],
    ["smart-solver", "Smart Solver", "Win 10 games without using clues.", "silver", "Win 10 separate games without using clues.", (p) => p.noHintWins, 10],

    ["winning-machine", "Winning Machine", "Win 10 games in a row.", "gold", "Achieve a 10-game consecutive win streak.", (p) => p.bestStreak, 10],
    ["arena-champion", "Arena Champion", "Win 50 online battles.", "gold", "Win 50 online battles cumulatively.", (p) => p.battles.won, 50],
    ["monthly-master", "Monthly Master", "Complete Daily Challenges 30 days in a row.", "gold", "Maintain a 30-day Daily Challenge streak.", dailyBest, 30],
    ["vocabulary-pro", "Vocabulary Pro", "Win 100 games.", "gold", "Win 100 games cumulatively.", (p) => p.wins, 100],
    ["legendary-status", "Legendary Status", "Reach Level 50.", "gold", "Reach Level 50.", lvl, 50],
    ["first-try-best-try", "First Try, Best Try", "Guess the correct word on your first attempt.", "gold", "Win a game with the first guess.", (p) => (p.dist && p.dist[0] > 0 ? 1 : 0), 1],
    ["battle-legend", "Battle Legend", "Win 100 online battles.", "gold", "Win 100 online battles cumulatively.", (p) => p.battles.won, 100],
    ["wordle-legend", "Wordle Legend", "Win 500 games in Wordle Battle.", "gold", "Win 500 games cumulatively.", (p) => p.wins, 500]
  ].map(([id, name, desc, tier, req, value, target], i) => ({ id, name, desc, tier, req, value, target, n: i + 1 }));
  const TIER = { bronze: "Bronze", silver: "Silver", gold: "Gold" };

  // One unique glyph per achievement (24x24 line icons), drawn in the middle of the metal medal.
  const GLYPH = {
    "first-victory": '<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3M12 13v4M9 20h6M10 17h4"/>',
    "word-explorer": '<circle cx="12" cy="12" r="8.5"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/>',
    "getting-serious": '<path d="M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12"/>',
    "coin-collector": '<path d="M5 7.5c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5-3.1 2.5-7 2.5-7-1.1-7-2.5zM5 7.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4M5 11.5v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4"/>',
    "on-fire": '<path d="M12 3c1 3.2 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4.2 0 2 1 3 2 3 0-3-1-6 1-8.8z"/>',
    "daily-starter": '<path d="M5 6h14v13H5zM5 10h14M8 4v3M16 4v3M9.4 14.6l2 2 3.4-3.6"/>',
    "no-help-needed": '<path d="M9 17h6M10 20h4M12 3a6 6 0 0 0-3.5 10.8c.6.5 1 1.2 1 2.2h5c0-1 .4-1.7 1-2.2A6 6 0 0 0 12 3z"/><path d="M4.5 4.5l15 15"/>',
    "rising-star": '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9L3.5 9.7l5.9-.8z"/>',
    "unstoppable": '<path d="M13 3L5.5 13.5h5.5L10 21l8-10.5h-5.5z"/>',
    "word-wizard": '<path d="M12 3l4.5 12h-9zM4 18.5c2.5 1.6 13.5 1.6 16 0M12 7.5v.01M10.5 11h3"/>',
    "week-warrior": '<path d="M12 3l7 2.8v5.6c0 4.4-2.8 7.6-7 9.6-4.2-2-7-5.2-7-9.6V5.8z"/><path d="M9.2 9.5h5.4L11.4 16"/>',
    "first-clash": '<path d="M4.5 4.5L17 17M19.5 4.5L7 17M14 19l5-5M10 19l-5-5"/>',
    "treasure-hunter": '<path d="M7 4h10l4 5-9 11L3 9z"/><path d="M3 9h18M9.5 4L8 9l4 11M14.5 4L16 9l-4 11"/>',
    "sharp-mind": '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20M8 10.5h5M10.5 8v5"/>',
    "word-expert": '<path d="M12 6.5C10.2 5.2 7.6 4.8 4.5 5v12.5c3.1-.2 5.7.2 7.5 1.5 1.8-1.3 4.4-1.7 7.5-1.5V5c-3.1-.2-5.7.2-7.5 1.5zM12 6.5V19"/>',
    "elite-player": '<circle cx="12" cy="14" r="5"/><path d="M8.5 3.5L10.6 10M15.5 3.5L13.4 10M12 11.8v4.4M10.4 14h3.2"/>',
    "smart-solver": '<path d="M9 4h3a2 2 0 1 1 4 0h3v5a2 2 0 1 0 0 4v5h-5a2 2 0 1 0-4 0H5v-5a2 2 0 1 0 0-4V4z" transform="translate(0 0) scale(1)"/>',
    "winning-machine": '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="6.6"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"/>',
    "arena-champion": '<path d="M6 21V4M6 5h11l-2.2 4L17 13H6"/>',
    "monthly-master": '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/><path d="M16 4v3M14.5 5.5h3"/>',
    "vocabulary-pro": '<path d="M2.5 9L12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11.2V16c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.8M21.5 9v6"/>',
    "legendary-status": '<path d="M4 17.5L3 8l5 4 4-7 4 7 5-4-1 9.5zM5 20.5h14"/>',
    "first-try-best-try": '<circle cx="11" cy="13" r="7.5"/><circle cx="11" cy="13" r="3.6"/><path d="M12.8 11.2L19.5 4.5M16 4.5h3.5V8"/>',
    "battle-legend": '<path d="M12 3l7 2.8v5.6c0 4.4-2.8 7.6-7 9.6-4.2-2-7-5.2-7-9.6V5.8z"/><path d="M9 9l6 6M15 9l-6 6"/>',
    "wordle-legend": '<path d="M5.5 10l2.3 8L12 12l4.2 6 2.3-8"/><path d="M12 3l.9 1.9 2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1L9 5.2l2.1-.3z"/>'
  };

  // ---------- engine ----------
  const status = () => { const p = Player.data; return LIST.map((a) => { const unlocked = !!p.ach[a.id], cur = Math.max(0, Math.floor(Number(a.value(p)) || 0)); return { ...a, unlocked, at: p.ach[a.id] || null, cur: unlocked ? a.target : Math.min(cur, a.target), met: cur >= a.target }; }); };
  let checking = false;
  // Unlocks everything whose condition is met and isn't unlocked yet. announce:false = quiet (page load, loading a save).
  function check(opts) {
    if (checking) return []; checking = true;
    try {
      const p = Player.data, fresh = status().filter((a) => !a.unlocked && a.met);
      if (!fresh.length) return [];
      const now = new Date().toISOString(); fresh.forEach((a) => (p.ach[a.id] = now));   // each id is written once; already unlocked ones are never touched
      Player.save();                                                                        // also queues the cloud save for signed-in players
      render();
      if (!(opts && opts.announce === false)) enqueue(fresh);   // celebrate each new unlock once, one card at a time
      return fresh;
    } finally { checking = false; }
  }

  // ---------- badge art ----------
  const defs = () => `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
    ${[["bronze", "#ffd2a1", "#d98c4a", "#8a4a1b", "#f0b078", "#a8652b", "#5a3014"], ["silver", "#ffffff", "#c4ccd8", "#7c8794", "#eef2f7", "#9aa5b4", "#515a67"], ["gold", "#fff6b8", "#f7c82a", "#a9780a", "#ffe58a", "#d3a21a", "#74530a"]]
      .map(([t, a, b, c, d, f1, f2]) => `<linearGradient id="ach-rim-${t}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".32" stop-color="${b}"/><stop offset=".62" stop-color="${c}"/><stop offset="1" stop-color="${d}"/></linearGradient>
      <linearGradient id="ach-face-${t}" x1=".1" y1="0" x2=".9" y2="1"><stop offset="0" stop-color="${f1}"/><stop offset="1" stop-color="${f2}"/></linearGradient>`).join("")}
    <linearGradient id="ach-gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".62"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs></svg>`;
  const badge = (a, locked) => `<span class="ach-medal tier-${a.tier}${locked ? " is-locked" : ""}"><svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <circle cx="50" cy="50" r="48" fill="url(#ach-rim-${a.tier})"/><circle cx="50" cy="50" r="42" fill="rgba(0,0,0,.28)"/>
    <circle cx="50" cy="50" r="40" fill="url(#ach-rim-${a.tier})" opacity=".9"/><circle cx="50" cy="50" r="36.5" fill="url(#ach-face-${a.tier})"/>
    <circle cx="50" cy="50" r="36.5" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1"/>
    <g class="ach-glyph" transform="translate(27 27) scale(1.9166)" fill="none" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${GLYPH[a.id]}</g>
    <path d="M16 40A36 36 0 0 1 62 14C44 20 26 30 16 40z" fill="url(#ach-gloss)"/></svg>${locked ? '<svg class="ach-lock" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#s-lock"/></svg>' : ""}</span>`;

  // ---------- Profile carousel ----------
  const day = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); };
  const num = (n) => n.toLocaleString();
  const progress = (a, tall) => a.target > 1 ? `<span class="ach-prog${tall ? " tall" : ""}"><span class="ach-bar"><i style="width:${Math.round((a.cur / a.target) * 100)}%"></i></span><small>${num(a.cur)} / ${num(a.target)}</small></span>` : "";
  function render() {
    const track = $("#ach-track"); if (!track) return;
    if (!$("#ach-defs")) { const d = document.createElement("div"); d.id = "ach-defs"; d.innerHTML = defs(); document.body.append(d); }
    const list = status(), done = list.filter((a) => a.unlocked).length;
    $("#ach-count").textContent = `${done}/${LIST.length} Unlocked`;
    track.innerHTML = list.map((a) => `<li class="ach-item"><button type="button" class="ach-card tier-${a.tier}${a.unlocked ? " is-on" : " is-off"}" data-ach="${a.id}" aria-label="${a.name}, ${TIER[a.tier]} plate, ${a.unlocked ? "unlocked" : "locked" + (a.target > 1 ? `, ${a.cur} of ${a.target}` : "")}">
      ${badge(a, !a.unlocked)}<span class="ach-tier">${TIER[a.tier]}</span><b class="ach-name">${a.name}</b><span class="ach-desc">${a.desc}</span>
      ${a.unlocked ? '<span class="ach-state on">✓ Unlocked</span>' : progress(a) || '<span class="ach-state"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#s-lock"/></svg>Locked</span>'}</button></li>`).join("");
    edges();
  }
  function edges() { const t = $("#ach-track"); if (!t) return; const max = t.scrollWidth - t.clientWidth - 2; $("#ach-prev").disabled = t.scrollLeft <= 2; $("#ach-next").disabled = t.scrollLeft >= max; }

  // ---------- detail popup ----------
  let opener = null;
  function open(id, from) {
    const a = status().find((x) => x.id === id); if (!a) return; opener = from || null;
    const m = $("#ach-modal"); m.className = `modal tier-${a.tier}`;
    $("#ach-d-badge").innerHTML = badge(a, !a.unlocked);
    $("#ach-d-tier").textContent = `${TIER[a.tier]} plate`; $("#ach-d-name").textContent = a.name; $("#ach-d-desc").textContent = a.desc; $("#ach-d-req").textContent = a.req;
    $("#ach-d-prog").innerHTML = progress(a, true);
    const st = $("#ach-d-state"); st.className = "ach-d-state" + (a.unlocked ? " on" : ""); st.textContent = a.unlocked ? `✓ Unlocked${a.at ? " on " + day(a.at) : ""}` : a.met ? "Almost there. Keep playing!" : "🔒 Locked";
    m.classList.remove("hidden"); if (typeof lockModal === "function") lockModal(true); $("#ach-close").focus();
  }
  function close() { const m = $("#ach-modal"); if (!m || m.classList.contains("hidden")) return; m.classList.add("hidden"); if (typeof lockModal === "function") lockModal(false); if (opener && document.contains(opener)) opener.focus({ preventScroll: true }); }

  // ---------- Celebration card ----------
  // Every newly unlocked achievement gets a centred card with an "Awesome!" button (no X, no tap-outside to close).
  // Several unlocks at once are queued Bronze -> Silver -> Gold and shown one by one ("ACHIEVEMENT UNLOCKED 1/3"). New unlocks that arrive
  // while a card is open join the end of the queue. Quiet checks (page load, cloud sync) never celebrate, so old badges don't pop up again.
  // The not-yet-acknowledged ids are kept in localStorage (wb_achq, per guest / account) so a refresh in the middle doesn't lose a card;
  // an id is removed the moment the player taps "Awesome!", so it is celebrated exactly once.
  const CEL_CSS = `
html.ach-celebrating,body.ach-celebrating{overflow:hidden}
.ach-cel{position:fixed;inset:0;z-index:60;display:flex;padding:16px;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:radial-gradient(ellipse at 50% 42%,rgba(0,0,0,.55),rgba(0,0,0,.84));-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:achcel-fade .3s ease both}
.ach-cel.hidden{display:none}
.ach-cel.out{animation:achcel-fadeout .28s ease both;pointer-events:none}
.ach-cel-card{--m1:#ffd2a1;--m2:#d98c4a;--m3:#8a4a1b;--m4:#f0b078;--glow:rgba(217,140,74,.5);--ink:#2a1405;--medal:clamp(116px,34vw,160px);
  position:relative;isolation:isolate;overflow:hidden;margin:auto;width:min(380px,100%);padding:22px 20px 20px;border-radius:26px;text-align:center;color:var(--text);border:3px solid transparent;
  background:linear-gradient(165deg,color-mix(in srgb,var(--m2) 18%,var(--panel)),var(--panel) 52%,color-mix(in srgb,var(--m3) 16%,var(--panel))) padding-box,linear-gradient(135deg,var(--m1),var(--m2) 30%,var(--m3) 55%,var(--m4) 78%,var(--m1)) border-box;
  box-shadow:0 26px 64px rgba(0,0,0,.6),0 0 46px var(--glow),inset 0 1px 0 rgba(255,255,255,.18)}
.ach-cel-card.tier-silver{--m1:#ffffff;--m2:#c4ccd8;--m3:#7c8794;--m4:#eef2f7;--glow:rgba(200,212,230,.45);--ink:#1d242e}
.ach-cel-card.tier-gold{--m1:#fff6b8;--m2:#f7c82a;--m3:#a9780a;--m4:#ffe58a;--glow:rgba(250,204,21,.6);--ink:#2d1d02;box-shadow:0 26px 70px rgba(0,0,0,.6),0 0 64px var(--glow),inset 0 1px 0 rgba(255,255,255,.25)}
.ach-cel-card>*{position:relative;z-index:1}
.ach-cel-card.in{animation:achcel-in .6s cubic-bezier(.2,1.1,.3,1) both}
.ach-cel-card.leaving{animation:achcel-out .22s ease-in both;pointer-events:none}
.ach-cel-shine{position:absolute!important;z-index:0!important;inset:-30% -70%;pointer-events:none;background:linear-gradient(105deg,transparent 43%,rgba(255,255,255,.2) 50%,transparent 57%);transform:translateX(-70%);animation:achcel-sheen 4.2s ease-in-out .9s infinite}
.ach-cel-card.tier-gold .ach-cel-shine{animation-duration:3.2s;background:linear-gradient(105deg,transparent 42%,rgba(255,244,190,.34) 50%,transparent 58%)}
.ach-cel-head{margin:2px 0 0;font-size:clamp(.8rem,3.7vw,1rem);font-weight:900;letter-spacing:2px;line-height:1.25;text-transform:uppercase;background:linear-gradient(90deg,var(--m3),var(--m2),var(--m3));background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
.ach-cel-card.tier-gold .ach-cel-head{animation:achcel-text 3s linear infinite}
[data-theme=dark] .ach-cel-head{background-image:linear-gradient(90deg,var(--m2),var(--m1),var(--m2))}
.ach-cel-stage{position:relative;display:grid;place-items:center;width:calc(var(--medal) * 1.6);height:calc(var(--medal) * 1.6);margin:2px auto 0;max-width:100%}
.ach-cel-aura{position:absolute;inset:6%;border-radius:50%;pointer-events:none;background:radial-gradient(circle,var(--glow) 0%,transparent 66%);animation:achcel-aura 2.6s ease-in-out infinite}
.ach-cel-rays{position:absolute;inset:-4%;border-radius:50%;pointer-events:none;opacity:0;background:repeating-conic-gradient(from 0deg,color-mix(in srgb,var(--m2) 60%,transparent) 0 7deg,transparent 7deg 22deg);-webkit-mask-image:radial-gradient(circle,#000 18%,transparent 68%);mask-image:radial-gradient(circle,#000 18%,transparent 68%);animation:achcel-spin 26s linear infinite}
.ach-cel-card.tier-silver .ach-cel-rays{opacity:.22}.ach-cel-card.tier-gold .ach-cel-rays{opacity:.55}
.ach-cel .ach-medal{width:var(--medal);height:var(--medal);animation:achcel-reveal .95s cubic-bezier(.2,1.1,.3,1) .22s both,achcel-breathe 3.4s ease-in-out 1.4s infinite}
.ach-cel .ach-medal::after{animation-duration:2.8s;animation-delay:1s}
.ach-cel-flash{position:absolute;inset:14%;border-radius:50%;pointer-events:none;background:radial-gradient(circle,#fff 0%,rgba(255,255,255,0) 68%);opacity:0;animation:achcel-flash .8s ease-out .3s both}
.ach-ring{position:absolute;inset:18%;border-radius:50%;pointer-events:none;border:2px solid var(--m2);opacity:0;animation:achcel-ring 1.1s ease-out .4s both}
.ach-ring.r2{animation-delay:.62s;border-color:var(--m1)}
.ach-sp{position:absolute;left:50%;top:50%;width:calc(14px * var(--s,1));height:calc(14px * var(--s,1));margin:calc(-7px * var(--s,1)) 0 0 calc(-7px * var(--s,1));pointer-events:none;opacity:0;background:linear-gradient(135deg,#fff,var(--m1) 45%,var(--m2));clip-path:polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%)}
.ach-sp.burst{animation:achcel-burst 1.15s cubic-bezier(.15,.7,.3,1) var(--d,.3s) both}
.ach-sp.tw{left:var(--l);top:var(--t);margin:calc(-7px * var(--s,1)) 0 0 calc(-7px * var(--s,1));animation:achcel-twinkle 2.4s ease-in-out var(--d,1s) infinite}
.ach-cel-tier{display:inline-block;margin:6px 0 8px;padding:5px 16px;border-radius:999px;font-size:.72rem;font-weight:900;letter-spacing:1.6px;text-transform:uppercase;color:var(--ink);background:linear-gradient(135deg,var(--m1),var(--m2) 45%,var(--m3));border:1px solid color-mix(in srgb,var(--m1) 70%,transparent);box-shadow:0 2px 10px var(--glow),inset 0 1px 0 rgba(255,255,255,.55)}
.ach-cel-name{margin:0 0 6px;font-size:clamp(1.3rem,6vw,1.65rem);line-height:1.15;color:var(--text)}
.ach-cel-desc{margin:0 auto;max-width:30ch;color:var(--muted);font-size:.95rem;line-height:1.4}
.ach-cel-card .ach-cel-btn{display:block;flex:none;width:min(100%,260px);margin:20px auto 0;min-height:50px;font-size:1.06rem;letter-spacing:.3px;position:relative;overflow:hidden}
.ach-cel-btn::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,.4) 50%,transparent 60%);transform:translateX(-120%);animation:achcel-btnshine 3.4s ease-in-out 1.6s infinite}
@keyframes achcel-fade{from{opacity:0}}
@keyframes achcel-fadeout{to{opacity:0}}
@keyframes achcel-in{from{opacity:0;transform:translateY(26px) scale(.82)}60%{opacity:1;transform:translateY(-4px) scale(1.025)}}
@keyframes achcel-out{to{opacity:0;transform:translateY(-10px) scale(.93)}}
@keyframes achcel-reveal{0%{opacity:0;transform:scale(.25) rotate(-28deg)}55%{opacity:1;transform:scale(1.14) rotate(5deg)}100%{opacity:1;transform:scale(1) rotate(0)}}
@keyframes achcel-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}
@keyframes achcel-aura{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:1;transform:scale(1.1)}}
@keyframes achcel-spin{to{transform:rotate(360deg)}}
@keyframes achcel-flash{0%{opacity:.95;transform:scale(.3)}100%{opacity:0;transform:scale(2.1)}}
@keyframes achcel-ring{0%{opacity:.9;transform:scale(.55)}100%{opacity:0;transform:scale(1.9)}}
@keyframes achcel-burst{0%{opacity:0;transform:translate(0,0) scale(0)}18%{opacity:1}100%{opacity:0;transform:translate(calc(var(--x) * var(--medal)),calc(var(--y) * var(--medal))) scale(1) rotate(90deg)}}
@keyframes achcel-twinkle{0%,100%{opacity:0;transform:scale(.2)}50%{opacity:.95;transform:scale(1)}}
@keyframes achcel-sheen{0%,45%{transform:translateX(-70%)}100%{transform:translateX(70%)}}
@keyframes achcel-text{to{background-position:-200% 0}}
@keyframes achcel-btnshine{0%,55%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
@media (max-width:380px){.ach-cel{padding:12px}.ach-cel-card{padding:18px 14px 16px;border-radius:22px}.ach-cel-desc{font-size:.9rem}}
@media (max-height:640px){.ach-cel-card{--medal:clamp(92px,26vh,124px);padding-top:16px}.ach-cel-card .ach-cel-btn{margin-top:14px;min-height:46px}}
/* Reduce Motion (Settings): the card still appears, but with no particles, rays, shine or movement */
html[data-motion=reduced] .ach-cel,html[data-motion=reduced] .ach-cel *,html[data-motion=reduced] .ach-cel *::before,html[data-motion=reduced] .ach-cel *::after{animation:none!important;transition:none!important}
html[data-motion=reduced] .ach-sp,html[data-motion=reduced] .ach-ring,html[data-motion=reduced] .ach-cel-flash,html[data-motion=reduced] .ach-cel-rays,html[data-motion=reduced] .ach-cel-shine,html[data-motion=reduced] .ach-cel-btn::after{display:none}
`;
  if (!document.getElementById("ach-cel-css")) { const st = document.createElement("style"); st.id = "ach-cel-css"; st.textContent = CEL_CSS; document.head.append(st); }

  const TIER_ORDER = { bronze: 0, silver: 1, gold: 2 };
  const cel = { q: [], cur: null, shown: 0, busy: false, el: null, opener: null, wait: 0 };
  const motionOff = () => typeof reduced === "function" && reduced();
  const ms = (n) => (motionOff() ? 0 : n);
  const QKEY = () => wbKey("achq");
  const readPending = () => { try { const a = JSON.parse(localStorage.getItem(QKEY())); return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; } catch { return []; } };
  const writePending = () => {   // the ids still waiting to be acknowledged (the open card + the queue); previews are never saved
    try { const ids = (cel.cur ? [cel.cur] : []).concat(cel.q).filter((a) => !a.preview).map((a) => a.id); if (ids.length) localStorage.setItem(QKEY(), JSON.stringify(ids)); else localStorage.removeItem(QKEY()); } catch {}
  };
  const ensureDefs = () => { if (!$("#ach-defs")) { const d = document.createElement("div"); d.id = "ach-defs"; d.innerHTML = defs(); document.body.append(d); } };
  const celOpen = () => !!cel.el && !cel.el.classList.contains("hidden");
  const total = () => cel.shown + (cel.cur ? 1 : 0) + cel.q.length;
  const headText = () => (total() > 1 ? `ACHIEVEMENT UNLOCKED ${cel.shown + 1}/${total()}` : "ACHIEVEMENT UNLOCKED!");
  // not while the splash screen or a sign-in screen is showing (matters when a saved, unacknowledged card is resumed after a refresh)
  const celReady = () => { const sp = document.getElementById("splash"); return (!sp || sp.classList.contains("out")) && !(typeof AUTH_SCREENS !== "undefined" && typeof screen === "string" && AUTH_SCREENS.includes(screen)); };

  function enqueue(items) {
    const have = new Set(cel.q.map((a) => a.id)); if (cel.cur) have.add(cel.cur.id);
    const add = items.filter((a) => a && !have.has(a.id) && (a.preview || Player.data.ach[a.id]) && (have.add(a.id), true));   // never the same achievement twice
    if (!add.length) return;
    cel.q.push(...add); cel.q.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.n - b.n);   // only the waiting part is sorted; cards already shown never move
    writePending();
    if (cel.cur) { const h = cel.el && cel.el.querySelector(".ach-cel-head"); if (h) h.textContent = headText(); }   // a new unlock joined: 1/2 becomes 1/3
    else { clearTimeout(cel.wait); cel.wait = setTimeout(pump, ms(350)); }                                            // a short beat so the win / flip animation isn't cut off
  }
  function pump() {
    if (cel.cur || cel.busy || !cel.q.length) return;
    if (!celReady()) { clearTimeout(cel.wait); cel.wait = setTimeout(pump, 400); return; }
    cel.cur = cel.q.shift(); showCard(true);
  }

  function sparkHTML(tier) {
    const nBurst = { bronze: 10, silver: 15, gold: 26 }[tier], nTw = { bronze: 5, silver: 7, gold: 11 }[tier], r = (a, b) => a + Math.random() * (b - a);
    let h = `<i class="ach-cel-flash"></i><i class="ach-ring"></i>${tier === "gold" ? '<i class="ach-ring r2"></i>' : ""}`;
    for (let i = 0; i < nBurst; i++) { const ang = (i / nBurst) * Math.PI * 2 + r(-0.25, 0.25), d = r(0.55, tier === "gold" ? 1.15 : 0.95); h += `<i class="ach-sp burst" style="--x:${(Math.cos(ang) * d).toFixed(2)};--y:${(Math.sin(ang) * d).toFixed(2)};--s:${r(0.5, 1.25).toFixed(2)};--d:${r(0.3, 0.7).toFixed(2)}s"></i>`; }
    for (let i = 0; i < nTw; i++) { const ang = (i / nTw) * Math.PI * 2 + r(-0.3, 0.3), d = r(36, 47); h += `<i class="ach-sp tw" style="--l:${(50 + Math.cos(ang) * d).toFixed(1)}%;--t:${(50 + Math.sin(ang) * d).toFixed(1)}%;--s:${r(0.5, 1).toFixed(2)};--d:${r(1.1, 3.6).toFixed(2)}s"></i>`; }
    return h;
  }
  function chime(tier) {   // uses the game's own sound (respects Mute) and vibration (respects the Vibration setting)
    if (typeof beep !== "function") return;
    const notes = { bronze: [660, 880], silver: [660, 880, 1175], gold: [523, 659, 784, 1046, 1318] }[tier];
    notes.forEach((f, i) => setTimeout(() => beep(f, tier === "gold" && i === notes.length - 1 ? 0.28 : 0.12), 250 + i * 110));
    if (typeof vibe === "function") vibe(tier === "gold" ? [40, 40, 40, 40, 110] : 30);
  }

  function showCard(first) {
    const a = cel.cur; ensureDefs();
    if (!cel.el) {
      const o = document.createElement("div"); o.className = "ach-cel hidden"; o.setAttribute("role", "alertdialog"); o.setAttribute("aria-modal", "true"); o.setAttribute("aria-labelledby", "ach-cel-head"); o.setAttribute("aria-describedby", "ach-cel-name ach-cel-desc");
      // no close button, and tapping the dim background does nothing; it just keeps the focus on "Awesome!"
      o.addEventListener("pointerdown", (e) => { if (!e.target.closest("button")) { e.preventDefault(); const b = o.querySelector(".ach-cel-btn"); if (b) b.focus({ preventScroll: true }); } });
      o.addEventListener("touchmove", (e) => { if (o.scrollHeight <= o.clientHeight) e.preventDefault(); }, { passive: false });
      document.body.append(o); cel.el = o;
    }
    const o = cel.el, old = o.querySelector(".ach-cel-card"); if (old) old.remove();
    const card = document.createElement("div"); card.className = `ach-cel-card tier-${a.tier}`;
    card.innerHTML = `<span class="ach-cel-shine" aria-hidden="true"></span>
      <h2 class="ach-cel-head" id="ach-cel-head">${headText()}</h2>
      <div class="ach-cel-stage" aria-hidden="true"><i class="ach-cel-aura"></i><i class="ach-cel-rays"></i>${sparkHTML(a.tier)}${badge(a, false)}</div>
      <span class="ach-cel-tier">${TIER[a.tier]} plate</span>
      <h3 class="ach-cel-name" id="ach-cel-name">${a.name}</h3>
      <p class="ach-cel-desc" id="ach-cel-desc">${a.desc}</p>
      <button type="button" class="primary big ach-cel-btn">Awesome!</button>`;
    o.append(card); void card.offsetWidth; card.classList.add("in");
    card.querySelector(".ach-cel-btn").onclick = nextCard;
    if (!celOpen()) {
      cel.opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      document.documentElement.classList.add("ach-celebrating"); document.body.classList.add("ach-celebrating");   // no scrolling behind the card
      o.classList.remove("hidden", "out");
    }
    card.querySelector(".ach-cel-btn").focus({ preventScroll: true });
    chime(a.tier); writePending();
  }
  function nextCard() {
    if (cel.busy || !cel.cur) return; cel.busy = true;
    cel.shown++; cel.cur = null; writePending();   // acknowledged: it will never be shown again
    const card = cel.el.querySelector(".ach-cel-card"); if (card) card.classList.add("leaving");
    setTimeout(() => { cel.busy = false; if (cel.q.length) { cel.cur = cel.q.shift(); showCard(false); } else closeCel(); }, ms(230));
  }
  function closeCel() {
    const o = cel.el; if (!o) return; cel.busy = true; o.classList.add("out");
    setTimeout(() => {
      o.classList.add("hidden"); o.classList.remove("out"); const c = o.querySelector(".ach-cel-card"); if (c) c.remove();
      document.documentElement.classList.remove("ach-celebrating"); document.body.classList.remove("ach-celebrating");
      cel.shown = 0; cel.busy = false; const op = cel.opener; cel.opener = null; if (op && document.contains(op)) { try { op.focus({ preventScroll: true }); } catch {} }
      pump();   // something may have been queued while the card was fading out
    }, ms(280));
  }
  // while a card is open the game must not react to the keyboard (no typing letters / Enter / Escape behind it); Enter or Space still press "Awesome!"
  window.addEventListener("keydown", (e) => {
    if (!celOpen()) return;
    e.stopPropagation();
    if (e.key === "Tab" || e.key === "Escape") { e.preventDefault(); const b = cel.el.querySelector(".ach-cel-btn"); if (b) b.focus({ preventScroll: true }); }
  }, true);

  // ---------- events ----------
  const track = $("#ach-track");
  if (track) {
    track.addEventListener("click", (e) => { if (dragged) { e.preventDefault(); return; } const c = e.target.closest("[data-ach]"); if (c) open(c.dataset.ach, c); });
    track.addEventListener("scroll", () => requestAnimationFrame(edges), { passive: true });
    const step = () => Math.max(160, Math.round(track.clientWidth * 0.8));
    $("#ach-prev").onclick = () => track.scrollBy({ left: -step(), behavior: "smooth" });
    $("#ach-next").onclick = () => track.scrollBy({ left: step(), behavior: "smooth" });
    // mouse: drag to scroll (touch already swipes natively)
    let down = false, sx = 0, sl = 0, dragged = false;
    track.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse" || e.button !== 0) return; down = true; dragged = false; sx = e.clientX; sl = track.scrollLeft; });
    addEventListener("pointermove", (e) => { if (!down) return; const dx = e.clientX - sx; if (Math.abs(dx) > 5) { dragged = true; track.classList.add("dragging"); } if (dragged) track.scrollLeft = sl - dx; });
    addEventListener("pointerup", () => { if (!down) return; down = false; track.classList.remove("dragging"); setTimeout(() => (dragged = false), 0); });
    addEventListener("resize", edges);
  }
  $("#ach-close").onclick = $("#ach-ok").onclick = close;
  $("#ach-modal").addEventListener("click", (e) => { if (e.target.id === "ach-modal") close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  // anything that changes the save (win, coins, level...) is checked a moment later; check() saves only when something unlocks, so this can't loop
  let t = null; addEventListener("wb:save", () => { clearTimeout(t); t = setTimeout(() => { if (!checking) check({ announce: true }); }, 250); });

  check({ announce: false });   // quiet scan on load: existing players get the badges they already earned without a pile of pop-ups
  // A card the player never acknowledged (page refreshed mid-celebration) comes back once; ids that are no longer unlocked are dropped.
  enqueue(readPending().map((id) => LIST.find((a) => a.id === id)).filter(Boolean));
  window.Achievements = { list: () => status(), check, render, open, close, total: LIST.length,
    // Try the celebration without unlocking anything or touching the save, e.g. in the browser console: Achievements.preview(["first-victory", "unstoppable", "winning-machine"])
    preview: (ids) => enqueue((ids || ["first-victory"]).map((id) => LIST.find((a) => a.id === id)).filter(Boolean).map((a) => ({ ...a, preview: true }))) };
})();