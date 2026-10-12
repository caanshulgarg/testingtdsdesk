// node run_parse_payroll.mjs - bridge 2.4.4 (the owner's decisions of 12-Oct-2026): FinCom's reader
// (server/tally-cloud/parse.js) reads a payroll the same way from the bridge's entry body and from Tally's full export (the
// Day Book's form), on Tally's real answers (TallyPrime 7.1, tally-versions run 38253610530; the bodies as bridge 2.4.4
// strips them: bridge-go/testdata/payroll244/7.1/obj-<id>-stripped.xml, written by the Go test TestPay244StrippedGolden):
//   1. each employee's amount per pay head (cost-centre allocations) from the payroll entry: the bridge's body, and now the
//      Day Book path too ("not only totals");
//   2. a salary payment: the employee paid and the amount (salpay), the same from both paths; never the account, IFSC or
//      the name in favour;
//   3. the pay heads' totals and the party's net, as before (run_payroll.py's figures unchanged);
//   4. an entry without bank allocations carries no salpay.
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { parseDay } from "../server/tally-cloud/parse.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TD = path.join(HERE, "..", "bridge-go", "testdata", "payroll244", "7.1");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const J = (x) => JSON.stringify(x);
const read = (id) => parseDay(fs.readFileSync(path.join(TD, "obj-" + id + "-stripped.xml"), "utf8")).vouchers[0];
const fullText = (f) => zlib.gunzipSync(fs.readFileSync(path.join(TD, f))).toString("utf8");
const full = (id) => parseDay(fullText("full-" + id + ".xml.gz")).vouchers[0];
const key = (c) => [c.ledger, c.cat, c.centre, c.amt].join("|");
const costSet = (v) => (v.costs || []).map(key).sort();

// 1. the payroll of November: FC Emp One Basic 50,000, HRA 20,000, Special 15,000, PF 1,800, PT 200, Income Tax 8,000; Two
// Basic 30,000 ...; Three Basic 12,000 ...
const b = read("PR-NOV"), d = full("PR-NOV");
ok(b && d, "the payroll read from both paths");
const want = ["FC Basic|Primary Cost Category|FC Emp One|-50000", "FC Basic|Primary Cost Category|FC Emp Two|-30000", "FC Basic|Primary Cost Category|FC Emp Three|-12000",
  "FC Income Tax|Primary Cost Category|FC Emp One|8000", "FC Income Tax|Primary Cost Category|FC Emp Two|2500", "FC Professional Tax|Primary Cost Category|FC Emp One|200",
  "FC HRA|Primary Cost Category|FC Emp One|-20000", "FC PF Employee|Primary Cost Category|FC Emp Three|1440", "FC ESI Employee|Primary Cost Category|FC Emp Three|141"];
for (const w of want) ok(costSet(b).includes(w), "the bridge's body: " + w);
ok(J(costSet(b)) === J(costSet(d)), "the Day Book path keeps each employee's amount per pay head, the same as the bridge's body (" + costSet(d).length + " rows)");
ok((d.costs || []).every((c) => Number.isInteger(c.n) && c.n >= 0), "each row names its line");
// the lines (each pay head's total, the party's net) as before
const tot = (v) => { const m = {}; parseDay(fs.readFileSync(path.join(TD, "obj-PR-NOV-stripped.xml"), "utf8")); return m; };
void tot;
const lines = (txt) => { const p = parseDay(txt); const m = {}; p.lines.forEach((l) => { m[l[1]] = Math.round(((m[l[1]] || 0) + l[2]) * 100) / 100; }); return m; };
const lb = lines(fs.readFileSync(path.join(TD, "obj-PR-NOV-stripped.xml"), "utf8")), ld = lines(fullText("full-PR-NOV.xml.gz"));
ok(lb["FC Basic"] === -92000 && ld["FC Basic"] === -92000 && lb["FC Income Tax"] === 10500 && ld["FC Income Tax"] === 10500, "the pay heads' totals: " + J([lb["FC Basic"], ld["FC Basic"], lb["FC Income Tax"], ld["FC Income Tax"]]));
ok(J(Object.keys(lb).sort()) === J(Object.keys(ld).sort()) && Object.keys(lb).every((k) => lb[k] === ld[k]), "the lines are the same from both paths: " + J(ld));
ok(!(d.checks || []).length, "no check failed on the Day Book path: " + J(d.checks));

// 2. the salary payment: FC Emp One 75,000, Two 45,500, Three 17,219 (the net pay), its date
const sb = read("SAL-PAY-NOV"), sd = full("SAL-PAY-NOV");
const sp = (v) => (v.salpay || []).map((r) => [r.employee, r.amt, r.date].join("|"));
ok(J(sp(sb)) === J(["FC Emp One|75000|20261202", "FC Emp Two|45500|20261202", "FC Emp Three|17219|20261202"]), "the bridge's body: the salary paid: " + J(sb.salpay));
ok(J(sp(sb)) === J(sp(sd)), "the full export reads the same salary paid: " + J(sd.salpay));
ok((sb.salpay || []).every((r) => r.ledger && Number.isInteger(r.n)), "each row names its line and ledger");
const txt = J(sb) + J(sd);
ok(!/50100123456781|HDFC0001001|ACCOUNTNUMBER|IFSC|favour/i.test(J(sb.salpay) + J(sd.salpay)), "no account number, IFSC or the name in favour in what is read");
void txt;

// 3. the salary TDS payment carries its challan as 2.4.3 read it, and no employee
const tb = read("TDS-SAL-NOV");
ok(tb && tb.tdsx && tb.tdsx.stat === "Income Tax" && tb.tdsx.section === "192" && J(tb.tdsx.challan && [tb.tdsx.challan.bsr, tb.tdsx.challan.no, tb.tdsx.challan.date]) === J(["0510308", "11223", "20261202"]),
  "the salary TDS payment (Stat Payment of Income Tax, section 192) carries its challan: " + J(tb && tb.tdsx));
ok(!(tb.salpay || []).length, "the TDS payment pays no employee");

// 4. no bank allocations: no salpay (the cloud keeps what it has)
ok(b.salpay === undefined, "the payroll entry carries no salpay");
const plain = parseDay('<VOUCHER REMOTEID="g1" VCHTYPE="Journal"><GUID>g1</GUID><DATE>20261001</DATE><ALLLEDGERENTRIES.LIST><LEDGERNAME>A</LEDGERNAME><AMOUNT>-1</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>B</LEDGERNAME><AMOUNT>1</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>').vouchers[0];
ok(plain && plain.salpay === undefined, "a plain entry carries no salpay");
const bankNoEmp = parseDay('<VOUCHER REMOTEID="g2" VCHTYPE="Payment"><GUID>g2</GUID><DATE>20261001</DATE><ALLLEDGERENTRIES.LIST><LEDGERNAME>Rent</LEDGERNAME><AMOUNT>-1</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC</LEDGERNAME><AMOUNT>1</AMOUNT><BANKALLOCATIONS.LIST><DATE>20261001</DATE><NAME>CHQ</NAME><TRANSACTIONTYPE>Cheque</TRANSACTIONTYPE></BANKALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST></VOUCHER>').vouchers[0];
ok(bankNoEmp && J(bankNoEmp.salpay) === "[]", "a payment with bank details and no employee: an empty salpay (an entry altered to pay no employee clears its rows)");

console.log(fails ? "FAIL " + fails : "ALL PASS");
process.exit(fails ? 1 : 0);
