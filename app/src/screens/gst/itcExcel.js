// The 2B & ITC Excel (next-itc-simple; the owner, 24-Oct-2026: "there should be some system to export Excel and import it
// also so bulky work can be done there .. that Excel should also work like our system features and there should be the
// final ITC-to-be-taken figure there also .. after importing, the system should take all the details from there only").
// Smart Excel, no macros (the owner's choice): ExcelJS (the site's assets/exceljs.min.js, loaded the first time), sheets
//   Input register        the month's bills (as the first tab), with totals; Eligible?, ITC to take (Take now · Later month ·
//                         Do not take), Take in month and Note to fill on each bill a line is decided on (next-itc-excel-edit)
//   2B reconciliation     a row a line: a hidden key, the data locked; Decision (a list of the seven choices), Eligible?, Take in month
//                         (a list of months) and Note to fill; Credit month and ITC this month worked out by formulas, with
//                         hidden workings: the line's tax in the books this month, the lower of books and 2B, all of it, what
//                         a later month takes, FinCom's rule (its month and amount), and the effect on 4(A)(5)
//   Adjustments           rows to add, change or clear: head, amount (+ or -), reason, 3B line (lists)
//   Final credit for 3B   table 4, each figure a formula over the reconciliation and the adjustments: the same rule as the
//                         app (app/src/lib/itcFinal.js, ITCF.credit and effect), so a decision changed in Excel moves 4(A)(5)
//   Summary               lines and ITC this month by decision and by status (COUNTIF, SUMIF)
//   Write to suppliers    each supplier's lines set to follow up or correct (COUNTIFS, SUMIFS)
//   About                 the client, GSTIN and month the file is for (read back to refuse another month's file)
// Only functions Excel, LibreOffice and Google Sheets all have (IF, AND, OR, SUM, SUMIF(S), COUNTIF(S)). The sheets are
// protected without a password: the lists and the cells to fill are open, the rest locked.
//   download(reg, M)   saves "<client> 2B and ITC <GSTIN> <Mon-YYYY>.xlsx"; make(reg, M) -> {buffer, name} (tests)
//   read(file|buffer)  -> {meta, rows: [{row, key, dec, takeIn, note, party, no}], adj: [{row, id, head, amt, reason, line}],
//                          final: {4A1: {igst…}, …, calc}} for ITCF.preview
const G = globalThis;
const H = ["igst", "cgst", "sgst", "cess"];
const SH = { inreg: "Input register", reco: "2B reconciliation", adj: "Adjustments", fin: "Final credit for 3B", sum: "Summary", sup: "Write to suppliers", about: "About", lists: "Lists" };
const Q = (n) => "'" + n + "'!";
const NF = "#,##0.00;[Red]-#,##0.00";
const ADJ_ROWS = 200;
const VERSION = "fincom-itc-2";

async function excelJs() {
  if (G.ExcelJS) return G.ExcelJS;
  if (typeof G.loadScriptOnce !== "function") throw new Error("exceljs.min.js could not be loaded");
  await G.loadScriptOnce("exceljs.min.js");
  if (!G.ExcelJS) throw new Error("exceljs.min.js could not be loaded");
  return G.ExcelJS;
}
const col = (n) => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const day = (d) => (/^\d{8}$/.test(String(d || "")) ? d.slice(6, 8) + "-" + d.slice(4, 6) + "-" + d.slice(0, 4) : String(d || ""));
const tot = (o) => Math.round(H.reduce((a, k) => a + (+((o || {})[k]) || 0), 0) * 100) / 100;

