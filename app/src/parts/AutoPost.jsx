// Post automatically, on the pages (no layout change: each is a small addition; the rules are src/js/90-autopost.js):
//   AutoChip     "Auto · rule: BHARATKOSH → MCA EXPENSE" on an entry that went (or is about to go) by itself, the reason
//                and the approval it copied on hover or focus
//   AutoWhy      "Not auto: first time for this party" on an entry that waits, when the client has it on
//   AutoFilter   under the tabs: Waiting for me (the default) · Posted automatically N today
//   AutoUndo     Undo of one automatic entry (out of the hold, off the queue, or out of Tally through the bridge here)
//   AutoToday    the one line on Today
import { useState } from "react";
import { loadAP } from "../lib/autopostBoot.js";
import "./autopost.css";

export const apOn = (co) => !!(co && co.choices && co.choices.autopost && co.choices.autopost.value && co.choices.autopost.value.on);
const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }); } catch (e) { return ""; } };
export const isAuto = (x) => !!(x && (x.auto || x.autoHold));
// not yet in Tally: in the hold, or queued (the bank line still ready, the bill approved and not sent)
const notInTally = (x) => x.autoHold && !x.auto ? true : x.state ? !["sent", "intally"].includes(x.state) : !x.exportedAt;

export function AutoChip({ x, inert }) {
  const a = x && (x.auto || x.autoHold);
  if (!a) return null;
  const hold = x.autoHold && !x.auto && Date.parse(x.autoHold.until) > Date.now();
  const when = x.auto ? (notInTally(x) ? "Queued automatically" : "Posted automatically") + (a.at ? " at " + fmtDateTime(a.at) : "") : hold ? "Auto · posting at " + hhmm(x.autoHold.until) : "Auto · posting now";
  return <span className="ap-chip" tabIndex={inert ? undefined : 0} data-ap-chip={a.rule || ""}>
    <span className="ap-chip-t">{a.chip || "Auto"}</span>
    <span className="ap-tip" role="tooltip"><b>{when}</b>{x.auto && x.auto.run ? " (run " + String(x.auto.run).slice(0, 8) + ")" : ""}<br />{a.tip}
      {x.auto && x.auto.undoWanted && <><br />Marked for undo on the Tally computer by {x.auto.undoWanted.by}.</>}
      {x.auto && x.auto.failed && <><br />Not posted: {x.auto.failed}</>}</span>
  </span>;
}

export function AutoWhy({ x, co }) {
  if (!x || isAuto(x) || !x.autoWhy || !apOn(co || CO())) return null;
  return <span className="ap-why" data-ap-why="">Not auto: {x.autoWhy}</span>;
}

// the view under the tabs, kept per page for this tab of the browser
export const apView = (kind) => (S.apView && S.apView[kind]) || "waiting";
export function apRows(kind, rows) {
  const v = apView(kind);
  if (v === "auto") return rows.filter(isAuto);
  return rows.filter((x) => !(isAuto(x) && notInTally(x)));
}
export function AutoFilter({ kind, all }) {
  const co = CO(), autos = (all || []).filter(isAuto);
  if (!apOn(co) && !autos.length) return null;
  const day = typeof istDay === "function" ? istDay(Date.now()) : "";
  const today = autos.filter((x) => !(x.auto && x.auto.at) || istDay(x.auto.at) === day).length;
  const waiting = (all || []).filter((x) => !isAuto(x) && (x.state ? ["attention", "suggested", "ready"].includes(x.state) : x.status === "draft" || (x.status === "approved" && !x.exportedAt))).length;
  const v = apView(kind), go = (k) => { S.apView = Object.assign({}, S.apView, { [kind]: k }); render(); };
  return <div className="ap-filter" role="group" aria-label="Which entries" data-ap-filter={kind}>
    <button className={v === "waiting" ? "on" : ""} aria-pressed={v === "waiting"} onClick={() => go("waiting")}>Waiting for me <span className="n">{waiting}</span></button>
    <button className={v === "auto" ? "on" : ""} aria-pressed={v === "auto"} onClick={() => go("auto")}>Posted automatically <span className="n">{today} today</span></button>
  </div>;
}

// Undo of one entry; "the whole run" on the Post page (AutoRuns)
export function apUndo(cid, x) {
  return loadAP().then((ap) => ap.undo(cid, x)).then((r) => { toast(r.ok ? r.words : r.why); render(); return r; }, (e) => { toast("Undo did not work: " + ((e && e.message) || e)); });
}
export function AutoUndo({ x, cid }) {
  const [busy, setBusy] = useState(false);
  if (!isAuto(x)) return null;
  return <button className="linkbtn" data-ap-undo={x.id} disabled={busy} onClick={(ev) => { ev.stopPropagation(); setBusy(true); apUndo(cid || S.coId, x).finally(() => setBusy(false)); }}>{busy ? "Undoing…" : "Undo"}</button>;
}

// Today: "44 posted automatically today · 7 waiting for you · ₹3,41,210 of the ₹5,00,000 daily limit (Testing AAD)"
export function AutoToday() {
  const ap = window.AutoPost, cos = Object.values(S.companies || {}).filter(apOn);
  if (!cos.length || !ap) return null;
  const t = ap.today(cos.map((c) => c.id));
  const waiting = cos.reduce((a, c) => a + num(((ap.st.last || {})[c.id] || {}).waiting), 0);
  const lim = cos.map((c) => ({ c, cfg: ap.cfg(c), used: num(((t.by || {})[c.id] || {}).amt) })).filter((x) => x.cfg.perDay);
  const first = Object.keys(t.by)[0];
  return <div className="ap-today" data-ap-today={t.n}>
    <b>{t.n} posted automatically today</b>
    {waiting > 0 && <span> · {waiting} waiting for you</span>}
    {t.queued > 0 && <span> · {t.queued} queued until Tally opens</span>}
    {lim.slice(0, 2).map((x) => <span key={x.c.id}> · {money0(x.used).replace(/\.00$/, "")} of the {money0(x.cfg.perDay).replace(/\.00$/, "")} daily limit ({x.c.name})</span>)}
    {first && <> <button className="linkbtn" data-ap-see="" onClick={() => openCompany(first).then(() => { S.postTabs = Object.assign({}, S.postTabs, { [first]: "posted" }); goStep("post", "bills"); })}>See what was posted</button></>}
  </div>;
}
