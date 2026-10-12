// node make.mjs [outDir] - the payroll test company (setup.json) as Tally's XML (test data only):
//   masters.xml   the company's payroll switches, the ledgers, the pay heads (PAYTYPE, PAYSTATTYPE, ITCOMPONENT), the employee
//                 group, the employees (PAN, joining and leaving dates, designation; a bank account, IFSC and an Aadhaar-like
//                 number as a real employee master has them, which FinCom must never read), a cost centre not for payroll
//   vouchers.xml  each month's payroll (Tally's PaySlip form: CATEGORYENTRY / EMPLOYEEENTRIES / PAYHEADALLOCATIONS), the
//                 salary paid to each employee (BANKALLOCATIONS with BANKEMPLOYEENAME, and the account, IFSC and name in
//                 favour FinCom must never keep), the month's salary TDS paid (Stat Payment of Income Tax with its challan)
//   daybook.xml   the same entries as Tally's Day Book export gives them (each with a GUID and an AlterID), for the Linux test
// The real-Tally gate (tally-versions mode payg) imports masters.xml and vouchers.xml into a throwaway company; the Linux test
// (tests/run_e2e_payroll.py) reads daybook.xml as the cloud does.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || HERE;
const S = JSON.parse(fs.readFileSync(path.join(HERE, "setup.json"), "utf8"));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const m2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
const HEAD = Object.fromEntries(S.payHeads.map((h) => [h[0], h]));
const earn = (k) => HEAD[k][5] === "earn";

// ---- masters
let M = "";
M += `<COMPANY NAME="${esc(S.company)}" ACTION="Alter"><NAME>${esc(S.company)}</NAME><ISPAYROLLON>Yes</ISPAYROLLON><ISPAYROLLSTATON>Yes</ISPAYROLLSTATON><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON></COMPANY>`;
for (const [n, p] of [[S.payable, "Current Liabilities"], [S.bank, "Bank Accounts"]]) M += `<LEDGER NAME="${esc(n)}" ACTION="Create"><NAME.LIST><NAME>${esc(n)}</NAME></NAME.LIST><PARENT>${esc(p)}</PARENT></LEDGER>`;
for (const h of S.payHeads) {
  M += `<LEDGER NAME="${esc(h[0])}" ACTION="Create"><NAME.LIST><NAME>${esc(h[0])}</NAME></NAME.LIST><PARENT>${esc(h[1])}</PARENT><PAYTYPE>${esc(h[2])}</PAYTYPE><FORPAYROLL>Yes</FORPAYROLL>` +
    `<AFFECTSNETSALARY>Yes</AFFECTSNETSALARY><CALCULATIONTYPE>As User Defined Value</CALCULATIONTYPE><ISCOSTCENTRESON>Yes</ISCOSTCENTRESON>` +
    (h[3] ? `<PAYSTATTYPE>${esc(h[3])}</PAYSTATTYPE>` : "") + (h[4] ? `<ITCOMPONENT>${esc(h[4])}</ITCOMPONENT>` : "") + `</LEDGER>`;
}
M += `<COSTCENTRE NAME="${esc(S.group)}" ACTION="Create"><NAME.LIST><NAME>${esc(S.group)}</NAME></NAME.LIST><PARENT/><CATEGORY>${esc(S.category)}</CATEGORY><ISEMPLOYEEGROUP>Yes</ISEMPLOYEEGROUP><FORPAYROLL>Yes</FORPAYROLL></COSTCENTRE>`;
S.employees.forEach((e, i) => {
  M += `<COSTCENTRE NAME="${esc(e[0])}" ACTION="Create"><NAME.LIST><NAME>${esc(e[0])}</NAME></NAME.LIST><PARENT>${esc(S.group)}</PARENT><CATEGORY>${esc(S.category)}</CATEGORY>` +
    `<FORPAYROLL>Yes</FORPAYROLL><DATEOFJOIN>${e[2]}</DATEOFJOIN>` + (e[3] ? `<DEACTIVATIONDATE>${e[3]}</DEACTIVATIONDATE>` : "") +
    (e[1] ? `<PANNUMBER>${e[1]}</PANNUMBER>` : "") + `<DESIGNATION>${esc(e[4])}</DESIGNATION>` +
    `<BANKACCOUNTNUMBER>5099000000${String(i + 1).padStart(2, "0")}</BANKACCOUNTNUMBER><IFSCODE>HDFC00099${String(i + 1).padStart(2, "0")}</IFSCODE><AADHARNUMBER>9999888877${String(i + 1).padStart(2, "0")}</AADHARNUMBER>` +
    `</COSTCENTRE>`;
});
for (const o of S.other) M += `<COSTCENTRE NAME="${esc(o)}" ACTION="Create"><NAME.LIST><NAME>${esc(o)}</NAME></NAME.LIST><PARENT/><CATEGORY>${esc(S.category)}</CATEGORY><FORPAYROLL>No</FORPAYROLL></COSTCENTRE>`;

