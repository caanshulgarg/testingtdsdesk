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

// the schema's VI-A field for each section (the allowed amounts, tax.js S.viaAllowed)
const VIA4 = { "80C": "Section80C", "80CCC": "Section80CCC", "80CCD1": "Section80CCDEmployeeOrSE", "80CCD1B": "Section80CCD1B", "80CCD2": "Section80CCDEmployer", "80D": "Section80D", "80DD": "Section80DD", "80DDB": "Section80DDB",
  "80E": "Section80E", "80G": "Section80G", "80GG": "Section80GG", "80GGC": "Section80GGC", "80U": "Section80U", "80TTA": "Section80TTA", "80TTB": "Section80TTB", "80CCH": "AnyOthSec80CCH" };
const VIA3 = Object.assign({}, VIA4, { "80EE": "Section80EE", "80EEA": "Section80EEA", "80EEB": "Section80EEB", "80GGA": "Section80GGA", "80IA": "Section80IA", "80IAB": "Section80IAB", "80IB": "Section80IB", "80IBA": "Section80IBA", "80IC": "Section80IC", "80JJA": "Section80JJA", "80JJAA": "Section80JJAA", "80QQB": "Section80QQB", "80RRB": "Section80RRB" });
function viaAllowed(S, MAP) {
  const out = {}, a = S.viaAllowed || {};
  Object.values(MAP).forEach((f) => { out[f] = 0; });
  // 80C, 80CCC and 80CCD(1) share one limit (80CCE): the allowed amount is shown against 80C
  Object.keys(a).forEach((k) => { if (MAP[k]) out[MAP[k]] = (out[MAP[k]] || 0) + R(a[k]); });
  return out;
}
const BLOCK_PATH = { pm15: "ScheduleDPM/PlantMachinery/Rate15", pm30: "ScheduleDPM/PlantMachinery/Rate30", c40: "ScheduleDPM/PlantMachinery/Rate40", b5: "ScheduleDOA/Building/Rate5", b10: "ScheduleDOA/Building/Rate10",
  b40: "ScheduleDOA/Building/Rate40", f10: "ScheduleDOA/FurnitureFittings/Rate10", i25: "ScheduleDOA/IntangibleAssets/Rate25", s20: "ScheduleDOA/Ships/Rate20" };
