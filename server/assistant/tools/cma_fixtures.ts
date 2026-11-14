// Made-up figures for the CMA tests (cma_test.ts, ../cmaask_test.ts). Every name and figure here is invented.
import ExcelJS from "npm:exceljs@4.4.0";
import type { CYear } from "./cmaengine.ts";

// two years that balance; FY 2024-25 repays 3,00,000 of term loans
export const YA: CYear = { fy: 2023, kind: "audited", src: "test", l: {
  share: 1000000, reserves: 1500000, ltb: 2000000, stb: 1200000, tp: 800000, ocl: 300000, stp: 200000,
  ppe: 3000000, intang: 100000, ltla: 200000, inv: 1500000, tr: 1600000, cash: 300000, stla: 200000, oca: 100000,
  rev: 12000000, oth: 100000, mat: 7000000, emp: 1500000, fin: 400000, dep: 300000, exp: 1800000, tax: 300000 } };
export const YB: CYear = { fy: 2024, kind: "audited", src: "test", repay: 300000, l: {
  share: 1000000, reserves: 2600000, ltb: 1700000, stb: 1400000, tp: 900000, ocl: 300000, stp: 250000,
  ppe: 3200000, intang: 100000, ltla: 200000, inv: 1800000, tr: 1900000, cash: 650000, stla: 200000, oca: 100000,
  rev: 13800000, oth: 100000, mat: 8050000, emp: 1650000, fin: 380000, dep: 320000, exp: 2000000, tax: 400000 } };

const L = 1e5;
// an earlier CMA in lakhs: Form II and Form III stacked on one sheet, two audited years and the CMA's own estimate; its
// 2024-25 receivables 19.50 and cash 6.00 (the audited balance sheet says 19.00 and 6.50)
export async function cmaXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("CMA");
  const a = YA.l, b = YB.l, e = { ...YB.l, rev: 15000000 };
  const lk = (v: number) => Math.round(v / L * 100) / 100;
  const rows: (string | number | null)[][] = [
    ["Kestrel Widgets Pvt Ltd - CMA data (Rs. in lakhs)"], [],
    ["FORM II - OPERATING STATEMENT"], ["Particulars", "2023-24", "2024-25", "2025-26"], ["", "Audited", "Audited", "Estimated"],
    ["Net sales", lk(a.rev), lk(b.rev), lk(e.rev)], ["% rise in net sales", null, 15, 8.7],
    ["Raw materials consumed", lk(a.mat), lk(b.mat), 90], ["Direct labour", lk(a.emp), lk(b.emp), 17], ["Depreciation", lk(a.dep), lk(b.dep), 3.2],
    ["Sub-total (cost of sales)", 98, 100.2, 110], ["Selling, general and administrative expenses", lk(a.exp), lk(b.exp), 21],
    ["Operating profit before interest", 15, 17.8, 18], ["Interest", lk(a.fin), lk(b.fin), 4], ["Other non-operating income", lk(a.oth), lk(b.oth), 1],
    ["Profit before tax", 11, 15, 15], ["Provision for taxes", lk(a.tax), lk(b.tax), 4], ["Net profit", 8, 11, 11], [],
    ["FORM III - ANALYSIS OF BALANCE SHEET"], ["Particulars", "2023-24", "2024-25", "2025-26"], ["", "Audited", "Audited", "Estimated"],
    ["CURRENT LIABILITIES"], ["Short term borrowings from banks (cash credit)", lk(a.stb), lk(b.stb), 15], ["Sundry creditors (trade)", lk(a.tp), lk(b.tp), 10],
    ["Other current liabilities", lk(a.ocl), lk(b.ocl), 3], ["Provision for taxation", lk(a.stp), lk(b.stp), 3], ["Total current liabilities", 25, 28.5, 31],
    ["TERM LIABILITIES"], ["Term loans", lk(a.ltb), lk(b.ltb), 14], ["Total term liabilities", 20, 17, 14],
    ["NET WORTH"], ["Ordinary share capital", lk(a.share), lk(b.share), 10], ["Surplus", lk(a.reserves), lk(b.reserves), 37], ["Net worth", 25, 36, 47],
    ["Total liabilities", 70, 81.5, 92],
    ["CURRENT ASSETS"], ["Cash and bank balances", lk(a.cash), 6.0, 7], ["Receivables", lk(a.tr), 19.5, 22], ["Inventory - raw materials", lk(a.inv) - 5, lk(b.inv) - 6, 14],
    ["Inventory - finished goods", 5, 6, 7], ["Advances to suppliers", lk(a.stla), lk(b.stla), 2], ["Other current assets", lk(a.oca), lk(b.oca), 1], ["Total current assets", 37, 46.5, 53],
    ["FIXED ASSETS"], ["Gross block", 40, 45.2, 50], ["Less: depreciation to date", 10, 13.2, 16], ["Net block", lk(a.ppe), lk(b.ppe), 34],
    ["OTHER NON-CURRENT ASSETS"], ["Security deposits", lk(a.ltla), lk(b.ltla), 2], ["Intangible assets", lk(a.intang), lk(b.intang), 1], ["Total assets", 70, 81.5, 92],
    [], ["FORM V - MPBF"], ["Particulars", "2023-24", "2024-25", "2025-26"], ["Total current assets", 37, 46.5, 53], ["Working capital gap", 24, 32, 36],
  ];
  rows.forEach((r) => ws.addRow(r));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
