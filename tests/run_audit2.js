// node run_audit2.js - audit phase 2 on VMS
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
  const g = x.Audit.relatedGuess();
  console.log("possibly related: " + g.map(z => z.name + " (" + z.why + ")").join("; "));
  ok(g.some(z => /Pradeep Sharma/.test(z.name)) && !g.some(z => /BMW|BAJAJ|PNB/.test(z.name)), "suggests people's loans, not banks and finance companies");
  b.auditRel = [{name: "Pradeep Sharma (Loan)", relation: "Director"}, {name: "Parth Gaur (Loan A/c)", relation: "Relative of a director"}, {name: "KARISHMA GAUR (Loan)", relation: "Relative of a director"}, {name: "BUZY BUG PVT LTD- LOAN", relation: "Company or firm they control"}];
  const run = x.Audit.run("20250401", "20260331", "test");
  const show = id => { const f = run.findings.find(z => z.id === id); console.log("\n== " + id + (f ? ": " + f.title + " | " + f.count + " | " + M(f.amount) + "\n   " + f.problem : ": none")); (f ? f.rows.slice(0, 5) : []).forEach(r => console.log("   \u00b7 " + [r.date, r.no, r.party, r.type, M(r.amount), r.note].join(" | "))); return f; };
  const fm = show("msme43Bh"), fp = show("penalties"), fr = show("related:all"), fl = show("related:loans"), f4 = show("related:40A2b"); show("lastYear");
  ok(fm && fm.rows.every(r => /micro|small/i.test(r.type)), "MSME: only micro and small suppliers");
  ok(fp && fp.rows.some(r => /INTEREST ON TDS/.test(r.party) && /40\(a\)\(ii\)/.test(r.note)) && fp.rows.some(r => /INTEREST AND LATE FEE ON GST/.test(r.party) && /compensatory/.test(r.note)) && fp.rows.some(r => /PF/.test(r.party) && /penalty/.test(r.note)), "penalties and interest on TDS picked up, each with its rule");
  ok(fr && fr.count > 0, "related-party transactions listed for the note");
  ok(!run.findings.some(z => z.id === "lastYear") && !x.MIS.covered("20240401"), "last year not in these books: no comparison, and no false one");
  // last year: make one from this year's books, with one expense doubled, and check it is found
  const ly = JSON.parse(JSON.stringify(b.vouchers.filter(v => v.date < "20250701"))).map(v => { v.id = "ly-" + v.id; v.date = String(num(v.date.slice(0, 4)) - 1) + v.date.slice(4); if (v.ent.some(e => e.l === "RENT")) v.ent.forEach(e => { e.a = e.a / 3; }); return v; });
  function num(s){ return Number(s); }
  b.vouchers = ly.concat(b.vouchers); b.meta.from = "20240401";
  const run2 = x.Audit.run("20250401", "20250630", "test"), fly = run2.findings.find(z => z.id === "lastYear");
  console.log("  last year made: " + ly.length + " vouchers; " + (fly ? fly.count + " ledgers moved; e.g. " + fly.rows.slice(0, 3).map(r => r.party + " " + r.note).join(" | ") : "none"));
  ok(fly && fly.rows.some(r => r.party === "RENT" && /\+200%/.test(r.note)), "rent three times last year's: found (+200%)");
  b.vouchers = b.vouchers.filter(v => !String(v.id).startsWith("ly-")); b.meta.from = "20250401";
  // the Form 3CD draft
  const d = x.Audit.form3cd(run);
  d.clauses.forEach(c => console.log("  clause " + c.no.padEnd(13) + String(c.rows.length).padStart(4) + " rows  " + c.title));
  const c34 = d.clauses.find(c => c.no === "34(a)"), c44 = d.clauses.find(c => c.no === "44").rows[0], c40 = d.clauses.find(c => c.no === "40").rows;
  console.log("  34(a): " + c34.rows.map(r => r[0] + " paid " + M(r[1]) + " tds " + M(r[3]) + " short-rate " + r[4] + " missed " + M(r[5])).join(" | "));
  console.log("  44: total " + M(c44[0]) + ", exempt " + M(c44[1]) + ", composition " + M(c44[2]) + ", other registered " + M(c44[3]) + ", unregistered " + M(c44[5]));
  ok(Math.abs(c44[0] - (c44[1] + c44[2] + c44[3] + c44[5])) < 1, "clause 44 adds up");
  ok(c34.rows.some(r => r[0] === "194C" && r[3] > 0) && c34.rows.some(r => r[5] > 0), "clause 34(a): section by section, with what was not deducted");
  ok(c40[0][1] > 0, "clause 40: turnover " + M(c40[0][1]));
  ok(/Clause 34\(a\)/.test(x.Audit.form3cdHtml(d)), "the draft renders");
  const run3 = x.Audit.run("20250401", "20260331", "test");
  ok(run3.code === run.code, "run again: the same result code");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
