// The Assistant page (next-assistant, phase 1 DESIGN, 21-Nov-2026; docs/ASSISTANT-PHASE1.md). The morning page: what the
// night's checks found for each client, in the order the owner works through it:
//   1. Resolved by FinCom overnight (N)   folded; each with its evidence (the entry, the document or the rule) and Undo
//   2. Still need from client (N)         one weekly list per client; the only thing ever sent (Review and send)
//   3. Needs you / Entries ready for you  side by side on a computer, one under the other on a phone
// Its own file (Main.jsx: lazy), with its own styles; nothing of it is in legacy.js or the app's first file.
//
// This round draws made-up data (./demo.js, marked "Sample data"); nothing is read from or written to the cloud, nothing
// is sent and nothing is posted. Approve on an entry will hand it to the EXISTING posting path (the bill's or the bank
// line's own approval, then the Post page and the bridge), never a path of its own.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, ListChecks, Mail, MessageCircle, Moon, ReceiptText, ScrollText, Sigma, TriangleAlert, Undo2, Check, X, Pencil, Users } from "lucide-react";
import { RUN, FIRM, CLIENTS, FINDINGS, ENTRIES, COMING, STATE_WORD, STATE_TAG, WEEK } from "./demo.js";
import { sendable } from "../../../../server/_shared/asks.js";
import Review from "./Review.jsx";
import AskStates, { AskHistory } from "./AskStates.jsx";
import "./assistant.css";

export const rs = (v) => "₹" + Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const EV_ICON = { entry: ReceiptText, doc: FileText, rule: ScrollText, "2b": Sigma, salary: Users };
const clientOf = (id) => CLIENTS.find((c) => c.id === id) || { name: "?" , contacts: [] };
const byClient = (list) => CLIENTS.map((c) => ({ c, items: list.filter((x) => x.cid === c.id) })).filter((g) => g.items.length);

export function Evidence({ items }) {
  return <ul className="as-ev" aria-label="Evidence">{(items || []).map((e, i) => {
    const I = EV_ICON[e.t] || FileText;
    return <li key={i} data-ev={e.t}><I width={14} height={14} strokeWidth={1.9} aria-hidden="true" /><span>{e.label}</span></li>;
  })}</ul>;
}

function Section({ id, title, n, tone, open, toggle, note, children, foldable }) {
  const Chev = open ? ChevronDown : ChevronRight;
  return <section className="as-sec dash-card" data-tone={tone} data-as-sec={id}>
    <div className="as-sec-h">
      {foldable ? <button type="button" className="as-fold" aria-expanded={open} onClick={toggle}><Chev width={18} height={18} aria-hidden="true" /><h3>{title} <span className="as-n">{n}</span></h3></button>
        : <h3>{title} <span className="as-n">{n}</span></h3>}
    </div>
    {note && <p className="note as-sec-note">{note}</p>}
    {open && children}
  </section>;
}

function Resolved({ list }) {
  const [open, setOpen] = useState(false);
  return <Section id="resolved" title="Resolved by FinCom overnight" n={list.length} tone="emerald" foldable open={open} toggle={() => setOpen(!open)}
    note={open ? "Each one is an exact match by FinCom’s rules: same party, amount within ₹1, date in range, nothing used twice. Nothing was posted or sent. Undo puts it back as a question." : "Nothing here is sent to clients. Open to see each with its evidence."}>
    {byClient(list).map(({ c, items }) => <div className="as-group" key={c.id}>
      <div className="as-group-h"><b>{c.name}</b><span className="note">{items.length}</span></div>
      <ul className="as-list">{items.map((f) => <li key={f.id} className="as-item" data-finding={f.id}>
        <div className="as-item-main"><p className="as-says">{f.says}</p><p className="as-how"><Check width={14} height={14} aria-hidden="true" /> {f.how}</p><Evidence items={f.evidence} /></div>
        <button type="button" className="btn small as-undo" title="Put it back as a question"><Undo2 width={14} height={14} aria-hidden="true" />Undo</button>
      </li>)}</ul>
    </div>)}
  </Section>;
}

