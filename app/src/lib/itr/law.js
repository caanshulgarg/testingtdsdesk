// Income Tax Return, AY 2026-27 (FY 2025-26): the law's figures in one place, each with where it comes from.
// Used by the main computation (tax.js). The second checker (check.js) does NOT import this file: it carries its own
// figures, written out again, so a wrong figure here is caught by the two computations disagreeing.
// "confirm": the owner should confirm the figure (docs/ITR-MODULE.md, "Owner decisions"); the page shows it as such.
export const AY = "2026-27";
export const AY_START = "2026";            // the schemas' AssessmentYear
export const FY = { from: "20250401", to: "20260331" };

// Due dates under section 139(1) for AY 2026-27, as the official schemas allow them (ItrFilingDueDate):
// non-audit cases 31-Aug-2026 (ITR-4's schema allows only this; validation rule 234 of ITR-4: "31st August of respective
// Assessment year unless it is extended"); audit cases (44AB) and companies 31-Oct-2026; transfer pricing (92E) 30-Nov-2026.
export const DUE = { nonAudit: "20260831", audit: "20261031", tp: "20261130" };
export const SRC_DUE = "Section 139(1) read with the AY 2026-27 schemas (ItrFilingDueDate: ITR-3 2026-08-31 / 2026-10-31 / 2026-11-30; ITR-4 2026-08-31; ITR-6 2026-10-31 / 2026-11-30) and ITR-4 validation rule 234";

// Slab rates (individual, HUF). Finance Act 2025, First Schedule Part I (old regime) and section 115BAC(1A) as amended.
export const SLABS = {
  old: [[250000, 0], [500000, 0.05], [1000000, 0.2], [Infinity, 0.3]],
  oldSenior: [[300000, 0], [500000, 0.05], [1000000, 0.2], [Infinity, 0.3]],          // resident, 60 or more
  oldSuper: [[500000, 0], [1000000, 0.2], [Infinity, 0.3]],                             // resident, 80 or more
  new: [[400000, 0], [800000, 0.05], [1200000, 0.1], [1600000, 0.15], [2000000, 0.2], [2400000, 0.25], [Infinity, 0.3]],
};
export const SRC_SLABS = { old: "Finance Act 2025, First Schedule, Part I, Paragraph A", new: "Section 115BAC(1A) as amended by the Finance Act 2025 (FY 2025-26 onwards)" };

// Rebate under section 87A (resident individuals only)
export const REBATE = {
  old: { upto: 500000, max: 12500 },
  new: { upto: 1200000, max: 60000, marginal: true },
  src: "Section 87A as amended by the Finance Act 2025; ITR-4 validation rules 227 and 229",
  // the Finance Act 2025 keeps the rebate off the tax on income at special rates (111A, 112, 112A ...). FinCom, new
  // regime: eligibility on total income (special-rate income included), the rebate and its marginal relief above 12 lakh
  // only against the tax on normal income. The owner's decision of 22-11-2026 (docs/ITR-MODULE.md, 7.1); the e-filing
  // utility's rule 227 reads total income "excluding LTCG"
};

// Surcharge (individual / HUF / AOP / BOI): Finance Act 2025, First Schedule Part I; new regime capped at 25%
// (115BAC(1A) proviso); on 111A, 112, 112A income and dividends at most 15%.
export const SUR_IND = [[5000000, 0.1], [10000000, 0.15], [20000000, 0.25], [50000000, 0.37]];
export const SUR_IND_NEW_CAP = 0.25;
export const SUR_SPECIAL_CAP = 0.15;
export const SUR_FIRM = [[10000000, 0.12]];                         // firm / LLP: 12% above 1 crore
export const SUR_CO = [[10000000, 0.07], [100000000, 0.12]];        // domestic company, normal or MAT
export const SUR_115BAA = 0.1;                                       // flat 10%, no marginal relief needed
export const CESS = 0.04;
export const SRC_SUR = "Finance Act 2025, First Schedule, Part I (surcharge and marginal relief); section 115BAA(5)/(2) for the 10% surcharge; Health and Education Cess 4%";

// Firms and LLPs: 30%. Companies: 25% when the total turnover or gross receipts of FY 2023-24 did not exceed Rs 400 crore,
// else 30% (Finance Act 2025, First Schedule Part I, Paragraph E); 115BAA 22%; MAT 15% of book profit (115JB).
export const FIRM_RATE = 0.3;
export const CO_RATE = { small: 0.25, other: 0.3, smallTurnover: 4000000000, basisFy: "2023-24", baa: 0.22, mat: 0.15 };
export const SRC_CO = "Finance Act 2025, First Schedule, Part I, Paragraph E; section 115BAA; section 115JB (MAT 15%; not on a 115BAA company, 115JB(5A))";

