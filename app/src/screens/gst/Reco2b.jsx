// 2B reconciliation, laid out to be read at a glance (round 72, 17-Oct-2026; the owner: "2B reco should be clear to
// understand"): one row per supplier invoice, its Status (Matched · Mismatch · Probable match · In books only · In 2B
// only), the Books and 2B values side by side with the field that differs highlighted, the action the row allows (the
// existing ones: r2Confirm, r2Unlink, r2Link, r2Tag, r2Copy in src/js/27), filter chips with counts, By invoice / By
// supplier, the first 100 rows, the totals of every row filtered (ITC as per books, as per 2B, the difference), and the
// Excel with formulas. The rows are reco.js recoRows (GST2B.scope's result, unchanged), with the automatic matcher's
// result put on them when it is there (reco.js applyAuto / autoFor).
import { useState } from "react";
import { recoRows, applyAuto, autoFor, recoCounts, recoTotals, recoExcel, STATUS, AUTO, DIFF_WORD } from "./reco.js";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (/^\d{8}$/.test(String(d || "")) ? fmtDate(tallyDate(d)) : String(d || ""));
const tax = (o) => r2(num(o.igst) + num(o.cgst) + num(o.sgst) + num(o.cess));
const CHIPS = [["", "All"], ["mismatch", "Mismatch"], ["probable", "Probable match"], ["books", "In books only"], ["2b", "In 2B only"], ["matched", "Matched"]];
const TAGS_2B = [["", "Action…"], ["To book in Tally", "To book in Tally"], ["Booked in a later month", "Claim next month (booked later)"], ["Not our purchase", "Ignore: not our purchase"], ["Blocked, section 17(5)", "Blocked, 17(5)"], ["Ask supplier to correct", "Ask supplier to correct"]];
const TAGS_BOOKS = [["", "Action…"], ["Follow up with supplier", "Follow up with supplier"], ["Expect in next 2B", "Claim next month (expect in next 2B)"], ["Reverse in 3B", "Reverse in 3B"], ["Reverse charge or import", "Ignore: reverse charge or import"], ["No credit claimed", "Ignore: no credit claimed"]];
const TAGS_PAIR = [["", "Action…"], ["Ask supplier to correct", "Ask supplier to correct"], ["Follow up with supplier", "Follow up with supplier"]];