function ClientAsks({ c, items, onReview }) {
  const qs = items.filter((f) => f.ask), go = sendable(items, null);
  const counts = ["draft", "asked", "answered", "closed"].map((s) => [s, qs.filter((f) => f.ask.state === s).length]).filter(([, n]) => n);
  const em = c.contacts.filter((k) => k.byEmail && k.email).length, wa = c.contacts.filter((k) => k.byWa && k.wa).length;
  return <div className="as-client" data-ask-client={c.id}>
    <div className="as-client-h">
      <div><b>{c.name}</b><div className="note as-reach">{em || wa ? <>{em > 0 && <span><Mail width={13} height={13} aria-hidden="true" /> {em} email</span>}{wa > 0 && <span><MessageCircle width={13} height={13} aria-hidden="true" /> {wa} WhatsApp</span>}</> : <span className="as-warn">No contact yet</span>}</div></div>
      <div className="as-client-acts">{counts.map(([s, n]) => <span key={s} className={"tag " + STATE_TAG[s]}>{n + " " + STATE_WORD[s].toLowerCase()}</span>)}
        <button type="button" className="btn small primary" disabled={!go.length} onClick={onReview}>{"Review and send (" + go.length + ")"}</button></div>
    </div>
    <ol className="as-qs">{qs.map((f) => <li key={f.ask.id} data-ask={f.ask.id} data-state={f.ask.state}>
      <span className="as-q">{f.ask.edited || f.ask.text}</span><span className={"tag " + STATE_TAG[f.ask.state]}>{STATE_WORD[f.ask.state]}</span>
      {f.ask.state !== "draft" && <AskHistory ask={f.ask} compact />}
    </li>)}</ol>
  </div>;
}

function StillNeed({ list, onReview, onStates }) {
  const n = list.filter((f) => f.ask && f.ask.state !== "closed").length;
  return <Section id="client" title="Still need from client" n={n} tone="amber" open
    note={"This week’s list, week of " + WEEK + ". Only these go to clients, after you tick and press Send. Questions close by themselves when the document or the entry comes."}>
    {byClient(list).map(({ c, items }) => <ClientAsks key={c.id} c={c} items={items} onReview={() => onReview(c.id)} />)}
    <p className="note as-foot"><button type="button" className="linkbtn" data-as-states="" onClick={onStates}>How a question moves</button> · Draft, Asked, Answered, Closed</p>
  </Section>;
}

function NeedsYou({ list }) {
  return <Section id="you" title="Needs you" n={list.length} tone="rose" open note="FinCom could not be sure. It never picks between two that fit.">
    <ul className="as-list">{list.map((f) => <li key={f.id} className="as-item as-you" data-finding={f.id}>
      <div className="as-item-main"><div className="note as-who">{clientOf(f.cid).name}</div><p className="as-says">{f.says}</p>
        {f.tie && <div className="as-tie" role="group" aria-label="Both fit">{f.tie.map((t) => <label key={t} className="chk"><input type="radio" name={"tie-" + f.id} /> {t}</label>)}</div>}
        <p className="note">{f.note}</p></div>
      <div className="as-you-acts">{f.act === "contacts" ? <button type="button" className="btn small primary">Add contacts</button>
        : f.tie ? <><button type="button" className="btn small primary">Use the one ticked</button><button type="button" className="btn small">Leave open</button></>
        : <><button type="button" className="btn small">It is the same</button><button type="button" className="btn small">Ask the client</button></>}</div>
    </li>)}</ul>
  </Section>;
}

function Lines({ lines }) {
  // a grid, not a table: the app's phone styles turn every table into cards
  const dr = lines.reduce((s, l) => s + (l.dr || 0), 0), cr = lines.reduce((s, l) => s + (l.cr || 0), 0);
  return <div className="as-lines" role="table" aria-label="Ledgers">
    <div className="as-lr as-lh" role="row"><span role="columnheader">Ledger</span><span role="columnheader" className="n">Dr</span><span role="columnheader" className="n">Cr</span></div>
    {lines.map((l, i) => <div className="as-lr" role="row" key={i}><span role="cell">{l.l}{l.ref && <span className="note"> · {l.ref}</span>}</span><span role="cell" className="n">{l.dr ? rs(l.dr) : ""}</span><span role="cell" className="n">{l.cr ? rs(l.cr) : ""}</span></div>)}
    <div className="as-lr as-lt" role="row"><span role="cell">Total</span><span role="cell" className="n">{rs(dr)}</span><span role="cell" className="n">{rs(cr)}</span></div>
  </div>;
}

