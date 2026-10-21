// Which reports, annexures and paragraphs apply to a company for a year (ROUND 100). Pure: the figures (facts.js, rupees)
// and the answers on the entity (questionnaire.js) in, a plain object out, each decision with its reason. The limits are
// in law.js.
//
//   applicability(f, a)
//     f  {fyEnd, paidUp, turnover, turnoverPy, revenue, reserves, netWorthPy, pbtPy, bankBorrowPeak, borrowPeak, ...}
//     a  answers: e_class (private | public | listed | opc | s8), e_holdsub (none | holding | subsidiary | subsidiary_public),
//        e_sector (general | banking | insurance | nidhi | nbfc), e_filing_default (yes | no), e_peak_bank, e_peak_borrow,
//        e_format (auto | full | abridged), e_mdna, e_cg, c_wc_limits, b_ids, csr_np (net profit u/s 198, preceding year)
import { LAW, smallLimits } from "./law.js";

const N = (v) => +v || 0;
const cr = (v) => "₹" + (Math.round(N(v) / 1e5) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 }) + " crore";
const yes = (v) => v === true || v === "yes";

export function smallTest(f, a, lim) {
  const cls = a.e_class || "private", hs = a.e_holdsub || "none", sector = a.e_sector || "general";
  // turnover as per the profit and loss account of the immediately preceding financial year (the year itself when FinCom
  // has no year before)
  const to = f.turnoverPy || f.turnover;
  const why = [];
  if (cls !== "private") why.push(cls === "opc" ? "a one person company is dealt with as such" : cls === "s8" ? "a section 8 company is never a small company" : "a public company is never a small company");
  if (hs === "holding" || hs === "subsidiary" || hs === "subsidiary_public") why.push("a holding or subsidiary company is never a small company");
  if (sector !== "general") why.push("a company governed by a special Act is never a small company");
  const capOk = f.paidUp <= lim.paidUp, toOk = to <= lim.turnover;
  if (!capOk) why.push("paid-up capital " + cr(f.paidUp) + " exceeds " + cr(lim.paidUp));
  if (!toOk) why.push("turnover " + cr(to) + " exceeds " + cr(lim.turnover));
  return { yes: !why.length, why, paidUp: f.paidUp, turnover: to, limits: lim };
}

