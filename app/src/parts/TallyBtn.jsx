// next-buttons (08-Nov-2026; the owner: "no button will go unworked — check Tally, connect, bring books, update or
// anything — everything should work"). Every Tally button ends in words beside it within a few seconds: done, asked
// (what happens and when), or why it cannot, with the one thing to do. One place for:
//   errWords(e)   a failure in plain words (FinCom not reached, not in time, not allowed, the cloud not ready yet)
//   press(k, fn)  one click at a time for key k (a second click while it runs does nothing), never a rejection: fn's
//                 answer ({text, bad, watch} or words) or its failure is kept under k for 3 minutes, so a button that is
//                 drawn again (its row's state changed) still says it. A cloud slow to answer (20 s, the time spent on a
//                 confirm question not counted): "Still waiting for FinCom…", the key kept busy (no second request) until
//                 the real answer, which is then said; after 3 minutes with none, the key is let go, said so, and an
//                 answer that comes later is still said
//   <Said k>      those words, role=status; with a watch ({started, company, cid}), work asked that no Tally computer
//                 picked up within 2 minutes turns into "Not started: <why>" (the beats, the link's serving bridges)
//   lateWhy       that why, from what the page already reads (no computer's name: the computers are "the Tally computer")
//   bridge 2.5.10: a watch with acks (lib/pickAck.js ackSnap, taken before the request) says what the bridge itself said
//                 of the work since: "Started at 10:42 IST on <login>’s Tally." or "Not started: <its own words>." at
//                 once; with none (an older bridge, or not said yet) the inference above, as before
// Loaded only with the Tally page's code (the Tally and TallyCompanies chunks): the app's first file does not grow.
import { useEffect, useState } from "react";
import { noAnswer } from "../lib/readFollow.js";
import { soonDraw } from "../lib/soonDraw.js";
import { ackNew, ackWords } from "../lib/pickAck.js";

export const LATE_MS = 120000, SLOW_MS = 20000, KEEP_MS = 180000;
export function errWords(e) {
  const m = String((e && e.message) || e || "");
  if (/JWT|not signed in|sign in|\b401\b/i.test(m)) return "Sign in again to the firm account, then try again.";
  if (/not allowed|42501|permission denied|row-level security|\b403\b/i.test(m)) return "Only an owner or staff of the firm can do this.";
  if (/PGRST202|Could not find the function|schema cache|does not exist|\b404\b/i.test(m)) return "FinCom’s cloud is not ready for this yet. Try again later.";
  if (/timed out|timeout/i.test(m)) return "FinCom did not answer in time. Try again in a minute.";
  if (!m || /failed to fetch|networkerror|network error|load failed|no cloud|offline|aborted/i.test(m)) return "Couldn’t reach FinCom. Check the internet and try again.";
  return "Not done: " + m.replace(/^ERROR:\s*/i, "").replace(/[.\s]+$/, "") + ".";
}
// a clock that runs only while no confirm question (askConfirm's box) is open: onSlow once after ms of it; stop() ends it
const asking = () => { try { const b = document.getElementById("confirmBox"); return !!(b && b.style.display !== "none" && b.firstChild); } catch (e) { return false; } };
// (real time between looks, Date.now differences: a hidden tab's slowed timers still fire on time; a look that finds the
// question open sets that span aside)
export function slowClock(ms, onSlow) {
  let spent = 0, fired = false, last = Date.now();
  const look = () => { const now = Date.now(); if (!asking()) spent += now - last; last = now;
    if (!fired && spent >= ms) { fired = true; clearInterval(t); try { onSlow(); } catch (e) { /* */ } } };
  const t = setInterval(look, 250);
  return () => clearInterval(t);
}
export const HARD_MS = 180000;

