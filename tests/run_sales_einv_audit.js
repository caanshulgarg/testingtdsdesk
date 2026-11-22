// node run_sales_einv_audit.js - the sales and e-invoice findings of the audit (next-fix-audit-sales-einv), on made-up data:
//   1. an invoice whose items do not add up to its own taxable value and GST is held, never posted with the gap in Round Off;
//   2. the e-invoice is raised under the client's registration the invoice is issued from (seller, state, API login),
//      not always its main GSTIN; a registration not known, or with no address, is asked for;
//   3. an invoice with an active IRN cannot be changed; a cancelled IRN takes the invoice out of the sales (ignored), is
//      never posted, and a voucher already in Tally is said to need cancelling there; <IRN> only for a live IRN;
//   4. a supply to an SEZ (IGST Act s.7(5)(b)): inter-state even within the state, IGST with payment, none under LUT,
//      SupTyp SEZWP / SEZWOP on the e-invoice; held for Tally (FinCom cannot mark the voucher SEZ);
//   5. a credit note against an invoice posted from FinCom is set against that bill in Tally (Agst Ref), not a New Ref;
//   6. (the review of b4ff11b10) only the same customer's one invoice of that number in the note's year, on or before it;
//      a live IRN: the customer ledger never rewrites the party, no Ignore or Delete; a cancel with a posting queued;
//      a cancel of an IRN made before irnGstin was kept; IGST against CGST + SGST on the IRP; the items check on opening.
// Run after python3 build.py (it reads site-test/index.html).
const {load, HTML} = require("./harness");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const NAMES = ["num", "r2", "INR", "money", "xesc", "GSTIN_RE", "GST_CHARS", "gstinCheckChar", "gstinValid", "GST_STATES", "SALES_RATES", "stateOfGstin", "fyLabel", "rateTag",
  "salesOwnGstins", "salesPan", "salesGstinOfPan", "salesOwnStates", "salesIsOwn", "salesSeriesKeys", "salesRegOf", "salesLearnReg",
  "salesTotals", "isInterState", "salesLines", "salesTaxKey", "invoiceProblems", "normInvNo", "ledgerProblems", "mapInvoice", "salesVt", "salesCmpGstin", "salesAgainstOf", "salesVoucherXml",
  "stateCodeFrom", "partyMaster", "salesPartyFill", "salesProblemsNow", "salesSnapshot", "salesInTally", "salesBulk", "salesRowAct", "salesQueuedSync",
  "inv", "blankItem", "salesIrnLocked", "startDraft", "recalcDraft", "draftProblems", "saveDraft", "salesSetField", "salesSetKind", "EINV"];
