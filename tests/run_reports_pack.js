// node run_reports_pack.js - the reports pack (ROUND 100, app/src/lib/reports/*): the Board's Report, the Independent
// Auditor's Report and the management representation letter, built from FinSt (src/js/88-fin-statements.js) and the
// questionnaire. On made-up books: tests/fixtures/fin-statements/company.json (the company of run_fin_statements.js) with
// a few ledgers added here (a loan from a director, a loan given, a director's remuneration, a TDS payable unpaid for more
// than six months). Checks:
//   - the applicability engine: small company at exactly ₹10 crore / ₹100 crore and just above, the earlier limits for an
//     earlier year, holding / subsidiary / public / OPC / s.8, the CARO private-company exemption on each of its limits,
//     the IFC exemption, CSR thresholds;
//   - every figure the reports prefill equals FinSt's (the financial summary in the page's unit; paid-up capital, turnover,
//     loans, deposits, foreign exchange, statutory dues, cash loss, cash and bank in rupees);
//   - the questionnaire: last year's answers carried forward (not the one-year ones), the AGM number counted on, an answer
//     kept, the defaults where the law allows "none";
//   - every mandatory item is in the reports of a public company and of a small company (and no more than the law asks).
const {load, HTML} = require("./harness"), fs = require("fs"), path = require("path"), {pathToFileURL} = require("url");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "FS", "FinSt", "INR"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const eq = (a, b, w) => ok(Math.abs((a == null ? NaN : a) - b) < 1e-6, w + ": " + a + (Math.abs((a == null ? NaN : a) - b) < 1e-6 ? "" : " (expected " + b + ")"));
const {company: rawBooks} = require("./fixtures/fin-statements/reports_books.js");
const CO = {name: "Larkspur Analytics Private Limited", pan: "AABCL1234F", cin: "U72900KA2015PTC000001", address: "12 Made-up Road, Bengaluru"};
ctx.S.firm = {firmName: "Made-up & Associates", frn: "000000S", partner: "A. Sample", mno: "000001", place: "Bengaluru"};
ctx.CO = () => CO;
const DIRS = [{name: "Asha Rao", din: "00000001", desig: "Director"}, {name: "Vikram Sen", din: "00000002", desig: "Managing Director"}];
const company = () => { const b = rawBooks(); b.fs = {inputs: {directors: DIRS, shares: {number: 10000, face: 10, authorised: 500000, holders: []}, place: "Bengaluru", date: "20260905", udin: "26000001ABCDEF1234"}}; return b; };

// every answer a careful auditor would give for the made-up company (FY 2025-26)
const ANSWERS = {e_agm_no: 11, e_board_date: "20260905", e_audit_date: "20260905", e_udin: "26000001ABCDEF1234", b_business: "software development and IT-enabled services for customers in India and abroad",
  b_meetings: [{date: "20250520"}, {date: "20250905"}, {date: "20251210"}, {date: "20260310"}], b_aud_agm: "8th Annual General Meeting held on 30th September, 2023", b_aud_till: "13th Annual General Meeting",
  b_posh_recv: 0, b_posh_disp: 0, b_posh_pend: 0, b_maternity: "yes", b_emp_f: 9, b_emp_m: 14, b_emp_t: 0, m_engagement: "20250701", b_loan_purpose: "working capital of the borrower",
  rp_parties: [{name: "Asha Rao", relation: "Director"}, {name: "Vikram Sen", relation: "Managing Director"}]};

