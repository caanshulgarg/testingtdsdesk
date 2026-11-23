// node run_audit_imports.js - next-fix-audit-imports: the Excel / CSV uploads, on made-up data only, with no browser.
// Each check is one finding of the imports audit (excel-uploads, purchase, sales): the sheet engine
// (app/src/lib/registers.js), the marketplace reports, the dates every reader shares (Market.date), an HTML table called
// .xls, a sheet stretched to a million rows, 24Q salary sheets, challans, last year's balance sheet, party statements,
// GSTR-2B Excel (two-row header, credit notes, reverse charge, ITC not available), the ledger list, bank amounts, the
// filed GSTR-1 dates, AOC-4 heads, the TDS correction Excel and the PAN book Excel.
// IMPORTS_ROOT runs it on another checkout's registers.js and app files (with TDSDESK_HTML its built page): the base,
// to see each check fail before the fix.
const fs = require("fs"), path = require("path"), vm = require("vm");
const {load, HTML} = require("./harness");
const ROOT = process.env.IMPORTS_ROOT || path.join(__dirname, "..");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const tryOk = (f, w) => { let v = false; try { v = f(); } catch (e){ console.log("       (" + String(e && e.message || e).slice(0, 160) + ")"); } ok(v, w); };
const PAGE = fs.readFileSync(HTML, "utf8"), has = n => new RegExp("\\n(?:const|let|(?:async )?function) " + n.replace(/\$/g, "\\$") + "\\b").test(PAGE);
const want = ["num", "r2", "money", "INR", "fpHash", "GST_STATES", "SALES_RATES", "stateOfGstin", "GSTIN_RE", "NORM_CACHE", "normNameRaw", "normName", "normInv", "normInvNo",
  "MONTHS", "toIsoDate", "Market", "GST2B", "GSTAmend", "VR", "isSheetFile", "GST_CHARS", "gstinCheckChar", "gstinValid", "cellText", "bankAmount", "bankDate", "rowsFromCells",
  "xlsxBook", "xlsxRows", "gridsFromSheet", "TDSCH", "TDS24Q", "FinPyBs", "GSTX", "RCM_CATS", "BLOCK_CATS", "gstText", "suggestRcm", "billCodes", "blockRule", "suggestBlock", "gstDecision", "rcmTaxOf",
  "catLabel", "TALLY_GROUPS", "importLedgerList", "TDSPanFix", "STATE_CODES", "GSTR",
  // (next-fix-audit-all: the purchase-tds track's rcmTaxOf takes the client's state from itcCheck, the bill's registration)
  "itcCheck", "ownGstins", "salesPan", "salesGstinOfPan"].filter(has);
const h = load(HTML, want), C = h.ctx;
// (a const of the page is not a property of its context: put on it, so the checks below reach it by C.name)
Object.keys(h.x).forEach(k => { if (!(k in C)) C[k] = h.x[k]; });
C.window = C; C.ensureXlsx = async () => {};
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "assets", "xlsx.js"), "utf8"), C);
vm.runInContext(fs.readFileSync(path.join(ROOT, "app", "src", "lib", "registers.js"), "utf8").replace(/^import .*$/gm, ""), C);
const F = C.SheetFmt;
const CO = {name: "ZZ Test Client", gstin: "09AAAAA0000A1Z5"};
C.CO = () => CO;
const by = (docs, no) => docs.filter(d => d.no === no);
// a File as the readers use it
const file = (name, data) => { const u = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  return {name, type: "", size: u.length, arrayBuffer: async () => u.buffer.slice(u.byteOffset, u.byteOffset + u.length), text: async () => new TextDecoder().decode(u), slice: (a, b) => file(name, u.slice(a, b))}; };

