// node run_sheet_gstin.js - next-fix-sheetgst: a client's saved sales layout was made before its sheet had a GSTIN column.
// The owner added the column; the saved format still read the sheet ("drift": every column it maps is still there by
// name) and the GSTIN column was dropped without a word, and uploading the sheet again over the invoices already in
// Sales kept the old GSTIN-less ones and duplicated a row whose old GSTIN differed. Here, on made-up parties and
// GSTINs only (app/src/lib/registers.js, with no browser):
//   1. a saved format meeting new columns: a GSTIN column by any of its usual names is read as the party's GSTIN, and
//      said (st.grown, the panel's note); other new columns are named as not read; never silent
//   2. SheetPost.toSales: a party with no GSTIN, or one that fails its check, is matched by its name
//   3. an invoice already here and still waiting takes the sheet's GSTIN and place of supply where it had none (or only
//      the one FinCom filled from Tally), and is mapped again; a posted one is never changed
const fs = require("fs"), path = require("path"), vm = require("vm");
const {load, HTML} = require("./harness");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const NAMES = ["num", "r2", "fpHash", "GST_STATES", "SALES_RATES", "stateOfGstin", "GSTIN_RE", "NORM_CACHE", "normNameRaw", "normName", "normInv", "money", "INR", "Market", "GST2B", "GSTAmend", "VR", "isSheetFile", "GST_CHARS", "gstinCheckChar", "gstinValid"];
const h = load(HTML, NAMES), C = h.ctx;
C.window = C;
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app", "src", "lib", "registers.js"), "utf8").replace(/^import .*$/gm, ""), C);
const F = C.SheetFmt, P = C.SheetPost, I = C.SheetImport;
// made-up GSTINs with a good check character (state, a made-up PAN, 1Z)
const G = (st, n) => { const b = st + "ZZQP" + "ABCDEFGH"[n] + String(4000 + n) + "K1Z"; return b + C.gstinCheckChar(b + "0"); };
const P1 = G("27", 0), P2 = G("07", 1), P3 = G("29", 2), P4 = G("33", 3), P5 = G("24", 4);
ok([P1, P2, P3, P4, P5].every(g => C.gstinValid(g)), "the made-up GSTINs pass their check (" + P1 + ")");
const BAD = P3.slice(0, 14) + (P3[14] === "A" ? "B" : "A");
ok(h.x.GSTIN_RE.test(BAD) && !C.gstinValid(BAD), "… and one with its check character changed fails it");

// ---- the client's saved format: the old layout, no GSTIN column (saved and checked by a person: v 2)
const oldHead = ["Date", "Customer Name", "Voucher Type", "Vch No.", "Sales Ledger", "HSN", "Taxable Amount", "IGST", "CGST", "SGST", "Invoice Amount", "", "", ""];
const saved = {id: "sfold1", name: "Made-up sales", side: "sales", scope: "client", v: 2, cols: oldHead.length, fp: F.fingerprint(oldHead, "Sheet1"), headers: oldHead.map(x => F.norm(x)),
  map: {date: "date", party: "customername", doctype: "vouchertype", no: "vchno", sledger: "salesledger", hsn: "hsn", taxable: "taxableamount", igst: "igst", cgst: "cgst", sgst: "sgst", total: "invoiceamount"},
  transforms: {date: "dmy", groupByNo: false}, at: "2026-11-14T06:00:00.000Z"};
// the client's own registrations (made up): its GSTIN and one in another state of the same PAN
const OWN = G("09", 5), OWN2 = (b => b + C.gstinCheckChar(b + "0"))("27" + OWN.slice(2, 14));
const co = {name: "ZZ Made Up Client", gstin: OWN, otherGstins: OWN2, sheetFormats: [saved]};
C.CO = () => co; C.S.firm = {sheetFormats: []}; C.S.coId = "c1";
const headWith = (col) => ["Date", "Customer Name", col, "Voucher Type", "Vch No.", "Sales Ledger", "HSN", "Taxable Amount", "IGST", "CGST", "SGST", "Invoice Amount", "", "", ""];

