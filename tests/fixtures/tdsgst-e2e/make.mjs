// The TDS and GST end-to-end fixture (round 43): a throwaway test company's masters and entries as XML for TallyPrime 7.1's
// import (the real-Tally harness puts them into its own Tally, on branch tally-versions, mode tdsgst), the amendments made
// after the returns are "filed", and the entries as entered (vouchers.json: every ledger line's amount, for the cloud
// copy's check). The answer key is NOT made here: expected.json is written by hand (EXPECTED.md shows the arithmetic).
//   node make.mjs <outdir>    -> <outdir>/masters.json, vouchers-p1.json, ops-p2.json, vouchers.json
// Test data only: made-up parties, PANs and GSTINs (the GSTINs carry a correct check character).
// Educational mode takes entries dated the 1st, 2nd and 31st of a month only.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const r2 = (x) => Math.round(x * 100) / 100;
const f2 = (x) => r2(x).toFixed(2);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function gstin(first14) {
  const cs = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; let f = 2, sum = 0;
  for (let i = first14.length - 1; i >= 0; i--) { const d = f * cs.indexOf(first14[i]); f = f === 2 ? 1 : 2; sum += Math.floor(d / 36) + (d % 36); }
  return first14 + cs[(36 - (sum % 36)) % 36];
}
const G = (st, pan) => gstin(st + pan + "1Z");

export const CO = "FinCom Spike Co";
export const COMPANY = { name: CO, state: "Delhi", pan: "AAACF1234A", gstin: G("07", "AAACF1234A"), tan: "DELF01234E" };

// ---------------------------------------------------------------- parties
// kind: c customer, s supplier, d deductee (TDS), t collectee (TCS)
export const P = {
  alpha: { name: "Alpha Traders Delhi", group: "Sundry Debtors", state: "Delhi", reg: "Regular", pan: "AABCA1111A", gstin: G("07", "AABCA1111A") },
  beta: { name: "Beta Industries Mumbai", group: "Sundry Debtors", state: "Maharashtra", reg: "Regular", pan: "AABCB2222B", gstin: G("27", "AABCB2222B") },
  gamma: { name: "Gamma SEZ Unit", group: "Sundry Debtors", state: "Karnataka", reg: "Regular", sez: true, pan: "AABCG3333C", gstin: G("29", "AABCG3333C") },
  delta: { name: "Delta SEZ Unit", group: "Sundry Debtors", state: "Tamil Nadu", reg: "Regular", sez: true, pan: "AABCD4444D", gstin: G("33", "AABCD4444D") },
  euro: { name: "Euro Imports GmbH", group: "Sundry Debtors", state: "", country: "Germany", reg: "Unregistered" },
  retail: { name: "Retail Customer UP", group: "Sundry Debtors", state: "Uttar Pradesh", reg: "Unregistered" },
  cash: { name: "Cash Sales Delhi", group: "Sundry Debtors", state: "Delhi", reg: "Unregistered" },
  walkin: { name: "Walkin Haryana", group: "Sundry Debtors", state: "Haryana", reg: "Unregistered" },
  iota: { name: "Iota Services Pune", group: "Sundry Debtors", state: "Maharashtra", reg: "Regular", pan: "AABCI5151I", gstin: G("27", "AABCI5151I"), billwise: true },
  scrap: { name: "Scrap Buyer Delhi", group: "Sundry Debtors", state: "Delhi", reg: "Regular", pan: "AABCS5555E", gstin: G("07", "AABCS5555E") },
  zeta: { name: "Zeta Retail Buyer", group: "Sundry Debtors", state: "Delhi", reg: "Regular", pan: "AABCZ6666F", gstin: G("07", "AABCZ6666F") },
  kappa: { name: "Kappa Suppliers Delhi", group: "Sundry Creditors", state: "Delhi", reg: "Regular", pan: "AABCK7777G", gstin: G("07", "AABCK7777G") },
  lambda: { name: "Lambda Supplies Rajasthan", group: "Sundry Creditors", state: "Rajasthan", reg: "Regular", pan: "AABCL8888H", gstin: G("08", "AABCL8888H") },
  mu: { name: "Mu Advocates", group: "Sundry Creditors", state: "Delhi", reg: "Unregistered", pan: "ABCPM1111J" },
  nu: { name: "Nu Motors Delhi", group: "Sundry Creditors", state: "Delhi", reg: "Regular", pan: "AABCN9999K", gstin: G("07", "AABCN9999K") },
  xi: { name: "Xi Farm Produce", group: "Sundry Creditors", state: "Delhi", reg: "Unregistered" },
  omicron: { name: "Omicron Contractors", group: "Sundry Creditors", state: "Delhi", pan: "AAACO1234C", tds: "Company - Resident" },
  pi: { name: "Pi Consultants", group: "Sundry Creditors", state: "Delhi", pan: "ABCPP1234D", tds: "Individual/HUF - Resident" },
  rho: { name: "Rho Brokers", group: "Sundry Creditors", state: "Delhi", pan: "AABFR1234E", tds: "Partnership Firm" },
  sigma: { name: "Sigma Landlord", group: "Sundry Creditors", state: "Delhi", pan: "ABCPS1234F", pan2: "ABCPS9999F", tds: "Individual/HUF - Resident" },
  tau: { name: "Tau Goods Supplier", group: "Sundry Creditors", state: "Delhi", pan: "AAACT1234G", tds: "Company - Resident" },
  upsilon: { name: "Upsilon Finance", group: "Sundry Creditors", state: "Delhi", pan: "AAACU1234H", tds: "Company - Resident" },
  phi: { name: "Phi Freelancer", group: "Sundry Creditors", state: "Delhi", pan: "", tds: "Individual/HUF - Resident" },
  chi: { name: "Chi Tech Services", group: "Sundry Creditors", state: "Delhi", pan: "AAACC1234J", tds: "Company - Resident" },
  psi: { name: "Psi Small Contractor", group: "Sundry Creditors", state: "Delhi", pan: "ABCPY1234K", tds: "Individual/HUF - Resident" },
  omega: { name: "Omega Software Inc", group: "Sundry Creditors", state: "", country: "United States of America", pan: "AAJCO1234L", tds: "Company - Non Resident" },
  emp: { name: "Employee A", group: "Sundry Creditors", state: "Delhi", pan: "ABCPE1234M" },
};

