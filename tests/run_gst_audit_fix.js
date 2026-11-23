// node tests/run_gst_audit_fix.js - the GST audit's confirmed defects (track "gst", next-fix-audit-gst), each on its own
// made-up books (no real client, GSTIN, PAN or file), worked out by hand:
//   1. 3.1 (GSTR.sec31, threeBm, entryShares): a credit note on an export under LUT or on an exempt sale comes off its
//      own class (3.1(b) / 3.1(c)), not off 3.1(a). Books of October 2025: a B2C sale 50,000 (CGST/SGST 4,500), an export
//      under LUT 1,00,000, a credit note of 10,000 on it, an exempt sale 20,000 and a credit note of 5,000 on it, an export
//      with IGST 40,000 (IGST 7,200) and a credit note of 4,000 on it (IGST 720): 3.1(a) 50,000 (CGST 4,500), 3.1(b)
//      1,26,000 (IGST 6,480), 3.1(c) 15,000; each entry's shares summed are the same
//      the GSTR-1 JSON's export items without payment carry iamt (0), not camt/samt (a gap of the audit)
//   2. a negative head in 3.1 (credit notes above the sales) is carried as negative liability (the portal's Negative
//      Liability Statement) and set against the next month's tax of the same head: October CGST/SGST 1,800 on sales,
//      4,500 on a credit note (net -2,700 each); November 3,600 each, no credit: November's cash 900 each
//   3. a bill matched in 2B with "ITC not available" (itcavl N: section 16(4), place of supply) is not claimed in 4(A)(5):
//      December 2025, P/77 IGST 18,000 (2B: N), P/78 IGST 1,800 (2B: Y), P/79 booked in November (no 2B then) IGST 900,
//      December's 2B says N: December's 4(A)(5) IGST 900 (19,800 booked less 18,000 less 900), 4(D)(2) 18,900; the
//      Final credit for 3B (app/src/lib/itcFinal.js) the same
//   4. GSTR-9 for a QRMP client: Q1 2025-26, each month CGST/SGST 1,000 out and 400 credit; June's 3B kept as filed (the
//      quarter): 6A CGST 1,200 and table 9 CGST 3,000, as before it was kept (not 2,000 and 5,000)
//   5. GSTR-9 table placement: a credit note on an LUT export goes to 5H (not 4I), a debit note on an exempt supply to 5I
//      (not 4J, and not in 5D): 4I 0, 4J 0, 5D 20,000, 5H 10,000, 5I 5,000, 5M 1,15,000
//   6. rule 42 (low): D2 (rule 42(1)(g)) is off unless the CA says common credit is used for non-business purposes;
//      outward supplies on reverse charge are exempt turnover for rule 42 (section 17(3))
//   7. 3B late fee (low): a nil return is one with no tax payable (Notification 19/2021-CT), whatever the credit
//   8. the GSTR-1 bills Excel carries cess: a Cess column, and the row Total over taxable, IGST, CGST, SGST and cess
//   re-review (next-fix-audit-gst, second pass):
//   1b. our credit notes rejected by the customer in IMS are added back in the class they came off (an SEZ unit's note
//      to 3.1(b), an exempt supply's to 3.1(c)), not all to 3.1(a); the R3B bill breakdown the same
//   1c. a negative 3.1(c) value (a credit note on an earlier month's exempt sale) and 3.1(b) IGST (not in FinCom's 6.1
//      set-off) are shown as "Needs you" (r3bNeeds)
//   3b. GSTR-9 heldEnd leaves out credit 2B says is not available (held for good, not "held back for 2B")
//   4b. GSTR-9 QRMP: the quarter's 3B kept as filed counts when the quarter's last month is not in the books
//   6b. D2: not answered, but a 3B already filed reversed D2: it stays on until the CA says
//   7b. nil 3B: 3.1(b) IGST payable (an export with payment) is tax payable: not nil
//   9. PMT-06 (self-assessment): the quarter's second month starts from what the first month left of the credit
//  10. (release review 23-Nov-2026) a marketplace invoice kept in Sales (Amazon, Flipkart, Shopify; source "market") is
//      counted exactly once, before and after it is posted to Tally: GSTR-1 tables 4/7 and 14, 3B 3.1(a), rule 42's
//      turnover. October 2025: a B2C sale S/1 50,000 (CGST/SGST 4,500) in the books; AMZ-21 (Amazon, 10,000, IGST
//      1,800), FK-31 (Flipkart, 5,000, IGST 900) and SH-41 (the client's own Shopify store, 2,000, IGST 360) in Sales:
//      3.1(a) 67,000 (IGST 3,060), table 14 Amazon 10,000 and Flipkart 5,000 (u/s 52), never Shopify (no e-commerce
//      operator: the owner, 23-Nov-2026). Then posted with the books not read again, posted and in the books (AMZ-21 by
//      its tag, FK-31 by the cloud copy's fincom_id with a 60-character buyer cutting the tag off the narration, SH-41
//      intally by its number and date), and AMZ-21's entry deleted in Tally since (What to fix says so): the same.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
process.env.TZ = process.env.TZ || "Asia/Kolkata";
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "GST9", "INR",
  "normName", "nameSim", "ITCT", "GSTSet", "CustIMS", "GSTF", "GSTQ", "ITCLock", "entryShares", "BookSrc"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const {ctx, x} = load(HTML, NAMES);
