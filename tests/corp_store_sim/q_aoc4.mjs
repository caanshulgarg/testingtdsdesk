// the independent review of next-corporate-s5 (a39151cac): the probe (scratchpad/probe.mjs) as tests, on made-up figures
import { ok, done } from "./harness.mjs";
const A = await import("../../app/src/screens/corp/aoc4.js");
console.log("3. column titles are headings; a line Not used is not read");
const hdr = [["Particulars", "2025-26", "2024-25"], ["", "31 March 2026", "March 31, 2026"], ["", "31st March 2026", "(₹ in '000)"], ["", "Amount (₹)", "Amount (₹)"], ["Share capital", "100", "100"], ["Cash", "100", "100"]];
const u = A.linesOf("f", "s", hdr, { label: 0, cy: 1, py: 2 });
ok(u.lines.length === 3 && u.lines[0].cy === 0 && u.lines[0].py === 0 && u.lines[1].cy === 100 && !A.fromUpload(u).bad.length, "dates, 2025-26, '000 and Amount (₹) read as headings (the ones with no words left out), no bad cell");
const u2 = { lines: [{ label: "Odd", cy: NaN, py: NaN }, { label: "Cash", cy: 5, py: 5 }], map: { 0: "-", 1: "cash" } };
ok(!A.fromUpload(u2).bad.length, "a line mapped to Not used: its cells are not read");
console.log("6. the unit");
const lk = [["Balance sheet (₹ in lakhs)", "", ""], ["Share capital", "1.50", "1.00"], ["Cash", "1.50", "1.00"]];
const ul = A.linesOf("f", "s", lk, { label: 0, cy: 1, py: 2 }), fl = A.fromUpload(ul);
ok(ul.unit === 100000 && fl.cy.sc === 150000 && fl.cy.cash === 150000, "(₹ in lakhs) found: amounts in rupees (" + fl.cy.sc + ")");
ok(A.unitOf([["(Rs. in '000)"]]) === 1000 && A.unitOf([["Amounts in crores"]]) === 10000000 && A.unitOf([["in thousands"]]) === 1000 && A.unitOf([["Particulars"]]) === 1, "'000, crores, thousands, none");
ok(A.fromUpload(Object.assign({}, ul, { unit: 1 })).cy.sc === 1.5, "the unit chosen by hand is used");
console.log("9. amounts");
ok(A.num("Nil/-") === 0 && A.num("Rs. Nil") === 0 && A.num("₹ -") === 0 && isNaN(A.num("12 34")) && isNaN(A.num("1 000")) && A.num("- 1,000") === -1000 && A.num("1,000 /-") === 1000, "Nil/-, Rs. Nil, ₹ - nil; 12 34 refused");
console.log("4. the P&L totals and the profit line");
const f = A.figures({ cy: { sc: 100, rs: 50, cash: 150, rev: 100, exp: 20 }, py: {}, src: {} }, {});
const tc = A.totalChecks(f, [{ label: "Total expenses", cy: 999, py: 0, sec: "EXP" }, { label: "Total income", cy: 100, py: 0, sec: "INC" }, { label: "Profit for the year", cy: 80, py: 0 }, { label: "Profit before tax", cy: 70, py: 0 }]);
ok(tc.length === 4 && !tc[0].ok && tc[1].ok && tc[2].ok && !tc[3].ok, "total expenses, total income, profit for the year, profit before tax each against its own (" + tc.map((t) => t.ok) + ")");
const pl = A.linesOf("f", "s", [["Revenue from operations", "100", "0"], ["Profit for the year", "80", "0"]], { label: 0, cy: 1, py: 2 });
ok(pl.totals.length === 1 && pl.totals[0].label === "Profit for the year", "the file's profit line kept to compare");
console.log("5. heads: a liability's words win");
const G = { "Cost of raw materials consumed": "mat", "Raw materials consumed": "mat", "(Increase)/decrease in inventories": "chg", "Increase in inventories": "chg", "Outstanding expenses": "ocl", "Salary payable": "ocl", "Expenses payable": "ocl",
  "Audit fees payable": "ocl", "Provision for expenses": "stp", "Provision for employee benefits": "stp", "Income tax payable": "stp", "Advances recoverable in cash or kind": "stla", "Rent deposit": "onca", "Security deposits": "onca",
  "Trade payables - MSME": "tpm", "Trade payables": "tpo", "Duties & taxes": "ocl", "Loans and advances from related parties": "ltb", "Security premium": "rs", "Capital reserve": "rs", "Balance in statement of profit and loss": "rs", "Raw materials": "inv" };
const gw = Object.entries(G).filter(([l, k]) => A.guessHead(l) !== k);
ok(!gw.length, "each to its head (" + gw.map(([l]) => l + " => " + A.guessHead(l)).join("; ") + ")");
done();
