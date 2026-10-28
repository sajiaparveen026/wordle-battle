// Free daily coins: the "+" next to the coins opens a popup to claim 50 coins once per day.
// Signed-in players: the SERVER (Supabase function claim_free_coins) remembers the last claimed day, so
// refreshing, clearing the browser or using another device cannot claim twice.
// Guests: the claimed day is saved on this device (guest progress already lives only on the device).
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const AMOUNT = 50, KEY = "free_claim";
  const pad = (n) => String(n).padStart(2, "0");
  const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // the player's local date
  const todayStr = () => dayOf(new Date());
  const validDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const readDay = () => { const r = load(KEY, {}); return r && validDay(r.day) ? r.day : ""; };           // always read fresh from storage
  const writeDay = (d) => { if (validDay(d) && d > readDay()) save(KEY, { day: d }); };                   // the saved day never moves backwards
  const claimedToday = () => readDay() >= todayStr();                                                     // turning the clock back cannot re-open a claim
  const isAcct = () => !!(window.Auth && Auth.isAccount && Auth.isAccount());
  const nextMidnight = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); };
  const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };

  let busy = false, tick = null, opener = null, state = "";
  const el = { m: $("#free"), t: $("#free-title"), msg: $("#free-msg"), amt: $("#free-amount"), ico: $("#free-ico"), next: $("#free-next"), when: $("#free-when"), count: $("#free-count"), btn: $("#free-btn") };

  function setNext(on) {
    el.next.classList.toggle("hidden", !on); clearInterval(tick); if (!on) return;
    const target = nextMidnight();
    el.when.textContent = `Tomorrow at ${target.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    const upd = () => {
      const left = target - Date.now();
      if (left <= 0) { clearInterval(tick); refreshDot(); if (!el.m.classList.contains("hidden") && !busy) render(claimedToday() ? "already" : "available"); return; }
      el.count.textContent = `in ${clock(left)}`;
    };
    upd(); tick = setInterval(upd, 1000);
  }
  function render(s, note) {
    state = s; const ok = s === "available";
    el.ico.textContent = s === "success" ? "🎉" : s === "already" ? "⏳" : s === "error" ? "⚠️" : "🎁";
    el.amt.classList.toggle("hidden", !(ok || s === "success"));
    el.btn.disabled = false; el.btn.classList.remove("hidden");
    if (s === "loading") { el.t.textContent = "Free Coins"; el.msg.textContent = "Checking your daily reward..."; el.btn.classList.add("hidden"); setNext(false); }
    else if (ok) { el.t.textContent = "Free Coins"; el.msg.textContent = `Claim ${AMOUNT} free coins. You can do this once every day.`; el.btn.textContent = `Claim ${AMOUNT} coins`; setNext(false); }
    else if (s === "success") { el.t.textContent = "Coins claimed!"; el.msg.textContent = `Success! ${AMOUNT} coins were added to your balance. You now have ${Player.data.coins} 🪙.`; el.btn.textContent = "Awesome"; setNext(true); }
    else if (s === "already") { el.t.textContent = "Free Coins"; el.msg.textContent = "You’ve already claimed your free coins today! Come back tomorrow."; el.btn.textContent = "OK"; setNext(true); }
    else { el.t.textContent = "Free Coins"; el.msg.textContent = note || "Free coins aren’t available right now. Please try again later."; el.btn.textContent = "Close"; setNext(false); }
    if (!el.btn.classList.contains("hidden")) el.btn.focus({ preventScroll: true });
  }
  async function open(from) {
    opener = from || null; el.m.classList.remove("hidden"); lockModal(true);
    if (isAcct()) {                                            // signed in: ask the server what was claimed (works across devices)
      render("loading");
      const s = await Auth.freeCoins.status();
      if (s && !s.error && s.last_claim_day) writeDay(String(s.last_claim_day).slice(0, 10));
    }
    if (el.m.classList.contains("hidden")) return;             // closed while loading
    render(claimedToday() ? "already" : "available"); refreshDot();
  }
  function close() {
    if (el.m.classList.contains("hidden")) return;
    clearInterval(tick); el.m.classList.add("hidden"); lockModal(false); refreshDot();
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  }
  async function claim() {
    if (busy) return; busy = true; el.btn.disabled = true;     // one claim at a time (double taps, repeated clicks)
    try {
      if (claimedToday()) return render("already");            // re-read from storage right now (other tab, refresh, etc.)
      const day = todayStr();
      if (isAcct()) {
        const r = await Auth.freeCoins.claim(day);
        if (!r || r.error) return render("error", r && r.error === "offline" ? "You need to be online to claim your free coins. Please try again when you’re connected." : "Free coins aren’t available right now. Please try again later.");
        if (!r.ok) {
          if (r.reason === "bad_day") return render("error", "Your device’s date looks wrong. Please correct it and try again.");
          writeDay(validDay(String(r.last_claim_day).slice(0, 10)) ? String(r.last_claim_day).slice(0, 10) : day); return render("already");
        }
      }
      writeDay(day);                                           // save the claim first, then pay: a crash in between can only lose the claim, never double it
      if (!Player.addCoins(AMOUNT)) return render("error");
      refreshCoins(); if (typeof sfx !== "undefined" && sfx.coin) sfx.coin();
      toast(`+${AMOUNT} free coins!`, "success"); refreshDot(); render("success");
    } finally { busy = false; }
  }
  function refreshDot() { const free = !claimedToday(); document.querySelectorAll("[data-free-coins]").forEach((b) => b.classList.toggle("has-free", free)); }

  document.addEventListener("click", (e) => { const b = e.target.closest("[data-free-coins]"); if (b) { e.preventDefault(); e.stopPropagation(); open(b); } }, true);
  el.btn.onclick = () => { if (state === "available") claim(); else close(); };
  $("#free-x").onclick = close;
  el.m.addEventListener("click", (e) => { if (e.target === el.m) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.m.classList.contains("hidden")) close(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshDot(); });
  setInterval(refreshDot, 60000); refreshDot();
  window.FreeCoins = { open, claim, claimedToday, refreshDot };
})();