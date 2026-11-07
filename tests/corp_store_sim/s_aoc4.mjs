// the round-3 review of e5c302c5a (probe3): the balance sheet sheet told by its name, nil statements held, rounding by the
// lines and the unit, the P&L sheet's own columns (made-up figures)
import { ok, done } from "./harness.mjs";
const A = await import("../../app/src/screens/corp/aoc4.js");
const run = (up) => { const b = A.fromUpload(up), f = A.figures(b, {}); const t = A.totalChecks(f, b.totals); return { b, f, t, ck: A.checks(f, { lastFy: "x", udin: "26012345ABCDEF1234", totals: t, unmapped: b.unmapped, bad: b.bad, unit: b.unit, nLines: b.nLines }) }; };
const one = (rows, unit) => { const u = A.linesOf("f", "s", rows, { label: 0, cy: 1, py: 2 }); if (unit) u.unit = unit; return run(u); };
const key = (r, k) => r.ck.find((c) => c.key === k);
console.log("1. the balance sheet by its name; nothing nil goes Ready");
const sheets = [{ name: "Cover", rows: [["ABC Pvt Ltd (made-up)"], ["Financial statements FY 2025-26"]] }, { name: "Balance Sheet", rows: [["Particulars", "As at 31-03-2026", "As at 31-03-2025"], ["Share capital", "100", "100"], ["Cash", "100", "100"], ["Total", "100", "100"]] },
  { name: "Profit and Loss", rows: [["Particulars", "2025-26", "2024-25"], ["Revenue from operations", "500", "0"], ["Other expenses", "400", "0"], ["Total expenses", "400", "0"], ["Profit for the year", "100", "0"]] }];
const g = A.guessSheets(sheets);
ok(g.bs === "Balance Sheet" && g.pl === "Profit and Loss", "a cover first: the balance sheet and the P&L told by their names (" + JSON.stringify(g) + ")");
ok(JSON.stringify(A.guessSheets([{ name: "Sheet1", rows: [["Notes to the balance sheet and statement of profit and loss"], ["Share capital", "100", "100"], ["Cash", "100", "100"]] }, { name: "Sheet2", rows: [["Revenue from operations", "500", "0"], ["Other expenses", "400", "0"]] }])) === JSON.stringify({ bs: "Sheet1", pl: "Sheet2" }), "no names: by the first lines, then by the P&L's heads");
const cover = run(A.linesOfSheets("f", sheets, "Cover", ""));
ok(key(cover, "bsNil") && key(cover, "bsNil").ok === false && key(cover, "plNil").ok === false, "the cover read as the statements: the balance sheet nil (held), the P&L missing (held)");
const bsOnly = one([["Share capital", "100", "100"], ["Cash", "100", "100"]]);
ok(!key(bsOnly, "bsNil") && /the P&L sheet is missing/.test(key(bsOnly, "plNil").text), "a balance sheet only: the P&L sheet said missing (" + key(bsOnly, "plNil").text + ")");
const both = run(A.linesOfSheets("f", sheets, g.bs, g.pl));
ok(!key(both, "bsNil") && !key(both, "plNil") && key(both, "bs").ok, "both sheets: nothing nil, tallies");
console.log("2. rounding by the lines and the unit");
const six = one([["Share capital", "18.02", "1"], ["Cash", "3.004", "0"], ["Trade receivables", "3.004", "0"], ["Inventories", "3.004", "0"], ["Other current assets", "3.004", "0"], ["Short-term loans and advances", "3.004", "0"], ["Current investments", "3.0", "1"], ["Total current assets", "18.02", "1"]], 100000);
ok(six.t[0].ok === true && key(six, "bs").ok, "six lines rounded in lakhs: the total and the tally agree");
const edge = one([["Share capital", "18.03", "1"], ["Cash", "12.34", "1"], ["Trade receivables", "5.67", "0"], ["Total current assets", "18.03", "1"]], 100000);
ok(edge.t[0].ok === false && key(edge, "bs").ok === false, "₹2,000 off in lakhs over 2-3 lines: more than half a lakh-paisa a line, held (" + key(edge, "bs").text + ")");
const near = one([["Share capital", "18.02", "1"], ["Cash", "12.34", "1"], ["Trade receivables", "5.67", "0"]], 100000);
ok(key(near, "bs").ok === true && /rounding difference ₹1,000/.test(key(near, "bs").text), "₹1,000 off over 3 lines in lakhs: tallies, the rounding said (" + key(near, "bs").text + ")");
const rupees = one([["Share capital", "100", "100"], ["Cash", "99", "100"]]);
ok(key(rupees, "bs").ok === false, "in rupees: a rupee off does not tally");
console.log("3. the P&L sheet's own columns");
const pls = [{ name: "BS", rows: [["Share capital", "100", "100"], ["Cash", "100", "100"]] }, { name: "P&L", rows: [["Note", "Particulars", "FY26", "FY25"], ["1", "Revenue from operations", "500", "0"], ["2", "Other expenses", "400", "0"]] }];
const pc = A.linesOfSheets("f", pls, "BS", "P&L", null, { label: 1, cy: 2, py: 3 });
ok(pc.plCols.label === 1 && pc.lines.some((z) => z.label === "Revenue from operations" && z.cy === 500), "the P&L read with its own columns, kept (" + JSON.stringify(pc.plCols) + ")");
done();
