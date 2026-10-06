// The owner's real-Tally scenarios for bridge 2.3.1 (S1..S10): the masters and entries the harness puts into user 1's Tally
// (TallyPrime 7.1, Educational mode) by XML import, and the ground truth of each (what the harness entered). Each entry is
// then opened on Tally's screen and saved (Ctrl+A) by flow4.ps1, so the add-on writes its line and the bridge asks Tally for
// the entry (an XML import alone writes no add-on line: run 37402702702).
//   node scen231.mjs gen <outdir>   -> <outdir>\masters-*.xml (TALLYMESSAGE bodies), s*.xml, plan.json
// Educational mode takes entries dated the 1st and 2nd of a month only: each scenario has a day of its own, so the Day Book
// of that day holds that one entry (opened with End, Enter).
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const r2 = x => Math.round(x * 100) / 100;
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const f2 = x => r2(x).toFixed(2);
// a GSTIN with its check character (the GSTN mod-36 rule)
function gstin(first14) {
  const cs = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; let f = 2, sum = 0;
  for (let i = first14.length - 1; i >= 0; i--) { const d = f * cs.indexOf(first14[i]); f = f === 2 ? 1 : 2; sum += Math.floor(d / 36) + (d % 36); }
  return first14 + cs[(36 - (sum % 36)) % 36];
}

export const CO = "FinCom Spike Co";
export const N = {
  sales: "S231 Sales", purchase: "S231 Purchase", cgstOut: "Output CGST", sgstOut: "Output SGST", cgstIn: "Input CGST", sgstIn: "Input SGST",
  buyer: "S231 Buyer", supplier: "S231 Supplier", billParty: "S231 Billwise Party", contractor: "S231 Contractor", contractExp: "S231 Contract Exp",
  tds: "S231 TDS Payable", bank: "S231 Bank", officeExp: "S231 Office Exp", cat: "S231 Region", north: "S231 North", south: "S231 South",
  nature: "S231 Contract Work", newParty: "S231 New Party", income: "Spike Income",
  freight: "S231 Freight Charged", roundOff: "S231 Round Off",
};
export const GSTIN_OLD = gstin("07AAACS2310K1Z"), GSTIN_NEW = gstin("07AAACS2310K2Z");
// stock items: name, HSN, GST rate (whole), sale rate
export const ITEMS = [
  { name: "S231 Rice", hsn: "1006", gst: 5, rate: 50 },
  { name: "S231 Laptop", hsn: "8471", gst: 18, rate: 30000 },
  { name: "S231 Tablet", hsn: "3004", gst: 12, rate: 400 },
  { name: "S231 Car Part", hsn: "8708", gst: 28, rate: 2500 },
];
const item = n => ITEMS.find(i => i.name === n);

// ---- masters
const led = (name, parent, extra = "") => `<LEDGER NAME="${esc(name)}" ACTION="Create"><NAME.LIST><NAME>${esc(name)}</NAME></NAME.LIST><PARENT>${esc(parent)}</PARENT>${extra}</LEDGER>`;
const gstReg = g => `<PARTYGSTIN>${g}</PARTYGSTIN><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><LEDSTATENAME>Delhi</LEDSTATENAME>` +
  `<LEDMAILINGDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><MAILINGNAME>${esc(N.buyer)}</MAILINGNAME><STATE>Delhi</STATE><COUNTRY>India</COUNTRY></LEDMAILINGDETAILS.LIST>` +
  `<LEDGSTREGDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><PLACEOFSUPPLY>Delhi</PLACEOFSUPPLY><GSTIN>${g}</GSTIN></LEDGSTREGDETAILS.LIST>`;
const rateDet = g => ["CGST", "SGST/UTGST"].map(h => `<RATEDETAILS.LIST><GSTRATEDUTYHEAD>${h}</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>${g / 2}</GSTRATE></RATEDETAILS.LIST>`).join("") +
  `<RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>${g}</GSTRATE></RATEDETAILS.LIST>`;
