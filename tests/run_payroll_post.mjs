// node tests/run_payroll_post.mjs - Tally Payroll posting (next-payroll, docs/PAYROLL.md 4.3; bridge 2.5.18's
// FinComPayrollImport), on made-up employees only:
//   1. the builder (app/src/lib/tallyPayroll.js) against the bridge's rules as JavaScript has them: the fixture byte for
//      byte, never a REMOTEID, the text cleaned, a master's name the bridge cannot take refused in plain words, the split
//      (100 employees, the request's byte cap), each pay head once an employee, the amounts' limits
//   2. the same vouchers through the bridge's OWN Go checks (bridge-go payrollimport.go: stamped as the bridge stamps,
//      in the envelope it sends, routed, pinned): every builder output accepted, every tampered copy refused, and the
//      JavaScript rules giving the same answer each time (skipped, said so, when Go is not on this computer)
//   3. Approve (app/src/lib/payrollPost.js) with the bridge, the cloud and the drafts faked: the bridge's version, the
//      second check, the claim before any posting, one voucher a Bridge.post, the proof (Tally's created count and voucher
//      id, or its refusal in plain words), release on a refusal, a split month posted part by part, nothing twice
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as TP from "../app/src/lib/tallyPayroll.js";
import * as TPost from "../app/src/lib/payrollPost.js";

