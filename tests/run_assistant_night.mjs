// node tests/run_assistant_night.mjs - assistant-night's input from FinCom's cloud (server/assistant-night/nightinput.js) on
// made-up rows shaped exactly as staging keeps them (the real field names, made-up values): tally_vouchers / tally_lines
// (custom voucher types), tally_ledgers.open (a debit negative), clients.data (bankAccounts, closed), records bank_stmt
// {acctId, acct, bank, from, to}, bank_rows {rows}, bank_meta {rules (learnt), hist.rows}, inbox, entry (docKind).
import { booksOf, twobOnly, nightInput, bankOf } from "../server/assistant-night/nightinput.js";
import { run } from "../server/_shared/nightchecks.js";

let fails = 0, n = 0;
const ok = (c, w) => { n++; console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const head = (guid, day, vtype, party, narration = "x", more = {}) => Object.assign({ guid, day, alter_id: 1, vtype, vno: guid, party, narration, cancelled: false, optional: false, deleted_at: null, gstin: "", pos: "", ref: "", ref_date: null, cmp_gstin: "" }, more);
const L = (guid, ledger, amount) => ({ guid, ledger, amount });
const PARENT = { "ABC Traders": "Sundry Creditors", "Sample Hardware": "Sundry Creditors", "Old Supplier": "Sundry Creditors", "Sample Retail": "Sundry Debtors", "HDFC Bank": "Bank Accounts", "Cash": "Cash-in-Hand",
  "Suspense": "Suspense A/c", "Purchase": "Purchase Accounts", "Sales UP": "Sales Accounts", "Input CGST": "Duties & Taxes", "Input SGST": "Duties & Taxes", "Salary": "Indirect Expenses" };
const OPEN = { "Old Supplier": 80000, "Suspense": 0 };
// clients.data, as staging keeps a client's settings (made-up values)
const co = { id: "c1", deleted: false, name: "Sample Traders", closed: { to: "2026-03-31", gst: true, tds: true }, bankAccounts: [{ id: "acc-1", ledger: "HDFC Bank", last4: "2231", bank: "HDFC Bank", acct: "XXXXXX2231", ifsc: "HDFC0000001" }] };
const rows = {
  client: "c1", co, book: { book_id: "b1", from_date: "2026-04-01", ledgers_at: "2026-11-21T00:00:00Z" },
  heads: [head("g1", "2026-08-12", "Payment", "ABC Traders"), head("g2", "2026-11-03", "Payment", "Sample Hardware"), head("g3", "2026-09-30", "Journal", "", ""),
    head("g4", "2026-07-15", "SALE (UP)", "Sample Retail"), head("g5", "2026-08-15", "SALE (UP)", "Sample Retail"), head("g6", "2026-09-15", "SALE (UP)", "Sample Retail"),
    head("g7", "2026-06-10", "Payment", "Old Supplier")],
  lines: [L("g1", "ABC Traders", -250000), L("g1", "HDFC Bank", 250000), L("g2", "Sample Hardware", -15000), L("g2", "Cash", 15000), L("g3", "Suspense", -12300), L("g3", "HDFC Bank", 12300),
    L("g4", "Sample Retail", -1000), L("g4", "Sales UP", 1000), L("g5", "Sample Retail", -1000), L("g5", "Sales UP", 1000), L("g6", "Sample Retail", -1000), L("g6", "Sales UP", 1000),
    L("g7", "Old Supplier", -80000), L("g7", "HDFC Bank", 80000)],
  bills: [],
  ledgers: Object.keys(PARENT).map((name) => ({ name, parent: PARENT[name], open: OPEN[name] || 0, pan: null, gstin: null })),
  groups: [{ name: "Sundry Creditors", parent: "Current Liabilities" }, { name: "Sundry Debtors", parent: "Current Assets" }, { name: "Bank Accounts", parent: "Current Assets" }, { name: "Cash-in-Hand", parent: "Current Assets" }, { name: "Sales Accounts", parent: "" }],
  items: [], sales: [], runs: {},
};
const b = booksOf(rows);
ok(b.vouchers.length === 7 && b.vouchers[0].ent.length === 2, "the cloud copy's entries made into the app's books by gst-run's engine (" + b.vouchers.length + ")");
ok(!(globalThis.S && globalThis.S.coId === "c1"), "the app's globals are put back after");
const tw = twobOnly(b, rows);
ok(Array.isArray(tw) && tw.length === 0, "2B: no 2B in the cloud: nothing (and no error)");
// records as staging keeps them
const stmt = (sid, from, to) => ({ kind: "bank_stmt", id: "c1:" + sid, data: { id: sid, acctId: "acc-1", acct: "XXXXXX2231", bank: "HDFC Bank", from, to, n: 2, fileName: "statement.pdf" } });
const bankRecs = [
  stmt("s1", "2026-08-01", "2026-08-31"), stmt("s2", "2026-10-01", "2026-11-30"),
  { kind: "bank_rows", id: "c1:s1:0", data: { rows: [{ id: 1, date: "2026-08-10", narr: "NEFT/BSES/1", debit: 9800, credit: 0, ledger: "Electricity", state: "sent", userSet: true, dec: { name: "BSES", key: "neft:bses", mode: "NEFT" } }] } },
  { kind: "bank_rows", id: "c1:s2:0", data: { rows: [{ id: 1, date: "05/11/2026", narr: "UPI/RAMESH/9999", debit: "48,000.00", credit: "", ledger: "", state: "attention", dec: { name: "RAMESH", key: "upi:ramesh@okbank", mode: "UPI" } },
    { id: 2, date: "2026-11-06", narr: "UPI/SHYAM/1", debit: 3000, credit: 0, ledger: "Repairs", state: "suggested", dec: { name: "SHYAM", key: "upi:shyam@okbank", mode: "UPI" } },
    { id: 3, date: "2026-10-03", narr: "UPI/X/2", debit: 700, credit: 0, ledger: "Misc", state: "ignored", userSet: true, dec: { name: "X", key: "upi:x@okbank" } }] } },
  { kind: "bank_meta", id: "c1:meta", data: { rules: [{ key: "upi:shyam@okbank", dir: "out", ledger: "Staff Welfare", auto: true, label: "SHYAM", at: "2026-10-01T00:00:00Z" }], keys: {},
    hist: { rows: { fp1: { k: "neft:bses", p: "bses", t: "bses", l: "Electricity", d: "out", dt: "2026-08-10", s: "you", n: "BSES" } } } } },
  { kind: "bank_rows", id: "c1:s9:0", deleted: true, data: { rows: [{ id: 3 }] } },
];
const bk = bankOf(bankRecs, co);
ok(bk.bank.accounts.length === 1 && bk.bank.accounts[0].id === "acc-1" && bk.bank.accounts[0].ledger === "HDFC Bank" && bk.bank.accounts[0].last4 === "2231", "bank: two statements of one account (acctId) are one account; its ledger and last 4 from the client's bankAccounts");
ok(bk.bank.rows.length === 4 && bk.bank.rows[1].date === "20261105" && bk.bank.rows[1].debit === 48000 && bk.bank.rows[1].sid === "s2", "bank: rows read with their statement, dates and amounts as numbers");
ok(bk.learned.length === 1 && bk.history.length === 1 && bk.history[0].l === "Electricity", "bank: learnt rules and the bank's own history (hist.rows)");
ok(bankOf(bankRecs.map((r) => r.kind === "bank_meta" ? Object.assign({}, r, { data: { rules: [] } }) : r), co).history.every((h) => h.l !== "Misc"), "bank: without hist, the lines a person set make the history, never an ignored one");
ok(bankOf(bankRecs, {}).bank.accounts[0].name === "HDFC Bank" && bankOf(bankRecs, {}).bank.accounts[0].ledger === "", "bank: no bankAccounts: the statement's bank name, no ledger (an entry would be held)");
const entryRecs = [{ id: "e1", data: { id: "e1", status: "draft", docKind: "", partyLedger: "Sample Hardware", expenseLedger: "Purchase", x: { vendorName: "Sample Hardware", vendorGstin: "", invoiceNo: "SH/9", invoiceDate: "2026-11-02", total: 15000 } } },
  { id: "e3", data: { id: "e3", status: "draft", docKind: "proforma", x: { vendorName: "ABC Traders", vendorGstin: "", invoiceNo: "PI/1", invoiceDate: "2026-10-02", total: 250000 } } }, { id: "e2", deleted: true, data: { id: "e2", x: {} } }];
const inboxRecs = [{ id: "i1", data: { status: "waiting" } }, { id: "i2", data: { status: "done" } }];
const inp = nightInput(rows, b, { today: "20261122", bankRecs, inboxRecs, entryRecs, twob: tw, prior: [] });
ok(inp.bills.length === 1 && inp.bills[0].id === "e1", "input: FinCom's bills; a proforma (docKind) and a deleted one left out");
ok(inp.inboxUnread === 1 && inp.closed[0].to === "20260331", "input: unread Inbox files; the closed period from clients.data.closed");
ok(inp.open["Old Supplier"] === 80000 && inp.booksFrom === "20260401", "input: opening balances (tally_ledgers.open) and the books' start");
ok(inp.books.isSale(b.vouchers.find((v) => v.type === "SALE (UP)")) && !inp.books.isSale(b.vouchers[0]), "input: “SALE (UP)” is a sale by the app's own test");
ok(inp.books.pathOf("ABC Traders").join(">") === "Sundry Creditors>Current Liabilities", "input: a ledger's groups by the app's own ledGroupPath");
const r = run(inp), by = (k) => r.findings.filter((f) => f.kind === k);
ok(by("advance_open").length === 1 && by("advance_open")[0].facts.party === "ABC Traders" && by("advance_open")[0].state === "ask", "end to end: the 12-Aug advance is a question (the proforma is no bill)");
ok(!r.findings.some((f) => f.facts.party === "Old Supplier"), "end to end: paying last year's bill (opening balance) is no advance");
ok(by("cash_big").length === 1 && by("cash_big")[0].state === "resolved", "end to end: the cash payment's bill is in FinCom: resolved");
ok(by("suspense").length === 1 && by("suspense")[0].state === "you", "end to end: suspense needs you");
const bn = by("bank_no_bill");
ok(bn.length === 2 && bn.find((f) => f.facts.party === "RAMESH").state === "ask", "end to end: the bank line with nothing behind it is a precise question");
ok(bn.find((f) => f.facts.party === "SHYAM").state === "resolved" && bn.find((f) => f.facts.party === "SHYAM").evidence[0].ledger === "Staff Welfare", "end to end: a suggested line is checked; the learnt rule answers it (not the guess)");
ok(by("sales_month_missing").map((f) => f.facts.ym).join() === "202610", "end to end: custom sale types count: October has no sales");
ok(by("bank_month_missing").map((f) => f.facts.ym).join() === "202609", "end to end: the account's months over both statements: September missing");
ok(bn.every((f) => /^bank:s\d:\d$/.test(f.key)), "end to end: bank findings keyed on the statement and the line");
ok(r.findings.every((f) => f.facts.ask_text !== undefined && f.facts.short !== undefined), "every finding keeps its words for the page");
ok(JSON.stringify(run(inp)) === JSON.stringify(r), "the same input twice: the same answer");
// H1: the account's ledger set after the first night: the same keys (no new findings or questions), undo stays
{
  const co0 = Object.assign({}, co, { bankAccounts: [Object.assign({}, co.bankAccounts[0], { ledger: "" })] });
  const i0 = nightInput(Object.assign({}, rows, { co: co0 }), b, { today: "20261122", bankRecs, inboxRecs, entryRecs, twob: tw, prior: [] });
  const keys = (x) => run(x).findings.map((f) => f.kind + "|" + f.key).sort().join(",");
  ok(i0.bank.accounts[0].ledger === "" && keys(i0) === keys(inp), "H1: setting the account's ledger later changes no finding's key");
  const k = run(i0).findings.find((f) => f.kind === "bank_no_bill" && f.facts.party === "RAMESH").key;
  const undone = run(Object.assign({}, inp, { prior: [{ kind: "bank_no_bill", key: k, state: "ask", undone: true }] })).findings.find((f) => f.key === k);
  ok(undone && undone.state === "ask", "H1: an undone bank finding stays undone after the ledger is set");
}
console.log(fails ? fails + " of " + n + " failed" : "all " + n + " passed");
process.exit(fails ? 1 : 0);
