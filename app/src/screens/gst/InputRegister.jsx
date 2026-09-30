// The input register: every document in Tally that takes input tax for the GSTIN, for the month or the whole year,
// with what 2B says about each, and how it ties to GSTR-3B table 4. Was viewInputRegister (src/js/18). The rows are
// inregRows() (src/js/18); the Excel is inregExcel().
//
// State: S.inregScope ("month" or "year"), S.inregF (a kind or a 2B status), S.inregQ (the find box).
const money = (v) => INR.format(r2(v || 0));
const day = (d) => fmtDate(tallyDate(d));
const KINDS = ["Eligible", "Credit reduced", "Reverse charge", "Import of goods", "Import of services", "Not to be taken"];
const STATUSES = ["In 2B", "In 2B, differs", "In 2B? confirm", "Not in 2B", "Rejected in IMS", "Booked and reversed", "2B not brought in", "not expected in 2B"];
const TWICE = "Booked more than once";
const sgn = (r) => r.dir < 0 ? -1 : 1;
const tot = (list) => list.reduce((a, r) => ({ n: a.n + 1, taxable: r2(a.taxable + sgn(r) * r.taxable), igst: r2(a.igst + sgn(r) * r.igst), cgst: r2(a.cgst + sgn(r) * r.cgst), sgst: r2(a.sgst + sgn(r) * r.sgst), cess: r2(a.cess + sgn(r) * r.cess) }),
  { n: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
const tax4 = (x) => x.igst + x.cgst + x.sgst + x.cess;
const dirTax = (list) => money(list.reduce((a, p) => a + p.dir * tax4(p), 0));

// what the books say about a bill that is in 2B but not among the bills taking credit (was only2bNote)
export function Only2bNote({ p }) {
  const nb = p.bookedNoCredit, na = p.itcavl === "N";
  if (!nb) return na ? <span className="nr">not in Tally; 2B says not available</span> : <span className="bad">not in Tally</span>;
  return <>
    <span className={na ? "nr" : "bad"}>booked without credit: {nb.type + " " + (nb.no || "") + " of " + GSTAmend.dmy(nb.date) + ", " + (nb.party || "")}</span>
    <div className="nr">{na ? "2B says not available" + (p.rsn === "P" ? " (place of supply in another state)" : p.rsn === "C" ? " (after the section 16(4) time limit)" : "") + "; charging the tax to cost is right"
      : "2B says available: take the credit (time limit 30 November after the year)"}</div>
  </>;
}

// one line of chips instead of a row of tiles, so the bills are on the first screen; a chip filters, again clears
function Chip({ label, x, amt, warn, filt }) {
  if (!x) return null;
  const f = S.inregF || "";
  return <button className={"gf-chip" + (warn ? " warn" : "") + (f === filt ? " on" : "")} onClick={() => setAndShow("inregF", f === filt ? "" : filt)}>{label + " "}<b>{x}</b>{" · ₹" + amt}</button>;
}

// the register against 3B table 4: the same, or the gap explained (held back for 2B, reversals under rules 42 and 43)
function TieOut({ R }) {
  const hr = { held: 0, rel: 0 };
  const t3 = R.months.reduce((a, m) => {
    const t = GSTR.threeBm(m, R.reg);
    ["igst", "cgst", "sgst", "cess"].forEach((k) => { a[k] = r2(a[k] + num(t.itc[k]) - num(t.reversal[k]) - num((t.reclaim || {})[k])); });
    hr.held = r2(hr.held + tax4(t.held)); hr.rel = r2(hr.rel + tax4(t.released)); return a;
  }, { igst: 0, cgst: 0, sgst: 0, cess: 0 });
  const reg = tot(R.rows.filter((r) => r.kindL !== "Not to be taken")), gap = r2(tax4(reg) - tax4(t3));
  let tail;
  if (Math.abs(gap) < 1) tail = " — they agree.";
  else if (Math.abs(gap - r2(hr.held - hr.rel)) < 1) tail = " — held for 2B ₹" + money(hr.held) + (hr.rel ? ", taken from earlier ₹" + money(hr.rel) : "") + ".";
  else tail = <>{" "}<span className="bad">{"Difference ₹" + money(gap) + (hr.held || hr.rel ? ": held back for 2B ₹" + money(hr.held - hr.rel) + ", the rest from reversals under rules 42 and 43." : ", from reversals under rules 42 and 43 taken in 3B.")}</span></>;
  return (
    <p className="note" style={{ margin: "4px 0 8px" }}>
      {"Register ₹" + money(tax4(reg)) + "; 3B table 4 ₹" + money(tax4(t3))}{tail}
      {!R.loaded.size && <>{" "}<span className="bad">No 2B for this registration yet; bring it in under 2B reconciliation.</span></>}
      {" "}<details style={{ display: "inline" }}><summary className="linkbtn" style={{ display: "inline" }}>What is in it</summary>Every document in Tally that takes input tax for this registration: purchase bills, and journals or payments that carry input tax (reverse charge on rent, bank charges, an expense booked in a journal). GSTR-3B table 4 is made from it, and it is what is matched against 2B. Use the funnel on any column heading to filter.</details>
    </p>
  );
}

function Row({ r, cess }) {
  const s = sgn(r), rates = Array.from(new Set((r.parts || []).map((x) => x.rate))).join(", ");
  const fine = (r.twoB === "In 2B" || r.twoB === "not expected in 2B" || r.twoB === "Booked and reversed") && !r.dupe;
  const cls = fine ? "" : r.twoB === "2B not brought in" && !r.dupe ? "nr" : "bad";
  return <tr>
    <td>{day(r.date)}<div className="nr" title={r.type + " " + (r.voucher || "")}>{r.voucher || ""}</div></td>
    <td>{r.party || ""}<div className="nr">{r.gstin || "no GSTIN"}</div></td>
    <td>{r.no || ""}{r.refDate && <div className="nr">{day(r.refDate)}</div>}</td>
    <td className="hr">{[r.hsn, rates ? rates + "%" : ""].filter(Boolean).join(" · ")}</td>
    <td className="n">{money(s * r.taxable)}{r.valueGuessed && <div className="nr">from the tax</div>}</td>
    <td className="n">{money(s * r.igst)}</td><td className="n">{money(s * r.cgst)}</td><td className="n">{money(s * r.sgst)}</td>
    {cess && <td className="n">{money(s * r.cess)}</td>}
    <td>{r.kindL}</td>
    <td><span className={cls}>{r.dupe ? "Booked " + r.dupe.n + " times" : r.twoB}</span>{r.twoBWhy && <div className="nr" title={r.twoBWhy}>{r.twoBWhy}</div>}</td>
  </tr>;
}

export default function InputRegister({ b }) {
  const R = inregRows(b), f = S.inregF || "", q = String(S.inregQ || "").toLowerCase();
  let list = R.rows.filter((r) => !f || r.kindL === f || r.twoB === f || (f === TWICE && r.dupe));
  if (q) list = list.filter((r) => [r.party, r.gstin, r.no, r.voucher, r.hsn, r.type].join(" ").toLowerCase().includes(q));
  const all = tot(R.rows), shown = tot(list);
  const dupes = R.rows.filter((r) => r.dupe), notTaken = R.only2b.filter((p) => p.itcavl !== "N" && p.bookedNoCredit);
  // narrow enough for the amounts to be on screen: voucher number only (type on hover), HSN and rate together, cess only when there is any
  const cess = list.some((r) => Math.abs(r.cess) >= 0.01);
  const cols = ["Booked · voucher", "Supplier · GSTIN", "Bill no. · date", "HSN · rate", "Value", "IGST", "CGST", "SGST"].concat(cess ? ["Cess"] : []).concat(["Kind", "2B"]);
  const numTo = cess ? 8 : 7, widths = [10, 17, 12, 11, 9, 8, 7, 7].concat(cess ? [5] : []).concat([8, 11]);
  const kindOf = (k) => tot(R.rows.filter((r) => r.kindL === k)), statusOf = (k) => tot(R.rows.filter((r) => r.twoB === k));
  return (
    <section className="dash-card">
      <div className="gf-ctl">
        <h3>Input register, {R.months.length > 1 ? "the year " + GSTR.label(R.months[0]) + " to " + GSTR.label(R.months[R.months.length - 1]) : GSTR.label(R.months[0] || "")}</h3>
        <select aria-label="Period" value={S.inregScope || "month"} onChange={(ev) => setAndShow("inregScope", ev.target.value)}><option value="month">This month</option><option value="year">The whole year</option></select>
        <select aria-label="Show" value={f} onChange={(ev) => setAndShow("inregF", ev.target.value)}>
          <option value="">Every document</option>
          <optgroup label="Kind">{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
          <optgroup label="2B">{STATUSES.map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
          <option value={TWICE}>{TWICE}</option>
        </select>
        <input type="search" aria-label="Find in the register" data-fk="inregq" placeholder="Supplier, GSTIN, bill no." value={S.inregQ || ""} style={{ minWidth: 200 }} onChange={(ev) => setAndShow("inregQ", ev.target.value, true)} />
        <button className="btn small primary" onClick={() => doAct("inregExcel")}>Excel</button>
      </div>
      <div className="gf-chips">
        {KINDS.map((k) => { const x = kindOf(k); return <Chip key={k} label={k} x={x.n} amt={money(tax4(x))} filt={k} />; })}
        {R.loaded.size > 0 && <>
          {STATUSES.slice(0, 5).map((k) => { const x = statusOf(k); return <Chip key={k} label={k} x={x.n} amt={money(tax4(x))} warn={k !== "In 2B" && k !== "Booked and reversed"} filt={k} />; })}
          {R.only2b.length > 0 && <a className="gf-chip warn" href="#inreg2b">{"In 2B, not in the books "}<b>{R.only2b.length}</b>{" · ₹" + dirTax(R.only2b)}</a>}
        </>}
        <Chip label={TWICE} x={dupes.length} amt={money(dupes.reduce((a, r) => a + r.tax, 0) / 2)} warn filt={TWICE} />
        {notTaken.length > 0 && <a className="gf-chip warn" href="#inreg2b">{"Credit in 2B not taken "}<b>{notTaken.length}</b>{" · ₹" + dirTax(notTaken)}</a>}
      </div>
      <TieOut R={R} />
      <div className="bk-tablewrap"><table className="bk-table compact fixed">
        <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w + "%" }} />)}</colgroup>
        <thead><tr>{cols.map((c, i) => <th key={c} className={i >= 4 && i <= numTo ? "n" : undefined}>{c}</th>)}</tr></thead>
        <tbody>
          {list.slice(0, gfN(5000)).map((r, i) => <Row key={r.ym + ":" + (r.id || i)} r={r} cess={cess} />)}
          <tr><td colSpan={4}><b>{shown.n + " document" + (shown.n === 1 ? "" : "s") + (shown.n !== all.n ? " of " + all.n : "")}</b></td>
            <td className="n"><b>{money(shown.taxable)}</b></td><td className="n"><b>{money(shown.igst)}</b></td><td className="n"><b>{money(shown.cgst)}</b></td><td className="n"><b>{money(shown.sgst)}</b></td>
            {cess && <td className="n"><b>{money(shown.cess)}</b></td>}<td colSpan={2}></td></tr>
        </tbody>
      </table></div>
      {list.length > 5000 && <p className="note">The first 5,000 are shown; the Excel has all {list.length}.</p>}
      {R.only2b.length > 0 && (!f || f === "Not in 2B") && <>
        <h3 id="inreg2b" style={{ marginTop: 14 }}>In 2B, not in the books</h3>
        <div className="bk-tablewrap"><table className="bk-table">
          <thead><tr><th>2B month</th><th>Supplier</th><th>GSTIN</th><th>Bill no.</th><th>Date</th><th className="n">Value</th><th className="n">Tax</th><th>In Tally</th></tr></thead>
          <tbody>{R.only2b.slice().sort((a, c) => (c.igst + c.cgst + c.sgst) - (a.igst + a.cgst + a.sgst)).slice(0, gfN(300)).map((p, i) => <tr key={i}>
            <td>{GSTR.label(p.ym)}</td><td>{p.party}</td><td>{p.gstin}</td><td>{p.no}</td><td>{p.date ? day(p.date) : ""}</td>
            <td className="n">{money(p.dir * p.taxable)}</td><td className="n">{money(p.dir * tax4(p))}</td><td><Only2bNote p={p} /></td></tr>)}</tbody>
        </table></div>
      </>}
    </section>
  );
}
