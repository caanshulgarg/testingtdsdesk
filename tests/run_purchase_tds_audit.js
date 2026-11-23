// node run_purchase_tds_audit.js - the purchase and TDS audit of 22-Nov-2026 (track purchase-tds), each finding as its case:
//   P2  a supplier's credit note takes its value off the year's total credited (it was added: the limit tripped early)
//   P3  the year read from Tally: its bills that carry TDS are not caught up again; a catch-up from Tally's figure is
//       included only when a person ticks it; a debit note in Tally takes its value off
//   P5  more than ₹1 to round off stops approval until a person says the total is right
//   P6  a bill cut from a PDF of several keeps its pages: Retry after a reload reads them, not the PDF's first pages
//   P7  the drafts' checks in one job (refreshStats, the review table): the suppliers indexed, the others-count once;
//       many bills at once (a sheet, Approve all) count the client once at the end
//   P8  a bill to the client's other registration (Other GSTINs, its own PAN) is the client's: input credit kept
//   MG  (the owner, 23-Nov-2026) with Client setup's "This Tally company has more than one GSTIN" ticked, such a bill does
//       not wait for the per-bill word on the GST ledgers (N1's), a plain note instead
//   PL  an inbox file sent to Sales / Unsorted is read; a PDF of several bills is read once all its parts are
//   T2  TDS cut in the payment voucher of a bill booked earlier without TDS: 201(1A)(i) interest from the bill's date
//   T2b a bill paid in instalments, TDS cut in each payment (Agst Ref): each row keeps its own amount paid; several bills
//       in one TDS entry, the first within the limit on its own: the date of credit is flagged for a person
//   N1  review of the fixes: a credit note approved before its bill is not lost; a catch-up a person checked in Tally
//       (already deducted, or not due) is quiet; a bill to the other registration waits for a person's word on the GST
//       ledgers; a debit note in Tally under the client's own type for it; a PDF part that failed says how to read it again
//   T3  "Building Repairs", "Land Development Contract", "Rentokil", "Current" are not rent
//   TL  194-O's limit only for an individual/HUF seller with a PAN; 194C(6) transporter only with a PAN; a bill dated
//       before 1-Apr-2025 is tested against that year's limits (and 194T did not exist)
// Made-up clients, suppliers, PANs and GSTINs only. Loads the source (tests/purchase_tds_load.js); PTDS_ROOT=<a checkout>
// runs it against another copy (the base, to see each case fail there).
"use strict";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const {programHtml, load} = require("./purchase_tds_load");
const HTML = programHtml(process.env.PTDS_ROOT);
const fs = require("fs"), path = require("path"), vm = require("vm"), ROOT = process.env.PTDS_ROOT || path.join(__dirname, "..");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const guard = (w, f) => { try { f(); } catch (e){ ok(false, w + " (threw " + (e && e.message) + ")"); } };

/* ================================================================ the bill desk */
const NAMES = ["num", "r2", "fmtDate", "INR", "NORM_CACHE", "normNameRaw", "normName", "RULE_DEFAULTS", "rules", "ruleOf", "D", "CO", "PAN_RE", "GSTIN_RE", "GST_CHARS", "gstinCheckChar", "gstinValid", "panInoperative", "NO_PAN_RATE", "noPanRate",
  "ldcList", "ldcFor", "ldcUsed", "money", "money0", "norm", "fyOf", "effectivePan", "findParty", "fyStartEnd", "partyLedgerName", "fetchPartyYtd", "tallyYtdFor", "ourYtd", "ytdOf",
  "RCM_LEDGER_DEFAULTS", "RCM_CATS", "BLOCK_CATS", "rcmTaxOf", "catRate", "catLabel", "SKIP_REASONS", "tdsSkipOf", "skipText", "itcCheck", "compute", "DOC_KIND_TEXT",
  "RCM_KEYS", "ENTRY_REV", "RENDER_GEN", "REACT_SCOPE", "reactScope", "reactScopeEnd", "perRender", "memoJob", "approve", "unapply", "statsRev", "draftNeedsCheck", "refreshStats", "notReadYet", "retryNotRead", "GST_STATES", "salesPan", "salesGstinOfPan",
  "docqFinish"];
const opt = ["ruleOn", "RULE_OLD", "ownGstins", "partyIdx", "draftParties", "keepFile", "pagesOf", "STATS_HOLD", "statsHeldFor", "statsHeld"];
const src = require("fs").readFileSync(HTML, "utf8");
const have = opt.filter(n => new RegExp("\\n(?:async function|function|const|let|var) " + n + "\\b").test(src));
const {ctx, x} = load(HTML, NAMES.concat(have));
const S = ctx.S;
Object.assign(S, {firm: {rules: {}}, companies: {}, data: {}, files: {}, filePages: {}, reading: {}, jobs: [], docq: {}, previews: {}});
let toasts = [];
Object.assign(ctx, {toast: t => toasts.push(t), render(){}, softRender(){}, findDuplicate: () => null, itemChecks: () => [], tdsLedgerFor: () => ({ledger: "TDS Payable"}),
  gstLedgerFor: (e, co, cid, head) => ({ledger: "Input " + head}), gstDecision: () => ({}), ledgerListFor: () => false, exactLedger: n => n, ledgerInfo: () => null,
  Ledgers: {snapRate: r => r, cls: () => "", chain: () => []}, partyChoiceSet: (p, l) => { p.ledgerName = l; }, billVt: () => "Purchase", invKey: () => "", pruneIndex(){},
  billMoveOn(){}, slug: s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-"), billPostLive: () => false, linkDuplicates(){}, postBills: () => null, billInTally: () => false,
  Store: {saveEntry(){}, saveParty(){}, saveCompany(){}}, applyPartyHistory: () => Promise.resolve(0), registerHash(){}, uid: p => p + Math.random().toString(36).slice(2, 8)});
