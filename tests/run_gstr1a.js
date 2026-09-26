// node run_gstr1a.js - GSTR-1A: the month's own differences after its GSTR-1, before its 3B
const fs = require("fs"), {load, openBlob, HTML, DATA, CACHE} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "normName", "ITCT", "GSTSet", "CustIMS", "GSTF", "CO"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
(async () => {
  const {ctx, x} = load(HTML, NAMES);
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}, twoBs: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; x.LedMaster.refresh(b);
  ctx.S.companies = {c: {id: "c", name: "VMS Events Pvt Ltd", gstin: "07AADCV3366N1ZU"}}; ctx.S.coId = "c";
  const A = x.GSTAmend, ym = "202603", reg = "07";
  // the GSTR-1 "as filed": the books' own, with one B2B invoice left out and another's value changed
  const filed = JSON.parse(JSON.stringify(x.GSTR.toJson(ym, reg, {plain: true})));
  const g0 = filed.b2b.find(g => g.inv.length >= 2), left = g0.inv.shift(), changed = g0.inv[0];
  changed.itms[0].itm_det.txval = Math.round(changed.itms[0].itm_det.txval + 1000);
  A.keep(filed, "portal");
  let c = A.can1a(ym, reg);
  ok(c.period && c.filed1 && !c.threeB, "March 2026: GSTR-1 filed, 3B not yet \u2014 GSTR-1A is open (due " + c.due + ")");
  const r = A.json1a(ym, reg), kinds = r.rows.map(z => z.what).sort().join(",");
  ok(r.rows.length === 2 && kinds === "amend,missing", "GSTR-1A has the invoice left out and the one changed");
  const J = r.json;
  ok((J.b2b || []).some(g => g.inv.some(i => i.inum === left.inum)) && (J.b2ba || []).some(g => g.inv.some(i => i.oinum === changed.inum)), "the missed invoice in b2b, the corrected one in b2ba, for period " + J.fp);
  const later = () => A.pending("202604", reg).rows.filter(z => z.P === ym).length;
  const beforeKeep = later();
  A.keep1a(Object.assign({version: "GST3.2.1", hash: "hash"}, J));
  ok(A.json1a(ym, reg).rows.length === 0, "once GSTR-1A is kept, the books agree with the month as filed");
  ok(beforeKeep === 2 && later() === 0, "and the next GSTR-1 does not report them again (" + beforeKeep + " before, " + later() + " after)");
  delete b.filed1a;
  x.GSTF.rec(ym, reg).r3b = "2026-04-20";
  ok(A.can1a(ym, reg).threeB, "3B filed: GSTR-1A closes, the differences go in the next GSTR-1");
  ok(!A.can1a("202406", reg).period, "before the July 2024 period there is no GSTR-1A");
  // e-invoices: no check for a client that does not make them in Tally; listed once any voucher carries an IRN
  ok(!x.GSTF.einv(ym, reg).uses && !x.GSTR.checks(ym, reg).some(z => /IRN/.test(z.what)), "VMS's books carry no IRN: no e-invoice check, rather than every invoice flagged");
  const sales = b.vouchers.filter(v => x.Books.isSale(v) && x.GSTR.regOf(v) === reg && x.GSTR.ym(v.date) === ym && v.gstin && !/NOTE/i.test(v.type));
  sales.forEach((v, i) => { if (i < sales.length - 2){ v.irn = "irn" + i; v.irnDate = v.date; } });
  sales[0].irnDate = x.GSTR.nextYm(ym) + "28";
  const e = x.GSTF.einv(ym, reg);
  ok(e.uses && e.missing.length >= 2 && e.late.length === 1, "with IRNs in Tally: invoices without one (" + e.missing.length + ") and one taken more than 30 days late are listed");
  ok(x.GSTR.checks(ym, reg).some(z => /without an e-invoice/.test(z.what)), "and they show in the GSTR-1 checks");
  sales.forEach(v => { delete v.irn; delete v.irnDate; });
  const rd = fs.readFileSync(HTML, "utf8");
  ok(/irn: this\.one\(s, "IRN"\), irnDate: this\.one\(s, "IRNACKDATE"\)/.test(rd), "the day book reader keeps each voucher's IRN and acknowledgement date");
  const src = fs.readFileSync(HTML, "utf8"), sv = (src.match(/async function saveBooks\(\)\{[\s\S]*?\}\); \}/) || [""])[0];
  ok(/\bfiled1a: b\.filed1a\b/.test(sv), "GSTR-1A copies are saved with the books");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})();
