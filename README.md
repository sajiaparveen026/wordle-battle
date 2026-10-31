# Wordle Battle

Plain HTML/CSS/JS (no framework, no build tools needed to play). Installable as an app (PWA).

## Run locally
    python3 -m http.server 8000      # then open http://localhost:8000
Service workers run on `localhost`, so install/update behaviour can be tried locally too.

## Folder structure
    index.html, css/, js/       the game (js/pwa.js = install + update logic)
    sw.js                       service worker (caching + updates)
    manifest.webmanifest        app name, icons, colours, standalone mode
    icons/                      app icons
    js/version.js               release number (edit when you ship)
    js/build.js                 GENERATED build hash (scripts/stamp-version.js)
    scripts/stamp-version.js    stamps js/build.js
    vercel.json                 Vercel build + cache headers
    supabase/                   migrations/001_auth_profiles.sql + SETUP.md (accounts)
    js/auth.js, js/ns.js        accounts + storage namespaces; js/vendor/supabase.js = official client (v2.118.0)

## Accounts (Supabase)
Sign up / log in / password reset / Google / guest mode are built in. Follow **supabase/SETUP.md** once
(run the SQL, set redirect URLs, add your public keys). Until keys are added, the app runs in guest-only mode
and shows no sign-in buttons. Keys can come from Vercel environment variables `SUPABASE_URL` and
`SUPABASE_ANON_KEY` (public values only; the build refuses a service_role/secret key).

## Deploy for free on Vercel (recommended: free HTTPS, auto-deploy, correct cache headers)
1. Create a GitHub repo and push this folder:
       git init && git add . && git commit -m "Wordle Battle"
       git branch -M main
       git remote add origin https://github.com/<you>/<repo>.git
       git push -u origin main
2. vercel.com > sign up with GitHub > **Add New > Project** > import the repo.
3. Framework Preset: **Other**. Build Command and Output Directory come from `vercel.json`
   (`node scripts/stamp-version.js`, output `.`). Click **Deploy**.
4. Done. HTTPS is automatic. From now on **every push to `main` deploys to production**
   (other branches get preview URLs).

### Environment variables
None are required: this is a static site and nothing is built from secrets.
- Supabase **Project URL** and **anon** key go in `js/config.js`. They are public by design (Row Level
  Security protects the data).
- **Never** put the `service_role` key in this repo or on Vercel for the frontend. Secrets for Edge Functions
  are set inside Supabase (Edge Functions > Secrets).
- In Supabase > Authentication > URL Configuration, set **Site URL** to your Vercel URL and add it (and
  `http://localhost:8000`) to **Redirect URLs**. Google login and password resets need this.

### Shipping an update
Edit files, optionally bump `APP_VERSION` in `js/version.js`, commit, push to `main`.
Vercel runs `scripts/stamp-version.js`, which hashes every app file into `js/build.js`. Any change gives a
new hash, so `sw.js` changes, and installed apps detect it and show **Update App**.
(GitHub Pages also works, but it can't send no-cache headers for `sw.js`, and has no build step: run
`node scripts/stamp-version.js` before every commit.)

## Verify on a real phone (Android, Chrome)
1. Open your Vercel URL in Chrome. After a few seconds an **Install App** bar appears on the dashboard
   (also in Profile). Tap it, or use Chrome menu > Install app. It opens with no browser bars.
2. Check offline: turn on airplane mode, open the app. Solo play works; a yellow offline notice shows.
3. Check updates: change something visible (e.g. a title), commit, push, wait for the Vercel deploy to finish.
   Open the installed app (or switch back to it). Within a few seconds the **new version available / Update App**
   bar appears. Tap it: it shows "Updating..." then reloads into the new version.
   Profile > About > "Check for updates" does the same check on demand.
4. Check progress: coins, clues, stats and username before and after the update should be identical
   (they live in localStorage, which updates do not touch).
5. Desktop checks: Chrome DevTools > Application > Manifest / Service Workers, and Lighthouse > PWA.

## Safe caching rules (see sw.js)
Only same-origin GET files from the app's own file list are cached. Supabase requests (auth, database,
realtime, password resets), POSTs, and any other URL are never cached or touched.