// the reconciliation sheet's columns (next-itc-excel-edit: Eligible? to fill; the effective decision, month and eligibility,
// what the books reverse already and the effect on 4(B)(1) worked out, hidden)
const RC = (() => {
  const c = {}; let i = 0;
  ["key", "status", "party", "gstin", "no", "date", "bm", "tm", "bTax", "pTax", "dec", "takeIn", "elig", "note", "credit", "take", "kind", "def", "def2", "defE", "effDec", "effMonth", "effElig"].forEach((k) => { c[k] = i++; });
  ["booksM", "lower", "full", "later", "defAmt", "takeH", "eff", "blkM", "rev"].forEach((k) => { c[k] = i; i += 4; });
  c.n = i; return c;
})();
// the input register sheet's columns: the books' facts locked; Eligible?, ITC to take, Take in month and Note to fill; a
// hidden copy of those four as exported, to tell what was changed here
const IC = (() => { const c = {}; ["key", "date", "voucher", "party", "gstin", "no", "taxable", "igst", "cgst", "sgst", "cess", "tax", "twoB", "elig", "itc", "takeIn", "note", "xElig", "xItc", "xTakeIn", "xNote"].forEach((k, i) => { c[k] = i; }); return c; })();
const ITC_WORDS = ["Take now", "Later month", "Do not take"];
const ELIG_WORDS = ["Eligible", "Ineligible 17(5)", "Not ours"];
const L = (k, h) => col(RC[k] + (h == null ? 0 : H.indexOf(h)));

