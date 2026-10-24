// A TDS / TCS return as one Excel, down and back up (next-tds-excel, 24-Oct-2026; the owner: "prepare this type of download
// and upload return in GSTR-1 and all types of TDS return.. user can add or delete or modify the details"; and "I should be
// able to add challan, add deduction, add deductee within this smart excel.. it should be dynamic"; "challan balance should
// also be there"). It extends what was there (t70, 16-Oct-2026: "Excel to correct and bring back", TDSEdit in
// app/src/lib/tdsEdit.js: a return's deductions, preview, Apply, kept as FinCom's corrections) from the deductions alone to
// the whole return, every form and year FinCom files: 24Q / Form 138, 26Q / Form 140, 27Q / Form 144, 27EQ / Form 143.
//
// TDSX (this file: the figures, no Excel) and app/src/screens/tds/tdsExcel.js (the workbook, ExcelJS) and
// app/src/screens/tds/TdsExcel.jsx (Download Excel, Upload Excel, the preview, Apply, Undo).
//   data(form, fy, q)        the return as the workbook shows it: deductor, challans (with what this return and the others
//                            use of each), deductions, deductees, the year's salary (24Q Q4), the lists, FinCom's summary
//   plan(form, fy, q, x)     the workbook read back (x, tdsExcel.read) against FinCom now: what is added, taken out and
//                            changed (old → new), sheet by sheet, and what is refused (errors) or to look at (warnings)
//   preview(form, fy, q, x, validate)  plan, then a dry run: every change made on the books in memory, Validate & file's
//                            own checks (validate = checkReturn) and the summary worked out, then put back as it was;
//                            the errors and warnings that the file brings in are the preview's
//   apply(pv)                the changes made and saved, as FinCom's corrections of the return (the books from Tally are
//                            never changed): S.books.tdsEdits (a deduction from the books corrected, or taken out: kept),
//                            tdsAdded (one added; one taken out is marked deleted, kept), challans (one added or changed
//                            by hand), alloc (which challan pays which, through TDSCH.tag / untag, so the allocation trail
//                            and Place automatically's Undo stay right), chPortions (interest, fee, others allocated),
//                            panFix (the PAN book), nrInfo (27Q's details, 26Q's declarations: TDSDecl), panInoperative,
//                            payDetails (the employees' declarations), and the client's deductor details (co.tds26q)
//   undo(form, fy, q)        the last upload of the return taken back, all of it: what each store held before (kept with the
//                            books in S.books.matchNo "xlsx|<form|fy|q>", synced; the allocation trail keeps both ways)
const G = globalThis;
const VERSION = "fincom-tds-1";
const KEEP = ["tdsEdits", "tdsAdded", "alloc", "allocFrom", "challans", "chPortions", "panFix", "nrInfo", "panInoperative", "payDetails", "tdsSplits", "tcsCodes"];
const ARR = { challans: 1, payDetails: 1 };
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const R2 = (v) => Math.round((+v || 0) * 100) / 100;
const N = (v) => (typeof v === "number" ? v : v == null || String(v).trim() === "" ? NaN : Number(String(v).replace(/[₹,\s]/g, "")));
const T = (v) => (v == null ? "" : String(v).trim());
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
// a date as typed or kept by Excel: a Date (ExcelJS: UTC midnight), a serial number, dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd,
// dd-Mon-yyyy, ddmmyyyy -> yyyymmdd, "" when none, null when not a date
function ymd(v) {
  if (v == null || v === "") return "";
  const p2 = (n) => String(n).padStart(2, "0");
  if (v instanceof Date) return isNaN(v) ? null : v.getUTCFullYear() + p2(v.getUTCMonth() + 1) + p2(v.getUTCDate());
  if (typeof v === "number") { if (v < 20000 || v > 80000) return null; const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return ymd(d); }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/), y, mo, d;
  if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ,]+(\d{4})$/))) { d = +m[1]; mo = MON[m[2].toUpperCase()]; y = +m[3]; }
  else if ((m = s.match(/^(\d{2})(\d{2})(\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if (/^\d{8}$/.test(s) && +s.slice(0, 4) > 1990) return s;
  else return null;
  const t = new Date(Date.UTC(y, (mo || 0) - 1, d));
  if (!mo || isNaN(t) || t.getUTCDate() !== d) return null;
  return y + p2(mo) + p2(d);
}
const dmy = (d) => (/^\d{8}$/.test(String(d || "")) ? d.slice(6, 8) + "-" + d.slice(4, 6) + "-" + d.slice(0, 4) : "");
// a challan as the workbook names it (the Challans sheet's Label formula: BSR/dd-mm-yyyy/serial)
const chLab = (bsr, date, serial) => T(bsr) + "/" + dmy(TDS.ymd(date)) + "/" + T(serial);
const chKeyOf = (bsr, date, serial) => T(bsr) + "|" + date + "|" + T(serial).padStart(5, "0");
function parseLab(s) { const p = T(s).split("/").map((x) => x.trim()); if (p.length < 3) return null; const d = ymd(p[1]); return d ? { bsr: p[0], date: d, serial: p.slice(2).join("/"), key: chKeyOf(p[0], d, p.slice(2).join("/")) } : null; }
const YES = (v) => /^(y|yes|true|1)$/i.test(T(v));
const who = () => { try { return TDSReg.who() || (typeof whoAmI === "function" ? whoAmI() : ""); } catch (e) { return ""; } };

// the return a section is filed in (as TDS.rows / nrRows / tcsRows / salaryRows split them); "" for the portal's own forms
function formOf(section) {
  const s = TDS.sec(section);
  if (!s) return "";
  if (/^(192|392)/.test(String(section || ""))) return "24Q";
  if (/^206C/.test(s)) return "27EQ";
  if (TDS.NR.test(s)) return "27Q";
  return TDS.portalForm(section) ? "" : "26Q";
}
const knownSec = (s) => /^(192|392)/.test(String(s || "")) || (typeof TDSEdit === "object" ? TDSEdit.knownSec(s) : !!TDS.STD[TDS.sec(s)]);

const TDSX = {
  VERSION, ymd, dmy, chLab, parseLab, formOf,
  FORMS: ["26Q", "27Q", "27EQ", "24Q"],
  key(form, fy, q) { return "xlsx|" + TDSReg.key(form, fy, q); },
  // the remarks a deduction of the form can carry in FinCom's file (TDS_REMARK: B, T, Y on 26Q / Form 140 only; A a lower
  // deduction or collection certificate; C no PAN or an inoperative one at the higher rate); 24Q's C is FinCom's own
  remarks(form) { return form === "26Q" ? ["A", "B", "C", "T", "Y"] : form === "24Q" ? ["C"] : ["A", "C"]; },
  // the sections a deduction of this form may have: those FinCom knows (its usual rates, the Act of 2025's table)
  sections(form) {
    if (form === "27EQ") return [["206C", "Tax collected at source"]];
    if (form === "24Q") return [["192", "Salary"]];
    const all = new Set(Object.keys(TDS.STD));
    (typeof RULE_DEFAULTS === "object" ? RULE_DEFAULTS : []).forEach((x) => { if (x.old) all.add(TDS.sec(x.old)); });
    return Array.from(all).filter((s) => s && formOf(s) === form).sort().map((s) => [s, TDS.secName(s) || ""]);
  },
  rates() { const s = new Set([0, 20]); Object.values(TDS.STD).forEach((l) => l.forEach((v) => s.add(v))); return Array.from(s).sort((a, b) => a - b); },
  rows(form, fy, q) { return TDS.formRows(form).filter((r) => r.fy === fy && r.q === q); },
  // the challans of a return's sheet: those it uses, the quarter's own (its form or none said), any portion given to it, and
  // the year's with tax left (to pick from)
  challans(form, fy, q) {
    const k = TDSReg.key(form, fy, q), uses = TDSReg.uses();
    return TDS.challans().filter((c) => (uses[c.id] || {})[k] || ((TDSReg.portions(c) || {})[k]) ||
      (TDS.fyOf(c.date) === fy && TDS.qOf(c.date) === q && (!TDSReg.homeForm(c) || TDSReg.homeForm(c) === form)) ||
      (TDS.fyOf(c.date) === fy && TDSReg.balance(c).tax > 0.005 && (!TDSReg.homeForm(c) || TDSReg.homeForm(c) === form)));
  },
  remarkOf(r, form) {
    if (form === "24Q") return Certs.validPan(r.pan) ? "" : "C";
    try { return (TDS26Q.remark(r, form) || {}).remark || ""; } catch (e) { return ""; }
  },
  certOf(r, form) { if (r.cert) return String(r.cert).toUpperCase(); const c = form === "27EQ" ? TCS27EQ.certFor(r) : Certs.forRow(r); return c ? String(c.certNo || "").toUpperCase() : ""; },
  rateOut(r) { return r.paid ? r.tds / r.paid * 100 : +r.rate || 0; },
  status(pan) { const s = PANCheck.status(pan).state; return s === "valid" ? "Operative" : s === "inoperative" ? "Inoperative" : s === "invalid" ? (String(pan || "").trim() ? "Invalid" : "No PAN") : "Not checked"; },
  DEDUCTOR: [["deductorType", "Deductor category", "cat"], ["tan", "TAN", ""], ["gstin", "GSTIN", ""], ["branch", "Branch / division", ""], ["flat", "Flat / door / block", ""], ["postOffice", "Post office", ""],
    ["premises", "Building", ""], ["road", "Road / street", ""], ["area", "Area / locality", ""], ["town", "District", ""], ["state", "State", "state"], ["pin", "PIN code", ""], ["country", "Country", ""],
    ["email", "E-mail", ""], ["phoneCc", "Phone country code", ""], ["phone", "Phone", ""], ["person", "Responsible person: name", ""], ["personDesignation", "Responsible person: designation", ""],
    ["personPan", "Responsible person: PAN", ""], ["personFlat", "Responsible person: flat / door", ""], ["personPostOffice", "Responsible person: post office", ""], ["personPremises", "Responsible person: building", ""],
    ["personRoad", "Responsible person: road", ""], ["personArea", "Responsible person: area", ""], ["personTown", "Responsible person: district", ""], ["personState", "Responsible person: state", "state"],
    ["personPin", "Responsible person: PIN code", ""], ["personCountry", "Responsible person: country", ""], ["personEmail", "Responsible person: e-mail", ""], ["personPhoneCc", "Responsible person: mobile country code", ""],
    ["personPhone", "Responsible person: mobile", ""]],
  SAL: [["regime", "Regime (New / Old)"], ["senior", "Senior citizen (old regime)"], ["hraMetro", "Rent in a metro"], ["rent", "Rent paid"], ["landlordPan", "Landlord's PAN"], ["landlordName", "Landlord's name"],
    ["hlInterest", "Housing-loan interest"], ["lenderPan", "Lender's PAN"], ["lenderName", "Lender's name"], ["prevSalary", "Previous employer: salary"], ["prevTds", "Previous employer: TDS"],
    ["d80C", "80C"], ["d80CCD1B", "80CCD(1B)"], ["d80D", "80D self"], ["d80DParents", "80D parents"], ["parentsSenior", "Parents senior"], ["d80E", "80E"], ["d80G", "80G"], ["d80TTA", "80TTA"], ["d80CCD2", "80CCD(2)"], ["dOther", "Other Chapter VI-A"]],
  catWord(c) { return c ? c + " · " + ((TDSF25.CATEGORY || {})[c] || "") : ""; },
  stateWord(code) { if (!code) return ""; const n = Object.keys(TDSF25.STATES || {}).find((k) => TDSF25.STATES[k] === code); return code + " · " + (n || ""); },

  // ---------------------------------------------------------------- the return as the workbook shows it
  data(form, fy, q) {
    const co = CO() || {}, firm = TDS26Q.firmDetails(), d26 = co.tds26q || {}, key = TDSReg.key(form, fy, q), uses = TDSReg.uses(), cx = TDSReg.ctx();
    const rows = this.rows(form, fy, q), chs = this.challans(form, fy, q), chBy = {}; TDS.challans().forEach((c) => { chBy[c.id] = c; });
    let probs = {}; try { probs = TDSEdit.problems(rows, fy, q, form); } catch (e) { /* */ }
    const deductor = this.DEDUCTOR.map(([k, label, kind]) => {
      const v = k === "tan" ? co.tan || "" : k === "deductorType" ? d26.deductorType || "" : d26[k] == null ? "" : d26[k];
      return { k, label, kind, v: kind === "cat" ? this.catWord(v) : kind === "state" ? this.stateWord(v) : String(v), hint: k === "deductorType" && !v ? "from the PAN: " + this.catWord(firm.category || "") : "" };
    });
    const challans = chs.map((c) => {
      const here = R2(((uses[c.id] || {})[key] || {}).tax), bal = TDSReg.balance(c, cx), por = TDSReg.portionFor(c, form, fy, q, cx), all = TDSReg.portionsUsed(c, cx), mine = TDSReg.explicit(c) ? TDSReg.portionSet(c, form, fy, q, cx) : { interest: 0, fee234: 0, others: 0 };
      return { key: c.id, src: TDSReg.srcShort(c), tally: TDSReg.srcOf(c) === "tally", bsr: c.bsr || "", date: TDS.ymd(c.date), serial: c.serial || "", section: TDSReg.natureCode(c) || c.section || "", minor: String(c.minorHead || "200"),
        tax: R2(c.tax), interest: R2(c.interest), fee: R2(c.fee), others: R2(c.others), ia: R2(por.interest), fa: R2(por.fee234 != null ? por.fee234 : por.fee), oa: R2(por.others || 0),
        usedHere: here, usedElse: R2(num(c.tax) - bal.tax - here), allocElse: R2(all.interest + all.fee234 + all.others - mine.interest - mine.fee234 - mine.others), mode: c.mode || "", label: chLab(c.bsr, c.date, c.serial) };
    });
    const labOf = (id) => { const c = chBy[id]; return c ? chLab(c.bsr, c.date, c.serial) : ""; };
    const deductions = rows.map((r) => {
      const books = r.books ? r.books.tds : r.tds, rec = TDSPanFix.of(r.party || r.employee || "");
      return { key: r.id, date: TDS.ymd(r.date), credit: TDS.ymd(r.credit || r.date), party: r.party || r.employee || "", pan: r.pan || "", panOwn: !!(r.edited && r.edited.includes("pan")),
        section: form === "27EQ" ? r.code || "" : r.section || "", rate: this.rateOut(r), paid: R2(r.paid), tds: R2(r.tds), books: R2(books), remark: this.remarkOf(r, form), cert: form === "24Q" ? "" : this.certOf(r, form),
        challan: labOf(r.challan), voucher: r.voucher || "", src: r.added ? "Added in FinCom" : r.src === "payroll" ? "Tally payroll" : r.src === "sheet" ? "Salary sheet" : "Tally", fix: (probs[r.id] || []).join("; "), split: !!r.splitOf, nameFile: rec && rec.name };
    });
    let dees = []; try { dees = TDSPanFix.list(form, fy, q); } catch (e) { /* */ }
    const deductees = dees.map((p) => {
      const dc = TDSDecl.of(p.party, fy), nr = TDS26Q.nrInfo(TDSDecl.keyOf(p.party)) || {}, own = p.rows.find((r) => r.edited && r.edited.includes("dcode"));
      const code = own ? own.dcode : TDSEdit.codeOf(p.pan);
      return { key: p.party, name: p.party, nameFile: p.name !== p.party ? p.name : "", pan: p.pan || "", status: this.status(p.pan), type: code === "01" ? "Company" : "Non-company", secs: p.secs.join(", "), n: p.n, tds: p.tds,
        t: dc.t ? "Yes" : "No", decl: (dc.b || {}).form || "", declDate: (dc.b || {}).date || "", uin: (dc.b || {}).uin || "",
        country: nr.country || "", nature: nr.nature || "", ack15ca: nr.ack15ca || "", tin: nr.tin || "", email: nr.email || "", phone: nr.phone || "", address: nr.address || "", dtaa: nr.dtaa ? "Yes" : "No", trc: nr.trc ? "Yes" : "No" };
    });
    let salary = null;
    if (form === "24Q" && q === "Q4") {
      if (Payroll.has(fy)) salary = Payroll.annexII(fy).map((e) => { const dd = Payroll.detail(e); return { key: e.guid, name: e.name, pan: e.pan || "", fig: { gross: R2(e.gross), exempt: R2(e.hraExempt), standard: R2(e.standard), chapter6: R2(e.chapter6), taxable: R2(e.totalIncome), tax: R2(e.taxPayable), tds: R2(e.tdsHere) },
        v: Object.fromEntries(this.SAL.map(([k]) => [k, k === "regime" ? (dd.regime === "old" ? "Old" : "New") : /^(senior|hraMetro|parentsSenior)$/.test(k) ? (dd[k] === "yes" ? "Yes" : "No") : dd[k] == null ? "" : dd[k]])) }; });
      else if (((S.books || {}).salary || []).length) salary = TDS24Q.annexII(fy).map((e) => ({ key: "", name: e.name, pan: e.pan || "", fig: { gross: e.gross, exempt: e.exempt, standard: e.standard, chapter6: e.chapter6, taxable: e.taxable, tax: R2(e.tds), tds: R2(e.tds) }, v: { regime: e.regime === "O" ? "Old" : e.regime === "N" ? "New" : "" } }));
    }
    return { meta: { client: co.name || "", cid: (S.books || {}).cid || "", tan: co.tan || "", form, fy, q, formName: TDS.formShort(form, fy), made: new Date().toISOString(), ver: VERSION },
      deductor, challans, deductions, deductees, salary, summary: this.summary(form, fy, q),
      lists: { sections: this.sections(form), remarks: this.remarks(form), types: ["Company", "Non-company"], rates: this.rates(), status: ["Operative", "Inoperative", "Not checked"], yesno: ["Yes", "No"],
        codes: form === "27EQ" ? TCS27EQ.CODES.map(([c, t]) => [c, t]) : [], minor: ["200", "400"], decl: ["15G", "15H"], modes: ["online", "bank"], regime: ["New", "Old"],
        states: Object.keys(TDSF25.STATES || {}).map((n) => TDSF25.STATES[n] + " · " + n), cats: Object.keys(TDSF25.CATEGORY || {}).map((c) => this.catWord(c)),
        countries: form === "27Q" ? Object.keys(TDSF25.COUNTRIES || {}).map((n) => TDSF25.COUNTRIES[n] + " · " + n) : [] } };
  },
  // FinCom's figures of the return: TDS, on challans, the gap, by section; interest; the 234E fee
  summary(form, fy, q) {
    const rows = this.rows(form, fy, q), tds = R2(rows.reduce((a, r) => a + num(r.tds), 0)), onch = R2(rows.filter((r) => r.challan).reduce((a, r) => a + num(r.tds), 0));
    const bySec = {}; rows.forEach((r) => { const s = form === "27EQ" ? r.code || "" : r.section || ""; const x = bySec[s] = bySec[s] || { n: 0, paid: 0, tds: 0 }; x.n++; x.paid = R2(x.paid + num(r.paid)); x.tds = R2(x.tds + num(r.tds)); });
    const filed = TDSFiled.get(fy, q, form), lf = TDS.lateFee(fy, q, filed ? filed.on : "", form), it = TDS.interest(fy, q, form);
    let ia = 0; this.challans(form, fy, q).forEach((c) => { ia = R2(ia + num(TDSReg.portionFor(c, form, fy, q).interest)); });
    return { n: rows.length, paid: R2(rows.reduce((a, r) => a + num(r.paid), 0)), tds, onch, gap: R2(tds - onch), bySec, interest: R2(it.reduce((a, x) => a + num(x.amount), 0)), ia,
      due: TDS.returnDue(fy, q, form), asOf: (lf && lf.filed) || "", fee: lf ? R2(lf.fee) : 0 };
  },

  // ---------------------------------------------------------------- the workbook against FinCom
  plan(form, fy, q, x) {
    const pv = { form, fy, q, name: x.name || "", fatal: "", deductor: [], challans: { add: [], edit: [], out: [], alloc: [] }, deductions: { add: [], edit: [], out: [], back: [] }, deductees: { add: [], edit: [] }, salary: { edit: [] },
      errors: [], warnings: [], notes: [], excel: x.summary || null };
    const E = (sheet, row, words) => pv.errors.push({ sheet, row, words }), W = (sheet, row, words) => pv.warnings.push({ sheet, row, words });
    const m = x.meta || {};
    if (m.ver && m.ver !== VERSION) { pv.fatal = "This Excel was made by another version of FinCom (" + m.ver + "): download it again."; return pv; }
    if ((m.form && m.form !== form) || (m.fy && m.fy !== fy) || (m.q && m.q !== q)) { pv.fatal = "This Excel is for " + (m.form || "") + " " + (m.q || "") + " " + (m.fy || "") + ": open that return to upload it."; return pv; }
    if (m.cid && S.books && S.books.cid && m.cid !== S.books.cid) { pv.fatal = "This Excel is another client's (" + (m.client || m.cid) + ")."; return pv; }
    if (TDSReg.locked(fy, q, form)) { pv.fatal = TDSReg.lockWords(fy, q, form); return pv; }
    const co = CO() || {}, d26 = co.tds26q || {};
    // ---- Deductor
    (x.deductor || []).forEach((y) => {
      const spec = this.DEDUCTOR.find(([k]) => k === y.k); if (!spec) return;
      const [k, label, kind] = spec, cur = k === "tan" ? co.tan || "" : String(d26[k] == null ? "" : d26[k]);
      let v = T(y.v);
      if (kind === "cat" || kind === "state") v = v.split("·")[0].trim();
      if (/^(tan|personPan|gstin)$/.test(k)) v = v.toUpperCase();
      if (v === cur) return;
      if (k === "tan" && !/^[A-Z]{4}\d{5}[A-Z]$/.test(v)) return E("Deductor", y.row, label + " “" + v + "”: a TAN is 4 letters, 5 digits, a letter");
      if (k === "personPan" && v && !Certs.validPan(v)) return E("Deductor", y.row, label + " “" + v + "”: not a PAN");
      if (/[pP]in$/.test(k) && v && !/^\d{6}$/.test(v)) return E("Deductor", y.row, label + " “" + v + "”: six digits");
      if (/[pP]hone$/.test(k) && v && !/^\d{1,12}$/.test(v)) return E("Deductor", y.row, label + " “" + v + "”: digits only");
      if (kind === "state" && v && !Object.values(TDSF25.STATES || {}).includes(v)) return E("Deductor", y.row, label + " “" + v + "”: choose the state from the list");
      if (kind === "cat" && v && !(TDSF25.CATEGORY || {})[v]) return E("Deductor", y.row, label + " “" + v + "”: choose the category from the list");
      if (/[eE]mail$/.test(k) && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) W("Deductor", y.row, label + " “" + v + "” does not look like an e-mail address");
      pv.deductor.push({ k, label, from: cur, to: v, row: y.row });
    });
    // ---- Challans
    const now = this.challans(form, fy, q), byId = {}, allCh = TDS.challans(); allCh.forEach((c) => { byId[c.id] = c; });
    const seenCh = new Set(), fileCh = {}, keyIdx = {}; allCh.forEach((c) => { keyIdx[TDSCH.chKey(c)] = c; });
    const AM = ["tax", "interest", "fee", "others"];
    (x.challans || []).forEach((y) => {
      const any = [y.bsr, y.date, y.serial, y.tax].some((v) => T(v) !== "");
      if (!y.key && !any) return;
      const date = ymd(y.date);
      if (date === null) return E("Challans", y.row, "date of deposit “" + T(y.date) + "” is not a date (dd-mm-yyyy)");
      const amt = {}; let bad = "";
      AM.forEach((k) => { const v = T(y[k]) === "" ? 0 : N(y[k]); if (isNaN(v) || v < 0) bad = k; amt[k] = R2(v); });
      if (bad) return E("Challans", y.row, bad + " “" + T(y[bad]) + "”: an amount in rupees, not below nil");
      const al = {}; ["ia", "fa", "oa"].forEach((k) => { const v = T(y[k]) === "" ? 0 : N(y[k]); al[k] = isNaN(v) || v < 0 ? null : R2(v); });
      const lab = chLab(y.bsr, date, y.serial), want = { bsr: T(y.bsr), date, serial: T(y.serial), section: T(y.section).toUpperCase(), minor: T(y.minor) || "200", mode: T(y.mode) || "online", ...amt };
      if (y.key) {
        const c = byId[y.key];
        if (!c) return E("Challans", y.row, "the hidden key is not one of this client's challans (edited, or another client's file)");
        seenCh.add(c.id);
        fileCh[lab] = { c, row: y.row, tax: amt.tax };
        const cur = { bsr: c.bsr || "", date: TDS.ymd(c.date), serial: c.serial || "", section: String(TDSReg.natureCode(c) || c.section || "").toUpperCase(), minor: String(c.minorHead || "200"), mode: c.mode || "online", tax: R2(c.tax), interest: R2(c.interest), fee: R2(c.fee), others: R2(c.others) };
        const fields = Object.keys(want).filter((k) => (AM.includes(k) ? Math.abs(cur[k] - want[k]) >= 0.005 : k === "mode" ? !!c.mode && cur[k] !== want[k] : String(cur[k]) !== String(want[k]))).map((k) => ({ k, from: cur[k], to: want[k] }));
        const onlyNature = fields.every((f) => f.k === "section");
        if (fields.length) {
          if (TDSReg.srcOf(c) === "tally" && !onlyNature) E("Challans", y.row, "challan " + chLab(c.bsr, c.date, c.serial) + " was read from Tally: change its figures in Tally (only its nature can be set here)");
          else { const no = onlyNature ? TDSReg.filedWords(c) : TDSReg.canEdit(c); if (no) E("Challans", y.row, no); else pv.challans.edit.push({ row: y.row, c, fields, want }); }
        }
        const por = TDSReg.portionFor(c, form, fy, q), pc = { ia: R2(por.interest), fa: R2(por.fee234 != null ? por.fee234 : por.fee), oa: R2(por.others || 0) };
        if (["ia", "fa", "oa"].some((k) => al[k] === null)) E("Challans", y.row, "an allocated amount is not a number of rupees");
        else if (["ia", "fa", "oa"].some((k) => Math.abs(al[k] - pc[k]) >= 0.005)) pv.challans.alloc.push({ row: y.row, c, from: pc, to: al });
      } else {
        const chk = TDSReg.check({ bsr: want.bsr, date: dmy(date), serial: want.serial, section: want.section, minorHead: want.minor, tax: amt.tax, interest: amt.interest, fee: amt.fee, others: amt.others, mode: want.mode });
        if (!chk.ok) return E("Challans", y.row, "new challan " + lab + ": " + Object.values(chk.errors).join(" "));
        if (fileCh[lab]) return E("Challans", y.row, "challan " + lab + " is twice in the sheet");
        const add = { row: y.row, x: want, chk: chk.c, lab, al };
        pv.challans.add.push(add); fileCh[lab] = { add, row: y.row, tax: amt.tax };
      }
    });
    { const k0 = TDSReg.key(form, fy, q), us = TDSReg.uses(); now.filter((c) => !seenCh.has(c.id) && ((us[c.id] || {})[k0] || (TDSReg.portions(c) || {})[k0])).forEach((c) => pv.challans.out.push({ c, used: true })); }
    // ---- Deductees (before Deductions: a new deduction's PAN and type come from here)
    const dees = (() => { try { return TDSPanFix.list(form, fy, q); } catch (e) { return []; } })(), deeBy = {}; dees.forEach((p) => { deeBy[normName(p.party)] = p; });
    const fileDee = {};
    (x.deductees || []).forEach((y) => {
      const name = T(y.key) || T(y.name);
      if (!name && !T(y.pan)) return;
      if (!name) return E("Deductees", y.row, "a PAN with no deductee's name");
      const p = deeBy[normName(name)] || (y.key ? null : null), pan = T(y.pan).toUpperCase().replace(/\s/g, "");
      if (pan && pan !== "PANNOTAVBL" && !Certs.validPan(pan)) E("Deductees", y.row, name + ": PAN “" + pan + "” is not a PAN (five letters, four digits, a letter)");
      const party = p ? p.party : name, curDecl = TDSDecl.of(party, fy), nr = TDS26Q.nrInfo(TDSDecl.keyOf(party)) || {};
      const own = p && p.rows.find((r) => r.edited && r.edited.includes("dcode")), dc = own ? own.dcode : p ? TDSEdit.codeOf(p.pan) : "";
      const cur = p ? { nameFile: p.name !== p.party ? p.name : "", pan: p.pan || "", status: this.status(p.pan), type: dc === "01" ? "Company" : "Non-company" } : { nameFile: "", pan: TDS.panOf(name) || "", status: "", type: "" };
      const want = { nameFile: T(y.nameFile), pan: pan === "PANNOTAVBL" ? "" : pan, status: T(y.status), type: T(y.type) };
      const fields = [];
      if (want.pan !== String(cur.pan || "").toUpperCase() && !(pan && !Certs.validPan(pan) && pan !== "PANNOTAVBL")) fields.push({ k: "pan", from: cur.pan, to: want.pan });
      if (want.nameFile !== cur.nameFile && !(want.nameFile === party)) fields.push({ k: "nameFile", from: cur.nameFile, to: want.nameFile });
      if (want.type && want.type !== cur.type) { if (!/^(Company|Non-company)$/.test(want.type)) E("Deductees", y.row, name + ": type “" + want.type + "”: Company or Non-company"); else fields.push({ k: "type", from: cur.type, to: want.type }); }
      if (p && want.status && want.status !== cur.status && !(/^(Operative|Not checked)$/.test(want.status) && /^(Operative|Not checked)$/.test(cur.status))) {
        if (!/^(Operative|Inoperative|Not checked)$/.test(want.status)) E("Deductees", y.row, name + ": PAN status “" + want.status + "”: Operative, Inoperative or Not checked");
        else if (cur.status === "Inoperative" && !((S.books.panInoperative || {})[String(want.pan || cur.pan).toUpperCase()])) E("Deductees", y.row, name + ": TRACES found PAN " + cur.pan + " inoperative; FinCom keeps that");
        else if (want.status === "Inoperative" && !Certs.validPan(want.pan || cur.pan)) E("Deductees", y.row, name + ": only a valid PAN can be marked inoperative");
        else fields.push({ k: "status", from: cur.status, to: want.status });
      }
      if (form === "26Q") {
        const wt = YES(y.t), wd = T(y.decl).toUpperCase().replace(/^FORM\s*/, ""), wdd = ymd(y.declDate), wu = T(y.uin).toUpperCase().replace(/\s/g, "");
        if (wt !== !!curDecl.t) fields.push({ k: "t", from: curDecl.t ? "Yes" : "No", to: wt ? "Yes" : "No" });
        const cb = curDecl.b || {};
        if (wd && !/^15[GH]$/.test(wd)) E("Deductees", y.row, name + ": declaration “" + T(y.decl) + "”: 15G or 15H (Form 121 from 2026-27 is written 15G / 15H as FinCom keeps it)");
        else if (wdd === null) E("Deductees", y.row, name + ": date received “" + T(y.declDate) + "” is not a date");
        else if (wu && !/^[A-Z0-9]{1,26}$/.test(wu)) E("Deductees", y.row, name + ": UIN “" + wu + "”: letters and digits, 26 at most");
        else if (wd !== (cb.form || "") || (wd && (wdd || "") !== (cb.date || "")) || (wd && wu !== (cb.uin || ""))) fields.push({ k: "decl", from: [cb.form, dmy(cb.date), cb.uin].filter(Boolean).join(" · "), to: [wd, dmy(wdd), wu].filter(Boolean).join(" · "), v: { form: wd, date: wdd || "", uin: wu } });
      }
      if (form === "27Q") ["country", "nature", "ack15ca", "tin", "email", "phone", "address"].forEach((k) => { let v = T(y[k]); if (k === "country" || k === "nature") v = v.split("·")[0].trim(); if (v !== String(nr[k] || "")) fields.push({ k, from: nr[k] || "", to: v, nr: true }); });
      if (form === "27Q") ["dtaa", "trc"].forEach((k) => { const v = YES(y[k]); if (v !== !!nr[k]) fields.push({ k, from: nr[k] ? "Yes" : "No", to: v ? "Yes" : "No", nr: true, b: v }); });
      fileDee[normName(party)] = { party, pan: want.pan || cur.pan || "", type: want.type || cur.type, row: y.row, isNew: !p };
      if (!p) pv.deductees.add.push({ row: y.row, party, fields });
      else if (fields.length) pv.deductees.edit.push({ row: y.row, party, p, fields });
    });
    // ---- Deductions
    const rows = this.rows(form, fy, q), rBy = {}; rows.forEach((r) => { rBy[r.id] = r; });
    const outIds = new Set((typeof TDSEdit === "object" ? TDSEdit.outList() : []).map((o) => o.id)), seen = new Set(), allowed = this.remarks(form);
    const chFor = (s, row) => {
      if (!T(s)) return { id: "" };
      const L = parseLab(s);
      if (!L) { E("Deductions", row, "challan “" + T(s) + "”: pick it from the list (BSR/dd-mm-yyyy/serial)"); return null; }
      const f = Object.keys(fileCh).find((k) => { const z = parseLab(k); return z && z.key === L.key; });
      if (f) return fileCh[f].add ? { add: fileCh[f].add, lab: f } : { id: fileCh[f].c.id, lab: f };
      const c = keyIdx[L.key];
      if (c) return { id: c.id, lab: chLab(c.bsr, c.date, c.serial) };
      E("Deductions", row, "challan “" + T(s) + "” is not on the Challans sheet: add it there first"); return null;
    };
    const fileUse = {};   // challan label -> TDS in the file (for the balance)
    const isNoTaxRemark = (s) => /^[BTY]$/.test(s);
    (x.deductions || []).forEach((y) => {
      const inputs = [y.date, y.credit, y.party, y.section, y.rate, y.paid, y.remark, y.cert, y.challan].some((v) => T(v) !== "");
      if (!y.key && !inputs) return;
      const r = y.key ? rBy[y.key] : null, who0 = T(y.party) || (r && r.party) || "row " + y.row;
      if (y.key && !r && !outIds.has(y.key)) return E("Deductions", y.row, who0 + ": the hidden key is not one of this return's " + (form === "27EQ" ? "collections" : "deductions") + " (edited, or from another return)");
      if (y.key) seen.add(y.key);
      const date = ymd(y.date), credit = T(y.credit) === "" ? "" : ymd(y.credit);
      if (!date) return E("Deductions", y.row, who0 + ": date of deduction “" + T(y.date) + "” is not a date");
      if (credit === null) return E("Deductions", y.row, who0 + ": date paid or credited “" + T(y.credit) + "” is not a date");
      if (TDS.fyOf(date) !== fy || TDS.qOf(date) !== q) E("Deductions", y.row, who0 + ": dated " + dmy(date) + ", not in " + q + " " + fy + " (each quarter has its own return)");
      if (credit && credit > date) W("Deductions", y.row, who0 + ": deducted on " + dmy(date) + ", before it was paid or credited on " + dmy(credit));
      const paid = T(y.paid) === "" ? 0 : N(y.paid), rate = T(y.rate) === "" ? NaN : N(y.rate);
      if (isNaN(paid) || paid < 0) return E("Deductions", y.row, who0 + ": amount paid “" + T(y.paid) + "” is not an amount");
      if (T(y.rate) !== "" && (isNaN(rate) || rate < 0 || rate > 100)) return E("Deductions", y.row, who0 + ": rate “" + T(y.rate) + "”: a number from 0 to 100");
      let tds = y.tds == null || T(y.tds) === "" ? NaN : N(y.tds);
      if (isNaN(tds)) { tds = paid ? R2(paid * (isNaN(rate) ? 0 : rate) / 100) : r ? R2(r.tds) : 0; if (y.tdsF) pv.notes.push(who0 + " (row " + y.row + "): TDS worked out as Amount paid × Rate (the file kept no value for its formula)"); }
      if (tds < 0) return E("Deductions", y.row, who0 + ": TDS below nil");
      if (tds > paid + 0.005 && paid > 0) E("Deductions", y.row, who0 + ": TDS " + tds + " is more than the amount paid " + paid);
      let section = T(y.section).toUpperCase().replace(/\s+/g, ""), code = "";
      if (form === "27EQ") { code = section.split("·")[0].trim(); section = r ? r.section : "206C"; if (code && !TCS27EQ.CODES.some(([c]) => c === code)) E("Deductions", y.row, who0 + ": collection code “" + code + "” is not one of 27EQ's"); }
      else if (form === "24Q") section = section || (r ? r.section : "192");
      if (form !== "27EQ") {
        if (!section) E("Deductions", y.row, who0 + ": no section");
        else if (!knownSec(section) && !(r && TDS.sec(r.section) === TDS.sec(section))) E("Deductions", y.row, who0 + ": section " + section + " is not one FinCom knows");
        else if (formOf(section) !== form && !(r && TDS.sec(r.section) === TDS.sec(section))) E("Deductions", y.row, who0 + ": section " + section + " is filed in " + (formOf(section) || "its own statement on the portal (26QB / 26QC / 26QD)") + ", not " + form);
      }
      const party = T(y.party) || (r ? r.party || r.employee || "" : ""), dee = fileDee[normName(party)];
      const pan = y.panF ? (dee ? dee.pan : r ? r.pan : TDS.panOf(party)) : T(y.pan).toUpperCase();
      if (!y.panF && pan && pan !== "PANNOTAVBL" && !Certs.validPan(pan)) E("Deductions", y.row, who0 + ": PAN “" + pan + "” is not a PAN");
      // the remark: B, T, Y kept as the deduction's basis (a payment with no tax); A with its certificate number; C as FinCom works it out
      const rm = T(y.remark).toUpperCase(), cert = T(y.cert).toUpperCase().replace(/\s/g, "");
      if (rm && !allowed.includes(rm)) E("Deductions", y.row, who0 + ": remark “" + rm + "” is not one " + TDS.formName(form, fy) + " takes (" + allowed.join(", ") + ")");
      if (isNoTaxRemark(rm) && tds > 0.005) E("Deductions", y.row, who0 + ": remark " + rm + " is for a payment with no tax deducted; TDS is " + tds);
      if (rm === "A" && !cert) E("Deductions", y.row, who0 + ": remark A needs the lower-deduction certificate's number");
      if (rm === "T" && !/^194C/.test(TDS.sec(section))) E("Deductions", y.row, who0 + ": remark T (a transporter) is for 194C only");
      const panOk = Certs.validPan(pan) && !Certs.inoperative(pan);
      if (rm === "C" && (panOk || (form !== "27Q" && form !== "24Q" && (isNaN(rate) ? (paid ? tds / paid * 100 : 0) : rate) < (/^194[QO]$/.test(TDS.sec(section)) ? 5 : 20) - 0.001))) E("Deductions", y.row, who0 + ": remark C is for a deduction at the higher rate (20%) with no valid, operative PAN");
      if (!panOk && tds > 0.005 && form !== "27EQ" && form !== "24Q" && !cert && (isNaN(rate) ? tds / (paid || 1) * 100 : rate) < (/^194[QO]$/.test(TDS.sec(section)) ? 5 : 20) - 0.001) W("Deductions", y.row, who0 + ": no valid PAN, but deducted below 20% (section 206AA)");
      const ch = chFor(y.challan, y.row); if (ch === null) return;
      if (ch.lab && tds > 0) fileUse[ch.lab] = R2((fileUse[ch.lab] || 0) + tds);
      const want = { date, credit: credit || date, party, pan, section, code, rate: isNaN(rate) ? (paid ? tds / paid * 100 : 0) : rate, paid: R2(paid), tds: R2(tds), basis: isNoTaxRemark(rm) ? rm : "", cert, rm, ch, type: dee ? dee.type : "" };
      if (!r) {
        if (y.key && outIds.has(y.key)) { pv.deductions.back.push({ row: y.row, id: y.key, want }); return; }
        if (!party) return E("Deductions", y.row, "a new row with no deductee");
        if (!(paid > 0)) return E("Deductions", y.row, party + ": a new row needs the amount paid or credited");
        pv.deductions.add.push({ row: y.row, want });
        return;
      }
      if (r.splitOf) {
        const cl = ch.id !== r.challan || !!ch.add;
        if (Math.abs(r.tds - want.tds) >= 0.005 || Math.abs(r.paid - want.paid) >= 0.005 || date !== TDS.ymd(r.date) || TDS.sec(section) !== TDS.sec(r.section)) E("Deductions", y.row, who0 + ": a part of a split row: change the split on Challans (only its challan can be changed here)");
        if (cl) pv.deductions.edit.push({ row: y.row, r, fields: [{ k: "challan", from: this.labOfId(r.challan), to: ch.lab || "" }], want });
        return;
      }
      const fields = [], same = (a, b) => String(a == null ? "" : a) === String(b == null ? "" : b), F = (k, from, to) => fields.push({ k, from, to });
      if (date !== TDS.ymd(r.date)) F("date", dmy(TDS.ymd(r.date)), dmy(date));
      if ((credit || date) !== TDS.ymd(r.credit || r.date)) F("credit", dmy(TDS.ymd(r.credit || r.date)), dmy(credit || date));
      if (party && !same(party, r.party || r.employee || "")) F("party", r.party || r.employee || "", party);
      if (!y.panF && !same(pan === "PANNOTAVBL" ? "" : pan, String(r.pan || "").toUpperCase()) && !(dee && dee.pan === pan)) F("pan", r.pan || "", pan === "PANNOTAVBL" ? "" : pan);
      if (form === "27EQ") { if (code && code !== (r.code || "")) F("code", r.code || "", code); }
      else if (TDS.sec(section) !== TDS.sec(r.section)) F("section", r.section, section);
      if (Math.abs(want.paid - R2(r.paid)) >= 0.005) F("paid", R2(r.paid), want.paid);
      const r0 = this.rateOut(r);
      if (!isNaN(rate) && Math.abs(rate - r0) > 1e-6 && Math.abs(R2(rate) - R2(r0)) >= 0.005) F("rate", R2(r0), R2(rate));
      if (Math.abs(want.tds - R2(r.tds)) >= 0.005) F("tds", R2(r.tds), want.tds);
      const curRm = this.remarkOf(r, form), curCert = form === "24Q" ? "" : this.certOf(r, form);
      if (form !== "24Q" && cert !== curCert && !(rm === "" && !r.cert && curCert && !cert)) F("cert", curCert, cert);
      if ((want.basis || "") !== (r.basis || "") && (want.basis || /^[BTY]$/.test(r.basis || ""))) F("basis", r.basis || "", want.basis);
      if (rm !== curRm && !fields.some((f) => f.k === "basis" || f.k === "cert") && rm !== "C" && curRm && !rm) W("Deductions", y.row, who0 + ": the remark was taken off, but FinCom still writes " + curRm + " (" + (curRm === "C" ? "no valid, operative PAN at the higher rate" : curRm === "A" ? "a section 197 certificate in FinCom's list covers it" : "from the deductee's declaration or the year's limit") + ")");
      const chTo = ch.add ? ch.lab : ch.lab || "";
      if (ch.add || (ch.id || "") !== (r.challan || "")) F("challan", this.labOfId(r.challan), chTo);
      if (fields.length) pv.deductions.edit.push({ row: y.row, r, fields, want });
    });
    rows.filter((r) => !seen.has(r.id)).forEach((r) => { if (r.splitOf) E("Deductions", "", (r.party || "") + ": a part of a split row is missing; take the split off on Challans first"); else pv.deductions.out.push({ r }); });
    // ---- the challans' balance as the file has them: deposited less this return's use in the file and the others' use (FinCom)
    const elseOf = (c) => { const k = TDSReg.key(form, fy, q), here = R2(((TDSReg.uses()[c.id] || {})[k] || {}).tax); return R2(num(c.tax) - TDSReg.balance(c).tax - here); };
    pv.balances = Object.keys(fileCh).map((lab) => {
      const f = fileCh[lab], c = f.c, tax = f.tax, used = R2(fileUse[lab] || 0), other = c ? elseOf(c) : 0, before = c ? R2(TDSReg.balance(c).tax) : null, after = R2(tax - used - other);
      if (after < -0.005) E("Challans", f.row, "challan " + lab + " is over-used: deposited ₹" + INR.format(tax) + ", this return ₹" + INR.format(used) + (other ? ", other returns ₹" + INR.format(other) : "") + ": ₹" + INR.format(-after) + " more than it has");
      return { lab, before, after, used, show: before == null || Math.abs(before - after) >= 0.005 || used > 0 };
    }).filter((z) => z.show || z.after < -0.005);
    // ---- Salary annexure II (24Q Q4, Tally's payroll): the employees' declarations
    if (form === "24Q" && Payroll.has(fy)) (x.salary || []).forEach((y) => {
      if (!y.key) return;
      const e = Payroll.employees().find((z) => z.guid === y.key); if (!e) return E("Salary annexure II", y.row, "the hidden key is not one of the payroll's employees");
      const dd = Payroll.detail(e), fields = [];
      this.SAL.forEach(([k, label]) => {
        if (y[k] === undefined) return;
        let v = T(y[k]), cur = dd[k] == null ? "" : String(dd[k]);
        if (k === "regime") { if (v && !/^(new|old)$/i.test(v)) return E("Salary annexure II", y.row, e.name + ": regime “" + v + "”: New or Old"); v = /^old$/i.test(v) ? "old" : "new"; cur = cur === "old" ? "old" : "new"; }
        else if (/^(senior|hraMetro|parentsSenior)$/.test(k)) { v = YES(v) ? "yes" : "no"; cur = cur === "yes" ? "yes" : "no"; }
        else if (/Pan$/.test(k)) { v = v.toUpperCase(); if (v && !Certs.validPan(v)) return E("Salary annexure II", y.row, e.name + ": " + label + " “" + v + "” is not a PAN"); }
        else if (!/Name$/.test(k)) { const n = v === "" ? "" : N(v); if (n !== "" && (isNaN(n) || n < 0)) return E("Salary annexure II", y.row, e.name + ": " + label + " “" + v + "” is not an amount"); v = n === "" ? "" : String(R2(n)); cur = cur === "" ? "" : String(R2(cur)); }
        if (v !== cur && !(v === "" && cur === "0")) fields.push({ k, label, from: cur, to: v });
      });
      if (fields.length) pv.salary.edit.push({ row: y.row, e, fields });
    });
    return pv;
  },
  labOfId(id) { const c = id && TDS.challans().find((z) => z.id === id); return c ? chLab(c.bsr, c.date, c.serial) : ""; },
  count(pv) { const c = pv.challans, d = pv.deductions, e = pv.deductees; return pv.deductor.length + c.add.length + c.edit.length + c.out.filter((o) => o.used).length + c.alloc.length + d.add.length + d.edit.length + d.out.length + d.back.length + e.add.length + e.edit.length + pv.salary.edit.length; },

  // ---------------------------------------------------------------- doing it
  snap() { const b = S.books || {}, co = CO() || {}, o = {}; KEEP.concat(["allocLog", "matchNo"]).forEach((k) => { o[k] = clone(b[k]); }); o.__co = { tds26q: clone(co.tds26q), tan: co.tan }; return o; },
  restore(o) { const b = S.books, co = CO() || {}; KEEP.concat(["allocLog", "matchNo"]).forEach((k) => { if (o[k] === undefined) delete b[k]; else b[k] = o[k]; }); if (o.__co) { if (o.__co.tds26q === undefined) delete co.tds26q; else co.tds26q = o.__co.tds26q; co.tan = o.__co.tan; } b.panIndex = null; TDSReg.forget(); },
  // every change of the plan made on the books; nothing saved. {why: [refusals]}
  run(pv) {
    const b = S.books, { form, fy, q } = pv, why = [], at = new Date().toISOString(), by = who(), co = CO() || {};
    const no = (sheet, row, w) => why.push({ sheet, row, words: w });
    const reason = "taken out in the Excel brought back" + (pv.name ? " (" + pv.name + ")" : "");
    // Deductor
    if (pv.deductor.length) { co.tds26q = Object.assign({}, co.tds26q || {}); pv.deductor.forEach((d) => { if (d.k === "tan") co.tan = d.to; else co.tds26q[d.k] = d.to; }); }
    // Challans: new ones (never placed by themselves: the sheet says which deductions they pay), changed, their nature
    const made = {};
    pv.challans.add.forEach((a) => {
      const chk = TDSReg.check({ bsr: a.x.bsr, date: dmy(a.x.date), serial: a.x.serial, section: a.x.section, minorHead: a.x.minor, tax: a.x.tax, interest: a.x.interest, fee: a.x.fee, others: a.x.others, mode: a.x.mode });
      if (!chk.ok) return no("Challans", a.row, "new challan " + a.lab + ": " + Object.values(chk.errors).join(" "));
      const c = Object.assign({ id: uid("ch"), from: "hand", madeBy: "excel", autoPlace: "", enteredBy: by, enteredAt: at }, chk.c);
      b.challans = (b.challans || []).concat([c]); made[a.lab] = c.id;
      TDSReg.log({ act: "challan-add", ch: c, tax: c.tax, interest: c.interest, fee: TDSReg.feeOf(c), note: "added in the Excel brought back" });
    });
    pv.challans.edit.forEach((e) => {
      const c = TDSReg.chOf(e.c.id); if (!c) return;
      if (e.fields.every((f) => f.k === "section")) { const r = TDSReg.setNature(c.id, e.want.section); if (!r.ok) no("Challans", e.row, r.why); return; }
      const chk = TDSReg.check({ bsr: e.want.bsr, date: dmy(e.want.date), serial: e.want.serial, section: e.want.section, minorHead: e.want.minor, tax: e.want.tax, interest: e.want.interest, fee: e.want.fee, others: e.want.others, mode: e.want.mode }, c.id);
      if (!chk.ok) return no("Challans", e.row, Object.values(chk.errors).join(" "));
      const was = TDSCH.label(c) + ", tax " + c.tax;
      ["incomeTax", "surcharge", "cess", "fee", "others", "note", "cin"].forEach((k) => { delete c[k]; });
      Object.assign(c, chk.c, { editedBy: by, editedAt: at });
      TDSReg.log({ act: "challan-edit", ch: c, tax: c.tax, interest: c.interest, fee: TDSReg.feeOf(c), note: "edited in the Excel brought back; was " + was });
    });
    TDSReg.forget();
    // Deductees: the PAN book, the name in the file, the status, the declarations and 27Q's details
    const dees = pv.deductees.add.concat(pv.deductees.edit);
    dees.forEach((d) => d.fields.forEach((f) => {
      if (f.k === "pan" || f.k === "nameFile") return;
      if (f.k === "status") { const pan = String(TDS.panOf(d.party) || "").toUpperCase(); b.panInoperative = Object.assign({}, b.panInoperative || {}); if (f.to === "Inoperative") b.panInoperative[pan] = (typeof istToday === "function" ? istToday() : at.slice(0, 10).replace(/-/g, "")); else delete b.panInoperative[pan]; }
      else if (f.k === "t") { const r = TDSDecl.set(d.party, fy, { transporter: f.to === "Yes" }); if (!r.ok) no("Deductees", d.row, r.why); }
      else if (f.k === "decl") { const r = TDSDecl.set(d.party, fy, f.v.form ? { form: f.v.form, date: f.v.date, uin: f.v.uin } : { form: "" }); if (!r.ok) no("Deductees", d.row, r.why); }
      else if (f.nr) { const k0 = TDSDecl.keyOf(d.party); b.nrInfo = Object.assign({}, b.nrInfo); b.nrInfo[k0] = Object.assign({}, b.nrInfo[k0], { [f.k]: f.b != null ? f.b : f.to }); }
    }));
    dees.forEach((d) => {
      const fp = d.fields.find((f) => f.k === "pan"), fn = d.fields.find((f) => f.k === "nameFile");
      if (!fp && !fn) return;
      const rec = TDSPanFix.of(d.party) || {}, pan = fp ? fp.to : rec.pan || "", name = fn ? fn.to : rec.name || "";
      const r = TDSPanFix.set(d.party, { pan: pan || (fp ? "" : TDS.panOf(d.party)), name }, form, fy, q);
      if (!r.ok) no("Deductees", d.row, d.party + ": " + r.why);
    });
    // Deductions taken out (kept in the books), put back, changed, added
    const sets = [];    // [id, chId or "" or {lab}]
    const untagIds = pv.deductions.out.map((o) => o.r.id).filter((id) => b.alloc && b.alloc[id]);
    if (untagIds.length) { const u = TDSCH.untag(untagIds, { nosave: true }); if (!u.ok) no("Deductions", "", u.why); }
    pv.deductions.out.forEach(({ r }) => {
      if (r.added) { const x = TDSAdd.remove(r.id.slice(3), reason); if (!x.ok) no("Deductions", "", (r.party || "") + ": " + x.why); return; }
      b.tdsEdits = b.tdsEdits || {};
      const e = b.tdsEdits[r.id] = b.tdsEdits[r.id] || { f: {}, log: [] };
      e.f.out = { by, at, reason, form, fy, q, party: r.party || r.employee || "", tds: R2(r.tds) }; e.log.push({ field: "out", from: "", to: "taken out", by, at });
    });
    pv.deductions.back.forEach((x) => { const e = (b.tdsEdits || {})[x.id]; if (e && e.f) { delete e.f.out; e.log.push({ field: "out", from: "taken out", to: "put back", by, at }); } });
    TDSReg.forget();
    const rowsNow = () => { const m = {}; this.rows(form, fy, q).forEach((r) => { m[r.id] = r; }); return m; };
    let rBy = rowsNow();
    pv.deductions.back.concat(pv.deductions.edit.map((e) => ({ id: e.r.id, want: e.want, fields: e.fields, row: e.row }))).forEach((e) => {
      const r = rBy[e.id]; if (!r) return no("Deductions", e.row, "the row is no longer in the return");
      const fields = e.fields || [];
      if (r.added) {
        const key = r.id.slice(3), x0 = Object.assign({}, TDSAdd.all()[key] || {});
        const ks = fields.map((f) => f.k).filter((k) => k !== "challan" && k !== "pan" && k !== "code");
        if (ks.length) {
          ks.forEach((k) => { x0[k] = k === "rate" ? R2(e.want.rate * 10000) / 10000 : e.want[k]; });
          if (ks.includes("rate") && !ks.includes("tds")) x0.tds = R2(num(x0.paid) * num(x0.rate) / 100);
          const res = TDSAdd.save(Object.assign({}, x0, { challan: "" }), key); if (!res.ok) no("Deductions", e.row, (r.party || "") + ": " + res.why);
        }
        if (fields.some((f) => f.k === "code")) { b.tdsAdded[key] = Object.assign({}, b.tdsAdded[key], { code: e.want.code }); }
        if (fields.some((f) => f.k === "pan")) TDSEdit.set(r, "pan", e.want.pan);
      } else fields.forEach((f) => {
        if (f.k === "challan") return;
        const v = f.k === "rate" ? R2(e.want.rate * 10000) / 10000 : f.k === "paid" || f.k === "tds" ? e.want[f.k] : f.k === "date" || f.k === "credit" ? e.want[f.k] : f.k === "party" ? e.want.party : e.want[f.k];
        TDSEdit.set(r, f.k, v);
      });
      if (fields.some((f) => f.k === "challan") || pv.deductions.back.includes(e)) sets.push([r.id, e.want.ch]);
    });
    // added: a FinCom deduction each (TDSAdd), then its challan
    pv.deductions.add.forEach((a) => {
      const w = a.want, x0 = { party: w.party, section: form === "27EQ" ? "206C" : w.section, date: w.date, credit: w.credit !== w.date ? w.credit : "", paid: w.paid, rate: R2(w.rate * 10000) / 10000, tds: w.tds, cert: w.cert, basis: w.basis, rateWhy: "added in the Excel brought back" };
      const res = TDSAdd.save(x0);
      if (!res.ok) return no("Deductions", a.row, w.party + ": " + res.why);
      if (form === "27EQ" && w.code) b.tdsAdded[res.key] = Object.assign({}, b.tdsAdded[res.key], { code: w.code });
      if (w.ch && (w.ch.id || w.ch.add)) sets.push([res.id, w.ch]);
      a.id = res.id;
    });
    TDSReg.forget(); rBy = rowsNow();
    // the deductee's type (01 a company, else 02) on each of its deductions in the return
    dees.forEach((d) => { const ft = d.fields.find((f) => f.k === "type"); if (!ft) return; const code = ft.to === "Company" ? "01" : "02"; Object.values(rBy).filter((r) => normName(r.party || r.employee || "") === normName(d.party)).forEach((r) => TDSEdit.set(r, "dcode", code)); });
    pv.deductions.add.forEach((a) => { if (!a.id || !a.want.type) return; const r = rBy[a.id], code = a.want.type === "Company" ? "01" : "02"; if (r && code !== TDSEdit.codeOf(r.pan)) TDSEdit.set(r, "dcode", code); });
    TDSReg.forget();
    // which challan pays which: those that move or come off first, then each challan's own (TDSCH: never over its balance)
    const target = sets.map(([id, ch]) => [id, ch.add ? made[ch.add.lab] || "" : ch.id || ""]);
    const off = target.filter(([id, to]) => b.alloc && b.alloc[id] && b.alloc[id] !== to).map(([id]) => id);
    if (off.length) { const u = TDSCH.untag(off, { nosave: true }); if (!u.ok) no("Deductions", "", u.why); }
    TDSReg.forget();
    const byCh = {}; target.filter(([, to]) => to).forEach(([id, to]) => { (byCh[to] = byCh[to] || []).push(id); });
    Object.keys(byCh).forEach((chId) => { const t = TDSCH.tag(byCh[chId], chId, { nosave: true, note: "the Excel brought back" }); if (!t.ok) no("Deductions", "", t.why); });
    TDSReg.forget();
    // interest, fee and others allocated to this return; a challan taken off the sheet gives back what it gave this return
    pv.challans.alloc.concat(pv.challans.add.filter((a) => a.al && (a.al.ia || a.al.fa || a.al.oa) && made[a.lab]).map((a) => ({ row: a.row, c: { id: made[a.lab] }, to: a.al }))).forEach((x) => {
      const r = TDSReg.setPortion(x.c.id, form, fy, q, x.to.ia, x.to.fa, { nosave: true }, x.to.oa); if (!r.ok) no("Challans", x.row, r.why);
    });
    const k = TDSReg.key(form, fy, q);
    pv.challans.out.forEach((o) => { const p = TDSReg.portions(o.c); if (p && p[k]) { b.chPortions = Object.assign({}, b.chPortions); const m2 = Object.assign({}, b.chPortions[o.c.id]); delete m2[k]; b.chPortions[o.c.id] = m2; TDSReg.log({ act: "portion", ch: o.c, form, fy, q, note: "interest and fee given back: challan taken off the Excel" }); } });
    // the employees' declarations (24Q Q4)
    pv.salary.edit.forEach((s) => s.fields.forEach((f) => { Payroll.setDetail(s.e, f.k, f.k === "regime" ? f.to : /^(senior|hraMetro|parentsSenior)$/.test(f.k) ? f.to : f.to); }));
    TDSReg.forget(); if (b.panIndex) b.panIndex = null;
    return { why };
  },
  // the plan with what it would do: the changes made in memory, checked as Validate & file checks them, then put back
  preview(form, fy, q, x, validate) {
    const pv = this.plan(form, fy, q, x);
    pv.before = this.summary(form, fy, q);
    if (pv.fatal) return pv;
    const sb = typeof G.saveBooks === "function" ? G.saveBooks : null, s0 = this.snap();
    let v0 = null, v1 = null;
    try { v0 = validate ? validate(fy, q, form) : null; } catch (e) { v0 = null; }
    try {
      if (sb) G.saveBooks = () => Promise.resolve();
      const r = this.run(pv);
      r.why.forEach((w) => { if (!pv.errors.some((e) => e.words === w.words)) pv.errors.push(w); });
      pv.after = this.summary(form, fy, q);
      // the remark FinCom will write, against the Excel's
      const rows = this.rows(form, fy, q), rk = {}; rows.forEach((z) => { rk[z.id] = z; });
      pv.deductions.edit.concat(pv.deductions.add).forEach((e) => { const z = rk[e.r ? e.r.id : e.id]; if (!z || !e.want) return; const got = this.remarkOf(z, form); if (e.want.rm !== got && e.want.rm) pv.warnings.push({ sheet: "Deductions", row: e.row, words: (z.party || "") + ": the Excel says remark " + e.want.rm + ", FinCom will write " + (got || "none") }); });
      try { v1 = validate ? validate(fy, q, form) : null; } catch (e) { v1 = null; }
    } catch (e) { pv.errors.push({ sheet: "", row: "", words: "Could not try the changes: " + ((e && e.message) || e) }); }
    finally { this.restore(s0); if (sb) G.saveBooks = sb; }
    // what Validate & file says after that it did not say before: an error blocks Apply, a warning needs a tick
    if (v1) {
      const was = (l, it) => (l || []).find((z) => z.k === it.k);
      v1.errors.forEach((it) => { const w = was(v0 && v0.errors, it); if (!w || (it.n || 0) > (w.n || 0)) pv.errors.push({ sheet: "Validate & file", row: "", words: it.words, val: it.k }); });
      v1.warnings.forEach((it) => { const w = was(v0 && v0.warnings, it); if (!w || (it.n || 0) > (w.n || 0)) pv.warnings.push({ sheet: "Validate & file", row: "", words: it.words, val: it.k }); });
      pv.valBefore = v0 ? { errors: v0.errors.length, warnings: v0.warnings.length } : null; pv.valAfter = { errors: v1.errors.length, warnings: v1.warnings.length };
    }
    pv.n = this.count(pv);
    return pv;
  },
  // Apply: refused with an error or a warning not ticked. Kept: every change, and what each store held before (one Undo)
  apply(pv, ticked) {
    if (pv.fatal) return { ok: false, why: pv.fatal };
    if (pv.errors.length) return { ok: false, why: pv.errors.length + " error" + (pv.errors.length === 1 ? "" : "s") + " to fix in the Excel first" };
    if (pv.warnings.length && !ticked) return { ok: false, why: "Tick that the warnings were looked at" };
    const b = S.books, s0 = this.snap(), sb = G.saveBooks;
    G.saveBooks = () => Promise.resolve();
    let r;
    try { r = this.run(pv); } finally { G.saveBooks = sb; }
    if (r.why.length) { this.restore(s0); return { ok: false, why: r.why.map((w) => w.words).join("; ") }; }
    // the record for Undo: each store's keys (or each challan / employee item) as they were
    const undo = {};
    KEEP.forEach((k) => {
      const a = s0[k], z = b[k];
      if (JSON.stringify(a) === JSON.stringify(z)) return;
      if (ARR[k]) { const byA = {}; (a || []).forEach((it) => { byA[it.id] = it; }); const ch = {}; (z || []).forEach((it) => { const o = byA[it.id]; if (JSON.stringify(o) !== JSON.stringify(it)) ch[it.id] = o === undefined ? null : o; }); undo[k] = ch; }
      else { const ch = {}; new Set(Object.keys(a || {}).concat(Object.keys(z || {}))).forEach((kk) => { if (JSON.stringify((a || {})[kk]) !== JSON.stringify((z || {})[kk])) ch[kk] = (a || {})[kk] === undefined ? null : (a || {})[kk]; }); undo[k] = ch; }
    });
    const co = CO() || {}, coWas = JSON.stringify(s0.__co) !== JSON.stringify({ tds26q: co.tds26q, tan: co.tan }) ? s0.__co : null;
    const K = this.key(pv.form, pv.fy, pv.q), prev = (b.matchNo || {})[K] || {}, ver = (prev.ver || 0) + 1, n = this.count(pv);
    b.matchNo = Object.assign({}, b.matchNo || {}, { [K]: { ver, at: new Date().toISOString(), by: who(), name: pv.name || "", n, undo, co: coWas, hist: (prev.hist || []).concat([{ ver, at: new Date().toISOString(), by: who(), name: pv.name || "", n }]).slice(-20) } });
    TDSReg.log({ act: "correction", form: pv.form, fy: pv.fy, q: pv.q, note: "Excel brought back (version " + ver + "): " + n + " change" + (n === 1 ? "" : "s") + (pv.name ? " from " + pv.name : "") });
    if (coWas) try { Store.saveCompany(co); } catch (e) { /* */ }
    TDSReg.forget(); TDSReg.done(); saveBooks();
    return { ok: true, n, ver };
  },
  last(form, fy, q) { const r = ((S.books || {}).matchNo || {})[this.key(form, fy, q)]; return r && r.undo ? r : null; },
  // Undo of the last upload: each store as it was before it; a challan or deduction the upload added is marked deleted (kept)
  undo(form, fy, q) {
    const b = S.books, rec = this.last(form, fy, q);
    if (!b || !rec) return { ok: false, why: "No upload of this return to undo." };
    if (TDSReg.locked(fy, q, form)) return { ok: false, why: TDSReg.lockWords(fy, q, form) };
    const at = new Date().toISOString(), by = who(), allocWas = Object.assign({}, b.alloc || {});
    Object.keys(rec.undo).forEach((k) => {
      const ch = rec.undo[k];
      if (ARR[k]) { const list = (b[k] || []).slice(); Object.keys(ch).forEach((id) => { const i = list.findIndex((it) => it.id === id); if (ch[id] === null) { if (i >= 0) { if (k === "challans") list[i] = Object.assign({}, list[i], { deleted: { at, by, reason: "undo of the Excel brought back" } }); else list.splice(i, 1); } } else if (i >= 0) list[i] = ch[id]; else list.push(ch[id]); }); b[k] = list; }
      else { const o = Object.assign({}, b[k] || {}); Object.keys(ch).forEach((kk) => { if (ch[kk] === null) { if (k === "tdsAdded" && o[kk]) o[kk] = Object.assign({}, o[kk], { deleted: { by, at, reason: "undo of the Excel brought back" } }); else delete o[kk]; } else o[kk] = ch[kk]; }); b[k] = o; }
    });
    if (rec.co) { const co = CO() || {}; co.tds26q = rec.co.tds26q; co.tan = rec.co.tan; try { Store.saveCompany(co); } catch (e) { /* */ } }
    // the trail: each allocation put back, said so
    const now = b.alloc || {}, chOf = (id) => TDS.challans().find((c) => c.id === id) || null;
    new Set(Object.keys(allocWas).concat(Object.keys(now))).forEach((id) => { if (allocWas[id] === now[id]) return; if (allocWas[id]) TDSReg.log({ act: "untag", ch: chOf(allocWas[id]), form, fy, q, row: id, note: "undo: Excel brought back version " + rec.ver }); if (now[id]) TDSReg.log({ act: "tag", ch: chOf(now[id]), form, fy, q, row: id, note: "undo: Excel brought back version " + rec.ver }); });
    const K = this.key(form, fy, q), m = Object.assign({}, b.matchNo || {}); m[K] = { ver: rec.ver, hist: (rec.hist || []).concat([{ ver: rec.ver, at, by, undone: true }]).slice(-20) }; b.matchNo = m;
    TDSReg.log({ act: "correction", form, fy, q, note: "undo of the Excel brought back (version " + rec.ver + ")" });
    b.panIndex = null; TDSReg.forget(); TDSReg.done(); saveBooks();
    return { ok: true, ver: rec.ver };
  },
  // put back a deduction taken out (Validate & file's note)
  putBack(id) { const b = S.books, e = (b && b.tdsEdits || {})[id]; if (!e || !e.f || !e.f.out) return { ok: false, why: "Not taken out." }; delete e.f.out; e.log.push({ field: "out", from: "taken out", to: "put back", by: who(), at: new Date().toISOString() }); TDSReg.forget(); saveBooks(); return { ok: true }; },
};
G.TDSX = TDSX;
export default TDSX;
