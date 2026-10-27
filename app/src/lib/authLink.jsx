// Sign-in links (security review of 26-Oct-2026, M1 "Forged sign-in link"). Before, Google / Microsoft and the email's
// confirmation link came back with the session itself in the address (#access_token=…, Supabase's implicit flow), and
// FinCom signed in whoever's tokens they were: a link made by someone else signed this browser into THEIR account (and
// what was uploaded next went to their firm). Now they use Supabase Auth's PKCE flow: this browser makes a secret (the
// code_verifier) before it sends anyone away, gives Supabase only its hash (code_challenge), and on the way back trades
// the ?code= for a session with that secret (/auth/v1/token?grant_type=pkce). A code started anywhere else cannot be
// traded here, and a session in the address is refused:
//   - Google / Microsoft: the secret in this tab's sessionStorage (the round trip stays in the tab);
//   - the register form: the secret in this browser's localStorage (the email's link opens in a new tab). The link
//     signs in only in the browser that registered; elsewhere (a phone's email app) it says "Email confirmed — now sign
//     in" (the email is confirmed by Supabase either way);
//   - invite and reset links (made by the server; Supabase has no PKCE for them) still bring #access_token=…&type=…:
//     "choose your password" first, for the login it names, and nothing is kept until the password is saved.
// Its own file, loaded only for these (SignIn.jsx's loadAuthLink; src/js/27 start(), Cloud.oauth, Cloud.signUp).
import Msg from "../parts/Msg.jsx";
import { Box } from "../screens/SignIn.jsx";