const SRC = { "2b_inbox": "From an Inbox bill (2B gap)", bank_self: "From a bank line" };
function EntriesReady({ list }) {
  const [tick, setTick] = useState(() => new Set(["e1", "e2"]));
  const flip = (id) => { const t = new Set(tick); t.has(id) ? t.delete(id) : t.add(id); setTick(t); };
  return <Section id="entries" title="Entries ready for you" n={list.length} tone="indigo" open
    note="Checked first: Dr equals Cr, ledgers in Tally, not in a closed period, no duplicate, GST adds up. Approved entries go to the Post page and Tally the usual way.">
    <div className="as-bulk"><label className="chk"><input type="checkbox" checked={tick.size === list.length} onChange={() => setTick(tick.size === list.length ? new Set() : new Set(list.map((e) => e.id)))} /> Tick all</label>
      <button type="button" className="btn small primary" disabled={!tick.size}>{"Approve ticked (" + tick.size + ")"}</button></div>
    <ul className="as-list">{list.map((e) => <li key={e.id} className="as-entry" data-entry={e.id}>
      <div className="as-entry-h"><label className="chk"><input type="checkbox" checked={tick.has(e.id)} onChange={() => flip(e.id)} aria-label={"Tick " + e.type + " " + e.party} /></label>
        <div className="as-entry-t"><b>{e.type}</b><span>{fmt(e.date)}</span>{e.no && <span>{e.no}</span>}<span className="note">{clientOf(e.cid).name}</span></div>
        <b className="as-amt">{rs(e.lines.reduce((s, l) => s + (l.dr || 0), 0))}</b></div>
      <Lines lines={e.lines} />
      <p className="as-narr"><span className="note">Narration</span> {e.narr}</p>
      <div className="as-why"><span className="tag info">{SRC[e.src]}</span> {e.why}</div>
      <Evidence items={e.evidence} />
      <div className="as-checks">{e.checks.map((c) => <span key={c}><Check width={13} height={13} aria-hidden="true" />{c}</span>)}</div>
      <div className="as-entry-acts"><button type="button" className="btn small primary"><Check width={14} height={14} aria-hidden="true" />Approve</button>
        <button type="button" className="btn small"><Pencil width={14} height={14} aria-hidden="true" />Edit</button>
        <button type="button" className="btn small"><X width={14} height={14} aria-hidden="true" />Reject</button></div>
    </li>)}</ul>
    <div className="as-coming" aria-label="Coming next">{COMING.map((c) => <div key={c.k} className="as-coming-i"><span className="tag no">Coming</span> <b>{c.label}</b> <span className="note">{c.note}</span></div>)}</div>
  </Section>;
}
const fmt = (iso) => { const [y, m, d] = String(iso).split("-"); return d + "-" + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m - 1] + "-" + y; };

function Metric({ label, n, tone, Icon, go }) {
  return <button type="button" className="metric" data-tone={tone} onClick={go}><span>{label}</span><b>{n}</b><i className="dtile-chip" aria-hidden="true"><Icon width={16} height={16} strokeWidth={2} /></i></button>;
}

export default function AssistantPage() {
  const [view, setView] = useState(null);   // null: the page; {review: client id}
  const parts = useMemo(() => ({
    resolved: FINDINGS.filter((f) => f.state === "resolved"), ask: FINDINGS.filter((f) => f.state === "ask"), you: FINDINGS.filter((f) => f.state === "you") }), []);
  const top = () => window.scrollTo(0, 0);
  if (view && view.states) return <AskStates back={() => setView(null)} />;
  if (view && view.review) return <Review client={clientOf(view.review)} findings={FINDINGS.filter((f) => f.cid === view.review)} firm={FIRM} week={WEEK} back={() => setView(null)} />;
  const jump = (id) => () => { const e = document.querySelector('[data-as-sec="' + id + '"]'); if (e) e.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const open = parts.ask.filter((f) => f.ask.state !== "closed").length;
  return <section className="as-page" data-assistant="">
    <div className="as-top">
      <div><h2>Assistant</h2>
        <p className="note as-run"><Moon width={14} height={14} aria-hidden="true" /> Checked last night at 2:10 am · {RUN.clients} clients · {RUN.books}</p></div>
      <span className="tag warn as-sample" title="Design preview: made-up data">Sample data</span>
    </div>
    <div className="metrics as-metrics">
      <Metric label="Resolved by FinCom" n={parts.resolved.length} tone="emerald" Icon={Check} go={jump("resolved")} />
      <Metric label="Still need from client" n={open} tone="amber" Icon={ListChecks} go={jump("client")} />
      <Metric label="Needs you" n={parts.you.length} tone="rose" Icon={TriangleAlert} go={jump("you")} />
      <Metric label="Entries ready" n={ENTRIES.length} tone="indigo" Icon={ReceiptText} go={jump("entries")} />
    </div>
    <Resolved list={parts.resolved} />
    <StillNeed list={parts.ask} onReview={(cid) => { setView({ review: cid }); top(); }} onStates={() => { setView({ states: true }); top(); }} />
    <div className="as-two"><NeedsYou list={parts.you} /><EntriesReady list={ENTRIES} /></div>
  </section>;
}
