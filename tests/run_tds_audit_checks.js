// node run_tds_audit_checks.js - the TDS check of 22-Oct-2026 (scratchpad tds-audit), the checks and the file. Each part
// shaped like what the audit found (Leads Insurance, Testing AAD); names and figures made up or as the audit gives them.
//   N2  the ledger check never calls a TDS ledger under Duties & Taxes (or credited on bills) receivable from its line counts
//       (Testing AAD "TDS 194 T"; Leads "TDS on Rent 94I", 19 Dr / 18 Cr); a receivable one with deductions is said
//   N10 remark C only with the higher rate (no PAN at 1%: no remark)
//   M5  a PAN's 4th letter is the holder's status (P, C, H, F, A, T, B, L, J, G): "ABCDE1234F" is no PAN
//   M1  271H: a month after the due date for a statement due from 1-Apr-2025 (a year before)
//   M7  FY 2024-25 at that year's rates and limits (194H 5% before 1-Oct-2024; 194J limit 30,000)
//   L3  194C's single-bill limit is the bill's (two lines of 20,000)
//   N7  rent on a 194H ledger: "the section looks wrong", no rate question (Testing AAD, FA/2026-27/081)
//   M8  Tally's nature of payment at 2020-21's reduced rates (Leads: Contractor 0.75% / 1.50%) is said
//   M9  one PAN under two names is one deductee
//   M4  a nil deduction with remark T or Y is in the file; B is not written yet
//   L1  the working Excel: the file's deductee code and the date paid or credited
//   N13 N14 N12 notes
"use strict";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "money", "MONTHS", "MONTHS3", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend",
  "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gramsOf", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "AS26", "GSTCMP", "GSTAPI", "TDSRate", "TDSInt", "TDSSep", "GSTIN_RE", "TDSFiled", "ClosedP",
  "BOOKS_KEYS", "AuditWP", "TDSWatch", "TDSTally", "noPanRate", "NO_PAN_RATE", "AIH", "istParts", "p2ist", "istDay", "istToday", "TDSAdj", "TDSReg", "TDSCH", "Payroll", "TDS24Q", "TDSAudit", "TDSMatch",
  "TDS26Q", "TDS_FORMS", "TCS27EQ", "PAY_CODES", "TDS_SEC_CODES", "uid", "LedCheck", "TDSPanFix", "PANCheck", "TDSAdd", "NEW_FORMS_VALIDATED"];
const avail = NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } });
const {ctx, x} = load(HTML, avail);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
Object.assign(ctx, {saveBooks: () => {}, whoAmI: () => "t", render: () => {}, toast: () => {}, istToday: () => "20261022"});
ctx.S.data = {};
let n = 0;
const V = (o) => Object.assign({id: "k" + (++n), no: "", ref: "", party: "", narr: "", upd: o.date}, o);
const UNDER = {"TDS 194 T": "TDS", "TDS": "Duties & Taxes", "TDS on Rent 94I": "TDS", "TDS 94H": "TDS", "TDS 94C": "TDS", "TDS 94J": "TDS", "DBS BANK(513)": "Bank Accounts", "Rent": "Indirect Expenses",
  "Freight": "Indirect Expenses", "Commission": "Indirect Expenses", "Fees": "Indirect Expenses", "Legal & Professional Fees": "Indirect Expenses", "Fingate Advisory Services Limited": "Sundry Debtors", "Roadways": "Sundry Creditors",
  "Rent Payable Alok Swarup Gupta": "Current Liabilities", "ALOK SWAROOP GUPTA": "Sundry Creditors", "Agent One": "Sundry Creditors", "Partner Firm": "Sundry Creditors", "INPUT CGST": "Duties & Taxes", "INPUT IGST": "Duties & Taxes"};
const GROUPS = {"Sundry Creditors": "Current Liabilities", "Sundry Debtors": "Current Assets", "Duties & Taxes": "Current Liabilities", "TDS": "Duties & Taxes", "Indirect Expenses": "", "Bank Accounts": "Current Assets", "Current Liabilities": "", "Current Assets": ""};
const MAP = {"TDS on Rent 94I": {kind: "tds_payable", section: "194I", rate: 10}, "TDS 94H": {kind: "tds_payable", section: "194H"}, "TDS 94C": {kind: "tds_payable", section: "194C"}, "TDS 94J": {kind: "tds_payable", section: "194J"},
  "TDS 194 T": {kind: "tds_receivable", what: "tds_receivable", section: "194T"}, "DBS BANK(513)": {kind: "bank"}, "INPUT CGST": {kind: "gst", tax: "CGST", side: "input", reg: "09"}, "INPUT IGST": {kind: "gst", tax: "IGST", side: "input", reg: "09"}};
