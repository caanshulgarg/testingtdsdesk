/* ================================================================== */
/* TDS: deductions from the books, challans, and what is paid by what */
/* ================================================================== */
const TDS = {
  STD: {"192B": [], "194A": [10], "194C": [1, 2], "194D": [5, 10], "194H": [2, 5], "194I": [2, 10], "194IA": [1], "194IB": [5], "194J": [2, 10], "194Q": [0.1], "194M": [2], "194N": [2, 5], "206C": [0.1, 1]},
  // what was paid or credited: from the ledger's own rate, else from the section's usual rates, else the voucher's expense
  baseFor(t, L, v){
    if (t.rate) return {paid: r2(t.amount / (t.rate / 100)), rate: t.rate, how: "ledger"};
    const cand = [];
    if (L.taxable) cand.push(L.taxable);
    v.ent.forEach(e => { const m = Books.ledgerOf(e.l); if (!m.kind && Math.abs(e.a) > 0) cand.push(Math.abs(e.a)); });
    const std = this.STD[String(t.section).replace(/\s.*$/, "")] || [];
    for (const rate of std){
      const want = r2(t.amount / (rate / 100));
      const hit = cand.find(c => Math.abs(c - want) <= Math.max(2, want * 0.005));
      if (hit) return {paid: r2(hit), rate, how: "section"};
      if (!cand.length) continue;
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
  // 26Q: every deduction other than salary
  rows(){ return this.allRows().filter(r => !/^192/.test(String(r.section || ""))); },
  // salary TDS the books carry under section 192; 24Q takes the detail from the salary sheet
  salaryRows(){ return this.allRows().filter(r => /^192/.test(String(r.section || ""))); },
  // every voucher that carries a TDS ledger becomes one deduction row
  allRows(){
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
          voucher: v.no || v.ref || "", type: v.type, challan: (b.alloc || {})[v.id + "|" + t.ledger] || ""
        });
      });
    });
    return out.sort((a, c) => String(a.date).localeCompare(String(c.date)));
  },
  // the TDS payment vouchers in the books: the challan's amount and date are already there
  paymentsFromBooks(){
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
  // 1% a month for deducting late, 1.5% for paying late, under section 201(1A)
  interest(fy, q){
    const ch = {};
    this.challans().forEach(c => { ch[c.id] = c; });
    const out = [];
    this.rows().filter(r => (!fy || r.fy === fy) && (!q || r.q === q)).forEach(r => {
      const c = ch[r.challan];
      if (!c) return;
      const due = this.dueDate(r.date);
      if (this.ymd(c.date) <= this.ymd(due)) return;
      const months = this.monthsBetween(r.date, c.date);
      const amount = r2(r.tds * 0.015 * months);
      if (amount < 1) return;
      out.push({row: r, challan: c, due, months, amount});
    });
    return out.sort((a, b) => b.amount - a.amount);
  },
  // the fee for filing the statement late: 200 a day, capped at the TDS of the quarter
  lateFee(fy, q, filedOn){
    const rows = this.rows().filter(r => r.fy === fy && r.q === q);
    if (!rows.length) return null;
    const last = {Q1: "0731", Q2: "1031", Q3: "0131", Q4: "0531"}[q];
    const y = num(fy.slice(0, 4)) + (q === "Q3" || q === "Q4" ? 1 : 0);
    const due = String(y) + last;
    const filed = this.ymd(filedOn) || this.ymd(new Date().toISOString().slice(0, 10));
    if (filed <= due) return {due, filed, days: 0, fee: 0, cap: r2(rows.reduce((a, r) => a + r.tds, 0))};
    const d1 = new Date(due.slice(0, 4) + "-" + due.slice(4, 6) + "-" + due.slice(6, 8));
    const d2 = new Date(filed.slice(0, 4) + "-" + filed.slice(4, 6) + "-" + filed.slice(6, 8));
    const days = Math.round((d2 - d1) / 86400000);
    const cap = r2(rows.reduce((a, r) => a + r.tds, 0));
    return {due, filed, days, fee: Math.min(200 * days, cap), cap};
  },
  challans(){ return ((S.books || {}).challans || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))); },
  // a challan pays several deductions; what is left of it matters
  challanUse(){
    const rows = this.rows(), used = {};
    rows.forEach(r => { if (r.challan) used[r.challan] = r2((used[r.challan] || 0) + r.tds); });
    return used;
  },
  // put deductions against challans of the same quarter and section, as a person would
  autoAllocate(){
    const b = S.books, rows = this.rows().filter(r => !r.challan), use = this.challanUse();
    const ch = this.challans();
    b.alloc = b.alloc || {};
    let n = 0;
    rows.forEach(r => {
      const fit = ch.find(c => this.qOf(c.date) === r.q && this.fyOf(c.date) === r.fy &&
        (!c.section || c.section === r.section) && r2(num(c.tax) - (use[c.id] || 0)) >= r.tds - 0.01);
      if (fit){ b.alloc[r.id] = fit.id; use[fit.id] = r2((use[fit.id] || 0) + r.tds); n++; }
    });
    return n;
  },
  summary(fy, q){
    const rows = this.rows().filter(r => (!fy || r.fy === fy) && (!q || r.q === q));
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
  async toExcel(fy, q){
    await ensureXlsx();
    const rows = this.rows().filter(r => (!fy || r.fy === fy) && (!q || r.q === q));
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
      return [i + 1, /^[A-Z]{3}C/.test(r.pan || "") ? "01" : "02", r.pan || "PANNOTAVBL", r.party, "9" + String(r.section).replace(/^19/, ""),
        d(r.date), r.paid, r.tds, r.tds, d(r.date), r.rate, r.voucher, c.bsr || "", c.serial || "", d(c.date || "")];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head].concat(body)), "Deductees");
    const sum = [["Section", "Deductions", "Amount paid", "TDS", "Not against a challan", "Without PAN"]]
      .concat(this.summary(fy, q).map(s => [s.section, s.count, s.paid, s.tds, s.unallocated, s.noPan]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), "Summary");
    const out = XLSX.write(wb, {bookType: "xlsx", type: "array"});
    saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-26Q-" + (q || "all") + "-" + (fy || "") + ".xlsx", new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  }
};

