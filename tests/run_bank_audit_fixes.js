// node tests/run_bank_audit_fixes.js — the bank audit of 22-Nov-2026 (next-fix-audit-bank), each finding with made-up
// lines, parties and invoices only (no client data): the app's own functions, read by name from the built one-file site
// (site-test/index.html, as tests/harness.js reads it), run in a Node context with the rest of the app stubbed.
//   1. an overdraft / cash-credit statement whose balances lack their "Dr", and a line whose direction the file states
//   2. one bill or sales invoice matched to one line only (this statement and the others)
//   3. a written rule, and a person's ledger, leave the old bill, invoice, TDS at payment and split
//   4. a receipt: never against a credit note; its allocations add up to the amount received; only the customer posted to
//   5. a voucher whose debits and credits differ is never made; the Tally file skips a line that fails the running balance
//   6. reading: IFSC from a narration, the period printed, a trailing minus, a statement of FY 2016-17, over 60 pages
//   7. the same account by its full number; an upload while one is read; a client opened while one is read; lines charged
//   8. one save per statement: a save on another statement never drops this one's
//   9. a gap between two statements only when both print their periods
const fs = require("fs"), vm = require("vm"), path = require("path");
const HTML = process.env.TDSDESK_HTML || path.join(__dirname, "..", "site-test", "index.html");
const s = fs.readFileSync(HTML, "utf8");
const i0 = s.indexOf('<script id="app-main">') + '<script id="app-main">'.length, JS = s.slice(i0, s.indexOf("</script>", i0));
const decl = []; { const re = /\n(?:async function|function|const|let|var|class) ([A-Za-z_$][\w$]*)/g; let m; while ((m = re.exec(JS))) decl.push({name: m[1], at: m.index}); }
const SHARED = ["NORM_CACHE", "normName", "normNameRaw", "gramsOf", "nameSim", "num", "r2", "MONTHS3", "toDateObj", "fmtDate", "INR"];
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
// a context with these names of the app (a name the build does not have is left out: the test fails on it, not the load)
function load(names, stubs){
  const all = SHARED.concat(names).filter((n, i, a) => a.indexOf(n) === i), missing = [];
  const parts = all.map(n => { const k = decl.findIndex(d => d.name === n); if (k < 0){ missing.push(n); return ""; } return JS.slice(decl[k].at, k + 1 < decl.length ? decl[k + 1].at : JS.length); });
  const ctx = Object.assign({console, Intl, Math, JSON, Date, Set, Map, WeakMap, Array, Object, String, Number, RegExp, Promise, Error, isFinite, parseFloat, setTimeout, clearTimeout,
    window: {addEventListener(){}}, globalThis: null, toast(){}, render(){}}, stubs || {});
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(parts.join("\n") + "\n;globalThis.__x = {" + all.filter(n => !missing.includes(n)).join(",") + "};", ctx);
  if (missing.length) console.log("  (not in this build: " + missing.join(", ") + ")");
  // stubs again over the app's own (a stub given for a name loaded wins)
  Object.assign(ctx, stubs || {});
  return {ctx, x: ctx.__x, has: n => !missing.includes(n)};
}
const tryIt = (f) => { try { return f(); } catch (e){ return e; } };
// a voucher's debits and credits (Tally's sign: a debit is written minus)
const sides = xml => { let dr = 0, cr = 0; (xml.match(/<ALLLEDGERENTRIES\.LIST>[\s\S]*?<\/ALLLEDGERENTRIES\.LIST>/g) || []).forEach(l => { const a = +((l.match(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>\n(?:<BILL|<BANK|<\/ALL)/) || [])[1]); if (a < 0) dr -= a; else cr += a; }); return {dr: Math.round(dr * 100) / 100, cr: Math.round(cr * 100) / 100}; };

