// 2B reconciliation: the GSTR-2B brought in (from the portal or its JSON) against every document in Tally that takes
// input tax, by supplier or by result, with what the user settles (confirm, unlink, link by hand, a remark). Was
// viewBooks2B (src/js/18). The matching is GST2B (src/js/13): GST2B.scope() gives the pairs and what is left over.
//
// State: S.r2Scope (month, year or everything), S.r2Tab, S.r2F (filters, one set per tab), S.r2Open (the supplier
// opened). What is settled is kept with the books: GST2B.state() (link, confirm, tag, opt.tol).
import { R2bBar, PairCell } from "../../parts/Ai.jsx";
import GstApiCard from "../GstApiCard.jsx";
import CommitBox from "../../parts/CommitBox.jsx";
import { Only2bNote } from "./InputRegister.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => fmtDate(tallyDate(d));
const tx = (o) => r2(num(o.igst) + num(o.cgst) + num(o.sgst) + num(o.cess));
const sumTx = (list) => r2(list.reduce((a, o) => a + tx(o) * (o.dir || 1), 0));
const LIMIT = 400;
const FLAGS = [["", "Everything"], ["month", "Matched in another month"], ["notavl", "ITC not available in 2B"], ["ims", "Rejected or pending in IMS"], ["rcm", "Reverse charge"], ["nogstin", "No GSTIN in Tally"], ["notes", "Credit and debit notes"], ["big", "Tax over ₹ 10,000"]];
const TAGS_2B = [["", "—"], ["To book in Tally", "to book in Tally"], ["Booked in a later month", "booked in a later month"], ["Not our purchase", "not our purchase"], ["Blocked, section 17(5)", "blocked, 17(5)"], ["Ask supplier to correct", "ask supplier to correct"]];
const TAGS_BOOKS = [["", "—"], ["Follow up with supplier", "follow up with supplier"], ["Expect in next 2B", "expect in next 2B"], ["Reverse in 3B", "reverse in 3B"], ["Reverse charge or import", "reverse charge or import"], ["No credit claimed", "no credit claimed"]];
const RESULT = { matched: "matched", diff: "difference", probable: "to confirm" };

const noteOf = (p) => [p.itcavl === "N" ? "ITC not available" + (p.rsn ? ": " + (GST2B.RSN[p.rsn] || p.rsn) : "") : "", p.rcm ? "reverse charge" : "", (p.ims === "R" || p.ims === "P") ? "IMS: " + GST2B.IMS[p.ims] : "",
  /a$/.test(p.sec) ? "amended by the supplier" + (p.oNo ? " (was " + p.oNo + ")" : "") : "", p.sec === "impg" ? "import, bill of entry" : "", p.sec === "isd" ? "from the ISD" : ""].filter(Boolean).join("; ");
const secName = (p) => ({ b2b: "Invoice", b2ba: "Invoice, amended", cdnr: p.dir < 0 ? "Credit note" : "Debit note", cdnra: "Note, amended", isd: "ISD", impg: "Import", impgsez: "Import from SEZ" })[p.sec] || p.sec;

// nothing brought in yet: how to get 2B from the portal
function Empty({ b, apiCard }) {
  return <>
    {apiCard && <GstApiCard />}
    <section className="dash-card" style={{ maxWidth: 760 }}><h3>GSTR-2B reconciliation</h3>
      <p className="note">On the portal: Returns Dashboard → the month → GSTR-2B → View → Download → <b>Generate JSON</b>. Bring in one month, a quarter, or the whole year at once — select all the files together.</p>
      <p className="note">Every document in Tally that takes input tax is compared: purchases, and expenses booked in journals or payments. Invoices are matched on the supplier’s GSTIN and invoice number, then on the number written differently, then on the amount; anything less than certain is put to you to confirm.</p>
      {b.twoB && <p className="note" style={{ color: "var(--warn)" }}>A 2B brought in before this build was read the old way. Bring it in again.</p>}
      <button className="btn small primary" onClick={() => doAct("twoBPick")}>Bring in 2B JSON</button>
    </section>
  </>;
}

