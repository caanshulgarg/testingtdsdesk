// A guest's page (…#join=<link token>): no FinCom sign-in. The call's name and the firm's; the guest's name and email; a
// six-figure code sent to that email (when FinCom's email is set up); then the waiting room until the host lets them in.
// The guest's pass is signed by the server and good for six hours; it gives only this call: never FinCom's data, never
// "Work together" (they see the host's screen only when it is shared).
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { makeApi } from "./api.js";
import { openCall } from "./CallScreen.jsx";
import "./calls.css";

export function mountGuest() {
  document.documentElement.setAttribute("data-guest", "");
  const el = document.createElement("div"); el.id = "fincom-guest"; document.body.appendChild(el);
  createRoot(el).render(<Guest token={String(location.hash).slice(6)} />);
}

function Guest({ token }) {
  const [hello, setHello] = useState(null), [err, setErr] = useState(""), [step, setStep] = useState("form"), [name, setName] = useState(""), [email, setEmail] = useState(""), [code, setCode] = useState(""), [busy, setBusy] = useState(false);
  const [pass, setPass] = useState(null);
  const open = makeApi({});
  useEffect(() => { open.call("guest_hello", { token }).then(setHello, (e) => setErr(e.message)); }, []);
  // the waiting room: asked every 2.5 s
  useEffect(() => {
    if (step !== "waiting" || !pass) return;
    const api = makeApi({ gt: pass.gt });
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const j = await api.call("guest_poll", {});
        if (j.state === "admitted") { setStep("in"); openCall({ guest: { gt: pass.gt, session: j, name } }); return; }
        if (j.state === "denied") { setStep("denied"); return; }
        if (j.state === "removed") { setStep("removed"); return; }
        if (j.state === "ended") { setStep("ended"); return; }
      } catch (e) { if (e.status === 401) { setErr(e.message); setStep("form"); return; } }
      setTimeout(tick, 2500);
    };
    tick();
    return () => { stop = true; };
  }, [step, pass]);
  async function start(e) {
    e.preventDefault(); setBusy(true); setErr("");
    try { const j = await open.call("guest_start", { token, name, email }); setPass(j); setStep(j.code_sent ? "code" : "waiting"); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  }
  async function verify(e) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await makeApi({ gt: pass.gt }).call("guest_verify", { code }); setStep("waiting"); } catch (x) { setErr(x.message); }
    setBusy(false);
  }
  if (step === "in") return null;
  return <div className="call-guest" data-guest-page="">
    <div className="call-lobby">
      <p className="call-note">FinCom call</p>
      {hello ? <h2>{hello.title}</h2> : !err && <h2>Opening the call…</h2>}
      {hello && <p>with {hello.firm}{hello.scheduled_at ? " · " + new Date(hello.scheduled_at).toLocaleString("en-IN") : ""}</p>}
      {err && <p className="call-err" role="alert" data-guest-error="">{err}</p>}
      {hello && step === "form" && <form onSubmit={start}>
        <label className="f"><span>Your name</span><input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} autoComplete="name" data-guest-name="" /></label>
        <label className="f"><span>Your email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" data-guest-email="" /></label>
        <p className="call-note">{hello.mail ? "A code is sent to this email to check it is yours." : "The host checks who you are before letting you in."} Your camera and microphone are used only in this call.</p>
        <button type="submit" className="call-primary" disabled={busy} data-guest-continue="">Continue</button>
      </form>}
      {step === "code" && <form onSubmit={verify}>
        <label className="f"><span>The 6-figure code sent to {email}</span><input inputMode="numeric" pattern="[0-9]{6}" value={code} onChange={(e) => setCode(e.target.value)} required autoComplete="one-time-code" data-guest-code="" /></label>
        <button type="submit" className="call-primary" disabled={busy} data-guest-verify="">Check the code</button>
      </form>}
      {step === "waiting" && <p data-guest-waiting="" role="status">Waiting for the host to let you in…</p>}
      {step === "denied" && <p data-guest-denied="">The host did not let you in.</p>}
      {step === "removed" && <p>The host removed you from this call.</p>}
      {step === "ended" && <p>This call has ended.</p>}
    </div>
  </div>;
}
