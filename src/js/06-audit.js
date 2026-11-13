/* ================================================================== */
/* Audit: checks run on the books, each with the problem, what it     */
/* costs, what to do, and the journal entry when one is needed        */
/* ================================================================== */
// Audit's part the GSTR-3B engine runs is in server/_shared/gst3b.js (shared with the gst-run function); the rest is put on it here
Object.assign(Audit, {
  AREAS: [["cash", "Cash and loans"], ["tds", "TDS"], ["gst", "GST"], ["books", "Books and audit trail"], ["bal", "Balances"]],
  SEV: {high: 3, medium: 2, low: 1},
  STATUS: [["open", "Open"], ["explained", "Explained"], ["pass", "Entry to pass"], ["passed", "Entry passed"], ["no", "Not an issue"]],
  cfg(b){ return Object.assign({freq: "daily"}, (b && b.auditCfg) || {}); },
  ymd(d){ return String(d || "").replace(/-/g, "").slice(0, 8); },
  iso(d){ d = this.ymd(d); return d.length === 8 ? d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8) : ""; },
  days(a, c){ const f = s => new Date(this.iso(s) + "T00:00:00").getTime(); return Math.round((f(c) - f(a)) / 86400000); },
  today(){ const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); },
  fyStart(d){ d = this.ymd(d); const y = num(d.slice(0, 4)), m = num(d.slice(4, 6)); return String(m >= 4 ? y : y - 1) + "0401"; },
  isCash(l){ const m = Books.ledgerOf(l); return this.under(l, /^cash-in-hand$/i) || (!this.path(l).length && m.kind === "bank" && /\bCASH\b/i.test(l)); },
  isBankL(l){ return this.under(l, /^bank (accounts|od a\/c|occ a\/c)$/i) || (Books.ledgerOf(l).kind === "bank" && !this.isCash(l)); },
  isLoan(l){ return this.under(l, /^(loans \(liability\)|secured loans|unsecured loans)$/i) || (!this.path(l).length && /\bLOAN\b/i.test(l)); },
  isCapital(l){ return this.under(l, /^capital account$/i); },
  isDuties(l){ return this.under(l, /^duties & taxes$/i) || !!Books.ledgerOf(l).kind && Books.ledgerOf(l).kind !== "bank" && Books.ledgerOf(l).kind !== "roundoff"; },
  isCreditor(l){ return this.under(l, /^sundry creditors$/i); },
  isDebtor(l){ return this.under(l, /^sundry debtors$/i); },
  isExpense(l){ return this.under(l, /^(indirect expenses|direct expenses)$/i) || (!this.path(l).length && !Books.ledgerOf(l).kind && /EXP|CHARGES|RENT|SALARY|WAGES|FEES|REPAIR|FREIGHT|CARTAGE|TRAVEL|CONVEYANCE|COMMISSION|ADVERT/i.test(l)); },
  // the name rules: an expense ledger's TDS provision, and credit usually blocked under section 17(5)
  TDS_KEY: [[/RENT/i, "rent_building"], [/LEGAL|AUDIT|PROFESSIONAL|PROFF|CONSULT|ADVOCATE|RETAINER/i, "professional"], [/TECHNICAL/i, "technical"],
    [/COMMISSION|BROKERAGE/i, "commission"], [/CONTRACT|LABOUR|JOB\s*WORK|MANPOWER|TRANSPORT|FREIGHT|CARTAGE|REPAIR|MAINTENANCE|ADVERT|PRINTING|CATERING|SECURITY|HOUSEKEEPING/i, "contractor"],
    [/INTEREST/i, "interest"]],
  // payments that are not under TDS by their nature (goods, salary under 24Q, taxes, utilities, bank charges, depreciation)
  NO_TDS_RE: /\b(SALARY|SALARIES|WAGES|BONUS|STIPEND|GRATUITY|GST|IGST|CGST|SGST|TAXES?|DUTY|DUTIES|BANK CHARGES|DEPRECIATION|ROUND(ING)? ?OFF|DISCOUNT|ELECTRICITY|POWER|WATER|TELEPHONE|MOBILE|INTERNET|POSTAGE|STATIONERY|INSURANCE|PETROL|DIESEL|FUEL|FOREX|EXCHANGE)\b/i,
  BLOCKED_RE: /\b(FOOD|MEAL|CATERING|CANTEEN|STAFF WELFARE|REFRESHMENT|CLUB|MEMBERSHIP|HEALTH|MEDICAL|LIFE INSURANCE|MOTOR CAR|CAR HIRE|VEHICLE|BEAUTY|GYM|GIFT|HOLIDAY)\b/i,
  isFixed(l){ return this.under(l, /^fixed assets$/i); },
  isIncome(l){ return this.under(l, /^(sales accounts|direct incomes|indirect incomes)$/i); },
  // next-speed0 (09-Nov-2026, a 40,000-entry book with 6,787 ledgers: 84 s of the first open were spent here): TDS.billParty
  // asks once per entry and the checks once per line, and counting every ledger name each time made it ledgers x entries.
  // Now a "yes" is kept for the list of groups it was counted on (S.books.under itself: another client's books, or books
  // read again, hold another list) until the next save of the books (BOOKS_REV); a "no" is never kept (an empty list costs
  // nothing to count), so masters read in a moment ago are seen at the very next ask. tests/run_speed0.js
  _in: new WeakMap(),
  mastersIn(){
    const u = S.books.under;
    if (!u || typeof u !== "object") return Object.keys(u || {}).length > 0;
    const rev = typeof BOOKS_REV === "number" ? BOOKS_REV : 0;
    if (this._in.get(u) === rev) return true;
    const yes = Object.keys(u).length > 0;
    if (yes) this._in.set(u, rev);
    return yes;
  },
  // balances need the opening balances and every voucher since the books began
  // balances at any date in the period: from Tally's own balances when the bridge has read them,
  // else from the opening balances in the masters, when the day book starts where the books begin
  // next-speed-pages (11-Nov-2026, 51,758 entries: Tie-out 1.4 s in one task, 13 s on an office PC): each balance on a
  // date read every entry of the books again (the tie-out asks for three balances at each of 25 month-ends). Where the
  // entries are in date order (as the books keep them), a balance is the one at an earlier date kept on the way, carried
  // on over the entries after it: the same entries, in the same order, added the same way (to the paisa at each step),
  // so the same figures and the same order of ledgers as reading them all. Kept per list of entries while it, each entry in it,
  // the books, the save of the books (BOOKS_REV), the start and the opening balances (their contents) are the same; not in
  // date order, or a date that is no text: read in full as before. Each answer is a copy (a caller may change it)
  _mv: new WeakMap(),
  moveKept(b, base, sig, start, d){
    const V = b.vouchers, rev = typeof BOOKS_REV === "number" ? BOOKS_REV : 0;
    if (typeof start !== "string" || typeof d !== "string" || !Array.isArray(V)) return null;
    const n = V.length;
    let c = this._mv.get(V);
    if (!c || c.n !== n || c.rev !== rev || c.b !== b || !c.vs.every((v, i) => v === V[i])){
      let ok = true;
      for (let i = 0; i < n && ok; i++){ const t = V[i] && V[i].date; ok = typeof t === "string" && !(i && V[i - 1].date > t); }
      this._mv.set(V, c = {n, rev, b, ok, sets: {}, cps: 0, vs: V.slice()});
    }
    if (!c.ok) return null;
    const first = f => { let lo = 0, hi = n; while (lo < hi){ const m = (lo + hi) >> 1; if (f(V[m].date)) hi = m; else lo = m + 1; } return lo; };
    const k = start + "\u0001" + sig, set = c.sets[k] = c.sets[k] || [{i: first(t => !(t < start)), bal: Object.assign({}, base)}];
    const e = Math.max(set[0].i, first(t => t > d));
    let cp = set[0];
    set.forEach(x => { if (x.i <= e && x.i > cp.i) cp = x; });
    const bal = Object.assign({}, cp.bal), keep = i => { if (c.cps < 60 && !set.some(x => x.i === i)){ set.push({i, bal: Object.assign({}, bal)}); c.cps++; } };
    for (let i = cp.i; i < e; i++){
      const v = V[i];
      if (i > cp.i && v.date.slice(0, 6) !== V[i - 1].date.slice(0, 6)) keep(i);
      if (!v.opt && !v.cancel) v.ent.forEach(z => { bal[z.l] = r2((bal[z.l] || 0) + z.a); });
    }
    keep(e);
    return bal;
  },
  balances(from, to){
    const b = S.books, tb = b.tb;
    let sigOf = null;
    // next-split-years: a client whose books join an earlier-years company (app/src/lib/splitBooks.js) and whose current
    // company's openings differ from what the earlier one carries: those differences from the current company's first day
    // (tb.step), so its years show its own openings. No step (every other client): as before
    const step = tb && tb.step && tb.step.led ? tb.step : null;
    const stepAt = (bal, start, d) => { if (!step || !(start < step.from) || !(d >= step.from)) return bal; const o = Object.assign({}, bal); Object.entries(step.led).forEach(([n, x]) => { o[n] = r2((o[n] || 0) + num(x)); }); return o; };
    const move = (base, start, d) => {
      if (!sigOf || sigOf.base !== base){ let s = null; try { s = JSON.stringify(base); } catch (e){} sigOf = {base, s}; }
      const kept = sigOf.s === null ? null : Audit.moveKept(b, base, sigOf.s, start, d);
      if (kept) return stepAt(kept, start, d);
      const bal = Object.assign({}, base);
      (b.vouchers || []).forEach(v => { if (v.date < start || v.date > d || v.opt || v.cancel) return; v.ent.forEach(e => { bal[e.l] = r2((bal[e.l] || 0) + e.a); }); });
      return stepAt(bal, start, d);
    };
    // the year in progress (staging, 11-Nov-2026: books from this 1 April showed no balance sheet): a balance as on a day
    // still to come is the one to date, so balances kept to today answer for a period ending later (the entries up to
    // each day are added as ever, a post-dated one too)
    const today = this.today(), upTo = to > today ? today : to;
    if (tb && tb.from <= from && tb.to >= upTo){
      const open = {}; Object.entries(tb.led || {}).forEach(([n, x]) => { open[n] = num(x.open); });
      // the openings from FinCom's copy (FinCom Bridge 2.1.4 asks Tally for no balance), or a trial balance file
      return {ok: true, src: (tb.src === "copy" ? "the opening balances in FinCom's copy, read on " : "Tally's balances read on ") + fmtDate(String(tb.at).slice(0, 10)), at: d => move(open, tb.from, d)};
    }
    const info = b.ledInfo || {}, starts = Object.values(info).map(x => x.from).filter(Boolean).sort();
    if (!Object.values(info).some(x => x.ob != null)) return {ok: false, why: "the ledger balances are not read yet; they come with FinCom's copy of the books, or bring in the ledger masters"};
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
    cash40A3(A, V, ctx){ return Audit.drain(Audit.checkSteps.cash40A3(A, V, ctx)); },
    cashLoans(A, V){ return Audit.drain(Audit.checkSteps.cashLoans(A, V)); },
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
    cashNegative(A, V, ctx){ return Audit.drain(Audit.checkSteps.cashNegative(A, V, ctx)); },
    // round 69 (the owner, 16-Oct-2026: "Should have deducted" belongs in the audit): one TDS answer. The parties past a TDS
    // limit with no TDS to cover it are TDSWatch.missed (src/js/66), the TDS page's own list, for each financial year the
    // period touches: a finding per party, section and year (its id stays the same run to run), the TDS due its amount,
    // the credits that count its entries. This check had its own working before, and differed from the TDS page (the rate
    // without a PAN, the 194C bill limit, two years in one line).
    tdsMissed(A, V, ctx){
      if (typeof TDSWatch !== "object") return null;
      const y0 = num(TDS.fyOf(ctx.from).slice(0, 4)), y1 = num(TDS.fyOf(ctx.to).slice(0, 4)), out = [], m = v => "\u20b9" + INR.format(r2(v || 0));
      for (let y = y0; y <= y1; y++){
        const fy = y + "-" + String(y + 1).slice(2);
        TDSWatch.missed(fy).forEach(e => {
          const foreign = /\b(INC|LLC|GMBH|PTE|PTY|IRELAND|SINGAPORE|USA|UK|B\.?V|AG|SARL)\b/i.test(e.party) && !(S.books.gstins || {})[e.party];
          const led = (e.ledgers || []).join(", "), tl = A.tdsLedger(e.section) || "TDS PAYABLE " + e.section;
          out.push({key: e.party + "|" + e.section + "|" + fy, party: e.party, section: e.section, fy, base: e.uncovered, area: "tds", sev: e.due >= 10000 ? "high" : "medium",
            clause: "3CD 21(b), 34(a); section 40(a)(ia)", title: e.section + (e.short ? " short deducted: " : " not deducted: ") + e.party + ", " + fy,
            // the owner, 19-Oct-2026: TDS booked in an entry of its own for the bill counts (TDSSep, src/js/66); booked short of
            // the rate, only the short amount is said
            problem: (e.short ? "TDS booked separately for the bill is short of the " + e.rate + "% that applies: short deducted " + m(e.due) + ". " : "") +
              "Paid " + m(e.credited) + " in " + fy + " (" + led + "), past the " + e.limitWords + " limit; not covered by TDS " + m(e.uncovered) + "." + (e.pan ? "" : " No PAN in Tally."),
            impact: "30% of " + m(e.uncovered) + " (" + m(e.disallow) + ") is disallowed under section 40(a)(ia) until the TDS is paid; interest under section 201(1A) runs on the TDS (about " + m(e.interest) + " to today).",
            suggestion: (foreign ? "Looks non-resident: check section 195 or the equalisation levy first. " : "") + "Deduct TDS at " + e.rate + "% (" + m(e.due) + ") from the next payment, and deposit it with interest; then file the correction statement." +
              (e.pan ? "" : " Get the PAN: without it the rate is 20%."),
            amount: e.due, je: foreign ? null : [{date: ctx.to, narr: "TDS under section " + e.section + (e.short ? " short deducted on " : " not deducted on ") + led + " for " + fy, lines: [{l: e.party, dr: e.due}, {l: tl, cr: e.due}]}],
            rows: e.credits.filter(c => c.counts !== false).map(c => ({vid: c.vid || "", date: c.date, no: c.voucher || "", type: e.section, party: e.party, amount: c.amount,
              note: "booked to " + (c.ledger || led) + "; " + e.section + " at " + e.rate + "%" + (e.pan ? "" : " (no PAN)")}))});
        });
      }
      return out;
    },
    tdsLate(A, V, ctx){
      const fy = TDS.fyOf(ctx.to), rows = [];
      // paid late (the deductions not yet paid, TDS.interest's "unpaid" lines since tds-layout, are the audit's tdsUnpaid)
      ["Q1", "Q2", "Q3", "Q4"].forEach(q => TDS.interest(fy, q).filter(x => x.kind !== "unpaid").forEach(x => rows.push({vid: "", date: x.row.date, no: x.row.voucher || "", type: "", party: x.row.party,
        amount: x.amount, note: x.kind === "deduct" ? "TDS " + A.money(x.row.tds) + " deducted on " + fmtDate(tallyDate(x.row.date)) + " for the bill of " + fmtDate(tallyDate(x.from)) + ", " + x.months + " months at 1%"
          : "TDS " + A.money(x.row.tds) + " due " + fmtDate(tallyDate(x.due)) + ", paid " + fmtDate(tallyDate(x.challan.date)) + ", " + x.months + " months"})));
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
        problem: rows.length + " deductions of \u20b9" + INR.format(r2(amt)) + (TDS.challans().length ? " are not against any challan." : "; no challans are entered in FinCom yet."),
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
      const RE = A.BLOCKED_RE;
      const rows = [], je = [];
      V.forEach(v => {
        if (Books.isSale(v)) return;
        // a verdict accepted from AI help decides; otherwise the ledger's name
        const hit = l => { const ai = typeof AIH === "object" ? AIH.blocked(l) : undefined; return ai === undefined ? RE.test(l) : ai; };
        const exp = v.ent.find(e => e.a < 0 && hit(e.l) && (A.isExpense(e.l) || A.isFixed(e.l) || A.under(e.l, /^purchase accounts$/i) || !A.mastersIn()));
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
    gstRule37(A, V, ctx){ return Audit.drain(Audit.checkSteps.gstRule37(A, V, ctx)); },
    gst2b(A, V, ctx){
      if (!Object.keys(S.books.twoBs || {}).length) return null;
      const months = []; for (let m = ctx.from.slice(0, 6); m <= ctx.to.slice(0, 6); m = String(num(m.slice(4)) === 12 ? num(m.slice(0, 4)) + 1 + "01" : m.slice(0, 4) + String(num(m.slice(4)) + 1).padStart(2, "0"))) months.push(m);
      const rows = [];
      ((S.books.meta || {}).gstins || [""]).forEach(g => { const sc = GST2B.scope(g.slice(0, 2), months), noY = new Set(sc.noYear || []);
        // (review of aba40df57, L3: a bill of a year with no 2B here is listed, "2B not brought in")
        (sc.unmatched || sc.onlyBooks).forEach(d => rows.push({vid: d.id, date: d.date, no: d.no, type: d.type, party: d.party, amount: r2(d.igst + d.cgst + d.sgst + d.cess) * d.dir, note: noY.has(d) ? "2B not brought in" : d.gstin ? "not in 2B" : "no GSTIN in Tally"})); });
      if (!rows.length) return null;
      return {area: "gst", sev: "medium", clause: "section 16(2)(aa); rule 36(4)", title: "Credit in the books that is not in GSTR-2B", problem: rows.length + " documents.",
        impact: "Credit can be taken only when the supplier reports the invoice; what is not in 2B by the 30 November after the year is lost.", amount: rows.reduce((s, r) => s + r.amount, 0),
        suggestion: "Follow up with the suppliers (a note can be copied from the 2B reconciliation, supplier by supplier), and do not claim these in 3B until they appear.", je: null, rows};
    },
    gstr1(A, V, ctx){
      const rows = [];
      GSTAmend.filed().filter(f => !f.notFiled && f.ym >= ctx.from.slice(0, 6) && f.ym <= ctx.to.slice(0, 6)).forEach(f => {
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
    duplicates(A, V){ return Audit.drain(Audit.checkSteps.duplicates(A, V)); },
    gaps(A, V){ return Audit.drain(Audit.checkSteps.gaps(A, V)); },
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
    odd(A, V){ return Audit.drain(Audit.checkSteps.odd(A, V)); },
    balances(A, V, ctx){ return Audit.drain(Audit.checkSteps.balances(A, V, ctx)); }
  },
  // next-audit-steps: the checks that read every entry of the year, in steps (each: Audit.each, 4,000 entries a step);
  // Audit.checks has each of them worked out at once (the same answer), for whoever asks a check by itself
  checkSteps: {
    *cash40A3(A, V, ctx){
      const byDay = {};
      yield* Audit.each(V, v => {
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
    *cashLoans(A, V){
      const taken = [], repaid = [];
      yield* Audit.each(V, v => {
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
    *cashNegative(A, V, ctx){
      if (!ctx.bal.ok) return null;
      const cash = Array.from(new Set(Object.keys(S.books.ledInfo || {}).concat(Object.keys((S.books.tb || {}).led || {})))).filter(l => A.isCash(l)).sort();
      if (!cash.length) return null;
      const start = ctx.bal.at(A.dayBefore(ctx.from)), bal = {}; cash.forEach(l => { bal[l] = num(start[l]); });
      const rows = [];
      yield;
      const all = (S.books.vouchers || []).filter(v => v.date >= ctx.from && v.date <= ctx.to && !v.opt && !v.cancel).sort((a, c) => a.date.localeCompare(c.date) || String(a.no).localeCompare(String(c.no)));
      let day = "";
      const close = () => { if (day >= ctx.from) cash.forEach(l => { if (bal[l] > 1) rows.push({vid: "", date: day, no: "", type: "", party: l, amount: bal[l], note: "cash balance at the end of the day: " + A.money(-bal[l])}); }); };
      yield;
      yield* Audit.each(all, v => { if (v.date !== day){ if (day) close(); day = v.date; } v.ent.forEach(e => { if (bal[e.l] != null) bal[e.l] = r2(bal[e.l] + e.a); }); });
      if (day) close();
      if (!rows.length) return null;
      return {area: "cash", sev: "high", title: "Cash in hand below zero", clause: "books of account", problem: rows.length + " days on which the cash book closed in credit.",
        impact: "Cash cannot be negative: entries are missing, dated wrongly, or the cash is not real. Auditors report this, and it can lead to additions as unexplained money.",
        amount: Math.max.apply(null, rows.map(r => r.amount)), suggestion: "Find the receipts or withdrawals that were not entered, or correct the dates.", je: null, rows: rows.slice(0, 300)};
    },
    *gstRule37(A, V, ctx){
      const bills = {};
      yield* Audit.each((S.books.vouchers || []).filter(v => v.date <= ctx.to && !v.opt && !v.cancel), v => v.ent.forEach(e => (e.b || []).forEach(([name, type, amt]) => {
        if (!name) return;
        const k = e.l + "|" + name, x = bills[k] = bills[k] || {party: e.l, ref: name, billed: 0, paid: 0, v: null, tax: []};
        if (type === "New Ref" && amt > 0 && Books.isPurchase(v)){ x.billed = r2(x.billed + amt); x.v = v; x.tax = v.ent.filter(z => { const m = Books.ledgerOf(z.l); return z.a < 0 && (m.kind === "gst" || m.kind === "gst_common") && m.side === "input"; }); }
        else if (amt < 0) x.paid = r2(x.paid - amt);
      })));
      const rows = [], je = [];
      yield* Audit.each(Object.values(bills), x => {
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
    *duplicates(A, V){
      const by = {}, near = {};
      yield* Audit.each(V, v => {
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
      yield;
      yield* Audit.each(Object.values(near), l => {
        if (l.length < 2) return;
        l.sort((a, c) => a.date.localeCompare(c.date));
        for (let i = 1; i < l.length; i++) if (A.days(l[i - 1].date, l[i].date) <= 3 && GST2B.normNo(l[i].ref) !== GST2B.normNo(l[i - 1].ref) && l[i].ent.find(e => e.a > 0).a >= 5000)
          rows2.push(A.row(l[i], {amount: l[i].ent.find(e => e.a > 0).a, note: "same party and amount as voucher " + l[i - 1].no + " of " + fmtDate(tallyDate(l[i - 1].date))}));
      });
      if (rows2.length) out.push({key: "dupNear", area: "books", sev: "low", clause: "", title: "Same party and amount within three days", problem: rows2.length + " entries look like repeats under a different bill number.",
        impact: "If they are repeats, expense and credit are overstated.", amount: rows2.reduce((s, r) => s + r.amount, 0), suggestion: "Check the bills; most will be genuine, but repeats show up here first.", je: null, rows: rows2});
      return out;
    },
    *gaps(A, V){
      const series = {};
      yield* Audit.each(V, v => {
        if (!Books.isSale(v) || /CREDIT/i.test(v.type)) return;
        const m = String(v.no).match(/^(.*?)(\d+)(\D*)$/);
        if (!m) return;
        const k = GSTR.regOf(v) + "|" + m[1] + "|" + m[3] + "|" + v.type;
        (series[k] = series[k] || {pre: m[1], suf: m[3], nums: new Set(), type: v.type, reg: GSTR.regOf(v)}).nums.add(num(m[2]));
      });
      const rows = [];
      yield;
      yield* Audit.each(Object.values(series), s => {
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
    *odd(A, V){
      const HOL = ["0126", "0815", "1002"], out = [];
      const sun = V.filter(v => (Books.isSale(v) || Books.isPurchase(v) || /RECEIPT|PAYMENT/i.test(v.type)) && (new Date(A.iso(v.date) + "T00:00:00").getDay() === 0 || HOL.includes(v.date.slice(4))));
      if (sun.length > 0) out.push({key: "sunday", area: "books", sev: "low", clause: "", title: "Entries dated on a Sunday or a national holiday", problem: sun.length + " entries.",
        impact: "Usually a wrong date; sometimes a sign of back-dating.", amount: 0, suggestion: "Check the dates against the bills and bank.", je: null,
        rows: sun.slice(0, 300).map(v => A.row(v, {amount: Math.abs((v.ent[0] || {}).a || 0), note: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(A.iso(v.date) + "T00:00:00").getDay()]}))});
      yield;
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
    *balances(A, V, ctx){
      if (!ctx.bal.ok) return null;
      const bal = ctx.bal.at(ctx.to), out = [], P = Parties.position(ctx.to);
      // every supplier in debit and customer in credit, as Parties.position counts them (review of 02-Oct-2026: only those
      // above Rs 10,000 were counted, so the audit's totals differed from MIS and Reports)
      yield;
      const cr = Object.entries(bal).filter(([l, v]) => A.isCreditor(l) && v < -0.5), dr = Object.entries(bal).filter(([l, v]) => A.isDebtor(l) && v > 0.5);
      if (cr.length) out.push({key: "crDr", area: "bal", sev: "low", clause: "Schedule III", title: "Suppliers with a debit balance", problem: cr.length + " suppliers owe you money.",
        impact: "In the balance sheet these are advances to suppliers, not a reduction of trade payables.", amount: P.ok ? P.supAdv : cr.reduce((s, [, v]) => s - v, 0),
        suggestion: "Confirm the balances; show them under short-term loans and advances.", je: [{date: ctx.to, narr: "Suppliers with debit balances shown as advances", lines: [{l: "ADVANCE TO SUPPLIERS", dr: r2(cr.reduce((s, [, v]) => s - v, 0))}].concat(cr.map(([l, v]) => ({l, cr: r2(-v)})))}],
        rows: cr.map(([l, v]) => ({vid: "", date: ctx.to, no: "", type: "", party: l, amount: -v, note: "debit balance"}))});
      if (dr.length) out.push({key: "drCr", area: "bal", sev: "low", clause: "Schedule III", title: "Customers with a credit balance", problem: dr.length + " customers have paid more than billed.",
        impact: "These are advances from customers \u2014 a liability, and possibly tax on advances for services.", amount: P.ok ? P.custAdv : dr.reduce((s, [, v]) => s + v, 0),
        suggestion: "Confirm the balances; show them as advances from customers, and see GST \u2192 Advances.", je: [{date: ctx.to, narr: "Customers with credit balances shown as advances", lines: dr.map(([l, v]) => ({l, dr: r2(v)})).concat([{l: "ADVANCE FROM CUSTOMERS", cr: r2(dr.reduce((s, [, v]) => s + v, 0))}])}],
        rows: dr.map(([l, v]) => ({vid: "", date: ctx.to, no: "", type: "", party: l, amount: v, note: "credit balance"}))});
      yield;
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
  *each(list, f, n){ n = n || 4000; for (let i = 0; i < list.length; i++){ f(list[i], i); if (i % n === n - 1) yield; } },
  drain(it){ let r; while (!(r = it.next()).done); return r.value; },
  // the fingerprint of a result: the same books give the same code, every time
  hash(str){ let h = 2166136261; for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).toUpperCase().padStart(8, "0"); },
  itemKey(f, r){ return f.id + "|" + [r.vid || "", r.party || "", r.date || "", r.no || "", r.type || ""].join("|"); },
  // run every check for a period; rules only, so the same books always give the same findings
  run(from, to, how){ return typeof memoScope === "function" ? memoScope(() => this.runNow(from, to, how)) : this.runNow(from, to, how); },
  runNow(from, to, how){ const it = this.runIn(from, to, how); let r; while (!(r = it.next()).done); return r.value; },
  // the ledger tests of one run, each answer kept for the run by ledger name (next-audit-steps: the cash checks asked
  // isCash, isLoan... of every line of the year again, 20-100 ms a check on 51,758 made-up entries). Within a run the
  // books do not change (the day's run on its own starts again when they do: autoSlice), so the answers are the same
  ASK: ["isCash", "isBankL", "isLoan", "isCapital", "isDuties", "isCreditor", "isDebtor", "isExpense", "isFixed", "isIncome"],
  runA(){
    const A = Object.create(this), um = new Map();
    this.ASK.forEach(f => { const m = new Map(), g = this[f]; A[f] = function(l){ let x = m.get(l); if (x === undefined){ x = g.call(this, l); m.set(l, x); } return x; }; });
    A.under = function(l, re){ const k = re.source + "/" + re.flags + "\u0001" + l; let x = um.get(k); if (x === undefined){ x = Audit.under.call(this, l, re); um.set(k, x); } return x; };
    return A;
  },
  // the run in steps, a check a step (the Audit tab works it out behind the page: app/src/screens/books/Audit.jsx; the
  // day's run on its own: autoStart). What several checks read is worked out first, each in steps of its own, and kept
  // for the run as one calculation keeps it (perRender): the balances on the two days, each year's TDS limits
  // (TDSWatch.yearSteps), the suppliers' bills (MIS.ageingSteps). The books are changed only in the last step, all at
  // once, so a run stopped on the way leaves the last run as it was. prog (optional): {k, of}, the checks done of all
  // (prog.keep, optional: asked before the last step; false: nothing is written and the run gives null.) The run's
  // basis and its count of entries are those of the books when it starts, so a run whose books changed on the way
  // no longer fits them (stale)
  // next-speed-worker: in two parts, the same run: calcIn works the findings out (in the engine's worker for a run on
  // its own, Audit.autoEngine), writeIn writes them into the books' audit (always on the page, in its steps)
  *runIn(from, to, how, prog){ return yield* this.writeIn(yield* this.calcIn(from, to, prog), how, prog); },
  *calcIn(from, to, prog){
    const b = S.books;
    from = this.ymd(from); to = this.ymd(to);
    const V = this.vouchers(from, to);
    yield;
    const basis = MIS.basis();
    yield;
    V.sort((a, c) => a.date.localeCompare(c.date) || String(a.id).localeCompare(String(c.id)));
    yield;
    const ctx = {from, to, bal: this.balances(from, to)}, A = this.runA();
    const order = Object.keys(this.checks), findings = [], errors = [], ran = new Set();
    if (prog){ prog.k = 0; prog.of = order.length; }
    // (an error here is the check's own: it asks again, and says it)
    const warm = f => { try { f(); } catch (e){} };
    // the balances on the two days the checks ask for, by way of each quarter's end from the books' first day (each a
    // step: the entries are added in order and kept on the way, moveKept, so the figures are the ones asked at once)
    if (ctx.bal.ok){
      const ends = [], last = this.dayBefore(from), m0 = String((b.meta || {}).from || from).slice(0, 6);
      for (let y = num(m0.slice(0, 4)), m = num(m0.slice(4, 6)); ; ){
        m += 3; if (m > 12){ m -= 12; y++; }
        const d = this.dayBefore(String(y) + String(m).padStart(2, "0") + "01");
        if (d >= to) break;
        ends.push(d);
      }
      for (const d of ends.filter(d => d < last).concat([last], ends.filter(d => d > last), [to])){ warm(() => ctx.bal.at(d)); yield; }
    }
    if (typeof TDSWatch === "object" && TDSWatch.yearSteps && this.checks.tdsMissed){
      if (TDS.allRowsIn){ try { yield* TDS.allRowsIn(); } catch (e){} } yield;
      if (typeof perRender === "function" && TDSWatch.byLedger){ warm(() => perRender(TDSWatch, "byLedger", () => TDSWatch.byLedger())); yield; }
      const y0 = num(TDS.fyOf(from).slice(0, 4)), y1 = num(TDS.fyOf(to).slice(0, 4));
      for (let y = y0; y <= y1; y++){
        const fy = y + "-" + String(y + 1).slice(2);
        let r = null; try { r = yield* TDSWatch.yearSteps(fy); } catch (e){ r = null; }
        if (r && typeof perRender === "function") perRender(TDSWatch, "y|" + fy, () => r);
        yield;
      }
    }
    if (this.checks.msme43Bh && typeof MIS === "object" && MIS.ageingSteps){ try { ctx.ageP = yield* MIS.ageingSteps(to, "p", null); } catch (e){ delete ctx.ageP; } yield; }
    for (let k = 0; k < order.length; k++){
      const id = order[k];
      try {
        const f = this.checks[id], r = f.steps ? yield* f.steps(A, V, ctx) : f(A, V, ctx);
        ran.add(id);
        [].concat(r || []).filter(Boolean).forEach(f => {
          f.id = id + (f.key ? ":" + f.key : ""); f.check = id; f.order = k; f.amount = r2(f.amount || 0);
          (f.rows || []).forEach(x => { x.key = this.itemKey(f, x); if (x.amount != null) x.amount = r2(x.amount); });
          f.rows = (f.rows || []).sort((a, c) => String(a.date || "").localeCompare(String(c.date || "")) || String(a.no || "").localeCompare(String(c.no || "")) || String(a.party || "").localeCompare(String(c.party || "")) || a.key.localeCompare(c.key));
          f.count = f.total || f.rows.length;
          findings.push(f);
        });
      } catch (e){ errors.push(id + ": " + (e && e.message)); }
      if (prog) prog.k = k + 1;
      yield;
    }
    findings.sort((a, c) => this.SEV[c.sev] - this.SEV[a.sev] || a.order - c.order || a.id.localeCompare(c.id));
    // every row goes to the items; a finding keeps its first 1,000 (the result code is worked out from those)
    const full = findings.map(f => f.rows.slice());
    findings.forEach(f => { f.rows.splice(1000); });
    yield;
    const code = this.hash(JSON.stringify(findings.map(f => [f.id, f.count, f.amount, f.rows.map(r => r.key + "=" + r.amount)])));
    yield;
    return {b, from, to, basis, n: V.length, findings, full, code, ran, errors, bal: {ok: !!ctx.bal.ok, src: ctx.bal.src, why: ctx.bal.why}};
  },
  *writeIn(c, how, prog){
    const {b, from, to, basis, findings, full, code, ran, errors} = c, ctx = {bal: c.bal}, V = {length: c.n};
    // what the last step writes, worked out first (nothing of the books' audit changed yet): each row's item, and the
    // items found before and not now, in a period this run covers (put right)
    const au0 = b.audit || {}, items0 = au0.items || {}, seen = new Set(), recs = full.map(rows => rows.map(r => { seen.add(r.key); return [r.key, {date: r.date, no: r.no, party: r.party, amount: r.amount, note: r.note, type: r.type}]; }));
    yield;
    const gone = [];
    Object.entries(items0).forEach(([k, it]) => {
      if (seen.has(k) || it.solved || !ran.has(String(it.f).split(":")[0])) return;
      const d = it.row && it.row.date;
      if (d ? (d >= from && d <= to) : (to >= it.to && from <= it.from)) gone.push(it);
    });
    yield;
    if (prog && prog.keep && !prog.keep()) return null;
    // the last step: the books' audit, all at once
    const au = b.audit = b.audit || {st: {}, history: []};
    au.items = au.items || {};
    const at = new Date().toISOString();
    const prev = au.last ? Object.fromEntries(au.last.findings.map(f => [f.id, f.count])) : {};
    findings.forEach((f, i) => {
      f.isNew = !(f.id in prev); f.more = prev[f.id] != null ? f.count - prev[f.id] : 0;
      recs[i].forEach(([key, row]) => {
        const it = au.items[key];
        if (!it) au.items[key] = {f: f.id, title: f.title, area: f.area, sev: f.sev, first: at, last: at, from, to, row};
        else { it.last = at; it.to = to; if (it.solved){ it.reopened = at; delete it.solved; } it.row = row; }
      });
    });
    gone.forEach(it => { it.solved = at; });
    const solvedBy = {};
    Object.values(au.items).filter(it => it.solved).forEach(it => { (solvedBy[it.f] = solvedBy[it.f] || []).push(it); });
    const run = {at, from, to, how: how || "run now", basis, findings, errors, vouchers: V.length, balances: ctx.bal.ok ? ctx.bal.src : "",
      notes: [ctx.bal.ok ? "" : "Balance checks were not run: " + ctx.bal.why + ".", this.mastersIn() ? "" : "The ledger masters are not read, so ledgers are recognised by name only."].filter(Boolean),
      solved: Object.entries(solvedBy).map(([fid, list]) => ({id: fid, title: list[0].title || fid, area: list[0].area, sev: list[0].sev, n: list.length, amount: r2(list.reduce((s2, it) => s2 + num(it.row && it.row.amount), 0)),
        items: list.sort((a, c) => String(a.solved).localeCompare(String(c.solved)) || String((a.row || {}).date).localeCompare(String((c.row || {}).date))).slice(-300)}))};
    run.code = code;
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
  // the day (here, as today()) a time kept as toISOString falls on: a run at 01:00 in India is kept as the day before in
  // UTC, so compared as UTC the day's run seemed not done until 05:30 (review of e5e0eb0ed)
  dayOf(at){ const d = new Date(at); return isNaN(d.getTime()) ? String(at || "").slice(0, 10).replace(/-/g, "") : d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); },
  due(b){
    const c = this.cfg(b), last = b.audit && b.audit.last ? this.dayOf(b.audit.last.at) : "";
    if (c.freq === "off" || !(b.vouchers || []).length) return false;
    if (!last) return true;
    const t = this.today();
    if (c.freq === "daily") return last < t;
    if (c.freq === "weekly") return this.days(last, t) >= 7;
    if (c.freq === "monthly") return last.slice(0, 6) < t.slice(0, 6);
    return false;
  },
  // the year chosen, else the last full year of the books (as Accounts): never a year the books hardly reach (review of
  // 02-Oct-2026: the books end on 01-Jul-2026, and the audit ran on Apr-Sep 2026, which holds one entry)
  defaultRange(b){
    const fy = typeof fsLastFull === "function" ? (S.auditFy || fsLastFull()) : "";
    const end = String((b.meta || {}).to || this.today()), t = this.today(), last = end < t ? end : t;
    if (!fy) return {from: this.fyStart(last), to: last};
    const fyEnd = (num(fy) + 1) + "0331";
    return {from: fy + "0401", to: fyEnd < last ? fyEnd : last};
  },
  // a run kept from before that no longer matches the books for its period (another computer's books, or books read again)
  // a kept run that no longer fits: the books hold a different number of entries for its period, or the books or
  // FinCom's working changed since (MIS.basis); its findings and figures are then not shown, only "Run again"
  stale(run){
    if (!run || !run.from) return null;
    const n = this.vouchers(run.from, run.to).length;
    if (n !== run.vouchers) return {was: run.vouchers, now: n};
    if (!run.basis || run.basis !== MIS.basis()) return {was: run.vouchers, now: n, changed: true};
    return null;
  },
  howLabel(run){ return !run || !run.how || run.how === "run now" ? "run by hand" : run.how; },
  // next-audit-steps (owner-approved, 12-Nov-2026): the day's first audit on its own ran in one go right after new
  // entries came in from the cloud copy (TCloud.rework) or the books opened, and held the page for it (1.4 s on 51,758
  // made-up entries here, 5.6 s on the owner's PC). Now it is worked out in small steps between the page's own work
  // (requestIdleCallback, else a timer; about SLICE_MS of steps a task, each step a part of a check's working), with the
  // steps sharing what they work out as one run does (JOB_MEMO, as lib/behind.jsx does). It is the same run (runIn), so
  // the same result as working it out at once. The books' audit is changed only by its last step: until then the last
  // run stays as it was (the Audit tab says it is checking). The books changed meanwhile (another list of entries, an
  // entry replaced, any save of the books but one that only marks a finding (quiet), a run by hand, the setting): it
  // starts again from the books as they are now, if still due; its last start (the MAX_STARTS-th: the books saved again
  // and again) goes on whatever else changes, and is kept only if the books are as they were when it started (else
  // once more, kept as it ends; the run's basis and count are those of its start, so the Audit tab says when it no
  // longer fits the books, stale). Another client opened: it stops, and nothing is written.
  // While the cloud copy's entries are being brought into the books (TCloud.load, which changes them across awaits) it
  // takes no step (autoLoading); a busy line that says so holds it for at most WAIT_MAX_MS (autoBusy). A task of steps is about SLICE_MS, less if the idle time runs out (timeRemaining), and
  // HIDDEN_MS while the tab is hidden (its timers then come about once a second at best). tests/run_hang_audit_auto.py,
  // tests/run_audit_auto_ist.py
  // The month's MIS on its own is worked out by the same steps (next-fix-mis-freeze: MIS takes AUTO and these auto* as
  // its own, src/js/07), each with its books' last run (lastRun), its range (MIS.autoRange), steps (MIS.steps) and words (say)
  AUTO: {SLICE_MS: 10, HIDDEN_MS: 150, WAIT_MS: 250, WAIT_MAX_MS: 120000, DRAW_MS: 500, MAX_STARTS: 6},
  say: "the day's audit on its own",
  // saves of the books that change nothing the audit reads (a finding marked, its note): auditFindingSet
  quiet: 0,
  quietSave(){ this.quiet++; return saveBooks(); },
  rev(){ return (typeof BOOKS_REV === "number" ? BOOKS_REV : 0) - this.quiet; },
  auto: null,
  maybeRun(){
    const b = S.books;
    if (!b || !b.vouchers || !this.due(b)) return;
    this.autoStart(b);
  },
  // what the run is worked out from: compared before each task of steps
  autoSig(b){
    const V = b.vouchers || [];
    return {b, cid: b.cid, co: S.coId, V, n: V.length, vs: V.slice(), rev: Audit.rev(), last: this.lastRun(b), freq: this.cfg(b).freq};
  },
  // the same run and setting (no run by hand since, the setting not changed)
  lastRun(b){ return (b.audit || {}).last || null; },
  autoRun(x, b){ return !!x && x.b === b && S.books === b && S.coId === x.co && x.last === this.lastRun(b) && x.freq === this.cfg(b).freq; },
  autoSame(x, b){
    const V = b.vouchers || [];
    return this.autoRun(x, b) && x.V === V && x.n === V.length && x.rev === Audit.rev() && x.vs.every((v, i) => v === V[i]);
  },
  // the books are being brought in from the cloud copy (changed across awaits): no step now. A load (TCloud.load,
  // openLoad: counted in try/finally) always holds it; a busy line (b.catchUp, Look up's) only for WAIT_MAX_MS, since
  // a line can stay after its work. The month's MIS also waits for the day's audit on its own (its compliance part reads
  // the audit's last run) and for the MIS tab's own run (MIS._again: stopped by a newer run asked for, MIS.runSoon)
  autoLoading(){ const T = typeof TCloud === "object" ? TCloud : null; return !!(T && (T.opens > 0 || T.loads > 0)); },
  autoBusy(b){ const f = typeof LK === "object" && LK.fr ? LK.fr() : null; return !!(b.catchUp || (f && f.busy) || (this !== Audit && (Audit.auto || this._again))); },
  // want (the MIS's runs asked for: MIS.runSoon): {from, to, how}, a run of that period and words, due or not; one asked
  // while another runs takes its place
  // (k: when it was asked for, MIS.asked; one asked for earlier than the job running gives way to it)
  autoStart(b, want, k){
    const j = this.auto;
    if (j && j.b === b && (!want || j.k > k)) return j;
    if (j) this.autoStop(j);
    const job = this.auto = {b, want, k, cid: b.cid, co: S.coId, it: null, sig: null, memo: null, prog: {k: 0, of: Object.keys(this.checks || 0).length}, starts: 0, slices: [], drawn: 0, t0: Date.now()};
    this.autoSoon(job);
    // (next-speed-worker: the tab's line of the job drawn now; it was drawn only with the page's next drawing)
    if (typeof soonRender === "function") soonRender();
    return job;
  },
  // (the page drawn again: a tab's line of the job goes, next-fix-mis-rework)
  autoStop(j){
    if (!j) return;
    if (j.it){ try { j.it.return(); } catch (e){} }
    j.it = null;
    if (this.auto === j) this.auto = null;
    if (typeof soonRender === "function") soonRender();
  },
  // the run on its own being worked out for these books (the Audit tab's "checking" line)
  // still wanted: a run asked for, until a run is written since it began (autoRun); else while due. A run asked for that
  // goes (stopped, failed, another client opened) is said (MIS.wantSay)
  autoDue(j, b){ return j.want ? !j.sig || this.autoRun(j.sig, b) : this.due(b); },
  autoFor(b){ const j = this.auto; return j && j.b === b && S.books === b ? j : null; },
  autoSoon(j, ms){
    const go = d => this.autoSlice(j, d);
    if (ms) setTimeout(go, ms);
    else if (typeof requestIdleCallback === "function" && !(typeof document === "object" && document.hidden)) requestIdleCallback(go, {timeout: 250});
    else setTimeout(go, 0);
  },
  autoBegin(j, b){
    const r = j.want || (this.autoRange ? this.autoRange(b) : this.defaultRange(b));
    j.sig = this.autoSig(b); j.memo = new Map(); j.starts++;
    // kept only if no load is running and the books are as they were when it started (they can change only on its last
    // start, or its very last); refused: once more (autoSlice)
    j.refused = false;
    j.prog.keep = () => { const ok = !this.autoLoading() && (!!j.extra || this.autoSame(j.sig, b)); if (!ok) j.refused = true; return ok; };
    const how = j.want ? j.want.how : "on its own (" + this.cfg(b).freq + ")";
    // next-speed-worker: worked out in the engine's worker where it can be (Engine.can), else here in steps as before
    j.eng = Engine.can(this);
    j.it = j.eng ? this.autoEngine(j, r.from, r.to, how) : this.autoLocal(r.from, r.to, how, j.prog);
  },
  autoLocal(from, to, how, prog){ return (this.steps || this.runIn).call(this, from, to, how, prog); },
  // next-speed-worker (owner-approved: screens never freeze): the run in the engine's worker (Engine, below), off the
  // page's thread: the books sent in parts (a step each), then the page waits (Engine.WAIT: autoSlice ends its task, the
  // worker's next word wakes it) while the worker works the run out to where the steps here would ask prog.keep: the
  // audit's findings (calcIn), the MIS's figures (madeCalc). What is written into the books (writeIn, madeKeep) is done
  // here, in its steps, as before, so the run is the same. The job's own rules hold as they are: the books looked at
  // before every task, stopped or started again (the worker's job then dropped: finally). The worker gone or failing to
  // start: the run worked out here in steps (autoLocal); a step that throws in the worker: thrown here (j.err, said)
  *autoEngine(j, from, to, how){
    const E = Engine, kind = this === Audit ? "audit" : "mis", prog = j.prog, b = j.b;
    let a = null;
    try {
      if (!(yield* E.ready()) || !(yield* E.sendIn(b))) return yield* this.autoLocal(from, to, how, prog);
      // (review of the full stack: the worker gone while asked, its error, or its job dropped: worked out here in steps,
      // never a failed run; a step that throws here is said as before)
      try { a = E.ask(kind, from, to, how, prog); } catch (e){ a = null; return yield* this.autoLocal(from, to, how, prog); }
      while (!a.end && !a.err && !a.dropped && E.st === "ok") yield E.WAIT;
      if (!a.end){ const x = a; a = null; E.cancel(x); return yield* this.autoLocal(from, to, how, prog); }
      const res = a.res; a.over = true;
      if (kind === "mis") return this.madeKeep(res, prog);
      res.b = b;
      return yield* this.writeIn(res, how, prog);
    } finally { if (a){ if (a.over){ clearTimeout(a.timer); E.jobs.delete(a.id); } else E.cancel(a); } }
  },
  autoSlice(j, d){
    if (this.auto !== j) return;
    const b = j.b;
    // another client opened: stopped, nothing written
    if (S.books !== b || S.coId !== j.co){ this.autoStop(j); if (j.want && this.wantSay) this.wantSay(j, "drop"); return; }
    // the books are being brought in: looked at again in a moment. A load always holds it; a busy line for at most
    // WAIT_MAX_MS (a line that stayed does not hold the audit for the session). After, it goes on if the books are as
    // they were, else it starts again from them as for any change
    if (this.autoLoading()){ this.autoSoon(j, this.AUTO.WAIT_MS); return; }
    if (this.autoBusy(b)){
      const t = Date.now(); j.waitFrom = j.waitFrom || t;
      if (t - j.waitFrom < this.AUTO.WAIT_MAX_MS){ this.autoSoon(j, this.AUTO.WAIT_MS); return; }
    } else j.waitFrom = 0;
    if (!j.it || !this.autoSame(j.sig, b)){
      // its last start (started again often enough): it goes on whatever changes (kept only if nothing did: prog.keep)
      if (j.it && j.final && this.autoRun(j.sig, b)){ /* on to the end */ }
      else {
        if (j.it){ try { j.it.return(); } catch (e){} j.it = null; }
        // a run by hand since, the setting turned off, or no entries: nothing more to do
        if (!this.autoDue(j, b)){ this.autoStop(j); if (j.want && this.wantSay) this.wantSay(j, "drop"); return; }
        if (j.starts + 1 >= this.AUTO.MAX_STARTS) j.final = true;
        this.autoBegin(j, b);
      }
    }
    const now = () => (typeof performance === "object" ? performance.now() : Date.now()), t0 = now(), was = typeof JOB_MEMO === "undefined" ? null : JOB_MEMO;
    const hidden = typeof document === "object" && !!document.hidden, idle = !hidden && d && !d.didTimeout && typeof d.timeRemaining === "function" ? d : null;
    const ms = hidden ? this.AUTO.HIDDEN_MS : this.AUTO.SLICE_MS;
    let run = null, done = false, wait = false;
    if (typeof reactScopeEnd === "function") reactScopeEnd();
    JOB_MEMO = j.memo; IN_RENDER++;
    try {
      for (;;){
        const r = j.it.next();
        if (r.done){ run = r.value; done = true; break; }
        // (the engine's worker is working: woken by its next word, Engine.sleep)
        if (r.value === Engine.WAIT){ wait = true; break; }
        if (now() - t0 >= ms || (idle && idle.timeRemaining() <= 0)) break;
      }
    } catch (e){
      done = true; run = null; j.err = e;
      // as before, no run kept; said in the console and to Sentry (app/src/sentry.js), as the page's other parts say theirs
      try { console.error("[FinCom] " + this.say + ":", e); if (typeof window === "object" && typeof window.__fincomReport === "function") window.__fincomReport(e, this.say); } catch (x){}
    }
    finally { IN_RENDER--; JOB_MEMO = was; j.slices.push(Math.round(now() - t0)); }
    if (!done){
      // the Audit tab's line of how far it is, now and then
      // (next-speed-worker: the MIS tab's too, and the line alone is drawn again: "fincom:auto", app/src/lib/autoLine.js;
      // the whole tab drawn again every half second took 50-100 ms a time at 100,000 made-up entries)
      if (Date.now() - j.drawn >= this.AUTO.DRAW_MS && typeof document === "object" && document.querySelector("[data-audit-auto], [data-mis-auto]")){ j.drawn = Date.now(); Engine.say(); }
      if (wait) Engine.sleep(() => this.autoSoon(j)); else this.autoSoon(j);
      return;
    }
    j.it = null;
    // the last start's books changed on the way (prog.keep): not kept; once more from the books as they are, kept as it ends
    // (only when keep refused it: a step that threw ends it, as before)
    if (!run && j.refused && !j.extra && this.autoRun(j.sig, b) && this.autoDue(j, b)){ j.extra = true; this.autoBegin(j, b); this.autoSoon(j); return; }
    if (this.auto === j) this.auto = null;
    if (run){
      j.run = run;
      saveBooks();
      // it ran by itself: the sidebar's quiet line, not a toast (stability batch 3); the month's MIS says nothing, as before
      if (this === Audit){ const hi = run.findings.filter(f => f.sev === "high").length;
        toast("Audit ran on its own: " + run.findings.length + " findings" + (hi ? ", " + hi + " serious" : "") + ". See Audit.", {background: true}); }
    } else if (j.want && this.wantSay) this.wantSay(j, j.err ? "fail" : "drop");
    // drawn again however it ended (a failed run's line goes too)
    if (typeof soonRender === "function") soonRender(); else render();
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
    h += '<p class="note" style="margin-top:6px">Prepared from the books in Tally by ' + esc(co.firm || (S.firm && S.firm.firmName) || "the firm") + ". These are observations for review; each is to be confirmed against the documents before any adjustment is made.</p>";
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
});
// a check that has its steps (checkSteps) is worked out in them by Audit.runIn (a check put in its place has none)
Object.keys(Audit.checkSteps).forEach(k => { Audit.checks[k].steps = Audit.checkSteps[k]; });

// next-speed-worker (owner-approved, step 1 of the speed work: screens never freeze): the engine's worker, a Web Worker
// that works the day's audit and the month's MIS out off the page's thread (Audit.autoEngine). It runs the very code
// the page runs: this file (legacy.js, the same address and version, from the browser's cache) and the MIS screen's,
// with the React app's GST wraps (app/engine/worker.js; its file, assets/engine-<hash>.js, is fetched only when a run
// first needs it). URL: put in by app/vite.config.js; still the mark (the one-file site, a test's harness): no worker.
//  - the books go in parts of PART entries (a post of all 100,000 made-up entries held the page 0.5 s; 5,000: 15-30 ms),
//    each key of the books on its own (of the audit and the MIS only what the engines read: auditLite), and only what changed
//    since the worker last had them (the same list of entries, every entry the same, no save since: none again);
//  - its answer: the MIS's figures in one word, the audit's findings first and their rows in parts after;
//  - only while the page's engine is the one loaded (pure: a function of MIS or Audit replaced since, a test's or a fix
//    of the moment, is not in the worker's copy): else, and with no Worker, or a worker that does not start, fails or
//    goes, the run is worked out here in steps as before (Audit.autoLocal). tests/run_speed_worker.py
const Engine = {
  URL: "__FINCOM_ENGINE__",
  PART: 2500, ROWS: 5000, START_MS: 20000, NAP_MS: 250,
  // a job the worker does not answer in time (JOB_MS, and 0.5 ms an entry; after one has been answered, 3 times the
  // longest of its kind, never less than JOB_MS) ends the worker: the run is worked out here in steps (review of part 1)
  JOB_MS: 20000, JOB_PER: 0.5, took: {},
  // a figure a page waits for (GSTR-3B: GSTR.workReady) only on books larger than this: smaller ones are worked out at
  // once in well under 100 ms (GST 3B cold: about 60 ms at 5,000 made-up entries), with no "Working out" line, as before
  SMALL: 5000,
  WAIT: {engine: "wait"},
  st: "", why: "", w: null, nid: 0, ver: 0, sent: null, jobs: new Map(), wakers: new Set(), base: null,
  // the page's engine as loaded (taken once legacy.js has run; the MIS screen's own when it loads: 18-mis-pack.js). The
  // job's own functions (auto*, maybeRun, runSoon) run here only, so they are not compared
  // GSTR (the GST engine, which the MIS reads too): taken once the React app's GST wraps are on it (app/src/main.jsx)
  OBJ: () => [["MIS", MIS], ["Audit", Audit], ["checks", Audit.checks], ["checkSteps", Audit.checkSteps], ["Parties", Parties], ["GSTR", GSTR], ["LK", LK]],
  PAGE: /^(auto[A-Z]|maybeRun$|runSoon$|wantSay$)/,
  // (more: a screen's own functions put on MIS or Audit (name) when its file loads: 18-mis-pack.js's, 77-audit.js's)
  keep(more, name){
    const B = this.base = this.base || new Map();
    const take = (n, o, all) => { if (!o) return; const m = B.get(n) || new Map(); Object.keys(o).forEach(k => { if (typeof o[k] === "function" && (all || !m.has(k))) m.set(k, o[k]); }); B.set(n, m); };
    if (more) take(name || "MIS", more, true); else this.OBJ().forEach(([n, o]) => take(n, o));
  },
  pure(){
    if (!this.base) return false;
    return this.OBJ().every(([n, o]) => { const m = this.base.get(n); if (!m || !o) return false;
      for (const [k, f] of m) if (o[k] !== f && !this.PAGE.test(k)) return false;
      return Object.keys(o).every(k => typeof o[k] !== "function" || m.has(k) || this.PAGE.test(k)); });
  },
  src(){ const s = typeof document === "object" && document.querySelector('script[src*="legacy.js"]'); return s ? s.src : ""; },
  can(A){ return this.st !== "off" && typeof Worker === "function" && !/^__/.test(this.URL) && !!this.src() && (A === Audit || A === MIS || A === GSTR || A === LK) && this.pure(); },
  off(why){
    this.st = "off"; this.why = String(why || ""); this.gSent = undefined; this.stV = null;
    try { if (this.w) this.w.terminate(); } catch (e){}
    this.w = null; this.sent = null; this.jobs.forEach(a => clearTimeout(a.timer)); this.jobs.clear(); this.wake();
  },
  // another client opened, a sign-out or another person's copy of this browser (review of part 1): the worker keeps
  // nothing of the last (clear: its books, S, this browser's settings, the 2B runs), and the page's note of what it holds
  // goes; kill (a sign-out, a switch of person): the worker itself ends, and a new one starts when a run needs it
  clear(why, kill){
    this.sent = null; this.gSent = undefined; this.owner = null;
    // (the jobs asked for before: dropped at once, their runs worked out here if still wanted; never the worker's end)
    this.jobs.forEach(a => { clearTimeout(a.timer); a.dropped = true; }); this.jobs.clear(); this.wake();
    if (!this.w) return;
    if (kill){ try { this.w.terminate(); } catch (e){} this.w = null; if (this.st !== "off") this.st = ""; this.jobs.forEach(a => clearTimeout(a.timer)); this.jobs.clear(); this.wake(); return; }
    try { this.post({t: "clear", why: String(why || "")}); } catch (e){}
  },
  // whose books and copy the worker holds: another one, and it is cleared first
  ownerNow(b){ const o = typeof LocalOwner === "object" && LocalOwner.bound || {}; return [o.slot || "", o.uid || "", S.coId || "", (b && b.cid) || ""].join("|"); },
  start(){
    this.st = "start";
    try {
      const w = this.w = new Worker(this.URL);
      w.onmessage = e => this.got(e.data || {});
      w.onerror = e => { try { e.preventDefault(); } catch (x){} this.off("the worker failed: " + ((e && e.message) || "")); };
      w.onmessageerror = () => this.off("a word of the worker could not be read");
      w.postMessage({t: "init", legacy: this.src()});
      setTimeout(() => { if (this.st === "start") this.off("the worker did not start"); }, this.START_MS);
    } catch (e){ this.off(e && e.message); }
  },
  // the worker started (yields WAIT meanwhile): true, or false when it cannot be
  *ready(){ if (!this.st) this.start(); while (this.st === "start") yield this.WAIT; return this.st === "ok"; },
  // (no worker, or not ready: refused, review of the full stack; the callers then work it out here)
  post(m){ if (!this.w || this.st !== "ok") throw new Error("the engine's worker is not there"); this.w.postMessage(m); },
  // what of S the engines read (review of part 1: only those; the client's own of the clients), and this browser's
  // settings (sign-in left out). The worker's S is these, as they are (its S is replaced, not added to)
  S_KEYS: ["firm", "coId", "sales", "gstReg", "gstYm", "auditFy", "inregScope"],
  sNow(b){
    const s = {}, ls = {}, cs = S.companies || {};
    this.S_KEYS.forEach(k => { if (S[k] !== undefined) s[k] = S[k]; });
    s.companies = {};
    [S.coId, b && b.cid].forEach(c => { if (c && cs[c]) s.companies[c] = cs[c]; });
    // (the client's documents and parties: the audit's checks read them, S.data[cid], so S.data is always there, as on
    // the page; the client's own only)
    s.data = {}; if (S.data && b && S.data[b.cid]) s.data[b.cid] = S.data[b.cid];
    try { for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if (!/sess|token|auth|api|secret|pass|key/i.test(k)) ls[k] = localStorage.getItem(k); } } catch (e){}
    // what the engines read outside S: the 2B matching runs of the year (M2B.st, from FinCom's cloud: GST2B.run's AI
    // pairs, and so the 3B's credit), sent again only when the page has another
    const g = {};
    if (typeof M2B === "object" && M2B.st){
      // (by a hash of all of it, review of part 1: not by its runs' sizes)
      let sig = ""; try { sig = Audit.hash(JSON.stringify(M2B.st)); } catch (e){ sig = String(Math.random()); }
      if (sig !== this.gSent){ g.M2B = M2B.st; this.gSent = sig; }
    }
    return {s, ls, g};
  },
  // the books to the worker, a part a step; false (work it out here): the worker went, or anything could not be sent
  // (one send at a time: a run asked for meanwhile waits for it, so the worker's books are always one version, whole)
  *sendIn(b){
    while (this.sending) yield this.WAIT;
    this.sending = true;
    try { return yield* this.sendNow(b); } catch (e){ this.sent = null; if (!this.w && this.st === "ok") this.st = ""; return false; } finally { this.sending = false; this.wake(); }
  },
  *sendNow(b){
    // (the books of another client or person than the worker holds: it is cleared first, review of part 1)
    const own = this.ownerNow(b);
    if (this.owner && this.owner !== own) this.clear("another client or person");
    this.owner = own;
    const V = b.vouchers || [], n = V.length, rev = typeof BOOKS_REV === "number" ? BOOKS_REV : 0, p = this.sent;
    const keys = Object.keys(b).filter(k => k !== "vouchers"), kv = {};
    keys.forEach(k => { kv[k] = b[k]; });
    const keepV = !!p && p.b === b && p.V === V && p.n === n && p.vs.every((v, i) => v === V[i]);
    yield;
    const keep = p && p.b === b && p.rev === rev ? keys.filter(k => k in p.kv && p.kv[k] === b[k]) : [];
    const S0 = this.sNow(b);
    if (keepV && keep.length === keys.length && p.keys.length === keys.length){ try { this.post({t: "S", s: S0.s, ls: S0.ls, g: S0.g}); } catch (e){ return false; } return this.st === "ok"; }
    const ver = ++this.ver;
    this.sent = null;
    this.post({t: "begin", ver, keepV, keep});
    // (anything that cannot be copied: the run is worked out here, review of part 1: never without a part of it)
    try { this.post({t: "S", s: S0.s, ls: S0.ls, g: S0.g}); } catch (e){ return false; }
    yield;
    for (const k of keys){
      if (keep.includes(k)) continue;
      const v = k === "audit" ? this.auditLite(b.audit) : k === "mis" ? null : b[k];
      try { this.post({t: "bk", ver, k, v}); } catch (e){ return false; }
      if (this.st !== "ok") return false;
      yield;
    }
    if (!keepV) for (let i = 0; i < n; i += this.PART){ this.post({t: "bv", ver, v: V.slice(i, i + this.PART)}); if (this.st !== "ok") return false; yield; }
    this.post({t: "end", ver, n});
    this.sent = {b, V, n, vs: V.slice(), rev, kv, keys};
    return this.st === "ok";
  },
  // what the engines read of the books' audit and MIS (the last run of the audit was 4.6 MB of JSON at 100,000 made-up
  // entries, a copy of 50-150 ms): the audit's marks (Audit.status) and its last run as MIS.compliance and Audit.stale
  // read it; none of the MIS (its runs are the page's: due, lastRun, stale)
  auditLite(au){
    if (!au) return au;
    const L = au.last;
    return {st: au.st, last: L ? {at: L.at, from: L.from, to: L.to, vouchers: L.vouchers, basis: L.basis, findings: (L.findings || []).map(f => ({id: f.id, sev: f.sev})), solved: (L.solved || []).map(x => ({id: x.id, n: x.n}))} : L};
  },
  ask(kind, from, to, how, prog, args){
    const a = {id: ++this.nid, kind, prog, res: null, full: null, all: {}, end: false, err: "", t0: Date.now()};
    this.jobs.set(a.id, a);
    const n = ((S.books || {}).vouchers || []).length, ms = Math.max(this.JOB_MS + n * this.JOB_PER, 3 * (this.took[kind] || 0), this.JOB_MS);
    a.timer = setTimeout(() => { if (this.jobs.get(a.id) === a && !a.end) this.off("a job of the worker took too long (" + kind + ", " + Math.round(ms / 1000) + " s)"); }, ms);
    try { this.post({t: "run", id: a.id, kind, from, to, how, args}); } catch (e){ clearTimeout(a.timer); this.jobs.delete(a.id); throw e; }
    return a;
  },
  // what the worker holds now (a test's look: tests/run_speed_worker.py): {books, n, s: S's fields, ls: settings' keys}
  peek(){ return new Promise(ok => { if (!this.w || this.st !== "ok"){ ok(null); return; } const f = e => { if ((e.data || {}).t === "state"){ this.w && this.w.removeEventListener("message", f); ok(e.data.r); } }; this.w.addEventListener("message", f); this.post({t: "state"}); }); },
  // (answered: how long it took, for the next one's time)
  done(a){ clearTimeout(a.timer); this.took[a.kind] = Math.max(this.took[a.kind] || 0, Date.now() - a.t0); },
  // a figure of the books worked out in the worker for a page that waits for it (Look up's ledger: LK.run): its answer,
  // or null when the worker could not (then worked out here). Its rows come in parts (lrows)
  calc(kind, args){
    const E = this;
    return this.drive((function* (){
      let a = null;
      try {
        if (!(yield* E.ready()) || !(yield* E.sendIn(S.books))) return null;
        a = E.ask(kind, "", "", "", null, args);
        while (!a.end && !a.err && E.st === "ok") yield E.WAIT;
        return a.end ? a.res : null;
      } finally { if (a){ if (a.end) E.jobs.delete(a.id); else E.cancel(a); } }
    })());
  },
  // ---------- the books written to this browser's store by the worker (Books.save, src/js/04)
  canStore(data){ return this.st !== "off" && typeof Worker === "function" && !/^__/.test(this.URL) && !!this.src() && !!data && Array.isArray(data.vouchers) && data.vouchers.length > this.SMALL && typeof LocalOwner === "object" && !LocalOwner.stale && typeof IDBStore === "object"; },
  // a generator of the engine's (WAIT: until the worker's next word) run as a small job of its own: its answer
  drive(it){
    return new Promise((ok, no) => {
      const step = () => {
        const t0 = Date.now();
        try {
          for (;;){
            const r = it.next();
            if (r.done){ ok(r.value); return; }
            if (r.value === this.WAIT){ this.sleep(() => setTimeout(step, 0)); return; }
            if (Date.now() - t0 >= 10){ setTimeout(step, 0); return; }
          }
        } catch (e){ no(e); }
      };
      setTimeout(step, 0);
    });
  },
  // a value in words of at most BIG items each: a plain object of more than BIG keys or a list of more than BIG items,
  // the value itself or one of its own (the audit's items), comes in parts after it (its place kept, so its keys keep
  // their order)
  BIG: 5000,
  big(x){ return !!x && typeof x === "object" && (Array.isArray(x) ? x.length > this.BIG : Object.getPrototypeOf(x) === Object.prototype && Object.keys(x).length > this.BIG); },
  *postPart(id, key, v){
    const sub = []; let top = v;
    if (this.big(v)){ top = Array.isArray(v) ? [] : {}; sub.push(["", v]); }
    else if (v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype){
      const kk = Object.keys(v).filter(x => this.big(v[x]));
      if (kk.length){ top = Object.assign({}, v); kk.forEach(x => { top[x] = null; sub.push([x, v[x]]); }); }
    }
    this.post({t: "sk", id, k: key, v: top}); yield;
    for (const [at, x] of sub){
      this.post({t: "sa", id, k: key, at, arr: Array.isArray(x)});
      if (Array.isArray(x)) for (let i = 0; i < x.length; i += this.BIG){ this.post({t: "sp", id, k: key, at, v: x.slice(i, i + this.BIG)}); yield; }
      else { const ks = Object.keys(x); for (let i = 0; i < ks.length; i += this.BIG){ const o = {}; for (let j = i; j < i + this.BIG && j < ks.length; j++) o[ks[j]] = x[ks[j]]; this.post({t: "sp", id, k: key, at, v: o}); yield; } }
    }
  },
  // Books.save's records for a client (k: Books.vk, the version of the entries last written or read here): {s, wrote},
  // or null when the worker could not (then written here). The entries go only when the worker does not hold this very
  // list: the one it last wrote (stV), or the one the engine has (sent)
  store(cid, data, k){ return this.drive(this.storeIn(cid, data, k)); },
  *storeIn(cid, data, k){
    if (!(yield* this.ready())) return null;
    while (this.sending) yield this.WAIT;
    this.sending = true;
    let a = null;
    try {
      const V = data.vouchers, n = V.length, sameAs = p => !!p && p.V === V && p.n === n && p.vs.every((x, i) => x === V[i]);
      const same = !!k && k.r === V && n === k.a.length && V.every((x, i) => x === k.a[i]);
      a = {id: ++this.nid, kind: "store", res: null, end: false, err: "", t0: Date.now()}; this.jobs.set(a.id, a);
      // (its time, as any job's: the worker ends when it does not answer, review of part 1; the save is written here)
      const ms = Math.max(this.JOB_MS + n * this.JOB_PER, 3 * (this.took.store || 0), this.JOB_MS);
      a.timer = setTimeout(() => { if (this.jobs.get(a.id) === a && !a.end) this.off("a save of the worker took too long (" + Math.round(ms / 1000) + " s)"); }, ms);
      // (the copy of this browser's store the page has open: its name as IDBStore opens it)
      this.post({t: "sbegin", id: a.id, cid, db: LocalOwner.db("tdsdesk-work")});
      yield;
      for (const key of Object.keys(data)){ if (key === "vouchers") continue; yield* this.postPart(a.id, key, data[key]); if (this.st !== "ok") return null; }
      let vfrom = "kept";
      if (!(this.stV && this.stV.cid === cid && sameAs(this.stV))){
        if (sameAs(this.sent)) vfrom = "engine";
        else { vfrom = "parts"; for (let i = 0; i < n; i += this.PART){ this.post({t: "sv", id: a.id, v: V.slice(i, i + this.PART)}); if (this.st !== "ok") return null; yield; } }
      }
      this.stV = null;
      this.post({t: "send", id: a.id, ks: k ? k.s : null, same, vfrom});
      while (!a.end && !a.err && this.st === "ok") yield this.WAIT;
      if (a.err || !a.end) return null;
      this.stV = {cid, V, n, vs: V.slice()};
      return a.res;
    } finally { this.sending = false; if (a){ clearTimeout(a.timer); this.jobs.delete(a.id); } this.wake(); }
  },
  // GSTR-3B's figures for a month (GSTR.workReady, src/js/12): the carry and the month's checks; done(answer, or null
  // when the worker could not), not called when a newer ask took its place (GSTR._work). Stepped in idle time as a run
  // on its own is, its own small job
  gst(at, ym, reg, done){
    const E = this;
    let a = null;
    const it = (function* (){
      try {
        if (!(yield* E.ready()) || !(yield* E.sendIn(at.b))) return null;
        a = E.ask("gst", ym, ym, reg, null);
        while (!a.end && !a.err && E.st === "ok") yield E.WAIT;
        return a.end ? a.res : null;
      } finally { if (a){ if (a.end) E.jobs.delete(a.id); else E.cancel(a); } }
    })();
    const step = () => {
      if (GSTR._work !== at){ try { it.return(); } catch (e){} return; }
      const t0 = Date.now(); let r;
      try {
        for (;;){
          r = it.next();
          if (r.done) break;
          // (woken by the worker's word: the next step in a task of its own, not in the word's)
          if (r.value === E.WAIT){ E.sleep(() => setTimeout(step, 0)); return; }
          if (Date.now() - t0 >= 10){ setTimeout(step, 0); return; }
        }
      } catch (e){ r = {value: null}; }
      done(r.value || null);
    };
    setTimeout(step, 0);
  },
  cancel(a){ clearTimeout(a.timer); this.jobs.delete(a.id); if (this.w && this.st === "ok") try { this.post({t: "cancel", id: a.id}); } catch (e){} },
  // the page's job sleeps until the worker's next word, or NAP_MS (it looks at the books again then)
  sleep(go){
    let t = 0;
    const w = () => { if (!this.wakers.delete(w)) return; clearTimeout(t); go(); };
    this.wakers.add(w); t = setTimeout(w, this.NAP_MS);
  },
  wake(){ Array.from(this.wakers).forEach(w => w()); },
  // a run on its own's line, drawn again by itself (app/src/lib/autoLine.js); a page without it: drawn with the page
  say(){ try { window.dispatchEvent(new CustomEvent("fincom:auto")); } catch (e){ if (typeof soonRender === "function") soonRender({now: true}); } },
  got(m){
    if (m.t === "ready"){ if (this.st === "start") this.st = "ok"; }
    else if (m.t === "fail") this.off(m.e);
    else {
      const a = this.jobs.get(m.id);
      if (!a) return;
      if (m.t === "prog"){ if (a.prog){ a.prog.k = m.k; a.prog.of = m.of; } }
      else if (m.t === "err"){ clearTimeout(a.timer); a.err = m.e || "the engine's worker failed"; }
      else if (m.t === "dropped"){ clearTimeout(a.timer); a.dropped = true; }
      else if (m.t === "mis"){ a.res = m.r; a.end = true; this.done(a); }
      // (GSTR-3B's figures in three words: the month's 3B, its checks across the year, the rest)
      else if (m.t === "gpart"){ a.all[m.k] = m.v; }
      else if (m.t === "gst"){ a.res = Object.assign(m.r, a.all); a.end = true; this.done(a); }
      else if (m.t === "stored"){ a.res = {s: m.s, wrote: m.wrote}; a.end = true; this.done(a); }
      else if (m.t === "lhead"){ a.res = m.r; a.full = []; }
      else if (m.t === "lrows"){ for (let i = 0; i < m.rows.length; i++) a.full.push(m.rows[i]); }
      else if (m.t === "lend" && a.res){ a.res.rows = a.full; a.end = true; this.done(a); }
      else if (m.t === "audit"){ a.res = m.c; a.full = m.n.map(() => []); }
      else if (m.t === "rows"){ const f = a.full[m.i]; for (let i = 0; i < m.rows.length; i++) f.push(m.rows[i]); }
      else if (m.t === "end" && a.res){
        // the findings' rows as calcIn leaves them: every row (full), each finding its first 1,000 of the same rows
        a.res.full = a.full; a.res.findings.forEach((f, i) => { f.rows = a.full[i].slice(0, 1000); });
        a.res.ran = new Set(a.res.ran); a.end = true; this.done(a);
      }
    }
    this.wake();
  }
};
setTimeout(() => Engine.keep(), 0);
