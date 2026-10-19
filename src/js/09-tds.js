/* ================================================================== */
/* TDS: deductions from the books, challans, and what is paid by what */
/* ================================================================== */
const TDS = {
  // the usual rates, tax year 2026-27 (tax-accuracy: 194H 2%, 194D 2% for others than companies, 194-IB 2%, 194-O 0.1%
  // since the Finance (No. 2) Act, 2024; 194T from April 2025); non-resident rates with and without the 4% cess
  STD: {"192B": [], "193": [10], "194": [10], "194A": [10], "194B": [30], "194BB": [30], "194C": [1, 2], "194D": [2, 10], "194DA": [2], "194G": [2], "194H": [2],
    "194I": [2, 10], "194IA": [1], "194IB": [2], "194IC": [10], "194J": [2, 10], "194K": [10], "194LA": [10], "194M": [2], "194N": [2, 5], "194O": [0.1], "194Q": [0.1],
    "194R": [10], "194S": [1], "194T": [10], "195": [20, 20.8, 10, 10.4, 15, 15.6, 30, 31.2], "206C": [0.1, 1, 2, 5]},
  // the form a quarter's return is filed on: up to tax year 2025-26 the old forms (late returns and corrections too); from
  // 1 April 2026, under the Income-tax Act, 2025, Form 138 (was 24Q), 140 (was 26Q), 144 (was 27Q) and 143 (was 27EQ);
  // Form 130 replaces Form 16. kind is the old name, which FinCom keeps as the return's key
  NEW_FORM: {"24Q": "138", "26Q": "140", "27Q": "144", "27EQ": "143"},
  NEW_FROM: "2026-27",
  isNew(fy){ return String(fy || "") >= this.NEW_FROM; },
  formNo(kind, fy){ return this.isNew(fy) && this.NEW_FORM[kind] ? this.NEW_FORM[kind] : kind; },
  formName(kind, fy){ return this.isNew(fy) && this.NEW_FORM[kind] ? "Form " + this.NEW_FORM[kind] : kind; },
  formNameLong(kind, fy){ return this.isNew(fy) && this.NEW_FORM[kind] ? "Form " + this.NEW_FORM[kind] + " (was " + kind + ")" : kind; },
  certName(fy){ return this.isNew(fy) ? "Form 130" : "Form 16"; },
  // names only, for the return pages (redesign of 09-Oct-2026, app/src/screens/Books.jsx and TdsReturn.jsx): nothing here
  // is used by a figure or a file. From tax year 2026-27 a form is shown as the Income Tax Department's own PDFs head it,
  // "Form No. 140 (Earlier Form No. 26Q)": Form 140 (earlier 26Q); earlier years keep the old name alone
  FORM_ABOUT: {"24Q": "Salary", "26Q": "Non-salary, residents", "27Q": "Non-residents", "27EQ": "TCS"},
  formShort(kind, fy){ return this.isNew(fy) && this.NEW_FORM[kind] ? "Form " + this.NEW_FORM[kind] + " (earlier " + kind + ")" : kind; },
  formLabel(kind, fy){ return this.formShort(kind, fy) + " \u00b7 " + (this.FORM_ABOUT[kind] || ""); },
  // Protean's RPU and FVU 1.2 say "Tax Year" for the years of the Act of 2025
  yearWord(fy){ return this.isNew(fy) ? "Tax Year" : "Financial Year"; },
  // a section as the return pages show it: from tax year 2026-27 the new provision of section 393 with the old section
  // beside it, "393(1) Sl. 6(i) [old 194C]", taken only from the mapping FinCom already holds (RULE_DEFAULTS: ref and old);
  // a section that mapping does not cover is shown under its old number alone. Earlier years: the old number alone.
  secNew(section, fy){
    const old = String(section || ""), k = this.sec(old);
    if (!this.isNew(fy) || !k || typeof RULE_DEFAULTS === "undefined") return {old, ref: "", label: "", text: old};
    const hits = RULE_DEFAULTS.filter(r => r.old && r.ref && /^39/.test(r.ref) && this.sec(r.old) === k);
    if (!hits.length) return {old, ref: "", label: "", text: old};
    // one old section can be several entries of the table (194J: professional, technical, director): the part they share
    const refs = Array.from(new Set(hits.map(r => r.ref)));
    let ref = refs[0];
    refs.slice(1).forEach(x => { let i = 0; while (i < ref.length && ref[i] === x[i]) i++; ref = ref.slice(0, i); });
    if (refs.length > 1) ref = ref.slice(0, ref.lastIndexOf(")") + 1);
    const label = Array.from(new Set(hits.map(r => r.label))).slice(0, 3).join(" / ");
    return {old, ref, label, text: ref + " [old " + old + "]"};
  },
  // a section's plain name (t70, the owner: "section name is not there"): the words of the table FinCom holds for it
  // (RULE_DEFAULTS' label, found by the old section), for any year; "" for a section it does not cover
  secName(section){ return this.secNew(section, "2026-27").label || ""; },
  // what a section can be found by in a search: its old number and, from 2026-27, its new provision and table entry
  secFind(section, fy){ const x = this.secNew(section, fy); return [x.old, x.ref, x.label].join(" "); },
  // TCS rates by date (old section 206C; section 394 of the Act of 2025 from 1 April 2026): [from, code, rate %]. The latest
  // row on or before the collection's date applies. The codes are the official ones of Form 27EQ (tds-layout, the TDS review
  // of 14-Oct-2026, H3: they were shifted by one from 6CB to 6CI): 6CA liquor, 6CB timber under a forest lease, 6CC timber
  // otherwise, 6CD other forest produce, 6CE scrap, 6CF parking lot, 6CG toll plaza, 6CH mining and quarrying, 6CI tendu
  // leaves, 6CJ coal, lignite or iron ore, 6CL motor vehicle, 6CO overseas tour package. From 1 April 2026 (Finance Act
  // 2026, review M5; OWNER TO CONFIRM against the enacted text): liquor, scrap, minerals and tendu leaves 2%, overseas tour
  // packages 2% flat
  TCS_RATES: [
    ["2016-06-01", "6CA", 1], ["2016-06-01", "6CB", 2.5], ["2016-06-01", "6CC", 2.5], ["2016-06-01", "6CD", 2.5], ["2016-06-01", "6CE", 1],
    ["2016-06-01", "6CF", 2], ["2016-06-01", "6CG", 2], ["2016-06-01", "6CH", 2], ["2016-06-01", "6CI", 5], ["2016-06-01", "6CJ", 1], ["2016-06-01", "6CL", 1],
    ["2020-10-01", "6CO", 5],
    ["2026-04-01", "6CA", 2], ["2026-04-01", "6CE", 2], ["2026-04-01", "6CI", 2], ["2026-04-01", "6CJ", 2], ["2026-04-01", "6CO", 2]
  ],
  tcsRate(code, date){
    const d = this.ymd(date), iso = d.length === 8 ? d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8) : "";
    let hit = null;
    this.TCS_RATES.forEach(([from, c, rate]) => { if (c === code && (!iso || from <= iso) && (!hit || from >= hit.from)) hit = {from, rate}; });
    return hit ? hit.rate : null;
  },
  // a deduction from a non-resident goes in 27Q, not 26Q
  NR: /^(195|194E|194LB|194LBA|194LC|194LD|196[A-D])/,
  sec(s){ return String(s || "").replace(/\s.*$/, "").replace(/-/g, "").toUpperCase(); },
  // what was paid or credited: from the ledger's own rate, else from the section's usual rates, else the voucher's expense
  baseFor(t, L, v){
    if (t.rate) return {paid: r2(t.amount / (t.rate / 100)), rate: t.rate, how: "ledger"};
    const cand = [];
    if (L.taxable) cand.push(L.taxable);
    v.ent.forEach(e => { const m = Books.ledgerOf(e.l); if (!m.kind && Math.abs(e.a) > 0) cand.push(Math.abs(e.a)); });
    const std = this.STD[this.sec(t.section)] || [];
    for (const rate of std){
      const want = r2(t.amount / (rate / 100));
      const hit = cand.find(c => Math.abs(c - want) <= Math.max(2, want * 0.005));
      if (hit) return {paid: r2(hit), rate, how: "section"};
      if (!cand.length) continue;
    }
    // round 43: 194Q is deducted only on the purchase value above 50 lakh in the year, so the bill is larger than what the
    // TDS was worked on: the amount the deduction is on (the TDS at 0.1%) is what is paid or credited for the return
    if (this.sec(t.section) === "194Q" && L.tds.length === 1){
      const want = r2(t.amount / 0.001);
      if (want > 0 && cand.some(c => c > want + 0.5)) return {paid: want, rate: 0.1, how: "section (above 50 lakh)"};
    }
    if (std.length && L.tds.length === 1 && !cand.some(c => std.some(rate => Math.abs(r2(t.amount / (rate / 100)) - c) <= 2))){
      // the expense does not fit any usual rate: show the rate the books imply
      const paid = L.taxable || 0;
      return {paid, rate: paid ? r2(t.amount / paid * 100) : null, how: "books"};
    }
    const paid = L.tds.length === 1 ? L.taxable : 0;
    return {paid, rate: paid ? r2(t.amount / paid * 100) : null, how: "books"};
  },
  // a deductee's PAN, in the order of truth (next-tds-clear, the owner, 19-Oct-2026: "keep the PAN and use it next time; no
  // PAN is asked twice, whether it came from Tally or was typed in FinCom"): Tally's ledger PAN when it is a PAN; else the
  // one saved in FinCom's PAN book for the client (b.panFix, shared with the books through client_books); else none (the
  // Deductees step asks). Where Tally later has a different PAN than FinCom's, Tally's is used and the Deductees step asks
  // which to keep (TDS.panConflict), unless the person already chose FinCom's for that very Tally PAN (rec.keep)
  panOf(party){ return party ? this.panPick(party, this.panTally(party)) : ""; },
  panTally(party){
    const b = S.books || {}, pans = b.pans || {};
    if (!party) return "";
    if (pans[party]) return pans[party];
    if (!b.panIndex || b.panIndexFor !== Object.keys(pans).length){
      b.panIndex = {}; b.panIndexFor = Object.keys(pans).length;
      Object.keys(pans).forEach(k => { b.panIndex[String(k).toUpperCase().replace(/[^A-Z0-9]/g, "")] = pans[k]; });
    }
    return b.panIndex[String(party).toUpperCase().replace(/[^A-Z0-9]/g, "")] || "";
  },
  // the PAN book's record of a party: by its name as in Tally, else the same name written differently, else a name it had
  // before (aliases, kept when a ledger is renamed)
  panRec(party){
    const fx = (S.books || {}).panFix || {};
    if (!party) return null;
    if (fx[party]) return fx[party];
    const k = String(party).toUpperCase().replace(/[^A-Z0-9]/g, ""), keys = Object.keys(fx);
    const hit = keys.find(x => String(x).toUpperCase().replace(/[^A-Z0-9]/g, "") === k) || keys.find(x => (fx[x].aliases || []).some(a => String(a).toUpperCase().replace(/[^A-Z0-9]/g, "") === k));
    return hit ? fx[hit] : null;
  },
  panPick(party, tally){
    const t = String(tally || "").toUpperCase().trim(), f = this.panRec(party), ok = /^[A-Z]{5}\d{4}[A-Z]$/.test(t);
    if (f && f.pan && (!ok || t === f.pan || f.keep === t || (f.keep == null && f.was === t))) return f.pan;
    return t;
  },
  // Tally and FinCom's PAN book disagree on a party, and no one has chosen: {tally, fincom}, else null
  panConflict(party, tally){
    const t = String(tally == null ? this.panTally(party) : tally).toUpperCase().trim(), f = this.panRec(party);
    if (!f || !f.pan || !/^[A-Z]{5}\d{4}[A-Z]$/.test(t) || t === f.pan || f.keep === t || (f.keep == null && f.was === t)) return null;
    return {tally: t, fincom: f.pan};
  },
  ymd(d){ const t = String(d || "").replace(/[^0-9]/g, ""); return t.length >= 6 ? t : ""; },
  qOf(d){ const m = num(this.ymd(d).slice(4, 6)); return m >= 4 && m <= 6 ? "Q1" : m >= 7 && m <= 9 ? "Q2" : m >= 10 && m <= 12 ? "Q3" : "Q4"; },
  fyOf(d){ const t = this.ymd(d), y = num(t.slice(0, 4)), m = num(t.slice(4, 6)); return (m >= 4 ? y : y - 1) + "-" + String((m >= 4 ? y + 1 : y)).slice(2); },
  // review M1 of 2.4.0 part 2 (08-Oct-2026): a TDS line of Tally's entry (tally_tds_details_marked, migration 62) in words:
  // the rate and, where it is not Tally's own, why: worked out by FinCom where Tally stored 0 (the owner's decision of
  // 07-Oct-2026, option A), or none worked out where Tally marked the line exempt (review L2). Tally's own rate: the rate alone
  tallyRateWords(l){
    const has = l && l.rate != null && l.rate !== "", pct = (has ? r2(num(l.rate)) : 0) + "%";
    if (l && l.exempt) return pct + " \u00b7 exempt in Tally: no rate worked out";
    if (l && l.rate_worked_out) return pct + " \u00b7 rate worked out: Tally stored 0 (TDS \u00f7 assessable amount)";
    return has ? pct : "";
  },
  // 26Q: every deduction from a resident other than salary, and other than those filed in a challan-cum-statement on the
  // portal (194-IA 26QB, 194-IB 26QC, 194M 26QD: RULE_DEFAULTS' form; the TDS review of 14-Oct-2026, M3)
  rows(){ return this.allRows().filter(r => !/^192/.test(String(r.section || "")) && !this.NR.test(this.sec(r.section)) && !this.portalForm(r.section)); },
  // the portal's own statement a section is filed in (26QB, 26QC, 26QD), "" for the returns FinCom makes
  portalForm(section){
    const s = this.sec(section);
    if (!this._portal){ this._portal = {}; (typeof RULE_DEFAULTS === "object" ? RULE_DEFAULTS : []).forEach(x => { if (x.form && x.old) this._portal[this.sec(x.old)] = x.form; }); }
    return this._portal[s] || "";
  },
  // those deductions, listed apart (To fix of 26Q: "file in 26QB / 26QC / 26QD on the portal")
  portalRows(){ return this.allRows().filter(r => this.portalForm(r.section)).map(r => Object.assign({}, r, {portalForm: this.portalForm(r.section)})); },
  // 27Q: deductions from non-residents
  nrRows(){ return this.allRows().filter(r => this.NR.test(this.sec(r.section))); },
  // 27EQ: tax collected at source on sales, one row per voucher and TCS ledger
  tcsRows(){ return typeof perRender === "function" ? perRender(this, "tcsRows", () => this.tcsRowsNow()) : this.tcsRowsNow(); },
  tcsRowsNow(){
    const b = S.books;
    if (!b || !b.vouchers) return [];
    const out = [];
    b.vouchers.forEach(v => {
      const L = Books.lines(v);
      if (!L.tcs || !L.tcs.length) return;
      const tcsAll = r2(L.tcs.reduce((a, t) => a + t.amount, 0));
      L.tcs.forEach(t => {
        // the amount received or debited to the buyer, without the TCS itself
        const recd = r2(L.tcs.length === 1 && L.party ? L.party - tcsAll : (t.rate ? t.amount / (t.rate / 100) : L.total));
        out.push({id: v.id + "|" + t.ledger, date: v.date, q: this.qOf(v.date), fy: this.fyOf(v.date), party: v.party, pan: TDS.panOf(v.party),
          section: t.section || "206C", code: TCS27EQ.codeOf(t.ledger, t.section), ledger: t.ledger, paid: recd, tds: r2(t.amount),
          rate: recd ? r2(t.amount / recd * 100) : null, voucher: v.no || v.ref || "", type: v.type, src: v.src === "bridge" ? "bridge" : "daybook", challan: (b.alloc || {})[v.id + "|" + t.ledger] || ""});
      });
    });
    return out.sort((a, c) => String(a.date).localeCompare(String(c.date)));
  },
  // salary TDS the books carry under section 192; 24Q takes the detail from the salary sheet
  // bridge 2.4.4: and Tally's payroll, one row per employee and payroll entry (Payroll.tdsRows, src/js/73), in place of the
  // books' own 192 row of that entry (the entry's total, which says neither whom nor how much)
  // next-challan-match: Form 138 / 24Q of a year from Tally's payroll where it has that year; else the salary sheet's rows of
  // the year (TDS24Q.dedRows: by employee, with stable ids); else the 192 the books carry (matched to challans too; the file
  // asks for the sheet or the payroll, as the books do not say whose TDS it is)
  salaryRows(){ return typeof perRender === "function" ? perRender(this, "salaryRows", () => this.salaryRowsNow()) : this.salaryRowsNow(); },
  salaryRowsNow(){
    const pay = typeof Payroll === "object" ? Payroll.tdsRows() : [], sheet = typeof TDS24Q === "object" && TDS24Q.dedRows ? TDS24Q.dedRows() : [];
    const books = this.allRows().filter(r => /^192/.test(String(r.section || "")));
    if (!pay.length && !sheet.length) return books;
    const payFy = new Set(pay.map(r => r.fy)), sheetFy = new Set(sheet.map(r => r.fy).filter(fy => !payFy.has(fy)));
    const covered = new Set(pay.map(r => r.id.slice(4, r.id.indexOf("|"))));
    return books.filter(r => !sheetFy.has(r.fy) && !covered.has(String(r.id).split("|")[0])).concat(pay, sheet.filter(r => sheetFy.has(r.fy)))
      .sort((a, c) => String(a.date).localeCompare(String(c.date)));
  },
  // the source of a year's Form 138 rows: "payroll", "sheet" or "books"
  salarySource(fy){
    if (typeof Payroll === "object" && Payroll.tdsRows().some(x => x.fy === fy)) return "payroll";
    if (typeof TDS24Q === "object" && TDS24Q.dedRows && TDS24Q.dedRows().some(x => x.fy === fy)) return "sheet";
    return "books";
  },
  // every voucher that carries a TDS ledger becomes one deduction row
  allRows(){ return typeof perRender === "function" ? perRender(this, "allRows", () => this.allRowsNow()) : this.allRowsNow(); },
  allRowsNow(){
    const b = S.books;
    if (!b || !b.vouchers) return [];
    const out = [];
    b.vouchers.forEach(v => {
      const L = Books.lines(v);
      if (!L.tds.length) return;
      // the owner, 19-Oct-2026: a TDS entry of its own (the party debited, a TDS ledger credited, no expense in it; a journal
      // often names no party in Tally): its deductee is the party debited (TDSSep.partyOf, src/js/66), and what it was
      // deducted on is the bill it is matched to below, not the entry's own lines (the party's debit read as the amount
      // paid made such a journal "₹1,000 paid, TDS ₹1,000 at 100%" with no deductee)
      const sp0 = typeof TDSSep === "object" ? TDSSep.partyOf(v) : "";
      L.tds.forEach(t => {
        const sp = sp0 && !/^192/.test(String(t.section || "")) ? sp0 : "", party = sp || v.party;
        let B = this.baseFor(t, L, v);
        if (sp && B.how !== "section") B = {paid: 0, rate: null, how: "books"};
        const paid = B.paid;
        out.push({
          id: v.id + "|" + t.ledger, date: v.date, q: this.qOf(v.date), fy: this.fyOf(v.date),
          party, pan: TDS.panOf(party), section: t.section, ledger: t.ledger, ...(sp ? {sep: true} : {}),
          paid: r2(paid), tds: r2(t.amount), rate: B.rate, rateFrom: B.how,
          voucher: v.no || v.ref || "", type: v.type, src: v.src === "bridge" ? "bridge" : "daybook", challan: (b.alloc || {})[v.id + "|" + t.ledger] || "",
          // what was paid for (professional or technical, rent of a building or of machinery): decides the rate within a
          // section (TDSRate, src/js/66)
          pay: typeof TDSRate === "object" ? TDSRate.payType(t, v) : ""
        });
      });
    });
    // the TDS review of 14-Oct-2026, M2: a TDS entry of its own after the bill (nothing paid or credited in it): the bill it
    // was deducted for (TDSInt.lateDeduct: the party's latest bill before it whose amount fits the section's rate) gives the
    // amount paid or credited and its date (credit); the date of deduction stays the TDS entry's
    // the owner, 19-Oct-2026: a TDS entry of its own is matched to the bills it was deducted on (TDSSep.link: the bill named,
    // else the TDS fitting a bill, else a month's bills together); the others as before
    if (typeof TDSSep === "object") TDSSep.link(out);
    if (typeof TDSInt === "object") out.forEach(r => {
      if (r.paid > 0 || !(r.tds > 0) || r.sep) return;
      const hit = TDSInt.lateDeduct(r);
      if (hit && hit.amount > 0){ r.paid = r2(hit.amount); r.credit = hit.date; r.bill = hit.voucher; r.rate = r2(r.tds / r.paid * 100); r.rateFrom = "bill"; }
    });
    // next-tds-clear: the deductions typed in FinCom (TDSAdd, src/js/88), beside the books' own
    if (typeof TDSAdd === "object" && b.tdsAdded) TDSAdd.addTo(out, b);
    // t70: what was corrected in FinCom (the corrected Excel brought back) over the books' deduction (app/src/lib/tdsEdit.js)
    if (typeof TDSEdit === "object" && b.tdsEdits) out.forEach(r => TDSEdit.apply(r));
    // next-challan-match: a deduction split across challans by a person is its parts, each on its challan (TDS.expandSplits)
    return (TDS.expandSplits(out)).sort((a, c) => String(a.date).localeCompare(String(c.date)));
  },
  // next-challan-match: a row with a split (S.books.tdsSplits, made on a return's Challans tab, TDSMatch.split in
  // src/js/86), as its parts: the tax as split; the amount paid in the same proportion, the last part the rest; the same
  // dates; each part "<row id>#n" on its own challan. A split whose parts no longer add up to the row is not used (the row
  // whole, splitStale). Here, in legacy.js, so every figure of every screen sees the parts (src/js/86 loads with the TDS
  // screens)
  expandSplits(rows){
    const sp = (S.books || {}).tdsSplits || {}, alloc = (S.books || {}).alloc || {};
    if (!Object.keys(sp).length) return rows;
    
    const out = [];
    rows.forEach(r => {
      const s = sp[r.id];
      if (!s || !(s.parts || []).length){ out.push(r); return; }
      const tot = s.parts.reduce((a, p) => a + TDSCH.p(p.tds), 0);
      if (tot !== TDSCH.p(r.tds)){ out.push(Object.assign(r, {splitStale: true})); return; }
      let paidLeft = TDSCH.p(r.paid);
      s.parts.forEach((p, i) => {
        const last = i === s.parts.length - 1, pp = last ? paidLeft : Math.round(TDSCH.p(r.paid) * TDSCH.p(p.tds) / tot);
        paidLeft -= pp;
        const id = r.id + "#" + (i + 1);
        out.push(Object.assign({}, r, {id, splitOf: r.id, part: i + 1, parts: s.parts.length, tds: TDSCH.p(p.tds) / 100, paid: pp / 100, challan: alloc[id] || ""}));
      });
    });
    return out;
  },
  // the TDS payment vouchers in the books: the challan's amount and date are already there
  paymentsFromBooks(){ return typeof perRender === "function" ? perRender(this, "pay", () => this.paymentsFromBooksNow()) : this.paymentsFromBooksNow(); },
  paymentsFromBooksNow(){
    const b = S.books;
    if (!b || !b.vouchers) return [];
    const out = [];
    b.vouchers.forEach(v => {
      const L = Books.lines(v);
      if (!L.tdsPaid.length) return;
      // bridge 2.4.3: where Tally marks what each line pays (TYPEOFTAXPAYMENT), the tax alone; interest and fee apart
      const sp = typeof TDSTally === "object" ? TDSTally.split(v) : null;
      const tax = sp ? sp.tax : r2(L.tdsPaid.reduce((a, t) => a + t.amount, 0));
      if (!tax && !(sp && (sp.interest || sp.fee || sp.others))) return;   // (review 243 N1) a payment of interest or fee alone is listed, its tax 0
      out.push({vid: v.id, date: v.date, tax, ...(sp ? {interest: sp.interest, fee: sp.fee, others: sp.others, fromTally: true} : {}), sections: Array.from(new Set(L.tdsPaid.map(t => t.section))), voucher: v.no || v.ref || "", narr: v.narr, src: v.src === "bridge" ? "bridge" : "daybook"});
    });
    return out.sort((a, c) => String(a.date).localeCompare(String(c.date)));
  },
  // the 7th of the next month, and 30 April for March
  dueDate(d){
    const t = this.ymd(d), y = num(t.slice(0, 4)), m = num(t.slice(4, 6));
    if (m === 3) return (y) + "0430";
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    return String(ny) + String(nm).padStart(2, "0") + "07";
  },
  monthsBetween(a, b){
    const A = this.ymd(a), B = this.ymd(b);
    if (!A || !B || B <= A) return 0;
    const ay = num(A.slice(0, 4)), am = num(A.slice(4, 6)), by = num(B.slice(0, 4)), bm = num(B.slice(4, 6));
    return (by - ay) * 12 + (bm - am) + 1;                       // part of a month counts as a month
  },
  // the rows of a return: 26Q, 27Q, 27EQ, or 24Q (salary TDS the books carry under 192)
  formRows(form){
    if (form === "24Q") return this.salaryRows();
    return typeof TDS_FORMS === "object" && TDS_FORMS[form] ? TDS_FORMS[form].rows() : this.rows();
  },
  // interest under section 201(1A), for each form (T-S3, 10-Oct-2026): 1% a month (or part of one) for deducting late, from
  // the bill to the TDS entry (TDSInt, src/js/66), and 1.5% a month for paying late, from the deduction to the challan when
  // the challan is after the due date. TCS (27EQ) is 1% a month under 206C(7). Each entry says which (kind "deduct" or "pay")
  // (the TDS review, L1) a deduction past its due date and still on no challan: 1.5% a month to date (asOf, else today),
  // kind "unpaid"
  interest(fy, q, form, asOf){
    form = form || "26Q";
    let today = this.ymd(asOf); if (!today) try { today = istToday(); } catch (e){ today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10).replace(/-/g, ""); }
    const ch = {}, pct = form === "27EQ" ? 1 : 1.5;
    this.challans().forEach(c => { ch[c.id] = c; });
    const out = [];
    this.formRows(form).filter(r => (!fy || r.fy === fy) && (!q || r.q === q)).forEach(r => {
      if (form !== "27EQ" && typeof TDSInt === "object"){
        const L = TDSInt.lateDeduct(r);
        if (L){ const amount = r2(r.tds * 0.01 * L.months); if (amount >= 1) out.push({kind: "deduct", rate: 1, row: r, from: L.date, bill: L.voucher, to: r.date, months: L.months, amount}); }
      }
      const c = ch[r.challan];
      if (!c){
        const due = this.dueDate(r.date);
        if (!(r.tds > 0) || !today || today <= this.ymd(due)) return;
        const months = this.monthsBetween(r.date, today), amount = r2(r.tds * pct / 100 * months);
        if (amount >= 1) out.push({kind: "unpaid", rate: pct, row: r, due, to: today, months, amount});
        return;
      }
      const due = this.dueDate(r.date);
      if (this.ymd(c.date) <= this.ymd(due)) return;
      const months = this.monthsBetween(r.date, c.date);
      const amount = r2(r.tds * pct / 100 * months);
      if (amount < 1) return;
      out.push({kind: "pay", rate: pct, row: r, challan: c, due, months, amount});
    });
    return out.sort((a, b) => b.amount - a.amount);
  },
  // the due date of a quarter's statement: 31 Jul, 31 Oct, 31 Jan, 31 May; TCS (27EQ) the 15th of those months up to 2025-26,
  // and from tax year 2026-27 (Form 143, Income-tax Rules 2026) the TDS calendar (the TDS review of 14-Oct-2026, H2; OWNER TO
  // CONFIRM the 2026 rule against the Gazette)
  returnDue(fy, q, form){
    const last = form === "27EQ" && !this.isNew(fy) ? {Q1: "0715", Q2: "1015", Q3: "0115", Q4: "0515"}[q] : {Q1: "0731", Q2: "1031", Q3: "0131", Q4: "0531"}[q];
    return String(num(fy.slice(0, 4)) + (q === "Q3" || q === "Q4" ? 1 : 0)) + last;
  },
  // the due date in words, as the pages say it ("31 Jul"): from returnDue, so the screen and the late fee agree
  dueWords(fy, q, form){ const d = this.returnDue(fy, q, form || "26Q"); return num(d.slice(6, 8)) + " " + MONTHS3[num(d.slice(4, 6)) - 1]; },
  // the fee for filing the statement late (234E): 200 a day, capped at the tax of the quarter; worked out to the date it was
  // filed, else to today. penaltyBy: a year after the due date; filed after it, a penalty of 10,000 to 1,00,000 can be
  // levied under 271H (and filed by it with the fee and interest paid, it is not)
  lateFee(fy, q, filedOn, form){
    form = form || "26Q";
    let tax = null;
    if (form === "24Q" && ((S.books || {}).salary || []).length && typeof TDS24Q === "object"){ const a = TDS24Q.annexI(fy, q); if (a.length) tax = r2(a.reduce((s, e) => s + num(e.tds), 0)); }
    if (tax == null){ const rows = this.formRows(form).filter(r => r.fy === fy && r.q === q); if (!rows.length) return null; tax = r2(rows.reduce((a, r) => a + r.tds, 0)); }
    const due = this.returnDue(fy, q, form);
    const filed = this.ymd(filedOn) || this.ymd(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10));
    const penaltyBy = String(num(due.slice(0, 4)) + 1) + due.slice(4);
    if (filed <= due) return {due, filed, days: 0, fee: 0, cap: tax, penaltyBy, p271h: false};
    const d1 = new Date(due.slice(0, 4) + "-" + due.slice(4, 6) + "-" + due.slice(6, 8));
    const d2 = new Date(filed.slice(0, 4) + "-" + filed.slice(4, 6) + "-" + filed.slice(6, 8));
    const days = Math.round((d2 - d1) / 86400000);
    return {due, filed, days, fee: Math.min(200 * days, tax), cap: tax, penaltyBy, p271h: filed > penaltyBy};
  },
  // tds-layout (14-Oct-2026): a challan deleted by hand is kept with its reason (c.deleted, TDSReg.deleteHand) and is in no list
  challans(){ return ((S.books || {}).challans || []).filter(c => !c.deleted).sort((a, b) => String(a.date).localeCompare(String(b.date))); },
  // a challan pays several deductions; what is left of it matters
  // (tds-challans, 10-Oct-2026: the salary TDS the books carry under 192 counts too, as it can now be tagged; untagged
  // before, so no figure moves)
  challanUse(){
    const rows = this.rows().concat(this.nrRows(), this.tcsRows(), this.salaryRows()), used = {};
    rows.forEach(r => { if (r.challan) used[r.challan] = r2((used[r.challan] || 0) + r.tds); });
    return used;
  },
  // put deductions against challans of the same quarter and section. TEST SET-UP ONLY: nothing in the app calls it (the
  // one matcher is TDSMatch, src/js/86, which only suggests; a person confirms). It stays as the tests' way to set up their
  // books (tdsgst_snapshot.py, e2e_tdsgst_app.js, run_tds_accuracy.py, pages_tds.py), whose files and figures were made
  // with it and must not move
  autoAllocate(){
    // tds-layout (14-Oct-2026): a return marked filed is locked (TDSReg, src/js/79): its deductions are left as they are
    const b = S.books, rows = this.rows().concat(this.nrRows(), this.tcsRows()).filter(r => !r.challan && !(typeof TDSReg === "object" && TDSReg.rowLocked(r.id))), use = this.challanUse();
    const ch = this.challans();
    b.alloc = b.alloc || {};
    let n = 0;
    rows.forEach(r => {
      const fit = ch.find(c => this.qOf(c.date) === r.q && this.fyOf(c.date) === r.fy &&
        (!c.section || c.section === r.section) && /^206C/.test(String(c.section || "")) === /^206C/.test(String(r.section || "")) &&
        r2(num(c.tax) - (use[c.id] || 0)) >= r.tds - 0.01);
      // a tag made here is the person's (bridge 2.4.3, review 243 T2): Tally's mark goes, but a deduction a person took off
      // Tally's challan keeps "off", so untagging it again still keeps it off
      if (fit){ b.alloc[r.id] = fit.id; if (b.allocFrom && b.allocFrom[r.id] === "tally") delete b.allocFrom[r.id]; use[fit.id] = r2((use[fit.id] || 0) + r.tds); n++; }
    });
    return n;
  },
  summary(fy, q, form){
    const rows = (typeof TDS_FORMS === "object" && TDS_FORMS[form] ? TDS_FORMS[form].rows() : this.rows()).filter(r => (!fy || r.fy === fy) && (!q || r.q === q));
    const bySec = {};
    rows.forEach(r => {
      const s = bySec[r.section] = bySec[r.section] || {section: r.section, count: 0, paid: 0, tds: 0, unallocated: 0, noPan: 0};
      s.count++; s.paid = r2(s.paid + r.paid); s.tds = r2(s.tds + r.tds);
      if (!r.challan) s.unallocated = r2(s.unallocated + r.tds);
      if (!r.pan) s.noPan++;
    });
    return Object.values(bySec).sort((a, b) => a.section.localeCompare(b.section));
  },
  // the working file: challan table and the deductee annexure under each challan, as in Form 26Q
  async toExcel(fy, q, form){
    await ensureXlsx();
    form = typeof TDS_FORMS === "object" && TDS_FORMS[form] ? form : "26Q";
    const rows = TDS_FORMS[form].rows().filter(r => (!fy || r.fy === fy) && (!q || r.q === q));
    // next-challan-match: the quarter's challans and any other this return uses (an earlier one's balance), with what
    // this return uses of each and the interest and fee allocated to it
    const usedHere = new Set(rows.map(r => r.challan).filter(Boolean));
    const ch = this.challans().filter(c => usedHere.has(c.id) || ((!fy || this.fyOf(c.date) === fy) && (!q || this.qOf(c.date) === q)));
    const use = this.challanUse(), part = (c) => typeof TDSReg === "object" && fy && q ? TDSReg.portionFor(c, form, fy, q) : {interest: 0, fee: 0};
    const d = s => s ? String(s).slice(6, 8) + "/" + String(s).slice(4, 6) + "/" + String(s).slice(0, 4) : "";
    const wb = XLSX.utils.book_new();
    const cs = [["Challans", "", "", "", "", "", ""], ["BSR code", "Challan serial", "Date deposited", "Tax", "Interest", "Total", "Allocated", "Left", "Used by this return", "Interest allocated here", "Fee allocated here"]]
      .concat(ch.map(c => [c.bsr, c.serial, d(c.date), num(c.tax), num(c.interest), r2(num(c.tax) + num(c.interest)), use[c.id] || 0, r2(num(c.tax) - (use[c.id] || 0)),
        r2(rows.filter(r => r.challan === c.id).reduce((a, r) => a + r.tds, 0)), part(c).interest, part(c).fee]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cs), "Challans");
    const head = ["Sl. No.", "Deductee code", "PAN", "Name of the deductee", "Section", "Date of payment or credit", "Amount paid or credited",
      "TDS", "Total tax deducted", "Date of deduction", "Rate", "Voucher", "Challan BSR", "Challan serial", "Challan date"];
    const body = rows.map((r, i) => {
      const c = ch.find(x => x.id === r.challan) || {};
      return [i + 1, /^[A-Z]{3}C/.test(r.pan || "") ? "01" : "02", r.pan || "PANNOTAVBL", r.party, form === "27EQ" ? r.code : TDS26Q.code(r.section),
        d(r.date), r.paid, r.tds, r.tds, d(r.date), r.rate, r.voucher, c.bsr || "", c.serial || "", d(c.date || "")];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head].concat(body)), "Deductees");
    const sum = [["Section", "Deductions", "Amount paid", "TDS", "Not against a challan", "Without PAN"]]
      .concat(this.summary(fy, q, form).map(s => [s.section, s.count, s.paid, s.tds, s.unallocated, s.noPan]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), "Summary");
    const out = XLSX.write(wb, {bookType: "xlsx", type: "array"});
    saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-" + form + "-" + (q || "all") + "-" + (fy || "") + ".xlsx", new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  }
};