const gst = (st, pan) => { const g = st + pan + "1Z"; return g + x.gstinCheckChar(g); };
const CPAN = "AAACF1111K";   // the client (made up)
const co = {id: "c1", name: "Fern Trading Pvt Ltd", gstin: gst("27", CPAN), otherGstins: gst("24", CPAN), roundOff: "Round Off", mustDeduct: true};
S.companies.c1 = co; S.coId = "c1";
const data = {parties: {}, entries: {}, loaded: true}; S.data.c1 = data;
let n = 0;
const bill = (o) => { const id = "e" + (++n); const e = Object.assign({id, status: "draft", natureId: "contractor", expenseLedger: "Contract Charges", partyLedger: o.ledger || "Kestrel Works Pvt Ltd", includeCatchUp: true, fileName: "bill-" + id + ".pdf"}, o.e || {});
  e.x = Object.assign({vendorName: "Kestrel Works Pvt Ltd", vendorPan: "AAACK2222L", invoiceNo: "KW-" + n, invoiceDate: "2025-07-01", taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0}, o.x);
  if (!o.loose) data.entries[id] = e; return e; };
const amt = (t, g) => ({taxable: t, cgst: g || 0, sgst: g || 0, total: t + 2 * (g || 0)});
const reset = () => { data.parties = {}; data.entries = {}; co.tallyYtd = {}; toasts = []; };
const comp = e => ctx.compute(e, "c1");

// ---- P2: a credit note in the year's total
guard("P2", () => {
  reset();
  [1, 2, 3].forEach(() => x.approve(bill({x: amt(25000)})));
  const p = Object.values(data.parties)[0];
  ok(p && p.ytd["2025-26"].contractor.credited === 75000, "P2 three bills of 25,000 approved: 75,000 credited (" + (p && p.ytd["2025-26"].contractor.credited) + ")");
  const cn = bill({x: amt(20000), e: {noteKind: "credit", tdsSkip: "note"}});
  x.approve(cn);
  ok(p.ytd["2025-26"].contractor.credited === 55000, "P2 a credit note of 20,000 takes it off: 55,000 (" + p.ytd["2025-26"].contractor.credited + ")");
  const nb = bill({x: amt(10000)}), c = comp(nb);
  ok(!c.applicable && c.tds === 0 && c.catchUp === 0, "P2 the next bill of 10,000: 65,000 for the year, within 1,00,000: no TDS, no catch-up (tds " + c.tds + ", catch-up " + c.catchUp + ")");
  ok(x.unapply(cn, "c1") && p.ytd["2025-26"].contractor.credited === 75000, "P2 the credit note's approval undone: back to 75,000 (" + p.ytd["2025-26"].contractor.credited + ")");
  x.approve(cn);
  // the Tally path: our approved credit note (not sent) off the Tally figure
  co.tallyYtd = {[ctx.normName("Kestrel Works Pvt Ltd") + "|2025-26"]: {fy: "2025-26", ledger: "Kestrel Works Pvt Ltd", credited: 75000, gross: 75000, vouchers: 3, tdsBase: 0, tdsSep: 0}};
  Object.values(data.entries).filter(e => e.status === "approved" && !e.noteKind).forEach(e => { e.exportedAt = "2025-07-02"; });
  const y = x.ytdOf(p, "2025-26", "contractor", "c1", nb);
  ok(y.credited === 55000, "P2 from Tally: 75,000 in Tally less the credit note here (not sent): 55,000 (" + y.credited + ")");
});

// ---- N1: a credit note approved before the bill it reverses
guard("N1 cn", () => {
  reset();
  const cn = bill({x: amt(20000), e: {noteKind: "credit"}});
  const cc = comp(cn);
  ok(cc.tds === 0 && !cc.applicable, "N1 a credit note on its own (no 'note' reason set): no TDS booked on it (" + cc.tds + ")");
  x.approve(cn);
  const p = Object.values(data.parties)[0];
  x.approve(bill({x: amt(120000)}));
  ok(p.ytd["2025-26"].contractor.credited === 100000, "N1 credit note of 20,000 approved before the bill of 1,20,000: 1,00,000 for the year (" + p.ytd["2025-26"].contractor.credited + ")");
  ok(x.ytdOf(p, "2025-26", "contractor", "c1").credited >= 0, "N1 the year's figure for a bill is never below nil");
  const p0 = Object.assign({}, p, {ytd: {"2025-26": {contractor: {credited: -20000, tdsBase: 0}}}});
  ok(x.ytdOf(p0, "2025-26", "contractor", "c1").credited === 0, "N1 only the credit note so far: the year's figure reads nil (" + x.ytdOf(p0, "2025-26", "contractor", "c1").credited + ")");
  ok(x.unapply(cn, "c1") && p.ytd["2025-26"].contractor.credited === 120000, "N1 the credit note's approval undone: 1,20,000 (" + p.ytd["2025-26"].contractor.credited + ")");
});

