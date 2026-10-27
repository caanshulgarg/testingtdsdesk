// Feature flags set in the FinCom Console (migration 123): every flag for this person's firm, read ONCE through
// flags_for_me() and kept (this tab: memory; across reloads: localStorage for 10 minutes), so a screen asks
// flag("zoho_books") without a request. Before the first answer (or when the database has no migration 123 yet)
// flag() gives the screen's own default. window.FinComFlags.on(key, dflt) for the old scripts (src/js).
const KEY = "fincom:flags", TTL = 10 * 60 * 1000;
let flags = null, at = 0, tried = 0, busy = null, who = "";
// the signed-in person: flags are kept per person (another sign-in in this browser starts afresh)
const me = () => { try { const s = typeof Cloud === "object" && Cloud.sess(); return String((s && s.user && s.user.id) || ""); } catch { return ""; } };
function mine() {
  const u = me();
  if (u === who) return;
  who = u; flags = null; at = 0; tried = 0;
  try { const c = JSON.parse(localStorage.getItem(KEY) || "null"); if (c && u && c.u === u && Date.now() - c.at < TTL && c.f && typeof c.f === "object") { flags = c.f; at = c.at; } } catch { /* storage off */ }
}

export function flag(key, dflt = false) {
  mine();
  if (Date.now() - Math.max(at, tried) > TTL) loadFlags();
  return flags && typeof flags[key] === "boolean" ? flags[key] : dflt;
}
export function loadFlags(force) {
  mine();
  if (busy || (!force && Date.now() - Math.max(at, tried) < TTL)) return busy || Promise.resolve(flags);
  if (typeof Cloud !== "object" || !Cloud.on()) return Promise.resolve(flags);
  tried = Date.now();
  busy = Cloud.api("rpc/flags_for_me", { method: "POST", body: {} }).then((f) => {
    if (f && typeof f === "object" && !Array.isArray(f)) {
      flags = f; at = Date.now();
      try { localStorage.setItem(KEY, JSON.stringify({ u: who, at, f })); } catch { /* storage off */ }
    }
    return flags;
  }, () => flags).finally(() => { busy = null; });   // a refusal (no migration 123 yet): asked again after the TTL
  return busy;
}
if (typeof window === "object") window.FinComFlags = { on: flag, load: loadFlags };
