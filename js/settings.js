// Settings panel: the slide-out menu opened from the gear on Home and on Profile (Profile itself stays a separate screen).
// Preferences (theme, sound, vibration, reduced motion) live in the existing `settings` object in app.js and are saved by
// applySettings() under the "wb_settings" key, so they survive closing and reopening the app. Account actions go through js/auth.js.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const root = $("#settings"); if (!root) return;
  const panel = root.querySelector(".sp"), body = $("#sp-body");

  // Where "Report a Bug" emails are sent (taken from terms.html). Change it here if you want a different address.
  const SUPPORT_EMAIL = "sajia026@gmail.com";

  // ---------- What's New: newest first. Add an entry here (and bump js/version.js) each time you ship. ----------
  const CHANGELOG = [
    { v: "1.12.0", date: "2026-10-30", title: "Achievements", items: [
      "25 achievements in Bronze, Silver and Gold plates on your Profile.",
      "Swipe through the carousel, tap a badge for details and see your progress.",
      "Unlocks are saved once to your guest or account progress."] },
    { v: "1.11.0", date: "2026-10-29", title: "New Settings panel", items: [
      "A slide-out Settings panel with Appearance, Game Preferences, Privacy & Security, Help & Support, About and What\u2019s New.",
      "Dark Mode switch that is remembered every time you open the app.",
      "Sound and vibration switches that apply during games.",
      "Change your password, sign out other devices or delete your account."] },
    { v: "1.10.0", date: "2026-10-29", title: "Profile screen", items: [
      "Level, XP, win rate and streaks at a glance.",
      "Daily Challenge progress and your recent games.",
      "Edit your username and avatar."] },
    { v: "1.9.1", date: "2026-10-29", title: "Sign-in refresh", items: [
      "Cleaner log in and sign up screens.",
      "Terms and Privacy pages now take you back to where you were.",
      "A clearer Install App card."] },
    { v: "1.9.0", date: "2026-10-28", title: "Shop update", items: [
      "Shop items and the free-coins box now come from one catalogue, so every Shop price matches the game."] },
    { v: "1.8.0", date: "2026-10-28", title: "Free daily coins", items: [
      "Claim free coins once a day from the game screen and once a day from the Shop."] },
    { v: "1.7.0", date: "2026-10-27", title: "New game controls", items: [
      "Redesigned hint, skip and clue icons.",
      "Word Hint: a clue about the secret word."] }
  ];

  // ---------- FAQs: the numbers come from store.js, so they always match the game ----------
  const FAQS = () => [
    ["How do I earn coins?", `Win a Solo game for ${REWARDS.practice.coins} coins and ${REWARDS.practice.xp} XP, or the Daily Challenge for ${REWARDS.daily.coins} coins and ${REWARDS.daily.xp} XP. Each game pays once. You can also claim ${FREE_COINS.amount} free coins once a day from the game screen and once a day from the Shop.`],
    ["How do hints work?", `Reveal Letter (${HINTS.reveal.cost} coins) shows one correct letter in its place. Remove Wrong Letters (${HINTS.remove.cost} coins) greys out letters that aren\u2019t in the word. Hint (${HINTS.word.cost} coins) gives a clue about the word. You start with some free uses of each, then they cost coins.`],
    ["What is the Daily Challenge?", "One word per day, the same for everyone on the same date. It resets at your own midnight, pays a bigger reward and builds a daily streak. Skipping isn\u2019t allowed in the Daily Challenge."],
    ["Can I skip a word?", `In Solo play you get ${SKIP.free} free skips, then each skip costs ${SKIP.cost} coins. A skipped word gives no reward and no penalty.`],
    ["Guest or account: what\u2019s the difference?", "A guest\u2019s progress is saved on that device only. An account saves to the cloud, so you can continue on another phone or computer. Guest progress can be moved into a new account once."],
    ["Do I lose my progress if I log out?", "No. Your progress is saved to your account first, and it\u2019s still there when you log back in. A guest\u2019s progress also stays on the device."],
    ["Why doesn\u2019t vibration work?", "Vibration depends on your device and browser. Most Android phones support it; iPhones and iPads don\u2019t let websites vibrate. You can turn it on or off in Settings > Game Preferences."],
    ["Can I play online battles yet?", "Not yet. Solo play and the Daily Challenge are available now."],
    ["How do I install the app?", "Open Settings > About and tap Install App, or use your browser\u2019s menu and choose Install app / Add to Home Screen. If you don\u2019t see the button, the app is already installed or your browser doesn\u2019t offer it."]
  ];

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const day = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); };
  const when = (iso, time) => { const d = new Date(iso); return isNaN(d) ? "\u2014" : d.toLocaleString(undefined, time ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }); };
  const isAcct = () => !!(window.Auth && Auth.isAccount && Auth.isAccount());
  const authOn = () => !!(window.Auth && Auth.enabled);

  // ---------- render static lists ----------
  $("#sp-log").innerHTML = CHANGELOG.map((r, i) =>
    `<li class="sp-card sp-static sp-rel${i === 0 ? " latest" : ""}"><div class="sp-relh"><b>${esc(r.title)}</b><span class="sp-ver">v${esc(r.v)}</span></div><time datetime="${esc(r.date)}">${esc(day(r.date))}</time><ul>${r.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></li>`).join("");
  $("#sp-faq").innerHTML = FAQS().map(([q, a]) => `<details class="sp-q"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("");

  // ---------- switches ----------
  const sw = (id) => $("#" + id);
  function setSwitch(id, on, disabled) { const b = sw(id); b.setAttribute("aria-checked", String(!!on)); b.classList.toggle("on", !!on); b.disabled = !!disabled; b.closest(".sp-row").classList.toggle("off", !!disabled); }
  function sync() { // every label and switch always reflects the saved preferences
    const dark = settings.theme === "dark", sound = !settings.mute, vib = !!settings.vibrate && canVibrate();
    setSwitch("sw-dark", dark); setSwitch("sw-motion", !!settings.reduceMotion); setSwitch("sw-sound", sound); setSwitch("sw-vibe", vib, !canVibrate());
    $("#sw-dark-d").textContent = dark ? "On: easy on the eyes. Turn off for the light theme." : "Off: light theme. Turn on for the dark theme.";
    $("#sw-vibe-d").textContent = canVibrate() ? "A short buzz for wrong words, wins and hints." : "Your device or browser doesn\u2019t support vibration.";
    $("#sp-d-appearance").textContent = dark ? "Dark mode \u00b7 On" : "Dark mode \u00b7 Off";
    $("#sp-d-game").textContent = `Sound ${sound ? "on" : "off"} \u00b7 Vibration ${vib ? "on" : "off"}`;
    if (window.PWA) PWA.renderAbout();   // shows / hides the red update cards
    $("#sp-d-about").textContent = window.PWA && PWA.isUpdateReady() ? `Update available \u00b7 v${self.APP_VERSION}` : `Version ${self.APP_VERSION} \u00b7 Credits`;
    $("#sp-d-new").textContent = `Latest updates \u00b7 v${CHANGELOG[0].v}`;
    $("#sp-d-account").textContent = isAcct() ? "Profile, avatar & sign-in" : "Profile & create account";
    $("#sp-d-delete").textContent = isAcct() ? "Permanently remove your account" : "Clear all progress on this device";
  }
  function toggle(id) {
    if (id === "sw-dark") { settings.theme = settings.theme === "dark" ? "light" : "dark"; fadeTheme(); }
    else if (id === "sw-motion") { settings.reduceMotion = !settings.reduceMotion; settings.motionUser = true; }   // motionUser: this is the player's own choice
    else if (id === "sw-sound") settings.mute = !settings.mute;
    else if (id === "sw-vibe") { if (!canVibrate()) return; settings.vibrate = !settings.vibrate; }
    applySettings(); sync();
    if (id === "sw-sound" && !settings.mute) beep(880, 0.07);   // a short preview so you can hear it is on
    if (id === "sw-vibe" && settings.vibrate) vibe(40);          // ...and feel it
  }
  function fadeTheme() { // a soft cross-fade while the colours change (skipped for reduced motion)
    if (settings.reduceMotion) return; const h = document.documentElement; h.classList.add("theme-fade"); setTimeout(() => h.classList.remove("theme-fade"), 350);
  }
  $$(".sw").forEach((b) => b.addEventListener("click", () => toggle(b.id)));
  $$("[data-sw-row]").forEach((r) => r.addEventListener("click", (e) => { if (!e.target.closest(".sw")) r.querySelector(".sw").click(); })); // tapping the label also toggles

  // ---------- views ----------
  const PARENT = { faq: "help", bug: "help", security: "privacy" };
  let current = "main", isOpen = false, opener = null;
  function view(name, focus = true) {
    current = name;
    $$(".sp-view").forEach((v) => v.classList.toggle("hidden", v.dataset.view !== name));
    $("#sp-foot").classList.toggle("hidden", name !== "main"); // Log Out lives at the bottom of the main list
    body.scrollTop = 0;
    if (name === "security") renderSecurity();
    if (name === "about" && window.PWA) PWA.renderAbout();
    if (name === "bug") { $("#bug-msg").textContent = ""; countBug(); }
    sync();
    if (focus) { const t = name === "main" ? root.querySelector('[data-view="main"] .sp-card') : $(`#sp-t-${name}`); if (t) t.focus({ preventScroll: true }); }
  }
  const back = () => view(PARENT[current] || "main");

  // Slide in from the left / slide back out (backdrop fades). With Reduce Motion on it is a short fade instead of a slide.
  const backdrop = root.querySelector(".sp-backdrop"); let anims = [], token = 0;
  function play(opening) {
    anims.forEach((a) => a.cancel()); anims = []; const my = ++token;
    if (!panel.animate) { if (!opening) root.classList.remove("open"); return; }
    const slide = !reduced(), dur = slide ? (opening ? 340 : 260) : 150;
    const pk = slide ? (opening ? [{ transform: "translateX(-104%)" }, { transform: "translateX(0)" }] : [{ transform: "translateX(0)" }, { transform: "translateX(-104%)" }]) : (opening ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }]);
    const bk = opening ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }];
    const ease = opening ? "cubic-bezier(.2,.8,.2,1)" : "cubic-bezier(.4,0,1,1)";
    const a = panel.animate(pk, { duration: dur, easing: ease, fill: "both" }), b = backdrop.animate(bk, { duration: dur, easing: "ease", fill: "both" });
    anims = [a, b];
    a.onfinish = () => { if (my !== token) return; if (opening) anims.forEach((x) => x.cancel()); else { root.classList.remove("open"); anims.forEach((x) => x.cancel()); } anims = []; };
  }
  function open(name) {
    if (isOpen) return; isOpen = true; opener = document.activeElement;
    root.removeAttribute("inert"); root.setAttribute("aria-hidden", "false");
    view(name || "main", false); root.classList.add("open"); document.body.classList.add("sp-lock"); play(true);
    setTimeout(() => { const t = root.querySelector('[data-view="main"]:not(.hidden) .sp-card') || $("#sp-close"); if (t && isOpen) t.focus({ preventScroll: true }); }, 60);
  }
  function close(restoreFocus = true) {
    if (!isOpen) return; isOpen = false;
    root.setAttribute("aria-hidden", "true"); root.setAttribute("inert", ""); document.body.classList.remove("sp-lock"); play(false);   // .open is removed when the slide-out ends
    if (restoreFocus && opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true });
  }

  // ---------- account security ----------
  function renderSecurity() {
    const info = window.Auth && Auth.accountInfo ? Auth.accountInfo() : null;
    $("#sec-guest").classList.toggle("hidden", !!info); $("#sec-acct").classList.toggle("hidden", !info);
    if (!info) { // guest, or accounts not set up on this copy of the app
      const on = authOn(); $("#sec-guest .actions").classList.toggle("hidden", !on);
      $("#sec-guest p").textContent = on ? "Your progress is saved on this device only. Create an account to protect it and use it on other devices." : "Online accounts aren\u2019t set up on this copy of the app yet. Your progress is saved on this device only.";
      return;
    }
    const nice = { email: "Email & password", google: "Google" };
    $("#sec-email").textContent = info.email || "Signed in (offline)";
    $("#sec-verified").textContent = info.offline ? "Unknown while offline" : info.verified ? "Verified" : "Not verified yet";
    $("#sec-method").textContent = info.providers.length ? info.providers.map((p) => nice[p] || p.charAt(0).toUpperCase() + p.slice(1)).join(", ") : "Email & password";
    $("#sec-last").textContent = info.lastSignIn ? when(info.lastSignIn, true) : "\u2014"; $("#sec-created").textContent = info.created ? when(info.created) : "\u2014";
    const pw = $('#sec-acct [data-sp-act="password"]'); pw.disabled = !info.password; pw.querySelector("small").textContent = info.password ? "Update your sign-in password" : "Not available: you sign in with Google";
    $("#sec-others").disabled = info.offline;
  }

  // ---------- popups (above the panel) ----------
  const modalOpen = () => $$(".modal:not(.hidden)").length > 0;
  const showModal = (id, focusSel) => { $("#" + id).classList.remove("hidden"); const f = $(focusSel); if (f) setTimeout(() => f.focus(), 30); };
  const hideModal = (id) => $("#" + id).classList.add("hidden");
  const busy = (btn, on) => { btn.disabled = on; btn.classList.toggle("loading", on); };
  const msg = (id, t) => { $("#" + id).textContent = t || ""; };

  // Change password
  function openPassword() {
    if (!isAcct()) return needAccount("Change Password is for accounts.");
    const info = Auth.accountInfo(); if (info && !info.password) return toast("This account signs in with Google, so there is no password to change.", "error", 3200);
    $("#pw-form").reset(); msg("cp-msg"); const m = $("#cp-meter"); m.style.width = "0%"; m.className = ""; $("#cp-hint").textContent = "8+ characters with upper, lower case and a number.";
    $$("#pw-modal [data-eye]").forEach((e) => { $("#" + e.dataset.eye).type = "password"; e.classList.remove("on"); });
    showModal("pw-modal", "#cp-cur");
  }
  $("#pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const cur = $("#cp-cur").value, n1 = $("#cp-new").value, n2 = $("#cp-new2").value, btn = $("#pw-save");
    if (!cur) return msg("cp-msg", "Enter your current password.");
    if (n1 !== n2) return msg("cp-msg", "The two new passwords don\u2019t match.");
    msg("cp-msg"); busy(btn, true);
    let r; try { r = await Auth.changePassword(cur, n1); } finally { busy(btn, false); }
    if (r.error) return msg("cp-msg", r.error);
    $("#pw-form").reset(); hideModal("pw-modal"); toast("Password updated", "success");
  });
  $("#pw-x").onclick = $("#pw-cancel").onclick = () => { $("#pw-form").reset(); hideModal("pw-modal"); };

  // Delete account (typed confirmation) / delete guest data
  function openDelete() {
    if (!isAcct()) return deleteGuestData();
    $("#del-type").value = ""; msg("del-msg"); $("#del-go").disabled = true; showModal("del-modal", "#del-type");
  }
  $("#del-type").addEventListener("input", (e) => { $("#del-go").disabled = e.target.value.trim().toUpperCase() !== "DELETE"; });
  $("#del-go").onclick = async () => {
    if ($("#del-type").value.trim().toUpperCase() !== "DELETE") return;
    const btn = $("#del-go"); msg("del-msg"); busy(btn, true);
    const r = await Auth.deleteAccount();    // on success the page restarts on the welcome screen
    if (r && r.error) { busy(btn, false); btn.disabled = false; msg("del-msg", r.error); }
  };
  $("#del-x").onclick = $("#del-cancel").onclick = () => hideModal("del-modal");
  async function deleteGuestData() {
    if (await confirmBox("Delete guest data?", "You\u2019re playing as a guest, so there\u2019s no account to delete. This clears your coins, hints, stats and streaks from this device. It can\u2019t be undone.", "Delete data")) WBApp.resetAll(true);
  }
  ["pw-modal", "del-modal"].forEach((id) => $("#" + id).addEventListener("click", (e) => { if (e.target.id === id) hideModal(id); }));

  async function needAccount(text) { // a guest tapped something that needs an account
    if (!authOn()) return void (await dialog("Account needed", `${text} Online accounts aren\u2019t set up on this copy of the app yet.`, ["OK"]));
    if ((await dialog("Account needed", `${text} You\u2019re playing as a guest.`, ["Not now", "Create account"])) === 1) { close(false); WBApp.show("signup"); }
  }

  // Sign out other devices
  async function signOutOthers() {
    if (!isAcct()) return;
    if (!(await confirmBox("Sign out other devices?", "Anyone signed in to your account on another phone or computer will be logged out. This device stays signed in.", "Sign out others"))) return;
    const b = $("#sec-others"); b.disabled = true; const r = await Auth.signOutOthers(); b.disabled = false;
    toast(r.error || "Other devices signed out", r.error ? "error" : "success", 3000);
  }

  // Log out (account) / leave guest mode: the confirmation popup (Cancel / Log out) is asked by auth.js
  async function logout() {
    const b = $("#sp-logout"); if (b.disabled) return; b.disabled = true;
    try { await (isAcct() ? Auth.logout() : Auth.leaveGuest()); } finally { b.disabled = false; }
  }
  $("#sp-logout").addEventListener("click", logout);

  // ---------- report a bug ----------
  const bugReport = () => {
    const text = $("#bug-text").value.trim(); let out = `Wordle Battle bug report\n\n${text}\n`;
    if ($("#bug-info").checked) out += `\n--- App info ---\nVersion: ${self.APP_VERSION} (build ${self.APP_BUILD})\nPlaying as: ${isAcct() ? "signed-in account" : "guest"}\nTheme: ${settings.theme}\nBrowser: ${navigator.userAgent}\nScreen: ${innerWidth}x${innerHeight} @${devicePixelRatio}x\nOnline: ${navigator.onLine ? "yes" : "no"}\nTime: ${new Date().toISOString()}\n`;
    return { text, out };
  };
  const countBug = () => { $("#bug-count").textContent = `${$("#bug-text").value.length} / 1000`; };
  $("#bug-text").addEventListener("input", countBug);
  const bugOk = () => { const r = bugReport(); if (r.text.length < 10) { $("#bug-msg").className = "authmsg error"; $("#bug-msg").textContent = "Please describe the problem (at least 10 characters)."; $("#bug-text").focus(); return null; } return r; };
  $("#bug-form").addEventListener("submit", (e) => {
    e.preventDefault(); const r = bugOk(); if (!r) return;
    $("#bug-msg").className = "authmsg ok"; $("#bug-msg").textContent = "Opening your email app\u2026 if nothing opens, tap Copy report and send it to " + SUPPORT_EMAIL + ".";
    location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Wordle Battle bug report (v" + self.APP_VERSION + ")")}&body=${encodeURIComponent(r.out)}`;
  });
  $("#bug-copy").addEventListener("click", async () => {
    const r = bugOk(); if (!r) return; const ok = await copyText(r.out);
    $("#bug-msg").className = "authmsg " + (ok ? "ok" : "error"); $("#bug-msg").textContent = ok ? "Report copied. Paste it into an email to " + SUPPORT_EMAIL + "." : "Couldn\u2019t copy. Please select the text and copy it yourself.";
  });

  // ---------- one click handler for every row ----------
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-sp-close]") || e.target.closest("#sp-close")) return close();
    if (e.target.closest("[data-sp-back]")) return back();
    const go = e.target.closest("[data-sp-go]"); if (go) return view(go.dataset.spGo);
    const act = e.target.closest("[data-sp-act]"); if (!act || act.disabled) return;
    switch (act.dataset.spAct) {
      case "profile": close(false); WBApp.show("profile"); break;
      case "password": openPassword(); break;
      case "delete": openDelete(); break;
      case "howto": close(false); if (window.Tutorial) Tutorial.open(); break;
      case "signup": case "login": close(false); WBApp.show(act.dataset.spAct); break;
    }
  });
  $("#sec-others").addEventListener("click", signOutOthers);

  // ---------- keyboard + swipe ----------
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { // popups on top close first
      for (const id of ["pw-modal", "del-modal"]) if (!$("#" + id).classList.contains("hidden")) { hideModal(id); return; }
    }
    if (!isOpen || modalOpen()) return;
    if (e.key === "Escape") { e.preventDefault(); return close(); }
    if (e.key === "Tab") { // keep keyboard focus inside the panel
      const f = $$(".sp button:not([disabled]), .sp a[href], .sp input, .sp textarea, .sp summary").filter((x) => x.offsetParent !== null);
      if (!f.length) return; const first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || !panel.contains(a))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (a === last || !panel.contains(a))) { e.preventDefault(); first.focus(); }
    }
  });
  let tx = null, ty = 0;
  panel.addEventListener("touchstart", (e) => { tx = e.changedTouches[0].clientX; ty = e.changedTouches[0].clientY; }, { passive: true });
  panel.addEventListener("touchend", (e) => { if (tx === null) return; const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; tx = null; if (dx < -80 && Math.abs(dy) < 50) close(); }, { passive: true }); // swipe left = close

  sync();
  window.Settings = { open, close, isOpen: () => isOpen, changelog: CHANGELOG };
})();