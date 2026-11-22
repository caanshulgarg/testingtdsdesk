// node tests/run_nightchecks.mjs - Daily Check's night checks and FinCom's own answers (server/_shared/nightchecks.js), on
// made-up books only. For each check and each self-answer: a match, near misses (₹1.01 off, the wrong party, a date out of
// range), a tie (two that fit: never picked), evidence already used, and empty books. Then the entries' checks
// (acceptance rule 2) and a second run giving the same answer (rule 4).
import { run, checks, answer, checkEntry, entriesFor, askText, inr, ruleHits, ledgerKey } from "../server/_shared/nightchecks.js";

let fails = 0, n = 0;
const ok = (c, w) => { n++; if (!c) { fails++; console.log("  FAIL " + w); } else if (process.env.VERBOSE) console.log("  ok   " + w); };
const eq = (a, b, w) => ok(JSON.stringify(a) === JSON.stringify(b), w + (JSON.stringify(a) === JSON.stringify(b) ? "" : " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"));

// ---------------------------------------------------------------- a made-up client
const TODAY = "20261122";
const under = { "HDFC Bank": "Bank Accounts", "Cash": "Cash-in-Hand", "ABC Traders": "Sundry Creditors", "XYZ Logistics": "Sundry Creditors", "Sample Retail": "Sundry Debtors",
  "Sample Hardware": "Sundry Creditors", "Purchase": "Purchase Accounts", "Sales": "Sales Accounts", "Rent": "Indirect Expenses", "Repairs": "Indirect Expenses", "Salary": "Indirect Expenses",
  "Salary Payable": "Current Liabilities", "Suspense": "Suspense A/c", "Car Loan": "Secured Loans", "Input CGST": "Duties & Taxes", "Input SGST": "Duties & Taxes", "GST Cash Ledger": "Duties & Taxes",
  "Electricity": "Indirect Expenses", "Sample Supplier Co": "Sundry Creditors" };
const groups = { "Bank Accounts": "Current Assets", "Cash-in-Hand": "Current Assets", "Sundry Creditors": "Current Liabilities", "Sundry Debtors": "Current Assets", "Indirect Expenses": "", "Secured Loans": "Loans (Liability)", "Duties & Taxes": "Current Liabilities", "Suspense A/c": "" };
let id = 0;
const V = (date, type, ent, o = {}) => Object.assign({ id: "v" + (++id), date, type, no: String(id), ref: "", party: "", narr: "entry", ent: ent.map(([l, a]) => ({ l, a })) }, o);
// a debit is negative (Tally's sign)
const pay = (date, party, amt, bank = "HDFC Bank", o) => V(date, "Payment", [[party, -amt], [bank, amt]], Object.assign({ party }, o));
const bill = (date, party, amt, o) => V(date, "Purchase", [["Purchase", -amt], [party, amt]], Object.assign({ party }, o));
const sale = (date, party, amt, o) => V(date, "Sales", [[party, -amt], ["Sales", amt]], Object.assign({ party }, o));
const books = (vs, more = {}) => Object.assign({ vouchers: vs, under, groups, map: {}, gstin: { "ABC Traders": "07AAAAA0000A1Z5", "Sample Supplier Co": "07BBBBB0000B1Z5" } }, more);
const LEDGERS = Object.keys(under);
const inp = (vs, more = {}) => Object.assign({ today: TODAY, books: books(vs), ledgers: LEDGERS, bills: [], twob: [], bank: { accounts: [], rows: [] }, rules: [], prior: [], ledgersFor: { cgstIn: "Input CGST", sgstIn: "Input SGST", gstCash: "GST Cash Ledger", salaryPayable: "Salary Payable" } }, more);
const fbill = (idx, vendor, gstin, no, date, total, o = {}) => Object.assign({ id: "e" + idx, status: "draft", partyLedger: vendor, expenseLedger: "Purchase", x: { vendorName: vendor, vendorGstin: gstin, invoiceNo: no, invoiceDate: date, taxable: "", cgst: 0, sgst: 0, igst: 0, total } }, o);
const one = (r, kind) => r.findings.filter((f) => f.kind === kind);

// ---------------------------------------------------------------- empty books
{
  const r = run(inp([]));
  eq(r.findings.length, 0, "empty books: no findings");
  eq(r.entries.length, 0, "empty books: no entries");
  eq(run({ today: TODAY }).findings.length, 0, "no input at all: no findings");
}

