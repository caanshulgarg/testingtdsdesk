// node run_gstfiling.js - filing a GST month: due dates, late fee, interest, rule 37, DRC-01B/01C, filed 3B copies,
// section 34(2) on credit notes, and the set-off journal for Tally
const fs = require("fs"), {load, openBlob, HTML, DATA, CACHE} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "GST9", "INR", "normName", "ITCT", "CustIMS", "GSTF", "Audit", "CO"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const near = (a, b2, t) => Math.abs(a - b2) <= (t || 0.02);
(async () => {
  const {ctx, x} = load(HTML, NAMES);
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}, twoBs: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; x.LedMaster.refresh(b);
  ctx.S.companies = {c: {id: "c", name: "VMS Events Pvt Ltd", gstin: "07AADCV3366N1ZU"}}; ctx.S.coId = "c";
  const G = x.GSTF, reset = () => { x.GSTR._carry = null; };
  // due dates and late fee
  ok(G.due("202603", "r1") === "2026-04-11" && G.due("202603", "r3b") === "2026-04-20" && G.due("202512", "r3b") === "2026-01-20", "due dates: GSTR-1 by the 11th, 3B by the 20th of the next month");
  G.rec("202603", "07").r3b = "2026-05-05"; G.rec("202603", "07").r1 = "2026-04-11";
  let f = G.lateFee("202603", "07", "r3b", false);
  ok(f.days === 15 && f.fee === 750 && f.cgst === 375 && f.cap === 10000, "3B filed 15 days late: \u20b9750 late fee, half CGST half SGST (turnover of the year before not in the books: highest cap)");
  ok(G.lateFee("202603", "07", "r1", false).fee === 0, "GSTR-1 filed on the 11th: no late fee");
  b.gstAato = {"2025-26": 12000000}; G.rec("202603", "07").r3b = "2026-07-30";
  f = G.lateFee("202603", "07", "r3b", false);
  ok(f.days === 101 && f.fee === 2000, "turnover \u20b91.2 crore: capped at \u20b92,000 after 101 days");
  ok(G.lateFee("202603", "07", "r3b", true).fee === 500, "a nil return: \u20b920 a day, capped at \u20b9500");
  b.gstAato = {"2025-26": 60000000}; ok(G.lateFee("202603", "07", "r3b", false).fee === 5050, "turnover above \u20b95 crore: cap \u20b910,000, so \u20b95,050 stands");
  // interest
  G.rec("202603", "07").r3b = "2026-05-05"; reset();
  const t = x.GSTR.threeB("202603", "07"), it = G.interest("202603", "07", t), cash = t.pay.cash.igst + t.pay.cash.cgst + t.pay.cash.sgst + t.pay.cash.cess;
  ok(it.days === 15 && near(it.total, cash * 0.18 * 15 / 365, 0.05) && cash > 0, "interest under section 50: 18% on the cash of \u20b9" + Math.round(cash) + " for 15 days = \u20b9" + it.total);
  // rule 37
  const oct = G.rule37("202510", "07"), nov = G.rule37("202511", "07");
  const brand = oct.rev.list.find(z => /BRANDALIVE/.test(z.party));
  ok(brand && near(brand.tax, 101700, 1), "rule 37: Brandalive's bill of 30 Apr 2025, unpaid 180 days later, is reversed in October (\u20b91,01,700)");
  ok(nov.re.list.some(z => /BRANDALIVE/.test(z.party)), "and taken back in November, when it was paid");
  const julka = oct.rev.list.find(z => /JULKA/.test(z.party));
  ok(!julka || julka.tax < 100, "a bill with only part of the invoice kept against it reverses only that share (Julka 79)");
  reset(); const t10 = x.GSTR.threeB("202510", "07");
  ok(near(t10.rev2.igst + t10.rev2.cgst + t10.rev2.sgst, oct.rev.igst + oct.rev.cgst + oct.rev.sgst), "October 3B 4(B)(2) carries the rule 37 reversal");
  const t11 = x.GSTR.threeB("202511", "07");
  b.rule37Off = {"07": true}; reset(); const t11off = x.GSTR.threeB("202511", "07"); b.rule37Off = {};
  ok(near((t11.other.igst + t11.other.cgst + t11.other.sgst) - (t11off.other.igst + t11off.other.cgst + t11off.other.sgst), nov.re.igst + nov.re.cgst + nov.re.sgst) && near(t11.reclaim.igst + t11.reclaim.cgst + t11.reclaim.sgst, nov.re.igst + nov.re.cgst + nov.re.sgst), "November: the reclaim is taken in 4(A)(5) and shown in 4(D)(1)");
  b.gst3b = {"07|202512": {reclaim: {igst: 1000}}}; reset();
  const t12 = x.GSTR.threeB("202512", "07"); b.gst3b = {}; reset(); const t12b = x.GSTR.threeB("202512", "07");
  ok(near(t12.other.igst - t12b.other.igst, 1000), "a reclaim typed in 4(D)(1) now gives the credit in 4(A)(5) too (it did not before)");
  // DRC-01B and DRC-01C
  const d3 = G.drc("202603", "07", t);
  ok(d3.b.gap === 0 && !d3.b.flag && !d3.c.have2b, "DRC-01B: GSTR-1 and 3B from the same books agree; DRC-01C needs the month's 2B");
  const t2b = x.GST2B.fromJson(JSON.parse(fs.readFileSync(DATA + "/returns_R2B_07AADCV3366N1ZU_032026.json", "utf8"))); b.twoBs = {[t2b.gstin + "|" + t2b.period]: t2b}; x.GST2B._memo = null; reset();
  const tm = x.GSTR.threeB("202603", "07"), dc = G.drc("202603", "07", tm);
  ok(dc.c.have2b && dc.c.avl > 0 && dc.c.claimed > 0, "DRC-01C with March's 2B: 3B credit \u20b9" + Math.round(dc.c.claimed) + " against 2B \u20b9" + Math.round(dc.c.avl) + (dc.c.flag ? " (above the limit)" : " (within the limit)"));
  b.itcBasis = {"07": "books"}; reset(); const dcb = G.drc("202603", "07", x.GSTR.threeB("202603", "07")); b.itcBasis = {};
  ok(dcb.c.claimed >= dc.c.claimed, "on the books basis more credit is claimed, and the check shows how far above 2B");
  b.twoBs = {}; x.GST2B._memo = null; reset();
  // filed 3B: its figures stand for GSTR-9 and its left-over credit is carried
  const cashOf = g => ["igst", "cgst", "sgst"].reduce((a, h) => a + num0(g.pay[h].cash), 0), num0 = v => Number(v) || 0;
  const g90 = cashOf(x.GST9.build(x.GST9.fyOf("202603"), "07"));
  const feb = x.GSTR.threeB("202602", "07"); G.rec("202602", "07").snap = G.snapOf(feb); reset();
  const carry0 = x.GSTR.creditIn("202603", "07");
  b.gst3b = {"07|202602": {rev2: {igst: 500000}}}; reset();
  const carry1 = x.GSTR.creditIn("202603", "07"), feb2 = x.GSTR.threeB("202602", "07");
  ok(near(carry1.igst, carry0.igst) && !near(feb2.pay.carry.igst + feb2.pay.cash.igst, feb.pay.carry.igst + feb.pay.cash.igst, 1), "a month kept as filed: later changes do not move the credit carried into the next month");
  const g9k = cashOf(x.GST9.build(x.GST9.fyOf("202603"), "07"));
  delete G.rec("202602", "07").snap; reset(); const g9n = cashOf(x.GST9.build(x.GST9.fyOf("202603"), "07"));
  ok(near(g9k, g90, 1) && !near(g9n, g90, 1), "GSTR-9 table 9 takes the month as filed: cash paid ₹" + Math.round(g9k) + " as filed; without the kept copy it would move to ₹" + Math.round(g9n));
  b.gst3b = {}; reset();
  const g9y = x.GST9.build(x.GST9.fyOf("202603"), "07"), r37y = x.GSTR.months().reduce((a, m) => { const r = G.rule37(m, "07").rev; return a + r.igst + r.cgst + r.sgst + r.cess; }, 0), T = g9y.T, s4 = o => (o.igst || 0) + (o.cgst || 0) + (o.sgst || 0) + (o.cess || 0);
  ok(near(s4(T["7A"]), r37y, 1) && r37y > 0, "GSTR-9 7A: rule 37 reversals of the year, \u20b9" + Math.round(r37y));
  ok(Math.abs(s4(T["6J"])) < 1, "GSTR-9 6J: no difference, the reclaims are in 6H as well as 6A");
  // section 34(2)
  const cn = b.vouchers.find(v => x.Books.isSale(v) && /CREDIT NOTE/i.test(v.type) && x.GSTR.regOf(v) === "07"), keep = cn.refDate;
  ok(G.lateCn(null, "07").length === 0, "no credit note in VMS's books is late");
  cn.refDate = "20230115"; const late = G.lateCn(x.GSTR.ym(cn.date), "07");
  ok(late.length === 1 && late[0].lim === "20231130", "a credit note for an invoice of January 2023 issued after 30 November 2023 is found");
  ok(x.GSTR.checks(x.GSTR.ym(cn.date), "07").some(c => /30 November/.test(c.what)), "and it is listed in the GSTR-1 checks");
  cn.refDate = keep;
  // the set-off journal for Tally
  reset(); const J = G.journal("202603", "07"), dr = J.lines.reduce((a, l) => a + l.dr, 0), cr = J.lines.reduce((a, l) => a + l.cr, 0);
  ok(J.balanced && near(dr, cr) && J.lines.some(l => l.l === "07 IGST OUTPUT" && l.dr > 0) && J.lines.some(l => /RCM/.test(l.l) && l.dr > 0) && J.missing.length === 0, "set-off journal: output debited, input and cash credited, reverse charge paid in cash; balances at \u20b9" + Math.round(dr));
  const xml = x.Audit.jeXml([{date: J.date, narr: J.narr, lines: J.lines}]);
  ok(/VCHTYPE="Journal"/.test(xml) && xml.includes("07 GST ELECTRONIC CASH LEDGER") && xml.includes("<DATE>20260505</DATE>"), "as a Tally journal dated the day the 3B was filed");
  // saved with the books
  const src = fs.readFileSync(HTML, "utf8"), sv = (src.match(/async function saveBooks\(\)\{[\s\S]*?\}\); \}/) || [""])[0];
  ok(["gstFiled", "gstAato", "rule37Off", "gstCashLedger"].every(k => new RegExp("\\b" + k + ": b\\." + k + "\\b").test(sv)), "filed dates, turnover, rule 37 setting and cash ledger are saved with the books");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})();
