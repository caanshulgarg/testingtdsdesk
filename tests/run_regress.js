// node run_regress.js  - the same day book through build 116 and the new source; everything outside
// advances and reversal must come out the same (the one expected change: foreign-currency amounts)
const {load, openBlob} = require("./harness"), {HTML, DATA, CACHE, OUT} = require("./harness");
const NAMES = ["num", "r2", "MONTHS", "fmtDate", "STATE_CODES", "Books", "GSTR", "INR"];
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
(async () => {
  const old = load(process.env.TDSDESK_OLD_HTML || HTML, NAMES);
  const neu = load(HTML, NAMES.concat(["GSTAdv", "GSTRev"]));
  for (const h of [old, neu]){
    const db = await h.x.Books.importDayBook(await openBlob(DATA + "/DayBook.xml"));
    h.ctx.S.books = {cid: "t", vouchers: db.vouchers, meta: db.meta};
    h.ctx.S.books.map = h.x.Books.mapLedgers(db.vouchers, {});
  }
  const forex = v => v.ent.some(e => /MIDAS|HP CANADA|FZ LLC/i.test(e.l)) || /EXPORT/i.test(v.type);
  const months = neu.x.GSTR.months();
  let diffs = 0;
  months.forEach(m => [""].forEach(reg => {
    const a = old.x.GSTR.one(m, reg), c = neu.x.GSTR.one(m, reg);
    ["b2b", "b2cl", "b2c", "cdnr", "nil"].forEach(k => {
      const sa = old.x.GSTR.sum(a[k]), sc = neu.x.GSTR.sum(c[k]);
      if (Math.abs(sa.taxable - sc.taxable) > 0.01 || Math.abs(sa.igst - sc.igst) > 0.01 || Math.abs(sa.cgst - sc.cgst) > 0.01){ diffs++; console.log("  diff " + m + " " + reg + " " + k, JSON.stringify(sa), JSON.stringify(sc)); }
    });
    const ta = old.x.GSTR.threeB(m, reg), tc = neu.x.GSTR.threeB(m, reg);
    ["igst", "cgst", "sgst"].forEach(hd => {
      if (Math.abs(ta.itc[hd] - tc.itc[hd]) > 0.01){ diffs++; console.log("  itc diff " + m + " " + reg + " " + hd, ta.itc[hd], tc.itc[hd]); }
      if (Math.abs(ta.netItc[hd] - tc.netItc[hd]) > 0.01){ diffs++; console.log("  net itc diff " + m + " " + reg + " " + hd, ta.netItc[hd], tc.netItc[hd]); }
      const advTax = tc.adv[hd];
      if (Math.abs((tc.net[hd] - advTax) - ta.net[hd]) > 0.01){ diffs++; console.log("  3.1(a) diff beyond advances " + m + " " + reg + " " + hd, ta.net[hd], tc.net[hd], advTax); }
    });
    const za = ta.zero.taxable, zc = tc.zero.taxable;
    if (Math.abs(za - zc) > 0.01) console.log("  exports " + m + " " + reg + ": build 116 " + za + ", now " + zc + " (foreign currency now read as rupees)");
  }));
  ok(diffs === 0, "both registrations together: GSTR-1 parts, ITC and 3.1(a) apart from advances are the same as build 116");
  // per registration, ITC moves where Tally's voucher GSTIN disagreed with the tax ledger's registration
  ["07", "09"].forEach(reg => { let a = 0, c = 0; months.forEach(m => { a += old.x.GSTR.threeB(m, reg).itc.cgst + old.x.GSTR.threeB(m, reg).itc.igst; c += neu.x.GSTR.threeB(m, reg).itc.cgst + neu.x.GSTR.threeB(m, reg).itc.igst; });
    console.log("  ITC (IGST + CGST) for the year, " + reg + ": build 116 " + a.toFixed(2) + ", now " + c.toFixed(2)); });
  // exports: build 116 read "$29500.00 @ 87.75/$ = -Rs 2588625.00" as 29500.0087; now it is 25,88,625
  const exOld = old.x.GSTR.sum(old.x.GSTR.outward("", "").filter(r => r.cls === "export")), exNew = neu.x.GSTR.sum(neu.x.GSTR.outward("", "").filter(r => r.cls === "export"));
  console.log("  exports for the year: build 116 " + exOld.taxable + ", now " + exNew.taxable);
  ok(exNew.taxable > exOld.taxable * 10, "exports in foreign currency now carry their rupee value");
  // a month with exempt turnover, and one with none (rule 42(1)(h))
  const S = neu.ctx.S, G = neu.x.GSTR, R = neu.x.GSTRev;
  const jun = S.books.vouchers.filter(v => G.ym(v.date) === "202506" && neu.x.Books.isSale(v) && G.regOf(v) === "07");
  jun.slice(0, 5).forEach(v => { v.taxability = "Exempt"; });
  const inName = Object.entries(S.books.map).find(([n, m]) => m.kind === "gst" && m.side === "input" && m.tax === "IGST" && m.reg === "07")[0];
  S.books.map[inName].kind = "gst_common"; S.books.mapV = 9;
  const t = R.turnover("202506", "07"), r = R.rule42("202506", "07");
  console.log("  Jun 2025 with 5 invoices made exempt: E " + t.exempt + " F " + t.total + " E/F " + (r.share * 100).toFixed(4) + "% C2 " + r.C2.igst + " D1 " + r.D1.igst + " D2 " + r.D2.igst);
  ok(t.exempt > 0 && Math.abs(r.D1.igst - Math.round(r.C2.igst * t.exempt / t.total * 100) / 100) < 0.011 && r.D1.igst > 0, "D1 on real common credit and exempt turnover");
  const oTot = neu.x.GSTR.threeB("202506", "07");
  ok(Math.abs(oTot.rules.igst - r.reverse.igst) < 0.011, "3B 4(B)(1) carries D1 + D2");
  // a month with no turnover takes the last month that had some
  const realOut = G.outward;
  G.outward = (ym, reg) => ym === "202507" ? [] : realOut.call(G, ym, reg);
  const q = R.ratio("202507", "07");
  G.outward = realOut;
  ok(q.from === "202506" && q.E === t.exempt, "no turnover in July: E and F of June are used");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed"));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