function stockItem(it) {
  return `<STOCKITEM NAME="${esc(it.name)}" ACTION="Create"><NAME.LIST><NAME>${esc(it.name)}</NAME></NAME.LIST><BASEUNITS>Nos</BASEUNITS>` +
    `<GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>` +
    `<HSNDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><HSNCODE>${it.hsn}</HSNCODE><SRCOFHSNDETAILS>Specify Details Here</SRCOFHSNDETAILS></HSNDETAILS.LIST>` +
    `<GSTDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><CALCULATIONTYPE>On Value</CALCULATIONTYPE><HSNCODE>${it.hsn}</HSNCODE><TAXABILITY>Taxable</TAXABILITY><SRCOFGSTDETAILS>Specify Details Here</SRCOFGSTDETAILS>` +
    `<STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME>${rateDet(it.gst)}</STATEWISEDETAILS.LIST></GSTDETAILS.LIST>` +
    `<OPENINGBALANCE> 5000 Nos</OPENINGBALANCE><OPENINGRATE>10.00/Nos</OPENINGRATE><OPENINGVALUE>-50000.00</OPENINGVALUE></STOCKITEM>`;
}
const masters = {
  // the company's features for TDS and cost centres (said in the log whether Tally took them)
  "masters-0-company": `<COMPANY NAME="${CO}" ACTION="Alter"><NAME>${CO}</NAME><ISTDSON>Yes</ISTDSON><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON><ISBILLWISEON>Yes</ISBILLWISEON></COMPANY>`,
  "masters-1-items": ITEMS.map(stockItem).join(""),
  "masters-2-costs": `<COSTCATEGORY NAME="${N.cat}" ACTION="Create"><NAME.LIST><NAME>${N.cat}</NAME></NAME.LIST><ALLOCATEREVENUE>Yes</ALLOCATEREVENUE><ALLOCATENONREVENUE>Yes</ALLOCATENONREVENUE></COSTCATEGORY>` +
    [N.north, N.south].map(c => `<COSTCENTRE NAME="${c}" ACTION="Create"><NAME.LIST><NAME>${c}</NAME></NAME.LIST><CATEGORY>${N.cat}</CATEGORY></COSTCENTRE>`).join(""),
  // the TDS nature of payment (Tally keeps it as a tax classification of type TDS)
  "masters-3-nature": `<TAXCLASSIFICATION NAME="${N.nature}" ACTION="Create"><NAME.LIST><NAME>${N.nature}</NAME></NAME.LIST><TAXTYPE>TDS</TAXTYPE><SECTIONNUMBER>194C</SECTIONNUMBER><PAYMENTCODE>94C</PAYMENTCODE>` +
    `<TDSRATEDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><DEDUCTEETYPE>Company - Resident</DEDUCTEETYPE><TDSRATE>2</TDSRATE><SURCHARGERATE>0</SURCHARGERATE><EDUCESSRATE>0</EDUCESSRATE></TDSRATEDETAILS.LIST></TAXCLASSIFICATION>`,
  "masters-4-ledgers": [
    led(N.sales, "Sales Accounts", "<AFFECTSSTOCK>Yes</AFFECTSSTOCK>"), led(N.purchase, "Purchase Accounts", "<AFFECTSSTOCK>Yes</AFFECTSSTOCK>"),
    ...[N.cgstOut, N.sgstOut, N.cgstIn, N.sgstIn].map(n => led(n, "Duties & Taxes", "<TAXTYPE>Others</TAXTYPE>")),
    led(N.buyer, "Sundry Debtors", "<ISBILLWISEON>No</ISBILLWISEON>" + gstReg(GSTIN_OLD)),
    led(N.supplier, "Sundry Creditors", "<ISBILLWISEON>No</ISBILLWISEON>"),
    led(N.billParty, "Sundry Debtors", "<ISBILLWISEON>Yes</ISBILLWISEON>"),
    led(N.bank, "Bank Accounts", "<ISBILLWISEON>No</ISBILLWISEON>"),
    led(N.officeExp, "Indirect Expenses", "<ISCOSTCENTRESON>Yes</ISCOSTCENTRESON>"),
    led(N.freight, "Indirect Incomes", "<GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Services</GSTTYPEOFSUPPLY>"),
    led(N.roundOff, "Indirect Expenses", "<ROUNDINGMETHOD>Normal Rounding</ROUNDINGMETHOD>"),
  ].join(""),
  // a realistic ledger list for the FinComLedgers timing: 400 parties
  "masters-6-bulk": Array.from({ length: 400 }, (_, i) => led(`S231 Party ${String(i + 1).padStart(3, "0")}`, i % 2 ? "Sundry Creditors" : "Sundry Debtors",
    `<ISBILLWISEON>Yes</ISBILLWISEON><OPENINGBALANCE>${f2((i % 2 ? 1 : -1) * (1000 + i))}</OPENINGBALANCE>`)).join(""),
  // after checks 1-8 (S231Run): the company's TDS and cost centre features turned on (on before them, Tally's screens
  // ask for cost centres in check 1's receipt: run 37416946111), then the TDS nature and ledgers
  "masters-5-tds": [
    led(N.contractor, "Sundry Creditors", "<ISBILLWISEON>No</ISBILLWISEON><INCOMETAXNUMBER>AAACS2310K</INCOMETAXNUMBER><ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE><TDSAPPLICABLE>Yes</TDSAPPLICABLE><TDSDEDUCTEETYPE>Company - Resident</TDSDEDUCTEETYPE><TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>"),
    led(N.contractExp, "Indirect Expenses", `<ISCOSTCENTRESON>Yes</ISCOSTCENTRESON><ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE><TDSAPPLICABLE>${N.nature}</TDSAPPLICABLE><TDSCATEGORYNAME>${N.nature}</TDSCATEGORYNAME>`),
    led(N.tds, "Duties & Taxes", `<TAXTYPE>TDS</TAXTYPE><TDSCATEGORYNAME>${N.nature}</TDSCATEGORYNAME><TAXCLASSIFICATIONNAME>${N.nature}</TAXCLASSIFICATIONNAME>`),
  ].join(""),
};

