// The sign-in page, before anything of the firm is shown: sign in, create an account, or two-step sign-in (a code from
// an authenticator app); "choose your password" is lib/authLink.jsx's. Was viewSignIn (src/js/27), viewSignUp (src/js/27) and viewTwoStep (src/js/43). Buttons are
// doAct cases (cloudSignIn, cloudSignUp, showSignUp, showSignIn, oauthGoogle, oauthAzure) and mfaAction (src/js/43); the boxes keep
// their data-cloud and id, which those read, and the buttons their data-act (the old tests press them by it); and what is typed is kept in S.cloudForm (cloudForm).
// 27-Oct-2026 (the owner: "make it professional over login page and signup page"): one frame (Box), one heading, no
// explanations; the email first, then the password in the same card; "Forgot password?" beside the password's label, the lock said only when the account is locked (the
// signin function's answer, under the form), errors under the box they are about (tests/run_signin_clean.py).
import Msg from "../parts/Msg.jsx";
import { Suspense, lazy, useEffect } from "react";
import { staleReload } from "../staleChunk.js";

// the frame of every page before sign-in (sign in, create your account, choose your password, two-step sign-in; the owner,
// 27-Oct-2026: "make it professional"): a centred card with the FinCom mark and name on top, one heading, the form, the
// switch to the other page; under the card © FinCom · Privacy · Terms (the website's pages, welcome/). No other words.
export const Box = ({ children }) => <div className="signin"><div className="signin-box">
  <div className="signin-brand"><span className="side-mark" aria-hidden="true">F</span><span className="signin-brand-name">FinCom</span></div>
  {children}</div>
  <footer className="signin-foot"><span>© FinCom</span><span aria-hidden="true">·</span><a href="welcome/privacy.html">Privacy</a><span aria-hidden="true">·</span><a href="welcome/terms.html">Terms</a></footer></div>;
// errors under the box they are about (S.signinErr: {email: "Enter your email.", ...}), set by the page before anything
// is sent; what the server answers (a wrong password, a locked account) is said under the form (Err)
const clearErr = (k) => { const e = S.signinErr; if (e && e[k]) { S.signinErr = Object.assign({}, e, { [k]: "" }); render(); } };
const focusBox = (k) => setTimeout(() => { const i = document.querySelector('.signin-box input[data-cloud="' + k + '"]:not([readonly])'); if (i) i.focus(); }, 0);
// one box: its label (and beside it, side: "Forgot password?"), the box (a password with its show / hide eye), then its
// hint or its error
const Field = ({ label, k, type = "text", fk, auto, hint, side, children }) => {
  const f = S.cloudForm || {}, c = Cloud.cfg(), err = (S.signinErr || {})[k], id = "si-" + k, pw = type === "password", shown = pw && !!S.signinShowPw;
  const input = <input id={id} type={shown ? "text" : type} data-cloud={k} data-fk={fk} autoComplete={auto} aria-invalid={err ? "true" : undefined}
    aria-describedby={err ? id + "-err" : hint ? id + "-hint" : undefined} spellCheck={pw || k === "email" ? false : undefined}
    defaultValue={f[k] || (k === "email" ? c.email || "" : "")} onChange={(ev) => { cloudForm(k, ev.target.value); clearErr(k); }} />;
  return <div className="signin-field"><div className="signin-label-row"><label htmlFor={id}>{label}</label>{side}</div>
    {pw ? <div className="signin-pw">{input}<button type="button" className="signin-eye" data-pw-toggle="" aria-controls={id} aria-pressed={shown}
      aria-label={shown ? "Hide password" : "Show password"} onClick={() => { S.signinShowPw = !shown; render(); }}>{shown ? <EyeOff /> : <Eye />}</button></div> : input}
    {err ? <span className="signin-field-err" id={id + "-err"}>{err}</span> : hint ? <span className="signin-hint" id={id + "-hint"}>{hint}</span> : null}
    {children}</div>;
};
const Eye = () => <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
const EyeOff = () => <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="M2 2l20 20" /></svg>;
const val = (k) => { const e = document.querySelector('.signin-box [data-cloud="' + k + '"]'); return e ? e.value : ""; };
const emailErr = (v) => !v.trim() ? "Enter your email." : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? "Enter a valid email address." : "";
const PW_RULE = "Use 10 characters or more, with letters and digits.";
// step by step (the owner, 27-Oct-2026: "interactive, like Claude's sign-in"): the email first, then the rest of the form in
// the same card (S.signinStep "more"), the email shown as a line with Edit to go back. The form's button keeps its data-act
// in both steps (the tests find the page by it): on the email step it moves on, on the last it sends the form through the
// doAct case (src/js/27), as before
const step = () => S.signinStep === "more" ? "more" : "email";
const toEmail = () => { S.signinStep = "email"; S.signinErr = null; S.signinForgot = false; S.signinShowPw = false; Cloud.st.error = ""; render(); focusBox("email"); };
const submit = (act, check, firstMore) => (ev) => {
  ev.preventDefault();
  if (Cloud.st.busy) return;
  if (step() === "email") {
    const v = val("email").trim(), e = emailErr(v);
    S.signinErr = { email: e };
    if (!e) { cloudForm("email", v); S.signinStep = "more"; Cloud.st.error = ""; }
    render(); focusBox(e ? "email" : firstMore); return;
  }
  const e = check(), first = Object.keys(e).find((k) => e[k]);
  S.signinErr = e;
  if (first) { Cloud.st.error = ""; render(); focusBox(first); return; }
  doAct(act);
};
const Switch = ({ act, children }) => <button type="button" className="linkbtn" data-act={act} onClick={() => { S.signinErr = null; S.signinForgot = false; S.signinStep = "email"; S.signinShowPw = false; doAct(act); }}>{children}</button>;
// the button: a spinner while the answer is awaited, disabled, its words kept
const Submit = ({ act, busy, children }) => <button type="submit" className="btn primary signin-submit" data-act={act} disabled={!!busy} aria-busy={busy ? "true" : undefined}>
  {busy && <span className="signin-spin" data-spinner="" aria-hidden="true" />}<span>{children}</span></button>;