console.log("1. running balance: an overdraft statement, and a direction the file states");
{
  const {x} = load(["MONTHS", "toIsoDate", "cellText", "bankAmount", "bankDate", "rowsFromCells", "checkBalances"]);
  // a cash-credit account, the balance's own Dr/Cr column left out (Kotak-style): Amount, Dr/Cr, Balance
  const grid = [["02/05/2026", "CHQ 000101 SUPPLIES", "10,000.00", "DR", "5,10,000.00"], ["04/05/2026", "CASH DEPOSIT BRANCH", "2,000.00", "CR", "5,08,000.00"],
    ["06/05/2026", "RTGS MEHTA STEEL TRADERS", "50,000.00", "DR", "5,58,000.00"]];
  const rows = x.rowsFromCells(grid, {date: 0, narr: 1, amount: 2, drcr: 3, balance: 4}, (r, c) => r[c], r => r.join(" "));
  ok(rows.length === 3 && rows.every(r => r.dirSure), "a Dr/Cr column states each line's direction (rowsFromCells: dirSure)");
  const meta = {}, chk = x.checkBalances(rows, meta);
  ok(rows[1].credit === 2000 && rows[1].debit === 0 && rows[2].debit === 50000 && rows[2].credit === 0, "the cash deposit stays a deposit and the RTGS payment a payment (was: both turned round)");
  ok(chk.bad === 0 && chk.fixed === 0 && rows[0].balance === -510000 && rows[2].balance === -558000, "the balances are read as debit balances (minus), every line fits, none turned (" + JSON.stringify(chk) + ")");
  // a line in its own Withdrawal column that does not fit: flagged, never turned round
  const r2 = x.rowsFromCells([["01/05/2026", "NEFT ACME", "", "200.00", "1,200.00"], ["02/05/2026", "NEFT ACME", "500.00", "", "1,700.00"], ["03/05/2026", "UPI TEA", "50.00", "", "1,650.00"]],
    {date: 0, narr: 1, debit: 2, credit: 3, balance: 4}, (r, c) => r[c], r => r.join(" "));
  const c2 = x.checkBalances(r2, {opening: 1000});
  ok(r2[1].debit === 500 && r2[1].balOk === false && c2.bad === 1 && c2.fixed === 0 && r2[2].balance === 1650, "a withdrawal that does not fit its balance is flagged, not made a deposit (" + JSON.stringify(c2) + ")");
  // a line whose direction was worked out (no column said it) is still turned round to fit, as before
  const r3 = [{date: "2026-05-02", narr: "X", debit: 500, credit: 0, balance: 1500}], c3 = x.checkBalances(r3, {opening: 1000});
  ok(r3[0].credit === 500 && r3[0].fixedDir && c3.fixed === 1, "a line read without columns is still turned round when that fits");
  // an overdrawn opening printed without its Dr, with the lines
  const r4 = [{date: "2026-05-02", narr: "X", debit: 1000, credit: 0, balance: 21000, dirSure: true}, {date: "2026-05-03", narr: "Y", debit: 0, credit: 500, balance: 20500, dirSure: true}], m4 = {opening: 20000, closing: 20500}, c4 = x.checkBalances(r4, m4);
  ok(c4.bad === 0 && m4.opening === -20000 && r4[0].balance === -21000 && m4.closing === -20500 && c4.summaryOk === true, "an overdrawn opening and closing printed without Dr are read as minus (" + JSON.stringify(m4) + ")");
  // one line only: an overdraft or a misread line cannot be told apart, so it is flagged for a person
  const r5 = [{date: "2026-05-02", narr: "X", debit: 500, credit: 0, balance: 1500, dirSure: true}], c5 = x.checkBalances(r5, {opening: 1000});
  ok(c5.bad === 1 && r5[0].balance === 1500 && r5[0].debit === 500, "a single line that fits only as an overdraft is flagged, not guessed");
}