// Schedules DPM, DOA and DEP from the section 32 blocks (FinDepr: open, additions over / under 180 days, sales, depreciation)
function depSchedules(X, o) {
  const bl = ((X.model.business || {}).itBlocks || []).filter((b) => BLOCK_PATH[b.key] && (N(b.open) || N(b.addA) || N(b.addB) || N(b.sale) || N(b.dep)));
  const sum = {};
  bl.forEach((b) => {
    const rate = N(b.rate) || +b.key.replace(/\D/g, "") / 100, full = Math.max(0, N(b.open) + N(b.addA) - N(b.sale)), half = Math.max(0, N(b.addB) + Math.min(0, N(b.open) + N(b.addA) - N(b.sale)));
    const dFull = R(full * rate), dep = R(b.dep), base = BLOCK_PATH[b.key] + "/DepreciationDetail";
    put(o, base, Object.assign(X.form === "ITR-6" ? {} : { Total: R(b.open) }, { WDVFirstDay: R(b.open), AdditionsGrThan180Days: R(b.addA), RealizationTotalPeriod: R(b.sale), FullRateDeprAmt: R(full), AdditionsLessThan180Days: R(b.addB), HalfRateDeprAmt: R(half),
      DepreciationAtFullRate: dFull, DepreciationAtHalfRate: R(dep - dFull), TotalDepreciation: dep, NetAggregateDepreciation: dep, ProportionateAggDepreciation: dep, CapGainUs50: R(b.stcg), WDVLastDay: R(b.close) }));
    sum[b.key] = dep;
  });
  if (!bl.length) return;
  const pm = (sum.pm15 || 0) + (sum.pm30 || 0) + (sum.c40 || 0), bd = (sum.b5 || 0) + (sum.b10 || 0) + (sum.b40 || 0);
  put(o, "ScheduleDEP/SummaryFromDeprSch", { PlantMachinerySummary: { DeprBlockTot15Percent: sum.pm15 || 0, DeprBlockTot30Percent: sum.pm30 || 0, DeprBlockTot40Percent: sum.c40 || 0, TotPlntMach: pm },
    BuildingSummary: { DeprBlockTot5Percent: sum.b5 || 0, DeprBlockTot10Percent: sum.b10 || 0, DeprBlockTot40Percent: sum.b40 || 0, TotBuildng: bd }, FurnitureSummary: sum.f10 || 0, IntangibleAssetSummary: sum.i25 || 0, ShipsSummary: sum.s20 || 0, TotalDepreciation: pm + bd + (sum.f10 || 0) + (sum.i25 || 0) + (sum.s20 || 0) });
}
// Schedule OS from the heads (interest by kind, dividend)
function osSchedule(X, o, kind) {
  const M = X.model, S = X.comp, os = M.os || {}, sc = X.sched;
  if (!R(S.heads.os)) return;
  const fd = sc ? R(sc.pl.interestInc.trace.filter((t) => t.code === "14A").reduce((a, t) => a + t.amt, 0)) : 0, itr = sc ? R(sc.pl.interestInc.trace.filter((t) => t.code === "14D").reduce((a, t) => a + t.amt, 0)) : 0;
  const sb = R(N(os.interest) - fd - itr), div = R(os.dividend), oth = R(os.other);
  const B = "ScheduleOS/IncOthThanOwnRaceHorse";
  put(o, B + "/GrossIncChrgblTaxAtAppRate", R(S.heads.os)); put(o, B + "/DividendGross", div); put(o, B + "/DividendOthThan22e", div);
  put(o, B + "/InterestGross", R(os.interest)); put(o, B + "/IntrstFrmSavingBank", Math.max(0, sb)); put(o, B + "/IntrstFrmTermDeposit", fd); put(o, B + "/IntrstFrmIncmTaxRefund", itr); put(o, B + "/IntrstFrmOthers", Math.min(0, sb) ? 0 : 0);
  put(o, B + "/AnyOtherIncome", oth); put(o, B + "/OthersGross", oth);
  put(o, B + "/BalanceNoRaceHorse", R(S.heads.os));
  if (X.form === "ITR-3") put(o, "ScheduleOS/IncChargeable", R(S.heads.os));
  else { put(o, "ScheduleOS/TotOthSrcNoRaceHorse", R(S.heads.os)); put(o, "ScheduleOS/IncChargeableFrmOthSrc", R(S.heads.os)); }
}
// Schedules CYLA, BFLA and this year's row of CFL (individuals / HUF / firms: ITR-3, ITR-5)
function lossSchedules(X, o) {
  const ind = X.form === "ITR-3", osC = ind ? "OthSrcExclRaceHorse" : "OthSrcExclRaceHorseLottery";
  const S = X.comp, H = S.heads, so = S.setoff || { bus: {}, hp: {}, ud: {}, bf: 0 }, A = S.afterCyla || S.after, F = S.after;
  const row = (inc, set, after) => ({ IncCYLA: Object.assign({ IncOfCurYrUnderThatHead: R(Math.max(0, inc)) }, set, { IncOfCurYrAfterSetOff: R(after) }) });
  const hpL = Math.max(0, -H.hp), busL = Math.max(0, -H.pgbp);
  if (ind) put(o, "ScheduleCYLA/Salary", row(H.sal, { HPlossCurYrSetoff: R(so.hp.sal) }, A.sal));
  put(o, "ScheduleCYLA/HP", row(H.hp, { BusLossSetoff: R(so.bus.hp) }, A.hp));
  put(o, "ScheduleCYLA/BusProfExclSpecProf", row(H.pgbp, { HPlossCurYrSetoff: R(so.hp.pgbp) }, A.pgbp));
  put(o, "ScheduleCYLA/" + osC, row(H.os, { HPlossCurYrSetoff: R(so.hp.os), BusLossSetoff: R(so.bus.os) }, A.os));
  put(o, "ScheduleCYLA/STCG20Per", row(H.c111A, { HPlossCurYrSetoff: R(so.hp.c111A), BusLossSetoff: R(so.bus.c111A) }, A.c111A));
  put(o, "ScheduleCYLA/LTCG12_5Per", row(H.c112A + H.c112, { HPlossCurYrSetoff: R(N(so.hp.c112A) + N(so.hp.c112)), BusLossSetoff: R(N(so.bus.c112A) + N(so.bus.c112)) }, A.c112A + A.c112));
  const busSet = Object.values(so.bus).reduce((a, v) => a + N(v), 0), hpSet = Object.values(so.hp).reduce((a, v) => a + N(v), 0);
  put(o, "ScheduleCYLA/TotalCurYr", { TotHPlossCurYr: R(hpL), TotBusLoss: R(busL), TotOthSrcLossNoRaceHorse: 0 });
  put(o, "ScheduleCYLA/TotalLossSetOff", { TotHPlossCurYrSetoff: R(hpSet), TotBusLossSetoff: R(busSet), TotOthSrcLossNoRaceHorseSetoff: 0 });
  put(o, "ScheduleCYLA/LossRemAftSetOff", { BalHPlossCurYrAftSetoff: R(hpL - hpSet), BalBusLossAftSetoff: R(busL - busSet), BalOthSrcLossNoRaceHorseAftSetoff: 0 });
  const brow = (from, bf, ud, after) => ({ IncBFLA: Object.assign({ IncOfCurYrUndHeadFromCYLA: R(from) }, bf != null ? { BFlossPrevYrUndSameHeadSetoff: R(bf) } : {}, ud != null ? { BFUnabsorbedDeprSetoff: R(ud) } : {}, { IncOfCurYrAfterSetOffBFLosses: R(after) }) });
  if (ind) put(o, "ScheduleBFLA/Salary", { IncBFLA: { IncOfCurYrUndHeadFromCYLA: R(A.sal), IncOfCurYrAfterSetOffBFLosses: R(F.sal) } });
  put(o, "ScheduleBFLA/HP", brow(A.hp, 0, so.ud.hp, F.hp));
  put(o, "ScheduleBFLA/BusProfExclSpecProf", brow(A.pgbp, so.bf, so.ud.pgbp, F.pgbp));
  put(o, "ScheduleBFLA/OthSrcExclRaceHorse", brow(A.os, null, so.ud.os, F.os));
  put(o, "ScheduleBFLA/STCG20Per", brow(A.c111A, 0, so.ud.c111A, F.c111A));
  put(o, "ScheduleBFLA/LTCG12_5Per", brow(A.c112A + A.c112, 0, N(so.ud.c112A) + N(so.ud.c112), F.c112A + F.c112));
  const udSet = Object.values(so.ud).reduce((a, v) => a + N(v), 0);
  put(o, "ScheduleBFLA/TotalBFLossSetOff", { TotBFLossSetoff: R(so.bf), TotUnabsorbedDeprSetoff: R(udSet), TotAllUs35cl4Setoff: 0 });
  put(o, "ScheduleBFLA/IncomeOfCurrYrAftCYLABFLA", R(S.gti));
  // Schedule CFL: this year's losses carried forward (CurrentAYloss, "2025-26 current year losses"; ITR-5 / ITR-6 also
  // CurrentYearLossCF, after what is given to unit holders, none here) and the totals. LossCFCurrentAssmntYear is the
  // row of AY 2019-20 despite its name: never this year's. The business loss is what is left after set-off LESS this
  // year's unabsorbed depreciation (that part goes to Schedule UD, section 32(2): carried without limit). Earlier years'
  // rows are not mapped: coverage() blocks the JSON when there are any.
  const C = S.carry || {}, cy = (C.business || []).filter((x) => String(x.ay) === "2026").reduce((a, x) => a + N(x.amt), 0);
  if (cy || N(C.hp)) {
    const lsd = (hp, bus) => { const d = { TotalHPPTILossCF: R(hp) }; d[X.form === "ITR-6" ? "BroughtFrwdBusLossSetOffDrYr" : "BusLossOthThanSpecLossCF"] = R(bus); d.LossFrmSpecBusCF = 0; d.LossFrmSpecifiedBusCF = 0; if (X.form === "ITR-6") d.LossFrmLifeInsBusUs115B = 0; d.TotalSTCGPTILossCF = 0; d.TotalLTCGPTILossCF = 0; d.OthSrcLossRaceHorseCF = 0; return { LossSummaryDetail: d }; };
    put(o, "ScheduleCFL/CurrentAYloss", lsd(C.hp, cy));
    if (X.form !== "ITR-3") put(o, "ScheduleCFL/CurrentYearLossCF", lsd(C.hp, cy));
    put(o, "ScheduleCFL/TotalOfBFLossesEarlierYrs", lsd(0, 0));
    put(o, "ScheduleCFL/AdjTotBFLossInBFLA", lsd(0, R(so.bf)));
    put(o, "ScheduleCFL/TotalLossCFSummary", lsd(C.hp, cy));
  }
  // Schedule UD: this year's row (CurBalCFNY: the year's depreciation not absorbed), and the totals (column 5 is the
  // sum of the rows' balances, this year's included: validation rules 626, 628, 629). Earlier years' rows are not
  // mapped: coverage() blocks the JSON when there is unabsorbed depreciation brought forward.
  if (N(C.cyUd) || N(C.bfUd)) {
    const adj = { "ITR-3": "TotAdjustAccTax115BACAmt", "ITR-5": "TotAdjustAccTax115BADAmt", "ITR-6": "TotAmtAdjOptTaxUs115BAA" }[X.form];
    put(o, X.form === "ITR-3" ? "ITR3ScheduleUD" : "ITRScheduleUD", { CurrAssYr: "2026-27", CurBalCFNY: R(C.cyUd), CurAllowBalCFNY: 0, TotBFUDepritAmt: R(C.bfUd), [adj]: 0, TotCurYrdepritSetoffInc: R(C.udUsed),
      TotDepritBalCFNY: R(N(C.bfUdLeft) + N(C.cyUd)), TotBFUAllowAmt: 0, TotCurYrAllowSetoffInc: 0, TotalBalCFNY: 0 });
  }
}
// what the JSON carries forward (losses and unabsorbed depreciation of this year), read back from the map
export function carriedInMap(o, form) {
  const g = (path) => path.split("/").reduce((a, k) => (a == null ? a : a[k]), o);
  const d = g("ScheduleCFL/CurrentAYloss/LossSummaryDetail") || {}, ud = g(form === "ITR-3" ? "ITR3ScheduleUD" : "ITRScheduleUD") || {};
  return { bus: R(N(form === "ITR-6" ? d.BroughtFrwdBusLossSetOffDrYr : d.BusLossOthThanSpecLossCF)), hp: R(N(d.TotalHPPTILossCF)), ud: R(N(ud.CurBalCFNY)) };
}
// Part A-OI: the disallowances by section, from the computation's own lines (audit cases)
function partAOI(X, o, base) {
  const S = X.comp, L = (k) => R(lineOf(S, k)), dues = X.dues43B || [];
  const k43 = (...kinds) => R(dues.filter((x) => x.kind43B && !x.unknown && !x.unknownShare && kinds.includes(x.kind)).reduce((a, x) => a + N(x.dis), 0));
  const t36 = L("add:36va"), t37 = L("add:penalty") + L("add:csr"), t40 = L("add:40aia") + L("add:40ai") + L("add:40b_int") + L("add:40b_rem"), t40A = L("add:40a3");
  put(o, base + "/AmtDisallUs36", { EmpContributionCredits: t36, TotAmtDisallUs36: t36 });
  put(o, base + "/AmtDisallUs37", { OthPenalFineExp: L("add:penalty"), OthAmtNotAllowUs37: L("add:csr"), TotAmtDisallUs37: t37 });
  put(o, base + "/AmtDisallUs40", { NonCompChapXVIIBAmt: L("add:40ai"), [X.form === "ITR-6" ? "NonComp40aiaChapXVIIBAmt" : "NonComp40aiiChapXVIIBAmt"]: L("add:40aia"), IntSalBonPartner: L("add:40b_int") + L("add:40b_rem"), TotAmtDisallUs40: t40 });
  put(o, base + "/AmtDisallUs40A", { AmtGT20kCash: t40A, TotAmtDisallUs40A: t40A });
  const a43 = { TaxDutyCesAmt: k43("tax"), ContToEmpPFSFGF: k43("pf", "esi"), EmpBonusComm: k43("bonus"), IntPayaleToFI: k43("interest"), LeaveEncashPayable: k43("leave"), MSEPayable: L("add:43bh") };
  a43.TotAmtUs43b = Object.values(a43).reduce((a, v) => a + v, 0);
  put(o, base + "/AmtDisall43B/AmtUs43B", a43);
}
function auditInfo(X, o, base) {
  const A = (X.profile || {}).auditor || {};
  if (A.reportDate) put(o, base + "/AuditReportFurnishDate", A.reportDate);
  if (A.ack) put(o, base + "/AckNum44AB", +A.ack);
  if (A.firm) put(o, base + "/AudFrmName", A.firm);
  if (A.firmPan) put(o, base + "/AudFrmPAN", A.firmPan);
}
function gstSchedule(X, o, path) {
  const g = X.gstTurnover || [];
  if (g.length) { put(o, path + "/TurnoverGrsRcptForGSTIN", g.map((x) => ({ GSTINNo: x.gstin, AmtTurnGrossRcptGSTIN: R(x.amt) }))); }
}

