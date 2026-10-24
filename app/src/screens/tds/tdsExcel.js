// The TDS / TCS return's Excel (next-tds-excel, 24-Oct-2026): the workbook TDSX.data (app/src/lib/tdsXlsx.js) describes,
// written and read back with ExcelJS (the site's assets/exceljs.min.js, loaded the first time), as the 2B & ITC Excel is
// (app/src/screens/gst/itcExcel.js). Smart Excel, no macros: only functions Excel, LibreOffice and Google Sheets all have
// (IF, AND, OR, N, SUM, SUMIF, COUNTIF, INDEX, MATCH, VLOOKUP, OFFSET, COUNTA, TEXT, DAY, MONTH, YEAR, ROUND, SUBTOTAL).
// "It should be dynamic" (the owner): each list is an Excel Table (a row typed under it joins it in Excel), with formula
// columns filled for SPARE rows beyond the last, the dropdowns on every row to LAST, and every total on whole columns:
//   Deductor        a field a row: the value to fill (category and state from lists)
//   Challans        a challan a row (the hidden Key; a new row has none): BSR, date, serial, nature, minor head, tax,
//                   interest, fee, others, Total; interest / fee / others allocated to this return; Used in this return
//                   (SUMIF of Deductions' TDS on it), Used in other returns (FinCom's, locked), Balance (red below nil),
//                   interest / fee / others left; its Label (BSR/dd-mm-yyyy/serial), what the Deductions' picker lists
//   Deductions      a deduction a row: dates, deductee (a picker of Deductees, the PAN filled by INDEX/MATCH), section (a
//                   list; its name by VLOOKUP), rate, amount paid, TDS (= amount × rate), TDS in books, Difference, remark,
//                   certificate no., the 15G/15H UIN (from Deductees), challan (a picker of Challans' Label, new ones too)
//                   and its balance beside, voucher, source, what needs fixing
//   Deductees       the PAN book of the return: name, name in the file, PAN, PAN status, type; 26Q's declarations (T, B);
//                   27Q's country, nature, 15CA, tax ID, contact, address, DTAA, TRC
//   Salary annexure II   24Q Q4: each employee's declarations (Tally's payroll), FinCom's figures beside
//   Summary         TDS, on challans, the gap, by section; challans' tax and use; interest; the 234E fee: formulas
//   Checks          a row a deduction: the PAN's form, no challan or a challan over-used, the remark's rules, TDS over the
//                   amount; at the head the counts, and the pickers' last entry (proof that a new row is in the list)
//   About, Lists    what return the file is (read back to refuse another's), and the lists (hidden)
//   make(form, fy, q) -> {buffer, name}; download(form, fy, q); read(file | buffer) -> x for TDSX.preview
const G = globalThis;
const LAST = 2002;          // the dropdowns and the totals reach this row
const SPARE = { ded: 300, ch: 60, dee: 60 };
const NF = "#,##0.00;[Red]-#,##0.00", DF = "dd-mm-yyyy";
const SH = { dor: "Deductor", ch: "Challans", ded: "Deductions", dee: "Deductees", sal: "Salary annexure II", sum: "Summary", chk: "Checks", about: "About", lists: "Lists" };
const Q = (n) => "'" + n + "'!";
const col = (n) => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const idx = (L) => L.split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
const rg = (sh, L) => Q(sh) + "$" + L + "$3:$" + L + "$" + LAST;
const dt = (d) => (/^\d{8}$/.test(String(d || "")) ? new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8))) : null);
const VERSION = "fincom-tds-1";

// the columns, by letter (writer and reader share them)
const DED = { key: "A", date: "B", credit: "C", party: "D", pan: "E", section: "F", secName: "G", rate: "H", paid: "I", tds: "J", books: "K", diff: "L", remark: "M", cert: "N", uin: "O", challan: "P", chBal: "Q", voucher: "R", src: "S", fix: "T", tdsNow: "U" };
const CH = { key: "A", bsr: "B", date: "C", serial: "D", section: "E", minor: "F", tax: "G", interest: "H", fee: "I", others: "J", total: "K", ia: "L", fa: "M", oa: "N", usedHere: "O", usedElse: "P", bal: "Q", allocElse: "R", left: "S", mode: "T", src: "U", label: "V" };
const DEE26 = { key: "A", name: "B", nameFile: "C", pan: "D", status: "E", type: "F", secs: "G", n: "H", tds: "I", t: "J", decl: "K", uin: "L", declDate: "M" };
const DEE27 = { key: "A", name: "B", nameFile: "C", pan: "D", status: "E", type: "F", secs: "G", n: "H", tds: "I", country: "J", nature: "K", ack15ca: "L", tin: "M", email: "N", phone: "O", address: "P", dtaa: "Q", trc: "R" };
const DEE = { key: "A", name: "B", nameFile: "C", pan: "D", status: "E", type: "F", secs: "G", n: "H", tds: "I" };
const deeCols = (form) => (form === "26Q" ? DEE26 : form === "27Q" ? DEE27 : DEE);

