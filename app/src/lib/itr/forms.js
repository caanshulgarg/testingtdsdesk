// The mapping layer: FinCom's computation (tax.js), the books in the ITR's shape (books.js) and the owner's details ->
// the official schema's fields, form by form (AY 2026-27: ITR-3 V1.1, ITR-4 V1.1, ITR-5 V1.1, ITR-6 V1.0). Kept apart
// from the computation so a new schema version changes only this file. fill.js completes the JSON (zeros for amounts
// FinCom does not map; questions for anything else), validate.js checks it against the official schema.
import { put } from "./fill.js";

const N = (v) => +v || 0;
const R = (v) => { const x = N(v), r = Math.round(Math.abs(x) + 1e-9) * Math.sign(x); return r === 0 ? 0 : r; };
const P0 = (v) => Math.max(0, R(v));
const lineOf = (S, k) => { const l = (S.lines || []).find((x) => x.key === k); return l ? l.amt : 0; };
export const ROOT = { "ITR-3": "ITR3", "ITR-4": "ITR4", "ITR-5": "ITR5", "ITR-6": "ITR6" };
export const SCHEMA_FILES = { "ITR-3": "ITR-3_2026_Main_V1.1.json", "ITR-4": "ITR-4_2026_Main_V1.1.json", "ITR-5": "ITR-5_2026_Main_V1.1.json", "ITR-6": "ITR-6_2026_Main_V1.0.json" };
// (the schemas allow 75 characters)
const DESC = { "ITR-3": "For individuals and HUFs having income from business or profession", "ITR-4": "For presumptive income from Business & Profession",
  "ITR-5": "For firms, LLPs, AOPs, BOIs and other persons", "ITR-6": "For companies other than those claiming exemption under section 11" };

// the TDS section codes of the schema (its description: "94J-B:194J(b)/4JB- Fees for professional ...")
export function sectionCodes(schema) {
  const out = {};
  const find = (o) => { if (!o || typeof o !== "object") return null; if (o.TDSSection) return o.TDSSection; for (const v of Object.values(o)) { const r = find(v); if (r) return r; } return null; };
  const s = find(schema), d = String((s && s.description) || "");
  d.split(";").forEach((p) => { const m = p.trim().match(/^([0-9A-Z-]+)\s*:\s*(\d{3}[A-Z]*(?:\([a-z0-9]+\))?)/); if (m) out[m[2].replace(/[()]/g, "").toUpperCase()] = m[1]; });
  return out;
}
// 194J / 194I come without (a)/(b) in 26AS and AIS: the rate tells (194J(a) 2%, (b) 10%; 194I(a) 2%, (b) 10%)
export function sectionCode(codes, sec, amount, tax) {
  let s = String(sec || "").toUpperCase().replace(/[()]/g, "");
  const rate = N(amount) ? N(tax) / N(amount) : 0;
  if (s === "194J") s = rate && rate < 0.05 ? "194JA" : "194JB";
  if (s === "194I") s = rate && rate < 0.05 ? "194IA" : "194IB";
  return codes[s] || codes[s.replace(/^194I([AB])$/, "194I$1")] || "";
}