// the bank's state for the suggestion and posting tests
function bankWorld(o){
  const leds = [{name: "Sharma Traders", group: "Sundry Creditors"}, {name: "Acme Traders", group: "Sundry Debtors"}, {name: "Beta Ltd", group: "Sundry Debtors"},
    {name: "Freight", group: "Indirect Expenses"}, {name: "Repairs", group: "Indirect Expenses"}, {name: "Office Rent", group: "Indirect Expenses"},
    {name: "Mehta Properties", group: "Sundry Creditors"}, {name: "TDS Payable", group: "Duties & Taxes"}, {name: "HDFC Bank", group: "Bank Accounts"}];
  const map = new Map(leds.map(l => [l.name.toLowerCase(), l])); map.norm = new Map();
  const b = Object.assign({cid: "c1", cur: "st1", stmts: [{id: "st1", acctId: "a1"}], rows: [], rules: [], newLed: [], salesRef: [], sel: new Set(), sticky: new Set(), hist: {rows: {}}, histVer: 0, keys: {}}, o.b || {});
  const co = Object.assign({id: "c1", name: "Test Client", tdsLedgers: {}, bankAccounts: [{id: "a1", ledger: "HDFC Bank"}], bankAuto: true, bankAutoApply: false, billwise: true}, o.co || {});
  return {b, co, stubs: Object.assign({S: {bank: b, firm: {bankRules: []}, companies: {c1: co}}, B: () => b, CO: () => co, curStmt: () => b.stmts.find(z => z.id === b.cur),
    knownLedgers: () => map, exactLedger: n => { const l = map.get(String(n || "").trim().toLowerCase()); return l ? l.name : null; }, hasLedgerList: () => true,
    stdLedger: (c, k) => k === "tds" ? "TDS Payable" : null, bankLedgers: () => ({tds: "TDS Payable"}), patternFor: () => null, historyFor: () => null,
    vtypeFor: r => r.debit ? "Payment" : "Receipt", countRuleUse(){}, isOwnBank: () => false, matchRule: () => null, saveBank(){}, learnRows: () => ({}),
    D: () => ({entries: o.entries || {}}), tallyLedgerName: n => n, fpHash: v => "h" + v, toTallyDate: d => String(d).replace(/-/g, ""), xesc: v => String(v),
    ledNm: v => String(v || "").trim(), BankDB: {set: async () => {}, get: async () => null}, BANK_GROUPS: /bank accounts|bank od|cash-in-hand/i}, o.stubs || {})};
}
const SUGGEST = ["suggestAll", "suggestRow", "matchBill", "openBills", "openSalesInvoices", "matchSalesInvoice", "partyKey", "findRule", "bankAside", "bankClaims", "bankLinks", "bankUnlink", "applyRule", "dropOwnBank"];
const line = (o) => Object.assign({date: "2026-06-10", narr: "", debit: 0, credit: 0, balance: null, state: "attention", ledger: "", userSet: false, splits: [], fp: "fp" + Math.random()}, o);

console.log("2. one bill or invoice to one line");
{
  // an approved bill ST/1 of 1,18,000 whose TDS of 2,000 is deducted at payment
  const entries = {e1: {id: "e1", status: "approved", natureId: "194C", snapshot: {total: 118000, tds: 0, skip: {reason: "pay"}, tdsWould: 2000}, x: {vendorName: "Sharma Traders", invoiceDate: "2026-06-01", invoiceNo: "ST/1"}, partyLedger: "Sharma Traders"}};
  const A = line({id: "st1-0", debit: 116000, narr: "NEFT SHARMA TRADERS", dec: {name: "SHARMA TRADERS", key: "name:sharmatraders", mode: "NEFT"}});
  const Bl = line({id: "st1-1", debit: 116000, narr: "RTGS SHARMA TRADERS", dec: {name: "SHARMA TRADERS", key: "name:sharmatraders", mode: "RTGS"}, date: "2026-06-12"});
  let w = bankWorld({entries, b: {rows: [A]}});
  let {x} = load(SUGGEST, w.stubs);
  x.suggestAll(w.b.rows);
  ok(A.billId === "e1" && A.tdsAtPay === 2000 && A.state === "ready", "the first payment is matched to bill ST/1, TDS at payment 2,000");
  w.b.rows.push(Bl);
  x.suggestAll(w.b.rows, true);
  ok(Bl.billId !== "e1" && !Bl.tdsAtPay, "a second payment of the same amount, suggested again, does not take bill ST/1 again (billId " + Bl.billId + ", TDS " + Bl.tdsAtPay + ")");
  // a line of another statement, not yet posted, holds the bill: kept on that statement's record (st.links)
  const C = line({id: "st2-0", debit: 116000, narr: "NEFT SHARMA TRADERS", dec: {name: "SHARMA TRADERS", key: "name:sharmatraders", mode: "NEFT"}});
  w = bankWorld({entries, b: {cur: "st2", stmts: [{id: "st1", acctId: "a1", links: {b: ["e1"], s: []}}, {id: "st2", acctId: "a1"}], rows: [C]}});
  ({x} = load(SUGGEST, w.stubs));
  x.suggestAll(w.b.rows);
  ok(C.billId !== "e1", "a bill held by a line of another statement is not offered again");
  // the same for a sales invoice
  const sales = [{id: "s1", status: "posted", customerLedger: "Acme Traders", x: {number: "INV-10", total: 11800, date: "2026-06-01", customerName: "Acme Traders"}}];
  const R1 = line({id: "st1-0", credit: 11800, narr: "NEFT ACME TRADERS", dec: {name: "ACME TRADERS", key: "name:acmetraders", mode: "NEFT"}});
  const R2 = line({id: "st1-1", credit: 11800, narr: "IMPS ACME TRADERS", dec: {name: "ACME TRADERS", key: "name:acmetraders", mode: "IMPS"}, date: "2026-06-11"});
  w = bankWorld({b: {rows: [R1], salesRef: sales}});
  ({x} = load(SUGGEST, w.stubs));
  x.suggestAll(w.b.rows);
  ok((R1.salesIds || []).join() === "s1", "the first receipt is matched to INV-10");
  w.b.rows.push(R2); x.suggestAll(w.b.rows, true);
  ok(!(R2.salesIds || []).includes("s1"), "a second receipt of the same amount does not take INV-10 again (" + JSON.stringify(R2.salesIds) + ")");
  const L = x.bankLinks ? x.bankLinks([R1, Object.assign({}, A, {state: "ignored"})]) : null;
  ok(L && L.s.join() === "s1" && !L.b.length, "a statement's links: its lines' invoices and bills, an ignored line's not");
}

