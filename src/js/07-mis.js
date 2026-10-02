/* ================================================================== */
/* MIS: the books summed up for the owner, for any period, by rules   */
/* ================================================================== */
// Receivables, payables and advances (review of 02-Oct-2026: MIS, Reports, Audit and Letters each worked them out their
// own way and gave four different figures for the same balance). One place: each customer's and supplier's balance in
// the books on the day; a customer in debit is owed to you, in credit an advance received; a supplier in credit is owed
// by you, in debit an advance paid. MIS ages these, Reports and Letters show them, Audit flags them.
const Parties = {
  position(asOn){
    const b = S.books || {}, tb = b.tb, fs = Audit.fyStart(asOn), base = tb && tb.from > fs && tb.from <= asOn ? tb.from : fs;
    const key = [b.cid, asOn, base, (b.vouchers || []).length, (tb || {}).at || "", b.mapV || 0].join("|");
    if (this._p && this._p.key === key && this._p.b === b) return this._p.r;
    let B; try { B = Audit.balances(base, asOn); } catch (e){ B = {ok: false, why: e.message}; }
    let r;
    if (!B.ok) r = {ok: false, why: B.why};
    else {
      const at = B.at(asOn), rows = {r: [], p: []};
      let owed = 0, custAdv = 0, youOwe = 0, supAdv = 0;
      Object.keys(at).forEach(l => {
        const d = r2(-num(at[l]));                               // a debit balance as a positive figure, to the paisa
        if (Math.abs(d) < 0.005) return;
        if (Audit.isDebtor(l)){ rows.r.push({l, dr: d}); if (d > 0) owed += d; else custAdv -= d; }
        else if (Audit.isCreditor(l)){ rows.p.push({l, dr: d}); if (d < 0) youOwe -= d; else supAdv += d; }
      });
      r = {ok: true, asOn, src: B.src, at, rows, owed: r2(owed), custAdv: r2(custAdv), youOwe: r2(youOwe), supAdv: r2(supAdv)};
    }
    this._p = {key, b, r};
    return r;
  }
};
const MIS = {
  cfg(b){ return Object.assign({freq: "monthly", msmeDays: 45}, (b && b.misCfg) || {}); },
  ym(d){ return String(d).slice(0, 6); },
  monthsOf(from, to){ const out = []; let y = num(from.slice(0, 4)), m = num(from.slice(4, 6)); while (String(y) + String(m).padStart(2, "0") <= to.slice(0, 6)){ out.push(String(y) + String(m).padStart(2, "0")); m++; if (m > 12){ m = 1; y++; } } return out; },
  shift(d, years, days){ const t = new Date(Audit.iso(d) + "T00:00:00"); if (years) t.setFullYear(t.getFullYear() + years); if (days) t.setDate(t.getDate() + days); return t.getFullYear() + String(t.getMonth() + 1).padStart(2, "0") + String(t.getDate()).padStart(2, "0"); },
  covered(from){ const f = String((S.books.meta || {}).from || ""); return !!f && f <= from; },
  // what each ledger is, for the profit and loss
  head(l){
    const A = Audit, p = A.path(l).map(g => g.toLowerCase());
    const has = g => p.includes(g);
    if (has("sales accounts")) return "rev";
    if (has("direct incomes")) return "rev";
    if (has("indirect incomes")) return "oth";
    if (has("purchase accounts")) return "pur";
    if (has("direct expenses")) return "dir";
    if (has("indirect expenses")){
      if (/SALAR|WAGES|BONUS|STAFF|GRATUITY|\bPF\b|\bESI\b|EMPLOYEE|INCENTIVE|LEAVE/i.test(l)) return "emp";
      if (/INTEREST|FINANCE CHARGE|PROCESSING FEE|LOAN CHARGE/i.test(l) && !/INTEREST ON (TDS|GST|INCOME TAX)/i.test(l)) return "fin";
      if (/DEPRECIATION|AMORTI/i.test(l)) return "dep";
      if (/INCOME TAX|PROVISION FOR TAX|DEFERRED TAX/i.test(l)) return "tax";
      return "exp";
    }
    // a group of the company's own under Primary: its nature in Tally says what it is
    if (p.length && typeof FS !== "undefined"){
      const n = FS.nature(l);
      if (n.rev){ const w = FS.place(l, 0, "co"); return w === "mat" ? "pur" : w === "exc" ? "exp" : w; }
      if ((S.books || {}).groupInfo && S.books.groupInfo[n.top]) return "";
    }
    if (!p.length){
      const k = Books.ledgerOf(l).kind;
      if (k) return "";
      if (/^SALES|SERVICE RENDERED|REVENUE/i.test(l)) return "rev";
      if (/^PURCHASE/i.test(l)) return "pur";
    }
    return "";
  },
  HEADS: [["rev", "Revenue from operations", 1], ["oth", "Other income", 1], ["pur", "Purchases", -1], ["dir", "Direct expenses", -1], ["emp", "Employee costs", -1],
    ["exp", "Other expenses", -1], ["fin", "Finance costs", -1], ["dep", "Depreciation", -1], ["tax", "Tax", -1]],
  // amounts by ledger and month for a set of vouchers (credit positive, as Tally keeps it)
  moves(from, to){
    const out = {};
    (S.books.vouchers || []).forEach(v => {
      if (v.date < from || v.date > to || v.opt || v.cancel) return;
      const ym = this.ym(v.date);
      v.ent.forEach(e => { const x = out[e.l] = out[e.l] || {}; x[ym] = r2((x[ym] || 0) + e.a); x.t = r2((x.t || 0) + e.a); });
    });
    return out;
  },
  pl(from, to){
    const mv = this.moves(from, to), months = this.monthsOf(from, to), heads = {};
    Object.entries(mv).forEach(([l, x]) => {
      let h = this.head(l), flag = ""; if (!h) return;
      // an expense ledger in credit for the period is income, under Other income, flagged (as the accounts: FS.creditExpense)
      if (["exp", "dir", "emp", "fin", "dep"].includes(h) && num(x.t) > 0.004){ h = "oth"; flag = "expense ledger with a credit balance"; }
      const sign = (this.HEADS.find(z => z[0] === h) || [0, 0, -1])[2];
      const H = heads[h] = heads[h] || {t: 0, m: {}, led: []};
      const row = {l, t: r2(x.t * sign), m: {}}; if (flag) row.flag = flag;
      months.forEach(m => { row.m[m] = r2((x[m] || 0) * sign); H.m[m] = r2((H.m[m] || 0) + row.m[m]); });
      H.t = r2(H.t + row.t); H.led.push(row);
    });
    Object.values(heads).forEach(H => H.led.sort((a, c) => Math.abs(c.t) - Math.abs(a.t) || a.l.localeCompare(c.l)));
    const g = k => (heads[k] || {t: 0}).t, gm = (k, m) => ((heads[k] || {m: {}}).m[m] || 0);
    const calc = f => ({t: r2(f(g)), m: Object.fromEntries(months.map(m => [m, r2(f(k => gm(k, m)))]))});
    return {months, heads,
      income: calc(x => x("rev") + x("oth")),
      gross: calc(x => x("rev") - x("pur") - x("dir")),
      ebitda: calc(x => x("rev") + x("oth") - x("pur") - x("dir") - x("emp") - x("exp")),
      pbt: calc(x => x("rev") + x("oth") - x("pur") - x("dir") - x("emp") - x("exp") - x("fin") - x("dep")),
      pat: calc(x => x("rev") + x("oth") - x("pur") - x("dir") - x("emp") - x("exp") - x("fin") - x("dep") - x("tax"))};
  },
  // bill by bill: what each party owed or was owed on a date
  bills(asOn, side){
    const A = Audit, b = S.books, ref = {};
    const want = l => side === "r" ? A.isDebtor(l) : A.isCreditor(l);
    (b.vouchers || []).forEach(v => {
      if (v.date > asOn || v.opt || v.cancel) return;
      v.ent.forEach(e => {
        if (!want(e.l)) return;
        const alloc = e.b && e.b.length ? e.b : [["", "On Account", e.a]];
        alloc.forEach(([name, type, amt, days]) => {
          const k = e.l + "|" + (type === "On Account" || !name ? "\u0000" : name);
          const x = ref[k] = ref[k] || {party: e.l, ref: type === "On Account" || !name ? "" : name, date: "", amt: 0, first: v.date, no: ""};
          const signed = side === "r" ? -amt : amt;            // what is owed to us (r) or by us (p)
          if ((type === "New Ref" || type === "Advance") && !x.date){ x.date = v.date; x.no = v.no; x.hasNew = true; if (type === "New Ref" && days > 0) x.days = days; }
          x.amt = r2(x.amt + signed);
        });
      });
    });
    // age: days since the bill (MSME's 45 days, reminders and Look up count from here). od (review of 01-Oct-2026): what
    // the ageing goes by, the days overdue from the due date (bill date + Tally's credit days; nought while not yet due),
    // or the age when the bill has no credit period
    return Object.values(ref).filter(x => Math.abs(x.amt) >= 0.5).map(x => {
      const date = x.date || x.first, due = x.days ? this.shift(date, 0, x.days) : "", age = Audit.days(date, asOn);
      return Object.assign(x, {date, due, age, od: due ? Math.max(0, Audit.days(due, asOn)) : age});
    });
  },
  BUCKETS: [[30, "0\u201330"], [60, "31\u201360"], [90, "61\u201390"], [180, "91\u2013180"], [1e9, "over 180"]],
  ageing(asOn, side, bal){
    // the balances on the day, as everywhere else (Parties.position) when the caller has none
    if (!bal){ const P = Parties.position(asOn); if (P.ok) bal = P.at; }
    const bills = this.bills(asOn, side), by = {}, msme = this.msme();
    bills.forEach(x => {
      const p = by[x.party] = by[x.party] || {party: x.party, total: 0, b: [0, 0, 0, 0, 0], adv: 0, unalloc: 0, pre: 0, oldest: 0, bills: [], msme: msme[x.party] || ""};
      if (!x.ref){ p.unalloc = r2(p.unalloc + x.amt); }
      else if (!x.hasNew){ p.pre = r2(p.pre + x.amt); }                // a bill from before the books read here
      else if (x.amt < 0){ p.adv = r2(p.adv + x.amt); }
      else { const a = x.od != null ? x.od : x.age, i = this.BUCKETS.findIndex(([d]) => a <= d); p.b[i] = r2(p.b[i] + x.amt); p.oldest = Math.max(p.oldest, a); }
      p.total = r2(p.total + x.amt); p.bills.push(x);
    });
    // a party with a balance but no bill in the books read (an opening balance carried in) is owed too (review of
    // 02-Oct-2026: MIS left these out, so its receivables were lower than the books'); all of it is "not dated"
    if (bal) Object.keys(bal).forEach(l => { if (by[l] || Math.abs(num(bal[l])) < 0.005 || !(side === "r" ? Audit.isDebtor(l) : Audit.isCreditor(l))) return;
      by[l] = {party: l, total: 0, b: [0, 0, 0, 0, 0], adv: 0, unalloc: 0, pre: 0, oldest: 0, bills: [], msme: msme[l] || "", noBills: true}; });
    const rows = Object.values(by);
    // the control: the party's balance in Tally against the bills
    if (bal) rows.forEach(p => { const tb = bal[p.party]; if (tb != null){ p.tally = r2(side === "r" ? -tb : tb); p.diff = r2(p.tally - p.total); } });
    rows.forEach(p => { p.bills.sort((a, c) => String(a.date).localeCompare(String(c.date)) || String(a.ref).localeCompare(String(c.ref))); });
    rows.sort((a, c) => c.total - a.total || a.party.localeCompare(c.party));
    const sum = rows.reduce((s, p) => ({total: r2(s.total + p.total), b: s.b.map((v, i) => r2(v + p.b[i])), adv: r2(s.adv + p.adv), unalloc: r2(s.unalloc + p.unalloc), pre: r2(s.pre + p.pre), tally: p.tally != null ? r2((s.tally || 0) + p.tally) : s.tally}), {total: 0, b: [0, 0, 0, 0, 0], adv: 0, unalloc: 0, pre: 0, tally: null});
    sum.open = r2(sum.b.reduce((a, v) => a + v, 0));
    // review of 01-Oct-2026 / 02-Oct-2026: what each party owes on balance (Tally's balance when known, else its bills),
    // aged so the ages add up to it: payments on account, advances, older settlements and any difference to Tally are
    // set against the oldest bills first (MIS.netOpen, the same as the 13-week forecast); an amount owed that no bill
    // dates is "not bill-wise". A party whose balance runs the other way (a supplier with a debit balance) owes nothing
    // here: it is an advance, shown on its own, as a positive figure
    rows.forEach(p => {
      const o = this.netOpen(p), nb = this.BUCKETS.map(() => 0);
      o.open.forEach(x => { const a = x.od != null ? x.od : x.age, i = this.BUCKETS.findIndex(([d]) => a <= d); nb[i] = r2(nb[i] + x.left); });
      p.net = o.net; p.open = o.open; p.nb = nb; p.und = o.und; p.advance = o.advance; p.owe = o.owe;
    });
    sum.owe = r2(rows.reduce((a, p) => a + Math.max(0, p.net), 0));
    sum.advance = r2(rows.reduce((a, p) => a + p.advance, 0));
    sum.nb = MIS.BUCKETS.map((_, i) => r2(rows.reduce((a, p) => a + p.nb[i], 0)));
    sum.und = r2(rows.reduce((a, p) => a + p.und, 0));
    // review of 02-Oct-2026: the parties whose ledger balance and bills do not agree (the difference is the ledger balance
    // less the bills' total), largest first, for the line at the top of Receivables and Payables
    sum.differ = rows.filter(p => p.diff != null && Math.abs(p.diff) >= 1).sort((a, c) => Math.abs(c.diff) - Math.abs(a.diff) || a.party.localeCompare(c.party))
      .map(p => ({party: p.party, bills: p.total, ledger: p.tally, diff: p.diff}));
    sum.diff = r2(rows.reduce((a, p) => a + (p.diff || 0), 0));
    return {rows, sum};
  },
  // review of 02-Oct-2026 (Note 10 and MIS's buckets added up to 1.61 crore against receivables of 1.12 crore; the
  // 13-week forecast expected 1.57 crore in its first week): one party's open bills net of what it paid on account, its
  // advances, settlements of bills older than these books and any difference to its ledger balance. Those are set
  // against the oldest bills first, so what is left of the bills never exceeds the balance; what is owed and no bill
  // dates is one "not bill-wise" amount. p is a row of the ageing (its bills and its ledger balance, tally, when known)
  netOpen(p){
    const net = r2(p.tally != null ? p.tally : p.total), owe = Math.max(0, net);
    const bills = (p.bills || []).filter(x => x.ref && x.hasNew && x.amt > 0)
      .sort((a, c) => String(a.date).localeCompare(String(c.date)) || String(a.ref).localeCompare(String(c.ref)));
    let less = r2(bills.reduce((a, x) => a + x.amt, 0) - owe);   // what the bills carry beyond the balance
    const open = [];
    bills.forEach(x => { const t = Math.max(0, Math.min(x.amt, less)); less = r2(less - t); const left = r2(x.amt - t); if (left >= 0.005) open.push(Object.assign({}, x, {left})); });
    const und = r2(owe - open.reduce((a, x) => a + x.left, 0));
    return {net, owe: r2(owe), open, und: und >= 0.005 ? und : 0, advance: net < 0 ? r2(-net) : 0};
  },
  msme(){
    const out = {}, info = S.books.ledInfo || {}, set = S.books.msme || {};
    Object.entries(info).forEach(([n, x]) => { if (x.msme) out[n] = x.msme; });
    Object.entries(set).forEach(([n, v]) => { if (v) out[n] = v; else delete out[n]; });
    return out;
  },
  sales(from, to){
    const by = {}, months = this.monthsOf(from, to), byState = {}, byReg = {};
    // review of 01-Oct-2026: with the masters read, sales are the Sales Accounts ledgers themselves (credit positive, a
    // credit note's debit taking off), as Tally's profit and loss shows them: the taxable value of a sale entry counted a
    // customer's own line in some entries (1,49,860 too much on one client's year). Direct and indirect incomes are
    // kept apart, as other income. Without the masters, the taxable value of the sale entries, as before
    const masters = Audit.mastersIn(), A = Audit;
    let other = 0;
    (S.books.vouchers || []).forEach(v => {
      if (v.date < from || v.date > to || v.opt || v.cancel) return;
      if (masters){
        v.ent.forEach(e => { if (A.under(e.l, /^(direct|indirect) incomes$/i)) other = r2(other + e.a); });
        const sa = v.ent.filter(e => A.under(e.l, /^sales accounts$/i));
        if (!sa.length) return;
      } else if (!Books.isSale(v)) return;
      const L = masters ? null : Books.lines(v), sign = /CREDIT NOTE/i.test(v.type) ? -1 : 1;
      const amt = masters ? r2(v.ent.filter(e => A.under(e.l, /^sales accounts$/i)).reduce((t, e) => t + e.a, 0)) : r2(L.taxable * sign), ym = this.ym(v.date);
      if (!amt) return;
      // an entry with no party name: the customer is its debtor line (or the line taking the other side)
      const who = v.party || (v.ent.find(e => Audit.isDebtor(e.l)) || v.ent.find(e => (e.a < 0) !== (amt < 0) && !Audit.under(e.l, /^sales accounts$/i)) || {}).l || "\u2014";
      const p = by[who] = by[who] || {party: who, t: 0, m: {}, n: 0}; p.t = r2(p.t + amt); p.m[ym] = r2((p.m[ym] || 0) + amt); p.n++;
      const st = v.pos || "\u2014"; byState[st] = r2((byState[st] || 0) + amt);
      const rg = GSTR.regOf(v) || "\u2014"; byReg[rg] = r2((byReg[rg] || 0) + amt);
    });
    const rows = Object.values(by).sort((a, c) => c.t - a.t || a.party.localeCompare(c.party));
    const total = r2(rows.reduce((s, x) => s + x.t, 0));
    const before = new Set((S.books.vouchers || []).filter(v => v.date < from && Books.isSale(v)).map(v => v.party));
    return {rows, total, other, months, byState: Object.entries(byState).sort((a, c) => c[1] - a[1]), byReg: Object.entries(byReg).sort((a, c) => a[0].localeCompare(c[0])),
      top5: rows.slice(0, 5).reduce((s, x) => s + x.t, 0), fresh: this.covered(this.shift(from, -1)) ? rows.filter(x => !before.has(x.party)).length : null};
  },
  purchases(from, to){
    const A = Audit, by = {}, months = this.monthsOf(from, to);
    (S.books.vouchers || []).forEach(v => {
      if (v.date < from || v.date > to || Books.isSale(v) || v.opt || v.cancel) return;
      const p = v.ent.find(e => e.a > 0 && A.isCreditor(e.l));
      if (!p) return;
      const val = r2(v.ent.filter(e => e.a < 0 && (A.isExpense(e.l) || A.under(e.l, /^purchase accounts$/i) || A.isFixed(e.l))).reduce((s, e) => s - e.a, 0));
      if (!val) return;
      const ym = this.ym(v.date), x = by[p.l] = by[p.l] || {party: p.l, t: 0, m: {}, n: 0};
      x.t = r2(x.t + val); x.m[ym] = r2((x.m[ym] || 0) + val); x.n++;
    });
    const rows = Object.values(by).sort((a, c) => c.t - a.t || a.party.localeCompare(c.party));
    // expense heads by month, and the months that jumped
    const mv = this.moves(from, to), heads = [];
    Object.entries(mv).forEach(([l, x]) => {
      if (!(A.isExpense(l) || A.under(l, /^purchase accounts$/i))) return;
      const row = {l, t: r2(-x.t), m: {}}; months.forEach(m => { row.m[m] = r2(-(x[m] || 0)); });
      const vals = months.map(m => row.m[m]);
      row.jumps = months.filter((m, i) => { const others = vals.filter((_, j) => j !== i); const avg = others.length ? others.reduce((s, v) => s + v, 0) / others.length : 0; return vals[i] >= 50000 && avg > 0 && vals[i] > avg * 1.5; });
      heads.push(row);
    });
    heads.sort((a, c) => c.t - a.t || a.l.localeCompare(c.l));
    return {rows, months, heads, total: r2(rows.reduce((s, x) => s + x.t, 0))};
  },
  cashflow(from, to){
    let rec = 0, pay = 0;
    (S.books.vouchers || []).forEach(v => {
      if (v.date < from || v.date > to || v.opt || v.cancel || /CONTRA/i.test(v.type)) return;
      v.ent.forEach(e => { if (Audit.isCash(e.l) || Audit.isBankL(e.l)){ if (e.a < 0) rec = r2(rec - e.a); else pay = r2(pay + e.a); } });
    });
    return {rec, pay};
  },
  // review of 02-Oct-2026: what was paid is what the books show paid, not a working. GST: worked out to pay (after credit,
  // FinCom's working from the books, not the 3B filed) beside what was paid from the bank to the GST ledgers (GST payable
  // or the electronic cash ledger). TDS: deducted is what the TDS ledgers were credited with; paid is what they were
  // debited with from the bank; challans typed or brought in are counted on their own
  booksPaid(from, to){
    const m = {};
    (S.books.vouchers || []).forEach(v => {
      if (v.date < from || v.date > to || v.opt || v.cancel) return;
      const k = this.ym(v.date), x = m[k] = m[k] || {gst: 0, tdsDed: 0, tdsPaid: 0};
      const L = Books.lines(v);
      L.tds.forEach(t => { x.tdsDed = r2(x.tdsDed + t.amount); }); L.tdsPaid.forEach(t => { x.tdsPaid = r2(x.tdsPaid + t.amount); });
      if (!v.ent.some(e => e.a > 0 && Books.ledgerOf(e.l).kind === "bank")) return;
      v.ent.forEach(e => { if (e.a < 0 && this.gstPaidTo(e.l)) x.gst = r2(x.gst - e.a); });
    });
    return m;
  },
  // GST paid to the government: a ledger of tax owed (GST payable or the electronic cash ledger, an output tax ledger,
  // reverse charge payable) debited by a bank payment. The one rule for Compliance's "paid from the bank" and the cash
  // flow's GST line (review of 02-Oct-2026: the cash flow also counted 10,080 of input IGST debited by two IDFC payments
  // of 18-Sep-2025, nos. 855 and 859, which is credit taken on a purchase, not tax paid)
  gstPaidTo(l){
    const w = Books.ledgerOf(l);
    return w.what === "gst_setoff" || ((w.kind === "gst" || w.kind === "gst_common") && w.side === "output") || (w.what === "gst_rcm" && w.side === "output");
  },
  // TDS payable over the period (review of 02-Oct-2026: "Deducted less paid" left out what was owed at the start):
  // opening + deducted - paid = closing, with the closing as the TDS ledgers' balance in the books to check it
  tdsPayable(from, to){
    const tdsL = l => ["tds_payable", "tds_clearing"].includes(Books.ledgerOf(l).kind);
    // the opening is the balances on the day before the period (with the books' opening balances), from the same source
    let B = null; try { B = Audit.balances(from, to); } catch (e){}
    const owed = d => { if (!B || !B.ok) return null; const at = B.at(d); return r2(Object.keys(at).filter(tdsL).reduce((a, l) => a + num(at[l]), 0)); };   // a credit (owed) is positive here
    const p = this.booksPaid(from, to), ded = r2(Object.values(p).reduce((a, x) => a + x.tdsDed, 0)), paid = r2(Object.values(p).reduce((a, x) => a + x.tdsPaid, 0));
    const open = owed(Audit.dayBefore(from)) || 0, close = r2(open + ded - paid), books = owed(to);
    return {open, ded, paid, close, books, ties: books == null || Math.abs(books - close) < 1};
  },
  compliance(from, to){
    const months = this.monthsOf(from, to), paid = this.booksPaid(from, to);
    // worked out to pay: the 3B working's cash (after the set-off by head and credit carried forward) and reverse charge
    // paid in cash; paid: the bank payments to the GST ledgers (review of 02-Oct-2026)
    const sum4 = x => r2(["igst", "cgst", "sgst", "cess"].reduce((a, k) => a + num((x || {})[k]), 0));
    // review of 02-Oct-2026: the 3B working's cash already holds reverse charge (GSTR.setOff: cash = what credit did not
    // cover + reverse charge); adding rcmCash again counted it twice (Apr-2025: 4,860 = 2 x 2,430, the reverse charge on
    // Jitin & Co.'s bill 5063 of 30-Apr-2025). Each row now adds up: output - credit + reverse charge + credit
    // carried over (credit brought in from the month before, less credit left for the next) = worked out to pay
    const gst = months.map(m => { const pd = (paid[m] || {}).gst || 0; try { const t = GSTR.threeB(m, ""); const out = sum4(t.net), itc = sum4(t.netItc);
      const rcm = t.pay && t.pay.rcmCash ? sum4(t.pay.rcmCash) : 0;
      const due = t.pay && t.pay.cash ? sum4(t.pay.cash) : r2(Math.max(0, out - itc) + rcm);
      return {ym: m, out, itc, rcm, carry: r2(due - (out - itc + rcm)), due, pay: pd}; } catch (e){ return {ym: m, out: 0, itc: 0, rcm: 0, carry: 0, due: 0, pay: pd}; } });
    const tds = months.map(m => {
      const p = paid[m] || {};
      const challans = r2(TDS.challans().filter(c => this.ym(TDS.ymd(c.date)) === m).reduce((s, c) => s + num(c.tax), 0));
      return {ym: m, ded: p.tdsDed || 0, dep: p.tdsPaid || 0, challans};
    });
    const au = (S.books.audit || {}).last;
    let tdsRoll = null; try { tdsRoll = this.tdsPayable(from, to); } catch (e){}
    // an audit run that no longer fits the books is not counted (review of 02-Oct-2026)
    return {gst, tds, tdsRoll, audit: au && !Audit.stale(au) ? {at: au.at, open: au.findings.filter(f => Audit.status(f.id).s === "open").length, high: au.findings.filter(f => f.sev === "high").length, solved: (au.solved || []).reduce((s, x) => s + x.n, 0)} : null};
  },
  // what falls due in the next six weeks, from today (review of 02-Oct-2026: it counted from the end of the report's
  // period, and gave TDS for March as due on 7 April). TDS: the 7th of the next month, but 30 April for March; returns on
  // 31 Jul, 31 Oct, 31 Jan and 31 May. GST by the client's filing type: monthly GSTR-1 on the 11th and 3B on the 20th;
  // quarterly (QRMP) IFF on the 13th and PMT-06 on the 25th after the quarter's first two months, GSTR-1 on the 13th and
  // 3B on the 22nd or 24th after the quarter. Advance tax on 15 Jun, 15 Sep, 15 Dec and 15 Mar.
  dues(asOf){
    const today = Audit.ymd(asOf || Audit.today()), until = this.shift(today, 0, 45), out = [];
    const add = (d, l) => { d = String(d).replace(/-/g, ""); if (d >= today && d <= until) out.push([d, l]); };
    const reg = String((GSTR.gstins(S.books) || [])[0] || (CO() || {}).gstin || "").slice(0, 2);
    // the months whose dues can fall in the window: from three months back
    let ym = this.shift(today, 0, -100).slice(0, 6);
    for (let i = 0; i < 6; i++, ym = GSTR.nextYm(ym)){
      const nx = GSTR.nextYm(ym), mo = +ym.slice(4, 6), lab = GSTR.label(ym);
      add(mo === 3 ? nx.slice(0, 4) + "0430" : nx + "07", "TDS and TCS deposit for " + lab);
      if ([6, 9, 12, 3].includes(mo)){ const q = {6: "Q1", 9: "Q2", 12: "Q3", 3: "Q4"}[mo], d = mo === 3 ? nx.slice(0, 4) + "0531" : mo === 12 ? nx.slice(0, 4) + "0131" : ym.slice(0, 4) + String(mo + 1).padStart(2, "0") + "31";
        add(d, "TDS and TCS returns for " + q + " " + GSTF.fyOf(ym)); }
      if (reg){
        const t = typeof GSTSet === "object" ? GSTSet.typeOf(ym, reg) : "monthly";
        if (t === "monthly"){ add(GSTF.due(ym, "r1", reg), "GSTR-1 for " + lab); add(GSTF.due(ym, "r3b", reg), "GSTR-3B and tax for " + lab); }
        else if (t === "qrmp"){
          if (GSTSet.isQEnd(ym)){ add(GSTF.due(ym, "r1", reg), "GSTR-1 for " + GSTSet.qLabel(ym)); add(GSTF.due(ym, "r3b", reg), "GSTR-3B and tax for " + GSTSet.qLabel(ym)); }
          else { add(GSTF.due(ym, "iff", reg), "IFF for " + lab + " (optional)"); add(GSTF.due(ym, "pmt06", reg), "PMT-06 tax for " + lab); }
        } else if (t === "comp" && GSTSet.isQEnd(ym)) add(GSTF.due(ym, "cmp08", reg), "CMP-08 for " + GSTSet.qLabel(ym));
      }
    }
    [today.slice(0, 4), String(+today.slice(0, 4) + 1)].forEach(y => ["0615", "0915", "1215", "0315"].forEach(md => add(y + md, "Advance tax instalment")));
    return out.sort((a, c) => a[0].localeCompare(c[0]));
  },
  // one run: every table for the period, the same every time for the same books
  run(from, to, how){ return typeof memoScope === "function" ? memoScope(() => this.runNow(from, to, how)) : this.runNow(from, to, how); },
  runNow(from, to, how){
    const b = S.books;
    from = Audit.ymd(from); to = Audit.ymd(to);
    const days = Audit.days(from, to) + 1, lyFrom = this.shift(from, -1), lyTo = this.shift(to, -1);
    // the period before: whole months when the period is whole months, else the same number of days
    let pFrom = this.shift(from, 0, -days), pTo = this.shift(from, 0, -1);
    const endOfMonth = d => { const t = new Date(Audit.iso(d) + "T00:00:00"); t.setDate(t.getDate() + 1); return t.getDate() === 1; };
    if (from.slice(6) === "01" && endOfMonth(to)){
      const k = this.monthsOf(from, to).length, st = new Date(Audit.iso(from) + "T00:00:00"), a = new Date(st.getFullYear(), st.getMonth() - k, 1), e2 = new Date(st.getFullYear(), st.getMonth(), 0);
      const f = z => z.getFullYear() + String(z.getMonth() + 1).padStart(2, "0") + String(z.getDate()).padStart(2, "0");
      pFrom = f(a); pTo = f(e2);
    }
    const bal = Audit.balances(from, to), balTo = bal.ok ? bal.at(to) : null;
    const fyFrom = Audit.fyStart(to), mFrom = to.slice(0, 6) + "01";
    const s = this.sales(from, to), pr = this.purchases(from, to), pl = this.pl(from, to);
    const cmp = (f, t2) => this.covered(f) ? {sales: this.sales(f, t2).total, pl: this.pl(f, t2)} : null;
    const r = {at: new Date().toISOString(), how: how || "run now", from, to, company: (b.meta || {}).company || CO().name,
      sales: s, purchases: pr, pl, prev: cmp(pFrom, pTo), ly: cmp(lyFrom, lyTo), prevRange: [pFrom, pTo], lyRange: [lyFrom, lyTo],
      mtd: this.covered(mFrom) ? this.sales(mFrom, to).total : null, ytd: this.covered(fyFrom) ? this.sales(fyFrom, to).total : null,
      cash: this.cashflow(from, to), recv: this.ageing(to, "r", balTo), pay: this.ageing(to, "p", balTo), comp: this.compliance(from, to), dues: this.dues(),
      balances: bal.ok ? {src: bal.src, cash: Object.keys(balTo).filter(l => Audit.isCash(l)).sort().map(l => [l, r2(-balTo[l])]), bank: Object.keys(balTo).filter(l => Audit.isBankL(l)).sort().map(l => [l, r2(-balTo[l])])} : {why: bal.why}};
    // days of sales or purchases owed: from what is owed on balance; never below nought (an advance is not "negative days")
    // the headline owed to you and by you is the ledger balances (Parties.position), the same figure as Reports and
    // Letters; the ageing only splits it, any part no bill explains shown as not bill-wise (review of 02-Oct-2026)
    const P = Parties.position(to);
    r.owed = P.ok ? {r: P.owed, p: P.youOwe, custAdv: P.custAdv, supAdv: P.supAdv} : null;
    r.dso = r.recv.sum.owe > 0 && s.total > 0 ? Math.round(r.recv.sum.owe / (s.total / days)) : null;
    // days of purchases only for a client that buys goods (Purchase Accounts used in the period): a service firm's bills
    // are expenses, and "days of purchases" says nothing about them (review of 02-Oct-2026)
    const goods = Object.entries(this.moves(from, to)).some(([l, x]) => Audit.under(l, /^purchase accounts$/i) && Math.abs(num(x.t)) >= 1);
    r.goods = goods;
    r.dpo = goods && r.pay.sum.owe > 0 && pr.total > 0 ? Math.round(r.pay.sum.owe / (pr.total / days)) : null;
    r.p2 = this.phase2(r, balTo, bal.ok ? r2(r.balances.cash.concat(r.balances.bank).reduce((s2, x) => s2 + x[1], 0)) : null);
    const md = this.cfg(b).msmeDays, msme = this.msme();
    // what is left of each bill after payments on account and advances (MIS.netOpen), as the ageing
    r.msme = r.pay.rows.filter(p => /micro|small/i.test(msme[p.party] || "")).map(p => ({party: p.party, type: msme[p.party], bills: (p.open || []).filter(x => x.age > md)})).filter(x => x.bills.length)
      .map(x => Object.assign(x, {amt: r2(x.bills.reduce((s2, y) => s2 + y.left, 0))}));
    // the control: every ledger's movement here against Tally's own balances
    if (b.tb && b.tb.from === from && b.tb.to === to){
      const mv = this.moves(from, to); let n = 0, amt = 0; const list = [];
      Object.entries(b.tb.led).forEach(([l, x]) => { const d = r2((num(x.close) - num(x.open)) - ((mv[l] || {}).t || 0)); if (Math.abs(d) >= 1){ n++; amt = r2(amt + Math.abs(d)); list.push([l, d]); } });
      r.control = {ok: n === 0, n, amt, list: list.slice(0, 50)};
    } else r.control = null;
    r.basis = this.basis(b);
    r.code = Audit.hash(JSON.stringify([s.total, pr.total, pl.pat.t, r.recv.sum, r.pay.sum, s.rows.slice(0, 50).map(x => [x.party, x.t]), r.p2.cash.net, r.p2.fc.weeks.map(w => w.net), r.p2.cc.rows.map(x => [x.name, x.profit])]));
    const m = b.mis = b.mis || {};
    m.last = r; m.history = [{at: r.at, from, to, how: r.how, sales: s.total, pat: pl.pat.t, code: r.code}].concat(m.history || []).slice(0, 24);
    return r;
  },
  // what a run was worked out from: the books (entries, Tally's balances, the ledger map, how far read) and FinCom's own
  // working (V, raised whenever a figure is worked out differently). A saved run from other books or other working is
  // worked out again when MIS opens, and its figures are not shown meanwhile (review of 02-Oct-2026: MIS showed the run of
  // 01-Oct, result code 1FB42BF2, with figures since corrected)
  V: 5,                                                       // 4: GST without cancelled entries, cash flow and ratios redone; 5: open bills net of amounts on account, GST paid and RCM, expense credits (review of 02-Oct-2026)
  basis(b){
    b = b || S.books || {};
    const vs = b.vouchers || [], alt = vs.reduce((a, v) => Math.max(a, num(v.alter || v.alterId || 0)), 0);
    return Audit.hash(JSON.stringify([this.V, vs.length, alt, (b.tb || {}).at || "", b.mapV || 0, (b.meta || {}).to || "", (b.meta || {}).at || "", Object.keys(b.ledInfo || {}).length]));
  },
  stale(b){ const r = b && b.mis && b.mis.last; return !!r && r.basis !== this.basis(b); },
  due(b){
    const c = this.cfg(b), last = b.mis && b.mis.last ? String(b.mis.last.at).slice(0, 10).replace(/-/g, "") : "", t = Audit.today();
    if (c.freq === "off" || !(b.vouchers || []).length) return false;
    if (!last) return true;
    if (c.freq === "daily") return last < t;
    if (c.freq === "weekly") return Audit.days(last, t) >= 7;
    return last.slice(0, 6) < t.slice(0, 6);
  },
  // on its own: the month just ended for the monthly pack, else the year so far
  autoRange(b){
    const t = Audit.today(), c = this.cfg(b), last = String((b.meta || {}).to || t), end = last < t ? last : t;
    if (c.freq === "monthly"){ const d = new Date(Audit.iso(t) + "T00:00:00"); const pm = new Date(d.getFullYear(), d.getMonth(), 0); const to = pm.getFullYear() + String(pm.getMonth() + 1).padStart(2, "0") + String(pm.getDate()).padStart(2, "0"); const upto = to <= end ? to : end; return {from: upto.slice(0, 6) + "01", to: upto}; }   // the month just ended, or the last month in the books
    return {from: Audit.fyStart(end), to: end};
  },
  maybeRun(){
    const b = S.books;
    if (!b || !b.vouchers || !this.due(b)) return;
    const r = this.autoRange(b); this.run(r.from, r.to, "on its own (" + this.cfg(b).freq + ")"); saveBooks();
  }
};