// ---------------------------------------------------------------- (a) advances
{
  const ADV = pay("20260812", "ABC Traders", 250000), base = () => [ADV];
  let r = run(inp(base()));
  let f = one(r, "advance_open");
  eq(f.length, 1, "advance: paid 12-Aug, no bill since: found");
  eq(f[0].state, "ask", "advance: nothing fits: ask");
  eq(f[0].ask, "₹2,50,000 advance to ABC Traders on 12-Aug is still open. Has the bill come?", "advance: the question's words");
  // a bill in the books after it knocks it off: no finding
  r = run(inp(base().concat([bill("20261001", "ABC Traders", 250000)])));
  eq(one(r, "advance_open").length + one(r, "wrong_side").length, 0, "advance: a later bill in the books takes it up");
  // a bill before it is paid first (no advance)
  r = run(inp([bill("20260801", "ABC Traders", 250000), pay("20260812", "ABC Traders", 250000)]));
  eq(one(r, "advance_open").length, 0, "advance: payment of an earlier bill is no advance");
  // 60 days: 59 days old is not yet asked
  r = run(inp([pay("20260924", "ABC Traders", 250000)]));
  eq(one(r, "advance_open").length, 0, "advance: 59 days old: not yet");
  // self-answer: FinCom's bill (Inbox) of the same party, same amount, after the advance
  const B = fbill(1, "ABC Traders", "07AAAAA0000A1Z5", "AT/77", "2026-10-02", 250000);
  r = run(inp(base(), { bills: [B] }));
  f = one(r, "advance_open")[0];
  eq(f.state, "resolved", "advance: bill in the Inbox, exact: resolved");
  eq(f.evidence.map((e) => e.ref), ["bill:e1"], "advance: the evidence is the bill");
  // near misses
  r = run(inp(base(), { bills: [Object.assign({}, B, { x: Object.assign({}, B.x, { total: 250001.01 }) })] }));
  eq(one(r, "advance_open")[0].state, "you", "advance: ₹1.01 off: needs you, not resolved");
  r = run(inp(base(), { bills: [Object.assign({}, B, { x: Object.assign({}, B.x, { total: 250001.00 }) })] }));
  eq(one(r, "advance_open")[0].state, "resolved", "advance: ₹1.00 off: resolved");
  r = run(inp(base(), { bills: [fbill(1, "ABD Traders", "07ZZZZZ0000Z1Z5", "AT/77", "2026-10-02", 250000, { partyLedger: "ABD Traders" })] }));
  eq(one(r, "advance_open")[0].state, "ask", "advance: wrong party: ask (never similarity)");
  r = run(inp(base(), { bills: [Object.assign({}, B, { x: Object.assign({}, B.x, { invoiceDate: "2026-08-01" }) })] }));
  eq(one(r, "advance_open")[0].state, "you", "advance: bill dated before the advance: needs you");
  // a tie: two bills fit
  r = run(inp(base(), { bills: [B, fbill(2, "ABC Traders", "07AAAAA0000A1Z5", "AT/78", "2026-10-09", 250000)] }));
  f = one(r, "advance_open")[0];
  eq([f.state, f.candidates.length], ["you", 2], "advance: two bills fit: needs you with both, none picked");
  // a 2B bill (GSTIN match) when FinCom has no bill
  r = run(inp(base(), { twob: [{ gstin: "07AAAAA0000A1Z5", party: "ABC TRADERS", no: "AT-77", date: "20261002", taxable: 211864.41, igst: 0, cgst: 19067.80, sgst: 19067.79, cess: 0 }] }));
  f = one(r, "advance_open")[0];
  eq(f.state, "resolved", "advance: 2B bill of the same GSTIN and amount: resolved");
  // already used: another finding resolved on an earlier night with the same bill
  r = run(inp(base(), { bills: [B], prior: [{ kind: "advance_open", key: "adv:other", state: "resolved", evidence: [{ ref: "bill:e1" }] }] }));
  eq(one(r, "advance_open")[0].state, "ask", "advance: the bill already used by another finding: ask");
  // the same finding's own evidence is not "used"
  const key = one(run(inp(base(), { bills: [B] })), "advance_open")[0].key;
  r = run(inp(base(), { bills: [B], prior: [{ kind: "advance_open", key, state: "resolved", evidence: [{ ref: "bill:e1" }] }] }));
  eq(one(r, "advance_open")[0].state, "resolved", "advance: its own evidence from last night stays");
  // undone by the person: asked, never resolved again
  r = run(inp(base(), { bills: [B], prior: [{ kind: "advance_open", key, state: "ask", undone: true }] }));
  eq(one(r, "advance_open")[0].state, "ask", "advance: undone before: asked, not resolved again");
  // two advances, one bill: a tie for both
  r = run(inp([pay("20260812", "ABC Traders", 250000), pay("20260815", "ABC Traders", 250000)], { bills: [B] }));
  eq(one(r, "advance_open").map((x) => [x.state, x.facts.amt, x.facts.n]), [["ask", 500000, 2]], "advance: two payments to one party: one finding for the party, the total, asked (the one bill fits neither)");
  // received in advance from a customer
  r = run(inp([V("20260801", "Receipt", [["HDFC Bank", -90000], ["Sample Retail", 90000]], { party: "Sample Retail" })]));
  f = one(r, "advance_open")[0];
  eq([f && f.facts.side, f && f.state], ["received", "ask"], "advance received from a customer: asked");
  // wrong side with no advance (an opening debit)
  r = run(inp([], { open: { "XYZ Logistics": -62000 }, booksFrom: "20260401" }));
  f = one(r, "wrong_side")[0];
  eq([f && f.state, f && f.title], ["you", "₹62,000 XYZ Logistics · old balance, no entries this year"], "wrong side: carried in, no entries this year: for the firm, not a question");
  r = run(inp([bill("20260601", "XYZ Logistics", 1000), pay("20260610", "XYZ Logistics", 1000)], { open: { "XYZ Logistics": -62000 }, booksFrom: "20260401" }));
  f = one(r, "wrong_side")[0];
  eq([f && f.state, f && f.ask], ["ask", "₹61,000 is shown as paid in advance to XYZ Logistics. Is a bill pending?"], "wrong side: carried in (less the bill since), and the party is in this year's books: asked");
  r = run(inp([], { open: { "XYZ Logistics": -999 }, booksFrom: "20260401" }));
  eq(one(r, "wrong_side").length, 0, "wrong side: under ₹1,000: nothing");
}