// the filters of a tab: find, a kind of document, a month (when more than one), and print
function Bar({ tab, count, table, months, sc0 }) {
  const f = ((S.r2F || {})[tab]) || {};
  return (
    <div className="revfilter" style={{ flexWrap: "wrap", rowGap: 6 }}>
      <input type="search" aria-label="Find in the reconciliation" data-fk={"r2f-" + tab} value={f.q || ""} placeholder="Find a supplier, GSTIN, invoice or voucher" style={{ width: 280, flex: "0 0 auto" }} onChange={(ev) => r2Filter("q", ev.target.value, true)} />
      <select aria-label="Which documents" value={f.flag || ""} style={{ width: "auto", flex: "0 0 auto" }} onChange={(ev) => r2Filter("flag", ev.target.value)}>{FLAGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {sc0.mode !== "month" && <select aria-label="Which month" value={f.month || ""} style={{ width: "auto", flex: "0 0 auto" }} onChange={(ev) => r2Filter("month", ev.target.value)}>
        <option value="">Every month</option>{months.map((m) => <option key={m} value={m}>{GSTR.label(m)}</option>)}</select>}
      <span className="note">{count}</span>
      {Object.keys(f).some((k) => f[k]) && <button className="linkbtn" onClick={() => r2FilterClear(tab)}>Clear filters</button>}
      <button className="btn small" onClick={() => printTable(table, CO().name + " 2B reconciliation " + sc0.label)}>Print or save as PDF</button>
    </div>
  );
}

// a supplier's documents, 2B and Tally side by side, when the supplier is opened
function SupplierDocs({ s, k }) {
  const docs = s.pairs.map((x) => ({ d: x.p.date, cells: <>
      <td>{secName(x.p)}</td><td>{x.p.no}</td><td>{day(x.p.date)}</td><td className="n">{money(tx(x.p))}</td>
      <td>{x.books.map((d) => d.no + " (vch " + d.voucher + ")").join(", ")}</td><td className="n">{money(tx(x.sum))}</td>
      <td>{RESULT[x.status] + (x.issues.length ? ": " + x.issues.join("; ") : "")}</td></> }))
    .concat(s.p2b.map((p) => ({ d: p.date, cells: <>
      <td>{secName(p)}</td><td>{p.no}</td><td>{day(p.date)}</td><td className="n">{money(tx(p))}</td><td>—</td><td></td>
      <td className="bad">{"not in Tally" + (noteOf(p) ? "; " + noteOf(p) : "")}</td></> })))
    .concat(s.pbk.map((d) => ({ d: d.date, cells: <>
      <td>Tally</td><td>—</td><td></td><td></td><td>{d.no + " (vch " + d.voucher + ") " + day(d.date)}</td><td className="n">{money(tx(d))}</td><td className="bad">not in 2B</td></> })))
    .sort((a, c) => String(a.d).localeCompare(String(c.d)));
  return <tr><td colSpan={10} style={{ background: "var(--paper)", padding: 0 }}>
    <table className="bk-table" style={{ margin: 0 }}>
      <thead><tr><th>Document</th><th>Number in 2B</th><th className="dt">Date</th><th className="n">Tax in 2B</th><th>In Tally</th><th className="n">Tax in Tally</th><th>Result</th></tr></thead>
      <tbody>{docs.map((x, i) => <tr key={i}>{x.cells}</tr>)}</tbody>
    </table>
    {s.pbk.length > 0 && s.gstin && <div className="row" style={{ gap: 8, padding: 8 }}>
      <button className="btn small" onClick={() => r2Copy(k)}>Copy a note to the supplier</button>
      <span className="note">lists the {s.pbk.length} invoice{s.pbk.length === 1 ? "" : "s"} not in 2B</span></div>}
  </td></tr>;
}

function Suppliers({ sup }) {
  return <div className="bk-tablewrap"><table className="bk-table" id="r2Sup">
    <thead><tr><th>Supplier</th><th>GSTIN</th><th className="n">Tax in 2B</th><th className="n">Tax in Tally</th><th className="n">Gap</th><th className="n">Matched</th><th className="n">Differences</th><th className="n">To confirm</th><th className="n">2B only</th><th className="n">Tally only</th></tr></thead>
    <tbody>{sup.slice(0, LIMIT).map((s, i) => { const k = s.gstin || s.party, open = S.r2Open === k; return [<tr key={k + ":" + i}>
      <td><button className="linkbtn" onClick={() => tdsToggle("r2Open", k)}>{(open ? "▾ " : "▸ ") + (s.party || "—")}</button></td>
      <td>{s.gstin || <span className="tag warn">no GSTIN in Tally</span>}</td>
      <td className="n">{money(s.t2b)}</td><td className="n">{money(s.tbk)}</td><td className={"n" + (Math.abs(s.gap) > 1 ? " bad" : "")}>{money(s.gap)}</td>
      <td className="n">{s.matched || ""}</td><td className="n">{s.diff || ""}</td><td className="n">{s.probable || ""}</td><td className="n">{s.only2b || ""}</td><td className="n">{s.onlyBooks || ""}</td>
    </tr>, open && <SupplierDocs key={k + ":open:" + i} s={s} k={k} />]; })}</tbody>
  </table>{!sup.length && <div className="bk-none">Nothing matches.</div>}</div>;
}

// matched, with a difference, or to confirm: 2B and Tally on one line
function Pairs({ list, tol }) {
  return <div className="bk-tablewrap"><table className="bk-table" id="r2Pairs">
    <thead><tr><th>Supplier</th><th>2B</th><th className="dt">Date</th><th className="n">Taxable</th><th className="n">Tax</th><th>Tally</th><th className="n">Taxable</th><th className="n">Tax</th><th className="n">Difference</th><th style={{ minWidth: 230 }}>What differs</th><th className="ac"></th></tr></thead>
    <tbody>{list.slice(0, LIMIT).map((x, i) => { const ids = x.books.map((d) => d.id); return <tr key={x.p.key + ":" + i}>
      <td>{x.p.party || "—"}<div className="nr">{x.p.gstin}</div></td>
      <td>{x.p.no}<div className="nr">{secName(x.p) + " · " + GSTR.label(x.p.ym)}</div></td><td>{day(x.p.date)}</td>
      <td className="n">{money(x.p.taxable)}</td><td className="n">{money(tx(x.p))}</td>
      <td>{x.books.map((d) => d.no).join(", ")}<div className="nr">{"vch " + x.books.map((d) => d.voucher).join(", ") + " · " + Array.from(new Set(x.books.map((d) => GSTR.label(d.ym)))).join(", ")}</div></td>
      <td className="n">{money(x.sum.taxable)}</td><td className="n">{money(tx(x.sum))}</td>
      <td className={"n" + (Math.abs(tx(x.diff)) > num(tol) ? " bad" : "")}>{money(tx(x.diff))}</td>
      <td style={{ minWidth: 230 }}>{x.issues.concat(noteOf(x.p) ? [noteOf(x.p)] : []).join("; ") || (x.timing ? "booked in another month" : "")}</td>
      <td className="ac" style={{ whiteSpace: "nowrap" }}>{x.status === "probable"
        ? <><button className="btn small primary" onClick={() => r2Confirm(x.p.key)}>Same</button> <button className="btn small" onClick={() => r2Unlink(x.p.key, ids)}>Not the same</button></>
        : <button className="linkbtn" title="These are not the same document" onClick={() => r2Unlink(x.p.key, ids)}>Unlink</button>}</td>
    </tr>; })}</tbody>
  </table>
    {list.length > LIMIT && <p className="note">The first {LIMIT} are shown; narrow them with the filters, or download the reconciliation.</p>}
    {!list.length && <div className="bk-none">Nothing here.</div>}</div>;
}

const TagSelect = ({ id, tags, st }) => <select aria-label="Remark" value={(st.tag[id] || {}).tag || ""} onChange={(ev) => r2Tag(id, ev.target.value)}>{tags.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;

// in 2B, not found in Tally: link by hand to an entry close to it, or a remark
function Only2b({ list, free, st }) {
  return <>
    <p className="note">In the supplier’s return but not found in Tally. If it is booked under another number, link it; otherwise book it, or note why the credit is not being taken.</p>
    <R2bBar list={list} free={free} />
    <div className="bk-tablewrap"><table className="bk-table" id="r2Only2b">
      <thead><tr><th>Supplier</th><th>Number</th><th className="dt">Date</th><th className="n">Taxable</th><th className="n">Tax</th><th>Note</th><th>Booked in Tally as</th><th>Remark</th></tr></thead>
      <tbody>{list.slice(0, LIMIT).map((p, i) => {
        const cands = free.filter((d) => d.dir === p.dir && (d.gstin === p.gstin || (!d.gstin && GST2B.lastDigits(d.no) === GST2B.lastDigits(p.no)) || (d.gstin && d.gstin.slice(2, 12) === p.gstin.slice(2, 12))))
          .sort((a, c) => Math.abs(tx(a) - tx(p)) - Math.abs(tx(c) - tx(p))).slice(0, 12);
        return <tr key={p.key + ":" + i}>
          <td>{p.party || "—"}<div className="nr">{p.gstin}</div></td>
          <td>{p.no}<div className="nr">{secName(p) + " · " + GSTR.label(p.ym)}</div></td><td>{day(p.date)}</td>
          <td className="n">{money(p.taxable)}</td><td className="n">{money(tx(p))}</td>
          <td>{noteOf(p)}{p.bookedNoCredit && <div><Only2bNote p={p} /></div>}</td>
          <td><select aria-label="Booked in Tally as" value="" style={{ maxWidth: 240 }} onChange={(ev) => r2Link(p.key, ev.target.value)}>
            <option value="">{cands.length ? "not found — choose" : "nothing close in Tally"}</option>
            {cands.map((d) => <option key={d.id} value={d.id}>{d.no + " · vch " + d.voucher + " · " + GSTAmend.dmy(d.date) + " · tax " + INR.format(tx(d)) + (d.gstin ? "" : " · no GSTIN")}</option>)}
          </select><PairCell p={p} /></td>
          <td><TagSelect id={p.key} tags={TAGS_2B} st={st} /></td>
        </tr>; })}</tbody>
    </table>{!list.length && <div className="bk-none">Nothing here.</div>}</div>
  </>;
}

// in Tally, not in 2B: credit taken that the supplier has not reported
function OnlyBooks({ list, st }) {
  return <div className="bk-tablewrap"><table className="bk-table" id="r2Books">
    <thead><tr><th>Supplier</th><th>Invoice</th><th className="dt">Date</th><th>Voucher</th><th className="n">Taxable</th><th className="n">Tax</th><th>Note</th><th>Remark</th></tr></thead>
    <tbody>{list.slice(0, LIMIT).map((d, i) => <tr key={d.id + ":" + i}>
      <td>{d.party || "—"}<div className="nr">{d.gstin || <span className="bad">no GSTIN in Tally</span>}</div></td>
      <td>{d.no}</td><td>{day(d.date)}</td><td>{d.voucher}<div className="nr">{d.type + " · " + GSTR.label(d.ym)}</div></td>
      <td className="n">{money(d.taxable)}</td><td className="n">{money(tx(d))}</td>
      <td>{[d.rcm ? "reverse charge" : "", d.ineligible ? "ITC not to be taken" : "", d.dir < 0 ? "note from the supplier" : ""].filter(Boolean).join("; ")}</td>
      <td><TagSelect id={d.id} tags={TAGS_BOOKS} st={st} /></td>
    </tr>)}</tbody>
  </table>{!list.length && <div className="bk-none">Nothing here.</div>}</div>;
}

export default function TwoB({ b }) {
  const loadedAll = GST2B.all2b(""), apiCard = !!viewGstApiCard(b);
  if (!loadedAll.length) return <Empty b={b} apiCard={apiCard} />;
  const reg = r2Reg(b), sc0 = r2Scope(), set = GST2B.settings(), st = GST2B.state(), regs = GSTR.gstins(b) || [];
  if (!reg && regs.length > 1) return <p className="note">Choose a registration above.</p>;
  const mine = GST2B.all2b(reg), sc = GST2B.scope(reg, sc0.months);
  const wrong = loadedAll.filter((t) => regs.length && !regs.includes(t.gstin));
  // which months of the year have a 2B here
  const fyM = S.gstYm ? GSTRev.fyMonths(S.gstYm) : [], have = new Set(mine.map((t) => t.ym));
  const inSpan = (ym) => !sc0.months || sc0.months.includes(ym);
  const S2b = sc.pairs.map((x) => x.p).concat(sc.only2b).filter((p) => inSpan(p.ym));
  const avl = S2b.filter((p) => p.itcavl !== "N");
  const booksIn = sc.pairs.flatMap((x) => x.books).filter((d) => inSpan(d.ym)).concat(sc.onlyBooks);
  const rjs = sc.rejected || [], sk = GST2B.skipped || {};
  const tab = S.r2Tab || (sc.probable.length ? "probable" : "suppliers");
  // the filters of this tab
  const f = ((S.r2F || {})[tab]) || {}, qq = String(f.q || "").toLowerCase();
  const pass = (p, bk, x) => {
    const o = p || bk;
    if (qq && ![o.party, o.gstin, o.no, bk && bk.voucher, bk && bk.party].join(" ").toLowerCase().includes(qq)) return false;
    if (f.flag === "month" && !(x && x.timing)) return false;
    if (f.flag === "notavl" && !(p && p.itcavl === "N")) return false;
    if (f.flag === "ims" && !(p && (p.ims === "R" || p.ims === "P"))) return false;
    if (f.flag === "rcm" && !((p && p.rcm) || (bk && bk.rcm))) return false;
    if (f.flag === "nogstin" && !(bk && !bk.gstin) && !(x && x.books.some((d) => !d.gstin))) return false;
    if (f.flag === "notes" && !((p && /^cdnr/.test(p.sec)) || (bk && bk.dir < 0))) return false;
    if (f.flag === "big" && tx(o) < 10000) return false;
    if (f.month && (p ? p.ym : bk.ym) !== f.month) return false;
    return true;
  };
  const months = Array.from(new Set(S2b.map((p) => p.ym).concat(booksIn.map((d) => d.ym)))).filter(Boolean).sort();
  const bar = (count, table) => <Bar tab={tab} count={count} table={table} months={months} sc0={sc0} />;
  const Tile = ({ id, label, list, amt, note, warn }) => <button className={"dtile" + (warn && list.length ? " warn" : "")} style={{ textAlign: "left" }} onClick={() => r2TabGo(id)}>
    <span>{label}</span><b>{list.length}</b><small>{money(amt) + " tax" + (note ? " · " + note : "")}</small></button>;
  const TABS = [["suppliers", "Supplier by supplier", null], ["matched", "Matched", sc.matched.length], ["diff", "Differences", sc.diff.length], ["probable", "To confirm", sc.probable.length], ["only2b", "In 2B only", sc.only2b.length], ["books", "In Tally only", sc.onlyBooks.length]];
  let body;
  if (tab === "suppliers") {
    const sup = GST2B.suppliers({ pairs: sc.pairs.filter((x) => pass(x.p, x.books[0], x)), only2b: sc.only2b.filter((p) => pass(p, null)), onlyBooks: sc.onlyBooks.filter((d) => pass(null, d)) });
    body = <>{bar(sup.length + " suppliers", "r2Sup")}<Suppliers sup={sup} /></>;
  } else if (tab === "matched" || tab === "diff" || tab === "probable") {
    const list = sc[tab].filter((x) => pass(x.p, x.books[0], x));
    body = <>{bar(list.length + " of " + sc[tab].length, "r2Pairs")}
      {tab === "probable" && list.length > 0 && <p className="note">Each of these looks like the same document, but the evidence is weaker: a different number, another registration of the supplier, or no GSTIN in Tally. Confirm the ones that are, and say which are not.</p>}
      <Pairs list={list} tol={set.tol} /></>;
  } else if (tab === "only2b") {
    const list = sc.only2b.filter((p) => pass(p, null));
    body = <>{bar(list.length + " of " + sc.only2b.length + " · tax " + money(sumTx(list)), "r2Only2b")}<Only2b list={list} free={sc.all.onlyBooks} st={st} /></>;
  } else {
    const list = sc.onlyBooks.filter((d) => pass(null, d));
    body = <>{bar(list.length + " of " + sc.onlyBooks.length + " · tax " + money(sumTx(list)), "r2Books")}
      <p className="note">Credit taken in Tally that the supplier has not reported{sc.laterMissing ? "; " + sc.laterMissing + " are from the last month here, and may appear in the next 2B" : ""}. Supplier by supplier, you can copy a note to send them.</p>
      <OnlyBooks list={list} st={st} /></>;
  }
  return <>
    {apiCard && <GstApiCard />}
    <section className="dash-card">
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn small primary" onClick={() => doAct("twoBPick")}>Bring in 2B JSON</button>
        <span className="note">2B here for {regs.length > 1 ? reg + ": " : ""}</span>
        {fyM.map((m) => <span key={m} className={"tag" + (have.has(m) ? "" : " warn")} title={have.has(m) ? "brought in" : "not brought in yet"}>{GSTR.label(m).replace(/[-\s]\d{4}$/, "")}</span>)}
      </div>
      {wrong.length > 0 && <p className="note" style={{ color: "var(--warn)" }}>{wrong.length + " 2B file" + (wrong.length === 1 ? " is" : "s are") + " for " + Array.from(new Set(wrong.map((t) => t.gstin))).join(", ") + ", not this client’s registration."}</p>}
      <div className="row" style={{ gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="note">Reconcile</span>
        {[["month", GSTR.label(S.gstYm || "") || "this month"], ["year", "the year"], ["all", "everything here"]].map(([k, l]) =>
          <button key={k} className={"btn small" + (sc0.mode === k ? " primary" : "")} onClick={() => r2ScopeGo(k)}>{l}</button>)}
        <span className="note" style={{ marginLeft: 12 }}>Allow a difference of ₹</span>
        <CommitBox type="number" min="0" step="1" aria-label="Allow a difference of" value={set.tol} style={{ width: 70 }} onCommit={(v) => r2SetTol(v)} />
        <button className="btn small" onClick={() => doAct("twoBExcel")}>Download the reconciliation</button>
      </div>
    </section>
    <div className="dash-tiles" style={{ marginTop: 12 }}>
      <div className="dtile"><span>ITC in 2B, {sc0.label}</span><b>{money(sumTx(avl))}</b><small>{avl.length + " documents" + (S2b.length > avl.length ? ", " + (S2b.length - avl.length) + " not available" : "")}</small></div>
      <div className="dtile"><span>ITC in Tally</span><b>{money(sumTx(booksIn))}</b><small>{booksIn.length} documents</small></div>
      <div className={"dtile" + (Math.abs(sumTx(avl) - sumTx(booksIn)) > 1 ? " warn" : "")}><span>Gap, 2B less Tally</span><b>{money(r2(sumTx(avl) - sumTx(booksIn)))}</b><small>{sc.timing.length} matched in another month</small></div>
    </div>
    {rjs.length > 0 && <p className="note">{"Rejected in IMS: " + rjs.length + " document" + (rjs.length === 1 ? "" : "s") + ", tax ₹" + money(r2(rjs.reduce((a, x) => a + x.p.dir * tx(x.p), 0))) + " — no credit from them" + (rjs.some((x) => x.books.length) ? "; " + rjs.filter((x) => x.books.length).length + " booked in Tally" : "") + ". "}
      <button className="linkbtn" onClick={() => gstPartGo("follow")}>See them under ITC follow-up</button></p>}
    {(sk.setOff || sk.taxOnly) ? <p className="note">{"Left out of Tally’s side: " + [sk.setOff ? sk.setOff + " set-off entr" + (sk.setOff === 1 ? "y" : "ies") + " (output tax against credit)" : "", sk.taxOnly ? sk.taxOnly + " tax-only entr" + (sk.taxOnly === 1 ? "y" : "ies") + " with no supplier GSTIN or value (rounding, reversals)" : ""].filter(Boolean).join(" and ") + "."}</p> : null}
    <div className="dash-tiles">
      <Tile id="matched" label="Matched" list={sc.matched} amt={sumTx(sc.matched.map((x) => x.p))} />
      <Tile id="diff" label="Matched, with a difference" list={sc.diff} amt={sumTx(sc.diff.map((x) => x.p))} warn />
      <Tile id="probable" label="To confirm" list={sc.probable} amt={sumTx(sc.probable.map((x) => x.p))} note="likely the same" warn />
      <Tile id="only2b" label="In 2B, not in Tally" list={sc.only2b} amt={sumTx(sc.only2b)} note="ITC not taken" warn />
      <Tile id="books" label="In Tally, not in 2B" list={sc.onlyBooks} amt={sumTx(sc.onlyBooks)} note="ITC at risk" warn />
    </div>
    <nav className="sbar" aria-label="2B reconciliation">{TABS.map(([id, l, n]) => <button key={id} aria-selected={tab === id} onClick={() => r2TabGo(id)}>{l}{n != null && <>{" "}<span className="sbar-n">{n}</span></>}</button>)}</nav>
    {body}
  </>;
}