// ---------------------------------------------------------------- ledgers (other than parties)
export const L = {
  salesG: "Sales Goods 18%", salesS: "Sales Services 18%", salesNil: "Sales Nil Rated", salesEx: "Sales Exempt", scrapSales: "Scrap Sales",
  purch: "Purchases 18%", purchEx: "Purchase Exempt", legal: "Legal Fees", car: "Motor Car",
  outC: "Output CGST", outS: "Output SGST", outI: "Output IGST", inC: "Input CGST", inS: "Input SGST", inI: "Input IGST",
  rcmC: "CGST RCM Payable", rcmS: "SGST RCM Payable",
  bank: "HDFC Bank",
  contract: "Contract Charges", prof: "Professional Fees", comm: "Commission Paid", rent: "Rent", goods: "Purchase of Goods", interest: "Interest Paid",
  royalty: "Royalty Paid", salary: "Salaries",
  tds194C: "TDS Payable 194C", tds194J: "TDS Payable 194J", tdsComm: "TDS on Commission 393(1)", tdsRent: "TDS on Rent 393(1)", tds194Q: "TDS Payable 194Q",
  tds194A: "TDS Payable 194A", tds195: "TDS Payable 195", tds192: "TDS on Salary 192",
  tcsScrap: "TCS 206C(1) Scrap", tcs1H: "TCS 206C(1H) Sale of Goods",
};
// the natures of payment (Tally's TDS Nature of Payment masters): name, section, payment code, rate
const NATURES = [["Payment to Contractors", "194C", "94C", 2], ["Fees for Professional Services", "194J", "94J", 10], ["Commission or Brokerage", "194H", "94H", 2],
  ["Rent on Land or Building", "194I", "94I", 10], ["Purchase of Goods", "194Q", "94Q", 0.1], ["Interest other than on Securities", "194A", "94A", 10],
  ["Royalty to Non Resident", "195", "195", 20.8], ["Salary", "192", "92B", 0]];
const NAT = { [L.tds194C]: NATURES[0], [L.tds194J]: NATURES[1], [L.tdsComm]: NATURES[2], [L.tdsRent]: NATURES[3], [L.tds194Q]: NATURES[4], [L.tds194A]: NATURES[5], [L.tds195]: NATURES[6], [L.tds192]: NATURES[7] };

const led = (name, parent, extra = "") => `<LEDGER NAME="${esc(name)}" ACTION="Create"><NAME.LIST><NAME>${esc(name)}</NAME></NAME.LIST><PARENT>${esc(parent)}</PARENT>${/ISCOSTCENTRESON/.test(extra) ? "" : "<ISCOSTCENTRESON>No</ISCOSTCENTRESON>"}${extra}</LEDGER>`;
const rateDet = (g) => `<RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>${g / 2}</GSTRATE></RATEDETAILS.LIST>` +
  `<RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>${g / 2}</GSTRATE></RATEDETAILS.LIST>` +
  `<RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE>${g}</GSTRATE></RATEDETAILS.LIST>`;
// a GST-applicable sales or purchase ledger: its HSN / SAC, rate and taxability in its GST details
// inelig: the ledger's purchases give no input credit (section 17(5)); run 38064141905: Tally kept the entry's own
// GSTOVRDNINELIGIBLEITC as "Not Applicable" whatever the import said, so the ledger's GST details say it
const gstLed = (name, parent, { hsn, rate, taxability = "Taxable", supply = "Goods", inelig }) => led(name, parent,
  `<GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>${supply}</GSTTYPEOFSUPPLY><AFFECTSSTOCK>No</AFFECTSSTOCK>` + "" +
  `<GSTDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><CALCULATIONTYPE>On Value</CALCULATIONTYPE><HSNCODE>${hsn}</HSNCODE><TAXABILITY>${taxability}</TAXABILITY>${inelig ? "<GSTINELIGIBLEITC>Yes</GSTINELIGIBLEITC>" : ""}<SRCOFGSTDETAILS>Specify Details Here</SRCOFGSTDETAILS>` +
  `<STATEWISEDETAILS.LIST><STATENAME>&#4; Any</STATENAME>${rateDet(rate)}</STATEWISEDETAILS.LIST></GSTDETAILS.LIST>` +
  `<HSNDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><HSNCODE>${hsn}</HSNCODE><SRCOFHSNDETAILS>Specify Details Here</SRCOFHSNDETAILS></HSNDETAILS.LIST>`);
