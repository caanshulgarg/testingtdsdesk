// ITC follow-up: every bill 2B and Tally do not agree on, carried from month to month until it is settled, what to
// do about each, and the suppliers to write to. Was viewItcFollow (src/js/32). The lines are ITCT.items(); the
// decisions are saved by itctSetAct and itctSetNote, the letters by itctWrite (src/js/32).
//
// State: S.itctShow ("open" or "all"), S.itctCat (a kind of line, from the chips).
import CommitBox from "../../parts/CommitBox.jsx";

const money = (v) => INR.format(r2(v || 0));
const dmy = (d) => GSTAmend.dmy(d);
const WIDTHS = [11, 16, 12, 11, 8, 9, 8, 14, 11];
const COLS = ["What", "Supplier · GSTIN", "Bill no. · date", "In Tally", "In 2B", "Tax", "Last date", "What to do", "Note"];
const NR = ({ children }) => <div className="nr">{children}</div>;

function Line({ x, today, soon }) {
  const c = ITCT.CATS[x.cat], dlCls = x.deadline && (x.deadline < today || soon(x.deadline)) ? "bad" : "nr";
  const tally = x.where === "2B" ? <span className="nr">{x.bookedAs || "not booked"}</span> : <>{dmy(x.booked || x.date)}<NR>{x.voucher || ""}</NR></>;
  const twoB = x.where === "Tally" ? <span className={x.covered ? "bad" : "nr"}>{x.covered ? "not in 2B" : "no 2B yet"}</span>
    : <>{GSTR.label(x.ym2b || x.ym)}{x.ims === "rejected" ? <div className="bad">rejected in IMS</div> : x.claimedIn ? <NR>taken then</NR> : x.reason ? <NR>{x.reason}</NR> : x.ims ? <NR>{"IMS: " + x.ims}</NR> : null}</>;
  const acts = c.acts.length ? <select aria-label="What to do" value={x.act} onChange={(ev) => itctSetAct(x.key, ev.target.value)}>{c.acts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    : x.cat === "confirm" ? <button className="linkbtn" onClick={() => gstPartGo("r2b")}>confirm under 2B</button> : <span className="nr">nothing to do</span>;
  return <tr data-key={x.key}>
    <td>{c.label}{x.issues && x.cat === "diff" && <div className="nr" title={x.issues.join("; ")}>{x.issues.filter((z) => !/^booked in|^value differs/.test(z)).join("; ")}</div>}</td>
    <td>{x.supplier || ""}<NR>{x.gstin || "no GSTIN"}</NR></td>
    <td>{x.no || ""}<NR>{dmy(x.date)}</NR></td>
    <td>{tally}</td><td>{twoB}</td>
    <td className="n">{money(x.tax)}{x.cat === "diff" && <NR>{"2B " + money(x.tax2b)}</NR>}</td>
    <td><span className={dlCls}>{x.deadline ? dmy(x.deadline) : ""}</span></td>
    <td>{acts}</td>
    <td><CommitBox aria-label="Note" data-fk={"itctnote-" + x.key} value={x.note} placeholder="note" style={{ width: "100%" }} onCommit={(v) => itctSetNote(x.key, v)} /></td>
  </tr>;
}

function Suppliers({ sups, today }) {
  return <section className="dash-card" style={{ marginTop: 12 }}><h3>Suppliers to write to</h3>
    <p className="note">Every bill set to “follow up” or “ask the supplier to amend”, supplier by supplier, in one letter. Email and phone come from Tally, or from GST settings (<button className="linkbtn" onClick={() => goGstSettings()}>contacts</button>). Writing is logged, so the next month shows when each was last chased.</p>
    {sups.length ? <div className="bk-tablewrap"><table className="bk-table compact fixed">
      <colgroup>{[20, 7, 10, 10, 18, 12, 10, 13].map((w, i) => <col key={i} style={{ width: w + "%" }} />)}</colgroup>
      <thead><tr><th>Supplier · GSTIN</th><th className="n">Bills</th><th className="n">Tax waiting</th><th>Last date</th><th>Email</th><th>Phone</th><th>Last written</th><th>Write</th></tr></thead>
      <tbody>{sups.map((s, i) => <tr key={s.key + ":" + i} data-key={s.key}>
        <td>{s.party || ""}<NR>{s.gstin || "no GSTIN"}</NR></td><td className="n">{s.items.length}</td><td className="n">{money(s.tax)}</td>
        <td><span className={s.deadline && s.deadline < today ? "bad" : "nr"}>{dmy(s.deadline)}</span></td>
        <td>{s.email || <span className="nr">none</span>}</td><td>{s.phone || <span className="nr">none</span>}</td>
        <td>{s.lastSent ? <>{dmy(s.lastSent)}{s.sent.length > 1 && <NR>{s.sent.length} times</NR>}</> : <span className="nr">not yet</span>}</td>
        <td><button className="linkbtn" onClick={() => itctWrite("itctCopy", s.key)}>copy</button> · <button className="linkbtn" onClick={() => itctWrite("itctMail", s.key)}>email</button> · <button className="linkbtn" onClick={() => itctWrite("itctWa", s.key)}>WhatsApp</button></td>
      </tr>)}</tbody>
    </table></div> : <p className="note">No supplier to write to.</p>}
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
      <details style={{ margin: "6px 0 10px" }}><summary className="linkbtn">How each kind is handled, and why</summary><div className="bk-tablewrap"><table className="bk-table gf-off"><tbody>
        {Object.values(ITCT.CATS).map((c) => <tr key={c.label}><td style={{ width: 220 }}><b>{c.label}</b></td><td>{c.law}</td></tr>)}</tbody></table></div></details>
      <div className="bk-tablewrap"><table className="bk-table compact fixed">
        <colgroup>{WIDTHS.map((w, i) => <col key={i} style={{ width: w + "%" }} />)}</colgroup>
        <thead><tr>{COLS.map((c, i) => <th key={c} className={i === 5 ? "n" : undefined}>{c}</th>)}</tr></thead>
        <tbody>{list.slice(0, gfN(3000)).map((x, i) => <Line key={x.key + ":" + i} x={x} today={today} soon={soon} />)}
          {!list.length && <tr><td colSpan={9} className="nr">Nothing {show === "open" ? "open" : "here"}.</td></tr>}</tbody>
      </table></div>
    </section>
    <Suppliers sups={ITCT.suppliers(reg, all)} today={today} />
  </>;
}