// ---------------------------------------------------------------- (b) unusual entries
{
  let r = run(inp([pay("20261103", "Sample Hardware", 15000, "Cash")]));
  let f = one(r, "cash_big")[0];
  eq([f && f.state, f && f.ask], ["ask", "₹15,000 paid in cash to Sample Hardware on 03-Nov. Please send the bill."], "cash: ₹15,000 to one party: asked");
  r = run(inp([pay("20261103", "Sample Hardware", 10000, "Cash")]));
  eq(one(r, "cash_big").length, 0, "cash: exactly ₹10,000: not above the limit");
  r = run(inp([pay("20261103", "Sample Hardware", 15000, "Cash")], { bills: [fbill(3, "Sample Hardware", "", "SH/9", "2026-11-02", 15000)] }));
  eq(one(r, "cash_big")[0].state, "resolved", "cash: the bill is in FinCom: resolved");
  r = run(inp([pay("20261103", "Sample Hardware", 15000, "Cash")], { bills: [fbill(3, "Sample Hardware", "", "SH/9", "2026-11-02", 15001.01)] }));
  eq(one(r, "cash_big")[0].state, "you", "cash: bill ₹1.01 off: needs you");
  // round sums: a journal of ₹60,000 to rent, once (ask) and every month (explained by history)
  const jr = (d, amt) => V(d, "Journal", [["Rent", -amt], ["Suspense", amt]], { narr: "rent" });
  r = run(inp([jr("20261101", 60000)]));
  eq(one(r, "round_sum")[0].state, "ask", "round sum: once: asked");
  r = run(inp([jr("20260701", 60000), jr("20260801", 60000), jr("20260901", 60000), jr("20261101", 60000)]));
  eq(one(r, "round_sum").filter((x) => x.facts.date === "20261101")[0].state, "resolved", "round sum: same in 3 earlier months: explained");
  r = run(inp([jr("20261101", 45000)]));
  eq(one(r, "round_sum").length, 0, "round sum: under ₹50,000: nothing");
  // big entry with no narration
  r = run(inp([V("20261109", "Payment", [["Repairs", -140000], ["HDFC Bank", 140000]], { narr: "" })]));
  eq(one(r, "no_narration")[0].state, "ask", "no narration: ₹1,40,000 payment: asked");
  r = run(inp([V("20261109", "Payment", [["Repairs", -140000], ["HDFC Bank", 140000]], { narr: "", ref: "RP/12" })]));
  eq(one(r, "no_narration")[0].state, "resolved", "no narration: a bill reference in the entry: explained");
  // expense jump: October 1,84,000 against about 22,000
  const rep = (d, a) => V(d, "Journal", [["Repairs", -a], ["Sample Hardware", a]], { party: "Sample Hardware", narr: "x" });
  r = run(inp([rep("20260710", 22000), rep("20260810", 21000), rep("20260910", 22700), rep("20261012", 184000)]));
  f = one(r, "expense_jump")[0];
  eq([f && f.state, f && f.facts.times], ["ask", 8], "expense jump: 8× the 3-month average: asked");
  r = run(inp([rep("20260710", 22000), rep("20260810", 21000), rep("20260910", 22700), rep("20261012", 60000)]));
  eq(one(r, "expense_jump").length, 0, "expense jump: under 3×: nothing");
  // suspense
  r = run(inp([V("20260930", "Journal", [["Suspense", -12300], ["HDFC Bank", 12300]])]));
  f = one(r, "suspense")[0];
  eq([f && f.state, f && f.title], ["you", "Suspense ₹12,300 since 30-Sep"], "suspense: needs you (the firm clears it)");
  r = run(inp([V("20261110", "Journal", [["Suspense", -12300], ["HDFC Bank", 12300]])]));
  eq(one(r, "suspense").length, 0, "suspense: under 30 days old: nothing yet");
}

