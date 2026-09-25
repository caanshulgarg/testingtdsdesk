/* ================================================================== */
/* Audit: checks run on the books, each with the problem, what it     */
/* costs, what to do, and the journal entry when one is needed        */
/* ================================================================== */
const Audit = {
  AREAS: [["cash", "Cash and loans"], ["tds", "TDS"], ["gst", "GST"], ["books", "Books and audit trail"], ["bal", "Balances"]],
  SEV: {high: 3, medium: 2, low: 1},
  STATUS: [["open", "Open"], ["explained", "Explained"], ["pass", "Entry to pass"], ["passed", "Entry passed"], ["no", "Not an issue"]],
  cfg(b){ return Object.assign({freq: "daily"}, (b && b.auditCfg) || {}); },
  ymd(d){ return String(d || "").replace(/-/g, "").slice(0, 8); },
  iso(d){ d = this.ymd(d); return d.length === 8 ? d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8) : ""; },
  days(a, c){ const f = s => new Date(this.iso(s) + "T00:00:00").getTime(); return Math.round((f(c) - f(a)) / 86400000); },
  today(){ const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); },
  fyStart(d){ d = this.ymd(d); const y = num(d.slice(0, 4)), m = num(d.slice(4, 6)); return String(m >= 4 ? y : y - 1) + "0401"; },
  // the group a ledger sits under, up to the top
  path(l){
    const b = S.books, under = b.under || {}, groups = b.groups || {}, out = [];
    let p = under[l];
    for (let i = 0; p && i < 15; i++){ out.push(p); p = groups[p]; }
    return out;
  },
  under(l, re){ return this.path(l).some(g => re.test(g)); },
  isCash(l){ const m = Books.ledgerOf(l); return this.under(l, /^cash-in-hand$/i) || (!this.path(l).length && m.kind === "bank" && /\bCASH\b/i.test(l)); },
  isBankL(l){ return this.under(l, /^bank (accounts|od a\/c|occ a\/c)$/i) || (Books.ledgerOf(l).kind === "bank" && !this.isCash(l)); },
  isLoan(l){ return this.under(l, /^(loans \(liability\)|secured loans|unsecured loans)$/i) || (!this.path(l).length && /\bLOAN\b/i.test(l)); },
  isCapital(l){ return this.under(l, /^capital account$/i); },
  isDuties(l){ return this.under(l, /^duties & taxes$/i) || !!Books.ledgerOf(l).kind && Books.ledgerOf(l).kind !== "bank" && Books.ledgerOf(l).kind !== "roundoff"; },
  isCreditor(l){ return this.under(l, /^sundry creditors$/i); },
  isDebtor(l){ return this.under(l, /^sundry debtors$/i); },
  isExpense(l){ return this.under(l, /^(indirect expenses|direct expenses)$/i) || (!this.path(l).length && !Books.ledgerOf(l).kind && /EXP|CHARGES|RENT|SALARY|WAGES|FEES|REPAIR|FREIGHT|CARTAGE|TRAVEL|CONVEYANCE|COMMISSION|ADVERT/i.test(l)); },
  isFixed(l){ return this.under(l, /^fixed assets$/i); },
  isIncome(l){ return this.under(l, /^(sales accounts|direct incomes|indirect incomes)$/i); },
  mastersIn(){ return Object.keys(S.books.under || {}).length > 0; },
  // balances need the opening balances and every voucher since the books began
  // balances at any date in the period: from Tally's own balances when the bridge has read them,
  // else from the opening balances in the masters, when the day book starts where the books begin
  balances(from, to){
    const b = S.books, tb = b.tb;
    const move = (base, start, d) => {
      const bal = Object.assign({}, base);
      (b.vouchers || []).forEach(v => { if (v.date < start || v.date > d || v.opt || v.cancel) return; v.ent.forEach(e => { bal[e.l] = r2((bal[e.l] || 0) + e.a); }); });
      return bal;
    };
    if (tb && tb.from <= from && tb.to >= to){
      const open = {}; Object.entries(tb.led || {}).forEach(([n, x]) => { open[n] = num(x.open); });
      return {ok: true, src: "Tally's balances read on " + fmtDate(String(tb.at).slice(0, 10)), at: d => move(open, tb.from, d)};
    }
    const info = b.ledInfo || {}, starts = Object.values(info).map(x => x.from).filter(Boolean).sort();
    if (!Object.values(info).some(x => x.ob != null)) return {ok: false, why: "the ledger balances are not read yet; read the day book and balances from Tally through the bridge, or bring in the ledger masters"};
    const begin = starts[0] || "", first = String((b.meta || {}).from || "");
    if (begin && first && first > begin) return {ok: false, why: "the books begin on " + fmtDate(tallyDate(begin)) + " but the day book starts on " + fmtDate(tallyDate(first)) + "; read the day book and balances from Tally through the bridge, or a day book from " + fmtDate(tallyDate(begin))};
    const ob = {}; Object.entries(info).forEach(([n, x]) => { if (x.ob) ob[n] = num(x.ob); });
    return {ok: true, src: "opening balances in the masters", at: d => move(ob, "00000000", d)};
  },
  dayBefore(d){ const t = new Date(this.iso(d) + "T00:00:00"); t.setDate(t.getDate() - 1); return this.ymd(t.getFullYear() + String(t.getMonth() + 1).padStart(2, "0") + String(t.getDate()).padStart(2, "0")); },
  vouchers(from, to){ return (S.books.vouchers || []).filter(v => v.date >= from && v.date <= to && !v.opt && !v.cancel); },
  row(v, extra){ return Object.assign({vid: v.id, date: v.date, no: v.no, type: v.type, party: v.party, narr: v.narr}, extra || {}); },
  money(v){ return INR.format(r2(v || 0)); },
  // the ledger to use for a head from the confirmed master, or a name to create
  led(what, head, reg, side){
    const hit = Object.entries(S.books.map || {}).find(([, m]) => m.what === what && (!head || m.tax === head) && (!reg || !m.reg || m.reg === reg) && (!side || m.side === side));
    return hit ? hit[0] : null;
  },
  tdsLedger(section){
    const hit = Object.entries(S.books.map || {}).find(([, m]) => m.kind === "tds_payable" && m.section && String(m.section).replace(/-/g, "").toUpperCase() === String(section).replace(/-/g, "").toUpperCase());
    return hit ? hit[0] : null;
  },
  exists(l){ return !!((S.books.ledInfo || {})[l] || (S.books.map || {})[l]); },
  // ---------------------------------------------------------------- the checks
  checks: {
    cash40A3(A, V, ctx){
      const byDay = {};
      V.forEach(v => {
        if (/CONTRA/i.test(v.type)) return;
        const paid = v.ent.filter(e => A.isCash(e.l) && e.a > 0).reduce((s, e) => s + e.a, 0);
        if (!paid) return;
        v.ent.filter(e => e.a < 0 && !A.isCash(e.l) && !A.isBankL(e.l) && !A.isLoan(e.l) && !A.isCapital(e.l) && !A.isDuties(e.l) && !A.isDebtor(e.l) && !/IMPREST|ADVANCE|SECURITY DEPOSIT/i.test(e.l)).forEach(e => {
          const k = v.date + "|" + e.l + (A.isExpense(e.l) ? "|" + v.id : ""), x = byDay[k] = byDay[k] || {date: v.date, l: e.l, amt: 0, vs: []};
          x.amt = r2(x.amt + Math.min(-e.a, paid)); x.vs.push(v);
        });
      });
      const rows = Object.values(byDay).filter(x => x.amt > (/TRANSPORT|ROADWAYS|LOGISTIC|CARRIER|GOODS CARRIAGE|TRUCK/i.test(x.l) ? 35000 : 10000));
      if (!rows.length) return null;
      const amt = rows.reduce((s, x) => s + x.amt, 0);
      return {area: "cash", sev: "high", clause: "3CD 21(d); section 40A(3)", title: "Cash payments above \u20b910,000 to one party in a day",
        problem: rows.length + " cash payments over \u20b910,000 (\u20b935,000 for transporters): to one party in a day, or in one voucher where the expense ledger names no payee.",
        impact: "Disallowed under section 40A(3) unless a rule 6DD exception applies; for a capital asset, left out of its cost (section 43(1)).", amount: amt,
        suggestion: "Pay these by bank. For the year, add the amount to income in the computation, or record the rule 6DD exception that applies.", je: null,
        rows: rows.map(x => A.row(x.vs[0], {party: x.l, amount: x.amt, note: x.vs.length + " voucher" + (x.vs.length === 1 ? "" : "s") + " that day"}))};
    },
    cashLoans(A, V){
      const taken = [], repaid = [];
      V.forEach(v => {
        const cashIn = v.ent.filter(e => A.isCash(e.l) && e.a < 0).reduce((s, e) => s - e.a, 0), cashOut = v.ent.filter(e => A.isCash(e.l) && e.a > 0).reduce((s, e) => s + e.a, 0);
        v.ent.forEach(e => {
          if (!A.isLoan(e.l) || /BANK|FINANCE|NBFC|CAPITAL LTD|HOUSING/i.test(e.l)) return;
          if (cashIn >= 20000 && e.a > 0) taken.push(A.row(v, {party: e.l, amount: Math.min(e.a, cashIn)}));
          if (cashOut >= 20000 && e.a < 0) repaid.push(A.row(v, {party: e.l, amount: Math.min(-e.a, cashOut)}));
        });
      });
      const out = [];
      if (taken.length) out.push({key: "269SS", area: "cash", sev: "high", clause: "3CD 31(a); section 269SS", title: "Loans or deposits taken in cash, \u20b920,000 or more",
        problem: taken.length + " loans or deposits received in cash.", impact: "Penalty under section 271D equal to the amount taken.", amount: taken.reduce((s, r) => s + r.amount, 0),
        suggestion: "Take loans only by bank. Report each in clause 31(a); where there is a reasonable cause, keep the explanation on file.", je: null, rows: taken});
      if (repaid.length) out.push({key: "269T", area: "cash", sev: "high", clause: "3CD 31(b), 31(c); section 269T", title: "Loans or deposits repaid in cash, \u20b920,000 or more",
        problem: repaid.length + " repayments made in cash.", impact: "Penalty under section 271E equal to the amount repaid.", amount: repaid.reduce((s, r) => s + r.amount, 0),
        suggestion: "Repay only by bank. Report each in clause 31.", je: null, rows: repaid});
      return out;
    },
    cash269ST(A, V){
      const byDay = {};
      V.forEach(v => {
        const cashIn = v.ent.filter(e => A.isCash(e.l) && e.a < 0).reduce((s, e) => s - e.a, 0);
        if (!cashIn) return;
        v.ent.filter(e => e.a > 0 && !A.isCash(e.l) && !A.isBankL(e.l) && !A.isLoan(e.l) && !A.isCapital(e.l)).forEach(e => {
          const k = v.date + "|" + e.l, x = byDay[k] = byDay[k] || {date: v.date, l: e.l, amt: 0, v};
          x.amt = r2(x.amt + Math.min(e.a, cashIn));
        });
      });
      const rows = Object.values(byDay).filter(x => x.amt >= 200000);
      if (!rows.length) return null;
      return {area: "cash", sev: "high", clause: "section 269ST", title: "Cash received of \u20b92 lakh or more from one person in a day",
        problem: rows.length + " receipts.", impact: "Penalty under section 271DA equal to the amount received.", amount: rows.reduce((s, x) => s + x.amt, 0),
        suggestion: "Receive these amounts by bank only.", je: null, rows: rows.map(x => A.row(x.v, {party: x.l, amount: x.amt}))};
    },
    cashNegative(A, V, ctx){
      if (!ctx.bal.ok) return null;
      const cash = Array.from(new Set(Object.keys(S.books.ledInfo || {}).concat(Object.keys((S.books.tb || {}).led || {})))).filter(l => A.isCash(l)).sort();
      if (!cash.length) return null;
      const start = ctx.bal.at(A.dayBefore(ctx.from)), bal = {}; cash.forEach(l => { bal[l] = num(start[l]); });
      const rows = [];
      const all = (S.books.vouchers || []).filter(v => v.date >= ctx.from && v.date <= ctx.to && !v.opt && !v.cancel).sort((a, c) => a.date.localeCompare(c.date) || String(a.no).localeCompare(String(c.no)));
      let day = "";
      const close = () => { if (day >= ctx.from) cash.forEach(l => { if (bal[l] > 1) rows.push({vid: "", date: day, no: "", type: "", party: l, amount: bal[l], note: "cash balance at the end of the day: " + A.money(-bal[l])}); }); };
      all.forEach(v => { if (v.date !== day){ if (day) close(); day = v.date; } v.ent.forEach(e => { if (bal[e.l] != null) bal[e.l] = r2(bal[e.l] + e.a); }); });
      if (day) close();
      if (!rows.length) return null;
      return {area: "cash", sev: "high", title: "Cash in hand below zero", clause: "books of account", problem: rows.length + " days on which the cash book closed in credit.",
        impact: "Cash cannot be negative: entries are missing, dated wrongly, or the cash is not real. Auditors report this, and it can lead to additions as unexplained money.",
        amount: Math.max.apply(null, rows.map(r => r.amount)), suggestion: "Find the receipts or withdrawals that were not entered, or correct the dates.", je: null, rows: rows.slice(0, 300)};
    },
    tdsMissed(A, V, ctx){
      const done = new Set(TDS.allRows().filter(r => r.date >= ctx.from && r.date <= ctx.to).map(r => r.party));
      const KEY = [[/RENT/i, "rent_building"], [/LEGAL|AUDIT|PROFESSIONAL|PROFF|CONSULT|ADVOCATE|RETAINER/i, "professional"], [/TECHNICAL/i, "technical"],
        [/COMMISSION|BROKERAGE/i, "commission"], [/CONTRACT|LABOUR|JOB\s*WORK|MANPOWER|TRANSPORT|FREIGHT|CARTAGE|REPAIR|MAINTENANCE|ADVERT|PRINTING|CATERING|SECURITY|HOUSEKEEPING/i, "contractor"],
        [/INTEREST/i, "interest"]];
      const agg = {};
      V.forEach(v => {
        if (Books.isSale(v)) return;
        const parties = v.ent.filter(e => e.a > 0 && (A.isCreditor(e.l) || (!A.mastersIn() && (S.books.pans || {})[e.l])));
        if (!parties.length) return;
        v.ent.filter(e => e.a < 0 && A.isExpense(e.l)).forEach(e => {
          const k = KEY.find(([re]) => re.test(e.l));
          if (!k) return;
          const p = parties[0].l;
          if (done.has(p) || /\bBANK\b|GOVERNMENT|MUNICIPAL|\bLIC\b/i.test(p)) return;
          const x = agg[p + "|" + k[1]] = agg[p + "|" + k[1]] || {party: p, rule: k[1], amt: 0, max: 0, months: {}, v, ledger: e.l};
          x.amt = r2(x.amt - e.a); x.max = Math.max(x.max, -e.a); x.months[v.date.slice(0, 6)] = r2((x.months[v.date.slice(0, 6)] || 0) - e.a);
        });
      });
      const rows = [], je = [];
      Object.values(agg).forEach(x => {
        const r = RULE_DEFAULTS.find(z => z.id === x.rule);
        if (!r) return;
        const over = r.basis === "single_or_annual" ? (x.max > r.single || x.amt > r.limit) : r.basis === "monthly" ? Object.values(x.months).some(m => m > r.limit) : x.amt > r.limit;
        if (!over) return;
        const pan = (S.books.pans || {})[x.party] || "", rate = /^[A-Z]{3}[PH]/.test(pan) ? r.rateInd : r.rateOth;
        const tds = r2(x.amt * rate / 100);
        const foreign = /\b(INC|LLC|GMBH|PTE|PTY|IRELAND|SINGAPORE|USA|UK|B\.?V|AG|SARL)\b/i.test(x.party) && !(S.books.gstins || {})[x.party];
        rows.push(A.row(x.v, {party: x.party, amount: x.amt, note: (foreign ? "looks non-resident: section 195 or the equalisation levy, not " + r.old + "; " : "") + r.old + " at " + rate + "%: TDS " + A.money(tds) + (pan ? "" : "; no PAN in Tally, so 20%") + " \u00b7 booked to " + x.ledger}));
        if (foreign) return;
        const tl = A.tdsLedger(r.old) || "TDS PAYABLE " + r.old;
        je.push({date: ctx.to, narr: "TDS under section " + r.old + " not deducted on " + x.ledger + " for the period", lines: [{l: x.party, dr: tds}, {l: tl, cr: tds}]});
      });
      if (!rows.length) return null;
      const amt = rows.reduce((s, r) => s + r.amount, 0);
      return {area: "tds", sev: "high", clause: "3CD 21(b), 34(a); section 40(a)(ia)", title: "Expenses where TDS was due but not deducted",
        problem: rows.length + " parties crossed the TDS limit for their kind of expense and have no TDS in the books.",
        impact: "30% of the expense is disallowed under section 40(a)(ia) (\u20b9" + INR.format(r2(amt * 0.3)) + "), with interest under section 201(1A) on the TDS.", amount: amt,
        suggestion: "Deduct the TDS now from the next payment, deposit it with interest, and file the correction statement. If it is paid before the due date of the return, the expense is allowed this year.",
        je, rows};
    },
    tdsLate(A, V, ctx){
      const fy = TDS.fyOf(ctx.to), rows = [];
      ["Q1", "Q2", "Q3", "Q4"].forEach(q => TDS.interest(fy, q).forEach(x => rows.push({vid: "", date: x.row.date, no: x.row.voucher || "", type: "", party: x.row.party,
        amount: x.amount, note: "TDS " + A.money(x.row.tds) + " due " + fmtDate(tallyDate(x.due)) + ", paid " + fmtDate(tallyDate(x.challan.date)) + ", " + x.months + " months"})));
      if (!rows.length) return null;
      return {area: "tds", sev: "medium", clause: "3CD 34(c); section 201(1A)", title: "TDS paid after the due date", problem: rows.length + " deductions paid late.",
        impact: "Interest under section 201(1A) of \u20b9" + INR.format(r2(rows.reduce((s, r) => s + r.amount, 0))) + "; it is reported in clause 34(c) and is not a deductible expense.",
        amount: rows.reduce((s, r) => s + r.amount, 0), suggestion: "Pay the interest with the next challan and book it to an interest-on-TDS ledger.",
        je: [{date: ctx.to, narr: "Interest under section 201(1A) on TDS paid late", lines: [{l: A.led("tds_interest") || "INTEREST ON TDS", dr: r2(rows.reduce((s, r) => s + r.amount, 0))}, {l: A.tdsLedger("194C") || "TDS PAYABLE", cr: r2(rows.reduce((s, r) => s + r.amount, 0))}]}], rows};
    },
    tdsUnpaid(A, V, ctx){
      const rows = TDS.rows().filter(r => r.date >= ctx.from && r.date <= ctx.to && !r.challan);
      if (!rows.length) return null;
      const amt = rows.reduce((s, r) => s + r.tds, 0);
      return {total: rows.length, area: "tds", sev: TDS.challans().length ? "high" : "medium", clause: "3CD 34(b); section 40(a)(ia)", title: "TDS deducted but not matched to a challan",
        problem: rows.length + " deductions of \u20b9" + INR.format(r2(amt)) + (TDS.challans().length ? " are not against any challan." : "; no challans are entered in TDS Desk yet."),
        impact: "If not deposited: the expense is disallowed (30%), interest runs under section 201(1A), and the return shows a shortfall.", amount: amt,
        suggestion: TDS.challans().length ? "Match them under TDS \u2192 the quarter \u2192 Challans, or deposit what is unpaid." : "Enter the challans under TDS \u2192 the quarter \u2192 Challans (payments in Tally are offered there), then put the deductions against them.",
        je: null, rows: rows.slice(0, 500).map(r => ({vid: r.voucherId || "", date: r.date, no: r.voucher || "", type: r.section, party: r.party, amount: r.tds, note: "section " + r.section}))};
    },
    tdsPan(A, V, ctx){
      const rows = TDS.rows().filter(r => r.date >= ctx.from && r.date <= ctx.to && !Certs.validPan(r.pan));
      if (!rows.length) return null;
      const short = rows.reduce((s, r) => s + Math.max(0, r2(r.paid * 0.2 - r.tds)), 0);
      return {total: rows.length, area: "tds", sev: "medium", clause: "3CD 34(a); section 206AA", title: "Deductees without a valid PAN", problem: rows.length + " deductions to " + new Set(rows.map(r => r.party)).size + " parties with no valid PAN in Tally.",
        impact: "TDS applies at 20% without a PAN; the shortfall is \u20b9" + INR.format(r2(short)) + ", and the return is rejected for invalid PANs.", amount: short,
        suggestion: "Get the PAN and add it to the party ledger in Tally; if a party truly has none, deduct the balance to 20%.", je: null,
        rows: rows.slice(0, 500).map(r => ({vid: "", date: r.date, no: r.voucher || "", type: r.section, party: r.party, amount: r.tds, note: "paid " + A.money(r.paid)}))};
    },
    tdsRate(A, V, ctx){
      const fy = TDS.fyOf(ctx.to), rows = [];
      ["Q1", "Q2", "Q3", "Q4"].forEach(q => Certs.issues(fy, q).filter(x => x.short > 0 && x.row.date >= ctx.from && x.row.date <= ctx.to).forEach(x => rows.push({vid: "", date: x.row.date, no: x.row.voucher || "",
        type: x.row.section, party: x.row.party, amount: x.short, note: x.row.rate + "% used, " + x.expected + "% applies: " + x.why})));
      if (!rows.length) return null;
      const amt = rows.reduce((s, r) => s + r.amount, 0);
      return {area: "tds", sev: "medium", clause: "3CD 34(a)", title: "TDS deducted at a lower rate than applies", problem: rows.length + " deductions short.",
        impact: "The shortfall of \u20b9" + INR.format(r2(amt)) + " is payable with interest, and the expense is exposed to disallowance to that extent.", amount: amt,
        suggestion: "Deduct the balance from the next payment to each party and deposit it.", je: null, rows};
    },
    gstBlocked(A, V){
      const RE = /\b(FOOD|MEAL|CATERING|CANTEEN|STAFF WELFARE|REFRESHMENT|CLUB|MEMBERSHIP|HEALTH|MEDICAL|LIFE INSURANCE|MOTOR CAR|CAR HIRE|VEHICLE|BEAUTY|GYM|GIFT|HOLIDAY)\b/i;
      const rows = [], je = [];
      V.forEach(v => {
        if (Books.isSale(v)) return;
        const exp = v.ent.find(e => e.a < 0 && RE.test(e.l) && (A.isExpense(e.l) || A.isFixed(e.l) || !A.mastersIn()));
        if (!exp) return;
        const tax = v.ent.filter(e => { const m = Books.ledgerOf(e.l); return e.a < 0 && (m.kind === "gst" || m.kind === "gst_common") && m.side === "input"; });
        if (!tax.length) return;
        const t = r2(tax.reduce((s, e) => s - e.a, 0));
        rows.push(A.row(v, {party: v.party, amount: t, note: "credit taken on " + exp.l}));
        je.push({date: v.date, narr: "Credit not available under section 17(5) on " + exp.l + ", voucher " + v.no, lines: [{l: exp.l, dr: t}].concat(tax.map(e => ({l: e.l, cr: r2(-e.a)})))});
      });
      if (!rows.length) return null;
      return {area: "gst", sev: "medium", clause: "section 17(5); 3B 4(B)(1)", title: "Credit taken on expenses that are usually blocked",
        problem: rows.length + " vouchers take input tax on food, club, vehicle, health or similar expenses.",
        impact: "Blocked under section 17(5) unless the same kind of supply is made onward (catering bought for an event you bill is allowed). If blocked, the credit is reversed with interest.",
        amount: rows.reduce((s, r) => s + r.amount, 0), suggestion: "Check each. Where the credit is blocked, reverse it in 3B table 4(B)(1) and add the tax to the expense.", je, rows};
    },
    gstRcm(A, V, ctx){
      const KINDS = [[/LEGAL|ADVOCATE|LAWYER/i, "legal services by an advocate", 18, false], [/\bGTA\b|FREIGHT|CARTAGE|TRANSPORT/i, "goods transport agency", 5, false],
        [/SECURITY/i, "security services by a non-company", 18, true], [/\bRENT\b/i, "renting of commercial property by an unregistered person", 18, true], [/SITTING FEE|DIRECTOR.*FEE/i, "director's fees", 18, false]];
      const rows = [], je = [], regs = ((S.books.meta || {}).gstins || []).map(g => g.slice(0, 2));
      V.forEach(v => {
        if (Books.isSale(v) || v.rcm) return;
        if (v.ent.some(e => { const m = Books.ledgerOf(e.l); return m.kind === "gst" || m.kind === "gst_common" || m.kind === "ineligible"; })) return;
        const exp = v.ent.find(e => e.a < 0 && A.isExpense(e.l) && KINDS.some(([re]) => re.test(e.l)));
        if (!exp) return;
        const k = KINDS.find(([re]) => re.test(exp.l)), party = v.ent.find(e => e.a > 0 && A.isCreditor(e.l)) || (!A.mastersIn() ? v.ent.find(e => e.a > 0 && !A.isBankL(e.l) && !A.isCash(e.l) && !A.isDuties(e.l)) : null);
        const paidOut = v.ent.some(e => e.a > 0 && (A.isBankL(e.l) || A.isCash(e.l)));
        if (!party && (k[3] || !paidOut)) return;              // a transfer between ledgers, not a supply
        const pg = party ? String((S.books.gstins || {})[party.l] || "") : "";
        if (k[3] && pg) return;                                 // registered: forward charge
        const val = r2(-exp.a), tax = r2(val * k[2] / 100), reg = String(v.cmp || "").slice(0, 2) || regs[0] || "";
        rows.push(A.row(v, {party: party ? party.l : v.party, amount: tax, note: k[1] + ", " + k[2] + "% on " + A.money(val)}));
        const half = r2(tax / 2);
        const outL = h => A.led("gst_rcm", h, reg, "output") || (reg + " " + h + " RCM PAYABLE"), inL = h => A.led("gst_rcm", h, reg, "input") || A.led("gst", h, reg, "input") || (reg + " " + h + " RCM INPUT");
        je.push({date: v.date, narr: "Reverse charge on " + k[1] + ", voucher " + v.no, lines: [{l: inL("CGST"), dr: half}, {l: inL("SGST"), dr: r2(tax - half)}, {l: outL("CGST"), cr: half}, {l: outL("SGST"), cr: r2(tax - half)}]});
      });
      if (!rows.length) return null;
      return {area: "gst", sev: "high", clause: "section 9(3); 3B 3.1(d)", title: "Reverse charge not paid on notified services", problem: rows.length + " expenses on services taxed under reverse charge, with no tax booked.",
        impact: "The tax is payable by you, with interest, and credit can be taken only after it is paid.", amount: rows.reduce((s, r) => s + r.amount, 0),
        suggestion: "Pay the tax under reverse charge in 3B 3.1(d) and take the credit in 4(A)(3). Where the supplier charged GST under forward charge, record their GSTIN so this stops showing. The entries below assume the supply is within the state; use IGST where it is not.", je, rows};
    },
    gstRule37(A, V, ctx){
      const bills = {};
      (S.books.vouchers || []).filter(v => v.date <= ctx.to && !v.opt && !v.cancel).forEach(v => v.ent.forEach(e => (e.b || []).forEach(([name, type, amt]) => {
        if (!name) return;
        const k = e.l + "|" + name, x = bills[k] = bills[k] || {party: e.l, ref: name, billed: 0, paid: 0, v: null, tax: []};
        if (type === "New Ref" && amt > 0 && Books.isPurchase(v)){ x.billed = r2(x.billed + amt); x.v = v; x.tax = v.ent.filter(z => { const m = Books.ledgerOf(z.l); return z.a < 0 && (m.kind === "gst" || m.kind === "gst_common") && m.side === "input"; }); }
        else if (amt < 0) x.paid = r2(x.paid - amt);
      })));
      const rows = [], je = [];
      Object.values(bills).forEach(x => {
        if (!x.v || !x.tax.length || x.billed - x.paid < 1) return;
        const age = A.days(x.v.refDate || x.v.date, ctx.to);
        if (age <= 180) return;
        const share = (x.billed - x.paid) / x.billed, t = r2(x.tax.reduce((s, e) => s - e.a, 0) * share);
        if (t < 1) return;
        rows.push(A.row(x.v, {party: x.party, amount: t, note: "bill " + x.ref + ", " + age + " days, " + A.money(x.billed - x.paid) + " unpaid"}));
        je.push({date: ctx.to, narr: "Credit reversed under rule 37: bill " + x.ref + " of " + x.party + " unpaid after 180 days", lines: [{l: "ITC REVERSED RULE 37 (TO RECLAIM)", dr: t}].concat(x.tax.map(e => ({l: e.l, cr: r2(-e.a * share)})))});
      });
      if (!rows.length) return null;
      return {area: "gst", sev: "high", clause: "rule 37; 3B 4(B)(2)", title: "Suppliers unpaid after 180 days, credit still taken",
        problem: rows.length + " purchase bills still unpaid 180 days after the invoice date.", impact: "The credit on the unpaid part is to be reversed with interest; it can be taken again once the supplier is paid.",
        amount: rows.reduce((s, r) => s + r.amount, 0), suggestion: "Pay the suppliers, or reverse the credit in 3B table 4(B)(2) and reclaim it in 4(A)(5) after payment.", je, rows};
    },
    gst2b(A, V, ctx){
      if (!Object.keys(S.books.twoBs || {}).length) return null;
      const months = []; for (let m = ctx.from.slice(0, 6); m <= ctx.to.slice(0, 6); m = String(num(m.slice(4)) === 12 ? num(m.slice(0, 4)) + 1 + "01" : m.slice(0, 4) + String(num(m.slice(4)) + 1).padStart(2, "0"))) months.push(m);
      const rows = [];
      ((S.books.meta || {}).gstins || [""]).forEach(g => { const sc = GST2B.scope(g.slice(0, 2), months); sc.onlyBooks.forEach(d => rows.push({vid: d.id, date: d.date, no: d.no, type: d.type, party: d.party, amount: r2(d.igst + d.cgst + d.sgst + d.cess) * d.dir, note: d.gstin ? "not in 2B" : "no GSTIN in Tally"})); });
      if (!rows.length) return null;
      return {area: "gst", sev: "medium", clause: "section 16(2)(aa); rule 36(4)", title: "Credit in the books that is not in GSTR-2B", problem: rows.length + " documents.",
        impact: "Credit can be taken only when the supplier reports the invoice; what is not in 2B by the 30 November after the year is lost.", amount: rows.reduce((s, r) => s + r.amount, 0),
        suggestion: "Follow up with the suppliers (a note can be copied from the 2B reconciliation, supplier by supplier), and do not claim these in 3B until they appear.", je: null, rows};
    },
    gstr1(A, V, ctx){
      const rows = [];
      Object.values(S.books.filed || {}).filter(f => !f.notFiled && f.ym >= ctx.from.slice(0, 6) && f.ym <= ctx.to.slice(0, 6)).forEach(f => {
        const c = GSTAmend.check(f.ym, f.gstin.slice(0, 2));
        (c ? c.rows : []).forEach(r => rows.push({vid: "", date: r.doc.date, no: r.doc.num, type: r.kind, party: r.doc.ctin || "", amount: r.doc.txval, note: GSTR.label(f.ym) + ": " + r.changes.join("; ")}));
      });
      if (!rows.length) return null;
      return {area: "gst", sev: "medium", clause: "section 37", title: "Sales in the books that differ from GSTR-1 filed", problem: rows.length + " documents differ from the returns filed.",
        impact: "Tax on the difference is payable, or the return is to be amended; turnover in the audit report will not agree with the returns.", amount: rows.reduce((s, r) => s + num(r.amount), 0),
        suggestion: "Report them as amendments under GST \u2192 Amendments in the next GSTR-1, by the 30 November after the year.", je: null, rows};
    },
    ledgers(A){
      const p = LedMaster.pending(S.books);
      if (!p.length) return null;
      return {area: "books", sev: "low", clause: "", title: "GST and TDS ledgers not confirmed", problem: p.length + " ledgers are still guessed.", impact: "Every tax figure in this report rests on how these ledgers are read.",
        amount: 0, suggestion: "Confirm them under Tally ledgers.", je: null, rows: p.map(([n, m]) => ({vid: "", date: "", no: "", type: LedMaster.label(m.what), party: n, amount: 0, note: m.why || ""}))};
    },
    duplicates(A, V){
      const by = {}, near = {};
      V.forEach(v => {
        if (Books.isSale(v) || /RECEIPT|PAYMENT|CONTRA/i.test(v.type)) return;
        const p = v.ent.find(e => e.a > 0 && (A.isCreditor(e.l) || (S.books.gstins || {})[e.l]));
        if (!p) return;
        const ref = GST2B.normNo(v.ref), kk = p.l + "|" + ref + "|" + Math.round(p.a);
        if (ref && ref.length >= 3 && !/^\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}$/.test(String(v.ref).trim())) (by[kk] = by[kk] || []).push(v);
        (near[p.l + "|" + p.a] = near[p.l + "|" + p.a] || []).push(v);
      });
      const out = [];
      const dup = Object.values(by).filter(l => l.length > 1);
      if (dup.length){
        const rows = [], je = [];
        dup.forEach(l => l.slice(1).forEach(v => {
          const p = v.ent.find(e => e.a > 0);
          rows.push(A.row(v, {amount: p ? p.a : 0, note: "same bill " + v.ref + " as voucher " + l[0].no + " of " + fmtDate(tallyDate(l[0].date))}));
          je.push({date: v.date, narr: "Reversal of voucher " + v.no + ", a second entry of bill " + v.ref, lines: v.ent.map(e => e.a < 0 ? {l: e.l, cr: r2(-e.a)} : {l: e.l, dr: r2(e.a)})});
        }));
        out.push({key: "dupRef", area: "books", sev: "high", clause: "", title: "The same supplier bill entered twice", problem: rows.length + " bills are in the books more than once.",
          impact: "Expense and input tax are overstated by these amounts, and the supplier's balance is wrong.", amount: rows.reduce((s, r) => s + r.amount, 0),
          suggestion: "Check each pair; delete the second entry in Tally, or pass the reversal below.", je, rows});
      }
      const rows2 = [];
      Object.values(near).forEach(l => {
        if (l.length < 2) return;
        l.sort((a, c) => a.date.localeCompare(c.date));
        for (let i = 1; i < l.length; i++) if (A.days(l[i - 1].date, l[i].date) <= 3 && GST2B.normNo(l[i].ref) !== GST2B.normNo(l[i - 1].ref) && l[i].ent.find(e => e.a > 0).a >= 5000)
          rows2.push(A.row(l[i], {amount: l[i].ent.find(e => e.a > 0).a, note: "same party and amount as voucher " + l[i - 1].no + " of " + fmtDate(tallyDate(l[i - 1].date))}));
      });
      if (rows2.length) out.push({key: "dupNear", area: "books", sev: "low", clause: "", title: "Same party and amount within three days", problem: rows2.length + " entries look like repeats under a different bill number.",
        impact: "If they are repeats, expense and credit are overstated.", amount: rows2.reduce((s, r) => s + r.amount, 0), suggestion: "Check the bills; most will be genuine, but repeats show up here first.", je: null, rows: rows2});
      return out;
    },
    gaps(A, V){
      const series = {};
      V.forEach(v => {
        if (!Books.isSale(v) || /CREDIT/i.test(v.type)) return;
        const m = String(v.no).match(/^(.*?)(\d+)(\D*)$/);
        if (!m) return;
        const k = GSTR.regOf(v) + "|" + m[1] + "|" + m[3] + "|" + v.type;
        (series[k] = series[k] || {pre: m[1], suf: m[3], nums: new Set(), type: v.type, reg: GSTR.regOf(v)}).nums.add(num(m[2]));
      });
      const rows = [];
      Object.values(series).forEach(s => {
        const n = Array.from(s.nums).sort((a, c) => a - c);
        if (n.length < 5) return;
        for (let i = 1; i < n.length; i++) if (n[i] - n[i - 1] > 1 && n[i] - n[i - 1] < 50){
          const miss = []; for (let k = n[i - 1] + 1; k < n[i]; k++) miss.push(s.pre + k + s.suf);
          rows.push({vid: "", date: "", no: miss.slice(0, 5).join(", ") + (miss.length > 5 ? " \u2026" : ""), type: s.type, party: "", amount: miss.length, note: "between " + s.pre + n[i - 1] + s.suf + " and " + s.pre + n[i] + s.suf});
        }
      });
      if (!rows.length) return null;
      return {area: "books", sev: "medium", clause: "rule 46; GSTR-1 table 13", title: "Gaps in sales invoice numbers", problem: rows.reduce((s, r) => s + r.amount, 0) + " numbers missing across " + rows.length + " gaps.",
        impact: "Every number issued is to be accounted for; a missing number is an unrecorded or cancelled invoice.", amount: 0,
        suggestion: "Enter the missing invoices, or mark them cancelled in Tally so GSTR-1 table 13 reports them.", je: null, rows};
    },
    trail(A, V, ctx){
      const after = V.filter(v => v.upd && v.upd > ctx.to), late = V.filter(v => v.upd && (Books.isSale(v) || Books.isPurchase(v)) && A.days(v.date, v.upd) > 60 && v.upd <= ctx.to);
      const out = [];
      if (after.length) out.push({key: "after", total: after.length, area: "books", sev: "medium", clause: "audit trail, rule 3(1)", title: "Entries changed after the period ended",
        problem: after.length + " vouchers of the period were created or altered after " + fmtDate(tallyDate(ctx.to)) + ".", impact: "Returns already filed may no longer agree with the books; for companies, each change has to be traceable in the audit trail.",
        amount: 0, suggestion: "Review each; where a return was filed, check whether an amendment is needed.", je: null,
        rows: after.slice(0, 500).map(v => A.row(v, {amount: 0, note: "changed on " + fmtDate(tallyDate(v.upd)) + (v.by ? " by " + v.by : "")}))});
      if (late.length) out.push({key: "late", total: late.length, area: "books", sev: "low", clause: "", title: "Bills entered more than 60 days after their date", problem: late.length + " sales and purchase entries.",
        impact: "Late entries make monthly returns wrong and are where omissions hide.", amount: 0, suggestion: "Enter bills in the month they belong to.", je: null,
        rows: late.slice(0, 500).map(v => A.row(v, {amount: 0, note: "entered " + fmtDate(tallyDate(v.upd)) + ", " + A.days(v.date, v.upd) + " days later" + (v.by ? " by " + v.by : "")}))});
      const cx = V.filter(v => v.cancel || v.opt);
      if (cx.length) out.push({key: "cancel", area: "books", sev: "low", clause: "", title: "Cancelled or optional vouchers", problem: cx.length + " vouchers.", impact: "They are left out of every return here; make sure that is right.", amount: 0,
        suggestion: "Check that optional vouchers are not real transactions.", je: null, rows: cx.map(v => A.row(v, {amount: 0, note: v.cancel ? "cancelled" : "optional"}))});
      return out;
    },
    odd(A, V){
      const HOL = ["0126", "0815", "1002"], out = [];
      const sun = V.filter(v => (Books.isSale(v) || Books.isPurchase(v) || /RECEIPT|PAYMENT/i.test(v.type)) && (new Date(A.iso(v.date) + "T00:00:00").getDay() === 0 || HOL.includes(v.date.slice(4))));
      if (sun.length > 0) out.push({key: "sunday", area: "books", sev: "low", clause: "", title: "Entries dated on a Sunday or a national holiday", problem: sun.length + " entries.",
        impact: "Usually a wrong date; sometimes a sign of back-dating.", amount: 0, suggestion: "Check the dates against the bills and bank.", je: null,
        rows: sun.slice(0, 300).map(v => A.row(v, {amount: Math.abs((v.ent[0] || {}).a || 0), note: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(A.iso(v.date) + "T00:00:00").getDay()]}))});
      const jr = V.filter(v => /JOURNAL/i.test(v.type)).map(v => ({v, amt: v.ent.filter(e => e.a > 0).reduce((s, e) => s + e.a, 0)}));
      const round = jr.filter(x => x.amt >= 100000 && x.amt % 10000 === 0 && x.v.ent.some(e => A.isExpense(e.l) || A.isIncome(e.l)));
      if (round.length) out.push({key: "round", area: "books", sev: "low", clause: "", title: "Round-sum journal entries of \u20b91 lakh or more", problem: round.length + " journals to income or expense ledgers.",
        impact: "Round figures in journals are often estimates or adjustments that need support.", amount: round.reduce((s, x) => s + x.amt, 0), suggestion: "Keep the working or the document behind each.", je: null,
        rows: round.map(x => A.row(x.v, {amount: x.amt}))});
      const bare = jr.filter(x => x.amt >= 100000 && !String(x.v.narr || "").trim());
      if (bare.length) out.push({key: "narr", area: "books", sev: "low", clause: "", title: "Journals of \u20b91 lakh or more with no narration", problem: bare.length + " journals.", impact: "An auditor cannot tell what they are for.", amount: bare.reduce((s, x) => s + x.amt, 0),
        suggestion: "Add a narration in Tally.", je: null, rows: bare.map(x => A.row(x.v, {amount: x.amt}))});
      return out;
    },
    balances(A, V, ctx){
      if (!ctx.bal.ok) return null;
      const bal = ctx.bal.at(ctx.to), out = [];
      const cr = Object.entries(bal).filter(([l, v]) => A.isCreditor(l) && v < -10000), dr = Object.entries(bal).filter(([l, v]) => A.isDebtor(l) && v > 10000);
      if (cr.length) out.push({key: "crDr", area: "bal", sev: "low", clause: "Schedule III", title: "Suppliers with a debit balance", problem: cr.length + " suppliers owe you money.",
        impact: "In the balance sheet these are advances to suppliers, not a reduction of trade payables.", amount: cr.reduce((s, [, v]) => s - v, 0),
        suggestion: "Confirm the balances; show them under short-term loans and advances.", je: [{date: ctx.to, narr: "Suppliers with debit balances shown as advances", lines: [{l: "ADVANCE TO SUPPLIERS", dr: r2(cr.reduce((s, [, v]) => s - v, 0))}].concat(cr.map(([l, v]) => ({l, cr: r2(-v)})))}],
        rows: cr.map(([l, v]) => ({vid: "", date: ctx.to, no: "", type: "", party: l, amount: -v, note: "debit balance"}))});
      if (dr.length) out.push({key: "drCr", area: "bal", sev: "low", clause: "Schedule III", title: "Customers with a credit balance", problem: dr.length + " customers have paid more than billed.",
        impact: "These are advances from customers \u2014 a liability, and possibly tax on advances for services.", amount: dr.reduce((s, [, v]) => s + v, 0),
        suggestion: "Confirm the balances; show them as advances from customers, and see GST \u2192 Advances.", je: [{date: ctx.to, narr: "Customers with credit balances shown as advances", lines: dr.map(([l, v]) => ({l, dr: r2(v)})).concat([{l: "ADVANCE FROM CUSTOMERS", cr: r2(dr.reduce((s, [, v]) => s + v, 0))}])}],
        rows: dr.map(([l, v]) => ({vid: "", date: ctx.to, no: "", type: "", party: l, amount: v, note: "credit balance"}))});
      const sus = Object.entries(bal).filter(([l, v]) => (A.under(l, /^suspense a\/c$/i) || /SUSPENSE/i.test(l)) && Math.abs(v) >= 1);
      if (sus.length) out.push({key: "suspense", area: "bal", sev: "medium", clause: "", title: "Suspense balances not cleared", problem: sus.length + " suspense ledgers carry a balance.",
        impact: "Unexplained balances are reported by the auditor and can be treated as unexplained income or expense.", amount: sus.reduce((s, [, v]) => s + Math.abs(v), 0),
        suggestion: "Find what each entry is and move it to its proper ledger.", je: null, rows: sus.map(([l, v]) => ({vid: "", date: ctx.to, no: "", type: "", party: l, amount: Math.abs(v), note: v < 0 ? "debit" : "credit"}))});
      const dues = Object.entries(bal).filter(([l, v]) => v > 1 && (A.under(l, /^duties & taxes$/i) || /\b(PF|ESI|EPF|PROFESSIONAL TAX)\b/i.test(l)) && !/INPUT|ELECTRONIC|RECEIVABLE/i.test(l));
      if (dues.length) out.push({key: "43B", area: "bal", sev: "medium", clause: "3CD 26; section 43B", title: "Taxes and statutory dues unpaid at the end of the period", problem: dues.length + " ledgers show amounts payable.",
        impact: "Under section 43B these are allowed only when paid by the due date of the return; employees' PF and ESI only when paid by their own due dates (section 36(1)(va)).", amount: dues.reduce((s, [, v]) => s + v, 0),
        suggestion: "Pay them, and keep the challans for the audit; report the dates in clause 26.", je: null, rows: dues.map(([l, v]) => ({vid: "", date: ctx.to, no: "", type: "", party: l, amount: v, note: "payable"}))});
      return out;
    }
  },
  // the fingerprint of a result: the same books give the same code, every time
  hash(str){ let h = 2166136261; for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).toUpperCase().padStart(8, "0"); },
  itemKey(f, r){ return f.id + "|" + [r.vid || "", r.party || "", r.date || "", r.no || "", r.type || ""].join("|"); },
  // run every check for a period; rules only, so the same books always give the same findings
  run(from, to, how){
    const b = S.books;
    from = this.ymd(from); to = this.ymd(to);
    const V = this.vouchers(from, to).sort((a, c) => a.date.localeCompare(c.date) || String(a.id).localeCompare(String(c.id)));
    const ctx = {from, to, bal: this.balances(from, to)};
    const order = Object.keys(this.checks), findings = [], errors = [], ran = new Set();
    order.forEach((id, k) => {
      try {
        const r = this.checks[id](this, V, ctx);
        ran.add(id);
        [].concat(r || []).filter(Boolean).forEach(f => {
          f.id = id + (f.key ? ":" + f.key : ""); f.check = id; f.order = k; f.amount = r2(f.amount || 0);
          (f.rows || []).forEach(x => { x.key = this.itemKey(f, x); if (x.amount != null) x.amount = r2(x.amount); });
          f.rows = (f.rows || []).sort((a, c) => String(a.date || "").localeCompare(String(c.date || "")) || String(a.no || "").localeCompare(String(c.no || "")) || String(a.party || "").localeCompare(String(c.party || "")) || a.key.localeCompare(c.key));
          f.count = f.total || f.rows.length;
          findings.push(f);
        });
      } catch (e){ errors.push(id + ": " + (e && e.message)); }
    });
    findings.sort((a, c) => this.SEV[c.sev] - this.SEV[a.sev] || a.order - c.order || a.id.localeCompare(c.id));
    const au = b.audit = b.audit || {st: {}, history: []};
    au.items = au.items || {};
    const at = new Date().toISOString(), seen = new Set();
    const prev = au.last ? Object.fromEntries(au.last.findings.map(f => [f.id, f.count])) : {};
    findings.forEach(f => {
      f.isNew = !(f.id in prev); f.more = prev[f.id] != null ? f.count - prev[f.id] : 0;
      f.rows.forEach(r => {
        seen.add(r.key);
        const it = au.items[r.key];
        if (!it) au.items[r.key] = {f: f.id, title: f.title, area: f.area, sev: f.sev, first: at, last: at, from, to, row: {date: r.date, no: r.no, party: r.party, amount: r.amount, note: r.note, type: r.type}};
        else { it.last = at; it.to = to; if (it.solved){ it.reopened = at; delete it.solved; } it.row = {date: r.date, no: r.no, party: r.party, amount: r.amount, note: r.note, type: r.type}; }
      });
      f.rows.splice(1000);
    });
    // an item found before and not found now, in a period this run covers, has been put right
    Object.entries(au.items).forEach(([k, it]) => {
      if (seen.has(k) || it.solved || !ran.has(String(it.f).split(":")[0])) return;
      const d = it.row && it.row.date;
      if (d ? (d >= from && d <= to) : (to >= it.to && from <= it.from)) it.solved = at;
    });
    const solvedBy = {};
    Object.values(au.items).filter(it => it.solved).forEach(it => { (solvedBy[it.f] = solvedBy[it.f] || []).push(it); });
    const run = {at, from, to, how: how || "run now", findings, errors, vouchers: V.length, balances: ctx.bal.ok ? ctx.bal.src : "",
      notes: [ctx.bal.ok ? "" : "Balance checks were not run: " + ctx.bal.why + ".", this.mastersIn() ? "" : "The ledger masters are not read, so ledgers are recognised by name only."].filter(Boolean),
      solved: Object.entries(solvedBy).map(([fid, list]) => ({id: fid, title: list[0].title || fid, area: list[0].area, sev: list[0].sev, n: list.length, amount: r2(list.reduce((s2, it) => s2 + num(it.row && it.row.amount), 0)),
        items: list.sort((a, c) => String(a.solved).localeCompare(String(c.solved)) || String((a.row || {}).date).localeCompare(String((c.row || {}).date))).slice(-300)}))};
    run.code = this.hash(JSON.stringify(findings.map(f => [f.id, f.count, f.amount, f.rows.map(r => r.key + "=" + r.amount)])));
    au.last = run;
    au.history = [{at, from, to, how: run.how, n: findings.length, high: findings.filter(f => f.sev === "high").length, amount: r2(findings.reduce((s2, f) => s2 + f.amount, 0)), code: run.code,
      solved: Object.values(au.items).filter(it => it.solved === at).length}].concat(au.history || []).slice(0, 30);
    return run;
  },
  solvedOf(fid){ const r = (S.books.audit || {}).last; const x = r && (r.solved || []).find(z => z.id === fid); return x || {n: 0, items: [], amount: 0}; },
  titleOf(fid){ const it = Object.values((S.books.audit || {}).items || {}).find(z => z.f === fid); return it ? it.title || fid : fid; },
  finalise(){
    const au = S.books.audit, run = au && au.last;
    if (!run) return null;
    au.final = au.final || {};
    const k = run.from + "-" + run.to;
    au.final[k] = {at: new Date().toISOString(), run: JSON.parse(JSON.stringify(run)), st: JSON.parse(JSON.stringify(au.st || {}))};
    return au.final[k];
  },
  finalFor(from, to){ return ((S.books.audit || {}).final || {})[this.ymd(from) + "-" + this.ymd(to)] || null; },
  due(b){
    const c = this.cfg(b), last = b.audit && b.audit.last ? String(b.audit.last.at).slice(0, 10).replace(/-/g, "") : "";
    if (c.freq === "off" || !(b.vouchers || []).length) return false;
    if (!last) return true;
    const t = this.today();
    if (c.freq === "daily") return last < t;
    if (c.freq === "weekly") return this.days(last, t) >= 7;
    if (c.freq === "monthly") return last.slice(0, 6) < t.slice(0, 6);
    return false;
  },
  defaultRange(b){
    const to = String((b.meta || {}).to || this.today()), t = this.today();
    const end = to < t ? to : t;
    return {from: this.fyStart(end), to: end};
  },
  maybeRun(){
    const b = S.books;
    if (!b || !b.vouchers || !this.due(b)) return;
    const r = this.defaultRange(b), run = this.run(r.from, r.to, "on its own (" + this.cfg(b).freq + ")");
    saveBooks();
    const hi = run.findings.filter(f => f.sev === "high").length;
    toast("Audit ran on its own: " + run.findings.length + " findings" + (hi ? ", " + hi + " serious" : "") + ". See Audit.");
  },
  status(id){ const st = ((S.books.audit || {}).st || {})[id]; return st || {s: "open"}; },
  // the journal entries marked to pass, as a file Tally imports
  jeXml(list){
    const co = (S.books.meta || {}).company || CO().name;
    let x = '<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>' + xesc(co) + "</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>\n";
    list.forEach(j => {
      x += '<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>' + this.ymd(j.date) + "</DATE><EFFECTIVEDATE>" + this.ymd(j.date) + "</EFFECTIVEDATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><NARRATION>" + xesc(j.narr) + "</NARRATION>\n";
      j.lines.forEach(l => {
        const dr = num(l.dr), cr = num(l.cr);
        x += "<ALLLEDGERENTRIES.LIST><LEDGERNAME>" + xesc(l.l) + "</LEDGERNAME><ISDEEMEDPOSITIVE>" + (dr ? "Yes" : "No") + "</ISDEEMEDPOSITIVE><AMOUNT>" + (dr ? "-" + dr.toFixed(2) : cr.toFixed(2)) + "</AMOUNT></ALLLEDGERENTRIES.LIST>\n";
      });
      x += "</VOUCHER></TALLYMESSAGE>\n";
    });
    return x + "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>";
  },
  jesToPass(run){ return run.findings.filter(f => f.je && this.status(f.id).s === "pass").flatMap(f => f.je); },
  missingLedgers(jes){ return Array.from(new Set(jes.flatMap(j => j.lines.map(l => l.l)).filter(l => !this.exists(l)))); },
  // the report: a cover, a summary by area, then each finding with what to do
  reportHtml(run, stSnap){
    const co = CO(), b = S.books, m = v => INR.format(r2(v || 0)), st = id => (stSnap ? stSnap[id] : null) || this.status(id);
    const sevL = {high: "High", medium: "Medium", low: "Low"}, sevC = {high: "#B42318", medium: "#B9541B", low: "#5A6B63"};
    let h = '<div style="border-bottom:2px solid #15201B;padding-bottom:10px;margin-bottom:14px"><div style="font-size:12px;color:#5A6B63">AUDIT OBSERVATIONS</div><h1 style="font-size:22px;margin:4px 0">' + esc(co.name) + "</h1>" +
      '<div style="font-size:13px">' + esc(((b.meta || {}).gstins || []).join(", ")) + (co.pan ? " \u00b7 PAN " + esc(co.pan) : "") + "</div>" +
      '<div style="font-size:13px;margin-top:6px">Period: <b>' + fmtDate(tallyDate(run.from)) + " to " + fmtDate(tallyDate(run.to)) + "</b> \u00b7 Checked on " + fmtDate(run.at.slice(0, 10)) + " \u00b7 " + run.vouchers + " vouchers read from Tally" +
      (b.meta && b.meta.company ? " (" + esc(b.meta.company) + ")" : "") + "</div></div>";
    h += "<h2>Summary</h2><table><thead><tr><th>Area</th><th>High</th><th>Medium</th><th>Low</th><th class=\"n\">Amount involved, high and medium</th></tr></thead><tbody>" +
      this.AREAS.map(([a, l]) => { const f = run.findings.filter(x => x.area === a); if (!f.length) return ""; return "<tr><td>" + l + "</td><td>" + f.filter(x => x.sev === "high").length + "</td><td>" + f.filter(x => x.sev === "medium").length + "</td><td>" + f.filter(x => x.sev === "low").length + '</td><td class="n">' + m(f.filter(x => x.sev !== "low").reduce((s, x) => s + x.amount, 0)) + "</td></tr>"; }).join("") +
      "</tbody></table>";
    if (run.notes.length) h += '<p class="note">' + run.notes.map(esc).join(" ") + "</p>";
    h += "<h2>Observations</h2>";
    run.findings.forEach((f, i) => {
      const s = st(f.id);
      h += '<div style="border:1px solid #D9E0DC;border-left:4px solid ' + sevC[f.sev] + ';padding:10px 12px;margin:0 0 12px">' +
        '<div style="font-size:11px;color:' + sevC[f.sev] + ';font-weight:700">' + (i + 1) + ". " + sevL[f.sev].toUpperCase() + " \u00b7 " + esc((this.AREAS.find(a => a[0] === f.area) || [])[1] || "") + (f.clause ? " \u00b7 " + esc(f.clause) : "") + "</div>" +
        '<div style="font-size:15px;font-weight:700;margin:3px 0 6px;page-break-after:avoid">' + esc(f.title) + "</div>" +
        "<p><b>Observation.</b> " + esc(f.problem) + (f.amount ? " Amount involved: \u20b9" + m(f.amount) + "." : "") + "</p>" +
        "<p><b>Effect.</b> " + esc(f.impact) + "</p><p><b>Recommendation.</b> " + esc(f.suggestion) + "</p>" +
        (f.je && f.je.length ? "<p><b>Suggested entr" + (f.je.length === 1 ? "y" : "ies") + ".</b></p><table><thead><tr><th>Date</th><th>Ledger</th><th class=\"n\">Debit</th><th class=\"n\">Credit</th></tr></thead><tbody>" +
          f.je.slice(0, 12).map(j => j.lines.map((l, k) => "<tr><td>" + (k ? "" : fmtDate(tallyDate(j.date))) + "</td><td>" + (l.cr ? "&nbsp;&nbsp;&nbsp;To " : "") + esc(l.l) + (this.exists(l.l) ? "" : " <i>(create)</i>") + '</td><td class="n">' + (l.dr ? m(l.dr) : "") + '</td><td class="n">' + (l.cr ? m(l.cr) : "") + "</td></tr>").join("") +
            '<tr><td></td><td colspan="3" style="color:#5A6B63;font-size:11px">(' + esc(j.narr) + ")</td></tr>").join("") + "</tbody></table>" + (f.je.length > 12 ? '<p class="note">' + (f.je.length - 12) + " more entries in the Excel.</p>" : "") : "") +
        (this.solvedOf(f.id).n ? "<p><b>Put right since first found.</b> " + this.solvedOf(f.id).n + " item" + (this.solvedOf(f.id).n === 1 ? "" : "s") + "; " + f.count + " still open.</p>" : "") +
        "<p><b>Management response.</b> " + esc((this.STATUS.find(x => x[0] === s.s) || [])[1] || "Open") + (s.note ? ": " + esc(s.note) : "") + "</p>" +
        (f.rows && f.rows.length ? '<table><thead><tr><th>Date</th><th>Voucher</th><th>Party or ledger</th><th class="n">Amount</th><th>Detail</th></tr></thead><tbody>' +
          f.rows.slice(0, 15).map(r => "<tr><td>" + (r.date ? fmtDate(tallyDate(r.date)) : "") + "</td><td>" + esc(r.no || "") + (r.type ? '<br><span style="color:#5A6B63">' + esc(r.type) + "</span>" : "") + "</td><td>" + esc(r.party || "") + '</td><td class="n">' + (r.amount ? m(r.amount) : "") + "</td><td>" + esc(r.note || "") + "</td></tr>").join("") +
          "</tbody></table>" + (f.rows.length > 15 ? '<p class="note">Showing 15 of ' + f.rows.length + "; all are in the Excel annexure.</p>" : "") : "") + "</div>";
    });
    const done = (run.solved || []).filter(x => x.n);
    if (done.length){
      h += "<h2>Put right</h2><p class=\"note\">Found in an earlier run and no longer in the books when checked again.</p><table><thead><tr><th>Observation</th><th>Item</th><th>Date</th><th class=\"n\">Amount</th><th>Put right by</th></tr></thead><tbody>" +
        done.flatMap(x => x.items.slice(-40).map(it => "<tr><td>" + esc(x.title) + "</td><td>" + esc([(it.row || {}).no, (it.row || {}).party].filter(Boolean).join(" \u00b7 ")) + "</td><td>" + ((it.row || {}).date ? fmtDate(tallyDate(it.row.date)) : "") +
          '</td><td class="n">' + ((it.row || {}).amount ? m(it.row.amount) : "") + "</td><td>" + fmtDate(String(it.solved).slice(0, 10)) + "</td></tr>")).join("") + "</tbody></table>";
    }
    h += '<p class="note" style="margin-top:18px">Result code ' + esc(run.code || "") + ": the same books give the same code. Rules only; nothing in this report is guessed by a machine." + (run.balances ? " Balances: " + esc(run.balances) + "." : "") + "</p>";
    h += '<p class="note" style="margin-top:6px">Prepared from the books in Tally by ' + esc(co.firm || "Garg Shekhar & Company") + ". These are observations for review; each is to be confirmed against the documents before any adjustment is made.</p>";
    return h;
  },
  async toExcel(run){
    await ensureXlsx();
    const d = s => s && String(s).length === 8 ? String(s).slice(6, 8) + "-" + String(s).slice(4, 6) + "-" + String(s).slice(0, 4) : s || "";
    const wb = XLSX.utils.book_new(), add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));
    add("Observations", [["#", "Severity", "Area", "Clause", "Observation", "Items", "Amount", "Effect", "Recommendation", "Status", "Note"]].concat(run.findings.map((f, i) =>
      [i + 1, f.sev, (this.AREAS.find(a => a[0] === f.area) || [])[1], f.clause, f.title + ": " + f.problem, f.count, r2(f.amount), f.impact, f.suggestion, (this.STATUS.find(x => x[0] === this.status(f.id).s) || [])[1], this.status(f.id).note || ""])));
    add("Annexure", [["#", "Observation", "Date", "Voucher", "Type", "Party or ledger", "Amount", "Detail"]].concat(run.findings.flatMap((f, i) => (f.rows || []).map(r => [i + 1, f.title, d(r.date), r.no, r.type, r.party, r2(r.amount || 0), r.note || ""]))));
    add("Journal entries", [["#", "Observation", "Date", "Ledger", "Debit", "Credit", "Narration", "Ledger in Tally"]].concat(run.findings.flatMap((f, i) => (f.je || []).flatMap(j => j.lines.map((l, k) =>
      [i + 1, f.title, k ? "" : d(j.date), l.l, l.dr || "", l.cr || "", k ? "" : j.narr, this.exists(l.l) ? "yes" : "to create"])))));
    const out = XLSX.write(wb, {bookType: "xlsx", type: "array"});
    saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-audit-" + run.from + "-" + run.to + ".xlsx", new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  }
};