// ---------------- coverage: a schedule with figures FinCom does not fill blocks the JSON (never zero-filled) ----------------
export function coverage(X, map) {
  const M = X.model, S = X.comp, f = X.form, P = X.profile || {}, d = M.deductions || {}, out = [];
  const add = (key, title, text) => out.push({ key, title, text });
  const claimed = (k) => (k === "80G" ? (Array.isArray(d["80G"]) ? d["80G"] : []).some((x) => N(x.amt)) : k === "80D" ? N(d["80D_self"]) + N(d["80D_parents"]) > 0 : N(d[k]) > 0);
  const H = S.heads || {};
  if (H.hp) add("hp", "Schedule HP (house property)", "House property income of " + R(H.hp) + ": Schedule HP (the property, its tenant, municipal tax, interest) is not filled by FinCom yet.");
  if (H.sal && f === "ITR-3") add("salary", "Schedule S (salary)", "Salary of " + R(H.sal) + ": Schedule S (employer, TAN, allowances) is not filled by FinCom yet.");
  if (f === "ITR-4" && H.c112A && !M.cg112A) add("ltcg112a", "LTCG under 112A (sale and cost)", "Long-term gains under 112A: give the total sale consideration and cost on Data.");
  if (f !== "ITR-4" && (H.c111A || H.c112A || H.c112 || H.cOth)) add("cg", "Schedule CG and SI (capital gains)", "Capital gains of " + R(H.cg) + ": Schedule CG asks asset by asset (dates, cost, sale): not filled by FinCom yet.");
  ["80C", "80D", "80DD", "80DDB", "80U", "80E", "80EE", "80EEA", "80EEB", "80G", "80GGA", "80GGC"].forEach((k) => { if (claimed(k)) add("via_" + k, "Schedule " + k + " (details)", "Section " + k + " is claimed: the schema's own Schedule " + k + " (each policy, donee or loan) is not filled by FinCom yet."); });
  if ((f === "ITR-5" || f === "ITR-6") && R(S.ded)) add("via_entity", "Schedule VIA and its details (firm / company)", "Deductions under Chapter VI-A of " + R(S.ded) + ": the firm's / company's Schedule VIA and its detail schedules are not filled by FinCom yet.");
  if (S.viaCapped) add("via_cap", "Chapter VI-A above the gross total income", "The deductions are limited to the gross total income: say which sections take the cut.");
  if (N((M.losses || {}).unabsorbedDep)) add("ud", "Schedule UD, earlier years", "Unabsorbed depreciation brought forward: Schedule UD's rows year by year (and BFLA by year) are not filled by FinCom yet.");
  // anything carried forward that the map does not carry: this year's business loss, unabsorbed depreciation and house
  // property loss against what Schedules CFL and UD hold (the review of 5a6df2218: a loss carried and not in the JSON)
  const C = S.carry || {}, cyBus = R((C.business || []).filter((x) => String(x.ay) === "2026").reduce((a, x) => a + N(x.amt), 0));
  const bfLeft = R((C.business || []).filter((x) => String(x.ay) !== "2026").reduce((a, x) => a + N(x.amt), 0));
  if (f === "ITR-4") { if (cyBus || N(C.cyUd) || N(C.hp) || bfLeft || N(C.bfUdLeft)) add("cf_itr4", "Losses carried forward (ITR-4)", "ITR-4 carries no loss or depreciation forward: a loss of the year needs ITR-3 / ITR-5."); }
  else if (map) {
    const got = carriedInMap(map, f), miss = [];
    if (got.bus !== cyBus) miss.push("business loss " + cyBus + " (the JSON has " + got.bus + ")");
    if (got.ud !== R(C.cyUd)) miss.push("unabsorbed depreciation " + R(C.cyUd) + " (the JSON has " + got.ud + ")");
    if (got.hp !== R(C.hp)) miss.push("house property loss " + R(C.hp) + " (the JSON has " + got.hp + ")");
    if (miss.length) add("cf_unmapped", "Losses carried forward not in the JSON", "This year's " + miss.join(", ") + ": Schedules CFL and UD do not carry it.");
    if (bfLeft && !((M.losses || {}).business || []).length) add("cfl_prior", "Schedule CFL, earlier years", "Earlier years' losses are carried forward: their rows in Schedule CFL are not filled by FinCom yet.");
  }
  if (((M.losses || {}).business || []).length) add("cfl_prior", "Schedule CFL, earlier years", "Business losses of earlier years: their rows in Schedule CFL (year, date of filing) are not filled by FinCom yet.");
  if (f !== "ITR-4" && M.business && N(M.business.itDep) && !((M.business.itBlocks || []).length)) add("dep", "Schedules DPM / DOA (depreciation by block)", "Depreciation under section 32 of " + R(M.business.itDep) + " has no block detail: fill Statements › Fixed assets.");
  if (f !== "ITR-4" && M.business && (M.business.itBlocks || []).length && R((M.business.itBlocks || []).filter((b) => BLOCK_PATH[b.key]).reduce((a, b) => a + N(b.dep), 0)) !== R(M.business.itDep)) add("dep_sum", "Schedules DPM / DOA add up", "The blocks' depreciation does not add up to the depreciation claimed.");
  if (M.audit && f !== "ITR-4" && !(P.auditor && P.auditor.firm && P.auditor.reportDate && P.auditor.ack)) add("audit_info", "Audit report details", "A tax audit applies: give the auditor's firm, PAN, the date of the report and its acknowledgement number on Data.");
  if (f === "ITR-3" && S.ti > 10000000) add("al", "Schedule AL (assets and liabilities)", "Total income above Rs 1 crore: Schedule AL is not filled by FinCom yet.");
  if (P.foreignAssets === "YES") add("fa", "Schedule FA (foreign assets)", "Foreign assets: Schedule FA is not filled by FinCom yet.");
  if (X.gstRegistered && !(X.gstTurnover || []).length && f !== "ITR-4") add("gst", "Schedule GST (turnover by GSTIN)", "The client is registered under GST: the turnover by GSTIN (from the filed returns) is not in FinCom.");
  if (f === "ITR-5") (M.partnersDetail || []).forEach((p, i) => { if (!(p.name && p.pan && p.share != null && p.city && p.state && p.pin)) add("partner_" + i, "Partner details", "Partner " + (p.name || i + 1) + ": name, PAN, share and address are needed for the partners' list."); });
  if (f === "ITR-5" && !(M.partnersDetail || []).length) add("partners", "Partners", "List the partners (name, PAN, share, address) on Data.");
  if (f === "ITR-6") {
    if (P.indAs === true) add("indas", "Ind AS balance sheet and P&L", "The company follows Ind AS: Part A-BS / P&L Ind AS are not filled by FinCom yet.");
    if (P.indAs == null) add("indas_q", "Ind AS or not", "Say whether the company follows Ind AS (Data).");
    if (P.listed !== true) add("sh", "Schedule SH (shareholding of an unlisted company)", "An unlisted company: Schedule SH (each shareholder) is not filled by FinCom yet.");
    if (P.authorised == null) add("auth", "Authorised share capital", "Give the authorised share capital (Data).");
    if (N(M.matCredit) && !(M.matCredits || []).length) add("matc", "Schedule MATC, earlier years", "MAT credit brought forward: give it year by year (Data).");
  }
  if (f !== "ITR-4" && X.sched) { const t = X.sched.totals; if (R(t.la) && P.loansForBusiness !== true) add("loans", "Loans and advances for the business", "Say whether every loan and advance given is for the business (Data)."); }
  return out;
}

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
  const d = M.deductions || {}, via = (k) => (k === "80D" ? R(N(d["80D_self"]) + N(d["80D_parents"])) : k === "80G" ? R((Array.isArray(d["80G"]) ? d["80G"] : []).reduce((t, x) => t + N(x.amt), 0)) : R(d[k]));
  const V = { Section80C: via("80C"), Section80CCC: via("80CCC"), Section80CCDEmployeeOrSE: via("80CCD1"), Section80CCD1B: via("80CCD1B"), Section80CCDEmployer: via("80CCD2"), Section80D: via("80D"), Section80DD: via("80DD"), Section80DDB: via("80DDB"),
    Section80E: via("80E"), Section80G: via("80G"), Section80GG: via("80GG"), Section80GGC: via("80GGC"), Section80U: via("80U"), Section80TTA: via("80TTA"), Section80TTB: via("80TTB"), AnyOthSec80CCH: via("80CCH") };
  const sumV = Object.values(V).reduce((s, v) => s + v, 0);
  put(o, "IncomeDeductions/UsrDeductUndChapVIA", Object.assign({}, V, { TotalChapVIADeductions: sumV }));
  put(o, "IncomeDeductions/DeductUndChapVIA", Object.assign(viaAllowed(S, VIA4), { TotalChapVIADeductions: R(S.ded) }));
  if (M.salary) put(o, "IncomeDeductions/DeductionUs16ia", R(M.salary.std));
  if (h.c112A && M.cg112A) put(o, "LTCG112A", { TotSaleCnsdrn: R(M.cg112A.sale), TotCstAcqisn: R(M.cg112A.cost), LongCap112A: R(h.c112A) });
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
  const f5 = kind === "itr5" || kind === "itr6", firm = kind === "itr5", D = base + (f5 ? "/DebitsToPL/DebitPlAcnt" : "/DebitsToPL"), TP = base + (f5 ? "/DebitsToPL/TaxProvAppr" : "/TaxProvAppr");
  put(o, D + "/PowerFuel", v("power")); put(o, D + "/RentExpdr", v("rent")); put(o, D + "/RepairMach", v("repairs"));
  put(o, D + "/EmployeeComp", { SalsWages: v("salaries"), ContToPF: v("pf"), ContToGratFund: v("gratuity"), OthEmpBenftExpdr: v("staffWelfare"), TotEmployeeComp: v("salaries") + v("pf") + v("gratuity") + v("staffWelfare") });
  put(o, D + "/Insurances/OthInsur", v("insurance")); put(o, D + "/Insurances/TotInsurances", v("insurance"));
  put(o, D + "/Advertisement", v("advert")); put(o, D + "/TravelExp", v("travel")); put(o, D + "/TelephoneExp", v("telephone")); put(o, D + "/Donation", v("csr"));
  put(o, D + "/CommissionExpdrDtls/Others", v("commission")); put(o, D + "/CommissionExpdrDtls/Total", v("commission"));
  put(o, D + "/ProfessionalConstDtls/Others", v("professional")); put(o, D + "/ProfessionalConstDtls/Total", v("professional"));
  put(o, D + "/RatesTaxesPays/ExciseCustomsVAT/OthDutyTaxCess", v("rates")); put(o, D + "/RatesTaxesPays/ExciseCustomsVAT/TotExciseCustomsVAT", v("rates"));
  put(o, D + "/AuditFee", v("audit"));
  // a firm's partners: their salary in its own line (ITR-5 SalRemuneration), their interest in InterestExpdrtDtls/ResPartners
  const other = v("otherExp") + v("interestStat") + v("exceptional") + (firm ? 0 : v("partnerRem") + v("partnerInt"));
  put(o, D + "/OtherExpenses", other);
  if (firm) put(o, D + "/SalRemuneration", v("partnerRem"));
  put(o, D + "/BadDebtDtls/BadDebt", v("badDebts"));
  const fin = v("interestExp") + (firm ? v("partnerInt") : 0);
  put(o, D + "/PBIDTA", R(t.pbt + fin + v("depreciation")));
  if (firm) put(o, D + "/InterestExpdrtDtls", { Others: v("interestExp"), ResPartners: v("partnerInt"), InterestExpdr: fin });
  else { put(o, D + "/InterestExpdrtDtls/Others", fin); put(o, D + "/InterestExpdrtDtls/InterestExpdr", fin); }
  put(o, D + "/DepreciationAmort", v("depreciation"));
  put(o, D + "/PBT", R(t.pbt));
  put(o, TP + "/ProvForCurrTax", v("taxCurrent")); put(o, TP + "/ProvDefTax", v("taxDeferred"));
  put(o, TP + "/ProfitAfterTax", R(t.pat)); put(o, TP + "/AmtAvlAppr", R(t.pat));
  if (firm) put(o, TP + "/PartnerAccBalTrf", R(t.pat));
  if (kind === "itr6") { put(o, TP + "/BalBFPrevYr", R(sc.bs.plBalance.cy)); put(o, TP + "/AmtAvlAppr", R(t.pat + sc.bs.plBalance.cy)); put(o, TP + "/Appropriations/TotAppropriations", 0); }
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
  // the total of this year's losses in Schedule CFL (validation rule 934)
  const Cc = S.carry || {}; put(o, base + "/LossesOfCurrentYearCarriedFwd", R((Cc.business || []).filter((x) => String(x.ay) === "2026").reduce((a, x) => a + N(x.amt), 0) + N(Cc.hp)));
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
  depSchedules(X, o); osSchedule(X, o); lossSchedules(X, o);
  const dd = M.deductions || {}, usr = {}; Object.keys(VIA3).forEach((k) => { usr[VIA3[k]] = k === "80D" ? R(N(dd["80D_self"]) + N(dd["80D_parents"])) : k === "80G" ? R((Array.isArray(dd["80G"]) ? dd["80G"] : []).reduce((t, x) => t + N(x.amt), 0)) : R(dd[k]); });
  if (R(X.comp.ded) || Object.values(usr).some((v) => v)) { put(o, "ScheduleVIA/UsrDeductUndChapVIA", Object.assign(usr, { TotalChapVIADeductions: Object.values(usr).reduce((a, v) => a + v, 0) })); put(o, "ScheduleVIA/DeductUndChapVIA", Object.assign(viaAllowed(X.comp, VIA3), { TotalChapVIADeductions: R(X.comp.ded) })); }
  if (M.audit) { partAOI(X, o, "PARTA_OI"); auditInfo(X, o, "PartA_GEN2/AuditInfo"); }
  gstSchedule(X, o, "ScheduleGST");
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
  depSchedules(X, o); osSchedule(X, o); lossSchedules(X, o);
  const pd = (M.partnersDetail || []).filter((p) => p.name && p.pan);
  if (pd.length) put(o, "PartA_GEN2/PartnerOrMemberInfo", pd.map((p) => Object.assign({ PartnerOrMemberName: p.name, PAN: p.pan, SharePercentage: N(p.share), RemunerationPaid: R(p.remuneration), RateOfInterest: N(p.rate),
    AddressDetailWithZipCode: { AddrDetail: p.addr || p.city, CityOrTownOrDistrict: p.city, StateCode: String(p.state || "").padStart(2, "0"), CountryCode: "91", PinCode: +p.pin } }, p.status ? { Status: p.status } : {})));
  if (M.audit) { partAOI(X, o, "PARTA_OI"); auditInfo(X, o, "PartA_GEN2/AuditInfo"); }
  gstSchedule(X, o, "ScheduleGST");
  taxPaidLists(X, o, "", "itr5");
  verification(P, o, "Verification", "co");
  return o;
}
// ITR-6 Part A-BS (Schedule III), line by line from the trial balance's codes
function bs6(X, o, P) {
  const sc = X.sched, b = sc.bs, t = sc.totals, B = "PARTA_BSFor6FrmAY13";
  const all = Object.values(b).flatMap((l) => l.trace);
  const cs = (codes, sign) => R(all.filter((x) => codes.includes(x.code)).reduce((a, x) => a + N(x.amt), 0) * (sign || 1));
  const tr = (key, re) => R(b[key].trace.filter((x) => re.test(x.code)).reduce((a, x) => a + N(x.amt), 0));
  const sh = cs(["3A", "3B"]), sp = cs(["4B"]), oth = cs(["4C", "4D"]), pl = R(t.equity - sh - sp - oth);
  put(o, B + "/EquityAndLiablities/ShareHolderFund", { ShareCapital: { Authorised: P.authorised != null ? R(P.authorised) : undefined, IssuedSubsPaidUp: sh, TotShareCapital: sh }, ResrNSurp: { SecurPremResr: sp, OtherResrvTotal: oth, PLAccount: pl, TotResrNSurp: R(sp + oth + pl) }, TotShareHolderFund: R(t.equity) });
  const tlB = cs(["30A"]), tlO = cs(["30B"]), dtl = cs(["31A"]), oltl = cs(["32A"]), ltpE = cs(["5A", "5C"]), ltpO = cs(["5D"]);
  const ncl = R(tlB + tlO + dtl + oltl + ltpE + ltpO);
  put(o, B + "/EquityAndLiablities/NonCurrLiabilities", { LongTermBorrowings: { TermLoans: { RupeeLoans: { FromBanks: tlB, FromOthers: tlO, Total: R(tlB + tlO) }, TotalTermLoans: R(tlB + tlO) }, TotalLTBorrowings: R(tlB + tlO) },
    NetDefferedTaxLiability: dtl, OthLongTermLiablities: { Others: oltl, TotalOthLtLiabilities: oltl }, LongTermProvisions: { ProvEmpBenefits: ltpE, Others: ltpO, Total: R(ltpE + ltpO) }, TotalNonCurrLiabilites: ncl });
  const stB = cs(["33A"]), stO = cs(["33B", "33C"]), tp = cs(["6A", "6B"]), ai = cs(["7G"]), adv = cs(["7H"]), op = cs(["7A", "7B", "7C", "7E", "7F"]), spE = cs(["5B", "5E"]), itp = cs(["7D"]), spO = cs(["5F", "5G"]);
  const cl = R(stB + stO + tp + ai + adv + op + spE + itp + spO);
  put(o, B + "/EquityAndLiablities/CurrentLiabilities", { ShortTrmBorrowings: { LoansRepaybleOnDemand: { FromBanks: stB, Others: stO, TotLoansRepaybleOnDemand: R(stB + stO) }, TotShortTrmBorrowings: R(stB + stO) },
    TradePayables: { Others: tp, TotalTradePayables: tp }, OthCurrLiabilities: { AccrInterest: ai, IncRecvdAdvance: adv, OthPayables: op, TotOthCurrLiabilities: R(ai + adv + op) },
    ShortTermProv: { EmpBenefitProv: spE, ITProvision: itp, OthProvision: spO, TotShortTermProvisions: R(spE + itp + spO) }, TotCurrLiabilitiesProvision: cl });
  put(o, B + "/EquityAndLiablities/TotEquityAndLiabilities", R(t.equity + ncl + cl));
  const gT = tr("grossBlock", /^8/), dT = tr("accDep", /^8/), gI = tr("grossBlock", /^34/), dI = tr("accDep", /^34/), cw = cs(["35A"]), iud = cs(["35B"]);
  const fa = R(gT - dT + gI - dI + cw + iud), nci = cs(["36A"]), dta = cs(["9A"]), ca38 = cs(["38B"]), sd = cs(["38A"]), ol = cs(["38D"]), onca = cs(["38C"]);
  const ltla = R(ca38 + sd + ol), nca = R(fa + nci + dta + ltla + onca);
  put(o, B + "/Assets/NonCurrAssets", { FixedAsset: { Tangible: { GrossBlock: gT, Depreciation: dT, NetBlock: R(gT - dT) }, InTangible: { GrossBlock: gI, Amortization: dI, NetBlock: R(gI - dI) }, CapWrkProg: cw, IntangibleAssetUnDev: iud, TotFixedAsset: fa },
    NonCurrInvstmnts: { OtherInvstmnts: nci, TotNonCurrInvstmnts: nci }, NetDeferredTaxAssets: dta, LongTrmLoanAdv: { CapitalAdv: ca38, SecurityDeposits: sd, OthLoanAdv: ol, TotLTLoanAdv: ltla, LTLoanAdvDtls: P.loansForBusiness === true ? { BusOrProf: ltla } : undefined },
    OthNonCurrAssets: { Others: onca, Total: onca }, TotNonCurrAssets: nca });
  const ci = cs(["37A"]), inv = cs(["39A"]), trd = cs(["10A", "10B"]), bank = cs(["11A", "11B", "11C"]), cash = cs(["11D"]), stla = cs(["12A", "12F", "12G", "12H"]), stlo = cs(["12B", "12C", "12D"]), oca = cs(["12E", "12K"]);
  const cas = R(ci + inv + trd + bank + cash + stla + stlo + oca);
  put(o, B + "/Assets/CurrentAssets", { CurrInvstmnts: { OtherInvstmnts: ci, TotCurrInvstmnts: ci }, Inventories: { FinOrTradGood: inv, TotInventries: inv }, TradeReceivables: { Others: trd, TotalTradeReceivables: trd },
    CashNCashEquivalents: { BalWithBanks: bank, CashInHand: cash, TotCashNCashEquivalents: R(bank + cash) }, TotShortTermLoanAdv: { LoanAdv: stla, Others: stlo, TotShrtTermLoans: R(stla + stlo), STLoanAdvDtls: P.loansForBusiness === true ? { BusOrProf: R(stla + stlo) } : undefined }, OtherCurrAssets: oca, TotCurrAssets: cas });
  put(o, B + "/TotalAssets", R(nca + cas));
}
// Schedules MAT and MATC (a company not under 115BAA)
function mat6(X, o) {
  const M = X.model, S = X.comp, t = S.tax || {}, sc = X.sched;
  if (M.regime !== "normal" || M.bookProfit == null) return;
  const pat = sc ? R(sc.totals.pat) : 0, taxP = sc ? R(sc.pl.taxCurrent.cy + sc.pl.taxDeferred.cy) : 0, bp = R(M.bookProfit), other = R(bp - pat - taxP);
  put(o, "ScheduleMAT", { ProfAfterTaxPLAcnt: pat, Additions: { ITPaidInclDefTax: taxP, Others: Math.max(0, other), TotAdditions: R(taxP + Math.max(0, other)) }, Deducts: { Others: Math.max(0, -other), TotDeducts: Math.max(0, -other) },
    BookProfUs115JB: bp, DeemedTotalIncUs115JB: bp, DeemedTotalIncUs115JBOther: bp, TaxPayableUs115JB: R(Math.max(0, bp) * 0.15) });
  const mat = t.mat || {}, normal = mat.applies ? 0 : R(S.liability + N(t.matCreditUsed)), matTot = R(mat.total);
  const created = mat.applies ? R(mat.credit) : 0, used = R(t.matCreditUsed);
  const prior = (M.matCredits || []).map((c) => ({ AssYr: /-/.test(String(c.ay)) ? String(c.ay) : String(c.ay) + "-" + String(+c.ay + 1).slice(2), MATCredGross: R(c.gross != null ? c.gross : c.amt), MATCredSetOff: R(c.setOff || 0), MATCredBF: R(c.amt), MATCredUtilCurrYr: 0, BalMATCredCF: R(c.amt) }));
  let left = used; prior.forEach((r) => { const u = Math.min(left, r.MATCredBF); r.MATCredUtilCurrYr = u; r.BalMATCredCF = R(r.MATCredBF - u); left -= u; });
  const sumOf = (k) => R(prior.reduce((a, r) => a + N(r[k]), 0));
  put(o, "ScheduleMATC", { TaxUs115JBCurrAssYr: matTot, TaxOthProvCurrAssYr: mat.applies ? R(mat.total - mat.credit) : normal, AmtOfTaxWithCred: created, CurAssYr: "2026-27", MATCredGrossCurAY: created, BalMATCredCFCurAY: created,
    UtilMATCredAvl: prior.length ? prior : undefined, TotMatCredGross: R(sumOf("MATCredGross") + created), TotMatCredSetOff: sumOf("MATCredSetOff"), TotMatCredBF: sumOf("MATCredBF"), TotMatCredUtilCurrYr: used, TotBalMATCredCF: R(sumOf("BalMATCredCF") + created), AmtTaxCredUs115JAA: used, AmtMATLiabAllAssYrAvailSubseqYr: R(sumOf("BalMATCredCF") + created) });
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
  if (sc) bs6(X, o, P);
  if (sc) { trading(X, o, "TradingAccount"); plMain(X, o, "PARTA_PL", "itr6"); }
  mat6(X, o);
  if (sc) put(o, "CorpScheduleBP/BusinessIncOthThanSpec/ProfBfrTaxPL", R(sc.totals.pbt));
  bp(X, o, "CorpScheduleBP", "OthItemDisallowUs28To44DA");
  partBTI(X, o, "PartB-TI", "co");
  partBTTI(X, o, "PartB_TTI", "co");
  depSchedules(X, o); osSchedule(X, o); lossSchedules(X, o);
  if (M.audit) { partAOI(X, o, "PARTA_OI"); auditInfo(X, o, "PartA_GEN2For6/AuditInfo"); }
  gstSchedule(X, o, "ScheduleGST");
  taxPaidLists(X, o, "", "itr6");
  verification(P, o, "Verification", "co");
  return o;
}

export function mapReturn(X) {
  const f = { "ITR-3": itr3, "ITR-4": itr4, "ITR-5": itr5, "ITR-6": itr6 }[X.form];
  if (!f) throw new Error("no map for " + X.form);
  return f(X);
}
