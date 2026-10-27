// Sign-in for the console, straight against Supabase Auth's REST API (no SDK): email and password, then the
// authenticator code (TOTP). The session lives in this tab only (sessionStorage), never localStorage: closing the tab
// ends it. Only the public publishable key is here; the service key never reaches the browser.
export const SUPABASE_URL = __SUPABASE_URL__;
export const SUPABASE_KEY = __SUPABASE_KEY__;
const SKEY = "fincom-console:session";
const IDLE_MS = 30 * 60 * 1000;     // signed out after 30 minutes without activity
let sess = null;
try { sess = JSON.parse(sessionStorage.getItem(SKEY) || "null"); } catch { sess = null; }
const subs = new Set();
let endedWhy = "";                   // why the last session ended (shown on the sign-in page)
export const ended = () => endedWhy;
export const clearEnded = () => { endedWhy = ""; };
const emit = () => subs.forEach((f) => f(sess));
export const onSession = (f) => { subs.add(f); return () => subs.delete(f); };
function save(s) {
  sess = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
               user: s.user ? { id: s.user.id, email: s.user.email } : sess?.user, last: Date.now(), ended: "" } : null;
  try { s ? sessionStorage.setItem(SKEY, JSON.stringify(sess)) : sessionStorage.removeItem(SKEY); } catch { /* private window */ }
  emit();
}
export const session = () => sess;

export function claims(t) {
  try { const p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(atob(p + "=".repeat((4 - p.length % 4) % 4))); } catch { return {}; }
}
export const aal = () => (sess ? claims(sess.access_token).aal || "aal1" : "");

const WORDS = {
  invalid_credentials: "Wrong email or password.",
  user_banned: "This account is switched off. Contact FinCom support.",
  mfa_verification_failed: "That code is not right. Use the newest code from your authenticator app.",
  mfa_challenge_expired: "That took too long. Enter the newest code.",
  over_request_rate_limit: "Too many tries. Wait a few minutes.",
  email_not_confirmed: "Confirm your email first.",
};
async function gotrue(path, { method = "POST", body, token } = {}) {
  let r;
  try {
    r = await fetch(SUPABASE_URL + "/auth/v1" + path, {
      method, headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + (token || SUPABASE_KEY), "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error("Could not reach FinCom. Check the connection and try again."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = j.error_code || j.code || "";
    const banned = /banned/i.test(String(j.msg || j.message || j.error_description || ""));
    throw new Error(banned ? WORDS.user_banned : WORDS[code] || (r.status === 429 ? WORDS.over_request_rate_limit : "Sign-in failed. Try again."));
  }
  return j;
}

export async function signIn(email, password) { save(await gotrue("/token?grant_type=password", { body: { email: email.trim(), password } })); }
export async function myFactors() {
  const u = await gotrue("/user", { method: "GET", token: await token() });
  return (u.factors || []).filter((f) => f.factor_type === "totp");
}
export async function enroll() {
  return await gotrue("/factors", { token: await token(), body: { factor_type: "totp", friendly_name: "FinCom Console " + new Date().toISOString().slice(0, 16) } });
}
export async function verify(factorId, code) {
  const t = await token();
  const c = await gotrue(`/factors/${encodeURIComponent(factorId)}/challenge`, { token: t });
  save(await gotrue(`/factors/${encodeURIComponent(factorId)}/verify`, { token: t, body: { challenge_id: c.id, code: code.replace(/\s/g, "") } }));
}
export async function signOut(why = "") {
  const t = sess?.access_token;
  endedWhy = why;
  save(null);
  if (t) gotrue("/logout", { token: t }).catch(() => {});
}

// the access token, refreshed when it is about to run out
let refreshing = null;
export async function token() {
  if (!sess) throw new Error("Sign in first.");
  if (Date.now() - (sess.last || 0) > IDLE_MS) { await signOut("You were signed out after 30 minutes without activity."); throw new Error("Signed out."); }
  if (sess.expires_at - 60 > Date.now() / 1000) return sess.access_token;
  refreshing = refreshing || gotrue("/token?grant_type=refresh_token", { body: { refresh_token: sess.refresh_token } })
    .then((s) => save(s), (e) => { save(null); throw e; }).finally(() => { refreshing = null; });
  await refreshing;
  return sess.access_token;
}

// activity keeps the session alive; 30 minutes without it signs out (checked every 15 s and when the tab returns)
export function touch() { if (sess) { sess.last = Date.now(); try { sessionStorage.setItem(SKEY, JSON.stringify(sess)); } catch { /* */ } } }
let idleTimer = 0;
export function watchIdle() {
  const act = () => touch();
  const ev = ["pointerdown", "keydown", "wheel", "touchstart"];
  ev.forEach((e) => addEventListener(e, act, { passive: true }));
  const check = () => { if (sess && Date.now() - (sess.last || 0) > IDLE_MS) signOut("You were signed out after 30 minutes without activity."); };
  idleTimer = setInterval(check, 15000);
  document.addEventListener("visibilitychange", check);
  return () => { ev.forEach((e) => removeEventListener(e, act)); clearInterval(idleTimer); document.removeEventListener("visibilitychange", check); };
}
