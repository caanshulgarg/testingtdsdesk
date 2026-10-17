// The GST returns in the GSTN portal's own structure (round 72, 17-Oct-2026; the owner: "GST module including 1, 2B, 3B,
// amendments should match the GSTN schema so that anyone can understand what is there in that field.. users are habitual
// of that schema"). Nothing here works out a figure of its own:
//   - GSTR-1: the portal's tables are read off the GSTR-1 JSON FinCom makes (GSTR.toJson, src/js/12), with the portal's
//     numbering, names and column headings; the amendment tables (9A, 9C, 10) put the copy filed (GSTAmend.pending's
//     "was") beside what goes in the file;
//   - GSTR-3B: the portal's tables and row labels, each figure GSTR.threeB's, with the bills behind it (the same tests on
//     the same rows as GSTR.threeBm) and what is added to them, so the bills and the adjustments add up to the figure;
//   - GSTR-2B: the documents brought in (GST2B.all2b), in the portal's sections and its summary (ITC available / not
//     available, Part A and Part B).
// Pure functions of the legacy globals (GSTR, GST2B, GSTAmend, STATE_CODES, num, r2); window.GSTPortal for the tests.

const N = (v) => num(v);
const R = (v) => r2(v);
const z5 = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
export const HEADS = ["taxable", "igst", "cgst", "sgst", "cess"];
export const taxOf = (o) => R(N(o.igst) + N(o.cgst) + N(o.sgst) + N(o.cess));
const addTo = (o, x, sg = 1) => { HEADS.forEach((k) => { o[k] = R(N(o[k]) + sg * N(x[k])); }); return o; };

// "07-Delhi", as the portal writes a place of supply
export function posName(code) {
  const c = String(code || "").padStart(2, "0");
  if (!code) return "";
  const st = Object.keys(STATE_CODES).find((k) => STATE_CODES[k] === c);
  return c + "-" + (st ? st.toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase()) : c === "97" ? "Other Territory" : c === "96" ? "Foreign Country" : "");
}
const yn = (v) => (v === "Y" ? "Y" : "N");
const INV_TYPE = { R: "Regular B2B", SEWP: "SEZ supplies with payment", SEWOP: "SEZ supplies without payment", DE: "Deemed Exp", CBW: "Intra-State supplies attracting IGST" };
const NOTE_TYPE = { C: "Credit Note", D: "Debit Note" };
const NIL_DESC = { INTRB2B: "Inter-State supplies to registered persons", INTRAB2B: "Intra-State supplies to registered persons", INTRB2C: "Inter-State supplies to unregistered persons", INTRAB2C: "Intra-State supplies to unregistered persons" };
export const DOC_NATURE = { 1: "Invoices for outward supply", 2: "Invoices for inward supply from unregistered person", 3: "Revised Invoice", 4: "Debit Note", 5: "Credit Note", 6: "Receipt voucher", 7: "Payment Voucher", 8: "Refund voucher",
  9: "Delivery Challan for job work", 10: "Delivery Challan for supply on approval", 11: "Delivery Challan in case of liquid gas", 12: "Delivery Challan in cases other than by way of supply (excluding at S no. 9 to 11)" };
const itm = (x) => x.itm_det || x;
const dmyOf = (s) => String(s || "");                         // the JSON's dd-mm-yyyy, as the portal shows it
const lineOf = (x) => ({ rate: N(x.rt), taxable: N(x.txval != null ? x.txval : x.ad_amt), igst: N(x.iamt), cgst: N(x.camt), sgst: N(x.samt), cess: N(x.csamt) });

/* ---------------------------------------------------------------- GSTR-1 */

