// The header's ONE Tally sign (next-tally-icon, 27-Oct-2026; the owner: "header is too noisy of tally remarks.. everywhere..
// just need only an icon showing tally status only.. not everywhere"). It replaces the client title's chip ("● Linked"), the
// status line beside the title ("reading · posting allowed · last entry 09:49", "Open X in TallyPrime on NWS144") and the
// top bar's chip ("This PC: no bridge (not needed)", "Tally not on this computer", "Tally ready"): a small Tally glyph with
// a status dot, its colour the open client's one word (lib/linkStatus.js through clientTallyState), or the firm's on the
// firm's pages:
//   green  Linked                amber  Waiting for Tally
//   red    Needs you             grey   Not linked, or not connected to Tally at all
// Its words are in its tooltip and aria-label, and in the popover a click opens (parts/TallyPop.jsx, its own file, loaded
// on the first click), with the action that fits, done there. Plain words only (the owner: "I don't need NWS144... need
// only Tally... it should be simple to understand"): never a computer's name, a port, a Windows user or the bridge here;
// those are on the Tally page.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { clientTallyState, unlinkedOpen, mayLink, tallyDevs, lastEntry } from "../lib/tallyState.js";
import { useDismiss } from "./dismiss.js";

const TallyPop = lazy(() => import("./TallyPop.jsx"));
const TONE = { linked: "on", waiting: "warn", needs: "off", none: "idle" };
const noBridge = () => !tallyDevs().length && !(typeof Bridge === "object" && Bridge.on());
// "2:41 pm" (India time)
export function clock(t) {
  const d = new Date(t); if (isNaN(d)) return "";
  try { return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).toLowerCase().replace(/\s+/g, " "); }
  catch (e) { return d.toTimeString().slice(0, 5); }
}

// {icon: linked | waiting | needs | none, word, line (one plain sentence), cause (Needs you's: two | port | posting |
//  stopped | paused | notanswering | entries), company, p (the client's state from lib/tallyState.js, or null)}
export function tallyIconState(co) {
  if (co) {
    const p = clientTallyState(co) || {}, k = typeof tallyLinkOf === "function" ? tallyLinkOf(co) || {} : {};
    const kind = p.kind || (p.state === "connected" ? "linked" : p.state === "unlinked" || !p.state ? "unlinked" : "waiting");
    const company = p.company || k.company || co.tallyName || co.name;
    const o = (icon, word, line, cause) => ({ icon, word, line, cause: cause || "", company, p });
    if (kind === "unlinked") return o("none", "Not linked", "Not linked to a Tally company yet.");
    if (kind === "linked") { const last = lastEntry(co, k); return o("linked", "Linked", "Connected to Tally" + (last ? " · last entry " + clock(last) : "")); }
    if (kind === "waiting") return noBridge() ? o("none", "Not connected", "Not connected to Tally yet.") : o("waiting", "Waiting for Tally", "Open " + company + " in Tally");
    // Needs you: one short sentence about the problem (its button: parts/TallyPop.jsx)
    const b = (p.button || {}).label || "", l = typeof tallyLine === "function" ? tallyLine(co) : null, st = (l && l.state) || "";
    if (b === "Choose") return o("needs", "Needs you", company + " is open in two places with different data. Choose which one is the books.", "two");
    if (p.port) return o("needs", "Needs you", "Tally's connection setting needs a change before FinCom can read it.", "port");
    if (b === "Allow posting") return o("needs", "Needs you", "Posting to Tally is stopped for " + co.name + ".", "posting");
    if (st === "stopped") return o("needs", "Needs you", "Reading from Tally is stopped.", "stopped");
    if (st === "paused") return o("needs", "Needs you", "Reading from Tally is paused.", "paused");
    if (st === "notanswering") return o("needs", "Needs you", "Tally is not answering.", "notanswering");
    return o("needs", "Needs you", "Some entries from Tally need you on the Tally page.", "entries");
  }
  // the firm's pages: any computer of the firm with Tally ready (tallySign, src/js/49), the one here
  const s = typeof tallySign === "function" ? tallySign(null) : { on: false }, h = typeof tallyHere === "function" ? tallyHere(null) : { level: "idle" };
  const o = (icon, word, line) => ({ icon, word, line, cause: "", company: "", p: null });
  if (s.on) return o("linked", "Connected", "Connected to Tally");
  if (h.level === "bad") return o("needs", "Needs you", "Tally is not answering.");
  if (s.computer || tallyDevs().length) return o("waiting", "Waiting for Tally", "Open Tally to connect.");
  return o("none", "Not connected", "Not connected to Tally yet.");
}

// the glyph: a rounded "T" (Tally), the dot at its corner
function Glyph() {
  return <svg className="tally-glyph" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    <rect x="1.5" y="1.5" width="15" height="15" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M5.5 6h7M9 6v6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>;
}

export default function TallyIcon() {
  const co = S.view === "company" && typeof CO === "function" ? CO() : null;
  const [open, setOpen] = useState(false), ref = useRef(null);
  const close = () => setOpen(false), back = () => { const b = ref.current && ref.current.querySelector("[data-tally-icon]"); if (b) b.focus(); };
  useDismiss(open, ref, close);
  // closed by Esc or a click on nothing: the focus back on the icon (the keyboard carries on from there)
  const was = useRef(false);
  useEffect(() => { const a = document.activeElement; if (was.current && !open && (!a || a === document.body)) back(); was.current = open; }, [open]);
  const s = tallyIconState(co), t = typeof tallyStatus === "function" ? tallyStatus(co) : { state: "" };
  const nOpen = mayLink() ? unlinkedOpen().length : 0;
  const words = "Tally: " + s.word + (s.line ? " — " + s.line : "") + (nOpen ? " — " + nOpen + (nOpen === 1 ? " company open in Tally is" : " companies open in Tally are") + " not linked" : "");
  return <span className="tsign-wrap tally-icon-wrap" ref={ref}>
    <button type="button" className={"tsign tallyicon " + TONE[s.icon]} data-tally-icon={s.icon} data-tally-sign={s.icon === "linked" ? "on" : "off"}
      data-tally={t.state} data-tally-pill={s.p ? s.p.state : undefined} data-tally-cause={s.cause || undefined}
      aria-haspopup="dialog" aria-expanded={open} aria-label={words} title={words} onClick={() => setOpen(!open)}>
      <Glyph /><span className="tsign-dot" aria-hidden="true" />
    </button>
    {nOpen > 0 && <span className="bell-n tsign-n" data-tally-badge={nOpen} aria-hidden="true">{nOpen}</span>}
    {open && <Suspense fallback={<div className="tally-pop" data-tally-pop-wait=""><p className="note">Reading…</p></div>}><TallyPop co={co} nOpen={nOpen} close={close} back={back} /></Suspense>}
  </span>;
}
