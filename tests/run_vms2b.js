// node run_vms2b.js - VMS Delhi's February and March 2026 2B against the books
const fs = require("fs"), {load, openBlob} = require("./harness"), {HTML, DATA, CACHE} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "NORM_CACHE", "normName", "gramsOf", "normNameRaw", "nameSim"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
(async () => {
  const files = ["022026", "032026"].map(p => DATA + "/returns_R2B_07AADCV3366N1ZU_" + p + ".json");
  if (!files.every(f => fs.existsSync(f))){ console.log("  (VMS 2B files not here; skipped)\n\nall passed"); return; }
  const {ctx, x} = load(HTML, NAMES);
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}, twoBs: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; x.LedMaster.refresh(b);
  files.forEach(f => { const t = x.GST2B.fromJson(JSON.parse(fs.readFileSync(f, "utf8"))); b.twoBs[t.gstin + "|" + t.period] = t; });
  const feb = x.GST2B.scope("07", ["202602"]), mar = x.GST2B.scope("07", ["202603"]), res = x.GST2B.run("07");
  // the 2B read as the portal's own summary
  [["202602", 3646488.26, 1676603.6], ["202603", 5206576.27, 1573806.72]].forEach(([ym, ig, cg]) => {
    const t = x.GST2B.all2b("07").find(z => z.ym === ym), s = t.rows.filter(r => r.sec === "b2b" && r.itcavl !== "N" && !r.rcm).reduce((a, r) => ({i: a.i + r.igst, c: a.c + r.cgst}), {i: 0, c: 0});
    ok(Math.abs(s.i - ig) < 0.5 && Math.abs(s.c - cg) < 0.5, ym + ": available B2B credit read as the portal's summary");
  });
  // a bill, its reversal and the bill again at a new value: the reversed pair set aside, what is left matched
  const exp = res.reversed.filter(([a]) => /EXPLORE/i.test(a.party));
  ok(exp.length === 2, "Explore Marketing: EXP/IN 38 and 39 booked, reversed and booked again are set aside, not called duplicates (" + exp.length + ")");
  const e39 = feb.pairs.find(z => /EXPLORE/i.test(z.p.party) && /39/.test(z.p.no));
  ok(e39 && e39.status !== "probable" && e39.books.length === 1, "39/2025-26 in 2B matched to EXP/IN/39/2025-26 in Tally, the prefix allowed: " + (e39 && e39.status));
  // the same tax on a different value is a match, with a note
  const org = feb.pairs.filter(z => /ORAGMA/i.test(z.p.party));
  ok(org.length && org.every(z => z.status === "matched") && org.some(z => z.issues.some(i => /value differs/.test(i))), "Oragma: same tax, value differs (a part without GST): matched with a note");
  ok(feb.diff.length <= 2 && mar.diff.length <= 2, "differences down to what is real: February " + feb.diff.length + ", March " + mar.diff.length);
  // real duplicate
  ok(Object.values(res.dupes).length === 2 && res.books.filter(d => res.dupes[d.id]).every(d => /SUTARA/i.test(d.party)), "the one bill booked twice is found: Sutara Enterprises no. 21");
  // a bill in 2B booked without credit
  const ah = res.only2b.find(p => p.no === "571732");
  ok(ah && ah.bookedNoCredit && ah.itcavl !== "N", "Asian Hotels 571732: in 2B, available, booked in Tally with the tax charged to cost (" + (ah && ah.bookedNoCredit && ah.bookedNoCredit.party) + ")");
  const oos = res.only2b.filter(p => p.bookedNoCredit && p.itcavl === "N");
  ok(oos.length >= 10 && oos.every(p => p.rsn === "P"), "hotels in other states: not available in 2B (place of supply), expensed in Tally, and said to be right (" + oos.length + ")");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})();
