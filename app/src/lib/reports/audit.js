// The Independent Auditor's Report on standalone financial statements (ROUND 100): the opinion in the form SA 700 / 705
// call for (unmodified, qualified, adverse, disclaimer), the paragraphs of SA 570 (going concern), SA 701 (key audit
// matters), SA 706 (emphasis of matter, other matter) and SA 720 (other information), the matters of section 143(3)
// (a)-(i), section 197(16) and Rule 11 of the Companies (Audit and Auditors) Rules, 2014 (with the audit trail
// variants), Annexure A under CARO 2020 (all 21 clauses, "not applicable" where the books or the answers show it) and
// Annexure B on internal financial controls, each when it applies. The wording is FinCom's own; the engagement partner
// reviews every line before signing.
//
//   auditorReport(c)   c: makeContext(...) -> a document (doc.js)
import { makeDoc, alpha, roman } from "./doc.js";
import { longDate, relatedTx } from "./facts.js";

const N = (v) => +v || 0;
const nz = (v) => v !== undefined && v !== null && String(v).trim() !== "";
const TRAIL = {
  v1: "The Company has used accounting software ({soft}) for maintaining its books of account which has a feature of recording audit trail (edit log), and the feature operated throughout the year for all relevant transactions recorded in the software. In the course of our audit, we did not come across any instance of the audit trail feature being tampered with, and the audit trail has been preserved by the Company as required by statute.",
  v2: "The Company has used accounting software ({soft}) for maintaining its books of account which has a feature of recording audit trail (edit log); however, the feature was enabled only from {x} and did not operate for the transactions recorded before that date. For the period during which it operated, we did not come across any instance of it being tampered with.",
  v3: "The Company has used accounting software ({soft}) which has a feature of recording audit trail (edit log) at the application level, and it operated throughout the year for all transactions recorded through the application. The feature was not enabled at the database level to log direct changes to the data, and we are therefore unable to comment on such changes.",
  v4: "The books of account of the Company were maintained in accounting software ({soft}) which does not have a feature of recording audit trail (edit log). Accordingly, the Company has not complied with the proviso to Rule 3(1) of the Companies (Accounts) Rules, 2014, and we are unable to comment on the operation, tampering or preservation of an audit trail.",
  v5: "The Company has used accounting software ({soft}) which has a feature of recording audit trail (edit log), and it operated throughout the year for all relevant transactions, except {x}. For the transactions covered, we did not come across any instance of the feature being tampered with.",
  v6: "The Company has used software ({soft}) maintained by a third-party service provider. In the absence of an independent service auditor's report on the controls of that provider, we are unable to comment on whether the audit trail feature of that software operated throughout the year or was tampered with.",
  v7: "The Company has used accounting software ({soft}) which has a feature of recording audit trail (edit log), and it operated throughout the year for all relevant transactions; we did not come across any instance of it being tampered with. We were unable to verify whether the audit trail of the previous year has been preserved as required by statute.",
  v8: "The Company has used accounting software ({soft}) which has a feature of recording audit trail (edit log). During our audit we noticed the following instances of the feature being tampered with: {x}.",
};

