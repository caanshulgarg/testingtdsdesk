// node tests/run_payroll_flex.mjs - flexible payroll (next-payroll, docs/PAYROLL.md) on made-up sheets in four layouts:
//   1. the first upload of a layout: the AI is asked once (the header and at most 3 masked rows), the owner's confirmed
//      mapping saved as the client's rule; the next upload of that layout is read by the rule, the AI never called (mocked
//      to fail if it is); a changed layout asks the AI again; another client's rule is not this client's
//   2. the four layouts read to the paisa (quoted Indian amounts, a title row, a Grand Total row, Date of Birth / Joining
//      never the month, a month given by the owner, other deductions, "Rs." amounts and a pay date)
//   3. the checks: gross = earnings, gross = net + deductions, an employee twice, manual entry's running totals
//   4. how the company books salary, detected from the books
//   5. the journal: the same entry as Daily Check's existing builder (payrollOne) on the same figures
//   6. the Tally Payroll voucher: built, then checked against the spec (docs/PAYROLL.md 4.1); the bridge's test copy
//      (tests/fixtures/payroll_voucher.xml, in docs/PAYROLL.md) is exactly what the builder makes
//   7. the server's half (server/assistant/sheetmap.ts): 3 rows at most, the answer checked
import fs from "node:fs";
import * as PS from "../app/src/lib/payrollSheet.js";
import * as TP from "../app/src/lib/tallyPayroll.js";
import * as J from "../server/_shared/dailyjournals.js";
import { booksOf, nightInput } from "../server/assistant-night/nightinput.js";
import { gstRows } from "./daily2_books.mjs";
import { A, A_NOV, A_CHANGED, B, C, D, AI_ANSWERS } from "./payroll_sheets.mjs";

