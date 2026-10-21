// The Board's Report (ROUND 100): section 134(3) and Rule 8 of the Companies (Accounts) Rules, 2014 as amended in 2025
// (POSH figures, the Maternity Benefit statement, employees by gender), or the abridged report under Rule 8A for a small
// company or a one person company, with the annexures that apply (AOC-1, AOC-2, the annual report on CSR, MR-3) and,
// when chosen, a Management Discussion and Analysis and a Report on Corporate Governance, each labelled voluntary for an
// unlisted company. The wording is FinCom's; the Board and its advisers review it before it is signed.
//
//   boardReport(c)  c: makeContext(...) -> a document (doc.js)
import { makeDoc, alpha, roman, money } from "./doc.js";
import { relatedTx, longDate } from "./facts.js";

const N = (v) => +v || 0;
const pct = (v) => (Math.round(v * 1000) / 10).toLocaleString("en-IN", { maximumFractionDigits: 1 }) + "%";
const nz = (v) => v !== undefined && v !== null && String(v).trim() !== "";

export function boardReport(c) {
  const { f, ap, a, inp } = c, D = makeDoc("board", "Board's Report"), full = !ap.abridged;
  let n = 0;
  const sec = (title) => { n += 1; D.h(title, 1, n + "."); };
  const P = (runs, o) => D.p(runs, o);
  const co = "the Company";
  const directors = (Array.isArray(a.b_directors) ? a.b_directors : []).filter((x) => x && x.name);

  D.title("Board's Report", "");
  P(["To the Members of ", { text: c.name, b: true }, ","]);
  P(["Your Directors present the ", c.A("e_agm_no", (v) => c.ord(N(v))), " Annual Report of the Company, together with the audited financial statements for the financial year ended ", c.yearEnd, "."]);
  if (ap.abridged) P([{ text: "This report is prepared in the abridged form permitted by Rule 8A of the Companies (Accounts) Rules, 2014, the Company being " + (ap.opc ? "a one person company" : "a small company") + ".", i: true }]);

  // 1. financial summary (the statements' own figures, in the page's unit)
  sec("Financial summary");
  P(["The financial performance of the Company for the year under review, prepared on a standalone basis under the Accounting Standards notified under Section 133 of the Companies Act, 2013 (\"the Act\"), is summarised below ", c.inp.unitLine, ":"]);
  const rows = f.summary.map((r) => [r.bold ? { text: r.label, b: true } : r.label, c.fig(r.cy), c.fig(r.py)]);
  if (f.eps) rows.push(["Earnings per equity share, basic and diluted (₹)", money(f.eps.cy, 2), money(f.eps.py, 2)]);
  D.table(["Particulars", c.fyLabel, c.fyLabelPy], rows, { num: [1, 2], bold: f.summary.map((r, i) => (r.bold ? i : -1)).filter((i) => i >= 0), kind: "summary" });

  // 2. state of affairs
  sec(full ? "State of the Company's affairs and change in the nature of business" : "State of the Company's affairs");
  const g = f.growth, up = g == null ? "" : g >= 0 ? "increased by " + pct(g) : "decreased by " + pct(-g);
  const patW = (v) => (v >= 0 ? "a profit after tax of " + c.amt(v) : "a loss after tax of " + c.amt(-v));
  P(["The Company is engaged in ", c.A("b_business", (v) => String(v).replace(/[.\s]+$/, "")), ". During the year, revenue from operations ", g == null ? "was " : up + " to ", c.amt(f.turnover),
    " (previous year ", c.amt(f.turnoverPy), "), and the Company earned ", patW(f.pat).replace(/^a /, "a "), " (previous year ", patW(f.patPy).replace(/^an? /, ""), ").", nz(a.b_events) ? " " + String(a.b_events).trim() : ""]);
  if (full) P(c.yes("b_nature_change") ? ["During the year, the nature of the business of the Company changed as follows: ", c.A("b_nature_details"), "."] : ["There has been no change in the nature of the business of the Company during the year."]);

  // 3. dividend
  sec("Dividend");
  const dv = a.b_dividend || "none";
  if (dv === "none") P(["With a view to conserving resources for the business, the Board does not recommend any dividend for the financial year ended ", c.yearEnd, "."]);
  if (/interim|both/.test(dv)) P(["During the year, the Board declared an interim dividend of ", c.A("b_div_interim"), f.dividendPaid ? " (₹ total as paid: " + c.amt(f.dividendPaid) + ")" : "", ", which has been paid."]);
  if (/final|both/.test(dv)) P(["The Board recommends a final dividend of ₹", c.A("b_div_final"), " per equity share for the year, subject to the approval of the members at the coming Annual General Meeting."]);
  if (full) P(["No dividend declared by the Company has remained unpaid or unclaimed, and the provisions of Sections 124 and 125 of the Act on transfer to the Investor Education and Protection Fund therefore do not apply."]);

  // 4. reserves
  sec("Transfer to reserves");
  P(N(a.b_reserve) > 0 ? ["An amount of ", c.amt(a.b_reserve), " has been transferred to the reserves during the year."] : ["The Board has not proposed any transfer to the reserves; the ", f.pat >= 0 ? "profit" : "loss", " for the year has been carried in the statement of profit and loss."]);

  // 5. share capital
  if (full || f.sharesChanged) {
    sec("Share capital");
    const sh = inp.shares || {};
    P(["As at ", c.yearEnd, ", the issued, subscribed and paid-up equity share capital of the Company was ", c.amt(f.shareCap), sh.number ? ", divided into " + Number(sh.number).toLocaleString("en-IN") + " equity shares of ₹" + (sh.face || 10) + " each" : "",
      f.prefCap ? ", and its preference share capital was " + c.amt(f.prefCap) : "", sh.authorised ? "; the authorised share capital was ₹" + Number(sh.authorised).toLocaleString("en-IN") : "", "."]);
    if (f.sharesChanged) P(["During the year: ", c.A("b_share_changes"), "."]);
    else P(["During the year, the Company did not issue any shares (including shares with differential voting rights, sweat equity shares or shares under an employee stock option scheme) and did not buy back any of its shares."]);
    if (f.esopCharge > 0) P(["The particulars of the employee stock option scheme required by Rule 12(9) of the Companies (Share Capital and Debentures) Rules, 2014 are: ", c.A("b_esop"), "."]);
  }

  // 6. material changes
  sec("Material changes and commitments");
  P(nz(a.b_material) ? ["The following material changes and commitments affecting the financial position of the Company have occurred between the end of the financial year and the date of this report: ", String(a.b_material).trim()] :
    ["No material changes or commitments affecting the financial position of the Company have occurred between the end of the financial year to which the financial statements relate and the date of this report."]);

  // 7. subsidiaries
  const subs = (Array.isArray(a.b_subs) ? a.b_subs : []).filter((x) => x && x.name);
  if (full || subs.length) {
    sec("Subsidiaries, joint ventures and associate companies");
    P(subs.length ? ["The Company has the following subsidiaries, joint ventures and associate companies: ", subs.map((s) => s.name + " (" + (s.type || "subsidiary") + (s.pct ? ", " + s.pct + "%" : "") + ")").join("; "), ". A statement containing the salient features of their financial statements, in Form AOC-1, is given in the Annexure to this report."] :
      ["The Company does not have any subsidiary, joint venture or associate company, and no company became or ceased to be its subsidiary, joint venture or associate company during the year."]);
  }

  // 8. deposits
  if (full) {
    sec("Deposits");
    if (c.yes("b_deposits")) P(["Particulars of deposits covered by Chapter V of the Act: ", c.A("b_deposit_details"), "."]);
    else P(["The Company has not accepted or renewed any deposit within the meaning of Sections 73 to 76 of the Act read with the Companies (Acceptance of Deposits) Rules, 2014 during the year. No deposit remained unpaid or unclaimed at the end of the year, and there has been no default in the repayment of deposits or the payment of interest on them."]);
    if (f.directorLoans.length) P(["The unsecured loans of ", c.amt(f.directorLoanTotal), " outstanding at the year end from the directors (", f.directorLoans.map((x) => x.ledger).join(", "), ") are not deposits, being exempt under Rule 2(1)(c)(viii) of those Rules", c.yes("b_dir_decl") ? "; the directors concerned have declared in writing that the amounts were not given out of funds acquired by borrowing or by accepting loans or deposits from others." : ". The written declaration required from the directors under that Rule is awaited."]);
  }

  // 9. loans, guarantees and investments
  if (full) {
    sec("Particulars of loans, guarantees and investments");
    const L = f.loansGiven.filter((x) => x.cy > 0.5 || x.given > 0.5).map((x) => ["Loan", x.ledger, c.tamt(x.given), c.tamt(x.cy)]).concat(f.investments.filter((x) => x.cy > 0.5).map((x) => ["Investment", x.ledger, c.tamt(x.made), c.tamt(x.cy)]));
    if (!L.length && !nz(a.b_guarantees)) P(["The Company has not given any loan or guarantee, provided any security or made any investment covered by Section 186 of the Act during the year."]);
    else {
      P(["Particulars of the loans given, investments made, and guarantees given or security provided by the Company, covered by Section 186 of the Act, are as follows ", c.inp.unitLine, ". They are within the limits laid down in that Section."]);
      if (L.length) D.table(["Nature", "Party", "Given / made in the year", "Outstanding at the year end"], L, { num: [2, 3] });
      P(["Purpose: ", c.A("b_loan_purpose"), "."]);
      if (nz(a.b_guarantees)) P(["Guarantees and security: ", String(a.b_guarantees).trim()]);
    }
  }

  // 10. related parties
  const rp = relatedTx(c.dR, a.rp_parties), rpTx = rp.filter((p) => p.tx.length);
  const aoc2 = c.yes("rp_material") || c.yes("rp_not_arm");
  if (full) {
    sec("Contracts and arrangements with related parties");
    P(["All contracts, arrangements and transactions entered into by the Company with related parties during the year were in the ordinary course of business and on an arm's length basis",
      c.yes("rp_not_arm") ? ", except those set out in Part A of Form AOC-2" : "", ". ",
      aoc2 ? "The particulars of the contracts or arrangements referred to in Section 188(1) of the Act are given in Form AOC-2 in the Annexure to this report." : "There was no material contract, arrangement or transaction with a related party, and the disclosure in Form AOC-2 is therefore not required.",
      " The related party disclosures under Accounting Standard 18 are given in the notes to the financial statements."]);
  }

  // 11. directors and KMP
  sec("Directors and Key Managerial Personnel");
  P(directors.length ? ["As on the date of this report, the Board of Directors comprises ", String(directors.length), " director", directors.length > 1 ? "s" : "", ": ", directors.map((x) => x.name + (x.din ? " (DIN " + x.din + ")" : "") + (x.desig ? ", " + x.desig : "")).join("; "), "."] : ["As on the date of this report, the Board of Directors comprises ", c.A("b_directors"), "."]);
  const ch = (Array.isArray(a.b_dir_changes) ? a.b_dir_changes : []).filter((x) => x && x.name);
  P(ch.length ? ["During the year: ", ch.map((x) => x.name + (x.din ? " (DIN " + x.din + ")" : "") + " was " + String(x.change || "appointed").toLowerCase() + " as " + (x.desig || "Director") + (x.date ? " with effect from " + longDate(x.date) : "")).join("; "), "."] : ["There was no change in the directors or key managerial personnel of the Company during the year."]);
  if (ap.rotation) P(["In accordance with Section 152(6) of the Act, ", c.A("b_rotation"), " retires by rotation at the coming Annual General Meeting and, being eligible, offers himself / herself for re-appointment."]);
  if (ap.pub) P(["The Key Managerial Personnel of the Company are: ", c.A("b_kmp"), "."]);
  if (ap.idDecl) P(["The Company has received from each Independent Director a declaration under Section 149(7) of the Act that he or she meets the criteria of independence laid down in Section 149(6). In the opinion of the Board, the Independent Directors possess integrity, expertise and experience, including proficiency."]);
  if (ap.evaluation) P(["Annual evaluation: ", c.A("b_evaluation"), "."]);

  // 12. meetings
  sec("Meetings of the Board");
  const mt = (Array.isArray(a.b_meetings) ? a.b_meetings : []).map((x) => x && x.date).filter(Boolean);
  P(mt.length ? ["The Board met ", String(mt.length), " time", mt.length > 1 ? "s" : "", " during the year, on ", mt.map((x) => longDate(x)).join(", "), ". The gap between any two consecutive meetings did not exceed one hundred and twenty days."] : ["The Board met during the year on ", c.A("b_meetings"), "."]);

  // 13. directors' responsibility statement
  sec("Directors' Responsibility Statement");
  P(["Pursuant to Section 134(5) of the Act, the Directors, to the best of their knowledge and belief, confirm that:"]);
  const dre = [
    ["in the preparation of the annual accounts for the year ended ", c.yearEnd, ", the applicable accounting standards have been followed, and there are no material departures from them;"],
    ["they have selected accounting policies and applied them consistently, and made judgements and estimates that are reasonable and prudent, so as to give a true and fair view of the state of affairs of the Company at the end of the financial year and of its ", f.pat >= 0 ? "profit" : "loss", " for that period;"],
    ["they have taken proper and sufficient care to maintain adequate accounting records in accordance with the Act, for safeguarding the assets of the Company and for preventing and detecting fraud and other irregularities;"],
    ["they have prepared the annual accounts on a going concern basis;"],
  ];
  if (ap.dre.ifcClause) dre.push(["they have laid down internal financial controls to be followed by the Company, and such controls are adequate and were operating effectively; and"]);
  dre.push(["they have devised proper systems to ensure compliance with the provisions of all applicable laws, and such systems were adequate and operating effectively."]);
  dre.forEach((r, i) => P(r, { num: alpha(i), indent: 1 }));

  // 14. auditors
  sec("Statutory Auditors and their report");
  const au = inp.auditor || {};
  P(c.yes("b_aud_first") ? ["M/s ", au.firm || "", ", Chartered Accountants (Firm Registration No. ", au.frn || "", "), were appointed by the Board as the first Statutory Auditors of the Company under Section 139(6) of the Act, to hold office until the conclusion of the first Annual General Meeting."] :
    ["M/s ", au.firm || "", ", Chartered Accountants (Firm Registration No. ", au.frn || "", "), were appointed as the Statutory Auditors of the Company at the ", c.A("b_aud_agm"), ", to hold office until the conclusion of the ", c.A("b_aud_till"), "."]);
  const op = a.a_opinion || "unmodified";
  P(op === "unmodified" ? ["The Auditors' Report on the financial statements for the year ended ", c.yearEnd, " does not contain any qualification, reservation, adverse remark or disclaimer. The notes to the financial statements referred to in the Auditors' Report are self-explanatory and do not call for further comment."] :
    ["The Auditors' Report contains the following " + (op === "qualified" ? "qualification" : op === "adverse" ? "adverse opinion" : "disclaimer of opinion") + ": ", c.A("a_mod_matter"), ". The Board's explanation: ", c.A("b_aud_reply"), "."]);
  P(c.yes("b_fraud") ? ["Reporting of frauds by the auditors: during the year, the Statutory Auditors reported to the Board under Section 143(12) of the Act the following: ", c.A("b_fraud_details"), "."] :
    ["Reporting of frauds by the auditors: during the year, the Statutory Auditors have not reported to the Board under Section 143(12) of the Act any instance of fraud committed against the Company by its officers or employees."]);

  if (full) {
    if (ap.mr3) { sec("Secretarial audit"); P(["The Board appointed ", c.A("b_cs"), " to carry out the secretarial audit for ", c.fyLabel, ". The Secretarial Audit Report in Form MR-3 is annexed to this report."]); }
    sec("Cost records and cost audit");
    const cr = a.b_cost || "na";
    P(cr === "na" ? ["The maintenance of cost records and the requirement of cost audit specified by the Central Government under Section 148(1) of the Act do not apply to the business of the Company."] :
      cr === "records" ? ["The Company maintains the cost records specified by the Central Government under Section 148(1) of the Act. The requirement of cost audit does not apply to the Company for the year."] :
        ["The Company maintains the cost records specified under Section 148(1) of the Act, and the Board appointed ", c.A("b_cost_auditor"), " as Cost Auditors for ", c.fyLabel, "."]);
    sec("Internal financial controls");
    P(["The Company has internal financial controls with reference to the financial statements that are adequate for its size and the nature of its business. The controls were reviewed during the year, and no reportable material weakness in their design or operation was observed. The books of account are kept in accounting software with an audit trail (edit log) feature."]);
    sec("Risk management");
    P(["The Board reviews from time to time the risks to which the Company is exposed, including ", String(a.b_risks || "market, credit, liquidity and regulatory risks").replace(/[.\s]+$/, ""), ", and the steps taken to manage them. In the opinion of the Board, there is at present no risk that may threaten the existence of the Company."]);
    sec("Corporate Social Responsibility");
    if (!ap.csr.applies) P(["The provisions of Section 135 of the Act on Corporate Social Responsibility do not apply to the Company, its net worth (", c.amt(ap.csr.netWorth), "), turnover (", c.amt(ap.csr.turnover), ") and net profit (", c.amt(ap.csr.netProfit), ") for the preceding financial year being below the limits laid down in that Section."]);
    else P(["The Company is required to spend on Corporate Social Responsibility under Section 135 of the Act (", ap.csr.why.join("; "), "). The prescribed expenditure for the year, being two per cent of the average net profit of the three preceding financial years, was ", c.has("csr_avg") ? c.amt(ap.csr.obligation) : c.A("csr_avg"), ", against which the Company spent ", c.amt(f.csrSpent), ". The Annual Report on CSR activities is given in the Annexure to this report.", nz(a.csr_unspent) ? " Unspent amount: " + String(a.csr_unspent).trim() : ""]);
    sec("Conservation of energy, technology absorption and foreign exchange earnings and outgo");
    P([{ text: "(A) Conservation of energy. ", b: true }, String(a.b_energy || "").trim(), " Alternate sources of energy: ", nz(a.b_energy_alt) ? String(a.b_energy_alt).trim() : "nil", ". Capital investment on energy conservation equipment: ", N(a.b_energy_capex) ? c.amt(a.b_energy_capex) : "nil", "."]);
    P([{ text: "(B) Technology absorption. ", b: true }, String(a.b_tech || "").trim(), " Technology imported during the last three years: ", nz(a.b_tech_import) ? String(a.b_tech_import).trim() : "none", ". Expenditure on research and development: ", N(a.b_rnd) ? c.amt(a.b_rnd) : "nil", "."]);
    P([{ text: "(C) Foreign exchange earnings and outgo. ", b: true }, "Foreign exchange earned in terms of actual inflows: ", N(a.b_fx_in) ? c.amt(a.b_fx_in) : "nil", "; foreign exchange outgo in terms of actual outflows: ", N(a.b_fx_out) ? c.amt(a.b_fx_out) : "nil", "."]);
  }

  sec("Significant and material orders");
  P(nz(a.b_orders) ? ["The following significant and material orders were passed by regulators, courts or tribunals: ", String(a.b_orders).trim()] : ["No significant or material order has been passed by any regulator, court or tribunal affecting the going concern status of the Company or its operations in future."]);
  sec("Annual return");
  P(nz(a.b_web) ? ["In accordance with Sections 92(3) and 134(3)(a) of the Act, the annual return of the Company for ", c.fyLabel, " is placed on its website at ", String(a.b_web).trim(), "."] :
    ["The Company does not have a website. In accordance with Section 92(3) of the Act, the annual return for ", c.fyLabel, " will be filed with the Registrar of Companies within the time allowed, and a copy will be available for inspection by the members."]);
  sec("Prevention of sexual harassment of women at the workplace");
  P(["The Company has a policy on the prevention, prohibition and redressal of sexual harassment of women at the workplace", a.b_posh_ic === "lc" ? "; as it has fewer than ten employees, complaints are dealt with by the Local Committee constituted by the District Officer" : " and has constituted an Internal Committee under the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013", ". Particulars for the year:"]);
  [["number of complaints of sexual harassment received during the year: ", "b_posh_recv"], ["number of complaints disposed of during the year: ", "b_posh_disp"], ["number of cases pending for more than ninety days: ", "b_posh_pend"]].forEach(([t, k], i) => P([t, c.A(k), i < 2 ? ";" : "."], { num: alpha(i), indent: 1 }));
  sec("Compliance with the Maternity Benefit Act, 1961");
  P(!c.has("b_maternity") ? ["Statement of compliance with the Maternity Benefit Act, 1961: ", c.A("b_maternity"), "."] : c.yes("b_maternity") ? ["The Company has complied with the provisions of the Maternity Benefit Act, 1961, including those relating to maternity leave and other benefits to eligible women employees."] :
    ["The Company has not fully complied with the provisions of the Maternity Benefit Act, 1961 during the year, and is taking steps to do so."]);
  sec("Employees");
  const ef = c.A("b_emp_f"), em = c.A("b_emp_m"), et = c.A("b_emp_t"), tot = [a.b_emp_f, a.b_emp_m, a.b_emp_t].every((v) => v !== undefined && v !== null && v !== "") ? N(a.b_emp_f) + N(a.b_emp_m) + N(a.b_emp_t) : null;
  P(["As at ", c.yearEnd, ", the Company had ", ef, " female, ", em, " male and ", et, " transgender employees", tot != null ? ", " + tot + " in all" : "", "."]);
  if (full) P(ap.rule5 ? ["The disclosures under Section 197(12) of the Act and Rule 5 of the Companies (Appointment and Remuneration of Managerial Personnel) Rules, 2014 are annexed to this report."] : ["The provisions of Section 197(12) of the Act and Rule 5 of the Companies (Appointment and Remuneration of Managerial Personnel) Rules, 2014 do not apply to the Company, its shares not being listed."]);
  if (full) {
    sec("Proceedings under the Insolvency and Bankruptcy Code, 2016");
    P(nz(a.b_ibc) ? [String(a.b_ibc).trim()] : ["No application has been made, and no proceeding is pending, by or against the Company under the Insolvency and Bankruptcy Code, 2016 during the year."]);
    sec("One-time settlement");
    P(nz(a.b_ots) ? [String(a.b_ots).trim()] : ["The Company has not made any one-time settlement with a bank or financial institution; the disclosure of the difference between the valuation at such a settlement and the valuation done while taking the loan therefore does not arise."]);
  }
  if (ap.ss) { sec("Secretarial Standards"); P(["The Company has complied with the applicable Secretarial Standards on Meetings of the Board of Directors (SS-1) and on General Meetings (SS-2) issued by the Institute of Company Secretaries of India."]); }
  if (full && (ap.committees || ap.vigil)) {
    sec("Committees of the Board and vigil mechanism");
    if (ap.committees) P(["Audit Committee and Nomination and Remuneration Committee: ", c.A("b_committees"), "."]);
    if (ap.vigil) P(["The Company has a vigil mechanism through which directors and employees may report genuine concerns, with direct access to the Chairperson of the Audit Committee or the director nominated for the purpose."]);
  }
  if (full && f.msme > 0.5) { sec("Dues to micro and small enterprises"); P(["Amounts due to micro and small enterprises under the Micro, Small and Medium Enterprises Development Act, 2006 at the year end were ", c.amt(f.msme), ". Details are given in the notes to the financial statements."]); }
  sec("Acknowledgements");
  P(["The Board thanks the Company's customers, suppliers, bankers, the Government authorities and the members for their continued support, and records its appreciation of the contribution made by the employees at all levels."]);
  signature(c, D, directors);

  // the voluntary sections
  if (ap.mdna) {
    D.brk().h("Management Discussion and Analysis" + (ap.mdnaVoluntary ? " (voluntary disclosure)" : ""), 1);
    if (ap.mdnaVoluntary) P([{ text: "The Company is not listed, and Regulation 34 of the SEBI (Listing Obligations and Disclosure Requirements) Regulations, 2015 does not apply to it. This section is given voluntarily.", i: true }]);
    D.h("Industry structure, developments, opportunities and threats", 2); P([c.A("md_industry")]);
    D.h("Performance", 2);
    const ebitda = f.summary.find((r) => /^Profit before finance/.test(r.label)), m = (r, col) => (f.disp.rev[col] ? N(r[col]) / N(f.disp.rev[col]) : 0);
    P(["Revenue from operations ", g == null ? "was " : up + " to ", c.amt(f.turnover), ". The operating margin (profit before finance costs, depreciation and tax to revenue) was ", pct(m(ebitda, "cy")), " (previous year ", pct(m(ebitda, "py")), "), and the net profit margin was ", pct(m(f.disp.pat, "cy")), " (previous year ", pct(m(f.disp.pat, "py")), ")."]);
    D.table(["Key ratio", c.fyLabel, c.fyLabelPy], [["Current ratio", f.currentRatio.toFixed(2), ""], ["Debt-equity ratio", f.debtEquity.toFixed(2), ""], ["Net profit margin", pct(m(f.disp.pat, "cy")), pct(m(f.disp.pat, "py"))]], { num: [1, 2] });
    D.h("Outlook, risks and concerns", 2); P([c.A("md_outlook")]);
    D.h("Internal control systems", 2); P(["The Company has internal control systems commensurate with its size and operations, which are reviewed periodically by the Board."]);
    D.h("Human resources", 2); P([c.A("md_hr"), tot != null ? " The Company had " + tot + " employees at the year end." : ""]);
  }
  if (ap.cg) {
    D.brk().h("Report on Corporate Governance" + (ap.cgVoluntary ? " (voluntary disclosure)" : ""), 1);
    if (ap.cgVoluntary) P([{ text: "The Company is not listed, and Schedule V of the SEBI (Listing Obligations and Disclosure Requirements) Regulations, 2015 does not apply to it. This report is given voluntarily.", i: true }]);
    D.h("Philosophy", 2); P([c.A("cg_philosophy")]);
    D.h("Board of Directors", 2); P(["The Board comprises ", directors.map((x) => x.name + (x.desig ? " (" + x.desig + ")" : "")).join(", ") || c.A("b_directors"), ". It met ", mt.length ? String(mt.length) : c.A("b_meetings"), " times during the year."]);
    D.h("Remuneration of directors", 2); P(["Remuneration paid to the directors during the year: ", c.amt(f.remunDirectors), "."]);
    D.h("General body meetings", 2); P([c.A("cg_agms")]);
    D.h("Shareholding", 2); P(((inp.shares || {}).holders || []).length ? ["Shareholders holding more than five per cent: ", inp.shares.holders.map((h) => h.name + " (" + Number(h.n || 0).toLocaleString("en-IN") + " shares)").join("; "), "."] : ["The shareholding pattern is given in the annual return."]);
  }

  // annexures
  let ax = 0;
  const annex = (title) => { ax += 1; D.brk().title("Annexure " + romanNum(ax) + " to the Board's Report", title); };
  if (full && aoc2) {
    annex("Form AOC-2: particulars of contracts or arrangements with related parties referred to in Section 188(1)");
    D.h("A. Contracts or arrangements not at arm's length basis", 2);
    if (c.yes("rp_not_arm")) D.table(["(a) Name and relationship", "(b) Nature of contract", "(c) Duration", "(d) Salient terms incl. value", "(e) Justification", "(f) Board approval", "(g) Advances", "(h) Special resolution"],
      rpTx.map((p) => [p.name + (p.relation ? " (" + p.relation + ")" : ""), p.tx.filter((t) => !t.bal).map((t) => t.nature).join(", ") || "-", [c.A("rp_terms")], p.tx.filter((t) => !t.bal).map((t) => t.nature + " " + c.tamt(t.amount)).join("; ") || "-", [c.A("rp_justify")], [c.date("rp_approval")], "Nil", [c.A("rp_justify")]]), { kind: "aoc2" });
    else P(["Nil: all contracts, arrangements and transactions with related parties were at arm's length."]);
    D.h("B. Material contracts or arrangements at arm's length basis", 2);
    const rowsB = rpTx.map((p) => [p.name + (p.relation ? " (" + p.relation + ")" : ""), p.tx.filter((t) => !t.bal).map((t) => t.nature).join(", ") || "-", [c.A("rp_terms")], p.tx.filter((t) => !t.bal).map((t) => t.nature + ": " + c.tamt(t.amount)).join("; ") || "-", [c.date("rp_approval")], "Nil"]);
    if (c.yes("rp_material") && rowsB.length) D.table(["(a) Name and relationship", "(b) Nature of contract", "(c) Duration and (d) salient terms", "(d) Value " + c.inp.unitLine.replace(/^\(All amounts in (.*?),.*$/, "($1)"), "(e) Board approval", "(f) Advances"], rowsB, { kind: "aoc2" });
    else P(c.yes("rp_material") ? ["Particulars: ", c.A("rp_terms"), "."] : ["Nil."]);
    signature(c, D, directors, true);
  }
  if (full && subs.length) {
    annex("Form AOC-1: salient features of the financial statements of subsidiaries, associates and joint ventures");
    D.table(["Name", "Relationship", "Holding %", "Turnover (₹)", "Profit after tax (₹)"], subs.map((s) => [s.name, s.type || "", s.pct || "", s.turnover || "", s.pat || ""]), { num: [2, 3, 4] });
    signature(c, D, directors, true);
  }
  if (full && ap.csr.applies) {
    annex("Annual Report on Corporate Social Responsibility activities");
    [["Brief outline of the CSR policy", "The Company's CSR policy, approved by the Board, sets out the activities in Schedule VII to the Act that the Company undertakes."], ["Composition of the CSR Committee", ap.csr.committee ? c.A("csr_committee") : "Not required: the obligation does not exceed ₹50 lakh, and the Board discharges the functions of the Committee."],
      ["Average net profit of the three preceding years (Section 135(5))", c.has("csr_avg") ? c.amt(ap.csr.avgProfit) : c.A("csr_avg")], ["Two per cent of the average net profit", c.has("csr_avg") ? c.amt(ap.csr.obligation) : c.A("csr_avg")],
      ["Amount spent during the year", c.amt(f.csrSpent)], ["Amount unspent and its treatment", nz(a.csr_unspent) ? String(a.csr_unspent) : "Nil"]].forEach(([k, v], i) => P([{ text: k + ": ", b: true }, v], { num: (i + 1) + ".", indent: 0 }));
    const pr = (Array.isArray(a.csr_projects) ? a.csr_projects : []).filter((x) => x && x.project);
    D.table(["Project / activity", "Amount spent (₹)", "Mode"], pr.length ? pr.map((x) => [x.project, x.amount || "", x.mode || ""]) : [[c.A("csr_projects"), "", ""]], { num: [1] });
    signature(c, D, directors, true);
  }
  if (full && ap.mr3) { annex("Secretarial Audit Report in Form MR-3"); P(["The Secretarial Audit Report in Form MR-3 issued by ", c.A("b_cs"), " is attached."]); }
  return D.doc;
}
const romanNum = (i) => ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][i - 1] || String(i);

function signature(c, D, directors, short) {
  const a = c.a, two = (a.b_signers || "two") === "two";
  const who = (x, fallback) => (x ? [{ text: x.name, b: true }, x.desig ? ", " + x.desig : ", Director", x.din ? " (DIN " + x.din + ")" : ""] : [fallback]);
  const left = ["", "", ...[who(directors[0], c.A("b_directors"))]];
  const right = two ? ["", "", who(directors[1], directors.length ? "Director" : c.A("b_directors"))] : [""];
  D.p([{ text: "For and on behalf of the Board of Directors of " + c.name, b: true }], { keep: true });
  D.sig([[...left, ["Place: ", String(a.e_board_place || c.inp.place || "")], ["Date: ", c.date("e_board_date")]], right]);
  void short;
}
export { romanNum, roman };