function common(X, o, root) {
  const P = X.profile || {}, f = X.form;
  put(o, "CreationInfo/SWVersionNo", "FinCom1.0");
  if (P.swId) { put(o, "CreationInfo/SWCreatedBy", P.swId); put(o, "CreationInfo/JSONCreatedBy", P.swId); }
  put(o, "CreationInfo/JSONCreationDate", X.today);
  if (P.city) put(o, "CreationInfo/IntermediaryCity", P.city);
  put(o, "CreationInfo/Digest", "-");
  put(o, "Form_" + root + "/FormName", f); put(o, "Form_" + root + "/Description", DESC[f]); put(o, "Form_" + root + "/AssessmentYear", "2026");
  put(o, "Form_" + root + "/SchemaVer", "Ver1.0"); put(o, "Form_" + root + "/FormVer", "Ver1.0");
}
function person(P, base, o, org) {
  if (!org && P.first) put(o, base + "/AssesseeName/FirstName", P.first);
  if (!org && P.middle) put(o, base + "/AssesseeName/MiddleName", P.middle);
  const sur = org ? P.orgName || P.sur : P.sur;
  if (sur) put(o, base + "/AssesseeName/SurNameOrOrgName", sur);
  if (P.pan) put(o, base + "/PAN", P.pan);
  const A = P.address || {};
  [["ResidenceNo", A.flat], ["ResidenceName", A.building], ["RoadOrStreet", A.street], ["LocalityOrArea", A.locality], ["CityOrTownOrDistrict", A.city], ["StateCode", A.state], ["CountryCode", A.country || (A.state ? "91" : undefined)]].forEach(([k, v]) => { if (v) put(o, base + "/Address/" + k, String(v)); });
  if (A.pin) put(o, base + "/Address/PinCode", +A.pin);
  if (P.mobile) { put(o, base + "/Address/CountryCodeMobile", 91); put(o, base + "/Address/MobileNo", +String(P.mobile).replace(/\D/g, "").slice(-10)); }
  if (P.email) put(o, base + "/Address/EmailAddress", P.email);
}
function taxPaidLists(X, o, prefix, kind) {
  const M = X.model, codes = X.codes || {}, paid = M.paid || {};
  const tds = (paid.tds || []).filter((r) => R(r.amt));
  if (kind === "itr4") {
    put(o, prefix + "TDSonOthThanSals/TDSonOthThanSalDtls", tds.map((r) => ({ TANOfDeductor: r.tan, TDSSection: sectionCode(codes, r.sec, r.gross, r.amt), TDSClaimed: R(r.amt), GrossAmount: R(r.gross), HeadOfIncome: r.head || "BP", TDSCreditCarriedFwd: 0, TDSDeducted: R(r.amt) })));
    put(o, prefix + "TDSonOthThanSals/TotalTDSonOthThanSals", R(tds.reduce((s, r) => s + N(r.amt), 0)));
  } else {
    put(o, prefix + "ScheduleTDS2/TDSOthThanSalaryDtls", tds.map((r) => ({ TDSCreditName: "S", TANOfDeductor: r.tan, TDSSection: sectionCode(codes, r.sec, r.gross, r.amt), TaxDeductCreditDtls: { TaxDeductedOwnHands: R(r.amt), TaxClaimedOwnHands: R(r.amt) }, GrossAmount: R(r.gross), HeadOfIncome: r.head || "BP", AmtCarriedFwd: 0 })));
    put(o, prefix + "ScheduleTDS2/TotalTDSonOthThanSals", R(tds.reduce((s, r) => s + N(r.amt), 0)));
  }
  const ch = (paid.advance || []).concat(paid.selfAssessment || []).filter((r) => r.bsr);
  if (ch.length) { put(o, prefix + "ScheduleIT/TaxPayment", ch.map((r) => ({ BSRCode: r.bsr, DateDep: String(r.date).slice(0, 4) + "-" + String(r.date).slice(4, 6) + "-" + String(r.date).slice(6, 8), SrlNoOfChaln: +r.serial || 0, Amt: R(r.amt) }))); put(o, prefix + "ScheduleIT/TotalTaxPayments", R(ch.reduce((s, r) => s + N(r.amt), 0))); }
  const tcs = (paid.tcs || []).filter((r) => R(r.amt));
  if (tcs.length && kind === "itr4") { put(o, prefix + "ScheduleTCS/TCS", tcs.map((r) => ({ EmployerOrDeductorOrCollectDetl: { TAN: r.tan, EmployerOrDeductorOrCollecterName: r.name || "" }, Amtfrom26AS: R(r.amt), TotalTCS: R(r.amt), AmtTCSClaimedThisYear: R(r.amt) }))); put(o, prefix + "ScheduleTCS/TotalSchTCS", R(tcs.reduce((s, r) => s + N(r.amt), 0))); }
  else if (tcs.length && kind === "itr3") { put(o, prefix + "ScheduleTCS/TCS", tcs.map((r) => ({ TCSCreditOwner: "1", EmployerOrDeductorOrCollectTAN: r.tan, TCSCurrFYDtls: { TCSAmtCollOwnHand: R(r.amt) }, TCSClaimedThisYearDtls: { TCSAmtCollOwnHand: R(r.amt) }, AmtCarriedFwd: 0 }))); put(o, prefix + "ScheduleTCS/TotalSchTCS", R(tcs.reduce((s, r) => s + N(r.amt), 0))); }
  // ITR-5 and ITR-6: TCSDetails, the credit's owner "S" (self)
  else if (tcs.length) { put(o, prefix + "ScheduleTCS/TCSDetails", tcs.map((r) => ({ EmployerOrDeductorOrCollectDetl: { TCSCreditName: "S", TAN: r.tan }, TCSCurrFYDtls: { TCSAmtCollOwnHands: R(r.amt) }, TCSClaimedThisYearDtls: { TCSAmtCollOwnHands: R(r.amt) }, AmtCarriedFwd: 0 }))); put(o, prefix + "ScheduleTCS/TotalSchTCS", R(tcs.reduce((s, r) => s + N(r.amt), 0))); }
}
// the account type is the owner's to say (its choices differ: SB for a person, CA / CC / OD for a company): asked unless given
function bankOf(P) { const b = P.bank || {}; if (!b.ifsc) return undefined; const x = { IFSCCode: b.ifsc, BankName: b.name, BankAccountNo: b.account, UseForRefund: "true" }; if (b.typeSet) x.AccountType = b.type; return [x]; }