const SAID = {}, BUSY = {}, subs = new Set();
// (and the page drawn again: a part that draws its words only once something was pressed sees them)
const tell = () => { subs.forEach((f) => { try { f(); } catch (e) { /* */ } }); soonDraw(); };
export const busyOf = (k) => !!BUSY[k];
export const slowOf = (k) => !!(BUSY[k] && BUSY[k].slow);
// one lock shared by two keys (Bring books and Bring another year › Start on the same book: one request at a time)
const LOCK = {};
export const lockOf = (l) => !!(l && LOCK[l]);
export function saidOf(k) { const s = SAID[k]; return s && Date.now() - s.at < (s.keep || KEEP_MS) ? s : null; }
export function say(k, text, bad = false, more = null) { if (!text) delete SAID[k]; else SAID[k] = Object.assign({ text, bad: !!bad, at: Date.now() }, more); tell(); }
const sayAnswer = (k, r) => { if (r && typeof r === "object") say(k, r.text, r.bad, r.watch ? { watch: r.watch, keep: LATE_MS + KEEP_MS } : null); else if (r) say(k, String(r)); };
export async function press(k, fn, ms = SLOW_MS, lock = "") {
  if (BUSY[k] || lockOf(lock)) return;
  const me = BUSY[k] = { at: Date.now(), slow: false }; if (lock) LOCK[lock] = me; delete SAID[k]; tell();
  const free = () => { if (lock && LOCK[lock] === me) delete LOCK[lock]; };
  let gone = false;
  const stopSlow = slowClock(ms, () => { if (BUSY[k] === me) { me.slow = true; tell(); } });
  const stopHard = slowClock(HARD_MS, () => { stopSlow(); stopHard(); free(); if (BUSY[k] !== me) return; gone = true; delete BUSY[k];
    say(k, "FinCom did not answer in 3 minutes. Try again; an answer that comes later shows here.", true); });
  try { const r = await Promise.resolve().then(fn); sayAnswer(k, r); }
  catch (e) { say(k, errWords(e), true); }
  finally { stopSlow(); stopHard(); free(); if (!gone && BUSY[k] === me) delete BUSY[k]; tell(); }
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
// why work asked of Tally has not started: the plain reason, with the one thing to do; sure: only a reason the beats or
// the serving list show ("" instead of the general one)
export function lateWhy(cid, company, sure = false) {
  const name = String(company || "").trim() || "the company";
  if (typeof TCloud !== "object" || !TCloud.on || !TCloud.on()) return "you are not signed in to the firm account. Sign in; the Tally computer is asked through FinCom’s cloud.";
  let na = ""; try { na = noAnswer(company); } catch (e) { na = ""; }
  if (na) return na.replace(/^Nothing can answer now[.:]\s*/, "");
  if (!firmUp()) return "no FinCom Bridge of the firm is online. Turn on the Tally computer and sign in to Windows; it starts by itself.";
  let w = ""; try { w = typeof globalThis.FCStallWhy === "function" ? globalThis.FCStallWhy(cid, company) : ""; } catch (e) { w = ""; }
  if (w) return w;
  if (sure) return "";
  return "no Tally computer picked it up in 2 minutes. Check that “" + name + "” is open in TallyPrime and FinCom Bridge is running there; it starts by itself.";
}
// the words kept under k; the watch's "Not started" once 2 minutes pass with nothing picked up
export function Said({ k, hook = "", className = "tsm-note" }) {
  useSaid();
  const s = saidOf(k), w = s && s.watch, [, tick] = useState(0);
  useEffect(() => { if (!w) return; const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t); }, [w]);
  if (busyOf(k)) return <div className={className} data-said={hook || k} data-said-state={slowOf(k) ? "slow" : "busy"} role="status">{slowOf(k) ? "Still waiting for FinCom…" : "Working…"}</div>;
  if (!s) return null;
  let text = s.text, bad = s.bad, st = bad ? "bad" : "ok", ack = null;
  if (w) {
    let on = false; try { on = !!w.started(); } catch (e) { on = false; }
    try { ack = w.acks ? ackNew(w.acks) : null; } catch (e) { ack = null; }
    const more = () => (on && w.startedText ? " " + (typeof w.startedText === "function" ? w.startedText() : w.startedText) : "");
    if (ack && ack.state === "started") { st = "started"; bad = false; text = ackWords(ack) + more(); }
    else if (on) { ack = null; st = "started"; if (w.startedText) text = more().slice(1); else return null; }
    else if (ack) { text = ackWords(ack); bad = true; st = "refused"; }
    else if (Date.now() - s.at > LATE_MS) { text = "Not started: " + lateWhy(w.cid, w.company); bad = true; st = "late"; }
    else st = "asked";
  }
  return <div className={className + (bad ? " bad" : "")} data-said={hook || k} data-said-state={st} data-said-ack={ack ? ack.state : undefined} role="status">{text}</div>;
}
// the note under a button that is off, and its title: why, in plain words
export const VIEW_ONLY = "View only: an owner or staff of the firm makes changes.";
if (typeof globalThis === "object") globalThis.FCTallyBtn = { SAID, BUSY, errWords, lateWhy, LATE_MS, say };
