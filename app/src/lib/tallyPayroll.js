// Tally Payroll vouchers (next-payroll, docs/PAYROLL.md section 4): a month of salary as Tally's own payroll voucher, each
// employee with their pay-head allocations, the net to the salary payable ledger. Plain JavaScript with no globals (the
// page, the tests and the bridge's spec test read the same builder).
//
//   payHeadPlan(rows, heads, saved)  -> {plan: {key: Tally pay head}, missing: [key]}: each sheet head to a pay head that
//                                       Tally has (the same name, or the statutory kind), or the owner's earlier choice
//   payrollVouchers(o)               -> {vouchers, problems}: the month's vouchers, each one request of its own (at most
//                                       MAX_EMPLOYEES employees and MAX_VOUCHER_BYTES: the bridge's pin), or what stops
//                                       them, in plain words (an employee or a pay head Tally does not have: the owner is
//                                       asked; FinCom creates no master; a name the bridge would refuse: renamed in Tally)
//   payrollVoucherXml(v)             -> the voucher's XML, exactly the shape bridge-go payrollimport.go accepts (2.5.18,
//                                       FinComPayrollImport): Create only, never a REMOTEID
//   validatePayrollXml(x)            -> [] or what in it the bridge would refuse (its rules, in JavaScript; the node test
//                                       also runs the bridge's own Go checks on the builder's output)
// Text: free text (the narration, the category) is cleaned (cleanText: no-break and other odd spaces to plain spaces,
// control and format characters dropped, trimmed, capped). A Tally master's name (employee, pay head, ledger, voucher
// type) is never changed, since Tally finds the master by its name: one the bridge cannot take is refused, said plainly.
// Posting: app/src/lib/payrollPost.js (the second check, the claim, one voucher a Bridge.post, the proof).

export const MAX_EMPLOYEES = 100;        // bridge-go payrollMaxEmployees
export const MAX_PAY_HEADS = 50;         // payrollMaxPayHeads, per employee
export const MAX_NAME = 200;             // payrollMaxName, characters
export const MAX_NARRATION = 2000;       // payrollMaxNarration, characters
export const MAX_REQUEST = 1 << 20;      // payrollMaxBytes, the whole request
// the voucher's own XML: the request less the import envelope round it (the company's name escaped, at most 200
// characters of up to 6 bytes each, and the envelope's fixed text)
export const MAX_VOUCHER_BYTES = MAX_REQUEST - 2048;
const MAX_PAISE = 999999999999;          // 10 digits of rupees (prAmt)
export const VIEW = "PaySlip Voucher View";
export const CATEGORY = "Primary Cost Category";
const P = (x) => Math.round((Number(x) || 0) * 100);
const amt = (p) => (p < 0 ? "-" : "") + (Math.abs(p) / 100).toFixed(2);
export const xesc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const xunesc = (s) => String(s).replace(/&(amp|lt|gt|quot|apos);/g, (m, k) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[k]);
// a name's key for matching the sheet to Tally (letters and digits of any script, case folded)
const nk = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
// the bridge's foldName: upper case, white space runs as one space, trimmed (an employee or a pay head twice)
const fold = (s) => String(s || "").toUpperCase().split(/\s+/).filter(Boolean).join(" ");
const enc = typeof TextEncoder === "function" ? new TextEncoder() : null;
export const byteLen = (s) => (enc ? enc.encode(String(s)).length : unescape(encodeURIComponent(String(s))).length);
const chars = (s) => Array.from(String(s)).length;
const cut = (s, n) => (chars(s) > n ? Array.from(s).slice(0, n).join("") + "…" : s);

