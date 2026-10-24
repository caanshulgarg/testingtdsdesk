// The GSTR-1 Excel (next-gstr1-excel; the owner, 24-Oct-2026: "prepare this type of download and upload return in GSTR-1
// .. user can add or delete or modify the details" and "it should be dynamic.. add, delete or modify"). The month's return
// in the portal's own tables, a sheet a table with the offline tool's sheet names and column heads, each sheet one Excel
// Table (so a row typed under the last joins it and the totals take it at once):
//   - every field open: GSTIN/UIN, receiver name, number, date, value, place of supply, reverse charge, invoice type, rate,
//     taxable value, the tax heads, cess, e-commerce GSTIN, HSN, UQC, quantity...; lists (data validation, to the last
//     spare row) for place of supply, rate, invoice type, reverse charge, note type, UQC and the other coded fields;
//   - a hidden Key column: the line of the books a row is (blank: a row added in Excel);
//   - worked out by formulas, row by row (structured references, so deleting or inserting rows never breaks them): the
//     state from the GSTIN's first two digits, a Check (tax against taxable × rate, the value against taxable + tax, the
//     place of supply against the GSTIN's state); on the 2,000 spare rows the tax itself (IGST, or CGST and SGST, from the
//     place of supply against the registration's state and taxable × rate) — a row of the books keeps the books' tax to
//     the paisa, and its Check says when a change no longer fits it;
//   - "Summary": each table's rows and totals per tax head by formulas over the tables (a credit note less), the HSN
//     summary against tables 4 to 9, documents issued against the invoices listed; "About": the client, GSTIN and month.
// No macros; only functions Excel, LibreOffice and Google Sheets all have. Brought back (read), the file is checked and
// shown as a preview (app/src/lib/gstr1Fix.js, R1Fix.preview) before anything is applied.
//   make(ym, reg) -> {buffer, name}; download(ym, reg); read(file|buffer) -> {meta, tables: {t: [{row, key, f}]}, summary}
const G = globalThis;
const VERSION = "fincom-gstr1-1";
const NF = "#,##0.00;[Red]-#,##0.00";
const SPARE_BIG = 2000, SPARE_SMALL = 100;
const STATE_NAMES = () => { const o = {}; Object.keys(G.STATE_CODES || {}).forEach((k) => { o[G.STATE_CODES[k]] = k.toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase()); }); o["96"] = "Foreign Country"; o["97"] = "Other Territory"; return o; };
export const posLabel = (c) => { const s = String(c == null ? "" : c).padStart(2, "0"); return c === "" || c == null ? "" : s + "-" + (STATE_NAMES()[s] || ""); };
const INV_TYPE = [["R", "Regular B2B"], ["SEWP", "SEZ supplies with payment"], ["SEWOP", "SEZ supplies without payment"], ["DE", "Deemed Exp"], ["CBW", "Intra-State supplies attracting IGST"]];
const NIL = [["INTRB2B", "Inter-State supplies to registered persons"], ["INTRAB2B", "Intra-State supplies to registered persons"], ["INTRB2C", "Inter-State supplies to unregistered persons"], ["INTRAB2C", "Intra-State supplies to unregistered persons"]];
const DOCN = [[1, "Invoices for outward supply"], [2, "Invoices for inward supply from unregistered person"], [3, "Revised Invoice"], [4, "Debit Note"], [5, "Credit Note"], [6, "Receipt voucher"], [7, "Payment Voucher"], [8, "Refund voucher"],
  [9, "Delivery Challan for job work"], [10, "Delivery Challan for supply on approval"], [11, "Delivery Challan in case of liquid gas"], [12, "Delivery Challan in cases other than by way of supply (excluding at S no. 9 to 11)"]];
