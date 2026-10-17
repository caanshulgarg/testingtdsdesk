// node run_fvu_layout.js - FinCom's own 26Q, 27Q, 27EQ and 24Q files (FY 2025-26, the forms of the Income-tax Act, 1961) laid
// out as Protean's file format and its FVU 8.7 read them, field by field, on the made-up books of fvu_books.js. Each case was
// an error of Protean's FVU 8.7 on FinCom's file (run_fvu87.py runs the FVU itself where it is installed):
//   T-FV-2001 the batch header has 72 fields; the challan record 41; the deductee record 54; the salary record 88
//   the file type is NS1 for 26Q and 27Q, TC1 for 27EQ, SL1 for 24Q
//   each field where the FVU reads it: form, TAN, PAN, assessment year, financial year, quarter, the deductor's and the
//   responsible person's details, the challan's BSR code, serial and date, the deductee's PAN, amounts, dates and codes
"use strict";
const {books, buildAll, FIRM, FY} = require("./fvu_books");
const fails = [];
function ok(c, w){ console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails.push(w); }
const {x} = books(), all = buildAll(x);
const recs = (t, type) => String(t || "").split("\r\n").filter(Boolean).map(l => l.split("^")).filter(f => f[1] === type);
const F = (r, n) => r ? r[n - 1] : undefined;      // field n as the format numbers it (1 = line number)
const want = {FH: 18, BH: 72, CD: 41, DD: 54, SD: 88};
for (const [name, f] of Object.entries(all)){
  if (f.error){ ok(false, name + ": built (" + f.error + ")"); continue; }
  const form = name.startsWith("27E") ? "27EQ" : name.slice(0, 3), q = "Q" + name[3];
  ok(f.text.endsWith("\r\n") && !/[^\r]\n/.test(f.text), name + ": CRLF line ends");
  const lens = {};
  ["FH", "BH", "CD", "DD", "SD"].forEach(t => recs(f.text, t).forEach(r => { lens[t] = lens[t] || new Set(); lens[t].add(r.length); }));
  Object.entries(lens).forEach(([t, s]) => ok(s.size === 1 && s.has(want[t]), name + ": " + t + " has " + want[t] + " fields (" + Array.from(s) + ")"));
  const fh = recs(f.text, "FH")[0], bh = recs(f.text, "BH")[0], cds = recs(f.text, "CD"), dds = recs(f.text, "DD");
  ok(F(fh, 3) === {"26Q": "NS1", "27Q": "NS1", "27EQ": "TC1", "24Q": "SL1"}[form] && F(fh, 4) === "R" && F(fh, 7) === "D" && F(fh, 8) === FIRM.tan && F(fh, 9) === "1",
    name + ": FH file type, regular, deductor, TAN, one batch (" + [F(fh, 3), F(fh, 4), F(fh, 7), F(fh, 8)] + ")");
  ok(F(bh, 4) === String(cds.length) && F(bh, 5) === form && F(bh, 13) === FIRM.tan && F(bh, 15) === FIRM.pan && F(bh, 16) === "202627" && F(bh, 17) === "202526" && F(bh, 18) === q,
    name + ": BH challans, form, TAN, PAN, AY 202627, FY 202526, " + q + " (" + [4, 5, 13, 15, 16, 17, 18].map(n => F(bh, n)) + ")");
  ok(F(bh, 19) === FIRM.name && F(bh, 21) === FIRM.flat && F(bh, 26) === FIRM.state && F(bh, 27) === FIRM.pin && F(bh, 28) === FIRM.email && F(bh, 31) === "N" && F(bh, 32) === "K",
    name + ": BH the deductor's name, address, state, PIN, e-mail, no change of address, type K (" + [19, 21, 26, 27, 28, 31, 32].map(n => F(bh, n)) + ")");
  ok(F(bh, 33) === FIRM.person && F(bh, 34) === FIRM.personDesignation && F(bh, 40) === FIRM.personState && F(bh, 41) === FIRM.personPin && F(bh, 43) === FIRM.personMobile && F(bh, 46) === "N" && F(bh, 59) === FIRM.personPan,
    name + ": BH the responsible person: name, designation, state, PIN, mobile, no change, PAN (" + [33, 34, 40, 41, 43, 46, 59].map(n => F(bh, n)) + ")");
  const dep = cds.reduce((a, c) => a + Number(F(c, 27)), 0);
  ok(Number(F(bh, 47)).toFixed(2) === dep.toFixed(2) && F(bh, 51) === "N" && /^[YN]$/.test(F(bh, 52) || ""), name + ": BH total deposit " + F(bh, 47) + " = the challans' " + dep.toFixed(2) + ", AO approval N, filed earlier Y/N (" + F(bh, 52) + ")");
  cds.forEach(c => {
    const mine = dds.filter(d => F(d, 4) === F(c, 4)), sum = n => mine.reduce((a, d) => a + Number(F(d, n)), 0).toFixed(2);
    ok(/^\d{7}$/.test(F(c, 16)) && /^\d{5}$/.test(F(c, 12)) && /^\d{8}$/.test(F(c, 18)) && F(c, 5) === String(mine.length) && F(c, 6) === "N" && /^(200|400)$/.test(F(c, 40)),
      name + " CD " + F(c, 4) + ": BSR, serial, date, deductees, not nil, minor head (" + [16, 12, 18, 5, 6, 40].map(n => F(c, n)) + ")");
    const tot = [22, 23, 24, 25, 26, 39].reduce((a, n) => a + Number(F(c, n)), 0).toFixed(2);
    ok(Number(F(c, 27)).toFixed(2) === tot && F(c, 29) === sum(19) && F(c, 30) === sum(14) && F(c, 33) === sum(17), name + " CD " + F(c, 4) + ": totals add up (" + [27, 29, 30, 33].map(n => F(c, n)) + ")");
  });
  dds.forEach(d => {
    ok(F(d, 6) === "O" && /^[A-Z]{5}\d{4}[A-Z]$|^PANNOTAVBL$/.test(F(d, 10)) && F(d, 13) && /^\d{8}$/.test(F(d, 23)) && /^\d{8}$/.test(F(d, 24)) && F(d, 33),
      name + " DD " + F(d, 4) + "." + F(d, 5) + ": mode, PAN, name, dates, section (" + [6, 10, 13, 23, 24, 33].map(n => F(d, n)) + ")");
  });
}
// the cases by hand: 26Q Q1's deductees, as the books have them
const q1 = recs(all["26Q1.txt"].text, "DD"), by = p => q1.find(d => F(d, 10) === p) || [];
ok(F(by("AAAFQ1234K"), 8) === "2" && F(by("AAAFQ1234K"), 14) === "2000.00" && F(by("AAAFQ1234K"), 22) === "100000.00" && F(by("AAAFQ1234K"), 23) === "10052025" && F(by("AAAFQ1234K"), 33) === "94C",
  "26Q Q1 Quillfeather: other than company, 2,000 on 1,00,000 on 10-May-2025, 94C (" + [8, 14, 22, 23, 33].map(n => F(by("AAAFQ1234K"), n)) + ")");
