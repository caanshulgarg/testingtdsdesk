// GST › What to fix (the owner, 11-Nov-2026, on the year's grid: "Errors 155 to fix before filing … I am not able to locate
// the error"): a red cell opens its month here. The errors are the grid's own (GSTR.errorChecks, the list GSTR.errorsFor
// counts, src/js/12), so the count here is the cell's; no rule is made here. Each kind of error is a group in plain words,
// opening to its documents (date, number, party, amount), why the portal minds, what to do and the field to correct in
// Tally; each document opens in Look up, found and opened. FixTop is the same count on top of the return's other tabs.
const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(d)) : "");

// the checks of GSTR.checks, in plain words: the group's name, the documents' word, and where in Tally it is corrected
// (keyed by the check's own wording, so nothing new is decided here; a check not listed shows its own wording)
const PARTY_GSTIN = "In Tally: Alter the party's ledger (Gateway of Tally › Alter › Ledger) › Statutory / GST registration details › GSTIN/UIN, then read the books again.";
const SUP_GSTIN = "In Tally: Alter the supplier's ledger (Gateway of Tally › Alter › Ledger) › Statutory / GST registration details › GSTIN/UIN (or the Party details on the purchase voucher), then read the books again.";
const VNO = "In Tally: open the voucher (Display › Day Book › the voucher › Alt+A to alter) and change the Voucher No. (or the voucher type's numbering prefix), then read the books again.";
const SAY = {
  "Invoices to a registered party with no GSTIN": ["Buyer GSTIN missing", "invoice", "The sale is to a registered business but carries no GSTIN, so the buyer cannot get the credit.", PARTY_GSTIN],
  "Outward invoices with no place of supply": ["Place of supply missing", "invoice", "GSTR-1 needs the state each sale is made to; it decides IGST or CGST and SGST.", "In Tally: open the invoice (Alt+A) › Party details › Place of Supply, or set the State on the party's ledger."],
  "Outward invoices with no HSN": ["Missing HSN", "invoice", "The HSN summary (table 12) needs the HSN or SAC code of what was sold.", "In Tally: Alter the stock item (or the sales ledger, for services) › Statutory details / HSN/SAC details › HSN/SAC."],
  "Tax that does not fit the taxable value": ["Tax does not match a GST rate", "invoice", "The tax on the invoice does not work out to a GST rate of its taxable value.", "In Tally: open the invoice (Alt+A) and check the GST rate on the stock item or sales ledger and the tax lines."],
  "Credit notes issued after 30 November following the invoice’s year": ["Credit note too late to reduce tax", "credit note", "A credit note after 30 November of the next year cannot reduce output tax (section 34(2)).", "In Tally: re-enter it as a financial credit note without GST (no GST ledgers on the note)."],
  "Invoices to registered customers without an e-invoice (IRN)": ["E-invoice (IRN) missing", "invoice", "Where e-invoicing applies, an invoice without an IRN is not a valid tax invoice.", "In Tally: open the invoice › e-Invoice › generate the IRN (send for e-invoicing), then read the books again."],
  "E-invoices generated more than 30 days after the invoice date": ["E-invoice made late", "invoice", "For turnover of ₹10 crore and above the IRP refuses an IRN more than 30 days after the invoice date.", "In Tally: check the invoice date and the IRN date on the invoice's e-Invoice details."],
  "Buyer GSTINs that are not valid": ["Buyer GSTIN not valid", "invoice", "The GSTIN fails its check digit (the 15th character) or its form, so the portal refuses the invoice.", PARTY_GSTIN],
  "Invoice numbers longer than 16 characters": ["Invoice number too long", "invoice", "The portal takes at most 16 characters in an invoice number.", VNO],
  "Invoice numbers with characters the portal does not take": ["Invoice number has characters the portal refuses", "invoice", "Only letters, digits, / and - are allowed, and a number cannot be only zeros.", VNO],
  "Invoice numbers used twice in the financial year": ["Invoice number used twice", "invoice", "Each invoice, and each credit or debit note, needs its own number in the financial year.", VNO],
  "Purchases with no supplier GSTIN": ["Supplier GSTIN missing", "purchase", "A bill with GST but no supplier GSTIN can never match 2B, so its credit is at risk.", SUP_GSTIN],
  "Supplier GSTINs that are not valid": ["Supplier GSTIN not valid", "purchase", "The GSTIN fails its check digit or its form, so the bill can never match 2B.", SUP_GSTIN],
};
const sayOf = (c) => SAY[c.what] || [c.what, c.ret === "r3b" ? "purchase" : "document", "", ""];
const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
const SHOW = 100;

// a check's document, as the list shows it: the row itself, the one a GSTIN finding was made on (doc), or, for the
// findings that keep only a number (e-invoices, late credit notes), the month's document of that number
function docOf(x, find) {
  const r = x.doc || x;
  if (r.id) return r;
  return find(r.no, r.party, r.date) || r;
}
const amountOf = (d) => (d.total != null ? d.total : num(d.taxable) + num(d.igst) + num(d.cgst) + num(d.sgst) + num(d.cess));

