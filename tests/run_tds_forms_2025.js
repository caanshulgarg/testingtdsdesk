// node run_tds_forms_2025.js - Forms 138, 140, 143 and 144 (Income-tax Act, 2025) as Protean's file format has them
// (next-tds-forms-2025, 17-Oct-2026). The authority: Protean's file-format workbooks version 1.1 of 22-07-2026, which the
// owner uploaded, extracted as they are to tests/fixtures/tds-forms-2025/spec-<form>.json (extract_spec.py), and the
// Gazette forms; docs/tds-forms-2025/<form>.md has them field by field.
//   S  each form, built by the app's own code (the built site-test/index.html, or TDSDESK_HTML) from made-up books for
//      Q1 of tax year 2026-27, is checked record by record against the workbook: the number of fields of each record,
//      every field's type and size, "not applicable" fields empty, mandatory fields filled, the constants, the section
//      codes against the form's Annexure 2, and the totals that tie the records together
//   V  the values worked out here by hand: the challan as deposited, the deductees, the codes, the dates
//   G  the owner's samples from Protean's RPU 1.0 (06-05-2026, test data, scratchpad forms-samples): FinCom fed the same
//      inputs writes the same line, field for field, but for the fields listed in KNOWN with the reason (each one a
//      question for the owner in docs/tds-forms-2025/GAPS.md)
//   O  up to tax year 2025-26 the old 24Q / 26Q / 27Q / 27EQ files are made as before
"use strict";
const fs = require("fs"), path = require("path");
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const {load, HTML, OUT} = require("./harness");
// each file checked is kept in tests/out/forms2025/ (F138.txt …) for Protean's FVU 1.2 (run_fvu12_forms.py)
const KEEP = path.join(OUT, "forms2025"); fs.mkdirSync(KEEP, {recursive: true});
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "TDS", "Certs", "TDS26Q", "TDS_FORMS", "TCS27EQ", "PAY_CODES",
  "NEW_FORMS_VALIDATED", "noPanRate", "NO_PAN_RATE", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "TDSCH", "TDSRate", "TDSLdc", "TDSWatch", "TDSFiled", "TDSInt", "AIH", "Payroll",
  "PayTax", "TDS24Q", "TDS24Q_FILE", "TDSReg", "TRF", "istParts", "p2ist", "istDay", "istToday", "TDS_SEC_CODES", "TDSF25"];
const have = NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } });
const {ctx, x} = load(HTML, have);
ctx.S.companies = {t: {id: "t", name: "Co"}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t; ctx.saveBooks = () => {}; ctx.whoAmI = () => "t";
let u = 0; ctx.uid = (p) => (p || "id") + (++u); ctx.D = () => ({parties: {}}); ctx.render = () => {}; ctx.toast = () => {}; ctx.money = (a) => "₹" + a;
ctx.Cloud = {on: () => false}; ctx.ClosedP = {cfg: () => ({})}; ctx.lsGet = () => null; ctx.lsSet = () => {};
const fails = [];
function ok(c, w){ console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails.push(w); }
const J = JSON.stringify;
const SPEC = {}, FORMNO = {"24Q": "138", "26Q": "140", "27EQ": "143", "27Q": "144"};
Object.keys(FORMNO).forEach(k => { SPEC[k] = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "tds-forms-2025", "spec-" + FORMNO[k] + ".json"), "utf8")); });
const build = (fy, q, firm, form) => form === "24Q" ? x.TDS24Q_FILE.build(fy, q, firm) : x.TDS26Q.build(fy, q, firm, form);
const recs = (t) => String(t || "").split("\r\n").filter(Boolean).map(l => l.split("^"));
const of = (t, rec) => recs(t).filter(f => f[1] === rec);
if (!have.includes("TDSF25")) ok(false, "the app has a builder for the forms of the Act of 2025 (TDSF25, src/js/83)");

// ---------------- the made-up books
const V = (id, date, party, exp, tds, led, expLed) => ({id, date, type: "Journal", no: id, party, ent: [{l: party, a: exp - tds}, {l: led, a: tds}, {l: expLed || "Exp", a: -exp}]});
function books(vs, extra){
  const b = Object.assign({cid: "t", vouchers: vs, map: {"TDS 194C": {kind: "tds_payable", section: "194C"}, "TDS 194J": {kind: "tds_payable", section: "194J"}, "TDS 194I": {kind: "tds_payable", section: "194I"},
    "TDS 195": {kind: "tds_payable", section: "195"}, "TDS 194LC": {kind: "tds_payable", section: "194LC"}, "TCS Scrap": {kind: "tcs_payable", section: "206C"}, "Bank": {kind: "bank"}},
    challans: [], alloc: {}, certs: [], pans: {"Alpha Ltd": "AAACA1234A", "Beta": "ABCPB1234B", "Gamma": "ABCPG1234G", "Delta": "ABCHD1234D"}, nrInfo: {}}, extra || {});
  ctx.S.books = b; return b;
}
const FIRM = {tan: "BLRF02329F", pan: "AAAFF1234F", name: "Fixture Traders", flat: "12 First Floor", road: "MG Road", area: "Karol Bagh", town: "New Delhi", state: "Delhi", pin: "110005",
  email: "accounts@fixture.example", phone: "9811111111", person: "Ravi Kumar", personDesignation: "Partner", personPan: "ABCPK1234K", personFlat: "12 First Floor",
  personRoad: "MG Road", personArea: "Karol Bagh", personTown: "New Delhi", personState: "Delhi", personPin: "110005", personEmail: "ravi@fixture.example", personPhone: "9822222222"};