console.log("3. a rule or a person's ledger leaves the old bill, invoice, TDS and split");
{
  const w = bankWorld({});
  const {x} = load(["applyRule", "ruleLedger", "ruleLabel", "bankUnlink", "bankVoucherXml", "bankSalesOf", "bankSalesAlloc", "OWN_BANK", "setLedgerFor", "setRowLedger", "rowSnapshot", "applyToVisible", "sameParty", "partyKey", "entries", "markSalesReceived"], w.stubs);
  const r = line({id: "st1-0", debit: 116000, narr: "NEFT SHARMA TRADERS", dec: {name: "SHARMA TRADERS", mode: "NEFT"}, ledger: "Sharma Traders", billId: "e1", billRef: "ST/1", tdsAtPay: 2000, tdsLedger: "TDS Payable", state: "ready"});
  const rule = {id: "rl1", name: "sharma", when: {}, then: {action: "set", ledger: "Sharma Traders", splits: [{ledger: "Freight", amt: "10000", pct: ""}], ready: true}};
  x.applyRule(rule, r, w.co, null);
  ok(!r.tdsAtPay && !r.billId && !r.billRef && r.splits.length === 2, "a rule run on a matched line drops its bill and TDS at payment (TDS " + r.tdsAtPay + ")");
  const v = tryIt(() => x.bankVoucherXml(r, {ledger: "HDFC Bank"}, w.co)), sd = typeof v === "string" ? sides(v) : null;
  ok(sd && sd.dr === 116000 && sd.cr === 116000, "its voucher adds up: Dr " + (sd && sd.dr) + " = Cr " + (sd && sd.cr));
  // a person gives a split line another ledger
  const sp = line({id: "st1-1", debit: 60000, narr: "NEFT MEHTA", dec: {name: "MEHTA"}, ledger: "Office Rent", splits: [{ledger: "Repairs", amt: 10000}, {ledger: "Office Rent", amt: 50000}], state: "ready"});
  w.b.rows = [sp];
  x.setLedgerFor([sp], "Mehta Properties");
  ok(!(sp.splits || []).length && sp.ledger === "Mehta Properties", "another ledger on a split line drops the old split");
  const xml = x.bankVoucherXml(sp, {ledger: "HDFC Bank"}, w.co);
  ok(/Mehta Properties/.test(xml) && !/Repairs|Office Rent/.test(xml), "its voucher posts Mehta Properties, not the old split's ledgers");
  ok(w.b.undo && w.b.undo.snaps[0].splits && w.b.undo.snaps[0].splits.length === 2, "Undo keeps the split it had");
  // a receipt suggested against Acme's invoice, moved to Beta Ltd
  w.b.salesRef = [{id: "s1", status: "posted", customerLedger: "Acme Traders", x: {number: "INV-10", total: 11800}}];
  const rc = line({id: "st1-2", credit: 11800, narr: "NEFT ACME", dec: {name: "ACME"}, ledger: "Acme Traders", salesIds: ["s1"], billRef: "INV-10", state: "suggested"});
  w.b.rows = [rc];
  x.setLedgerFor([rc], "Beta Ltd");
  ok(!rc.salesIds && !rc.billRef, "a receipt moved to another customer leaves the first customer's invoice (" + JSON.stringify(rc.salesIds) + ")");
  ok(!/INV-10/.test(x.bankVoucherXml(rc, {ledger: "HDFC Bank"}, w.co)), "its voucher has no Agst Ref INV-10");
  ok(w.b.undo.snaps[0].salesIds && w.b.undo.snaps[0].salesIds[0] === "s1", "Undo keeps the invoice it had");
  // confirming the same ledger keeps the match
  const rk = line({id: "st1-3", credit: 11800, narr: "NEFT ACME", dec: {name: "ACME"}, ledger: "Acme Traders", salesIds: ["s1"], billRef: "INV-10", state: "suggested"});
  w.b.rows = [rk]; x.setLedgerFor([rk], "Acme Traders");
  ok((rk.salesIds || []).join() === "s1", "confirming the ledger suggested keeps its invoice");
  // an old line that still holds the invoice of another customer: never allocated to it, nor marked received
  const old = line({id: "st1-4", credit: 11800, narr: "NEFT", dec: {name: ""}, ledger: "Beta Ltd", salesIds: ["s1"], state: "ready"});
  ok(!/INV-10/.test(x.bankVoucherXml(old, {ledger: "HDFC Bank"}, w.co)), "an invoice of another customer is never allocated on a receipt");
  x.markSalesReceived(old);
  ok(!w.b.salesRef[0].receivedBy, "nor marked received by it");
  // Set on all shown lines: the links go, Undo has them
  const vr = line({id: "st1-5", debit: 5000, narr: "RENT", dec: {name: "X"}, ledger: "Sharma Traders", billId: "e1", tdsAtPay: 500, tdsLedger: "TDS Payable", state: "suggested"});
  w.b.rows = [vr]; w.b.q = "rent";
  const ctxStub = {bankVisibleRows: () => [vr]};
  const {x: x2} = load(["applyToVisible", "bankUnlink", "rowSnapshot"], Object.assign({}, w.stubs, ctxStub));
  x2.applyToVisible("Office Rent");
  ok(vr.ledger === "Office Rent" && !vr.tdsAtPay && !vr.billId, "Set on the lines shown drops the bill and TDS at payment (TDS " + vr.tdsAtPay + ")");
  ok(w.b.undo && w.b.undo.rows && w.b.undo.rows[0].tdsAtPay === 500, "and its Undo puts them back");
}