function StatusCell({ r }) {
  const cls = r.status === "matched" ? "ok" : r.status === "mismatch" ? "bad" : r.status === "probable" ? "warn" : "info";
  return <><span className={"tag " + cls} data-reco-status={r.status}>{STATUS[r.status]}</span>{r.kind && <div className="tg-sub bad">{r.kind} differs</div>}
    {r.auto && <div className="tg-sub" data-reco-auto={r.auto.status}>{AUTO[r.auto.status]}{r.auto.confidence != null ? " · " + Math.round(r.auto.confidence * 100) + "%" : ""}{r.auto.reason ? ": " + r.auto.reason : ""}</div>}
    {r.status === "matched" && r.diffs.filter((k) => k !== "nogstin").length > 0 && <div className="tg-sub">{r.diffs.filter((k) => k !== "nogstin").map((k) => DIFF_WORD[k]).join(", ")} differ{r.diffs.length === 1 ? "s" : ""}</div>}
    {r.tag && <div className="tg-sub" data-reco-tag="">{r.tag}</div>}</>;
}
// a side's cells: number, date, taxable, tax; the differing field highlighted
function Side({ s, r, other }) {
  if (!s) return <><td className="rc-none">—</td><td className="n rc-none"></td><td className="n rc-none"></td></>;
  const d = (k) => (r.diffs.includes(k) ? " rc-diff" : ""), dim = s.counted === false ? " rc-dim" : "";
  const sub = other === "2b" ? (({ b2b: "Invoice", b2ba: "Invoice, amended", cdnr: s.dir < 0 ? "Credit note" : "Debit note", cdnra: "Note, amended", isd: "ISD", impg: "Import", impgsez: "Import from SEZ" })[s.sec] || s.sec) + (s.notAvl ? " · ITC not available" : "") : "vch " + s.voucher;
  return <>
    <td className={"rc-doc" + dim}><span className={"code" + d("no")}>{s.no || "—"}</span><div className="tg-sub"><span className={d("date")}>{day(s.date)}</span> · {sub}</div>{s.counted === false && <div className="tg-sub">other month, not counted</div>}</td>
    <td className={"n" + d("taxable") + dim}>{money(s.taxable)}</td>
    <td className={"n" + d("tax") + d("head") + dim}>{money(tax(s))}<div className="tg-sub">{num(s.igst) ? "IGST" : "CGST+SGST"}</div></td></>;
}
function Act({ r, free }) {
  const tagSel = (id, tags) => <select aria-label="Action" data-reco-act="" value={r.tag || ""} onChange={(ev) => r2Tag(id, ev.target.value)} style={{ maxWidth: 112 }}>{tags.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  if (r.status === "probable") {
    const ids = r.books ? r.books.ids : [];
    // a pair the automatic matching suggested: the person's answer is kept with that run too (M2B.decide, src/js/85)
    const told = (d) => { if (r.auto && r.auto.id && window.GSTAutoMatch && window.GSTAutoMatch.decide) window.GSTAutoMatch.decide(r2Reg(S.books), r.auto.id, d); };
    return <span className="rc-acts"><button className="btn small primary" data-reco-accept="" onClick={() => { told("accept"); if (r.merged) r2Link(r.twoB.key, ids[0]); else r2Confirm(r.key); }}>Accept</button>
      <button className="btn small" data-reco-reject="" onClick={() => { told("reject"); r2Unlink(r.twoB.key, ids); }}>Reject</button></span>;
  }
  if (r.status === "books") return <span className="rc-acts">{tagSel(r.books.ids[0], TAGS_BOOKS)}{r.gstin && <button className="linkbtn" data-reco-copy="" title="Copy a note to the supplier listing the invoices not in 2B" onClick={() => r2Copy(r.gstin)}>Note to supplier</button>}</span>;
  if (r.status === "2b") {
    const p = r.twoB.p, cands = free.filter((d) => d.dir === p.dir && (d.gstin === p.gstin || (!d.gstin && GST2B.lastDigits(d.no) === GST2B.lastDigits(p.no)) || (d.gstin && d.gstin.slice(2, 12) === String(p.gstin).slice(2, 12))))
      .sort((a, c) => Math.abs(tax(a) - tax(p)) - Math.abs(tax(c) - tax(p))).slice(0, 12);
    return <span className="rc-acts">{tagSel(r.key, TAGS_2B)}{cands.length > 0 && <select aria-label="Booked in Tally as" data-reco-link="" value="" style={{ maxWidth: 112 }} onChange={(ev) => r2Link(p.key, ev.target.value)}>
      <option value="">Link to a bill…</option>{cands.map((d) => <option key={d.id} value={d.id}>{d.no + " · vch " + d.voucher + " · " + GSTAmend.dmy(d.date) + " · tax " + INR.format(tax(d))}</option>)}</select>}</span>;
  }
  return <span className="rc-acts">{r.status === "mismatch" && tagSel(r.key, TAGS_PAIR)}<button className="linkbtn" data-reco-unlink="" title="These are not the same document" onClick={() => r2Unlink(r.key, r.books.ids)}>Not the same</button></span>;
}

function BySupplier({ rows, onPick }) {
  const m = {};
  rows.forEach((r) => { const k = r.gstin || "no GSTIN: " + r.party; const s = m[k] = m[k] || { k, party: r.party, gstin: r.gstin, n: 0, books: 0, twoB: 0, c: {} }; if (!s.party) s.party = r.party;
    s.n++; s.books = r2(s.books + r.itcBooks); s.twoB = r2(s.twoB + r.itc2b); s.c[r.status] = (s.c[r.status] || 0) + 1; });
  const list = Object.values(m).sort((a, c) => Math.abs(c.twoB - c.books) - Math.abs(a.twoB - a.books)), t = recoTotals(rows);
  return <div className="bk-tablewrap"><table className="bk-table tg-fit gf-off" data-statement="" id="recoSup">
    <thead><tr><th className="pty">Supplier · GSTIN</th><th className="n">Invoices</th>{CHIPS.slice(1).map(([k, l]) => <th key={k} className="n">{l}</th>)}<th className="n">ITC as per books</th><th className="n">ITC as per 2B</th><th className="n">Difference</th></tr></thead>
    <tbody>{list.map((s) => <tr key={s.k} className="tg-click" onClick={() => onPick(s.gstin || s.party)} data-reco-sup=""><td className="pty"><button type="button" className="linkbtn tg-pty" style={{ textAlign: "left", paddingLeft: 0 }}>{s.party || "—"}</button><div className="tg-sub">{s.gstin || "no GSTIN in books"}</div></td>
      <td className="n">{s.n}</td>{CHIPS.slice(1).map(([k]) => <td key={k} className="n">{s.c[k] || ""}</td>)}<td className="n">{money(s.books)}</td><td className="n">{money(s.twoB)}</td><td className={"n" + (Math.abs(s.twoB - s.books) > 1 ? " bad" : "")}>{money(r2(s.twoB - s.books))}</td></tr>)}</tbody>
    <tfoot><tr className="tg-tot"><td><b>{list.length} supplier{list.length === 1 ? "" : "s"}</b></td><td className="n">{rows.length}</td>{CHIPS.slice(1).map(([k]) => <td key={k} className="n">{rows.filter((r) => r.status === k).length || ""}</td>)}
      <td className="n"><b>{money(t.books)}</b></td><td className="n"><b>{money(t.twoB)}</b></td><td className="n"><b>{money(t.diff)}</b></td></tr></tfoot>
  </table></div>;
}

export default function Reco2b({ sc, months, reg, label, tol }) {
  const [more, setMore] = useState(100);
  const st = GST2B.state(), base = applyAuto(recoRows(sc, months, st, tol), autoFor(reg, months));
  const f = S.rcF || {}, qq = String(f.q || "").toLowerCase(), byS = S.rcView === "supplier";
  const set = (k, v, typed) => setFilter("rcF", k, v, typed);
  const pass = (r, noStatus) => (noStatus || !f.status || r.status === f.status) && (!f.party || (r.gstin || r.party) === f.party)
    && (!qq || [r.party, r.gstin, r.twoB && r.twoB.no, r.books && r.books.no, r.books && r.books.voucher].join(" ").toLowerCase().includes(qq));
  const pre = base.filter((r) => pass(r, true)), rows = pre.filter((r) => pass(r)), cnt = recoCounts(pre), all = recoTotals(base), t = recoTotals(rows);
  const order = { mismatch: 0, probable: 1, books: 2, "2b": 3, matched: 4 };
  rows.sort((a, c) => order[a.status] - order[c.status] || Math.abs(c.gap) - Math.abs(a.gap) || String(a.party).localeCompare(String(c.party)));
  const list = rows.slice(0, more), any = Object.values(f).some(Boolean);
  const parties = Array.from(new Map(base.map((r) => [r.gstin || r.party, r.party || r.gstin])).entries()).sort((a, c) => String(a[1]).localeCompare(String(c[1])));
  const free = sc.all.onlyBooks;
  return <div data-reco="">
    <div className="rc-totals" data-reco-totals="" aria-label="ITC totals">
      <div><span>ITC as per books</span><b data-reco-total="books">{money(all.books)}</b></div>
      <div><span>ITC as per 2B</span><b data-reco-total="2b">{money(all.twoB)}</b><small>ITC available only</small></div>
      <div className={Math.abs(all.diff) > 1 ? "warn" : ""}><span>Difference (2B less books)</span><b data-reco-total="diff">{money(all.diff)}</b></div>
      <div><span>Period</span><b className="rc-per">{label}</b><small>{base.length} invoices</small></div>
    </div>
    <div className="tg-tabrow r2-tabrow">
      <div className="rc-chips" role="group" aria-label="Status">{CHIPS.map(([k, l]) => <button key={k} type="button" className={"rc-chip" + ((f.status || "") === k ? " on" : "")} aria-pressed={(f.status || "") === k} data-reco-chip={k || "all"} onClick={() => set("status", k)}>
        {l} <span className="sbar-n">{k ? cnt[k] : cnt.all}</span></button>)}</div>
      <div className="tg-tabside">
        <nav className="sbar subnav" aria-label="Reconciliation view" data-reco-view={byS ? "supplier" : "invoice"}><button aria-selected={!byS} onClick={() => { S.rcView = ""; render(); }}>By invoice</button><button aria-selected={byS} onClick={() => { S.rcView = "supplier"; render(); }}>By supplier</button></nav>
        <input type="search" className="rc-find" aria-label="Find a supplier, GSTIN, invoice or voucher" data-fk="rcFq" value={f.q || ""} placeholder="Find supplier, invoice" onChange={(ev) => set("q", ev.target.value, true)} />
        <button type="button" className="btn small" data-reco-excel="" onClick={() => recoExcel(rows, CO().name + " 2B reconciliation " + label).then(() => toast("Downloaded."))}>Export</button>
      </div>
    </div>
    {byS ? <BySupplier rows={rows} onPick={(k) => { S.rcView = ""; S.rcF = Object.assign({}, S.rcF, { party: k }); render(); }} /> :
    <div className="bk-tablewrap"><table className="bk-table tg-fit gf-off rc-table" data-statement="" id="recoTable">
      <thead>
        <tr className="rc-band"><th colSpan={2}></th><th colSpan={3} className="rc-bk">As per books</th><th colSpan={3} className="rc-2b">As per GSTR-2B</th><th colSpan={2}></th></tr>
        <tr><th>Status</th><th className={"pty" + (f.party ? " th-filtered" : "")}><span className="colh"><span>Supplier · GSTIN</span>
          <select className={"hf-sel" + (f.party ? " on" : "")} aria-label="Supplier" title="Filter: Supplier" value={f.party || ""} onChange={(ev) => set("party", ev.target.value)}><option value="">Every supplier</option>{parties.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></span></th>
          <th className="rc-bk">Invoice no · date</th><th className="n rc-bk">Taxable</th><th className="n rc-bk">Tax</th>
          <th className="rc-2b">Invoice no · date</th><th className="n rc-2b">Taxable</th><th className="n rc-2b">Tax</th>
          <th className="n">Difference in ITC</th><th>Action</th></tr></thead>
      <tbody>{list.map((r, i) => <tr key={r.key + ":" + i} data-reco-row={r.status}>
        <td className="rc-st"><StatusCell r={r} /></td>
        <td className={"pty" + (r.diffs.includes("gstin") || r.diffs.includes("nogstin") ? " rc-diff" : "")}><div className="tg-pty">{r.party || "—"}<div className="tg-sub">{r.gstin || "no GSTIN"}</div></div></td>
        <Side s={r.books} r={r} other="books" /><Side s={r.twoB} r={r} other="2b" />
        <td className={"n" + (Math.abs(r.gap) > 1 ? " bad" : "")} data-reco-gap="">{money(r.gap)}</td>
        <td className="ac"><Act r={r} free={free} /></td></tr>)}
        {rows.length > list.length && <tr className="lt-more"><td colSpan={10} style={{ textAlign: "center" }}><span className="note">{list.length} of {rows.length} invoices shown · </span>
          <button type="button" className="linkbtn" data-reco-more="" onClick={() => setMore(more + 100)}>Show 100 more</button> · <button type="button" className="linkbtn" onClick={() => setMore(rows.length)}>Show all {rows.length}</button></td></tr>}
        {!rows.length && <tr><td colSpan={10}><p className="note" data-list-empty="" style={{ textAlign: "center" }}>No invoice matches these filters.{any && <> <button type="button" className="linkbtn" onClick={() => clearFilter("rcF")}>Clear filters</button></>}</p></td></tr>}
      </tbody>
      <tfoot><tr className="tg-tot" data-reco-foot=""><td colSpan={2}><b data-reco-count="">{rows.length} invoice{rows.length === 1 ? "" : "s"}</b>{rows.length !== base.length && <span className="note"> · of {base.length}</span>}{any && <> · <button type="button" className="linkbtn" onClick={() => clearFilter("rcF")}>Clear filters</button></>}</td>
        <td className="note">Books: taxable, ITC</td><td className="n"><b>{money(r2(rows.reduce((a, r) => a + num((r.books || {}).taxable), 0)))}</b></td><td className="n"><b data-reco-sum="books">{money(t.books)}</b></td>
        <td className="note">2B: taxable, ITC available</td><td className="n"><b>{money(r2(rows.reduce((a, r) => a + num((r.twoB || {}).taxable), 0)))}</b></td><td className="n"><b data-reco-sum="2b">{money(t.twoB)}</b></td>
        <td className="n"><b data-reco-sum="diff">{money(t.diff)}</b></td><td></td></tr></tfoot>
    </table></div>}
    <p className="note" style={{ marginTop: 8 }}>Tax as per books is every bill in the period; as per 2B only what 2B says is available, in the 2B of the period. A row booked in one month and in another month's 2B shows both, counting each in its own month. Matching rules: supplier GSTIN and invoice number, then the number written differently, then the amount (within the allowed difference); a weaker match is a probable match for you to accept or reject.</p>
  </div>;
}