// ---------------- ITR-4 ----------------
function itr4(X) {
  const M = X.model, S = X.comp, P = X.profile || {}, o = {}, pres = S.presumptive || { lines: [] };
  common(X, o, "ITR4");
  person(P, "PersonalInfo", o);
  if (P.dob) put(o, "PersonalInfo/DOB", P.dob);
  put(o, "PersonalInfo/Status", M.entity === "H" ? "H" : M.entity === "F" ? "F" : "I");
  if (!M.salary) put(o, "PersonalInfo/EmployerCategory", "NA");
  if (P.aadhaar) put(o, "PersonalInfo/AadhaarCardNo", P.aadhaar);
  put(o, "PersonalInfo/SecondaryAdd", "N");
  if (P.returnSec) put(o, "FilingStatus/ReturnFileSec", +P.returnSec);
  put(o, "FilingStatus/ItrFilingDueDate", "2026-08-31");
  put(o, "FilingStatus/AsseseeRepFlg", "N");
  if (M.entity !== "F") put(o, "FilingStatus/F10IEACurrAYOldRegime", M.regime === "old" ? "Y" : "N");
  const h = S.heads || {};
  const sal = M.salary ? R(M.salary.gross) : 0;
  put(o, "IncomeDeductions/IncomeFromBusinessProf", P0(S.after ? S.after.pgbp : h.pgbp));
  put(o, "IncomeDeductions/GrossSalary", sal); put(o, "IncomeDeductions/NetSalary", sal); put(o, "IncomeDeductions/DeductionUs16", M.salary ? R(M.salary.std) : 0); put(o, "IncomeDeductions/IncomeFromSal", R(h.sal));
  put(o, "IncomeDeductions/TotalIncomeChargeableUnHP", R(h.hp)); put(o, "IncomeDeductions/IncomeOthSrc", R(h.os));
  put(o, "IncomeDeductions/GrossTotIncome", R(S.gti - h.c112A)); put(o, "IncomeDeductions/GrossTotIncomeIncLTCG112A", R(S.gti));
  const d = M.deductions || {}, via = (k) => R(d[k]);
  const V = { Section80C: via("80C"), Section80CCC: via("80CCC"), Section80CCDEmployeeOrSE: via("80CCD1"), Section80CCD1B: via("80CCD1B"), Section80CCDEmployer: via("80CCD2"), Section80D: via("80D"), Section80DD: via("80DD"), Section80DDB: via("80DDB"),
    Section80E: via("80E"), Section80G: via("80G"), Section80GG: via("80GG"), Section80GGC: via("80GGC"), Section80U: via("80U"), Section80TTA: via("80TTA"), Section80TTB: via("80TTB"), AnyOthSec80CCH: via("80CCH") };
  const sumV = Object.values(V).reduce((s, v) => s + v, 0);
  put(o, "IncomeDeductions/UsrDeductUndChapVIA", Object.assign({}, V, { TotalChapVIADeductions: sumV }));
  put(o, "IncomeDeductions/DeductUndChapVIA", Object.assign({}, V, { TotalChapVIADeductions: R(S.ded) }));
  put(o, "IncomeDeductions/TotalIncome", R(S.ti));
  const t = S.tax || {}, gross = R(t.normalTax + t.specialTax);
  put(o, "TaxComputation/TotalTaxPayable", gross); put(o, "TaxComputation/Rebate87A", R(t.rebate)); put(o, "TaxComputation/TaxPayableOnRebate", R(gross - t.rebate));
  put(o, "TaxComputation/EducationCess", R(t.cess)); put(o, "TaxComputation/GrossTaxLiability", R(S.liability)); put(o, "TaxComputation/NetTaxLiability", R(S.liability));
  const I = S.interest || {};
  put(o, "TaxComputation/IntrstPay", { IntrstPayUs234A: R(I.a), IntrstPayUs234B: R(I.b), IntrstPayUs234C: R(I.c), LateFilingFee234F: R(I.f) });
  put(o, "TaxComputation/TotTaxPlusIntrstPay", R(S.liability + I.a + I.b + I.c + I.f));
  if (t.sur) put(o, "TaxComputation/SurchargeOnAboveCrore", R(t.sur));
  put(o, "TaxPaid/TaxesPaid", { AdvanceTax: R(S.adv), TDS: R(S.tds), TCS: R(S.tcs), SelfAssessmentTax: R(S.sat), TotalTaxesPaid: R(S.adv + S.tds + S.tcs + S.sat) });
  put(o, "TaxPaid/BalTaxPayable", R(S.payable)); put(o, "Refund/RefundDue", R(S.refund));
  const bk = bankOf(P); if (bk) put(o, "Refund/BankAccountDtls/AddtnlBankDetails", bk);
  // Schedule BP
  const ad = pres.lines.find((l) => l.key === "p44ad"), ada = pres.lines.find((l) => l.key === "p44ada"), ae = pres.lines.find((l) => l.key === "p44ae");
  const nat = (k) => (P.business || []).filter((x) => x.kind === k).map((x) => ({ NameOfBusiness: x.name, ["Code" + k]: x.code, Description: x.desc || x.name }));
  if (ad) {
    if (nat("AD").length) put(o, "ScheduleBP/NatOfBus44AD", nat("AD"));
    put(o, "ScheduleBP/PersumptiveInc44AD", { GrsTotalTrnOver: R(ad.gross), GrsTrnOverBank: R(ad.dig), GrsTrnOverAnyOthMode: R(ad.oth), PersumptiveInc44AD6Per: R(ad.dig * 0.06), PersumptiveInc44AD8Per: R(ad.amt - R(ad.dig * 0.06)), TotPersumptiveInc44AD: R(ad.amt) });
  }
  if (ada) { if (nat("ADA").length) put(o, "ScheduleBP/NatOfBus44ADA", nat("ADA")); put(o, "ScheduleBP/PersumptiveInc44ADA", { GrsReceipt: R(ada.gross), GrsTrnOverBank44ADA: R(ada.gross - N(ada.cash)), GrsTotalTrnOverInCash44ADA: R(ada.cash), TotPersumptiveInc44ADA: R(ada.amt) }); }
  if (ae) { if (nat("AE").length) put(o, "ScheduleBP/NatOfBus44AE", nat("AE")); }
  put(o, "ScheduleBP/PersumptiveInc44AE", { TotPersumInc44AE: R(ae ? ae.amt : 0), TotalPersumptiveInc: R(S.heads.pgbp), IncChargeableUnderBus: P0(S.heads.pgbp) });
  const g = X.gstTurnover || [];
  if (g.length) { put(o, "ScheduleBP/TurnoverGrsRcptForGSTIN", g.map((x) => ({ GSTINNo: x.gstin, AmtTurnGrossRcptGSTIN: R(x.amt) }))); put(o, "ScheduleBP/TotalTurnoverGrsRcptGSTIN", R(g.reduce((s, x) => s + N(x.amt), 0))); }
  const F = X.fin44; if (F) put(o, "ScheduleBP/FinanclPartclrOfBusiness", F);
  taxPaidLists(X, o, "", "itr4");
  verification(P, o, "Verification", "itr4");
  return o;
}
function verification(P, o, base, kind) {
  if (P.verName) put(o, base + "/Declaration/AssesseeVerName", P.verName);
  if (P.father) put(o, base + "/Declaration/FatherName", P.father);
  if (P.verPan) put(o, base + "/Declaration/AssesseeVerPAN", P.verPan);
  // the capacity's choices differ form by form (S / R ... for ITR-3/4; MP / DP / PA ... for ITR-5; MD / DR ... for ITR-6):
  // asked from the schema's own list (fill.js), never assumed
  if (kind === "co") { if (P.place) put(o, base + "/Declaration/Place", P.place); if (P.verDate) put(o, base + "/Declaration/Date", P.verDate); return; }
  if (P.capacity && /^[SRKP]$/.test(P.capacity)) put(o, base + "/Capacity", P.capacity);
  if (P.place) put(o, base + "/Place", P.place);
  if (kind !== "itr4" && P.verDate) put(o, base + "/Date", P.verDate);
}

