# Wordle Battle: project summary (version 1.5.0)

## What it is
A word-puzzle game: plain HTML/CSS/JS (no framework, no build step), installable as a PWA, hosted free on Vercel
(push to GitHub `main` = auto deploy), accounts and cloud save with Supabase. Theme: Steel Grey & Gold
(#1A1A1B bg, #29292B cards, #FACC15 gold, #51482D secondary, #FAFAF5 text; game feedback keeps green/yellow/grey).

## Folder map
- `index.html` all screens (welcome, signup, login, forgot, reset, verify, dashboard, game, shop, battle, leaderboard, profile) and popups
- `css/style.css` design tokens at the top (change colours there), layered sections below
- `js/app.js` game logic, dashboard, coins, hints, skips, results, daily popup | `js/store.js` Player data (coins, XP, hints, skips, rewards)
- `js/auth.js` Supabase auth, guest mode, cloud sync | `js/ns.js` storage namespaces | `js/tutorial.js` tutorial + in-game info popup
- `js/pwa.js` install + update flow | `sw.js` service worker | `manifest.webmanifest` | `js/version.js` (edit version) | `js/build.js` (generated)
- `js/config.js` Supabase URL + anon key (YOUR copy has real values; the one in this zip is blank: do not overwrite yours)
- `js/vendor/supabase.js` official supabase-js v2.118.0 | `js/words.js` word lists
- `supabase/migrations/001_auth_profiles.sql`, `002_tutorial_flag.sql`, `supabase/SETUP.md`
- `scripts/stamp-version.js` (build hash + optional config from env vars; refuses service_role keys) | `vercel.json` | `terms.html`, `privacy.html` (starter text, add contact email)
- `dev-tests/` my automated tests (optional, not needed to run the app; see its README)

## Features built
Solo + Daily Challenge, hints (Reveal 50 coins, Remove Wrong 40, 2 free each), coins/XP/levels, win/loss stats and streaks,
results popup with rewards (each game rewarded once), dashboard (featured daily card, streak and coin pills, bottom nav),
PWA (install button, update bar "Update App", offline notice, safe caching: Supabase calls never cached),
auth (email sign up/log in, forgot/reset, email verify, Google button only if enabled, Play as Guest, guest progress migration, logout),
How to Play tutorial (auto on first open, saved per guest/account), popup when today's daily is already completed,
gameplay redesign (icon-only back + win score, coins, info icon, no Enter key, Submit with inline "Not a word!",
hint icons bottom-left, Skip Word bottom-right: 3 free then 30 coins, Solo only).

## Important rules and decisions
- Guest data uses the original `wb_*` localStorage keys; an account uses `wb_*_<userId>` (they never mix). Tokens are stored only by supabase-js.
- Solo progress (coins, hints, skips, stats) is a private save synced in `solo_saves`; it is NOT trusted for rankings or online rewards.
  Trusted values (profiles.coins/xp/etc.) can only be changed by server functions (to be built with online battles).
- Skip cost (30) is higher than a solo win reward (20), so skipping is never profitable. Skip is disabled in the Daily Challenge.
- Daily uses the player's local date. Physical Enter key still submits (desktop shortcut). Attempts counter exists only for screen readers.
- Releasing: bump `js/version.js`, push; Vercel runs `scripts/stamp-version.js`; installed apps show "Update App".

## Setup status / open items
- Supabase: project, run both SQL files, set Site URL + redirect URLs, email settings, optional Google, env vars `SUPABASE_URL` + `SUPABASE_ANON_KEY` in Vercel.
- OPEN: user saw "Can't reach the server" on signup. Check Project URL (https://xxxx.supabase.co, no trailing path), anon key, redeploy after setting env vars.
- Not built yet: online battles (random matchmaking, private rooms, server-validated results and rewards via Edge Functions), real leaderboard,
  achievements, shop themes, custom SMTP for emails, fill the contact placeholder in terms/privacy.
- Never use the service_role key in the frontend.

## Testing notes
- jsdom tests (dev-tests/t*.js) plus real headless Chromium (npm i puppeteer-core @sparticuz/chromium): layout at 9 screen sizes, contrast audit of every screen in both themes, screenshots.
- Two old tests (t2 "answer revealed after loss", t3 "confetti on win") are known-stale expectations, not app bugs.
- A bug found late: old `.big` rule made `.primary.big` button text gold-on-gold (fixed in 1.5.0).
- Not verified on real hardware: install/update on an Android phone, real Supabase emails/Google, touch feel.

## How the user likes to work
Easy step-by-step instructions, only changed/new files with their folders (zip only when asked), full specs given in one message, results tested before delivery.
