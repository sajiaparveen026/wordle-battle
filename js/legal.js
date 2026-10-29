// Terms / Privacy pages: the Back link returns to where the player came from.
// From the signup form it goes back to that same form (the app restores what was typed; passwords are never kept).
(() => {
  const back = document.getElementById("back");
  if (!back) return;
  if (new URLSearchParams(location.search).get("from") === "signup") { back.href = "./#signup"; back.textContent = "← Back to sign up"; }
  back.addEventListener("click", (e) => {
    try {
      if (history.length > 1 && document.referrer && new URL(document.referrer).origin === location.origin) { e.preventDefault(); history.back(); } // same entry the player left (works with the browser Back button too)
    } catch {}
  });
})();