const taxLed = (name, head) => led(name, "Duties & Taxes", `<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>${head}</GSTDUTYHEAD>`);
function party(p) {
  let x = `<ISBILLWISEON>${p.billwise ? "Yes" : "No"}</ISBILLWISEON>`;
  if (p.pan) x += `<INCOMETAXNUMBER>${p.pan}</INCOMETAXNUMBER>`;
  if (p.state) x += `<LEDSTATENAME>${esc(p.state)}</LEDSTATENAME>`;
  x += `<COUNTRYNAME>${esc(p.country || "India")}</COUNTRYNAME>`;
  x += `<LEDMAILINGDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><MAILINGNAME>${esc(p.name)}</MAILINGNAME>${p.state ? `<STATE>${esc(p.state)}</STATE>` : ""}<COUNTRY>${esc(p.country || "India")}</COUNTRY></LEDMAILINGDETAILS.LIST>`;
  if (p.reg) {
    x += `<GSTREGISTRATIONTYPE>${p.reg}</GSTREGISTRATIONTYPE>` + (p.gstin ? `<PARTYGSTIN>${p.gstin}</PARTYGSTIN>` : "") + (p.sez ? "<GSTPARTYTYPE>SEZ</GSTPARTYTYPE><ISSEZPARTY>Yes</ISSEZPARTY>" : "");
    x += `<LEDGSTREGDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><GSTREGISTRATIONTYPE>${p.reg}</GSTREGISTRATIONTYPE>${p.state ? `<PLACEOFSUPPLY>${esc(p.state)}</PLACEOFSUPPLY><STATE>${esc(p.state)}</STATE>` : ""}${p.gstin ? `<GSTIN>${p.gstin}</GSTIN>` : ""}${p.sez ? "<GSTPARTYTYPE>SEZ</GSTPARTYTYPE><ISSEZPARTY>Yes</ISSEZPARTY>" : ""}</LEDGSTREGDETAILS.LIST>`;
  }
  if (p.tds) x += `<ISTDSAPPLICABLE>Yes</ISTDSAPPLICABLE><TDSAPPLICABLE>Yes</TDSAPPLICABLE><TDSDEDUCTEETYPE>${esc(p.tds)}</TDSDEDUCTEETYPE><TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>` +
    `<DEDUCTINSAMEVCHRULES.LIST><DATE>20260401</DATE><DEDUCTINSAMEVCH>Yes</DEDUCTINSAMEVCH></DEDUCTINSAMEVCHRULES.LIST>`;
  return led(p.name, p.group, x);
}
// run 38060636032: TallyPrime 7.1 refused a ledger naming a nature of payment it does not hold as a "TDS Rate" ("TDS Rate
// 'Salary' does not exist!"), and with it every expense ledger naming one: the TDS and expense ledgers carry no nature
const tdsLed = (name) => led(name, "Duties & Taxes", `<TAXTYPE>TDS</TAXTYPE>`);
const tcsLed = (name) => led(name, "Duties & Taxes", `<TAXTYPE>TCS</TAXTYPE>`);
const tdsExp = (name) => led(name, "Indirect Expenses");