// ---- entries
const dp = a => (a < 0 ? "Yes" : "No");   // Tally: a debit is negative and deemed positive
function ledgerEntry(tag, name, amount, inner = "") {
  return `<${tag}><LEDGERNAME>${esc(name)}</LEDGERNAME><ISDEEMEDPOSITIVE>${dp(amount)}</ISDEEMEDPOSITIVE><AMOUNT>${f2(amount)}</AMOUNT>${inner}</${tag}>`;
}
// an item invoice: party and duties in LEDGERENTRIES, each item's sales / purchase ledger in its ACCOUNTINGALLOCATIONS (as
// Tally keeps an item invoice; flow4's check 8 import, run 37402702702). sign: +1 sales (party Dr), -1 purchase / credit note
function invoice({ type, date, party, ledger, rows, sign, cgst, sgst, head = "", narr, extra = [], roundOff = false }) {
  // rows: [item, qty, {rate?, disc? (per cent), incl? (the rate including GST)}]
  const lines = rows.map(([n, qty, o = {}]) => { const it = item(n), rate = o.rate ?? it.rate, taxable = r2(qty * rate * (1 - (o.disc || 0) / 100));
    return { item: n, hsn: it.hsn, qty, unit: "Nos", rate, taxable, gst: it.gst, tax: r2(taxable * it.gst / 100), cgst: r2(taxable * it.gst / 200), sgst: r2(taxable * it.gst / 200), disc: o.disc, incl: o.incl }; });
  // extra ledger lines with their own GST (freight): [ledger, amount, gst, sac]
  const xt = extra.map(([n, a, g, sac]) => ({ n, a, g, sac, c: r2(a * g / 200) }));
  const net = r2(lines.reduce((s, l) => s + l.taxable, 0));
  const tc = r2(lines.reduce((s, l) => s + l.cgst, 0) + xt.reduce((s, x) => s + x.c, 0)), ts = tc;
  const gross = r2(net + xt.reduce((s, x) => s + x.a, 0) + tc + ts), total = roundOff ? Math.round(gross) : gross, ro = r2(total - gross);
  const inv = lines.map(l => {
    const v = sign * l.taxable;
    return `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${esc(l.item)}</STOCKITEMNAME><ISDEEMEDPOSITIVE>${dp(v)}</ISDEEMEDPOSITIVE><GSTHSNNAME>${l.hsn}</GSTHSNNAME>` +
      `<RATE>${f2(l.rate)}/Nos</RATE>${l.disc ? `<DISCOUNT> ${l.disc}</DISCOUNT>` : ""}${l.incl ? `<RATEINCLUSIVEOFTAX>${f2(l.incl)}/Nos</RATEINCLUSIVEOFTAX>` : ""}<AMOUNT>${f2(v)}</AMOUNT><ACTUALQTY> ${l.qty} Nos</ACTUALQTY><BILLEDQTY> ${l.qty} Nos</BILLEDQTY>${rateDet(l.gst)}` +
      `<BATCHALLOCATIONS.LIST><GODOWNNAME>Main Location</GODOWNNAME><BATCHNAME>Primary Batch</BATCHNAME><AMOUNT>${f2(v)}</AMOUNT><ACTUALQTY> ${l.qty} Nos</ACTUALQTY><BILLEDQTY> ${l.qty} Nos</BILLEDQTY></BATCHALLOCATIONS.LIST>` +
      ledgerEntry("ACCOUNTINGALLOCATIONS.LIST", ledger, v) + `</ALLINVENTORYENTRIES.LIST>`;
  }).join("");
  const le = `<LEDGERENTRIES.LIST><LEDGERNAME>${esc(party)}</LEDGERNAME><ISDEEMEDPOSITIVE>${dp(-sign * total)}</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>${f2(-sign * total)}</AMOUNT></LEDGERENTRIES.LIST>` +
    xt.map(x => ledgerEntry("LEDGERENTRIES.LIST", x.n, sign * x.a, `<GSTHSNNAME>${x.sac}</GSTHSNNAME>${rateDet(x.g)}`)).join("") +
    ledgerEntry("LEDGERENTRIES.LIST", cgst, sign * tc) + ledgerEntry("LEDGERENTRIES.LIST", sgst, sign * ts) +
    (ro ? ledgerEntry("LEDGERENTRIES.LIST", N.roundOff, sign * ro) : "");
  const xml = `<VOUCHER VCHTYPE="${type}" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>${date}</DATE><EFFECTIVEDATE>${date}</EFFECTIVEDATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME>` +
    `<PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME><PARTYNAME>${esc(party)}</PARTYNAME><PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE><NARRATION>${esc(narr)}</NARRATION>${head}${le}${inv}</VOUCHER>`;
  const ledgers = { [party]: r2(-sign * total), [ledger]: r2(sign * net), [cgst]: r2(sign * tc), [sgst]: r2(sign * ts) };
  xt.forEach(x => { ledgers[x.n] = r2(sign * x.a); }); if (ro) ledgers[N.roundOff] = r2(sign * ro);
  return { xml, truth: { type, party, items: lines, ledgers, total } };
}
function accounting({ type, date, party, rows, narr, head = "" }) {
  const xml = `<VOUCHER VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${date}</DATE><EFFECTIVEDATE>${date}</EFFECTIVEDATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME>` +
    (party ? `<PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>` : "") + `<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><NARRATION>${esc(narr)}</NARRATION>${head}` +
    rows.map(r => ledgerEntry("ALLLEDGERENTRIES.LIST", r.ledger, r.amount, r.inner || "")).join("") + `</VOUCHER>`;
  return { xml, truth: { type, party, ledgers: Object.fromEntries(rows.map(r => [r.ledger, r.amount])) } };
}

