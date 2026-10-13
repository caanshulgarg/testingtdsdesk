// node run_prefiling.js - "Check before filing" (src/js/76-prefiling.js) on the made-up books of tests/fixtures/books, with
// counts and amounts worked out by hand from the vouchers (tests/fixtures/books/EXPECTED.md), and the owner's condition that
// it cannot change a return: the 26Q text file, the GSTR-1 and GSTR-3B JSON and the TDS rows are byte-identical before and
// after the check runs, and with FinCom Assistant switched on and off.
const fs = require("fs"), path = require("path"), {load, openBlob, HTML, FIXTURE_DIR, FIXTURE_CACHE} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "TDS_FORMS", "PAY_CODES", "GSTIN_RE", "Books", "LedMaster", "Audit", "MIS", "TDS", "TDSInt", "TDSFiled", "Certs", "GSTR", "GSTAdv", "GSTRev",
  "GSTAmend", "GST2B", "GSTSet", "GSTF", "GSTQ", "GSTV", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gfN", "Parties", "FS", "TDS26Q", "AS26", "PreFile", "D"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
(async () => {
  let ld, names = NAMES.slice();
  for (;;) { try { ld = load(HTML, names); break; } catch (e) { const missing = String(e.message).replace("not found: ", ""); if (!names.includes(missing) || missing === "PreFile") throw e; names = names.filter((n) => n !== missing); console.log("    (not in this build: " + missing + ")"); } }
  const {ctx, x} = ld;
  if (!fs.existsSync(FIXTURE_CACHE)) require("child_process").execFileSync(process.execPath, [path.join(__dirname, "fixture_cache.js"), FIXTURE_CACHE], {stdio: "inherit"});
  const b = JSON.parse(fs.readFileSync(FIXTURE_CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(path.join(FIXTURE_DIR, "Master.xml")));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, gstins: ms.gstins, pans: ms.pans, states: ms.states, challans: [], alloc: {}, cid: "t"});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; ctx.S.coId = "t";
  ctx.S.companies = {t: {id: "t", name: "Larkspur Fixture Events Private Limited", gstin: "07AAGCL4827M1Z3", tan: "DELL12345A", choices: {}}};
  ctx.CO = () => ctx.S.companies.t; ctx.S.firm = {firmName: "Test firm"}; ctx.S.data = {t: {parties: {}, entries: {}, loaded: true}};
  x.LedMaster.refresh(b);
  // the 2Bs of the fixture, as the 2B page keeps them
  b.twoBs = {};
  for (const f of fs.readdirSync(FIXTURE_DIR).filter((n) => /^returns_R2B_/.test(n))) { const t = x.GST2B.fromJson(JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), "utf8"))); b.twoBs[t.gstin + "|" + t.period] = t; }
  // one challan for February's deposit of May's and November's TDS, tagged to those deductions (as the TDS page does)
  const rows = x.TDS.rows();
  const may = rows.filter((r) => r.fy === "2025-26" && /^202505/.test(r.date)), nov = rows.filter((r) => r.fy === "2025-26" && /^202511/.test(r.date));
  // May's (paid late, on 07-Feb-2026, through the month-end account) and, for a 26Q file to build, November's (on time)
  b.challans = [{id: "ch1", date: "20260207", bsr: "0510308", serial: "00417", tax: 4000, interest: 300, total: 4300, section: "194C", kind: "200"},
                {id: "ch2", date: "20251205", bsr: "0510308", serial: "00398", tax: 6000, interest: 0, total: 6000, section: "194J", kind: "200"}];
  may.forEach((r) => { b.alloc[r.id] = "ch1"; }); nov.forEach((r) => { b.alloc[r.id] = "ch2"; });
  x.PreFile.today = () => "20261013";
  // ---- what the returns are, before the check
  const outputs = () => JSON.stringify({
    rows: x.TDS.rows().map((r) => [r.id, r.date, r.party, r.section, r.paid, r.tds, r.challan || ""]),
    q1: x.TDS26Q.build("2025-26", "Q1", {name: "Test firm"}, "26Q"), q3: x.TDS26Q.build("2025-26", "Q3", {name: "Test firm"}, "26Q"), q4: x.TDS26Q.build("2025-26", "Q4", {name: "Test firm"}, "26Q"),
    r1: x.GSTR.toJson("202603", "07"), b3: x.GSTR.threeBJson("202603", "07"), r1jun: x.GSTR.toJson("202506", "09"),
  }, (k, v) => (k === "fp" || /date$/i.test(k) && typeof v === "string" && /^\d{2}-?\d{2}-?\d{4}$/.test(v) && v !== "" ? v : v));
  const before = outputs();
  // ---- the TDS quarter Q4 2025-26 (Jan to Mar 2026)
  const t = x.PreFile.tds("26Q", "2025-26", "Q4");
  const L = Object.fromEntries(t.lines.map((l) => [l.id, l]));
  console.log("  26Q Q4: " + t.lines.map((l) => l.id + " " + l.status + (l.count ? " " + l.count : "")).join(" · "));
  ok(t.from === "20260101" && t.to === "20260331", "Q4 2025-26 is 01-Jan-2026 to 31-Mar-2026");
  ok(L.missed.status === "fix" && L.missed.count === 1 && L.missed.findings[0].rows[0].party === "Ashvattha Transport Co" && L.missed.findings[0].rows[0].amount === 40000, "missed: Ashvattha's freight of 40,000 (194C limit 30,000), no TDS");
  const unpaid = L.challan.findings.flatMap((f) => f.rows);
  ok(L.challan.status === "fix" && unpaid.length === 3 && unpaid.map((r) => r.amount).sort((a, c) => a - c).join(",") === "2000,3000,3000", "challans: the quarter's three deductions (3,000 Jan, 3,000 Feb, 2,000 Mar) not against a challan");
  const late = L.late.findings[0].rows;
  ok(L.late.status === "fix" && late.length === 3, "late: three unpaid deductions past their due date, with interest to today (" + late.map((r) => r.amount + " " + r.note).join("; ") + ")");
  // interest at 1.5% a month, a part month counted whole, from the deduction to 13-Oct-2026: Jan 3,000 x 10 = 450; Feb 3,000 x 9 = 405; Mar 2,000 x 8 = 240
  ok(late.map((r) => r.amount).sort((a, c) => a - c).join(",") === "240,405,450" && L.late.amount === 1095, "interest worked out: 450 + 405 + 240 = 1,095");
  ok(L.pan.status === "ok", "206AA: every deductee has a PAN");
  ok(L.as26.status === "na", "26AS: none uploaded, so it does not apply (" + L.as26.note + ")");
  ok(L.dup.status === "ok", "duplicates: none in Q4");
  // Q1 holds the duplicate bill and May's late payment through the month-end account
  const t1 = x.PreFile.tds("26Q", "2025-26", "Q1"), L1 = Object.fromEntries(t1.lines.map((l) => [l.id, l]));
  ok(L1.dup.status === "fix" && L1.dup.findings.some((f) => f.rows.some((r) => r.no === "5")), "Q1: NSL/112 entered twice (voucher 5)");
  const l1 = L1.late.findings[0].rows;
  ok(l1.length === 2 && l1.every((r) => /paid 07-Feb-2026/.test(r.note) && r.amount === 300), "Q1: May's two deductions of 2,000 paid late on 07-Feb-2026: 10 months at 1.5%, 300 each (" + l1.map((r) => r.amount).join(", ") + ")");
  ok(L.rate.status === "ok", "Q4: no deduction at a lower rate (" + L.rate.note + ")");
  // ---- the GST month March 2026, Delhi
  const g = x.PreFile.gst("07", "202603");
  const G = Object.fromEntries(g.lines.map((l) => [l.id, l]));
  console.log("  GST Mar-2026 07: " + g.lines.map((l) => l.id + " " + l.status + (l.count ? " " + l.count : "")).join(" · "));
  ok(G["2b"].status !== "error" && G.rcm.status !== "error" && G.blocked.status !== "error" && G.rule37.status !== "error", "GST checks run");
  const g2 = x.PreFile.gst("07", "202602"), G2 = Object.fromEntries(g2.lines.map((l) => [l.id, l]));
  ok(G2["2b"].status === "ok", "February: input tax all in 2B (Juniper's JLA/388)");
  const g1 = x.PreFile.gst("07", "202601"), G1 = Object.fromEntries(g1.lines.map((l) => [l.id, l]));
  ok(G1["2b"].status === "na", "January: no 2B for the month in FinCom, so the 2B check does not apply (" + G1["2b"].note + ")");
  ok(G["2b"].status === "ok", "March: the only input tax is reverse charge, never in 2B: ok");
  // ---- nothing changed
  const after = outputs();
  ok(before === after, "the 26Q file, GSTR-1, GSTR-3B and the TDS rows are byte-identical after the check (" + before.length + " characters)");
  const q3 = JSON.parse(before).q3;
  ok(q3 && !q3.error && /FH\^/.test(JSON.stringify(q3)), "the Q3 26Q text file was built and compared (" + JSON.stringify(q3).slice(0, 60) + "...)");
  // ---- with FinCom Assistant switched on (its state in S) the same
  ctx.S.asst = {open: true, scope: "client", by: {t: [{q: "x", done: true}]}, enabled: true};
  ctx.S.firm.asst = {on: true, consent: true};
  ok(outputs() === before, "with FinCom Assistant on: byte-identical");
  delete ctx.S.asst; delete ctx.S.firm.asst;
  ok(outputs() === before, "and off: byte-identical");
  console.log(fails ? "\nFAILED: " + fails : "\nall passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
