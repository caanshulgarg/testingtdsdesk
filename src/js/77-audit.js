/* @react-lazy: begin 77-audit.js (the React app loads this file with its Audit › Working papers screen and with the statements' 3CD draft: build.py react_parts) */
/* ================================================================== */
/* Audit the books: the working papers (FinCom Assistant, step 2)      */
/* ================================================================== */
// One run over a client's books for a period: a fixed list of checks, each giving status (ok, flag, or na when the
// books cannot answer it), count, amount and its entries (with the voucher id, so the screen links to each), and a
// deterministic risk score. Rules only, no AI: the same books always give the same result (the result's `code`).
//
// It only READS. It reuses the rules FinCom already has and does not repeat them:
//   - cash 40A(3), 269ST, 269SS/269T, TDS not deducted / short / late / unpaid, ITC against 2B: Audit.checks (06-audit.js)
//   - 43B(h): MIS.ageing and MIS.msme (07-mis.js), the same bills the MIS ageing shows
//   - turnover against GSTR-1 and 3B as filed: GSTCMP.month (39-gst-api.js); 26AS: AS26.own (69-tds-26as.js)
//   - balances on a date: Audit.balances; ledger groups: Audit.isCash, isCreditor ... (ledGroupPath)
// The checks new here (duplicates by party, amount and date; round sums; weekend and holiday entries; entries after
// the books were closed or backdated; unusual ledgers; Benford's first-digit test) work on the same vouchers.
//
// What a person adds (status per check: Not reviewed, Reviewed, Issue; a remark) is kept with the books as items
// (b.auditWp, one of BOOKS_KEYS, so it is shared through client_books and merged item by item like payDetails):
//   {id: "wp|<from>-<to>|<check>", kind: "wp", period, check, status, remark, by, at}
// and the last run of each period, without the long lists, for the Assistant's audit_run / audit_check
// (server/assistant/tools/audit.ts reads it; it never works a figure out itself):
//   {id: "run|<from>-<to>", kind: "run", period, at, by, code, entries, checks: [{id, status, count, amount, score, rank, entries (first 50)}]}
const AuditWP = {
  V: 1,
  // id, title, the law, weight (how much a hit matters, 1-10: the risk score's base), area
  CHECKS: [
    {id: "cash40A3", title: "Cash payments above ₹10,000 a day to one party", law: "Section 40A(3); 3CD 21(d)", weight: 9},
    {id: "cash269ST", title: "Cash received of ₹2 lakh or more", law: "Section 269ST; 3CD 31(ba)", weight: 10},
    {id: "cashLoans", title: "Loans or deposits taken or repaid in cash, ₹20,000 or more", law: "Sections 269SS, 269T; 3CD 31", weight: 10},
    {id: "tds", title: "TDS not deducted, short deducted or paid late", law: "Section 40(a)(ia), 201(1A); 3CD 21(b), 34", weight: 9},
    {id: "msme43Bh", title: "MSME suppliers unpaid beyond 45 days", law: "Section 43B(h); 3CD 22, 26", weight: 8},
    {id: "itc2b", title: "Input tax in the books not in GSTR-2B", law: "Section 16(2)(aa); rule 36(4)", weight: 7},
    {id: "turnover", title: "Turnover in the books against GSTR-1 and 3B filed", law: "Section 37, 39", weight: 8},
    {id: "tds26as", title: "TDS in the books against 26AS", law: "Section 199; rule 37BA", weight: 6},
    {id: "duplicates", title: "Possible duplicate entries", law: "Books of account", weight: 6},
    {id: "backdated", title: "Entries after the books were closed, or backdated", law: "Audit trail, rule 3(1) of the Companies (Accounts) Rules", weight: 5},
    {id: "ledgers", title: "Unusual ledgers: rarely used, or a reversed balance", law: "Analytical review", weight: 4},
    {id: "round", title: "Round-sum entries", law: "Analytical review", weight: 3},
    {id: "benford", title: "Benford's law: first digits of the amounts", law: "Analytical review (SA 520)", weight: 3},
    {id: "weekend", title: "Entries dated on a Sunday or a national holiday", law: "Analytical review", weight: 2},
  ],
  STATUS: [["nr", "Not reviewed"], ["rev", "Reviewed"], ["issue", "Issue"]],
  HOLIDAYS: ["0126", "0815", "1002"],          // Republic Day, Independence Day, Gandhi Jayanti (the same as Audit.checks.odd)
  ROUND_MIN: 50000, ROUND_UNIT: 10000,         // a payment, receipt or journal of 50,000 or more that is a multiple of 10,000
  LATE_DAYS: 30,                               // entered (or altered) more than 30 days after its date: backdated
  RARE_MAX: 2, RARE_MIN_AMT: 10000,            // a ledger used in at most 2 entries of the period, for 10,000 or more
  BENFORD_MIN: 100,                            // fewer amounts than this: the test does not apply
  CHI2_5PCT_8DF: 15.507,                       // chi-square at 5% with 8 degrees of freedom
  MAX_ROWS: 2000,
  meta(id){ return this.CHECKS.find(c => c.id === id) || null; },
  ymd(d){ return String(d || "").replace(/-/g, "").slice(0, 8); },
  periodKey(from, to){ return this.ymd(from) + "-" + this.ymd(to); },
  // "2025-26" (a financial year), "2025-04-01..2026-03-31", "20250401-20260331", "2025-07" (a month), "Q2 2025-26"
  parsePeriod(p){
    const s = String(p || "").trim();
    let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})\s*(?:\.\.|to|-|–)\s*(\d{4})-?(\d{2})-?(\d{2})$/i);
    if (m) return {from: m[1] + m[2] + m[3], to: m[4] + m[5] + m[6]};
    m = s.match(/^(?:FY\s*)?(\d{4})\s*-\s*(\d{2}|\d{4})$/i);
    if (m && (m[2].length === 2 ? (num(m[1]) + 1) % 100 === num(m[2]) : num(m[2]) === num(m[1]) + 1)) return {from: m[1] + "0401", to: (num(m[1]) + 1) + "0331"};
    m = s.match(/^(Q[1-4])\s*(?:FY\s*)?(\d{4})\s*-\s*\d{2}$/i);
    if (m){ const y = num(m[2]), q = m[1].toUpperCase(), a = {Q1: [y, "04", "0630"], Q2: [y, "07", "0930"], Q3: [y, "10", "1231"], Q4: [y + 1, "01", "0331"]}[q]; return {from: a[0] + a[1] + "01", to: a[0] + a[2]}; }
    m = s.match(/^(\d{4})-?(\d{2})$/);
    if (m && num(m[2]) >= 1 && num(m[2]) <= 12){ const last = new Date(Date.UTC(num(m[1]), num(m[2]), 0)).getUTCDate(); return {from: m[1] + m[2] + "01", to: m[1] + m[2] + String(last).padStart(2, "0")}; }
    return null;
  },
  dow(d){ d = this.ymd(d); return new Date(Date.UTC(num(d.slice(0, 4)), num(d.slice(4, 6)) - 1, num(d.slice(6, 8)))).getUTCDay(); },
  days(a, c){ const f = s => { s = this.ymd(s); return Date.UTC(num(s.slice(0, 4)), num(s.slice(4, 6)) - 1, num(s.slice(6, 8))); }; return Math.round((f(c) - f(a)) / 86400000); },
  // a voucher's amount: what its credit side adds up to (Tally's sign: a credit is positive)
  total(v){ return r2(v.ent.reduce((s, e) => s + (e.a > 0 ? e.a : 0), 0)); },
  partyOf(v){
    if (v.party) return v.party;
    const p = v.ent.find(e => Audit.isCreditor(e.l) || Audit.isDebtor(e.l));
    return p ? p.l : "";
  },
  entry(v, extra){ return Object.assign({vid: v.id, date: v.date, no: v.no || "", type: v.type || "", party: this.partyOf(v), amount: this.total(v), note: ""}, extra || {}); },
  // an Audit finding's rows as entries
  fromAudit(f, kind){ return (f.rows || []).map(r => ({vid: r.vid || "", date: r.date || "", no: r.no || "", type: r.type || "", party: r.party || "", amount: r2(num(r.amount)), note: (kind ? kind + ": " : "") + (r.note || "")})); },
  auditCheck(id, V, ctx, keep){ return [].concat(Audit.checks[id](Audit, V, ctx) || []).filter(Boolean).filter(f => !keep || keep(f)); },
  // ---------------------------------------------------------------- the checks: each returns {entries, note} or {na}
  checks: {
    cash40A3(W, V, ctx){ const f = W.auditCheck("cash40A3", V, ctx); return {entries: f.flatMap(x => W.fromAudit(x)), note: "Above ₹10,000 to one party in a day (₹35,000 to a transporter, known by the ledger's name); rule 6DD exceptions are for the auditor to judge."}; },
    cash269ST(W, V, ctx){ const f = W.auditCheck("cash269ST", V, ctx); return {entries: f.flatMap(x => W.fromAudit(x)), note: "₹2 lakh or more in cash from one person in a day (a transaction or an event that day)."}; },
    cashLoans(W, V, ctx){
      const f = W.auditCheck("cashLoans", V, ctx);
      return {entries: f.flatMap(x => W.fromAudit(x, x.key === "269SS" ? "269SS taken" : "269T repaid")), note: "Loans or deposits of ₹20,000 or more taken (269SS) or repaid (269T) in cash; banks and finance companies are left out."};
    },
    // TDS: FinCom's own TDS rules, through the audit's checks (not deducted, short, late with interest, not deposited)
    tds(W, V, ctx){
      const fyFrom = Audit.fyStart(ctx.to), Vy = fyFrom < ctx.from ? Audit.vouchers(fyFrom, ctx.to).sort((a, c) => a.date.localeCompare(c.date) || String(a.id).localeCompare(String(c.id))) : V;
      // a limit is crossed over the year: missed deductions are worked on the year to the period's end, listed when in the period
      const missed = W.auditCheck("tdsMissed", Vy, Object.assign({}, ctx, {from: fyFrom < ctx.from ? fyFrom : ctx.from})).flatMap(x => W.fromAudit(x, "not deducted (the expense)"));
      const inP = e => !e.date || (e.date >= ctx.from && e.date <= ctx.to), vidOf = r => String(r.id || "").split("|")[0];
      const fys = Array.from(new Set([TDS.fyOf(ctx.from), TDS.fyOf(ctx.to)])), Q = ["Q1", "Q2", "Q3", "Q4"], m = v => INR.format(r2(v));
      // short: Certs.issues (the rate the section and PAN call for); late: TDS.interest (201(1A)); unpaid: TDS.rows with no challan
      const short = [], late = [];
      fys.forEach(fy => Q.forEach(q => {
        Certs.issues(fy, q).filter(x => x.short > 0).forEach(x => short.push({vid: vidOf(x.row), date: x.row.date, no: x.row.voucher || "", type: x.row.section, party: x.row.party, amount: r2(x.short), note: "short deducted: " + x.row.rate + "% used, " + x.expected + "% applies: " + x.why}));
        // the deductions not yet paid are the unpaid list below (TDS.interest's "unpaid" lines, since tds-layout, are the same)
        TDS.interest(fy, q).filter(x => x.kind !== "unpaid").forEach(x => late.push({vid: vidOf(x.row), date: x.row.date, no: x.row.voucher || "", type: x.row.section, party: x.row.party, amount: r2(x.amount),
          note: x.kind === "deduct" ? "interest: TDS " + m(x.row.tds) + " deducted " + x.months + " month(s) after the bill, at 1%" : "interest: TDS " + m(x.row.tds) + " due " + fmtDate(tallyDate(x.due)) + ", paid " + fmtDate(tallyDate(x.challan.date)) + ", " + x.months + " month(s) at " + x.rate + "%"}));
      }));
      const unpaid = TDS.rows().filter(r => !r.challan).map(r => ({vid: vidOf(r), date: r.date, no: r.voucher || "", type: r.section, party: r.party, amount: r2(r.tds), note: "deducted, not against a challan (not deposited, or not matched)"}));
      return {entries: missed.filter(inP).concat(short.filter(inP), late.filter(inP), unpaid.filter(inP)), note: "Not deducted: the expense (30% of it is disallowed). Short: the shortfall. Late: the interest under 201(1A). Unpaid: the TDS not matched to a challan."};
    },
    // 43B(h): bills of micro and small suppliers open on the last date beyond the agreed days (at most 45)
    msme43Bh(W, V, ctx){
      const msme = MIS.msme();
      if (!Object.values(msme).some(t => /micro|small/i.test(t))) return {na: "no supplier is marked micro or small (Tally's MSME details, or MIS settings)"};
      const days = Math.min(45, num(MIS.cfg(S.books).msmeDays) || 45), ag = MIS.ageing(ctx.to, "p", null), out = [];
      // the bill's voucher: the entry of that date and number that carries the supplier
      const vidOf = (party, date, no) => { const v = (S.books.vouchers || []).find(z => z.date === date && String(z.no || "") === String(no || "") && z.ent.some(e => e.l === party)); return v ? v.id : ""; };
      ag.rows.forEach(p => {
        if (!/micro|small/i.test(msme[p.party] || "")) return;
        (p.open || []).filter(x => x.age > days).forEach(x => out.push({vid: vidOf(p.party, x.date, x.no), date: x.date, no: x.ref || "", type: msme[p.party], party: p.party, amount: r2(x.left), note: x.age + " days unpaid on " + fmtDate(tallyDate(ctx.to)) + " (allowed " + days + ")"}));
      });
      return {entries: out, note: "Open on " + fmtDate(tallyDate(ctx.to)) + " beyond " + days + " days: not allowed until paid."};
    },
    itc2b(W, V, ctx){
      if (!Object.keys(S.books.twoBs || {}).length) return {na: "no GSTR-2B brought in for these months"};
      return {entries: W.auditCheck("gst2b", V, ctx).flatMap(x => W.fromAudit(x)), note: "Documents with input tax in the books that the supplier has not reported in 2B (FinCom's 2B reconciliation)."};
    },
    turnover(W, V, ctx){
      const regs = (typeof GSTR === "object" && GSTR.gstins ? GSTR.gstins(S.books) : ((S.books.meta || {}).gstins || [])).map(g => String(g).slice(0, 2));
      const months = []; for (let m = ctx.from.slice(0, 6); m <= ctx.to.slice(0, 6); m = num(m.slice(4)) === 12 ? (num(m.slice(0, 4)) + 1) + "01" : m.slice(0, 4) + String(num(m.slice(4)) + 1).padStart(2, "0")) months.push(m);
      const out = []; let any = false;
      Array.from(new Set(regs)).forEach(reg => months.forEach(ym => {
        const c = GSTCMP.month(ym, reg);
        if (c.r1){ any = true; c.r1.rows.filter(r => Math.abs(r.d.taxable) >= 1).forEach(r => out.push({vid: "", date: ym + "01", no: "", type: "GSTR-1 " + r.label, party: c.gstin, amount: r2(r.d.taxable), note: GSTR.label(ym) + ": books " + INR.format(r.work.taxable) + ", filed " + INR.format(r.filed.taxable)})); }
        if (c.r3b){ any = true; c.r3b.rows.filter(r => /^3\.1\((a|b|c|e)\)/.test(r.label) && Math.abs(r.d.taxable) >= 1).forEach(r => out.push({vid: "", date: ym + "01", no: "", type: "GSTR-3B " + r.label.split(" ")[0], party: c.gstin, amount: r2(r.d.taxable), note: GSTR.label(ym) + ": books " + INR.format(r.work.taxable) + ", filed " + INR.format(r.filed.taxable)})); }
      }));
      if (!any) return {na: "no GSTR-1 or 3B as filed fetched for these months"};
      return {entries: out, note: "Taxable value, month by month and table by table: the books (FinCom's working) less the return as filed."};
    },
    tds26as(W, V, ctx){
      if (typeof AS26 !== "object") return {na: "26AS is not available"};
      const fys = Array.from(new Set([TDS.fyOf(ctx.from), TDS.fyOf(ctx.to)])), out = [];
      let any = false;
      fys.forEach(fy => {
        const r = AS26.own(fy);
        if (!r) return;
        any = true;
        r.rows.filter(x => x.status !== "matched").forEach(x => {
          const z = x.book || x.line || {};
          if (z.date && (z.date < ctx.from || z.date > ctx.to)) return;
          out.push({vid: (x.book || {}).vid || "", date: z.date || "", no: (x.book || {}).voucher || "", type: x.status === "books" ? "in the books, not in " + r.file.kind : "in " + r.file.kind + ", not in the books",
            party: x.book ? x.book.party : ((x.line.party || {}).party || x.line.name || x.line.tan || ""), amount: r2(num(z.tax)), note: x.status === "books" ? "TDS receivable booked, no credit in " + r.file.kind : "credit in " + r.file.kind + (x.line.tan ? " (TAN " + x.line.tan + ")" : "") + ", not booked"});
        });
      });
      if (!any) return {na: "no 26AS or AIS of the client uploaded (TDS page)"};
      return {entries: out, note: "The client's own 26AS (or AIS) against the TDS receivable in the books (FinCom's 26AS reconciliation)."};
    },
    // the same party, amount and date (and kind of entry); or the same party and bill number
    duplicates(W, V){
      const byPad = {}, byRef = {}, out = [], seen = new Set();
      V.forEach(v => {
        if (/CONTRA/i.test(v.type)) return;
        const p = W.partyOf(v), amt = W.total(v);
        if (!p || !amt) return;
        const kind = Books.isSale(v) ? "sale" : Books.isPurchase(v) ? "purchase" : String(v.type || "").toUpperCase();
        (byPad[[kind, p, v.date, amt.toFixed(2)].join("|")] = byPad[[kind, p, v.date, amt.toFixed(2)].join("|")] || []).push(v);
        const ref = GST2B.normNo(v.ref);
        if (ref && ref.length >= 3 && !/^\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}$/.test(String(v.ref).trim()) && !/RECEIPT|PAYMENT/i.test(v.type)) (byRef[[kind, p, ref].join("|")] = byRef[[kind, p, ref].join("|")] || []).push(v);
      });
      const add = (l, why) => l.slice(1).forEach(v => { if (seen.has(v.id)) return; seen.add(v.id); out.push(W.entry(v, {note: why + " as voucher " + (l[0].no || l[0].id) + " of " + fmtDate(tallyDate(l[0].date))})); });
      Object.values(byRef).filter(l => l.length > 1).forEach(l => add(l, "same party and bill number " + l[0].ref));
      Object.values(byPad).filter(l => l.length > 1).forEach(l => add(l, "same party, amount and date"));
      return {entries: out, note: "Each repeat is listed once, against the first entry of its group."};
    },
    round(W, V){
      const out = V.filter(v => /PAYMENT|RECEIPT|JOURNAL/i.test(v.type) && !/CONTRA/i.test(v.type)).filter(v => {
        const t = W.total(v); return t >= W.ROUND_MIN && Math.round(t * 100) % (W.ROUND_UNIT * 100) === 0;
      }).map(v => W.entry(v, {note: "a round " + INR.format(W.total(v))}));
      return {entries: out, note: "Payments, receipts and journals of ₹" + INR.format(W.ROUND_MIN) + " or more in exact multiples of ₹" + INR.format(W.ROUND_UNIT) + "."};
    },
    weekend(W, V){
      const out = V.filter(v => W.dow(v.date) === 0 || W.HOLIDAYS.includes(v.date.slice(4, 8))).map(v => W.entry(v, {note: W.HOLIDAYS.includes(v.date.slice(4, 8)) ? "national holiday" : "Sunday"}));
      return {entries: out, note: "Dated on a Sunday, 26 January, 15 August or 2 October."};
    },
    // entered or altered after the books were closed (Settings, Closed periods; else the period's end), or entered more
    // than 30 days after its date (Tally's entry date), or, where Tally gives no entry date, out of step with its AlterID
    backdated(W, V, ctx){
      const co = typeof CO === "function" ? CO() : null, closedTo = co && typeof ClosedP === "object" ? W.ymd(ClosedP.cfg(co).to) : "";
      const shut = closedTo || ctx.to, out = [];
      if (!V.some(v => v.upd || v.alt != null)) return {na: "Tally's entry dates and AlterIDs are not in these books (read the day book again with the bridge)"};
      let maxDate = "";
      // every entry in AlterID order (the order Tally saved them in); one without an entry date whose date is more than
      // 30 days before an entry saved earlier was entered later with an earlier date
      const byAlt = V.filter(v => v.alt != null).sort((a, c) => a.alt - c.alt), altLate = {};
      byAlt.forEach(v => { if (!v.upd && maxDate && W.days(v.date, maxDate) > W.LATE_DAYS) altLate[v.id] = maxDate; if (v.date > maxDate) maxDate = v.date; });
      V.forEach(v => {
        const upd = W.ymd(v.upd);
        if (upd && v.date <= shut && upd > shut) out.push(W.entry(v, {note: "entered or altered on " + fmtDate(tallyDate(upd)) + ", after the books were closed up to " + fmtDate(tallyDate(shut)) + (closedTo ? "" : " (the period's end)") + (v.by ? ", by " + v.by : "")}));
        else if (upd && W.days(v.date, upd) > W.LATE_DAYS) out.push(W.entry(v, {note: "entered on " + fmtDate(tallyDate(upd)) + ", " + W.days(v.date, upd) + " days after its date" + (v.by ? ", by " + v.by : "")}));
        else if (altLate[v.id]) out.push(W.entry(v, {note: "AlterID " + v.alt + " is after entries dated up to " + fmtDate(tallyDate(altLate[v.id])) + ": entered later, with an earlier date"}));
      });
      return {entries: out, note: closedTo ? "The books are closed up to " + fmtDate(tallyDate(closedTo)) + "." : "No closing date is set (Settings, Closed periods): the period's end is used."};
    },
    // a ledger used in at most two entries of the period (not a party, cash, bank or tax ledger), or one whose balance
    // runs the wrong way: an expense in credit, an income in debit (the period's movement); cash in credit, a supplier
    // in debit, a customer in credit (the balance on the last date, where the balances are known)
    ledgers(W, V, ctx){
      const A = Audit, use = {}, out = [];
      V.forEach(v => v.ent.forEach(e => { const u = use[e.l] = use[e.l] || {n: new Set(), net: 0, gross: 0, v}; u.n.add(v.id); u.net = r2(u.net + e.a); u.gross = r2(u.gross + Math.abs(e.a)); }));
      Object.keys(use).sort().forEach(l => {
        const u = use[l], skip = A.isCreditor(l) || A.isDebtor(l) || A.isCash(l) || A.isBankL(l) || A.isDuties(l);
        if (!skip && u.n.size <= W.RARE_MAX && u.gross >= W.RARE_MIN_AMT) out.push({vid: u.v.id, date: u.v.date, no: u.v.no || "", type: "rarely used", party: l, amount: r2(u.gross), note: u.n.size + " entr" + (u.n.size === 1 ? "y" : "ies") + " in the period"});
        if (A.isExpense(l) && u.net >= 1) out.push({vid: "", date: ctx.to, no: "", type: "reversed balance", party: l, amount: r2(u.net), note: "an expense in credit for the period"});
        if (A.isIncome(l) && u.net <= -1) out.push({vid: "", date: ctx.to, no: "", type: "reversed balance", party: l, amount: r2(-u.net), note: "an income in debit for the period"});
      });
      if (ctx.bal.ok){
        const bal = ctx.bal.at(ctx.to);
        Object.keys(bal).sort().forEach(l => {
          const v = num(bal[l]);
          if (A.isCash(l) && v >= 1) out.push({vid: "", date: ctx.to, no: "", type: "reversed balance", party: l, amount: r2(v), note: "cash in hand in credit"});
          else if (A.isCreditor(l) && v <= -1) out.push({vid: "", date: ctx.to, no: "", type: "reversed balance", party: l, amount: r2(-v), note: "a supplier in debit"});
          else if (A.isDebtor(l) && v >= 1) out.push({vid: "", date: ctx.to, no: "", type: "reversed balance", party: l, amount: r2(v), note: "a customer in credit"});
        });
      }
      return {entries: out, note: "Rarely used: at most " + W.RARE_MAX + " entries in the period, ₹" + INR.format(W.RARE_MIN_AMT) + " or more." + (ctx.bal.ok ? "" : " Balances not known, so only the period's movement is checked.")};
    },
    benford(W, V){
      const amts = V.map(v => W.total(v)).filter(a => a >= 10);
      const t = W.benfordTest(amts);
      if (t.n < W.BENFORD_MIN) return {na: "only " + t.n + " amounts of ₹10 or more; the test needs " + W.BENFORD_MIN, benford: t};
      // the entries behind the digits that come up significantly more often than Benford's law says
      const over = t.digits.filter(d => d.z > 1.96 && d.obs > d.exp).map(d => d.d);
      const entries = t.pass ? [] : V.filter(v => W.total(v) >= 10 && over.includes(W.firstDigit(W.total(v)))).map(v => W.entry(v, {note: "first digit " + W.firstDigit(W.total(v))}));
      return {entries, flag: !t.pass, benford: t, note: "Chi-square " + t.chi2.toFixed(2) + " on " + t.n + " amounts (8 degrees of freedom; fails above " + W.CHI2_5PCT_8DF + " at 5%)" + (t.pass ? ": passes." : ": fails; over-represented first digits " + over.join(", ") + ".")};
    },
  },
  firstDigit(x){ const s = String(Math.abs(x)).replace(/^[0.]+/, ""); return num(s[0]) || 0; },
  // Benford's first-digit test: observed against expected (log10(1 + 1/d)), chi-square with 8 degrees of freedom
  benfordTest(amounts){
    const obs = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    amounts.forEach(a => { const d = this.firstDigit(a); if (d >= 1 && d <= 9) obs[d]++; });
    const n = obs.reduce((s, x) => s + x, 0), digits = [];
    let chi2 = 0;
    for (let d = 1; d <= 9; d++){
      const p = Math.log10(1 + 1 / d), exp = n * p;
      const c = exp ? (obs[d] - exp) * (obs[d] - exp) / exp : 0;
      chi2 += c;
      digits.push({d, obs: obs[d], exp: Math.round(exp * 100) / 100, p, share: n ? obs[d] / n : 0, z: n ? (Math.abs(obs[d] / n - p) - 1 / (2 * n)) / Math.sqrt(p * (1 - p) / n) : 0, chi: c});
    }
    chi2 = Math.round(chi2 * 10000) / 10000;
    return {n, digits, chi2, critical: this.CHI2_5PCT_8DF, pass: n === 0 || chi2 <= this.CHI2_5PCT_8DF};
  },
  // the risk score: 0 when nothing is flagged; else weight x (1 + log10(1 + amount / 1,000)) x (1 + log10(count)), rounded
  score(weight, count, amount){
    if (!count) return 0;
    return Math.round(weight * (1 + Math.log10(1 + Math.abs(amount) / 1000)) * (1 + Math.log10(count)) * 10) / 10;
  },
  hash(str){ let h = 2166136261; for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).toUpperCase().padStart(8, "0"); },
  // ---------------------------------------------------------------- one run
  run(from, to){ return typeof memoScope === "function" ? memoScope(() => this.runNow(from, to)) : this.runNow(from, to); },
  runNow(from, to, only){
    const t0 = Date.now(), b = S.books;
    from = this.ymd(from); to = this.ymd(to);
    const V = Audit.vouchers(from, to).sort((a, c) => a.date.localeCompare(c.date) || String(a.id).localeCompare(String(c.id)));
    const ctx = {from, to, bal: Audit.balances(from, to)};
    const checks = this.CHECKS.filter(c => !only || only === c.id).map(c => {
      let r;
      try { r = this.checks[c.id](this, V, ctx) || {entries: []}; }
      catch (e){ r = {error: (e && e.message) || String(e)}; }
      const entries = (r.entries || []).map((e, i) => Object.assign(e, {id: c.id + ":" + (e.vid || "x") + ":" + i, amount: r2(num(e.amount))}))
        .sort((a, z) => String(a.date).localeCompare(String(z.date)) || String(a.no).localeCompare(String(z.no)) || String(a.party).localeCompare(String(z.party)) || a.amount - z.amount);
      entries.forEach((e, i) => { e.id = c.id + ":" + (e.vid || "x") + ":" + i; });
      const count = entries.length, amount = r2(entries.reduce((s, e) => s + Math.abs(e.amount), 0));
      const status = r.error ? "error" : r.na ? "na" : (r.flag != null ? r.flag : count > 0) ? "flag" : "ok";
      const out = {id: c.id, title: c.title, law: c.law, weight: c.weight, status, count, amount, score: status === "flag" ? this.score(c.weight, Math.max(1, count), amount) : 0,
        note: r.error ? "could not be checked: " + r.error : r.na ? "does not apply: " + r.na : r.note || "", entries: entries.slice(0, this.MAX_ROWS), more: Math.max(0, count - this.MAX_ROWS)};
      if (r.benford) out.benford = r.benford;
      return out;
    });
    const ranked = checks.slice().sort((a, c) => c.score - a.score || c.weight - a.weight || a.id.localeCompare(c.id));
    ranked.forEach((c, i) => { c.rank = c.status === "flag" ? i + 1 : null; });
    const code = this.hash(JSON.stringify(checks.map(c => [c.id, c.status, c.count, c.amount, c.entries.map(e => (e.vid || e.party) + "=" + e.amount)])));
    return {v: this.V, cid: b.cid || S.coId || "", client: ((typeof CO === "function" && CO()) || {}).name || "", from, to, at: new Date().toISOString(), entries: V.length, code,
      checks, ranked: ranked.map(c => c.id), flagged: checks.filter(c => c.status === "flag").length, ms: Date.now() - t0};
  },
  // one check's detail (the Assistant's audit_check)
  // (its rank is only known against the other checks: run() gives it; here it is left out)
  check(id, from, to){ if (!this.meta(id)) return null; const c = this.runNow(from, to, id).checks[0]; c.rank = null; return c; },
  // ---------------------------------------------------------------- the working papers (kept with the books as items)
  items(b){ b = b || S.books || {}; return Array.isArray(b.auditWp) ? b.auditWp : []; },
  wp(period, id, b){ return this.items(b).find(x => x.id === "wp|" + period + "|" + id) || {status: "nr", remark: ""}; },
  setWp(period, id, field, value){
    const b = S.books; if (!b || !this.meta(id) || !["status", "remark"].includes(field)) return false;
    if (field === "status" && !this.STATUS.some(([k]) => k === value)) return false;
    const key = "wp|" + period + "|" + id, list = this.items(b).slice(), i = list.findIndex(x => x.id === key);
    const cur = i >= 0 ? list[i] : {id: key, kind: "wp", period, check: id, status: "nr", remark: ""};
    const next = Object.assign({}, cur, {[field]: field === "remark" ? String(value || "").slice(0, 4000) : value, by: typeof whoAmI === "function" ? whoAmI() : "", at: new Date().toISOString()});
    if (i >= 0) list[i] = next; else list.push(next);
    b.auditWp = list;
    if (typeof saveBooks === "function") saveBooks();
    return true;
  },
  // the run kept for the Assistant: every figure, the first 50 entries of each check
  keepRun(res){
    const b = S.books; if (!b || !res) return;
    const key = "run|" + res.from + "-" + res.to, list = this.items(b).filter(x => x.id !== key);
    list.push({id: key, kind: "run", period: res.from + "-" + res.to, from: res.from, to: res.to, at: res.at, by: typeof whoAmI === "function" ? whoAmI() : "", code: res.code, entries: res.entries, v: res.v,
      checks: res.checks.map(c => ({id: c.id, title: c.title, law: c.law, status: c.status, count: c.count, amount: c.amount, score: c.score, rank: c.rank, note: c.note,
        entries: c.entries.slice(0, 50).map(e => ({vid: e.vid, date: e.date, no: e.no, type: e.type, party: e.party, amount: e.amount, note: e.note})), ...(c.benford ? {benford: {n: c.benford.n, chi2: c.benford.chi2, pass: c.benford.pass, digits: c.benford.digits.map(d => [d.d, d.obs, d.exp])}} : {})}))});
    // only the last 12 periods' runs are kept
    const runs = list.filter(x => x.kind === "run").sort((a, c) => String(c.at).localeCompare(String(a.at)));
    b.auditWp = list.filter(x => x.kind !== "run" || runs.indexOf(x) < 12);
    if (typeof saveBooks === "function") saveBooks();
  },
  // ---------------------------------------------------------------- the screen's state (app/src/screens/books/AuditWP.jsx)
  st(){
    const b = S.books || {};
    if (!S.awp || S.awp.cid !== b.cid){ const d = Audit.defaultRange(b); S.awp = {cid: b.cid, from: d.from, to: d.to, res: null, open: {}, busy: false}; }
    return S.awp;
  },
  go(){
    const s = this.st();
    if (!(S.books.vouchers || []).length){ toast("Read the day book first (From Tally)."); return null; }
    s.res = this.run(s.from, s.to); this.keepRun(s.res);
    if (typeof render === "function") render();
    return s.res;
  },
  label(st){ return (this.STATUS.find(([k]) => k === st) || this.STATUS[0])[1]; },
  openEntry(e){
    const d8 = String(e.date || "").slice(0, 8);
    const lk = LK.st();
    Object.assign(lk, {kind: "find", q: String(e.no || e.party || ""), typ: "", from: d8 || lk.from, to: d8 || lk.to, heard: "", led: ""});
    FC.go("lookup"); LK.run("auto");
  },
  // ---------------------------------------------------------------- Excel: real numbers, totals as formulas
  // Sheet "Summary": one row per check (rank order) with status, count, amount, score, review status and remark; the
  // totals of count, amount and score are SUM formulas. Sheet "Entries": every entry, with a SUBTOTAL total.
  sheets(res, b){
    const period = res.from + "-" + res.to, d = x => x ? fmtDate(tallyDate(x)) : "";
    const order = res.ranked.map(id => res.checks.find(c => c.id === id));
    const head = [["Audit working papers: " + (res.client || "") ], ["Period " + d(res.from) + " to " + d(res.to) + " · run " + res.at.slice(0, 16).replace("T", " ") + " UTC · result code " + res.code + " · " + res.entries + " entries. FinCom's own checks, no AI."], [],
      ["Rank", "Check", "Law", "Result", "Entries", "Amount", "Risk score", "Review status", "Remarks"]];
    const first = head.length + 1;
    const rows = order.map(c => { const w = this.wp(period, c.id, b); return [c.rank || "", c.title, c.law, c.status === "flag" ? "Flag" : c.status === "ok" ? "OK" : c.status === "na" ? "Does not apply" : "Could not check", c.count, c.amount, c.score, this.label(w.status), w.remark || ""]; });
    const last = first + rows.length - 1;
    const tot = ["", "Total", "", "", {t: "n", f: "SUM(E" + first + ":E" + last + ")", v: rows.reduce((s, r) => s + r[4], 0)}, {t: "n", f: "SUM(F" + first + ":F" + last + ")", v: r2(rows.reduce((s, r) => s + r[5], 0)), z: "#,##0.00"},
      {t: "n", f: "SUM(G" + first + ":G" + last + ")", v: Math.round(rows.reduce((s, r) => s + r[6], 0) * 10) / 10}, "", ""];
    const ent = [["Check", "Date", "Voucher", "Type", "Party or ledger", "Amount", "Note", "Voucher id"]];
    order.forEach(c => c.entries.forEach(e => ent.push([c.title, d(e.date), e.no, e.type, e.party, e.amount, e.note, e.vid])));
    const eLast = ent.length;
    ent.push(["Total", "", "", "", "", {t: "n", f: "SUBTOTAL(9,F2:F" + eLast + ")", v: r2(order.reduce((s, c) => s + c.entries.reduce((a, e) => a + e.amount, 0), 0)), z: "#,##0.00"}, "", ""]);
    const ben = res.checks.find(c => c.id === "benford" && c.benford), bs = ben ? [["Digit", "Observed", "Expected (Benford)", "Chi-square part"]].concat(ben.benford.digits.map(x => [x.d, x.obs, x.exp, Math.round(x.chi * 10000) / 10000]))
      .concat([["Total", {t: "n", f: "SUM(B2:B10)", v: ben.benford.n}, {t: "n", f: "SUM(C2:C10)", v: r2(ben.benford.digits.reduce((s, x) => s + x.exp, 0))}, {t: "n", f: "SUM(D2:D10)", v: ben.benford.chi2}]]) : null;
    return [["Summary", head.concat(rows, [tot])], ["Entries", ent]].concat(bs ? [["Benford", bs]] : []);
  },
  book(res, b){
    const wb = XLSX.utils.book_new();
    this.sheets(res, b).forEach(([n, rows]) => {
      const ws = (typeof FC === "object" && FC.sheet ? FC.sheet : XLSX.utils.aoa_to_sheet)(rows);
      // amounts shown with two decimals
      Object.keys(ws).forEach(k => { if (k[0] !== "!" && ws[k].t === "n" && !ws[k].z && /^[F]\d+$/.test(k) && n !== "Benford") ws[k].z = "#,##0.00"; });
      XLSX.utils.book_append_sheet(wb, ws, n);
    });
    return wb;
  },
  async excel(res){
    await ensureXlsx();
    const wb = this.book(res, S.books);
    saveFile(String(res.client || "client").replace(/[^A-Za-z0-9]+/g, "-") + "-audit-working-papers-" + res.from + "-" + res.to + ".xlsx", new Blob([XLSX.write(wb, {bookType: "xlsx", type: "array"})], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  },
  // ---------------------------------------------------------------- PDF: the browser's print, A4 (as the audit report)
  html(res, b){
    const period = res.from + "-" + res.to, d = x => x ? fmtDate(tallyDate(x)) : "", m = v => INR.format(r2(v || 0));
    const order = res.ranked.map(id => res.checks.find(c => c.id === id));
    let h = "<h1>Audit working papers: " + esc(res.client || "") + "</h1><p class=\"note\">Period " + d(res.from) + " to " + d(res.to) + " · run " + esc(res.at.slice(0, 16).replace("T", " ")) + " UTC · result code " + esc(res.code) + " · " + res.entries + " entries. FinCom's own checks, no AI.</p>";
    h += "<table><thead><tr><th>Rank</th><th>Check</th><th>Result</th><th class=\"n\">Entries</th><th class=\"n\">Amount</th><th class=\"n\">Risk</th><th>Review</th><th>Remarks</th></tr></thead><tbody>" +
      order.map(c => { const w = this.wp(period, c.id, b); return "<tr><td>" + (c.rank || "") + "</td><td>" + esc(c.title) + "<br><small>" + esc(c.law) + "</small></td><td>" + (c.status === "flag" ? "Flag" : c.status === "ok" ? "OK" : c.status === "na" ? "Does not apply" : "Could not check") + "</td><td class=\"n\">" + c.count + "</td><td class=\"n\">" + m(c.amount) + "</td><td class=\"n\">" + c.score + "</td><td>" + esc(this.label(w.status)) + "</td><td>" + esc(w.remark || "") + "</td></tr>"; }).join("") +
      "<tr><th></th><th>Total</th><th></th><th class=\"n\">" + order.reduce((s, c) => s + c.count, 0) + "</th><th class=\"n\">" + m(order.reduce((s, c) => s + c.amount, 0)) + "</th><th></th><th></th><th></th></tr></tbody></table>";
    order.filter(c => c.entries.length).forEach(c => {
      h += "<h2>" + esc(c.title) + "</h2><p class=\"note\">" + esc(c.note) + "</p><table><thead><tr><th>Date</th><th>Voucher</th><th>Type</th><th>Party or ledger</th><th class=\"n\">Amount</th><th>Note</th></tr></thead><tbody>" +
        c.entries.slice(0, 500).map(e => "<tr><td>" + d(e.date) + "</td><td>" + esc(e.no) + "</td><td>" + esc(e.type) + "</td><td>" + esc(e.party) + "</td><td class=\"n\">" + m(e.amount) + "</td><td>" + esc(e.note) + "</td></tr>").join("") + "</tbody></table>" +
        (c.entries.length > 500 ? "<p class=\"note\">" + (c.entries.length - 500) + " more in the Excel file.</p>" : "");
    });
    return h;
  },
  pdf(res){ printView((res.client || "Client") + " audit working papers " + res.from + "-" + res.to, this.html(res, S.books)); },
};
if (typeof globalThis === "object") globalThis.AuditWP = AuditWP;
// the Audit screen's (app/src/screens/books/Audit.jsx: the related parties), put on Audit (moved from src/js/07-mis.js
// with next-fix-mis-rework for legacy.js's budget; only that screen asks for it)
// The audit's report, its Excel and the Form 3CD draft (were in src/js/06-audit.js and 07-mis.js; with the Audit screen, the
// statements' 3CD draft and the return's checks, for legacy.js's budget): put on Audit, as AuditRel is
const AuditRep = {
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
          "</tbody></table>" + (f.count > 15 ? '<p class="note">Showing 15 of ' + f.count + "; all are in the Excel annexure.</p>" : "") : "") + "</div>";
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
    const wb = XLSX.utils.book_new(), add = (name, rows) => XLSX.utils.book_append_sheet(wb, (typeof FC === "object" && FC.sheet ? FC.sheet : XLSX.utils.aoa_to_sheet)(rows), name.slice(0, 31));
    add("Observations", [["#", "Severity", "Area", "Clause", "Observation", "Items", "Amount", "Effect", "Recommendation", "Status", "Note"]].concat(run.findings.map((f, i) =>
      [i + 1, f.sev, (this.AREAS.find(a => a[0] === f.area) || [])[1], f.clause, f.title + ": " + f.problem, f.count, r2(f.amount), f.impact, f.suggestion, (this.STATUS.find(x => x[0] === this.status(f.id).s) || [])[1], this.status(f.id).note || ""])));
    add("Annexure", [["#", "Observation", "Date", "Voucher", "Type", "Party or ledger", "Amount", "Detail"]].concat(run.findings.flatMap((f, i) => { const rs = this.rowsOf(run, f); return rs.map(r => [i + 1, f.title, d(r.date), r.no, r.type, r.party, r2(r.amount || 0), r.note || ""]).concat(rs.cut ? [[i + 1, f.title, "", "", "", (rs.cut - rs.length) + " more rows: run the audit again for them", "", ""]] : []); })));
    add("Journal entries", [["#", "Observation", "Date", "Ledger", "Debit", "Credit", "Narration", "Ledger in Tally"]].concat(run.findings.flatMap((f, i) => (f.je || []).flatMap(j => j.lines.map((l, k) =>
      [i + 1, f.title, k ? "" : d(j.date), l.l, l.dr || "", l.cr || "", k ? "" : j.narr, this.exists(l.l) ? "yes" : "to create"])))));
    const out = XLSX.write(wb, {bookType: "xlsx", type: "array"});
    saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-audit-" + run.from + "-" + run.to + ".xlsx", new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  },
  // the Form 3CD draft: the clauses the books answer, filled from them
  // a finding's every row: a run keeps a finding's first 1,000 (Audit.calcIn); the rest are its items, written by the same
  // run (review of 22-Nov-2026: the Excel annexure and the 3CD clauses stopped at 1,000 rows while their totals had all).
  // A run whose items were written over since (a later run): its rows as kept, marked with the count (cut)
  rowsOf(run, f){
    const rows = f.rows || [];
    if (rows.length >= (f.count || 0)) return rows;
    const all = Object.values(((S.books || {}).audit || {}).items || {}).filter(it => it.f === f.id && it.last === run.at && !it.solved).map(it => Object.assign({}, it.row));
    if (all.length !== f.count) return Object.assign(rows.slice(), {cut: f.count});
    const k = r => [String(r.date || ""), String(r.no || ""), String(r.party || "")];
    return all.sort((a, c) => { const x = k(a), y = k(c); return x[0].localeCompare(y[0]) || x[1].localeCompare(y[1]) || x[2].localeCompare(y[2]); });
  },
  form3cd(run){
    const full = z => z && Object.assign({}, z, {rows: this.rowsOf(run, z)});
    const b = S.books, from = run.from, to = run.to, f = id => full(run.findings.find(x => x.id === id)), m = v => INR.format(r2(v || 0)), C = [];
    const add = (no, title, head, rows, note) => C.push({no, title, head, rows: rows || [], note: note || ""});
    add("4", "GST registrations", ["GSTIN"], ((b.meta || {}).gstins || []).map(g => [g]));
    const pen = f("penalties");
    add("21(a)", "Penalties, fines and similar amounts debited to profit and loss", ["Ledger", "Amount", "Nature"], pen ? pen.rows.map(r => [r.party, r.amount, r.note]) : [], pen ? "" : "None found in the books.");
    // round 69: the TDS not deducted is a finding per party, section and year (TDSWatch.missed); its entries, the expense
    // TDS was due on, as the working papers list them
    // (review of 22-Nov-2026) a party's bills are listed when TDS covers none of them; where deductions cover some, the part
    // not covered (the finding's base, TDSWatch's uncovered) on one line: which bills it is, the books do not say
    const tm = run.findings.filter(x => x.check === "tdsMissed").map(full), tot = x => r2(x.rows.reduce((s2, r) => s2 + num(r.amount), 0));
    add("21(b)(ii)(A)", "Amounts disallowable under section 40(a)(ia): TDS not deducted", ["Party", "Amount", "Detail"], tm.flatMap(x => x.base == null || Math.abs(tot(x) - x.base) < 0.01 ? x.rows.map(r => [r.party, r.amount, r.note]) :
      [[x.party, r2(x.base), x.section + ": the part of " + x.rows.length + " bills of \u20b9" + m(tot(x)) + " not covered by the TDS deducted"]]), tm.length ? "" : "None found.");
    const c3 = f("cash40A3");
    add("21(d)(A)", "Cash payments above the limit, section 40A(3)", ["Date", "Party or ledger", "Amount"], c3 ? c3.rows.map(r => [fmtDate(tallyDate(r.date)), r.party, r.amount]) : [], c3 ? "" : "None found.");
    const ms = f("msme43Bh");
    add("22", "Interest under section 23 of the MSMED Act, not allowed", ["Supplier", "Bill", "Outstanding", "Days"], ms ? ms.rows.map(r => [r.party, r.no, r.amount, r.note]) : [], "The interest itself is not in the books; work it out on these bills at three times the bank rate.");
    const rp = f("related:40A2b");
    add("23", "Payments to persons specified in section 40A(2)(b)", ["Person", "Relation", "Amount", "Nature"], rp ? rp.rows.map(r => [r.party, r.type, r.amount, r.note]) : [], (b.auditRel || []).length ? (rp ? "" : "None in the period.") : "The list of related persons is not set yet (Audit \u2192 Related parties).");
    const d43 = f("balances:43B");
    add("26", "Sums under section 43B", ["Ledger or supplier", "Amount unpaid at the end of the period", "Note"], (d43 ? d43.rows.map(r => [r.party, r.amount, r.note === "payable" ? "statutory dues" : r.note]) : []).concat(ms ? ms.rows.map(r => [r.party, r.amount, "43B(h) MSME"]) : []),
      "Add the date of payment of each before the due date of the return.");
    const lt = f("cashLoans:269SS"), lr = f("cashLoans:269T"), st = f("cash269ST");
    add("31(a)", "Loans or deposits taken or accepted otherwise than by bank (section 269SS)", ["Date", "Lender", "Amount"], lt ? lt.rows.map(r => [fmtDate(tallyDate(r.date)), r.party, r.amount]) : [], lt ? "" : "None found in cash.");
    // Form 3CD as amended in 2016-17: 31(b) specified sums taken (269SS), 31(ba)-(bd) 269ST, 31(c) repayments (269T)
    add("31(b)", "Specified sums (advances for the transfer of immovable property) taken or accepted otherwise than by bank (section 269SS)", ["Date", "From", "Amount"], [], "Not told apart in the books; answer from the records.");
    add("31(ba)", "Receipts of \u20b92 lakh or more otherwise than by bank (section 269ST)", ["Date", "From", "Amount"], st ? st.rows.map(r => [fmtDate(tallyDate(r.date)), r.party, r.amount]) : [], st ? "" : "None found.");
    const c2 = c3 ? c3.rows.filter(r => num(r.amount) >= 200000) : [];
    add("31(bc)", "Payments of \u20b92 lakh or more otherwise than by bank (section 269ST)", ["Date", "To", "Amount"], c2.map(r => [fmtDate(tallyDate(r.date)), r.party, r.amount]), (c2.length ? "" : "None found. ") + "From the cash paid to one party in a day (40A(3)); a payment for one bill over several days is checked by hand.");
    add("31(c)", "Repayments of loans or deposits otherwise than by bank (section 269T)", ["Date", "To", "Amount"], lr ? lr.rows.map(r => [fmtDate(tallyDate(r.date)), r.party, r.amount]) : [], lr ? "" : "None found in cash.");
    // 34(a): section by section, from the deductions and what was missed
    const fy = TDS.fyOf(to), rows34 = {};
    TDS.allRows().filter(r => r.date >= from && r.date <= to).forEach(r => { const x = rows34[r.section] = rows34[r.section] || {paid: 0, tds: 0, n: 0, low: 0}; x.paid = r2(x.paid + r.paid); x.tds = r2(x.tds + r.tds); x.n++; });
    ["Q1", "Q2", "Q3", "Q4"].forEach(q => Certs.issues(fy, q).filter(x => x.short > 0 && x.row.date >= from && x.row.date <= to).forEach(x => { const y = rows34[x.row.section]; if (y) y.low++; }));
    // (review of 22-Nov-2026) what was paid or credited without deduction is each finding's base (the part TDS does not
    // cover), added once to what the deductions were made on
    const miss = {}; tm.forEach(x => { const s2 = x.section || "?"; miss[s2] = r2((miss[s2] || 0) + num(x.base != null ? x.base : tot(x))); });
    Object.keys(rows34).forEach(k2 => { if (!k2){ rows34["not set (a TDS ledger with no section)"] = rows34[k2]; delete rows34[k2]; } });
    add("34(a)", "Tax deducted at source, section by section", ["Section", "Paid or credited", "On which tax was to be deducted", "Tax deducted", "Deductions at a lower rate", "Paid or credited without deduction"],
      Object.keys(Object.assign({}, rows34, miss)).sort().map(s2 => { const x = rows34[s2] || {paid: 0, tds: 0, low: 0}; return [s2, x.paid + (miss[s2] || 0), x.paid + (miss[s2] || 0), x.tds, x.low, miss[s2] || 0]; }),
      "Salary under section 192 is from the books; confirm it against the salary sheet.");
    const il = f("tdsLate");
    add("34(c)", "Interest under section 201(1A)", ["Deductee", "Interest", "Detail"], il ? il.rows.map(r => [r.party, r.amount, r.note]) : [], il ? "" : "No late payment found among the challans entered.");
    const ln = f("related:loans");
    add("36A", "Deemed dividend under section 2(22)(e)", ["Person", "Relation", "Amount"], ln ? ln.rows.map(r => [r.party, r.type, r.amount]) : [], ln ? "Only where the person holds 10% or more of the shares, or has such an interest in the borrower." : "No loans to related persons found.");
    const pl = MIS.pl(from, to), rev = (pl.heads.rev || {t: 0}).t;
    add("40", "Turnover and ratios", ["Item", "This year"], [["Turnover", rev], ["Gross profit", pl.gross.t], ["Gross profit to turnover", rev ? (Math.round(pl.gross.t / rev * 10000) / 100) + "%" : ""], ["Net profit before tax", pl.pbt.t], ["Net profit to turnover", rev ? (Math.round(pl.pbt.t / rev * 10000) / 100) + "%" : ""]],
      "Before the change in stock; add the stock figures from the accounts.");
    // 44: expenditure by the GST status of the supplier
    const info = b.ledInfo || {}, gst = b.gstins || {}, g44 = {exempt: 0, comp: 0, other: 0, unreg: 0, total: 0};
    (b.vouchers || []).forEach(v => {
      if (v.date < from || v.date > to || v.opt || v.cancel || Books.isSale(v)) return;
      // (review of 22-Nov-2026) expenditure on goods and services only: not depreciation, provisions or employees' pay (no
      // supply under Schedule III of the CGST Act), and not an entry with no supplier, cash or bank side (a book entry)
      const val = v.ent.filter(e => e.a < 0 && (this.isExpense(e.l) || this.under(e.l, /^purchase accounts$/i) || this.isFixed(e.l)) && !/DEPRECIATION|AMORTI[SZ]|PROVISION|SALAR|WAGES|BONUS|GRATUITY|STIPEND|STAFF WELFARE|EMPLOYEE|PROVIDENT|\bE?PF\b|\bESIC?\b|LEAVE ENCASH|REMUNERATION/i.test(e.l)).reduce((s, e) => s - e.a, 0);
      if (!val || !v.ent.some(e => e.a > 0 && (this.isPerson(e.l) || this.isCash(e.l) || this.isBankL(e.l) || gst[e.l]))) return;
      const party = (v.ent.find(e => e.a > 0 && (gst[e.l] || this.isCreditor(e.l))) || {}).l || v.party, g = gst[party] || v.gstin, rt = String((info[party] || {}).regType || "");
      const tax = v.ent.some(e => { const k = Books.ledgerOf(e.l).kind; return e.a < 0 && (k === "gst" || k === "gst_common" || k === "ineligible"); });
      g44.total += val;
      if (!g) g44.unreg += val; else if (/composition/i.test(rt)) g44.comp += val; else if (!tax) g44.exempt += val; else g44.other += val;
    });
    add("44", "Break-up of expenditure by the GST status of the supplier", ["Total expenditure", "Registered: exempt or nil", "Registered: composition", "Registered: others", "Total with registered suppliers", "With unregistered suppliers"],
      [[r2(g44.total), r2(g44.exempt), r2(g44.comp), r2(g44.other), r2(g44.exempt + g44.comp + g44.other), r2(g44.unreg)]],
      "Purchases, expenses and fixed assets booked in the period; \u201cexempt or nil\u201d is a registered supplier's bill with no GST on it. Composition dealers are recognised from their GST type in Tally.");
    return {from, to, at: run.at, code: run.code, clauses: C};
  },
  async form3cdExcel(run){
    const d = this.form3cd(run);
    await ensureXlsx();
    const wb = XLSX.utils.book_new();
    d.clauses.forEach(c => XLSX.utils.book_append_sheet(wb, (typeof FC === "object" && FC.sheet ? FC.sheet : XLSX.utils.aoa_to_sheet)([["Clause " + c.no + ". " + c.title], c.head].concat(c.rows).concat(c.note ? [[], [c.note]] : [])), ("Cl " + c.no).replace(/[\\/?*\[\]:]/g, " ").slice(0, 31)));
    saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-3CD-working-" + run.from + "-" + run.to + ".xlsx", new Blob([XLSX.write(wb, {bookType: "xlsx", type: "array"})], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  },
  form3cdHtml(d){
    const co = CO(), m = v => typeof v === "number" ? INR.format(r2(v)) : esc(String(v == null ? "" : v));
    let h = '<div style="border-bottom:2px solid #15201B;padding-bottom:8px;margin-bottom:12px"><div style="font-size:12px;color:#5A6B63">FORM 3CD \u2014 WORKING FROM THE BOOKS</div><h1 style="font-size:20px;margin:4px 0">' + esc(co.name) + "</h1>" +
      "<div>" + fmtDate(tallyDate(d.from)) + " to " + fmtDate(tallyDate(d.to)) + " \u00b7 from the audit run of " + fmtDate(String(d.at).slice(0, 10)) + " \u00b7 result code " + esc(d.code || "") + "</div>" +
      '<p class="note">The clauses the books answer. Every figure is to be verified against the documents before it goes into the report on the portal. Other clauses are filled from the records.</p></div>';
    d.clauses.forEach(c => {
      h += '<h2 style="font-size:14px;margin:14px 0 4px">Clause ' + esc(c.no) + ". " + esc(c.title) + "</h2>";
      const n = gfN(200);
      if (c.rows.length) h += "<table><thead><tr>" + c.head.map(x => "<th>" + esc(x) + "</th>").join("") + "</tr></thead><tbody>" + c.rows.slice(0, n).map(r => "<tr>" + r.map(v => '<td class="' + (typeof v === "number" ? "n" : "") + '">' + m(v) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
      if (c.rows.length > n) h += '<p class="note">' + INR.format(c.rows.length - n).replace(/\.00$/, "") + " more rows are in the Excel.</p>";
      if (c.note) h += '<p class="note">' + esc(c.note) + "</p>";
    });
    return h;
  }
};
if (typeof Audit === "object") Object.assign(Audit, AuditRep);
if (typeof Engine === "object") Engine.keep(AuditRep, "Audit");
const AuditRel = {
  // who might be related: people and firms in loans, capital and director ledgers
  relatedGuess(){
    const b = S.books, have = new Set((b.auditRel || []).map(x => x.name)), out = [];
    Object.keys(Object.assign({}, b.ledInfo || {}, b.map || {})).sort().forEach(l => {
      if (have.has(l)) return;
      let why = "";
      if (/DIRECTOR|PARTNER|PROPRIETOR|DRAWINGS|\(CAPITAL\)|CURRENT A\/C/i.test(l)) why = "the name";
      else if (this.under(l, /^(unsecured loans)$/i)) why = "an unsecured loan";
      else if (this.under(l, /^loans & advances \(asset\)$/i) && !/DEDUCTION|STAFF|EMPLOYEE/i.test(l)) why = "a loan given";
      else if (this.under(l, /^loans \(liability\)$/i) && !/BANK|FINANCE|FINNACE|NBFC|HOUSING|CAPITAL|SERVICES/i.test(l)) why = "a loan from a person";
      if (why) out.push({name: l, why});
    });
    return out;
  }
};
if (typeof Audit === "object") Object.assign(Audit, AuditRel);
// (next-speed-worker: the Audit screen's alone, never the engine's: src/js/06 Engine.pure)
if (typeof Engine === "object") Engine.keep(AuditRel, "Audit");
/* @react-lazy: end */