// ---------------------------------------------------------------- (c) bank lines
{
  const acct = { id: "a1", ledger: "HDFC Bank", name: "HDFC", last4: "2231" };
  const row = (o) => Object.assign({ id: "r1", acct: "a1", date: "2026-11-05", narr: "UPI/RAMESH/9999", debit: 48000, credit: 0, ledger: "", state: "attention", dec: { name: "RAMESH", mode: "UPI" } }, o);
  const B = (rows, more = {}) => Object.assign({ bank: { accounts: [acct], rows } }, more);
  let r = run(inp([], B([row()])));
  let f = one(r, "bank_no_bill")[0];
  eq([f.state, f.ask], ["ask", "₹48,000 paid to RAMESH on 05-Nov: what is it for? A bill, salary or advance?"], "bank: nothing fits: precise question");
  r = run(inp([], B([row({ ledger: "Salary", userSet: true, state: "ready" })])));
  eq(one(r, "bank_no_bill").length, 0, "bank: a line a person set: nothing");
  for (const st of ["sent", "intally", "ready", "ignored"]) eq(one(run(inp([], B([row({ state: st })]))), "bank_no_bill").length, 0, "bank: a line " + st + ": nothing");
  r = run(inp([], B([row({ ledger: "Salary", state: "suggested" })])));
  eq([one(r, "bank_no_bill").length, one(r, "bank_no_bill")[0].state, one(r, "bank_no_bill")[0].title], [1, "you", "₹48,000 paid 05-Nov · guess: Salary · right?"], "bank: a suggested (guessed) ledger is checked, never the answer; nothing certain: needs you, not the client (N5)");
  // learnt rules and history (the shapes the cloud keeps)
  r = run(inp([], B([row({ dec: { name: "RAMESH", key: "upi:ramesh@okbank" } })], { learned: [{ key: "upi:ramesh@okbank", dir: "out", ledger: "Salary", auto: true, label: "RAMESH", at: "2026-10-01T00:00:00Z" }] })));
  eq([one(r, "bank_no_bill")[0].state, one(r, "bank_no_bill")[0].evidence[0].ledger], ["resolved", "Salary"], "bank: a learnt rule (same key, same direction): resolved");
  r = run(inp([], B([row({ dec: { name: "RAMESH", key: "upi:ramesh@okbank" } })], { learned: [{ key: "upi:ramesh@okbank", dir: "in", ledger: "Salary" }] })));
  eq(one(r, "bank_no_bill")[0].state, "ask", "bank: a learnt rule for the other direction: not used");
  const H = (l, s = "you") => ({ k: "upi:ramesh@okbank", p: "ramesh", t: "", l, d: "out", dt: "2026-09-01", s, n: "RAMESH" });
  r = run(inp([], B([row({ dec: { name: "RAMESH", key: "upi:ramesh@okbank" } })], { history: [H("Salary"), H("Salary")] })));
  eq(one(r, "bank_no_bill")[0].state, "resolved", "bank: chosen twice before, the same ledger: resolved");
  r = run(inp([], B([row({ dec: { name: "RAMESH", key: "upi:ramesh@okbank" } })], { history: [H("Salary"), H("Repairs")] })));
  eq(one(r, "bank_no_bill")[0].state, "you", "bank: two ledgers before: needs you");
  r = run(inp([], B([row({ dec: { name: "RAMESH", key: "upi:ramesh@okbank" } })], { history: [H("Salary")] })));
  eq(one(r, "bank_no_bill")[0].state, "ask", "bank: chosen once before: not enough");
  // re-review N1: a key made from the narration is never exact
  const NK = "narr:rameshpaymentnov";
  r = run(inp([], B([row({ dec: { name: "RAMESH", key: NK } })], { learned: [{ key: NK, dir: "out", ledger: "Salary" }] })));
  eq(one(r, "bank_no_bill")[0].state, "you", "N1: a learnt rule on a narration key: needs you, never resolved");
  r = run(inp([], B([row({ dec: { name: "RAMESH", key: NK } })], { history: [Object.assign(H("Salary"), { k: NK }), Object.assign(H("Salary"), { k: NK })] })));
  eq(one(r, "bank_no_bill")[0].state, "you", "N1: history on a narration key: needs you");
  // N1: a rule for either direction: exact only with a person's choice in this direction
  const K = "upi:ramesh@okbank";
  r = run(inp([], B([row({ dec: { name: "RAMESH", key: K } })], { learned: [{ key: K, dir: "any", ledger: "Salary" }] })));
  eq(one(r, "bank_no_bill")[0].state, "you", "N1: an “any” rule with no choice in this direction: needs you");
  r = run(inp([], B([row({ dec: { name: "RAMESH", key: K } })], { learned: [{ key: K, dir: "any", ledger: "Salary" }], history: [Object.assign(H("Salary"), { d: "in" })] })));
  eq(one(r, "bank_no_bill")[0].state, "you", "N1: an “any” rule with a choice only in the other direction: needs you");
  r = run(inp([], B([row({ dec: { name: "RAMESH", key: K } })], { learned: [{ key: K, dir: "any", ledger: "Salary" }], history: [H("Salary")] })));
  eq(one(r, "bank_no_bill")[0].state, "resolved", "N1: an “any” rule with a person's choice in this direction: resolved");
  // N5: history with no source is not counted
  r = run(inp([], B([row({ dec: { name: "RAMESH", key: K } })], { history: [Object.assign(H("Salary"), { s: undefined }), Object.assign(H("Salary"), { s: "" })] })));
  eq(one(r, "bank_no_bill")[0].state, "ask", "N5: history with a missing source: not counted");
  // a written rule
  const rule = { id: "w1", when: { text: [{ op: "has", v: "bses" }], dir: "out", amtMin: "", amtMax: "" }, then: { ledger: "Electricity" } };
  r = run(inp([], B([row({ narr: "NEFT/BSES RAJDHANI/112", dec: { name: "BSES RAJDHANI" }, debit: 9800 })], { rules: [rule] })));
  f = one(r, "bank_no_bill")[0];
  eq([f.state, f.evidence[0].ledger], ["resolved", "Electricity"], "bank: a written rule: resolved");
  // two rules naming the same ledger: one answer; two naming different ledgers: a tie
  const rule2 = { id: "w2", when: { text: [{ op: "has", v: "rajdhani" }], dir: "", amtMin: "", amtMax: "" }, then: { ledger: "Electricity" } };
  const rule3 = { id: "w3", when: { text: [{ op: "has", v: "rajdhani" }], dir: "", amtMin: "", amtMax: "" }, then: { ledger: "Repairs" } };
  r = run(inp([], B([row({ narr: "NEFT/BSES RAJDHANI/112", debit: 9800, dec: { name: "BSES" } })], { rules: [rule, rule2] })));
  eq(one(r, "bank_no_bill")[0].state, "resolved", "bank: two rules, same ledger: one answer");
  r = run(inp([], B([row({ narr: "NEFT/BSES RAJDHANI/112", debit: 9800, dec: { name: "BSES" } })], { rules: [rule, rule3] })));
  eq(one(r, "bank_no_bill")[0].state, "you", "bank: two rules, different ledgers: needs you");
  // a GST challan: same amount, same day
  r = run(inp([], B([row({ narr: "GST PMT CIN 4471", dec: { name: "GST" }, debit: 18450, date: "2026-11-07" })], { challans: [{ ref: "HDFC26110700004471", kind: "gst", date: "2026-11-07", amt: 18450 }] })));
  f = one(r, "bank_no_bill")[0];
  eq([f.state, f.evidence[0].t], ["resolved", "challan"], "bank: a GST challan exact: resolved");
  r = run(inp([], B([row({ narr: "GST PMT", dec: { name: "GST" }, debit: 18450, date: "2026-11-07" })], { challans: [{ ref: "C1", kind: "gst", date: "2026-11-03", amt: 18450 }] })));
  eq(one(r, "bank_no_bill")[0].state, "you", "bank: challan 4 days apart: needs you");
  // a sales invoice of the customer the line names
  r = run(inp([sale("20261028", "Sample Retail", 26500, { no: "TM/211" })], B([row({ narr: "NEFT/SAMPLE RETAIL/88", dec: { name: "SAMPLE RETAIL" }, debit: 0, credit: 26500, date: "2026-11-10" })])));
  f = one(r, "bank_no_bill")[0];
  eq([f.state, f.evidence[0].ref], ["resolved", "vch:" + "v" + id], "bank: receipt pays one invoice in full: resolved");
  // two invoices of the same amount: a tie
  r = run(inp([sale("20261030", "Sample Retail", 75000), sale("20261104", "Sample Retail", 75000)], B([row({ narr: "NEFT/SAMPLE RETAIL", dec: { name: "SAMPLE RETAIL" }, debit: 0, credit: 75000, date: "2026-11-12" })])));
  f = one(r, "bank_no_bill")[0];
  eq([f.state, f.candidates.length], ["you", 2], "bank: two invoices fit: needs you with both");
  // the wrong party: an invoice of another customer with the same amount
  r = run(inp([sale("20261028", "Sample Retail", 26500)], B([row({ narr: "NEFT/OTHER BUYER", dec: { name: "OTHER BUYER" }, debit: 0, credit: 26500, date: "2026-11-10" })])));
  eq(one(r, "bank_no_bill")[0].state, "ask", "bank: invoice of another party: ask");
  // salary: the sheet's net for October, a line that says salary
  const sal = [{ name: "A", date: "2026-10-31", gross: 30000, tds: 0 }, { name: "B", date: "2026-10-31", gross: 18000, tds: 0 }];
  // (phase 2) against salary payable only when October's payroll is booked to it: else Needs you
  r = run(inp([], B([row({ narr: "SALARY OCT", dec: { name: "SALARY" }, debit: 48000, date: "2026-11-01" })], { salary: sal })));
  eq(one(r, "bank_no_bill")[0].state, "you", "bank: the salary sheet's net, the payroll not booked yet: needs you");
  // (the night gives the client's certain salary ledger: nightinput ledgersFor.salaryExpense)
  r = run(inp([V("20261031", "Journal", [["Salary", -48000], ["Salary Payable", 48000]])], B([row({ narr: "SALARY OCT", dec: { name: "SALARY" }, debit: 48000, date: "2026-11-01" })], { salary: sal, ledgersFor: { salaryPayable: "Salary Payable", salaryExpense: "Salary" } })));
  eq(one(r, "bank_no_bill")[0].state, "resolved", "bank: the salary sheet's net, the payroll booked to salary payable: resolved");
  r = run(inp([V("20261031", "Journal", [["Salary", -48000], ["Salary Payable", 48000]])], B([row({ narr: "SALARY OCT", dec: { name: "SALARY" }, debit: 48000, date: "2026-11-01" })], { salary: sal, ledgersFor: { salaryPayable: "" } })));
  eq(one(r, "bank_no_bill")[0].state, "you", "bank: the salary sheet's net, no certain salary payable ledger: needs you");
  // a loan's EMI: the same amount to the loan in 3 earlier months
  const emi = ["20260805", "20260905", "20261005"].map((d) => V(d, "Payment", [["Car Loan", -21500], ["HDFC Bank", 21500]]));
  r = run(inp(emi, B([row({ narr: "ACH/CARLOAN", dec: { name: "BANK" }, debit: 21500, date: "2026-11-05" })])));
  eq(one(r, "bank_no_bill")[0].state, "resolved", "bank: EMI pattern: resolved");
  r = run(inp(emi.slice(1), B([row({ narr: "ACH/CARLOAN", dec: { name: "BANK" }, debit: 21500, date: "2026-11-05" })])));
  eq(one(r, "bank_no_bill")[0].state, "ask", "bank: only 2 earlier months: ask");
  // a month with no statement
  r = run(inp([], B([row({ date: "2026-08-10", ledger: "Rent" }), row({ id: "r2", date: "2026-10-10", ledger: "Rent" })])));
  f = one(r, "bank_month_missing").map((x) => x.facts.ym);
  eq(f, ["202609"], "bank: September missing between August and October");
  eq(one(r, "bank_month_missing")[0].ask, "Please send the bank statement (account ending 2231) for Sep 2026.", "bank month: the words");
  r = run(inp([], B([row({ date: "2026-08-10", ledger: "Rent" }), row({ id: "r2", date: "2026-10-10", ledger: "Rent" })], { inboxUnread: 2 })));
  eq(one(r, "bank_month_missing")[0].state, "you", "bank month: Inbox files not read: read them first, ask nothing");
}