const S = [];
const add = (o, made) => S.push({ ...o, xml: made.xml, truth: { ...made.truth, ...(o.truth || {}) } });
// S1: a sales invoice, two stock items at 5% and 18%, CGST + SGST; with the e-invoice's IRN / acknowledgement and an e-way bill
// number as stored fields (Educational mode cannot reach the IRP or the e-way bill portal: whether Tally keeps them is reported)
const IRN = "a5c12dca80e743321740b001fd70953e8738d109865d28ba4013750f2046f229";
add({ id: "S1", key: "s1-sales-two-rates", label: "sales invoice, two stock items at 5% and 18%", kind: "items", day: "1-11-2026", date: "20261101" },
  invoice({ type: "Sales", date: "20261101", party: N.buyer, ledger: N.sales, sign: 1, cgst: N.cgstOut, sgst: N.sgstOut, narr: "S1 two GST rates",
    rows: [["S231 Rice", 10], ["S231 Laptop", 2]],
    head: `<REFERENCE>PO-231</REFERENCE><PARTYGSTIN>${GSTIN_OLD}</PARTYGSTIN><PLACEOFSUPPLY>Delhi</PLACEOFSUPPLY><IRN>${IRN}</IRN><IRNACKNO>112611010000231</IRNACKNO><IRNACKDATE>20261101</IRNACKDATE>` +
      `<EWAYBILLDETAILS.LIST><BILLDATE>20261101</BILLDATE><BILLNUMBER>381101234231</BILLNUMBER><DOCUMENTTYPE>Tax Invoice</DOCUMENTTYPE></EWAYBILLDETAILS.LIST>` }));
