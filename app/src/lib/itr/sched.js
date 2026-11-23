// The schedules of the official ITR JSON built from the heads with schedules of their own (heads.js) and the owner's
// lists: S and TDS1 (salary), HP (house property), CG / 112A / SI (capital gains, with the quarters of Table F), AL
// (assets and liabilities), FA (foreign assets), SH (shareholding of an unlisted company) and the Ind AS parts of ITR-6.
// forms.js calls these form by form. The forms differ in small ways (ITR-3's ScheduleCGFor23 against ITR-5 / ITR-6's
// ScheduleCG, a field one form has and another not): fit() keeps only what the form's own schema has at that place,
// and the tests check every form's figures (tests/run_itr_schedules.mjs). Nothing here makes up a non-amount field:
// an address, a name or a choice not given is left out, and fill.js asks for it.
import { put } from "./fill.js";
import { CII, fyOf, cgAsChosen } from "./heads.js";

const N = (v) => +v || 0;
const R = (v) => { const x = N(v), r = Math.round(Math.abs(x) + 1e-9) * Math.sign(x); return r === 0 ? 0 : r; };
const P0 = (v) => Math.max(0, R(v));
const iso = (d) => (d && /^\d{8}$/.test(String(d)) ? String(d).slice(0, 4) + "-" + String(d).slice(4, 6) + "-" + String(d).slice(6, 8) : d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
const TAN_OK = /^[A-Z]{4}[0-9]{5}[A-Z]$/, PAN_OK = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const sumOf = (xs, f) => (xs || []).reduce((s, x) => s + N(f(x)), 0);

// the schema node at a path of the form's JSON ("ScheduleCG/LongTermCapGain/..."; "[]" for an array's items)
export function nodeAt(X, path) {
  const S = X.schema; if (!S) return null;
  const D = S.definitions || {}, deref = (s) => { let k = 0; while (s && s.$ref && k++ < 40) s = D[s.$ref.split("/").pop()]; return s; };
  const flat = (s) => { s = deref(s); if (s && s.allOf) { const o = Object.assign({}, s); o.properties = Object.assign({}, s.properties); s.allOf.forEach((x) => { const f = flat(x); Object.assign(o.properties, f.properties || {}); }); return o; } return s; };
  let n = flat(flat(D.ITR || S).properties[X.root]);
  for (const k of path.split("/").filter(Boolean)) { if (!n) return null; n = k === "[]" ? flat(n.items) : flat((n.properties || {})[k]); }
  return n || null;
}
// keep only the keys the schema has at that place (recursively); undefined values dropped
export function fit(X, path, v) {
  const n = nodeAt(X, path);
  const walk = (s, x, p) => {
    if (x === undefined || x === null) return undefined;
    if (Array.isArray(x)) { const it = s && s.items ? nodeAt(X, p + "/[]") : null; return x.map((y) => walk(it, y, p + "/[]")); }
    if (typeof x !== "object") return x;
    if (!s || !s.properties || !Object.keys(s.properties).length) return x;
    const o = {};
    Object.keys(x).forEach((k) => { if (s.properties[k]) { const y = walk(nodeAt(X, p + "/" + k), x[k], p + "/" + k); if (y !== undefined) o[k] = y; } });
    return o;
  };
  return walk(n, v, path);
}
const has = (X, path) => !!nodeAt(X, path);
function addr(a, maxL) {
  if (!a) return undefined;
  const line = [a.flat, a.building, a.line, a.street, a.locality].filter(Boolean).join(", ");
  const o = {};
  if (line) o.AddrDetail = line.slice(0, maxL || 200);
  if (a.city) o.CityOrTownOrDistrict = String(a.city).slice(0, 50);
  if (a.state) { o.StateCode = String(a.state).padStart(2, "0"); o.CountryCode = "91"; }
  if (a.pin) o.PinCode = +a.pin;
  return Object.keys(o).length ? o : undefined;
}
function addrAL(a) {
  if (!a) return undefined;
  const o = {};
  if (a.flat || a.line) o.ResidenceNo = String(a.flat || a.line).slice(0, 50);
  if (a.building) o.ResidenceName = String(a.building).slice(0, 50);
  if (a.street) o.RoadOrStreet = String(a.street).slice(0, 50);
  if (a.locality || a.city) o.LocalityOrArea = String(a.locality || a.city).slice(0, 50);
  if (a.city) o.CityOrTownOrDistrict = String(a.city).slice(0, 50);
  if (a.state) { o.StateCode = String(a.state).padStart(2, "0"); o.CountryCode = "91"; }
  if (a.pin) o.PinCode = +a.pin;
  return o;
}

// ---------------- Schedule S and TDS on salary ----------------
// the income chargeable under the head for each employer (Schedule TDS1 IncChrgSal): the standard deduction taken
// against the employers in turn
function perEmployer(sh) {
  let std = N(sh.std);
  return sh.rows.map((r) => { const s = Math.min(std, Math.max(0, r.net - r.ent - r.ptax)); std -= s; return Object.assign({}, r, { chargeable: P0(r.net - r.ent - r.ptax - s) }); });
}
export function salarySchedule(X, o, kind) {
  const M = X.model, sh = M.salaryHead;
  if (!sh || !sh.rows.length) return;
  const rows = perEmployer(sh);
  const exDtls = [];
  rows.forEach((r) => r.exemptRows.filter((e) => R(e.amt)).forEach((e) => exDtls.push({ SalNatureDesc: e.sec, SalOthAmount: R(e.amt) })));
  if (kind === "itr4") {
    const B = "IncomeDeductions";
    put(o, B + "/GrossSalary", R(sh.gross)); put(o, B + "/Salary", R(sumOf(rows, (r) => r.s171))); put(o, B + "/PerquisitesValue", R(sumOf(rows, (r) => r.s172))); put(o, B + "/ProfitsInSalary", R(sumOf(rows, (r) => r.s173)));
    put(o, B + "/AllwncExemptUs10", { AllwncExemptUs10Dtls: exDtls.length ? exDtls : undefined, TotalAllwncExemptUs10: R(sh.exempt) });
    put(o, B + "/NetSalary", R(sh.net)); put(o, B + "/DeductionUs16", R(sh.ded16)); put(o, B + "/DeductionUs16ia", R(sh.std));
    put(o, B + "/EntertainmntalwncUs16ii", R(sh.ent)); put(o, B + "/ProfessionalTaxUs16iii", R(sh.ptax)); put(o, B + "/IncomeFromSal", R(sh.income));
    if (rows[0].nature) put(o, "PersonalInfo/EmployerCategory", rows[0].nature);
  } else {
    const list = rows.map((r) => fit(X, "ScheduleS/Salaries/[]", { NameOfEmployer: r.employer ? String(r.employer).slice(0, 125) : undefined, NatureOfEmployment: r.nature || undefined, TANofEmployer: TAN_OK.test(r.tan || "") ? r.tan : undefined,
      AddressDetail: addr(r.addr, 200), Salarys: { GrossSalary: R(r.gross), Salary: R(r.s171), ValueOfPerquisites: R(r.s172), ProfitsinLieuOfSalary: R(r.s173) } }));
    put(o, "ScheduleS/Salaries", list);
    put(o, "ScheduleS/TotalGrossSalary", R(sh.gross));
    put(o, "ScheduleS/AllwncExtentExemptUs10", R(sh.exempt));
    if (exDtls.length) put(o, "ScheduleS/AllwncExemptUs10/AllwncExemptUs10Dtls", exDtls);
    const hr = rows.find((r) => r.hra && r.exemptRows.some((e) => e.sec === "10(13A)" && R(e.amt)));
    if (hr) put(o, "ScheduleS/Section10_13A", { Placeofwork: hr.hra.metro ? "1" : "2", ActlHRARecv: R(hr.hra.received), ActlRentPaid: R(hr.hra.rent), DtlsSalUsSec171: R(hr.hra.basicDa), ActlRentPaid10Per: R(hr.hra.rent10), Sal40Or50Per: R(hr.hra.pc), EligbleExmpAllwncUs13A: R(hr.hra.eligible) });
    put(o, "ScheduleS/NetSalary", R(sh.net)); put(o, "ScheduleS/DeductionUS16", R(sh.ded16)); put(o, "ScheduleS/DeductionUnderSection16ia", R(sh.std));
    put(o, "ScheduleS/EntertainmntalwncUs16ii", R(sh.ent)); put(o, "ScheduleS/ProfessionalTaxUs16iii", R(sh.ptax)); put(o, "ScheduleS/TotIncUnderHeadSalaries", R(sh.income));
  }
}
// TDS on salary (192) from 26AS: Schedule TDS1 (ITR-3) / TDSonSalaries (ITR-4), each employer's chargeable salary
export function tdsSalary(X, o, kind) {
  const M = X.model, ts = ((M.paid || {}).tdsSal || []).filter((r) => R(r.amt));
  if (!ts.length) return;
  const rows = M.salaryHead ? perEmployer(M.salaryHead) : [];
  const by = {}; ts.forEach((r) => { const k = r.tan || "?"; by[k] = by[k] || { tan: r.tan, name: r.name, amt: 0, gross: 0 }; by[k].amt += N(r.amt); by[k].gross += N(r.gross); });
  const list = Object.values(by).map((x) => { const e = rows.find((r) => r.tan && r.tan === x.tan); return { EmployerOrDeductorOrCollectDetl: { TAN: x.tan, EmployerOrDeductorOrCollecterName: String(x.name || (e && e.employer) || "").slice(0, 125) || undefined }, IncChrgSal: R(e ? e.chargeable : x.gross), TotalTDSSal: R(x.amt) }; });
  const base = kind === "itr4" ? "TDSonSalaries" : "ScheduleTDS1";
  put(o, base + "/TDSonSalary", list); put(o, base + "/" + "TotalTDSonSalaries", R(sumOf(list, (x) => x.TotalTDSSal)));
}

// ---------------- Schedule HP ----------------
// ITR-3 / ITR-4: L, D, S; ITR-5 / ITR-6: Y (let out), D (no self-occupation for a firm or company)
function letOut(X, path, k) { const n = nodeAt(X, path + "/ifLetOut"), e = (n && n.enum) || []; return e.includes(k) ? k : k === "L" && e.includes("Y") ? "Y" : k; }
function propertyRow(X, p, i, path, hp) {
  const share = p.share, co = share < 100;
  let left = R(p.interestAllowed);
  const loans = (p.loans || []).filter((l) => R(l.interest)).map((l) => { const a = Math.min(left, R(l.interest)); left -= a; return { LoanTknFrom: l.from === "I" ? "I" : "B", BankOrInstnName: l.bank ? String(l.bank).slice(0, 125) : undefined, LoanAccNoOfBankOrInstnRefNo: l.account ? String(l.account) : undefined, DateofLoan: iso(l.date), TotalLoanAmt: R(l.total), LoanOutstndngAmt: R(l.outstanding), InterestUs24B: a }; }).filter((l) => l.InterestUs24B);
  return fit(X, path, {
    HPSNo: i + 1, AddressDetailWithZipCode: addr(p.addr, /ITR4|IncomeDeductions/.test(path) ? 50 : 200), PropertyOwner: "SE", PropCoOwnedFlg: co ? "YES" : "NO", AsseseeShareProperty: share, AssessePercentShareProp: share,
    CoOwners: co && (p.coOwners || []).length ? p.coOwners.map((c, j) => ({ CoOwnersSNo: j + 1, NameCoOwner: c.name ? String(c.name).slice(0, 125) : undefined, PAN_CoOwner: PAN_OK.test(c.pan || "") ? c.pan : undefined, PercentShareProperty: N(c.share) })) : undefined,
    ifLetOut: letOut(X, path, p.kind), TenantDetails: p.kind === "L" && (p.tenants || []).length ? p.tenants.map((t, j) => ({ TenantSNo: j + 1, NameofTenant: t.name ? String(t.name).slice(0, 125) : undefined, PANofTenant: PAN_OK.test(t.pan || "") ? t.pan : undefined })) : undefined,
    Rentdetails: { AnnualLetableValue: R(p.rent), RentNotRealized: R(p.unrealised), LocalTaxes: R(p.muniTax), TotalUnrealizedAndTax: R(p.ded), BalanceALV: R(p.av), AnnualOfPropOwned: R(p.own), ThirtyPercentOfBalance: R(p.std30), IntOnBorwCap: R(p.interestAllowed),
      Section24B: loans.length ? { Section24BDtls: loans, TotalInterestUs24B: R(sumOf(loans, (l) => l.InterestUs24B)) } : undefined, TotalDeduct: R(p.std30 + p.interestAllowed), ArrearsUnrealizedRentRcvd: R(p.arrears), IncomeOfHP: R(p.income) },
  });
}
export function hpSchedule(X, o, kind) {
  const hp = X.model.hpHead;
  if (!hp || !hp.props.length) return;
  if (kind === "itr4") { put(o, "IncomeDeductions/PropertyDetails", hp.props.map((p, i) => propertyRow(X, p, i, "IncomeDeductions/PropertyDetails/[]", hp))); return; }
  put(o, "ScheduleHP/PropertyDetails", hp.props.map((p, i) => propertyRow(X, p, i, "ScheduleHP/PropertyDetails/[]", hp)));
  put(o, "ScheduleHP/PassThroghIncome", 0);
  put(o, "ScheduleHP/TotalIncomeChargeableUnHP", R(hp.total));
}

// ---------------- Schedules CG, 112A, SI ----------------
const FY = (fy) => String(fy) + "-" + String(+fy + 1).slice(2);
const deduct = (rs) => ({ AquisitCost: R(sumOf(rs, (x) => x.costUsed)), ImproveCost: R(sumOf(rs, (x) => x.imp)), ExpOnTrans: R(sumOf(rs, (x) => x.exp)), TotalDedn: R(sumOf(rs, (x) => x.costUsed + x.imp + x.exp)) });
const exDtl = (rs, codes) => { const d = []; rs.forEach((x) => { let left = R(x.exemptAmt); (x.exempt || []).forEach((e) => { const a = Math.min(left, R(e.amt)); left -= a; if (a && (!codes || codes.includes(e.sec))) d.push({ ExemptionSecCode: e.sec, ExemptionAmount: a }); }); }); return d; };
function aggregate(X, path, rs, extra) {
  const unl = rs.filter((x) => x.kind === "unlisted"), oth = rs.filter((x) => x.kind !== "unlisted");
  const recv = R(sumOf(unl, (x) => x.value)), fmv = R(sumOf(unl, (x) => x.sdv)), c50 = R(sumOf(unl, (x) => x.fullValue)), othV = R(sumOf(oth, (x) => x.fullValue));
  const ex = exDtl(rs);
  return fit(X, path, Object.assign({ FullValueConsdRecvUnqshr: recv, FairMrktValueUnqshr: fmv, FullValueConsdSec50CA: c50, FullValueConsdOthUnqshr: othV, FullConsideration: R(c50 + othV), DeductSec48: deduct(rs),
    BalanceCG: R(sumOf(rs, (x) => x.gain)), LossSec94of7Or94of8: 0, ExemptionOrDednUs54: { ExemptionOrDednUs54Dtls: ex.length ? ex : undefined, ExemptionGrandTotal: R(sumOf(rs, (x) => x.exemptAmt)) }, CapgainonAssets: R(sumOf(rs, (x) => x.net)) }, extra || {}));
}
function landRow(X, path, x, lt) {
  const ex = exDtl([x]), proviso = x.idxGain != null;
  const imps = (X.model.cgRows || []).find((r) => (r.id || "") === x.id);
  const improve = ((imps && imps.improve) || []).filter((m) => +m.fy >= 2001 && R(m.amt));
  const o = { DateofPurchase: iso(x.acq), DateofSale: iso(x.sale), FullConsideration: R(x.value), PropertyValuation: R(x.sdv), FullConsideration50C: R(x.fullValue), AquisitCost: R(x.costUsed), ImproveCost: R(x.imp), ExpOnTrans: R(x.exp),
    TotalDedn: R(x.costUsed + x.imp + x.exp), Balance: R(x.gain), ExemptionOrDednUs54: { ExemptionOrDednUs54Dtls: ex.length ? ex : undefined, ExemptionGrandTotal: R(x.exemptAmt) }, CapgainonAssets: R(x.net) };
  if (lt) {
    const idxCost = proviso ? R(x.idxCost) : R(x.costUsed), idxImp = proviso ? R(x.idxImp) : R(x.imp), dB = idxCost + idxImp + R(x.exp), balB = Math.max(0, R(x.fullValue) - dB), gB = proviso ? Math.max(0, R(x.idxNet)) : balB - Math.min(R(x.exemptAmt), balB);
    // the two taxes and the excess on what of this property's gain is chargeable (tax.js tax112: after the set-offs and
    // the basic exemption)
    const pr = ((X.comp.tax && X.comp.tax.p112 && X.comp.tax.p112.rows) || []).find((y) => y.id === x.id);
    const taxA = proviso && pr ? pr.taxA : 0, taxB = proviso && pr ? pr.taxB : 0, excess = proviso && pr ? pr.excess : 0;
    const cs = CII[fyOf(x.sale)] || CII[2025];
    Object.assign(o, { AquisitCostIndex: idxCost, TotalDednForEiB: dB, BalanceForEiB: balB, CapgainonAssets_1ea: gB, TaxSec1121a: taxA, TaxSec1121aiiB: taxB, ExcessAmtSec1121a: excess,
      CostOfImprovements: improve.length ? { CostOfImprovementsDtls: improve.map((m, j) => ({ slno: j + 1, ImproveCost: R(m.amt), ImproveDate: FY(m.fy), CostOfImpIndex: proviso ? R(N(m.amt) * cs / CII[Math.min(2025, +m.fy)]) : R(m.amt) })),
        TotalImprovecost: R(x.imp), TotalindexImprovecost: idxImp } : undefined });
  }
  const b = (imps && imps.buyers) || [];
  if (b.length) o.TrnsfImmblPrprty = { TrnsfImmblPrprtyDtls: b.map((y) => ({ NameOfBuyer: y.name ? String(y.name).slice(0, 125) : undefined, PANofBuyer: PAN_OK.test(y.pan || "") ? y.pan : undefined, PercentageShare: N(y.share || 100), Amount: R(y.amt != null ? y.amt : x.value),
    AddressOfProperty: imps.addr && (imps.addr.line || imps.addr.city) ? String([imps.addr.line, imps.addr.city].filter(Boolean).join(", ")).slice(0, 250) : undefined, StateCode: imps.addr && imps.addr.state ? String(imps.addr.state).padStart(2, "0") : undefined, CountryCode: imps.addr && imps.addr.state ? "91" : undefined, PinCode: imps.addr && imps.addr.pin ? +imps.addr.pin : undefined })) };
  return fit(X, path, o);
}
// the 112A rows (Schedule 112A): equity bought on or before 31-01-2018 row by row, the rest in one consolidated row
function s112A(X, o, rs) {
  if (!rs.length || !has(X, "Schedule112A")) return;
  const row = (x, be) => { const own = (X.model.cgRows || []).find((r) => (r.id || "") === x.id) || {}, fmv = be ? R(own.fmv2018) : 0;
    return { ShareOnOrBefore: be ? "BE" : "AE", ISINCode: be ? (/^IN[0-9A-Z]{10}$/.test(own.isin || "") ? own.isin : "INNOTAVAILAB") : "INNOTREQUIRD", ShareUnitName: be ? String(own.desc || "Equity").slice(0, 125) : "CONSOLIDATED",
      NumSharesUnits: be && own.qty ? N(own.qty) : undefined, SalePricePerShareUnit: be && own.qty ? Math.round(R(x.fullValue) / N(own.qty) * 100) / 100 : undefined, TotSaleValue: R(x.fullValue), CostAcqWithoutIndx: R(x.costUsed), AcquisitionCost: R(x.cost),
      LTCGBeforelower6and11: be ? Math.min(R(x.fullValue), fmv) : 0, FairMktValuePerShareunit: be && own.qty ? Math.round(fmv / N(own.qty) * 100) / 100 : 0, TotFairMktValueCapAst: fmv, ExpExclCnctTransfer: R(x.exp), TotalDeductions: R(x.costUsed + x.exp), Balance: R(x.fullValue - x.costUsed - x.exp) }; };
  const be = rs.filter((x) => x.acq && x.acq < "20180201"), ae = rs.filter((x) => !(x.acq && x.acq < "20180201"));
  const list = be.map((x) => row(x, true));
  if (ae.length) list.push(row({ fullValue: sumOf(ae, (x) => x.fullValue), costUsed: sumOf(ae, (x) => x.costUsed), cost: sumOf(ae, (x) => x.cost), exp: sumOf(ae, (x) => x.exp) }, false));
  put(o, "Schedule112A/Schedule112ADtls", list.map((x) => fit(X, "Schedule112A/Schedule112ADtls/[]", x)));
  const t = (k) => R(sumOf(list, (x) => x[k]));
  put(o, "Schedule112A", Object.assign(o.Schedule112A, { SaleValue112A: t("TotSaleValue"), CostAcqWithoutIndx112A: t("CostAcqWithoutIndx"), AcquisitionCost112A: t("AcquisitionCost"), LTCGBeforelowerB1B2112A: t("LTCGBeforelower6and11"), FairMktValueCapAst112A: t("TotFairMktValueCapAst"), ExpExclCnctTransfer112A: t("ExpExclCnctTransfer"), Deductions112A: t("TotalDeductions"), Balance112A: t("Balance") }));
}
// what of each rate's income (after the set-offs) accrued in each of Table F's periods: the gains as they accrued
// (heads.js at), the set-offs taken against the earliest
const PERIODS = [["20250615", "Upto15Of6"], ["20250915", "Upto15Of9"], ["20251215", "Up16Of9To15Of12"], ["20260315", "Up16Of12To15Of3"], ["20260331", "Up16Of3To31Of3"]];
function quarters(at, key, before, after) {
  const cut = Math.max(0, R(before) - R(after)), o = {}; let prev = 0;
  PERIODS.forEach(([d, k], i) => { const cum = i === PERIODS.length - 1 ? R(after) : Math.min(R(after), Math.max(0, R(((at || {})[d] || {})[key]) - cut)); o[k] = Math.max(0, cum - prev); prev = Math.max(prev, cum); });
  return o;
}
export function cgSchedule(X, o) {
  const M = X.model, S = X.comp, g = cgAsChosen(M.cgHead, S);
  if (!g || !g.rows.length) return;
  const f3 = X.form === "ITR-3", CG = f3 ? "ScheduleCGFor23" : "ScheduleCG", STk = f3 ? "ShortTermCapGainFor23" : "ShortTermCapGain", LTk = f3 ? "LongTermCapGain23" : "LongTermCapGain";
  const ST = CG + "/" + STk, LT = CG + "/" + LTk, rs = g.rows;
  const st = rs.filter((x) => !x.lt || x.kind === "mf50AA"), lt = rs.filter((x) => x.lt && x.kind !== "mf50AA");
  // short-term
  const stLand = st.filter((x) => x.kind === "land"), st111 = st.filter((x) => x.bucket === "s111A" && x.kind !== "buyback"), stBuy = st.filter((x) => x.kind === "buyback"), stOth = st.filter((x) => x.kind !== "land" && x.bucket !== "s111A" && x.kind !== "buyback");
  if (stLand.length) put(o, ST + "/SaleofLandBuild/SaleofLandBuildDtls", stLand.map((x) => landRow(X, ST + "/SaleofLandBuild/SaleofLandBuildDtls/[]", x, false)));
  if (st111.length) put(o, ST + "/EquityMFonSTT", [fit(X, ST + "/EquityMFonSTT/[]", { MFSectionCode: "1A", EquityMFonSTTDtls: Object.assign({ FullConsideration: R(sumOf(st111, (x) => x.fullValue)), DeductSec48: deduct(st111), BalanceCG: R(sumOf(st111, (x) => x.gain)), LossSec94of7Or94of8: 0, CapgainonAssets: R(sumOf(st111, (x) => x.net)) },
    X.form === "ITR-6" ? { FullValueConsdRecvUnqshr: 0, FairMrktValueUnqshr: 0, FullValueConsdSec50CA: 0, FullValueConsdOthUnqshr: R(sumOf(st111, (x) => x.fullValue)) } : {}) })]);
  if (stOth.length) put(o, ST + "/SaleOnOtherAssets", aggregate(X, ST + "/SaleOnOtherAssets", stOth, { DeemedStcgOnAssets: 0, DeemedSTCGDeprAsset: 0 }));
  if (stBuy.length) put(o, ST + "/CapitalLossBuyBackShares", fit(X, ST + "/CapitalLossBuyBackShares", { TotalCapitalLossBuyBackShares: -P0(-sumOf(stBuy, (x) => x.net)), CapitalLossBuyBackSharesDtls: [{ Rate: stBuy.some((x) => x.stt) ? "STL20" : "STLAR", Amount: -P0(-sumOf(stBuy, (x) => x.net)) }] }));
  put(o, ST + "/TotalSTCG", R(sumOf(st, (x) => x.net)));
  // long-term
  const ltLand = lt.filter((x) => x.kind === "land"), lt112A = lt.filter((x) => x.bucket === "s112A" && x.kind !== "buyback"), ltBuy = lt.filter((x) => x.kind === "buyback"), ltOth = lt.filter((x) => x.kind !== "land" && x.bucket !== "s112A" && x.kind !== "buyback");
  if (ltLand.length) {
    put(o, LT + "/SaleofLandBuild/SaleofLandBuildDtls", ltLand.map((x) => landRow(X, LT + "/SaleofLandBuild/SaleofLandBuildDtls/[]", x, true)));
    put(o, LT + "/SaleofLandBuild/TotalLTCGImmblPrprty", R(sumOf(ltLand, (x) => x.net)));
    const p112 = ((X.comp.tax && X.comp.tax.p112 && X.comp.tax.p112.rows) || []);
    if (has(X, LT + "/SaleofLandBuild/TotalExcessTax")) put(o, LT + "/SaleofLandBuild/TotalExcessTax", R(sumOf(p112.filter((y) => ltLand.some((x) => x.id === y.id && x.idxGain != null)), (y) => y.excess)));
  }
  if (lt112A.length) put(o, LT + "/SaleOfEquityShareUs112A", fit(X, LT + "/SaleOfEquityShareUs112A", { BalanceCG: R(sumOf(lt112A, (x) => x.gain)), DeductionUs54F: R(sumOf(lt112A, (x) => x.exemptAmt)), CapgainonAssets: R(sumOf(lt112A, (x) => x.net)) }));
  if (ltOth.length) put(o, LT + "/SaleofAssetNADtls/SaleofAssetNA", aggregate(X, LT + "/SaleofAssetNADtls/SaleofAssetNA", ltOth));
  if (ltBuy.length) put(o, LT + "/CapitalLossBuyBackShares", fit(X, LT + "/CapitalLossBuyBackShares", { TotalCapitalLossBuyBackShares: -P0(-sumOf(ltBuy, (x) => x.net)) }));
  put(o, LT + "/TotalLTCG", R(sumOf(lt, (x) => x.net)));
  s112A(X, o, lt112A);
  const head = R(g.total);
  put(o, CG + "/SumOfCGIncm", head); put(o, CG + "/IncmFromVDATrnsf", 0);
  if (f3) put(o, CG + "/TotScheduleCGFor23", head); else put(o, CG + "/IncChargeableHeadCapGain", head);
  // the 54-series claims
  const claims = {}; rs.forEach((x) => { let left = R(x.exemptAmt); (x.exempt || []).forEach((e) => { const a = Math.min(left, R(e.amt)); left -= a; if (!a) return; (claims[e.sec] = claims[e.sec] || []).push({ DateofTransfer: iso(x.sale), DateofAcquisition: iso(x.sale), CostofNewResHouse: R(e.cost) || undefined, CostofNewAsset: R(e.cost) || undefined, CostofNewAgriLand: R(e.cost) || undefined, CostofNewLandBuilding: R(e.cost) || undefined, DateofPurchase: iso(e.date), AmtInvested: e.sec === "54EC" ? a : undefined, DateofInvestment: e.sec === "54EC" ? iso(e.date) : undefined, AmtDeducted: a }); }); });
  Object.keys(claims).forEach((sec) => { const p = CG + "/DeducClaimInfo/DeducClaimDtlsUs" + sec; if (has(X, p)) put(o, p, claims[sec].map((c) => fit(X, p + "/[]", c))); });
  put(o, CG + "/DeducClaimInfo/TotDeductClaim", R(sumOf(rs, (x) => x.exemptAmt)));
  // Table E: the set-off of this year's losses within the head, by rate (20% = 111A, AppRate = normal, 12.5% = 112 and
  // 112A together)
  const raw = { a: 0, o: 0, l: 0 }; rs.forEach((x) => { if (x.bucket === "s111A") raw.a += x.net; else if (x.bucket === "stApp") raw.o += x.net; else raw.l += x.net; });
  const off = g.setoff || {}, f = (from, to) => R(sumOf(Object.keys(off).filter((k) => from.includes(k.split(">")[0]) && to.includes(k.split(">")[1])), (k) => off[k]));
  const s20 = ["s111A"], sApp = ["stApp"], l125 = ["s112", "s112A"];
  const inc = (v) => P0(v), loss = (v) => P0(-v);
  const tLoss = { a: loss(raw.a), o: loss(raw.o), l: loss(raw.l) };
  const CL = CG + "/CurrYrLosses";
  put(o, CL + "/InLossSetOff", { StclSetoff20Per: tLoss.a, StclSetoffAppRate: tLoss.o, LtclSetOff12_5Per: tLoss.l });
  put(o, CL + "/InStcg20Per", { CurrYearIncome: inc(raw.a), StclSetoffAppRate: f(sApp, s20), CurrYrCapGain: R(g.s111A) });
  put(o, CL + "/InStcgAppRate", { CurrYearIncome: inc(raw.o), StclSetoff20Per: f(s20, sApp), CurrYrCapGain: R(g.stApp) });
  put(o, CL + "/InLtcg12_5Per", { CurrYearIncome: inc(raw.l), StclSetoff20Per: f(s20, l125), StclSetoffAppRate: f(sApp, l125), CurrYrCapGain: R(g.s112 + g.s112A) });
  const used = { a: f(s20, sApp.concat(l125)), o: f(sApp, s20.concat(l125)) };
  put(o, CL + "/TotLossSetOff", { StclSetoff20Per: used.a, StclSetoffAppRate: used.o, LtclSetOff12_5Per: 0 });
  put(o, CL + "/LossRemainSetOff", { StclSetoff20Per: P0(tLoss.a - used.a), StclSetoffAppRate: P0(tLoss.o - used.o), LtclSetOff12_5Per: tLoss.l });
  // Table F: the income at each rate after the set-offs (Schedule BFLA), by when it accrued
  const A = S.after || {}, H = S.heads || {};
  put(o, CG + "/AccruOrRecOfCG/ShortTermUnder20Per/DateRange", quarters(g.at, "s111A", H.c111A, A.c111A));
  put(o, CG + "/AccruOrRecOfCG/ShortTermUnderAppRate/DateRange", quarters(g.at, "stApp", H.cOth, A.cOth));
  const at125 = {}; Object.keys(g.at || {}).forEach((d) => { at125[d] = { l: N(g.at[d].s112) + N(g.at[d].s112A) }; });
  put(o, CG + "/AccruOrRecOfCG/LongTermUnder12_5Per/DateRange", quarters(at125, "l", N(H.c112) + N(H.c112A), N(A.c112) + N(A.c112A)));
}
// Schedule SI: the income at special rates after the set-offs, and the tax on each (the proviso's excess off 112)
export function siSchedule(X, o) {
  const S = X.comp, A = S.after || {}, t = (S.tax || {}).parts || {};
  if (!(S.tax && S.tax.mat && S.tax.mat.applies) && (R(A.c111A) || R(A.c112A) || R(A.c112))) {
    const rows = [];
    if (R(A.c111A)) rows.push({ SecCode: X.form === "ITR-5" ? "1" : "1A", SplRatePercent: 20, SplRateInc: R(A.c111A), SplRateIncTax: R(t.t111A) });
    if (R(A.c112A)) rows.push({ SecCode: "2A", SplRatePercent: 12.5, SplRateInc: R(A.c112A), SplRateIncTax: R(t.t112A) });
    if (R(A.c112)) rows.push({ SecCode: "22", SplRatePercent: 12.5, SplRateInc: R(A.c112), SplRateIncTax: R(t.t112) });
    put(o, "ScheduleSI/SplCodeRateTax", rows.map((r) => fit(X, "ScheduleSI/SplCodeRateTax/[]", r)));
    put(o, "ScheduleSI/TotSplRateInc", R(sumOf(rows, (r) => r.SplRateInc))); put(o, "ScheduleSI/TotSplRateIncTax", R(sumOf(rows, (r) => r.SplRateIncTax)));
  }
}
// Part B-TI: the capital gains by rate (Schedule CG, before CYLA)
export function tiCapGain(X, o, base) {
  const H = X.comp.heads || {};
  if (!R(H.cg)) return;
  const st = R(N(H.c111A) + N(H.cOth)), lt = R(N(H.c112A) + N(H.c112));
  put(o, base + "/CapGain", fit(X, base + "/CapGain", { ShortTerm: { ShortTerm20Per: R(H.c111A), ShortTerm30Per: 0, ShortTermAppRate: R(H.cOth), ShortTermSplRateDTAA: 0, TotalShortTerm: st }, LongTerm: { LongTerm12_5Per: lt, LongTermSplRateDTAA: 0, TotalLongTerm: lt }, ShortTermLongTermTotal: R(st + lt), CapGains30Per115BBH: 0, TotalCapGains: R(H.cg) }));
}

// ---------------- Schedule AL ----------------
// ITR-3: the person's assets and liabilities at the year end other than those in Part A-BS (total income above Rs 1
// crore, validation rule 905); at cost
export function alSchedule(X, o) {
  const a = X.model.al; if (!a) return;
  const imm = (a.immovable || []).filter((x) => R(x.amt) || x.desc);
  if (imm.length) put(o, "ScheduleAL/ImmovableDetails", imm.map((x) => fit(X, "ScheduleAL/ImmovableDetails/[]", { Description: x.desc ? String(x.desc).slice(0, 25) : undefined, AddressAL: addrAL(x.addr), Amount: R(x.amt) })));
  put(o, "ScheduleAL/MovableAsset", { DepositsInBank: R(a.deposits), SharesAndSecurities: R(a.shares), InsurancePolicies: R(a.insurance), LoansAndAdvancesGiven: R(a.loans), CashInHand: R(a.cash), JewelleryBullionEtc: R(a.jewellery), ArchCollDrawPaintSulpArt: R(a.art), VehiclYachtsBoatsAircrafts: R(a.vehicles) });
  const firms = (a.firms || []).filter((x) => x.name || x.pan);
  put(o, "ScheduleAL/InterstAOPFlag", firms.length ? "Y" : "N");
  if (firms.length) put(o, "ScheduleAL/InterestHeldInaAsset", firms.map((x) => fit(X, "ScheduleAL/InterestHeldInaAsset/[]", { NameOfFirm: x.name ? String(x.name).slice(0, 50) : undefined, AddressAL: addrAL(x.addr), PanOfFirm: PAN_OK.test(x.pan || "") ? x.pan : undefined, AssesseInvestment: R(x.amt) })));
  put(o, "ScheduleAL/LiabilityInRelatAssets", R(a.liabilities));
}
// the schema's own lists, as the owner entered them on the page (the page's editor is drawn from the schema): FA, SH,
// ITR-6's AL-1 / AL-2
const rowsOf = (v) => (Array.isArray(v) ? v.filter((r) => r && Object.keys(r).length) : []);
export function listSchedule(X, o, path, given, flags) {
  if (!given) return false;
  const out = {}; let any = false;
  const n = nodeAt(X, path); if (!n) return false;
  Object.keys(n.properties || {}).forEach((k) => { const rs = rowsOf(given[k]); if (rs.length) { out[k] = rs.map((r) => fit(X, path + "/" + k + "/[]", r)); any = true; } });
  if (!any) return false;
  put(o, path, Object.assign(flags || {}, out));
  return true;
}
export function faSchedule(X, o) { return listSchedule(X, o, "ScheduleFA", X.model.fa); }
export function shSchedule(X, o) {
  const sh = X.model.sh; if (!sh) return false;
  const a = listSchedule(X, o, "ScheduleSH/ShrhldngUnlistedCompany", sh, { SHUnlistedCompanyFlag: "Y" });
  const b = listSchedule(X, o, "ScheduleSH/ShrhldngStartUps", sh.startup);
  return a || b;
}
export function al6Schedule(X, o) {
  const a = X.model.al6; if (!a) return false;
  const x = listSchedule(X, o, "ScheduleAL/AsstLiabilitiesUnlistedCompany", a, { ALUnlistedCompanyFlag: "Y" });
  const y = listSchedule(X, o, "ScheduleAL/AsstLiabilitiesStartUps", a.startup, { ALStartUpsFlag: "Y" });
  return x || y;
}

// ---------------- ITR-6: Part A-BS and Part A-P&L under Ind AS ----------------
// the books' codes (Schedule III Division I in FinCom's statements) placed in the Division II heads; the owner confirms
// the placing against the audited Ind AS statements on Checks (verify.js indas_map); other comprehensive income is not
// in the books and is entered
export function bsIndAs(X, o, P) {
  const sc = X.sched; if (!sc) return;
  const b = sc.bs, t = sc.totals, B = "PARTA_BSIndAS";
  const all = Object.values(b).flatMap((l) => l.trace);
  const cs = (codes) => R(all.filter((x) => codes.includes(x.code)).reduce((a, x) => a + N(x.amt), 0));
  const tr = (key, re) => R(b[key].trace.filter((x) => re.test(x.code)).reduce((a, x) => a + N(x.amt), 0));
  const oth = (d, v) => (R(v) ? [{ OthersDesc: d, OthersAmount: R(v) }] : undefined);
  // preference shares (3B): under Ind AS 32 a redeemable preference share is a financial liability (non-current
  // borrowings, "liability component"); kept in equity only when the owner says it is irredeemable (P.prefEquity)
  const pref = cs(["3B"]), prefL = P.prefEquity === true ? 0 : pref;
  const sh0 = cs(["3A", "3B"]), sh = R(sh0 - prefL), sp = cs(["4B"]), ores = cs(["4C", "4D"]), pl = R(t.equity - sh0 - sp - ores);
  const resTot = R(sp + ores), eq = R(t.equity - prefL);
  put(o, B + "/EquityAndLiablities/Equity", { EquityShareCapital: { Authorised: P.authorised != null ? R(P.authorised) : undefined, IssuedSubsPaidUp: sh, SubscribedNotFullyPaid: 0, TotShareCapital: sh },
    OtherEquityReserv: { OtherResrvDtls: [["Securities premium", sp], ["General and other reserves", ores]].filter(([, v]) => R(v) > 0).map(([d, v]) => ({ OthersDesc: d, OthersAmount: R(v) })), OthersTotal: Math.max(0, resTot), TotalOtherResrv: Math.max(0, resTot), RetainedEarngs: pl, TotResrNRetEar: R(resTot + pl), TotalEquity: eq } });
  const tlB = cs(["30A"]), tlO = cs(["30B"]), dtl = cs(["31A"]), oltl = cs(["32A"]), ltpE = cs(["5A", "5C"]), ltpO = cs(["5D"]);
  const ncl = R(tlB + tlO + prefL + oltl + ltpE + ltpO + dtl);
  const NC = B + "/EquityAndLiablities/Liabilities/NonCurrLiabilities";
  put(o, NC, { FinancialLiabilities: { TermLoans: { RupeeLoans: { FromBanks: tlB, FromOthers: tlO, Total: R(tlB + tlO) }, TotalTermLoans: R(tlB + tlO) }, LiabilityComp: prefL, TotalLTBorrowings: R(tlB + tlO + prefL), OtherFinancialLiab: oltl },
    Provisions: { ProvEmpBenefits: ltpE, OthersProvisions: oth("Other long-term provisions", ltpO), OthersTotal: ltpO, TotalProvisions: R(ltpE + ltpO) }, DefrdTaxCurrLiabilites: dtl, TotalNonCurrLiab: ncl });
  const stB = cs(["33A"]), stO = cs(["33B", "33C"]), tp = cs(["6A", "6B"]), ai = cs(["7G"]), adv = cs(["7H", "7E"]), op = cs(["7A", "7B", "7C", "7F"]), spE = cs(["5B", "5E"]), itp = cs(["7D"]), spO = cs(["5F", "5G"]);
  const borr = R(stB + stO), othFin = R(ai + op), fin = R(borr + tp + othFin), cl = R(fin + adv + spE + spO + itp);
  const CL = B + "/EquityAndLiablities/Liabilities/CurrentLiabilities";
  put(o, CL, { FinancialLiabBorrowings: { LoansRepaybleOnDemand: { FromBanks: stB, FrmOtherParties: stO, TotLoansRepaybleOnDemand: borr }, TotalBorrowings: borr, TradePayables: tp },
    OthFinancialLiabilities: { AccrInterest: ai, OthPayables: oth("Other payables", op), OthersTotal: op, TotOthFinancialLiab: othFin }, TottalFinancialLiab: fin,
    OtherCuurLiabilities: { RevenueRecvdAdvance: adv, OthersAdvTotal: 0, TotalOthCurrLiab: adv }, Provosions: { ProvosionEmpBenft: spE, OthersProvisions: oth("Other provisions", spO), OthersTotal: spO, TotalProvosions: R(spE + spO) }, CurrTaxLiabilities: itp, TotalCurrentLiab: cl, TotalEquityLiab: R(eq + ncl + cl) });
  const gT = tr("grossBlock", /^8/), dT = tr("accDep", /^8/), gI = tr("grossBlock", /^34/), dI = tr("accDep", /^34/), cw = cs(["35A"]), iud = cs(["35B"]);
  const nci = cs(["36A"]), dta = cs(["9A"]), ca38 = cs(["38B"]), sd = cs(["38A"]), ol = cs(["38D"]), onca = cs(["38C"]);
  const loansN = R(sd + ol), othNca = R(ca38 + onca);
  const nca = R(gT - dT + cw + gI - dI + iud + nci + loansN + dta + othNca);
  const PP = B + "/Assets/NonCurrAssets/PropertyPlantEquip";
  put(o, PP, { GrossBlock: gT, Depreciation: dT, ImpairmentLosses: 0, NetBlock: R(gT - dT), CapWrkProg: cw, OthIntAstGrossBlock: gI, OthIntAstAmortisation: dI, OthIntAstImprLosses: 0, OthIntAstNetBlock: R(gI - dI), IntAstUndrDevlpmnt: iud,
    FinancialAssets: { Investments: { OtherInvestment: oth("Non-current investments", nci), OthersTotal: nci, TotalNonCurrentInvst: nci }, Loans: { SecurityDepsts: sd, OtherLoans: oth("Other long-term loans and advances", ol), OthersTotal: ol, TotalLoans: loansN, LoansBPPurpose: P.loansForBusiness === true ? loansN : undefined },
      OtherFinacialAssets: { DefrdTaxAsst: dta }, OtherNonCurrentAssets: { CapitalAdvanc: ca38, OtherNonCurrAsst: oth("Other non-current assets", onca), OthersTotal: onca, TotalNonCurrAsst: othNca }, TotalNonCurrntAsst: nca } });
  const ci = cs(["37A"]), inv = cs(["39A"]), trd = cs(["10A", "10B"]), bank = cs(["11A", "11B", "11C"]), cash = cs(["11D"]), sd12 = cs(["12A"]), stl = cs(["12F", "12G", "12H"]), tax = cs(["12B"]), oca = cs(["12C", "12D", "12E", "12K"]);
  const loansC = R(sd12 + stl), finC = R(ci + trd + bank + cash + loansC), cas = R(inv + finC + tax + oca);
  const CA = B + "/Assets/CurrentAssets";
  put(o, CA, { Inventories: { StockInTrade: inv, TotalInventories: inv }, FinancialAssets: { Investments: { OtherInvestment: ci, TotalCurrentInvst: ci }, TradeReceivables: { UnSecuredConsGoods: trd, TotalTradeReceivbls: trd },
    CashEquivalents: { BalancesWithBanks: bank, CashOnHand: cash, TotalCashEquivalents: R(bank + cash) }, Loans: { SecurityDepsts: sd12, OtherLoans: oth("Other loans and advances", stl), OthersTotal: stl, TotalLoans: loansC, LoansBPPurpose: P.loansForBusiness === true ? loansC : undefined }, OtherFinancialAsst: 0, TotalFinancialAsst: finC,
    // (the schema keeps the tax assets, the other current assets and the total inside FinancialAssets)
    CurrentTaxAsst: tax, OtherCurrentAssets: { OthersCurrentAssts: oth("Other current assets", oca), OthersTotal: oca, TotalOthCurrentAsst: oca, TotalCurrAsst: cas } } });
  put(o, B + "/TotalAssets", R(nca + cas));
}
// other comprehensive income, as entered (Ind AS 1): items not reclassified and items reclassified to profit or loss
export function ociIndAs(X, o) {
  const c = X.model.oci || {}, sc = X.sched;
  const not = { ChangesInSurplus: R(c.surplus), ReMesDefinedBenftPlans: R(c.remeasure), EquityOCI: R(c.equity), FairValFVTPl: R(c.fvtpl), ShareOfOtherComprInc: R(c.shareAssoc), OthersTotal: 0, IncomeTaxNotPnL: R(c.taxNot) };
  not.TotalNotPnL = R(not.ChangesInSurplus + not.ReMesDefinedBenftPlans + not.EquityOCI + not.FairValFVTPl + not.ShareOfOtherComprInc - not.IncomeTaxNotPnL);
  const re = { ExchangeDiff: R(c.fx), DebtsOCI: R(c.debt), EffecPortionGainnLoss: R(c.hedge), ShareOCI: R(c.shareAssocRe), OthersTotal: 0, IncomeTaxReclsPnL: R(c.taxRe) };
  re.TotalPnL = R(re.ExchangeDiff + re.DebtsOCI + re.EffecPortionGainnLoss + re.ShareOCI - re.IncomeTaxReclsPnL);
  put(o, "PARTA_PLIndAS/OtherComprnsvInc", { ItemsNotReclsfdPnL: not, ItemsReclsfdPnL: re, TotalComprIncome: R((sc ? sc.totals.pat : 0) + not.TotalNotPnL + re.TotalPnL) });
}