function head(ws, names, widths) {
  ws.addRow(names);
  const r = ws.getRow(1); r.font = { bold: true }; r.alignment = { vertical: "middle", wrapText: true }; r.height = 30;
  r.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF3F8" } }; c.border = { bottom: { style: "thin", color: { argb: "FFB8C2CC" } } }; });
  (widths || []).forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
}
const open = (c) => { c.protection = { locked: false }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBE6" } }; };

export async function build(ExcelJS, d) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FinCom"; wb.created = new Date();
  const decs = d.decs.map(([, l]) => l), months = d.months.map(([, l]) => l), lines = d.lines.map(([, l]) => l), heads = ["IGST", "CGST", "SGST", "Cess"];
  const n = d.rows.length, last = Math.max(2, n + 1), M = Q(SH.about) + "$B$3";
  const rng = (k, h) => Q(SH.reco) + "$" + L(k, h) + "$2:$" + L(k, h) + "$" + last;
  const prot = { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true, autoFilter: true, sort: false };

  // ---- Input register
  const wi = wb.addWorksheet(SH.inreg), IL = (k) => col(IC[k]), irRow = {};
  const inames = []; [["key", "Key (do not change)"], ["date", "Booked"], ["voucher", "Voucher"], ["party", "Supplier"], ["gstin", "GSTIN"], ["no", "Bill no."], ["taxable", "Taxable"], ["igst", "IGST"], ["cgst", "CGST"],
    ["sgst", "SGST"], ["cess", "Cess"], ["tax", "Total tax"], ["twoB", "Status in 2B"], ["elig", "Eligible?"], ["itc", "ITC to take"], ["takeIn", "Take in month"], ["note", "Note"], ["xElig", "as exported: Eligible?"], ["xItc", "as exported: ITC to take"],
    ["xTakeIn", "as exported: month"], ["xNote", "as exported: note"]].forEach(([k, w]) => { inames[IC[k]] = w; });
  head(wi, inames, []);
  [["key", 6], ["date", 11], ["voucher", 10], ["party", 28], ["gstin", 17], ["no", 16], ["taxable", 13], ["igst", 11], ["cgst", 11], ["sgst", 11], ["cess", 9], ["tax", 12], ["twoB", 16], ["elig", 16], ["itc", 14], ["takeIn", 13], ["note", 24]].forEach(([k, w]) => { wi.getColumn(IC[k] + 1).width = w; });
  ["taxable", "igst", "cgst", "sgst", "cess", "tax"].forEach((k) => { wi.getColumn(IC[k] + 1).numFmt = NF; });
  ["key", "xElig", "xItc", "xTakeIn", "xNote"].forEach((k) => { wi.getColumn(IC[k] + 1).hidden = true; });
  (d.inreg || []).forEach((r, j) => {
    const sg = r.dir < 0 ? -1 : 1, v = [];
    v[IC.key] = r.key || ""; v[IC.date] = day(r.date); v[IC.voucher] = r.voucher || ""; v[IC.party] = r.party || ""; v[IC.gstin] = r.gstin || ""; v[IC.no] = r.no || "";
    ["taxable", "igst", "cgst", "sgst", "cess", "tax"].forEach((k) => { v[IC[k]] = sg * (+r[k] || 0); });
    v[IC.twoB] = r.twoB || "";
    if (r.key) { v[IC.elig] = v[IC.xElig] = r.elig || ""; v[IC.itc] = v[IC.xItc] = r.itc || ""; v[IC.takeIn] = v[IC.xTakeIn] = r.takeIn || ""; v[IC.note] = v[IC.xNote] = r.note || ""; irRow[r.key] = j + 2; }
    else { v[IC.elig] = r.with || (r.kindL === "Not to be taken" ? "as booked: not to be taken" : r.kindL || ""); }
    const row = wi.addRow(v);
    if (r.key) {
      ["elig", "itc", "takeIn", "note"].forEach((k) => open(row.getCell(IC[k] + 1)));
      row.getCell(IC.elig + 1).dataValidation = { type: "list", allowBlank: true, formulae: [Q(SH.lists) + "$E$1:$E$3"], showErrorMessage: true, error: "Eligible, Ineligible 17(5) or Not ours." };
      row.getCell(IC.itc + 1).dataValidation = { type: "list", allowBlank: true, formulae: [Q(SH.lists) + "$F$1:$F$3"], showErrorMessage: true, error: "Take now, Later month or Do not take." };
      row.getCell(IC.takeIn + 1).dataValidation = { type: "list", allowBlank: true, formulae: [Q(SH.lists) + "$B$1:$B$" + months.length], showErrorMessage: true, error: "Choose a month from the list." };
    }
  });
  const il = (d.inreg || []).length + 1;
  const it = wi.getRow(il + 1); it.getCell(IC.date + 1).value = "Total"; it.getCell(IC.party + 1).value = (d.inreg || []).length + " bills";
  ["taxable", "igst", "cgst", "sgst", "cess", "tax"].forEach((k) => { it.getCell(IC[k] + 1).value = { formula: "SUM(" + IL(k) + "2:" + IL(k) + Math.max(2, il) + ")" }; });
  it.font = { bold: true };
  wi.autoFilter = { from: "A1", to: IL("note") + "1" };
  await wi.protect("", prot);

  // ---- 2B reconciliation
  const wr = wb.addWorksheet(SH.reco);
  const names = []; names[RC.key] = "Key (do not change)"; names[RC.status] = "Status"; names[RC.party] = "Supplier"; names[RC.gstin] = "GSTIN"; names[RC.no] = "Invoice"; names[RC.date] = "Date";
  names[RC.bm] = "Books month"; names[RC.tm] = "2B month"; names[RC.bTax] = "ITC as per books"; names[RC.pTax] = "ITC as per 2B"; names[RC.dec] = "Decision"; names[RC.takeIn] = "Take in month"; names[RC.elig] = "Eligible?";
  names[RC.note] = "Note"; names[RC.credit] = "Credit month"; names[RC.take] = "ITC in " + d.label; names[RC.kind] = "Kind"; names[RC.def] = "FinCom's rule: month"; names[RC.def2] = "FinCom's rule: month if eligible";
  names[RC.defE] = "As the books have it"; names[RC.effDec] = "Decision in force"; names[RC.effMonth] = "Month in force"; names[RC.effElig] = "Eligible? in force";
  [["booksM", "In the books this month"], ["lower", "Lower of books and 2B"], ["full", "All of it"], ["later", "Taken in a later month"], ["defAmt", "FinCom's rule: amount"], ["takeH", "Taken this month"], ["eff", "Effect on 4(A)(5)"],
    ["blkM", "Reversed in the books (17(5) in Tally)"], ["rev", "Effect on 4(B)(1)"]]
    .forEach(([k, w]) => H.forEach((h, i) => { names[RC[k] + i] = w + ": " + heads[i]; }));
  head(wr, names, []);
  [[RC.key, 6], [RC.status, 19], [RC.party, 30], [RC.gstin, 17], [RC.no, 18], [RC.date, 11], [RC.bm, 10], [RC.tm, 10], [RC.bTax, 14], [RC.pTax, 14], [RC.dec, 27], [RC.takeIn, 14], [RC.elig, 16], [RC.note, 26], [RC.credit, 12], [RC.take, 15]]
    .forEach(([i, w]) => { wr.getColumn(i + 1).width = w; });
  for (let i = RC.booksM; i < RC.n; i++) { wr.getColumn(i + 1).width = 13; wr.getColumn(i + 1).numFmt = NF; }
  [RC.bTax, RC.pTax, RC.take].forEach((i) => { wr.getColumn(i + 1).numFmt = NF; });
  wr.getColumn(RC.key + 1).hidden = true;
  for (let i = RC.kind; i < RC.n; i++) wr.getColumn(i + 1).hidden = true;
  const IR = (k, n) => Q(SH.inreg) + "$" + IL(k) + "$" + n;
  d.rows.forEach((x, j) => {
    const r = j + 2, v = [];
    v[RC.key] = x.key; v[RC.status] = x.status + (x.fixed ? " · " + x.fixed : ""); v[RC.party] = x.party; v[RC.gstin] = x.gstin; v[RC.no] = x.no || x.bookNo; v[RC.date] = day(x.date);
    v[RC.bm] = x.bm; v[RC.tm] = x.tm; v[RC.bTax] = tot(x.bTax); v[RC.pTax] = tot(x.pTax); v[RC.dec] = x.dec; v[RC.takeIn] = x.takeIn; v[RC.elig] = x.elig || ""; v[RC.note] = x.note; v[RC.kind] = x.kind;
    v[RC.def] = x.def; v[RC.def2] = x.def2; v[RC.defE] = x.defE || "";
    ["booksM", "lower", "full", "later", "defAmt", "blkM"].forEach((k) => H.forEach((h, i) => { v[RC[k] + i] = +((x[k] || {})[h]) || 0; }));
    const KI = "$" + L("kind") + r, C = "$" + L("credit") + r, DE = "$" + L("defE") + r;
    // the decision, month and eligibility in force: the input register's where it was changed there, else this sheet's
    const ir = irRow[x.key];
    if (ir) {
      const chD = "OR(" + IR("itc", ir) + "<>" + IR("xItc", ir) + "," + IR("takeIn", ir) + "<>" + IR("xTakeIn", ir) + ")";
      v[RC.effDec] = { formula: "IF(" + chD + ",IF(" + IR("itc", ir) + '="Take now",IF(' + KI + '="books","Take now though not in 2B","Take now"),IF(' + IR("itc", ir) + '="Later month","Take in a later month",IF(' + IR("itc", ir) + '="Do not take","Reverse / do not take",""))),$' + L("dec") + r + ")" };
      v[RC.effMonth] = { formula: "IF(" + chD + "," + IR("takeIn", ir) + ",$" + L("takeIn") + r + ")" };
      v[RC.effElig] = { formula: "IF(" + IR("elig", ir) + "<>" + IR("xElig", ir) + ",IF(" + IR("elig", ir) + '="",' + DE + "," + IR("elig", ir) + "),IF($" + L("elig") + r + '="",' + DE + ",$" + L("elig") + r + "))" };
    } else {
      v[RC.effDec] = { formula: "$" + L("dec") + r + "&\"\"" };
      v[RC.effMonth] = { formula: "$" + L("takeIn") + r + "&\"\"" };
      v[RC.effElig] = { formula: "IF($" + L("elig") + r + '="",' + DE + ",$" + L("elig") + r + ")" };
    }
    const K = "$" + L("effDec") + r, T = "$" + L("effMonth") + r, E = "$" + L("effElig") + r;
    const DM = "IF(" + E + '="Eligible",$' + L("def2") + r + ",$" + L("def") + r + ")";
    const fu = 'OR(' + K + '="Follow up with supplier",' + K + '="Ask supplier to correct")';
    v[RC.credit] = { formula: "IF(" + E + '="Not ours","",IF(' + K + '="",' + DM + ",IF(OR(" + K + '="Take now",' + K + '="Take now though not in 2B"),' + M + ",IF(" + K + '="Take in a later month",IF(' + T + '="",IF(' + KI + '="pair",' + DM + ',""),' + T + "),IF(AND(" + KI + '="pair",' + fu + ")," + DM + ',"")))))' };
    H.forEach((h) => {
      v[RC.takeH + H.indexOf(h)] = { formula: "IF(" + C + "=" + M + ",IF(" + K + '="Take now though not in 2B",' + L("full", h) + r + ",IF(OR(" + K + '="",AND(' + KI + '="pair",' + fu + "))," + L("defAmt", h) + r + ",IF(" + K + '="Take in a later month",' + L("later", h) + r + "," + L("lower", h) + r + "))),0)" };
      v[RC.eff + H.indexOf(h)] = { formula: L("takeH", h) + r + "-" + L("booksM", h) + r };
      v[RC.rev + H.indexOf(h)] = { formula: "IF(OR(" + KI + '="fixed",' + E + "=" + DE + "),0,IF(" + E + '="Ineligible 17(5)",' + L("takeH", h) + r + ",0)-" + L("blkM", h) + r + ")" };
    });
    v[RC.take] = { formula: "SUM(" + L("takeH", "igst") + r + ":" + L("takeH", "cess") + r + ")" };
    const row = wr.addRow(v);
    [RC.dec, RC.takeIn, RC.note].concat(x.kind === "fixed" ? [] : [RC.elig]).forEach((i) => open(row.getCell(i + 1)));
    row.getCell(RC.dec + 1).dataValidation = { type: "list", allowBlank: true, formulae: [Q(SH.lists) + "$A$1:$A$" + decs.length], showErrorMessage: true, errorTitle: "Decision", error: "Choose one of the decisions in the list (or leave it blank for FinCom's rule)." };
    row.getCell(RC.takeIn + 1).dataValidation = { type: "list", allowBlank: true, formulae: [Q(SH.lists) + "$B$1:$B$" + months.length], showErrorMessage: true, errorTitle: "Take in month", error: "Choose a month from the list." };
    if (x.kind !== "fixed") row.getCell(RC.elig + 1).dataValidation = { type: "list", allowBlank: true, formulae: [Q(SH.lists) + "$E$1:$E$3"], showErrorMessage: true, error: "Eligible, Ineligible 17(5) or Not ours." };
  });
  wr.autoFilter = { from: "A1", to: col(RC.take) + "1" };
  await wr.protect("", prot);

  // ---- Adjustments
  const wa = wb.addWorksheet(SH.adj);
  head(wa, ["ID (do not change)", "Head", "Amount (+ or -)", "Reason", "3B line"], [8, 10, 16, 44, 44]);
  wa.getColumn(1).hidden = true; wa.getColumn(3).numFmt = NF;
  for (let j = 0; j < ADJ_ROWS; j++) {
    const a = d.adj[j], row = wa.addRow(a ? [a.id, heads[H.indexOf(a.head)], a.amt, a.reason, (d.lines.find(([k]) => k === a.line) || [])[1] || ""] : ["", "", null, "", ""]);
    [2, 3, 4, 5].forEach((i) => open(row.getCell(i)));
    row.getCell(2).dataValidation = { type: "list", allowBlank: true, formulae: [Q(SH.lists) + "$C$1:$C$4"], showErrorMessage: true, error: "IGST, CGST, SGST or Cess." };
    row.getCell(5).dataValidation = { type: "list", allowBlank: true, formulae: [Q(SH.lists) + "$D$1:$D$" + lines.length], showErrorMessage: true, error: "Choose the 3B line from the list." };
    row.getCell(3).dataValidation = { type: "decimal", allowBlank: true, operator: "between", formulae: [-1e12, 1e12], showErrorMessage: true, error: "A number: a minus reduces the line." };
  }
  await wa.protect("", Object.assign({}, prot, { insertRows: true, deleteRows: true }));

  // ---- Final credit for 3B
  const wf = wb.addWorksheet(SH.fin);
  head(wf, ["GSTR-3B table 4 · " + d.label, "IGST", "CGST", "SGST", "Cess", "Total", "Code"], [58, 15, 15, 15, 15, 16, 6]);
  wf.getColumn(7).hidden = true;
  const AX = (c) => Q(SH.adj) + "$" + c + "$2:$" + c + "$" + (ADJ_ROWS + 1);
  const adjF = (code, i) => "SUMIFS(" + AX("C") + "," + AX("B") + ',"' + heads[i] + '",' + AX("E") + ',"' + (d.lines.find(([k]) => k === code) || [])[1] + '")';
  const B = d.base;
  let rn = 1;
  const add = (label, code, cells, bold) => {
    rn++; const row = wf.getRow(rn);
    row.getCell(1).value = label; cells.forEach((v, i) => { row.getCell(i + 2).value = v; });
    row.getCell(6).value = { formula: "SUM(B" + rn + ":E" + rn + ")" }; row.getCell(7).value = code || "";
    if (bold) row.font = { bold: true };
    return rn;
  };
  const C4 = (f) => [0, 1, 2, 3].map(f), num0 = (o, h) => Math.round((+((o || {})[h]) || 0) * 100) / 100;
  const sumAt = (rows, i) => rows.map((x) => col(i + 1) + x).join("+");
  const plusAdj = (code) => C4((i) => ({ formula: num0(B[code], H[i]) + "+" + adjF(code, i) }));
  const rb = add("Bills in the books this month (all other ITC)", "base", C4((i) => num0(B["4A5"], H[i])));
  const re = add("Effect of the decisions in 2B reconciliation", "eff", C4((i) => ({ formula: "SUM(" + rng("eff", H[i]) + ")" })));
  const rr = add("ITC reclaimed (also 4(D)(1))", "recl", C4((i) => num0(B.reclaim, H[i])));
  const ra = add("Adjustments to 4(A)(5)", "adj5", C4((i) => ({ formula: adjF("4A5", i) })));
  rn++;
  const r1 = add("4(A)(1) Import of goods", "4A1", plusAdj("4A1"));
  const r2a = add("4(A)(2) Import of services", "4A2", plusAdj("4A2"));
  const r3 = add("4(A)(3) Inward supplies on reverse charge", "4A3", plusAdj("4A3"));
  const r5 = add("4(A)(5) All other ITC", "4A5", C4((i) => ({ formula: sumAt([rb, re, rr, ra], i) })), true);
  const rA = add("4(A) Total ITC available", "4A", C4((i) => ({ formula: sumAt([r1, r2a, r3, r5], i) })), true);
  const rb1 = add("4(B)(1) Reversed: rules 38, 42, 43 and section 17(5)", "4B1", C4((i) => ({ formula: num0(B["4B1"], H[i]) + "+" + adjF("4B1", i) + "+SUM(" + rng("rev", H[i]) + ")" })));
  const rb2 = add("4(B)(2) Reversed: others", "4B2", plusAdj("4B2"));
  add("4(C) Net ITC available, (A) less (B)", "4C", C4((i) => ({ formula: col(i + 1) + rA + "-" + col(i + 1) + rb1 + "-" + col(i + 1) + rb2 })), true);
  add("4(D)(1) ITC reclaimed, reversed under 4(B)(2) earlier", "4D1", C4((i) => num0(B.reclaim, H[i])));
  add("4(D)(2) Ineligible ITC: section 16(4) and place of supply", "4D2", plusAdj("4D2"));
  for (let i = 2; i <= 6; i++) wf.getColumn(i).numFmt = NF;
  wf.getRow(rn + 2).getCell(1).value = "Change a Decision or an adjustment and these figures change, as in FinCom. Upload this file in FinCom (2B reconciliation or Final credit for 3B, Upload Excel) to apply it.";
  await wf.protect("", prot);

  // ---- Summary
  const ws = wb.addWorksheet(SH.sum);
  head(ws, ["Decision", "Lines", "ITC in " + d.label], [36, 10, 18]);
  ws.getColumn(3).numFmt = NF;
  decs.forEach((l) => ws.addRow([l, { formula: "COUNTIF(" + rng("dec") + ',"' + l + '")' }, { formula: "SUMIF(" + rng("dec") + ',"' + l + '",' + rng("take") + ")" }]));
  ws.addRow(["(blank: FinCom's rule)", { formula: "COUNTIF(" + rng("dec") + ',"")' }, { formula: "SUMIF(" + rng("dec") + ',"",' + rng("take") + ")" }]);
  ws.addRow(["Total", { formula: "SUM(B2:B" + (decs.length + 2) + ")" }, { formula: "SUM(C2:C" + (decs.length + 2) + ")" }]).font = { bold: true };
  ws.addRow([]);
  ws.addRow(["Status", "Lines", "ITC as per books"]).font = { bold: true };
  ["Matched", "In books, not in 2B", "In 2B, not in books", "Amount differs", "Rejected/Pending in IMS", "Carried forward"].forEach((l) => ws.addRow([l, { formula: "COUNTIF(" + rng("status") + ',"' + l + '*")' }, { formula: "SUMIF(" + rng("status") + ',"' + l + '*",' + rng("bTax") + ")" }]));
  await ws.protect("", prot);

  // ---- Write to suppliers
  const wsu = wb.addWorksheet(SH.sup);
  head(wsu, ["Supplier", "GSTIN", "Lines to follow up or correct", "ITC as per books", "ITC as per 2B"], [34, 18, 16, 16, 16]);
  [4, 5].forEach((i) => { wsu.getColumn(i).numFmt = NF; });
  const sups = new Map(); d.rows.forEach((x) => { const k = x.gstin || "name:" + x.party; if (!sups.has(k)) sups.set(k, x); });
  Array.from(sups.values()).sort((a, c) => String(a.party).localeCompare(String(c.party))).forEach((x) => {
    const by = x.gstin ? rng("gstin") : rng("party"), v = x.gstin || x.party, cnt = (l) => "COUNTIFS(" + by + ',"' + String(v).replace(/"/g, '""') + '",' + rng("dec") + ',"' + l + '")';
    const sm = (k, l) => "SUMIFS(" + rng(k) + "," + by + ',"' + String(v).replace(/"/g, '""') + '",' + rng("dec") + ',"' + l + '")';
    wsu.addRow([x.party, x.gstin, { formula: cnt("Follow up with supplier") + "+" + cnt("Ask supplier to correct") }, { formula: sm("bTax", "Follow up with supplier") + "+" + sm("bTax", "Ask supplier to correct") },
      { formula: sm("pTax", "Follow up with supplier") + "+" + sm("pTax", "Ask supplier to correct") }]);
  });
  wsu.autoFilter = { from: "A1", to: "E1" };
  await wsu.protect("", prot);

  // ---- About, and the lists
  const wab = wb.addWorksheet(SH.about);
  wab.getColumn(1).width = 22; wab.getColumn(2).width = 60;
  [["Client", d.client], ["GSTIN", d.gstin], ["Month", d.label], ["Month code", d.M], ["Registration", d.reg], ["Made", new Date().toISOString()], ["Client id", d.cid], ["Format", VERSION]].forEach((x) => wab.addRow(x));
  wab.addRow([]);
  ["How to use: on “2B reconciliation” choose a Decision for each line (and the month for “Take in a later month”), add a Note;",
    "on “Adjustments” add, change or clear rows. “Final credit for 3B” and “Summary” work themselves out as you go.",
    "Then in FinCom, 2B reconciliation, Upload Excel: a preview shows what changes, Apply saves it. Do not change the hidden Key column."].forEach((t) => wab.addRow(["", t]));
  await wab.protect("", prot);
  const wl = wb.addWorksheet(SH.lists, { state: "hidden" });
  const nmax = Math.max(decs.length, months.length, 4, lines.length);
  for (let i = 0; i < nmax; i++) wl.addRow([decs[i] || null, months[i] || null, heads[i] || null, lines[i] || null, ELIG_WORDS[i] || null, ITC_WORDS[i] || null]);
  return wb;
}

