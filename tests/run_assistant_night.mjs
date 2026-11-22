// node tests/run_assistant_night.mjs - assistant-night's input from FinCom's cloud (server/assistant-night/nightinput.js) on
// made-up cloud rows: the cloud copy's entries and masters made into the app's books by gst-run's own engine, the bank
// statements' records, the Inbox, FinCom's bills, and the night checks run end to end on them. Made-up data only.
import { booksOf, twobOnly, nightInput, bankOf } from "../server/assistant-night/nightinput.js";
import { run } from "../server/_shared/nightchecks.js";

let fails = 0, n = 0;
const ok = (c, w) => { n++; console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const head = (guid, day, vtype, party, narration = "x", more = {}) => Object.assign({ guid, day, alter_id: 1, vtype, vno: guid, party, narration, cancelled: false, optional: false, deleted_at: null, gstin: "", pos: "", ref: "", ref_date: null, cmp_gstin: "" }, more);
const L = (guid, ledger, amount) => ({ guid, ledger, amount });
const rows = {
  client: "c1", co: { id: "c1", name: "Sample Traders", closed: { to: "2026-03-31" } }, book: { book_id: "b1", ledgers_at: "2026-11-21T00:00:00Z" },
  heads: [head("g1", "2026-08-12", "Payment", "ABC Traders"), head("g2", "2026-11-03", "Payment", "Sample Hardware"), head("g3", "2026-09-30", "Journal", "", "")],
  lines: [L("g1", "ABC Traders", -250000), L("g1", "HDFC Bank", 250000), L("g2", "Sample Hardware", -15000), L("g2", "Cash", 15000), L("g3", "Suspense", -12300), L("g3", "HDFC Bank", 12300)],
  bills: [],
  ledgers: ["ABC Traders", "Sample Hardware", "HDFC Bank", "Cash", "Suspense", "Purchase", "Input CGST", "Input SGST"].map((name) => ({ name, parent: { "ABC Traders": "Sundry Creditors", "Sample Hardware": "Sundry Creditors", "HDFC Bank": "Bank Accounts", "Cash": "Cash-in-Hand", "Suspense": "Suspense A/c", "Purchase": "Purchase Accounts", "Input CGST": "Duties & Taxes", "Input SGST": "Duties & Taxes" }[name] })),
  groups: [{ name: "Sundry Creditors", parent: "Current Liabilities" }, { name: "Bank Accounts", parent: "Current Assets" }, { name: "Cash-in-Hand", parent: "Current Assets" }],
  items: [], sales: [], runs: {},
};
const b = booksOf(rows);
ok(b.vouchers.length === 3 && b.vouchers[0].ent.length === 2, "the cloud copy's entries made into the app's books by gst-run's engine (" + b.vouchers.length + ")");
ok(globalThis.S === undefined || globalThis.S === null || typeof globalThis.S !== "object" || globalThis.S.coId !== "c1", "the app's globals are put back after");
const tw = twobOnly(b, rows);
ok(Array.isArray(tw) && tw.length === 0, "2B: no 2B in the cloud: nothing (and no error)");
const bankRecs = [
  { kind: "bank_stmt", id: "c1:s1", data: { id: "s1", ledger: "HDFC Bank", meta: { acct: "XXXX2231", bank: "HDFC Bank" } } },
  { kind: "bank_rows", id: "c1:s1:0", data: { rows: [{ id: 1, date: "05/11/2026", narr: "UPI/RAMESH/9999", debit: "48,000.00", credit: "", ledger: "", state: "attention", dec: { name: "RAMESH", mode: "UPI" } },
    { id: 2, date: "2026-10-03", narr: "NEFT/BSES/1", debit: 9800, credit: 0, ledger: "Electricity", state: "posted", userSet: true, dec: { name: "BSES" } }] } },
  { kind: "bank_meta", id: "c1:meta", data: { rules: [{ id: "w1", when: { text: [{ op: "has", v: "bses" }], dir: "out", amtMin: "", amtMax: "" }, then: { ledger: "Electricity" } }] } },
  { kind: "bank_rows", id: "c1:s9:0", deleted: true, data: { rows: [{ id: 3 }] } },
];
const bk = bankOf(bankRecs);
ok(bk.bank.accounts.length === 1 && bk.bank.accounts[0].ledger === "HDFC Bank" && bk.bank.accounts[0].last4 === "2231", "bank: a statement is an account with its Tally ledger and last 4 digits");
ok(bk.bank.rows.length === 2 && bk.bank.rows[0].date === "20261105" && bk.bank.rows[0].debit === 48000, "bank: rows read, dates and amounts as numbers");
ok(bk.rules.length === 1 && bk.history.length === 1 && bk.history[0].ledger === "Electricity", "bank: written rules, and lines a person set (history)");
const entryRecs = [{ id: "e1", data: { id: "e1", status: "draft", partyLedger: "Sample Hardware", expenseLedger: "Purchase", x: { vendorName: "Sample Hardware", vendorGstin: "", invoiceNo: "SH/9", invoiceDate: "2026-11-02", total: 15000 } } }, { id: "e2", deleted: true, data: { id: "e2", x: {} } }];
const inboxRecs = [{ id: "i1", data: { status: "waiting" } }, { id: "i2", data: { status: "done" } }];
const inp = nightInput(rows, b, { today: "20261122", bankRecs, inboxRecs, entryRecs, twob: tw, prior: [] });
ok(inp.bills.length === 1 && inp.inboxUnread === 1 && inp.closed[0].to === "20260331", "input: FinCom's bills (deleted left out), unread Inbox files, the closed period");
ok(inp.books.pathOf("ABC Traders").join(">") === "Sundry Creditors>Current Liabilities", "input: a ledger's groups by the app's own ledGroupPath");
const r = run(inp), by = (k) => r.findings.filter((f) => f.kind === k);
ok(by("advance_open").length === 1 && by("advance_open")[0].state === "ask", "end to end: the 12-Aug advance is a question");
ok(by("cash_big").length === 1 && by("cash_big")[0].state === "resolved", "end to end: the cash payment's bill is in FinCom: resolved");
ok(by("suspense").length === 1 && by("suspense")[0].state === "you", "end to end: suspense needs you");
ok(by("bank_no_bill").length === 1 && by("bank_no_bill")[0].facts.party === "RAMESH" && by("bank_no_bill")[0].state === "ask", "end to end: the bank line with nothing behind it is a precise question");
ok(r.findings.every((f) => f.facts.ask_text !== undefined && f.facts.short !== undefined), "every finding keeps its words for the page");
ok(JSON.stringify(run(inp)) === JSON.stringify(r), "the same input twice: the same answer");
console.log(fails ? fails + " of " + n + " failed" : "all " + n + " passed");
process.exit(fails ? 1 : 0);