const {ctx, x} = load(HTML, NAMES);
// made-up GSTINs of one PAN in Maharashtra (27) and Karnataka (29), and customers'
const mk = b => { for (const c of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (x.gstinValid(b + c)) return b + c; };
const MH = mk("27AAACZ1234Q1Z"), KA = mk("29AAACZ1234Q1Z"), CMH = mk("27AAACK5678P1Z"), CKA = mk("29AAACM5678P1Z"), SEZC = mk("27AAACS4321R1Z");
const co = {id: "c1", name: "Zeta Made Up Pvt Ltd", gstin: MH, otherGstins: ""};
const s = {cid: "c1", list: [], cfg: {auto: true, address: "1 Test Road, Pune 411001", items: {}, series: "INV/{FY}/", next: 1, pad: 3}, hist: {}};
let calls = [], toasts = [], jobs = {};
Object.assign(ctx, {SL: () => s, CO: () => co, saveSales(){}, render(){}, toast: t => toasts.push(t), hasLedgerList: () => true, exactLedger: n => n || "",
  taxLedgerPick: (kind) => ({ledger: "Output " + kind.toUpperCase()}), salesLedgerFor: () => "Sales", roundOffLedger: () => "Round Off",
  customerLedgerFor: () => ({ledger: "Made Up Customer", sure: true, label: "test"}), salesDupOf: () => null, salesDupWords: () => "", salesOfNo: () => s.list,
  B: () => ({ledgers: {list: [{name: "Customer A", gstin: CMH, state: "Maharashtra"}, {name: "Customer B", gstin: CKA, state: "Karnataka"}]}}), salesSetUndo(){}, Cloud: {delete(){}},
  CloudPost: {row: async id => jobs[id]}, salesRefusal: () => null, salesMarkRefused(){}, plainMsg: m => String(m || ""),
  tallyLedgerName: n => n, fmtDate: d => d, toTallyDate: d => String(d).replace(/-/g, ""), learnCustomer(){}, esc: t => t,
  nextInvoiceNumber: () => ({number: "INV/1", n: 1}), seriesNumber: () => "INV/1", window: {scrollTo(){}}, setTimeout,
  GSTAPI: {call: async (b) => { calls.push(b); return {irn: "IRN-TEST-1", ackNo: "1", ackDt: new Date().toISOString(), signedQr: ""}; }}});
let n = 0;
const add = (o) => { const v = {id: "sv" + (++n), source: "upload", status: "review", customerLedger: "", userLedger: false,
  x: Object.assign({number: "T-" + n, date: "2025-10-05", customerName: "Made Up Customer", customerGstin: CMH, address: "2 Test Lane, Pune 411002", pos: "27", taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0, items: []}, o)};
  s.list.push(v); x.mapInvoice(v); return v; };
const it = (taxable, gstRate, extra) => Object.assign({desc: "Made up item", hsn: "998314", qty: 1, unit: "Nos", rate: taxable, taxable, gstRate}, extra || {});
(async () => {
  console.log("1. items that do not add up to the invoice");
  const bad = add({taxable: 10000, cgst: 575, sgst: 575, total: 11150, items: [it(5000, 12), it(5000, 18)]});
  const ro = x.salesLines(bad).find(l => l.role === "roundoff");
  ok(bad.status !== "ready" && bad.problems.some(p => /items/i.test(p) && /Round Off/.test(p)), "held: the items (GST 1,500) do not agree with the invoice (GST 1,150), the gap of " + (ro ? ro.amt : 0) + " not hidden in Round Off: " + JSON.stringify(bad.problems));
  const good = add({taxable: 10000, cgst: 750, sgst: 750, total: 11500, items: [it(5000, 12), it(5000, 18)]});
  ok(good.status === "ready" && !good.problems.length, "items at two rates that add up: ready (" + good.status + " " + JSON.stringify(good.problems) + ")");
  const paise = add({taxable: 1000.4, cgst: 90.04, sgst: 90.04, total: 1180, items: [it(1000.4, 18)]});
  ok(paise.status === "ready", "an invoice rounded to the rupee (round off 0.48) stays ready (" + JSON.stringify(paise.problems) + ")");
  const sumOff = add({taxable: 10000, cgst: 900, sgst: 900, total: 11800, items: [it(6000, 18), it(3000, 18)]});
  ok(sumOff.status !== "ready" && sumOff.problems.some(p => /items/i.test(p)), "items' taxable 9,000 against the invoice's 10,000 at one rate: held (" + JSON.stringify(sumOff.problems) + ")");

  console.log("2. the e-invoice under the registration the invoice is issued from");
  co.otherGstins = KA;
  const ka = add({sellerGstin: KA, customerGstin: CKA, pos: "29", address: "3 Test Street, Bengaluru 560001", taxable: 10000, cgst: 900, sgst: 900, total: 11800, items: [it(10000, 18)]});
  let pr = x.EINV.problems(ka, co, s.cfg);
  ok(pr.some(p => p.includes(KA) && /address/i.test(p)), "the Karnataka registration's own address is asked for, never the Maharashtra one's (" + JSON.stringify(pr) + ")");
  s.cfg["address_" + KA] = "4 Test Circle, Bengaluru 560002";
  pr = x.EINV.problems(ka, co, s.cfg);
  let b = x.EINV.build(ka, co, s.cfg);
  ok(!pr.length && b.SellerDtls.Gstin === KA && b.SellerDtls.Stcd === "29" && b.SellerDtls.Pin === 560002, "seller: the 29 GSTIN, state 29, its own PIN (" + b.SellerDtls.Gstin + " " + b.SellerDtls.Stcd + " " + b.SellerDtls.Pin + ")");
  ok(b.ValDtls.CgstVal === 900 && b.ValDtls.SgstVal === 900 && b.ValDtls.IgstVal === 0, "within Karnataka: CGST + SGST, no IGST (" + JSON.stringify(b.ValDtls) + ")");
  calls = []; await x.EINV.irn(ka);
  ok(calls[0] && calls[0].gstin === KA && ka.x.irnGstin === KA, "the IRN asked for with the 29 login (" + (calls[0] && calls[0].gstin) + ")");
  const nobody = add({number: "991", customerGstin: CKA, pos: "29", taxable: 100, cgst: 9, sgst: 9, total: 118, items: [it(100, 18)]});
  pr = x.EINV.problems(nobody, co, s.cfg);
  ok(pr.some(p => /registration/i.test(p)), "two registrations and the invoice's not known: asked, never the main GSTIN (" + JSON.stringify(pr) + ")");
  co.otherGstins = "";

  console.log("3. an IRN made: no edits; an IRN cancelled: no longer a sale");
  const live = add({taxable: 1000, cgst: 90, sgst: 90, total: 1180, items: [it(1000, 18)], irn: "IRN-LIVE", irnStatus: "active", ackDt: new Date().toISOString()});
  s.openId = live.id; toasts = [];
  x.salesSetField("taxable", "800");
  ok(live.x.taxable === 1000 && toasts.some(t => /IRN/.test(t)), "a field of an invoice with a live IRN is not changed (" + live.x.taxable + ", " + JSON.stringify(toasts) + ")");
  s.draft = null; x.startDraft(live.id);
  ok(!s.draft, "nor is it opened for editing");
  s.draft = {editId: live.id, x: JSON.parse(JSON.stringify(live.x)), customerLedger: ""}; s.draft.x.items[0].rate = 800; s.draft.x.items[0].taxable = 800;
  ok(x.saveDraft() === null && live.x.taxable === 1000, "nor saved from an edit opened before");
  s.draft = null;
  const st = live.status; live.status = "review"; live.hold = true; x.salesSetKind(live.id, "credit"); delete live.hold; live.status = st;
  ok(!live.x.noteKind, "nor made a credit note by Edit type");
  await x.EINV.cancel(live, "2", "test");
  ok(live.status === "ignored", "the IRN cancelled: the invoice leaves the sales (" + live.status + ")");
  live.status = "review"; x.mapInvoice(live);
  ok(live.status !== "ready" && live.problems.some(p => /IRN/.test(p) && /cancelled/i.test(p)), "brought back, it is held: its IRN is cancelled (" + JSON.stringify(live.problems) + ")");
  ok(!/<IRN>/.test(x.salesVoucherXml(live, co)), "the voucher never carries a cancelled IRN");
  const read = add({taxable: 1000, cgst: 90, sgst: 90, total: 1180, irn: "IRN-READ-FROM-PDF"});
  ok(/<IRN>IRN-READ-FROM-PDF<\/IRN>/.test(x.salesVoucherXml(read, co)), "an IRN read from an uploaded invoice is still written");
  const posted = add({taxable: 1000, cgst: 90, sgst: 90, total: 1180, irn: "IRN-POSTED", irnStatus: "active"}); posted.status = "posted";
  await x.EINV.cancel(posted, "2", "test");
  ok(posted.status === "posted" && posted.x.irnCancelInTally === true, "already in Tally: stays posted, marked for cancelling the voucher in Tally");

  console.log("4. a supply to an SEZ");
  const sezWp = add({customerGstin: SEZC, pos: "27", supply: "SEZWP", taxable: 10000, igst: 1800, total: 11800, items: [it(10000, 18)]});
  ok(!sezWp.problems.some(p => /CGST \+ SGST are expected/.test(p)), "IGST to an SEZ in the same state is not called wrong (" + JSON.stringify(sezWp.problems) + ")");
  ok(sezWp.status !== "ready" && sezWp.problems.some(p => /SEZ/.test(p) && /Tally/.test(p)), "held for Tally: FinCom cannot mark the voucher SEZ");
  ok(x.isInterState(sezWp.x, co), "inter-state by law (s.7(5)(b)) though within Maharashtra");
  b = x.EINV.build(sezWp, co, s.cfg);
  ok(b.TranDtls.SupTyp === "SEZWP" && b.ValDtls.IgstVal === 1800 && b.ValDtls.CgstVal === 0, "e-invoice: SEZWP with IGST 1,800 (" + b.TranDtls.SupTyp + " " + JSON.stringify(b.ValDtls) + ")");
  const sezCg = add({customerGstin: SEZC, pos: "27", supply: "SEZWP", taxable: 10000, cgst: 900, sgst: 900, total: 11800, items: [it(10000, 18)]});
  ok(sezCg.problems.some(p => /SEZ/.test(p) && /IGST/.test(p) && /7\(5\)/.test(p)), "CGST + SGST to an SEZ: IGST is due (" + JSON.stringify(sezCg.problems) + ")");
  const lut = add({customerGstin: SEZC, pos: "27", supply: "SEZWOP", taxable: 10000, total: 10000, items: [it(10000, 18)]});
  b = x.EINV.build(lut, co, s.cfg);
  ok(b.TranDtls.SupTyp === "SEZWOP" && b.ValDtls.IgstVal === 0 && b.ValDtls.TotInvVal === 10000 && !x.EINV.problems(lut, co, s.cfg).length, "under LUT: SEZWOP, no tax, total 10,000 (" + JSON.stringify(b.ValDtls) + ")");
  const lutTax = add({customerGstin: SEZC, pos: "27", supply: "SEZWOP", taxable: 10000, igst: 1800, total: 11800, items: [it(10000, 18)]});
  ok(lutTax.problems.some(p => /LUT/.test(p)), "IGST charged on a supply under LUT: held (" + JSON.stringify(lutTax.problems) + ")");

  console.log("5. a credit note against an invoice");
  const orig = add({number: "INV-77", taxable: 1000, cgst: 90, sgst: 90, total: 1180}); orig.status = "posted";
  const cn = add({number: "CN-5", noteKind: "credit", againstInvoice: "INV-77", taxable: 100, cgst: 9, sgst: 9, total: 118});
  const xml = x.salesVoucherXml(cn, co);
  ok(/<NAME>INV-77<\/NAME>\n<BILLTYPE>Agst Ref<\/BILLTYPE>/.test(xml), "set against bill INV-77 (Agst Ref)");
  const cn2 = add({number: "CN-6", noteKind: "credit", againstInvoice: "NOT-HERE", taxable: 100, cgst: 9, sgst: 9, total: 118});
  ok(/<NAME>CN-6<\/NAME>\n<BILLTYPE>New Ref<\/BILLTYPE>/.test(x.salesVoucherXml(cn2, co)), "an invoice not known here: its own New Ref, as before");

  console.log("6. the review of b4ff11b10");
  // (a) a credit note to another customer: never set against customer A's bill
  const invA = add({number: "INV-88", date: "2025-09-01", taxable: 1000, cgst: 90, sgst: 90, total: 1180}); invA.status = "posted"; invA.customerLedger = "Customer A";
  const cnB = add({number: "CN-8", noteKind: "credit", againstInvoice: "INV-88", customerGstin: CKA, pos: "29", taxable: 100, igst: 18, total: 118}); cnB.customerLedger = "Customer B";
  ok(!x.salesAgainstOf(cnB) && /<NAME>CN-8<\/NAME>\n<BILLTYPE>New Ref<\/BILLTYPE>/.test(x.salesVoucherXml(cnB, co)), "a note to customer B is never set against customer A's INV-88: its own New Ref");
  const cnA = add({number: "CN-9", noteKind: "credit", againstInvoice: "INV-88", taxable: 100, cgst: 9, sgst: 9, total: 118}); cnA.customerLedger = "Customer A";
  ok(x.salesAgainstOf(cnA) === invA, "a note to customer A: against A's INV-88");
  // (b) a series that starts again each year: last year's invoice 5 is not this year's
  const old5 = add({number: "5", date: "2025-06-01", taxable: 1000, cgst: 90, sgst: 90, total: 1180}); old5.status = "posted";
  const cn26 = add({number: "C-1", noteKind: "credit", againstInvoice: "5", date: "2026-07-10", taxable: 100, cgst: 9, sgst: 9, total: 118});
  ok(!x.salesAgainstOf(cn26), "a 2026-27 note against invoice 5: never set against 2025-26's invoice 5 (New Ref)");
  const new5 = add({number: "5", date: "2026-05-01", taxable: 1000, cgst: 90, sgst: 90, total: 1180}); new5.status = "posted";
  ok(x.salesAgainstOf(cn26) === new5, "with 2026-27's invoice 5 posted: against that one");
  const early = add({number: "C-2", noteKind: "credit", againstInvoice: "5", date: "2026-04-20", taxable: 100, cgst: 9, sgst: 9, total: 118});
  ok(!x.salesAgainstOf(early), "a note dated before the invoice is never set against it");
  const twin5 = add({number: "5", date: "2026-05-02", taxable: 500, cgst: 45, sgst: 45, total: 590}); twin5.status = "intally";
  ok(!x.salesAgainstOf(cn26), "two invoices 5 of the customer in the year: not known which, New Ref");
  // a live IRN: the customer ledger never rewrites the party, GSTIN or place of supply the IRN was made with
  const sheet = add({customerGstin: "", pos: "", taxable: 1000, cgst: 90, sgst: 90, total: 1180});
  sheet.sheetHad = {gstin: false, pos: false}; sheet.customerLedger = "Customer A"; x.salesPartyFill(sheet);
  ok(sheet.x.customerGstin === CMH && sheet.x.pos === "27", "filled from ledger A (" + sheet.x.customerGstin + " " + sheet.x.pos + ")");
  Object.assign(sheet.x, {irn: "IRN-SHEET", irnStatus: "active"}); sheet.customerLedger = "Customer B"; x.salesPartyFill(sheet);
  ok(sheet.x.customerGstin === CMH && sheet.x.pos === "27", "IRN made: ledger B set, the GSTIN and place of supply stay the IRN's (" + sheet.x.customerGstin + " " + sheet.x.pos + ")");
  sheet.customerLedger = ""; x.salesPartyFill(sheet);
  ok(sheet.x.customerGstin === CMH && sheet.x.pos === "27", "and clearing the ledger does not blank them");
  // a live IRN: no Ignore, no Delete (one by one or selected)
  s.sel = new Set(); s.sticky = new Set(); toasts = [];
  const irnd = add({taxable: 1000, cgst: 90, sgst: 90, total: 1180, irn: "IRN-KEEP", irnStatus: "active"});
  x.salesRowAct("ignore", irnd.id);
  ok(irnd.status !== "ignored" && toasts.some(t => /IRN/.test(t)), "Ignore on a live IRN: refused, cancel the IRN first (" + irnd.status + " " + JSON.stringify(toasts) + ")");
  x.salesRowAct("delete", irnd.id);
  ok(s.list.includes(irnd), "Delete on a live IRN: refused, the IRN, Ack and QR kept");
  s.sel.add(irnd.id); x.salesBulk("ignore"); s.sel.add(irnd.id); x.salesBulk("delete");
  ok(s.list.includes(irnd) && irnd.status !== "ignored", "nor by Ignore or Delete on the selected invoices");
  const plain = add({taxable: 1000, cgst: 90, sgst: 90, total: 1180}); x.salesRowAct("ignore", plain.id);
  ok(plain.status === "ignored", "an invoice with no IRN is still ignored");
  // a cancel while a posting is queued in the cloud
  const q = add({taxable: 1000, cgst: 90, sgst: 90, total: 1180, irn: "IRN-Q", irnStatus: "active", irnGstin: MH}); q.status = "ready"; q.postJob = "job-ok-1";
  await x.EINV.cancel(q, "2", "test");
  ok(q.status === "ready" && q.x.irnCancelInTally === true, "a posting queued: the result still awaited, marked for cancelling in Tally (" + q.status + ")");
  x.mapInvoice(q);
  jobs["job-ok-1"] = {status: "done", company: "Made Up Co", results: [{id: q.id, ok: true}]};
  await x.salesQueuedSync();
  ok(q.status === "posted" && q.x.irnCancelInTally === true, "the voucher reached Tally: posted, and the alert to cancel it there stands (" + q.status + ")");
  const q2 = add({taxable: 1000, cgst: 90, sgst: 90, total: 1180, irn: "IRN-Q2", irnStatus: "active", irnGstin: MH}); q2.status = "ready"; q2.postJob = "job-bad-1";
  await x.EINV.cancel(q2, "2", "test"); x.mapInvoice(q2);
  jobs["job-bad-1"] = {status: "failed", message: "Tally closed", results: []};
  await x.salesQueuedSync();
  ok(q2.status === "ignored" && !q2.x.irnCancelInTally && !q2.postJob, "the posting failed: set aside (Ignored), nothing to cancel in Tally (" + q2.status + ")");
  // an IRN made before irnGstin was kept, for a client of two registrations: cancelled and e-way billed with the main GSTIN
  co.otherGstins = KA; calls = [];
  const oldIrn = add({number: "992", customerGstin: CKA, pos: "29", taxable: 100, cgst: 9, sgst: 9, total: 118, items: [it(100, 18)], irn: "IRN-OLD", irnStatus: "active"});
  await x.EINV.ewb(oldIrn, {}); await x.EINV.cancel(oldIrn, "2", "test");
  ok(calls.length === 2 && calls.every(c => c.gstin === MH), "an IRN made before: e-way bill and cancel under the GSTIN it was made with (" + calls.map(c => c.gstin).join(", ") + ")");
  co.otherGstins = "";
  // the IRP's IGST, CGST and SGST are the invoice's own
  const mixed = add({customerGstin: CKA, pos: "29", taxable: 10000, cgst: 900, sgst: 900, total: 11800, items: [it(10000, 18)]});
  pr = x.EINV.problems(mixed, co, s.cfg);
  ok(pr.some(p => /IGST/.test(p) && /CGST/.test(p)), "booked with CGST + SGST, place of supply another state: the IRN is not made with IGST (" + JSON.stringify(pr) + ")");
  // the items check is part of the problems worked out again on opening
  ok(x.salesProblemsNow(bad).some(p => /items/i.test(p) && /Round Off/.test(p)), "the problems worked out again keep the items check");
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