ok(F(by("PANNOTAVBL"), 30) === "C" && F(by("PANNOTAVBL"), 14) === "8000.00", "26Q Q1 Ashvattha, no PAN: remark C, 8,000 (" + [30, 14].map(n => F(by("PANNOTAVBL"), n)) + ")");
// T-FV-4056: 26Q's deductee code is 1 (company) or 2 (other); 27Q's and 27EQ's two digits by the PAN's fourth letter
ok(F(q1.find(d => d[12] === "Keshav Rathore"), 8) === "2", "26Q: an individual is 2 (" + F(q1.find(d => d[12] === "Keshav Rathore"), 8) + ")");
// T_FV_4325: a deductee with no PAN in 26Q carries a deductee reference number of ten digits, the same in every quarter
const ref = q => F(recs(all["26Q" + q + ".txt"].text, "DD").find(d => d[9] === "PANNOTAVBL"), 12);
ok(/^\d{10}$/.test(ref(1) || "") && Number(ref(1)) > 0 && ref(1) === ref(4) && F(by("AAAFQ1234K"), 12) === "", "26Q: no PAN: reference number " + ref(1) + ", the same in Q4 (" + ref(4) + "); none with a PAN");
// T-FV-4301: section codes as the FVU's list has them
const codes = {"193": "193", "194": "194", "194A": "94A", "194C": "94C", "194H": "94H", "194EE": "4EE", "194BA": "4BA", "194LA": "94L", "194DA": "4DA", "194BB": "4BB", "195": "195", "194LB": "4LB", "194LC": "4LC", "194LD": "4LD", "194E": "94E", "196D": "96D"};
const got = Object.keys(codes).map(s => [s, x.TDS26Q.codeFor({section: s})]);
ok(got.every(([s, c]) => c === codes[s]), "section codes: " + got.filter(([s, c]) => c !== codes[s]).map(([s, c]) => s + " gave " + c + ", the FVU's is " + codes[s]).join("; "));
const nr = recs(all["27Q1.txt"].text, "DD")[0];
ok(F(nr, 33) === "195" && F(nr, 35) === "A" && F(nr, 36) === "16" && F(nr, 38) === "49" && F(nr, 49) === "N" && F(nr, 8) === "10",
  "27Q Q1: section 195, rate under the Act (A), nature 16, country code 49, not opted out of 115BAC, deductee code 10 by its no-PAN default (" + [33, 35, 36, 38, 49, 8].map(n => F(nr, n)) + ")");