// the audited balance sheet and P&L for FY 2024-25 (with 2023-24), in rupees, Schedule III with a Note column
export async function bsXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook(), a = YA.l, b = YB.l;
  const bs = wb.addWorksheet("Balance Sheet");
  [["Kestrel Widgets Private Limited"], ["Audited Balance Sheet as at 31st March 2025"], ["Particulars", "Note", "As at 31 March 2025", "As at 31 March 2024"],
    ["I. EQUITY AND LIABILITIES"], ["(1) Shareholders' funds"], ["(a) Share capital", 2, b.share, a.share], ["(b) Reserves and surplus", 3, b.reserves, a.reserves],
    ["(2) Non-current liabilities"], ["(a) Long-term borrowings", 4, b.ltb, a.ltb], ["(3) Current liabilities"], ["(a) Short-term borrowings", 5, b.stb, a.stb],
    ["(b) Trade payables", 6, b.tp, a.tp], ["(c) Other current liabilities", 7, b.ocl, a.ocl], ["(d) Short-term provisions", 8, b.stp, a.stp], ["TOTAL", null, 8150000, 7000000],
    ["II. ASSETS"], ["(1) Non-current assets"], ["(a) Property, Plant and Equipment", 9, b.ppe, a.ppe], ["(b) Intangible assets", 9, b.intang, a.intang], ["(c) Long-term loans and advances", 10, b.ltla, a.ltla],
    ["(2) Current assets"], ["(a) Inventories", 11, b.inv, a.inv], ["(b) Trade receivables", 12, b.tr, a.tr], ["(c) Cash and cash equivalents", 13, b.cash, a.cash],
    ["(d) Short-term loans and advances", 14, b.stla, a.stla], ["(e) Other current assets", 15, b.oca, a.oca], ["Total assets", null, 8150000, 7000000]].forEach((r) => bs.addRow(r));
  const pl = wb.addWorksheet("Statement of Profit and Loss");
  [["Statement of Profit and Loss for the year ended 31st March 2025"], ["Particulars", "Note", "Year ended 31 March 2025", "Year ended 31 March 2024"],
    ["Revenue from operations", 16, b.rev, a.rev], ["Other income", 17, b.oth, a.oth], ["Total income", null, b.rev + b.oth, a.rev + a.oth], ["Expenses"],
    ["Cost of materials consumed", 18, b.mat, a.mat], ["Employee benefits expense", 19, b.emp, a.emp], ["Finance costs", 20, b.fin, a.fin], ["Depreciation and amortisation expense", 9, b.dep, a.dep],
    ["Other expenses", 21, b.exp, a.exp], ["Total expenses", null, 12400000, 11000000], ["Profit before tax", null, 1500000, 1100000], ["Tax expense", null, b.tax, a.tax], ["Profit for the year", null, 1100000, 800000]].forEach((r) => pl.addRow(r));
  wb.addWorksheet("Notes").addRow(["Note 3 Reserves and surplus", null, 2600000, 1500000]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