// the document in Look up: the entries of its day with its number, and the one opened
function openDoc(d) {
  const d8 = String(d.date || "").slice(0, 8), lk = LK.st();
  const no = String(d.voucher || d.no || "").trim();
  // a number of digits only would be read as an amount by Look up: the party then (the entry is found by its id below)
  const q = no && !/^[\d,]+(\.\d+)?$/.test(no) ? no : String(d.party || "");
  Object.assign(lk, { kind: "find", q, typ: "", from: d8 || lk.from, to: d8 || lk.to, heard: "", led: "" });
  FC.go("lookup");
  Promise.resolve(LK.run("auto")).then(() => { const x = LK.st(); if (d.id && x.res && (x.res.rows || []).some((r) => r.id === d.id)) { x.open = Object.assign({}, x.open, { [d.id]: true }); render(); } }).catch(() => {});
}

function Group({ c, k, find, r3b }) {
  const st = (S.gstFix = S.gstFix || {}), open = !!st[k], all = !!st[k + "|all"];
  const [label, word, why, tally] = sayOf(c);
  const rows = open ? (c.all || c.rows).slice(0, all ? undefined : SHOW).map((x) => [x, docOf(x, find)]) : [];
  const toggle = () => { st[k] = !open; render(); };
  return <li className="fx-g" data-fix-group={c.what} data-n={c.n}>
    <button type="button" className="fx-h" data-fix-toggle="" aria-expanded={open} onClick={toggle}>
      <span aria-hidden="true">{open ? "▾" : "▸"}</span> <b>{label} — {plural(c.n, word)}</b></button>
    {open && <div className="fx-b">
      {why && <p className="note" data-fix-why="">{why}</p>}
      <p className="note" data-fix-how=""><b>What to do:</b> {c.how}</p>
      {tally && <p className="fx-tally" data-fix-tally="">{tally}</p>}
      <div className="bk-tablewrap"><table className="bk-table tg-fit" data-statement="">
        <thead><tr><th className="dt">Date</th><th>{r3b ? "Bill" : "Number"}</th><th>{r3b ? "Supplier" : "Party"}</th><th className="n">Amount</th><th>Open</th></tr></thead>
        <tbody>{rows.map(([x, d], i) => <tr key={i} data-fix-row="" data-id={d.id || ""}>
          <td className="dt">{day(d.date) || "—"}</td>
          <td>{d.no || x.no || "—"}{r3b && d.voucher && d.voucher !== d.no ? <small className="nr"> voucher {d.voucher}</small> : null}</td>
          <td>{d.party || x.party || "—"}{x.doc && x.no ? <small className="nr"> GSTIN {x.no}</small> : d.gstin && /GSTIN/.test(c.what) ? <small className="nr"> GSTIN {d.gstin}</small> : null}</td>
          <td className="n">{d.id ? money(amountOf(d)) : "—"}</td>
          <td>{d.date || d.id ? <button type="button" className="linkbtn" data-fix-open="" title="Open the entry in Look up" onClick={() => openDoc(d)}>Open the entry</button> : ""}</td></tr>)}</tbody>
      </table></div>
      {!all && (c.all || c.rows).length > SHOW && <button type="button" className="linkbtn" data-fix-more="" onClick={() => { st[k + "|all"] = true; render(); }}>Show all {c.n}</button>}
    </div>}
  </li>;
}

// the month's errors of one return (r1: GSTR-1 or IFF, the sales side; r3b: the purchase side)
export function FixList({ ym, reg, ret, n }) {
  const list = GSTR.errorChecks(ym, reg)[ret];
  let idx = null;
  const find = (no, party, date) => {
    if (!idx) { idx = new Map(); GSTR.outward(ym, reg).forEach((r) => { const key = String(r.no || "").trim().toUpperCase(); if (!idx.has(key)) idx.set(key, []); idx.get(key).push(r); }); }
    const l = idx.get(String(no || "").trim().toUpperCase()) || [];
    return l.find((r) => (!date || r.date === date) && (!party || r.party === party)) || l[0] || null;
  };
  const ids = new Set(); list.forEach((c) => (c.all || c.rows).forEach((x) => { const d = x.doc || x; if (d.id) ids.add(d.id); }));
  const name = ret === "r3b" ? "GSTR-3B" : "GSTR-1";
  return <section className="dash-card fx" data-fix-list="" data-fix-n={n} data-fix-ret={ret}>
    <h3>What to fix ({n})</h3>
    <p className="note">{name} for {GSTR.label(ym)}: {plural(n, "error")} to fix before filing{ids.size && ids.size !== n ? ", on " + plural(ids.size, "document") : ""}, by kind. Open a kind to see its documents; each opens in Look up. The fix is made in Tally and the books read again.</p>
    <ul className="fx-list">{list.map((c) => <Group key={c.what} c={c} k={ym + "|" + reg + "|" + ret + "|" + c.what} find={find} r3b={ret === "r3b"} />)}</ul>
  </section>;
}

// the same count on top of the return's other tabs, with its kinds, and the way to the list
export function FixTop({ ym, reg, ret, n }) {
  const list = GSTR.errorChecks(ym, reg)[ret];
  return <div className="fx-top" role="status" data-fix-top="" data-fix-n={n}>
    <b>What to fix ({n})</b>
    <span className="note">{list.map((c) => { const [l] = sayOf(c); return l + " " + c.n; }).join(" · ")}</span>
    <button type="button" className="linkbtn" data-fix-see="" onClick={() => gstSubGo("fix")}>See the list</button>
  </div>;
}
