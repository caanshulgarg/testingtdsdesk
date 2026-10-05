// Filed vs books (request of 02-Oct-2026): the books against the returns filed and 2B for a year, invoice by invoice.
// Sales against the filed GSTR-1 / IFF (brought in from the portal's Excel or JSON), credit notes, the tax type against
// the customer's state, 2B against the books, Optional entries, entries deleted in Tally, and the corrections to make in
// Tally when the filed returns are final. The working is GSTX (src/js/56-gst-recon.js).
//
// State: S.reconTab (which list), S.reconSt (the sales filter), S.gstvFy (the year, shared with Returns filed).
import { useEffect } from "react";
import { ListRows } from "../../parts/ListTable.jsx";

const m = (v) => money(r2(num(v)));
const d = (s) => s ? fmtDate(String(s).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")) : "";
const tax = (x) => r2(num(x.igst) + num(x.cgst) + num(x.sgst));
const kindOf = (x) => num(x.igst) ? "IGST" : (num(x.cgst) || num(x.sgst)) ? "CGST + SGST" : "—";
// every list here is the one list table (spec K6): a heading "Label|role" says what the column is (date, number, party,
// amount, status; "sum" adds it up at the foot); the columns follow the one order, the rows sort on a click
const Table = ({ head, children, id, unit, empty }) => <ListRows name={id} id={id} className="bk-table compact" unit={unit || ["document", "documents"]} empty={empty || "Nothing here for this year. Choose another year above, or another tab."}
  head={head.map((h) => { const [label, role] = h.split("|"); return { label, role: role === "sum" ? undefined : role || undefined, sum: role === "sum" || undefined, cls: role === "amount" || role === "sum" ? "n" : undefined }; })}>{children}</ListRows>;
const None = ({ children }) => <p className="note" style={{ margin: "8px 0" }}>{children}</p>;

const TABS = [["sales", "Sales vs returns"], ["cn", "Credit notes"], ["taxtype", "Tax type"], ["twob", "2B vs books"], ["optional", "Optional – not in returns"], ["gone", "Deleted in Tally"], ["fix", "Corrections"]];
const ST = { booksOnly: "In the books, in no return", filedOnly: "In a return, not in the books", period: "Another period", taxtype: "Another tax type", value: "Another value", ok: "Agrees", unchecked: "Return details not brought in" };

function ImportBtn() {
  return <label className="btn small" style={{ cursor: "pointer" }}>Bring in a filed GSTR-1 / IFF (Excel or JSON)
    <input type="file" accept=".xlsx,.xls,.json,application/json" multiple hidden aria-label="Bring in a filed GSTR-1 or IFF"
      onChange={(ev) => { const t = ev.target; if (t.files && t.files.length) gstxImport(t.files); t.value = ""; }} /></label>;
}

function Sales({ reg, fy }) {
  const mt = GSTX.r1Match(reg, fy), st = S.reconSt || "problems", c = mt.counts;
  const shown = mt.rows.filter((r) => st === "all" ? true : st === "problems" ? !["ok", "unchecked"].includes(r.st) : r.st === st || (r.issues || []).includes(st));
  const chip = (k, n) => <button key={k} className={"gf-chip" + (st === k ? " on" : "") + (n && k !== "ok" && k !== "unchecked" ? " warn" : "")} onClick={() => setAndShow("reconSt", k)}>{k === "problems" ? "To look at" : k === "all" ? "All" : ST[k]} <b>{n}</b></button>;
  return <>
    <div className="gf-chips">{chip("problems", c.booksOnly + c.filedOnly + c.period + c.taxtype + c.value)}{chip("booksOnly", c.booksOnly)}{chip("filedOnly", c.filedOnly)}{chip("period", c.period)}{chip("taxtype", c.taxtype)}{chip("value", c.value)}{chip("ok", c.ok)}{chip("unchecked", c.unchecked)}{chip("all", mt.rows.length)}</div>
    {!mt.periods.length && <None>No filed GSTR-1 or IFF details here yet. Download them from the portal (Returns → GSTR-1/IFF → View → Download details, Excel or JSON) and bring them in; once the GST API is connected they are fetched by themselves.</None>}
    {mt.periods.length > 0 && <p className="note">Details here for: {mt.periods.map((p) => { const [per, form] = p.split("|"); return GSTV.label(form) + " " + GSTV.perLabel(form, per, reg); }).join(", ")}.</p>}
    <Table id="reconSales" empty={mt.rows.length ? "Nothing to look at under this choice. Choose All above to see every document." : "No sales document for this year yet. Use Bring in a filed GSTR-1 / IFF above, and read the books from Tally."} head={["What", "Number|number", "Date (books)|date", "Party|party", "GSTIN", "Taxable value|amount", "Books tax", "Return", "Return tax", "Difference|status"]}>
      {shown.slice(0, 500).map((r, i) => { const x = r.b || r.f; return <tr key={i} data-st={r.st} data-no={x.no}>
        <td>{x.kind === "CDNR" ? "Credit note" : x.kind === "DBNR" ? "Debit note" : "Invoice"}</td><td>{x.no}</td><td>{r.b ? d(r.b.date) : ""}</td><td>{(r.b && r.b.party) || (r.f && r.f.name) || ""}</td><td>{x.gstin}</td>
        <td className="n">{m(x.taxable)}</td><td>{r.b ? kindOf(r.b) + " " + m(tax(r.b)) : ""}</td>
        <td>{r.f ? GSTV.label(r.f.form) + " " + GSTV.perLabel(r.f.form, r.f.ret, reg) : ""}</td><td>{r.f ? kindOf(r.f) + " " + m(tax(r.f)) : ""}</td>
        <td className={r.st === "ok" ? "ok" : r.st === "unchecked" ? "nr" : "bad"}>{(r.issues && r.issues.length ? r.issues.map((k) => ST[k]).join(", ") : ST[r.st])}</td></tr>; })}
    </Table>
    {shown.length > 500 && <None>The first 500 of {shown.length} are shown; the corrections Excel has every one.</None>}
  </>;
}

function CreditNotes({ reg, fy }) {
  const list = GSTX.creditNotes(reg, fy);
  if (!list.length) return <None>No credit notes to customers in the books or the returns for {fy}.</None>;
  return <Table id="reconCn" head={["Date|date", "Number|number", "Party|party", "Taxable value|amount", "Tax", "In the returns?|status"]}>
    {list.map((r, i) => { const x = r.b || r.f; return <tr key={i} data-st={r.st}><td>{d(x.date)}</td><td>{x.no}</td><td>{(r.b && r.b.party) || (r.f && r.f.name) || x.gstin}</td><td className="n">{m(x.taxable)}</td><td>{kindOf(x) + " " + m(tax(x))}</td>
      <td className={r.st === "ok" ? "ok" : r.st === "unchecked" ? "nr" : "bad"}>{r.st === "ok" ? "Yes, " + GSTV.label(r.f.form) + " " + GSTV.perLabel(r.f.form, r.f.ret, reg) : r.st === "booksOnly" ? "No — in no return filed" : r.st === "filedOnly" ? "In " + GSTV.label(r.f.form) + " " + GSTV.perLabel(r.f.form, r.f.ret, reg) + ", not in the books" : r.st === "unchecked" ? "not checked: that return's details are not here" : (r.issues || []).map((k) => ST[k]).join(", ")}</td></tr>; })}
  </Table>;
}

function TaxType({ reg, fy }) {
  const list = GSTX.taxType(reg, GSTX.fyMonths(fy));
  if (!list.length) return <None>Every sales invoice and note of {fy} carries the tax type its customer’s state calls for.</None>;
  return <Table id="reconTax" head={["Date|date", "Number|number", "Customer|party", "GSTIN", "Taxable value|amount", "Charged", "Should be", "Why|status"]}>
    {list.map((t) => <tr key={t.id} data-no={t.no}><td>{d(t.date)}</td><td>{t.no}</td><td>{t.party}</td><td>{t.gstin}</td><td className="n">{m(t.taxable)}</td><td>{kindOf(t) + " " + m(tax(t))}</td><td><b>{t.should}</b></td><td className="bad">{t.why}</td></tr>)}
  </Table>;
}

function TwoB({ reg, fy }) {
  const t = GSTX.twoBYear(reg, fy);
  if (!t.loaded) return <None>No 2B here for {fy}. Bring it in on the 2B page, or connect the GST API.</None>;
  return <>
    <h4>In 2B, no entry in the books ({t.only2b.length}) · IGST {m(t.tot.only2b.igst)} · CGST {m(t.tot.only2b.cgst)} · SGST {m(t.tot.only2b.sgst)}</h4>
    <Table id="recon2b" head={["2B period", "Supplier|party", "GSTIN", "Number|number", "Date|date", "Taxable value|amount", "IGST|sum", "CGST|sum", "SGST|sum", "In the books|status"]}>
      {t.only2b.map((x, i) => <tr key={i} data-no={x.no}><td>{GSTR.label(x.ym)}</td><td>{x.party}</td><td>{x.gstin}</td><td>{x.no}</td><td>{d(x.date)}</td><td className="n">{m(x.taxable)}</td><td className="n">{m(num(x.igst) * (x.dir || 1))}</td><td className="n">{m(num(x.cgst) * (x.dir || 1))}</td><td className="n">{m(num(x.sgst) * (x.dir || 1))}</td>
        <td className={x.claimed ? "bad" : "nr"}>{x.say}</td></tr>)}
    </Table>
    <h4 style={{ marginTop: 14 }}>Input tax in the books, not in 2B ({t.onlyBooks.length}) · IGST {m(t.tot.onlyBooks.igst)} · CGST {m(t.tot.onlyBooks.cgst)} · SGST {m(t.tot.onlyBooks.sgst)}</h4>
    <Table id="reconBooks" head={["Month", "Supplier|party", "GSTIN", "Bill number|number", "Date|date", "Taxable value|amount", "IGST|sum", "CGST|sum", "SGST|sum"]}>
      {t.onlyBooks.map((x, i) => <tr key={i}><td>{GSTR.label(x.ym)}</td><td>{x.party}</td><td>{x.gstin}</td><td>{x.no}</td><td>{d(x.date)}</td><td className="n">{m(x.taxable)}</td><td className="n">{m(x.igst)}</td><td className="n">{m(x.cgst)}</td><td className="n">{m(x.sgst)}</td></tr>)}
    </Table>
    {t.taxOnly.length > 0 && <><h4 style={{ marginTop: 14 }}>Input tax with no supplier GSTIN ({t.taxOnly.length}): counted in the books, never in 2B</h4>
      <Table id="reconTaxOnly" head={["Date|date", "Type", "Number|number", "Ledger|party", "IGST|sum", "CGST|sum", "SGST|sum"]}>
        {t.taxOnly.map((x, i) => <tr key={i}><td>{d(x.date)}</td><td>{x.type}</td><td>{x.voucher}</td><td>{x.party}</td><td className="n">{m(x.igst)}</td><td className="n">{m(x.cgst)}</td><td className="n">{m(x.sgst)}</td></tr>)}
      </Table></>}
  </>;
}

function Optional({ reg, fy }) {
  const list = GSTX.optional(reg, fy);
  if (!list.length) return <None>No Optional entries with GST in {fy}.</None>;
  return <><p className="note">Optional entries are memoranda in Tally: they are in no return and no figure here. Make one regular in Tally if it should be reported.</p>
    <Table id="reconOpt" head={["Date|date", "Type", "Number|number", "Party|party", "Taxable value|amount", "IGST|sum", "CGST|sum", "SGST|sum"]}>
      {list.map((o) => <tr key={o.id}><td>{d(o.date)}</td><td>{o.type}</td><td>{o.no}</td><td>{o.party}</td><td className="n">{m(o.taxable)}</td><td className="n">{m(o.igst)}</td><td className="n">{m(o.cgst)}</td><td className="n">{m(o.sgst)}</td></tr>)}
    </Table></>;
}

function Gone({ reg }) {
  const list = GSTX.gone(reg), s = GSTX.srv[S.coId];
  return <>
    <p className="note">An entry that was read from Tally and is no longer there is kept here, never removed, with the day FinCom saw it gone. A deleted purchase whose credit is still in 2B, or in a 3B already filed, is credit to reverse.{s && s.missing ? " The server’s list is not set up yet (migration 18), so only what this computer saw is shown." : ""}</p>
    {!list.length ? <None>No entry has been deleted in Tally since FinCom read the books.</None> :
      <Table id="reconGone" head={["Deleted in Tally on", "Date|date", "Type", "Number|number", "Party|party", "Taxable value|amount", "Input tax|sum", "Credit|status"]}>
        {list.map((g) => <tr key={g.id} data-gone={g.id}><td>{fmtDate(g.at)}</td><td>{d(g.date)}</td><td>{g.type}</td><td>{g.supInv || g.no}</td><td>{g.party}</td><td className="n">{m(g.taxable)}</td><td className="n">{g.inTax ? m(g.inTax) : ""}</td><td className={g.reverse ? "bad" : "nr"}>{g.say}</td></tr>)}
      </Table>}
  </>;
}

function Fix({ reg, fy }) {
  const c = GSTX.corrections(reg, fy);
  return <>
    <p className="note">{c.final ? "The filed returns are final: each difference is a correction to make in Tally, so the books follow the returns." : "The filed returns are not marked final: each difference says what to correct, in Tally or in the next return."}</p>
    {!c.rows.length ? <None>Nothing to correct for {fy}.</None> :
      <Table id="reconFix" head={["Area", "Document", "Number|number", "Date|date", "Party|party", "Taxable value|amount", "Tax|sum", "Difference", "Correction to make|status"]}>
        {c.rows.map((r, i) => <tr key={i}><td>{r.area}</td><td>{r.what}</td><td>{r.no}</td><td>{r.date}</td><td>{r.party}</td><td className="n">{m(r.taxable)}</td><td className="n">{m(r.tax)}</td><td>{r.diff}</td><td><b>{r.action}</b></td></tr>)}
      </Table>}
  </>;
}

export default function Recon({ b }) {
  const reg = S.gstReg || "", years = GSTV.years(reg), fy = years.includes(S.gstvFy) ? S.gstvFy : GSTX.fyNow();
  S.gstvFy = fy;
  const tab = TABS.some((t) => t[0] === S.reconTab) ? S.reconTab : "sales", fin = GSTX.final(reg);
  useEffect(() => { const s = GSTX.srv[S.coId]; if (!s || Date.now() - s.at > 300000) GSTX.loadGone(S.coId); }, [S.coId]);
  const n = { taxtype: GSTX.taxType(reg, GSTX.fyMonths(fy)).length, gone: GSTX.gone(reg).length, optional: GSTX.optional(reg, fy).length };
  return <section className="dash-card" data-recon="">
    <div className="gf-ctl" style={{ flexWrap: "wrap", gap: 8 }}><h3 style={{ margin: 0 }}>Filed vs books</h3>
      <select aria-label="Year" style={{ width: "auto" }} value={fy} onChange={(ev) => setAndShow("gstvFy", ev.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
      <ImportBtn />
      <label className="chk" title="When on, every difference becomes a correction to make in Tally"><input type="checkbox" aria-label="Filed returns are final" checked={fin} onChange={(ev) => GSTX.setFinal(reg, ev.target.checked)} /> Filed returns are final</label>
      <button className="btn small" onClick={() => GSTX.correctionsExcel(reg, fy)}>Download the corrections (Excel)</button>
    </div>
    <nav className="bk-tabs" aria-label="Filed vs books">{TABS.map(([k, l]) => <button key={k} aria-selected={tab === k} onClick={() => setAndShow("reconTab", k)}>{l}{n[k] ? <span className="sbar-n">{n[k]}</span> : null}</button>)}</nav>
    {tab === "sales" ? <Sales reg={reg} fy={fy} /> : tab === "cn" ? <CreditNotes reg={reg} fy={fy} /> : tab === "taxtype" ? <TaxType reg={reg} fy={fy} /> : tab === "twob" ? <TwoB reg={reg} fy={fy} />
      : tab === "optional" ? <Optional reg={reg} fy={fy} /> : tab === "gone" ? <Gone reg={reg} /> : <Fix reg={reg} fy={fy} />}
  </section>;
}
