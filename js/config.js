// Supabase settings. Leave blank to run in LOCAL DEMO MODE (solo play only).
// Use the anon/public key only. NEVER put a service-role key in frontend code.
window.CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: ""
};
window.DEMO_MODE = !(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
