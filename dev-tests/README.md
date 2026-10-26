Optional developer tests (not part of the app). They expect the project at /home/claude/wordle-battle/ (edit the `root` path at the top of each file).
Setup: npm i jsdom puppeteer-core @sparticuz/chromium
- t2,t3,t5,t6,t7,t8,t9,t11,t12,t13,t14,t15: jsdom suites (game, PWA, auth with a mock Supabase client, tutorial, daily popup, game screen)
- theme.js: colour contrast + leftover-colour check | layout.js, audit.js, scenes.js: real-Chromium layout, contrast audit, screenshots (serve the project with `python3 -m http.server 8765`)
Known stale: t2 "answer revealed after loss", t3 "confetti on win".
