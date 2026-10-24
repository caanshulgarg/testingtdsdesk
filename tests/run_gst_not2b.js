// node run_gst_not2b.js [out.json] - credit kept in an input ledger "NOT SHOWN IN 2B" until 2B shows the bill (the owner,
// 24-Oct-2026: the server's GST figures and GSTR-9 8C / 13 the same way as the app's 3B since commit c326262). Made-up
// books (fixtures/gst_not2b_books.json) shaped like the client's: bills booked as journals to the held ledger, moved to
// Input IGST / CGST / SGST by journal when 2B shows them (by the bill's number, in the narration, or by no number at all),
// the month-end set-off with a rounding line under Indirect Expenses, an old held credit written off to an expense, a held
// credit rounded off. Worked out by hand:
//   1. 3B 4(A)(5) month by month is the input ledgers' movement: a held bill takes nothing until moved; the move takes it
//      once; the set-off, the write-off and the rounding take nothing and never make credit negative
//   2. GSTR-9 2025-26, 8C and 13: the credit of 2025-26's bills taken in Apr-Nov 2026: the bill booked in April 2026 with
//      a March reference date (900 + 900), and the held March bills moved in April and May 2026 (2 x 2,02,500 IGST,
//      350.28 + 350.28); not the held bill of May 2026 moved in June (6,654.60), not the held bills moved in December
//      (8,388 and 900, after November)
// With a path, the app's figures are written there (run_migration105.py compares the server's summary with them).
const fs = require("fs"), path = require("path"), {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "GST9", "INR",
  "normName", "nameSim", "ITCT", "GSTSet", "CustIMS", "GSTF", "GSTQ"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const {ctx, x} = load(HTML, NAMES);
const F = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "gst_not2b_books.json"), "utf8"));
const CMP = F.gstin, reg = CMP.slice(0, 2), G = x.GSTR, H = ["igst", "cgst", "sgst"];
ctx.S.companies = {t: {id: "t", name: "Zeta Brokers", gstin: CMP, choices: {}}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t;
const vs = F.vouchers.map(([id, date, type, no, refDate, narr, ent]) => ({id, date, type, no, ref: "", refDate, narr, party: "", gstin: "", pos: "", cmp: CMP, hsn: [], ent: ent.map(([l, a]) => ({l, a}))}));
const b = {cid: "t", vouchers: vs, meta: {from: F.from, to: "20261231", gstins: [CMP], bills: 1}, under: F.under, groups: F.groups, gstins: {}, states: {}, challans: [], alloc: {}, certs: [], twoBs: {}};
b.map = x.Books.mapLedgers(vs, {});
Object.keys(b.map).forEach(n => { if (!F.map[n]) b.map[n] = Object.assign(b.map[n], {what: "none", kind: "", ok: true, byHand: true}); });
Object.entries(F.map).forEach(([n, o]) => { b.map[n] = Object.assign(b.map[n] || {n: 0}, o, o.kind === "gst" || o.kind === "tax_other" ? {reg} : {}, {ok: true, byHand: true}); });
ctx.S.books = b; G._carry = null; x.GST2B._memo = null;
const f = o => H.map(h => Math.round(((o || {})[h] || 0) * 100) / 100).join("/"), near = (a, c) => Math.abs((a || 0) - c) < 0.01;
// ---- 1. 3B, month by month
const months = {};
G.months().forEach(m => { const t = G.threeBm(m, reg); months[m] = {igst: x.r2(t.other.igst), cgst: x.r2(t.other.cgst), sgst: x.r2(t.other.sgst), cess: x.r2(t.other.cess || 0)}; });
const want = {"202504": [0, 900, 900], "202509": [0, 0, 0], "202510": [18000, 0, 0], "202603": [0, 0, 0], "202604": [202500, 800.28, 800.28], "202605": [202500, 0, 0], "202606": [6654.6, 0, 0], "202612": [9288, 0, 0]};
Object.entries(want).forEach(([m, w]) => ok(H.every((h, i) => near((months[m] || {})[h], w[i])), m + " 4(A)(5) " + w.join("/") + " (" + f(months[m]) + ")"));
ok(Object.values(months).every(o => H.every(h => o[h] > -0.005)), "never negative credit: not from the set-off with a rounding line (Apr-2025), the write-off (journal 658) or the held rounding (Mar-2026)");
// ---- 2. GSTR-9 for 2025-26
const d = x.GST9.build("2025", reg), c8 = d.T["8C"], t13 = d.T["13"];
ok(near(c8.igst, 405000) && near(c8.cgst, 800.28) && near(c8.sgst, 800.28), "8C: IGST 4,05,000 (two held March bills moved in April and May), CGST and SGST 800.28 (450 of the bill booked in April for March, 350.28 moved) (" + f(c8) + ")");
ok(f(t13) === f(c8), "13 is 8C (" + f(t13) + ")");
ok(near(c8.igst, 405000), "not in 8C: the May-2026 bill moved in June (6,654.60), the March bills moved in December (8,388; 900 booked in April for March)");
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({months, c8, t13}));
console.log(fails ? "\n" + fails + " FAILED" : "\nall ok"); process.exit(fails ? 1 : 0);