// the portal's tables, in its order; cols are its column headings: [key, heading, numeric?]
const C = (k, h, n) => [k, h, !!n];
const AMT = [C("taxable", "Taxable Value", 1), C("igst", "Integrated Tax", 1), C("cgst", "Central Tax", 1), C("sgst", "State/UT Tax", 1), C("cess", "Cess", 1)];
export const R1_TABLES = [
  { id: "b2b", no: "4A, 4B, 6B, 6C", name: "B2B, SEZ, DE Invoices", short: "B2B", unit: "invoice",
    cols: [C("ctin", "GSTIN/UIN of Recipient"), C("name", "Receiver Name"), C("inum", "Invoice Number"), C("idt", "Invoice date"), C("val", "Invoice Value", 1), C("pos", "Place Of Supply"), C("rchrg", "Reverse Charge"),
      C("diff", "Applicable % of Tax Rate"), C("typ", "Invoice Type"), C("etin", "E-Commerce GSTIN"), C("rate", "Rate", 1)].concat(AMT) },
  { id: "b2cl", no: "5A, 5B", name: "B2C (Large) Invoices", short: "B2CL", unit: "invoice",
    cols: [C("inum", "Invoice Number"), C("idt", "Invoice date"), C("val", "Invoice Value", 1), C("pos", "Place Of Supply"), C("diff", "Applicable % of Tax Rate"), C("rate", "Rate", 1)].concat(AMT, [C("etin", "E-Commerce GSTIN")]) },
  { id: "exp", no: "6A", name: "Exports Invoices", short: "EXP", unit: "invoice",
    cols: [C("exptyp", "Export Type"), C("inum", "Invoice Number"), C("idt", "Invoice date"), C("val", "Invoice Value", 1), C("port", "Port Code"), C("sbnum", "Shipping Bill Number"), C("sbdt", "Shipping Bill Date"), C("rate", "Rate", 1)].concat(AMT) },
  { id: "b2cs", no: "7", name: "B2C (Others)", short: "B2CS", unit: "line",
    cols: [C("typ", "Type"), C("pos", "Place Of Supply"), C("diff", "Applicable % of Tax Rate"), C("rate", "Rate", 1)].concat(AMT, [C("etin", "E-Commerce GSTIN")]) },
  { id: "nil", no: "8A, 8B, 8C, 8D", name: "Nil Rated Supplies", short: "Nil", unit: "line",
    cols: [C("desc", "Description"), C("nil", "Nil Rated Supplies", 1), C("expt", "Exempted (other than nil rated/non GST supply)", 1), C("ngsup", "Non-GST Supplies", 1)] },
  { id: "b2ba", no: "9A", name: "Amended B2B Invoices", short: "B2BA", unit: "invoice", amend: true },
  { id: "b2cla", no: "9A", name: "Amended B2C (Large) Invoices", short: "B2CLA", unit: "invoice", amend: true },
  { id: "expa", no: "9A", name: "Amended Exports Invoices", short: "EXPA", unit: "invoice", amend: true },
  { id: "cdnr", no: "9B", name: "Credit / Debit Notes (Registered)", short: "CDNR", unit: "note",
    cols: [C("ctin", "GSTIN/UIN of Recipient"), C("name", "Receiver Name"), C("ntnum", "Note Number"), C("ntdt", "Note Date"), C("ntty", "Note Type"), C("pos", "Place Of Supply"), C("rchrg", "Reverse Charge"),
      C("typ", "Note Supply Type"), C("val", "Note Value", 1), C("diff", "Applicable % of Tax Rate"), C("rate", "Rate", 1)].concat(AMT) },
  { id: "cdnur", no: "9B", name: "Credit / Debit Notes (Unregistered)", short: "CDNUR", unit: "note",
    cols: [C("urtyp", "UR Type"), C("ntnum", "Note Number"), C("ntdt", "Note Date"), C("ntty", "Note Type"), C("pos", "Place Of Supply"), C("val", "Note Value", 1), C("diff", "Applicable % of Tax Rate"), C("rate", "Rate", 1)].concat(AMT) },
  { id: "cdnra", no: "9C", name: "Amended Credit/Debit Notes (Registered)", short: "CDNRA", unit: "note", amend: true },
  { id: "cdnura", no: "9C", name: "Amended Credit/Debit Notes (Unregistered)", short: "CDNURA", unit: "note", amend: true },
  { id: "b2csa", no: "10", name: "Amended B2C (Others)", short: "B2CSA", unit: "line", amend: true },
  { id: "at", no: "11A(1), 11A(2)", name: "Tax Liability (Advances Received)", short: "AT", unit: "line",
    cols: [C("pos", "Place Of Supply"), C("diff", "Applicable % of Tax Rate"), C("rate", "Rate", 1), C("taxable", "Gross Advance Received", 1), C("igst", "Integrated Tax", 1), C("cgst", "Central Tax", 1), C("sgst", "State/UT Tax", 1), C("cess", "Cess", 1)] },
  { id: "txpd", no: "11B(1), 11B(2)", name: "Adjustment of Advances", short: "TXPD", unit: "line",
    cols: [C("pos", "Place Of Supply"), C("diff", "Applicable % of Tax Rate"), C("rate", "Rate", 1), C("taxable", "Gross Advance Adjusted", 1), C("igst", "Integrated Tax", 1), C("cgst", "Central Tax", 1), C("sgst", "State/UT Tax", 1), C("cess", "Cess", 1)] },
  { id: "ata", no: "11A", name: "Amended Tax Liability (Advance Received)", short: "ATA", unit: "line", amend: true },
  { id: "txpda", no: "11B", name: "Amendment of Adjustment of Advances", short: "TXPDA", unit: "line", amend: true },
  { id: "hsnb2b", no: "12", name: "HSN-wise summary of outward supplies · B2B", short: "HSN B2B", unit: "line",
    cols: [C("hsn", "HSN"), C("desc", "Description"), C("uqc", "UQC"), C("qty", "Total Quantity", 1), C("rate", "Rate", 1)].concat(AMT) },
  { id: "hsnb2c", no: "12", name: "HSN-wise summary of outward supplies · B2C", short: "HSN B2C", unit: "line",
    cols: [C("hsn", "HSN"), C("desc", "Description"), C("uqc", "UQC"), C("qty", "Total Quantity", 1), C("rate", "Rate", 1)].concat(AMT) },
  { id: "hsn", no: "12", name: "HSN-wise summary of outward supplies", short: "HSN", unit: "line",
    cols: [C("hsn", "HSN"), C("desc", "Description"), C("uqc", "UQC"), C("qty", "Total Quantity", 1), C("rate", "Rate", 1)].concat(AMT) },
  { id: "docs", no: "13", name: "Documents Issued", short: "DOCS", unit: "series",
    cols: [C("nature", "Nature of Document"), C("from", "Sr. No. From"), C("to", "Sr. No. To"), C("totnum", "Total Number", 1), C("cancel", "Cancelled", 1), C("net", "Net Issued", 1)] },
  // table 14 (17-Oct-2026): the JSON's supeco, by the operator's GSTIN; its supplies are also in tables 4 to 10
  { id: "eco14a", no: "14(a)", name: "Supplies made through E-Commerce Operators – ECO liable to collect tax u/s 52", short: "ECO 14a", unit: "operator", eco: true,
    cols: [C("etin", "GSTIN of E-Commerce Operator"), C("name", "Trade/Legal name"), C("taxable", "Net value of supplies", 1), C("igst", "Integrated tax", 1), C("cgst", "Central tax", 1), C("sgst", "State/UT tax", 1), C("cess", "Cess", 1)] },
  { id: "eco14b", no: "14(b)", name: "Supplies made through E-Commerce Operators – ECO liable to pay tax u/s 9(5)", short: "ECO 14b", unit: "operator", eco: true,
    note: "FinCom has no record of supplies on which the e-commerce operator pays the tax u/s 9(5) (such as restaurant, passenger transport or accommodation services sold through an operator): the GSTR-1 JSON leaves 14(b) empty. Enter any on the portal.",
    cols: [C("etin", "GSTIN of E-Commerce Operator"), C("name", "Trade/Legal name"), C("taxable", "Net value of supplies", 1), C("igst", "Integrated tax", 1), C("cgst", "Central tax", 1), C("sgst", "State/UT tax", 1), C("cess", "Cess", 1)] },
];
export const R1_BY = Object.fromEntries(R1_TABLES.map((t) => [t.id, t]));
export const r1Title = (t) => t.no + " – " + t.name;
// the amendment tables: original beside revised
export const AMEND_COLS = {
  doc: [C("ctin", "GSTIN/UIN of Recipient"), C("name", "Receiver Name"), C("onum", "Original Invoice Number"), C("odt", "Original Invoice date"), C("otaxable", "Original Taxable Value", 1), C("otax", "Original Tax", 1),
    C("inum", "Revised Invoice Number"), C("idt", "Revised Invoice date"), C("val", "Revised Invoice Value", 1), C("pos", "Place Of Supply"), C("rate", "Rate", 1)].concat(AMT, [C("what", "What changed")]),
  note: [C("ctin", "GSTIN/UIN of Recipient"), C("name", "Receiver Name"), C("onum", "Original Note Number"), C("odt", "Original Note Date"), C("otaxable", "Original Taxable Value", 1), C("otax", "Original Tax", 1),
    C("inum", "Revised Note Number"), C("idt", "Revised Note Date"), C("ntty", "Note Type"), C("val", "Revised Note Value", 1), C("rate", "Rate", 1)].concat(AMT, [C("what", "What changed")]),
  b2csa: [C("fy", "Financial Year"), C("omon", "Original Month"), C("pos", "Place Of Supply"), C("typ", "Type"), C("rate", "Rate", 1), C("otaxable", "Original Taxable Value", 1), C("taxable", "Revised Taxable Value", 1),
    C("igst", "Integrated Tax", 1), C("cgst", "Central Tax", 1), C("sgst", "State/UT Tax", 1), C("cess", "Cess", 1)],
};
export const colsOf = (t) => t.cols || (t.id === "b2csa" ? AMEND_COLS.b2csa : /^cdn/.test(t.id) ? AMEND_COLS.note : AMEND_COLS.doc);

