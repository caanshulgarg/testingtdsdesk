// TDS deductions corrected in FinCom (t70, 16-Oct-2026). Kept in the React bundle (legacy.js is at its size budget) and
// put on window, so the business logic (TDS.allRowsNow, src/js/09) lays the corrections over the books: loaded from main.jsx.
// The owner: "section name is not there.. I need to filter what needs fixing.. export to Excel, correct it there and
// bring it back". A return's deductions go out to Excel (one row a deduction, with its FinCom id; TDS a live formula,
// Paid × Rate; the books' TDS beside it and the difference; totals and a Summary by section, all formulas), the
// corrected file comes back as a preview of each change (old → new), and nothing is applied until "Apply N changes".
// What is applied is kept with the books as FinCom's corrections of the return (S.books.tdsEdits, one of BOOKS_KEYS):
// {rowId: {f: {pan, section, rate, paid, tds, dcode, cert, remarks}, log: [{field, from, to, by, at}]}}. The books read
// from Tally are not changed; TDS.allRowsNow lays the corrections over each deduction (TDSEdit.apply), so the return, its
// file and every figure read the corrected deduction, and r.books keeps what the books say. The challan of a deduction
// is changed as on the page (TDSCH.tag / untag, S.books.alloc).
// "Needs fixing" (the deductions' filter) uses the problems the return already finds: no valid PAN, a PAN inoperative,
// the rate question (Certs.issues), not against a challan, the payment code to confirm (TDS26Q.payCodeRows), and a
// section FinCom does not know. No new tax rule here.
// next-tds-excel (24-Oct-2026; the owner: "prepare this type of download and upload return .. in all types of TDS return..
// user can add or delete or modify the details"): the whole return's Excel (app/src/lib/tdsXlsx.js, TDSX) keeps what it
// changes here too, with three more fields: basis (the remark B, T or Y of a deduction with no tax), code (27EQ's
// collection code of one collection) and out ({by, at, reason}: the deduction taken out of the return, kept in the books
// and in this store: TDS.allRowsNow, tcsRowsNow and salaryRowsNow leave it out, wrapped below). The corrections now reach
// 27EQ's collections and 24Q's salary rows too (they were 26Q's and 27Q's alone).
const TDSEdit = {
  FIELDS: ["pan", "section", "rate", "paid", "tds", "dcode", "cert", "remarks", "date", "credit", "basis", "code"],
  WORDS: {party: "Deductee name", pan: "PAN", section: "Section", rate: "Rate", paid: "Amount paid", tds: "TDS", dcode: "Deductee code", cert: "Lower-deduction certificate", remarks: "Remarks", challan: "Challan", date: "Date of deduction", credit: "Date paid or credited",
    basis: "Remark (no tax)", code: "Collection code", out: "Taken out of the return"},
  all(){ return (S.books && S.books.tdsEdits) || {}; },
  // the deductee code as the return file has carried it: 01 a company (the PAN's fourth letter C), else 02
  codeOf(pan){ return Certs.validPan(pan) && /^[A-Z]{3}C/.test(String(pan).toUpperCase()) ? "01" : "02"; },
  // taken out of the return (kept in the books): by its id, or the row it is a part of (a split)
  isOut(r){ const e = this.all()[r.splitOf || r.id]; return !!(e && e.f && e.f.out); },
  outList(){ const a = this.all(); return Object.keys(a).filter(k => a[k] && a[k].f && a[k].f.out).map(k => Object.assign({id: k}, a[k].f.out)); },
  // a list of rows with the corrections over each (once: a row worked out again is not corrected twice) and those taken out left out
  over(rows){
    if (!S.books || !S.books.tdsEdits) return rows;
    const out = [];
    rows.forEach(r => { if (!r) return; this.apply(r); if (!this.isOut(r)) out.push(r); });
    return out;
  },
  // a deduction as the books give it, with FinCom's corrections over it (TDS.allRowsNow)
  apply(r){
    if (r._ed) return r;
    const e = this.all()[r.id], f = e && e.f;
    if (!f || !Object.keys(f).length) return r;
    r._ed = 1;
    r.books = {party: r.party, pan: r.pan, section: r.section, rate: r.rate, paid: r.paid, tds: r.tds, dcode: this.codeOf(r.pan), cert: "", remarks: "", date: r.date, credit: r.credit || r.date, basis: r.basis || "", code: r.code || ""};
    // next-tds-addlist: the deductee's name given in FinCom where Tally has none (its PAN from the PAN book, unless given)
    if (f.party != null && String(f.party).trim()){ r.party = String(f.party).trim(); if (f.pan == null) r.pan = TDS.panOf(r.party); r.partyFrom = "fincom"; }
    if (f.pan != null) r.pan = f.pan;
    if (f.section != null) r.section = f.section;
    if (f.paid != null) r.paid = r2(f.paid);
    if (f.tds != null) r.tds = r2(f.tds);
    if (f.rate != null) r.rate = f.rate; else if ((f.paid != null || f.tds != null) && r.paid) r.rate = r2(r.tds / r.paid * 100);
    if (f.dcode != null) r.dcode = f.dcode;
    if (f.cert != null) r.cert = f.cert;
    if (f.remarks != null) r.remarks = f.remarks;
    // next-tds-clear: the dates corrected on the Deductions step (the date of deduction decides the quarter)
    if (f.date != null && TDS.ymd(f.date).length === 8){ r.date = TDS.ymd(f.date); r.q = TDS.qOf(r.date); r.fy = TDS.fyOf(r.date); }
    if (f.credit != null && TDS.ymd(f.credit).length === 8) r.credit = TDS.ymd(f.credit) === r.date ? undefined : TDS.ymd(f.credit);
    if (f.basis != null) r.basis = f.basis;
    if (f.code != null) r.code = f.code;
    r.edited = Object.keys(f).filter(k => k !== "out");
    return r;
  },
  // what the books say for a field of a deduction (to put back, an edit equal to it is dropped)
  booksOf(r, k){ const b = r.books || {party: r.party, pan: r.pan, section: r.section, rate: r.rate, paid: r.paid, tds: r.tds, dcode: this.codeOf(r.pan), cert: "", remarks: "", date: r.date, credit: r.credit || r.date, basis: r.basis || "", code: r.code || ""}; return b[k]; },
  same(k, a, b){ return ["rate", "paid", "tds"].includes(k) ? Math.abs(num(a) - num(b)) < 0.005 : String(a == null ? "" : a) === String(b == null ? "" : b); },
  set(r, k, v){
    const b = S.books; b.tdsEdits = b.tdsEdits || {};
    const e = b.tdsEdits[r.id] = b.tdsEdits[r.id] || {f: {}, log: []};
    const from = r[k] == null ? (k === "dcode" ? this.codeOf(r.pan) : "") : r[k];
    if (this.same(k, v, this.booksOf(r, k))) delete e.f[k]; else e.f[k] = v;
    e.log.push({field: k, from, to: v, by: typeof whoAmI === "function" ? whoAmI() : "", at: new Date().toISOString()});
  },
  edited(rows){ return rows.filter(r => r.edited && r.edited.length); },
  // a section FinCom knows (its usual rates, or the Act of 2025's table)
  knownSec(s){
    const k = TDS.sec(s);
    if (!k) return false;
    if (TDS.STD[k]) return true;
    return typeof RULE_DEFAULTS === "object" && RULE_DEFAULTS.some(x => x.old && TDS.sec(x.old) === k);
  },
  // next-tds-addlist (19-Oct-2026), next-tds-early (20-Oct-2026; the owner: "If there is an early challan then it should
  // not be an error, if I want to use any early challan within the rule of TRACES"). What Protean's FVU does (run on
  // FVU 8.7 and 1.2): a challan of the deduction's financial year, dated before or after it, and one of the following
  // year are taken; one dated in a year before (T-FV-3076) or after today (T-FV-3040) is refused. So:
  //   errors (placeIssues; the file is not made): k "fy" a challan of an earlier year (or two years on), k "future" dated
  //   after today, k "minor" not minor head 200; k "sec" another section's challan (a warning)
  //   notes (placeNote; allowed, an info chip only): k "adv" deposited before the deduction in its year, k "nextfy" a
  //   challan of the following year (past 31 May: March's TDS is due by 30 April)
  P_NAME: "deductee name missing",
  P_EARLY: "challan TRACES will not accept",
  FY_WORDS: "Protean's FVU refuses a challan dated before the financial year (T-FV-3076); use this year's challan or file it through a correction",
  // next-fvu87: what each FVU does with it (FVU 1.2 from 2026-27: T-FV-3076; FVU 8.7 up to 2025-26: the year just before
  // taken, older refused with T-FV-3166); FinCom uses neither for the deduction
  fyWords(r, g){
    if (TDS.isNew(TDS.fyOf(r.date))) return this.FY_WORDS;
    if (g < -1) return "Protean's FVU 8.7 refuses a challan two or more years before the financial year (T-FV-3166); use this year's challan";
    return "FinCom does not use a challan of the year before for this deduction (Protean's FVU 8.7 itself takes one of the year just before); use this year's challan, or ask before filing";
  },
  fyGap(r, c){ return +TDS.fyOf(c.date).slice(0, 4) - +TDS.fyOf(r.date).slice(0, 4); },
  today(){ try { return istToday(); } catch (e){ return ""; } },
  badOf(r, c){
    if (!c || TDS.ymd(c.date).length !== 8 || TDS.ymd(r.date).length !== 8) return null;
    const g = this.fyGap(r, c), t = this.today();
    if (g < 0) return {k: "fy", words: "Challan of FY " + TDS.fyOf(c.date) + ", before this deduction's FY " + TDS.fyOf(r.date) + ": " + this.fyWords(r, g)};
    if (g > 1) return {k: "fy", words: "Challan of FY " + TDS.fyOf(c.date) + ", more than a year after this deduction's FY " + TDS.fyOf(r.date)};
    if (t && TDS.ymd(c.date) > t) return {k: "future", words: "Challan dated " + fmtDate(tallyDate(TDS.ymd(c.date))) + ", after today: Protean's FVU refuses a future date (T-FV-3040)"};
    if (c.minorHead && String(c.minorHead) !== "200") return {k: "minor", words: "Challan is minor head " + c.minorHead + ", not 200 (TDS payable by the deductor): it cannot pay a deduction"};
    return null;
  },
  // a challan that cannot pay this deduction (never offered, never ticked)
  early(r, c){ return !!this.badOf(r, c); },
  placeNote(r, c){
    if (!c || this.badOf(r, c)) return null;
    const cd = TDS.ymd(c.date), rd = TDS.ymd(r.date), g = this.fyGap(r, c);
    if (g === 1 && cd > String(+TDS.fyOf(r.date).slice(0, 4) + 1) + "0531") return {k: "nextfy", info: true, words: "Challan of the next year (FY " + TDS.fyOf(c.date) + "): allowed"};
    if (g === 0 && cd < rd) return {k: "adv", info: true, words: "Advance challan: deposited " + fmtDate(tallyDate(cd)) + ", before the deduction, in the same year: allowed"};
    return null;
  },
  placeIssues(r, c){
    const out = [];
    if (!c) return out;
    const b = this.badOf(r, c);
    if (b) out.push(b);
    const cs = TDSCH.secNorm(c.section);
    if (cs && r.section && !TDSCH.secOk(cs, r.section)) out.push({k: "sec", words: "Challan is for " + cs + "; this is " + (TDS.sec(r.section) || r.section)});
    return out;
  },
  // the problems the return already finds, by deduction: {rowId: ["no valid PAN", …]}
  problems(rows, fy, q, form){
    const out = {}, add = (id, w) => { (out[id] = out[id] || []).push(w); };
    const chById = {}; TDS.challans().forEach(c => { chById[c.id] = c; });
    const issues = form === "26Q" ? Certs.issues(fy, q) : [], pay = typeof TDS26Q === "object" && TDS26Q.payCodeRows ? TDS26Q.payCodeRows(fy, q, form) : [];
    rows.forEach(r => {
      if (!Certs.validPan(r.pan)) add(r.id, "no valid PAN");
      else if (Certs.inoperative(r.pan)) add(r.id, "PAN inoperative");
      if (form !== "27EQ" && !this.knownSec(r.section)) add(r.id, "section not known: " + (r.section || "none"));
      if (!r.challan) add(r.id, "not against a challan");
      if (!(r.party || r.employee)) add(r.id, this.P_NAME);
      this.placeIssues(r, r.challan && chById[r.challan]).forEach(x => add(r.id, x.k === "sec" ? x.words.toLowerCase() : this.P_EARLY));
    });
    issues.forEach(x => add(x.row.id, "rate " + x.row.rate + "% should be " + x.expected + "%" + (x.why ? ": " + x.why : "")));
    pay.forEach(x => add(x.row.id, x.why));
    return out;
  },
  // next-room-2: the deductions-only Excel (rateOut, chLabel, COLS, book, freeze, toExcel, read, applyAll) is put on TDSEdit by
  // lib/tdsEditExcel.js, which comes with the return's page (screens/TdsReturn.jsx): it is not in the app's first file
};

