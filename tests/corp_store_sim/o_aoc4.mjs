// the review of e17fa7c75 (stage 5): the AOC-4 builder's model (aoc4.js), on made-up figures: amounts as auditors write
// them (junk refused), the heads guessed from a line's words, the file's lines kept (not its cells), what is in no head,
// the file's own totals, the tolerance (half a paisa), the UDIN, the CSV's formula-looking cells, a CSV read as UTF-8
import { createRequire } from "module";
import { ok, done } from "./harness.mjs";
const A = await import("../../app/src/screens/corp/aoc4.js");
console.log("4. amounts");
const N = { "1,00,000.00": 100000, "(1,00,000.00)": -100000, "-1,000": -1000, "1,000 Dr": 1000, "1,000 Cr": -1000, "1000-": -1000, "−1,000": -1000, "₹ (1,000)": -1000, "Rs. (500)": -500, "Rs.1,234": 1234, "Rs 99": 99, "INR 5": 5, "—": 0, "-": 0, "": 0, "3": 3, "₹1,23,456.78": 123456.78, "(1,234) Cr": -1234 };
const wrong = Object.entries(N).filter(([s, v]) => A.num(s) !== v);
ok(!wrong.length, "read as written (" + wrong.map(([s]) => s + " -> " + A.num(s)).join("; ") + ")");
ok(isNaN(A.num("12abc")) && isNaN(A.num("1e5")) && isNaN(A.num("abc")) && !A.isNum("Share capital") && !A.isNum("31-03-2026") && A.isNum("(1,000)"), "junk is not an amount (NaN), text never one");
console.log("2. the heads guessed");
const G = { "Intangible assets": "intang", "Other intangible assets": "intang", "Tangible assets": "ppe", "Purchases of stock-in-trade": "pur", "Stock-in-trade": "inv",
  "Total outstanding dues of micro enterprises and small enterprises": "tpm", "Total outstanding dues of creditors other than micro enterprises and small enterprises": "tpo",
  "(A) Total outstanding dues of micro enterprises and small enterprises": "tpm", "(B) Total outstanding dues of creditors other than micro enterprises and small enterprises": "tpo",
  "Dues to creditors other than micro and small enterprises": "tpo", "Loans repayable on demand from banks": "stb", "Cash credit from bank": "stb", "Bank overdraft": "stb", "Bank loans": "stb",
  "Current maturities of long-term borrowings": "stb", "Bank charges": "exp", "Interest income": "oth", "Provision for income tax": "stp", "Tax expense - Current tax": "cur", "Deferred tax": "def",
  "Share application money pending allotment": "sapp", "Surplus in P&L": "rs", "Cash and bank balances": "cash", "Trade payables": "tpo", "Total": "-", "Microsoft licence": "" };
const gw = Object.entries(G).filter(([l, k]) => A.guessHead(l) !== k);
ok(!gw.length, "each to its head (" + gw.map(([l]) => l + " => " + A.guessHead(l)).join("; ") + ")");
console.log("3, 5. the lines kept; in no head; the file's totals");
const up = { file: "made-up.csv", sheet: "Sheet1", cols: { label: 0, cy: 1, py: 2 }, lines: [{ label: "Share capital", cy: 100, py: 100 }, { label: "Odd line", cy: 50, py: 0 }, { label: "Cash", cy: 150, py: 100 }, { label: "Bad", cy: NaN, py: 1 }, { label: "Total", cy: 150, py: 100 }],
  map: { 0: "sc", 2: "cash", 4: "-" }, guessed: { 0: true, 2: true, 4: true } };
const b = A.fromUpload(up), f = A.figures(b, {});
ok(b.unmapped.length === 1 && b.unmapped[0].label === "Odd line" && b.unmapped[0].cy === 50 && b.bad.includes("Bad"), "a line with an amount and no head: listed; a cell not an amount: said");
const ck = A.checks(f, { lastFy: "2024-25", unmapped: b.unmapped, totals: A.totalChecks(f, b.totals), bad: b.bad, udin: "26012345ABCDEF1234" });
const by = Object.fromEntries(ck.map((c) => [c.key, c]));
ok(by.unmapped && by.unmapped.ok === false && /Not in any head: 1 line, ₹50/.test(by.unmapped.text), "the check: not in any head, with the amount (" + (by.unmapped || {}).text + ")");
ok(by.total0 && by.total0.ok === true && by.bad && by.bad.ok === false, "the file's own total checked; the bad cell said");
ok(!JSON.stringify(up).includes('"rows"'), "what is kept: the lines, not the file's cells");
console.log("8. tolerance, UDIN");
const t = A.figures({ cy: { sc: 100, cash: 100.004 }, py: {}, src: {} }, {}), t2 = A.figures({ cy: { sc: 100, cash: 100.01 }, py: {}, src: {} }, {});
ok(A.checks(t, { lastFy: "x" }).find((c) => c.key === "bs").ok === true && A.checks(t2, { lastFy: "x" }).find((c) => c.key === "bs").ok === false, "the tally: equal within half a paisa, one paisa off is not");
ok(A.udinOk("26012345ABCDEF1234") && !A.udinOk("2601234") && !A.udinOk("ABCDEFGH1234567890") && A.checks(t, { lastFy: "x", udin: "123" }).find((c) => c.key === "udin").ok === false, "the UDIN: 18 characters, 8 digits first");
console.log("7. the CSV");
const csv = A.csvOf([["=HYPERLINK(\"x\")", 1], ["+1", "@a", "-2", -3], ["\tx", "plain"]]);
ok(csv.startsWith("\"'=HYPERLINK(\"\"x\"\")\",1") && /'\+1,'@a,'-2,-3/.test(csv) && /'\tx,plain/.test(csv), "a cell that looks like a formula: written with ' first; numbers as numbers");
console.log("a CSV as UTF-8");
const require = createRequire(import.meta.url), XLSX = require("../../assets/xlsx.js");
const wb = XLSX.read("Particulars,2026,2025\nTrade payables,\"₹ 5,000\",\"4,000\"\n", { type: "string", raw: true }), rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
ok(rows[1][1] === "₹ 5,000" && A.num(rows[1][1]) === 5000, "₹ kept as written, read as 5,000 (" + rows[1][1] + ")");
done();
