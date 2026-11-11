/* @react-lazy: begin 73-tds-24q-file.js (the React app loads this file with the TDS screens (app/src/lib/tdsGlobals.js): build.py react_parts) */
/* 24Q's text file and its download (were in src/js/73) */
/* ---------- 24Q's text file (Form 138 under the Act of 2025): built to the current layout, marked "check before filing" -- */
// The records are 24Q's as Protean's file format has carried them: the file header (FH), the batch header (BH), each
// challan (CD) with the deductees' records under it (DD: one per employee per payment, Annexure I), and in the fourth
// quarter one salary record (SD) per employee (Annexure II). The new form's own layout could not be checked here (the
// official sites are not reachable from where FinCom was built): the file is named _DRAFT and FinCom says to check it with
// the FVU before filing (NEW_FORMS_VALIDATED, src/js/16).
const TDS24Q_FILE = {
  // next-challan-match: Form 138 / 24Q's rows: Tally's payroll for the year, else the salary sheet (both by employee, the
  // same rows the Challans tab matches, TDS.salaryRows); the books' 192 alone do not say whose TDS it is: the sheet is
  // asked for. A salary payment with tax on no challan stops the file with the list (never left out silently). {rows} or
  // {error}
  rowsOf(fy, q){
    const src = TDS.salarySource(fy), all = TDS.salaryRows().filter(r => r.fy === fy && r.q === q);
    // round 92 (C): salary kept without payroll, every entry naming its employee's own ledger: the books' rows by employee
    if (src === "books" && all.length && all.every(r => r.from === "books")){
      const rows = all.filter(r => r.tds > 0.005 && r.challan);
      return rows.length ? {rows, src: "books"} : {error: "No salary TDS of " + q + " " + fy + " is tagged to a challan yet."};
    }
    if (src === "books") return {error: all.length ? "The books' salary TDS under 192 does not say which employee it is for: bring in the salary sheet (or Tally's payroll) to make the " + TDS.formName("24Q", fy) + " file." : "No salary TDS of " + q + " " + fy + "."};
    // round 92: a payroll year's rows are TDS.salaryRows' (Tally's payroll and the books' salary entries by employee)
    const mine = src === "payroll" ? all : TDS24Q.dedRows().filter(r => r.fy === fy && r.q === q);
    const uns = mine.filter(r => r.unsplit || r.unsplitBooks);
    if (uns.length) return {error: "₹" + INR.format(r2(uns.reduce((a, r) => a + r.tds, 0))) + " of " + q + " " + fy + "'s salary TDS is not split by employee: mark the TDS pay head (Employees & declarations) or check the payroll in Tally, then make the file."};
    const rows = mine.filter(r => r.tds > 0.005 && r.challan).map(r => Object.assign({}, r, {employee: r.employee || r.party}));
    if (!rows.length) return {error: "No salary TDS of " + q + " " + fy + " is tagged to a challan yet."};
    return {rows, src};
  },
  build(fy, q, firm){
    // tax year 2026-27 on: Form 138 as Protean's file format has it (src/js/83); earlier years below, as before
    if (TDS.isNew(fy) && typeof TDSF25 === "object") return TDSF25.build(fy, q, firm, "24Q");
    const got = this.rowsOf(fy, q);
    if (got.error) return got;
    if (q === "Q4" && (got.src === "sheet" || got.src === "books")) return {error: "Annexure II (the year's salary details) is built from Tally's payroll only: the salary sheet gives Annexure I. File the fourth quarter's 24Q with Protean's RPU, or bring the payroll in from Tally."};
    const rows = got.rows;
    const ch = {}; TDS.challans().forEach(c => { ch[c.id] = c; });
    const used = {};
    rows.forEach(r => { (used[r.challan] = used[r.challan] || []).push(r); });
    const live = Object.keys(used).map(id => ch[id]).filter(Boolean).sort((a, c) => String(a.date).localeCompare(String(c.date)));
    const dmy = s => s ? String(s).slice(6, 8) + String(s).slice(4, 6) + String(s).slice(0, 4) : "";
    const money = v => r2(num(v)).toFixed(2);
    const txt = v => String(v == null ? "" : v).replace(/[\^\r\n]/g, " ").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim().slice(0, 75);
    const today = new Date(), fileDate = String(today.getDate()).padStart(2, "0") + String(today.getMonth() + 1).padStart(2, "0") + today.getFullYear();
    const ay = (num(fy.slice(0, 4)) + 1) + "-" + String(num(fy.slice(0, 4)) + 2).slice(2);
    const isNew = TDS.isNew(fy), fno = TDS.formNo("24Q", fy);
    // up to FY 2025-26: 24Q laid out as Protean's file format (oldBuild, below)
    if (!isNew) return this.oldBuild(fy, q, firm, rows, live, used);
    const lines = []; let ln = 0;
    const put = arr => { ln++; lines.push([ln].concat(arr).join("^")); };
    put(["FH", "SL1", "R", fileDate, "1", "D", firm.tan, "1", "FinCom", "", "", "", "", "", "", "", ""]);
    put(["BH", "1", String(live.length), fno, firm.tan, firm.pan || "PANNOTREQD", fy.replace("-", ""), ay.replace("-", ""),
      txt(firm.name), txt(firm.branch), txt(firm.flat), txt(firm.premises), txt(firm.road), txt(firm.area), txt(firm.town),
      txt(firm.state), txt(firm.pin), txt(firm.email), txt(firm.phone), firm.deductorType || "F",
      txt(firm.person), txt(firm.personDesignation), "", "", "", "", "", "", "", "", "", "N", "", "", "", "", "", q]);
    live.forEach((c, ci) => {
      const mine = used[c.id];
      const tax = r2(mine.reduce((a, r) => a + r.tds, 0));
      // tds-layout: a person's interest and fee portion for this return (the register, src/js/79), else the whole, as before
      const part = typeof TDSReg === "object" ? TDSReg.portionFor(c, "24Q", fy, q) : {interest: num(c.interest), fee: num(c.fee) + num(c.others)};
      // the record adds up (the TDS review, H5): this return's tax and the interest and fee it carries
      put(["CD", "1", String(ci + 1), String(mine.length), "", money(tax), "0.00", "0.00", money(part.interest), money(part.fee),
        money(tax + num(part.interest) + num(part.fee)), "", c.bsr, dmy(c.date), c.serial, "C", String(c.minorHead || "200"), "N", "", "", money(tax), "0.00", "0.00", "0.00", "0.00", "0.00"]);
      mine.forEach((r, di) => {
        put(["DD", "1", String(ci + 1), String(di + 1), "O", "", Certs.validPan(r.pan) ? r.pan : "PANNOTAVBL", "", txt(r.employee), money(r.tds), "0.00", "0.00", money(r.tds), "", money(r.tds),
          "", "", dmy(r.date), money(r.paid), dmy(r.date), Certs.validPan(r.pan) ? "" : "C", "", "", "92B", "", "", "", "", ""]);
      });
    });
    let sd = 0;
    if (q === "Q4"){
      const a2 = Payroll.annexII(fy);
      if (a2.some(e => !e.rulesKnown)) return {error: "FinCom works out salary tax for " + PayTax.YEARS.join(" and ") + " only: Annexure II of " + fy + " is not built."};
      a2.forEach((e, i) => {
        sd++;
        put(["SD", "1", String(i + 1), "A", Certs.validPan(e.pan) ? e.pan : "PANNOTAVBL", "", txt(e.name), e.category || "G", dmy(e.joined && e.joined > fy.slice(0, 4) + "0401" ? e.joined : fy.slice(0, 4) + "0401"),
          dmy(e.left && e.left < (num(fy.slice(0, 4)) + 1) + "0331" ? e.left : (num(fy.slice(0, 4)) + 1) + "0331"), money(e.salary), "0.00", "0.00", money(e.gross), money(e.hraExempt), money(e.standard), "0.00", money(e.profTax),
          money(e.incomeSalary), money(e.houseProperty), money(e.grossTotal), money(e.chapter6), money(e.totalIncome), money(e.slabTax - e.rebate), money(e.surcharge), money(e.cess), "0.00",
          money(e.taxPayable), money(e.tdsHere), money(e.prevTds), money(e.tdsTotal), money(e.balance), e.regime === "old" ? "Y" : "N", money(e.prevSalary), e.landlordPan || "", e.lenderPan || ""]);
      });
    }
    return {text: lines.join("\r\n") + "\r\n", rows: rows.length, challans: live.length, salaryRecords: sd, form: "24Q", formNo: fno, isNew, draft: true,
      name: (firm.tan || "TAN") + "_" + (isNew ? "Form" + fno : "24Q") + "_" + q + "_" + fy.replace("-", "") + "_DRAFT.txt",
      words: "Check before filing: built to the current 24Q layout; the new form's own layout could not be checked here. Run it through Protean's FVU first."};
  }
};