// ---------------------------------------------------------------- (d) 2B and sales
{
  const doc = { gstin: "07BBBBB0000B1Z5", party: "Sample Supplier Co", no: "SSC/1093", date: "20261022", taxable: 31000, igst: 0, cgst: 2790, sgst: 2790, cess: 0 };
  let r = run(inp([], { twob: [doc] }));
  let f = one(r, "twob_not_in_books")[0];
  eq([f.state, f.ask], ["ask", "Please send bill SSC/1093 from Sample Supplier Co (₹36,580, Oct 2026)."], "2B: bill not in books, nowhere: asked");
  const B = fbill(5, "Sample Supplier Co", "07BBBBB0000B1Z5", "SSC-1093", "2026-10-22", 36580, { x: { vendorName: "Sample Supplier Co", vendorGstin: "07BBBBB0000B1Z5", invoiceNo: "SSC-1093", invoiceDate: "2026-10-22", taxable: 31000, cgst: 2790, sgst: 2790, igst: 0, total: 36580 } });
  r = run(inp([], { twob: [doc], bills: [B] }));
  f = one(r, "twob_not_in_books")[0];
  eq(f.state, "resolved", "2B: the bill is in the Inbox (same GSTIN, number, amount): resolved");
  eq(r.entries.length, 1, "2B: an entry is prepared from the Inbox bill");
  eq(r.entries[0].ready, true, "2B: its checks pass: ready");
  eq(r.entries[0].voucher.lines.map((l) => [l.ledger, l.dr || 0, l.cr || 0]), [["Purchase", 31000, 0], ["Input CGST", 2790, 0], ["Input SGST", 2790, 0], ["Sample Supplier Co", 0, 36580]], "2B: the entry's lines");
  r = run(inp([], { twob: [doc], bills: [Object.assign({}, B, { x: Object.assign({}, B.x, { total: 36590 }) })] }));
  eq(one(r, "twob_not_in_books")[0].state, "you", "2B: Inbox bill with another amount: needs you");
  r = run(inp([], { twob: [doc], bills: [Object.assign({}, B, { status: "posted" })] }));
  eq([one(r, "twob_not_in_books")[0].state, r.entries.length], ["resolved", 0], "2B: the bill already posted: nothing to prepare");
  // sales
  const s = ["20260710", "20260810", "20260910"].map((d) => sale(d, "Sample Retail", 1000));
  r = run(inp(s));
  eq(one(r, "sales_month_missing").map((x) => x.facts.ym), ["202610"], "sales: October has none after sales every month");
  r = run(inp(s, { readTo: "20261015" }));
  eq(one(r, "sales_month_missing")[0].state, "you", "sales: books read only up to 15-Oct: needs you, no question");
  r = run(inp([sale("20250110", "Sample Retail", 1000)]));
  eq(one(r, "sales_month_missing").length, 0, "sales: a client that sold once long ago: no question");
}

