import ListTable from "../../parts/ListTable.jsx";
// The input register: every document in Tally that takes input tax for the GSTIN, for the month or the whole year,
// with what 2B says about each, and how it ties to GSTR-3B table 4. Was viewInputRegister (src/js/18). The rows are
// inregRows() (src/js/18); the Excel is inregExcel().
//
// State: S.inregScope ("month" or "year"), S.inregF (a kind or a 2B status), S.inregQ (the find box).
const money = (v) => "₹" + INR.format(r2(v || 0));
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

// the register's columns (spec K6): booked (date), bill no., supplier, value (amount), 2B (status), then the rest
function inregCols(cess) {
  const sg = (r) => sgn(r);
  return [
    { k: "date", role: "date", label: "Booked · voucher", w: 10, v: (r) => String(r.date || ""), cell: (r) => <>{day(r.date)}<div className="nr" title={r.type + " " + (r.voucher || "")}>{r.voucher || ""}</div></> },
    { k: "no", role: "number", label: "Bill no. · date", w: 11, v: (r) => r.no || "", cell: (r) => <>{r.no || ""}{r.refDate && <div className="nr">{day(r.refDate)}</div>}</> },
    { k: "party", role: "party", label: "Supplier · GSTIN", w: 16, v: (r) => r.party || "", cell: (r) => <>{r.party || ""}<div className="nr">{r.gstin || "no GSTIN"}</div></> },
    { k: "val", role: "amount", label: "Value", cls: "n", w: 9, v: (r) => sg(r) * num(r.taxable), fmt: money, cell: (r) => <>{money(sg(r) * r.taxable)}{r.valueGuessed && <div className="nr">from the tax</div>}</> },
    { k: "twoB", role: "status", label: "2B", w: 11, v: (r) => (r.dupe ? "Booked " + r.dupe.n + " times" : r.twoB || ""), cell: (r) => {
      const fine = (r.twoB === "In 2B" || r.twoB === "not expected in 2B" || r.twoB === "Booked and reversed") && !r.dupe;
      const cls = fine ? "" : r.twoB === "2B not brought in" && !r.dupe ? "nr" : "bad";
      return <><span className={cls}>{r.dupe ? "Booked " + r.dupe.n + " times" : r.twoB}</span>{r.twoBWhy && <div className="nr" title={r.twoBWhy}>{r.twoBWhy}</div>}</>; } },
    { k: "hsn", label: "HSN · rate", w: 10, td: () => ({ className: "hr" }), cell: (r) => { const rates = Array.from(new Set((r.parts || []).map((x) => x.rate))).join(", "); return [r.hsn, rates ? rates + "%" : ""].filter(Boolean).join(" · "); } },
    { k: "igst", label: "IGST", cls: "n", w: 8, v: (r) => sg(r) * num(r.igst), sum: true, fmt: money, cell: (r) => money(sg(r) * r.igst) },
    { k: "cgst", label: "CGST", cls: "n", w: 7, v: (r) => sg(r) * num(r.cgst), sum: true, fmt: money, cell: (r) => money(sg(r) * r.cgst) },
    { k: "sgst", label: "SGST", cls: "n", w: 7, v: (r) => sg(r) * num(r.sgst), sum: true, fmt: money, cell: (r) => money(sg(r) * r.sgst) },
    cess && { k: "cess", label: "Cess", cls: "n", w: 5, v: (r) => sg(r) * num(r.cess), sum: true, fmt: money, cell: (r) => money(sg(r) * r.cess) },
    { k: "kind", label: "Kind", w: 8, v: (r) => r.kindL || "", cell: (r) => r.kindL },
  ];
}

export default function InputRegister({ b }) {
  const R = inregRows(b), f = S.inregF || "", q = String(S.inregQ || "").toLowerCase();
  let list = R.rows.filter((r) => !f || r.kindL === f || r.twoB === f || (f === TWICE && r.dupe));
  if (q) list = list.filter((r) => [r.party, r.gstin, r.no, r.voucher, r.hsn, r.type].join(" ").toLowerCase().includes(q));
  const all = tot(R.rows), shown = tot(list);
  const dupes = R.rows.filter((r) => r.dupe), notTaken = R.only2b.filter((p) => p.itcavl !== "N" && p.bookedNoCredit);
  // narrow enough for the amounts to be on screen: voucher number only (type on hover), HSN and rate together, cess only when there is any
  const cess = list.some((r) => Math.abs(r.cess) >= 0.01);
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
      {/* the one list table (spec K6) */}
      <ListTable name="inreg" className="bk-table compact fixed" rows={list} rowKey={(r, i) => r.ym + ":" + r.id + ":" + i} unit={["document", "documents"]} of={all.n} limit={gfN(5000)}
        more={<p className="note">The first 5,000 are shown; the Excel has all {list.length}.</p>} cols={inregCols(cess)}
        empty="No document here. Choose Every document above, or another month." />
      {R.only2b.length > 0 && (!f || f === "Not in 2B") && <>
        <h3 id="inreg2b" style={{ marginTop: 14 }}>In 2B, not in the books</h3>
        <ListTable name="inreg2b" rows={R.only2b.slice().sort((a, c) => (c.igst + c.cgst + c.sgst) - (a.igst + a.cgst + a.sgst))} rowKey={(p, i) => i} unit={["document", "documents"]} limit={gfN(300)}
          cols={[
            { k: "date", role: "date", label: "Date", v: (p) => String(p.date || ""), cell: (p) => (p.date ? day(p.date) : "") },
            { k: "no", role: "number", label: "Bill no.", v: (p) => p.no || "", cell: (p) => p.no },
            { k: "party", role: "party", label: "Supplier", v: (p) => p.party || "", cell: (p) => p.party },
            { k: "tax", role: "amount", label: "Tax", cls: "n", v: (p) => p.dir * tax4(p), fmt: money, cell: (p) => money(p.dir * tax4(p)) },
            { k: "st", role: "status", label: "In Tally", v: (p) => (p.bookedNoCredit ? "booked without credit" : "not found"), cell: (p) => <Only2bNote p={p} /> },
            { k: "ym", label: "2B month", v: (p) => p.ym || "", cell: (p) => GSTR.label(p.ym) },
            { k: "gstin", label: "GSTIN", v: (p) => p.gstin || "", cell: (p) => p.gstin },
            { k: "val", label: "Value", cls: "n", v: (p) => p.dir * num(p.taxable), sum: true, fmt: money, cell: (p) => money(p.dir * p.taxable) },
          ]} />
      </>}
    </section>
  );
}
