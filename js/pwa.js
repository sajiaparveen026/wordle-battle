// PWA layer: install button, service worker registration, update detection, offline notice.
// A real update = the browser found a changed sw.js that is now installed and waiting.
// The "Update App" bar is shown only in that case. Nothing here fakes a new version.
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  let reg = null, deferredInstall = null, updating = false, updateReady = false, lastCheck = "";

  // ----- Install button (Chrome on Android/desktop fires beforeinstallprompt when installable) -----
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const showInstall = (on) => $$("[data-install-wrap]").forEach((e) => e.classList.toggle("hidden", !on));
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; if (!standalone) showInstall(true); });
  addEventListener("appinstalled", () => { deferredInstall = null; showInstall(false); });
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-install]") || !deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null; showInstall(false);
  });

  // ----- Update UI -----
  function renderAbout() {
    const v = $("#s-version"); if (!v) return;
    v.textContent = `Version ${self.APP_VERSION} (build ${self.APP_BUILD})`;
    $("#s-update-note").textContent = updateReady ? "⬆ A new version is ready." : lastCheck;
    $("#s-update-btn").classList.toggle("hidden", !updateReady);
  }
  function setUpdateReady() {
    updateReady = true; updating = false;
    $("#update-text").textContent = "A new version is available.";
    $("#update-btn").disabled = false; $("#update-btn").textContent = "Update App";
    $("#update-bar").classList.remove("hidden"); renderAbout();
  }
  function applyUpdate() {
    if (!reg || !reg.waiting || updating) return;
    updating = true;
    $("#update-text").textContent = "Updating..."; $("#update-btn").disabled = true;
    $("#s-update-btn").disabled = true;
    reg.waiting.postMessage({ type: "SKIP_WAITING" }); // the page reloads on controllerchange (below)
  }
  $("#update-btn").onclick = applyUpdate;
  $("#s-update-btn").onclick = applyUpdate;

  // ----- Service worker registration & checks -----
  function track(worker) {
    worker.addEventListener("statechange", () => {
      // "controller" exists only if an older version is already running. On the very first install there is nothing to update.
      if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateReady();
    });
  }
  async function checkForUpdate() { // resolves to "ready" | "latest" | "offline" | "unsupported"
    if (!reg) return "unsupported";
    if (!navigator.onLine) return "offline";
    try { await reg.update(); } catch { return "offline"; }
    if (reg.installing) await new Promise((res) => { const w = reg.installing; const t = setTimeout(res, 15000); w.addEventListener("statechange", () => { if (w.state !== "installing") { clearTimeout(t); res(); } }); });
    return updateReady || reg.waiting ? "ready" : "latest";
  }
  async function manualCheck() {
    const btn = $("#s-check-btn"); btn.disabled = true; $("#s-update-note").textContent = "Checking...";
    const r = await checkForUpdate();
    lastCheck = r === "latest" ? "You're on the latest version." : r === "offline" ? "You're offline, can't check right now." : r === "unsupported" ? "Updates aren't available in this browser." : "";
    if (r === "ready" && !updateReady) setUpdateReady();
    btn.disabled = false; renderAbout();
  }
  $("#s-check-btn").onclick = manualCheck;

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((r) => {
      reg = r;
      if (r.waiting && navigator.serviceWorker.controller) setUpdateReady();
      r.addEventListener("updatefound", () => r.installing && track(r.installing));
      checkForUpdate();                                                        // when the app opens
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkForUpdate(); }); // when the user returns
      setInterval(checkForUpdate, 30 * 60 * 1000);
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!updating || reloaded) return; // only reload for an update the player asked for (prevents reload loops)
      reloaded = true; location.reload();
    });
  } else { lastCheck = "Updates need a secure (https) connection."; }

  // ----- Offline notice -----
  const offlineBar = $("#offline-bar");
  const syncOnline = () => offlineBar.classList.toggle("hidden", navigator.onLine);
  addEventListener("online", syncOnline); addEventListener("offline", syncOnline); syncOnline();

  window.PWA = { renderAbout, checkForUpdate, isOnline: () => navigator.onLine };
  renderAbout();
})();
