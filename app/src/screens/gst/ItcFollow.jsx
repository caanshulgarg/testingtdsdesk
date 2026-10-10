// ITC follow-up: every bill 2B and Tally do not agree on, carried from month to month until it is settled, what to
// do about each, and the suppliers to write to. Was viewItcFollow (src/js/32). The lines are ITCT.items(); the
// decisions are saved by itctSetAct and itctSetNote, the letters by itctWrite (src/js/32).
//
// State: S.itctShow ("open" or "all"), S.itctCat (a kind of line, from the chips).
import CommitBox from "../../parts/CommitBox.jsx";
import ListTable from "../../parts/ListTable.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const dmy = (d) => GSTAmend.dmy(d);
const NR = ({ children }) => <div className="nr">{children}</div>;

// the follow-up list's columns (spec K6): the bill's date, bill no., supplier, tax (amount), what it is (status), then the rest
function lineCols(today, soon) {
  return [
    { k: "date", role: "date", label: "Bill date", w: 8, v: (x) => String(x.date || ""), cell: (x) => dmy(x.date) },
    { k: "no", role: "number", label: "Bill no.", w: 10, v: (x) => x.no || "", cell: (x) => x.no || "" },
    { k: "party", role: "party", label: "Supplier · GSTIN", w: 15, v: (x) => x.supplier || "", cell: (x) => <>{x.supplier || ""}<NR>{x.gstin || "no GSTIN"}</NR></> },
    { k: "tax", role: "amount", label: "Tax", cls: "n", w: 9, v: (x) => num(x.tax), fmt: money, cell: (x) => <>{money(x.tax)}{x.cat === "diff" && <NR>{"2B " + money(x.tax2b)}</NR>}</> },
    { k: "what", role: "status", label: "What", w: 11, v: (x) => ITCT.CATS[x.cat].label, cell: (x) => <>{ITCT.CATS[x.cat].label}{x.issues && x.cat === "diff" && <div className="nr" title={x.issues.join("; ")}>{x.issues.filter((z) => !/^booked in|^value differs/.test(z)).join("; ")}</div>}</> },
    { k: "tally", label: "In Tally", w: 10, cell: (x) => (x.where === "2B" ? <span className="nr">{x.bookedAs || "not booked"}</span> : <>{dmy(x.booked || x.date)}<NR>{x.voucher || ""}</NR></>) },
    { k: "twoB", label: "In 2B", w: 8, cell: (x) => (x.where === "Tally" ? <span className={x.covered ? "bad" : "nr"}>{x.covered ? "not in 2B" : "no 2B yet"}</span>
      : <>{GSTR.label(x.ym2b || x.ym)}{x.ims === "rejected" ? <div className="bad">rejected in IMS</div> : x.claimedIn ? <NR>taken then</NR> : x.reason ? <NR>{x.reason}</NR> : x.ims ? <NR>{"IMS: " + x.ims}</NR> : null}</>) },
    { k: "dl", label: "Last date", w: 8, v: (x) => String(x.deadline || ""), cell: (x) => <span className={x.deadline && (x.deadline < today || soon(x.deadline)) ? "bad" : "nr"}>{x.deadline ? dmy(x.deadline) : ""}</span> },
    { k: "act", label: "What to do", w: 12, cell: (x) => { const c = ITCT.CATS[x.cat];
      return c.acts.length ? <select aria-label="What to do" value={x.act} onChange={(ev) => itctSetAct(x.key, ev.target.value)}>{c.acts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        : x.cat === "confirm" ? <button className="linkbtn" onClick={() => gstPartGo("r2b")}>confirm under 2B</button> : <span className="nr">nothing to do</span>; } },
    { k: "note", label: "Note", w: 9, cell: (x) => <CommitBox aria-label="Note" data-fk={"itctnote-" + x.key} value={x.note} placeholder="note" style={{ width: "100%" }} onCommit={(v) => itctSetNote(x.key, v)} /> },
  ];
}

function Suppliers({ sups, today }) {
  return <section className="dash-card" style={{ marginTop: 12 }}><h3>Suppliers to write to</h3>
    <p className="note">Every bill set to “follow up” or “ask the supplier to amend”, supplier by supplier, in one letter. Email and phone come from Tally, or from GST settings (<button className="linkbtn" onClick={() => goGstSettings()}>contacts</button>). Writing is logged, so the next month shows when each was last chased.</p>
    <ListTable name="itctSuppliers" className="bk-table compact fixed" rows={sups} rowKey={(s, i) => s.key + ":" + i} unit={["supplier", "suppliers"]} rowProps={(s) => ({ "data-key": s.key })}
      empty="No supplier to write to. Set a bill above to “follow up” or “ask the supplier to amend” and its supplier comes here."
      cols={[
        { k: "last", role: "date", label: "Last written", w: 10, v: (s) => String(s.lastSent || ""), cell: (s) => (s.lastSent ? <>{dmy(s.lastSent)}{s.sent.length > 1 && <NR>{s.sent.length} times</NR>}</> : <span className="nr">not yet</span>) },
        { k: "party", role: "party", label: "Supplier · GSTIN", w: 20, v: (s) => s.party || "", cell: (s) => <>{s.party || ""}<NR>{s.gstin || "no GSTIN"}</NR></> },
        { k: "tax", role: "amount", label: "Tax waiting", cls: "n", w: 10, v: (s) => num(s.tax), fmt: money, cell: (s) => money(s.tax) },
        { k: "n", label: "Bills", cls: "n", w: 7, v: (s) => s.items.length, sum: true, fmt: String, cell: (s) => s.items.length },
        { k: "dl", label: "Last date", w: 10, v: (s) => String(s.deadline || ""), cell: (s) => <span className={s.deadline && s.deadline < today ? "bad" : "nr"}>{dmy(s.deadline)}</span> },
        { k: "email", label: "Email", w: 18, cell: (s) => s.email || <span className="nr">none</span> },
        { k: "phone", label: "Phone", w: 12, cell: (s) => s.phone || <span className="nr">none</span> },
        { k: "ac", role: "act", label: "Write", w: 13, cell: (s) => <><button className="linkbtn" onClick={() => itctWrite("itctCopy", s.key)}>copy</button> · <button className="linkbtn" onClick={() => itctWrite("itctMail", s.key)}>email</button> · <button className="linkbtn" onClick={() => itctWrite("itctWa", s.key)}>WhatsApp</button></> },
      ]} />
  </section>;
}

export default function ItcFollow() {
  const reg = S.gstReg || "";
  if (!reg) return <p className="note">Choose a registration above.</p>;
  if (!GST2B.all2b(reg).length) return <section className="dash-card"><h3>ITC follow-up</h3><p className="note">Bring in this registration’s 2B under 2B reconciliation, month by month as they come. From then on every bill 2B and Tally do not agree on is listed here and carried forward on its own until it is settled: nothing to remember, nothing to copy across.</p></section>;
  const R = ITCT.items(reg), show = S.itctShow || "open", cat = S.itctCat || "", order = Object.keys(ITCT.CATS);
  const all = R.items, base = show === "open" ? all.filter((x) => x.open) : all;
  const list = base.filter((x) => !cat || x.cat === cat).sort((a, c) => order.indexOf(a.cat) - order.indexOf(c.cat) || c.tax - a.tax);
  const today = ITCT.today(), dt = (x) => new Date(String(x).slice(0, 4) + "-" + String(x).slice(4, 6) + "-" + String(x).slice(6, 8)).getTime();
  const soon = (d) => !!d && d >= today && (dt(d) - dt(today)) / 86400000 <= 60;   // the last date is within two months
  const miss = R.missing.filter((m) => m < R.last || m > R.last);
  return <>
    <section className="dash-card">
      <div className="gf-ctl"><h3>ITC follow-up</h3>
        <select aria-label="Show" value={show} onChange={(ev) => setAndShow("itctShow", ev.target.value)}><option value="open">Still open</option><option value="all">Everything, settled too</option></select>
        <button className="btn small primary" onClick={() => doAct("itctExcel")}>Excel</button></div>
      <p className="note" style={{ margin: "6px 0" }}>Worked out again each time from Tally and every 2B here ({R.loaded.map(GSTR.label).join(", ")}). What you decide on each line is kept and carried to later months; a bill that turns up in a later 2B moves itself to “taken in a later month”.
        {miss.length > 0 && <>{" "}<span className="bad">{"No 2B here for " + (miss.length > 4 ? miss.length + " months (" + GSTR.label(miss[0]) + " to " + GSTR.label(miss[miss.length - 1]) + ")" : miss.map(GSTR.label).join(", ")) + ": bills of those months cannot be checked."}</span></>}</p>
      <div className="gf-chips">{Object.entries(ITCT.CATS).map(([k, c]) => { const l = base.filter((x) => x.cat === k); if (!l.length) return null;
        const t = l.reduce((a, x) => a + (x.cat === "diff" ? Math.abs(x.gap) : x.tax), 0);
        return <button key={k} className={"gf-chip" + (c.warn ? " warn" : "") + (cat === k ? " on" : "")} onClick={() => setAndShow("itctCat", cat === k ? "" : k)}>{c.label + " "}<b>{l.length}</b>{" · ₹" + money(t)}</button>; })}</div>
      <details style={{ margin: "6px 0 10px" }}><summary className="linkbtn">How each kind is handled, and why</summary><div className="bk-tablewrap"><table className="bk-table gf-off" data-statement=""><tbody>
        {Object.values(ITCT.CATS).map((c) => <tr key={c.label}><td style={{ width: 220 }}><b>{c.label}</b></td><td>{c.law}</td></tr>)}</tbody></table></div></details>
      <ListTable name="itct" className="bk-table compact fixed" rows={list} rowKey={(x, i) => x.key + ":" + i} unit={["bill", "bills"]} limit={gfN(3000)} rowProps={(x) => ({ "data-key": x.key })}
        cols={lineCols(today, soon)} empty={"Nothing " + (show === "open" ? "open: every bill 2B and Tally disagreed on is settled. Choose “Everything, settled too” above to see them." : "here. Bring in the next 2B under 2B reconciliation.")} />
    </section>
    <Suppliers sups={ITCT.suppliers(reg, all)} today={today} />
  </>;
}
