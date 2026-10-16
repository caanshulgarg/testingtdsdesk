// node run_audit_tds.js - round 69 (the owner, 16-Oct-2026: "Should have deducted" belongs in the audit): one TDS answer.
// The audit's "TDS not deducted" findings (Audit.checks.tdsMissed, src/js/06) are TDSWatch.missed (src/js/66), the TDS
// page's own list, for each financial year inside the audit period: one finding per party, section and year, its TDS due
// the finding's amount, its credits the entries behind it. Before, the audit had its own logic and differed:
//   - the audit fixture (tests/audit_fixture.js): Sharma Roadways' freight journals carry no party; the audit found them
//     (₹76,001.33, TDS ₹1,520.03 on every bill) and TDSWatch did not; now TDSWatch takes the supplier credited when an
//     entry names no party, and both say ₹1,320.02 (2% on the two bills over 194C's ₹30,000 a bill: ₹30,000.25 and
//     ₹36,000.75; the year's ₹76,001.33 is under ₹1,00,000);
//   - GB TEXCOAT's shape (run_tds_empty.py): CA Firm, no PAN, ₹30,000 every 9 days from 1-Apr-2025 to 12-Oct-2026: the
//     audit said TDS ₹1,89,000 at 10% over both years in one line; TDSWatch says ₹2,46,000 (2025-26) and ₹1,32,000
//     (2026-27) at 20% (no PAN). Now the audit says the same, a finding a year.
"use strict";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const {load, HTML} = require("./harness"), {makeBooks, finish} = require("./audit_fixture");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend",
  "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gramsOf", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "AS26", "GSTCMP", "GSTAPI", "TDSRate", "TDSInt", "GSTIN_RE", "TDSFiled", "ClosedP",
  "BOOKS_KEYS", "AuditWP", "TDSWatch", "TDSTally", "noPanRate", "NO_PAN_RATE", "AIH", "istParts", "p2ist", "istDay", "istToday"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
ctx.saveBooks = () => {}; ctx.whoAmI = () => "t"; ctx.S.data = {};
const J = JSON.stringify;
// the audit's TDS-not-deducted findings and TDSWatch.missed of the years, side by side
function both(from, to){
  const run = x.Audit.run(from, to, "test");
  const fys = []; for (let y = Number(x.TDS.fyOf(from).slice(0, 4)); y <= Number(x.TDS.fyOf(to).slice(0, 4)); y++) fys.push(y + "-" + String(y + 1).slice(2));
  const want = fys.flatMap(fy => x.TDSWatch.missed(fy).map(e => ({id: "tdsMissed:" + e.party + "|" + e.section + "|" + fy, due: e.due, party: e.party, section: e.section, fy,
    credits: e.credits.filter(c => c.counts !== false).map(c => c.date + "=" + c.amount).sort()}))).sort((a, c) => a.id.localeCompare(c.id));
  const got = run.findings.filter(f => f.check === "tdsMissed").map(f => ({id: f.id, due: f.amount, party: f.party, section: f.section, fy: f.fy,
    credits: f.rows.map(r => r.date + "=" + r.amount).sort()})).sort((a, c) => a.id.localeCompare(c.id));
  return {run, want, got, fs: run.findings.filter(f => f.check === "tdsMissed")};
}