S[0].truth.irn = IRN; S[0].truth.ackNo = "112611010000231"; S[0].truth.ackDate = "20261101"; S[0].truth.eway = "381101234231";
add({ id: "S2", key: "s2-purchase-items", label: "purchase invoice with items", kind: "items", day: "2-11-2026", date: "20261102" },
  invoice({ type: "Purchase", date: "20261102", party: N.supplier, ledger: N.purchase, sign: -1, cgst: N.cgstIn, sgst: N.sgstIn, narr: "S2 purchase with items",
    rows: [["S231 Tablet", 5], ["S231 Rice", 20]], head: "<REFERENCE>SUP-231</REFERENCE><REFERENCEDATE>20261102</REFERENCEDATE>" }));
add({ id: "S3", key: "s3-credit-note-items", label: "credit note with items", kind: "items", day: "1-12-2026", date: "20261201" },
  invoice({ type: "Credit Note", date: "20261201", party: N.buyer, ledger: N.sales, sign: -1, cgst: N.cgstOut, sgst: N.sgstOut, narr: "S3 goods returned",
    rows: [["S231 Laptop", 1]] }));
// S4: the bill (New Ref S231-BILL-1, a journal of 1-10-2026, before the bridges start) and the receipt against it
const billJ = accounting({ type: "Journal", date: "20261001", narr: "S4 the bill", rows: [
  { ledger: N.billParty, amount: -2360, inner: `<BILLALLOCATIONS.LIST><NAME>S231-BILL-1</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>-2360.00</AMOUNT></BILLALLOCATIONS.LIST>` },
  { ledger: N.income, amount: 2360 }] });
add({ id: "S4", key: "s4-receipt-against-bill", label: "receipt against a bill (Agst Ref S231-BILL-1)", kind: "bills", day: "2-12-2026", date: "20261202", truth: { bills: [{ ledger: N.billParty, name: "S231-BILL-1", type: "Agst Ref", amount: 2360 }] } },
  accounting({ type: "Receipt", date: "20261202", party: N.billParty, narr: "S4 against S231-BILL-1", rows: [
    { ledger: N.billParty, amount: 2360, inner: `<BILLALLOCATIONS.LIST><NAME>S231-BILL-1</NAME><BILLTYPE>Agst Ref</BILLTYPE><AMOUNT>2360.00</AMOUNT></BILLALLOCATIONS.LIST>` },
    { ledger: "Cash", amount: -2360 }] }));