export function auditorReport(c) {
  const { f, ap, a, inp } = c, D = makeDoc("audit", "Independent Auditor's Report"), P = (r, o) => D.p(r, o);
  const op = a.a_opinion || "unmodified", disc = op === "disclaimer", mod = op !== "unmodified";
  const fsList = "the Balance Sheet as at " + c.yearEnd + ", the Statement of Profit and Loss" + (ap.cashFlow ? ", the Statement of Cash Flows" : "") + " for the year then ended, and notes to the financial statements, including a summary of material accounting policies and other explanatory information";
  const result = f.pat >= 0 ? "profit" : "loss";
  const exceptFor = mod && !disc ? "except for the " + (op === "adverse" ? "matter" : "effects of the matter") + " described in the Basis for " + (op === "qualified" ? "Qualified" : "Adverse") + " Opinion paragraph above, " : "";
  const basisName = { unmodified: "Basis for Opinion", qualified: "Basis for Qualified Opinion", adverse: "Basis for Adverse Opinion", disclaimer: "Basis for Disclaimer of Opinion" }[op];

  D.title("Independent Auditor's Report");
  P(["To the Members of ", { text: c.name, b: true }]);
  D.h("Report on the Audit of the Financial Statements", 1);
  D.h({ unmodified: "Opinion", qualified: "Qualified Opinion", adverse: "Adverse Opinion", disclaimer: "Disclaimer of Opinion" }[op], 2);
  if (disc) {
    P(["We were engaged to audit the accompanying financial statements of ", c.name, " (\"the Company\"), which comprise ", fsList, "."]);
    P(["We do not express an opinion on these financial statements. The matter set out under Basis for Disclaimer of Opinion is so significant that we could not obtain enough appropriate evidence on which to base one."]);
  } else {
    P(["We have audited the accompanying financial statements of ", c.name, " (\"the Company\"), which comprise ", fsList, "."]);
    P(["On the information and explanations we received, and in our opinion, ", op === "qualified" ? "save for the effects of the matter set out under Basis for Qualified Opinion, " : "",
      op === "adverse" ? "the matter set out under Basis for Adverse Opinion is so significant that these financial statements do not present the information the Companies Act, 2013 (\"the Act\") requires in the required manner, and do not present fairly, under the accounting principles generally accepted in India, the Company's state of affairs at " + c.yearEnd + " or its " + result + (ap.cashFlow ? " and cash flows" : "") + " for the year then ended." :
        "these financial statements present the information the Companies Act, 2013 (\"the Act\") requires, in the required manner, and present a true and fair view of the Company's state of affairs at " + c.yearEnd + " and of its " + result + (ap.cashFlow ? " and cash flows" : "") + " for the year then ended, in accordance with the Accounting Standards notified under Section 133 of the Act and the other accounting principles generally accepted in India."]);
  }
  D.h(basisName, 2);
  if (mod) P([c.A("a_mod_matter"), nz(a.a_mod_note) ? " (refer Note " + String(a.a_mod_note).trim() + " to the financial statements)" : "", "."]);
  if (!disc) P(["Our audit was carried out under the Standards on Auditing (SAs) specified under Section 143(10) of the Act; what those Standards require of us is set out later in this report under Auditor's Responsibilities. We are independent of the Company as the Code of Ethics of the Institute of Chartered Accountants of India and the Act and its Rules require, and we have met our other ethical obligations under them. In our judgement the evidence we obtained is sufficient and appropriate to support our ", op === "unmodified" ? "" : op + " ", "opinion."]);
  if (nz(a.a_gc) && !disc) { D.h("Material Uncertainty Related to Going Concern", 2); P(["We draw attention to the following matter: ", String(a.a_gc).trim().replace(/\.?$/, "."), " These conditions indicate that a material uncertainty exists that may cast significant doubt on the Company's ability to continue as a going concern. Our opinion is not modified in respect of this matter."]); }
  if (ap.kam && !disc) {
    D.h("Key Audit Matters", 2);
    P(["The matters below were, in our judgement, the most significant in our audit of this year's financial statements. We dealt with them as part of the audit of the statements as a whole and in forming our opinion, and we give no separate opinion on them."]);
    const k = (Array.isArray(a.a_kam) ? a.a_kam : []).filter((x) => x && x.matter);
    D.table(["Key audit matter", "How our audit addressed the matter"], k.length ? k.map((x) => [x.matter, x.response || ""]) : [[c.A("a_kam"), ""]]);
  }
  if (nz(a.a_eom) && !disc) { D.h("Emphasis of Matter", 2); P(["We draw attention to the following matter: ", String(a.a_eom).trim().replace(/\.?$/, "."), " Our opinion is not modified in respect of this matter."]); }
  if (nz(a.a_om)) { D.h("Other Matter", 2); P([String(a.a_om).trim().replace(/\.?$/, "."), " Our opinion is not modified in respect of this matter."]); }
  if (!disc) {
    D.h("Information Other than the Financial Statements and Auditor's Report Thereon", 2);
    P(["The other information is the Board's Report and its annexures, for which the Board of Directors is responsible; it does not include the financial statements or this report. Our opinion does not extend to it and we give no assurance on it. Our duty is to read it and consider whether it is materially inconsistent with the financial statements or with what we learnt in the audit, or seems otherwise materially misstated."]);
    const oi = a.a_other_info || "received";
    P(oi === "received" ? ["We have read it and have nothing to report in this respect."] :
      oi === "later" ? ["The Board's Report will be made available to us after the date of this report. We will read it then and, should we find a material misstatement, raise it with those charged with governance."] :
        ["We have concluded that the other information contains the following material misstatement: ", c.A("a_other_info_text"), "."]);
  }
  D.h("Responsibilities of Management and the Board of Directors for the Financial Statements", 2);
  P(["Under Section 134(5) of the Act, the Board of Directors is responsible for preparing financial statements that present a true and fair view of the Company's financial position and performance", ap.cashFlow ? " and its cash flows" : "", " under the accounting principles generally accepted in India, including the Accounting Standards notified under Section 133 of the Act. That includes keeping adequate accounting records as the Act requires, so that the assets are safeguarded and frauds and other irregularities are prevented and detected; choosing and applying suitable accounting policies; making reasonable and prudent judgements and estimates; and putting in place, and running, internal financial controls adequate to keep the records accurate and complete and the statements free from material misstatement, whether from fraud or error."]);
  P(["The management and the Board must also judge whether the Company can continue as a going concern, disclose any matters bearing on that, and use the going concern basis unless they intend, or are compelled, to wind the Company up or stop its business. The Board oversees the Company's financial reporting."]);
  D.h("Auditor's Responsibilities for the Audit of the Financial Statements", 2);
  if (disc) P(["We were to audit the financial statements under the Standards on Auditing and report on them. Because of the matter set out under Basis for Disclaimer of Opinion, we could not obtain enough appropriate evidence on which to base an opinion. We are independent of the Company under the ethical requirements that apply to this audit and have met our other ethical obligations."]);
  else {
    P(["We aim to obtain reasonable assurance that the financial statements as a whole are free from material misstatement, whether caused by fraud or by error, and to issue a report containing our opinion. Reasonable assurance is a high level of assurance, not a guarantee that an audit under the SAs will find every material misstatement. A misstatement is material if, alone or with others, it could reasonably be expected to affect the economic decisions users make on the basis of these statements."]);
    P(["Throughout the audit we apply professional judgement and keep a questioning mind. In particular, we:"]);
    [["identify and assess the risks of material misstatement from fraud or error, plan and carry out procedures that respond to them, and gather enough appropriate evidence for our opinion; fraud is harder to detect than error because it may involve collusion, forgery, deliberate omission, misrepresentation or the override of controls;"],
      ap.ifc.applies ? ["understand the internal controls that matter to the audit so as to design suitable procedures; under Section 143(3)(i) of the Act we also report on whether the Company has adequate internal financial controls with reference to financial statements and whether they operate effectively (Annexure B);"] :
        ["understand the internal controls that matter to the audit so as to design suitable procedures; reporting on internal financial controls under Section 143(3)(i) of the Act does not apply to the Company (paragraph 2(i) below);"],
      ["assess whether the accounting policies are appropriate and the estimates and related disclosures reasonable;"],
      ["conclude whether the management is right to use the going concern basis and whether, on the evidence, there is a material uncertainty about the Company's ability to continue; if there is, we draw attention to the disclosures or, if they are inadequate, modify our opinion; our conclusion rests on evidence up to the date of this report, and later events may still affect that ability; and"],
      ["assess the overall presentation, structure and content of the statements, including the disclosures, and whether they present the underlying transactions and events fairly."]].forEach((r, i) => P(r, { num: roman(i), indent: 1 }));
    P(["We discuss with those charged with governance, among other things, the scope and timing of the audit and our significant findings, including any significant deficiency in internal control we find."]);
    if (ap.listed || ap.kam) P(["We also confirm to those charged with governance that we have met the ethical requirements on independence, tell them of any relationship or other matter that might reasonably be thought to affect it and the safeguards in place, and, from the matters discussed with them, choose those of most significance in this year's audit: the key audit matters."]);
  }

  // ---------- other legal and regulatory requirements ----------
  D.h("Report on Other Legal and Regulatory Requirements", 1);
  P(ap.caro.applies ? ["As required by the Companies (Auditor's Report) Order, 2020 (\"the Order\"), issued by the Central Government in terms of Section 143(11) of the Act, we give in Annexure A a statement on the matters specified in paragraphs 3 and 4 of the Order, to the extent applicable."] :
    ["The Companies (Auditor's Report) Order, 2020 (\"the Order\"), issued by the Central Government in terms of Section 143(11) of the Act, does not apply to the Company, the Company being " + ap.caro.reason + ". Accordingly, we do not report on the matters specified in paragraphs 3 and 4 of the Order."], { num: "1." });
  P([disc ? "As required by Section 143(3) of the Act, we report that, except for the possible effects of the matter described in the Basis for Disclaimer of Opinion paragraph:" : "As required by Section 143(3) of the Act, we report that:"], { num: "2." });
  const exc = (base) => (mod ? exceptFor.replace(/^except/, "Except") + base.charAt(0).toLowerCase() + base.slice(1) : base);
  const books = a.a_backup === "no" ? "proper books of account as required by law have been kept by the Company so far as it appears from our examination of those books, except that the back-up of the books of account maintained in electronic mode was not kept on servers physically located in India on a daily basis, as required by Rule 3(5) of the Companies (Accounts) Rules, 2014" :
    "in our opinion, proper books of account as required by law have been kept by the Company so far as it appears from our examination of those books";
  const trailExc = ["v2", "v3", "v4", "v5", "v6", "v8"].includes(a.a_trail || "v1") ? " and except for the matters stated in paragraph 2(j)(vi) below on reporting under Rule 11(g)" : "";
  const items = [
    [disc ? "as described in the Basis for Disclaimer of Opinion paragraph, we were unable to obtain all the information and explanations which to the best of our knowledge and belief were necessary for the purposes of our audit;" : "we have sought and obtained all the information and explanations which to the best of our knowledge and belief were necessary for the purposes of our audit;"],
    [exc(books) + trailExc + ";"],
    [nz(a.a_branches) ? "the reports on the accounts of the branch offices of the Company audited under Section 143(8) of the Act by branch auditors (" + String(a.a_branches).trim() + ") have been sent to us and have been properly dealt with by us in preparing this report;" : "the Company has no branch office, and the matters relating to branch auditors under Section 143(8) of the Act do not arise;"],
    ["the Balance Sheet, the Statement of Profit and Loss" + (ap.cashFlow ? " and the Statement of Cash Flows" : "") + " dealt with by this report are in agreement with the books of account;"],
    [exc("in our opinion, the aforesaid financial statements comply with the Accounting Standards specified under Section 133 of the Act read with the Companies (Accounting Standards) Rules, 2021;")],
    [mod ? "the matter described in the Basis for " + basisName.replace(/^Basis for /, "") + " paragraph above, in our opinion, may have an adverse effect on the functioning of the Company;" : "in our opinion, there are no observations or comments on financial transactions or matters which have any adverse effect on the functioning of the Company;"],
    [a.a_dir8 === "no" ? "on the basis of the written representations received from the directors and taken on record by the Board of Directors, the following director is disqualified as on " + c.yearEnd + " from being appointed as a director in terms of Section 164(2) of the Act: [name the director];" : "on the basis of the written representations received from the directors as on " + c.yearEnd + " and taken on record by the Board of Directors, none of the directors is disqualified as on " + c.yearEnd + " from being appointed as a director in terms of Section 164(2) of the Act;"],
    [a.a_backup === "no" || trailExc ? "the qualification, reservation or adverse remark relating to the maintenance of accounts and other matters connected therewith is as stated in paragraph 2(b) above and paragraph 2(j)(vi) below;" : mod ? "the qualification relating to the maintenance of accounts and other matters connected therewith is as stated in the Basis for " + basisName.replace(/^Basis for /, "") + " paragraph above;" : "there is no qualification, reservation or adverse remark relating to the maintenance of accounts and other matters connected therewith;"],
    [ap.ifc.applies ? "with respect to the adequacy of the internal financial controls with reference to financial statements of the Company and the operating effectiveness of such controls, refer to our separate report in Annexure B;" : "reporting on the adequacy and operating effectiveness of internal financial controls with reference to financial statements under Section 143(3)(i) of the Act does not apply to the Company, the Company being " + ap.ifc.reason + ", in view of the exemption given by the notification of the Ministry of Corporate Affairs dated 13 June 2017;"],
  ];
  items.forEach((r, i) => P(r, { num: alpha(i), indent: 1 }));
  // Rule 11 as 143(3)(j)
  P(["with respect to the other matters to be included in the Auditor's Report in accordance with Rule 11 of the Companies (Audit and Auditors) Rules, 2014, in our opinion and to the best of our information and according to the explanations given to us:"], { num: alpha(9), indent: 1 });
  const lit = (Array.isArray(a.a_litigation) ? a.a_litigation : []).filter((x) => x && x.matter);
  const r11 = [];
  r11.push(lit.length ? ["the Company has disclosed the impact of pending litigations on its financial position in its financial statements (" + lit.map((x) => x.matter + (x.note ? ", Note " + x.note : "")).join("; ") + ");"] : ["the Company does not have any pending litigations which would impact its financial position;"]);
  r11.push(c.yes("a_ltc") ? ["the Company has made provision, as required under the applicable law or accounting standards, for material foreseeable losses on long-term contracts including derivative contracts;"] : ["the Company did not have any long-term contracts, including derivative contracts, for which there were any material foreseeable losses;"]);
  r11.push((a.a_iepf || "na") === "na" ? ["there were no amounts which were required to be transferred to the Investor Education and Protection Fund by the Company;"] : a.a_iepf === "done" ? ["there has been no delay in transferring amounts required to be transferred to the Investor Education and Protection Fund by the Company;"] : ["there has been a delay in transferring amounts required to be transferred to the Investor Education and Protection Fund by the Company;"]);
  r11.push(["(a) the management has told us in writing that, to the best of its knowledge and belief, the Company has not advanced, lent or invested any funds (from whatever source) in or through any person or entity, Indian or foreign (an intermediary), on an understanding, written or not, that the intermediary would lend to, invest in, or give a guarantee or security for, other persons or entities identified by or for the Company (ultimate beneficiaries); (b) it has also told us that the Company has not received any funds from any person or entity, Indian or foreign (a funding party), on an understanding, written or not, that the Company would so lend to, invest in, or give a guarantee or security for, persons or entities identified by or for the funding party; and (c) ",
    a.a_11e === "no" ? ["based on the audit procedures performed, the following has come to our notice: ", c.A("a_11e_text"), ";"] : "the procedures we judged reasonable and appropriate have brought nothing to our notice that leads us to believe these representations are materially misstated;"].flat());
  const dv = a.b_dividend || "none";
  r11.push(dv === "none" && !f.dividendPaid ? ["the Company has not declared or paid any dividend during the year;"] : ["the dividend " + (/interim|both/.test(dv) ? "declared and paid by the Company during the year" : "") + (/both/.test(dv) ? ", and the final dividend proposed for the year (which is subject to the approval of the members at the coming Annual General Meeting)," : /final/.test(dv) ? "proposed for the year by the Board of Directors, which is subject to the approval of the members at the coming Annual General Meeting," : "") + " is in compliance with Section 123 of the Act;"]);
  const tv = a.a_trail || "v1";
  r11.push([TRAIL[tv].replace("{soft}", String(a.a_trail_soft || "Tally Prime")).replace("{x}", nz(a.a_trail_detail) ? String(a.a_trail_detail).trim() : "[details]")]);
  if (tv !== "v1" && !nz(a.a_trail_detail) && ["v2", "v5", "v8"].includes(tv)) r11[r11.length - 1].push(" ", c.A("a_trail_detail"));
  r11.forEach((r, i) => P(r, { num: roman(i), indent: 2 }));
  // s.197(16)
  P(ap.s197 ? (a.a_remun === "no" ? ["With respect to the matter to be included in the Auditor's Report under Section 197(16) of the Act: the remuneration paid by the Company to its directors during the year exceeds the limit laid down in Section 197 read with Schedule V: ", c.A("a_remun_text"), "."] :
    ["With respect to the matter to be included in the Auditor's Report under Section 197(16) of the Act, in our opinion and according to the information and explanations given to us, the remuneration paid by the Company to its directors during the year is in accordance with the provisions of Section 197 of the Act."]) :
    ["The provisions of Section 197 read with Schedule V of the Act on managerial remuneration do not apply to the Company, being a private company; accordingly, reporting under Section 197(16) of the Act does not arise."], { num: "3." });
  auditorSig(c, D);

  if (ap.caro.applies) caroAnnex(c, D);
  if (ap.ifc.applies) ifcAnnex(c, D);
  return D.doc;
}

