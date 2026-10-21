// The questionnaire behind the Board's Report, the auditor's report and the management representation letter (ROUND 100).
// One set of answers per client per year, kept in the books as b.fs.reports[fy] = {a: {key: value}, at} (synced with the
// books like b.fs.inputs). A year without an answer takes last year's (marked "from last year"), except the answers that
// belong to one year only (carry: false: the figures FinCom reads from the books are worked out again); then what the
// books or the company's details say (pre); then the default.
// Every answer can be changed. Where the law allows a "not applicable" or "none" answer, it is the default.
//
//   QUESTIONS                     the list: {k, s (section), l (label), t (type), o (choices), def, req, when, carry, pre, cols, hint}
//   resolve(store, fy, f, inp)    -> {a: values, src: {k: "given" | "carried" | "books" | "default"}}
//   missing(R, ap, f, only?)      -> the required questions, applicable to this company, with no answer
//   setAnswer(b, fy, k, v)        keeps an answer (v undefined / null: back to the default); returns b.fs.reports[fy]
import { classFromCin } from "./law.js";

const N = (v) => +v || 0;
const yes = (v) => v === true || v === "yes";
export const SECTIONS = [
  ["E", "The company and the engagement"], ["B", "Board's Report"], ["A", "Auditor's report"], ["C", "CARO 2020 (Annexure A)"], ["I", "Internal financial controls (Annexure B)"], ["M", "Management representation"],
];
const YN = [["no", "No"], ["yes", "Yes"]];

