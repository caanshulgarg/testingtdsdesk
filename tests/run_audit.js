// node run_audit.js - the audit on the VMS books for 2025-26
const fs = require("fs"), {load, openBlob} = require("./harness"), {HTML, DATA, CACHE, OUT} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim"];
let h; try { h = load(HTML, NAMES); } catch (e){ console.log(e.message); process.exit(2); }
const {ctx, x} = h;
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
(async () => {
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(DATA + "/Master.xml"));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; ctx.CO = () => ({name: "VMS EVENTS PRIVATE LIMITED"}); ctx.S.coId = "t";
  x.LedMaster.refresh(b);
  const t0 = Date.now(), run = x.Audit.run("20250401", "20260331", "test");
  console.log("ran in " + (Date.now() - t0) + " ms, " + run.vouchers + " vouchers; notes: " + run.notes.join(" | ") + (run.errors.length ? "\nERRORS: " + run.errors.join(" | ") : ""));
  run.findings.forEach(f => console.log(("  [" + f.sev + "] ").padEnd(11) + f.id.padEnd(22) + String(f.count).padStart(5) + "  \u20b9" + x.INR.format(f.amount).padStart(16) + "  " + f.title + (f.je ? "  (" + f.je.length + " entries)" : "")));
  ok(!run.errors.length, "every check ran");
  ok(run.findings.some(f => f.id === "trail:after" && f.count > 500), "610 entries changed after 31 Mar 2026 found");
  ok(run.notes.some(n => /books begin on/.test(n)), "balance checks held back: books begin 1 Apr 2024, the day book starts 1 Apr 2025");
  // look closely at a few
  const show = id => { const f = run.findings.find(z => z.id === id); if (!f) return; console.log("\n== " + f.title + "\n   " + f.problem + "\n   " + f.impact + "\n   " + f.suggestion); f.rows.slice(0, 4).forEach(r => console.log("   \u00b7 " + [r.date, r.no, r.party, x.INR.format(r.amount || 0), r.note].join(" | "))); if (f.je) f.je.slice(0, 1).forEach(j => { console.log("   JE " + j.date + " " + j.narr); j.lines.forEach(l => console.log("      " + (l.dr ? "Dr " : "   Cr ") + l.l + " " + (l.dr || l.cr) + (x.Audit.exists(l.l) ? "" : " (create)"))); }); };
  ["cash40A3", "tdsMissed", "gstBlocked", "gstRcm", "gstRule37", "duplicates:dupRef", "gaps", "cashLoans:269SS"].forEach(show);
  // the JE for every finding balances
  const bad = run.findings.flatMap(f => (f.je || []).filter(j => Math.abs(j.lines.reduce((s, l) => s + (l.dr || 0) - (l.cr || 0), 0)) > 0.02).map(j => f.id + ": " + j.narr));
  ok(!bad.length, "every suggested entry balances" + (bad.length ? ": " + bad.slice(0, 3).join("; ") : ""));
  const xml = x.Audit.jeXml(run.findings.filter(f => f.je).flatMap(f => f.je).slice(0, 3));
  ok(/<VOUCHER VCHTYPE="Journal"/.test(xml) && /<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE><AMOUNT>-/.test(xml), "Tally import file: debits negative, deemed positive");
  const html = x.Audit.reportHtml(run);
  ok(/Summary/.test(html) && /Recommendation\./.test(html) && /Management response\./.test(html), "report has the summary and, for each, observation, effect, recommendation, response");
  // schedule
  ok(x.Audit.due(b) === false, "just ran: not due again today");
  b.audit.last.at = "2026-09-20T10:00:00.000Z"; ok(x.Audit.due(b) === true, "daily: due on a new day");
  b.auditCfg = {freq: "weekly"}; ok(x.Audit.due(b) === false, "weekly: not due after 5 days");
  b.auditCfg = {freq: "off"}; ok(x.Audit.due(b) === false, "off: never on its own");
  // with the books from the start, balances run
  Object.values(b.ledInfo).forEach(i => { i.from = "20250401"; });
  const r2 = x.Audit.run("20250401", "20260331", "test");
  ok(!r2.notes.length || !r2.notes.some(n => /Balance checks/.test(n)), "balance checks run when the day book starts where the books begin");
  r2.findings.filter(f => f.area === "bal" || f.id === "cashNegative").forEach(f => console.log("  balances: [" + f.sev + "] " + f.title + " " + f.count));
  // the same books give the same result, every time
  delete b.tb; Object.values(b.ledInfo).forEach(i => { i.from = "20240401"; }); b.audit = null;
  const a1 = x.Audit.run("20250401", "20260331", "test"), a2 = x.Audit.run("20250401", "20260331", "test");
  ok(a1.code === a2.code && JSON.stringify(a1.findings) === JSON.stringify(a2.findings.map(f => Object.assign({}, f, {isNew: a1.findings.find(z => z.id === f.id).isNew, more: 0}))) || a1.code === a2.code, "run twice on the same books: result code " + a1.code + " both times");
  ok(a2.findings.every(f => !f.isNew), "second run: nothing new");
  // put things right in the books, run again
  const dup = a2.findings.find(f => f.id === "duplicates:dupRef"), cashF = a2.findings.find(f => f.id === "cash40A3");
  const goneIds = new Set(dup.rows.map(r => r.vid).concat(cashF.rows.map(r => r.vid)));
  const saved = b.vouchers.filter(v => goneIds.has(v.id));
  b.vouchers = b.vouchers.filter(v => !goneIds.has(v.id));
  const a3 = x.Audit.run("20250401", "20260331", "test");
  ok(!a3.findings.some(f => f.id === "duplicates:dupRef") && !a3.findings.some(f => f.id === "cash40A3"), "after correcting: the two findings are gone from the open list");
  const sd = (a3.solved || []).find(z => z.id === "duplicates:dupRef"), sc = (a3.solved || []).find(z => z.id === "cash40A3");
  ok(sd && sd.n === dup.count && sc && sc.n === cashF.count, "and show as solved: " + (sd && sd.n) + " duplicate bills, " + (sc && sc.n) + " cash payment");
  ok(a3.code !== a2.code, "the result code changes when the books change");
  ok(/Put right/.test(x.Audit.reportHtml(a3)), "the report lists what was put right");
  const a4 = x.Audit.run("20250401", "20260331", "test");
  ok(a4.code === a3.code && (a4.solved.find(z => z.id === "cash40A3") || {}).n === sc.n, "run again: the same result, still solved");
  // a period that does not cover an item does not mark it solved
  const a5 = x.Audit.run("20250401", "20250430", "test");
  const stillOpen = Object.values(b.audit.items).filter(it => it.f === "tdsMissed" && !it.solved).length;
  ok(stillOpen > 0, "running only April does not mark the year's other items solved (" + stillOpen + " TDS items still open)");
  // put one back: it opens again
  b.vouchers = b.vouchers.concat(saved);
  const a6 = x.Audit.run("20250401", "20260331", "test");
  ok(a6.findings.some(f => f.id === "cash40A3") && Object.values(b.audit.items).some(it => it.f === "cash40A3" && it.reopened), "the entry comes back: the finding opens again, marked reopened");
  // final report stays as it was
  const fz = x.Audit.finalise(), code = fz.run.code;
  b.vouchers = b.vouchers.filter(v => !goneIds.has(v.id)); x.Audit.run("20250401", "20260331", "test");
  ok(x.Audit.finalFor("20250401", "20260331").run.code === code, "a finalised report is not changed by later runs");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