const CMP = "07AAKCT5678M1Z9", reg = "07", G = x.GSTR, H = ["igst", "cgst", "sgst", "cess"];
ctx.S.companies = {t: {id: "t", name: "Tamarind Test Traders", gstin: CMP, choices: {}}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t;
ctx.saveBooks = () => {}; ctx.render = () => {}; ctx.Cloud = {st: {email: "test@zz.test"}};
const near = (a, c) => Math.abs((a || 0) - c) < 0.01, f = (o) => H.map((h) => Math.round(((o || {})[h] || 0) * 100) / 100).join("/");
const GA = "07AABCA1111A1Z1", GB = "06AABCB2222B1Z2";
let k = 0;
// a sale (or a credit / debit note to a customer): Tally's sign, debit negative
const out = (type, date, no, party, gstin, taxable, t, o) => { const tot = taxable + (t.igst || 0) + (t.cgst || 0) + (t.sgst || 0), s = /CREDIT/i.test(type) ? -1 : 1;
  return Object.assign({id: "v" + (++k), type, date, no, party, gstin, pos: "", cmp: CMP, narr: "", hsn: [], cancel: false, opt: false,
    ent: [{l: party, a: -s * tot}, {l: "Sales", a: s * taxable}].concat(["igst", "cgst", "sgst"].filter((h) => t[h]).map((h) => ({l: h.toUpperCase(), a: s * t[h]})))}, o || {}); };
const buy = (date, no, party, gstin, taxable, t, o) => { const tot = taxable + (t.igst || 0) + (t.cgst || 0) + (t.sgst || 0);
  return Object.assign({id: "v" + (++k), type: "Purchase", date, no, ref: no, refDate: date, party, gstin, pos: "", cmp: CMP, narr: "", hsn: [], cancel: false, opt: false,
    ent: [{l: "Office Expenses", a: -taxable}].concat(["igst", "cgst", "sgst"].filter((h) => t[h]).map((h) => ({l: "Input " + h.toUpperCase(), a: -t[h]})), [{l: party, a: tot}])}, o || {}); };
function books(vs, twoBs){
  const ds = vs.map((v) => v.date).sort();
  const b = {cid: "t", vouchers: vs, meta: {from: ds[0].slice(0, 6) + "01", to: ds[ds.length - 1], gstins: [CMP], bills: 1}, under: {}, groups: {"Sundry Creditors": "Current Liabilities", "Sundry Debtors": "Current Assets", "Sales Accounts": "Primary", "Indirect Expenses": "Primary"},
    gstins: {}, states: {}, challans: [], alloc: {}, certs: [], twoBs: twoBs || {}, gstOpen: {[reg]: {igst: 0, cgst: 0, sgst: 0, cess: 0}}};
  vs.forEach((v) => { b.under[v.party] = Books.isSale(v) ? "Sundry Debtors" : "Sundry Creditors"; if (v.gstin) b.gstins[v.party] = v.gstin; });
  b.under.Sales = "Sales Accounts"; b.under["Office Expenses"] = "Indirect Expenses";
  b.map = x.Books.mapLedgers(vs, {});
  const set = (n, o) => { b.map[n] = Object.assign(b.map[n] || {n: 0}, o, {ok: true, byHand: true}); };
  ["IGST", "CGST", "SGST"].forEach((t) => { set(t, {what: "gst", kind: "gst", tax: t, side: "output", reg}); set("Input " + t, {what: "gst", kind: "gst", tax: t, side: "input", reg}); });
  ctx.S.books = b; G._carry = null; x.GST2B._memo = null; return b;
}
const Books = x.Books;
const T = (ym) => { G._carry = null; return G.threeBm(ym, reg); };
const row = (ym, gstin, party, no, date, taxable, t, itcavl, rsn) => ({no, noN: no.replace(/[^A-Z0-9]/gi, "").toUpperCase(), ym, dir: 1, ims: "N", key: ym.slice(4) + ym.slice(0, 4) + "|b2b|" + gstin + "|" + no + "|" + date,
  pos: reg, rcm: false, sec: "b2b", typ: "R", val: taxable + (t.igst || 0) + (t.cgst || 0) + (t.sgst || 0), cess: 0, cgst: t.cgst || 0, sgst: t.sgst || 0, igst: t.igst || 0, date, gstin, party, itcavl: itcavl || "Y", rsn: rsn || "", taxable});

// ---------------------------------------------------------------- 1. 3.1: credit notes in their own class
console.log("== 1. 3.1: a credit note comes off its own class");
{
  const vs = [out("Sales", "20251003", "S/1", "Walk-in Customers", "", 50000, {cgst: 4500, sgst: 4500}),
    out("Sales", "20251005", "E/1", "Oakridge Imports LLC", "", 100000, {}, {country: "United States"}),
    out("Credit Note", "20251012", "CN/1", "Oakridge Imports LLC", "", 10000, {}, {country: "United States"}),
    out("Sales", "20251014", "X/1", "Harbour Exempt Clinic", "", 20000, {}, {taxability: "Exempt"}),
    out("Credit Note", "20251016", "CN/2", "Harbour Exempt Clinic", "", 5000, {}, {taxability: "Exempt"}),
    out("Sales", "20251018", "E/2", "Kelpie Trading GmbH", "", 40000, {igst: 7200}, {country: "Germany"}),
    out("Credit Note", "20251020", "CN/3", "Kelpie Trading GmbH", "", 4000, {igst: 720}, {country: "Germany"})];
  books(vs);
  const t = T("202510");
  ok(near(t.net.taxable, 50000) && near(t.net.cgst, 4500) && near(t.net.igst, 0), "3.1(a) 50,000, CGST 4,500, IGST 0 (" + t.net.taxable + ", " + f(t.net) + ")");
  ok(near(t.zero.taxable, 126000) && near(t.zero.igst, 6480), "3.1(b) 1,26,000, IGST 6,480 (" + t.zero.taxable + ", " + t.zero.igst + ")");
  ok(near(t.nil.taxable, 15000), "3.1(c) 15,000 (" + t.nil.taxable + ")");
  ok(near(t.cn.taxable, 0), "the credit notes taken off 3.1(a): none of these is on a taxable supply (" + t.cn.taxable + ")");
  // the cloud's shares of each entry, summed: the same figures (gst-run's parity)
  const sums = {};
  vs.forEach((v) => x.entryShares(v, null).rows.forEach((r) => { const s = sums[r.sec] = sums[r.sec] || {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0}; ["taxable", "igst", "cgst", "sgst", "cess"].forEach((q) => { s[q] = x.r2(s[q] + r[q]); }); }));
  const P = G.sec31(G.outward("202510", reg), []);
  // (gap, small: an export or SEZ supply is inter-state, section 16 IGST Act: its items carry iamt, never camt/samt)
  const j = G.toJson("202510", reg, {plain: true}), wop = ((j.exp || []).find((e) => e.exp_typ === "WOPAY") || {}).inv || [];
  ok(wop.length && wop.every((i) => i.itms.every((q) => "iamt" in q.itm_det && !("camt" in q.itm_det))), "GSTR-1 JSON: an export without payment carries iamt 0, not camt/samt (" + JSON.stringify(wop.map((i) => i.itms)) + ")");
  ok(["cn", "zero", "nil"].every((q) => ["taxable", "igst", "cgst", "sgst"].every((h) => near(((sums["3B." + q]) || {})[h] || 0, P[q][h]))), "the shares of 3B.cn, 3B.zero and 3B.nil summed are sec31's (" + JSON.stringify(sums["3B.zero"]) + ")");
}

// ---------------------------------------------------------------- 1b. customer IMS: rejected notes added back in their class
console.log("== 1b. our credit notes rejected by the customer in IMS go back in their own class");
let T1B = null, B1B = null;
{
  const SZ = "07AABCS3333C1Z3", EC = "07AABCE4444D1Z4";
  const vs = [out("Sales", "20251003", "Z/1", "Sunrise SEZ Unit", SZ, 100000, {}, {regType: "SEZ"}),
    out("Credit Note", "20251010", "ZC/1", "Sunrise SEZ Unit", SZ, 10000, {}, {regType: "SEZ"}),
    out("Sales", "20251004", "Z/2", "Sunrise SEZ Unit", SZ, 20000, {igst: 3600}, {regType: "SEZ"}),
    out("Credit Note", "20251011", "ZC/2", "Sunrise SEZ Unit", SZ, 10000, {igst: 1800}, {regType: "SEZ"}),
    out("Sales", "20251005", "X/2", "Harbour Exempt Clinic", EC, 30000, {}, {taxability: "Exempt"}),
    out("Credit Note", "20251012", "XC/2", "Harbour Exempt Clinic", EC, 5000, {}, {taxability: "Exempt"}),
    out("Sales", "20251006", "S/2", "Walk-in Customers", "", 50000, {cgst: 4500, sgst: 4500})];
  books(vs);
  const t0 = T("202510");
  ok(near(t0.net.taxable, 50000) && near(t0.zero.taxable, 100000) && near(t0.zero.igst, 1800) && near(t0.nil.taxable, 25000), "before any rejection: 3.1(a) 50,000, 3.1(b) 1,00,000 (IGST 1,800), 3.1(c) 25,000 (" + t0.net.taxable + ", " + t0.zero.taxable + "/" + t0.zero.igst + ", " + t0.nil.taxable + ")");
  const st = x.CustIMS.store(reg), docs = x.CustIMS.docs(reg);
  ["ZC/1", "ZC/2", "XC/2"].forEach((no) => { const r = docs.find((d) => d.no === no); if (r) st[r.id] = {kind: "cn", no, date: r.date, party: r.party, gstin: r.gstin, rejYm: "202510", addYm: "202510", act: "rejected", remark: "", doneYm: "", at: "2025-10-25"}; });
  const t = T("202510"); T1B = t; B1B = {vs, outRej: JSON.parse(JSON.stringify(ctx.S.books.outRej))};
  ok(t.custRej.add.n === 3, "the three notes are rejected by the customers (" + t.custRej.add.n + ")");
  ok(near(t.net.taxable, 50000) && near(t.net.igst, 0) && near(t.net.cgst, 4500), "3.1(a) stays 50,000, IGST 0, CGST 4,500: none of the notes was on a taxable supply (" + t.net.taxable + ", " + f(t.net) + ")");
  ok(near(t.zero.taxable, 120000) && near(t.zero.igst, 3600), "3.1(b) 1,20,000, IGST 3,600: the SEZ unit's two notes added back there (" + t.zero.taxable + ", " + t.zero.igst + ")");
  ok(near(t.nil.taxable, 30000), "3.1(c) 30,000: the exempt supply's note added back there (" + t.nil.taxable + ")");
}

// ---------------------------------------------------------------- 2. negative liability carried
let NOV = null;
console.log("== 2. a negative head is carried to the next month (Negative Liability Statement)");
{
  books([out("Sales", "20251004", "S/11", "Walk-in Customers", "", 20000, {cgst: 1800, sgst: 1800}),
    out("Credit Note", "20251020", "CN/11", "Walk-in Customers", "", 50000, {cgst: 4500, sgst: 4500}),
    out("Sales", "20251110", "S/12", "Walk-in Customers", "", 40000, {cgst: 3600, sgst: 3600})]);
  const o = T("202510"), n = T("202511");
  ok(near(o.net.cgst, -2700) && near(o.pay.cash.cgst, 0), "October: CGST -2,700, nothing to pay (" + o.net.cgst + ", " + o.pay.cash.cgst + ")");
  ok(o.pay.carry.neg && near(o.pay.carry.neg.cgst, 2700) && near(o.pay.carry.neg.sgst, 2700), "October carries 2,700 CGST and SGST of negative liability (" + JSON.stringify(o.pay.carry.neg) + ")");
  ok(near(n.pay.cash.cgst, 900) && near(n.pay.cash.sgst, 900), "November: 3,600 less 2,700 carried: cash 900 each (" + f(n.pay.cash) + ")");
  ok(!n.pay.carry.neg, "November carries no negative liability on");
  ok(n.pay.negAdj && near(n.pay.negAdj.cgst, 2700), "November's 6.1: 2,700 adjusted of the earlier negative liability (" + JSON.stringify(n.pay.negAdj) + ")");
  const J = x.GSTF.journal("202511", reg), oc = J.lines.find((l) => l.l === "CGST");
  NOV = JSON.parse(JSON.stringify(n));
  ok(oc && near(oc.dr, 900), "November's set-off journal debits CGST output 900 (the books' output ledger nets October's credit note) (" + JSON.stringify(oc) + ")");
}

// ---------------------------------------------------------------- 3. 2B "ITC not available" on a matched bill
console.log("== 3. a matched bill 2B marks ITC not available is not claimed");
{
  const vs = [buy("20251125", "P/79", "Bramble Supplies", GB, 5000, {igst: 900}), buy("20251205", "P/77", "Bramble Supplies", GB, 100000, {igst: 18000}),
    buy("20251208", "P/78", "Alder Stationers", GA, 10000, {igst: 1800}), out("Sales", "20251210", "S/21", "Walk-in Customers", "", 200000, {cgst: 18000, sgst: 18000})];
  const TWOB = {[CMP + "|122025"]: {ym: "202512", gstin: CMP, period: "122025", rows: [row("202512", GB, "BRAMBLE SUPPLIES", "P/77", "20251205", 100000, {igst: 18000}, "N", "C"),
    row("202512", GA, "ALDER STATIONERS", "P/78", "20251208", 10000, {igst: 1800}), row("202512", GB, "BRAMBLE SUPPLIES", "P/79", "20251125", 5000, {igst: 900}, "N", "C")]}};
  const base = () => { books(vs, JSON.parse(JSON.stringify(TWOB))); const r = x.GST2B.run(reg); return r; };
  const r = base();
  ok(r.pairs.filter((p) => p.p.itcavl === "N").length === 2, "both N rows are matched to the books (" + r.pairs.map((p) => p.p.no + ":" + p.p.itcavl + ":" + p.status).join(", ") + ")");
  const nov = T("202511"), d = T("202512");
  ok(near(nov.other.igst, 900), "November (no 2B then): P/79's 900 taken as booked (" + nov.other.igst + ")");
  ok(near(d.other.igst, 900), "December 4(A)(5) IGST 900: 19,800 booked less P/77's 18,000 and P/79's 900 that 2B says are not available (" + d.other.igst + ")");
  ok(near(d.na.igst, 18900), "4(D)(2) shows the 18,900 (" + d.na.igst + ")");
  ok(d.held.list.some((h) => h.no === "P/77" && h.na) && d.held.list.some((h) => h.no === "P/79" && h.na), "held back, marked not available (" + d.held.list.map((h) => h.no + (h.na ? "*" : "")).join(", ") + ")");
  // the Final credit for 3B (app/src/lib/itcFinal.js) wraps threeBm: the same figure with nothing decided
  const APP = path.join(__dirname, "..", "app", "src", "lib");
  const strip = (q) => fs.readFileSync(path.join(APP, q), "utf8").replace(/^import .*$/mg, "").replace(/^export (const|function|async function) /mg, "$1 ");
  vm.runInContext("globalThis.__sync = (function(){" + strip("itcSync.js") + "\n; return {DECS, DEC_LABEL}; })();\n(function(){ const {DECS, DEC_LABEL} = globalThis.__sync;\n" + strip("itcFinal.js") + "\n})();", ctx);
  ok(G.threeBm.itcFinal === true, "GSTR.threeBm is wrapped by the Final credit for 3B");
  base(); const n2 = T("202511"), d2 = T("202512");
  ok(near(n2.other.igst, 900) && near(d2.other.igst, 900) && near(d2.netItc.igst, 900), "with the Final credit for 3B: November 900, December 900 (" + n2.other.igst + ", " + d2.other.igst + ")");
  // (re-review) GSTR-9's "held back for 2B at the year's end" leaves out what 2B says is not available (held for good)
  ok(near((d2.held || {}).na || 0, 18900), "the Final credit's held back carries the 18,900 not available apart (" + JSON.stringify(d2.held && d2.held.na) + ")");
  ok(near(x.GST9.build("2025", reg).heldEnd, 0), "GSTR-9 heldEnd 0: P/77 and P/79 are not available, not waiting for 2B (" + x.GST9.build("2025", reg).heldEnd + ")");
}

// ---------------------------------------------------------------- 4. GSTR-9 of a QRMP client
console.log("== 4. GSTR-9 for a QRMP quarter kept as filed");
{
  const vs = [];
  ["202504", "202505", "202506"].forEach((m, i) => { vs.push(out("Sales", m + "10", "Q/" + i, "Walk-in Customers", "", 40000, {cgst: 1000, sgst: 1000}), buy(m + "12", "B/" + i, "Alder Stationers", GA, 16000, {cgst: 400, sgst: 400})); });
  books(vs);
  x.GSTSet.store(reg).filing = [{type: "qrmp", from: "202504"}];
  const d0 = x.GST9.build("2025", reg);
  ok(near(d0.T["6A"].cgst, 1200) && near(d0.pay.cgst.due, 3000), "before keeping the 3B: 6A CGST 1,200, table 9 CGST 3,000 (" + d0.T["6A"].cgst + ", " + d0.pay.cgst.due + ")");
  G._carry = null; x.GSTF.rec("202506", reg).snap = x.GSTF.snapOf(G.threeB("202506", reg));
  const d1 = x.GST9.build("2025", reg);
  ok(near(d1.T["6A"].cgst, 1200), "June's 3B kept as filed (the quarter): 6A CGST 1,200 (" + d1.T["6A"].cgst + ")");
  ok(near(d1.pay.cgst.due, 3000) && near(d1.T["4A"].cgst, 3000), "table 9 CGST 3,000 (" + d1.pay.cgst.due + ")");
  ok(near(d1.pay.cgst.cash + d1.pay.cgst.itc, 3000), "table 9 CGST paid: credit and cash add up to 3,000 (" + d1.pay.cgst.cash + " + " + d1.pay.cgst.itc + ")");
  // (re-review) the books now run only to May: the quarter's 3B kept as filed still counts, once
  const keep = {gstFiled: ctx.S.books.gstFiled, gstSet: ctx.S.books.gstSet};
  books(vs.filter((v) => v.date < "20250601")); Object.assign(ctx.S.books, JSON.parse(JSON.stringify(keep)));
  const d2 = x.GST9.build("2025", reg);
  ok(d2.inBooks.join(",") === "202504,202505", "the books: April and May (" + d2.inBooks.join(",") + ")");
  ok(near(d2.T["6A"].cgst, 1200) && near(d2.pay.cgst.due, 3000), "June (not in the books) kept as filed: 6A CGST 1,200, table 9 CGST 3,000 (" + d2.T["6A"].cgst + ", " + d2.pay.cgst.due + ")");
}

// ---------------------------------------------------------------- 5. GSTR-9: notes on supplies with no tax
console.log("== 5. GSTR-9: notes on zero-rated (no tax) and exempt supplies in 5H / 5I");
{
  books([out("Sales", "20250705", "E/31", "Oakridge Imports LLC", "", 100000, {}, {country: "United States"}),
    out("Credit Note", "20250810", "CN/31", "Oakridge Imports LLC", "", 10000, {}, {country: "United States"}),
    out("Sales", "20250712", "X/31", "Harbour Exempt Clinic", "", 20000, {}, {taxability: "Exempt"}),
    out("Debit Note", "20250815", "DN/31", "Harbour Exempt Clinic", "", 5000, {}, {taxability: "Exempt"})]);
  const o = G.outward("202508", reg);
  ok(o.some((r) => r.kind === "DBNR" && r.cls === "exempt") && o.some((r) => r.kind === "CDNR" && r.cls === "export"), "the notes are a DBNR (exempt) and a CDNR (export) (" + o.map((r) => r.kind + ":" + r.cls).join(", ") + ")");
  const T9 = x.GST9.build("2025", reg).T;
  ok(near(T9["4I"].taxable, 0) && near(T9["4J"].taxable, 0), "4I and 4J: nothing (" + T9["4I"].taxable + ", " + T9["4J"].taxable + ")");
  ok(near(T9["5H"].taxable, 10000) && near(T9["5I"].taxable, 5000), "5H 10,000 (the export's credit note), 5I 5,000 (the exempt debit note) (" + T9["5H"].taxable + ", " + T9["5I"].taxable + ")");
  ok(near(T9["5D"].taxable, 20000), "5D 20,000: the debit note is not counted again in 5D (" + T9["5D"].taxable + ")");
  ok(near(T9["5M"].taxable, 115000) && near(T9["4N"].taxable, 0), "5M 1,15,000, 4N 0 (" + T9["5M"].taxable + ", " + T9["4N"].taxable + ")");
}

// ---------------------------------------------------------------- 6. rule 42 (low)
console.log("== 6. rule 42: D2 off unless answered; outward reverse charge is exempt turnover");
{
  books([out("Sales", "20250705", "S/41", "Walk-in Customers", "", 1000, {cgst: 90, sgst: 90})]);
  ok(x.GSTRev.settings().d2 === false, "D2 is off when the CA has not said common credit is used for non-business purposes");
  ctx.S.books.rev = {d2: true};
  ok(x.GSTRev.settings().d2 === true, "answered yes: D2 applies");
  ok(x.GSTRev.toPart({cls: "taxable", rcm: true}) === "E", "an outward supply on reverse charge is exempt turnover for rule 42 (section 17(3))");
  ok(x.GSTRev.toPart({cls: "taxable"}) === "T", "a taxable supply stays taxable turnover");
  // (re-review) not answered, but a 3B already filed reversed D2: it stays on until the CA says (no silent change)
  ctx.S.books.rev = {}; ctx.S.books.gstFiled = {[reg]: {"202506": {r3b: "2025-07-20", snap: {r42: {D2: {igst: 0, cgst: 50, sgst: 50, cess: 0}}}}}};
  ok(x.GSTRev.settings().d2 === true && x.GSTRev.d2Filed() === true, "not answered, a filed 3B reversed D2: D2 stays on");
  ctx.S.books.rev = {d2: false};
  ok(x.GSTRev.settings().d2 === false, "answered no: D2 off, whatever was filed");
}

(async () => {
  // the daily check's set-off check (server/_shared/dailyjournals.js) reads the same: the tax owed is less 6.1's adjustment
  const DJ = await import(path.join(__dirname, "..", "server", "_shared", "dailyjournals.js"));
  ok(DJ.setoffLegal(NOV.pay, NOV.net, NOV.rcmOut, NOV.netItc, NOV.opening) === "", "the daily check finds November's set-off legal (" + DJ.setoffLegal(NOV.pay, NOV.net, NOV.rcmOut, NOV.netItc, NOV.opening) + ")");
  // ---------------------------------------------------------------- 7. late fee: nil return (low)
  console.log("== 7. 3B late fee: nil means no tax payable");
  const {nil3b} = await import(path.join(__dirname, "..", "app", "src", "lib", "gst3bNil.js"));
  const z = () => ({igst: 0, cgst: 0, sgst: 0, cess: 0});
  ok(nil3b({net: z(), rcmOut: z(), other: {igst: 5000, cgst: 0, sgst: 0, cess: 0}, impGoods: {igst: 900}}) === true, "no tax payable, some credit: a nil return (Rs 20 a day, at most Rs 500)");
  ok(nil3b({net: Object.assign(z(), {cgst: 10}), rcmOut: z()}) === false, "CGST 10 payable: not nil");
  ok(nil3b({net: z(), rcmOut: Object.assign(z(), {igst: 18})}) === false, "reverse charge IGST 18 payable: not nil");
  ok(nil3b({net: Object.assign(z(), {cgst: -2700}), rcmOut: z()}) === true, "a negative head is no tax payable: nil");
  ok(nil3b({net: z(), rcmOut: z(), zero: Object.assign(z(), {taxable: 100000, igst: 18000}), other: Object.assign(z(), {igst: 20000})}) === false, "an export with IGST 18,000 (3.1(b)) is tax payable: not nil");
  ok(DJ.nil3bOf({net: z(), rcmOut: z(), zero: Object.assign(z(), {igst: 18000})}) === false && DJ.nil3bOf({net: z(), rcmOut: z(), zero: z()}) === true, "the daily check's nil test the same");
  // ---------------------------------------------------------------- 1b (portal) / 1c. the R3B bill breakdown, and what needs the CA
  console.log("== 1b. the R3B bill breakdown: each class its own rejected notes");
  globalThis.GSTR = G; globalThis.num = x.num; globalThis.r2 = x.r2; globalThis.GST2B = x.GST2B; globalThis.GSTAmend = x.GSTAmend; globalThis.STATE_CODES = x.STATE_CODES; globalThis.S = ctx.S;
  const {r3bBills} = await import(path.join(__dirname, "..", "app", "src", "screens", "gst", "portal.js"));
  { const t = T1B, lab = /rejected by customers/i; books(B1B.vs); Object.assign(ctx.S.books, {outRej: B1B.outRej});
    const a = r3bBills("3.1a", "202510", reg, t), b = r3bBills("3.1b", "202510", reg, t), c = r3bBills("3.1c", "202510", reg, t);
    const aj = (q) => q.adj.filter((y) => lab.test(y.label));
    ok(!aj(a).length, "3.1(a): no rejected notes added (" + JSON.stringify(aj(a)) + ")");
    ok(aj(b).length === 1 && near(aj(b)[0].taxable, 20000) && near(aj(b)[0].igst, 1800), "3.1(b): the SEZ unit's notes, 20,000 and IGST 1,800 (" + JSON.stringify(aj(b)) + ")");
    ok(aj(c).length === 1 && near(aj(c)[0].taxable, 5000), "3.1(c): the exempt supply's note, 5,000 (" + JSON.stringify(aj(c)) + ")");
    ok([a, b, c].every((q) => !q.off.length), "each figure is its bills and adjustments (" + [a, b, c].map((q) => JSON.stringify(q.off)).join(" ") + ")"); }
  // (CustIMS.letter and .customers moved out of the engine to app/src/lib/custImsLetter.js, put on CustIMS by CustIms.jsx)
  { ["GSTAmend", "GSTSet", "CustIMS", "INR"].forEach((q) => { globalThis[q] = x[q]; }); globalThis.CO = ctx.CO;
    (await import(path.join(__dirname, "..", "app", "src", "lib", "custImsLetter.js"))).installCustIms();
    const cs = x.CustIMS.customers(reg), c = cs.find((q) => q.party === "Sunrise SEZ Unit"), L = c ? x.CustIMS.letter(reg, c.gstin, c.party, c.items) : "";
    ok(cs.length === 2 && c && c.items.length === 2 && /rejected in your Invoice Management System/.test(L) && L.includes("ZC/1") && L.includes("ZC/2"), "the letter to the SEZ unit names its two credit notes (" + cs.map((q) => q.party + ":" + q.items.length).join(", ") + ")"); }
  console.log("== 1c. what the CA decides: a negative 3.1(c), and 3.1(b) IGST outside the set-off");
  const {r3bNeeds} = await import(path.join(__dirname, "..", "app", "src", "lib", "gst3bNil.js"));
  { books([out("Sales", "20250910", "X/61", "Harbour Exempt Clinic", "", 20000, {}, {taxability: "Exempt"}), out("Credit Note", "20251008", "CN/61", "Harbour Exempt Clinic", "", 5000, {}, {taxability: "Exempt"}),
      out("Sales", "20251012", "E/61", "Kelpie Trading GmbH", "", 40000, {igst: 7200}, {country: "Germany"})]);
    const t = T("202510"), w = r3bNeeds(t);
    ok(near(t.nil.taxable, -5000), "3.1(c) is -5,000 (" + t.nil.taxable + ")");
    ok(w.some((m) => /3\.1\(c\)/.test(m) && /negative/i.test(m)), "Needs you: 3.1(c) is negative (" + JSON.stringify(w) + ")");
    ok(w.some((m) => /3\.1\(b\)/.test(m) && /7,200|7200/.test(m) && /6\.1/.test(m)), "Needs you: 3.1(b) IGST 7,200 is not in FinCom's 6.1 set-off");
    ok(!r3bNeeds(NOV).length, "November of test 2: nothing to say"); }

  // ---------------------------------------------------------------- 8. the GSTR-1 bills Excel
  console.log("== 8. the GSTR-1 bills Excel carries cess");
  const {r1BillsSheet} = await import(path.join(__dirname, "..", "app", "src", "screens", "gst", "r1BillsSheet.js"));
  const col = (c) => { let s = ""; c++; while (c > 0){ const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
  const X = {utils: {encode_cell: ({c, r}) => col(c) + (r + 1), encode_range: ({s, e}) => col(s.c) + (s.r + 1) + ":" + col(e.c) + (e.r + 1)}};
  globalThis.r2 = x.r2; globalThis.num = x.num;
  const ws = r1BillsSheet(X, [{date: "20251010", no: "S/51", party: "Walk-in Motors", gstin: "", pos: "Delhi", rate: 28, taxable: 100000, igst: 28000, cgst: 0, sgst: 0, cess: 15000}],
    [{pos: "Delhi", rate: 28, taxable: 50000, igst: 0, cgst: 7000, sgst: 7000, cess: 7500}], {day: (d) => d, part: () => "5 B2C large", sumPart: "7 B2C others"});
  const heads = Object.keys(ws).filter((q) => /^[A-Z]+1$/.test(q)).map((q) => ws[q].v);
  ok(heads.includes("Cess"), "a Cess column (" + heads.join(", ") + ")");
  const ci = heads.indexOf("Cess"), ti = heads.indexOf("Total");
  ok(ws[col(ci) + "2"] && near(ws[col(ci) + "2"].v, 15000) && near(ws[col(ci) + "3"].v, 7500), "the bill's cess 15,000 and the summary line's 7,500 are there");
  ok(ws[col(ti) + "2"] && near(ws[col(ti) + "2"].v, 143000) && /SUM\(I2:M2\)/.test(ws[col(ti) + "2"].f), "the bill's Total 1,43,000 = SUM(I2:M2), as the screen's (" + JSON.stringify(ws[col(ti) + "2"]) + ")");
  ok(near(ws[col(ti) + "4"].v, 214500) && near(ws[col(ci) + "4"].v, 22500), "the totals row: Total 2,14,500, cess 22,500 (" + (ws[col(ti) + "4"] || {}).v + ")");
  // ---------------------------------------------------------------- 9. PMT-06, self-assessment
  console.log("== 9. PMT-06 (self-assessment): the second month starts from what the first left");
  { books([out("Sales", "20250410", "Q/91", "Walk-in Customers", "", 10000, {cgst: 800, sgst: 800}), out("Sales", "20250512", "Q/92", "Walk-in Customers", "", 10000, {cgst: 800, sgst: 800}),
      out("Sales", "20250612", "Q/93", "Walk-in Customers", "", 1000, {cgst: 90, sgst: 90})]);
    ctx.S.books.gstOpen = {[reg]: {igst: 0, cgst: 1000, sgst: 1000, cess: 0}};
    x.GSTSet.store(reg).filing = [{type: "qrmp", from: "202504"}]; x.GSTSet.store(reg).pmt = "self"; G._carry = null;
    const p1 = x.GSTQ.pmt06("202504", reg), p2 = x.GSTQ.pmt06("202505", reg);
    ok(near(p1.amt.cgst, 0), "April: 800 of tax, 1,000 of credit: nothing to deposit (" + p1.amt.cgst + ")");
    ok(near(p2.amt.cgst, 600) && near(p2.amt.sgst, 600), "May: 800 of tax, 200 of credit left: 600 each (" + f(p2.amt) + ")"); }
  // ---------------------------------------------------------------- 10. marketplace invoices: once, before and after posting
  console.log("== 10. a marketplace invoice in Sales is counted once, before and after it is posted");
  { const KA = "Karnataka";
    const inv = (id, no, eco, taxable, igst, status, o) => ({id, source: "market", status, customerLedger: "Marketplace Customers", x: Object.assign({number: no, date: "2025-10-0" + no.slice(-1), customerName: "Retail customer", customerGstin: "",
      placeOfSupply: KA, taxable, igst, cgst: 0, sgst: 0, cess: 0, total: taxable + igst, rate: 18, ecommerce: eco, tcs: eco === "shopify" ? 0 : taxable / 100}, o || {})});
    const s1 = out("Sales", "20251003", "S/1", "Walk-in Customers", "", 50000, {cgst: 4500, sgst: 4500});
    const AMZ = "mk7a21", FK = "mk7f31", SH = "mk7s41";
    const check = (when, b) => {
      G._carry = null; if (typeof x.perRender === "function") {}
      const t = T("202510"), g = G.one("202510", reg), e = G.eco14("202510", reg, g), all = e.a.concat(e.missing);
      const am = all.find((q) => q.eco === "amazon"), fl = all.find((q) => q.eco === "flipkart"), sh = all.find((q) => q.eco === "shopify");
      const b2c = G.sum(g.b2c), n21 = g.rows.filter((r) => /AMZ-21/.test(r.no)).length, n31 = g.rows.filter((r) => /FK-31/.test(r.no)).length, n41 = g.rows.filter((r) => /SH-41/.test(r.no)).length;
      const to = x.GSTRev.turnoverNow("202510", reg), j = G.toJson("202510", reg, {plain: true}), cl = ((j.supeco || {}).clttx || []);
      ok(near(t.net.taxable, 67000) && near(t.net.igst, 3060) && near(t.net.cgst, 4500), when + ": 3.1(a) 67,000, IGST 3,060, CGST 4,500 (" + t.net.taxable + ", " + f(t.net) + ")");
      ok(near(b2c.taxable, 67000) && near(b2c.igst, 3060) && n21 === 1 && n31 === 1 && n41 === 1, when + ": GSTR-1 B2C (tables 4-7) 67,000, IGST 3,060; AMZ-21, FK-31, SH-41 once each (" + b2c.taxable + ", " + b2c.igst + "; " + [n21, n31, n41] + ")");
      ok(am && am.n === 1 && near(am.suppval, 10000) && near(am.igst, 1800) && fl && fl.n === 1 && near(fl.suppval, 5000) && near(fl.igst, 900), when + ": table 14 Amazon 1 invoice 10,000 (IGST 1,800), Flipkart 1 invoice 5,000 (" + JSON.stringify(all.map((q) => [q.eco, q.n, q.suppval])) + ")");
      ok(!sh, when + ": the client's own Shopify store is no e-commerce operator: not in table 14");
      ok(cl.length === 2 && near(cl.reduce((a, q) => a + q.suppval, 0), 15000), when + ": the JSON's supeco 14(a): two operators, 15,000 (" + JSON.stringify(cl) + ")");
      ok(near(to.taxable, 67000) && near(to.total, 67000), when + ": rule 42's turnover 67,000 (" + JSON.stringify(to) + ")");
    };
    books([s1]);
    ctx.S.sales = {cid: "t", list: [inv(AMZ, "AMZ-21", "amazon", 10000, 1800, "review", {ecoGstin: "07AAAAZ1111Z1CZ"}), inv(FK, "FK-31", "flipkart", 5000, 900, "review", {ecoGstin: "07AAAAZ2222Z1CZ"}), inv(SH, "SH-41", "shopify", 2000, 360, "review")]};
    check("before posting", ctx.S.books);
    // (re-review of ffd1402d0) "posted" alone is not "in the books": an invoice is counted through its Tally entry only
    // when that entry is found in the books (its FinCom id: the narration's tag or the cloud copy's fincom_id; an invoice
    // found already in Tally (intally): an entry of its number and date); until then, and after the entry is deleted in
    // Tally, from Sales, once. Posted but not in books read since: GST > What to fix says so
    const GONE = "Posted to Tally but not in the books read since — check it wasn't deleted";
    const gone = () => ((G.checks("202510", reg) || []).find((c) => c && c.what === GONE) || {all: []}).all.map((r) => r.no);
    const pv = (no, amt, igst, id, date, o) => out("Sales", date, no, "Marketplace Customers", "", amt, {igst}, Object.assign({pos: KA, narr: "Being sales invoice " + no + " dated 01-Oct-2025 to Retail customer" + (id ? " | TDSDesk:" + id : "")}, o || {}));
    // FK-31's entry as the cloud copy gives it: a 60-character buyer name, the narration cut to 120 characters (the tag
    // lost), its FinCom id in the copy's fincom_id column (migration 37)
    const buyer = "Zeta Sixty Character Made Up Retail Customer Private Limited";
    const narrFk = "Being sales invoice FK-31 dated 01-Oct-2025 to " + buyer + " | TDSDesk:" + FK;
    const fc = x.BookSrc.fromCopy([{guid: "g-fk31", day: "2025-10-01", alter_id: 1, vtype: "Sales", vno: "FK-31", party: "Marketplace Customers", narration: narrFk, fincom_id: FK, cancelled: false, optional: false, deleted_at: null, gstin: "", pos: KA, cmp_gstin: CMP}],
      [{guid: "g-fk31", ledger: "Marketplace Customers", amount: -5900}, {guid: "g-fk31", ledger: "Sales", amount: 5000}, {guid: "g-fk31", ledger: "IGST", amount: 900}], [])[0];
    ok(buyer.length === 60 && fc && !fc.narr.includes("TDSDesk:" + FK) && fc.fid === FK, "fromCopy: a 60-character buyer, the tag cut off the narration (" + (fc && fc.narr.length) + " characters), its FinCom id from fincom_id (" + (fc && fc.fid) + ")");
    const T0 = "2025-10-05T10:00:00.000Z", before = "2025-10-05T09:00:00.000Z", after = "2025-10-05T11:00:00.000Z";
    const L = ctx.S.sales.list;
    // (a) posted, the books not read since: AMZ-21 from Sales
    books([s1]); ctx.S.books.meta.at = before;
    Object.assign(L[0], {status: "posted", postedAt: T0}); Object.assign(L[1], {status: "posted", postedAt: T0}); Object.assign(L[2], {status: "intally", postedAt: T0});
    check("posted, the books not yet read again", ctx.S.books);
    ok(!gone().length, "posted, the books not read since: nothing to fix (" + gone() + ")");
    // (b) the books read since, every entry there: AMZ-21 by its tag, FK-31 by fincom_id, SH-41 (intally) by its number and date
    books([s1, pv("AMZ-21", 10000, 1800, AMZ, "20251001"), Object.assign(pv("FK-31", 5000, 900, "", "20251001"), {narr: fc.narr, fid: fc.fid}), pv("SH-41", 2000, 360, "", "20251001")]); ctx.S.books.meta.at = after;
    check("posted and in the books", ctx.S.books);
    ok(!gone().length, "in the books: nothing to fix (" + gone() + ")");
    // (c) AMZ-21's entry deleted in Tally, the books read after it was posted: from Sales again, and said
    books([s1, Object.assign(pv("FK-31", 5000, 900, "", "20251001"), {narr: fc.narr, fid: fc.fid}), pv("SH-41", 2000, 360, "", "20251001")]); ctx.S.books.meta.at = after;
    check("posted, its entry deleted in Tally since", ctx.S.books);
    ok(JSON.stringify(gone()) === '["AMZ-21"]', "What to fix: AMZ-21 posted to Tally but not in the books read since (" + JSON.stringify(gone()) + ")");
    // gst-run's month step has no entries: what the cloud copy shows (data.ts salesSeen, as engine.js seenOf gives it)
    books([s1]); ctx.S.books.salesSeen = {fids: [AMZ, FK], nos: [G.saleNoKey("SH-41", "20251001")]};
    const ms = G.marketRows("202510"), bk = ms.filter((r) => r.booked).map((r) => r.no).sort();
    ok(JSON.stringify(bk) === '["AMZ-21","FK-31","SH-41"]' && !G.fromSales("202510").length, "the cloud's month step: AMZ-21 and FK-31 by the copy's fincom_id, SH-41 (intally) by its number: in the books, none from Sales (" + JSON.stringify(bk) + ")");
    ctx.S.sales = null;
  }
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