// the email chosen on the first step: a line with Edit; and the same address in a box password managers read (username)
const EmailLine = () => {
  const em = (S.cloudForm || {}).email || "";
  return <div className="signin-email-line" data-email-line=""><span className="signin-email" title={em}>{em}</span>
    <button type="button" className="linkbtn" data-signin-edit="" aria-label={"Edit the email " + em} onClick={toEmail}>Edit</button>
    <input className="signin-user" type="email" data-cloud="email" autoComplete="username" value={em} readOnly tabIndex={-1} aria-hidden="true" /></div>;
};
// each step comes in with a short fade (signin.css; none when the computer asks for less motion)
const Step = ({ children }) => <div className="signin-step" key={step()} data-step={step()}>{children}</div>;
// the bot check (lib/bot.jsx, Cloudflare Turnstile): only in a build with a site key (vite.config.js); without one, not
// in the build at all and the forms are as before
const Bot = __TURNSTILE_KEY__ ? lazy(() => import("../lib/bot.jsx")) : null;
export const BotBox = ({ action }) => Bot ? <Suspense fallback={null}><Bot action={action} /></Suspense> : null;
export const Err = () => Cloud.st.error ? <div className="signin-error" role="alert" data-signin-error=""><Msg text={Cloud.st.error} /></div> : null;
// "Keep me signed in" (section D, 03-Oct-2026): ticked, the session is kept on this computer (localStorage) until you sign
// out; unticked, in this tab only (sessionStorage), gone when the browser closes. Read by Cloud.signIn (src/js/43).
// Nothing signs you out by itself either way.
export const KeepBox = () => <label className="chk keep-box"><input type="checkbox" data-cloud="keep" defaultChecked /><span>Keep me signed in</span></label>;
// "Forgot password?": there is no reset by email of one's own; the firm's admin sends the link (Settings, Account). The
// link sits beside the password's label, its one line under the box
const ForgotLink = () => <button type="button" className="linkbtn signin-forgot" aria-expanded={!!S.signinForgot} aria-controls="si-forgot-note" onClick={() => { S.signinForgot = !S.signinForgot; render(); }}>Forgot password?</button>;
const ForgotNote = () => <span className="signin-forgot-note" id="si-forgot-note" data-forgot-note="" hidden={!S.signinForgot}>Ask your firm’s admin to send you a reset link.</span>;

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
    {p.google && <button type="button" className="btn oauth-btn" data-act="oauthGoogle" onClick={() => doAct("oauthGoogle")}><GoogleLogo /><span>Continue with Google</span></button>}
    {p.azure && <button type="button" className="btn oauth-btn" data-act="oauthAzure" onClick={() => doAct("oauthAzure")}><MicrosoftLogo /><span>Continue with Microsoft</span></button>}</div>
    <div className="signin-or" data-oauth-or="" role="separator"><span>or</span></div></>;
};
function SignUp() {
  const st = Cloud.st;
  if (S.signUpSent) return <Box><h1>Check your email</h1><div className="signin-sub" data-signup-sent="">{CHECK_EMAIL}</div>
    <div className="signin-switch">Already have an account? <Switch act="showSignIn">Sign in</Switch></div></Box>;
  const check = () => {
    const pw = val("password");
    return { name: val("name").trim() ? "" : "Enter your name.", firm: val("firm").trim() ? "" : "Enter your firm’s name.",
      password: !pw ? "Choose a password." : pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw) ? PW_RULE : "" };
  };
  const more = step() === "more";
  return <Box><h1>Create your FinCom account</h1>
    {!more && <OAuth />}
    <form className="signin-form" noValidate onSubmit={submit("cloudSignUp", check, "name")}>
      <Step>{!more ? <Field label="Email" k="email" type="email" fk="cloudemail" auto="email" />
        : <><EmailLine /><Field label="Your name" k="name" fk="suname" auto="name" /><Field label="Firm name" k="firm" fk="sufirm" auto="organization" />
          <Field label="Password" k="password" type="password" fk="cloudpw" auto="new-password" hint="10 characters or more, with letters and digits." /></>}</Step>
      <BotBox action="signup" />
      <Submit act="cloudSignUp" busy={st.busy}>{more ? "Create account" : "Continue"}</Submit><Err /></form>
    <div className="signin-switch">Already have an account? <Switch act="showSignIn">Sign in</Switch></div></Box>;
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
  // signed in (the page goes): the next sign-in starts at the email again; on arrival the first box has the focus
  useEffect(() => () => { S.signinStep = "email"; S.signinErr = null; S.signinShowPw = false; S.signinForgot = false; }, []);
  useEffect(() => { if (!S.setPassword && !document.activeElement.matches("input")) focusBox(step() === "email" ? "email" : "password"); }, []);
  if (S.setPassword) return link ? <link.SetPassword /> : null;
  if (Cloud.on() && st.mfa) return <Suspense fallback={<Box><h1>Two-step sign-in</h1></Box>}><TwoStep /></Suspense>;
  if (S.signUpOpen) return <SignUp />;
  const check = () => ({ password: val("password") ? "" : "Enter your password." });
  const more = step() === "more";
  // the without-an-account mode (doAct "useOffline", src/js/27) has no way in from this page (the owner, 27-Oct-2026);
  // its code stays. The tests open FinCom that way with a direct call (doAct("useOffline"))
  return <Box><h1>Welcome to FinCom</h1>
    {/* stability batch 6: no line on this computer */}
    {typeof navigator === "object" && navigator.onLine === false && <div className="signin-notice" data-offline-line="" role="status">No internet connection. Sign in when you are back online.</div>}
    {S.signedOutWhy && <div className="signin-notice" data-signed-out-why="" role="status">{S.signedOutWhy}</div>}
    {!more && <OAuth />}
    <form className="signin-form" noValidate onSubmit={submit("cloudSignIn", check, "password")}>
      <Step>{!more ? <Field label="Email" k="email" type="email" fk="cloudemail" auto="username" />
        : <><EmailLine /><Field label="Password" k="password" type="password" fk="cloudpw" auto="current-password" side={<ForgotLink />}><ForgotNote /></Field>
          <KeepBox /></>}</Step>
      <BotBox action="login" />
      <Submit act="cloudSignIn" busy={st.busy}>{more ? "Sign in" : "Continue"}</Submit><Err /></form>
    <div className="signin-switch">New to FinCom? <Switch act="showSignUp">Create an account</Switch></div></Box>;
}