let fails = 0, n = 0;
const ok = (c, w) => { n++; console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const P = (x) => Math.round((Number(x) || 0) * 100);

// the mocked AI (SheetAI.map's place): answers by the header, records every call
const calls = [];
const ai = async (req) => {
  calls.push(req);
  const key = Object.keys(AI_ANSWERS).find((k) => { const h = PS.headRow(PS.parseCsv({ A, A_CHANGED, B, C, D }[k])); return JSON.stringify(PS.parseCsv({ A, A_CHANGED, B, C, D }[k])[h]) === JSON.stringify(req.head); });
  if (!key) throw new Error("the mock has no answer for this header");
  return AI_ANSWERS[key];
};
const never = async () => { throw new Error("the AI was called for a layout the rule knows"); };
// the page's flow, as the panel runs it: a known layout by its rule; a new one asks the AI, the owner confirms, saved
async function upload(text, rules, aiFn, o = {}) {
  const grid = PS.parseCsv(text), hi = PS.headRow(grid), head = grid[hi];
  let rule = PS.findRule(head, "", rules), how = "rule";
  if (!rule) {
    const m = await PS.propose(head, grid.slice(hi + 1), aiFn);
    rule = PS.makeRule(head, "", m, { by: "owner@example.test", at: "2026-11-22T10:00:00Z" });
    rules.push(rule); how = "ai";
  }
  return Object.assign({ how, rule }, PS.apply(rule, grid, hi, o));
}

console.log("1. the mapping: AI once, saved as the client's rule, then the rule alone");
const rules = [], rulesB = [];
{
  const a = await upload(A, rules, ai);
  ok(a.how === "ai" && calls.length === 1, "first upload of a new layout: the AI is asked once");
  const sent = calls[0];
  ok(sent.side === "payroll" && sent.rows.length <= 3 && sent.head.includes("Gross Salary"), "the AI is sent the header and at most 3 rows (" + sent.rows.length + ")");
  const flat = JSON.stringify(sent.rows);
  ok(!/Ravi|Asha|Mehta|ABCPK1234F|E001/.test(flat) && /TEXT_1/.test(flat) && /PAN_1/.test(flat) && /CODE_1/.test(flat), "names, PANs and codes masked; figures kept (" + sent.rows[0].slice(0, 5).join(" | ") + ")");
  ok(!/Grand Total/.test(flat) && !/Salary Register/.test(flat), "the title row and the total row are never sent");
  ok(rules.length === 1 && rules[0].fp === PS.fingerprint(PS.parseCsv(A)[1], "") && rules[0].map.gross === "grosssalary" && rules[0].earn.length === 3, "saved as a rule keyed by the header's fingerprint");
  ok(a.rows.length === 3 && a.skipped.some((s) => s.why === "a total row"), "3 employees read, the Grand Total row skipped");
  const r1 = a.rows[0], r3 = a.rows[2];
  ok(r1.gross === 50000 && r1.tds === 2500 && r1.profTax === 200 && r1.pf === 1800 && r1.pfEr === 1800 && r1.net === 45500 && r1.earn.HRA === 10000 && r1.month === "202610", "Ravi Kumar: quoted Indian amounts, every head, the month");
  ok(r3.name === "Mehta, Sunil" && r3.gross === 10838.71 && r3.esi === 82 && r3.esiEr === 353 && r3.days === 14, "a quoted name with a comma; paise kept; ESI employee and employer apart");
  const nov = await upload(A_NOV, rules, never);
  ok(nov.how === "rule" && calls.length === 1 && nov.rows.length === 2 && nov.months.join() === "202611", "next upload, same layout, other employees and month: read by the rule, the AI not called");
  const ch = await upload(A_CHANGED, rules, ai);
  ok(ch.how === "ai" && calls.length === 2 && rules.length === 2 && ch.rows[0].earn.Bonus === undefined && ch.rows[0].gross === 50000, "a changed layout (a Bonus column added): the AI is asked again, a second rule");
  let threw = "";
  try { await upload(A, rulesB, never); } catch (e) { threw = e.message; }
  ok(/AI was called/.test(threw), "another client's rules are its own: client B's first upload of layout A is new to B");
  ok(PS.findRule(PS.parseCsv(A)[1], "Sheet1", rules) === null, "the fingerprint includes the sheet's name: an Excel of the same columns is its own layout");
  let noAi = ""; try { await PS.propose(PS.parseCsv(B)[0], [], null); } catch (e) { noAi = e.message; }
  ok(/map the columns yourself/.test(noAi), "no AI here: the owner maps by hand (guess offers what the names say)");
}

console.log("2. four layouts to the paisa");
{
  const b = await upload(B, rules, ai);
  ok(b.rows.length === 3 && b.rows.every((r) => r.month === "202610") && b.rows[0].net === 38600 && b.skipped.length === 1, "B: the Salary Month, never the Date of Birth or Joining; the Total row skipped");
  const g = PS.guess(PS.parseCsv(B)[0]);
  ok(g.map.month === "salarymonth" && !g.map.date && g.map.gross === "gross" && g.map.tds === "incometax" && g.map.pt === "ptax", "B by names only: Date of Birth / Joining are not taken as the pay date");
  const c = await upload(C, rules, ai, { month: "202610" });
  ok(c.rows.length === 2 && c.rows[0].gross === 16600 && c.rows[0].ded["Advance Recovery"] === 2000 && c.rows[0].otherDed === 2000 && c.rows[0].net === 12675 && c.rows[0].month === "202610", "C: tab-separated, gross from the earnings heads, an advance recovered, the month the owner gave");
  const d = await upload(D, rules, ai);
  ok(d.rows.length === 2 && d.rows[0].gross === 36500 && d.rows[0].pf === 1800 && d.rows[0].month === "202610" && d.rows[0].pan === "DEFPS4567J", "D: semicolons, Rs. amounts, the month from the pay date 31/10/2026");
  ok(calls.length === 5 && rules.length === 5, "each new layout asked the AI once (5 layouts, 5 calls)");
  const again = await upload(C, rules, never, { month: "202611" });
  ok(again.how === "rule" && again.rows[0].month === "202611", "C again: the rule, the AI not called");
  ok(PS.amount("(1,234.50)") === -1234.5 && PS.amount("1,23,456.00") === 123456 && PS.amount("-") === 0 && PS.amount("₹ 2,000") === 2000 && PS.amount("12.5.3") === 0, "amounts: brackets, Indian commas, a dash, the rupee sign, nonsense as nothing");
  ok(PS.monthOf("Oct-2026") === "202610" && PS.monthOf("October 2026") === "202610" && PS.monthOf("10/2026") === "202610" && PS.monthOf("31/10/2026") === "202610" && PS.monthOf(46326) === "202610", "months: Oct-2026, October 2026, 10/2026, 31/10/2026, an Excel date");
}

console.log("3. the checks");
{
  const grid = PS.parseCsv(A), rule = rules[0];
  const good = PS.apply(rule, grid, 1).rows, cg = PS.check(good);
  ok(cg.ok && cg.tot.gross === 85838.71 && cg.tot.net === 78255.71 && cg.tot.pf === 4413 && cg.tot.pfEr === 4413, "the sheet adds up: gross ₹85,838.71 = net ₹78,255.71 + deductions; the employer's PF apart");
  const off = good.map((r, i) => i === 1 ? Object.assign({}, r, { net: 22812.01 }) : r), co = PS.check(off);
  ok(!co.ok && co.bad[0].name === "Asha Verma" && /is not net/.test(co.bad[0].why[0]), "a paisa out: that employee is named, gross is not net + deductions");
  const earn = good.map((r, i) => i === 0 ? Object.assign({}, r, { earn: Object.assign({}, r.earn, { HRA: 9000 }) }) : r);
  ok(!PS.check(earn).ok && /earnings/.test(PS.check(earn).bad[0].why[0]), "earnings that are not the gross: refused");
  ok(/twice/.test(PS.check(good.concat([good[0]])).bad[0].why[0]), "an employee twice: refused");
  ok(!PS.check(good.concat(PS.apply(rules[1], PS.parseCsv(A_NOV), 1).rows)).ok, "two months in one sheet: refused");
  // manual entry: rows typed one by one, running totals
  const heads = { earn: ["Basic", "HRA"], ded: ["Advance"] };
  const t1 = PS.typedRow({ name: "Typed One", days: "31", earn: { Basic: "20,000", HRA: "8,000" }, tds: "1,000", pt: "200", pf: "1,800" }, "202610", heads);
  const t2 = PS.typedRow({ name: "Typed Two", earn: { Basic: "10000" }, ded: { Advance: "500" }, pt: "200", net: "9,300" }, "202610", heads);
  const ct = PS.check([t1, t2]);
  ok(t1.gross === 28000 && t1.net === 25000 && t2.net === 9300 && ct.ok && ct.tot.gross === 38000 && ct.tot.net === 34300 && ct.tot.other === 500, "manual entry: gross from the heads, net worked out or typed; totals ₹38,000 / ₹34,300");
  const t3 = PS.typedRow({ name: "Typed Three", earn: { Basic: "10000" }, net: "9,999" }, "202610", heads);
  ok(!PS.check([t1, t3]).ok && PS.check([t1, t3]).bad[0].name === "Typed Three", "a typed net that is not gross − deductions: that row is marked");
}

console.log("4. how the company books salary");
{
  ok(PS.detectMethod({ payroll: { employees: [{ name: "E", group: false }], allocs: [{ guid: "g1" }] } }).value === "tally", "payroll entries with pay heads in Tally: Tally Payroll");
  ok(PS.detectMethod({ payroll: { employees: [{ name: "E" }, { name: "F" }], allocs: [] } }).value === "tally", "employee masters, no payroll entry yet: Tally Payroll");
  ok(PS.detectMethod({ vouchers: [{ type: "Journal", ent: [{ l: "Salary", a: -50000 }, { l: "Salary Payable", a: 50000 }] }] }).value === "journal", "salary journals and no payroll: Journal");
  ok(PS.detectMethod({ vouchers: [{ type: "Payroll", ent: [] }] }).value === "tally", "a voucher of Tally's Payroll type: Tally Payroll");
  const none = PS.detectMethod({});
  ok(none.value === "" && !none.sure, "nothing in the books: not guessed, the owner is asked");
  ok(PS.methodOf({ payrollMethod: { value: "tally" } }) === "tally" && PS.methodOf({}) === "", "the setting kept on the client wins; unset is unset");
}

console.log("5. the journal: the existing builder's, on the same figures");
{
  const PL = { "Salary": "Indirect Expenses", "TDS on Salary 192": "Duties & Taxes", "Professional Tax Payable": "Duties & Taxes", "Salary Payable": "Provisions", "PF Payable": "Duties & Taxes", "ESI Payable": "Duties & Taxes" };
  const night = (sheet) => { const rw = gstRows({ ym: "202610", filed: "", extraLedgers: PL, items: [{ key: "salary", item: "", ord: 0, data: sheet, deleted: false }] }); const b = booksOf(rw);
    const inp = nightInput(rw, b, { today: "20261122", bankRecs: [], inboxRecs: [], entryRecs: [], twob: [], gst: [], prior: [], jobs: {}, draftRecs: [] }); return J.journals(inp).entries.find((e) => e.source === "payroll"); };
  const read = PS.apply(rules[0], PS.parseCsv(A), 1).rows, br = PS.builderRows(read);
  // the same employees as the existing reader keeps them (TDS24Q's shape: name, date, gross, tds, profTax, pf, esi, net)
  const hand = [{ name: "Ravi Kumar", date: "2026-10-31", gross: 50000, tds: 2500, profTax: 200, pf: 1800, esi: 0, net: 45500 }, { name: "Asha Verma", date: "2026-10-31", gross: 25000, tds: 0, profTax: 200, pf: 1800, esi: 188, net: 22812 },
    { name: "Mehta, Sunil", date: "2026-10-31", gross: 10838.71, tds: 0, profTax: 0, pf: 813, esi: 82, net: 9943.71 }];
  const e1 = night(br.rows), e0 = night(hand);
  ok(e1 && e0 && e1.ready && JSON.stringify(e1.voucher) === JSON.stringify(e0.voucher) && e1.dedupe === e0.dedupe, "layout A through the new reader: the very journal the existing builder makes (" + (e1 ? e1.voucher.lines.map((l) => l.ledger + " " + (l.dr || -l.cr)).join(", ") : "none") + ")");
  ok(e1 && e1.voucher.lines.find((l) => l.ledger === "Salary").dr === 85838.71 && e1.voucher.lines.find((l) => l.ledger === "Salary Payable").cr === 78255.71, "Dr Salary ₹85,838.71, Cr Salary Payable ₹78,255.71 (the employer's PF is not in it)");
  const bb = PS.builderRows(PS.apply(rules.find((r) => r.labels.includes("Name of Employee")), PS.parseCsv(B), 0).rows), eb = night(bb.rows);
  ok(eb && eb.ready && eb.voucher.lines.find((l) => /TDS/.test(l.ledger)).cr === 1200, "layout B: a ready journal, TDS ₹1,200");
  const bc = PS.builderRows(PS.apply(rules.find((r) => r.labels.includes("Staff")), PS.parseCsv(C), 0, { month: "202610" }).rows);
  ok(!bc.rows && /Advance Recovery/.test(bc.why), "layout C (an advance recovered): no journal, said why (book by hand, or Tally Payroll)");
}

console.log("6. the Tally Payroll voucher, against the spec");
{
  const read = PS.apply(rules[0], PS.parseCsv(A), 1).rows;
  const heads = { "Basic Pay": { type: "Earnings for Employees" }, "HRA": { type: "Earnings for Employees" }, "Special Allowance": { type: "Earnings for Employees" }, "Income Tax": { type: "Deductions from Employees", stat: "Income Tax" },
    "Professional Tax": { type: "Deductions from Employees", stat: "Professional Tax" }, "PF Employee 12%": { type: "Employees' Statutory Deductions", stat: "PF Account (A/c No. 1)" },
    "ESI Employee": { type: "Employees' Statutory Deductions", stat: "Employee State Insurance" }, "PF Employer": { type: "Employer's Statutory Contributions" } };
  const plan0 = TP.payHeadPlan(read, heads, {});
  ok(plan0.plan.tds === "Income Tax" && plan0.plan.pfEmp === "PF Employee 12%" && plan0.plan.esiEmp === "ESI Employee" && plan0.plan["earn:HRA"] === "HRA" && plan0.missing.join() === "earn:Basic", "pay heads matched by name or statutory kind (never the employer's PF); Basic has no same-named pay head: asked");
  const plan = TP.payHeadPlan(read, heads, { "earn:Basic": "Basic Pay" }).plan;
  const emps = ["Ravi Kumar", "Asha Verma", "Mehta, Sunil"].map((name) => ({ name }));
  const o = { id: "dc-pay-202610", date: "2026-10-31", label: "Oct 2026", payable: "Salary Payable", rows: read, plan, employees: emps };
  const { vouchers, problems } = TP.payrollVouchers(o);
  ok(!problems.length && vouchers.length === 1 && vouchers[0].net === 78255.71 && vouchers[0].employees[0].amount === -45500, "one voucher: net ₹78,255.71 to Salary Payable; each employee's amount is minus their net");
  const x = TP.payrollVoucherXml(vouchers[0]);
  ok(TP.validatePayrollXml(x).length === 0, "the XML is the spec's shape (validated): " + (TP.validatePayrollXml(x)[0] || "ok"));
  ok(/<PAYHEADNAME>Basic Pay<\/PAYHEADNAME>\n<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\n<AMOUNT>-25000.00<\/AMOUNT>/.test(x) && /<PAYHEADNAME>Income Tax<\/PAYHEADNAME>\n<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\n<AMOUNT>2500.00<\/AMOUNT>/.test(x), "earnings negative (Yes), deductions positive (No)");
  ok(!/PF Employer/.test(x) && !/1166|4413/.test(x), "the employer's contributions are not in the employee's pay voucher");
  ok(/TDSDesk:dc-pay-202610/.test(x) && /Mehta, Sunil/.test(x), "FinCom's id in the narration; names as Tally has them");
  const tamper = [[x.replace("<AMOUNT>-45500.00</AMOUNT>", "<AMOUNT>-45400.00</AMOUNT>"), "an employee's amount not the sum"], [x.replace("</CATEGORYENTRY.LIST>\n", "</CATEGORYENTRY.LIST>\n<ALLLEDGERENTRIES.LIST>\n<LEDGERNAME>Salary</LEDGERNAME>\n<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n<AMOUNT>-1.00</AMOUNT>\n</ALLLEDGERENTRIES.LIST>\n"), "a ledger line more"],
    [x.replace("<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n<AMOUNT>-25000.00", "<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n<AMOUNT>-25000.00"), "the wrong sign"], [x.replace("<NARRATION>", "<UDF:X>1</UDF:X>\n<NARRATION>"), "an extra tag"],
    [x.replace('ACTION="Create"', 'ACTION="Alter"'), "an Alter"], [x + x, "two vouchers"], [x.replace("<DATE>20261031</DATE>", "<DATE>20261131</DATE>"), "no such date"]];
  tamper.forEach(([y, w]) => ok(TP.validatePayrollXml(y).length === 1, "refused by the spec: " + w));
  const many = Array.from({ length: 230 }, (_, i) => ({ name: "Made Up " + i, month: "202610", date: "2026-10-31", gross: 10000, tds: 0, profTax: 200, pf: 0, esi: 0, net: 9800, earn: {}, ded: {} }));
  const mv = TP.payrollVouchers({ id: "dc-big", date: "2026-10-31", label: "Oct 2026", payable: "Salary Payable", rows: many, plan: { gross: "Basic Pay", pt: "Professional Tax" }, employees: many.map((r) => ({ name: r.name })) });
  ok(mv.vouchers.length === 3 && mv.vouchers.every((v) => v.employees.length <= TP.MAX_EMPLOYEES && TP.validatePayrollXml(TP.payrollVoucherXml(v)).length === 0) && mv.vouchers[2].id === "dc-big-3", "230 employees: 3 vouchers of at most 100 (the 2-second rule), each valid");
  const miss = TP.payrollVouchers(Object.assign({}, o, { employees: emps.slice(0, 2) }));
  ok(!miss.vouchers.length && /Create the employee “Mehta, Sunil” in Tally/.test(miss.problems[0]), "an employee Tally does not have: the owner is asked; no master is created");
  const fixture = new URL("./fixtures/payroll_voucher.xml", import.meta.url);
  if (process.env.WRITE_FIXTURE) fs.writeFileSync(fixture, x);
  ok(fs.existsSync(fixture) && fs.readFileSync(fixture, "utf8") === x, "the spec's worked example (tests/fixtures/payroll_voucher.xml, quoted in docs/PAYROLL.md) is exactly the builder's output");
}

console.log("7. the server's half (sheetmap.ts)");
{
  let S = null;
  try { S = await import("../server/assistant/sheetmap.ts"); } catch (e) { console.log("  (skipped: this Node cannot read TypeScript: " + e.message.slice(0, 60) + ")"); }
  if (S) {
    const head = PS.parseCsv(A)[1], p = S.payrollPrompt(head, [["a"], ["b"], ["c"], ["d"], ["e"]]);
    ok(p.split("\n").length === 3 + 3, "the prompt carries at most 3 rows");
    const m = S.parsePayrollMap(JSON.stringify({ map: { name: "Employee Name", gross: "Gross Salary", net: "Not A Column", tds: "Employee Name" }, earn: ["Basic", "Gross Salary", "HRA"], ded: ["Nope"] }), head);
    ok(m.map.name === "Employee Name" && !m.map.net && !m.map.tds && m.earn.join() === "Basic,HRA" && !m.ded.length, "the answer checked: only the sheet's headers, a column in one place");
  }
}

console.log((fails ? fails + " FAILED" : "all " + n + " passed"));
process.exit(fails ? 1 : 0);
