// "Your meeting's ready" (next-calls-meet, 23-Oct-2026; the owner started a call and "didn't know where anyone will go or
// connect"): the meeting's one link and its code, Copy, Add people by email, WhatsApp, Add to Google Calendar and the
// .ics. The same card is the call's "Meeting details" (i), the result of "Create a meeting for later" and of "Schedule".
// Email: sent by FinCom when its email (Resend) is set up; otherwise the person's own mail app opens with the invite
// ready (mailto) and the .ics is saved, and the card says so plainly.
import { useState } from "react";
import { joinLink, inviteText, inviteSubject, mailtoUrl, googleCalUrl, icsFor, emailOk } from "./rules.js";

export const myName = () => { try { const me = (Cloud.sess() || {}).user_id; return String(((Cloud.st.members || []).find((m) => m.user_id === me) || {}).name || Cloud.st.email || ""); } catch (e) { return ""; } };
export const firmName = () => { try { return String((window.S && S.firm && S.firm.firmName) || ""); } catch (e) { return ""; } };
export const linkOf = (code) => joinLink(location.href, code);
export function download(name, text, type) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export function openMail(url) { const a = document.createElement("a"); a.href = url; a.rel = "noopener"; a.style.display = "none"; document.body.appendChild(a); try { a.click(); } catch (e) { /* */ } setTimeout(() => a.remove(), 500); }
const copy = (t) => { try { navigator.clipboard.writeText(t); return true; } catch (e) { return false; } };

// info: {room_id, code, title, at (ISO or null), minutes}; api: the calls api (invite); emails: people to invite first
export function MeetCard({ info, api, title, onJoin, emails, note, guest }) {
  const url = linkOf(info.code);
  const words = inviteText({ title: info.title, host: guest ? "" : myName(), firm: guest ? "" : firmName(), url, code: info.code, at: info.at || null, minutes: info.minutes || null });
  const subject = inviteSubject(info.title, info.at || null);
  const ics = () => icsFor({ uid: info.room_id || info.code, title: info.title || "Meeting", start: info.at ? Date.parse(info.at) : Date.now(), minutes: info.minutes || 30, url, description: "Meeting code: " + info.code });
  const [to, setTo] = useState((emails || []).join(", ")), [msg, setMsg] = useState(note || ""), [mailto, setMailto] = useState(""), [busy, setBusy] = useState(false), [copied, setCopied] = useState("");
  async function send(e) {
    e.preventDefault();
    const list = to.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!list.length) { setMsg("Write the email address of the person to invite."); return; }
    if (list.some((x) => !emailOk(x))) { setMsg("One of the addresses is not an email address."); return; }
    setBusy(true); setMsg("");
    try {
      const j = api && info.room_id ? await api.call("invite", { room_id: info.room_id, emails: list, base: location.href }) : { emailed: false };
      if (j.emailed) setMsg("Invite emailed to " + list.join(", ") + (info.at ? ", with the calendar file." : "."));
      else {
        const m = mailtoUrl(list, subject, words);
        setMailto(m);
        if (info.at) download("invite.ics", ics(), "text/calendar");
        setMsg("Email sending isn't set up yet, so your mail app opens with the invite ready." + (info.at ? " The calendar file (invite.ics) is saved: attach it to the email." : ""));
        openMail(m);
      }
    } catch (x) { setMsg(x.message); }
    setBusy(false);
  }
  const did = (k) => { setCopied(k); setTimeout(() => setCopied(""), 2000); };
  return <div className="meet-card" data-meet-card="">
    <h3>{title || "Your meeting's ready"}</h3>
    {info.title && <p className="meet-card-title"><b>{info.title}</b>{info.at ? " · " + (typeof fmtDateTime === "function" ? fmtDateTime(info.at) : info.at) : ""}{info.minutes ? " · " + info.minutes + " min" : ""}</p>}
    <p className="meet-card-note">Share this link with the people you want in the meeting. Anyone with it can ask to join; you let them in.</p>
    <div className="meet-link">
      <input readOnly value={url} aria-label="Meeting link" onFocus={(e) => e.target.select()} data-meet-link="" />
      <button type="button" className="btn small" onClick={() => { copy(url); did("link"); }} data-meet-copy="">{copied === "link" ? "Copied" : "Copy link"}</button>
    </div>
    <p className="meet-code-line">Meeting code: <b data-meet-code="">{info.code}</b> <button type="button" className="linkbtn" onClick={() => { copy(info.code); did("code"); }} data-meet-copy-code="">{copied === "code" ? "Copied" : "Copy code"}</button>
      {" · "}<button type="button" className="linkbtn" onClick={() => { copy(words); did("all"); }} data-meet-copy-all="">{copied === "all" ? "Copied" : "Copy the invitation"}</button></p>
    {!guest && <form className="meet-add" onSubmit={send}>
      <label className="meet-label" htmlFor={"meet-to-" + info.code}>Add people</label>
      <div className="meet-link">
        <input id={"meet-to-" + info.code} type="text" inputMode="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com, another@example.com" data-meet-email="" />
        <button type="submit" className="btn small" disabled={busy} title={busy ? "Sending…" : undefined} data-meet-send="">{busy ? "Sending…" : "Send invite"}</button>
      </div>
    </form>}
    {msg && <p className="meet-msg" role="status" data-meet-msg="">{msg}{mailto && <> <a href={mailto} data-meet-mailto="">Open the mail app again</a></>}</p>}
    <div className="meet-share">
      <a className="btn small" href={"https://wa.me/?text=" + encodeURIComponent(words)} target="_blank" rel="noopener noreferrer" data-meet-wa="">WhatsApp</a>
      <a className="btn small" href={googleCalUrl({ title: info.title, at: info.at || null, minutes: info.minutes || 30, url, details: words })} target="_blank" rel="noopener noreferrer" data-meet-gcal="">Add to Google Calendar</a>
      <button type="button" className="btn small" onClick={() => download("invite.ics", ics(), "text/calendar")} data-meet-ics="">Calendar file (.ics)</button>
      {onJoin && <button type="button" className="btn small" onClick={onJoin} data-meet-join-now="">Join now</button>}
    </div>
  </div>;
}