// the books' balance sheet and P&L in the ITR-3 / ITR-5 "FundSrc / FundApply" layout
function bsFund(X, o, base, capKey) {
  const sc = X.sched; if (!sc) return;
  const b = sc.bs, t = sc.totals, v = (k) => R(b[k].cy);
  const res = v("reserves");
  const cap = R(t.equity - res);
  put(o, base + "/FundSrc/" + capKey + "/" + (capKey === "PropFund" ? "PropCap" : "PartnerOrMemberCap"), cap);
  put(o, base + "/FundSrc/" + capKey + "/ResrNSurp/OthResr", res); put(o, base + "/FundSrc/" + capKey + "/ResrNSurp/TotResrNSurp", res);
  put(o, base + "/FundSrc/" + capKey + "/" + (capKey === "PropFund" ? "TotPropFund" : "TotPartnerOrMemberFund"), R(t.equity));
  put(o, base + "/FundSrc/LoanFunds/SecrLoan/RupeeLoan/FrmBank", v("securedBank")); put(o, base + "/FundSrc/LoanFunds/SecrLoan/RupeeLoan/TotRupeeLoan", v("securedBank")); put(o, base + "/FundSrc/LoanFunds/SecrLoan/TotSecrLoan", v("securedBank"));
  if (capKey === "PropFund") { put(o, base + "/FundSrc/LoanFunds/UnsecrLoan/FrmOthrs", v("unsecuredOthers")); }
  else { put(o, base + "/FundSrc/LoanFunds/UnsecrLoan/RupeeLoan/FrmOthrs", v("unsecuredOthers")); put(o, base + "/FundSrc/LoanFunds/UnsecrLoan/RupeeLoan/TotRupeeLoan", v("unsecuredOthers")); }
  put(o, base + "/FundSrc/LoanFunds/UnsecrLoan/TotUnSecrLoan", v("unsecuredOthers"));
  put(o, base + "/FundSrc/LoanFunds/TotLoanFund", v("securedBank") + v("unsecuredOthers"));
  put(o, base + "/FundSrc/DeferredTax", v("deferredTax"));
  put(o, base + "/FundSrc/Advances/" + (capKey === "PropFund" ? "FromOthers" : "FrmOthers"), v("advancesIn")); put(o, base + "/FundSrc/Advances/TotalAdvances", v("advancesIn"));
  put(o, base + "/FundSrc/TotFundSrc", R(t.sources));
  const nb = v("grossBlock") - v("accDep");
  put(o, base + "/FundApply/FixedAsset", { GrossBlock: v("grossBlock"), Depreciation: v("accDep"), NetBlock: nb, CapWrkProg: v("cwip"), TotFixedAsset: nb + v("cwip") });
  if (capKey === "PropFund") {
    put(o, base + "/FundApply/Investments/LongTermInv/GovOthSecUnQoted", v("investLong")); put(o, base + "/FundApply/Investments/LongTermInv/TotLongTermInv", v("investLong"));
    put(o, base + "/FundApply/Investments/TradeInv/EquityShares", v("investCurrent")); put(o, base + "/FundApply/Investments/TradeInv/TotTradeInv", v("investCurrent"));
  } else {
    put(o, base + "/FundApply/Investments/LongTermInv/Others", v("investLong")); put(o, base + "/FundApply/Investments/LongTermInv/TotLongTermInv", v("investLong"));
    put(o, base + "/FundApply/Investments/ShortTermInv/Others", v("investCurrent")); put(o, base + "/FundApply/Investments/ShortTermInv/TotShortTermInv", v("investCurrent"));
  }
  put(o, base + "/FundApply/Investments/TotInvestments", v("investLong") + v("investCurrent"));
  const ca = base + "/FundApply/CurrAssetLoanAdv";
  put(o, ca + "/CurrAsset/Inventories/FinOrTradGood", v("inventory")); put(o, ca + "/CurrAsset/Inventories/TotInventries", v("inventory"));
  if (capKey === "PropFund") put(o, ca + "/CurrAsset/SndryDebtors", v("debtors"));
  else { put(o, ca + "/CurrAsset/SundryDebtorDtls/Others", v("debtors")); put(o, ca + "/CurrAsset/SundryDebtorDtls/TotalSundryDebtors", v("debtors")); }
  put(o, ca + "/CurrAsset/CashOrBankBal", { CashinHand: v("cash"), BankBal: v("bank"), TotCashOrBankBal: v("cash") + v("bank") });
  put(o, ca + "/CurrAsset/OthCurrAsset", v("otherCA")); put(o, ca + "/CurrAsset/TotCurrAsset", R(t.ca));
  put(o, ca + "/LoanAdv", { AdvRecoverable: v("advRecoverable"), Deposits: v("deposits"), BalWithRevAuth: v("revenueAuth"), TotLoanAdv: R(t.la) });
  put(o, ca + "/TotCurrAssetLoanAdv", R(t.ca + t.la));
  if (capKey === "PropFund") put(o, ca + "/CurrLiabilitiesProv/CurrLiabilities/SundryCred", v("creditors"));
  else { put(o, ca + "/CurrLiabilitiesProv/CurrLiabilities/SundryCreditorDtls/Others", v("creditors")); put(o, ca + "/CurrLiabilitiesProv/CurrLiabilities/SundryCreditorDtls/TotalSundryCreditors", v("creditors")); }
  put(o, ca + "/CurrLiabilitiesProv/CurrLiabilities/TotCurrLiabilities", v("creditors"));
  put(o, ca + "/CurrLiabilitiesProv/Provisions", { ITProvision: v("provTax"), ELSuperAnnGratProvision: v("provEmp"), OthProvision: v("provOther"), TotProvisions: v("provTax") + v("provEmp") + v("provOther") });
  put(o, ca + "/CurrLiabilitiesProv/TotCurrLiabilitiesProvision", R(t.cl));
  put(o, ca + "/NetCurrAsset", R(t.ca + t.la - t.cl));
  put(o, base + "/FundApply/MiscAdjust", { DefTaxAsset: v("dta"), TotMiscAdjust: v("dta") });
  put(o, base + "/FundApply/TotFundApply", R(t.apply));
}
function plMain(X, o, base, kind) {
  const sc = X.sched; if (!sc) return;
  const p = sc.pl, t = sc.totals, v = (k) => R(p[k].cy);
  const oth = v("interestInc") + v("profitAssets") + v("fxGain") + v("miscInc");
  put(o, base + "/CreditsToPL/OthIncome", { InterestInc: v("interestInc"), ProfitOnSaleFixedAsset: v("profitAssets"), ProfitOnCurrFluct: v("fxGain"), MiscOthIncome: v("miscInc"), TotOthIncome: oth });
  const gp = R(sc.trading.grossProfit);
  put(o, base + "/CreditsToPL/GrossProfitTrnsfFrmTrdAcc", gp);
  put(o, base + "/CreditsToPL/TotCreditsToPL", R(gp + oth));
  const f5 = kind === "itr5", D = base + (f5 ? "/DebitsToPL/DebitPlAcnt" : "/DebitsToPL"), TP = base + (f5 ? "/DebitsToPL/TaxProvAppr" : "/TaxProvAppr");
  put(o, D + "/PowerFuel", v("power")); put(o, D + "/RentExpdr", v("rent")); put(o, D + "/RepairMach", v("repairs"));
  put(o, D + "/EmployeeComp", { SalsWages: v("salaries"), ContToPF: v("pf"), ContToGratFund: v("gratuity"), OthEmpBenftExpdr: v("staffWelfare"), TotEmployeeComp: v("salaries") + v("pf") + v("gratuity") + v("staffWelfare") });
  put(o, D + "/Insurances/OthInsur", v("insurance")); put(o, D + "/Insurances/TotInsurances", v("insurance"));
  put(o, D + "/Advertisement", v("advert")); put(o, D + "/TravelExp", v("travel")); put(o, D + "/TelephoneExp", v("telephone")); put(o, D + "/Donation", v("csr"));
  put(o, D + "/CommissionExpdrDtls/Others", v("commission")); put(o, D + "/CommissionExpdrDtls/Total", v("commission"));
  put(o, D + "/ProfessionalConstDtls/Others", v("professional")); put(o, D + "/ProfessionalConstDtls/Total", v("professional"));
  put(o, D + "/RatesTaxesPays/ExciseCustomsVAT/OthDutyTaxCess", v("rates")); put(o, D + "/RatesTaxesPays/ExciseCustomsVAT/TotExciseCustomsVAT", v("rates"));
  put(o, D + "/AuditFee", v("audit"));
  // a firm's partners: their salary in its own line (ITR-5 SalRemuneration), their interest in InterestExpdrtDtls/ResPartners
  const other = v("otherExp") + v("interestStat") + v("exceptional") + (f5 ? 0 : v("partnerRem") + v("partnerInt"));
  put(o, D + "/OtherExpenses", other);
  if (f5) put(o, D + "/SalRemuneration", v("partnerRem"));
  put(o, D + "/BadDebtDtls/BadDebt", v("badDebts"));
  const fin = v("interestExp") + (f5 ? v("partnerInt") : 0);
  put(o, D + "/PBIDTA", R(t.pbt + fin + v("depreciation")));
  if (f5) put(o, D + "/InterestExpdrtDtls", { Others: v("interestExp"), ResPartners: v("partnerInt"), InterestExpdr: fin });
  else { put(o, D + "/InterestExpdrtDtls/Others", fin); put(o, D + "/InterestExpdrtDtls/InterestExpdr", fin); }
  put(o, D + "/DepreciationAmort", v("depreciation"));
  put(o, D + "/PBT", R(t.pbt));
  put(o, TP + "/ProvForCurrTax", v("taxCurrent")); put(o, TP + "/ProvDefTax", v("taxDeferred"));
  put(o, TP + "/ProfitAfterTax", R(t.pat)); put(o, TP + "/AmtAvlAppr", R(t.pat));
  if (f5) put(o, TP + "/PartnerAccBalTrf", R(t.pat));
}
function trading(X, o, base) {
  const sc = X.sched; if (!sc) return;
  const p = sc.pl, tr = sc.trading, v = (k) => R(p[k].cy);
  put(o, base + "/SaleOfGoods", v("saleGoods")); put(o, base + "/SaleOfServices", v("saleServices"));
  put(o, base + "/OperatingRevenueTotal", v("otherOpRev"));
  if (v("otherOpRev")) put(o, base + "/OtherOperatingRevenueDtls", [{ OperatingRevenueName: "Other operating revenue", OperatingRevenueAmt: v("otherOpRev") }]);
  put(o, base + "/SalesGrossReceiptsTotal", R(tr.sales)); put(o, base + "/TotRevenueFrmOperations", R(tr.sales));
  put(o, base + "/ClsngStckOfFinishedStcks", R(tr.closingStock)); put(o, base + "/TardingAccTotCred", R(tr.sales + tr.closingStock));
  put(o, base + "/OpngStckOfFinishedStcks", R(tr.openingStock)); put(o, base + "/Purchases", R(tr.purchases)); put(o, base + "/DirectExpenses", 0);
  put(o, base + "/GrossProfitFrmBusProf", R(tr.grossProfit));
}
function bp(X, o, base, othKey) {
  othKey = othKey || "OthItemDisallowUs28To44DA";
  const S = X.comp, M = X.model, L = (k) => lineOf(S, k), adds = (M.business && M.business.adds) || [], less = (M.business && M.business.less) || [];
  const by = (xs, slot) => R(xs.filter((a) => a.bp === slot).reduce((s, a) => s + N(a.amt), 0));
  const B = base + "/BusinessIncOthThanSpec";
  const pbt = R(M.business ? M.business.pbt : 0), os = by(less, "IncRecCredPLOthHeadDtls.OtherSources");
  put(o, B + "/ProfBfrTaxPL", pbt);
  put(o, B + "/IncRecCredPLOthHeadDtls/OtherSources", os); put(o, B + "/IncRecCredPLOthHeadDtls/OtherThanDividend", os);
  const bal = pbt - os;
  put(o, B + "/BalancePLOthThanSpecBus", bal); put(o, B + "/AdjustedPLOthThanSpecBus", bal);
  const bookDep = by(adds, "DepreciationDebPLCosAct");
  put(o, B + "/DepreciationDebPLCosAct", bookDep);
  const itd = R(S.itDep);
  put(o, B + "/DepreciationAllowITAct32", { DepreciationAllowUs32_1_ii: itd, TotDeprAllowITAct: itd });
  const after = bal + bookDep - itd;
  put(o, B + "/AdjustPLAfterDeprOthSpecInc", after);
  const a36 = by(adds, "AmtDebPLDisallowUs36"), a37 = by(adds, "AmtDebPLDisallowUs37"), a40 = by(adds, "AmtDebPLDisallowUs40") + R(L("add:40b_int")) + R(L("add:40b_rem")), a40A = by(adds, "AmtDebPLDisallowUs40A"), a43B = by(adds, "AmtDebPLDisallowUs43B"), oth = by(adds, "OthItemDisallowUs28To44DA");
  put(o, B + "/AmtDebPLDisallowUs36", a36); put(o, B + "/AmtDebPLDisallowUs37", a37); put(o, B + "/AmtDebPLDisallowUs40", a40); put(o, B + "/AmtDebPLDisallowUs40A", a40A); put(o, B + "/AmtDebPLDisallowUs43B", a43B);
  put(o, B + "/" + othKey, oth);
  const totAdd = a36 + a37 + a40 + a40A + a43B + oth;
  put(o, B + "/TotAfterAddToPLDeprOthSpecInc", after + totAdd);
  const d43 = by(less, "AmtDisallUs43BNowAllow"), dOth = by(less, "AnyOthAmtAllDeduct");
  put(o, B + "/AmtDisallUs43BNowAllow", d43); put(o, B + "/AnyOthAmtAllDeduct", dOth);
  put(o, B + "/TotDeductionAmts", d43 + dOth);
  const net = after + totAdd - d43 - dOth;
  put(o, B + "/PLAftAdjDedBusOthThanSpec", net); put(o, B + "/NetPLAftAdjBusOthThanSpec", net); put(o, B + "/NetPLBusOthThanSpec7A7B7C", net); put(o, B + "/IncomeOtherThanRule", net);
  return net;
}
function partBTI(X, o, base, kind) {
  const S = X.comp, h = S.after || {}, H = S.heads || {};
  if (kind === "ind") put(o, base + "/Salaries", R(h.sal));
  put(o, base + "/IncomeFromHP", R(h.hp));
  if (kind !== "co") { put(o, base + "/ProfBusGain", { ProfGainNoSpecBus: P0(H.pgbp), TotProfBusGain: P0(H.pgbp) }); }
  put(o, base + "/IncFromOS", { OtherSrcThanOwnRaceHorse: R(H.os), TotIncFromOS: R(H.os) });
  const ti0 = R(Math.max(0, H.pgbp) + H.sal + H.hp + H.os + H.cg);
  put(o, base + "/TotalTI", ti0);
  put(o, base + "/CurrentYearLoss", R(lineOf(S, "cyla_bp")));
  put(o, base + "/BalanceAfterSetoffLosses", R(ti0 - lineOf(S, "cyla_bp")));
  put(o, base + "/BroughtFwdLossesSetoff", R(lineOf(S, "bfla_bp") + lineOf(S, "bfla_ud")));
  put(o, base + "/GrossTotalIncome", R(S.gti));
  put(o, base + "/IncChargeTaxSplRate111A112", R(S.special));
  put(o, base + "/DeductionsUndSchVIADtl", { PartBchapterVIA: R(S.ded), TotDeductUndSchVIA: R(S.ded) });
  put(o, base + "/TotalIncome", R(S.ti));
  if (kind === "co") { put(o, base + "/IncChargeableTaxSplRates", R(S.special)); put(o, base + "/IncChargeableTaxNormalRates", R(S.normal)); }
  else { put(o, base + "/AggregateIncome", R(S.ti)); if (kind === "firm") put(o, base + "/IncChargeableTaxSplRates", R(S.special)); }
}
function partBTTI(X, o, base, kind) {
  const S = X.comp, t = S.tax || {}, I = S.interest || {}, C = base + "/ComputationOfTaxLiability";
  const mat = t.mat && t.mat.applies;
  if (kind === "firm") {
    put(o, C + "/TaxPayableOnDeemedTI", { TaxDeemedTISec115JC: 0, Surcharge: 0, EducationCess: 0, TotalTax: 0 });
    put(o, C + "/TaxPayableOnTI", { TaxAtNormalRates: R(t.normalTax), TaxAtSpecialRates: R(t.specialTax), TaxPayableOnTotInc: R(t.normalTax + t.specialTax), SurchargeOnTaxPayable: R(t.sur), SurchargeOnTaxPayableBeforeMarginal: R(t.sur + N(t.relief)), TotalSurcharge: R(t.sur), EducationCess: R(t.cess), GrossTaxLiability: R(S.liability) });
    put(o, C + "/GrossTaxPayable", R(S.liability));
  } else if (kind === "co") {
    put(o, C + "/TaxPayableOnDeemedTI", mat ? { TaxDeemedTISec115JB: R(t.normalTax), Surcharge: R(t.sur), EducationCess: R(t.cess), TotalTax: R(S.liability) } : { TaxDeemedTISec115JB: 0, Surcharge: 0, EducationCess: 0, TotalTax: 0 });
    const nt = mat ? R(t.normalTaxShown) : R(t.normalTax);
    put(o, C + "/TaxPayableOnTI", { TaxAtNormalRates: nt, TaxAtSpecialRates: mat ? 0 : R(t.specialTax), TaxPayableOnTotInc: mat ? nt : R(t.normalTax + t.specialTax), SurchargeOnTaxPayable: mat ? 0 : R(t.sur), TotalSurcharge: mat ? 0 : R(t.sur), EducationCess: mat ? 0 : R(t.cess), GrossTaxLiability: mat ? 0 : R(S.liability + N(t.matCreditUsed)) });
    put(o, C + "/GrossTaxPayable", R(S.liability + N(t.matCreditUsed)));
    if (t.matCreditUsed) { put(o, C + "/CreditUS115JAA", R(t.matCreditUsed)); }
  } else {
    put(o, C + "/TaxPayableOnTI", { TaxAtNormalRatesOnAggrInc: R(t.normalTax), TaxAtSpecialRates: R(t.specialTax), TaxPayableOnTotInc: R(t.normalTax + t.specialTax), Rebate87A: R(t.rebate), TaxPayableOnRebate: R(t.normalTax + t.specialTax - t.rebate),
      SurchargeOnAboveCrore: R(t.sur), SurchargeOnAboveCroreBeforeMarginal: R(t.sur + N(t.relief)), TotalSurcharge: R(t.sur), EducationCess: R(t.cess), GrossTaxLiability: R(S.liability) });
    put(o, C + "/GrossTaxPayable", R(S.liability)); put(o, C + "/TaxPayAfterCreditUs115JD", R(S.liability));
  }
  put(o, C + "/NetTaxLiability", R(S.liability));
  put(o, C + "/IntrstPay", Object.assign({ IntrstPayUs234A: R(I.a), IntrstPayUs234B: R(I.b), IntrstPayUs234C: R(I.c), LateFilingFee234F: R(I.f) }, kind !== "ind" ? { TotalIntrstPay: R(I.a + I.b + I.c + I.f) } : {}));
  put(o, C + "/AggregateTaxInterestLiability", R(S.liability + I.a + I.b + I.c + I.f));
  put(o, base + "/TaxPaid/TaxesPaid", { AdvanceTax: R(S.adv), TDS: R(S.tds), TCS: R(S.tcs), SelfAssessmentTax: R(S.sat), TotalTaxesPaid: R(S.adv + S.tds + S.tcs + S.sat) });
  put(o, base + "/TaxPaid/BalTaxPayable", R(S.payable));
  put(o, base + "/Refund/RefundDue", R(S.refund));
  const bk = bankOf(X.profile || {});
  if (bk) { put(o, base + "/Refund/BankAccountDtls/BankDtlsFlag", "Y"); put(o, base + "/Refund/BankAccountDtls/AddtnlBankDetails", bk); }
}

