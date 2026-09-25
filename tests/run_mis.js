// node run_mis.js - MIS on the VMS books, 2025-26
const fs = require("fs"), {load, openBlob} = require("./harness"), {HTML, DATA, CACHE, OUT} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const M = v => x.INR.format(Math.round(v || 0));
(async () => {
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; ctx.CO = () => ({name: "VMS EVENTS PRIVATE LIMITED"}); ctx.S.coId = "t";
  x.LedMaster.refresh(b);
  ok(Object.values(b.ledInfo).filter(i => i.msme).length === 17, "17 MSME suppliers read from the Udyam details in Tally");
  const t0 = Date.now(), r = x.MIS.run("20250401", "20260331", "test");
  console.log("ran in " + (Date.now() - t0) + " ms, code " + r.code);
  console.log("  sales " + M(r.sales.total) + ", customers " + r.sales.rows.length + ", top 5 share " + Math.round(r.sales.top5 / r.sales.total * 100) + "%");
  x.MIS.HEADS.forEach(([k, l]) => { const H = r.pl.heads[k]; if (H) console.log("  " + l.padEnd(28) + M(H.t).padStart(16) + "  (" + H.led.length + " ledgers)"); });
  console.log("  gross " + M(r.pl.gross.t) + ", PBT " + M(r.pl.pbt.t) + ", PAT " + M(r.pl.pat.t));
  console.log("  receivables " + M(r.recv.sum.total) + " buckets " + r.recv.sum.b.map(M).join(" / ") + ", before these books " + M(r.recv.sum.pre) + ", advances " + M(r.recv.sum.adv) + ", on account " + M(r.recv.sum.unalloc));
  console.log("  payables " + M(r.pay.sum.total) + " buckets " + r.pay.sum.b.map(M).join(" / ") + ", MSME past 45 days: " + r.msme.length + " suppliers " + M(r.msme.reduce((s, z) => s + z.amt, 0)));
  console.log("  received " + M(r.cash.rec) + ", paid " + M(r.cash.pay) + "; DSO " + r.dso + ", DPO " + r.dpo + "; purchases " + M(r.purchases.total) + ", expense heads jumped: " + r.purchases.heads.filter(h => h.jumps.length).length);
  console.log("  dues: " + r.dues.map(d => d[0] + " " + d[1]).join("; "));
  // revenue agrees with GSTR-1 sales (taxable, less credit notes) for the year
  const gst = x.GSTR.months().reduce((s, m) => { const o = x.GSTR.outward(m, ""); return s + o.reduce((a, z) => a + (z.kind === "CDNR" ? -1 : 1) * z.taxable, 0); }, 0);
  ok(Math.abs(r.sales.total - gst) < 1, "sales in the MIS agree with GST outward for the year: " + M(r.sales.total) + " / " + M(gst));
  ok(Math.abs(r.pl.heads.rev.t - r.sales.total) / r.sales.total < 0.02, "revenue in the profit and loss is within 2% of sales invoices (" + M(r.pl.heads.rev.t) + ")");
  const monthsSum = r.pl.months.reduce((s, m) => s + r.pl.pbt.m[m], 0);
  ok(Math.abs(monthsSum - r.pl.pbt.t) < 1, "the months add up to the period");
  const r2 = x.MIS.run("20250401", "20260331", "test");
  ok(r2.code === r.code, "run again: the same result code");
  const q = x.MIS.run("20250701", "20250930", "test");
  ok(q.prev && q.prev.sales > 0 && q.prevRange.join("-") === "20250401-20250630" && q.ly === null, "a quarter: compared with the quarter before; last year not in these books, so not shown");
  // bills: a party's bills add up to what the day book moved for it, less what was before these books
  const p = r.recv.rows[0]; console.log("  largest customer " + p.party + " " + M(p.total) + " in " + p.bills.length + " bills");
  ok(p.bills.reduce((s, z) => s + z.amt, 0) - p.total < 1, "a customer's bills add to its total");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
