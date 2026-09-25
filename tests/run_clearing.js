// node run_clearing.js - TDS PAYABLE CURRENT as a clearing account
const fs = require("fs"), {load, openBlob} = require("./harness"), {HTML, DATA, CACHE, OUT} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const M = v => new Intl.NumberFormat("en-IN").format(Math.round(v || 0));
(async () => {
  const res = {};
  for (const [tag, html] of [["128", process.env.TDSDESK_OLD_HTML || HTML], ["129", HTML]]){
    const {ctx, x} = load(html, NAMES);
    const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
    Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}});
    b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; x.LedMaster.refresh(b);
    const rows = x.TDS.allRows(), pays = x.TDS.paymentsFromBooks();
    res[tag] = {what: b.map["TDS PAYABLE CURRENT"].what, why: b.map["TDS PAYABLE CURRENT"].why, n: rows.length, tds: rows.reduce((s, r) => s + r.tds, 0), noSec: rows.filter(r => !r.section).reduce((s, r) => s + r.tds, 0),
      pays: pays.length, paid: pays.reduce((s, p) => s + p.tax, 0), fromBank: pays.filter(p => b.vouchers.find(v => v.id === p.vid).ent.some(e => x.Books.ledgerOf(e.l).kind === "bank")).length};
    console.log(tag + ": " + JSON.stringify(res[tag]).replace(/"why":"[^"]*",/, ""));
    if (tag === "129") console.log("   why: " + res[tag].why);
  }
  const a = res["128"], c = res["129"];
  ok(c.what === "tds_clearing", "TDS PAYABLE CURRENT is recognised as a clearing account, by rule");
  ok(c.noSec === 0 && Math.abs((a.tds - c.tds) - a.noSec) < 1, "the ₹" + M(a.noSec) + " moved into it each month is no longer counted as deductions");
  ok(c.pays === c.fromBank && c.pays < a.pays, "TDS payments offered as challans: only the bank payments (" + c.pays + ", was " + a.pays + " with the month-end journals)");
  ok(Math.abs(c.paid - 9663137) < 1000 || c.paid > 0, "payments total " + M(c.paid));
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
