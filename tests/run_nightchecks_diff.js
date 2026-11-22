// node tests/run_nightchecks_diff.js - the differential test (acceptance rule 5): the checks Daily Check ported from the
// browser (server/_shared/nightchecks.js) give the browser's own answer on the same made-up books (tests/fixtures/books,
// with made-up cash, round-sum and suspense entries added). Run on the built app (site-test/index.html: python3 build.py).
//   1. every ledger's group tests (Audit.isCash, isBankL, isLoan, isCapital, isDuties, isCreditor, isDebtor, isExpense,
//      isIncome) with the browser's ledGroupPath and Books.ledgerOf
//   2. cash paid to one party in a day (Audit.checks.cash40A3): the same rows, party, date and amount, to the paisa
//   3. round-sum journals and journals with no narration (Audit.checks.odd "round" and "narr", at the browser's ₹1 lakh)
//   4. written bank rules (ruleHits, src/js/22) on made-up lines and rules
const fs = require("fs"), path = require("path"), { load, openBlob, HTML, DATA, CACHE } = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D",
  "TDS_SEC_CODES", "TDSReg", "TDSInt", "TDSFiled", "TDSCH", "BOOKS_KEYS", "uid", "lsGet", "lsSet", "istParts", "p2ist", "istDay", "istToday", "TDSWatch", "TDSRate", "noPanRate", "NO_PAN_RATE", "ruleHits"];
