// Storage namespace. Guests use the original "wb_*" keys (so existing progress is untouched).
// A signed-in account uses "wb_*_<userId>", so guest and account data never mix on one device.
// (This holds game data only. Auth tokens are stored by the Supabase client, not by this app.)
window.WB_NS = localStorage.getItem("wb_active_ns") || "";
window.wbKey = (k) => (k === "settings" ? "wb_settings" : "wb_" + k + (WB_NS ? "_" + WB_NS : ""));
