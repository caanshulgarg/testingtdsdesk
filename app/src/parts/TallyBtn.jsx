// next-buttons (08-Nov-2026; the owner: "no button will go unworked — check Tally, connect, bring books, update or
// anything — everything should work"). Every Tally button ends in words beside it within a few seconds: done, asked
// (what happens and when), or why it cannot, with the one thing to do. One place for:
//   errWords(e)   a failure in plain words (FinCom not reached, not in time, not allowed, the cloud not ready yet)
//   press(k, fn)  one click at a time for key k (a second click while it runs does nothing), never a rejection: fn's
//                 answer ({text, bad, watch} or words) or its failure is kept under k for 3 minutes, so a button that is
//                 drawn again (its row's state changed) still says it
//   <Said k>      those words, role=status; with a watch ({started, company, cid}), work asked that no Tally computer
//                 picked up within 2 minutes turns into "Not started: <why>" (the beats, the link's serving bridges)
//   lateWhy       that why, from what the page already reads (no computer's name: the computers are "the Tally computer")
// Loaded only with the Tally page's code (the Tally and TallyCompanies chunks): the app's first file does not grow.
import { useEffect, useState } from "react";
import { noAnswer } from "../lib/readFollow.js";
import { soonDraw } from "../lib/soonDraw.js";

export const LATE_MS = 120000, SLOW_MS = 20000, KEEP_MS = 180000;
export function errWords(e) {
  const m = String((e && e.message) || e || "");
  if (/JWT|not signed in|sign in|\b401\b/i.test(m)) return "You are signed out of the firm account: sign in again, then try again.";
  if (/not allowed|42501|permission denied|row-level security|\b403\b/i.test(m)) return "Only an owner or staff of the firm can do this.";
  if (/PGRST202|Could not find the function|schema cache|does not exist|\b404\b/i.test(m)) return "FinCom’s cloud is not ready for this yet. Try again later.";
  if (/timed out|timeout/i.test(m)) return "FinCom did not answer in time. Try again in a minute.";
  if (!m || /failed to fetch|networkerror|network error|load failed|no cloud|offline|aborted/i.test(m)) return "Couldn’t reach FinCom. Check the internet and try again.";
  return "Not done: " + m.replace(/^ERROR:\s*/i, "").replace(/[.\s]+$/, "") + ".";
}
// settles within ms: a cloud that never answers is said so (the time a person spends on a question, askConfirm's box,
// is not counted)
const asking = () => { try { const b = document.getElementById("confirmBox"); return !!(b && b.style.display !== "none" && b.firstChild); } catch (e) { return false; } };
export const within = (p, ms = SLOW_MS) => new Promise((yes, no) => { let t = 0;
  const arm = (d) => { t = setTimeout(() => (asking() ? arm(ms) : no(new Error("timed out"))), d); }; arm(ms);
  Promise.resolve(p).then((v) => { clearTimeout(t); yes(v); }, (e) => { clearTimeout(t); no(e); }); });

const SAID = {}, BUSY = {}, subs = new Set();
// (and the page drawn again: a part that draws its words only once something was pressed sees them)
const tell = () => { subs.forEach((f) => { try { f(); } catch (e) { /* */ } }); soonDraw(); };
export const busyOf = (k) => !!BUSY[k];
export function saidOf(k) { const s = SAID[k]; return s && Date.now() - s.at < (s.keep || KEEP_MS) ? s : null; }
export function say(k, text, bad = false, more = null) { if (!text) delete SAID[k]; else SAID[k] = Object.assign({ text, bad: !!bad, at: Date.now() }, more); tell(); }
export async function press(k, fn, ms = SLOW_MS) {
  if (BUSY[k]) return;
  BUSY[k] = Date.now(); delete SAID[k]; tell();
  try {
    const r = await within(Promise.resolve().then(fn), ms);
    if (r && typeof r === "object") say(k, r.text, r.bad, r.watch ? { watch: r.watch, keep: LATE_MS + KEEP_MS } : null); else if (r) say(k, String(r));
  } catch (e) { say(k, errWords(e), true); }
  finally { delete BUSY[k]; tell(); }
}
// redraws on every press and answer
export function useSaid() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
}
// a bridge of the firm heard in the last 3 minutes (the cloud's beats)
function firmUp() {
  try { const devs = [].concat((typeof TLight === "object" && TLight.st && TLight.st.devs) || []);
    return devs.some((d) => d && !d.revoked && Date.now() - Date.parse(d.last_seen || (d.info && d.info.beat && d.info.beat.at) || "") < 3 * 60000); } catch (e) { return true; }
}
// why work asked of Tally has not started: the plain reason, with the one thing to do
export function lateWhy(cid, company) {
  const name = String(company || "").trim() || "the company";
  if (typeof TCloud !== "object" || !TCloud.on || !TCloud.on()) return "you are not signed in to the firm account. Sign in; the Tally computer is asked through FinCom’s cloud.";
  let na = ""; try { na = noAnswer(company); } catch (e) { na = ""; }
  if (na) return na.replace(/^Nothing can answer now[.:]\s*/, "");
  if (!firmUp()) return "no FinCom Bridge of the firm is online. Turn on the Tally computer and sign in to Windows; it starts by itself.";
  let w = ""; try { w = typeof globalThis.FCStallWhy === "function" ? globalThis.FCStallWhy(cid, company) : ""; } catch (e) { w = ""; }
  if (w) return w;
  return "no Tally computer picked it up in 2 minutes. Check that “" + name + "” is open in TallyPrime and FinCom Bridge is running there; it starts by itself.";
}
// the words kept under k; the watch's "Not started" once 2 minutes pass with nothing picked up
export function Said({ k, hook = "", className = "tsm-note" }) {
  useSaid();
  const s = saidOf(k), w = s && s.watch, [, tick] = useState(0);
  useEffect(() => { if (!w) return; const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t); }, [w]);
  if (busyOf(k)) return <div className={className} data-said={hook || k} data-said-state="busy" role="status">Working…</div>;
  if (!s) return null;
  let text = s.text, bad = s.bad, st = bad ? "bad" : "ok";
  if (w) {
    let on = false; try { on = !!w.started(); } catch (e) { on = false; }
    if (on) { st = "started"; if (w.startedText) text = w.startedText; else return null; }
    else if (Date.now() - s.at > LATE_MS) { text = "Not started: " + lateWhy(w.cid, w.company); bad = true; st = "late"; }
    else st = "asked";
  }
  return <div className={className + (bad ? " bad" : "")} data-said={hook || k} data-said-state={st} role="status">{text}</div>;
}
// the note under a button that is off, and its title: why, in plain words
export const VIEW_ONLY = "View only: an owner or staff of the firm makes changes.";
if (typeof globalThis === "object") globalThis.FCTallyBtn = { SAID, BUSY, errWords, lateWhy, LATE_MS, say };