async function excelJs() {
  if (G.ExcelJS) return G.ExcelJS;
  if (typeof G.loadScriptOnce !== "function") throw new Error("exceljs.min.js could not be loaded");
  await G.loadScriptOnce("exceljs.min.js");
  if (!G.ExcelJS) throw new Error("exceljs.min.js could not be loaded");
  return G.ExcelJS;
}
const OPEN = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBE6" } }, HEAD = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF3F8" } }, GREY = { argb: "FF5B6573" };
function headRow(ws, r, cols) {
  const row = ws.getRow(r); row.font = { bold: true }; row.alignment = { vertical: "middle", wrapText: true }; row.height = 32;
  Object.keys(cols).forEach((k) => { const c = row.getCell(idx(cols[k].L)); c.fill = HEAD; });
}
// an Excel Table over rows 2 (its header) to the last row given (the data and the spare rows)
function table(ws, name, colsInOrder, rows, style) {
  ws.addTable({ name, ref: "A2", headerRow: true, totalsRow: false, style: { theme: style || "TableStyleLight1", showRowStripes: false },
    columns: colsInOrder.map((c) => ({ name: c.h, filterButton: true })), rows: rows.length ? rows : [colsInOrder.map(() => null)] });
}
function listV(cell, f, strict, words) { cell.dataValidation = { type: "list", allowBlank: true, formulae: [f], showErrorMessage: !!strict, errorStyle: strict ? "stop" : "warning", error: words || "Choose from the list." }; }