ok(all["27Q1.txt"].missingCodes.some(m => /Overseas Design GmbH.*(status|code)/i.test(m)), "27Q: with no PAN the deductee's status is asked (" + all["27Q1.txt"].missingCodes + ")");
const tc = recs(all["27E1.txt"].text, "DD")[0];
ok(F(tc, 33) === "E" && F(tc, 14) === "1000.00" && F(tc, 21) === "100000.00" && F(tc, 22) === "100000.00" && F(tc, 8) === "01" && F(tc, 49) === "N",
  "27EQ Q1: scrap (6CE) written E, 1,000 collected on a purchase of 1,00,000, a company 01, not opted out (" + [33, 14, 21, 22, 8, 49].map(n => F(tc, n)) + ")");
const sd = recs(all["24Q4.txt"].text, "SD");
ok(sd.length === 2 && recs(all["24Q1.txt"].text, "SD").length === 0, "24Q: two salary records in Q4 only (" + sd.length + ")");
// T-FV-2127: the batch header counts the salary records in every quarter (0 before Q4); Q4 their gross total income and
// the 194P count and total (0)
const bh24 = q => recs(all["24Q" + q + ".txt"].text, "BH")[0];
ok(F(bh24(1), 49) === "0" && F(bh24(4), 49) === "2" && F(bh24(4), 50) === (2230000 + 885000).toFixed(2) && F(bh24(4), 70) === "0" && F(bh24(4), 71) === "0.00",
  "24Q BH: salary records 0 in Q1, 2 in Q4 with gross total income 31,15,000 (22,30,000 + 8,85,000); 194P 0 (" + [F(bh24(1), 49), F(bh24(4), 49), F(bh24(4), 50), F(bh24(4), 70), F(bh24(4), 71)] + ")");
// T-FV-4079, T-FV-4033: 24Q's deductee record carries the challan's date as the date of deposit, the employee's reference
// number (nine digits), no deductee code, section 92B
const d24 = recs(all["24Q1.txt"].text, "DD")[0], c24 = recs(all["24Q1.txt"].text, "CD")[0];
ok(F(d24, 25) === F(c24, 18) && /^\d{9}$/.test(F(d24, 7)) && F(d24, 8) === "" && F(d24, 33) === "92B", "24Q DD: date of deposit " + F(d24, 25) + ", employee reference " + F(d24, 7) + ", no deductee code, 92B");
// Annexure II, worked out by hand. Ravi, old regime: salary 24,00,000 (basic 18,00,000, HRA 6,00,000); HRA exempt the least of
// 6,00,000, rent 3,00,000 less 10% of 18,00,000 = 1,20,000, 40% of 18,00,000: 1,20,000; standard deduction 50,000; income from
// salary 22,30,000; 80C 1,50,000; total income 20,80,000; tax 12,500 + 1,00,000 + 30% of 10,80,000 = 4,36,500; cess 17,460;
// 4,53,960; TDS 48,000. Sunita, new regime: 9,60,000 less 75,000 = 8,85,000; tax 20,000 + 8,500 = 28,500, all rebated (87A)
const sr = sd.find(r => F(r, 9) === "Ravi Menon") || [], ss = sd.find(r => F(r, 9) === "Sunita Rao") || [];
ok([13, 16, 17, 19, 22, 23, 24, 26, 28, 29, 34, 74, 76, 79].map(n => F(sr, n)).join() === "2400000.00,50000.00,2230000.00,2230000.00,150000.00,2080000.00,436500.00,17460.00,453960.00,48000.00,2400000.00,120000.00,120000.00,Y",
  "24Q SD Ravi (old regime): " + [13, 16, 17, 19, 22, 23, 24, 26, 28, 29, 34, 74, 76, 79].map(n => n + "=" + F(sr, n)).join(" "));
