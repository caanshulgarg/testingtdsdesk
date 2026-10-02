// node run_adv_11b.js - review of 02-Oct-2026, QRMP quarter Q2 2026-27 of Testing AAD: "Advances (11A less 11B)
// -22,881.36" with no invoice, and 3B 3.1(a) differing by the same. It is one advance marked by hand (advFix, on staging)
// as adjusted in Sep-2026: receipt 13 of 15-Apr-2025 from LEADS INSURANCE BROKERS PRIVATE LIMITED, 27,000 against bill
// 2023-24/GST/591 (27,000 less 18% inside = 22,881.36). An 11B adjustment needs an invoice to the customer in the same
// return period; without one it is listed apart with what is missing, never as a negative in GSTR-1.
// Uses tests/data/books-cache.json (client data, not in git).
const fs = require("fs"), {load, HTML, CACHE} = require("./harness");
const {ctx, x} = load(HTML, ["num", "r2", "INR", "STATE_CODES", "ledNm", "ledEnt", "ledClean", "ledKey", "LED_IDX", "ledIdx", "ledLook", "ledUnder", "ledGroupPath", "LedMaster", "Books", "GSTR", "GSTAdv"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
ctx.fmtDate = d => String(d || "");
if (!fs.existsSync(CACHE)){ console.log("no books cache: skipped"); process.exit(0); }
const books = JSON.parse(fs.readFileSync(CACHE, "utf8"));
books.cid = "t"; books.map = x.Books.mapLedgers(books.vouchers, {});
ctx.S.books = books;
const piece = () => x.GSTAdv.build().pieces.find(p => p.party === "LEADS INSURANCE BROKERS PRIVATE LIMITED" && p.date === "20250415" && p.ref === "2023-24/GST/591");
const p0 = piece();
ok(p0 && p0.amount === 27000 && p0.no === "13", "the advance: receipt 13 of 15-Apr-2025, LEADS INSURANCE BROKERS, 27,000 against 2023-24/GST/591");
books.advFix = {[p0.id]: {adjYm: "202609"}};                                   // as kept on staging
x.GSTAdv._memo = null;
const m = x.GSTAdv.month("202607-202609", "09");
ok(m.txpd.length === 0 && m.net.taxable === 0, "Q2 2026-27: nothing in 11B and nothing negative into 3.1(a) or GSTR-1 (net taxable " + m.net.taxable + ")");
ok(m.unmatched.length === 1 && m.unmatched[0].taxable === 22881.36 && /no invoice to LEADS INSURANCE BROKERS PRIVATE LIMITED/.test(m.unmatched[0].missing), "the -22,881.36: listed apart, with what is missing (" + (m.unmatched[0] || {}).missing + ")");
const j = x.GSTR.toJson ? (() => { try { return x.GSTR.toJson("202607-202609", "09"); } catch (e){ return null; } })() : null;
ok(!j || !j.txpd, "the GSTR-1 JSON for the quarter has no txpd");
// with an invoice to the customer in that month, the adjustment is 11B as before
books.vouchers.push({id: "t-inv", date: "20260915", type: "Sales", no: "T/1", party: "LEADS INSURANCE BROKERS PRIVATE LIMITED", gstin: "", pos: "Uttar Pradesh", cmp: "09AANFG3202D1ZR", hsn: ["9982"],
  ent: [{l: "LEADS INSURANCE BROKERS PRIVATE LIMITED", a: -29500, b: [["T/1", "New Ref", -29500]]}, {l: "OUTPUT CGST", a: 2250}, {l: "OUTPUT SGST", a: 2250}, {l: "Professional Fee", a: 25000, gr: 18, h: "9982"}]});
x.GSTAdv._memo = null;
const m2 = x.GSTAdv.month("202609", "09");
ok(m2.txpd.length === 1 && m2.txpd[0].taxable === 22881.36 && m2.unmatched.length === 0, "with an invoice to LEADS in Sep-2026 it is adjusted in 11B (22,881.36)");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