// ---------------------------------------------------------------- (e) salary
{
  const sheet = [{ name: "A", date: "2026-08-31", gross: 30000, tds: 0 }, { name: "A", date: "2026-09-30", gross: 30000, tds: 0 }];
  const booked = (d) => V(d, "Journal", [["Salary", -30000], ["Salary Payable", 30000]]);
  const paid = (d, a) => V(d, "Payment", [["Salary Payable", -a], ["HDFC Bank", a]]);
  let r = run(inp([booked("20260831"), booked("20260930"), booked("20261031"), paid("20260905", 30000), paid("20261005", 30000)], { salary: sheet }));
  eq(one(r, "salary_month_missing").map((x) => x.facts.ym), ["202610"], "salary: October booked, no sheet: asked");
  eq(one(r, "salary_mismatch").length, 0, "salary: paid equals the sheet: nothing");
  r = run(inp([booked("20260831"), paid("20260905", 31600)], { salary: sheet.slice(0, 1) }));
  const f = one(r, "salary_mismatch")[0];
  eq([f && f.state, f && f.ask], ["ask", "Salary paid for Aug 2026 is ₹31,600 but the sheet says ₹30,000. What is the ₹1,600?"], "salary: paid differs from the sheet");
  r = run(inp([booked("20260831"), paid("20260905", 30001)], { salary: sheet.slice(0, 1) }));
  eq(one(r, "salary_mismatch").length, 0, "salary: ₹1 off: same");
  eq(run(inp([booked("20261031")])).findings.filter((x) => /salary/.test(x.kind)).length, 0, "salary: no sheet ever: no question");
}

// ---------------------------------------------------------------- entry checks (acceptance rule 2)
{
  const base = { source: "twob_inbox_bill", work_ref: "e9", voucher: { type: "Purchase", date: "20261022", no: "X/1", party: "Sample Supplier Co", lines: [{ ledger: "Purchase", dr: 1000 }, { ledger: "Input CGST", dr: 90 }, { ledger: "Input SGST", dr: 90 }, { ledger: "Sample Supplier Co", cr: 1180 }], gst: { taxable: 1000, cgst: 90, sgst: 90, igst: 0 } } };
  const I = inp([]);
  const res = (e, i = I) => Object.fromEntries(checkEntry(e, i).map((c) => [c.k, c.ok]));
  eq(res(base), { drcr: true, ledgers: true, period: true, duplicate: true, gst: true }, "entry: all checks pass");
  const m = (f) => { const e = JSON.parse(JSON.stringify(base)); f(e); return e; };
  eq(res(m((e) => { e.voucher.lines[3].cr = 1180.01; })).drcr, false, "entry: Dr ≠ Cr by a paisa: fails");
  eq(res(m((e) => { e.voucher.lines[0].ledger = "Purchase @ 18%"; })).ledgers, false, "entry: a ledger not in Tally: fails");
  eq(res(base, Object.assign({}, I, { closed: [{ from: "20260401", to: "20261031" }] })).period, false, "entry: in a closed period: fails");
  eq(res(base, inp([V("20261022", "Purchase", [["Purchase", -1180], ["Sample Supplier Co", 1180]], { party: "Sample Supplier Co", ref: "X-1" })])).duplicate, false, "entry: same party and bill number in the books: duplicate");
  eq(res(base, Object.assign({}, I, { bills: [fbill(7, "Sample Supplier Co", "", "X1", "2026-10-22", 1180)] })).duplicate, false, "entry: same bill drafted in FinCom: duplicate");
  eq(res(base, Object.assign({}, I, { bills: [fbill(9, "Sample Supplier Co", "", "X1", "2026-10-22", 1180)] })).duplicate, true, "entry: its own bill is not a duplicate");
  eq(res(m((e) => { e.voucher.gst.cgst = 90; e.voucher.gst.sgst = 91; e.voucher.lines[2].dr = 91; e.voucher.lines[3].cr = 1181; })).gst, false, "entry: CGST ≠ SGST: fails");
  eq(res(m((e) => { e.voucher.gst = { taxable: 1000, cgst: 70, sgst: 70, igst: 0 }; })).gst, false, "entry: 14% is no GST rate: fails");
  const r = entriesFor([{ kind: "twob_not_in_books", key: "k", state: "resolved", facts: { gstin: "G" }, evidence: [{ t: "doc", ref: "bill:e1", work: "e1" }], short: "x" }], inp([], { bills: [fbill(1, "Sample Supplier Co", "G", "Z9", "2026-10-22", 1180, { expenseLedger: "Purchase @ 18%", x: { vendorName: "Sample Supplier Co", vendorGstin: "G", invoiceNo: "Z9", invoiceDate: "2026-10-22", taxable: 1000, cgst: 90, sgst: 90, igst: 0, total: 1180 } })] }));
  eq([r.length, r[0].ready], [1, false], "entry: a failed check: held, never shown as ready");
}

// ---------------------------------------------------------------- the same night twice: the same answer (rule 4)
{
  const I = inp([pay("20260812", "ABC Traders", 250000), pay("20261103", "Sample Hardware", 15000, "Cash")], { bills: [fbill(1, "ABC Traders", "07AAAAA0000A1Z5", "AT/77", "2026-10-02", 250000)] });
  const a = run(I), b = run(I);
  eq(JSON.stringify(a), JSON.stringify(b), "a second run gives the same findings and entries");
  eq(new Set(a.findings.map((f) => f.kind + "|" + f.key)).size, a.findings.length, "every finding's key is unique");
  // with last night's answers as prior, nothing changes
  const prior = a.findings.map((f) => ({ kind: f.kind, key: f.key, state: f.state, evidence: f.evidence }));
  eq(JSON.stringify(run(Object.assign({}, I, { prior })).findings), JSON.stringify(a.findings), "with last night's answers: the same");
}