console.log("4. receipts: credit notes, allocations");
{
  const w = bankWorld({});
  w.b.salesRef = [{id: "s1", status: "posted", customerLedger: "Acme Traders", x: {number: "INV-10", total: 11800, date: "2026-06-01", customerName: "Acme Traders"}},
    {id: "s2", status: "posted", customerLedger: "Acme Traders", x: {number: "CN-3", total: 5900, date: "2026-06-02", customerName: "Acme Traders", noteKind: "credit"}},
    {id: "s3", status: "review", customerLedger: "Acme Traders", x: {number: "INV-11", total: 4000, date: "2026-06-03", customerName: "Acme Traders"}}];
  const {x} = load(["openSalesInvoices", "matchSalesInvoice", "bankVoucherXml", "bankSalesOf", "bankSalesAlloc", "OWN_BANK"], w.stubs);
  const open = x.openSalesInvoices();
  ok(open.length === 1 && open[0].id === "s1", "the open invoices: INV-10 only (no credit note, none still in review): " + open.map(v => v.x.number).join(", "));
  ok(!x.matchSalesInvoice({credit: 5900, date: "2026-06-10", dec: {name: "ACME TRADERS"}}, open, new Set()), "a receipt of 5,900 is not matched to credit note CN-3");
  w.b.salesRef.push({id: "s4", status: "posted", customerLedger: "Acme Traders", x: {number: "INV-12", total: 11800.40}},
    {id: "s5", status: "posted", customerLedger: "Acme Traders", x: {number: "INV-13", total: 5000.30}}, {id: "s6", status: "intally", customerLedger: "Acme Traders", x: {number: "INV-14", total: 6800.30}});
  const rc = line({id: "st1-0", credit: 11799.50, narr: "NEFT ACME", dec: {name: "ACME"}, ledger: "Acme Traders", salesIds: ["s4"], state: "ready"});
  const xml = x.bankVoucherXml(rc, {ledger: "HDFC Bank"}, w.co), al = (xml.match(/<BILLALLOCATIONS\.LIST>[\s\S]*?<AMOUNT>([\d.]+)<\/AMOUNT>/g) || []).map(t => +t.match(/<AMOUNT>([\d.]+)</)[1]);
  ok(al.length === 1 && al[0] === 11799.5, "a receipt of 11,799.50 against INV-12 of 11,800.40 is allocated 11,799.50 (" + al + ")");
  const two = line({id: "st1-1", credit: 11800, narr: "NEFT ACME", dec: {name: "ACME"}, ledger: "Acme Traders", salesIds: ["s5", "s6"], state: "ready"});
  const a2 = (x.bankVoucherXml(two, {ledger: "HDFC Bank"}, w.co).match(/<BILLALLOCATIONS\.LIST>[\s\S]*?<AMOUNT>([\d.]+)<\/AMOUNT>/g) || []).map(t => +t.match(/<AMOUNT>([\d.]+)</)[1]);
  ok(a2.length === 2 && a2[0] === 5000.3 && a2[1] === 6799.7 && Math.round((a2[0] + a2[1]) * 100) === 1180000, "two invoices of 5,000.30 + 6,800.30 paid with 11,800: 5,000.30 and 6,799.70 (" + a2 + ")");
}

