// node run_reports_3cd.js - Step 3: the Form 3CD draft (FSX.taxAuditFromBooks / FSX.form3cd, src/js/78-reports.js) on the
// made-up books of tests/fixtures/books (as run_audit2.js). Every clause the books answer comes from the shared audit
// functions: AuditWP (src/js/77-audit.js, the audit helper) when the program has it, else Audit.runNow / Audit.form3cd
// (06-audit.js / 07-mis.js). Test data only.
//   1. clause values equal the audit's check counts: 40A(3), 269SS / 269T, 269ST, 40(a)(ia), 43B(h), 43B, 34(a)
//   2. clause 40 (turnover) equals the MIS profit and loss; clause 44 adds up
//   3. related-party payments are "to confirm"; quantitative details are asked for when stock is not kept
//   4. every clause the books cannot answer is a "for you" question; nothing is left blank silently
//   5. the Excel and the Word are marked DRAFT
//   6. with AuditWP present (the audit helper's 77-audit.js), its results are used and the counts agree
const fs = require("fs"), {load, openBlob, HTML, DATA, CACHE, FIXTURE} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "FSX"];
// the audit helper's module, when the program has it (after 77-audit.js is merged)
const names = NAMES.concat(/\nconst AuditWP\b/.test(fs.readFileSync(HTML, "utf8")) ? ["AuditWP", "GSTCMP", "AS26"].filter(n => n === "AuditWP" || new RegExp("\\nconst " + n + "\\b").test(fs.readFileSync(HTML, "utf8"))) : []);
const {ctx, x} = load(HTML, names);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const unzip = (buf) => { const out = {}; let i = 0; const b = Buffer.from(buf); while (b.readUInt32LE(i) === 0x04034b50){ const n = b.readUInt16LE(i + 26), e = b.readUInt16LE(i + 28), sz = b.readUInt32LE(i + 18), name = b.slice(i + 30, i + 30 + n).toString(); out[name] = b.slice(i + 30 + n + e, i + 30 + n + e + sz).toString(); i += 30 + n + e + sz; } return out; };
(async () => {
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, states: ms.states, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}, cid: "t"});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; ctx.S.companies = {t: {id: "t", name: "Larkspur Fixture Events Private Limited", pan: "AAACL1234L"}}; ctx.CO = () => ctx.S.companies.t; ctx.S.coId = "t"; ctx.S.data = {};
  ctx.TextEncoder = TextEncoder;
  // made-up cash entries, so each cash clause has something to report: a cash payment of 15,000 to one party in a day
  // (40A(3)), a loan of 50,000 taken in cash and 25,000 repaid in cash (269SS, 269T), 2,50,000 received in cash (269ST)
  const sale = b.vouchers.find(v => /Sales/i.test(v.type)), cust = sale.party || sale.ent.find(e => e.a < 0).l;
  const V3 = (id, date, type, ent, party) => ({id: "rx3cd-" + id, date, type, no: "RX" + id, party: party || "", narr: "made-up for the 3CD test", ent: ent.map(([l, a]) => ({l, a})), cmp: "", gstin: "", pos: "", hsn: []});
  b.vouchers = b.vouchers.concat([V3(1, "20251110", "Payment", [["Printing and Stationery", -15000], ["Cash", 15000]], "Printing and Stationery"),
    V3(2, "20251112", "Receipt", [["Cash", -50000], ["Hemant Zaverchand (Loan)", 50000]]), V3(3, "20260115", "Payment", [["Hemant Zaverchand (Loan)", -25000], ["Cash", 25000]]),
    V3(4, "20251201", "Receipt", [["Cash", -250000], [cust, 250000]], cust)]);
  x.LedMaster.refresh(b);
  b.auditRel = FIXTURE ? [{name: "Hemant Zaverchand (Loan)", relation: "Director"}, {name: "Nirmala Quereshi (Loan)", relation: "Relative of a director"}] : [];
  const fy = "2025";
  const r = x.FSX.taxAuditFromBooks(fy), d = r.d3, C = no => d.clauses.find(c => c.no === no), F = id => r.run.findings.find(f => f.id === id);
  console.log("  shared checks from: " + r.src);
  const cnt = id => (F(id) || {count: 0}).count;
  // 1. the counts
  const viaWp = !!x.AuditWP;
  ok(C("21(d)").rows.length >= 1 && C("21(d)").rows.length === (viaWp ? r.counts.wp_cash40A3 : cnt("cash40A3")) && C("21(d)").src === "books", "1. 21(d) 40A(3): " + C("21(d)").rows.length + " rows = the audit's cash40A3 count");
  ok(C("31(a)").rows.length >= 1 && C("31(b)").rows.length >= 1 && C("31(a)").rows.length === cnt("cashLoans:269SS") && C("31(b)").rows.length === cnt("cashLoans:269T"), "1. 31(a) 269SS " + C("31(a)").rows.length + ", 31(b) 269T " + C("31(b)").rows.length + " = the audit's counts");
  ok(C("31(ba)").rows.length >= 1 && C("31(ba)").rows.length === cnt("cash269ST"), "1. 31(ba) 269ST: " + C("31(ba)").rows.length + " = the audit's count");
  ok(C("21(b)").rows.length === cnt("tdsMissed") && C("21(b)").rows.reduce((a, z) => a + z[1], 0) === x.r2((F("tdsMissed") || {amount: 0}).amount), "1. 21(b) 40(a)(ia): " + C("21(b)").rows.length + " parties, the same amount as the audit's TDS-not-deducted finding");
  ok(C("22").rows.length === cnt("msme43Bh") && C("26").rows.filter(z => z[2] === "43B(h) MSME").length === cnt("msme43Bh") && C("26").rows.filter(z => z[2] === "statutory dues").length === cnt("balances:43B"), "1. 22 and 26: 43B(h) " + cnt("msme43Bh") + " bills, 43B " + cnt("balances:43B") + " dues = the audit's counts");
  const c34 = C("34(a)");
  ok(c34.rows.length > 0 && c34.rows.every(z => Math.abs(z[1] - z[2]) < 0.01), "1. 34(a): " + c34.rows.length + " sections from FinCom's TDS");
  // 2. turnover and clause 44
  const pl = x.MIS.pl(fy + "0401", (Number(fy) + 1) + "0331"), c40 = C("40").rows;
  ok(c40[0][1] === (pl.heads.rev || {t: 0}).t, "2. clause 40 turnover " + x.INR.format(c40[0][1]) + " = MIS revenue");
  const c44 = C("44").rows[0]; ok(Math.abs(c44[0] - (c44[1] + c44[2] + c44[3] + c44[5])) < 1, "2. clause 44 adds up");
  // 3. related parties to confirm; stock
  ok(C("23").src === "confirm", "3. 23 (40A(2)(b) payments): from the books, marked to confirm (" + C("23").rows.length + " rows)");
  ok(C("35").src === "you" && /quantitative/.test(C("35").note), "3. 35: no stock quantities in these books, so asked for");
  // 4. for you
  const fyou = d.forYou.map(q => q.no);
  ok(["8", "8a", "10", "11", "13", "14", "32", "33", "41"].every(n => fyou.includes(n)) && d.clauses.every(c => c.src !== "books" || c.rows.length || c.note), "4. " + fyou.length + " clauses the books cannot answer are questions for you; no clause blank without a note");
  ok(d.clauses.length === x.FSX.CLAUSES_3CD.length && C("1").rows[0][0] === "Larkspur Fixture Events Private Limited" && C("7").rows[0][0] === "2026-27", "4. all " + d.clauses.length + " clauses; 1 name and 7 assessment year from the entity");
  // 5. DRAFT
  const xz = unzip(x.FSX.form3cdExcel(d)), wz = unzip(x.FSX.form3cdWord(d));
  ok(/DRAFT - Form 3CD working/.test(xz["xl/sharedStrings.xml"]) && /For you/.test(xz["xl/workbook.xml"]), "5. the Excel is marked DRAFT, with a For you sheet");
  ok(/DRAFT - not for filing/.test(wz["word/document.xml"]) && /DRAFT/.test(wz["word/header1.xml"]) && /DRAFT - not for filing/.test(wz["word/footer1.xml"]), "5. the Word is marked DRAFT in the body, the header and the footer");
  // 6. the audit helper's functions, when present: a stand-in with AuditWP's contract (check(id, from, to) -> {count, entries,
  // status}), built on Audit.checks as 77-audit.js is, unless the program already carries the real one
  if (!viaWp){
    ctx.AuditWP = {check(id, from, to){ const V = x.Audit.vouchers(from, to), c2 = {from, to, bal: x.Audit.balances(from, to)};
      const one = k => [].concat(x.Audit.checks[k](x.Audit, V, c2) || []).filter(Boolean);
      const rows = (fs2, kind) => fs2.flatMap(f => (f.rows || []).map(z => ({date: z.date, party: z.party, amount: z.amount, no: z.no, note: (kind ? kind(f) + ": " : "") + (z.note || "")})));
      const e = id === "cashLoans" ? rows(one("cashLoans"), f => f.key === "269SS" ? "269SS taken" : "269T repaid") : id === "tds" ? rows(one("tdsMissed"), () => "not deducted (the expense)") : id === "msme43Bh" ? rows(one("msme43Bh")) : rows(one(id));
      return {id, status: e.length ? "flag" : "ok", count: e.length, entries: e}; }};
  }
  const r2 = x.FSX.taxAuditFromBooks(fy), C2 = no => r2.d3.clauses.find(c => c.no === no);
  ok(/77-audit/.test(r2.src) && C2("21(d)").rows.length === r2.counts.wp_cash40A3 && C2("31(ba)").rows.length === r2.counts.wp_cash269ST && C2("22").rows.length === r2.counts.wp_msme43Bh, "6. with AuditWP: its results fill 21(d), 31, 22, 26 and 21(b); counts equal its checks (" + r2.src + ")");
  ok(C2("21(d)").rows.length === C("21(d)").rows.length && C2("31(ba)").rows.length === C("31(ba)").rows.length && C2("22").rows.length === C("22").rows.length && C2("21(b)").rows.length === C("21(b)").rows.length, "6. and the same answers as without it: one computation of each check");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