export const QUESTIONS = [
  // ---------- the company and the engagement ----------
  { k: "e_class", s: "E", l: "Class of company", t: "choice", o: [["private", "Private company"], ["public", "Unlisted public company"], ["listed", "Listed company"], ["opc", "One person company"], ["s8", "Section 8 company"]], req: true, pre: (f, i) => classFromCin(i.cin) || undefined },
  { k: "e_holdsub", s: "E", l: "Holding or subsidiary company?", t: "choice", o: [["none", "Neither"], ["holding", "Holding company"], ["subsidiary", "Subsidiary of a private company"], ["subsidiary_public", "Subsidiary of a public company"]], def: "none", pre: (f, i) => (i.holding ? "subsidiary" : undefined) },
  { k: "e_sector", s: "E", l: "Governed by a special Act or regulator?", t: "choice", o: [["general", "No (an ordinary company)"], ["nbfc", "NBFC (RBI)"], ["nidhi", "Nidhi company"], ["banking", "Banking company"], ["insurance", "Insurance company"]], def: "general" },
  { k: "e_filing_default", s: "E", l: "Any default in filing financial statements (AOC-4) or annual return (MGT-7)?", t: "choice", o: YN, def: "no" },
  { k: "e_peak_bank", s: "E", l: "Highest borrowings from banks and financial institutions at any time in the year (₹)", t: "num", pre: (f) => f.bankBorrowPeak, carry: false, hint: "Prefilled with the larger of the opening and closing balances; check the daily balances of cash credit and overdraft accounts." },
  { k: "e_peak_borrow", s: "E", l: "Highest borrowings from banks, financial institutions and bodies corporate at any time in the year (₹)", t: "num", pre: (f) => f.borrowPeak, carry: false },
  { k: "e_agm_no", s: "E", l: "Which annual report is this (1 for the first year)?", t: "int", req: true, inc: 1 },
  { k: "e_agm_date", s: "E", l: "Date of the coming annual general meeting", t: "date", carry: false },
  { k: "e_board_date", s: "E", l: "Date of the Board's Report (Board meeting approving the accounts)", t: "date", req: true, carry: false, pre: (f, i) => i.date || undefined },
  { k: "e_board_place", s: "E", l: "Place of signing (Board)", t: "text", pre: (f, i) => i.place || undefined },
  { k: "e_audit_date", s: "E", l: "Date of the auditor's report", t: "date", req: true, carry: false, pre: (f, i) => i.date || undefined },
  { k: "e_udin", s: "E", l: "UDIN of the auditor's report", t: "text", req: true, carry: false, pre: (f, i) => i.udin || undefined },
  { k: "e_format", s: "E", l: "Board's Report format", t: "choice", o: [["auto", "As the law allows (abridged for a small company)"], ["full", "Full (section 134 and Rule 8)"], ["abridged", "Abridged (Rule 8A)"]], def: "auto" },
  { k: "e_mdna", s: "E", l: "Add a Management Discussion and Analysis (voluntary for an unlisted company)?", t: "choice", o: YN, def: "no" },
  { k: "e_cg", s: "E", l: "Add a Report on Corporate Governance (voluntary for an unlisted company)?", t: "choice", o: YN, def: "no" },

  // ---------- Board's Report ----------
  { k: "b_business", s: "B", l: "The company's business, in one or two lines", t: "long", req: true, hint: "e.g. software development and IT-enabled services for customers in India and abroad" },
  { k: "b_events", s: "B", l: "Key developments during the year (optional)", t: "long", def: "", carry: false },
  { k: "b_nature_change", s: "B", l: "Any change in the nature of the business?", t: "choice", o: YN, def: "no", carry: false },
  { k: "b_nature_details", s: "B", l: "The change in the nature of business", t: "long", req: (ap, f, a) => yes(a.b_nature_change), when: (ap, f, a) => yes(a.b_nature_change), carry: false },
  { k: "b_dividend", s: "B", l: "Dividend", t: "choice", o: [["none", "None recommended"], ["final", "Final dividend recommended"], ["interim", "Interim dividend paid"], ["both", "Interim paid and final recommended"]], def: "none", carry: false, pre: (f) => (f.dividendPaid > 0 ? "interim" : undefined) },
  { k: "b_div_interim", s: "B", l: "Interim dividend per share (₹) and date declared", t: "text", req: (ap, f, a) => /interim|both/.test(a.b_dividend), when: (ap, f, a) => /interim|both/.test(a.b_dividend), carry: false },
  { k: "b_div_final", s: "B", l: "Final dividend recommended per share (₹)", t: "num", req: (ap, f, a) => /final|both/.test(a.b_dividend), when: (ap, f, a) => /final|both/.test(a.b_dividend), carry: false },
  { k: "b_reserve", s: "B", l: "Amount transferred to reserves (₹)", t: "num", pre: (f) => f.reserveTransfer, carry: false },
  { k: "b_share_changes", s: "B", l: "Shares issued, bought back or converted during the year", t: "long", req: (ap, f) => f.sharesChanged, when: (ap, f) => f.sharesChanged, carry: false, hint: "FinCom sees a change in share capital: number, class, price and purpose." },
  { k: "b_esop", s: "B", l: "Employee stock option scheme: Rule 12(9) particulars", t: "long", req: (ap, f) => f.esopCharge > 0, when: (ap, f) => f.esopCharge > 0 },
  { k: "b_material", s: "B", l: "Material changes and commitments after the year end (blank: none)", t: "long", def: "", carry: false },
  { k: "b_subs", s: "B", l: "Subsidiaries, joint ventures and associates", t: "rows", cols: [["name", "Name"], ["type", "Subsidiary / JV / associate"], ["pct", "Holding %"], ["turnover", "Turnover (₹)"], ["pat", "Profit after tax (₹)"]], def: [] },
  { k: "b_deposits", s: "B", l: "Deposits accepted or renewed during the year (Chapter V)?", t: "choice", o: YN, def: "no", carry: false },
  { k: "b_deposit_details", s: "B", l: "Deposits: accepted, unpaid at the year end, defaults", t: "long", req: (ap, f, a) => yes(a.b_deposits), when: (ap, f, a) => yes(a.b_deposits), carry: false },
  { k: "b_dir_decl", s: "B", l: "Have the directors who lent money declared it is not out of borrowed funds (Rule 2(1)(c)(viii))?", t: "choice", o: YN, def: "yes", when: (ap, f) => f.directorLoans.length > 0 },
  { k: "b_loan_purpose", s: "B", l: "Purpose of the loans given and investments made (s.186)", t: "long", req: (ap, f) => f.loansGiven.length + f.investments.length > 0, when: (ap, f) => f.loansGiven.length + f.investments.length > 0 },
  { k: "b_guarantees", s: "B", l: "Guarantees given or security provided (blank: none)", t: "long", def: "" },
  { k: "rp_parties", s: "B", l: "Related parties (names as in the books) and relationship", t: "rows", cols: [["name", "Name"], ["relation", "Relationship"]], def: [], pre: (f, i) => {
    const l = (i.directors || []).filter((x) => x && x.name).map((x) => ({ name: x.name, relation: x.desig || "Director" }));
    if (i.holding) l.push({ name: i.holding, relation: "Holding company" });
    return l.length ? l : undefined; } },
  { k: "rp_material", s: "B", l: "Any material contract or arrangement with a related party under s.188(1)?", t: "choice", o: YN, def: "no", carry: false },
  { k: "rp_not_arm", s: "B", l: "Any related party contract NOT at arm's length or not in the ordinary course?", t: "choice", o: YN, def: "no", carry: false },
  { k: "rp_terms", s: "B", l: "Related party contracts: duration and salient terms", t: "long", req: (ap, f, a) => yes(a.rp_material) || yes(a.rp_not_arm), when: (ap, f, a) => yes(a.rp_material) || yes(a.rp_not_arm) },
  { k: "rp_approval", s: "B", l: "Date of approval by the Board", t: "date", req: (ap, f, a) => yes(a.rp_material) || yes(a.rp_not_arm), when: (ap, f, a) => yes(a.rp_material) || yes(a.rp_not_arm), carry: false },
  { k: "rp_justify", s: "B", l: "Justification for the contract not at arm's length; date of the special resolution", t: "long", req: (ap, f, a) => yes(a.rp_not_arm), when: (ap, f, a) => yes(a.rp_not_arm), carry: false },
  { k: "b_directors", s: "B", l: "Directors as on the date of the report", t: "rows", cols: [["name", "Name"], ["din", "DIN"], ["desig", "Designation"]], req: true, pre: (f, i) => ((i.directors || []).filter((x) => x && x.name).length ? i.directors.filter((x) => x && x.name).map((x) => ({ name: x.name, din: x.din || "", desig: x.desig || "Director" })) : undefined) },
  { k: "b_dir_changes", s: "B", l: "Directors and KMP appointed, resigned or re-appointed during the year (none: leave empty)", t: "rows", cols: [["name", "Name"], ["din", "DIN"], ["desig", "Designation"], ["change", "Appointed / resigned / re-appointed"], ["date", "With effect from"]], def: [], carry: false },
  { k: "b_kmp", s: "B", l: "Key managerial personnel (name and designation)", t: "text", req: (ap) => ap.pub, when: (ap) => ap.pub },
  { k: "b_rotation", s: "B", l: "Director retiring by rotation at the coming AGM", t: "text", req: (ap) => ap.rotation, when: (ap) => ap.rotation, carry: false },
  { k: "b_ids", s: "B", l: "Does the company have independent directors?", t: "choice", o: YN, def: "no" },
  { k: "b_meetings", s: "B", l: "Dates of the Board meetings held during the year", t: "rows", cols: [["date", "Date"]], req: true, carry: false },
  { k: "b_aud_first", s: "B", l: "Is the auditor the first auditor appointed by the Board (s.139(6))?", t: "choice", o: YN, def: "no" },
  { k: "b_aud_agm", s: "B", l: "The auditor was appointed at which AGM (number), held on", t: "text", req: (ap, f, a) => !yes(a.b_aud_first), hint: "e.g. 7th AGM held on 30th September, 2022" },
  { k: "b_aud_till", s: "B", l: "The auditor holds office until the conclusion of which AGM", t: "text", req: (ap, f, a) => !yes(a.b_aud_first), hint: "e.g. 12th AGM" },
  { k: "b_aud_reply", s: "B", l: "The Board's explanation of the auditor's qualification, reservation or adverse remark", t: "long", req: (ap, f, a) => (a.a_opinion || "unmodified") !== "unmodified", when: (ap, f, a) => (a.a_opinion || "unmodified") !== "unmodified", carry: false },
  { k: "b_fraud", s: "B", l: "Did the auditor report any fraud to the Board under s.143(12)?", t: "choice", o: YN, def: "no", carry: false },
  { k: "b_fraud_details", s: "B", l: "The fraud: nature, amount and action taken", t: "long", req: (ap, f, a) => yes(a.b_fraud), when: (ap, f, a) => yes(a.b_fraud), carry: false },
  { k: "b_cs", s: "B", l: "Secretarial auditor (name, CP number) and remarks, if any", t: "text", req: (ap) => ap.mr3, when: (ap) => ap.mr3 },
  { k: "b_cost", s: "B", l: "Cost records under s.148(1)", t: "choice", o: [["na", "Not applicable to the company's business"], ["records", "Records kept, no cost audit"], ["audit", "Records kept and cost audit"]], def: "na" },
  { k: "b_cost_auditor", s: "B", l: "Cost auditor (name, FRN)", t: "text", req: (ap, f, a) => a.b_cost === "audit", when: (ap, f, a) => a.b_cost === "audit" },
  { k: "b_risks", s: "B", l: "The main risks the Board watches", t: "text", def: "market, credit, liquidity, regulatory and information security risks" },
  { k: "csr_np", s: "B", l: "Net profit of the preceding year under s.198 (₹), for CSR", t: "num", pre: (f) => f.pbtPy, carry: false },
  { k: "csr_avg", s: "B", l: "Average net profit of the three preceding years under s.198 (₹)", t: "num", req: (ap) => ap.csr.applies, when: (ap) => ap.csr.applies, carry: false },
  { k: "csr_projects", s: "B", l: "CSR projects and amounts spent", t: "rows", cols: [["project", "Project / activity (Schedule VII item)"], ["amount", "Amount spent (₹)"], ["mode", "Direct / through agency"]], req: (ap) => ap.csr.applies, when: (ap) => ap.csr.applies, carry: false },
  { k: "csr_committee", s: "B", l: "CSR committee members (if the obligation exceeds ₹50 lakh)", t: "text", req: (ap) => ap.csr.applies && ap.csr.committee, when: (ap) => ap.csr.applies },
  { k: "csr_unspent", s: "B", l: "Unspent CSR amount: what was done with it and why (blank: none)", t: "long", def: "", when: (ap) => ap.csr.applies, carry: false },
  { k: "b_energy", s: "B", l: "Conservation of energy: steps taken", t: "long", def: "The operations of the Company are not energy-intensive. Even so, the Company uses energy-efficient lighting and equipment and encourages the switching off of equipment when not in use." },
  { k: "b_energy_alt", s: "B", l: "Alternate sources of energy used (blank: none)", t: "text", def: "" },
  { k: "b_energy_capex", s: "B", l: "Capital investment on energy conservation equipment (₹)", t: "num", def: 0 },
  { k: "b_tech", s: "B", l: "Technology absorption: efforts and benefits", t: "long", def: "The Company uses technology that is readily available in the market and keeps it up to date; the benefit is better productivity and quality of service." },
  { k: "b_tech_import", s: "B", l: "Technology imported in the last three years (blank: none)", t: "text", def: "" },
  { k: "b_rnd", s: "B", l: "Expenditure on research and development (₹)", t: "num", pre: (f) => f.rnd, def: 0, carry: false },
  { k: "b_fx_in", s: "B", l: "Foreign exchange earned: actual inflows (₹)", t: "num", pre: (f) => f.fxIn, carry: false, hint: "Prefilled with export sales as booked: replace with the actual receipts in foreign exchange." },
  { k: "b_fx_out", s: "B", l: "Foreign exchange outgo: actual outflows (₹)", t: "num", pre: (f) => f.fxOut, carry: false },
  { k: "b_orders", s: "B", l: "Significant orders of regulators, courts or tribunals affecting the going concern (blank: none)", t: "long", def: "", carry: false },
  { k: "b_web", s: "B", l: "Web address where the annual return is placed (blank: the company has no website)", t: "text", def: "" },
  { k: "b_posh_ic", s: "B", l: "Internal Committee constituted under the POSH Act?", t: "choice", o: [["yes", "Yes"], ["lc", "No: fewer than ten employees (Local Committee)"]], def: "yes" },
  { k: "b_posh_recv", s: "B", l: "POSH: complaints received in the year", t: "int", req: true, carry: false },
  { k: "b_posh_disp", s: "B", l: "POSH: complaints disposed of in the year", t: "int", req: true, carry: false },
  { k: "b_posh_pend", s: "B", l: "POSH: cases pending for more than 90 days", t: "int", req: true, carry: false },
  { k: "b_maternity", s: "B", l: "Has the company complied with the Maternity Benefit Act, 1961?", t: "choice", o: [["yes", "Yes"], ["no", "No"]], req: true, carry: false },
  { k: "b_emp_f", s: "B", l: "Employees at the year end: female", t: "int", req: true, carry: false },
  { k: "b_emp_m", s: "B", l: "Employees at the year end: male", t: "int", req: true, carry: false },
  { k: "b_emp_t", s: "B", l: "Employees at the year end: transgender", t: "int", def: 0, carry: false },
  { k: "b_ibc", s: "B", l: "Applications made or proceedings pending under the IBC (blank: none)", t: "long", def: "", carry: false },
  { k: "b_ots", s: "B", l: "One-time settlement with a bank or financial institution (blank: none)", t: "long", def: "", carry: false },
  { k: "b_committees", s: "B", l: "Audit Committee and NRC: members; recommendations not accepted", t: "long", req: (ap) => ap.committees, when: (ap) => ap.committees || ap.vigil },
  { k: "b_evaluation", s: "B", l: "Manner of the annual evaluation of the Board, committees and directors", t: "long", req: (ap) => ap.evaluation, when: (ap) => ap.evaluation },
  { k: "b_signers", s: "B", l: "Signed by", t: "choice", o: [["two", "Two directors"], ["chair", "The Chairperson authorised by the Board"]], def: "two" },
  { k: "md_industry", s: "B", l: "MD&A: industry structure, opportunities and threats", t: "long", req: (ap) => ap.mdna, when: (ap) => ap.mdna },
  { k: "md_outlook", s: "B", l: "MD&A: outlook, risks and concerns", t: "long", req: (ap) => ap.mdna, when: (ap) => ap.mdna },
  { k: "md_hr", s: "B", l: "MD&A: human resources", t: "long", req: (ap) => ap.mdna, when: (ap) => ap.mdna },
  { k: "cg_philosophy", s: "B", l: "Corporate governance: the company's philosophy", t: "long", req: (ap) => ap.cg, when: (ap) => ap.cg },
  { k: "cg_agms", s: "B", l: "Corporate governance: last three general meetings and special resolutions", t: "long", req: (ap) => ap.cg, when: (ap) => ap.cg },

  // ---------- auditor's report ----------
  { k: "a_opinion", s: "A", l: "Opinion", t: "choice", o: [["unmodified", "Unmodified"], ["qualified", "Qualified"], ["adverse", "Adverse"], ["disclaimer", "Disclaimer of opinion"]], def: "unmodified", carry: false },
  { k: "a_mod_matter", s: "A", l: "The matter giving rise to the modification, with its effect (amount) where it can be worked out", t: "long", req: (ap, f, a) => (a.a_opinion || "unmodified") !== "unmodified", when: (ap, f, a) => (a.a_opinion || "unmodified") !== "unmodified", carry: false },
  { k: "a_mod_note", s: "A", l: "Note number the matter is disclosed in (if any)", t: "text", def: "", when: (ap, f, a) => (a.a_opinion || "unmodified") !== "unmodified", carry: false },
  { k: "a_gc", s: "A", l: "Material uncertainty related to going concern (blank: none)", t: "long", def: "", carry: false },
  { k: "a_kam_voluntary", s: "A", l: "Report key audit matters voluntarily?", t: "choice", o: YN, def: "no" },
  { k: "a_kam", s: "A", l: "Key audit matters", t: "rows", cols: [["matter", "The matter and why it mattered"], ["response", "How the audit addressed it"]], req: (ap) => ap.kam, when: (ap) => ap.kam, carry: false },
  { k: "a_eom", s: "A", l: "Emphasis of matter (blank: none)", t: "long", def: "", carry: false },
  { k: "a_om", s: "A", l: "Other matter, e.g. the previous year audited by another auditor (blank: none)", t: "long", def: "" },
  { k: "a_other_info", s: "A", l: "The Board's Report (other information) at the date of the auditor's report", t: "choice", o: [["received", "Received and read: nothing to report"], ["later", "To be received after the date of the report"], ["misstated", "Received: a material misstatement found"]], def: "received", carry: false },
  { k: "a_other_info_text", s: "A", l: "The misstatement in the other information", t: "long", req: (ap, f, a) => a.a_other_info === "misstated", when: (ap, f, a) => a.a_other_info === "misstated", carry: false },
  { k: "a_branches", s: "A", l: "Branches audited by other auditors (blank: none)", t: "text", def: "" },
  { k: "a_backup", s: "A", l: "Back-up of the books on servers in India kept daily (Rule 3(5))?", t: "choice", o: [["yes", "Yes"], ["no", "No (an exception in 143(3)(b))"]], def: "yes" },
  { k: "a_dir8", s: "A", l: "Written representations from the directors (DIR-8) taken on record by the Board?", t: "choice", o: [["yes", "Yes: no director disqualified"], ["no", "No / a director disqualified"]], def: "yes", carry: false },
  { k: "a_litigation", s: "A", l: "Pending litigations affecting the financial position", t: "rows", cols: [["matter", "Matter"], ["amount", "Amount (₹)"], ["note", "Note"]], def: [] },
  { k: "a_ltc", s: "A", l: "Long-term contracts or derivatives with material foreseeable losses?", t: "choice", o: YN, def: "no" },
  { k: "a_iepf", s: "A", l: "Transfers to the Investor Education and Protection Fund", t: "choice", o: [["na", "None required"], ["done", "Made without delay"], ["delayed", "Delayed"]], def: "na" },
  { k: "a_11e", s: "A", l: "Rule 11(e): representations received and nothing to the contrary noticed?", t: "choice", o: [["yes", "Yes"], ["no", "No: an exception"]], def: "yes", carry: false },
  { k: "a_11e_text", s: "A", l: "Rule 11(e): the exception", t: "long", req: (ap, f, a) => a.a_11e === "no", when: (ap, f, a) => a.a_11e === "no", carry: false },
  { k: "a_trail", s: "A", l: "Audit trail (edit log), Rule 11(g)", t: "choice", o: [["v1", "Enabled all year for all transactions, not tampered with, preserved"], ["v2", "Enabled only from a date in the year"], ["v3", "No log at the database level"], ["v4", "The software has no audit trail feature"], ["v5", "Not enabled for some users or modules"], ["v6", "Third-party software, no service organisation report"], ["v7", "Last year's audit trail not verified as preserved"], ["v8", "Instances of tampering noticed"]], def: "v1" },
  { k: "a_trail_soft", s: "A", l: "Accounting software used", t: "text", def: "Tally Prime" },
  { k: "a_trail_detail", s: "A", l: "Audit trail: the date it was enabled, the users / modules, or what was noticed", t: "text", req: (ap, f, a) => ["v2", "v5", "v8"].includes(a.a_trail), when: (ap, f, a) => (a.a_trail || "v1") !== "v1", carry: false },
  { k: "a_remun", s: "A", l: "Managerial remuneration within s.197 and Schedule V?", t: "choice", o: [["yes", "Yes"], ["no", "No: excess paid"]], def: "yes", when: (ap) => ap.s197, carry: false },
  { k: "a_remun_text", s: "A", l: "Remuneration in excess of the limits: amount and status", t: "long", req: (ap, f, a) => ap.s197 && a.a_remun === "no", when: (ap, f, a) => ap.s197 && a.a_remun === "no", carry: false },

  // ---------- CARO 2020 ----------
  { k: "c_ppe_records", s: "C", l: "3(i)(a): proper records of PPE (quantity, situation) and intangibles?", t: "choice", o: [["yes", "Yes"], ["no", "No"]], def: "yes", when: (ap) => ap.caro.applies },
  { k: "c_ppe_verify", s: "C", l: "3(i)(b): physical verification of PPE", t: "choice", o: [["year", "Verified during the year, no material discrepancy"], ["programme", "Under a phased programme, no material discrepancy"], ["disc", "Material discrepancies found"]], def: "year", when: (ap) => ap.caro.applies },
  { k: "c_ppe_disc", s: "C", l: "3(i)(b): the discrepancies and how they were dealt with", t: "long", req: (ap, f, a) => ap.caro.applies && a.c_ppe_verify === "disc", when: (ap, f, a) => ap.caro.applies && a.c_ppe_verify === "disc", carry: false },
  { k: "c_title", s: "C", l: "3(i)(c): title deeds of immovable property (exceptions, blank: none)", t: "long", def: "", when: (ap, f) => ap.caro.applies && f.immovable },
  { k: "c_reval", s: "C", l: "3(i)(d): PPE or intangibles revalued during the year (blank: no)", t: "text", def: "", when: (ap) => ap.caro.applies, carry: false },
  { k: "c_benami", s: "C", l: "3(i)(e): benami proceedings (blank: none)", t: "text", def: "", when: (ap) => ap.caro.applies },
  { k: "c_inv_verify", s: "C", l: "3(ii)(a): physical verification of inventory: when, and discrepancies of 10% or more (blank: none)", t: "long", req: (ap, f) => ap.caro.applies && f.inventory > 0.5, when: (ap, f) => ap.caro.applies && f.inventory > 0.5, carry: false },
  { k: "c_wc_limits", s: "C", l: "3(ii)(b): working capital limits above ₹5 crore on the security of current assets?", t: "choice", o: YN, def: "no", when: (ap) => ap.caro.applies },
  { k: "c_wc_agree", s: "C", l: "3(ii)(b): the quarterly statements filed with the banks: differences (blank: they agree with the books)", t: "long", def: "", when: (ap, f, a) => ap.caro.applies && yes(a.c_wc_limits), carry: false },
  { k: "c_loans_terms", s: "C", l: "3(iii)(b)-(f): loans given: terms, repayment, overdue, renewals, demand loans (blank: regular, nothing overdue)", t: "long", def: "", when: (ap, f) => ap.caro.applies && f.loansGiven.length + f.investments.length > 0, carry: false },
  { k: "c_185", s: "C", l: "3(iv): sections 185 and 186 complied with (blank: yes)", t: "long", def: "", when: (ap) => ap.caro.applies },
  { k: "c_stat_late", s: "C", l: "3(vii)(a): were undisputed statutory dues deposited regularly?", t: "choice", o: [["yes", "Regularly"], ["generally", "Generally regularly, with slight delays"], ["no", "Not regularly"]], def: "yes", when: (ap) => ap.caro.applies, carry: false },
  { k: "c_disputes", s: "C", l: "3(vii)(b): dues not deposited on account of a dispute", t: "rows", cols: [["statute", "Statute"], ["nature", "Nature of dues"], ["amount", "Amount (₹)"], ["period", "Period"], ["forum", "Forum where pending"]], def: [], when: (ap) => ap.caro.applies },
  { k: "c_unrecorded", s: "C", l: "3(viii): income surrendered in tax assessments (blank: none)", t: "text", def: "", when: (ap) => ap.caro.applies, carry: false },
  { k: "c_default", s: "C", l: "3(ix)(a)-(b): default in repaying lenders, or declared a wilful defaulter (blank: none)", t: "long", def: "", when: (ap) => ap.caro.applies, carry: false },
  { k: "c_term_use", s: "C", l: "3(ix)(c): term loans applied for their purpose? (blank: yes)", t: "text", def: "", when: (ap, f) => ap.caro.applies && f.termLoans.length > 0, carry: false },
  { k: "c_st_lt", s: "C", l: "3(ix)(d): short-term funds used for long-term purposes (blank: none)", t: "text", def: "", when: (ap) => ap.caro.applies, carry: false },
  { k: "c_pref", s: "C", l: "3(x)(b): preferential allotment or private placement: compliance with s.42 / s.62 and use of the money", t: "long", req: (ap, f) => ap.caro.applies && f.sharesChanged, when: (ap, f) => ap.caro.applies && f.sharesChanged, carry: false },
  { k: "c_fraud", s: "C", l: "3(xi): fraud by or on the company, ADT-4 filed, whistle-blower complaints (blank: none)", t: "long", def: "", when: (ap) => ap.caro.applies, carry: false },
  { k: "c_ia_reports", s: "C", l: "3(xiv): internal audit reports considered (blank: yes)", t: "text", def: "", when: (ap) => ap.caro.applies && ap.internalAudit },
  { k: "c_noncash", s: "C", l: "3(xv): non-cash transactions with directors or connected persons (blank: none)", t: "text", def: "", when: (ap) => ap.caro.applies, carry: false },
  { k: "c_nbfc", s: "C", l: "3(xvi): registration under s.45-IA of the RBI Act required? (blank: no)", t: "text", def: "", when: (ap) => ap.caro.applies },
  { k: "c_resign", s: "C", l: "3(xviii): resignation of the statutory auditors during the year (blank: none)", t: "text", def: "", when: (ap) => ap.caro.applies, carry: false },
  { k: "c_xix", s: "C", l: "3(xix): any material uncertainty about meeting liabilities due within a year? (blank: none)", t: "long", def: "", when: (ap) => ap.caro.applies, carry: false },
  { k: "c_csr", s: "C", l: "3(xx): unspent CSR amount transferred as required? (blank: no unspent amount)", t: "text", def: "", when: (ap) => ap.caro.applies && ap.csr.applies, carry: false },

  // ---------- internal financial controls ----------
  { k: "i_opinion", s: "I", l: "Opinion on internal financial controls", t: "choice", o: [["unmodified", "Adequate and operating effectively"], ["qualified", "Qualified: a material weakness"], ["adverse", "Adverse"], ["disclaimer", "Disclaimer"]], def: "unmodified", when: (ap) => ap.ifc.applies, carry: false },
  { k: "i_weakness", s: "I", l: "The material weakness and its possible effect", t: "long", req: (ap, f, a) => ap.ifc.applies && (a.i_opinion || "unmodified") !== "unmodified", when: (ap, f, a) => ap.ifc.applies && (a.i_opinion || "unmodified") !== "unmodified", carry: false },

  // ---------- management representation ----------
  { k: "m_engagement", s: "M", l: "Date of the audit engagement letter", t: "date", req: true },
  { k: "m_signer", s: "M", l: "Signed by (MD / director, and CFO)", t: "rows", cols: [["name", "Name"], ["desig", "Designation"], ["din", "DIN (if a director)"]], pre: (f, i) => ((i.directors || []).filter((x) => x && x.name).length ? i.directors.filter((x) => x && x.name).slice(0, 2).map((x) => ({ name: x.name, desig: x.desig || "Director", din: x.din || "" })) : undefined), req: true },
  { k: "m_events", s: "M", l: "Events after the balance sheet date to disclose (blank: none)", t: "long", def: "", carry: false },
  { k: "m_misstatements", s: "M", l: "Uncorrected misstatements (none: leave empty)", t: "rows", cols: [["item", "Item"], ["amount", "Effect on profit (₹)"]], def: [], carry: false },
  { k: "m_contingent", s: "M", l: "Contingent liabilities (blank: none)", t: "long", def: "", carry: false },
  { k: "m_commitments", s: "M", l: "Capital commitments (₹)", t: "num", def: 0, carry: false },
  { k: "m_charges", s: "M", l: "Charges on the assets (blank: none)", t: "long", def: "", pre: (f) => (f.secured.length ? "Hypothecation / mortgage in favour of the lender for " + f.secured.map((x) => x.ledger).join(", ") : undefined) },
  { k: "m_policy", s: "M", l: "Change in accounting policies (blank: none)", t: "long", def: "", carry: false },
  { k: "m_plans", s: "M", l: "Going concern: the management's plans", t: "long", req: (ap, f) => f.pat < 0 || f.netWorth < 0 || f.cashLoss > 0, when: (ap, f) => f.pat < 0 || f.netWorth < 0 || f.cashLoss > 0, carry: false },
  { k: "m_cash_date", s: "M", l: "Date the cash on hand was counted", t: "date", pre: (f) => f.fyEnd, carry: false },
  { k: "m_ppe_verify", s: "M", l: "When PPE were physically verified", t: "text", def: "during the year" },
  { k: "m_struck", s: "M", l: "Transactions with companies struck off under s.248 (blank: none)", t: "text", def: "" },
];
export const Q = Object.fromEntries(QUESTIONS.map((q) => [q.k, q]));