// ---- 1. the engine: the new column found by its name
const head = headWith("GSTIN");
const f = F.find(head, "Sheet1", "c1", "sales");
ok(f && f.how === "drift" && f.fmt.id === "sfold1", "the sheet with a GSTIN column added: the saved format still reads it (drift)");
ok(typeof F.grow === "function", "SheetFmt.grow: what a saved format makes of the columns it was not made with");
const grow = (hd, fmt, rs) => (typeof F.grow === "function" ? F.grow(fmt || saved, hd, rs || [], [OWN, OWN2]) : null);
const g1 = grow(head);
ok(g1 && g1.added && g1.added.gstin === "gstin" && g1.map.gstin === "gstin" && g1.map.no === "vchno" && !g1.other.length, "a new “GSTIN” column is read as the party's GSTIN; the saved columns kept (" + JSON.stringify(g1 && g1.added) + ")");
ok(!saved.map.gstin, "… the saved format itself is not changed");
["Customer GSTIN", "Party GSTIN", "GST No", "GSTIN/UIN", "GST No.", "GST Number", "Buyer GSTIN", "Recipient GSTIN"].forEach(n => {
  const g = grow(headWith(n));
  ok(g && g.added && g.added.gstin === F.norm(n), "“" + n + "” is the party's GSTIN too");
});
const gN = grow(headWith("Notes"));
ok(gN && !Object.keys(gN.added).length && gN.other.join() === "notes", "a new column it does not know (“Notes”): not read, and named so (" + JSON.stringify(gN && gN.other) + ")");
// (review of 2b565f7e7, 1: the names a side's party GSTIN goes by, never the other side's)
["Supplier GSTIN", "Vendor GSTIN", "Seller GSTIN"].forEach(n => {
  const g = grow(headWith(n));
  ok(g && !g.added.gstin && g.other.includes(F.norm(n)), "on a sales sheet “" + n + "” is not the customer's GSTIN: named as not read");
});
ok(F.own && F.own("c1").includes(OWN) && F.own("c1").includes(OWN2), "the client's own GSTINs: its GSTIN and its other GSTINs (" + (F.own ? F.own("c1").join(" ") : "") + ")");
const gB = grow(headWith("Our GSTIN"));
ok(gB && !gB.added.gstin, "“Our GSTIN” (the client's own) is never taken as the party's");
ok(grow(oldHead) === null, "the very layout it was saved with: nothing new");
const withG = Object.assign({}, saved, {headers: head.map(x => F.norm(x)), map: Object.assign({gstin: "gstin"}, saved.map)});
ok(grow(head, withG) === null, "a format that already reads the GSTIN: nothing new");
const leftOut = Object.assign({}, saved, {headers: head.map(x => F.norm(x))});
ok(grow(head, leftOut) === null, "a GSTIN column the person left unmapped when they saved the format stays unmapped");

// ---- 1. the panel: the sheet read with the GSTIN, and said
const rows = [
  ["01/11/2026", "Made Up Traders One Pvt Ltd", P1, "Sales UP", "MU/26/0001", "Sales Local 18%", "998313", 10000, 1800, " -   ", " -   ", 11800],
  ["01/11/2026", "Made Up Traders Two LLP", P2, "Sales UP", "MU/26/0002", "Sales Local 18%", "998313", 20000, 3600, " -   ", " -   ", 23600],
  ["02/11/2026", "Made Up Traders Three", P3, "Sales UP", "MU/26/0003", "Sales Local 18%", "998313", 30000, 5400, " -   ", " -   ", 35400],
  ["02/11/2026", "Made Up Traders Four", P4, "Sales UP", "MU/26/0004", "Sales Local 18%", "998313", 40000, 7200, " -   ", " -   ", 47200],
  ["03/11/2026", "Made Up Traders Five", P5, "Sales UP", "MU/26/0005", "Sales Local 18%", "998313", 50000, 9000, " -   ", " -   ", 59000]];
