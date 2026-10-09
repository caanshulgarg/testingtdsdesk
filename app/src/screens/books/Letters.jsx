// Letters: balance confirmations for the audit, dues reminders to customers, and who the letters are from. Nothing is
// sent from here: letters are printed or saved as PDF (LTR.confirmHtml / remindHtml, the print templates), or opened in
// the user's own email or WhatsApp. Was LTR.view, viewConfirm, viewRemind, viewSettings and contactCells (src/js/46);
// changes go through ltrMode, ltrSet, ltrQ, ltrSide, ltrSel, ltrAct, ltrOne, ltrContact, ltrReply, ltrTheir, ltrCfg,
// ltrCfgType (src/js/46).
//
// State: S.ltr (mode, asOn, remOn, sides, min, q, show, sel: parties ticked, credit, tone, busy, tally).
import { useEffect } from "react";
import NoBooks from "../../parts/NoBooks.jsx";
import CommitBox from "../../parts/CommitBox.jsx";
import FreshBar from "../../parts/FreshBar.jsx";
import { BusyCard } from "../../parts/Reading.jsx";
import ListTable from "../../parts/ListTable.jsx";
import DateBox from "../../parts/DateBox.jsx";

const Tile = ({ l, v, sub, cls }) => <div className={"dtile" + (cls ? " " + cls : "")}><span>{l}</span><b>{v}</b><small>{sub}</small></div>;
const Sel = ({ label, value, opts, onChange, className }) => <select className={className} aria-label={label} value={value} onChange={(ev) => onChange(ev.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
const LedBtn = ({ l }) => <button className="linkbtn strong" onClick={() => lkLed(l)}>{l}</button>;

// a party's email and phone, kept as typed
const contactCols = () => [
  { k: "email", label: "Email", cell: (r) => <input type="email" className="ltr-in" defaultValue={r.c.email} placeholder="email" aria-label={r.l + " email"} onChange={(ev) => ltrContact(r.l, "email", ev.target.value)} /> },
  { k: "phone", label: "Phone", cell: (r) => <input type="tel" className="ltr-in sm" defaultValue={r.c.phone} placeholder="phone" aria-label={r.l + " phone"} onChange={(ev) => ltrContact(r.l, "phone", ev.target.value)} /> },
];
const SendBtns = ({ kind, l }) => <><button className="btn small" onClick={() => ltrOne(kind, "print", l)}>Letter</button><button className="btn small" title={kind === "confirm" ? "Opens your email with the letter written" : undefined} onClick={() => ltrOne(kind, "mail", l)}>Email</button><button className="btn small" onClick={() => ltrOne(kind, "wa", l)}>WhatsApp</button></>;

function Confirm() {
  const x = LTR.st(), { B, rows } = LTR.confirmRows(), c = LTR.cfg();
  const form = <section className="dash-card" style={{ marginTop: 12 }}><div className="lk-form">
    <label className="f"><span>Balance as on</span><DateBox aria-label="Balance as on" value={FC.iso(x.asOn)} onChange={(ev) => ltrSet("asOn", ev.target.value, true)} /></label>
    <div className="f"><span>Write to</span><div className="row" style={{ gap: 12 }}>{[["r", "Customers"], ["p", "Suppliers"], ["o", "Loans and advances"]].map(([k, l]) => <label key={k} className="chk"><input type="checkbox" checked={!!x.sides[k]} onChange={(ev) => ltrSide(k, ev.target.checked)} /> {l}</label>)}</div></div>
    <label className="f"><span>Balances of at least</span><CommitBox inputMode="decimal" aria-label="Balances of at least" value={x.min} onCommit={(v) => ltrSet("min", v)} /></label>
    <label className="f"><span>Show</span><Sel label="Show" value={x.show} opts={[["all", "Every party"], ["notsent", "Not sent yet"], ["waiting", "Sent, no reply yet"], ["differs", "Replied with a difference"]]} onChange={(v) => ltrSet("show", v)} /></label>
    <label className="f lk-wide"><span>Find</span><input type="search" data-fk="ltrQ" aria-label="Find a party" value={x.q} placeholder="party or GSTIN" onChange={(ev) => ltrQ(ev.target.value)} /></label></div>
    <p className="note" style={{ margin: "8px 0 0" }}>Replies go to <b>{LTR.replyTo().name}</b>{(c.replyTo === "auditor" ? " (the auditor)" : "") + ". " + (c.attach ? "Each letter carries the party’s statement of account for the year." : "") + " "}<button className="linkbtn" onClick={() => ltrMode("settings")}>Change</button></p></section>;
  if (!B.ok) return <>{form}<div className="fc-empty"><h3>{"The balances on " + FC.when(x.asOn) + " are not in FinCom’s copy of the books yet"}</h3><p className="note">{(B.why || "") + "."}</p><FreshBar b={S.books} /></div></>;
  const rec = LTR.store().conf[x.asOn] || {}, all = Object.values(rec), sent = all.filter((s) => s.sentAt).length, agreed = all.filter((s) => s.reply === "agreed").length, diff = all.filter((s) => s.reply === "differs").length;
  const picked = rows.filter((r) => x.sel[r.l]);
  return <>{form}
    <div className="dash-tiles" style={{ marginTop: 12 }}><Tile l="Parties" v={rows.length} sub={B.src} /><Tile l="Sent" v={sent} sub="for this date" /><Tile l="Agreed" v={agreed} sub="confirmed by the party" /><Tile l="Differences" v={diff} sub="to reconcile" cls={diff ? "warn" : ""} /></div>
    {!rows.length ? <div className="bk-none lt-empty" data-list-empty="">No party with a balance matches. Change the choices above: an earlier date, a lower amount, or more kinds of party.</div> : <>
      <div className="row ltr-bar"><button className="btn primary" disabled={!picked.length} title={!picked.length ? "Tick at least one party in the list first" : undefined} onClick={() => ltrAct("print")}>{"Print or PDF the letters (" + picked.length + ")"}</button>
        <button className="btn" onClick={() => ltrAct("selall")}>{picked.length === rows.length ? "Untick all" : "Tick all " + rows.length}</button><button className="btn" onClick={() => ltrAct("excel")}>Excel of the list</button></div>
      {/* the one list table (spec K6): sent (date), party, balance, reply (status), then the rest */}
      <ListTable name="ltr-confirm" className="bk-table lk-t ltr-t" rows={rows} rowKey={(r, i) => r.l + ":" + i} unit={["party", "parties"]} rowProps={(r) => ({ "data-key": r.l })}
        cols={[
          { k: "pick", role: "pick", cls: "ck", head: "", cell: (r) => <input type="checkbox" checked={!!x.sel[r.l]} aria-label={"Tick " + r.l} onChange={(ev) => ltrSel(r.l, ev.target.checked)} /> },
          { k: "sent", role: "date", label: "Sent", v: (r) => r.s.sentAt || "", cell: (r) => (r.s.sentAt ? <>{fmtDate(r.s.sentAt.slice(0, 10))}<span className="nr">{r.s.via || ""}</span></> : <span className="note">not yet</span>) },
          { k: "party", role: "party", label: "Party", v: (r) => r.l, cell: (r) => <><LedBtn l={r.l} /><span className="nr">{({ r: "customer", p: "supplier", o: "loan or advance" }[r.side]) + (r.gstin ? " · " + r.gstin : "")}</span></> },
          { k: "bal", role: "amount", label: "Balance", cls: "n", v: (r) => num(r.bal), fmt: (t) => FC.drcr(t), cell: (r) => FC.drcr(r.bal) },
          { k: "reply", role: "status", label: "Reply", v: (r) => r.s.reply || "", cell: (r) => <><Sel className="ltr-in sm" label={"Reply from " + r.l} value={r.s.reply || ""} opts={[["", "—"], ["agreed", "Agreed"], ["differs", "Differs"], ["none", "No reply"]]} onChange={(v) => ltrReply(r.l, v)} />
            {r.s.reply === "differs" && <><input type="text" className="ltr-in sm" inputMode="decimal" defaultValue={r.s.their || ""} placeholder="their figure" aria-label="Their balance" onChange={(ev) => ltrTheir(r.l, ev.target.value)} />
              {num(r.s.their) ? <span className="nr bad">{"difference " + money(Math.abs(r2(Math.abs(r.bal) - num(r.s.their))))}</span> : null}</>}</> },
          ...contactCols(),
          { k: "ac", role: "act", cls: "ac", cell: (r) => <SendBtns kind="confirm" l={r.l} /> },
        ]} /></>}
  </>;
}

function Remind() {
  const x = LTR.st(), rows = LTR.remindRows(), c = LTR.cfg(), picked = rows.filter((r) => x.sel["rem|" + r.l]), tot = rows.reduce((s, r) => s + r.amt, 0);
  return <>
    <section className="dash-card" style={{ marginTop: 12 }}><div className="lk-form">
      <label className="f"><span>Bills due as on</span><DateBox aria-label="Bills due as on" value={FC.iso(x.remOn)} onChange={(ev) => ltrSet("remOn", ev.target.value, true)} /></label>
      <label className="f"><span>Credit allowed</span><Sel label="Credit allowed" value={String(num(x.credit))} opts={[0, 15, 30, 45, 60, 90].map((d) => [String(d), d ? d + " days" : "none"])} onChange={(v) => ltrSet("credit", v)} /></label>
      <label className="f"><span>Tone</span><Sel label="Tone" value={x.tone} opts={[["friendly", "Friendly"], ["firm", "Firm"], ["final", "Final reminder"]]} onChange={(v) => ltrSet("tone", v)} /></label>
      <label className="f lk-wide"><span>Find</span><input type="search" data-fk="ltrQ2" aria-label="Find a customer" value={x.q} placeholder="customer or GSTIN" onChange={(ev) => ltrQ(ev.target.value)} /></label></div>
      <label className="chk" style={{ marginTop: 8 }}><input type="checkbox" checked={!!c.msme} onChange={(ev) => ltrCfg("msme", ev.target.checked)} /> The client is a micro or small enterprise: mention the MSMED Act interest</label></section>
    <div className="dash-tiles" style={{ marginTop: 12 }}><Tile l="Overdue" v={money0(tot)} sub={"past " + num(x.credit) + " days"} cls="warn" /><Tile l="Customers" v={rows.length} sub="with bills overdue" />
      <Tile l="Over 90 days" v={money0(rows.reduce((s, r) => s + r.over.filter((z) => z.age > 90).reduce((a, z) => a + z.amt, 0), 0))} sub="the oldest" /><Tile l="Reminded" v={rows.filter((r) => r.last).length} sub="at least once" /></div>
    {!rows.length ? <div className="fc-empty"><h3>Nothing overdue</h3><p className="note">{"No customer has a bill older than " + num(x.credit) + " days on " + FC.when(x.remOn) + ". Bills are read from the bill-wise details in Tally."}</p></div> : <>
      <div className="row ltr-bar"><button className="btn primary" disabled={!picked.length} onClick={() => ltrAct("rprint")}>{"Print or PDF the reminders (" + picked.length + ")"}</button>
        <button className="btn" onClick={() => ltrAct("rselall")}>{picked.length === rows.length ? "Untick all" : "Tick all " + rows.length}</button></div>
      {/* the one list table (spec K6): last reminder (date), customer, overdue (amount), then the rest */}
      <ListTable name="ltr-remind" className="bk-table lk-t ltr-t" rows={rows} rowKey={(r, i) => r.l + ":" + i} unit={["customer", "customers"]} rowProps={(r) => ({ "data-key": r.l })}
        cols={[
          { k: "pick", role: "pick", cls: "ck", head: "", cell: (r) => <input type="checkbox" checked={!!x.sel["rem|" + r.l]} aria-label={"Tick " + r.l} onChange={(ev) => ltrSel("rem|" + r.l, ev.target.checked)} /> },
          { k: "last", role: "date", label: "Last reminder", v: (r) => (r.last ? r.last.at : ""), cell: (r) => (r.last ? <>{fmtDate(r.last.at.slice(0, 10))}<span className="nr">{r.last.via + ", " + (r.last.tone || "")}</span></> : <span className="note">never</span>) },
          { k: "cust", role: "party", label: "Customer", v: (r) => r.l, cell: (r) => <><LedBtn l={r.l} /><span className="nr">{r.over.length + " bill" + (r.over.length === 1 ? "" : "s") + " · owes " + money(r.total) + " in all"}</span></> },
          { k: "amt", role: "amount", label: "Overdue", cls: "n", v: (r) => num(r.amt), cell: (r) => money(r.amt) },
          { k: "old", label: "Oldest", cls: "n", v: (r) => r.oldest, td: (r) => ({ className: r.oldest > 90 ? "bad" : undefined }), cell: (r) => r.oldest + " days" },
          ...contactCols(),
          { k: "ac", role: "act", cls: "ac", cell: (r) => <SendBtns kind="remind" l={r.l} /> },
        ]} /></>}
  </>;
}

function Settings() {
  const c = LTR.cfg();
  const inp = (k, l, ph, t) => <label className="f"><span>{l}</span><input type={t || "text"} aria-label={l} defaultValue={c[k] || ""} placeholder={ph || ""} onChange={(ev) => ltrCfgType(k, ev.target.value)} /></label>;
  const chk = (k, text) => <label className="chk"><input type="checkbox" checked={!!c[k]} onChange={(ev) => ltrCfg(k, ev.target.checked)} /> {text}</label>;
  return <section className="dash-card" style={{ marginTop: 12 }}><h3>Who the letters are from, and where replies go</h3><div className="lk-form">
    {inp("signer", "Signed by (name and designation)", "Rakesh Mehra, Director")}{inp("companyEmail", "The client’s email for replies", "accounts@client.in", "email")}
    <label className="f"><span>Replies go to</span><Sel label="Replies go to" value={c.replyTo === "auditor" ? "auditor" : "company"} opts={[["company", "The client"], ["auditor", "The auditor, directly"]]} onChange={(v) => ltrCfg("replyTo", v)} /></label>
    {inp("auditor", "Auditor’s name", "Mehra & Iyer, Chartered Accountants")}{inp("auditorEmail", "Auditor’s email", "audit@firm.in", "email")}
    <label className="f"><span>Days to reply</span><input type="text" inputMode="numeric" aria-label="Days to reply" defaultValue={c.days} onChange={(ev) => ltrCfgType("days", ev.target.value)} /></label>{inp("udyam", "Udyam number (for reminders)", "UDYAM-UP-00-0000000")}</div>
    <div className="stack" style={{ gap: 6, marginTop: 10 }}>{chk("attach", "Put the party’s statement of account for the year under each confirmation")}
      {chk("negative", "Say that no reply means the balance is taken as correct (a negative confirmation; the auditor decides whether that is enough)")}
      {chk("msme", "The client is a micro or small enterprise: mention the MSMED Act interest in reminders")}</div>
    <p className="note" style={{ marginTop: 10 }}>For an audit, confirmations are best sent by the auditor with replies coming straight back to the auditor (SA 505). Choose “The auditor, directly” for that.</p></section>;
}

export default function Letters({ b }) {
  const x = LTR.st(), have = (b.vouchers || []).length > 0;
  const head = <section className="dash-card"><div className="rpt-top-row"><div><h3>Confirmations and reminders</h3><p className="note" style={{ margin: 0 }}>Letters are printed or saved as PDF, or opened in your own email or WhatsApp to send. Nothing is sent from FinCom.</p></div></div>
    <div className="lk-kinds" role="tablist" aria-label="Letters">{[["confirm", "Balance confirmations"], ["remind", "Dues reminders"], ["settings", "Letter settings"]].map(([k, l]) => <button key={k} role="tab" aria-selected={x.mode === k} onClick={() => ltrMode(k)}>{l}</button>)}</div></section>;
  if (!have && x.mode !== "settings") return <>{head}<NoBooks what="Letters" /></>;
  return <>{head}
    {x.busy && <BusyCard title="Working it out…" detail={x.busy} done={0} total={0} />}
    <AutoFresh />
    {LK.fr().busy && <BusyCard title="Bringing the books up to date…" detail={LK.fr().busy} done={0} total={0} />}
    {x.mode === "settings" ? <Settings /> : x.mode === "confirm" ? <Confirm /> : <Remind />}
  </>;
}

// with the bridge live, the books are brought up to date on opening (as before, after each drawing)
function AutoFresh() {
  useEffect(() => { if (typeof bridgeLive === "function" && bridgeLive(CO())) setTimeout(() => LK.autoFresh(), 0); });
  return null;
}