// ---- P3: the year from Tally and its catch-up
const tallyRead = async (vouchers) => {
  Object.assign(ctx, {bridgeLive: () => true, Bridge: {call: async () => ({vouchers}), openFor: () => ({name: "Fern"})}, ledgerLinesUrl: () => "/ledgerlines"});
  const p = Object.values(data.parties)[0];
  return x.fetchPartyYtd(p, "2025-26", "Kestrel Works Pvt Ltd");
};
const tv = (amtP, lines, type) => ({type: type || "Purchase", entries: [{ledger: "Kestrel Works Pvt Ltd", amount: String(amtP)}].concat(lines.map(([l, a]) => ({ledger: l, amount: String(a)})))});
async function p3(){
  reset();
  x.approve(bill({x: amt(5000), e: {}}));   // the supplier in the list
  const p = Object.values(data.parties)[0]; p.ytd = {};
  data.entries = {};
  // four bills booked in Tally, each with its 2% TDS in it
  const four = [1, 2, 3, 4].map(() => tv(39200, [["Contract Charges", -40000], ["TDS Payable - Contractor", 800]]));
  const t = await tallyRead(four);
  ok(t && t.credited === 160000 && t.tdsBase === 160000, "P3 Tally: 1,60,000 credited, all of it with TDS in the bill (" + (t && [t.credited, t.tdsBase]) + ")");
  let c = comp(bill({x: amt(20000)}));
  ok(c.applicable && c.catchUp === 0 && c.tdsBase === 20000 && c.tds === 400, "P3 a new bill of 20,000: TDS on 20,000 only (400), nothing caught up again (catch-up " + c.catchUp + ", base " + c.tdsBase + ", tds " + c.tds + ")");
  // two bills without TDS, and a TDS journal of its own: catch-up is a person's call
  data.entries = {};
  await tallyRead([tv(50000, [["Contract Charges", -50000]]), tv(50000, [["Contract Charges", -50000]]), tv(-2000, [["TDS Payable - Contractor", 2000]], "Journal")]);
  const e = bill({x: amt(20000)});
  c = comp(e);
  const f = c.flags.find(z => /may have had no TDS/.test(z.t));
  ok(c.catchUp === 100000 && c.tdsBase === 20000 && !!c.catchUpAsk && f && f.lvl === "hi" && /2,000/.test(f.t), "P3 Tally bills without TDS: catch-up of 1,00,000 not included until ticked, a warning names the TDS of 2,000 in a journal (base " + c.tdsBase + ")");
  // a person checked Tally: the earlier bills' TDS was deducted already, or is not due
  e.catchUpNotDue = {by: "t", at: "2025-07-02"}; e.includeCatchUp = false;
  c = comp(e);
  ok(!c.catchUpAsk && !c.catchUpIn && c.tdsBase === 20000 && !c.flags.some(z => z.lvl === "hi" && /earlier bills/i.test(z.t)) && c.flags.some(z => /checked in Tally/i.test(z.t)), "N1 checked in Tally (already deducted or not due): no warning, nothing caught up (base " + c.tdsBase + ")");
  delete e.catchUpNotDue; e.includeCatchUp = true;
  e.catchUpTally = true;
  c = comp(e);
  ok(c.tdsBase === 120000 && c.catchUpIn, "P3 ticked: the catch-up is included (base " + c.tdsBase + ")");
  // a year from Tally stored before tdsBase / tdsSep were read: the catch-up still asks a person
  co.tallyYtd = {[ctx.normName("Kestrel Works Pvt Ltd") + "|2025-26"]: {fy: "2025-26", ledger: "Kestrel Works Pvt Ltd", credited: 100000, gross: 100000, vouchers: 2}};
  const eo = bill({x: amt(20000)}); c = comp(eo);
  ok(c.catchUp === 100000 && c.catchUpAsk && c.tdsBase === 20000, "N1 a year from Tally stored before this change (no tdsBase): the catch-up asks (base " + c.tdsBase + ", catch-up " + c.catchUp + ")");
  // a debit note (a return to the supplier) in Tally takes its value off
  const t2 = await tallyRead([tv(118000, [["Contract Charges", -100000], ["Input CGST", -9000], ["Input SGST", -9000]]), tv(-11800, [["Contract Charges", 10000], ["Input CGST", 900], ["Input SGST", 900]], "Debit Note")]);
  ok(t2.credited === 90000, "P3 a debit note of 10,000 in Tally: 1,00,000 less 10,000 = 90,000 (" + t2.credited + ")");
  co.debitNoteType = "DN";
  const t3 = await tallyRead([tv(118000, [["Contract Charges", -100000], ["Input CGST", -9000], ["Input SGST", -9000]]), tv(-11800, [["Contract Charges", 10000], ["Input CGST", 900], ["Input SGST", 900]], "DN")]);
  ok(t3.credited === 90000, "N1 a debit note under the client's own type for it (\u201cDN\u201d): taken off too, 90,000 (" + t3.credited + ")");
  delete co.debitNoteType;
}