(async () => {
  console.log("1. a purchase sheet / 2B: two suppliers' bill \"1\" are two bills (purchase confirmed 0, excel-uploads confirmed 0)");
  const g1 = [["Supplier", "GSTIN", "Bill No", "Date", "Taxable", "IGST", "CGST", "SGST", "Total"],
    ["Alpha Traders", "09BBBBB1111B1Z5", "1", "05/09/2026", 1000, 0, 90, 90, 1180],
    ["Beta Steel", "27CCCCC2222C1Z5", "1", "06/09/2026", 5000, 900, 0, 0, 5900],
    ["Alpha Traders", "09BBBBB1111B1Z5", "2", "07/09/2026", 100, 0, 9, 9, 118], ["", "", "2", "", 200, 0, 18, 18, 236]];
  const fm1 = {map: {party: "supplier", gstin: "gstin", no: "billno", date: "date", taxable: "taxable", igst: "igst", cgst: "cgst", sgst: "sgst", total: "total"}, transforms: {date: "dmy", groupByNo: true}};
  tryOk(() => { const d = F.apply(fm1, g1, 0, CO, "purchase"), one = by(d, "1");
    return one.length === 2 && one.some(x => x.gstin === "09BBBBB1111B1Z5" && x.total === 1180 && x.igst === 0) && one.some(x => x.gstin === "27CCCCC2222C1Z5" && x.total === 5900 && x.cgst === 0)
      && by(d, "2").length === 1 && by(d, "2")[0].total === 354; }, "two suppliers' bill 1: two bills, each its own party and figures; a line with no party is its bill's line (bill 2: 354)");
  tryOk(() => { const g = [["Customer", "GSTIN", "Invoice No", "Date", "Taxable", "IGST", "CGST", "SGST", "Total"], ["P One", "09BBBBB1111B1Z5", "S-9", "05/09/2026", 1000, 0, 90, 90, 1180], ["Q Two", "27CCCCC2222C1Z5", "S-9", "05/09/2026", 500, 90, 0, 0, 590]];
    const d = F.apply(fm1.map && {map: Object.assign({}, fm1.map, {party: "customer", no: "invoiceno"}), transforms: fm1.transforms}, g, 0, CO, "sales");
    return d.length === 1 && /different parties/.test(d[0].hold || ""); }, "a sales invoice whose rows name two parties is held for a person, never one party's invoice silently");

  console.log("2. dates with a two-digit year are day first (purchase confirmed 1, excel-uploads confirmed 2)");
  tryOk(() => C.Market.date("05/09/26") === "2026-09-05" && C.Market.date("05.09.26") === "2026-09-05" && C.Market.date("05-09-26") === "2026-09-05" && C.Market.date("12/03/26") === "2026-03-12"
    && C.Market.date("13/09/26") === "2026-09-13" && C.Market.date("5-4-26") === "2026-04-05", "05/09/26 is 5 September, 12/03/26 is 12 March (never month first)");
  tryOk(() => C.Market.date("31/02/2026") === "" && C.Market.date("09/14/2026") === "" && C.Market.date("5-Sept-2026") === "2026-09-05" && C.Market.date("Sep 5, 2026") === "2026-09-05", "a day not in its month is no date; month names read");
  tryOk(() => F.date("05/04/26", "dmy") === "2026-04-05" && F.date("12/03/26") === "2026-03-12", "a register's dates (SheetFmt.date, dmy) the same");

  console.log("3. a format saved as month / day / year (excel-uploads confirmed 3)");
  tryOk(() => F.date(new Date(2026, 8, 5), "mdy") === "2026-09-05" && F.date("09/05/26", "mdy") === "2026-09-05" && F.date("13/09/26", "mdy") === "", "a real date cell is its own day; 13/09/26 as m/d/y is no date (was 2026-13-09)");
  tryOk(() => { const g = [["Invoice No", "Date", "Party", "Total"], ["A1", "13/09/26", "X", 100]]; const d = F.apply({map: {no: "invoiceno", date: "date", party: "party", total: "total"}, transforms: {date: "mdy"}}, g, 0, CO, "sales");
    return d.length === 1 && /not a date/.test(d[0].hold || ""); }, "… and that row is held, its date to check");

  console.log("4. the GST sales register (generic): amounts never from a rate's column, a total row is no invoice (excel-uploads confirmed 4)");
  const gg = [["Invoice Number", "Invoice Date", "Customer Name", "GSTIN", "Taxable Value", "CGST Rate", "CGST Amount", "SGST Rate", "SGST Amount", "Total Tax", "Invoice Amount"],
    ["S-1", "05/09/2026", "P One", "09BBBBB1111B1Z5", 1000, 9, 90, 9, 90, 180, 1180], ["S-2", "06/09/2026", "P Two", "09BBBBB1111B1Z5", 2000, 9, 180, 9, 180, 360, 2360], ["Total", "", "", "", 3000, "", 270, "", 270, 540, 3540]];
  tryOk(() => { const b = F.builtin(gg[0], "sales"), d = F.apply(b, gg, 0, CO, "sales"), s1 = by(d, "S-1")[0];
    return b && b.builtin === "generic" && d.length === 2 && s1.cgst === 90 && s1.sgst === 90 && s1.total === 1180 && s1.check.ok; }, "S-1: CGST 90, SGST 90, total 1,180; the Total row left out");

  console.log("5. Shopify: an order's figures once, its tax by name, its status asked about (excel-uploads confirmed 5, sales confirmed 4)");
  const sh = [["Name", "Financial Status", "Subtotal", "Taxes", "Total", "Created at", "Lineitem quantity", "Lineitem name", "Lineitem price", "Billing Name", "Shipping Province", "Tax 1 Name", "Tax 1 Value", "Tax 2 Name", "Tax 2 Value"],
    ["#1001", "paid", 2500, 450, 2950, "2026-09-05 10:00:00 +0530", 3, "Shirt", 500, "R One", "KA", "IGST 18%", 450, "", ""], ["#1001", "", "", "", "", "2026-09-05 10:00:00 +0530", 2, "Cap", 500, "R One", "KA", "", "", "", ""],
    ["#1002", "partially_refunded", 2000, 360, 2360, "2026-09-06 10:00:00 +0530", 1, "Bag", 2000, "R Two", "MH", "CGST 9%", 180, "SGST 9%", 180],
    ["#1003", "voided", 1000, 180, 1180, "2026-09-07 10:00:00 +0530", 1, "Hat", 1000, "R Three", "UP", "IGST 18%", 180, "", ""]];
  tryOk(() => { const b = F.builtin(sh[0], "sales"), d = F.apply(b, sh, 0, CO, "sales"), o1 = by(d, "#1001")[0], o2 = by(d, "#1002")[0], o3 = by(d, "#1003")[0];
    return b.builtin === "shopify" && o1.taxable === 2500 && o1.igst === 450 && o1.cgst === 0 && o1.total === 2950 && !o1.hold && o1.pos === "29"
      && o2 && !o2.note && o2.cgst === 180 && o2.sgst === 180 && o2.pos === "27" && /refund/.test(o2.hold) && /voided/.test(o3.hold || ""); },
    "#1001 taxable 2,500 + IGST 450 = 2,950 (KA is 29); #1002 a sale, its refund asked about; #1003 voided, asked about");

  console.log("6. marketplace lines keep their own sign (excel-uploads confirmed 6)");
  const az = [["Invoice Number", "Invoice Date", "Transaction Type", "Order Id", "Ship To State", "Ship From State", "Invoice Amount", "Tax Exclusive Gross", "Igst Tax", "Hsn/sac"],
    ["AMZ-1", "05/09/2026", "Shipment", "O-1", "KARNATAKA", "UTTAR PRADESH", 1180, 1000, 180, "6109"], ["AMZ-1", "05/09/2026", "Shipment", "O-1", "KARNATAKA", "UTTAR PRADESH", -118, -100, -18, "6109"],
    ["AMZ-2", "06/09/2026", "Shipment", "O-2", "", "UTTAR PRADESH", 590, 500, 90, "6109"]];
  tryOk(() => { const d = F.apply(F.builtin(az[0], "sales"), az, 0, CO, "sales"), a = by(d, "AMZ-1")[0]; return a.taxable === 900 && a.igst === 162 && a.total === 1062; }, "a shipment and a negative adjustment: 900 + 162 = 1,062 (was 1,298)");

  console.log("7. Flipkart's Return Cancellation undoes the return (sales confirmed 3)");
  const fk = [["Order ID", "Order Item ID", "Event Type", "Buyer Invoice ID", "Buyer Invoice Date", "Taxable Value", "IGST Amount", "Final Invoice Amount", "Customer's Delivery State"],
    ["OD1", "I1", "Sale", "FK-001", "05/09/2026", 1000, 180, 1180, "Karnataka"], ["OD1", "I1", "Return", "FK-001", "05/09/2026", -1000, -180, -1180, "Karnataka"],
    ["OD1", "I1", "Return Cancellation", "FK-001", "05/09/2026", 1000, 180, 1180, "Karnataka"]];
  tryOk(() => { const d = F.apply(F.builtin(fk[0], "sales"), fk, 0, CO, "sales"); return d.length === 1 && d[0].no === "FK-001" && !d[0].note && d[0].total === 1180 && d[0].pos === "29"; },
    "a sale of 1,180 and no credit note (was a credit note of 2,360)");

  console.log("8. the place of supply of a marketplace order (sales confirmed 5)");
  tryOk(() => { const d = F.apply(F.builtin(az[0], "sales"), az, 0, CO, "sales"); return by(d, "AMZ-1")[0].pos === "29" && by(d, "AMZ-2")[0].pos === ""; }, "Ship To State Karnataka is 29; Ship From State (the seller's) is never the place of supply");
  tryOk(() => { const t = fs.readFileSync(path.join(ROOT, "src", "js", "27-firm-account.js"), "utf8"); return /id === "marketIn"[^\n]*sheetStart\(\[f\], "sales"\)/.test(t) && !/function importMarketFile/.test(fs.readFileSync(path.join(ROOT, "src", "js", "26-sales-from-a-marketplace.js"), "utf8")); },
    "the Marketplace report button goes through the sheet panel (its own reader, which dropped the place of supply, is retired)");

  console.log("9. a marketplace report brought in again adds nothing; a later return of the same invoice is kept (sales confirmed 6) - and it is quick (sales confirmed 8)");
  const list = [];
  const sales = () => ({list, cfg: {}});
  Object.assign(C, {SL: sales, newInvoice: (x, src, meta) => ({id: "v" + list.length + "_" + Math.random().toString(36).slice(2, 6), x: Object.assign({}, x), source: src, status: "review", meta}),
    mapInvoice(){}, saveSales(){}, salesTotals: x => [{rate: x.rate || 0}], exactLedger: () => "", B: () => null});
  const cn = [["Invoice Number", "Invoice Date", "Transaction Type", "Order Id", "Ship To State", "Invoice Amount", "Tax Exclusive Gross", "Igst Tax", "Credit Note No", "Credit Note Date"],
    ["AMZ-7", "05/09/2026", "Refund", "O-7", "KARNATAKA", -590, -500, -90, "CN-0042", "20/09/2026"]];
  tryOk(() => { const d1 = F.apply(F.builtin(cn[0], "sales"), cn, 0, CO, "sales"); const r1 = C.SheetPost.toSales(d1, "c1", "a.csv");
    const d2 = F.apply(F.builtin(cn[0], "sales"), cn, 0, CO, "sales"); const r2_ = C.SheetPost.toSales(d2, "c1", "a.csv");
    return r1.added === 1 && r2_.added === 0 && r2_.again === 1 && list.filter(v => v.x.number === "CN-0042").length === 1; }, "credit note CN-0042 uploaded twice: once");
  const fkr = d => [["Order ID", "Order Item ID", "Event Type", "Buyer Invoice ID", "Buyer Invoice Date", "Return Date", "Taxable Value", "IGST Amount", "Final Invoice Amount", "Customer's Delivery State"],
    ["OD2", "I2", "Return", "FK-009", "05/09/2026", d, -100, -18, -118, "Karnataka"]];
  tryOk(() => { const a = C.SheetPost.toSales(F.apply(F.builtin(fkr("10/10/2026")[0], "sales"), fkr("10/10/2026"), 0, CO, "sales"), "c1", "oct.csv");
    const b = C.SheetPost.toSales(F.apply(F.builtin(fkr("10/11/2026")[0], "sales"), fkr("10/11/2026"), 0, CO, "sales"), "c1", "nov.csv");
    return a.added === 1 && b.added === 1 && list.filter(v => /^FK-009/.test(v.x.number)).length === 2; }, "a return in October and another in November against FK-009: both kept");
  tryOk(() => { list.length = 0; for (let i = 0; i < 20000; i++) list.push({id: "k" + i, x: {number: "OLD/" + i, date: "2026-04-01", total: 100, customerName: "X"}, status: "posted", source: "sheet"});
    const g = [["Invoice Number", "Invoice Date", "Transaction Type", "Order Id", "Ship To State", "Invoice Amount", "Tax Exclusive Gross", "Igst Tax"]];
    for (let i = 0; i < 2000; i++) g.push(["NEW-" + i, "05/09/2026", "Shipment", "O" + i, "KARNATAKA", 118, 100, 18]);
    const t0 = Date.now(), d = F.apply(F.builtin(g[0], "sales"), g, 0, CO, "sales"), r = C.SheetPost.toSales(d, "c1", "big.csv"), ms = Date.now() - t0;
    console.log("       (2,000 invoices against 20,000 kept: " + ms + " ms)"); return r.added === 2000 && ms < 3000; }, "2,000 invoices against 20,000 kept, in seconds, not minutes");

  console.log("10. an HTML table called .xls, and a sheet stretched to a million rows (excel-uploads confirmed 1, 14, 17)");
  const html = "<html><body><table><tr><td>Invoice No</td><td>Date</td><td>Party</td><td>Total</td></tr><tr><td>00123</td><td>05/09/26</td><td>P One</td><td>1180</td></tr><tr><td>1E5</td><td>13/09/26</td><td>P Two</td><td>590</td></tr><tr><td>7</td><td>01/10/2026</td><td>P Three</td><td>100</td></tr></table></body></html>";
  tryOk(() => { const wb = C.xlsxBook(new TextEncoder().encode(html).buffer, {cellDates: true}), rows = C.xlsxRows(wb.Sheets[wb.SheetNames[0]]);
    return rows[1][0] === "00123" && rows[2][0] === "1E5" && C.Market.date(rows[1][1]) === "2026-09-05" && C.Market.date(rows[3][1]) === "2026-10-01"; }, "invoice 00123 and 1E5 kept as written; 05/09/26 is 5 September, 01/10/2026 is 1 October");
  const gr = await C.gridsFromSheet(file("stmt.xls", html)).catch(e => { console.log("       (" + e + ")"); return null; });
  tryOk(() => gr && gr[0][1][1] === "05/09/26" && C.bankDate(gr[0][1][1]) === "2026-09-05", "a bank statement .xls that is HTML: its dates as written (was 2026-05-08)");
  const rf = await F.read(file("reg.xls", html)).catch(e => { console.log("       (" + e + ")"); return null; });
  tryOk(() => rf && rf.grid[1][0] === "00123" && rf.grid[2][0] === "1E5", "a register .xls that is HTML: invoice numbers kept");
  tryOk(() => { const X = C.XLSX, ws = X.utils.aoa_to_sheet([["Invoice No", "Total"], ["A1", 100], ["A2", 200]]); ws["!ref"] = "A1:T300000"; ws.T300000 = {t: "z"};
    const t0 = Date.now(), rows = C.xlsxRows(ws), ms = Date.now() - t0; return rows.length === 3 && ms < 500; }, "a sheet whose range a formatted cell stretches to row 300,000: its 3 rows");
  tryOk(() => { const X = C.XLSX, ws = X.utils.aoa_to_sheet([["Invoice No", "Total"], [123, 100]]); ws.A2.z = "00000"; ws.A2.w = "00123";
    return C.xlsxRows(ws, {}, true)[1][0] === "00123"; }, "an .xlsx number shown with leading zeros (00123) read as that text");

  console.log("11. 24Q salary sheets (excel-uploads confirmed 7, 8, 9)");
  const csv24 = 'Employee Name,PAN,Company,Date of Birth,Month,Gross Salary,TDS\n"Sharma, Ravi",ABCDE1234F,Acme,12/03/1985,Apr-2026,"1,00,000",10000\nGrand Total,,,,,"1,00,000",10000\n';
  const r24 = await C.TDS24Q.fromFile(file("salary.csv", csv24)).catch(e => ({error: String(e)}));
  tryOk(() => r24.rows && r24.rows.length === 1 && r24.rows[0].name === "Sharma, Ravi" && r24.rows[0].pan === "ABCDE1234F" && r24.rows[0].gross === 100000 && r24.rows[0].tds === 10000 && r24.rows[0].date === "2026-04-30",
    "a quoted name and an Indian-format amount kept whole; Grand Total is no employee; the Month, not the date of birth (" + JSON.stringify(r24.rows || r24) + ")");
  const csvB = "Emp Code,Employee Name,Company,PAN No.,Date of Joining,Month,Gross Salary,TDS\nE1,Ravi,ACMEPVT,ABCDE1234F,01/06/2019,04/2026,100000,10000\n";
  const rB = await C.TDS24Q.fromFile(file("s2.csv", csvB)).catch(e => ({error: String(e)}));
  tryOk(() => rB.rows && rB.rows[0].pan === "ABCDE1234F" && rB.rows[0].date === "2026-04-30", "'Company' is not the PAN, 'Date of Joining' not the payment date; month 04/2026 read");
  tryOk(() => C.TDS24Q.monthDate("4") === "" && C.TDS24Q.monthDate("2026-05") === "2026-05-31" && C.TDS24Q.monthDate("04/2026") === "2026-04-30", "a month with no year is no date (was 2001-04-01)");

  console.log("12. challans (excel-uploads confirmed 10)");
  tryOk(() => { const c = C.TDSCH.make({bsr: 510308, serial: 12, date: new Date(2026, 3, 5), tax: 1000}); return c && c.bsr === "0510308" && c.date === "20260405" && c.serial === "00012"; }, "BSR 0510308 saved as a number and a deposit date as a date cell: the challan read");

  console.log("13. last year's balance sheet with its year headings as Excel dates (excel-uploads confirmed 11)");
  tryOk(() => { const r = C.FinPyBs.fromRows([{name: "Balance Sheet", rows: [["Particulars", "Note", new Date(2026, 2, 31), new Date(2025, 2, 31)], ["Share capital", 1, 100000, 100000], ["Reserves", 2, 50000, -25000]]}]);
    return r.cols && r.cols.cy === 2 && r.cols.py === 3 && r.cols.note === 1 && r.lines.some(z => /share capital/i.test(z.label) && z.amt === 100000 && z.py === 100000); }, "this year's column, last year's and the note found");

  console.log("14. a party's statement: its opening line by its label only, an implied opening used (excel-uploads confirmed 12)");
  tryOk(() => { const g = [["Date", "Particulars", "Debit", "Credit", "Balance"], ["01/09/2026", "Opening Balance", "", "", "6,000 Dr"], ["06/09/2026", "Shop opening expenses recharge", 500, "", "6,500 Dr"]];
    const s = C.PartyRecon.statement({map: {date: "date", narration: "particulars", debit: "debit", credit: "credit", balance: "balance"}, transforms: {}}, g, 0);
    return s.open === 6000 && s.rows.length === 1 && s.rows[0].dr === 500; }, "'Shop opening expenses' is a line, not the opening");
  tryOk(() => { const g = [["Date", "Particulars", "Debit", "Credit", "Balance"], ["01/09/2026", "Bill 1", 1000, "", "6,000 Dr"], ["02/09/2026", "Paid", "", 2000, "4,000 Dr"]];
    const s = C.PartyRecon.statement({map: {date: "date", narration: "particulars", debit: "debit", credit: "credit", balance: "balance"}, transforms: {}}, g, 0);
    return s.open === 5000 && s.close === 4000 && Math.abs(s.open + s.moved - s.close) < 0.005; }, "no opening line: the opening is the first balance less its line (5,000), so it adds up");

  console.log("15. GSTR-2B Excel as the portal makes it (excel-uploads confirmed 13; purchase confirmed 4)");
  const top = ["GSTIN of supplier", "Trade/Legal name", "Invoice Details", "", "", "", "Place of supply", "Supply Attract Reverse Charge", "Rate(%)", "Taxable Value (₹)", "Tax Amount", "", "", "", "GSTR-1/IFF/GSTR-5 Period", "ITC Availability", "Reason"];
  const low = ["", "", "Invoice number", "Invoice type", "Invoice Date", "Invoice Value(₹)", "", "", "", "", "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)", "", "", ""];
  const b2b = [["Goods and Services Tax - GSTR-2B"], [], ["Taxable inward supplies received from registered persons"], [], top, low,
    ["09BBBBB1111B1Z5", "ALPHA TRADERS", "1", "Regular", "05/09/2026", 11800, "Uttar Pradesh", "No", 18, 10000, 0, 900, 900, 0, "Sep'26", "Yes", ""],
    ["27CCCCC2222C1Z5", "BETA STEEL", "1", "Regular", "06/09/2026", 59000, "Uttar Pradesh", "No", 18, 50000, 9000, 0, 0, 0, "Sep'26", "No", "POS and supplier state are same but recipient state is different"],
    ["07DDDDD3333D1Z5", "GAMMA LEGAL", "L-5", "Regular", "07/09/2026", 10000, "Uttar Pradesh", "Yes", 18, 10000, 1800, 0, 0, 0, "Sep'26", "Yes", ""]];
  const ntop = top.slice(); ntop[2] = "Credit note/Debit note details";
  const nlow = low.slice(); nlow[2] = "Note number"; nlow[3] = "Note type"; nlow[4] = "Note date"; nlow[5] = "Note Value (₹)";
  const cdnr = [["Goods and Services Tax - GSTR-2B"], [], ["Debit/Credit notes (Original)"], [], ntop, nlow, ["09BBBBB1111B1Z5", "ALPHA TRADERS", "CN-3", "Credit Note", "20/09/2026", 1180, "Uttar Pradesh", "No", 18, 1000, 0, 90, 90, 0, "Sep'26", "Yes", ""]];
  tryOk(() => { const g = b2b.map(r => r.slice()), hi = F.head(g), b = F.builtin(g[hi], "purchase"), d = b && F.apply(b, g, hi, CO, "purchase");
    return hi === 5 && b && b.builtin === "2b-excel" && d.length === 3 && by(d, "1").length === 2; }, "the two-row header joined; GSTR-2B known; both suppliers' bill 1 kept apart");
  const X = C.XLSX, wb2 = X.utils.book_new();
  X.utils.book_append_sheet(wb2, X.utils.aoa_to_sheet([["Read me"]]), "Read me"); X.utils.book_append_sheet(wb2, X.utils.aoa_to_sheet(b2b), "B2B");
  X.utils.book_append_sheet(wb2, X.utils.aoa_to_sheet(cdnr), "B2B-CDNR"); X.utils.book_append_sheet(wb2, X.utils.aoa_to_sheet(cdnr.slice(0, 6).concat([["09BBBBB1111B1Z5", "ALPHA", "CN-1"]])), "B2B-CDNRA");
  const rd = await F.read(file("2b.xlsx", X.write(wb2, {bookType: "xlsx", type: "array"}))).catch(e => { console.log("       (" + e + ")"); return null; });
  tryOk(() => rd && rd.sheet === "B2B" && rd.more && rd.more.length === 1 && rd.more[0].sheet === "B2B-CDNR" && (rd.amend || []).includes("B2B-CDNRA"), "the workbook: B2B read, B2B-CDNR read with it, the amendment sheet named");
  tryOk(() => { const g = cdnr.map(r => r.slice()), hi = F.head(g), d = F.apply(F.builtin(g[hi], "purchase"), g, hi, CO, "purchase"); return d.length === 1 && d[0].note === "credit" && d[0].total === -1180; }, "B2B-CDNR: credit note CN-3 reversed (−1,180)");
  // the bills made from 2B: ITC not available blocks the credit; reverse charge books the tax under RCM
  const ents = {};
  Object.assign(C, {D: () => ({entries: ents}), newEntry: f => ({id: "e" + Object.keys(ents).length, x: {}, file: f}), finishNewEntry: e => { ents[e.id] = e; e.status = "draft"; }, Store: {saveEntry(){}}, choiceValue: () => ""});
  tryOk(() => { const g = b2b.map(r => r.slice()), hi = F.head(g), d = F.apply(F.builtin(g[hi], "purchase"), g, hi, CO, "purchase"); C.SheetPost.toBills(d, "c1", "2b.xlsx");
    const all = Object.values(ents), beta = all.find(e => e.x.vendorGstin === "27CCCCC2222C1Z5"), gam = all.find(e => e.x.vendorGstin === "07DDDDD3333D1Z5");
    const gd = C.gstDecision(beta, CO), rt = C.rcmTaxOf(gam, CO, 10000);
    return beta.itcBlock && beta.itcBlock.on && gd.block && gam.rcm && gam.rcm.on && gam.rcm.rate === 18 && gam.rcm.inter === true && gam.x.igst === 0 && gam.x.total === 10000 && rt && rt.igst === 1800; },
    "ITC not available (Beta): its credit blocked, so its tax goes to the cost; reverse charge (Gamma): no GST to the supplier, IGST 1,800 under RCM");
  tryOk(() => { const g = b2b.map(r => r.slice()), hi = F.head(g); C.S.sheetImp = {side: "purchase", cid: "c1", docs: F.apply(F.builtin(g[hi], "purchase"), g, hi, CO, "purchase"), read: {amend: ["B2BA"]}};
    C.render = () => {}; C.SheetImport.check(); const q = C.S.sheetImp.questions.map(x => x.id); return q.includes("rcm") && q.includes("itc") && q.includes("amend"); }, "the panel asks about the reverse charge bills, the bills with no credit and the amendments");

  console.log("16. the ledger list: a sheet with no ledger heading is not read (excel-uploads confirmed 15)");
  let took = null;
  C.B = () => ({cid: "c1", ledgers: {list: [], groups: []}, newLed: [], rows: []});
  C.Ledgers = {take: (cid, x) => { took = x.list; throw new Error("stop"); }};
  C.gridsFromSheet = async () => [[["Particulars", "Under"], ["HDFC Bank", "Bank Accounts"], ["Rent", "Indirect Expenses"]], [["ZZ Test Client Pvt Ltd"], ["1-Apr-2026 to 31-Mar-2027"], ["Some notes"]]];
  await (C.importLedgerList ? C.importLedgerList(file("ledgers.xlsx", "PK")).catch(() => {}) : null);
  tryOk(() => took && took.length === 2 && !took.some(l => /Pvt Ltd|Apr-2026|notes/.test(l.name)), "2 ledgers from the list; the title sheet's lines are no ledgers (" + JSON.stringify((took || []).map(l => l.name)) + ")");

  console.log("17. bank amounts written with a Unicode minus; dated lines left out are counted (excel-uploads confirmed 16)");
  tryOk(() => C.bankAmount("−300") === -300 && C.bankAmount("–300") === -300, "−300 (U+2212) and –300 are −300");
  tryOk(() => { const rows = C.rowsFromCells([["05/09/2026", "X", "1.234,50", ""], ["06/09/2026", "Y", "100", ""]], {date: 0, narr: 1, debit: 2, credit: 3}, (r, c) => r[c]); return rows.length === 1 && rows.unread === 1; }, "a dated line whose amount cannot be read is counted (said on upload)");

  console.log("18. the low ones: filed GSTR-1 dates, AOC-4 heads, the TDS correction Excel, the PAN book Excel");
  tryOk(() => C.GSTX.dateKey("05-09-26") === "20260905" && C.GSTX.dateKey("not a date") === "", "a filed GSTR-1's 05-09-26 is 5 September 2026; no digit soup");
  const aoc = await import(path.join(ROOT, "app", "src", "screens", "corp", "aoc4.js")).catch(e => { console.log("       (" + e + ")"); return {}; });
  tryOk(() => aoc.guessHead("Loan from bank") !== "cash" && aoc.guessHead("Loans from Banks (secured)") !== "cash" && aoc.guessHead("Vehicle loan from HDFC Bank") !== "cash" && aoc.guessHead("Sales promotion expenses") !== "rev"
    && aoc.guessHead("Cash in hand") === "cash" && aoc.guessHead("Balances with banks") === "cash" && aoc.guessHead("Sale of products") === "rev", "a bank loan is not cash, sales promotion expenses not revenue; cash and sales still are");
  tryOk(() => { const ctx = vm.createContext({TDSEdit: {COLS: ["FinCom id (do not change)", "Date", "Voucher", "Deductee", "PAN", "Section", "Section name", "Rate %", "Amount paid", "TDS", "TDS in books", "Difference", "Challan", "Deductee code", "Lower-deduction certificate", "Remarks", "Needs fixing"],
      rateOut: r => r.rate, booksOf: () => 0, codeOf: () => "02", knownSec: () => true}, XLSX: C.XLSX, Market: C.Market, num: C.num, r2: C.r2, TDS: {ymd: d => String(d || "").replace(/[^0-9]/g, ""), challans: () => []}, Certs: {validPan: () => true, forRow: () => null},
      fmtDate: d => d, tallyDate: d => d, console, String, Number, Math, Object, isNaN, RegExp});
    vm.runInContext(fs.readFileSync(path.join(ROOT, "app", "src", "lib", "tdsEditExcel.js"), "utf8").replace(/^import .*$/gm, ""), ctx);
    const ws = C.XLSX.utils.aoa_to_sheet([ctx.TDSEdit.COLS, ["r1", "2026-09-10", "V1", "Changed Name", "ABCDE1234F", "194C", "", 1, 1000, 10, 10, 0, "", "02", "", "", ""], ["", "", "", "New Party", "ABCDE1234G", "194C", "", 1, 500, 5, "", "", "", "", "", "", ""]]);
    const out = ctx.TDSEdit.read({Sheets: {Deductions: ws}, SheetNames: ["Deductions"]}, [{id: "r1", date: "2026-09-05", party: "Old Name", pan: "ABCDE1234F", section: "194C", rate: 1, paid: 1000, tds: 10, voucher: "V1"}]);
    const f = out.refused.map(x => x.field); return f.includes("date") && f.includes("party") && f.includes("row"); }, "a row added, the date and the deductee changed: each said as refused, never silently ignored");
  tryOk(() => C.TDSPanFix.sheetLines([["Name", "Ledger Code", "PAN"], ["ZZ Party One", "LC001", "ABCDE1234F"]]) === "ZZ Party One\tABCDE1234F" && C.TDSPanFix.sheetLines([["ZZ P", "ABCDE1234F"]]) === "ZZ P\tABCDE1234F",
    "the PAN book Excel takes the Name column, not the code next to the PAN");

  console.log("19. the review of e7bf15906: marketplace sales in GSTR-1 / 3B and table 14, dates, parties, 24Q PANs, total rows, 2B sheets, returns, the PAN book");
  list.length = 0;
  C.S.coId = "c1"; C.S.books = C.S.books || {}; C.S.sales = {cid: "c1", list};
  const az2 = [["Invoice Number", "Invoice Date", "Transaction Type", "Order Id", "Ship To State", "Invoice Amount", "Tax Exclusive Gross", "Igst Tax", "Tcs Igst Amount"],
    ["AMZ-21", "05/09/2026", "Shipment", "O-21", "KARNATAKA", 1180, 1000, 180, 10], ["AMZ-22", "06/09/2026", "Shipment", "O-22", "KARNATAKA", 2360, 2000, 360, 20]];
  const fk2 = [["Order ID", "Order Item ID", "Event Type", "Buyer Invoice ID", "Buyer Invoice Date", "Taxable Value", "IGST Amount", "Final Invoice Amount", "Customer's Delivery State"],
    ["OD5", "I5", "Sale", "FK-101", "05/09/2026", 1000, 180, 1180, "Karnataka"], ["OD7", "I7", "Cancellation", "FK-103", "07/09/2026", -500, -90, -590, "Karnataka"]];
  tryOk(() => { const r = C.SheetPost.toSales(F.apply(F.builtin(az2[0], "sales"), az2, 0, CO, "sales"), "c1", "mtr.csv"), a = list.find(v => v.x.number === "AMZ-21");
    return r.added === 2 && a.source === "market" && a.x.ecommerce === "amazon" && a.x.tcs === 10 && /karnataka/i.test(a.x.placeOfSupply || ""); }, "an Amazon report: its invoices kept as a marketplace's (source market, the operator, the TCS, the place of supply)");
  tryOk(() => { C.SheetPost.toSales(F.apply(F.builtin(fk2[0], "sales"), fk2, 0, CO, "sales"), "c1", "fk.csv");
    const rows = C.GSTR.fromSales("202609"), a = rows.find(x => x.no === "AMZ-21"), f = rows.find(x => x.no === "FK-101");
    return rows.length === 3 && a && a.eco === "amazon" && a.tcs === 10 && a.posCode === "29" && a.taxable === 1000 && f && f.eco === "flipkart" && !rows.some(x => /FK-103/.test(x.no)); },
    "GSTR.fromSales after a Marketplace report upload: AMZ-21, AMZ-22, FK-101 in the month's outward figures (the held cancellation FK-103 not, until a person sets it)");
  tryOk(() => { const t = C.GSTR.eco14("202609", "09AAAAA0000A1Z5", {eco: C.GSTR.fromSales("202609")}), m = t.missing || [], am = m.find(x => x.eco === "amazon"), fl = m.find(x => x.eco === "flipkart");
    return am && am.n === 2 && am.suppval === 3000 && am.igst === 540 && am.tcs && fl && fl.n === 1 && fl.suppval === 1000; }, "table 14 (u/s 52): Amazon 2 invoices 3,000 and Flipkart 1 invoice 1,000, by operator");
  tryOk(() => { const r = C.SheetPost.toSales(F.apply(F.builtin(gg[0], "sales"), gg, 0, CO, "sales"), "c1", "reg.csv"); const s1 = list.find(v => v.x.number === "S-1"); return r.added === 2 && s1.source === "sheet" && !s1.x.ecommerce; },
    "a GST sales register (generic) stays the client's own sales: never an e-commerce operator's");
  tryOk(() => { const cnL = list.find(v => v.x.number === "CN-0042") || (C.SheetPost.toSales(F.apply(F.builtin(cn[0], "sales"), cn, 0, CO, "sales"), "c1", "a.csv"), list.find(v => v.x.number === "CN-0042"));
    return cnL && cnL.x.againstInvoice === "AMZ-7" && cnL.x.noteKind === "credit" && cnL.x.date === "2026-09-20"; }, "credit note CN-0042 is against invoice AMZ-7, dated its own date");

  tryOk(() => C.Market.date("2026/09/05") === "2026-09-05" && C.Market.date("2026.09.05") === "2026-09-05" && C.Market.date("2026-9-5") === "2026-09-05" && F.date("2026/09/05") === "2026-09-05"
    && F.date("26/09/05", "ymd") === "2026-09-05" && F.date("2026/09/05", "ymd") === "2026-09-05", "year first: 2026/09/05 and 2026.09.05 are 5 September 2026; a format saved as year / month / day read so");
  tryOk(() => C.Market.date("01/09/2015") === "2015-09-01" && C.Market.date("15/03/2016") === "2016-03-15" && C.Market.date("29/02/2024") === "2024-02-29" && C.Market.date("29/02/2025") === "" && C.Market.date("01/01/1985") === "",
    "a date before GST is still a date (a vendor statement's old bill of 01/09/2015); 29/02/2025 is none");
  tryOk(() => { const g = [["Invoice No", "Date", "Party", "Total"], ["A9", "15/03/2016", "X", 100]]; const d = F.apply({map: {no: "invoiceno", date: "date", party: "party", total: "total"}, transforms: {date: "dmy"}}, g, 0, CO, "sales");
    return d.length === 1 && d[0].date === "2016-03-15" && /before GST/.test(d[0].hold || "") && !/not a date/.test(d[0].hold || ""); }, "a register row dated 15/03/2016 is held as before GST (1 July 2017), not as no date");

  const gs1 = h => [["Customer", "GSTIN", "Invoice No", "Date", "Taxable", "IGST", "CGST", "SGST", "Total"]].concat(h);
  const fmS = {map: {party: "customer", gstin: "gstin", no: "invoiceno", date: "date", taxable: "taxable", igst: "igst", cgst: "cgst", sgst: "sgst", total: "total"}, transforms: {date: "dmy", groupByNo: true}};
  tryOk(() => { const d = F.apply(fmS, gs1([["P One", "09BBBBB1111B1Z5", "S-1", "05/09/2026", 1000, 0, 90, 90, 1180], ["P One", "", "S-1", "05/09/2026", 500, 0, 45, 45, 590]]), 0, CO, "sales");
    const e = F.apply(fmS, gs1([["P One", "", "S-1", "05/09/2026", 500, 0, 45, 45, 590], ["P One", "09BBBBB1111B1Z5", "S-1", "05/09/2026", 1000, 0, 90, 90, 1180]]), 0, CO, "sales");
    return d.length === 1 && !d[0].hold && d[0].gstin === "09BBBBB1111B1Z5" && d[0].total === 1770 && e.length === 1 && !e[0].hold && e[0].gstin === "09BBBBB1111B1Z5" && e[0].total === 1770; },
    "a sales invoice's GSTIN on one row only, the same name on both: one invoice to P One (09BBBBB1111B1Z5), 1,770, not held");

  const csvP = "Employee Name,PAN,Month,Gross Salary,TDS\nA One,ABCDE1234F,Apr-2026,100000,10000\nB Two,PANNOTAVBL,Apr-2026,50000,5000\nC Three,PANNOTAVBL,Apr-2026,50000,5000\nD Four,,Apr-2026,50000,5000\n";
  const rP = await C.TDS24Q.fromFile(file("pans.csv", csvP)).catch(e => ({error: String(e)}));
  tryOk(() => rP.rows && rP.rows.length === 4 && rP.rows[0].pan === "ABCDE1234F", "24Q: a PAN column mostly PANNOTAVBL keeps A One's PAN ABCDE1234F (" + JSON.stringify((rP.rows || []).map(x => x.pan)) + ")");

  const gt = [["Customer Name", "Invoice Number", "Invoice Date", "GSTIN", "Taxable Value", "CGST Amount", "SGST Amount", "Invoice Amount"],
    ["Total Solutions Pvt Ltd", "S-1", "05/09/2026", "09BBBBB1111B1Z5", 1000, 90, 90, 1180], ["P Two", "S-2", "06/09/2026", "09BBBBB1111B1Z5", 2000, 180, 180, 2360], ["Total", "", "", "", 3000, 270, 270, 3540]];
  tryOk(() => { const d = F.apply(F.builtin(gt[0], "sales"), gt, 0, CO, "sales"); return d.length === 2 && by(d, "S-1").length === 1 && (d.skipped || []).length === 1 && d.skipped[0].why === "a total row"; },
    "a register whose first column is the customer: S-1 to Total Solutions Pvt Ltd kept; the Total row left out, and counted");
  tryOk(() => { const d = F.apply({map: {party: "customername", no: "invoicenumber", date: "invoicedate", total: "invoiceamount"}, transforms: {date: "dmy"}}, gt, 0, CO, "sales"); return d.length === 2 && by(d, "S-1").length === 1 && d.skipped.length === 1; },
    "… the same with a saved format");

  const wb3 = X.utils.book_new();
  X.utils.book_append_sheet(wb3, X.utils.aoa_to_sheet(b2b), "B2B");
  X.utils.book_append_sheet(wb3, X.utils.aoa_to_sheet([["Goods and Services Tax - GSTR-2B"], [], ["Import of goods"], [], ["Icegate Reference Date", "Port Code", "Bill of Entry Number", "Bill of Entry Date", "Taxable Value", "Integrated Tax"], ["01/09/2026", "INNSA1", "1234567", "01/09/2026", 10000, 1800]]), "IMPG");
  X.utils.book_append_sheet(wb3, X.utils.aoa_to_sheet([["Goods and Services Tax - GSTR-2B"], [], ["ISD credits (amendment)"], [], ["GSTIN of ISD", "Trade name", "ISD document number", "ISD document date", "Integrated Tax"], ["09EEEEE4444E1Z5", "ISD", "ISD-1", "01/09/2026", 100]]), "ISDA");
  const rd3 = await F.read(file("2b3.xlsx", X.write(wb3, {bookType: "xlsx", type: "array"}))).catch(e => { console.log("       (" + e + ")"); return null; });
  tryOk(() => rd3 && (rd3.amend || []).includes("ISDA") && !(rd3.amend || []).includes("IMPG") && (rd3.notRead || []).includes("IMPG"), "2B: IMPG is no amendment (it is named as not read); ISDA is one (" + JSON.stringify(rd3 && [rd3.amend, rd3.notRead]) + ")");
  tryOk(() => { const g = b2b.map(r => r.slice()), hi = F.head(g); C.S.sheetImp = {side: "purchase", cid: "c1", docs: F.apply(F.builtin(g[hi], "purchase"), g, hi, CO, "purchase"), read: {amend: [], notRead: ["IMPG"]}};
    C.SheetImport.check(); const q = C.S.sheetImp.questions.find(x => x.id === "notread"); return q && /IMPG/.test(q.text) && !C.S.sheetImp.questions.some(x => x.id === "amend"); }, "… and the panel says the IMPG sheet is not read, never that it is an amendment");

  const fk3 = [["Order ID", "Order Item ID", "Event Type", "Buyer Invoice ID", "Buyer Invoice Date", "Return Date", "Taxable Value", "IGST Amount", "Final Invoice Amount", "Customer's Delivery State"],
    ["OD9", "I1", "Return", "FK-1", "05/09/2026", "10/09/2026", -1000, -180, -1180, "Karnataka"], ["OD9", "I2", "Return", "FK-1", "05/09/2026", "20/09/2026", -1000, -180, -1180, "Karnataka"]];
  tryOk(() => { const d = F.apply(F.builtin(fk3[0], "sales"), fk3, 0, CO, "sales").filter(x => x.note === "credit");
    return d.length === 2 && d.some(x => x.date === "2026-09-10" && x.total === -1180) && d.some(x => x.date === "2026-09-20" && x.total === -1180) && d.every(x => x.against === "FK-1"); },
    "two returns of FK-1 in one report (10/09 and 20/09): two credit notes of 1,180, each its own date, against FK-1");

  tryOk(() => C.TDSPanFix.sheetLines([["Company Name", "Ledger Code", "PAN"], ["ZZ Party One Pvt Ltd", "LC001", "ABCDE1234F"]]) === "ZZ Party One Pvt Ltd\tABCDE1234F"
    && C.TDSPanFix.sheetLines([["Name", "PAN No", "Ledger Code"], ["ZZ P", "ABCDE1234F", "LC1"]]) === "ZZ P\tABCDE1234F", "the PAN book: 'Company Name' is the name column (company holds 'pan'), not the code");

  console.log("20. the release review (23-Nov-2026): a marketplace report's dates before GST or years ahead are held, as a register's");
  const azD = [["Invoice Number", "Invoice Date", "Transaction Type", "Order Id", "Ship To State", "Invoice Amount", "Tax Exclusive Gross", "Igst Tax"],
    ["AMZ-31", "05/09/2015", "Shipment", "O-31", "KARNATAKA", 1180, 1000, 180], ["AMZ-32", "05/09/2036", "Shipment", "O-32", "KARNATAKA", 1180, 1000, 180], ["AMZ-33", "05/09/2026", "Shipment", "O-33", "KARNATAKA", 1180, 1000, 180]];
  tryOk(() => { const d = F.apply(F.builtin(azD[0], "sales"), azD, 0, CO, "sales"), a = by(d, "AMZ-31")[0], b = by(d, "AMZ-32")[0], c = by(d, "AMZ-33")[0];
    return a && a.date === "2015-09-05" && /before GST/.test(a.hold || "") && /check the date/.test(a.hold || "") && b && /years ahead/.test(b.hold || "") && /check the date/.test(b.hold || "") && c && !c.hold; },
    "an Amazon report: AMZ-31 of 05/09/2015 held (before GST began, check the date), AMZ-32 of 2036 held (years ahead), AMZ-33 of 2026 not");
  const shD = [["Name", "Created at", "Financial Status", "Total", "Taxes", "Lineitem name", "Lineitem price", "Tax 1 Name", "Tax 1 Value", "Shipping Province"], ["#1001", "2016-03-01 10:00:00 +0530", "paid", 1180, 180, "ZZ Mug", 1000, "IGST 18%", 180, "KA"]];
  tryOk(() => { const d = F.apply(F.builtin(shD[0], "sales"), shD, 0, CO, "sales"); return d.length === 1 && /before GST/.test(d[0].hold || ""); }, "a Shopify order of 1 March 2016: held, before GST began");

  console.log("21. (the owner, 23-Nov-2026) marketplace credit notes without a number of their own: <invoice> (CN-1), (CN-2) by return date, kept on a re-import");
  { const fr = (rows) => [["Order ID", "Order Item ID", "Event Type", "Buyer Invoice ID", "Buyer Invoice Date", "Return Date", "Taxable Value", "IGST Amount", "Final Invoice Amount", "Customer's Delivery State"]].concat(rows);
    const r = (d, amt) => ["OD5", "I5", "Return", "FK-055", "05/09/2026", d, -amt, -C.r2(amt * .18), -C.r2(amt * 1.18), "Karnataka"];
    const up = (rows) => C.SheetPost.toSales(F.apply(F.builtin(fr(rows)[0], "sales"), fr(rows), 0, CO, "sales"), "c1", "fk.csv");
    const nos = () => list.filter(v => /^FK-055/.test(v.x.number)).map(v => v.x.number + "@" + v.x.date).sort();
    tryOk(() => { list.length = 0; const a = up([r("20/09/2026", 200), r("12/09/2026", 100)]);
      return a.added === 2 && JSON.stringify(nos()) === JSON.stringify(["FK-055 (CN-1)@2026-09-12", "FK-055 (CN-2)@2026-09-20"]); }, "two returns of FK-055 in one report: (CN-1) the earlier, (CN-2) the later (" + JSON.stringify(nos()) + ")");
    tryOk(() => { const b = up([r("12/09/2026", 100), r("20/09/2026", 200)]);
      return b.added === 0 && b.again === 2 && nos().length === 2; }, "the report again: each return keeps its number, nothing added (" + JSON.stringify(nos()) + ")");
    tryOk(() => { const c = up([r("20/09/2026", 200), r("02/10/2026", 50)]);
      return c.added === 1 && c.again === 1 && JSON.stringify(nos()) === JSON.stringify(["FK-055 (CN-1)@2026-09-12", "FK-055 (CN-2)@2026-09-20", "FK-055 (CN-3)@2026-10-02"]); }, "a later report with a third return: (CN-3), the second kept as (CN-2) (" + JSON.stringify(nos()) + ")");
    tryOk(() => { list.length = 0; list.push({id: "old1", x: {number: "FK-055 (CN)", date: "2026-09-12", total: 118, noteKind: "credit", customerName: "Retail customer"}, status: "posted", source: "sheet"});
      const d = up([r("12/09/2026", 100), r("20/09/2026", 200)]);
      return d.added === 1 && JSON.stringify(nos()) === JSON.stringify(["FK-055 (CN)@2026-09-12", "FK-055 (CN-1)@2026-09-20"]); }, "one kept before as (CN): still that one, not added again; the new return (CN-1) (" + JSON.stringify(nos()) + ")");
    tryOk(() => { list.length = 0; up([["OD6", "I6", "Return", "FK-066", "05/09/2026", "", -100, -18, -118, "Karnataka"]]); return list.length === 1 && list[0].x.number === "FK-066 (CN-1)"; }, "a single return with no return date: (CN-1)"); }

  console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
  process.exit(fails ? 1 : 0);
})();
