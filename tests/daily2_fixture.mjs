// Made-up data for Daily Check phase 2's screenshots and page test: phase 1's rows (tests/daily_fixture.mjs dbRows) plus
// the entries phase 2's builders make on made-up books (server/_shared/dailyjournals.js, the night's own path), so what
// the page shows is exactly what the builders give: a GST set-off, a payroll journal, a salary payment and a monthly rent.
// Also the trust levels, a promotion suggestion and the reminder switch on. Every name, number and address is invented.
import { dbRows } from "./daily_fixture.mjs";
import { booksOf, gstOf, nightInput } from "../server/assistant-night/nightinput.js";
import { run } from "../server/_shared/nightchecks.js";
import { journals } from "../server/_shared/dailyjournals.js";
import { gstRows, head, L } from "./daily2_books.mjs";

const CASH = "GST ELECTRONIC CASH LEDGER";
const uuid = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const PL = { "Salary": "Indirect Expenses", "TDS on Salary 192": "Duties & Taxes", "Professional Tax Payable": "Duties & Taxes", "Salary Payable": "Provisions" };
const SHEET = [
  { name: "Ravi Kumar", date: "2026-10-31", gross: 52000, tds: 2600, profTax: 200 }, { name: "Asha Verma", date: "2026-10-31", gross: 34000, tds: 0, profTax: 200 },
  { name: "Imran Shaikh", date: "2026-10-31", gross: 41000, tds: 1200, profTax: 200 }, { name: "Neha Joshi", date: "2026-10-31", gross: 28500, tds: 0, profTax: 200 },
  { name: "Karan Mehta", date: "2026-10-31", gross: 19354.84, tds: 0, profTax: 0 },
];
function nightOf(rows, today, more = {}) {
  const b = booksOf(rows), gst = gstOf(rows, b, today);
  return nightInput(rows, b, Object.assign({ today, bankRecs: [], inboxRecs: [], entryRecs: [], twob: [], gst, prior: [], draftRecs: [] }, more));
}
export function phase2() {
  const out = { entries: [], findings: [] };
  // Sample Traders (d1): October's 3B filed on 20-Nov; the payroll; Ravi Kumar's pay on 1-Nov
  const rows = gstRows({ ym: "202610", intra: 640000, inter: 210000, buyIntra: 380000, buyInter: 150000, rcm: 25000, rec: { cashLedger: CASH, r3bArn: "AA0711260045123" },
    extraLedgers: PL, items: [{ key: "salary", item: "", ord: 0, data: SHEET, deleted: false }] });
  const booked = [["Salary", -174854.84], ["TDS on Salary 192", 3800], ["Professional Tax Payable", 800], ["Salary Payable", 170254.84]];
  const inp = nightOf(rows, "20261122"), j = journals(inp);
  j.entries.forEach((e) => out.entries.push(["d1", e]));
  // the salary payment: the payroll booked (as it is once approved), the bank line paying one employee
  const rb = JSON.parse(JSON.stringify(rows)); delete rb.made; rb.heads.push(head("pay1", "2026-10-31", "Journal", "")); booked.forEach(([l, a]) => rb.lines.push(L("pay1", l, a)));
  rb.co.bankAccounts = [{ id: "acc-1", ledger: "HDFC Bank", last4: "2231" }];
  const bank = [{ kind: "bank_stmt", id: "c1:s1", data: { id: "s1", acctId: "acc-1", acct: "XX2231", bank: "HDFC Bank", from: "2026-11-01", to: "2026-11-30" } },
    { kind: "bank_rows", id: "c1:s1:0", data: { rows: [{ id: 7, date: "2026-11-01", narr: "NEFT/RAVI KUMAR/SAL OCT", debit: 49200, credit: 0, ledger: "", state: "attention", dec: { name: "Ravi Kumar", key: "neft:ravikumar", mode: "NEFT" } }] } }];
  const rr0 = run(nightOf(rb, "20261122", { bankRecs: bank }));
  rr0.entries.filter((e) => e.source === "bank_self_answer").forEach((e) => out.entries.push(["d1", e]));
  // Example Foods (d3): rent on the 1st, Aug to Oct; November's missing
  const rr = gstRows({ ym: "202610", filed: "" });
  ["2026-08-01", "2026-09-01", "2026-10-01"].forEach((d, i) => { const g = "r" + i; rr.heads.push(head(g, d, "Journal", "Sample Landlord", { narration: "Rent for the month" })); rr.lines.push(L(g, "Rent", -45000), L(g, "Sample Landlord", 45000)); });
  journals(nightOf(rr, "20261122")).entries.forEach((e) => out.entries.push(["d3", e]));
  // Demo Textiles (d2): October's payroll needs a ledger picked (two TDS ledgers)
  const rp = gstRows({ ym: "202610", filed: "", extraLedgers: Object.assign({}, PL, { "TDS Payable 192 Staff": "Duties & Taxes" }), items: [{ key: "salary", item: "", ord: 0, data: SHEET.slice(0, 3), deleted: false }] });
  journals(nightOf(rp, "20261122")).findings.forEach((f) => out.findings.push(["d2", f]));
  return out;
}
export function dbRows2() {
  const R = dbRows(), p = phase2();
  let n = 0;
  p.findings.forEach(([cid, f]) => R.night_findings.push({ id: uuid(700 + (++n)), client_id: cid, kind: f.kind, key: f.key, state: f.state, facts: f.facts, evidence: f.evidence, candidates: f.candidates, last_seen: "2026-11-22", undone_at: null }));
  // the entries first on the tab (the order the night made them)
  const mine = p.entries.map(([cid, e], i) => ({ id: uuid(800 + i), client_id: cid, finding_id: null, source: e.source, dedupe: e.dedupe, work_ref: e.work_ref, voucher: e.voucher, reason: e.reason, why: e.why, evidence: e.evidence, checks: e.checks, state: "ready" }));
  R.night_entries = mine.concat(R.night_entries);
  R.daily_trust = [{ client_id: "d1", kind: "bank", level: 0, limit_amt: 0, dismissed_at: null }, { client_id: "d1", kind: "recurring", level: 1, limit_amt: 0, dismissed_at: null }, { client_id: "d1", kind: "*", level: 0, limit_amt: 100000, dismissed_at: null }];
  R.rpc_trust_stats = [{ client_id: "d1", kind: "bank", approved: 23, last_at: "2026-11-21T11:02:00+05:30", level: 0, limit_amt: 0, dismissed_at: null },
    { client_id: "d3", kind: "recurring", approved: 6, last_at: "2026-11-01T10:00:00+05:30", level: 0, limit_amt: 0, dismissed_at: null }];
  R.assistant_prefs = [{ client_id: "d1", auto_reminders: true }];
  return R;
}
