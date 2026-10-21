// The limits the reports pack applies, kept as data (ROUND 100): when a limit changes, change it here (with the date it
// takes effect) and nothing else. Amounts in rupees. Sources: docs/reports-pack.md.
//
// small company, s.2(85): G.S.R. 880(E), in force 1-Dec-2025 (owner's confirmation 20-Oct-2026: the new limits apply to
// accounts for the year ended 31-Mar-2026). A list, newest first: the first whose `from` is on or before the year end
// applies; the one after it is shown beside it for a year of change.
export const CR = 1e7, LAKH = 1e5;
export const SMALL = [
  { from: "20251201", paidUp: 10 * CR, turnover: 100 * CR, ref: "G.S.R. 880(E), in force 1 December 2025" },
  { from: "20220915", paidUp: 4 * CR, turnover: 40 * CR, ref: "G.S.R. 700(E), in force 15 September 2022" },
  { from: "20210401", paidUp: 2 * CR, turnover: 20 * CR, ref: "G.S.R. 92(E), in force 1 April 2021" },
];
export const LAW = {
  // CARO 2020 para 1(2)(v): a private company (not a holding or subsidiary of a public company) is outside the Order when
  // all three are within these limits (no change for FY 2025-26: owner, 20-Oct-2026)
  caroPvt: { capRes: 1 * CR, bankBorrow: 1 * CR, revenue: 10 * CR },
  // s.143(3)(i) exemption for private companies (notification of 13 June 2017): turnover below and borrowings below,
  // with no default in filing financial statements or the annual return
  ifcPvt: { turnover: 50 * CR, borrow: 25 * CR },
  // s.135(1): any of these in the preceding financial year
  csr: { netWorth: 500 * CR, turnover: 1000 * CR, netProfit: 5 * CR, rate: 0.02, committee: 50 * LAKH },
  // s.204 / Rule 9: secretarial audit (unlisted public company)
  mr3: { paidUp: 50 * CR, turnover: 250 * CR, bankBorrow: 100 * CR },
  // s.177 / s.178 with Meetings Rule 6: audit committee and NRC (public company)
  committees: { paidUp: 10 * CR, turnover: 100 * CR, borrow: 50 * CR },
  // Rule 7: vigil mechanism: borrowings from banks / FIs above
  vigil: { bankBorrow: 50 * CR },
  // Rule 8(4): annual evaluation of the Board (public company)
  evaluation: { paidUp: 25 * CR },
  // independent directors, Appointment Rules r.4 (public company)
  ids: { paidUp: 10 * CR, turnover: 100 * CR, borrow: 50 * CR },
  // s.138 / Accounts Rules r.13: internal audit
  internalAudit: { pvtTurnover: 200 * CR, pvtBorrow: 100 * CR, pubPaidUp: 50 * CR, pubTurnover: 200 * CR, pubBorrow: 100 * CR },
  // CARO 3(ii)(b): working capital limits on current assets above
  wcLimit: 5 * CR,
  // cost records (Cost Records and Audit Rules r.3): turnover of the preceding year from which records apply
  costRecords: 35 * CR,
  // s.197(12) / Rule 5(2) (listed): remuneration above which particulars are given
  rule5: { year: 102 * LAKH, month: 8.5 * LAKH },
};
// CIN: L (listed) / U (unlisted), then ... PTC (private), PLC (public), OPC, NPL (s.8), GOI / SGC (government) ...
export function classFromCin(cin) {
  const c = String(cin || "").toUpperCase().replace(/\s+/g, "");
  if (!/^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/.test(c)) return "";
  const t = c.slice(12, 15);
  if (t === "OPC") return "opc";
  if (t === "NPL") return "s8";
  if (c[0] === "L") return "listed";
  if (t === "PTC" || t === "FTC") return "private";
  return "public";
}
export const smallLimits = (fyEnd) => {
  const i = SMALL.findIndex((s) => s.from <= String(fyEnd));
  return { now: SMALL[i < 0 ? SMALL.length - 1 : i], before: SMALL[i + 1] || null };
};
