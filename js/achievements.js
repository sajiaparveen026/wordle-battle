// Achievements: 25 badges (Bronze, Silver, Gold) shown as a carousel on the Profile.
// Every condition is read from real game data (Player.data + the daily `stats`). An unlock is written ONCE to Player.data.ach { id: ISO date }
// and never removed, so it can't repeat. That record lives in the same save as coins/XP, so it follows guest progress, a signed-in account
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
    ["no-help-needed", "No Help Needed", "Win a game without using any hints.", "bronze", "Win 1 game without using a hint.", (p) => p.noHintWins, 1],
    ["rising-star", "Rising Star", "Reach Level 5.", "bronze", "Reach Level 5.", lvl, 5],

    ["unstoppable", "Unstoppable", "Win 5 games in a row.", "silver", "Achieve a 5-game consecutive win streak.", (p) => p.bestStreak, 5],
    ["word-wizard", "Word Wizard", "Win 10 games.", "silver", "Win 10 games cumulatively.", (p) => p.wins, 10],
    ["week-warrior", "Week Warrior", "Complete Daily Challenges 7 days in a row.", "silver", "Maintain a 7-day Daily Challenge streak.", dailyBest, 7],
    ["first-clash", "First Clash", "Finish your first online battle.", "silver", "Complete 1 online battle.", (p) => p.battles.played, 1],
    ["treasure-hunter", "Treasure Hunter", "Earn 1,000 coins in total.", "silver", "Earn 1,000 coins cumulatively.", (p) => p.earned, 1000],
    ["sharp-mind", "Sharp Mind", "Win a game in 3 guesses or fewer.", "silver", "Win 1 game in a maximum of 3 guesses.", (p) => (p.bestGuesses && p.bestGuesses <= 3 ? 1 : 0), 1],
    ["word-expert", "Word Expert", "Win 50 games.", "silver", "Win 50 games cumulatively.", (p) => p.wins, 50],
    ["elite-player", "Elite Player", "Reach Level 25.", "silver", "Reach Level 25.", lvl, 25],
    ["smart-solver", "Smart Solver", "Win 10 games without using hints.", "silver", "Win 10 separate games without using hints.", (p) => p.noHintWins, 10],

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
  let checking = false, toastQ = 0;
  // Unlocks everything whose condition is met and isn't unlocked yet. announce:false = quiet (page load, loading a save).
  function check(opts) {
    if (checking) return []; checking = true;
    try {
      const p = Player.data, fresh = status().filter((a) => !a.unlocked && a.met);
      if (!fresh.length) return [];
      const now = new Date().toISOString(); fresh.forEach((a) => (p.ach[a.id] = now));   // each id is written once; already unlocked ones are never touched
      Player.save();                                                                        // also queues the cloud save for signed-in players
      if (!(opts && opts.announce === false)) {
        const say = (text, i) => setTimeout(() => { toast(text, "success", 3200); if (typeof sfx !== "undefined" && sfx.coin) sfx.coin(); }, 900 + (toastQ + i) * 1400);
        if (fresh.length > 3) say(`🏅 ${fresh.length} achievements unlocked! See your Profile`, 0), toastQ += 1;   // many at once (e.g. an older save): one summary
        else fresh.forEach((a, i) => say(`🏅 Achievement unlocked: ${a.name}`, i)), toastQ += fresh.length;
        setTimeout(() => (toastQ = 0), 900 + (toastQ + 1) * 1400 + 3500);
      }
      render(); return fresh;
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
  window.Achievements = { list: () => status(), check, render, open, close, total: LIST.length };
})();