export const MASTERS = {
  // 1. the company: GST and TDS on, its state, PAN, TAN and GSTIN (each said in the harness's log: whether Tally took it)
  company: `<COMPANY NAME="${CO}" ACTION="Alter"><NAME>${CO}</NAME><STATENAME>Delhi</STATENAME><COUNTRYNAME>India</COUNTRYNAME><INCOMETAXNUMBER>${COMPANY.pan}</INCOMETAXNUMBER>` +
    `<ISGSTON>Yes</ISGSTON><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><GSTIN>${COMPANY.gstin}</GSTIN><GSTAPPLICABLEDATE>20260401</GSTAPPLICABLEDATE>` +
    `<ISTDSON>Yes</ISTDSON><TANUMBER>${COMPANY.tan}</TANUMBER><TANREGNO>${COMPANY.tan}</TANREGNO><TDSDEDUCTORTYPE>Company</TDSDEDUCTORTYPE><ISTCSON>Yes</ISTCSON><ISBILLWISEON>Yes</ISBILLWISEON></COMPANY>`,
  // 1b. the voucher types numbered by hand, so each entry keeps the number it was given (run 38060636032: Tally's automatic
  // numbering renumbered FC/26-27/013 as 13)
  vchtypes: ["Sales", "Purchase", "Credit Note", "Debit Note", "Journal", "Receipt", "Payment"].map((t) => `<VOUCHERTYPE NAME="${t}" ACTION="Alter"><NAME>${t}</NAME><NUMBERINGMETHOD>Manual</NUMBERINGMETHOD><ISDEEMEDPOSITIVE>${/Sales|Debit Note|Receipt/.test(t) ? "Yes" : "No"}</ISDEEMEDPOSITIVE><PREVENTDUPLICATES>No</PREVENTDUPLICATES></VOUCHERTYPE>`).join(""),
  // 2. the natures of payment (may be refused by Tally's import; the entries go in all the same, said in the log)
  natures: NATURES.map(([n, sec, code, rate]) => `<TAXCLASSIFICATION NAME="${esc(n)}" ACTION="Create"><NAME.LIST><NAME>${esc(n)}</NAME></NAME.LIST><TAXTYPE>TDS</TAXTYPE><SECTIONNUMBER>${sec}</SECTIONNUMBER><PAYMENTCODE>${code}</PAYMENTCODE>` +
    `<TDSRATEDETAILS.LIST><APPLICABLEFROM>20260401</APPLICABLEFROM><DEDUCTEETYPE>Company - Resident</DEDUCTEETYPE><TDSRATE>${rate}</TDSRATE><SURCHARGERATE>0</SURCHARGERATE><EDUCESSRATE>0</EDUCESSRATE></TDSRATEDETAILS.LIST></TAXCLASSIFICATION>`).join(""),
  // 3. the ledgers
  ledgers: [
    gstLed(L.salesG, "Sales Accounts", { hsn: "8471", rate: 18 }), gstLed(L.salesS, "Sales Accounts", { hsn: "998314", rate: 18, supply: "Services" }),
    gstLed(L.salesNil, "Sales Accounts", { hsn: "0701", rate: 0, taxability: "Nil Rated" }), gstLed(L.salesEx, "Sales Accounts", { hsn: "0401", rate: 0, taxability: "Exempt" }),
    gstLed(L.scrapSales, "Sales Accounts", { hsn: "7204", rate: 18 }),
    gstLed(L.purch, "Purchase Accounts", { hsn: "8471", rate: 18 }), gstLed(L.purchEx, "Purchase Accounts", { hsn: "0701", rate: 0, taxability: "Exempt" }),
    gstLed(L.legal, "Indirect Expenses", { hsn: "998211", rate: 18, supply: "Services" }), gstLed(L.car, "Fixed Assets", { hsn: "8703", rate: 28, inelig: true }),
    taxLed(L.outC, "Central Tax"), taxLed(L.outS, "State Tax"), taxLed(L.outI, "Integrated Tax"), taxLed(L.inC, "Central Tax"), taxLed(L.inS, "State Tax"), taxLed(L.inI, "Integrated Tax"),
    taxLed(L.rcmC, "Central Tax"), taxLed(L.rcmS, "State Tax"),
    led(L.bank, "Bank Accounts"),
    tdsExp(L.contract, NATURES[0][0]), tdsExp(L.prof, NATURES[1][0]), tdsExp(L.comm, NATURES[2][0]), tdsExp(L.rent, NATURES[3][0]), led(L.goods, "Purchase Accounts"),
    tdsExp(L.interest, NATURES[5][0]), tdsExp(L.royalty, NATURES[6][0]), led(L.salary, "Indirect Expenses"),
    ...[L.tds194C, L.tds194J, L.tdsComm, L.tdsRent, L.tds194Q, L.tds194A, L.tds195, L.tds192].map(tdsLed), tcsLed(L.tcsScrap), tcsLed(L.tcs1H),
    ...Object.values(P).map(party),
  ].join(""),
};