// ---------------------------------------------------------------- text the bridge takes (prTextOK)
// Go's unicode.IsPrint: letters, marks, numbers, punctuation, symbols and the ASCII space; nothing else (no NUL, tab, line
// break, no-break space, other spaces, format or bidi characters, private use, unpaired surrogates)
const PRINT = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ]*$/u;
const NOT_PRINT = /[^\p{L}\p{M}\p{N}\p{P}\p{S} ]/gu;
const ODD_SPACE = /[\t\n\v\f\r\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g;
export const printable = (s, max) => PRINT.test(String(s)) && chars(s) <= max;
// free text: odd spaces to spaces, the rest that is not printable dropped, runs of spaces as one, trimmed, capped
export function cleanText(s, max) {
  const t = String(s == null ? "" : s).replace(ODD_SPACE, " ").replace(NOT_PRINT, "").replace(/ {2,}/g, " ").trim();
  return chars(t) <= max ? t : Array.from(t).slice(0, max).join("").trim();
}
function oddWhat(s) {
  if (/[\u00A0\u202F]/.test(s)) return "a no-break space";
  if (/[\t\n\r\v\f\u0085\u2028\u2029]/.test(s)) return "a tab or a line break";
  if (/[\u1680\u2000-\u200A\u205F\u3000]/.test(s)) return "an unusual space";
  if (/[\u0000-\u001F\u007F-\u009F]/.test(s)) return "a control character";
  return "an invisible or unusual character";
}
// why a Tally master's name cannot go in the voucher ("" when it can); what: "employee", "pay head", ...
export function nameProblem(name, what) {
  const s = String(name == null ? "" : name);
  if (!s.trim()) return "The " + what + " has no name";
  const shown = "“" + cut(cleanText(s, 400), 40) + "”";
  if (chars(s) > MAX_NAME) return "The " + what + " " + shown + " has a name longer than " + MAX_NAME + " characters. Shorten it in Tally, then read the books again";
  if (!PRINT.test(s)) return "The " + what + " " + shown + " in Tally has a character FinCom can’t send (" + oddWhat(s) + "). Rename it in Tally, then read the books again";
  return "";
}

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
// o: {id, date (yyyy-mm-dd), label ("Oct 2026"), type ("Payroll"), payable (ledger), rows, plan, employees (Tally's names,
//     or {name, gone}), category, idOf(i, n) (the voucher's id; default: id, or id-1, id-2 ... when split)}
// Each voucher is one request of its own: at most MAX_EMPLOYEES employees and MAX_VOUCHER_BYTES of XML (a month larger
// than that is split, as docs/PAYROLL.md has it: each part its own voucher and its own posting)
export function payrollVouchers(o) {
  const problems = [], say = (w) => { if (!problems.includes(w)) problems.push(w); };
  const live = (o.employees || []).map((e) => (typeof e === "string" ? { name: e } : e)).filter((e) => e && e.name && !e.gone && !e.group);
  const emp = new Map(live.map((e) => [nk(e.name), e.name]));
  const type = o.type || "Payroll", category = cleanText(o.category || CATEGORY, MAX_NAME) || CATEGORY, payable = String(o.payable || "");
  [[type, "voucher type"], [category, "cost category"]].forEach(([n, w]) => { const why = nameProblem(n, w); if (why) say(why); });
  const parts = [], seen = new Map(), headWhy = new Set();
  (o.rows || []).forEach((r) => {
    const tallyName = emp.get(nk(r.name));
    if (!tallyName) { say("Create the employee “" + cleanText(r.name, 80) + "” in Tally (Payroll), or correct the name on the sheet"); return; }
    { const why = nameProblem(tallyName, "employee"); if (why) { say(why); return; } }
    if (seen.has(fold(tallyName))) { say(cleanText(r.name, 80) + " is on the sheet twice (as “" + cleanText(seen.get(fold(tallyName)), 80) + "” too)"); return; }
    seen.set(fold(tallyName), r.name);
    const al = [], put = (k, a, earn) => {
      if (!P(a)) return;
      const h = (o.plan || {})[k];
      if (!h) { say("Pick the pay head for " + keyWords(k)); return; }
      if (!headWhy.has(h)) { headWhy.add(h); const why = nameProblem(h, "pay head"); if (why) say(why); }
      if (P(a) < 0) { say(tallyName + ": " + keyWords(k) + " is negative (" + amt(P(a)) + "). Tally Payroll takes an earning above zero; book a recovery as a deduction"); return; }
      al.push({ head: h, earn, p: earn ? -P(a) : P(a) });
    };
    const earn = Object.entries(r.earn || {});
    if (earn.length) earn.forEach(([h, a]) => put("earn:" + h, a, true)); else put("gross", r.gross, true);
    put("tds", r.tds, false); put("pt", r.profTax, false); put("pfEmp", r.pf, false); put("esiEmp", r.esi, false);
    Object.entries(r.ded || {}).forEach(([h, a]) => put("ded:" + h, a, false));
    // the same pay head twice on one employee (two sheet heads to one pay head): added together; one pay head as both an
    // earning and a deduction cannot be (the bridge takes a pay head once an employee)
    const merged = [];
    al.forEach((x) => { const y = merged.find((m) => fold(m.head) === fold(x.head)); if (!y) merged.push(Object.assign({}, x)); else if (y.earn !== x.earn) say(tallyName + ": the pay head “" + x.head + "” is picked for an earning and a deduction. Pick another pay head for one of them"); else y.p += x.p; });
    if (merged.length > MAX_PAY_HEADS) say(tallyName + " has " + merged.length + " pay heads; one voucher takes at most " + MAX_PAY_HEADS + " for an employee");
    if (merged.some((x) => Math.abs(x.p) > MAX_PAISE)) say(tallyName + ": an amount is too large for Tally Payroll (more than 10 digits of rupees)");
    const sum = merged.reduce((s, x) => s + x.p, 0);
    if (-sum !== P(r.net)) say(tallyName + ": the pay heads come to " + amt(-sum) + ", the net is " + amt(P(r.net)));
    else if (sum >= 0) say(tallyName + ": the net pay is " + amt(-sum) + "; Tally Payroll needs it above zero");
    parts.push({ name: tallyName, p: sum, al: merged });
  });
  if (!problems.length && !parts.length) say("No employee to pay");
  if (!payable.trim()) say("Pick the salary payable ledger");
  else { const why = nameProblem(payable, "salary payable ledger"); if (why) say(why); }
  if (problems.length) return { vouchers: [], problems };
  // the split: a new voucher at MAX_EMPLOYEES, or before its XML would pass the byte cap (the fixed part counted at its
  // largest: a narration of MAX_NARRATION characters of 4 bytes, the names at 6 bytes a character when escaped)
  const fixed = 600 + MAX_NARRATION * 4 + 6 * (chars(type) * 2 + chars(category) + chars(payable)), groups = [];
  let cur = [], size = fixed;
  parts.forEach((e) => {
    const b = byteLen(empXml({ name: e.name, amount: e.p / 100, heads: e.al.map((x) => ({ head: x.head, earn: x.earn, amount: x.p / 100 })) }));
    if (cur.length && (cur.length >= MAX_EMPLOYEES || size + b > MAX_VOUCHER_BYTES)) { groups.push(cur); cur = []; size = fixed; }
    cur.push(e); size += b;
  });
  if (cur.length) groups.push(cur);
  const n = groups.length, idOf = o.idOf || ((i, k) => o.id + (k > 1 ? "-" + (i + 1) : ""));
  const vouchers = groups.map((es, i) => {
    const net = -es.reduce((s, e) => s + e.p, 0);
    if (net > MAX_PAISE) say("The month’s net is too large for one Tally Payroll voucher (more than 10 digits of rupees)");
    const id = idOf(i, n), tag = " | TDSDesk:" + id;
    const text = cleanText("Salary for " + (o.label || "") + " as per the salary sheet (" + es.length + " employee" + (es.length === 1 ? "" : "s") + (n > 1 ? ", part " + (i + 1) + " of " + n : "") + ")", MAX_NARRATION - chars(tag));
    return { id, type, date: o.date, payable, category, narration: text,
      employees: es.map((e) => ({ name: e.name, amount: e.p / 100, heads: e.al.map((x) => ({ head: x.head, earn: x.earn, amount: x.p / 100 })) })),
      gross: -es.reduce((s, e) => s + e.al.filter((x) => x.earn).reduce((t, x) => t + x.p, 0), 0) / 100, net: net / 100, part: i + 1, parts: n };
  });
  if (problems.length) return { vouchers: [], problems };
  // the last word is the bridge's own rules: a voucher they would refuse is not offered
  vouchers.forEach((v) => { const why = validatePayrollXml(payrollVoucherXml(v)); if (why.length) say("FinCom made a voucher the bridge would refuse (" + why[0] + "). Nothing is sent; tell FinCom’s support"); });
  return problems.length ? { vouchers: [], problems } : { vouchers, problems: [] };
}

// ---------------------------------------------------------------- the XML (docs/PAYROLL.md 4.1; bridge-go payrollimport.go)
function empXml(e) {
  let x = "<EMPLOYEEENTRIES.LIST>\n<EMPLOYEENAME>" + xesc(e.name) + "</EMPLOYEENAME>\n<AMOUNT>" + amt(P(e.amount)) + "</AMOUNT>\n";
  (e.heads || []).forEach((h) => { x += "<PAYHEADALLOCATIONS.LIST>\n<PAYHEADNAME>" + xesc(h.head) + "</PAYHEADNAME>\n<ISDEEMEDPOSITIVE>" + (h.earn ? "Yes" : "No") + "</ISDEEMEDPOSITIVE>\n<AMOUNT>" + amt(P(h.amount)) + "</AMOUNT>\n</PAYHEADALLOCATIONS.LIST>\n"; });
  return x + "</EMPLOYEEENTRIES.LIST>\n";
}
// never a REMOTEID (the pin: Create only, never an existing object); FinCom's id in the narration, as every posting
export function payrollVoucherXml(v) {
  const d = String(v.date || "").replace(/-/g, ""), t = xesc(v.type || "Payroll");
  const narr = cleanText(v.narration || "", MAX_NARRATION), tag = "TDSDesk:" + v.id;
  let x = '<VOUCHER VCHTYPE="' + t + '" ACTION="Create" OBJVIEW="' + VIEW + '">\n';
  x += "<DATE>" + d + "</DATE>\n<EFFECTIVEDATE>" + d + "</EFFECTIVEDATE>\n<VOUCHERTYPENAME>" + t + "</VOUCHERTYPENAME>\n";
  x += "<NARRATION>" + xesc(narr ? narr + " | " + tag : tag) + "</NARRATION>\n";
  x += "<PERSISTEDVIEW>" + VIEW + "</PERSISTEDVIEW>\n<CATEGORYENTRY.LIST>\n<CATEGORY>" + xesc(v.category || CATEGORY) + "</CATEGORY>\n";
  (v.employees || []).forEach((e) => { x += empXml(e); });
  x += "</CATEGORYENTRY.LIST>\n<ALLLEDGERENTRIES.LIST>\n<LEDGERNAME>" + xesc(v.payable) + "</LEDGERNAME>\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<AMOUNT>" + amt(P(v.net)) + "</AMOUNT>\n</ALLLEDGERENTRIES.LIST>\n";
  return x + "</VOUCHER>\n";
}

// ---------------------------------------------------------------- the bridge's rules, in JavaScript (payrollVoucherShape)
// One VOUCHER, exactly these elements in this order, one per line, no REMOTEID; text with no markup but the five named
// entities, printable, names at most MAX_NAME characters and the narration MAX_NARRATION; every amount two decimals and at
// most 10 digits of rupees; earnings negative (ISDEEMEDPOSITIVE Yes), deductions positive (No), none zero; each employee's
// AMOUNT the sum of their pay heads and below zero; an employee once and a pay head once an employee (case and spacing
// folded); 1 to MAX_EMPLOYEES employees and 1 to MAX_PAY_HEADS pay heads each; the one ledger line the net (positive, =
// minus the employees' sum); a real date; and the whole within MAX_VOUCHER_BYTES
const T = "((?:[^<>&]|&(?:amp|lt|gt|quot|apos);)*)", A = "(-?\\d{1,10}\\.\\d{2})";
const RE = {
  open: new RegExp('^<VOUCHER VCHTYPE="((?:[^"<>&]|&(?:amp|lt|gt|quot|apos);)*)" ACTION="Create" OBJVIEW="' + VIEW + '">\\n'),
  head: new RegExp("^<DATE>(\\d{8})</DATE>\\n<EFFECTIVEDATE>(\\d{8})</EFFECTIVEDATE>\\n<VOUCHERTYPENAME>" + T + "</VOUCHERTYPENAME>\\n<NARRATION>" + T + "</NARRATION>\\n<PERSISTEDVIEW>" + VIEW + "</PERSISTEDVIEW>\\n<CATEGORYENTRY\\.LIST>\\n<CATEGORY>" + T + "</CATEGORY>\\n"),
  emp: new RegExp("^<EMPLOYEEENTRIES\\.LIST>\\n<EMPLOYEENAME>" + T + "</EMPLOYEENAME>\\n<AMOUNT>" + A + "</AMOUNT>\\n"),
  ph: new RegExp("^<PAYHEADALLOCATIONS\\.LIST>\\n<PAYHEADNAME>" + T + "</PAYHEADNAME>\\n<ISDEEMEDPOSITIVE>(Yes|No)</ISDEEMEDPOSITIVE>\\n<AMOUNT>" + A + "</AMOUNT>\\n</PAYHEADALLOCATIONS\\.LIST>\\n"),
  empEnd: /^<\/EMPLOYEEENTRIES\.LIST>\n/,
  tail: new RegExp("^</CATEGORYENTRY\\.LIST>\\n<ALLLEDGERENTRIES\\.LIST>\\n<LEDGERNAME>" + T + "</LEDGERNAME>\\n<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\\n<AMOUNT>" + A + "</AMOUNT>\\n</ALLLEDGERENTRIES\\.LIST>\\n</VOUCHER>\\n?$"),
};
const realDate = (d) => { const y = +d.slice(0, 4), m = +d.slice(4, 6), dd = +d.slice(6, 8); const t = new Date(Date.UTC(y, m - 1, dd)); return y >= 1900 && y < 2100 && t.getUTCMonth() === m - 1 && t.getUTCDate() === dd; };
const textOK = (raw, max) => printable(xunesc(raw), max);
export function validatePayrollXml(x) {
  let s = String(x || ""), m;
  const bad = (w) => [w];
  if (byteLen(s) > MAX_VOUCHER_BYTES) return bad("larger than one request may be (" + byteLen(s) + " bytes)");
  if (!(m = s.match(RE.open))) return bad("not a payroll voucher's opening (VCHTYPE, ACTION=\"Create\", OBJVIEW=\"" + VIEW + "\", no REMOTEID)");
  const vt = m[1]; s = s.slice(m[0].length);
  if (!(m = s.match(RE.head))) return bad("the date, type, narration, view or category is not as the spec has it");
  if (m[1] !== m[2] || !realDate(m[1])) return bad("the date is not a real date, or the effective date differs");
  if (m[3] !== vt) return bad("VOUCHERTYPENAME differs from VCHTYPE");
  if (!textOK(vt, MAX_NAME) || !textOK(m[4], MAX_NARRATION) || !textOK(m[5], MAX_NAME)) return bad("the voucher type, narration or category is not printable text of a sensible length");
  if (!m[5].trim()) return bad("no cost category");
  s = s.slice(m[0].length);
  const seen = new Set(); let total = 0, n = 0;
  while ((m = s.match(RE.emp))) {
    const name = m[1], ea = P(m[2]); s = s.slice(m[0].length);
    if (!name.trim() || seen.has(fold(xunesc(name)))) return bad("an employee with no name, or twice: " + name);
    if (!textOK(name, MAX_NAME)) return bad("an employee's name is not printable text of a sensible length");
    seen.add(fold(xunesc(name))); n++;
    if (n > MAX_EMPLOYEES) return bad("more than " + MAX_EMPLOYEES + " employees in one voucher");
    let sum = 0, k = 0, h; const heads = new Set();
    while ((h = s.match(RE.ph))) {
      const a = P(h[3]); s = s.slice(h[0].length); k++;
      if (k > MAX_PAY_HEADS) return bad("more than " + MAX_PAY_HEADS + " pay heads for one employee");
      if (!h[1].trim() || a === 0 || (h[2] === "Yes") !== (a < 0)) return bad(name + ": a pay head with no name, no amount, or the wrong sign for " + h[2]);
      if (!textOK(h[1], MAX_NAME)) return bad("a pay head's name is not printable text of a sensible length");
      if (heads.has(fold(xunesc(h[1])))) return bad(name + ": the same pay head twice");
      heads.add(fold(xunesc(h[1])));
      sum += a;
    }
    if (!k) return bad(name + ": no pay head");
    if (sum !== ea) return bad(name + ": AMOUNT " + m[2] + " is not the sum of the pay heads");
    if (ea >= 0) return bad(name + ": the net pay is not above zero");
    if (!(m = s.match(RE.empEnd))) return bad(name + ": something else inside the employee's entry");
    s = s.slice(m[0].length); total += ea;
  }
  if (n < 1) return bad("no employee");
  if (!(m = s.match(RE.tail))) return bad("something other than the one salary payable line after the employees");
  if (!m[1].trim() || P(m[2]) <= 0 || P(m[2]) !== -total) return bad("the salary payable line is not the net of the employees");
  if (!textOK(m[1], MAX_NAME)) return bad("the salary payable ledger's name is not printable text of a sensible length");
  return [];
}
// the Tally company's name, as the bridge's pin checks the envelope ("" when it can be sent)
export const companyProblem = (co) => nameProblem(co, "Tally company");
