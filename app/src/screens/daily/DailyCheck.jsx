// Daily Check (next-assistant, phase 1 DESIGN; docs/ASSISTANT-PHASE1.md). What last night's checks left for the owner,
// in four tabs: From clients (questions, the only thing ever sent) · Needs you · Entries · Done by FinCom. The default
// tab is the one with the most to do. One line a row; details (history, Dr/Cr, evidence) only when a row is opened.
// A lazy chunk (Main.jsx). Made-up data this round (./demo.js): nothing is read, sent or posted. Approve on an entry
// will hand it to the EXISTING posting path (the bill's or bank line's own approval, then the Post page and the bridge).
import { useState } from "react";
import { Check, X, ChevronRight, FileText, ReceiptText, ScrollText, Sigma, Undo2 } from "lucide-react";
import { RUN, FIRM, CLIENTS, FINDINGS, ENTRIES, CHECKS, STATE_WORD, WEEK } from "./demo.js";
import { sendable } from "../../../../server/_shared/asks.js";
import Review from "./Review.jsx";
import "./daily.css";

export const rs = (v) => "₹" + Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const EV = { entry: ReceiptText, doc: FileText, rule: ScrollText, "2b": Sigma };
const nameOf = (id) => (CLIENTS.find((c) => c.id === id) || {}).name || "";
const groups = (list) => CLIENTS.map((c) => ({ c, items: list.filter((x) => x.cid === c.id) })).filter((g) => g.items.length);
const when = (s) => { const d = new Date(s); return isNaN(d) ? s : d.getDate() + " " + d.toLocaleString("en-GB", { month: "short" }) + ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); };

export function Evidence({ items }) {
  return <ul className="dc-ev">{(items || []).map((e, i) => { const I = EV[e.t] || FileText; return <li key={i}><I width={13} height={13} aria-hidden="true" />{e.label}</li>; })}</ul>;
}

// a row that opens: one line, the details under it when opened
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

function Group({ c, children, right }) {
  return <section className="dc-group" data-client={c.id}><div className="dc-gh"><h3>{c.name}</h3>{right}</div><ul className="dc-rows">{children}</ul></section>;
}

function FromClients({ list, onSend, open, toggle }) {
  return groups(list).map(({ c, items }) => {
    const n = sendable(items, null).length;
    return <Group key={c.id} c={c} right={<button type="button" className="btn small primary" disabled={!n} onClick={() => onSend(c.id)}>{"Send " + n}</button>}>
      {items.map((f) => <Row key={f.id} id={f.id} open={open === f.id} toggle={() => toggle(f.id)} cls={f.ask.state}
        main={<><i className={"dc-dot " + f.ask.state} title={STATE_WORD[f.ask.state]} aria-label={STATE_WORD[f.ask.state]} /><Amt v={f.amt} /><span className="dc-party">{f.party}</span><span className="dc-date">{f.date}</span><span className="dc-what">{f.short}</span></>}>
        <p className="dc-full">{f.ask.text}</p>
        <ol className="dc-hist">{f.ask.history.map((h, i) => <li key={i}><time>{when(h.at)}</time>{h.what}</li>)}</ol>
      </Row>)}
    </Group>;
  });
}

function NeedsYou({ list }) {
  const [pick, setPick] = useState({});
  return groups(list).map(({ c, items }) => <Group key={c.id} c={c}>
    {items.map((f) => <li key={f.id} className="dc-row dc-you" data-row={f.id}>
      <div className="dc-you-t">{f.title}</div>
      <div className="dc-choices" role="group" aria-label={f.title}>
        {f.act ? <button type="button" className="btn small">{f.act}</button>
          : f.choices.map((x) => <button type="button" key={x} className={"dc-choice" + (pick[f.id] === x ? " on" : "")} aria-pressed={pick[f.id] === x} onClick={() => setPick({ ...pick, [f.id]: x })}>{x}</button>)}
      </div>
    </li>)}
  </Group>);
}

function Lines({ lines }) {
  const t = (k) => lines.reduce((s, l) => s + (l[k] || 0), 0);
  return <div className="dc-lines" role="table" aria-label="Ledgers">
    {lines.map((l, i) => <div key={i} className="dc-lr" role="row"><span role="cell">{l.l}</span><span role="cell" className="n">{l.dr ? rs(l.dr) : ""}</span><span role="cell" className="n">{l.cr ? rs(l.cr) : ""}</span></div>)}
    <div className="dc-lr tot" role="row"><span role="cell" /><span role="cell" className="n">{rs(t("dr"))}</span><span role="cell" className="n">{rs(t("cr"))}</span></div>
  </div>;
}