export const NOT_HERE = "This sign-in link was not started on this browser — sign in again.";
export const CONFIRMED = "Email confirmed — now sign in.";
const OAUTH = "pkce:oauth", SIGNUP = () => LocalOwner.P + "pkce:signup";
const base = () => Cloud.cfg().url.replace(/\/+$/, "");
const page = () => location.origin + location.pathname;
const b64u = (bytes) => btoa(String.fromCharCode.apply(null, new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const secret = () => b64u(crypto.getRandomValues(new Uint8Array(32)));                    // 43 characters
const challenge = async (v) => b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
const claims = (t) => { try { return JSON.parse(decodeURIComponent(escape(atob(String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))))) || {}; } catch (e) { return {}; } };

// "Continue with Google / Microsoft"
export async function startOAuth(provider) {
  const v = secret(), ch = await challenge(v);
  LocalOwner.ss(OAUTH, v);
  location.assign(base() + "/auth/v1/authorize?provider=" + encodeURIComponent(provider) + "&redirect_to=" + encodeURIComponent(page()) +
    "&code_challenge=" + ch + "&code_challenge_method=s256" + (provider === "azure" ? "&scopes=email" : ""));
}

// the register form (the signup function passes the challenge to Supabase's sign-up; its link comes back to #confirmed)
export async function signUp(d) {
  const v = secret(), ch = await challenge(v);
  try { localStorage.setItem(SIGNUP(), v); } catch (e) { /* storage blocked: the link then says "Email confirmed — now sign in" */ }
  const r = await fetch(base() + "/functions/v1/signup", { method: "POST", headers: { apikey: Cloud.cfg().key, "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({}, d, { redirect: page() + "#confirmed", challenge: ch, captcha_token: window.fincomBot ? await window.fincomBot() : undefined })) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || "The account could not be made.");
  return j;
}

async function trade(code, verifier) {
  const r = await fetch(base() + "/auth/v1/token?grant_type=pkce", { method: "POST", headers: { apikey: Cloud.cfg().key, "Content-Type": "application/json" }, body: JSON.stringify({ auth_code: code, code_verifier: verifier }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) { const e = new Error(j.msg || j.error_description || j.message || "Sign-in failed (" + r.status + ")"); e.code = j.error_code || ""; throw e; }
  return j;
}
function signedIn(j, how) {
  const u = j.user || {}, c = claims(j.access_token), email = String(u.email || c.email || ""), uid = String(u.id || c.sub || "");
  Cloud.setSess({ access_token: j.access_token, refresh_token: j.refresh_token, at: Date.now(), expires_in: j.expires_in || 3600, email, user_id: uid });
  if (email) Cloud.setCfg({ email });
  S.authReturn = how;
}

// FinCom opened from a sign-in link (src/js/27 start(), before whose copy is opened is decided): signs in only what this
// browser started, and takes the link out of the address
export async function takeReturn() {
  const u = new URL(location.href), q = u.searchParams, h = new URLSearchParams(u.hash.replace(/^#/, ""));
  const code = q.get("code") || "", tok = h.get("access_token") || "", type = h.get("type") || "", confirm = h.has("confirmed");
  const err = q.get("error_description") || h.get("error_description") || "";
  ["code", "error", "error_code", "error_description", "sb"].forEach((k) => q.delete(k));
  const hashGone = tok || confirm || err || h.has("sb");
  try { history.replaceState(null, "", u.pathname + (q.toString() ? "?" + q : "") + (hashGone ? "" : u.hash)); } catch (e) { /* */ }
  const st = Cloud.st;
  if (err && !code && !tok) { st.error = "Sign-in did not finish: " + err.slice(0, 200); return; }
  if (tok) {
    // invite / reset: the password first, for the login the link names; its session only in memory until then
    if (type === "invite" || type === "recovery") {
      S.setPassword = { type, email: String(claims(tok).email || ""), sess: { access_token: tok, refresh_token: h.get("refresh_token") || "", at: Date.now(), expires_in: Number(h.get("expires_in")) || 3600 } };
      return;
    }
    // anything else in the address is refused; a confirmation link of the old kind has confirmed the email all the same
    if (type === "signup") { S.signedOutWhy = CONFIRMED; Cloud.setCfg({ gate: true }); } else st.error = NOT_HERE;
    return;
  }
  if (!code) return;
  if (confirm) {
    let v = null; try { v = localStorage.getItem(SIGNUP()); } catch (e) { /* */ }
    if (v) {
      try { signedIn(await trade(code, v), "signup"); try { localStorage.removeItem(SIGNUP()); } catch (e) { /* */ } return; } catch (e) { /* not this browser's: as below */ }
    }
    S.signedOutWhy = CONFIRMED; Cloud.setCfg({ gate: true });
    return;
  }
  const v = LocalOwner.ss(OAUTH);
  LocalOwner.ss(OAUTH, null);
  if (!v) { st.error = NOT_HERE; return; }
  try { signedIn(await trade(code, v), "oauth"); }
  catch (e) { st.error = e.code === "bad_code_verifier" || e.code === "flow_state_not_found" ? NOT_HERE : "Sign-in did not finish: " + String(e.message).slice(0, 200); }
}

// "choose your password" (an invite or a reset link): saved with the link's own sign-in, which is kept only then
async function save() {
  const a = (document.getElementById("spw1") || {}).value || "", b = (document.getElementById("spw2") || {}).value || "";
  const f = S.setPassword || (S.setPassword = {});
  // errors under the box they are about (errAt), the server's under the form
  if (a.length < 10 || !/[A-Za-z]/.test(a) || !/\d/.test(a)) { f.error = "Use 10 characters or more, with letters and digits."; f.errAt = "spw1"; render(); return; }
  if (a !== b) { f.error = "The two passwords are not the same."; f.errAt = "spw2"; render(); return; }
  f.errAt = "";
  const s = f.sess || Cloud.sess() || {};
  Cloud.st.busy = "saving"; render();
  try {
    const r = await fetch(base() + "/auth/v1/user", { method: "PUT", headers: { apikey: Cloud.cfg().key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json" }, body: JSON.stringify({ password: a }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.msg || j.error_description || j.message || "The password could not be saved.");
    const email = String(j.email || f.email || ""), uid = String(j.id || claims(s.access_token).sub || "");
    Cloud.setSess(Object.assign({}, s, { email, user_id: uid }));
    Cloud.setCfg({ email });
    S.setPassword = null; Cloud.st.busy = "";
    auditEvent("password_set", f.type || "");
    // another person than the owner of the copy open here: their own copy, in a fresh page (as Cloud.signIn)
    if (LocalOwner.other(uid)) { LocalOwner.switchTo(uid, "", email); return; }
    if (!(await Cloud.checkMfa())) await Cloud.whoAmI();
    render();
  } catch (e) { Cloud.st.busy = ""; f.error = e.message; f.errAt = ""; render(); }
}

// arrived from an invite or a reset link (review item 21): the person chooses their password first, in the sign-in pages'
// frame (SignIn.jsx Box; the owner, 27-Oct-2026: one heading, whose login it is, the two boxes, the button)
export function SetPassword() {
  const f = S.setPassword || {}, busy = Cloud.st.busy, rec = f.type === "recovery", who = f.email, at = f.error ? f.errAt || "" : "";
  const box = (id, label, hint, first) => <div className="signin-field"><label htmlFor={id}>{label}</label>
    <input type="password" id={id} autoComplete="new-password" autoFocus={first} aria-invalid={at === id ? "true" : undefined} aria-describedby={at === id ? id + "-err" : hint ? id + "-hint" : undefined}
      onInput={() => { if (at === id) { f.error = ""; render(); } }} />
    {at === id ? <span className="signin-field-err" id={id + "-err"}>{f.error}</span> : hint ? <span className="signin-hint" id={id + "-hint"}>{hint}</span> : null}</div>;
  return <Box><h1>{rec ? "Choose a new password" : "Welcome to FinCom"}</h1>
    {who && <div className="signin-sub" data-setpw-who="">{rec ? "For " : "Choose the password for "}<b>{who}</b></div>}
    <form className="signin-form" noValidate onSubmit={(ev) => { ev.preventDefault(); if (!busy) save(); }}>
      {box("spw1", "New password", "10 characters or more, with letters and digits.", true)}
      {box("spw2", "Repeat the new password")}
      <button type="submit" className="btn primary signin-submit" data-act="setPasswordGo" disabled={!!busy}>{busy ? "Saving…" : "Save and continue"}</button>
      {f.error && !at && <div className="signin-error" role="alert" data-signin-error=""><Msg text={f.error} /></div>}</form></Box>;
}
