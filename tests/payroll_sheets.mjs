// Made-up salary sheets in four layouts (next-payroll, docs/PAYROLL.md): every name, PAN, code and figure invented.
// A: a title row, then a header; quoted Indian amounts; earnings heads and a gross; PF/ESI employee and employer; a Grand
//    Total row at the end.
// B: Date of Birth and Date of Joining before the salary month (never the month); only a gross; Income Tax, P.Tax.
// C: tab-separated, no month column (the owner gives it), an advance recovered (another deduction), no gross column.
// D: semicolons, a pay date (31/10/2026), "Rs." amounts, PAN first.
export const A = [
  "Sample Traders Pvt Ltd - Salary Register for October 2026,,,,,,,,,,,,,,",
  "Emp Code,Employee Name,PAN,Days Paid,Basic,HRA,Special Allowance,Gross Salary,PF (Employee),PF (Employer),ESI (Employee),ESI (Employer),Prof Tax,TDS,Net Pay,Month",
  'E001,Ravi Kumar,ABCPK1234F,31,"25,000.00","10,000.00","15,000.00","50,000.00","1,800.00","1,800.00",0,0,200,"2,500.00","45,500.00",Oct-2026',
  'E002,Asha Verma,BCDPV2345G,31,"15,000.00","6,000.00","4,000.00","25,000.00","1,800.00","1,800.00",188,813,200,0,"22,812.00",Oct-2026',
  'E003,"Mehta, Sunil",CDEPM3456H,14,"6,774.19","2,709.68","1,354.84","10,838.71",813,813,82,353,0,0,"9,943.71",Oct-2026',
  'Grand Total,,,,"46,774.19","18,709.68","20,354.84","85,838.71","4,413.00","4,413.00",270,"1,166.00",400,"2,500.00","78,255.71",',
].join("\n");
export const A_NOV = [
  "Sample Traders Pvt Ltd - Salary Register for November 2026,,,,,,,,,,,,,,",
  "Emp Code,Employee Name,PAN,Days Paid,Basic,HRA,Special Allowance,Gross Salary,PF (Employee),PF (Employer),ESI (Employee),ESI (Employer),Prof Tax,TDS,Net Pay,Month",
  'E001,Ravi Kumar,ABCPK1234F,30,"25,000.00","10,000.00","15,000.00","50,000.00","1,800.00","1,800.00",0,0,200,"2,500.00","45,500.00",Nov-2026',
  'E002,Asha Verma,BCDPV2345G,30,"15,000.00","6,000.00","4,000.00","25,000.00","1,800.00","1,800.00",188,813,200,0,"22,812.00",Nov-2026',
  'Grand Total,,,,"40,000.00","16,000.00","19,000.00","75,000.00","3,600.00","3,600.00",188,813,400,"2,500.00","68,312.00",',
].join("\n");
// A with one column more (Bonus): a changed layout
export const A_CHANGED = A.split("\n").map((l, i) => i === 0 ? l : i === 1 ? l.replace("Special Allowance,", "Special Allowance,Bonus,") : l.replace(/^((?:[^,"]*|"[^"]*"),){7}/, (m) => m + "0,")).join("\n");
export const B = [
  "Sr,Name of Employee,Date of Birth,Date of Joining,Salary Month,Gross,Income Tax,P.Tax,Net Salary",
  "1,Kiran Rao,12/05/1990,01/04/2021,October 2026,40000,1200,200,38600",
  "2,Neha Singh,23/11/1995,15/06/2024,October 2026,32000,0,200,31800",
  "3,Imran Shaikh,02/02/1988,01/10/2026,October 2026,28000,0,200,27800",
  "Total,,,,,100000,1200,600,98200",
].join("\n");
export const C = [
  "Staff ID\tStaff\tAttendance\tBasic\tDA\tConveyance\tEPF (Employee)\tEPF (Employer)\tESIC (Employee)\tESIC (Employer)\tAdvance Recovery\tTDS\tTake Home",
  "S-11\tPooja Nair\t31\t12000\t3000\t1600\t1800\t1800\t125\t540\t2000\t0\t12675",
  "S-12\tVikram Joshi\t30\t14000\t3500\t1600\t1800\t1800\t0\t0\t0\t0\t17300",
].join("\n");
export const D = [
  "PAN No.;Employee;Earnings Total;PF;PT;Net Payable;Pay Date",
  "DEFPS4567J;Farah Siddiqui;Rs. 36,500.00;Rs. 1,800.00;Rs. 200.00;Rs. 34,500.00;31/10/2026",
  "EFGPT5678K;Tarun Bedi;Rs. 21,000.00;Rs. 1,800.00;Rs. 200.00;Rs. 19,000.00;31/10/2026",
].join("\n");
// what the (mocked) AI answers for each layout: as the cheap model would, by header text
export const AI_ANSWERS = {
  A: { map: { code: "Emp Code", name: "Employee Name", pan: "PAN", days: "Days Paid", gross: "Gross Salary", pfEmp: "PF (Employee)", pfEr: "PF (Employer)", esiEmp: "ESI (Employee)", esiEr: "ESI (Employer)", pt: "Prof Tax", tds: "TDS", net: "Net Pay", month: "Month" },
    earn: ["Basic", "HRA", "Special Allowance"], ded: [], why: { month: "from 'Month'" } },
  A_CHANGED: { map: { code: "Emp Code", name: "Employee Name", pan: "PAN", days: "Days Paid", gross: "Gross Salary", pfEmp: "PF (Employee)", pfEr: "PF (Employer)", esiEmp: "ESI (Employee)", esiEr: "ESI (Employer)", pt: "Prof Tax", tds: "TDS", net: "Net Pay", month: "Month" },
    earn: ["Basic", "HRA", "Special Allowance", "Bonus"], ded: [] },
  B: { map: { name: "Name of Employee", month: "Salary Month", gross: "Gross", tds: "Income Tax", pt: "P.Tax", net: "Net Salary" }, earn: [], ded: [] },
  C: { map: { code: "Staff ID", name: "Staff", days: "Attendance", pfEmp: "EPF (Employee)", pfEr: "EPF (Employer)", esiEmp: "ESIC (Employee)", esiEr: "ESIC (Employer)", tds: "TDS", net: "Take Home" },
    earn: ["Basic", "DA", "Conveyance"], ded: ["Advance Recovery"] },
  D: { map: { pan: "PAN No.", name: "Employee", gross: "Earnings Total", pfEmp: "PF", pt: "PT", net: "Net Payable", date: "Pay Date" }, earn: [], ded: [] },
};
