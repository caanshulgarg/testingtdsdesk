/* @react-lazy: begin 88-tds-added.js (the React app loads this file with its TDS screens: app/src/lib/tdsGlobals.js; build.py react_parts) */
/* ================================================================== */
/* Deductions entered in FinCom (next-tds-clear, the owner, 19-Oct-   */
/* 2026: "How would anyone add a deduction — go to Tally or Excel?")  */
/* ================================================================== */
// A deduction typed on a return's Deductions step (or a challan's panel), never written to Tally: S.books.tdsAdded
// (one of BOOKS_KEYS, so it is kept with the books and shared through client_books) = {key: {party, section, date
// (of deduction), credit (paid or credited), paid, rate, tds, cert, basis, rateWhy, by, at, log: [...], deleted?:
// {by, at, reason}}}. TDS.allRowsNow (src/js/09) adds each one not deleted as a deduction row "fc:<key>" (src "fincom"),
// so the return, its challans, its checks and both file builders (TDS26Q.build, the Act of 2025's forms) read it like a
// deduction from the books. Its PAN is the client's PAN book's (TDS.panOf). A deduction from Tally is corrected with
// TDSEdit (app/src/lib/tdsEdit.js), never here.
const TDSAdd = {
  all(){ return ((S.books || {}).tdsAdded) || {}; },
  // the rows, into TDS.allRowsNow's list
  addTo(out, b){
    const A = (b || S.books || {}).tdsAdded || {}, alloc = (b || S.books || {}).alloc || {};
    Object.keys(A).forEach(k => {
      const x = A[k]; if (!x || x.deleted) return;
      const id = "fc:" + k, d = TDS.ymd(x.date);
      out.push({id, date: d, credit: TDS.ymd(x.credit || x.date) !== d ? TDS.ymd(x.credit) : undefined, q: TDS.qOf(d), fy: TDS.fyOf(d), party: x.party, pan: TDS.panOf(x.party),
        section: x.section, ledger: "", paid: r2(num(x.paid)), tds: r2(num(x.tds)), rate: x.rate === "" || x.rate == null ? (num(x.paid) ? r2(num(x.tds) / num(x.paid) * 100) : null) : num(x.rate),
        rateFrom: "fincom", voucher: "", type: "Added in FinCom", src: "fincom", added: true, addedBy: x.by || "", addedAt: x.at || "", challan: alloc[id] || "",
        ...(x.cert ? {cert: x.cert} : {}), ...(x.basis ? {basis: x.basis} : {})});
    });
    return out;
  },
  // what is wrong with a deduction typed in, in words ("" when it can be kept)
  problem(x){
    if (!String(x.party || "").trim()) return "Give the deductee.";
    if (!String(x.section || "").trim() || !TDS.sec(x.section)) return "Choose the section.";
    if (TDS.ymd(x.date).length !== 8) return "Give the date of deduction.";
    if (x.credit && TDS.ymd(x.credit).length !== 8) return "The date paid or credited is not a date.";
    if (!(num(x.paid) > 0)) return "Give the amount paid or credited.";
    if (num(x.tds) < 0 || num(x.tds) > num(x.paid)) return "The TDS is more than the amount paid, or below nil.";
    return "";
  },
  // add (no key) or change one; {ok, why, id}. Refused on a return marked filed (open a correction first)
  save(x, key){
    const why = this.problem(x); if (why) return {ok: false, why};
    const d = TDS.ymd(x.date), fy = TDS.fyOf(d), q = TDS.qOf(d), sec = TDS.sec(x.section), form = TDS.NR.test(sec) ? "27Q" : "26Q";
    if (typeof TDSReg === "object" && TDSReg.locked(fy, q, form)) return {ok: false, why: TDSReg.lockWords(fy, q, form)};
    const b = S.books; b.tdsAdded = Object.assign({}, b.tdsAdded || {});
    const k = key || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), was = b.tdsAdded[k], who = typeof TDSReg === "object" ? TDSReg.who() : "", at = new Date().toISOString();
    const rec = {party: String(x.party).trim(), section: x.section, date: d, credit: x.credit ? TDS.ymd(x.credit) : "", paid: r2(num(x.paid)), tds: r2(num(x.tds)),
      rate: x.rate === "" || x.rate == null ? "" : num(x.rate), rateWhy: x.rateWhy || "", cert: x.cert || "", basis: x.basis || "",
      by: was ? was.by : who, at: was ? was.at : at, log: (was ? was.log || [] : []).concat([{act: was ? "edit" : "add", by: who, at}])};
    b.tdsAdded[k] = rec;
    if (x.challan) (b.alloc = Object.assign({}, b.alloc || {}))["fc:" + k] = x.challan;
    if (typeof TDSReg === "object"){ TDSReg.log({act: was ? "edit deduction" : "add deduction", form, fy, q, note: rec.party + " · " + sec + " · TDS " + rec.tds}); TDSReg.forget(); TDSReg.done(); }
    saveBooks();
    return {ok: true, id: "fc:" + k, key: k};
  },
  // taken out, with the reason (kept, marked deleted: the trail stays)
  remove(key, reason){
    const b = S.books, x = (b.tdsAdded || {})[key];
    if (!x) return {ok: false, why: "No such deduction."};
    if (!String(reason || "").trim()) return {ok: false, why: "Say why it is taken out."};
    const d = TDS.ymd(x.date), form = TDS.NR.test(TDS.sec(x.section)) ? "27Q" : "26Q";
    if (typeof TDSReg === "object" && TDSReg.locked(TDS.fyOf(d), TDS.qOf(d), form)) return {ok: false, why: TDSReg.lockWords(TDS.fyOf(d), TDS.qOf(d), form)};
    b.tdsAdded = Object.assign({}, b.tdsAdded, {[key]: Object.assign({}, x, {deleted: {by: typeof TDSReg === "object" ? TDSReg.who() : "", at: new Date().toISOString(), reason: String(reason).trim()}})});
    if (b.alloc && b.alloc["fc:" + key]){ b.alloc = Object.assign({}, b.alloc); delete b.alloc["fc:" + key]; }
    if (typeof TDSReg === "object"){ TDSReg.log({act: "delete deduction", note: x.party + ": " + reason}); TDSReg.forget(); TDSReg.done(); }
    saveBooks();
    return {ok: true};
  },
  // the deductee's last section and its certificate, for the form's defaults
  lastSection(party){ const r = TDS.allRows().filter(x => normName(x.party) === normName(party) && x.section).pop(); return r ? r.section : ""; },
};
if (typeof globalThis === "object") Object.assign(globalThis, {TDSAdd});
/* @react-lazy: end */
