// The management representation letter (ROUND 100): the written representations SA 580 calls for, with those of SA 240,
// 250, 450, 501, 540, 550, 560, 570 and 710, and the confirmations that support the CARO 2020 answers, Rule 11(e) to
// (g) and the additional regulatory information of Schedule III. Addressed to the auditor, on the company's letterhead,
// dated on or just before the date of the auditor's report, signed by those responsible for the financial statements.
// Amounts come from the books (FinSt) in the page's unit; the rest from the questionnaire. FinCom's own wording.
//
//   mrl(c)  c: makeContext(...) -> a document (doc.js)
import { makeDoc } from "./doc.js";
import { relatedTx } from "./facts.js";

const N = (v) => +v || 0;
const nz = (v) => v !== undefined && v !== null && String(v).trim() !== "";

export function mrl(c) {
  const { f, ap, a, inp } = c, D = makeDoc("mrl", "Management representation letter"), P = (r, o) => D.p(r, o);
  const au = inp.auditor || {};
  let n = 0;
  const item = (runs) => { n += 1; P(runs, { num: n + "." }); };
  D.title(c.name, [inp.address, inp.cin ? "CIN: " + inp.cin : ""].filter(Boolean).join(" · "));
  P(["Date: ", c.date("e_audit_date")], { align: "right" });
  P(["To"]);
  P([{ text: "M/s " + (au.firm || ""), b: true }, ", Chartered Accountants", au.frn ? " (Firm Registration No. " + au.frn + ")" : "", au.place ? ", " + au.place : ""]);
  P([{ text: "Sub: Representations for the audit of the financial statements for the year ended " + c.yearEnd, b: true }]);
  P(["Dear Sirs,"]);
  P(["We give this letter in connection with your audit of the financial statements of ", c.name, inp.cin ? " (CIN " + inp.cin + ")" : "", ", comprising the Balance Sheet as at ", c.yearEnd, ", the Statement of Profit and Loss", ap.cashFlow ? " and the Statement of Cash Flows" : "",
    " for the year then ended and the notes, including a summary of the significant accounting policies, for the purpose of your opinion on whether they give a true and fair view in accordance with the Accounting Standards notified under Section 133 of the Companies Act, 2013 (\"the Act\") and the other accounting principles generally accepted in India."]);
  P(["Having made the enquiries we considered necessary to inform ourselves, we confirm, to the best of our knowledge and belief, as follows."]);

  D.h("A. The financial statements", 2);
  item(["We have carried out our responsibility, set out in the terms of the audit engagement dated ", c.date("m_engagement"), ", for preparing the financial statements under the Act, including Schedule III (Division I), and the Accounting Standards, and they give a true and fair view."]);
  item(["The significant assumptions used in making accounting estimates", f.estimates.length ? ", including " + f.estimates.join(", ") : "", ", are reasonable."]);
  const rp = relatedTx(c.dR, a.rp_parties);
  item(["We have told you who all the related parties are and of all relationships and transactions with them of which we are aware, and these have been accounted for and disclosed as Accounting Standard 18 requires", rp.length ? " (listed in Annexure 2 to this letter)" : "", "."]);
  item([nz(a.m_events) ? "Events after the balance sheet date for which the Accounting Standards call for adjustment or disclosure have been adjusted or disclosed. In particular: " + String(a.m_events).trim() : "All events after the balance sheet date for which the Accounting Standards call for adjustment or disclosure have been adjusted or disclosed; there is none other to report."]);
  const mis = (Array.isArray(a.m_misstatements) ? a.m_misstatements : []).filter((x) => x && x.item);
  item([mis.length ? "In our view the uncorrected misstatements listed in Annexure 1 to this letter are not material, singly or together, to the financial statements as a whole." : "We are not aware of any uncorrected misstatement in the financial statements (Annexure 1: nil)."]);
  const gcFlag = f.pat < 0 || f.netWorth < 0 || f.cashLoss > 0;
  item(gcFlag ? ["We have assessed whether the Company can continue as a going concern", f.pat < 0 ? ", having regard to the loss of " + c.amt(-f.pat) + " for the year" : "", f.netWorth < 0 ? " and the negative net worth of " + c.amt(-f.netWorth) : "", ". Our plans are: ", c.A("m_plans"), ". We are not aware of any material uncertainty that may cast significant doubt on that ability."] :
    ["We are not aware of any material uncertainty that may cast significant doubt on the Company's ability to continue as a going concern."]);
  item([nz(a.m_policy) ? "The accounting policies have changed as follows: " + String(a.m_policy).trim() + ". The previous year's figures have been regrouped or reclassified only where necessary." : "There has been no change in the accounting policies, and the previous year's figures have been regrouped or reclassified only where necessary."]);

  D.h("B. Information given to you", 2);
  item(["We have given you access to all the information we know to be relevant to the preparation of the financial statements, including the records, documents and minutes of the meetings of the Board, its committees and the members, all further information you asked for, and unrestricted access to the people in the Company from whom you wished to obtain evidence."]);
  item(["All transactions have been recorded in the books of account and are reflected in the financial statements."]);
  item(["We accept responsibility for designing, implementing and maintaining internal control to prevent and detect fraud. We have told you the results of our assessment of the risk that the financial statements may be materially misstated as a result of fraud. We know of no fraud or suspected fraud affecting the Company involving the management, employees with significant roles in internal control, or others where it could materially affect the financial statements, and of no allegation of fraud made by employees, former employees, regulators or anyone else."]);
  item(["We have told you of every known instance of non-compliance, or suspected non-compliance, with laws and regulations whose effects should be considered in preparing the financial statements."]);
  item(["We have told you of all known actual or possible litigation and claims whose effects should be considered in preparing the financial statements, and they have been accounted for and disclosed under Accounting Standard 29. Contingent liabilities: ", nz(a.m_contingent) ? String(a.m_contingent).trim() : "nil", "; capital commitments: ", N(a.m_commitments) ? c.amt(a.m_commitments) : "nil", "."]);

  D.h("C. Assets", 2);
  item(["The Company has satisfactory title to all its assets, and there is no lien or encumbrance on them ", nz(a.m_charges) ? "other than the following: " + String(a.m_charges).trim().replace(/\.$/, "") : "", "."]);
  const hasPPE = f.ppeNet > 0.5 || f.ppeAdd > 0.5 || f.intangibles > 0.5;
  if (hasPPE) item(["Property, plant and equipment: the additions of ", c.amt(f.ppeAdd), " during the year are capital expenditure only", f.ppeSaleCost > 0.5 ? "; the assets sold or discarded (cost " + c.amt(f.ppeSaleCost) + ") have been removed from the books" : "", "; depreciation has been provided as Schedule II to the Act requires. The assets were physically verified ", String(a.m_ppe_verify || "during the year"), " and no material discrepancy was found. ", f.immovable ? "The title deeds of all immovable property are held in the name of the Company. " : "", "No property, plant and equipment or intangible asset has been revalued."]);
  item([f.inventory > 0.5 ? "Inventories of " + c.amt(f.inventory) + " were physically verified at reasonable intervals, no discrepancy of ten per cent or more was found in any class, and they are valued at the lower of cost and net realisable value." : "The Company does not hold any inventory."]);
  if (f.invNC + f.invC > 0.5) item(["The investments (non-current ", c.amt(f.invNC), "; current ", c.amt(f.invC), ") are held in the Company's own name, are valued as Accounting Standard 13 requires, and none is held for anyone else."]);
  item(["Trade receivables of ", c.amt(f.receivables), " are good and recoverable", f.doubtful > 0.5 ? ", save for " + c.amt(f.doubtful) + " for which provision has been made" : "", "."]);
  item(["The cash on hand of ", c.amt(f.cash), " was counted by the management on ", c.date("m_cash_date"), ". The balances with banks of ", c.amt(f.bank), f.fd > 0.5 ? " and the deposits of " + c.amt(f.fd) : "", " agree with the bank statements and confirmations, and the reconciliations have no unexplained items."]);

  D.h("D. Liabilities", 2);
  item(["All known liabilities have been recorded, including the employee benefit obligations under Accounting Standard 15", f.gratuity > 0.5 ? " (gratuity " + c.amt(f.gratuity) + (f.leave > 0.5 ? ", leave encashment " + c.amt(f.leave) : "") + ")" : "", ", and all guarantees given by the Company have been disclosed."]);
  item(["Dues to micro and small enterprises have been identified from the information received from suppliers", f.msme > 0.5 ? " (" + c.amt(f.msme) + " at the year end)" : "", "; interest payable under the Micro, Small and Medium Enterprises Development Act, 2006 has been provided where due, and the half-yearly returns in MSME Form I have been filed where required."]);
  const disp = (Array.isArray(a.c_disputes) ? a.c_disputes : []).filter((x) => x && x.statute);
  item(["Undisputed statutory dues, including provident fund, employees' state insurance, income tax, goods and services tax and cess, have been deposited regularly with the authorities. ", f.statDues.length ? "The following were outstanding at the year end for more than six months from the date they became payable: " + f.statDues.map((x) => x.nature + " (" + x.ledger + ") " + c.amt(x.amount)).join("; ") + "." : "None was outstanding at the year end for more than six months from the date it became payable.", disp.length ? " Dues not deposited because of a dispute: " + disp.map((x) => x.statute + " " + (x.nature || "") + " ₹" + (x.amount || "") + " (" + (x.forum || "") + ")").join("; ") + "." : " There are no dues not deposited because of a dispute."]);
  if (f.borrow > 0.5 || f.borrowPy > 0.5) item(["The Company has not defaulted in repaying any loan or borrowing or in paying interest to any lender, and has not been declared a wilful defaulter. ", f.termLoans.length ? "Term loans were used for the purposes for which they were raised. " : "", "Funds raised for the short term have not been used for long-term purposes.", c.yes("c_wc_limits") ? " The quarterly returns and statements filed with the banks agree with the books of account" + (nz(a.c_wc_agree) ? ", save as follows: " + String(a.c_wc_agree).trim() : "") + "." : ""]);
  item([c.yes("b_deposits") ? "Deposits accepted have been accepted in compliance with Sections 73 to 76 of the Act and the rules made under them." : "The Company has not accepted any deposit in contravention of Sections 73 to 76 of the Act.", f.directorLoans.length ? " The loans of " + c.amt(f.directorLoanTotal) + " from directors are covered by their written declarations that the amounts were not given out of borrowed funds." : ""]);
  if (f.loansGiven.length || f.investments.length) item(["The loans given, investments made and guarantees and security provided comply with Sections 185 and 186 of the Act, their terms are not prejudicial to the interest of the Company, and no loan or advance in the nature of a loan has been granted to promoters, directors, key managerial personnel or related parties repayable on demand or without terms of repayment."]);

  D.h("E. Statutory confirmations", 2);
  item([f.cashLoss || f.cashLossPy ? "The Company incurred cash losses of " + (f.cashLoss ? c.amt(f.cashLoss) : "nil") + " in the year and " + (f.cashLossPy ? c.amt(f.cashLossPy) : "nil") + " in the previous year." : "The Company has not incurred any cash loss in the year or in the previous year."]);
  item(["No transaction left out of the books has been surrendered or disclosed as income in any assessment under the Income-tax Act, 1961."]);
  item(["The Company has not advanced, lent or invested funds in or through any person or entity, Indian or foreign, on the understanding that the recipient would in turn lend to, invest in, or give guarantees or security for, persons identified by or for the Company; nor has it received funds from anyone on the understanding that it would do so for persons identified by the provider (Rule 11(e) of the Companies (Audit and Auditors) Rules, 2014)."]);
  if ((a.b_dividend || "none") !== "none" || f.dividendPaid) item(["The dividend declared or paid during the year complies with Section 123 of the Act."]);
  item(["The books of account are kept in ", String(a.a_trail_soft || "Tally Prime"), (a.a_trail || "v1") === "v4" ? ", which has no audit trail (edit log) feature." : ", which has an audit trail (edit log) feature. The feature was enabled throughout the year for all relevant transactions, was not disabled or tampered with, and the audit trail has been preserved as the law requires."]);
  item(["No proceeding is pending against the Company under the Benami Transactions (Prohibition) Act, 1988. ", nz(a.m_struck) ? "Transactions with companies struck off under Section 248 of the Act: " + String(a.m_struck).trim() + "." : "The Company has had no transaction with any company struck off under Section 248 of the Act.", " The Company has not traded or invested in crypto or virtual currency, complies with the restriction on the number of layers, has no scheme of arrangement approved by a competent authority, and has registered all charges and their satisfaction with the Registrar of Companies within the time allowed."]);
  item(["Loans and deposits of twenty thousand rupees or more have been taken and repaid only by account payee cheque, account payee draft or bank transfer, as Sections 269SS and 269T of the Income-tax Act, 1961 require."]);
  item(["The Company has not entered into any non-cash transaction with its directors or persons connected with them, and is not required to be registered under Section 45-IA of the Reserve Bank of India Act, 1934."]);
  if (ap.csr.applies) item(["The amount required to be spent on Corporate Social Responsibility under Section 135 of the Act has been spent", nz(a.csr_unspent) ? "; the unspent amount has been dealt with as follows: " + String(a.csr_unspent).trim() : "", "."]);

  P(["Yours faithfully,"]);
  P([{ text: "For " + c.name, b: true }]);
  const s = (Array.isArray(a.m_signer) ? a.m_signer : []).filter((x) => x && x.name);
  const col = (x) => ["", "", [{ text: x.name, b: true }], (x.desig || "Director") + (x.din ? " (DIN " + x.din + ")" : "")];
  D.sig(s.length ? s.slice(0, 2).map(col) : [["", "", [c.A("m_signer")]]]);
  P(["Place: ", String(a.e_board_place || inp.place || "")]);

  // annexures
  D.h("Annexure 1: Summary of uncorrected misstatements", 2);
  D.table(["Item", "Effect on profit " + c.inp.unitLine.replace(/^\(All amounts in (.*?),.*$/, "($1)")], mis.length ? mis.map((x) => [x.item, c.tamt(x.amount)]).concat([[{ text: "Total", b: true }, c.tamt(mis.reduce((t, x) => t + N(x.amount), 0))]]) : [["Nil", "-"]], { num: [1] });
  D.h("Annexure 2: Related parties and transactions during the year", 2);
  const rows = [];
  rp.forEach((p) => { if (!p.tx.length) rows.push([p.name, p.relation, "No transaction in the books", ""]); p.tx.forEach((t, i) => rows.push([i ? "" : p.name, i ? "" : p.relation, t.nature + " (" + t.ledger + ")", c.tamt(t.amount)])); });
  D.table(["Related party", "Relationship", "Nature of transaction / balance", "Amount " + c.inp.unitLine.replace(/^\(All amounts in (.*?),.*$/, "($1)")], rows.length ? rows : [["Nil", "", "", ""]], { num: [3], kind: "rpt" });
  return D.doc;
}
