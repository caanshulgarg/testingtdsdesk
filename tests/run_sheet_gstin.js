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
const co = {name: "ZZ Made Up Client", gstin: "09AANFG3202D1ZR", sheetFormats: [saved]};
C.CO = () => co; C.S.firm = {sheetFormats: []}; C.S.coId = "c1";
const headWith = (col) => ["Date", "Customer Name", col, "Voucher Type", "Vch No.", "Sales Ledger", "HSN", "Taxable Amount", "IGST", "CGST", "SGST", "Invoice Amount", "", "", ""];

// ---- 1. the engine: the new column found by its name
const head = headWith("GSTIN");
const f = F.find(head, "Sheet1", "c1", "sales");
ok(f && f.how === "drift" && f.fmt.id === "sfold1", "the sheet with a GSTIN column added: the saved format still reads it (drift)");
ok(typeof F.grow === "function", "SheetFmt.grow: what a saved format makes of the columns it was not made with");
const grow = (hd, fmt) => (typeof F.grow === "function" ? F.grow(fmt || saved, hd) : null);
const g1 = grow(head);
ok(g1 && g1.added && g1.added.gstin === "gstin" && g1.map.gstin === "gstin" && g1.map.no === "vchno" && !g1.other.length, "a new “GSTIN” column is read as the party's GSTIN; the saved columns kept (" + JSON.stringify(g1 && g1.added) + ")");
ok(!saved.map.gstin, "… the saved format itself is not changed");
["Customer GSTIN", "Party GSTIN", "GST No", "GSTIN/UIN", "GST No.", "Customer GSTIN/UIN"].forEach(n => {
  const g = grow(headWith(n));
  ok(g && g.added && g.added.gstin === F.norm(n), "“" + n + "” is the party's GSTIN too");
});
const gN = grow(headWith("Notes"));
ok(gN && !Object.keys(gN.added).length && gN.other.join() === "notes", "a new column it does not know (“Notes”): not read, and named so (" + JSON.stringify(gN && gN.other) + ")");
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
  const run = (list) => {
    mapped = []; nid = 0;
    C.S.sales = {cid: "c1", list, cfg: {}}; C.SL = () => C.S.sales;
    Object.assign(C, {newInvoice: (x, source, extra) => Object.assign({id: "new" + (++nid), source, status: "review", x: Object.assign({customerGstin: "", pos: ""}, x), customerLedger: "", userLedger: false}, extra || {}),
      mapInvoice: v => mapped.push(v.id), saveSales(){}, salesPartyFill(){}, salesTotals: () => [{rate: 18}]});
    return P.toSales(docs, "c1", "made-up-sales.csv");
  };
  const byNo = (list) => list.reduce((a, v) => { a[v.x.number] = (a[v.x.number] || 0) + 1; return a; }, {});
  // the invoices uploaded before with the old layout: no GSTIN, no place of supply
  let list = docs.map(d => old(d));
  list[1].status = "ready";
  list[2].x.customerGstin = BAD;   // one holding a GSTIN that fails its check
  list[3].status = "posted";
  list[4].x.customerGstin = "27ZZQPZ9999Z1Z5"; list[4].filled = {ledger: list[4].customerLedger, customerGstin: "27ZZQPZ9999Z1Z5", pos: "27"}; list[4].x.pos = "27";   // filled by FinCom from Tally
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

  console.log(fails ? "\n" + fails + " FAILED" : "\nALL OK");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
