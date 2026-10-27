// The sign-in page, before anything of the firm is shown: sign in, create an account, or two-step sign-in (a code from
// an authenticator app); "choose your password" is lib/authLink.jsx's. Was viewSignIn (src/js/27), viewSignUp (src/js/27) and viewTwoStep (src/js/43). Buttons are
// doAct cases (cloudSignIn, cloudSignUp, showSignUp, showSignIn, oauthGoogle, oauthAzure, useOffline) and mfaAction (src/js/43); the boxes keep
// their data-cloud and id, which those read, and the buttons their data-act (the old tests press them by it); and what is typed is kept in S.cloudForm (cloudForm).
import Msg from "../parts/Msg.jsx";
import { Suspense, lazy, useEffect, useRef } from "react";
import { staleReload } from "../staleChunk.js";

const Act = ({ act, className = "btn primary", children, disabled }) => <button className={className} data-act={act} disabled={disabled} onClick={() => doAct(act)}>{children}</button>;
export const Box = ({ children }) => <div className="signin"><div className="signin-box">{children}</div></div>;
const Field = ({ label, k, type = "text", fk, auto, first }) => {
  const f = S.cloudForm || {}, c = Cloud.cfg(), ref = useRef(null);
  useEffect(() => { if (first && ref.current && !document.activeElement.matches("input")) ref.current.focus(); }, []);
  return <label className="f" style={first ? undefined : { marginTop: 8 }}><span>{label}</span><input ref={ref} type={type} data-cloud={k} data-fk={fk} aria-label={label} autoComplete={auto}
    defaultValue={f[k] || (k === "email" ? c.email || "" : "")} onChange={(ev) => cloudForm(k, ev.target.value)} /></label>;
};
// the bot check (lib/bot.jsx, Cloudflare Turnstile): only in a build with a site key (vite.config.js); without one, not
// in the build at all and the forms are as before
const Bot = __TURNSTILE_KEY__ ? lazy(() => import("../lib/bot.jsx")) : null;
export const BotBox = ({ action }) => Bot ? <Suspense fallback={null}><Bot action={action} /></Suspense> : null;
export const Err = () => Cloud.st.error ? <p className="bk-warn" style={{ marginTop: 10 }}><Msg text={Cloud.st.error} /></p> : null;
// "Keep me signed in" (section D, 03-Oct-2026): ticked, the session is kept on this computer (localStorage) until you sign
// out; unticked, in this tab only (sessionStorage), gone when the browser closes. Read by Cloud.signIn (src/js/43).
// Nothing signs you out by itself either way.
export const KeepBox = () => <label className="chk keep-box" style={{ marginTop: 10 }}><input type="checkbox" data-cloud="keep" defaultChecked /><span>Keep me signed in on this computer <span className="note">(untick on a shared computer: the sign-in ends when the browser is closed)</span></span></label>;

// signup v12 (26-Oct-2026): anyone may create an account again. The register page (#/register) sends the form to the
// signup function, which answers every email the same way; the firm and its starting credit are made only after the
// email's link is clicked, on the first sign-in (Cloud.whoAmI → Cloud.provision, src/js/27).
export const CHECK_EMAIL = "Check your email and click the link to confirm, then sign in.";
// "Continue with Google / Microsoft": only the providers switched on in Supabase Auth (loadAuthProviders, src/js/27). Laid
// out as Claude's sign-in (owner, 26-Oct-2026): the provider buttons at the top, full width with their logos, a thin "or"
// line, then the email form; with no provider switched on, neither the buttons nor the line, the form alone
const GoogleLogo = () => <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>;
const MicrosoftLogo = () => <svg aria-hidden="true" width="18" height="18" viewBox="0 0 21 21"><path fill="#F25022" d="M1 1h9v9H1z"/><path fill="#7FBA00" d="M11 1h9v9h-9z"/><path fill="#00A4EF" d="M1 11h9v9H1z"/><path fill="#FFB900" d="M11 11h9v9h-9z"/></svg>;
const OAuth = () => {
  useEffect(() => { if (typeof loadAuthProviders === "function") loadAuthProviders(); });
  const p = S.authProviders || {};
  if (!p.google && !p.azure) return null;
  return <><div className="oauth-list" data-oauth="">
    {p.google && <button className="btn oauth-btn" data-act="oauthGoogle" onClick={() => doAct("oauthGoogle")}><GoogleLogo /><span>Continue with Google</span></button>}
    {p.azure && <button className="btn oauth-btn" data-act="oauthAzure" onClick={() => doAct("oauthAzure")}><MicrosoftLogo /><span>Continue with Microsoft</span></button>}</div>
    <div className="signin-or" data-oauth-or="" role="separator"><span>or</span></div></>;
};
function SignUp() {
  const st = Cloud.st;
  if (S.signUpSent) return <Box><h1>Create an account</h1><p className="note" style={{ margin: "8px 0 14px" }} data-signup-sent="">{CHECK_EMAIL}</p>
    <p className="note" style={{ marginTop: 14 }}>Already have an account? <Act act="showSignIn" className="linkbtn">Sign in</Act></p></Box>;
  return <Box><h1>Create an account</h1><p className="note" style={{ margin: "8px 0 14px" }}>Your firm gets its own space. Nobody else can see your data.</p>
    <OAuth />
    <Field label="Your name" k="name" fk="suname" auto="name" first /><Field label="Firm name" k="firm" fk="sufirm" auto="organization" /><Field label="Email" k="email" type="email" fk="cloudemail" auto="username" />
    <Field label="Password (10 characters or more, letters and digits)" k="password" type="password" fk="cloudpw" auto="new-password" />
    <BotBox action="signup" />
    <div className="row" style={{ marginTop: 12 }}><Act act="cloudSignUp" disabled={!!st.busy}>{st.busy ? "Sending…" : "Create the account"}</Act></div><Err />
    <p className="note" style={{ marginTop: 14 }}>Already have an account? <Act act="showSignIn" className="linkbtn">Sign in</Act></p></Box>;
}