// S5: a payment with TDS 2% on contract work (the TDS line's tax object allocation as Tally 7.1 exports it)
add({ id: "S5", key: "s5-payment-tds", label: "payment with TDS", kind: "tds", day: "1-1-2027", date: "20270101", truth: { tds: { nature: N.nature, rate: 2, base: 100000, tax: 2000, party: N.contractor, section: "194C", deductee: "Company - Resident" } } },
  accounting({ type: "Payment", date: "20270101", party: N.contractor, narr: "S5 contract work, TDS 194C 2%", rows: [
    { ledger: N.contractExp, amount: -100000 },
    { ledger: N.tds, amount: 2000, inner: `<TAXOBJECTALLOCATIONS.LIST><CATEGORY>${N.nature}</CATEGORY><TAXTYPE>TDS</TAXTYPE><PARTYLEDGER>${N.contractor}</PARTYLEDGER><REFTYPE>New Ref</REFTYPE><ISPANVALID>Yes</ISPANVALID>` +
      `<SUBCATEGORYALLOCATION.LIST><SUBCATEGORY>Income Tax</SUBCATEGORY><DUTYLEDGER>${N.tds}</DUTYLEDGER><TAXRATE>2</TAXRATE><ASSESSABLEAMOUNT>100000.00</ASSESSABLEAMOUNT><TAX>2000.00</TAX></SUBCATEGORYALLOCATION.LIST></TAXOBJECTALLOCATIONS.LIST>` },
    { ledger: "Cash", amount: 98000 }] }));
// S6: a journal with cost centres (S231 Region: North 600, South 400)
add({ id: "S6", key: "s6-journal-cost-centres", label: "journal with cost centres", kind: "costs", day: "2-1-2027", date: "20270102", truth: { costs: [{ ledger: N.officeExp, category: N.cat, centre: N.north, amount: -600 }, { ledger: N.officeExp, category: N.cat, centre: N.south, amount: -400 }] } },
  accounting({ type: "Journal", date: "20270102", narr: "S6 office costs by region", rows: [
    { ledger: N.officeExp, amount: -1000, inner: `<CATEGORYALLOCATIONS.LIST><CATEGORY>${N.cat}</CATEGORY><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>` +
      `<COSTCENTREALLOCATIONS.LIST><NAME>${N.north}</NAME><AMOUNT>-600.00</AMOUNT></COSTCENTREALLOCATIONS.LIST><COSTCENTREALLOCATIONS.LIST><NAME>${N.south}</NAME><AMOUNT>-400.00</AMOUNT></COSTCENTREALLOCATIONS.LIST></CATEGORYALLOCATIONS.LIST>` },
    { ledger: N.supplier, amount: 1000 }] }));
// S7: a bank payment by NEFT with its UTR as the instrument number
const UTR = "SBINR52027020100231";
add({ id: "S7", key: "s7-bank-payment-utr", label: "bank payment with a UTR", kind: "bank", day: "1-2-2027", date: "20270201", truth: { bank: { ledger: N.bank, txnType: "e-Fund Transfer", instNo: UTR, instDate: "20270201", amount: 5900 } } },
  accounting({ type: "Payment", date: "20270201", party: N.supplier, narr: "S7 NEFT to the supplier", rows: [
    { ledger: N.supplier, amount: -5900 },
    { ledger: N.bank, amount: 5900, inner: `<BANKALLOCATIONS.LIST><DATE>20270201</DATE><INSTRUMENTDATE>20270201</INSTRUMENTDATE><NAME>${UTR}</NAME><TRANSACTIONTYPE>e-Fund Transfer</TRANSACTIONTYPE>` +
      `<TRANSFERMODE>NEFT</TRANSFERMODE><BANKPARTYNAME>${N.supplier}</BANKPARTYNAME><PAYMENTFAVOURING>${N.supplier}</PAYMENTFAVOURING><INSTRUMENTNUMBER>${UTR}</INSTRUMENTNUMBER><UNIQUEREFERENCENUMBER>${UTR}</UNIQUEREFERENCENUMBER><PAYMENTMODE>Transacted</PAYMENTMODE><AMOUNT>5900.00</AMOUNT></BANKALLOCATIONS.LIST>` }] }));
// S10: one sales invoice with 50 item lines (the four items in turn, quantities 1..7)
add({ id: "S10", key: "s10-sales-50-items", label: "sales invoice with 50 items", kind: "items", day: "2-2-2027", date: "20270202" },
  invoice({ type: "Sales", date: "20270202", party: N.buyer, ledger: N.sales, sign: 1, cgst: N.cgstOut, sgst: N.sgstOut, narr: "S10 fifty lines",
    rows: Array.from({ length: 50 }, (_, i) => [ITEMS[i % 4].name, (i % 7) + 1]) }));
