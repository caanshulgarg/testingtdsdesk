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
  // next-fix-challan-over (the owner, 24-Oct-2026: a challan of ₹2,567 with ₹291.22 left took a hand-added ₹2,500, "Balance
  // ₹-2,208.78"): putting a deduction on a challan never takes what all returns use of it past its tax by more than ₹1
  // (TDSReg rule 2). "" when a deduction's TDS (tds) fits on challan chId, else the words. selfId: the deduction itself,
  // when it is on that challan already (its own TDS is counted as room). The guard of the one placing that does not go
  // through TDSCH.tag (save, below). A deduction's TDS corrected while it stays on its challan is a correction, not a
  // placing: kept, and a challan then over its tax is Validate & file's error and the Deductions footer's red line
  room(chId, tds, selfId){
    if (!chId || typeof TDSReg !== "object") return "";
    const c = TDS.challans().find(z => z.id === chId); if (!c) return "";
    const cx = TDSReg.ctx(), me = selfId && cx.byRow[selfId], own = me && me.r.challan === chId ? r2(num(me.r.tds)) : 0, t = r2(num(tds));
    const left = r2(TDSReg.balance(c, cx).tax + own);
    if (t <= own + 0.005 || t <= left + 1) return "";
    return "Challan " + (c.serial || TDSCH.label(c)) + (left > 0.005 ? " has " + money(left) + " left" : " has nothing left" + (left < -0.005 ? " (it is over-used by " + money(-left) + ")" : "")) + "; this deduction's TDS is " + money(t) + ". Choose another challan or add one.";
  },
  // add (no key) or change one; {ok, why, id}. Refused on a return marked filed (open a correction first), and when put
  // on a challan it does not fit (room)
  save(x, key){
    const why = this.problem(x); if (why) return {ok: false, why};
    const d = TDS.ymd(x.date), fy = TDS.fyOf(d), q = TDS.qOf(d), sec = TDS.sec(x.section), form = TDS.NR.test(sec) ? "27Q" : "26Q";
    if (typeof TDSReg === "object" && TDSReg.locked(fy, q, form)) return {ok: false, why: TDSReg.lockWords(fy, q, form)};
    // put on a challan (a new one, or another than it is on): it must fit
    const over = x.challan && (!key || ((S.books || {}).alloc || {})["fc:" + key] !== x.challan) ? this.room(x.challan, x.tds, key ? "fc:" + key : "") : "";
    if (over) return {ok: false, over: true, why: over};
    const b = S.books; b.tdsAdded = Object.assign({}, b.tdsAdded || {});
    const k = key || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), was = b.tdsAdded[k], who = typeof TDSReg === "object" ? TDSReg.who() : "", at = new Date().toISOString();
    const rec = {party: String(x.party).trim(), section: x.section, date: d, credit: x.credit ? TDS.ymd(x.credit) : "", paid: r2(num(x.paid)), tds: r2(num(x.tds)),
      rate: x.rate === "" || x.rate == null ? "" : num(x.rate), rateWhy: x.rateWhy || "", cert: x.cert || "", basis: x.basis || "", fromVoucher: x.fromVoucher || "",
      by: was ? was.by : who, at: was ? was.at : at, log: (was ? was.log || [] : []).concat([{act: was ? "edit" : "add", by: who, at}])};
    b.tdsAdded[k] = rec;
    if (x.challan && (b.alloc || {})["fc:" + k] !== x.challan){
      (b.alloc = Object.assign({}, b.alloc || {}))["fc:" + k] = x.challan;
      // the placing in the allocation trail too (it was not: the owner's challan showed no trail of it)
      if (typeof TDSReg === "object" && TDSReg.log) TDSReg.log({act: "tag", ch: TDS.challans().find(c => c.id === x.challan), form, fy, q, row: "fc:" + k, tax: rec.tds, note: "added in FinCom on this challan"});
    }
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
