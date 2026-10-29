// Free daily coins: FREE_COINS.amount (25) once a day from the GAME screen (the "+" next to the coins)
// and once a day from the SHOP (the Free Coins box). The two places have separate daily limits.
// Signed-in players: the SERVER (Supabase function claim_free_coins) remembers the last claimed day for each place, so
// refreshing, clearing the browser or using another device cannot claim twice.
// Guests: the claimed day is saved on this device (guest progress already lives only on the device).
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const AMOUNT = FREE_COINS.amount;
  const KEYS = { game: "free_claim", shop: "free_claim_shop" };         // one saved day per place
  const pad = (n) => String(n).padStart(2, "0");
  const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // the player's local date
  const todayStr = () => dayOf(new Date());
  const validDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const readDay = (place) => { const r = load(KEYS[place], {}); return r && validDay(r.day) ? r.day : ""; };          // always read fresh from storage
  const writeDay = (place, d) => { d = d ? String(d).slice(0, 10) : ""; if (KEYS[place] && validDay(d) && d > readDay(place)) save(KEYS[place], { day: d }); }; // never moves backwards
  const claimedToday = (place) => readDay(place) >= todayStr();                                                         // turning the clock back cannot re-open a claim
  const isAcct = () => !!(window.Auth && Auth.isAccount && Auth.isAccount());
  const nextMidnight = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); };
  const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; };
  const whenText = () => `Tomorrow at ${nextMidnight().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  const ALREADY = "You’ve already claimed your free coins today! Come back tomorrow.";
  const OFFLINE = "You need to be online to claim your free coins. Please try again when you’re connected.";
  const UNAVAILABLE = "Free coins aren’t available right now. Please try again later.";
  const BADDATE = "Your device’s date looks wrong. Please correct it and try again.";

  const busy = { game: false, shop: false };
  async function syncFromServer() {                                    // signed in: copy what the server knows into this device
    if (!isAcct()) return;
    const s = await Auth.freeCoins.status();
    if (s && !s.error) { writeDay("game", s.game); writeDay("shop", s.shop); }
  }
  // The one place coins are granted. Returns { status: "claimed" | "already" | "error", note }.
  async function claim(place) {
    if (!KEYS[place] || busy[place]) return { status: "busy" };      // one claim at a time per place (double taps, repeated clicks)
    busy[place] = true;
    try {
      if (claimedToday(place)) return { status: "already" };          // re-read from storage right now (other tab, refresh, etc.)
      const day = todayStr();
      if (isAcct()) {
        const r = await Auth.freeCoins.claim(day, place);
        if (!r || r.error) return { status: "error", note: r && r.error === "offline" ? OFFLINE : UNAVAILABLE };
        if (!r.ok) {
          if (r.reason === "bad_day") return { status: "error", note: BADDATE };
          writeDay(place, r.last_claim_day || day); return { status: "already" };
        }
      }
      writeDay(place, day);                                           // save the claim first, then pay: a crash in between can only lose the claim, never double it
      if (!Player.addCoins(AMOUNT)) return { status: "error", note: UNAVAILABLE };
      refreshCoins(); if (typeof sfx !== "undefined" && sfx.coin) sfx.coin();
      return { status: "claimed" };
    } finally { busy[place] = false; refreshDot(); syncShopButton(); }
  }

  // ---------- game screen: the "+" opens a popup ----------
  let tick = null, opener = null, state = "";
  const el = { m: $("#free"), t: $("#free-title"), msg: $("#free-msg"), amt: $("#free-amount"), ico: $("#free-ico"), next: $("#free-next"), when: $("#free-when"), count: $("#free-count"), btn: $("#free-btn") };
  function setNext(on) {
    el.next.classList.toggle("hidden", !on); clearInterval(tick); if (!on) return;
    const target = nextMidnight(); el.when.textContent = whenText();
    const upd = () => {
      const left = target - Date.now();
      if (left <= 0) { clearInterval(tick); refreshDot(); if (!el.m.classList.contains("hidden") && !busy.game) render(claimedToday("game") ? "already" : "available"); return; }
      el.count.textContent = `in ${clock(left)}`;
    };
    upd(); tick = setInterval(upd, 1000);
  }
  function render(s, note) {
    state = s; const ok = s === "available";
    el.ico.textContent = s === "success" ? "🎉" : s === "already" ? "⏳" : s === "error" ? "⚠️" : "🎁";
    el.amt.textContent = `+${AMOUNT} 🪙`; el.amt.classList.toggle("hidden", !(ok || s === "success"));
    el.btn.disabled = false; el.btn.classList.remove("hidden");
    if (s === "loading") { el.t.textContent = "Free Coins"; el.msg.textContent = "Checking your daily reward..."; el.btn.classList.add("hidden"); setNext(false); }
    else if (ok) { el.t.textContent = "Free Coins"; el.msg.textContent = `Claim ${AMOUNT} free coins. You can do this once every day.`; el.btn.textContent = `Claim ${AMOUNT} coins`; setNext(false); }
    else if (s === "success") { el.t.textContent = "Coins claimed!"; el.msg.textContent = `Success! ${AMOUNT} coins were added to your balance. You now have ${Player.data.coins} 🪙.`; el.btn.textContent = "Awesome"; setNext(true); }
    else if (s === "already") { el.t.textContent = "Free Coins"; el.msg.textContent = ALREADY; el.btn.textContent = "OK"; setNext(true); }
    else { el.t.textContent = "Free Coins"; el.msg.textContent = note || UNAVAILABLE; el.btn.textContent = "Close"; setNext(false); }
    if (!el.btn.classList.contains("hidden")) el.btn.focus({ preventScroll: true });
  }
  async function open(from) {
    opener = from || null; el.m.classList.remove("hidden"); lockModal(true);
    if (isAcct()) { render("loading"); await syncFromServer(); }
    if (el.m.classList.contains("hidden")) return;                    // closed while loading
    render(claimedToday("game") ? "already" : "available"); refreshDot();
  }
  function close() {
    if (el.m.classList.contains("hidden")) return;
    clearInterval(tick); el.m.classList.add("hidden"); lockModal(false); refreshDot();
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  }
  async function claimFromPopup() {
    el.btn.disabled = true;
    const r = await claim("game");
    if (r.status === "busy") return;
    if (r.status === "claimed") { toast(`+${AMOUNT} free coins!`, "success"); return render("success"); }
    render(r.status === "already" ? "already" : "error", r.note);
  }
  function refreshDot() { const free = !claimedToday("game"); document.querySelectorAll("[data-free-coins]").forEach((b) => b.classList.toggle("has-free", free)); }

  // ---------- shop: the Free Coins box ----------
  let shopTick = null;                                                // live countdown on the Shop's Free Coins box
  const stopShopTick = () => { clearInterval(shopTick); shopTick = null; };
  function syncShopButton() {
    const b = $("[data-free-shop]"); if (!b) return stopShopTick();
    const done = claimedToday("shop"), note = b.parentElement.querySelector("[data-free-next]");
    b.textContent = done ? "Claimed" : "Claim"; b.disabled = done; b.classList.toggle("claimed", done);
    b.setAttribute("aria-label", done ? "Free coins claimed. Come back tomorrow." : `Claim ${AMOUNT} free coins`);
    if (note) note.textContent = done ? `Next claim in ${clock(nextMidnight() - Date.now())}` : "Once a day";
    if (!done) stopShopTick();                                        // reset reached: the button is enabled again
    else if (!shopTick) shopTick = setInterval(() => { const s = $("#shop"); if (!s || s.classList.contains("hidden")) return stopShopTick(); syncShopButton(); }, 1000);
  }
  async function syncShop() { syncShopButton(); if (isAcct()) { await syncFromServer(); syncShopButton(); } }
  async function claimFromShop(b) {
    b.disabled = true;
    const r = await claim("shop");
    if (r.status === "busy") return;
    if (r.status === "claimed") { toast(`+${AMOUNT} free coins added!`, "success"); if (typeof shopFx === "function") shopFx(b.closest(".gcard"), `+${AMOUNT} 🪙`, "gain"); }
    else if (r.status === "already") toast(ALREADY, "error", 3200);
    else toast(r.note || UNAVAILABLE, "error", 3200);
    syncShopButton();
  }

  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-free-coins]"); if (f) { e.preventDefault(); e.stopPropagation(); open(f); return; }
    const s = e.target.closest("[data-free-shop]"); if (s && !s.disabled) { e.preventDefault(); claimFromShop(s); }
  }, true);
  el.btn.onclick = () => { if (state === "available") claimFromPopup(); else close(); };
  $("#free-x").onclick = close;
  el.m.addEventListener("click", (e) => { if (e.target === el.m) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.m.classList.contains("hidden")) close(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { refreshDot(); syncShopButton(); } });
  setInterval(() => { refreshDot(); syncShopButton(); }, 60000); refreshDot();
  window.FreeCoins = { open, claim, claimedToday, refreshDot, syncShop, claimFromShop };
})();