export function auditorSig(c, D) {
  const au = c.inp.auditor || {};
  D.sig([[["For ", { text: au.firm || "", b: true }], "Chartered Accountants", "Firm Registration No.: " + (au.frn || ""), "", "", [{ text: au.partner || "", b: true }], "Partner", "Membership No.: " + (au.mno || ""), ["UDIN: ", c.A("e_udin")], ["Place: ", String(au.place || c.inp.place || "")], ["Date: ", c.date("e_audit_date")]], [""]]);
}

function caroAnnex(c, D) {
  const { f, ap, a } = c, P = (r, o) => D.p(r, o);
  D.brk().title("Annexure A to the Independent Auditor's Report", "");
  P([{ text: "Referred to in paragraph 1 under \"Report on Other Legal and Regulatory Requirements\" of our report of even date to the members of " + c.name + " on the financial statements for the year ended " + c.yearEnd + ".", i: true }]);
  P(["To the best of our information and according to the explanations given to us, and the books of account and records examined by us in the normal course of audit, we state that:"]);
  const cl = (i, runs) => P(runs, { num: roman(i), indent: 0 });
  const sub = (j, runs, ind) => P(runs, { num: alpha(j), indent: ind || 1 });
  const hasPPE = f.ppeNet > 0.5 || f.ppeAdd > 0.5 || f.intangibles > 0.5;
  // (i)
  cl(0, ["Property, plant and equipment and intangible assets:"]);
  if (!hasPPE) sub(0, ["The Company does not hold any property, plant and equipment or intangible assets; clause 3(i) of the Order is therefore not applicable."]);
  else {
    sub(0, [a.c_ppe_records === "no" ? "The Company has not maintained proper records showing full particulars of its property, plant and equipment." : "(A) The Company has maintained proper records showing full particulars, including quantitative details and situation, of its property, plant and equipment. (B) " + (f.intangibles > 0.5 ? "The Company has maintained proper records showing full particulars of its intangible assets." : "The Company does not have any intangible asset; sub-clause (B) is not applicable.")]);
    sub(1, [a.c_ppe_verify === "disc" ? ["The property, plant and equipment were physically verified by the management during the year, and the following material discrepancies were noticed and dealt with: ", c.A("c_ppe_disc"), "."] : a.c_ppe_verify === "programme" ? "The Company has a programme of physical verification of its property, plant and equipment by which all of them are verified over a period of time, which, in our opinion, is reasonable having regard to the size of the Company and the nature of its assets. In accordance with the programme, certain assets were verified during the year, and no material discrepancies were noticed." : "The property, plant and equipment were physically verified by the management during the year, which in our opinion is a reasonable interval, and no material discrepancies were noticed on such verification."].flat());
    sub(2, [f.immovable ? (nz(a.c_title) ? "The title deeds of the immovable properties are held in the name of the Company, except the following: " + String(a.c_title).trim() : "The title deeds of all the immovable properties (other than properties where the Company is the lessee and the lease agreements are duly executed in its favour) disclosed in the financial statements are held in the name of the Company.") : "The Company does not own any immovable property; clause 3(i)(c) of the Order is therefore not applicable."]);
    sub(3, [nz(a.c_reval) ? "The Company has revalued its property, plant and equipment or intangible assets during the year: " + String(a.c_reval).trim() : "The Company has not revalued its property, plant and equipment (including right-of-use assets) or intangible assets during the year."]);
    sub(4, [nz(a.c_benami) ? String(a.c_benami).trim() : "No proceedings have been initiated during the year or are pending against the Company for holding any benami property under the Benami Transactions (Prohibition) Act, 1988 and the rules made thereunder."]);
  }
  // (ii)
  cl(1, ["Inventory and working capital:"]);
  sub(0, f.inventory > 0.5 ? ["The inventory has been physically verified by the management during the year: ", c.A("c_inv_verify"), ". In our opinion, the coverage and procedure of such verification are appropriate."] : ["The Company does not hold any inventory; clause 3(ii)(a) of the Order is therefore not applicable."]);
  sub(1, c.yes("c_wc_limits") ? [nz(a.c_wc_agree) ? "The Company has been sanctioned working capital limits in excess of ₹5 crore, in aggregate, from banks or financial institutions on the basis of security of current assets. The quarterly returns or statements filed by the Company with them differ from the books of account as follows: " + String(a.c_wc_agree).trim() : "The Company has been sanctioned working capital limits in excess of ₹5 crore, in aggregate, from banks or financial institutions on the basis of security of current assets. The quarterly returns or statements filed by the Company with them are in agreement with the books of account."] :
    ["The Company has not been sanctioned working capital limits in excess of ₹5 crore, in aggregate, at any point of time during the year, from banks or financial institutions on the basis of security of current assets; clause 3(ii)(b) of the Order is therefore not applicable."]);
  // (iii)
  const L = f.loansGiven.filter((x) => x.cy > 0.5 || x.given > 0.5), I = f.investments.filter((x) => x.cy > 0.5 || x.made > 0.5);
  cl(2, ["Investments, guarantees, security and loans:"]);
  if (!L.length && !I.length && !nz(a.b_guarantees)) sub(0, ["During the year the Company has not made investments in, provided any guarantee or security to, or granted any loans or advances in the nature of loans, secured or unsecured, to companies, firms, limited liability partnerships or any other parties; clause 3(iii) of the Order is therefore not applicable."]);
  else {
    const subsN = (Array.isArray(a.b_subs) ? a.b_subs : []).map((x) => x && x.name).filter(Boolean);
    const isGroup = (l) => subsN.some((nm) => String(l).toUpperCase().includes(String(nm).toUpperCase()));
    sub(0, ["The Company has made investments in, or granted loans or advances in the nature of loans to, the following parties during the year " + c.inp.unitLine + ":"]);
    const tr = (grp) => L.filter((x) => isGroup(x.ledger) === grp);
    D.table(["Particulars", "Loans: granted during the year", "Loans: balance at the year end", "Investments: made during the year", "Investments: balance at the year end"], [
      ["(A) Subsidiaries, joint ventures and associates", c.tamt(tr(true).reduce((s, x) => s + x.given, 0)), c.tamt(tr(true).reduce((s, x) => s + x.cy, 0)), c.tamt(I.filter((x) => isGroup(x.ledger)).reduce((s, x) => s + x.made, 0)), c.tamt(I.filter((x) => isGroup(x.ledger)).reduce((s, x) => s + x.cy, 0))],
      ["(B) Parties other than the above", c.tamt(tr(false).reduce((s, x) => s + x.given, 0)), c.tamt(tr(false).reduce((s, x) => s + x.cy, 0)), c.tamt(I.filter((x) => !isGroup(x.ledger)).reduce((s, x) => s + x.made, 0)), c.tamt(I.filter((x) => !isGroup(x.ledger)).reduce((s, x) => s + x.cy, 0))],
    ], { num: [1, 2, 3, 4], kind: "caro3iii" });
    if (nz(a.c_loans_terms)) sub(1, ["As to the terms, the repayment schedule, the amounts overdue, renewals and loans repayable on demand (clauses (b) to (f)): ", String(a.c_loans_terms).trim()]);
    else {
      sub(1, ["In our opinion, the investments made and the terms and conditions of the grant of loans and advances in the nature of loans are not prejudicial to the Company's interest."]);
      sub(2, ["In respect of loans and advances in the nature of loans, the schedule of repayment of principal and payment of interest has been stipulated, and the repayments or receipts are regular."]);
      sub(3, ["There is no amount overdue for more than ninety days in respect of loans and advances in the nature of loans."]);
      sub(4, ["No loan or advance in the nature of a loan granted that fell due during the year has been renewed or extended, and no fresh loan has been granted to settle the overdues of existing loans given to the same parties."]);
      sub(5, ["The Company has not granted any loans or advances in the nature of loans either repayable on demand or without specifying any terms or period of repayment."]);
    }
  }
  // (iv)
  cl(3, L.length || I.length || nz(a.b_guarantees) ? [nz(a.c_185) ? String(a.c_185).trim() : "In our opinion, the Company has complied with the provisions of Sections 185 and 186 of the Act in respect of the loans granted, investments made, and guarantees and security provided, as applicable."] :
    ["The Company has not granted any loan, made any investment or provided any guarantee or security to which the provisions of Sections 185 and 186 of the Act apply; clause 3(iv) of the Order is therefore not applicable."]);
  // (v)
  cl(4, [c.yes("b_deposits") ? "The Company has accepted deposits or amounts deemed to be deposits during the year; the particulars and the compliance with the directives of the Reserve Bank of India and Sections 73 to 76 of the Act are: " + String(a.b_deposit_details || "").trim() :
    "The Company has not accepted any deposits or amounts which are deemed to be deposits within the meaning of Sections 73 to 76 of the Act and the rules made thereunder" + (f.directorLoans.length ? " (the loans from directors being exempt under Rule 2(1)(c)(viii) of the Companies (Acceptance of Deposits) Rules, 2014)" : "") + "; clause 3(v) of the Order is therefore not applicable."]);
  // (vi)
  cl(5, [(a.b_cost || "na") === "na" ? "The Central Government has not specified the maintenance of cost records under Section 148(1) of the Act for any of the products or services of the Company; clause 3(vi) of the Order is therefore not applicable." :
    "We have broadly reviewed the cost records maintained by the Company as specified by the Central Government under Section 148(1) of the Act and are of the opinion that, prima facie, the prescribed accounts and records have been made and maintained. We have not, however, made a detailed examination of the cost records with a view to determine whether they are accurate or complete."]);
  // (vii)
  cl(6, ["Statutory dues:"]);
  const reg = a.c_stat_late || "yes";
  sub(0, [reg === "no" ? "The Company has not been regular in depositing undisputed statutory dues, including goods and services tax, provident fund, employees' state insurance, income tax, duty of customs, cess and other statutory dues, with the appropriate authorities." :
    "The Company has " + (reg === "generally" ? "generally " : "") + "been regular in depositing undisputed statutory dues, including goods and services tax, provident fund, employees' state insurance, income tax, duty of customs, cess and other statutory dues applicable to it, with the appropriate authorities" + (reg === "generally" ? ", though there have been slight delays in a few cases" : "") + ".",
    f.statDues.length ? " The following undisputed amounts payable were outstanding as at " + c.yearEnd + " for a period of more than six months from the date they became payable:" : " There were no undisputed amounts payable in respect of such statutory dues outstanding as at " + c.yearEnd + " for a period of more than six months from the date they became payable."]);
  if (f.statDues.length) D.table(["Nature of the statute / dues", "Ledger", "Amount " + c.inp.unitLine.replace(/^\(All amounts in (.*?),.*$/, "($1)"), "Period to which it relates", "Due date"], f.statDues.map((x) => [x.nature, x.ledger, c.tamt(x.amount), x.before ? "Before " + longDate(f.from) : "From " + longDate(x.since), x.due ? longDate(x.due) : "Before " + longDate(f.from)]), { num: [2], kind: "caro3vii" });
  const disp = (Array.isArray(a.c_disputes) ? a.c_disputes : []).filter((x) => x && x.statute);
  sub(1, disp.length ? ["The statutory dues which have not been deposited on account of a dispute are as follows:"] : ["There are no statutory dues referred to in sub-clause (a) which have not been deposited on account of any dispute."]);
  if (disp.length) D.table(["Name of the statute", "Nature of dues", "Amount (₹)", "Period", "Forum where pending"], disp.map((x) => [x.statute, x.nature || "", x.amount || "", x.period || "", x.forum || ""]), { num: [2] });
  // (viii)
  cl(7, [nz(a.c_unrecorded) ? String(a.c_unrecorded).trim() : "There were no transactions relating to previously unrecorded income that have been surrendered or disclosed as income during the year in the tax assessments under the Income-tax Act, 1961; clause 3(viii) of the Order is therefore not applicable."]);
  // (ix)
  cl(8, ["Borrowings:"]);
  const anyB = f.borrow > 0.5 || f.borrowPy > 0.5;
  sub(0, [!anyB ? "The Company has not taken any loans or other borrowings from any lender; sub-clause (a) is therefore not applicable." : nz(a.c_default) ? String(a.c_default).trim() : "The Company has not defaulted in the repayment of loans or other borrowings or in the payment of interest thereon to any lender."]);
  sub(1, ["The Company has not been declared a wilful defaulter by any bank, financial institution or other lender."]);
  sub(2, [f.termLoans.length ? (nz(a.c_term_use) ? String(a.c_term_use).trim() : "The term loans were applied for the purpose for which they were obtained.") : "The Company has not obtained any term loans; sub-clause (c) is therefore not applicable."]);
  sub(3, [nz(a.c_st_lt) ? String(a.c_st_lt).trim() : "On an overall examination of the financial statements of the Company, funds raised on a short-term basis have, prima facie, not been used during the year for long-term purposes."]);
  const subs = (Array.isArray(a.b_subs) ? a.b_subs : []).filter((x) => x && x.name);
  sub(4, [subs.length ? "The Company has not taken any funds from any entity or person on account of or to meet the obligations of its subsidiaries, associates or joint ventures." : "The Company does not have any subsidiary, associate or joint venture; sub-clause (e) is therefore not applicable."]);
  sub(5, [subs.length ? "The Company has not raised loans during the year on the pledge of securities held in its subsidiaries, joint ventures or associate companies." : "The Company does not have any subsidiary, associate or joint venture; sub-clause (f) is therefore not applicable."]);
  // (x)
  cl(9, ["Money raised:"]);
  sub(0, ["The Company has not raised moneys by way of initial public offer or further public offer (including debt instruments) during the year; sub-clause (a) is therefore not applicable."]);
  sub(1, f.sharesChanged ? ["As to the preferential allotment or private placement of shares or convertible debentures made during the year: ", c.A("c_pref"), "."] : ["The Company has not made any preferential allotment or private placement of shares or convertible debentures (fully, partially or optionally convertible) during the year; sub-clause (b) is therefore not applicable."]);
  // (xi)
  cl(10, ["Fraud:"]);
  if (nz(a.c_fraud)) sub(0, [String(a.c_fraud).trim()]);
  else {
    sub(0, ["No fraud by the Company and no fraud on the Company has been noticed or reported during the year."]);
    sub(1, ["No report under Section 143(12) of the Act has been filed by us in Form ADT-4 as prescribed under Rule 13 of the Companies (Audit and Auditors) Rules, 2014 with the Central Government during the year and up to the date of this report."]);
    sub(2, [ap.vigil ? "We have taken into consideration the whistle-blower complaints, if any, received by the Company during the year; as represented to us, there were none." : "As represented to us by the management, there were no whistle-blower complaints received by the Company during the year."]);
  }
  // (xii)
  cl(11, [(a.e_sector || "general") === "nidhi" ? "The Company is a Nidhi company; [report on the net owned funds to deposits ratio, the unencumbered term deposits and any default]." : "The Company is not a Nidhi company; clause 3(xii) of the Order is therefore not applicable."]);
  // (xiii)
  cl(12, [ap.committees ? "In our opinion, all transactions with the related parties are in compliance with Sections 177 and 188 of the Act, where applicable, and the details have been disclosed in the financial statements as required by the applicable accounting standards." :
    "In our opinion, all transactions with the related parties are in compliance with Section 188 of the Act, where applicable, and the details have been disclosed in the financial statements as required by the applicable accounting standards. The provisions of Section 177 of the Act do not apply to the Company."]);
  // (xiv)
  cl(13, [ap.internalAudit ? "In our opinion, the Company has an internal audit system commensurate with the size and nature of its business, and we have considered the reports of the internal auditors for the period under audit" + (nz(a.c_ia_reports) ? ": " + String(a.c_ia_reports).trim() : ".") :
    "The Company is not required to have an internal audit system under Section 138 of the Act and does not have one; clause 3(xiv) of the Order is therefore not applicable."]);
  // (xv)
  cl(14, [nz(a.c_noncash) ? String(a.c_noncash).trim() : "The Company has not entered into any non-cash transactions with its directors or persons connected with them; the provisions of Section 192 of the Act therefore do not apply."]);
  // (xvi)
  cl(15, ["Registration with the Reserve Bank of India:"]);
  const nb = (a.e_sector || "general") === "nbfc";
  sub(0, [nb ? (nz(a.c_nbfc) ? String(a.c_nbfc).trim() : "The Company is required to be registered under Section 45-IA of the Reserve Bank of India Act, 1934, and the registration has been obtained.") : "The Company is not required to be registered under Section 45-IA of the Reserve Bank of India Act, 1934."]);
  sub(1, ["The Company has not conducted any non-banking financial or housing finance activities " + (nb ? "without a valid certificate of registration." : "during the year.")]);
  sub(2, ["The Company is not a Core Investment Company as defined in the regulations made by the Reserve Bank of India."]);
  sub(3, ["The group to which the Company belongs does not have any Core Investment Company."]);
  // (xvii)
  cl(16, [f.cashLoss || f.cashLossPy ? "The Company has incurred cash losses of " + (f.cashLoss ? c.amt(f.cashLoss) : "nil") + " in the financial year and of " + (f.cashLossPy ? c.amt(f.cashLossPy) : "nil") + " in the immediately preceding financial year." : "The Company has not incurred cash losses in the financial year or in the immediately preceding financial year."]);
  // (xviii)
  cl(17, [nz(a.c_resign) ? String(a.c_resign).trim() : "There has been no resignation of the statutory auditors during the year; clause 3(xviii) of the Order is therefore not applicable."]);
  // (xix)
  cl(18, [nz(a.c_xix) ? String(a.c_xix).trim() : "Having regard to the financial ratios (the current ratio at the year end is " + f.currentRatio.toFixed(2) + "), the ageing and expected timing of realisation of financial assets and settlement of financial liabilities, the other information accompanying the financial statements, and what we know of the plans of the Board and the management, and having examined the evidence for the assumptions made, we have not become aware of any material uncertainty, at the date of this report, about the Company's capacity to meet the liabilities existing at the balance sheet date as they fall due within one year of that date. This statement rests on the facts up to the date of this report; it is neither a guarantee nor an assurance that every such liability will be met when due."]);
  // (xx)
  cl(19, [ap.csr.applies ? (nz(a.c_csr) ? String(a.c_csr).trim() : "There is no unspent amount under Section 135(5) of the Act, either for ongoing projects or otherwise, requiring a transfer to a fund specified in Schedule VII to the Act or to a special account under Section 135(6); sub-clauses (a) and (b) are therefore not applicable.") :
    "The provisions of Section 135 of the Act on Corporate Social Responsibility do not apply to the Company; clause 3(xx) of the Order is therefore not applicable."]);
  // (xxi)
  cl(20, ["The reporting under clause 3(xxi) of the Order is in respect of consolidated financial statements; this report is on the standalone financial statements, and the clause is therefore not applicable."]);
  auditorSig(c, D);
  void relatedTx;
}

function ifcAnnex(c, D) {
  const { a } = c, P = (r, o) => D.p(r, o), op = a.i_opinion || "unmodified";
  D.brk().title("Annexure B to the Independent Auditor's Report", "");
  P([{ text: "Referred to in paragraph 2(i) under \"Report on Other Legal and Regulatory Requirements\" of our report of even date. Report on the internal financial controls with reference to financial statements under clause (i) of sub-section 3 of Section 143 of the Companies Act, 2013.", i: true }]);
  D.h({ unmodified: "Opinion", qualified: "Qualified Opinion", adverse: "Adverse Opinion", disclaimer: "Disclaimer of Opinion" }[op], 2);
  P(["We have audited the internal financial controls with reference to financial statements of ", c.name, " (\"the Company\") as at ", c.yearEnd, " in conjunction with our audit of the financial statements of the Company for the year ended on that date."]);
  if (op !== "unmodified") P(["The following material weakness has been identified as at ", c.yearEnd, ": ", c.A("i_weakness"), ". A material weakness is a deficiency, or a combination of deficiencies, in internal financial controls with reference to financial statements, such that there is a reasonable possibility that a material misstatement of the Company's annual or interim financial statements will not be prevented or detected on a timely basis."]);
  P([op === "disclaimer" ? "Because of the matter described above, we have not been able to obtain sufficient appropriate audit evidence to provide a basis for an opinion on whether the Company had adequate internal financial controls with reference to financial statements, and whether such controls were operating effectively as at " + c.yearEnd + "; we therefore do not express an opinion on them." :
    (op === "qualified" ? "In our opinion, except for the possible effects of the material weakness described above, " : op === "adverse" ? "In our opinion, because of the effects of the material weakness described above, the Company has not maintained adequate and effective internal financial controls with reference to financial statements as at " + c.yearEnd + ". " : "In our opinion, ") +
    (op === "adverse" ? "" : "the Company has, in all material respects, adequate internal financial controls with reference to financial statements, and such controls were operating effectively as at " + c.yearEnd + ", based on the internal control with reference to financial statements criteria established by the Company considering the essential components of internal control stated in the Guidance Note on Audit of Internal Financial Controls over Financial Reporting issued by the Institute of Chartered Accountants of India (\"the Guidance Note\").")]);
  D.h("Management's Responsibility for Internal Financial Controls", 2);
  P(["The management and the Board of Directors are responsible for setting up and keeping in operation internal financial controls on criteria the Company has laid down with regard to the essential components of internal control in the Guidance Note: controls adequate and effective for running the business in an orderly and efficient way, following the Company's policies, safeguarding its assets, preventing and detecting frauds and errors, keeping the accounting records accurate and complete, and preparing reliable financial information on time, as the Act requires."]);
  D.h("Auditor's Responsibility", 2);
  P(["Our task is to give an opinion on these controls from our audit, which we carried out under the Guidance Note and, so far as they apply, the Standards on Auditing specified under Section 143(10) of the Act. They require us to meet ethical requirements and to plan and perform the audit so as to obtain reasonable assurance that adequate controls were set up and kept in place and worked effectively in all material respects. We gained an understanding of the controls, assessed the risk of a material weakness, and tested the design and operation of the controls according to that risk; the procedures chosen depend on our judgement, including our assessment of the risk of material misstatement from fraud or error. In our judgement the evidence obtained is sufficient and appropriate to support our opinion."]);
  D.h("Meaning of Internal Financial Controls with Reference to Financial Statements", 2);
  P(["These are the processes by which a company gains reasonable assurance that its financial reporting is reliable and its published financial statements follow generally accepted accounting principles. They cover the policies and procedures that keep records reflecting its transactions and the disposal of its assets accurately and in reasonable detail; that make sure transactions are recorded so the statements can be properly prepared, and that money is received and spent only as the management and directors authorise; and that prevent, or detect in time, any unauthorised acquisition, use or disposal of assets that could materially affect the statements."]);
  D.h("Inherent Limitations of Internal Financial Controls with Reference to Financial Statements", 2);
  P(["No system of controls is proof against collusion or improper override by the management, so misstatements from error or fraud may still occur and go undetected. A conclusion on the controls today may also not hold for later periods: conditions change, and compliance with policies and procedures may slip."]);
  auditorSig(c, D);
}