// Special rates (FY 2025-26, after the Finance (No. 2) Act 2024): 111A 20%, 112A 12.5% above Rs 1.25 lakh, 112 12.5%.
export const SPECIAL = { s111A: 0.2, s112A: 0.125, s112AExempt: 125000, s112: 0.125 };

// Presumptive income
export const P44AD = { limit: 20000000, limitLowCash: 30000000, cashShare: 0.05, digital: 0.06, other: 0.08, src: "Section 44AD(1) and its proviso (6% of receipts by account payee cheque / draft / ECS / other prescribed electronic modes received by the due date of 139(1)); section 44AB(a) proviso (Rs 3 crore when cash receipts are not more than 5%)" };
export const P44ADA = { limit: 5000000, limitLowCash: 7500000, cashShare: 0.05, rate: 0.5, src: "Section 44ADA(1) (50%; Rs 75 lakh when cash receipts are not more than 5%, Finance Act 2023)" };
export const P44AE = { heavyKg: 12000, perTonMonth: 1000, perVehicleMonth: 7500, maxVehicles: 10, src: "Section 44AE(1), (2): Rs 1,000 per ton of gross vehicle weight a month for a heavy goods vehicle, Rs 7,500 a month for any other; not more than ten goods carriages" };
// ITR-1 (Sahaj): who may file it (pick.js). Rule 12(1)(a) and its proviso, as in the AY 2026-27 form's instructions: a
// resident individual with total income up to Rs 50 lakh, and not one who is a director in a company, has held unlisted
// equity shares at any time during the previous year, or has agricultural income above Rs 5,000
export const ITR1 = { maxIncome: 5000000, agriMax: 5000, src: "Rule 12(1)(a) of the Income-tax Rules and its proviso (AY 2026-27 ITR-1 instructions): not for a director in a company, one who held unlisted equity shares at any time in the previous year, or agricultural income above Rs 5,000" };
// ITR-4 (Sugam): who may file it (pick.js). Rule 12(1)(b) and its proviso, as in the AY 2026-27 form's instructions: a
// resident individual, HUF or firm (other than an LLP) with business or professional income on a presumptive basis (44AD,
// 44ADA, 44AE) and total income up to Rs 50 lakh; not an individual or HUF who is a director in a company or has held
// unlisted equity shares at any time during the previous year; not one with agricultural income above Rs 5,000
export const ITR4 = { maxIncome: 5000000, agriMax: 5000, src: "Rule 12(1)(b) of the Income-tax Rules and its proviso (AY 2026-27 ITR-4 instructions): for a resident individual, HUF or firm other than an LLP with presumptive income (44AD, 44ADA, 44AE) and total income up to Rs 50 lakh; not for an individual or HUF who is a director in a company or held unlisted equity shares at any time in the previous year, nor for agricultural income above Rs 5,000" };
export const ITR4_MAX_INCOME = ITR4.maxIncome; // total income not more than Rs 50 lakh (schema maximum 51,25,000 with 112A)

// Section 40(b): partners' remuneration and interest (Finance (No. 2) Act 2024, from AY 2025-26)
export const S40B = { first: 600000, firstMin: 300000, firstRate: 0.9, restRate: 0.6, interest: 0.12, src: "Section 40(b)(iv) and (v) as amended by the Finance (No. 2) Act 2024: on the first Rs 6 lakh of book profit or a loss, Rs 3 lakh or 90% of book profit, whichever is more; on the balance 60%; interest at most 12% simple a year" };

// Disallowances
export const D40AIA = { share: 0.3, src: "Section 40(a)(ia): 30% of any sum payable to a resident on which tax was not deducted, or after deduction not paid on or before the due date of 139(1); allowed in the year it is paid. Short deduction: 30% of the part of the sum the TDS deducted does not cover (the owner's decision of 22-11-2026)" };
export const D40AI = { share: 1, src: "Section 40(a)(i): the whole sum payable to a non-resident when tax under Chapter XVII-B was not deducted or paid" };
export const D40A3 = { limit: 10000, transport: 35000, src: "Section 40A(3) and (3A): a payment otherwise than by account payee cheque / draft / electronic clearing above Rs 10,000 in a day to a person (Rs 35,000 to a transporter of goods carriages); the exceptions of rule 6DD" };
export const D43B = { src: "Section 43B: taxes, duties, cess, fees, employer's contribution to PF / ESI / other funds, bonus, leave encashment, interest to banks / NBFCs are allowed only when actually paid; a sum paid on or before the due date of 139(1) is allowed in this year (first proviso). 43B(h): sums payable to a micro or small enterprise beyond the time of section 15 of the MSMED Act (15 days, or 45 with a written agreement)" };
export const D36VA = { pfDay: 15, esiDay: 15, src: "Section 36(1)(va) with Explanation 2 (Finance Act 2021) and Checkmate Services (P) Ltd v CIT (SC, 2022): an employee's contribution is allowed only when credited to the fund by the due date under its own Act (EPF: the 15th of the next month, para 38 of the EPF Scheme; ESI: the 15th of the next month, regulation 31), no grace days" };