export function applicability(f, a) {
  a = a || {};
  const cls = a.e_class || "private", hs = a.e_holdsub || "none", sector = a.e_sector || "general";
  const listed = cls === "listed", pub = cls === "public" || listed || (cls === "s8" && a.e_s8_public === "yes"), pvt = !pub;
  const L = smallLimits(f.fyEnd), sm = smallTest(f, a, L.now), smOld = L.before ? smallTest(f, a, L.before) : null;
  const small = sm.yes, opc = cls === "opc";
  const peakBank = a.e_peak_bank != null && a.e_peak_bank !== "" ? N(a.e_peak_bank) : N(f.bankBorrowPeak);
  const peakAll = a.e_peak_borrow != null && a.e_peak_borrow !== "" ? N(a.e_peak_borrow) : N(f.borrowPeak);
  const out = { cls, listed, pub, pvt, small, opc, s8: cls === "s8", smallTest: sm, smallTestBefore: smOld, peakBank, peakAll };

  // Board's Report format: Rule 8A (abridged) for a one person company or a small company
  const can8A = small || opc;
  out.abridged = can8A && (a.e_format || "auto") !== "full";
  if (a.e_format === "abridged" && !can8A) out.abridged = false;
  out.formatWhy = can8A ? (opc ? "a one person company" : "a small company") + ": the abridged Board's Report under Rule 8A may be used" : "the full Board's Report under section 134(3) and Rule 8 applies";
  // cash flow statement: not required of a one person company, a small company or a dormant company (s.2(40))
  out.cashFlow = !(small || opc);

  // CARO 2020, para 1(2)
  const caro = { applies: true, reason: "" };
  if (sector === "banking") caro.reason = "a banking company";
  else if (sector === "insurance") caro.reason = "an insurance company";
  else if (cls === "s8") caro.reason = "a company licensed under section 8 of the Act";
  else if (opc) caro.reason = "a one person company";
  else if (small) caro.reason = "a small company as defined in section 2(85) of the Act";
  else if (pvt && hs !== "holding" && hs !== "subsidiary_public") {
    const P = LAW.caroPvt, capRes = N(f.paidUp) + N(f.reserves);
    if (capRes <= P.capRes && peakBank <= P.bankBorrow && N(f.revenue) <= P.revenue) caro.reason = "a private company whose paid-up capital and reserves and surplus do not exceed ₹1 crore, whose borrowings from banks and financial institutions did not exceed ₹1 crore at any time during the year, and whose total revenue does not exceed ₹10 crore";
    caro.tests = { capRes, bankBorrow: peakBank, revenue: N(f.revenue) };
  }
  caro.applies = !caro.reason;
  out.caro = caro;

  // internal financial controls, s.143(3)(i): the exemption of 13 June 2017 for private companies
  const ifc = { applies: true, reason: "" };
  if (opc) ifc.reason = "a one person company";
  else if (small) ifc.reason = "a small company";
  else if (pvt && !yes(a.e_filing_default) && N(f.turnoverPy || f.turnover) < LAW.ifcPvt.turnover && peakAll < LAW.ifcPvt.borrow) ifc.reason = "a private company with turnover below ₹50 crore as per its latest audited financial statements and borrowings from banks, financial institutions and bodies corporate below ₹25 crore at all times during the year, which has not defaulted in filing its financial statements or annual return";
  ifc.applies = !ifc.reason;
  out.ifc = ifc;

  // the rest of the report
  out.kam = listed || yes(a.a_kam_voluntary);
  out.s197 = pub;
  out.dre = { ifcClause: listed };
  out.idDecl = listed || (pub && (f.paidUp >= LAW.ids.paidUp || f.turnoverPy >= LAW.ids.turnover || peakAll >= LAW.ids.borrow)) || yes(a.b_ids);
  out.committees = listed || (pub && (f.paidUp >= LAW.committees.paidUp || f.turnoverPy >= LAW.committees.turnover || peakAll >= LAW.committees.borrow));
  out.vigil = listed || out.committees || peakBank >= LAW.vigil.bankBorrow;
  out.evaluation = listed || (pub && f.paidUp >= LAW.evaluation.paidUp);
  out.mr3 = listed || (pub && (f.paidUp >= LAW.mr3.paidUp || f.turnoverPy >= LAW.mr3.turnover)) || peakBank >= LAW.mr3.bankBorrow;
  out.rule5 = listed;
  out.mdna = listed || yes(a.e_mdna);
  out.mdnaVoluntary = !listed && yes(a.e_mdna);
  out.cg = listed || yes(a.e_cg);
  out.cgVoluntary = !listed && yes(a.e_cg);
  out.ss = !opc;
  out.rotation = pub;
  const IA = LAW.internalAudit;
  out.internalAudit = listed || (pub ? (f.paidUp >= IA.pubPaidUp || f.turnoverPy >= IA.pubTurnover || peakAll >= IA.pubBorrow) : (f.turnoverPy >= IA.pvtTurnover || peakAll >= IA.pvtBorrow));
  out.costRecords = (f.turnoverPy || 0) >= LAW.costRecords;
  out.wcLimits = yes(a.c_wc_limits);

  // CSR, s.135: net worth, turnover or net profit of the preceding financial year
  const C = LAW.csr, np = a.csr_np != null && a.csr_np !== "" ? N(a.csr_np) : N(f.pbtPy);
  const csrWhy = [];
  if (N(f.netWorthPy) >= C.netWorth) csrWhy.push("net worth of the preceding year " + cr(f.netWorthPy));
  if (N(f.turnoverPy) >= C.turnover) csrWhy.push("turnover of the preceding year " + cr(f.turnoverPy));
  if (np >= C.netProfit) csrWhy.push("net profit of the preceding year " + cr(np));
  const avg = a.csr_avg != null && a.csr_avg !== "" ? N(a.csr_avg) : np;
  out.csr = { applies: csrWhy.length > 0, why: csrWhy, netWorth: N(f.netWorthPy), turnover: N(f.turnoverPy), netProfit: np, avgProfit: avg,
    obligation: Math.max(0, Math.round(avg * C.rate * 100) / 100), committee: Math.max(0, avg * C.rate) > C.committee };
  return out;
}
