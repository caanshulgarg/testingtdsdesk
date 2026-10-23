// A guest's way into a FinCom meeting, without a FinCom sign-in (next-calls-meet, 23-Oct-2026): the meeting's link
// (…#/join/<code>), an older guest link (…#join=<token>), or the join page (…#/join) where the code is typed. The
// meeting's name and the firm's are read, then the lobby (the call screen's own: the camera's preview, name and email,
// "Ask to join", "Asking to join…" until the host lets them in). The guest's pass is signed by the server and good for six
// hours; it gives only this call: never FinCom's data, never "Work together" (they see the host's screen only when shared).
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { makeApi } from "./api.js";
import { openCall } from "./CallScreen.jsx";
import { codeFrom } from "./rules.js";
import { joinHash } from "./launch.js";
import "./calls.css";

export function mountGuest() {
  document.documentElement.setAttribute("data-guest", "");
  const el = document.createElement("div"); el.id = "fincom-guest"; document.body.appendChild(el);
  const h = String(location.hash || "");
  const token = /^#join=/.test(h) ? h.slice(6) : "";
  const j = joinHash();
  createRoot(el).render(<Guest token={token} code={j ? j.code : ""} />);
}

function Guest({ token, code }) {
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false), [typed, setTyped] = useState(code || ""), [left, setLeft] = useState(false), [inCall, setInCall] = useState(false);
  const open = makeApi({});
  async function go(entry) {
    setBusy(true); setErr("");
    try {
      const hello = await open.call("guest_hello", entry);
      setInCall(true); setLeft(false);
      openCall({ guest: Object.assign({}, entry, { hello }) });
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  useEffect(() => {
    if (token) go({ token });
    else if (code) { const c = codeFrom(code); if (c) go({ code: c }); else setErr("That is not a meeting code. A code has ten letters, like abc-defg-hjk."); }
    const back = () => { setInCall(false); setLeft(true); };
    window.addEventListener("fincom-meetings-changed", back);
    return () => window.removeEventListener("fincom-meetings-changed", back);
  }, []);
  function submit(e) {
    e.preventDefault();
    const c = codeFrom(typed);
    if (!c) { setErr(typed.trim() ? "That is not a meeting code. A code has ten letters, like abc-defg-hjk, or paste the whole link." : "Type the meeting code you were sent."); return; }
    try { history.replaceState(null, "", location.pathname + location.search + "#/join/" + c); } catch (x) { /* */ }
    go({ code: c });
  }
  if (inCall) return null;
  return <div className="call-guest" data-guest-join="">
    <div className="guest-card">
      <div className="lobby-brand"><span className="lobby-mark" aria-hidden="true">F</span> FinCom <span className="lobby-brand-sub">Meetings</span></div>
      <h1>{left ? "You left the meeting" : "Join a meeting"}</h1>
      <p className="guest-note">{left ? "Thank you. To join again, use the same link or code." : "Type the meeting code you were sent (like abc-defg-hjk), or open the link from the invitation. No FinCom account is needed."}</p>
      <form onSubmit={submit} className="guest-form">
        <input value={typed} onChange={(e) => { setTyped(e.target.value); setErr(""); }} placeholder="Enter the meeting code" aria-label="Meeting code" autoComplete="off" spellCheck={false} data-join-code="" />
        <button type="submit" className="btn primary" disabled={busy} title={busy ? "Opening…" : undefined} data-join-go="">{busy ? "Opening…" : "Join"}</button>
      </form>
      {err && <p className="call-err" role="alert" data-guest-error="">{err}</p>}
      <p className="guest-foot">Part of the firm? <a href="./" data-guest-signin="">Open FinCom and sign in</a>, then open the link again.</p>
    </div>
  </div>;
}