// next-tds-excel: the corrections over every return's rows, without a line more in legacy.js (its size budget). Each wrap is
// made once, when TDS, TDS24Q and TDS26Q are there (legacy.js runs before this bundle):
//   TDS.allRowsNow   26Q / 27Q (and the books' 192): the rows taken out left out; a collection added in FinCom (section
//                    206C) goes to 27EQ, not 26Q
//   TDS.tcsRowsNow   27EQ: the corrections, those taken out left out, the collections added in FinCom
//   TDS.salaryRowsNow, TDS24Q.dedRows  24Q (Tally's payroll, the salary sheet, the books' 192): the corrections, those taken
//                    out left out; a salary payment added in FinCom read as the books' own employee row (from "books")
//   TDS26Q.remark    a lower-deduction certificate number given in FinCom (r.cert) is remark A with that number
const isTcs = (r) => /^206C/.test(String((r && r.section) || ""));
const isSal = (r) => /^(192|392)/.test(String((r && r.section) || ""));
function wrapOnce(o, k, f){ if (!o || typeof o[k] !== "function" || o[k].tdsx) return; const was = o[k]; o[k] = function(){ return f.call(this, was.apply(this, arguments), arguments); }; o[k].tdsx = true; }
function wrapAll(){
  const G = globalThis;
  if (typeof G.TDS !== "object" && typeof TDS === "undefined") return false;
  const T = typeof TDS !== "undefined" ? TDS : G.TDS;
  wrapOnce(T, "allRowsNow", (rows) => rows.filter(r => !TDSEdit.isOut(r) && !(r.added && isTcs(r))));
  wrapOnce(T, "tcsRowsNow", (rows) => {
    const b = S.books || {}, add = [];
    if (typeof TDSAdd === "object" && b.tdsAdded){ const tmp = []; TDSAdd.addTo(tmp, b); tmp.filter(isTcs).forEach(r => { const x = b.tdsAdded[r.id.slice(3)] || {}; add.push(Object.assign(r, {code: x.code || "", ledger: x.code ? "" : "", type: "Added in FinCom"})); }); }
    return TDSEdit.over(rows.concat(add)).sort((a, c) => String(a.date).localeCompare(String(c.date)));
  });
  wrapOnce(T, "salaryRowsNow", (rows) => TDSEdit.over(rows.map(r => r.added && isSal(r) ? Object.assign(r, {employee: r.employee || r.party, unsplitBooks: false, from: "books"}) : r)));
  if (typeof TDS24Q === "object") wrapOnce(TDS24Q, "dedRows", (rows) => {
    if (!rows.length) return rows;
    const fys = new Set(rows.map(r => r.fy)), b = S.books || {}, tmp = [];
    if (typeof TDSAdd === "object" && b.tdsAdded) TDSAdd.addTo(tmp, b);
    return TDSEdit.over(rows.concat(tmp.filter(r => isSal(r) && fys.has(r.fy)).map(r => Object.assign(r, {employee: r.party, from: "books"})))).sort((a, c) => String(a.date).localeCompare(String(c.date)));
  });
  if (typeof TDS26Q === "object" && TDS26Q.remark && !TDS26Q.remark.certSet){
    const was = TDS26Q.remark;
    TDS26Q.remark = function(r, form){
      const c = r && String(r.cert || "").toUpperCase().replace(/\s/g, "");
      if (c && form !== "24Q" && !(typeof TDSDecl === "object" && TDSDecl.remark(r, form))) return {remark: "A", certNo: c.slice(0, 10), certFull: c};
      return was.call(this, r, form);
    };
    Object.keys(was).forEach(k => { TDS26Q.remark[k] = was[k]; });
    TDS26Q.remark.certSet = true;
  }
  return true;
}
TDSEdit.wrap = wrapAll;
wrapAll();

window.TDSEdit = TDSEdit;
export default TDSEdit;