export async function build(ExcelJS, d) {
  const wb = new ExcelJS.Workbook(); wb.creator = "FinCom"; wb.created = new Date();
  const { form, fy, q } = d.meta, L = d.lists, tcs = form === "27EQ", sal = form === "24Q";
  const unit = tcs ? "collection" : sal ? "salary payment" : "deduction", TAXW = tcs ? "TCS" : "TDS";
  // ---- Lists (hidden; written first so every other sheet can point at it)
  const secList = tcs ? L.codes : L.sections;
  const LST = { sec: "A", secName: "B", remark: "C", type: "D", rate: "E", status: "F", yesno: "G", minor: "H", decl: "I", mode: "J", state: "K", cat: "L", country: "M", regime: "N" };
  const lists = { sec: secList.map((x) => x[0]), secName: secList.map((x) => x[1]), remark: L.remarks, type: L.types, rate: L.rates, status: L.status, yesno: L.yesno, minor: L.minor, decl: L.decl, mode: L.modes, state: L.states, cat: L.cats, country: L.countries, regime: L.regime };
  const LR = (k) => Q(SH.lists) + "$" + LST[k] + "$1:$" + LST[k] + "$" + Math.max(1, lists[k].length);

  // ---- Deductor
  const wd = wb.addWorksheet(SH.dor);
  wd.getCell("A1").value = "Deductor (the deductor's and the responsible person's details, used in every TDS / TCS statement)"; wd.getCell("A1").font = { bold: true };
  wd.getRow(2).values = ["Key", "Field", "Value", "Note"]; wd.getRow(2).font = { bold: true };
  [10, 40, 44, 50].forEach((w, i) => { wd.getColumn(i + 1).width = w; }); wd.getColumn(1).hidden = true;
  d.deductor.forEach((x, i) => {
    const row = wd.getRow(i + 3); row.values = [x.k, x.label, x.v, x.hint || ""];
    const c = row.getCell(3); c.fill = OPEN;
    if (x.kind === "cat") listV(c, LR("cat"), true); if (x.kind === "state") listV(c, LR("state"), true);
    if (/^(tan|personPan)$/.test(x.k)) c.dataValidation = { type: "textLength", operator: "equal", formulae: [10], allowBlank: true, showErrorMessage: true, error: "10 characters" };
  });
  wd.views = [{ state: "frozen", ySplit: 2 }];

  // ---- Challans
  const wc = wb.addWorksheet(SH.ch), CC = [
    ["key", "Key (do not change)", 8], ["bsr", "BSR code", 11], ["date", "Date of deposit", 13], ["serial", "Challan serial", 10], ["section", "Section / nature", 11], ["minor", "Minor head", 8],
    ["tax", "Tax", 13], ["interest", "Interest", 11], ["fee", "Fee 234E", 11], ["others", "Others", 10], ["total", "Total", 13], ["ia", "Interest allocated here", 12], ["fa", "Fee allocated here", 12], ["oa", "Others allocated here", 12],
    ["usedHere", "Used in this return", 13], ["usedElse", "Used in other returns", 13], ["bal", "Balance", 13], ["allocElse", "Interest / fee / others allocated elsewhere", 14], ["left", "Interest / fee / others left", 13],
    ["mode", "Mode", 9], ["src", "Source", 11], ["label", "Challan (as picked on Deductions)", 30]].map(([k, h, w]) => ({ k, h, w, L: CH[k] }));
  const chF = (r) => ({
    total: { formula: 'IF(B' + r + '="","",N(G' + r + ")+N(H" + r + ")+N(I" + r + ")+N(J" + r + "))" },
    usedHere: { formula: 'IF(V' + r + '="","",SUMIF(' + rg(SH.ded, DED.challan) + ",V" + r + "," + rg(SH.ded, DED.tds) + "))" },
    bal: { formula: 'IF(V' + r + '="","",N(G' + r + ")-N(O" + r + ")-N(P" + r + "))" },
    left: { formula: 'IF(V' + r + '="","",N(H' + r + ")+N(I" + r + ")+N(J" + r + ")-N(L" + r + ")-N(M" + r + ")-N(N" + r + ")-N(R" + r + "))" },
    label: { formula: 'IF(B' + r + '="","",B' + r + '&"/"&IF(ISNUMBER(C' + r + '),TEXT(DAY(C' + r + '),"00")&"-"&TEXT(MONTH(C' + r + '),"00")&"-"&YEAR(C' + r + "),C" + r + ')&"/"&D' + r + ")" },
  });
  const chRows = d.challans.map((c, i) => {
    const r = i + 3, f = chF(r);
    const v = { key: c.key, bsr: c.bsr, date: dt(c.date), serial: c.serial, section: c.section, minor: c.minor, tax: c.tax, interest: c.interest, fee: c.fee, others: c.others,
      total: Object.assign(f.total, { result: c.tax + c.interest + c.fee + c.others }), ia: c.ia, fa: c.fa, oa: c.oa, usedHere: Object.assign(f.usedHere, { result: c.usedHere }), usedElse: c.usedElse,
      bal: Object.assign(f.bal, { result: Math.round((c.tax - c.usedHere - c.usedElse) * 100) / 100 }), allocElse: c.allocElse, left: Object.assign(f.left, { result: Math.round((c.interest + c.fee + c.others - c.ia - c.fa - c.oa - c.allocElse) * 100) / 100 }),
      mode: c.mode, src: c.src, label: Object.assign(f.label, { result: c.label }) };
    return CC.map((x) => v[x.k] === undefined ? null : v[x.k]);
  });
  for (let i = 0; i < SPARE.ch; i++) { const r = d.challans.length + i + 3, f = chF(r); chRows.push(CC.map((x) => f[x.k] ? Object.assign({}, f[x.k], { result: "" }) : null)); }
  wc.getCell("A1").value = "Total"; wc.getCell("B1").value = "Challans · add a row under the last (no Key) for a new challan";
  table(wc, "tChallans", CC, chRows, "TableStyleLight9"); wc.getCell("B1").alignment = { wrapText: false };
  CC.forEach((x) => { wc.getColumn(idx(x.L)).width = x.w; });
  ["tax", "interest", "fee", "others", "total", "ia", "fa", "oa", "usedHere", "usedElse", "bal", "allocElse", "left"].forEach((k) => { wc.getColumn(idx(CH[k])).numFmt = NF; wc.getCell(CH[k] + "1").value = { formula: "SUBTOTAL(109," + CH[k] + "3:" + CH[k] + LAST + ")" }; wc.getCell(CH[k] + "1").font = { bold: true }; });
  wc.getColumn(idx(CH.date)).numFmt = DF; wc.getColumn(idx(CH.serial)).numFmt = "@"; wc.getColumn(idx(CH.bsr)).numFmt = "@"; wc.getColumn(1).hidden = true;
  for (let r = 3; r <= LAST; r++) {
    const tl = r - 3 < d.challans.length && d.challans[r - 3].tally;
    ["bsr", "date", "serial", "section", "minor", "tax", "interest", "fee", "others", "ia", "fa", "oa", "mode"].forEach((k) => { const c = wc.getCell(CH[k] + r); if (!(tl && !/^(section|ia|fa|oa)$/.test(k))) c.fill = OPEN; else c.font = { color: GREY }; });
    listV(wc.getCell(CH.minor + r), LR("minor"), true, "200 or 400"); listV(wc.getCell(CH.mode + r), LR("mode"), true, "online or bank");
    if (r > 2 + d.challans.length + SPARE.ch) break;
  }
  wc.addConditionalFormatting({ ref: CH.bal + "3:" + CH.bal + LAST, rules: [{ type: "cellIs", operator: "lessThan", formulae: ["-0.004"], priority: 1, style: { font: { color: { argb: "FFC00000" }, bold: true }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFDE2E2" } } } }] });
  wc.views = [{ state: "frozen", ySplit: 2, xSplit: 4 }];

  // ---- Deductions
  const wx = wb.addWorksheet(SH.ded), DC = [
    ["key", "Key (do not change)", 8], ["date", tcs ? "Date of collection" : "Date of deduction", 12], ["credit", tcs ? "Date received / debited" : "Date paid or credited", 12], ["party", tcs ? "Buyer" : sal ? "Employee" : "Deductee", 30],
    ["pan", "PAN", 12], ["section", tcs ? "Collection code" : "Section", 10], ["secName", tcs ? "Collection" : "Section name", 26], ["rate", "Rate %", 8], ["paid", tcs ? "Amount received" : "Amount paid", 14], ["tds", TAXW, 13],
    ["books", TAXW + " in books", 13], ["diff", "Difference", 11], ["remark", "Remark", 8], ["cert", "Certificate no. (lower deduction)", 14], ["uin", "15G / 15H / Form 121 UIN", 16], ["challan", "Challan (pick)", 30], ["chBal", "Challan's balance", 13],
    ["voucher", "Voucher", 10], ["src", "Source", 12], ["fix", "Needs fixing (FinCom)", 34], ["tdsNow", TAXW + " in FinCom", 10]].map(([k, h, w]) => ({ k, h, w, L: DED[k] }));
  const LD = (k, r) => DED[k] + r;
  const dF = (r) => ({
    pan: { formula: 'IF(D' + r + '="","",IFERROR(INDEX(' + rg(SH.dee, "D") + ",MATCH(D" + r + "," + rg(SH.dee, "B") + ',0))&"",""))' },
    secName: { formula: 'IF(F' + r + '="","",IFERROR(VLOOKUP(F' + r + "," + Q(SH.lists) + "$A$1:$B$" + Math.max(1, lists.sec.length) + ',2,FALSE),""))' },
    tds: { formula: 'IF(AND(I' + r + '="",H' + r + '=""),"",IF(N(I' + r + ")=0,N(U" + r + "),ROUND(N(I" + r + ")*N(H" + r + ")/100,2)))" },
    diff: { formula: 'IF(OR(J' + r + '="",K' + r + '=""),"",J' + r + "-K" + r + ")" },
    uin: form === "26Q" ? { formula: 'IF(D' + r + '="","",IFERROR(INDEX(' + rg(SH.dee, "L") + ",MATCH(D" + r + "," + rg(SH.dee, "B") + ',0))&"",""))' } : null,
    chBal: { formula: 'IF(P' + r + '="","",IFERROR(INDEX(' + rg(SH.ch, CH.bal) + ",MATCH(P" + r + "," + rg(SH.ch, CH.label) + ',0)),"not on Challans"))' },
  });
  const dRows = d.deductions.map((x, i) => {
    const r = i + 3, f = dF(r), v = { key: x.key, date: dt(x.date), credit: dt(x.credit), party: x.party, pan: x.panOwn ? x.pan : Object.assign(f.pan, { result: x.pan || "" }), section: x.section,
      secName: Object.assign(f.secName, { result: (secList.find((s) => s[0] === x.section) || [])[1] || "" }), rate: x.rate, paid: x.paid, tds: Object.assign(f.tds, { result: x.tds }), books: x.books,
      diff: Object.assign(f.diff, { result: Math.round((x.tds - x.books) * 100) / 100 }), remark: x.remark, cert: x.cert, uin: f.uin ? Object.assign(f.uin, { result: (d.deductees.find((p) => p.name === x.party) || {}).uin || "" }) : null,
      challan: x.challan, chBal: Object.assign(f.chBal, { result: x.challan ? ((d.challans.find((c) => c.label === x.challan) || {}).tax || 0) - ((d.challans.find((c) => c.label === x.challan) || {}).usedHere || 0) - ((d.challans.find((c) => c.label === x.challan) || {}).usedElse || 0) : "" }),
      voucher: x.voucher, src: x.src, fix: x.fix, tdsNow: x.tds };
    return DC.map((c) => v[c.k] === undefined ? null : v[c.k]);
  });
  for (let i = 0; i < SPARE.ded; i++) { const r = d.deductions.length + i + 3, f = dF(r); dRows.push(DC.map((c) => (f[c.k] ? Object.assign({}, f[c.k], { result: "" }) : null))); }
  wx.getCell("A1").value = "Total"; wx.getCell("B1").value = (tcs ? "Collections" : "Deductions") + " · add a row under the last (no Key); delete a row to take it out of the return (it stays in the books)";
  table(wx, "tDeductions", DC, dRows, "TableStyleLight9"); wx.getCell("B1").alignment = { wrapText: false };
  DC.forEach((c) => { wx.getColumn(idx(c.L)).width = c.w; });
  ["paid", "tds", "books", "diff", "chBal", "tdsNow"].forEach((k) => { wx.getColumn(idx(DED[k])).numFmt = NF; });
  ["paid", "tds", "books", "diff"].forEach((k) => { wx.getCell(DED[k] + "1").value = { formula: "SUBTOTAL(109," + DED[k] + "3:" + DED[k] + LAST + ")" }; wx.getCell(DED[k] + "1").font = { bold: true }; });
  wx.getColumn(idx(DED.rate)).numFmt = "0.00##"; wx.getColumn(idx(DED.date)).numFmt = DF; wx.getColumn(idx(DED.credit)).numFmt = DF;
  [DED.key, DED.tdsNow].forEach((Lt) => { wx.getColumn(idx(Lt)).hidden = true; }); if (form !== "26Q") wx.getColumn(idx(DED.uin)).hidden = true; if (sal) wx.getColumn(idx(DED.cert)).hidden = true;
  const deePick = "OFFSET(" + Q(SH.dee) + "$B$3,0,0,MAX(1,COUNTA(" + rg(SH.dee, "B") + ")),1)", chPick = "OFFSET(" + Q(SH.ch) + "$" + CH.label + "$3,0,0,MAX(1,COUNTA(" + rg(SH.ch, CH.bsr) + ")),1)";
  const lastD = d.deductions.length + SPARE.ded + 2;
  for (let r = 3; r <= lastD; r++) {
    ["date", "credit", "party", "section", "rate", "paid", "remark", "cert", "challan"].forEach((k) => { wx.getCell(LD(k, r)).fill = OPEN; });
    listV(wx.getCell(LD("party", r)), deePick, false, "Pick a " + (tcs ? "buyer" : sal ? "employee" : "deductee") + " of the Deductees sheet (or add one there)");
    listV(wx.getCell(LD("section", r)), LR("sec"), true, tcs ? "Choose the collection code from the list" : "Choose a section of " + d.meta.formName + " from the list");
    listV(wx.getCell(LD("rate", r)), LR("rate"), false, "A rate from the list, or type another (a certificate's lower rate)");
    listV(wx.getCell(LD("remark", r)), LR("remark"), true, "Remarks " + d.meta.formName + " takes: " + L.remarks.join(", "));
    listV(wx.getCell(LD("challan", r)), chPick, true, "Pick a challan of the Challans sheet (add a new one there first)");
    wx.getCell(LD("pan", r)).font = { color: GREY };
  }
  wx.views = [{ state: "frozen", ySplit: 2, xSplit: 4 }];

  // ---- Deductees
  const wde = wb.addWorksheet(SH.dee), DM = deeCols(form), hd = { key: "Key (do not change)", name: tcs ? "Buyer" : sal ? "Employee" : "Deductee", nameFile: "Name in the file (if not as in the books)", pan: "PAN", status: "PAN status", type: "Type",
    secs: tcs ? "Codes" : "Sections", n: "Rows", tds: TAXW, t: "Transporter declaration (T, 194C)", decl: "15G / 15H (B)", uin: "UIN (Form 121)", declDate: "Declaration received", country: "Country", nature: "Nature of remittance",
    ack15ca: "15CA acknowledgement", tin: "Tax ID in the country", email: "E-mail", phone: "Phone", address: "Address", dtaa: "Treaty (DTAA) rate", trc: "TRC and Form 10F" };
  const EC = Object.keys(DM).map((k) => ({ k, h: hd[k], L: DM[k], w: { key: 8, name: 30, nameFile: 24, pan: 12, status: 12, type: 12, secs: 14, n: 7, tds: 13, address: 30 }[k] || 14 }));
  const eF = (r) => ({ n: { formula: 'IF(B' + r + '="","",COUNTIF(' + rg(SH.ded, DED.party) + ",B" + r + "))" }, tds: { formula: 'IF(B' + r + '="","",SUMIF(' + rg(SH.ded, DED.party) + ",B" + r + "," + rg(SH.ded, DED.tds) + "))" } });
  const eRows = d.deductees.map((p, i) => { const f = eF(i + 3); const v = Object.assign({}, p, { declDate: dt(p.declDate), n: Object.assign(f.n, { result: p.n }), tds: Object.assign(f.tds, { result: p.tds }) }); return EC.map((c) => v[c.k] === undefined || v[c.k] === "" ? (v[c.k] === "" ? "" : null) : v[c.k]); });
  for (let i = 0; i < SPARE.dee; i++) { const f = eF(d.deductees.length + i + 3); eRows.push(EC.map((c) => (f[c.k] ? Object.assign({}, f[c.k], { result: "" }) : null))); }
  wde.getCell("A1").value = ""; wde.getCell("B1").value = (tcs ? "Buyers" : sal ? "Employees" : "Deductees") + " (the PAN book) · add a row under the last for a new one; the Deductions sheet picks from here";
  table(wde, "tDeductees", EC, eRows, "TableStyleLight9"); wde.getCell("B1").alignment = { wrapText: false };
  EC.forEach((c) => { wde.getColumn(idx(c.L)).width = c.w; }); wde.getColumn(1).hidden = true; wde.getColumn(idx(DM.tds)).numFmt = NF; if (DM.declDate) wde.getColumn(idx(DM.declDate)).numFmt = DF;
  const lastE = d.deductees.length + SPARE.dee + 2;
  for (let r = 3; r <= lastE; r++) {
    Object.keys(DM).filter((k) => !/^(key|secs|n|tds)$/.test(k)).forEach((k) => { wde.getCell(DM[k] + r).fill = OPEN; });
    listV(wde.getCell(DM.status + r), LR("status"), true); listV(wde.getCell(DM.type + r), LR("type"), true);
    wde.getCell(DM.pan + r).dataValidation = { type: "textLength", operator: "equal", formulae: [10], allowBlank: true, showErrorMessage: true, errorStyle: "warning", error: "A PAN is 10 characters: five letters, four digits, a letter" };
    if (DM.t) { listV(wde.getCell(DM.t + r), LR("yesno"), true); listV(wde.getCell(DM.decl + r), LR("decl"), true); }
    if (DM.dtaa) { listV(wde.getCell(DM.dtaa + r), LR("yesno"), true); listV(wde.getCell(DM.trc + r), LR("yesno"), true); listV(wde.getCell(DM.country + r), LR("country"), false); }
  }
  wde.views = [{ state: "frozen", ySplit: 2, xSplit: 2 }];

  // ---- Salary annexure II (24Q Q4)
  if (d.salary) {
    const ws2 = wb.addWorksheet(SH.sal), SAL = G.TDSX ? G.TDSX.SAL : [], FIG = [["gross", "Gross salary"], ["exempt", "HRA exempt"], ["standard", "Standard deduction"], ["chapter6", "Chapter VI-A"], ["taxable", "Total income"], ["tax", "Tax payable"], ["tds", "TDS here"]];
    const SC = [{ k: "key", h: "Key (do not change)" }, { k: "name", h: "Employee" }, { k: "pan", h: "PAN" }].concat(SAL.map(([k, h]) => ({ k, h }))).concat(FIG.map(([k, h]) => ({ k: "f:" + k, h: h + " (FinCom)" })));
    ws2.getCell("B1").value = "Each employee's declarations (Tally's payroll): change them here; FinCom works the tax out again on upload";
    table(ws2, "tSalary", SC, d.salary.map((e) => SC.map((c) => c.k === "key" ? e.key : c.k === "name" ? e.name : c.k === "pan" ? e.pan : c.k.startsWith("f:") ? e.fig[c.k.slice(2)] : e.v[c.k] == null ? "" : e.v[c.k])), "TableStyleLight9");
    SC.forEach((c, i) => { ws2.getColumn(i + 1).width = i < 3 ? [8, 28, 12][i] : 12; if (c.k.startsWith("f:")) ws2.getColumn(i + 1).numFmt = NF; });
    ws2.getColumn(1).hidden = true;
    d.salary.forEach((e, j) => { if (!e.key) return; SAL.forEach(([k], i) => { const c = ws2.getRow(j + 3).getCell(i + 4); c.fill = OPEN; if (k === "regime") listV(c, LR("regime"), true); if (/^(senior|hraMetro|parentsSenior)$/.test(k)) listV(c, LR("yesno"), true); }); });
    ws2.views = [{ state: "frozen", ySplit: 2, xSplit: 2 }];
  }

  // ---- Summary
  const wsu = wb.addWorksheet(SH.sum), s = d.summary;
  wsu.getRow(1).values = ["", d.meta.formName + " · " + q + " " + fy + " · " + d.meta.client]; wsu.getRow(1).font = { bold: true };
  wsu.getRow(2).values = ["Key", "", "In this Excel", "FinCom at download"]; wsu.getRow(2).font = { bold: true };
  [8, 46, 18, 18].forEach((w, i) => { wsu.getColumn(i + 1).width = w; }); wsu.getColumn(1).hidden = true; wsu.getColumn(3).numFmt = NF; wsu.getColumn(4).numFmt = NF;
  const at = {}; let sr = 3;
  const put = (k, label, f, fin, fmt) => { const row = wsu.getRow(sr); row.values = [k, label, f, fin]; if (fmt) { row.getCell(3).numFmt = fmt; row.getCell(4).numFmt = fmt; } at[k] = sr++; return row; };
  put("n", unit[0].toUpperCase() + unit.slice(1) + "s", { formula: "COUNT(" + rg(SH.ded, DED.tds) + ")" }, s.n, "0");
  put("paid", tcs ? "Amount received" : "Amount paid or credited", { formula: "SUM(" + rg(SH.ded, DED.paid) + ")" }, s.paid);
  put("tds", TAXW + " total", { formula: "SUM(" + rg(SH.ded, DED.tds) + ")" }, s.tds).font = { bold: true };
  put("onch", TAXW + " on challans", { formula: 'SUMIF(' + rg(SH.ded, DED.challan) + ',"<>",' + rg(SH.ded, DED.tds) + ")" }, s.onch);
  put("gap", TAXW + " on no challan (gap)", { formula: "C" + at.tds + "-C" + at.onch }, s.gap).font = { bold: true };
  put("chtax", "Challans' tax deposited", { formula: "SUM(" + rg(SH.ch, CH.tax) + ")" }, null);
  put("chused", "Challans used by this return", { formula: "SUM(" + rg(SH.ch, CH.usedHere) + ")" }, null);
  put("over", "Challans over-used (balance below nil)", { formula: 'COUNTIF(' + rg(SH.ch, CH.bal) + ',"<-0.004")' }, null, "0");
  put("ia", "Interest allocated to this return", { formula: "SUM(" + rg(SH.ch, CH.ia) + ")" }, s.ia);
  put("interest", "Interest due (201(1A) / 206C(7), FinCom)", s.interest, s.interest);
  put("due", "Return due", dt(s.due), dt(s.due), DF);
  put("asof", "Filed on, or as of", dt(s.asOf), dt(s.asOf), DF);
  put("days", "Days late", { formula: "MAX(0,C" + at.asof + "-C" + at.due + ")" }, null, "0");
  put("fee", "Late fee 234E (₹200 a day, up to the " + TAXW + ")", { formula: "MIN(200*C" + at.days + ",C" + at.tds + ")" }, s.fee).font = { bold: true };
  sr++; wsu.getRow(sr).values = ["", "By " + (tcs ? "collection code" : "section"), unit + "s · amount · " + TAXW]; wsu.getRow(sr).font = { bold: true }; sr++;
  const secs = Array.from(new Set(Object.keys(s.bySec).concat(lists.sec))).filter(Boolean);
  wsu.getRow(sr).values = ["", "", "Count", "Amount", TAXW]; sr++;
  secs.filter((x) => s.bySec[x] || secList.length < 30).forEach((x) => {
    const row = wsu.getRow(sr), crit = '"' + x + '"';
    row.values = ["sec:" + x, x + " · " + ((secList.find((z) => z[0] === x) || [])[1] || ""), { formula: "COUNTIF(" + rg(SH.ded, DED.section) + "," + crit + ")" }, { formula: "SUMIF(" + rg(SH.ded, DED.section) + "," + crit + "," + rg(SH.ded, DED.paid) + ")" }, { formula: "SUMIF(" + rg(SH.ded, DED.section) + "," + crit + "," + rg(SH.ded, DED.tds) + ")" }];
    row.getCell(3).numFmt = "0"; row.getCell(5).numFmt = NF; sr++;
  });
  wsu.getColumn(5).width = 16;
  await wsu.protect("", { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true });

  // ---- Checks
  const wk = wb.addWorksheet(SH.chk);
  [8, 30, 18, 24, 34, 22].forEach((w, i) => { wk.getColumn(i + 1).width = w; });
  wk.getRow(1).values = ["Row", "Challans", { formula: 'IF(COUNTIF(' + rg(SH.ch, CH.bal) + ',"<-0.004")>0,"Challan over-used: "&COUNTIF(' + rg(SH.ch, CH.bal) + ',"<-0.004"),"No challan over-used")' }, "Pickers' last entries",
    { formula: 'IFERROR(INDEX(' + chPick + ",COUNTA(" + rg(SH.ch, CH.bsr) + ')),"")' }, { formula: 'IFERROR(INDEX(' + deePick + ",COUNTA(" + rg(SH.dee, "B") + ')),"")' }];
  wk.getRow(2).values = ["Row", tcs ? "Buyer" : sal ? "Employee" : "Deductee", "PAN", "Challan", "Remark", "Amount"]; wk.getRow(2).font = { bold: true };
  const D_ = (Lt, r) => Q(SH.ded) + Lt + r;
  const lastK = lastD;
  for (let r = 3; r <= lastK; r++) {
    const p = D_(DED.pan, r), m = D_(DED.remark, r), live = 'AND(' + D_(DED.party, r) + '="",' + D_(DED.paid, r) + '="")';
    const panBad = "OR(LEN(" + p + ")<>10,NOT(ISNUMBER(--MID(" + p + ",6,4))),SUMPRODUCT(--(ABS(CODE(MID(UPPER(" + p + "),{1,2,3,4,5,10},1))-77.5)>12.5))>0)";
    wk.getRow(r).values = [r, { formula: "IF(" + live + ',"",' + D_(DED.party, r) + ")" },
      { formula: "IF(" + live + ',"",IF(' + p + '="","No PAN",IF(' + panBad + ',"PAN not in its form","")))' },
      { formula: "IF(" + live + ',"",IF(' + D_(DED.challan, r) + '="","No challan",IF(N(' + D_(DED.chBal, r) + ')<-0.004,"Challan over-used",IF(' + D_(DED.chBal, r) + '="not on Challans","Challan not on Challans",""))))' },
      { formula: "IF(OR(" + live + "," + m + '=""),"",IF(AND(OR(' + m + '="B",' + m + '="T",' + m + '="Y"),N(' + D_(DED.tds, r) + ')>0),"Remark "&' + m + '&" is for no tax",IF(AND(' + m + '="A",' + D_(DED.cert, r) + '=""),"Remark A needs the certificate no.",IF(AND(' + m + '="T",LEFT(' + D_(DED.section, r) + ',4)<>"194C"),"Remark T is for 194C",""))))' },
      { formula: "IF(" + live + ',"",IF(AND(N(' + D_(DED.paid, r) + ")>0,N(" + D_(DED.tds, r) + ")>N(" + D_(DED.paid, r) + ')),"' + TAXW + ' over the amount",""))' }];
  }
  wk.views = [{ state: "frozen", ySplit: 2 }];
  await wk.protect("", { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true });

  // ---- About
  const wa = wb.addWorksheet(SH.about); wa.getColumn(1).width = 20; wa.getColumn(2).width = 90;
  [["Client", d.meta.client], ["Client id", d.meta.cid], ["TAN", d.meta.tan], ["Form", form], ["Form name", d.meta.formName], ["Year", fy], ["Quarter", q], ["Made", d.meta.made], ["Format", VERSION]].forEach((x) => wa.addRow(x));
  wa.addRow([]);
  ["How to use: change any yellow cell. Add a challan, a deductee or a " + unit + " in the first empty row under its table (leave the Key empty).",
    "Delete a row of Deductions to take it out of the return: it stays in the books. Pick each " + unit + "'s challan from the list (new challans too).",
    "Summary and Checks work themselves out as you go. Then in FinCom, the return's ⋯, Upload Excel: a preview shows every change, Apply saves it, Undo takes it back."].forEach((t) => wa.addRow(["", t]));
  await wa.protect("", { selectLockedCells: true, selectUnlockedCells: true });
  const wl = wb.addWorksheet(SH.lists, { state: "hidden" });
  const nmax = Math.max(...Object.values(lists).map((l) => l.length), 1);
  for (let i = 0; i < nmax; i++) { const row = wl.getRow(i + 1); Object.keys(LST).forEach((k) => { const v = lists[k][i]; if (v != null) row.getCell(idx(LST[k])).value = k === "rate" ? v : String(v); }); }
  // the sheets in the return's order: Deductor, Deductees, Challans, Deductions, (Salary), Summary, Checks
  return wb;
}

export async function make(form, fy, q) {
  const ExcelJS = await excelJs(), d = G.TDSX.data(form, fy, q), wb = await build(ExcelJS, d);
  const buffer = await wb.xlsx.writeBuffer(), co = String(d.meta.client || "client").replace(/[^A-Za-z0-9]+/g, "-");
  return { buffer, name: co + "-" + String(d.meta.formName).replace(/[^A-Za-z0-9]+/g, "-").replace(/-+$/, "") + "-" + q + "-" + fy + ".xlsx", data: d };
}
export async function download(form, fy, q) {
  const x = await make(form, fy, q);
  await saveFile(x.name, new Blob([x.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  return x;
}

// ---- reading one back
const raw = (c) => {
  let v = c && c.value;
  if (v == null) return { v: null, f: false };
  if (typeof v === "object" && !(v instanceof Date)) {
    if (Array.isArray(v.richText)) return { v: v.richText.map((t) => t.text).join(""), f: false };
    if ("formula" in v || "sharedFormula" in v) return { v: v.result == null || (typeof v.result === "object" && v.result && v.result.error) ? null : v.result, f: true };
    if ("text" in v) return { v: v.text, f: false };
    if ("error" in v) return { v: null, f: false };
    if ("result" in v) return { v: v.result, f: true };
  }
  return { v, f: false };
};
const val = (c) => raw(c).v;
const txt = (c) => { const v = val(c); return v == null ? "" : v instanceof Date ? v : String(v).trim(); };
const pad = (v, n) => { const s = v instanceof Date ? "" : String(v == null ? "" : v).trim(); return /^\d+$/.test(s) && s.length < n ? s.padStart(n, "0") : s; };

export async function read(src) {
  const ExcelJS = await excelJs(), wb = new ExcelJS.Workbook();
  const buf = src && typeof src.arrayBuffer === "function" ? await src.arrayBuffer() : src;
  await wb.xlsx.load(buf);
  const ab = wb.getWorksheet(SH.about), wx = wb.getWorksheet(SH.ded);
  if (!ab || !wx) throw new Error("this is not FinCom's TDS return Excel (its “Deductions” or “About” sheet is missing)");
  const meta = {};
  const MK = { "Client id": "cid", Client: "client", TAN: "tan", Form: "form", Year: "fy", Quarter: "q", Format: "ver" };
  for (let i = 1; i <= Math.min(30, ab.rowCount); i++) { const r = ab.getRow(i), k = String(txt(r.getCell(1))); if (MK[k]) meta[MK[k]] = String(txt(r.getCell(2))); }
  const form = meta.form, out = { meta, deductor: [], challans: [], deductions: [], deductees: [], salary: [], summary: {} };
  const cell = (ws, L, r) => ws.getCell(L + r);
  const wd = wb.getWorksheet(SH.dor);
  if (wd) wd.eachRow((r, i) => { if (i < 3) return; const k = String(txt(r.getCell(1))); if (k) out.deductor.push({ row: i, k, v: txt(r.getCell(3)) }); });
  const wc = wb.getWorksheet(SH.ch);
  if (wc) for (let r = 3; r <= Math.min(LAST, wc.rowCount); r++) {
    const g = (k) => val(cell(wc, CH[k], r));
    const y = { row: r, key: String(txt(cell(wc, CH.key, r))), bsr: pad(g("bsr"), 7), date: g("date"), serial: pad(g("serial"), 5), section: txt(cell(wc, CH.section, r)), minor: String(txt(cell(wc, CH.minor, r))),
      tax: g("tax"), interest: g("interest"), fee: g("fee"), others: g("others"), ia: g("ia"), fa: g("fa"), oa: g("oa"), mode: String(txt(cell(wc, CH.mode, r))) };
    if (y.key || y.bsr || y.serial || (y.date != null && y.date !== "") || (y.tax != null && y.tax !== "")) out.challans.push(y);
  }
  for (let r = 3; r <= Math.min(LAST, wx.rowCount); r++) {
    const g = (k) => raw(cell(wx, DED[k], r)), pan = g("pan"), tds = g("tds");
    const y = { row: r, key: String(txt(cell(wx, DED.key, r))), date: g("date").v, credit: g("credit").v, party: String(txt(cell(wx, DED.party, r))), pan: pan.v == null ? "" : String(pan.v), panF: pan.f,
      section: String(txt(cell(wx, DED.section, r))), rate: g("rate").v, paid: g("paid").v, tds: tds.v === "" ? null : tds.v, tdsF: tds.f, remark: String(txt(cell(wx, DED.remark, r))), cert: String(txt(cell(wx, DED.cert, r))), challan: String(txt(cell(wx, DED.challan, r))) };
    if (y.key || y.party || y.section || (y.paid != null && y.paid !== "") || (y.date != null && y.date !== "") || y.challan) out.deductions.push(y);
  }
  const we = wb.getWorksheet(SH.dee), DM = deeCols(form);
  if (we) for (let r = 3; r <= Math.min(LAST, we.rowCount); r++) {
    const y = { row: r }; Object.keys(DM).forEach((k) => { const v = val(cell(we, DM[k], r)); y[k] = k === "declDate" ? v : v == null ? "" : v instanceof Date ? v : String(v).trim(); });
    delete y.n; delete y.tds; delete y.secs;
    if (y.key || y.name || y.pan) out.deductees.push(y);
  }
  const ws2 = wb.getWorksheet(SH.sal);
  if (ws2 && G.TDSX) { const SAL = G.TDSX.SAL; ws2.eachRow((r, i) => { if (i < 3) return; const key = String(txt(r.getCell(1))); if (!key) return; const y = { row: i, key }; SAL.forEach(([k], j) => { const v = val(r.getCell(j + 4)); y[k] = v == null ? "" : String(v).trim(); }); out.salary.push(y); }); }
  const wsu = wb.getWorksheet(SH.sum);
  if (wsu) wsu.eachRow((r, i) => { const k = String(txt(r.getCell(1))); if (!k || i < 3) return; const v = val(r.getCell(3)); out.summary[k] = typeof v === "number" ? Math.round(v * 100) / 100 : v instanceof Date ? v : null; });
  return out;
}
if (typeof window !== "undefined") window.TDSExcel = { make, download, read, build };
