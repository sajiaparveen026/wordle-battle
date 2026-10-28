// Wordle Battle accounts (Supabase Auth). The official supabase-js client handles passwords, sessions,
// tokens and refresh. This file only builds the screens and wires them to that client:
// no custom password handling, no tokens stored by us, no secret keys.
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const cfg = window.CONFIG || {};
  const enabled = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase && window.supabase.createClient);
  const say = (t, k) => { if (typeof toast === "function") toast(t, k); };
  const go = (n) => window.WBApp.show(n);
  const redirectUrl = () => location.origin + location.pathname.replace(/index\.html$/, ""); // must be allow-listed in Supabase

  // Links from emails can arrive with an error (expired/used). Read it before the client cleans the URL.
  function linkError() {
    const p = new URLSearchParams(location.hash.replace(/^#/, "") + "&" + location.search.replace(/^\?/, ""));
    const code = p.get("error_code") || p.get("error"); if (!code) return "";
    history.replaceState(null, "", location.pathname);
    return /expired|invalid|otp/i.test(code + (p.get("error_description") || "")) ? "That link has expired or was already used. Please request a new one." : "That sign-in link didn't work. Please try again.";
  }
  const startupNotice = linkError();

  const sb = enabled ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;

  let readyP = Promise.resolve();
  let user = null, recovering = false, routed = false, googleOn = false, leaving = false, pushing = false, pushTimer = null;
  let meta = { rev: 0, dirty: false };
  const isAccount = () => !!user && window.WB_NS === user.id;
  const legacyGuest = () => ["game_practice", "game_daily", "stats"].some((k) => localStorage.getItem("wb_" + k));
  const isGuest = () => { const m = localStorage.getItem("wb_mode"); return m === "guest" || (m === null && legacyGuest()); };

  // ---------- validation ----------
  const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  const userOk = (u) => /^[A-Za-z0-9_]{3,16}$/.test(u);
  function pwIssues(p) {
    const i = []; if (p.length < 8) i.push("8+ characters"); if (!/[a-z]/.test(p)) i.push("a lowercase letter");
    if (!/[A-Z]/.test(p)) i.push("an uppercase letter"); if (!/\d/.test(p)) i.push("a number"); return i;
  }
  const pwScore = (p) => Math.min(4, (p.length >= 8) + (p.length >= 12) + (/[a-z]/.test(p) && /[A-Z]/.test(p)) + /\d/.test(p) + /[^A-Za-z0-9]/.test(p));
  function meter(passId, meterId, hintId) {
    $("#" + passId).addEventListener("input", (e) => {
      const p = e.target.value, s = p ? pwScore(p) : 0, m = $("#" + meterId), iss = pwIssues(p);
      m.style.width = s * 25 + "%"; m.className = "s" + s;
      $("#" + hintId).textContent = !p ? "8+ characters with upper, lower case and a number." : iss.length ? "Still needs: " + iss.join(", ") : ["", "Weak", "Okay", "Good", "Strong"][s] + " password";
    });
  }
  meter("su-pass", "su-meter", "su-hint"); meter("rp-pass", "rp-meter", "rp-hint");

  // ---------- small UI helpers ----------
  const setMsg = (id, text, kind) => { const e = $("#" + id); e.textContent = text || ""; e.className = "authmsg" + (kind ? " " + kind : ""); };
  const busy = (btn, on) => { btn.disabled = on; btn.classList.toggle("loading", on); };
  const label = (btn, text) => { (btn.querySelector("b") || btn).textContent = text; };
  document.addEventListener("click", (e) => {
    const eye = e.target.closest("[data-eye]"); if (!eye) return;
    const inp = $("#" + eye.dataset.eye), show = inp.type === "password";
    inp.type = show ? "text" : "password"; eye.setAttribute("aria-label", show ? "Hide password" : "Show password"); eye.classList.toggle("on", show);
  });
  function cooldown(btn, secs, text) { // disables a button for a while (client-side limit; Supabase enforces its own server-side)
    let n = secs; btn.disabled = true; label(btn, `${text} (${n}s)`);
    const t = setInterval(() => { n--; if (n <= 0) { clearInterval(t); btn.disabled = false; label(btn, text); } else label(btn, `${text} (${n}s)`); }, 1000);
  }
  function mapError(err, ctx) {
    const code = err.code || "", msg = (err.message || "").toLowerCase();
    if (err.name === "AuthRetryableFetchError" || (!err.status && /fetch|network/.test(msg))) return "Can't reach the server. Check your connection and try again.";
    if (err.status === 429 || code.includes("rate_limit") || msg.includes("rate limit")) return "Too many attempts. Please wait a minute and try again.";
    if (code === "weak_password") return "That password is too weak. Use 8+ characters with upper and lower case letters and a number.";
    if (ctx === "login") return code === "email_not_confirmed" ? "Please verify your email first. Check your inbox for the link." : "Incorrect email or password.";
    if (ctx === "signup") return "We couldn't create that account. If you already have one, try logging in or resetting your password.";
    if (ctx === "reset") return code === "same_password" ? "Choose a password different from your old one." : "Couldn't update the password. The link may have expired; request a new one.";
    return "Something went wrong. Please try again.";
  }

  // ---------- welcome / guest ----------
  function showWelcome(notice) {
    $$("#welcome [data-needs-auth]").forEach((e) => e.classList.toggle("hidden", !enabled));
    $("#welcome-setup").classList.toggle("hidden", enabled);
    setMsg("welcome-notice", notice || "", notice ? "ok" : ""); go("welcome");
  }
  const startGuest = () => { localStorage.setItem("wb_mode", "guest"); go("dashboard"); };
  ["btn-guest", "su-guest", "li-guest"].forEach((id) => ($("#" + id).onclick = startGuest));

  // ---------- Google (button appears only if the provider is really enabled in Supabase) ----------
  async function checkGoogle() {
    if (!enabled) return;
    try {
      const r = await fetch(`${cfg.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: cfg.SUPABASE_ANON_KEY } });
      googleOn = !!((await r.json()).external || {}).google;
    } catch { googleOn = false; }
    $$("[data-google]").forEach((b) => b.classList.toggle("hidden", !googleOn));
  }
  $$("[data-google]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectUrl() } });
    if (error) { b.disabled = false; say("Google sign-in isn't available right now.", "error"); }
  }));

  // ---------- sign up ----------
  let pendingEmail = "", resendCount = 0;
  function showVerify(email) {
    pendingEmail = email; $("#vf-email").textContent = email; setMsg("vf-msg", ""); go("verify"); cooldown($("#vf-resend"), 60, "Resend email");
  }
  $("#signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#su-email").value.trim(), username = $("#su-user").value.trim(), p1 = $("#su-pass").value, p2 = $("#su-pass2").value, btn = $("#su-submit");
    if (!emailOk(email)) return setMsg("su-msg", "Enter a valid email address.", "error");
    if (!userOk(username)) return setMsg("su-msg", "Username must be 3-16 letters, numbers or underscores.", "error");
    const iss = pwIssues(p1); if (iss.length) return setMsg("su-msg", "Password needs: " + iss.join(", ") + ".", "error");
    if (p1 !== p2) return setMsg("su-msg", "The two passwords don't match.", "error");
    if (!$("#su-terms").checked) return setMsg("su-msg", "Please accept the Terms and Privacy Policy to continue.", "error");
    setMsg("su-msg", ""); busy(btn, true);
    try {
      const av = await sb.rpc("username_available", { p_username: username });
      if (av.error) return setMsg("su-msg", ["PGRST202", "42883"].includes(av.error.code) ? "Accounts aren't fully set up yet (database migration missing)." : mapError(av.error, "signup"), "error");
      if (av.data === false) return setMsg("su-msg", "That username is taken. Try another.", "error");
      const { data, error } = await sb.auth.signUp({ email, password: p1, options: { data: { username, accepted_terms_at: new Date().toISOString() }, emailRedirectTo: redirectUrl() } });
      if (error) return setMsg("su-msg", mapError(error, "signup"), "error");
      $("#su-pass").value = $("#su-pass2").value = "";
      if (data.session) { setMsg("su-msg", "Account created! Signing you in...", "ok"); applySession(data.session); }
      else showVerify(email); // same screen whether or not the email already existed (no account enumeration)
    } finally { busy(btn, false); }
  });
  $("#vf-resend").onclick = async () => {
    if (resendCount >= 5) return setMsg("vf-msg", "Too many resend requests. Please try again later.", "error");
    resendCount++; cooldown($("#vf-resend"), 60, "Resend email");
    const { error } = await sb.auth.resend({ type: "signup", email: pendingEmail, options: { emailRedirectTo: redirectUrl() } });
    setMsg("vf-msg", error && (error.status === 429 || !error.status) ? mapError(error, "x") : "If that address is waiting for verification, we've sent a new email.", error && error.status === 429 ? "error" : "ok");
  };

  // ---------- log in ----------
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#li-email").value.trim(), pass = $("#li-pass").value, btn = $("#li-submit");
    setMsg("li-notice", "");
    if (!emailOk(email) || !pass) return setMsg("li-msg", "Enter your email and password.", "error");
    setMsg("li-msg", ""); busy(btn, true);
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) return setMsg("li-msg", mapError(error, "login"), "error");
      $("#li-pass").value = ""; await applySession(data.session);
    } finally { busy(btn, false); }
  });

  // ---------- forgot / reset password ----------
  $("#forgot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#fp-email").value.trim(), btn = $("#fp-submit");
    if (!emailOk(email)) return setMsg("fp-msg", "Enter a valid email address.", "error");
    busy(btn, true);
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
    busy(btn, false);
    if (error && (error.status === 429 || !error.status)) return setMsg("fp-msg", mapError(error, "x"), "error");
    setMsg("fp-msg", "If an account exists for that email, a reset link is on its way. Check your inbox.", "ok"); // same message either way
    cooldown(btn, 60, "Send reset link");
  });
  $("#reset-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p1 = $("#rp-pass").value, p2 = $("#rp-pass2").value, btn = $("#rp-submit");
    const iss = pwIssues(p1); if (iss.length) return setMsg("rp-msg", "Password needs: " + iss.join(", ") + ".", "error");
    if (p1 !== p2) return setMsg("rp-msg", "The two passwords don't match.", "error");
    busy(btn, true);
    const { error } = await sb.auth.updateUser({ password: p1 });
    busy(btn, false);
    if (error) return setMsg("rp-msg", mapError(error, "reset"), "error");
    $("#rp-pass").value = $("#rp-pass2").value = ""; setMsg("rp-msg", "");
    await sb.auth.signOut({ scope: "local" }); recovering = false;
    if (window.WB_NS) { sessionStorage.setItem("wb_notice", "Password updated. Please log in with your new password."); return endAccountMode(); } // was signed in on this device: clean restart
    setMsg("li-notice", "Password updated. Please log in with your new password.", "ok"); go("login");
  });

  // ---------- session handling ----------
  function endAccountMode() { // back to the guest namespace + welcome screen (guest data was never touched)
    if (leaving) return; leaving = true;
    localStorage.removeItem("wb_active_ns"); localStorage.setItem("wb_mode", "none"); sessionStorage.setItem("wb_fast", "1");
    location.reload();
  }
  async function applySession(session) {
    if (recovering) return;
    if (!session) { user = null; if (window.WB_NS) { sessionStorage.setItem("wb_notice", "Your session expired. Please log in again."); endAccountMode(); } return; }
    user = session.user;
    if (window.WB_NS !== user.id) { // switch to this account's own storage, then reload cleanly
      localStorage.setItem("wb_active_ns", user.id); localStorage.setItem("wb_mode", "account"); sessionStorage.setItem("wb_fast", "1");
      location.reload(); return;
    }
    await onAccountReady();
  }

  if (enabled) sb.auth.onAuthStateChange((event, session) => { // keep this callback synchronous (no awaiting supabase calls inside)
    if (event === "PASSWORD_RECOVERY") { recovering = true; if (routed) go("reset"); }
    else if (event === "SIGNED_IN" || event === "INITIAL_SESSION") { if (session) setTimeout(() => applySession(session), 400); }
    else if (event === "SIGNED_OUT") { setTimeout(() => { if (window.WB_NS && !leaving) { sessionStorage.setItem("wb_notice", "Your session expired. Please log in again."); endAccountMode(); } }, 0); }
  });

  async function route() {
    routed = true; checkGoogle();
    let session = null;
    if (enabled) { try { session = (await sb.auth.getSession()).data.session; } catch {} }
    if (recovering) return go("reset");
    const notice = sessionStorage.getItem("wb_notice") || startupNotice; sessionStorage.removeItem("wb_notice");
    if (session) {
      if (window.WB_NS === session.user.id) { user = session.user; readyP = applySession(session); go("dashboard"); await readyP; return; }
      await applySession(session); return;
    }
    if (window.WB_NS) { // account data present but no session
      if (!navigator.onLine) { user = { id: window.WB_NS, offline: true }; meta = loadMeta(); return go("dashboard"); } // offline: use the cached copy
      sessionStorage.setItem("wb_notice", "Your session expired. Please log in again."); return endAccountMode();
    }
    if (isGuest() && !startupNotice) return go("dashboard");
    showWelcome(notice);
  }
  addEventListener("online", async () => { // back online with an offline-opened account: confirm the session, then sync
    if (!enabled || !user) return;
    if (!user.offline) { if (meta.dirty) push(); return; }
    const { data } = await sb.auth.getSession();
    if (data.session) { user = data.session.user; readyFor = ""; await onAccountReady(); } else { sessionStorage.setItem("wb_notice", "Your session expired. Please log in again."); endAccountMode(); }
  });

  // ---------- profile + cloud sync of the solo save ----------
  const metaKey = () => "wb_sync_" + user.id;
  const loadMeta = () => { try { return JSON.parse(localStorage.getItem("wb_sync_" + window.WB_NS)) || { rev: 0, dirty: false }; } catch { return { rev: 0, dirty: false }; } };
  const saveMeta = () => localStorage.setItem(metaKey(), JSON.stringify(meta));
  const KEYS = ["coins", "xp", "wins", "losses", "hints", "skips", "rewarded", "recent", "dist", "streak", "bestStreak", "bestGuesses"];
  const snapshot = () => { const P = Player.data, player = {}; KEYS.forEach((k) => (player[k] = P[k])); return { v: 1, player, stats: window.WBApp.getStats() }; };
  function applySnapshot(s) { // sanitise before trusting remote/guest data in the local store
    if (!s || typeof s.player !== "object") return;
    const P = Player.data, r = s.player, n = (v, d) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);
    P.coins = n(r.coins, P.coins); P.xp = n(r.xp, P.xp); P.wins = n(r.wins, P.wins); P.losses = n(r.losses, P.losses);
    P.streak = n(r.streak, P.streak || 0); P.bestStreak = n(r.bestStreak, P.bestStreak || 0);
    P.bestGuesses = r.bestGuesses === null ? null : n(r.bestGuesses, P.bestGuesses);
    if (Array.isArray(r.dist) && r.dist.length === 6) P.dist = r.dist.map((x) => n(x, 0));
    if (Array.isArray(r.rewarded)) P.rewarded = r.rewarded.filter((x) => typeof x === "string").slice(-300);
    if (Array.isArray(r.recent)) P.recent = r.recent.filter((x) => x === "W" || x === "L").slice(-5);
    if (r.skips && typeof r.skips === "object") P.skips = { free: n(r.skips.free, P.skips.free) };
    if (r.hints && r.hints.reveal && r.hints.remove) {
      const w = r.hints.word && typeof r.hints.word === "object" ? r.hints.word : P.hints.word; // older cloud saves have no word hints yet: keep the local count
      P.hints = { reveal: { free: n(r.hints.reveal.free, 0), credits: n(r.hints.reveal.credits, 0) }, remove: { free: n(r.hints.remove.free, 0), credits: n(r.hints.remove.credits, 0) }, word: { free: n(w.free, 0), credits: n(w.credits, 0) } };
    }
    Player.save(true);
    if (s.stats && typeof s.stats === "object") window.WBApp.applyStats(s.stats);
  }
  function guestSnapshot() { // the guest's data lives in the original "wb_*" keys
    try { const p = JSON.parse(localStorage.getItem("wb_player")); if (!p) return null; const player = {}; KEYS.forEach((k) => (player[k] = p[k])); return { v: 1, player, stats: JSON.parse(localStorage.getItem("wb_stats")) || undefined }; } catch { return null; }
  }
  const hasProgress = (g) => g && g.player && ((g.player.wins || 0) + (g.player.losses || 0) > 0 || (g.player.xp || 0) > 0 || g.player.coins !== 100);

  async function loadProfile() {
    let r = await sb.from("profiles").select("username,avatar").eq("id", user.id).maybeSingle();
    if (!r.error && !r.data) { await sb.rpc("ensure_profile"); r = await sb.from("profiles").select("username,avatar").eq("id", user.id).maybeSingle(); }
    if (r.data) { Player.data.username = r.data.username; Player.data.avatar = r.data.avatar; Player.save(true); }
  }
  async function syncDown(retry) {
    meta = loadMeta();
    const { data: row, error } = await sb.from("solo_saves").select("data,rev").eq("user_id", user.id).maybeSingle();
    if (error) return false;                                   // offline etc.: keep the local copy, retry later
    if (row) {
      if (meta.dirty && meta.rev === row.rev) await push();     // local changes not yet uploaded
      else { applySnapshot(row.data); meta = { rev: row.rev, dirty: false }; saveMeta(); } // cloud copy wins
      return true;
    }
    let snap = snapshot(); const g = guestSnapshot();            // brand-new account: nothing in the cloud yet
    if (hasProgress(g) && !localStorage.getItem("wb_guest_migrated")) {
      if (await confirmBox("Move your guest progress?", "Copy the coins, XP and stats from this device into your new account? You can only do this once.", "Move progress")) {
        snap = g; applySnapshot(g); localStorage.setItem("wb_guest_migrated", "1");
      }
    }
    const ins = await sb.from("solo_saves").insert({ user_id: user.id, data: snap }).select("rev").maybeSingle();
    if (ins.error) return retry ? false : syncDown(true);       // another device created it first: use theirs
    meta = { rev: ins.data.rev, dirty: false }; saveMeta(); return true;
  }
  async function push() {
    if (!isAccount() || pushing || !sb || user.offline || !navigator.onLine) return;
    pushing = true;
    try {
      const { data, error } = await sb.from("solo_saves").update({ data: snapshot() }).eq("user_id", user.id).eq("rev", meta.rev).select("rev");
      if (error) { meta.dirty = true; saveMeta(); clearTimeout(pushTimer); pushTimer = setTimeout(push, 6000); return; }
      if (!data || !data.length) { // someone saved from another device first: theirs wins, nothing is lost silently
        const r = await sb.from("solo_saves").select("data,rev").eq("user_id", user.id).maybeSingle();
        if (r.data) { applySnapshot(r.data.data); meta = { rev: r.data.rev, dirty: false }; saveMeta(); window.WBApp.refresh(); say("Progress updated from your other device", "success"); }
        return;
      }
      meta = { rev: data[0].rev, dirty: false }; saveMeta();
    } finally { pushing = false; }
  }
  addEventListener("wb:save", () => { // any change to coins/xp/stats while signed in is queued for upload
    if (!isAccount()) return; meta.dirty = true; saveMeta(); clearTimeout(pushTimer); pushTimer = setTimeout(push, 1500);
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && isAccount() && meta.dirty) push(); });

  let readyFor = "";
  async function onAccountReady() {
    if (readyFor === user.id) return; readyFor = user.id;
    await loadProfile(); await syncTutorial(); window.WBApp.refresh(); renderAccount(); // show the account name right away,
    await syncDown(); window.WBApp.refresh(); renderAccount();      // then sync (may ask about moving guest progress)
  }

  // ---------- tutorial status (saved per account so it stays dismissed on every device) ----------
  async function syncTutorial() {
    const tkey = "wb_tutorial_" + user.id;
    const r = await sb.from("profiles").select("tutorial_completed_at").eq("id", user.id).maybeSingle();
    if (r.error) return;                                   // column missing (migration 002 not run) or offline: the local flag is used
    const remote = !!(r.data && r.data.tutorial_completed_at);
    const local = localStorage.getItem(tkey) === "1" || localStorage.getItem("wb_tutorial") === "1"; // a guest who finished it counts too
    if (remote && !local) localStorage.setItem(tkey, "1");
    else if (!remote && local) { localStorage.setItem(tkey, "1"); await setTutorialDone(); }
    else if (remote && local) localStorage.setItem(tkey, "1");
  }
  async function setTutorialDone() {
    if (!isAccount() || !user || user.offline) return;
    try { await sb.from("profiles").update({ tutorial_completed_at: new Date().toISOString() }).eq("id", user.id); } catch {}
  }
  // ---------- free daily coins: the server decides, the app only asks ----------
  async function freeCoinsStatus() {
    if (!sb || !isAccount() || !user || user.offline) return { error: "offline" };
    try { const r = await sb.rpc("free_coins_status"); return r.error ? { error: "server" } : (r.data || {}); } catch { return { error: "offline" }; }
  }
  async function freeCoinsClaim(day) {
    if (!sb || !isAccount() || !user || user.offline) return { error: "offline" };
    try { const r = await sb.rpc("claim_free_coins", { p_day: day }); return r.error ? { error: "server" } : (r.data || { error: "server" }); } catch { return { error: "offline" }; }
  }
  const whenReady = () => Promise.race([readyP, new Promise((r) => setTimeout(r, 6000))]);

  // ---------- account UI ----------
  async function setUsername(v) {
    const input = $("#s-name");
    if (!userOk(v)) { say("Username: 3-16 letters, numbers or _", "error"); input.value = Player.data.username; return; }
    if (v === Player.data.username) return;
    const { error } = await sb.from("profiles").update({ username: v }).eq("id", user.id);
    if (error) { say(error.code === "23505" ? "That username is taken" : "Couldn't save username", "error"); input.value = Player.data.username; return; }
    Player.data.username = v; Player.save(true); say("Username saved", "success"); window.WBApp.refresh();
  }
  async function setAvatar(a) { if (user && !user.offline) await sb.from("profiles").update({ avatar: a }).eq("id", user.id); }
  async function logout() {
    if (!(await confirmBox("Log out?", "Your progress is saved to your account.", "Log out"))) return;
    if (meta.dirty) await push();
    try { const r = await sb.auth.signOut(); if (r.error) await sb.auth.signOut({ scope: "local" }); } catch { await sb.auth.signOut({ scope: "local" }); }
    sessionStorage.setItem("wb_notice", "You've been logged out."); endAccountMode();
  }
  document.addEventListener("click", (e) => { if (e.target.closest("#btn-logout")) logout(); });

  function renderAccount() {
    const acct = isAccount();
    $$("#d-acct,#p-acct").forEach((b) => { b.textContent = acct ? "" : "Guest"; b.classList.toggle("hidden", acct); });
    $("#battle-title").textContent = acct ? "Online battles need a server" : "Online battles need an account";
    $("#battle-note").textContent = acct ? "Matchmaking, secret words and rewards must be controlled by Supabase so nobody can cheat. Wordle Battle will not fake opponents, so this mode unlocks in the next stages."
      : "Sign in to play online. Guests can still play Solo and the Daily Challenge.";
    const panel = $("#acct"); if (!panel) return;
    if (acct) {
      panel.innerHTML = '<h4>Account</h4><p><b class="em"></b></p><small>Signed in · progress syncs to your account</small><div class="actions"><button class="primary danger" id="btn-logout">Log out</button></div>';
      panel.querySelector(".em").textContent = "✔ " + (user.email || "Signed in (offline)");
    } else if (enabled) {
      panel.innerHTML = '<h4>Account</h4><p><b>👤 Guest</b></p><small>Progress is saved on this device only. Create an account to keep it safe and play online.</small><div class="actions"><button class="primary" data-go="signup">Create account</button><button class="primary alt" data-go="login">Log in</button></div>';
    } else {
      panel.innerHTML = '<h4>Account</h4><p><b>👤 Guest</b></p><small>Online accounts aren\'t set up on this copy of the app yet. Progress is saved on this device only.</small>';
    }
    const reset = $("#s-reset"); if (reset) reset.classList.toggle("hidden", acct); // never offer to wipe a cloud-synced account
  }

  window.Auth = { enabled, route, renderAccount, isAccount, setUsername, setAvatar, logout, whenReady, setTutorialDone, freeCoins: { status: freeCoinsStatus, claim: freeCoinsClaim } };
})();