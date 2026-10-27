// Two-step sign-in (was in screens/SignIn.jsx; loaded only when an account signs in with, or sets up, an authenticator
// app's code: the app's first file is at its size budget, tests/run_stability.py)
import { useRef } from "react";
import { Box, Err } from "../screens/SignIn.jsx";

export default function TwoStep() {
  const m = Cloud.st.mfa || {}, busy = Cloud.st.busy, code = useRef(null);
  const verify = () => mfaAction("mfaVerify");
  return <Box><h1>Two-step sign-in</h1>
    {m.forAdmin && <p className="note" style={{ margin: "8px 0 0" }}>Platform administration changes every firm and the credit, so it needs the code from your phone. Your firm work does not.</p>}
    {m.need === "code" ? <p className="note" style={{ margin: "8px 0 14px" }}>Open the authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar) and type the 6-digit code for FinCom.</p>
      : !m.factorId ? <><p className="note" style={{ margin: "8px 0 14px" }}>{(m.required ? "This account must" : "You can") + " protect this account with a code from an authenticator app on your phone, as well as the password. Install Google Authenticator or Microsoft Authenticator, then press the button."}</p>
        <div className="row"><button className="btn primary" disabled={!!busy} data-act="mfaStart" onClick={() => mfaAction("mfaStart")}>{busy ? "Setting it up…" : "Set it up"}</button></div></>
      : <><p className="note" style={{ margin: "8px 0 10px" }}>1. In the authenticator app choose <b>Add</b> → <b>Scan a QR code</b> and scan this.</p>
        {m.qr && mfaQrSrc(m.qr) && <p style={{ textAlign: "center" }}><img alt="QR code for the authenticator app" width={190} height={190} style={{ width: 190, height: 190, background: "#fff", padding: 6, borderRadius: 8, boxSizing: "content-box" }} src={mfaQrSrc(m.qr)} /></p>}
        <p className="note" style={{ margin: "6px 0 4px" }}>Cannot scan? Type this key in the app instead:</p>
        <div className="row" style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}><code data-mfa-key style={{ userSelect: "all", fontSize: 18, letterSpacing: 1, padding: "6px 10px", borderRadius: 6, background: "var(--bg2, rgba(127,127,127,.12))", wordBreak: "break-all" }}>{mfaKeyGroups(m.secret)}</code>
          <button className="btn" data-act="mfaCopyKey" onClick={() => mfaAction("mfaCopyKey")}>Copy</button></div>
        <p className="note" style={{ margin: "10px 0 6px" }}>2. Type the 6-digit code the app now shows.</p></>}
    {(m.need === "code" || m.factorId) && <><label className="f"><span>Code</span><input ref={code} type="text" id="mfaCode" data-fk="mfacode" aria-label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123456" onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); verify(); } }} /></label>
      <div className="row" style={{ marginTop: 12 }}><button className="btn primary" data-act="mfaVerify" disabled={!!busy} onClick={verify}>{busy ? "Checking…" : "Continue"}</button></div></>}
    <Err />
    <p className="note" style={{ marginTop: 14 }}>{!(m.required || (m.need === "code" && !m.forAdmin)) && <><button className="linkbtn" data-act="mfaCancel" onClick={() => mfaAction("mfaCancel")}>Not now</button> · </>}Lost your phone? Ask the platform administrator to reset your two-step sign-in. <button className="linkbtn" data-act="mfaSignOut" onClick={() => mfaAction("mfaSignOut")}>Sign out</button></p></Box>;
}