// ---- entries (n: a running number, for the Day Book's GUID and AlterID)
let n = 0;
const ids = (dayBook) => { n++; return dayBook ? `<GUID>pe-guid-${String(n).padStart(4, "0")}</GUID><ALTERID> ${100 + n}</ALTERID><MASTERID> ${n}</MASTERID>` : ""; };
function payroll(p, dayBook) {
  let ce = "", tot = 0;
  p.rows.forEach((r, i) => {
    let pa = "", ea = 0, so = 0;
    for (const [k, v] of Object.entries(r.heads)) {
      if (!v) continue;
      so++;
      const a = earn(k) ? -v : v; ea += a;
      pa += `<PAYHEADALLOCATIONS.LIST><PAYHEADNAME>${esc(k)}</PAYHEADNAME><ISDEEMEDPOSITIVE>${earn(k) ? "Yes" : "No"}</ISDEEMEDPOSITIVE><PAYHEADSORTORDER>${so}</PAYHEADSORTORDER><AMOUNT>${m2(a)}</AMOUNT></PAYHEADALLOCATIONS.LIST>`;
    }
    tot += ea;
    ce += `<EMPLOYEEENTRIES.LIST><EMPLOYEENAME>${esc(r.employee)}</EMPLOYEENAME><EMPLOYEESORTORDER>${i + 1}</EMPLOYEESORTORDER><AMOUNT>${m2(ea)}</AMOUNT>${pa}</EMPLOYEEENTRIES.LIST>`;
  });
  return `<VOUCHER VCHTYPE="Payroll" ACTION="Create" OBJVIEW="PaySlip Voucher View"><DATE>${p.date}</DATE><EFFECTIVEDATE>${p.date}</EFFECTIVEDATE>${ids(dayBook)}<VOUCHERTYPENAME>Payroll</VOUCHERTYPENAME>` +
    `<VOUCHERNUMBER>${p.no}</VOUCHERNUMBER><PARTYLEDGERNAME>${esc(S.payable)}</PARTYLEDGERNAME><PERSISTEDVIEW>PaySlip Voucher View</PERSISTEDVIEW><ASPAYSLIP>Yes</ASPAYSLIP><VCHENTRYMODE>Payslip</VCHENTRYMODE>` +
    `<NARRATION>${p.no} payroll (payroll e2e test data)</NARRATION>` +
    `<LEDGERENTRIES.LIST><LEDGERNAME>${esc(S.payable)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>${m2(-tot)}</AMOUNT></LEDGERENTRIES.LIST>` +
    `<CATEGORYENTRY.LIST><CATEGORY>${esc(S.category)}</CATEGORY>${ce}</CATEGORYENTRY.LIST></VOUCHER>`;
}
function salary(s, dayBook) {
  const tot = s.rows.reduce((a, r) => a + r[1], 0);
  let bk = "";
  s.rows.forEach(([e, a], i) => {
    const k = S.employees.findIndex((x) => x[0] === e) + 1;
    bk += `<BANKALLOCATIONS.LIST><DATE>${s.date}</DATE><INSTRUMENTDATE>${s.date}</INSTRUMENTDATE><NAME>${s.no}-${i + 1}</NAME><TRANSACTIONTYPE>Inter Bank Transfer</TRANSACTIONTYPE>` +
      `<BANKEMPLOYEENAME>${esc(e)}</BANKEMPLOYEENAME><PAYMENTFAVOURING>${esc(e)}</PAYMENTFAVOURING><ACCOUNTNUMBER>5099000000${String(k).padStart(2, "0")}</ACCOUNTNUMBER><IFSCODE>HDFC00099${String(k).padStart(2, "0")}</IFSCODE>` +
      `<BANKNAME>HDFC Bank Ltd</BANKNAME><AMOUNT>${m2(a)}</AMOUNT></BANKALLOCATIONS.LIST>`;
  });
  return `<VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${s.date}</DATE><EFFECTIVEDATE>${s.date}</EFFECTIVEDATE>${ids(dayBook)}<VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>` +
    `<VOUCHERNUMBER>${s.no}</VOUCHERNUMBER><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><NARRATION>${s.no} salary paid (payroll e2e test data)</NARRATION>` +
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(S.payable)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${m2(-tot)}</AMOUNT></ALLLEDGERENTRIES.LIST>` +
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(s.bank)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${m2(tot)}</AMOUNT>${bk}</ALLLEDGERENTRIES.LIST></VOUCHER>`;
}
function tds(c, dayBook) {
  if (!c.tax) return "";
  return `<VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${c.date}</DATE><EFFECTIVEDATE>${c.date}</EFFECTIVEDATE>${ids(dayBook)}<VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>` +
    `<VOUCHERNUMBER>${c.no}</VOUCHERNUMBER><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><NARRATION>${c.no} TDS on salary (payroll e2e test data)</NARRATION>` +
    `<STATPAYMENTTYPE>Income Tax</STATPAYMENTTYPE><TAXPAYPERIODFROMDATE>${c.from}</TAXPAYPERIODFROMDATE><TDSSECTIONNO>192</TDSSECTIONNO>` +
    `<TAXCHALLANBSRCODE>${c.bsr}</TAXCHALLANBSRCODE><TAXBANKCHALLANNUMBER>${c.challan}</TAXBANKCHALLANNUMBER><TAXCHALLANDATE>${c.challanDate}</TAXCHALLANDATE><TAXBANKNAME>HDFC Bank Ltd</TAXBANKNAME>` +
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>PE Income Tax</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${m2(-c.tax)}</AMOUNT><TYPEOFTAXPAYMENT>Tax</TYPEOFTAXPAYMENT></ALLLEDGERENTRIES.LIST>` +
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(S.bank)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${m2(c.tax)}</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`;
}
const order = [];
S.payrolls.forEach((p, i) => { order.push(["p", p]); order.push(["s", S.salaryPayments[i]]); order.push(["t", S.tdsPayments[i]]); });
const one = (k, x, db) => (k === "p" ? payroll(x, db) : k === "s" ? salary(x, db) : tds(x, db));
const V = order.map(([k, x]) => one(k, x, false)).join("");
n = 0;
const DB = order.map(([k, x]) => one(k, x, true)).filter(Boolean).map((v) => "<TALLYMESSAGE>" + v + "</TALLYMESSAGE>").join("");
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "masters.xml"), M);
fs.writeFileSync(path.join(OUT, "vouchers.xml"), V);
fs.writeFileSync(path.join(OUT, "daybook.xml"), "<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>" + DB + "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>");
console.log("masters", M.length, "vouchers", V.length, "day book", DB.length);