console.log("5. a voucher that does not add up; the Tally file and the running balance");
{
  const w = bankWorld({});
  const {x} = load(["bankVoucherXml", "bankSalesOf", "bankSalesAlloc", "OWN_BANK", "bankExportProblems", "bankRepOpen", "bankLineProblem"], w.stubs);
  const r = line({id: "st1-0", debit: 116000, narr: "NEFT", dec: {name: "SHARMA"}, ledger: "Sharma Traders", tdsAtPay: 2000, tdsLedger: "TDS Payable", splits: [{ledger: "Freight", amt: 10000}, {ledger: "Sharma Traders", amt: 106000}], state: "ready"});
  const e = tryIt(() => x.bankVoucherXml(r, {ledger: "HDFC Bank"}, w.co));
  ok(e instanceof Error && /does not add up/.test(e.message), "a split with TDS at payment (Dr 1,16,000, Cr 1,18,000) is never made: " + (e && e.message));
  const probs = x.bankExportProblems([r, line({id: "st1-1", debit: 1850, ledger: "Repairs", balOk: false, state: "ready", dec: {}})]);
  ok(probs.some(p => /split with TDS/.test(p)) && probs.some(p => /running balance/.test(p)), "the Tally file names both first: " + probs.join(" | "));
}

console.log("6. reading a statement");
{
  const {x} = load(["MONTHS", "toIsoDate", "cellText", "bankAmount", "bankDate", "BANK_NAMES", "statementMeta"]);
  let m = x.statementMeta(["STATE BANK OF INDIA", "Account No : 00000012345678901", "Statement From : 01/04/2026 To : 30/06/2026", "NEFT*UTIB0000123*SHARMA TRADERS"]);
  ok(m.ifsc !== "UTIB0000123" && m.bank === "State Bank of India", "an IFSC in a narration is not the account's (" + m.ifsc + ", " + m.bank + ")");
  ok(m.from === "2026-04-01" && m.to === "2026-06-30", "“Statement From : 01/04/2026 To : 30/06/2026” is read (" + m.from + " to " + m.to + ")");
  m = x.statementMeta(["Branch IFS Code: SBIN0001234", "From Date : 01/07/2026 To Date : 30/09/2026"]);
  ok(m.ifsc === "SBIN0001234" && m.from === "2026-07-01" && m.to === "2026-09-30", "“IFS Code” and “From Date : … To Date : …” (" + [m.ifsc, m.from, m.to] + ")");
  m = x.statementMeta(["Statement period: 01 Apr 2026 to 30 Jun 2026", "HDFC BANK", "Branch HDFC0000999"]);
  ok(m.from === "2026-04-01" && m.to === "2026-06-30" && m.ifsc === "HDFC0000999", "“01 Apr 2026 to 30 Jun 2026”, and an unlabelled IFSC of the bank named (" + [m.from, m.to, m.ifsc] + ")");
  ok(x.bankAmount("500.00-") === -500 && x.bankAmount("1,250.75-") === -1250.75 && x.bankAmount("-") === null, "a trailing minus: 500.00- is -500");
  ok(x.bankDate("15/06/2016") === "2016-06-15" && x.bankDate("15-Jun-16") === "2016-06-15" && x.toIsoDate(15, 6, 2016) === "", "a line of FY 2016-17 keeps its date (a bill's dates still start in 2017)");
}
{
  const canvas = () => ({width: 0, height: 0, getContext: () => ({fillRect(){}})});
  const page = {getViewport: () => ({width: 600, height: 800}), render: () => ({promise: Promise.resolve()})};
  const {x} = load(["statementImages"], {ensurePdfJs: async () => {}, isPdf: () => true, openPdfDoc: async () => ({numPages: 85, getPage: async () => page}), document: {createElement: canvas}});
  const file = {name: "long.pdf", arrayBuffer: async () => new ArrayBuffer(4)};
  x.statementImages(file).then(c => {
    ok(c.length === 60 && file.cut && file.cut.img && file.cut.img.join() === "60,85", "a scanned PDF of 85 pages: 60 read, and that is kept (" + JSON.stringify(file.cut) + ")");
    const {x: o} = load(["BankOverlap"], {days: () => 0, money: v => String(v), fmtDate: v => v});
    ok(o.BankOverlap.cutWords && /Only pages 1 to 60 of 85 were read/.test(o.BankOverlap.cutWords([60, 85])), "and said: " + (o.BankOverlap.cutWords ? o.BankOverlap.cutWords([60, 85]) : "-"));
    part7();
  });
}