let fails = 0, n = 0;
const ok = (c, w) => { n++; console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const NBSP = String.fromCharCode(0xa0);

// the fixture's three made-up employees (tests/fixtures/payroll_voucher.xml)
const row = (name, earn, tds, pt, pf, esi) => { const gross = Object.values(earn).reduce((s, x) => s + x, 0); return { name, month: "202610", date: "2026-10-31", earn, ded: {}, gross: Math.round(gross * 100) / 100, tds, profTax: pt, pf, esi, net: Math.round((gross - tds - pt - pf - esi) * 100) / 100 }; };
const ROWS = [row("Ravi Kumar", { Basic: 25000, HRA: 10000, "Special Allowance": 15000 }, 2500, 200, 1800, 0), row("Asha Verma", { Basic: 15000, HRA: 6000, "Special Allowance": 4000 }, 0, 200, 1800, 188),
  row("Mehta, Sunil", { Basic: 6774.19, HRA: 2709.68, "Special Allowance": 1354.84 }, 0, 0, 813, 82)];
const HEADS = { "Basic Pay": { type: "Earnings for Employees" }, "HRA": { type: "Earnings for Employees" }, "Special Allowance": { type: "Earnings for Employees" }, "Income Tax": { type: "Deductions from Employees", stat: "Income Tax" },
  "Professional Tax": { type: "Deductions from Employees", stat: "Professional Tax" }, "PF Employee 12%": { type: "Employees' Statutory Deductions", stat: "PF Account (A/c No. 1)" },
  "ESI Employee": { type: "Employees' Statutory Deductions", stat: "Employee State Insurance" }, "PF Employer": { type: "Employer's Statutory Contributions" } };
const PLAN = TP.payHeadPlan(ROWS, HEADS, { "earn:Basic": "Basic Pay" }).plan;
const EMPS = ROWS.map((r) => ({ name: r.name }));
const base = (o) => Object.assign({ id: "dc-pay-202610", date: "2026-10-31", label: "Oct 2026", payable: "Salary Payable", rows: ROWS, plan: PLAN, employees: EMPS }, o || {});
// n made-up employees with k pay heads each (an earning per head, one deduction)
function many(nEmp, k, headName = (j) => "Pay Head " + j) {
  const heads = {}, plan = {}, rows = [];
  for (let j = 0; j < k - 1; j++) { heads[headName(j)] = { type: "Earnings for Employees" }; plan["earn:E" + j] = headName(j); }
  heads["Professional Tax"] = { type: "Deductions from Employees", stat: "Professional Tax" }; plan.pt = "Professional Tax";
  for (let i = 0; i < nEmp; i++) { const earn = {}; for (let j = 0; j < k - 1; j++) earn["E" + j] = 1000 + j; rows.push(row("Made Up Person " + i, earn, 0, 200, 0, 0)); }
  return { rows, plan, heads, employees: rows.map((r) => ({ name: r.name })) };
}

console.log("1. the builder, against the bridge's rules");
const cases = [];          // for the bridge's own checks: {id, xml, want: true (accepted) | false, js: the JavaScript verdict}
const keep = (id, xml, want) => { cases.push({ id, xml, want, js: TP.validatePayrollXml(xml).length === 0 }); return xml; };
{
  const out = TP.payrollVouchers(base());
  const x = keep("dc-pay-202610", TP.payrollVoucherXml(out.vouchers[0]), true);
  ok(!out.problems.length && out.vouchers.length === 1 && x === fs.readFileSync(path.join(HERE, "fixtures", "payroll_voucher.xml"), "utf8"), "the fixture's input: byte for byte tests/fixtures/payroll_voucher.xml");
  ok(TP.validatePayrollXml(x).length === 0 && !/REMOTEID/.test(x), "accepted by the JavaScript rules; no REMOTEID");
  ok(!/REMOTEID/.test(TP.payrollVoucherXml(Object.assign({}, out.vouchers[0]), "some-remote-id")), "never a REMOTEID, even when one is handed in");
  ok(TP.validatePayrollXml(x.replace('OBJVIEW="PaySlip Voucher View">', 'OBJVIEW="PaySlip Voucher View" REMOTEID="abc">')).length === 1, "a REMOTEID refused by the rules (Create only)");
  const ids = TP.payrollVouchers(base({ idOf: (i) => TPost.voucherIdOf("202610", i, "c1") })).vouchers.map((v) => v.id);
  ok(ids.join() === "dc-tp-202610-c1-p1", "the draft id dc-tp-<yyyymm>-<n>");
  ok(/TDSDesk:dc-tp-202610-c1-p1<\/NARRATION>/.test(TP.payrollVoucherXml(TP.payrollVouchers(base({ idOf: (i) => TPost.voucherIdOf("202610", i, "c1") })).vouchers[0])), "FinCom's id in the narration");
}
{
  // free text cleaned: no-break and other odd spaces, control characters, line breaks; capped
  ok(TP.cleanText("  Salary" + NBSP + "for Oct\t2026\u0007‎  ", 200) === "Salary for Oct 2026", "free text: odd spaces to spaces, control and format characters dropped, trimmed");
  ok(TP.cleanText("a".repeat(2500), TP.MAX_NARRATION).length === TP.MAX_NARRATION, "free text capped at the bridge's length");
  const v = TP.payrollVouchers(base({ label: "Oct" + NBSP + "2026\u0001", category: "Primary" + NBSP + "Cost Category" })).vouchers[0];
  const x = keep("nbsp-label", TP.payrollVoucherXml(v), true);
  ok(!x.includes(NBSP) && /<CATEGORY>Primary Cost Category<\/CATEGORY>/.test(x) && /Salary for Oct 2026 as per/.test(x), "a no-break space in the month's words and the category: sent as a plain space");
  const long = TP.payrollVouchers(base({ label: "x".repeat(3000) })).vouchers[0], lx = keep("long-narration", TP.payrollVoucherXml(long), true);
  ok(Array.from(lx.match(/<NARRATION>([^<]*)</)[1]).length <= TP.MAX_NARRATION && /TDSDesk:dc-pay-202610<\/NARRATION>/.test(lx), "a narration too long: cut to " + TP.MAX_NARRATION + " characters, FinCom's id kept");
}
{
  // a master's name is never changed (Tally finds it by name): one the bridge cannot take is refused, plainly
  const bad = (name, emps) => TP.payrollVouchers(base({ rows: [Object.assign({}, ROWS[0], { name })], employees: emps || [{ name }] }));
  let r = bad("Ravi" + NBSP + "Kumar");
  ok(!r.vouchers.length && /The employee “Ravi Kumar” in Tally has a character FinCom can’t send \(a no-break space\)\. Rename it in Tally/.test(r.problems[0]), "an employee named in Tally with a no-break space: refused, said plainly (rename it in Tally)");
  r = bad("Ravi\u0007Kumar");
  ok(!r.vouchers.length && /a control character/.test(r.problems[0]), "a control character in an employee's name: refused");
  r = bad("R".repeat(201));
  ok(!r.vouchers.length && /longer than 200 characters\. Shorten it in Tally/.test(r.problems[0]), "a name of 201 characters: refused (shorten it in Tally)");
  r = TP.payrollVouchers(base({ payable: "Salary" + NBSP + "Payable" }));
  ok(!r.vouchers.length && /The salary payable ledger “Salary Payable” in Tally has a character/.test(r.problems[0]), "the payable ledger with a no-break space: refused");
  r = TP.payrollVouchers(base({ type: "Pay\troll" }));
  ok(!r.vouchers.length && /voucher type/.test(r.problems[0]), "a voucher type with a tab: refused");
  ok(TP.companyProblem("ZZ Made Up" + NBSP + "Co") !== "" && TP.companyProblem("ZZ Made Up & Co") === "", "the Tally company's name checked as the pin checks the envelope");
  const u = TP.payrollVouchers(base({ rows: [Object.assign({}, ROWS[0], { name: "रवि कुमार" }), Object.assign({}, ROWS[1], { name: "Asha & Sons' “Verma”" })], employees: [{ name: "रवि कुमार" }, { name: "Asha & Sons' “Verma”" }] }));
  ok(u.vouchers.length === 1 && /<EMPLOYEENAME>Asha &amp; Sons&apos; “Verma”<\/EMPLOYEENAME>/.test(keep("unicode", TP.payrollVoucherXml(u.vouchers[0]), true)), "names in Devanagari and with & ' “ ”: matched and escaped, accepted");
}
{
  // the amounts and the pay heads, as the pin has them
  const r0 = Object.assign({}, ROWS[0]);
  let r = TP.payrollVouchers(base({ rows: [Object.assign({}, r0, { net: 0, tds: r0.gross - 2000, profTax: 200, pf: 1800 })] }));
  ok(!r.vouchers.length && /net pay is 0\.00; Tally Payroll needs it above zero/.test(r.problems.join(" ")), "an employee's net of zero: refused (the bridge takes only a net above zero)");
  r = TP.payrollVouchers(base({ rows: [Object.assign({}, r0, { earn: { Basic: 25000, HRA: 10000, "Special Allowance": -100 } })] }));
  ok(!r.vouchers.length && /Special Allowance is negative/.test(r.problems.join(" ")), "a negative earning: refused (book a recovery as a deduction)");
  r = TP.payrollVouchers(base({ plan: Object.assign({}, PLAN, { pt: "HRA" }) }));
  ok(!r.vouchers.length && /the pay head “HRA” is picked for an earning and a deduction/.test(r.problems.join(" ")), "one pay head for an earning and a deduction: refused (a pay head once an employee)");
  const m2 = TP.payrollVouchers(base({ plan: Object.assign({}, PLAN, { "earn:HRA": "Basic Pay" }) }));
  ok(m2.vouchers.length === 1 && m2.vouchers[0].employees[0].heads.filter((h) => h.head === "Basic Pay").length === 1 && m2.vouchers[0].employees[0].heads[0].amount === -35000, "two sheet heads to one pay head: added together, the pay head once");
  r = TP.payrollVouchers(base({ rows: [ROWS[0], Object.assign({}, ROWS[1], { name: "RAVI  KUMAR" })], employees: [{ name: "Ravi Kumar" }, { name: "RAVI  KUMAR" }] }));
  ok(!r.vouchers.length && /on the sheet twice/.test(r.problems.join(" ")), "the same employee twice (case and spacing aside): refused");
  const big = many(1, 52);
  r = TP.payrollVouchers(base(Object.assign({}, big)));
  ok(!r.vouchers.length && /has 52 pay heads; one voucher takes at most 50/.test(r.problems.join(" ")), "52 pay heads on an employee: refused (at most 50)");
  r = TP.payrollVouchers(base({ rows: [Object.assign({}, r0, { earn: { Basic: 2e10 }, gross: 2e10, net: 2e10 - 4500 })] }));
  ok(!r.vouchers.length && /too large/.test(r.problems.join(" ")), "an amount past 10 digits of rupees: refused");
  r = TP.payrollVouchers(base({ employees: [{ name: "Ravi Kumar" }, { name: "Asha Verma" }, { name: "Mehta, Sunil", gone: true }] }));
  ok(!r.vouchers.length && r.problems.some((p) => /Create the employee “Mehta, Sunil” in Tally/.test(p)), "an employee deleted in Tally counts as missing");
}
{
  // the split: one voucher a request, at most 100 employees and the byte cap
  const m = many(230, 3);
  let r = TP.payrollVouchers(base(Object.assign({ idOf: (i) => TPost.voucherIdOf("202610", i, "c1") }, m)));
  ok(r.vouchers.length === 3 && r.vouchers.map((v) => v.employees.length).join() === "100,100,30" && r.vouchers[2].id === "dc-tp-202610-c1-p3" && /part 3 of 3/.test(r.vouchers[2].narration), "230 employees: 3 vouchers of 100, 100 and 30, each its own id and part");
  r.vouchers.forEach((v) => keep(v.id + "-of-230", TP.payrollVoucherXml(v), true));
  const full = many(100, 50);
  r = TP.payrollVouchers(base(full));
  ok(r.vouchers.length === 1 && TP.byteLen(keep("100x50", TP.payrollVoucherXml(r.vouchers[0]), true)) < TP.MAX_VOUCHER_BYTES, "100 employees of 50 pay heads: one voucher, within the cap");
  const fat = many(100, 50, (j) => "p".repeat(150) + j);
  r = TP.payrollVouchers(base(Object.assign({ idOf: (i) => "dc-tp-202610-" + (i + 1) }, fat)));
  ok(r.vouchers.length === 2 && r.vouchers.every((v) => TP.byteLen(TP.payrollVoucherXml(v)) <= TP.MAX_VOUCHER_BYTES), "100 employees with long pay-head names (over 1 MiB in one): split into 2 vouchers under the cap");
  r.vouchers.forEach((v) => keep(v.id + "-fat", TP.payrollVoucherXml(v), true));
  // past the rules (made by hand, never by the builder): refused by the JavaScript rules, and by the bridge in section 2
  const one = TP.payrollVouchers(base(many(101, 2))).vouchers;
  const v101 = Object.assign({}, one[0], { employees: one[0].employees.concat(one[1].employees), net: one[0].net + one[1].net });
  const x = TP.payrollVoucherXml(TP.payrollVouchers(base()).vouchers[0]);
  const emp = x.slice(x.indexOf("<EMPLOYEEENTRIES.LIST>"), x.indexOf("</EMPLOYEEENTRIES.LIST>") + 24);
  const t = [["101 employees", TP.payrollVoucherXml(v101)], ["a REMOTEID", x.replace('View">', 'View" REMOTEID="r1">')], ["a no-break space in a name", x.replace("Ravi Kumar", "Ravi" + NBSP + "Kumar")],
    ["a control character", x.replace("Asha Verma", "Asha\u0001Verma")], ["a tab in the narration", x.replace("Salary for", "Salary\tfor")], ["an 11-digit amount", x.replace("<AMOUNT>-45500.00</AMOUNT>", "<AMOUNT>-10000000000.00</AMOUNT>")],
    ["one decimal", x.replace("<AMOUNT>200.00</AMOUNT>", "<AMOUNT>200.0</AMOUNT>")], ["the same pay head twice (case)", x.replace("<PAYHEADNAME>HRA</PAYHEADNAME>", "<PAYHEADNAME>basic pay</PAYHEADNAME>")],
    ["the same employee twice (case)", x.replace(emp, emp + emp.replace("Ravi Kumar", "RAVI KUMAR"))], ["a narration of 2,001 characters", x.replace(/<NARRATION>[^<]*</, "<NARRATION>" + "n".repeat(2001) + "<")],
    ["a name of 201 characters", x.replace("Asha Verma", "A".repeat(201))], ["an Alter", x.replace('ACTION="Create"', 'ACTION="Alter"')], ["two vouchers", x + x]];
  t.forEach(([w, y]) => { keep("bad: " + w, y, false); ok(TP.validatePayrollXml(y).length === 1, "refused by the JavaScript rules: " + w); });
  const k51 = many(1, 51);
  const v51 = TP.payrollVouchers(base(Object.assign({}, k51, { rows: k51.rows.map((r) => Object.assign({}, r)) })));
  ok(!v51.vouchers.length, "51 pay heads: the builder refuses it");
  const raw51 = TP.payrollVoucherXml({ id: "k51", type: "Payroll", date: "2026-10-31", payable: "Salary Payable", narration: "x",
    employees: [{ name: "Made Up", amount: -(51 * 100), heads: Array.from({ length: 51 }, (_, j) => ({ head: "H" + j, earn: true, amount: -100 })) }], net: 51 * 100 });
  keep("bad: 51 pay heads", raw51, false);
  ok(TP.validatePayrollXml(raw51).length === 1, "refused by the JavaScript rules: 51 pay heads on one employee");
}

console.log("2. the same vouchers through the bridge's own Go checks (bridge-go payrollimport.go)");
{
  const go = spawnSync("go", ["version"], { encoding: "utf8" });
  if (go.status !== 0) console.log("  (skipped: Go is not on this computer; the JavaScript rules above stand in)");
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "payroll-go-"));
    try {
      fs.writeFileSync(path.join(dir, "cases.json"), JSON.stringify(cases.map((c) => ({ id: c.id, xml: c.xml }))));
      const src = `package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// written by tests/run_payroll_post.mjs (an overlay; never in the tree): the app's payroll vouchers as the bridge takes
// them: stamped (stampFinComID), in the one-voucher envelope of the posting job (importReq.envelope), routed and pinned
func TestAppPayrollCases(t *testing.T) {
	dir := os.Getenv("FINCOM_PAYROLL_CASES")
	b, err := os.ReadFile(filepath.Join(dir, "cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cs []struct{ ID, XML string }
	if err := json.Unmarshal(b, &cs); err != nil {
		t.Fatal(err)
	}
	var out []M
	for _, c := range cs {
		x, _ := stampFinComID(c.XML, c.ID)
		env := importReq{kind: "voucher", report: "Vouchers", items: []M{{"id": c.ID, "xml": x}}}.envelope("ZZ Made Up Traders")
		err := checkAllowed(env)
		var pin *pinRefusedError
		why := ""
		if err != nil {
			why = err.Error()
		}
		out = append(out, M{"id": c.ID, "routed": tallyRequestID(env), "shape": payrollVoucherShape(x), "allowed": err == nil, "pin": errors.As(err, &pin), "why": why, "bytes": len(env), "payroll": isPayrollItem(M{"xml": x}), "bank": isBankItem(M{"xml": x})})
	}
	j, _ := json.Marshal(out)
	if err := os.WriteFile(filepath.Join(dir, "results.json"), j, 0o644); err != nil {
		t.Fatal(err)
	}
}
`;
      const goFile = path.join(dir, "zz_app_payroll_test.go"), bridge = path.join(HERE, "..", "bridge-go");
      fs.writeFileSync(goFile, src);
      fs.writeFileSync(path.join(dir, "overlay.json"), JSON.stringify({ Replace: { [path.join(path.resolve(bridge), "zz_app_payroll_test.go")]: goFile } }));
      const r = spawnSync("go", ["test", "-count=1", "-run", "^TestAppPayrollCases$", "-overlay", path.join(dir, "overlay.json"), "."], { cwd: bridge, encoding: "utf8", env: Object.assign({}, process.env, { FINCOM_PAYROLL_CASES: dir }), timeout: 600000 });
      ok(r.status === 0, "go test ran (bridge-go, the overlay only)" + (r.status === 0 ? "" : ": " + (r.stdout + r.stderr).slice(-600)));
      const res = r.status === 0 ? JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8")) : [];
      const by = new Map(res.map((x) => [x.id, x]));
      cases.forEach((c) => {
        const g = by.get(c.id) || {};
        if (c.want) ok(g.allowed === true && g.routed === "FinComPayrollImport" && g.shape === "" && g.payroll && !g.bank && c.js, "the bridge accepts " + c.id + " (routed FinComPayrollImport, posted alone; " + g.bytes + " bytes); the JavaScript rules agree");
        else ok(g.allowed === false && g.routed === "FinComPayrollImport" && !c.js, "the bridge refuses " + c.id.replace(/^bad: /, "") + (g.pin ? " (its payroll pin)" : "") + "; the JavaScript rules agree");
      });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
}