// lists: [the Lists sheet's column, the values]
const LISTS = () => {
  const st = STATE_NAMES(), pos = Object.keys(st).sort().map((c) => c + "-" + st[c]);
  return { pos: ["A", pos], rate: ["B", G.R1Fix.RATES().map(String)], yn: ["C", ["Y", "N"]], invtyp: ["D", INV_TYPE.map((x) => x[1])], uqc: ["E", G.R1Fix.UQC], ntty: ["F", ["C", "D"]], diff: ["G", ["65%"]],
    exptyp: ["I", ["WPAY", "WOPAY"]], urtyp: ["J", ["B2CL", "EXPWP", "EXPWOP"]], b2cstyp: ["K", ["OE", "E"]], nil: ["L", NIL.map((x) => x[1])], docn: ["M", DOCN.map((x) => x[1])] };
};
const REG = "Lists!$H$1";
// a column: [field, heading, options] — n number, d date (dd-mm-yyyy text), l list, w width, calc a formula on every row,
// auto a formula on the spare rows only (the books' rows carry their own value)
const C = (f, h, o) => Object.assign({ f, h }, o || {});
const TAX = (auto) => [C("txval", "Taxable Value", { n: 1, w: 14 }), C("iamt", "Integrated Tax", { n: 1, auto: auto && "i" }), C("camt", "Central Tax", { n: 1, auto: auto && "c" }), C("samt", "State/UT Tax", { n: 1, auto: auto && "c" }), C("csamt", "Cess Amount", { n: 1 })];
const RT = C("rt", "Rate", { n: 1, l: "rate", w: 7 }), DIFF = C("diff_percent", "Applicable % of Tax Rate", { l: "diff", w: 10 }), POS = C("pos", "Place Of Supply", { l: "pos", w: 20 });
const CHK = C("chk", "Check (worked out)", { calc: "chk", w: 26 });
const GST_ST = C("gst_st", "State (from GSTIN)", { calc: "st", w: 9 });
export const SHEETS = [
  { t: "b2b", sheet: "b2b,sez,de", no: "4A, 4B, 6B, 6C", name: "B2B, SEZ, DE Invoices", spare: SPARE_BIG, inter: "b2b", cols: [C("ctin", "GSTIN/UIN of Recipient", { w: 18 }), GST_ST, C("name", "Receiver Name", { w: 26 }), C("inum", "Invoice Number", { w: 16 }), C("idt", "Invoice date", { d: 1, w: 11 }),
    C("val", "Invoice Value", { n: 1, w: 14 }), POS, C("rchrg", "Reverse Charge", { l: "yn", w: 8 }), DIFF, C("inv_typ", "Invoice Type", { l: "invtyp", w: 20 }), C("etin", "E-Commerce GSTIN", { w: 17 }), RT].concat(TAX(true), [CHK]) },
  { t: "b2cl", sheet: "b2cl", no: "5", name: "B2C (Large) Invoices", spare: SPARE_BIG, inter: "always", cols: [C("inum", "Invoice Number", { w: 16 }), C("idt", "Invoice date", { d: 1, w: 11 }), C("val", "Invoice Value", { n: 1, w: 14 }), POS, DIFF, RT].concat(TAX(true), [C("etin", "E-Commerce GSTIN", { w: 17 }), CHK]) },
  { t: "exp", sheet: "exp", no: "6A", name: "Exports Invoices", spare: SPARE_BIG, inter: "exp", cols: [C("exp_typ", "Export Type", { l: "exptyp", w: 9 }), C("inum", "Invoice Number", { w: 16 }), C("idt", "Invoice date", { d: 1, w: 11 }), C("val", "Invoice Value", { n: 1, w: 14 }),
    C("sbpcode", "Port Code", { w: 9 }), C("sbnum", "Shipping Bill Number", { w: 12 }), C("sbdt", "Shipping Bill Date", { w: 11 }), RT].concat(TAX(true), [CHK]) },
  { t: "b2cs", sheet: "b2cs", no: "7", name: "B2C (Others)", spare: SPARE_BIG, inter: "pos", cols: [C("typ", "Type", { l: "b2cstyp", w: 6 }), POS, DIFF, RT].concat(TAX(true), [C("etin", "E-Commerce GSTIN", { w: 17 }), CHK]) },
  { t: "nil", sheet: "exemp", no: "8A, 8B, 8C, 8D", name: "Nil Rated, Exempted and Non-GST Supplies", spare: 8, cols: [C("sply_ty", "Description", { l: "nil", w: 44 }), C("nil_amt", "Nil Rated Supplies", { n: 1, w: 16 }), C("expt_amt", "Exempted (other than nil rated/non GST supply)", { n: 1, w: 18 }), C("ngsup_amt", "Non-GST Supplies", { n: 1, w: 16 })] },
  { t: "cdnr", sheet: "cdnr", no: "9B", name: "Credit / Debit Notes (Registered)", spare: SPARE_BIG, inter: "b2b", cols: [C("ctin", "GSTIN/UIN of Recipient", { w: 18 }), GST_ST, C("name", "Receiver Name", { w: 26 }), C("nt_num", "Note Number", { w: 16 }), C("nt_dt", "Note Date", { d: 1, w: 11 }),
    C("ntty", "Note Type", { l: "ntty", w: 7 }), POS, C("rchrg", "Reverse Charge", { l: "yn", w: 8 }), C("inv_typ", "Note Supply Type", { l: "invtyp", w: 20 }), C("val", "Note Value", { n: 1, w: 14 }), DIFF, RT].concat(TAX(true), [CHK]) },
  { t: "cdnur", sheet: "cdnur", no: "9B", name: "Credit / Debit Notes (Unregistered)", spare: SPARE_BIG, inter: "always", cols: [C("typ", "UR Type", { l: "urtyp", w: 9 }), C("nt_num", "Note Number", { w: 16 }), C("nt_dt", "Note Date", { d: 1, w: 11 }), C("ntty", "Note Type", { l: "ntty", w: 7 }), POS,
    C("val", "Note Value", { n: 1, w: 14 }), DIFF, RT].concat(TAX(true), [CHK]) },
  { t: "b2ba", sheet: "b2ba", no: "9A", name: "Amended B2B Invoices", spare: 0, amend: true, cols: [C("ctin", "GSTIN/UIN of Recipient", { w: 18 }), C("name", "Receiver Name", { w: 24 }), C("oinum", "Original Invoice Number", { w: 16 }), C("oidt", "Original Invoice date", { d: 1, w: 11 }),
    C("inum", "Revised Invoice Number", { w: 16 }), C("idt", "Revised Invoice date", { d: 1, w: 11 }), C("val", "Invoice Value", { n: 1 }), POS, C("rchrg", "Reverse Charge", { l: "yn" }), DIFF, C("inv_typ", "Invoice Type", { l: "invtyp", w: 20 }), RT].concat(TAX(false), [CHK]) },
  { t: "b2cla", sheet: "b2cla", no: "9A", name: "Amended B2C (Large) Invoices", spare: 0, amend: true, cols: [C("oinum", "Original Invoice Number", { w: 16 }), C("oidt", "Original Invoice date", { d: 1, w: 11 }), POS, C("inum", "Revised Invoice Number", { w: 16 }), C("idt", "Revised Invoice date", { d: 1, w: 11 }),
    C("val", "Invoice Value", { n: 1 }), DIFF, RT].concat(TAX(false), [CHK]) },
  { t: "expa", sheet: "expa", no: "9A", name: "Amended Exports Invoices", spare: 0, amend: true, cols: [C("exp_typ", "Export Type", { l: "exptyp" }), C("oinum", "Original Invoice Number", { w: 16 }), C("oidt", "Original Invoice date", { d: 1, w: 11 }), C("inum", "Revised Invoice Number", { w: 16 }),
    C("idt", "Revised Invoice date", { d: 1, w: 11 }), C("val", "Invoice Value", { n: 1 }), C("sbpcode", "Port Code"), C("sbnum", "Shipping Bill Number"), C("sbdt", "Shipping Bill Date"), RT].concat(TAX(false), [CHK]) },
  { t: "cdnra", sheet: "cdnra", no: "9C", name: "Amended Credit/Debit Notes (Registered)", spare: 0, amend: true, cols: [C("ctin", "GSTIN/UIN of Recipient", { w: 18 }), C("name", "Receiver Name", { w: 24 }), C("ont_num", "Original Note Number", { w: 16 }), C("ont_dt", "Original Note Date", { d: 1, w: 11 }),
    C("nt_num", "Revised Note Number", { w: 16 }), C("nt_dt", "Revised Note Date", { d: 1, w: 11 }), C("ntty", "Note Type", { l: "ntty" }), POS, C("rchrg", "Reverse Charge", { l: "yn" }), C("inv_typ", "Note Supply Type", { l: "invtyp", w: 20 }), C("val", "Note Value", { n: 1 }), RT].concat(TAX(false), [CHK]) },
  { t: "cdnura", sheet: "cdnura", no: "9C", name: "Amended Credit/Debit Notes (Unregistered)", spare: 0, amend: true, cols: [C("typ", "UR Type", { l: "urtyp" }), C("ont_num", "Original Note Number", { w: 16 }), C("ont_dt", "Original Note Date", { d: 1, w: 11 }), C("nt_num", "Revised Note Number", { w: 16 }),
    C("nt_dt", "Revised Note Date", { d: 1, w: 11 }), C("ntty", "Note Type", { l: "ntty" }), POS, C("val", "Note Value", { n: 1 }), RT].concat(TAX(false), [CHK]) },
  { t: "b2csa", sheet: "b2csa", no: "10", name: "Amended B2C (Others)", spare: 0, amend: true, cols: [C("omon", "Original Month (MMYYYY)", { w: 10 }), POS, C("typ", "Type", { l: "b2cstyp" }), DIFF, RT].concat(TAX(false), [CHK]) },
  { t: "at", sheet: "at", no: "11A(1), 11A(2)", name: "Tax Liability (Advances Received)", spare: SPARE_SMALL, adv: true, inter: "pos", cols: [POS, DIFF, RT, C("txval", "Gross Advance Received", { n: 1, w: 14 }), C("iamt", "Integrated Tax", { n: 1, auto: "i" }), C("camt", "Central Tax", { n: 1, auto: "c" }), C("samt", "State/UT Tax", { n: 1, auto: "c" }), C("csamt", "Cess Amount", { n: 1 }), CHK] },
  { t: "txpd", sheet: "atadj", no: "11B(1), 11B(2)", name: "Adjustment of Advances", spare: SPARE_SMALL, adv: true, inter: "pos", cols: [POS, DIFF, RT, C("txval", "Gross Advance Adjusted", { n: 1, w: 14 }), C("iamt", "Integrated Tax", { n: 1, auto: "i" }), C("camt", "Central Tax", { n: 1, auto: "c" }), C("samt", "State/UT Tax", { n: 1, auto: "c" }), C("csamt", "Cess Amount", { n: 1 }), CHK] },
  { t: "hsnb2b", sheet: "hsn(b2b)", no: "12", name: "HSN-wise summary · B2B", spare: SPARE_BIG, split: true, cols: [C("hsn_sc", "HSN", { w: 10 }), C("desc", "Description", { w: 26 }), C("uqc", "UQC", { l: "uqc", w: 7 }), C("qty", "Total Quantity", { n: 1, w: 10 }), RT].concat(TAX(false), [CHK]) },
  { t: "hsnb2c", sheet: "hsn(b2c)", no: "12", name: "HSN-wise summary · B2C", spare: SPARE_BIG, split: true, cols: [C("hsn_sc", "HSN", { w: 10 }), C("desc", "Description", { w: 26 }), C("uqc", "UQC", { l: "uqc", w: 7 }), C("qty", "Total Quantity", { n: 1, w: 10 }), RT].concat(TAX(false), [CHK]) },
  { t: "hsn", sheet: "hsn", no: "12", name: "HSN-wise summary", spare: SPARE_BIG, split: false, cols: [C("hsn_sc", "HSN", { w: 10 }), C("desc", "Description", { w: 26 }), C("uqc", "UQC", { l: "uqc", w: 7 }), C("qty", "Total Quantity", { n: 1, w: 10 }), RT].concat(TAX(false), [CHK]) },
  { t: "docs", sheet: "docs", no: "13", name: "Documents Issued", spare: SPARE_SMALL, cols: [C("doc_num", "Nature of Document", { l: "docn", w: 40 }), C("from", "Sr. No. From", { w: 16 }), C("to", "Sr. No. To", { w: 16 }), C("totnum", "Total Number", { n: 1, w: 10 }), C("cancel", "Cancelled", { n: 1, w: 10 }), C("net_issue", "Net Issued", { calc: "net", w: 10 })] },
  { t: "eco14a", sheet: "eco", no: "14(a)", name: "Supplies through E-Commerce Operators (u/s 52)", spare: SPARE_SMALL, eco: true, cols: [C("etin", "GSTIN of E-Commerce Operator", { w: 18 }), C("suppval", "Net value of supplies", { n: 1, w: 14 }), C("igst", "Integrated tax", { n: 1 }), C("cgst", "Central tax", { n: 1 }), C("sgst", "State/UT tax", { n: 1 }), C("cess", "Cess", { n: 1 })] },
];
export const SHEET_OF = Object.fromEntries(SHEETS.map((s) => [s.t, s]));
const tn = (s) => "T_" + s.t;                                   // the Excel Table's name
const allCols = (s) => [C("key", "Key (do not change)", { w: 6 })].concat(s.cols);
// a structured reference to this row's cell of a column, by its field
const ref = (s, f) => { const c = allCols(s).find((x) => x.f === f); return c ? tn(s) + "[[#This Row],[" + c.h.replace(/([\[\]#'])/g, "'$1") + "]]" : '""'; };
const colRef = (s, f) => { const c = allCols(s).find((x) => x.f === f); return c ? tn(s) + "[" + c.h.replace(/([\[\]#'])/g, "'$1") + "]" : null; };
function interF(s) {
  const P = "LEFT(" + ref(s, "pos") + ",2)<>" + REG;
  if (s.inter === "always") return "TRUE";
  if (s.inter === "exp") return "TRUE";
  if (s.inter === "pos") return P;
  const T = ref(s, "inv_typ");
  return "OR(" + P + "," + T + '="SEZ supplies with payment",' + T + '="SEZ supplies without payment",' + T + '="Intra-State supplies attracting IGST")';
}
function formula(s, c) {
  const tv = ref(s, "txval"), rt = ref(s, "rt"), fac = allCols(s).some((x) => x.f === "diff_percent") ? "IF(" + ref(s, "diff_percent") + '="",1,0.65)' : "1";
  const blank = "OR(" + tv + '="",' + rt + '="")';
  if (c.auto === "i") return "IF(" + blank + ',"",IF(' + interF(s) + (s.inter === "exp" ? ",IF(" + ref(s, "exp_typ") + '="WOPAY",0,ROUND(' + tv + "*" + rt + "/100*" + fac + ",2))" : ",ROUND(" + tv + "*" + rt + "/100*" + fac + ",2)") + ",0))";
  if (c.auto === "c") return "IF(" + blank + ',"",IF(' + interF(s) + ",0,ROUND(" + tv + "*" + rt + "/200*" + fac + ",2)))";
  if (c.calc === "st") return "IF(" + ref(s, "ctin") + '="","",LEFT(' + ref(s, "ctin") + ",2))";
  if (c.calc === "net") return "IF(" + ref(s, "totnum") + '="","",N(' + ref(s, "totnum") + ")-N(" + ref(s, "cancel") + "))";
  if (c.calc === "chk") {
    const tax = "N(" + ref(s, "iamt") + ")+N(" + ref(s, "camt") + ")+N(" + ref(s, "samt") + ")";
    const hasVal = allCols(s).some((x) => x.f === "val"), hasCtin = allCols(s).some((x) => x.f === "ctin");
    let f = '""';
    if (hasCtin && allCols(s).some((x) => x.f === "pos")) f = "IF(AND(" + ref(s, "ctin") + '<>"",' + ref(s, "pos") + '<>"",LEFT(' + ref(s, "pos") + ",2)<>LEFT(" + ref(s, "ctin") + ',2)),"place of supply ≠ GSTIN state","")';
    if (hasVal) f = "IF(AND(ISNUMBER(" + ref(s, "val") + ")," + ref(s, "val") + "+1<N(" + tv + ")+" + tax + "+N(" + ref(s, "csamt") + ')),"value less than taxable + tax",' + f + ")";
    return "IF(" + tv + '="","",IF(ABS(' + tax + "-N(" + tv + ")*N(" + rt + ")/100*" + fac + ')>1,"tax ≠ taxable × rate",' + f + "))";
  }
  return null;
}
// a line's value in a column, as the sheet shows it
function shown(c, l) {
  const v = l[c.f];
  if (c.f === "pos") return v === "" || v == null ? "" : posLabel(v);
  if (c.f === "inv_typ") return (INV_TYPE.find((x) => x[0] === v) || [, v || ""])[1];
  if (c.f === "diff_percent") return N(v) ? "65%" : "";
  if (c.f === "sply_ty" && l._t === "nil") return (NIL.find((x) => x[0] === v) || [, v || ""])[1];
  if (c.f === "doc_num") return (DOCN.find((x) => x[0] === N(v)) || [, String(v || "")])[1];
  if (c.n) return v === "" || v == null ? null : N(v);
  return v == null ? "" : String(v);
}
const N = (v) => (typeof G.num === "function" ? G.num(v) : +v || 0);

async function excelJs() {
  if (G.ExcelJS) return G.ExcelJS;
  if (typeof G.loadScriptOnce !== "function") throw new Error("exceljs.min.js could not be loaded");
  await G.loadScriptOnce("exceljs.min.js");
  if (!G.ExcelJS) throw new Error("exceljs.min.js could not be loaded");
  return G.ExcelJS;
}
const col = (n) => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
export const sheetsFor = (d) => SHEETS.filter((s) => (s.split == null || s.split === d.split) && (!s.adv || d.adv || (d.lines[s.t] || []).length) && (!s.eco || d.eco));

export async function build(ExcelJS, d) {
  const wb = new ExcelJS.Workbook(); wb.creator = "FinCom"; wb.created = new Date();
  const L = LISTS(), sheets = sheetsFor(d);
  const prot = { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true, autoFilter: true, sort: false };
  sheets.forEach((s) => {
    const ws = wb.addWorksheet(s.sheet, { views: [{ state: "frozen", ySplit: 1 }] }), cols = allCols(s), lines = d.lines[s.t] || [];
    const rows = lines.map((l) => cols.map((c) => (c.f === "key" ? l._k : c.calc ? { formula: formula(s, c) } : shown(c, l))));
    for (let i = 0; i < s.spare; i++) rows.push(cols.map((c) => (c.calc || c.auto ? { formula: formula(s, c) } : null)));
    if (!rows.length) rows.push(cols.map(() => null));
    ws.addTable({ name: tn(s), ref: "A1", headerRow: true, totalsRow: false, style: { theme: "TableStyleLight1", showRowStripes: true }, columns: cols.map((c) => ({ name: c.h, filterButton: true })), rows });
    const last = rows.length + 1;
    cols.forEach((c, i) => {
      const k = ws.getColumn(i + 1); k.width = c.w || Math.min(30, Math.max(10, c.h.length + 2));
      if (c.n || c.auto) k.numFmt = NF;
      if (c.l && L[c.l]) ws.dataValidations.add(col(i) + "2:" + col(i) + last, { type: "list", allowBlank: true, formulae: ["Lists!$" + L[c.l][0] + "$1:$" + L[c.l][0] + "$" + L[c.l][1].length], showErrorMessage: true, errorStyle: "warning", errorTitle: c.h, error: "Choose from the list." });
      if (c.calc) { k.font = { color: { argb: "FF5B6573" }, italic: true }; }
    });
    ws.getColumn(1).hidden = true;
    const h = ws.getRow(1); h.font = { bold: true }; h.alignment = { vertical: "middle", wrapText: true }; h.height = 32;
  });

  // ---- Summary: every figure a formula over the tables (rows added, deleted or changed count at once)
  const sm = wb.addWorksheet("Summary");
  sm.columns = [{ width: 46 }, { width: 12 }, { width: 9 }, { width: 16 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 13 }, { width: 8 }];
  sm.addRow(["Table", "Sheet", "Rows", "Taxable Value", "Integrated Tax", "Central Tax", "State/UT Tax", "Cess", "Code"]);
  const S1 = (s, f) => { const r = colRef(s, f); return r ? "SUM(" + r + ")" : "0"; };
  const signed = (s, f) => "SUMIF(" + colRef(s, "ntty") + ',"D",' + colRef(s, f) + ")-SUMIF(" + colRef(s, "ntty") + ',"C",' + colRef(s, f) + ")";
  const rowOf = {};
  sheets.forEach((s) => {
    const first = s.cols.find((c) => !c.calc && !c.auto) || s.cols[0], cnt = "COUNTA(" + colRef(s, first.f) + ")";
    let v;
    if (s.t === "nil") v = [cnt, S1(s, "nil_amt") + "+" + S1(s, "expt_amt") + "+" + S1(s, "ngsup_amt"), "0", "0", "0", "0"];
    else if (s.t === "docs") v = ["SUM(" + colRef(s, "totnum") + ")-SUM(" + colRef(s, "cancel") + ")", "0", "0", "0", "0", "0"];
    else if (s.eco) v = [cnt, S1(s, "suppval"), S1(s, "igst"), S1(s, "cgst"), S1(s, "sgst"), S1(s, "cess")];
    else if (s.amend && s.cols.some((c) => c.f === "ntty")) v = [cnt].concat(["txval", "iamt", "camt", "samt", "csamt"].map((f) => signed(s, f)));
    else v = [cnt].concat(["txval", "iamt", "camt", "samt", "csamt"].map((f) => S1(s, f)));
    const r = sm.addRow([s.no + " – " + s.name, s.sheet].concat(v.map((x) => ({ formula: x })), [s.t]));
    rowOf[s.t] = r.number;
  });
  const at = (t, c) => (rowOf[t] ? c + rowOf[t] : "0");
  sm.addRow([]);
  sm.addRow(["Checks (worked out from the tables)"]).font = { bold: true };
  const nilS = SHEET_OF.nil, signedS = (s) => signed(s, "txval");     // a credit note less (HSN takes it off)
  const nilReg = (reg) => (rowOf.nil ? "SUMIF(" + colRef(nilS, "sply_ty") + ',"' + (reg ? "*to registered*" : "*unregistered*") + '",' + colRef(nilS, "nil_amt") + ")+SUMIF(" + colRef(nilS, "sply_ty") + ',"' + (reg ? "*to registered*" : "*unregistered*") + '",' + colRef(nilS, "expt_amt") + ")+SUMIF(" + colRef(nilS, "sply_ty") + ',"' + (reg ? "*to registered*" : "*unregistered*") + '",' + colRef(nilS, "ngsup_amt") + ")" : "0");
  if (d.split) {
    sm.addRow(["HSN (B2B) taxable less B2B + CDNR + nil/exempt to registered (nil when they agree)", "", "", { formula: at("hsnb2b", "D") + "-" + at("b2b", "D") + "-(" + (rowOf.cdnr ? signedS(SHEET_OF.cdnr) : "0") + ")-(" + nilReg(true) + ")" }, "", "", "", "", "chk_hsnb2b"]);
    sm.addRow(["HSN (B2C) taxable less B2CL + EXP + B2CS + CDNUR + nil/exempt to unregistered (nil when they agree)", "", "", { formula: at("hsnb2c", "D") + "-" + at("b2cl", "D") + "-" + at("exp", "D") + "-" + at("b2cs", "D") + "-(" + (rowOf.cdnur ? signedS(SHEET_OF.cdnur) : "0") + ")-(" + nilReg(false) + ")" }, "", "", "", "", "chk_hsnb2c"]);
  } else sm.addRow(["HSN taxable less tables 4 to 9 and nil/exempt (nil when they agree)", "", "", { formula: at("hsn", "D") + "-" + ["b2b", "b2cl", "exp", "b2cs"].map((t) => at(t, "D")).join("-") + "-(" + (rowOf.cdnr ? signedS(SHEET_OF.cdnr) : "0") + ")-(" + (rowOf.cdnur ? signedS(SHEET_OF.cdnur) : "0") + ")-" + at("nil", "D") }, "", "", "", "", "chk_hsn"]);
  const dn = SHEET_OF.docs, inv = ["b2b", "b2cl", "exp"].filter((t) => rowOf[t]).map((t) => { const r = colRef(SHEET_OF[t], "inum"); return "SUMPRODUCT((" + r + '<>"")/COUNTIF(' + r + "," + r + '&""))'; });
  sm.addRow(["Documents issued: invoices for outward supply, net of cancelled", "", { formula: rowOf.docs ? "SUMIF(" + colRef(dn, "doc_num") + ',"Invoices for outward supply",' + colRef(dn, "totnum") + ")-SUMIF(" + colRef(dn, "doc_num") + ',"Invoices for outward supply",' + colRef(dn, "cancel") + ")" : "0" }, "", "", "", "", "", "chk_docs"]);
  sm.addRow(["Invoices listed one by one in B2B, B2CL and EXP (the rest are B2C (Others), reported as totals)", "", { formula: inv.length ? inv.join("+") : "0" }, "", "", "", "", "", "chk_inv"]);
  for (let r = 2; r <= sm.rowCount; r++) [4, 5, 6, 7, 8].forEach((c) => { sm.getRow(r).getCell(c).numFmt = NF; });
  sm.getRow(1).font = { bold: true }; sm.getColumn(9).hidden = true;
  sm.addRow([]); sm.addRow(["Change, add or delete rows in the tables and these figures follow. Totals as the GSTR-1 screen and the portal show each table (9B as listed; in 9C a credit note is less). Upload this file in FinCom (GSTR-1, Upload Excel): a preview shows every change before it is applied."]);
  await sm.protect("", prot);

  // ---- About, and the lists
  const ab = wb.addWorksheet("About");
  ab.getColumn(1).width = 22; ab.getColumn(2).width = 90;
  [["Client", d.client], ["GSTIN", d.gstin], ["Month", d.label], ["Month code", d.ym], ["Registration", d.reg], ["Made", new Date().toISOString()], ["Client id", d.cid], ["Format", VERSION]].forEach((x) => ab.addRow(x));
  ab.addRow([]);
  ["GSTR-1 for the month in the portal's own tables, one sheet a table, as the portal's offline tool. Every field can be changed.",
    "Add a row: type it in the first empty row of the table (its tax is worked out from the place of supply and taxable × rate; you may type your own).",
    "Delete a row: delete it from the sheet. It is then left out of this month's GSTR-1 in FinCom (never deleted from the books).",
    "Change a row: change any cell. The Check column says when the tax no longer fits taxable × rate, or the value or the place of supply looks wrong.",
    "Do not change the hidden Key column (A): it tells FinCom which line of the books a row is.",
    "Then in FinCom, GSTR-1, Upload Excel: a preview lists what is added, left out and changed, with any error to fix; Apply makes it this month's GSTR-1 (Undo puts it back)."].forEach((t) => ab.addRow(["", t]));
  await ab.protect("", prot);
  const wl = wb.addWorksheet("Lists", { state: "hidden" });
  const lmax = Math.max.apply(null, Object.values(L).map((x) => x[1].length));
  for (let i = 0; i < lmax; i++) { const r = wl.getRow(i + 1); Object.values(L).forEach(([c, vals]) => { if (vals[i] != null) r.getCell(c).value = vals[i]; }); }
  wl.getCell("H1").value = String(d.reg || "");
  return wb;
}

export async function make(ym, reg) {
  const ExcelJS = await excelJs(), d = G.R1Fix.excelData(ym, reg), wb = await build(ExcelJS, d);
  const buffer = await wb.xlsx.writeBuffer(), co = String(d.client || "client").replace(/[^A-Za-z0-9]+/g, "-");
  return { buffer, name: co + "-GSTR-1-" + (d.gstin || reg) + "-" + String(d.label).replace(/[^A-Za-z0-9]+/g, "-") + ".xlsx", data: d };
}
export async function download(ym, reg) {
  const x = await make(ym, reg);
  await G.saveFile(x.name, new Blob([x.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  return x;
}

// ---- reading one back
const val = (c) => {
  let v = c && c.value;
  if (v == null) return null;
  if (typeof v === "object") {
    if (v instanceof Date) return v;
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return v.result == null ? undefined : typeof v.result === "object" && v.result && "error" in v.result ? null : v.result;
    if ("formula" in v || "sharedFormula" in v) return undefined;           // a formula not worked out (saved without recalculation)
    if ("text" in v) return v.text;
    if ("error" in v) return null;
  }
  return v;
};
const dmy = (d) => String(d.getUTCDate()).padStart(2, "0") + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + d.getUTCFullYear();
const txt = (v) => (v == null ? "" : v instanceof Date ? dmy(v) : String(v).trim());
const numOf = (v) => { if (v == null || v === "") return ""; if (typeof v === "number") return Math.round(v * 100) / 100; const s = String(v).replace(/[,₹\s]/g, "").replace(/%$/, ""); return /^-?\d+(\.\d+)?$/.test(s) ? +s : String(v).trim(); };
// a cell's text as the field it is (codes from the words of the lists)
function field(c, raw) {
  if (c.n) return numOf(raw);
  const s = txt(raw);
  if (c.d) { const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); return m ? m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0") + "-" + m[3] : s.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, "$3-$2-$1"); }
  if (c.f === "pos") { if (!s) return ""; const m = s.match(/^(\d{1,2})\b/); if (m) return m[1].padStart(2, "0"); const k = Object.keys(G.STATE_CODES || {}).find((x) => x === s.toUpperCase()); return k ? G.STATE_CODES[k] : s; }
  if (c.f === "inv_typ") { const f = INV_TYPE.find((x) => x[1].toLowerCase() === s.toLowerCase() || x[0] === s.toUpperCase()); return f ? f[0] : s; }
  if (c.f === "diff_percent") return /65/.test(s) ? 0.65 : s ? s : "";
  if (c.f === "sply_ty") { const f = NIL.find((x) => x[1].toLowerCase() === s.toLowerCase() || x[0] === s.toUpperCase()); return f ? f[0] : s; }
  if (c.f === "doc_num") { const f = DOCN.find((x) => x[1].toLowerCase() === s.toLowerCase() || String(x[0]) === s); return f ? f[0] : s; }
  if (["ctin", "etin", "rchrg", "ntty", "exp_typ", "typ", "uqc"].includes(c.f)) return s.toUpperCase();
  return s;
}
export async function read(src) {
  const ExcelJS = await excelJs(), wb = new ExcelJS.Workbook();
  const buf = src && typeof src.arrayBuffer === "function" ? await src.arrayBuffer() : src;
  // the Tables' own parts are not read (ExcelJS cannot read every program's, openpyxl's for one): only the cells are needed
  await wb.xlsx.load(buf, { ignoreNodes: ["tableParts"] });
  const ab = wb.getWorksheet("About");
  if (!ab) throw new Error("this is not FinCom's GSTR-1 Excel (its “About” sheet is missing)");
  const meta = { file: src && src.name ? src.name : "" };
  ab.eachRow((r) => { const k = txt(val(r.getCell(1))), v = txt(val(r.getCell(2))); if (k === "Month code") meta.month = v; if (k === "Registration") meta.reg = v; if (k === "GSTIN") meta.gstin = v; if (k === "Client id") meta.cid = v; if (k === "Format") meta.format = v; });
  if (meta.format !== VERSION) throw new Error(meta.format ? "made by another version of FinCom (" + meta.format + "): download it again" : "this is not FinCom's GSTR-1 Excel");
  const reg = meta.reg || "", tables = {};
  SHEETS.forEach((s) => {
    const ws = wb.getWorksheet(s.sheet);
    if (!ws) return;
    // the columns by their headings (a column moved still reads)
    const at = {}; ws.getRow(1).eachCell((c, i) => { const h = txt(val(c)); const k = allCols(s).find((x) => x.h === h); if (k) at[k.f] = i; });
    const list = [];
    ws.eachRow((r, i) => {
      if (i === 1) return;
      const f = {}; let any = false;
      allCols(s).forEach((c) => { if (c.calc || c.f === "key" || !at[c.f]) return; let v = val(r.getCell(at[c.f]));
        if (v === undefined && c.auto) v = autoTax(s, c, r, at, reg);            // the spare row's formula, not worked out: worked out here
        const x = field(c, v); if (x !== "" && x != null) any = true; f[c.f] = x; });
      if (!any) return;
      if (s.t === "nil") ["nil_amt", "expt_amt", "ngsup_amt"].forEach((k) => { if (f[k] === "") f[k] = 0; });
      list.push({ row: i, key: at.key ? txt(val(r.getCell(at.key))) : txt(val(r.getCell(1))), f });
    });
    tables[s.t] = list;
  });
  // the Summary's figures, when the file was saved with its formulas worked out
  const summary = {}, sm = wb.getWorksheet("Summary");
  if (sm) sm.eachRow((r, i) => { if (i === 1) return; const code = txt(val(r.getCell(9))); if (!code || !SHEET_OF[code]) return;
    const g = (k) => val(r.getCell(k)), nums = [3, 4, 5, 6, 7, 8].map(g), calc = nums.every((v) => typeof v === "number");
    summary[code] = { calc, n: nums[0], taxable: nums[1], igst: nums[2], cgst: nums[3], sgst: nums[4], cess: nums[5] }; });
  return { meta, tables, summary };
}
// the tax of a row whose formula was not worked out (a file saved by a program that does not calculate): the same rule
function autoTax(s, c, r, at, reg) {
  const g = (f) => (at[f] ? val(r.getCell(at[f])) : null), tv = numOf(g("txval")), rt = numOf(g("rt"));
  if (tv === "" || rt === "" || typeof tv !== "number" || typeof rt !== "number") return null;
  const fac = /65/.test(txt(g("diff_percent"))) ? 0.65 : 1, pos = (txt(g("pos")).match(/^(\d{1,2})/) || [, ""])[1].padStart(2, "0"), typ = txt(g("inv_typ"));
  let inter = s.inter === "always" || s.inter === "exp" || pos !== reg;
  if (s.inter === "b2b" && /SEZ|IGST/.test(typ)) inter = true;
  if (s.inter === "exp" && txt(g("exp_typ")).toUpperCase() === "WOPAY") return c.auto === "i" ? 0 : 0;
  const r2 = (x) => Math.round(x * 100) / 100;
  return c.auto === "i" ? (inter ? r2(tv * rt / 100 * fac) : 0) : (inter ? 0 : r2(tv * rt / 200 * fac));
}
if (typeof window !== "undefined") window.R1Excel = { make, download, read, build, SHEETS };
