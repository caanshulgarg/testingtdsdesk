// node run_itemvch.js - item invoices, and voucher types with their own names
const {load, HTML} = require("./harness");
const {ctx, x} = load(HTML, ["num", "r2", "MONTHS", "fmtDate", "STATE_CODES", "Books", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "INR"]);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const led = (n, a, bill) => "<ALLLEDGERENTRIES.LIST><LEDGERNAME>" + n + "</LEDGERNAME><ISDEEMEDPOSITIVE>" + (a < 0 ? "Yes" : "No") + "</ISDEEMEDPOSITIVE><AMOUNT>" + a.toFixed(2) + "</AMOUNT>" + (bill ? "<BILLALLOCATIONS.LIST><NAME>" + bill + "</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>" + a.toFixed(2) + "</AMOUNT></BILLALLOCATIONS.LIST>" : "") + "</ALLLEDGERENTRIES.LIST>";
const item = (name, ledger, a) => "<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>" + name + "</STOCKITEMNAME><ISDEEMEDPOSITIVE>" + (a < 0 ? "Yes" : "No") + "</ISDEEMEDPOSITIVE><RATE>100.00/Nos</RATE><AMOUNT>" + a.toFixed(2) + "</AMOUNT><ACTUALQTY> 100 Nos</ACTUALQTY>" +
  "<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>" + ledger + "</LEDGERNAME><ISDEEMEDPOSITIVE>" + (a < 0 ? "Yes" : "No") + "</ISDEEMEDPOSITIVE><AMOUNT>" + a.toFixed(2) + "</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>";
const vch = (type, no, date, party, gstin, body) => '<TALLYMESSAGE><VOUCHER REMOTEID="' + no + '" VCHTYPE="' + type + '" ACTION="Create"><DATE>' + date + "</DATE><GUID>g-" + no + "</GUID><VOUCHERTYPENAME>" + type + "</VOUCHERTYPENAME><VOUCHERNUMBER>" + no +
  "</VOUCHERNUMBER><PARTYLEDGERNAME>" + party + "</PARTYLEDGERNAME><PARTYGSTIN>" + gstin + "</PARTYGSTIN><CMPGSTIN>07AAACZ1234Z1Z5</CMPGSTIN><REFERENCE>INV-" + no + "</REFERENCE>" + body + "</VOUCHER></TALLYMESSAGE>";
const xml = "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><STATICVARIABLES><SVCURRENTCOMPANY>ZZ TRADING</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>" +
  vch("GST INWARD", "P1", "20250610", "ABC STEEL", "07AABCA1234A1Z5", led("ABC STEEL", 11800, "INV-P1") + led("07 IGST INPUT", -1800) + item("MS SHEET", "PURCHASE @18%", -10000)) +
  vch("Purchase Order", "PO1", "20250611", "ABC STEEL", "07AABCA1234A1Z5", led("ABC STEEL", 5900) + item("MS SHEET", "PURCHASE @18%", -5000)) +
  vch("TAX INVOICE", "S1", "20250615", "XYZ TRADERS", "07AAACX1111X1Z5", led("XYZ TRADERS", -23600, "S1") + led("07 IGST OUTPUT", 3600) + item("MS SHEET", "SALES @18%", 20000)) +
  "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>";
(async () => {
  const res = await x.Books.importDayBook(new Blob([xml], {type: "text/xml"}));
  const b = {cid: "t", vouchers: res.vouchers, meta: res.meta, under: {"PURCHASE @18%": "Purchase Accounts", "SALES @18%": "Sales Accounts", "ABC STEEL": "Sundry Creditors", "XYZ TRADERS": "Sundry Debtors", "07 IGST INPUT": "Duties & Taxes", "07 IGST OUTPUT": "Duties & Taxes"}, groups: {"Sundry Creditors": "Current Liabilities", "Sundry Debtors": "Current Assets"}};
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b;
  const [p1, po, s1] = ["P1", "PO1", "S1"].map(n => b.vouchers.find(v => v.no === n));
  ok(p1 && p1.ent.some(e => e.l === "PURCHASE @18%" && e.a === -10000), "item invoice: the purchase ledger inside the item is read (-10,000)");
  ok(x.Books.isPurchase(p1), "a voucher type called GST INWARD that debits Purchase Accounts is a purchase");
  ok(!x.Books.isPurchase(po) && !x.Books.isSale(po), "a Purchase Order is neither a purchase nor a sale");
  ok(x.Books.isSale(s1), "a voucher type called TAX INVOICE that credits Sales Accounts is a sale");
  const L = x.Books.lines(p1);
  ok(L.taxable === 10000 && L.tax.IGST === 1800, "purchase value 10,000 and IGST 1,800 (was 0 value before)");
  const inn = x.GSTR.inward("202506", "07"), out = x.GSTR.outward("202506", "07");
  ok(inn.length === 1 && inn[0].taxable === 10000 && inn[0].igst === 1800, "in the month's inward supplies for 3B");
  ok(out.length === 1 && out[0].taxable === 20000 && out[0].igst === 3600, "the sale in the month's outward supplies for GSTR-1");
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