// a key that is the same in the file with and without the amendments (to tell a missed invoice reported now)
const docKey = (sec, g, x) => sec + "|" + (g.ctin || g.pos || g.exp_typ || "") + "|" + (x.inum || x.nt_num || "");

// every portal table of the month: {id: {rows, n, tot, late}}; full is the file (GSTR.toJson), plain the month's own
// documents (toJson with {plain: true}); names: GSTIN → the customer's name in the books; amend: GSTAmend.pending rows
export function r1Portal(full, plain, names, amend) {
  const nm = names || {}, pl = plain || full, inPlain = new Set();
  [["b2b", "inv"], ["b2cl", "inv"], ["exp", "inv"], ["cdnr", "nt"]].forEach(([s, inner]) => (pl[s] || []).forEach((g) => (g[inner] || []).forEach((x) => inPlain.add(docKey(s, g, x)))));
  (pl.cdnur || []).forEach((x) => inPlain.add(docKey("cdnur", {}, x)));
  const T = {}; R1_TABLES.forEach((t) => { T[t.id] = { rows: [], n: 0, tot: z5(), late: 0 }; });
  const put = (id, row, count, late) => { const o = T[id]; row.late = !!late; o.rows.push(row); if (count) { o.n++; if (late) o.late++; } addTo(o.tot, row); };
  // an invoice with more than one rate: its first line also carries the invoice's taxable value and tax (shown under its value)
  const perRate = (id, base, items, sg, late) => { const ls = items.map((x) => lineOf(itm(x))), all = items.length > 1 ? { docTaxable: R(ls.reduce((a, l) => a + l.taxable, 0)), docTax: R(ls.reduce((a, l) => a + taxOf(l), 0)), docRates: ls.length } : {};
    ls.forEach((l, i) => put(id, Object.assign({}, base, l, sg < 0 ? { sign: -1 } : {}, i ? { cont: true } : all), i === 0, late)); };
  (full.b2b || []).forEach((g) => (g.inv || []).forEach((x) => perRate("b2b", { ctin: g.ctin, name: nm[g.ctin] || "", inum: x.inum, idt: dmyOf(x.idt), val: N(x.val), pos: posName(x.pos), rchrg: yn(x.rchrg), diff: x.diff_percent ? x.diff_percent * 100 + "%" : "",
    typ: INV_TYPE[x.inv_typ] || x.inv_typ || "", etin: x.etin || "" }, x.itms || [], 1, !inPlain.has(docKey("b2b", g, x)))));
  (full.b2cl || []).forEach((g) => (g.inv || []).forEach((x) => perRate("b2cl", { inum: x.inum, idt: dmyOf(x.idt), val: N(x.val), pos: posName(g.pos), diff: "", etin: x.etin || "" }, x.itms || [], 1, !inPlain.has(docKey("b2cl", g, x)))));
  (full.exp || []).forEach((g) => (g.inv || []).forEach((x) => perRate("exp", { exptyp: g.exp_typ, inum: x.inum, idt: dmyOf(x.idt), val: N(x.val), port: x.sbpcode || "", sbnum: x.sbnum || "", sbdt: x.sbdt || "" }, x.itms || [], 1, !inPlain.has(docKey("exp", g, x)))));
  (full.b2cs || []).forEach((x) => put("b2cs", Object.assign({ typ: x.typ || "OE", pos: posName(x.pos), diff: "", etin: x.etin || "", sply: x.sply_ty }, lineOf(x)), true));
  ((full.nil || {}).inv || []).forEach((x) => { const o = T.nil; o.rows.push({ desc: NIL_DESC[x.sply_ty] || x.sply_ty, nil: N(x.nil_amt), expt: N(x.expt_amt), ngsup: N(x.ngsup_amt), taxable: R(N(x.nil_amt) + N(x.expt_amt) + N(x.ngsup_amt)) }); o.n++; o.tot.taxable = R(o.tot.taxable + N(x.nil_amt) + N(x.expt_amt) + N(x.ngsup_amt)); });
  // a credit note takes its value off (as the portal's summary does)
  (full.cdnr || []).forEach((g) => (g.nt || []).forEach((x) => perRate("cdnr", { ctin: g.ctin, name: nm[g.ctin] || "", ntnum: x.nt_num, ntdt: dmyOf(x.nt_dt), ntty: NOTE_TYPE[x.ntty] || x.ntty, pos: posName(x.pos), rchrg: yn(x.rchrg), typ: INV_TYPE[x.inv_typ] || x.inv_typ || "", val: N(x.val), diff: "" },
    x.itms || [], x.ntty === "C" ? -1 : 1, !inPlain.has(docKey("cdnr", g, x)))));
  (full.cdnur || []).forEach((x) => perRate("cdnur", { urtyp: x.typ, ntnum: x.nt_num, ntdt: dmyOf(x.nt_dt), ntty: NOTE_TYPE[x.ntty] || x.ntty, pos: posName(x.pos), val: N(x.val), diff: "" }, x.itms || [], x.ntty === "C" ? -1 : 1, !inPlain.has(docKey("cdnur", {}, x))));
  (full.at || []).forEach((g) => (g.itms || []).forEach((x) => put("at", Object.assign({ pos: posName(g.pos), diff: "" }, lineOf(x)), true)));
  (full.txpd || []).forEach((g) => (g.itms || []).forEach((x) => put("txpd", Object.assign({ pos: posName(g.pos), diff: "" }, lineOf(x)), true)));
  const hsnRow = (x) => Object.assign({ hsn: x.hsn_sc, desc: x.desc || "", uqc: x.uqc || "", qty: N(x.qty) }, lineOf(x));
  if (full.hsn) {
    (full.hsn.hsn_b2b || []).forEach((x) => put("hsnb2b", hsnRow(x), true));
    (full.hsn.hsn_b2c || []).forEach((x) => put("hsnb2c", hsnRow(x), true));
    (full.hsn.data || []).forEach((x) => put("hsn", hsnRow(x), true));
  }
  ((full.doc_issue || {}).doc_det || []).forEach((d) => (d.docs || []).forEach((x) => { const o = T.docs; o.rows.push({ nature: DOC_NATURE[d.doc_num] || String(d.doc_num), from: x.from, to: x.to, totnum: N(x.totnum), cancel: N(x.cancel), net: N(x.net_issue) }); o.n += N(x.net_issue); }));
  // table 14: one row an operator (names: its GSTIN → the operator's name)
  [["clttx", "eco14a"], ["paytx", "eco14b"]].forEach(([k, id]) => ((full.supeco || {})[k] || []).forEach((x) => put(id, { etin: x.etin || "", name: nm[x.etin] || "", taxable: N(x.suppval), igst: N(x.igst), cgst: N(x.cgst), sgst: N(x.sgst), cess: N(x.cess) }, true)));
  // the amendment tables: the revised figures are the file's; the original ones the copy filed
  const was = {}; (amend || []).forEach((r) => { if (r.act === "skip" || !r.was) return; const w = r.was; was[r.kind + "|" + (w.ctin || "") + "|" + String(w.num || "")] = r; });
  const am = (id, kind, g, x, sg, extra) => {
    const r = was[kind + "|" + (g.ctin || "") + "|" + String(x.oinum || x.ont_num || "")], w = (r && r.was) || {};
    const base = Object.assign({ ctin: g.ctin || "", name: nm[g.ctin] || "", onum: x.oinum || x.ont_num || "", odt: dmyOf(x.oidt || x.ont_dt), otaxable: R(sg * N(w.txval)), otax: R(sg * (N(w.iamt) + N(w.camt) + N(w.samt) + N(w.csamt))),
      inum: x.inum || x.nt_num || "", idt: dmyOf(x.idt || x.nt_dt), val: N(x.val), pos: posName(x.pos || g.pos), what: r ? (r.changes || []).join("; ") : "" }, extra || {});
    const lines = (x.itms || []).map((i) => lineOf(itm(i))), s = lines.reduce((a, l) => addTo(a, l, sg), z5());
    const o = T[id]; o.rows.push(Object.assign(base, s, { rate: lines.map((l) => l.rate).join(", "), sign: sg })); o.n++; addTo(o.tot, s);
  };
  (full.b2ba || []).forEach((g) => (g.inv || []).forEach((x) => am("b2ba", "B2B", g, x, 1)));
  (full.b2cla || []).forEach((g) => (g.inv || []).forEach((x) => am("b2cla", "B2CL", g, x, 1)));
  (full.expa || []).forEach((g) => (g.inv || []).forEach((x) => am("expa", "EXP", g, x, 1)));
  (full.cdnra || []).forEach((g) => (g.nt || []).forEach((x) => am("cdnra", "CDNR", g, x, x.ntty === "C" ? -1 : 1, { ntty: NOTE_TYPE[x.ntty] || x.ntty })));
  (full.cdnura || []).forEach((x) => am("cdnura", "CDNUR", {}, x, x.ntty === "C" ? -1 : 1, { ntty: NOTE_TYPE[x.ntty] || x.ntty }));
  const b2csWas = {}; (amend || []).forEach((r) => { if (r.kind === "B2CS" && r.act !== "skip") b2csWas[r.P + "|" + r.b2cs.pos + "|" + r.b2cs.rt + "|" + r.b2cs.sply_ty] = r; });
  (full.b2csa || []).forEach((x) => (x.itms || []).forEach((i) => {
    const P = String(x.omon || "").slice(2) + String(x.omon || "").slice(0, 2), r = b2csWas[P + "|" + x.pos + "|" + N(i.rt) + "|" + x.sply_ty], y = +P.slice(0, 4), m = +P.slice(4, 6);
    const l = lineOf(i), o = T.b2csa;
    o.rows.push(Object.assign({ fy: m >= 4 ? y + "-" + String(y + 1).slice(2) : (y - 1) + "-" + String(y).slice(2), omon: P ? GSTR.label(P) : "", pos: posName(x.pos), typ: x.typ || "OE", otaxable: r ? N(r.was.txval) : 0 }, l));
    o.n++; addTo(o.tot, l);
  }));
  return T;
}
// the tables with something in them, in the portal's order
// (14(b), always empty, beside 14(a); ecoMore: sales through an operator whose GSTIN is not known, which open 14(a) too)
export const r1Present = (T, ecoMore) => R1_TABLES.filter((t) => T[t.id] && (T[t.id].rows.length > 0 || (t.eco && (ecoMore || T.eco14a.rows.length > 0))));

