// node run_adv.js [html]  - reads DayBook.xml + Master.xml with the app's own reader, checks 11A/11B and 3B
const fs = require("fs"), {load, openBlob} = require("./harness"), {HTML, DATA, CACHE, OUT} = require("./harness");
const html = process.argv[2] || HTML;
const NAMES = ["num", "r2", "MONTHS", "fmtDate", "STATE_CODES", "Books", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "INR"];
const {ctx, x} = load(html, NAMES);

let fails = 0;
const ok = (cond, what) => { console.log((cond ? "  ok   " : "  FAIL ") + what); if (!cond) fails++; };
(async () => {
  let books;
  if (fs.existsSync(CACHE) && !process.argv.includes("--fresh")){
    books = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  } else {
    const t0 = Date.now();
    const db = await x.Books.importDayBook(await openBlob(DATA + "/DayBook.xml"));
    const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
    console.log("read in " + Math.round((Date.now() - t0) / 1000) + "s: " + db.vouchers.length + " vouchers, " + ms.count + " ledgers, " + Object.keys(ms.groups).length + " groups, " + Object.keys(ms.states).length + " states");
    books = {cid: "t", vouchers: db.vouchers, meta: db.meta, pans: ms.pans, gstins: ms.gstins, under: ms.under, states: ms.states, groups: ms.groups};
    fs.writeFileSync(CACHE, JSON.stringify(books));
  }
  books.map = x.Books.mapLedgers(books.vouchers, {});
  ctx.S.books = books;
  const S = ctx.S, A = x.GSTAdv, G = x.GSTR, R = x.GSTRev;
  console.log("vouchers " + books.vouchers.length + ", registrations " + books.meta.gstins.join(", ") + ", months " + G.months().join(" "));
  ok(books.meta.bills === 1, "day book read with bill allocations");
  const withBills = books.vouchers.filter(v => v.ent.some(e => e.b)).length;
  ok(withBills > 5000, "vouchers carrying bill allocations: " + withBills);
  // foreign-currency amounts: the export receipt of $17,000 is Rs 14,68,800
  const midas = books.vouchers.find(v => /RECEIPT/i.test(v.type) && v.date === "20250903" && v.ent.some(e => /MIDAS/.test(e.l)));
  ok(midas && midas.ent.some(e => e.a === 1468800), "forex amount read as rupees (14,68,800)");
  ok(x.GSTAdv.isCustomer("HINDUSTAN MEDIA VENTURES LTD", new Map()), "HMVL is a customer (Sundry Debtors)");
  ok(x.GSTAdv.isCustomer("MICROLAND COMPUTERS", new Map()), "Microland is a customer (HP PARTNER under Sundry Debtors)");
  ok(!x.GSTAdv.isCustomer("SIMPLYGREEN TECH PRIVATE LIMITED", new Map()), "Simplygreen (loan, creditors) is not a customer");
  const {pieces} = A.build();
  console.log("\nadvance pieces: " + pieces.length);
  pieces.forEach(p => console.log("  " + p.date + " " + p.party.slice(0, 30).padEnd(30) + " " + String(p.amount).padStart(11) + " " + (p.ref || "").padEnd(18) +
    " rate " + p.rate + " (" + p.rateFrom + ") reg " + p.reg + " pos " + p.pos + (p.taxed ? "" : "  [" + p.why + "]") +
    (p.adj.length ? "  adj: " + p.adj.map(a => a.ym + " " + a.amount + " " + a.how + " " + a.by).join("; ") : "")));
  // expected, from reading the vouchers by hand
  const find = (party, date) => pieces.find(p => p.party.startsWith(party) && p.date === date);
  const hmvlJan = find("HINDUSTAN MEDIA", "20260114");
  ok(hmvlJan && hmvlJan.adj.length === 1 && hmvlJan.adj[0].ym === "202602" && hmvlJan.adj[0].amount === 2389692.4, "HMVL 14 Jan advance adjusted by the 2 Feb invoice");
  const ws = pieces.filter(p => p.party === "WS IT SOLUTIONS");
  ok(ws.length === 2 && ws.reduce((s, p) => s + p.amount, 0) === 200000, "WS IT: 5,000 + 1,95,000 before the invoice are advances; later receipts are not");
  ok(ws.every(p => p.adj.every(a => a.ym === "202511")), "WS IT: billed in the same month, so neither 11A nor 11B");
  const midasP = pieces.find(p => /MIDAS/.test(p.party));
  ok(midasP && !midasP.taxed && midasP.zero, "Midas (export of services) left out of 11A");
  ok(!pieces.some(p => /SIMPLYGREEN|KARISHMA|OSCAR/.test(p.party)), "loans and supplier receipts not treated as advances");
  const scc = find("SCC ENTERTAINMENT", "20251204");
  ok(scc && scc.adj[0] && scc.adj[0].ym === "202512" && scc.reg === "09", "SCC: UP registration, billed in the same month");
  // month by month
  console.log("\nmonth      11A n  11A taxable    11A tax   11B n  11B taxable    11B tax   net tax");
  let atTot = 0, txTot = 0;
  G.months().forEach(m => (books.meta.gstins || []).forEach(g => {
    const reg = g.slice(0, 2), a = A.month(m, reg);
    if (!a.at.length && !a.txpd.length) return;
    const tx = s => s.igst + s.cgst + s.sgst;
    atTot += a.atSum.taxable; txTot += a.txpdSum.taxable;
    console.log(m + " " + reg + "  " + String(a.atSum.n).padStart(5) + String(a.atSum.taxable.toFixed(2)).padStart(13) + String(tx(a.atSum).toFixed(2)).padStart(11) +
      String(a.txpdSum.n).padStart(7) + String(a.txpdSum.taxable.toFixed(2)).padStart(13) + String(tx(a.txpdSum).toFixed(2)).padStart(11) + String(tx(a.net).toFixed(2)).padStart(11));
  }));
  // Jan 2026, Delhi: HMVL 23,89,692.40 at 18% intra-state? HMVL GSTIN is 09 (UP) and the invoice is 07: inter-state
  const jan = A.month("202601", "07");
  const hj = jan.at.find(r => r.party.startsWith("HINDUSTAN"));
  ok(hj && hj.rate === 18 && hj.inter && Math.abs(hj.taxable - 2025163.05) < 0.02 && Math.abs(hj.igst - 364529.35) < 0.02, "Jan 11A: HMVL 23,89,692.40 -> 20,25,163.05 + IGST 3,64,529.35");
  const feb = A.month("202602", "07");
  const hf = feb.txpd.find(r => r.party.startsWith("HINDUSTAN"));
  ok(hf && Math.abs(hf.igst - hj.igst) < 0.01, "Feb 11B takes back the same IGST");
  // 3B carries the net into 3.1(a)
  const t = G.threeB("202601", "07"), base = G.sum(G.outward("202601", "07").filter(r => r.cls === "taxable" && r.kind !== "CDNR"));
  ok(Math.abs(t.net.igst - (base.igst - t.cn.igst + jan.net.igst)) < 0.01, "3B 3.1(a) includes 11A less 11B");
  const j1 = G.toJson("202601", "07");
  ok(j1.at && j1.at.length && j1.at.some(g => g.itms.some(i => i.rt === 18 && i.ad_amt > 0 && i.iamt > 0)), "GSTR-1 JSON has an at section with ad_amt and iamt");
  const j2 = G.toJson("202602", "07");
  ok(j2.txpd && j2.txpd.length, "GSTR-1 JSON for Feb has a txpd section");
  const b3 = G.threeBJson("202601", "07");
  ok(b3.itc_elg.itc_rev.some(r => r.ty === "RUL"), "3B JSON has a RUL line for 4(B)(1)");
  // Rule 42: mark one input ledger as common and check the arithmetic by hand
  const inLed = Object.entries(books.map).filter(([, m]) => m.kind === "gst" && m.side === "input").sort((a, c) => c[1].n - a[1].n);
  console.log("\ninput GST ledgers: " + inLed.slice(0, 6).map(([n, m]) => n + " (" + m.tax + "/" + (m.reg || "?") + ", " + m.n + ")").join("; "));
  const [cname, cm] = inLed.find(([, m]) => m.tax === "IGST") || inLed[0];
  const before = G.threeB("202506", "07");
  cm.kind = "gst_common"; books.mapV = 1;
  const r42 = R.rule42("202506", "07"), tt = R.turnover("202506", "07");
  console.log("Jun 2025 07: turnover", JSON.stringify(tt), "C2", JSON.stringify(r42.C2), "share", r42.share.toFixed(6));
  ok(r42.n > 0 && R.total(r42.C2) > 0, "common credit found on " + cname);
  const h = cm.tax.toLowerCase();
  ok(Math.abs(r42.D1[h] - r2(r42.C2[h] * tt.exempt / tt.total)) < 0.011, "D1 = C2 x E / F");
  ok(Math.abs(r42.D2[h] - r2(r42.C2[h] * 0.05)) < 0.011, "D2 = 5% of C2");
  const after = G.threeB("202506", "07");
  ok(Math.abs((before.netItc[h] - after.netItc[h]) - r42.reverse[h]) < 0.02, "3B net ITC falls by D1 + D2");
  ok(Math.abs(after.itc[h] - before.itc[h]) < 0.01, "common credit still counts as availed in 4(A)(5)");
  S.books.rev = {d2: false}; ok(R.rule42("202506", "07").D2[h] === 0, "D2 off when there is no non-business use"); S.books.rev = null;
  // Rule 43: an asset of Rs 1,80,000 IGST put to use in May 2025
  books.assets = [{id: "a1", name: "Projector", date: "2025-05-10", igst: 180000, cgst: 0, sgst: 0, cess: 0, use: "common", reg: "07"},
                  {id: "a2", name: "Car", date: "2025-05-10", igst: 50000, use: "exempt", reg: "07"}];
  const r43 = R.rule43("202506", "07");
  ok(r43.Tr.igst === 3000, "Tm = 1,80,000 / 60 = 3,000 a month");
  ok(Math.abs(r43.Te.igst - r2(3000 * tt.exempt / tt.total)) < 0.011, "Te = Tr x E / F");
  ok(R.rule43("202504", "07").Tr.igst === 0, "nothing before it is put to use");
  ok(R.tm(books.assets[0], "203005") === null && R.tm(books.assets[0], "203004") !== null, "60 months: May 2025 to Apr 2030, none after");
  ok(R.tm(books.assets[1], "202506") === null, "a good used only for exempt supplies is left out");
  const y = R.year("202506", "07");
  ok(y.rows.length >= 1 && Math.abs(R.total(y.annual) - r2(R.total(y.C2) * y.E / y.F)) < 1, "rule 42(2) annual D1 on the year's turnover");
  console.log("  year " + y.fy + ": C2 " + R.total(y.C2) + " E/F " + (y.share * 100).toFixed(3) + "% annual D1 " + R.total(y.annual) + " monthly D1 " + R.total(y.monthly) + " diff " + R.total(y.diff));
  console.log("\n" + (fails ? fails + " FAILED" : "all passed"));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
function r2(n){ return Math.round((n + Number.EPSILON) * 100) / 100; }
