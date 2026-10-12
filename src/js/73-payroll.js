/* ================================================================== */
/* Payroll and salary TDS from Tally: employees, the pay register,    */
/* 24Q Annexure I and II, Form 16 Part B                              */
/* ================================================================== */
// Bridge 2.4.4 (the owner's decisions of 12-Oct-2026). What Tally keeps reaches FinCom's cloud copy (migration 74) and is
// read here when the books come in (TCloud.load -> Payroll.into):
//   - the payroll's employees (tally_employees: name, group, PAN, date of joining and of leaving, designation);
//   - each pay head's type, statutory type and income-tax component (tally_ledgers.pay_type, pay_stat_type, it_component,
//     for_payroll);
//   - each employee's amount per pay head per payroll entry (tally_cost_allocs: the employee as the pay head's cost centre);
//   - the salary paid to each employee (tally_salary_pays, from the salary payment's bank allocations).
// What Tally does not hold is captured here, per employee, and kept with the books as items (b.payDetails, one item per
// employee with its id, merged item by item like the challans): the tax regime, the declarations (80C, 80CCD(1B), 80D, 80E,
// 80G, 80TTA, 80CCD(2), others), rent paid and the landlord's PAN (with the HRA rate, 50% or 40%), housing-loan interest and
// the lender's PAN, the previous employer's salary and TDS, the address, and (old regime only) whether the employee is a
// senior citizen (yes or no; no date of birth is asked or kept).
// The tax is FinCom's own rule (PayTax below), written out in full; nothing is worked out by AI. Every figure is to the
// paisa. The forms of the Income-tax Act, 2025 (Form 138, was 24Q; Form 16 is Form 130 there) and their section numbers are
// to be checked against the Income Tax Department's own documents: the FVU text is built to the current 24Q layout and
// marked "check before filing" (TDS24Q_FILE below).
const Payroll = {
  books(){ return S.books || {}; },
  data(){ const p = this.books().payroll; return p && typeof p === "object" ? p : {employees: [], heads: {}, allocs: [], pays: [], vouchers: {}}; },
  has(fy){ const d = this.data(); return (d.allocs || []).some(a => !fy || TDS.fyOf(a.day) === fy); },
  // ---------- the cloud copy (TCloud.load): read whole each time the books come in (a payroll is small)
  async into(b, book){
    if (!book || typeof TCloud !== "object") return 0;
    const B = "&book_id=eq." + encodeURIComponent(book);
    let emp = [], heads = [], allocs = [], pays = [], vs = [];
    try { emp = await TCloud.restPages("tally_employees?select=guid,name,parent,category,is_group,pan,joined,left_on,designation,gone_at" + B + "&order=name.asc"); }
    catch (e){ return 0; }      // a cloud without migration 74: nothing of payroll (as before)
    try { heads = await TCloud.restPages("tally_ledgers?select=name,pay_type,pay_stat_type,it_component,for_payroll&for_payroll=eq.true" + B + "&order=name.asc"); } catch (e){ heads = []; }
    const names = heads.map(h => h.name);
    for (let i = 0; i < names.length; i += 30){
      const ln = "&ledger=in.(" + names.slice(i, i + 30).map(x => encodeURIComponent('"' + String(x).replace(/"/g, '\\"') + '"')).join(",") + ")";
      allocs = allocs.concat(await TCloud.restPages("tally_cost_allocs?select=guid,alter_id,day,ledger,centre,amount&gone_at=is.null" + B + ln + "&order=guid.asc"));
    }
    try { pays = await TCloud.restPages("tally_salary_pays?select=guid,alter_id,day,ledger,employee,amount,paid_on&gone_at=is.null" + B + "&order=guid.asc"); } catch (e){ pays = []; }
    const guids = Array.from(new Set(allocs.map(a => a.guid).concat(pays.map(p => p.guid))));
    for (let i = 0; i < guids.length; i += 40){
      const g = "&guid=in.(" + guids.slice(i, i + 40).map(x => encodeURIComponent('"' + x + '"')).join(",") + ")";
      vs = vs.concat(await TCloud.restPages("tally_vouchers?select=guid,alter_id,day,vtype,vno,cancelled,optional,deleted_at" + B + g + "&order=guid.asc"));
    }
    return this.take(b, {book, employees: emp, heads, allocs, pays, vouchers: vs});
  },
  // the rows as the cloud keeps them -> b.payroll; only the live version of a live entry counts (not deleted, cancelled or
  // optional; the cost centres of the AlterID the entry holds now)
  take(b, x){
    const V = {};
    (x.vouchers || []).forEach(v => { if (v && v.guid && !v.deleted_at && !v.cancelled && !v.optional) V[v.guid] = {alter: num(v.alter_id), day: TDS.ymd(v.day), type: v.vtype || "", no: v.vno || ""}; });
    const live = (r) => V[r.guid] && (r.alter_id == null || num(r.alter_id) === V[r.guid].alter);
    const H = {};
    (x.heads || []).forEach(h => { if (h && h.name) H[h.name] = {type: String(h.pay_type || ""), stat: String(h.pay_stat_type || ""), it: String(h.it_component || "")}; });
    const E = (x.employees || []).filter(e => e && e.guid && e.name).map(e => ({guid: e.guid, name: e.name, parent: e.parent || "", category: e.category || "", group: !!e.is_group,
      pan: String(e.pan || "").toUpperCase(), joined: TDS.ymd(e.joined), left: TDS.ymd(e.left_on), designation: e.designation || "", gone: !!e.gone_at}));
    const isEmp = new Set(E.filter(e => !e.group).map(e => normName(e.name)));
    const A = (x.allocs || []).filter(a => live(a) && H[a.ledger] && isEmp.has(normName(a.centre)))
      .map(a => ({guid: a.guid, day: V[a.guid].day, head: a.ledger, employee: a.centre, amt: r2(num(a.amount))}));
    const P = (x.pays || []).filter(p => live(p)).map(p => ({guid: p.guid, day: V[p.guid].day, ledger: p.ledger || "", employee: p.employee, amt: r2(Math.abs(num(p.amount))), paidOn: TDS.ymd(p.paid_on) || V[p.guid].day}));
    b.payroll = {book: x.book || "", at: new Date().toISOString(), employees: E, heads: H, allocs: A, pays: P, vouchers: V};
    return A.length;
  },
  // ---------- the pay heads
  head(name){ return this.data().heads[name] || {type: "", stat: "", it: ""}; },
  // earn: earnings (taxable salary); ded: the employee's deductions; employer: the employer's contributions (not salary);
  // reimb: reimbursements (paid, not salary); loan: loans and advances (recovered, not salary)
  kind(name){
    const t = String(this.head(name).type || "");
    if (/reimburse/i.test(t)) return "reimb";
    if (/loan|advance/i.test(t)) return "loan";
    if (/employer/i.test(t) || /gratuity/i.test(t)) return "employer";
    if (/deduction/i.test(t)) return "ded";
    return "earn";
  },
  isTds(name){ return /^income\s*tax$/i.test(String(this.head(name).stat || "").trim()); },
  isPT(name){ return /professional\s*tax/i.test(String(this.head(name).stat || "")); },
  // an earning's part of salary for the forms: basic, HRA, or other
  part(name){ const c = String(this.head(name).it || ""); return /^basic/i.test(c) ? "basic" : /house\s*rent/i.test(c) ? "hra" : /dearness/i.test(c) ? "da" : "other"; },
  employees(){ return this.data().employees.filter(e => !e.group); },
  groups(){ return this.data().employees.filter(e => e.group); },
  empByName(name){ const k = normName(name); return this.employees().find(e => normName(e.name) === k) || null; },
  // ---------- the details FinCom keeps for an employee (items: b.payDetails, id "emp:<Tally GUID>")
  FIELDS: ["regime", "senior", "hraMetro", "rent", "landlordPan", "hlInterest", "lenderPan", "prevSalary", "prevTds", "address",
    "d80C", "d80CCD1B", "d80D", "d80DParents", "d80E", "d80G", "d80TTA", "d80CCD2", "dOther"],
  detail(e){
    const id = "emp:" + (e && e.guid || ""), list = this.books().payDetails || [];
    return list.find(x => x && x.id === id) || {id};
  },
  setDetail(e, k, v){
    if (!e || !e.guid || this.FIELDS.indexOf(k) < 0) return false;
    const b = this.books(), id = "emp:" + e.guid;
    b.payDetails = (b.payDetails || []).slice();
    const i = b.payDetails.findIndex(x => x && x.id === id);
    const cur = i >= 0 ? b.payDetails[i] : {id, guid: e.guid};
    let val = typeof v === "string" ? v.trim() : v;
    if (/^(rent|hlInterest|prevSalary|prevTds|d8)/.test(k)) val = val === "" || val == null ? "" : r2(Math.max(0, num(val)));
    if (k === "landlordPan" || k === "lenderPan") val = String(val || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    if (k === "regime") val = val === "old" ? "old" : "new";
    if (k === "senior" || k === "hraMetro") val = val === true || val === "yes" ? "yes" : "no";
    if (k === "address") val = String(val || "").slice(0, 300);
    const next = Object.assign({}, cur, {[k]: val, name: e.name, at: new Date().toISOString()});
    if (i >= 0) b.payDetails[i] = next; else b.payDetails.push(next);
    return true;
  },
  // ---------- the months
  ym(d){ return TDS.ymd(d).slice(0, 6); },
  months(fy){ return Array.from(new Set(this.data().allocs.filter(a => TDS.fyOf(a.day) === fy).map(a => this.ym(a.day)))).sort(); },
  // the pay register of a month: one row per employee, each pay head's amount as Tally keeps it (an earning as a positive
  // figure), gross (earnings), the employee's deductions, net pay, the employer's contributions, the TDS (Income Tax head)
  register(ym){
    const by = {}, heads = new Set();
    this.data().allocs.filter(a => this.ym(a.day) === ym).forEach(a => {
      const k = normName(a.employee), r = by[k] = by[k] || {employee: a.employee, heads: {}, gross: 0, ded: 0, employer: 0, reimb: 0, loan: 0, tds: 0, pt: 0, vouchers: new Set()};
      const kind = this.kind(a.head), v = kind === "ded" || kind === "loan" ? r2(a.amt) : r2(-a.amt);
      heads.add(a.head); r.heads[a.head] = r2((r.heads[a.head] || 0) + v); r.vouchers.add(a.guid);
      if (kind === "earn") r.gross = r2(r.gross + v);
      else if (kind === "ded") r.ded = r2(r.ded + v);
      else r[kind] = r2(r[kind] + v);
      if (this.isTds(a.head)) r.tds = r2(r.tds + v);
      if (this.isPT(a.head)) r.pt = r2(r.pt + v);
    });
    const rows = Object.values(by).map(r => { const e = this.empByName(r.employee); return Object.assign(r, {pan: e ? e.pan : "", guid: e ? e.guid : "", net: r2(r.gross + r.reimb - r.ded - r.loan), vouchers: Array.from(r.vouchers)}); })
      .sort((a, c) => a.employee.localeCompare(c.employee));
    const order = ["earn", "reimb", "ded", "loan", "employer"];
    return {rows, heads: Array.from(heads).sort((a, c) => order.indexOf(this.kind(a)) - order.indexOf(this.kind(c)) || a.localeCompare(c))};
  },
  // ---------- 24Q: one row per employee and payroll entry (the credit), paid on the salary payment's date when Tally keeps one
  // for that employee within 45 days of the credit; the TDS the Income Tax pay head deducted. id "pay:<entry GUID>|<employee>"
  tdsRows(){ return typeof perRender === "function" ? perRender(this, "tdsRows", () => this.tdsRowsNow()) : this.tdsRowsNow(); },
  tdsRowsNow(){
    const d = this.data(), b = this.books(), by = {};
    d.allocs.forEach(a => {
      const k = a.guid + "|" + normName(a.employee), kind = this.kind(a.head);
      const r = by[k] = by[k] || {guid: a.guid, employee: a.employee, credit: a.day, paid: 0, tds: 0};
      if (kind === "earn") r.paid = r2(r.paid - a.amt);
      if (this.isTds(a.head)) r.tds = r2(r.tds + a.amt);
    });
    return Object.values(by).filter(r => r.paid > 0.005 || r.tds > 0.005).map(r => {
      const e = this.empByName(r.employee), pay = d.pays.filter(p => normName(p.employee) === normName(r.employee) && p.paidOn >= r.credit && TDS.monthsBetween(r.credit, p.paidOn) <= 2)
        .sort((x, y) => x.paidOn.localeCompare(y.paidOn))[0];
      const date = pay ? pay.paidOn : r.credit, id = "pay:" + r.guid + "|" + r.employee;
      return {id, date, credit: r.credit, paidOn: pay ? pay.paidOn : "", q: TDS.qOf(date), fy: TDS.fyOf(date), party: r.employee, employee: r.employee, pan: e ? e.pan : "", guid: e ? e.guid : "",
        section: "192", ledger: "", paid: r.paid, tds: r.tds, rate: r.paid ? r2(r.tds / r.paid * 100) : null, voucher: (d.vouchers[r.guid] || {}).no || "", type: (d.vouchers[r.guid] || {}).type || "",
        src: "payroll", challan: (b.alloc || {})[id] || ""};
    }).sort((a, c) => String(a.date).localeCompare(String(c.date)) || a.employee.localeCompare(c.employee));
  },
  // the challan each month's TDS goes to: Tally's salary TDS challans (Stat Payment of Income Tax, section 192; TDSTally,
  // src/js/72) by the period the payment says it is for, else the first such challan on or after the payment, within its
  // amount. Only rows without a challan, never one a person tagged; marked "tally" in b.allocFrom. How many tagged
  autoTag(b){
    b = b || this.books();
    const rows = this.tdsRows().filter(r => r.tds > 0.005 && !r.challan);
    if (!rows.length) return 0;
    const chs = (b.challans || []).filter(c => /^192/.test(String(c.section || ""))).sort((a, c) => String(a.date).localeCompare(String(c.date)));
    if (!chs.length) return 0;
    const use = TDS.challanUse(), vouch = {}; (b.vouchers || []).forEach(v => { vouch[v.id] = v; vouch[v.guid] = v; });
    const period = (c) => { const v = vouch[c.fromVoucher], x = v && v.tdsx || {}; return {from: TDS.ymd(x.from), to: TDS.ymd(x.to)}; };
    b.alloc = Object.assign({}, b.alloc); b.allocFrom = Object.assign({}, b.allocFrom);
    let n = 0;
    rows.forEach(r => {
      const fits = (c) => Math.round(((use[c.id] || 0) + r.tds) * 100) <= Math.round(num(c.tax) * 100);
      const ym = this.ym(r.date);
      let c = chs.find(c => { const p = period(c); return p.from && p.from.slice(0, 6) <= ym && (p.to || p.from).slice(0, 6) >= ym && fits(c); });
      if (!c) c = chs.find(c => TDS.ymd(c.date) >= TDS.ymd(r.date) && TDS.monthsBetween(r.date, c.date) <= 2 && fits(c));
      if (!c) return;
      b.alloc[r.id] = c.id; b.allocFrom[r.id] = "tally"; use[c.id] = r2((use[c.id] || 0) + r.tds); n++;
    });
    return n;
  },
  // ---------- 24Q Annexure I: per employee per month, the amount paid or credited, the TDS, the dates and the challan
  annexI(fy, q){
    const ch = {}; (this.books().challans || []).forEach(c => { ch[c.id] = c; });
    return this.tdsRows().filter(r => r.fy === fy && r.q === q).map(r => {
      const c = ch[r.challan] || null;
      return Object.assign({}, r, {deducted: r.tds > 0.005 ? r.date : "", challanBsr: c ? c.bsr : "", challanNo: c ? c.serial : "", challanDate: c ? c.date : ""});
    });
  },
  // ---------- 24Q Annexure II and Form 16 Part B: the year, per employee
  yearOf(e, fy){
    const rows = this.data().allocs.filter(a => normName(a.employee) === normName(e.name) && TDS.fyOf(a.day) === fy);
    const s = {basic: 0, da: 0, hra: 0, other: 0, gross: 0, pt: 0, tds: 0, employerNps: 0, months: new Set()};
    rows.forEach(a => {
      const kind = this.kind(a.head);
      if (kind === "earn"){ const p = this.part(a.head), v = r2(-a.amt); s[p] = r2(s[p] + v); s.gross = r2(s.gross + v); }
      if (this.isPT(a.head)) s.pt = r2(s.pt + a.amt);
      if (this.isTds(a.head)) s.tds = r2(s.tds + a.amt);
      s.months.add(this.ym(a.day));
    });
    s.months = s.months.size;
    return s;
  },
  annexII(fy){ return this.employees().filter(e => this.yearOf(e, fy).months > 0 || num(this.detail(e).prevSalary) > 0 && this.yearOf(e, fy).months > 0).map(e => this.form16(e, fy)); },
  form16(e, fy){
    const y = this.yearOf(e, fy), d = this.detail(e);
    const c = PayTax.compute({fy, regime: d.regime === "old" ? "old" : "new", senior: d.senior === "yes", hraMetro: d.hraMetro === "yes",
      basic: y.basic, da: y.da, hra: y.hra, other: y.other, pt: y.pt, rent: num(d.rent), hlInterest: num(d.hlInterest),
      prevSalary: num(d.prevSalary), prevTds: num(d.prevTds), tdsHere: y.tds, pan: e.pan,
      ded: {c80C: num(d.d80C), c80CCD1B: num(d.d80CCD1B), c80D: num(d.d80D), c80DParents: num(d.d80DParents), c80E: num(d.d80E), c80G: num(d.d80G), c80TTA: num(d.d80TTA), c80CCD2: num(d.d80CCD2), other: num(d.dOther)}});
    return Object.assign({name: e.name, pan: e.pan, guid: e.guid, designation: e.designation, joined: e.joined, left: e.left, address: d.address || "",
      landlordPan: d.landlordPan || "", lenderPan: d.lenderPan || "", regimeChosen: d.regime ? true : false, months: y.months}, c);
  },
  // ---------- before filing
  checks(fy, q){
    const out = [], rows = this.annexI(fy, q), emp = this.employees();
    const noPan = Array.from(new Set(rows.filter(r => !Certs.validPan(r.pan)).map(r => r.employee)));
    if (noPan.length) out.push({what: "Employees without a valid PAN", n: noPan.length, how: "Tax is at least 20% without one (section 206AA). Add the PAN on the employee in Tally (Payroll Info, Employee).", who: noPan.slice(0, 4)});
    const untagged = rows.filter(r => r.tds > 0.005 && !r.challan);
    if (untagged.length) out.push({what: "Salary TDS not tagged to a challan", n: untagged.length, how: "Pay it with Tally's Stat Payment of Income Tax and its challan (Challan Reconciliation), or tag it under Challans.", who: untagged.slice(0, 4).map(r => r.employee + " " + fmtDate(tallyDate(r.date)))});
    if (q === "Q4"){
      const noReg = emp.filter(e => this.yearOf(e, fy).months > 0 && !this.detail(e).regime);
      if (noReg.length) out.push({what: "Employees without a tax regime chosen", n: noReg.length, how: "The new regime is taken until one is chosen (Salary, Employees).", who: noReg.slice(0, 4).map(e => e.name)});
      const rentNoPan = emp.filter(e => this.detail(e).regime === "old" && num(this.detail(e).rent) > 100000 && !Certs.validPan(this.detail(e).landlordPan));
      if (rentNoPan.length) out.push({what: "Rent over ₹1,00,000 a year without the landlord's PAN", n: rentNoPan.length, how: "The landlord's PAN is needed for the HRA exemption on rent over ₹1,00,000 a year.", who: rentNoPan.slice(0, 4).map(e => e.name)});
      const hlNoPan = emp.filter(e => this.detail(e).regime === "old" && num(this.detail(e).hlInterest) > 0 && !this.detail(e).lenderPan);
      if (hlNoPan.length) out.push({what: "Housing-loan interest without the lender's PAN", n: hlNoPan.length, how: "Annexure II asks the lender's PAN with the interest.", who: hlNoPan.slice(0, 4).map(e => e.name)});
      const short = this.annexII(fy).filter(x => x.balance > 1);
      if (short.length) out.push({what: "Tax for the year more than the TDS deducted", n: short.length, how: "The year's tax is more than the TDS (here and with the previous employer); deduct the rest before the year ends.", who: short.slice(0, 4).map(x => x.name + " " + INR.format(x.balance))});
    }
    return out;
  }
};

/* ---------- the tax on salary: FinCom's rule, written out (tax year 2026-27 and before) ---------- */
// Slabs, rebate, surcharge and cess as they stand for the tax year 2026-27 (the Income-tax Act, 2025 kept the slabs and
// the rebate of the Finance Act, 2025): the new regime 0-4L nil, 4-8L 5%, 8-12L 10%, 12-16L 15%, 16-20L 20%, 20-24L 25%,
// above 30%; rebate up to ₹60,000 where total income is ₹12,00,000 or less, with marginal relief just above it; standard
// deduction ₹75,000. The old regime: nil to ₹2,50,000 (₹3,00,000 for a senior citizen; FinCom asks only yes or no, so a
// super senior is taken as a senior), 5% to ₹5,00,000, 20% to ₹10,00,000, 30% above; rebate up to ₹12,500 where total
// income is ₹5,00,000 or less; standard deduction ₹50,000; HRA, professional tax, housing-loan interest (₹2,00,000) and
// Chapter VI-A as declared, within their limits. Surcharge 10% above ₹50 lakh, 15% above ₹1 crore, 25% above ₹2 crore (and
// 37% above ₹5 crore in the old regime), with marginal relief; health and education cess 4%. Total income rounded to ₹10
// (section 288A), the tax to ₹10 (section 288B). Check before filing.
const PayTax = {
  NEW: [[400000, 0], [800000, 5], [1200000, 10], [1600000, 15], [2000000, 20], [2400000, 25], [Infinity, 30]],
  slab(inc, slabs){ let t = 0, lo = 0; for (const [hi, rate] of slabs){ if (inc > lo) t += (Math.min(inc, hi) - lo) * rate / 100; lo = hi; } return t; },
  old(senior){ const ex = senior ? 300000 : 250000; return [[ex, 0], [500000, 5], [1000000, 20], [Infinity, 30]]; },
  // tax before cess with the rebate and surcharge (each with its marginal relief)
  tax(inc, regime, senior){
    const slabs = regime === "old" ? this.old(senior) : this.NEW;
    let t = this.slab(inc, slabs);
    let rebate = 0;
    if (regime === "old"){ if (inc <= 500000) rebate = Math.min(t, 12500); }
    else if (inc <= 1200000) rebate = Math.min(t, 60000);
    else { const over = inc - 1200000; if (t > over) rebate = t - over; }          // marginal relief just above ₹12 lakh
    t = t - rebate;
    const sc = (x) => { const r = x > 50000000 && regime === "old" ? 37 : x > 20000000 ? 25 : x > 10000000 ? 15 : x > 5000000 ? 10 : 0; return r; };
    let sur = 0;
    const r = sc(inc);
    if (r){
      sur = t * r / 100;
      // marginal relief: the tax with surcharge never more than the tax at the threshold plus the income over it
      const th = r === 10 ? 5000000 : r === 15 ? 10000000 : r === 25 ? 20000000 : 50000000;
      const atTh = this.slab(th, slabs) * (1 + sc(th) / 100);
      if (t + sur > atTh + (inc - th)) sur = Math.max(0, atTh + (inc - th) - t);
    }
    return {slabTax: r2(t + rebate), rebate: r2(rebate), afterRebate: r2(t), surcharge: r2(sur)};
  },
  round10(x){ return Math.round(x / 10) * 10; },
  compute(i){
    const regime = i.regime === "old" ? "old" : "new";
    const salary = r2(num(i.basic) + num(i.da) + num(i.hra) + num(i.other));         // 17(1), this employer
    const prev = r2(num(i.prevSalary));
    const gross = r2(salary + prev);
    // HRA (old regime): the least of the HRA received, rent less 10% of salary (basic and DA), 50% (metro) or 40% of salary
    let hraEx = 0;
    if (regime === "old" && num(i.hra) > 0 && num(i.rent) > 0){
      const sal = num(i.basic) + num(i.da);
      hraEx = Math.max(0, Math.min(num(i.hra), num(i.rent) - sal * 0.10, sal * (i.hraMetro ? 0.5 : 0.4)));
    }
    hraEx = r2(hraEx);
    const std = regime === "old" ? 50000 : 75000;
    const stdDed = r2(Math.min(std, Math.max(0, gross - hraEx)));
    const ptDed = regime === "old" ? r2(Math.min(num(i.pt), 5000)) : 0;
    const incSalary = r2(Math.max(0, gross - hraEx - stdDed - ptDed));
    const hp = regime === "old" ? -r2(Math.min(num(i.hlInterest), 200000)) : 0;      // loss from a self-occupied house
    const grossTotal = r2(Math.max(0, incSalary + hp));
    const d = i.ded || {}, cap = (v, c) => r2(Math.min(Math.max(0, num(v)), c));
    let via = {};
    if (regime === "old"){
      via = {c80C: cap(d.c80C, 150000), c80CCD1B: cap(d.c80CCD1B, 50000), c80D: cap(d.c80D, i.senior ? 50000 : 25000), c80DParents: cap(d.c80DParents, 50000),
        c80E: cap(d.c80E, Infinity), c80G: cap(d.c80G, Infinity), c80TTA: cap(d.c80TTA, i.senior ? 50000 : 10000), c80CCD2: cap(d.c80CCD2, salary * 0.10), other: cap(d.other, Infinity)};
    } else {
      via = {c80CCD2: cap(d.c80CCD2, salary * 0.14)};
    }
    let via6 = r2(Object.values(via).reduce((a, v) => a + v, 0));
    if (via6 > grossTotal) via6 = grossTotal;
    const total = this.round10(Math.max(0, grossTotal - via6));
    const t = this.tax(total, regime, !!i.senior);
    const cess = r2((t.afterRebate + t.surcharge) * 0.04);
    let taxPayable = this.round10(t.afterRebate + t.surcharge + cess);
    // no valid PAN (section 206AA): at least 20% of the income
    const noPan = !(typeof Certs === "object" ? Certs.validPan(i.pan) : /^[A-Z]{5}\d{4}[A-Z]$/.test(String(i.pan || "")));
    if (noPan && total > 0) taxPayable = Math.max(taxPayable, this.round10(total * 0.20));
    const tdsHere = r2(num(i.tdsHere)), prevTds = r2(num(i.prevTds));
    return {regime, salary, prevSalary: prev, gross, basic: r2(num(i.basic)), da: r2(num(i.da)), hra: r2(num(i.hra)), other: r2(num(i.other)), perquisites: 0, profitsInLieu: 0,
      hraExempt: hraEx, standard: stdDed, profTax: ptDed, incomeSalary: incSalary, houseProperty: hp, grossTotal, via, chapter6: via6, totalIncome: total,
      slabTax: t.slabTax, rebate: t.rebate, surcharge: t.surcharge, cess, relief89: 0, taxPayable, noPan, tdsHere, prevTds, tdsTotal: r2(tdsHere + prevTds),
      balance: r2(taxPayable - tdsHere - prevTds)};
  }
};

/* ---------- 24Q's text file (Form 138 under the Act of 2025): built to the current layout, marked "check before filing" -- */
// The records are 24Q's as Protean's file format has carried them: the file header (FH), the batch header (BH), each
// challan (CD) with the deductees' records under it (DD: one per employee per payment, Annexure I), and in the fourth
// quarter one salary record (SD) per employee (Annexure II). The new form's own layout could not be checked here (the
// official sites are not reachable from where FinCom was built): the file is named _DRAFT and FinCom says to check it with
// the FVU before filing (NEW_FORMS_VALIDATED, src/js/16).
const TDS24Q_FILE = {
  build(fy, q, firm){
    const rows = Payroll.annexI(fy, q).filter(r => r.tds > 0.005 && r.challan);
    if (!rows.length) return {error: "No salary TDS of " + q + " " + fy + " is tagged to a challan yet."};
    const ch = {}; (Payroll.books().challans || []).forEach(c => { ch[c.id] = c; });
    const used = {};
    rows.forEach(r => { (used[r.challan] = used[r.challan] || []).push(r); });
    const live = Object.keys(used).map(id => ch[id]).filter(Boolean).sort((a, c) => String(a.date).localeCompare(String(c.date)));
    const dmy = s => s ? String(s).slice(6, 8) + String(s).slice(4, 6) + String(s).slice(0, 4) : "";
    const money = v => r2(num(v)).toFixed(2);
    const txt = v => String(v == null ? "" : v).replace(/[\^\r\n]/g, " ").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim().slice(0, 75);
    const today = new Date(), fileDate = String(today.getDate()).padStart(2, "0") + String(today.getMonth() + 1).padStart(2, "0") + today.getFullYear();
    const ay = (num(fy.slice(0, 4)) + 1) + "-" + String(num(fy.slice(0, 4)) + 2).slice(2);
    const isNew = TDS.isNew(fy), fno = TDS.formNo("24Q", fy);
    const lines = []; let ln = 0;
    const put = arr => { ln++; lines.push([ln].concat(arr).join("^")); };
    put(["FH", "SL1", "R", fileDate, "1", "D", firm.tan, "1", "FinCom", "", "", "", "", "", "", "", ""]);
    put(["BH", "1", String(live.length), fno, firm.tan, firm.pan || "PANNOTREQD", fy.replace("-", ""), ay.replace("-", ""),
      txt(firm.name), txt(firm.branch), txt(firm.flat), txt(firm.premises), txt(firm.road), txt(firm.area), txt(firm.town),
      txt(firm.state), txt(firm.pin), txt(firm.email), txt(firm.phone), firm.deductorType || "F",
      txt(firm.person), txt(firm.personDesignation), "", "", "", "", "", "", "", "", "", "N", "", "", "", "", "", q]);
    live.forEach((c, ci) => {
      const mine = used[c.id];
      const tax = r2(mine.reduce((a, r) => a + r.tds, 0));
      put(["CD", "1", String(ci + 1), String(mine.length), "", money(tax), "0.00", "0.00", money(c.interest), money(num(c.fee) + num(c.others)),
        money(num(c.tax) + num(c.interest) + num(c.fee) + num(c.others)), "", c.bsr, dmy(c.date), c.serial, "C", String(c.minorHead || "200"), "N", "", "", money(tax), "0.00", "0.00", "0.00", "0.00", "0.00"]);
      mine.forEach((r, di) => {
        put(["DD", "1", String(ci + 1), String(di + 1), "O", "", Certs.validPan(r.pan) ? r.pan : "PANNOTAVBL", "", txt(r.employee), money(r.tds), "0.00", "0.00", money(r.tds), "", money(r.tds),
          "", "", dmy(r.date), money(r.paid), dmy(r.date), Certs.validPan(r.pan) ? "" : "C", "", "", "92B", "", "", "", "", ""]);
      });
    });
    let sd = 0;
    if (q === "Q4"){
      Payroll.annexII(fy).forEach((e, i) => {
        sd++;
        put(["SD", "1", String(i + 1), "A", Certs.validPan(e.pan) ? e.pan : "PANNOTAVBL", "", txt(e.name), e.senior ? "S" : "G", dmy(e.joined && e.joined > fy.slice(0, 4) + "0401" ? e.joined : fy.slice(0, 4) + "0401"),
          dmy(e.left && e.left < (num(fy.slice(0, 4)) + 1) + "0331" ? e.left : (num(fy.slice(0, 4)) + 1) + "0331"), money(e.salary), "0.00", "0.00", money(e.gross), money(e.hraExempt), money(e.standard), "0.00", money(e.profTax),
          money(e.incomeSalary), money(e.houseProperty), money(e.grossTotal), money(e.chapter6), money(e.totalIncome), money(e.slabTax - e.rebate), money(e.surcharge), money(e.cess), "0.00",
          money(e.taxPayable), money(e.tdsHere), money(e.prevTds), money(e.tdsTotal), money(e.balance), e.regime === "old" ? "Y" : "N", money(e.prevSalary), e.landlordPan || "", e.lenderPan || ""]);
      });
    }
    return {text: lines.join("\r\n") + "\r\n", rows: rows.length, challans: live.length, salaryRecords: sd, form: "24Q", formNo: fno, isNew, draft: true,
      name: (firm.tan || "TAN") + "_" + (isNew ? "Form" + fno : "24Q") + "_" + q + "_" + fy.replace("-", "") + "_DRAFT.txt",
      words: "Check before filing: built to the current 24Q layout; the new form's own layout could not be checked here. Run it through Protean's FVU first."};
  }
};

/* ---------- the page's actions (app/src/screens/tds/Payroll.jsx) ---------- */
function payDetailSet(guid, k, v){
  const e = Payroll.employees().find(x => x.guid === guid);
  if (!Payroll.setDetail(e, k, v)) return;
  saveBooks(); render();
}
function payFvuDownload(fy, q){
  const r = TDS24Q_FILE.build(fy, q, TDS26Q.firmDetails());
  if (r.error){ toast(r.error); return; }
  saveFile(r.name, new Blob([r.text], {type: "text/plain"}));
  toast(r.rows + " salary payment" + (r.rows === 1 ? "" : "s") + " under " + r.challans + " challan" + (r.challans === 1 ? "" : "s") + (r.salaryRecords ? ", " + r.salaryRecords + " salary record" + (r.salaryRecords === 1 ? "" : "s") : "") + ". Check before filing: run it through the FVU.");
}