// ---- P5: round off
guard("P5", () => {
  reset();
  const e = bill({x: {taxable: 10000, cgst: 900, sgst: 900, total: 1180}});
  let c = comp(e);
  ok(c.missing.some(m => /round off/.test(m)), "P5 total 1,180 against 11,800 of lines: approval stops (" + c.missing.join("; ") + ")");
  e.roOk = c.ro; c = comp(e);
  ok(!c.missing.some(m => /round off/.test(m)), "P5 a person said the total is right: approval goes on");
  const e2 = bill({x: {taxable: 10000, cgst: 900, sgst: 900, total: 11800.4}});
  ok(!comp(e2).missing.some(m => /round off/.test(m)), "P5 40 paise to round off: as before");
});

// ---- P6: a PDF of several bills
async function p6(){
  reset();
  Object.assign(ctx, {FileStore: {get: async () => ({name: "pack.pdf"}), put(){}}, CloudDocs: {add(){}}});
  const e = bill({x: amt(0), e: {notRead: {reason: "x"}, fileName: "pack.pdf · pages 7–8"}});
  if (x.keepFile) x.keepFile(e, {file: {name: "pack.pdf"}, page: [7, 8], cid: "c1"});
  else { S.files[e.id] = {name: "pack.pdf"}; S.filePages[e.id] = 7; }
  S.filePages = {};   // the page reloaded
  let got = "none";
  Object.assign(ctx, {FileStore: {get: async () => ({name: "pack.pdf"}), put(){}}, CloudDocs: {add(){}}, readerLoad: async () => {}, readWithRetry: async (f, a, page) => { got = page; return {j: {}}; },
    applyExtraction(){}, readLabel: () => "test", setPreview(){}, errCopy: () => "", READ_KINDS: [], readFail: () => ""});
  await x.retryNotRead(e.id);
  ok(JSON.stringify(got) === "[7,8]", "P6 Retry after a reload reads pages 7-8 of the PDF (read " + JSON.stringify(got) + ")");
  const e2 = bill({x: amt(0), e: {notRead: {reason: "x"}, fileName: "pack.pdf · page 5"}});
  got = "none"; toasts = [];
  await x.retryNotRead(e2.id);
  ok(got === "none" && toasts.some(t => /pages/.test(t)), "P6 a part of a PDF whose pages were not kept is not read over with the first pages (read " + JSON.stringify(got) + ")");
}

// ---- P7: speed
guard("P7", () => {
  reset();
  for (let i = 0; i < 800; i++) data.parties["p" + i] = {id: "p" + i, name: "Supplier Number " + i + " Traders", ytd: {}};
  for (let i = 0; i < 160; i++) bill({x: Object.assign(amt(1000 + i), {vendorName: i % 2 ? "Supplier Number " + (i * 3) + " Traders" : "Walk-in Vendor " + i, vendorPan: "", invoiceNo: "S" + i})});
  const t0 = Date.now(), out = ctx.memoJob(() => Object.values(data.entries).map(comp)), ms = Date.now() - t0;
  ok(ms < 1500, "P7 160 drafts without PAN, 800 suppliers: every draft's checks in one job in " + ms + " ms (< 1,500)");
  // the same counts as worked out one by one
  const a = out.map(c => (c.flags.find(f => / other draft/.test(f.t)) || {}).t || "").join("|");
  const b = Object.values(data.entries).slice(0, 20).map(comp).map(c => (c.flags.find(f => / other draft/.test(f.t)) || {}).t || "").join("|");
  ok(a.split("|").slice(0, 20).join("|") === b && Object.values(data.entries).every(e => ctx.memoJob(() => ctx.findParty(e.x, "c1")) === ctx.findParty(e.x, "c1")), "P7 the same supplier and the same other-drafts count as the one-by-one scan");
  // two suppliers of one name: the first in the list, as the scan
  data.parties.dupA = {id: "dupA", name: "Twin Name Co", pan: "", ytd: {}}; data.parties.dupB = {id: "dupB", name: "Twin Name Co", ytd: {}};
  ok(ctx.memoJob(() => ctx.findParty({vendorName: "Twin Name Co"}, "c1")).id === "dupA", "P7 two suppliers of one name: the first, as before");
  // many bills at once: the counts once
  let runs = 0; const was = x.statsRev.c1 || 0;
  if (ctx.statsHeld) ctx.statsHeld(() => { for (let i = 0; i < 5; i++) ctx.refreshStats("c1"); }); else for (let i = 0; i < 5; i++) ctx.refreshStats("c1");
  runs = (x.statsRev.c1 || 0) - was;
  ok(runs === 1, "P7 five bills in at once: the client counted once (" + runs + ")");
});

