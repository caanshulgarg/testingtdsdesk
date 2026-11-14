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

// ---------------------------------------------------------------- the layouts of 14-Nov-2026 (made up: names and figures)
// A bank-style CMA in crores: sheets "PNL", "Asset", "Liability" (and the CMA's own checks "Valid", "KFI", "MPBF"), its
// columns headed by bare years as numbers (2023 = the year 2022-23) over "Audited" / "Prov." / "Proj."; a heading over
// three rows above "(i.) From banks" / "(ii) From others"; a line ending ":" followed by its parts; "(a)"/"(b)" parts of
// the line above; "Others (specify)" then its part; the change in stock printed beside the opening and closing stock;
// "PBT/Sales" under the profit. FY 2022-23 to 2024-25 audited, 2025-26 provisional, 2026-27 projected (the last two copy
// 2024-25's figures).
export async function bankCmaXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const hdr = (ws: ExcelJS.Worksheet, title: string) => {
    ws.addRow([]); ws.addRow([null, "Name of Company", "Kestrel Widgets Private Limited"]); ws.addRow([null, "Unit", "Rs. In Crore"]); ws.addRow([null, "Statement", title]); ws.addRow([]);
    ws.addRow([null, "Financial Year", 2023, 2024, 2025, 2026, 2027]); ws.addRow([null, "Particulars", "Audited", "Audited", "Audited", "Prov.", "Proj."]);
  };
  const y = (a: number, b: number, c: number) => [a, b, c, c, c];
  const row = (ws: ExcelJS.Worksheet, label: string, v?: (number | null)[]) => ws.addRow([null, label, ...(v || [])]);
  const pl = wb.addWorksheet("PNL"); hdr(pl, "Profit & Loss Statement");
  const P: [string, (number | null)[]?][] = [
    ["Revenue from operations:"], ["i) Sales - Domestic", y(5, 6, 7)], ["Total Revenue", y(5, 6, 7)], ["Net sales ( item 1 - item 2 )", y(5, 6, 7)], ["% age rise (+) or fall (-) in net Sales", [null, 0.2, 0.17, 0, 0]],
    ["Raw materials (including stores and other", y(3, 3.7, 4.4)], ["items used in the process of manufacture)", y(0.6, 0.62, 0.63)], ["Salaries & Wages", y(0.5, 0.6, 0.7)], ["Marketing Expense", y(0.1, 0.12, 0.14)], ["Rent", y(0.2, 0.24, 0.26)],
    ["SUB TOTAL (I TO VI)", y(3.8, 4.66, 5.5)], ["Deduct : Changes in inventory", y(-0.2, -0.3, -0.2)], ["Add: Opening Raw Material", y(1, 1.2, 1.5)], ["Less: Closing Raw Material", y(1.2, 1.5, 1.7)], ["Cost of Production", y(3.6, 4.36, 5.3)],
    ["Selling general & administrtive expenses", y(0.6, 0.7, 0.8)], ["EBITDA", y(0.8, 0.94, 0.9)], ["EBITDA Margin (%)", y(0.16, 0.16, 0.13)], ["Less: Depreciation", y(0.05, 0.06, 0.07)], ["EBIT", y(0.75, 0.88, 0.83)],
    ["Interest Expense", y(0.15, 0.2, 0.25)], ["Operating profit after interest (8-9)", y(0.6, 0.68, 0.58)], ["Add other non-operating income"], ["(a) Interest Received", y(0.02, 0.03, 0.02)], ["(i) Sub-total   ( income )", y(0.02, 0.03, 0.02)],
    ["Net of other non-operating income/expenses", y(0.02, 0.03, 0.02)], ["Profit before tax/loss[10+11(iii)]", y(0.62, 0.71, 0.6)], ["Provision for taxes", y(0.16, 0.18, 0.15)], ["Net profit/loss for the year ( 12-13 )", y(0.46, 0.53, 0.45)],
    ["PBT/Sales", y(0.12, 0.12, 0.09)]];
  P.forEach(([l, v]) => row(pl, l, v));
  const as = wb.addWorksheet("Asset"); hdr(as, "Asset Statement");
  const A: [string, (number | null)[]?][] = [
    ["Breakup of Current Assets:"], ["Cash and bank balances", y(0.1, 0.29, 0.46)], [" Fixed Deposits with Banks  ", y(0.05, 0.05, 0.05)], [" (i)  Receivables less than 6 months", y(1, 1.3, 1.6)], ["Inventory:", y(1.2, 1.5, 1.7)],
    ["(i)Raw materials (including stores & other items"], ["     (b) Indigenous", y(1.2, 1.5, 1.7)], ["(iii) Finished goods", y(0, 0, 0)], ["Advance to suppliers of raw materials & stores and spares", y(0.1, 0.12, 0.14)],
    ["Recoverable from revenue authorities", y(0.05, 0.06, 0.07)], ["Other Current assets ", y(0.08, 0.09, 0.1)], ["Other Loans & Advances", y(0, 0, 0)], ["Others", y(0.08, 0.09, 0.1)], ["TOTAL CURRENT ASSETS", y(2.58, 3.41, 4.12)],
    ["Fixed Assets:"], ["Gross Block(Land & Building machinery, work-in-process)", y(1, 1.1, 1.2)], ["Depreciation to date", y(0.4, 0.46, 0.53)], ["NET BLOCK", y(0.6, 0.64, 0.67)], ["OTHER NON-CURRENT ASSETS"],
    ["deposits which are not current assets"], ["Investment/bookdebts/advances/", y(0.2, 0.22, 0.24)], ["     b) Investment in other companies", y(0.05, 0.05, 0.05)], ["(iv)Others (a) Debtors> 6 months", y(0.15, 0.17, 0.19)],
    ["Deferred Tax Asset(Net)", y(0.02, 0.02, 0.02)], ["TOTAL ASSETS(34+37+41+42)", y(3.4, 4.29, 5.05)]];
  A.forEach(([l, v]) => row(as, l, v));
  const li = wb.addWorksheet("Liability"); hdr(li, "Liability Statement");
  const L: [string, (number | null)[]?][] = [
    ["CURRENT LIABILITIES"], ["Short-term borrowings from banks"], ["(including bills purchased, discounted &"], ["excess borrowing placed on repayment basis)"], ["(i.)  From banks", y(0.8, 1, 1.2)], ["(ii)  From others", y(0.05, 0.05, 0.05)],
    ["          SUB TOTAL", y(0.85, 1.05, 1.25)], ["Short term borrowings from related parties", y(0, 0, 0)], ["Sundry Creditors (Trade)", y(0.7, 0.85, 1)], ["Advance payments from customers", y(0.05, 0.06, 0.07)], ["Short term Provision ", y(0.16, 0.18, 0.15)],
    ["Statutory remittances payable", y(0.02, 0.02, 0.02)], ["Other Current Liabilities:", y(0.1, 0.12, 0.14)], ["Expenses payable", y(0.1, 0.12, 0.14)], ["TOTAL CURRENT LIABILITIES", y(1.88, 2.28, 2.63)], ["TERM    LIABILITIES"],
    ["Term loan - secured", y(0.3, 0.26, 0.22)], ["Loan - unsecured", y(0.1, 0.1, 0.1)], ["Unsecured loans from directors", y(0.05, 0.05, 0.05)], ["TOTAL TERM LIABILITIES", y(0.45, 0.41, 0.37)], ["TOTAL OUTSIDE LIABILITIES ", y(2.33, 2.69, 3)],
    ["NET WORTH"], ["Ordinary share capital", y(0.05, 0.05, 0.05)], ["Opening balance for the reserves &surplus", y(0.44, 0.91, 1.44)], ["Surplus (+) or deficit (-) in Profit & Loss Account", y(0.46, 0.53, 0.45)],
    ["Excess Provisional Income tax", y(0.01, 0, 0)], ["Others (specify)", y(0.1, 0.1, 0.1)], ["Share Premium Account", y(0.1, 0.1, 0.1)], ["Deffered Tax Liabilities", y(0.01, 0.01, 0.01)], ["NET WORTH", y(1.06, 1.59, 2.04)], ["TOTAL LIABILITIES", y(3.4, 4.29, 5.05)]];
  L.forEach(([l, v]) => row(li, l, v));
  const va = wb.addWorksheet("Valid"); va.addRow([null, "Financial Year", 2023, 2024, 2025, 2026, 2027]); va.addRow([null, "Balance Sheet  Total ASSETS", ...y(3.4, 4.29, 5.05)]); va.addRow([null, "Diff Assets- liabilities", ...y(0, 0, 0)]);
  const kf = wb.addWorksheet("KFI"); kf.addRow([null, "(Rs in Crores)"]); kf.addRow([null, "Financial Year", 2023, 2024, 2025, 2026, 2027]); kf.addRow([null, "Net Sales", ...y(5, 6, 7)]); kf.addRow([null, "Profit Before tax (PBT)", ...y(0.62, 0.71, 0.6)]);
  const mp = wb.addWorksheet("MPBF"); mp.addRow([null, "Second Method of Lending"]); mp.addRow([null, "Particulars", 2023, 2024, 2025, 2026, 2027]); mp.addRow([null, "Total Current Assets", ...y(2.58, 3.41, 4.12)]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
// the audited figures FinCom wrote for the CMA's base year (its own make_file, as it does): FY 2025-26 with 2024-25, in rupees;
// trade payables in two rows ("total outstanding dues of micro and small enterprises" / "of creditors other than …"), a bare
// "TOTAL" under a "Total liabilities" heading, the borrowings' break-up on a sheet of its own, "Profit (Loss) for the Year"
export const B25 = { rev: 70200000, oth: 200000, mat: 44000000, chg: -2000000, emp: 7000000, fin: 2500000, dep: 700000, exp: 12000000, tax: 1500000,
  share: 500000, reserves: 20100000, ltb: 3700000, stb: 12500000, tp: 10000000, ocl: 2300000, stp: 1500000, ppe: 6700000, nci: 500000, dta: 200000, inv: 17000000, tr: 17900000, cash: 5100000, stla: 2100000, oca: 1100000 };
export const B26 = { rev: 65000000, oth: 300000, mat: 42000000, chg: 1000000, emp: 7500000, fin: 3000000, dep: 800000, exp: 13000000, tax: -50000,
  share: 500000, reserves: 18150000, ltb: 4000000, stb: 14000000, tp: 11500000, ocl: 2600000, stp: 0, ppe: 6400000, nci: 500000, dta: 250000, inv: 16000000, tr: 17000000, cash: 6100000, stla: 3000000, oca: 1500000 };
export async function baseXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook(), a = B26, b = B25;
  const os = wb.addWorksheet("Operating statement - FY 2025-26");
  [["Operating statement - FY 2025-26 audited"], ["Kestrel Widgets Private Limited"], [], ["Particulars", "FY 2025-26 (Audited)", "FY 2024-25 (Audited)"], ["Income"], ["Revenue from Operations", a.rev, b.rev], ["Other Income", a.oth, b.oth],
    ["Total Income", a.rev + a.oth, b.rev + b.oth], ["Expenses"], ["Cost of Materials Consumed", a.mat, b.mat], ["Change in Inventories of finished goods, work-in-progress and stock-in-trade", a.chg, b.chg], ["Employee Benefits Expense", a.emp, b.emp],
    ["Finance Costs", a.fin, b.fin], ["Depreciation and Amortisation Expense", a.dep, b.dep], ["Other Expenses", a.exp, b.exp], ["Total Expenses", 67300000, 64200000], ["Profit"], ["Profit before Tax", -2000000, 6200000], ["Tax"],
    ["Current Tax", null, 1500000], ["Deferred Tax", -50000, null], ["Profit after tax"], ["Profit (Loss) for the Year", -1950000, 4700000], [], ["Figures as in your file; made by FinCom for the CMA."]].forEach((r) => os.addRow(r));
  const bs = wb.addWorksheet("Analysis of balance sheet - 31-Mar");
  [["Analysis of balance sheet - as at 31-Mar-2026"], ["Kestrel Widgets Private Limited"], [], ["Particulars", "31-Mar-2026 (Audited)", "31-Mar-2025 (Audited)"], ["Net worth"], ["Share Capital", a.share, b.share], ["Reserves and Surplus", a.reserves, b.reserves],
    ["Term liabilities"], ["Long-term Borrowings", a.ltb, b.ltb], ["Current liabilities"], ["Short-term Borrowings", a.stb, b.stb], ["Trade Payables"], ["total outstanding dues of micro and small enterprises", 2500000, 2000000],
    ["total outstanding dues of creditors other than micro and small enterprises", 9000000, 8000000], ["Other Current Liabilities", a.ocl, b.ocl], ["Short-term Provisions", null, b.stp], ["Total liabilities"], ["TOTAL", 50750000, 50600000],
    ["Non-current assets"], ["Property, Plant and Equipment", a.ppe, b.ppe], ["Non-current Investments", a.nci, b.nci], ["Deferred Tax Assets (Net)", a.dta, b.dta], ["Current assets"], ["Inventories", a.inv, b.inv], ["Trade Receivables", a.tr, b.tr],
    ["Cash and Bank Balances", a.cash, b.cash], ["Short-term Loans and Advances", a.stla, b.stla], ["Other Current Assets", a.oca, b.oca], ["Total assets"], ["TOTAL", 50750000, 50600000]].forEach((r) => bs.addRow(r));
  const bu = wb.addWorksheet("Borrowings break-up (₹)");
  [["Borrowings break-up (₹)"], ["Kestrel Widgets Private Limited"], [], ["Particulars", "31-Mar-2026", "31-Mar-2025"], ["Long-term borrowings (unsecured)"], ["Term loans from banks", 2500000, 2200000], ["Term loans from financial institutions", 1000000, 1000000],
    ["Loans from related parties", 500000, 500000], ["Short-term borrowings"], ["Loans repayable on demand from banks", 13800000, 12300000], ["Other loans", 200000, 200000]].forEach((r) => bu.addRow(r));
  wb.addWorksheet("Notes").addRow(["Kestrel Widgets Pvt Ltd - CMA base year FY 2025-26: note for the CMA"]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
// a five-year road map in Word: prose (a launch date, phases with years, a target that is no table's), an infrastructure
// table, then A (revenue by year, years as rows), B (the profitability, years as columns) and C (the revenue mix by vertical)
export const ROADMAP_A: [string, string, string][] = [["FY 2026–27 (Base)", "₹7.20 Cr", "—"], ["FY 2027–28", "₹9.00 Cr", "25%"], ["FY 2028–29", "₹11.00 Cr", "22%"], ["FY 2029–30", "₹13.50 Cr", "23%"], ["FY 2030–31", "₹16.50 Cr", "22%"], ["FY 2031–32", "₹20.00 Cr", "21%"]];
export const ROADMAP_B: string[][] = [["Particulars", "FY27–28", "FY28–29", "FY29–30", "FY30–31", "FY31–32"], ["Revenue", "9.00", "11.00", "13.50", "16.50", "20.00"], ["Gross Profit", "2.70", "3.41", "4.32", "5.45", "6.80"],
  ["Gross Margin", "30%", "31%", "32%", "33%", "34%"], ["EBITDA", "0.63", "0.83", "1.08", "1.49", "2.00"], ["EBITDA Margin", "7%", "7.5%", "8%", "9%", "10%"], ["Depreciation", "0.20", "0.22", "0.25", "0.28", "0.30"],
  ["Interest Cost (Assumed)", "0.30", "0.32", "0.34", "0.36", "0.38"], ["Profit Before Tax", "0.13", "0.29", "0.49", "0.85", "1.32"], ["Estimated Tax", "0.03", "0.07", "0.12", "0.21", "0.33"], ["Estimated PAT", "0.10", "0.21", "0.37", "0.63", "0.99"]];
// (blank: the tables' top-left cells left empty, as Word tables and pasted tables often have them)
export async function roadmapDocx(blank = false): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } = await import("npm:docx@9.7.2");
  const P = (t: string) => new Paragraph({ children: [new TextRun(t)] });
  const T = (rows: string[][]) => new Table({ rows: rows.map((r) => new TableRow({ children: r.map((c) => new TableCell({ children: [P(c)] })) })) });
  const doc = new Document({ sections: [{ children: [
    P("Five-Year Growth Plan & Financial Projections"), P("FY 2026–27 to FY 2031–32"), P("Company: Kestrel Widgets Private Limited. Current annual revenue: ₹7.20 crore"),
    T([["Founded", "July 2018"], ["Current annual revenue", "₹7.2 Crore"], ["Plant", "Pune"]]),
    P("Phase 1: Consolidation (FY 2027–28)"), P("Target revenue: ₹9.00 crore"), P("Phase 5: National scale (FY 2031–32)"), P("The projected revenue of ₹20 crore by FY 2031–32 reflects the company's growth ambition."),
    P("A. Revenue Growth Projection"), T([["Financial Year", "Projected Revenue", "Annual Growth"], ...ROADMAP_A]),
    P("B. Indicative Profitability Projections"), T(blank ? [["", ...ROADMAP_B[0].slice(1)], ...ROADMAP_B.slice(1)] : ROADMAP_B),
    P("C. Revenue Contribution by Business Vertical"), P("Indicative targeted revenue mix:"),
    T([[blank ? "" : "Business Vertical", "FY 2026–27", "FY 2031–32"], ["Showroom & Web Sales", "60%", "55%"], ["Contract Projects", "30%", "30%"], ["Dealer Network", "10%", "15%"], ["Total", "100%", "100%"]]),
    P("We request the bank to renew our working capital limits."),
  ] }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}
// the owner's request of 14-Nov-2026 in its shape, the figures made up (₹ crore)
export const PLAN_REQUEST = `Prepare CMA data with these projections (₹ crore):
A. Revenue growth projection:
- FY26-27 base ₹7.20 Cr
- FY27-28 ₹9.00 Cr (25%)
- FY28-29 ₹11.00 Cr (22%)
- FY29-30 ₹13.50 Cr (23%)
- FY30-31 ₹16.50 Cr (22%)
- FY31-32 ₹20.00 Cr (21%)
B. Profitability, FY27-28 to FY31-32:
- Gross margin 30/31/32/33/34%
- EBITDA margin 7/7.5/8/9/10%
- Depreciation 0.20/0.22/0.25/0.28/0.30
- Interest 0.30/0.32/0.34/0.36/0.38
- PBT, tax at ~25%, PAT
C. Revenue contribution by business vertical, from the road map.`;
// and as the owner pasted it: the road map's tables copied into the chat (tabs between the cells)
export const PLAN_PASTED = "use these sales and margins for the projections A. Revenue Growth Projection\nFinancial Year\tProjected Revenue\tAnnual Growth\n" + ROADMAP_A.map((r) => r.join("\t")).join("\n") +
  "\nB. Indicative Profitability Projections\n" + ROADMAP_B.map((r) => r.join("\t")).join("\n") + "\n\nC. Revenue Contribution by Business Vertical\nThe company intends to diversify its revenue base.";
// the profitability table pasted with its top-left cell empty (a tab first)
export const PLAN_PASTED_BLANK = "use these figures for the projections (₹ crore)\n" + ["\t" + ROADMAP_B[0].slice(1).join("\t"), ...ROADMAP_B.slice(1).map((r) => r.join("\t"))].join("\n");