function part7(){
  console.log("7. accounts and uploads");
  {
    const {x, has} = load(["bankAccIs"]);
    ok(has("bankAccIs") && !x.bankAccIs({last4: "5678", acct: "50100012345678"}, {acct: "50100099995678", ifsc: ""}, "5678"), "two full account numbers ending alike are two accounts");
    ok(has("bankAccIs") && x.bankAccIs({last4: "5678", acct: "50100012345678", ifsc: "HDFC0000001"}, {acct: "50100012345678", ifsc: "UTIB0000123"}, "5678"), "the same full number is the same account, whatever IFSC was read");
    ok(has("bankAccIs") && x.bankAccIs({last4: "5678", acct: "XXXXXX5678"}, {acct: "50100012345678"}, "5678"), "a masked number: the last four digits, as before");
  }
  const mem = {}, db = {get: async k => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : null), set: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); }};
  const co = {id: "cX", name: "Client X", bankAccounts: [{id: "a1", last4: "1234", acct: "", ifsc: "", ledger: "HDFC Bank"}]};
  const bX = {cid: "cX", cur: null, stmts: [], keys: {}, rows: [], ledgers: {list: []}, sel: new Set(), sticky: new Set(), busy: ""};
  const charged = [], S = {bank: bX, companies: {cX: co}, files: {}};
  let release, wait = new Promise(r => { release = r; });
  const parsed = {rows: Array.from({length: 59}, (_, i) => ({date: "2026-05-01", narr: "L" + i, debit: 1, credit: 0, balance: null})), meta: {acct: "XXXX1234"}};
  const take = {rows: parsed.rows.slice(31).map((r, i) => Object.assign({}, r, {id: "stN-" + i, state: "attention", dec: {}})), held: 0, nk: {k1: "stN"}, top: null, say: "May added."};
  take.st = {id: "stN", acctId: "a1"};
  const reads = [];
  const {x} = load(["uploadStatements", "bankFileAway", "bankAccIs", "countStates", "bankAside"], {S, B: () => S.bank, CO: id => co, BankDB: db, toast: m => { reads.push("toast:" + m); }, render(){}, bankHeal: async () => false,
    fileHash: async () => "h1", readStatement: async f => { reads.push("read:" + f.name); await wait; return parsed; }, checkBalances: () => ({bad: 0, fixed: 0}), uid: p => p + "N",
    bankTake: async () => take, charge: async (k, n) => { charged.push(n); return true; }, FileStore: {put(){}}, CloudDocs: {add(){}}, suggestAll(){ reads.push("suggest"); }, matchTallyBook(){}, saveBank(){ reads.push("saveBank"); },
    bankLinks: () => ({b: [], s: []}), bankFlush(){}, bridgeLive: () => false, curStmt: () => null, bankErr: e => String(e && (e.message || e.code)), bankReport: () => "", choiceGuess(){}, Store: {saveCompany(){}}, bankOpenHeld: async () => {}});
  const f1 = {name: "april-may.pdf", size: 1}, f2 = {name: "april-may.pdf", size: 1};
  const run1 = x.uploadStatements([f1]);
  setTimeout(async () => {
    await x.uploadStatements([f2]);
    ok(reads.filter(r => r.startsWith("read:")).length === 1 && reads.some(r => /^toast:Wait/.test(r)), "a second upload while one is read waits (it is not read and added twice): " + reads.filter(r => /toast/.test(r)).join(" | "));
    // client X's page opened afresh (a new page, not busy) while the file is read: still one at a time
    S.bank = {cid: "cX", cur: null, stmts: [], keys: {}, rows: [], ledgers: {list: []}, sel: new Set(), sticky: new Set(), busy: ""};
    await x.uploadStatements([{name: "april-may.pdf", size: 1}]);
    ok(reads.filter(r => r.startsWith("read:")).length === 1 && reads.filter(r => /^toast:Wait/.test(r)).length === 2, "nor when client X's page is opened again meanwhile");
    // the person opens client Y while the file is read
    const bY = {cid: "cY", stmts: [], keys: {}, rows: [], sel: new Set(), sticky: new Set()};
    S.bank = bY; release();
    await run1;
    ok(charged.length === 1 && charged[0] === 28, "the lines charged: the 28 added, not the 31 already uploaded (" + charged + ")");
    ok(!bY.stmts.length && !reads.includes("suggest"), "client Y's page gets nothing of it, and Y's ledgers suggest nothing on it");
    ok((mem["stmts:cX"] || []).some(st => st.id === "stN") && (mem["stmt:cX:stN"] || []).length === 28 && mem["keys:cX"] && mem["keys:cX"].k1 === "stN", "it is kept under client X: its record, its 28 lines and its fingerprints");
    part8();
  }, 20);
}