// 24Q up to FY 2025-26 (the Income-tax Act, 1961), laid out as Protean's file format and checked with its FVU 8.7
// (TDS26Q.oldText, src/js/16): Annexure I, one deductee record (DD) per employee and payroll entry under its challan; in the
// fourth quarter Annexure II, one salary record (SD) per employee, each followed by its section 16 records (S16: the standard
// deduction 16(ia), professional tax 16(iii)) and its Chapter VI-A records (C6A), from Payroll.annexII (FinCom's own rule).
TDS24Q_FILE.oldBuild = function(fy, q, firm, rows, live, used){
  const money = v => r2(num(v)).toFixed(2), dmy = s => s ? String(s).slice(6, 8) + String(s).slice(4, 6) + String(s).slice(0, 4) : "";
  const txt = (v, n) => String(v == null ? "" : v).replace(/[\^\r\n]/g, " ").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim().slice(0, n || 75);
  const panOf = p => Certs.validPan(p) ? p : "PANNOTAVBL";
  // the employee's reference number (Annexure I and II): nine digits, the same for the employee in every return
  const ref = name => TDS26Q.oldRefNo(name).slice(1);
  const chs = live.map(c => ({c, part: typeof TDSReg === "object" ? TDSReg.portionFor(c, "24Q", fy, q) : {interest: num(c.interest), fee: num(c.fee) + num(c.others)},
    dds: used[c.id].map(r => ({7: ref(r.employee), 10: panOf(r.pan), 13: txt(TDS26Q.fileName(r)), 14: money(r.tds), 15: "0.00", 16: "0.00", 17: money(r.tds), 19: money(r.tds),
      22: money(r.paid), 23: dmy(r.date), 24: dmy(r.date), 25: dmy(c.date), 30: Certs.validPan(r.pan) ? "" : "C", 33: "92B"}))}));
  const sds = [], subs = [];
  if (q === "Q4"){
    const a2 = Payroll.annexII(fy);
    if (a2.some(e => !e.rulesKnown)) return {error: "FinCom works out salary tax for " + PayTax.YEARS.join(" and ") + " only: Annexure II of " + fy + " is not built."};
    const y0 = fy.slice(0, 4) + "0401", y1 = (num(fy.slice(0, 4)) + 1) + "0331";
    a2.forEach((e, i) => {
      const old = e.regime === "old", via = e.via || {};
      const s16 = [["16(iii)", e.profTax], ["16(ia)", e.standard]].filter(([, v]) => num(v) > 0);
      // Chapter VI-A: [section, gross (as declared), deductible (within its limit)]
      const dd = Payroll.detail(e);
      const c6 = [["80C", dd.d80C, via.c80C], ["80CCD(1B)", dd.d80CCD1B, via.c80CCD1B], ["80CCD(2)", dd.d80CCD2, via.c80CCD2],
        ["80D", r2(num(dd.d80D) + num(dd.d80DParents)), r2(num(via.c80D) + num(via.c80DParents))], ["80E", dd.d80E, via.c80E], ["80G", dd.d80G, via.c80G],
        ["80TTA", dd.d80TTA, via.c80TTA], ["OTHERS", dd.dOther, via.other]].filter(([, , v]) => num(v) > 0).map(([id, g, v]) => [id, Math.max(num(g), num(v)), v]);
      const rent = old && num(dd.rent) > 100000, hl = old && num(dd.hlInterest) > 0;
      sds.push({6: "", 7: panOf(e.pan), 8: "", 9: txt(e.name), 10: e.category || "G", 11: dmy(e.joined && e.joined > y0 ? e.joined : y0), 12: dmy(e.left && e.left < y1 ? e.left : y1),
        13: money(e.gross), 15: String(s16.length), 16: money(r2(num(e.standard) + num(e.profTax))), 17: money(e.incomeSalary), 18: money(e.houseProperty), 19: money(e.grossTotal),
        21: String(c6.length), 22: money(e.chapter6), 23: money(e.totalIncome), 24: money(e.slabTax), 25: money(e.surcharge), 26: money(e.cess), 27: money(e.relief89), 28: money(e.taxPayable),
        29: money(e.tdsTotal), 30: money(e.balance), 31: money(via.c80C), 34: money(e.salary), 35: money(e.prevSalary), 36: money(e.tdsHere), 37: money(e.prevTds),
        38: e.noPan ? "Y" : "N", 39: rent ? "Y" : "N", 40: rent ? "1" : "0", 41: rent ? e.landlordPan : "", 42: rent ? txt(e.landlordName) : "", 49: hl ? "Y" : "N", 50: hl ? "1" : "0", 51: hl ? e.lenderPan : "", 52: hl ? txt(e.lenderName) : "", 59: "N",
        67: money(e.salary), 68: money(e.perquisites), 69: money(e.profitsInLieu), 70: old ? "0.00" : "", 71: "0.00", 72: "0.00", 73: "0.00", 74: old ? money(e.hraExempt) : "", 75: "0.00", 76: money(e.hraExempt),
        77: "0.00", 78: money(e.rebate), 79: old ? "Y" : "N", 80: "0.00"});
      subs.push({s16, c6});
    });
  }
  const text = TDS26Q.oldText("24Q", fy, q, firm, chs, sds, subs);
  return {text, rows: rows.length, challans: live.length, salaryRecords: sds.length, form: "24Q", formNo: "24Q", isNew: false, draft: false,
    firmMissing: TDS26Q.oldAsks("24Q", fy, q, firm), name: (firm.tan || "TAN") + "_24Q_" + q + "_" + fy.replace("-", "") + ".txt",
    words: "Built to Protean's 24Q file format as its FVU 8.7 checks it. Run it through Protean's FVU before filing."};
};
function payFvuDownload(fy, q){
  const r = TDS24Q_FILE.build(fy, q, TDS26Q.firmDetails());
  if (r.error){ toast(r.error); return; }
  saveFile(r.name, new Blob([r.text], {type: "text/plain"}));
  if (r.firmMissing && r.firmMissing.length) toast("The deductor's details the FVU asks are missing: " + r.firmMissing.join(", ") + ".");
  else toast(r.rows + " salary payment" + (r.rows === 1 ? "" : "s") + " under " + r.challans + " challan" + (r.challans === 1 ? "" : "s") + (r.salaryRecords ? ", " + r.salaryRecords + " salary record" + (r.salaryRecords === 1 ? "" : "s") : "") +
    (r.missingCodes && r.missingCodes.length ? ". No section code yet: " + r.missingCodes.join(", ") : "") +
    (r.problems && r.problems.length ? ". " + r.problems.length + " thing" + (r.problems.length === 1 ? "" : "s") + " to fix first: " + r.problems.slice(0, 3).join(" ") + (r.problems.length > 3 ? " \u2026" : "") : "") +
    ". Check before filing: run it through the FVU.");
}
if (typeof TDS24Q_FILE !== "undefined") globalThis.TDS24Q_FILE = TDS24Q_FILE;
if (typeof payFvuDownload !== "undefined") globalThis.payFvuDownload = payFvuDownload;
// (each name only when declared: a test's harness loads a file's names one by one, tests/harness.js)
/* @react-lazy: end */