const co = {id: "ck", name: "TDS Checks Fixture", pan: "AABFT1234T", tan: "DELT12345A"};
ctx.S.coId = "ck"; ctx.S.companies = {ck: co}; ctx.CO = () => co;
function books(vs, o){
  o = o || {};
  const b = {cid: "ck", vouchers: vs, meta: {from: "20240401", to: "20270331", bills: 1}, under: UNDER, groups: GROUPS, ledInfo: Object.fromEntries(Object.keys(UNDER).map(l => [l, {ob: 0, from: "20240401"}])),
    pans: Object.assign({"Fingate Advisory Services Limited": "AADCF5445J", "ALOK SWAROOP GUPTA": "AAAPG1234A", "Rent Payable Alok Swarup Gupta": "AAAPG1234A", "Agent One": "AAAPA1234A", "Partner Firm": "AABFP1234P"}, o.pans || {}),
    challans: o.challans || [], alloc: o.alloc || {}, certs: [], tdsAdded: o.added || {}, tdsNat: o.nat || {}};
  ctx.S.books = b;
  const m = {}; Object.entries(MAP).forEach(([k, v]) => { m[k] = Object.assign({byHand: true, ok: true}, v); });
  b.map = x.Books.mapLedgers(vs, m);
  x.TDSReg.forget();
  return b;
}

