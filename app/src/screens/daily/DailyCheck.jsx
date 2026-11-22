// Daily Check (next-assistant, phase 1; docs/ASSISTANT-PHASE1.md). What last night's checks left for the firm, in four
// tabs: From clients (questions: the only thing ever sent) · Needs you · Entries · Done by FinCom. The page opens on the
// tab with the most to do. One line a row; the details (history, Dr/Cr, evidence) only when a row is opened.
// Data: ./data.js (the cloud, the person's own sign-in; every change through migration 206's functions, logged).
// Approve hands an entry to the EXISTING approval and post path (data.js approveEntry). A lazy chunk (Main.jsx).
import { useCallback, useEffect, useState } from "react";
import { Check, X, ChevronRight, FileText, ReceiptText, ScrollText, Sigma, Undo2, Repeat } from "lucide-react";
import { loadAll, cloudOn, canWrite, isOwner, nameOf, askable, undo, choose, askEdit, askClose, askReopen, askAnswer, reject, approveEntry, editEntry, trustSet, trustLater, P2, JOURNAL } from "./data.js";
import { TRUST_WORDS, LEVEL_WORDS } from "../../../../server/_shared/dailytrust.js";
import Review from "./Review.jsx";
import "./daily.css";
/* global toast, navHome */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const rs = (v) => "₹" + Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const when = (d) => { d = String(d || ""); return d.length >= 8 ? d.slice(6, 8) + "-" + MON[+d.slice(4, 6) - 1] : d.length === 6 ? MON[+d.slice(4, 6) - 1] : d; };
const at = (s) => { const d = new Date(s); return isNaN(d) ? "" : d.getDate() + " " + MON[d.getMonth()] + ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); };
const EV = { entry: ReceiptText, doc: FileText, rule: ScrollText, twob: Sigma, history: ScrollText, challan: FileText, salary: FileText, gst3b: Sigma, pattern: Repeat };
const STATE = { draft: "Draft", asked: "Asked", answered: "Answered", closed: "Closed" };
const CHECKS = { drcr: "Dr = Cr", ledgers: "Ledgers in Tally", period: "Not in a closed period", duplicate: "No duplicate", gst: "GST adds up",
  groups: "Right groups", twoways: "Worked out two ways", setoff: "Legal set-off order", adds: "Sheet adds up", pattern: "Same as every month" };
// (phase 2) what a row says: a journal FinCom made names its month or its party; a salary line names the employee
const MONTH = (ym) => ym && ym.length === 6 ? MON[+ym.slice(4, 6) - 1] + " " + ym.slice(0, 4) : "";
export function entryWords(e) {
  const v = e.voucher || {};
  if (e.source === "gst_setoff") return { type: "Journal", party: "GSTR-3B " + MONTH(v.period), reason: "GST set-off" };
  if (e.source === "payroll") return { type: "Journal", party: "Salary sheet " + MONTH(v.period), reason: "Payroll" };
  if (e.source === "recurring") return { type: "Journal", party: v.party, reason: "Monthly" };
  const sal = (e.evidence || []).find((x) => x.t === "salary" && / · /.test(x.label || ""));
  if (sal) { const p = sal.label.split(" · "); return { type: v.type, party: p.length >= 3 ? p[1] : v.party, reason: "Salary sheet" }; }
  return { type: v.type, party: v.party, reason: e.reason };
}
const say = (m) => { try { toast(m); } catch (e) { /* no toast here */ } };
const oops = (e) => say(String((e && e.message) || e || "That did not work.").replace(/^.*?ERROR:\s*/, ""));

