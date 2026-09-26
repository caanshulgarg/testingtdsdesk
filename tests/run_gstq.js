// node run_gstq.js - QRMP (IFF, PMT-06, GSTR-1 and 3B for the quarter) and composition (CMP-08, GSTR-4), on VMS's books
const fs = require("fs"), {load, openBlob, HTML, DATA, CACHE} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "GST9", "INR", "normName", "ITCT", "GSTSet", "CustIMS", "GSTF", "GSTQ", "Audit", "CO"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const near = (a, b2, t) => Math.abs(a - b2) <= (t || 0.05), H = ["igst", "cgst", "sgst", "cess"], tot = o => H.reduce((a, h) => a + (Number((o || {})[h]) || 0), 0);
(async () => {
  const {ctx, x} = load(HTML, NAMES);
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}, twoBs: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; x.LedMaster.refresh(b);
  ctx.S.companies = {c: {id: "c", name: "VMS Events Pvt Ltd", gstin: "07AADCV3366N1ZU"}}; ctx.S.coId = "c";
  const G = x.GSTR, Q = x.GSTQ, F = x.GSTF, reset = () => { G._carry = null; };
  const monthly = ["202510", "202511", "202512"].map(m => G.threeBm(m, "07"));
  x.GSTSet.store("07").filing = [{type: "qrmp", from: "202510"}]; reset();
  // 3B for the quarter
  const tq = G.threeB("202512", "07");
  ok(tq.quarter && tq.months.join() === "202510,202511,202512", "3B for Oct-Dec 2025 covers the three months");
  ok(near(tot(tq.net), monthly.reduce((a, t) => a + tot(t.net), 0)) && near(tot(tq.netItc), monthly.reduce((a, t) => a + tot(t.netItc), 0)), "tax and credit are the three months added together");
  ok(!G.threeB("202511", "07").quarter, "a month inside the quarter has no 3B of its own");
  ok(JSON.stringify(G.creditIn("202511", "07")) === JSON.stringify(G.creditIn("202510", "07")), "credit is set off once, at the quarter end: the quarter's opening balance holds through it");
  ok(JSON.stringify(G.creditIn("202601", "07")) === JSON.stringify(tq.pay.carry), "January starts with what the quarter left");
  // PMT-06
  const sep = G.threeB("202509", "07"), p1 = Q.pmt06("202510", "07");
  ok(p1.method === "fixed" && p1.known && near(p1.total, H.reduce((a, h) => a + Math.round(sep.pay.cash[h]), 0), 1), "PMT-06, first quarter after monthly filing: all of September's cash, \u20b9" + p1.total);
  const pj = Q.pmt06("202601", "07");
  ok(near(pj.total, H.reduce((a, h) => a + Math.round(tq.pay.cash[h] * 0.35), 0), 1), "January (after a QRMP quarter): 35% of the quarter's cash, \u20b9" + pj.total);
  F.rec("202510", "07").pmtMethod = "self";
  ok(Q.pmt06("202510", "07").method === "self" && near(Q.pmt06("202510", "07").total, H.reduce((a, h) => a + Math.max(0, Math.round(G.threeBm("202510", "07").pay.cash[h])), 0), 1), "self-assessment: the month's own tax after credit");
  delete F.rec("202510", "07").pmtMethod;
  F.rec("202510", "07").pmt06 = {igst: 100000}; F.rec("202511", "07").pmt06 = {igst: 50000, cgst: 1000}; reset();
  const tq2 = G.threeB("202512", "07");
  ok(tq2.pmt.igst === 150000 && tq2.pmt.cgst === 1000 && near(tq2.cashAfter.igst, Math.max(0, tq2.pay.cash.igst - 150000)), "what was paid by PMT-06 is used first; \u20b9" + tq2.payable + " still to pay");
  // IFF and GSTR-1 for the quarter
  const f = Q.iff("202510", "07"), fval = (f.json.b2b || []).reduce((a, g) => a + g.inv.reduce((s, i) => s + i.val, 0), 0) + (f.json.cdnr || []).reduce((a, g) => a + g.nt.reduce((s, i) => s + i.val, 0), 0);
  ok(f.n > 0 && f.json.b2b && !f.json.b2cs && !f.json.hsn && f.json.fp === "102025", "IFF for October: " + f.n + " invoices to registered customers, no B2C or HSN");
  ok(f.over && fval <= 5000000 && f.left > 0 && f.keys.length === f.n + f.notes, "October's B2B is above \u20b950 lakh: the IFF carries the first \u20b9" + Math.round(fval) + " by date, " + f.left + " documents wait for the quarter");
  const r1 = Q.r1Q("202512", "07"), j = r1.json, idt = i => i.idt.split("-")[2] + i.idt.split("-")[1];
  const octIn = j.b2b.some(g => g.inv.some(i => idt(i) === "202510"));
  ok(j.fp === "122025" && octIn && j.b2b.some(g => g.inv.some(i => idt(i) === "202512")), "GSTR-1 for the quarter: period December, invoices from October to December");
  const txv = (jj, k) => (jj[k] || []).reduce((a, g) => a + (g.inv || g.nt || []).reduce((s, i) => s + i.itms.reduce((u, it) => u + it.itm_det.txval, 0), 0), 0);
  const sumM = ["202510", "202511", "202512"].reduce((a, m) => a + txv(G.toJson(m, "07", {plain: true}), "b2b"), 0);
  ok(near(txv(j, "b2b"), sumM, 1), "its B2B value equals the three months'");
  F.rec("202510", "07").iff = "2025-11-12";
  const r1b = Q.r1Q("202512", "07");
  const inQ = new Set(); (r1b.json.b2b || []).forEach(g => g.inv.forEach(i => inQ.add(Q.key(g.ctin, i.inum))));
  ok(f.keys.every(k => !inQ.has(k)) && r1b.skipped.join() === "202510" && (r1b.json.hsn || {}).hsn_b2b, "October's IFF documents are left out of the quarter's B2B, still in its HSN summary");
  const octAll = (G.toJson("202510", "07", {plain: true}).b2b || []).reduce((a, g) => a + g.inv.length, 0), octInQ = (r1b.json.b2b || []).reduce((a, g) => a + g.inv.filter(i => idt(i) === "202510").length, 0);
  ok(octInQ === octAll - f.n, "the October invoices that did not fit in the IFF go in the quarter's GSTR-1 (" + octInQ + ")");
  // IFF typed as filed after the 13th does not count: those invoices stay in the quarter's GSTR-1
  F.rec("202510", "07").iff = "2025-11-20";
  const r1late = Q.r1Q("202512", "07"), inLate = new Set(); (r1late.json.b2b || []).forEach(g => g.inv.forEach(i => inLate.add(Q.key(g.ctin, i.inum))));
  ok(!Q.iffFiled("202510", "07") && f.keys.every(k => inLate.has(k)), "an IFF typed as filed after 13 November does not count: its invoices stay in the quarter's GSTR-1");
  F.rec("202510", "07").iff = "2025-11-12";
  // amendments later: the IFF copy and the quarter's copy both count as filed, for all three months
  x.GSTAmend.keep(JSON.parse(JSON.stringify(f.json)), "downloaded", {iff: true});
  x.GSTAmend.keep(JSON.parse(JSON.stringify(r1b.json)), "downloaded", {quarter: "202510-202512"});
  const st = x.GSTAmend.state("07", "202601", false);
  ok(["202510", "202511", "202512"].every(m => st.periods.has(m)), "the IFF copy and the quarter's GSTR-1 copy stand as filed for October, November and December");
  ok(x.GSTAmend.pending("202601", "07").rows.filter(z => z.P >= "202510" && z.P <= "202512").length === 0, "so the next quarter reports no amendments for them while the books agree");
  // GSTR-1A: the whole quarter, at its end
  ok(!x.GSTAmend.can1a("202511", "07").period && x.GSTAmend.can1a("202511", "07").qrmpMonth && x.GSTAmend.can1a("202512", "07").period, "GSTR-1A for a QRMP filer is for the quarter, in December only");
  const k0 = Object.keys(b.filed).find(k => k.endsWith("|122025")), rec0 = b.filed[k0], g0 = rec0.json.b2b.find(g => g.inv.some(i => idt(i) === "202511")), i0 = g0.inv.find(i => idt(i) === "202511");
  i0.itms[0].itm_det.txval += 1000;
  const a1 = x.GSTAmend.json1a("202512", "07");
  ok(a1.rows.length === 1 && a1.rows[0].P === "202511", "a November invoice changed after the quarter's GSTR-1: GSTR-1A in December picks it up");
  i0.itms[0].itm_det.txval -= 1000; b.filed = {};
  // interest on what is still unpaid after PMT-06
  F.rec("202512", "07").r3b = "2026-02-03"; reset();
  const tqi = G.threeB("202512", "07"), itq = F.interest("202512", "07", tqi);
  ok(itq.days === 10 && near(itq.total, tqi.payable * 0.18 * 10 / 365, 1), "interest on the quarter's 3B filed 10 days late: on what was still unpaid after PMT-06, ₹" + itq.total);
  delete F.rec("202512", "07").r3b;
  const dq = F.drc("202512", "07", tqi);
  ok(dq.b.from === "books" && Math.abs(dq.b.gap) < 1, "DRC-01B for the quarter: GSTR-1 and 3B from the same quarter agree");
  // due dates and GSTR-9
  ok(F.due("202512", "r3b", "07") === "2026-01-24" && F.lateFee("202511", "07", "r3b", false).none, "Delhi quarter's 3B due 24 January; no 3B late fee inside the quarter");
  const g9 = x.GST9.build(x.GST9.fyOf("202603"), "07"), expect = G.months().filter(m => m >= "202504" && m <= "202603").reduce((a, m) => {
    const t = x.GSTSet.typeOf(m, "07") === "qrmp" ? (x.GSTSet.isQEnd(m) ? G.threeB(m, "07") : null) : G.threeBm(m, "07"); return a + (t ? ["igst", "cgst", "sgst"].reduce((s, h) => s + t.pay.cash[h], 0) : 0); }, 0);
  ok(near(["igst", "cgst", "sgst"].reduce((a, h) => a + g9.pay[h].cash, 0), expect, 2), "GSTR-9 table 9: a QRMP quarter's tax counted once, at its end");
  // 2B: the quarter's 2B holds the quarter; the first two months' 2Bs are then set aside
  x.GSTSet.store("07").filing = [{type: "qrmp", from: "202601"}]; reset();
  ["022026", "032026"].forEach(pp => { const t2 = x.GST2B.fromJson(JSON.parse(fs.readFileSync(DATA + "/returns_R2B_07AADCV3366N1ZU_" + pp + ".json", "utf8"))); b.twoBs[t2.gstin + "|" + t2.period] = t2; });
  const used = x.GST2B.all2b("07").map(t2 => t2.ym);
  ok(used.join() === "202603", "QRMP Jan-Mar: with the quarter's 2B (March) here, February's 2B is set aside, so no bill counts twice");
  x.GSTSet.store("07").filing = []; ok(x.GST2B.all2b("07").length === 2, "for a monthly filer both are used"); b.twoBs = {}; x.GST2B._memo = null;
  // composition
  x.GSTSet.store("07").filing = [{type: "comp", from: "202601"}]; reset();
  const c = Q.cmp08("202603", "07");
  let taxable = 0; ["202601", "202602", "202603"].forEach(m => G.outward(m, "07").forEach(r => { if (r.cls === "taxable") taxable += (r.kind === "CDNR" ? -1 : 1) * r.taxable; }));
  ok(near(c.turnover, taxable, 1) && near(c.tax, c.turnover * 0.01, 0.05) && near(c.cgst + c.sgst, c.tax), "CMP-08 Jan-Mar, trader: 1% of taxable sales, half CGST half SGST (\u20b9" + c.tax + ")");
  x.GSTSet.store("07").comp = "serv";
  ok(near(Q.cmp08("202603", "07").tax, Q.cmp08("202603", "07").turnover * 0.06, 0.05), "services under notification 2/2019: 6%");
  ok(F.due("202603", "cmp08", "07") === "2026-04-18", "CMP-08 due 18 April");
  const g4 = Q.gstr4("2025-26", "07");
  ok(g4.quarters.length === 4 && g4.t4.reg.taxable > 0 && g4.due === "2026-06-30", "GSTR-4 2025-26: four quarters, purchases in table 4, due 30 June");
  const src = fs.readFileSync(HTML, "utf8"), sv = (src.match(/async function saveBooks\(\)\{[\s\S]*?\}\); \}/) || [""])[0];
  ok(/\bgstApi: b\.gstApi\b/.test(sv) && Q.apiMode() === "save", "API returns: save only unless set to file; saved with the books");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})();