// ---------------------------------------------------------------- entries
const dp = (a) => (a < 0 ? "Yes" : "No");   // Tally: a debit is negative and deemed positive
const TODAY = "20261010";
function line(name, amount, inner = "") {
  return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(name)}</LEDGERNAME><ISDEEMEDPOSITIVE>${dp(amount)}</ISDEEMEDPOSITIVE><AMOUNT>${f2(amount)}</AMOUNT>${inner}</ALLLEDGERENTRIES.LIST>`;
}
// the voucher-level GST party details Tally keeps on an entry (the party's registration, state, country, GSTIN, the place of
// supply, the company's GSTIN) and the override flags (reverse charge, ineligible credit)
function gstHead(p, { pos, rcm, inelig } = {}) {
  let x = "";
  if (p.reg) x += `<GSTREGISTRATIONTYPE>${p.reg}</GSTREGISTRATIONTYPE>`;
  if (p.sez) x += "<GSTPARTYTYPE>SEZ</GSTPARTYTYPE><ISSEZPARTY>Yes</ISSEZPARTY>";
  if (p.state) x += `<STATENAME>${esc(p.state)}</STATENAME>`;
  x += `<COUNTRYOFRESIDENCE>${esc(p.country || "India")}</COUNTRYOFRESIDENCE>`;
  if (p.gstin) x += `<PARTYGSTIN>${p.gstin}</PARTYGSTIN>`;
  const ps = pos === undefined ? p.state : pos;
  if (ps) x += `<PLACEOFSUPPLY>${esc(ps)}</PLACEOFSUPPLY>`;
  x += `<CMPGSTIN>${COMPANY.gstin}</CMPGSTIN><CMPGSTREGISTRATIONTYPE>Regular</CMPGSTREGISTRATIONTYPE><CMPGSTSTATE>Delhi</CMPGSTSTATE>`;
  if (rcm) x += "<GSTOVRDNISREVCHARGEAPPL>&#4; Applicable</GSTOVRDNISREVCHARGEAPPL><ISREVERSECHARGEAPPLICABLE>Yes</ISREVERSECHARGEAPPLICABLE>";
  if (inelig) x += "<GSTOVRDNINELIGIBLEITC>&#4; Applicable</GSTOVRDNINELIGIBLEITC>";
  return x;
}
// the GST details on the value line: HSN / SAC, the rate, taxability, type of supply and nature of the transaction
const gstLine = ({ hsn, rate, taxability = "Taxable", supply = "Goods", nature }) =>
  `<GSTHSNNAME>${hsn}</GSTHSNNAME><GSTOVRDNTAXABILITY>${taxability}</GSTOVRDNTAXABILITY><GSTOVRDNTYPEOFSUPPLY>${supply}</GSTOVRDNTYPEOFSUPPLY>` +
  (nature ? `<GSTOVRDNNATURE>${esc(nature)}</GSTOVRDNNATURE>` : "") + rateDet(rate);
// a TDS line's allocation as Tally keeps it (the nature, the party, the assessable value, the rate and the tax)
const tdsAlloc = (tdsLedger, partyName, base, rate, tax) => {
  const nat = NAT[tdsLedger][0];
  return `<TAXOBJECTALLOCATIONS.LIST><CATEGORY>${esc(nat)}</CATEGORY><TAXTYPE>TDS</TAXTYPE><PARTYLEDGER>${esc(partyName)}</PARTYLEDGER><REFTYPE>New Ref</REFTYPE><ISPANVALID>Yes</ISPANVALID>` +
    `<SUBCATEGORYALLOCATION.LIST><SUBCATEGORY>Income Tax</SUBCATEGORY><DUTYLEDGER>${esc(tdsLedger)}</DUTYLEDGER><TAXRATE>${rate}</TAXRATE><ASSESSABLEAMOUNT>${f2(base)}</ASSESSABLEAMOUNT><TAX>${f2(tax)}</TAX></SUBCATEGORYALLOCATION.LIST></TAXOBJECTALLOCATIONS.LIST>`;
};
// rows: [ledger, amount (Tally's sign: debit negative), inner XML]
function voucher({ id, type, date, no, party, narr, ref, refDate, head = "", rows, optional, action = "Create", remoteId }) {
  const sum = r2(rows.reduce((a, r) => a + r[1], 0));
  if (Math.abs(sum) > 0.001) throw new Error(id + ": the lines do not add up to 0 (" + sum + ")");
  const xml = `<VOUCHER ${remoteId ? `REMOTEID="${remoteId}" ` : ""}VCHTYPE="${type}" ACTION="${action}" OBJVIEW="Accounting Voucher View"><DATE>${date}</DATE><EFFECTIVEDATE>${date}</EFFECTIVEDATE>` +
    `<VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(no)}</VOUCHERNUMBER>` + (party ? `<PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME><PARTYNAME>${esc(party)}</PARTYNAME>` : "") +
    (ref ? `<REFERENCE>${esc(ref)}</REFERENCE>` : "") + (refDate ? `<REFERENCEDATE>${refDate}</REFERENCEDATE>` : "") +
    `<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><ISOPTIONAL>${optional ? "Yes" : "No"}</ISOPTIONAL><NARRATION>${esc(narr)}</NARRATION>${head}` +
    rows.map((r) => line(r[0], r[1], r[2] || "")).join("") + `</VOUCHER>`;
  return { id, type, date, no, party: party || "", narr, ref: ref || "", optional: !!optional, lines: rows.map((r) => [r[0], r2(r[1])]), xml };
}
// a sale: the party debited with the total; the value line credited with its GST details; the tax lines credited
function sale({ id, date, no, p, value, ledger, g, tax = [], narr, optional, pos, type = "Sales", extra = [] }) {
  const total = r2(value + tax.reduce((a, t) => a + t[1], 0) + extra.reduce((a, t) => a + t[1], 0));
  return voucher({ id, type, date, no, party: p.name, narr, optional, head: gstHead(p, { pos }),
    rows: [[p.name, -total, p.billwise ? `<BILLALLOCATIONS.LIST><NAME>${esc(no)}</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>${f2(-total)}</AMOUNT></BILLALLOCATIONS.LIST>` : ""],
      [ledger, value, gstLine(g)], ...tax.map(([n, a]) => [n, a]), ...extra.map(([n, a]) => [n, a])] });
}
// a credit note: the sale reversed (the value and tax debited, the party credited)
function creditNote({ id, date, no, p, value, ledger, g, tax, narr, pos }) {
  const total = r2(value + tax.reduce((a, t) => a + t[1], 0));
  return voucher({ id, type: "Credit Note", date, no, party: p.name, narr, head: gstHead(p, { pos }), rows: [[ledger, -value, gstLine(g)], ...tax.map(([n, a]) => [n, -a]), [p.name, total]] });
}
// a purchase: the value and input tax debited, the supplier credited (and, under reverse charge, the tax payable credited)
function purchase({ id, date, no, ref, p, value, ledger, g, tax = [], rcm = [], narr, inelig, isRcm }) {
  const total = r2(value + tax.reduce((a, t) => a + t[1], 0) - rcm.reduce((a, t) => a + t[1], 0));
  return voucher({ id, type: "Purchase", date, no, ref, refDate: date, party: p.name, narr, head: gstHead(p, { rcm: isRcm, inelig }),
    rows: [[ledger, -value, gstLine(g)], ...tax.map(([n, a]) => [n, -a]), ...rcm.map(([n, a]) => [n, a]), [p.name, total]] });
}
// a TDS journal: the expense debited, the TDS ledger and the party credited
function tdsJournal({ id, date, no, p, exp, amount, tdsLedger, rate, tds, narr }) {
  const rows = [[exp, -amount]];
  if (tdsLedger) rows.push([tdsLedger, tds, tdsAlloc(tdsLedger, p.name, amount, rate, tds)]);
  rows.push([p.name, r2(amount - (tds || 0))]);
  return voucher({ id, type: "Journal", date, no, party: p.name, narr, rows });
}
const C9 = (v) => [[L.outC, r2(v * 0.09)], [L.outS, r2(v * 0.09)]];
const I18 = (v) => [[L.outI, r2(v * 0.18)]];
const GG = { hsn: "8471", rate: 18 };

export const P1 = [
  // ---- May 2026: the outward supplies
  sale({ id: "S01", date: "20260501", no: "FC/26-27/001", p: P.alpha, value: 100000, ledger: L.salesG, g: { ...GG, nature: "Sales Taxable" }, tax: C9(100000), narr: "S01 B2B intra-state" }),
  sale({ id: "S02", date: "20260501", no: "FC/26-27/002", p: P.beta, value: 200000, ledger: L.salesG, g: { ...GG, nature: "Interstate Sales Taxable" }, tax: I18(200000), narr: "S02 B2B inter-state" }),
  sale({ id: "S03", date: "20260501", no: "FC/26-27/003", p: P.gamma, value: 150000, ledger: L.salesG, g: { ...GG, nature: "Sales to SEZ - Taxable" }, tax: I18(150000), narr: "S03 SEZ with payment of IGST" }),
  sale({ id: "S04", date: "20260501", no: "FC/26-27/004", p: P.delta, value: 80000, ledger: L.salesG, g: { ...GG, nature: "Sales to SEZ - LUT/Bond" }, narr: "S04 SEZ under LUT, without payment" }),
  sale({ id: "S05", date: "20260502", no: "FC/26-27/005", p: P.euro, value: 300000, ledger: L.salesG, g: { ...GG, nature: "Exports - Taxable" }, tax: I18(300000), pos: "", narr: "S05 export with payment of IGST" }),
  sale({ id: "S06", date: "20260502", no: "FC/26-27/006", p: P.euro, value: 250000, ledger: L.salesG, g: { ...GG, nature: "Exports - LUT/Bond" }, pos: "", narr: "S06 export under LUT, without payment" }),
  sale({ id: "S07", date: "20260502", no: "FC/26-27/007", p: P.retail, value: 150000, ledger: L.salesG, g: { ...GG, nature: "Interstate Sales Taxable" }, tax: I18(150000), narr: "S07 B2C large, inter-state" }),
  sale({ id: "S08", date: "20260502", no: "FC/26-27/008", p: P.cash, value: 40000, ledger: L.salesG, g: { ...GG, nature: "Sales Taxable" }, tax: C9(40000), narr: "S08 B2C small, intra-state" }),
  sale({ id: "S09", date: "20260502", no: "FC/26-27/009", p: P.walkin, value: 50000, ledger: L.salesG, g: { ...GG, nature: "Interstate Sales Taxable" }, tax: I18(50000), narr: "S09 B2C small, inter-state" }),
  sale({ id: "S10", date: "20260502", no: "FC/26-27/010", p: P.alpha, value: 30000, ledger: L.salesNil, g: { hsn: "0701", rate: 0, taxability: "Nil Rated", nature: "Sales Nil Rated" }, narr: "S10 nil-rated, intra-state, registered" }),
  sale({ id: "S11", date: "20260502", no: "FC/26-27/011", p: P.walkin, value: 20000, ledger: L.salesEx, g: { hsn: "0401", rate: 0, taxability: "Exempt", nature: "Interstate Sales Exempt" }, narr: "S11 exempt, inter-state, unregistered" }),
  sale({ id: "S12", date: "20260531", no: "FC/26-27/012", p: P.cash, value: 10000, ledger: L.salesG, g: { ...GG, nature: "Sales Taxable" }, tax: C9(10000), narr: "S12 to be cancelled" }),
  sale({ id: "S13", date: "20260531", no: "FC/26-27/013", p: P.cash, value: 5000, ledger: L.salesG, g: { ...GG, nature: "Sales Taxable" }, tax: C9(5000), narr: "S13 deleted after filing" }),
  sale({ id: "S14", date: "20260502", no: "OPT/001", p: P.alpha, value: 7000, ledger: L.salesG, g: { ...GG, nature: "Sales Taxable" }, tax: C9(7000), narr: "S14 optional (memorandum)", optional: true }),
  sale({ id: "S15", date: "20260502", no: "FC/26-27/014", p: P.iota, value: 100000, ledger: L.salesS, g: { hsn: "998314", rate: 18, supply: "Services", nature: "Interstate Sales Taxable" }, tax: I18(100000), narr: "S15 services, inter-state" }),
  creditNote({ id: "CN1", date: "20260502", no: "CN/001", p: P.alpha, value: 10000, ledger: L.salesG, g: { ...GG, nature: "Sales Taxable" }, tax: C9(10000), narr: "CN1 goods returned by Alpha (FC/26-27/001)" }),
  creditNote({ id: "CN2", date: "20260502", no: "CN/002", p: P.retail, value: 20000, ledger: L.salesG, g: { ...GG, nature: "Interstate Sales Taxable" }, tax: I18(20000), narr: "CN2 goods returned by a B2C large buyer (FC/26-27/007)" }),
  // a debit note to a customer: more value on FC/26-27/002 (the customer debited, sales and IGST credited)
  voucher({ id: "DN1", type: "Debit Note", date: "20260502", no: "DN/001", party: P.beta.name, narr: "DN1 price revision on FC/26-27/002", head: gstHead(P.beta),
    rows: [[P.beta.name, -5900], [L.salesG, 5000, gstLine({ ...GG, nature: "Interstate Sales Taxable" })], [L.outI, 900]] }),
  voucher({ id: "RV1", type: "Receipt", date: "20260502", no: "RV/001", party: P.iota.name, narr: "RV1 advance for services, not yet invoiced",
    rows: [[L.bank, -59000], [P.iota.name, 59000, `<BILLALLOCATIONS.LIST><NAME>ADV/IOTA/1</NAME><BILLTYPE>Advance</BILLTYPE><AMOUNT>59000.00</AMOUNT></BILLALLOCATIONS.LIST>`]] }),
  // ---- May 2026: the inward supplies
  purchase({ id: "P01", date: "20260501", no: "PUR/001", ref: "KS/101", p: P.kappa, value: 50000, ledger: L.purch, g: { ...GG, nature: "Purchase Taxable" }, tax: [[L.inC, 4500], [L.inS, 4500]], narr: "P01 purchase, intra-state, credit eligible" }),
  purchase({ id: "P02", date: "20260501", no: "PUR/002", ref: "LS/55", p: P.lambda, value: 100000, ledger: L.purch, g: { ...GG, nature: "Interstate Purchase Taxable" }, tax: [[L.inI, 18000]], narr: "P02 purchase, inter-state, credit eligible" }),
  purchase({ id: "P03", date: "20260502", no: "PUR/003", ref: "MU/7", p: P.mu, value: 50000, ledger: L.legal, g: { hsn: "998211", rate: 18, supply: "Services", nature: "Purchase From Unregistered Dealer - Taxable" },
    tax: [[L.inC, 4500], [L.inS, 4500]], rcm: [[L.rcmC, 4500], [L.rcmS, 4500]], isRcm: true, narr: "P03 legal services from an advocate, reverse charge" }),
  purchase({ id: "P04", date: "20260502", no: "PUR/004", ref: "NM/88", p: P.nu, value: 500000, ledger: L.car, g: { hsn: "8703", rate: 28, nature: "Purchase Taxable" }, tax: [[L.inC, 70000], [L.inS, 70000]],
    inelig: true, narr: "P04 motor car, credit blocked under section 17(5)" }),
  purchase({ id: "P05", date: "20260502", no: "PUR/005", ref: "XF/3", p: P.xi, value: 25000, ledger: L.purchEx, g: { hsn: "0701", rate: 0, taxability: "Exempt", nature: "Purchase Exempt" }, narr: "P05 exempt inward supply" }),
  voucher({ id: "DN2", type: "Debit Note", date: "20260502", no: "DN-P/001", ref: "KS/101", refDate: "20260501", party: P.kappa.name, narr: "DN2 goods returned to Kappa (KS/101)", head: gstHead(P.kappa),
    rows: [[P.kappa.name, -5900], [L.purch, 5000, gstLine({ ...GG, nature: "Purchase Taxable" })], [L.inC, 450], [L.inS, 450]] }),
  // ---- April-June 2026: TDS (quarter 1)
  tdsJournal({ id: "T01", date: "20260401", no: "JV/T01", p: P.omicron, exp: L.contract, amount: 100000, tdsLedger: L.tds194C, rate: 2, tds: 2000, narr: "T01 contract work, TDS 194C 2%" }),
  tdsJournal({ id: "T02", date: "20260401", no: "JV/T02", p: P.pi, exp: L.prof, amount: 60000, tdsLedger: L.tds194C, rate: 2, tds: 1200, narr: "T02 professional fees, booked under 194C by mistake" }),
  tdsJournal({ id: "T03", date: "20260401", no: "JV/T03", p: P.rho, exp: L.comm, amount: 40000, tdsLedger: L.tdsComm, rate: 2, tds: 800, narr: "T03 commission, TDS 2%" }),
  tdsJournal({ id: "T04", date: "20260401", no: "JV/T04", p: P.sigma, exp: L.rent, amount: 75000, tdsLedger: L.tdsRent, rate: 10, tds: 7500, narr: "T04 rent for the office, TDS 10%" }),
  tdsJournal({ id: "T05", date: "20260402", no: "JV/T05", p: P.tau, exp: L.goods, amount: 5500000, tdsLedger: L.tds194Q, rate: 0.1, tds: 500, narr: "T05 purchase of goods, TDS 194Q 0.1% on 5,00,000 above 50 lakh" }),
  tdsJournal({ id: "T06", date: "20260402", no: "JV/T06", p: P.upsilon, exp: L.interest, amount: 50000, tdsLedger: L.tds194A, rate: 10, tds: 5000, narr: "T06 interest on a loan, TDS 194A 10%" }),
  tdsJournal({ id: "T07", date: "20260402", no: "JV/T07", p: P.phi, exp: L.prof, amount: 40000, tdsLedger: L.tds194J, rate: 20, tds: 8000, narr: "T07 professional fees, no PAN: 20% (206AA)" }),
  tdsJournal({ id: "T08", date: "20260402", no: "JV/T08", p: P.chi, exp: L.prof, amount: 200000, tdsLedger: L.tds194J, rate: 1, tds: 2000, narr: "T08 technical services, lower deduction certificate 1%" }),
  tdsJournal({ id: "T09", date: "20260402", no: "JV/T09", p: P.psi, exp: L.contract, amount: 20000, narr: "T09 contract work below the threshold, no TDS" }),
  tdsJournal({ id: "T10", date: "20260501", no: "JV/T10", p: P.omega, exp: L.royalty, amount: 100000, tdsLedger: L.tds195, rate: 20.8, tds: 20800, narr: "T10 royalty to a non-resident, TDS 195 20.8%" }),
  tdsJournal({ id: "T11", date: "20260601", no: "JV/T11", p: P.emp, exp: L.salary, amount: 100000, tdsLedger: L.tds192, rate: 10, tds: 10000, narr: "T11 salary, TDS 192" }),
  // ---- June 2026: TCS
  sale({ id: "TC1", date: "20260601", no: "FC/26-27/015", p: P.scrap, value: 100000, ledger: L.scrapSales, g: { hsn: "7204", rate: 18, nature: "Sales Taxable" }, tax: C9(100000), extra: [[L.tcsScrap, 2360]], narr: "TC1 scrap sold, TCS 2% on 1,18,000" }),
  sale({ id: "TC2", date: "20260602", no: "FC/26-27/016", p: P.zeta, value: 100000, ledger: L.salesG, g: { ...GG, nature: "Sales Taxable" }, tax: C9(100000), extra: [[L.tcs1H, 118]], narr: "TC2 goods, TCS 206C(1H) 0.1% (omitted from 1-Apr-2025)" }),
  // ---- July 2026: the month the amendments are reported in
  sale({ id: "S20", date: "20260701", no: "FC/26-27/017", p: P.alpha, value: 10000, ledger: L.salesG, g: { ...GG, nature: "Sales Taxable" }, tax: C9(10000), narr: "S20 July sale" }),
];

// ---------------------------------------------------------------- after "filing": the amendments (phase 2)
// alter: the whole entry again with ACTION Alter (Tally's GUID as REMOTEID, filled in by the harness: @@GUID@@)
const byId = Object.fromEntries(P1.map((v) => [v.id, v]));
export const P2 = [
  { id: "S02", op: "alter", why: "invoice FC/26-27/002 revised after GSTR-1 of May was filed: 2,00,000 to 2,20,000",
    v: sale({ id: "S02", date: "20260501", no: "FC/26-27/002", p: P.beta, value: 220000, ledger: L.salesG, g: { ...GG, nature: "Interstate Sales Taxable" }, tax: I18(220000), narr: "S02 B2B inter-state (revised)" }) },
  { id: "CN1", op: "alter", why: "credit note CN/001 revised after filing: 10,000 to 12,000",
    v: creditNote({ id: "CN1", date: "20260502", no: "CN/001", p: P.alpha, value: 12000, ledger: L.salesG, g: { ...GG, nature: "Sales Taxable" }, tax: C9(12000), narr: "CN1 goods returned by Alpha (FC/26-27/001) (revised)" }) },
  { id: "T02", op: "alter", why: "TDS correction: professional fees moved from 194C (2%) to 194J (10%)",
    v: tdsJournal({ id: "T02", date: "20260401", no: "JV/T02", p: P.pi, exp: L.prof, amount: 60000, tdsLedger: L.tds194J, rate: 10, tds: 6000, narr: "T02 professional fees, corrected to 194J" }) },
  { id: "SIGMA", op: "ledger", why: "TDS correction: Sigma Landlord's PAN corrected from ABCPS1234F to ABCPS9999F",
    xml: `<LEDGER NAME="${P.sigma.name}" ACTION="Alter"><NAME>${P.sigma.name}</NAME><INCOMETAXNUMBER>${P.sigma.pan2}</INCOMETAXNUMBER></LEDGER>` },
  { id: "S13", op: "delete-keys", why: "invoice FC/26-27/013 (B2C small) deleted in Tally after filing", day: "31-5-2026", which: "END" },
];
// phase 1's own change after the entries: S12 cancelled on the screen (Alt+X), before filing
export const P1_KEYS = [{ id: "S12", op: "cancel-keys", why: "invoice FC/26-27/012 cancelled before filing", day: "31-5-2026", which: "HOME" }];

if (process.argv[2]) {
  const out = process.argv[2]; mkdirSync(out, { recursive: true });
  const w = (f, o) => writeFileSync(join(out, f), JSON.stringify(o, null, 1) + "\n");
  w("masters.json", { company: CO, gstin: COMPANY.gstin, steps: [["company", MASTERS.company], ["vchtypes", MASTERS.vchtypes], ["natures", MASTERS.natures], ["ledgers", MASTERS.ledgers]] });
  w("vouchers-p1.json", { company: CO, vouchers: P1.map((v) => ({ id: v.id, type: v.type, date: v.date, no: v.no, narr: v.narr, xml: v.xml })), keys: P1_KEYS });
  w("ops-p2.json", { company: CO, ops: P2.map((o) => ({ id: o.id, op: o.op, why: o.why, day: o.day, which: o.which, xml: o.v ? o.v.xml : o.xml, no: o.v ? o.v.no : undefined, type: o.v ? o.v.type : undefined, date: o.v ? o.v.date : undefined, narr: o.v ? o.v.narr : undefined })) });
  // the entries as entered (each ledger line's amount, Tally's sign), phase 1 and the phase 2 versions
  w("vouchers.json", { company: COMPANY, parties: P, ledgers: L, p1: P1.map(({ xml, ...v }) => v), p2: P2.map((o) => ({ id: o.id, op: o.op, why: o.why, ...(o.v ? (({ xml, ...v }) => v)(o.v) : {}) })) });
  console.log("written to " + out + ": " + P1.length + " entries, " + P2.length + " amendments; company GSTIN " + COMPANY.gstin);
}