// the portal's summary: one row per table, the B2B tables together (as the portal's "4A, 4B, 6B, 6C" tile)
export function r1SummaryRows(T) {
  return r1Present(T).filter((t) => T[t.id].rows.length > 0).map((t) => ({ k: t.id, t, n: T[t.id].n, late: T[t.id].late, ...T[t.id].tot }));
}

/* ---------------------------------------------------------------- GSTR-3B */

const V = (o, k) => (o && o[k] != null ? N(o[k]) : 0);
const row5 = (o, f) => ({ taxable: f && f.noTaxable ? null : V(o, "taxable"), igst: V(o, "igst"), cgst: V(o, "cgst"), sgst: V(o, "sgst"), cess: V(o, "cess") });

// the portal's GSTR-3B: tables of rows {id, label, ...figures}; t is GSTR.threeB, j GSTR.threeBJson (for the 4(A)(3) check)
export function r3bTables(t, j) {
  const isrc = j ? ((j.itc_elg || {}).itc_avl || []).find((x) => x.ty === "ISRC") : null;
  const A3 = row5(t.rcmIn);
  const fileDiff = isrc && (Math.abs(N(isrc.iamt) - A3.igst) > 0.004 || Math.abs(N(isrc.camt) - A3.cgst) > 0.004 || Math.abs(N(isrc.samt) - A3.sgst) > 0.004 || Math.abs(N(isrc.csamt) - A3.cess) > 0.004)
    ? { igst: N(isrc.iamt), cgst: N(isrc.camt), sgst: N(isrc.samt), cess: N(isrc.csamt) } : null;
  const P = t.pay || { use: {}, cash: {}, rcmCash: {} };
  const H4 = ["igst", "cgst", "sgst", "cess"];
  return [
    { id: "3.1", title: "3.1 Details of Outward Supplies and inward supplies liable to reverse charge (other than those covered by Table 3.1.1)", head: ["Nature of Supplies", "Total Taxable value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"], cols: HEADS,
      rows: [
        { id: "3.1a", label: "(a) Outward taxable supplies (other than zero rated, nil rated and exempted)", ...row5(t.net) },
        { id: "3.1b", label: "(b) Outward taxable supplies (zero rated)", ...row5(t.zero) },
        { id: "3.1c", label: "(c) Other outward supplies (Nil rated, exempted)", ...row5(t.nil) },
        { id: "3.1d", label: "(d) Inward supplies (liable to reverse charge)", ...row5(t.rcmOut) },
        { id: "3.1e", label: "(e) Non-GST outward supplies", ...row5(t.nongst) },
      ] },
    { id: "3.1.1", title: "3.1.1 Details of Supplies notified under section 9(5) of the CGST Act, 2017 and corresponding provisions in IGST/UTGST/SGST Acts", head: ["Nature of Supplies", "Total Taxable value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"], cols: HEADS,
      note: "FinCom does not work these out: the GSTR-3B JSON leaves them empty.", none: true,
      rows: [
        { id: "3.1.1i", label: "(i) Taxable supplies on which electronic commerce operator pays tax u/s 9(5) [to be furnished by the electronic commerce operator]", ...row5({}) },
        { id: "3.1.1ii", label: "(ii) Taxable supplies made by the registered person through electronic commerce operator, on which electronic commerce operator is required to pay tax u/s 9(5) [to be furnished by the registered person making supplies through electronic commerce operator]", ...row5({}) },
      ] },
    { id: "3.2", title: "3.2 Of the supplies shown in 3.1 (a) above, details of inter-State supplies made to unregistered persons, composition taxable persons and UIN holders",
      head: ["Place of Supply (State/UT)", "Total Taxable value", "Amount of Integrated Tax", "Total Taxable value", "Amount of Integrated Tax", "Total Taxable value", "Amount of Integrated Tax"],
      groups: [["", 1], ["Supplies made to Unregistered Persons", 2], ["Supplies made to Composition Taxable Persons", 2], ["Supplies made to UIN holders", 2]],
      cols: ["taxable", "igst", "ctaxable", "cigst", "utaxable", "uigst"],
      rows: (t.unregPos || []).map((x) => ({ id: "3.2|" + x.pos, label: posName(x.pos), taxable: N(x.taxable), igst: N(x.igst), ctaxable: 0, cigst: 0, utaxable: 0, uigst: 0 })) },
    { id: "4", title: "4. Eligible ITC", head: ["Details", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"], cols: H4,
      rows: [
        { id: "4A", label: "A. ITC Available (whether in full or part)", group: true },
        { id: "4A1", label: "(1) Import of goods", ...row5(t.impGoods), value: V(t.impGoods, "taxable") },
        { id: "4A2", label: "(2) Import of services", ...row5(t.impServ), value: V(t.impServ, "taxable") },
        { id: "4A3", label: "(3) Inward supplies liable to reverse charge (other than 1 & 2 above)", ...A3, value: V(t.rcmIn, "taxable"), fileDiff },
        { id: "4A4", label: "(4) Inward supplies from ISD", ...row5({}) },
        { id: "4A5", label: "(5) All other ITC", ...row5(t.other), value: V(t.other, "taxable") },
        { id: "4B", label: "B. ITC Reversed", group: true },
        { id: "4B1", label: "(1) As per rules 38, 42 & 43 of CGST Rules and section 17(5)", ...row5(t.rev1) },
        { id: "4B2", label: "(2) Others", ...row5(t.rev2), typed: "rev2" },
        { id: "4C", label: "C. Net ITC Available (A-B)", ...row5(t.netItc), total: true },
        { id: "4D", label: "(D) Other Details", group: true },
        { id: "4D1", label: "(1) ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period", ...row5(t.reclaim), typed: "reclaim" },
        { id: "4D2", label: "(2) Ineligible ITC under section 16(4) & ITC restricted due to PoS rules", ...row5(t.na) },
      ] },
    { id: "5", title: "5. Values of exempt, nil-rated and non-GST inward supplies", head: ["Nature of supplies", "Inter-State supplies", "Intra-State supplies"], cols: ["inter", "intra"],
      rows: [
        { id: "5gst", label: "From a supplier under composition scheme, Exempt and Nil rated supply", inter: V(t.inw5, "gstInter"), intra: V(t.inw5, "gstIntra") },
        { id: "5ng", label: "Non GST supply", inter: V(t.inw5, "ngInter"), intra: V(t.inw5, "ngIntra") },
      ] },
    { id: "5.1", title: "5.1 Interest & late fee payable", head: ["Details", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess"], cols: H4, none: true,
      note: "Not worked out from the books: check the portal's figures (interest and late fee) before paying.",
      rows: [{ id: "5.1int", label: "Interest", ...row5({}) }, { id: "5.1fee", label: "Late Fees", ...row5({}) }] },
    { id: "6.1", title: "6.1 Payment of tax", head: ["Description", "Total tax payable", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess", "Tax paid in cash", "Interest paid in cash", "Late fee paid in cash"],
      groups: [["", 2], ["Tax paid through ITC", 4], ["", 3]],
      cols: ["payable", "ui", "uc", "us", "ucs", "cash", "int", "fee"],
      rows: [{ id: "6.1A", label: "(A) Other than reverse charge", group: true }].concat(H4.map((k) => ({ id: "6.1A|" + k, label: { igst: "Integrated Tax", cgst: "Central Tax", sgst: "State/UT Tax", cess: "Cess" }[k], head: k,
        payable: V(t.net, k), ui: V(P.use.igst, k), uc: V(P.use.cgst, k), us: V(P.use.sgst, k), ucs: V(P.use.cess, k), cash: R(V(P.cash, k) - V(P.rcmCash, k)), int: 0, fee: 0 })),
      [{ id: "6.1B", label: "(B) Reverse charge", group: true }], H4.map((k) => ({ id: "6.1B|" + k, label: { igst: "Integrated Tax", cgst: "Central Tax", sgst: "State/UT Tax", cess: "Cess" }[k], head: k,
        payable: V(t.rcmOut, k), ui: 0, uc: 0, us: 0, ucs: 0, cash: V(P.rcmCash, k), int: 0, fee: 0 }))) },
  ];
}

// the bills behind a 3B figure: the same tests on the same rows as GSTR.threeBm (src/js/12), and what is added to them.
// {bills: [{…row, sg}], adj: [{label, …5 heads}], figure, sum}: the bills (signed) plus adj add up to the figure
export function r3bBills(id, ym, reg, t) {
  const out = GSTR.outward(ym, reg), inn = GSTR.inward(ym, reg).map((r) => GSTR.signedIn(r));
  const S5 = (o) => ({ taxable: V(o, "taxable"), igst: V(o, "igst"), cgst: V(o, "cgst"), sgst: V(o, "sgst"), cess: V(o, "cess") });
  const neg = (o) => { const x = S5(o); HEADS.forEach((k) => { x[k] = -x[k]; }); return x; };
  let bills = [], adj = [], figure = null;
  const B = (rows, sg = 1) => rows.map((r) => Object.assign({}, r, { sg }));
  const A = (label, o) => { const x = S5(o); if (HEADS.some((k) => Math.abs(x[k]) > 0.004)) adj.push(Object.assign({ label }, x)); };
  switch (id) {
    case "3.1a": {
      bills = B(out.filter((r) => r.cls === "taxable" && r.kind !== "CDNR")).concat(B(out.filter((r) => r.kind === "CDNR"), -1));
      A("Tax on advances, 11A less 11B", t.adv);
      if (t.custRej) { A("Our credit notes rejected by customers in IMS", t.custRej.add); A("Of those, accepted later", neg(t.custRej.back)); }
      if (t.amend) A("Amendments of earlier months (9A, 9C, 10)", t.amend.out);
      figure = S5(t.net); break; }
    case "3.1b": bills = B(out.filter((r) => r.cls === "export" || r.cls === "sez")); if (t.amend) A("Amendments of earlier months (9A, 9C, 10)", t.amend.zero); figure = S5(t.zero); break;
    case "3.1c": bills = B(out.filter((r) => r.cls === "exempt" || r.cls === "nil")); figure = S5(t.nil); break;
    case "3.1d": bills = B(inn.filter((r) => r.rcm || (r.import && r.supply !== "Goods"))); figure = S5(t.rcmOut); break;
    case "3.1e": bills = B(out.filter((r) => r.cls === "nongst")); figure = S5(t.nongst); break;
    case "4A1": bills = B(inn.filter((r) => r.import && r.supply === "Goods")); figure = S5(t.impGoods); break;
    case "4A2": bills = B(inn.filter((r) => r.import && r.supply !== "Goods")); figure = S5(t.impServ); break;
    case "4A3": bills = B(inn.filter((r) => r.rcm && !r.import)); figure = S5(t.rcmIn); break;
    case "4A5": {
      bills = B(inn.filter((r) => !r.import && !r.rcm));
      if (t.basis === "2b") {
        A("Held back: not yet in 2B (or more tax in Tally than in 2B)", neg(t.held)); A("Taken now: booked earlier, in this month's 2B", t.released);
        A("Suppliers' credit notes in 2B, not in Tally", neg(t.cn2b)); A("Credit notes rejected in IMS, not reducing credit", t.rejBack);
      }
      A("ITC reclaimed (shown again in 4(D)(1))", t.reclaim);
      figure = S5(t.other); figure.taxable = V(t.other, "taxable"); break; }
    case "4B1": bills = B(inn.filter((r) => r.blocked)); A("Rules 42 and 43", t.rules); figure = S5(t.rev1); break;
    case "4B2": if (t.r37) A("Rule 37: unpaid after 180 days", t.r37.rev); A("Typed in FinCom", { igst: V(t.rev2, "igst") - V(t.r37 && t.r37.rev, "igst"), cgst: V(t.rev2, "cgst") - V(t.r37 && t.r37.rev, "cgst"), sgst: V(t.rev2, "sgst") - V(t.r37 && t.r37.rev, "sgst"), cess: V(t.rev2, "cess") - V(t.r37 && t.r37.rev, "cess") }); figure = S5(t.rev2); break;
    case "4D1": if (t.r37) A("Rule 37: paid, credit reclaimed", t.r37.re); A("Typed in FinCom", { igst: V(t.reclaim, "igst") - V(t.r37 && t.r37.re, "igst"), cgst: V(t.reclaim, "cgst") - V(t.r37 && t.r37.re, "cgst"), sgst: V(t.reclaim, "sgst") - V(t.r37 && t.r37.re, "sgst"), cess: V(t.reclaim, "cess") - V(t.r37 && t.r37.re, "cess") }); figure = S5(t.reclaim); break;
    case "4D2": {
      (typeof GST2B === "object" ? GST2B.all2b(reg) : []).filter((z) => z.ym === ym).forEach((z) => z.rows.filter((r) => r.itcavl === "N" && !r.rej).forEach((r) => bills.push(Object.assign({}, r, { sg: r.dir || 1, from2b: true }))));
      figure = S5(t.na); break; }
    default: return null;
  }
  // the 4 tables carry no value: only the tax is compared
  const heads = /^4/.test(id) ? ["igst", "cgst", "sgst", "cess"] : HEADS;
  const sum = z5(); bills.forEach((r) => addTo(sum, r, r.sg)); adj.forEach((a) => addTo(sum, a));
  const off = heads.filter((k) => Math.abs(R(sum[k] - V(figure, k))) > 0.01);
  return { id, bills, adj, figure, sum, heads, off };
}
export const R3B_CLICK = new Set(["3.1a", "3.1b", "3.1c", "3.1d", "3.1e", "4A1", "4A2", "4A3", "4A5", "4B1", "4B2", "4D1", "4D2"]);

/* ---------------------------------------------------------------- GSTR-2B */

// the portal's 2B sections, Part A (credit) and Part B (credit notes that reduce it) — what FinCom reads of the JSON
export const TWOB_SECTIONS = [
  { id: "b2b", part: "A", name: "B2B", title: "B2B – Invoices", what: "Supplies from registered persons" },
  { id: "b2ba", part: "A", name: "B2BA", title: "B2BA – Amendments to previously filed invoices by supplier" },
  { id: "cdnr", part: "A", name: "CDNR", title: "CDNR – Debit/Credit notes (Original)" },
  { id: "cdnra", part: "A", name: "CDNRA", title: "CDNRA – Amendments to previously filed Credit/Debit notes by supplier" },
  { id: "ecom", part: "A", name: "ECO", title: "ECO – Documents reported by ECO on which ECO is liable to pay tax u/s 9(5)" },
  { id: "isd", part: "A", name: "ISD", title: "ISD – ISD Credits" },
  { id: "isda", part: "A", name: "ISDA", title: "ISDA – Amendments to ISD Credits" },
  { id: "impg", part: "A", name: "IMPG", title: "IMPG – Import of goods from overseas on bill of entry" },
  { id: "impgsez", part: "A", name: "IMPGSEZ", title: "IMPGSEZ – Import of goods from SEZ units/developers on bill of entry" },
];
// the 2B summary, as its PDF lays it out: the credit available (Part A: credit; Part B: credit notes, reversal) and the
// credit not available, each with the 3B table it goes to and the sections in it. rows: GST2B rows of the 2B(s)
export function twoBSummary(rows) {
  const pick = (f) => { const o = Object.assign(z5(), { n: 0 }); rows.filter(f).forEach((r) => { addTo(o, r, r.dir || 1); o.n++; }); return o; };
  const avl = (r) => r.itcavl !== "N" && !r.rej, nav = (r) => r.itcavl === "N" && !r.rej;
  const deb = (r) => (r.dir || 1) > 0, cr = (r) => (r.dir || 1) < 0;
  const L = (label, f, sec) => ({ label, sec, ...pick(f) });
  const block = (ok) => [
    { head: "Part A", part: "A", rows: [
      { group: "I", label: "All other ITC – Supplies from registered persons", t3b: ok ? "4(A)(5)" : "4(D)(2)", lines: [
        L("B2B – Invoices", (r) => ok(r) && r.sec === "b2b" && !r.rcm, "b2b"), L("B2B – Debit notes", (r) => ok(r) && r.sec === "cdnr" && deb(r) && !r.rcm, "cdnr"),
        L("ECO – Documents", (r) => ok(r) && r.sec === "ecom", "ecom"),
        L("B2B – Invoices (Amendment)", (r) => ok(r) && r.sec === "b2ba" && !r.rcm, "b2ba"), L("B2B – Debit notes (Amendment)", (r) => ok(r) && r.sec === "cdnra" && deb(r) && !r.rcm, "cdnra")] },
      { group: "II", label: "Inward Supplies from ISD", t3b: ok ? "4(A)(4)" : "4(D)(2)", lines: [L("ISD – Invoices", (r) => ok(r) && r.sec === "isd" && deb(r), "isd"), L("ISD – Invoices (Amendment)", (r) => ok(r) && r.sec === "isda" && deb(r), "isda")] },
      { group: "III", label: "Inward Supplies liable for reverse charge", t3b: ok ? "3.1(d), 4(A)(3)" : "3.1(d)", lines: [
        L("B2B – Invoices", (r) => ok(r) && r.sec === "b2b" && r.rcm, "b2b"), L("B2B – Debit notes", (r) => ok(r) && r.sec === "cdnr" && deb(r) && r.rcm, "cdnr"),
        L("B2B – Invoices (Amendment)", (r) => ok(r) && r.sec === "b2ba" && r.rcm, "b2ba"), L("B2B – Debit notes (Amendment)", (r) => ok(r) && r.sec === "cdnra" && deb(r) && r.rcm, "cdnra")] },
    ].concat(ok === avl ? [{ group: "IV", label: "Import of Goods", t3b: "4(A)(1)", lines: [L("IMPG – Import of goods from overseas", (r) => ok(r) && r.sec === "impg", "impg"), L("IMPGSEZ – Import of goods from SEZ", (r) => ok(r) && r.sec === "impgsez", "impgsez")] }] : []) },
    { head: "Part B", part: "B", rows: [
      { group: "I", label: "Others", t3b: "", lines: [
        L("B2B – Credit notes", (r) => ok(r) && r.sec === "cdnr" && cr(r) && !r.rcm, "cdnr"), L("B2B – Credit notes (Amendment)", (r) => ok(r) && r.sec === "cdnra" && cr(r) && !r.rcm, "cdnra"),
        L("B2B – Credit notes (Reverse charge)", (r) => ok(r) && r.sec === "cdnr" && cr(r) && r.rcm, "cdnr"), L("B2B – Credit notes (Reverse charge) (Amendment)", (r) => ok(r) && r.sec === "cdnra" && cr(r) && r.rcm, "cdnra"),
        L("ISD – Credit notes", (r) => ok(r) && r.sec === "isd" && cr(r), "isd"), L("ISD – Credit notes (Amendment)", (r) => ok(r) && r.sec === "isda" && cr(r), "isda")] },
    ] },
  ];
  const total = (f) => pick(f);
  return { available: block(avl), notAvailable: block(nav), rejected: pick((r) => r.rej), totAvl: total(avl), totNav: total(nav) };
}
export function twoBRows(reg, months) {
  const all = typeof GST2B === "object" ? GST2B.all2b(reg) : [];
  return all.filter((z) => !months || months.includes(z.ym)).flatMap((z) => z.rows);
}

if (typeof window !== "undefined") window.GSTPortal = Object.assign(window.GSTPortal || {}, { R1_TABLES, r1Portal, r1Present, r1SummaryRows, r3bTables, r3bBills, R3B_CLICK, TWOB_SECTIONS, twoBSummary, twoBRows, posName, colsOf });