export function Evidence({ items }) {
  return <ul className="dc-ev">{(items || []).map((e, i) => { const I = EV[e.t] || FileText; return <li key={i}><I width={13} height={13} aria-hidden="true" />{e.label}</li>; })}</ul>;
}
function Row({ id, open, toggle, main, side, children, cls }) {
  return <li className={"dc-row" + (open ? " open" : "") + (cls ? " " + cls : "")} data-row={id}>
    <div className="dc-line">
      <button type="button" className="dc-open" aria-expanded={open} onClick={toggle}><ChevronRight width={15} height={15} className="dc-chev" aria-hidden="true" />{main}</button>
      {side && <div className="dc-side">{side}</div>}
    </div>
    {open && <div className="dc-more">{children}</div>}
  </li>;
}
const Amt = ({ v }) => v ? <b className="dc-amt">{rs(v)}</b> : null;
const groups = (list, key = (x) => x.cid) => { const m = new Map(); list.forEach((x) => { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return Array.from(m, ([cid, items]) => ({ cid, items })).sort((a, b) => nameOf(a.cid).localeCompare(nameOf(b.cid))); };
function Group({ cid, children, right }) {
  return <section className="dc-group" data-client={cid}><div className="dc-gh"><h3>{nameOf(cid)}</h3>{right}</div><ul className="dc-rows">{children}</ul></section>;
}

// a question, opened: its full words, what happened, and what can be done
function AskMore({ f, busy, run }) {
  const q = f.ask, [edit, setEdit] = useState(null), [reply, setReply] = useState(null);
  const w = canWrite();
  return <>
    {edit == null ? <p className="dc-full">{q.text}</p>
      : <div className="dc-edit"><textarea rows={2} aria-label="Question" value={edit} onChange={(ev) => setEdit(ev.target.value)} />
        <button type="button" className="btn small primary" disabled={busy || !edit.trim()} onClick={() => run(() => askEdit(q.id, edit)).then(() => setEdit(null))}>Save</button>
        <button type="button" className="linkbtn" onClick={() => setEdit(null)}>Cancel</button></div>}
    {q.answer && <p className="dc-full"><span className="note">Reply</span> “{q.answer}”</p>}
    <ol className="dc-hist">{(q.history || []).map((h, i) => <li key={i}><time>{at(h.at)}</time>{h.what}</li>)}</ol>
    {reply != null && <div className="dc-edit"><textarea rows={2} aria-label="The client's reply" value={reply} onChange={(ev) => setReply(ev.target.value)} />
      <button type="button" className="btn small primary" disabled={busy || !reply.trim()} onClick={() => run(() => askAnswer(q.id, reply)).then(() => setReply(null))}>Save</button>
      <button type="button" className="linkbtn" onClick={() => setReply(null)}>Cancel</button></div>}
    {w && edit == null && reply == null && <div className="dc-acts">
      {(q.state === "draft" || q.state === "asked") && <button type="button" className="linkbtn" onClick={() => setEdit(q.text)}>Edit</button>}
      {(q.state === "draft" || q.state === "asked") && <button type="button" className="linkbtn" onClick={() => setReply("")}>Type the reply</button>}
      {q.state !== "closed" && <button type="button" className="linkbtn" disabled={busy} onClick={() => run(() => askClose(q.id))}>Close</button>}
      {q.state === "closed" && <button type="button" className="linkbtn" disabled={busy} onClick={() => run(() => askReopen(q.id))}>Open again</button>}
    </div>}
  </>;
}

function FromClients({ list, data, onSend, open, toggle, busy, run }) {
  if (!list.length) return <p className="dc-none" data-none="clients">Nothing to ask.</p>;
  return groups(list).map(({ cid, items }) => {
    const n = askable(data.findings, cid).length, has = (data.contacts[cid] || []).length > 0;
    return <Group key={cid} cid={cid} right={!has ? <span className="note dc-nocontact">No contact</span> : isOwner() ? <button type="button" className="btn small primary" disabled={!n} onClick={() => onSend(cid)}>{"Send " + n}</button> : null}>
      {items.map((f) => <Row key={f.id} id={f.id} open={open === f.id} toggle={() => toggle(f.id)} cls={f.ask.state}
        main={<><i className={"dc-dot " + f.ask.state} title={STATE[f.ask.state]} aria-label={STATE[f.ask.state]} /><Amt v={f.amt} /><span className="dc-party">{f.party}</span><span className="dc-date">{when(f.date)}</span><span className="dc-what">{f.short}</span></>}>
        <AskMore f={f} busy={busy} run={run} />
      </Row>)}
    </Group>;
  });
}

function NeedsYou({ list, busy, run }) {
  if (!list.length) return <p className="dc-none" data-none="you">Nothing needs you.</p>;
  const w = canWrite();
  return groups(list).map(({ cid, items }) => <Group key={cid} cid={cid}>
    {items.map((f) => <li key={f.id} className="dc-row dc-you" data-row={f.id}>
      {/* a question already Asked or Answered when the finding came here stays as it was: shown here, never under From clients */}
      <div className="dc-you-t">{f.title || f.short}{f.ask && (f.ask.state === "asked" || f.ask.state === "answered") && <span className="dc-you-q"><i className={"dc-dot " + f.ask.state} aria-hidden="true" />{STATE[f.ask.state]}</span>}</div>
      <div className="dc-choices" role="group" aria-label={f.title || f.short}>
        {(f.candidates || []).map((c) => <button type="button" key={c.ref} className="dc-choice" disabled={busy || !w} onClick={() => run(() => choose(f.id, c.ref))}>{c.label}</button>)}
        {!P2.has(f.kind) && <button type="button" className="dc-choice" disabled={busy || !w} onClick={() => run(() => choose(f.id, "ask"))}>Ask client</button>}
        <button type="button" className="dc-choice quiet" disabled={busy || !w} onClick={() => run(() => choose(f.id, "dismiss"))}>Not needed</button>
      </div>
    </li>)}
  </Group>);
}

function Lines({ lines }) {
  const t = (k) => lines.reduce((s, l) => s + (Number(l[k]) || 0), 0);
  return <div className="dc-lines" role="table" aria-label="Ledgers">
    {lines.map((l, i) => <div key={i} className="dc-lr" role="row"><span role="cell">{l.ledger}</span><span role="cell" className="n">{l.dr ? rs(l.dr) : ""}</span><span role="cell" className="n">{l.cr ? rs(l.cr) : ""}</span></div>)}
    <div className="dc-lr tot" role="row"><span role="cell" /><span role="cell" className="n">{rs(t("dr"))}</span><span role="cell" className="n">{rs(t("cr"))}</span></div>
  </div>;
}

// (phase 2) a promotion suggested after 20 approvals made as FinCom made them: the owner moves it up a level, or not now
function Suggest({ list, busy, run }) {
  if (!list.length || !isOwner()) return null;
  return <ul className="dc-suggest" data-suggest="">{list.map((s) => <li key={s.cid + s.kind} data-suggest-row={s.cid + ":" + s.kind}>
    <span className="dc-sug-t"><b>{nameOf(s.cid)}</b> · {TRUST_WORDS[s.kind] || s.kind}: {s.n} approved as made. Move to “{LEVEL_WORDS[s.to]}”?</span>
    <span className="dc-sug-a"><button type="button" className="btn small" disabled={busy} onClick={() => run(() => trustSet(s.cid, s.kind, s.to, null))}>Move</button>
      <button type="button" className="linkbtn" disabled={busy} onClick={() => run(() => trustLater(s.cid, s.kind))}>Not now</button></span>
  </li>)}</ul>;
}

function Entries({ list, open, toggle, busy, run, approveMany, suggest }) {
  const [tick, setTick] = useState(() => new Set());
  if (!list.length) return <><Suggest list={suggest || []} busy={busy} run={run} /><p className="dc-none" data-none="entries">No entries ready.</p></>;
  const w = canWrite(), flip = (id) => { const t = new Set(tick); t.has(id) ? t.delete(id) : t.add(id); setTick(t); };
  const picked = list.filter((e) => tick.has(e.id));
  return <>
    <Suggest list={suggest || []} busy={busy} run={run} />
    {w && <div className="dc-bar"><label className="chk"><input type="checkbox" checked={tick.size === list.length} onChange={() => setTick(tick.size === list.length ? new Set() : new Set(list.map((e) => e.id)))} /> All</label>
      <button type="button" className="btn small primary" disabled={busy || !picked.length} onClick={() => approveMany(picked).then(() => setTick(new Set()))}>{"Approve " + picked.length}</button></div>}
    <ul className="dc-rows">{list.map((e) => { const v = e.voucher || {}, amt = (v.lines || []).reduce((s, l) => s + (Number(l.dr) || 0), 0), W = entryWords(e), jv = JOURNAL.has(e.source);
      return <li key={e.id} className={"dc-row dc-entry" + (open === e.id ? " open" : "")} data-row={e.id}>
        <div className="dc-line">
          {w && <input type="checkbox" className="dc-tick" checked={tick.has(e.id)} onChange={() => flip(e.id)} aria-label={"Tick " + v.type + " " + (v.party || "")} />}
          <button type="button" className="dc-open" aria-expanded={open === e.id} onClick={() => toggle(e.id)}><ChevronRight width={15} height={15} className="dc-chev" aria-hidden="true" />
            <span className="dc-type">{W.type}</span><span className="dc-date">{when(v.date)}</span><span className="dc-party">{W.party}</span><span className="dc-reason">{W.reason}</span><Amt v={amt} /></button>
          <div className="dc-side">
            <span className="dc-ok" title={"Checks passed: " + (e.checks || []).map((c) => CHECKS[c.k] || c.k).join(" · ")}><Check width={12} height={12} aria-hidden="true" /><span className="dc-ok-w">Checks</span></span>
            {w && <button type="button" className="dc-icon ok" aria-label="Approve" title="Approve" disabled={busy} onClick={() => approveMany([e])}><Check width={16} height={16} /></button>}
            {w && <button type="button" className="dc-icon no" aria-label="Reject" title="Reject" disabled={busy} onClick={() => run(() => reject(e.id))}><X width={16} height={16} /></button>}
          </div>
        </div>
        {open === e.id && <div className="dc-more"><div className="dc-sub">{nameOf(e.client_id)}{v.narration ? " · " + v.narration : ""}</div><Lines lines={v.lines || []} /><Evidence items={e.evidence} />
          {jv && <p className="dc-checks" data-checks="">{(e.checks || []).filter((c) => c.ok).map((c) => <span key={c.k}><Check width={11} height={11} aria-hidden="true" />{CHECKS[c.k] || c.k}</span>)}</p>}
          {w && !jv && <button type="button" className="linkbtn" onClick={() => editEntry(e).catch(oops)}>Edit</button>}</div>}
      </li>; })}</ul>
  </>;
}

function Done({ list, open, toggle, busy, run }) {
  if (!list.length) return <p className="dc-none" data-none="done">Nothing done by FinCom last night.</p>;
  return groups(list).map(({ cid, items }) => <Group key={cid} cid={cid}>
    {items.map((f) => <Row key={f.id} id={f.id} open={open === f.id} toggle={() => toggle(f.id)}
      main={<><Check width={14} height={14} className="dc-done" aria-hidden="true" /><Amt v={f.amt} /><span className="dc-party">{f.party}</span><span className="dc-date">{when(f.date)}</span><span className="dc-what">{f.short}</span></>}>
      <Evidence items={f.evidence} />{canWrite() && <button type="button" className="linkbtn dc-undo" disabled={busy} onClick={() => run(() => undo(f.id))}><Undo2 width={13} height={13} aria-hidden="true" /> Undo</button>}
    </Row>)}
  </Group>);
}

export default function DailyCheck() {
  const [data, setData] = useState(null), [err, setErr] = useState(""), [tab, setTab] = useState(""), [open, setOpen] = useState(""), [send, setSend] = useState(null), [busy, setBusy] = useState(false);
  const reload = useCallback(() => loadAll().then((d) => { setData(d || false); setErr(""); }, (e) => setErr(String((e && e.message) || e))), []);
  useEffect(() => { reload(); }, [reload]);
  const run = (fn) => { setBusy(true); return Promise.resolve().then(fn).then(reload, oops).finally(() => setBusy(false)); };
  const approveMany = async (list) => {
    setBusy(true); let ok = 0, jv = 0;
    try { for (const e of list) { if (await approveEntry(e).catch((x) => { oops(x); return false; })) { ok++; if (JOURNAL.has(e.source)) jv++; } else break; } }
    finally { setBusy(false); }
    if (typeof navHome === "function") navHome("daily");
    // a journal goes to Tally at once (the existing path for a hand-made voucher); a bill or a bank line waits on the Post page
    if (ok) say(jv === ok ? (ok === 1 ? "Approved and sent to Tally." : ok + " approved and sent to Tally.") : ok === 1 ? "Approved. It is on the Post page." : ok + " approved. Bills and bank lines are on the Post page.");
    reload();
  };
  if (!cloudOn()) return <section className="dc" data-daily=""><p className="dc-none" data-none="cloud">Daily Check runs in the cloud. Sign in to the firm account to see it.</p></section>;
  if (err) return <section className="dc" data-daily=""><p className="dc-none">Could not load. <button type="button" className="linkbtn" onClick={reload}>Try again</button></p></section>;
  if (data === null) return <section className="dc" data-daily="" data-loading-page=""><p className="dc-run">Loading…</p></section>;
  const d = data || { findings: [], entries: [], contacts: {}, mail: {} };
  const ask = d.findings.filter((f) => f.state === "ask" && f.ask), you = d.findings.filter((f) => f.state === "you" && !(f.facts.waits && d.findings.some((g) => g.kind === "ledger_pick" && g.state === "you" && g.cid === f.cid))), resolved = d.findings.filter((f) => f.state === "resolved" && !P2.has(f.kind));
  const openAsks = ask.filter((f) => f.ask.state !== "closed").length;
  const TABS = [["clients", "From clients", openAsks], ["you", "Needs you", you.length], ["entries", "Entries", d.entries.length], ["done", <span key="d">Done<span className="dc-long"> by FinCom</span></span>, resolved.length]];
  const first = TABS.slice(0, 3).reduce((a, t) => (t[2] > a[2] ? t : a))[0], cur = tab || first;
  const toggle = (id) => setOpen(open === id ? "" : id);
  if (send) return <Review cid={send} data={d} back={() => { setSend(null); reload(); }} />;
  return <section className="dc" data-daily="">
    <p className="dc-run">{d.last ? "Last night · " + d.clients + (d.clients === 1 ? " client" : " clients") : "Not run yet · it runs every night"}</p>
    <div className="dc-tabs" role="tablist" aria-label="Daily Check">
      {TABS.map(([k, label, n]) => <button key={k} type="button" role="tab" aria-selected={cur === k} data-tab={k} className="dc-tab" onClick={() => { setTab(k); setOpen(""); }}>{label}<span className="dc-n">{n}</span></button>)}
    </div>
    <div className="dc-body" role="tabpanel">
      {cur === "clients" && <FromClients list={ask} data={d} open={open} toggle={toggle} busy={busy} run={run} onSend={(cid) => { setSend(cid); window.scrollTo(0, 0); }} />}
      {cur === "you" && <NeedsYou list={you} busy={busy} run={run} />}
      {cur === "entries" && <Entries list={d.entries} open={open} toggle={toggle} busy={busy} run={run} approveMany={approveMany} suggest={d.suggestions} />}
      {cur === "done" && <Done list={resolved} open={open} toggle={toggle} busy={busy} run={run} />}
    </div>
  </section>;
}