export async function make(reg, M) {
  const ExcelJS = await excelJs(), d = ITCF.excelData(reg, M), wb = await build(ExcelJS, d);
  const buffer = await wb.xlsx.writeBuffer(), co = String(d.client || "client").replace(/[^A-Za-z0-9]+/g, "-");
  return { buffer, name: co + "-2B-and-ITC-" + (d.gstin || reg) + "-" + d.label.replace(/[^A-Za-z0-9]+/g, "-") + ".xlsx", data: d };
}
export async function download(reg, M) {
  const x = await make(reg, M);
  await saveFile(x.name, new Blob([x.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  return x;
}

// ---- reading one back
const val = (c) => {
  let v = c && c.value;
  if (v == null) return null;
  if (typeof v === "object") {
    if (v instanceof Date) return v;
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return v.result == null ? null : v.result;
    if ("formula" in v || "sharedFormula" in v) return null;
    if ("text" in v) return v.text;
    if ("error" in v) return null;
  }
  return v;
};
const txt = (c) => { const v = val(c); return v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim(); };

export async function read(src) {
  const ExcelJS = await excelJs(), wb = new ExcelJS.Workbook();
  const buf = src && typeof src.arrayBuffer === "function" ? await src.arrayBuffer() : src;
  await wb.xlsx.load(buf);
  const ab = wb.getWorksheet(SH.about), wr = wb.getWorksheet(SH.reco), wa = wb.getWorksheet(SH.adj), wf = wb.getWorksheet(SH.fin);
  if (!wr || !ab) throw new Error("this is not FinCom's 2B and ITC Excel (its “2B reconciliation” or “About” sheet is missing)");
  const meta = {}; ab.eachRow((r) => { const k = txt(r.getCell(1)), v = txt(r.getCell(2)); if (k === "Month code") meta.month = v; if (k === "Registration") meta.reg = v; if (k === "GSTIN") meta.gstin = v; if (k === "Client id") meta.cid = v; if (k === "Format") meta.format = v; });
  if (meta.format && meta.format !== VERSION) throw new Error("made by another version of FinCom (" + meta.format + "): download it again");
  const rows = [];
  wr.eachRow((r, i) => {
    if (i === 1) return;
    const key = txt(r.getCell(RC.key + 1)), dec = txt(r.getCell(RC.dec + 1)), party = txt(r.getCell(RC.party + 1));
    if (!key && !dec && !party) return;
    rows.push({ row: i, key, dec, takeIn: txt(r.getCell(RC.takeIn + 1)), note: txt(r.getCell(RC.note + 1)), elig: txt(r.getCell(RC.elig + 1)), party, no: txt(r.getCell(RC.no + 1)) });
  });
  const inreg = [], wi = wb.getWorksheet(SH.inreg);
  if (wi) wi.eachRow((r, i) => {
    if (i === 1) return;
    const key = txt(r.getCell(IC.key + 1)); if (!key) return;
    const g = (k) => txt(r.getCell(IC[k] + 1));
    inreg.push({ row: i, key, elig: g("elig"), itc: g("itc"), takeIn: g("takeIn"), note: g("note"), x: { elig: g("xElig"), itc: g("xItc"), takeIn: g("xTakeIn"), note: g("xNote") }, party: g("party"), no: g("no") });
  });
  const adj = [];
  if (wa) wa.eachRow((r, i) => {
    if (i === 1) return;
    const a = { row: i, id: txt(r.getCell(1)), head: txt(r.getCell(2)), amt: val(r.getCell(3)), reason: txt(r.getCell(4)), line: txt(r.getCell(5)) };
    if (a.amt != null && typeof a.amt !== "number") a.amt = String(a.amt).trim();
    if (a.id || a.head || a.reason || a.line || (a.amt !== null && a.amt !== "")) adj.push(a);
  });
  let final = null;
  if (wf) {
    final = { calc: true };
    wf.eachRow((r) => { const code = txt(r.getCell(7)); if (!/^4[A-D]\d?$/.test(code)) return; const o = {}; H.forEach((h, i) => { const v = val(r.getCell(i + 2)); if (typeof v !== "number") final.calc = false; o[h] = typeof v === "number" ? Math.round(v * 100) / 100 : null; }); final[code] = o; });
  }
  return { meta, rows, inreg, adj, final };
}
if (typeof window !== "undefined") window.ITCExcel = { make, download, read, build };