// ---------------------------------------------------------------- N2
{
  books([]);
  const use = (dr, cr, purch, pay) => ({n: dr + cr, dr, cr, sale: 0, purch, cn: 0, dn: 0, pay, setoff: 0, other: 0});
  const a = x.LedCheck.suggest(ctx.S.books, "TDS 194 T", use(1, 0, 0, 1));
  ok(a.what === "tds_payable", "N2: \"TDS 194 T\" under TDS (Duties & Taxes), 1 Dr / 0 Cr: TDS payable, not receivable (" + a.what + ")");
  const r = x.LedCheck.suggest(ctx.S.books, "TDS on Rent 94I", use(19, 18, 18, 16));
  ok(r.what === "tds_payable", "N2: \"TDS on Rent 94I\", 19 Dr / 18 Cr (16 bank payments): TDS payable (" + r.what + ")");
  const bill = V({type: "Journal", date: "20250410", no: "T-1", party: "Agent One", ent: [{l: "Commission", a: -50000}, {l: "TDS 194 T", a: 5000}, {l: "Agent One", a: 45000}]});
  books([bill]);
  const notes = x.TDSAudit.notes("2025-26", "Q1", "26Q").filter(z => z.k === "recv");
  ok(notes.length === 1 && /TDS 194 T/.test(notes[0].words), "N2: a TDS ledger kept as receivable but credited on a bill: said on 26Q (" + (notes[0] && notes[0].words) + ")");
}
// ---------------------------------------------------------------- N10, M5
{
  ok(x.TDS26Q.remark({pan: "PANNOTAVBL", rate: 1, section: "194C", tds: 100}, "26Q").remark === "", "N10: no PAN, deducted at 1%: no remark C");
  ok(x.TDS26Q.remark({pan: "PANNOTAVBL", rate: 20, section: "194C", tds: 2000}, "26Q").remark === "C", "N10: no PAN, deducted at 20%: remark C");
  ok(x.TDS26Q.remark({pan: "", rate: 5, section: "194Q", tds: 500}, "26Q").remark === "C", "N10: 194Q with no PAN at 5%: remark C");
  ok(!x.Certs.validPan("ABCDE1234F") && x.Certs.validPan("ABCPE1234F") && x.Certs.validPan("AADCF5445J"), "M5: a PAN's 4th letter must be a status letter (ABCDE1234F is refused)");
}
// ---------------------------------------------------------------- M1
{
  const b = books([V({type: "Journal", date: "20250410", no: "J1", party: "Agent One", ent: [{l: "Fees", a: -100000}, {l: "TDS 94J", a: 10000}, {l: "Agent One", a: 90000}]}),
    V({type: "Journal", date: "20240410", no: "J0", party: "Agent One", ent: [{l: "Fees", a: -100000}, {l: "TDS 94J", a: 10000}, {l: "Agent One", a: 90000}]})]);
  const f = x.TDS.lateFee("2025-26", "Q1", "20250915", "26Q");
  ok(f && f.penaltyBy === "20250831" && f.penaltyIn === "a month" && f.p271h, "M1: due 31-Jul-2025: 271H after 31-Aug-2025 (a month); filed 15-Sep: a penalty can be levied (" + JSON.stringify(f && [f.penaltyBy, f.penaltyIn, f.p271h]) + ")");
  const g = x.TDS.lateFee("2024-25", "Q1", "20240915", "26Q");
  ok(g && g.penaltyBy === "20250731" && g.penaltyIn === "a year" && !g.p271h, "M1: due 31-Jul-2024: a year, as before (" + JSON.stringify(g && [g.penaltyBy, g.penaltyIn]) + ")");
}
// ---------------------------------------------------------------- M7
{
  const h = V({type: "Journal", date: "20240715", no: "H-1", party: "Agent One", ent: [{l: "Commission", a: -20000}, {l: "TDS 94H", a: 1000}, {l: "Agent One", a: 19000}]});
  const j = V({type: "Journal", date: "20240720", no: "J-24", party: "Partner Firm", ent: [{l: "Legal & Professional Fees", a: -35000}, {l: "Partner Firm", a: 35000}]});
  books([h, j]);
  const r = x.TDS.allRows().find(z => z.id.startsWith(h.id + "|"));
  ok(r && r.paid === 20000 && r.rate === 5, "M7: 194H in July 2024 at that time's 5%: paid 20,000 at 5% (" + JSON.stringify(r && [r.paid, r.rate]) + ")");
  ok(!x.Certs.issues("2024-25", "Q2").some(i => i.row.id === r.id), "M7: no rate question for it (2% is from 1-Oct-2024)");
  const w = x.TDSWatch.year("2024-25").filter(z => z.party === "Partner Firm");
  ok(w.length === 1 && w[0].over, "M7: FY 2024-25 194J limit 30,000: a 35,000 fee crosses it (" + JSON.stringify(w.map(z => [z.credited, z.over, z.limitWords])) + ")");
}
// ---------------------------------------------------------------- L3
{
  const two = V({type: "Journal", date: "20250610", no: "F-1", party: "Roadways", ent: [{l: "Freight", a: -20000}, {l: "Freight", a: -20000}, {l: "Roadways", a: 40000}]});
  books([two]);
  const w = x.TDSWatch.year("2025-26").filter(z => z.party === "Roadways");
  ok(w.length === 1 && w[0].over, "L3: a bill of two freight lines of 20,000 is one bill of 40,000: over 194C's 30,000 a bill (" + JSON.stringify(w.map(z => [z.credited, z.over])) + ")");
}
// ---------------------------------------------------------------- N7
{
  const fa = V({type: "Journal", date: "20260701", no: "FA/2026-27/081", party: "Fingate Advisory", narr: "for Rent Receivable | TDSDesk:x", ent: [{l: "Rent", a: -105000}, {l: "INPUT CGST", a: -9450}, {l: "INPUT IGST", a: -9450},
    {l: "Fingate Advisory Services Limited", a: 113400}, {l: "TDS 94H", a: 10500}]});
  books([fa]);
  const iss = x.Certs.issues("2026-27", "Q2");
  ok(!iss.some(i => /excess|should be 2%/i.test(i.why || "") || i.expected === 2), "N7: no \"rate 10% should be 2%\" for rent on a 194H ledger (" + JSON.stringify(iss.map(i => [i.expected, i.why])) + ")");
  const notes = x.TDSAudit.notes("2026-27", "Q2", "26Q").filter(z => z.k === "secpay");
  ok(notes.length === 1 && /Rent booked under 194H/.test(notes[0].words) && /194I/.test(notes[0].words), "N7: \"Rent booked under 194H … 194I?\" (" + (notes[0] && notes[0].words) + ")");
}
// ---------------------------------------------------------------- M8
{
  books([], {nat: {"Contractor": {cats: [["20180401", "194C", "1", "2", "0", "0", "", ""], ["20200514", "194C", "0.75", "1.50", "0", "0", "", ""]]}, "Rent": {cats: [["20180401", "194I", "10", "10", "0", "0", "", ""]]}}});
  const notes = x.TDSAudit.notes("2025-26", "Q1", "26Q").filter(z => z.k === "natrate");
  ok(notes.length === 1 && /Contractor/.test(notes[0].words) && /0.75/.test(notes[0].words), "M8: Tally's \"Contractor\" at 0.75% / 1.50% is said; \"Rent\" at 10% is not (" + notes.map(z => z.words).join(" | ") + ")");
}
// ---------------------------------------------------------------- M9
{
  const a = V({type: "Journal", date: "20250401", no: "ASG/25-26/001", party: "", ent: [{l: "Rent", a: -69430}, {l: "TDS on Rent 94I", a: 6943}, {l: "Rent Payable Alok Swarup Gupta", a: 62487}]});
  const c = V({type: "Journal", date: "20250501", no: "ASG/25-26/002", party: "ALOK SWAROOP GUPTA", ent: [{l: "Rent", a: -69430}, {l: "TDS on Rent 94I", a: 6943}, {l: "ALOK SWAROOP GUPTA", a: 62487}]});
  books([a, c]);
  const L = x.TDSPanFix.list("26Q", "2025-26", "Q1"), al = L.filter(p => p.pan === "AAAPG1234A");
  ok(al.length === 1 && al[0].n === 2 && al[0].aka.length === 1, "M9: \"Rent Payable Alok Swarup Gupta\" and \"ALOK SWAROOP GUPTA\", one PAN: one deductee (" + JSON.stringify(L.map(p => [p.party, p.pan, p.n, p.aka])) + ")");
}
// ---------------------------------------------------------------- M4
{
  const b = books([V({type: "Journal", date: "20250610", no: "R-1", party: "Roadways", ent: [{l: "Freight", a: -50000}, {l: "TDS 94C", a: 1000}, {l: "Roadways", a: 49000}]})],
    {pans: {"Roadways": "AAAPR1234R", "Small Transport": "AAAPS1234S", "Other Co": "AABCO1234O"}, challans: [{id: "chq", bsr: "0510308", serial: "00011", date: "20250707", tax: 1000, interest: 0, section: "194C", minorHead: "200"}],
      added: {t1: {party: "Small Transport", section: "194C", date: "20250615", paid: 80000, tds: 0, rate: 0, basis: "T"}, y1: {party: "Other Co", section: "194J", date: "20250620", paid: 20000, tds: 0, rate: 0, basis: "Y"},
        b1: {party: "Other Co", section: "194A", date: "20250625", paid: 9000, tds: 0, rate: 0, basis: "B"}}});
  b.alloc[ctx.S.books.vouchers[0].id + "|TDS 94C"] = "chq"; x.TDSReg.forget();
  const f = x.TDS26Q.build("2025-26", "Q1", {tan: "DELT12345A", pan: "AABFT1234T", name: "T", deductorType: "F"}, "26Q");
  const dd = String(f.text || "").split("\r\n").filter(l => /\^DD\^/.test(l)).map(l => l.split("^"));
  const rem = dd.map(a => a[29]);
  ok(rem.includes("T") && rem.includes("Y") && !rem.includes("B"), "M4: the nil deductions with remarks T and Y are in the file; B is not written yet (" + JSON.stringify(rem) + " " + (f.error || "") + ")");
  ok(f.nilOut === 1, "M4: the one left out (B) is counted (" + f.nilOut + ")");
}
// ---------------------------------------------------------------- L1
{
  const r1 = V({type: "Journal", date: "20250610", no: "L-1", party: "Agent One", ent: [{l: "Commission", a: -50000}, {l: "TDS 94H", a: 1000}, {l: "Agent One", a: 49000}]});
  books([r1]);
  let sheets = {};
  ctx.ensureXlsx = async () => {}; ctx.saveFile = () => {};
  ctx.XLSX = {utils: {book_new: () => ({}), aoa_to_sheet: (a) => a, book_append_sheet: (wb, sh, nm) => { sheets[nm] = sh; }}, write: () => []};
  ctx.Blob = class {};
  x.TDS.toExcel("2025-26", "Q1", "26Q").then(() => {
    const d = sheets.Deductees || [], row = d[1] || [];
    ok(d[0] && d[0][1] === "Deductee code" && row[1] === "2", "L1: the deductee code as the file writes it for 26Q (2, not 02) (" + row[1] + ")");
    ok(d[0] && d[0][5] === "Date of payment or credit" && row[5] === "10/06/2025", "L1: the date paid or credited (" + row[5] + ")");
    finish();
  }).catch(e => { ok(false, "L1: " + e.message); finish(); });
}
function finish(){
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
}