// Interest and fee
export const INTEREST = {
  rate: 0.01, round: 100,
  inst: [["0615", 0.15, 3], ["0915", 0.45, 3], ["1215", 0.75, 3], ["0315", 1, 1]],    // 234C: date, share, months
  safe: { "0615": 0.12, "0915": 0.36 },                                              // 234C first proviso
  advanceMin: 10000,                                                                  // section 208
  src: "Sections 234A, 234B, 234C (1% a month or part of a month; rule 119A: the amount rounded down to a multiple of Rs 100; 234C: 12% / 36% safe harbour; 44AD / 44ADA: one instalment by 15 March, section 211(1)(b)); section 208 (no advance tax below Rs 10,000)",
};
export const FEE234F = { full: 5000, small: 1000, smallIncome: 500000, src: "Section 234F: Rs 5,000; Rs 1,000 when total income is not more than Rs 5 lakh" };

// Chapter VI-A limits the page checks (old regime). New regime: only 80CCD(2), 80CCH and 80JJAA (115BAC(2)).
export const VIA = {
  "80C": 150000, "80CCD1B": 50000, "80D_self": 25000, "80D_selfSenior": 50000, "80D_parents": 25000, "80D_parentsSenior": 50000,
  "80TTA": 10000, "80TTB": 50000, "80GG": 60000,
  // new regime, individuals / HUF: 80CCD(2), 80CCH and 80JJAA (115BAC(2)(ii)); 115BAA companies: 80JJAA and 80M
  // (115BAA(2)(ii)); other companies and firms: the business and donation sections
  newAllowed: ["80CCD2", "80CCH", "80JJAA"], baaAllowed: ["80JJAA", "80M"],
  coAllowed: ["80G", "80GGA", "80GGB", "80JJAA", "80IA", "80IAB", "80IAC", "80IB", "80IBA", "80IC", "80LA", "80M", "80PA"], firmAllowed: ["80G", "80GGA", "80GGC", "80JJAA", "80IA", "80IAB", "80IAC", "80IB", "80IBA", "80IC", "80LA"],
  ccd2New: 0.14, ccd2Old: 0.1, d80Self: 25000, d80SelfSenior: 50000, d80Par: 25000, d80ParSenior: 50000,
  dd80: 75000, dd80Severe: 125000, ddb80: 40000, ddb80Senior: 100000, u80: 75000, u80Severe: 125000, ee80: 50000, eea80: 150000, g80Limit: 0.1, g80Cash: 2000,
  src2: "80CCD(2) as amended by the Finance (No. 2) Act 2024 (14% in the new regime, 10% otherwise, 14% for government employers); 80D(2)-(3); 80DD(1); 80DDB; 80U(1); 80G(4), (5D); 80EE, 80EEA, 80EEB",
  src: "Chapter VI-A (sections 80C, 80CCE, 80CCD(1B), 80D, 80GG, 80TTA, 80TTB); section 115BAC(2) for the new regime",
};

// Loss set-off (sections 70 to 80)
export const LOSS = {
  bizCarry: 8, specCarry: 4, src: "Sections 70, 71 (business loss not against salary, 71(2A)), 72 (8 years, against business income only), 73 (speculation: 4 years, against speculation only), 32(2) (unabsorbed depreciation: no limit), 80 (a loss is carried forward only when the return is filed by the due date of 139(1))",
};

export const ROUND = { income: "Section 288A: total income rounded to the nearest multiple of Rs 10", tax: "Section 288B: tax rounded to the nearest multiple of Rs 10" };

// which return: by the PAN's fourth letter (or the entity set in Client setup)
export const FORM_OF = { P: ["ITR-3", "ITR-4"], H: ["ITR-3", "ITR-4"], F: ["ITR-5", "ITR-4"], C: ["ITR-6"], A: ["ITR-5"], B: ["ITR-5"], J: ["ITR-5"], L: ["ITR-5"] };
