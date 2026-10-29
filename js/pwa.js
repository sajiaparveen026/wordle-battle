// PWA layer: install button, service worker registration, update detection, offline notice.
// A real update = the browser found a changed sw.js that is now installed and waiting.
// The "Update App" bar is shown only in that case. Nothing here fakes a new version.
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  let reg = null, deferredInstall = null, updating = false, updateReady = false, lastCheck = "";

  // ----- Install card / button -----
  // One-tap install where the browser offers it (beforeinstallprompt); otherwise a short "how to install" popup for this browser.
  // The card on the sign-in screens and dashboard has a ✕ that hides it for 3 days. It never touches login or signup.
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const SNOOZE_KEY = "wb_install_snooze", DAY = 864e5;
  let installed = false;
  const snoozed = () => { try { return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now(); } catch { return false; } };
  const renderInstall = () => {
    $$("[data-install-card]").forEach((e) => e.classList.toggle("hidden", standalone || installed || snoozed()));
    $$("[data-install-wrap]").forEach((e) => e.classList.toggle("hidden", standalone || installed));
  };
  function installSteps() {
    const ua = navigator.userAgent, ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
      ? ["Open this page in Safari (installing only works there on iPhone and iPad).", "Tap the Share button, then “Add to Home Screen”.", "Tap “Add”. Wordle Battle now opens like an app."]
      : ["Tap the Share button at the bottom of Safari (the square with an arrow).", "Scroll down and tap “Add to Home Screen”.", "Tap “Add”. Wordle Battle now opens like an app."];
    if (/Android/i.test(ua)) return ["Tap the ⋮ menu at the top right of your browser.", "Tap “Install app” (or “Add to Home screen”).", "Tap “Install”."];
    if (/Firefox/.test(ua)) return ["Firefox on computers can't install web apps.", "Open this page in Chrome or Edge, then click the install icon in the address bar."];
    return ["Click the install icon (a screen with a down arrow) at the right end of the address bar.", "Or open the browser menu (⋮) and choose “Install Wordle Battle”.", "Confirm with “Install”."];
  }
  function openInstallHelp() {
    const ol = $("#ih-steps"); ol.innerHTML = ""; installSteps().forEach((t) => { const li = document.createElement("li"); li.textContent = t; ol.append(li); });
    $("#install-help").classList.remove("hidden"); if (typeof lockModal === "function") lockModal(true); $("#ih-ok").focus();
  }
  function closeInstallHelp() { $("#install-help").classList.add("hidden"); if (typeof lockModal === "function") lockModal(false); }
  $("#ih-ok").onclick = closeInstallHelp; $("#ih-x").onclick = closeInstallHelp;
  $("#install-help").addEventListener("click", (e) => { if (e.target.id === "install-help") closeInstallHelp(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#install-help").classList.contains("hidden")) closeInstallHelp(); });
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; renderInstall(); });
  addEventListener("appinstalled", () => { deferredInstall = null; installed = true; renderInstall(); });
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-install-x]")) { try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + 3 * DAY)); } catch {} return renderInstall(); }
    if (!e.target.closest("[data-install]")) return;
    if (!deferredInstall) return openInstallHelp();       // no one-tap prompt here: show how to install in this browser
    const prompt = deferredInstall; deferredInstall = null; // a prompt can only be used once
    prompt.prompt();
    try { if ((await prompt.userChoice).outcome === "accepted") installed = true; } catch {}
    renderInstall();
  });
  renderInstall();

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
    if (!sessionStorage.getItem("wb_update_dismissed")) $("#update-bar").classList.remove("hidden"); // ✕ hides it for this visit; Settings still offers the update
    renderAbout();
  }
  function applyUpdate() {
    if (!reg || !reg.waiting || updating) return;
    updating = true;
    $("#update-text").textContent = "Updating..."; $("#update-btn").disabled = true;
    $("#s-update-btn").disabled = true;
    reg.waiting.postMessage({ type: "SKIP_WAITING" }); // the page reloads on controllerchange (below)
  }
  $("#update-btn").onclick = applyUpdate;
  $("#update-x").onclick = () => { $("#update-bar").classList.add("hidden"); try { sessionStorage.setItem("wb_update_dismissed", "1"); } catch {} };
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