function Entries({ list, open, toggle }) {
  const [tick, setTick] = useState(() => new Set());
  const [done, setDone] = useState({});
  const flip = (id) => { const t = new Set(tick); t.has(id) ? t.delete(id) : t.add(id); setTick(t); };
  return <>
    <div className="dc-bar"><label className="chk"><input type="checkbox" checked={tick.size === list.length} onChange={() => setTick(tick.size === list.length ? new Set() : new Set(list.map((e) => e.id)))} /> All</label>
      <button type="button" className="btn small primary" disabled={!tick.size}>{"Approve " + tick.size}</button></div>
    <ul className="dc-rows">{list.map((e) => <li key={e.id} className={"dc-row dc-entry" + (open === e.id ? " open" : "")} data-row={e.id}>
      <div className="dc-line">
        <input type="checkbox" className="dc-tick" checked={tick.has(e.id)} onChange={() => flip(e.id)} aria-label={"Tick " + e.type + " " + e.party} />
        <button type="button" className="dc-open" aria-expanded={open === e.id} onClick={() => toggle(e.id)}><ChevronRight width={15} height={15} className="dc-chev" aria-hidden="true" />
          <span className="dc-type">{e.type}</span><span className="dc-date">{e.date}</span><span className="dc-party">{e.party}</span><span className="dc-reason">{e.reason}</span><Amt v={e.amt} /></button>
        <div className="dc-side">
          <span className="dc-ok" title={"Checks passed: " + CHECKS}><Check width={12} height={12} aria-hidden="true" /><span className="dc-ok-w">Checks</span></span>
          <button type="button" className="dc-icon ok" aria-label="Approve" title="Approve" onClick={() => setDone({ ...done, [e.id]: "ok" })}><Check width={16} height={16} /></button>
          <button type="button" className="dc-icon no" aria-label="Reject" title="Reject" onClick={() => setDone({ ...done, [e.id]: "no" })}><X width={16} height={16} /></button>
        </div>
      </div>
      {open === e.id && <div className="dc-more"><div className="dc-sub">{nameOf(e.cid)} · {e.narr}</div><Lines lines={e.lines} /><Evidence items={e.evidence} />
        <button type="button" className="linkbtn">Edit</button></div>}
    </li>)}</ul>
  </>;
}

function Done({ list, open, toggle }) {
  return groups(list).map(({ c, items }) => <Group key={c.id} c={c}>
    {items.map((f) => <Row key={f.id} id={f.id} open={open === f.id} toggle={() => toggle(f.id)}
      main={<><Check width={14} height={14} className="dc-done" aria-hidden="true" /><Amt v={f.amt} /><span className="dc-party">{f.party}</span><span className="dc-date">{f.date}</span><span className="dc-what">{f.short}</span></>}>
      <Evidence items={f.evidence} /><button type="button" className="linkbtn dc-undo"><Undo2 width={13} height={13} aria-hidden="true" /> Undo</button>
    </Row>)}
  </Group>);
}

export default function DailyCheck() {
  const ask = FINDINGS.filter((f) => f.state === "ask"), you = FINDINGS.filter((f) => f.state === "you"), resolved = FINDINGS.filter((f) => f.state === "resolved");
  const openAsks = ask.filter((f) => f.ask.state !== "closed").length;
  const TABS = [["clients", "From clients", openAsks], ["you", "Needs you", you.length], ["entries", "Entries", ENTRIES.length], ["done", <span>Done<span className="dc-long"> by FinCom</span></span>, resolved.length]];
  // the default: the most to do (Done by FinCom is never "to do")
  const first = TABS.slice(0, 3).reduce((a, t) => (t[2] > a[2] ? t : a))[0];
  const [tab, setTab] = useState(first);
  const [open, setOpen] = useState("");
  const [send, setSend] = useState(null);
  const toggle = (id) => setOpen(open === id ? "" : id);
  if (send) return <Review client={CLIENTS.find((c) => c.id === send)} findings={FINDINGS.filter((f) => f.cid === send)} firm={FIRM} week={WEEK} back={() => setSend(null)} />;
  return <section className="dc" data-daily="">
    <p className="dc-run">Last night · {RUN.clients} clients</p>
    <div className="dc-tabs" role="tablist" aria-label="Daily Check">
      {TABS.map(([k, label, n]) => <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} className="dc-tab" onClick={() => { setTab(k); setOpen(""); }}>{label}<span className="dc-n">{n}</span></button>)}
    </div>
    <div className="dc-body" role="tabpanel">
      {tab === "clients" && <FromClients list={ask} open={open} toggle={toggle} onSend={(cid) => { setSend(cid); window.scrollTo(0, 0); }} />}
      {tab === "you" && <NeedsYou list={you} />}
      {tab === "entries" && <Entries list={ENTRIES} open={open} toggle={toggle} />}
      {tab === "done" && <Done list={resolved} open={open} toggle={toggle} />}
    </div>
  </section>;
}