// ---- P8: the client's other registration
guard("P8", () => {
  reset();
  const gj = gst("24", CPAN), sup = gst("24", "AAACH3333M");
  const e = bill({x: Object.assign(amt(100000, 9000), {buyerGstin: gj, vendorGstin: sup, vendorPan: "AAACH3333M", vendorName: "Heron Supplies Pvt Ltd"}), e: {natureId: "goods", expenseLedger: "Purchases"}});
  const c = comp(e);
  ok(c.itc.ok && c.lines.some(l => l.role === "gst" && l.head === "CGST") && c.lines.find(l => l.role === "expense").amt === 100000, "P8 billed to the client's GJ GSTIN: input credit kept, expense 1,00,000 (" + c.lines.map(l => l.role + " " + l.amt).join(", ") + ")");
  ok(!c.missing.some(m => /belongs to/.test(m)) && !c.flags.some(f => /IGST is expected/.test(f.t)), "P8 no 'belongs to' stop, and CGST + SGST from a GJ supplier is right for the GJ registration");
  ok(c.flags.some(f => f.lvl === "hi" && /other registration/.test(f.t)), "N1 P8 a warning to check the GST ledgers are the GJ registration's");
  ok(c.missing.some(m => /GST ledgers/.test(m)), "N1 P8 approval waits for a person's word that the GST ledgers are " + gj + "'s (" + c.missing.join("; ") + ")");
  e.regOk = gj;
  const cOk = comp(e);
  ok(!cOk.missing.some(m => /GST ledgers/.test(m)) && cOk.flags.some(f => f.lvl === "" && /other registration/.test(f.t)), "N1 P8 confirmed: approval goes on, a plain note stays");
  // (the owner, 23-Nov-2026) Client setup's "This Tally company has more than one GSTIN": the company keeps each
  // registration's GST ledgers, so a bill to the other one does not wait for the per-bill word; a plain note says so
  delete e.regOk; co.multiGstin = true;
  const cM = comp(e);
  ok(!cM.missing.some(m => /GST ledgers/.test(m)) && cM.itc.ok, "MG the client's Tally company has more than one GSTIN: a bill to " + gj + " does not stop for the GST ledgers (" + cM.missing.join("; ") + ")");
  ok(cM.flags.some(f => f.lvl === "" && /other registration/.test(f.t) && /more than one GSTIN/.test(f.t)) && !cM.flags.some(f => f.lvl === "hi" && /other registration/.test(f.t)), "MG a plain note names the setting, no warning (" + cM.flags.filter(f => /registration/.test(f.t)).map(f => f.lvl + ":" + f.t).join(" | ") + ")");
  // (review of ad4be74c3) that GSTIN's own GST ledgers, set once in Client setup (co.gstByReg); none set: the bill is held,
  // never posted to the client's default GST ledgers. (gstLedgerFor is a stub here: the real one, from the source, takes a
  // bill to another registration; the rest stays the stub's)
  const src01 = fs.readFileSync(path.join(ROOT, "src", "js", "01-documents-in-the-firm-account.js"), "utf8"), cut = (n0) => { const i = src01.indexOf("function " + n0 + "("); let d = 0, j = src01.indexOf("{", i); for (; j < src01.length; j++){ if (src01[j] === "{") d++; else if (src01[j] === "}" && !--d) break; } return src01.slice(i, j + 1); };
  const stub = ctx.gstLedgerFor; vm.runInContext("globalThis.__realGL = (function(){ " + cut("billReg") + "\n" + cut("gstLedgerFor").replace("function gstLedgerFor(", "function realGL(") + "\n return realGL; })();", ctx);
  ctx.gstLedgerCheck = ctx.gstLedgerCheck || ((cid, n0) => ({ok: true, name: n0}));
  ctx.gstLedgerFor = (e0, co0, cid, head, kind, rate) => co0.multiGstin && String((e0.x || {}).buyerGstin || "") && e0.x.buyerGstin !== co0.gstin ? ctx.__realGL(e0, co0, cid, head, kind || "gst", rate) : stub(e0, co0, cid, head, kind, rate);
  const cN = comp(e), gl = cN.lines.filter(l => l.role === "gst");
  ok(gl.length === 2 && gl.every(l => !l.ledger) && cN.missing.some(m => /GSTIN 24/.test(m) && /Client setup/.test(m)), "MG2 no ledgers set for " + gj + ": its GST lines have none, the bill is held (" + cN.missing.join("; ") + ")");
  const c0 = comp(Object.assign({}, e, {x: Object.assign({}, e.x, {buyerGstin: ""})}));
  const def = (c0.lines.find(l => l.role === "gst" && l.head === "CGST") || {}).ledger || "";
  co.gstByReg = {"24": {cgst: def, sgst: (c0.lines.find(l => l.role === "gst" && l.head === "SGST") || {}).ledger || ""}};
  const cR = comp(e), gr = cR.lines.filter(l => l.role === "gst");
  ok(def && gr.every(l => l.ledger && /GSTIN 24/.test(l.why)) && !cR.missing.some(m => /GSTIN 24/.test(m)), "MG2 set for 24: the bill takes them (" + gr.map(l => l.head + " " + l.ledger + " (" + l.why + ")").join(", ") + ")");
  ok(comp(Object.assign({}, e, {x: Object.assign({}, e.x, {buyerGstin: ""})})).lines.filter(l => l.role === "gst").every(l => !/GSTIN 24/.test(l.why)), "MG2 a bill to the client's own GSTIN: its usual ledgers, not 24's (the pick is the registration's)");
  delete co.gstByReg; ctx.gstLedgerFor = stub;
  co.multiGstin = false;
  ok(comp(e).missing.some(m => /GST ledgers/.test(m)), "MG the setting off again: the bill waits for the word once more");
  delete co.multiGstin;
  const e2 = bill({x: Object.assign(amt(100000, 9000), {buyerGstin: gst("24", "AAACZ9999Z"), vendorGstin: sup, vendorPan: "AAACH3333M", vendorName: "Heron Supplies Pvt Ltd"}), e: {natureId: "goods", expenseLedger: "Purchases"}});
  ok(!comp(e2).itc.ok, "P8 a GSTIN of another PAN is still not the client's");
});