// ---------------- ITR-3 ----------------
function itr3(X) {
  const M = X.model, P = X.profile || {}, o = {};
  common(X, o, "ITR3");
  person(P, "PartA_GEN1/PersonalInfo", o);
  if (P.dob) put(o, "PartA_GEN1/PersonalInfo/DOB", P.dob);
  put(o, "PartA_GEN1/PersonalInfo/Status", M.entity === "H" ? "H" : "I");
  put(o, "PartA_GEN1/PersonalInfo/SecondaryAdd", "N");
  if (P.aadhaar) put(o, "PartA_GEN1/PersonalInfo/AadhaarCardNo", P.aadhaar);
  if (P.returnSec) put(o, "PartA_GEN1/FilingStatus/ReturnFileSec", +P.returnSec);
  put(o, "PartA_GEN1/FilingStatus/IncFrmBusOrProf", "Y");
  put(o, "PartA_GEN1/FilingStatus/ItrFilingDueDate", M.tp ? "2026-11-30" : M.audit ? "2026-10-31" : "2026-08-31");
  put(o, "PartA_GEN1/FilingStatus/OptOldRegimeCurrAY", M.regime === "old" ? "Y" : "N");
  put(o, "PartA_GEN2/AuditInfo/LiableSec44AAflg", "Y");
  put(o, "PartA_GEN2/AuditInfo/LiableSec44ABflg", M.audit ? "Y" : "N");
  put(o, "PartA_GEN2/AuditInfo/LiableSec92Eflg", M.tp ? "Y" : "N");
  bsFund(X, o, "PARTA_BS", "PropFund");
  trading(X, o, "TradingAccount");
  plMain(X, o, "PARTA_PL", "itr3");
  put(o, "PARTA_PL/TaxProvAppr/ProprietorAccBalTrf", X.sched ? R(X.sched.totals.pat) : 0);
  bp(X, o, "ITR3ScheduleBP");
  put(o, "ITR3ScheduleBP/IncChrgUnHdProftGain", P0(X.comp.heads.pgbp));
  partBTI(X, o, "PartB-TI", "ind");
  partBTTI(X, o, "PartB_TTI", "ind");
  put(o, "PartB_TTI/AssetOutIndiaFlag", P.foreignAssets || undefined);
  taxPaidLists(X, o, "", "itr3");
  verification(P, o, "Verification", "itr3");
  return o;
}
// ---------------- ITR-5 (firms and LLPs) ----------------
function itr5(X) {
  const M = X.model, P = X.profile || {}, o = {};
  common(X, o, "ITR5");
  person(P, "PartA_GEN1/OrgFirmInfo", o, true);
  if (P.incorp) put(o, "PartA_GEN1/OrgFirmInfo/DateOFFormOrIncorp", P.incorp);
  if (P.returnSec) put(o, "PartA_GEN1/FilingStatus/ReturnFileSec/IncomeTaxSec", +P.returnSec);
  put(o, "PartA_GEN1/FilingStatus/ItrFilingDueDate", M.tp ? "2026-11-30" : M.audit ? "2026-10-31" : "2026-08-31");
  bsFund(X, o, "PARTA_BS", "PartnerOrMemberFund");
  trading(X, o, "TradingAccount");
  plMain(X, o, "PARTA_PL", "itr5");
  bp(X, o, "CorpScheduleBP", "OthItemDisallowUs28To44DB");
  partBTI(X, o, "PartB-TI", "firm");
  partBTTI(X, o, "PartB_TTI", "firm");
  taxPaidLists(X, o, "", "itr5");
  verification(P, o, "Verification", "co");
  return o;
}
// ---------------- ITR-6 (companies) ----------------
function itr6(X) {
  const M = X.model, P = X.profile || {}, o = {}, sc = X.sched;
  common(X, o, "ITR6");
  person(P, "PartA_GEN1/OrgFirmInfo", o, true);
  if (P.incorp) put(o, "PartA_GEN1/OrgFirmInfo/DateOFFormOrIncorp", P.incorp);
  if (P.returnSec) put(o, "PartA_GEN1/FilingStatus/ReturnFileSec/IncomeTaxSec", +P.returnSec);
  put(o, "PartA_GEN1/FilingStatus/ItrFilingDueDate", M.tp ? "2026-11-30" : "2026-10-31");
  put(o, "PartA_GEN2For6/LiableSec44ABflg", M.audit ? "Y" : "N");
  if (sc) {
    const b = sc.bs, t = sc.totals, v = (k) => R(b[k].cy), B = "PARTA_BSFor6FrmAY13";
    const sh = v("shareCap"), rs = R(t.equity - sh);
    put(o, B + "/EquityAndLiablities/ShareHolderFund/ShareCapital/IssuedSubsPaidUp", sh); put(o, B + "/EquityAndLiablities/ShareHolderFund/ShareCapital/TotShareCapital", sh);
    put(o, B + "/EquityAndLiablities/ShareHolderFund/ResrNSurp/PLAccount", R(rs - v("reserves"))); put(o, B + "/EquityAndLiablities/ShareHolderFund/ResrNSurp/OtherResrvTotal", v("reserves"));
    put(o, B + "/EquityAndLiablities/ShareHolderFund/ResrNSurp/TotResrNSurp", rs); put(o, B + "/EquityAndLiablities/ShareHolderFund/TotShareHolderFund", R(t.equity));
    put(o, B + "/EquityAndLiablities/NonCurrLiabilities/LongTermBorrowings/TermLoans/RupeeLoans/FromBanks", v("securedBank"));
    put(o, B + "/EquityAndLiablities/NonCurrLiabilities/NetDefferedTaxLiability", v("deferredTax"));
  }
  if (sc) put(o, "CorpScheduleBP/BusinessIncOthThanSpec/ProfBfrTaxPL", R(sc.totals.pbt));
  bp(X, o, "CorpScheduleBP", "OthItemDisallowUs28To44DA");
  partBTI(X, o, "PartB-TI", "co");
  partBTTI(X, o, "PartB_TTI", "co");
  taxPaidLists(X, o, "", "itr6");
  verification(P, o, "Verification", "co");
  return o;
}

export function mapReturn(X) {
  const f = { "ITR-3": itr3, "ITR-4": itr4, "ITR-5": itr5, "ITR-6": itr6 }[X.form];
  if (!f) throw new Error("no map for " + X.form);
  return f(X);
}