ok(F(sr, 39) === "Y" && F(sr, 40) === "1" && F(sr, 41) === "ABCPL5678L" && F(sr, 42) === "Lata Iyer" && F(sr, 49) === "N" && F(sr, 50) === "0", "24Q SD Ravi: rent over 1 lakh, the landlord's PAN and name; no housing loan (" + [39, 40, 41, 42, 49, 50].map(n => F(sr, n)) + ")");
ok([13, 16, 19, 23, 24, 78, 28, 70, 74, 79].map(n => F(ss, n)).join() === "960000.00,75000.00,885000.00,885000.00,28500.00,28500.00,0.00,,,N", "24Q SD Sunita (new regime): rebate 28,500, nothing exempt under 10(5) / 10(13A) (" + [13, 16, 19, 23, 24, 78, 28, 70, 74, 79].map(n => F(ss, n)) + ")");
const t24 = all["24Q4.txt"].text.split("\r\n");
ok(t24.some(l => /\^S16\^1\^1\^1\^16\(ia\)\^50000\.00\^$/.test(l)) && t24.some(l => /\^C6A\^1\^1\^1\^80C\^150000\.00\^150000\.00\^\^$/.test(l)) && t24.some(l => /\^S16\^1\^2\^1\^16\(ia\)\^75000\.00\^$/.test(l)),
  "24Q Q4: Ravi's 16(ia) 50,000 and 80C 1,50,000 (deductible, gross; no qualifying amount), Sunita's 16(ia) 75,000");
// the regular statement of an earlier quarter, marked filed with its token: Y and its receipt number in the batch header
{
  const {x: x2, b} = books();
  b.tdsFiled = {"2025-26|Q1|26Q": {on: "20250725", token: "123456789012345"}};
  const f2 = x2.TDS26Q.build(FY, "Q2", FIRM, "26Q"), bh = recs(f2.text, "BH")[0], f1 = x2.TDS26Q.build(FY, "Q1", FIRM, "26Q");
  ok(F(bh, 52) === "Y" && F(bh, 9) === "123456789012345" && F(recs(f1.text, "BH")[0], 52) === "N", "26Q Q2 after Q1 marked filed: filed earlier Y, receipt 123456789012345; Q1 N (" + [F(bh, 52), F(bh, 9)] + ")");
  // the deductor's details: what is missing is said; the category from the PAN
  const f3 = x2.TDS26Q.build(FY, "Q1", {tan: FIRM.tan, pan: FIRM.pan, name: FIRM.name, deductorType: "K"}, "26Q");
  ok(f3.firmMissing.includes("branch or division") && f3.firmMissing.includes("responsible person's mobile number") && f3.firmMissing.includes("e-mail of the deductor or the responsible person") && !f3.firmMissing.includes("name"),
    "missing deductor details are listed (" + f3.firmMissing.join(", ") + ")");
  ok(x2.TDS26Q.build(FY, "Q2", FIRM, "26Q").firmMissing.length === 0, "with every detail given, nothing is asked");
  b.tdsFiled = {"2025-26|Q1|26Q": {on: "20250725", token: ""}};
  ok(x2.TDS26Q.build(FY, "Q2", FIRM, "26Q").firmMissing.some(m => /token number of 26Q Q1 2025-26/.test(m)), "an earlier statement marked filed without its token: the token is asked");
  x2.ctx = null;
}
{
  const {ctx, x: x3} = books();
  const cat = () => { const f = x3.TDS26Q.firmDetails(); return x3.TDS26Q.oldCategory(f) + (x3.TDS26Q.oldFirmMissing(f).includes("deductor category") ? "?" : ""); };
  ctx.S.companies.t.pan = "AAGCL4827M"; const t = cat();
  ctx.S.companies.t.pan = "AABFL1234K"; const tf = cat();
  ctx.S.companies.t.pan = "AABEL1234K"; const te = cat();
  ctx.S.companies.t.tds26q = {deductorType: "F"}; const tset = cat();
  ok(t === "K" && tf === "F" && te === "?" && tset === "F" && x3.TDS26Q.firmDetails().deductorType === "F",
    "deductor category from the PAN: company K, firm F, an LLP asked; one set in the settings kept; the new forms' F as before (" + [t, tf, te, tset] + ")");
}
console.log(fails.length ? "\n" + fails.length + " FAILED" : "\nall passed");
process.exit(fails.length ? 1 : 0);
