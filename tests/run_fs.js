// node run_fs.js - financial statements on the VMS books (opening balances from the masters, as at the start of the year)
const {load, openBlob, HTML, DATA, CACHE} = require("./harness"), fs = require("fs");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "FS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const M = v => x.INR.format(Math.round(v || 0));
(async () => {
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; ctx.CO = () => ({name: "VMS EVENTS PRIVATE LIMITED"}); x.LedMaster.refresh(b);
  ok(ms.groupInfo["EMPLOYEE BENEFIT EXPENSES"] && ms.groupInfo["EMPLOYEE BENEFIT EXPENSES"].rev && ms.groupInfo["EMPLOYEE BENEFIT EXPENSES"].dr, "the company's own primary group EMPLOYEE BENEFIT EXPENSES is read as an expense");
  const pl = x.MIS.pl("20250401", "20260331");
  console.log("  MIS employee costs " + M((pl.heads.emp || {t: 0}).t) + ", finance costs " + M((pl.heads.fin || {t: 0}).t));
  ok((pl.heads.emp || {t: 0}).t > 1000000, "MIS now counts the ledgers in the company's own primary groups");
  // Tally's balances, as the bridge would give them, taking the masters' opening balances as at 1 April 2025
  const led = {}; Object.entries(b.ledInfo).forEach(([n, i]) => { led[n] = {open: i.ob || 0, close: 0, parent: i.group}; });
  b.tb = {from: "20250401", to: "20260331", at: new Date().toISOString(), led};
  const d = x.FS.build("2025");
  if (d.error){ console.log(d.error); process.exit(1); }
  console.log("  equity and liabilities " + M(d.eqL) + ", assets " + M(d.assets) + ", difference " + M(d.diff) + "; profit for the year " + M(d.pat));
  d.lines.forEach(z => { if (d.put[z[0]]) console.log("   " + z[2].padEnd(4) + z[1].padEnd(34) + M(d.put[z[0]]).padStart(16) + "   last year " + M((d.py || {})[z[0]])); });
  x.FS.PL.forEach(([k, l]) => { if (d.pl[k]) console.log("   P&L " + l.padEnd(38) + M(d.pl[k]).padStart(16)); });
  ok(Math.abs(d.diff) < 1, "the balance sheet tallies");
  ok(Math.abs(d.pbt - x.MIS.pl("20250401", "20260331").pbt.t) < 1, "profit before tax agrees with the MIS");
  ok(d.put.tr > 0 && d.put.tp > 0 && d.put.cash > 0, "trade receivables, trade payables and cash placed");
  const pyEq = d.lines.filter(z => ["EQ", "NCL", "CL"].includes(z[2])).reduce((a, z) => a + (d.py[z[0]] || 0), 0), pyAs = d.lines.filter(z => ["NCA", "CA"].includes(z[2])).reduce((a, z) => a + (d.py[z[0]] || 0), 0);
  ok(Math.abs(pyEq - pyAs) < 1, "last year's column tallies too: " + M(pyEq) + " / " + M(pyAs));
  // a supplier in debit is an advance; a customer in credit is an advance received
  const adv = (d.det.stla || []).some(([l]) => x.Audit.isCreditor(l)), advR = (d.det.ocl || []).some(([l]) => x.Audit.isDebtor(l));
  ok(adv && advR, "suppliers in debit shown as advances paid, customers in credit as advances received");
  // non-corporate: owners' capital
  b.fs = {kind: "nc"}; const n = x.FS.build("2025");
  ok(Math.abs(n.diff) < 1 && /Owners' funds/.test(x.FS.html(n)), "the non-corporate format tallies and shows owners' funds");
  b.fs = {kind: "co", stock: {open: 100000, close: 250000}};
  const s2 = x.FS.build("2025");
  ok(Math.abs(s2.diff) < 1 && Math.abs(s2.pat - d.pat - 150000) < 1 && s2.put.inv >= 250000, "typed stock: inventories 2,50,000, profit up by 1,50,000, still tallies");
  ok(/Schedule III/.test(x.FS.html(d)) && /Note 1\./.test(x.FS.html(d)), "the statements render with notes");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
