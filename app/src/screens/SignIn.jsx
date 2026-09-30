// The sign-in page, before anything of the firm is shown: sign in, create an account, or two-step sign-in (a code from
// an authenticator app). Was viewSignIn (src/js/27), viewSignUp (src/js/27) and viewTwoStep (src/js/43). Buttons are
// doAct cases (cloudSignIn, cloudSignUp, showSignUp, showSignIn, useOffline) and mfaAction (src/js/43); the boxes keep
// their data-cloud and id, which those read, and the buttons their data-act (the old tests press them by it); and what is typed is kept in S.cloudForm (cloudForm).
import { useEffect, useRef } from "react";

const Act = ({ act, className = "btn primary", children, disabled }) => <button className={className} data-act={act} disabled={disabled} onClick={() => doAct(act)}>{children}</button>;
const Box = ({ children }) => <div className="signin"><div className="signin-box">{children}</div></div>;
const Field = ({ label, k, type = "text", fk, auto, first }) => {
  const f = S.cloudForm || {}, c = Cloud.cfg(), ref = useRef(null);
  useEffect(() => { if (first && ref.current && !document.activeElement.matches("input")) ref.current.focus(); }, []);
  return <label className="f" style={first ? undefined : { marginTop: 8 }}><span>{label}</span><input ref={ref} type={type} data-cloud={k} data-fk={fk} aria-label={label} autoComplete={auto}
    defaultValue={f[k] || (k === "email" ? c.email || "" : "")} onChange={(ev) => cloudForm(k, ev.target.value)} /></label>;
};
const Err = () => Cloud.st.error ? <p className="bk-warn" style={{ marginTop: 10 }}>{Cloud.st.error}</p> : null;

function SignUp() {
  const st = Cloud.st;
  return <Box><h1>Create an account</h1><p className="note" style={{ margin: "8px 0 14px" }}>Your firm gets its own space. Nobody else can see your data.</p>
    <Field label="Firm name" k="firm" fk="sufirm" first /><Field label="Your name" k="name" fk="suname" /><Field label="Email" k="email" type="email" fk="cloudemail" auto="username" />
    <Field label="Password (8 characters or more)" k="password" type="password" fk="cloudpw" auto="new-password" />
    <div className="row" style={{ marginTop: 12 }}><Act act="cloudSignUp" disabled={!!st.busy}>{st.busy ? "Making the account…" : "Create the account"}</Act></div><Err />
    <p className="note" style={{ marginTop: 14 }}>Already have one? <Act act="showSignIn" className="linkbtn">Sign in</Act></p></Box>;
}

function TwoStep() {
  const m = Cloud.st.mfa || {}, busy = Cloud.st.busy, code = useRef(null);
  const verify = () => mfaAction("mfaVerify");
  return <Box><h1>Two-step sign-in</h1>
    {m.forAdmin && <p className="note" style={{ margin: "8px 0 0" }}>Platform administration changes every firm and the credit, so it needs the code from your phone. Your firm work does not.</p>}
    {m.need === "code" ? <p className="note" style={{ margin: "8px 0 14px" }}>Open the authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar) and type the 6-digit code for FinCom.</p>
      : !m.factorId ? <><p className="note" style={{ margin: "8px 0 14px" }}>{(m.required ? "This account must" : "You can") + " protect this account with a code from an authenticator app on your phone, as well as the password. Install Google Authenticator or Microsoft Authenticator, then press the button."}</p>
        <div className="row"><button className="btn primary" disabled={!!busy} data-act="mfaStart" onClick={() => mfaAction("mfaStart")}>Set it up</button></div></>
      : <><p className="note" style={{ margin: "8px 0 10px" }}>1. In the authenticator app choose <b>Add</b> → <b>Scan a QR code</b> and scan this.</p>
        {m.qr && <p style={{ textAlign: "center" }}><img alt="QR code for the authenticator app" style={{ width: 190, height: 190, background: "#fff", padding: 6, borderRadius: 8 }} src={/^data:image\/svg\+xml|^data:image\/png/.test(m.qr) ? m.qr : ""} /></p>}
        <p className="note" style={{ margin: "6px 0" }}>Cannot scan? Type this key in the app instead: <code style={{ userSelect: "all", wordBreak: "break-all" }}>{m.secret || ""}</code></p>
        <p className="note" style={{ margin: "10px 0 6px" }}>2. Type the 6-digit code the app now shows.</p></>}
    {(m.need === "code" || m.factorId) && <><label className="f"><span>Code</span><input ref={code} type="text" id="mfaCode" data-fk="mfacode" aria-label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123456" onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); verify(); } }} /></label>
      <div className="row" style={{ marginTop: 12 }}><button className="btn primary" data-act="mfaVerify" disabled={!!busy} onClick={verify}>{busy ? "Checking…" : "Continue"}</button></div></>}
    <Err />
    <p className="note" style={{ marginTop: 14 }}>{!(m.required || (m.need === "code" && !m.forAdmin)) && <><button className="linkbtn" data-act="mfaCancel" onClick={() => mfaAction("mfaCancel")}>Not now</button> · </>}Lost your phone? Ask the platform administrator to reset your two-step sign-in. <button className="linkbtn" data-act="mfaSignOut" onClick={() => mfaAction("mfaSignOut")}>Sign out</button></p></Box>;
}

export default function SignIn() {
  const st = Cloud.st;
  if (Cloud.on() && st.mfa) return <TwoStep />;
  if (S.signUpOpen) return <SignUp />;
  return <Box><h1>FinCom</h1>
    <p className="note">{S.firm && S.firm.firmName ? S.firm.firmName : "Finance and compliance, in one place"}</p>
    <p className="note" style={{ margin: "2px 0 0" }}><a href="welcome/">What is FinCom?</a></p>
    <p className="note" style={{ margin: "10px 0 14px" }}>Sign in to see your firm’s work. Nothing is shown before that.</p>
    <Field label="Email" k="email" type="email" fk="cloudemail" auto="username" first /><Field label="Password" k="password" type="password" fk="cloudpw" auto="current-password" />
    <div className="row" style={{ marginTop: 12 }}><Act act="cloudSignIn" disabled={!!st.busy}>{st.busy ? "Signing in…" : "Sign in"}</Act></div><Err />
    <p className="note" style={{ marginTop: 14 }}>Forgotten the password? Ask the person who runs your firm’s account to make a new one.</p>
    <p className="note" style={{ marginTop: 10 }}>No internet on this computer? <Act act="useOffline" className="linkbtn">Use it here without an account</Act> — the work stays on this computer only.</p>
    {S.signupInfo && S.signupInfo.open !== false && <p className="note" style={{ marginTop: 6 }}>New here? <Act act="showSignUp" className="linkbtn">Create an account</Act>{num(S.signupInfo.trial_credit) ? " · starts with " + INR.format(num(S.signupInfo.trial_credit)) + " of credit" : ""}</p>}</Box>;
}