// ---------------------------------------------------------------- the review's cases (22-Nov-2026)
{
  const acct = { id: "a1", ledger: "HDFC Bank", last4: "2231" };
  const row = (o) => Object.assign({ id: "r1", acct: "a1", sid: "s1", date: "2026-11-10", narr: "NEFT/RAMESHWAR ENTERPRISES/88", debit: 0, credit: 26500, ledger: "", state: "attention", dec: { name: "RAMESHWAR ENTERPRISES" } }, o);
  const B = (rows, more = {}) => Object.assign({ bank: { accounts: [acct], rows } }, more);
  // H2: a party's name inside another name is no match
  const under2 = Object.assign({}, under, { "Ramesh": "Sundry Debtors" });
  const I2 = (vs, more) => { const i = inp(vs, more); i.books.under = under2; return i; };
  let r = run(I2([sale("20261028", "Ramesh", 26500)], B([row()])));
  eq(one(r, "bank_no_bill")[0].state, "you", "H2: “RAMESHWAR ENTERPRISES” holds “Ramesh”: needs you, never resolved");
  r = run(I2([sale("20261028", "Ramesh", 26500)], B([row({ narr: "NEFT/RAMESH/88", dec: { name: "RAMESH" } })])));
  eq(one(r, "bank_no_bill")[0].state, "resolved", "H2: the decoded name is the party's: resolved");
  r = run(I2([sale("20261028", "Ramesh", 26500)], B([row({ narr: "NEFT/RAMESH/88", dec: { name: "" } })])));
  eq(one(r, "bank_no_bill")[0].state, "you", "H2: the name only in the narration: needs you");
  // H1: the key is the statement's, whatever the account's ledger
  const k1 = one(run(inp([], { bank: { accounts: [{ id: "a1", ledger: "" }], rows: [row({ acct: "a1" })] } })), "bank_no_bill")[0].key;
  const k2 = one(run(inp([], { bank: { accounts: [{ id: "a1", ledger: "HDFC Bank" }], rows: [row({ acct: "a1" })] } })), "bank_no_bill")[0].key;
  eq([k1, k1 === k2], ["bank:s1:r1", true], "H1: the bank line's key is the statement's and the line's");
  // M1: an invoice already settled by a receipt in the books is no candidate
  const inv = sale("20261028", "Sample Retail", 26500), rec = V("20261030", "Receipt", [["HDFC Bank", -26500], ["Sample Retail", 26500]], { party: "Sample Retail" });
  r = run(inp([inv, rec], B([row({ narr: "NEFT/SAMPLE RETAIL", dec: { name: "SAMPLE RETAIL" } })])));
  eq(one(r, "bank_no_bill")[0].state, "ask", "M1: the invoice was paid already (a receipt in the books): not a candidate");
  r = run(inp([inv], B([row({ narr: "NEFT/SAMPLE RETAIL", dec: { name: "SAMPLE RETAIL" } })])));
  eq(one(r, "bank_no_bill")[0].state, "resolved", "M1: the same invoice still open: resolved");
  // M1: a bill already posted to Tally is not a candidate for an advance (it is in the books)
  const ADV = pay("20260812", "ABC Traders", 250000);
  r = run(inp([ADV], { bills: [fbill(1, "ABC Traders", "07AAAAA0000A1Z5", "AT/77", "2026-10-02", 250000, { status: "posted" })] }));
  eq(one(r, "advance_open")[0].state, "ask", "M1: a posted bill is not a candidate (it would be in the books)");
  // GSTIN mismatch blocks a name match
  r = run(inp([ADV], { bills: [fbill(1, "ABC Traders", "29ZZZZZ9999Z1Z5", "AT/77", "2026-10-02", 250000)] }));
  eq(one(r, "advance_open")[0].state, "ask", "GSTIN differs from the party's: no match, even with the same name");
  // 2B candidates for an advance: within 365 days
  r = run(inp([pay("20250901", "ABC Traders", 250000)], { today: "20261122", twob: [{ gstin: "07AAAAA0000A1Z5", party: "ABC", no: "AT-9", date: "20261002", taxable: 250000, igst: 0, cgst: 0, sgst: 0, cess: 0 }] }));
  eq(one(r, "advance_open")[0].state === "resolved", false, "an advance's 2B bill more than 365 days after it: not resolved");
  // M2: expense jump: no empty name matches an empty name
  const rep = (d, a, party) => V(d, "Journal", [["Repairs", -a], ["Sample Hardware", a]], { party, narr: "x" });
  r = run(inp([rep("20260710", 22000, "x"), rep("20260810", 21000, "x"), rep("20260910", 22700, "x"), rep("20261012", 184000, "")], { bills: [fbill(4, "", "", "R1", "2026-10-10", 184000)] }));
  eq(one(r, "expense_jump")[0].state, "ask", "M2: a bill with no name never matches an entry with no party");
  // M5: a bill an earlier finding owns is no tie for tonight's other finding (a bank line that fits the same bill)
  const A1 = pay("20260812", "ABC Traders", 250000), Bl = fbill(1, "ABC Traders", "07AAAAA0000A1Z5", "AT/77", "2026-10-02", 250000);
  const line = { bank: { accounts: [{ id: "a1", ledger: "HDFC Bank" }], rows: [{ id: "r9", acct: "a1", sid: "s1", date: "2026-11-10", narr: "NEFT/ABC TRADERS", debit: 250000, credit: 0, ledger: "", state: "attention", dec: { name: "ABC TRADERS" } }] } };
  const k = one(run(inp([A1], { bills: [Bl] })), "advance_open")[0].key;
  r = run(inp([A1], Object.assign({ bills: [Bl], prior: [{ kind: "advance_open", key: k, state: "resolved", evidence: [{ ref: "bill:e1" }] }] }, line)));
  eq([one(r, "advance_open")[0].state, one(r, "bank_no_bill")[0].state], ["resolved", "ask"], "M5: the earlier finding keeps its bill; the bank line is asked, no churn");
}

