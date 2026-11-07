// the re-review of 700e4b5ff (stage 5): the reviewer's probes (rr2: p, n, z, big) as tests, on made-up figures
import { createRequire } from "module";
import { ok, done } from "./harness.mjs";
const A = await import("../../app/src/screens/corp/aoc4.js");
const require = createRequire(import.meta.url), XLSX = require("../../assets/xlsx.js");
const rd = (csv) => XLSX.utils.sheet_to_json(XLSX.read(csv, { type: "string", raw: true }).Sheets.Sheet1, { header: 1, raw: true, defval: "", blankrows: false });
console.log("1, 8. amounts (n)");
const N = { "1,000/-": 1000, "Rs. 1,000/-": 1000, "Nil": 0, "nil": 0, "--": 0, "-₹1,000": -1000, "₹-1,000": -1000, "(₹1,000)": -1000, "(-1,000)": -1000, "-(1,000)": -1000, "Dr. 500": 500, "500 Dr.": 500, "Cr 1,000": -1000, "1,000.00 CR": -1000, "₹ 1,000 Cr": -1000, "1,000.": 1000, ".5": 0.5, "0.00": 0 };
const nw = Object.entries(N).filter(([s, v]) => A.num(s) !== v);
ok(!nw.length, "read as written (" + nw.map(([s]) => s + " -> " + A.num(s)).join("; ") + ")");
const J = ["1,0,0", "12abc", "1e5", "100%", "$100", "1,000 C", "(1,000", true];
ok(J.every((s) => isNaN(A.num(s))), "not amounts: " + J.filter((s) => !isNaN(A.num(s))).join(", "));
ok(A.amount("Cr 1,000").mark === "cr" && A.amount("500 Dr.").mark === "dr" && A.amount("1,000").mark === "", "the Cr / Dr mark kept");
console.log("1. a heading, or not an amount (p, z)");
let L = A.linesOf("f", "s", [["Share capital", "12abc", ""], ["Reserves", "12abc", "1e5"], ["Cash", "1,000", "12abc"], ["Particulars", "31-03-2026", "As at 31-03-2025"], ["Notes", "", ""]], { label: 0, cy: 1, py: 2 }).lines;
ok(L.slice(0, 3).every((z) => isNaN(z.cy) || isNaN(z.py)) && L[2].cy === 1000 && L[3].cy === 0 && L[3].py === 0 && !isNaN(L[3].cy), "junk with digits: not an amount; the column titles a heading");
const zr = [["Particulars", "31-03-2026", "31-03-2025"], ["Share capital", "1,00,000/-", "1,00,000/-"], ["Trade payables", "50,000/-", "Nil"], ["Cash and bank balances", "1,50,000/-", "1,00,000/-"], ["Revenue from operations", "5,00,000/-", "4,00,000/-"]];
const zu = A.linesOf("f", "s", zr, A.autoCols(zr)), zf = A.figures(A.fromUpload(zu), {});
ok(zf.tot.cy.TL === 150000 && zf.tot.cy.TA === 150000 && zf.cy.rev === 500000, "1,00,000/- and Nil read (z): not all zeros (" + JSON.stringify(zf.tot.cy) + ")");
const zb = A.fromUpload({ lines: [{ label: "Share capital", cy: NaN, py: 1 }], map: { 0: "sc" } });
ok(zb.bad.length === 1, "a NaN cell: said (Next and Ready wait)");
console.log("2. Cr / Dr by the head's side; a plain Total by its section");
const tb = [["Share capital", "1,00,000 Cr", "1,00,000 Cr"], ["Trade payables", "50,000 Cr", "40,000 Cr"], ["Cash", "1,50,000 Dr", "1,40,000 Dr"], ["Total", "1,50,000", "1,40,000"], ["Sales", "5,00,000 Cr", "4,00,000 Cr"], ["Other expenses", "5,00,000 Dr", "4,00,000 Dr"]];
const tu = A.linesOf("f", "s", tb, { label: 0, cy: 1, py: 2 }), tbu = A.fromUpload(tu), tf = A.figures(tbu, {});
ok(tf.cy.sc === 100000 && tf.cy.tpo === 50000 && tf.cy.cash === 150000 && tf.cy.rev === 500000 && tf.cy.exp === 500000, "liabilities and income Cr positive, assets and expenses Dr positive (" + [tf.cy.sc, tf.cy.tpo, tf.cy.cash, tf.cy.rev, tf.cy.exp] + ")");
const tc = A.totalChecks(tf, tbu.totals);
ok(tc.length === 1 && tc[0].ok, "the plain Total after the assets: the total assets (" + JSON.stringify(tbu.totals) + ")");
const wrongSide = A.fromUpload({ lines: [{ label: "Trade payables", cy: 5000, cm: "dr", py: 0 }], map: { 0: "tpo" } });
ok(wrongSide.cy.tpo === -5000, "a liability marked Dr: negative");
console.log("8. subtotals with their own sums");
const f2 = A.figures({ cy: { sc: 100, tpo: 50, cash: 150 }, py: {}, src: {} }, {});
const sc = A.totalChecks(f2, [{ label: "Total current liabilities", cy: 50, py: 0 }, { label: "Total current assets", cy: 150, py: 0 }, { label: "Total tax expense", cy: 0, py: 0 }, { label: "Total current liabilities", cy: 150, py: 0 }, { label: "Sub-total", cy: 5, py: 0 }]);
ok(sc.length === 5 && sc[0].ok && sc[1].ok && sc[2].ok && sc[3].ok === false && sc[4].ok === null && sc[4].warn, "current liabilities with current liabilities only; a Sub-total that cannot be told: said, not held");
console.log("7. columns");
ok(JSON.stringify(A.autoCols(rd("Particulars,Note,As at 31-03-2026,As at 31-03-2025\nShare capital,3,\"1,00,000.00\",\"1,00,000.00\"\nReserves and surplus,4,\"(25,000.00)\",\"10,000.00\"\nTrade payables,6,\"5,000\",\"4,000\"\n"))) === JSON.stringify({ label: 0, cy: 2, py: 3 }), "the Note column left out");
console.log("3. large ranges (big)");
let t = Date.now();
for (const ref of ["A1:AZ20000", "A1:AD1048576"]) { const ws = XLSX.utils.aoa_to_sheet([["Share capital", 100, 90]]); ws["!ref"] = ref; const r = A.sheetLines(XLSX, ws); ok(r.length === 1 && r[0].length <= 30, ref + ": one line, 30 columns at most"); }
ok(Date.now() - t < 2000, "quick (" + (Date.now() - t) + " ms)");
console.log("6. heads");
const G = { "Interest on term loan": "fin", "Interest on cash credit": "fin", "Interest on bank loans": "fin", "Interest on income tax": "fin", "Interest income": "oth", "Interest accrued on fixed deposits": "oca",
  "Interest accrued but not due on borrowings": "ocl", "Secured loans from bank": "stb", "Term loans": "ltb", "Cash credit from bank": "stb", "Bank overdraft": "stb", "Depreciation on fixed assets": "dep", "Amortisation of intangible assets": "dep",
  "Income tax refund receivable": "oca", "Advance income tax (net of provision)": "stla", "Loans and advances to employees": "stla", "Inventories: work-in-progress": "inv", "Work-in-progress": "inv", "Capital work-in-progress": "cwip",
  "Loss on sale of fixed assets": "exp", "Profit on sale of investments": "oth", "Loss for the year": "-", "Grand total": "-", "Sub-total": "-" };
const gw = Object.entries(G).filter(([l, k]) => A.guessHead(l) !== k);
ok(!gw.length, "each to its head (" + gw.map(([l]) => l + " => " + A.guessHead(l)).join("; ") + ")");
console.log("8. what is in no head: both years");
const un = A.checks(A.figures({ cy: {}, py: {}, src: {} }, {}), { lastFy: "x", unmapped: [{ label: "Odd", cy: 10, py: 20 }] }).find((c) => c.key === "unmapped");
ok(/₹10 this year, ₹20 last year/.test(un.text), un.text);
done();