let fails = 0, n = 0;
const ok = (c, w) => { n++; console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
(async () => {
  const N = await import(path.join(__dirname, "..", "server", "_shared", "nightchecks.js"));
  const { ctx, x } = load(HTML, NAMES);
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, { ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, states: ms.states, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}, cid: "t" });
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; ctx.S.companies = { t: { id: "t", name: "Made-up Fixture Co" } }; ctx.CO = () => ctx.S.companies.t; ctx.S.coId = "t"; ctx.S.data = {};
  // made-up entries so each ported check has rows: cash to one party (two in a day, one above, one below the limit, a
  // transporter), round-sum journals (to an expense, to a balance-sheet ledger only), journals with no narration
  const cashL = Object.keys(b.ledInfo).find((l) => x.Audit.isCash(l)) || "Cash";
  const expL = Object.keys(b.ledInfo).find((l) => x.Audit.isExpense(l));
  const credL = Object.keys(b.ledInfo).find((l) => x.Audit.isCreditor(l));
  const V3 = (id, date, type, ent, o) => Object.assign({ id: "nd-" + id, date, type, no: "ND" + id, party: "", narr: "made-up for the night checks", ent: ent.map(([l, a]) => ({ l, a })), cmp: "", gstin: "", pos: "", hsn: [] }, o || {});
  b.vouchers = b.vouchers.concat([
    V3(1, "20251110", "Payment", [[credL, -12000], [cashL, 12000]]), V3(2, "20251110", "Payment", [[credL, -500], [cashL, 500]]),
    V3(3, "20251111", "Payment", [[credL, -9999.99], [cashL, 9999.99]]), V3(4, "20251112", "Payment", [[expL, -15000], [cashL, 15000]]),
    V3(5, "20251113", "Payment", [["Made-up Roadways (transport)", -30000], [cashL, 30000]]),
    V3(6, "20251201", "Journal", [[expL, -200000], [credL, 200000]], { narr: "" }), V3(7, "20251202", "Journal", [[credL, -300000], [cashL, 300000]], { narr: "" }),
    V3(8, "20251203", "Journal", [[expL, -150000.5], [credL, 150000.5]], { narr: "" })]);
  x.LedMaster.refresh(b);
  const V = b.vouchers.filter((v) => !v.opt && !v.cancel);
  const books = { vouchers: V, under: b.under, groups: b.groups, map: b.map, pathOf: (l) => x.ledGroupPath(b, l), kindOf: (l) => x.Books.ledgerOf(l).kind };
  const A = N.groupsOf(books);
  // 1. group tests
  const leds = Array.from(new Set(Object.keys(b.ledInfo).concat(...V.map((v) => v.ent.map((e) => e.l))))).sort();
  const T = ["isCash", "isBankL", "isLoan", "isCapital", "isDuties", "isCreditor", "isDebtor", "isExpense", "isIncome"];
  let bad = [];
  leds.forEach((l) => T.forEach((t) => { if (!!x.Audit[t](l) !== !!A[t](l)) bad.push(t + "(" + l + ")"); }));
  ok(!bad.length, "group tests: " + leds.length + " ledgers × " + T.length + " tests agree" + (bad.length ? " (differ: " + bad.slice(0, 5).join(", ") + ")" : ""));
  ok(leds.some((l) => A.isCash(l)) && leds.some((l) => A.isCreditor(l)) && leds.some((l) => A.isExpense(l)), "the fixture has cash, creditor and expense ledgers (the test means something)");
  // 2. cash in a day
  const legacy = (x.Audit.checks.cash40A3(x.Audit, V, { from: "20250401", to: "20260331" }) || { rows: [] }).rows.map((r) => [r.date, r.party, x.r2(r.amount)]).sort();
  const mine = N.cashRows(A, V).map((r) => [r.date, r.l, N.r2(r.amt)]).sort();
  ok(legacy.length > 0 && JSON.stringify(legacy) === JSON.stringify(mine), "cash in a day: " + legacy.length + " rows, the same" + (JSON.stringify(legacy) === JSON.stringify(mine) ? "" : " (browser " + JSON.stringify(legacy.slice(0, 4)) + " · night " + JSON.stringify(mine.slice(0, 4)) + ")"));
  // 3. round sums and no narration (the browser's limit: ₹1 lakh, journals only)
  const odd = x.Audit.checks.odd(x.Audit, V) || [], rowsOf = (k) => ((odd.find((f) => f.key === k) || { rows: [] }).rows).map((r) => [r.vid, x.r2(r.amount)]).sort();
  const r1 = N.roundRows(A, V, { round: 100000 }).map((y) => [y.v.id, N.r2(y.amt)]).sort(), n1 = N.bareRows(A, V, { narr: 100000, narrTypes: /JOURNAL/i }).map((y) => [y.v.id, N.r2(y.amt)]).sort();
  ok(rowsOf("round").length > 0 && JSON.stringify(rowsOf("round")) === JSON.stringify(r1), "round-sum journals: " + r1.length + " rows, the same");
  ok(rowsOf("narr").length > 0 && JSON.stringify(rowsOf("narr")) === JSON.stringify(n1), "journals with no narration: " + n1.length + " rows, the same");
  // 4. written rules
  const rows = [{ narr: "NEFT/BSES RAJDHANI/112233", debit: 9800, credit: 0, date: "20251105", dec: { name: "BSES", mode: "NEFT" } }, { narr: "UPI/RAMESH/9999", debit: 0, credit: 500, date: "20251106", dec: { name: "RAMESH", mode: "UPI" } },
    { narr: "ACH/LOAN/000012345678", debit: 21500, credit: 0, date: "20251107", dec: { name: "", mode: "ACH" } }];
  const rules = [{ when: { text: [{ op: "has", v: "bses" }], dir: "out", amtMin: "", amtMax: "" }, then: {} }, { when: { text: [{ op: "starts", v: "upi" }], dir: "in", amtMin: "100", amtMax: "1000" }, then: {} },
    { when: { text: [{ op: "has", v: "loan" }, { op: "not", v: "upi" }], modes: ["ACH"], acNo: "12345678", amtMin: "", amtMax: "" }, then: {} }, { when: { text: [{ op: "not", v: "x" }], amtMin: "", amtMax: "" }, then: {} },
    { when: { text: [{ op: "has", v: "bses" }], dir: "in", amtMin: "", amtMax: "" }, then: {} }, { off: true, when: { text: [{ op: "has", v: "bses" }] }, then: {} }, { when: { text: [], amtMin: "9000", amtMax: "10000" }, then: {} }];
  let same = 0, hits = 0;
  rules.forEach((r) => rows.forEach((row) => { const a = !!x.ruleHits(r, row, null), c = !!N.ruleHits(r, row, null); if (a === c) same++; if (a) hits++; }));
  ok(same === rules.length * rows.length && hits > 0, "written rules: " + same + " of " + rules.length * rows.length + " rule × line answers the same (" + hits + " hits)");
  console.log(fails ? fails + " of " + n + " failed" : "all " + n + " passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("  FAIL " + (e && e.stack || e)); process.exit(1); });
