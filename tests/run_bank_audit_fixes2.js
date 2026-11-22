// node tests/run_bank_audit_fixes2.js — the re-review of the bank audit fixes (next-fix-audit-bank, 22-Nov-2026), each case
// with made-up lines, parties and bills only: the app's own functions, read by name from the built one-file site
// (site-test/index.html), run in a Node context with the rest of the app stubbed (as tests/run_bank_audit_fixes.js).
//   1. a voucher that does not add up is held back on its own line: the bridge posts the others
//   2. a rule's fixed split larger than the payment; a stale split kept with a bill's TDS at payment
//   3. a statement read while the same client's page was opened again goes onto that page
//   4. a positional (PDF / OCR) reader's column is a guess: such a line may still be turned round; "500.00-" is money
//   5. an overdraft reading refused when the opening or closing is printed with Cr; a hint when it nearly fits
//   6. automatic posting: a bill another line holds is never given to a second payment
//   7. a gap between two statements saved before "printed" was kept
const fs = require("fs"), vm = require("vm"), path = require("path");
const HTML = process.env.TDSDESK_HTML || path.join(__dirname, "..", "site-test", "index.html");
const s = fs.readFileSync(HTML, "utf8");
const i0 = s.indexOf('<script id="app-main">') + '<script id="app-main">'.length, JS = s.slice(i0, s.indexOf("</script>", i0));
const decl = []; { const re = /\n(?:async function|function|const|let|var|class) ([A-Za-z_$][\w$]*)/g; let m; while ((m = re.exec(JS))) decl.push({name: m[1], at: m.index}); }
const SHARED = ["NORM_CACHE", "normName", "normNameRaw", "gramsOf", "nameSim", "num", "r2", "MONTHS3", "toDateObj", "fmtDate", "INR"];
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
function load(names, stubs){
  const all = SHARED.concat(names).filter((n, i, a) => a.indexOf(n) === i), missing = [];
  const parts = all.map(n => { const k = decl.findIndex(d => d.name === n); if (k < 0){ missing.push(n); return ""; } return JS.slice(decl[k].at, k + 1 < decl.length ? decl[k + 1].at : JS.length); });
  const ctx = Object.assign({console, Intl, Math, JSON, Date, Set, Map, WeakMap, Array, Object, String, Number, RegExp, Promise, Error, isFinite, parseFloat, setTimeout, clearTimeout,
    window: {addEventListener(){}}, globalThis: null, toast(){}, render(){}}, stubs || {});
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(parts.join("\n") + "\n;globalThis.__x = {" + all.filter(n => !missing.includes(n)).join(",") + "};", ctx);
  if (missing.length) console.log("  (not in this build: " + missing.join(", ") + ")");
  Object.assign(ctx, stubs || {});
  return {ctx, x: ctx.__x, has: n => !missing.includes(n)};
}
const tryIt = (f) => { try { return f(); } catch (e){ return e; } };
const line = (o) => Object.assign({date: "2026-06-10", narr: "", debit: 0, credit: 0, balance: null, state: "attention", ledger: "", userSet: false, splits: [], fp: "fp" + Math.random(), dec: {}}, o);
function world(o){
  const leds = [{name: "Sharma Traders", group: "Sundry Creditors"}, {name: "Freight", group: "Indirect Expenses"}, {name: "Repairs", group: "Indirect Expenses"},
    {name: "TDS Payable", group: "Duties & Taxes"}, {name: "HDFC Bank", group: "Bank Accounts"}];
  const map = new Map(leds.map(l => [l.name.toLowerCase(), l])); map.norm = new Map();
  const b = Object.assign({cid: "c1", cur: "st1", stmts: [{id: "st1", acctId: "a1"}], rows: [], rules: [], newLed: [], salesRef: [], sel: new Set(), sticky: new Set(), hist: {rows: {}}, histVer: 0, keys: {},
    ledgers: {live: true, importedAt: new Date().toISOString(), list: leds}}, o.b || {});
  const co = Object.assign({id: "c1", name: "Test Client", tdsLedgers: {}, bankAccounts: [{id: "a1", ledger: "HDFC Bank"}], bankAuto: true, billwise: true}, o.co || {});
  return {b, co, stubs: Object.assign({S: {bank: b, firm: {bankRules: []}, companies: {c1: co}}, B: () => b, CO: () => co, curStmt: () => b.stmts.find(z => z.id === b.cur),
    knownLedgers: () => map, exactLedger: n => { const l = map.get(String(n || "").trim().toLowerCase()); return l ? l.name : null; }, hasLedgerList: () => true,
    stdLedger: (c, k) => k === "tds" ? "TDS Payable" : null, bankLedgers: () => ({tds: "TDS Payable"}), patternFor: () => null, historyFor: () => null,
    vtypeFor: r => r.debit ? "Payment" : "Receipt", countRuleUse(){}, isOwnBank: () => false, matchRule: () => null, saveBank(){}, learnRows: () => ({}),
    D: () => ({entries: o.entries || {}}), tallyLedgerName: n => n, fpHash: v => "h" + v, toTallyDate: d => String(d).replace(/-/g, ""), xesc: v => String(v),
    ledNm: v => String(v || "").trim(), BANK_GROUPS: /bank accounts|bank od|cash-in-hand/i}, o.stubs || {})};
}

