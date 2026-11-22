// Tally Payroll vouchers (next-payroll, docs/PAYROLL.md section 4): a month of salary as Tally's own payroll voucher, each
// employee with their pay-head allocations, the net to the salary payable ledger. Plain JavaScript with no globals (the
// page, the tests and the bridge's spec test read the same builder).
//
//   payHeadPlan(rows, heads, saved)  -> {plan: {key: Tally pay head}, missing: [key]}: each sheet head to a pay head that
//                                       Tally has (the same name, or the statutory kind), or the owner's earlier choice
//   payrollVouchers(o)               -> {vouchers, problems}: the month's vouchers (at most MAX_EMPLOYEES employees each:
//                                       the bridge's 2-second rule), or what stops them (an employee or a pay head Tally
//                                       does not have: the owner is asked; FinCom creates no master)
//   payrollVoucherXml(v)             -> the voucher's XML, exactly the shape in docs/PAYROLL.md (and bridge-go
//                                       payrollimport.go, which refuses anything else)
//   validatePayrollXml(x)            -> [] or what in it is not the spec (the same rules as the bridge)
// Posting: the existing path (app/src/lib/asstEntries.js postDraft -> Bridge.post: the bridge here or the cloud's queue),
// one payroll voucher a posting.

export const MAX_EMPLOYEES = 100;
export const VIEW = "PaySlip Voucher View";
export const CATEGORY = "Primary Cost Category";
const P = (x) => Math.round((Number(x) || 0) * 100);
const amt = (p) => (p < 0 ? "-" : "") + (Math.abs(p) / 100).toFixed(2);
export const xesc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const nk = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// ---------------------------------------------------------------- the sheet's heads to Tally's pay heads
// the keys: "earn:<label>" and "ded:<label>" for the sheet's own heads, "gross" when the sheet has only a gross, and the
// statutory "tds", "pt", "pfEmp", "esiEmp". heads: Tally's pay heads ({name: {type, stat}}, Payroll.data().heads)
const STAT = {
  tds: (n, h) => /income\s*tax/i.test(h.stat || "") || /\b(tds|income\s*tax)\b/i.test(n),
  pt: (n, h) => /professional/i.test(h.stat || "") || /prof(essional)?\.?\s*tax|\bp\.?\s?tax\b/i.test(n),
  pfEmp: (n, h) => (/^pf account|provident/i.test(h.stat || "") || /\b(e?pf|provident)\b/i.test(n)) && !/employer/i.test((h.type || "") + " " + n),
  esiEmp: (n, h) => (/employee state insurance|esi/i.test(h.stat || "") || /\besic?\b/i.test(n)) && !/employer/i.test((h.type || "") + " " + n),
};
export function keysOf(rows) {
  const k = new Set();
  (rows || []).forEach((r) => {
    const earn = Object.keys(r.earn || {});
    earn.forEach((h) => k.add("earn:" + h));
    if (!earn.length && P(r.gross)) k.add("gross");
    if (P(r.tds)) k.add("tds"); if (P(r.profTax)) k.add("pt"); if (P(r.pf)) k.add("pfEmp"); if (P(r.esi)) k.add("esiEmp");
    Object.keys(r.ded || {}).forEach((h) => k.add("ded:" + h));
  });
  return Array.from(k);
}
export const keyWords = (k) => ({ gross: "Gross pay", tds: "TDS", pt: "Professional tax", pfEmp: "PF (employee)", esiEmp: "ESI (employee)" })[k] || k.replace(/^(earn|ded):/, "");
export function payHeadPlan(rows, heads, saved) {
  const names = Object.keys(heads || {}), plan = {}, missing = [];
  const isDed = (n) => /deduction|statutory|loan|advance/i.test((heads[n] || {}).type || "") && !/employer|earning/i.test((heads[n] || {}).type || "");
  const isEarn = (n) => /earning|reimburse|bonus|gratuity/i.test((heads[n] || {}).type || "") || !((heads[n] || {}).type || "").trim();
  keysOf(rows).forEach((k) => {
    const s = (saved || {})[k];
    if (s && names.includes(s)) { plan[k] = s; return; }
    const label = k.replace(/^(earn|ded):/, ""), ded = k.startsWith("ded:") || STAT[k];
    let c = names.filter((n) => nk(n) === nk(label) && (ded ? isDed(n) || !(heads[n] || {}).type : isEarn(n)));
    if (!c.length && STAT[k]) c = names.filter((n) => STAT[k](n, heads[n] || {}) && isDed(n));
    if (c.length === 1) plan[k] = c[0]; else missing.push(k);
  });
  return { plan, missing };
}