// ---- PL: the document inbox
guard("PL", () => {
  const saved = [], marks = [];
  Object.assign(ctx, {docqSave: async (d, p) => { saved.push(p); }, localSet: (id, st, msg) => marks.push([st, msg])});
  const fA = {name: "sale.pdf", __docq: "d1"};
  S.docq = {d1: {id: "d1"}, d2: {id: "d2"}};
  const jA = {file: fA, status: "unsorted", msg: "Sales invoice of Fern: filed under Sales", name: "sale.pdf"};
  S.jobs = [jA];
  x.docqFinish(jA);
  ok(saved.length === 1 && saved[0].status === "read", "PL a file sent to Sales is read, not left 'Not read' (" + JSON.stringify(saved) + ")");
  saved.length = 0; marks.length = 0;
  const fB = {name: "pack.pdf", __docq: "d2"};
  const j1 = {file: fB, status: "done", entryId: "e1", name: "pack.pdf · page 1"}, j2 = {file: fB, status: "reading", name: "pack.pdf · page 2"};
  S.jobs = [j1, j2];
  x.docqFinish(j1);
  ok(!saved.length, "PL a PDF of two bills: not read while its second part is being read");
  j2.status = "failed"; j2.msg = "could not be read";
  x.docqFinish(j2);
  ok(!saved.length && marks.some(m => m[0] === "failed" && /page 2/.test(m[1] || "")), "PL its second part failed: it stays waiting and names that part (" + JSON.stringify(marks) + ")");
  ok(marks.some(m => m[0] === "failed" && /Retry|Type it in/.test(m[1] || "")), "N1 PL the message says to Retry or Type it in on that part (reading the file again here skips the parts read)");
});

// ---- TL: limits by who and when
guard("TL", () => {
  reset();
  const ec = bill({x: Object.assign(amt(400000), {vendorPan: "AAACS4444N", vendorName: "Swift Sellers Pvt Ltd"}), e: {natureId: "ecommerce"}});
  let c = comp(ec);
  ok(c.applicable && c.tds === 400, "TL 194-O: a company seller with 4 lakh: 0.1% from the first rupee, 400 (" + c.tds + ")");
  ec.x.vendorPan = "AAAPS4444N"; c = comp(ec);
  ok(!c.applicable, "TL 194-O: an individual seller with a PAN and 4 lakh: within the 5 lakh limit");
  data.parties["p-tr"] = {id: "p-tr", name: "Gull Roadways", transporter: true, pan: "", ytd: {}};
  const tr = bill({x: Object.assign(amt(50000), {vendorName: "Gull Roadways", vendorPan: ""}), e: {natureId: "contractor"}});
  c = comp(tr);
  ok(!c.skip && c.tds === 10000, "TL 194C(6): a transporter with no PAN is not let off; 20% under 206AA (" + c.tds + ", " + (c.skip && c.skip.reason) + ")");
  data.parties["p-tr"].pan = "AAAFG5555P"; tr.x.vendorPan = "AAAFG5555P"; c = comp(tr);
  ok(c.skip && c.skip.reason === "transporter", "TL 194C(6): with its PAN, the declaration lets it off");
  const pf = bill({x: Object.assign(amt(40000), {invoiceDate: "2025-03-10", vendorName: "Ibis Advisors", vendorPan: "AAAPI6666Q"}), e: {natureId: "professional"}});
  c = comp(pf);
  ok(c.applicable && c.tds === 4000, "TL a professional bill of 10-Mar-2025, 40,000: above FY 2024-25's limit of 30,000 (" + c.tds + ")");
  pf.x.invoiceDate = "2025-04-10"; c = comp(pf);
  ok(!c.applicable, "TL the same bill dated 10-Apr-2025: within 50,000");
  const pt = bill({x: Object.assign(amt(60000), {invoiceDate: "2025-03-10", vendorName: "A Partner", vendorPan: "AAAPP7777R"}), e: {natureId: "partner"}});
  ok(comp(pt).rule.basis === "never" && comp(pt).tds === 0, "TL a partner's remuneration before 1-Apr-2025: no 194T yet");
  const cm = bill({x: Object.assign(amt(30000), {invoiceDate: "2024-09-01", vendorName: "Jay Agents", vendorPan: "AAAPJ8888S"}), e: {natureId: "commission"}});
  ok(comp(cm).tds === 1500, "TL commission of 1-Sep-2024: 5% (before the cut to 2% on 1-Oct-2024): 1,500 (" + comp(cm).tds + ")");
  const rn = bill({x: Object.assign(amt(60000), {invoiceDate: "2024-12-01", vendorName: "Kite Estates", vendorPan: "AAAPK9999T"}), e: {natureId: "rent_building"}});
  ok(!comp(rn).applicable, "TL rent of 60,000 in Dec-2024: FY 2024-25's limit was 2,40,000 a year");
});

