/* @react-lazy: begin 91-tds-audit.js (the React app loads this file with its TDS screens: app/src/lib/tdsGlobals.js; build.py react_parts) */
/* ================================================================== */
/* The TDS check of 22-Oct-2026: what Validate & file says besides     */
/* ================================================================== */
// The owner's audit of the TDS module (scratchpad tds-audit, H1-H9, M1-M9, L1-L3) and the independent review (N1-N14),
// approved 22-Oct-2026: "fix all", keeping the current layout. What changes a figure is where the figure is worked out
// (src/js/09, 04, 66, 73, server/_shared/tdsmatch.js); here, kept out of legacy.js (its size budget), only the lines
// Validate & file adds (app/src/screens/tds/Validate.jsx: TDSAudit.notes) and the working Excel (TDS.toExcel, L1).
// Each note: {k, level "warn" | "info", words, vid?, date?, no?}; one per entry or per section, never one per row repeated.
const TDSAudit = {
  money: (v) => "₹" + INR.format(r2(num(v))),
  day: (d) => fmtDate(tallyDate(TDS.ymd(d))),
  formOf(section){ return typeof TDSAdj === "object" ? TDSAdj.formOf(section) : "26Q"; },
  // the notes of a return (fy "2025-26", q "Q1", form "26Q")
  notes(fy, q, form){
    const out = [], rows = TDS.formRows(form).filter(r => r.fy === fy && r.q === q);
    const add = (k, level, words, x) => out.push(Object.assign({k, level, words}, x || {}));
    // M3: a TDS top-up booked as an expense with no party: which deduction does it top up?
    rows.filter(r => r.topUp).forEach(r => add("topup", "warn", "TDS " + this.money(r.tds) + " booked as an expense with no deductee (" + (r.type || "Entry") + (r.voucher ? " " + r.voucher : "") + " " + this.day(r.date) +
      "): which deduction does it top up? Add it to that deductee's row (Fix on Deductions); no amount paid is taken for it", {vid: String(r.id).split("|")[0], date: r.date}));
    // H4: a TDS ledger debited back (no bank) that could not be taken off a deduction of an open return: a correction
    TDS.reversals().filter(x => x.fy === fy && x.q === q && this.formOf(x.section) === form).forEach(x => add("rev", "warn", x.ledger + " " + this.money(x.amount) + " debited back on " + this.day(x.date) +
      (x.voucher ? " (" + x.voucher + ")" : "") + (x.party ? " for " + x.party : "") + ": " + (x.filed ? form + " " + q + " " + fy + " is filed with that deduction: file a correction for it" : "no deduction of " + (x.party || "its party") + " under " + x.section + " to reduce: check the entry"),
      {vid: x.vid, date: x.date, no: x.voucher, ledger: x.ledger}));
    rows.filter(r => r.reversed).forEach(r => add("revd", "info", r.party + " " + r.section + ": " + this.money(r.reversed.amount) + " of the TDS debited back on " + this.day(r.reversed.date) + (r.reversed.voucher ? " (" + r.reversed.voucher + ")" : "") + ": the deduction is " + this.money(r.tds) + " in the return"));
    // N9 (Testing AAD, 30-Apr-2026: 194C ₹1,92,270 paid against ₹3,294 deducted; 194T ₹3,60,000 with nothing deducted): a TDS
    // payment of the quarter far above what its section deducted in the twelve months to it
    // (a payment within two months of the books' first day pays what came before them: not weighed)
    const b0 = TDS.ymd(((S.books || {}).meta || {}).from), late2 = (d) => !b0 || TDS.ymd(d) >= String(num(b0.slice(0, 4)) + (num(b0.slice(4, 6)) > 10 ? 1 : 0)) + String((num(b0.slice(4, 6)) + 1) % 12 + 1).padStart(2, "0") + b0.slice(6, 8);
    if (form !== "27EQ") TDS.paymentsFromBooks().filter(p => TDS.fyOf(p.date) === fy && TDS.qOf(p.date) === q && p.tax > 0 && late2(p.date)).forEach(p => {
      const by = {}; (p.parts || [{section: (p.sections || [])[0] || "", tax: p.tax}]).forEach(z => { const k = TDS.sec(z.section); by[k] = r2((by[k] || 0) + z.tax); });
      Object.keys(by).filter(k => k && this.formOf(k) === form).forEach(k => {
        const from = String(num(TDS.ymd(p.date).slice(0, 4)) - 1) + TDS.ymd(p.date).slice(4), ded = r2(TDS.allRows().filter(r => TDS.sec(r.section) === k && TDS.ymd(r.date) >= from && TDS.ymd(r.date) <= TDS.ymd(p.date)).reduce((a, r) => a + r.tds, 0));
        if (by[k] - ded >= TDS.MIN_WARN && by[k] > 2 * ded) add("payover", "warn", "TDS paid for " + k + " " + this.money(by[k]) + " on " + this.day(p.date) + (p.voucher ? " (" + p.voucher + ")" : "") + " against " + this.money(ded) +
          " deducted in the year to it: check the entry (another tax posted to the TDS ledger, or deductions missing in Tally)", {vid: p.vid, date: p.date, no: p.voucher});
      });
    });
    // N2: a TDS ledger kept as receivable that is credited on bills: its deductions are left out of every return
    if (form === "26Q" && q === "Q1"){ const map = (S.books || {}).map || {}; Object.keys(map).filter(l => map[l].kind === "tds_receivable" && typeof LedCheck === "object" && LedCheck.taxGroup(S.books, l)).forEach(l => {
      const n = ((S.books || {}).vouchers || []).filter(v => !v.opt && !v.cancel && TDS.fyOf(v.date) === fy && v.ent.some(e => e.l === l && e.a > 0) && v.ent.some(e => e.a < 0 && !Books.ledgerOf(e.l).kind && !Books.sundry(e))).length;
      if (n) add("recv", "warn", "\u201c" + l + "\u201d is kept as TDS receivable, but " + n + (n === 1 ? " bill credits" : " bills credit") + " it in " + fy + ": its deductions are not in any return. If it is TDS payable, change it on Ledgers", {step: "deductor"});
    }); }
    // H3: a challan made earlier from one Tally payment of several sections (it names none), or with paise the bank never paid
    if (form !== "27EQ") TDS.challans().filter(c => TDS.fyOf(c.date) === fy && TDS.qOf(c.date) === q).forEach(c => {
      const p = c.fromVoucher && TDS.paymentsFromBooks().find(z => z.vid === c.fromVoucher);
      if (p && p.parts && !c.section && p.parts.some(z => this.formOf(z.section) === form)) add("chsplit", "warn", "Challan " + TDSCH.label(c) + " is one Tally payment of " + p.parts.length + " sections (" + p.parts.map(z => TDS.sec(z.section) + " " + this.money(z.tax)).join(", ") + "): each section is its own challan with its own serial; give them on Challans");
      else if (Math.round(num(c.tax) * 100) % 100) add("chpaise", "warn", "Challan " + TDSCH.label(c) + " holds " + this.money(c.tax) + (p ? "; the bank paid " + this.money(p.tax) : "") + ": a challan is in whole rupees");
      if (c.draft === "serial" && !c.serial) add("chdraft", "warn", "Challan of " + this.day(c.date) + " for " + (c.section || "?") + " " + this.money(c.tax) + " (from one Tally payment of several sections) needs its serial number");
    });
    // N7: the expense says another section than the TDS ledger (rent on "TDS 94H")
    rows.filter(r => TDSRate.secOfPay(r.pay) && TDSRate.secOfPay(r.pay) !== TDS.sec(r.section).slice(0, 4)).forEach(r => add("secpay", "warn", ({rent_building: "Rent", rent_machinery: "Machinery hire", contractor: "A contract", professional: "A professional fee", technical: "A technical fee", director: "A director's fee"})[r.pay] +
      " booked under " + TDS.sec(r.section) + " (" + (r.party || "?") + ", " + this.day(r.date) + (r.voucher ? ", " + r.voucher : "") + ", TDS " + this.money(r.tds) + "): " + TDSRate.secOfPay(r.pay) + "? The section looks wrong, not the rate", {vid: String(r.id).split("|")[0], date: r.date, no: r.voucher}));
    // N14: deducted at another rate than the TDS ledger's own (H1's "10% deducted on a 2% ledger")
    const lr = rows.filter(r => r.ledgerRate);
    if (lr.length) add("ledrate", "info", lr.length + (lr.length === 1 ? " deduction" : " deductions") + " at another rate than its TDS ledger's (" + Array.from(new Set(lr.map(r => r.rate + "% on " + r.ledger))).join(", ") + "): the amount paid is read from the entry, at the rate deducted");
    // N13: one TDS entry for several bills, one row dated on the first
    rows.filter(r => (r.bills || []).length > 1).forEach(r => add("bills", "info", (r.party || "?") + ": one TDS entry of " + this.day(r.date) + " covers " + r.bills.length + " bills (" + r.bills.map(z => this.day(z.date) + " " + this.money(z.amount)).join(", ") + "); the return has one row dated on the first bill"));
    // N12: salary TDS is dated on the payroll entry (month end)
    if (form === "24Q" && rows.some(r => r.src === "payroll")) add("sal192", "info", "Salary TDS is dated on the payroll entry (the month's end), as the deduction at payment would be when salary is paid in the month; where it is paid later, its due date and interest are a month later");
    // M8: Tally's nature of payment still at a rate of a time gone (2020-21's reduced rates)
    if (form === "26Q" && q === "Q1") Object.entries((S.books || {}).tdsNat || {}).forEach(([nm, x]) => {
      const c = ((x && x.cats) || []).slice().sort((a, z) => String(a[0]).localeCompare(String(z[0]))).pop(); if (!c) return;
      const sec = TDS.sec(String(c[1] || "").replace(/\s/g, "")), std = TDS.STD[sec] || [], rs = [num(c[2]), num(c[3])].filter(z => z > 0);
      if (std.length && rs.some(z => !std.includes(z)) && String(c[0]) < "20210401") add("natrate", "warn", "Tally's nature of payment \u201c" + nm + "\u201d still carries " + rs.join("% / ") + "% (from " + this.day(c[0]) + "; the reduced rates ended on 31-Mar-2021): " + sec + " today is " + std.join("% / ") + "%. Update it in Tally, so new entries deduct the right rate");
    });
    return out;
  }
};
// L1: the working Excel of a return, as its file carries it (moved here from src/js/09: only the TDS screens make it): the
// deductee code as the file writes it (26Q 1 company / 2 other; 27Q and 27EQ by the PAN's 4th letter), the date paid or
// credited (r.credit, else the date of deduction), and the file's own words for the columns
if (typeof TDS === "object") TDS.toExcel = async function(fy, q, form){
  await ensureXlsx();
  form = typeof TDS_FORMS === "object" && TDS_FORMS[form] ? form : "26Q";
  const rows = TDS_FORMS[form].rows().filter(r => (!fy || r.fy === fy) && (!q || r.q === q));
  const usedHere = new Set(rows.map(r => r.challan).filter(Boolean));
  const ch = this.challans().filter(c => usedHere.has(c.id) || ((!fy || this.fyOf(c.date) === fy) && (!q || this.qOf(c.date) === q)));
  const use = this.challanUse(), part = (c) => typeof TDSReg === "object" && fy && q ? TDSReg.portionFor(c, form, fy, q) : {interest: 0, fee: 0};
  const d = s => s ? String(s).slice(6, 8) + "/" + String(s).slice(4, 6) + "/" + String(s).slice(0, 4) : "";
  const wb = XLSX.utils.book_new();
  const cs = [["Challans", "", "", "", "", "", ""], ["BSR code", "Challan serial", "Date deposited", "Tax", "Interest", "Total", "Allocated", "Left", "Used by this return", "Interest allocated here", "Fee allocated here"]]
    .concat(ch.map(c => [c.bsr, c.serial, d(c.date), num(c.tax), num(c.interest), r2(num(c.tax) + num(c.interest)), use[c.id] || 0, r2(num(c.tax) - (use[c.id] || 0)),
      r2(rows.filter(r => r.challan === c.id).reduce((a, r) => a + r.tds, 0)), part(c).interest, part(c).fee]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cs), "Challans");
  const head = ["Sl. No.", "Deductee code", "PAN of the deductee", "Name of the deductee", "Section code", "Date of payment or credit", "Amount paid or credited",
    "TDS", "Total tax deducted", "Date of deduction", "Rate at which deducted", "Reason for non-deduction or lower deduction", "Certificate number", "Voucher", "Challan BSR", "Challan serial", "Challan date"];
  const body = rows.map((r, i) => {
    const c = ch.find(x => x.id === r.challan) || {}, pan = r.pan && Certs.validPan(r.pan) ? r.pan : "PANNOTAVBL", m = TDS26Q.remark(r, form);
    const dc = TDS26Q.oldDeducteeCode(r, form, pan).code;
    return [i + 1, form === "26Q" ? dc : String(dc).padStart(2, "0"), pan, TDS26Q.fileName(r), form === "27EQ" ? r.code : TDS26Q.codeFor ? TDS26Q.codeFor(r) || TDS26Q.code(r.section) : TDS26Q.code(r.section),
      d(r.credit || r.date), r.paid, r.tds, r.tds, d(r.date), r.rate, m.remark, m.certNo, r.voucher, c.bsr || "", c.serial || "", d(c.date || "")];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head].concat(body)), "Deductees");
  const sum = [["Section", "Deductions", "Amount paid", "TDS", "Not against a challan", "Without PAN"]]
    .concat(this.summary(fy, q, form).map(s => [s.section, s.count, s.paid, s.tds, s.unallocated, s.noPan]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), "Summary");
  const out = XLSX.write(wb, {bookType: "xlsx", type: "array"});
  saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-" + form + "-" + (q || "all") + "-" + (fy || "") + ".xlsx", new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
};
if (typeof globalThis === "object") Object.assign(globalThis, {TDSAudit});
/* @react-lazy: end */