// ---------------------------------------------------------------- the month's vouchers
// o: {id, date (yyyy-mm-dd), label ("Oct 2026"), type ("Payroll"), payable (ledger), rows, plan, employees (Tally's names),
//     category}
export function payrollVouchers(o) {
  const problems = [], emp = new Map((o.employees || []).map((e) => [nk(e.name || e), e.name || e]));
  const parts = [];
  (o.rows || []).forEach((r) => {
    const tallyName = emp.get(nk(r.name));
    if (!tallyName) { problems.push("Create the employee “" + r.name + "” in Tally (Payroll), or correct the name on the sheet"); return; }
    const al = [], put = (k, a, earn) => { if (!P(a)) return; const h = (o.plan || {})[k]; if (!h) { problems.push("Pick the pay head for " + keyWords(k)); return; } al.push({ head: h, earn, p: earn ? -P(a) : P(a) }); };
    const earn = Object.entries(r.earn || {});
    if (earn.length) earn.forEach(([h, a]) => put("earn:" + h, a, true)); else put("gross", r.gross, true);
    put("tds", r.tds, false); put("pt", r.profTax, false); put("pfEmp", r.pf, false); put("esiEmp", r.esi, false);
    Object.entries(r.ded || {}).forEach(([h, a]) => put("ded:" + h, a, false));
    // the same pay head twice on one employee (two sheet heads to one pay head): added together
    const merged = []; al.forEach((x) => { const y = merged.find((m) => m.head === x.head && m.earn === x.earn); if (y) y.p += x.p; else merged.push(Object.assign({}, x)); });
    const sum = merged.reduce((s, x) => s + x.p, 0);
    if (-sum !== P(r.net)) problems.push(r.name + ": the pay heads come to " + amt(-sum) + ", the net is " + amt(P(r.net)));
    parts.push({ name: tallyName, p: sum, al: merged });
  });
  const uniq = Array.from(new Set(problems));
  if (uniq.length || !parts.length) return { vouchers: [], problems: uniq.length ? uniq : ["No employee to pay"] };
  if (!String(o.payable || "").trim()) return { vouchers: [], problems: ["Pick the salary payable ledger"] };
  const n = Math.ceil(parts.length / MAX_EMPLOYEES), vouchers = [];
  for (let i = 0; i < n; i++) {
    const es = parts.slice(i * MAX_EMPLOYEES, (i + 1) * MAX_EMPLOYEES);
    vouchers.push({ id: o.id + (n > 1 ? "-" + (i + 1) : ""), type: o.type || "Payroll", date: o.date, payable: o.payable, category: o.category || CATEGORY,
      narration: "Salary for " + o.label + " as per the salary sheet (" + es.length + " employee" + (es.length === 1 ? "" : "s") + (n > 1 ? ", part " + (i + 1) + " of " + n : "") + ")",
      employees: es.map((e) => ({ name: e.name, amount: e.p / 100, heads: e.al.map((x) => ({ head: x.head, earn: x.earn, amount: x.p / 100 })) })),
      net: -es.reduce((s, e) => s + e.p, 0) / 100 });
  }
  return { vouchers, problems: [] };
}

// ---------------------------------------------------------------- the XML (docs/PAYROLL.md 4.1; bridge-go payrollimport.go)
export function payrollVoucherXml(v, remoteId) {
  const d = String(v.date || "").replace(/-/g, ""), t = xesc(v.type || "Payroll");
  let x = '<VOUCHER VCHTYPE="' + t + '" ACTION="Create" OBJVIEW="' + VIEW + '"' + (remoteId ? ' REMOTEID="' + xesc(remoteId) + '"' : "") + ">\n";
  x += "<DATE>" + d + "</DATE>\n<EFFECTIVEDATE>" + d + "</EFFECTIVEDATE>\n<VOUCHERTYPENAME>" + t + "</VOUCHERTYPENAME>\n";
  x += "<NARRATION>" + xesc((String(v.narration || "").trim() ? String(v.narration).trim() + " | " : "") + "TDSDesk:" + v.id) + "</NARRATION>\n";
  x += "<PERSISTEDVIEW>" + VIEW + "</PERSISTEDVIEW>\n<CATEGORYENTRY.LIST>\n<CATEGORY>" + xesc(v.category || CATEGORY) + "</CATEGORY>\n";
  (v.employees || []).forEach((e) => {
    x += "<EMPLOYEEENTRIES.LIST>\n<EMPLOYEENAME>" + xesc(e.name) + "</EMPLOYEENAME>\n<AMOUNT>" + amt(P(e.amount)) + "</AMOUNT>\n";
    (e.heads || []).forEach((h) => { x += "<PAYHEADALLOCATIONS.LIST>\n<PAYHEADNAME>" + xesc(h.head) + "</PAYHEADNAME>\n<ISDEEMEDPOSITIVE>" + (h.earn ? "Yes" : "No") + "</ISDEEMEDPOSITIVE>\n<AMOUNT>" + amt(P(h.amount)) + "</AMOUNT>\n</PAYHEADALLOCATIONS.LIST>\n"; });
    x += "</EMPLOYEEENTRIES.LIST>\n";
  });
  x += "</CATEGORYENTRY.LIST>\n<ALLLEDGERENTRIES.LIST>\n<LEDGERNAME>" + xesc(v.payable) + "</LEDGERNAME>\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<AMOUNT>" + amt(P(v.net)) + "</AMOUNT>\n</ALLLEDGERENTRIES.LIST>\n";
  return x + "</VOUCHER>\n";
}

