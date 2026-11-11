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
  // next-24q-ready: a copy kept here of another shape (an older one) is no payroll (PayLoad.ok reads it again)
  data(){ const p = this.books().payroll; return p && Array.isArray(p.allocs) && Array.isArray(p.employees) ? p : {employees: [], heads: {}, allocs: [], pays: [], vouchers: {}}; },
  has(fy){ const d = this.data(); return (d.allocs || []).some(a => !fy || TDS.fyOf(a.day) === fy); },
  // ---------- the cloud copy (TCloud.load): read whole each time the books come in (a payroll is small)
  async into(b, book){
    if (!book || typeof TCloud !== "object") return 0;
    const B = "&book_id=eq." + encodeURIComponent(book);
    let emp = [], heads = [], allocs = [], pays = [], vs = [];
    try { emp = await TCloud.restPages("tally_employees?select=guid,name,parent,category,is_group,pan,joined,left_on,designation,gone_at" + B + "&order=name.asc"); }
    catch (e){ if (!/42P01|PGRST20|does not exist|schema cache/i.test(String(e && e.message || e))) throw e; return 0; }      // a cloud without migration 74: nothing of payroll (as before); another error is said (PayLoad)
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
    // next-tds-tidy2 (Leads, Q1 2026-27): a salary payment's or a TDS deposit's cost centres are not pay (the net paid to
    // an employee on "Salary Payable" by employee, 7-Apr / 7-May, read as that day's salary): payroll entries only
    const A = (x.allocs || []).filter(a => live(a) && H[a.ledger] && isEmp.has(normName(a.centre)) && !/payment|receipt|contra/i.test(V[a.guid].type))
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
    // round 92 (E): arrears are salary, whatever type the pay head has in Tally (a client's "Arears" typed a reimbursement)
    if (/reimburse/i.test(t)) return this.isArrears(name) ? "earn" : "reimb";
    if (/loan|advance/i.test(t)) return "loan";
    if (/employer/i.test(t) || /gratuity/i.test(t)) return "employer";
    if (/deduction/i.test(t)) return "ded";
    if (!t.trim() && this.isTds(name)) return "ded";       // a TDS head Tally gave no type
    // a ledger in payroll with no pay type ("Salary Payable", "EPF Payable") is no pay head: not salary (heads read before
    // Bridge 2.4.4 carry no type at all: then earnings, as before)
    if (!t.trim() && !this.headsOld()) return "other";
    return "earn";
  },
  isArrears(name){ return /\bar{1,2}ears?\b/i.test(String(name || "")); },
  // ---------- round 92 (A): the TDS pay head. Tally's statutory type "Income Tax"; else a deduction head the ledger map
  // reads as TDS under 192 (392 under the Act of 2025), or whose name says so ("TDS 192B", "TDS on Salary", "Income Tax");
  // a person's choice on the payroll page ("This pay head is TDS" / "Not TDS", kept in the ledger map: payTds) over all
  // of them. A client's head "TDS 192B" (Deductions From Employees, group TDS) has Tally's statutory type blank: it was
  // read as no TDS, and every employee's TDS as 0. How it is known: "chosen", "tally", "map", "name"; "" when not TDS
  tdsChoice(name){ const m = (this.books().map || {})[name]; return m && typeof m.payTds === "boolean" ? m.payTds : null; },
  tdsName(name){ const u = String(name || "").toUpperCase(); return /\bINCOME[\s-]*TAX\b/.test(u) || /\b(TDS|I\.?\s?T\.?)\b/.test(u) && /SALAR|\b[13]92/.test(u); },
  tdsHow(name){
    const c = this.tdsChoice(name), h = this.head(name), m = typeof Books === "object" ? Books.ledgerOf(name) : null;
    // (the TDS check of 22-Oct-2026, H5: a "Not TDS" head whose name is no TDS, as ESIC, is not the books' TDS ledger)
    const earn = /earning|reimburse|employer|loan|advance|gratuity/i.test(String(h.type || "")), bk = !earn && !!m && m.kind === "tds_payable" && /^(192|392)/.test(String(m.section || "")) && !m.payTdsSet && !(c === false && !/\bTDS\b|INCOME[\s-]*TAX/i.test(name));
    // next-24q-split (Leads): the books' own salary TDS ledger (not one made so by "This pay head is TDS") stays TDS over a
    // "Not TDS": its employee split is that line
    if (c !== null && (c || !bk)) return c ? "chosen" : "";
    if (/^income\s*tax$/i.test(String(h.stat || "").trim())) return "tally";
    if (earn) return "";
    if (bk) return "map";
    return this.tdsName(name) ? "name" : "";
  },
  isTds(name){ return !!this.tdsHow(name); },
  tdsHeads(){ return Object.keys(this.data().heads || {}).filter(h => this.isTds(h)).sort(); },
  // the heads a person may mark as TDS: the employee's deductions (and heads Tally gave no type)
  dedHeads(){ return Object.keys(this.data().heads || {}).filter(h => { const t = String(this.head(h).type || ""); return /deduction/i.test(t) || !t.trim() && (this.data().allocs || []).some(a => a.head === h); }).sort(); },
  // F: pay heads read before Bridge 2.4.4 carry no type (the ledgers were last read before it): asked to read them again
  headsOld(){ const H = this.data().heads || {}, k = Object.keys(H); return k.length > 0 && k.every(n => !String(H[n].type || "").trim() && !String(H[n].stat || "").trim()); },
  // ---------- D: an employee's PAN: Tally's employee PAN, else FinCom's PAN book by the employee's name (TDS.panPick), else
  // the PAN of the employee's own ledger, "Salary <name>" (the PAN book, or Tally's ledger PAN)
  panOf(name, e, ledger){
    let p = TDS.panPick(name, e ? e.pan : "");
    if (/^[A-Z]{5}\d{4}[A-Z]$/.test(p)) return p;
    const ls = Array.from(new Set([ledger, "Salary " + name].filter(Boolean)));
    for (const l of ls){ const x = TDS.panOf(l); if (/^[A-Z]{5}\d{4}[A-Z]$/.test(x)) return x; }
    return p;
  },
  // ---------- C: salary kept without payroll. An employee's own ledger: "Salary <name>", a ledger under Salary Payable, or
  // one named as a payroll employee; its employee's name, else ""
  empLedger(l){
    const s = String(l || "").trim(), m = s.match(/^salary\s*[-:]?\s+(.+)$/i);
    if (m && !/^(payable|a\/?c\b|account|exp|expenses?\b|advance|wages|&|and\b|outstanding|due|paid|to\b|on\b|of\b|for\b|staff|allowance|arrear)/i.test(m[1].trim()) &&
        !/payable|expense|account|\ba\/c\b|wages|provision/i.test(m[1])) return m[1].trim();
    if (this.empByName(s)) return this.empByName(s).name;
    const b = this.books(), up = typeof ledUnder === "function" ? String(ledUnder(b, s) || "") : "";
    if (/^salar(y|ies)\s*payable$/i.test(up.trim()) && !/^salar(y|ies)\b/i.test(s)) return s;
    return "";
  },
  // the books' 192 row of an entry (TDS.allRows) as one row per employee where the entry says whose salary it is: the
  // employee's own ledger credited with the net (gross = net + TDS) or debited when the tax is deducted on paying (gross =
  // the debit); several employees in one entry each with their own salary expense line, in the same order. Else null: the
  // row stays the entry's, said "TDS not split by employee"
  splitBooks(v, r){
    if (!v || !(v.ent || []).length) return null;
    const L = typeof Books === "object" ? Books.lines(v) : {tds: []};
    if ((L.tds || []).filter(t => /^(192|392)/.test(String(t.section || ""))).length !== 1) return null;
    const emps = v.ent.filter(e => Math.abs(num(e.a)) >= 0.005 && this.empLedger(e.l));
    if (!emps.length) return null;
    const T = r2(r.tds);
    if (emps.length === 1){
      const e = emps[0], paid = e.a > 0 ? r2(num(e.a) + T) : r2(-num(e.a));
      return [{employee: this.empLedger(e.l), ledger: e.l, paid, tds: T}];
    }
    const bank = l => { const k = (Books.ledgerOf(l) || {}).kind; return k === "bank" || /tds|tcs|gst|roundoff/.test(String(k || "")); };
    const exp = v.ent.filter(e => e.a < 0 && !this.empLedger(e.l) && !bank(e.l));
    if (!emps.every(e => e.a > 0) || exp.length !== emps.length) return null;
    const parts = emps.map((e, i) => ({employee: this.empLedger(e.l), ledger: e.l, paid: r2(-num(exp[i].a)), tds: r2(-num(exp[i].a) - num(e.a))}));
    if (parts.some(x => x.tds < -0.005) || Math.abs(r2(parts.reduce((a, x) => a + x.tds, 0)) - T) > 0.01) return null;
    return parts;
  },
  // TDS.salaryRows' books rows (section 192), one per employee where the entry says whose: id "<entry>|<TDS ledger>|<employee
  // ledger>", from: "books"
  booksRows(rows){
    const b = this.books(), by = new Map(); (b.vouchers || []).forEach(v => { if (v && v.id) by.set(v.id, v); });
    const out = [];
    rows.forEach(r => {
      const parts = this.splitBooks(by.get(String(r.id).split("|")[0]), r);
      if (!parts){ out.push(Object.assign({}, r, {section: r.section || "192", unsplitBooks: true})); return; }
      parts.forEach(x => {
        const e = this.empByName(x.employee), name = e ? e.name : x.employee, id = String(r.id) + "|" + x.ledger;
        out.push(Object.assign({}, r, {id, party: name, employee: name, empLedger: x.ledger, pan: this.panOf(name, e, x.ledger), tallyPan: e ? e.pan : "", guid: e ? e.guid : "",
          section: "192", paid: x.paid, tds: x.tds, rate: x.paid ? r2(x.tds / x.paid * 100) : null, rateFrom: "books", from: "books", challan: (b.alloc || {})[id] || ""}));
      });
    });
    return out;
  },
  isPT(name){ return /professional\s*tax/i.test(String(this.head(name).stat || "")); },
  // an earning's part of salary for the forms: basic, HRA, or other
  part(name){ const c = String(this.head(name).it || ""); return /^basic/i.test(c) ? "basic" : /house\s*rent/i.test(c) ? "hra" : /dearness/i.test(c) ? "da" : "other"; },
  employees(){ return this.data().employees.filter(e => !e.group); },
  groups(){ return this.data().employees.filter(e => e.group); },
  empByName(name){ const k = normName(name); return this.employees().find(e => normName(e.name) === k) || null; },
  // ---------- the details FinCom keeps for an employee (items: b.payDetails, id "emp:<Tally GUID>")
  FIELDS: ["regime", "senior", "hraMetro", "rent", "landlordPan", "landlordName", "hlInterest", "lenderPan", "lenderName", "prevSalary", "prevTds", "address",
    "d80C", "d80CCD1B", "d80D", "d80DParents", "parentsSenior", "d80E", "d80G", "d80TTA", "d80CCD2", "dOther"],
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
    if (k === "senior" || k === "hraMetro" || k === "parentsSenior") val = val === true || val === "yes" ? "yes" : "no";
    if (k === "address") val = String(val || "").slice(0, 300);
    if (k === "landlordName" || k === "lenderName") val = String(val || "").slice(0, 75);
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
      else if (kind !== "other") r[kind] = r2(r[kind] + v);
      if (this.isTds(a.head)) r.tds = r2(r.tds + v);
      if (this.isPT(a.head)) r.pt = r2(r.pt + v);
    });
    const rows = Object.values(by).map(r => { const e = this.empByName(r.employee); return Object.assign(r, {pan: e ? e.pan : "", guid: e ? e.guid : "", net: r2(r.gross + r.reimb - r.ded - r.loan), vouchers: Array.from(r.vouchers)}); })
      .sort((a, c) => a.employee.localeCompare(c.employee));
    const order = ["earn", "reimb", "ded", "loan", "employer"];
    return {rows, heads: Array.from(heads).sort((a, c) => order.indexOf(this.kind(a)) - order.indexOf(this.kind(c)) || a.localeCompare(c))};
  },
  // ---------- 24Q: one row per employee and payroll entry, dated when the entry credits the salary and the Income Tax pay head
  // deducts the TDS (review 244 M2: the same date Annexure II and Form 16 count the year's TDS by, so a March salary paid in
  // April is March's in every one of them); the salary payment's date beside it when Tally keeps one for that employee
  // within two months. id "pay:<entry GUID>|<employee>"
  tdsRows(){ return typeof perRender === "function" ? perRender(this, "tdsRows", () => this.tdsRowsNow()) : this.tdsRowsNow(); },
  tdsRowsNow(){
    const d = this.data(), b = this.books(), by = {}, ents = {};
    d.allocs.forEach(a => {
      const k = a.guid + "|" + normName(a.employee), kind = this.kind(a.head);
      const r = by[k] = by[k] || {guid: a.guid, employee: a.employee, credit: a.day, paid: 0, tds: 0, arrears: 0};
      if (kind === "earn"){ r.paid = r2(r.paid - a.amt); if (this.isArrears(a.head)) r.arrears = r2(r.arrears - a.amt); }
      if (this.isTds(a.head)) r.tds = r2(r.tds + a.amt);
      if (!ents[a.guid]) ents[a.guid] = a.day;
    });
    const out = Object.values(by).filter(r => r.paid > 0.005 || r.tds > 0.005).map(r => {
      const e = this.empByName(r.employee), pay = d.pays.filter(p => normName(p.employee) === normName(r.employee) && p.paidOn >= r.credit && TDS.monthsBetween(r.credit, p.paidOn) <= 2)
        .sort((x, y) => x.paidOn.localeCompare(y.paidOn))[0];
      const date = r.credit, id = "pay:" + r.guid + "|" + r.employee;
      // next-tds-clear: Tally's payroll PAN, else the one in FinCom's PAN book (b.panFix; TDS.panPick, the order of truth);
      // round 92 (D): else the PAN of the employee's "Salary <name>" ledger
      return {id, date, credit: r.credit, paidOn: pay ? pay.paidOn : "", q: TDS.qOf(date), fy: TDS.fyOf(date), party: r.employee, employee: r.employee, pan: this.panOf(r.employee, e), tallyPan: e ? e.pan : "", guid: e ? e.guid : "",
        section: "192", ledger: "", paid: r.paid, tds: r.tds, rate: r.paid ? r2(r.tds / r.paid * 100) : null, voucher: (d.vouchers[r.guid] || {}).no || "", type: (d.vouchers[r.guid] || {}).type || "",
        src: "payroll", challan: (b.alloc || {})[id] || "", ...(r.arrears ? {arrears: r.arrears, note: "includes arrears ₹" + INR.format(r.arrears) + " (a reimbursement head in Tally, counted as salary)"} : {})};
    });
    // round 92 (B): the TDS the books' 192 line of a payroll entry carries beyond what its employees' TDS adds up to (a TDS
    // head not read as TDS, an employee's TDS missing from the split) stays, as its own row "TDS not split by employee"
    // with a warning: never dropped. id "pay:<entry>|~"
    const split = {}; out.forEach(r => { const g = r.id.slice(4, r.id.indexOf("|")); split[g] = r2((split[g] || 0) + r.tds); });
    // next-tds-tidy2: one row per employee per payroll month (a second entry of the month, arrears or a correction, added to
    // the first's row, its id kept so its challan stays)
    const mon = {};
    out.sort((a, c) => String(a.date).localeCompare(String(c.date))).slice().forEach(r => { const k = normName(r.employee) + "|" + this.ym(r.date), f = mon[k];
      if (!f){ mon[k] = r; return; }
      f.paid = r2(f.paid + r.paid); f.tds = r2(f.tds + r.tds); f.rate = f.paid ? r2(f.tds / f.paid * 100) : null; if (r.note && !f.note){ f.note = r.note; f.arrears = r.arrears; }
      f.also = (f.also || []).concat(r.id.slice(4, r.id.indexOf("|"))); out.splice(out.indexOf(r), 1); });
    (b.vouchers || []).forEach(v => {
      if (!v || !ents[v.id] || !d.vouchers[v.id] || typeof Books !== "object") return;
      const bk = r2((Books.lines(v).tds || []).filter(t => /^(192|392)/.test(String(t.section || ""))).reduce((a, t) => a + t.amount, 0)), gap = r2(bk - (split[v.id] || 0));
      if (gap < 0.5) return;
      const date = ents[v.id], id = "pay:" + v.id + "|~", vv = d.vouchers[v.id];
      out.push({id, date, credit: date, paidOn: "", q: TDS.qOf(date), fy: TDS.fyOf(date), party: this.UNSPLIT, employee: this.UNSPLIT, pan: "", tallyPan: "", guid: "", section: "192", ledger: "",
        paid: 0, tds: gap, rate: null, voucher: vv.no || "", type: vv.type || "", src: "payroll", challan: (b.alloc || {})[id] || "", unsplit: true, booksTds: bk,
        note: this.unsplitWhy(v.id, bk, split[v.id] || 0, gap)});
    });
    out.sort((a, c) => String(a.date).localeCompare(String(c.date)) || a.employee.localeCompare(c.employee));
    // next-challan-match: a month's TDS split across challans by a person is its parts (TDS.expandSplits)
    return TDS.expandSplits(out);
  },
  UNSPLIT: "TDS not split by employee",
  // next-24q-split: why, in plain words: the employees' TDS on a head marked "Not TDS", else Tally's payroll names no employee
  unsplitWhy(g, bk, sp, gap){
    const no = Object.keys(this.data().heads || {}).filter(h => this.tdsChoice(h) === false && this.data().allocs.some(a => a.guid === g && a.head === h));
    const F = x => "₹" + INR.format(x);
    return no.length ? "Its employees' TDS is on pay head " + no.map(h => "\"" + h + "\"").join(", ") + ", marked Not TDS: mark it TDS (Employees & declarations)."
      : "Tally's payroll gives " + F(gap) + " of this entry's TDS (" + F(bk) + ") to no employee; its employees' TDS adds up to " + F(sp) + ". Put it on the employees in this payroll entry in Tally, then read the books again.";
  },
  // next-24q-load: a challan given to a payroll entry's books 192 line (read while the payroll was missing) carried to that
  // entry's employee rows with TDS and no challan, when their TDS fits what is left of it; else left for the matcher
  carry(b){
    const al = b && b === S.books && b.alloc, V = (b && b.payroll || {}).vouchers || {}; let n = 0;
    if (!al) return 0;
    const rows = this.tdsRowsNow();
    Object.keys(al).forEach(k => { const g = k.split("|")[0], c = TDS.challans().find(x => x.id === al[k]);
      if (/^pay:/.test(k) || !V[g] || !c) return;
      const rs = rows.filter(r => r.tds > 0.005 && !al[r.id] && (r.id.indexOf("pay:" + g + "|") === 0 || (r.also || []).indexOf(g) >= 0));
      TDSReg.forget();
      if (!rs.length || rs.reduce((a, r) => a + r.tds, 0) > TDSReg.balance(c).tax + 0.005) return;
      rs.forEach(r => { al[r.id] = c.id; n++; TDSReg.log({act: "tag", ch: c, form: "24Q", fy: r.fy, q: r.q, row: r.id, tax: r.tds, note: "carried from the month's total"}); });
    });
    if (n){ TDSReg.forget(); TDSReg.done(); }
    return n;
  },
  // next-challan-match (the owner, 17-Oct-2026: matches are shown and confirmed, never applied by themselves): the months a
  // Tally payroll TDS payment says it pays are now rule a ("From Tally") of the one matcher (TDSMatch.links, src/js/86),
  // shown on Form 138's Challans tab for a person to confirm. Nothing is tagged here any more; kept so its callers (the
  // cloud read, src/js/49) stay as they are. How many tagged: none
  autoTag(){ return 0; },
  // ---------- 24Q Annexure I: per employee per month, the amount paid or credited, the TDS, the dates and the challan
  annexI(fy, q){
    const ch = {}; (this.books().challans || []).forEach(c => { ch[c.id] = c; });
    // round 92 (C): with the books' salary entries of the year (months kept without payroll), as TDS.salaryRows has them
    return TDS.salaryRows().filter(r => r.fy === fy && r.q === q).map(r => {
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
    // round 92 (C): a month the books carry for this employee without payroll (a salary journal): its salary and TDS
    TDS.salaryRows().filter(r => r.from === "books" && r.fy === fy && normName(r.employee) === normName(e.name)).forEach(r => {
      s.other = r2(s.other + r.paid); s.gross = r2(s.gross + r.paid); s.tds = r2(s.tds + r.tds); s.months.add(this.ym(r.date));
    });
    s.months = s.months.size;
    return s;
  },
  annexII(fy){ return this.employees().filter(e => this.yearOf(e, fy).months > 0 || num(this.detail(e).prevSalary) > 0 && this.yearOf(e, fy).months > 0).map(e => this.form16(e, fy)); },
  form16(e, fy){
    const y = this.yearOf(e, fy), d = this.detail(e);
    const old = d.regime === "old";
    const c = PayTax.compute({fy, regime: old ? "old" : "new", senior: d.senior === "yes", parentsSenior: d.parentsSenior === "yes", hraMetro: d.hraMetro === "yes",
      basic: y.basic, da: y.da, hra: y.hra, other: y.other, pt: y.pt, nps: num(d.d80CCD2), rent: num(d.rent), hlInterest: num(d.hlInterest),
      prevSalary: num(d.prevSalary), prevTds: num(d.prevTds), tdsHere: y.tds, pan: e.pan,
      ded: {c80C: num(d.d80C), c80CCD1B: num(d.d80CCD1B), c80D: num(d.d80D), c80DParents: num(d.d80DParents), c80E: num(d.d80E), c80G: num(d.d80G), c80TTA: num(d.d80TTA), c80CCD2: num(d.d80CCD2), other: num(d.dOther)}});
    return Object.assign({name: e.name, pan: e.pan, guid: e.guid, designation: e.designation, joined: e.joined, left: e.left, address: d.address || "",
      landlordPan: d.landlordPan || "", lenderPan: d.lenderPan || "", landlordName: d.landlordName || "", lenderName: d.lenderName || "", regimeChosen: d.regime ? true : false, months: y.months,
      senior: old && d.senior === "yes", category: old && d.senior === "yes" ? "S" : "G"}, c);
  },
  // ---------- before filing
  checks(fy, q){
    const out = [], rows = this.annexI(fy, q), emp = this.employees();
    const noPan = Array.from(new Set(rows.filter(r => !Certs.validPan(r.pan)).map(r => r.employee)));
    if (noPan.length) out.push({what: "Employees without a valid PAN", n: noPan.length, how: "Tax is at least 20% without one (section 206AA). Add the PAN on the employee in Tally (Payroll Info, Employee).", who: noPan.slice(0, 4)});
    // round 92 (B): TDS of a salary entry not split by employee
    const uns = rows.filter(r => r.unsplit || r.unsplitBooks);
    if (uns.length) out.push({what: "Salary TDS not split by employee", n: uns.length, how: "The books carry ₹" + INR.format(r2(uns.reduce((a, r) => a + r.tds, 0))) + " of TDS under 192 that is not on any employee. Mark the TDS pay head (Employees & declarations), or check the payroll in Tally.", who: uns.slice(0, 4).map(r => fmtDate(tallyDate(r.date)) + " ₹" + INR.format(r.tds))});
    const untagged = rows.filter(r => r.tds > 0.005 && !r.challan);
    if (untagged.length) out.push({what: "Salary TDS not tagged to a challan", n: untagged.length, how: "Pay it with Tally's Stat Payment of Income Tax and its challan (Challan Reconciliation), or tag it under Challans.", who: untagged.slice(0, 4).map(r => r.employee + " " + fmtDate(tallyDate(r.date)))});
    if (q === "Q4"){
      const noReg = emp.filter(e => this.yearOf(e, fy).months > 0 && !this.detail(e).regime);
      if (noReg.length) out.push({what: "Employees without a tax regime chosen", n: noReg.length, how: "The new regime is taken until one is chosen (Salary, Employees).", who: noReg.slice(0, 4).map(e => e.name)});
      const rentNoPan = emp.filter(e => this.detail(e).regime === "old" && num(this.detail(e).rent) > 100000 && !Certs.validPan(this.detail(e).landlordPan));
      if (rentNoPan.length) out.push({what: "Rent over ₹1,00,000 a year without the landlord's PAN", n: rentNoPan.length, how: "The landlord's PAN is needed for the HRA exemption on rent over ₹1,00,000 a year.", who: rentNoPan.slice(0, 4).map(e => e.name)});
      // 24Q's salary record asks the landlord's and the lender's name with the PAN (FVU 8.7, T_FV_6073 / T_FV_6083)
      const noName = emp.filter(e => this.detail(e).regime === "old" && (num(this.detail(e).rent) > 100000 && !String(this.detail(e).landlordName || "").trim() || num(this.detail(e).hlInterest) > 0 && !String(this.detail(e).lenderName || "").trim()));
      if (noName.length) out.push({what: "Landlord's or lender's name missing", n: noName.length, how: "24Q's salary record asks the name with the PAN (Salary, Employees).", who: noName.slice(0, 4).map(e => e.name)});
      const hlNoPan = emp.filter(e => this.detail(e).regime === "old" && num(this.detail(e).hlInterest) > 0 && !this.detail(e).lenderPan);
      if (hlNoPan.length) out.push({what: "Housing-loan interest without the lender's PAN", n: hlNoPan.length, how: "Annexure II asks the lender's PAN with the interest.", who: hlNoPan.slice(0, 4).map(e => e.name)});
      const short = this.annexII(fy).filter(x => x.shortfall > 1);
      if (short.length) out.push({what: "TDS for the year less than due", n: short.length, how: "The year's tax (at least 20% of the income where there is tax and no PAN, section 206AA) is more than the TDS here and with the previous employer; deduct the rest before the year ends.", who: short.slice(0, 4).map(x => x.name + " " + INR.format(x.shortfall))});
      const noRules = this.annexII(fy).filter(x => !x.rulesKnown);
      if (noRules.length) out.push({what: "Tax rules of " + fy + " not in FinCom", n: noRules.length, how: "FinCom works out salary tax for " + PayTax.YEARS.join(" and ") + " only; work out this year's by hand.", who: noRules.slice(0, 4).map(x => x.name)});
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
  YEARS: ["2025-26", "2026-27"],   // the years these rules are written for (review 244 L2): another year is said, never worked out silently
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
    // 17(1), this employer; the employer's NPS contribution (declared) is salary too, then deducted under 80CCD(2) (review 244 H3)
    const nps = r2(Math.max(0, num(i.nps)));
    const salary = r2(num(i.basic) + num(i.da) + num(i.hra) + num(i.other) + nps);
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
      via = {c80C: cap(d.c80C, 150000), c80CCD1B: cap(d.c80CCD1B, 50000), c80D: cap(d.c80D, i.senior ? 50000 : 25000), c80DParents: cap(d.c80DParents, i.parentsSenior ? 50000 : 25000),
        c80E: cap(d.c80E, Infinity), c80G: cap(d.c80G, Infinity), c80TTA: cap(d.c80TTA, i.senior ? 50000 : 10000), c80CCD2: cap(nps, (num(i.basic) + num(i.da)) * 0.10), other: cap(d.other, Infinity)};
    } else {
      via = {c80CCD2: cap(nps, (num(i.basic) + num(i.da)) * 0.14)};
    }
    let via6 = r2(Object.values(via).reduce((a, v) => a + v, 0));
    if (via6 > grossTotal) via6 = grossTotal;
    const total = this.round10(Math.max(0, grossTotal - via6));
    const t = this.tax(total, regime, !!i.senior);
    const cess = r2((t.afterRebate + t.surcharge) * 0.04);
    const taxPayable = this.round10(t.afterRebate + t.surcharge + cess);
    // no valid PAN (section 206AA, review 244 H2): the tax stays the tax (Form 16, Annexure II); the TDS due is at least 20% of
    // the income, only where there is tax
    const noPan = !(typeof Certs === "object" ? Certs.validPan(i.pan) : /^[A-Z]{5}\d{4}[A-Z]$/.test(String(i.pan || "")));
    const tdsDue = noPan && taxPayable > 0 ? Math.max(taxPayable, this.round10(total * 0.20)) : taxPayable;
    const tdsHere = r2(num(i.tdsHere)), prevTds = r2(num(i.prevTds));
    return {regime, rulesKnown: this.YEARS.indexOf(i.fy) >= 0, nps, salary, prevSalary: prev, gross, basic: r2(num(i.basic)), da: r2(num(i.da)), hra: r2(num(i.hra)), other: r2(num(i.other)), perquisites: 0, profitsInLieu: 0,
      hraExempt: hraEx, standard: stdDed, profTax: ptDed, incomeSalary: incSalary, houseProperty: hp, grossTotal, via, chapter6: via6, totalIncome: total,
      slabTax: t.slabTax, rebate: t.rebate, surcharge: t.surcharge, cess, relief89: 0, taxPayable, noPan, tdsHere, prevTds, tdsTotal: r2(tdsHere + prevTds),
      balance: r2(taxPayable - tdsHere - prevTds), tdsDue, shortfall: r2(tdsDue - tdsHere - prevTds)};
  }
};

// 24Q's text file (TDS24Q_FILE) and its download (payFvuDownload) are src/js/73-tds-24q-file.js, with the TDS screens

/* ---------- the page's actions (app/src/screens/tds/Payroll.jsx) ---------- */
function payDetailSet(guid, k, v){
  const e = Payroll.employees().find(x => x.guid === guid);
  if (!Payroll.setDetail(e, k, v)) return;
  saveBooks(); render();
}
// round 92 (A): "This pay head is TDS" / "Not TDS": the person's choice, kept in the ledger map as a confirmed choice (payTds),
// so the books read the head as TDS under 192 too; saved with the books
function payTdsHead(name, yes){
  const b = S.books; if (!b || !name) return;
  b.map = Object.assign({}, b.map || {});
  const m = b.map[name] = Object.assign({n: 0}, b.map[name] || {});
  m.payTds = !!yes; m.byHand = true; m.ok = true; m.okAt = new Date().toISOString(); m.okBy = typeof whoAmI === "function" ? whoAmI() : "";
  if (yes && !(m.kind === "tds_payable" && /^(192|392)/.test(String(m.section || "")))){ m.what = "tds_payable"; m.kind = "tds_payable"; m.section = "192"; m.payTdsSet = 1; }
  // N8: "Not TDS" on a head whose name is no TDS (ESIC) takes it off the TDS ledgers, as Books reads them
  if (!yes && m.kind === "tds_payable" && !/\bTDS\b|INCOME[\s-]*TAX/i.test(name)){ m.kind = ""; m.what = "none"; }
  b.mapV = (b.mapV || 0) + 1;
  if (typeof toast === "function") toast(yes ? "“" + name + "” is the TDS pay head: each employee's TDS is read from it." : "“" + name + "” is not taken as TDS.");
  saveBooks(); render();
}
// F: pay heads read before Bridge 2.4.4 (no type): the ledgers read from Tally again, the existing ledgers-only wake
async function payAskLedgers(){
  try { const r = await Ledgers.askTally(S.coId); toast(r && r.via ? "Tally was asked for the ledgers; the pay heads' types come with them." : "FinCom Bridge or FinCom's cloud is not reaching the Tally computer now."); }
  catch (e){ toast("Could not ask Tally: " + (e && e.message || e)); }
}