/* ---------- MIS, phase 2 ---------- */
Object.assign(MIS, {
  // what a ledger on the other side of a cash or bank line is, for the cash flow
  flowHead(l){
    const A = Audit, m = Books.ledgerOf(l);
    if (A.isDebtor(l)) return ["op", "Received from customers"];
    if (A.isCreditor(l)) return ["op", "Paid to suppliers"];
    // GST paid to the government by the same rule as Compliance (MIS.gstPaidTo); other GST ledgers on a bank line (input
    // tax paid with a bill, interest and late fees) on lines of their own
    if (this.gstPaidTo(l)) return ["op", "GST"];
    if (m.what === "gst_interest" || (/GST/i.test(l) && /INTEREST|LATE FEE|PENALTY/i.test(l))) return ["op", "GST interest and late fees"];
    if (/^(gst|gst_common|ineligible|gst_rcm|gst_import|gst_control)$/.test(m.what || "") || m.kind === "gst" || (A.isDuties(l) && /GST/i.test(l))) return ["op", "Input GST paid with bills"];
    if (/^tds_|^tcs_/.test(m.kind || m.what || "") || /\bTDS\b|\bTCS\b/i.test(l)) return ["op", "TDS and TCS"];
    if (/INCOME TAX|ADVANCE TAX|SELF ASSESSMENT/i.test(l)) return ["op", "Income tax"];
    if (/SALAR|WAGES|BONUS|STAFF|IMPREST|EMPLOYEE|PROVIDENT|\bPF\b|\bESI|ESIC|GRATUITY/i.test(l)) return ["op", "Salaries and staff"];
    if (A.isFixed(l)) return ["inv", "Fixed assets"];
    if (A.under(l, /^(investments|deposits \(asset\))$/i) || /FIXED DEPOSIT|\bFDR?\b|MUTUAL FUND|\bSIP\b|\bFUND\b.*GROWTH/i.test(l)) return ["inv", "Investments and deposits"];
    if (A.isLoan(l) || /\bLOAN\b/i.test(l) && !/INTEREST/i.test(l)) return ["fin", "Loans"];
    if (A.isCapital(l) || A.under(l, /^reserves & surplus$/i)) return ["fin", "Capital and drawings"];
    if (/INTEREST/i.test(l) && !A.isIncome(l)) return ["fin", "Interest paid"];
    if (A.isIncome(l)) return ["op", "Other income received"];
    if (A.isExpense(l)) return ["op", "Expenses paid"];
    return ["op", "Other receipts and payments"];
  },
  // money in and out of cash and bank, month by month, by what it was for (the direct method)
  cashActual(from, to){
    const months = this.monthsOf(from, to), rows = {};
    (S.books.vouchers || []).forEach(v => {
      if (v.date < from || v.date > to || v.opt || v.cancel) return;
      const cb = v.ent.filter(e => Audit.isCash(e.l) || Audit.isBankL(e.l)), other = v.ent.filter(e => !(Audit.isCash(e.l) || Audit.isBankL(e.l)));
      if (!cb.length || !other.length) return;                       // contra: between cash and bank
      // the cash moved is spread over the lines on the other side of it; a line on the same side (tax deducted by the customer) is not cash
      const net = cb.reduce((s, e) => s + e.a, 0), opp = other.filter(e => (e.a > 0) === (net < 0)), tot = opp.reduce((s, e) => s + Math.abs(e.a), 0), ym = this.ym(v.date);
      if (!tot || Math.abs(net) < 0.01) return;
      opp.forEach(e => {
        const share = r2(-net * Math.abs(e.a) / tot);
        // money that came in on a line named for paying (or went out on one named for receiving) has its own line (review
        // of 02-Oct-2026: 48,50,089 received back from suppliers in Feb-2026 sat as "+" under Paid to suppliers, and an
        // income-tax refund of 9,28,480 under Income tax)
        let [sec, lab] = this.flowHead(e.l);
        if (share > 0 && lab === "Paid to suppliers") lab = "Refunds and receipts from suppliers";
        else if (share > 0 && lab === "Income tax") lab = "Tax refunds";
        else if (share < 0 && lab === "Received from customers") lab = "Refunds and payments to customers";
        // money back on an expense ledger (an insurance policy cancelled, an expense recovered) is not a negative payment
        // (review of 02-Oct-2026: "Expenses paid" showed +13,216.62 in Jan-2026 and +734.76 in Mar-2026)
        else if (share > 0 && lab === "Expenses paid") lab = "Expenses refunded or recovered";
        const k = sec + "|" + lab, x = rows[k] = rows[k] || {sec, lab, t: 0, m: {}, led: {}};
        x.t = r2(x.t + share); x.m[ym] = r2((x.m[ym] || 0) + share); x.led[e.l] = r2((x.led[e.l] || 0) + share);
      });
    });
    const list = Object.values(rows).sort((a, c) => ["op", "inv", "fin"].indexOf(a.sec) - ["op", "inv", "fin"].indexOf(c.sec) || c.t - a.t);
    const sec = s2 => ({t: r2(list.filter(x => x.sec === s2).reduce((a, x) => a + x.t, 0)), m: Object.fromEntries(months.map(mm => [mm, r2(list.filter(x => x.sec === s2).reduce((a, x) => a + (x.m[mm] || 0), 0))]))});
    const net = r2(list.reduce((a, x) => a + x.t, 0));
    // cash and bank at the start and the end, from the balances (review of 02-Oct-2026): opening + net change = closing,
    // checked; a difference is an entry that moved cash or bank without a line on the other side
    let open = null, close = null;
    try { const B = Audit.balances(from, to); if (B.ok){ const cb = at => r2(Object.keys(at).filter(l => Audit.isCash(l) || Audit.isBankL(l)).reduce((a, l) => a - num(at[l]), 0));
      open = cb(B.at(Audit.dayBefore(from))); close = cb(B.at(to)); } } catch (e){}
    const diff = open == null ? null : r2(close - open - net);
    return {months, rows: list, op: sec("op"), inv: sec("inv"), fin: sec("fin"), net, open, close, diff, ties: diff == null || Math.abs(diff) < 1};
  },
  median(a){ if (!a.length) return null; const s2 = a.slice().sort((x, y) => x - y), k = Math.floor(s2.length / 2); return s2.length % 2 ? s2[k] : Math.round((s2[k - 1] + s2[k]) / 2); },
  // how long each party takes to settle a bill, from the bills settled in the books
  payDays(side, asOn){
    const A = Audit, want = l => side === "r" ? A.isDebtor(l) : A.isCreditor(l), ref = {};
    (S.books.vouchers || []).filter(v => v.date <= asOn && !v.opt && !v.cancel).sort((a, c) => a.date.localeCompare(c.date)).forEach(v => v.ent.forEach(e => {
      if (!want(e.l) || !e.b) return;
      e.b.forEach(([name, type, amt]) => {
        if (!name || type === "On Account") return;
        const x = ref[e.l + "|" + name] = ref[e.l + "|" + name] || {party: e.l, date: "", bal: 0, done: ""};
        if ((type === "New Ref" || type === "Advance") && !x.date) x.date = v.date;
        x.bal = r2(x.bal + (side === "r" ? -amt : amt));
        if (x.date && Math.abs(x.bal) < 1 && !x.done) x.done = v.date;
      });
    }));
    const by = {};
    Object.values(ref).forEach(x => { if (x.date && x.done && x.done >= x.date) (by[x.party] = by[x.party] || []).push(Audit.days(x.date, x.done)); });
    const out = {}; Object.entries(by).forEach(([p, a]) => { out[p] = this.median(a); });
    const all = [].concat.apply([], Object.values(by));
    out["\u0000all"] = this.median(all) || 30;
    return out;
  },
  weekOf(start, d){ return Math.floor(Audit.days(start, d) / 7); },
  // 13 weeks ahead from the end of the period, by fixed rules
  forecast(to, recv, pay, bal){
    const start = this.shift(to, 0, 1), W = 13, weeks = Array.from({length: W}, (_, i) => ({i, from: this.shift(start, 0, i * 7), to: this.shift(start, 0, i * 7 + 6), inn: 0, out: 0, items: []}));
    const put = (d, amt, what, who, why) => { let w = this.weekOf(start, d); if (w < 0) w = 0; if (w >= W) return; const x = weeks[w]; if (amt > 0) x.inn = r2(x.inn + amt); else x.out = r2(x.out - amt); x.items.push({d: d < start ? start : d, amt: r2(amt), what, who, why}); };
    const rd = this.payDays("r", to), pd = this.payDays("p", to), msme = this.msme(), md = this.cfg(S.books).msmeDays;
    // each party's open bills net of its receipts on account and advances (MIS.netOpen, as the ageing): what is
    // expected from a party never exceeds its ledger balance (review of 02-Oct-2026)
    const openOf = p => p.open || this.netOpen(p).open, part = x => x.left < x.amt - 0.004 ? " (" + INR.format(x.left) + " of " + INR.format(x.amt) + " left after amounts on account)" : "";
    recv.rows.forEach(p => openOf(p).forEach(x => {
      const days = rd[p.party] != null ? rd[p.party] : rd["\u0000all"], due = this.shift(x.date, 0, days);
      put(due, x.left, "Collections", p.party, "bill " + x.ref + part(x) + (due < start ? ", overdue: taken in week 1" : ", usually paid in " + days + " days"));
    }));
    pay.rows.forEach(p => openOf(p).forEach(x => {
      let days = pd[p.party] != null ? pd[p.party] : pd["\u0000all"];
      if (/micro|small/i.test(msme[p.party] || "")) days = Math.min(days, md);
      const due = this.shift(x.date, 0, days);
      put(due, -x.left, "Payments to suppliers", p.party, "bill " + x.ref + part(x) + (due < start ? ", overdue: taken in week 1" : ", usually paid in " + days + " days"));
    }));
    // the same payment month after month: salaries, rent, EMIs and the like
    const last4 = [0, 1, 2, 3].map(k => { const d = new Date(Audit.iso(to) + "T00:00:00"); d.setDate(1); d.setMonth(d.getMonth() - k); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0"); });
    const pays = {};
    (S.books.vouchers || []).forEach(v => {
      if (v.date > to || !last4.includes(this.ym(v.date)) || v.opt || v.cancel) return;
      const cb = v.ent.filter(e => (Audit.isCash(e.l) || Audit.isBankL(e.l)) && e.a > 0);
      if (!cb.length) return;
      v.ent.filter(e => e.a < 0 && !Audit.isCash(e.l) && !Audit.isBankL(e.l) && !Audit.isCreditor(e.l) && !Audit.isDebtor(e.l) && !Books.ledgerOf(e.l).kind && !/IMPREST/i.test(e.l)).forEach(e => {
        const x = pays[e.l] = pays[e.l] || {}; const ym = this.ym(v.date); x[ym] = x[ym] || {amt: 0, days: []}; x[ym].amt = r2(x[ym].amt - e.a); x[ym].days.push(num(v.date.slice(6)));
      });
    });
    Object.entries(pays).forEach(([l, byM]) => {
      const ms = Object.keys(byM); if (ms.length < 3) return;
      const amts = ms.map(k => byM[k].amt), med = this.median(amts);
      if (!med || amts.some(a => Math.abs(a - med) > med * 0.2)) return;
      const day = Math.min(28, this.median([].concat.apply([], ms.map(k => byM[k].days))) || 1);
      for (let k = 0; k < 4; k++){ const d = new Date(Audit.iso(start) + "T00:00:00"); d.setDate(1); d.setMonth(d.getMonth() + k); d.setDate(day); const ds = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); if (ds >= start) put(ds, -med, "Monthly payments", l, "paid every month, about " + INR.format(med) + " around the " + day + "th"); }
    });
    // tax on fixed dates: GST on the 20th, TDS on the 7th, from the last months in the books
    const lastM = this.monthsOf(this.shift(to, 0, -89), to).slice(-3);
    const gst = lastM.map(mm => { try { const t = GSTR.threeB(mm, ""); return Math.max(0, t.net.igst + t.net.cgst + t.net.sgst + t.net.cess - (t.netItc.igst + t.netItc.cgst + t.netItc.sgst + t.netItc.cess)); } catch (e){ return 0; } });
    const tds = lastM.map(mm => TDS.rows().filter(r => this.ym(r.date) === mm).reduce((s2, r) => s2 + r.tds, 0) + TDS.salaryRows().filter(r => this.ym(r.date) === mm).reduce((s2, r) => s2 + r.tds, 0));
    for (let k = 0; k < 4; k++){
      const d = new Date(Audit.iso(start) + "T00:00:00"); d.setDate(1); d.setMonth(d.getMonth() + k);
      const ym2 = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0");
      const g = k === 0 && gst.length ? gst[gst.length - 1] : this.median(gst) || 0, t2 = k === 0 && tds.length ? tds[tds.length - 1] : this.median(tds) || 0;
      if (g) put(ym2 + "20", -r2(g), "GST", "GSTR-3B", k === 0 ? "last month's tax payable in cash" : "the usual month");
      if (t2) put(ym2 + "07", -r2(t2), "TDS", "TDS deposit", k === 0 ? "last month's deductions" : "the usual month");
    }
    let run = bal != null ? bal : null;
    weeks.forEach(w => { w.net = r2(w.inn - w.out); if (run != null){ w.open = run; run = r2(run + w.net); w.close = run; } w.items.sort((a, c) => a.d.localeCompare(c.d) || a.what.localeCompare(c.what) || String(a.who).localeCompare(String(c.who))); });
    const lows = weeks.filter(w => w.close != null).sort((a, c) => a.close - c.close);
    return {start, weeks, opening: bal, low: lows[0] || null, rd: rd["\u0000all"], pd: pd["\u0000all"]};
  },
  // ratios: from the flows always; from the balance sheet when Tally's balances are here
  ratios(r, balTo){
    const rev = (r.pl.heads.rev || {t: 0}).t, pc = (a, c) => c ? Math.round(a / c * 1000) / 10 : null;
    const out = [["Gross margin", pc(r.pl.gross.t, rev), "%", "gross profit \u00f7 revenue"], ["Operating margin (before interest and depreciation)", pc(r.pl.ebitda.t, rev), "%", ""], ["Net margin (before tax)", pc(r.pl.pbt.t, rev), "%", ""],
      ["Employee costs to revenue", pc((r.pl.heads.emp || {t: 0}).t, rev), "%", ""], ["Other expenses to revenue", pc((r.pl.heads.exp || {t: 0}).t, rev), "%", ""],
      ["Days of sales owed to you", r.dso, "days", "receivables \u00f7 sales a day"]].concat(
      // no purchases (a service firm's bills are expenses), no "days of purchases" (review of 02-Oct-2026)
      r.goods === false || (r.goods == null && !r.purchases.total) ? [] : [["Days of purchases you owe", r.dpo, "days", "payables \u00f7 purchases a day"]]).concat([
      ["Sales growth on the previous period", r.prev && r.prev.sales ? pc(r.sales.total - r.prev.sales, r.prev.sales) : null, "%", ""],
      ["Sales growth on last year", r.ly && r.ly.sales ? pc(r.sales.total - r.ly.sales, r.ly.sales) : null, "%", ""]]);
    if (balTo){
      // review of 02-Oct-2026: the current ratio showed -11.17 times beside working capital of +1,55,35,238.49, the
      // liabilities' groups netting to a debit (tax paid in advance, suppliers paid ahead). Each ledger is placed as the
      // Accounts tab places it (FS.place: a debit balance under liabilities is an asset, a credit under assets a
      // liability), and assets and liabilities are taken as positive amounts; a ratio that still comes out negative or
      // with nothing to divide by is "not meaningful", never a negative number
      const A = Audit, CA = {}, CL = {}, at = {ca: 0, cl: 0, stock: 0, debt: 0, eq: 0};
      ["ci", "inv", "tr", "cash", "stla", "oca"].forEach(k => { CA[k] = 1; }); ["stb", "tp", "ocl", "stp"].forEach(k => { CL[k] = 1; });
      Object.entries(balTo).forEach(([l, v]) => {
        v = num(v); if (Math.abs(v) < 0.005) return;
        if (typeof FS === "undefined" || FS.nature(l).rev) return;
        const k = FS.place(l, v, "co");
        if (CA[k]){ at.ca += -v; if (k === "inv") at.stock += -v; }
        else if (CL[k]) at.cl += v;
        if (k === "ltb" || k === "stb") at.debt += v;
        if (k === "share" || k === "reserves" || k === "capital") at.eq += v;
      });
      const ca = r2(at.ca), cl = r2(at.cl), liquid = r2(at.ca - at.stock), debt = r2(at.debt), eq = r2(at.eq + r.pl.pat.t);
      const NM = "not meaningful", times = (a, c) => !(c > 0) || a < 0 ? NM : Math.round(a / c * 100) / 100;
      out.push(["Current ratio", times(ca, cl), "times", "current assets " + INR.format(ca) + " \u00f7 current liabilities " + INR.format(cl)], ["Quick ratio", times(liquid, cl), "times", "without stock"],
        ["Debt to equity", !(eq > 0) || debt < 0 ? NM : Math.round(debt / eq * 100) / 100, "times", "borrowings \u00f7 capital and reserves"],
        ["Interest cover", (r.pl.heads.fin || {t: 0}).t ? Math.round(r.pl.ebitda.t / r.pl.heads.fin.t * 10) / 10 : null, "times", "operating profit \u00f7 finance costs"],
        ["Working capital", r2(ca - cl), "\u20b9", "current assets less current liabilities"]);
    }
    // the margin month by month
    const trend = r.pl.months.map(mm => { const rv = (r.pl.heads.rev || {m: {}}).m[mm] || 0; return {ym: mm, gross: pc(r.pl.gross.m[mm], rv), pbt: pc(r.pl.pbt.m[mm], rv), rev: rv}; });
    return {list: out, trend, bs: !!balTo};
  },
  byReg(from, to){
    const regs = ((S.books.meta || {}).gstins || []).map(g => g.slice(0, 2)), months = this.monthsOf(from, to);
    return regs.map(rg => {
      let sales = 0, purch = 0; const m = {};
      (S.books.vouchers || []).forEach(v => {
        if (v.date < from || v.date > to || v.opt || v.cancel || GSTR.regOf(v) !== rg) return;
        const ym = this.ym(v.date); m[ym] = m[ym] || {s: 0, p: 0};
        if (Books.isSale(v)){ const a = Books.lines(v).taxable * (/CREDIT NOTE/i.test(v.type) ? -1 : 1); sales = r2(sales + a); m[ym].s = r2(m[ym].s + a); }
        else if (Books.isPurchase(v)){ const a = Books.lines(v).taxable * (/DEBIT NOTE/i.test(v.type) ? -1 : 1); purch = r2(purch + a); m[ym].p = r2(m[ym].p + a); }
      });
      const gst = months.map(mm => { try { const t = GSTR.threeBm(mm, rg); return r2(Math.max(0, t.net.igst + t.net.cgst + t.net.sgst + t.net.cess - (t.netItc.igst + t.netItc.cgst + t.netItc.sgst + t.netItc.cess))); } catch (e){ return 0; } });
      return {reg: rg, gstin: ((S.books.meta || {}).gstins || []).find(g => g.slice(0, 2) === rg), sales, purch, m, gstPay: r2(gst.reduce((a, x) => a + x, 0)), months};
    });
  },
  // profit by cost centre: every income and expense line allocated in Tally
  costCentres(from, to){
    const cc = {}, un = {inc: 0, exp: 0};
    (S.books.vouchers || []).forEach(v => {
      if (v.date < from || v.date > to || v.opt || v.cancel) return;
      v.ent.forEach(e => {
        const h = this.head(e.l); if (!h) return;
        const inc = h === "rev" || h === "oth", sign = inc ? 1 : -1;
        const alloc = (e.c || []);
        let done = 0;
        alloc.forEach(([cat, name, amt]) => {
          const x = cc[cat + "|" + name] = cc[cat + "|" + name] || {cat, name, inc: 0, exp: 0, heads: {}, led: {}, first: v.date, last: v.date};
          const val = r2(amt * sign); if (inc) x.inc = r2(x.inc + val); else x.exp = r2(x.exp + val);
          x.heads[h] = r2((x.heads[h] || 0) + val); x.led[e.l] = r2((x.led[e.l] || 0) + val);
          if (v.date < x.first) x.first = v.date; if (v.date > x.last) x.last = v.date;
          done += amt;
        });
        const rest = r2((e.a - done) * sign);
        if (Math.abs(rest) >= 0.01){ if (inc) un.inc = r2(un.inc + rest); else un.exp = r2(un.exp + rest); }
      });
    });
    const rows = Object.values(cc).map(x => Object.assign(x, {profit: r2(x.inc - x.exp), margin: x.inc ? Math.round((x.inc - x.exp) / x.inc * 1000) / 10 : null})).sort((a, c) => c.inc - a.inc || c.exp - a.exp || a.name.localeCompare(c.name));
    const allInc = rows.reduce((s2, x) => s2 + x.inc, 0) + un.inc, allExp = rows.reduce((s2, x) => s2 + x.exp, 0) + un.exp;
    return {rows, un, cover: {inc: allInc ? Math.round((allInc - un.inc) / allInc * 1000) / 10 : null, exp: allExp ? Math.round((allExp - un.exp) / allExp * 1000) / 10 : null}, cats: Array.from(new Set(rows.map(x => x.cat))).sort(), read: !!(S.books.meta || {}).cc};
  },
  // budget against actual, head by head and month by month
  budgetFor(fy){ return ((S.books.budget || {})[fy]) || {}; },
  budgetVs(r){
    const fy = Audit.fyStart(r.to).slice(0, 4), bud = this.budgetFor(fy), rows = [];
    this.HEADS.forEach(([k, l, sign]) => {
      const H = r.pl.heads[k] || {t: 0, m: {}}, B = bud[k] || {};
      const bt = r2(r.pl.months.reduce((s2, mm) => s2 + num(B[mm]), 0));
      if (!bt && !H.t) return;
      rows.push({k, l, sign, actual: H.t, budget: bt, diff: r2(H.t - bt), pct: bt ? Math.round((H.t - bt) / Math.abs(bt) * 1000) / 10 : null, m: r.pl.months.map(mm => ({ym: mm, a: H.m[mm] || 0, b: num(B[mm])}))});
    });
    const pbtB = r2(rows.reduce((s2, x) => s2 + x.budget * x.sign, 0));
    return {fy, rows, has: Object.keys(bud).length > 0, pbt: {actual: r.pl.pbt.t, budget: pbtB, diff: r2(r.pl.pbt.t - pbtB)}};
  },
  phase2(r, balTo, cashAtEnd){
    return {cash: this.cashActual(r.from, r.to), fc: this.forecast(r.to, r.recv, r.pay, cashAtEnd), ratios: this.ratios(r, balTo), regs: this.byReg(r.from, r.to), cc: this.costCentres(r.from, r.to)};
  }
});

/* ---------- Audit, phase 2: MSME, related parties, penalties, last year, and the Form 3CD draft ---------- */
Object.assign(Audit.checks, {
  // section 43B(h): what is owed to a micro or small enterprise beyond the agreed time is allowed only when paid
  msme43Bh(A, V, ctx){
    const msme = MIS.msme(), days = MIS.cfg(S.books).msmeDays, ag = MIS.ageing(ctx.to, "p", null), rows = [];
    ag.rows.forEach(p => {
      if (!/micro|small/i.test(msme[p.party] || "")) return;
      (p.open || []).filter(x => x.age > days).forEach(x => rows.push({vid: "", date: x.date, no: x.ref, type: msme[p.party], party: p.party, amount: x.left,
        note: x.age + " days unpaid on " + fmtDate(tallyDate(ctx.to))}));
    });
    if (!rows.length) return null;
    return {area: "bal", sev: "high", clause: "3CD 22, 26; section 43B(h)", title: "Micro and small suppliers unpaid beyond " + days + " days",
      problem: rows.length + " bills of " + new Set(rows.map(r => r.party)).size + " MSME suppliers are unpaid beyond the time the MSMED Act allows.",
      impact: "What is unpaid on 31 March beyond the time allowed (15 days, or up to 45 days by agreement) is not allowed as an expense for the year (section 43B(h)); interest under section 16 of the MSMED Act, at three times the bank rate, is also not allowed (clause 22).",
      amount: rows.reduce((s, r) => s + r.amount, 0), suggestion: "Pay these suppliers before the year ends. What stays unpaid is added back in the computation and allowed in the year it is paid. Check each supplier's Udyam type: traders are outside this rule.", je: null, rows};
  },
  // penalties, fines and interest that tax law does not allow
  penalties(A, V){
    const rows = [], by = {};
    V.forEach(v => v.ent.forEach(e => {
      if (e.a >= 0 || !/PENALT|\bFINE\b|LATE FEE|DEMAND|INTEREST ON (TDS|TCS|INCOME TAX|GST)|INTEREST AND LATE FEE|COMPOUNDING|PROSECUTION/i.test(e.l)) return;
      if (!(A.isExpense(e.l) || !A.mastersIn())) return;
      const x = by[e.l] = by[e.l] || {l: e.l, amt: 0, v};
      x.amt = r2(x.amt - e.a);
    }));
    Object.values(by).forEach(x => {
      const kind = /INTEREST ON (TDS|TCS|INCOME TAX)/i.test(x.l) ? "interest on tax deducted or income tax: not allowed (section 40(a)(ii))" :
        /PENALT|\bFINE\b|PROSECUTION|COMPOUNDING|DEMAND/i.test(x.l) ? "penalty for breaking a law: not allowed (Explanation 1 to section 37(1)); split out any interest in it, which is compensatory" :
        "interest or late fee (GST, PF, ESI, 234E): compensatory in nature and usually allowed; confirm, and report it";
      rows.push(A.row(x.v, {party: x.l, amount: x.amt, note: kind}));
    });
    if (!rows.length) return null;
    return {area: "books", sev: "medium", clause: "3CD 21(a), 21(b)", title: "Penalties, fines and interest that are not allowed", problem: rows.length + " ledgers carry penalties, late fees or interest on taxes.",
      impact: "These are added back in the income-tax computation and reported in clause 21.", amount: rows.reduce((s, r) => s + r.amount, 0),
      suggestion: "Add them back in the computation; keep late fees under section 234E and GST late fees apart, as they are treated the same way.", je: null, rows};
  },
  // transactions with directors, partners, their relatives and related concerns
  related(A, V, ctx){
    const rel = (S.books.auditRel || []).filter(x => x.name);
    if (!rel.length) return null;
    const names = new Set(rel.map(x => x.name)), sum = {};
    V.forEach(v => v.ent.forEach(e => {
      if (!names.has(e.l)) return;
      const other = v.ent.filter(z => z !== e && (e.a < 0) !== (z.a < 0));
      const nat = Books.isSale(v) ? "sales to them" : other.some(z => A.isExpense(z.l) || A.under(z.l, /^purchase accounts$/i)) ? "expenses and purchases from them (" + other.filter(z => A.isExpense(z.l) || A.under(z.l, /^purchase accounts$/i)).map(z => z.l)[0] + ")" :
        other.some(z => A.isCash(z.l) || A.isBankL(z.l)) ? (e.a < 0 ? "paid to them" : "received from them") : "journal";
      const k = e.l + "|" + nat, x = sum[k] = sum[k] || {party: e.l, nat, amt: 0, n: 0, v};
      x.amt = r2(x.amt + Math.abs(e.a)); x.n++;
    }));
    const out = [], relOf = n => (rel.find(z => z.name === n) || {}).relation || "";
    const tx = Object.values(sum).sort((a, c) => a.party.localeCompare(c.party) || c.amt - a.amt);
    const pay = tx.filter(x => /^expenses/.test(x.nat));
    if (pay.length) out.push({key: "40A2b", area: "books", sev: "medium", clause: "3CD 23; section 40A(2)(b)", title: "Expenses paid to related persons",
      problem: pay.length + " kinds of expense with " + new Set(pay.map(x => x.party)).size + " related persons.", impact: "Any part more than a fair market price is disallowed under section 40A(2)(b); they are reported in clause 23 and in the related-party note.",
      amount: pay.reduce((s, x) => s + x.amt, 0), suggestion: "Keep the basis of each price (rent agreement, market rates, board approval) on file.", je: null,
      rows: pay.map(x => A.row(x.v, {party: x.party, amount: x.amt, type: relOf(x.party), note: x.nat + ", " + x.n + " entries"}))});
    const bal = ctx.bal.ok ? ctx.bal.at(ctx.to) : null;
    const lent = rel.filter(x => A.under(x.name, /^loans & advances \(asset\)$/i) || /LOAN|ADVANCE/i.test(x.name) && bal && bal[x.name] < -1);
    if (lent.length) out.push({key: "loans", area: "books", sev: "high", clause: "3CD 36A; sections 2(22)(e), 185 of the Companies Act", title: "Loans or advances given to related persons",
      problem: lent.length + " related persons were lent money.", impact: "A loan by a closely held company to a shareholder with 10% or more, or to a concern in which they are interested, is a deemed dividend to the extent of accumulated profits; loans to directors are restricted by section 185.",
      amount: lent.reduce((s, x) => s + (bal ? Math.max(0, -num(bal[x.name])) : 0), 0), suggestion: "Check the shareholding and the approvals; report in clause 36A where it applies.", je: null,
      rows: lent.map(x => ({vid: "", date: ctx.to, no: "", type: x.relation || "", party: x.name, amount: bal ? Math.max(0, -num(bal[x.name])) : 0, note: bal ? "balance lent" : "balance not known without Tally's balances"}))});
    out.push({key: "all", area: "books", sev: "low", clause: "AS 18 / Ind AS 24; section 188", title: "All transactions with related parties",
      problem: tx.length + " kinds of transaction with " + new Set(tx.map(x => x.party)).size + " related parties in the period.", impact: "Every one goes into the related-party note of the accounts.",
      amount: tx.reduce((s, x) => s + x.amt, 0), suggestion: "Use this list for the note; approvals under section 188 for companies.", je: null,
      rows: tx.map(x => A.row(x.v, {party: x.party, amount: x.amt, type: relOf(x.party), note: x.nat + ", " + x.n + " entries"}))});
    return out;
  },
  // the same period last year, ledger by ledger, when those books are here
  lastYear(A, V, ctx){
    const lyFrom = MIS.shift(ctx.from, -1), lyTo = MIS.shift(ctx.to, -1);
    if (!MIS.covered(lyFrom)) return null;
    const now = MIS.moves(ctx.from, ctx.to), then = MIS.moves(lyFrom, lyTo), rows = [];
    Array.from(new Set(Object.keys(now).concat(Object.keys(then)))).sort().forEach(l => {
      const h = MIS.head(l); if (!h) return;
      const sign = (MIS.HEADS.find(z => z[0] === h) || [0, 0, -1])[2], a = r2(((now[l] || {}).t || 0) * sign), c = r2(((then[l] || {}).t || 0) * sign), d = r2(a - c);
      if (Math.abs(d) >= 100000 && (!c || Math.abs(d / c) >= 0.5)) rows.push({vid: "", date: "", no: "", type: MIS.HEADS.find(z => z[0] === h)[1], party: l, amount: d, note: "this year " + A.money(a) + ", last year " + A.money(c) + (c ? " (" + (d > 0 ? "+" : "") + Math.round(d / Math.abs(c) * 100) + "%)" : ", new")});
    });
    const pl1 = MIS.pl(ctx.from, ctx.to), pl0 = MIS.pl(lyFrom, lyTo), gm = x => x.heads.rev && x.heads.rev.t ? x.gross.t / x.heads.rev.t * 100 : null;
    const g1 = gm(pl1), g0 = gm(pl0);
    if (g1 != null && g0 != null && Math.abs(g1 - g0) >= 5) rows.unshift({vid: "", date: "", no: "", type: "Gross margin", party: "Gross margin", amount: 0, note: "this year " + (Math.round(g1 * 10) / 10) + "%, last year " + (Math.round(g0 * 10) / 10) + "%"});
    if (!rows.length) return null;
    return {area: "books", sev: "low", clause: "3CD 40; analytical review", title: "Big changes from last year", problem: rows.length + " income and expense ledgers moved by half or more, and by \u20b91 lakh or more, against the same period last year.",
      impact: "Large swings are where misstatements are found: missing or doubled entries, wrong ledgers, cut-off.", amount: 0, suggestion: "Get an explanation for each; the ones that cannot be explained need the vouchers checked.", je: null, rows};
  }
});
Object.assign(Audit, {
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
  },
  // the Form 3CD draft: the clauses the books answer, filled from them
  form3cd(run){
    const b = S.books, from = run.from, to = run.to, f = id => run.findings.find(x => x.id === id), m = v => INR.format(r2(v || 0)), C = [];
    const add = (no, title, head, rows, note) => C.push({no, title, head, rows: rows || [], note: note || ""});
    add("4", "GST registrations", ["GSTIN"], ((b.meta || {}).gstins || []).map(g => [g]));
    const pen = f("penalties");
    add("21(a)", "Penalties, fines and similar amounts debited to profit and loss", ["Ledger", "Amount", "Nature"], pen ? pen.rows.map(r => [r.party, r.amount, r.note]) : [], pen ? "" : "None found in the books.");
    const tm = f("tdsMissed");
    add("21(b)(ii)(A)", "Amounts disallowable under section 40(a)(ia): TDS not deducted", ["Party", "Amount", "Detail"], tm ? tm.rows.map(r => [r.party, r.amount, r.note]) : [], tm ? "" : "None found.");
    const c3 = f("cash40A3");
    add("21(d)(A)", "Cash payments above the limit, section 40A(3)", ["Date", "Party or ledger", "Amount"], c3 ? c3.rows.map(r => [fmtDate(tallyDate(r.date)), r.party, r.amount]) : [], c3 ? "" : "None found.");
    const ms = f("msme43Bh");
    add("22", "Interest under section 23 of the MSMED Act, not allowed", ["Supplier", "Bill", "Outstanding", "Days"], ms ? ms.rows.map(r => [r.party, r.no, r.amount, r.note]) : [], "The interest itself is not in the books; work it out on these bills at three times the bank rate.");
    const rp = f("related:40A2b");
    add("23", "Payments to persons specified in section 40A(2)(b)", ["Person", "Relation", "Amount", "Nature"], rp ? rp.rows.map(r => [r.party, r.type, r.amount, r.note]) : [], (b.auditRel || []).length ? (rp ? "" : "None in the period.") : "The list of related persons is not set yet (Audit \u2192 Related parties).");
    const d43 = f("balances:43B");
    add("26", "Sums under section 43B", ["Ledger or supplier", "Amount unpaid at the end of the period", "Note"], (d43 ? d43.rows.map(r => [r.party, r.amount, "statutory dues"]) : []).concat(ms ? ms.rows.map(r => [r.party, r.amount, "43B(h) MSME"]) : []),
      "Add the date of payment of each before the due date of the return.");
    const lt = f("cashLoans:269SS"), lr = f("cashLoans:269T"), st = f("cash269ST");
    add("31(a)", "Loans or deposits taken or accepted otherwise than by bank (section 269SS)", ["Date", "Lender", "Amount"], lt ? lt.rows.map(r => [fmtDate(tallyDate(r.date)), r.party, r.amount]) : [], lt ? "" : "None found in cash.");
    add("31(b), 31(c)", "Loans or deposits repaid otherwise than by bank (section 269T)", ["Date", "To", "Amount"], lr ? lr.rows.map(r => [fmtDate(tallyDate(r.date)), r.party, r.amount]) : [], lr ? "" : "None found in cash.");
    add("31(ba)", "Receipts of \u20b92 lakh or more otherwise than by bank (section 269ST)", ["Date", "From", "Amount"], st ? st.rows.map(r => [fmtDate(tallyDate(r.date)), r.party, r.amount]) : [], st ? "" : "None found.");
    // 34(a): section by section, from the deductions and what was missed
    const fy = TDS.fyOf(to), rows34 = {}, missed = tm ? tm.rows : [];
    TDS.allRows().filter(r => r.date >= from && r.date <= to).forEach(r => { const x = rows34[r.section] = rows34[r.section] || {paid: 0, tds: 0, n: 0, low: 0}; x.paid = r2(x.paid + r.paid); x.tds = r2(x.tds + r.tds); x.n++; });
    ["Q1", "Q2", "Q3", "Q4"].forEach(q => Certs.issues(fy, q).filter(x => x.short > 0 && x.row.date >= from && x.row.date <= to).forEach(x => { const y = rows34[x.row.section]; if (y) y.low++; }));
    const miss = {}; missed.forEach(r => { const s2 = (r.note.match(/^(?:looks non-resident[^;]*; )?(\S+) at/) || [])[1] || "?"; miss[s2] = r2((miss[s2] || 0) + r.amount); });
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
      const val = v.ent.filter(e => e.a < 0 && (this.isExpense(e.l) || this.under(e.l, /^purchase accounts$/i) || this.isFixed(e.l))).reduce((s, e) => s - e.a, 0);
      if (!val) return;
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
  form3cdHtml(d){
    const co = CO(), m = v => typeof v === "number" ? INR.format(r2(v)) : esc(String(v == null ? "" : v));
    let h = '<div style="border-bottom:2px solid #15201B;padding-bottom:8px;margin-bottom:12px"><div style="font-size:12px;color:#5A6B63">FORM 3CD \u2014 WORKING FROM THE BOOKS</div><h1 style="font-size:20px;margin:4px 0">' + esc(co.name) + "</h1>" +
      "<div>" + fmtDate(tallyDate(d.from)) + " to " + fmtDate(tallyDate(d.to)) + " \u00b7 from the audit run of " + fmtDate(String(d.at).slice(0, 10)) + " \u00b7 result code " + esc(d.code || "") + "</div>" +
      '<p class="note">The clauses the books answer. Every figure is to be verified against the documents before it goes into the report on the portal. Other clauses are filled from the records.</p></div>';
    d.clauses.forEach(c => {
      h += '<h2 style="font-size:14px;margin:14px 0 4px">Clause ' + esc(c.no) + ". " + esc(c.title) + "</h2>";
      if (c.rows.length) h += "<table><thead><tr>" + c.head.map(x => "<th>" + esc(x) + "</th>").join("") + "</tr></thead><tbody>" + c.rows.slice(0, gfN(200)).map(r => "<tr>" + r.map(v => '<td class="' + (typeof v === "number" ? "n" : "") + '">' + m(v) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
      if (c.note) h += '<p class="note">' + esc(c.note) + "</p>";
    });
    return h;
  }
});

/* ---------- the ledger master, phase 2: what FinCom posts to, templates across clients, and a copy at each filing ---------- */
Object.assign(LedMaster, {
  // what FinCom posts bills into Tally with, taken from the confirmed master
  POST_SLOTS: [["gst.cgst", "Input CGST"], ["gst.sgst", "Input SGST"], ["gst.igst", "Input IGST"], ["gst.rcmCgstIn", "Reverse charge CGST, credit"], ["gst.rcmSgstIn", "Reverse charge SGST, credit"], ["gst.rcmIgstIn", "Reverse charge IGST, credit"],
    ["gst.rcmCgstOut", "Reverse charge CGST, payable"], ["gst.rcmSgstOut", "Reverse charge SGST, payable"], ["gst.rcmIgstOut", "Reverse charge IGST, payable"], ["roundOff", "Round off"]],
  getSlot(co, k){ const [a, c] = k.split("."); return c ? ((co[a] || {})[c] || "") : (co[a] || ""); },
  // review 20: a slot that is a choice (GST, reverse charge, TDS ledgers) is filled by FinCom only as a guess, never over a
  // confirmed one; "Use it" pressed by a person confirms it (src/js/60)
  setSlot(co, k, v, person){
    const [a, c] = k.split("."), ck = a === "gst" && c ? "gst:" + c : a === "tdsLedgers" && c ? "tds:" + c : "";
    if (ck && typeof choiceGuess === "function"){ if (person) choiceConfirm(co, ck, v, {nosave: true}); else choiceGuess(co, ck, v, "confirmed in the ledger master"); return; }
    if (c){ co[a] = co[a] || {}; co[a][c] = v; } else co[a] = v;
  },
  posting(b, co){
    const regs = ((b.meta || {}).gstins || []).map(g => g.slice(0, 2)), reg = String(co.gstin || "").slice(0, 2) || regs[0] || "";
    const ok = Object.entries(b.map || {}).filter(([, m]) => m.ok);
    const pick = (list, why) => { if (!list.length) return {v: "", why: "nothing confirmed for this"}; const plain = list.filter(([, m]) => !m.gstRate && m.rate == null); const pool = plain.length ? plain : list; const best = pool.slice().sort((a, c) => (c[1].n || 0) - (a[1].n || 0) || a[0].localeCompare(c[0]))[0];
      return {v: best[0], why: why + (list.length > 1 ? "; " + (list.length - 1) + " other" + (list.length > 2 ? "s" : "") + " of the same kind: " + list.filter(x => x !== best).map(x => x[0]).slice(0, 3).join(", ") : "")}; };
    const out = [];
    const H = {cgst: "CGST", sgst: "SGST", igst: "IGST"};
    ["cgst", "sgst", "igst"].forEach(h => out.push(["gst." + h, pick(ok.filter(([, m]) => m.what === "gst" && m.side === "input" && m.tax === H[h] && (!m.reg || m.reg === reg)), "GST, " + H[h] + ", input" + (reg ? ", " + reg : ""))]));
    ["Cgst", "Sgst", "Igst"].forEach(h => ["In", "Out"].forEach(sd => out.push(["gst.rcm" + h + sd, pick(ok.filter(([, m]) => m.what === "gst_rcm" && m.tax === h.toUpperCase() && m.side === (sd === "In" ? "input" : "output") && (!m.reg || m.reg === reg)), "GST, reverse charge, " + h.toUpperCase() + ", " + (sd === "In" ? "input" : "output"))])));
    out.push(["roundOff", pick(ok.filter(([, m]) => m.what === "roundoff"), "round off")]);
    RULE_DEFAULTS.filter(r => r.old && r.old !== "\u2014").forEach(r => {
      const sec = r.old.replace(/-/g, "");
      const list = ok.filter(([, m]) => m.what === "tds_payable" && String(m.section || "").replace(/-/g, "").toUpperCase() === sec);
      const byRate = list.filter(([, m]) => m.rate == null || num(m.rate) === r.rateOth || num(m.rate) === r.rateInd);
      out.push(["tdsLedgers." + r.id, pick(byRate.length ? byRate : list, "TDS payable, section " + r.old)]);
    });
    return out.map(([k, p]) => ({k, label: (this.POST_SLOTS.find(z => z[0] === k) || [0, "TDS: " + (RULE_DEFAULTS.find(r => "tdsLedgers." + r.id === k) || {}).label])[1], now: this.getSlot(co, k), from: p.v, why: p.why}));
  },
  // "empty" also covers the standard names a new client starts with, when no such ledger is in its Tally
  applyPosting(b, co, only){
    let n = 0;
    this.posting(b, co).forEach(x => { if (x.from && x.from !== x.now && (!only || only === x.k || (only === "empty" && (!x.now || !(b.ledInfo || {})[x.now] && !(b.map || {})[x.now])))){ this.setSlot(co, x.k, x.from, only !== "empty"); n++; } });
    if (n) Store.saveCompany(co);
    return n;
  },
  // what the firm has confirmed for other clients, by ledger name
  tplKey(name){ return String(name || "").toUpperCase().replace(/^\s*\d{2}\s+/, "").replace(/\s+/g, " ").trim(); },
  // server-books: kept with the firm's settings (in the firm account, for every computer), not in this browser; what an
  // earlier build kept here is brought in once (the browser's copy is left as it was)
  tplAll(){
    const f = S.firm || {};
    if (!f.ledTpl){ let old = {}; try { old = JSON.parse(lsGet("tdsdesk:ledtpl") || "{}"); } catch (e){} if (Object.keys(old).length && S.firm){ S.firm.ledTpl = old; try { Store.saveFirm(); } catch (e){} } return old; }
    return f.ledTpl;
  },
  tplSave(t){ if (!S.firm) return; S.firm.ledTpl = t; try { Store.saveFirm(); } catch (e){} },
  tplLearn(b, names){
    const t = this.tplAll(), cid = b.cid || "";
    names.forEach(n => {
      const m = b.map[n]; if (!m || !m.ok) return;
      const k = this.tplKey(n), x = t[k] = t[k] || {cids: []};
      Object.assign(x, {what: m.what, tax: m.tax || "", side: m.side || "", section: m.section || "", rate: m.rate == null ? null : m.rate, gstRate: m.gstRate || null, at: new Date().toISOString()});
      if (!x.cids.includes(cid)) x.cids.push(cid);
    });
    this.tplSave(t);
  },
  tplFor(b, name){ const x = this.tplAll()[this.tplKey(name)]; if (!x) return null; const others = x.cids.filter(c => c !== b.cid); return others.length ? Object.assign({}, x, {others: others.length}) : null; },
  // a copy of the master each time a return file is made
  snap(b, label){
    const map = {};
    Object.entries(b.map || {}).forEach(([n, m]) => { if (m.what && m.what !== "none") map[n] = {what: m.what, tax: m.tax || "", side: m.side || "", reg: m.reg || "", section: m.section || "", rate: m.rate == null ? null : m.rate, gstRate: m.gstRate || null}; });
    b.ledSnaps = [{at: new Date().toISOString(), label, map}].concat(b.ledSnaps || []).slice(0, 36);
  },
  // what changed in the master after a return was made from it
  changesSince(b){
    const cur = {};
    Object.entries(b.map || {}).forEach(([n, m]) => { if (m.what && m.what !== "none") cur[n] = {what: m.what, tax: m.tax || "", side: m.side || "", reg: m.reg || "", section: m.section || "", rate: m.rate == null ? null : m.rate, gstRate: m.gstRate || null}; });
    const byLed = {};
    (b.ledSnaps || []).forEach(sn => {
      Array.from(new Set(Object.keys(sn.map).concat(Object.keys(cur)))).forEach(n => {
        const a = sn.map[n], c = cur[n];
        const d = !a ? "added as " + this.label(c.what) : !c ? "taken out (was " + this.label(a.what) + ")" :
          ["what", "tax", "side", "reg", "section", "rate", "gstRate"].filter(k => String(a[k] == null ? "" : a[k]) !== String(c[k] == null ? "" : c[k])).map(k => ({what: "type", tax: "head", side: "side", reg: "registration", section: "section", rate: "rate", gstRate: "GST rate"}[k] + " " + (k === "what" ? this.label(a[k]) : a[k] || "\u2014") + " \u2192 " + (k === "what" ? this.label(c[k]) : c[k] || "\u2014"))).join("; ");
        if (!d) return;
        const x = byLed[n] = byLed[n] || {name: n, change: d, returns: []};
        x.returns.push(sn.label + " (" + fmtDate(sn.at.slice(0, 10)) + ")");
      });
    });
    return Object.values(byLed).sort((a, c) => a.name.localeCompare(c.name));
  }
});