// ---------------------------------------------------------------- the spec, checked (the bridge's rules, in JavaScript)
// One VOUCHER, exactly these elements in this order, one per line; text with no markup; every amount with two decimals;
// earnings negative (ISDEEMEDPOSITIVE Yes), deductions positive (No); each employee's AMOUNT the sum of their pay heads;
// the one ledger line the net (positive, = minus the employees' sum); 1 to MAX_EMPLOYEES employees, each once; a real date.
const T = "([^<>]*)", A = "(-?\\d{1,13}\\.\\d{2})";
const RE = {
  open: new RegExp('^<VOUCHER VCHTYPE="([^"<>&]*(?:&(?:amp|lt|gt|quot|apos);[^"<>&]*)*)" ACTION="Create" OBJVIEW="' + VIEW + '"(?: REMOTEID="[^"<>]*")?>\\n'),
  head: new RegExp("^<DATE>(\\d{8})</DATE>\\n<EFFECTIVEDATE>(\\d{8})</EFFECTIVEDATE>\\n<VOUCHERTYPENAME>" + T + "</VOUCHERTYPENAME>\\n<NARRATION>" + T + "</NARRATION>\\n<PERSISTEDVIEW>" + VIEW + "</PERSISTEDVIEW>\\n<CATEGORYENTRY.LIST>\\n<CATEGORY>" + T + "</CATEGORY>\\n"),
  emp: new RegExp("^<EMPLOYEEENTRIES.LIST>\\n<EMPLOYEENAME>" + T + "</EMPLOYEENAME>\\n<AMOUNT>" + A + "</AMOUNT>\\n"),
  ph: new RegExp("^<PAYHEADALLOCATIONS.LIST>\\n<PAYHEADNAME>" + T + "</PAYHEADNAME>\\n<ISDEEMEDPOSITIVE>(Yes|No)</ISDEEMEDPOSITIVE>\\n<AMOUNT>" + A + "</AMOUNT>\\n</PAYHEADALLOCATIONS.LIST>\\n"),
  empEnd: /^<\/EMPLOYEEENTRIES.LIST>\n/,
  tail: new RegExp("^</CATEGORYENTRY.LIST>\\n<ALLLEDGERENTRIES.LIST>\\n<LEDGERNAME>" + T + "</LEDGERNAME>\\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\\n<AMOUNT>" + A + "</AMOUNT>\\n</ALLLEDGERENTRIES.LIST>\\n</VOUCHER>\\n?$"),
};
const realDate = (d) => { const y = +d.slice(0, 4), m = +d.slice(4, 6), dd = +d.slice(6, 8); const t = new Date(Date.UTC(y, m - 1, dd)); return y >= 1900 && y < 2100 && t.getUTCMonth() === m - 1 && t.getUTCDate() === dd; };
export function validatePayrollXml(x) {
  let s = String(x || ""), m;
  const bad = (w) => [w];
  if (!(m = s.match(RE.open))) return bad("not a payroll voucher's opening (VCHTYPE, ACTION=\"Create\", OBJVIEW=\"" + VIEW + "\")");
  const vt = m[1]; s = s.slice(m[0].length);
  if (!(m = s.match(RE.head))) return bad("the date, type, narration, view or category is not as the spec has it");
  if (m[1] !== m[2] || !realDate(m[1])) return bad("the date is not a real date, or the effective date differs");
  if (m[3] !== vt) return bad("VOUCHERTYPENAME differs from VCHTYPE");
  if (!m[5].trim()) return bad("no cost category");
  s = s.slice(m[0].length);
  const seen = new Set(); let total = 0, n = 0;
  while ((m = s.match(RE.emp))) {
    const name = m[1], ea = P(m[2]); s = s.slice(m[0].length);
    if (!name.trim() || seen.has(name)) return bad("an employee with no name, or twice: " + name);
    seen.add(name); n++;
    let sum = 0, k = 0, h;
    while ((h = s.match(RE.ph))) {
      const a = P(h[3]); s = s.slice(h[0].length); k++;
      if (!h[1].trim() || a === 0 || (h[2] === "Yes") !== (a < 0)) return bad(name + ": a pay head with no name, no amount, or the wrong sign for " + h[2]);
      sum += a;
    }
    if (!k) return bad(name + ": no pay head");
    if (sum !== ea) return bad(name + ": AMOUNT " + m[2] + " is not the sum of the pay heads");
    if (!(m = s.match(RE.empEnd))) return bad(name + ": something else inside the employee's entry");
    s = s.slice(m[0].length); total += ea;
  }
  if (n < 1 || n > MAX_EMPLOYEES) return bad(n + " employees (1 to " + MAX_EMPLOYEES + " a voucher)");
  if (!(m = s.match(RE.tail))) return bad("something other than the one salary payable line after the employees");
  if (!m[1].trim() || P(m[2]) <= 0 || P(m[2]) !== -total) return bad("the salary payable line is not the net of the employees");
  return [];
}
