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
  // what a section can be found by in a search: its old number and, from 2026-27, its new provision and table entry
  secFind(section, fy){ const x = this.secNew(section, fy); return [x.old, x.ref, x.label].join(" "); },
  // TCS rates by date (old section 206C; section 394 of the Act of 2025 from 1 April 2026): [from, code, rate %]. The latest
  // row on or before the collection's date applies. From 1 April 2026: scrap and minerals 2%, overseas tour packages 2% flat
  TCS_RATES: [
    ["2016-06-01", "6CA", 1], ["2016-06-01", "6CB", 5], ["2016-06-01", "6CC", 2.5], ["2016-06-01", "6CD", 2.5], ["2016-06-01", "6CE", 2.5],
    ["2016-06-01", "6CF", 1], ["2016-06-01", "6CG", 2], ["2016-06-01", "6CH", 2], ["2016-06-01", "6CI", 2], ["2016-06-01", "6CJ", 1], ["2016-06-01", "6CL", 1],
    ["2020-10-01", "6CO", 5],
    ["2026-04-01", "6CF", 2], ["2026-04-01", "6CJ", 2], ["2026-04-01", "6CO", 2]
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
  panOf(party){
    const b = S.books || {}, pans = b.pans || {};
    if (!party) return "";
    if (pans[party]) return pans[party];
    if (!b.panIndex || b.panIndexFor !== Object.keys(pans).length){
      b.panIndex = {}; b.panIndexFor = Object.keys(pans).length;
      Object.keys(pans).forEach(k => { b.panIndex[String(k).toUpperCase().replace(/[^A-Z0-9]/g, "")] = pans[k]; });
    }
    return b.panIndex[String(party).toUpperCase().replace(/[^A-Z0-9]/g, "")] || "";
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
  // 26Q: every deduction from a resident other than salary
  rows(){ return this.allRows().filter(r => !/^192/.test(String(r.section || "")) && !this.NR.test(this.sec(r.section))); },
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
          rate: recd ? r2(t.amount / recd * 100) : null, voucher: v.no || v.ref || "", type: v.type, challan: (b.alloc || {})[v.id + "|" + t.ledger] || ""});
      });
    });
    return out.sort((a, c) => String(a.date).localeCompare(String(c.date)));
  },
  // salary TDS the books carry under section 192; 24Q takes the detail from the salary sheet
  salaryRows(){ return this.allRows().filter(r => /^192/.test(String(r.section || ""))); },
  // every voucher that carries a TDS ledger becomes one deduction row
  allRows(){ return typeof perRender === "function" ? perRender(this, "allRows", () => this.allRowsNow()) : this.allRowsNow(); },
  allRowsNow(){
    const b = S.books;
    if (!b || !b.vouchers) return [];
    const out = [];
    b.vouchers.forEach(v => {
      const L = Books.lines(v);
      if (!L.tds.length) return;
      L.tds.forEach(t => {
        const B = this.baseFor(t, L, v), paid = B.paid;
        out.push({
          id: v.id + "|" + t.ledger, date: v.date, q: this.qOf(v.date), fy: this.fyOf(v.date),
          party: v.party, pan: TDS.panOf(v.party), section: t.section, ledger: t.ledger,
          paid: r2(paid), tds: r2(t.amount), rate: B.rate, rateFrom: B.how,
          voucher: v.no || v.ref || "", type: v.type, challan: (b.alloc || {})[v.id + "|" + t.ledger] || "",
          // what was paid for (professional or technical, rent of a building or of machinery): decides the rate within a
          // section (TDSRate, src/js/66)
          pay: typeof TDSRate === "object" ? TDSRate.payType(t, v) : ""
        });
      });
    });
    return out.sort((a, c) => String(a.date).localeCompare(String(c.date)));
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
      const tax = r2(L.tdsPaid.reduce((a, t) => a + t.amount, 0));
      if (!tax) return;
      out.push({vid: v.id, date: v.date, tax, sections: Array.from(new Set(L.tdsPaid.map(t => t.section))), voucher: v.no || v.ref || "", narr: v.narr});
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
  interest(fy, q, form){
    form = form || "26Q";
    const ch = {}, pct = form === "27EQ" ? 1 : 1.5;
    this.challans().forEach(c => { ch[c.id] = c; });
    const out = [];
    this.formRows(form).filter(r => (!fy || r.fy === fy) && (!q || r.q === q)).forEach(r => {
      if (form !== "27EQ" && typeof TDSInt === "object"){
        const L = TDSInt.lateDeduct(r);
        if (L){ const amount = r2(r.tds * 0.01 * L.months); if (amount >= 1) out.push({kind: "deduct", rate: 1, row: r, from: L.date, bill: L.voucher, to: r.date, months: L.months, amount}); }
      }
      const c = ch[r.challan];
      if (!c) return;
      const due = this.dueDate(r.date);
      if (this.ymd(c.date) <= this.ymd(due)) return;
      const months = this.monthsBetween(r.date, c.date);
      const amount = r2(r.tds * pct / 100 * months);
      if (amount < 1) return;
      out.push({kind: "pay", rate: pct, row: r, challan: c, due, months, amount});
    });
    return out.sort((a, b) => b.amount - a.amount);
  },
  // the due date of a quarter's statement: 31 Jul, 31 Oct, 31 Jan, 31 May; TCS (27EQ) the 15th of those months
  returnDue(fy, q, form){
    const last = form === "27EQ" ? {Q1: "0715", Q2: "1015", Q3: "0115", Q4: "0515"}[q] : {Q1: "0731", Q2: "1031", Q3: "0131", Q4: "0531"}[q];
    return String(num(fy.slice(0, 4)) + (q === "Q3" || q === "Q4" ? 1 : 0)) + last;
  },
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
  challans(){ return ((S.books || {}).challans || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))); },
  // a challan pays several deductions; what is left of it matters
  // (tds-challans, 10-Oct-2026: the salary TDS the books carry under 192 counts too, as it can now be tagged; untagged
  // before, so no figure moves)
  challanUse(){
    const rows = this.rows().concat(this.nrRows(), this.tcsRows(), this.salaryRows()), used = {};
    rows.forEach(r => { if (r.challan) used[r.challan] = r2((used[r.challan] || 0) + r.tds); });
    return used;
  },
  // put deductions against challans of the same quarter and section, as a person would
  autoAllocate(){
    const b = S.books, rows = this.rows().concat(this.nrRows(), this.tcsRows()).filter(r => !r.challan), use = this.challanUse();
    const ch = this.challans();
    b.alloc = b.alloc || {};
    let n = 0;
    rows.forEach(r => {
      const fit = ch.find(c => this.qOf(c.date) === r.q && this.fyOf(c.date) === r.fy &&
        (!c.section || c.section === r.section) && /^206C/.test(String(c.section || "")) === /^206C/.test(String(r.section || "")) &&
        r2(num(c.tax) - (use[c.id] || 0)) >= r.tds - 0.01);
      if (fit){ b.alloc[r.id] = fit.id; use[fit.id] = r2((use[fit.id] || 0) + r.tds); n++; }
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
    const ch = this.challans().filter(c => (!fy || this.fyOf(c.date) === fy) && (!q || this.qOf(c.date) === q));
    const use = this.challanUse();
    const d = s => s ? String(s).slice(6, 8) + "/" + String(s).slice(4, 6) + "/" + String(s).slice(0, 4) : "";
    const wb = XLSX.utils.book_new();
    const cs = [["Challans", "", "", "", "", "", ""], ["BSR code", "Challan serial", "Date deposited", "Tax", "Interest", "Total", "Allocated", "Left"]]
      .concat(ch.map(c => [c.bsr, c.serial, d(c.date), num(c.tax), num(c.interest), r2(num(c.tax) + num(c.interest)), use[c.id] || 0, r2(num(c.tax) - (use[c.id] || 0))]));
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