(async () => { try {
  const P = await import(pathToFileURL(path.join(__dirname, "..", "app", "src", "lib", "reports", "index.js")).href);
  const FinSt = x.FinSt;
  const CR = 1e7;

  console.log("\nApplicability: small company (s.2(85), limits as data)");
  const base = {fyEnd: "20260331", paidUp: 10 * CR, turnover: 100 * CR, turnoverPy: 100 * CR, revenue: 101 * CR, reserves: 0, netWorthPy: 20 * CR, pbtPy: 0, bankBorrowPeak: 0, borrowPeak: 0};
  const ap = (f, a) => P.applicability(Object.assign({}, base, f), Object.assign({e_class: "private"}, a));
  ok(P.SMALL[0].paidUp === 10 * CR && P.SMALL[0].turnover === 100 * CR && P.SMALL[0].from === "20251201", "the limits are data: ₹10 crore / ₹100 crore from 1 December 2025 (law.js SMALL)");
  ok(ap({}).small === true, "paid-up exactly ₹10 crore and turnover exactly ₹100 crore: a small company");
  ok(ap({paidUp: 10 * CR + 1}).small === false && /paid-up capital/.test(ap({paidUp: 10 * CR + 1}).smallTest.why.join()), "paid-up ₹1 above ₹10 crore: not small, and why");
  ok(ap({turnoverPy: 100 * CR + 1}).small === false, "turnover of the preceding year ₹1 above ₹100 crore: not small");
  ok(ap({turnoverPy: 0, turnover: 100 * CR + 1}).small === false, "no preceding year (first year): the year's own turnover is tested");
  ok(ap({fyEnd: "20250331", paidUp: 5 * CR, turnoverPy: 30 * CR}).small === false && ap({fyEnd: "20250331", paidUp: 4 * CR, turnoverPy: 40 * CR}).small === true, "FY 2024-25 accounts: the earlier ₹4 crore / ₹40 crore limits");
  const t = ap({paidUp: 5 * CR, turnoverPy: 30 * CR});
  ok(t.small && t.smallTestBefore && t.smallTestBefore.yes === false, "a year of change: the earlier limits' result is shown beside (₹5 crore paid-up: small now, not before)");
  ok(!ap({}, {e_class: "public"}).small && !ap({}, {e_holdsub: "holding"}).small && !ap({}, {e_holdsub: "subsidiary"}).small && !ap({}, {e_class: "s8"}).small && !ap({}, {e_sector: "nbfc"}).small,
    "never small: a public company, a holding or subsidiary company, a section 8 company, a company under a special Act");
  ok(ap({}).abridged && !ap({paidUp: 11 * CR}).abridged && ap({paidUp: 11 * CR}, {e_class: "opc"}).abridged && !ap({}, {e_format: "full"}).abridged, "Rule 8A abridged report: small company and OPC (the full one when chosen); not for others");
  ok(!ap({}).cashFlow && ap({paidUp: 11 * CR}).cashFlow, "no cash flow statement for a small company (s.2(40))");

  console.log("\nApplicability: CARO 2020");
  ok(!ap({}).caro.applies && /small company/.test(ap({}).caro.reason), "a small company: CARO does not apply (" + ap({}).caro.reason + ")");
  const pvt = {paidUp: 0.5 * CR, reserves: 0.5 * CR, turnoverPy: 101 * CR, revenue: 10 * CR, bankBorrowPeak: 1 * CR};
  ok(!ap(pvt).small && !ap(pvt).caro.applies && /private company/.test(ap(pvt).caro.reason), "a private company (not small) at exactly ₹1 crore capital and reserves, ₹1 crore bank borrowings, ₹10 crore revenue: exempt");
  ok(ap(Object.assign({}, pvt, {reserves: 0.5 * CR + 1})).caro.applies, "capital and reserves ₹1 above ₹1 crore: CARO applies");
  ok(ap(Object.assign({}, pvt, {bankBorrowPeak: 1 * CR + 1})).caro.applies, "bank borrowings ₹1 above ₹1 crore at any time: CARO applies");
  ok(ap(pvt, {e_peak_bank: 1 * CR + 1}).caro.applies, "... the peak borrowings answered in the questionnaire count");
  ok(ap(Object.assign({}, pvt, {revenue: 10 * CR + 1})).caro.applies, "revenue ₹1 above ₹10 crore: CARO applies");
  ok(ap(pvt, {e_holdsub: "subsidiary_public"}).caro.applies && ap(pvt, {e_holdsub: "holding"}).caro.applies, "a subsidiary of a public company or a holding company: no private-company exemption");
  ok(ap({}, {e_class: "public"}).caro.applies && !ap({}, {e_class: "opc"}).caro.applies && !ap({}, {e_class: "s8"}).caro.applies && !ap({paidUp: 11 * CR}, {e_sector: "banking"}).caro.applies, "public: applies; OPC, section 8, banking company: excluded");

  console.log("\nApplicability: internal financial controls (s.143(3)(i))");
  const big = {paidUp: 11 * CR, turnoverPy: 49 * CR, revenue: 49 * CR, borrowPeak: 24 * CR};
  ok(!ap({}).ifc.applies && /small company/.test(ap({}).ifc.reason), "a small company: no IFC reporting");
  ok(!ap(big).ifc.applies, "a private company, turnover ₹49 crore, borrowings ₹24 crore, no filing default: exempt (13 June 2017)");
  ok(ap(Object.assign({}, big, {turnoverPy: 50 * CR})).ifc.applies && ap(Object.assign({}, big, {borrowPeak: 25 * CR})).ifc.applies, "turnover ₹50 crore, or borrowings ₹25 crore: IFC applies");
  ok(ap(big, {e_filing_default: "yes"}).ifc.applies, "a default in filing AOC-4 / MGT-7: the exemption is lost");
  ok(ap(big, {e_class: "public"}).ifc.applies && ap(big, {e_class: "public"}).s197 && !ap(big).s197, "a public company: IFC and s.197(16) apply; a private company: s.197(16) does not");

  console.log("\nApplicability: CSR (s.135), the rest");
  ok(!ap(big).csr.applies && ap({netWorthPy: 500 * CR}).csr.applies && ap({turnoverPy: 1000 * CR}).csr.applies && ap({pbtPy: 5 * CR}).csr.applies, "CSR: net worth ₹500 crore, turnover ₹1,000 crore or net profit ₹5 crore in the preceding year");
  eq(ap({pbtPy: 5 * CR}, {csr_avg: 6 * CR}).csr.obligation, 1200000, "CSR obligation: 2% of the average net profit of ₹6 crore");
  ok(ap({}, {e_class: "listed"}).kam && !ap({}, {e_class: "public"}).kam && ap({}, {e_class: "listed"}).dre.ifcClause && !ap({}).dre.ifcClause, "listed: key audit matters and DRS clause (e); others not");
  ok(P.classFromCin("U72900KA2015PTC000001") === "private" && P.classFromCin("L65910MH1995PLC000001") === "listed" && P.classFromCin("U74999DL2020OPC000001") === "opc" && P.classFromCin("U85300KA2019NPL000001") === "s8" && P.classFromCin("U65910MH1995PLC000001") === "public", "the class from the CIN");

  console.log("\nThe made-up company's books");
  const b = company(); ctx.S.books = b;
  const d = FinSt.build("2025", {unit: 1000, dec: 2}), dR = FinSt.build("2025", {unit: 1, dec: 2});
  ok(!d.error && !dR.error, "FinSt builds the statements" + (d.error ? ": " + d.error : ""));
  const row = l => dR.tb.rows.find(r => r.ledger === l) || {};
  ok(row("Loan from Director Asha Rao").code === "30B" || row("Loan from Director Asha Rao").code === "33B", "the director's loan is coded as a loan from related parties (" + row("Loan from Director Asha Rao").code + ")");
  ok(row("Loan to Fernhill Traders").code === "12H", "the loan given: other loans and advances 12H (" + row("Loan to Fernhill Traders").code + ")");
  ok(row("TDS Payable 194C").code === "7C", "TDS payable: statutory remittances 7C (" + row("TDS Payable 194C").code + ")");

  console.log("\nPrefilled figures equal FinSt");
  let pk = P.pack({d, dR, vouchers: b.vouchers, store: {}, fy: "2025"});
  const f = pk.c.f, note = (k, col) => (dR.notes.find(n => n.key === k) || {total: {}}).total[col || "cy"];
  eq(f.paidUp, note("3"), "paid-up capital = Note 3 (rupees)");
  eq(f.turnover, note("13"), "turnover = Note 13"); eq(f.turnoverPy, note("13", "py"), "turnover of the preceding year = Note 13 PY");
  eq(f.netWorthPy, dR.bs.sections.EQ.total.py, "net worth of the preceding year = shareholders' funds PY");
  eq(f.pbt, dR.pl.pbt.cy, "profit before tax = P&L"); eq(f.pat, dR.pl.pat.cy, "profit for the year = P&L");
  const sum = f.summary, sl = (l) => sum.find(r => r.label === l) || {};
  eq(sl("Revenue from operations").cy, d.pl.rev.cy, "summary in thousands: revenue = P&L (" + d.pl.rev.cy + ")");
  eq(sl("Revenue from operations").py, d.pl.rev.py, "... previous year");
  eq(sl("Total income").cy, d.pl.inc.cy, "... total income"); eq(sl("Finance costs").cy, d.pl.fin.cy, "... finance costs"); eq(sl("Depreciation and amortisation").cy, d.pl.dep.cy, "... depreciation");
  eq(sl("Profit / (loss) before tax").cy, d.pl.pbt.cy, "... profit before tax"); eq(sl("Profit / (loss) for the year").cy, d.pl.pat.cy, "... profit for the year");
  eq(sl("Profit before finance costs, depreciation and tax").cy, d.pl.pbe.cy + d.pl.fin.cy + d.pl.dep.cy, "... EBITDA = PBT before exceptional + finance costs + depreciation");
  const tbl = pk.board.blocks.find(x => x.t === "table" && x.kind === "summary");
  ok(tbl && P.runsText(tbl.rows[0][1]) === P.money(d.pl.rev.cy, 2) && P.runsText(tbl.rows[0][2]) === P.money(d.pl.rev.py, 2), "the Board's Report table shows them in the page's unit (" + (tbl && P.runsText(tbl.rows[0][1])) + ")");
  ok(pk.board.blocks.some(x => x.t === "p" && /Rupees thousand/.test(P.runsText(x.runs))), "... with the unit line");
  ok(f.loansGiven.length === 1 && f.loansGiven[0].ledger === "Loan to Fernhill Traders" && f.loansGiven[0].cy === 300000 && f.loansGiven[0].given === 300000, "loans given (s.186, CARO 3(iii)): Fernhill Traders ₹3,00,000 given and outstanding");
  ok(f.directorLoans.length === 1 && f.directorLoanTotal === 500000, "deposits: the loan from the director ₹5,00,000, exempt with the declaration");
  eq(f.fxIn, -row("Software Services - Export").final, "foreign exchange earned: the export sales ledger");
  ok(f.statDues.length === 1 && f.statDues[0].ledger === "TDS Payable 194C" && f.statDues[0].amount === 5000 && f.statDues[0].due === "20250707", "statutory dues over six months (CARO 3(vii)(a)): TDS ₹5,000 payable since 7 July 2025 (" + JSON.stringify(f.statDues) + ")");
  ok(!f.statDues.some(x => /192|194J|PF|Professional|IGST/.test(x.ledger)), "... the March dues are not over six months");
  eq(f.cashLoss, 0, "no cash loss (profit before tax plus depreciation is positive)");
  eq(f.cash, row("Cash").final, "cash on hand (MRL) = the ledger"); eq(f.bank, row("Northbank Current A/c").final, "bank balance (MRL) = the ledger");
  eq(f.msme, (dR.notes.find(n => n.key === "6").lines.find(l => l.code === "6A") || {}).cy, "MSME dues = Note 6 (6A)");
  ok(f.estimates.length >= 3, "the estimates the MRL names: " + f.estimates.join("; "));
  eq(f.currentRatio, dR.bs.sections.CA.total.cy / dR.bs.sections.CL.total.cy, "current ratio (CARO 3(xix))");
  ok(pk.c.amt(1234567) === "₹1,234.57 thousand", "an amount in prose follows the page's unit: " + pk.c.amt(1234567));
  const rp = P.relatedTx(dR, ANSWERS.rp_parties);
  ok(rp[1].tx.some(t => t.ledger === "Director Remuneration - Vikram Sen" && t.nature === "Remuneration" && t.amount === 1200000) && rp[0].tx.some(t => t.ledger === "Loan from Director Asha Rao"), "related parties' ledgers by name: Vikram Sen's remuneration ₹12,00,000, Asha Rao's loan");
  ok(f.remunDirectors === 1200000, "directors' remuneration from the books ₹12,00,000");

  console.log("\nThe questionnaire");
  const fresh = P.resolve({}, "2025", f, d.inputs);
  ok(fresh.a.e_class === "private" && fresh.src.e_class === "books", "the class of company from the CIN (U...PTC: private)");
  ok(fresh.a.b_dividend === "none" && fresh.a.b_deposits === "no" && fresh.a.a_opinion === "unmodified" && fresh.a.a_trail === "v1" && fresh.a.b_cost === "na", "defaults where the law allows: no dividend, no deposits, unmodified opinion, audit trail clean, cost records not applicable");
  ok(JSON.stringify(fresh.a.b_directors.map(x => x.name)) === JSON.stringify(["Asha Rao", "Vikram Sen"]) && fresh.src.b_directors === "books", "the directors from the company's details");
  const miss0 = P.missing(fresh, pk.c.ap, f).map(q => q.k);
  ok(["b_business", "b_meetings", "b_posh_recv", "b_maternity", "b_emp_f", "e_agm_no", "m_engagement"].every(k => miss0.includes(k)), "unanswered and required: " + miss0.join(", "));
  ok(pk.board.missing.length > 0 && pk.board.missing.some(m => m.k === "b_posh_recv"), "the Board's Report marks the gaps (" + pk.board.missing.length + ")");
  const store = {}, bb = {fs: {}};
  Object.entries(Object.assign({}, ANSWERS, {b_web: "https://example.invalid/annual-return", b_fx_in: 999})).forEach(([k, v]) => P.setAnswer(bb, "2025", k, v));
  Object.assign(store, bb.fs.reports);
  ok(store["2025"].a.b_business === ANSWERS.b_business && !!store["2025"].at, "an answer is kept in b.fs.reports[fy].a");
  const next = P.resolve(store, "2026", f, d.inputs);
  ok(next.a.b_business === ANSWERS.b_business && next.src.b_business === "carried", "next year: the business description carried forward, marked so");
  ok(next.a.e_agm_no === 12, "... the annual report number counted on (11 -> 12)");
  ok(next.a.b_web === "https://example.invalid/annual-return" && next.src.b_web === "carried", "... the website carried");
  ok(next.a.b_posh_recv === undefined && next.a.b_meetings === undefined && next.a.e_audit_date === "20260905" && next.src.e_audit_date === "books", "... the one-year answers are not (POSH counts, meeting dates); the report date comes from the details again");
  ok(next.a.b_fx_in !== 999 && next.src.b_fx_in === "books", "... the figures from the books are worked out again, never copied");
  P.setAnswer(bb, "2025", "b_web", null);
  ok(!("b_web" in bb.fs.reports["2025"].a), "an answer cleared goes back to the default");

  console.log("\nA small company (the made-up company as it is): mandatory items");
  Object.entries(ANSWERS).forEach(([k, v]) => P.setAnswer(bb, "2025", k, v));
  pk = P.pack({d, dR, vouchers: b.vouchers, store: bb.fs.reports, fy: "2025"});
  ok(pk.c.ap.small && pk.c.ap.abridged && !pk.c.ap.caro.applies && !pk.c.ap.ifc.applies, "small (paid-up ₹1 lakh, turnover ₹1 crore): abridged report, no CARO, no IFC");
  const heads = doc => doc.blocks.filter(x => x.t === "h").map(x => x.text);
  const text = doc => doc.blocks.map(x => x.t === "p" ? P.runsText(x.runs) : x.t === "table" ? x.rows.map(r => r.map(P.runsText).join(" ")).join(" ") : x.t === "sig" ? x.cols.map(c => c.map(P.runsText).join("\n")).join("\n") : x.t === "h" || x.t === "title" ? x.text : "").join("\n");
  let H = heads(pk.board), T = text(pk.board);
  const ABRIDGED = ["Financial summary", "State of the Company's affairs", "Dividend", "Transfer to reserves", "Material changes and commitments", "Directors and Key Managerial Personnel", "Meetings of the Board", "Directors' Responsibility Statement",
    "Statutory Auditors and their report", "Significant and material orders", "Annual return", "Prevention of sexual harassment of women at the workplace", "Compliance with the Maternity Benefit Act, 1961", "Employees", "Acknowledgements"];
  ok(ABRIDGED.every(h => H.includes(h)), "Rule 8A items, with POSH, maternity and employees: " + ABRIDGED.filter(h => !H.includes(h)).join(", "));
  ok(!H.includes("Conservation of energy, technology absorption and foreign exchange earnings and outgo") && !H.includes("Risk management") && !H.includes("Deposits"), "... and not the items Rule 8A leaves out (energy, risk, deposits)");
  ok(/Rule 8A/.test(T) && /annual return/.test(T) && /complaints of sexual harassment received during the year: 0/.test(T) && /9 female, 14 male and 0 transgender employees, 23 in all/.test(T), "the abridged statement, the annual return, POSH counts, employees by gender");
  ok(/Section 143\(12\)/.test(T) && /does not contain any qualification/.test(T), "frauds u/s 143(12) and the auditor's remarks");
  const dreN = doc => { const i = doc.blocks.findIndex(x => x.t === "h" && x.text === "Directors' Responsibility Statement"); let n = 0; for (let j = i + 2; j < doc.blocks.length && doc.blocks[j].t === "p" && doc.blocks[j].num; j++) n++; return n; };
  ok(!/laid down internal financial controls/.test(T) && dreN(pk.board) === 5, "DRS: five clauses, without the one on internal financial controls (unlisted) (" + dreN(pk.board) + ")");
  ok(pk.board.missing.length === 0, "every answer given: no gap in the Board's Report (" + pk.board.missing.map(m => m.k).join(", ") + ")");
  H = heads(pk.audit); T = text(pk.audit);
  ok(["Report on the Audit of the Financial Statements", "Opinion", "Basis for Opinion", "Information Other than the Financial Statements and Auditor's Report Thereon", "Responsibilities of Management and the Board of Directors for the Financial Statements",
    "Auditor's Responsibilities for the Audit of the Financial Statements", "Report on Other Legal and Regulatory Requirements"].every(h => H.includes(h)), "the auditor's report: SA 700 headings");
  ok(/does not apply to the Company, the Company being a small company/.test(T) && !/Annexure A to the Independent/.test(T), "CARO: not applicable, with the reason; no Annexure A");
  ok(/does not apply to the Company, the Company being a small company, in view of the exemption/.test(T) && !/Annexure B to the Independent/.test(T), "IFC: not applicable, with the reason; no Annexure B");
  ok(/Section 197\(16\) of the Act does not arise/.test(T), "s.197(16): a private company, said so");
  ok(!/Statement of Cash Flows/.test(T), "no cash flow statement named (a small company)");
  ok(/UDIN: 26000001ABCDEF1234/.test(T) && /Membership No\.: 000001/.test(T) && /Firm Registration No\.: 000000S/.test(T), "signature: firm, FRN, partner, membership no., UDIN");
  T = text(pk.mrl);
  ok(new RegExp("cash on hand of " + pk.c.amt(f.cash).replace(/[.()]/g, "\\$&")).test(T) && T.includes(pk.c.amt(f.bank)) && T.includes(pk.c.amt(f.receivables)), "MRL: cash, bank and receivables from the books, in the unit");
  ok(/loans of ₹500\.00 thousand from directors/.test(T) && /TDS Payable 194C/.test(T) && /Made-up & Associates/.test(T) && /Vikram Sen/.test(T), "MRL: the director's loan, the TDS outstanding, the auditor addressed, signed by the directors");
  ok(/Annexure 1: Summary of uncorrected misstatements/.test(T) && /Annexure 2: Related parties/.test(T), "MRL: the two annexures");
  ok(pk.audit.missing.length === 0 && pk.mrl.missing.length === 0, "no gap in the auditor's report or the MRL");

  console.log("\nA public company (the same books, answered as an unlisted public company): mandatory items");
  P.setAnswer(bb, "2025", "e_class", "public"); P.setAnswer(bb, "2025", "b_kmp", "Vikram Sen, Managing Director"); P.setAnswer(bb, "2025", "b_rotation", "Asha Rao (DIN 00000001)");
  pk = P.pack({d, dR, vouchers: b.vouchers, store: bb.fs.reports, fy: "2025"});
  ok(!pk.c.ap.small && !pk.c.ap.abridged && pk.c.ap.caro.applies && pk.c.ap.ifc.applies && pk.c.ap.s197 && pk.c.ap.cashFlow, "public: full report, CARO, IFC, s.197(16), cash flow");
  H = heads(pk.board); T = text(pk.board);
  const FULL = ABRIDGED.concat(["Share capital", "Subsidiaries, joint ventures and associate companies", "Deposits", "Particulars of loans, guarantees and investments", "Contracts and arrangements with related parties", "Cost records and cost audit", "Internal financial controls",
    "Risk management", "Corporate Social Responsibility", "Conservation of energy, technology absorption and foreign exchange earnings and outgo", "Proceedings under the Insolvency and Bankruptcy Code, 2016", "One-time settlement", "Secretarial Standards", "Dues to micro and small enterprises"]);
  ok(FULL.every(h => H.some(x => x.startsWith(h))), "s.134(3) and Rule 8 items: " + (FULL.filter(h => !H.some(x => x.startsWith(h))).join(", ") || "all " + FULL.length));
  ok(/change in the nature of the business/.test(T) && /Section 152\(6\)/.test(T) && /Key Managerial Personnel of the Company are: Vikram Sen/.test(T), "change in nature, retirement by rotation, KMP");
  ok(/Rule 2\(1\)\(c\)\(viii\)/.test(T) && /Loan from Director Asha Rao/.test(T), "deposits: the director's loan named, exempt");
  ok(/Loan to Fernhill Traders/.test(T) && /300\.00/.test(T) && /working capital of the borrower/.test(T), "s.186: the loan given, its amount (in thousands) and purpose");
  ok(/Foreign exchange earned in terms of actual inflows: ₹/.test(T) && /do not apply to the Company, its net worth/.test(T) && /Section 148\(1\)/.test(T), "forex from the books; CSR not applicable with the figures; cost records");
  ok(/Form AOC-2 is therefore not required/.test(T) && !H.includes("Form AOC-2") , "no material related party contract: AOC-2 not required, said so");
  H = heads(pk.audit); T = text(pk.audit);
  ok(/we give in Annexure A a statement/.test(T) && /Annexure A to the Independent Auditor's Report/.test(T), "CARO applies: Annexure A");
  const caroStart = pk.audit.blocks.findIndex(x => x.t === "title" && /Annexure A/.test(x.text)), caroEnd = pk.audit.blocks.findIndex((x, i) => i > caroStart && x.t === "title");
  const caroNums = pk.audit.blocks.slice(caroStart, caroEnd).filter(x => x.t === "p" && x.indent === 0 && /^\([ivx]+\)$/.test(x.num || "")).map(x => x.num);
  ok(caroNums.length === 21 && caroNums[0] === "(i)" && caroNums[20] === "(xxi)", "Annexure A: all 21 clauses, (i) to (xxi) (" + caroNums.length + ")");
  ok(/does not hold any inventory; clause 3\(ii\)\(a\) of the Order is therefore not applicable/.test(T) && /not a Nidhi company/.test(T) && /does not own any immovable property/.test(T), "not applicable worked out from the books: no inventory, not a Nidhi company, no immovable property");
  ok(/Fernhill Traders|Parties other than the above/.test(T) && pk.audit.blocks.some(x => x.kind === "caro3iii"), "3(iii): the loans table");
  ok(pk.audit.blocks.some(x => x.kind === "caro3vii") && /more than six months/.test(T), "3(vii)(a): the TDS outstanding more than six months, in a table");
  ok(/not incurred cash losses/.test(T), "3(xvii): no cash losses (from the books)");
  ok(/Annexure B to the Independent Auditor's Report/.test(T) && H.includes("Meaning of Internal Financial Controls with Reference to Financial Statements") && H.includes("Inherent Limitations of Internal Financial Controls with Reference to Financial Statements"), "IFC applies: Annexure B with its sections");
  const s143 = pk.audit.blocks.filter(x => x.t === "p" && x.indent === 1 && /^\([a-j]\)$/.test(x.num || "")).map(x => x.num);
  ok(["(a)", "(b)", "(c)", "(d)", "(e)", "(f)", "(g)", "(h)", "(i)", "(j)"].every(k => s143.includes(k)), "s.143(3) (a) to (i) and (j) Rule 11: " + s143.join(" "));
  const r11 = pk.audit.blocks.filter(x => x.t === "p" && x.indent === 2).map(x => x.num);
  ok(r11.length === 6 && /audit trail \(edit log\)/.test(T) && /Intermediar|intermediary/.test(T) && /dividend/.test(T), "Rule 11 (a), (b), (c), (e), (f), (g): six items, audit trail, intermediaries, dividend");
  ok(/remuneration paid by the Company to its directors during the year is in accordance with the provisions of Section 197/.test(T), "s.197(16) for a public company");
  ok(/Statement of Cash Flows/.test(T), "the cash flow statement named (not a small company)");
  P.setAnswer(bb, "2025", "a_trail", "v4");
  pk = P.pack({d, dR, vouchers: b.vouchers, store: bb.fs.reports, fy: "2025"});
  T = text(pk.audit);
  ok(/does not have a feature of recording audit trail/.test(T) && /paragraph 2\(j\)\(vi\)/.test(T), "audit trail: software without the feature, also an exception in 143(3)(b) and (h)");
  P.setAnswer(bb, "2025", "a_trail", "v2");
  pk = P.pack({d, dR, vouchers: b.vouchers, store: bb.fs.reports, fy: "2025"});
  ok(pk.audit.missing.some(m => m.k === "a_trail_detail"), "audit trail enabled from a date: the date is asked (marked)");
  P.setAnswer(bb, "2025", "a_trail", "v1"); P.setAnswer(bb, "2025", "a_opinion", "qualified");
  pk = P.pack({d, dR, vouchers: b.vouchers, store: bb.fs.reports, fy: "2025"});
  T = text(pk.audit);
  ok(heads(pk.audit).includes("Qualified Opinion") && heads(pk.audit).includes("Basis for Qualified Opinion") && /save for the effects/.test(T) && pk.audit.missing.some(m => m.k === "a_mod_matter"), "qualified: headings, 'save for', the matter asked");
  ok(pk.board.missing.some(m => m.k === "b_aud_reply"), "... and the Board's Report asks for the Board's explanation");
  P.setAnswer(bb, "2025", "a_opinion", "disclaimer");
  pk = P.pack({d, dR, vouchers: b.vouchers, store: bb.fs.reports, fy: "2025"});
  ok(heads(pk.audit).includes("Disclaimer of Opinion") && !heads(pk.audit).includes("Information Other than the Financial Statements and Auditor's Report Thereon"), "disclaimer: no other-information section (SA 720)");
  P.setAnswer(bb, "2025", "a_opinion", null); P.setAnswer(bb, "2025", "e_class", "listed"); P.setAnswer(bb, "2025", "a_kam", [{matter: "Revenue recognition", response: "Tested contracts"}]);
  pk = P.pack({d, dR, vouchers: b.vouchers, store: bb.fs.reports, fy: "2025"});
  ok(heads(pk.audit).includes("Key Audit Matters") && /they have laid down internal financial controls/.test(text(pk.board)) && dreN(pk.board) === 6, "listed: key audit matters; DRS clause (e) on internal financial controls (six clauses)");
  P.setAnswer(bb, "2025", "e_class", "public"); P.setAnswer(bb, "2025", "e_mdna", "yes"); P.setAnswer(bb, "2025", "e_cg", "yes"); P.setAnswer(bb, "2025", "rp_material", "yes");
  P.setAnswer(bb, "2025", "rp_terms", "Ongoing; at market rates"); P.setAnswer(bb, "2025", "rp_approval", "20250520");
  pk = P.pack({d, dR, vouchers: b.vouchers, store: bb.fs.reports, fy: "2025"});
  H = heads(pk.board); T = text(pk.board);
  ok(H.includes("Management Discussion and Analysis (voluntary disclosure)") && H.includes("Report on Corporate Governance (voluntary disclosure)") && /not listed/.test(T), "optional MD&A and Corporate Governance, labelled voluntary");
  ok(pk.board.blocks.some(x => x.t === "title" && /Annexure I to the Board's Report/.test(x.text)) && pk.board.blocks.some(x => x.kind === "aoc2") && /Remuneration: 1,200\.00/.test(T), "AOC-2 annexure with the related party's remuneration from the books");
  ok(pk.board.missing.some(m => m.k === "md_industry"), "... the MD&A's narrative asked for");
} catch (e) { console.log(e); fails++; }
  console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
})();