const csvOf = (hd, rs) => [hd.map(() => "").join(",")].concat([hd].concat(rs).map(r => r.map(c => '"' + String(c) + '"').join(","))).join("\n");
Object.assign(C, {render(){}, B: () => ({ledgers: {list: []}}), exactLedger: () => "", choiceValue: () => "", openDetail: undefined});
const start = async (hd, rs) => { await I.start([{name: "made-up-sales.csv", type: "text/csv", text: async () => csvOf(hd, rs)}], "sales"); return C.S.sheetImp; };
(async () => {
  let st = await start(head, rows);
  ok(st && st.step === "check" && st.how === "drift", "uploaded: read by the saved format with no AI (" + (st && st.step) + (st && st.err ? ": " + st.err : "") + ")");
  ok(st && st.docs && st.docs.length === 5 && st.docs.every(d => d.gstin && C.gstinValid(d.gstin)), "every invoice carries its GSTIN from the new column (" + (st && st.docs || []).map(d => d.gstin || "-").join(" ") + ")");
  ok(st && st.docs && st.docs.every(d => d.pos === d.gstin.slice(0, 2)), "… and its place of supply from it");
  ok(st && st.grown && st.grown.added && st.grown.added.some(a => a.field === "gstin" && a.col === "GSTIN"), "the panel is told what was added: “GSTIN” as the party's GSTIN (" + JSON.stringify(st && st.grown) + ")");
  ok(!saved.map.gstin && co.sheetFormats.length === 1, "the saved format is left as the person saved it");
  st = await start(headWith("Remarks"), rows.map(r => r.slice(0, 2).concat(["ok"], r.slice(3))));
  ok(st && st.step === "check" && st.grown && !st.grown.added.length && st.grown.other.join() === "Remarks", "a new column it does not know: read as before, and the panel names it as not read (" + JSON.stringify(st && st.grown) + ")");
  st = await start(oldHead.slice(0, 11), rows.map(r => r.slice(0, 2).concat(r.slice(3))));
  ok(st && st.step === "check" && !st.grown, "the old layout itself: no note");

  // ---- 2 and 3. uploaded again over the invoices already in Sales
  const docs = F.apply(Object.assign({}, saved, {map: Object.assign({gstin: "gstin"}, saved.map)}), [head].concat(rows), 0, co, "sales");
  ok(docs.length === 5 && docs.every(d => d.gstin), "the sheet read with its GSTIN column: 5 invoices with GSTINs");
  let mapped = [], nid = 0;
  const old = (d, extra) => Object.assign({id: "old-" + d.no, source: "sheet", status: "review", x: {number: d.no, date: d.date, customerName: d.party, customerGstin: "", pos: "", total: Math.abs(d.total), noteKind: ""},
    customerLedger: d.party, userLedger: true, custSource: "From the sheet"}, extra || {});
  const run = (list, ds) => {
    mapped = []; nid = 0;
    C.S.sales = {cid: "c1", list, cfg: {}}; C.SL = () => C.S.sales;
    Object.assign(C, {newInvoice: (x, source, extra) => Object.assign({id: "new" + (++nid), source, status: "review", x: Object.assign({customerGstin: "", pos: ""}, x), customerLedger: "", userLedger: false}, extra || {}),
      mapInvoice: v => mapped.push(v.id), saveSales(){}, salesPartyFill(){}, salesTotals: () => [{rate: 18}]});
    return P.toSales(ds || docs, "c1", "made-up-sales.csv");
  };
  const byNo = (list) => list.reduce((a, v) => { a[v.x.number] = (a[v.x.number] || 0) + 1; return a; }, {});
  // the invoices uploaded before with the old layout: no GSTIN, no place of supply
  let list = docs.map(d => old(d));
  list[1].status = "ready";
  list[2].x.customerGstin = BAD;   // one holding a GSTIN that fails its check
  list[3].status = "posted";
  const TF = G("27", 6); list[4].x.customerGstin = TF; list[4].filled = {ledger: list[4].customerLedger, customerGstin: TF, pos: "27"}; list[4].x.pos = "27";   // a good GSTIN FinCom filled from Tally
  let r = run(list);
  ok(r.added === 0 && r.again === 5 && list.length === 5 && Object.values(byNo(list)).every(n => n === 1), "no invoice added again: matched by name where the one here has no GSTIN, or one that fails its check (" + JSON.stringify(r) + ")");
  ok(list[0].x.customerGstin === P1 && list[0].x.pos === "27", "a waiting invoice with no GSTIN takes the sheet's, and its place of supply (" + list[0].x.customerGstin + " · " + list[0].x.pos + ")");
  ok(list[1].x.customerGstin === P2 && list[1].x.pos === "07" && list[1].status === "review", "a Ready one too, and goes back to To review to be looked at (" + list[1].status + ")");
  ok(list[2].x.customerGstin === BAD, "a GSTIN already on the invoice is never written over by the sheet (it may be a person's)");
  ok(list[3].x.customerGstin === "" && list[3].x.pos === "" && list[3].status === "posted" && !mapped.includes(list[3].id), "a posted invoice is never changed");
  ok(list[4].x.customerGstin === P5 && list[4].x.pos === "24" && !(list[4].filled && list[4].filled.customerGstin), "one FinCom filled from the Tally ledger takes the sheet's own GSTIN and place of supply (" + list[4].x.customerGstin + ")");
  ok([0, 1, 4].every(i => mapped.includes(list[i].id)), "each one changed is mapped again (" + mapped.join(" ") + ")");
  // a place of supply typed by hand stands; a valid other GSTIN is another party (a new invoice, as before)
  list = docs.map(d => old(d));
  list[0].x.pos = "29";
  list[1].x.customerGstin = G("08", 7);
  r = run(list);
  ok(list[0].x.customerGstin === P1 && list[0].x.pos === "29", "a place of supply already on the invoice stands (" + list[0].x.pos + ")");
  ok(r.added === 1 && r.again === 4 && byNo(list)[docs[1].no] === 2, "an invoice of that number for another valid GSTIN is another party's: added, as before (" + JSON.stringify(r) + ")");
  // the old behaviour kept: two valid GSTINs the same, a different name, still the same party
  list = docs.map(d => old(d, {x: {number: d.no, date: d.date, customerName: d.party + " (old name)", customerGstin: d.gstin, pos: d.pos, total: Math.abs(d.total), noteKind: ""}}));
  r = run(list);
  ok(r.added === 0 && r.again === 5, "a valid GSTIN on both: matched by the GSTIN, whatever the name (" + JSON.stringify(r) + ")");
  // a different name and no GSTIN here: a different party
  list = docs.map(d => old(d, {x: {number: d.no, date: d.date, customerName: "Someone Else Made Up", customerGstin: "", pos: "", total: Math.abs(d.total), noteKind: ""}}));
  r = run(list);
  ok(r.added === 5 && r.again === 0, "no GSTIN here and another name: another party's invoice (" + JSON.stringify(r) + ")");

  // ---- review of 2b565f7e7
  // 1. the client's own GSTIN is never the party's: a column of it is not read, and no invoice takes it
  const rowsOwn = rows.map((r, i) => r.slice(0, 2).concat([i === 4 ? P5 : i % 2 ? OWN2 : OWN], r.slice(3)));
  const gO = grow(head, saved, rowsOwn);
  ok(gO && !gO.added.gstin && gO.other.includes("gstin"), "a sales sheet's new “GSTIN” column holding the client's own GSTINs: not read as the party's (" + JSON.stringify(gO) + ")");
  st = await start(head, rowsOwn);
  ok(st && st.step === "check" && st.grown && !st.grown.added.length && st.grown.other.includes("GSTIN") && st.docs.every(d => !d.gstin), "… uploaded: the panel names it as not read, and no invoice carries it (" + JSON.stringify(st && st.grown) + ")");
  const pOld = ["Bill Date", "Bill No", "Supplier", "Taxable", "IGST", "Total"], pFmt = {id: "sfp1", side: "purchase", v: 2, cols: 6, headers: pOld.map(x => F.norm(x)),
    map: {date: "billdate", no: "billno", party: "supplier", taxable: "taxable", igst: "igst", total: "total"}};
  const pRows = (g) => [0, 1, 2].map(i => ["01/11/2026", "B/" + i, "Made Up Supplier " + i, g(i), 1000, 180, 1180]);
  const pHead = (n) => ["Bill Date", "Bill No", "Supplier", n, "Taxable", "IGST", "Total"];
  let gp = grow(pHead("Buyer GSTIN"), pFmt, pRows(() => OWN));
  ok(gp && !gp.added.gstin && gp.other.includes("buyergstin"), "a purchase register's new “Buyer GSTIN” (the client's own): not read as the supplier's (" + JSON.stringify(gp) + ")");
  gp = grow(pHead("GSTIN"), pFmt, pRows(() => OWN));
  ok(gp && !gp.added.gstin && gp.other.includes("gstin"), "… nor a “GSTIN” column whose values are the client's own");
  gp = grow(pHead("Supplier GSTIN"), pFmt, pRows(i => [P1, P2, P3][i]));
  ok(gp && gp.added.gstin === "suppliergstin", "a purchase register's new “Supplier GSTIN” of the suppliers' GSTINs is read");
  gp = grow(pHead("Customer GSTIN"), pFmt, pRows(i => [P1, P2, P3][i]));
  ok(gp && !gp.added.gstin, "… and “Customer GSTIN” is no supplier's on a purchase register");
  const dOwn = docs.map((d, i) => Object.assign({}, d, i === 0 ? {gstin: OWN, pos: "09"} : i === 1 ? {gstin: BAD, pos: BAD.slice(0, 2)} : {}));
  list = docs.map(d => old(d));
  r = run(list, dOwn);
  ok(r.again === 5 && list[0].x.customerGstin === "" && list[1].x.customerGstin === "", "an invoice here never takes the client's own GSTIN, nor one that fails its check (" + JSON.stringify([list[0].x.customerGstin, list[1].x.customerGstin]) + ")");
  list = [];
  r = run(list, dOwn.slice(0, 1));
  ok(r.added === 1 && list[0].x.customerGstin === "", "a new invoice never takes the client's own GSTIN as the customer's (" + list[0].x.customerGstin + ")");
  // 2. an invoice queued for posting is never touched
  list = docs.map(d => old(d));
  list[0].status = "ready"; list[0].postJob = "job-made-up-1";
  r = run(list);
  ok(list[0].x.customerGstin === "" && list[0].status === "ready" && !mapped.includes(list[0].id) && list[1].x.customerGstin === P2, "an invoice queued for posting is not changed, the others are");
  // 4. a GSTIN FinCom filled from Tally is matched by name, and the sheet's good one replaces it (above: list[4]); 5. only
  // an uploaded invoice, and never a GSTIN a person cleared
  list = docs.map(d => old(d));
  list[0].source = "created";
  list[1].sheetHad = {gstin: true, pos: true};
  r = run(list);
  ok(r.again === 5 && list[0].x.customerGstin === "" && list[1].x.customerGstin === "" && list[2].x.customerGstin === P3, "an invoice made in FinCom, or one whose sheet GSTIN a person cleared, is not filled (" + JSON.stringify([list[0].x.customerGstin, list[1].x.customerGstin]) + ")");
  // 6. two blank names are no match
  ok(P.sameParty("", "", "", "") === false && P.sameParty("", "Made Up A", BAD, "made up a") === true, "two blank names are not the same party; the same name is");
  // 7. a held invoice put right takes the GSTIN too
  list = [old(docs[0], {hold: "Negative amount: is this a return?"})];
  r = run(list, docs.slice(0, 1));
  ok(r.fixed === 1 && list[0].x.customerGstin === P1 && list[0].x.pos === "27", "a held invoice put right takes the sheet's GSTIN and place of supply (" + JSON.stringify(r) + ")");
  // 1. toBills: the client's own GSTIN never becomes the supplier's
  const bills = [];
  Object.assign(C, {D: () => ({entries: {}}), newEntry: () => ({id: "e" + bills.length, x: {}}), finishNewEntry: e => { e.status = "draft"; bills.push(e); }, Store: {saveEntry(){}}});
  P.toBills([Object.assign({}, docs[2], {gstin: OWN}), docs[3]], "c1", "made-up-purchase.csv");
  ok(bills.length === 2 && bills[0].x.vendorGstin === "" && bills[0].x.vendorPan === "" && bills[1].x.vendorGstin === P4, "a bill never takes the client's own GSTIN as the supplier's (" + bills.map(b => b.x.vendorGstin || "-").join(" ") + ")");

  // ---- second review of a61ffbb12
  // a supply between the client's own registrations keeps the other registration's GSTIN and place of supply: only the
  // issuing one (the sheet's "Our GSTIN", else the client's GSTIN) is never the customer's
  const ofDoc = (i, more) => Object.assign({}, docs[i], more);
  list = [];
  r = run(list, [ofDoc(0, {own: OWN, gstin: OWN2, pos: "27"}), ofDoc(1, {own: OWN2, gstin: OWN, pos: "09"}), ofDoc(2, {gstin: OWN2, pos: "27"}), ofDoc(3, {gstin: OWN, pos: "09", posFromGstin: true})]);
  ok(r.added === 4 && list[0].x.customerGstin === OWN2 && list[0].x.pos === "27" && list[1].x.customerGstin === OWN && list[1].x.pos === "09" && list[2].x.customerGstin === OWN2,
    "from one registration to the client's other: the other's GSTIN and place of supply kept (" + list.map(v => (v.x.customerGstin || "-") + "/" + (v.x.pos || "-")).join(" ") + ")");
  ok(list[3].x.customerGstin === "" && list[3].x.pos === "", "the issuing registration itself (the client's GSTIN) as the customer: blanked, with the place of supply it gave");
  list = docs.map(d => old(d));
  r = run(list, [ofDoc(0, {gstin: OWN2, pos: "27"})].concat(docs.slice(1)));
  ok(list[0].x.customerGstin === OWN2, "an invoice here takes the client's other registration's GSTIN from the sheet (" + list[0].x.customerGstin + ")");
  // a place of supply the sheet gave stands; only one worked out from the blanked GSTIN goes
  const fG = F.finish({no: "X1", gstin: OWN, pos: "", taxable: 100, igst: 0, cgst: 9, sgst: 9, cess: 0, total: 118, rates: []});
  const fP = F.finish({no: "X2", gstin: OWN, pos: "29", taxable: 100, igst: 18, cgst: 0, sgst: 0, cess: 0, total: 118, rates: []});
  ok(fG.pos === "09" && fP.pos === "29", "the place of supply: worked out from the GSTIN, or the sheet's own");
  const nG = P.notOwn(fG, OWN), nP = P.notOwn(fP, OWN);
  ok(nG.gstin === "" && nG.pos === "" && nP.gstin === "" && nP.pos === "29", "the own GSTIN blanked: its worked-out place of supply with it, the sheet's own kept (" + JSON.stringify([nG.pos, nP.pos]) + ")");
  ok(P.notOwn(fG, OWN2) === fG, "a GSTIN not the issuing registration's is left as it is");
  // the panel: its documents and questions never show the issuing registration as the party
  const fmtG = Object.assign({}, saved, {id: "sfg1", headers: head.map(x => F.norm(x)), cols: head.length, map: Object.assign({gstin: "gstin"}, saved.map)});
  co.sheetFormats = [fmtG];
  st = await start(head, rowsOwn);
  const qText = JSON.stringify((st && st.questions) || []);
  ok(st && st.step === "check" && st.docs.filter(d => d.gstin === OWN).length === 0 && st.docs.filter(d => d.gstin === OWN2).length === 2 && !qText.includes(OWN),
    "the panel: the issuing registration is never a document's party nor in its questions; the other registration is (" + (st && st.docs || []).map(d => d.gstin || "-").join(" ") + ")");
  ok(st && Array.isArray(st.docs.skipped), "… the list still says which rows it left out");
  co.sheetFormats = [saved];
  // toBills: a held bill saved before with the client's own GSTIN as the supplier's still matches its row, put right in place
  const heldBill = {id: "hb1", hold: "Negative amount: is this a return?", status: "draft", x: {invoiceNo: docs[2].no, invoiceDate: docs[2].date, vendorName: docs[2].party, vendorGstin: OWN, vendorPan: OWN.slice(2, 12), total: -Math.abs(docs[2].total)}};
  bills.length = 0;
  Object.assign(C, {D: () => ({entries: {hb1: heldBill}})});
  const rb = P.toBills([Object.assign({}, docs[2], {gstin: OWN})], "c1", "made-up-purchase.csv");
  ok(rb.fixed === 1 && rb.added === 0 && bills.length === 0 && !heldBill.hold && heldBill.x.vendorGstin === "", "a held bill saved with the client's own GSTIN as the supplier's is put right, not added again (" + JSON.stringify(rb) + ")");

  console.log(fails ? "\n" + fails + " FAILED" : "\nALL OK");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