// ---------------- S: every record against the workbook
const NA = (f) => f.type === "NA" || /not applicable|^filler|for future use|used for verification/i.test(f.name) || /^no value (should|to) be specified/i.test(f.remarks);
const CONST = {FH: {2: "FH", 4: "R", 7: "D"}, BH: {2: "BH", 3: "1"}, CD: {2: "CD", 3: "1", 6: "N"}, DD: {2: "DD", 3: "1", 6: "O"}};
const FILETYPE = {"24Q": "SL1", "26Q": "NS1", "27Q": "NS1", "27EQ": "TC1"};
const validDate = (s) => /^\d{8}$/.test(s) && (() => { const d = new Date(s.slice(4, 8) + "-" + s.slice(2, 4) + "-" + s.slice(0, 2) + "T00:00:00Z"); return !isNaN(d) && d.getUTCDate() === +s.slice(0, 2); })();
function against(form, text, label){
  const sp = SPEC[form], bad = [];
  fs.writeFileSync(path.join(KEEP, "F" + FORMNO[form] + ".txt"), String(text || ""));
  const lines = recs(text);
  lines.forEach((fs_, i) => {
    const rec = fs_[1], R = sp.records[rec];
    if (!R){ bad.push("line " + (i + 1) + ": record type " + rec + " is not in the workbook"); return; }
    if (fs_.length !== R.fields.length) bad.push(rec + " line " + (i + 1) + ": " + fs_.length + " fields, the workbook has " + R.fields.length + " (" + (R.fields.length - 1) + " carets)");
    if (+fs_[0] !== i + 1) bad.push(rec + " line " + (i + 1) + ": line number " + fs_[0]);
    R.fields.forEach(f => {
      const v = fs_[f.no - 1] == null ? "" : fs_[f.no - 1], where = rec + " line " + (i + 1) + " field " + f.no + " (" + f.name + ")";
      // Protean's FVU 1.2 over the workbook: Form 138's BH field 49 (Count of Salary Details Records) is 0 for Q1 to Q3
      if (form === "24Q" && rec === "BH" && f.no === 49){ if (v !== "0") bad.push(where + ": FVU 1.2 wants 0, is \u201c" + v + "\u201d"); return; }
      if (NA(f)){ if (v !== "") bad.push(where + ": must be empty, is “" + v + "”"); return; }
      const c = (CONST[rec] || {})[f.no];
      if (c != null && v !== c) bad.push(where + ": must be " + c + ", is “" + v + "”");
      if (f.mo === "M" && v === "" && !(rec === "DD" && f.no === 27 && Number(fs_[23]) === 0)) bad.push(where + ": mandatory, empty");
      if (v === "") return;
      const size = Number(f.size), type = f.type.trim();
      if (/[\^\r\n]/.test(v) || /[^\x20-\x7E]/.test(v)) bad.push(where + ": not plain ASCII");
      if (type === "DATE" || (type === "DECIMAL" && /date/i.test(f.name))){ if (!validDate(v)) bad.push(where + ": not a ddmmyyyy date (" + v + ")"); return; }
      if (type === "INTEGER"){ if (!/^\d+(\.00)?$/.test(v)) bad.push(where + ": not a whole number (" + v + ")"); if (size && v.replace(/\.00$/, "").length > size) bad.push(where + ": longer than " + size); return; }
      if (type === "DECIMAL"){ if (!(/rate/i.test(f.name) ? /^\d+\.\d{4}$/.test(v) || v === "0.00" : /^\d+\.\d{2}$/.test(v))) bad.push(where + ": not a decimal of the workbook's form (" + v + ")"); if (size && v.length > size) bad.push(where + ": longer than " + size); return; }
      if (size && v.length > size) bad.push(where + ": longer than " + size + " (" + v.length + ")");
    });
  });
  // the file as a whole: one FH, one BH, records in order; the constants of the form; the totals that tie it together
  const fh = lines.filter(l => l[1] === "FH"), bh = lines.filter(l => l[1] === "BH"), cds = lines.filter(l => l[1] === "CD"), dds = lines.filter(l => l[1] === "DD");
  if (fh.length !== 1 || bh.length !== 1 || lines[0][1] !== "FH" || lines[1][1] !== "BH") bad.push("one FH, then one BH");
  if (fh[0] && (fh[0][2] !== FILETYPE[form] || fh[0][8] !== "1")) bad.push("FH: file type " + FILETYPE[form] + " and 1 batch (" + (fh[0] || []).slice(2, 9) + ")");
  if (bh[0] && bh[0][4] !== FORMNO[form]) bad.push("BH field 5: form number " + FORMNO[form] + " (" + bh[0][4] + ")");
  if (bh[0] && +bh[0][3] !== cds.length) bad.push("BH field 4: " + cds.length + " challans (" + bh[0][3] + ")");
  const cents = (v) => Math.round(Number(v || 0) * 100);
  if (bh[0] && cents(bh[0][46]) !== cds.reduce((a, c) => a + cents(c[11]), 0)) bad.push("BH field 47: the sum of CD field 12");
  const codes = (sp.annexures.find(a => /^Annexure - 2$/.test(a.name)) || {rows: []}).rows.map(r => r.cells[r.cells.length - 1]).filter(c => /^\d{4}$/.test(c));
  cds.forEach(c => {
    const mine = dds.filter(d => d[4] === c[3]);
    if (+c[4] !== mine.length) bad.push("CD " + c[3] + " field 5: " + mine.length + " deductees (" + c[4] + ")");
    if (cents(c[11]) !== cents(c[7]) + cents(c[8]) + cents(c[9]) + cents(c[10])) bad.push("CD " + c[3] + " field 12 = 8 + 9 + 10 + 11");
    if (cents(c[20]) !== mine.reduce((a, d) => a + cents(d[24]), 0)) bad.push("CD " + c[3] + " field 21: the sum of DD field 25");
    if (cents(c[21]) !== mine.reduce((a, d) => a + cents(d[23]), 0)) bad.push("CD " + c[3] + " field 22: the sum of DD field 24");
    if (c[23] !== c[8] || c[24] !== c[10]) bad.push("CD " + c[3] + " fields 24, 25: as fields 9, 11 (" + [c[23], c[24], c[8], c[10]] + ")");
    if (cents(c[11]) < cents(c[20]) + cents(c[23]) + cents(c[24]) + (c[12] === "C" ? cents(c[9]) : 0)) bad.push("CD " + c[3] + " field 12: not less than the deductees' tax + the allocations (+ the fee)");
  });
  dds.forEach((d, i) => {
    const k = dds.slice(0, i + 1).filter(z => z[4] === d[4]).length;
    if (+d[3] !== k) bad.push("DD " + (i + 1) + " field 4: numbered from 1 under its challan, as FVU 1.2 wants (" + d[3] + ")");
    if (d[23] !== d[24]) bad.push("DD " + (i + 1) + " fields 24 and 25 equal");
    if (codes.length && !codes.includes(d[14])) bad.push("DD " + (i + 1) + " field 15: " + d[14] + " is not in Annexure 2");
  });
  ok(!bad.length, "S. " + label + ": every record and field as the workbook has them (" + lines.length + " lines)" + (bad.length ? "\n         " + bad.slice(0, 12).join("\n         ") + (bad.length > 12 ? "\n         … " + (bad.length - 12) + " more" : "") : ""));
  return lines;
}
// the same statement as a State Government's, its challans by book adjustment (CD field 13 "B"), kept as V<form>.txt: a
// book adjustment needs no challan file (.csi), so Protean's FVU 1.2 checks every deductee record of it; without the .csi
// (which only TIN / the e-filing portal give) FVU 1.2 stops at the challans of a "C" file (T-FV-1041)
function fvuCopy(form){
  const keep = JSON.stringify(ctx.S.books.challans);
  // a transfer voucher is dated the last day of its month and numbered by its Form 24G receipt (FVU 1.2, T_FV_3157, T-FV-3149)
  const monthEnd = (d) => { const y = +d.slice(0, 4), m = +d.slice(4, 6); return d.slice(0, 6) + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0"); };
  ctx.S.books.challans.forEach((c, i) => { c.mode = "B"; c.minorHead = ""; c.date = monthEnd(c.date); c.bsr = ["2000090", "3000012", "4000013"][i % 3]; });
  const r = build("2026-27", "Q1", Object.assign({}, FIRM, {deductorType: "S", stateName: "Delhi", ain: "1091650"}), form);
  fs.writeFileSync(path.join(KEEP, "V" + FORMNO[form] + ".txt"), r.text || "");
  ctx.S.books.challans = JSON.parse(keep);
}
const field = (line, n) => (line || [])[n - 1];
const fieldsAre = (line, want, label) => {
  const diff = Object.keys(want).filter(k => field(line, +k) !== want[k]).map(k => k + ": " + J(field(line, +k)) + " not " + J(want[k]));
  ok(!diff.length, label + (diff.length ? " (" + diff.join("; ") + ")" : ""));
};

// ---------------- Form 140 (26Q)
let b = books([V("v1", "20260510", "Alpha Ltd", 100000, 2000, "TDS 194C", "Contract Charges"), V("v2", "20260512", "Beta", 100000, 10000, "TDS 194J", "Professional Fees"),
  V("v3", "20260515", "Gamma", 50000, 1000, "TDS 194I", "Machinery Hire Charges"), V("v4", "20260601", "Delta", 50000, 500, "TDS 194C", "Contract Charges")]);
b.challans = [{id: "c1", bsr: "0240020", serial: "00011", date: "20260607", tax: 13000, interest: 0}, {id: "c2", bsr: "0240020", serial: "00012", date: "20260705", tax: 500, interest: 15}];
b.alloc = {"v1|TDS 194C": "c1", "v2|TDS 194J": "c1", "v3|TDS 194I": "c1", "v4|TDS 194C": "c2"};
let f = build("2026-27", "Q1", FIRM, "26Q");
ok(!f.error && f.formNo === "140" && /_Form140_Q1_202627/.test(f.name || ""), "V. Form 140 for Q1 2026-27 is made (" + (f.error || f.name) + ")");
let L = against("26Q", f.text, "Form 140");
fvuCopy("26Q");
fieldsAre(of(f.text, "FH")[0], {3: "NS1", 8: "BLRF02329F", 9: "1", 10: "FinCom"}, "V. 140 FH: NS1, the TAN, one batch, the utility's name");
fieldsAre(of(f.text, "BH")[0], {4: "2", 5: "140", 13: "BLRF02329F", 15: "AAAFF1234F", 16: "202728", 17: "202627", 18: "Q1", 19: "Fixture Traders", 20: "INDIA", 21: "12 First Floor", 23: "MG Road",
  24: "Karol Bagh", 25: "New Delhi", 26: "09", 27: "110005", 28: "accounts@fixture.example", 29: "91", 30: "9811111111", 32: "F", 33: "Ravi Kumar", 34: "Partner", 40: "09", 41: "110005",
  42: "ravi@fixture.example", 43: "INDIA", 44: "91", 45: "9822222222", 47: "13515.00", 52: "N", 59: "ABCPK1234K", 9: "", 54: "", 68: ""},
  "V. 140 BH: AY 202728 before tax year 202627, Delhi as 09, the category F from the PAN, two challans totalling 13,515.00, no earlier statement (Q1 2026-27)");
const cd = of(f.text, "CD");
fieldsAre(cd[0], {4: "1", 5: "3", 8: "13000.00", 9: "0.00", 10: "0.00", 11: "0.00", 12: "13000.00", 13: "C", 15: "0240020", 17: "00011", 19: "07062026", 21: "13000.00", 22: "13000.00", 23: "200", 24: "0.00", 25: "0.00"},
  "V. 140 CD 1: the challan as deposited, three deductees, its date 07-06-2026");
fieldsAre(cd[1], {4: "2", 5: "1", 8: "500.00", 9: "15.00", 12: "515.00", 17: "00012", 19: "05072026", 21: "500.00", 24: "15.00"}, "V. 140 CD 2: a July challan that pays a June deduction, with its interest");
const dd = of(f.text, "DD");
fieldsAre(dd[0], {4: "1", 5: "1", 8: "AAACA1234A", 9: "Alpha Ltd", 15: "1024", 18: "Y", 19: "10052026", 20: "100000.00", 24: "2000.00", 25: "2000.00", 27: "10052026", 28: "2.0000"}, "V. 140 DD: 194C to a company is 1024 at 2%");
fieldsAre(dd[1], {4: "2", 15: "1027", 28: "10.0000"}, "V. 140 DD: professional fees (194J) is 1027 at 10%");
fieldsAre(dd[2], {4: "3", 15: "1008", 28: "2.0000"}, "V. 140 DD: hire of machinery (194-I) is 1008 at 2%");
fieldsAre(dd[3], {4: "1", 5: "2", 8: "ABCHD1234D", 15: "1023", 20: "50000.00", 24: "500.00", 28: "1.0000"}, "V. 140 DD: 194C to an HUF (PAN's 4th letter H) is 1023 at 1%, under the second challan");
if (x.TRF){
  const cs = x.TRF.parseConso(f.text), c0 = cs.cd[0] || {}, r3 = cs.rows[3] || {};
  ok(cs.form === "26Q" && cs.fy === "2026-27" && cs.q === "Q1" && cs.tan === "BLRF02329F" && cs.cd.length === 2 && c0.bsr === "0240020" && c0.serial === "00011" && c0.date === "20260607" && c0.consumed === 13000 &&
    r3.challan === "2" && r3.pan === "ABCHD1234D",
    "V. a TRACES consolidated file in this layout is read by field number: the tax year (not the assessment year), the challans' BSR, serial, date and what they carry (" + J([cs.form, cs.fy, cs.q, c0, r3.challan]) + ")");
}
ok(f.problems && (f.problems || []).length === 0 && (f.missingCodes || []).length === 0, "V. 140: nothing to fix with the deductor's details complete (" + J(f.problems) + J(f.missingCodes) + ")");
// a deductor's detail missing is named, not guessed
f = build("2026-27", "Q1", Object.assign({}, FIRM, {personPan: "", state: "Atlantis"}), "26Q");
ok((f.problems || []).some(p => /field 59/.test(p)) && (f.problems || []).some(p => /state is missing or not one of Annexure 1/.test(p)) && field(of(f.text, "BH")[0], 26) === "", "V. a missing PAN of the person responsible and an unknown state are named; the state is left empty, not guessed (" + J(f.problems) + ")");
// Q2: the earlier statement marked filed with its token
b.tdsFiled = {"2026-27|Q1|26Q": {on: "2026-07-25", token: "123456789012345"}};
b.vouchers.push(V("v5", "20260810", "Alpha Ltd", 100000, 2000, "TDS 194C", "Contract Charges")); b.challans.push({id: "c3", bsr: "0240020", serial: "00013", date: "20260905", tax: 2000}); b.alloc["v5|TDS 194C"] = "c3";
f = build("2026-27", "Q2", FIRM, "26Q");
fieldsAre(of(f.text, "BH")[0], {9: "123456789012345", 52: "Y", 18: "Q2"}, "V. 140 Q2: Q1 marked filed, so field 52 is Y and field 9 its token");
b.tdsFiled = {};
f = build("2026-27", "Q2", FIRM, "26Q");
ok(field(of(f.text, "BH")[0], 52) === "N" && (f.notes || []).some(n => /not marked filed/.test(n)), "V. 140 Q2: Q1 not marked filed: N, and the note says so (" + J(f.notes) + ")");
// a section split by what FinCom does not know gets no code (To fix)
b = books([V("i1", "20260510", "Beta", 100000, 10000, "TDS 194I", "Office Rent"), V("i2", "20260511", "Gamma", 100000, 10000, "TDS 194J", "Sundry Charges")]);
b.challans = [{id: "c1", bsr: "0240020", serial: "00011", date: "20260607", tax: 20000}]; b.alloc = {"i1|TDS 194I": "c1", "i2|TDS 194J": "c1"};
f = build("2026-27", "Q1", FIRM, "26Q");
const ofP = (party) => of(f.text, "DD").find(d => d[8] === party) || [];
ok(field(ofP("Beta"), 15) === "1009" && field(ofP("Gamma"), 15) === "" && (f.missingCodes || []).some(m => /194J/.test(m)), "V. 140: office rent is 1009; a 194J payment of unknown kind gets no code and is listed (" + [field(ofP("Beta"), 15), field(ofP("Gamma"), 15)] + J(f.missingCodes) + ")");

// ---------------- Form 144 (27Q)
b = books([V("n1", "20260520", "Globex Inc", 100000, 20800, "TDS 195", "Technical Fees Abroad")]);
b.nrInfo = {"Globex Inc": {country: "USA", nature: "21", status: "1", optOut: "N", grossedUp: "N", address: "1 Main Street, Springfield", email: "ap@globex.example", phone: "15551234567", tin: "98-7654321"}};
b.challans = [{id: "c9", bsr: "0240020", serial: "00019", date: "20260607", tax: 20800}]; b.alloc = {"n1|TDS 195": "c9"};
f = build("2026-27", "Q1", FIRM, "27Q");
ok(!f.error && f.formNo === "144", "V. Form 144 for Q1 2026-27 is made (" + (f.error || f.name) + ")");
against("27Q", f.text, "Form 144");
fvuCopy("27Q");
fieldsAre(of(f.text, "DD")[0], {8: "PANNOTAVBL", 9: "Globex Inc", 12: "1", 14: "N", 15: "1057", 16: "21", 17: "267", 18: "Y", 19: "20052026", 20: "100000.00", 21: "N", 24: "20800.00", 27: "20052026",
  28: "20.8000", 30: "A", 32: "C", 37: "", 38: "", 39: "", 41: ""},
  "V. 144 DD: 195 is 1057; fees for technical services 21; the USA is 267 (Annexure 10); no PAN: PANNOTAVBL, remark C; the address, e-mail, phone and tax ID left out (FVU 1.2 takes them only for natures 05-07, 10-14, 16, 17)");
ok(Array.isArray(f.problems) && f.problems.length === 0, "V. 144: nothing to fix (" + J(f.problems) + ")");
b.nrInfo["Globex Inc"] = {country: "USA", nature: "99"};
f = build("2026-27", "Q1", FIRM, "27Q");
ok((f.problems || []).some(p => /opts out/.test(p)) && (f.problems || []).some(p => /grossed up/.test(p)) && field(of(f.text, "DD")[0], 14) === "" && field(of(f.text, "DD")[0], 21) === "",
  "V. 144: whether the deductee opts out of 202(1) and whether it is grossed up are not guessed (" + (f.problems || []).length + " to fix)");
// no PAN, a treaty rate below 20% on a dividend (nature 16): FVU 1.2 needs the address, e-mail, phone and tax ID
b = books([V("n2", "20260520", "Globex Inc", 100000, 15000, "TDS 195", "Dividend Paid")]);
b.nrInfo = {"Globex Inc": {country: "USA", nature: "16", status: "1", optOut: "N", grossedUp: "N", dtaa: true}};
b.challans = [{id: "c9", bsr: "0240020", serial: "00019", date: "20260607", tax: 15000}]; b.alloc = {"n2|TDS 195": "c9"};
f = build("2026-27", "Q1", FIRM, "27Q");
ok((f.problems || []).some(p => /e-mail \(DD field 38\)/.test(p)) && (f.problems || []).some(p => /tax identification number \(DD field 41\)/.test(p)), "V. 144: no PAN, remark C, 15% on a dividend: the missing e-mail and tax ID are named (" + J(f.problems) + ")");
b.nrInfo["Globex Inc"] = Object.assign(b.nrInfo["Globex Inc"], {address: "1 Main Street, Springfield", email: "ap@globex.example", phone: "15551234567", tin: "98-7654321"});
f = build("2026-27", "Q1", FIRM, "27Q");
fieldsAre(of(f.text, "DD")[0], {16: "16", 28: "15.0000", 30: "B", 32: "C", 37: "1 Main Street, Springfield", 38: "ap@globex.example", 39: "15551234567", 41: "98-7654321"}, "V. 144: given, they are written");
ok(Array.isArray(f.problems) && f.problems.length === 0, "V. 144: then nothing to fix (" + J(f.problems) + ")");

// ---------------- Form 143 (27EQ)
b = books([{id: "s1", date: "20260510", type: "Sales", party: "Beta", ent: [{l: "Beta", a: -102000}, {l: "Sales", a: 100000}, {l: "TCS Scrap", a: 2000}]}]);
b.nrInfo = {"Beta": {optOut: "N"}};
b.challans = [{id: "t1", bsr: "0240020", serial: "00014", date: "20260607", tax: 2000, section: "206C"}]; b.alloc = {"s1|TCS Scrap": "t1"};
f = build("2026-27", "Q1", FIRM, "27EQ");
ok(!f.error && f.formNo === "143" && /_Form143_/.test(f.name), "V. Form 143 for Q1 2026-27 is made (" + (f.error || f.name) + ")");
against("27EQ", f.text, "Form 143");
fvuCopy("27EQ");
fieldsAre(of(f.text, "FH")[0], {3: "TC1"}, "V. 143 FH: file type TC1 (it was NS1)");
fieldsAre(of(f.text, "DD")[0], {8: "ABCPB1234B", 11: "N", 12: "2", 13: "", 14: "N", 15: "1073", 18: "Y", 19: "10052026", 20: "100000.00", 24: "2000.00", 27: "10052026", 28: "2.0000"},
  "V. 143 DD: scrap is 1073; an individual (PAN's 4th letter P) collectee code 2; resident");
ok(Array.isArray(f.problems) && f.problems.length === 0, "V. 143: nothing to fix (" + J(f.problems) + ")");

// ---------------- Form 138 (24Q)
b = books([]);
b.challans = [{id: "s1", bsr: "0510001", serial: "00021", date: "20260607", tax: 9000, section: "192"}];
const payRows = [{id: "pay:1", employee: "Asha Rao", pan: "ABCPR1234R", tds: 5000, paid: 100000, date: "20260531", credit: "20260531", challan: "s1", fy: "2026-27", q: "Q1"},
  {id: "pay:2", employee: "Vikram Singh", pan: "", tds: 4000, paid: 20000, date: "20260531", credit: "20260531", challan: "s1", fy: "2026-27", q: "Q1"}];
if (x.Payroll){ x.Payroll.annexI = (fy, q) => payRows.filter(r => r.fy === fy && r.q === q); x.Payroll.tdsRows = () => payRows; }
f = build("2026-27", "Q1", FIRM, "24Q");
ok(!f.error && f.formNo === "138", "V. Form 138 for Q1 2026-27 is made (" + (f.error || f.name) + ")");
against("24Q", f.text, "Form 138");
fvuCopy("24Q");
fieldsAre(of(f.text, "FH")[0], {3: "SL1"}, "V. 138 FH: SL1");
fieldsAre(of(f.text, "CD")[0], {5: "2", 8: "9000.00", 12: "9000.00", 15: "0510001", 17: "00021", 19: "07062026", 21: "9000.00"}, "V. 138 CD: the challan, two employees");
fieldsAre(of(f.text, "DD")[0], {4: "1", 8: "ABCPR1234R", 9: "Asha Rao", 15: "1002", 18: "Y", 19: "31052026", 20: "100000.00", 24: "5000.00", 25: "5000.00", 27: "31052026", 29: "07062026", 32: ""},
  "V. 138 DD: an employee of a firm is 1002 (not “92B”); the date of deposit is the challan's");
fieldsAre(of(f.text, "DD")[1], {4: "2", 8: "PANNOTAVBL", 15: "1002", 24: "4000.00", 32: "C"}, "V. 138 DD: no PAN, 20%: PANNOTAVBL and remark C");
f = build("2026-27", "Q4", FIRM, "24Q");
ok(f.error && /Q1 to Q3/.test(f.error || ""), "V. 138 Q4: not made, the file format the owner has is for Q1 to Q3 (" + f.error + ")");

// ---------------- G: the owner's samples (Protean RPU 1.0, 06-05-2026)
const SAMPLE = process.env.TDSDESK_FORMS_SAMPLES || path.join(__dirname, "fixtures", "tds-forms-2025", "owner-samples-17oct.txt");
const samples = fs.existsSync(SAMPLE) ? fs.readFileSync(SAMPLE, "utf8").split(/\n=+\n/).map(s => s.trim().split(/\r?\n/).filter(Boolean)) : [];
// fields where FinCom's line and the sample differ on purpose, each with its reason (GAPS.md, the questions)
const KNOWN = {
  "FH.5": "the date the file is made", "FH.10": "the utility's name (FinCom, not Protean RPU 1.0)",
  "BH.43": "Q: the workbook has the responsible person's country mandatory; the samples leave it empty, FinCom writes INDIA",
  "CD.24": "Q: the workbook says interest allocation = field 9 (mandatory); the samples leave it empty",
  "CD.25": "Q: the workbook says others allocation = field 11 (mandatory); the samples leave it empty",
  "DD.18": "Q: the workbook has 'whether deposited' (Y/N) mandatory; the samples leave it empty, FinCom writes Y",
  "138.DD2.15": "Q: the sample has one State Government employee (1001) and one Union Government employee (1003) in the same statement; FinCom gives one code by the deductor's category",
  "138.DD2.33": "the sample has a certificate number without remark A; FinCom writes the number only with A",
  "138.DD.29": "Q: the sample's date of deposit (09-05) is not its challan's date (30-04); FinCom writes the challan's",
  "140.DD.28": "the sample's rate 03.0000 does not match its own amounts (900 on 1,000); FinCom writes the rate of the amounts",
  "140.DD.32": "remark E (Board circulars) is not one FinCom writes; FinCom writes A and C only",
  "144.DD.28": "the sample's rate 6.0000 does not match its own amounts (2,000 on 2,100)",
  "144.DD.37": "FVU 1.2 takes the address in the country of residence only with remark C and no PAN (T-FV-4337); the sample has remark A and a PAN",
  "144.DD.38": "the same for the e-mail (T-FV-4335)", "144.DD.39": "the same for the contact number (T-FV-4336)"
};
function golden(i, form, label, setup, shift){
  const want = (samples[i] || []).map(l => l.split("^"));
  if (!want.length){ ok(false, "G. " + label + ": the owner's sample is not at " + SAMPLE); return; }
  setup();
  const firm = ctx.__firm, gtext = build("2026-27", "Q1", firm, form).text || "", got = recs(gtext);
  fs.writeFileSync(path.join(KEEP, "G" + FORMNO[form] + ".txt"), gtext);
  const diffs = [], known = [];
  want.forEach((w, li) => {
    if (shift) w = w.map((v, k) => shift(w[1], k + 1, v));
    const g = got[li] || [];
    const nth = want.slice(0, li + 1).filter(z => z[1] === w[1]).length;
    if (g.length !== w.length) diffs.push(w[1] + ": " + g.length + " fields, the sample " + w.length);
    for (let k = 0; k < Math.max(g.length, w.length); k++){
      if ((g[k] || "") === (w[k] || "")) continue;
      const key = [w[1] + "." + (k + 1), FORMNO[form] + "." + w[1] + "." + (k + 1), FORMNO[form] + "." + w[1] + nth + "." + (k + 1)].find(kk => KNOWN[kk]);
      (key ? known : diffs).push(w[1] + (nth > 1 ? nth : "") + " field " + (k + 1) + ": FinCom " + J(g[k] || "") + ", sample " + J(w[k] || "") + (key ? " [" + KNOWN[key] + "]" : ""));
    }
  });
  ok(!diffs.length && got.length === want.length, "G. " + label + ": FinCom's file is the sample's, field for field" + (known.length ? ", but for " + known.length + " known differences" : "") +
    (diffs.length ? "\n         " + diffs.join("\n         ") : ""));
  if (process.env.VERBOSE) known.forEach(k => console.log("         known: " + k));
  // the same statement with the DDO serial number the sample leaves out (CD field 17), for Protean's FVU 1.2: a book
  // adjustment needs no challan file (.csi), so FVU 1.2 checks every record of it (run_fvu12_forms.py)
  ctx.S.books.challans[0].serial = "00001";
  // Form 144's sample also breaks two rules FVU 1.2 holds to: remark A with no certificate number, and nature 16 with
  // section code 1042 (Annexure 9 allows 27 only); given here as the rules want
  if (form === "27Q"){ ctx.S.books.certs[0].certNo = "ABCDE1234F"; ctx.S.books.nrInfo.ABCD.nature = "27"; }
  fs.writeFileSync(path.join(KEEP, "B" + FORMNO[form] + ".txt"), build("2026-27", "Q1", firm, form).text || "");
}
const GOV = (o) => Object.assign({deductorType: "S", name: "FAMILY DEVELOPMENT SERVICES", tan: "BLRF02329F"}, o);
// Form 138: the sample is for tax year 2025-26 (its dates in 2025, its BH 202627 / 202526); FinCom makes Form 138 from
// 2026-27 only, so the same inputs one year later, and the sample's years moved on by one to compare
golden(0, "24Q", "Form 138 (SL1)", () => {
  ctx.__firm = GOV({pan: "BRNPA7678H", country: "INDIA", flat: "9I", state: "28", pin: "567898", email: "ABCDD@TESTT.COM", phoneCc: "56789", phone: "8765789777", person: "ABCD", personDesignation: "CA",
    personFlat: "9I", personState: "28", personPin: "567898", personEmail: "BACD@TETSTT.COM", personPhoneCc: "67897", personPhone: "8768987887", stateName: "18", personPan: "BRNPA7678Y", ain: "1091650"});
  const bb = books([]);
  bb.challans = [{id: "g1", bsr: "2000090", serial: "", date: "20260430", tax: 22000, interest: 1000, fee: 1000, others: 100, mode: "B", minorHead: ""}];
  bb.certs = [{id: "L1", party: "ABCD", pan: "BRNPA7789J", section: "192", certNo: "767890987657898", from: "20260401", to: "20270331"}];
  const rows = [{id: "p1", employee: "ABCD", pan: "BRNPA7789J", tds: 2000, paid: 2100, date: "20260506", credit: "20260506", challan: "g1", fy: "2026-27", q: "Q1"},
    {id: "p2", employee: "EFGH", pan: "BRNPA3344H", tds: 2000, paid: 2100, date: "20260506", credit: "20260506", challan: "g1", fy: "2026-27", q: "Q1"}];
  if (x.Payroll){ x.Payroll.annexI = () => rows; x.Payroll.tdsRows = () => rows; }
}, (rec, k, v) => rec === "BH" && (k === 16 || k === 17) ? String(+v.slice(0, 4) + 1) + String(+v.slice(4) + 1) : /^\d{2}\d{2}2025$/.test(v) && (rec === "CD" || rec === "DD") ? v.slice(0, 4) + "2026" : v);
golden(1, "26Q", "Form 140 (NS1)", () => {
  ctx.__firm = GOV({pan: "BRNPA6677G", country: "INDIA", flat: "7U", state: "19", pin: "789098", email: "ABCD@TEST.COM", phoneCc: "56789", phone: "6789087657", person: "BHAGYASHREE", personDesignation: "CEO",
    personFlat: "7U", personState: "19", personPin: "789098", personEmail: "ABCD@TESTYOUP.COM", personPhoneCc: "56789", personPhone: "0987678909", stateName: "04", personPan: "BRNPA8898H", ain: "1060872"});
  const bb = books([V("g1", "20260502", "ABCD", 1000, 900, "TDS 194I", "Machinery Hire Charges")]);
  bb.pans = {"ABCD": "BRNPA6778G"};
  bb.challans = [{id: "gc", bsr: "3000012", serial: "", date: "20260430", tax: 10000, interest: 1000, fee: 100, others: 100, mode: "B", minorHead: ""}]; bb.alloc = {"g1|TDS 194I": "gc"};
});
golden(2, "27Q", "Form 144 (NS1)", () => {
  ctx.__firm = GOV({pan: "BRNPA6382H", country: "AMERICA", flat: "1Q", state: "18", pin: "778778", email: "ABCD@TETSTT.COM", phoneCc: "56789", phone: "6567898767", person: "ABCD", personDesignation: "CA",
    personFlat: "1Q", personState: "18", personPin: "778778", personEmail: "ABCC@TEST.COM", personPhoneCc: "67767", personPhone: "6767677677", stateName: "18", personPan: "BRNPA8247H", personCountry: ""});
  const bb = books([V("g1", "20260501", "ABCD", 2100, 2000, "TDS 194LC", "Interest on ECB")]);
  bb.pans = {"ABCD": "BRNPA7678G"};
  bb.nrInfo = {"ABCD": {status: "2", optOut: "Y", nature: "16", country: "04", grossedUp: "N", dtaa: true, address: "ADDRESS", email: "EAMAIL@TEST.COM", phone: "69877877878"}};
  bb.certs = [{id: "L2", party: "ABCD", pan: "BRNPA7678G", section: "194LC", certNo: "", from: "20260401", to: "20270331"}];
  bb.challans = [{id: "gc", bsr: "4000013", serial: "", date: "20260430", tax: 21000, interest: 1000, fee: 1000, others: 1000, mode: "B", minorHead: ""}]; bb.alloc = {"g1|TDS 194LC": "gc"};
  // the sample's section code 1042 (393(2) Sl. 4.E(a), IFSC-listed bonds) is not one FinCom gives an old section (194LC is
  // split by when and how the money was borrowed): given here for the comparison only
  if (x.PAY_CODES){ x.PAY_CODES["27Q"] = x.PAY_CODES["27Q"] || {}; x.PAY_CODES["27Q"]["194LC"] = {code: "1042"}; }
});
if (x.PAY_CODES && x.PAY_CODES["27Q"]) delete x.PAY_CODES["27Q"]["194LC"];

// ---------------- O: up to 2025-26, the old files as before
b = books([V("o1", "20250510", "Alpha Ltd", 100000, 2000, "TDS 194C", "Contract Charges")]);
b.challans = [{id: "oc", bsr: "0240020", serial: "00031", date: "20250607", tax: 2000}]; b.alloc = {"o1|TDS 194C": "oc"};
f = build("2025-26", "Q1", FIRM, "26Q");
const obh = of(f.text, "BH")[0] || [], odd = of(f.text, "DD")[0] || [];
ok(!f.error && /_26Q_Q1_202526\.txt$/.test(f.name) && obh[4] === "26Q" && obh.length === 39 && odd.includes("94C") && !f.draft, "O. a 2025-26 26Q is the old file: BH of 39 fields with form 26Q, section 94C, not a draft (" + (f.error || f.name + " " + obh.length) + ")");
f = build("2025-26", "Q1", FIRM, "27EQ");
ok(f.error || /^1\^FH\^NS1\^/.test(f.text), "O. a 2025-26 27EQ keeps its old header");

console.log("\n" + (fails.length ? fails.length + " FAILED" : "all passed"));
process.exit(fails.length ? 1 : 0);
