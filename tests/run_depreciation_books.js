// node run_depreciation_books.js - the fixed asset register on the made-up books of tests/fixtures/books, through the app's
// own code (FAR.refresh in src/js/80-assets.js, with Books, Audit and FSX as the program has them). Test data only.
//   1. the register is proposed from the ledgers under Fixed Assets with their openings and the year's entries; saved
//      with the books as b.fixedAssets["2025"]; the books themselves (the vouchers) are not changed
//   2. read again, what was changed by hand is kept
//   3. the statements' details for the year (FSX.inputFromBooks) take the register's classes and blocks, and the Form 3CD
//      draft's clause 18 its blocks
const fs = require("fs"), crypto = require("crypto"), {load, openBlob, HTML, DATA, CACHE} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "FSX", "FAR"];
const src = fs.readFileSync(HTML, "utf8");
const names = NAMES.concat(/\nconst AuditWP\b/.test(src) ? ["AuditWP", "GSTCMP", "AS26"].filter(n => n === "AuditWP" || new RegExp("\\nconst " + n + "\\b").test(src)) : []);
const {ctx, x} = load(HTML, names);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
(async () => {
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, states: ms.states, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}, cid: "t"});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; ctx.S.companies = {t: {id: "t", name: "Larkspur Fixture Events Private Limited", pan: "AAACL1234L"}}; ctx.CO = () => ctx.S.companies.t; ctx.S.coId = "t"; ctx.S.data = {};
  ctx.TextEncoder = TextEncoder;
  x.LedMaster.refresh(b);
  const hash = () => crypto.createHash("sha256").update(JSON.stringify(b.vouchers)).digest("hex");
  const before = hash();
  const fy = "2025";
  const fa = Object.keys(b.under).filter(l => /^fixed assets$/i.test(x.Books.groupPath(l).slice(-1)[0] || ""));
  const reg = x.FAR.refresh(b, fy);
  ok(!reg.error, "1. proposed: " + (reg.error || reg.assets.length + " assets"));
  ok(reg.assets.length === fa.filter(l => !x.FAR.isAccDep(l)).length && reg.assets.length >= 2 && b.fixedAssets[fy] === reg, "1. every ledger under Fixed Assets is an asset (" + reg.assets.map(a => a.ledger).join(", ") + "), kept as b.fixedAssets['2025']");
  const bal = x.Audit.balances(fy + "0401", "20260331"), open = bal.at(x.Audit.dayBefore(fy + "0401"));
  ok(reg.assets.every(a => Math.round(a.bookOpen * 100) === Math.round(-(open[a.ledger] || 0) * 100)), "1. each asset's opening is its ledger's opening on 01-04-2025");
  const dr = l => b.vouchers.filter(v => v.date >= "20250401" && v.date <= "20260331" && !v.opt && !v.cancel).reduce((s, v) => s + v.ent.filter(e => e.l === l && e.a < 0).reduce((t, e) => t - e.a, 0), 0);
  ok(reg.assets.every(a => Math.round(a.adds.reduce((s, m) => s + m.amount, 0) * 100) === Math.round(dr(a.ledger) * 100)), "1. the year's debits are the additions (" + reg.assets.map(a => a.ledger + " " + a.adds.length).join(", ") + ")");
  ok(reg.assets.find(a => /laptop/i.test(a.ledger)).cls === "computer_eud" && reg.assets.find(a => /software/i.test(a.ledger)).cls === "intang_software", "1. the laptops are computers; the software licence an intangible asset");
  ok(hash() === before, "1. the books (the vouchers) are not changed");
  // 2. by hand, then read again
  const sw = reg.assets.find(a => /software/i.test(a.ledger)); sw.life = 5; sw.lifeWhy = "licence term"; reg.settings.method = "SLM";
  const again = x.FAR.refresh(b, fy);
  ok(again.assets.find(a => a.id === sw.id).life === 5 && again.settings.method === "SLM", "2. read again: the life of 5 years and the method typed by hand are kept");
  // 3. the statements and the 3CD
  const res = x.FAR.forYear(b, fy);
  const inp = x.FSX.inputFromBooks(fy, {kind: "company"});
  ok(!inp.error && inp.det.farFrom === "register" && JSON.stringify(inp.det.far.cy) === JSON.stringify(res.far) && JSON.stringify(inp.det.itBlocks.cy) === JSON.stringify(res.itRows), "3. the statements' details take the register's classes (" + res.far.length + ") and blocks (" + res.itRows.length + ")");
  const r = x.FSX.taxAuditFromBooks(fy), c18 = r.d3.clauses.find(c => c.no === "18");
  ok(c18.src === "books" && JSON.stringify(c18.rows) === JSON.stringify(res.rows3cd) && c18.rows.length >= 1, "3. Form 3CD clause 18: the register's blocks (" + c18.rows.map(z => z[0] + ": " + z[5]).join("; ") + ")");
  // the year-end journal crediting both assets from Depreciation (voucher 74) is depreciation booked, not a disposal; the
  // block: 80,000 (10-07-2025) + 1,20,000 (12-08-2025), both 180 days or more, at 40% = 80,000, closing 1,20,000
  ok(reg.assets.every(a => a.moves.every(m => m.kind === "dep")) && reg.assets.reduce((t, a) => t + a.bookedDep, 0) === 60000, "3. the year-end depreciation journal on both assets is depreciation booked (60,000), not a transfer");
  const pb = res.blocks.find(z => z.k === "pm40");
  ok(pb.addGt180 === 200000 && pb.dep === 80000 && pb.close === 120000 && !pb.empty, "3. the 40% block worked by hand: 80,000, closing 1,20,000");
  ok(hash() === before, "3. still no change to the books");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