// S11-S14 (the owner, 06-Oct-2026): invoices FinCom must APPLY, with a note where the worked-out tax differs, never hold
add({ id: "S11", key: "s11-sales-freight-gst", label: "sales invoice with freight carrying GST (no item line for it)", kind: "items", notesOnly: true, day: "1-6-2026", date: "20260601" },
  invoice({ type: "Sales", date: "20260601", party: N.buyer, ledger: N.sales, sign: 1, cgst: N.cgstOut, sgst: N.sgstOut, narr: "S11 freight with GST",
    rows: [["S231 Laptop", 1]], extra: [[N.freight, 1000, 18, "9965"]] }));
add({ id: "S12", key: "s12-sales-round-off", label: "invoice with round-off", kind: "items", notesOnly: true, day: "2-6-2026", date: "20260602" },
  invoice({ type: "Sales", date: "20260602", party: N.buyer, ledger: N.sales, sign: 1, cgst: N.cgstOut, sgst: N.sgstOut, narr: "S12 rounded off",
    rows: [["S231 Tablet", 1, { rate: 399.5 }]], roundOff: true }));
add({ id: "S13", key: "s13-sales-discount", label: "invoice with a discount", kind: "items", notesOnly: true, day: "1-7-2026", date: "20260701" },
  invoice({ type: "Sales", date: "20260701", party: N.buyer, ledger: N.sales, sign: 1, cgst: N.cgstOut, sgst: N.sgstOut, narr: "S13 10% discount",
    rows: [["S231 Laptop", 2, { disc: 10 }]] }));
add({ id: "S14", key: "s14-sales-tax-inclusive", label: "tax-inclusive invoice", kind: "items", notesOnly: true, day: "2-7-2026", date: "20260702" },
  invoice({ type: "Sales", date: "20260702", party: N.buyer, ledger: N.sales, sign: 1, cgst: N.cgstOut, sgst: N.sgstOut, narr: "S14 price includes GST (52.50 a unit)",
    rows: [["S231 Rice", 10, { incl: 52.5 }]] }));
// S8: a new party ledger, created and used at once in a receipt (after the stub's ledger book is seeded)
const s8 = accounting({ type: "Receipt", date: "20270301", party: N.newParty, narr: "S8 first receipt from a new party", rows: [{ ledger: N.newParty, amount: 1180 }, { ledger: "Cash", amount: -1180 }] });
add({ id: "S8", key: "s8-new-party", label: "a new party ledger used at once", kind: "ledgers", day: "1-3-2027", date: "20270301", truth: { newLedger: N.newParty } }, s8);

const plan = {
  company: CO, names: N, gstinOld: GSTIN_OLD, gstinNew: GSTIN_NEW,
  masters: ["masters-1-items", "masters-2-costs", "masters-4-ledgers", "masters-6-bulk"],
  later: ["masters-0-company", "masters-3-nature", "masters-5-tds"],
  bill: "s4-bill",
  s8Ledger: "s8-ledger",
  s9Alter: "s9-alter",
  scenarios: S.map(({ xml, ...o }) => o),
};
const extra = {
  "s4-bill": billJ.xml,
  "s8-ledger": led(N.newParty, "Sundry Debtors", "<ISBILLWISEON>No</ISBILLWISEON>"),
  // S9: the party's GSTIN altered (the same PAN, another entity number)
  "s9-alter": `<LEDGER NAME="${N.buyer}" ACTION="Alter"><NAME.LIST><NAME>${N.buyer}</NAME></NAME.LIST><PARENT>Sundry Debtors</PARENT>${gstReg(GSTIN_NEW)}</LEDGER>`,
};

if (process.argv[2] === "gen") {
  const out = process.argv[3]; mkdirSync(out, { recursive: true });
  for (const [k, v] of Object.entries(masters)) writeFileSync(join(out, k + ".xml"), v);
  for (const [k, v] of Object.entries(extra)) writeFileSync(join(out, k + ".xml"), v);
  for (const s of S) writeFileSync(join(out, s.key + ".xml"), s.xml);
  writeFileSync(join(out, "plan.json"), JSON.stringify(plan, null, 1));
  console.log(`scen231: ${Object.keys(masters).length} master sets, ${S.length} entries -> ${out}`);
}