// ---------------------------------------------------------------- 1. the audit fixture, 2025-26
{
  const f = makeBooks();
  ctx.S.books = f.books; ctx.S.coId = "cfix"; ctx.S.companies = {cfix: f.company}; ctx.CO = () => f.company;
  finish(f, x);
  const {run, want, got, fs} = both(f.from, f.to);
  console.log("  TDSWatch.missed: " + want.map(w => w.id + " ₹" + w.due).join("; "));
  console.log("  audit:           " + got.map(w => w.id + " ₹" + w.due).join("; "));
  ok(!run.errors.length, "fixture: every check ran" + (run.errors.length ? " (" + run.errors.join("; ") + ")" : ""));
  ok(want.length === 2 && J(got) === J(want), "fixture: the audit's TDS-not-deducted findings are TDSWatch.missed: parties, sections, years, TDS due and the credits behind each");
  const k = fs.find(z => z.party === "Kapoor Associates"), s = fs.find(z => z.party === "Sharma Roadways");
  ok(k && k.id === "tdsMissed:Kapoor Associates|194J|2025-26" && k.amount === 6900.07 && k.title === "194J not deducted: Kapoor Associates, 2025-26" && k.sev === "medium",
    "fixture: Kapoor Associates, 194J at 10%: TDS ₹6,900.07, medium (under ₹10,000) (" + (k && [k.id, k.amount, k.title, k.sev].join(" | ")) + ")");
  ok(s && s.amount === 1320.02 && J(s.rows.map(r => r.amount)) === J([30000.25, 36000.75]) && s.rows.every(r => r.vid),
    "fixture: Sharma Roadways (journals with no party): 194C on the two bills over ₹30,000, ₹66,001.00 at 2% = ₹1,320.02, their vouchers kept (" + (s && [s.amount, s.rows.map(r => r.amount + "@" + r.vid)].join(" | ")) + ")");
  ok(k && /past the ₹50,000(\.00)? a year limit/.test(k.problem) && /not covered by TDS ₹69,000\.73/.test(k.problem) && /10%/.test(k.suggestion) && /₹6,900\.07/.test(k.suggestion) && /interest/.test(k.suggestion)
    && /40\(a\)\(ia\)/.test(k.impact) && /₹20,700\.22/.test(k.impact) && k.area === "tds",
    "fixture: problem (paid past the limit, not covered), suggestion (deduct at the rate, deposit with interest), effect (30% disallowed u/s 40(a)(ia))\n         " + (k && [k.problem, k.suggestion, k.impact].join("\n         ")));
  ok(fs.every(z => z.je && z.je.length === 1 && Math.abs(z.je[0].lines.reduce((a, l) => a + (l.dr || 0) - (l.cr || 0), 0)) < 0.01 && z.je[0].lines[0].dr === z.amount), "fixture: each has its entry to pass (Dr the party, Cr TDS payable, the TDS due)");
  const again = x.Audit.run(f.from, f.to, "test");
  ok(J(again.findings.filter(z => z.check === "tdsMissed").map(z => z.id)) === J(fs.map(z => z.id)) && again.findings.filter(z => z.check === "tdsMissed").every(z => !z.isNew), "fixture: the ids stay the same run to run");
}

// ---------------------------------------------------------------- 2. GB TEXCOAT's shape: CA Firm, no PAN, over two years
{
  const V = []; let n = 0;
  for (let t = Date.UTC(2025, 3, 1); t <= Date.UTC(2026, 9, 12); t += 9 * 86400000){
    const d = new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
    V.push({id: "g" + (++n), date: d, type: "Journal", no: String(n), party: "CA Firm", narr: "", ent: [{l: "CA Firm", a: 30000}, {l: "Professional Fees", a: -30000}]});
    V.push({id: "g" + (++n), date: d, type: "Sales", no: String(n), party: "Buyer One", narr: "", ent: [{l: "Buyer One", a: -11800}, {l: "Sales", a: 10000}, {l: "Output IGST", a: 1800}]});
  }
  const under = {"CA Firm": "Sundry Creditors", "Professional Fees": "Indirect Expenses", "Buyer One": "Sundry Debtors", "Sales": "Sales Accounts", "Output IGST": "Duties & Taxes"};
  const b = {cid: "cgb", vouchers: V, meta: {from: "20250401", to: "20261012"}, under, groups: {"Sundry Creditors": "Current Liabilities", "Indirect Expenses": "", "Sundry Debtors": "Current Assets", "Sales Accounts": "", "Duties & Taxes": "Current Liabilities"},
    ledInfo: Object.fromEntries(Object.keys(under).map(l => [l, {ob: 0, from: "20250401"}])), pans: {}, challans: [], alloc: {}};
  const co = {id: "cgb", name: "GB TEXCOAT"};
  ctx.S.books = b; ctx.S.coId = "cgb"; ctx.S.companies = {cgb: co}; ctx.CO = () => co;
  b.map = x.Books.mapLedgers(b.vouchers, {});
  const {run, want, got, fs} = both("20250401", "20261012");
  console.log("  TDSWatch.missed: " + want.map(w => w.id + " ₹" + w.due).join("; "));
  console.log("  audit:           " + got.map(w => w.id + " ₹" + w.due).join("; "));
  ok(want.length === 2 && J(got) === J(want), "GB shape: a finding a year, the same as TDSWatch.missed (" + got.map(g => g.fy + " ₹" + g.due).join(", ") + ")");
  ok(fs.every(z => z.sev === "high" && /no PAN in Tally/i.test(z.problem) && /20%/.test(z.suggestion)), "GB shape: serious (₹10,000 or more), no PAN in Tally, at 20%");
  // a period inside one year: only that year's finding
  const one = both("20250401", "20260331");
  ok(one.got.length === 1 && one.got[0].fy === "2025-26" && J(one.got) === J(one.want), "GB shape: the audit of 2025-26 alone: its year's finding only");
}
console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