// staging's first night (22-Nov-2026): only relevant advances
{
  // a journal that takes a supplier past its bills (a TDS deduction, a write-off) is no advance
  let r = run(inp([V("20260501", "Journal", [["ABC Traders", -8346], ["Purchase", 8346]], { party: "ABC Traders" })]));
  eq(one(r, "advance_open").length + one(r, "wrong_side").length, 0, "a journal debit past the bills: no advance, nothing asked");
  // ... and what it left over is used by the next bill before any payment advance
  r = run(inp([V("20260501", "Journal", [["ABC Traders", -5000], ["Purchase", 5000]], { party: "ABC Traders" }), bill("20260601", "ABC Traders", 5000), pay("20260610", "ABC Traders", 5000)]));
  eq(one(r, "advance_open").map((f) => f.facts.amt), [5000], "a payment after a bill the journal already took up: an advance of the payment only");
  // one finding a party, with the payments' count and the oldest date
  r = run(inp([pay("20260406", "ABC Traders", 1000), pay("20260506", "ABC Traders", 2000), pay("20261101", "ABC Traders", 9000)]));
  const f = one(r, "advance_open")[0];
  eq([one(r, "advance_open").length, f.facts.amt, f.facts.n, f.facts.date], [1, 3000, 2, "20260406"], "one finding a party: the payments older than 60 days, the oldest date");
  eq(f.ask, "₹3,000 paid to ABC Traders since 06-Apr (2 payments) has no bill in the books. Has the bill come?", "the question for several payments");
  // a payment gateway: receipts far beyond its sales: for the firm
  const rec = (d, a) => V(d, "Receipt", [["HDFC Bank", -a], ["Sample Retail", a]], { party: "Sample Retail" });
  r = run(inp([sale("20260601", "Sample Retail", 1000)].concat(Array.from({ length: 12 }, (_, i) => rec("2026070" + (i % 9 + 1), 5000)))));
  eq([one(r, "advance_open")[0].state, one(r, "advance_open")[0].title], ["you", "₹59,000 received through Sample Retail · not matched to sales"], "receipts far beyond sales (a gateway): needs you, not a question");
  // the GST set-off journal (tax ledgers only) is the firm's own: no narration is not asked
  r = run(inp([V("20261020", "Journal", [["Output CGST", -150000], ["Input CGST", 149994.6], ["Rent", 5.4]], { narr: "" })]));
  eq(one(r, "no_narration").length, 0, "a journal of tax ledgers only (a rounding line under ₹10) with no narration: not asked");
  r = run(inp([V("20261020", "Journal", [["Output CGST", -150000], ["Rent", 150000]], { narr: "" })]));
  eq(one(r, "no_narration").length, 1, "a journal of a tax ledger and an expense with no narration: asked");
}

// N7: a bill marked duplicate is no candidate
{
  const r = run(inp([pay("20261103", "Sample Hardware", 15000, "Cash")], { bills: [fbill(3, "Sample Hardware", "", "SH/9", "2026-11-02", 15000, { status: "duplicate" })] }));
  eq(one(r, "cash_big")[0].state, "ask", "N7: a bill marked duplicate is not a candidate");
}

// ---------------------------------------------------------------- opening balances (staging: tally_ledgers.open, a debit negative)
{
  // last year's bill of ₹2,50,000 owed to ABC Traders, paid on 12-Aug: no advance
  let r = run(inp([pay("20260812", "ABC Traders", 250000)], { open: { "ABC Traders": 250000 }, booksFrom: "20260401" }));
  eq(one(r, "advance_open").length + one(r, "wrong_side").length, 0, "opening: a payment of last year's bill is no advance");
  // the opening bill takes the payment first: a receipt's invoice of this year stays open for the bank check
  const inv = sale("20261028", "Sample Retail", 26500), rec = V("20260410", "Receipt", [["HDFC Bank", -40000], ["Sample Retail", 40000]], { party: "Sample Retail" });
  r = run(inp([inv, rec], { open: { "Sample Retail": -40000 }, booksFrom: "20260401", bank: { accounts: [{ id: "a1", ledger: "HDFC Bank" }], rows: [{ id: "r1", acct: "a1", sid: "s1", date: "2026-11-10", narr: "NEFT/SAMPLE RETAIL", debit: 0, credit: 26500, ledger: "", state: "attention", dec: { name: "SAMPLE RETAIL" } }] } }));
  eq(one(r, "bank_no_bill")[0].state, "resolved", "opening: a receipt of last year's balance does not settle this year's invoice");
  eq(one(r, "advance_open").length, 0, "opening: no advance from a customer who paid last year's balance");
  // suspense carried in
  r = run(inp([], { open: { "Suspense": -5000 }, booksFrom: "20260401" }));
  eq(one(r, "suspense").length, 1, "opening: suspense carried in is found");
}

// ---------------------------------------------------------------- small pieces
eq([inr(250000), inr(48000), inr(40001.5), inr(1234567.89)], ["₹2,50,000", "₹48,000", "₹40,001.50", "₹12,34,567.89"], "rupees in the Indian way");
eq(ledgerKey("A & B Traders (P) Ltd."), "aandbtraderspltd", "ledgerKey as the browser's");
ok(ruleHits({ when: { text: [{ op: "not", v: "x" }] }, then: {} }, { narr: "abc", debit: 1 }) === false, "a rule with no positive condition never fires");
ok(askText({ kind: "nope", facts: {} }) === "", "an unknown kind has no words");

console.log(fails ? fails + " of " + n + " failed" : "all " + n + " passed");
process.exit(fails ? 1 : 0);