// the answers for a year: given this year, else last year's (carry), else from the books (pre), else the default
export function resolve(store, fy, f, inp) {
  const y = Number(String(fy).slice(0, 4)), cur = ((store || {})[y] || (store || {})[String(y)] || {}).a || {}, prev = ((store || {})[y - 1] || (store || {})[String(y - 1)] || {}).a || {};
  const a = {}, src = {};
  QUESTIONS.forEach((q) => {
    if (Object.prototype.hasOwnProperty.call(cur, q.k) && cur[q.k] !== undefined && cur[q.k] !== null) { a[q.k] = cur[q.k]; src[q.k] = "given"; return; }
    if (q.carry !== false && Object.prototype.hasOwnProperty.call(prev, q.k) && prev[q.k] !== undefined && prev[q.k] !== null) { a[q.k] = q.inc && prev[q.k] !== "" ? N(prev[q.k]) + q.inc : prev[q.k]; src[q.k] = "carried"; return; }
    const p = q.pre ? q.pre(f || {}, inp || {}) : undefined;
    if (p !== undefined && p !== null) { a[q.k] = p; src[q.k] = "books"; return; }
    if (Object.prototype.hasOwnProperty.call(q, "def")) { a[q.k] = q.def; src[q.k] = "default"; return; }
    src[q.k] = "";
  });
  return { a, src, fy: y };
}
export const shown = (q, ap, f, a) => !q.when || !!q.when(ap, f || {}, a || {});
const required = (q, ap, f, a) => (typeof q.req === "function" ? !!q.req(ap, f || {}, a || {}) : !!q.req);
export function isMissing(q, v) {
  if (v === undefined || v === null) return true;
  if (q.t === "rows") return !Array.isArray(v) || !v.length;
  return String(v).trim() === "";
}
export function missing(R, ap, f, only) {
  return QUESTIONS.filter((q) => (!only || only.includes(q.s)) && shown(q, ap, f, R.a) && required(q, ap, f, R.a) && isMissing(q, R.a[q.k]));
}
export function setAnswer(b, fy, k, v) {
  b.fs = b.fs || {};
  const all = Object.assign({}, b.fs.reports), y = String(Number(String(fy).slice(0, 4))), cur = Object.assign({ a: {} }, all[y]);
  cur.a = Object.assign({}, cur.a);
  if (v === undefined || v === null) delete cur.a[k]; else cur.a[k] = v;
  cur.at = new Date().toISOString();
  all[y] = cur; b.fs.reports = all;
  return cur;
}