async function main(){
  console.log("1. one voucher that does not add up holds back only its own line");
  {
    const good = line({id: "st1-0", debit: 1850, narr: "UPI REPAIRS", ledger: "Repairs", state: "ready", balOk: true});
    // a written rule's fixed split of 10,000 kept on a payment of 5,000 (an older build): Dr 10,000 against Cr 5,000
    const over = line({id: "st1-1", debit: 5000, narr: "NEFT FREIGHT", ledger: "Sharma Traders", splits: [{ledger: "Freight", amt: 10000}], state: "ready", balOk: true});
    // a split kept with a bill's TDS at payment: Dr 1,16,000 against Cr 1,18,000
    const tds = line({id: "st1-2", debit: 116000, narr: "NEFT SHARMA", ledger: "Sharma Traders", tdsAtPay: 2000, tdsLedger: "TDS Payable",
      splits: [{ledger: "Freight", amt: 10000}, {ledger: "Sharma Traders", amt: 106000}], state: "ready", balOk: true});
    const w = world({b: {rows: [good, over, tds]}});
    let sent = null; const toasts = [];
    const stubs = Object.assign({}, w.stubs, {bankRepOpen: () => false, ensureTallyCompany: async () => "Test Co", toast: m => toasts.push(m),
      Bridge: {st: {allowImport: true, version: "2.2.0"}, post: async p => { sent = p; return {results: p.vouchers.map(v => ({id: v.id, ok: true, verified: true}))}; }},
      syncLedgersFromTally: async () => {}, bankLedgerReady: () => "HDFC Bank", bankLedgerWhy: () => "", tallyVia: () => "bridge", bridgeVer: v => v === "1.12.3" ? 2 : 1,
      syncBankBookFromTally: async () => {}, addDays: d => d, lsGet: () => "1", wideCheckKey: () => "k", dropOwnBank(){}, suggestLedgers: () => [], entries: n => n + " entries",
      postingLine: () => "", refreshBusy(){}, bankAfterCheck(){}, postReleased: () => [], postTaken: () => true, postAlready: () => false, bankPosted: (cid, r) => { r.state = "intally"; },
      plainMsg: m => String(m || ""), bankAlreadyLine: () => "", ledgerMasterXml: () => "", Cloud: {st: {}}, logPosting(){}});
    const {x} = load(["postBankToTally", "bankVoucherXml", "bankSalesOf", "bankSalesAlloc", "OWN_BANK", "bankLineProblem"], stubs);
    await x.postBankToTally();
    const ids = sent ? sent.vouchers.map(v => v.id) : [];
    ok(sent && ids.join() === "st1-0", "the line that adds up is posted, the two that do not are not sent (sent: " + (sent ? ids.join() : "nothing; " + toasts.join(" | ")) + ")");
    const rep = w.b.postReport || {}, fl = rep.failed || [];
    ok(fl.length === 2 && fl.every(f => /split|add up/i.test(f.msg)) && !/Posting failed/.test(toasts.join(" ")), "each is listed with why (" + fl.map(f => f.msg).join(" | ") + ")");
    ok(over.state === "attention" && tds.state === "attention" && over.why && /split/i.test(over.why.join(" ")), "and goes to Needs you, said on the line (" + over.state + ", " + tds.state + ")");
    const {x: g} = load(["bankLineProblem"], w.stubs);
    ok(/split/i.test(g.bankLineProblem(line({debit: 5000, ledger: "Sharma Traders", splits: [{ledger: "Freight", amt: 10000}]}))), "bankLineProblem: a split that is more than the amount");
    ok(/split/i.test(g.bankLineProblem(line({credit: 5000, ledger: "Sharma Traders", splits: [{ledger: "Freight", amt: 3000}]}))), "bankLineProblem: a split that is less than the amount");
    ok(!g.bankLineProblem(line({debit: 5000, ledger: "Sharma Traders", splits: [{ledger: "Freight", amt: 3000}, {ledger: "Sharma Traders", amt: 2000}]})), "a split that adds up is no problem");
  }

  console.log("2. a rule's split larger than the payment; a stale split with a bill's TDS");
  {
    const w = world({});
    const {x} = load(["applyRule", "ruleLedger", "ruleLabel", "bankUnlink"], w.stubs);
    const r = line({id: "st1-0", debit: 5000, narr: "NEFT SHARMA", dec: {name: "SHARMA"}});
    const rule = {id: "rl1", name: "sharma", when: {}, then: {action: "set", ledger: "Sharma Traders", splits: [{ledger: "Freight", amt: "10000", pct: ""}], ready: true}};
    x.applyRule(rule, r, w.co, null);
    const sum = (r.splits || []).reduce((a, p) => a + p.amt, 0);
    ok(!(r.splits || []).length || sum === 5000, "a fixed split of 10,000 is not put on a payment of 5,000 (splits " + JSON.stringify(r.splits) + ")");
    ok(r.state !== "ready" && /split/i.test((r.why || []).join(" ")), "the line is left for a person, saying why (" + r.state + ": " + (r.why || []).join(" ") + ")");
    // a split made by a rule since deleted, the line suggested again to the same ledger and matched to a bill with TDS at payment
    const entries = {e1: {id: "e1", status: "approved", natureId: "194C", snapshot: {total: 118000, tds: 0, skip: {reason: "pay"}, tdsWould: 2000}, x: {vendorName: "Sharma Traders", invoiceDate: "2026-06-01", invoiceNo: "ST/1"}, partyLedger: "Sharma Traders"}};
    const st = line({id: "st1-0", debit: 116000, narr: "NEFT SHARMA TRADERS", dec: {name: "SHARMA TRADERS", key: "name:sharmatraders", mode: "NEFT"}, ledger: "Sharma Traders", ruleId: "rlGone",
      splits: [{ledger: "Freight", amt: 10000}, {ledger: "Sharma Traders", amt: 106000}], state: "suggested"});
    const w2 = world({entries, b: {rows: [st]}});
    const {x: x2} = load(["suggestAll", "suggestRow", "matchBill", "openBills", "openSalesInvoices", "matchSalesInvoice", "partyKey", "findRule", "bankAside", "bankClaims", "bankLinks", "bankUnlink", "applyRule", "dropOwnBank"], w2.stubs);
    x2.suggestAll(w2.b.rows);
    ok(!(st.splits.length && st.tdsAtPay), "suggested again, the line has not both the old split and the bill's TDS at payment (splits " + st.splits.length + ", TDS " + st.tdsAtPay + ")");
  }

  console.log("3. the same client's page opened again while its statement was read");
  {
    const mem = {"stmts:cX": [{id: "stOld", acctId: "a1"}], "keys:cX": {k0: "stOld"}};
    const db = {get: async k => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : null), set: async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); }};
    // the page opened afresh: it read the client's records before the statement was written
    const nb = {cid: "cX", cur: "stOld", stmts: [{id: "stOld", acctId: "a1"}], keys: {k0: "stOld"}, rows: []};
    const S = {bank: nb, files: {}};
    const {x} = load(["bankFileAway", "countStates", "bankAside"], {S, B: () => S.bank, BankDB: db, FileStore: {put(){}}, CloudDocs: {add(){}}});
    await x.bankFileAway("cX", {id: "stN", acctId: "a1"}, [line({id: "stN-0", debit: 1})], {k1: "stN"}, {name: "may.pdf"});
    ok(nb.stmts.some(s => s.id === "stN") && nb.keys.k1 === "stN" && nb.keys.k0 === "stOld", "the page open now has the statement and its fingerprints (" + nb.stmts.map(s => s.id) + ")");
    ok((mem["stmts:cX"] || []).some(s => s.id === "stN") && (mem["stmt:cX:stN"] || []).length === 1, "and it is written under the client");
    // another client's page open: nothing goes onto it
    const ny = {cid: "cY", stmts: [], keys: {}, rows: []}; S.bank = ny;
    await x.bankFileAway("cX", {id: "stM", acctId: "a1"}, [line({id: "stM-0", debit: 1})], {k2: "stM"}, {name: "jun.pdf"});
    ok(!ny.stmts.length && !ny.keys.k2 && (mem["stmts:cX"] || []).some(s => s.id === "stM"), "another client's page gets nothing; it is kept under client X");
  }

  console.log("4. reading: a positional reader's column is a guess; a trailing minus");
  {
    const {x} = load(["MONTHS", "toIsoDate", "cellText", "bankAmount", "bankDate", "rowsFromCells", "checkBalances", "MONEY_TOKEN"]);
    const list = [{cells: {date: "01/05/2026", narr: "NEFT ACME", debit: "", credit: "200.00", balance: "1,200.00"}}, {cells: {date: "02/05/2026", narr: "NEFT ACME", debit: "500.00", credit: "", balance: "1,700.00"}}];
    const cols = {date: "date", narr: "narr", debit: "debit", credit: "credit", balance: "balance"};
    const rows = x.rowsFromCells(list, cols, (r, k) => r.cells[k] || "", r => Object.values(r.cells).join(" "), {guess: true});
    ok(rows.length === 2 && rows.every(r => !r.dirSure), "a column placed by its x position (PDF, OCR) does not state the direction");
    const chk = x.checkBalances(rows, {opening: 1000});
    ok(rows[1].credit === 500 && rows[1].fixedDir && chk.bad === 0 && chk.fixed === 1, "an amount OCR put under the wrong column is turned round to fit, as before (" + JSON.stringify(chk) + ")");
    const sheet = x.rowsFromCells(list, cols, (r, k) => r.cells[k] || "", null);
    ok(sheet.every(r => r.dirSure), "a sheet's own Withdrawal/Deposit columns still state it");
    const dc = x.rowsFromCells([{cells: {date: "01/05/2026", narr: "X", amount: "200.00", drcr: "DR", balance: "800.00"}}], {date: "date", narr: "narr", amount: "amount", drcr: "drcr", balance: "balance"}, (r, k) => r.cells[k] || "", null, {guess: true});
    ok(dc[0].dirSure && dc[0].debit === 200, "a printed Dr still states it, positional or not");
    ok(JS.split("r => r.text, {guess: true})").length - 1 === 2, "both positional readers (PDF text, OCR) say their columns are a guess");
    ok(x.MONEY_TOKEN && x.MONEY_TOKEN.test("500.00-") && x.MONEY_TOKEN.test("1,250.75-") && !x.MONEY_TOKEN.test("500-"), "“500.00-” is money in PDF text and OCR");
  }

  console.log("5. an overdraft reading, and a printed Cr");
  {
    const {x} = load(["MONTHS", "toIsoDate", "cellText", "bankAmount", "bankDate", "BANK_NAMES", "statementMeta", "checkBalances"]);
    const m = x.statementMeta(["SAVINGS ACCOUNT", "Opening Balance 10,000.00 Cr", "Closing Balance 11,500.00 Cr"]);
    ok(m.opening === 10000 && m.crPrinted === true, "an opening printed with Cr is kept as said (" + JSON.stringify(m) + ")");
    // a savings statement whose reader took Deposit for Withdrawal: every line fits as an overdraft too
    const rows = [{date: "2026-05-02", narr: "X", debit: 2000, credit: 0, balance: 12000, dirSure: true}, {date: "2026-05-03", narr: "Y", debit: 0, credit: 500, balance: 11500, dirSure: true}];
    const chk = x.checkBalances(rows, m);
    ok(!chk.od && rows[0].balance === 12000 && m.opening === 10000 && chk.bad >= 1, "with Cr printed it is not read as an overdraft: the lines are flagged (" + JSON.stringify(chk) + ")");
    // an overdraft statement with one misread line: every line fails as printed; it says it may be an overdraft
    const r2 = [{date: "2026-05-02", narr: "X", debit: 1000, credit: 0, balance: 21000, dirSure: true}, {date: "2026-05-03", narr: "Y", debit: 0, credit: 500, balance: 20500, dirSure: true},
      {date: "2026-05-04", narr: "Z", debit: 999, credit: 0, balance: 20800, dirSure: true}, {date: "2026-05-05", narr: "W", debit: 200, credit: 0, balance: 21000, dirSure: true}];
    const c2 = x.checkBalances(r2, {opening: 20000});
    ok(!c2.od && c2.odMaybe === 1, "an overdraft with one misread line is not read as one, but is said to fit one but for 1 line (" + JSON.stringify(c2) + ")");
    const {x: o} = load(["BankOverlap"], {days: () => 0, money: v => String(v), fmtDate: v => v});
    ok(o.BankOverlap.odWords && /overdraft/i.test(o.BankOverlap.odWords(1)), "the words: " + (o.BankOverlap.odWords ? o.BankOverlap.odWords(1) : "-"));
  }

  console.log("6. automatic posting: a bill another line holds");
  {
    const bills = [{e: {id: "e1"}, date: "2026-06-01", amounts: [{v: 116000, tdsAtPay: 2000}], name: "Sharma Traders", ledger: "Sharma Traders", ref: "ST/1"},
      {e: {id: "e2"}, date: "2026-06-01", amounts: [{v: 50000}], name: "Sharma Traders", ledger: "Sharma Traders", ref: "ST/2"}];
    const held = line({id: "st1-0", debit: 116000, dec: {name: "SHARMA TRADERS"}, billId: "e1", state: "ready"});
    const next = line({id: "st1-1", debit: 116000, dec: {name: "SHARMA TRADERS"}, date: "2026-06-12"});
    const third = line({id: "st1-2", debit: 50000, dec: {name: "SHARMA TRADERS"}, date: "2026-06-13"});
    const b = {cid: "c1", cur: "st1", stmts: [{id: "st1"}, {id: "st2", links: {b: ["e2"], s: []}}], rows: [held, next, third]};
    const {x} = load(["AutoPost", "matchBill", "bankClaims", "bankLinks"], {});
    const pick = x.AutoPost.billPicker ? x.AutoPost.billPicker(b, bills) : null;
    ok(pick && !pick(next), "a bill a ready line of this statement holds is not given to a second payment");
    ok(pick && !pick(third), "nor one a line of another statement holds");
    const p0 = pick && pick(held);
    ok(p0 && p0.id === "e1", "the line holding it keeps it");
  }

  console.log("7. a gap between statements saved before the period printed was kept");
  {
    const {x} = load(["BankOverlap"], {days: (a, b) => Math.abs((new Date(a) - new Date(b)) / 864e5), money: v => String(v), fmtDate: v => v});
    // old records (no "printed"): the period differs from the lines' dates, so it was printed
    const prev = {id: "p", acctId: "a1", from: "2026-04-03", to: "2026-06-26", fileFrom: "2026-04-01", fileTo: "2026-06-28", closing: 1000};
    const st = {id: "s", acctId: "a1", from: "2026-07-02", to: "2026-09-29", fileFrom: "2026-07-01", fileTo: "2026-09-30", opening: 1000};
    const j = x.BankOverlap.join([prev, st], st);
    ok(j && j.gap && j.gap.from === "2026-06-29" && j.gap.to === "2026-06-30", "old statements whose printed period is known: the gap is said (" + JSON.stringify(j && j.gap) + ")");
    // old records whose period cannot be told from the lines': said as a possible gap, to look at
    const p2 = Object.assign({}, prev, {from: "2026-04-01", to: "2026-06-28"}), s2 = Object.assign({}, st, {from: "2026-07-01", to: "2026-09-30"});
    const j2 = x.BankOverlap.join([p2, s2], s2);
    ok(j2 && !j2.gap && j2.maybeGap && /29/.test(j2.maybeGap.from), "otherwise a possible gap, not a sure one (" + JSON.stringify(j2) + ")");
    // new records that print no period: nothing, as before
    const j3 = x.BankOverlap.join([Object.assign({}, p2, {printed: false}), Object.assign({}, s2, {printed: false})], Object.assign({}, s2, {printed: false}));
    ok(!j3, "new statements that print no period, balances joining: nothing said");
  }
  console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
  process.exitCode = fails ? 1 : 0;
}
main().catch(e => { console.log("  FAIL (threw) " + (e && e.stack || e)); process.exitCode = 1; });
