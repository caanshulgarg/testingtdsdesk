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
  // next-tds-validate-short (Leads Insurance, Form 140 Q1 2026-27, 25-Oct-2026): 39 deductions typed in FinCom on 23-24 Oct
  // were already in the books (the same day, section and TDS, the deductee's name a little different: "Garg Shekhar & Co."
  // in Tally, "Garg Shekhar & Company" typed), so the return carried each twice. A possible duplicate: a deduction added in
  // FinCom (not from an entry: fromVoucher) and another of the same return, the same date of deduction (a books row: within a
  // month) and section, the same TDS within ₹1 (or the books' own TDS, where it was corrected in FinCom), the same deductee (its PAN, or the name alike:
  // nameSim 0.8). Each row in one pair at most; the nearest date first, then a books row. [{a (added), b (the other), why}]
  dups(form, fy, q){
    const rows = TDS.formRows(form).filter(r => r.fy === fy && r.q === q && num(r.tds) > 0.005 && !r.splitOf), A = this.all(), used = new Set(), out = [];
    const tdsOf = (r) => [num(r.tds)].concat(r.books && r.books.tds != null ? [num(r.books.tds)] : []);
    const days = (a, b) => { const t = (r) => { const d = TDS.ymd(r.date); return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)); }; return Math.abs(t(a) - t(b)) / 864e5; };
    // (the date typed may be the bill's: Simson's ₹2,733 typed for 21-Apr, in the books on 22-May) a books row within a month
    const same = (a, b) => TDS.sec(a.section) === TDS.sec(b.section) && (days(a, b) === 0 || (!b.added && days(a, b) <= 31)) && tdsOf(a).some(x => tdsOf(b).some(y => Math.abs(x - y) <= 1)) &&
      ((Certs.validPan(a.pan) && a.pan === b.pan) || nameSim(a.party || "", b.party || "") >= 0.8);
    rows.filter(r => r.added && !(A[String(r.id).slice(3)] || {}).fromVoucher).forEach(a => {
      if (used.has(a.id)) return;
      const c = rows.filter(b => b.id !== a.id && !used.has(b.id) && same(a, b)).sort((x, y) => days(a, x) - days(a, y) || (x.added ? 1 : 0) - (y.added ? 1 : 0))[0];
      if (!c) return;
      used.add(a.id); used.add(c.id);
      const dd = days(a, c);
      out.push({a, b: c, why: (dd ? "dates " + dd + " day" + (dd === 1 ? "" : "s") + " apart, the same section and TDS" : "the same date, section and TDS") + (c.added ? ", both added in FinCom" : ", one from the books, one added in FinCom")});
    });
    return out;
  },
  // "Keep this one" (keepId; form: the return's): the other (dropId) of a possible duplicate taken out of the return (kept: TDSEdit's out, Put back on Validate &
  // file), its challan kept for Put back. {ok, why}
  keepOne(form, keepId, dropId){
    const all = TDS.formRows(form), keep = all.find(r => r.id === keepId), r = all.find(x => x.id === dropId);
    if (!r || !keep) return {ok: false, why: "That deduction is not in the return any more."};
    if (typeof TDSReg === "object" && TDSReg.locked(r.fy, r.q, form)) return {ok: false, why: TDSReg.lockWords(r.fy, r.q, form)};
    const b = S.books, who = typeof TDSReg === "object" ? TDSReg.who() : "", at = new Date().toISOString();
    b.tdsEdits = Object.assign({}, b.tdsEdits || {});
    const e = b.tdsEdits[r.id] = Object.assign({f: {}, log: []}, b.tdsEdits[r.id] || {});
    e.f = Object.assign({}, e.f, {out: {by: who, at, dup: keepId, reason: "possible duplicate of " + (keep.added ? "the one added in FinCom" : (keep.type || "the entry") + (keep.voucher ? " " + keep.voucher : "")) + " (kept)", form, fy: r.fy, q: r.q, party: r.party || "", tds: r2(num(r.tds))}});
    e.log = (e.log || []).concat([{field: "out", from: "", to: "taken out", by: who, at}]);
    if (typeof TDSReg === "object"){ TDSReg.log({act: "keep one", note: (r.party || "") + " " + r2(num(r.tds)) + ": possible duplicate taken out"}); TDSReg.forget(); TDSReg.done(); }
    saveBooks();
    return {ok: true};
  },
  // the deductee's last section and its certificate, for the form's defaults
  lastSection(party){ const r = TDS.allRows().filter(x => normName(x.party) === normName(party) && x.section).pop(); return r ? r.section : ""; },
};
if (typeof globalThis === "object") Object.assign(globalThis, {TDSAdd});
/* @react-lazy: end */