// two-step sign-in (an authenticator app's code; its setup with the QR code): its own file, fetched only for an account that
// uses it (integ-link, 27-Oct-2026: the app's first file at its size budget, tests/run_stability.py)
const TwoStep = lazy(() => import("../parts/TwoStep.jsx").catch((e) => { staleReload(e, true); throw e; }));

// sign-in links (lib/authLink.jsx, its own file: the PKCE flow, the way back from Google / Microsoft and the email's
// links, "choose your password"): loaded when FinCom opens from such a link (src/js/27 start()), for "Continue with
// Google / Microsoft" (Cloud.oauth) and for the register form (Cloud.signUp)
let link = null;
window.loadAuthLink = () => import("../lib/authLink.jsx").then((m) => (link = m), (e) => { staleReload(e, true); throw e; });

export default function SignIn() {
  const st = Cloud.st;
  if (S.setPassword) return link ? <link.SetPassword /> : null;
  if (Cloud.on() && st.mfa) return <Suspense fallback={<Box><h1>Two-step sign-in</h1></Box>}><TwoStep /></Suspense>;
  if (S.signUpOpen) return <SignUp />;
  return <Box><h1>FinCom</h1>
    <p className="note">{S.firm && S.firm.firmName ? S.firm.firmName : "Finance and compliance, in one place"}</p>
    <p className="note" style={{ margin: "2px 0 0" }}><a href="welcome/">What is FinCom?</a></p>
    {/* stability batch 6: the same "No internet" line as the sidebar's, when this computer has no line */}
    {typeof navigator === "object" && navigator.onLine === false && <p className="note warn" data-offline-line="" style={{ margin: "10px 0 0" }}>No internet · work kept on this computer. Sign in when the line is back, or use FinCom here without an account (below).</p>}
    {S.signedOutWhy ? <p className="bk-alert" data-signed-out-why="" style={{ margin: "10px 0 14px" }}>{S.signedOutWhy}</p>
      : <p className="note" style={{ margin: "10px 0 14px" }}>Sign in to see your firm’s work. Nothing is shown before that.</p>}
    <OAuth />
    <Field label="Email" k="email" type="email" fk="cloudemail" auto="username" first /><Field label="Password" k="password" type="password" fk="cloudpw" auto="current-password" />
    <KeepBox />
    <BotBox action="login" />
    <div className="row" style={{ marginTop: 12 }}><Act act="cloudSignIn" disabled={!!st.busy}>{st.busy ? "Signing in…" : "Sign in"}</Act></div><Err />
    <p className="note" style={{ marginTop: 14 }}>Forgotten the password? Ask the person who runs your firm’s account to send you a reset link. After 5 wrong passwords the account is locked for 15 minutes.</p>
    <p className="note" style={{ marginTop: 10 }}>No internet on this computer? <Act act="useOffline" className="linkbtn">Use it here without an account</Act> — the work stays on this computer only.</p>
    <p className="note" style={{ marginTop: 6 }}>New to FinCom? <Act act="showSignUp" className="linkbtn">Create an account</Act></p></Box>;
}