/* ================================================================ the TDS rows (books from Tally) */
function tdsRows(){
  const N = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend",
    "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gramsOf", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "AS26", "GSTCMP", "GSTAPI", "TDSRate", "TDSInt", "TDSSep", "GSTIN_RE", "TDSFiled", "ClosedP",
    "BOOKS_KEYS", "AuditWP", "TDSWatch", "TDSTally", "TDSAudit", "TDSCH", "TDSAdj", "noPanRate", "NO_PAN_RATE", "AIH", "istParts", "p2ist", "istDay", "istToday"];
  const L = load(HTML, N), c2 = L.ctx, y = L.x;
  c2.saveBooks = () => {}; c2.whoAmI = () => "t"; c2.S.data = {};
  // T3
  ["Building Repairs & Maintenance", "Factory Building Repair Contract", "Furniture Repair Labour", "Land Development Contract", "Rentokil Pest Control", "Housekeeping - Current Year", "Repairs to Building"].forEach(w =>
    ok(y.TDSRate.kindOf(w) === "contractor", "T3 “" + w + "”: a contract, not rent (" + y.TDSRate.kindOf(w) + ")"));
  ["Rent", "Office Rent", "Godown Rent", "Lease Rentals", "Rent - Building", "Office Rentals", "Rentals"].forEach(w => ok(y.TDSRate.kindOf(w) === "rent_building", "T3 “" + w + "”: still rent"));
  ok(y.TDSRate.kindOf("Machinery Hire Charges") === "rent_machinery", "T3 machinery hire: still rent of machinery");
  // T2: rent of 60,000 credited on 1-Apr without TDS; the payment of 15-May cuts its TDS of 6,000
  const V = [
    {id: "v1", no: "1", type: "Journal", date: "20250401", party: "Lark Properties", ref: "LP-1", narr: "", ent: [{l: "Office Rent", a: -60000}, {l: "Lark Properties", a: 60000}]},
    {id: "v2", no: "2", type: "Payment", date: "20250515", party: "Lark Properties", ref: "", narr: "", ent: [{l: "Lark Properties", a: -60000}, {l: "HDFC Bank", a: 54000}, {l: "TDS on Rent 194I", a: 6000}]},
    // the bill and its TDS in one entry, paid later: unchanged
    {id: "v3", no: "3", type: "Journal", date: "20250601", party: "Moss Interiors Pvt Ltd", ref: "", narr: "", ent: [{l: "Contract Charges", a: -50000}, {l: "TDS on Contract 194C", a: 1000}, {l: "Moss Interiors Pvt Ltd", a: 49000}]},
    // T3: repairs by a company at 1% under 194C (2% applies); the ledger's name alone does not hide the rate check
    {id: "v4", no: "4", type: "Journal", date: "20250701", party: "Moss Interiors Pvt Ltd", ref: "", narr: "", ent: [{l: "Building Repairs & Maintenance", a: -100000}, {l: "TDS on Contract 194C", a: 1000}, {l: "Moss Interiors Pvt Ltd", a: 99000}]},
    // T2b: rent of 1,00,000 (New Ref WR-1) paid in two instalments, TDS cut in each (Agst Ref WR-1); a third payment after the bill is used up
    {id: "w1", no: "11", type: "Journal", date: "20250401", party: "Wren Estates", ref: "", narr: "", ent: [{l: "Office Rent", a: -100000}, {l: "Wren Estates", a: 100000, b: [["WR-1", "New Ref", 100000]]}]},
    {id: "w2", no: "12", type: "Payment", date: "20250515", party: "Wren Estates", ref: "", narr: "", ent: [{l: "Wren Estates", a: -50000, b: [["WR-1", "Agst Ref", -50000]]}, {l: "HDFC Bank", a: 45000}, {l: "TDS on Rent 194I", a: 5000}]},
    {id: "w3", no: "13", type: "Payment", date: "20250615", party: "Wren Estates", ref: "", narr: "", ent: [{l: "Wren Estates", a: -50000, b: [["WR-1", "Agst Ref", -50000]]}, {l: "HDFC Bank", a: 45000}, {l: "TDS on Rent 194I", a: 5000}]},
    {id: "w4", no: "14", type: "Payment", date: "20250715", party: "Wren Estates", ref: "", narr: "", ent: [{l: "Wren Estates", a: -10000, b: [["WR-1", "Agst Ref", -10000]]}, {l: "HDFC Bank", a: 9000}, {l: "TDS on Rent 194I", a: 1000}]},
    // T2b: two professional bills (30,000, then 40,000) paid at once with TDS on 70,000: the first was within 50,000 on its own
    {id: "o1", no: "21", type: "Journal", date: "20250602", party: "Owl Advisors", ref: "", narr: "", ent: [{l: "Professional Fees", a: -30000}, {l: "Owl Advisors", a: 30000}]},
    {id: "o2", no: "22", type: "Journal", date: "20250610", party: "Owl Advisors", ref: "", narr: "", ent: [{l: "Professional Fees", a: -40000}, {l: "Owl Advisors", a: 40000}]},
    {id: "o3", no: "23", type: "Payment", date: "20250630", party: "Owl Advisors", ref: "", narr: "", ent: [{l: "Owl Advisors", a: -70000}, {l: "HDFC Bank", a: 63000}, {l: "TDS on Professional 194J", a: 7000}]}];
  const under = {"Building Repairs & Maintenance": "Indirect Expenses", "Office Rent": "Indirect Expenses", "Contract Charges": "Indirect Expenses", "Lark Properties": "Sundry Creditors", "Moss Interiors Pvt Ltd": "Sundry Creditors", "HDFC Bank": "Bank Accounts",
    "TDS on Rent 194I": "Duties & Taxes", "TDS on Contract 194C": "Duties & Taxes", "Wren Estates": "Sundry Creditors", "Owl Advisors": "Sundry Creditors", "Professional Fees": "Indirect Expenses", "TDS on Professional 194J": "Duties & Taxes"};
  const b = {cid: "ct", vouchers: V, meta: {from: "20250401", to: "20260331"}, under,
    groups: {"Sundry Creditors": "Current Liabilities", "Duties & Taxes": "Current Liabilities", "Bank Accounts": "Current Assets", "Indirect Expenses": "", "Current Liabilities": "", "Current Assets": ""},
    ledInfo: Object.fromEntries(Object.keys(under).map(l => [l, {ob: 0, from: "20250401"}])), pans: {"Lark Properties": "AAAFL1234L", "Moss Interiors Pvt Ltd": "AAACM1234M", "Wren Estates": "AAAFW1234W", "Owl Advisors": "AAAFO1234O"}, challans: [], alloc: {}};
  const co2 = {id: "ct", name: "Rows Fixture"};
  c2.S.books = b; c2.S.coId = "ct"; c2.S.companies = {ct: co2}; c2.CO = () => co2;
  b.map = y.Books.mapLedgers(b.vouchers, {});
  const rows = y.TDS.allRows(), r = rows.find(z => String(z.id).startsWith("v2|"));
  ok(r && r.credit && y.TDS.ymd(r.credit) === "20250401" && r.paid === 60000 && r.tds === 6000, "T2 the payment's TDS row carries the bill of 1-Apr (60,000) as its date of credit (" + (r && [r.credit, r.paid, r.tds]) + ")");
  const hit = r && y.TDSInt.lateDeduct(r);
  ok(hit && hit.months === 2 && Math.round(6000 * 0.01 * hit.months) === 120, "T2 201(1A)(i): 1% a month for 2 months from 1-Apr to 15-May: ₹120 (" + JSON.stringify(hit) + ")");
  const iss = y.Certs.issues("2025-26").find(z => String(z.row.id).startsWith("v4|"));
  ok(iss && iss.expected === 2 && iss.short === 1000, "T3 1% to a company on \u201cBuilding Repairs & Maintenance\u201d under 194C: short by 1,000 at 2% (" + (iss && [iss.expected, iss.short]) + ")");
  const m = rows.find(z => String(z.id).startsWith("v3|"));
  ok(m && !m.credit && m.paid === 50000 && m.rate === 2, "T2 a bill with its TDS in it: unchanged (" + (m && [m.credit, m.paid, m.rate]) + ")");
  const w = id => rows.find(z => String(z.id).startsWith(id + "|")) || {};
  const w2 = w("w2"), w3 = w("w3"), w4 = w("w4");
  ok(w2.paid === 50000 && w2.rate === 10 && !w2.sepShort && !w2.topUp && y.TDS.ymd(w2.credit) === "20250401", "T2b first instalment: 50,000 paid at 10%, credited 1-Apr, not short (" + [w2.paid, w2.rate, w2.sepShort, w2.topUp, w2.credit] + ")");
  ok(w3.paid === 50000 && w3.rate === 10 && !w3.sepShort && !w3.topUp && y.TDS.ymd(w3.credit) === "20250401", "T2b second instalment: 50,000 paid at 10% too, not a top-up (" + [w3.paid, w3.rate, w3.sepShort, w3.topUp, w3.credit] + ")");
  ok(w4.paid === 10000 && w4.rate === 10 && !w4.topUp && !w4.sepShort, "T2b a payment after the bill is used up keeps its own 10,000 (" + [w4.paid, w4.rate, w4.topUp, w4.credit] + ")");
  const o3 = w("o3");
  ok(o3.paid === 70000 && (o3.bills || []).length === 2 && y.TDS.ymd(o3.credit) === "20250602" && o3.creditCheck, "T2b TDS on two bills, the first (30,000) within 50,000 on its own: its date flagged for a person (" + [o3.paid, (o3.bills || []).length, o3.credit, o3.creditCheck] + ")");
  if (y.TDSAudit || c2.TDSAudit){ const A = y.TDSAudit || c2.TDSAudit, notes = A.notes("2025-26", "Q1", "26Q");
    ok(notes.some(z => z.level === "warn" && /Owl Advisors/.test(z.words) && /limit/.test(z.words)), "T2b Validate & file warns: check the date of credit of Owl Advisors' TDS"); }
}

(async () => {
  try { await p3(); } catch (e){ ok(false, "P3 (threw " + (e && e.message) + ")"); }
  try { await p6(); } catch (e){ ok(false, "P6 (threw " + (e && e.message) + ")"); }
  try { tdsRows(); } catch (e){ ok(false, "T2/T3 (threw " + (e && e.stack) + ")"); }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