function part8(){
  console.log("8. one save per statement");
  const writes = [], timers = [];
  const db = {set: async (k, v) => { writes.push([k, v.length]); }};
  const b = {cid: "c1", cur: "A", rows: [1, 2, 3], stmts: [{id: "A"}, {id: "B"}]};
  const S = {bank: b};
  const {x, ctx} = load(["bankSaveTimer", "BANK_REV", "saveBank", "bankFlush", "countStates", "bankLinks", "bankAside"], {S, B: () => S.bank, BankDB: db,
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout(){}});
  x.saveBank({rows: true});
  b.cur = "B"; b.rows = [9];
  x.saveBank({rows: true});
  ok(writes.some(w => w[0] === "stmt:c1:A" && w[1] === 3), "a save on statement B writes A's waiting save first (" + JSON.stringify(writes) + ")");
  ok(b.stmts[0].links && Array.isArray(b.stmts[0].links.b), "A's record keeps its lines' links to bills and invoices");
  part9();
}

function part9(){
  console.log("9. a gap between two statements");
  const {x} = load(["BankOverlap"], {days: (a, b) => Math.abs((new Date(a) - new Date(b)) / 864e5), money: v => String(v), fmtDate: v => v});
  const prev = {id: "p", acctId: "a1", from: "2026-04-01", to: "2026-06-28", fileFrom: "2026-04-01", fileTo: "2026-06-28", closing: 1000};
  const st = {id: "s", acctId: "a1", from: "2026-07-01", to: "2026-09-30", fileFrom: "2026-07-01", fileTo: "2026-09-30", opening: 1000};
  const j = x.BankOverlap.join([prev, st], st);
  ok(!j || !j.gap, "the last line on 28-Jun, no period printed, the balances join: no “No statement for 29-Jun to 30-Jun” (" + JSON.stringify(j && j.gap) + ")");
  const j2 = x.BankOverlap.join([Object.assign({}, prev, {printed: true}), Object.assign({}, st, {printed: true})], Object.assign({}, st, {printed: true}));
  ok(j2 && j2.gap && /29/.test(j2.gap.from), "both print periods that leave 29-30 Jun out: the gap is said");
  console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
  process.exitCode = fails ? 1 : 0;
}
