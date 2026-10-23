// Meetings (next-calls-meet, 23-Oct-2026; the owner: "a proper system like Meet/Zoom, invite by email or by a code"): the
// firm's page for video calls, like meet.google.com's home. New meeting (Start an instant meeting · Create a meeting for
// later · Schedule in calendar), "Enter a code or link" and Join, then Upcoming and Recent (with the recording and the
// transcript where they are kept). A client's Overview keeps its Call button, which opens the same with the client chosen.
// The call screen itself is still fetched only when a call opens (launch.js).
import { useEffect, useRef, useState } from "react";
import { Video, CalendarPlus, Link2, Keyboard, Plus } from "lucide-react";
import { Calls, pendingJoin } from "./launch.js";
import { setMeetings, meetWhen } from "./upcoming.js";
import { codeFrom, joinLink } from "./rules.js";
import "./calls.css";

const copy = (t) => { try { navigator.clipboard.writeText(t); } catch (e) { /* */ } };
const clientName = (id) => { try { return (S.companies[id] || {}).name || ""; } catch (e) { return ""; } };

export default function Meetings() {
  const signed = typeof Cloud === "object" && Cloud.on();
  const role = String((signed && Cloud.st && Cloud.st.role) || ""), staff = role === "owner" || role === "staff";
  const [menu, setMenu] = useState(false), [code, setCode] = useState(""), [err, setErr] = useState(""), [lists, setLists] = useState(null), [loadErr, setLoadErr] = useState(""), [copied, setCopied] = useState(""), [checking, setChecking] = useState(false);
  const menuRef = useRef(null);
  const load = () => {
    if (!signed) return;
    Cloud.fn("fincom-call", { action: "meetings" }).then((j) => { setLists(j); setLoadErr(""); setMeetings(j.upcoming || []); }, (e) => setLoadErr(e.message));
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    // FinCom opened from a meeting's link: its lobby, over this page
    const c = pendingJoin(); if (c) Calls.joinCode(c);
    const back = () => load();
    window.addEventListener("fincom-meetings-changed", back);
    return () => { clearInterval(t); window.removeEventListener("fincom-meetings-changed", back); };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const out = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    const esc = (e) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", out); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", out); document.removeEventListener("keydown", esc); };
  }, [menu]);
  if (!signed) return <section className="meet-home" data-meetings=""><h2>Meetings</h2>
    <p className="note" data-meet-signin="">Video calls run through the firm's FinCom account. Sign in (Settings) to start or schedule a meeting. Someone with a meeting's link or code can join it without signing in.</p></section>;
  async function join(e) {
    e.preventDefault();
    const c = codeFrom(code);
    if (!c) { setErr(code.trim() ? "That is not a meeting code. A code has ten letters, like abc-defg-hjk, or paste the whole link." : "Type the meeting's code (like abc-defg-hjk) or paste its link."); return; }
    setErr(""); setChecking(true);
    // the code checked first (a wrong one is said here, on the page; wrong codes are counted by the server)
    try { await Cloud.fn("fincom-call", { action: "guest_hello", code: c }); Calls.joinCode(c); setCode(""); }
    catch (x) { setErr(x.message); }
    setChecking(false);
  }
  const pick = (f) => { setMenu(false); f(); };
  const done = () => setTimeout(load, 300);
  const up = (lists && lists.upcoming) || [], recent = (lists && lists.recent) || [];
  const did = (k) => { setCopied(k); setTimeout(() => setCopied(""), 1800); };
  return <section className="meet-home" data-meetings="">
    <div className="meet-hero">
      <div className="meet-hero-words">
        <h2>Video calls and meetings for your firm</h2>
        <p className="note">Meet clients, staff or anyone with a link or a code. They join from any browser; you let them in.</p>
      </div>
      <div className="meet-actions">
        {staff && <div className="meet-new" ref={menuRef}>
          <button type="button" className="btn primary meet-new-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} data-meet-new=""><Video width={18} height={18} aria-hidden="true" /> New meeting</button>
          {menu && <div className="meet-menu" role="menu" data-meet-menu="">
            <button type="button" role="menuitem" onClick={() => pick(() => Calls.start({ kind: "meeting", title: "Meeting" }))} data-meet-instant=""><Plus width={16} height={16} aria-hidden="true" /> Start an instant meeting</button>
            <button type="button" role="menuitem" onClick={() => pick(() => Calls.later({ done }))} data-meet-later=""><Link2 width={16} height={16} aria-hidden="true" /> Create a meeting for later</button>
            <button type="button" role="menuitem" onClick={() => pick(() => Calls.schedule({}))} data-meet-schedule=""><CalendarPlus width={16} height={16} aria-hidden="true" /> Schedule in calendar</button>
          </div>}
        </div>}
        <form className="meet-codebox" onSubmit={join} data-meet-join-form="">
          <span className="meet-codefield"><Keyboard width={16} height={16} aria-hidden="true" />
            <input value={code} onChange={(e) => { setCode(e.target.value); setErr(""); }} placeholder="Enter a code or link" aria-label="Meeting code or link" autoComplete="off" spellCheck={false} data-meet-code-input="" /></span>
          <button type="submit" className="btn" disabled={checking} title={checking ? "Checking the code…" : undefined} data-meet-join="">{checking ? "Checking…" : "Join"}</button>
        </form>
      </div>
      {err && <p className="meet-err" role="alert" data-meet-err="">{err}</p>}
    </div>
    {loadErr && <p className="note" data-meet-loaderr="">The meetings could not be read: {loadErr}</p>}
    <div className="meet-lists">
      <section className="meet-col" data-meet-upcoming="">
        <h3>Upcoming</h3>
        {!lists && !loadErr && <p className="note">Loading…</p>}
        {lists && !up.length && <p className="note" data-list-empty="">Nothing coming up. Use New meeting to start one or schedule one.</p>}
        {up.map((r) => <div key={r.id} className="meet-row" data-meet-row={r.title}>
          <div className="meet-row-main">
            <b>{r.title}</b>{r.status === "open" && <span className="meet-live">In progress</span>}
            <small>{r.scheduled_at ? meetWhen(r.scheduled_at) + (r.minutes ? " · " + r.minutes + " min" : "") : r.status === "open" ? "Started " + meetWhen(r.started_at) : "No time set · join any time"}
              {r.client_id && clientName(r.client_id) ? " · " + clientName(r.client_id) : ""}{r.code ? " · " + r.code : ""}</small>
          </div>
          <div className="meet-row-acts">
            {r.code && <button type="button" className="btn small" onClick={() => { copy(joinLink(location.href, r.code)); did(r.id); }} data-meet-row-copy="">{copied === r.id ? "Copied" : "Copy link"}</button>}
            <button type="button" className="btn small" onClick={() => Calls.join(r.id)} data-meet-row-join="">Join</button>
          </div>
        </div>)}
      </section>
      <section className="meet-col" data-meet-recent="">
        <h3>Recent</h3>
        {lists && !recent.length && <p className="note">No meetings held yet.</p>}
        {recent.map((r) => <div key={r.id} className="meet-row" data-meet-recent-row={r.title}>
          <div className="meet-row-main"><b>{r.title}</b>
            <small>{meetWhen(r.started_at)}{r.client_id && clientName(r.client_id) ? " · " + clientName(r.client_id) : ""}</small></div>
          <div className="meet-row-acts">
            {r.recording && <button type="button" className="linkbtn" onClick={() => Calls.kept(r)} data-meet-recording="">Recording</button>}
            {r.transcript && <button type="button" className="linkbtn" onClick={() => Calls.kept(r)} data-meet-transcript="">Transcript</button>}
            {!r.recording && !r.transcript && <span className="note">Nothing kept</span>}
          </div>
        </div>)}
      </section>
    </div>
  </section>;
}