console.log("3. Approve: the second check, the claim, one voucher a posting, the proof");
const E = (o) => Object.assign({ id: "n1", client_id: "c1", source: "payroll", dedupe: "payroll:202610", state: "ready",
  voucher: { type: "Journal", kind: "payroll", period: "202610", date: "20261031", party: "Salary Payable", lines: [{ ledger: "Salary", dr: 85838.71 }, { ledger: "TDS on Salary 192", cr: 2500 }, { ledger: "Professional Tax Payable", cr: 400 }, { ledger: "PF Payable", cr: 4413 }, { ledger: "ESI Payable", cr: 270 }, { ledger: "Salary Payable", cr: 78255.71 }] } }, o || {});
function world(o = {}) {
  const log = [], drafts = {}, posts = [];
  const A = {
    postGate: () => (o.gate || { ok: true }), postCompany: () => "ZZ Made Up Traders", me: () => "Made-up Person", plainWhy: (m) => String(m || "").replace(/^Failed:\s*/, ""),
    tallyIdOf: (x) => String(x.vchId || ""), clientLedgers: async () => [{ name: "Salary Payable" }, { name: "Salary" }],
    Drafts: { get: (cid, id) => drafts[id] || null, load: async () => Object.values(drafts), save: async (cid, d, what) => { drafts[d.id] = JSON.parse(JSON.stringify(d)); log.push("save " + d.id + ": " + what); return true; } },
  };
  const answer = o.answer || ((v) => ({ id: v.id, ok: true, created: 1, vchId: String(100 + posts.length), word: "In Tally" }));
  const g = { tallyVia: () => o.via || "bridge", Bridge: { st: { version: o.version == null ? "2.5.18" : o.version }, post: async (pl) => { posts.push(pl); log.push("post " + pl.vouchers.map((v) => v.id).join(",")); return { ok: true, results: [answer(pl.vouchers[0], posts.length)] }; } },
    TCloud: { on: () => true, has: () => o.via === "cloud", postThrough: () => (o.through === undefined ? { version: "2.5.18", computer: "MADEUP-PC" } : o.through) }, Cloud: { api: async (path) => (/^night_entries/.test(String(path)) ? [JSON.parse(JSON.stringify(o.entry || E()))] : o.jobs || []) } };
  const rpc = async (fn, a) => { log.push(fn); if (fn === "entry_claim" && o.claim) return o.claim; return { ok: true, a }; };
  const env = { g, A, rpc, co: Object.assign({ id: "c1", payrollMethod: { value: "tally" }, payHeadPlan: { "earn:Basic": "Basic Pay" } }, o.co || {}),
    recheck: async () => o.recheck || "", books: { salary: o.rows || ROWS }, pay: { employees: o.emps || EMPS, heads: o.heads || HEADS }, seen: o.seen };
  return { log, drafts, posts, env, A, g };
}
const xmlOk = (pl) => pl.vouchers.length === 1 && TP.validatePayrollXml(pl.vouchers[0].xml).length === 0 && !/REMOTEID/.test(pl.vouchers[0].xml);
{
  let w = world(), r = await TPost.approveTallyPayroll(E(), w.env);
  ok(r.ok && w.log.filter((l) => !/^save/.test(l)).join(" > ") === "entry_claim > post dc-tp-202610-c1-p1 > entry_approved", "claimed first, then one posting of one voucher, then approved: " + w.log.filter((l) => !/^save/.test(l)).join(" > "));
  ok(w.posts.length === 1 && xmlOk(w.posts[0]) && w.posts[0].masters.length === 0 && w.posts[0].company === "ZZ Made Up Traders", "the posting: one payroll voucher of the bridge's shape, no master, the client's posting company");
  ok(r.words === "Tally created 1 payroll voucher (voucher id 101).", "the proof: Tally's answer, in plain words: " + r.words);
  const d = w.drafts["dc-tp-202610-c1-p1"];
  ok(d && d.dedupe === "payroll:202610" && d.night_entry === "n1" && d.results["dc-tp-202610-c1-p1"].ok && d.results["dc-tp-202610-c1-p1"].created === 1 && d.state === "posted", "the draft kept with the books: dc-tp-202610-c1-p1, the night's dedupe, Tally's created count");
  const again = await TPost.approveTallyPayroll(E(), w.env);
  ok(w.posts.length === 1, "Approve again (the claim refused by the cloud, or not): a voucher in Tally is never sent twice");
  ok(again.ok && /Tally created 1/.test(again.words), "  and the proof still says what Tally answered");
}
{
  let w = world({ version: "2.5.17" }), r = await TPost.approveTallyPayroll(E(), w.env);
  ok(!r.ok && r.install && r.why === "Install FinCom Bridge 2.5.18 to post Tally Payroll." && !w.log.length, "a bridge older than 2.5.18: “Install FinCom Bridge 2.5.18 to post Tally Payroll”; nothing claimed or sent");
  w = world({ version: "" }); r = await TPost.approveTallyPayroll(E(), w.env);
  ok(!r.ok && r.install && !w.posts.length, "a bridge whose version FinCom can't tell: the same, nothing sent");
  w = world({ via: "cloud", through: { version: "2.5.16", computer: "MADEUP-PC" } }); r = await TPost.approveTallyPayroll(E(), w.env);
  ok(!r.ok && r.install && r.where === "MADEUP-PC" && !w.posts.length, "through the cloud's queue: the bridge it goes to is asked (2.5.16 there: install)");
  w = world({ via: "cloud" }); r = await TPost.approveTallyPayroll(E(), w.env);
  ok(r.ok && w.posts.length === 1, "through the cloud's queue to a 2.5.18 bridge: posted");
  ok(TPost.bridgeOk("2.5.18") && TPost.bridgeOk("2.6.0") && TPost.bridgeOk("2.10.1") && !TPost.bridgeOk("2.5.9") && !TPost.bridgeOk("2.5.17"), "versions compared by number (2.10 after 2.5)");
  w = world({ gate: { ok: false, why: "Tally is not connected for ZZ Made Up Traders." } }); r = await TPost.approveTallyPayroll(E(), w.env);
  ok(!r.ok && /not connected/.test(r.why) && !w.log.length, "Tally not connected: said, nothing claimed");
}
{
  let w = world({ recheck: TPost.CHANGED }), r = await TPost.approveTallyPayroll(E(), w.env);
  ok(!r.ok && r.why === TPost.CHANGED && !w.log.length, "the second check (the night's entry not what the books make now): nothing claimed or sent");
  w = world({ emps: [{ name: "Ravi Kumar" }, { name: "Asha Verma" }] }); r = await TPost.approveTallyPayroll(E(), w.env);
  ok(!r.ok && /Create the employee “Mehta, Sunil” in Tally/.test(r.why) && !w.log.length, "an employee Tally does not have: named in plain words, nothing sent: " + r.why);
  const h = Object.assign({}, HEADS); delete h["ESI Employee"];
  w = world({ heads: h }); r = await TPost.approveTallyPayroll(E(), w.env);
  ok(!r.ok && /Pick the Tally pay head for ESI \(employee\)/.test(r.why) && !w.log.length, "a pay head Tally does not have: asked for, nothing sent: " + r.why);
  const p = TPost.prepare({ co: { id: "c1", payHeadPlan: {} }, ym: "202610", rows: ROWS, pay: { employees: [{ name: "Ravi Kumar" }], heads: h }, ledgers: ["Salary"] });
  ok(p.problems.some((x) => /Create the employee “Asha Verma”/.test(x)) && p.problems.some((x) => /Create the employee “Mehta, Sunil”/.test(x)) && p.problems.some((x) => /no salary payable ledger/.test(x)) && p.missing.includes("esiEmp"),
    "the page's list: every missing employee, the payable ledger, the pay heads to pick");
  const p0 = TPost.prepare({ co: { id: "c1" }, ym: "202610", rows: ROWS, pay: {}, ledgers: [] });
  ok(p0.problems.length === 1 && /has not read this company’s payroll from Tally yet/.test(p0.problems[0]), "no payroll read from Tally yet: said once, not every employee as missing");
  w = world({ seen: ["something else"] }); r = await TPost.approveTallyPayroll(E(), w.env);
  ok(!r.ok && /not the sheet shown here/.test(r.why) && !w.log.length, "the vouchers shown on the page differ from the books': nothing sent");
  const e2 = E(); e2.voucher = Object.assign({}, e2.voucher, { lines: e2.voucher.lines.map((l) => (l.ledger === "Salary Payable" ? { ledger: l.ledger, cr: 78000 } : l)) });
  w = world(); r = await TPost.approveTallyPayroll(e2, w.env);
  ok(!r.ok && r.why === TPost.CHANGED && !w.log.length, "a net that is not the night's entry's: changed, nothing sent");
  w = world({ claim: { ok: false, why: "On its way to Tally: wait for it to finish." } }); r = await TPost.approveTallyPayroll(E(), w.env);
  ok(!r.ok && /On its way/.test(r.why) && !w.posts.length, "the claim refused (someone else is posting it): nothing sent");
  // (review 4) the race: made again between the second check and the claim (the running month's update after a save):
  // the entry read again after the claim, not what was checked: released, nothing posted, said
  w = world(); w.env.entryOf = async (id) => ({ id, voucher: Object.assign({}, E().voucher, { lines: E().voucher.lines.map((l) => (l.ledger === "Salary" ? { ledger: "Salary", dr: 86838.71 } : l)) }) });
  r = await TPost.approveTallyPayroll(E(), w.env);
  ok(!r.ok && r.why === "Updated to the salary kept now; check and approve." && w.log.join(" > ") === "entry_claim > entry_release" && !w.posts.length, "made again after the second check: claimed, read again, released, nothing posted: " + w.log.join(" > ") + " (" + r.why + ")");
  w = world(); w.env.entryOf = async (id) => ({ id, voucher: JSON.parse(JSON.stringify(E().voucher)) });
  r = await TPost.approveTallyPayroll(E(), w.env);
  ok(r.ok && w.posts.length === 1 && !w.log.includes("entry_release"), "read again after the claim, as checked: posted");
  // (review 5) claimed, then the read again gives back no row (an empty list, null, an empty body): not read, so released,
  // nothing posted, said
  for (const [what, rows] of [["an empty list", []], ["null", null], ["an empty body", [{}]]]) {
    w = world(); w.g.Cloud.api = async (path) => (/^night_entries/.test(String(path)) ? rows : []);
    r = await TPost.approveTallyPayroll(E(), w.env);
    ok(!r.ok && r.why === "FinCom could not read this entry again. Try Approve again in a moment." && w.log.join(" > ") === "entry_claim > entry_release" && !w.posts.length, "claimed, then the read again gave back " + what + ": released, nothing posted: " + w.log.join(" > ") + " (" + r.why + ")");
  }
  w = world(); w.env.entryOf = async () => null; r = await TPost.approveTallyPayroll(E(), w.env);
  ok(!r.ok && /could not read this entry again/.test(r.why) && w.log.join(" > ") === "entry_claim > entry_release" && !w.posts.length, "claimed, then the entry read as nothing: released, nothing posted");
}
{
  let w = world({ answer: (v) => ({ id: v.id, ok: false, message: "Failed: Employee 'Mehta, Sunil' does not exist!" }) }), r = await TPost.approveTallyPayroll(E(), w.env);
  ok(!r.ok && r.why === "Tally has no employee “Mehta, Sunil”. Create it in Tally (Payroll › Employee), then Approve again." && w.log.includes("entry_release") && !w.log.includes("entry_approved"), "Tally's refusal in plain words; the entry released to try again: " + r.why);
  ok(w.drafts["dc-tp-202610-c1-p1"].state === "failed" && /does not exist/.test(w.drafts["dc-tp-202610-c1-p1"].results["dc-tp-202610-c1-p1"].said), "  the draft keeps Tally's own words too");
  w = world({ answer: (v) => ({ id: v.id, ok: false, message: "The request FinComPayrollImport is not on the bridge's allow-list of requests to Tally (the payroll posting is not one payroll voucher exactly as FinCom builds it); nothing was sent to Tally" }) });
  r = await TPost.approveTallyPayroll(E(), w.env);
  ok(!r.ok && /FinCom Bridge refused it/.test(r.why), "the bridge's pin refusing it: said plainly");
  w = world({ answer: (v) => ({ id: v.id, ok: false, held: true, message: "Waiting for ZZ Made Up Traders to be opened in Tally on MADEUP-PC: it stays queued and posts by itself.", job: "j1" }) });
  r = await TPost.approveTallyPayroll(E(), w.env);
  ok(r.ok && /queued for the Tally computer/.test(r.words) && w.log.includes("entry_approved"), "queued in the cloud for the Tally computer: approved as a journal is (it posts by itself)");
  w.env.jobs = undefined; w.g.Cloud.api = async () => [{ id: "j1", status: "waiting" }];
  r = await TPost.approveTallyPayroll(E(), w.env);
  ok(!r.ok && /On its way to Tally/.test(r.why) && w.posts.length === 1, "Approve again while it is queued: on its way, not sent again");
}
{
  // a month of 150 employees: 2 vouchers, each its own posting; the second refused, then approved again: only it is sent
  const m = many(150, 2);
  const gross = m.rows.reduce((s, x) => s + x.gross, 0), net = m.rows.reduce((s, x) => s + x.net, 0);
  const e = E({ voucher: { type: "Journal", period: "202610", date: "20261031", party: "Salary Payable", lines: [{ ledger: "Salary", dr: gross }, { ledger: "Professional Tax Payable", cr: 150 * 200 }, { ledger: "Salary Payable", cr: net }] } });
  let first = true;
  const w = world({ entry: e, rows: m.rows, emps: m.employees, heads: m.heads, co: { payHeadPlan: m.plan }, answer: (v, k) => (v.id.endsWith("-p2") && first ? { id: v.id, ok: false, message: "Voucher type 'Payroll' does not exist" } : { id: v.id, ok: true, created: 1, vchId: "2" + k }) });
  let r = await TPost.approveTallyPayroll(e, w.env);
  ok(!r.ok && w.posts.length === 2 && w.posts.every(xmlOk) && w.posts.map((p) => p.vouchers[0].id).join() === "dc-tp-202610-c1-p1,dc-tp-202610-c1-p2", "150 employees: two postings of one voucher each (dc-tp-202610-c1-p1, -2)");
  ok(r.proof.length === 2 && /^Part 1 of 2: Tally created 1/.test(r.proof[0].words) && /^Part 2 of 2: not posted\. Tally has no voucher type “Payroll”/.test(r.proof[1].words) && w.log.includes("entry_release"), "the proof part by part; part 2's refusal in plain words; released");
  first = false;
  r = await TPost.approveTallyPayroll(e, w.env);
  ok(r.ok && w.posts.length === 3 && w.posts[2].vouchers[0].id === "dc-tp-202610-c1-p2" && /Part 1 of 2: Tally created 1/.test(r.words) && /Part 2 of 2: Tally created 1/.test(r.words), "approved again: only part 2 sent; both parts in Tally");
}
{
  ok(TPost.plainPayrollWhy("Pay Head 'Basic Pay' does not exist", (m) => m) === "Tally has no pay head “Basic Pay”. Create it in Tally (Payroll › Pay Head), then Approve again.", "Tally's words for a missing pay head, plainly");
  ok(TPost.plainPayrollWhy("Some other error from Tally", (m) => "Tally said: " + m) === "Tally said: Some other error from Tally", "anything else: the Post page's own plain words (plainWhy)");
}

console.log((fails ? fails + " FAILED" : "all " + n + " passed"));
process.exit(fails ? 1 : 0);
