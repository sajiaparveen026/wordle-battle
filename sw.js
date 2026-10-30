// Wordle Battle service worker.
// Strategy: precache the app shell under a versioned cache, serve it from there (so HTML and JS always
// match each other), and wait for the player to tap "Update App" before a new version takes over.
// Only same-origin GET requests are handled. Everything else (Supabase auth, database, realtime,
// password resets, any POST) goes straight to the network and is NEVER cached.
importScripts("./js/version.js", "./js/build.js");
const PREFIX = "wordle-battle-";
const CACHE = `${PREFIX}${self.APP_VERSION}-${self.APP_BUILD}`;
const ASSETS = [
  "./", "./index.html", "./terms.html", "./privacy.html", "./manifest.webmanifest", "./css/style.css",
  "./js/version.js", "./js/build.js", "./js/config.js", "./js/ns.js", "./js/words.js", "./js/clues.js", "./js/store.js", "./js/vendor/supabase.js", "./js/auth.js", "./js/app.js", "./js/tutorial.js", "./js/freecoins.js", "./js/achievements.js", "./js/leaderboard.js", "./js/settings.js", "./js/pwa.js", "./js/legal.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png", "./icons/favicon.svg"
];

self.addEventListener("install", (event) => {
  // No skipWaiting here: a new version waits until the player taps "Update App".
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async (url) => {
      const res = await fetch(new Request(url, { cache: "reload" })); // bypass the HTTP cache: never precache stale files
      if (!res.ok) throw new Error(`Precache failed: ${url}`);
      await cache.put(url, res);
    }));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return; // Supabase etc.: untouched
  if (req.mode === "navigate") { // the app page keeps OAuth / password-reset redirect URLs (?code=, #access_token=) working
    const shell = url.pathname.endsWith("/") || url.pathname.endsWith("/index.html");
    event.respondWith(caches.open(CACHE).then((c) => c.match(shell ? "./index.html" : req)).then((r) => r || fetch(req)));
    return;
  }
  event.respondWith(caches.open(CACHE).then((c) => c.match(req)).then((r) => r || fetch(req))); // not precached = network only, never stored
});